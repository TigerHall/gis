/**
 * measure-tools.js — 测量 / 绘制的交互增强（独立模块）
 *
 * 依赖：map.pm（Leaflet-Geoman，由 app.js 的「编辑测量」开关启用）
 *       window.showToast（可选，没有就退回 console）
 * 加载时机：index.html 中 measure-export.js 之后。
 *   measure-export.js 负责「画完之后怎么导出」，本文件负责「画的过程好不好用 + 怎么清干净」。
 *
 * 做四件事：
 *   ① 测量中不点选要素 —— 绘制/测量时点击只用于落点，不再命中底下的图层要素
 *      （不弹属性窗、不高亮、不触发「缩放至」）。
 *      ⚠️ Leaflet-Geoman 的**顶点吸附**是几何计算（Snap 模块自己遍历图层几何找最近点），
 *         不依赖 DOM 命中，所以屏蔽点击不影响吸附到点要素 / 线面折点。
 *   ② 画圆时实时显示半径读数（跟随光标）。
 *   ③ 画完的圆：弹窗显示 半径 / 面积，并可直接**输入半径改圆**。
 *   ④ 工具条上加一个「清除全部测量」按钮（Geoman 自带的 Removal Mode 只能逐个删）。
 */
(function () {
  "use strict";

  var DRAWING_CLASS = "ogv-drawing"; // 挂在 <body> 上，CSS 里据此屏蔽 pane 的鼠标事件
  var EARTH_R = 6371000; // 米，与 index.html / measure-export.js 同口径

  // ==========================================================
  // 小工具
  // ==========================================================
  function toast(msg, opts) {
    if (typeof window.showToast === "function") {
      window.showToast(msg, opts);
    } else {
      console.log("[MeasureTools]", msg);
    }
  }

  /** 距离格式化（与 index.html 的 formatDistance 同口径） */
  function fmtLen(meters) {
    if (!isFinite(meters)) return "—";
    if (meters >= 1000) {
      return (meters / 1000).toFixed(meters >= 10000 ? 1 : 2) + " km";
    }
    return Math.round(meters) + " m";
  }

  /** 面积格式化（与 index.html 的 formatArea 同口径） */
  function fmtArea(sqMeters) {
    if (!isFinite(sqMeters)) return "—";
    if (sqMeters >= 1e6) return (sqMeters / 1e6).toFixed(2) + " km²";
    return Math.round(sqMeters) + " m²";
  }

  function getMap() {
    return window.map;
  }

  // ==========================================================
  // ① 测量中屏蔽要素点选
  // ==========================================================
  /**
   * 当前是否处于「绘制/测量」状态。
   * Geoman 的 globalDrawModeEnabled() 内部是 !!Draw.getActiveShape() —— 只在
   * 真的点了某个绘制工具之后才为 true，不会误伤「编辑 / 拖拽 / 删除」模式。
   */
  function isDrawing() {
    var m = getMap();
    if (!m || !m.pm || typeof m.pm.globalDrawModeEnabled !== "function") {
      return false;
    }
    try {
      return !!m.pm.globalDrawModeEnabled();
    } catch (e) {
      return false;
    }
  }

  function setDrawing(on) {
    if (document.body) {
      document.body.classList.toggle(DRAWING_CLASS, !!on);
    }
  }

  /** 以 Geoman 的真实状态为准，重新同步一次 body 上的标记类（幂等） */
  function syncDrawingClass() {
    setDrawing(isDrawing());
  }

  // ==========================================================
  // ② 画圆时的实时半径读数
  // ==========================================================
  // ⚠️ Geoman 的「圆」是 **点一下定圆心 → 再点一下定半径**（不是按住拖），
  //    所以读数不能靠 mousedown/mouseup 自己记圆心 —— 两次点击之间夹着的那次
  //    mouseup 会把刚记下的圆心清掉，读数永远不出现（第一版就这么踩的）。
  //    改为直接问 Geoman 要当前圆心：它自己在 _canFinishShape() 里判断
  //    「圆开始画了」的判据就是 `_centerMarker` 已经进了 `_layerGroup`，
  //    我们复用同一判据，click-click 与「按住拖」（如果以后版本支持）都能覆盖。
  var chipEl = null;

  function ensureChip() {
    var m = getMap();
    if (!m) return null;
    if (chipEl && chipEl.parentNode) return chipEl;
    var host = m.getContainer ? m.getContainer() : null;
    if (!host) return null;
    chipEl = document.createElement("div");
    chipEl.id = "ogvRadiusChip";
    chipEl.className = "ogv-radius-chip";
    chipEl.hidden = true;
    host.appendChild(chipEl);
    return chipEl;
  }

  function placeChip(latlng) {
    var m = getMap();
    var el = ensureChip();
    if (!m || !el) return;
    var pt = m.latLngToContainerPoint(latlng);
    el.style.left = Math.round(pt.x) + "px";
    el.style.top = Math.round(pt.y) + "px";
  }

  function showChip(latlng, text) {
    var el = ensureChip();
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    placeChip(latlng);
  }

  function hideChip() {
    if (chipEl) chipEl.hidden = true;
  }

  /**
   * 取「正在画的圆」的圆心；没在画圆就返回 null。
   * 读的是 Geoman 内部状态，所以整段包了 try/catch —— 万一将来内部改名，
   * 最坏结果只是「实时读数不出现」，不会影响绘制本身。
   */
  function circleDrawCenter() {
    var m = getMap();
    var d = m && m.pm && m.pm.Draw && m.pm.Draw.Circle;
    if (!d) return null;
    try {
      if (!d._layer || !d._centerMarker) return null;
      if (!d._layerGroup || !d._layerGroup.hasLayer(d._centerMarker)) return null;
      return d._layer.getLatLng();
    } catch (e) {
      return null;
    }
  }

  function onDrawMove(e) {
    if (!e || !e.latlng) return;
    var center = circleDrawCenter();
    if (!center) {
      hideChip();
      return;
    }
    showChip(e.latlng, "半径 " + fmtLen(center.distanceTo(e.latlng)));
  }

  function startCircleWatch() {
    var m = getMap();
    if (!m) return;
    m.on("mousemove", onDrawMove);
  }

  function stopCircleWatch() {
    var m = getMap();
    hideChip();
    if (m) m.off("mousemove", onDrawMove);
  }

  // ==========================================================
  // ③ 圆的测量弹窗（半径 / 面积 + 输入改半径）
  // ==========================================================
  var circleSeq = 0;
  var circleRegistry = {}; // id → L.Circle / L.CircleMarker
  var MAX_RADIUS_KM = 20000; // 地球半周长量级，超过就不是「圆」了

  function isGeoCircle(layer) {
    // L.Circle 的半径是「米」；L.CircleMarker 的半径是「屏幕像素」——
    // 后者没有真实长度含义，所以只报 px，不给面积、也不做 km 换算。
    //
    // ⚠️ 千万别写成 `layer instanceof L.Circle && !(layer instanceof L.CircleMarker)`：
    //    Leaflet 里 `L.Circle = L.CircleMarker.extend({...})`（leaflet.js:
    //    `gi = fi.extend({initialize:…this._mRadius=…})`），所以**圆也是 CircleMarker 的实例**，
    //    那个否定条件恒为 false → 所有地理圆都被当成像素圆。
    //    实测症状：弹窗把 272060 m 写成「272060 px」，输入 300 也只当成 300 像素 → 圆纹丝不动。
    //    CircleMarker 本身不是 L.Circle 的实例，所以只判前者就够。
    return !!(layer && layer instanceof L.Circle);
  }

  function circleRadiusText(layer) {
    if (isGeoCircle(layer)) return fmtLen(layer.getRadius());
    return Math.round(layer.getRadius()) + " px";
  }

  function circleAreaText(layer) {
    if (!isGeoCircle(layer)) return "—"; // 像素圆没有真实面积
    var r = layer.getRadius();
    return fmtArea(Math.PI * r * r);
  }

  function circlePopupHtml(layer, id) {
    var geo = isGeoCircle(layer);
    var html =
      '<div class="ogv-circle-pop">' +
      '<div class="ogv-circle-row">半径：<b class="ogv-circle-r">' +
      circleRadiusText(layer) +
      "</b></div>";
    if (geo) {
      html +=
        '<div class="ogv-circle-row">面积：<b class="ogv-circle-a">' +
        circleAreaText(layer) +
        "</b></div>";
    }
    html +=
      '<div class="ogv-circle-edit">' +
      "<label>半径 " +
      '<input type="number" class="ogv-circle-input" min="0" step="' +
      (geo ? "0.1" : "1") +
      '" value="' +
      (geo
        ? (layer.getRadius() / 1000).toFixed(3)
        : Math.round(layer.getRadius())) +
      '"> ' +
      (geo ? "km" : "px") +
      "</label>" +
      '<button type="button" class="ogv-circle-apply" data-ogv-circle="' +
      id +
      '">应用</button>' +
      "</div></div>";
    return html;
  }

  /** 用图层的当前半径刷新弹窗里的读数与输入框（不重建弹窗） */
  function refreshCirclePopup(layer, root) {
    if (!layer) return;
    var scope = root;
    if (!scope) {
      var pop = layer.getPopup && layer.getPopup();
      scope = pop && pop.getElement ? pop.getElement() : null;
    }
    if (!scope) return;
    var pop2 = scope.querySelector(".ogv-circle-pop") || scope;
    var rEl = pop2.querySelector(".ogv-circle-r");
    var aEl = pop2.querySelector(".ogv-circle-a");
    var input = pop2.querySelector(".ogv-circle-input");
    if (rEl) rEl.textContent = circleRadiusText(layer);
    if (aEl) aEl.textContent = circleAreaText(layer);
    if (input) {
      input.value = isGeoCircle(layer)
        ? (layer.getRadius() / 1000).toFixed(3)
        : String(Math.round(layer.getRadius()));
    }
  }

  function registerCircle(layer) {
    circleSeq += 1;
    var id = String(circleSeq);
    circleRegistry[id] = layer;
    layer._ogvCircleId = id;
    layer.bindPopup(circlePopupHtml(layer, id), { maxWidth: 260 });
    // 拖过圆的边界手柄之后再打开弹窗 → 读数是新的
    layer.on("popupopen", function () {
      refreshCirclePopup(layer);
    });
    // 与线/面的测量结果保持一致：画完就把读数摆出来，不用再点一下
    // （这里可以放心 openPopup —— 圆的绘制图层没有别的 click 处理器，
    //   不像数据图层那样会与 bindPopup 内部装的 _openPopup 撞成开两次窗）
    //
    // ⚠️ 先把绘制标记摘掉：CSS 在 body.ogv-drawing 期间会把所有 pane（含 popup pane）
    //    的 pointer-events 关掉（否则属性悬浮窗会吃掉绘制落点），而本弹窗是要交互的。
    //    形状已经画完，这里摘掉是安全的；紧随其后的 pm:drawend 还会再同步一次。
    setDrawing(false);
    try {
      layer.openPopup();
    } catch (e) {}
    return id;
  }

  function applyRadiusFromButton(btn) {
    var id = btn.getAttribute("data-ogv-circle");
    var layer = circleRegistry[id];
    if (!layer) {
      toast("⚠️ 这个圆已经不在了（可能已被清除）", { duration: 2500 });
      return;
    }
    var pop = btn.closest(".ogv-circle-pop");
    var input = pop && pop.querySelector(".ogv-circle-input");
    var val = parseFloat(input && input.value);
    if (!isFinite(val) || val <= 0) {
      toast("⚠️ 请输入一个大于 0 的半径", { duration: 2500 });
      return;
    }
    var geo = isGeoCircle(layer);
    if (geo && val > MAX_RADIUS_KM) {
      toast("⚠️ 半径不能超过 " + MAX_RADIUS_KM + " km", { duration: 2500 });
      return;
    }
    layer.setRadius(geo ? val * 1000 : val);
    refreshCirclePopup(layer, pop);
    toast("✅ 半径已改为 " + circleRadiusText(layer), { duration: 2500 });
  }

  // 与项目其余部分一致：弹窗里的按钮**不挂 onclick**，改用文档级事件委托
  // （Leaflet 复用弹窗时 setContent/update 会重写 innerHTML，onclick 会被抹掉）
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var btn = t.closest(".ogv-circle-apply");
    if (btn) {
      ev.preventDefault();
      applyRadiusFromButton(btn);
    }
  });

  // 输入框里回车 = 点「应用」
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    var t = ev.target;
    if (!t || !t.closest) return;
    var input = t.closest(".ogv-circle-input");
    if (!input) return;
    ev.preventDefault();
    var pop = input.closest(".ogv-circle-pop");
    var btn = pop && pop.querySelector(".ogv-circle-apply");
    if (btn) applyRadiusFromButton(btn);
  });

  // ==========================================================
  // ④ 一键清除全部测量
  // ==========================================================
  /**
   * 清除 Geoman 画在地图上的所有绘制图层（点/线/面/矩形/圆/文字标记）。
   * 返回被清除的数量。
   */
  function clearAllMeasure() {
    var m = getMap();
    if (!m || !m.pm) return 0;
    var layers = [];
    try {
      if (typeof m.pm.getGeomanDrawLayers === "function") {
        layers = m.pm.getGeomanDrawLayers() || [];
      } else if (typeof m.pm.getGeomanLayers === "function") {
        layers = (m.pm.getGeomanLayers() || []).filter(function (l) {
          return l && l._drawnByGeoman;
        });
      }
    } catch (e) {
      console.warn("[MeasureTools] 读取绘制图层失败:", e);
    }

    // 被删掉的圆要把注册表里的引用一起清掉，否则弹窗按钮会指向已移除的图层
    layers.forEach(function (l) {
      if (l && l._ogvCircleId) delete circleRegistry[l._ogvCircleId];
    });

    var n = 0;
    layers.forEach(function (l) {
      if (!l) return;
      try {
        m.removeLayer(l);
        n += 1;
      } catch (e) {}
    });
    hideChip();
    return n;
  }

  function clearAllWithToast() {
    var n = clearAllMeasure();
    if (n > 0) {
      toast("🧹 已清除 " + n + " 个测量要素", { duration: 2500 });
    } else {
      toast("⚠️ 地图上还没有测量内容", { duration: 2000 });
    }
  }

  // —— 工具条按钮 ——
  var toolbarInstalled = false;
  /**
   * 在 Geoman 工具条上加一个「清除全部测量」按钮。
   * ⚠️ 必须在 map.pm.addControls() **之后**调用（已实测：Geoman 会把
   *    createCustomControl 注册的按钮立即渲染进工具条）；
   *    重复调用会抛「Button with this name already exists」，故用标志位挡一次。
   */
  function installToolbarButtons() {
    var m = getMap();
    if (toolbarInstalled || !m || !m.pm || !m.pm.Toolbar) return;
    try {
      m.pm.Toolbar.createCustomControl({
        name: "ogvClearMeasure",
        block: "draw", // 落在绘制工具那一列（实测 block:"custom" 的容器不会上图）
        title: "清除全部测量",
        className: "leaflet-pm-icon-clear-measure",
        toggle: false, // 纯动作按钮，不是模式开关
        onClick: clearAllWithToast,
      });
      toolbarInstalled = true;
    } catch (e) {
      console.warn("[MeasureTools] 注册「清除全部测量」按钮失败:", e);
    }
  }

  // ==========================================================
  // 事件接线
  // ==========================================================
  function bindEvents() {
    var m = getMap();
    if (!m) return;

    m.on("pm:drawstart", function () {
      setDrawing(true);
      // 进入绘制前先把上一个要素的属性「悬浮窗」收掉：
      // 虽然 css 已经让它点击穿透（不再挡落点），但留一个窗口浮在光标下
      // 既看不清落点、也容易让人以为还能点选要素。进测量模式 = 切换交互语境。
      try {
        m.closePopup();
      } catch (e) {}
      startCircleWatch();
    });

    m.on("pm:drawend pm:drawstop", function () {
      stopCircleWatch();
      // drawend 触发时 Geoman 可能还没把绘制模式关掉 → 挪到下一个任务再确认
      setTimeout(syncDrawingClass, 0);
    });

    // 保险：极少数路径（比如用 Esc 取消）可能错过上面两个事件，
    // 用 mousemove 做一次便宜的兜底校准（只比较字符串状态，无重排）
    m.on("pm:create", function (e) {
      var layer = e && e.layer;
      if (!layer) return;
      if (e.shape === "Circle" || e.shape === "CircleMarker") {
        registerCircle(layer);
      }
      syncDrawingClass();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindEvents);
  } else {
    bindEvents();
  }

  window.OGVMeasureTools = {
    installToolbarButtons: installToolbarButtons,
    clearAll: clearAllMeasure,
    isDrawing: isDrawing,
  };
})();
