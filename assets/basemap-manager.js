/**
 * basemap-manager.js —— 底图引擎（配置驱动）
 *
 * 职责：把 geo-config.js 里的 BASEMAP_CONFIG 变成真实的 Leaflet 图层，并管理
 *      ① 图层控件（底图单选 + 覆盖层多选）
 *      ② 底图 / 覆盖层的本地记忆
 *      ③ Esri 历史影像的底部时相条
 *      ④ 2D 底图 → 3D Cesium ImageryProvider 的映射
 *
 * 本文件不含任何图层名、URL、token —— 全部来自 BASEMAP_CONFIG。
 * 唯一的硬编码是「兜底底图」：ArcGIS World_Imagery。配置为空 / 语法写坏 /
 * defaultBasemap 不存在 / 3D 找不到对应 provider 时都用它，保证地图不白屏。
 *
 * 加载时机：leaflet.js、esri-leaflet.js、geo-config.js 之后，且 index.html
 *          里 map 已创建（本模块直接用全局 window.map）。
 */
(function () {
  "use strict";

  var L = window.L;
  var map = window.map;
  if (!L || !map) {
    console.error("[basemap] window.map / L 未就绪，底图未初始化");
    return;
  }

  var cfg = window.BASEMAP_CONFIG || {};
  var token = (window.SITE_CONFIG && window.SITE_CONFIG.tiandituToken) || "";
  // 天地图 token 的全局出口：搜索 / 高程 / 3D 覆盖层都读它
  window.TDT_TK = token;

  // 统一存储层（geo-utils.js，index.html 第 16 行，早于本模块）
  var S = window.OGVStorage;

  // ==================================================================
  // 兜底底图（全项目唯一的硬编码图层）
  // ==================================================================
  var FALLBACK = {
    name: "ArcGIS-影像",
    tileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 19,
    maxZoom: 22,
  };
  var _fallbackLayer = null;
  function fallbackLayer() {
    if (!_fallbackLayer) {
      _fallbackLayer = L.tileLayer(FALLBACK.tileUrl, {
        maxNativeZoom: FALLBACK.maxNativeZoom,
        maxZoom: FALLBACK.maxZoom,
        crossOrigin: "anonymous",
      });
    }
    return _fallbackLayer;
  }
  function fallbackCesiumProvider() {
    var C = window.Cesium;
    if (!C) return null;
    return new C.UrlTemplateImageryProvider({
      url: FALLBACK.tileUrl,
      maximumLevel: FALLBACK.maxNativeZoom,
    });
  }

  var TIANDITU_TILE =
    "https://t0.tianditu.gov.cn/DataServer?T={service}&x={x}&y={y}&l={z}&tk={tk}";
  var ARCGIS_PREFIX = "https://server.arcgisonline.com/ArcGIS/rest/services/";

  // 常用选项简写（顶层字段）→ Leaflet options 键
  var OPT_SHORTCUTS = [
    "minZoom",
    "maxZoom",
    "minNativeZoom",
    "maxNativeZoom",
    "opacity",
    "pane",
  ];
  // 优先级：defaults < 简写字段 < attribution < 描述符的 options
  function leafletOptions(d, defaults) {
    var o = Object.assign({}, defaults || {});
    OPT_SHORTCUTS.forEach(function (k) {
      if (typeof d[k] !== "undefined") o[k] = d[k];
    });
    if (d.attribution) o.attribution = d.attribution;
    if (d.options) Object.assign(o, d.options);
    return o;
  }
  function tdtUrl(d) {
    return String(d.url || TIANDITU_TILE)
      .split("{service}")
      .join(d.service || "")
      .split("{tk}")
      .join(token);
  }

  // ==================================================================
  // 各 kind 的构建器：返回「零个或多个 Leaflet 图层」的数组
  // ==================================================================
  var BUILDERS = {
    // 天地图瓦片
    tianditu: function (d) {
      return [
        L.tileLayer(
          tdtUrl(d),
          leafletOptions(d, { crossOrigin: "anonymous" }),
        ),
      ];
    },

    // ArcGIS Online 瓦片（可带一个注记层；两者合成一个图层组）
    arcgis: function (d) {
      var out = [
        L.tileLayer(
          ARCGIS_PREFIX + d.serviceName + "/MapServer/tile/{z}/{y}/{x}",
          leafletOptions(d, { crossOrigin: "anonymous" }),
        ),
      ];
      if (d.labelServiceName) {
        var labelOpts = leafletOptions(d, { crossOrigin: "anonymous" });
        // 注记层不重复上报版权（同一底图只报一次）
        delete labelOpts.attribution;
        out.push(
          L.tileLayer(
            ARCGIS_PREFIX + d.labelServiceName + "/MapServer/tile/{z}/{y}/{x}",
            labelOpts,
          ),
        );
      }
      return out;
    },

    // 通用 WMS
    wms: function (d) {
      var defaults = {
        layers: d.layers,
        format: "image/png",
        transparent: true,
        version: "1.1.1",
        crossOrigin: "anonymous",
      };
      return [L.tileLayer.wms(d.url, leafletOptions(d, defaults))];
    },

    // 通用 XYZ 瓦片
    tile: function (d) {
      return [
        L.tileLayer(d.url, leafletOptions(d, { crossOrigin: "anonymous" })),
      ];
    },

    // 整幅影像底图：跨 180° 复制三份，实现无缝显示
    imageWorldCopy: function (d) {
      var b = d.bounds || [
        [-85.06, -180],
        [85.06, 180],
      ];
      var south = b[0][0],
        west = b[0][1],
        north = b[1][0],
        east = b[1][1];
      var opts = leafletOptions(d);
      return [
        L.imageOverlay(
          d.url,
          [
            [south, west - 360],
            [north, east - 360],
          ],
          opts,
        ),
        L.imageOverlay(
          d.url,
          [
            [south, west],
            [north, east],
          ],
          opts,
        ),
        L.imageOverlay(
          d.url,
          [
            [south, west + 360],
            [north, east + 360],
          ],
          opts,
        ),
      ];
    },

    // Esri Wayback 历史影像：瓦片路径里的 release 编号实时读 window.__waybackRelease，
    // 于是同一个图层实例就能切任意历史时相（时相条只负责改这个全局变量 + redraw）
    wayback: function (d) {
      var base = d.tileBase || "";
      var WB = L.TileLayer.extend({
        getTileUrl: function (coords) {
          return (
            base +
            (window.__waybackRelease || d.fallbackRelease) +
            "/" +
            coords.z +
            "/" +
            coords.y +
            "/" +
            coords.x
          );
        },
      });
      return [new WB(null, leafletOptions(d))];
    },

    // ArcGIS FeatureLayer（矢量，按视口按需拉取）
    esriFeature: function (d) {
      if (!L.esri || typeof L.esri.featureLayer !== "function") {
        console.warn("[basemap] esri-leaflet 未加载，跳过", d.name);
        return [];
      }
      var ly = L.esri.featureLayer({
        url: d.url,
        style: function () {
          return Object.assign({}, d.style || {});
        },
      });
      // 弹窗里的「缩放至 / 详情」由弹窗 DOM 上的委托监听处理，点击时从
      // popup._source.feature 现取要素。esri 的 _source 是它按视口动态生成的
      // 子图层（不是这个 featureLayer 本身），图层标签要趁渲染时顺手贴到子图层上，
      // 否则详情面板拿不到「UNEP-WCMC大陆」这类标题。
      // （不能用 layeradd 监听：esri 的内部 add 路径不一定经过 FeatureGroup.addLayer）
      var layerId = "esri_island_" + String(d.url).split("/").pop();
      ly.bindPopup(function (layer) {
        if (layer && layer !== ly) {
          if (!layer._ogvLayerId) layer._ogvLayerId = layerId;
          if (!layer._ogvLayerName) layer._ogvLayerName = d.name;
        }
        try {
          if (
            window.GeoUtils &&
            typeof window.GeoUtils.buildPopupContent === "function"
          ) {
            return window.GeoUtils.buildPopupContent(
              layer.feature,
              d.name,
              null,
              d.name,
            );
          }
        } catch (e) {}
        // 兜底弹窗：属性表
        var props = layer.feature && layer.feature.properties;
        if (!props) return "";
        var html =
          '<div class="geo-popup-content" style="font-size:13px;line-height:1.6;max-height:300px;overflow-y:auto;">';
        html +=
          '<div class="feature-popup-title" style="font-weight:bold;font-size:14px;margin-bottom:6px;border-bottom:1px solid #ddd;padding-bottom:4px;">' +
          d.name +
          "</div>";
        html += '<table style="width:100%;border-collapse:collapse;">';
        for (var k in props) {
          if (props[k] == null || props[k] === "") continue;
          html +=
            '<tr><td style="padding:2px 6px;color:#666;white-space:nowrap;vertical-align:top;">' +
            k +
            "</td>" +
            '<td style="padding:2px 6px;">' +
            props[k] +
            "</td></tr>";
        }
        html += "</table></div>";
        return html;
      });
      ly._ogvLayerId = layerId;
      ly._ogvLayerName = d.name;
      ly.on("load", function () {
        console.log("[island] ✅ " + d.name + " 加载完成");
      });
      ly.on("error", function (err) {
        console.error("[island] ❌ " + d.name + " 加载出错:", err);
      });
      try {
        if (d.options) ly.options = Object.assign(ly.options, d.options);
      } catch (e) {}
      return [ly];
    },
  };

  // ==================================================================
  // 构建实例
  // ==================================================================
  var _shared = {}; // 描述符 ref → 图层实例（多个底图共用同一个实例）

  function buildOne(d) {
    if (!d) return null;
    // 引用型条目（如 overlays 里的 { name, ref:"boundary" }）只需 name + ref，
    // 没有 kind —— 所以 ref 判断必须排在 kind 校验之前
    if (d.ref) return _shared[d.ref] || null;
    if (!d.name || !d.kind) return null;
    var fn = BUILDERS[d.kind];
    if (typeof fn !== "function") {
      console.warn("[basemap] 未知 kind：", d.name, d.kind);
      return null;
    }
    var parts = fn(d) || [];
    // 需要补国界的底图：把共享的境界层叠在自己上面
    if (d.attachBoundary && _shared.boundary && parts.indexOf(_shared.boundary) === -1) {
      parts.push(_shared.boundary);
    }
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : L.layerGroup(parts);
  }

  // 境界层必须先建：baseLayers 的 attachBoundary 与 overlays 的 ref 都要用它
  if (cfg.boundary) _shared.boundary = buildOne(cfg.boundary);

  var allBaseLayers = {};
  (cfg.baseLayers || []).forEach(function (d) {
    var l = buildOne(d);
    if (l) allBaseLayers[d.name] = l;
  });
  // 配置里没有兜底底图那一项时，把它补进清单，保证控件至少有得选
  if (!allBaseLayers[FALLBACK.name]) {
    allBaseLayers[FALLBACK.name] = fallbackLayer();
  }

  var allOverlays = {};
  (cfg.overlays || []).forEach(function (d) {
    var l = buildOne(d);
    if (l) allOverlays[d.name] = l;
  });

  var moreOverlays = {};
  (cfg.moreOverlays || []).forEach(function (d) {
    var l = buildOne(d);
    if (l) moreOverlays[d.name] = l;
  });

  var _baseCount = Object.keys(allBaseLayers).length;
  console.log(
    "[basemap] 底图 " +
      _baseCount +
      " 个 / 覆盖层 " +
      Object.keys(allOverlays).length +
      " 个 / 更多覆盖层 " +
      Object.keys(moreOverlays).length +
      " 个",
  );

  // ==================================================================
  // Esri 历史影像：默认时相
  // ==================================================================
  var wbDesc = null;
  (cfg.baseLayers || []).some(function (d) {
    if (d.kind === "wayback") {
      wbDesc = d;
      return true;
    }
    return false;
  });
  var waybackLayer = wbDesc ? allBaseLayers[wbDesc.name] || null : null;
  if (wbDesc && typeof window.__waybackRelease !== "number") {
    window.__waybackRelease = wbDesc.fallbackRelease || 56102;
  }

  // ==================================================================
  // 可见集合
  // ==================================================================
  function moreToggleOn() {
    var cb = document.getElementById("moreBasemapToggle");
    return !!(cb && cb.checked);
  }
  function getVisibleOverlays() {
    if (!moreToggleOn()) return allOverlays;
    var merged = {};
    Object.keys(allOverlays).forEach(function (k) {
      merged[k] = allOverlays[k];
    });
    Object.keys(moreOverlays).forEach(function (k) {
      merged[k] = moreOverlays[k];
    });
    return merged;
  }
  function getVisibleBaseLayers() {
    if (moreToggleOn()) return allBaseLayers;
    var subset = cfg.defaultSubset;
    if (!Array.isArray(subset) || !subset.length) return allBaseLayers;
    var out = {};
    // 顺序按 allBaseLayers（即 baseLayers 的书写顺序），只按 defaultSubset 过滤
    Object.keys(allBaseLayers).forEach(function (k) {
      if (subset.indexOf(k) !== -1) out[k] = allBaseLayers[k];
    });
    if (!Object.keys(out).length) return allBaseLayers;
    return out;
  }

  // ==================================================================
  // 当前底图（本地记忆）
  // ==================================================================
  var _currentBasemapName = null;
  (function resolveInitialBasemap() {
    if (cfg.defaultBasemap && allBaseLayers[cfg.defaultBasemap]) {
      _currentBasemapName = cfg.defaultBasemap;
    } else if (allBaseLayers[FALLBACK.name]) {
      _currentBasemapName = FALLBACK.name;
    } else {
      _currentBasemapName = Object.keys(allBaseLayers)[0] || null;
    }
    var saved = S.safeGet(S.KEY.BASEMAP);
    if (saved) {
      if (allBaseLayers[saved]) {
        _currentBasemapName = saved;
      } else {
        // 配置里已经没有这个底图（改名 / 删项）→ 清掉旧值，别让它永久复活
        S.safeRemove(S.KEY.BASEMAP);
      }
    }
    window._currentBasemapName = _currentBasemapName;
  })();

  // ==================================================================
  // 图层控件
  // ==================================================================
  // 「更多底图」收起时 rebuildLayerCtrl 会摘掉随之隐藏的覆盖层 —— 那是**被动移除**，
  // 不是用户取消勾选。挂起持久化，否则记忆被顺手清掉，下次打开「更多底图」全丢。
  var _suspendPersist = false;

  function rebuildLayerCtrl() {
    if (window._layerCtrlControl) {
      map.removeControl(window._layerCtrlControl);
      window._layerCtrlControl = null;
    }
    var visibleBase = getVisibleBaseLayers();
    var visibleOverlays = getVisibleOverlays();

    // 确保当前底图在图上（且只有它一张）
    var currentLayer = allBaseLayers[_currentBasemapName];
    if (currentLayer) {
      if (!map.hasLayer(currentLayer)) {
        Object.keys(allBaseLayers).forEach(function (k) {
          if (map.hasLayer(allBaseLayers[k])) map.removeLayer(allBaseLayers[k]);
        });
        map.addLayer(currentLayer);
      }
    } else {
      // 记忆里的底图名已不存在（配置改名 / 删项）→ 退回兜底
      var fb = allBaseLayers[FALLBACK.name] || fallbackLayer();
      map.addLayer(fb);
      if (allBaseLayers[FALLBACK.name]) {
        _currentBasemapName = FALLBACK.name;
        window._currentBasemapName = _currentBasemapName;
      }
    }

    // 恢复记忆里「当前可见」的覆盖层。
    // ⚠️ 必须放在 rebuild 里，不能只在模块初始化时做一次：本模块比 app.js 先加载，
    //    此时 #moreBasemapToggle 还没被 app.js 设成记忆值 → visibleOverlays 里没有
    //    moreOverlays → 第一次 rebuild 会把它们摘掉。等 app.js 的 layerCtrlToggle
    //    .enable() 再调一次 rebuild 时它们才可见 —— 那一轮才补得回来。
    savedOverlayNames.forEach(function (name) {
      var l = visibleOverlays[name];
      if (l && !map.hasLayer(l)) map.addLayer(l);
    });

    window._layerCtrlControl = L.control
      .layers(visibleBase, visibleOverlays, {
        position: "bottomright",
        collapsed: true,
        autoZIndex: true,
      })
      .addTo(map);

    // 收起「更多底图」时，把随之隐藏的覆盖层摘掉（被动 → 不写盘）
    _suspendPersist = true;
    Object.keys(moreOverlays).forEach(function (k) {
      if (!visibleOverlays[k] && map.hasLayer(moreOverlays[k])) {
        map.removeLayer(moreOverlays[k]);
      }
    });
    _suspendPersist = false;
  }

  window.rebuildLayerCtrl = rebuildLayerCtrl;

  // ==================================================================
  // 覆盖层 / 底图 本地记忆
  // ==================================================================
  var allOverlaysLookup = {};
  Object.keys(allOverlays).forEach(function (k) {
    allOverlaysLookup[k] = allOverlays[k];
  });
  Object.keys(moreOverlays).forEach(function (k) {
    allOverlaysLookup[k] = moreOverlays[k];
  });

  // 读坏值（JSON 解析失败）时 OGVStorage 会顺手删键 —— 否则后面每次 setJSON
  // 都还是失败，覆盖层记忆就整类静默失效了（旧代码把异常吞在 catch 里）
  // savedOverlayNames 是覆盖层记忆的唯一真源：persistOverlay 同步维护它并落盘
  var savedOverlayNames = S.getJSON(S.KEY.OVERLAYS, []);
  if (!Array.isArray(savedOverlayNames)) savedOverlayNames = [];
  // 配置里已不存在的覆盖层名 → 一并过滤写回，避免复活不了还占着坑
  var validSaved = savedOverlayNames.filter(function (n) {
    return !!allOverlaysLookup[n];
  });
  if (validSaved.length !== savedOverlayNames.length) {
    savedOverlayNames = validSaved;
    S.setJSON(S.KEY.OVERLAYS, savedOverlayNames);
  }

  rebuildLayerCtrl();

  map.on("baselayerchange", function (e) {
    _currentBasemapName = e.name;
    window._currentBasemapName = e.name;
    S.safeSet(S.KEY.BASEMAP, e.name);
    if (window.CesiumViewer && window.CesiumViewer.isActive) {
      window.CesiumViewer.syncBasemap();
    }
  });

  function persistOverlay(name, add) {
    if (_suspendPersist) return; // 被动移除（收起「更多底图」）不算用户取消勾选
    var idx = savedOverlayNames.indexOf(name);
    if (add && idx !== -1) return; // 已在记忆里
    if (!add && idx === -1) return; // 本来就不在记忆里
    if (add) savedOverlayNames.push(name);
    else savedOverlayNames.splice(idx, 1);
    S.setJSON(S.KEY.OVERLAYS, savedOverlayNames);
  }
  map.on("overlayadd", function (e) {
    persistOverlay(e.name, true);
    if (window.CesiumViewer && window.CesiumViewer.isActive) {
      window.CesiumViewer.syncOverlays();
    }
  });
  map.on("overlayremove", function (e) {
    persistOverlay(e.name, false);
    if (window.CesiumViewer && window.CesiumViewer.isActive) {
      window.CesiumViewer.syncOverlays();
    }
  });

  // 供 Cesium 3D 叠加「当前勾选的覆盖层」
  window.getCheckedOverlays = function () {
    var result = [];
    [allOverlays, moreOverlays].forEach(function (group) {
      Object.keys(group).forEach(function (k) {
        if (map.hasLayer(group[k])) result.push(k);
      });
    });
    return result;
  };

  // ==================================================================
  // Esri 历史影像——底部时相条
  // ==================================================================
  (function initWaybackBar() {
    var barEl = document.getElementById("waybackBar");
    var sel = document.getElementById("wbSelect");
    if (!barEl || !sel || !waybackLayer || !wbDesc) return;

    function showBar() {
      barEl.classList.remove("wb-hidden");
    }
    function hideBar() {
      barEl.classList.add("wb-hidden");
    }

    // 切换时相：只改 release 编号并重绘，底图开关仍归图层控件管
    function setRelease(releaseNum) {
      var n = Number(releaseNum);
      if (!isFinite(n)) return; // NaN 会让瓦片 URL 拼出 "/NaN/"，整张底图白屏
      window.__waybackRelease = n;
      S.safeSet(S.KEY.WAYBACK_RELEASE, String(n));
      if (map.hasLayer(waybackLayer)) waybackLayer.redraw();
      if (window.CesiumViewer && window.CesiumViewer.isActive) {
        window.CesiumViewer.syncBasemap();
      }
    }

    // 解析 Esri 官方配置：{ "26334": { itemTitle: "World Imagery (Wayback 2026-08-05)" } }
    function parseConfig(obj) {
      var list = [];
      for (var k in obj) {
        var it = obj[k];
        var m = (it && (it.itemTitle || "")).match(
          /Wayback\s+(\d{4}-\d{2}-\d{2})/,
        );
        if (!m) continue;
        list.push({ releaseNum: Number(k), date: m[1] });
      }
      list.sort(function (a, b) {
        return a.date < b.date ? -1 : 1;
      });
      return list;
    }

    // 下拉：日期降序（最新在上），并让记住的时相保持选中
    function populateSelect() {
      if (!releases.length) return;
      var sorted = releases.slice().sort(function (a, b) {
        return a.date < b.date ? 1 : -1;
      });
      var frag = document.createDocumentFragment();
      sorted.forEach(function (r) {
        var o = document.createElement("option");
        o.value = String(r.releaseNum);
        o.textContent = r.date;
        frag.appendChild(o);
      });
      sel.innerHTML = "";
      sel.appendChild(frag);
      var cur = releasesById[window.__waybackRelease]
        ? window.__waybackRelease
        : Number(sorted[0].releaseNum);
      window.__waybackRelease = cur;
      sel.value = String(cur);
    }

    function applyList(list) {
      releases = list || [];
      releasesById = {};
      releases.forEach(function (r) {
        releasesById[r.releaseNum] = r;
      });
      populateSelect();
      if (map.hasLayer(waybackLayer)) waybackLayer.redraw();
    }

    sel.addEventListener("change", function () {
      var n = Number(sel.value);
      if (n) setRelease(n);
    });

    // 图层控件切底图：选中历史影像才显示时间条，切走即隐藏
    map.on("baselayerchange", function (e) {
      if (e.layer === waybackLayer) showBar();
      else hideBar();
    });

    // 恢复上次选择的时相（须在 populateSelect 之前）
    var savedRelease = S.getNum(S.KEY.WAYBACK_RELEASE, NaN);
    if (isFinite(savedRelease)) window.__waybackRelease = savedRelease;

    // 优先官方实时列表，失败回退到随包内置的静态列表
    if (wbDesc.configUrl) {
      fetch(wbDesc.configUrl)
        .then(function (res) {
          return res.ok ? res.json() : Promise.reject();
        })
        .then(function (obj) {
          applyList(parseConfig(obj));
        })
        .catch(function () {
          fetch("./assets/wayback-releases.json")
            .then(function (res) {
              return res.ok ? res.json() : Promise.reject();
            })
            .then(function (data) {
              applyList(data.releases || []);
            })
            .catch(function () {});
        });
    } else {
      fetch("./assets/wayback-releases.json")
        .then(function (res) {
          return res.ok ? res.json() : Promise.reject();
        })
        .then(function (data) {
          applyList(data.releases || []);
        })
        .catch(function () {});
    }

    // 初始显隐：恢复记忆后若底图就是历史影像，则显示时间条
    if (map.hasLayer(waybackLayer)) showBar();
    else hideBar();
  })();

  // ==================================================================
  // 3D（Cesium）映射：同一份配置，不再另抄一份 switch
  // ==================================================================
  // 天地图官方支持 t0~t7 八个 CDN 子域。Cesium RequestScheduler 的 per-server
  // 并发上限默认 6；单域时所有请求挤一台服务器，既慢又容易被 429。走八子域后
  // 等效并发 8×6=48，实测地球就绪 34.4s → 6.8s。
  var TDT_SUBDOMAINS = ["0", "1", "2", "3", "4", "5", "6", "7"];
  function createTdtProvider(svc, maximumLevel) {
    return new window.Cesium.UrlTemplateImageryProvider({
      url:
        "https://t{s}.tianditu.gov.cn/DataServer?T=" +
        svc +
        "&x={x}&y={y}&l={z}&tk=" +
        token,
      subdomains: TDT_SUBDOMAINS,
      maximumLevel: maximumLevel || 18,
    });
  }

  function findDescriptor(name, groups) {
    var found = null;
    for (var i = 0; i < groups.length && !found; i++) {
      var list = groups[i] || [];
      for (var j = 0; j < list.length; j++) {
        if (list[j] && list[j].name === name) {
          found = list[j];
          break;
        }
      }
    }
    if (!found) return null;
    // 引用型条目（如「天地图全球境界」= { ref:"boundary" }）本身不带 cesium 描述，
    // 要顺着 ref 取被引用那份（cfg.boundary 才是真正的图层定义）
    if (found.ref && !found.cesium && cfg[found.ref]) return cfg[found.ref];
    return found;
  }

  /**
   * 把 2D 当前底图名 → Cesium ImageryProvider。
   * 找不到配置 / 配置里没写 cesium → 回退内置的 ArcGIS 影像兜底。
   */
  function createImageryProvider(basemapName) {
    if (!window.Cesium) return null;
    var d = findDescriptor(basemapName, [cfg.baseLayers]);
    var c = d && d.cesium;
    if (c && c.kind) {
      try {
        switch (c.kind) {
          case "tianditu":
            return createTdtProvider(c.service, c.maximumLevel);
          case "urlTemplate":
            return new window.Cesium.UrlTemplateImageryProvider({
              url: c.url,
              maximumLevel: c.maximumLevel,
            });
          case "wms":
            return new window.Cesium.WebMapServiceImageryProvider({
              url: c.url,
              layers: c.layers,
              parameters: { transparent: true, format: "image/png" },
              maximumLevel: c.maximumLevel,
            });
          case "osm":
            return new window.Cesium.OpenStreetMapImageryProvider({
              url: c.url,
              maximumLevel: c.maximumLevel,
            });
          case "wayback":
            return new window.Cesium.UrlTemplateImageryProvider({
              url:
                (wbDesc && wbDesc.tileBase
                  ? wbDesc.tileBase
                  : "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/") +
                (window.__waybackRelease || (wbDesc && wbDesc.fallbackRelease) || 56102) +
                "/{z}/{y}/{x}",
              maximumLevel: c.maximumLevel,
            });
        }
      } catch (e) {
        console.warn("[basemap] 3D 底图构建失败，回退兜底：", basemapName, e);
      }
    }
    return fallbackCesiumProvider();
  }

  /**
   * 覆盖层名 → Cesium ImageryProvider（目前只有天地图瓦片类覆盖层需要 3D 叠加）。
   * 返回 null 表示该覆盖层在 3D 里没有对应物（如 Esri FeatureLayer）。
   */
  function createOverlayImageryProvider(name) {
    if (!window.Cesium) return null;
    var d = findDescriptor(name, [cfg.overlays, cfg.moreOverlays]);
    var c = d && d.cesium;
    if (!c || c.kind !== "tianditu") return null;
    try {
      return createTdtProvider(c.service, c.maximumLevel);
    } catch (e) {
      return null;
    }
  }

  window.BasemapManager = {
    config: cfg,
    fallbackName: FALLBACK.name,
    baseLayers: allBaseLayers,
    overlays: allOverlays,
    moreOverlays: moreOverlays,
    waybackLayer: waybackLayer,
    waybackDescriptor: wbDesc,
    rebuild: rebuildLayerCtrl,
    getVisibleBaseLayers: getVisibleBaseLayers,
    getVisibleOverlays: getVisibleOverlays,
    createImageryProvider: createImageryProvider,
    createOverlayImageryProvider: createOverlayImageryProvider,
  };
})();
