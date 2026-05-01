/**
 * geo-utils.js
 * 纯函数工具库，无外部依赖（不依赖 Leaflet 或 map）
 * 通过全局 GeoUtils 对象暴露
 */
(function () {
  "use strict";

  // ========== 固定随机种子 ==========
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

  // ========== 固定颜色（按索引） ==========
  function getFixedColor(index) {
    const random = createFixedSeededRandom(12230916);
    for (let i = 0; i < index; i++) random();
    const r = Math.floor(random() * 256);
    const g = Math.floor(random() * 256);
    const b = Math.floor(random() * 256);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // ========== HSL 颜色（黄金角分布） ==========
  function getFeatureColorByIndex(featureIndex) {
    const hue = Math.round((featureIndex * 137.508) % 360);
    const sat = 60 + (featureIndex % 3) * 10;
    const lig = 40 + (featureIndex % 4) * 5;
    return `hsl(${hue},${sat}%,${lig}%)`;
  }

  // ========== 按属性字段值生成颜色 ==========
  const _fieldColorPalette = {};

  function getFeatureColorByField(props, fk, featureIndex) {
    if (!_fieldColorPalette[fk]) _fieldColorPalette[fk] = {};
    const val = props[fk] != null ? String(props[fk]) : "__null__";
    if (!_fieldColorPalette[fk][val]) {
      const hash = createFixedSeededRandom(
        fk.charCodeAt(0) * 1000 + featureIndex,
      );
      const r = Math.floor(hash() * 256);
      const g = Math.floor(hash() * 256);
      const b = Math.floor(hash() * 256);
      _fieldColorPalette[fk][val] = `rgb(${r},${g},${b})`;
    }
    return _fieldColorPalette[fk][val];
  }

  // ========== 检测 GeoJSON 主要几何类型 ==========
  function detectMainGeomType(geojsonData) {
    if (!geojsonData) return "unknown";
    if (geojsonData.type === "Feature" && geojsonData.geometry) {
      return geojsonData.geometry.type || "unknown";
    }
    if (
      geojsonData.type === "FeatureCollection" &&
      Array.isArray(geojsonData.features)
    ) {
      const typeCount = {};
      for (let i = 0; i < geojsonData.features.length; i++) {
        const geom = geojsonData.features[i].geometry;
        if (geom && geom.type) {
          const t = geom.type.toLowerCase();
          typeCount[t] = (typeCount[t] || 0) + 1;
        }
      }
      if (typeCount["polygon"] || typeCount["multipolygon"]) return "polygon";
      if (typeCount["linestring"] || typeCount["multilinestring"])
        return "linestring";
      if (typeCount["point"] || typeCount["multipoint"]) return "point";
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

  // ========== 弹窗字段配置（默认全部字段展示，不预设）==========
  const POPUP_FIELD_CONFIG = {
    // titleField: 显示为标题的字段（可选）
    _default: { titleField: null },
  };

  // ========== 构建弹窗内容 ==========
  function buildPopupContent(feature, fileName) {
    if (!feature.properties) return null;
    const props = feature.properties;
    const keys = Object.keys(props);
    if (keys.length === 0) return null;
    const config = POPUP_FIELD_CONFIG[fileName] || POPUP_FIELD_CONFIG._default;
    // 过滤空值和非数据字段（不跳过任何 key）
    const displayKeys = keys.filter(
      (k) =>
        props[k] !== undefined &&
        props[k] !== null &&
        props[k] !== "" &&
        typeof props[k] !== "object",
    );
    if (displayKeys.length === 0) return null;
    // 标题行
    let titleHtml = "";
    if (config.titleField && props[config.titleField]) {
      titleHtml = `<div style="font-weight:bold;font-size:13px;margin-bottom:4px;color:#2a6a2a;border-bottom:1px solid #eee;padding-bottom:3px;">${props[config.titleField]}</div>`;
    }
    // 字段行
    const rows = displayKeys
      .filter((k) => !config.titleField || k !== config.titleField)
      .map((k) => {
        let val = props[k];
        if (typeof val === "number")
          val = Number.isInteger(val) ? val : val.toFixed(4);
        return `<tr><td>${k}</td><td>${val}</td></tr>`;
      })
      .join("");
    return `<div class="feature-popup">${titleHtml}<table><tbody>${rows}</tbody></table></div>`;
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
   * fixRingCoords - "展开"策略：消除相邻点之间的 >180° 跳变
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

  // ========== 获取可用属性字段 ==========
  function getAvailableFields(geojsonData) {
    const fieldSet = new Set();
    if (
      geojsonData.type === "FeatureCollection" &&
      Array.isArray(geojsonData.features)
    ) {
      geojsonData.features.slice(0, 50).forEach(function (f) {
        if (f.properties) {
          Object.keys(f.properties).forEach(function (k) {
            if (typeof f.properties[k] !== "object") {
              fieldSet.add(k);
            }
          });
        }
      });
    }
    return Array.from(fieldSet).sort();
  }

  // ========== 标签配置 ==========
  const STATION_LABEL_CONFIG = {
    "DSDP.geojson": { field: "Hole" },
    "ODP.geojson": { field: "Fullname" },
    "IODP03-13.geojson": { field: "Name" },
    "IODP13-26.geojson": { field: "site" },
  };

  function isStationFile(fileName) {
    return !!STATION_LABEL_CONFIG[fileName];
  }

  function getStationLabel(feature, fileName) {
    const cfg = STATION_LABEL_CONFIG[fileName];
    if (!cfg || !feature.properties) return null;
    return feature.properties[cfg.field] || null;
  }

  // ========== 暴露公共 API ==========
  window.GeoUtils = {
    createFixedSeededRandom,
    getFixedColor,
    getFeatureColorByIndex,
    getFeatureColorByField,
    detectMainGeomType,
    buildPopupContent,
    buildHighlightStyle,
    shiftGeoJSON,
    fixAntimeridian,
    fixGeometryCoords,
    getAvailableFields,
    isStationFile,
    getStationLabel,
    STATION_LABEL_CONFIG,
    POPUP_FIELD_CONFIG,
  };
})();
