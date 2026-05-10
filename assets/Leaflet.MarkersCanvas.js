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
 *   clusterDistance: 60    - 聚类距离阈值（屏幕像素）
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
  //  距离聚类（屏幕像素空间，RBush 加速）
  //  参考 leaflet.markercluster 的 maxClusterRadius 语义
  // ─────────────────────────────────────────────
  function computeClusters(features, indices, map, clusterRadiusPixels) {
    // 1. 将所有可见点转换成屏幕坐标
    var points = []; // { x, y, color, featureIdx }
    for (var i = 0; i < indices.length; i++) {
      var f = features[indices[i]];
      if (!f) continue;
      var pt = map.latLngToContainerPoint([f.lat, f.lng]);
      points.push({
        x: pt.x,
        y: pt.y,
        color: f.color || "#3388ff",
        featureIdx: indices[i],
      });
    }

    if (points.length === 0) return [];

    // 2. 用 RBush 加速邻近搜索
    var tree = new RBush();
    var treeItems = [];
    for (var j = 0; j < points.length; j++) {
      treeItems.push({
        minX: points[j].x,
        minY: points[j].y,
        maxX: points[j].x,
        maxY: points[j].y,
        idx: j,
      });
    }
    tree.load(treeItems);

    // 3. DBSCAN 风格聚类
    var visited = {};
    var clusters = [];

    for (var k = 0; k < points.length; k++) {
      if (visited[k]) continue;
      visited[k] = true;

      var cluster = {
        points: [points[k]],
        cx: points[k].x,
        cy: points[k].y,
      };

      var queue = [k];
      while (queue.length > 0) {
        var currentIdx = queue.pop();
        var currentPoint = points[currentIdx];

        var nearby = tree.search({
          minX: currentPoint.x - clusterRadiusPixels,
          minY: currentPoint.y - clusterRadiusPixels,
          maxX: currentPoint.x + clusterRadiusPixels,
          maxY: currentPoint.y + clusterRadiusPixels,
        });

        for (var m = 0; m < nearby.length; m++) {
          var nearbyIdx = nearby[m].idx;
          if (visited[nearbyIdx]) continue;

          var dx = points[nearbyIdx].x - currentPoint.x;
          var dy = points[nearbyIdx].y - currentPoint.y;
          var dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= clusterRadiusPixels) {
            visited[nearbyIdx] = true;
            cluster.points.push(points[nearbyIdx]);
            cluster.cx += points[nearbyIdx].x;
            cluster.cy += points[nearbyIdx].y;
            queue.push(nearbyIdx);
          }
        }
      }

      // 计算质心
      cluster.cx /= cluster.points.length;
      cluster.cy /= cluster.points.length;

      if (cluster.points.length === 1) {
        clusters.push(cluster.points[0]);
      } else {
        clusters.push({
          x: cluster.cx,
          y: cluster.cy,
          count: cluster.points.length,
          indices: cluster.points.map(function (p) {
            return p.featureIdx;
          }),
          color: cluster.points[0].color,
        });
      }
    }

    return clusters;
  }

  // ─────────────────────────────────────────────
  //  Leaflet 插件定义（标准格式，与 markercluster 一致）
  // ─────────────────────────────────────────────
  var MarkersCanvas = L.Layer.extend({
    options: {
      clustering: true,
      clusterDistance: 60, // 聚类距离阈值（屏幕像素）
      clusterMaxZoom: 14, // 此 zoom 以下显示聚类
      clusterFont: "bold 11px sans-serif",
      onFeatureClick: null, // fn(feature, latlng)
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
      return this.options.clusterDistance || 60;
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

      // 2. 是否使用聚类
      // 注意：可见点太多时（>5万）禁用聚类，否则 DBSCAN 会内存爆炸
      // 聚类在所有缩放级别都启用，减轻渲染压力
      var MAX_CLUSTER_POINTS = 50000;
      var useCluster =
        this.options.clustering && indices.length <= MAX_CLUSTER_POINTS;

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
          // 聚类圆：半径随数量动态变化，最大 36px
          var r = Math.min(10 + Math.log2(u.count) * 5, 36);
          ctx.beginPath();
          ctx.fillStyle = "#3388ff";
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
          });
        } else {
          // 单点：半径 6px（与 DOM 版 Marker 视觉大小相当），白色描边
          ctx.beginPath();
          ctx.fillStyle = u.color;
          ctx.arc(u.x, u.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.stroke();

          var hitR = 8;
          hitItems.push({
            minX: u.x - hitR,
            minY: u.y - hitR,
            maxX: u.x + hitR,
            maxY: u.y + hitR,
            type: "point",
            idx: u.idx || u.featureIdx,
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
          var b = new L.LatLngBounds();
          for (var i = 0; i < hit.indices.length; i++) {
            var f = this._features[hit.indices[i]];
            b.extend([f.lat, f.lng]);
          }
          this._map.fitBounds(b);
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
