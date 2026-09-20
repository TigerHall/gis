/**
 * Leaflet.MarkersCanvas.js v2.0
 * Leaflet 插件：纯 Canvas 渲染 + 距离聚类，零 DOM 节点，支持 45 万+ 点
 *
 * 依赖：Leaflet（全局 L，需在 leaflet.js 之后引入）
 *        RBush（全局 RBush，需在 rbush.js 之后引入）
 *        Leaflet.WorldWrap.js（世界副本 / 投影空间工具）
 *
 * 用法：
 *   const layer = L.markersCanvas({ clustering: true }).addTo(map);
 *   layer.setFeatures(featuresArray, map);
 *
 * Options:
 *   clusterDistance: 100   - 聚类距离阈值（屏幕像素）
 *   clusterMaxZoom: 14     - 此 zoom 以下显示聚类
 *   clusterFont: "bold 11px sans-serif"
 *   onFeatureClick: null    - fn(feature, latlng)
 *
 * ── v2.0 改动（渲染层世界副本 + 极地可用的视口裁剪）──────────────
 * 1. 空间索引从「经纬度空间」搬到「投影空间」（crs.projection.project 的结果）。
 *    这样一来视口查询矩形可以由像素矩形做**仿射逆变换**精确得到，不再依赖
 *    map.getBounds() —— 后者在极地投影（EPSG:3413/3031）下是退化的（实测返回
 *    s=31.35 > n=31，完全不含极点），一旦依赖它，极地视图下会一点都画不出来。
 * 2. 无限世界环绕：_redraw 按「当前屏幕上可见的世界」循环查询 + 绘制。
 *    正本数据只有 1 份、坐标永远 -180~180，副本纯属绘制行为，和瓦片一致，
 *    份数不设上限。于是「点数 > 3000 就不做副本」那个妥协可以直接删掉。
 * 3. 逐点绘制改走「一次取出仿射系数 + 逐点算术」的快路径。原先每点调一次
 *    map.latLngToContainerPoint()，在极地投影下等于每点跑一次 proj4 前向变换，
 *    45 万点会直接卡死；改成预投影一次（setFeatures 时）+ 每帧纯算术。
 */
(function () {
  "use strict";

  if (typeof L === "undefined") {
    throw new Error(
      "Leaflet (L) is required. Include leaflet.js before this plugin.",
    );
  }
  if (typeof RBush === "undefined") {
    throw new Error("RBush is required. Include rbush.js before this plugin.");
  }
  if (typeof L.WorldWrap === "undefined") {
    throw new Error(
      "Leaflet.WorldWrap is required. Include Leaflet.WorldWrap.js before this plugin.",
    );
  }
  var WW = L.WorldWrap;

  // ─────────────────────────────────────────────
  //  网格预聚合聚类（O(n)，比 DBSCAN 快百倍）
  //  按 clusterRadius 划分网格，同格内点聚合
  // ─────────────────────────────────────────────
  // ── 网格预聚合聚类（O(n)，比 DBSCAN 快百倍）────────────────────────
  //  1. 按 cellSize 划分网格（cellSize = clusterRadius/2，保证邻格补漏）
  //  2. 每格内点聚合；额外查询周围一圈邻格，防止格子边缘的点被切分
  //
  //  pointOf(idx) → {x, y} 容器像素。调用方按「某一个世界副本」给出，
  //  所以每个副各自独立聚类 —— 与瓦片各画各的语义一致。
  function computeClusters(features, indices, pointOf, clusterRadiusPixels) {
    if (!indices.length) return [];

    var cellSize = Math.max(Math.floor(clusterRadiusPixels / 2), 1); // 50px（阈值100时）
    var grid = Object.create(null); // key: "gx,gy" → { pts: [], cx: 0, cy: 0 }

    // ── 阶段1：单次遍历，全部归入网格 ──
    for (var i = 0; i < indices.length; i++) {
      var f = features[indices[i]];
      if (!f) continue;
      var pt = pointOf(indices[i]);
      var gx = Math.floor(pt.x / cellSize);
      var gy = Math.floor(pt.y / cellSize);
      var key = gx + "," + gy;

      if (!grid[key]) {
        grid[key] = { pts: [], cx: 0, cy: 0 };
      }
      var cell = grid[key];
      cell.pts.push({
        x: pt.x,
        y: pt.y,
        color: f.color || "#3388ff",
        featureIdx: indices[i],
      });
      cell.cx += pt.x;
      cell.cy += pt.y;
    }

    // ── 阶段2：合并邻格（防止格子边界切开本应聚合的点）──
    //  用 deleted Set 追踪已合并的格子，避免遍历中删除导致的 undefined 访问
    var deleted = Object.create(null); // key → true
    var keys = Object.keys(grid);
    for (var ki = 0; ki < keys.length; ki++) {
      var mainKey = keys[ki];
      if (deleted[mainKey]) continue;
      var mainCell = grid[mainKey];
      var parts = mainKey.split(",");
      var gx = parseInt(parts[0], 10);
      var gy = parseInt(parts[1], 10);

      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          var nkey = gx + dx + "," + (gy + dy);
          if (deleted[nkey] || !grid[nkey]) continue;
          var neighbor = grid[nkey];
          var ccx = mainCell.cx / mainCell.pts.length;
          var ccy = mainCell.cy / mainCell.pts.length;
          var ncX = neighbor.cx / neighbor.pts.length;
          var ncY = neighbor.cy / neighbor.pts.length;
          var distX = ncX - ccx;
          var distY = ncY - ccy;
          if (
            distX * distX + distY * distY <=
            clusterRadiusPixels * clusterRadiusPixels
          ) {
            for (var nj = 0; nj < neighbor.pts.length; nj++) {
              mainCell.pts.push(neighbor.pts[nj]);
              mainCell.cx += neighbor.pts[nj].x;
              mainCell.cy += neighbor.pts[nj].y;
            }
            deleted[nkey] = true;
          }
        }
      }
    }

    // ── 阶段3：输出结果 ──
    var results = [];
    for (var k = 0; k < keys.length; k++) {
      if (deleted[keys[k]]) continue;
      var cell = grid[keys[k]];
      var count = cell.pts.length;
      var cx = cell.cx / count;
      var cy = cell.cy / count;

      if (count === 1) {
        results.push({
          x: cell.pts[0].x,
          y: cell.pts[0].y,
          color: cell.pts[0].color,
          idx: cell.pts[0].featureIdx,
        });
      } else {
        var featIndices = new Array(count);
        for (var j = 0; j < count; j++) {
          featIndices[j] = cell.pts[j].featureIdx;
        }
        results.push({
          x: cx,
          y: cy,
          count: count,
          indices: featIndices,
          color: cell.pts[0].color,
        });
      }
    }

    return results;
  }

  // ─────────────────────────────────────────────
  //  Leaflet 插件定义（标准格式，与 markercluster 一致）
  // ─────────────────────────────────────────────
  var MarkersCanvas = L.Layer.extend({
    options: {
      clustering: true,
      clusterDistance: 100, // 聚类距离阈值（屏幕像素）
      clusterMaxZoom: 14, // 此 zoom 以下显示聚类
      clusterFont: "bold 11px sans-serif",
      onFeatureClick: null, // fn(feature, latlng)
      iconImage: null, // 预加载的 Image 对象（自定义图标，单色模式）
      iconImages: null, // { colorHex → Image } 映射（多颜色模式）
      iconSize: 20, // 图标像素尺寸
    },

    // ── Leaflet 生命周期 ──
    initialize: function (options) {
      L.Util.setOptions(this, options);
      this._tree = new RBush();
      this._hitTree = new RBush();
      this._px = null; // Float64Array：预投影坐标 [x0,y0,x1,y1,...]（投影空间）
      this._dataRect = null; // 数据在投影空间的外接矩形（算世界副本用）
    },

    onAdd: function (map) {
      this._map = map;
      this._initCanvas();
      this.getPane().appendChild(this._canvas);
      map.on("moveend", this._reset, this);
      map.on("resize", this._reset, this);
      map.on("click", this._fire, this);
      map.on("mousemove", this._fire, this);
      map.on("mouseout", this._onMouseOut, this);
      if (map._zoomAnimated) map.on("zoomanim", this._animateZoom, this);
      // setFeatures 可能在 addTo 之前调用，此时 _map 为 null 导致 _redraw 跳过
      // 这里补一次渲染，确保数据加载后立即显示
      if (this._features && this._features.length) {
        this._redraw(true);
      }
    },

    onRemove: function (map) {
      if (this._canvas && this._canvas.parentNode) {
        this._canvas.parentNode.removeChild(this._canvas);
      }
      map.off("click", this._fire, this);
      map.off("mousemove", this._fire, this);
      map.off("mouseout", this._onMouseOut, this);
      map.off("moveend", this._reset, this);
      map.off("resize", this._reset, this);
      if (map._zoomAnimated) map.off("zoomanim", this._animateZoom, this);
    },

    // ── 公共 API ──
    addTo: function (map) {
      map.addLayer(this);
      return this;
    },

    redraw: function () {
      this._redraw(true);
    },

    clear: function () {
      this._features = null;
      this._px = null;
      this._dataRect = null;
      this._tree = new RBush();
      this._hitTree = new RBush();
      this._lastClusters = null;
      this._redraw(true);
    },

    /** 仅更新颜色等属性，不重建空间索引（坐标未变时使用，性能提升 10x） */
    updateColors: function () {
      this._redraw(true);
    },

    /** 设置原始要素（不创建任何 L.Marker 对象）
     *  @param features  [{ lat, lng, color, _idx, properties }]
     *  @param map       投影基准地图；省略则用 this._map（若 setFeatures 早于 addTo，
     *                   必须显式传入 —— 预投影要按该地图的 CRS 做）
     */
    setFeatures: function (features, map) {
      this._features = features;
      this._tree = new RBush();
      if (!features || !features.length) {
        this._px = null;
        this._dataRect = null;
        this._redraw(true);
        return;
      }

      var m = map || this._map;
      var crs = m && m.options ? m.options.crs : null;
      var n = features.length;
      var px = new Float64Array(n * 2);
      var items = new Array(n);
      var minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (var i = 0; i < n; i++) {
        var f = features[i];
        var x = 0,
          y = 0;
        if (crs && crs.projection && f) {
          try {
            var p = crs.projection.project(L.latLng(f.lat, f.lng));
            x = p.x;
            y = p.y;
          } catch (e) {
            x = 0;
            y = 0;
          }
        }
        if (!isFinite(x)) x = 0;
        if (!isFinite(y)) y = 0;
        px[i * 2] = x;
        px[i * 2 + 1] = y;
        items[i] = { minX: x, minY: y, maxX: x, maxY: y, idx: i };
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      this._px = px;
      this._dataRect = { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
      this._tree.load(items);
      this._redraw(true);
    },

    // ── 私有：获取聚类半径（像素）──
    //  clusterDistance 直接以屏幕像素为单位，不受缩放级别影响
    _getClusterRadiusInPixels: function () {
      return this.options.clusterDistance || 100;
    },

    // ── 私有：Canvas 初始化 ──
    _initCanvas: function () {
      var size = this._map.getSize();
      var anim = !!(this._map.options.zoomAnimation && L.Browser.any3d);
      this._canvas = L.DomUtil.create(
        "canvas",
        "leaflet-markers-canvas-layer leaflet-layer",
      );
      this._ctx = this._canvas.getContext("2d");
      L.DomUtil.addClass(
        this._canvas,
        "leaflet-zoom-" + (anim ? "animated" : "hide"),
      );
      // 高清屏适配：根据 devicePixelRatio 放大 Canvas 再用 CSS 缩回
      this._updateCanvasResolution();
    },

    // ── 高清屏分辨率适配 ──
    _updateCanvasResolution: function () {
      var dpr = window.devicePixelRatio || 1;
      this._dpr = dpr;
      var size = this._map.getSize();
      var ctx = this._ctx;

      this._canvas.width = size.x * dpr;
      this._canvas.height = size.y * dpr;
      this._canvas.style.width = size.x + "px";
      this._canvas.style.height = size.y + "px";

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    // ── 核心：渲染（含聚类 + 无限世界副本）──
    _redraw: function (clear) {
      if (!this._ctx || !this._map) return;
      if (clear) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      }
      if (!this._features || !this._features.length || !this._px) return;

      var ctx = this._ctx;
      var map = this._map;
      var zoom = map.getZoom();

      // ── 环绕/投影参数（一次取出，逐点走算术快路径）──
      var inf = WW.info(map);
      if (!inf.ok) return;
      var qRect = WW.viewRectProjected(map, inf);
      if (!qRect || !this._dataRect) return;
      var ks = inf.wraps
        ? WW.ksForRect(inf.period, qRect, this._dataRect, inf.maxK)
        : [0];

      var inf_scale = inf.scale,
        inf_a = inf.a,
        inf_b = inf.b,
        inf_c = inf.c,
        inf_d = inf.d;
      var ox = inf.originX - inf.paneX;
      var oy = inf.originY - inf.paneY;
      var px = this._px;
      var per = inf.period;

      // 投影坐标 → 容器像素（含第 k 个世界的平移）
      function ptx(i, k) {
        return inf_scale * (inf_a * (px[i * 2] + k * per) + inf_b) - ox;
      }
      function pty(i) {
        return inf_scale * (inf_c * px[i * 2 + 1] + inf_d) - oy;
      }

      // ── 是否聚类（clustering 选项 + clusterMaxZoom 共同控制）──
      var useCluster =
        this.options.clustering && zoom <= this.options.clusterMaxZoom;

      var drawUnits = [];
      for (var ki = 0; ki < ks.length; ki++) {
        var k = ks[ki];
        var kx = k * per;

        // 视口内要素：查询矩形按世界反向平移回数据空间
        var visible = this._tree.search({
          minX: qRect.minX - kx,
          minY: qRect.minY,
          maxX: qRect.maxX - kx,
          maxY: qRect.maxY,
        });
        if (!visible.length) continue;

        var idxs = new Array(visible.length);
        for (var v = 0; v < visible.length; v++) idxs[v] = visible[v].idx;

        // 逐点/聚类都走「绑定了 k」的取点函数
        var pointOf = (function (kk) {
          return function (idx) {
            return { x: ptx(idx, kk), y: pty(idx) };
          };
        })(k);

        if (useCluster) {
          var cu = computeClusters(
            this._features,
            idxs,
            pointOf,
            this._getClusterRadiusInPixels(),
          );
          for (var c = 0; c < cu.length; c++) drawUnits.push(cu[c]);
        } else {
          for (var q = 0; q < idxs.length; q++) {
            var idx2 = idxs[q];
            var f2 = this._features[idx2];
            if (!f2) continue;
            var pt2 = pointOf(idx2);
            drawUnits.push({
              x: pt2.x,
              y: pt2.y,
              color: f2.color || "#3388ff",
              idx: idx2,
              world: k,
            });
          }
        }
      }
      if (!drawUnits.length) {
        this._hitTree = new RBush();
        this._lastClusters = drawUnits;
        return;
      }

      // ── 绘制 + 构建点击检测树 ──
      var hitItems = [];
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // 图层不透明度：通过 globalAlpha 让 Canvas 点/聚类整体淡出
      var _savedAlpha = ctx.globalAlpha;
      ctx.globalAlpha = this.options.opacity != null ? this.options.opacity : 1;

      for (var i = 0; i < drawUnits.length; i++) {
        var u = drawUnits[i];

        if (u.count) {
          // 聚类圆：半径随数量动态变化，最大 36px，填充色跟随点位
          var r = Math.min(10 + Math.log2(u.count) * 5, 36);
          ctx.beginPath();
          ctx.fillStyle = u.color || "#3388ff";
          ctx.arc(u.x, u.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = "#fff";
          ctx.font = this.options.clusterFont;
          ctx.fillText(u.count, u.x, u.y);

          hitItems.push({
            minX: u.x - r,
            minY: u.y - r,
            maxX: u.x + r,
            maxY: u.y + r,
            type: "cluster",
            indices: u.indices,
            screenX: u.x,
            screenY: u.y,
          });
        } else {
          // 单点：有自定义图标则绘制图片，否则绘制圆形
          var iconImg = this.options.iconImage;
          // 多颜色模式：按点颜色查找对应的图标 Image
          var colorImages = this.options.iconImages;
          if (colorImages && u.color && colorImages[u.color]) {
            iconImg = colorImages[u.color];
          }
          if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
            var sz = this.options.iconSize || 20;
            // 保持宽高比
            var iw = iconImg.naturalWidth;
            var ih = iconImg.naturalHeight;
            var scale = Math.min(sz / iw, sz / ih);
            var dw = Math.round(iw * scale);
            var dh = Math.round(ih * scale);
            ctx.drawImage(
              iconImg,
              u.x - Math.round(dw / 2),
              u.y - Math.round(dh / 2),
              dw,
              dh,
            );
          } else {
            ctx.beginPath();
            ctx.fillStyle = u.color;
            ctx.arc(u.x, u.y, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          var hitR = 10;
          hitItems.push({
            minX: u.x - hitR,
            minY: u.y - hitR,
            maxX: u.x + hitR,
            maxY: u.y + hitR,
            type: "point",
            idx: u.idx || u.featureIdx,
            screenX: u.x,
            screenY: u.y,
          });
        }
      }

      // 还原 globalAlpha，避免影响其他绘制
      ctx.globalAlpha = _savedAlpha;

      this._hitTree = new RBush();
      this._hitTree.load(hitItems);
      this._lastClusters = drawUnits;
    },

    // ── 事件：点击 / 悬停检测 ──
    _fire: function (e) {
      if (!this._hitTree) return;
      // ── 测量/绘制期间不做要素命中 ──
      // 与 measure-tools.js 的 CSS 屏蔽是同一件事的两个半边。
      // CSS 的 pointer-events:none 只能拦「DOM 层」的点击（marker / 矢量 pane 上的
      // 图标与路径），而本 Canvas 路径是**自己监听 map 的 click/mousemove** 再做
      // RBush 命中检测的 —— 绘制时点击穿透到 .leaflet-container 之后它照旧触发，
      // 后果有三个：
      //   ① 命中点要素 → onFeatureClick → 弹出属性「悬浮窗」，压在光标下把落点挡掉
      //      （用户反馈：「点击下去后优先触发的还是悬浮窗，导致点不了设置点」）
      //   ② 命中聚合簇 → map.setView() 直接跳级缩放，落点全乱
      //   ③ mousemove 命中就把光标改成 pointer，盖掉 Geoman 的十字准星
      // 判定走 measure-tools.js 暴露的 isDrawing()（内部即 pm.globalDrawModeEnabled()，
      // 只在真的点了绘制工具后为真，不会误伤「编辑/拖拽/删除」模式）。
      if (window.OGVMeasureTools && window.OGVMeasureTools.isDrawing()) {
        if (this._map && this._map._container) {
          this._map._container.style.cursor = "";
        }
        return;
      }
      var pt = e.containerPoint;
      var hits = this._hitTree.search({
        minX: pt.x,
        minY: pt.y,
        maxX: pt.x,
        maxY: pt.y,
      });
      if (!hits.length) {
        this._map._container.style.cursor = "";
        return;
      }
      this._map._container.style.cursor = "pointer";

      if (e.type === "click") {
        var hit = hits[0];
        if (hit.type === "cluster" && hit.indices) {
          var map = this._map;
          var currentZoom = map.getZoom();
          var maxZoom = map.getMaxZoom ? map.getMaxZoom() : 21;
          if (currentZoom >= maxZoom) {
            this.options.clustering = false;
            this._redraw();
          } else {
            var targetZoom = Math.min(currentZoom + 2, maxZoom);
            // 放大到 cluster 质心，而非地图中心
            var clusterLatLng = map.containerPointToLatLng(
              L.point(hit.screenX, hit.screenY),
            );
            // ⚠️ 若命中的是「世界副本」上的聚类，这里算出来的经度会是 456 这类
            //    被平移过的值。折回 [-180,180) 后视野完全一致（地图内容是周期性的），
            //    但地图中心/读数不会再出现越界经度。
            map.setView(WW.normalizeLatLng(clusterLatLng), targetZoom);
          }
        } else if (hit.type === "point" && this.options.onFeatureClick) {
          this.options.onFeatureClick(this._features[hit.idx], e.latlng);
        }
      }
    },

    // ── 鼠标离开地图时复位光标 ──
    _onMouseOut: function () {
      if (this._map && this._map._container) {
        this._map._container.style.cursor = "";
      }
    },

    // ── 地图事件 ──
    _reset: function () {
      var map = this._map;
      var tl = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, tl);
      this._updateCanvasResolution();
      // 记录当前中心/层级，供缩放动画用（见 _animateZoom）
      this._center = map.getCenter();
      this._zoom = map.getZoom();
      this._redraw();
    },

    // 缩放动画：容器随缩放做 CSS transform。
    //
    // ⚠️ 这里**不能**沿用 Leaflet 的 _latLngBoundsToNewLayerBounds(map.getBounds(), ...)：
    //    它要读 getBounds() 的 NorthWest/SouthEast，而极地投影下 getBounds() 本身
    //    是退化的（南 > 北），算出来的偏移会错。改用「容器半宽 × 缩放比 + 中心像素」
    //    的纯像素算法（与 L.Renderer._updateTransform 同构），与投影无关。
    _animateZoom: function (e) {
      var map = this._map;
      var scale = map.getZoomScale(e.zoom, this._zoom);
      var viewHalf = map.getSize().multiplyBy(0.5);
      var currentCenterPoint = map.project(this._center || map.getCenter(), e.zoom);
      var topLeftOffset = viewHalf
        .multiplyBy(-scale)
        .add(currentCenterPoint)
        .subtract(map._getNewPixelOrigin(e.center, e.zoom));
      if (!isFinite(topLeftOffset.x) || !isFinite(topLeftOffset.y)) return;
      L.DomUtil.setTransform(this._canvas, topLeftOffset, scale);
    },
  });

  // 挂载到 L，与 leaflet.markercluster 风格一致
  L.MarkersCanvas = MarkersCanvas;
  L.markersCanvas = function (opts) {
    return new L.MarkersCanvas(opts);
  };
})();
