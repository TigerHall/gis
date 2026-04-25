document.addEventListener("DOMContentLoaded", function () {
  // 检查map和L是否存在
  if (typeof L === "undefined" || typeof map === "undefined") {
    alert("依赖库加载失败，请检查脚本是否正常执行！");
    return;
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
  const layerTrigger = document.getElementById("layerTrigger");
  const layerPanel = document.getElementById("layerPanel");
  let selectAllCheckbox = null;

  if (layerTrigger && layerPanel) {
    layerTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      layerPanel.classList.toggle("active");
    });
    document.addEventListener("click", (e) => {
      if (
        layerPanel.classList.contains("active") &&
        !layerPanel.contains(e.target) &&
        !layerTrigger.contains(e.target)
      ) {
        layerPanel.classList.remove("active");
      }
    });
    layerPanel.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    const titleH3 = layerPanel.querySelector("h3");
    if (titleH3) {
      const titleRow = document.createElement("div");
      titleRow.id = "selectAllRow";
      selectAllCheckbox = document.createElement("input");
      selectAllCheckbox.type = "checkbox";
      selectAllCheckbox.id = "selectAllLayers";
      selectAllCheckbox.title = "全选 / 全不选所有图层";
      selectAllCheckbox.addEventListener("change", function () {
        this.classList.remove("indeterminate");
        if (this.checked) selectAllLayers();
        else unselectAllLayers();
      });
      const titleSpan = document.createElement("span");
      titleSpan.textContent = titleH3.textContent;
      layerPanel.removeChild(titleH3);
      titleRow.appendChild(selectAllCheckbox);
      titleRow.appendChild(titleSpan);
      layerPanel.insertBefore(titleRow, layerPanel.firstChild);
    }
  }

  // ========== GeoJSON 分组配置 ==========
  const geoJsonGroups = [
    {
      groupName: "全球板块构造",
      layers: [
        { name: "全球16大板块 plate16", file: "plate16.json" },
        { name: "大陆板块 plate_cont", file: "plate_cont.json" },
        { name: "大洋板块 plate_ocean", file: "plate_ocean.json" },
        { name: "洋中脊 Mid-Ocean Ridge", file: "ridgenew.json" },
        { name: "海沟 Trench", file: "Pb_trench.json" },
        { name: "转换断层 Transform", file: "Pb_transformall.json" },
        { name: "大西洋转换断层 Atlantic_FZ", file: "Atlantic_FZ.json" },
        { name: "印度洋转换断层 Indian_FZ", file: "Indian_FZ.json" },
        { name: "太平洋转换断层 Pacific_FZ", file: "Pacific_FZ.json" },
      ],
    },

    {
      groupName: "洋中脊作用域",
      layers: [
        {
          name: "1全球洋壳 GlobalOceanicCrust",
          file: "1GlobalOceanicCrust.json",
        },
        { name: "2大洋域 OceanDomian", file: "2OceanDomian.json" },
        { name: "3次大洋域 SubOceanDomain", file: "3SubOceanDomain.json" },
        { name: "4洋中脊作用域 RidgeDomain", file: "4RidgeDomain.json" },
        { name: "0作用域边界 RDboundary", file: "RD_plgn1_5.json" },
        {
          name: "全球陆壳 GlobalContinentalCrust",
          file: "global_continental_crust.json",
        },
      ],
    },

    {
      groupName: "海底基础信息",
      layers: [
        { name: "火山 volcanos", file: "volcanos.json" },
        { name: "热点 hotspots", file: "hotspots.json" },
        { name: "大火成岩省 (Johansson)", file: "LIP_Johansson.json" },
        { name: "洋壳年龄30Ma", file: "seafloor_age_30.geojson" },
      ],
    },

    {
      groupName: "大型异常区",
      layers: [
        { name: "LLSVP", file: "LLSVP.json" },
        { name: "Dupal异常洋 DupalOcean", file: "DupalOcean.json" },
      ],
    },

    {
      groupName: "海底矿产资源",
      layers: [],
    },

    {
      groupName: "地质站位",
      layers: [
        { name: "DSDP", file: "DSDP.geojson" },
        { name: "ODP", file: "ODP.geojson" },
        { name: "IODP03-13", file: "IODP03-13.geojson" },
        { name: "IODP13-26", file: "IODP13-26.geojson" },
      ],
    },
  ];

  const geoJsonBasePath = "./assets/geojson/";
  const layerCache = {};
  const layerColorMap = {};
  // ========== 新增：颜色模式管理 ==========
  // colorMode[checkboxId] = "single" | "sequential" | "field"
  // fieldKey[checkboxId] = 属性字段名（仅 field 模式）
  const colorMode = {};
  const fieldKey = {};
  // 按属性分色的颜色缓存 fieldColorCache[fieldKey] = { value -> hex }
  const fieldColorPalette = {};
  // 高亮状态
  const highlightState = {};
  const layerBoundsCache = {};
  // 站点图层标签配置（文件名 → 标签字段名）
  // 缩放 ≥7 级时显示标签，字段为对应名称字段
  const STATION_LABEL_CONFIG = {
    "DSDP.geojson": { field: "Hole" },
    "ODP.geojson": { field: "Fullname" },
    "IODP03-13.geojson": { field: "Name" },
    "IODP13-26.geojson": { field: "site" },
  };
  // 缩放 7 级以上停止聚类
  const CLUSTER_MIN_ZOOM = 7;
  // 不参与聚类的文件（热点、火山，保持独立图标）
  const NO_CLUSTER_FILES = new Set(["hotspots.json", "volcanos.json"]);
  // 默认标签字段
  const DEFAULT_LABEL_FIELD = "Name";
  const DEFAULT_MIN_ZOOM = 7;

  // ========== 颜色工具 ==========
  // 检测 GeoJSON 中的主要几何类型（统计最多的一种）
  function detectMainGeomType(geojsonData) {
    if (!geojsonData) return "unknown";
    if (geojsonData.type === "Feature" && geojsonData.geometry) {
      return geojsonData.geometry.type || "unknown";
    }
    if (
      geojsonData.type === "FeatureCollection" &&
      Array.isArray(geojsonData.features)
    ) {
      // 统计每种几何类型的数量，返回最多的那种
      const typeCount = {};
      for (let i = 0; i < geojsonData.features.length; i++) {
        const geom = geojsonData.features[i].geometry;
        if (geom && geom.type) {
          const t = geom.type.toLowerCase();
          typeCount[t] = (typeCount[t] || 0) + 1;
        }
      }
      // 优先返回面类型
      if (typeCount["polygon"] || typeCount["multipolygon"]) return "polygon";
      if (typeCount["linestring"] || typeCount["multilinestring"])
        return "linestring";
      if (typeCount["point"] || typeCount["multipoint"]) return "point";
      // 返回数量最多的类型
      let maxType = "unknown",
        maxCount = 0;
      for (const t in typeCount) {
        if (typeCount[t] > maxCount) {
          maxCount = typeCount[t];
          maxType = t;
        }
      }
      return maxType;
    }
    return "unknown";
  }

  function createFixedSeededRandom(seed) {
    const a = 1664525,
      c = 1013904223,
      m = Math.pow(2, 32);
    let current = seed || 12230916;
    return function () {
      current = (a * current + c) % m;
      return current / m;
    };
  }

  function getFixedColor(index) {
    const random = createFixedSeededRandom(12230916);
    for (let i = 0; i < index; i++) random();
    const r = Math.floor(random() * 256);
    const g = Math.floor(random() * 256);
    const b = Math.floor(random() * 256);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // 根据要素索引生成 HSL 颜色（黄金角分布，区分度高）
  function getFeatureColorByIndex(featureIndex) {
    const hue = Math.round((featureIndex * 137.508) % 360);
    const sat = 60 + (featureIndex % 3) * 10;
    const lig = 40 + (featureIndex % 4) * 5;
    return `hsl(${hue},${sat}%,${lig}%)`;
  }

  // 按属性字段值生成颜色（同一属性值 → 同一颜色，跨要素一致）
  function getFeatureColorByField(props, fk, featureIndex) {
    if (!fieldColorPalette[fk]) fieldColorPalette[fk] = {};
    const val = props[fk] != null ? String(props[fk]) : "__null__";
    if (!fieldColorPalette[fk][val]) {
      // 首次遇到该值，用 featureIndex 生成稳定颜色（同一 fk 下不同值颜色不同）
      const hash = createFixedSeededRandom(
        fk.charCodeAt(0) * 1000 + featureIndex,
      );
      const r = Math.floor(hash() * 256);
      const g = Math.floor(hash() * 256);
      const b = Math.floor(hash() * 256);
      fieldColorPalette[fk][val] = `rgb(${r},${g},${b})`;
    }
    return fieldColorPalette[fk][val];
  }

  // ========== 通用弹窗模板 ==========
  const POPUP_FIELD_CONFIG = {
    "hotspots.json": {
      titleField: "geodesc",
      fields: ["geodesc", "xlong", "xlat", "OBJECTID"],
      labels: {
        geodesc: "名称",
        xlong: "经度",
        xlat: "纬度",
        OBJECTID: "编号",
      },
    },
    "volcanos.json": { titleField: null, fields: null },
    "Atlantic_FZ.json": {
      titleField: "Name",
      fields: ["Name", "断层长", "线方位", "Shape_Leng"],
      labels: {
        Name: "名称",
        断层长: "断层长(km)",
        线方位: "方位角(°)",
        Shape_Leng: "形状长",
      },
    },
    "Indian_FZ.json": {
      titleField: "Name",
      fields: ["Name", "断层长", "线方位"],
      labels: { Name: "名称", 断层长: "断层长(km)", 线方位: "方位角(°)" },
    },
    "Pacific_FZ.json": {
      titleField: "Name",
      fields: ["Name", "断层长", "线方位"],
      labels: { Name: "名称", 断层长: "断层长(km)", 线方位: "方位角(°)" },
    },
    "Pb_transformall.json": { titleField: "Name", fields: null },
    "Pb_trench.json": { titleField: "Name", fields: null },
    "plate_cont.json": { titleField: "PlateName", fields: null },
    "plate_ocean.json": { titleField: "PlateName", fields: null },
    "plate16.json": { titleField: "PlateName", fields: null },
    "ridgenew.json": { titleField: "Name", fields: null },
    "LIP_Johansson.json": { titleField: "Name", fields: null },
    _default: { titleField: null, fields: null },
  };

  const SKIP_FIELDS = new Set([
    "FID",
    "Shape_Length",
    "Shape_Area",
    "SHAPE_Leng",
    "SHAPE_Area",
  ]);

  function buildPopupContent(feature, fileName) {
    if (!feature.properties) return null;
    const props = feature.properties;
    const keys = Object.keys(props);
    if (keys.length === 0) return null;
    const config = POPUP_FIELD_CONFIG[fileName] || POPUP_FIELD_CONFIG._default;
    let displayKeys;
    if (config.fields) {
      displayKeys = config.fields.filter(
        (k) => props[k] !== undefined && props[k] !== null && props[k] !== "",
      );
    } else {
      displayKeys = keys.filter(
        (k) =>
          !SKIP_FIELDS.has(k) &&
          props[k] !== undefined &&
          props[k] !== null &&
          props[k] !== "",
      );
    }
    if (displayKeys.length === 0) return null;
    let titleHtml = "";
    if (config.titleField && props[config.titleField]) {
      titleHtml = `<div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:#2a6a2a;border-bottom:1px solid #eee;padding-bottom:3px;">${props[config.titleField]}</div>`;
    }
    const rows = displayKeys
      .filter((k) => !config.titleField || k !== config.titleField)
      .map((k) => {
        const label = (config.labels && config.labels[k]) || k;
        let val = props[k];
        if (typeof val === "number")
          val = Number.isInteger(val) ? val : val.toFixed(4);
        return `<tr><td>${label}</td><td>${val}</td></tr>`;
      })
      .join("");
    return `<div class="feature-popup">${titleHtml}<table><tbody>${rows}</tbody></table></div>`;
  }

  // ========== 核心样式函数（支持三种颜色模式）==========
  function getFeatureFillColor(feature, checkboxId, fileName, featureIndex) {
    const mode = colorMode[checkboxId] || "sequential";

    if (mode === "single") {
      return layerColorMap[checkboxId] || "#8B4513";
    } else if (mode === "sequential") {
      return getFeatureColorByIndex(featureIndex || 0);
    } else if (mode === "field") {
      const fk = fieldKey[checkboxId];
      if (fk && feature.properties)
        return getFeatureColorByField(
          feature.properties,
          fk,
          featureIndex || 0,
        );
      return getFeatureColorByIndex(featureIndex || 0);
    }
    return getFeatureColorByIndex(featureIndex || 0);
  }

  function getGeoJsonStyle(feature, checkboxId, fileName, featureIndex) {
    const geomType = (feature.geometry?.type || "").toLowerCase();
    const isPolygon = geomType === "polygon" || geomType === "multipolygon";
    const isLine = geomType === "linestring" || geomType === "multilinestring";
    const isPoint = geomType === "point" || geomType === "multipoint";

    const featureColor = getFeatureFillColor(
      feature,
      checkboxId,
      fileName,
      featureIndex,
    );

    if (isLine) {
      // 线要素：使用 color 显示多颜色，fill 不显示
      return {
        color: featureColor,
        fillColor: featureColor,
        weight: 2.5,
        opacity: 0.8,
        fillOpacity: 0,
      };
    }

    if (isPoint) {
      // 点要素：边线和填充都用 featureColor
      // 火山用小圆点（5px），其他点要素默认 8px
      const isVolcano = fileName === "volcanos.json";
      return {
        color: featureColor,
        fillColor: featureColor,
        weight: 1,
        opacity: 0.8,
        fillOpacity: 0.8,
        radius: isVolcano ? 5 : 8,
      };
    }

    // 面要素：边框灰色，填充多颜色
    return {
      color: "#555",
      fillColor: featureColor,
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.45,
    };
  }

  // ========== 图标工厂函数 ==========
  // 热点五角星图标（带 outline，小尺寸）
  function createStarIcon(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20">
      <polygon points="10,1 12.9,7.1 19.5,7.6 14.7,12 16.2,18.5 10,15 3.8,18.5 5.3,12 0.5,7.6 7.1,7.1"
        fill="${color}" fill-opacity="0.8" stroke="white" stroke-width="1.5" stroke-opacity="0.95"/>
    </svg>`;
    return L.divIcon({
      html: svg,
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10],
    });
  }

  // 普通点要素图标（外圈描边 + 内圈填充）
  function createPointIcon(color, size) {
    var r = size || 8;
    var outline = r + 2;
    var svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outline * 2}" height="${outline * 2}" viewBox="0 0 ${outline * 2} ${outline * 2}">
      <circle cx="${outline}" cy="${outline}" r="${outline - 1}"
        fill="${color}" fill-opacity="0.85" stroke="white" stroke-width="1.5"/>
    </svg>`;
    return L.divIcon({
      html: svg,
      className: "",
      iconSize: [outline * 2, outline * 2],
      iconAnchor: [outline, outline],
      popupAnchor: [0, -(outline + 2)],
    });
  }

  // ========== 坐标偏移与子午线处理 ==========
  function shiftRingCoords(coords, offset) {
    if (!coords || coords.length === 0) return coords;
    return coords.map(function (c) {
      const nc = c.slice();
      nc[0] = nc[0] + offset;
      return nc;
    });
  }

  function shiftGeometry(geometry, offset) {
    if (!geometry) return geometry;
    const g = JSON.parse(JSON.stringify(geometry));
    switch (g.type) {
      case "Point":
        g.coordinates = [g.coordinates[0] + offset, g.coordinates[1]];
        break;
      case "MultiPoint":
      case "LineString":
        g.coordinates = shiftRingCoords(g.coordinates, offset);
        break;
      case "MultiLineString":
      case "Polygon":
        g.coordinates = g.coordinates.map(function (r) {
          return shiftRingCoords(r, offset);
        });
        break;
      case "MultiPolygon":
        g.coordinates = g.coordinates.map(function (poly) {
          return poly.map(function (r) {
            return shiftRingCoords(r, offset);
          });
        });
        break;
      default:
        break;
    }
    return g;
  }

  function shiftGeoJSON(geojsonData, offset) {
    const data = JSON.parse(JSON.stringify(geojsonData));
    if (offset === 0) return data;
    if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
      data.features.forEach(function (f) {
        if (f.geometry) f.geometry = shiftGeometry(f.geometry, offset);
      });
    } else if (data.type === "Feature" && data.geometry) {
      data.geometry = shiftGeometry(data.geometry, offset);
    }
    return data;
  }

  /**
   * fixRingCoords - "展开"策略：消除相邻点之间的 >180° 跳变。
   * 结果坐标可能超出 [-180, 180]，这是允许的，Leaflet 能正确处理。
   */
  function fixRingCoords(coords) {
    if (!coords || coords.length === 0) return coords;
    const first = coords[0].slice();
    first[0] = ((((first[0] + 180) % 360) + 360) % 360) - 180;
    const result = [first];
    for (let i = 1; i < coords.length; i++) {
      const prev = result[i - 1];
      const cur = coords[i].slice();
      let dLng = cur[0] - prev[0];
      dLng = ((dLng % 360) + 360) % 360;
      if (dLng > 180) dLng -= 360;
      cur[0] = prev[0] + dLng;
      result.push(cur);
    }
    return result;
  }

  function fixGeometryCoords(geometry) {
    if (!geometry) return;
    switch (geometry.type) {
      case "LineString":
        geometry.coordinates = fixRingCoords(geometry.coordinates);
        break;
      case "MultiLineString":
        geometry.coordinates = geometry.coordinates.map(fixRingCoords);
        break;
      case "Polygon":
        geometry.coordinates = geometry.coordinates.map(fixRingCoords);
        break;
      case "MultiPolygon":
        geometry.coordinates = geometry.coordinates.map(function (rings) {
          return rings.map(fixRingCoords);
        });
        break;
      default:
        break;
    }
  }

  function fixAntimeridian(geojsonData) {
    if (!geojsonData) return geojsonData;
    const data = JSON.parse(JSON.stringify(geojsonData));
    if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
      data.features.forEach(function (f) {
        if (f.geometry) fixGeometryCoords(f.geometry);
      });
    } else if (data.type === "Feature" && data.geometry) {
      fixGeometryCoords(data.geometry);
    }
    return data;
  }

  // ========== 高亮样式 ==========
  function buildHighlightStyle(origStyle) {
    return Object.assign({}, origStyle, {
      color: "#ffff00",
      weight: (origStyle.weight || 1) + 2,
      opacity: 1,
      fillOpacity: Math.min((origStyle.fillOpacity || 0.45) + 0.3, 0.95),
      dashArray: "6, 3",
    });
  }

  function clearHighlight(checkboxId) {
    const state = highlightState[checkboxId];
    if (!state || state.featureId === null) return;
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
    if (!state) return;
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

  map.on("zoomend", function () {
    // 【方案A】站点标签已改用 Tooltip permanent，Leaflet 自动处理可见性，无需手动更新
  });

  map.on("click", function () {
    clearAllHighlights();
    // 安全关闭所有打开的 tooltip
    try {
      map.closeTooltip();
    } catch (e) {}
  });

  // ========== 获取要素可用属性字段（用于"按字段分色"选项）==========
  function getAvailableFields(geojsonData) {
    const fieldSet = new Set();
    if (
      geojsonData.type === "FeatureCollection" &&
      Array.isArray(geojsonData.features)
    ) {
      geojsonData.features.slice(0, 50).forEach(function (f) {
        if (f.properties) {
          Object.keys(f.properties).forEach(function (k) {
            if (!SKIP_FIELDS.has(k) && typeof f.properties[k] !== "object") {
              fieldSet.add(k);
            }
          });
        }
      });
    }
    return Array.from(fieldSet).sort();
  }

  // ========== 创建 GeoJSON 图层（聚类 + 三世界副本）==========
  function buildGeoJsonLayerGroup(
    geojsonData,
    checkboxId,
    fileName,
    forceCluster,
  ) {
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
    console.log(
      `[DEBUG] buildGeoJsonLayerGroup: ${fileName}, features: ${geojsonData.features?.length}`,
    );

    // 判断是否需要聚类：
    // 1. forceCluster=true（点要素）→ 聚类
    // 2. 火山、热点 → 不聚类
    // 3. 其他（非点要素）→ 不聚类
    const isNoCluster =
      NO_CLUSTER_FILES.has(fileName) || forceCluster === false;
    // 标签配置：使用配置的字段或默认 Name
    const cfg = STATION_LABEL_CONFIG[fileName];
    const labelField = cfg ? cfg.field : DEFAULT_LABEL_FIELD;
    const minZoom = DEFAULT_MIN_ZOOM;

    // 创建聚类组
    function createClusterGroup() {
      return L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        // 缩放 >=7 时停止聚类，展开显示标签
        disableClusteringAtZoom: minZoom,
        iconCreateFunction: function (cluster) {
          const count = cluster.getChildCount();
          const size = count < 10 ? "small" : count < 100 ? "medium" : "large";
          return L.divIcon({
            html: `<div class="cluster-icon cluster-${size}">${count}</div>`,
            className: "cluster-marker",
            iconSize: L.point(40, 40),
          });
        },
      });
    }

    // 创建带标签的点标记（缩放 >=7 显示标签）
    function createLabeledMarker(feature, latlng, color, labelText) {
      const currentZoom = map.getZoom();
      const showLabel = currentZoom >= minZoom;

      const html = `<div class="station-marker-wrapper">
        <span class="station-dot" style="background:${color};border-color:white;"></span>
        <span class="station-label ${showLabel ? "" : "hidden"}">${labelText}</span>
      </div>`;

      const marker = L.marker(latlng, {
        icon: L.divIcon({
          html: html,
          className: "station-icon-container",
          iconSize: [120, 20],
          iconAnchor: [5, 10],
          popupAnchor: [8, -5],
        }),
        interactive: true,
      });

      // 绑定弹窗
      const content = buildPopupContent(feature, fileName);
      if (content) {
        marker.bindPopup(content, { maxWidth: 300 });
      }

      // 缩放变化时更新标签显示
      marker._updateLabelVisibility = function () {
        const zoom = map.getZoom();
        const el = marker.getElement();
        if (el) {
          const labelSpan = el.querySelector(".station-label");
          if (labelSpan) {
            if (zoom >= minZoom) {
              labelSpan.classList.remove("hidden");
            } else {
              labelSpan.classList.add("hidden");
            }
          }
        }
      };

      return marker;
    }

    // 创建热点/火山标记（最轻量方式，无标签）
    function createPointMarker(feature, latlng, color, idx) {
      let marker;
      if (fileName === "hotspots.json") {
        // 热点：marker + 五角星
        marker = L.marker(latlng, { icon: createStarIcon(color) });
      } else {
        // 火山：原生 circleMarker（最轻量）
        marker = L.circleMarker(
          latlng,
          getGeoJsonStyle(feature, checkboxId, fileName, idx),
        );
      }

      const content = buildPopupContent(feature, fileName);
      if (content) {
        marker.bindPopup(content, { maxWidth: 300 });
      }
      return marker;
    }

    const offsets = [-360, 0, 360];
    const geoLayers = [];
    const clusterGroups = [];
    const allMarkers = []; // 用于缩放时更新标签

    // 缩放事件处理：更新标签可见性
    const zoomHandler = function () {
      allMarkers.forEach(function (marker) {
        if (marker._updateLabelVisibility) {
          marker._updateLabelVisibility();
        }
      });
    };

    offsets.forEach(function (offset) {
      const shifted = shiftGeoJSON(geojsonData, offset);
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

      // 检测当前副本中的要素类型（以第一个有效要素为准）
      const firstFeature = shifted.features?.find((f) => f.geometry);
      const firstGeomType = (firstFeature?.geometry?.type || "").toLowerCase();
      const isPointType =
        firstGeomType === "point" || firstGeomType === "multipoint";

      if (isPointType && !isNoCluster) {
        // 【点要素】使用聚类，>=7级展开显示标签
        const clusterGroup = createClusterGroup();
        clusterGroup.addTo(map);

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

            let marker;
            if (labelText) {
              marker = createLabeledMarker(feature, latlng, color, labelText);
            } else {
              marker = createPointMarker(feature, latlng, color);
            }
            marker.feature = feature;

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
              const content = buildPopupContent(feature, fileName);
              if (content) {
                marker.bindPopup(content, { maxWidth: 300 }).openPopup();
              }
              L.DomEvent.stop(e);
            });

            marker.on("dblclick", function (e) {
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
              try {
                map.setView(latlng, map.getZoom() + 2, { animate: true });
              } catch (err) {}
              const content = buildPopupContent(feature, fileName);
              if (content) {
                marker.bindPopup(content, { maxWidth: 300 }).openPopup();
              }
              L.DomEvent.stop(e);
            });

            return marker;
          },
        }).eachLayer(function (layer) {
          markers.push(layer);
          allMarkers.push(layer);
        });

        clusterGroup.addLayers(markers);
        clusterGroups.push(clusterGroup);
        geoLayers.push(clusterGroup);
      } else {
        // 【面/线要素 + 热点/火山】不使用聚类，带交互事件
        const geoLayer = L.geoJSON(shifted, {
          pointToLayer: function (feature, latlng) {
            const idx = feature._featureIndex || 0;
            const color = getFeatureFillColor(
              feature,
              checkboxId,
              fileName,
              idx,
            );

            // 热点/火山：最轻量方式（无标签）
            const marker = createPointMarker(feature, latlng, color, idx);
            marker.feature = feature;
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
            if (isPoint) return; // 点已在 pointToLayer 处理

            // 面/线要素交互
            layer.on("click", function (e) {
              const idx = feature._featureIndex || 0;
              const baseStyle = getGeoJsonStyle(
                feature,
                checkboxId,
                fileName,
                idx,
              );
              const hlStyle = Object.assign({}, baseStyle, {
                weight: (baseStyle.weight || 1) + 2,
                opacity: 1,
                fillOpacity: Math.min(
                  (baseStyle.fillOpacity || 0.45) + 0.3,
                  0.95,
                ),
                color: "#ffff00",
                dashArray: "6, 3",
              });
              applyHighlight(checkboxId, feature._featureIndex, hlStyle);
              const content = buildPopupContent(feature, fileName);
              if (content) {
                layer.bindPopup(content, { maxWidth: 300 }).openPopup();
              }
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
              const hlStyle = Object.assign({}, baseStyle, {
                weight: (baseStyle.weight || 1) + 2,
                opacity: 1,
                fillOpacity: Math.min(
                  (baseStyle.fillOpacity || 0.45) + 0.3,
                  0.95,
                ),
                color: "#ffff00",
                dashArray: "6, 3",
              });
              applyHighlight(checkboxId, feature._featureIndex, hlStyle);
              try {
                if (layer.getBounds) {
                  const bounds = layer.getBounds();
                  if (bounds.isValid()) {
                    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
                  }
                }
              } catch (err) {}
              const content = buildPopupContent(feature, fileName);
              if (content) {
                layer.bindPopup(content, { maxWidth: 300 }).openPopup();
              }
              L.DomEvent.stop(e);
            });
          },
        });

        geoLayer.addTo(map);
        geoLayers.push(geoLayer);
      }
    });

    // 监听缩放事件
    map.on("zoomend", zoomHandler);

    highlightState[checkboxId] = {
      geoLayers: geoLayers,
      clusterGroups: clusterGroups,
      allMarkers: allMarkers,
      featureId: null,
      fileName: fileName,
      zoomHandler: zoomHandler,
    };
    return L.layerGroup(geoLayers);
  }

  // ========== 图层加载 ==========
  function fetchGeoJSON(filePath) {
    return fetch(filePath + ".gz")
      .then(function (response) {
        if (!response.ok) throw new Error("gz not found");
        const ds = new DecompressionStream("gzip");
        return new Response(response.body.pipeThrough(ds)).text();
      })
      .then(function (text) {
        return JSON.parse(text);
      })
      .catch(function () {
        console.log("gz 不可用，回退至：", filePath);
        return fetch(filePath).then(function (response) {
          if (!response.ok) throw new Error("加载 " + filePath + " 失败");
          return response.json();
        });
      });
  }

  function loadGeoJSONLayer(filePath, checkboxId, fitBoundsAfterLoad) {
    // 如果图层已在缓存，直接显示
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
          const bl = layerBoundsCache[checkboxId];
          if (bl) {
            const b = bl.getBounds();
            if (b.isValid())
              optimizedFitBounds(b, { padding: [30, 30], animate: true });
          }
        } catch (e) {}
      }
      return;
    }

    const fileName = filePath.split("/").pop();
    updateLayerItemStatus(checkboxId, "loading");

    fetchGeoJSON(filePath)
      .then(function (data) {
        const fixedData = fixAntimeridian(data);
        console.log(
          `[DEBUG] ${fileName}: 加载成功, features: ${fixedData.features?.length || 0}`,
        );
        // 根据几何类型和文件名设置默认颜色模式（仅在未设置时）：
        // 热点/火山文件保持 single（红色五角星/圆形）
        // 面要素（Polygon/MultiPolygon）默认 sequential（多颜色填充）
        // 其他点/线要素保持 single
        if (colorMode[checkboxId] === undefined) {
          const geomType = detectMainGeomType(fixedData);
          const isPolygon =
            geomType === "polygon" || geomType === "multipolygon";
          if (fileName === "hotspots.json" || fileName === "volcanos.json") {
            colorMode[checkboxId] = "single";
          } else if (isPolygon) {
            colorMode[checkboxId] = "sequential";
          } else {
            colorMode[checkboxId] = "single";
          }
        }

        const worldCopyGroup = buildGeoJsonLayerGroup(
          fixedData,
          checkboxId,
          fileName,
        );
        layerCache[checkboxId] = worldCopyGroup;

        // 0° 副本用于 getBounds
        // baseGeoJson 仅用于获取 bounds，无需完整渲染
        const baseGeoJson = L.geoJSON(fixedData, {
          style: function (feature) {
            return getGeoJsonStyle(
              feature,
              checkboxId,
              fileName,
              feature._featureIndex || 0,
            );
          },
        });
        layerBoundsCache[checkboxId] = baseGeoJson;

        // 【方案A】站点标签已移至 pointToLayer，无需单独创建标签图层

        if (fitBoundsAfterLoad) {
          try {
            const b = baseGeoJson.getBounds();
            if (b.isValid())
              optimizedFitBounds(b, { padding: [6, 6], animate: true });
          } catch (e) {}
        }
        updateLayerItemStatus(checkboxId, "loaded");
      })
      .catch(function (error) {
        console.error("GeoJSON加载失败：", error);
        updateLayerItemStatus(checkboxId, "error");
        const checkbox = document.getElementById(checkboxId);
        if (checkbox) {
          checkbox.checked = false;
          checkbox.style.background = "#fff";
        }
        syncSelectAllStatus();
        isMapZooming = false;
      });
  }

  function reloadLayerWithNewMode(checkboxId, newMode, newColor, newField) {
    // 清除旧图层（强制从地图移除所有副本）
    clearHighlight(checkboxId);
    const oldState = highlightState[checkboxId];
    if (oldState) {
      if (oldState.zoomHandler) {
        map.off("zoomend", oldState.zoomHandler);
      }
      if (oldState.geoLayers) {
        oldState.geoLayers.forEach(function (gl) {
          try {
            map.removeLayer(gl);
          } catch (e) {}
        });
      }
      if (oldState.clusterGroups) {
        oldState.clusterGroups.forEach(function (cg) {
          try {
            map.removeLayer(cg);
          } catch (e) {}
        });
      }
      highlightState[checkboxId] = null;
    }
    if (layerCache[checkboxId]) {
      map.removeLayer(layerCache[checkboxId]);
      layerCache[checkboxId] = null;
    }
    // 更新模式/颜色
    colorMode[checkboxId] = newMode;
    if (newMode === "single" && newColor) layerColorMap[checkboxId] = newColor;
    if (newMode === "field") fieldKey[checkboxId] = newField;

    // 重新加载
    const checkbox = document.getElementById(checkboxId);
    if (checkbox && checkbox.checked) {
      loadGeoJSONLayer(checkbox.value, checkboxId, false);
    }

    // 更新颜色按钮提示
    updateColorBtnHint(checkboxId);
  }

  // ========== 刷新图层颜色（不重建图层）==========
  function refreshLayerColors(checkboxId) {
    const state = highlightState[checkboxId];
    if (!state || !state.geoLayers) return;
    const mode = colorMode[checkboxId] || "single";
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

  // ========== 定位、选择、全选 ==========
  function flyToLayer(checkboxId) {
    const bl = layerBoundsCache[checkboxId] || layerCache[checkboxId];
    if (bl) {
      try {
        const b = bl.getBounds();
        if (b.isValid())
          map.fitBounds(b, { padding: [20, 20], animate: true, maxZoom: 10 });
      } catch (e) {
        console.warn("无法定位：", e);
      }
    }
  }

  // 【方案A】站点标签管理已简化
  // - isStationFile, getStationLabel 仍保留用于判断
  // - buildStationLabelLayer 等已移除，标签直接通过 bindTooltip permanent 创建
  function isStationFile(fileName) {
    return !!STATION_LABEL_CONFIG[fileName];
  }

  // 获取站点标签文本（优先使用配置字段）
  function getStationLabel(feature, fileName) {
    const cfg = STATION_LABEL_CONFIG[fileName];
    if (!cfg || !feature.properties) return null;
    return feature.properties[cfg.field] || null;
  }

  function removeGeoJSONLayer(checkboxId) {
    clearHighlight(checkboxId);
    const state = highlightState[checkboxId];
    if (state) {
      // 移除缩放事件监听器
      if (state.zoomHandler) {
        map.off("zoomend", state.zoomHandler);
      }
      if (state.geoLayers) {
        state.geoLayers.forEach(function (gl) {
          try {
            map.removeLayer(gl);
          } catch (e) {}
        });
      }
      if (state.clusterGroups) {
        state.clusterGroups.forEach(function (cg) {
          try {
            map.removeLayer(cg);
          } catch (e) {}
        });
      }
      highlightState[checkboxId] = null;
    }
    if (layerCache[checkboxId]) {
      map.removeLayer(layerCache[checkboxId]);
      layerCache[checkboxId] = null;
    }
    if (layerBoundsCache[checkboxId]) {
      map.removeLayer(layerBoundsCache[checkboxId]);
      layerBoundsCache[checkboxId] = null;
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
          loadGeoJSONLayer(cb.value, cb.id, false);
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
          removeGeoJSONLayer(cb.id);
        }
      });
    syncAllGroupStatus();
  }

  // ========== 状态同步 ==========
  function syncGroupStatus(groupDiv) {
    const groupCb = groupDiv.querySelector(".group-select-all");
    if (!groupCb) return;
    const items = groupDiv.querySelectorAll(
      '.layer-item input[type="checkbox"]',
    );
    const checkedCount = Array.from(items).filter(function (c) {
      return c.checked;
    }).length;
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
    const checkedCount = all.filter(function (c) {
      return c.checked;
    }).length;
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
        loaded: "✓",
        partial: "部分加载",
        error: "×",
      }[status] || status;
    gs.textContent =
      status === "loading"
        ? "⏳"
        : status === "loaded"
          ? "✓"
          : status === "partial"
            ? "◐"
            : status === "error"
              ? "✕"
              : "";
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
        loaded: "已加载",
        error: "加载失败",
      }[status] || status;
    const gd = li.closest(".layer-group");
    if (gd) syncGroupLoadingStatus(gd);
  }

  // ========== 颜色按钮提示文字 ==========
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
  let colorModalData = null; // { checkboxId, fileName }

  function getColorModalHTML(
    checkboxId,
    fileName,
    availableFields,
    geojsonData,
  ) {
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
              ${fieldOptions || "<option value=''>无可用字段</option>"}
            </select>
          </div>
        </div>
        <div class="color-modal-footer">
          <button id="colorModalCancel" style="padding:5px 12px;cursor:pointer;">取消</button>
          <button id="colorModalConfirm" style="padding:5px 12px;cursor:pointer;background:#4a8c4a;color:#fff;border:1px solid #3a6c3a;border-radius:3px;">确认</button>
        </div>
      </div>
    `;
  }

  function openColorModal(checkboxId, fileName, filePath) {
    // 移除旧的
    if (colorModalOverlay) {
      colorModalOverlay.remove();
      colorModalOverlay = null;
    }

    // 先获取字段列表（从已加载的数据或重新获取）
    fetchGeoJSON(filePath)
      .then(function (data) {
        const fixed = fixAntimeridian(data);
        const fields = getAvailableFields(fixed);

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
          fixed,
        );

        // 样式
        colorModalOverlay.style.cssText =
          "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.35);z-index:99999;display:flex;align-items:center;justify-content:center;";
        document.body.appendChild(colorModalOverlay);

        // 模式切换
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

        // 颜色选择器 - 即时预览（不依赖"应用"按钮）
        var colorPicker = document.getElementById("modalColorPicker");
        if (colorPicker) {
          colorPicker.addEventListener("input", function () {
            var hexSpan = document.getElementById("modalColorHex");
            if (hexSpan) hexSpan.textContent = this.value;
            // 即时更新 hex 显示
          });
          colorPicker.addEventListener("change", function () {
            // 颜色变化时直接更新图层（不需要点"应用"）
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

        // 关闭
        document.getElementById("colorModalClose").onclick = closeColorModal;
        document.getElementById("colorModalCancel").onclick = closeColorModal;
        colorModalOverlay.addEventListener("click", function (e) {
          if (e.target === colorModalOverlay) closeColorModal();
        });

        // 确认
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
      })
      .catch(function (e) {
        console.error("无法加载字段列表：", e);
      });
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
    const container = document.getElementById("layerItemsContainer");

    geoJsonGroups.forEach(function (group) {
      const groupDiv = document.createElement("div");
      groupDiv.className = "layer-group";

      const header = document.createElement("div");
      header.className = "layer-group-header";

      const arrow = document.createElement("span");
      arrow.className = "layer-group-arrow";
      arrow.textContent = "▶";

      const groupName = document.createElement("span");
      groupName.className = "layer-group-name";
      groupName.textContent = group.groupName;

      const groupStatus = document.createElement("span");
      groupStatus.className = "group-status";
      groupStatus.dataset.status = "idle";
      groupStatus.title = "";

      const groupCb = document.createElement("input");
      groupCb.type = "checkbox";
      groupCb.className = "group-select-all";
      groupCb.title = "全选/全不选「" + group.groupName + "」";
      groupCb.addEventListener("click", function (e) {
        e.stopPropagation();
      });
      groupCb.addEventListener("change", function () {
        this.classList.remove("indeterminate");
        var items = groupDiv.querySelectorAll(
          '.layer-item input[type="checkbox"]',
        );
        var isChecked = this.checked;
        items.forEach(function (cb) {
          if (isChecked && !cb.checked) {
            cb.checked = true;
            cb.style.background = layerColorMap[cb.id] || "#fff";
            loadGeoJSONLayer(cb.value, cb.id, false);
          } else if (!isChecked && cb.checked) {
            cb.checked = false;
            cb.style.background = "#fff";
            removeGeoJSONLayer(cb.id);
          }
        });
        syncSelectAllStatus();
      });

      const children = document.createElement("div");
      children.className = "layer-group-children";

      header.addEventListener("click", function (e) {
        if (e.target === groupCb) return;
        var isOpen = children.classList.toggle("open");
        arrow.classList.toggle("open", isOpen);
      });

      header.appendChild(arrow);
      header.appendChild(groupName);
      header.appendChild(groupStatus);
      header.appendChild(groupCb);

      group.layers.forEach(function (layerConfig) {
        var idx = globalLayerIndex++;
        var checkboxId = "layer_" + idx;
        var fullPath = geoJsonBasePath + layerConfig.file;
        var fileName = layerConfig.file;
        // 热点/火山使用固定红色，其他图层使用随机固定色
        var fixedColor =
          fileName === "hotspots.json" || fileName === "volcanos.json"
            ? "#FF3333"
            : getFixedColor(idx);
        layerColorMap[checkboxId] = fixedColor;
        // colorMode 由 loadGeoJSONLayer 根据几何类型决定：
        // 热点/火山 → single，面要素 → sequential，其他 → single

        var layerItem = document.createElement("div");
        layerItem.className = "layer-item";
        layerItem.dataset.layerId = checkboxId;

        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = checkboxId;
        checkbox.value = fullPath;
        checkbox.dataset.layerName = layerConfig.name;
        checkbox.style.setProperty("--layer-color", fixedColor);
        checkbox.addEventListener("change", function () {
          this.style.background = this.checked ? fixedColor : "#fff";
          syncAllGroupStatus();
          if (this.checked) {
            loadGeoJSONLayer(fullPath, checkboxId, false); // 加载时不自动缩放
          } else {
            removeGeoJSONLayer(checkboxId);
          }
        });

        var label = document.createElement("label");
        label.htmlFor = checkboxId;
        label.textContent = layerConfig.name;
        label.title = layerConfig.name;

        var statusSpan = document.createElement("span");
        statusSpan.className = "layer-status";
        statusSpan.dataset.status = "idle";
        statusSpan.title = "未加载";

        // 颜色设置按钮（新增）
        var colorBtn = document.createElement("button");
        colorBtn.className = "layer-color-btn";
        colorBtn.title = "颜色模式：内部多颜色";
        colorBtn.innerHTML = "🎨";
        colorBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          openColorModal(checkboxId, layerConfig.file, fullPath);
        });

        // 定位按钮
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

      groupDiv.appendChild(header);
      groupDiv.appendChild(children);
      container.appendChild(groupDiv);
    });

    // 用户上传图层区
    var userGroup = document.createElement("div");
    userGroup.id = "userLayerGroup";
    userGroup.innerHTML =
      '<div style="font-size:12px;color:#888;padding:0 10px 4px;">用户上传图层</div>';
    container.appendChild(userGroup);

    // 上传按钮
    var uploadDiv = document.createElement("div");
    uploadDiv.style.cssText =
      "padding:10px;border-top:1px dashed #ccc;margin-top:8px;";
    var uploadBtn = document.createElement("button");
    uploadBtn.textContent = "📂 上传 GeoJSON";
    uploadBtn.style.cssText =
      "width:100%;padding:8px 12px;background:#f0f7f0;border:1px solid #99cc99;border-radius:4px;cursor:pointer;font-size:12px;color:#3a7a3a;transition:background 0.15s;";
    uploadBtn.onmouseover = function () {
      uploadBtn.style.background = "#e2f0e2";
    };
    uploadBtn.onmouseout = function () {
      uploadBtn.style.background = "#f0f7f0";
    };
    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".geojson,.json";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    uploadBtn.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", handleFileUpload);
    uploadDiv.appendChild(uploadBtn);
    uploadDiv.appendChild(fileInput);
    container.appendChild(uploadDiv);
  }

  // ========== 文件上传 ==========
  function handleFileUpload(e) {
    var files = Array.from(e.target.files);
    e.target.value = "";
    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var data = JSON.parse(ev.target.result);
          addUserLayer(data, file.name);
        } catch (err) {
          alert("文件解析失败：" + file.name + "\n" + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  let userLayerIndex = 0;

  function addUserLayer(geojsonData, fileName) {
    var uid = "user_layer_" + userLayerIndex++;
    var fixedColor = getFixedColor(globalLayerIndex++);
    layerColorMap[uid] = fixedColor;

    var fixedData = fixAntimeridian(geojsonData);
    // 根据几何类型设置默认颜色模式：点/线 → 单色，面 → 多颜色
    var mainGeomType = detectMainGeomType(fixedData);
    colorMode[uid] =
      mainGeomType === "polygon" || mainGeomType === "multipolygon"
        ? "sequential"
        : "single";
    // 点要素启用聚类，面/线要素不启用
    var isPointLayer =
      mainGeomType === "point" || mainGeomType === "multipoint";
    if (
      fixedData.type === "FeatureCollection" &&
      Array.isArray(fixedData.features)
    ) {
      fixedData.features.forEach(function (f, idx) {
        f._featureIndex = idx;
      });
    }
    var worldCopyGroup = buildGeoJsonLayerGroup(
      fixedData,
      uid,
      fileName,
      isPointLayer,
    );
    worldCopyGroup.addTo(map);
    layerCache[uid] = worldCopyGroup;

    var baseGeoJson = L.geoJSON(fixedData, {
      style: function (feature) {
        return getGeoJsonStyle(
          feature,
          uid,
          fileName,
          feature._featureIndex || 0,
        );
      },
      pointToLayer: function (feature, latlng) {
        const color = getFeatureFillColor(
          feature,
          uid,
          fileName,
          feature._featureIndex || 0,
        );
        return L.marker(latlng, { icon: createPointIcon(color, 6) });
      },
    });
    layerBoundsCache[uid] = baseGeoJson;

    // 【方案A】站点标签已移至 pointToLayer，无需单独创建标签图层

    try {
      var b = baseGeoJson.getBounds();
      if (b.isValid())
        map.fitBounds(b, { padding: [20, 20], animate: true, maxZoom: 12 });
    } catch (e) {}

    var userGroup = document.getElementById("userLayerGroup");
    var layerItem = document.createElement("div");
    layerItem.className = "layer-item";
    layerItem.dataset.layerId = uid;

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = uid;
    checkbox.checked = true;
    checkbox.style.setProperty("--layer-color", fixedColor);
    checkbox.style.background = fixedColor;
    checkbox.addEventListener("change", function () {
      this.style.background = this.checked ? fixedColor : "#fff";
      if (this.checked) layerCache[uid] && layerCache[uid].addTo(map);
      else map.removeLayer(layerCache[uid]);
    });

    var label = document.createElement("label");
    label.htmlFor = uid;
    label.textContent = fileName;
    label.title = fileName;

    var statusSpan = document.createElement("span");
    statusSpan.className = "layer-status";
    statusSpan.dataset.status = "loaded";
    statusSpan.title = "已加载";

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
      layerItem.remove();
    });

    layerItem.appendChild(checkbox);
    layerItem.appendChild(label);
    layerItem.appendChild(statusSpan);
    layerItem.appendChild(colorBtn);
    layerItem.appendChild(locateBtn);
    layerItem.appendChild(removeBtn);
    userGroup.appendChild(layerItem);
  }

  window.addUserLayer = addUserLayer;

  // ========== 初始化 ==========
  function initGeoJsonLayer() {
    generateLayerItems();
  }

  window.addEventListener("load", initGeoJsonLayer);
});
