/**
 * Leaflet.MarkersCanvas.js v1.4
 * Leaflet 插件：纯 Canvas 渲染 + 距离聚类，零 DOM 节点，支持 45 万+ 点
 *
 * 依赖：Leaflet（全局 L，需在 leaflet.js 之后引入）
 *        RBush（全局 RBush，需在 rbush.js 之后引入）
 *
 * 用法：
 *   const layer = L.markersCanvas({ clustering: true }).addTo(map);
 *   layer.setFeatures(featuresArray);
 *
 * Options:
 *   clusterDistance: 100   - 聚类距离阈值（屏幕像素）
 *   clusterMaxZoom: 14     - 此 zoom 以下显示聚类
 *   clusterFont: "bold 11px sans-serif"
 *   onFeatureClick: null    - fn(feature, latlng)
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

  // ─────────────────────────────────────────────
  //  网格预聚合聚类（O(n)，比 DBSCAN 快百倍）
  //  按 clusterRadius 划分网格，同格内点聚合
  // ─────────────────────────────────────────────
  // ── 网格预聚合聚类（O(n)，比 DBSCAN 快百倍）────────────────────────
  //  1. 按 cellSize 划分网格（cellSize = clusterRadius/2，保证邻格补漏）
  //  2. 每格内点聚合；额外查询周围一圈邻格，防止格子边缘的点被切分
  function computeClusters(features, indices, map, clusterRadiusPixels) {
    if (!indices.length) return [];

    var cellSize = Math.max(Math.floor(clusterRadiusPixels / 2), 1); // 50px（阈值100时）
    var grid = Object.create(null); // key: "gx,gy" → { pts: [], cx: 0, cy: 0 }

    // ── 阶段1：单次遍历，全部归入网格 ──
    for (var i = 0; i < indices.length; i++) {
      var f = features[indices[i]];
      if (!f) continue;
      var pt = map.latLngToContainerPoint([f.lat, f.lng]);
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
      this._tree = new RBush();
      this._hitTree = new RBush();
      this._lastClusters = null;
      this._redraw(true);
    },

    /** 仅更新颜色等属性，不重建空间索引（坐标未变时使用，性能提升 10x） */
    updateColors: function () {
      this._redraw(true);
    },

    /** 设置原始要素（不创建任何 L.Marker 对象） */
    setFeatures: function (features) {
      this._features = features;
      this._tree = new RBush();
      var items = [];
      for (var i = 0; i < features.length; i++) {
        var f = features[i];
        items.push({
          minX: f.lng,
          minY: f.lat,
          maxX: f.lng,
          maxY: f.lat,
          idx: i,
        });
      }
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

    // ── 核心：渲染（含聚类）──
    _redraw: function (clear) {
      if (!this._ctx || !this._map) return;
      if (clear) {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
      }
      if (!this._features || !this._features.length) return;

      var ctx = this._ctx;
      var map = this._map;
      var zoom = map.getZoom();
      var bounds = map.getBounds();

      // 1. 查询视口内要素
      var visible = this._tree.search({
        minX: bounds.getWest(),
        minY: bounds.getSouth(),
        maxX: bounds.getEast(),
        maxY: bounds.getNorth(),
      });
      if (!visible.length) return;

      var indices = visible.map(function (v) {
        return v.idx;
      });

      // 2. 是否使用聚类（由 clustering 选项 + clusterMaxZoom 共同控制）
      var zoom = map.getZoom();
      var useCluster =
        this.options.clustering && zoom <= this.options.clusterMaxZoom;

      var drawUnits;
      if (useCluster) {
        drawUnits = computeClusters(
          this._features,
          indices,
          map,
          this._getClusterRadiusInPixels(),
        );
      } else {
        // 不聚类：直接绘制所有可见点（Canvas 绘制比 DOM 快几个数量级）
        drawUnits = indices
          .map(
            function (idx) {
              var f = this._features[idx];
              if (!f) return null;
              var pt = map.latLngToContainerPoint([f.lat, f.lng]);
              return {
                x: pt.x,
                y: pt.y,
                color: f.color || "#3388ff",
                idx: idx,
              };
            }.bind(this),
          )
          .filter(Boolean);
      }

      // 3. 绘制 + 构建点击检测树
      var hitItems = [];
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

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

      this._hitTree = new RBush();
      this._hitTree.load(hitItems);
      this._lastClusters = drawUnits;
    },

    // ── 事件：点击 / 悬停检测 ──
    _fire: function (e) {
      if (!this._hitTree) return;
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
            map.setView(clusterLatLng, targetZoom);
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
      var tl = this._map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(this._canvas, tl);
      this._updateCanvasResolution();
      this._redraw();
    },

    _animateZoom: function (e) {
      var scale = this._map.getZoomScale(e.zoom);
      var offset = this._map._latLngBoundsToNewLayerBounds(
        this._map.getBounds(),
        e.zoom,
        e.center,
      ).min;
      L.DomUtil.setTransform(this._canvas, offset, scale);
    },
  });

  // 挂载到 L，与 leaflet.markercluster 风格一致
  L.MarkersCanvas = MarkersCanvas;
  L.markersCanvas = function (opts) {
    return new L.MarkersCanvas(opts);
  };
})();
