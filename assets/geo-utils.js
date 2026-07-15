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
          let t = geom.type.toLowerCase();
          // GeometryCollection：递归统计子几何类型（KML MultiGeometry）
          if (t === "geometrycollection" && Array.isArray(geom.geometries)) {
            geom.geometries.forEach(function (g) {
              if (g && g.type) {
                const sub = g.type.toLowerCase();
                typeCount[sub] = (typeCount[sub] || 0) + 1;
              }
            });
          } else {
            typeCount[t] = (typeCount[t] || 0) + 1;
          }
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
  function buildPopupContent(feature, fileName, titleField, layerDisplayName) {
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
    // 标题行：优先用传入的 titleField，其次配置的 titleField，最后自动检测 Name 字段
    let titleHtml = "";
    let titleKey = titleField || config.titleField || null;
    if (!titleKey) {
      // 不区分大小写查找 name 字段
      const nameKey = keys.find((k) => k.toLowerCase() === "name");
      if (nameKey && props[nameKey] != null && props[nameKey] !== "") {
        titleKey = nameKey;
      }
    }
    if (titleKey && props[titleKey] != null && props[titleKey] !== "") {
      titleHtml = `<div class="feature-popup-title">${props[titleKey]}</div>`;
    }
    // 字段行（不过滤标题字段，全部罗列）
    const rows = displayKeys
      .map((k) => {
        let val = props[k];
        if (typeof val === "number")
          val = Number.isInteger(val) ? val : val.toFixed(4);
        return `<tr><td>${k}</td><td>${val}</td></tr>`;
      })
      .join("");

    return `<div class="feature-popup">${titleHtml}<div class="feature-popup-body"><table><tbody>${rows}</tbody></table></div>${
      layerDisplayName
        ? `<div class="feature-popup-footer">📂 ${layerDisplayName}</div>`
        : ""
    }</div>`;
  }
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
      case "GeometryCollection":
        // KML 的 <MultiGeometry> 会被 toGeoJSON 转为此类型
        if (Array.isArray(g.geometries)) {
          g.geometries = g.geometries.map(function (geom) {
            return shiftGeometry(geom, offset);
          });
        }
        break;
      default:
        break;
    }
    return g;
  }

  function shiftGeoJSON(geojsonData, offset) {
    // offset=0 时无需拷贝，直接返回原对象（避免 45 万点深拷贝炸内存）
    if (offset === 0) return geojsonData;
    const data = JSON.parse(JSON.stringify(geojsonData));
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
    // 直接在原对象上修正，不再深拷贝（避免 45 万点炸内存）
    // 注意：geojsonData 来自 IDB 缓存的副本，修改不影响 IDB 存储
    if (
      geojsonData.type === "FeatureCollection" &&
      Array.isArray(geojsonData.features)
    ) {
      geojsonData.features.forEach(function (f) {
        if (f.geometry) fixGeometryCoords(f.geometry);
      });
    } else if (geojsonData.type === "Feature" && geojsonData.geometry) {
      fixGeometryCoords(geojsonData.geometry);
    }
    return geojsonData;
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

  // ========== 直接根据 GeoJSON 计算 bounds（不构建 Layer，避免大数据内存爆炸）==========
  function computeBounds(geojsonData) {
    if (!geojsonData || !geojsonData.features) return null;
    var bounds = null;

    geojsonData.features.forEach(function (f) {
      if (!f || !f.geometry || !f.geometry.coordinates) return;
      var coords = f.geometry.coordinates;
      var geomType = (f.geometry.type || "").toLowerCase();

      function extendByPoint(lng, lat) {
        if (bounds === null) {
          bounds = L.latLngBounds([lat, lng], [lat, lng]);
        } else {
          bounds.extend([lat, lng]);
        }
      }

      function processCoords(c, type) {
        if (!c || !c.length) return;
        if (type === "point" || type === "multipoint") {
          if (typeof c[0] === "number") {
            extendByPoint(c[0], c[1]);
          } else {
            c.forEach(function (p) {
              extendByPoint(p[0], p[1]);
            });
          }
        } else if (type === "linestring" || type === "multilinestring") {
          if (typeof c[0][0] === "number") {
            c.forEach(function (p) {
              extendByPoint(p[0], p[1]);
            });
          } else {
            c.forEach(function (line) {
              line.forEach(function (p) {
                extendByPoint(p[0], p[1]);
              });
            });
          }
        } else if (type === "polygon" || type === "multipolygon") {
          var rings = type === "polygon" ? c : c[0];
          if (rings && rings[0] && typeof rings[0][0] === "number") {
            // Polygon with single ring
            rings.forEach(function (p) {
              extendByPoint(p[0], p[1]);
            });
          } else {
            rings.forEach(function (ring) {
              ring.forEach(function (p) {
                extendByPoint(p[0], p[1]);
              });
            });
          }
        }
      }

      processCoords(coords, geomType);
    });

    return bounds;
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
    POPUP_FIELD_CONFIG,
    computeBounds,
  };
})();
