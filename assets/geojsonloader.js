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
    // ========== 通用要素计数更新（提前声明，供后续回调使用）==========
    function updateLayerCount(checkboxId, features) {
      if (!checkboxId || !features || features.length === 0) return;
      var cb = document.getElementById(checkboxId);
      if (!cb) return;
      var label =
        cb.closest(".layer-item")?.querySelector("label") ||
        cb.closest(".toggle-bar")?.querySelector("label");
      if (!label) return;
      var count = features.length;
      var typeLabel = "要素";
      for (var i = 0; i < Math.min(features.length, 5); i++) {
        var f = features[i];
        if (f && f.geometry && f.geometry.type) {
          var t = f.geometry.type.toLowerCase();
          if (t === "point" || t === "multipoint") typeLabel = "点";
          else if (t === "linestring" || t === "multilinestring")
            typeLabel = "线";
          else if (t === "polygon" || t === "multipolygon") typeLabel = "面";
          break;
        }
      }
      var badge = label.querySelector(".ft-count");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "ft-count";
        badge.style.cssText =
          "font-size:10px;color:var(--text-dim);margin-left:6px;";
        label.appendChild(badge);
      }
      badge.textContent = "(" + count + " " + typeLabel + ")";
    }

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
    const labelFieldMap = {}; // checkboxId → 自定义标签字段名（来自 geo-config.js）
    const layerIconMap = {}; // checkboxId → 图标类型（来自 geo-config.js）
    const layerIconSizeMap = {}; // checkboxId → 图标尺寸（px，仅外部文件图标）
    const defaultIconMap = {}; // checkboxId → geo-config.js 默认图标（用于恢复默认）
    // ========== 颜色模式管理 ==========
    const colorMode = {};
    const fieldKey = {};
    const fieldColorPalette = {};
    // config 层默认值（geo-config.js 中设置，供首次加载 / 重置时回退）
    const defaultColorModeMap = {};
    const defaultColorFieldMap = {};
    const layerOpacityMap = {}; // checkboxId → 不透明度 (0-1, 默认 0.8)
    // 高亮状态
    const highlightState = {};
    const layerBoundsCache = {};
    const _loadedCallbacks = {}; // 图层加载完成回调，用于搜索要素时异步等待
    // Canvas 图层要素缓存（用于颜色模式快速切换）
    const canvasFeaturesCache = {};
    const canvasFieldValuesCache = {};
    const searchIndexMap = {}; // 倒排索引：{ checkboxId: { tokens: { tok: [idx, ...] }, features: [...] } }
    const featureCache = {}; // 要素数据缓存：{ checkboxId: features[] }，独立于索引，保证要素搜索始终可用
    const layerSearchPriorityMap = {}; // 搜索优先图层（如海底地名集）：检索时优先返回，且未勾选也可被搜索
    const layerSourceMap = {}; // 图层级数据来源（geo-config 的 source）：注入要素属性后显示在弹窗「数据源」
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
            // 同一要素若在同一 token 下重复出现（如多字段含相同值），
            // 去重避免搜索结果中同一要素重复出现
            if (tokens[tok].indexOf(i) === -1) tokens[tok].push(i);
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
              // 缓存命中：直接使用。
              // 自修复历史索引中可能存在的重复要素索引（同值跨多字段导致），避免结果重复
              var _ctok = cached.tokens;
              for (var _ck in _ctok) {
                if (!Object.prototype.hasOwnProperty.call(_ctok, _ck)) continue;
                var _carr = _ctok[_ck];
                if (!_carr || _carr.length < 2) continue;
                var _cu = [];
                var _cs = Object.create(null);
                for (var _cj = 0; _cj < _carr.length; _cj++) {
                  if (!_cs[_carr[_cj]]) {
                    _cs[_carr[_cj]] = true;
                    _cu.push(_carr[_cj]);
                  }
                }
                _ctok[_ck] = _cu;
              }
              searchIndexMap[checkboxId] = {
                tokens: _ctok,
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
    // 缩放相关常量
    const DEFAULT_LABEL_FIELD = "Name";
    let clusterEnabled = true;
    let labelEnabled = false;

    // ========== 要素名称提取：支持多层 fallback ==========
    // 优先 Name/name/NAME，都没有则使用第一个非空字段值

    function _getFirstFieldValue(props) {
      for (var key in props) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
          var v = props[key];
          if (v !== null && v !== undefined && v !== "") return String(v);
        }
      }
      return "";
    }

    function _getFeatureName(feature) {
      if (!feature || !feature.properties) return "";
      var props = feature.properties;
      return (
        props.Name || props.name || props.NAME || _getFirstFieldValue(props)
      );
    }

    function _getLabelText(feature, labelField) {
      if (!feature || !feature.properties) return null;
      var props = feature.properties;
      var val = props[labelField];
      if (val) return val;
      // 无配置字段时回退到第一个非空字段值
      var fallback = _getFirstFieldValue(props);
      return fallback || null;
    }

    // ========== 线/面要素永久标签 ==========
    // 当 labelEnabled 打开时，onEachFeature 中直接绑定 permanent tooltip，
    // 替代原来的 mouseover 动态绑定方式，与点要素标签行为一致。
    // 拖动时永久 tooltip 跟随要素移动（由 Leaflet 处理）。

    function _bindPermanentLabel(layer, labelField) {
      if (!labelEnabled) return;
      var name = "";
      // 优先使用配置的自定义标签字段
      if (labelField && layer.feature && layer.feature.properties) {
        name = layer.feature.properties[labelField];
      }
      if (!name) name = _getFeatureName(layer.feature);
      if (!name) return;
      layer.bindTooltip(String(name), {
        permanent: true,
        direction: "top",
        offset: [0, -8],
        className: "feature-label",
      });
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

      const layerOpacity =
        layerOpacityMap[checkboxId] !== undefined
          ? layerOpacityMap[checkboxId]
          : 0.8;

      if (isLine) {
        return {
          color: featureColor,
          fillColor: featureColor,
          weight: 2.5,
          opacity: layerOpacity,
          fillOpacity: 0,
        };
      }

      if (isPoint) {
        const isVolcano = fileName === "volcanos.geojson";
        return {
          color: featureColor,
          fillColor: featureColor,
          weight: 1,
          opacity: layerOpacity,
          fillOpacity: layerOpacity,
          radius: isVolcano ? 5 : 8,
        };
      }

      return {
        color: "#555",
        fillColor: featureColor,
        weight: 1,
        opacity: layerOpacity,
        fillOpacity: Math.min(layerOpacity, 0.45),
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

      // 读取用户自定义设置（颜色、名称字段等）
      var savedSettings = loadLayerSettings(checkboxId);
      if (savedSettings.colorMode)
        colorMode[checkboxId] = savedSettings.colorMode;
      else if (defaultColorModeMap[checkboxId])
        colorMode[checkboxId] = defaultColorModeMap[checkboxId];

      if (savedSettings.colorField)
        fieldKey[checkboxId] = savedSettings.colorField;
      else if (defaultColorFieldMap[checkboxId])
        fieldKey[checkboxId] = defaultColorFieldMap[checkboxId];
      if (savedSettings.colorValue)
        layerColorMap[checkboxId] = savedSettings.colorValue;
      // 用户自定义图标（如果有）：覆盖 geo-config.js 的 icon 配置
      if (savedSettings.iconValue)
        layerIconMap[checkboxId] = savedSettings.iconValue;
      if (savedSettings.iconSize)
        layerIconSizeMap[checkboxId] = Number(savedSettings.iconSize);

      // 不透明度：用户设置 → 默认 0.8
      if (savedSettings.opacity !== undefined)
        layerOpacityMap[checkboxId] = Number(savedSettings.opacity);

      // 标签字段：用户自定义 → geo-config.js 配置 → 默认 "Name"
      let labelField =
        savedSettings.labelField ||
        labelFieldMap[checkboxId] ||
        DEFAULT_LABEL_FIELD;

      // 图层显示名称（用于弹窗底部标注）
      var layerDisplayName = "";
      try {
        var cbEl = document.getElementById(checkboxId);
        if (cbEl && cbEl.dataset && cbEl.dataset.layerName)
          layerDisplayName = cbEl.dataset.layerName;
      } catch (e) {}

      const iconType = layerIconMap[checkboxId] || fileName;

      // 图层透明度（点要素标记渲染时透传，确保点也受不透明度控制）
      const layerOpacity =
        layerOpacityMap[checkboxId] !== undefined
          ? layerOpacityMap[checkboxId]
          : 0.8;

      // 创建聚类组
      function createClusterGroup() {
        const layerColor = layerColorMap[checkboxId] || "#8B6914";
        const layerIconType = layerIconMap[checkboxId];

        return L.markerClusterGroup({
          maxClusterRadius: 50,
          spiderfyOnMaxZoom: true,
          showCoverageOnHover: false,
          zoomToBoundsOnClick: true,
          iconCreateFunction: function (cluster) {
            const count = cluster.getChildCount();

            // 统一通过 L.GeoMarker.getClusterIconForType 分发
            // 内置类型（volcano/hotspot/star）→ 专用聚类工厂
            // 内联SVG类型 → 自动提取SVG路径嵌入聚类圆
            // 外部文件/数据URL → createCustomClusterIcon
            // 未知/默认 → createDefaultClusterIcon
            if (layerIconType && L.GeoMarker.isExternalPath(layerIconType)) {
              return L.GeoMarker.createCustomClusterIcon(
                layerIconType,
                layerColor,
                count,
              );
            }
            return L.GeoMarker.getClusterIconForType(
              layerIconType,
              layerColor,
              count,
            );
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
          // 自定义图标在 Canvas 上通过 drawImage 绘制
          if (originalCount > 3000) {
            // 预加载自定义图标
            var iconType_ = layerIconMap[checkboxId];
            var iconSize_ = layerIconSizeMap[checkboxId] || 20;
            var iconImg = null;
            var iconColorMap = null;
            if (iconType_) {
              if (L.GeoMarker.isExternalPath(iconType_)) {
                iconImg = new Image();
                iconImg.onload = function () {
                  if (canvasLayer && canvasLayer._map)
                    canvasLayer._redraw(true);
                };
                iconImg.src = iconType_;
              } else {
                var colorMode_ = colorMode[checkboxId] || "sequential";
                if (colorMode_ === "field") {
                  // 多颜色模式：也生成默认色的单色图作为兜底
                  var fnFallback = L.GeoMarker.getIconFactory(
                    iconType_,
                    iconSize_,
                  );
                  if (fnFallback) {
                    var fallbackColor = layerColorMap[checkboxId] || "#888";
                    var fiDiv = fnFallback(fallbackColor);
                    var fiHtml = fiDiv.options.html || "";
                    if (fiHtml) {
                      try {
                        var fiData =
                          "data:image/svg+xml;base64," +
                          btoa(unescape(encodeURIComponent(fiHtml)));
                        iconImg = new Image();
                        iconImg.src = fiData;
                      } catch (e) {}
                    }
                  }
                } else {
                  var iconFn = L.GeoMarker.getIconFactory(iconType_, iconSize_);
                  if (iconFn) {
                    var layerColor = layerColorMap[checkboxId] || "#888";
                    var divIcon = iconFn(layerColor);
                    var svgHtml = divIcon.options.html || "";
                    if (svgHtml) {
                      try {
                        var svgData =
                          "data:image/svg+xml;base64," +
                          btoa(unescape(encodeURIComponent(svgHtml)));
                        iconImg = new Image();
                        iconImg.onload = function () {
                          if (canvasLayer && canvasLayer._map)
                            canvasLayer._redraw(true);
                        };
                        iconImg.src = svgData;
                      } catch (e) {}
                    }
                  }
                }
              }
            }

            const canvasLayer = L.markersCanvas({
              clustering: clusterEnabled,
              iconImage: iconImg,
              iconImages: iconColorMap,
              iconSize: iconSize_,
              opacity: layerOpacity,
            });

            // 构建要素数组 [{ lat, lng, color, _idx }]
            var featuresArray = [];
            for (var i = 0; i < features.length; i++) {
              var f = features[i];
              if (!f || !f.geometry || !f.geometry.coordinates) continue;
              var c = f.geometry.coordinates;
              var idx = f._featureIndex || i;
              var color = getFeatureFillColor(f, checkboxId, fileName, idx);
              featuresArray.push({
                lat: c[1],
                lng: c[0],
                color: color,
                _idx: idx,
                properties: f.properties || null,
              });
            }

            // 多颜色模式 + 自定义图标：为每种颜色生成对应的 Image
            if (
              iconType_ &&
              !L.GeoMarker.isExternalPath(iconType_) &&
              (colorMode[checkboxId] || "sequential") === "field"
            ) {
              _loadCanvasIconColorMap(
                featuresArray,
                iconType_,
                iconSize_,
                checkboxId,
                function (colorMap) {
                  canvasLayer.options.iconImages = colorMap;
                  if (canvasLayer._map) canvasLayer._redraw(true);
                },
              );
            }

            canvasLayer.setFeatures(featuresArray);

            // 缓存 featuresArray 供颜色快速切换（避免重新读取数据）
            canvasFeaturesCache[checkboxId] = featuresArray;

            // 点击回调：所有数据集均设置（f 即 featuresArray 元素，含完整属性）
            canvasLayer.options.onFeatureClick = function (f, latlng) {
              const content = window.GeoUtils.buildPopupContent(
                f,
                fileName,
                labelField,
                layerDisplayName,
              );
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
                const labelText = _getLabelText(feature, labelField);

                const marker = L.GeoMarker.createPointMarkerByType(
                  map,
                  feature,
                  latlng,
                  color,
                  labelEnabled ? labelText : null,
                  iconType,
                  layerIconSizeMap[checkboxId] || 20,
                  layerOpacity,
                );

                const content = window.GeoUtils.buildPopupContent(
                  feature,
                  fileName,
                  labelField,
                  layerDisplayName,
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
                const labelText = _getLabelText(feature, labelField);
                const marker = L.GeoMarker.createPointMarkerByType(
                  map,
                  feature,
                  latlng,
                  color,
                  labelEnabled ? labelText : null,
                  iconType,
                  layerIconSizeMap[checkboxId] || 20,
                  layerOpacity,
                );
                marker.bindPopup(
                  window.GeoUtils.buildPopupContent(
                    feature,
                    fileName,
                    labelField,
                    layerDisplayName,
                  ),
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
              const labelText = _getLabelText(feature, labelField);

              const marker = L.GeoMarker.createPointMarkerByType(
                map,
                feature,
                latlng,
                color,
                labelEnabled ? labelText : null,
                iconType,
                layerIconSizeMap[checkboxId] || 20,
                layerOpacity,
              );

              marker.bindPopup(
                window.GeoUtils.buildPopupContent(
                  feature,
                  fileName,
                  labelField,
                  layerDisplayName,
                ),
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

              // 标签：permanent tooltip（由 labelEnabled 全局开关控制，与点要素标签同步）
              _bindPermanentLabel(layer, labelField);

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
                  labelField,
                  layerDisplayName,
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
                  labelField,
                  layerDisplayName,
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
        scheduleLegendRefresh();
        const state = highlightState[checkboxId];
        if (state && state.geoLayers)
          state.geoLayers.forEach(function (gl) {
            try {
              gl.addTo(map);
            } catch (e) {}
          });
        updateLayerItemStatus(checkboxId, "loaded");
        var _cb = document.getElementById(checkboxId);
        if (_cb) _cb.style.background = layerColorMap[checkboxId] || "#8B4513";
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
        // 图层级数据来源 → 要素属性「数据源」，弹窗/tooltip 中展示
        if (layerSourceMap[checkboxId] && data_ && data_.features) {
          data_.features.forEach(function (f) {
            if (f && f.properties)
              f.properties.数据源 = layerSourceMap[checkboxId];
          });
        }
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
        scheduleLegendRefresh();

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
        var _cb2 = document.getElementById(checkboxId);
        if (_cb2)
          _cb2.style.background = layerColorMap[checkboxId] || "#8B4513";

        // 要素计数后缀（N 点/线/面）：无条件更新，与搜索索引是否已预建无关。
        // 先前该调用位于 if(!searchIndexMap) 分支内，导致带 searchPriority 的图层
        // （如 Gazetteer_*）因启动即后台建索引而跳过计数渲染。
        if (data_ && data_.features)
          updateLayerCount(checkboxId, data_.features);

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
              searchPriority: !!layerSearchPriorityMap[checkboxId],
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

    // ========== Canvas 图标 Image 加载辅助 ==========
    function _loadCanvasIconImage(iconType, iconSize, checkboxId, callback) {
      if (L.GeoMarker.isExternalPath(iconType)) {
        var extImg = new Image();
        extImg.onload = function () {
          if (callback) callback(extImg);
        };
        extImg.onerror = function () {
          if (callback) callback(null);
        };
        extImg.src = iconType;
      } else {
        var iconFn = L.GeoMarker.getIconFactory(iconType, iconSize);
        if (iconFn) {
          var lColor = layerColorMap[checkboxId] || "#888";
          var divIcon = iconFn(lColor);
          var svgHtml = divIcon.options.html || "";
          if (svgHtml) {
            try {
              var svgData =
                "data:image/svg+xml;base64," +
                btoa(unescape(encodeURIComponent(svgHtml)));
              var svgImg = new Image();
              svgImg.onload = function () {
                if (callback) callback(svgImg);
              };
              svgImg.onerror = function () {
                if (callback) callback(null);
              };
              svgImg.src = svgData;
              return;
            } catch (e) {}
          }
        }
        if (callback) callback(null);
      }
    }

    // 为多颜色模式生成 { colorHex → Image } 映射
    function _loadCanvasIconColorMap(
      features,
      iconType,
      iconSize,
      checkboxId,
      callback,
    ) {
      var iconFn = L.GeoMarker.getIconFactory(iconType, iconSize);
      if (!iconFn) {
        if (callback) callback(null);
        return;
      }
      var colorSet = {};
      for (var i = 0; i < features.length; i++) {
        if (features[i] && features[i].color)
          colorSet[features[i].color] = true;
      }
      var colors = Object.keys(colorSet);
      if (!colors.length) {
        if (callback) callback(null);
        return;
      }
      var result = {};
      var pending = colors.length;
      for (var c = 0; c < colors.length; c++) {
        (function (color) {
          var divIcon = iconFn(color);
          var svgHtml = divIcon.options.html || "";
          if (!svgHtml) {
            if (--pending <= 0) tryFinish();
            return;
          }
          try {
            var svgData =
              "data:image/svg+xml;base64," +
              btoa(unescape(encodeURIComponent(svgHtml)));
            var img = new Image();
            img.onload = function () {
              result[color] = img;
              tryFinish();
            };
            img.onerror = function () {
              tryFinish();
            };
            img.src = svgData;
          } catch (e) {
            tryFinish();
          }
          function tryFinish() {
            if (--pending <= 0 && callback) callback(result);
          }
        })(colors[c]);
      }
    }

    // ========== 递归应用图层不透明度 ==========
    // 统一处理：矢量要素（setStyle）、点标记（L.Marker+divIcon，无 setStyle）、
    // 嵌套组（featureGroup/geoJSON）、以及 markerClusterGroup。
    // 关键：markerClusterGroup.eachLayer 只遍历当前可见的 cluster/marker，
    // 拿不到被聚合隐藏的单个 marker；用 getAllChildMarkers() 遍历全部子 marker，
    // 确保单个图形（三角形/星/热点等）也能即时响应透明度调整。
    function applyLayerOpacity(layer, op) {
      if (!layer) return;
      // 1. 嵌套组：递归子层
      if (typeof layer.eachLayer === "function") {
        layer.eachLayer(function (child) {
          applyLayerOpacity(child, op);
        });
      }
      // 2. markerClusterGroup：补遍历所有子 marker（含已聚合隐藏的）
      if (typeof layer.getAllChildMarkers === "function") {
        try {
          var cms = layer.getAllChildMarkers();
          if (cms && cms.length) {
            for (var i = 0; i < cms.length; i++) {
              applyLayerOpacity(cms[i], op);
            }
          }
        } catch (e) {}
      }
      // 3. 矢量要素（线/面）：setStyle
      if (typeof layer.setStyle === "function") {
        var style = { opacity: op, fillOpacity: op };
        if (layer.feature) {
          var gt = ((layer.feature.geometry || {}).type || "").toLowerCase();
          if (gt === "linestring" || gt === "multilinestring") {
            style.fillOpacity = 0;
          }
        }
        layer.setStyle(style);
        return;
      }
      // 4. 点标记（L.Marker + divIcon）：无 setStyle，直接改 DOM 透明度
      if (typeof layer.getElement === "function") {
        var el = layer.getElement();
        if (el) {
          // 优先改内层 .gm-op-wrap（创建时已烘焙的透明度容器），
          // 否则回退到外层元素，确保滑杆调整能覆盖默认淡出值
          var wrap = el.querySelector ? el.querySelector(".gm-op-wrap") : null;
          if (wrap) wrap.style.opacity = op;
          else el.style.opacity = op;
          layer._layerOpacity = op;
        }
      }
    }

    function reloadLayerWithNewMode(
      checkboxId,
      newMode,
      newColor,
      newField,
      newOpacity,
      forceRebuild,
    ) {
      // 更新颜色模式
      colorMode[checkboxId] = newMode;
      if (newMode === "single" && newColor)
        layerColorMap[checkboxId] = newColor;
      if (newMode === "field") fieldKey[checkboxId] = newField;
      if (newOpacity !== undefined) layerOpacityMap[checkboxId] = newOpacity;

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
        // 不透明度：直接写入 options 并重绘（_redraw 内已用 globalAlpha 应用）
        if (newOpacity !== undefined) {
          canvasLayer.options.opacity = newOpacity;
          if (canvasLayer._map) canvasLayer._redraw(true);
        }
        var cachedFeatures = canvasFeaturesCache[checkboxId] || null;

        var iconType_r = layerIconMap[checkboxId];
        var iconSize_r = layerIconSizeMap[checkboxId] || 20;

        // 颜色更新完成后的回调：刷新图标颜色映射 + 重绘
        function afterColorUpdate() {
          if (iconType_r) {
            if (newMode === "field") {
              _loadCanvasIconColorMap(
                cachedFeatures,
                iconType_r,
                iconSize_r,
                checkboxId,
                function (colorMap) {
                  canvasLayer.options.iconImages = colorMap;
                  // 保留 iconImage 作为兜底（找不到对应颜色时使用）
                  canvasLayer.options.iconSize = iconSize_r;
                  if (canvasLayer._map) canvasLayer._redraw(true);
                },
              );
              // 同时加载默认色的单色图作为兜底
              _loadCanvasIconImage(
                iconType_r,
                iconSize_r,
                checkboxId,
                function (img) {
                  if (img) canvasLayer.options.iconImage = img;
                },
              );
            } else {
              _loadCanvasIconImage(
                iconType_r,
                iconSize_r,
                checkboxId,
                function (img) {
                  canvasLayer.options.iconImage = img;
                  canvasLayer.options.iconImages = null;
                  canvasLayer.options.iconSize = iconSize_r;
                  if (canvasLayer._map) canvasLayer._redraw(true);
                },
              );
            }
          } else {
            canvasLayer.options.iconImage = null;
            canvasLayer.options.iconImages = null;
            if (canvasLayer._map) canvasLayer._redraw(true);
          }
          updateColorBtnHint(checkboxId);
        }

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
                afterColorUpdate();
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
            afterColorUpdate();
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
        // 非 Canvas 图层
        // 如果只是透明度变化（颜色模式未变），直接刷新已有图层样式，避免重建
        var cached = layerCache[checkboxId];
        if (
          cached &&
          typeof cached.eachLayer === "function" &&
          newOpacity !== undefined &&
          !forceRebuild
        ) {
          const op = newOpacity;
          // 递归应用透明度：覆盖矢量、点 marker、嵌套组、聚类组（getAllChildMarkers）
          cached.eachLayer(function (gl) {
            applyLayerOpacity(gl, op);
          });
          updateColorBtnHint(checkboxId);
          return;
        }

        // 颜色模式变化：清除缓存重建
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
            scheduleLegendRefresh();
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
      scheduleLegendRefresh();
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
              // layerBoundsCache 存的是 L.latLngBounds，不是地图图层，无需 removeLayer
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
      if (btn) btn.title = "图层设置 · " + getColorModeLabel(checkboxId);
    }

    const LAYER_SETTINGS_PREFIX = "dupal_layer_set_";

    // ========== 统一图层设置持久化 ==========
    // 所有图层自定义设置（颜色模式、名称字段等）统一为一个 JSON 对象，
    // 按 checkboxId 存入 localStorage。新增设置只需在 settings 对象加字段。
    function saveLayerSettings(checkboxId, settings) {
      try {
        localStorage.setItem(
          LAYER_SETTINGS_PREFIX + checkboxId,
          JSON.stringify(settings),
        );
      } catch (e) {}
    }
    function loadLayerSettings(checkboxId) {
      try {
        return (
          JSON.parse(
            localStorage.getItem(LAYER_SETTINGS_PREFIX + checkboxId),
          ) || {}
        );
      } catch (e) {
        return {};
      }
    }
    function clearLayerSettings(checkboxId) {
      try {
        localStorage.removeItem(LAYER_SETTINGS_PREFIX + checkboxId);
      } catch (e) {}
    }

    // ========== 图层设置弹窗（颜色 / 属性表 / 图表）==========
    let _layerDialog = null;
    let _layerDialogData = null;

    // 抽象：统计指定字段的唯一值个数（可复用：属性表筛选 + 图表绘制）
    function _getUniqueFieldValueCount(features, fieldName) {
      if (!features || !features.length) return 0;
      var set = {};
      var count = 0;
      for (var i = 0; i < features.length; i++) {
        var f = features[i];
        if (f && f.properties) {
          var v = f.properties[fieldName];
          if (v != null && typeof v !== "object" && !set.hasOwnProperty(v)) {
            set[v] = true;
            count++;
          }
        }
      }
      return count;
    }

    function getColorPanelHTML(
      checkboxId,
      fields,
      userLabelField,
      isPointLayer,
    ) {
      const mode =
        colorMode[checkboxId] ||
        defaultColorModeMap[checkboxId] ||
        "sequential";
      const currentField =
        fieldKey[checkboxId] || defaultColorFieldMap[checkboxId] || "";
      const currentColor = layerColorMap[checkboxId] || "#8B4513";
      const defaultLabelField =
        labelFieldMap[checkboxId] || DEFAULT_LABEL_FIELD;
      const currentIconSize = layerIconSizeMap[checkboxId] || 20;
      const currentOpacity =
        layerOpacityMap[checkboxId] !== undefined
          ? layerOpacityMap[checkboxId]
          : 0.8;
      const fieldOptions = fields
        .map(function (f) {
          return `<option value="${f}" ${f === currentField ? "selected" : ""}>${f}</option>`;
        })
        .join("");
      const labelFieldOptions = fields
        .map(function (f) {
          return `<option value="${f}" ${f === userLabelField ? "selected" : ""}>${f}</option>`;
        })
        .join("");

      return `
        <div class="color-settings-panel">
          <div class="dlg-name-field-row">
            <label class="dlg-name-field-label">名称字段：</label>
            <div class="dlg-name-field-controls">
              <select id="dlgNameFieldSelect" class="dlg-field-select">
                ${labelFieldOptions || '<option value="">无可用字段</option>'}
              </select>
              <button class="dlg-btn dlg-btn-sm" id="dlgNameFieldReset" title="恢复默认字段">恢复默认</button>
            </div>
          </div>
          <hr class="dlg-section-divider">
          <div class="color-mode-group">
            <label class="color-mode-option">
              <input type="radio" name="dlgColorMode" value="single" ${mode === "single" ? "checked" : ""}>
              <span>单一颜色</span>
            </label>
            <label class="color-mode-option">
              <input type="radio" name="dlgColorMode" value="sequential" ${mode === "sequential" ? "checked" : ""}>
              <span>内部多颜色（全部不同）</span>
            </label>
            <label class="color-mode-option">
              <input type="radio" name="dlgColorMode" value="field" ${mode === "field" ? "checked" : ""}>
              <span>内部多颜色（按字段分色）</span>
            </label>
          </div>
          <div id="dlgSingleColorPanel" style="display:${mode === "single" ? "block" : "none"};margin-top:10px;">
            <label style="font-size:12px;color:#555;">选择颜色：</label>
            <input type="color" id="dlgColorPicker" value="${currentColor}" style="margin-left:8px;cursor:pointer;">
            <span id="dlgColorHex" style="font-size:12px;color:#888;margin-left:6px;">${currentColor}</span>
          </div>
          <div id="dlgFieldColorPanel" style="display:${mode === "field" ? "block" : "none"};margin-top:10px;">
            <label style="font-size:12px;color:#555;display:block;margin-bottom:4px;">选择字段：</label>
            <div style="display:flex;align-items:center;gap:6px;">
              <select id="dlgFieldSelect" class="dlg-field-select">
                ${fieldOptions || '<option value="">无可用字段</option>'}
              </select>
              <span id="dlgFieldCount" class="dlg-field-count" style="display:none;"></span>
            </div>
          </div>
          ${
            isPointLayer
              ? `
          <hr class="dlg-section-divider">
          <div class="dlg-icon-section">
            <label style="font-size:12px;color:#555;display:block;margin-bottom:6px;font-weight:600;">标记图标</label>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span id="dlgIconPreview" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid #ddd;border-radius:4px;background:#f9f9f9;"></span>
              <select id="dlgIconSelect" class="dlg-field-select" style="max-width:180px;">
                <option value="">默认圆点</option>
                <option value="volcano">三角形</option>
                <option value="hotspot">同心圆</option>
                <option value="star">五角形</option>
                <option value="volcano-file">火山</option>
                <option value="hotspot-file">火焰</option>
                <option value="__custom__">自定义上传...</option>
              </select>
              <input type="file" id="dlgIconUpload" accept=".svg,.png,.ico,.jpg,.jpeg,.gif,.webp" style="display:none;">
              <button class="dlg-btn dlg-btn-sm" id="dlgIconReset" title="恢复为默认图标">恢复默认</button>
              <span id="dlgIconHint" style="font-size:11px;color:#999;">SVG/PNG/ICO</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
              <label style="font-size:12px;color:#555;">图标大小：</label>
              <input type="number" id="dlgIconSize" value="${currentIconSize}" min="8" max="64" step="2" style="width:60px;padding:3px 6px;border:1px solid #ccc;border-radius:4px;font-size:13px;">
              <span style="font-size:11px;color:#999;">px</span>
            </div>
          </div>
          `
              : ""
          }
          <hr class="dlg-section-divider">
          <div class="dlg-opacity-section" style="margin-top:8px;">
            <label style="font-size:12px;color:#555;display:block;margin-bottom:4px;font-weight:600;">
              不透明度：<span id="dlgOpacityValue">${Math.round(currentOpacity * 100)}</span>%
            </label>
            <input type="range" id="dlgOpacitySlider" min="0" max="1" step="0.05" value="${currentOpacity}"
              style="width:100%;cursor:pointer;">
          </div>
        </div>`;
    }

    function getAttrTablePanelHTML() {
      return '<div class="tab-placeholder"><span style="font-size:32px;">📋</span><p style="color:#888;margin-top:8px;">属性表功能开发中，敬请期待</p></div>';
    }

    function getChartPanelHTML() {
      return '<div class="tab-placeholder"><span style="font-size:32px;">📊</span><p style="color:#888;margin-top:8px;">图表功能开发中，敬请期待</p></div>';
    }

    function getLayerDialogHTML(
      checkboxId,
      layerName,
      fields,
      userLabelField,
      isPointLayer,
    ) {
      return `
        <div class="layer-dialog-content">
          <div class="dialog-header">
            <h3>⚙️ ${layerName}</h3>
            <button class="dialog-close" id="dlgCloseBtn">&times;</button>
          </div>
          <div class="dlg-tabs">
            <button class="dlg-tab active" data-tab="color">🎨 颜色</button>
            <button class="dlg-tab" data-tab="attr">📋 属性表</button>
            <button class="dlg-tab" data-tab="chart">📊 图表</button>
          </div>
          <div class="dlg-tab-content" id="dlgTabColor">${getColorPanelHTML(checkboxId, fields, userLabelField, isPointLayer)}</div>
          <div class="dlg-tab-content" id="dlgTabAttr" style="display:none;">${getAttrTablePanelHTML()}</div>
          <div class="dlg-tab-content" id="dlgTabChart" style="display:none;">${getChartPanelHTML()}</div>
          <div class="dialog-footer">
            <button class="dlg-btn dlg-btn-secondary" id="dlgCancelBtn">取消</button>
            <button class="dlg-btn dlg-btn-primary" id="dlgConfirmBtn">确认</button>
          </div>
        </div>`;
    }

    function openLayerDialog(checkboxId, fileName, filePath, layerName) {
      if (_layerDialog) {
        _layerDialog.close();
        _layerDialog.remove();
        _layerDialog = null;
      }

      function showDialog(fields, featuresData, userLabelField) {
        // 判断是否为点要素图层（仅点图层显示图标设置）
        var isPointLayer =
          featuresData &&
          featuresData.some(function (f) {
            var t = ((f.geometry && f.geometry.type) || "").toLowerCase();
            return t === "point" || t === "multipoint";
          });

        _layerDialogData = {
          checkboxId: checkboxId,
          fileName: fileName,
          filePath: filePath,
          features: featuresData,
        };

        var dlg = document.createElement("dialog");
        dlg.className = "app-dialog layer-dialog";
        dlg.innerHTML = getLayerDialogHTML(
          checkboxId,
          layerName,
          fields,
          userLabelField,
          isPointLayer,
        );
        document.body.appendChild(dlg);
        _layerDialog = dlg;

        // === Tab 切换 ===
        dlg.querySelectorAll(".dlg-tab").forEach(function (btn) {
          btn.addEventListener("click", function () {
            dlg.querySelectorAll(".dlg-tab").forEach(function (b) {
              b.classList.remove("active");
            });
            this.classList.add("active");
            var tab = this.dataset.tab;
            ["color", "attr", "chart"].forEach(function (t) {
              var el = document.getElementById(
                "dlgTab" + t.charAt(0).toUpperCase() + t.slice(1),
              );
              if (el) el.style.display = t === tab ? "block" : "none";
            });
          });
        });

        // === 名称字段选择 ===
        var nameFieldSel = document.getElementById("dlgNameFieldSelect");
        var nameFieldReset = document.getElementById("dlgNameFieldReset");
        if (nameFieldReset) {
          nameFieldReset.addEventListener("click", function () {
            var s = loadLayerSettings(checkboxId);
            delete s.labelField;
            saveLayerSettings(checkboxId, s);
            // 重置到默认字段（labelFieldMap 或 "Name"）
            var defaultField = labelFieldMap[checkboxId] || DEFAULT_LABEL_FIELD;
            if (nameFieldSel) nameFieldSel.value = defaultField;
          });
        }

        // === 颜色模式切换 ===
        dlg
          .querySelectorAll('input[name="dlgColorMode"]')
          .forEach(function (r) {
            r.addEventListener("change", function () {
              var sp = document.getElementById("dlgSingleColorPanel");
              if (sp)
                sp.style.display = this.value === "single" ? "block" : "none";
              var fp = document.getElementById("dlgFieldColorPanel");
              if (fp)
                fp.style.display = this.value === "field" ? "block" : "none";
              // 切换到 field 模式时更新计数
              if (this.value === "field") updateFieldCount();
            });
          });

        // === 字段选择 → 显示唯一值计数 ===
        function updateFieldCount() {
          var sel = document.getElementById("dlgFieldSelect");
          var cntEl = document.getElementById("dlgFieldCount");
          if (!sel || !cntEl || !_layerDialogData || !_layerDialogData.features)
            return;
          var field = sel.value;
          if (field) {
            var cnt = _getUniqueFieldValueCount(
              _layerDialogData.features,
              field,
            );
            cntEl.style.display = "inline";
            cntEl.textContent = "唯一值: " + cnt;
          } else {
            cntEl.style.display = "none";
          }
        }
        var fieldSel = document.getElementById("dlgFieldSelect");
        if (fieldSel) {
          fieldSel.addEventListener("change", updateFieldCount);
          // 如果当前 mode 是 field，立即显示
          var curMode = dlg.querySelector('input[name="dlgColorMode"]:checked');
          if (curMode && curMode.value === "field") updateFieldCount();
        }

        // === 色值实时预览 ===
        var cp = document.getElementById("dlgColorPicker");
        if (cp) {
          cp.addEventListener("input", function () {
            var hex = document.getElementById("dlgColorHex");
            if (hex) hex.textContent = this.value;
          });
          cp.addEventListener("change", function () {
            var sel = dlg.querySelector('input[name="dlgColorMode"]:checked');
            if (sel && sel.value === "single") {
              layerColorMap[_layerDialogData.checkboxId] = this.value;
              refreshLayerColors(_layerDialogData.checkboxId);
            }
          });
        }

        // === 不透明度滑块 ===
        var opSlider = document.getElementById("dlgOpacitySlider");
        var opValue = document.getElementById("dlgOpacityValue");
        if (opSlider && opValue) {
          opSlider.addEventListener("input", function () {
            opValue.textContent = Math.round(this.value * 100);
          });
        }

        // === 图标上传 ===
        var iconUpload = document.getElementById("dlgIconUpload");
        var iconPreview = document.getElementById("dlgIconPreview");
        var iconReset = document.getElementById("dlgIconReset");
        var _dlgIconSettings =
          _layerDialogData && _layerDialogData.checkboxId
            ? loadLayerSettings(_layerDialogData.checkboxId)
            : {};
        window._dlgIconValue =
          _dlgIconSettings.iconValue ||
          defaultIconMap[_layerDialogData.checkboxId] ||
          "";

        if (iconUpload && iconPreview) {
          // 恢复已保存的图标预览（内置/文件图标由下方的初始化预览处理，这里只处理 dataURL）
          if (
            window._dlgIconValue &&
            window._dlgIconValue.indexOf("data:") === 0
          ) {
            iconPreview.innerHTML =
              '<img src="' +
              window._dlgIconValue +
              '" style="width:100%;height:100%;object-fit:contain;">';
            iconPreview.dataset.iconValue = window._dlgIconValue;
          }

          iconUpload.addEventListener("change", function () {
            var file = this.files && this.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (e) {
              var dataUrl = e.target.result;
              window._dlgIconValue = dataUrl;
              iconPreview.dataset.iconValue = dataUrl;
              iconPreview.innerHTML =
                '<img src="' +
                dataUrl +
                '" style="width:100%;height:100%;object-fit:contain;">';
              // 切换到自定义模式
              var sel = document.getElementById("dlgIconSelect");
              if (sel) sel.value = "__custom__";
            };
            reader.readAsDataURL(file);
          });
        }

        if (iconReset) {
          iconReset.addEventListener("click", function () {
            // 恢复 geo-config 默认图标（如有），否则清空
            var defaultIcon = defaultIconMap[_layerDialogData.checkboxId] || "";
            window._dlgIconValue = defaultIcon;
            iconPreview.dataset.iconValue = defaultIcon;
            iconPreview.innerHTML = defaultIcon
              ? '<img src="' +
                defaultIcon +
                '" style="width:100%;height:100%;object-fit:contain;">'
              : "";
            // 恢复默认尺寸 20px
            var szEl = document.getElementById("dlgIconSize");
            if (szEl) szEl.value = "20";
            var s = loadLayerSettings(_layerDialogData.checkboxId) || {};
            if (defaultIcon) s.iconValue = defaultIcon;
            else delete s.iconValue;
            saveLayerSettings(_layerDialogData.checkboxId, s);
            if (defaultIcon)
              layerIconMap[_layerDialogData.checkboxId] = defaultIcon;
            else delete layerIconMap[_layerDialogData.checkboxId];
          });
        }

        // === 图标选择下拉 ===
        var iconSelect = document.getElementById("dlgIconSelect");
        if (iconSelect && iconPreview) {
          // 根据当前图标值设置选中项
          var curVal = window._dlgIconValue;
          if (!curVal || curVal === "point") {
            iconSelect.value = "";
            iconSelect.dataset._prevNonCustom = "";
          } else if (
            curVal === "volcano" ||
            curVal === "hotspot" ||
            curVal === "star" ||
            curVal === "volcano-file" ||
            curVal === "hotspot-file"
          ) {
            iconSelect.value = curVal;
            iconSelect.dataset._prevNonCustom = curVal;
          } else {
            iconSelect.value = "__custom__";
            iconSelect.dataset._prevNonCustom = "";
          }

          function updateIconPreviewFromSelect(val) {
            var color = "#888";
            try {
              var cp = document.getElementById("dlgColorPicker");
              if (cp) color = cp.value;
            } catch (e) {}
            if (!val) {
              // 默认圆点
              var dotIcon = L.GeoMarker.createPointIcon(color, 10);
              iconPreview.innerHTML = dotIcon.options.html;
              iconPreview.dataset.iconValue = "";
              window._dlgIconValue = "";
            } else if (val === "volcano") {
              var vIcon = L.GeoMarker.createVolcanoIcon(color);
              iconPreview.innerHTML = vIcon.options.html;
              iconPreview.dataset.iconValue = "volcano";
              window._dlgIconValue = "volcano";
            } else if (val === "hotspot") {
              var hIcon = L.GeoMarker.createHotspotIcon(color);
              iconPreview.innerHTML = hIcon.options.html;
              iconPreview.dataset.iconValue = "hotspot";
              window._dlgIconValue = "hotspot";
            } else if (val === "star") {
              var sIcon = L.GeoMarker.createStarIcon(color);
              iconPreview.innerHTML = sIcon.options.html;
              iconPreview.dataset.iconValue = "star";
              window._dlgIconValue = "star";
            } else if (val === "volcano-file" || val === "hotspot-file") {
              // 文件 SVG 图标：使用工厂函数生成带色的预览
              var fIcon = L.GeoMarker.getIconFactory(val, 20);
              if (fIcon) {
                var fiDiv = fIcon(color);
                iconPreview.innerHTML = fiDiv.options.html;
                iconPreview.dataset.iconValue = val;
                window._dlgIconValue = val;
              }
            }
          }

          iconSelect.addEventListener("change", function () {
            var val = this.value;
            if (val === "__custom__") {
              // 触发文件上传
              var up = document.getElementById("dlgIconUpload");
              if (up) up.click();
              // 保持上一次的非自定义值
              this.value = iconSelect.dataset._prevNonCustom || "";
              return;
            }
            iconSelect.dataset._prevNonCustom = val;
            if (
              val === "volcano" ||
              val === "hotspot" ||
              val === "star" ||
              val === "volcano-file" ||
              val === "hotspot-file"
            ) {
              updateIconPreviewFromSelect(val);
            } else {
              // 默认圆点
              updateIconPreviewFromSelect("");
            }
          });
          // 初始化预览
          if (
            curVal === "volcano" ||
            curVal === "hotspot" ||
            curVal === "star" ||
            curVal === "volcano-file" ||
            curVal === "hotspot-file"
          ) {
            updateIconPreviewFromSelect(curVal);
          } else {
            // 默认圆点
            updateIconPreviewFromSelect("");
          }
        }

        // === 关闭与取消 ===
        dlg.querySelector("#dlgCloseBtn").onclick = function () {
          dlg.close();
        };
        dlg.querySelector("#dlgCancelBtn").onclick = function () {
          dlg.close();
        };
        dlg.addEventListener("click", function (e) {
          if (e.target === dlg) dlg.close();
        });

        // === 确认：保存所有设置 ===
        dlg.querySelector("#dlgConfirmBtn").onclick = function () {
          if (!_layerDialogData) return;
          var cbId = _layerDialogData.checkboxId;
          var selMode = dlg.querySelector('input[name="dlgColorMode"]:checked');
          var newMode = selMode ? selMode.value : "sequential";
          var cp = dlg.querySelector("#dlgColorPicker");
          var newColor = cp ? cp.value : layerColorMap[cbId];
          var fs = dlg.querySelector("#dlgFieldSelect");
          var newField = fs ? fs.value : "";
          var nameFieldSel = dlg.querySelector("#dlgNameFieldSelect");
          var nf = nameFieldSel ? nameFieldSel.value : "";
          var newIcon = window._dlgIconValue || "";
          var oldIcon = layerIconMap[cbId] || "";
          var oldIconSize = layerIconSizeMap[cbId] || 20;
          var iconChanged = newIcon !== oldIcon || newIconSize !== oldIconSize;
          var iconSizeEl = dlg.querySelector("#dlgIconSize");
          var newIconSize = iconSizeEl
            ? parseInt(iconSizeEl.value, 10) || 20
            : 20;
          var opSlider = dlg.querySelector("#dlgOpacitySlider");
          var newOpacity = opSlider ? parseFloat(opSlider.value) : 0.8;

          // 统一写入持久化设置
          var s = {};
          s.colorMode = newMode;
          s.colorValue = newColor;
          s.opacity = newOpacity;
          if (newField) s.colorField = newField;
          if (nf) s.labelField = nf;
          if (newIcon) s.iconValue = newIcon;
          else delete s.iconValue;
          s.iconSize = newIconSize;
          saveLayerSettings(cbId, s);

          // 更新图标映射
          if (newIcon) layerIconMap[cbId] = newIcon;
          else delete layerIconMap[cbId];
          layerIconSizeMap[cbId] = newIconSize;
          layerOpacityMap[cbId] = newOpacity;

          // 统一通过 reloadLayerWithNewMode 更新（Canvas 图标的 Image 在其中刷新）
          // iconChanged（图标类型或大小变化）时强制重建图层，否则仅更新透明度即可
          reloadLayerWithNewMode(
            cbId,
            newMode,
            newColor,
            newField,
            newOpacity,
            iconChanged,
          );
          dlg.close();
        };

        dlg.addEventListener("close", function () {
          _layerDialog = null;
          _layerDialogData = null;
          dlg.remove();
        });

        dlg.showModal();
      }

      // ---- 获取字段列表 ----
      function loadFieldsAndShow(data_) {
        var fields = window.GeoUtils.getAvailableFields(data_);
        var savedSettings = loadLayerSettings(checkboxId);
        var userLabelField =
          savedSettings.labelField || labelFieldMap[checkboxId] || "";
        showDialog(fields, data_.features || [], userLabelField);
      }

      var si = searchIndexMap[checkboxId];
      if (si && si.features) {
        loadFieldsAndShow({ type: "FeatureCollection", features: si.features });
      } else if (filePath) {
        function doFetch(p) {
          fetchGzGeoJSON(p).then(loadFieldsAndShow);
        }
        if (filePath.startsWith("http")) {
          fetchGzGeoJSON(filePath)
            .then(loadFieldsAndShow)
            .catch(function () {
              doFetch(window.geoJsonBasePath + fileName);
            });
        } else {
          doFetch(filePath);
        }
      } else if (userLayerGeoJson[checkboxId]) {
        loadFieldsAndShow(userLayerGeoJson[checkboxId].geoJsonData);
      } else {
        alert("无法加载图层数据，请尝试重新添加图层。");
      }
    }

    // ========== 生成分组图层面板 ==========
    let globalLayerIndex = 0;
    var _seenLayerIds = {}; // 用于 makeLayerStableId 去重

    function generateLayerItems() {
      // 重置跨图层去重表（每轮面板生成清空，保证名称相同才冲突）
      _seenLayerIds = {};

      // 基于图层名生成稳定 checkboxId（不再依赖 globalLayerIndex 顺序序号）
      function makeLayerStableId(layerName, fallback) {
        var base = (layerName || fallback || "layer")
          .toLowerCase()
          .replace(/[^a-z0-9一-鿿]+/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "");
        if (!base) base = "layer";
        var id = base, n = 2;
        while (_seenLayerIds[id]) { id = base + "_" + n; n++; }
        _seenLayerIds[id] = true;
        return id;
      }

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
          var stableName = makeLayerStableId(layerConfig.name, layerConfig.file || layerConfig.url);
          var checkboxId = "layer_" + stableName;
          var fullPath = window.geoJsonPrimaryPath + layerConfig.file;
          var fileName = layerConfig.file;
          var fixedColor =
            layerConfig.color || window.GeoUtils.getFixedColor(idx);
          layerColorMap[checkboxId] = fixedColor;
          if (layerConfig.labelField)
            labelFieldMap[checkboxId] = layerConfig.labelField;
          if (layerConfig.colorMode)
            defaultColorModeMap[checkboxId] = layerConfig.colorMode;
          if (layerConfig.colorField)
            defaultColorFieldMap[checkboxId] = layerConfig.colorField;
          if (layerConfig.icon) {
            layerIconMap[checkboxId] = layerConfig.icon;
            defaultIconMap[checkboxId] = layerConfig.icon;
          }

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

          // 默认透明度（geo-config 的 defaultOpacity）：未被用户设置覆盖时生效
          if (
            layerConfig.defaultOpacity !== undefined &&
            layerOpacityMap[checkboxId] === undefined
          ) {
            layerOpacityMap[checkboxId] = Number(layerConfig.defaultOpacity);
          }
          // 搜索优先标记（如海底地名集）
          if (layerConfig.searchPriority) {
            layerSearchPriorityMap[checkboxId] = true;
          }
          // 图层级数据来源（显示在要素弹窗「数据源」字段）
          if (layerConfig.source) {
            layerSourceMap[checkboxId] = layerConfig.source;
          }

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
              searchPriority: !!layerConfig.searchPriority,
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
              // 高级功能：未激活则提示
              if (!window.premiumCheck || !window.premiumCheck()) {
                if (typeof window.showToast === "function")
                  window.showToast("🔒 下载 GeoJSON 需要激活高级功能", {
                    duration: 3000,
                  });
                return;
              }
              downloadLayerGeoJson(cbId, fPath, fName);
            });
          })(checkboxId, fullPath, layerConfig.name);

          var settingsBtn = document.createElement("button");
          settingsBtn.className = "layer-color-btn";
          settingsBtn.title = "图层设置";
          settingsBtn.innerHTML = "⚙️";
          settingsBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            openLayerDialog(
              checkboxId,
              layerConfig.file,
              fullPath,
              layerConfig.name,
            );
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
          layerItem.appendChild(settingsBtn);
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

      // 搜索优先图层的后台静默建索引：不渲染到地图，仅构建倒排索引，
      // 使其即使未勾选也能被搜索（如海底地名集 Gazetteer_*）
      function initPrioritySearchIndices() {
        Object.keys(layerSearchPriorityMap).forEach(function (cbId) {
          if (searchIndexMap[cbId]) return; // 已建好（如用户已勾选加载过）
          var cb = document.getElementById(cbId);
          if (!cb || !cb.value) return;
          var filePath = cb.value;
          var fileName = filePath.split("/").pop();
          L.GzIdbLoader.fetch(filePath)
            .then(function (geojsonData) {
              var feats = geojsonData && geojsonData.features;
              if (!feats || !feats.length) return;
              featureCache[cbId] = feats;
              buildSearchIndex(cbId, feats, fileName, function () {});
            })
            .catch(function (e) {
              console.warn("[GeoJSONLoader] 优先图层索引构建失败:", cbId, e);
            });
        });
      }
      // 延迟启动，避免阻塞首屏渲染
      setTimeout(initPrioritySearchIndices, 2000);

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
      scheduleLegendRefresh();
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
            layerBoundsCache[uid] = b;
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
      checkbox.dataset.layerName = fileName;
      checkbox.addEventListener("change", function () {
        this.style.background = this.checked ? fixedColor : "#fff";
        // 勾选时展开到对应面板层级
        if (this.checked) expandToLayerGroup(this);
        if (this.checked) {
          if (layerCache[uid]) layerCache[uid].addTo(map);
        } else {
          if (layerCache[uid]) map.removeLayer(layerCache[uid]);
        }
        scheduleLegendRefresh();
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
          // 高级功能：未激活则提示
          if (!window.premiumCheck || !window.premiumCheck()) {
            if (typeof window.showToast === "function")
              window.showToast("🔒 下载 GeoJSON 需要激活高级功能", {
                duration: 3000,
              });
            return;
          }
          downloadLayerGeoJson(cbId, null, fName);
        });
      })(uid, fileName);

      var settingsBtn = document.createElement("button");
      settingsBtn.className = "layer-color-btn";
      settingsBtn.title = "图层设置";
      settingsBtn.innerHTML = "⚙️";
      settingsBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        openLayerDialog(uid, fileName, null, fileName);
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
        scheduleLegendRefresh();
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
      layerItem.appendChild(settingsBtn);
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
          if (data_ && data_.features) updateLayerCount(uid, data_.features);
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

      // 搜索结果数量与分页配置
      var FEATURE_SEARCH_CAP = 200; // 每个图层每阶段最多返回的要素数（原 30）
      var SEARCH_PAGE = 50; // 搜索结果初始展示条数
      var SEARCH_PAGE_STEP = 50; // 点击「查看更多」每次追加条数
      // 分页状态缓存（供「查看更多」复用最近一次完整结果列表）
      var _lastSearchItems = [];
      var _lastSearchQuery = "";
      var _lastSearchTotal = 0;
      var _searchShown = SEARCH_PAGE;

      function runSearch(query) {
        var q = query.toLowerCase().trim();
        var results = [];
        var totalCount = 0;

        // 要素属性匹配：返回命中的要素结果数组（最多 30 条），供各阶段复用
        function matchLayerFeatures(entry, qLower) {
          var si = searchIndexMap[entry.checkboxId];
          var features =
            si && si.features && si.features.length
              ? si.features
              : featureCache[entry.checkboxId] || null;
          if (!features || !features.length) return [];
          var matchedIndices = [];
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
                      for (var ai = 0; ai < arr.length; ai++)
                        merged[arr[ai]] = true;
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
                  for (var m2 = 0; m2 < matchedIndices.length; m2++) {
                    if (set.indexOf(matchedIndices[m2]) !== -1)
                      next.push(matchedIndices[m2]);
                  }
                  matchedIndices = next;
                  if (!matchedIndices.length) break;
                }
              }
            }
          }
          if (!matchedIndices || !matchedIndices.length) return [];
          // 去重：同一要素索引可能在同一 token 下重复出现
          // （旧版索引缓存含重复项、或同值跨多字段），避免搜索结果同一要素重复
          if (matchedIndices.length > 1) {
            var _seen = Object.create(null);
            var _dedup = [];
            for (var _di = 0; _di < matchedIndices.length; _di++) {
              var _idx = matchedIndices[_di];
              if (!_seen[_idx]) {
                _seen[_idx] = true;
                _dedup.push(_idx);
              }
            }
            matchedIndices = _dedup;
          }
          var limit = Math.min(matchedIndices.length, FEATURE_SEARCH_CAP);
          var out = [];
          for (var k = 0; k < limit; k++) {
            var f = features[matchedIndices[k]];
            out.push({
              type: "feature",
              label: entry.layerLabel,
              summary: buildSummary(f.properties),
              tooltipText: buildTooltipText(f.properties),
              feature: f,
              checkboxId: entry.checkboxId,
            });
          }
          return out;
        }

        // ===== 第零阶段：搜索优先图层（如海底地名集），未勾选也可搜，结果置顶 =====
        var priorityResults = [];
        searchRegistry.forEach(function (entry) {
          if (!entry.searchPriority) return;
          var hits = matchLayerFeatures(entry, q);
          if (hits.length) {
            priorityResults = priorityResults.concat(hits);
            totalCount += hits.length;
          }
        });

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
          // 搜索优先图层已在第零阶段处理（未勾选也可搜），此处跳过避免重复
          if (entry.searchPriority) return;
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
          // 去重：同一要素索引可能在同一 token 下重复出现
          // （旧版索引缓存含重复项、或同值跨多字段），避免搜索结果同一要素重复
          if (matchedIndices.length > 1) {
            var _seen = Object.create(null);
            var _dedup = [];
            for (var _di = 0; _di < matchedIndices.length; _di++) {
              var _idx = matchedIndices[_di];
              if (!_seen[_idx]) {
                _seen[_idx] = true;
                _dedup.push(_idx);
              }
            }
            matchedIndices = _dedup;
          }
          totalCount += matchedIndices.length;
          var limit = Math.min(matchedIndices.length, FEATURE_SEARCH_CAP);
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
        return { items: priorityResults.concat(results), total: totalCount };
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

      // ========== 天地图地名搜索结果积累图层 ==========
      var _tdtSearchPoints = [];
      var _tdtSearchLayerId = null;
      var _tdtSessionId = Date.now().toString(36);
      var _tdtPersistentId = "tdt_" + _tdtSessionId;
      var _TDT_LAYER_NAME = "🔍 地名记录 " + new Date().toLocaleString("zh-CN");

      function addTdtPointToLayer(poi) {
        _tdtSearchPoints.push(poi);

        // 构建 GeoJSON FeatureCollection（保留 POI 全部可用字段）
        var features = _tdtSearchPoints.map(function (p) {
          var coords = p.lonlat.split(",").map(parseFloat);
          var props = {};
          // Name 放第一个，作为弹窗标题
          props.Name = p.name || "";
          // 其余字段
          Object.keys(p).forEach(function (k) {
            if (k === "name" || k === "lonlat") return;
            props[k] = p[k] || "";
          });
          // lonlat 也作为字段展示
          if (p.lonlat) {
            var parts = p.lonlat.split(",");
            props.经度 = parts[0];
            props.纬度 = parts[1];
          }
          // 中文友好名
          if (props.address) {
            props.地址 = props.address;
            delete props.address;
          }
          if (props.phone) {
            props.电话 = props.phone;
            delete props.phone;
          }
          if (props.poiType) {
            props.分类码 = props.poiType;
            delete props.poiType;
          }
          if (props.source) {
            props.数据源 = props.source;
            delete props.source;
          }
          return {
            type: "Feature",
            properties: props,
            geometry: {
              type: "Point",
              coordinates: [coords[0], coords[1]],
            },
          };
        });
        var fc = { type: "FeatureCollection", features: features };

        // 移除旧图层（Leaflet 层 + checkbox）
        if (_tdtSearchLayerId) {
          try {
            map.removeLayer(layerCache[_tdtSearchLayerId]);
          } catch (e) {}
          delete layerCache[_tdtSearchLayerId];
          delete userLayerGeoJson[_tdtSearchLayerId];
          delete layerBoundsCache[_tdtSearchLayerId];
          delete colorMode[_tdtSearchLayerId];
          delete fieldKey[_tdtSearchLayerId];
          // Remove old checkbox DOM
          var oldCb = document.getElementById(_tdtSearchLayerId);
          if (oldCb) {
            var oldBar = oldCb.closest(".layer-item");
            if (oldBar) oldBar.remove();
          }
        }

        // 调用 addUserLayer 创建完整图层
        addUserLayer(fc, _TDT_LAYER_NAME, true, _tdtPersistentId);

        // 手动持久化到 IDB
        if (isRememberLayerEnabled()) {
          L.GzIdbLoader.setCache("user_geo_" + _tdtPersistentId, fc);
          saveUserLayerMeta(_tdtPersistentId, _TDT_LAYER_NAME);
        }

        // 找到刚创建的 layer checkbox（最新一个 user_layer）
        var allUserLayers = document.querySelectorAll(
          '#userLayerGroup .layer-item input[type="checkbox"]',
        );
        if (allUserLayers.length > 0) {
          _tdtSearchLayerId = allUserLayers[allUserLayers.length - 1].id;
        }

        // 自动勾选
        var cb = _tdtSearchLayerId
          ? document.getElementById(_tdtSearchLayerId)
          : null;
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // 缩放到新添加的点
        var coords = poi.lonlat.split(",").map(parseFloat);
        map.setView([coords[1], coords[0]], Math.max(map.getZoom(), 10), {
          animate: true,
        });
      }

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
          // 显示名称 + 地址，如有其他字段也在行内显示
          var label = poi.name;
          if (poi.address) label += "  " + poi.address;
          if (poi.phone) label += "  📞" + poi.phone;
          text.textContent = label;
          item.appendChild(tag);
          item.appendChild(text);

          // title 显示全部可用字段
          var tip = [];
          if (poi.name) tip.push(poi.name);
          if (poi.address) tip.push("地址: " + poi.address);
          if (poi.phone) tip.push("电话: " + poi.phone);
          if (poi.poiType) tip.push("分类码: " + poi.poiType);
          if (poi.source) tip.push("数据源: " + poi.source);
          if (poi.cityName) tip.push("城市: " + poi.cityName);
          item.title = tip.join("\n");

          if (poi.lonlat) {
            var parts = poi.lonlat.split(",");
            if (parts.length >= 2) {
              var lng = parseFloat(parts[0]);
              var lat = parseFloat(parts[1]);
              (function (lat_, lng_, poi_) {
                item.addEventListener("click", function () {
                  // 积累到地名搜索结果图层（内含缩放到该点）
                  addTdtPointToLayer(poi_);
                  // toast 提示
                  if (typeof window.showToast === "function") {
                    window.showToast(
                      "📍 已添加「" + poi_.name + "」到搜索结果图层",
                      {
                        duration: 2000,
                      },
                    );
                  }
                  resultsBox.classList.remove("open");
                });
              })(lat, lng, poi);
            }
          }
          resultsBox.appendChild(item);
        });
        resultsBox.classList.add("open");
      }

      // ========== UNEP-WCMC 全球海岛搜索 ==========
      var _unepCache = {}; // { query: [feat, ...] }

      function unepwcmcSearch(query, callback) {
        if (_unepCache[query]) {
          callback(_unepCache[query]);
          return;
        }

        var layerConfigs = [
          { id: 0, name: "超小海岛" },
          { id: 1, name: "小海岛" },
          { id: 2, name: "大海岛" },
        ];
        var completed = 0;
        var allResults = [];

        layerConfigs.forEach(function (cfg) {
          var where =
            "UPPER(name_usgso) LIKE UPPER('%25" +
            encodeURIComponent(query).replace(/%20/g, "+") +
            "%25')";
          var url =
            "https://data-gis.unep-wcmc.org/server/rest/services/Global_Islands/MapServer/" +
            cfg.id +
            "/query?where=" +
            where +
            "&outFields=name_usgso,plate,islandarea,name_wcmci,name_local" +
            "&returnGeometry=true&f=geojson&resultRecordCount=15&outSR=4326";

          fetch(url)
            .then(function (r) {
              return r.json();
            })
            .then(function (data) {
              if (data && data.features && data.features.length > 0) {
                data.features.forEach(function (f) {
                  f._layerName = cfg.name;
                  f._layerId = cfg.id;
                  allResults.push(f);
                });
              }
              completed++;
              if (completed === layerConfigs.length) {
                var seen = Object.create(null);
                var deduped = [];
                allResults.forEach(function (f) {
                  var key =
                    f.properties && f.properties.objectid_1 != null
                      ? String(f.properties.objectid_1)
                      : f.id != null
                        ? String(f.id)
                        : Math.random().toString();
                  if (seen[key]) return;
                  seen[key] = true;
                  deduped.push(f);
                });
                _unepCache[query] = deduped;
                callback(deduped);
              }
            })
            .catch(function () {
              completed++;
              if (completed === layerConfigs.length) callback(allResults);
            });
        });
      }

      function unepPolygonCenter(feature) {
        var coords = null;
        if (feature.geometry.type === "Polygon") {
          coords = feature.geometry.coordinates[0];
        } else if (feature.geometry.type === "MultiPolygon") {
          coords = feature.geometry.coordinates[0][0];
        }
        if (!coords || coords.length === 0) return null;
        var sumLng = 0,
          sumLat = 0;
        for (var i = 0; i < coords.length; i++) {
          sumLng += coords[i][0];
          sumLat += coords[i][1];
        }
        return [sumLat / coords.length, sumLng / coords.length];
      }

      function unepPolygonBounds(feature) {
        var coords = null;
        if (feature.geometry.type === "Polygon") {
          coords = feature.geometry.coordinates[0];
        } else if (feature.geometry.type === "MultiPolygon") {
          coords = feature.geometry.coordinates[0][0];
        }
        if (!coords || coords.length === 0) return null;
        var minLat = Infinity,
          maxLat = -Infinity,
          minLng = Infinity,
          maxLng = -Infinity;
        for (var i = 0; i < coords.length; i++) {
          var lng = coords[i][0],
            lat = coords[i][1];
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }
        return [
          [minLat, minLng],
          [maxLat, maxLng],
        ];
      }

      var _unepSearchFeatures = [];
      var _unepSearchLayerId = null;
      var _unepSessionId = Date.now().toString(36);
      var _unepPersistentId = "unep_" + _unepSessionId;
      var _UNEP_LAYER_NAME =
        "🏝️ 海岛记录 " + new Date().toLocaleString("zh-CN");

      function addUnepFeatureToLayer(feature, displayName) {
        var props = feature.properties || {};
        // 保留原始多边形几何，仅重命名属性为中文友好
        var enriched = JSON.parse(JSON.stringify(feature));
        enriched.properties = {
          Name: displayName || props.name_usgso || "(无名海岛)",
          板块: props.plate || "",
          面积_km2: props.islandarea
            ? parseFloat(props.islandarea).toFixed(4)
            : "",
          数据源: "UNEP-WCMC Global Islands v3",
          岛屿分类: feature._layerName || "",
        };
        _unepSearchFeatures.push(enriched);
        rebuildUnepLayer();
      }

      function rebuildUnepLayer() {
        var fc = {
          type: "FeatureCollection",
          features: _unepSearchFeatures,
        };

        if (_unepSearchLayerId) {
          try {
            map.removeLayer(layerCache[_unepSearchLayerId]);
          } catch (e) {}
          delete layerCache[_unepSearchLayerId];
          delete userLayerGeoJson[_unepSearchLayerId];
          delete layerBoundsCache[_unepSearchLayerId];
          delete colorMode[_unepSearchLayerId];
          delete fieldKey[_unepSearchLayerId];
          var oldCb = document.getElementById(_unepSearchLayerId);
          if (oldCb) {
            var oldBar = oldCb.closest(".layer-item");
            if (oldBar) oldBar.remove();
          }
        }

        addUserLayer(fc, _UNEP_LAYER_NAME, true, _unepPersistentId);

        if (isRememberLayerEnabled()) {
          L.GzIdbLoader.setCache("user_geo_" + _unepPersistentId, fc);
          saveUserLayerMeta(_unepPersistentId, _UNEP_LAYER_NAME);
        }

        var allUserLayers = document.querySelectorAll(
          '#userLayerGroup .layer-item input[type="checkbox"]',
        );
        if (allUserLayers.length > 0) {
          _unepSearchLayerId = allUserLayers[allUserLayers.length - 1].id;
        }

        var cb = _unepSearchLayerId
          ? document.getElementById(_unepSearchLayerId)
          : null;
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      window.__unepwcmcSearch = function (query) {
        var inp = document.getElementById("searchInput");
        if (inp) inp.value = query;
        unepwcmcSearch(query, function (features) {
          renderUnepResults(features, query);
        });
      };

      function renderUnepResults(features, query) {
        resultsBox.innerHTML = "";
        if (!features || features.length === 0) {
          resultsBox.innerHTML =
            '<div class="search-empty">🏝️ UNEP-WCMC 未找到匹配海岛</div>';
          resultsBox.classList.add("open");
          return;
        }

        var title = document.createElement("div");
        title.className = "search-empty";
        title.style.cssText =
          "font-size:11px;color:var(--text-dim);padding-bottom:4px;";
        title.textContent =
          "🏝️ 全球海岛（UNEP-WCMC）共 " + features.length + " 条";
        resultsBox.appendChild(title);

        features.forEach(function (feat) {
          var props = feat.properties || {};
          var name =
            props.name_usgso && props.name_usgso.trim()
              ? props.name_usgso.trim()
              : "(无名海岛)";
          var plate = props.plate || "";
          var area = props.islandarea
            ? parseFloat(props.islandarea).toFixed(2) + " km²"
            : "";
          var layerName = feat._layerName || "";

          var item = document.createElement("div");
          item.className = "search-result-item";

          var tag = document.createElement("span");
          tag.className = "search-result-tag";
          tag.textContent = "🏝️ " + layerName;

          var text = document.createElement("span");
          text.className = "search-result-text";
          var display = name;
          if (plate) display += "  " + plate;
          if (area) display += "  " + area;
          text.textContent = display;
          item.appendChild(tag);
          item.appendChild(text);

          var tip = [];
          tip.push("名称: " + name);
          if (plate) tip.push("板块: " + plate);
          if (area) tip.push("面积: " + area);
          if (props.name_wcmci && props.name_wcmci.trim())
            tip.push("WCMC名称: " + props.name_wcmci.trim());
          if (props.name_local && props.name_local.trim())
            tip.push("本地名称: " + props.name_local.trim());
          item.title = tip.join("\n");

          (function (feat_, name_) {
            item.addEventListener("click", function () {
              // 尝试 fitBounds 到多边形范围，fallback 到质心
              var bounds = unepPolygonBounds(feat_);
              if (bounds) {
                map.fitBounds(bounds, {
                  padding: [30, 30],
                  animate: true,
                });
              } else {
                var center = unepPolygonCenter(feat_);
                if (center) {
                  map.setView(center, Math.max(map.getZoom(), 8), {
                    animate: true,
                  });
                }
              }
              addUnepFeatureToLayer(feat_, name_);
              if (typeof window.showToast === "function") {
                window.showToast(
                  "🏝️ 已添加「" + name_ + "」到海岛记录图层",
                  { duration: 2000 },
                );
              }
              resultsBox.classList.remove("open");
            });
          })(feat, name);

          resultsBox.appendChild(item);
        });

        resultsBox.classList.add("open");
      }

      // ========== GPS 定位 ==========
      var _geoPoints = [];
      var _geoLayerId = null;
      var _geoSessionId = Date.now().toString(36);
      var _geoPersistentId = "geo_" + _geoSessionId;
      var _GEO_LAYER_NAME = "📍 位置记录 " + new Date().toLocaleString("zh-CN");

      function addGeoPointToLayer(lat, lng, note, category) {
        _geoPoints.push({ lat: lat, lng: lng, note: note, category: category });

        var features = _geoPoints.map(function (p, i) {
          return {
            type: "Feature",
            properties: {
              Name: "位置 " + (i + 1),
              备注: p.note || "",
              分类: p.category || "",
              纬度: String(p.lat),
              经度: String(p.lng),
            },
            geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          };
        });
        var fc = { type: "FeatureCollection", features: features };

        if (_geoLayerId) {
          try {
            map.removeLayer(layerCache[_geoLayerId]);
          } catch (e) {}
          delete layerCache[_geoLayerId];
          delete userLayerGeoJson[_geoLayerId];
          var oldCb = document.getElementById(_geoLayerId);
          if (oldCb) {
            var oldBar = oldCb.closest(".layer-item");
            if (oldBar) oldBar.remove();
          }
        }

        addUserLayer(fc, _GEO_LAYER_NAME, true, _geoPersistentId);

        // 手动持久化到 IDB
        if (isRememberLayerEnabled()) {
          L.GzIdbLoader.setCache("user_geo_" + _geoPersistentId, fc);
          saveUserLayerMeta(_geoPersistentId, _GEO_LAYER_NAME);
        }

        var allLayers = document.querySelectorAll(
          '#userLayerGroup .layer-item input[type="checkbox"]',
        );
        if (allLayers.length > 0) {
          _geoLayerId = allLayers[allLayers.length - 1].id;
        }

        var cb = _geoLayerId ? document.getElementById(_geoLayerId) : null;
        if (cb) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change", { bubbles: true }));
          // updateLayerCount（异步）最终会创建 .ft-count，但第一次调用后
          // 立即更新让用户即时看到计数变化
          var label = cb.closest(".layer-item")?.querySelector("label");
          if (label) {
            // 如果已有 .ft-count（前一次异步更新留下的），直接改它
            // 否则新建一个（.ft-count 是全局统一计数字段名）
            var cnt = label.querySelector(".ft-count");
            if (!cnt) {
              cnt = document.createElement("span");
              cnt.className = "ft-count";
              cnt.style.cssText =
                "font-size:10px;color:var(--text-dim);margin-left:6px;";
              label.appendChild(cnt);
            }
            cnt.textContent = "(" + _geoPoints.length + " 点)";
          }
        }

        map.setView([lat, lng], Math.max(map.getZoom(), 14), { animate: true });
      }

      window.startGeoLocate = function () {
        if (!navigator.geolocation) {
          if (typeof window.showToast === "function")
            window.showToast("⚠️ 当前浏览器不支持定位功能", { duration: 3000 });
          return;
        }
        // 参考导出图片 Toast 模式
        var _locToast = window.showToast("📍 正在获取位置…", { duration: 0 });

        navigator.geolocation.getCurrentPosition(
          function (pos) {
            if (_locToast) {
              var msgEl = _locToast.querySelector(".toast-msg");
              if (msgEl) msgEl.textContent = "📍 已获取位置";
              setTimeout(function () {
                if (_locToast && typeof window.closeToast === "function")
                  window.closeToast(_locToast);
              }, 600);
            }

            var lat = pos.coords.latitude;
            var lng = pos.coords.longitude;

            var dlg = document.createElement("dialog");
            dlg.className = "app-dialog premium-dialog";
            dlg.innerHTML =
              '<div class="dialog-header"><h3>📍 记录位置</h3></div>' +
              '<div class="dialog-body">' +
              "<p>纬度: " +
              lat.toFixed(5) +
              "　经度: " +
              lng.toFixed(5) +
              "</p>" +
              '<input id="geoNote" class="premium-input" type="text" placeholder="备注（可选）" style="margin-bottom:8px;" />' +
              '<input id="geoCat" class="premium-input" type="text" placeholder="分类（可选，如：采样点、观测站…）" />' +
              '<div class="premium-btns">' +
              '<button id="geoCancel" class="premium-btn premium-btn-cancel">取消</button>' +
              '<button id="geoSave" class="premium-btn premium-btn-submit">保存位置</button>' +
              "</div>" +
              "</div>";
            document.body.appendChild(dlg);
            dlg.showModal();

            dlg
              .querySelector("#geoSave")
              .addEventListener("click", function () {
                var note = dlg.querySelector("#geoNote").value.trim();
                var cat = dlg.querySelector("#geoCat").value.trim();
                dlg.close();
                document.body.removeChild(dlg);
                addGeoPointToLayer(lat, lng, note, cat);
              });
            dlg
              .querySelector("#geoCancel")
              .addEventListener("click", function () {
                dlg.close();
                document.body.removeChild(dlg);
              });
            dlg.addEventListener("close", function () {
              if (document.body.contains(dlg)) document.body.removeChild(dlg);
            });
          },
          function (err) {
            if (_locToast && typeof window.closeToast === "function")
              window.closeToast(_locToast);
            var msg = "定位失败";
            if (err.code === 1)
              msg = "⚠️ 定位权限被拒绝，请在浏览器设置中允许位置访问";
            else if (err.code === 2) msg = "⚠️ 无法获取位置，请检查 GPS 或网络";
            else if (err.code === 3) msg = "⚠️ 定位超时，请重试";
            if (typeof window.showToast === "function")
              window.showToast(msg, { duration: 4000 });
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
        );
      };

      // ========== 通用要素计数更新（已前移至文件头部）==========

      function renderResults(results, query, totalCount, shownCount) {
        // 缓存最近一次完整结果列表，供「查看更多」分页复用
        _lastSearchItems = results;
        _lastSearchQuery = query;
        _lastSearchTotal = totalCount;
        if (shownCount == null) shownCount = SEARCH_PAGE;
        _searchShown = shownCount;

        resultsBox.innerHTML = "";
        if (results.length === 0) {
          resultsBox.innerHTML =
            '<div class="search-empty"><div>无匹配结果</div>' +
            '<div class="tdt-search-btn" onclick="window.__tiandituSearch(\'' +
            query.replace(/\\/g, "\\\\").replace(/'/g, "\\'") +
            "')\">🔍 搜索地名「" +
            query.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
            "」</div>" +
            '<div class="tdt-search-btn" onclick="window.__unepwcmcSearch(\'' +
            query.replace(/\\/g, "\\\\").replace(/'/g, "\\'") +
            "')\" style=\"margin-left:6px;\">🏝️ 搜索海岛名「" +
            query.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
            "」</div></div>";
          resultsBox.classList.add("open");
          return;
        }
        var shown = results.slice(0, shownCount);
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
        // 「查看更多」分页：基于实际可用列表长度分页（results 已按 FEATURE_SEARCH_CAP 截断）
        var remaining = results.length - shownCount;
        if (remaining > 0) {
          var more = document.createElement("div");
          more.className = "search-loadmore";
          more.textContent = "查看更多（还剩 " + remaining + " 条）";
          more.addEventListener("click", function (e) {
            e.stopPropagation();
            renderResults(
              _lastSearchItems,
              _lastSearchQuery,
              _lastSearchTotal,
              _searchShown + SEARCH_PAGE_STEP,
            );
          });
          resultsBox.appendChild(more);
        } else if (totalCount > results.length) {
          // 已展示全部已加载结果，但底层命中更多（受单图层上限 FEATURE_SEARCH_CAP 限制）
          var note = document.createElement("div");
          note.className = "search-empty";
          note.textContent =
            "已显示全部 " + results.length + " 条；更多命中请缩小关键词范围";
          resultsBox.appendChild(note);
        }
        resultsBox.classList.add("open");
      }

      // ----------------------------------------------
      // 高亮并定位到指定的要素（独立函数，供搜索结果点击使用）
      // 「优化搜索」：点击搜索结果后隔离显示单个目标要素
      //   - 关闭【所有】图层（含被搜索的目标图层），走侧边栏标准开关路径
      //   - 新建一个只含被搜索要素的临时图层来显示该目标
      //   - 用户移动/缩放地图后：销毁临时图层，并把隔离前已勾选的图层全部恢复
      //     （被搜索图层若隔离前未勾选，则不在恢复集合内，保持关闭）
      //   - 完全走标准 load/remove，无半透明对象，避免“关不掉”问题
      // ----------------------------------------------
      var _isoActive = false;
      var _isoRestoreSet = []; // 隔离前处于“已勾选”状态的图层 cbId 列表（恢复目标）
      var _isoTempLayer = null; // 临时单要素图层
      var _isoMoveBound = false;

      // 程序化设置图层开关：直接复用各图层既有的 change 处理逻辑
      // （内置图层走 loadGeoJSONLayer/removeGeoJSONLayer，用户图层走 map.add/removeLayer）
      function _setLayerChecked(cbId, on) {
        var cb = document.getElementById(cbId);
        if (!cb) return false;
        if (cb.checked === on) return true; // 已是目标状态则跳过，避免重复 load/remove
        cb.checked = on;
        cb.dispatchEvent(new Event("change"));
        return true;
      }

      // 取得所有图层复选框（内置层 #dataLayerContent + 用户层 #userLayerGroup 的 .layer-item）
      function _allLayerCheckboxes() {
        return Array.prototype.slice.call(
          document.querySelectorAll(
            '#dataLayerContent .layer-item input[type="checkbox"], ' +
              '#userLayerGroup .layer-item input[type="checkbox"]',
          ),
        );
      }

      function _destroyTempLayer() {
        if (_isoTempLayer) {
          try {
            map.removeLayer(_isoTempLayer);
          } catch (e) {}
          _isoTempLayer = null;
        }
      }

      function _onUserMapInteract() {
        _restoreFromSearch();
      }

      function _restoreFromSearch() {
        if (!_isoActive) return;
        _destroyTempLayer();
        _isoRestoreSet.forEach(function (id) {
          _setLayerChecked(id, true);
        });
        _isoActive = false;
        _isoRestoreSet = [];
        _isoMoveBound = false;
        map.off("movestart", _onUserMapInteract);
      }

      function _isolateToLayer(cbId, feat) {
        // 已处于隔离态时先恢复，保证从干净状态重新记录（支持连续搜索结果点击）
        if (_isoActive) _restoreFromSearch();

        // 记录隔离前所有已勾选的图层（恢复目标集合）
        var onSet = [];
        _allLayerCheckboxes().forEach(function (cb) {
          if (cb.checked) onSet.push(cb.id);
        });

        // 关闭【所有】图层（含被搜索的目标图层）——走标准开关路径，侧边栏状态真实
        _allLayerCheckboxes().forEach(function (cb) {
          _setLayerChecked(cb.id, false);
        });

        // 新建只含被搜索要素的临时图层来显示目标
        if (feat && feat.geometry) {
          var color = layerColorMap[cbId] || "#e64a19";
          _isoTempLayer = L.geoJSON(
            {
              type: "Feature",
              geometry: feat.geometry,
              properties: feat.properties || {},
            },
            {
              style: {
                color: color,
                weight: 3,
                fillColor: color,
                fillOpacity: 0.35,
              },
              pointToLayer: function (f, ll) {
                return L.circleMarker(ll, {
                  radius: 7,
                  color: "#fff",
                  weight: 2,
                  fillColor: color,
                  fillOpacity: 1,
                });
              },
            },
          ).addTo(map);
        }

        _isoRestoreSet = onSet;
        _isoActive = true;

        // 等本次定位动画结束后再绑定“用户移动/缩放即恢复”，避免定位自身误触发
        map.once("moveend", function () {
          map.once("movestart", _onUserMapInteract);
          _isoMoveBound = true;
        });
        // 兜底：若目标已在视野中心、setView 未产生移动导致 moveend 不触发，仍绑定恢复
        setTimeout(function () {
          if (_isoActive && !_isoMoveBound) {
            map.once("movestart", _onUserMapInteract);
            _isoMoveBound = true;
          }
        }, 700);
      }

      // 暴露给 app.js（开关关闭时立即恢复）
      window.__OGV_restoreIsolation = _restoreFromSearch;

      function _isOptSearchOn() {
        if (window.OGV_OPT_SEARCH && typeof window.OGV_OPT_SEARCH.enabled === "boolean") {
          return window.OGV_OPT_SEARCH.enabled;
        }
        // 兜底：直接读开关 DOM 状态（兼容初始化顺序）
        var cb = document.getElementById("optimizeSearchToggle");
        return !!(cb && cb.checked);
      }

      function highlightAndLocateFeature(cbId, feat) {
        // 优化搜索：点击结果后关闭全部图层，并新建临时单要素图层显示目标
        if (_isOptSearchOn()) {
          _isolateToLayer(cbId, feat);
        }
        // 1) 始终基于要素真实几何坐标定位（对任意图层类型 / 加载状态 / 是否渲染都可靠）。
        //    原先的非 Canvas 分支只靠 layer.feature._featureIndex === feat._featureIndex
        //    跨对象匹配，而搜索结果的 feat 来自未渲染的原始 featureCache（_featureIndex 未赋值），
        //    导致带 searchPriority 的图层及「点击后加载」的要素匹配失败、无法跳转。
        var coords = [];
        try {
          if (feat && feat.geometry) coords = extractCoords(feat.geometry);
        } catch (e) {}
        var gtype = (
          (feat && feat.geometry && feat.geometry.type) ||
          ""
        ).toLowerCase();
        var isPoint = gtype === "point" || gtype === "multipoint";

        // 2) 可选增强：在已渲染矢量图层中按 _featureIndex 找到对应要素，
        //    触发其 dblclick（高亮 + 缩放 + 弹窗）。找不到则退回坐标定位。
        var foundLayer = null;
        var state = highlightState[cbId];
        if (state && state.geoLayers && feat && feat._featureIndex != null) {
          for (var gi = 0; gi < state.geoLayers.length && !foundLayer; gi++) {
            var gl = state.geoLayers[gi];
            if (typeof gl.eachLayer === "function") {
              gl.eachLayer(function (layer) {
                if (
                  !foundLayer &&
                  layer.feature &&
                  layer.feature._featureIndex === feat._featureIndex
                ) {
                  foundLayer = layer;
                }
              });
            }
          }
        }

        if (foundLayer) {
          var evt = {
            latlng: foundLayer.getBounds
              ? foundLayer.getBounds().getCenter()
              : foundLayer.getLatLng
                ? foundLayer.getLatLng()
                : map.getCenter(),
            layer: foundLayer,
            originalEvent: null,
          };
          foundLayer.fire("dblclick", evt, true);
        } else if (coords.length > 0) {
          if (isPoint || coords.length === 1) {
            map.setView(coords[0], Math.max(map.getZoom(), 8), {
              animate: true,
            });
          } else {
            var b = L.latLngBounds(coords);
            if (b.isValid())
              map.fitBounds(b, {
                padding: [50, 50],
                maxZoom: 14,
                animate: true,
              });
          }
        }
        resultsBox.classList.remove("open");
        input.blur();
      }

      // ========== 深链复用入口（供 app.js 的 window.OGV 调用）==========
      // 暴露搜索与要素定位原语，避免复制搜索逻辑；二者均为本 IIFE 内的函数声明，可安全暴露
      window.__OGV_search = runSearch; // (query) -> { items, total }
      window.__OGV_highlight = highlightAndLocateFeature; // (cbId, feat) -> 定位

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
            scheduleLegendRefresh();
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
      // 清除所有自定义图层设置
      for (var j = 0; j < localStorage.length; j++) {
        var k2 = localStorage.key(j);
        if (k2 && k2.indexOf(LAYER_SETTINGS_PREFIX) === 0) {
          localStorage.removeItem(k2);
        }
      }
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
      localStorage.removeItem(MAP_STATE_KEY);
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

    const MAP_STATE_KEY = "dupal_map_state";

    // ========== 初始化 ==========
    function initGeoJsonLayer() {
      generateLayerItems();
      initSearch();

      // 页面卸载时保存地图中心坐标和缩放级别
      window.addEventListener("pagehide", function () {
        try {
          var center = map.getCenter();
          var zoom = map.getZoom();
          localStorage.setItem(
            MAP_STATE_KEY,
            JSON.stringify({ lat: center.lat, lng: center.lng, zoom: zoom }),
          );
        } catch (e) {}
      });

      // 恢复地图中心/缩放
      function restoreMapCenter() {
        try {
          var saved = localStorage.getItem(MAP_STATE_KEY);
          if (saved) {
            var state = JSON.parse(saved);
            if (
              typeof state.lat === "number" &&
              typeof state.lng === "number" &&
              typeof state.zoom === "number" &&
              state.lat >= -85 &&
              state.lat <= 85
            ) {
              map.setView([state.lat, state.lng], state.zoom, {
                animate: false,
              });
            }
          }
        } catch (e) {}
      }

      // 清理 localStorage 中纬度越界的坏数据
      try {
        var raw = localStorage.getItem(MAP_STATE_KEY);
        if (raw) {
          var st = JSON.parse(raw);
          if (typeof st.lat === "number" && (st.lat > 85 || st.lat < -85)) {
            localStorage.removeItem(MAP_STATE_KEY);
          }
        }
      } catch (e) {}

      // 图层恢复：检测到已保存的图层状态时，弹窗询问用户是否恢复
      if (isRememberLayerEnabled() && hasSavedLayerState()) {
        showConfirm(
          "检测到上次访问时打开的图层。<br><br>" +
            "⚠️ 如果上次加载的图层数据较大导致页面运行缓慢或崩溃，请选择「不恢复」以避免自动重载。<br><br>" +
            "您也可以在「地图设置」中关闭「记住图层」选项。",
          {
            title: "恢复图层",
            confirmText: "恢复",
            cancelText: "不恢复",
          },
        ).then(function (restore) {
          if (restore) {
            restoreLayerCheckStates();
            restoreUserLayers();
            restoreMapCenter();
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

    // ========== 图例数据构建（供外部 LegendControl 调用）==========
    /**
     * 收集当前地图上所有可见图层的图例信息，返回 items 数组供 L.Control.Legend 使用。
     * 调用方式：window._buildLegendData() → legend.update(data)
     */
    window._buildLegendData = function () {
      var items = [];
      // 遍历所有已注册的图层 checkbox（内置图层 id^="layer_" + 用户图层 id^="user_layer_"）
      var allCbs = document.querySelectorAll(
        '.layer-section-content input[type="checkbox"][id^="layer_"], #userLayerGroup input[type="checkbox"][id^="user_layer_"]',
      );
      allCbs.forEach(function (cb) {
        var checkboxId = cb.id;
        // 仅收集勾选且已加载到地图的图层
        if (!cb.checked) return;
        if (!layerCache[checkboxId]) return;
        if (!map.hasLayer(layerCache[checkboxId])) return;

        var layerName = cb.dataset.layerName || checkboxId;
        var fixedColor = layerColorMap[checkboxId] || "#999";
        var mode = colorMode[checkboxId] || "single";
        var icon = layerIconMap[checkboxId] || null;

        // 快速检测几何类型：优先从 _geomTypeCache 按文件名查，否则采样第一要素
        var geomType = "polygon";
        var fileName = String(cb.value || "").split("/").pop();
        if (_geomTypeCache[fileName]) {
          geomType = _geomTypeCache[fileName];
          if (geomType === "point" || geomType === "multipoint") geomType = "point";
          else if (geomType === "linestring" || geomType === "multilinestring") geomType = "line";
          else if (geomType === "polygon" || geomType === "multipolygon") geomType = "polygon";
        } else {
          var fc = featureCache[checkboxId];
          if (fc && fc.length > 0) {
            var f0 = fc[0];
            if (f0 && f0.geometry && f0.geometry.type) {
              var t = f0.geometry.type.toLowerCase();
              if (t === "point" || t === "multipoint") geomType = "point";
              else if (t === "linestring" || t === "multilinestring") geomType = "line";
            }
          }
        }

        var item = { name: layerName, color: fixedColor, geomType: geomType, mode: mode };

        if (icon) {
          item.icon = icon;
        }

        // 字段分色模式：提取唯一值并获取颜色
        if (mode === "field" && fieldKey[checkboxId]) {
          var fk = fieldKey[checkboxId];
          var features = featureCache[checkboxId];
          if (features && features.length > 0) {
            // 提取唯一字段值
            var seen = Object.create(null);
            var uniqueValues = [];
            for (var fi = 0; fi < features.length; fi++) {
              var f = features[fi];
              if (!f || !f.properties) continue;
              var v = f.properties[fk];
              if (v == null || v === "") continue;
              var vs = String(v);
              if (!seen[vs]) {
                seen[vs] = true;
                uniqueValues.push(vs);
              }
              if (uniqueValues.length >= 30) break;
            }
            uniqueValues.sort();
            var palette = window.GeoUtils.getFieldColorPalette(fk);
            var fields = [];
            for (var ui = 0; ui < uniqueValues.length; ui++) {
              var uval = uniqueValues[ui];
              var ucolor = palette[uval] || fixedColor;
              fields.push({ value: uval, color: ucolor });
              if (fields.length >= 12) break;
            }
            if (fields.length > 0) {
              item.fields = fields;
            }
          }
        }

        items.push(item);
      });

      // 排序：字段分色优先 → 图标优先 → 其余
      items.sort(function (a, b) {
        var sa = (a.fields ? 2 : 0) + (a.icon ? 1 : 0);
        var sb = (b.fields ? 2 : 0) + (b.icon ? 1 : 0);
        return sb - sa;
      });

      return items;
    };

    /**
     * 刷新图例控件（如果已添加到地图）
     */
    window._refreshLegend = function () {
      if (
        window._legendControl &&
        typeof window._legendControl.update === "function"
      ) {
        var items = window._buildLegendData();
        window._legendControl.update(items);
      }
    };

    /**
     * 延迟刷新图例（用于异步加载场景，等图层渲染完成后再刷新）
     */
    function scheduleLegendRefresh(delay) {
      clearTimeout(window._legendRefreshTimer);
      window._legendRefreshTimer = setTimeout(function () {
        window._refreshLegend();
      }, delay || 150);
    }

    initGeoJsonLayer();
  }); // 闭合 waitForMap 回调
})();
