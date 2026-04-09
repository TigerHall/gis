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

    // ========== 全选复选框 (替换 h3 为带复选框的标题行) ==========
    const titleH3 = layerPanel.querySelector("h3");
    if (titleH3) {
      const titleRow = document.createElement("div");
      titleRow.id = "selectAllRow";

      selectAllCheckbox = document.createElement("input");
      selectAllCheckbox.type = "checkbox";
      selectAllCheckbox.id = "selectAllLayers";
      selectAllCheckbox.title = "全选 / 全不选所有图层";
      selectAllCheckbox.addEventListener("change", function () {
        // 清除半选状态
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
  // 需要多边形分色的图层（key = file名, value = 颜色配置策略）
  // "sequential"：按要素序号生成不同色，"property"：按某个属性字段分色
  const polygonColorConfig = {
    "1GlobalOceanicCrust.json": { mode: "sequential" },
    "2OceanDomian.json": { mode: "sequential" },
    "3SubOceanDomain.json": { mode: "sequential" },
    "4RidgeDomain.json": { mode: "sequential" },
    "DupalOcean.json": { mode: "sequential" },
    "global_continental_crust.json": { mode: "sequential" },
    "LLSVP.json": { mode: "sequential" },
    "LIP_Johansson.json": { mode: "sequential" },
    "plate_cont.json": { mode: "sequential" },
    "plate_ocean.json": { mode: "sequential" },
    "plate16.json": { mode: "sequential" },
    "RD_plgn1_5.json": { mode: "sequential" },
  };

  // 分级分组配置
  const geoJsonGroups = [
    {
      groupName: "地壳与大洋域",
      layers: [
        { name: "全球洋壳 GlobalOceanicCrust", file: "1GlobalOceanicCrust.json" },
        { name: "大洋域 OceanDomian", file: "2OceanDomian.json" },
        { name: "次大洋域 SubOceanDomain", file: "3SubOceanDomain.json" },
        { name: "洋脊域 RidgeDomain", file: "4RidgeDomain.json" },
        { name: "全球陆壳 GlobalContinentalCrust", file: "global_continental_crust.json" },
      ],
    },
    {
      groupName: "板块",
      layers: [
        { name: "大陆板块 plate_cont", file: "plate_cont.json" },
        { name: "大洋板块 plate_ocean", file: "plate_ocean.json" },
        { name: "16板块 plate16", file: "plate16.json" },
      ],
    },
    {
      groupName: "断层与转换断层",
      layers: [
        { name: "大西洋转换断层 Atlantic_FZ", file: "Atlantic_FZ.json" },
        { name: "印度洋转换断层 Indian_FZ", file: "Indian_FZ.json" },
        { name: "太平洋转换断层 Pacific_FZ", file: "Pacific_FZ.json" },
        { name: "板块转换断层 Pb_transformall", file: "Pb_transformall.json" },
        { name: "海沟 Pb_trench", file: "Pb_trench.json" },
      ],
    },
    {
      groupName: "洋脊与火成岩",
      layers: [
        { name: "洋脊 (plgn1_5)", file: "RD_plgn1_5.json" },
        { name: "洋脊 (新) ridgenew", file: "ridgenew.json" },
        { name: "大火成岩省 (Johansson)", file: "LIP_Johansson.json" },
        { name: "LLSVP", file: "LLSVP.json" },
      ],
    },
    {
      groupName: "地质活动点",
      layers: [
        { name: "热点 hotspots", file: "hotspots.json" },
        { name: "火山 volcanos", file: "volcanos.json" },
        { name: "Dupal异常洋 DupalOcean", file: "DupalOcean.json" },
      ],
    },
  ];

  const geoJsonBasePath = "./assets/geojson/";
  const layerCache = {};
  const layerColorMap = {};
  // 用于存储各图层每个要素的颜色（多边形分色）
  const featureColorCache = {};

  // ========== 颜色工具 ==========
  function createFixedSeededRandom(seed = 12230916) {
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    let current = seed;
    return function () {
      current = (a * current + c) % m;
      return current / m;
    };
  }

  function getFixedColor(index) {
    const random = createFixedSeededRandom();
    for (let i = 0; i < index; i++) random();
    const r = Math.floor(random() * 256);
    const g = Math.floor(random() * 256);
    const b = Math.floor(random() * 256);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // 根据要素索引生成多边形分色（视觉区分度更好的HSL调色）
  function getFeatureColor(featureIndex, totalHint) {
    const hue = Math.round((featureIndex * 137.508) % 360); // 黄金角分布
    const sat = 60 + (featureIndex % 3) * 10;
    const lig = 40 + (featureIndex % 4) * 5;
    return `hsl(${hue},${sat}%,${lig}%)`;
  }

  // ========== 通用弹窗模板 ==========
  // 根据文件名/要素类型，决定显示哪些字段，以及显示名称
  const POPUP_FIELD_CONFIG = {
    // 热点
    "hotspots.json": {
      titleField: "geodesc",
      fields: ["geodesc", "xlong", "xlat", "OBJECTID"],
      labels: { geodesc: "名称", xlong: "经度", xlat: "纬度", OBJECTID: "编号" },
    },
    // 火山
    "volcanos.json": {
      titleField: null,
      fields: null, // null = 显示所有字段
    },
    // 断层系列
    "Atlantic_FZ.json": {
      titleField: "Name",
      fields: ["Name", "断层长", "线方位", "Shape_Leng"],
      labels: { Name: "名称", 断层长: "断层长(km)", 线方位: "方位角(°)", Shape_Leng: "形状长" },
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
    "Pb_transformall.json": {
      titleField: "Name",
      fields: null,
    },
    "Pb_trench.json": {
      titleField: "Name",
      fields: null,
    },
    // 板块
    "plate_cont.json": {
      titleField: "PlateName",
      fields: null,
    },
    "plate_ocean.json": {
      titleField: "PlateName",
      fields: null,
    },
    "plate16.json": {
      titleField: "PlateName",
      fields: null,
    },
    // 洋脊
    "ridgenew.json": {
      titleField: "Name",
      fields: null,
    },
    // LIP
    "LIP_Johansson.json": {
      titleField: "Name",
      fields: null,
    },
    // 默认：所有字段
    _default: {
      titleField: null,
      fields: null,
    },
  };

  // 跳过弹窗显示的字段
  const SKIP_FIELDS = new Set(["FID", "Shape_Length", "Shape_Area", "SHAPE_Leng", "SHAPE_Area"]);

  function buildPopupContent(feature, fileName) {
    if (!feature.properties) return null;
    const props = feature.properties;
    const keys = Object.keys(props);
    if (keys.length === 0) return null;

    const config = POPUP_FIELD_CONFIG[fileName] || POPUP_FIELD_CONFIG._default;
    let displayKeys;
    if (config.fields) {
      // 过滤掉不存在或空的字段
      displayKeys = config.fields.filter(k => props[k] !== undefined && props[k] !== null && props[k] !== "");
    } else {
      // 显示全部，跳过固定忽略字段
      displayKeys = keys.filter(k => !SKIP_FIELDS.has(k) && props[k] !== undefined && props[k] !== null && props[k] !== "");
    }

    if (displayKeys.length === 0) return null;

    // 如果有配置标题字段，先显示标题
    let titleHtml = "";
    if (config.titleField && props[config.titleField]) {
      titleHtml = `<div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:#2a6a2a;border-bottom:1px solid #eee;padding-bottom:3px;">${props[config.titleField]}</div>`;
    }

    const rows = displayKeys
      .filter(k => !config.titleField || k !== config.titleField) // 标题字段已单独展示，不重复
      .map(k => {
        const label = (config.labels && config.labels[k]) || k;
        let val = props[k];
        if (typeof val === "number") val = Number.isInteger(val) ? val : val.toFixed(4);
        return `<tr><td>${label}</td><td>${val}</td></tr>`;
      }).join("");

    return `<div class="feature-popup">${titleHtml}<table><tbody>${rows}</tbody></table></div>`;
  }

  // ========== 多边形分色 ==========
  function getPolygonFeatureColor(fileName, featureIndex) {
    const cfg = polygonColorConfig[fileName];
    if (!cfg) return null;
    if (cfg.mode === "sequential") {
      return getFeatureColor(featureIndex, 100);
    }
    return null;
  }

  // ========== 样式函数 ==========
  function getGeoJsonStyle(feature, checkboxId, fileName, featureIndex) {
    const mainColor = layerColorMap[checkboxId] || "#8B4513";
    const geomType = (feature.geometry?.type || "").toLowerCase();

    // 多边形分色
    const isPolygon = geomType === "polygon" || geomType === "multipolygon";
    let fillColor = mainColor;
    if (isPolygon && fileName) {
      const fc = getPolygonFeatureColor(fileName, featureIndex || 0);
      if (fc) fillColor = fc;
    }

    const baseStyle = {
      color: isPolygon ? "#555" : mainColor,
      fillColor: fillColor,
      weight: isPolygon ? 1 : 2,
      opacity: 0.8,
      fillOpacity: isPolygon ? 0.45 : 0.3,
      radius: 8,
    };

    switch (geomType) {
      case "point":
      case "multipoint":
        return { ...baseStyle, weight: 1, fillOpacity: 0.8 };
      case "linestring":
      case "multilinestring":
        return { ...baseStyle, fillOpacity: 0, weight: 2.5 };
      case "polygon":
      case "multipolygon":
        return baseStyle;
      default:
        return baseStyle;
    }
  }

  // ========== 热点五角星图标 ==========
  function createStarIcon(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <polygon points="10,1 12.9,7.1 19.5,7.6 14.7,12 16.2,18.5 10,15 3.8,18.5 5.3,12 0.5,7.6 7.1,7.1" 
        fill="${color}" fill-opacity="0.65" stroke="${color}" stroke-width="1.2" stroke-opacity="0.9"/>
    </svg>`;
    return L.divIcon({
      html: svg,
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10],
    });
  }

  // ========== onEachFeature：绑定弹窗（不再自动缩放）==========
  function onEachFeature(feature, layer, fileName) {
    const content = buildPopupContent(feature, fileName);
    if (content) {
      layer.bindPopup(content, { maxWidth: 300 });
    }
    // 移除点击自动缩放，改由"定位"按钮触发
  }

  // ========== 矢量世界副本：连续重复显示（同底图行为）==========
  // 对坐标环做经度偏移（+offset），生成偏移副本
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
        g.coordinates = g.coordinates.map(function (r) { return shiftRingCoords(r, offset); });
        break;
      case "MultiPolygon":
        g.coordinates = g.coordinates.map(function (poly) {
          return poly.map(function (r) { return shiftRingCoords(r, offset); });
        });
        break;
      default:
        break;
    }
    return g;
  }

  // 生成经度偏移后的 GeoJSON 数据副本（深拷贝，不污染原始数据）
  function shiftGeoJSON(geojsonData, offset) {
    // 始终深拷贝，避免三副本共享引用
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

  // 同步对齐相邻坐标点，避免跨子午线断线（对每个副本内部做展开）
  function fixRingCoords(coords) {
    if (!coords || coords.length === 0) return coords;
    const result = [coords[0].slice()];
    for (let i = 1; i < coords.length; i++) {
      const prev = result[i - 1];
      const cur = coords[i].slice();
      let dLng = cur[0] - prev[0];
      while (dLng > 180) { cur[0] -= 360; dLng = cur[0] - prev[0]; }
      while (dLng < -180) { cur[0] += 360; dLng = cur[0] - prev[0]; }
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
        geometry.coordinates = geometry.coordinates.map(function (rings) { return rings.map(fixRingCoords); });
        break;
      default:
        break;
    }
  }

  function fixAntimeridian(geojsonData) {
    if (!geojsonData) return geojsonData;
    const data = JSON.parse(JSON.stringify(geojsonData));
    if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
      data.features.forEach(function (f) { if (f.geometry) fixGeometryCoords(f.geometry); });
    } else if (data.type === "Feature" && data.geometry) {
      fixGeometryCoords(data.geometry);
    }
    return data;
  }

  // 创建带 L.geoJSON 参数的单份图层
  // 使用 feature._featureIndex 确保三副本颜色一致（基于原始索引而非遍历计数）
  function _buildSingleGeoJsonLayer(data, checkboxId, fileName, geoJsonOptions) {
    // 预处理：给每个要素打上 _featureIndex 标记（如果还没有）
    if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
      data.features.forEach(function (f, idx) { f._featureIndex = idx; });
    }
    return L.geoJSON(data, {
      style: function (feature) {
        const idx = feature._featureIndex || 0;
        return getGeoJsonStyle(feature, checkboxId, fileName, idx);
      },
      onEachFeature: function (feature, layer) { onEachFeature(feature, layer, fileName); },
      pointToLayer: function (feature, latlng) {
        const isHotspot = fileName === "hotspots.json";
        if (isHotspot) return L.marker(latlng, { icon: createStarIcon("red") });
        const idx = feature._featureIndex || 0;
        return L.circleMarker(latlng, getGeoJsonStyle(feature, checkboxId, fileName, idx));
      },
    });
  }

  /**
   * 创建连续重复的矢量图层组（-360°, 0°, +360° 三份副本）
   * 使矢量要素像底图瓦片一样在全球范围内连续显示
   * @param {Object} geojsonData - 原始 GeoJSON 数据（已 fixAntimeridian）
   * @param {string} checkboxId  - 图层 ID
   * @param {string} fileName    - 文件名（用于样式/弹窗配置）
   * @returns {L.LayerGroup}     - 包含三份副本的图层组
   */
  function buildWorldCopyLayerGroup(geojsonData, checkboxId, fileName) {
    const offsets = [-360, 0, 360];
    const subLayers = offsets.map(function (offset) {
      const shifted = shiftGeoJSON(geojsonData, offset);
      return _buildSingleGeoJsonLayer(shifted, checkboxId, fileName, {});
    });
    return L.layerGroup(subLayers);
  }

  // ========== 加载GeoJSON图层 ==========
  // layerCache[id] 存储的是 L.LayerGroup（包含 -360/0/+360 三份副本）
  // layerBoundsCache[id] 存储的是原始（0°）副本的 L.geoJSON，用于 getBounds 定位
  const layerBoundsCache = {};

  function loadGeoJSONLayer(filePath, checkboxId, fitBoundsAfterLoad) {
    if (layerCache[checkboxId]) {
      layerCache[checkboxId].addTo(map);
      if (fitBoundsAfterLoad) {
        try {
          const baseLayer = layerBoundsCache[checkboxId];
          if (baseLayer) {
            const bounds = baseLayer.getBounds();
            if (bounds.isValid()) optimizedFitBounds(bounds, { padding: [30, 30], animate: true });
          }
        } catch (e) {}
      }
      return;
    }

    const fileName = filePath.split("/").pop();

    fetch(filePath)
      .then(function (response) {
        if (!response.ok) throw new Error("加载" + filePath + "失败");
        return response.json();
      })
      .then(function (data) {
        // 先修正原始数据内部的跨子午线断线
        const fixedData = fixAntimeridian(data);

        // 创建三份世界副本图层组（实现连续重复，与底图行为一致）
        const worldCopyGroup = buildWorldCopyLayerGroup(fixedData, checkboxId, fileName);
        worldCopyGroup.addTo(map);
        layerCache[checkboxId] = worldCopyGroup;

        // 单独保留 0° 副本用于 getBounds 定位（不重复添加到地图）
        // 同样使用 _featureIndex 确保颜色一致
        if (fixedData.type === "FeatureCollection" && Array.isArray(fixedData.features)) {
          fixedData.features.forEach(function (f, idx) { f._featureIndex = idx; });
        }
        const baseGeoJson = L.geoJSON(fixedData, {
          style: function (feature) {
            const idx = feature._featureIndex || 0;
            return getGeoJsonStyle(feature, checkboxId, fileName, idx);
          },
          onEachFeature: function (feature, layer) { onEachFeature(feature, layer, fileName); },
          pointToLayer: function (feature, latlng) {
            const isHotspot = fileName === "hotspots.json";
            if (isHotspot) return L.marker(latlng, { icon: createStarIcon("red") });
            const idx = feature._featureIndex || 0;
            return L.circleMarker(latlng, getGeoJsonStyle(feature, checkboxId, fileName, idx));
          },
        });
        layerBoundsCache[checkboxId] = baseGeoJson;

        if (fitBoundsAfterLoad) {
          try {
            const bounds = baseGeoJson.getBounds();
            if (bounds.isValid()) {
              optimizedFitBounds(bounds, { padding: [6, 6], animate: true });
            }
          } catch (e) {}
        }
      })
      .catch(function (error) {
        console.error("GeoJSON加载失败：", error);
        alert("图层加载失败：" + filePath);
        const checkbox = document.getElementById(checkboxId);
        if (checkbox) {
          checkbox.checked = false;
          checkbox.style.background = "#fff";
        }
        syncSelectAllStatus();
        isMapZooming = false;
      });
  }

  function removeGeoJSONLayer(checkboxId) {
    if (layerCache[checkboxId]) {
      map.removeLayer(layerCache[checkboxId]);
    }
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) checkbox.style.background = "#fff";
  }

  // ========== 定位到图层（手动触发）==========
  function flyToLayer(checkboxId) {
    // 优先用 0° 副本的 bounds 定位，避免跳到偏移副本
    const baseLayer = layerBoundsCache[checkboxId] || layerCache[checkboxId];
    if (baseLayer) {
      try {
        const bounds = baseLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20], animate: true, maxZoom: 10 });
        }
      } catch (e) {
        console.warn("无法定位：", e);
      }
    }
  }

  // ========== 全开 / 全关 ==========
  function selectAllLayers() {
    document.querySelectorAll('.layer-item input[type="checkbox"]').forEach((checkbox) => {
      if (!checkbox.checked) {
        checkbox.checked = true;
        checkbox.style.background = layerColorMap[checkbox.id] || "#fff";
        loadGeoJSONLayer(checkbox.value, checkbox.id, false);
      }
    });
    syncAllGroupStatus();
  }

  function unselectAllLayers() {
    document.querySelectorAll('.layer-item input[type="checkbox"]').forEach((checkbox) => {
      if (checkbox.checked) {
        checkbox.checked = false;
        checkbox.style.background = "#fff";
        removeGeoJSONLayer(checkbox.id);
      }
    });
    syncAllGroupStatus();
  }

  // 同步某一分组的全选状态
  function syncGroupStatus(groupDiv) {
    const groupCb = groupDiv.querySelector(".group-select-all");
    if (!groupCb) return;
    const items = groupDiv.querySelectorAll('.layer-item input[type="checkbox"]');
    const checkedCount = Array.from(items).filter(c => c.checked).length;
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

  // 同步所有组 + 顶部全选状态
  function syncAllGroupStatus() {
    document.querySelectorAll(".layer-group").forEach(syncGroupStatus);
    syncSelectAllStatus();
  }

  function syncSelectAllStatus() {
    if (!selectAllCheckbox) return;
    const all = Array.from(document.querySelectorAll('.layer-item input[type="checkbox"]'));
    const checkedCount = all.filter(c => c.checked).length;
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

  // ========== 生成分组图层面板 ==========
  let globalLayerIndex = 0;

  function generateLayerItems() {
    const container = document.getElementById("layerItemsContainer");

    geoJsonGroups.forEach((group, gi) => {
      const groupDiv = document.createElement("div");
      groupDiv.className = "layer-group";

      // 组头
      const header = document.createElement("div");
      header.className = "layer-group-header";

      // 展开箭头
      const arrow = document.createElement("span");
      arrow.className = "layer-group-arrow";
      arrow.textContent = "▶";

      // 组名
      const groupName = document.createElement("span");
      groupName.className = "layer-group-name";
      groupName.textContent = group.groupName;

      // 组级全选复选框（点击不要展开/折叠）
      const groupCb = document.createElement("input");
      groupCb.type = "checkbox";
      groupCb.className = "group-select-all";
      groupCb.title = `全选/全不选「${group.groupName}」`;
      groupCb.addEventListener("click", (e) => {
        e.stopPropagation(); // 防止触发组折叠
      });
      groupCb.addEventListener("change", function () {
        this.classList.remove("indeterminate");
        const items = groupDiv.querySelectorAll('.layer-item input[type="checkbox"]');
        items.forEach(cb => {
          if (this.checked && !cb.checked) {
            cb.checked = true;
            cb.style.background = layerColorMap[cb.id] || "#fff";
            loadGeoJSONLayer(cb.value, cb.id, false);
          } else if (!this.checked && cb.checked) {
            cb.checked = false;
            cb.style.background = "#fff";
            removeGeoJSONLayer(cb.id);
          }
        });
        syncSelectAllStatus();
      });

      // 子项容器（默认折叠）
      const children = document.createElement("div");
      children.className = "layer-group-children";

      // 点击组头（箭头或名称区域）展开/折叠
      header.addEventListener("click", (e) => {
        // 点到复选框时不触发折叠
        if (e.target === groupCb) return;
        const isOpen = children.classList.toggle("open");
        arrow.classList.toggle("open", isOpen);
      });

      header.appendChild(arrow);
      header.appendChild(groupName);
      header.appendChild(groupCb);

      group.layers.forEach((layerConfig) => {
        const index = globalLayerIndex++;
        const checkboxId = `layer_${index}`;
        const fullPath = `${geoJsonBasePath}${layerConfig.file}`;
        const fixedColor = getFixedColor(index);
        layerColorMap[checkboxId] = fixedColor;

        const layerItem = document.createElement("div");
        layerItem.className = "layer-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = checkboxId;
        checkbox.value = fullPath;
        checkbox.dataset.layerName = layerConfig.name;
        checkbox.style.setProperty("--layer-color", fixedColor);
        checkbox.addEventListener("change", function () {
          this.style.background = this.checked ? fixedColor : "#fff";
          syncAllGroupStatus();
          if (this.checked) loadGeoJSONLayer(fullPath, checkboxId, false);
          else removeGeoJSONLayer(checkboxId);
        });

        const label = document.createElement("label");
        label.htmlFor = checkboxId;
        label.textContent = layerConfig.name;
        label.title = layerConfig.name;

        // 定位按钮
        const locateBtn = document.createElement("button");
        locateBtn.className = "layer-locate-btn";
        locateBtn.title = "定位到此图层";
        locateBtn.innerHTML = "⊕";
        locateBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          flyToLayer(checkboxId);
        });

        layerItem.appendChild(checkbox);
        layerItem.appendChild(label);
        layerItem.appendChild(locateBtn);
        children.appendChild(layerItem);
      });

      groupDiv.appendChild(header);
      groupDiv.appendChild(children);
      container.appendChild(groupDiv);
    });

    // ========== 用户上传图层区 ==========
    const userGroup = document.createElement("div");
    userGroup.id = "userLayerGroup";
    userGroup.innerHTML = `<div style="font-size:12px;color:#888;padding:0 10px 4px;">用户上传图层</div>`;
    container.appendChild(userGroup);

    // ========== 上传按钮 ==========
    const uploadDiv = document.createElement("div");
    uploadDiv.style.padding = "10px";
    uploadDiv.style.borderTop = "1px dashed #ccc";
    uploadDiv.style.marginTop = "8px";

    const uploadBtn = document.createElement("button");
    uploadBtn.textContent = "📂 上传 GeoJSON";
    uploadBtn.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      background: #f0f7f0;
      border: 1px solid #99cc99;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      color: #3a7a3a;
      transition: background 0.15s;
    `;
    uploadBtn.onmouseover = () => uploadBtn.style.background = "#e2f0e2";
    uploadBtn.onmouseout = () => uploadBtn.style.background = "#f0f7f0";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".geojson,.json";
    fileInput.multiple = true;
    fileInput.style.display = "none";

    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", handleFileUpload);

    uploadDiv.appendChild(uploadBtn);
    uploadDiv.appendChild(fileInput);
    container.appendChild(uploadDiv);
  }

  // ========== 文件上传处理 ==========
  function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    e.target.value = ""; // 允许重复上传

    files.forEach(function (file) {
      const reader = new FileReader();
      reader.onload = function (ev) {
        try {
          const data = JSON.parse(ev.target.result);
          addUserLayer(data, file.name);
        } catch (err) {
          alert("文件解析失败：" + file.name + "\n" + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  // ========== 用户上传GeoJSON ==========
  let userLayerIndex = 0;

  function addUserLayer(geojsonData, fileName) {
    const uid = `user_layer_${userLayerIndex++}`;
    const fixedColor = getFixedColor(globalLayerIndex++);
    layerColorMap[uid] = fixedColor;

    // 修正原始数据内部的跨子午线断线
    const fixedData = fixAntimeridian(geojsonData);

    // 创建三份世界副本图层组，实现连续重复显示
    const worldCopyGroup = buildWorldCopyLayerGroup(fixedData, uid, fileName);
    worldCopyGroup.addTo(map);
    layerCache[uid] = worldCopyGroup;

    // 保留 0° 副本用于 getBounds 定位
    // 同样使用 _featureIndex 确保颜色一致
    if (fixedData.type === "FeatureCollection" && Array.isArray(fixedData.features)) {
      fixedData.features.forEach(function (f, idx) { f._featureIndex = idx; });
    }
    const baseGeoJson = L.geoJSON(fixedData, {
      style: function (feature) {
        const idx = feature._featureIndex || 0;
        return getGeoJsonStyle(feature, uid, fileName, idx);
      },
      onEachFeature: function (feature, layer) { onEachFeature(feature, layer, fileName); },
      pointToLayer: function (feature, latlng) {
        const idx = feature._featureIndex || 0;
        return L.circleMarker(latlng, getGeoJsonStyle(feature, uid, fileName, idx));
      },
    });
    layerBoundsCache[uid] = baseGeoJson;

    // 自动缩放到上传图层
    try {
      const bounds = baseGeoJson.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20], animate: true, maxZoom: 12 });
    } catch (e) {}

    // 在用户图层区域添加控制项
    const userGroup = document.getElementById("userLayerGroup");
    const layerItem = document.createElement("div");
    layerItem.className = "layer-item";

    const checkbox = document.createElement("input");
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

    const label = document.createElement("label");
    label.htmlFor = uid;
    label.textContent = fileName;
    label.title = fileName;

    const locateBtn = document.createElement("button");
    locateBtn.className = "layer-locate-btn";
    locateBtn.title = "定位到此图层";
    locateBtn.innerHTML = "⊕";
    locateBtn.addEventListener("click", function () { flyToLayer(uid); });

    const removeBtn = document.createElement("button");
    removeBtn.className = "layer-locate-btn";
    removeBtn.title = "删除此图层";
    removeBtn.innerHTML = "✕";
    removeBtn.style.color = "#cc6666";
    removeBtn.addEventListener("click", function () {
      if (layerCache[uid]) map.removeLayer(layerCache[uid]);
      delete layerCache[uid];
      delete layerBoundsCache[uid];
      layerItem.remove();
    });

    layerItem.appendChild(checkbox);
    layerItem.appendChild(label);
    layerItem.appendChild(locateBtn);
    layerItem.appendChild(removeBtn);
    userGroup.appendChild(layerItem);
  }

  // 暴露 addUserLayer 到全局
  window.addUserLayer = addUserLayer;

  // ========== 初始化 ==========
  function initGeoJsonLayer() {
    generateLayerItems();
  }

  window.addEventListener("load", initGeoJsonLayer);
});
