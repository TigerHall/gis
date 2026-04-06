(function (L) {
  if (!L) {
    throw new Error("Leaflet is not loaded");
  }

  /**
   * 自定义经纬度显示插件（PC跟随鼠标/移动端显示地图中心）
   * @param {Object} options 配置项
   * @param {String} options.position 插件控件位置
   * @param {String} options.format 显示格式，支持 {lat}、{lng}、{zoom} 占位符
   * @param {String} options.className 自定义CSS类名
   * @param {Number} options.precision 经纬度小数精度
   * @param {Boolean} options.showZoom 是否显示瓦片级别（缩放层级），默认false
   * @param {String} options.zoomLabel 瓦片级别显示的文本标签，默认"级别: {zoom}，"
   */
  L.Control.MousePosition = L.Control.extend({
    options: {
      position: "bottomright",
      format: "纬度: {lat}, 经度: {lng}",
      className: "leaflet-mouse-position",
      precision: 6,
      showZoom: false,
      zoomLabel: "级别: {zoom}，",
    },

    // 缓存：上一次的有效坐标（保证经纬度不消失）+ 当前缩放级别（单独管理）
    _lastValidLatLng: null,
    _currentZoom: null,

    // 初始化控件
    onAdd: function (map) {
      this._map = map;
      this._isMobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent,
        );

      this._container = L.DomUtil.create("div", this.options.className);
      L.DomUtil.addClass(this._container, "leaflet-bar");
      L.DomUtil.addClass(this._container, "leaflet-control");
      L.DomEvent.disableClickPropagation(this._container);

      // 初始化缩放级别
      this._currentZoom = this._map.getZoom();
      // 绑定事件：经纬度实时更新 + 缩放级别单独处理
      this._bindEvents();

      // 初始化显示
      this._updateText("---, ---");
      if (this._isMobile) {
        setTimeout(() => {
          const initLatLng = this._map.getCenter();
          if (initLatLng) {
            this._lastValidLatLng = initLatLng;
            this._updatePosition(initLatLng); // 仅更新经纬度
          }
        }, 100);
      }

      return this._container;
    },

    onRemove: function (map) {
      this._unbindEvents();
      this._lastValidLatLng = null;
      this._currentZoom = null;
    },

    // 事件绑定：经纬度实时触发 + 缩放级别仅在结束后触发
    _bindEvents: function () {
      const map = this._map;
      // ========== 1. 经纬度：保持原有实时触发方式（不修改） ==========
      if (this._isMobile) {
        // 移动端：地图移动/缩放过程中实时更新经纬度（原有逻辑）
        L.DomEvent.on(map, "move", this._updateCenterPosition, this);
        L.DomEvent.on(map, "zoom", this._updateCenterPosition, this);
        L.DomEvent.on(map, "load", this._updateCenterPosition, this);
      } else {
        // PC端：鼠标移动实时更新经纬度（原有逻辑）
        L.DomEvent.on(map, "mousemove", this._onMouseMove, this);
      }

      // ========== 2. 缩放级别：单独绑定，仅在缩放结束后更新 ==========
      if (this.options.showZoom) {
        // 仅zoomend触发级别更新，避免缩放过程中级别跳动
        L.DomEvent.on(map, "zoomend", this._updateZoom, this);
        // 初始化时更新一次级别
        this._updateZoom();
      }
    },

    _unbindEvents: function () {
      const map = this._map;
      if (!map) return;
      // 解绑经纬度事件（原有逻辑）
      if (this._isMobile) {
        L.DomEvent.off(map, "move", this._updateCenterPosition, this);
        L.DomEvent.off(map, "zoom", this._updateCenterPosition, this);
        L.DomEvent.off(map, "load", this._updateCenterPosition, this);
      } else {
        L.DomEvent.off(map, "mousemove", this._onMouseMove, this);
      }
      // 解绑缩放级别事件
      if (this.options.showZoom) {
        L.DomEvent.off(map, "zoomend", this._updateZoom, this);
      }
    },

    // ========== 经纬度相关：完全保留原有逻辑 ==========
    _onMouseMove: function (e) {
      if (!e || !e.latlng) return;
      this._lastValidLatLng = e.latlng;
      this._updatePosition(e.latlng); // 仅更新经纬度
    },

    _updateCenterPosition: function () {
      if (!this._map) return;
      const centerLatLng = this._map.getCenter();
      if (centerLatLng) {
        this._lastValidLatLng = centerLatLng;
      }
      this._updatePosition(centerLatLng || this._lastValidLatLng); // 仅更新经纬度
    },

    // 仅更新经纬度（保留原有逻辑，不处理缩放级别）
    _updatePosition: function (latlng) {
      const targetLatLng = latlng || this._lastValidLatLng;
      if (!targetLatLng || !this._map) {
        this._updateText("---, ---");
        return;
      }

      // 仅处理经纬度（原有逻辑）
      const lat = targetLatLng.lat.toFixed(this.options.precision);
      const lng = targetLatLng.lng.toFixed(this.options.precision);

      // 先拼接经纬度基础文本
      let text = this.options.format
        .replace("{lat}", lat)
        .replace("{lng}", lng);
      // 如果开启显示级别，拼接已缓存的级别（避免实时跳动）
      if (this.options.showZoom && this._currentZoom) {
        const zoomText = this.options.zoomLabel.replace(
          "{zoom}",
          this._currentZoom,
        );
        text = zoomText + text;
      }

      this._updateText(text);
    },

    // ========== 缩放级别：单独处理（仅zoomend触发） ==========
    _updateZoom: function () {
      if (!this._map || !this.options.showZoom) return;
      // 更新缩放级别缓存
      this._currentZoom = this._map.getZoom();
      // 仅更新显示文本（复用_updatePosition，用缓存的坐标+新级别）
      this._updatePosition(this._lastValidLatLng);
    },

    _updateText: function (text) {
      if (this._container) {
        this._container.innerHTML = text;
      }
    },
  });

  L.control.mousePosition = function (options) {
    return new L.Control.MousePosition(options);
  };
})(window.L);
