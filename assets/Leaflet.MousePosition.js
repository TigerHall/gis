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
   * @param {Boolean} options.showFullscreen 是否在文字末尾追加全屏/安装图标，默认false
   * @param {String} options.fullscreenTarget 全屏目标元素的CSS选择器，默认为整个document.documentElement
   *
   * 全屏/安装图标行为说明：
   *   - 未安装 PWA（浏览器触发了 beforeinstallprompt）：点击图标唤起安装弹窗
   *   - 已安装 PWA（standalone 模式）且非 iOS：点击图标切换全屏
   *   - 已安装 PWA 且为 iOS 手机浏览器：不显示图标（iOS Safari 无全屏API，已安装即全屏体验）
   *   - 既未触发安装提示也非 standalone（普通桌面浏览器）：保持全屏行为
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
    _isIOSPhone: /iPhone|iPod/.test(navigator.userAgent) && !window.MSStream,
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

      // PWA 安装状态检测
      this._isPWAInstalled = window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true; // iOS Safari standalone

      // 捕获 beforeinstallprompt（在 onAdd 调用时可能已经触发过，所以从全局取）
      this._deferredInstallPrompt = window._pwaInstallPrompt || null;

      if (this.options.showFullscreen) {
        // iOS 手机 + 已安装 PWA：隐藏图标，不绑定任何点击
        var shouldHideIcon = this._isIOSPhone && this._isPWAInstalled;

        if (!shouldHideIcon) {
          this._container.style.cursor = "pointer";
          this._updateActionTitle();
          L.DomEvent.on(this._container, "click", this._onActionClick, this);
        }

        // 监听浏览器全屏状态变化（Esc退出时同步图标）
        this._fsChangeHandler = function () { this._renderText(this._lastText); }.bind(this);
        document.addEventListener("fullscreenchange", this._fsChangeHandler);
        document.addEventListener("webkitfullscreenchange", this._fsChangeHandler);
        document.addEventListener("mozfullscreenchange", this._fsChangeHandler);
        document.addEventListener("MSFullscreenChange", this._fsChangeHandler);

        // 监听 beforeinstallprompt（如果尚未触发，等待后续触发）
        this._installPromptHandler = function (e) {
          e.preventDefault();
          this._deferredInstallPrompt = e;
          window._pwaInstallPrompt = e; // 全局共享
          this._isPWAInstalled = false;
          this._updateActionTitle();
          this._renderText(this._lastText);
        }.bind(this);
        window.addEventListener("beforeinstallprompt", this._installPromptHandler);

        // 监听 appinstalled（安装完成后切换为全屏模式）
        this._appInstalledHandler = function () {
          this._deferredInstallPrompt = null;
          window._pwaInstallPrompt = null;
          this._isPWAInstalled = true;
          this._updateActionTitle();
          this._renderText(this._lastText);
        }.bind(this);
        window.addEventListener("appinstalled", this._appInstalledHandler);
      }

      // 初始化缩放级别
      this._currentZoom = this._map.getZoom();
      this._bindEvents();

      // 初始化显示
      this._updateText("---, ---");
      if (this._isMobile) {
        setTimeout(function () {
          var initLatLng = this._map.getCenter();
          if (initLatLng) {
            this._lastValidLatLng = initLatLng;
            this._updatePosition(initLatLng);
          }
        }.bind(this), 100);
      }

      return this._container;
    },

    onRemove: function (map) {
      this._unbindEvents();
      if (this.options.showFullscreen) {
        L.DomEvent.off(this._container, "click", this._onActionClick, this);
        if (this._fsChangeHandler) {
          document.removeEventListener("fullscreenchange", this._fsChangeHandler);
          document.removeEventListener("webkitfullscreenchange", this._fsChangeHandler);
          document.removeEventListener("mozfullscreenchange", this._fsChangeHandler);
          document.removeEventListener("MSFullscreenChange", this._fsChangeHandler);
          this._fsChangeHandler = null;
        }
        if (this._installPromptHandler) {
          window.removeEventListener("beforeinstallprompt", this._installPromptHandler);
          this._installPromptHandler = null;
        }
        if (this._appInstalledHandler) {
          window.removeEventListener("appinstalled", this._appInstalledHandler);
          this._appInstalledHandler = null;
        }
        this._removePwaHint();
        this._removeIosHint();
      }
      this._lastValidLatLng = null;
      this._currentZoom = null;
      this._lastText = "";
    },

    // ========== 动作路由：根据 PWA 状态决定行为 ==========
    _onActionClick: function (e) {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);

      // 情况1：有待处理的安装提示 → 唤起 PWA 安装弹窗
      if (this._deferredInstallPrompt) {
        this._triggerPwaInstall();
        return;
      }

      // 情况2：iOS 手机浏览器（未安装 PWA，无 beforeinstallprompt）→ 显示安装引导
      if (this._isIOSPhone && !this._isPWAInstalled) {
        this._showIosHint();
        return;
      }

      // 情况3：已安装 PWA 或普通浏览器 → 全屏切换
      if (this._isIOS || !this._fsSupported) {
        // iOS 已安装但仍无全屏 API（不应走到这里，但做兜底）
        return;
      }
      this._toggleFullscreen();
    },

    // 根据当前状态更新 title 提示文字
    _updateActionTitle: function () {
      if (!this._container) return;
      if (this._deferredInstallPrompt) {
        this._container.title = "安装到桌面（PWA）";
      } else if (this._isIOSPhone && !this._isPWAInstalled) {
        this._container.title = "安装到主屏幕";
      } else {
        this._container.title = this._isFullscreen() ? "退出全屏" : "点击全屏";
      }
    },

    // ========== PWA 安装逻辑 ==========
    _triggerPwaInstall: function () {
      var prompt = this._deferredInstallPrompt;
      if (!prompt) return;
      prompt.prompt();
      prompt.userChoice.then(function (choiceResult) {
        if (choiceResult.outcome === "accepted") {
          this._deferredInstallPrompt = null;
          window._pwaInstallPrompt = null;
          this._isPWAInstalled = true;
          this._updateActionTitle();
          this._renderText(this._lastText);
        }
        // 用户拒绝则保留 prompt，下次仍可再次唤起
      }.bind(this));
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

    _toggleFullscreen: function () {
      if (this._isFullscreen()) {
        var exitFn =
          document.exitFullscreen ||
          document.webkitExitFullscreen ||
          document.mozCancelFullScreen ||
          document.msExitFullscreen;
        if (exitFn) exitFn.call(document);
      } else {
        var target = this.options.fullscreenTarget
          ? document.querySelector(this.options.fullscreenTarget)
          : document.documentElement;
        var el = target || document.documentElement;
        var reqFn =
          el.requestFullscreen ||
          el.webkitRequestFullscreen ||
          el.mozRequestFullScreen ||
          el.msRequestFullscreen;
        if (reqFn) reqFn.call(el);
      }
    },

    // ========== iOS 安装引导提示（底部弹出） ==========
    _showIosHint: function () {
      this._removeIosHint(); // 防止重复

      var overlay = L.DomUtil.create("div", "lmp-ios-hint-overlay");
      var box = L.DomUtil.create("div", "lmp-ios-hint-box", overlay);

      box.innerHTML =
        '<div class="lmp-ios-hint-title">添加到主屏幕</div>' +
        '<div class="lmp-ios-hint-body">' +
          "iOS 浏览器不支持网页全屏，" +
          "将应用添加到主屏幕后可获得全屏体验：" +
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

    // ========== PWA 安装提示（中间弹出卡片，用于非 iOS 场景的降级提示） ==========
    _showPwaHint: function () {
      this._removePwaHint();

      var overlay = L.DomUtil.create("div", "lmp-pwa-hint-overlay");
      var box = L.DomUtil.create("div", "lmp-pwa-hint-box", overlay);

      box.innerHTML =
        '<div class="lmp-pwa-hint-title">安装到桌面</div>' +
        '<div class="lmp-pwa-hint-body">点击浏览器地址栏右侧的安装按钮，或通过浏览器菜单选择「安装应用」。</div>' +
        '<button class="lmp-pwa-hint-close">知道了</button>';

      document.body.appendChild(overlay);

      var closeBtn = box.querySelector(".lmp-pwa-hint-close");
      L.DomEvent.on(closeBtn, "click", this._removePwaHint, this);
      L.DomEvent.on(overlay, "click", function (e) {
        if (e.target === overlay) this._removePwaHint();
      }, this);

      this._pwaHintEl = overlay;
    },

    _removePwaHint: function () {
      if (this._pwaHintEl && this._pwaHintEl.parentNode) {
        this._pwaHintEl.parentNode.removeChild(this._pwaHintEl);
      }
      this._pwaHintEl = null;
    },

    // ========== 渲染文字 + 图标 ==========
    _getActionIcon: function () {
      // iOS 手机已安装：不显示图标（onAdd 时直接不绑定事件，此处冗余保护）
      if (this._isIOSPhone && this._isPWAInstalled) return "";

      // 有安装提示 → 显示安装图标
      if (this._deferredInstallPrompt) return " ⊕";

      // iOS 手机未安装 → 显示分享/添加图标
      if (this._isIOSPhone && !this._isPWAInstalled) return " ⬆";

      // 全屏状态
      return this._isFullscreen() ? " ✕" : " ⛶";
    },

    _renderText: function (text) {
      if (!this._container) return;
      if (this.options.showFullscreen) {
        var icon = this._getActionIcon();
        this._container.textContent = text + icon;
        this._updateActionTitle();
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
