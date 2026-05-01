/**
 * Leaflet.GeoMarker.js
 * Leaflet 插件：统一的点要素标记工厂
 * 提供图标创建 + marker 创建，不负责 popup 绑定（由调用方处理）
 *
 * 用法：
 *   var marker = L.GeoMarker.createLabeledMarker(map, latlng, color, labelText, minZoom);
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

  // ========== 聚类图标工厂（供 geojsonloader 调用）==========
  // 火山聚类：三角形 + 数量标签
  function createVolcanoClusterIcon(color, count) {
    var iconSize = count < 10 ? 44 : count < 100 ? 52 : 60;
    var fontSize = count >= 100 ? 10 : count >= 10 ? 12 : 14;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      iconSize +
      '" height="' +
      iconSize +
      '" viewBox="0 0 60 60">' +
      '<polygon points="30,4 56,56 4,56" fill="' +
      color +
      '" stroke="white" stroke-width="3"/>' +
      '<polygon points="30,16 44,46 16,46" fill="' +
      color +
      '" fill-opacity="0.5" stroke="none"/>' +
      '<text x="30" y="36" text-anchor="middle" dominant-baseline="central" fill="white" font-size="' +
      fontSize +
      '" font-weight="bold" font-family="Arial,sans-serif">' +
      count +
      "</text>" +
      "</svg>";
    return L.divIcon({
      html: svg,
      className: "volcano-cluster-icon",
      iconSize: [iconSize, iconSize],
      iconAnchor: [iconSize / 2, iconSize / 2],
    });
  }

  // 热点聚类：三层同心圆 + 数量标签
  function createHotspotClusterIcon(color, count) {
    var iconSize = count < 10 ? 44 : count < 100 ? 52 : 60;
    var fontSize = count >= 100 ? 10 : count >= 10 ? 12 : 14;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      iconSize +
      '" height="' +
      iconSize +
      '" viewBox="0 0 60 60">' +
      '<circle cx="30" cy="30" r="28" fill="none" stroke="' +
      color +
      '" stroke-opacity="0.25" stroke-width="1.5"/>' +
      '<circle cx="30" cy="30" r="20" fill="none" stroke="' +
      color +
      '" stroke-opacity="0.5" stroke-width="2"/>' +
      '<circle cx="30" cy="30" r="12" fill="' +
      color +
      '" stroke="white" stroke-width="2"/>' +
      '<text x="30" y="30" text-anchor="middle" dominant-baseline="central" fill="white" font-size="' +
      fontSize +
      '" font-weight="bold" font-family="Arial,sans-serif">' +
      count +
      "</text>" +
      "</svg>";
    return L.divIcon({
      html: svg,
      className: "hotspot-cluster-icon",
      iconSize: [iconSize, iconSize],
      iconAnchor: [iconSize / 2, iconSize / 2],
    });
  }

  // 默认聚类：纯色圆形 + 数量标签
  function createDefaultClusterIcon(color, count) {
    var iconSize = count < 10 ? 36 : count < 100 ? 44 : 52;
    var fontSize = count >= 100 ? 10 : count >= 10 ? 12 : 14;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      iconSize +
      '" height="' +
      iconSize +
      '" viewBox="0 0 60 60">' +
      '<circle cx="30" cy="30" r="28" fill="' +
      color +
      '" stroke="white" stroke-width="2.5"/>' +
      '<text x="30" y="30" text-anchor="middle" dominant-baseline="central" fill="white" font-size="' +
      fontSize +
      '" font-weight="bold" font-family="Arial,sans-serif">' +
      count +
      "</text>" +
      "</svg>";
    return L.divIcon({
      html: svg,
      className: "default-cluster-icon",
      iconSize: [iconSize, iconSize],
      iconAnchor: [iconSize / 2, iconSize / 2],
    });
  }

  // ========== 创建带标签的圆形点标记 ==========
  /**
   * @param {L.Map} map - Leaflet 地图实例
   * @param {L.LatLng} latlng - 坐标
   * @param {string} color - 颜色
   * @param {string} labelText - 标签文字
   * @param {number} minZoom - 显示标签的最小缩放级别
   * @returns {L.Marker}
   */
  function createLabeledMarker(map, latlng, color, labelText, minZoom) {
    minZoom = minZoom || 7;
    var showLabel = map.getZoom() >= minZoom;

    var html =
      '<div class="station-marker-wrapper">' +
      '<span class="station-dot" style="background:' +
      color +
      ';border-color:white;"></span>' +
      '<span class="station-label ' +
      (showLabel ? "" : "hidden") +
      '">' +
      (labelText || "") +
      "</span>" +
      "</div>";

    var marker = L.marker(latlng, {
      icon: L.divIcon({
        html: html,
        className: "station-icon-container",
        iconSize: [120, 20],
        iconAnchor: [5, 10],
        popupAnchor: [8, -5],
      }),
      interactive: true,
    });

    // 缩放变化时更新标签显示
    marker._updateLabelVisibility = function () {
      var zoom = map.getZoom();
      var el = marker.getElement();
      if (el) {
        var labelSpan = el.querySelector(".station-label");
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

  // ========== 创建带标签的 SVG 图标标记 ==========
  /**
   * @param {L.Map} map - Leaflet 地图实例
   * @param {function} svgIconFn - SVG 图标工厂函数，如 createVolcanoIcon、createHotspotIcon，接收 (color) 返回 L.divIcon
   * @param {L.LatLng} latlng - 坐标
   * @param {string} color - 颜色
   * @param {string} labelText - 标签文字
   * @param {number} minZoom - 显示标签的最小缩放级别
   * @returns {L.Marker}
   */
  function createSvgLabeledMarker(
    map,
    svgIconFn,
    latlng,
    color,
    labelText,
    minZoom,
  ) {
    minZoom = minZoom || 7;
    var showLabel = map.getZoom() >= minZoom;
    var svgStr = svgIconFn(color).options.html;

    var html =
      '<div class="station-marker-wrapper">' +
      '<span class="station-icon-svg">' +
      svgStr +
      "</span>" +
      '<span class="station-label ' +
      (showLabel ? "" : "hidden") +
      '">' +
      (labelText || "") +
      "</span>" +
      "</div>";

    var marker = L.marker(latlng, {
      icon: L.divIcon({
        html: html,
        className: "station-icon-container",
        iconSize: [120, 20],
        iconAnchor: [5, 10],
        popupAnchor: [8, -5],
      }),
      interactive: true,
    });

    marker._updateLabelVisibility = function () {
      var zoom = map.getZoom();
      var el = marker.getElement();
      if (el) {
        var labelSpan = el.querySelector(".station-label");
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

  // ========== 创建无标签的纯图标标记 ==========
  /**
   * @param {L.LatLng} latlng - 坐标
   * @param {string} color - 颜色
   * @param {function} [iconFn] - 可选的图标工厂函数，默认使用圆形点
   * @returns {L.Marker}
   */
  function createPureIconMarker(latlng, color, iconFn) {
    if (iconFn) {
      return L.marker(latlng, { icon: iconFn(color) });
    }
    return L.marker(latlng, { icon: createPointIcon(color, 8) });
  }

  // ========== 根据图层类型统一创建点标记 ==========
  /**
   * @param {L.Map} map - Leaflet 地图实例
   * @param {object} feature - GeoJSON feature（用于设置 marker.feature）
   * @param {L.LatLng} latlng - 坐标
   * @param {string} color - 颜色
   * @param {string} labelText - 标签文字（如果有）
   * @param {boolean} isVolcanoLayer - 是否为火山图层
   * @param {boolean} isHotspotLayer - 是否为热点图层
   * @param {number} minZoom - 显示标签的最小缩放级别
   * @returns {L.Marker}
   */
  function createPointMarkerByType(
    map,
    feature,
    latlng,
    color,
    labelText,
    isVolcanoLayer,
    isHotspotLayer,
    minZoom,
  ) {
    var marker;
    if (isVolcanoLayer) {
      if (labelText) {
        marker = createSvgLabeledMarker(
          map,
          createVolcanoIcon,
          latlng,
          color,
          labelText,
          minZoom,
        );
      } else {
        marker = createPureIconMarker(latlng, color, createVolcanoIcon);
      }
    } else if (isHotspotLayer) {
      if (labelText) {
        marker = createSvgLabeledMarker(
          map,
          createHotspotIcon,
          latlng,
          color,
          labelText,
          minZoom,
        );
      } else {
        marker = createPureIconMarker(latlng, color, createHotspotIcon);
      }
    } else {
      // 普通点图层
      if (labelText) {
        marker = createLabeledMarker(map, latlng, color, labelText, minZoom);
      } else {
        marker = createPureIconMarker(latlng, color);
      }
    }
    if (feature) marker.feature = feature;
    return marker;
  }

  // ========== 暴露公共 API ==========
  L.GeoMarker = {
    registerIcon: registerIcon,
    createVolcanoIcon: createVolcanoIcon,
    createHotspotIcon: createHotspotIcon,
    createStarIcon: createStarIcon,
    createPointIcon: createPointIcon,
    createLabeledMarker: createLabeledMarker,
    createSvgLabeledMarker: createSvgLabeledMarker,
    createPureIconMarker: createPureIconMarker,
    createPointMarkerByType: createPointMarkerByType,
    // 聚类图标工厂
    createVolcanoClusterIcon: createVolcanoClusterIcon,
    createHotspotClusterIcon: createHotspotClusterIcon,
    createDefaultClusterIcon: createDefaultClusterIcon,
  };

  return L.GeoMarker;
});
