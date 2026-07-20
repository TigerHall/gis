/*
 * Leaflet.ElevationQuery
 * 标准 Leaflet 插件：点击地图查询任意坐标的高程 / 水深。
 * 数据源可配置（默认 GEBCO WMS GetFeatureInfo），便于后续切换高程源。
 *
 * 用法（单例，绑定到地图）：
 *   var eq = map.elevationQuery({ source: 'gebco' });
 *   eq.enable();            // 开启：点击地图即查询
 *   eq.disable();           // 关闭
 *   eq.query(latlng);       // 主动查询，返回 Promise<result>
 *   eq.setSource('gebco');  // 运行时切换数据源（后续换高程源）
 *
 * 自定义数据源（后续换源只需改 source）：
 *   map.elevationQuery({
 *     source: {
 *       name: '我的数据源',
 *       // 必须返回 Promise；resolve 值为 number 或 { value, unit?, label? }
 *       query: function (latlng, ctx) {
 *         return fetch('/api/elev?lat=' + latlng.lat + '&lng=' + latlng.lng)
 *           .then(function (r) { return r.json(); })
 *           .then(function (d) { return { value: d.elevation, unit: 'm' }; });
 *       }
 *     }
 *   });
 */
(function (global) {
  "use strict";

  if (typeof L === "undefined") {
    console.error("[ElevationQuery] 需要先加载 Leaflet");
    return;
  }

  // ========== 内置高程源 ==========
  // GEBCO 全球水深 / 高程（WMS GetFeatureInfo）
  function makeGebcoSource(cfg) {
    cfg = cfg || {};
    var url = cfg.url || "https://wms.gebco.net/mapserv?";
    var layers = cfg.layers || "GEBCO_LATEST_2";
    var version = cfg.version || "1.3.0";
    var infoFormat = cfg.infoFormat || "text/plain";
    var crs = cfg.crs || "EPSG:4326";
    var parser = cfg.parser || defaultElevationParser;

    return {
      name: cfg.name || "GEBCO",
      attribution: cfg.attribution || "Bathymetry: GEBCO",
      // ctx.map 提供地图实例，用于计算点击像素坐标与视窗 BBOX
      query: function (latlng, ctx) {
        var map = (ctx && ctx.map) || global.map;
        if (!map) return Promise.reject(new Error("地图尚未就绪"));

        var point = map.latLngToContainerPoint(latlng);
        var i = Math.round(point.x);
        var j = Math.round(point.y);
        var size = map.getSize();
        var bounds = map.getBounds();

        var params = {
          service: "WMS",
          version: version,
          request: "GetFeatureInfo",
          layers: layers,
          query_layers: layers,
          styles: "",
          crs: crs,
          bbox: bounds.toBBoxString(),
          width: size.x,
          height: size.y,
          info_format: infoFormat,
          i: i,
          j: j,
        };
        // 第三个参数 true → 参数名大写（WMS 标准），与样例一致
        var reqUrl = url + L.Util.getParamString(params, "", true);

        return fetch(reqUrl)
          .then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.text();
          })
          .then(function (text) {
            var val = parser(text);
            if (val === null || val === undefined || isNaN(val)) {
              var e = new Error("未能解析高程值，请查看控制台日志");
              e.rawText = text;
              throw e;
            }
            return { value: val, unit: "m", raw: text };
          });
      },
    };
  }

  // 解析 GEBCO GetFeatureInfo 文本响应，提取数值
  function defaultElevationParser(responseText) {
    if (!responseText) return null;
    // 优先匹配 value_list = '数字'
    var match = responseText.match(
      /value_list\s*=\s*['"]?([-+]?\d*\.?\d+)['"]?/,
    );
    if (match && match[1]) {
      var v = parseFloat(match[1]);
      if (!isNaN(v) && isFinite(v)) return v;
    }
    // 备用：直接匹配首个数字
    var numMatch = responseText.match(/[-+]?\d+\.?\d*/);
    if (numMatch) {
      var n = parseFloat(numMatch[0]);
      if (!isNaN(n) && isFinite(n)) return n;
    }
    return null;
  }

  var ELEV_SOURCES = {
    gebco: function () {
      return makeGebcoSource();
    },
  };

  // ========== 插件主体 ==========
  var ElevationQuery = L.Class.extend({
    includes: [L.Evented.prototype],

    options: {
      source: "gebco",
      active: false,
      popupOptions: {
        className: "elev-query-popup",
        closeButton: true,
        autoPan: true,
        maxWidth: 280,
      },
      loadingText: "⏳ 高程查询中…",
      hintText: "🖱️ 已开启高程读取，点击地图任意位置查询",
    },

    initialize: function (options) {
      L.setOptions(this, options);
      this._map = null;
      this._active = false;
      this._bar = null;
      this._source = this._normalizeSource(this.options.source);
    },

    // 运行时切换数据源（后续换高程源）
    setSource: function (source) {
      this._source = this._normalizeSource(source);
      return this;
    },

    _normalizeSource: function (source) {
      if (!source) return ELEV_SOURCES.gebco();
      if (typeof source === "function")
        return { name: "自定义", query: source };
      if (typeof source === "string") {
        if (ELEV_SOURCES[source]) return ELEV_SOURCES[source]();
        return ELEV_SOURCES.gebco();
      }
      if (source.type === "wms") return makeGebcoSource(source); // 复用 WMS 构造
      if (typeof source.query === "function") return source;
      return ELEV_SOURCES.gebco();
    },

    addTo: function (map) {
      this._map = map;
      if (this.options.active) this.enable();
      return this;
    },

    remove: function () {
      this.disable();
      if (this._bar && this._bar.parentNode) {
        this._bar.parentNode.removeChild(this._bar);
      }
      this._bar = null;
      this._map = null;
      return this;
    },

    enable: function () {
      if (!this._map || this._active) return this;
      this._active = true;
      this._map.on("click", this._onClick, this);
      this._ensureBar();
      this._showHint();
      this.fire("enable");
      return this;
    },

    disable: function () {
      if (!this._map || !this._active) return this;
      this._active = false;
      this._map.off("click", this._onClick, this);
      this._hideBar();
      this.fire("disable");
      return this;
    },

    _onClick: function (e) {
      this.query(e.latlng);
    },

    // 公开查询方法，返回 Promise
    query: function (latlng) {
      if (!this._map) return Promise.reject(new Error("未绑定地图"));
      if (!this._source) return Promise.reject(new Error("未配置数据源"));
      var self = this;
      this.fire("querystart", { latlng: latlng });
      this._setBarLoading();
      return Promise.resolve()
        .then(function () {
          return self._source.query(latlng, { map: self._map });
        })
        .then(function (result) {
          result = self._normalizeResult(result, latlng);
          self._showResult(latlng, result);
          self.fire("result", { latlng: latlng, result: result });
          return result;
        })
        .catch(function (err) {
          var msg = (err && err.message) || String(err);
          if (err && err.message && /解析/.test(err.message)) {
            console.warn("[ElevationQuery] 原始响应见下：", err.rawText);
          }
          self._showError(latlng, msg);
          self.fire("error", { latlng: latlng, error: err });
        });
    },

    _normalizeResult: function (res, latlng) {
      if (typeof res === "number") res = { value: res };
      var value = res && res.value !== undefined ? Number(res.value) : NaN;
      var unit = (res && res.unit) || "m";
      var label = res && res.label ? res.label : value < 0 ? "水深" : "高程";
      var isDepth = value < 0;
      return {
        value: value,
        unit: unit,
        label: label,
        isDepth: isDepth,
        raw: res && res.raw,
        sourceName: this._source && this._source.name,
        latlng: latlng,
      };
    },

    // ---------- UI ----------
    _ensureBar: function () {
      if (this._bar) return;
      var bar = document.createElement("div");
      bar.className = "elev-query-bar";
      bar.setAttribute("role", "status");
      bar.setAttribute("aria-live", "polite");
      document.body.appendChild(bar);
      this._bar = bar;
    },

    _showHint: function () {
      if (!this._bar) return;
      this._bar.className = "elev-query-bar";
      this._bar.innerHTML = this.options.hintText;
      this._bar.classList.add("show");
    },

    _setBarLoading: function () {
      if (!this._bar) this._ensureBar();
      this._bar.className = "elev-query-bar is-loading";
      this._bar.innerHTML = this.options.loadingText;
      this._bar.classList.add("show");
    },

    _hideBar: function () {
      if (!this._bar) return;
      this._bar.classList.remove("show");
    },

    _showResult: function (latlng, r) {
      // 底部信息栏
      var cls = r.isDepth ? "is-depth" : "is-elev";
      this._bar.className = "elev-query-bar " + cls;
      this._bar.innerHTML =
        '<span class="elev-coord">' +
        latlng.lat.toFixed(4) +
        ", " +
        latlng.lng.toFixed(4) +
        "</span>" +
        '<span class="elev-sep">|</span>' +
        '<span class="elev-value">' +
        r.label +
        ": " +
        Math.abs(r.value).toFixed(1) +
        " " +
        r.unit +
        "</span>";
      this._bar.classList.add("show");

      // 点击位置弹窗（复用地图弹窗设计语言）
      var popupHtml =
        '<div class="elev-popup ' +
        cls +
        '">' +
        '<div class="elev-popup-title">📍 高程读取</div>' +
        '<div class="elev-popup-body"><table><tbody>' +
        "<tr><td>坐标</td><td>" +
        latlng.lat.toFixed(4) +
        ", " +
        latlng.lng.toFixed(4) +
        "</td></tr>" +
        "<tr><td>" +
        r.label +
        '</td><td><span class="elev-big">' +
        Math.abs(r.value).toFixed(1) +
        "</span> " +
        r.unit +
        "</td></tr>" +
        (r.sourceName
          ? "<tr><td>数据源</td><td>" + r.sourceName + "</td></tr>"
          : "") +
        "</tbody></table></div></div>";

      L.popup(this.options.popupOptions)
        .setLatLng(latlng)
        .setContent(popupHtml)
        .openOn(this._map);
    },

    _showError: function (latlng, msg) {
      if (this._bar) {
        this._bar.className = "elev-query-bar is-error";
        this._bar.innerHTML = "❌ " + msg;
        this._bar.classList.add("show");
      }
      L.popup(this.options.popupOptions)
        .setLatLng(latlng)
        .setContent(
          '<div class="elev-popup is-error">' +
            '<div class="elev-popup-title">⚠️ 查询出错</div>' +
            '<div class="elev-popup-body">' +
            msg +
            "</div></div>",
        )
        .openOn(this._map);
    },
  });

  // 工厂函数
  L.elevationQuery = function (options) {
    return new ElevationQuery(options);
  };

  // 挂载到地图（单例，全应用共享）
  L.Map.prototype.elevationQuery = function (options) {
    if (!this._elevationQuery) {
      this._elevationQuery = new ElevationQuery(options);
      this._elevationQuery.addTo(this);
    }
    return this._elevationQuery;
  };

  // 暴露类与源注册表，便于外部扩展
  L.ElevationQuery = ElevationQuery;
  L.ElevationQuery.sources = ELEV_SOURCES;
  L.ElevationQuery.registerSource = function (name, factory) {
    ELEV_SOURCES[name] = factory;
  };
  L.ElevationQuery.makeGebcoSource = makeGebcoSource;
})(typeof window !== "undefined" ? window : this);
