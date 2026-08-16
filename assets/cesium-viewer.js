/**
 * cesium-viewer.js
 * Cesium 3D Viewer 初始化、相机同步、图层编排
 *
 * 核心职责：
 * 1. 懒加载 Cesium 库（首次 activate 时才加载 ~4MB JS + Workers）
 * 2. 初始化 Cesium Viewer（地球 + 底图 + 可选地形）
 * 3. 相机同步：Leaflet center/zoom ↔ Cesium camera lat/lng/height
 * 4. 图层编排：从 featureCache 读取已加载的 GeoJSON → CesiumGeoJsonAdapter
 * 5. 底图映射：Leaflet 底图名称 → Cesium ImageryProvider
 *
 * 暴露：window.CesiumViewer
 * 依赖：window.CesiumGeoJsonAdapter, window.CesiumTerrain
 */

(function () {
  "use strict";

  // ========== Cesium 配置 ==========
  // CDN 基础路径（后续可改为自托管 ./assets/cesium/）
  var CESIUM_VERSION = "1.125";
  var CESIUM_BASE_URL =
    "https://cesium.com/downloads/cesiumjs/releases/" +
    CESIUM_VERSION +
    "/Build/Cesium/";
  var CESIUM_JS_URL = CESIUM_BASE_URL + "Cesium.js";
  var CESIUM_CSS_URL = CESIUM_BASE_URL + "Widgets/widgets.css";

  // ========== 内部状态 ==========
  var viewer = null;
  var isActive = false;
  var isLoaded = false; // Cesium 库是否已加载
  var isLoading = false; // 是否正在加载中
  var cesiumLayerCache = {}; // checkboxId → GeoJsonDataSource
  var _pendingLayers = []; // activate 完成后待添加的图层

  // ========== DOM 辅助 ==========
  function showLoading(msg) {
    var el = document.getElementById("cesiumLoadingOverlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "cesiumLoadingOverlay";
      el.innerHTML =
        '<div class="cesium-loading-text">' +
        '<div class="cesium-loading-spinner"></div>' +
        '<div class="cesium-loading-msg"></div>' +
        "</div>";
      // 插入到 cesiumContainer 或 body
      var container = document.getElementById("cesiumContainer");
      if (container) container.appendChild(el);
      else document.body.appendChild(el);
    }
    var msgEl = el.querySelector(".cesium-loading-msg");
    if (msgEl) msgEl.textContent = msg || "加载 3D 引擎中…";
    el.classList.add("active");
  }

  function hideLoading() {
    var el = document.getElementById("cesiumLoadingOverlay");
    if (el) el.classList.remove("active");
  }

  // ========== Cesium 库懒加载 ==========
  function loadCesiumCss() {
    if (document.querySelector('link[href="' + CESIUM_CSS_URL + '"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CESIUM_CSS_URL;
    document.head.appendChild(link);
  }

  function loadCesiumJs() {
    if (isLoaded) return Promise.resolve();
    if (isLoading) {
      // 等待正在进行的加载
      return new Promise(function (resolve) {
        var check = setInterval(function () {
          if (isLoaded) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }

    isLoading = true;
    showLoading("正在加载 Cesium 3D 引擎（约 4MB）…");

    return new Promise(function (resolve, reject) {
      // 设置 CESIUM_BASE_URL（Workers/Assets/Widgets 的根路径）
      window.CESIUM_BASE_URL = CESIUM_BASE_URL;

      loadCesiumCss();

      var script = document.createElement("script");
      script.src = CESIUM_JS_URL;
      script.async = true;
      script.onload = function () {
        isLoaded = true;
        isLoading = false;
        console.log("[CesiumViewer] Cesium 库加载完成:", CESIUM_VERSION);
        // 诊断：验证关键 API 可用性
        var Cs = window.Cesium;
        if (Cs) {
          console.log(
            "[CesiumViewer] API 检查:",
            "Viewer=" + typeof Cs.Viewer,
            "Cartesian3=" + typeof Cs.Cartesian3,
            "Cartesian2=" + typeof Cs.Cartesian2,
            "Color=" + typeof Cs.Color,
            "GeoJsonDataSource=" + typeof Cs.GeoJsonDataSource,
          );
        } else {
          console.error(
            "[CesiumViewer] window.Cesium 未定义！CDN 可能加载异常",
          );
        }
        resolve();
      };
      script.onerror = function () {
        isLoading = false;
        hideLoading();
        reject(new Error("Cesium 库加载失败，请检查网络连接"));
      };
      document.head.appendChild(script);
    });
  }

  // ========== 相机同步 ==========
  /**
   * Leaflet zoom → Cesium camera height（米）
   * 经验公式：height = 40075016 * cos(lat) / 2^zoom
   */
  function zoomToHeight(lat, zoom) {
    return (40075016 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  }

  /**
   * Cesium camera height → Leaflet zoom
   */
  function heightToZoom(lat, height) {
    return Math.log2((40075016 * Math.cos((lat * Math.PI) / 180)) / height);
  }

  /**
   * 获取 Cartesian3 类（带回退兼容）
   * 某些 CDN 环境下 window.Cesium.Cartesian3 可能解析异常，
   * 回退方案：从 viewer.camera.position 实例获取构造器。
   */
  function getCartesian3() {
    var Cs = window.Cesium;
    if (Cs && Cs.Cartesian3 && Cs.Cartesian3.fromDegrees) {
      return Cs.Cartesian3;
    }
    if (viewer && viewer.camera && viewer.camera.position) {
      var ctor = viewer.camera.position.constructor;
      if (ctor && ctor.fromDegrees) return ctor;
    }
    return null;
  }

  /**
   * 从 Leaflet 同步相机到 Cesium
   */
  function syncCameraFromLeaflet() {
    if (!viewer || !window.map) return;
    var center = window.map.getCenter();
    var zoom = window.map.getZoom();
    var height = zoomToHeight(center.lat, zoom);

    var Cartesian3 = getCartesian3();
    if (Cartesian3) {
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(center.lng, center.lat, height),
      });
    } else {
      // 最终回退：flyTo + destinationCartographic
      try {
        viewer.camera.flyTo({
          destinationCartographic: {
            longitude: (center.lng * Math.PI) / 180,
            latitude: (center.lat * Math.PI) / 180,
            height: height,
          },
          duration: 0,
        });
      } catch (e) {
        console.error("[CesiumViewer] 相机同步全部失败:", e);
      }
    }
    console.log(
      "[CesiumViewer] 相机同步: lat=" +
        center.lat.toFixed(2) +
        ", lng=" +
        center.lng.toFixed(2) +
        ", height=" +
        Math.round(height) +
        "m",
    );
  }

  /**
   * 从 Cesium 同步相机到 Leaflet
   */
  function syncCameraToLeaflet() {
    if (!viewer || !window.map) return;
    var carto = viewer.camera.positionCartographic;
    var lat = (carto.latitude * 180) / Math.PI;
    var lng = (carto.longitude * 180) / Math.PI;
    var height = carto.height;
    var zoom = heightToZoom(lat, height);

    // 限制 zoom 范围
    zoom = Math.max(0, Math.min(19, zoom));

    window.map.setView([lat, lng], zoom, { animate: false });
  }

  // ========== 要素定位（3D 缩放至） ==========
  /**
   * 深度优先遍历几何坐标，计算 [west, south, east, north] 包围盒
   * 支持 Point / MultiPoint / LineString / MultiLineString / Polygon / MultiPolygon
   */
  function computeGeometryBounds(geometry) {
    if (!geometry || !geometry.type) return null;
    var minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;

    function visit(c) {
      if (
        Array.isArray(c) &&
        c.length >= 2 &&
        typeof c[0] === "number" &&
        typeof c[1] === "number"
      ) {
        if (c[0] < minLng) minLng = c[0];
        if (c[0] > maxLng) maxLng = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
        return;
      }
      if (Array.isArray(c)) {
        for (var i = 0; i < c.length; i++) visit(c[i]);
      }
    }
    visit(geometry.coordinates);

    if (!isFinite(minLng) || !isFinite(minLat)) return null;
    return { west: minLng, south: minLat, east: maxLng, north: maxLat };
  }

  /**
   * 飞到指定要素（供侧面板「缩放至」、3D 弹窗缩放按钮、搜索结果定位复用）
   * @param {Object} feature - GeoJSON Feature
   * @returns {boolean} 是否成功
   */
  function flyToFeature(feature) {
    if (!viewer || !feature || !feature.geometry) return false;
    var bounds = computeGeometryBounds(feature.geometry);
    if (!bounds) return false;
    var Cs = window.Cesium;
    var gtype = (feature.geometry.type || "").toLowerCase();
    var isPoint = gtype === "point" || gtype === "multipoint";
    var isDegenerate =
      bounds.west === bounds.east && bounds.south === bounds.north;

    try {
      if (isPoint || isDegenerate) {
        // 点要素：飞到该点（约 zoom 14 高度）
        var height = zoomToHeight(bounds.south, 14);
        var Cartesian3 = getCartesian3();
        if (!Cartesian3) return false;
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(
            bounds.west,
            bounds.south,
            height,
          ),
          duration: 1.2,
        });
      } else {
        // 线/面：飞到包围盒
        var rect = Cs.Rectangle.fromDegrees(
          bounds.west,
          bounds.south,
          bounds.east,
          bounds.north,
        );
        viewer.camera.flyTo({ destination: rect, duration: 1.2 });
      }
      return true;
    } catch (e) {
      console.error("[CesiumViewer] flyToFeature 失败:", e);
      return false;
    }
  }

  // ========== 3D 要素拾取 + 弹窗 ==========
  var _clickHandler = null;
  var _popupEl = null;

  function ensurePopupEl() {
    if (_popupEl) return _popupEl;
    _popupEl = document.createElement("div");
    _popupEl.className = "cesium-feature-popup";
    _popupEl.style.cssText =
      "position:absolute;z-index:1000;display:none;pointer-events:auto;";
    var container = document.getElementById("cesiumContainer");
    if (container) container.appendChild(_popupEl);
    else document.body.appendChild(_popupEl);
    return _popupEl;
  }

  function hidePopup() {
    if (_popupEl) _popupEl.style.display = "none";
  }

  /**
   * 在指定屏幕位置显示要素弹窗（复用 2D 的 buildPopupContent）
   * @param {Object} ref - { layerId, featureIndex, fileName, layerName }
   * @param {Object} screenPos - { x, y } 画布坐标
   */
  function showEntityPopup(ref, screenPos) {
    var feature =
      window._featureCache && window._featureCache[ref.layerId]
        ? window._featureCache[ref.layerId][ref.featureIndex]
        : null;
    if (!feature) return;

    var content =
      window.GeoUtils && window.GeoUtils.buildPopupContent
        ? window.GeoUtils.buildPopupContent(
            feature,
            ref.fileName,
            null,
            ref.layerName,
          )
        : null;
    if (!content) return;

    var el = ensurePopupEl();
    // buildPopupContent 已内含 [⚲ 缩放至] [📋 详情] 按钮，无需再追加
    el.innerHTML = content;

    // 绑定按钮
    var zoomBtn = el.querySelector('[data-act="zoom"]');
    var detailBtn = el.querySelector('[data-act="detail"]');
    if (zoomBtn) {
      zoomBtn.onclick = function (e) {
        e.stopPropagation();
        flyToFeature(feature);
        hidePopup();
      };
    }
    if (detailBtn) {
      detailBtn.onclick = function (e) {
        e.stopPropagation();
        if (
          typeof window.FeaturePanel !== "undefined" &&
          window.FeaturePanel.openSingle
        ) {
          window.FeaturePanel.openSingle(feature, ref.layerId, ref.layerName);
        }
        hidePopup();
      };
    }

    el.style.display = "block";

    // 定位：跟随点击位置，做偏移避免遮挡光标，并做边界钳制
    var w = el.offsetWidth || 260;
    var h = el.offsetHeight || 120;
    var cw = viewer.scene.canvas.clientWidth;
    var ch = viewer.scene.canvas.clientHeight;
    var left = screenPos.x + 14;
    var top = screenPos.y - h - 10;
    if (left + w > cw) left = screenPos.x - w - 14;
    if (left < 4) left = 4;
    if (top < 4) top = screenPos.y + 14;
    if (top + h > ch) top = ch - h - 4;
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  /**
   * 设置点击拾取：点击实体 → 弹窗；点击空白 → 关闭弹窗
   */
  function setupClickHandler() {
    if (_clickHandler || !viewer) return;
    var Cs = window.Cesium;
    if (!Cs.ScreenSpaceEventHandler || !Cs.ScreenSpaceEventType) return;
    _clickHandler = new Cs.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction(function (movement) {
      var picked = viewer.scene.pick(movement.position);
      if (picked && picked.id && picked.id._ogv) {
        showEntityPopup(picked.id._ogv, movement.position);
      } else {
        hidePopup();
      }
    }, Cs.ScreenSpaceEventType.LEFT_CLICK);
  }

  // ========== 底图映射 ==========
  /**
   * 根据当前 Leaflet 选中的底图，创建对应的 Cesium ImageryProvider
   */
  function createImageryProvider(basemapName) {
    var tk = window.TDT_TK || "";

    switch (basemapName) {
      // 天地图系列
      case "天地图影像":
        return new window.Cesium.UrlTemplateImageryProvider({
          url:
            "https://t0.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk=" +
            tk,
          maximumLevel: 18,
        });
      case "天地图矢量":
        return new window.Cesium.UrlTemplateImageryProvider({
          url:
            "https://t0.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=" +
            tk,
          maximumLevel: 18,
        });
      case "天地图地形":
        return new window.Cesium.UrlTemplateImageryProvider({
          url:
            "https://t0.tianditu.gov.cn/DataServer?T=ter_w&x={x}&y={y}&l={z}&tk=" +
            tk,
          maximumLevel: 18,
        });

      // ArcGIS 系列
      // 注意：ArcGisMapServerImageryProvider 在 CDN 构建下有 getDerivedResource 已知 bug，
      // 改用 UrlTemplateImageryProvider 直接访问 ArcGIS 瓦片端点（tile/{z}/{y}/{x}）
      case "ArcGIS-影像":
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 19,
        });
      case "ArcGIS-海洋":
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 10,
        });
      case "ArcGIS-街道":
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 19,
        });

      // GEBCO WMS 系列
      case "GEBCO2025-水深地形":
        return new window.Cesium.WebMapServiceImageryProvider({
          url: "https://wms.gebco.net/2025/mapserv?",
          layers: "GEBCO_2025",
          parameters: { transparent: true, format: "image/png" },
          maximumLevel: 12,
        });
      case "GEBCO2024-水深地形":
        return new window.Cesium.WebMapServiceImageryProvider({
          url: "https://wms.gebco.net/mapserv?",
          layers: "GEBCO_LATEST",
          parameters: { transparent: true, format: "image/png" },
          maximumLevel: 12,
        });

      // OSM
      case "OpenStreetMap":
        return new window.Cesium.OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
          maximumLevel: 19,
        });

      // Macrostrat
      case "Macrostrat-全球地质":
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png",
          maximumLevel: 16,
        });

      // ETOPO 等本地图片底图 → 降级用 ArcGIS 影像
      default:
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 19,
        });
    }
  }

  /**
   * 同步底图：从 Leaflet 当前底图名称切换 Cesium imagery
   */
  function syncBasemap() {
    if (!viewer) return;
    var name = window._currentBasemapName || "ArcGIS-影像";
    try {
      var provider = createImageryProvider(name);
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(provider);
      _overlayLayerCache = {}; // 清空覆盖层缓存，重新叠加
      console.log("[CesiumViewer] 底图同步:", name);
      // 重新叠加勾选的覆盖层（全球境界/标注等）
      syncOverlays();
    } catch (e) {
      console.warn("[CesiumViewer] 底图同步失败:", name, e);
    }
  }

  // ========== 覆盖层映射（天地图瓦片覆盖层 → Cesium ImageryProvider） ==========
  // 天地图覆盖层服务名映射（T=xxx 参数）
  var OVERLAY_LAYERS = {
    天地图全球境界: "ibo_w",
    天地图地名标注: "cva_w",
    天地图影像标注: "cia_w",
    天地图地形标注: "cta_w",
  };
  // 覆盖层名称 → Cesium ImageryLayer 缓存
  var _overlayLayerCache = {};

  /**
   * 同步覆盖层：把 Leaflet 勾选的天地图瓦片覆盖层叠加到 Cesium 底图之上
   */
  function syncOverlays() {
    if (!viewer) return;
    var names = window.getCheckedOverlays ? window.getCheckedOverlays() : [];
    var tk = window.TDT_TK || "";

    // 移除已不再勾选的覆盖层
    for (var cachedName in _overlayLayerCache) {
      if (names.indexOf(cachedName) === -1) {
        try {
          viewer.imageryLayers.remove(_overlayLayerCache[cachedName], true);
        } catch (e) {}
        delete _overlayLayerCache[cachedName];
        console.log("[CesiumViewer] 移除覆盖层:", cachedName);
      }
    }

    // 添加新勾选的天地图覆盖层
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var svc = OVERLAY_LAYERS[name];
      if (!svc || _overlayLayerCache[name]) continue;
      try {
        var provider = new window.Cesium.UrlTemplateImageryProvider({
          url:
            "https://t0.tianditu.gov.cn/DataServer?T=" +
            svc +
            "&x={x}&y={y}&l={z}&tk=" +
            tk,
          maximumLevel: 18,
        });
        var layer = viewer.imageryLayers.addImageryProvider(provider);
        _overlayLayerCache[name] = layer;
        console.log("[CesiumViewer] 叠加覆盖层:", name);
      } catch (e) {
        console.warn("[CesiumViewer] 覆盖层叠加失败:", name, e);
      }
    }
  }

  // ========== 图层管理 ==========
  /**
   * 添加 GeoJSON 图层到 Cesium
   * @param {string} checkboxId
   * @param {Object} geoJson - 标准 GeoJSON 对象
   */
  function addLayer(checkboxId, geoJson) {
    if (!viewer) {
      // Viewer 尚未初始化，加入待处理队列
      _pendingLayers.push({ checkboxId: checkboxId, geoJson: geoJson });
      return;
    }

    // 幂等：已存在同 id 图层则跳过，避免重复移除+重建造成闪烁与延迟
    // （需重建时请调用 reloadLayer，它会显式 remove + add）
    if (cesiumLayerCache[checkboxId]) {
      return;
    }

    if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
      console.log("[CesiumViewer] 图层无要素，跳过:", checkboxId);
      return;
    }

    if (!window.CesiumGeoJsonAdapter) {
      console.error("[CesiumViewer] CesiumGeoJsonAdapter 未加载");
      return;
    }

    console.log(
      "[CesiumViewer] 添加图层:",
      checkboxId,
      "要素数:",
      geoJson.features.length,
    );

    window.CesiumGeoJsonAdapter.loadGeoJson(checkboxId, geoJson)
      .then(function (dataSource) {
        viewer.dataSources.add(dataSource);
        cesiumLayerCache[checkboxId] = dataSource;
      })
      .catch(function (err) {
        console.error("[CesiumViewer] 图层加载失败:", checkboxId, err);
      });
  }

  /**
   * 移除 Cesium 中的图层
   * @param {string} checkboxId
   */
  function removeLayer(checkboxId) {
    var ds = cesiumLayerCache[checkboxId];
    if (ds && viewer) {
      viewer.dataSources.remove(ds, true);
      delete cesiumLayerCache[checkboxId];
      console.log("[CesiumViewer] 移除图层:", checkboxId);
    }
    // 从待处理队列中移除
    _pendingLayers = _pendingLayers.filter(function (item) {
      return item.checkboxId !== checkboxId;
    });
  }

  /**
   * 重新加载图层（颜色模式 / 透明度 / 样式变化后刷新 3D 渲染）
   * 从 featureCache 读取最新数据，移除旧数据源后重建
   * @param {string} checkboxId
   */
  function reloadLayer(checkboxId) {
    if (!viewer) return;
    var featureCache = window._featureCache;
    var features = featureCache && featureCache[checkboxId];
    if (!features || features.length === 0) {
      // 缓存为空则仅移除旧图层
      removeLayer(checkboxId);
      return;
    }
    // 检查对应 checkbox 是否勾选（未勾选则不显示）
    var cb = document.getElementById(checkboxId);
    if (cb && !cb.checked) {
      removeLayer(checkboxId);
      return;
    }
    removeLayer(checkboxId);
    addLayer(checkboxId, {
      type: "FeatureCollection",
      features: features,
    });
  }

  /**
   * 同步所有已加载的 2D 图层到 Cesium
   * 从 featureCache 读取数据
   */
  function syncAllLayers() {
    if (!window._featureCache) return;
    var featureCache = window._featureCache;

    for (var checkboxId in featureCache) {
      if (!featureCache.hasOwnProperty(checkboxId)) continue;
      var features = featureCache[checkboxId];
      if (!features || features.length === 0) continue;

      // 检查对应 checkbox 是否勾选
      var cb = document.getElementById(checkboxId);
      if (cb && !cb.checked) continue;

      // 构造标准 GeoJSON FeatureCollection
      var geoJson = {
        type: "FeatureCollection",
        features: features,
      };
      addLayer(checkboxId, geoJson);
    }
  }

  // ========== Viewer 初始化 ==========
  function initViewer() {
    if (viewer) return;

    var container = document.getElementById("cesiumContainer");
    if (!container) {
      console.error("[CesiumViewer] #cesiumContainer 容器不存在");
      return;
    }

    // 初始化 Ion Token
    if (window.CesiumTerrain && window.CesiumTerrain.initIonToken) {
      window.CesiumTerrain.initIonToken();
    }

    // 创建 Viewer
    viewer = new window.Cesium.Viewer("cesiumContainer", {
      // 底图（稍后由 syncBasemap() 替换）
      imageryProvider: false,
      // 地形（稍后异步加载）
      terrainProvider: undefined,
      // 禁用默认 UI（我们有自己的控件系统）
      animation: false,
      timeline: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      homeButton: false,
      geocoder: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      // 启用性能优化
      requestRenderMode: false, // 3D 交互较频繁，暂不启用按需渲染
      contextOptions: {
        webgl: {
          alpha: false,
          antialias: true,
        },
      },
    });

    // 隐藏 credits
    var credits = viewer.bottomContainer;
    if (credits) credits.style.display = "none";

    // 同步底图
    syncBasemap();

    // 异步加载地形
    if (window.CesiumTerrain && window.CesiumTerrain.getTerrainProvider) {
      window.CesiumTerrain.getTerrainProvider().then(function (terrain) {
        if (terrain && viewer) {
          viewer.terrainProvider = terrain;
          console.log("[CesiumViewer] 地形加载完成");
        }
      });
    }

    // 设置要素点击拾取（弹窗 + 缩放 + 详情）
    setupClickHandler();

    console.log("[CesiumViewer] Viewer 初始化完成");
  }

  // ========== 激活/停用 ==========
  function activate() {
    if (isActive) return;

    showLoading("正在初始化 3D 视图…");

    loadCesiumJs()
      .then(function () {
        // 确保 DOM 容器就绪
        var container = document.getElementById("cesiumContainer");
        if (!container) {
          // 动态创建容器
          container = document.createElement("div");
          container.id = "cesiumContainer";
          var mapEl = document.getElementById("map");
          if (mapEl && mapEl.parentNode) {
            mapEl.parentNode.insertBefore(container, mapEl.nextSibling);
          } else {
            document.body.appendChild(container);
          }
        }

        // 初始化 Viewer
        initViewer();

        // 标记为活跃
        isActive = true;
        document.body.classList.add("view-3d-active");

        // 同步相机（从 Leaflet 当前视角）
        syncCameraFromLeaflet();

        // 同步所有已加载图层
        syncAllLayers();

        // 处理待处理队列
        while (_pendingLayers.length > 0) {
          var item = _pendingLayers.shift();
          addLayer(item.checkboxId, item.geoJson);
        }

        hideLoading();

        // 强制 resize（容器从 display:none 切到 block 后需要）
        if (viewer) viewer.resize();

        // 操作提示：用通用弹窗组件显示，自动消失，不持久化
        if (window.showToast) {
          window.showToast("🌍 3D 视图 — 拖拽旋转 · 滚轮缩放 · 右键倾斜", {
            duration: 5000,
          });
        }

        console.log("[CesiumViewer] 3D 视图已激活");
      })
      .catch(function (err) {
        hideLoading();
        console.error("[CesiumViewer] 激活失败:", err);
        if (window.showToast) {
          window.showToast("❌ 3D 引擎加载失败: " + err.message, {
            duration: 5000,
          });
        }
        // 回退开关状态
        var cb = document.getElementById("view3dToggle");
        if (cb) {
          cb.checked = false;
          localStorage.setItem("dupal_toggle_view3d", "false");
        }
      });
  }

  function deactivate() {
    if (!isActive) return;

    // 同步相机回 Leaflet
    syncCameraToLeaflet();

    isActive = false;
    document.body.classList.remove("view-3d-active");

    if (window.showToast) {
      window.showToast("🗺️ 已切换到 2D 视图", { duration: 2000 });
    }

    console.log("[CesiumViewer] 3D 视图已停用");
  }

  // ========== 暴露 API ==========
  window.CesiumViewer = {
    activate: activate,
    deactivate: deactivate,
    addLayer: addLayer,
    removeLayer: removeLayer,
    reloadLayer: reloadLayer,
    syncAllLayers: syncAllLayers,
    syncCameraFromLeaflet: syncCameraFromLeaflet,
    syncCameraToLeaflet: syncCameraToLeaflet,
    syncBasemap: syncBasemap,
    syncOverlays: syncOverlays,
    flyToFeature: flyToFeature,
    hidePopup: hidePopup,
    get isActive() {
      return isActive;
    },
    get viewer() {
      return viewer;
    },
  };

  // ========== 自动恢复 3D 状态 ==========
  // 若刷新/重新打开页面时 3D 开关为勾选（app.js 的 initToggle 已恢复状态），
  // 则自动进入 3D（本脚本在 body 底部同步加载，app.js 已执行完毕）。
  function autoRestore3D() {
    var cb = document.getElementById("view3dToggle");
    if (cb && cb.checked && !isActive) {
      console.log("[CesiumViewer] 检测到 3D 开关为开，自动进入 3D");
      activate();
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoRestore3D);
  } else {
    autoRestore3D();
  }
})();
