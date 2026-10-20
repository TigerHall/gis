/**
 * pointdrop.js — 投点功能（独立模块）
 * 依赖：window.addUserLayer（由 geojsonloader.js 挂载）
 *       pointdrop.css（样式）
 * 在 geojsonloader.js 之后加载
 *
 * 功能：
 *   · 坐标投点：粘贴 CSV/TSV/Excel → 表格编辑 → 生成点图层
 *   · 点集转线 / 转面：按「分组字段」把点分成若干条线 / 若干个面，
 *     组内按「排序字段」（含「# 表格行序」）排序，可选闭合线；
 *     一次只产出一个图层，图层里可以有多条线 / 多个面。
 */
(function () {
  "use strict";

  // ========== 状态 ==========
  var pointDropData = []; // [{lat, lng, Name, ...extra}]
  var pointDropCols = []; // 额外字段名（不含固定三列）
  var pointDropTable = null; // DOM 容器
  var _conv = null; // 点集转线/转面的控件引用

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

    // 点集 → 线 / 面（折叠区：默认收起，免得把 240px 宽的侧栏撑得老长）
    pointDropTable.appendChild(buildConvertPanel());

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

    // 字段可能变了（粘贴 / 改名 / 加删字段）→ 同步转线转面的下拉选项
    refreshConvOptions();
  }

  // ========== 点集 → 线 / 面 ==========
  // 设计要点（用户需求）：
  //   · 分组字段 = 「哪些点属于同一条线 / 同一个面」（可多选，按组合值分区）；
  //   · 排序字段 = 「点在这条线上的先后顺序」，也允许直接用「# 表格行序」；
  //   · 闭合线勾选 → 首尾相接（面本身必须闭合，自动补）；
  //   · 一次只生成 **一个** 图层，图层里可以有多条线 / 多个面。
  function buildConvertPanel() {
    var box = document.createElement("details");
    box.className = "pd-conv";

    var sum = document.createElement("summary");
    sum.className = "pd-conv-sum";
    sum.textContent = "🔗 点集转线 / 转面";
    sum.title = "按字段分组把点连成线或面，一次生成一个图层（可含多条线/多个面）";
    box.appendChild(sum);

    var body = document.createElement("div");
    body.className = "pd-conv-body";

    // ① 分组字段（多选）
    var rowG = document.createElement("div");
    rowG.className = "pd-conv-row";
    var lbG = document.createElement("span");
    lbG.className = "pd-conv-lb";
    lbG.textContent = "分组";
    var groupSel = document.createElement("select");
    groupSel.id = "pdConvGroup";
    groupSel.className = "pd-conv-sel";
    groupSel.multiple = true;
    groupSel.size = 3;
    groupSel.title =
      "区分不同线 / 面的字段（可多选，按组合值分组）。不选 = 所有点连成一条线 / 一个面";
    rowG.appendChild(lbG);
    rowG.appendChild(groupSel);
    body.appendChild(rowG);

    // ② 排序字段 + 降序
    var rowO = document.createElement("div");
    rowO.className = "pd-conv-row";
    var lbO = document.createElement("span");
    lbO.className = "pd-conv-lb";
    lbO.textContent = "排序";
    var orderSel = document.createElement("select");
    orderSel.id = "pdConvOrder";
    orderSel.className = "pd-conv-sel";
    orderSel.title = "决定点连成线 / 面的先后顺序。默认按表格行序（#），也可选任意字段";
    var chkDesc = document.createElement("input");
    chkDesc.type = "checkbox";
    chkDesc.id = "pdConvDesc";
    var lbDesc = document.createElement("label");
    lbDesc.className = "pd-conv-chk";
    lbDesc.htmlFor = "pdConvDesc";
    lbDesc.appendChild(chkDesc);
    lbDesc.appendChild(document.createTextNode("降序"));
    rowO.appendChild(lbO);
    rowO.appendChild(orderSel);
    rowO.appendChild(lbDesc);
    body.appendChild(rowO);

    // ③ 闭合线
    var rowC = document.createElement("div");
    rowC.className = "pd-conv-row";
    var chkClose = document.createElement("input");
    chkClose.type = "checkbox";
    chkClose.id = "pdConvClose";
    var lbClose = document.createElement("label");
    lbClose.className = "pd-conv-chk";
    lbClose.htmlFor = "pdConvClose";
    lbClose.appendChild(chkClose);
    lbClose.appendChild(document.createTextNode("闭合线"));
    lbClose.title = "首尾相接（转线有效；转面本身就必须闭合，自动补）";
    var hint = document.createElement("span");
    hint.className = "pd-conv-hint";
    hint.textContent = "面自动闭合";
    rowC.appendChild(lbClose);
    rowC.appendChild(hint);
    body.appendChild(rowC);

    // ④ 两个动作按钮
    var rowB = document.createElement("div");
    rowB.className = "pd-conv-row pd-conv-btns";
    var bLine = document.createElement("button");
    bLine.type = "button";
    bLine.className = "pd-action-btn";
    bLine.textContent = "➡ 转线";
    bLine.title = "每组点连成一条 LineString（≥2 点）";
    var bPoly = document.createElement("button");
    bPoly.type = "button";
    bPoly.className = "pd-action-btn";
    bPoly.textContent = "△ 转面";
    bPoly.title = "每组点围成一个 Polygon（≥3 点，自动闭合）";
    rowB.appendChild(bLine);
    rowB.appendChild(bPoly);
    body.appendChild(rowB);

    // 一句话说明两个下拉到底在管什么（不能全靠 title，触屏没有 hover）
    var note = document.createElement("div");
    note.className = "pd-conv-note";
    note.textContent = "分组：区分不同线/面（可多选）· 排序：组内点的先后";
    body.appendChild(note);

    box.appendChild(body);

    _conv = {
      root: box,
      groupSel: groupSel,
      orderSel: orderSel,
      desc: chkDesc,
      closeRing: chkClose,
    };

    bLine.onclick = function () {
      convertPoints("line");
    };
    bPoly.onclick = function () {
      convertPoints("polygon");
    };

    return box;
  }

  /** 可当作分组 / 排序依据的字段（Name + 所有额外字段，去重去空） */
  function convFieldList() {
    var out = [];
    var seen = {};
    var arr = ["Name"].concat(pointDropCols);
    for (var i = 0; i < arr.length; i++) {
      var f = String(arr[i] == null ? "" : arr[i]).trim();
      if (!f || seen[f]) continue;
      seen[f] = 1;
      out.push(f);
    }
    return out;
  }

  /** 重建下拉选项；保留用户已选中的字段（渲染表格时会被反复调用） */
  function refreshConvOptions() {
    if (!_conv) return;
    var fields = convFieldList();

    // 分组（多选）
    var keepG = {};
    var gi;
    for (gi = 0; gi < _conv.groupSel.options.length; gi++) {
      var og = _conv.groupSel.options[gi];
      if (og.selected) keepG[og.value] = 1;
    }
    _conv.groupSel.innerHTML = "";
    for (gi = 0; gi < fields.length; gi++) {
      var o = document.createElement("option");
      o.value = fields[gi];
      o.textContent = fields[gi];
      o.selected = !!keepG[fields[gi]];
      _conv.groupSel.appendChild(o);
    }
    _conv.groupSel.disabled = fields.length === 0;

    // 排序（单选；"" = 表格行序）
    var keepO = _conv.orderSel.value;
    _conv.orderSel.innerHTML = "";
    var oSeq = document.createElement("option");
    oSeq.value = "";
    oSeq.textContent = "# 表格行序";
    _conv.orderSel.appendChild(oSeq);
    for (gi = 0; gi < fields.length; gi++) {
      var oo = document.createElement("option");
      oo.value = fields[gi];
      oo.textContent = fields[gi];
      _conv.orderSel.appendChild(oo);
    }
    var ok = false;
    for (gi = 0; gi < _conv.orderSel.options.length; gi++) {
      if (_conv.orderSel.options[gi].value === keepO) {
        ok = true;
        break;
      }
    }
    _conv.orderSel.value = ok ? keepO : "";
  }

  /** 取出表格里经纬度合法的行（带行号 n 与展开后的属性） */
  function collectValidRows() {
    var out = [];
    for (var i = 0; i < pointDropData.length; i++) {
      var r = pointDropData[i] || {};
      var lat = Number(r.lat);
      var lng = Number(r.lng);
      if (!isFinite(lat) || !isFinite(lng)) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      if (String(r.lat).trim() === "" || String(r.lng).trim() === "") continue;

      var props = {};
      if (r.Name) props["Name"] = r.Name;
      for (var k = 0; k < pointDropCols.length; k++) {
        var key = pointDropCols[k];
        if (r[key] !== undefined && r[key] !== "") props[key] = r[key];
      }
      out.push({ lat: lat, lng: lng, props: props, n: i });
    }
    return out;
  }

  function _rad(d) {
    return (d * Math.PI) / 180;
  }
  /** 折线长度（km，球面 haversine 累加） */
  function lineKm(coords) {
    var R = 6371.0088;
    var sum = 0;
    for (var i = 1; i < coords.length; i++) {
      var a = coords[i - 1];
      var b = coords[i];
      var dLat = _rad(b[1] - a[1]);
      var dLng = _rad(b[0] - a[0]);
      var h =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(_rad(a[1])) *
          Math.cos(_rad(b[1])) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      sum += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    return sum;
  }
  /** 球面多边形面积（km²，与 index.html 的 calculatePolygonArea 同一算法，单位换成 km） */
  function areaKm2(coords) {
    if (coords.length < 3) return 0;
    var R = 6371.0088;
    var sum = 0;
    for (var i = 0; i < coords.length; i++) {
      var j = (i + 1) % coords.length;
      var lng1 = _rad(coords[i][0]);
      var lng2 = _rad(coords[j][0]);
      var lat1 = _rad(coords[i][1]);
      var lat2 = _rad(coords[j][1]);
      sum += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return (Math.abs(sum) * R * R) / 2;
  }

  /** 点集 → 线 / 面：一次生成一个图层，里面可以有多条线 / 多个面 */
  function convertPoints(mode) {
    var isPoly = mode === "polygon";
    var rows = collectValidRows();
    if (rows.length === 0) {
      alert("没有有效的经纬度数据！\n请先填写或粘贴纬度和经度。");
      return;
    }

    // 读选项
    var groupFields = [];
    var orderField = "";
    var desc = false;
    var closeRing = false;
    if (_conv) {
      for (var i = 0; i < _conv.groupSel.options.length; i++) {
        if (_conv.groupSel.options[i].selected) {
          groupFields.push(_conv.groupSel.options[i].value);
        }
      }
      orderField = _conv.orderSel.value || "";
      desc = !!_conv.desc.checked;
      closeRing = !!_conv.closeRing.checked;
    }

    // ① 分组：组合值相同的点归为同一条线 / 同一个面
    var buckets = {};
    var order = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      var key = "__all__";
      if (groupFields.length) {
        var parts = [];
        for (var gi = 0; gi < groupFields.length; gi++) {
          var v = row.props[groupFields[gi]];
          parts.push(v === undefined || v === null ? "" : String(v));
        }
        key = parts.join("\u0001");
      }
      if (!buckets[key]) {
        buckets[key] = [];
        order.push(key);
      }
      buckets[key].push(row);
    }

    // ② 组内排序（数字按数值比，其它按自然序：A2 < A10）
    function cmp(a, b) {
      if (orderField) {
        var va = a.props[orderField];
        var vb = b.props[orderField];
        var sa = va === undefined || va === null ? "" : String(va);
        var sb = vb === undefined || vb === null ? "" : String(vb);
        var na = Number(sa);
        var nb = Number(sb);
        var num =
          sa !== "" && sb !== "" && isFinite(na) && isFinite(nb);
        var r = num
          ? na - nb
          : sa.localeCompare(sb, "zh-Hans-CN", { numeric: true });
        return desc ? -r : r;
      }
      return desc ? b.n - a.n : a.n - b.n;
    }

    // ③ 输出要素
    var features = [];
    var skipped = 0;
    var minPts = isPoly ? 3 : 2;
    for (var bi = 0; bi < order.length; bi++) {
      var grp = buckets[order[bi]].slice().sort(cmp);
      if (grp.length < minPts) {
        skipped++;
        continue;
      }
      var coords = [];
      for (var ci = 0; ci < grp.length; ci++) {
        coords.push([grp[ci].lng, grp[ci].lat]);
      }
      var first = coords[0];
      var last = coords[coords.length - 1];
      var isClosed = first[0] === last[0] && first[1] === last[1];

      var props = {};
      var labelParts = [];
      for (var fi = 0; fi < groupFields.length; fi++) {
        var gf = groupFields[fi];
        var gv = grp[0].props[gf];
        gv = gv === undefined || gv === null ? "" : gv;
        props[gf] = gv;
        labelParts.push(gv === "" ? "(空)" : String(gv));
      }
      // Name 用分组值当标签，图层列表 / 弹窗标题才有意义；分组字段里已含 Name 时不覆盖
      if (!props["Name"]) {
        props["Name"] =
          labelParts.length > 0
            ? labelParts.join(" / ")
            : (isPoly ? "面" : "线") + (features.length + 1);
      }
      props["点数"] = grp.length;

      if (isPoly) {
        if (!isClosed) coords.push([first[0], first[1]]); // 面必须闭合
        props["面积_km²"] = Math.round(areaKm2(coords) * 10000) / 10000;
        features.push({
          type: "Feature",
          properties: props,
          geometry: { type: "Polygon", coordinates: [coords] },
        });
      } else {
        if (closeRing && !isClosed) coords.push([first[0], first[1]]);
        props["长度_km"] = Math.round(lineKm(coords) * 1000) / 1000;
        features.push({
          type: "Feature",
          properties: props,
          geometry: { type: "LineString", coordinates: coords },
        });
      }
    }

    if (features.length === 0) {
      alert(
        "没有可生成的" +
          (isPoly ? "面" : "线") +
          "。\n" +
          (isPoly ? "每个面至少需要 3 个点" : "每条线至少需要 2 个点") +
          (groupFields.length ? "（当前分组下每组点数不足）" : "") +
          "。",
      );
      return;
    }

    var geojson = { type: "FeatureCollection", features: features };
    var layerName =
      (isPoly ? "点集转面_" : "点集转线_") +
      new Date().toLocaleTimeString("zh-CN");
    if (typeof window.addUserLayer !== "function") {
      alert("图层加载器尚未就绪，请稍后再试。");
      return;
    }
    window.addUserLayer(geojson, layerName, true);

    var msg =
      "已生成「" +
      layerName +
      "」：" +
      features.length +
      " 个" +
      (isPoly ? "面" : "线");
    if (skipped) msg += "（跳过 " + skipped + " 组点数不足）";
    if (typeof window.showToast === "function") {
      window.showToast(msg, { duration: 3000 });
    }
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

    // ⚠️ 先把数据行切出来，**确认真的有数据**再改 pointDropCols。
    // 顺序反了会踩坑：本函数在 textarea 的每次 input 都跑，而解析完又把
    // 提示文字回写进同一个 textarea —— 用户接着敲一个字，就会拿提示文字
    // 再解析一遍，把 pointDropCols 清空（数据行还在、字段却全丢）。
    var rawRows = [];
    var ri;
    for (ri = startIdx; ri < lines.length; ri++) {
      var parts = splitLine(lines[ri], sep);
      if (parts.length < 2) continue;
      rawRows.push(parts);
    }
    if (rawRows.length === 0) return; // 没有数据行 → 保持原状，什么都不改

    // 重建 pointDropCols（额外字段从第四列起）
    if (headerNames && headerNames.length > 0) {
      pointDropCols = headerNames.slice();
    } else {
      // 无表头：根据数据列数生成默认字段名（减去前3列：纬度、经度、Name）
      var extraCount = Math.max(0, rawRows[0].length - 3);
      pointDropCols = [];
      for (var gi = 0; gi < extraCount; gi++) {
        pointDropCols.push("字段" + (gi + 1));
      }
    }

    // 用已切好的 rawRows 组装数据行（同一份 parts，避免重复 split）
    var newData = [];
    for (var i = 0; i < rawRows.length; i++) {
      var parts = rawRows[i];
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

    pointDropData = newData;
    renderTable();
    var info = "已解析 " + newData.length + " 行（前两列：纬度、经度）";
    if (headerNames && headerNames.length > 0) {
      info += "\n字段：「" + headerNames.join(" | ") + "」";
    }
    area.value = info + "\n可编辑后点击「生成图层」";
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
    var valid = collectValidRows();

    if (valid.length === 0) {
      alert("没有有效的经纬度数据！\n请检查纬度和经度列是否已正确填写。");
      return;
    }

    // 构建 GeoJSON
    var features = valid.map(function (r) {
      return {
        type: "Feature",
        properties: r.props,
        geometry: {
          type: "Point",
          coordinates: [r.lng, r.lat],
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
