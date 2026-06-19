/**
 * geojsonloader.js
 * 主编排层：图层管理、面板交互、搜索、颜色设置
 * 依赖：geo-utils.js（纯函数）、Leaflet.GeoMarker.js（图标与 marker 工厂）
 */
(function () {
  // 检查 map 和 L 是否存在（延迟检查）
  function waitForMap(callback, attempts) {
    if (attempts === undefined) attempts = 50;
    if (typeof L === "undefined" || typeof map === "undefined") {
      if (attempts > 0) {
        setTimeout(function () {
          waitForMap(callback, attempts - 1);
        }, 10);
      } else {
        console.warn("[GeoJSONLoader] map对象未就绪，跳过初始化");
      }
      return;
    }
    callback();
  }

  waitForMap(function () {
    // ========== 防抖函数 + 全局缩放锁 ==========
    function debounce(func, wait) {
      let timeout;
      return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

    let isMapZooming = false;
    const optimizedFitBounds = debounce(function (bounds, options) {
      if (isMapZooming || !bounds) return;
      isMapZooming = true;
      map.fitBounds(bounds, {
        ...options,
        animate: false,
        duration: 200,
        maxZoom: 18,
      });
      setTimeout(() => {
        isMapZooming = false;
      }, options.duration || 200);
    }, 100);

    // ========== 面板交互逻辑 ==========
    let selectAllCheckbox = null;

    // 图钉按钮
    var pinBtn = document.getElementById("pinBtn");
    var layerPanel = document.getElementById("layerPanel");
    var sidebarToggle = document.getElementById("sidebarToggle");
    if (pinBtn) {
      pinBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var isPinned = !document.body.classList.contains("sidebar-pinned");
        document.body.classList.toggle("sidebar-pinned", isPinned);
        pinBtn.classList.toggle("active", isPinned);
        if (pinBtn.classList.contains("active")) {
          pinBtn.style.opacity = "1";
          pinBtn.style.transform = "rotate(45deg)";
        } else {
          pinBtn.style.opacity = "0.35";
          pinBtn.style.transform = "";
        }
        localStorage.setItem("dupal_sidebar_pinned", isPinned);
        if (isPinned && sidebarToggle) {
          sidebarToggle.checked = true;
        }
        setTimeout(function () {
          map.invalidateSize();
        }, 350);
      });

      // 恢复图钉状态
      (function () {
        var savedPinned =
          localStorage.getItem("dupal_sidebar_pinned") === "true";
        if (savedPinned) {
          document.body.classList.add("sidebar-pinned");
          pinBtn.classList.add("active");
          pinBtn.style.opacity = "1";
          pinBtn.style.transform = "rotate(45deg)";
          if (sidebarToggle) sidebarToggle.checked = true;
          setTimeout(function () {
            map.invalidateSize();
          }, 350);
        }
      })();
    }

    // ========== details 面板开合状态持久化 ==========
    // 为所有带 data-persist-details 属性的 <details> 保存/恢复 open 状态
    (function initDetailsPersistence() {
      var STORAGE_PREFIX = "dupal_details_open_";

      // 清理 app.js 旧版残留
      try {
        localStorage.removeItem("dupal_toggle_sectionOpen");
      } catch (e) {}

      document
        .querySelectorAll("details[data-persist-details]")
        .forEach(function (el) {
          var key = STORAGE_PREFIX + el.id;
          if (!el.id) return;

          // 恢复上次状态
          var saved = localStorage.getItem(key);
          if (saved !== null) {
            el.open = saved === "true";
          }

          // 监听开合变化并保存
          el.addEventListener("toggle", function () {
            localStorage.setItem(key, String(el.open));
          });
        });
    })();

    // ========== 侧边栏宽度可调节 ==========
    (function initPanelResize() {
      var panel = document.getElementById("layerPanel");
      var handle = document.getElementById("panelResizeHandle");
      var trigger = document.getElementById("layerTrigger");
      if (!panel || !handle) return;

      var STORAGE_KEY = "dupal_panel_width";
      var MIN_WIDTH = 180;
      var MAX_WIDTH = 500;
      var DEFAULT_WIDTH = 300;

      // 读取存储宽度
      var savedWidth = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      var panelWidth =
        savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH
          ? savedWidth
          : DEFAULT_WIDTH;

      function applyWidth(w) {
        panelWidth = w;
        panel.style.width = w + "px";
        panel.style.transform = "translateX(-" + w + "px)";
      }

      // 初始应用
      applyWidth(panelWidth);

      // 拖拽开始
      var isResizing = false;
      handle.addEventListener("mousedown", startResize);
      handle.addEventListener("touchstart", startResize, { passive: false });

      function startResize(e) {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        handle.classList.add("active");
        document.body.classList.add("resizing-panel");
        document.addEventListener("mousemove", onResize);
        document.addEventListener("mouseup", stopResize);
        document.addEventListener("touchmove", onResize, { passive: false });
        document.addEventListener("touchend", stopResize);
      }

      function getClientX(e) {
        return e.touches ? e.touches[0].clientX : e.clientX;
      }

      function onResize(e) {
        if (!isResizing) return;
        e.preventDefault();
        var rect = panel.getBoundingClientRect();
        var newWidth = getClientX(e) - rect.left;
        newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        applyWidth(newWidth);
      }

      function stopResize() {
        if (!isResizing) return;
        isResizing = false;
        handle.classList.remove("active");
        document.body.classList.remove("resizing-panel");
        document.removeEventListener("mousemove", onResize);
        document.removeEventListener("mouseup", stopResize);
        document.removeEventListener("touchmove", onResize);
        document.removeEventListener("touchend", stopResize);
        localStorage.setItem(STORAGE_KEY, String(panelWidth));
      }
    })();

    // ========== 搜索注册表 ==========
    const searchRegistry = [];
    const layerCache = {};
    const layerColorMap = {};
    // ========== 颜色模式管理 ==========
    const colorMode = {};
    const fieldKey = {};
    const fieldColorPalette = {};
    // 高亮状态
    const highlightState = {};
    const layerBoundsCache = {};
    const _loadedCallbacks = {}; // 图层加载完成回调，用于搜索要素时异步等待
    // Canvas 图层要素缓存（用于颜色模式快速切换）
    const canvasFeaturesCache = {};
    const canvasFieldValuesCache = {};
    const searchIndexMap = {}; // 倒排索引：{ checkboxId: { tokens: { tok: [idx, ...] }, features: [...] } }
    const featureCache = {}; // 要素数据缓存：{ checkboxId: features[] }，独立于索引，保证要素搜索始终可用
    let searchIndexingCount = 0; // 正在构建索引的图层数

    // 搜索辅助函数（提取 feature 所有属性为可搜索字符串）
    function featureToSearchStr(f) {
      if (!f || !f.properties) return "";
      return JSON.stringify(f.properties).toLowerCase();
    }

    // 从 features 构建倒排 tokens（异步分批，不阻塞主线程）
    // callback(tokens) 在构建完成后调用
    function tokenizeFeaturesAsync(features, callback) {
      var tokens = Object.create(null);
      var BATCH = 5000; // 每批处理条数
      var i = 0;
      function nextBatch() {
        var end = Math.min(i + BATCH, features.length);
        for (; i < end; i++) {
          var str = featureToSearchStr(features[i]);
          if (!str) continue;
          var parts = str.split(/[^a-z0-9\u4e00-\u9fff]+/);
          for (var t = 0; t < parts.length; t++) {
            var tok = parts[t];
            if (!tok) continue;
            if (!tokens[tok]) tokens[tok] = [];
            tokens[tok].push(i);
          }
        }
        if (i < features.length) {
          setTimeout(nextBatch, 0); // 让出主线程
        } else {
          callback(tokens);
        }
      }
      setTimeout(nextBatch, 0);
    }

    // 倒排索引构建：为大数据集提供 O(1) 搜索能力
    // cacheKey: 用于 IDB 缓存的 key（内置图层用 fileName，用户上传图层传 null 不缓存）
    // callback: function(fromCache) 回调
    function buildSearchIndex(checkboxId, features, cacheKey, callback) {
      if (!features || !features.length) {
        if (callback) callback(false);
        return;
      }
      // cacheKey 为 null/undefined 时不走 IDB 缓存（用户上传图层）
      if (!cacheKey) {
        tokenizeFeaturesAsync(features, function (tokens) {
          searchIndexMap[checkboxId] = { tokens: tokens, features: features };
          console.log(
            "[GeoJSONLoader] 搜索索引构建（不上缓存）:",
            checkboxId,
            "tokens数量:",
            Object.keys(tokens).length,
          );
          if (callback) callback(false);
        });
        return;
      }
      // 先尝试从 IDB 恢复缓存的 tokens
      L.GzIdbLoader.getSearchIndex(cacheKey)
        .then(function (cached) {
          // 缓存命中时校验格式：tokens 必须是对象，且 featureCount 匹配
          if (
            cached &&
            cached.tokens &&
            typeof cached.tokens === "object" &&
            !Array.isArray(cached.tokens)
          ) {
            if (
              cached.featureCount !== undefined &&
              cached.featureCount !== features.length
            ) {
              console.log(
                "[GeoJSONLoader] 搜索索引版本不匹配（feature数量变化），重建:",
                checkboxId,
              );
            } else {
              // 缓存命中：直接使用
              searchIndexMap[checkboxId] = {
                tokens: cached.tokens,
                features: features,
              };
              console.log(
                "[GeoJSONLoader] 搜索索引缓存恢复:",
                checkboxId,
                "tokens数量:",
                Object.keys(cached.tokens).length,
              );
              if (callback) callback(true);
              return;
            }
          }
          // 缓存未命中或版本不匹配：异步分批重建
          tokenizeFeaturesAsync(features, function (tokens) {
            L.GzIdbLoader.setSearchIndex(cacheKey, {
              tokens: tokens,
              featureCount: features.length,
            });
            searchIndexMap[checkboxId] = { tokens: tokens, features: features };
            console.log(
              "[GeoJSONLoader] 搜索索引重新构建:",
              checkboxId,
              "tokens数量:",
              Object.keys(tokens).length,
            );
            if (callback) callback(false);
          });
        })
        .catch(function (err) {
          console.warn(
            "[GeoJSONLoader] 搜索索引IDB缓存异常，降级为内存索引:",
            err,
          );
          // IDB 降级：直接构建内存索引
          tokenizeFeaturesAsync(features, function (tokens) {
            searchIndexMap[checkboxId] = { tokens: tokens, features: features };
            if (callback) callback(false);
          });
        });
    }
    // 标签配置（委托给 GeoUtils，这里保留引用以便快速判断）
    const STATION_LABEL_CONFIG = window.GeoUtils.STATION_LABEL_CONFIG;
    // 缩放相关常量
    const DEFAULT_LABEL_FIELD = "Name";
    let clusterEnabled = true;
    let labelEnabled = false;

    // ========== 线/面 hover 标签（mouseover 事件驱动，性能优先）==========
    // 不在 onEachFeature 中提前 bindTooltip（会导致拖动卡顿），
    // 而是在 onEachFeature 中注册 mouseover/mouseout，
    // 鼠标真正进入要素时才绑定 tooltip，离开时立即解绑。
    // 拖动地图时完全不触发这些事件，零开销。

    function _bindHoverLabel(layer) {
      layer.on("mouseover", function (e) {
        if (!labelEnabled) return;
        var name = _getFeatureName(layer.feature);
        if (!name) return;
        layer.bindTooltip(String(name), {
          permanent: false,
          direction: "top",
          offset: [0, -8],
          className: "feature-label",
        });
        // 打开 tooltip
        layer.openTooltip();
      });
      layer.on("mouseout", function () {
        try {
          layer.closeTooltip();
        } catch (e) {}
        try {
          layer.unbindTooltip();
        } catch (e) {}
      });
    }

    function _getFeatureName(feature) {
      if (!feature || !feature.properties) return "";
      return (
        feature.properties.Name ||
        feature.properties.name ||
        feature.properties.NAME ||
        ""
      );
    }

    function _closeFeatureTooltip() {
      try {
        map.closeTooltip();
      } catch (e) {}
    }

    // ========== 核心样式函数（支持三种颜色模式）==========
    function getFeatureFillColor(feature, checkboxId, fileName, featureIndex) {
      const mode = colorMode[checkboxId] || "sequential";
      if (mode === "single") {
        return layerColorMap[checkboxId] || "#8B4513";
      } else if (mode === "sequential") {
        return window.GeoUtils.getFeatureColorByIndex(featureIndex || 0);
      } else if (mode === "field") {
        const fk = fieldKey[checkboxId];
        if (fk && feature.properties)
          return window.GeoUtils.getFeatureColorByField(
            feature.properties,
            fk,
            featureIndex || 0,
          );
        return window.GeoUtils.getFeatureColorByIndex(featureIndex || 0);
      }
      return window.GeoUtils.getFeatureColorByIndex(featureIndex || 0);
    }

    function getGeoJsonStyle(feature, checkboxId, fileName, featureIndex) {
      const geomType = (feature.geometry?.type || "").toLowerCase();
      const isPolygon = geomType === "polygon" || geomType === "multipolygon";
      const isLine =
        geomType === "linestring" || geomType === "multilinestring";
      const isPoint = geomType === "point" || geomType === "multipoint";

      const featureColor = getFeatureFillColor(
        feature,
        checkboxId,
        fileName,
        featureIndex,
      );

      if (isLine) {
        return {
          color: featureColor,
          fillColor: featureColor,
          weight: 2.5,
          opacity: 0.8,
          fillOpacity: 0,
        };
      }

      if (isPoint) {
        const isVolcano = fileName === "volcanos.geojson";
        return {
          color: featureColor,
          fillColor: featureColor,
          weight: 1,
          opacity: 0.8,
          fillOpacity: 0.8,
          radius: isVolcano ? 5 : 8,
        };
      }

      return {
        color: "#555",
        fillColor: featureColor,
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.45,
      };
    }

    // ========== 高亮相关 ==========
    function clearHighlight(checkboxId) {
      const state = highlightState[checkboxId];
      if (!state || state.featureId == null || !state.geoLayers) return;
      const featureId = state.featureId;
      state.geoLayers.forEach(function (geoLayer) {
        geoLayer.eachLayer(function (layer) {
          if (layer.feature && layer.feature._featureIndex === featureId) {
            const idx = layer.feature._featureIndex || 0;
            const fileName = layer.feature._fileName || "";
            try {
              layer.setStyle(
                getGeoJsonStyle(layer.feature, checkboxId, fileName, idx),
              );
            } catch (e) {}
          }
        });
      });
      state.featureId = null;
    }

    function applyHighlight(checkboxId, featureId, hlStyle) {
      clearHighlight(checkboxId);
      const state = highlightState[checkboxId];
      if (!state || !state.geoLayers) return;
      state.featureId = featureId;
      state.geoLayers.forEach(function (geoLayer) {
        geoLayer.eachLayer(function (layer) {
          if (layer.feature && layer.feature._featureIndex === featureId) {
            try {
              layer.setStyle(hlStyle);
            } catch (e) {}
          }
        });
      });
    }

    function clearAllHighlights() {
      Object.keys(highlightState).forEach(clearHighlight);
    }

    map.on("click", function () {
      clearAllHighlights();
      try {
        map.closeTooltip();
      } catch (e) {}
    });

    // ========== 创建 GeoJSON 图层 ==========
    function buildGeoJsonLayerGroup(geojsonData, checkboxId, fileName) {
      // 预处理：为每个要素生成索引
      if (
        geojsonData.type === "FeatureCollection" &&
        Array.isArray(geojsonData.features)
      ) {
        geojsonData.features.forEach(function (f, idx) {
          f._featureIndex = idx;
          if (!f.properties) f.properties = {};
          f.properties._featureIndex = idx;
        });
      }

      // 点要素类型检测
      const isPointType = (() => {
        const firstFeature = geojsonData.features?.find((f) => f.geometry);
        const gType = (firstFeature?.geometry?.type || "").toLowerCase();
        return gType === "point" || gType === "multipoint";
      })();

      const isNoCluster = !isPointType || !clusterEnabled;

      // 标签字段（配置表统一管理，默认 "Name"）
      const cfg = STATION_LABEL_CONFIG[fileName];
      let labelField = cfg ? cfg.field : DEFAULT_LABEL_FIELD;

      const isVolcanoLayer = fileName === "volcanos.json";
      const isHotspotLayer =
        fileName === "hotspots.json" ||
        fileName === "hydrothermal_vents.geojson";

      // 创建聚类组
      function createClusterGroup() {
        const layerColor = layerColorMap[checkboxId] || "#8B6914";
        const isVolcanoCluster = fileName === "volcanos.json";
        const isHotspotCluster =
          fileName === "hotspots.json" ||
          fileName === "hydrothermal_vents.geojson";

        return L.markerClusterGroup({
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          iconCreateFunction: function (cluster) {
            const count = cluster.getChildCount();

            // 火山聚类：调用 L.GeoMarker 工厂
            if (isVolcanoCluster) {
              return L.GeoMarker.createVolcanoClusterIcon(layerColor, count);
            }

            // 热点聚类：调用 L.GeoMarker 工厂
            if (isHotspotCluster) {
              return L.GeoMarker.createHotspotClusterIcon(layerColor, count);
            }

            // 默认聚类：调用 L.GeoMarker 工厂
            return L.GeoMarker.createDefaultClusterIcon(layerColor, count);
          },
        });
      }

      // 根据几何类型判断是否需要跨180度副本
      const mainGeomType = window.GeoUtils.detectMainGeomType(geojsonData);
      const isLineOrPolygon =
        mainGeomType === "linestring" ||
        mainGeomType === "multilinestring" ||
        mainGeomType === "polygon" ||
        mainGeomType === "multipolygon";
      // 线/面始终做三个副本；点要素只在≤3000时做副本（避免内存爆炸）
      const totalPoints = geojsonData.features
        ? geojsonData.features.length
        : 0;
      const useWorldCopy = isPointType
        ? totalPoints > 0 && totalPoints <= 3000
        : isLineOrPolygon;
      const offsets = useWorldCopy ? [-360, 0, 360] : [0];
      const geoLayers = [];
      const clusterGroups = [];
      const allMarkers = [];

      offsets.forEach(function (offset) {
        const shifted = window.GeoUtils.shiftGeoJSON(geojsonData, offset);
        if (
          shifted.type === "FeatureCollection" &&
          Array.isArray(shifted.features)
        ) {
          shifted.features.forEach(function (f, idx) {
            f._featureIndex = geojsonData.features[idx]
              ? geojsonData.features[idx]._featureIndex
              : idx;
          });
        }

        const firstFeature = shifted.features?.find((f) => f.geometry);
        const firstGeomType = (
          firstFeature?.geometry?.type || ""
        ).toLowerCase();
        const isPointType =
          firstGeomType === "point" || firstGeomType === "multipoint";

        if (isPointType) {
          const features = shifted.features || [];
          const totalFeatures = features.length;
          const originalCount = geojsonData.features
            ? geojsonData.features.length
            : 0;

          // 大数据集：Canvas 渲染（零 DOM 节点，支持 45 万+ 点）
          // 用原始要素数判断，不受世界副本（×3）影响
          if (originalCount > 3000) {
            const canvasLayer = L.markersCanvas({ clustering: clusterEnabled });

            // 构建要素数组 [{ lat, lng, color, _idx }]
            // 注意：不持有 _original 完整引用，否则 45 万点直接爆内存
            const featuresArray = [];
            for (let i = 0; i < features.length; i++) {
              const f = features[i];
              if (!f || !f.geometry || !f.geometry.coordinates) continue;
              const c = f.geometry.coordinates;
              const idx = f._featureIndex || i;
              const color = getFeatureFillColor(f, checkboxId, fileName, idx);
              featuresArray.push({
                lat: c[1],
                lng: c[0],
                color: color,
                _idx: idx,
                properties: f.properties || null, // 弹窗需要 properties
              });
            }

            canvasLayer.setFeatures(featuresArray);

            // 缓存 featuresArray 供颜色快速切换（避免重新读取数据）
            canvasFeaturesCache[checkboxId] = featuresArray;

            // 点击回调：所有数据集均设置（f 即 featuresArray 元素，含完整属性）
            canvasLayer.options.onFeatureClick = function (f, latlng) {
              const content = window.GeoUtils.buildPopupContent(f, fileName);
              if (content) {
                L.popup({ maxWidth: 300 })
                  .setLatLng(latlng)
                  .setContent(content)
                  .openOn(map);
              }
            };

            geoLayers.push(canvasLayer);
          } else if (!isNoCluster) {
            // 小数据集 + 聚类开启：DOM 聚类
            const clusterGroup = createClusterGroup();
            // 注意：不在这里 addTo(map)，统一由层组管理，避免重复添加/移除混乱

            const markers = [];
            L.geoJSON(shifted, {
              pointToLayer: function (feature, latlng) {
                const idx = feature._featureIndex || 0;
                const color = getFeatureFillColor(
                  feature,
                  checkboxId,
                  fileName,
                  idx,
                );
                const labelText = feature.properties
                  ? feature.properties[labelField] || null
                  : null;

                const marker = L.GeoMarker.createPointMarkerByType(
                  map,
                  feature,
                  latlng,
                  color,
                  labelEnabled ? labelText : null,
                  isVolcanoLayer,
                  isHotspotLayer,
                );

                const content = window.GeoUtils.buildPopupContent(
                  feature,
                  fileName,
                );
                if (content) marker.bindPopup(content, { maxWidth: 300 });

                marker.on("click", function (e) {
                  const hlStyle = {
                    color: "#ffff00",
                    weight: 3,
                    opacity: 1,
                    fillOpacity: 0.9,
                    dashArray: "6, 3",
                  };
                  try {
                    marker.setStyle(hlStyle);
                  } catch (err) {}
                  if (content) marker.openPopup();
                  L.DomEvent.stop(e);
                });

                marker.on("dblclick", function (e) {
                  try {
                    map.setView(latlng, map.getZoom() + 2, { animate: true });
                  } catch (err) {}
                  if (content) marker.openPopup();
                  L.DomEvent.stop(e);
                });

                return marker;
              },
            }).eachLayer(function (layer) {
              markers.push(layer);
            });

            clusterGroup.addLayers(markers);
            clusterGroups.push(clusterGroup);
            geoLayers.push(clusterGroup);
          } else {
            // 小数据集 + 聚类关闭：DOM 无聚类
            const geoLayer = L.geoJSON(shifted, {
              pointToLayer: function (feature, latlng) {
                const idx = feature._featureIndex || 0;
                const color = getFeatureFillColor(
                  feature,
                  checkboxId,
                  fileName,
                  idx,
                );
                const labelText = feature.properties
                  ? feature.properties[labelField] || null
                  : null;
                const marker = L.GeoMarker.createPointMarkerByType(
                  map,
                  feature,
                  latlng,
                  color,
                  labelEnabled ? labelText : null,
                  isVolcanoLayer,
                  isHotspotLayer,
                );
                marker.bindPopup(
                  window.GeoUtils.buildPopupContent(feature, fileName),
                  { maxWidth: 300 },
                );
                return marker;
              },
            });
            // 注意：不在这里 addTo(map)，统一由层组管理，避免重复添加/移除混乱
            geoLayers.push(geoLayer);
          }
        } else {
          // 面/线要素 + 点要素（聚类关闭时）
          const geoLayer = L.geoJSON(shifted, {
            pointToLayer: function (feature, latlng) {
              const idx = feature._featureIndex || 0;
              const color = getFeatureFillColor(
                feature,
                checkboxId,
                fileName,
                idx,
              );
              const labelText = feature.properties
                ? feature.properties[labelField] || null
                : null;

              const marker = L.GeoMarker.createPointMarkerByType(
                map,
                feature,
                latlng,
                color,
                labelEnabled ? labelText : null,
                isVolcanoLayer,
                isHotspotLayer,
              );

              marker.bindPopup(
                window.GeoUtils.buildPopupContent(feature, fileName),
                { maxWidth: 300 },
              );
              return marker;
            },
            style: function (feature) {
              return getGeoJsonStyle(
                feature,
                checkboxId,
                fileName,
                feature._featureIndex || 0,
              );
            },
            onEachFeature: function (feature, layer) {
              const geomType = (feature.geometry?.type || "").toLowerCase();
              const isPoint = geomType === "point" || geomType === "multipoint";
              if (isPoint) return;

              // 标签：mouseover/mouseout 事件驱动（拖动时零开销）
              _bindHoverLabel(layer);

              layer.on("click", function (e) {
                const idx = feature._featureIndex || 0;
                const baseStyle = getGeoJsonStyle(
                  feature,
                  checkboxId,
                  fileName,
                  idx,
                );
                const hlStyle = window.GeoUtils.buildHighlightStyle(baseStyle);
                applyHighlight(checkboxId, feature._featureIndex, hlStyle);
                const content = window.GeoUtils.buildPopupContent(
                  feature,
                  fileName,
                );
                if (content)
                  layer.bindPopup(content, { maxWidth: 300 }).openPopup();
                L.DomEvent.stop(e);
              });

              layer.on("dblclick", function (e) {
                const idx = feature._featureIndex || 0;
                const baseStyle = getGeoJsonStyle(
                  feature,
                  checkboxId,
                  fileName,
                  idx,
                );
                const hlStyle = window.GeoUtils.buildHighlightStyle(baseStyle);
                applyHighlight(checkboxId, feature._featureIndex, hlStyle);
                try {
                  if (layer.getBounds) {
                    const bounds = layer.getBounds();
                    if (bounds.isValid())
                      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
                  }
                } catch (err) {}
                const content = window.GeoUtils.buildPopupContent(
                  feature,
                  fileName,
                );
                if (content)
                  layer.bindPopup(content, { maxWidth: 300 }).openPopup();
                L.DomEvent.stop(e);
              });
            },
          });

          // 注意：不在这里 addTo(map)，统一由层组管理，避免重复添加/移除混乱
          geoLayers.push(geoLayer);
        }
      });

      highlightState[checkboxId] = {
        geoLayers: geoLayers,
        clusterGroups: clusterGroups,
        allMarkers: allMarkers,
        featureId: null,
        fileName: fileName,
      };

      return L.featureGroup(geoLayers);
    }

    // ========== 图层加载 ==========
    // 使用 Leaflet.GzIdbLoader 加载（仅 gz，自动解压 + IDB 缓存）
    function fetchGzGeoJSON(filePath) {
      return L.GzIdbLoader.fetch(filePath);
    }

    function loadGeoJSONLayer(filePath, checkboxId, fitBoundsAfterLoad) {
      // 根据优先级计算回退路径
      var localFallback = null;
      if (filePath.startsWith("http")) {
        // 主路径是 COS → 回退到本地
        localFallback = window.geoJsonBasePath + filePath.split("/").pop();
      } else {
        // 主路径是本地 → 回退到 COS
        localFallback = window.geoJsonCosPath + filePath.split("/").pop();
      }
      if (layerCache[checkboxId]) {
        layerCache[checkboxId].addTo(map);
        const state = highlightState[checkboxId];
        if (state && state.geoLayers)
          state.geoLayers.forEach(function (gl) {
            try {
              gl.addTo(map);
            } catch (e) {}
          });
        updateLayerItemStatus(checkboxId, "loaded");
        if (fitBoundsAfterLoad) {
          try {
            const b = layerBoundsCache[checkboxId];
            if (b && b.isValid && b.isValid())
              optimizedFitBounds(b, { padding: [30, 30], animate: true });
          } catch (e) {}
        }
        fireLoadedCallback(checkboxId);
        return;
      }

      const fileName = filePath.split("/").pop();
      updateLayerItemStatus(checkboxId, "loading");

      function onDataLoaded(data) {
        const data_ = data;
        console.log(
          `[DEBUG] ${fileName}: 加载成功, features: ${data_.features?.length || 0}`,
        );

        const geomType = window.GeoUtils.detectMainGeomType(data_);
        _geomTypeCache[fileName] = geomType;

        if (colorMode[checkboxId] === undefined) {
          const isPolygon =
            geomType === "polygon" || geomType === "multipolygon";
          if (
            fileName === "hotspots.json" ||
            fileName === "volcanos.json" ||
            fileName === "hydrothermal_vents.geojson"
          ) {
            colorMode[checkboxId] = "single";
          } else if (isPolygon) {
            colorMode[checkboxId] = "sequential";
          } else {
            colorMode[checkboxId] = "single";
          }
        }

        const worldCopyGroup = buildGeoJsonLayerGroup(
          data_,
          checkboxId,
          fileName,
        );
        layerCache[checkboxId] = worldCopyGroup;
        worldCopyGroup.addTo(map);

        const boundsObj = window.GeoUtils.computeBounds
          ? window.GeoUtils.computeBounds(data_)
          : null;
        if (boundsObj && boundsObj.isValid && boundsObj.isValid()) {
          layerBoundsCache[checkboxId] = boundsObj;
        } else {
          const fakeLayer = L.geoJSON(data_, {
            style: function () {
              return { opacity: 0, fillOpacity: 0 };
            },
          });
          layerBoundsCache[checkboxId] = fakeLayer;
        }

        if (fitBoundsAfterLoad) {
          try {
            const b = baseGeoJson.getBounds();
            if (b.isValid())
              optimizedFitBounds(b, { padding: [6, 6], animate: true });
          } catch (e) {}
        }
        updateLayerItemStatus(checkboxId, "loaded");

        if (!searchIndexMap[checkboxId]) {
          const cb = document.getElementById(checkboxId);
          const layerLabel = cb ? cb.dataset.layerName || fileName : fileName;
          // 确保 registry 有这条记录（UI 初始化时不一定注册了所有图层）
          if (!searchRegistry.find((e) => e.checkboxId === checkboxId)) {
            searchRegistry.push({
              layerLabel: layerLabel,
              groupName: cb ? cb.dataset.groupName || "" : "",
              checkboxId: checkboxId,
              fileName: fileName,
            });
          }
          if (data_.features) {
            // 无论索引是否构建成功，始终缓存原始 features 供要素搜索兜底
            featureCache[checkboxId] = data_.features;
            searchIndexingCount++;
            updateSearchInputState();
            // 内置图层：用 fileName 作为 cacheKey，支持 IDB 缓存恢复
            var _idxToast = showToast(
              "⏳ " + layerLabel + " 正在建立搜索索引…",
              { duration: 0 },
            );
            buildSearchIndex(checkboxId, data_.features, fileName, function () {
              searchIndexingCount--;
              updateSearchInputState();
              if (_idxToast) closeToast(_idxToast);
              showToast("✅ " + layerLabel + " 搜索索引就绪", {
                duration: 3000,
              });
              // 搜索索引构建完成后触发回调
              fireLoadedCallback(checkboxId);
            });
          } else {
            fireLoadedCallback(checkboxId);
          }
        } else {
          fireLoadedCallback(checkboxId);
        }
      }

      function fireLoadedCallback(checkboxId) {
        if (_loadedCallbacks[checkboxId]) {
          _loadedCallbacks[checkboxId]();
          delete _loadedCallbacks[checkboxId];
        }
      }

      fetchGzGeoJSON(filePath)
        .then(onDataLoaded)
        .catch(function (error) {
          if (localFallback) {
            console.warn(
              "[GeoJSONLoader] 主路径加载失败，回退备选路径:",
              filePath,
            );
            fetchGzGeoJSON(localFallback)
              .then(onDataLoaded)
              .catch(function (err) {
                console.error("GeoJSON加载失败：", err);
                updateLayerItemStatus(checkboxId, "error");
                var cb2 = document.getElementById(checkboxId);
                if (cb2) {
                  cb2.checked = false;
                  cb2.style.background = "#fff";
                }
                syncSelectAllStatus();
                isMapZooming = false;
              });
          } else {
            console.error("GeoJSON加载失败：", error);
            updateLayerItemStatus(checkboxId, "error");
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
              checkbox.checked = false;
              checkbox.style.background = "#fff";
            }
            syncSelectAllStatus();
            isMapZooming = false;
          }
        });
    }

    function reloadLayerWithNewMode(checkboxId, newMode, newColor, newField) {
      // 更新颜色模式
      colorMode[checkboxId] = newMode;
      if (newMode === "single" && newColor)
        layerColorMap[checkboxId] = newColor;
      if (newMode === "field") fieldKey[checkboxId] = newField;

      // 检测是否为 Canvas 渲染的图层（>10K 点）
      var cached = layerCache[checkboxId];
      var canvasLayer = null;
      if (cached && typeof cached.getLayers === "function") {
        var layers = cached.getLayers();
        for (var i = 0; i < layers.length; i++) {
          if (typeof layers[i].setFeatures === "function") {
            canvasLayer = layers[i];
            break;
          }
        }
      }

      if (canvasLayer) {
        // Canvas 图层：利用缓存中的 featuresArray 增量更新颜色
        var cachedFeatures = canvasFeaturesCache[checkboxId] || null;

        if (cachedFeatures) {
          // 所有颜色模式均可增量更新：利用缓存中的 properties 重新计算颜色
          var cb = document.getElementById(checkboxId);
          var cFileName = cb ? (cb.value || "").split("/").pop() : "";
          var total = cachedFeatures.length;
          // 大数据集分片执行，避免冻结 UI（每帧处理 2 万点）
          if (total > 20000) {
            var chunkSize = 20000;
            var offset = 0;
            function processChunk() {
              var end = Math.min(offset + chunkSize, total);
              for (var j = offset; j < end; j++) {
                cachedFeatures[j].color = getFeatureFillColor(
                  { properties: cachedFeatures[j].properties },
                  checkboxId,
                  cFileName,
                  cachedFeatures[j]._idx || j,
                );
              }
              offset = end;
              if (offset < total) {
                requestAnimationFrame(processChunk);
              } else {
                canvasLayer.updateColors();
                updateColorBtnHint(checkboxId);
              }
            }
            requestAnimationFrame(processChunk);
          } else {
            for (var j = 0; j < total; j++) {
              cachedFeatures[j].color = getFeatureFillColor(
                { properties: cachedFeatures[j].properties },
                checkboxId,
                cFileName,
                cachedFeatures[j]._idx || j,
              );
            }
            canvasLayer.updateColors();
            updateColorBtnHint(checkboxId);
          }
          return;
        }

        // 无法优化（如 "field" 模式且未缓存字段值），回退到重新读取数据
        var fileName = null;
        var geojsonPromise;

        if (userLayerGeoJson[checkboxId]) {
          fileName = userLayerGeoJson[checkboxId].fileName;
          geojsonPromise = Promise.resolve(
            userLayerGeoJson[checkboxId].geoJsonData,
          );
        } else {
          var checkbox = document.getElementById(checkboxId);
          if (checkbox) {
            fileName = checkbox.value.split("/").pop();
            geojsonPromise = L.GzIdbLoader.fetch(checkbox.value);
          }
        }

        if (geojsonPromise) {
          geojsonPromise
            .then(function (geojsonData) {
              var features = geojsonData.features || [];
              var featuresArray = [];
              for (var j = 0; j < features.length; j++) {
                var f = features[j];
                if (!f || !f.geometry || !f.geometry.coordinates) continue;
                var c = f.geometry.coordinates;
                var idx = f._featureIndex || j;
                var color = getFeatureFillColor(f, checkboxId, fileName, idx);
                featuresArray.push({
                  lat: c[1],
                  lng: c[0],
                  color: color,
                  _idx: idx,
                  properties: f.properties || null,
                });
              }
              canvasLayer.setFeatures(featuresArray);
              // 缓存更新后的 featuresArray，供后续颜色快速切换
              canvasFeaturesCache[checkboxId] = featuresArray;
              updateColorBtnHint(checkboxId);
            })
            .catch(function () {
              updateColorBtnHint(checkboxId);
            });
        } else {
          updateColorBtnHint(checkboxId);
        }
      } else {
        // 非 Canvas 图层：原有逻辑（清除缓存重建）
        var savedData = userLayerGeoJson[checkboxId] || null;
        clearHighlight(checkboxId);
        const oldState = highlightState[checkboxId];
        if (oldState) {
          if (oldState.geoLayers)
            oldState.geoLayers.forEach((gl) => {
              try {
                map.removeLayer(gl);
              } catch (e) {}
            });
          if (oldState.clusterGroups)
            oldState.clusterGroups.forEach((cg) => {
              try {
                map.removeLayer(cg);
              } catch (e) {}
            });
          highlightState[checkboxId] = null;
        }
        if (layerCache[checkboxId]) {
          map.removeLayer(layerCache[checkboxId]);
          layerCache[checkboxId] = null;
        }

        const checkbox = document.getElementById(checkboxId);
        if (checkbox && checkbox.checked) {
          if (savedData) {
            const data_ = savedData.geoJsonData; // 直接使用原始数据，三副本逻辑处理跨180显示
            const worldCopyGroup = buildGeoJsonLayerGroup(
              data_,
              checkboxId,
              savedData.fileName,
            );
            worldCopyGroup.addTo(map);
            layerCache[checkboxId] = worldCopyGroup;
          } else {
            loadGeoJSONLayer(checkbox.value, checkboxId, false);
          }
        }
        updateColorBtnHint(checkboxId);
      }
    }

    function refreshLayerColors(checkboxId) {
      const state = highlightState[checkboxId];
      if (!state || !state.geoLayers) return;
      const fileName = state.fileName || "";
      state.geoLayers.forEach(function (geoLayer) {
        geoLayer.eachLayer(function (layer) {
          if (layer.feature) {
            const idx = layer.feature._featureIndex || 0;
            const style = getGeoJsonStyle(
              layer.feature,
              checkboxId,
              fileName,
              idx,
            );
            try {
              layer.setStyle(style);
            } catch (e) {}
          }
        });
      });
    }

    // ========== 图层操作 ==========
    function flyToLayer(checkboxId) {
      const boundsObj = layerBoundsCache[checkboxId];
      // layerBoundsCache 存的是 L.LatLngBounds 对象（小数据）或直接是 Layer（旧逻辑）
      if (boundsObj && boundsObj.isValid && boundsObj.isValid()) {
        map.fitBounds(boundsObj, {
          padding: [20, 20],
          animate: true,
          maxZoom: 10,
        });
      } else {
        const layerObj = layerCache[checkboxId];
        if (layerObj) {
          try {
            const b = layerObj.getBounds ? layerObj.getBounds() : null;
            if (b && b.isValid && b.isValid())
              map.fitBounds(b, {
                padding: [20, 20],
                animate: true,
                maxZoom: 10,
              });
          } catch (e) {
            console.warn("无法定位：", e);
          }
        }
      }
    }

    function removeGeoJSONLayer(checkboxId) {
      clearHighlight(checkboxId);
      const state = highlightState[checkboxId];
      if (state) {
        if (state.geoLayers)
          state.geoLayers.forEach((gl) => {
            try {
              map.removeLayer(gl);
            } catch (e) {}
          });
        if (state.clusterGroups)
          state.clusterGroups.forEach((cg) => {
            try {
              map.removeLayer(cg);
            } catch (e) {}
          });
        highlightState[checkboxId] = null;
      }
      // 只从地图移除，不清除缓存，以便重新勾选时直接复用
      if (layerCache[checkboxId]) {
        map.removeLayer(layerCache[checkboxId]);
      }
      // layerBoundsCache 同样保留，flyToLayer 仍可用
      if (layerBoundsCache[checkboxId]) {
        // baseGeoJson 未添加到地图，无需 removeLayer
      }
      const checkbox = document.getElementById(checkboxId);
      if (checkbox) checkbox.style.background = "#fff";
      updateLayerItemStatus(checkboxId, "idle");
    }

    function selectAllLayers() {
      document
        .querySelectorAll('.layer-item input[type="checkbox"]')
        .forEach(function (cb) {
          if (!cb.checked) {
            cb.checked = true;
            cb.style.background = layerColorMap[cb.id] || "#fff";
            // 持久化勾选状态
            persistLayerCheckState(cb, true);
            // 用户上传图层无需加载，直接显示即可（已有 layerCache）
            if (!cb.dataset.userLayer) {
              loadGeoJSONLayer(cb.value, cb.id, false);
            } else if (layerCache[cb.id]) {
              layerCache[cb.id].addTo(map);
            }
          }
        });
      syncAllGroupStatus();
    }

    function unselectAllLayers() {
      document
        .querySelectorAll('.layer-item input[type="checkbox"]')
        .forEach(function (cb) {
          if (cb.checked) {
            cb.checked = false;
            cb.style.background = "#fff";
            // 持久化勾选状态
            persistLayerCheckState(cb, false);
            if (cb.dataset.userLayer) {
              if (layerCache[cb.id]) {
                try {
                  map.removeLayer(layerCache[cb.id]);
                } catch (e) {}
              }
              // layerBoundsCache[uid] 存的是轻量 bounds 包装对象，不是地图图层，无需 removeLayer
            } else {
              removeGeoJSONLayer(cb.id);
            }
          }
        });
      syncAllGroupStatus();
    }

    /** 保存单个图层 checkbox 的勾选状态到 localStorage */
    function persistLayerCheckState(cb, checked) {
      try {
        var key = cb.dataset.userLayer
          ? "dupal_user_layer_" + (cb.dataset.persistentId || cb.id)
          : "dupal_layer_" + cb.id;
        localStorage.setItem(key, String(checked));
      } catch (e) {}
    }

    // 展开 checkbox 所在的面板层级：子组 → section
    function expandToLayerGroup(cbOrId) {
      var cb =
        typeof cbOrId === "string" ? document.getElementById(cbOrId) : cbOrId;
      if (!cb) return;
      var group = cb.closest("details.layer-group");
      if (group) group.open = true;
      var section = cb.closest("details.layer-section, details.toggle-section");
      if (section && !section.open) section.open = true;
    }

    // ========== 状态同步 ==========
    function syncGroupStatus(groupDiv) {
      const groupCb = groupDiv.querySelector(".group-select-all");
      if (!groupCb) return;
      const items = groupDiv.querySelectorAll(
        '.layer-item input[type="checkbox"]',
      );
      const checkedCount = Array.from(items).filter((c) => c.checked).length;
      if (checkedCount === 0) {
        groupCb.checked = false;
        groupCb.classList.remove("indeterminate");
      } else if (checkedCount === items.length) {
        groupCb.checked = true;
        groupCb.classList.remove("indeterminate");
      } else {
        groupCb.checked = false;
        groupCb.classList.add("indeterminate");
      }
    }

    function syncAllGroupStatus() {
      document.querySelectorAll(".layer-group").forEach(syncGroupStatus);
      syncSelectAllStatus();
    }

    function syncSelectAllStatus() {
      if (!selectAllCheckbox) return;
      const all = Array.from(
        document.querySelectorAll('.layer-item input[type="checkbox"]'),
      );
      const checkedCount = all.filter((c) => c.checked).length;
      if (checkedCount === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.classList.remove("indeterminate");
      } else if (checkedCount === all.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.classList.remove("indeterminate");
      } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.classList.add("indeterminate");
      }
    }

    function updateGroupStatus(groupDiv, status) {
      const gs = groupDiv.querySelector(".group-status");
      if (!gs) return;
      gs.dataset.status = status;
      gs.title =
        {
          idle: "",
          loading: "加载中...",
          loaded: "全部已加载",
          partial: "部分加载",
          error: "加载出错",
        }[status] || status;
      // 纯色圆点，无需 textContent
    }

    function syncGroupLoadingStatus(groupDiv) {
      const items = groupDiv.querySelectorAll(
        '.layer-item input[type="checkbox"]',
      );
      const statusSpans = groupDiv.querySelectorAll(".layer-status");
      let loadingCount = 0,
        loadedCount = 0,
        errorCount = 0,
        checkedCount = 0;
      items.forEach(function (cb, idx) {
        if (cb.checked) {
          checkedCount++;
          const s = statusSpans[idx] && statusSpans[idx].dataset.status;
          if (s === "loading") loadingCount++;
          else if (s === "loaded") loadedCount++;
          else if (s === "error") errorCount++;
        }
      });
      if (loadingCount > 0) updateGroupStatus(groupDiv, "loading");
      else if (errorCount > 0 && loadedCount === 0)
        updateGroupStatus(groupDiv, "error");
      else if (loadedCount > 0 && loadedCount < checkedCount)
        updateGroupStatus(groupDiv, "partial");
      else if (loadedCount > 0 && loadedCount === checkedCount)
        updateGroupStatus(groupDiv, "loaded");
      else updateGroupStatus(groupDiv, "idle");
    }

    function updateLayerItemStatus(checkboxId, status) {
      const li = document.querySelector(
        `.layer-item[data-layer-id="${checkboxId}"]`,
      );
      if (!li) return;
      const ss = li.querySelector(".layer-status");
      if (!ss) return;
      ss.dataset.status = status;
      ss.title =
        {
          idle: "未加载",
          loading: "加载中...",
          loaded: "已加载（点击下载）",
          error: "加载失败",
        }[status] || status;
      const gd = li.closest(".layer-group");
      if (gd) syncGroupLoadingStatus(gd);
      // 状态变更后同步勾选框状态（解决加载完成后勾选框未同步的问题）
      if (gd) syncGroupStatus(gd);
      // 同步图层要素面板全选状态
      syncSelectAllStatus();
      // 同步本地图层面板全选状态
      var localCb = document.querySelector(
        ".layer-section > summary > .group-select-all",
      );
      if (localCb) {
        var localItems = document.querySelectorAll(
          '#userLayerGroup .layer-item input[type="checkbox"]',
        );
        var checkedCount = Array.from(localItems).filter(function (c) {
          return c.checked;
        }).length;
        if (checkedCount === 0) {
          localCb.checked = false;
          localCb.classList.remove("indeterminate");
        } else if (checkedCount === localItems.length) {
          localCb.checked = true;
          localCb.classList.remove("indeterminate");
        } else {
          localCb.checked = false;
          localCb.classList.add("indeterminate");
        }
      }
    }

    // ========== 下载图层 GeoJSON ==========
    function downloadLayerGeoJson(checkboxId, filePath, layerName) {
      // 用户上传图层：直接从内存取原始数据
      if (userLayerGeoJson[checkboxId]) {
        var gd = userLayerGeoJson[checkboxId].geoJsonData;
        var fn = userLayerGeoJson[checkboxId].fileName || layerName || "layer";
        triggerDownload(gd, fn.replace(/\.\w+$/, "") + ".geojson");
        return;
      }
      // 预置图层：优先从搜索索引缓存取（避免大数据集重新 fetch）
      var si = searchIndexMap[checkboxId];
      if (si && si.features && si.features.length > 0) {
        var cleaned = si.features.map(function (f) {
          var c = { type: "Feature", properties: f.properties || {} };
          if (f.geometry) c.geometry = f.geometry;
          return c;
        });
        triggerDownload(
          { type: "FeatureCollection", features: cleaned },
          (layerName || checkboxId) + ".geojson",
        );
        return;
      }
      // 预置图层：回退到重新 fetch
      if (filePath) {
        L.GzIdbLoader.fetch(filePath)
          .then(function (data) {
            triggerDownload(data, (layerName || "layer") + ".geojson");
          })
          .catch(function () {
            alert("下载失败：无法获取图层数据");
          });
      } else {
        alert("下载失败：找不到图层数据源");
      }
    }

    function triggerDownload(geoJsonObj, fileName) {
      var str = JSON.stringify(geoJsonObj, null, 2);
      var blob = new Blob([str], { type: "application/geo+json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // ========== 颜色按钮提示 ==========
    function getColorModeLabel(checkboxId) {
      const mode = colorMode[checkboxId] || "sequential";
      if (mode === "single") return "单一颜色";
      if (mode === "sequential") return "内部多颜色";
      if (mode === "field") return "按: " + (fieldKey[checkboxId] || "");
      return "内部多颜色";
    }

    function updateColorBtnHint(checkboxId) {
      const li = document.querySelector(
        `.layer-item[data-layer-id="${checkboxId}"]`,
      );
      if (!li) return;
      const btn = li.querySelector(".layer-color-btn");
      if (btn) btn.title = "颜色模式：" + getColorModeLabel(checkboxId);
    }

    // ========== 颜色设置弹窗 ==========
    let colorModalOverlay = null;
    let colorModalData = null;

    function getColorModalHTML(checkboxId, fileName, availableFields) {
      const mode = colorMode[checkboxId] || "sequential";
      const currentField = fieldKey[checkboxId] || "";
      const currentColor = layerColorMap[checkboxId] || "#8B4513";
      const fieldOptions = availableFields
        .map(function (f) {
          return `<option value="${f}" ${f === currentField ? "selected" : ""}>${f}</option>`;
        })
        .join("");

      return `
        <div class="color-modal-content">
          <div class="color-modal-header">
            <span>颜色设置</span>
            <button class="color-modal-close" id="colorModalClose">&times;</button>
          </div>
          <div class="color-modal-body">
            <div class="color-mode-group">
              <label class="color-mode-option">
                <input type="radio" name="colorModeRadio" value="single" ${mode === "single" ? "checked" : ""}>
                <span>单一颜色</span>
              </label>
              <label class="color-mode-option">
                <input type="radio" name="colorModeRadio" value="sequential" ${mode === "sequential" ? "checked" : ""}>
                <span>内部多颜色（全部不同）</span>
              </label>
              <label class="color-mode-option">
                <input type="radio" name="colorModeRadio" value="field" ${mode === "field" ? "checked" : ""}>
                <span>内部多颜色（按字段分色）</span>
              </label>
            </div>
            <div id="singleColorPanel" style="display:${mode === "single" ? "block" : "none"};margin-top:10px;">
              <label style="font-size:12px;color:#555;">选择颜色：</label>
              <input type="color" id="modalColorPicker" value="${currentColor}" style="margin-left:8px;cursor:pointer;">
              <span id="modalColorHex" style="font-size:12px;color:#888;margin-left:6px;">${currentColor}</span>
            </div>
            <div id="fieldColorPanel" style="display:${mode === "field" ? "block" : "none"};margin-top:10px;">
              <label style="font-size:12px;color:#555;">选择字段：</label>
              <select id="modalFieldSelect" style="margin-left:8px;max-width:180px;">
                ${fieldOptions || '<option value="">无可用字段</option>'}
              </select>
            </div>
          </div>
          <div class="color-modal-footer">
            <button id="colorModalCancel" style="padding:5px 12px;cursor:pointer;">取消</button>
            <button id="colorModalConfirm" style="padding:5px 12px;cursor:pointer;background:#4a8c4a;color:#fff;border:1px solid #3a6c3a;border-radius:3px;">确认</button>
          </div>
        </div>`;
    }

    function openColorModal(checkboxId, fileName, filePath) {
      if (colorModalOverlay) {
        colorModalOverlay.remove();
        colorModalOverlay = null;
      }

      // 获取 GeoJSON 数据：优先从搜索索引缓存取（避免大数据集重新 fetch 300MB）
      // 搜索索引的 features 是原始 data_.features 引用，包含完整 properties
      var si = searchIndexMap[checkboxId];
      if (si && si.features) {
        // 构造轻量伪 GeoJSON 供 getAvailableFields 取字段名
        var cachedData = {
          type: "FeatureCollection",
          features: si.features.slice(0, 50),
        };
        var fields = window.GeoUtils.getAvailableFields(cachedData);
        showColorModalContent(checkboxId, fileName, filePath, fields);
      } else if (filePath) {
        function doFetch(p) {
          fetchGzGeoJSON(p).then(function (data) {
            var fields = window.GeoUtils.getAvailableFields(data);
            showColorModalContent(checkboxId, fileName, filePath, fields);
          });
        }
        if (filePath.startsWith("http")) {
          fetchGzGeoJSON(filePath)
            .then(function (data) {
              var fields = window.GeoUtils.getAvailableFields(data);
              showColorModalContent(checkboxId, fileName, filePath, fields);
            })
            .catch(function () {
              doFetch(window.geoJsonBasePath + fileName);
            });
        } else {
          doFetch(filePath);
        }
      } else if (userLayerGeoJson[checkboxId]) {
        var fields = window.GeoUtils.getAvailableFields(
          userLayerGeoJson[checkboxId].geoJsonData,
        );
        showColorModalContent(checkboxId, fileName, filePath, fields);
      } else {
        alert("无法加载图层数据，请尝试重新添加图层。");
      }
    }

    function showColorModalContent(checkboxId, fileName, filePath, fields) {
      colorModalData = {
        checkboxId: checkboxId,
        fileName: fileName,
        filePath: filePath,
      };

      colorModalOverlay = document.createElement("div");
      colorModalOverlay.id = "colorModalOverlay";
      colorModalOverlay.innerHTML = getColorModalHTML(
        checkboxId,
        fileName,
        fields,
      );
      colorModalOverlay.style.cssText =
        "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.35);z-index:99999;display:flex;align-items:center;justify-content:center;";
      document.body.appendChild(colorModalOverlay);

      document
        .querySelectorAll('input[name="colorModeRadio"]')
        .forEach(function (r) {
          r.addEventListener("change", function () {
            document.getElementById("singleColorPanel").style.display =
              this.value === "single" ? "block" : "none";
            document.getElementById("fieldColorPanel").style.display =
              this.value === "field" ? "block" : "none";
          });
        });

      var colorPicker = document.getElementById("modalColorPicker");
      if (colorPicker) {
        colorPicker.addEventListener("input", function () {
          var hexSpan = document.getElementById("modalColorHex");
          if (hexSpan) hexSpan.textContent = this.value;
        });
        colorPicker.addEventListener("change", function () {
          var selMode = document.querySelector(
            'input[name="colorModeRadio"]:checked',
          );
          var newMode = selMode ? selMode.value : "sequential";
          if (newMode === "single") {
            layerColorMap[colorModalData.checkboxId] = this.value;
            refreshLayerColors(colorModalData.checkboxId);
          }
        });
      }

      document.getElementById("colorModalClose").onclick = closeColorModal;
      document.getElementById("colorModalCancel").onclick = closeColorModal;
      colorModalOverlay.addEventListener("click", function (e) {
        if (e.target === colorModalOverlay) closeColorModal();
      });

      document.getElementById("colorModalConfirm").onclick = function () {
        if (!colorModalData) return;
        const selMode = document.querySelector(
          'input[name="colorModeRadio"]:checked',
        );
        const newMode = selMode ? selMode.value : "sequential";
        const newColor = document.getElementById("modalColorPicker")
          ? document.getElementById("modalColorPicker").value
          : layerColorMap[colorModalData.checkboxId];
        const newField = document.getElementById("modalFieldSelect")
          ? document.getElementById("modalFieldSelect").value
          : "";
        reloadLayerWithNewMode(
          colorModalData.checkboxId,
          newMode,
          newColor,
          newField,
        );
        closeColorModal();
      };
    }

    function closeColorModal() {
      if (colorModalOverlay) {
        colorModalOverlay.remove();
        colorModalOverlay = null;
      }
      colorModalData = null;
    }

    // ========== 生成分组图层面板 ==========
    let globalLayerIndex = 0;

    function generateLayerItems() {
      // ====== 数据图层区：子组填充 ======
      var layerContent = document.getElementById("dataLayerContent");

      // 全选/全不选复选框
      selectAllCheckbox = document.getElementById("selectAllLayers");
      if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener("change", function () {
          this.classList.remove("indeterminate");
          if (this.checked) {
            selectAllLayers();
            document
              .querySelectorAll("details.layer-group")
              .forEach(function (d) {
                if (!d.open) d.open = true;
              });
          } else {
            unselectAllLayers();
          }
        });
      }

      // 帮助图标（已通过 data-dialog 属性在 dialog.js 声明式绑定）

      window.geoJsonGroups.forEach(function (group) {
        const isPlain = !group.groupName; // 无分组名 = 直接显示图层
        var groupDetails = null;
        var children;

        if (!isPlain) {
          groupDetails = document.createElement("details");
          groupDetails.className = "layer-group";

          var summary = document.createElement("summary");

          const arrow = document.createElement("span");
          arrow.className = "layer-group-arrow";
          arrow.textContent = "▶";

          const groupName = document.createElement("span");
          groupName.className = "layer-group-name";
          groupName.textContent = group.groupName;

          const groupStatus = document.createElement("span");
          groupStatus.className = "group-status";
          groupStatus.dataset.status = "idle";

          const groupCb = document.createElement("input");
          groupCb.type = "checkbox";
          groupCb.className = "group-select-all";
          groupCb.title = "全选/全不选「" + group.groupName + "」";
          groupCb.addEventListener("click", function (e) {
            e.stopPropagation();
          });
          groupCb.addEventListener("change", function () {
            this.classList.remove("indeterminate");
            var items = groupDetails.querySelectorAll(
              '.layer-item input[type="checkbox"]',
            );
            var isChecked = this.checked;
            items.forEach(function (cb) {
              if (isChecked && !cb.checked) {
                cb.checked = true;
                cb.style.background = layerColorMap[cb.id] || "#fff";
                persistLayerCheckState(cb, true);
                loadGeoJSONLayer(cb.value, cb.id, false);
              } else if (!isChecked && cb.checked) {
                cb.checked = false;
                cb.style.background = "#fff";
                persistLayerCheckState(cb, false);
                removeGeoJSONLayer(cb.id);
              }
            });
            syncSelectAllStatus();
            // 勾选时展开该组
            if (isChecked && !groupDetails.open) groupDetails.open = true;
          });

          children = document.createElement("div");
          children.className = "layer-group-children";

          // summary 点击处理：Ctrl/Cmd+点击 = 全部切换，普通点击由浏览器原生处理
          summary.addEventListener("click", function (e) {
            if (e.target === groupCb) return;
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault(); // 阻止 details 原生 toggle
              var allDetails = document.querySelectorAll("details.layer-group");
              var anyOpen = document.querySelector("details.layer-group[open]");
              allDetails.forEach(function (d) {
                d.open = !anyOpen;
              });
            }
            // 普通点击：浏览器自动处理 open 属性
          });

          summary.appendChild(arrow);
          summary.appendChild(groupName);
          summary.appendChild(groupStatus);
          summary.appendChild(groupCb);
          groupDetails.appendChild(summary);
        }

        if (isPlain) {
          children = document.createElement("div");
          children.className = "layer-plain";
        }

        group.layers.forEach(function (layerConfig) {
          var idx = globalLayerIndex++;
          var checkboxId = "layer_" + idx;
          var fullPath = window.geoJsonPrimaryPath + layerConfig.file;
          var fileName = layerConfig.file;
          var fixedColor =
            fileName === "hotspots.json" ||
            fileName === "volcanos.json" ||
            fileName === "hydrothermal_vents.geojson"
              ? "#FF3333"
              : window.GeoUtils.getFixedColor(idx);
          layerColorMap[checkboxId] = fixedColor;

          var layerItem = document.createElement("div");
          layerItem.className = "layer-item";
          layerItem.dataset.layerId = checkboxId;

          var checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.id = checkboxId;
          checkbox.value = fullPath;
          checkbox.dataset.layerName = layerConfig.name;
          checkbox.dataset.groupName = group.groupName || "";
          checkbox.style.setProperty("--layer-color", fixedColor);

          // 注册到搜索列表（即使图层尚未加载）
          if (
            !searchRegistry.find(function (e) {
              return e.checkboxId === checkboxId;
            })
          ) {
            searchRegistry.push({
              layerLabel: layerConfig.name,
              groupName: group.groupName || "",
              checkboxId: checkboxId,
              fileName: fileName,
            });
          }
          checkbox.addEventListener("change", function () {
            this.style.background = this.checked ? fixedColor : "#fff";
            // 勾选时展开到对应面板层级
            if (this.checked) expandToLayerGroup(this);
            // 持久化内置图层的勾选状态
            try {
              localStorage.setItem(
                "dupal_layer_" + checkboxId,
                String(this.checked),
              );
            } catch (e) {}
            syncAllGroupStatus();
            if (this.checked) loadGeoJSONLayer(fullPath, checkboxId, false);
            else removeGeoJSONLayer(checkboxId);
          });

          var label = document.createElement("label");
          label.htmlFor = checkboxId;
          label.textContent = layerConfig.name;
          label.title = layerConfig.name;

          var statusSpan = document.createElement("span");
          statusSpan.className = "layer-status";
          statusSpan.dataset.status = "idle";
          (function (cbId, fPath, fName) {
            statusSpan.addEventListener("click", function (e) {
              e.stopPropagation();
              if (statusSpan.dataset.status !== "loaded") return;
              downloadLayerGeoJson(cbId, fPath, fName);
            });
          })(checkboxId, fullPath, layerConfig.name);

          var colorBtn = document.createElement("button");
          colorBtn.className = "layer-color-btn";
          colorBtn.title = "颜色模式：内部多颜色";
          colorBtn.innerHTML = "🎨";
          colorBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            openColorModal(checkboxId, layerConfig.file, fullPath);
          });

          var locateBtn = document.createElement("button");
          locateBtn.className = "layer-locate-btn";
          locateBtn.title = "定位到此图层";
          locateBtn.innerHTML = "🔍";
          locateBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            flyToLayer(checkboxId);
          });

          layerItem.appendChild(checkbox);
          layerItem.appendChild(label);
          layerItem.appendChild(statusSpan);
          layerItem.appendChild(colorBtn);
          layerItem.appendChild(locateBtn);
          children.appendChild(layerItem);
        });

        if (groupDetails) {
          groupDetails.appendChild(children);
          layerContent.appendChild(groupDetails);
        } else {
          layerContent.appendChild(children);
        }
      });

      // ====== 本地图层查看面板：事件绑定（骨架已在 HTML 中） ======
      // 帮助图标已通过 data-dialog 属性在 dialog.js 声明式绑定

      // 本地图层全选/全不选
      var localSelectAll = document.getElementById("selectAllLocalLayers");
      if (localSelectAll) {
        localSelectAll.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        localSelectAll.addEventListener("change", function () {
          var items = document.querySelectorAll(
            '#userLayerGroup .layer-item input[type="checkbox"]',
          );
          var isChecked = this.checked;
          items.forEach(function (cb) {
            if (isChecked && !cb.checked) {
              cb.checked = true;
              var lc = layerCache[cb.id];
              cb.style.background = cb.style.getPropertyValue("--layer-color");
              persistLayerCheckState(cb, true);
              if (lc) lc.addTo(map);
            } else if (!isChecked && cb.checked) {
              cb.checked = false;
              cb.style.background = "#fff";
              persistLayerCheckState(cb, false);
              if (layerCache[cb.id]) map.removeLayer(layerCache[cb.id]);
            }
          });
        });
      }

      // 上传按钮
      var uploadBtn = document.getElementById("uploadBtn");
      var fileInput = document.getElementById("fileInput");
      if (uploadBtn && fileInput) {
        uploadBtn.addEventListener("click", function () {
          fileInput.click();
        });
        fileInput.addEventListener("change", handleFileUpload);
      }

      // 选择文件夹按钮
      var folderBtn = document.getElementById("folderBtn");
      var folderInput = document.getElementById("folderInput");
      if (folderBtn && folderInput) {
        folderBtn.addEventListener("click", function () {
          folderInput.click();
        });
        folderInput.addEventListener("change", handleFolderUpload);
      }
    }

    // ========== 文件上传 ==========
    function handleFileUpload(e) {
      var files = Array.from(e.target.files);
      e.target.value = "";
      files.forEach(function (file) {
        window.loadFileAsUserLayer(file);
      });
    }

    // ========== 文件夹上传 ==========
    function handleFolderUpload(e) {
      var allFiles = Array.from(e.target.files);
      e.target.value = "";
      if (!allFiles.length) return;

      // 建立文件名 → File 查找表（key = 文件名小写，含路径）
      var fileMap = {};
      allFiles.forEach(function (file) {
        fileMap[file.name.toLowerCase()] = file;
      });

      // --- 收集非 shp 文件 ---
      var nonShpExts = ["kml", "kmz", "json", "geojson"];
      var nonShpFiles = [];
      allFiles.forEach(function (file) {
        var ext = file.name.split(".").pop().toLowerCase();
        if (nonShpExts.indexOf(ext) !== -1) {
          nonShpFiles.push(file);
        }
      });

      // --- 收集 shp 文件并匹配配套 ---
      var shpFileNames = []; // baseName（不含扩展名）
      allFiles.forEach(function (file) {
        var name = file.name.toLowerCase();
        if (name.endsWith(".shp")) {
          // webkitdirectory 下同目录文件 name 可能含路径前缀，统一用文件名部分
          var baseName = file.name.replace(/\.shp$/i, "");
          if (shpFileNames.indexOf(baseName) === -1) {
            shpFileNames.push(baseName);
          }
        }
      });

      if (!nonShpFiles.length && !shpFileNames.length) {
        alert(
          "文件夹中未找到支持的矢量文件\n支持：shp、kml、kmz、json、geojson",
        );
        return;
      }

      window.showLoading("正在扫描文件夹...");
      var warnings = [];
      var shpTasks = [];

      // 解析非 shp 文件（走 loadFileAsUserLayer，传 autoShow=false 不自动显示）
      nonShpFiles.forEach(function (file) {
        window.loadFileAsUserLayer(file, false);
      });

      // 如果没有 shp 文件，直接关闭外层 loading
      if (!shpFileNames.length) {
        window.hideLoading();
        return;
      }

      // 解析 shp：为每个 .shp 找配套文件，用 JSZip 打包后喂给 shpjs
      if (typeof JSZip !== "undefined") {
        shpFileNames.forEach(function (baseName) {
          var companionExts = [".dbf", ".shx", ".prj"];
          var companions = [];
          var missing = [];

          // 查找配套文件（在 fileMap 中按 baseName+ext 匹配）
          companionExts.forEach(function (ce) {
            // webkitdirectory 返回的 file.name 可能是 "dir/basename.dbf" 形式
            var found = null;
            var key = baseName + ce;
            var keyLower = key.toLowerCase();

            for (var fname in fileMap) {
              if (fname === keyLower || fname.endsWith("/" + keyLower)) {
                found = fileMap[fname];
                break;
              }
            }

            if (found) {
              companions.push({ name: baseName + ce, file: found });
            } else {
              missing.push(ce);
            }
          });

          // 记录缺失文件（.dbf 是必须的，.shx/.prj 可选）
          if (missing.length > 0) {
            warnings.push(
              baseName + ".shp 缺少配套文件：" + missing.join("、"),
            );
          }

          // 至少有 .shp 本身（尝试解析，shpjs 可能会报错但不会崩溃）
          var shpFile = null;
          var shpKey = baseName + ".shp";
          var shpKeyLower = shpKey.toLowerCase();
          for (var fname in fileMap) {
            if (fname === shpKeyLower || fname.endsWith("/" + shpKeyLower)) {
              shpFile = fileMap[fname];
              break;
            }
          }

          if (!shpFile) return; // 理论上不会发生

          // 读取所有文件为 ArrayBuffer，打包成 zip
          var allParts = companions.concat([
            { name: baseName + ".shp", file: shpFile },
          ]);
          var readPromises = allParts.map(function (part) {
            return new Promise(function (resolve) {
              var reader = new FileReader();
              reader.onload = function (ev) {
                resolve({ name: part.name, buffer: ev.target.result });
              };
              reader.onerror = function () {
                resolve(null); // 读取失败跳过
              };
              reader.readAsArrayBuffer(part.file);
            });
          });

          shpTasks.push(
            Promise.all(readPromises).then(function (results) {
              var zip = new JSZip();
              results.forEach(function (r) {
                if (r && r.buffer) {
                  zip.file(r.name, r.buffer);
                }
              });
              return zip.generateAsync({ type: "arraybuffer" });
            }),
          );
        });

        // 批量执行 shp 解析
        Promise.allSettled(shpTasks).then(function (results) {
          var shpLoadPromises = [];
          results.forEach(function (result, idx) {
            if (result.status === "fulfilled" && typeof shp === "function") {
              var zipBuf = result.value;
              shpLoadPromises.push(
                shp(zipBuf)
                  .then(function (geojson) {
                    var name = shpFileNames[idx] + ".shp";
                    // shp 可能返回数组（多图层）
                    if (Array.isArray(geojson)) {
                      geojson.forEach(function (layer, li) {
                        var layerName =
                          geojson.length === 1
                            ? name
                            : name.replace(/\.shp$/i, "") + "_" + li + ".shp";
                        window.addUserLayer(layer, layerName, false);
                      });
                    } else {
                      window.addUserLayer(geojson, name, false);
                    }
                  })
                  .catch(function (err) {
                    warnings.push(
                      shpFileNames[idx] +
                        ".shp 解析失败：" +
                        (err.message || err),
                    );
                  }),
              );
            }
          });

          Promise.allSettled(shpLoadPromises).then(function () {
            window.hideLoading();
            var toggle = document.getElementById("sidebarToggle");
            if (toggle) toggle.checked = true;
            // 弹出缺失/失败的提示
            if (warnings.length > 0) {
              alert("SHP 加载提示：\n\n" + warnings.join("\n\n"));
            }
          });
        });
      } else {
        // JSZip 不可用，无法打包 shp 配套文件
        window.hideLoading();
        if (shpFileNames.length > 0) {
          alert(
            "JSZip 库尚未加载，无法解析 SHP 文件\n请检查网络连接后刷新页面。",
          );
        }
      }
    }

    let userLayerIndex = 0;
    const userLayerGeoJson = {};
    window._userLayerGeoJson = userLayerGeoJson; // 暴露给 index.html 的开关事件使用
    const USER_LAYER_STORAGE_KEY = "dupal_user_layers";

    // 检查「记住图层」开关状态
    function isRememberLayerEnabled() {
      var saved = localStorage.getItem("dupal_toggle_rememberLayer");
      return saved !== null ? saved === "true" : true; // 默认开启
    }

    // 保存用户图层信息到 localStorage（持久化列表）
    function saveUserLayerMeta(id, fileName) {
      var list = [];
      try {
        list = JSON.parse(localStorage.getItem(USER_LAYER_STORAGE_KEY) || "[]");
      } catch (e) {}
      if (
        !list.find(function (e) {
          return e.id === id;
        })
      ) {
        list.push({ id: id, fileName: fileName });
        localStorage.setItem(USER_LAYER_STORAGE_KEY, JSON.stringify(list));
      }
    }

    // 从 localStorage 删除用户图层记录
    function removeUserLayerMeta(id) {
      var list = [];
      try {
        list = JSON.parse(localStorage.getItem(USER_LAYER_STORAGE_KEY) || "[]");
      } catch (e) {}
      list = list.filter(function (e) {
        return e.id !== id;
      });
      localStorage.setItem(USER_LAYER_STORAGE_KEY, JSON.stringify(list));
    }

    // 页面初始化时从 IDB 恢复用户已上传的图层
    function restoreUserLayers() {
      var list = [];
      try {
        list = JSON.parse(localStorage.getItem(USER_LAYER_STORAGE_KEY) || "[]");
      } catch (e) {}
      list.forEach(function (meta) {
        L.GzIdbLoader.getCache("user_geo_" + meta.id).then(function (data) {
          if (!data) {
            // 缓存已丢失（如用户清除了浏览器数据），移除无效记录
            removeUserLayerMeta(meta.id);
            return;
          }
          // 恢复时检查该图层之前的勾选状态
          var wasChecked = true;
          try {
            var saved = localStorage.getItem("dupal_user_layer_" + meta.id);
            wasChecked = saved !== null ? saved === "true" : true;
          } catch (e) {}
          addUserLayer(data, meta.fileName, wasChecked, meta.id);
        });
      });
    }

    function addUserLayer(
      geojsonData,
      fileName,
      autoShow,
      existingPersistentId,
    ) {
      var uid = "user_layer_" + userLayerIndex++;
      // 恢复已有图层时使用原有的 persistentId，新上传时生成
      var persistentId =
        existingPersistentId ||
        Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      var fixedColor = window.GeoUtils.getFixedColor(globalLayerIndex++);
      layerColorMap[uid] = fixedColor;

      var data_ = geojsonData; // 直接使用原始数据，三副本逻辑处理跨180显示
      var mainGeomType = window.GeoUtils.detectMainGeomType(data_);
      colorMode[uid] =
        mainGeomType === "polygon" || mainGeomType === "multipolygon"
          ? "sequential"
          : "single";

      if (data_.type === "FeatureCollection" && Array.isArray(data_.features)) {
        data_.features.forEach(function (f, idx) {
          f._featureIndex = idx;
        });
      }

      var worldCopyGroup = buildGeoJsonLayerGroup(data_, uid, fileName);

      // autoShow 为 false 时：图层缓存但不添加到地图，checkbox 不勾选
      if (autoShow !== false) {
        worldCopyGroup.addTo(map);
      }
      layerCache[uid] = worldCopyGroup;
      userLayerGeoJson[uid] = {
        geoJsonData: data_,
        fileName: fileName,
        persistentId: persistentId,
      };

      // 直接从坐标数组计算 bounds，避免为45万点创建 L.geoJSON（会生成大量 DOM Marker 对象）
      try {
        var minLat = Infinity,
          maxLat = -Infinity,
          minLng = Infinity,
          maxLng = -Infinity;
        var feats = data_.features || [];
        for (var bi = 0; bi < feats.length; bi++) {
          var fg = feats[bi] && feats[bi].geometry;
          if (!fg) continue;
          var coords =
            fg.type === "Point"
              ? [fg.coordinates]
              : fg.type === "MultiPoint"
                ? fg.coordinates
                : fg.type === "LineString"
                  ? fg.coordinates
                  : fg.type === "MultiLineString"
                    ? [].concat.apply([], fg.coordinates)
                    : fg.type === "Polygon"
                      ? [].concat.apply([], fg.coordinates)
                      : fg.type === "MultiPolygon"
                        ? [].concat.apply(
                            [],
                            [].concat.apply([], fg.coordinates),
                          )
                        : [];
          for (var ci = 0; ci < coords.length; ci++) {
            var lng = coords[ci][0],
              lat = coords[ci][1];
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
          }
        }
        if (isFinite(minLat) && isFinite(maxLat)) {
          var b = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
          if (b.isValid()) {
            // 存一个轻量包装对象，供 flyToLayer 调用 .getBounds()，无任何 DOM/Marker 开销
            layerBoundsCache[uid] = {
              getBounds: function () {
                return b;
              },
            };
          }
        }
      } catch (e) {}

      var userGroup = document.getElementById("userLayerGroup");
      var layerItem = document.createElement("div");
      layerItem.className = "layer-item";
      layerItem.dataset.layerId = uid;

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = uid;
      checkbox.checked = autoShow !== false;
      checkbox.dataset.userLayer = "true";
      checkbox.dataset.persistentId = persistentId;
      checkbox.style.setProperty("--layer-color", fixedColor);
      checkbox.style.background = autoShow !== false ? fixedColor : "#fff";
      checkbox.addEventListener("change", function () {
        this.style.background = this.checked ? fixedColor : "#fff";
        // 勾选时展开到对应面板层级
        if (this.checked) expandToLayerGroup(this);
        if (this.checked) {
          if (layerCache[uid]) layerCache[uid].addTo(map);
        } else {
          if (layerCache[uid]) map.removeLayer(layerCache[uid]);
        }
        // 持久化用户图层的勾选状态
        try {
          localStorage.setItem(
            "dupal_user_layer_" + persistentId,
            String(this.checked),
          );
        } catch (e) {}
        // 同步本地图层面板全选状态
        var localCb = document.querySelector(
          ".layer-section > summary > .group-select-all",
        );
        if (localCb) {
          var items = document.querySelectorAll(
            '#userLayerGroup .layer-item input[type="checkbox"]',
          );
          var cc = Array.from(items).filter(function (c) {
            return c.checked;
          }).length;
          if (cc === 0) {
            localCb.checked = false;
            localCb.classList.remove("indeterminate");
          } else if (cc === items.length) {
            localCb.checked = true;
            localCb.classList.remove("indeterminate");
          } else {
            localCb.checked = false;
            localCb.classList.add("indeterminate");
          }
        }
      });
      // checkbox 创建时如果已勾选（如恢复），展开对应层级
      if (checkbox.checked) expandToLayerGroup(checkbox);

      var label = document.createElement("label");
      label.htmlFor = uid;
      label.textContent = fileName;
      label.title = fileName;

      var statusSpan = document.createElement("span");
      statusSpan.className = "layer-status";
      statusSpan.dataset.status = "loaded";
      statusSpan.title = "已加载（点击下载）";
      (function (cbId, fName) {
        statusSpan.addEventListener("click", function (e) {
          e.stopPropagation();
          if (statusSpan.dataset.status !== "loaded") return;
          downloadLayerGeoJson(cbId, null, fName);
        });
      })(uid, fileName);

      var colorBtn = document.createElement("button");
      colorBtn.className = "layer-color-btn";
      colorBtn.title = "颜色模式：内部多颜色";
      colorBtn.innerHTML = "🎨";
      colorBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        openColorModal(uid, fileName, null);
      });

      var locateBtn = document.createElement("button");
      locateBtn.className = "layer-locate-btn";
      locateBtn.title = "定位到此图层";
      locateBtn.innerHTML = "🔍";
      locateBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        flyToLayer(uid);
      });

      var removeBtn = document.createElement("button");
      removeBtn.className = "layer-locate-btn";
      removeBtn.title = "删除此图层";
      removeBtn.innerHTML = "✕";
      removeBtn.style.color = "#cc6666";
      removeBtn.addEventListener("click", function () {
        clearHighlight(uid);
        if (layerCache[uid]) map.removeLayer(layerCache[uid]);
        delete layerCache[uid];
        delete layerBoundsCache[uid];
        delete highlightState[uid];
        delete searchIndexMap[uid];
        delete featureCache[uid];
        // 从 searchRegistry 移除
        for (var ri = 0; ri < searchRegistry.length; ri++) {
          if (searchRegistry[ri].checkboxId === uid) {
            searchRegistry.splice(ri, 1);
            break;
          }
        }
        layerItem.remove();
        // 从 IDB 删除缓存
        L.GzIdbLoader.delCache("user_geo_" + persistentId);
        L.GzIdbLoader.deleteSearchIndex("user_" + persistentId);
        removeUserLayerMeta(persistentId);
        // 如果删光了，恢复空状态提示
        var ug = document.getElementById("userLayerGroup");
        var ht = document.getElementById("userLayerHint");
        if (ug && ht && ug.querySelectorAll(".layer-item").length === 0) {
          ht.style.display = "";
        }
      });

      layerItem.appendChild(checkbox);
      layerItem.appendChild(label);
      layerItem.appendChild(statusSpan);
      layerItem.appendChild(colorBtn);
      layerItem.appendChild(locateBtn);
      layerItem.appendChild(removeBtn);
      userGroup.appendChild(layerItem);
      // 隐藏空状态提示
      var hint = document.getElementById("userLayerHint");
      if (hint) hint.style.display = "none";

      if (!searchRegistry.find((e) => e.checkboxId === uid)) {
        featureCache[uid] = data_.features || [];
        searchRegistry.push({
          layerLabel: fileName,
          checkboxId: uid,
          fileName: fileName,
          features: data_.features || [],
        });
      }
      // 用户上传图层：持久化到 IDB（GeoJSON 数据 + 搜索索引）
      if (data_.features && data_.features.length) {
        var cacheKey = "user_" + persistentId;
        if (!existingPersistentId && isRememberLayerEnabled()) {
          // 新上传且开关打开：保存到 IDB 和 localStorage
          L.GzIdbLoader.setCache("user_geo_" + persistentId, geojsonData);
          saveUserLayerMeta(persistentId, fileName);
        }
        // 建立搜索索引并缓存到 IDB
        var _idxToast2 = showToast("⏳ " + fileName + " 正在建立搜索索引…", {
          duration: 0,
        });
        buildSearchIndex(uid, data_.features, cacheKey, function () {
          if (_idxToast2) closeToast(_idxToast2);
          showToast("✅ " + fileName + " 搜索索引就绪", { duration: 3000 });
        });
      }
    }

    window.addUserLayer = addUserLayer;

    // 处理 geojsonloader 就绪前收到的文件（File Handling API 早于脚本加载时）
    if (
      Array.isArray(window._pendingFiles) &&
      window._pendingFiles.length > 0
    ) {
      window._pendingFiles.forEach(function (file) {
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = JSON.parse(ev.target.result);
            addUserLayer(data, file.name);
            var toggle = document.getElementById("sidebarToggle");
            if (toggle) toggle.checked = true;
          } catch (err) {
            alert("GeoJSON 解析失败：" + file.name + "\n" + err.message);
          }
        };
        reader.readAsText(file);
      });
      window._pendingFiles = [];
    }

    // ========== 搜索功能 ==========
    // 更新搜索输入框状态（索引构建中时禁用并提示）
    function updateSearchInputState() {
      var inp = document.getElementById("searchInput");
      if (!inp) return;
      if (searchIndexingCount > 0) {
        inp.disabled = true;
        inp.placeholder = "建立搜索索引中...";
      } else {
        inp.disabled = false;
        inp.placeholder = "🔍 搜索图层名 / 要素属性";
      }
    }

    function initSearch() {
      var input = document.getElementById("searchInput");
      var resultsBox = document.getElementById("searchResults");
      if (!input || !resultsBox) return;

      // 初始化搜索输入框状态（显示是否有索引正在构建）
      updateSearchInputState();

      function buildSummary(props) {
        if (!props) return "";
        var keys = Object.keys(props);
        var INTERNAL_SKIP = new Set(["_featureindex"]);
        // 不区分大小写查找 name 字段
        var nameKey = null;
        for (var ni = 0; ni < keys.length; ni++) {
          if (keys[ni].toLowerCase() === "name") {
            nameKey = keys[ni];
            break;
          }
        }
        var parts = [];
        // name 优先作为第一个
        if (nameKey && props[nameKey] != null && props[nameKey] !== "") {
          parts.push(String(props[nameKey]));
        }
        // 再补充其他字段，最多取到 4 个字段总计
        for (var i = 0; i < keys.length && parts.length < 4; i++) {
          var k = keys[i];
          if (k === nameKey) continue;
          if (INTERNAL_SKIP.has(k.toLowerCase())) continue;
          var v = props[k];
          if (v === null || v === undefined || v === "") continue;
          parts.push(String(v));
        }
        return parts.join("  |  ");
      }

      // 构建所有字段信息的 tooltip HTML（用于自定义 hover 卡片）
      function buildTooltipText(props) {
        if (!props) return "";
        var keys = Object.keys(props);
        var INTERNAL_SKIP = new Set(["_featureindex"]);
        var rows = [];
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (INTERNAL_SKIP.has(k.toLowerCase())) continue;
          var v = props[k];
          if (v === null || v === undefined || v === "") continue;
          rows.push(k + ": " + String(v));
        }
        return rows.join("\n");
      }

      function runSearch(query) {
        var q = query.toLowerCase().trim();
        var results = [];
        var totalCount = 0;

        // ===== 第一阶段：搜索图层名和图层组名 =====
        var seenLayer = {};
        searchRegistry.forEach(function (entry) {
          var match = false;
          var matchedField = "";
          // 图层名匹配
          if (
            entry.layerLabel &&
            entry.layerLabel.toLowerCase().indexOf(q) !== -1
          ) {
            match = true;
            matchedField = entry.layerLabel;
          }
          // 图层组名匹配
          if (
            !match &&
            entry.groupName &&
            entry.groupName.toLowerCase().indexOf(q) !== -1
          ) {
            match = true;
            matchedField = entry.groupName;
          }
          // 图层名 + 组名复合匹配（如搜索 "板块" 同时搜图层名和组名）
          if (!match && entry.groupName && entry.layerLabel) {
            var combined = entry.groupName + " " + entry.layerLabel;
            if (combined.toLowerCase().indexOf(q) !== -1) {
              match = true;
              matchedField = entry.layerLabel;
            }
          }
          if (match && !seenLayer[entry.checkboxId]) {
            seenLayer[entry.checkboxId] = true;
            totalCount++;
            results.push({
              type: "layer",
              label: entry.groupName || "",
              summary: entry.layerLabel,
              tooltipText:
                entry.layerLabel +
                (entry.groupName ? "\n所属分组: " + entry.groupName : ""),
              feature: null,
              checkboxId: entry.checkboxId,
            });
          }
        });

        // ===== 第二阶段：搜索要素属性（仅搜索已勾选的图层，使用倒排索引） =====
        searchRegistry.forEach(function (entry) {
          // 只搜索当前已勾选的图层（含内置图层和用户上传图层）
          var cb = document.getElementById(entry.checkboxId);
          if (!cb || !cb.checked) return;

          var si = searchIndexMap[entry.checkboxId];
          // 优先用 searchIndexMap，无索引时尝试 featureCache（降级）
          var features =
            si && si.features && si.features.length
              ? si.features
              : featureCache[entry.checkboxId] || null;

          if (!features || !features.length) return;

          var qLower = q;
          var matchedIndices = [];

          // 有倒排索引时走索引匹配
          if (si && si.tokens && typeof si.tokens === "object") {
            var tokens = qLower
              .split(/[^a-z0-9\u4e00-\u9fff]+/)
              .filter(Boolean);
            if (tokens.length) {
              var candidateSets = [];
              for (var ti = 0; ti < tokens.length; ti++) {
                var tok = tokens[ti];
                var idxList = si.tokens[tok];
                if (idxList && idxList.length > 0) {
                  candidateSets.push(idxList);
                } else {
                  // 模糊搜索
                  var merged = {};
                  var keys = Object.keys(si.tokens);
                  for (var ki = 0; ki < keys.length; ki++) {
                    if (keys[ki].indexOf(tok) !== -1) {
                      var arr = si.tokens[keys[ki]];
                      for (var ai = 0; ai < arr.length; ai++) {
                        merged[arr[ai]] = true;
                      }
                    }
                  }
                  var fuzzy = Object.keys(merged).map(Number);
                  if (fuzzy.length > 0) candidateSets.push(fuzzy);
                }
              }
              if (candidateSets.length >= tokens.length) {
                matchedIndices = candidateSets[0];
                for (var ci = 1; ci < candidateSets.length; ci++) {
                  var set = candidateSets[ci];
                  var next = [];
                  for (var si2 = 0; si2 < matchedIndices.length; si2++) {
                    if (set.indexOf(matchedIndices[si2]) !== -1)
                      next.push(matchedIndices[si2]);
                  }
                  matchedIndices = next;
                  if (!matchedIndices.length) break;
                }
              }
            }
          }

          if (!matchedIndices || !matchedIndices.length) return;
          totalCount += matchedIndices.length;
          var limit = Math.min(matchedIndices.length, 30);
          for (var k = 0; k < limit; k++) {
            var f = features[matchedIndices[k]];
            results.push({
              type: "feature",
              label: entry.layerLabel,
              summary: buildSummary(f.properties),
              tooltipText: buildTooltipText(f.properties),
              feature: f,
              checkboxId: entry.checkboxId,
            });
          }
        });
        return { items: results, total: totalCount };
      }

      function extractCoords(geom) {
        var raw = geom.coordinates;
        if (!raw || raw.length === 0) return [];
        var result = [];
        function normalize(v) {
          return (((v % 360) + 540) % 360) - 180;
        }
        if (geom.type === "Point") {
          return [
            [
              normalize(raw[1] === undefined ? raw[0] : raw[1]),
              normalize(raw[1] === undefined ? raw[1] : raw[0]),
            ],
          ];
        }
        function walk(arr) {
          if (!Array.isArray(arr)) return;
          if (typeof arr[0] === "number" && typeof arr[1] === "number") {
            result.push([arr[1], normalize(arr[0])]);
          } else {
            arr.forEach(walk);
          }
        }
        walk(raw);
        return result;
      }

      function flyToFeature(feature) {
        if (!feature || !feature.geometry) return;
        var geom = feature.geometry;
        var type = (geom.type || "").toLowerCase();
        var isPoint = type === "point" || type === "multipoint";
        var coords = extractCoords(geom);
        try {
          if (isPoint && coords.length > 0) {
            map.setView(coords[0], Math.max(map.getZoom(), 8), {
              animate: true,
            });
          } else if (coords.length > 0) {
            var latlngs = coords.map(function (c) {
              return L.latLng(c[0], c[1]);
            });
            var bounds = L.latLngBounds(latlngs);
            if (bounds.isValid())
              map.fitBounds(bounds, {
                padding: [50, 50],
                maxZoom: 14,
                animate: true,
              });
          }
        } catch (e) {}
      }

      // ---------- 天地图地名搜索 ----------
      var _tdtTimer = null;
      var _tdtCache = {}; // { query: [poi, ...] } 简单缓存，避免重复请求

      function tiandituSearch(query, callback) {
        if (_tdtCache[query]) {
          callback(_tdtCache[query]);
          return;
        }
        var tk = window.TDT_TK || "";
        if (!tk) {
          callback([]);
          return;
        }
        // 地名搜索需要 mapBound 和 level，全局范围让服务器自己找
        var postStr = JSON.stringify({
          keyWord: query,
          queryType: 7,
          mapBound: "-180,-90,180,90",
          level: 12,
          start: 0,
          count: 20,
        });
        var url =
          "https://api.tianditu.gov.cn/v2/search?postStr=" +
          encodeURIComponent(postStr) +
          "&type=query&tk=" +
          tk;

        fetch(url)
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            var pois = [];
            if (
              data &&
              data.status &&
              data.status.infocode === 1000 &&
              data.pois
            ) {
              pois = data.pois;
            }
            _tdtCache[query] = pois;
            callback(pois);
          })
          .catch(function () {
            callback([]);
          });
      }

      // 全局暴露天地图搜索入口，给 onclick 调用
      window.__tiandituSearch = function (query) {
        var inp = document.getElementById("searchInput");
        if (inp) {
          inp.value = query;
        }
        tiandituSearch(query, function (pois) {
          renderTdtResults(pois, query);
        });
      };

      function renderTdtResults(pois, query) {
        resultsBox.innerHTML = "";
        if (!pois || pois.length === 0) {
          resultsBox.innerHTML =
            '<div class="search-empty">天地图未找到该地名</div>';
          resultsBox.classList.add("open");
          return;
        }
        var title = document.createElement("div");
        title.className = "search-empty";
        title.style.cssText =
          "font-size:11px;color:var(--text-dim);padding-bottom:4px;";
        title.textContent = "🗺️ 天地图地名结果";
        resultsBox.appendChild(title);

        pois.forEach(function (poi) {
          var item = document.createElement("div");
          item.className = "search-result-item";
          var tag = document.createElement("span");
          tag.className = "search-result-tag";
          tag.textContent = "🗺️ 地名";
          var text = document.createElement("span");
          text.className = "search-result-text";
          text.textContent = poi.name + (poi.address ? "  " + poi.address : "");
          item.appendChild(tag);
          item.appendChild(text);

          // 原生 title 显示详细地址+分类
          var tipParts = [poi.name];
          if (poi.address) tipParts.push("地址: " + poi.address);
          if (poi.typeName) tipParts.push("分类: " + poi.typeName);
          item.title = tipParts.join("\n");

          if (poi.lonlat) {
            var parts = poi.lonlat.split(",");
            if (parts.length >= 2) {
              var lng = parseFloat(parts[0]);
              var lat = parseFloat(parts[1]);
              (function (lat_, lng_) {
                item.addEventListener("click", function () {
                  map.setView([lat_, lng_], Math.max(map.getZoom(), 10), {
                    animate: true,
                  });
                  resultsBox.classList.remove("open");
                });
              })(lat, lng);
            }
          }
          resultsBox.appendChild(item);
        });
        resultsBox.classList.add("open");
      }

      function renderResults(results, query, totalCount) {
        resultsBox.innerHTML = "";
        if (results.length === 0) {
          resultsBox.innerHTML =
            '<div class="search-empty"><div>无匹配结果</div>' +
            '<div class="tdt-search-btn" onclick="window.__tiandituSearch(\'' +
            query.replace(/\\/g, "\\\\").replace(/'/g, "\\'") +
            "')\">🔍 搜索地名「" +
            query.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
            "」</div></div>";
          resultsBox.classList.add("open");
          return;
        }
        var MAX = 30;
        var shown = results.slice(0, MAX);
        // 移除旧的自定义 tooltip DOM（如有）
        var oldTip = document.getElementById("searchTooltip");
        if (oldTip && oldTip.parentNode) oldTip.parentNode.removeChild(oldTip);

        shown.forEach(function (r) {
          var item = document.createElement("div");
          item.className = "search-result-item";
          if (r.tooltipText) {
            item.title = r.tooltipText;
          }

          var tag = document.createElement("span");
          tag.className = "search-result-tag";
          var tagEmoji = r.type === "layer" ? "📁" : "📍";
          tag.textContent = r.label ? tagEmoji + " " + r.label : tagEmoji;
          var text = document.createElement("span");
          text.className = "search-result-text";
          var raw = r.summary || "(无属性)";
          var idx = raw.toLowerCase().indexOf(query.toLowerCase().trim());
          if (idx >= 0 && query.trim()) {
            var before = raw.slice(0, idx);
            var match = raw.slice(idx, idx + query.trim().length);
            var after = raw.slice(idx + query.trim().length);
            text.innerHTML =
              before
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;") +
              "<mark>" +
              match
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;") +
              "</mark>" +
              after
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
          } else {
            text.textContent = raw;
          }
          item.appendChild(tag);
          item.appendChild(text);
          item.addEventListener("click", function () {
            var feat = r.feature;
            var cbId = r.checkboxId;

            // 图层/组名匹配：勾选复选框并加载图层
            if (r.type === "layer") {
              var cb = document.getElementById(cbId);
              if (cb && !cb.checked) {
                cb.checked = true;
                cb.style.background = layerColorMap[cbId] || "#fff";
                persistLayerCheckState(cb, true);
                loadGeoJSONLayer(cb.value, cbId, true);
              } else if (cb && cb.checked) {
                // 已加载则直接缩放到图层
                var bnds = layerBoundsCache[cbId];
                if (bnds && bnds.isValid && bnds.isValid()) {
                  map.fitBounds(bnds, {
                    padding: [30, 30],
                    maxZoom: 14,
                    animate: true,
                  });
                }
              }
              // 展开对应组及父级 section
              expandToLayerGroup(cb);
              resultsBox.classList.remove("open");
              return;
            }

            // ===== 要素匹配：先确保图层已加载，再高亮该要素 =====
            var cb = document.getElementById(cbId);
            if (cb && !cb.checked) {
              // 图层未加载 → 先勾选加载，加载后再高亮
              cb.checked = true;
              cb.style.background = layerColorMap[cbId] || "#fff";
              persistLayerCheckState(cb, true);
              loadGeoJSONLayer(cb.value, cbId, true);
              // 展开对应组及父级 section
              expandToLayerGroup(cb);
              resultsBox.classList.remove("open");

              // 注册加载完成后的回调：定位到该要素
              var origCallback = _loadedCallbacks[cbId];
              _loadedCallbacks[cbId] = function () {
                if (origCallback) origCallback();
                setTimeout(function () {
                  highlightAndLocateFeature(cbId, feat);
                }, 300);
              };
              return;
            }

            // 已加载 → 直接高亮定位
            highlightAndLocateFeature(cbId, feat);
          });
          resultsBox.appendChild(item);
        });
        if (totalCount > MAX) {
          var more = document.createElement("div");
          more.className = "search-empty";
          more.textContent =
            "共 " + totalCount + " 条，已显示前 " + MAX + " 条，请精确关键词";
          resultsBox.appendChild(more);
        }
        resultsBox.classList.add("open");
      }

      // ----------------------------------------------
      // 高亮并定位到指定的要素（独立函数，供搜索结果点击使用）
      // ----------------------------------------------
      function highlightAndLocateFeature(cbId, feat) {
        var state = highlightState[cbId];
        // 判断是否为 Canvas 图层（有 setFeatures 则为 Canvas）
        var isCanvasLayer =
          state &&
          state.geoLayers &&
          state.geoLayers.some(function (gl) {
            return typeof gl.setFeatures === "function";
          });
        if (state && state.geoLayers && !isCanvasLayer) {
          state.geoLayers.forEach(function (gl) {
            gl.eachLayer(function (layer) {
              if (
                layer.feature &&
                layer.feature._featureIndex === feat._featureIndex
              ) {
                var center;
                try {
                  if (layer.getBounds) {
                    var b = layer.getBounds();
                    if (b.isValid()) center = b.getCenter();
                  }
                } catch (e) {}
                if (!center && layer.getLatLng) center = layer.getLatLng();
                if (!center && feat.geometry && feat.geometry.coordinates) {
                  var coords = feat.geometry.coordinates;
                  if (feat.geometry.type === "Point")
                    center = L.latLng(coords[1], coords[0]);
                }
                var dblclickEvent = {
                  latlng: center || map.getCenter(),
                  layer: layer,
                  originalEvent: null,
                };
                layer.fire("dblclick", dblclickEvent, true);
              }
            });
          });
        } else {
          // Canvas 大数据集：直接从 geometry 坐标定位
          if (feat.geometry && feat.geometry.coordinates) {
            var coords = feat.geometry.coordinates;
            var gtype = feat.geometry.type;
            if (gtype === "Point") {
              map.panTo(L.latLng(coords[1], coords[0]), {
                duration: 0.6,
              });
            } else {
              var corners = [];
              (function collect(arr) {
                if (!Array.isArray(arr)) return;
                if (typeof arr[0] === "number") {
                  corners.push([arr[1], arr[0]]);
                } else {
                  for (var i = 0; i < arr.length; i++) collect(arr[i]);
                }
              })(coords);
              if (corners.length >= 2) {
                var bounds = L.latLngBounds(corners);
                if (bounds.isValid()) {
                  map.flyToBounds(bounds, {
                    padding: [40, 40],
                    duration: 0.8,
                  });
                }
              } else if (corners.length === 1) {
                map.panTo(corners[0], { duration: 0.6 });
              }
            }
          }
        }
        resultsBox.classList.remove("open");
        input.blur();
      }

      function escapeHtml(str) {
        return str
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }

      var searchTimer = null;
      var clearBtn = document.getElementById("searchClear");
      if (clearBtn) {
        clearBtn.addEventListener("click", function () {
          input.value = "";
          resultsBox.innerHTML = "";
          resultsBox.classList.remove("open");
          clearBtn.classList.remove("visible");
          input.blur();
        });
      }

      input.addEventListener("input", function () {
        if (clearBtn) {
          clearBtn.classList.toggle("visible", this.value.trim().length > 0);
        }
        clearTimeout(searchTimer);
        var q = this.value.trim();
        if (!q) {
          resultsBox.innerHTML = "";
          resultsBox.classList.remove("open");
          return;
        }
        if (q.length < 1) return;
        searchTimer = setTimeout(function () {
          var res = runSearch(q);
          renderResults(res.items, q, res.total);
        }, 150);
      });

      input.addEventListener("focus", function () {
        if (this.value.trim() && resultsBox.children.length > 0)
          resultsBox.classList.add("open");
      });

      document.addEventListener("click", function (e) {
        var bar = document.getElementById("searchBar");
        if (bar && !bar.contains(e.target)) resultsBox.classList.remove("open");
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          resultsBox.classList.remove("open");
          this.blur();
        }
      });

      // Ctrl+F 聚焦搜索框，并确保侧边栏展开
      document.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "f") {
          e.preventDefault();
          var panel = document.getElementById("layerPanel");
          var toggle = document.getElementById("sidebarToggle");
          if (toggle && !toggle.checked) {
            toggle.checked = true;
          }
          input.focus();
          input.select();
        }
      });
    }

    // ========== 聚类开关 ==========
    function initClusterToggle() {
      var toggle = document.getElementById("clusterToggle");
      if (!toggle) return;
      var saved = localStorage.getItem("dupal_cluster_enabled");
      if (saved !== null) {
        clusterEnabled = saved === "true";
        toggle.checked = clusterEnabled;
      } else {
        clusterEnabled = true;
      }
      toggle.addEventListener("change", function () {
        clusterEnabled = this.checked;
        localStorage.setItem("dupal_cluster_enabled", String(clusterEnabled));
        rebuildLoadedPointLayers();
      });
    }

    // ========== 标签开关 ==========
    function initLabelToggle() {
      var toggle = document.getElementById("labelToggle");
      if (!toggle) return;
      var saved = localStorage.getItem("dupal_label_enabled");
      if (saved !== null) {
        labelEnabled = saved === "true";
        toggle.checked = labelEnabled;
      } else {
        labelEnabled = false; // 默认关闭标签，避免大数据集内存溢出
        toggle.checked = false;
      }
      toggle.addEventListener("change", function () {
        labelEnabled = this.checked;
        localStorage.setItem("dupal_label_enabled", String(labelEnabled));
        rebuildLoadedPointLayers();
      });
    }

    const _geomTypeCache = {};

    function rebuildLoadedPointLayers() {
      document
        .querySelectorAll('.layer-item input[type="checkbox"]')
        .forEach(function (cb) {
          if (!cb.checked) return;
          var checkboxId = cb.id;
          var isUserLayer = !!cb.dataset.userLayer;

          // 判断是否为点要素图层
          var isPoint = false;
          if (isUserLayer) {
            // 用户上传图层：从 userLayerGeoJson 中检测
            var ud = userLayerGeoJson[checkboxId];
            if (ud && ud.geoJsonData) {
              var mt = window.GeoUtils.detectMainGeomType(ud.geoJsonData);
              isPoint = mt === "point" || mt === "multipoint";
            }
          } else {
            // 内置图层：从 _geomTypeCache 读取
            var filePath = cb.value;
            var fileName = filePath.split("/").pop();
            var mainType = _geomTypeCache[fileName] || "";
            isPoint = mainType === "point" || mainType === "multipoint";
          }

          // 点图层 Canvas 渲染：直接更新 clustering 选项并重绘（无需重建）
          if (isPoint) {
            var cached = layerCache[checkboxId];
            if (cached && typeof cached.getLayers === "function") {
              var layers = cached.getLayers();
              var isCanvas = layers.some(function (l) {
                return typeof l.setFeatures === "function";
              });
              if (isCanvas) {
                layers.forEach(function (l) {
                  if (typeof l.setFeatures === "function") {
                    l.options.clustering = clusterEnabled;
                    l.redraw();
                  }
                });
                return;
              }
            }
          }

          // 所有图层（点/线/面）DOM 渲染：重载以应用新的聚类/标签设置
          if (isUserLayer) {
            // 用户上传图层：清除缓存并用原始数据重建
            var savedData = userLayerGeoJson[checkboxId];
            if (!savedData) return;
            clearHighlight(checkboxId);
            var oldState = highlightState[checkboxId];
            if (oldState && oldState.geoLayers) {
              oldState.geoLayers.forEach(function (gl) {
                try {
                  map.removeLayer(gl);
                } catch (e) {}
              });
            }
            if (cached) map.removeLayer(cached);
            layerCache[checkboxId] = null;
            var newGroup = buildGeoJsonLayerGroup(
              savedData.geoJsonData,
              checkboxId,
              savedData.fileName,
            );
            newGroup.addTo(map);
            layerCache[checkboxId] = newGroup;
          } else {
            reloadLayerWithNewMode(
              checkboxId,
              colorMode[checkboxId],
              layerColorMap[checkboxId],
              fieldKey[checkboxId],
            );
          }
        });
    }

    // 检查 localStorage 中是否存在已保存的图层状态
    function hasSavedLayerState() {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (
          key &&
          (key.indexOf("dupal_layer_") === 0 ||
            key.indexOf("dupal_user_layer_") === 0)
        ) {
          return true;
        }
      }
      try {
        var list = JSON.parse(
          localStorage.getItem(USER_LAYER_STORAGE_KEY) || "[]",
        );
        if (list.length > 0) return true;
      } catch (e) {}
      return false;
    }

    // 清除所有已保存的图层状态（用户选择不恢复时调用）
    function clearAllLayerStates() {
      var keysToRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (
          key &&
          (key.indexOf("dupal_layer_") === 0 ||
            key.indexOf("dupal_user_layer_") === 0)
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(function (k) {
        localStorage.removeItem(k);
      });
      // 清除用户图层元数据列表
      try {
        var list = JSON.parse(
          localStorage.getItem(USER_LAYER_STORAGE_KEY) || "[]",
        );
        list.forEach(function (meta) {
          if (L.GzIdbLoader && L.GzIdbLoader.delCache) {
            L.GzIdbLoader.delCache("user_geo_" + meta.id);
          }
          if (L.GzIdbLoader && L.GzIdbLoader.deleteSearchIndex) {
            L.GzIdbLoader.deleteSearchIndex("user_" + meta.id);
          }
        });
      } catch (e) {}
      localStorage.removeItem(USER_LAYER_STORAGE_KEY);
    }

    // 恢复内置图层的勾选状态
    function restoreLayerCheckStates() {
      document
        .querySelectorAll('.layer-item input[type="checkbox"]')
        .forEach(function (cb) {
          var saved = localStorage.getItem("dupal_layer_" + cb.id);
          if (saved === "true" && !cb.checked) {
            cb.checked = true;
            cb.style.background = layerColorMap[cb.id] || "#fff";
            // 展开对应面板层级
            expandToLayerGroup(cb);
            // 触发加载
            if (cb.dataset.userLayer) {
              if (layerCache[cb.id]) layerCache[cb.id].addTo(map);
            } else {
              loadGeoJSONLayer(cb.value, cb.id, false);
            }
          }
        });
      syncAllGroupStatus();
      syncSelectAllStatus();
    }

    // ========== 初始化 ==========
    function initGeoJsonLayer() {
      generateLayerItems();
      initSearch();

      // 图层恢复：检测到已保存的图层状态时，弹窗询问用户是否恢复
      if (isRememberLayerEnabled() && hasSavedLayerState()) {
        showConfirm("检测到上次访问时打开的图层，是否恢复？", {
          title: "恢复图层",
          confirmText: "恢复",
          cancelText: "不恢复",
        }).then(function (restore) {
          if (restore) {
            restoreLayerCheckStates();
            restoreUserLayers();
          } else {
            clearAllLayerStates();
          }
          syncAllGroupStatus();
          syncSelectAllStatus();
        });
      }

      initClusterToggle();
      initLabelToggle();
    }

    initGeoJsonLayer();
  }); // 闭合 waitForMap 回调
})();
