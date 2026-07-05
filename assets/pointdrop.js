/**
 * pointdrop.js — 投点功能（独立模块）
 * 依赖：window.addUserLayer（由 geojsonloader.js 挂载）
 *       pointdrop.css（样式）
 * 在 geojsonloader.js 之后加载
 */
(function () {
  "use strict";

  // ========== 状态 ==========
  var pointDropData = []; // [{lat, lng, Name, ...extra}]
  var pointDropCols = []; // 额外字段名（不含固定三列）
  var pointDropTable = null; // DOM 容器

  // ========== 初始化：在图层面板"上传矢量"按钮上方插入投点按钮 ==========
  function initPointDropUI() {
    var uploadDiv = document.getElementById("pointDropAnchor");
    if (!uploadDiv) return;

    // 🗺️ 坐标投点 — 插入到 pointDropAnchor 上方（独立一行）
    var btn = document.createElement("button");
    btn.id = "pointDropBtn";
    btn.textContent = "🗺️ 坐标投点";
    btn.title = "手动输入经纬度生成点位图层，支持粘贴 CSV / TXT / Excel 数据";
    btn.className = "pd-btn";
    btn.style.marginBottom = "6px";
    btn.onclick = togglePointDropTable;

    uploadDiv.parentNode.insertBefore(btn, uploadDiv);

    // 📍 现在的位置 — 插入到上传矢量按钮上方（坐标投点下面）
    var locateBtn = document.createElement("button");
    locateBtn.id = "geoLocateBtn";
    locateBtn.textContent = "📍 现在的位置";
    locateBtn.title = "获取设备 GPS 坐标，在地图上标记当前位置并记录备注与分类";
    locateBtn.className = "pd-btn";
    locateBtn.style.marginBottom = "6px";
    locateBtn.onclick = function () {
      if (typeof window.startGeoLocate === "function") {
        window.startGeoLocate();
      } else if (typeof window.showToast === "function") {
        window.showToast("⏳ 定位功能加载中，请稍后再试", { duration: 2000 });
      }
    };
    var uploadBtnRow = document.querySelector("#uploadArea .upload-btn-row");
    if (uploadBtnRow) {
      uploadBtnRow.parentNode.insertBefore(locateBtn, uploadBtnRow);
    }
  }

  // ========== 显示/隐藏表格 ==========
  function togglePointDropTable() {
    if (pointDropTable) {
      pointDropTable.style.display =
        pointDropTable.style.display === "none" ? "" : "none";
      return;
    }
    createPointDropTable();
  }

  // ========== 创建表格 DOM ==========
  function createPointDropTable() {
    pointDropData = [{ lat: "", lng: "", Name: "" }];
    pointDropCols = [];

    pointDropTable = document.createElement("div");
    pointDropTable.id = "pointDropTable";
    pointDropTable.className = "pd-table-container";

    // 标题栏
    var titleBar = document.createElement("div");
    titleBar.className = "pd-title-bar";
    titleBar.innerHTML =
      '<span class="pd-title-text">📍 投点编辑器</span>' +
      '<span class="pd-close-btn" id="pdClose" title="关闭">✕</span>';
    titleBar.querySelector("#pdClose").onclick = function () {
      pointDropTable.style.display = "none";
    };
    pointDropTable.appendChild(titleBar);

    // 粘贴区
    var pasteLabel = document.createElement("div");
    pasteLabel.className = "pd-paste-label";
    pasteLabel.textContent = "粘贴数据（CSV / TSV / Excel 列）：";
    pointDropTable.appendChild(pasteLabel);

    var pasteArea = document.createElement("textarea");
    pasteArea.id = "pdPasteArea";
    pasteArea.placeholder =
      "纬度\t经度\t名称\n32.1\t118.5\t南京\n39.9\t116.4\t北京\n\n也可直接粘贴 Excel 或 CSV 内容";
    pasteArea.className = "pd-paste-area";
    pasteArea.oninput = onPasteInput;
    pointDropTable.appendChild(pasteArea);

    // 操作按钮栏
    var btnBar = document.createElement("div");
    btnBar.className = "pd-btn-bar";

    var addRowBtn = document.createElement("button");
    addRowBtn.textContent = "+ 添加一行";
    addRowBtn.className = "pd-action-btn";
    addRowBtn.onclick = addTableRow;

    var addColBtn = document.createElement("button");
    addColBtn.textContent = "+ 字段";
    addColBtn.className = "pd-action-btn";
    addColBtn.onclick = addTableColumn;

    var clearBtn = document.createElement("button");
    clearBtn.textContent = "清空";
    clearBtn.className = "pd-clear-btn";
    clearBtn.onclick = clearTable;

    var genBtn = document.createElement("button");
    genBtn.textContent = "📍 生成图层";
    genBtn.className = "pd-gen-btn";
    genBtn.onclick = generateLayer;

    btnBar.appendChild(addRowBtn);
    btnBar.appendChild(addColBtn);
    btnBar.appendChild(clearBtn);
    btnBar.appendChild(genBtn);
    pointDropTable.appendChild(btnBar);

    // 表格容器
    var tableWrap = document.createElement("div");
    tableWrap.id = "pdTableWrap";
    tableWrap.className = "pd-table-wrap";
    pointDropTable.appendChild(tableWrap);

    // 插入到面板
    var anchor = document.getElementById("pointDropAnchor");
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(pointDropTable, anchor);
    }

    renderTable();
  }

  // ========== 渲染表格 ==========
  function renderTable() {
    var wrap = document.getElementById("pdTableWrap");
    if (!wrap) return;

    // 计算各列宽度：列名字符数+1ch，最小4ch，最大60px
    var fixedCols = [
      { name: "#", w: "28px" },
      { name: "纬度 *", w: "60px" },
      { name: "经度 *", w: "60px" },
      { name: "Name", w: "60px" },
    ];
    var colWidths = fixedCols.map(function (c) {
      return c.w;
    });
    for (var ci = 0; ci < pointDropCols.length; ci++) {
      var len = pointDropCols[ci].length + 1;
      if (len < 4) len = 4;
      colWidths.push("min(60px," + len + "ch)");
    }

    var html = '<table class="pd-table">';

    // 表头
    html += "<thead><tr>";
    html += '<th class="pd-col-num" style="width:' + colWidths[0] + ';">#</th>';
    html += '<th style="width:' + colWidths[1] + ';">纬度 *</th>';
    html += '<th style="width:' + colWidths[2] + ';">经度 *</th>';
    html += '<th style="width:' + colWidths[3] + ';">Name</th>';
    // 表头——额外字段名用 contenteditable 实现可编辑
    for (var ci2 = 0; ci2 < pointDropCols.length; ci2++) {
      var cw = colWidths[4 + ci2];
      html +=
        '<th style="width:' +
        cw +
        ';">' +
        '<span contenteditable="true" ' +
        'onblur="window.__pdRenameCol(' +
        ci2 +
        ',this.textContent)" ' +
        "onkeydown=\"if(event.key==='Enter'){event.preventDefault();this.blur();}\">" +
        escapeHtml(pointDropCols[ci2]) +
        "</span>" +
        ' <span class="pd-del-col-btn" onclick="window.__pdDelCol(' +
        ci2 +
        ')">✕</span></th>';
    }
    html += "</tr></thead>";

    // 表体
    html += "<tbody>";
    for (var ri = 0; ri < pointDropData.length; ri++) {
      var row = pointDropData[ri];
      html += "<tr>";
      html += '<td class="pd-col-num">' + (ri + 1) + "</td>";
      html +=
        '<td style="width:' +
        colWidths[1] +
        ';"><input class="pd-cell-input" type="text" value="' +
        escapeAttr(row.lat) +
        '" title="' +
        escapeAttr(row.lat) +
        '" oninput="window.__pdChange(' +
        ri +
        ",'lat',this.value)\"></td>";
      html +=
        '<td style="width:' +
        colWidths[2] +
        ';"><input class="pd-cell-input" type="text" value="' +
        escapeAttr(row.lng) +
        '" title="' +
        escapeAttr(row.lng) +
        '" oninput="window.__pdChange(' +
        ri +
        ",'lng',this.value)\"></td>";
      html +=
        '<td style="width:' +
        colWidths[3] +
        ';"><input class="pd-cell-input" type="text" value="' +
        escapeAttr(row.Name) +
        '" title="' +
        escapeAttr(row.Name) +
        '" oninput="window.__pdChange(' +
        ri +
        ",'Name',this.value)\"></td>";
      for (var cj = 0; cj < pointDropCols.length; cj++) {
        var colName = pointDropCols[cj];
        var val = row[colName] || "";
        var cw2 = colWidths[4 + cj];
        html +=
          '<td style="width:' +
          cw2 +
          ';"><input class="pd-cell-input" type="text" value="' +
          escapeAttr(val) +
          '" title="' +
          escapeAttr(val) +
          '" oninput="window.__pdChange(' +
          ri +
          ",'" +
          escapeJs(colName) +
          "',this.value)\"></td>";
      }
      html += "</tr>";
    }
    html += "</tbody></table>";

    wrap.innerHTML = html;
  }

  // ========== 粘贴解析 ==========
  // 规则：前两列 = 纬度、经度（十进制数字，整数或浮点数均可）
  // 第三列 = Name（固定）
  // 第四列起 = 用户额外字段（第一行若非数字则视为表头，保留原始字段名）
  function onPasteInput() {
    var area = document.getElementById("pdPasteArea");
    if (!area) return;
    var text = area.value.trim();
    if (!text) return;

    var lines = text.split(/\r?\n/).filter(function (l) {
      return l.trim();
    });
    if (lines.length === 0) return;

    // 检测分隔符：tab > 逗号 > 连续空白
    var sep = "\t";
    if (text.indexOf("\t") === -1) {
      if (text.indexOf(",") !== -1) {
        sep = ",";
      } else {
        sep = /\s{2,}/;
      }
    }

    var firstParts = splitLine(lines[0], sep);

    // 判断第一行是否为表头：
    // 纬度列（第1列）必须是数字，若不是 → 视为表头
    function isCoordLike(v) {
      v = (v || "").trim();
      if (v === "") return false;
      return !isNaN(Number(v));
    }

    var startIdx = 0;
    var headerNames = null; // 第四列起的字段名（第三列固定为 Name）

    if (!isCoordLike(firstParts[0])) {
      // 第一行是表头，第四列起为额外字段名（第三列是 Name，跳过）
      headerNames = firstParts
        .slice(3)
        .map(function (h) {
          return h.trim();
        })
        .filter(function (h) {
          return h;
        });
      startIdx = 1;
    }

    // 重建 pointDropCols（额外字段从第四列起）
    if (headerNames && headerNames.length > 0) {
      pointDropCols = headerNames.slice();
    } else {
      // 无表头：根据数据列数生成默认字段名（减去前3列：纬度、经度、Name）
      var sampleParts = splitLine(lines[startIdx], sep);
      var extraCount = Math.max(0, sampleParts.length - 3);
      pointDropCols = [];
      for (var gi = 0; gi < extraCount; gi++) {
        pointDropCols.push("字段" + (gi + 1));
      }
    }

    // 解析数据行
    var newData = [];
    for (var i = startIdx; i < lines.length; i++) {
      var parts = splitLine(lines[i], sep);
      if (parts.length < 2) continue;
      var row = {
        lat: (parts[0] || "").trim(),
        lng: (parts[1] || "").trim(),
        Name: (parts[2] || "").trim(),
      };
      for (var ci = 0; ci < pointDropCols.length; ci++) {
        var val = parts[ci + 3];
        if (val !== undefined) row[pointDropCols[ci]] = val.trim();
      }
      newData.push(row);
    }

    if (newData.length > 0) {
      pointDropData = newData;
      renderTable();
      var info = "已解析 " + newData.length + " 行（前两列：纬度、经度）";
      if (headerNames && headerNames.length > 0) {
        info += "\n字段：「" + headerNames.join(" | ") + "」";
      }
      area.value = info + "\n可编辑后点击「生成图层」";
    }
  }

  function splitLine(line, sep) {
    if (typeof sep === "string") return line.split(sep);
    return line
      .trim()
      .split(sep)
      .filter(function (s) {
        return s;
      });
  }

  // ========== 表格操作 ==========
  window.__pdChange = function (rowIdx, field, value) {
    if (!pointDropData[rowIdx]) pointDropData[rowIdx] = {};
    pointDropData[rowIdx][field] = value;
  };

  window.__pdDelCol = function (colIdx) {
    var colName = pointDropCols[colIdx];
    pointDropCols.splice(colIdx, 1);
    // 清理数据
    for (var i = 0; i < pointDropData.length; i++) {
      delete pointDropData[i][colName];
    }
    renderTable();
  };

  window.__pdRenameCol = function (colIdx, newName) {
    newName = (newName || "").trim();
    if (!newName) return;
    var oldName = pointDropCols[colIdx];
    if (oldName === newName) return;
    // 更新所有数据行中的字段名
    for (var i = 0; i < pointDropData.length; i++) {
      if (oldName in pointDropData[i]) {
        pointDropData[i][newName] = pointDropData[i][oldName];
        delete pointDropData[i][oldName];
      }
    }
    pointDropCols[colIdx] = newName;
  };

  function addTableRow() {
    pointDropData.push({ lat: "", lng: "", Name: "" });
    renderTable();
  }

  function addTableColumn() {
    var name = prompt("请输入字段名称：", "字段" + (pointDropCols.length + 1));
    if (!name) return;
    pointDropCols.push(name);
    renderTable();
  }

  function clearTable() {
    pointDropData = [{ lat: "", lng: "", Name: "" }];
    pointDropCols = [];
    var area = document.getElementById("pdPasteArea");
    if (area) area.value = "";
    renderTable();
  }

  // ========== 生成图层 ==========
  function generateLayer() {
    var valid = pointDropData.filter(function (r) {
      var lat = Number(r.lat);
      var lng = Number(r.lng);
      return (
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
      );
    });

    if (valid.length === 0) {
      alert("没有有效的经纬度数据！\n请检查纬度和经度列是否已正确填写。");
      return;
    }

    // 构建 GeoJSON
    var features = valid.map(function (r) {
      var props = {};
      // 固定字段
      if (r.Name) props["Name"] = r.Name;
      // 额外字段
      for (var ki = 0; ki < pointDropCols.length; ki++) {
        var k = pointDropCols[ki];
        if (r[k] !== undefined && r[k] !== "") props[k] = r[k];
      }
      return {
        type: "Feature",
        properties: props,
        geometry: {
          type: "Point",
          coordinates: [Number(r.lng), Number(r.lat)],
        },
      };
    });

    var geojson = {
      type: "FeatureCollection",
      features: features,
    };

    var layerName = "投点图层_" + new Date().toLocaleTimeString("zh-CN");
    if (typeof window.addUserLayer === "function") {
      window.addUserLayer(geojson, layerName, true);
      // 收起表格
      var area = document.getElementById("pdPasteArea");
      if (area)
        area.value =
          "已生成图层「" + layerName + "」，共 " + valid.length + " 个点";
      setTimeout(function () {
        if (pointDropTable) pointDropTable.style.display = "none";
      }, 800);
    } else {
      alert("图层加载器尚未就绪，请稍后再试。");
    }
  }

  // ========== HTML 转义工具 ==========
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeJs(s) {
    // 用于 JS 字符串字面量
    return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  // ========== 剪贴板自动识别开关 ==========
  // 受地图设置中「自动识别剪贴板」开关控制，默认打开
  function isClipboardAutoEnabled() {
    var cb = document.getElementById("clipboardToggle");
    return !cb || cb.checked; // 元素不存在时默认启用
  }

  // ========== 全局粘贴监听 + 切页自动读取剪贴板 ==========
  var _lastClipText = ""; // 避免重复读取同一段内容

  // Ctrl+V 粘贴（焦点不在输入框时自动解析）
  document.addEventListener("paste", function (e) {
    if (!isClipboardAutoEnabled()) return;
    var tag = ((e.target && e.target.tagName) || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable)
      return;

    var text = (e.clipboardData || window.clipboardData).getData("text/plain");
    if (!text || !text.trim()) return;
    text = text.trim();
    if (!/\d/.test(text)) return;
    if (text === _lastClipText) return; // 和上次一样，跳过

    e.preventDefault();
    _lastClipText = text;
    autoPasteAndParse(text);
  });

  // 切回页面时主动读取剪贴板（visibilitychange + focus）
  function tryReadClipboard() {
    if (!isClipboardAutoEnabled()) return;
    if (
      typeof navigator.clipboard !== "object" ||
      typeof navigator.clipboard.readText !== "function"
    )
      return;
    navigator.clipboard
      .readText()
      .then(function (text) {
        if (!text || !text.trim()) return;
        text = text.trim();
        if (text === _lastClipText) return; // 和上次一样，跳过
        if (!/\d/.test(text)) return;
        _lastClipText = text;
        autoPasteAndParse(text);
      })
      .catch(function () {
        // 权限拒绝或不可用，静默忽略
      });
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(tryReadClipboard, 300);
  });
  window.addEventListener("focus", function () {
    setTimeout(tryReadClipboard, 300);
  });

  function autoPasteAndParse(text) {
    // 确保投点编辑器已创建并显示
    if (!pointDropTable) createPointDropTable();
    if (pointDropTable) pointDropTable.style.display = "";

    // 展开侧边栏并滚动到投点编辑器
    var layerPanel = document.getElementById("layerPanel");
    if (layerPanel) {
      layerPanel.classList.add("active");
      setTimeout(function () {
        pointDropTable &&
          pointDropTable.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
      }, 120);
    }

    // 填充到粘贴框并触发解析
    var area = document.getElementById("pdPasteArea");
    if (area) {
      area.value = text;
      onPasteInput();
    }

    // 成功提示（使用 dialog.js 的全局 showToast）
    window.showToast("已识别剪贴板坐标数据，投点编辑器已打开");
  }

  // ========== 初始化：等 DOM Ready 后找锚点 ==========
  function setupHook() {
    var anchor = document.getElementById("pointDropAnchor");
    if (anchor) {
      initPointDropUI();
    } else {
      // geojsonloader.js 还未执行完，稍等
      setTimeout(setupHook, 100);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupHook);
  } else {
    setupHook();
  }
})();
