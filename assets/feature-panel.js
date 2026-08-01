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

  // ========== ECharts ==========

  function _loadEChartsAndRender() {
    if (ECHARTS_LOADED) {
      _renderChart();
      return;
    }
    if (ECHARTS_LOADING) return;
    ECHARTS_LOADING = true;
    var script = document.createElement("script");
    script.src = ECHARTS_CDN;
    script.onload = function () {
      ECHARTS_LOADED = true;
      ECHARTS_LOADING = false;
      _renderChart();
    };
    script.onerror = function () {
      ECHARTS_LOADING = false;
      if (dom.emptyChart) {
        dom.emptyChart.style.display = "flex";
        dom.emptyChart.querySelector(".empty-text").textContent =
          "ECharts 加载失败，请检查网络连接";
      }
      if (dom.chartContainer) dom.chartContainer.style.display = "none";
    };
    document.head.appendChild(script);
  }

  function _renderChart() {
    if (typeof echarts === "undefined") {
      _showEmpty("chart", "ECharts 尚未加载");
      return;
    }

    var numericFields;
    if (panelState.mode === "single" && panelState.feature) {
      numericFields = window.GeoUtils.extractNumericFields(panelState.feature);
    } else if (
      panelState.mode === "layer" &&
      panelState.allFeatures &&
      panelState.allFeatures.length > 0
    ) {
      numericFields = _aggregateLayerNumericFields(panelState.allFeatures);
    } else {
      _showEmpty("chart", "没有数值字段可展示");
      return;
    }

    if (!numericFields || numericFields.length === 0) {
      _showEmpty("chart", "该要素没有数值字段");
      return;
    }

    if (
      panelState.showCompare &&
      panelState.layerId &&
      !panelState.layerStats
    ) {
      var feats = panelState.allFeatures;
      if (!feats || !feats.length) {
        if (window._featureCache && window._featureCache[panelState.layerId]) {
          feats = window._featureCache[panelState.layerId];
        }
      }
      if (feats && feats.length)
        panelState.layerStats = window.GeoUtils.computeLayerStats(feats);
    }

    if (dom.chartContainer) dom.chartContainer.style.display = "";
    if (dom.emptyChart) dom.emptyChart.style.display = "none";

    var container = dom.chartContainer;
    if (!container) return;

    if (panelState.chartInstance) {
      try {
        panelState.chartInstance.dispose();
      } catch (e) {}
    }
    panelState.chartInstance = echarts.init(container, null, {
      renderer: "canvas",
    });

    var chartType = panelState.chartType || "bar";
    var option;
    if (chartType === "radar") option = _buildRadarOption(numericFields);
    else if (chartType === "pie") option = _buildPieOption(numericFields);
    else option = _buildBarOption(numericFields);

    panelState.chartInstance.setOption(option);
    _updateChartLegend();
    try {
      panelState.chartInstance.resize();
    } catch (e) {}
  }

  function _buildBarOption(fields) {
    var names = fields.map(function (f) {
      return f.key;
    });
    var values = fields.map(function (f) {
      return f.value;
    });
    if (names.length > 30) {
      names = names.slice(0, 30);
      values = values.slice(0, 30);
    }

    var series = [
      {
        type: "bar",
        data: values,
        itemStyle: { color: "#9c9", borderRadius: [0, 3, 3, 0] },
        emphasis: { itemStyle: { color: "#b3e6b3" } },
        barMaxWidth: 30,
      },
    ];

    if (panelState.showCompare && panelState.layerStats) {
      var compareVals = names.map(function (k) {
        return panelState.layerStats[k] != null
          ? panelState.layerStats[k]
          : null;
      });
      series.push({
        type: "bar",
        data: compareVals,
        itemStyle: {
          color: "rgba(255,255,255,0.2)",
          borderRadius: [0, 3, 3, 0],
        },
        barMaxWidth: 24,
        barGap: "10%",
      });
    }

    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(30,30,46,0.95)",
        borderColor: "rgba(255,255,255,0.1)",
        textStyle: { color: "#e0e0e0", fontSize: 12 },
      },
      grid: {
        left: "3%",
        right: "8%",
        bottom: "3%",
        top: "3%",
        containLabel: true,
      },
      xAxis: {
        type: "value",
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } },
        axisLabel: { color: "#888", fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
      },
      yAxis: {
        type: "category",
        data: names,
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } },
        axisLabel: {
          color: "#e0e0e0",
          fontSize: 11,
          width: 120,
          overflow: "truncate",
        },
        axisTick: { show: false },
      },
      series: series,
    };
  }

  function _buildPieOption(fields) {
    var pieData = fields
      .filter(function (f) {
        return f.value > 0;
      })
      .slice(0, 12)
      .map(function (f) {
        return { name: f.key, value: f.value };
      });
    if (pieData.length === 0)
      pieData = fields.slice(0, 12).map(function (f) {
        return { name: f.key, value: Math.abs(f.value) };
      });
    return {
      tooltip: {
        trigger: "item",
        formatter: "{b}: {c} ({d}%)",
        backgroundColor: "rgba(30,30,46,0.95)",
        borderColor: "rgba(255,255,255,0.1)",
        textStyle: { color: "#e0e0e0", fontSize: 12 },
      },
      legend: { show: false },
      series: [
        {
          type: "pie",
          radius: ["35%", "70%"],
          center: ["50%", "50%"],
          data: pieData,
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: "rgba(0,0,0,0.5)",
            },
          },
          label: { color: "#999", fontSize: 10, formatter: "{b}\n{d}%" },
        },
      ],
    };
  }

  function _buildRadarOption(fields) {
    var topFields = fields.slice(0, 10);
    var maxVal = 0;
    for (var i = 0; i < topFields.length; i++) {
      var abs = Math.abs(topFields[i].value);
      if (abs > maxVal) maxVal = abs;
    }
    if (maxVal === 0) maxVal = 1;
    var values = topFields.map(function (f) {
      return f.value;
    });
    var indicators = topFields.map(function (f) {
      return { name: f.key, max: maxVal * 1.2 };
    });
    var series = [
      {
        type: "radar",
        data: [
          {
            value: values,
            name: "当前要素",
            areaStyle: { color: "rgba(153,204,153,0.2)" },
          },
        ],
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: "#9c9", width: 2 },
        itemStyle: { color: "#9c9" },
      },
    ];

    if (panelState.showCompare && panelState.layerStats) {
      var compVals = topFields.map(function (f) {
        return panelState.layerStats[f.key] != null
          ? panelState.layerStats[f.key]
          : 0;
      });
      series.push({
        type: "radar",
        data: [{ value: compVals, name: "图层均值" }],
        symbol: "diamond",
        symbolSize: 4,
        lineStyle: {
          color: "rgba(255,255,255,0.4)",
          width: 1.5,
          type: "dashed",
        },
        itemStyle: { color: "rgba(255,255,255,0.5)" },
      });
    }

    return {
      tooltip: {
        backgroundColor: "rgba(30,30,46,0.95)",
        borderColor: "rgba(255,255,255,0.1)",
        textStyle: { color: "#e0e0e0", fontSize: 12 },
      },
      legend: {
        show: true,
        bottom: 5,
        textStyle: { color: "#999", fontSize: 11 },
      },
      radar: {
        indicators: indicators,
        axisName: { color: "#999", fontSize: 10 },
        splitArea: {
          areaStyle: {
            color: ["rgba(255,255,255,0.02)", "rgba(255,255,255,0.04)"],
          },
        },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
      },
      series: series,
    };
  }

  function _aggregateLayerNumericFields(features) {
    var sums = {};
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      if (!f || !f.properties) continue;
      var props = f.properties;
      for (var k in props) {
        if (k === "_featureIndex") continue;
        var v = props[k];
        if (typeof v === "number" && isFinite(v)) sums[k] = (sums[k] || 0) + v;
      }
    }
    var results = [];
    for (var key in sums) results.push({ key: key, value: sums[key] });
    results.sort(function (a, b) {
      return Math.abs(b.value) - Math.abs(a.value);
    });
    return results;
  }

  function _updateChartLegend() {
    if (!dom.chartLegend) return;
    dom.chartLegend.innerHTML = "";
    if (panelState.showCompare && panelState.layerStats) {
      dom.chartLegend.innerHTML =
        '<span><span class="legend-dot" style="background:#9c9"></span>当前要素</span>' +
        '<span><span class="legend-dot" style="background:rgba(255,255,255,0.2)"></span>图层均值</span>';
    }
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
