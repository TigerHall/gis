/**
 * cesium-geojson-adapter.js
 * featureCache GeoJSON → Cesium Entities 适配器
 *
 * 核心职责：
 * 1. 接收标准 GeoJSON 对象（来自 featureCache 或 GzIdbLoader）
 * 2. 使用 Cesium.GeoJsonDataSource.load() 创建数据源
 * 3. 后处理 entities：字段分色、透明度、点图标、标签、聚类
 *
 * 样式映射策略（与 2D geojsonloader getGeoJsonStyle 严格对齐）：
 * - colorMode "single"     → layerColorMap[checkboxId] 统一色
 * - colorMode "sequential" → GeoUtils.getFeatureColorByIndex 索引色
 * - colorMode "field"      → GeoUtils.getFeatureColorByField 字段分色
 * - 点要素图标            → L.GeoMarker.getIconFactory 同源 SVG（volcano/hotspot/star/point/外部文件）
 * - 点要素尺寸            → layerIconSizeMap[checkboxId] || 20
 * - 面填充透明度          → Math.min(opacity, 0.45)（与 2D fillOpacity 一致）
 * - 线透明度              → opacity
 * - 线 / 面贴地            → clampToGround（默认 true，GPU 侧，开销可忽略）
 * - 点要素贴地            → groundMode（默认 "none"，见 POINT_GROUND_LIVE_MAX 注释）
 *
 * 重要：Cesium 的 GeoJsonDataSource 对 Point 几何创建的是 **billboard（图钉）**，
 * 不是 entity.point，因此必须改写 entity.billboard 才能让图标/颜色生效。
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

  // 标签渲染上限：要素过多时跳过标签（避免 Cesium LabelCollection 爆内存）
  var LABEL_MAX_FEATURES = 3000;
  // 聚类启用下限：点要素少于该值时不开聚类
  var CLUSTER_MIN_FEATURES = 200;

  // ========== 点要素贴地策略 ==========
  // ⚠️ 性能红线：HeightReference.CLAMP_TO_GROUND 会让 Cesium **每帧对每个点**
  // 做一次地形高度采样（CPU 侧 O(n)/帧），实测（1.125 + SwiftShader）：
  //     n=1116  billboard 贴地 5620ms/帧  vs  不贴地 602ms/帧（基线 455ms）
  //     n=200   billboard 贴地  903ms/帧  vs  不贴地 717ms/帧
  // 而本站地形是平坦椭球（实测 clampToHeightMostDetailed 前后高度差 = 0m），
  // 贴地没有任何视觉收益，纯亏。故默认不贴地，需要真实地形贴合时由
  // geo-config 显式声明 cesium: { groundMode: "live" }。
  // 即便声明了，要素数超过下限也会自动降级，避免把帧率拖垮。
  var POINT_GROUND_LIVE_MAX = 300;

  // 图标 data-uri 缓存：key = iconType|size|color
  var _iconUriCache = {};
  // 聚类气泡图缓存：key = size|color
  var _clusterImgCache = {};

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
      groundMode: "none", // 点要素贴地策略：none（默认，零开销）| live（每帧采样，仅限小图层）
      iconType: null,
      iconSize: 20,
      labelEnabled: false,
      clusterEnabled: true,
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

    // 点要素图标（与 2D 同源）：未配置时回退内置 "point" 圆点图标
    var iconType =
      window._ogv_layerIconMap && window._ogv_layerIconMap[checkboxId]
        ? window._ogv_layerIconMap[checkboxId]
        : "point";
    config.iconType = iconType;
    var iconSize = 20;
    if (
      window._ogv_layerIconSizeMap &&
      window._ogv_layerIconSizeMap[checkboxId]
    ) {
      iconSize = Number(window._ogv_layerIconSizeMap[checkboxId]) || 20;
    }
    config.iconSize = iconSize;

    // 标签 / 聚类开关（与 2D 全局开关同步）
    if (typeof window._ogv_getLabelEnabled === "function") {
      config.labelEnabled = !!window._ogv_getLabelEnabled();
    }
    if (typeof window._ogv_getClusterEnabled === "function") {
      config.clusterEnabled = !!window._ogv_getClusterEnabled();
    }
    if (window._ogv_labelFieldMap && window._ogv_labelFieldMap[checkboxId]) {
      config.labelField = window._ogv_labelFieldMap[checkboxId];
    } else if (typeof window._ogv_getDefaultLabelField === "function") {
      try {
        config.labelField = window._ogv_getDefaultLabelField();
      } catch (e) {
        config.labelField = "Name";
      }
    } else {
      config.labelField = "Name";
    }

    // 从 geo-config 读取 cesium 专属配置
    if (window._ogv_cesiumConfig && window._ogv_cesiumConfig[checkboxId]) {
      config.cesium = window._ogv_cesiumConfig[checkboxId];
      // geo-config 的 pointPixelSize 优先于图层图标尺寸
      if (config.cesium.pointPixelSize) {
        config.iconSize = Number(config.cesium.pointPixelSize) || iconSize;
      }
      if (config.cesium.groundMode) {
        config.groundMode = String(config.cesium.groundMode);
      }
    }

    return config;
  }

  // ========== 图标构造（与 2D L.GeoMarker 同源）==========
  /**
   * 通过 L.GeoMarker 图标工厂生成图标 URI
   * 内置图标 → SVG data-uri（颜色已烘焙）；外部文件 → 直接返回 URL
   * @returns {string|null}
   */
  function buildIconUri(iconType, iconSize, color) {
    if (!iconType) return null;
    var L = window.L;
    if (!L || !L.GeoMarker || !L.GeoMarker.getIconFactory) return null;

    var key = iconType + "|" + iconSize + "|" + color;
    if (Object.prototype.hasOwnProperty.call(_iconUriCache, key)) {
      return _iconUriCache[key];
    }

    var uri = null;
    try {
      var fn = L.GeoMarker.getIconFactory(iconType, iconSize);
      if (fn) {
        var di = fn(color);
        var html = di && di.options ? di.options.html : "";
        if (html) {
          // 外部文件图标：<img src="...">
          var m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
          if (m) {
            uri = m[1];
          } else if (html.indexOf("<svg") !== -1) {
            uri =
              "data:image/svg+xml;base64," +
              btoa(unescape(encodeURIComponent(html)));
          }
        }
      }
    } catch (e) {
      uri = null;
    }
    _iconUriCache[key] = uri;
    return uri;
  }

  /**
   * 是否为外部文件图标（不参与按颜色生成）
   */
  function isExternalIcon(iconType) {
    var L = window.L;
    return !!(L && L.GeoMarker && L.GeoMarker.isExternalPath && L.GeoMarker.isExternalPath(iconType));
  }

  // ========== 聚类气泡 ==========
  /**
   * 生成聚类气泡底图（圆形，带白边，数量文字由 Cesium label 渲染）
   * @param {number} count
   * @param {string} color
   * @returns {{ url: string, size: number }}
   */
  function makeClusterImage(count, color) {
    var size = count < 10 ? 40 : count < 100 ? 48 : 56;
    var key = size + "|" + color;
    if (_clusterImgCache[key]) return _clusterImgCache[key];

    var cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    var ctx = cv.getContext("2d");
    var c = size / 2;
    var r = c - 2;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    var item = { url: cv.toDataURL(), size: size };
    _clusterImgCache[key] = item;
    return item;
  }

  // ========== 标签 ==========
  function getLabelText(props, field) {
    if (!props) return "";
    function ok(v) {
      return v !== null && v !== undefined && v !== "";
    }
    if (field && ok(props[field])) return String(props[field]);
    var names = ["Name", "name", "NAME"];
    for (var i = 0; i < names.length; i++) {
      if (ok(props[names[i]])) return String(props[names[i]]);
    }
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      if (k.charAt(0) === "_") continue;
      if (ok(props[k])) return String(props[k]);
    }
    return "";
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

    var Cs = window.Cesium;
    var layerConfig = buildLayerConfig(checkboxId);
    var cesiumOpts = layerConfig.cesium || {};
    // 线 / 面：保持贴地（GPU 侧 GroundPrimitive，实测开销可忽略；
    // 不贴地的话长线会沿 3D 弦穿过地球内部）
    var clampToGround = cesiumOpts.clampToGround !== false; // 默认贴地
    var extrudeHeight = cesiumOpts.extrudeHeight || 0;
    var iconSize = layerConfig.iconSize || 20;
    var opacity = layerConfig.opacity !== undefined ? layerConfig.opacity : 0.8;
    // 与 2D 一致：面填充 = min(opacity, 0.45)
    var fillAlpha = Math.min(opacity, 0.45);

    // 使用 GeoJsonDataSource.load 创建数据源
    return Cs.GeoJsonDataSource.load(geoJson, {
      markerSize: iconSize, // 数值类型，不需要 Cartesian2
      markerColor: hexToColor(layerConfig.color || "#99cc99", opacity),
      stroke: hexToColor(layerConfig.color || "#E63946", opacity),
      fill: hexToColor(layerConfig.color || "#E63946", fillAlpha),
      strokeWidth: 2,
      clampToGround: clampToGround,
    }).then(function (dataSource) {
      var entities = dataSource.entities.values;
      var total = entities.length;

      // 提前获取图层元信息（用于要素引用 + 弹窗）
      var cbEl = document.getElementById(checkboxId);
      var layerName =
        cbEl && cbEl.dataset && cbEl.dataset.layerName
          ? cbEl.dataset.layerName
          : checkboxId;
      var fileName = cbEl && cbEl.value ? cbEl.value.split("/").pop() : "";

      var showLabels = layerConfig.labelEnabled && total <= LABEL_MAX_FEATURES;
      var labelField = layerConfig.labelField || "Name";

      // ---- 第一遍：解析 properties / 计算要素颜色，收集颜色集合 ----
      var meta = new Array(total);
      var colorSet = {};
      var pointCount = 0;
      // 统一取一次时间，避免在大图层上重复构造 JulianDate
      var now = Cs.JulianDate.now();

      for (var i = 0; i < total; i++) {
        var entity = entities[i];
        var pseudoFeature = { properties: {} };
        if (entity.properties) {
          try {
            var vals = entity.properties.getValue(now);
            if (vals) pseudoFeature.properties = vals;
          } catch (e) {
            var propNames = entity.properties.propertyNames;
            if (propNames && propNames.length) {
              for (var p = 0; p < propNames.length; p++) {
                try {
                  pseudoFeature.properties[propNames[p]] = entity.properties[
                    propNames[p]
                  ].getValue(now);
                } catch (e2) {}
              }
            }
          }
        }

        // 要素真实索引（geojsonloader 已写入 properties._featureIndex）
        var props = pseudoFeature.properties || {};
        var featureIndex =
          props._featureIndex != null ? props._featureIndex : i;

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
        colorSet[featureColor] = true;

        var isPoint = !!entity.billboard;
        if (isPoint) pointCount++;

        meta[i] = {
          props: props,
          index: featureIndex,
          color: featureColor,
          isPoint: isPoint,
          labelText: showLabels ? getLabelText(props, labelField) : "",
        };
      }

      // ---- 点要素贴地策略（性能红线，见 POINT_GROUND_LIVE_MAX 注释）----
      var pointGround = false;
      if (layerConfig.groundMode === "live") {
        if (pointCount <= POINT_GROUND_LIVE_MAX) {
          pointGround = true;
        } else {
          console.warn(
            "[CesiumAdapter] " +
              checkboxId +
              " 有 " +
              pointCount +
              " 个点，超过贴地上限 " +
              POINT_GROUND_LIVE_MAX +
              "，已自动降级为不贴地（CLAMP_TO_GROUND 会按帧逐点采样地形，严重掉帧）",
          );
        }
      }
      var pointHeightRef = pointGround
        ? Cs.HeightReference.CLAMP_TO_GROUND
        : Cs.HeightReference.NONE;

      // ---- 第二遍：应用样式 ----
      // 点图标：按颜色预生成 URI（外部文件图标只有一张，不按颜色区分）
      var iconType = layerConfig.iconType;
      var external = isExternalIcon(iconType);
      var iconUriByColor = {};
      if (pointCount > 0) {
        if (external) {
          iconUriByColor["*"] = buildIconUri(iconType, iconSize, "#ffffff");
        } else {
          for (var col in colorSet) {
            if (!Object.prototype.hasOwnProperty.call(colorSet, col)) continue;
            var uri = buildIconUri(iconType, iconSize, col);
            if (!uri) {
              // 图标类型无法识别 → 回退内置圆点图标（与 2D getIconFactory 返回 null 时一致）
              uri = buildIconUri("point", iconSize, col);
            }
            iconUriByColor[col] = uri;
          }
        }
      }

      var verticalOrigin =
        iconType === "volcano" || iconType === "volcano-file"
          ? Cs.VerticalOrigin.BOTTOM
          : Cs.VerticalOrigin.CENTER;

      for (var j = 0; j < total; j++) {
        var ent = entities[j];
        var m = meta[j];
        var cesiumColor = hexToColor(m.color, opacity);
        var cesiumFillColor = hexToColor(m.color, fillAlpha);

        // ---- 点要素（GeoJsonDataSource 生成的是 billboard）----
        if (ent.billboard) {
          var imgUri = external
            ? iconUriByColor["*"]
            : iconUriByColor[m.color];
          if (imgUri) {
            ent.billboard.image = imgUri;
            ent.billboard.width = iconSize;
            ent.billboard.height = iconSize;
          } else {
            // 无可用图标 → 回退 Cesium 原生点（单色圆点）
            ent.billboard.show = false;
            ent.point = {
              pixelSize: Math.max(6, iconSize * 0.5),
              color: cesiumColor,
              outlineColor: Cs.Color.WHITE.withAlpha(opacity * 0.6),
              outlineWidth: 1,
              heightReference: pointHeightRef,
            };
          }
          ent.billboard.verticalOrigin = verticalOrigin;
          ent.billboard.color = Cs.Color.WHITE.withAlpha(opacity);
          // 深度测试保持 Cesium 默认（开启）：球体背面的标记会被地球正确遮挡；
          // 贴地标记由 Cesium 的 DepthPlane 做多边形偏移，不会与地表 z-fighting。
          ent.billboard.heightReference = pointHeightRef;
        }

        // ---- 线要素 ----
        if (ent.polyline) {
          ent.polyline.material = cesiumColor;
          ent.polyline.width = 2.5;
          if (clampToGround) {
            ent.polyline.clampToGround = true;
          }
        }

        // ---- 面要素 ----
        if (ent.polygon) {
          ent.polygon.material = cesiumFillColor;

          // 贴地面要素不支持 outline（Cesium 限制），仅在非贴地时启用
          if (clampToGround) {
            ent.polygon.outline = false;
            ent.polygon.perPositionHeight = false;
          } else {
            ent.polygon.outline = true;
            // 与 2D 一致：面边界固定 #555
            ent.polygon.outlineColor = hexToColor("#555555", opacity);
            ent.polygon.outlineWidth = 1;
          }

          // 拉伸高度
          if (extrudeHeight > 0) {
            ent.polygon.extrudedHeight = extrudeHeight;
          }
        }

        // ---- 面要素外轮廓（贴地时由 GroundPolyline 画，避开 GroundPrimitive 无 outline 的限制）----
        // 单独建 polyline 实体，clampToGround=true 在地形上画描边。
        // 与 2D polyline 描边样式对齐（与面同色、不透明、width 1.5）。
        // 注意：3-copy 的面要素会生成 3 份重叠描边，视觉上是同一根线，渲染开销可忽略。
        if (ent.polygon && clampToGround) {
          var polyHierarchy =
            ent.polygon.hierarchy && ent.polygon.hierarchy.getValue
              ? ent.polygon.hierarchy.getValue(now)
              : ent.polygon.hierarchy;
          if (polyHierarchy && polyHierarchy.positions) {
            dataSource.entities.add({
              polyline: {
                positions: polyHierarchy.positions,
                clampToGround: true,
                width: 1.5,
                material: cesiumColor, // 同色、不透明
                arcType: Cs.ArcType.GEODESIC,
              },
            });
            if (
              polyHierarchy.holes &&
              polyHierarchy.holes.length
            ) {
              for (var hh = 0; hh < polyHierarchy.holes.length; hh++) {
                if (
                  polyHierarchy.holes[hh] &&
                  polyHierarchy.holes[hh].positions
                ) {
                  dataSource.entities.add({
                    polyline: {
                      positions: polyHierarchy.holes[hh].positions,
                      clampToGround: true,
                      width: 1.5,
                      material: cesiumColor,
                      arcType: Cs.ArcType.GEODESIC,
                    },
                  });
                }
              }
            }
          }
        }

        // ---- 标签（与 2D labelEnabled 永久 tooltip 对应）----
        if (showLabels && m.labelText) {
          ent.label = {
            text: m.labelText,
            font: "500 12px system-ui, -apple-system, sans-serif",
            fillColor: Cs.Color.WHITE,
            outlineColor: Cs.Color.BLACK,
            outlineWidth: 3,
            style: Cs.LabelStyle.FILL_AND_OUTLINE,
            // Cesium Label 默认 horizontalOrigin = LEFT / verticalOrigin = BASELINE，
            // 不显式设 CENTER 的话文字会被画到锚点右侧（看起来整体偏右）。
            verticalOrigin: Cs.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cs.HorizontalOrigin.CENTER,
            pixelOffset: new Cs.Cartesian2(0, -Math.round(iconSize / 2) - 4),
            // 远景不显示标签，避免全球视角下的文字糊成一团
            distanceDisplayCondition: new Cs.DistanceDisplayCondition(
              0,
              6.0e6,
            ),
          };
        } else if (ent.label) {
          ent.label.show = false;
        }
      }

      // ---- 点图层聚类（与 2D clusterEnabled 对应）----
      var clusterColor = layerConfig.color || "#8B6914";
      if (
        pointCount > 0 &&
        layerConfig.clusterEnabled &&
        pointCount >= CLUSTER_MIN_FEATURES &&
        dataSource.clustering
      ) {
        try {
          dataSource.clustering.enabled = true;
          // pixelRange：屏幕像素半径，越小越不容易在全球视角下糊成一个大圈。
          // 45 太激进（全球视角几乎所有点都被吞进几个大圈，且圆心飘在球面外），
          // 28 + minimumClusterSize 4 只在真正密集处聚合。
          dataSource.clustering.pixelRange = 28;
          dataSource.clustering.minimumClusterSize = 4;
          // 自定义聚类气泡：圆形底图 + 白色数量文字（与 2D 聚类样式一致）
          dataSource.clustering.clusterEvent.addEventListener(
            function (clusteredEntities, cluster) {
              var n = clusteredEntities.length;
              var img = makeClusterImage(n, clusterColor);
              cluster.billboard.show = true;
              cluster.billboard.image = img.url;
              cluster.billboard.width = img.size;
              cluster.billboard.height = img.size;
              cluster.billboard.verticalOrigin = Cs.VerticalOrigin.CENTER;
              cluster.billboard.horizontalOrigin = Cs.HorizontalOrigin.CENTER;
              // 与点要素同一套贴地策略（默认不贴地，避免逐帧地形采样）
              cluster.billboard.heightReference = pointHeightRef;
              // 把 id 数组挂到 billboard 上，供点击拾取时放大展开
              cluster.billboard.id = cluster.label.id;
              cluster.label.show = true;
              cluster.label.font =
                "bold " +
                (n >= 100 ? 11 : n >= 10 ? 13 : 15) +
                "px Arial, sans-serif";
              cluster.label.fillColor = Cs.Color.WHITE;
              cluster.label.outlineColor = Cs.Color.BLACK;
              cluster.label.outlineWidth = 3;
              cluster.label.style = Cs.LabelStyle.FILL_AND_OUTLINE;
              // ⚠️ 关键：Cesium 的 Label 默认 horizontalOrigin = LEFT、
              // verticalOrigin = BASELINE，数量文字会被画到锚点右上方。
              // 这里气泡是 CENTER 居中的圆，必须把文字也改成中心对齐并清零偏移。
              cluster.label.horizontalOrigin = Cs.HorizontalOrigin.CENTER;
              cluster.label.verticalOrigin = Cs.VerticalOrigin.CENTER;
              cluster.label.pixelOffset = new Cs.Cartesian2(0, 0);
            },
          );
        } catch (e) {
          console.warn("[CesiumAdapter] 聚类启用失败:", checkboxId, e);
        }
      } else if (dataSource.clustering) {
        dataSource.clustering.enabled = false;
      }

      // 设置数据源名称
      dataSource.name = layerName;

      return dataSource;
    });
  }

  // ========== 透明度增量更新（不重建数据源） ==========
  /**
   * 把可能是 Property 的值解析成实际值
   * Graphics 的 setter 会把裸 Color 包装成 ConstantProperty / ColorMaterialProperty，
   * 所以必须走 getValue()，直接读 .color 会拿到 undefined。
   */
  function resolveValue(v, time) {
    if (v == null) return null;
    if (typeof v.getValue === "function") {
      try {
        return v.getValue(time);
      } catch (e) {
        return null;
      }
    }
    return v;
  }

  /**
   * 从 material / color 任意形态中提取出 Cesium.Color
   * 形态可能是：Color ｜ ConstantProperty(Color) ｜ ColorMaterialProperty ｜ {color:…}
   */
  function extractColor(v, time) {
    if (v == null) return null;

    function asColor(x) {
      if (x && typeof x.withAlpha === "function") return x;
      return null;
    }

    // 1) 本身就是一个 Color
    var direct = asColor(v);
    if (direct) return direct;

    // 2) Property → 取值后再试
    var resolved = resolveValue(v, time);
    var c = asColor(resolved);
    if (c) return c;

    // 3) 包裹对象（ColorMaterialProperty / {color}）→ 取 .color
    var holder = resolved && resolved.color ? resolved : v.color ? v : null;
    if (holder && holder.color != null) {
      c = asColor(resolveValue(holder.color, time));
      if (c) return c;
      c = asColor(holder.color);
      if (c) return c;
    }
    return null;
  }

  /**
   * 更新图层透明度（不重建数据源，逐要素改 alpha）
   * 与 2D 保持一致：点 / 线 = opacity，面填充 = min(opacity, 0.45)
   * @param {Cesium.GeoJsonDataSource} dataSource
   * @param {number} opacity 0-1
   */
  function updateOpacity(dataSource, opacity) {
    if (!dataSource || !window.Cesium) return;
    var Cs = window.Cesium;
    var entities = dataSource.entities.values;
    var fillAlpha = Math.min(opacity, 0.45);
    // 统一取一次时间，避免在大图层上重复构造 JulianDate
    var now = Cs.JulianDate.now();

    for (var i = 0; i < entities.length; i++) {
      var entity = entities[i];

      if (entity.billboard) {
        entity.billboard.color = Cs.Color.WHITE.withAlpha(opacity);
      }
      if (entity.point) {
        var pc = extractColor(entity.point.color, now);
        if (pc) entity.point.color = pc.withAlpha(opacity);
      }
      if (entity.polyline) {
        var plc = extractColor(entity.polyline.material, now);
        if (plc) entity.polyline.material = plc.withAlpha(opacity);
      }
      if (entity.polygon) {
        var pgc = extractColor(entity.polygon.material, now);
        if (pgc) {
          entity.polygon.material = pgc.withAlpha(fillAlpha);
          // 与 loadGeoJson 保持一致：贴地面要素不支持 outline
          if (entity.polygon.outlineColor) {
            var oc = extractColor(entity.polygon.outlineColor, now);
            if (oc) entity.polygon.outlineColor = oc.withAlpha(opacity);
          }
        }
      }
    }
  }

  var CesiumGeoJsonAdapter = {
    loadGeoJson: loadGeoJson,
    updateOpacity: updateOpacity,
    buildLayerConfig: buildLayerConfig,
    buildIconUri: buildIconUri,
  };

  window.CesiumGeoJsonAdapter = CesiumGeoJsonAdapter;
})();
