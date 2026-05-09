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

    // 缓存：上一次的有效坐标 + 当前缩放级别
    _lastValidLatLng: null,
    _currentZoom: null,
    _lastText: "",

    // 设备/能力检测
    _isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream,
    _fsSupported: !!(
      document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen ||
      document.documentElement.mozRequestFullScreen ||
      document.documentElement.msRequestFullscreen
    ),

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
        this._removeIosHint();
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

      // iOS 不支持网页全屏 API，显示引导提示
      if (this._isIOS || !this._fsSupported) {
        this._showIosHint();
        return;
      }

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

    // ========== iOS 全屏引导提示 ==========
    _showIosHint: function () {
      this._removeIosHint(); // 防止重复

      var overlay = L.DomUtil.create("div", "lmp-ios-hint-overlay");
      var box = L.DomUtil.create("div", "lmp-ios-hint-box", overlay);

      box.innerHTML =
        '<div class="lmp-ios-hint-title">全屏提示</div>' +
        '<div class="lmp-ios-hint-body">' +
          "iOS 浏览器不支持网页全屏，" +
          "如需全屏体验，请按以下步骤操作：" +
          '<ol class="lmp-ios-hint-steps">' +
            "<li>点击底部工具栏的 <b>分享按钮</b> △</li>" +
            "<li>选择 <b>「添加到主屏幕」</b></li>" +
            "<li>从桌面图标重新打开即可全屏运行</li>" +
          "</ol>" +
        "</div>" +
        '<button class="lmp-ios-hint-close">知道了</button>';

      document.body.appendChild(overlay);

      var closeBtn = box.querySelector(".lmp-ios-hint-close");
      L.DomEvent.on(closeBtn, "click", this._removeIosHint, this);
      // 点遮罩空白区域也关闭
      L.DomEvent.on(overlay, "click", function (e) {
        if (e.target === overlay) this._removeIosHint();
      }, this);

      this._iosHintEl = overlay;
    },

    _removeIosHint: function () {
      if (this._iosHintEl && this._iosHintEl.parentNode) {
        this._iosHintEl.parentNode.removeChild(this._iosHintEl);
      }
      this._iosHintEl = null;
    },

    // 渲染：文字 + 全屏图标（图标在末尾）
    _renderText: function (text) {
      if (!this._container) return;
      if (this.options.showFullscreen) {
        var icon = this._isFullscreen() ? " ✕" : " ⛶";
        this._container.textContent = text + icon;
        this._container.title = this._isFullscreen() ? "退出全屏" : "点击全屏";
      } else {
        this._container.textContent = text;
      }
    },

    // 事件绑定
    _bindEvents: function () {
      var map = this._map;
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
      var map = this._map;
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
      var centerLatLng = this._map.getCenter();
      if (centerLatLng) {
        this._lastValidLatLng = centerLatLng;
      }
      this._updatePosition(centerLatLng || this._lastValidLatLng);
    },

    _updatePosition: function (latlng) {
      var targetLatLng = latlng || this._lastValidLatLng;
      if (!targetLatLng || !this._map) {
        this._updateText("---, ---");
        return;
      }

      var lat = targetLatLng.lat.toFixed(this.options.precision);
      var lng = targetLatLng.lng.toFixed(this.options.precision);

      var text = this.options.format
        .replace("{lat}", lat)
        .replace("{lng}", lng);

      if (this.options.showZoom && this._currentZoom) {
        var zoomText = this.options.zoomLabel.replace(
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
