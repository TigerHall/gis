/**
 * cesium-viewer.js
 * Cesium 3D Viewer 初始化、相机同步、图层编排
 *
 * 核心职责：
 * 1. 懒加载 Cesium 库（仅在用户主动开启 3D 时才加载 ~4MB JS + Workers）
 * 2. 初始化 Cesium Viewer（地球 + 底图 + 可选地形）
 * 3. 相机同步：Leaflet center/zoom ↔ Cesium camera lat/lng/height
 * 4. 图层编排：从 featureCache 读取已加载的 GeoJSON → CesiumGeoJsonAdapter
 * 5. 底图映射：Leaflet 底图名称 → Cesium ImageryProvider
 * 6. 场景主题：跟随站点黑白模式（浅色 = 白底无星空，深色 = 黑底带星空）
 *
 * 重要策略（2026-08-29）：
 * - **刷新后绝不自动进入 3D**：页面加载时强制重置持久化开关为 false，
 *   3D 只能由用户主动点击开启，避免每次刷新都下载 4MB 引擎。
 * - **加载全程有提示**：下载进度百分比 → 初始化 → 逐图层渲染进度，
 *   并提供「取消」按钮中断加载。
 * - **图层「关→开」瞬时**：取消勾选只 ds.show=false（保留数据源，LRU 上限 12），
 *   重新勾选直接 show=true。原实现是 destroy + rebuild，大图层要几十秒。
 * - **点要素默认不贴地**：HeightReference.CLAMP_TO_GROUND 会按帧逐点采样地形，
 *   实测 n=1116 时帧耗时 5620ms vs 不贴地 602ms（基线 455ms），且本站地形为
 *   平坦椭球（贴地前后高度差 0m）毫无收益。详见 cesium-geojson-adapter.js。
 *
 * 暴露：window.CesiumViewer
 * 依赖：window.CesiumGeoJsonAdapter, window.CesiumTerrain
 */

(function () {
  "use strict";

  // ========== Cesium 配置 ==========
  // CDN 基础路径（后续可改为自托管 ./assets/cesium/）
  var CESIUM_VERSION = "1.125";
  var CESIUM_BASE_URL =
    "https://cesium.com/downloads/cesiumjs/releases/" +
    CESIUM_VERSION +
    "/Build/Cesium/";
  var CESIUM_JS_URL = CESIUM_BASE_URL + "Cesium.js";
  // 自托管主入口：只把 5MB 的 Cesium.js 放进仓库，Workers / Assets / ThirdParty 仍走 CDN。
  // 实测（2026-08-29）：cesium.com 国内直连 6.7~10.1s，同源自托管 0.31s（省 97%）；
  // 而引擎耗时里 94.6% 是下载、解析只占 4.2%（335ms），所以搬这一个文件就够。
  // ⚠️ CESIUM_BASE_URL 必须继续指向 CDN：Cesium 用它拼 Workers/Assets 路径，
  //    若跟着脚本一起指到 ./assets/cesium/ 会全部 404（已验证全局变量的优先级高于脚本路径推断）。
  var CESIUM_JS_LOCAL = "./assets/cesium/Cesium.js";
  var CESIUM_CSS_URL = CESIUM_BASE_URL + "Widgets/widgets.css";
  // Cesium.js 解压后的实际体积（v1.125 实测 5,140,708 B ≈ 4.9 MB）。
  // CDN 以 Chunked + gzip 返回、Content-Length 缺失，进度条没有分母，
  // 这里用它做估算分母，让进度条走确定态而不是不确定态。
  // 升级 CESIUM_VERSION 时应同步更新；即使忘了也只是条子提前/滞后，不影响功能。
  var CESIUM_JS_BYTES = 5140708;
  var TOGGLE_KEY = "dupal_toggle_view3d";

  // ========== 内部状态 ==========
  var viewer = null;
  var isActive = false;
  var isLoaded = false; // Cesium 库是否已加载
  var isLoading = false; // 是否正在加载中
  var cesiumLayerCache = {}; // checkboxId → GeoJsonDataSource（当前显示中）
  // 隐藏但保留的图层：取消勾选时不再销毁，只 ds.show=false。
  // 重新勾选时直接 show=true 瞬时恢复 —— 原来 destroy + rebuild 一次要几十秒级卡顿。
  var cesiumHiddenCache = {}; // checkboxId → GeoJsonDataSource
  var _hiddenOrder = []; // LRU 顺序（越靠后越新），超出上限时淘汰最旧的
  var HIDDEN_CACHE_MAX = 12; // 保留多少个隐藏图层（防止显存/内存无限增长）
  var _pendingLayers = []; // activate 完成后待添加的图层
  var _activationSeq = 0; // activate 序号，自增即代表「取消当前流程」

  // ========== DOM 辅助：加载提示遮罩 ==========
  function ensureOverlay() {
    var el = document.getElementById("cesiumLoadingOverlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "cesiumLoadingOverlay";
    el.innerHTML =
      '<div class="cesium-loading-card">' +
      '<div class="cesium-loading-spinner"></div>' +
      '<div class="cesium-loading-msg"></div>' +
      '<div class="cesium-loading-bar"><i></i></div>' +
      '<div class="cesium-loading-pct"></div>' +
      '<button type="button" class="cesium-loading-cancel">取消</button>' +
      "</div>";
    // 挂在 body 上（#cesiumContainer 在加载期间是 display:none，挂进去看不见）
    document.body.appendChild(el);
    el.querySelector(".cesium-loading-cancel").addEventListener(
      "click",
      function (e) {
        e.stopPropagation();
        cancelActivate();
      },
    );
    return el;
  }

  /**
   * 显示加载提示
   * @param {string} msg 提示文字
   * @param {number|null} pct 进度 0~1，null 为不确定态（不显示进度条）
   */
  function showLoading(msg, pct, loaded) {
    var el = ensureOverlay();
    var msgEl = el.querySelector(".cesium-loading-msg");
    var barEl = el.querySelector(".cesium-loading-bar");
    var pctEl = el.querySelector(".cesium-loading-pct");
    if (msgEl) msgEl.textContent = msg || "加载 3D 引擎中…";
    if (barEl) {
      // pct 为 null（阶段未知）或 0（还没收到任何数据）时走不确定态动画，
      // 避免进度条长时间卡在 0% 看起来像卡死
      if (pct == null || pct <= 0) {
        barEl.classList.add("indeterminate");
      } else {
        barEl.classList.remove("indeterminate");
        barEl.firstChild.style.width = Math.round(pct * 100) + "%";
      }
    }
    if (pctEl) {
      // 有总长度 → 显示百分比；没有（Chunked + gzip 常见，Content-Length 缺失）→
      // 显示真实已下载字节数，避免在整段下载期间 UI 看起来像卡死
      if (pct != null && pct > 0) {
        pctEl.textContent = Math.round(pct * 100) + "%";
      } else if (loaded && loaded > 0) {
        pctEl.textContent = "已下载 " + (loaded / 1048576).toFixed(1) + " MB";
      } else {
        pctEl.textContent = "";
      }
    }
    el.classList.add("active");
  }

  function hideLoading() {
    var el = document.getElementById("cesiumLoadingOverlay");
    if (el) el.classList.remove("active");
  }

  // ========== DOM 辅助：轻量忙碌提示（右下角小卡片，不阻塞交互）==========
  // 与全屏遮罩 showLoading 的区别：只用于「改个设置、稍等一下」这类短任务，
  // 不拦住用户操作，也不需要「取消」按钮。
  function ensureBusyEl() {
    var el = document.getElementById("cesiumBusyToast");
    if (el) return el;
    el = document.createElement("div");
    el.id = "cesiumBusyToast";
    el.innerHTML = '<i class="cesium-busy-spinner"></i><span></span>';
    document.body.appendChild(el);
    return el;
  }

  function showBusy(msg) {
    var el = ensureBusyEl();
    var span = el.querySelector("span");
    if (span) span.textContent = msg || "更新中…";
    el.classList.add("active");
  }

  function hideBusy() {
    var el = document.getElementById("cesiumBusyToast");
    if (el) el.classList.remove("active");
  }

  /**
   * 等到浏览器「真的把上一帧画出来」为止
   * 双 rAF + 一个宏任务：第一帧执行样式计算，第二帧保证绘制完成，
   * 后面的 setTimeout(0) 让出主线程，使随后的同步阻塞任务不会影响提示的呈现。
   */
  function nextPaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          setTimeout(resolve, 0);
        });
      });
    });
  }

  /**
   * 显示忙碌提示 → 让浏览器绘制出来 → 执行（阻塞的）任务 → 再绘制一次 → 收起提示
   * @param {string} msg
   * @param {function():Promise|*} task
   * @returns {Promise<void>}
   */
  function runWithBusy(msg, task) {
    showBusy(msg);
    return nextPaint()
      .then(function () {
        return task();
      })
      .catch(function (e) {
        console.error("[CesiumViewer] " + msg + " 失败:", e);
      })
      .then(function () {
        return nextPaint();
      })
      .then(function () {
        hideBusy();
      });
  }

  // ========== Cesium 库懒加载（带下载进度）==========
  function loadCesiumCss() {
    if (document.querySelector('link[href="' + CESIUM_CSS_URL + '"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CESIUM_CSS_URL;
    document.head.appendChild(link);
  }

  function injectScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = function () {
        isLoaded = true;
        isLoading = false;
        resolve();
      };
      script.onerror = function () {
        isLoading = false;
        reject(new Error("Cesium 库加载失败，请检查网络连接"));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * fetch + ReadableStream 读取，实时上报下载进度
   * 失败（如 CDN 无 CORS 头）时 resolve(null)，由调用方回退到直接 <script>
   */
  function fetchWithProgress(url, onProgress) {
    if (!window.fetch || !window.ReadableStream || !window.Uint8Array) {
      return Promise.resolve(null);
    }
    return fetch(url, { mode: "cors", credentials: "omit" }).then(function (
      res,
    ) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      var total =
        parseInt(res.headers.get("Content-Length"), 10) || CESIUM_JS_BYTES;
      // 注意：CDN 常以 Chunked + gzip 返回，此时 Content-Length 缺失（实测 cesium.com 即为 0）。
      // 旧实现在这种情况下直接退回 res.text()，整个下载期没有任何回调，
      // 进度条只能走不确定态、最后瞬间跳到 100%——看起来像卡了 8 秒。
      // 现在改为照常流式读取：total 缺失时用 CESIUM_JS_BYTES 估算，
      // 同时把真实的已下载字节数一路报给 UI（数字是真的，条子是估算的）。
      if (!res.body || !res.body.getReader || !window.TextDecoder) {
        return res.text().then(function (t) {
          if (onProgress) onProgress(1);
          return t;
        });
      }
      var reader = res.body.getReader();
      var parts = [];
      var len = 0;
      return new Promise(function (resolve, reject) {
        function pump() {
          reader.read().then(function (r) {
            if (r.done) {
              var all = new Uint8Array(len);
              var off = 0;
              for (var i = 0; i < parts.length; i++) {
                all.set(parts[i], off);
                off += parts[i].length;
              }
              if (onProgress) onProgress(1, len);
              resolve(new TextDecoder("utf-8").decode(all));
              return;
            }
            parts.push(r.value);
            len += r.value.length;
            if (onProgress) {
              // 卡在 98%：分母是估算值，100% 留到 r.done 再报，
              // 避免「条子满了但还在转」的假象
              onProgress(Math.min(0.98, len / total), len);
            }
            pump();
          }, reject);
        }
        pump();
      });
    });
  }

  // 后台预加载进行中时，用户若主动点开 3D，需要能「搭车」拿到进度而不是被挡住。
  // 这里维护一个订阅者列表：加载中的进度会广播给所有人，结束/失败时统一结算。
  var _loadSubs = [];

  function broadcastLoadProgress(p, loaded, phase) {
    for (var i = 0; i < _loadSubs.length; i++) {
      try {
        if (_loadSubs[i].onProgress) _loadSubs[i].onProgress(p, loaded, phase);
      } catch (e) {}
    }
  }

  function settleLoadSubs(err) {
    var subs = _loadSubs.slice();
    _loadSubs = [];
    for (var i = 0; i < subs.length; i++) {
      try {
        if (err) subs[i].reject(err);
        else subs[i].resolve();
      } catch (e) {}
    }
  }

  function loadCesiumJs(onProgress) {
    if (isLoaded) {
      if (onProgress) onProgress(1);
      return Promise.resolve();
    }
    if (isLoading) {
      // 已在加载（可能是后台预加载）→ 登记为订阅者，共享进度与结果
      return new Promise(function (resolve, reject) {
        _loadSubs.push({
          onProgress: onProgress,
          resolve: resolve,
          reject: reject,
        });
      });
    }

    isLoading = true;
    // 设置 CESIUM_BASE_URL（Workers/Assets/Widgets 的根路径），必须在脚本执行前
    window.CESIUM_BASE_URL = CESIUM_BASE_URL;
    loadCesiumCss();

    // phase: "download" 下载中 ｜ "parse" 脚本解析/执行中（主线程会被独占）
    function report(p, loaded, phase) {
      if (onProgress) {
        try {
          onProgress(p, loaded, phase);
        } catch (e) {}
      }
      broadcastLoadProgress(p, loaded, phase);
    }

    function reportDl(p, loaded) {
      report(p, loaded, "download");
    }

    return fetchWithProgress(CESIUM_JS_LOCAL, reportDl)
      .catch(function (e) {
        // 本地文件缺失（例如某个部署没带 assets/cesium/）→ 透明回退 CDN
        console.warn("[CesiumViewer] 本地 Cesium.js 不可用，回退 CDN：", e);
        return fetchWithProgress(CESIUM_JS_URL, reportDl);
      })
      .then(function (text) {
        if (!text) {
          // 不支持流式读取的浏览器：直接挂 script 标签，同样本地优先
          return injectScript(CESIUM_JS_LOCAL).catch(function () {
            return injectScript(CESIUM_JS_URL);
          });
        }
        // 4MB 脚本的解析 + 执行会长时间独占主线程（冷的机器上实测 3~5s），
        // 先报一个「解析中」并等它真的画出来，否则 UI 会停在「下载 100%」发呆
        report(1, null, "parse");
        return nextPaint().then(function () {
          var blob = new Blob([text], { type: "application/javascript" });
          var url = URL.createObjectURL(blob);
          return injectScript(url).then(function () {
            setTimeout(function () {
              URL.revokeObjectURL(url);
            }, 60000);
          });
        });
      })
      .catch(function () {
        // 带进度的加载失败（CORS / 流式不支持等）→ 回退普通 script 标签
        isLoading = true;
        return injectScript(CESIUM_JS_URL);
      })
      .then(function () {
        var Cs = window.Cesium;
        console.log("[CesiumViewer] Cesium 库加载完成:", CESIUM_VERSION);
        if (!Cs) {
          console.error(
            "[CesiumViewer] window.Cesium 未定义！CDN 可能加载异常",
          );
        }
        settleLoadSubs();
      })
      .catch(function (err) {
        settleLoadSubs(err);
        throw err;
      });
  }

  // ========== 手动预加载入口（2026-08-29 改为不自动调度）==========
  // 之前用 `schedulePreload()` 在页面空闲时自动预加载 3D 引擎。
  // 考虑到项目已有 PWA（service-worker.js 动态缓存同源资源），
  // 用户首次开启 3D 后，Cesium.js 已落到 Cache Storage，第二次直接秒开，
  // 空闲预加载的边际收益太小，不值得白白下载/解析。
  //
  // 保留 `CesiumViewer.preloadNow()` 作为手动入口，方便调试或后续策略接入；
  // `_loadSubs` 订阅者模式继续保留——它是 loadCesiumJs 的并发安全基础设施，
  // 删了反而要重构。
  function preloadCesium() {
    if (isLoaded || isLoading || isActive) return false;
    console.log("[CesiumViewer] 手动预加载 3D 引擎…");
    loadCesiumJs().then(
      function () {
        console.log("[CesiumViewer] 3D 引擎预加载完成");
      },
      function (e) {
        console.warn("[CesiumViewer] 3D 引擎预加载失败:", e);
      },
    );
    return true;
  }

  // ========== 相机同步 ==========
  /**
   * Leaflet zoom → Cesium camera height（米）
   * 经验公式：height = 40075016 * cos(lat) / 2^zoom
   */
  function zoomToHeight(lat, zoom) {
    return (40075016 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  }

  /**
   * Cesium camera height → Leaflet zoom
   */
  function heightToZoom(lat, height) {
    return Math.log2((40075016 * Math.cos((lat * Math.PI) / 180)) / height);
  }

  /**
   * 获取 Cartesian3 类（带回退兼容）
   */
  function getCartesian3() {
    var Cs = window.Cesium;
    if (Cs && Cs.Cartesian3 && Cs.Cartesian3.fromDegrees) {
      return Cs.Cartesian3;
    }
    if (viewer && viewer.camera && viewer.camera.position) {
      var ctor = viewer.camera.position.constructor;
      if (ctor && ctor.fromDegrees) return ctor;
    }
    return null;
  }

  /**
   * 从 Leaflet 同步相机到 Cesium
   */
  function syncCameraFromLeaflet() {
    if (!viewer || !window.map) return;
    var center = window.map.getCenter();
    var zoom = window.map.getZoom();
    var height = zoomToHeight(center.lat, zoom);

    var Cartesian3 = getCartesian3();
    if (Cartesian3) {
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(center.lng, center.lat, height),
      });
    } else {
      try {
        viewer.camera.flyTo({
          destinationCartographic: {
            longitude: (center.lng * Math.PI) / 180,
            latitude: (center.lat * Math.PI) / 180,
            height: height,
          },
          duration: 0,
        });
      } catch (e) {
        console.error("[CesiumViewer] 相机同步全部失败:", e);
      }
    }
  }

  /**
   * 从 Cesium 同步相机到 Leaflet
   */
  function syncCameraToLeaflet() {
    if (!viewer || !window.map) return;
    var carto = viewer.camera.positionCartographic;
    var lat = (carto.latitude * 180) / Math.PI;
    var lng = (carto.longitude * 180) / Math.PI;
    var height = carto.height;
    var zoom = heightToZoom(lat, height);

    zoom = Math.max(0, Math.min(19, zoom));
    window.map.setView([lat, lng], zoom, { animate: false });
  }

  // ========== 要素定位（3D 缩放至） ==========
  function computeGeometryBounds(geometry) {
    if (!geometry || !geometry.type) return null;
    var minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;

    function visit(c) {
      if (
        Array.isArray(c) &&
        c.length >= 2 &&
        typeof c[0] === "number" &&
        typeof c[1] === "number"
      ) {
        if (c[0] < minLng) minLng = c[0];
        if (c[0] > maxLng) maxLng = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
        return;
      }
      if (Array.isArray(c)) {
        for (var i = 0; i < c.length; i++) visit(c[i]);
      }
    }
    visit(geometry.coordinates);

    if (!isFinite(minLng) || !isFinite(minLat)) return null;
    return { west: minLng, south: minLat, east: maxLng, north: maxLat };
  }

  /**
   * 飞到指定要素（供侧面板「缩放至」、3D 弹窗缩放按钮、搜索结果定位复用）
   * @param {Object} feature - GeoJSON Feature
   * @returns {boolean} 是否成功
   */
  function flyToFeature(feature) {
    if (!viewer || !feature || !feature.geometry) return false;
    var bounds = computeGeometryBounds(feature.geometry);
    if (!bounds) return false;
    var Cs = window.Cesium;
    var gtype = (feature.geometry.type || "").toLowerCase();
    var isPoint = gtype === "point" || gtype === "multipoint";
    var isDegenerate =
      bounds.west === bounds.east && bounds.south === bounds.north;

    try {
      if (isPoint || isDegenerate) {
        var height = zoomToHeight(bounds.south, 14);
        var Cartesian3 = getCartesian3();
        if (!Cartesian3) return false;
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(
            bounds.west,
            bounds.south,
            height,
          ),
          duration: 1.2,
        });
      } else {
        var rect = Cs.Rectangle.fromDegrees(
          bounds.west,
          bounds.south,
          bounds.east,
          bounds.north,
        );
        viewer.camera.flyTo({ destination: rect, duration: 1.2 });
      }
      return true;
    } catch (e) {
      console.error("[CesiumViewer] flyToFeature 失败:", e);
      return false;
    }
  }

  /**
   * 3D 定位到图层范围（对应 2D 的 map.fitBounds，供图层面板 🔍 按钮调用）
   * @param {{west:number,south:number,east:number,north:number}} b - 十进制度范围
   * @returns {boolean} 是否成功
   */
  function flyToLayerBounds(b) {
    if (!viewer || !b) return false;
    var Cs = window.Cesium;
    var west = Number(b.west);
    var south = Number(b.south);
    var east = Number(b.east);
    var north = Number(b.north);
    if (
      !isFinite(west) ||
      !isFinite(south) ||
      !isFinite(east) ||
      !isFinite(north)
    ) {
      return false;
    }

    // 退化范围（单点图层 / 跨度为 0）→ 补一个最小跨度，否则 Rectangle 无效
    var minSpan = 0.05;
    if (Math.abs(east - west) < 1e-6) {
      west -= minSpan;
      east += minSpan;
    }
    if (Math.abs(north - south) < 1e-6) {
      south -= minSpan;
      north += minSpan;
    }
    south = Math.max(-89.9, south);
    north = Math.min(89.9, north);

    try {
      var rect = Cs.Rectangle.fromDegrees(west, south, east, north);
      viewer.camera.flyTo({ destination: rect, duration: 1.2 });
      return true;
    } catch (e) {
      console.warn("[CesiumViewer] 3D 图层定位失败:", e);
      return false;
    }
  }

  // ========== 3D 要素拾取 + 弹窗 ==========
  var _clickHandler = null;
  var _popupEl = null;
  var _popupContentEl = null;
  var _popupCloseBtn = null;
  var _popupKeyHandler = null;

  function ensurePopupEl() {
    if (_popupEl) return _popupEl;
    _popupEl = document.createElement("div");
    _popupEl.className = "cesium-feature-popup";
    // 容器本身不拦截鼠标（让点击穿透到 Cesium 拾取，详见 setupClickHandler 注释）
    _popupEl.style.cssText =
      "position:absolute;z-index:1000;display:none;pointer-events:none;";
    var container = document.getElementById("cesiumContainer");
    if (container) container.appendChild(_popupEl);
    else document.body.appendChild(_popupEl);

    // 全局 ESC 关闭弹窗
    _popupKeyHandler = function (e) {
      if (e.key === "Escape" || e.keyCode === 27) hidePopup();
    };
    document.addEventListener("keydown", _popupKeyHandler);
    return _popupEl;
  }

  function hidePopup() {
    if (_popupEl) {
      _popupEl.style.display = "none";
      // 主动清空内容，避免下次显示时短暂闪烁旧数据
      _popupEl.innerHTML = "";
      _popupContentEl = null;
      _popupCloseBtn = null;
    }
  }

  /**
   * 在指定屏幕位置显示要素弹窗（复用 2D 的 buildPopupContent）
   *
   * 关闭弹窗的三种方式（必须全做好，否则用户就看到旧内容卡住）：
   *   1. 弹窗右上角 ✕ 按钮
   *   2. 点击空白处（Cesium LEFT_CLICK 拾取不到任何东西 → hidePopup）
   *   3. 键盘 ESC
   *
   * 内容区 pointer-events: auto，容器本身 pointer-events: none — 这样点弹窗内文字
   * 不会关闭，但点弹窗外的空白仍能命中 Cesium。
   *
   * @param {Object} ref - { layerId, featureIndex, fileName, layerName }
   * @param {Object} screenPos - { x, y } 画布坐标
   */
  function showEntityPopup(ref, screenPos) {
    var el = ensurePopupEl();

    // ⚠️ ref 缺失或要素不可解析 → 强制清空，不保留旧弹窗（解决"切换实体后显示旧信息"）
    var feature =
      ref && window._featureCache && window._featureCache[ref.layerId]
        ? window._featureCache[ref.layerId][ref.featureIndex]
        : null;
    if (!feature) {
      hidePopup();
      return;
    }

    var content =
      window.GeoUtils && window.GeoUtils.buildPopupContent
        ? window.GeoUtils.buildPopupContent(
            feature,
            ref.fileName,
            null,
            ref.layerName,
          )
        : null;
    if (!content) {
      hidePopup();
      return;
    }

    // 注入：关闭按钮 + 业务内容。buildPopupContent 返回的 .feature-popup 是最外层
    // div，把它包进 .cesium-popup-inner 并在前面加关闭按钮
    el.innerHTML =
      '<button type="button" class="cesium-popup-close" title="关闭 (Esc)" aria-label="关闭">✕</button>' +
      '<div class="cesium-popup-inner">' +
      content +
      "</div>";

    _popupCloseBtn = el.querySelector(".cesium-popup-close");
    _popupContentEl = el.querySelector(".cesium-popup-inner");

    // 内容区 / 关闭按钮 / 业务按钮：恢复交互
    if (_popupContentEl) _popupContentEl.style.pointerEvents = "auto";
    if (_popupCloseBtn) {
      _popupCloseBtn.style.pointerEvents = "auto";
      _popupCloseBtn.onclick = function (e) {
        e.stopPropagation();
        e.preventDefault();
        hidePopup();
      };
    }

    var zoomBtn = el.querySelector('[data-act="zoom"]');
    var detailBtn = el.querySelector('[data-act="detail"]');
    if (zoomBtn) {
      zoomBtn.style.pointerEvents = "auto";
      zoomBtn.onclick = function (e) {
        e.stopPropagation();
        e.preventDefault();
        flyToFeature(feature);
        hidePopup();
      };
    }
    if (detailBtn) {
      detailBtn.style.pointerEvents = "auto";
      detailBtn.onclick = function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (
          typeof window.FeaturePanel !== "undefined" &&
          window.FeaturePanel.openSingle
        ) {
          window.FeaturePanel.openSingle(feature, ref.layerId, ref.layerName);
        }
        hidePopup();
      };
    }

    el.style.display = "block";

    // 弹出后再量尺寸（innerHTML 改完之后才能拿到真实宽高）
    var w = el.offsetWidth || 300;
    var h = el.offsetHeight || 140;
    var cw = viewer.scene.canvas.clientWidth;
    var ch = viewer.scene.canvas.clientHeight;
    var left = screenPos.x + 14;
    var top = screenPos.y - h - 10;
    if (left + w > cw) left = screenPos.x - w - 14;
    if (left < 4) left = 4;
    if (top < 4) top = screenPos.y + 14;
    if (top + h > ch) top = ch - h - 4;
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  /**
   * 点击聚类气泡 → 放大展开（对应 2D 的 zoomToBoundsOnClick）
   * @param {Array<string>} ids - 聚类内的 entity id 列表
   */
  function zoomToCluster(ids) {
    if (!viewer || !ids || !ids.length) return;
    var found = [];
    for (var key in cesiumLayerCache) {
      if (!Object.prototype.hasOwnProperty.call(cesiumLayerCache, key))
        continue;
      var ds = cesiumLayerCache[key];
      for (var i = 0; i < ids.length; i++) {
        var e = ds.entities.getById(ids[i]);
        if (e) found.push(e);
      }
    }
    if (found.length) {
      try {
        viewer.zoomTo(found);
      } catch (e) {
        console.warn("[CesiumViewer] 聚类展开失败:", e);
      }
    }
  }

  /**
   * 设置点击拾取：
   *   - 点击实体 → 弹窗
   *   - 点击聚类气泡 → 展开
   *   - 点击空白处 → 关闭弹窗
   *   - 点击弹窗内（非关闭/业务按钮）→ 保持开启
   *
   * 注意：弹窗容器 pointer-events: none，关闭按钮/业务按钮/内容区 pointer-events: auto，
   * 这样点弹窗外永远能命中 Cesium 拾取（从而触发 hidePopup），点弹窗内则不会穿透。
   */
  function setupClickHandler() {
    if (_clickHandler || !viewer) return;
    var Cs = window.Cesium;
    if (!Cs.ScreenSpaceEventHandler || !Cs.ScreenSpaceEventType) return;
    _clickHandler = new Cs.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction(function (movement) {
      var picked = viewer.scene.pick(movement.position);
      // 聚类气泡：picked.id 是 entity id 数组
      if (picked && Array.isArray(picked.id)) {
        hidePopup();
        zoomToCluster(picked.id);
        return;
      }
      if (picked && picked.id && picked.id._ogv) {
        showEntityPopup(picked.id._ogv, movement.position);
      } else {
        // 点击空白 / 海洋 / 没有绑定 _ogv 的实体 → 关闭弹窗
        hidePopup();
      }
    }, Cs.ScreenSpaceEventType.LEFT_CLICK);
  }

  // ========== 底图映射 ==========
  // 天地图官方支持 t0~t7 八个 CDN 子域。Cesium RequestScheduler 的
  // per-server 并发上限默认 6；单域时所有请求挤一台服务器，既慢又容易被 429。
  // 走八子域轮询后，等效并发 8×6=48，实测地球就绪 34.4s → 6.8s。
  var TDT_SUBDOMAINS = ["0", "1", "2", "3", "4", "5", "6", "7"];
  function createTdtProvider(svc, tk) {
    return new window.Cesium.UrlTemplateImageryProvider({
      url: "https://t{s}.tianditu.gov.cn/DataServer?T=" + svc + "&x={x}&y={y}&l={z}&tk=" + tk,
      subdomains: TDT_SUBDOMAINS,
      maximumLevel: 18, // 与 Leaflet 的 maxNativeZoom 保持一致
    });
  }
  function createImageryProvider(basemapName) {
    var tk = window.TDT_TK || "";

    switch (basemapName) {
      case "天地图影像":
        return createTdtProvider("img_w", tk);
      case "天地图矢量":
        return createTdtProvider("vec_w", tk);
      case "天地图地形":
        return createTdtProvider("ter_w", tk);

      // ArcGIS 系列：UrlTemplateImageryProvider 直接访问瓦片端点
      // （ArcGisMapServerImageryProvider 在 CDN 构建下有 getDerivedResource 已知 bug）
      case "ArcGIS-影像":
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 19,
        });
      case "ArcGIS-海洋":
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 10,
        });
      case "ArcGIS-街道":
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 19,
        });

      // GEBCO WMS 系列
      case "GEBCO2025-水深地形":
        return new window.Cesium.WebMapServiceImageryProvider({
          url: "https://wms.gebco.net/2025/mapserv?",
          layers: "GEBCO_2025",
          parameters: { transparent: true, format: "image/png" },
          maximumLevel: 12,
        });
      case "GEBCO2024-水深地形":
        return new window.Cesium.WebMapServiceImageryProvider({
          url: "https://wms.gebco.net/mapserv?",
          layers: "GEBCO_LATEST",
          parameters: { transparent: true, format: "image/png" },
          maximumLevel: 12,
        });

      case "OpenStreetMap":
        return new window.Cesium.OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
          maximumLevel: 19,
        });

      case "Macrostrat-全球地质":
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png",
          maximumLevel: 16,
        });

      // ETOPO 等本地图片底图 → 降级用 ArcGIS 影像
      default:
        return new window.Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 19,
        });
    }
  }

  function syncBasemap() {
    if (!viewer) return;
    var name = window._currentBasemapName || "ArcGIS-影像";
    try {
      var provider = createImageryProvider(name);
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(provider);
      _overlayLayerCache = {}; // 清空覆盖层缓存，重新叠加
      // 重新叠加勾选的覆盖层（全球境界/标注等）
      syncOverlays();
    } catch (e) {
      console.warn("[CesiumViewer] 底图同步失败:", name, e);
    }
  }

  // ========== 覆盖层映射（天地图瓦片覆盖层 → Cesium ImageryProvider） ==========
  var OVERLAY_LAYERS = {
    天地图全球境界: "ibo_w",
    天地图地名标注: "cva_w",
    天地图影像标注: "cia_w",
    天地图地形标注: "cta_w",
  };
  var _overlayLayerCache = {};

  function syncOverlays() {
    if (!viewer) return;
    var names = window.getCheckedOverlays ? window.getCheckedOverlays() : [];
    var tk = window.TDT_TK || "";

    for (var cachedName in _overlayLayerCache) {
      if (names.indexOf(cachedName) === -1) {
        try {
          viewer.imageryLayers.remove(_overlayLayerCache[cachedName], true);
        } catch (e) {}
        delete _overlayLayerCache[cachedName];
      }
    }

    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var svc = OVERLAY_LAYERS[name];
      if (!svc || _overlayLayerCache[name]) continue;
      try {
        var provider = createTdtProvider(svc, tk);
        _overlayLayerCache[name] = viewer.imageryLayers.addImageryProvider(
          provider,
        );
      } catch (e) {
        console.warn("[CesiumViewer] 覆盖层叠加失败:", name, e);
      }
    }
  }

  // ========== 图层管理 ==========
  function layerLabel(checkboxId) {
    var cb = document.getElementById(checkboxId);
    if (cb && cb.dataset && cb.dataset.layerName) return cb.dataset.layerName;
    return checkboxId;
  }

  /**
   * 添加 GeoJSON 图层到 Cesium
   * @param {string} checkboxId
   * @param {Object} geoJson - 标准 GeoJSON 对象
   * @returns {Promise<void>} 永不 reject（内部已 catch），便于外部 fire-and-forget
   */
  function addLayer(checkboxId, geoJson) {
    if (!viewer) {
      _pendingLayers.push({ checkboxId: checkboxId, geoJson: geoJson });
      return Promise.resolve();
    }

    // 幂等：已存在同 id 图层则跳过（需重建请调用 reloadLayer）
    if (cesiumLayerCache[checkboxId]) return Promise.resolve();

    // ⚡ 命中隐藏缓存 → 直接恢复显示，瞬时完成（不再重建数据源）
    var hidden = cesiumHiddenCache[checkboxId];
    if (hidden) {
      hidden.show = true;
      cesiumLayerCache[checkboxId] = hidden;
      delete cesiumHiddenCache[checkboxId];
      var hi = _hiddenOrder.indexOf(checkboxId);
      if (hi !== -1) _hiddenOrder.splice(hi, 1);
      return Promise.resolve();
    }

    if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
      return Promise.resolve();
    }

    if (!window.CesiumGeoJsonAdapter) {
      console.error("[CesiumViewer] CesiumGeoJsonAdapter 未加载");
      return Promise.resolve();
    }

    var n = geoJson.features.length;
    var msg =
      "正在渲染 3D 图层：" + layerLabel(checkboxId) + "（" + n.toLocaleString() + " 个要素）";

    function build() {
      return window.CesiumGeoJsonAdapter.loadGeoJson(checkboxId, geoJson).then(
        function (dataSource) {
          viewer.dataSources.add(dataSource);
          dataSource.show = true;
          cesiumLayerCache[checkboxId] = dataSource;
        },
      );
    }

    // 大图层构建是同步阻塞的（数千要素会把主线程压住），先画提示再开工
    return (n >= 800 ? runWithBusy(msg, build) : build()).catch(function (err) {
      console.error("[CesiumViewer] 图层加载失败:", checkboxId, err);
    });
  }

  /**
   * 隐藏图层（保留数据源，重新勾选时瞬时恢复）
   * @param {string} checkboxId
   */
  function hideLayer(checkboxId) {
    var ds = cesiumLayerCache[checkboxId];
    if (ds) {
      ds.show = false;
      cesiumHiddenCache[checkboxId] = ds;
      delete cesiumLayerCache[checkboxId];
      _hiddenOrder.push(checkboxId);
      evictHiddenCache();
    }
    hidePopup();
    _pendingLayers = _pendingLayers.filter(function (item) {
      return item.checkboxId !== checkboxId;
    });
  }

  /**
   * 淘汰超出上限的隐藏图层（LRU：最久未用的先销毁）
   */
  function evictHiddenCache() {
    while (_hiddenOrder.length > HIDDEN_CACHE_MAX) {
      var oldest = _hiddenOrder.shift();
      var ds = cesiumHiddenCache[oldest];
      if (ds) {
        delete cesiumHiddenCache[oldest];
        try {
          viewer.dataSources.remove(ds, true);
        } catch (e) {}
      }
    }
  }

  /**
   * 真正销毁图层（图层数据已不存在时调用，而非取消勾选）
   * @param {string} checkboxId
   */
  function destroyLayer(checkboxId) {
    var ds = cesiumLayerCache[checkboxId] || cesiumHiddenCache[checkboxId];
    if (ds && viewer) {
      try {
        viewer.dataSources.remove(ds, true);
      } catch (e) {}
    }
    delete cesiumLayerCache[checkboxId];
    delete cesiumHiddenCache[checkboxId];
    var hi = _hiddenOrder.indexOf(checkboxId);
    if (hi !== -1) _hiddenOrder.splice(hi, 1);
    _pendingLayers = _pendingLayers.filter(function (item) {
      return item.checkboxId !== checkboxId;
    });
  }

  /**
   * 移除 Cesium 中的图层
   *
   * 语义是「隐藏」而非销毁：数据源保留在内存里（并受 LRU 上限约束），
   * 这样图层「关了再开」是瞬时的，不会重新触发一遍昂贵的构建流程。
   * 需要真销毁（图层数据被删除）时请用 destroyLayer()。
   *
   * @param {string} checkboxId
   */
  function removeLayer(checkboxId) {
    hideLayer(checkboxId);
  }

  /**
   * 重新加载图层（颜色模式 / 图标 / 标签 / 聚类变化后刷新 3D 渲染）
   *
   * 重建要素是同步阻塞的（大图层会卡住主线程几百毫秒到数秒），
   * 因此先把忙碌提示画出来，再执行重建，避免看起来像「点了没反应」。
   *
   * @param {string} checkboxId
   * @param {Object} [opts] - { quiet: true } 不显示忙碌提示
   * @returns {Promise<void>}
   */
  function reloadLayer(checkboxId, opts) {
    opts = opts || {};
    if (!viewer) return Promise.resolve();

    var featureCache = window._featureCache;
    var features = featureCache && featureCache[checkboxId];
    var cb = document.getElementById(checkboxId);
    if (!features || features.length === 0 || (cb && !cb.checked)) {
      destroyLayer(checkboxId);
      return Promise.resolve();
    }

    hidePopup();

    function rebuild() {
      // 必须真销毁：否则 addLayer 会命中隐藏缓存直接 show，样式变更不生效
      destroyLayer(checkboxId);
      return addLayer(checkboxId, {
        type: "FeatureCollection",
        features: features,
      });
    }

    if (opts.quiet) return rebuild();

    var name = layerLabel(checkboxId);
    var msg =
      "正在更新 3D 图层：" +
      name +
      "（" +
      features.length.toLocaleString() +
      " 个要素）";
    return runWithBusy(msg, rebuild);
  }

  /**
   * 仅更新图层透明度 —— 不重建数据源，逐要素改 alpha，瞬时生效
   * @param {string} checkboxId
   * @param {number} opacity 0~1
   * @returns {boolean} 是否成功（图层不存在时返回 false，调用方需回退到重建）
   */
  function updateLayerOpacity(checkboxId, opacity) {
    if (!viewer || !window.CesiumGeoJsonAdapter) return false;
    // 隐藏中的图层也要同步透明度，否则重新勾选时会变回旧值
    var ds = cesiumLayerCache[checkboxId] || cesiumHiddenCache[checkboxId];
    if (!ds) return false;
    try {
      window.CesiumGeoJsonAdapter.updateOpacity(ds, opacity);
      return true;
    } catch (e) {
      console.warn("[CesiumViewer] 透明度更新失败:", checkboxId, e);
      return false;
    }
  }

  /**
   * 重建全部图层（全局样式开关变化后调用）
   * @param {Object} [opts] - { quiet: true } 不显示忙碌提示
   */
  function reloadAllLayers(opts) {
    opts = opts || {};
    if (!viewer) return Promise.resolve();
    hidePopup();

    function rebuild() {
      Object.keys(cesiumLayerCache).forEach(destroyLayer);
      Object.keys(cesiumHiddenCache).forEach(destroyLayer);
      return syncAllLayers();
    }

    if (opts.quiet) return rebuild();
    return runWithBusy("正在更新 3D 图层样式…", rebuild);
  }

  /**
   * 同步所有已加载的 2D 图层到 Cesium（串行加载，可上报进度）
   * @param {function} [onProgress] - (done, total, layerName) => void
   * @returns {Promise<void>}
   */
  function syncAllLayers(onProgress) {
    var featureCache = window._featureCache;
    var jobs = [];

    if (featureCache) {
      for (var checkboxId in featureCache) {
        if (!Object.prototype.hasOwnProperty.call(featureCache, checkboxId))
          continue;
        var features = featureCache[checkboxId];
        if (!features || features.length === 0) continue;
        var cb = document.getElementById(checkboxId);
        if (cb && !cb.checked) continue;
        if (cesiumLayerCache[checkboxId]) continue; // 幂等
        jobs.push({
          checkboxId: checkboxId,
          geoJson: { type: "FeatureCollection", features: features },
        });
      }
    }

    var total = jobs.length;
    var done = 0;
    if (onProgress) onProgress(0, total, "");
    if (!total) return Promise.resolve();

    return jobs.reduce(function (chain, job) {
      return chain.then(function () {
        if (onProgress) onProgress(done, total, layerLabel(job.checkboxId));
        return addLayer(job.checkboxId, job.geoJson).then(function () {
          done++;
          if (onProgress)
            onProgress(done, total, layerLabel(job.checkboxId));
        });
      });
    }, Promise.resolve());
  }

  // ========== 场景主题（跟随站点黑白模式） ==========
  // Cesium 没有「一键浅色模式」这种总开关，官方做法是逐个设置 Scene / Globe 的属性：
  //   scene.skyBox.show        星空盒（1.107+ 才有 show，旧版本只能置 undefined）
  //   scene.backgroundColor    没有影像覆盖处的背景色（默认 Color.BLACK）
  //   scene.globe.baseColor    地球底色
  //   scene.skyAtmosphere      蓝色大气光晕
  //   scene.globe.showGroundAtmosphere / scene.fog / scene.sun / scene.moon
  //
  // ⚠️ 大气三件套的区别（2026-08-29 用户反馈「地球像蒙了一层白的，很模糊」后梳理）：
  //   showGroundAtmosphere —— 直接叠加在**地表影像之上**的大气散射，是发白/发糊的主因
  //   scene.fog            —— 远处雾化，同样让画面泛白、压低对比度
  //   skyAtmosphere        —— 地球**外缘**的淡蓝光晕（在轮廓之外，不覆盖地表）
  // 默认全部关闭以保证影像清晰；想找回氛围感可运行时调用
  //   CesiumViewer.setAtmosphere(true)（见下方 applySceneTheme 的实现）
  var THEME_LIGHT = {
    skyBox: false,
    backgroundColor: "#ffffff",
    baseColor: "#eceff1",
    skyAtmosphere: false,
    groundAtmosphere: false,
    fog: false,
    sun: false,
    moon: false,
  };
  var THEME_DARK = {
    skyBox: true,
    backgroundColor: "#000000",
    baseColor: "#1c1c28",
    skyAtmosphere: false,
    groundAtmosphere: false,
    fog: false,
    sun: true,
    moon: true,
  };
  // 运行时覆盖：null = 跟随主题，true/false = 强制开关
  var _atmosphereOverride = null;
  var _savedSkyBox = null;

  function isDarkTheme() {
    if (document.documentElement.getAttribute("data-theme") === "dark")
      return true;
    try {
      return localStorage.getItem("dupal_toggle_darkMode") === "true";
    } catch (e) {
      return true;
    }
  }

  /**
   * 按站点当前黑白模式套用 3D 场景配色（浅色：白底无星空；深色：黑底带星空）
   */
  function applySceneTheme() {
    if (!viewer) return;
    var Cs = window.Cesium;
    var scene = viewer.scene;
    if (!Cs || !scene) return;
    var t = isDarkTheme() ? THEME_DARK : THEME_LIGHT;
    if (_atmosphereOverride !== null) {
      // 只覆盖大气三件套，其余（星空盒 / 底色 / 日月）仍跟随主题
      t = Object.assign({}, t, {
        skyAtmosphere: _atmosphereOverride,
        groundAtmosphere: _atmosphereOverride,
        fog: _atmosphereOverride,
      });
    }

    try {
      // 星空盒：优先用官方的 show（1.107+），旧版本退化为置 undefined
      if (scene.skyBox) {
        _savedSkyBox = scene.skyBox;
        if (typeof scene.skyBox.show === "boolean") {
          scene.skyBox.show = t.skyBox;
        } else if (!t.skyBox) {
          scene.skyBox = undefined;
        }
      } else if (t.skyBox && _savedSkyBox) {
        scene.skyBox = _savedSkyBox;
      }

      scene.backgroundColor = Cs.Color.fromCssColorString(t.backgroundColor);

      if (scene.globe) {
        scene.globe.baseColor = Cs.Color.fromCssColorString(t.baseColor);
        scene.globe.showGroundAtmosphere = t.groundAtmosphere;
        scene.globe.dynamicAtmosphereLighting = false;
      }
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = t.skyAtmosphere;
      if (scene.fog) scene.fog.enabled = t.fog;
      if (scene.sun) scene.sun.show = t.sun;
      if (scene.moon) scene.moon.show = t.moon;

      viewer.scene.requestRender && viewer.scene.requestRender();
    } catch (e) {
      console.warn("[CesiumViewer] 场景主题应用失败:", e);
    }
  }

  // ========== 地球瓦片清晰度（2026-08-29 实测结论）==========
  //
  // 之前为了压 429 限流用过 SSE=24→12 渐进。但实测发现：
  //   · SSE=12 在 zoom 8 视角下锐度仅 1.4（拉普拉斯方差，几乎纯色），
  //     也就是用户说的"放大后还是最低级的瓦片层级"
  //   · 单域（SSE=2 + t0）全球视角 34.4s
  //   · 八子域（SSE=2 + t0~t7）反而**更快**——全球 6.8s、zoom8 3.8s，锐度 568
  //
  // 根因：Cesium 的 RequestScheduler per-server 并发上限默认 6，单域时所有
  // 请求挤 t0 一台；八子域轮询把等效并发提到 48，多台服务器分担负载，429
  // 反而变成次要因素（被触发但内置重试扛住）。
  //
  // 因此清晰度直接交回 Cesium 默认值，不再做渐进的"清晰度换速度"妥协。
  function setupGlobeTileBudget() {
    if (!viewer || !viewer.scene || !viewer.scene.globe) return;
    viewer.scene.globe.maximumScreenSpaceError = 2; // Cesium 默认；配合八子域体验最佳
  }

  // ========== Viewer 初始化 ==========
  function initViewer() {
    if (viewer) return;

    var container = document.getElementById("cesiumContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "cesiumContainer";
      var mapEl = document.getElementById("map");
      if (mapEl && mapEl.parentNode) {
        mapEl.parentNode.insertBefore(container, mapEl.nextSibling);
      } else {
        document.body.appendChild(container);
      }
    }

    if (window.CesiumTerrain && window.CesiumTerrain.initIonToken) {
      window.CesiumTerrain.initIonToken();
    }

    viewer = new window.Cesium.Viewer("cesiumContainer", {
      imageryProvider: false, // 稍后由 syncBasemap() 替换
      terrainProvider: undefined, // 稍后异步加载
      animation: false,
      timeline: false,
      // 三视图切换（3D / 2D / 哥伦布）：构造时创建，显隐由「缩放控件」开关（body.ogv-zoom-ctl）控制
      sceneModePicker: true,
      baseLayerPicker: false,
      // 操作帮助：显隐同受「缩放控件」开关控制；全屏按钮已移除（用处不大，不创建）
      navigationHelpButton: true,
      homeButton: false,
      geocoder: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      requestRenderMode: false,
      contextOptions: {
        webgl: { alpha: false, antialias: true },
      },
    });

    if (viewer.bottomContainer) viewer.bottomContainer.style.display = "none";

    // 背景配色跟随站点黑白模式（浅色 → 白底无星空）
    applySceneTheme();

    setupGlobeTileBudget();

    syncBasemap();

    if (window.CesiumTerrain && window.CesiumTerrain.getTerrainProvider) {
      window.CesiumTerrain.getTerrainProvider().then(function (terrain) {
        if (terrain && viewer) {
          viewer.terrainProvider = terrain;
        }
      });
    }

    setupClickHandler();
  }

  // ========== 激活 / 取消 / 停用 ==========
  function activate() {
    // 注意：这里只挡 isActive，不挡 isLoading——
    // isLoading 可能是后台预加载，此时用户主动点开应当「搭车」而不是被吞掉点击。
    if (isActive) return;

    var seq = ++_activationSeq;
    function aborted() {
      return seq !== _activationSeq;
    }

    // 已预加载过就别再闪「正在下载」了
    showLoading(
      isLoaded
        ? "正在初始化 3D 场景…"
        : "正在下载 3D 引擎（约 4MB，首次加载较慢）…",
      isLoaded ? null : 0,
    );

    loadCesiumJs(function (p, loaded, phase) {
      if (aborted()) return;
      if (phase === "parse") {
        showLoading("正在解析 3D 引擎（首次较慢）…", null);
      } else {
        showLoading("正在下载 3D 引擎…", p, loaded);
      }
    })
      .then(function () {
        if (aborted()) return null;
        showLoading("正在初始化 3D 场景…", null);
        // 让浏览器有机会把「初始化中」画出来
        return new Promise(function (r) {
          setTimeout(r, 30);
        });
      })
      .then(function () {
        if (aborted()) return;
        initViewer();

        isActive = true;
        document.body.classList.add("view-3d-active");
        syncCameraFromLeaflet();
        if (viewer) viewer.resize();

        return syncAllLayers(function (done, total, name) {
          if (aborted()) return;
          if (!total) return;
          showLoading(
            "正在渲染图层 " + done + "/" + total + (name ? "：" + name : ""),
            total ? done / total : 0,
          );
        });
      })
      .then(function () {
        if (aborted()) return;
        // 处理待处理队列
        while (_pendingLayers.length > 0) {
          var item = _pendingLayers.shift();
          addLayer(item.checkboxId, item.geoJson);
        }
        hideLoading();
        if (viewer) viewer.resize();

        if (window.showToast) {
          window.showToast("🌍 3D 视图 — 拖拽旋转 · 滚轮缩放 · 右键倾斜", {
            duration: 5000,
          });
        }
      })
      .catch(function (err) {
        if (aborted()) return;
        hideLoading();
        console.error("[CesiumViewer] 激活失败:", err);
        if (window.showToast) {
          window.showToast("❌ 3D 引擎加载失败: " + err.message, {
            duration: 5000,
          });
        }
        resetToggleState();
      });
  }

  /**
   * 取消正在进行的 3D 加载（加载遮罩的「取消」按钮 / 关闭开关）
   */
  function cancelActivate() {
    _activationSeq++; // 让进行中的 activate 流程立即失效
    hideLoading();
    if (isActive) deactivate();
    resetToggleState();
    if (window.showToast) {
      window.showToast("已取消 3D 视图加载", { duration: 2000 });
    }
  }

  function resetToggleState() {
    var cb = document.getElementById("view3dToggle");
    if (cb) cb.checked = false;
    try {
      localStorage.setItem(TOGGLE_KEY, "false");
    } catch (e) {}
  }

  function deactivate() {
    if (!isActive) return;
    syncCameraToLeaflet();
    isActive = false;
    document.body.classList.remove("view-3d-active");
    hidePopup();
    if (window.showToast) {
      window.showToast("🗺️ 已切换到 2D 视图", { duration: 2000 });
    }
  }

  // ========== 暴露 API ==========
  window.CesiumViewer = {
    activate: activate,
    cancelActivate: cancelActivate,
    deactivate: deactivate,
    addLayer: addLayer,
    removeLayer: removeLayer, // 隐藏（保留数据源，再开瞬时）
    hideLayer: hideLayer,
    destroyLayer: destroyLayer, // 真销毁
    reloadLayer: reloadLayer,
    reloadAllLayers: reloadAllLayers,
    syncAllLayers: syncAllLayers,
    syncCameraFromLeaflet: syncCameraFromLeaflet,
    syncCameraToLeaflet: syncCameraToLeaflet,
    syncBasemap: syncBasemap,
    syncOverlays: syncOverlays,
    flyToFeature: flyToFeature,
    flyToLayerBounds: flyToLayerBounds,
    updateLayerOpacity: updateLayerOpacity,
    applySceneTheme: applySceneTheme,
    /**
     * 运行时开关「大气效果」（地面大气 + 雾 + 外缘光晕）。
     * 传 true/false 强制；传 null 恢复跟随站点黑白模式。
     * @param {boolean|null} enabled
     */
    setAtmosphere: function (enabled) {
      _atmosphereOverride = enabled === null ? null : !!enabled;
      applySceneTheme();
    },
    get atmosphereEnabled() {
      return _atmosphereOverride;
    },
    /**
     * 手动预加载 3D 引擎（自动预加载已禁用，PWA 缓存已覆盖二次访问）
     * @returns {boolean} 是否真的启动了预加载
     */
    preloadNow: function () {
      return preloadCesium();
    },
    hidePopup: hidePopup,
    get isActive() {
      return isActive;
    },
    get isLoading() {
      return isLoading;
    },
    get isLoaded() {
      return isLoaded;
    },
    get viewer() {
      return viewer;
    },
    /** 调试用：当前显示中 / 隐藏保留的图层数 */
    get layerStats() {
      return {
        visible: Object.keys(cesiumLayerCache).length,
        hidden: Object.keys(cesiumHiddenCache).length,
      };
    },
  };

  // ========== 刷新后不自动进入 3D ==========
  // 3D 引擎体积大（~4MB），刷新即自动加载会严重拖慢首屏。
  // 因此每次页面加载都强制把持久化开关复位为「关」，3D 只能由用户主动开启。
  (function resetPersisted3DState() {
    resetToggleState();
    console.log("[CesiumViewer] 3D 视图默认关闭，需用户手动开启");
  })();

  // 之前这里挂的是「空闲自动预加载 3D 引擎」。
  // 考虑到项目已有 PWA（service-worker.js 动态缓存同源资源），
  // 用户首次开启 3D 后 Cesium.js 已落到 Cache Storage，第二次直接秒开，
  // 空闲预加载的边际收益太小，2026-08-29 已移除自动调度。
  // 手动入口仍保留：CesiumViewer.preloadNow()
})();
