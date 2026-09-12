/**
 * measure-export.js — 测量结果导出（独立模块）
 *
 * 依赖：window.addUserLayer（由 geojsonloader.js 挂载）
 *       map.pm（Leaflet-Geoman，由 app.js 的「编辑测量」开关启用）
 *       pointdrop.css 的 .pd-btn 样式
 * 加载时机：pointdrop.js 之后（沿用同一个锚点，按钮排在「现在的位置」下面）
 *
 * 做什么：
 *   把 Geoman 画在地图上的点 / 线 / 面（含路线规划折线）收集成一个
 *   GeoJSON FeatureCollection，两个出口：
 *     ① 生成用户图层 —— 与「坐标投点 / 现在的位置」完全同一套逻辑
 *        （window.addUserLayer → 本地图层查看组 → 可定位、可查属性表、
 *         激活高级功能后可点状态点下载 GeoJSON）
 *     ② 直接下载 .json 文件 —— 不依赖高级功能，测量数据是用户自己产生的
 */
(function () {
  "use strict";

  var BTN_PAIR_CLASS = "pd-btn-pair";

  // ========== 几何量算（球面，与 index.html 的 formatDistance/Area 同口径）==========
  var EARTH_R = 6371000; // 米

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  /** 两点球面距离（米） */
  function haversine(a, b) {
    var dLat = toRad(b[1] - a[1]);
    var dLng = toRad(b[0] - a[0]);
    var s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a[1])) *
        Math.cos(toRad(b[1])) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** 折线长度（米） */
  function lineLength(coords) {
    var total = 0;
    for (var i = 0; i < coords.length - 1; i++) {
      total += haversine(coords[i], coords[i + 1]);
    }
    return total;
  }

  /** 环面积（平方米，球面公式） */
  function ringArea(ring) {
    if (!ring || ring.length < 3) return 0;
    var area = 0;
    for (var i = 0; i < ring.length; i++) {
      var p1 = ring[i];
      var p2 = ring[(i + 1) % ring.length];
      area +=
        toRad(p2[0] - p1[0]) *
        (2 + Math.sin(toRad(p1[1])) + Math.sin(toRad(p2[1])));
    }
    return Math.abs((area * EARTH_R * EARTH_R) / 2);
  }

  function geomMetrics(geom) {
    if (!geom) return null;
    var t = geom.type;
    if (t === "LineString") return { length: lineLength(geom.coordinates) };
    if (t === "MultiLineString") {
      var sum = 0;
      for (var i = 0; i < geom.coordinates.length; i++) {
        sum += lineLength(geom.coordinates[i]);
      }
      return { length: sum };
    }
    if (t === "Polygon") {
      // 外环减内环（洞）
      var a = ringArea(geom.coordinates[0]);
      for (var h = 1; h < geom.coordinates.length; h++) {
        a -= ringArea(geom.coordinates[h]);
      }
      return { area: Math.abs(a) };
    }
    if (t === "MultiPolygon") {
      var total = 0;
      for (var p = 0; p < geom.coordinates.length; p++) {
        var poly = geom.coordinates[p];
        total += ringArea(poly[0]);
        for (var hh = 1; hh < poly.length; hh++) total -= ringArea(poly[hh]);
      }
      return { area: Math.abs(total) };
    }
    return null;
  }

  var TYPE_ZH = {
    Point: "点",
    MultiPoint: "点",
    LineString: "线",
    MultiLineString: "线",
    Polygon: "面",
    MultiPolygon: "面",
  };

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function timestamp() {
    var d = new Date();
    return (
      d.getFullYear() +
      pad2(d.getMonth() + 1) +
      pad2(d.getDate()) +
      "_" +
      pad2(d.getHours()) +
      pad2(d.getMinutes()) +
      pad2(d.getSeconds())
    );
  }

  function toast(msg, opts) {
    if (typeof window.showToast === "function") window.showToast(msg, opts);
  }

  /**
   * 没有绘制内容时的引导：顺手把「编辑测量」开关打开
   * （程序化改 checked 不会触发 change，需手动派发才能让工具栏真的出现）
   * @returns {boolean} true 表示本次是「刚帮用户打开开关」
   */
  function ensureMeasureEnabled() {
    var cb = document.getElementById("geomenToggle");
    if (!cb || cb.checked) return false;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /** 统一的空状态提示 */
  function warnEmpty() {
    if (ensureMeasureEnabled()) {
      toast("🛠️ 已打开「编辑测量」工具栏，画好点/线/面后再点一次即可导出", {
        duration: 4000,
      });
    } else {
      toast("⚠️ 地图上还没有测量内容，请用工具栏绘制点 / 线 / 面", {
        duration: 3000,
      });
    }
  }

  // ========== 收集绘制图层 ==========
  /**
   * 取出 Geoman 绘制出的所有图层（点/线/面/矩形/圆/文字标记）
   * @returns {Array} Leaflet Layer 数组
   */
  function getDrawnLayers() {
    if (!window.map || !window.map.pm) return [];
    try {
      if (typeof window.map.pm.getGeomanDrawLayers === "function") {
        return window.map.pm.getGeomanDrawLayers() || [];
      }
      if (typeof window.map.pm.getGeomanLayers === "function") {
        // 老版本 API：只保留带 _drawnByGeoman 标记的图层
        return (window.map.pm.getGeomanLayers() || []).filter(function (l) {
          return l && l._drawnByGeoman;
        });
      }
    } catch (e) {
      console.warn("[MeasureExport] 读取测量图层失败:", e);
    }
    return [];
  }

  /**
   * 把绘制图层转成 GeoJSON FeatureCollection
   * @returns {{geojson: Object|null, error: string|null}}
   */
  function buildGeoJson() {
    var layers = getDrawnLayers();
    var features = [];

    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (!layer || typeof layer.toGeoJSON !== "function") continue;
      var feat;
      try {
        feat = layer.toGeoJSON();
      } catch (e) {
        continue;
      }
      if (!feat || !feat.geometry) continue;

      var props = feat.properties || {};
      var typeZh = TYPE_ZH[feat.geometry.type] || "要素";
      var metrics = geomMetrics(feat.geometry);

      // 保留 Geoman 画出来的原始样式，便于回读时颜色一致
      if (layer.options) {
        if (layer.options.color) props.color = layer.options.color;
        if (layer.options.weight != null) props.weight = layer.options.weight;
        if (layer.options.fillColor)
          props.fillColor = layer.options.fillColor;
        if (layer.options.fillOpacity != null)
          props.fillOpacity = layer.options.fillOpacity;
      }
      if (layer.getRadius) {
        try {
          props.radius_m = Math.round(layer.getRadius());
        } catch (e) {}
      }

      props["名称"] = props["名称"] || "测量" + (i + 1);
      props["类型"] = typeZh;
      if (metrics && metrics.length != null) {
        props["长度_km"] = Number((metrics.length / 1000).toFixed(3));
      }
      if (metrics && metrics.area != null) {
        props["面积_km2"] = Number((metrics.area / 1e6).toFixed(4));
      }
      props["来源"] = "地图测量/绘制";

      feat.properties = props;
      features.push(feat);
    }

    if (!features.length) {
      return { geojson: null, error: "地图上还没有测量的点 / 线 / 面" };
    }
    return {
      geojson: { type: "FeatureCollection", features: features },
      error: null,
    };
  }

  // ========== 出口 ①：生成用户图层（与坐标投点同逻辑）==========
  function generateUserLayer() {
    var res = buildGeoJson();
    if (res.error) {
      toast("⚠️ " + res.error + "，请先开启「编辑测量」并绘制", {
        duration: 3000,
      });
      return;
    }
    if (typeof window.addUserLayer !== "function") {
      toast("❌ 图层加载器尚未就绪，请稍后再试", { duration: 2500 });
      return;
    }
    var name = "测量_" + timestamp();
    window.addUserLayer(res.geojson, name, true);
    toast(
      "✅ 已生成图层「" +
        name +
        "」，共 " +
        res.geojson.features.length +
        " 个要素",
      { duration: 3000 },
    );
  }

  // ========== 出口 ②：直接下载 .json ==========
  function downloadJson() {
    var res = buildGeoJson();
    if (res.error) {
      warnEmpty();
      return;
    }
    var text = JSON.stringify(res.geojson, null, 2);
    var blob = new Blob([text], { type: "application/geo+json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.download = "measure_" + timestamp() + ".geojson";
    a.href = url;
    a.click();
    // Safari 需要延迟一点再释放，否则可能下载到空文件
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
    toast(
      "✅ 已导出 " + res.geojson.features.length + " 个测量要素",
      { duration: 3000 },
    );
  }

  // ========== 初始化：在「现在的位置」下方插入两个按钮 ==========
  function initUI() {
    if (document.getElementById("measureExportBtn")) return true;

    var uploadArea = document.getElementById("uploadArea");
    var btnRow = document.querySelector("#uploadArea .upload-btn-row");
    if (!uploadArea || !btnRow || !btnRow.parentNode) return false;

    var pair = document.createElement("div");
    pair.className = BTN_PAIR_CLASS;

    var genBtn = document.createElement("button");
    genBtn.id = "measureExportBtn";
    genBtn.type = "button";
    genBtn.className = "pd-btn";
    genBtn.textContent = "📐 测量转图层";
    genBtn.title =
      "把地图上测量的点/线/面（含路线规划折线）转成用户图层，逻辑与坐标投点一致";
    genBtn.onclick = generateUserLayer;

    var dlBtn = document.createElement("button");
    dlBtn.id = "measureDownloadBtn";
    dlBtn.type = "button";
    dlBtn.className = "pd-btn";
    dlBtn.textContent = "⬇️ 导出JSON";
    dlBtn.title = "把测量结果直接下载为 GeoJSON 文件（无需激活高级功能）";
    dlBtn.onclick = downloadJson;

    pair.appendChild(genBtn);
    pair.appendChild(dlBtn);
    btnRow.parentNode.insertBefore(pair, btnRow);
    return true;
  }

  function setupHook() {
    if (!initUI()) setTimeout(setupHook, 150);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupHook);
  } else {
    setupHook();
  }
})();
