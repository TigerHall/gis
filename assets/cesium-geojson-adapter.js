/**
 * cesium-geojson-adapter.js
 * featureCache GeoJSON → Cesium Entities 适配器
 *
 * 核心职责：
 * 1. 接收标准 GeoJSON 对象（来自 featureCache 或 GzIdbLoader）
 * 2. 使用 Cesium.GeoJsonDataSource.load() 创建数据源
 * 3. 后处理 entities：字段分色、拉伸高度、贴地
 *
 * 样式映射策略（与 2D getGeoJsonStyle 对齐）：
 * - colorMode "single"  → layerColorMap[checkboxId] 统一色
 * - colorMode "sequential" → GeoUtils.getFeatureColorByIndex 索引色
 * - colorMode "field" → GeoUtils.getFeatureColorByField 字段分色
 *
 * 暴露：window.CesiumGeoJsonAdapter
 */

(function () {
  "use strict";

  // 默认调色板（与 GeoUtils.getFeatureColorByIndex 保持一致）
  var DEFAULT_PALETTE = [
    "#E6194B",
    "#3CB44B",
    "#FFE119",
    "#4363D8",
    "#F58231",
    "#911EB4",
    "#46F0F0",
    "#F032E6",
    "#BCF60C",
    "#FABEBE",
    "#008080",
    "#E6BEFF",
    "#9A6324",
    "#FFFAC8",
    "#800000",
    "#AAFFC3",
    "#808000",
    "#FFD8B1",
    "#000075",
    "#808080",
  ];

  /**
   * 任意 CSS 颜色字符串 → Cesium.Color（兼容 hex / rgb / hsl / 命名色）
   * 用 Color.fromCssColorString 统一解析，保证与 2D 的 HSL/RGB 颜色一致
   */
  function parseColor(colorStr, alpha) {
    if (!colorStr || typeof colorStr !== "string") colorStr = "#99cc99";
    try {
      return window.Cesium.Color.fromCssColorString(colorStr).withAlpha(
        alpha !== undefined ? alpha : 1,
      );
    } catch (e) {
      try {
        return window.Cesium.Color.fromCssColorString("#99cc99").withAlpha(
          alpha !== undefined ? alpha : 1,
        );
      } catch (e2) {
        return new window.Cesium.Color(
          0.6,
          0.8,
          0.6,
          alpha !== undefined ? alpha : 1,
        );
      }
    }
  }

  // 兼容旧调用名
  function hexToColor(hex, alpha) {
    return parseColor(hex, alpha);
  }

  /**
   * 获取要素填充色（与 2D getFeatureFillColor 完全对齐）
   * 复用 window.GeoUtils.getFeatureColorByIndex / getFeatureColorByField，
   * 确保 2D / 3D 颜色渲染结果一致。
   * @param {Object} feature - GeoJSON Feature
   * @param {Object} layerConfig - 图层配置 { colorMode, colorField, color, fieldKey }
   * @param {number} featureIndex - 要素索引
   * @returns {string} CSS 颜色字符串
   */
  function getFeatureColor(feature, layerConfig, featureIndex) {
    var mode = layerConfig.colorMode || "sequential";
    var G = window.GeoUtils;

    if (mode === "single") {
      return layerConfig.color || "#8B4513";
    }

    if (mode === "field" && layerConfig.fieldKey) {
      var fk = layerConfig.fieldKey;
      var val = feature.properties ? feature.properties[fk] : null;
      if (val != null && G && G.getFeatureColorByField) {
        return G.getFeatureColorByField(
          feature.properties,
          fk,
          featureIndex || 0,
        );
      }
    }

    // sequential: 索引色（与 2D 一致）
    if (G && G.getFeatureColorByIndex) {
      return G.getFeatureColorByIndex(featureIndex || 0);
    }
    return DEFAULT_PALETTE[(featureIndex || 0) % DEFAULT_PALETTE.length];
  }

  /**
   * 从 geojsonloader 内部状态构建图层配置
   * @param {string} checkboxId
   * @returns {Object} layerConfig
   */
  function buildLayerConfig(checkboxId) {
    var config = {
      colorMode: "sequential",
      color: null,
      fieldKey: null,
      opacity: 0.8,
      cesium: null,
    };

    // 从 geojsonloader 暴露的内部状态读取（通过 window 桥接）
    if (window._ogv_layerColorMap && window._ogv_layerColorMap[checkboxId]) {
      config.color = window._ogv_layerColorMap[checkboxId];
    }
    if (window._ogv_colorMode && window._ogv_colorMode[checkboxId]) {
      config.colorMode = window._ogv_colorMode[checkboxId];
    }
    if (window._ogv_fieldKey && window._ogv_fieldKey[checkboxId]) {
      config.fieldKey = window._ogv_fieldKey[checkboxId];
    }
    if (
      window._ogv_layerOpacityMap &&
      window._ogv_layerOpacityMap[checkboxId] !== undefined
    ) {
      config.opacity = window._ogv_layerOpacityMap[checkboxId];
    }

    // 从 geo-config 读取 cesium 专属配置
    if (window._ogv_cesiumConfig && window._ogv_cesiumConfig[checkboxId]) {
      config.cesium = window._ogv_cesiumConfig[checkboxId];
    }

    return config;
  }

  /**
   * 加载 GeoJSON 到 Cesium
   * @param {string} checkboxId - 图层 ID
   * @param {Object} geoJson - 标准 GeoJSON FeatureCollection
   * @returns {Promise<Cesium.GeoJsonDataSource>}
   */
  function loadGeoJson(checkboxId, geoJson) {
    if (!window.Cesium || !geoJson) {
      return Promise.reject(new Error("Cesium 未加载或 GeoJSON 为空"));
    }

    var layerConfig = buildLayerConfig(checkboxId);
    var cesiumOpts = layerConfig.cesium || {};
    var clampToGround = cesiumOpts.clampToGround !== false; // 默认贴地
    var extrudeHeight = cesiumOpts.extrudeHeight || 0;
    var pointPixelSize = cesiumOpts.pointPixelSize || 10;
    var opacity = layerConfig.opacity !== undefined ? layerConfig.opacity : 0.8;

    // 使用 GeoJsonDataSource.load 创建数据源
    return window.Cesium.GeoJsonDataSource.load(geoJson, {
      markerSize: pointPixelSize, // 数值类型，不需要 Cartesian2
      markerColor: hexToColor(layerConfig.color || "#99cc99", opacity),
      stroke: hexToColor(layerConfig.color || "#E63946", opacity),
      fill: hexToColor(layerConfig.color || "#E63946", opacity * 0.4),
      strokeWidth: 2,
      clampToGround: clampToGround,
    }).then(function (dataSource) {
      // 后处理：逐要素应用正确颜色
      var entities = dataSource.entities.values;
      // 提前获取图层元信息（用于要素引用 + 弹窗）
      var cbEl = document.getElementById(checkboxId);
      var layerName =
        cbEl && cbEl.dataset && cbEl.dataset.layerName
          ? cbEl.dataset.layerName
          : checkboxId;
      var fileName = cbEl && cbEl.value ? cbEl.value.split("/").pop() : "";

      for (var i = 0; i < entities.length; i++) {
        var entity = entities[i];
        var feature = entity.properties
          ? entity.properties.getValue(window.Cesium.JulianDate.now())
          : {};
        // GeoJsonDataSource 将 properties 挂到 entity.properties 上
        // 构造伪 feature 用于颜色计算
        var pseudoFeature = { properties: {} };
        if (entity.properties) {
          var propNames = entity.properties.propertyNames;
          if (propNames && propNames.length) {
            for (var p = 0; p < propNames.length; p++) {
              pseudoFeature.properties[propNames[p]] = entity.properties[
                propNames[p]
              ].getValue(window.Cesium.JulianDate.now());
            }
          }
        }

        // 要素真实索引（geojsonloader 已写入 properties._featureIndex）
        var featureIndex =
          pseudoFeature.properties._featureIndex != null
            ? pseudoFeature.properties._featureIndex
            : i;

        // 存储要素引用，供 3D 点击拾取弹窗使用
        entity._ogv = {
          layerId: checkboxId,
          featureIndex: featureIndex,
          fileName: fileName,
          layerName: layerName,
        };

        var featureColor = getFeatureColor(
          pseudoFeature,
          layerConfig,
          featureIndex,
        );
        var cesiumColor = hexToColor(featureColor, opacity);
        var cesiumFillColor = hexToColor(featureColor, opacity * 0.4);

        // 点要素
        if (entity.point) {
          entity.point.pixelSize = pointPixelSize;
          entity.point.color = cesiumColor;
          entity.point.outlineColor = window.Cesium.Color.WHITE.withAlpha(
            opacity * 0.6,
          );
          entity.point.outlineWidth = 1;
          if (clampToGround) {
            entity.point.heightReference =
              window.Cesium.HeightReference.CLAMP_TO_GROUND;
          }
        }

        // 线要素
        if (entity.polyline) {
          entity.polyline.material = cesiumColor;
          entity.polyline.width = 2.5;
          if (clampToGround) {
            entity.polyline.clampToGround = true;
          }
        }

        // 面要素
        if (entity.polygon) {
          entity.polygon.material = cesiumFillColor;

          // 贴地面要素不支持 outline（Cesium 限制），仅在非贴地时启用
          if (clampToGround) {
            entity.polygon.outline = false;
            entity.polygon.perPositionHeight = false;
          } else {
            entity.polygon.outline = true;
            entity.polygon.outlineColor = cesiumColor;
            entity.polygon.outlineWidth = 1;
          }

          // 拉伸高度
          if (extrudeHeight > 0) {
            entity.polygon.extrudedHeight = extrudeHeight;
          }
        }
      }

      // 设置数据源名称
      dataSource.name = layerName;

      return dataSource;
    });
  }

  /**
   * 更新图层透明度（不重建数据源）
   * @param {Cesium.GeoJsonDataSource} dataSource
   * @param {number} opacity 0-1
   */
  function updateOpacity(dataSource, opacity) {
    if (!dataSource) return;
    var entities = dataSource.entities.values;
    for (var i = 0; i < entities.length; i++) {
      var entity = entities[i];
      if (entity.point && entity.point.color) {
        entity.point.color = entity.point.color
          .getValue(window.Cesium.JulianDate.now())
          .withAlpha(opacity);
      }
      if (entity.polyline && entity.polyline.material) {
        var m = entity.polyline.material;
        if (m.color) {
          entity.polyline.material = m.color
            .getValue(window.Cesium.JulianDate.now())
            .withAlpha(opacity);
        }
      }
      if (entity.polygon && entity.polygon.material) {
        var pm = entity.polygon.material;
        if (pm.color) {
          entity.polygon.material = pm.color
            .getValue(window.Cesium.JulianDate.now())
            .withAlpha(opacity * 0.4);
        }
      }
    }
  }

  var CesiumGeoJsonAdapter = {
    loadGeoJson: loadGeoJson,
    updateOpacity: updateOpacity,
    buildLayerConfig: buildLayerConfig,
  };

  window.CesiumGeoJsonAdapter = CesiumGeoJsonAdapter;
})();
