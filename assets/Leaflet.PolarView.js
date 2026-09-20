/**
 * Leaflet.PolarView.js
 * 极地投影视图（南北极）—— 独立的第二张 L.map，主视图完全不受影响。
 *
 * 设计要点
 * ────────────────────────────────────────────────────────────────────
 * 1. 只读的第二视图。主视图（EPSG:3857）的所有状态、图层实例、控件都不动；
 *    极地视图按「当前面板里勾选了哪些图层」重新构建一份自己的图层，挂在自己的
 *    L.map 上。所以不存在「同一个 layer 被两张图抢」的问题（Leaflet 的 layer
 *    同一时刻只能属于一个 map）。
 * 2. 数据只渲染一份正本，坐标始终是 -180~180。立体投影下没有 wrapLng，
 *    L.WorldWrap 的周期为 0 → 世界副本自动关闭（见 Leaflet.WorldWrap.js）。
 * 3. 立体投影会把另一个半球投到极远处（乃至趋于无穷），所以点要素先按投影坐标
 *    半径过滤（POLAR_CONFIG.maxProjected），再交给渲染层。
 * 4. 底图完全由 POLAR_CONFIG.basemaps 决定，本文件不含任何 URL 与图层名。
 *    支持 kind = tile / wms / polarImage（极化预烘影像，见
 *    .workbuddy/artifacts/make-polar-gebco.js）。
 *
 * 依赖：leaflet.js → proj4.js → proj4leaflet.js → geo-config.js（POLAR_CONFIG）
 *      → geo-utils.js / Leaflet.GeoMarker.js / Leaflet.MarkersCanvas.js
 */
(function () {
  "use strict";

  var L = window.L;
  var cfg = window.POLAR_CONFIG;
  if (!L || !cfg || !L.Proj || typeof L.Proj.CRS !== "function") {
    console.warn(
      "[polar] 缺少 proj4leaflet 或 POLAR_CONFIG，极地视图未启用",
    );
    return;
  }

  var S = window.OGVStorage;

  var state = {
    open: false,
    mode: null,
    map: null,
    baseName: null,
    baseLayer: null,
    dataLayers: [],
    crsCache: {},
    refreshTimer: 0,
    // 每次重建矢量图层时记录净化统计（供调试 / 自动化断言：dropped / clipped）
    geomStat: {},
  };

  var dom = {};

  // ==================================================================
  // DOM
  // ==================================================================
  function cacheDom() {
    if (dom.root) return true;
    dom.root = document.getElementById("polarView");
    dom.mapEl = document.getElementById("polarMap");
    dom.select = document.getElementById("polarBasemap");
    dom.hint = document.getElementById("polarHint");
    dom.title = document.getElementById("polarTitle");
    dom.modeBtns = document.querySelectorAll("[data-polar-mode]");
    return !!(dom.root && dom.mapEl);
  }

  function setHint(text, isError) {
    if (!dom.hint) return;
    dom.hint.textContent = text || "";
    dom.hint.classList.toggle("is-error", !!isError);
  }

  // ==================================================================
  // 配置读取
  // ==================================================================
  function modeCfg(mode) {
    return cfg.modes[mode] || cfg.modes.north;
  }
  function basemapList() {
    return cfg.basemaps || [];
  }
  function basemapDesc(name) {
    var list = basemapList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === name) return list[i];
    }
    return list[0] || null;
  }
  function fillTokens(url, mode) {
    return String(url || "")
      .split("{epsg}")
      .join(modeCfg(mode).epsg)
      .split("{mode}")
      .join(mode);
  }

  function polarCrs(mode) {
    if (state.crsCache[mode]) return state.crsCache[mode];
    var mc = modeCfg(mode);
    var crs = new L.Proj.CRS(mc.code, mc.def, {
      origin: mc.origin,
      resolutions: mc.resolutions,
      bounds: L.bounds(
        L.point(mc.bounds[0], mc.bounds[1]),
        L.point(mc.bounds[2], mc.bounds[3]),
      ),
    });
    state.crsCache[mode] = crs;
    return crs;
  }

  /**
   * 该模式可用的最大缩放。
   *
   * ⚠️ 必须与 `resolutions` 表长度对齐：proj4leaflet 的 `scale(z)` 就是
   *    `_scales[z]`（resolutions 的倒数），表里没有的层级返回 `undefined`。
   *    Leaflet 的 `getZoomScale()` 拿它做除法 → NaN → `_pxBoundsToTileRange()`
   *    算出非有限的瓦片范围 → 直接抛 `Attempted to load an infinite number of
   *    tiles`。而且 `zoomSnap: 0` 会插值到 `_scales[z + 1]`，所以少一项不只是
   *    「最大那一级不能用」，而是**滚轮滑到 maxZoom 附近就崩**。
   *    这里显式取 min 并告警，兜住配置写错；契约由 geo-config 的注释声明。
   */
  function maxZoomFor(mode) {
    var res = (modeCfg(mode) || {}).resolutions || [];
    var cap = res.length - 1;
    var want = cfg.maxZoom == null ? cap : cfg.maxZoom;
    if (want > cap) {
      console.warn(
        "[polar] maxZoom=" + want + " 超出 resolutions 表长度（" + res.length +
          " 项，最大可用 " + cap + "），已按 " + cap + " 处理",
      );
      return cap;
    }
    return want;
  }

  // ==================================================================
  // 底图
  // ==================================================================
  /**
   * ⚠️ 刻意**不给瓦片层设 `bounds`**。
   *
   * 曾经用「正方形四边采样」算过一个经纬度包络框塞进 `options.bounds`，想拦住
   * 网格之外的瓦片请求 —— 结果瓦片一块都不出。原因是几何上的：
   * **极点在正方形内部，不在四条边上**。只采样边得到的纬度范围是一条「环带」
   * （北极约 38.8°~52.6°），而视口里靠近极点的瓦片纬度是 60°~90°，
   * 与环带不相交 → Leaflet 的 `_isValidTile` 把每一块都判成无效。
   *
   * 而「拦越界瓦片」这件事其实**已经由 CRS 的 bounds 兜住了**：
   * 立体投影的投影范围就是 ±4194304（正是瓦片矩阵的范围），凡 CRS 给了 bounds，
   * `crs.infinite` 即为 false，Leaflet 会用 `getPixelWorldBounds()` 推出
   * `_globalTileRange`，而极地 CRS 没有 wrapLng/wrapLat，`_isValidTile` 就会把
   * 矩阵之外的 x/y 全部拒掉 —— 正好等价于我们想要的拦截，且不会误伤。
   * 所以这里只保留 `maxNativeZoom` 这一层约束，不再额外加 bounds。
   */
  function buildBasemap(name, mode) {
    var d = basemapDesc(name);
    if (!d) return null;
    var url = fillTokens(d.url, mode);
    var mz = maxZoomFor(mode);

    if (d.kind === "polarImage") {
      var b = cfg.imageBounds || [
        [-4194304, -4194304],
        [4194304, 4194304],
      ];
      var layer = L.Proj.imageOverlay(
        url,
        L.bounds(L.point(b[0][0], b[0][1]), L.point(b[1][0], b[1][1])),
        {
          attribution: d.attribution || "",
          pane: cfg.imagePane || "overlayPane",
          interactive: false,
        },
      );
      // 影像还没生成过时给出可操作的提示，而不是静默白屏
      layer.on("error", function () {
        setHint(
          "该底图的极地影像尚未生成（" +
            url +
            "），可运行 .workbuddy/artifacts/make-polar-gebco.js 生成",
          true,
        );
      });
      layer.on("load", function () {
        setHint("");
      });
      return layer;
    }

    if (d.kind === "wms") {
      return L.tileLayer.wms(
        url,
        Object.assign(
          {
            layers: d.layers,
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            crossOrigin: "anonymous",
            minZoom: 0,
            maxZoom: mz,
            maxNativeZoom: d.maxNativeZoom == null ? mz : d.maxNativeZoom,
            attribution: d.attribution || "",
          },
          d.options || {},
        ),
      );
    }

    // 默认：XYZ 瓦片
    return L.tileLayer(url, {
      tileSize: d.tileSize || 256,
      minZoom: 0,
      maxZoom: mz,
      maxNativeZoom: d.maxNativeZoom == null ? mz : d.maxNativeZoom,
      opacity: d.opacity == null ? 1 : d.opacity,
      attribution: d.attribution || "",
      crossOrigin: "anonymous",
    });
  }

  // ==================================================================
  // 数据图层：读取面板里「已勾选且已有要素缓存」的图层
  // ==================================================================
  function checkedLayers() {
    var out = [];
    var boxes = document.querySelectorAll(
      'input[type="checkbox"][id^="layer_"]',
    );
    for (var i = 0; i < boxes.length; i++) {
      var cb = boxes[i];
      if (!cb.checked) continue;
      var feats =
        window._featureCache && window._featureCache[cb.id]
          ? window._featureCache[cb.id]
          : null;
      if (!feats || !feats.length) continue;
      out.push({
        id: cb.id,
        name: (cb.dataset && cb.dataset.layerName) || cb.id,
        features: feats,
      });
    }
    return out;
  }

  function layerStyle(id) {
    var op = window._ogv_layerOpacityMap && window._ogv_layerOpacityMap[id];
    return {
      color: (window._ogv_layerColorMap && window._ogv_layerColorMap[id]) || "#8B6914",
      colorMode: (window._ogv_colorMode && window._ogv_colorMode[id]) || "sequential",
      colorField: (window._ogv_fieldKey && window._ogv_fieldKey[id]) || null,
      icon: (window._ogv_layerIconMap && window._ogv_layerIconMap[id]) || null,
      iconSize:
        (window._ogv_layerIconSizeMap && window._ogv_layerIconSizeMap[id]) || 20,
      opacity: op == null ? 0.8 : Number(op),
      labelField:
        (window._ogv_labelFieldMap && window._ogv_labelFieldMap[id]) ||
        (window._ogv_getDefaultLabelField
          ? window._ogv_getDefaultLabelField()
          : "Name"),
    };
  }

  function featureColor(feature, index, st) {
    var G = window.GeoUtils;
    if (!G) return st.color;
    if (st.colorMode === "single") return st.color;
    if (st.colorMode === "field" && st.colorField && feature.properties) {
      return G.getFeatureColorByField(
        feature.properties,
        st.colorField,
        index || 0,
      );
    }
    return G.getFeatureColorByIndex(index || 0);
  }

  function mainGeomType(features) {
    var G = window.GeoUtils;
    if (G && typeof G.detectMainGeomType === "function") {
      return G.detectMainGeomType({ type: "FeatureCollection", features: features });
    }
    var f = features[0];
    return ((f && f.geometry && f.geometry.type) || "").toLowerCase();
  }

  // ==================================================================
  // 投影空间净化（极地矢量专用）
  // ==================================================================
  /**
   * 立体投影是「以极点为心的平面」：另一个半球的点会被投到极远处，极点本身
   * 趋于无穷。板块 / 洋中脊这类**全球性面线图层**必然横跨两个半球，直接丢给
   * Leaflet 会出两类事故（不是配置能解决的问题，必须在这里裁掉）：
   *
   *   ① 一个环被投成半径 10^13 量级的巨物。Leaflet 是在**屏幕空间**裁剪路径的，
   *      巨物进来时它算出的交点已经没有意义 → 得到**整屏的纯色填充**：底图被
   *      一块板块盖住，只剩几条莫名其妙的直线（用户在南北极看到的「板块渲染
   *      错误」就是这个）。实测 plate16 在南极模式下，北美板块的顶点被投到
   *      **2.0×10^7 倍**正方形半宽（约 8.5×10^13 m）。
   *   ② 正好落在对跖极点上的顶点投影出 `Infinity`（plate_ocean、
   *      plates_Hasterok2022 各 2 个）→ SVG path 里出现 "Infinity" → 整条路径
   *      解析失败，本该弯曲的边界变成一条直线。
   *
   * 做法：把几何**投影到平面 → 裁到影像正方形（±imageBounds）→ 反投影回
   * 经纬度**，再交给渲染层。这样坐标量级恒定在正方形内，两个事故都消失；
   * 地理上等价于「只画这块极地影像覆盖得到的部分」，正是极地视图该有的语义。
   */
  function polarLim() {
    var b = cfg.imageBounds;
    if (b && b[1] && isFinite(b[1][0])) return Math.abs(b[1][0]);
    return 4194304;
  }

  /** 本投影的中央经线：投影平面上「正下方」那条射线就是 lon_0（x = ρ·sinΔλ, y = −ρ·cosΔλ） */
  function centralLng(proj) {
    var ll = proj.unproject(L.point(0, -1e7));
    return isFinite(ll.lng) ? ll.lng : 0;
  }

  /**
   * 投影单个顶点。正常点直接返回；极点 / 对跖点（真实投影在无穷远）只保留方位角，
   * 半径钳到正方形外 4 倍 —— 反正超出正方形的部分马上就会被裁掉，方位角对了结果就对。
   */
  function projectSafe(proj, lng, lat, lon0, lim) {
    if (!isFinite(lng) || !isFinite(lat)) return null;
    var p = proj.project(L.latLng(lat, lng));
    if (isFinite(p.x) && isFinite(p.y)) return [p.x, p.y];
    var r = lim * 4;
    var d = ((lng - lon0) * Math.PI) / 180;
    return [r * Math.sin(d), -r * Math.cos(d)];
  }

  function projectRing(list, proj, lon0, lim) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.length < 2) continue;
      var p = projectSafe(proj, c[0], c[1], lon0, lim);
      if (p) out.push(p);
    }
    return out;
  }

  /** 半平面裁剪（Sutherland–Hodgman，按多边形环语义：首尾相连） */
  function clipHalfPlane(pts, axis, bound, keepGreater) {
    var out = [];
    var n = pts.length;
    if (n < 2) return out;
    var prev = pts[n - 1];
    var prevIn = keepGreater ? prev[axis] >= bound : prev[axis] <= bound;
    for (var i = 0; i < n; i++) {
      var cur = pts[i];
      var curIn = keepGreater ? cur[axis] >= bound : cur[axis] <= bound;
      if (curIn !== prevIn) {
        var den = cur[axis] - prev[axis];
        var t = den === 0 ? 0 : (bound - prev[axis]) / den;
        var q = [
          prev[0] + (cur[0] - prev[0]) * t,
          prev[1] + (cur[1] - prev[1]) * t,
        ];
        q[axis] = bound; // 抹掉浮点残差，保证严格贴边
        out.push(q);
      }
      if (curIn) out.push(cur);
      prev = cur;
      prevIn = curIn;
    }
    return out;
  }

  function clipRing(pts, lim) {
    var r = clipHalfPlane(pts, 0, -lim, true);
    if (r.length < 3) return r;
    r = clipHalfPlane(r, 0, lim, false);
    if (r.length < 3) return r;
    r = clipHalfPlane(r, 1, -lim, true);
    if (r.length < 3) return r;
    return clipHalfPlane(r, 1, lim, false);
  }

  /** 线段 vs 正方形（Liang–Barsky）：返回裁后线段与两端是否被截断 */
  function clipSegmentRect(a, b, lim) {
    var t0 = 0,
      t1 = 1,
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    var p = [-dx, dx, -dy, dy];
    var q = [a[0] + lim, lim - a[0], a[1] + lim, lim - a[1]];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return null;
        continue;
      }
      var r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
    return {
      a: [a[0] + t0 * dx, a[1] + t0 * dy],
      b: [a[0] + t1 * dx, a[1] + t1 * dy],
      cutA: t0 > 0,
      cutB: t1 < 1,
    };
  }

  /** 折线裁剪：返回若干条折线（被正方形切开的连续段各自成一条） */
  function clipPolyline(pts, lim) {
    var parts = [];
    var cur = [];
    for (var i = 1; i < pts.length; i++) {
      var seg = clipSegmentRect(pts[i - 1], pts[i], lim);
      if (!seg) {
        if (cur.length > 1) parts.push(cur);
        cur = [];
        continue;
      }
      if (!cur.length) {
        cur.push(seg.a);
      } else if (seg.cutA) {
        // 上一段在框外断开 → 这里是新的一段
        if (cur.length > 1) parts.push(cur);
        cur = [seg.a];
      }
      cur.push(seg.b);
      if (seg.cutB) {
        if (cur.length > 1) parts.push(cur);
        cur = [];
      }
    }
    if (cur.length > 1) parts.push(cur);
    return parts;
  }

  function dedupe(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var last = out[out.length - 1];
      if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9)
        continue;
      out.push(p);
    }
    return out;
  }

  function unprojectList(pts, proj, close) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var ll = proj.unproject(L.point(pts[i][0], pts[i][1]));
      if (!isFinite(ll.lat) || !isFinite(ll.lng)) continue;
      out.push([ll.lng, ll.lat]);
    }
    if (close && out.length > 2) out.push(out[0].slice());
    return out;
  }

  /**
   * 净化单个 geometry：
   *   返回 { geom, hit, fullyIn } —— hit=false 表示整块在正方形外（调用方丢弃）
   */
  function sanitizeGeometry(geom, proj, lon0, lim, stat) {
    var t = geom.type;
    var i, j;

    if (t === "Polygon" || t === "MultiPolygon") {
      var src = t === "Polygon" ? [geom.coordinates] : geom.coordinates;
      var outPolys = [];
      var hit = false,
        allIn = true;
      for (i = 0; i < src.length; i++) {
        var rings = [];
        var outerKept = false;
        for (j = 0; j < src[i].length; j++) {
          var pr = dedupe(projectRing(src[i][j], proj, lon0, lim));
          var bb = pr.length >= 3 ? bboxOf(pr) : null;
          var keepRing = !!bb && bboxHits(bb, lim);
          // ⚠️ 外环被丢掉的「洞」不能单独留下：那样洞会被当成实心面填掉
          if (j === 0 && !keepRing) break;
          if (j > 0 && (!keepRing || !outerKept)) continue;
          hit = true;
          if (!bboxInside(bb, lim)) allIn = false;
          var cr = dedupe(clipRing(pr, lim));
          if (cr.length < 3) continue;
          var ll = unprojectList(cr, proj, true);
          if (ll.length < 4) continue;
          if (j === 0) outerKept = true;
          rings.push(ll);
        }
        if (rings.length) outPolys.push(rings);
      }
      stat.hit += hit ? 1 : 0;
      if (!hit || !outPolys.length) return { geom: null, hit: false, fullyIn: false };
      return {
        geom: {
          type: outPolys.length > 1 ? "MultiPolygon" : "Polygon",
          coordinates: outPolys.length > 1 ? outPolys : outPolys[0],
        },
        hit: true,
        fullyIn: allIn,
      };
    }

    if (t === "LineString" || t === "MultiLineString") {
      var lsrc = t === "LineString" ? [geom.coordinates] : geom.coordinates;
      var outLines = [];
      var lhit = false,
        lall = true;
      for (i = 0; i < lsrc.length; i++) {
        var lp = dedupe(projectRing(lsrc[i], proj, lon0, lim));
        if (lp.length < 2) continue;
        var lbb = bboxOf(lp);
        if (!bboxHits(lbb, lim)) continue;
        lhit = true;
        if (!bboxInside(lbb, lim)) lall = false;
        var parts = clipPolyline(lp, lim);
        for (j = 0; j < parts.length; j++) {
          var lll = unprojectList(parts[j], proj, false);
          if (lll.length >= 2) outLines.push(lll);
        }
      }
      if (!lhit || !outLines.length) return { geom: null, hit: false, fullyIn: false };
      return {
        geom: {
          type: outLines.length > 1 ? "MultiLineString" : "LineString",
          coordinates: outLines.length > 1 ? outLines : outLines[0],
        },
        hit: true,
        fullyIn: lall,
      };
    }

    return { geom: geom, hit: true, fullyIn: true };
  }

  function bboxOf(pts) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < pts.length; i++) {
      if (pts[i][0] < b[0]) b[0] = pts[i][0];
      if (pts[i][1] < b[1]) b[1] = pts[i][1];
      if (pts[i][0] > b[2]) b[2] = pts[i][0];
      if (pts[i][1] > b[3]) b[3] = pts[i][1];
    }
    return b;
  }
  function bboxHits(b, lim) {
    return b[2] >= -lim && b[0] <= lim && b[3] >= -lim && b[1] <= lim;
  }
  function bboxInside(b, lim) {
    return b[0] >= -lim && b[2] <= lim && b[1] >= -lim && b[3] <= lim;
  }

  /**
   * 批量净化。整块在正方形外的直接丢掉；完整落在正方形内的原样返回（省掉
   * 「投影→反投影」的精度损失，也保留原对象标识）；跨越边界的才重建几何。
   */
  function sanitizeVectorFeatures(features, crs) {
    var lim = polarLim();
    var proj = crs.projection;
    var lon0 = centralLng(proj);
    var stat = { total: features.length, kept: 0, dropped: 0, clipped: 0, hit: 0 };
    var out = [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      var g = f && f.geometry;
      if (!g || !g.type) continue;
      if (g.type === "Point" || g.type === "MultiPoint") {
        out.push(f);
        stat.kept++;
        continue;
      }
      var r = sanitizeGeometry(g, proj, lon0, lim, stat);
      if (!r.geom) {
        stat.dropped++;
        continue;
      }
      stat.kept++;
      if (r.fullyIn) {
        out.push(f);
      } else {
        stat.clipped++;
        out.push(Object.assign({}, f, { geometry: r.geom }));
      }
    }
    return { features: out, stat: stat };
  }

  /** 立体投影下的点过滤：投影坐标超出半径的直接丢掉（另一个半球会飞到极远处） */
  function keepInPolar(features, crs) {
    var lim = cfg.maxProjected || polarLim();
    var proj = crs.projection;
    var out = [];
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      var g = f && f.geometry;
      if (!g || !g.coordinates) continue;
      var pts = g.type === "MultiPoint" ? g.coordinates : [g.coordinates];
      var keep = [];
      for (var j = 0; j < pts.length; j++) {
        var c = pts[j];
        if (!c || c.length < 2) continue;
        var p = proj.project(L.latLng(c[1], c[0]));
        if (!isFinite(p.x) || !isFinite(p.y)) continue;
        if (Math.abs(p.x) > lim || Math.abs(p.y) > lim) continue;
        keep.push(c);
      }
      if (!keep.length) continue;
      if (g.type === "MultiPoint") {
        if (keep.length === pts.length) out.push(f);
        else out.push(Object.assign({}, f, { geometry: { type: "MultiPoint", coordinates: keep } }));
      } else {
        out.push(f);
      }
    }
    return out;
  }

  /** 弹窗：与主视图同一套内容，但挂在极地地图上 */
  function openFeaturePopup(m, feature, latlng, content, layerId, layerName) {
    if (!content) return null;
    var popup = L.popup({ maxWidth: 300 }).setLatLng(latlng).setContent(content);
    popup._featureRef = feature;
    popup._ogvLayerId = layerId;
    popup._ogvLayerName = layerName || "";
    popup.openOn(m);
    return popup;
  }

  function isDrawing() {
    return !!(
      window.OGVMeasureTools &&
      typeof window.OGVMeasureTools.isDrawing === "function" &&
      window.OGVMeasureTools.isDrawing()
    );
  }

  function popupHandler(m, feature, layerId, layerName, st) {
    return function (e) {
      if (isDrawing()) return;
      var ll =
        (e && e.latlng) ||
        (e && e.target && e.target.getLatLng && e.target.getLatLng()) ||
        feature._ogvLatLng;
      if (!ll) return;
      var fileName = feature._fileName || layerId;
      var content = window.GeoUtils.buildPopupContent(
        feature,
        fileName,
        st.labelField,
        layerName,
      );
      if (!content) return;
      openFeaturePopup(m, feature, ll, content, layerId, layerName);
    };
  }

  function clusterIconFactory(st) {
    return function (cluster) {
      var count = cluster.getChildCount();
      if (st.icon && L.GeoMarker.isExternalPath(st.icon)) {
        return L.GeoMarker.createCustomClusterIcon(st.icon, st.color, count);
      }
      return L.GeoMarker.getClusterIconForType(st.icon, st.color, count);
    };
  }

  function svgIconImage(iconType, size, color, onReady) {
    if (!iconType) return null;
    try {
      var fn = L.GeoMarker.getIconFactory(iconType, size);
      if (!fn) return null;
      var html = fn(color).options.html || "";
      if (!html) return null;
      var img = new Image();
      // 图标是异步解码的：不进 onload 回调的话，Canvas 第一帧画不出图标
      if (onReady) {
        img.onload = function () {
          onReady();
        };
      }
      img.src =
        "data:image/svg+xml;base64," +
        btoa(unescape(encodeURIComponent(html)));
      return img;
    } catch (e) {
      return null;
    }
  }

  function renderPointLayer(m, entry, st, crs) {
    var features = keepInPolar(entry.features, crs);
    if (!features.length) return null;
    var labelOn = window._ogv_getLabelEnabled
      ? window._ogv_getLabelEnabled()
      : false;
    var clusterOn = window._ogv_getClusterEnabled
      ? window._ogv_getClusterEnabled()
      : true;
    var useCanvas = features.length > (cfg.canvasThreshold || 3000);

    if (useCanvas && L.markersCanvas) {
      var arr = [];
      for (var i = 0; i < features.length; i++) {
        var f = features[i];
        var c = f.geometry.coordinates;
        arr.push({
          lat: c[1],
          lng: c[0],
          color: featureColor(f, f._featureIndex || i, st),
          _idx: f._featureIndex || i,
          properties: f.properties || null,
        });
      }
      var canvasLayer = L.markersCanvas({
        clustering: clusterOn,
        iconSize: st.iconSize,
        opacity: st.opacity,
        onFeatureClick: function (pt, latlng) {
          if (isDrawing()) return;
          var feat = {
            type: "Feature",
            properties: pt.properties || {},
            geometry: { type: "Point", coordinates: [pt.lng, pt.lat] },
            _featureIndex: pt._idx,
            _fileName: entry.features[0] && entry.features[0]._fileName,
          };
          var content = window.GeoUtils.buildPopupContent(
            feat,
            feat._fileName || entry.id,
            st.labelField,
            entry.name,
          );
          openFeaturePopup(m, feat, latlng, content, entry.id, entry.name);
        },
      });
      // 图标解码完成后重画一帧（首帧时 Image 还没 load 会画不出图标）
      canvasLayer.options.iconImage = svgIconImage(
        st.icon,
        st.iconSize,
        st.color,
        function () {
          if (canvasLayer._map) canvasLayer._redraw(true);
        },
      );
      canvasLayer.setFeatures(arr, m);
      m.addLayer(canvasLayer);
      return canvasLayer;
    }

    var markers = [];
    var geoLayer = L.geoJSON(
      { type: "FeatureCollection", features: features },
      {
        pointToLayer: function (feature, latlng) {
          var idx = feature._featureIndex || 0;
          var labelText = labelOn
            ? (feature.properties || {})[st.labelField || "Name"] || ""
            : null;
          var marker = L.GeoMarker.createPointMarkerByType(
            m,
            feature,
            latlng,
            featureColor(feature, idx, st),
            labelText,
            st.icon,
            st.iconSize,
            st.opacity,
          );
          marker.on("click", popupHandler(m, feature, entry.id, entry.name, st));
          return marker;
        },
      },
    );
    geoLayer.eachLayer(function (l) {
      markers.push(l);
    });
    if (clusterOn && L.markerClusterGroup) {
      var group = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: clusterIconFactory(st),
      });
      group.addLayers(markers);
      m.addLayer(group);
      return group;
    }
    m.addLayer(geoLayer);
    return geoLayer;
  }

  function renderVectorLayer(m, entry, st, crs) {
    // ⚠️ 必须先净化：全球性面/线图层横跨两个半球，未裁剪的几何会被投到极远处，
    //    Leaflet 在屏幕空间裁剪后得到整屏纯色填充（详见上方「投影空间净化」）。
    var clean = sanitizeVectorFeatures(entry.features, crs);
    state.geomStat[entry.id] = clean.stat;
    var layer = L.geoJSON(
      { type: "FeatureCollection", features: clean.features },
      {
        style: function (feature) {
          var col = featureColor(feature, feature._featureIndex || 0, st);
          return {
            color: col,
            weight: 1.6,
            opacity: st.opacity,
            fillColor: col,
            fillOpacity: Math.min(st.opacity, 0.45),
          };
        },
      },
    );
    layer.eachLayer(function (l) {
      if (!l.feature) return;
      l.on("click", popupHandler(m, l.feature, entry.id, entry.name, st));
    });
    m.addLayer(layer);
    return layer;
  }

  function clearDataLayers(m) {
    state.dataLayers.forEach(function (l) {
      try {
        m.removeLayer(l);
      } catch (e) {}
    });
    state.dataLayers = [];
  }

  function renderDataLayers(m) {
    clearDataLayers(m);
    var crs = m.options.crs;
    var entries = checkedLayers();
    var drawn = 0;
    var total = 0;
    entries.forEach(function (entry) {
      var st = layerStyle(entry.id);
      var geom = mainGeomType(entry.features);
      var isPoint = geom === "point" || geom === "multipoint";
      var layer = isPoint
        ? renderPointLayer(m, entry, st, crs)
        : renderVectorLayer(m, entry, st, crs);
      if (layer) {
        state.dataLayers.push(layer);
        drawn++;
        total += entry.features.length;
      }
    });
    if (!drawn) {
      setHint("未勾选任何数据图层（在左侧面板勾选后会同步到这里）");
    } else {
      setHint("已渲染 " + drawn + " 个图层 / " + total.toLocaleString() + " 个要素");
    }
  }

  // ==================================================================
  // 地图生命周期
  // ==================================================================
  function teardownMap() {
    if (state.map) {
      var old = state.map;
      // 先摘图层再销毁地图，避免 Leaflet 在 remove() 里遍历残留引用
      state.dataLayers.forEach(function (l) {
        try {
          old.removeLayer(l);
        } catch (e) {}
      });
      state.baseLayer = null;
      try {
        old.remove();
      } catch (e) {}
    }
    state.dataLayers = [];
    state.map = null;
    state.baseLayer = null;
  }

  /**
   * 修正极地地图的 `getBounds()`。
   *
   * ⚠️ Leaflet 原生实现只取视口的**两个对角点**：
   *      `new LatLngBounds(unproject(pixelBounds.getBottomLeft()),
   *                        unproject(pixelBounds.getTopRight()))`
   *    立体投影下这条路径会坏：极点若落在视口中心（默认视野就是这样），
   *    **视口四角到极点的距离完全相等** → 两角纬度相同 → 返回一个高度为 0 的
   *    「纬度环带」。后果是**所有**用 getBounds() 做视口裁剪的地方都把要素判成
   *    「不在视野内」而整批丢弃：
   *      · MarkerClusterGroup._getExpandedVisibleBounds → 点要素一个都不显示
   *      · MarkersCanvas 的 RBush 视口查询 → Canvas 渲染同样空白
   *      · 大图层的视口过滤 → 数据像是没加载
   *    而且它调的是 `.pad(1)`（按比例放大），对 0 高度毫无作用 —— 没法靠 pad 兜。
   *
   * 正确做法是在**像素空间**按矩形采一个网格（极点一定在矩形内部，不在采样点上
   * 也不会被漏掉，见下面的极点特判），再取真实的纬度极值：
   *   · 纬度只取决于「到极点的距离」，所以矩形内的极值必然落在采样网格上；
   *   · 经度在**极点落进视口**时会绕满 360°，LatLngBounds 表达不了「整圈」，
   *     只能显式写成 -180~180，否则会漏掉比如 -160° 这种「起点附近」的经度。
   * 缓存在同一视野内复用（getBounds 会被 mousemove 级别的代码反复调用）。
   */
  function patchBounds(m, mode) {
    var cacheKey = null;
    var cacheVal = null;
    var N = 4; // 4×4 分格 → 5×5 采样点
    m.getBounds = function () {
      // 未加载时 _pixelOrigin 还不存在；宁给一个「全收纳」的框，也别让裁剪误杀
      if (!this._loaded) return L.latLngBounds([[-90, -180], [90, 180]]);

      var pb = this.getPixelBounds(); // 绝对像素坐标（已含平移）
      var zoom = this.getZoom();
      var crs = this.options.crs;
      // 投影原点（极点）落在哪个像素：transformation 的偏移量就是 ±半边长
      var o = crs.options.origin || [0, 0];
      var s = crs.scale(zoom);
      var pole = L.point(s * -o[0], s * o[1]);

      var key =
        pb.min.x + "," + pb.min.y + "," + pb.max.x + "," + pb.max.y + "," + zoom;
      if (key === cacheKey) return cacheVal;

      var minLat = Infinity,
        maxLat = -Infinity,
        minLng = Infinity,
        maxLng = -Infinity;
      var self = this;
      function consider(x, y) {
        var ll = self.unproject(L.point(x, y), zoom);
        if (!ll || !isFinite(ll.lat) || !isFinite(ll.lng)) return;
        if (ll.lat < minLat) minLat = ll.lat;
        if (ll.lat > maxLat) maxLat = ll.lat;
        if (ll.lng < minLng) minLng = ll.lng;
        if (ll.lng > maxLng) maxLng = ll.lng;
      }
      for (var i = 0; i <= N; i++) {
        var x = pb.min.x + ((pb.max.x - pb.min.x) * i) / N;
        for (var j = 0; j <= N; j++) {
          var y = pb.min.y + ((pb.max.y - pb.min.y) * j) / N;
          consider(x, y);
        }
      }

      // 极点落在视口内 → 纬度极值就在极点上，经度必然是整圈
      if (pb.contains(pole)) {
        if (mode === "south") minLat = -90;
        else maxLat = 90;
        minLng = -180;
        maxLng = 180;
      }

      if (!isFinite(minLat) || !isFinite(minLng)) {
        cacheVal = L.latLngBounds([[-90, -180], [90, 180]]);
      } else {
        cacheVal = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
      }
      cacheKey = key;
      return cacheVal;
    };
  }

  function createMap(mode) {
    var m = L.map(dom.mapEl, {
      crs: polarCrs(mode),
      minZoom: 0,
      maxZoom: maxZoomFor(mode),
      zoomSnap: 0, // 与主视图一致的无级缩放
      zoomDelta: 1,
      zoomControl: true,
      // 右下角版权条默认不显示（POLAR_CONFIG.showAttribution）：
      // 极地视图左上角已有标题栏 + 底图下拉，版权条在那里只是噪声。
      attributionControl: !!cfg.showAttribution,
      worldCopyJump: false, // 立体投影没有横向环绕
    });
    // 立体投影下原生 getBounds() 会退化成一条纬度线，见函数注释
    patchBounds(m, mode);
    // 让 geojsonloader 的弹窗扩展按钮（缩放至 / 详情）在极地地图上也能工作
    if (typeof window._ogvTrackPopups === "function") {
      window._ogvTrackPopups(m);
    }
    if (cfg.showScale) {
      L.control.scale({ imperial: false, position: "bottomleft" }).addTo(m);
    }
    // 中心钳制：立体投影平面是无限的，不限一下会一路平移到空白区
    m.on("moveend zoomend", function () {
      clampCenter(m, mode);
    });
    return m;
  }

  function applyBasemap(m, name, mode) {
    if (state.baseLayer) {
      try {
        m.removeLayer(state.baseLayer);
      } catch (e) {}
      state.baseLayer = null;
    }
    var layer = buildBasemap(name, mode);
    if (!layer) return false;
    layer.addTo(m);
    state.baseLayer = layer;
    state.baseName = name;
    if (S && S.KEY && S.KEY.POLAR_BASEMAP) S.safeSet(S.KEY.POLAR_BASEMAP, name);
    return true;
  }

  function fillSelect(mode) {
    if (!dom.select) return;
    var list = basemapList();
    dom.select.textContent = "";
    list.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = d.name;
      opt.textContent = d.name;
      dom.select.appendChild(opt);
    });
    var current =
      (S && S.KEY && S.KEY.POLAR_BASEMAP && S.safeGet(S.KEY.POLAR_BASEMAP)) ||
      cfg.defaultBasemap;
    if (!basemapDesc(current)) current = cfg.defaultBasemap;
    dom.select.value = current;
    return current;
  }

  function syncModeButtons(mode) {
    if (!dom.modeBtns) return;
    for (var i = 0; i < dom.modeBtns.length; i++) {
      var b = dom.modeBtns[i];
      var on = b.getAttribute("data-polar-mode") === mode;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("is-active", on);
    }
    if (dom.title) {
      dom.title.textContent = "极地投影 · " + modeCfg(mode).label;
    }
  }

  function open(mode) {
    if (!cacheDom()) {
      console.warn("[polar] #polarView / #polarMap 不存在，无法打开极地视图");
      return false;
    }
    var saved = S && S.KEY && S.KEY.POLAR_MODE ? S.safeGet(S.KEY.POLAR_MODE) : null;
    mode = mode || saved || "north";
    if (!cfg.modes[mode]) mode = "north";

    // 与 3D 互斥：走开关 + change 事件，保证 UI 状态一致
    var v3 = document.getElementById("view3dToggle");
    if (v3 && v3.checked) {
      v3.checked = false;
      v3.dispatchEvent(new Event("change", { bubbles: true }));
    }

    document.body.classList.add("polar-active");
    teardownMap();

    state.mode = mode;
    state.open = true;
    var m = createMap(mode);
    state.map = m;
    // 容器刚从 display:none 变可见 → 先量尺寸再定位，否则会是 0×0
    m.invalidateSize(false);

    var name = fillSelect(mode);
    applyBasemap(m, name, mode);

    var view = modeCfg(mode).view || [80, -45, 2];
    m.setView([view[0], view[1]], view[2] == null ? 2 : view[2]);

    syncModeButtons(mode);
    renderDataLayers(m);
    if (S && S.KEY && S.KEY.POLAR_MODE) S.safeSet(S.KEY.POLAR_MODE, mode);
    return true;
  }

  /**
   * 把地图中心钳制在极地网格正方形内。
   *
   * ⚠️ 刻意不用 `map.setMaxBounds(latLngBounds)`：Leaflet 的 `_getBoundsOffset`
   *    是拿 maxBounds 的「东北角 / 西南角」各自投影再比对的，而立体投影下经纬度
   *    的东北/西南角根本不在正方形的角上 —— 结果是把可平移范围算成四分之一，
   *    地图会变得推不动。改成在 moveend 里直接对中心点的投影坐标做钳制，
   *    物理意义明确，也不受 CRS 影响。
   */
  function clampCenter(m, mode) {
    var b = (modeCfg(mode).bounds) || [-4194304, -4194304, 4194304, 4194304];
    var pad = 0.03;
    var dx = (b[2] - b[0]) * pad;
    var dy = (b[3] - b[1]) * pad;
    var proj = m.options.crs.projection;
    var c = proj.project(m.getCenter());
    if (!isFinite(c.x) || !isFinite(c.y)) {
      var v = modeCfg(mode).view || [80, -45, 2];
      m.setView([v[0], v[1]], v[2] == null ? 2 : v[2]);
      return;
    }
    var x = Math.min(b[2] + dx, Math.max(b[0] - dx, c.x));
    var y = Math.min(b[3] + dy, Math.max(b[1] - dy, c.y));
    if (x === c.x && y === c.y) return;
    m.panTo(proj.unproject(L.point(x, y)), { animate: false });
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    teardownMap();
    document.body.classList.remove("polar-active");
    // 主地图刚从 display:none 回来，Leaflet 需要重新量一次尺寸
    if (window.map && typeof window.map.invalidateSize === "function") {
      try {
        window.map.invalidateSize(false);
      } catch (e) {}
    }
  }

  function setMode(mode) {
    if (!cfg.modes[mode]) return;
    if (!state.open) return open(mode);
    open(mode);
  }

  function setBasemap(name) {
    if (!state.open || !state.map) return;
    applyBasemap(state.map, name, state.mode);
    if (dom.select && dom.select.value !== name) dom.select.value = name;
  }

  /** 面板勾选 / 聚类 / 标签变化后重建极地图层 */
  function refresh() {
    if (!state.open || !state.map) return;
    renderDataLayers(state.map);
  }

  function scheduleRefresh() {
    if (!state.open) return;
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(function () {
      state.refreshTimer = 0;
      refresh();
    }, 180);
  }

  // ==================================================================
  // 事件接线
  // ==================================================================
  function wire() {
    if (!cacheDom()) return;
    dom.root.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("[data-polar-mode]") : null;
      if (btn) {
        setMode(btn.getAttribute("data-polar-mode"));
        return;
      }
      var closeBtn = ev.target.closest ? ev.target.closest("#polarClose") : null;
      if (closeBtn) {
        if (window.toggleConfig && window.toggleConfig.polarToggle) {
          var cb = document.getElementById("polarToggle");
          if (cb) {
            cb.checked = false;
            cb.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else {
          close();
        }
      }
    });
    if (dom.select) {
      dom.select.addEventListener("change", function () {
        setBasemap(dom.select.value);
      });
    }
    // 面板里的图层勾选 / 全局聚类与标签开关 → 同步重建
    document.addEventListener("change", function (ev) {
      if (!state.open) return;
      var t = ev.target;
      if (!t || !t.id) return;
      if (
        /^layer_/.test(t.id) ||
        t.id === "clusterToggle" ||
        t.id === "labelToggle"
      ) {
        scheduleRefresh();
      }
    });
  }

  window.PolarView = {
    open: open,
    close: close,
    setMode: setMode,
    setBasemap: setBasemap,
    refresh: refresh,
    isOpen: function () {
      return state.open;
    },
    mode: function () {
      return state.mode;
    },
    /** 供调试 / 自动化测试直接拿到极地地图实例 */
    _map: function () {
      return state.map;
    },
    /** 供调试 / 自动化测试读取内部状态 */
    _state: function () {
      var crs = state.map ? state.map.options.crs : null;
      var WW = window.L && window.L.WorldWrap;
      return {
        open: state.open,
        mode: state.mode,
        hasMap: !!state.map,
        basemap: state.baseName,
        dataLayers: state.dataLayers.length,
        crs: crs ? crs.code : null,
        // 立体投影没有 wrapLng → 世界副本周期为 0（自动关闭）
        wrapLng: crs && crs.options ? crs.options.wrapLng || null : null,
        wrapPeriod: crs && WW ? WW.periodProjected(crs) : null,
        zoom: state.map ? state.map.getZoom() : null,
        // 矢量净化统计：记录每个图层被丢掉 / 被裁剪的要素数（画错时先看这个）
        geomStat: state.geomStat,
      };
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
