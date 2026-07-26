/**
 * Leaflet.LegendControl.js
 * Leaflet 图例控件插件
 *
 * 用法：
 *   const legend = L.control.legend({ position: 'bottomleft' }).addTo(map);
 *   legend.update(items);
 *
 * items 格式：
 *   [
 *     { name: "图层名", color: "#FF3333", geomType: "polygon", mode: "single" },
 *     { name: "图层名", color: "#FF3333", geomType: "point", icon: "volcano" },
 *     { name: "图层名", color: "#FF3333", geomType: "line", mode: "field",
 *       fields: [{ value: "值1", color: "rgb(100,200,50)" }, ...] }
 *   ]
 *
 * geomType: "point" | "line" | "polygon" — 决定符号形状
 * mode: "single" | "sequential" | "field" — 决定显���模式标记
 */
(function () {
  "use strict";

  if (!window.L) {
    console.warn("[LegendControl] Leaflet (L) 未就绪，跳过注册");
    return;
  }

  L.Control.Legend = L.Control.extend({
    options: {
      position: "bottomleft",
      maxFieldItems: 12,
      maxItems: 25,
    },

    initialize: function (options) {
      L.Util.setOptions(this, options);
      this._items = [];
    },

    onAdd: function (map) {
      this._map = map;
      this._container = L.DomUtil.create("div", "leaflet-legend-control");
      this._container.setAttribute("role", "list");
      this._container.setAttribute("aria-label", "图例");

      L.DomEvent.disableClickPropagation(this._container);
      L.DomEvent.disableScrollPropagation(this._container);

      this._updateDOM();
      return this._container;
    },

    onRemove: function () {
      this._container = null;
    },

    update: function (items) {
      this._items = items || [];
      this._updateDOM();
    },

    setVisible: function (visible) {
      if (this._container) {
        this._container.style.display = visible ? "" : "none";
      }
    },

    // ========== DOM 渲染 ==========

    _updateDOM: function () {
      if (!this._container) return;

      var items = this._items;
      if (!items || items.length === 0) {
        this._container.style.display = "none";
        this._container.innerHTML = "";
        return;
      }

      this._container.style.display = "";

      var total = items.length;
      var collapsed = total > this.options.maxItems;
      var html = "";

      // 标题行
      html +=
        '<div class="legend-header">' +
        '<span class="legend-title">图例</span>' +
        '<span class="legend-count">' +
        total +
        " 项</span></div>";

      html += '<div class="legend-items">';
      var showCount = collapsed ? this.options.maxItems : total;

      for (var i = 0; i < showCount; i++) {
        html += this._renderItem(items[i]);
      }

      if (collapsed) {
        html +=
          '<div class="legend-more">⋯ 还有 ' +
          (total - this.options.maxItems) +
          " 项</div>";
      }
      html += "</div>";

      this._container.innerHTML = html;
    },

    _renderItem: function (item) {
      var geom = item.geomType || "polygon";
      var hasFields = item.fields && item.fields.length > 0;

      if (hasFields) {
        return this._renderExpandableItem(item, geom);
      }
      return this._renderPlainItem(item, geom);
    },

    /**
     * 渲染普通图层（单色 / 多色 sequential / 图标）
     */
    _renderPlainItem: function (item, geom) {
      var cls = "legend-item";
      var modeLabel = "";
      if (item.mode === "sequential") {
        cls += " legend-item-sequential";
        modeLabel =
          '<span class="legend-badge" title="多色显示：每个要素自动分配不同颜色">多色</span>';
      }

      var html = '<div class="' + cls + '" role="listitem">';
      html += '<div class="legend-row">';
      html += this._renderGeomSymbol(item.color, geom, item.icon);
      html +=
        '<span class="legend-name" title="' + this._esc(item.name) + '">' +
        this._esc(item.name) +
        "</span>";
      html += modeLabel;
      html += "</div>";
      html += "</div>";
      return html;
    },

    /**
     * 渲染可展开图层（字段分色 field）— 用 <details> 原生折叠
     */
    _renderExpandableItem: function (item, geom) {
      var fieldCount = item.fields.length;
      var maxF = this.options.maxFieldItems;
      var showF = Math.min(fieldCount, maxF);

      var html =
        '<details class="legend-item legend-item-fields legend-expandable" role="listitem">';

      // summary 行（点击展开/折叠）
      html += '<summary class="legend-row legend-expand-row">';
      html +=
        '<span class="legend-expand-arrow" aria-hidden="true"></span>';
      html += this._renderGeomSymbol(item.color, geom);
      html +=
        '<span class="legend-name" title="' + this._esc(item.name) + '">' +
        this._esc(item.name) +
        "</span>";
      html +=
        '<span class="legend-badge" title="按字段唯一值分色显示">' +
        fieldCount +
        " 色</span>";
      html += "</summary>";

      // 子项列表
      html += '<div class="legend-sub-items">';
      for (var i = 0; i < showF; i++) {
        var f = item.fields[i];
        html += '<div class="legend-sub-item">';
        html += this._renderGeomSymbol(f.color, geom, null, true);
        html +=
          '<span class="legend-sub-name" title="' +
          this._esc(f.value) +
          '">' +
          this._esc(f.value) +
          "</span>";
        html += "</div>";
      }
      if (fieldCount > maxF) {
        html +=
          '<div class="legend-sub-more">⋯ 还有 ' +
          (fieldCount - maxF) +
          " 种</div>";
      }
      html += "</div>";

      html += "</details>";
      return html;
    },

    /**
     * 渲染几何符号
     * @param {string} color - 颜色
     * @param {string} geom - "point" | "line" | "polygon"
     * @param {string|null} icon - 可选图标类型
     * @param {boolean} small - 是否为子项小尺寸
     */
    _renderGeomSymbol: function (color, geom, icon, small) {
      color = color || "#999";
      var size = small ? 9 : 13;

      // 图标类型图层用 emoji 或图片
      if (icon && !small) {
        var builtinIcons = {
          volcano: "🌋",
          hotspot: "🔥",
          star: "⭐",
          point: "●",
        };
        if (builtinIcons[icon]) {
          return (
            '<span class="legend-icon-emoji" aria-hidden="true">' +
            builtinIcons[icon] +
            "</span>"
          );
        }
        if (icon.indexOf("/") !== -1 || icon.indexOf(".") !== -1) {
          return (
            '<span class="legend-icon-img" style="background-image:url(' +
            this._esc(icon) +
            ');" aria-hidden="true"></span>'
          );
        }
      }

      // 点要素：圆形
      if (geom === "point") {
        return (
          '<svg class="legend-sym' +
          (small ? " legend-sym-sm" : "") +
          '" width="' +
          size +
          '" height="' +
          size +
          '" viewBox="0 0 ' +
          size +
          " " +
          size +
          '"><circle cx="' +
          size / 2 +
          '" cy="' +
          size / 2 +
          '" r="' +
          (size / 2 - 1) +
          '" fill="' +
          color +
          '" stroke="rgba(0,0,0,0.18)" stroke-width="0.5"/></svg>'
        );
      }

      // 线要素：横线
      if (geom === "line") {
        var sw = small ? 1.5 : 2;
        return (
          '<svg class="legend-sym' +
          (small ? " legend-sym-sm" : "") +
          '" width="' +
          size +
          '" height="' +
          size +
          '" viewBox="0 0 ' +
          size +
          " " +
          size +
          '"><line x1="1" y1="' +
          size / 2 +
          '" x2="' +
          (size - 1) +
          '" y2="' +
          size / 2 +
          '" stroke="' +
          color +
          '" stroke-width="' +
          sw +
          '" stroke-linecap="round"/></svg>'
        );
      }

      // 面要素（默认）：方块
      return (
        '<span class="legend-swatch' +
        (small ? " legend-swatch-sm" : "") +
        '" style="background:' +
        color +
        ";width:" +
        (size - 2) +
        "px;height:" +
        (size - 2) +
        'px;" aria-hidden="true"></span>'
      );
    },

    _esc: function (str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    },
  });

  L.control.legend = function (options) {
    return new L.Control.Legend(options);
  };
})();
