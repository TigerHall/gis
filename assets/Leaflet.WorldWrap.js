/**
 * Leaflet.WorldWrap.js v1.0
 * 渲染层「世界副本」—— 与地图瓦片同构的横向无限环绕
 *
 * ── 解决什么问题 ──────────────────────────────────────────────
 * Leaflet 只有 GridLayer（瓦片）自己做世界环绕：把地图横向拖出 ±180° 之后，
 * 瓦片会照旧铺满，而**矢量**（Path / Marker / Canvas 覆盖物）不会重复出现。
 *
 * 项目旧做法是在「数据层」把整份 GeoJSON 深拷贝并平移 ±360° 造出三份副本。
 * 代价有四个：
 *   ① 内存 ×3（45 万点图层尤其致命，最后只好写「点数 > 3000 就不做副本」妥协）
 *   ② 副本要素混进搜索索引 / 属性表，出现重复计数
 *   ③ 点击副本弹出的坐标是被平移过的值（456°），不是真实经纬度
 *   ④ 份数写死 3，与「屏幕上此刻能看到几个世界」无关
 *
 * 本模块把这件事整体下移到**渲染层**：正本数据只存 1 份、坐标永远是 -180~180，
 * 副本只是「画的时候多画几笔」，份数按当前视口算 —— 和瓦片的行为一致，且无上限。
 *
 * ── 三条渲染路径的落地方式 ────────────────────────────────────
 *   · Canvas 点层（Leaflet.MarkersCanvas.js）
 *       在 _redraw 内按可见 k 循环「查询 + 绘制」，零内存增长。
 *   · SVG / Canvas 线面（L.Polyline / L.Polygon，本文件 installVectorWrap 打补丁）
 *       投影后把 _rings 复制 k 份并整体平移像素，_rawPxBounds 一并扩展。
 *       因为 _parts 由 _rings 裁剪而来，**绘制与命中检测同时生效**，
 *       且仍被 renderer 裁剪（不可见的副本不会浪费绘制）。
 *   · DOM 点 / 聚类（L.Marker / L.MarkerCluster，用 L.WorldCopyGroup 池化挂载）
 *       聚类是数据空间算法，只能「一个 k 一份 DOM」；但份数由视口决定、
 *       按需创建与回收，不再写死。
 *
 * ── 不环绕的 CRS 自动退化 ─────────────────────────────────────
 * 极地投影（EPSG:3413 / 3031）没有 wrapLng，period = 0，所有路径都退化为单份。
 *
 * 依赖：Leaflet（全局 L）。需在 leaflet.js 之后、MarkersCanvas 之前引入。
 */
(function () {
  "use strict";

  if (typeof L === "undefined") {
    throw new Error(
      "Leaflet (L) is required. Include leaflet.js before Leaflet.WorldWrap.js.",
    );
  }

  // 单个方向上允许的最大副本数（防止在极端缩放/异常 CRS 下无限循环）
  var MAX_K = 32;

  function crsOf(map) {
    return map && map.options ? map.options.crs : null;
  }

  // ─────────────────────────────────────────────
  //  世界周期
  // ─────────────────────────────────────────────

  /** 一个世界在「投影空间」（proj4 的 forward 结果，单位米）里的宽度，带符号。0 = 不环绕 */
  function periodProjected(crs) {
    if (!crs || !crs.wrapLng) return 0;
    try {
      var a = crs.projection.project(L.latLng(0, 0)).x;
      var b = crs.projection.project(L.latLng(0, 360)).x;
      var d = b - a;
      return isFinite(d) && Math.abs(d) > 1e-9 ? d : 0;
    } catch (e) {
      return 0;
    }
  }

  /** 一个世界在当前缩放下有多少像素，带符号。0 = 不环绕 */
  function periodPixels(crs, zoom) {
    if (!crs || !crs.wrapLng) return 0;
    try {
      var a = crs.latLngToPoint(L.latLng(0, 0), zoom).x;
      var b = crs.latLngToPoint(L.latLng(0, 360), zoom).x;
      var d = b - a;
      return isFinite(d) && Math.abs(d) > 1e-6 ? d : 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * 采集一次渲染所需的全部环绕/投影参数。
   * 把便宜的量（仿射系数、原点、pane 位移）一次取出，供逐点绘制用 —— 逐点再调
   * map.latLngToContainerPoint() 的话，极地投影下每个点都要跑一次 proj4 前向变换，
   * 45 万点会直接卡死（见 _redraw 的说明）。
   */
  function info(map) {
    var crs = crsOf(map);
    var out = {
      ok: false,
      wraps: false,
      period: 0, // 投影空间周期（有符号）
      periodPx: 0, // 像素周期（有符号）
      maxK: MAX_K,
      scale: 1,
      a: 1,
      b: 0,
      c: 1,
      d: 0,
      originX: 0,
      originY: 0,
      paneX: 0,
      paneY: 0,
    };
    if (!map || !crs || !crs.transformation) return out;

    try {
      var zoom = map.getZoom();
      var scale = crs.scale(zoom);
      if (!isFinite(scale) || scale === 0) return out;
      var origin = map.getPixelOrigin();
      // containerPoint = layerPoint + panePos；containerPointToLayerPoint 是它的逆
      var panePos = map.containerPointToLayerPoint(L.point(0, 0)).multiplyBy(-1);
      var t = crs.transformation;

      out.scale = scale;
      out.a = t._a;
      out.b = t._b;
      out.c = t._c;
      out.d = t._d;
      out.originX = origin.x;
      out.originY = origin.y;
      out.paneX = panePos.x;
      out.paneY = panePos.y;

      var pp = periodPixels(crs, zoom);
      if (pp) {
        out.wraps = true;
        out.periodPx = pp;
        out.period = periodProjected(crs);
      }
      out.ok = true;
    } catch (e) {
      /* 保持 out.ok = false，调用方按「不环绕」处理 */
    }
    return out;
  }

  /** 投影坐标 → 容器像素（含世界偏移 k）。k 以「世界」为单位（整数） */
  function toContainer(inf, projX, projY, k) {
    var px = projX + (k ? k * inf.period : 0);
    return {
      x: inf.scale * (inf.a * px + inf.b) - inf.originX + inf.paneX,
      y: inf.scale * (inf.c * projY + inf.d) - inf.originY + inf.paneY,
    };
  }

  /**
   * 视口在「投影空间」里的矩形。
   *
   * ⚠️ 这里刻意**不用 map.getBounds()** —— 极地投影下它直接失效
   *    （投影矩形的四角反算不出包含极点的 bbox，实测 EPSG:3413 返回 s=31.35 > n=31）。
   * 改用「像素矩形 → 仿射逆变换」。因为仿射变换把矩形映成矩形，结果是**精确**的：
   * 该矩形正是「屏幕上可见的全部投影坐标」的集合。
   *
   * ⚠️ 坐标系要点（实测确认，容易搞错）：
   *    map.getPixelBounds() 返回的是 `crs.latLngToPoint()` 空间（绝对坐标，只随中心
   *    与缩放变化），**不是** layerPoint 空间（latLngToLayerPoint 那个随平移变化的）。
   *    两者差一个 pixelOrigin。所以这里直接 untransform 即可，**不要再加 pixelOrigin**。
   *    好消息是 getPixelBounds() 已经包含了 pane 位移（内部是 pixelOrigin - panePos），
   *    所以拖动过程中的半途状态也是对的。
   */
  function viewRectProjected(map, inf) {
    if (!map || !inf || !inf.ok) return null;
    try {
      var pb = map.getPixelBounds();
      var t = map.options.crs.transformation;
      var p1 = t.untransform(pb.min, inf.scale);
      var p2 = t.untransform(pb.max, inf.scale);
      if (!isFinite(p1.x) || !isFinite(p2.x) || !isFinite(p1.y) || !isFinite(p2.y))
        return null;
      return {
        minX: Math.min(p1.x, p2.x),
        maxX: Math.max(p1.x, p2.x),
        minY: Math.min(p1.y, p2.y),
        maxY: Math.max(p1.y, p2.y),
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 求「数据矩形按 k 个世界平移后，能与查询矩形相交」的整数 k 列表。
   * 升序，且每个 k 代表一个**不同的**世界副本。
   */
  function ksForRect(period, q, d, maxK) {
    if (!period || !q || !d) return [0];
    var lim = maxK || MAX_K;
    var kMin = Math.ceil((q.minX - d.maxX) / period - 1e-9);
    var kMax = Math.floor((q.maxX - d.minX) / period + 1e-9);
    if (!isFinite(kMin) || !isFinite(kMax) || kMax < kMin) return [0];
    if (kMax - kMin > lim * 2) {
      // 异常放大（缩放极小 / CRS 退化）时只取中间一段，避免无谓循环
      var mid = Math.round((kMin + kMax) / 2);
      kMin = mid - lim;
      kMax = mid + lim;
    }
    var out = [];
    for (var k = kMin; k <= kMax; k++) out.push(k);
    return out.length ? out : [0];
  }

  /** 把经度折回 [-180, 180)，用于「坐标不出现 456」 */
  function normalizeLng(lng) {
    if (!isFinite(lng)) return lng;
    var v = ((((lng + 180) % 360) + 360) % 360) - 180;
    return v;
  }

  function normalizeLatLng(ll) {
    if (!ll) return ll;
    return L.latLng(ll.lat, normalizeLng(ll.lng), ll.alt);
  }

  // ─────────────────────────────────────────────
  //  SVG / Canvas 线面：投影后复制 _rings
  // ─────────────────────────────────────────────

  /**
   * 在 Polyline._project 之后把 _rings 复制 k 份并整体平移。
   *
   * 为什么改 _rings 而不是 _parts：
   *   _parts 是 _rings 经 renderer 裁剪 / 简化后的结果，而 _update()（clip → simplify →
   *   updatePath）紧随 _project 之后执行。改 _rings 能让裁剪、简化、绘制、命中检测
   *   四条链路**全都**自动看到副本，一处都不用单独改。
   *
   * 为什么整条几何统一平移（而不是逐顶点吸附到 ±180）：
   *   逐顶点会让一条跨 180° 的短线被撕成横跨全球的怪线（实测 20° 的线渲染成 968px，
   *   而世界宽才 1024px）。跨 180° 的正确处理是先把几何「展开」（geo-utils.js 的
   *   fixAntimeridian），再整体平移。
   */
  function multiplyRings(layer) {
    var map = layer._map;
    if (!map || !layer._rings || !layer._rings.length) return;
    if (layer.options && layer.options.noWorldWrap) return;

    var inf = info(map);
    if (!inf.ok || !inf.wraps) return;

    var raw = layer._rawPxBounds;
    if (!raw || !raw.isValid || !raw.isValid()) return;

    var vb = (layer._renderer && layer._renderer._bounds) || map.getPixelBounds();
    var ks = ksForRect(
      inf.periodPx,
      { minX: vb.min.x, maxX: vb.max.x },
      { minX: raw.min.x, maxX: raw.max.x },
      inf.maxK,
    );

    // 记录本层当前需要的副本集合，供 moveend 钩子判断「平移后是否需要重投影」
    layer._ogvWrapKs = ks;
    registerVector(layer, map);

    if (ks.length === 1 && ks[0] === 0) return; // 只有一个正本可见 → 不动

    var src = layer._rings;
    var out = [];
    for (var ki = 0; ki < ks.length; ki++) {
      var dx = ks[ki] * inf.periodPx;
      for (var i = 0; i < src.length; i++) {
        var ring = src[i];
        if (!dx) {
          out.push(ring); // k = 0：直接用原数组，零分配
          continue;
        }
        var copy = new Array(ring.length);
        for (var j = 0; j < ring.length; j++) {
          copy[j] = new L.Point(ring[j].x + dx, ring[j].y);
        }
        out.push(copy);
      }
    }
    layer._rings = out;

    // _pxBounds 必须一并覆盖副本：① 裁剪闸门 _clipPoints 靠它放行
    // ② 命中检测 _containsPoint 开头就把它当早退条件，不扩展则副本点不中
    var minDx = ks[0] * inf.periodPx;
    var maxDx = ks[ks.length - 1] * inf.periodPx;
    layer._rawPxBounds = new L.Bounds(
      raw.min.add([minDx, 0]),
      raw.max.add([maxDx, 0]),
    );
    layer._updateBounds();
  }

  // ─────────────────────────────────────────────
  //  矢量重投影调度
  // ─────────────────────────────────────────────
  //  Leaflet 平移地图时不动矢量：它只把 mapPane 做 CSS 平移，path 的 d 属性
  //  保持不变 —— 这正是拖动手感丝滑的原因。代价是「世界副本」这类依赖视口的
  //  东西不会被重新计算：副本只在最后一次投影时的可见世界里存在，往东拖出去
  //  就是空白（旧的数据层三副本没有这个问题，因为三份都常驻 pane，平移即显形）。
  //
  //  所以这里登记所有打了补丁的矢量层，在 moveend / zoomend 时比对「此刻应该
  //  出现哪几个世界」：只有集合真的变了才 redraw()（即重新 _project）。
  //  远离 ±180 接缝的图层一次都不会重算 —— 这是把副本搬到渲染层必须付的那点
  //  代价，用一个集合比对把它压到最低。
  function onMapMove(e) {
    var map = e && e.target;
    if (!map || !map._ogvWrapRegistry) return;
    var reg = map._ogvWrapRegistry;
    var inf = info(map);
    if (!inf.ok || !inf.wraps) return;
    Object.keys(reg).forEach(function (id) {
      var layer = reg[id];
      if (!layer || !layer._map) {
        delete reg[id];
        return;
      }
      var raw = layer._rawPxBounds;
      if (!raw || !raw.isValid || !raw.isValid()) return;
      var vb =
        (layer._renderer && layer._renderer._bounds) || map.getPixelBounds();
      var ks = ksForRect(
        inf.periodPx,
        { minX: vb.min.x, maxX: vb.max.x },
        { minX: raw.min.x, maxX: raw.max.x },
        inf.maxK,
      );
      var cur = layer._ogvWrapKs;
      if (cur && cur.length === ks.length) {
        var same = true;
        for (var i = 0; i < ks.length; i++) {
          if (cur[i] !== ks[i]) {
            same = false;
            break;
          }
        }
        if (same) return;
      }
      try {
        layer.redraw();
      } catch (err) {}
    });
  }

  function registerVector(layer, map) {
    if (!map._ogvWrapRegistry) {
      map._ogvWrapRegistry = Object.create(null);
      map.on("moveend zoomend", onMapMove);
    }
    var id = L.stamp(layer);
    if (!map._ogvWrapRegistry[id]) {
      map._ogvWrapRegistry[id] = layer;
      layer.once("remove", function () {
        if (map._ogvWrapRegistry) delete map._ogvWrapRegistry[id];
      });
    }
  }

  var _vectorWrapInstalled = false;
  function installVectorWrap() {
    if (_vectorWrapInstalled) return;
    // Polygon 没有自己的 _project（继承 Polyline 的），所以只补 Polyline 一处即可
    var Proto = L.Polyline && L.Polyline.prototype;
    if (!Proto || !Proto._project) return;
    var orig = Proto._project;
    Proto._project = function () {
      orig.call(this);
      multiplyRings(this);
    };
    _vectorWrapInstalled = true;
  }

  // ─────────────────────────────────────────────
  //  DOM 点 / 聚类：按视口池化挂载副本
  // ─────────────────────────────────────────────

  /**
   * L.WorldCopyGroup(factory, options)
   *
   *   factory(k) → L.Layer   为第 k 个世界造一个图层（k=0 是正本）
   *
   * 地图移动/缩放后自动算出「此刻可见的世界」，按需创建 / 挂载 / 回收。
   * 图层按 k 池化复用，最久未用的先销毁，池子有上限（options.maxPool）。
   *
   * 用途：DOM 点要素与 markerCluster —— 聚类本身是数据空间算法（它要按经纬度
   * 距离归并），只能一 k 一份图层，没法像 Canvas 那样在同一份数据上多画几笔。
   */
  L.WorldCopyGroup = L.LayerGroup.extend({
    options: {
      maxPool: 12, // 池子上限：最多同时在池里保留几个 k 的图层
    },

    initialize: function (factory, options) {
      this._factory = factory;
      this._pool = {}; // k → layer
      this._poolOrder = []; // 池内 k 的创建顺序（回收用）
      this._active = null; // 当前挂载的 k 列表
      this._boundSync = this.sync.bind(this);
      L.LayerGroup.prototype.initialize.call(this, []);
    },

    onAdd: function (map) {
      L.LayerGroup.prototype.onAdd.call(this, map);
      map.on("moveend zoomend", this._boundSync);
      this.sync();
    },

    onRemove: function (map) {
      map.off("moveend zoomend", this._boundSync);
      L.LayerGroup.prototype.onRemove.call(this, map);
    },

    /** 重建当前应挂载的副本集合 */
    sync: function () {
      if (!this._map) return;
      var map = this._map;
      var inf = info(map);
      var want;

      if (!inf.ok || !inf.wraps) {
        want = [0];
      } else {
        // 正本（k=0）的世界在像素上占 [0, W]（EPSG:3857 的 lng=-180 → x=0）
        var pb = map.getPixelBounds();
        var W = inf.periodPx;
        var kMin = Math.floor(pb.min.x / W);
        var kMax = Math.floor(pb.max.x / W);
        if (!isFinite(kMin) || !isFinite(kMax)) {
          want = [0];
        } else {
          if (kMax - kMin > inf.maxK * 2) kMax = kMin + inf.maxK;
          want = [];
          for (var k = kMin; k <= kMax; k++) want.push(k);
        }
      }

      var i,
        same = this._active && this._active.length === want.length;
      if (same) {
        for (i = 0; i < want.length; i++) {
          if (this._active[i] !== want[i]) {
            same = false;
            break;
          }
        }
      }
      if (same) return;

      var seen = {};
      for (i = 0; i < want.length; i++) seen[want[i]] = true;

      // 卸下不再需要的
      if (this._active) {
        for (i = 0; i < this._active.length; i++) {
          var oldK = this._active[i];
          if (seen[oldK]) continue;
          var oldSet = this._pool[oldK];
          if (!oldSet) continue;
          for (var oi = 0; oi < oldSet.length; oi++) {
            this.removeLayer(oldSet[oi]);
          }
        }
      }

      // 挂上需要的（缺则按需创建）
      for (i = 0; i < want.length; i++) {
        var k2 = want[i];
        var set = this._pool[k2];
        if (!set) {
          var made = this._factory(k2);
          if (!made) continue;
          // 工厂可以返回单个图层，也可以返回图层数组（一个世界副本里可能有多个图层）
          set = Array.isArray(made) ? made : [made];
          set = set.filter(function (x) {
            return !!x;
          });
          if (!set.length) continue;
          this._pool[k2] = set;
          this._poolOrder.push(k2);
        }
        for (var ai = 0; ai < set.length; ai++) this.addLayer(set[ai]);
      }
      this._active = want;

      this._evict();
    },

    /** 池子超限时销毁最久未挂载的副本 */
    _evict: function () {
      var cap = this.options.maxPool || 12;
      var activeObj = {};
      (this._active || []).forEach(function (k) {
        activeObj[k] = true;
      });
      while (this._poolOrder.length > cap) {
        var dropK = null;
        for (var i = 0; i < this._poolOrder.length; i++) {
          if (!activeObj[this._poolOrder[i]]) {
            dropK = this._poolOrder[i];
            break;
          }
        }
        if (dropK === null) break; // 全在用，先不回收
        var idx = this._poolOrder.indexOf(dropK);
        this._poolOrder.splice(idx, 1);
        var set = this._pool[dropK];
        delete this._pool[dropK];
        if (!set) continue;
        for (var j = 0; j < set.length; j++) {
          var lyr = set[j];
          try {
            this.removeLayer(lyr);
          } catch (e) {}
          // 释放 DOM：聚类组 / GeoJSON 组把子 marker 一并清掉
          if (typeof lyr.clearLayers === "function") {
            try {
              lyr.clearLayers();
            } catch (e) {}
          }
        }
      }
    },
  });

  L.worldCopyGroup = function (factory, options) {
    return new L.WorldCopyGroup(factory, options);
  };

  L.WorldWrap = {
    MAX_K: MAX_K,
    info: info,
    toContainer: toContainer,
    periodProjected: periodProjected,
    periodPixels: periodPixels,
    viewRectProjected: viewRectProjected,
    ksForRect: ksForRect,
    normalizeLng: normalizeLng,
    normalizeLatLng: normalizeLatLng,
    installVectorWrap: installVectorWrap,
    _multiplyRings: multiplyRings,
  };

  installVectorWrap();
})();
