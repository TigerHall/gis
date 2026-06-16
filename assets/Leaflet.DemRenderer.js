/**
 * Leaflet.DemRenderer.js
 * Leaflet 插件：DEM 高程数据渲染模块
 *
 * 功能：
 *   - 支持从本地文件（File 对象）或远程 URL 加载 GeoTIFF/DEM 数据
 *   - 使用 georaster + georaster-layer-for-leaflet 渲染高程色带
 *   - 支持点击查询高程值（经纬度 + 高程）
 *   - 海底地形优化色带（连续线性插值）
 *
 * 依赖（需通过 script 标签提前引入）：
 *   - Leaflet (L)
 *   - parseGeoraster (from georaster)
 *   - GeoRasterLayer (from georaster-layer-for-leaflet)
 *   - geoblaze (from geoblaze)
 *
 * 用法：
 *   DemRenderer.loadFromFile(file, map, options)
 *   DemRenderer.loadFromUrl(url, map, options)
 *   DemRenderer.remove()
 *   DemRenderer.setOpacity(0.8)
 *
 * options 回调：
 *   options.onLoading(message)   — 加载中
 *   options.onLoaded(georaster)  — 加载完成
 *   options.onError(error)       — 加载失败
 */
(function () {
  "use strict";

  // ========== 色带控制点定义 ==========
  // 每个控制点：[高程值(m), r, g, b]
  const COLOR_STOPS = [
    [-8000, 0, 0, 20], // 极深海底（更深蓝）
    [-6000, 0, 0, 51], // 深海深蓝
    [-5000, 0, 0, 102],
    [-3000, 0, 0, 204], // 大洋蓝
    [-2000, 0, 51, 255],
    [-1000, 0, 102, 255], // 浅海蓝
    [-200, 0, 153, 255],
    [-50, 102, 255, 255], // 近岸浅蓝
    [0, 204, 255, 204], // 海岸线
    [50, 102, 255, 102], // 低地绿
    [200, 102, 204, 51], // 陆地绿
    [500, 51, 153, 0],
    [1000, 153, 102, 51], // 山地棕
    [2000, 102, 68, 0],
    [4000, 80, 50, 0], // 高山深棕
    [6000, 255, 255, 255], // 极高山（雪白）
  ];

  /**
   * 线性插值两个颜色
   * @param {number} t - 插值比例 [0, 1]
   * @param {Array} c0 - [r, g, b]
   * @param {Array} c1 - [r, g, b]
   * @returns {Array} [r, g, b]
   */
  function lerpColor(t, c0, c1) {
    return [
      Math.round(c0[0] + (c1[0] - c0[0]) * t),
      Math.round(c0[1] + (c1[1] - c0[1]) * t),
      Math.round(c0[2] + (c1[2] - c0[2]) * t),
    ];
  }

  /**
   * 根据高程值获取 RGB 颜色
   * @param {number} elev - 高程值（米）
   * @returns {string} CSS rgb 颜色字符串
   */
  function elevationToColor(elev) {
    const stops = COLOR_STOPS;

    // 低于最低控制点
    if (elev <= stops[0][0]) {
      return `rgb(${stops[0][1]}, ${stops[0][2]}, ${stops[0][3]})`;
    }
    // 高于最高控制点
    if (elev >= stops[stops.length - 1][0]) {
      const last = stops[stops.length - 1];
      return `rgb(${last[1]}, ${last[2]}, ${last[3]})`;
    }

    // 在控制点之间插值
    for (let i = 0; i < stops.length - 1; i++) {
      const s0 = stops[i];
      const s1 = stops[i + 1];
      if (elev >= s0[0] && elev <= s1[0]) {
        const t = (elev - s0[0]) / (s1[0] - s0[0]);
        const [r, g, b] = lerpColor(
          t,
          [s0[1], s0[2], s0[3]],
          [s1[1], s1[2], s1[3]],
        );
        return `rgb(${r}, ${g}, ${b})`;
      }
    }

    return "rgb(0, 0, 0)";
  }

  /**
   * GeoRasterLayer 的 pixelValuesToColorFn
   * @param {Array} values - 像素值数组（每个波段一个值）
   * @returns {string|null} CSS 颜色字符串，noData 返回 null
   */
  function pixelValuesToColorFn(values) {
    const val = values[0];
    // 无效值处理
    if (val === null || val === undefined || isNaN(val)) return null;
    return elevationToColor(val);
  }

  // ========== 内部状态 ==========
  let _map = null; // 当前地图实例
  let _layer = null; // 当前 GeoRasterLayer 实例
  let _georaster = null; // 当前 georaster 解析结果
  let _clickHandler = null; // 地图点击事件处理函数
  let _popup = null; // 当前弹窗
  let _colorMode = "bathymetry"; // 当前色带模式
  let _cdf = null; // 直方图均衡化的 CDF 查找表
  let _dataMin = null; // 实际数据最小值
  let _dataMax = null; // 实际数据最大值

  // ========== 科学可视化色带（stretch / equalize 模式共用）==========
  const RAINBOW_STOPS = [
    [0.0, 0, 0, 80], // 深蓝
    [0.15, 0, 0, 204], // 蓝
    [0.3, 0, 102, 255], // 浅蓝
    [0.45, 0, 204, 204], // 青
    [0.6, 51, 204, 51], // 绿
    [0.75, 255, 204, 0], // 黄
    [0.9, 255, 102, 0], // 橙
    [1.0, 204, 0, 0], // 红
  ];

  /**
   * 将 [0,1] 的归一化值映射到彩虹色带
   * @param {number} t - 归一化值 [0, 1]
   * @returns {string} CSS rgb 颜色字符串
   */
  function _tToColor(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = RAINBOW_STOPS;
    if (t <= stops[0][0])
      return "rgb(" + stops[0][1] + "," + stops[0][2] + "," + stops[0][3] + ")";
    if (t >= stops[stops.length - 1][0]) {
      var last = stops[stops.length - 1];
      return "rgb(" + last[1] + "," + last[2] + "," + last[3] + ")";
    }
    for (var i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        var ratio = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
        var c = lerpColor(
          ratio,
          [stops[i][1], stops[i][2], stops[i][3]],
          [stops[i + 1][1], stops[i + 1][2], stops[i + 1][3]],
        );
        return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
      }
    }
    return "rgb(0,0,0)";
  }

  // ========== 色带模式工厂函数 ==========

  /**
   * 根据色带模式创建对应的 pixelValuesToColorFn
   * @param {string} mode - 色带模式: "bathymetry" | "stretch" | "equalize" | "grayscale"
   * @param {Object} georaster - 解析后的 georaster 对象
   * @returns {Function} pixelValuesToColorFn
   */
  function _createColorFn(mode, georaster) {
    switch (mode) {
      case "stretch":
        return _createStretchFn(georaster);
      case "equalize":
        return _createEqualizeFn(georaster);
      case "grayscale":
        return _createGrayscaleFn(georaster);
      case "bathymetry":
      default:
        return pixelValuesToColorFn;
    }
  }

  /**
   * 自适应线性拉伸模式
   * 将数据范围 [min, max] 线性映射到彩虹色带
   */
  function _createStretchFn(georaster) {
    var min = georaster.mins ? georaster.mins[0] : 0;
    var max = georaster.maxs ? georaster.maxs[0] : 1;
    var range = max - min || 1;

    return function (values) {
      var val = values[0];
      if (val === null || val === undefined || isNaN(val)) return null;
      var t = Math.max(0, Math.min(1, (val - min) / range));
      return _tToColor(t);
    };
  }

  /**
   * 构建直方图均衡化的 CDF 查找表
   * @param {Object} georaster
   * @returns {Object|null} { min, max, binSize, cdf, numBins }
   */
  function _buildCDF(georaster) {
    if (!georaster.values || !georaster.values[0]) return null;

    var band = georaster.values[0];
    var validValues = [];
    var noData = georaster.noDataValue;

    for (var r = 0; r < band.length; r++) {
      for (var c = 0; c < band[r].length; c++) {
        var v = band[r][c];
        if (v !== noData && !isNaN(v) && v !== null && v !== undefined) {
          validValues.push(v);
        }
      }
    }

    if (validValues.length === 0) return null;

    validValues.sort(function (a, b) {
      return a - b;
    });

    var numBins = 256;
    var min = validValues[0];
    var max = validValues[validValues.length - 1];
    var binSize = (max - min) / numBins || 1;

    // 计算直方图
    var histogram = new Array(numBins);
    for (var i = 0; i < numBins; i++) histogram[i] = 0;
    for (var i = 0; i < validValues.length; i++) {
      var bin = Math.min(
        numBins - 1,
        Math.floor((validValues[i] - min) / binSize),
      );
      histogram[bin]++;
    }

    // 计算 CDF
    var cdf = new Array(numBins);
    cdf[0] = histogram[0];
    for (var i = 1; i < numBins; i++) {
      cdf[i] = cdf[i - 1] + histogram[i];
    }
    // 归一化
    var total = cdf[numBins - 1] || 1;
    for (var i = 0; i < numBins; i++) {
      cdf[i] = cdf[i] / total;
    }

    return { min: min, max: max, binSize: binSize, cdf: cdf, numBins: numBins };
  }

  /**
   * 直方图均衡化模式
   * 通过 CDF 查表将像素值映射到均匀分布的 [0,1]，再映射到色带
   */
  function _createEqualizeFn(georaster) {
    var cdfData = _buildCDF(georaster);
    if (!cdfData) {
      console.warn("[DemRenderer] CDF 构建失败，降级为 stretch 模式");
      return _createStretchFn(georaster);
    }

    _cdf = cdfData;

    return function (values) {
      var val = values[0];
      if (val === null || val === undefined || isNaN(val)) return null;
      var bin = Math.min(
        cdfData.numBins - 1,
        Math.max(0, Math.floor((val - cdfData.min) / cdfData.binSize)),
      );
      var t = cdfData.cdf[bin];
      return _tToColor(t);
    };
  }

  /**
   * 灰度模式
   * 将数据范围 [min, max] 线性映射到 [0, 255] 灰度
   */
  function _createGrayscaleFn(georaster) {
    var min = georaster.mins ? georaster.mins[0] : 0;
    var max = georaster.maxs ? georaster.maxs[0] : 1;
    var range = max - min || 1;

    return function (values) {
      var val = values[0];
      if (val === null || val === undefined || isNaN(val)) return null;
      var t = Math.max(0, Math.min(1, (val - min) / range));
      var gray = Math.round(t * 255);
      return "rgb(" + gray + "," + gray + "," + gray + ")";
    };
  }

  // ========== 工具函数 ==========

  /**
   * 格式化高程显示
   * @param {number} val - 高程值（米）
   * @returns {string}
   */
  function formatElevation(val) {
    if (val === null || val === undefined || isNaN(val)) return "无数据";
    return val.toFixed(1) + " m";
  }

  /**
   * 判断点是否在 georaster 的范围内
   * @param {Object} georaster - 解析后的 georaster 对象
   * @param {number} lat
   * @param {number} lng
   * @returns {boolean}
   */
  function isInBounds(georaster, lat, lng) {
    const { xmin, xmax, ymin, ymax } = georaster;
    return lng >= xmin && lng <= xmax && lat >= ymin && lat <= ymax;
  }

  /**
   * 创建 GeoRasterLayer 并绑定地图事件
   * @param {Object} georaster - 解析后的 georaster 对象
   * @param {Object} map - Leaflet 地图实例
   * @param {Object} options - 配置项
   */
  function _createLayer(georaster, map, options) {
    const opts = options || {};

    // 移除旧图层
    _removeLayer();

    _map = map;
    _georaster = georaster;
    _colorMode = opts.colorMode || "bathymetry";

    // 记录数据范围
    _dataMin = georaster.mins ? georaster.mins[0] : null;
    _dataMax = georaster.maxs ? georaster.maxs[0] : null;

    // 根据色带模式创建渲染函数
    const colorFn = _createColorFn(_colorMode, georaster);

    // 创建 GeoRasterLayer
    _layer = new GeoRasterLayer({
      georaster: georaster,
      opacity: opts.opacity !== undefined ? opts.opacity : 0.85,
      pixelValuesToColorFn: colorFn,
      resolution: opts.resolution || 256, // 渲染分辨率（越高越精细，越慢）
    });

    _layer.addTo(map);

    // 自动缩放到 DEM 范围
    try {
      const bounds = _layer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds);
      }
    } catch (e) {
      console.warn("[DemRenderer] fitBounds 失败:", e);
    }

    // 绑定点击查询事件
    _bindClickQuery();

    // 回调：加载完成
    if (typeof opts.onLoaded === "function") {
      opts.onLoaded(georaster);
    }

    console.log("[DemRenderer] DEM 图层已添加到地图");
  }

  /**
   * 绑定地图点击事件，查询高程
   */
  function _bindClickQuery() {
    if (!_map || !_georaster) return;

    // 移除旧事件
    _unbindClickQuery();

    _clickHandler = function (e) {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      // 检查是否在 DEM 范围内
      if (!isInBounds(_georaster, lat, lng)) return;

      // 关闭旧弹窗
      if (_popup) {
        _popup.remove();
        _popup = null;
      }

      // 使用 geoblaze 查询高程值
      try {
        const result = geoblaze.identify(_georaster, [lng, lat]);
        let elev = null;

        if (Array.isArray(result) && result.length > 0) {
          elev = result[0];
        } else if (typeof result === "number") {
          elev = result;
        }

        // 构建弹窗内容
        const content = [
          '<div class="dem-popup">',
          `  <div class="dem-popup-row"><span class="dem-popup-label">经度</span><span class="dem-popup-value">${lng.toFixed(5)}°</span></div>`,
          `  <div class="dem-popup-row"><span class="dem-popup-label">纬度</span><span class="dem-popup-value">${lat.toFixed(5)}°</span></div>`,
          `  <div class="dem-popup-row dem-popup-elev"><span class="dem-popup-label">高程</span><span class="dem-popup-value">${formatElevation(elev)}</span></div>`,
          "</div>",
        ].join("");

        _popup = L.popup({
          className: "dem-query-popup",
          maxWidth: 220,
          closeButton: true,
        })
          .setLatLng(e.latlng)
          .setContent(content)
          .openOn(_map);
      } catch (err) {
        console.warn("[DemRenderer] 高程查询失败:", err);
      }
    };

    _map.on("click", _clickHandler);
    console.log("[DemRenderer] 点击查询已启用");
  }

  /**
   * 解绑地图点击事件
   */
  function _unbindClickQuery() {
    if (_map && _clickHandler) {
      _map.off("click", _clickHandler);
      _clickHandler = null;
    }
    if (_popup) {
      try {
        _popup.remove();
      } catch (e) {}
      _popup = null;
    }
  }

  /**
   * 移除当前 DEM 图层并解绑事件
   */
  function _removeLayer() {
    _unbindClickQuery();
    if (_layer && _map) {
      try {
        _map.removeLayer(_layer);
      } catch (e) {}
      _layer = null;
    }
    _georaster = null;
  }

  // ========== 注入弹窗样式 ==========
  (function _injectStyles() {
    const styleId = "dem-renderer-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .dem-query-popup .leaflet-popup-content-wrapper {
        border-radius: 8px;
        padding: 0;
        overflow: hidden;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      }
      .dem-query-popup .leaflet-popup-content {
        margin: 0;
        min-width: 180px;
      }
      .dem-popup {
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 13px;
        background: #1a2a3a;
        color: #e0f0ff;
        padding: 10px 14px;
      }
      .dem-popup-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 0;
        border-bottom: 1px solid rgba(255,255,255,0.07);
      }
      .dem-popup-row:last-child {
        border-bottom: none;
      }
      .dem-popup-label {
        color: #88aacc;
        font-size: 12px;
        margin-right: 12px;
      }
      .dem-popup-value {
        color: #e0f4ff;
        font-weight: 500;
      }
      .dem-popup-elev .dem-popup-value {
        color: #7fffbf;
        font-size: 14px;
        font-weight: 700;
      }
    `;
    document.head.appendChild(style);
  })();

  // ========== 公共 API ==========
  const DemRenderer = {
    /**
     * 从本地 File 对象加载 DEM（.tif / .tiff）
     * @param {File} file - 用户上传的文件对象
     * @param {Object} map - Leaflet 地图实例
     * @param {Object} [options] - 配置项
     * @param {number} [options.opacity=0.85] - 图层透明度
     * @param {number} [options.resolution=256] - 渲染分辨率
     * @param {Function} [options.onLoading] - 加载中回调 fn(message)
     * @param {Function} [options.onLoaded] - 加载完成回调 fn(georaster)
     * @param {Function} [options.onError] - 加载失败回调 fn(error)
     */
    loadFromFile: function (file, map, options) {
      const opts = options || {};

      if (typeof opts.onLoading === "function") {
        opts.onLoading("正在读取文件：" + file.name);
      }

      console.log("[DemRenderer] 开始读取本地文件:", file.name);

      const reader = new FileReader();

      reader.onload = function (e) {
        const arrayBuffer = e.target.result;

        if (typeof opts.onLoading === "function") {
          opts.onLoading("正在解析 GeoTIFF 数据…");
        }

        parseGeoraster(arrayBuffer)
          .then(function (georaster) {
            console.log("[DemRenderer] GeoTIFF 解析完成:", georaster);
            _createLayer(georaster, map, opts);
          })
          .catch(function (err) {
            console.error("[DemRenderer] 解析失败:", err);
            if (typeof opts.onError === "function") {
              opts.onError(err);
            }
          });
      };

      reader.onerror = function (e) {
        const err = new Error(
          "文件读取失败: " + (e.target.error || "未知错误"),
        );
        console.error("[DemRenderer]", err);
        if (typeof opts.onError === "function") {
          opts.onError(err);
        }
      };

      reader.readAsArrayBuffer(file);
    },

    /**
     * 从远程 URL 加载 DEM（GeoTIFF）
     * @param {string} url - GeoTIFF 文件的远程 URL
     * @param {Object} map - Leaflet 地图实例
     * @param {Object} [options] - 配置项（同 loadFromFile）
     */
    loadFromUrl: function (url, map, options) {
      const opts = options || {};

      if (typeof opts.onLoading === "function") {
        opts.onLoading("正在下载 DEM 数据…");
      }

      console.log("[DemRenderer] 开始加载远程 DEM:", url);

      fetch(url)
        .then(function (response) {
          if (!response.ok) {
            throw new Error(
              "HTTP 请求失败: " + response.status + " " + response.statusText,
            );
          }

          if (typeof opts.onLoading === "function") {
            opts.onLoading("正在解析 GeoTIFF 数据…");
          }

          return response.arrayBuffer();
        })
        .then(function (arrayBuffer) {
          return parseGeoraster(arrayBuffer);
        })
        .then(function (georaster) {
          console.log("[DemRenderer] 远程 GeoTIFF 解析完成:", georaster);
          _createLayer(georaster, map, opts);
        })
        .catch(function (err) {
          console.error("[DemRenderer] 加载失败:", err);
          if (typeof opts.onError === "function") {
            opts.onError(err);
          }
        });
    },

    /**
     * 移除当前 DEM 图层并解绑所有事件
     */
    remove: function () {
      _removeLayer();
      _map = null;
      console.log("[DemRenderer] DEM 图层已移除");
    },

    /**
     * 动态设置图层透明度
     * @param {number} value - 透明度 [0, 1]
     */
    setOpacity: function (value) {
      if (!_layer) {
        console.warn("[DemRenderer] 当前没有活动的 DEM 图层");
        return;
      }
      const opacity = Math.max(0, Math.min(1, value));
      _layer.setOpacity(opacity);
      console.log("[DemRenderer] 透明度已设置为:", opacity);
    },

    /**
     * 获取当前 georaster 对象（调试用）
     * @returns {Object|null}
     */
    getGeoraster: function () {
      return _georaster;
    },

    /**
     * 获取当前图层实例（调试用）
     * @returns {Object|null}
     */
    getLayer: function () {
      return _layer;
    },

    /**
     * 获取当前图层的地理范围
     * @returns {L.LatLngBounds|null}
     */
    getBounds: function () {
      if (!_layer) return null;
      try {
        return _layer.getBounds();
      } catch (e) {
        return null;
      }
    },

    /**
     * 手动查询指定经纬度的高程值
     * @param {number} lat - 纬度
     * @param {number} lng - 经度
     * @returns {number|null} 高程值（米），范围外或无数据返回 null
     */
    queryElevation: function (lat, lng) {
      if (!_georaster) return null;
      if (!isInBounds(_georaster, lat, lng)) return null;

      try {
        const result = geoblaze.identify(_georaster, [lng, lat]);
        if (Array.isArray(result) && result.length > 0) return result[0];
        if (typeof result === "number") return result;
        return null;
      } catch (e) {
        console.warn("[DemRenderer] 高程查询异常:", e);
        return null;
      }
    },

    /**
     * 获取当前色带模式
     * @returns {string} 当前色带模式名称
     */
    getColorMode: function () {
      return _colorMode;
    },

    /**
     * 动态切换色带模式
     * @param {string} mode - 色带模式: "bathymetry" | "stretch" | "equalize" | "grayscale"
     */
    setColorMode: function (mode) {
      if (!_georaster || !_map) {
        console.warn("[DemRenderer] 当前没有活动的 DEM 图层");
        return;
      }
      _colorMode = mode;

      // 移除旧图层，用新 colorFn 重新创建
      var opacity = _layer ? _layer.options.opacity : 0.85;
      var resolution = _layer ? _layer.options.resolution : 256;

      if (_layer) {
        _map.removeLayer(_layer);
      }

      var colorFn = _createColorFn(mode, _georaster);
      _layer = new GeoRasterLayer({
        georaster: _georaster,
        opacity: opacity,
        pixelValuesToColorFn: colorFn,
        resolution: resolution,
      });
      _layer.addTo(_map);

      console.log("[DemRenderer] 色带模式已切换为:", mode);
    },

    /**
     * 暴露色带函数（供外部自定义渲染时参考）
     */
    pixelValuesToColorFn: pixelValuesToColorFn,
    elevationToColor: elevationToColor,
  };

  // 挂载到全局
  window.DemRenderer = DemRenderer;

  console.log("[DemRenderer] Leaflet.DemRenderer.js 已加载");
})();
