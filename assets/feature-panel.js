/**
 * feature-panel.js
 * 要素详情面板：属性表 + ECharts 图表
 * 两种入口：
 *   1. 单要素模式 — 从 Popup "查看详情" 按钮进入（全部字段滚动查看，不分页）
 *   2. 图层模式 — 从设置弹窗 / 图层面板 📋 按钮进入（要素翻页 + 搜索）
 */
(function () {
  "use strict";

  var map = window.map;
  if (!map) {
    console.warn("[FeaturePanel] map 未就绪，延迟初始化");
    return;
  }

  // ========== 常量 ==========
  var PAGE_SIZE = 20; // 图层模式每页要素数
  var ECHARTS_LOADED = false;
  var ECHARTS_LOADING = false;
  var ECHARTS_CDN = "./assets/echarts.min.js";
  var STORAGE_KEY = "ogv_feature_panel_width";
  var MIN_WIDTH = 320;
  var MAX_WIDTH_PCT = 0.8;
  // 默认宽度：至少 480px 或视口 50%
  var DEFAULT_WIDTH = Math.max(480, Math.floor(window.innerWidth * 0.5));

  // 面板状态
  var panelState = {
    open: false,
    mode: "single",
    feature: null,
    layerId: null,
    layerName: null,
    allFeatures: null,
    currentPage: 1,
    totalPages: 1,
    filteredFields: null,
    searchQuery: "",
    chartInstance: null,
    chartType: "bar",
    chartXField: "",
    chartYField: "",
    chartGroupField: "",
    showLegend: true,
    showCompare: false,
    layerStats: null,
  };

  // 面板宽度（持久化）
  var panelWidth = DEFAULT_WIDTH;
  var resizeState = null; // { startX, startWidth }

  function _loadPanelWidth() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var v = parseInt(saved, 10);
        if (v >= MIN_WIDTH && v <= window.innerWidth * MAX_WIDTH_PCT) {
          panelWidth = v;
        }
      }
    } catch (e) {}
  }
  function _savePanelWidth() {
    try {
      localStorage.setItem(STORAGE_KEY, String(panelWidth));
    } catch (e) {}
  }

  _loadPanelWidth();

  // ========== DOM 引用 ==========
  var dom = {};

  function ensureDOM() {
    if (dom.panel) return true;
    dom.panel = document.getElementById("featureDetailPanel");
    if (!dom.panel) return false;
    dom.backdrop = document.getElementById("featurePanelBackdrop");
    dom.resizeHandle = document.getElementById("featurePanelResizeHandle");
    dom.titleEl = document.getElementById("featurePanelTitle");
    dom.subtitleEl = document.getElementById("featurePanelSubtitle");
    dom.tabAttr = document.getElementById("featurePanelTabAttr");
    dom.tabChart = document.getElementById("featurePanelTabChart");
    dom.contentAttr = document.getElementById("featurePanelContentAttr");
    dom.contentChart = document.getElementById("featurePanelContentChart");
    dom.modeSwitch = document.getElementById("featurePanelModeSwitch");
    dom.modeSingle = document.getElementById("featurePanelModeSingle");
    dom.modeLayer = document.getElementById("featurePanelModeLayer");
    dom.searchInput = document.getElementById("featurePanelSearchInput");
    dom.resultCount = document.getElementById("featurePanelResultCount");
    dom.tableWrap = document.getElementById("featurePanelTableWrap");
    dom.table = document.getElementById("featurePanelTable");
    dom.pager = document.getElementById("featurePanelPager");
    dom.pageInfo = document.getElementById("featurePanelPageInfo");
    dom.pageInput = document.getElementById("featurePanelPageInput");
    dom.chartType = document.getElementById("featurePanelChartType");
    dom.chartX = document.getElementById("featurePanelChartX");
    dom.chartY = document.getElementById("featurePanelChartY");
    dom.chartGroup = document.getElementById("featurePanelChartGroup");
    dom.chartShowLegend = document.getElementById("featurePanelChartShowLegend");
    dom.chartCompare = document.getElementById("featurePanelChartCompare");
    dom.chartContainer = document.getElementById("featurePanelChartContainer");
    dom.chartLegend = document.getElementById("featurePanelChartLegend");
    dom.emptyAttr = document.getElementById("featurePanelEmptyAttr");
    dom.emptyChart = document.getElementById("featurePanelEmptyChart");
    dom.closeBtn = document.getElementById("featurePanelClose");
    // 应用已保存宽度
    _applyPanelWidth();
    return true;
  }

  function _applyPanelWidth() {
    if (!dom.panel) return;
    dom.panel.style.width = panelWidth + "px";
  }

  // ========== 公开 API ==========

  function openSingleFeature(feature, layerId, layerName) {
    if (!ensureDOM()) return;
    panelState.mode = "single";
    panelState.feature = feature;
    panelState.layerId = layerId || null;
    panelState.layerName = layerName || "";
    panelState.allFeatures = null;
    panelState.currentPage = 1;
    panelState.searchQuery = "";
    panelState.chartInstance = null;
    panelState.showCompare = false;
    panelState.layerStats = null;

    _updateUI();
    _open();
    _activateTab("attr");
    _renderAttrTable();
  }

  function openLayerTable(layerId, layerName, features) {
    if (!ensureDOM()) return;
    var feats = features;
    if (!feats || !feats.length) {
      if (window._featureCache && window._featureCache[layerId]) {
        feats = window._featureCache[layerId];
      }
    }
    if (!feats || !feats.length) {
      if (typeof window.showToast === "function") {
        window.showToast("该图层没有要素数据或尚未加载", { duration: 3000 });
      }
      return;
    }

    panelState.mode = "layer";
    panelState.feature = null;
    panelState.layerId = layerId;
    panelState.layerName = layerName || "";
    panelState.allFeatures = feats;
    panelState.currentPage = 1;
    panelState.searchQuery = "";
    panelState.chartInstance = null;
    panelState.showCompare = false;
    panelState.layerStats = null;

    _updateUI();
    _open();
    _activateTab("attr");
    _renderAttrTable();
  }

  function closePanel() {
    if (!dom.panel) return;
    dom.panel.classList.remove("open");
    if (dom.backdrop) dom.backdrop.classList.remove("open");
    panelState.open = false;
    if (panelState.chartInstance) {
      try {
        panelState.chartInstance.dispose();
      } catch (e) {}
      panelState.chartInstance = null;
    }
  }

  // ========== 内部逻辑 ==========

  function _open() {
    dom.panel.classList.add("open");
    if (dom.backdrop) dom.backdrop.classList.add("open");
    panelState.open = true;
  }

  function _updateUI() {
    if (panelState.mode === "single" && panelState.feature) {
      var title = _getFeatureTitle(panelState.feature) || "要素详情";
      dom.titleEl.textContent = title;
      dom.subtitleEl.textContent = panelState.layerName || "";
    } else {
      dom.titleEl.textContent = "属性表";
      dom.subtitleEl.textContent =
        (panelState.layerName || "") +
        " (" +
        (panelState.allFeatures ? panelState.allFeatures.length : 0) +
        " 个要素)";
    }

    if (dom.modeSwitch) {
      dom.modeSwitch.style.display =
        panelState.mode === "layer" || panelState.allFeatures ? "" : "none";
    }
    if (dom.modeSingle) {
      dom.modeSingle.classList.toggle("active", panelState.mode === "single");
    }
    if (dom.modeLayer) {
      dom.modeLayer.classList.toggle("active", panelState.mode === "layer");
      dom.modeLayer.style.display = panelState.allFeatures ? "" : "none";
    }

    if (dom.searchInput) {
      dom.searchInput.value = panelState.searchQuery;
    }
  }

  function _getFeatureTitle(feature) {
    if (!feature || !feature.properties) return null;
    var props = feature.properties;
    var titleKeys = [
      "name",
      "Name",
      "NAME",
      "title",
      "Title",
      "Fullname",
      "Hole",
      "site",
      "Contractor",
    ];
    for (var i = 0; i < titleKeys.length; i++) {
      if (props[titleKeys[i]] != null && props[titleKeys[i]] !== "") {
        return String(props[titleKeys[i]]);
      }
    }
    return null;
  }

  function _activateTab(tab) {
    if (!dom.tabAttr || !dom.tabChart) return;
    if (tab === "attr") {
      dom.tabAttr.classList.add("active");
      dom.tabChart.classList.remove("active");
      dom.contentAttr.style.display = "flex";
      dom.contentChart.style.display = "none";
    } else {
      dom.tabChart.classList.add("active");
      dom.tabAttr.classList.remove("active");
      dom.contentChart.style.display = "flex";
      dom.contentAttr.style.display = "none";
      _loadEChartsAndRender();
    }
  }

  // ========== 属性表渲染 ==========

  function _renderAttrTable() {
    if (panelState.mode === "single") {
      _renderSingleFeatureTable();
    } else {
      _renderLayerFeatureTable();
    }
  }

  // 单要素模式：全部字段、直接滚动、不分页
  function _renderSingleFeatureTable() {
    var feat = panelState.feature;
    if (!feat || !feat.properties) {
      _showEmpty("attr");
      return;
    }

    var props = feat.properties;
    var allKeys = Object.keys(props).filter(function (k) {
      return props[k] !== undefined && props[k] !== null && props[k] !== "";
    });

    var q = panelState.searchQuery.toLowerCase().trim();
    var displayKeys = allKeys;
    if (q) {
      displayKeys = allKeys.filter(function (k) {
        return (
          k.toLowerCase().includes(q) ||
          String(props[k]).toLowerCase().includes(q)
        );
      });
    }
    if (displayKeys.length === 0) {
      _showEmpty("attr", q ? "没有匹配的属性" : "没有可显示的属性");
      return;
    }

    // 不分页，全部渲染
    var thead =
      '<thead><tr><th class="col-key">属性名</th><th class="col-val">属性值</th></tr></thead>';
    var tbody = "<tbody>";
    for (var i = 0; i < displayKeys.length; i++) {
      var k = displayKeys[i];
      var v = props[k];
      var valHtml = _formatValue(v);
      var valClass = typeof v === "number" ? "col-val num" : "col-val";
      tbody += '<tr><td class="col-key">' + _escapeHtml(k) + "</td>";
      tbody +=
        '<td class="' +
        valClass +
        '">' +
        valHtml +
        '<button class="copy-val-btn" title="复制" data-val="' +
        _escapeAttr(String(v)) +
        '">📋</button></td></tr>';
    }
    tbody += "</tbody>";

    dom.table.className = "feature-panel-table cols-2";
    dom.table.innerHTML = thead + tbody;
    _bindCopyButtons();

    // 单要素模式：隐藏翻页器
    if (dom.pager) dom.pager.style.display = "none";
    _showTable(displayKeys.length);
  }

  // 图层模式：多行翻页表格
  function _renderLayerFeatureTable() {
    var feats = panelState.allFeatures;
    if (!feats || !feats.length) {
      _showEmpty("attr", "该图层没有要素数据");
      return;
    }

    var firstFeat = feats[0];
    if (!firstFeat || !firstFeat.properties) {
      _showEmpty("attr", "要素没有属性数据");
      return;
    }
    var allKeys = Object.keys(firstFeat.properties).filter(function (k) {
      return k !== "_featureIndex";
    });

    var q = panelState.searchQuery.toLowerCase().trim();
    var displayFeats = feats;
    if (q) {
      displayFeats = feats.filter(function (f) {
        if (!f || !f.properties) return false;
        for (var j = 0; j < allKeys.length; j++) {
          var val = f.properties[allKeys[j]];
          if (val != null && String(val).toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    if (displayFeats.length === 0) {
      _showEmpty("attr", q ? "没有匹配的要素" : "没有要素数据");
      return;
    }

    panelState.filteredFields = displayFeats;
    panelState.totalPages = Math.ceil(displayFeats.length / PAGE_SIZE);
    if (panelState.currentPage > panelState.totalPages) {
      panelState.currentPage = panelState.totalPages;
    }

    var start = (panelState.currentPage - 1) * PAGE_SIZE;
    var pageFeats = displayFeats.slice(start, start + PAGE_SIZE);

    // 多列表格，第一列为缩放按钮
    var thead = "<thead><tr><th class='col-zoom'></th>";
    for (var k = 0; k < allKeys.length; k++) {
      thead += "<th>" + _escapeHtml(allKeys[k]) + "</th>";
    }
    thead += "</tr></thead>";

    var tbody = "<tbody>";
    for (var fi = 0; fi < pageFeats.length; fi++) {
      var f = pageFeats[fi];
      var fprops = f.properties || {};
      var featIdx = start + fi; // 在 allFeatures 中的全局索引
      tbody += '<tr data-feat-idx="' + featIdx + '">';
      tbody +=
        '<td class="col-zoom"><button class="zoom-to-feat-btn" title="隔离图层并定位到该要素">🔍</button></td>';
      for (var kj = 0; kj < allKeys.length; kj++) {
        var key = allKeys[kj];
        var val = fprops[key];
        tbody += "<td>" + _formatValue(val) + "</td>";
      }
      tbody += "</tr>";
    }
    tbody += "</tbody>";

    dom.table.className = "feature-panel-table cols-multi";
    dom.table.innerHTML = thead + tbody;

    // 绑定缩放按钮事件
    _bindZoomButtons();

    if (dom.resultCount) {
      dom.resultCount.textContent =
        displayFeats.length !== feats.length
          ? "筛选 " + displayFeats.length + " / " + feats.length + " 个要素"
          : "共 " + feats.length + " 个要素";
    }

    _updatePager();
    _showTable();
  }

  function _formatValue(val) {
    if (val === undefined || val === null)
      return '<span style="color:var(--text-dim)">—</span>';
    if (typeof val === "number") {
      if (!isFinite(val)) return String(val);
      return Number.isInteger(val) ? String(val) : val.toFixed(4);
    }
    if (typeof val === "object") {
      try {
        return JSON.stringify(val);
      } catch (e) {
        return String(val);
      }
    }
    var s = String(val);
    if (/^https?:\/\/\S+$/i.test(s)) {
      return (
        '<a href="' +
        _escapeAttr(s) +
        '" target="_blank" rel="noopener">' +
        _escapeHtml(s) +
        "</a>"
      );
    }
    return _escapeHtml(s);
  }

  function _escapeHtml(str) {
    var s = String(str);
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function _escapeAttr(str) {
    return String(str).replace(/"/g, "&quot;");
  }

  function _bindCopyButtons() {
    var btns = dom.table.querySelectorAll(".copy-val-btn");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var val = btn.dataset.val || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(val)
            .then(function () {
              _onCopySuccess(btn);
            })
            .catch(function () {
              _fallbackCopy(val, btn);
            });
        } else {
          _fallbackCopy(val, btn);
        }
      });
    });
  }

  function _onCopySuccess(btn) {
    btn.textContent = "✓";
    btn.classList.add("copied");
    setTimeout(function () {
      btn.textContent = "📋";
      btn.classList.remove("copied");
    }, 1500);
  }

  function _fallbackCopy(text, btn) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
    if (btn) _onCopySuccess(btn);
  }

  function _updatePager() {
    if (!dom.pager || !dom.pageInfo) return;
    var total = panelState.totalPages;
    var curr = panelState.currentPage;

    if (total <= 1) {
      dom.pager.style.display = "none";
      return;
    }
    dom.pager.style.display = "";

    dom.pageInfo.textContent = "第 " + curr + " 页 / 共 " + total + " 页";
    if (dom.pageInput) dom.pageInput.value = curr;

    var prevBtn = dom.pager.querySelector(".pager-prev");
    var nextBtn = dom.pager.querySelector(".pager-next");
    if (prevBtn) prevBtn.disabled = curr <= 1;
    if (nextBtn) nextBtn.disabled = curr >= total;
  }

  function _showEmpty(section, msg) {
    var el = section === "attr" ? dom.emptyAttr : dom.emptyChart;
    var wrap = section === "attr" ? dom.tableWrap : dom.chartContainer;
    if (el) el.style.display = "flex";
    if (wrap) wrap.style.display = "none";
    if (el) {
      var textEl = el.querySelector(".empty-text");
      if (textEl) textEl.textContent = msg || "暂无数据";
    }
    if (dom.pager) dom.pager.style.display = "none";
    if (dom.resultCount) dom.resultCount.textContent = "";
  }

  function _showTable(count) {
    if (dom.emptyAttr) dom.emptyAttr.style.display = "none";
    if (dom.tableWrap) dom.tableWrap.style.display = "";
    if (dom.resultCount && count != null) {
      dom.resultCount.textContent = "共 " + count + " 项";
    }
  }

  // ========== 翻页（仅图层模式） ==========

  function goToPage(page) {
    var total = panelState.totalPages;
    if (page < 1) page = 1;
    if (page > total) page = total;
    if (page === panelState.currentPage) return;
    panelState.currentPage = page;
    _renderAttrTable();
    if (dom.tableWrap) dom.tableWrap.scrollTop = 0;
  }

  // ========== 面板宽度 resize ==========

  function _startResize(e) {
    if (!dom.resizeHandle) return;
    resizeState = {
      startX: e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX),
      startWidth: panelWidth,
    };
    dom.resizeHandle.classList.add("active");
    e.preventDefault();
  }

  function _moveResize(e) {
    if (!resizeState) return;
    var clientX =
      e.clientX || (e.touches && e.touches[0] && e.touches[0].clientX);
    if (!clientX) return;
    // 向右拖 = 增大面板宽度（clientX 增大），向左拖 = 减小面板宽度
    // 面板在右侧，所以拖拽方向对应宽度变化：鼠标右移 = left 边左移 = 宽度增大
    var deltaX = resizeState.startX - clientX; // 左移为正
    var newWidth = resizeState.startWidth + deltaX;
    var maxW = Math.floor(window.innerWidth * MAX_WIDTH_PCT);
    if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
    if (newWidth > maxW) newWidth = maxW;
    panelWidth = newWidth;
    _applyPanelWidth();
  }

  function _endResize() {
    if (!resizeState) return;
    if (dom.resizeHandle) dom.resizeHandle.classList.remove("active");
    resizeState = null;
    _savePanelWidth();
    // 重绘图表
    if (panelState.chartInstance) {
      try {
        panelState.chartInstance.resize();
      } catch (e) {}
    }
  }

  // ========== 要素中心坐标提取 ==========
  function _extractFeatureCenter(feature) {
    if (!feature || !feature.geometry) return null;
    var geom = feature.geometry;
    var type = (geom.type || "").toLowerCase();
    var coords = geom.coordinates;

    try {
      if (type === "point") {
        return [coords[1], coords[0]]; // [lat, lng]
      }
      if (type === "multipoint" && Array.isArray(coords) && coords.length > 0) {
        return [coords[0][1], coords[0][0]];
      }
      if (type === "linestring" && Array.isArray(coords) && coords.length > 0) {
        var mid = Math.floor(coords.length / 2);
        return [coords[mid][1], coords[mid][0]];
      }
      if (type === "polygon" && Array.isArray(coords) && coords.length > 0) {
        var ring = coords[0];
        var lat = 0,
          lng = 0;
        for (var i = 0; i < ring.length; i++) {
          lng += ring[i][0];
          lat += ring[i][1];
        }
        return [lat / ring.length, lng / ring.length];
      }
      if (
        type === "multilinestring" &&
        Array.isArray(coords) &&
        coords.length > 0
      ) {
        var first = coords[0];
        if (first && first.length > 0) {
          var m = Math.floor(first.length / 2);
          return [first[m][1], first[m][0]];
        }
      }
      if (
        type === "multipolygon" &&
        Array.isArray(coords) &&
        coords.length > 0
      ) {
        var ring0 = coords[0] && coords[0][0];
        if (ring0 && ring0.length > 0) {
          var la = 0,
            lo = 0;
          for (var j = 0; j < ring0.length; j++) {
            lo += ring0[j][0];
            la += ring0[j][1];
          }
          return [la / ring0.length, lo / ring0.length];
        }
      }
    } catch (e) {}
    return null;
  }

  function _bindZoomButtons() {
    var btns = dom.table.querySelectorAll(".zoom-to-feat-btn");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var row = btn.closest("tr");
        if (!row) return;
        var featIdx = parseInt(row.dataset.featIdx, 10);
        if (isNaN(featIdx)) return;
        var feat = panelState.allFeatures[featIdx];
        if (!feat) return;

        // 先关闭面板
        closePanel();

        // 复用搜索结果的隔离+定位逻辑：
        // - 如果优化搜索开启：关闭所有图层，创建临时单要素图层高亮显示
        // - 基于要素真实坐标 zoom 定位
        // - 用户移动地图自动恢复
        if (typeof window.__OGV_highlight === "function") {
          window.__OGV_highlight(panelState.layerId, feat);
        } else if (window.map && feat.geometry) {
          // 降级：直接 zoom 到要素坐标
          var center = _extractFeatureCenter(feat);
          if (center) {
            window.map.setView(center, Math.max(window.map.getZoom(), 10), {
              animate: true,
            });
          }
        }
      });
    });
  }

  // ========== ECharts（字段选择器增强版） ==========

  function _loadEChartsAndRender() {
    if (ECHARTS_LOADED) { _renderChart(); return; }
    if (ECHARTS_LOADING) return;
    ECHARTS_LOADING = true;
    var script = document.createElement("script");
    script.src = ECHARTS_CDN;
    script.onload = function () { ECHARTS_LOADED = true; ECHARTS_LOADING = false; _renderChart(); };
    script.onerror = function () {
      ECHARTS_LOADING = false;
      if (dom.emptyChart) { dom.emptyChart.style.display = "flex"; dom.emptyChart.querySelector(".empty-text").textContent = "ECharts 加载失败"; }
      if (dom.chartContainer) dom.chartContainer.style.display = "none";
    };
    document.head.appendChild(script);
  }

  function _getAvailableFields() {
    var numeric = [], categorical = [], seen = {};
    if (panelState.mode === "single" && panelState.feature && panelState.feature.properties) {
      var props = panelState.feature.properties;
      for (var k in props) { if (k === "_featureIndex") continue; var v = props[k]; if (typeof v === "number" && isFinite(v)) numeric.push(k); else if (v != null && v !== "") categorical.push(k); }
    } else if (panelState.allFeatures && panelState.allFeatures.length > 0) {
      for (var fi = 0; fi < panelState.allFeatures.length; fi++) {
        var f = panelState.allFeatures[fi]; if (!f || !f.properties) continue;
        for (var k2 in f.properties) { if (k2 === "_featureIndex" || seen[k2]) continue; seen[k2] = true; var v2 = f.properties[k2]; if (typeof v2 === "number" && isFinite(v2)) numeric.push(k2); else if (v2 != null && v2 !== "") categorical.push(k2); }
        if (numeric.length > 50 && categorical.length > 20) break;
      }
    }
    numeric.sort(); categorical.sort();
    return { numeric: numeric, categorical: categorical };
  }

  function _populateFieldSelectors() {
    if (!dom.chartX || !dom.chartY) return;
    var fields = _getAvailableFields(), curX = dom.chartX.value || panelState.chartXField || "", curY = dom.chartY.value || panelState.chartYField || "", curG = panelState.chartGroupField || "", ct = panelState.chartType;
    var xFields = [], yFields = [], gFields = [];
    if (ct === "scatter") { xFields = fields.numeric; yFields = fields.numeric; gFields = fields.categorical; }
    else if (ct === "histogram") { xFields = fields.numeric; }
    else if (ct === "bar") { xFields = fields.numeric.concat(fields.categorical); gFields = fields.categorical; }
    else if (ct === "pie") { xFields = fields.categorical.length ? fields.categorical : fields.numeric; }
    _fillSelect(dom.chartX, xFields, curX);
    _fillSelect(dom.chartY, yFields, curY);
    if (dom.chartGroup) _fillSelect(dom.chartGroup, gFields, curG);
    if (!dom.chartX.value && xFields.length > 0) dom.chartX.value = xFields[0];
    if (!dom.chartY.value && yFields.length > 1) dom.chartY.value = yFields[1] || yFields[0];
    else if (!dom.chartY.value && yFields.length > 0) dom.chartY.value = yFields[0];
  }

  function _fillSelect(sel, options, selected) {
    sel.innerHTML = "";
    if (options.length === 0) { sel.innerHTML = '<option value="">—</option>'; return; }
    for (var i = 0; i < options.length; i++) { var opt = document.createElement("option"); opt.value = options[i]; opt.textContent = options[i]; if (options[i] === selected) opt.selected = true; sel.appendChild(opt); }
  }

  function _updateFieldSelectorVisibility() {
    var ct = panelState.chartType;
    var showX = ct === "scatter" || ct === "histogram" || ct === "bar" || ct === "pie";
    var showY = ct === "scatter";
    var showG = ct === "scatter" || ct === "bar";
    if (dom.chartX) { var xlbl = dom.chartX.previousElementSibling; if (xlbl) xlbl.style.display = showX ? "" : "none"; dom.chartX.style.display = showX ? "" : "none"; }
    if (dom.chartY) { var ylbl = dom.chartY.previousElementSibling; if (ylbl) ylbl.style.display = showY ? "" : "none"; dom.chartY.style.display = showY ? "" : "none"; }
    if (dom.chartGroup) { var glbl = dom.chartGroup.previousElementSibling; if (glbl) glbl.style.display = showG ? "" : "none"; dom.chartGroup.style.display = showG ? "" : "none"; }
    var cmp = dom.chartCompare ? dom.chartCompare.closest("label") : null;
    if (cmp) cmp.style.display = (ct === "bar" || ct === "radar") ? "" : "none";
  }

  function _renderChart() {
    if (typeof echarts === "undefined") { _showEmpty("chart", "ECharts 尚未加载"); return; }
    _populateFieldSelectors();
    _updateFieldSelectorVisibility();
    var container = dom.chartContainer; if (!container) return;
    if (dom.chartContainer) dom.chartContainer.style.display = "";
    if (dom.emptyChart) dom.emptyChart.style.display = "none";
    panelState.chartXField = dom.chartX ? dom.chartX.value : "";
    panelState.chartYField = dom.chartY ? dom.chartY.value : "";
    panelState.chartGroupField = dom.chartGroup ? dom.chartGroup.value : "";
    panelState.showLegend = dom.chartShowLegend ? dom.chartShowLegend.checked : true;
    var option;
    try {
      if (panelState.chartType === "scatter") option = _buildScatterOption();
      else if (panelState.chartType === "histogram") option = _buildHistogramOption();
      else if (panelState.chartType === "pie") option = _buildPieOption();
      else if (panelState.chartType === "radar") option = _buildRadarOption();
      else option = _buildBarOption();
    } catch (e) { _showEmpty("chart", "图表渲染出错：" + e.message); return; }
    if (!option) { _showEmpty("chart", "没有可用的数据字段"); return; }
    if (panelState.chartInstance) { try { panelState.chartInstance.dispose(); } catch (e) {} }
    panelState.chartInstance = echarts.init(container, null, { renderer: "canvas" });
    panelState.chartInstance.setOption(option, { notMerge: true });
    _updateChartLegend();
    try { panelState.chartInstance.resize(); } catch (e) {}
  }

  function _buildScatterOption() {
    var xF = panelState.chartXField, yF = panelState.chartYField, gF = panelState.chartGroupField;
    if (!xF || !yF) return null;
    var feats = panelState.mode === "single" ? [panelState.feature] : panelState.allFeatures;
    if (!feats || !feats.length) return null;
    var COLORS = ["#9c9","#6b8ec4","#e68a6e","#c49b6b","#8ec46b","#6bc4c4","#b86bc4","#c4b86b","#6b8ec4","#c46b8e"];

    if (gF) {
      // 分组散点图：每组一个 series
      var groups = {};
      for (var i = 0; i < feats.length; i++) {
        var f = feats[i]; if (!f || !f.properties) continue;
        var xv = f.properties[xF], yv = f.properties[yF];
        if (typeof xv !== "number" || typeof yv !== "number") continue;
        var gv = f.properties[gF]; if (gv == null || gv === "") gv = "其他";
        var key = String(gv).substring(0, 30);
        if (!groups[key]) groups[key] = [];
        var label = (f.properties.name || f.properties.Name || f.properties.NAME || f.properties.Fullname || f.properties.Hole || f.properties.site || ("#" + (f._featureIndex || i)));
        groups[key].push({ value: [xv, yv], name: String(label) });
      }
      var series = [];
      var ci = 0;
      var legendData = [];
      for (var gk in groups) {
        legendData.push(gk);
        series.push({ type: "scatter", name: gk, data: groups[gk], symbolSize: 5, itemStyle: { color: COLORS[ci % COLORS.length] } });
        ci++;
      }
      if (!series.length) return null;
      return _addToolbox({
        tooltip: { formatter: function (p) { return p.seriesName + "<br/>" + p.name + "<br/>" + xF + ": " + p.value[0] + "<br/>" + yF + ": " + p.value[1]; }, backgroundColor: "rgba(30,30,46,0.95)", borderColor: "rgba(255,255,255,0.1)", textStyle: { color: "#e0e0e0", fontSize: 12 } },
        legend: panelState.showLegend ? { show: true, type: "scroll", bottom: 0, textStyle: { color: "#999", fontSize: 10 }, data: legendData } : { show: false },
        grid: { left: "6%", right: "6%", bottom: "10%", top: "6%", containLabel: true },
        xAxis: { type: "value", name: xF, nameTextStyle: { color: "#888", fontSize: 11 }, axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } }, axisLabel: { color: "#888", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
        yAxis: { type: "value", name: yF, nameTextStyle: { color: "#888", fontSize: 11 }, axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } }, axisLabel: { color: "#888", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
        series: series,
        dataZoom: [{ type: "inside" }],
      });
    }

    // 无分组：单色散点
    var data = [];
    for (var j = 0; j < feats.length; j++) {
      var f2 = feats[j]; if (!f2 || !f2.properties) continue;
      var xv2 = f2.properties[xF], yv2 = f2.properties[yF];
      if (typeof xv2 !== "number" || typeof yv2 !== "number") continue;
      var label2 = (f2.properties.name || f2.properties.Name || f2.properties.NAME || f2.properties.Fullname || f2.properties.Hole || f2.properties.site || ("#" + (f2._featureIndex || j)));
      data.push({ value: [xv2, yv2], name: String(label2) });
    }
    if (!data.length) return null;
    return _addToolbox({
      tooltip: { formatter: function (p) { return p.name + "<br/>" + xF + ": " + p.value[0] + "<br/>" + yF + ": " + p.value[1]; }, backgroundColor: "rgba(30,30,46,0.95)", borderColor: "rgba(255,255,255,0.1)", textStyle: { color: "#e0e0e0", fontSize: 12 } },
      grid: { left: "6%", right: "6%", bottom: "10%", top: "6%", containLabel: true },
      xAxis: { type: "value", name: xF, nameTextStyle: { color: "#888", fontSize: 11 }, axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } }, axisLabel: { color: "#888", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
      yAxis: { type: "value", name: yF, nameTextStyle: { color: "#888", fontSize: 11 }, axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } }, axisLabel: { color: "#888", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
      series: [{ type: "scatter", data: data, symbolSize: 6, itemStyle: { color: "#9c9" }, emphasis: { itemStyle: { color: "#b3e6b3", shadowBlur: 6 } } }],
      dataZoom: [{ type: "inside" }],
    });
  }

  function _buildHistogramOption() {
    var field = panelState.chartXField; if (!field) return null;
    var feats = panelState.mode === "single" ? [panelState.feature] : panelState.allFeatures;
    if (!feats || !feats.length) return null;
    var values = [];
    for (var i = 0; i < feats.length; i++) { var f = feats[i]; if (!f || !f.properties) continue; var v = f.properties[field]; if (typeof v === "number" && isFinite(v)) values.push(v); }
    if (!values.length) return null;
    values.sort(function (a, b) { return a - b; });
    var mn = values[0], mx = values[values.length - 1];
    var bc = Math.min(30, Math.max(5, Math.ceil(Math.sqrt(values.length))));
    var bw = (mx - mn) / bc || 1;
    var bins = [];
    for (var b = 0; b < bc; b++) bins.push({ from: mn + b * bw, count: 0 });
    for (var j = 0; j < values.length; j++) { var idx = Math.min(bc - 1, Math.floor((values[j] - mn) / bw)); if (idx >= 0 && idx < bc) bins[idx].count++; }
    return _addToolbox({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: function (p) { var d = p[0]; return field + ": " + d.name + "<br/>数量: " + d.value; }, backgroundColor: "rgba(30,30,46,0.95)", borderColor: "rgba(255,255,255,0.1)", textStyle: { color: "#e0e0e0", fontSize: 12 } },
      grid: { left: "6%", right: "6%", bottom: "10%", top: "6%", containLabel: true },
      xAxis: { type: "category", data: bins.map(function (b) { return b.from.toFixed(2); }), axisLabel: { color: "#888", fontSize: 9, rotate: 30 }, axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } } },
      yAxis: { type: "value", name: "数量", axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } }, axisLabel: { color: "#888", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
      series: [{ type: "bar", data: bins.map(function (b) { return b.count; }), itemStyle: { color: "#9c9", borderRadius: [3, 3, 0, 0] }, barCategoryGap: "5%" }],
      dataZoom: [{ type: "inside" }],
    });
  }

  function _buildBarOption() {
    var xField = panelState.chartXField, gField = panelState.chartGroupField;
    if (!xField) {
      var autoFields = panelState.mode === "single" && panelState.feature ? window.GeoUtils.extractNumericFields(panelState.feature) : _aggregateLayerNumericFields(panelState.allFeatures);
      if (!autoFields || !autoFields.length) return null;
      var names = autoFields.map(function (f) { return f.key; }), values = autoFields.map(function (f) { return f.value; });
      if (names.length > 30) { names = names.slice(0, 30); values = values.slice(0, 30); }
      return _makeBarChart(names, values, "");
    }
    var feats = panelState.allFeatures || (panelState.feature ? [panelState.feature] : []);

    if (gField) {
      // 分组柱状图：X轴=分类值，分组=颜色系列
      var xCats = {}, groupNames = {};
      for (var i = 0; i < feats.length; i++) {
        var f = feats[i]; if (!f || !f.properties) continue;
        var xv = f.properties[xField], gv = f.properties[gField];
        if (xv == null || xv === "") continue;
        var xkey = String(xv).substring(0, 40);
        var gkey = gv != null && gv !== "" ? String(gv).substring(0, 30) : "其他";
        if (!xCats[xkey]) xCats[xkey] = {};
        xCats[xkey][gkey] = (xCats[xkey][gkey] || 0) + 1;
        groupNames[gkey] = true;
      }
      var xLabels = Object.keys(xCats);
      if (!xLabels.length) return null;
      var gKeys = Object.keys(groupNames);
      var COLORS = ["#9c9","#6b8ec4","#e68a6e","#c49b6b","#8ec46b","#6bc4c4","#b86bc4","#c4b86b"];
      var series = [];
      for (var gi = 0; gi < gKeys.length; gi++) {
        var gk = gKeys[gi];
        var sdata = xLabels.map(function (xk) { return xCats[xk][gk] || 0; });
        series.push({ type: "bar", name: gk, data: sdata, itemStyle: { color: COLORS[gi % COLORS.length] }, barMaxWidth: 30 });
      }
      return _addToolbox({
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "rgba(30,30,46,0.95)", borderColor: "rgba(255,255,255,0.1)", textStyle: { color: "#e0e0e0", fontSize: 12 } },
        legend: panelState.showLegend ? { show: true, type: "scroll", bottom: 0, textStyle: { color: "#999", fontSize: 10 } } : { show: false },
        grid: { left: "6%", right: "6%", bottom: "14%", top: "6%", containLabel: true },
        xAxis: { type: "category", data: xLabels, axisLabel: { color: "#888", fontSize: 10, rotate: 30 }, axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } } },
        yAxis: { type: "value", name: "数量", axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } }, axisLabel: { color: "#888", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
        series: series,
        dataZoom: [{ type: "inside" }],
      });
    }

    // 无分组：单色柱状
    var counts = {};
    for (var j = 0; j < feats.length; j++) { var f2 = feats[j]; if (!f2 || !f2.properties) continue; var v2 = f2.properties[xField]; if (v2 == null || v2 === "") continue; var key2 = String(v2).substring(0, 40); counts[key2] = (counts[key2] || 0) + 1; }
    if (!Object.keys(counts).length) return null;
    var entries = Object.keys(counts).map(function (k) { return { key: k, value: counts[k] }; });
    entries.sort(function (a, b) { return b.value - a.value; });
    if (entries.length > 30) entries = entries.slice(0, 30);
    return _makeBarChart(entries.map(function (e) { return e.key; }), entries.map(function (e) { return e.value; }), xField);
  }

  function _makeBarChart(names, values, fieldName) {
    var series = [{ type: "bar", name: fieldName || "计数", data: values, itemStyle: { color: "#9c9", borderRadius: [0, 3, 3, 0] }, emphasis: { itemStyle: { color: "#b3e6b3" } }, barMaxWidth: 30 }];
    return _addToolbox({
      legend: panelState.showLegend ? { show: true, bottom: 0, textStyle: { color: "#999", fontSize: 10 } } : { show: false },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "rgba(30,30,46,0.95)", borderColor: "rgba(255,255,255,0.1)", textStyle: { color: "#e0e0e0", fontSize: 12 } },
      grid: { left: "3%", right: "8%", bottom: "3%", top: "3%", containLabel: true },
      xAxis: { type: "value", name: fieldName || "", axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } }, axisLabel: { color: "#888", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } } },
      yAxis: { type: "category", data: names, axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } }, axisLabel: { color: "#e0e0e0", fontSize: 11, width: 140, overflow: "truncate" }, axisTick: { show: false } },
      series: series,
      dataZoom: [{ type: "inside" }],
    });
  }

  function _buildPieOption() {
    var xField = panelState.chartXField;
    var feats = panelState.allFeatures || (panelState.feature ? [panelState.feature] : []);
    if (!feats || !feats.length) return null;
    if (xField) {
      var counts = {};
      for (var i = 0; i < feats.length; i++) { var f = feats[i]; if (!f || !f.properties) continue; var v = f.properties[xField]; if (v == null || v === "") continue; var key = String(v).substring(0, 30); counts[key] = (counts[key] || 0) + 1; }
      var entries = Object.keys(counts).map(function (k) { return { name: k, value: counts[k] }; });
      entries.sort(function (a, b) { return b.value - a.value; });
      if (entries.length > 12) entries = entries.slice(0, 12);
      return _makePieChart(entries);
    }
    var fields = panelState.mode === "single" && panelState.feature ? window.GeoUtils.extractNumericFields(panelState.feature) : _aggregateLayerNumericFields(panelState.allFeatures);
    if (!fields || !fields.length) return null;
    var pieData = fields.filter(function (f) { return f.value > 0; }).slice(0, 12).map(function (f) { return { name: f.key, value: f.value }; });
    if (pieData.length === 0) pieData = fields.slice(0, 12).map(function (f) { return { name: f.key, value: Math.abs(f.value) }; });
    return _makePieChart(pieData);
  }

  function _makePieChart(data) {
    return _addToolbox({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)", backgroundColor: "rgba(30,30,46,0.95)", borderColor: "rgba(255,255,255,0.1)", textStyle: { color: "#e0e0e0", fontSize: 12 } },
      legend: { show: data.length <= 10, bottom: 0, textStyle: { color: "#999", fontSize: 10 } },
      series: [{ type: "pie", radius: ["35%", "70%"], center: ["50%", "48%"], data: data, emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.5)" } }, label: { color: "#999", fontSize: 10, formatter: "{b}\n{d}%" } }],
    });
  }

  function _buildRadarOption() {
    var fields = panelState.mode === "single" && panelState.feature ? window.GeoUtils.extractNumericFields(panelState.feature) : _aggregateLayerNumericFields(panelState.allFeatures);
    if (!fields || !fields.length) return null;
    var topFields = fields.slice(0, 10), maxVal = 0;
    for (var i = 0; i < topFields.length; i++) { var abs = Math.abs(topFields[i].value); if (abs > maxVal) maxVal = abs; }
    if (topFields.length === 0 || maxVal === 0) return null;
    var values = topFields.map(function (f) { return f.value; });
    var indicators = topFields.map(function (f) { return { name: f.key, max: maxVal * 1.2 }; });
    var series = [{ type: "radar", data: [{ value: values, name: "当前数据", areaStyle: { color: "rgba(153,204,153,0.2)" } }], symbol: "circle", symbolSize: 4, lineStyle: { color: "#9c9", width: 2 }, itemStyle: { color: "#9c9" } }];
    return _addToolbox({
      tooltip: { backgroundColor: "rgba(30,30,46,0.95)", borderColor: "rgba(255,255,255,0.1)", textStyle: { color: "#e0e0e0", fontSize: 12 } },
      legend: { show: true, bottom: 5, textStyle: { color: "#999", fontSize: 11 } },
      radar: { indicator: indicators, axisName: { color: "#999", fontSize: 10 }, splitArea: { areaStyle: { color: ["rgba(255,255,255,0.02)", "rgba(255,255,255,0.04)"] } }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } }, axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } } },
      series: series,
    });
  }

  // 给图表配置添加工具箱（保存图片等）
  function _addToolbox(option) {
    option.toolbox = {
      show: true,
      right: 10,
      top: 0,
      feature: {
        saveAsImage: { title: "保存图片", pixelRatio: 2 },
        restore: { title: "还原" },
      },
    };
    return option;
  }

  function _aggregateLayerNumericFields(features) {
    if (!features || !features.length) return [];
    var sums = {};
    for (var i = 0; i < features.length; i++) { var f = features[i]; if (!f || !f.properties) continue; var props = f.properties; for (var k in props) { if (k === "_featureIndex") continue; var v = props[k]; if (typeof v === "number" && isFinite(v)) sums[k] = (sums[k] || 0) + v; } }
    var results = [];
    for (var key in sums) results.push({ key: key, value: sums[key] });
    results.sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); });
    return results;
  }

  function _updateChartLegend() {
    if (!dom.chartLegend) return;
    dom.chartLegend.innerHTML = "";
  }


  // ========== 事件绑定 ==========

  function _bindEvents() {
    if (!ensureDOM()) return;

    dom.closeBtn.addEventListener("click", closePanel);
    if (dom.backdrop) dom.backdrop.addEventListener("click", closePanel);

    dom.tabAttr.addEventListener("click", function () {
      _activateTab("attr");
    });
    dom.tabChart.addEventListener("click", function () {
      _activateTab("chart");
    });

    if (dom.modeSingle) {
      dom.modeSingle.addEventListener("click", function () {
        if (panelState.mode === "single") return;
        panelState.mode = "single";
        panelState.currentPage = 1;
        panelState.searchQuery = "";
        if (dom.searchInput) dom.searchInput.value = "";
        _updateUI();
        _renderAttrTable();
      });
    }
    if (dom.modeLayer) {
      dom.modeLayer.addEventListener("click", function () {
        if (panelState.mode === "layer") return;
        if (!panelState.allFeatures || !panelState.allFeatures.length) return;
        panelState.mode = "layer";
        panelState.currentPage = 1;
        panelState.searchQuery = "";
        if (dom.searchInput) dom.searchInput.value = "";
        _updateUI();
        _renderAttrTable();
      });
    }

    var searchTimeout;
    dom.searchInput.addEventListener("input", function () {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(function () {
        panelState.searchQuery = dom.searchInput.value;
        panelState.currentPage = 1;
        _renderAttrTable();
      }, 250);
    });

    var prevBtn = dom.pager.querySelector(".pager-prev");
    var nextBtn = dom.pager.querySelector(".pager-next");
    if (prevBtn)
      prevBtn.addEventListener("click", function () {
        goToPage(panelState.currentPage - 1);
      });
    if (nextBtn)
      nextBtn.addEventListener("click", function () {
        goToPage(panelState.currentPage + 1);
      });
    if (dom.pageInput) {
      dom.pageInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          var page = parseInt(dom.pageInput.value, 10);
          if (!isNaN(page)) goToPage(page);
        }
      });
    }

    if (dom.chartType)
      dom.chartType.addEventListener("change", function () {
        panelState.chartType = this.value;
        _renderChart();
      });
    if (dom.chartX)
      dom.chartX.addEventListener("change", function () {
        panelState.chartXField = this.value;
        _renderChart();
      });
    if (dom.chartY)
      dom.chartY.addEventListener("change", function () {
        panelState.chartYField = this.value;
        _renderChart();
      });
    if (dom.chartGroup)
      dom.chartGroup.addEventListener("change", function () {
        panelState.chartGroupField = this.value;
        _renderChart();
      });
    if (dom.chartShowLegend)
      dom.chartShowLegend.addEventListener("change", function () {
        panelState.showLegend = this.checked;
        _renderChart();
      });
    if (dom.chartCompare)
      dom.chartCompare.addEventListener("change", function () {
        panelState.showCompare = this.checked;
        _renderChart();
      });

    // resize handle
    if (dom.resizeHandle) {
      dom.resizeHandle.addEventListener("mousedown", _startResize);
      dom.resizeHandle.addEventListener("touchstart", _startResize, {
        passive: false,
      });
    }
    document.addEventListener("mousemove", _moveResize);
    document.addEventListener("touchmove", _moveResize, { passive: false });
    document.addEventListener("mouseup", _endResize);
    document.addEventListener("touchend", _endResize);

    // ESC + keyboard
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panelState.open) closePanel();
    });
    window.addEventListener("resize", function () {
      if (panelState.chartInstance && panelState.open) {
        try {
          panelState.chartInstance.resize();
        } catch (e) {}
      }
    });
  }

  // ========== 暴露 API ==========
  window.FeaturePanel = {
    openSingle: openSingleFeature,
    openLayer: openLayerTable,
    close: closePanel,
    isOpen: function () {
      return panelState.open;
    },
  };

  window._featureCache = window._featureCache || {};

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _bindEvents);
  } else {
    _bindEvents();
  }
})();
