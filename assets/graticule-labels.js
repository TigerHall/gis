/**
 * graticule-labels.js —— 【已停用，存档备用】
 * 经纬度格网「边缘坐标标签」DOM 层（v2/v3 方案：标签放地图外侧）
 * 2026-08-15 用户要求改用官方插件原生用法（showLabel:true 画在地图内边缘），
 * 本文件不再被 index.html 引用。若官方效果不理想，可切回：恢复 index.html 引入 +
 * app.js graticuleToggle 中的 enable/disable 调用（见 git 历史）。
 *
 * 依赖：Leaflet 全局 L（app.js 之后加载，graticuleToggle 控制）
 * 用法：window.GraticuleLabels.enable(map, { interval: [...], dark: false })
 *       window.GraticuleLabels.setDark(true/false)   // 深色模式联动
 *       window.GraticuleLabels.disable()
 */
(function (window, L) {
  "use strict";

  var EL_ID = "graticuleLabels";
  var _map = null;
  var _el = null;
  var _interval = null; // [{start,end,interval}, ...]
  var _dark = false;
  var _listeners = [];

  // 基础样式（一次性注入）
  var _styleInjected = false;
  function injectStyle() {
    if (_styleInjected) return;
    _styleInjected = true;
    var s = document.createElement("style");
    s.id = "graticule-labels-style";
    s.textContent =
      "#graticuleLabels{position:fixed;inset:0;pointer-events:none;z-index:1050;font-size:11px;" +
      "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;}" +
      "#graticuleLabels .gl-tick{position:absolute;white-space:nowrap;" +
      "transform:translate(-50%,-50%);line-height:1.15;padding:1px 4px;border-radius:3px;" +
      "color:#3a3a3a;background:rgba(255,255,255,.72);" +
      "text-shadow:0 1px 2px rgba(255,255,255,.5);}" +
      // 左右两侧纬度标签竖排：左 90°、右 270°（沿边框方向阅读）
      "#graticuleLabels .gl-left{transform:translate(-50%,-50%) rotate(90deg);}" +
      "#graticuleLabels .gl-right{transform:translate(-50%,-50%) rotate(-90deg);}" +
      "#graticuleLabels.gl-dark .gl-tick{color:#d6d6d6;background:rgba(22,22,22,.72);" +
      "text-shadow:0 1px 2px rgba(0,0,0,.6);}";
    document.head.appendChild(s);
  }

  // 默认缩放分级（与 app.js graticuleToggle 保持一致；enable 时可覆盖）
  var DEFAULT_INTERVAL = [
    { start: 1, end: 3, interval: 30 },
    { start: 4, end: 5, interval: 10 },
    { start: 6, end: 7, interval: 5 },
    { start: 8, end: 9, interval: 1 },
    { start: 10, end: 11, interval: 0.25 },
    { start: 12, end: 13, interval: 0.1 },
    { start: 14, end: 14, interval: 0.05 },
    { start: 15, end: 16, interval: 0.02 },
    { start: 17, end: 18, interval: 0.01 },
    { start: 19, end: 20, interval: 0.005 },
  ];

  function intervalForZoom(z) {
    var list = _interval || DEFAULT_INTERVAL;
    if (!list.length) return 30;
    var seg = null;
    for (var i = 0; i < list.length; i++) {
      if (z >= list[i].start && z <= list[i].end) {
        seg = list[i];
        break;
      }
    }
    if (!seg) {
      seg = z < list[0].start ? list[0] : list[list.length - 1];
    }
    return seg.interval;
  }

  function fmtLng(v) {
    v = Math.round(v * 100) / 100;
    if (v === 0) return "0°";
    return v > 0 ? v + "°E" : -v + "°W";
  }
  function fmtLat(v) {
    v = Math.round(v * 100) / 100;
    if (v === 0) return "0°";
    return v > 0 ? v + "°N" : -v + "°S";
  }

  // 刻度去重/防重叠：同一边相邻间距小于 MIN_GAP 时跳过
  var MIN_GAP = 26;
  function placeable(items, pos) {
    for (var i = 0; i < items.length; i++) {
      if (Math.abs(items[i] - pos) < MIN_GAP) return false;
    }
    return true;
  }

  function draw() {
    if (!_map || !_el) return;
    var mapEl = _map.getContainer();
    var rect = mapEl.getBoundingClientRect();
    var zoom = _map.getZoom();
    var interval = intervalForZoom(zoom);

    var tops = [];
    var bottoms = [];
    var lefts = [];
    var rights = [];
    var html = "";

    // 经度刻度（顶/底边，显示经度值）
    for (var lng = -180; lng <= 180; lng += interval) {
      if (Math.abs(lng) > 180) continue;
      var pt = _map.latLngToContainerPoint([0, lng]);
      if (pt.x < -50 || pt.x > rect.width + 50) continue;
      var label = fmtLng(lng);
      if (placeable(tops, pt.x)) {
        tops.push(pt.x);
        html +=
          '<span class="gl-tick" style="left:' +
          (rect.left + pt.x) +
          "px;top:" +
          (rect.top - 11) +
          'px">' +
          label +
          "</span>";
      }
      if (placeable(bottoms, pt.x)) {
        bottoms.push(pt.x);
        html +=
          '<span class="gl-tick" style="left:' +
          (rect.left + pt.x) +
          "px;top:" +
          (rect.bottom + 11) +
          'px">' +
          label +
          "</span>";
      }
    }

    // 纬度刻度（左/右边，显示纬度值）
    for (var lat = -90; lat <= 90; lat += interval) {
      if (Math.abs(lat) > 90) continue;
      var pt2 = _map.latLngToContainerPoint([lat, 0]);
      if (pt2.y < -40 || pt2.y > rect.height + 40) continue;
      var label2 = fmtLat(lat);
      if (placeable(lefts, pt2.y)) {
        lefts.push(pt2.y);
        html +=
          '<span class="gl-tick gl-left" style="left:' +
          (rect.left - 11) +
          "px;top:" +
          (rect.top + pt2.y) +
          'px">' +
          label2 +
          "</span>";
      }
      if (placeable(rights, pt2.y)) {
        rights.push(pt2.y);
        html +=
          '<span class="gl-tick gl-right" style="left:' +
          (rect.right + 11) +
          "px;top:" +
          (rect.top + pt2.y) +
          'px">' +
          label2 +
          "</span>";
      }
    }

    _el.innerHTML = html;
  }

  function ensureEl() {
    if (_el) return;
    injectStyle();
    _el = document.createElement("div");
    _el.id = EL_ID;
    if (_dark) _el.className = "gl-dark";
    document.body.appendChild(_el);
  }

  function onMapChange() {
    draw();
  }

  function bind() {
    if (!_map) return;
    _listeners.push([_map, "moveend", onMapChange]);
    _listeners.push([_map, "zoomend", onMapChange]);
    _listeners.push([_map, "viewreset", onMapChange]);
    _listeners.push([window, "resize", onMapChange]);
    for (var i = 0; i < _listeners.length; i++) {
      _listeners[i][0].addEventListener
        ? _listeners[i][0].addEventListener(_listeners[i][1], _listeners[i][2])
        : _listeners[i][0].on(_listeners[i][1], _listeners[i][2]);
    }
  }

  function unbind() {
    for (var i = 0; i < _listeners.length; i++) {
      _listeners[i][0].removeEventListener
        ? _listeners[i][0].removeEventListener(_listeners[i][1], _listeners[i][2])
        : _listeners[i][0].off(_listeners[i][1], _listeners[i][2]);
    }
    _listeners = [];
  }

  window.GraticuleLabels = {
    enable: function (map, opts) {
      opts = opts || {};
      _map = map;
      _interval = opts.interval || null;
      _dark = !!opts.dark;
      ensureEl();
      bind();
      draw();
    },
    setDark: function (dark) {
      _dark = !!dark;
      if (_el) {
        if (_dark) _el.className = "gl-dark";
        else _el.className = "";
      }
    },
    redraw: function () {
      draw();
    },
    disable: function () {
      unbind();
      if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
      _el = null;
      _map = null;
      _interval = null;
    },
    isActive: function () {
      return !!_el;
    },
  };
})(window, window.L);
