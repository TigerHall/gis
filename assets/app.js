/**
 * app.js
 * 应用管理：版本号显示、清理菜单、导出图片、PWA 更新弹窗
 * 与地图核心逻辑无关，独立拆分以保持关注点分离
 * 加载时机：必须在 dialog.js + 主脚本块之后（依赖 showToast/map）
 *
 * ⚠️ 新增地图设置开关 → 在下方 TOGGLE_GROUPS 数据数组中添加一项即可
 */

// ========== 付费激活码（每月更新） ==========
var _PR_CODES = ["837291", "460518", "915742", "283604", "671849"];
(function () {
  // ========== 数据驱动渲染（必须在 toggleConfig 执行前创建 DOM）==========
  (function () {
    var body = document.getElementById("toggleBody");
    if (!body || body.children.length > 0) return;

    var TOGGLE_GROUPS = [
      {
        category: "显示",
        items: [
          {
            id: "clusterToggle",
            label: "点要素聚类",
            desc: "开启后点要素按空间距离聚合成群组显示，大幅减轻渲染压力，页面操作更流畅",
            checked: true,
          },
          {
            id: "labelToggle",
            label: "显示标签",
            desc: "开启后在地图上显示各点要素的名称标签，便于识别站位和热点位置",
          },
        ],
      },
      {
        category: "控件",
        items: [
          {
            id: "mouseCoordToggle",
            label: "鼠标坐标",
            desc: "开启/关闭鼠标位置经纬度坐标显示控件，实时查看光标所在位置的经纬度",
            checked: true,
          },
          {
            id: "zoomToggle",
            label: "缩放控件",
            desc: "开启/关闭地图左上角的加减号缩放控件（仍可用鼠标滚轮缩放）",
          },
          {
            id: "scaleToggle",
            label: "比例尺",
            desc: "开启/关闭地图左下角的比例尺条，直观显示当前缩放级别下的距离比例",
          },
          {
            id: "geomenToggle",
            label: "编辑测量",
            desc: "开启/关闭要素编辑与测量工具栏（绘制、修改、删除、测距、测面）",
          },
          {
            id: "layerCtrlToggle",
            label: "图层控件",
            desc: "开启/关闭右上角的图层切换控件，可切换天地图不同底图图层",
            checked: true,
          },
          {
            id: "moreBasemapToggle",
            label: "更多底图",
            desc: "开启后显示更多底图和覆盖层选项（ArcGIS扩展、天地图标注等）",
          },
        ],
      },
      {
        category: "数据",
        items: [
          {
            id: "clipboardToggle",
            label: "识别粘贴",
            desc: "开启后自动读取剪贴板中的坐标/CSV数据并解析为投点图层；关闭后需手动粘贴",
            checked: true,
          },
          {
            id: "rememberLayerToggle",
            label: "记住图层",
            desc: "开启后记住用户上传的图层和勾选状态，刷新页面自动恢复",
            checked: true,
          },
        ],
      },
      {
        category: "高级",
        items: [
          {
            id: "darkModeToggle",
            label: "深色模式",
            desc: "开启后切换为深色主题，适合弱光环境使用，减少屏幕眩光",
          },
          {
            id: "premiumToggle",
            label: "高级功能",
            desc: "开启后进入激活流程，输入激活码解锁下载 GeoJSON 等高级功能",
          },
        ],
      },
      {
        category: "操作",
        items: [
          {
            type: "button",
            id: "exportMapBtn",
            label: "导出图片",
            icon: "📷",
            desc: "将当前地图截图导出为 PNG 图片",
          },
          {
            type: "button",
            id: "geoLocateBtn",
            label: "定位当前位置",
            icon: "📍",
            desc: "获取设备 GPS 坐标，在地图上标记当前位置并记录备注与分类",
          },
        ],
      },
    ];

    var html = "";
    for (var gi = 0; gi < TOGGLE_GROUPS.length; gi++) {
      var group = TOGGLE_GROUPS[gi];
      html += '<div class="toggle-category">' + group.category + "</div>";
      for (var ii = 0; ii < group.items.length; ii++) {
        var item = group.items[ii];
        if (item.type === "button") {
          html +=
            '<div class="toggle-bar" id="' +
            item.id +
            'Bar" title="' +
            (item.desc || "") +
            '">' +
            '<button class="action-btn" id="' +
            item.id +
            '">' +
            (item.icon || "") +
            " " +
            item.label +
            "</button>" +
            "</div>";
        } else {
          html +=
            '<div class="toggle-bar" id="' +
            item.id +
            'Bar" title="' +
            item.desc +
            '">' +
            '<label class="cluster-toggle-label">' +
            '<span class="cluster-toggle-text">' +
            item.label +
            "</span>" +
            '<input type="checkbox" id="' +
            item.id +
            '"' +
            (item.checked ? " checked" : "") +
            ">" +
            '<span class="cluster-toggle-switch"></span>' +
            "</label>" +
            "</div>";
        }
      }
    }
    body.innerHTML = html;

    // 绑定导出图片按钮事件
    var exportBtn = document.getElementById("exportMapBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        exportMapImage();
      });
    }
    var geoBtn = document.getElementById("geoLocateBtn");
    if (geoBtn) {
      geoBtn.addEventListener("click", function () {
        if (typeof window.startGeoLocate === "function") {
          window.startGeoLocate();
        } else {
          if (typeof window.showToast === "function") {
            window.showToast("⏳ 定位功能加载中，请稍后再试", {
              duration: 2000,
            });
          }
        }
      });
    }
  })();

  // ========== 版本号显示 ==========
  // 从 service-worker.js 读取 CACHE_NAME 保持版本同步
  // 版本号显示在图层面板底部，也用于 PWA 更新弹窗
  var _appVersion = "";
  fetch("service-worker.js?" + Date.now())
    .then(function (r) {
      return r.text();
    })
    .then(function (src) {
      var m = src.match(/CACHE_NAME\s*=\s*["']([^"']+)["']/);
      if (m) {
        _appVersion = m[1];
        var el = document.getElementById("appVersion");
        if (el) el.textContent = m[1];
      }
    })
    .catch(function () {});

  // ========== 版号点击 → 清理菜单 ==========
  (function () {
    var el = document.getElementById("appVersion");
    if (!el) return;

    function clearSWCache() {
      if (!window.caches) return Promise.resolve();
      return caches.keys().then(function (names) {
        return Promise.all(
          names.map(function (n) {
            return caches.delete(n);
          }),
        );
      });
    }
    function clearIDB() {
      if (window.L && window.L.GzIdbLoader && window.L.GzIdbLoader.clearCache) {
        return window.L.GzIdbLoader.clearCache();
      }
      return new Promise(function (resolve) {
        var req = indexedDB.deleteDatabase("GzGeoJSONCache");
        req.onsuccess = req.onerror = resolve;
      });
    }
    function doRefresh(all) {
      // 保存高级功能激活状态，避免被 clear 清除
      var premium = localStorage.getItem("ogv_premium_active");
      localStorage.clear();
      // 恢复高级功能激活
      if (premium) localStorage.setItem("ogv_premium_active", premium);
      var tasks = [clearSWCache()];
      if (all) tasks.push(clearIDB());
      Promise.all(tasks).then(function () {
        location.reload(true);
      });
    }
    function toggleMenu() {
      // 菜单是 #appVersion 的前一个兄弟节点
      var menu = el.previousElementSibling;
      if (!menu || !menu.classList.contains("refresh-menu")) {
        menu = null;
      }
      if (menu) {
        menu.remove();
        return;
      }
      menu = document.createElement("div");
      menu.className = "refresh-menu";
      menu.innerHTML =
        '<button data-mode="export">📷 导出图片</button>' +
        '<button data-mode="refresh">🔄 刷新页面</button>' +
        '<button data-mode="sw">🧹 清理网页缓存</button>' +
        '<button data-mode="all">🗑️ 彻底清理</button>' +
        '<button id="changelogBtn">📝 更新记录</button>';
      menu.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-mode]");
        if (!btn) return;
        menu.remove();
        if (btn.dataset.mode === "export") {
          exportMapImage();
        } else if (btn.dataset.mode === "refresh") {
          location.reload();
        } else {
          doRefresh(btn.dataset.mode === "all");
        }
      });
      // 插入到 #appVersion 前面（版号上方）
      el.parentNode.insertBefore(menu, el);

      // 更新记录按钮事件
      setTimeout(function () {
        var clogBtn = document.getElementById("changelogBtn");
        if (clogBtn) {
          clogBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            menu.remove();
            showMarkdown("docs/CHANGELOG.md", "📝 更新记录");
          });
        }
      }, 0);
    }

    el.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleMenu();
    });
  })();

  // ========== 导出地图图片（html-to-image 截图）==========
  function exportMapImage() {
    if (!window.map || !window.htmlToImage) return;
    // 先关掉上一次的导出提示
    if (window._exportToast) {
      closeToast(window._exportToast);
      window._exportToast = null;
    }
    window._exportToast = showToast(
      "⏳ 正在导出地图图片，图层复杂时可能较慢，请勿操作…",
      { duration: 0 },
    );
    var mapEl = document.getElementById("map");
    var panel = document.getElementById("layerPanel");
    var trigger = document.getElementById("layerTrigger");

    // 控制节点通过 toPng 的 filter 回调排除，无需移出 DOM

    // 隐藏侧边栏
    var panelWasActive = panel && panel.classList.contains("active");
    if (panelWasActive) panel.classList.remove("active");
    if (trigger) trigger.style.display = "none";

    // 等一帧 + 等瓦片加载完，再截图，避免底图错位
    requestAnimationFrame(function () {
      var tileLayers = [];
      map.eachLayer(function (layer) {
        if (layer instanceof L.TileLayer && layer._map) {
          tileLayers.push(layer);
        }
      });

      // 等待所有瓦片加载完成（最多等 3 秒）
      var waitTiles = function (cb) {
        if (tileLayers.length === 0) {
          cb();
          return;
        }
        var loaded = 0;
        var done = false;
        tileLayers.forEach(function (ly) {
          if (ly._loading) {
            ly.once("load", function () {
              loaded++;
              if (!done && loaded >= tileLayers.length) {
                done = true;
                cb();
              }
            });
          } else {
            loaded++;
          }
        });
        if (!done && loaded >= tileLayers.length) {
          cb();
          return;
        }
        // 超时保护
        setTimeout(function () {
          if (!done) {
            done = true;
            cb();
          }
        }, 3000);
      };

      waitTiles(function () {
        // 摊平 Leaflet pane 的 transform，避免 html-to-image 处理 translate3d 出错
        // 原理：读取 pane 的 translate3d(x, y, z)，改成 left/top 定位，清空 transform
        var savedPanes = [];
        var panes = mapEl.querySelectorAll(".leaflet-pane");
        panes.forEach(function (pane) {
          var st = window.getComputedStyle(pane);
          var tx = st.transform;
          if (!tx || tx === "none") return;
          // 解析 matrix/matrix3d
          var mat = tx.match(/matrix(?:3d)?\(([^)]+)\)/);
          if (!mat) return;
          var vals = mat[1].split(",").map(parseFloat);
          var px = 0,
            py = 0;
          if (tx.indexOf("matrix3d") === 0) {
            px = vals[12];
            py = vals[13];
          } else {
            px = vals[4];
            py = vals[5];
          }
          if (Math.abs(px) < 0.5 && Math.abs(py) < 0.5) return;
          var pos =
            pane.style.position || window.getComputedStyle(pane).position;
          savedPanes.push({
            el: pane,
            transform: pane.style.transform,
            left: pane.style.left,
            top: pane.style.top,
            position: pane.style.position,
          });
          pane.style.transform = "";
          pane.style.position = "absolute";
          pane.style.left = pane.offsetLeft + px + "px";
          pane.style.top = pane.offsetTop + py + "px";
        });

        htmlToImage
          .toPng(mapEl, {
            backgroundColor: "#fff",
            pixelRatio: Math.min(window.devicePixelRatio || 2, 3),
            filter: function (node) {
              if (!node || !node.classList) return true;
              if (node.closest) {
                return !node.closest(
                  ".leaflet-control-container, .leaflet-control, .leaflet-popup, .leaflet-tooltip",
                );
              }
              return true;
            },
          })
          .then(function (dataUrl) {
            // 恢复 pane 的 transform
            savedPanes.forEach(function (item) {
              item.el.style.transform = item.transform;
              item.el.style.left = item.left;
              item.el.style.top = item.top;
              item.el.style.position = item.position;
            });
            if (panelWasActive && panel) panel.classList.add("active");
            if (trigger) trigger.style.display = "";
            map.invalidateSize();

            var now = new Date();
            var ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
              .map(function (n) {
                return String(n).padStart(2, "0");
              })
              .join("");
            var a = document.createElement("a");
            a.download = "OGV_" + ts + ".png";
            a.href = dataUrl;
            a.click();
            if (window._exportToast) {
              closeToast(window._exportToast);
              window._exportToast = null;
            }
            showToast("✅ 导出成功", { duration: 3000 });
          })
          .catch(function () {
            // 恢复 pane 的 transform
            savedPanes.forEach(function (item) {
              item.el.style.transform = item.transform;
              item.el.style.left = item.left;
              item.el.style.top = item.top;
              item.el.style.position = item.position;
            });
            if (panelWasActive && panel) panel.classList.add("active");
            if (trigger) trigger.style.display = "";
            map.invalidateSize();
            if (window._exportToast) {
              closeToast(window._exportToast);
              window._exportToast = null;
            }
            showToast("❌ 导出失败", { duration: 3000 });
          });
      });
    });
  }

  // Ctrl+E 快捷键导出图片
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault();
      exportMapImage();
    }
  });

  // ========== SW 更新弹窗 ==========
  var _swRegistration = null;

  window._showUpdateToast = function (newVersion) {
    var versionLabel = newVersion || _appVersion || "";
    var msg = versionLabel
      ? "新版本 " + versionLabel + " 已就绪"
      : "📦 新版本可用";
    showToast(msg, {
      duration: 0,
      action: "刷新",
      onAction: function () {
        // 先通知新 SW 激活（skipWaiting），再重新加载
        if (_swRegistration && _swRegistration.waiting) {
          _swRegistration.waiting.postMessage({ action: "skipWaiting" });
        }
        location.reload();
      },
    });
  };
  if (window._swUpdateAvailable) window._showUpdateToast(_appVersion);

  // ========== Service Worker 注册 ==========
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("service-worker.js")
        .then(function (registration) {
          _swRegistration = registration;

          // 检测新版本：SW 文件变化时会触发 updatefound
          registration.addEventListener("updatefound", function () {
            var newWorker = registration.installing;
            newWorker.addEventListener("statechange", function () {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // 新 SW 已安装且旧 SW 仍在控制页面 → 有更新可用
                window._swUpdateAvailable = true;
                // 尝试读取新 SW 的版本号（当前页面还是旧版本）
                var _newVersion = "";
                try {
                  fetch("service-worker.js?" + Date.now())
                    .then(function (r) {
                      return r.text();
                    })
                    .then(function (src) {
                      var m = src.match(/CACHE_NAME\s*=\s*["']([^"']+)["']/);
                      if (m) _newVersion = m[1];
                    })
                    .finally(function () {
                      if (window._showUpdateToast)
                        window._showUpdateToast(_newVersion);
                    });
                } catch (e) {
                  if (window._showUpdateToast) window._showUpdateToast();
                }
              }
            });
          });
        })
        .catch(function (error) {
          console.error("Service Worker注册失败：", error);
        });
    });
  }

  // ========== 自动识别剪贴板开关初始化 ==========
  (function () {
    var cb = document.getElementById("clipboardToggle");
    if (cb) {
      var saved = localStorage.getItem("dupal_toggle_clipboard");
      cb.checked = saved !== null ? saved === "true" : true; // 默认开启
      cb.addEventListener("change", function () {
        localStorage.setItem("dupal_toggle_clipboard", String(this.checked));
      });
    }
  })();

  // ========== 记住图层开关初始化 ==========
  (function () {
    var cb = document.getElementById("rememberLayerToggle");
    if (cb) {
      var saved = localStorage.getItem("dupal_toggle_rememberLayer");
      cb.checked = saved !== null ? saved === "true" : true; // 默认开启
      cb.addEventListener("change", function () {
        localStorage.setItem(
          "dupal_toggle_rememberLayer",
          String(this.checked),
        );
        if (!this.checked) {
          // 关闭 → 清除所有已保存的记录
          // 1. 清除用户图层 GeoJSON 和索引
          var list = [];
          try {
            list = JSON.parse(
              localStorage.getItem("dupal_user_layers") || "[]",
            );
          } catch (e) {}
          list.forEach(function (meta) {
            L.GzIdbLoader.delCache("user_geo_" + meta.id);
            L.GzIdbLoader.deleteSearchIndex("user_" + meta.id);
          });
          localStorage.removeItem("dupal_user_layers");
          // 2. 清除所有图层的勾选状态（内置 + 用户上传）
          var keysToRemove = [];
          for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (
              key &&
              (key.indexOf("dupal_layer_") === 0 ||
                key.indexOf("dupal_user_layer_") === 0)
            ) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(function (k) {
            localStorage.removeItem(k);
          });
        } else {
          // 打开 → 保存当前所有用户图层
          var userLayerGeoJson = window._userLayerGeoJson || {};
          Object.keys(userLayerGeoJson).forEach(function (uid) {
            var info = userLayerGeoJson[uid];
            if (info && info.persistentId) {
              var pid = info.persistentId;
              L.GzIdbLoader.setCache("user_geo_" + pid, info.geoJsonData);
              var list2 = [];
              try {
                list2 = JSON.parse(
                  localStorage.getItem("dupal_user_layers") || "[]",
                );
              } catch (e) {}
              if (
                !list2.find(function (e) {
                  return e.id === pid;
                })
              ) {
                list2.push({ id: pid, fileName: info.fileName });
                localStorage.setItem(
                  "dupal_user_layers",
                  JSON.stringify(list2),
                );
              }
            }
          });
        }
      });
    }
  })();

  // ========== 更多底图开关初始化及事件绑定 ==========
  (function () {
    var cb = document.getElementById("moreBasemapToggle");
    if (cb) {
      var saved = localStorage.getItem("dupal_toggle_moreBasemap");
      cb.checked = saved !== null ? saved === "true" : false;
      cb.addEventListener("change", function () {
        localStorage.setItem("dupal_toggle_moreBasemap", String(this.checked));
        if (typeof window.rebuildLayerCtrl === "function")
          window.rebuildLayerCtrl();
      });
    }
  })();
})();

// ========== 地图控件开关持久化 ==========
(function () {
  var TOGGLE_PREFIX = "dupal_toggle_";

  // Geoman 选项
  var GEOMEN_OPTS = {
    position: "topright",
    drawCircleMarker: true,
    drawText: true,
    drawMarker: false,
    drawCircle: true,
    drawPolyline: true,
    drawPolygon: true,
    drawRectangle: false,
    editMode: false,
    dragMode: true,
    cutPolygon: false,
    rotateMode: false,
    removalMode: true,
  };

  // 开关配置：cbId → { storageKey, control?, enable?, disable? }
  var toggleConfig = {
    darkModeToggle: {
      storageKey: TOGGLE_PREFIX + "darkMode",
      enable: function () {
        document.documentElement.setAttribute("data-theme", "dark");
        document.documentElement.style.colorScheme = "dark";
      },
      disable: function () {
        document.documentElement.removeAttribute("data-theme");
        document.documentElement.style.colorScheme = "light";
      },
    },
    mouseCoordToggle: {
      storageKey: TOGGLE_PREFIX + "mouseCoord",
      enable: function () {
        if (!window._mousePosControl) {
          window._mousePosControl = L.control
            .mousePosition({
              position: "topright",
              showZoom: true,
              zoomLabel: "缩放: {zoom} ",
              format: "经度: {lng}, 纬度: {lat}",
              precision: 5,
              showFullscreen: true,
            })
            .addTo(map);
        }
      },
      disable: function () {
        if (window._mousePosControl) {
          map.removeControl(window._mousePosControl);
          window._mousePosControl = null;
        }
      },
    },
    geomenToggle: {
      storageKey: TOGGLE_PREFIX + "geomen",
      enable: function () {
        map.pm.addControls(GEOMEN_OPTS);
        map.pm.setLang("zh");
      },
      disable: function () {
        map.pm.removeControls();
      },
    },
    zoomToggle: {
      storageKey: TOGGLE_PREFIX + "zoom",
      control: map.zoomControl,
    },
    scaleToggle: {
      storageKey: TOGGLE_PREFIX + "scale",
      enable: function () {
        if (!window._scaleControl) {
          window._scaleControl = L.control
            .scale({
              imperial: false,
              maxWidth: 100,
              position: "bottomleft",
            })
            .addTo(map);
        }
      },
      disable: function () {
        if (window._scaleControl) {
          map.removeControl(window._scaleControl);
          window._scaleControl = null;
        }
      },
    },
    layerCtrlToggle: {
      storageKey: TOGGLE_PREFIX + "layerCtrl",
      enable: function () {
        window.rebuildLayerCtrl();
      },
      disable: function () {
        if (window._layerCtrlControl) {
          map.removeControl(window._layerCtrlControl);
          window._layerCtrlControl = null;
        }
      },
    },
    premiumToggle: {
      storageKey: TOGGLE_PREFIX + "premium",
      enable: function () {
        if (
          typeof window.premiumCheck === "function" &&
          window.premiumCheck()
        ) {
          return; // 已激活，无需再次弹窗
        }
        if (typeof window.showPremiumActivation === "function") {
          window.showPremiumActivation(function (ok) {
            if (!ok) {
              var cb = document.getElementById("premiumToggle");
              if (cb) {
                cb.checked = false;
                localStorage.setItem(TOGGLE_PREFIX + "premium", "false");
              }
            }
          });
        }
      },
      disable: function () {
        // 已激活后不允许关闭
        if (
          typeof window.premiumCheck === "function" &&
          window.premiumCheck()
        ) {
          var cb = document.getElementById("premiumToggle");
          if (cb) {
            cb.checked = true;
            localStorage.setItem(TOGGLE_PREFIX + "premium", "true");
          }
          return;
        }
      },
    },
  };

  // 初始化主题：仅置顶开关状态，由 initToggle 同时设置 data-theme
  (function initTheme() {
    var saved = localStorage.getItem(TOGGLE_PREFIX + "darkMode");
    if (saved === null) {
      var isDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      localStorage.setItem(TOGGLE_PREFIX + "darkMode", String(isDark));
    }
  })();

  function initToggle(cbId, cfg) {
    var cb = document.getElementById(cbId);
    if (!cb) return;

    var saved = localStorage.getItem(cfg.storageKey);
    var defaultChecked = cb.checked;
    var checked = saved !== null ? saved === "true" : defaultChecked;
    cb.checked = checked;

    // 同步控件状态：勾选时创建（懒加载），未勾选时移除
    if (checked) {
      if (cfg.enable) cfg.enable();
      else if (cfg.control) cfg.control.addTo(map);
    } else {
      if (cfg.disable) cfg.disable();
      else if (cfg.control) map.removeControl(cfg.control);
    }

    cb.addEventListener("change", function () {
      localStorage.setItem(cfg.storageKey, String(this.checked));
      if (this.checked) {
        if (cfg.enable) cfg.enable();
        else if (cfg.control) cfg.control.addTo(map);
      } else {
        if (cfg.disable) cfg.disable();
        else if (cfg.control) map.removeControl(cfg.control);
      }
    });
  }

  // 同步高级功能激活状态 → 开关
  if (localStorage.getItem("ogv_premium_active") === "true") {
    var _pcb = document.getElementById("premiumToggle");
    if (_pcb) {
      _pcb.checked = true;
      localStorage.setItem("dupal_premium", "true");
    }
  }

  for (var cbId in toggleConfig) {
    if (toggleConfig.hasOwnProperty(cbId)) initToggle(cbId, toggleConfig[cbId]);
  }

  // ========== 高级功能激活码验证 ==========
  (function () {
    var _activated = false;
    var _PR_KEY = "ogv_premium_active";

    _activated = localStorage.getItem(_PR_KEY) === "true";

    // 已激活 → 同步勾上高级功能开关
    if (_activated) {
      var cb = document.getElementById("premiumToggle");
      if (cb) {
        cb.checked = true;
        localStorage.setItem("dupal_premium", "true");
      }
    }

    window.premiumCheck = function () {
      return _activated;
    };

    window.showPremiumActivation = function (callback) {
      if (_activated) {
        if (typeof callback === "function") callback(true);
        return;
      }

      var dlg = document.createElement("dialog");
      dlg.className = "app-dialog premium-dialog";
      dlg.innerHTML =
        '<div class="dialog-header"><h3>🔒 激活高级功能</h3></div>' +
        '<div class="dialog-body">' +
        "<p>请输入激活码：</p>" +
        '<input id="prCodeInput" class="premium-input" type="text" placeholder="输入激活码" />' +
        '<p id="prError" class="premium-error">激活码无效，请检查后重试</p>' +
        '<div class="premium-btns">' +
        '<button id="prCancel" class="premium-btn premium-btn-cancel">取消</button>' +
        '<button id="prSubmit" class="premium-btn premium-btn-submit">验证激活</button>' +
        "</div>" +
        '<p style="margin:8px 0 0;color:var(--text-muted);font-size:11px;">激活永久有效，请勿清除本网站浏览器数据</p>' +
        '<p style="margin:2px 0 0;color:var(--text-muted);font-size:11px;">更换设备后联系管理员重新发码</p>' +
        "</div>";
      document.body.appendChild(dlg);
      dlg.showModal();

      var input = dlg.querySelector("#prCodeInput");
      var errEl = dlg.querySelector("#prError");
      input.focus();

      function showQrAfterActivate(code) {
        // 替换弹窗内容为成功信息 + 二维码
        dlg.querySelector(".dialog-body").innerHTML =
          '<div style="text-align:center;">' +
          '<p style="font-size:15px;font-weight:600;color:var(--accent);margin:0 0 4px;">✅ 高级功能已激活</p>' +
          '<p style="font-size:12px;color:var(--text-muted);margin:0 0 14px;">扫二维码在手机上同步激活此功能</p>' +
          '<img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=' +
          encodeURIComponent(
            location.origin + location.pathname + "?activate=" + code,
          ) +
          '" alt="QR" style="width:140px;height:140px;border-radius:6px;border:1px solid var(--border-light);" />' +
          '<p style="margin:6px 0 0;font-size:10px;color:var(--text-faint);">' +
          (location.origin + location.pathname + "?activate=" + code) +
          "</p>" +
          '<button id="prDone" class="premium-btn premium-btn-submit" style="margin-top:14px;padding:7px 24px;">完成</button>' +
          "</div>";
        dlg.querySelector("#prDone").addEventListener("click", function () {
          dlg.close();
          document.body.removeChild(dlg);
        });
      }

      function doActivate() {
        var code = input.value.trim();
        if (!code) {
          errEl.style.display = "block";
          return;
        }
        if (_PR_CODES.indexOf(code) >= 0) {
          _activated = true;
          localStorage.setItem(_PR_KEY, "true");
          showQrAfterActivate(code);
          if (typeof callback === "function") callback(true);
        } else {
          errEl.style.display = "block";
        }
      }

      dlg.querySelector("#prSubmit").addEventListener("click", doActivate);
      dlg.querySelector("#prCancel").addEventListener("click", function () {
        dlg.close();
        document.body.removeChild(dlg);
        if (typeof callback === "function") callback(false);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          doActivate();
        }
      });
      dlg.addEventListener("close", function () {
        if (document.body.contains(dlg)) document.body.removeChild(dlg);
      });
    };

    window.premiumReset = function () {
      _activated = false;
      localStorage.removeItem(_PR_KEY);
    };

    // ========== URL 参数自动激活（扫码直达）==========
    (function () {
      // 刚通过 URL 激活完成的页面，显示提示
      if (sessionStorage.getItem("_pr_just_activated")) {
        sessionStorage.removeItem("_pr_just_activated");
        setTimeout(function () {
          if (typeof window.showToast === "function")
            window.showToast("✅ 已使用激活码激活高级功能", { duration: 5000 });
        }, 500);
      }
      var m = location.search.match(/[?&]activate=(\d{6})\b/);
      if (m) {
        var code = m[1];
        if (_PR_CODES.indexOf(code) >= 0) {
          _activated = true;
          localStorage.setItem(_PR_KEY, "true");
          sessionStorage.setItem("_pr_just_activated", "1");
          history.replaceState(null, "", location.pathname + location.hash);
          location.reload();
        }
      }
    })();
  })();
})();
