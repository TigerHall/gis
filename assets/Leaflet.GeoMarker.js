/**
 * Leaflet.GeoMarker.js
 * Leaflet 插件：统一的点要素标记工厂
 * 提供图标创建 + marker 创建，不负责 popup 绑定（由调用方处理）
 *
 * 用法：
 *   var marker = L.GeoMarker.createLabeledMarker(map, latlng, color, labelText);
 *   marker.bindPopup(...); // popup 由调用方绑定
 */
(function (factory) {
  if (typeof define === "function" && define.amd) define(["leaflet"], factory);
  else if (typeof module !== "undefined")
    module.exports = factory(require("leaflet"));
  else factory(window.L);
})(function (L) {
  "use strict";

  // ========== 内置图标类型注册表 ==========
  var iconTypes = {};

  /**
   * 注册自定义图标类型
   * @param {string} name - 图标类型名称
   * @param {function} fn - 工厂函数，接收 (color) 返回 L.divIcon
   */
  function registerIcon(name, fn) {
    iconTypes[name] = fn;
  }

  // ========== 内置图标：火山 ==========
  function createVolcanoIcon(color) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">' +
      '<polygon points="10,2 18,18 2,18" fill="' +
      color +
      '" fill-opacity="0.85" stroke="white" stroke-width="1.5" stroke-opacity="0.9"/>' +
      '<polygon points="10,6 14,14 6,14" fill="' +
      color +
      '" fill-opacity="0.5" stroke="none"/>' +
      "</svg>";
    return L.divIcon({
      html: svg,
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 18],
      popupAnchor: [0, -18],
    });
  }

  // ========== 内置图标：热点 ==========
  function createHotspotIcon(color) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">' +
      '<circle cx="9" cy="9" r="3.5" fill="' +
      color +
      '" fill-opacity="0.9" stroke="white" stroke-width="1.2"/>' +
      '<circle cx="9" cy="9" r="6" fill="none" stroke="' +
      color +
      '" stroke-opacity="0.5" stroke-width="1"/>' +
      '<circle cx="9" cy="9" r="8.5" fill="none" stroke="' +
      color +
      '" stroke-opacity="0.25" stroke-width="0.8"/>' +
      "</svg>";
    return L.divIcon({
      html: svg,
      className: "",
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -9],
    });
  }

  // ========== 内置图标：五角星 ==========
  function createStarIcon(color) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20">' +
      '<polygon points="10,1 12.9,7.1 19.5,7.6 14.7,12 16.2,18.5 10,15 3.8,18.5 5.3,12 0.5,7.6 7.1,7.1"' +
      ' fill="' +
      color +
      '" fill-opacity="0.8" stroke="white" stroke-width="1.5" stroke-opacity="0.95"/>' +
      "</svg>";
    return L.divIcon({
      html: svg,
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10],
    });
  }

  // ========== 内置图标：文件SVG风格的火山（山峰形）==========
  function createVolcanoSvgIcon(color) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 1024 1024">' +
      '<path d="M512.5 510c-53.65 0-104.32-5.65-142.7-15.91C322.16 481.35 298 462.48 298 438c0-41.22 68.47-58.91 125.91-66.48 10.95-1.45 21 6.26 22.44 17.21 1.45 10.95-6.26 21-17.21 22.44-26.41 3.48-49.41 8.61-66.52 14.82-13.35 4.85-20.24 9.37-23.24 12.04 4.73 4.29 18.68 12.43 49.98 19.72 33.93 7.9 77.66 12.25 123.13 12.25s89.21-4.35 123.13-12.25c31.33-7.29 45.28-15.45 50-19.73-6.9-6.16-33.36-20.56-99.67-28.06-10.98-1.24-18.87-11.14-17.63-22.12 1.24-10.98 11.14-18.87 22.12-17.63 36.5 4.13 67.86 11.08 90.69 20.12 30.43 12.04 45.86 28.08 45.86 47.67 0 24.48-24.16 43.35-71.8 56.09-38.37 10.26-89.05 15.91-142.7 15.91z" fill="' +
      color +
      '" fill-opacity="0.9"/>' +
      '<path d="M164.2 781.82c-5.28 0-10.54-2.07-14.47-6.19-7.63-7.99-7.33-20.65 0.66-28.28 65.05-62.09 101.43-143.03 120.49-199.99 20.91-62.48 26.18-110.72 26.23-111.2 1.16-10.98 11-18.95 21.98-17.79 10.98 1.15 18.95 10.98 17.8 21.96-0.22 2.1-5.63 52.28-27.74 118.71-12.99 39.03-29.11 75.66-47.9 108.85-23.66 41.8-51.67 78.27-83.24 108.4-3.87 3.7-8.84 5.53-13.81 5.53zM860 781.82c-4.96 0-9.93-1.84-13.81-5.53-31.57-30.14-59.58-66.61-83.24-108.4-18.79-33.19-34.91-69.82-47.9-108.85-22.11-66.43-27.52-116.61-27.74-118.71-1.15-10.99 6.83-20.82 17.82-21.97 10.98-1.15 20.81 6.82 21.97 17.8 0.05 0.48 5.33 48.72 26.23 111.2 19.06 56.97 55.44 137.9 120.49 199.99 7.99 7.63 8.29 20.29 0.66 28.28-3.93 4.12-9.2 6.19-14.47 6.19z" fill="' +
      color +
      '" fill-opacity="0.9"/>' +
      '<path d="M450.23 798.29c-2.32 0-4.48-0.14-6.44-0.4-41.52-3.62-57.54-38.88-60.46-58.15-11.69-49.15-15.85-101.6-16.25-106.92-2.92-26.49-16.92-30.31-20.49-30.85-0.25 0 0.04 0-0.49-0.06-32.03-3.05-66.98 29.25-67.32 29.58-8 7.61-20.66 7.3-28.28-0.71-7.61-8-7.3-20.66 0.71-28.28 0.48-0.46 12.07-11.41 29.29-21.68 24.19-14.43 47.43-20.75 69.09-18.76 17.74 1.25 51.97 16.71 57.3 66.82l0.06 0.67c0.04 0.53 4.04 54.04 15.5 101.78 0.19 0.81 0.29 1.23 0.38 2.01 0.15 0.87 1.33 7.16 5.16 13.19 4.55 7.17 10.78 10.83 19.59 11.52 0.68 0.05 0.66 0.02 1.18 0.12 1.12 0.07 6.72 0.23 12.96-2.77 9.47-4.56 16.6-14.42 21.18-29.29 0.17-0.57 19.71-65.29 27.4-110.47l0.09-0.48c0.61-3.1 6.58-30.76 29.07-45.7 12.34-8.2 27.25-10.89 43.17-7.81 16.33 2.07 45.69 17.13 58.6 61.8 0.06 0.21 0.12 0.43 0.17 0.64 0.03 0.12 4.36 16.64 13.53 31.3 3.83 6.12 13.99 22.36 30 19.03h0.02c0.07-0.02 0.16-0.04 0.26-0.07 0 0-0.02 0 0 0 2.63-0.79 15.05-5.72 19.09-28.79 1.9-10.88 12.27-18.16 23.15-16.25 10.88 1.9 18.16 12.27 16.25 23.15-4.7 26.85-17.49 41.86-27.39 49.72-10.59 8.4-20.54 10.88-23.35 11.44-16.38 3.38-47.45 2.89-72.5-37.89-11.43-18.6-16.9-38.24-17.74-41.4-5.09-17.47-12.74-25.72-18.26-29.58-3.47-2.42-6.64-3.39-6.66-3.39-0.78-0.07-1.56-0.18-2.33-0.34-8.59-1.79-14.11 0.2-19.05 6.86-4.59 6.2-6.49 13.68-6.78 14.94-8.16 47.65-27.67 112.26-28.5 114.99-14.86 48.29-49.56 60.49-70.91 60.49z" fill="' +
      color +
      '" fill-opacity="0.8"/>' +
      '<path d="M512 432.79h-0.14c-11.05-0.08-19.94-9.09-19.86-20.14 0.3-44.08-4.24-85.52-13.51-123.18-2.64-10.73 3.92-21.56 14.64-24.2 10.73-2.64 21.56 3.92 24.2 14.64 10.06 40.88 14.99 85.63 14.67 133.02-0.08 11-9.02 19.86-20 19.86zM476.3 240.93c-7.64 0-14.93-4.4-18.26-11.82-11.78-26.26-22.3-39.24-22.4-39.37l0.07 0.08 30.69-25.65c1.4 1.68 14.11 17.3 28.14 48.57 4.52 10.08 0.02 21.91-10.06 26.43a19.99 19.99 0 0 1-8.18 1.76zM359.06 340.5c-9.8 0-18.36-7.21-19.78-17.2-4.49-31.73-20.47-56.46-47.51-73.5-21.3-13.43-41.84-17.03-42.05-17.07-10.9-1.76-18.28-12.02-16.52-22.92 1.76-10.9 12.06-18.31 22.97-16.55 1.11 0.18 27.49 4.58 55.43 21.77 37.8 23.26 61.06 58.76 67.27 102.67 1.55 10.94-6.06 21.06-17 22.6-0.95 0.13-1.89 0.2-2.83 0.2zM671 340.5c-2.31 0-4.65-0.4-6.94-1.25-10.36-3.84-15.64-15.34-11.81-25.7 12.32-33.25 31.13-61.18 55.93-83 23.18-20.4 46.74-31.09 62.43-36.47 10.45-3.58 21.82 1.98 25.4 12.43 3.58 10.45-1.98 21.82-12.43 25.4-25 8.57-70.43 32.38-93.82 95.52-2.99 8.07-10.63 13.06-18.76 13.06zM596.72 233c-0.67 0-1.34-0.03-2.01-0.1-10.99-1.1-19.01-10.9-17.91-21.89 2.55-25.54 11.53-48.52 25.96-66.43 11.04-13.7 21.5-19.93 23.48-21.04l19.51 34.92 0.25-0.15c-0.06 0.04-6.47 3.94-13.23 12.8-9.01 11.82-14.45 26.58-16.18 43.88-1.03 10.31-9.73 18.01-19.88 18.01z" fill="' +
      color +
      '" fill-opacity="0.8"/>' +
      "</svg>";
    return L.divIcon({
      html: svg,
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10],
    });
  }

  // ========== 内置图标：文件SVG风格的热点（火焰形）==========
  function createHotspotSvgIcon(color) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 1024 1024">' +
      '<path d="M555.09 139.19c76.01 87.19 157.62 256.24 161.24 447.17a78.69 78.69 0 0 0 125.87 61.68c3.86-2.91 18.12-13.78 36.39-30.88 1.26 56.71-12.52 119.26-41.2 179.2-20.8 43.4-47.42 80.27-75.62 106.5-15.83-36.79-44.43-61.2-72.86-82-12.68-9.29-23.71-17.33-32.85-27.41-13.55-14.97-43.87-56-33.71-113.43a78.69 78.69 0 0 0-115.63-82.7c-127.21 70.34-198.97 172.19-210.08 294.36-79.71-42.85-128.24-94.37-144.7-153.92-21.35-76.88 13.55-165.02 60.5-232.92a78.53 78.53 0 0 0 115.55 44.35c160.22-95.39 210.39-273.96 227.09-409.99M485.06 0c-3.62 153.13-23.95 378.25-197.4 481.52 5.83-90.66-9.22-138.4-31.35-186.37-11.11 59.08-36 75.07-75.62 121.78C63.25 555.33-72.08 919.69 485.06 1074.7c-39.23-156.51 19.85-271.36 159.35-348.48a212.83 212.83 0 0 0 52.78 180.07c53.88 59.55 123.59 55.93 88.54 177.7 190.07-14.73 359.74-376.36 219.53-581.16-22.13 76.09-110.67 142.1-110.67 142.1C789.5 291.52 614.24 23.95 485.06 0z" fill="' +
      color +
      '" fill-opacity="0.9"/>' +
      "</svg>";
    return L.divIcon({
      html: svg,
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10],
    });
  }

  // ========== 内置图标：普通点 ==========
  function createPointIcon(color, size) {
    var r = size || 8;
    var outline = r + 2;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      outline * 2 +
      '" height="' +
      outline * 2 +
      '" viewBox="0 0 ' +
      outline * 2 +
      " " +
      outline * 2 +
      '">' +
      '<circle cx="' +
      outline +
      '" cy="' +
      outline +
      '" r="' +
      (outline - 1) +
      '"' +
      ' fill="' +
      color +
      '" fill-opacity="0.85" stroke="white" stroke-width="1.5"/>' +
      "</svg>";
    return L.divIcon({
      html: svg,
      className: "",
      iconSize: [outline * 2, outline * 2],
      iconAnchor: [outline, outline],
      popupAnchor: [0, -(outline + 2)],
    });
  }

  // ========== 注册内置图标 ==========
  registerIcon("volcano", createVolcanoIcon);
  registerIcon("hotspot", createHotspotIcon);
  registerIcon("star", createStarIcon);
  registerIcon("point", createPointIcon);
  registerIcon("volcano-file", createVolcanoSvgIcon);
  registerIcon("hotspot-file", createHotspotSvgIcon);

  // ========== 统一聚类图标工厂 ==========
  /**
   * @param {string} innerHtml - 图形/图标的 SVG 内部 HTML
   * @param {string} color - 颜色
   * @param {number} count - 聚类数量
   * @param {number} [textY] - 计数文本 Y 坐标（默认 30，根据图形视觉中心调整）
   */
  function createClusterIconWithContent(innerHtml, color, count, textY) {
    var iconSize = count < 10 ? 40 : count < 100 ? 48 : 56;
    var fontSize = count >= 100 ? 11 : count >= 10 ? 13 : 15;
    textY = textY || 30;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      iconSize +
      '" height="' +
      iconSize +
      '" viewBox="0 0 60 60">' +
      innerHtml +
      '<text x="30" y="' +
      textY +
      '" text-anchor="middle" dominant-baseline="central"' +
      ' fill="white" stroke="#222" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"' +
      ' font-weight="bold" font-size="' +
      fontSize +
      '" font-family="Arial,sans-serif">' +
      count +
      "</text></svg>";
    return L.divIcon({
      html: svg,
      className: "cluster-icon",
      iconSize: [iconSize, iconSize],
      iconAnchor: [iconSize / 2, iconSize / 2],
    });
  }

  function createVolcanoClusterIcon(color, count) {
    // 三角形视觉中心偏下（质心 y≈38），文本放 y=35
    return createClusterIconWithContent(
      '<polygon points="30,2 56,56 4,56" fill="' +
        color +
        '" stroke="white" stroke-width="3"/><polygon points="30,16 44,46 16,46" fill="' +
        color +
        '" fill-opacity="0.5" stroke="none"/>',
      color,
      count,
      37,
    );
  }

  function createHotspotClusterIcon(color, count) {
    // 同心圆中心正对 (30,30)
    return createClusterIconWithContent(
      '<circle cx="30" cy="30" r="28" fill="none" stroke="' +
        color +
        '" stroke-opacity="0.25" stroke-width="1.5"/><circle cx="30" cy="30" r="20" fill="none" stroke="' +
        color +
        '" stroke-opacity="0.5" stroke-width="2"/><circle cx="30" cy="30" r="12" fill="' +
        color +
        '" stroke="white" stroke-width="2"/>',
      color,
      count,
    );
  }

  function createDefaultClusterIcon(color, count) {
    // 圆形中心正对 (30,30)
    return createClusterIconWithContent(
      '<circle cx="30" cy="30" r="28" fill="' +
        color +
        '" stroke="white" stroke-width="2.5"/>',
      color,
      count,
    );
  }

  function createCustomClusterIcon(imgPath, color, count) {
    // 图片一般居中，文本放 y=30
    return createClusterIconWithContent(
      '<image href="' +
        imgPath +
        '" x="14" y="14" width="32" height="32" preserveAspectRatio="xMidYMid meet"/>',
      color,
      count,
    );
  }

  function createStarClusterIcon(color, count) {
    // 五角星视觉中心偏上（y≈26），文本放 y=26
    return createClusterIconWithContent(
      '<polygon points="30,5 35.5,19 50,21 39,31 42,46 30,38 18,46 21,31 10,21 24.5,19" fill="' +
        color +
        '" fill-opacity="0.85" stroke="white" stroke-width="1.5"/>',
      color,
      count,
      28,
    );
  }

  function createInlineSvgClusterIcon(svgHtml, color, count) {
    var inner = svgHtml
      .replace(/<svg[^>]*>/i, "")
      .replace(/<\/svg>/i, "")
      .trim();
    return createClusterIconWithContent(
      '<g transform="translate(5,5) scale(0.05)">' + inner + "</g>",
      color,
      count,
    );
  }

  // ========== 聚类图标自动分发 ==========
  var clusterIconMap = {};
  function registerClusterIcon(iconType, fn) {
    clusterIconMap[iconType] = fn;
  }
  registerClusterIcon("volcano", createVolcanoClusterIcon);
  registerClusterIcon("hotspot", createHotspotClusterIcon);
  registerClusterIcon("star", createStarClusterIcon);

  function getClusterIconForType(iconType, color, count) {
    if (clusterIconMap[iconType]) return clusterIconMap[iconType](color, count);
    var iconFn = iconTypes[iconType];
    if (iconFn) {
      var di = iconFn(color);
      var html = di.options.html || "";
      if (html) return createInlineSvgClusterIcon(html, color, count);
    }
    return createDefaultClusterIcon(color, count);
  }
  // ========== 外部文件图标 ==========
  function createExternalFileIcon(path, iconSize) {
    iconSize = iconSize || 20;
    var half = Math.round(iconSize / 2);
    return function (color) {
      return L.divIcon({
        html:
          '<img src="' +
          path +
          '" style="width:' +
          iconSize +
          "px;height:" +
          iconSize +
          'px;object-fit:contain;" alt="">',
        className: "",
        iconSize: [iconSize, iconSize],
        iconAnchor: [half, half],
        popupAnchor: [0, -half],
      });
    };
  }

  // ========== 透明度包裹（让整个标记淡出，用于图层不透明度控制） ==========
  function wrapOpacity(html, opacity) {
    if (opacity != null && opacity < 1) {
      return '<div class="gm-op-wrap" style="opacity:' + opacity + '">' + html + "</div>";
    }
    return html;
  }

  // ========== 创建带标签的圆形点标记 ==========
  function createLabeledMarker(map, latlng, color, labelText, opacity) {
    var showLabel = !!labelText;
    var html =
      '<div class="station-marker-wrapper">' +
      '<span class="station-dot" style="background:' +
      color +
      ';border-color:white;"></span>' +
      '<span class="station-label' +
      (showLabel ? "" : " hidden") +
      '">' +
      (labelText || "") +
      "</span>" +
      "</div>";
    html = wrapOpacity(html, opacity);
    return L.marker(latlng, {
      icon: L.divIcon({
        html: html,
        className: "station-icon-container",
        iconSize: [120, 20],
        iconAnchor: [5, 10],
        popupAnchor: [8, -5],
      }),
      interactive: true,
    });
  }

  // ========== 创建带标签的 SVG 图标标记 ==========
  function createSvgLabeledMarker(map, svgIconFn, latlng, color, labelText, opacity) {
    var showLabel = !!labelText;
    var svgStr = svgIconFn(color).options.html;
    var html =
      '<div class="station-marker-wrapper">' +
      '<span class="station-icon-svg">' +
      svgStr +
      "</span>" +
      '<span class="station-label' +
      (showLabel ? "" : " hidden") +
      '">' +
      (labelText || "") +
      "</span>" +
      "</div>";
    html = wrapOpacity(html, opacity);
    return L.marker(latlng, {
      icon: L.divIcon({
        html: html,
        className: "station-icon-container",
        iconSize: [120, 20],
        iconAnchor: [5, 10],
        popupAnchor: [8, -5],
      }),
      interactive: true,
    });
  }

  // ========== 创建无标签的纯图标标记 ==========
  function createPureIconMarker(latlng, color, iconFn, opacity) {
    if (iconFn)
      return L.marker(latlng, { icon: wrapIconOpacity(iconFn, color, opacity) });
    return L.marker(latlng, {
      icon: wrapIconOpacity(createPointIcon, color, 8, opacity),
    });
  }

  // 给已有/待建的 divIcon 工厂套上透明度包裹
  function wrapIconOpacity(iconFactoryOrFn, color, opacity, size) {
    var di =
      typeof iconFactoryOrFn === "function" && !iconFactoryOrFn.options
        ? iconFactoryOrFn(color, size)
        : iconFactoryOrFn(color);
    if (di && di.options && di.options.html) {
      di.options.html = wrapOpacity(di.options.html, opacity);
    }
    return di;
  }

  // ========== 判断是否为外部文件路径 ==========
  function isExternalPath(str) {
    return (
      str &&
      (str.indexOf("./") === 0 ||
        str.indexOf("/") === 0 ||
        str.indexOf("http://") === 0 ||
        str.indexOf("https://") === 0 ||
        str.indexOf("data:") === 0)
    );
  }

  // ========== 根据图标类型创建点标记 ==========
  /**
   * @param {L.Map} map - Leaflet 地图实例
   * @param {object} feature - GeoJSON feature（用于设置 marker.feature）
   * @param {L.LatLng} latlng - 坐标
   * @param {string} color - 颜色
   * @param {string} labelText - 标签文字（如果有）
   * @param {string} iconType - 图标类型：
   *   "volcano" / "hotspot" / "star" / "point" → 内置注册图标
   *   "./assets/images/xxx.svg" → 外部文件路径
   *   null / undefined / "" → 默认圆形点兜底
   * @param {number} [iconSize] - 外部文件图标尺寸（px），默认 20
   * @returns {L.Marker}
   */
  function createPointMarkerByType(
    map,
    feature,
    latlng,
    color,
    labelText,
    iconType,
    iconSize,
    opacity,
  ) {
    var marker;
    var iconFn = getIconFactory(iconType, iconSize);

    if (iconFn) {
      // 有图标工厂函数 → 用 SVG 图标（含标签或不含）
      if (labelText) {
        marker = createSvgLabeledMarker(
          map,
          iconFn,
          latlng,
          color,
          labelText,
          opacity,
        );
      } else {
        marker = createPureIconMarker(latlng, color, iconFn, opacity);
      }
    } else {
      // 无图标工厂 → 默认圆形点兜底
      if (labelText) {
        marker = createLabeledMarker(map, latlng, color, labelText, opacity);
      } else {
        marker = createPureIconMarker(latlng, color, null, opacity);
      }
    }
    if (feature) marker.feature = feature;
    return marker;
  }

  /**
   * 根据 iconType 获取图标工厂函数
   * @param {string} iconType
   * @param {number} [iconSize] - 外部文件图标尺寸（px），默认 20
   * @returns {function|null} (color) => L.divIcon 或 null（兜底用默认圆点）
   */
  function getIconFactory(iconType, iconSize) {
    if (!iconType) return null;
    // 1. 查内置注册表
    if (iconTypes[iconType]) return iconTypes[iconType];
    // 2. 外部文件路径（PNG/ICO 等用 <img> 方式渲染）
    if (isExternalPath(iconType))
      return createExternalFileIcon(iconType, iconSize);
    // 3. 无法识别 → 返回 null 用圆点兜底
    return null;
  }

  // ========== 暴露公共 API ==========
  L.GeoMarker = {
    registerIcon: registerIcon,
    createVolcanoIcon: createVolcanoIcon,
    createHotspotIcon: createHotspotIcon,
    createStarIcon: createStarIcon,
    createPointIcon: createPointIcon,
    createVolcanoSvgIcon: createVolcanoSvgIcon,
    createHotspotSvgIcon: createHotspotSvgIcon,
    createExternalFileIcon: createExternalFileIcon,
    getIconFactory: getIconFactory,
    createLabeledMarker: createLabeledMarker,
    createSvgLabeledMarker: createSvgLabeledMarker,
    createPureIconMarker: createPureIconMarker,
    createPointMarkerByType: createPointMarkerByType,
    // 聚类图标工厂
    createVolcanoClusterIcon: createVolcanoClusterIcon,
    createHotspotClusterIcon: createHotspotClusterIcon,
    createDefaultClusterIcon: createDefaultClusterIcon,
    createCustomClusterIcon: createCustomClusterIcon,
    createStarClusterIcon: createStarClusterIcon,
    getClusterIconForType: getClusterIconForType,
    isExternalPath: isExternalPath,
  };

  return L.GeoMarker;
});
