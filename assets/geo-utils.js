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

  // ========== 弹窗值的渲染策略（安全 + 可读）==========
  //
  // ⚠️ 为什么数据值必须当纯文本渲染 —— 这不是洁癖，是修过的真 bug：
  //   平台数据来自 SHP / KML / ArcGIS 导出，某些字段整段就是 HTML。
  //   实例：volcanos.geojson 的 LAYER 字段 = 被 DBF 255 字符截断的 KML <table>，
  //   末尾停在 `<td colspan`（标签从未闭合，1293 个要素的值完全相同）。
  //   它被直接拼进 innerHTML 后，浏览器照 HTML 解析，实测三个后果：
  //     ① 未闭合标签「吃掉」了其后的标记 —— .popup-ext-btn-wrap 被解析进 <td> 内
  //        （祖先链 TD < TR < TBODY < TABLE），「缩放至 / 详情」跑到错误位置，
  //        连后面的字段行、图层脚注都并进了同一个单元格；
  //     ② 字段里的 <img> 会真的发请求（外链 / http 明文 → DNS 失败报错、拖慢）；
  //     ③ 等于把数据当代码执行（XSS 面）。
  //   因此：值一律转义；含标签的值先剥成可读文本；剥完全是空的字段整行不渲染。
  //   这是渲染不变量（数据不是代码），不做成开关。
  const POPUP_VALUE_MAX = 200; // 单元格文本上限，超出截断（完整值进 title 悬停提示）
  const POPUP_TITLE_MAX = 120; // 标题同理，但要更短

  const HTML_LIKE_RE = /<\/?[a-zA-Z][^>]*>?/; // 含「有头无尾」的截断标签
  const HTML_TAG_STRIP_RE = /<\/?[a-zA-Z][^>]*>?/g;
  // 行内标签剥掉时不留空格，否则 `<b>粗体</b>说明` 会变成「粗体 说明」；
  // 块级/表格标签则用空格分隔，避免 `<td>a</td><td>b</td>` 粘成「ab」
  const HTML_INLINE_TAG_RE =
    /<\/?(?:a|abbr|b|bdi|bdo|cite|code|em|font|i|kbd|label|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)\b[^>]*>?/gi;
  const HTML_ENTITIES = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
  };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  // 属性值 → { text, full, truncated }，text/full 均已转义、可直接入 HTML。
  // 返回 null 表示「剥完标签后没有内容」（纯样板标记），调用方应跳过该行。
  function toPopupCell(value, maxLen) {
    let text = String(value);
    if (HTML_LIKE_RE.test(text)) {
      text = text.replace(HTML_INLINE_TAG_RE, "");
      text = text.replace(HTML_TAG_STRIP_RE, " ");
      Object.keys(HTML_ENTITIES).forEach(function (entity) {
        text = text.split(entity).join(HTML_ENTITIES[entity]);
      });
    }
    text = text.replace(/\s+/g, " ").trim(); // 折叠空白：数据里的换行只会把弹窗撑高
    if (!text) return null;
    const limit =
      typeof maxLen === "number" && maxLen > 0 ? maxLen : POPUP_VALUE_MAX;
    if (text.length > limit) {
      return {
        text: escapeHtml(text.slice(0, limit)) + "…",
        full: escapeHtml(text),
        truncated: true,
      };
    }
    return { text: escapeHtml(text), full: "", truncated: false };
  }

  // ========== 图层级弹窗配置（来自 geo-config.js 的 layer.popup）==========
  // 为什么不走参数传递：buildPopupContent 有 10 个调用点（geojsonloader 8 处、
  //   index.html 内联图层、cesium-viewer），逐个加参数迟早漏一个；而配置是全局
  //   唯一来源，按 file 查一次即对所有渲染路径生效。
  // 支持的键（都可省）：
  //   titleField      标题字段（调用方未传 labelField 时生效）
  //   hideFields[]    不展示的字段名（大小写不敏感），用于屏蔽导出产生的无用列
  //   maxValueLength  单元格文本上限，0/缺省 = POPUP_VALUE_MAX
  let _popupCfgMap = null;
  let _popupCfgSrc = null;
  function getLayerPopupConfig(fileName) {
    const groups = window.geoJsonGroups;
    if (!fileName || !Array.isArray(groups)) return null;
    if (_popupCfgSrc !== groups) {
      // 清单被整体替换时重建索引（只重建一次，不是每次调用都扫）
      _popupCfgMap = Object.create(null);
      groups.forEach(function (group) {
        (group.layers || []).forEach(function (layer) {
          if (layer && layer.file && layer.popup && !_popupCfgMap[layer.file]) {
            _popupCfgMap[layer.file] = layer.popup;
          }
        });
      });
      _popupCfgSrc = groups;
    }
    return _popupCfgMap[fileName] || null;
  }

  // ========== 构建弹窗内容 ==========
  function buildPopupContent(feature, fileName, titleField, layerDisplayName) {
    if (!feature.properties) return null;
    const props = feature.properties;
    const keys = Object.keys(props);
    if (keys.length === 0) return null;
    const layerCfg = getLayerPopupConfig(fileName) || {};
    const hideFields = (
      Array.isArray(layerCfg.hideFields) ? layerCfg.hideFields : []
    ).map(function (f) {
      return String(f).toLowerCase();
    });
    // 过滤空值与配置要求隐藏的字段（_featureIndex 保留在最后，object/array 用 JSON 字符串展示）
    const displayKeys = keys.filter(
      (k) =>
        hideFields.indexOf(k.toLowerCase()) === -1 &&
        props[k] !== undefined &&
        props[k] !== null &&
        props[k] !== "",
    );
    if (displayKeys.length === 0) return null;
    // 标题行：优先用传入的 titleField（= 图层的 labelField），
    // 其次图层的 popup.titleField，最后自动检测 Name 字段
    let titleHtml = "";
    let titleKey = titleField || layerCfg.titleField || null;
    if (!titleKey) {
      // 不区分大小写查找 name 字段
      const nameKey = keys.find((k) => k.toLowerCase() === "name");
      if (nameKey && props[nameKey] != null && props[nameKey] !== "") {
        titleKey = nameKey;
      }
    }
    if (titleKey && props[titleKey] != null && props[titleKey] !== "") {
      const t = toPopupCell(props[titleKey], POPUP_TITLE_MAX);
      if (t) {
        titleHtml = `<div class="feature-popup-title"${
          t.truncated ? ` title="${t.full}"` : ""
        }>${t.text}</div>`;
      }
    }
    // 字段行（不过滤标题字段，全部罗列；纯标记字段整行跳过）
    const rows = displayKeys
      .map((k) => {
        let val = props[k];
        if (typeof val === "number")
          val = Number.isInteger(val) ? val : val.toFixed(4);
        else if (typeof val === "object" && val !== null)
          val = JSON.stringify(val);
        const cell = toPopupCell(val, layerCfg.maxValueLength);
        if (!cell) return "";
        return `<tr><td>${escapeHtml(k)}</td><td${
          cell.truncated ? ` title="${cell.full}"` : ""
        }>${cell.text}</td></tr>`;
      })
      .join("");

    return `<div class="feature-popup">${titleHtml}<div class="feature-popup-body"><table><tbody>${rows}</tbody></table></div>${
      layerDisplayName
        ? `<div class="feature-popup-footer">📂 ${escapeHtml(layerDisplayName)}</div>`
        : ""
    }<div class="popup-ext-btn-wrap"><button class="popup-ext-btn" data-act="zoom">⚲ 缩放至</button><button class="popup-ext-btn popup-detail-btn" data-act="detail">📋 详情</button></div></div>`;
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
   *
   * ⚠️ 极冠环必须原样返回，不能展开（见 POLAR_RING_LAT 的说明）。
   */
  // 含此纬度以上顶点的环 = 「极冠环」（沿 ±180° 切开、靠极点段闭合的那种）。
  // 87 取在「真正的极冠」与「北极圈内普通地形」（格陵兰最北约 83.6°）之间。
  const POLAR_RING_LAT = 87;

  function fixRingCoords(coords) {
    if (!coords || coords.length === 0) return coords;

    // ── 极冠环：原样返回 ────────────────────────────────────────────
    // 这类环是「沿 ±180° 切开」的写法，靠一段横躺在极点上的顶点把环闭合，例如：
    //   … (-179.999,-89.999) → (-110,-89.999) → (179.999,-89.999) → (179.999,-88.73) …
    // Web Mercator 把 |lat|>85.051 钳到 ±85.051，所以那一段会**正好躺在地图上下边**
    // 上横贯一整圈 —— 环于是就着地图边闭合，极冠被完整填充。
    //
    // 一旦对它做「展开」：-(110)→(179.999) 这一步是 290° 跳变，会被折算成 -70°，
    // 于是极点段被折叠成原地往返的零面积尖刺，环改成走一条**横贯地图的弦**闭合；
    // SVG 按非零环绕填充时自我抵消，极冠整块消失。
    // 实测（plate16 南极冠 913 点环，6 个采样点）：
    //   原样        → 6/6 命中（罗斯海、威德尔海、南极点 都在填充内）
    //   展开后      → 1/6 命中
    //   北极 plate_ocean #61（环跨 385.6°，自交）同理：3/6 → 1/6
    // 极冠环本来就已在 ±180° 处切开，不存在需要展开的跳变，跳过它对其它几何无影响。
    for (let k = 0; k < coords.length; k++) {
      const c = coords[k];
      if (c && Math.abs(c[1]) >= POLAR_RING_LAT) return coords;
    }

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
          // Polygon:     coords = [ring, ring, ...]
          // MultiPolygon: coords = [ [ring, ring], [ring, ring], ... ]
          // 注意：MultiPolygon 必须遍历全部子多边形，否则只会框住第一个子面
          var polygons = type === "polygon" ? [c] : c;
          polygons.forEach(function (poly) {
            if (!poly || !poly.length) return;
            poly.forEach(function (ring) {
              if (!ring || !ring.length) return;
              ring.forEach(function (p) {
                if (p && typeof p[0] === "number" && typeof p[1] === "number")
                  extendByPoint(p[0], p[1]);
              });
            });
          });
        }
      }

      processCoords(coords, geomType);
    });

    return bounds;
  }

  // ========== 获取字段颜色调色板（供图例等外部组件使用）==========
  function getFieldColorPalette(fk) {
    if (!fk || !_fieldColorPalette[fk]) return {};
    // 返回浅拷贝，防止外部修改内部状态
    var copy = {};
    for (var k in _fieldColorPalette[fk]) {
      if (_fieldColorPalette[fk].hasOwnProperty(k)) {
        copy[k] = _fieldColorPalette[fk][k];
      }
    }
    return copy;
  }

  // ========== 提取数值字段（供图表使用） ==========
  function extractNumericFields(feature) {
    if (!feature || !feature.properties) return [];
    const props = feature.properties;
    const numericFields = [];
    const excludeKeys = ["_featureIndex"];
    for (const k of Object.keys(props)) {
      if (excludeKeys.includes(k)) continue;
      const v = props[k];
      if (typeof v === "number" && isFinite(v)) {
        numericFields.push({ key: k, value: v });
      }
    }
    // 按绝对值降序排列
    numericFields.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return numericFields;
  }

  // ========== 计算图层数值字段统计（供图表对比） ==========
  function computeLayerStats(features) {
    if (!features || !features.length) return null;
    // 收集所有数值字段
    const fieldSums = {}; // key -> sum
    const fieldCounts = {}; // key -> count
    for (const f of features) {
      if (!f || !f.properties) continue;
      for (const k of Object.keys(f.properties)) {
        const v = f.properties[k];
        if (typeof v === "number" && isFinite(v) && k !== "_featureIndex") {
          fieldSums[k] = (fieldSums[k] || 0) + v;
          fieldCounts[k] = (fieldCounts[k] || 0) + 1;
        }
      }
    }
    const averages = {};
    for (const k of Object.keys(fieldSums)) {
      if (fieldCounts[k] > 0) {
        averages[k] = fieldSums[k] / fieldCounts[k];
      }
    }
    return averages;
  }

  // ==================================================================
  // 本地存储层（唯一入口 + 故障自愈）
  // ------------------------------------------------------------------
  // ① 所有 key 集中在这张表 —— 业务代码里不再散落字面量，杜绝「同一个键
  //    多处手写、改一处漏一处」
  // ② 物理键名保持不变：dupal_ / ogv_ 混用是历史包袱，但改名会让已激活用户的
  //    ogv_premium_active 凭空消失（无后端，不可恢复），所以只统一「代码侧命名」。
  //    新增键一律用 dupl 前缀。
  // ③ safe* 一律吞异常：Safari 隐私模式 / 配额满会抛 QuotaExceededError，裸
  //    setItem 抛出去会中断其后的业务（如开关的 enable/disable、图层初始化）
  // ④ getJSON 解析失败即删键并返回兜底 —— 「读-改-写」型持久化若不自愈，会
  //    从此永久写不进去（覆盖层勾选曾整类静默失效）
  // ⑤ 绝不用 localStorage.clear()：它按 origin 清，会连带清掉同域其他页面的
  //    数据，还会删掉用户上传图层的清单，让 IndexedDB 里的数据变成永久孤儿
  // ==================================================================
  var OGVStorage = (function () {
    var PREFIX = "dupal_";

    var K = {
      // --- ogv_ 命名空间（历史遗留，物理名不可改）---
      PREMIUM: "ogv_premium_active",
      FEATURE_PANEL_WIDTH: "ogv_feature_panel_width",
      // --- 界面状态 ---
      SIDEBAR_PINNED: PREFIX + "sidebar_pinned",
      PANEL_WIDTH: PREFIX + "panel_width",
      MAP_STATE: PREFIX + "map_state",
      DETAILS_OPEN: PREFIX + "details_open_",
      // --- 开关类（TOGGLE + 控件 id）---
      TOGGLE: PREFIX + "toggle_",
      CLUSTER: PREFIX + "cluster_enabled",
      LABEL: PREFIX + "label_enabled",
      // --- 图层 ---
      LAYER_CHECK: PREFIX + "layer_",
      LAYER_SETTINGS: PREFIX + "layer_set_",
      USER_LAYER_CHECK: PREFIX + "user_layer_",
      USER_LAYER_LIST: PREFIX + "user_layers",
      // --- 底图 ---
      BASEMAP: PREFIX + "basemap",
      OVERLAYS: PREFIX + "overlays",
      WAYBACK_RELEASE: PREFIX + "wayback_release",
      // --- 极地投影视图 ---
      POLAR_MODE: PREFIX + "polar_mode", // north / south
      POLAR_BASEMAP: PREFIX + "polar_basemap",
    };

    // 本应用的键前缀（清理时只动这些，不碰同域其他页面）
    var OWN_PREFIXES = [PREFIX, "ogv_"];

    // 启动时清理的废弃键
    var OBSOLETE_KEYS = [PREFIX + "toggle_sectionOpen", PREFIX + "premium"];

    // 「用户资产」：任何清理都不该动
    //   PREMIUM          = 激活态（丢了要重新输码）
    //   USER_LAYER_LIST  = 用户上传图层清单（丢了 IDB 数据就成孤儿）
    //   USER_LAYER_CHECK = 用户上传图层的开关（丢了恢复后全部默认不勾选）
    var ASSET_KEYS = [K.PREMIUM, K.USER_LAYER_LIST];
    var ASSET_PREFIXES = [K.USER_LAYER_CHECK];

    function _ls() {
      try {
        return window.localStorage || null;
      } catch (e) {
        return null; // 某些环境下访问 localStorage 本身就抛 SecurityError
      }
    }
    function _isOwn(key) {
      return OWN_PREFIXES.some(function (p) {
        return key.indexOf(p) === 0;
      });
    }
    function _isAsset(key) {
      if (ASSET_KEYS.indexOf(key) !== -1) return true;
      return ASSET_PREFIXES.some(function (p) {
        return key.indexOf(p) === 0;
      });
    }
    // 快照所有键（⚠️ 不要边遍历 localStorage.length 边删 —— 正序删除会跳项）
    function _snapshot() {
      var out = [];
      try {
        var ls = _ls();
        if (!ls) return out;
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (k) out.push(k);
        }
      } catch (e) {}
      return out;
    }

    function safeGet(key) {
      try {
        var ls = _ls();
        return ls ? ls.getItem(key) : null;
      } catch (e) {
        return null;
      }
    }
    function safeSet(key, value) {
      try {
        var ls = _ls();
        if (!ls) return false;
        ls.setItem(key, String(value));
        return true;
      } catch (e) {
        return false;
      }
    }
    function safeRemove(key) {
      try {
        var ls = _ls();
        if (!ls) return false;
        ls.removeItem(key);
        return true;
      } catch (e) {
        return false;
      }
    }
    // 读布尔：无值 → def；"true" → true；其余 → false
    function getBool(key, def) {
      var v = safeGet(key);
      return v === null ? !!def : v === "true";
    }
    // 读数字：非法值（Number("abc") = NaN）一律回退默认
    function getNum(key, def) {
      var v = safeGet(key);
      if (v === null) return def;
      var n = Number(v);
      return isFinite(n) ? n : def;
    }
    // 读 JSON：解析失败 → 删键 + 兜底（自愈）
    function getJSON(key, fallback) {
      var raw = safeGet(key);
      if (raw === null) return fallback;
      try {
        var v = JSON.parse(raw);
        return v === null || v === undefined ? fallback : v;
      } catch (e) {
        safeRemove(key); // 关键：坏值必须清掉，否则后续写入永远失败
        return fallback;
      }
    }
    function setJSON(key, obj) {
      try {
        return safeSet(key, JSON.stringify(obj));
      } catch (e) {
        return false;
      }
    }
    function keysWithPrefix(prefix) {
      return _snapshot().filter(function (k) {
        return k.indexOf(prefix) === 0;
      });
    }
    function removeAll(prefixes) {
      var n = 0;
      (prefixes || []).forEach(function (p) {
        keysWithPrefix(p).forEach(function (k) {
          if (safeRemove(k)) n++;
        });
      });
      return n;
    }
    // 回收孤儿：命中前缀、但不在 validKeys 白名单里的键。
    // 用途 = 图层改名后 checkboxId 变化，旧键会永久残留。
    // ⚠️ validKeys 必须涵盖「当前所有可能被恢复的键」，否则会误删用户设置
    function pruneOrphans(prefixes, validKeys) {
      var keep = {};
      (validKeys || []).forEach(function (k) {
        keep[k] = true;
      });
      var n = 0;
      (prefixes || []).forEach(function (p) {
        keysWithPrefix(p).forEach(function (k) {
          if (!keep[k] && safeRemove(k)) n++;
        });
      });
      return n;
    }
    // 清「状态类」：保留用户资产。用于「🧹 清理网页缓存」
    function clearResettable() {
      var n = 0;
      _snapshot().forEach(function (k) {
        if (!_isOwn(k) || _isAsset(k)) return;
        if (safeRemove(k)) n++;
      });
      return n;
    }
    // 清「本应用全部」：仍保留用户资产 + 调用方指定的 keepKeys。
    function clearApp(keepKeys) {
      var keep = {};
      (keepKeys || []).forEach(function (k) {
        keep[k] = true;
      });
      var n = 0;
      _snapshot().forEach(function (k) {
        if (!_isOwn(k) || keep[k] || _isAsset(k)) return;
        if (safeRemove(k)) n++;
      });
      return n;
    }
    function dropObsoleteKeys() {
      OBSOLETE_KEYS.forEach(function (k) {
        safeRemove(k);
      });
    }
    function isUsable() {
      return !!_ls();
    }

    return {
      KEY: K,
      isUsable: isUsable,
      safeGet: safeGet,
      safeSet: safeSet,
      safeRemove: safeRemove,
      getBool: getBool,
      getNum: getNum,
      getJSON: getJSON,
      setJSON: setJSON,
      keysWithPrefix: keysWithPrefix,
      removeAll: removeAll,
      pruneOrphans: pruneOrphans,
      clearResettable: clearResettable,
      clearApp: clearApp,
      dropObsoleteKeys: dropObsoleteKeys,
    };
  })();
  window.OGVStorage = OGVStorage;

  // ========== 暴露公共 API ==========
  window.GeoUtils = {
    createFixedSeededRandom,
    getFixedColor,
    getFeatureColorByIndex,
    getFeatureColorByField,
    getFieldColorPalette,
    detectMainGeomType,
    buildPopupContent,
    buildHighlightStyle,
    shiftGeoJSON,
    fixAntimeridian,
    fixGeometryCoords,
    getAvailableFields,
    getLayerPopupConfig,
    computeBounds,
    extractNumericFields,
    computeLayerStats,
  };
})();
