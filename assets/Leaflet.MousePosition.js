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
   * @param {Boolean} options.showFullscreen 是否在文字末尾追加全屏图标，默认false
   * @param {String} options.fullscreenTarget 全屏目标元素的CSS选择器，默认为整个document.documentElement
   */
  L.Control.MousePosition = L.Control.extend({
    options: {
      position: "bottomright",
      format: "纬度: {lat}, 经度: {lng}",
      className: "leaflet-mouse-position",
      precision: 6,
      showZoom: false,
      zoomLabel: "级别: {zoom}，",
      showFullscreen: false,
      fullscreenTarget: null,
    },

    // 缓存：上一次的有效坐标（保证经纬度不消失）+ 当前缩放级别（单独管理）
    _lastValidLatLng: null,
    _currentZoom: null,
    _lastText: "",

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

      // 全屏功能：容器整体可点击
      if (this.options.showFullscreen) {
        this._container.style.cursor = "pointer";
        this._container.title = "点击全屏";
        L.DomEvent.on(this._container, "click", this._onFullscreenClick, this);

        // 监听浏览器全屏状态变化（Esc退出时同步图标）
        this._fsChangeHandler = () => this._renderText(this._lastText);
        document.addEventListener("fullscreenchange", this._fsChangeHandler);
        document.addEventListener("webkitfullscreenchange", this._fsChangeHandler);
        document.addEventListener("mozfullscreenchange", this._fsChangeHandler);
        document.addEventListener("MSFullscreenChange", this._fsChangeHandler);
      }

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
            this._updatePosition(initLatLng);
          }
        }, 100);
      }

      return this._container;
    },

    onRemove: function (map) {
      this._unbindEvents();
      if (this.options.showFullscreen) {
        L.DomEvent.off(this._container, "click", this._onFullscreenClick, this);
        if (this._fsChangeHandler) {
          document.removeEventListener("fullscreenchange", this._fsChangeHandler);
          document.removeEventListener("webkitfullscreenchange", this._fsChangeHandler);
          document.removeEventListener("mozfullscreenchange", this._fsChangeHandler);
          document.removeEventListener("MSFullscreenChange", this._fsChangeHandler);
          this._fsChangeHandler = null;
        }
      }
      this._lastValidLatLng = null;
      this._currentZoom = null;
      this._lastText = "";
    },

    // ========== 全屏逻辑 ==========
    _isFullscreen: function () {
      return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
    },

    _onFullscreenClick: function (e) {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);

      if (this._isFullscreen()) {
        const exitFn =
          document.exitFullscreen ||
          document.webkitExitFullscreen ||
          document.mozCancelFullScreen ||
          document.msExitFullscreen;
        if (exitFn) exitFn.call(document);
      } else {
        const target = this.options.fullscreenTarget
          ? document.querySelector(this.options.fullscreenTarget)
          : document.documentElement;
        const el = target || document.documentElement;
        const reqFn =
          el.requestFullscreen ||
          el.webkitRequestFullscreen ||
          el.mozRequestFullScreen ||
          el.msRequestFullscreen;
        if (reqFn) reqFn.call(el);
      }
    },

    // 渲染：文字 + 全屏图标（图标在末尾）
    _renderText: function (text) {
      if (!this._container) return;
      if (this.options.showFullscreen) {
        const icon = this._isFullscreen() ? " ✕" : " ⛶";
        this._container.textContent = text + icon;
        this._container.title = this._isFullscreen() ? "退出全屏" : "点击全屏";
      } else {
        this._container.textContent = text;
      }
    },

    // 事件绑定：经纬度实时触发 + 缩放级别仅在结束后触发
    _bindEvents: function () {
      const map = this._map;
      if (this._isMobile) {
        L.DomEvent.on(map, "move", this._updateCenterPosition, this);
        L.DomEvent.on(map, "zoom", this._updateCenterPosition, this);
        L.DomEvent.on(map, "load", this._updateCenterPosition, this);
      } else {
        L.DomEvent.on(map, "mousemove", this._onMouseMove, this);
      }

      if (this.options.showZoom) {
        L.DomEvent.on(map, "zoomend", this._updateZoom, this);
        this._updateZoom();
      }
    },

    _unbindEvents: function () {
      const map = this._map;
      if (!map) return;
      if (this._isMobile) {
        L.DomEvent.off(map, "move", this._updateCenterPosition, this);
        L.DomEvent.off(map, "zoom", this._updateCenterPosition, this);
        L.DomEvent.off(map, "load", this._updateCenterPosition, this);
      } else {
        L.DomEvent.off(map, "mousemove", this._onMouseMove, this);
      }
      if (this.options.showZoom) {
        L.DomEvent.off(map, "zoomend", this._updateZoom, this);
      }
    },

    _onMouseMove: function (e) {
      if (!e || !e.latlng) return;
      this._lastValidLatLng = e.latlng;
      this._updatePosition(e.latlng);
    },

    _updateCenterPosition: function () {
      if (!this._map) return;
      const centerLatLng = this._map.getCenter();
      if (centerLatLng) {
        this._lastValidLatLng = centerLatLng;
      }
      this._updatePosition(centerLatLng || this._lastValidLatLng);
    },

    _updatePosition: function (latlng) {
      const targetLatLng = latlng || this._lastValidLatLng;
      if (!targetLatLng || !this._map) {
        this._updateText("---, ---");
        return;
      }

      const lat = targetLatLng.lat.toFixed(this.options.precision);
      const lng = targetLatLng.lng.toFixed(this.options.precision);

      let text = this.options.format
        .replace("{lat}", lat)
        .replace("{lng}", lng);

      if (this.options.showZoom && this._currentZoom) {
        const zoomText = this.options.zoomLabel.replace(
          "{zoom}",
          this._currentZoom,
        );
        text = zoomText + text;
      }

      this._updateText(text);
    },

    _updateZoom: function () {
      if (!this._map || !this.options.showZoom) return;
      this._currentZoom = this._map.getZoom();
      this._updatePosition(this._lastValidLatLng);
    },

    _updateText: function (text) {
      this._lastText = text;
      this._renderText(text);
    },
  });

  L.control.mousePosition = function (options) {
    return new L.Control.MousePosition(options);
  };
})(window.L);
