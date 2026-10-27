/**
 * map-export-ui.js —— 悬浮出图「中台」
 *
 * 设计取舍（第一期，经实测后定）：
 *  · 非模态浮层：可以边调参数边看地图，所见即所得
 *  · 预览走缩略图（默认 420px 宽），改参数后自动重渲染（防抖）
 *  · **尺寸改用「纸面 mm + dpi」，不再让用户填像素** —— 实测坑见 map-export.js：
 *    直接填 px 只是把瓦片拉伸放大，清晰度不升；真正决定地面分辨率的是 zoom。
 *  · 选项刻意保持少：出图是严肃用途（论文/汇报），默认参数就该对，
 *    不像 QGIS 那样堆几十个旋钮。
 *  · 比例尺 / 指北针 / 版权署名**默认关闭**（实证反馈：科研出图常自己加）
 *  · PDF 走浏览器「打印 → 另存为 PDF」，成本低且矢量保真
 *
 * 依赖：map-export.js（window.MapExport）、dialog.js（showToast）
 */
(function () {
  "use strict";

  var EXPORT = window.MapExport;
  if (!EXPORT) {
    console.warn("[MapExportUI] MapExport 未就绪，跳过");
    return;
  }

  var S = window.OGVStorage;

  // ========== 纸面预设（mm，宽×高；高度按当前地图宽高比自动算） ==========
  var PRESETS = [
    { id: "a4w", label: "A4 横版", wmm: 297, hmm: 210 },
    { id: "col1", label: "单栏", wmm: 85, hmm: null },
    { id: "col2", label: "双栏", wmm: 170, hmm: null },
    { id: "full", label: "整页", wmm: 210, hmm: 297 },
    { id: "custom", label: "自定义", wmm: null, hmm: null },
  ];
  // dpi 档位：96 屏显参考、150 草稿、**300 = 印刷/论文默认**、600 高精、1200 出版级
  // （除了这几个档，面板上还有一个「自定义 dpi」输入框，30~2400 任意值）
  var DPIS = [96, 150, 300, 600, 1200];

  var DEFAULTS = {
    preset: "col2",
    // ── 图面模板（2026-10-27）──
    // 模板只决定「图面语言」（指北针/图例/格网/图框 + 几个开关的初值），
    // 之后手改任何一项就自动变 "custom"。真正的取值表在 map-export.js TEMPLATES。
    template: "paper",
    northArrowStyle: "classic",
    legendStyle: "card",
    graticuleStyle: "solid",
    frameStyle: "double",
    paperWidthMm: 170,
    paperHeightMm: 0, // 0 = 按地图宽高比自动
    dpi: 300, // 默认 300：150 打出来字和图例都发虚，论文/汇报基本都要 300 起
    keepAspect: true, // 高度跟随地图宽高比
    includeBase: true,
    includeVectors: true,
    includeOverlays: true,
    baseOpacity: 1,
    vectorOpacity: 1,
    legend: true,
    legendTitle: "",
    labels: true, // 要素标签（与屏幕上显示的一致）
    scaleBar: false, // 默认关
    northArrow: false, // 默认关
    // 图框 + 刻度：论文图的骨架，默认开（关掉就和屏幕截图没区别了）
    frame: true,
    frameLabels: "all", // 经纬度标注位置：all 四边 / lb 左+下 / none 不标
    figureLabel: "", // 图注编号，如 (a)
    attribution: false, // 默认关
    graticule: true, // 经纬网 + 经纬度标注（保留经纬度信息）
    title: "",
    subtitle: "",
    format: "png",
    quality: 0.92,
    background: "#ffffff",
  };

  var state = Object.assign({}, DEFAULTS);
  var el = null;
  var previewTimer = null;
  var rendering = false;
  var pendingRender = false;
  var pendingSilent = false; // 排队中的那次是否静默（跟 pendingRender 配对）
  var fullBusy = false; // 正在出正式图 / 打印：预览让路，别抢 canvas 内存
  var STATE_VERSION = 2; // 存储结构版本（用于把老的 150dpi 一次性迁到 300）

  // ========== 构建 DOM ==========
  function buildUI() {
    if (el) return el;
    var root = document.createElement("section");
    root.id = "mapExportPanel";
    root.className = "map-export-panel";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "出图设置");
    root.hidden = true;
    root.innerHTML = [
      '<header class="mep-head">',
      '  <div class="mep-title">🖼️ 出图<span class="mep-beta">测试中</span></div>',
      '  <button type="button" class="mep-close" title="关闭 (Esc)" aria-label="关闭">✕</button>',
      "</header>",

      '<div class="mep-preview">',
      '  <div class="mep-preview-box">',
      '    <canvas class="mep-preview-canvas"></canvas>',
      '    <div class="mep-preview-mask"><span>渲染中…</span></div>',
      '  </div>',
      '  <div class="mep-preview-meta">—</div>',
      "</div>",

      '<div class="mep-body">',

      // —— 模板：一整套图面语言，选完还能逐项微调 ——
      '<section class="mep-sec">',
      '  <div class="mep-sec-title">模板</div>',
      '  <div class="mep-tpls" role="group" aria-label="图面模板"></div>',
      '  <div class="mep-row">',
      '    <label class="mep-lbl">指北针</label>',
      '    <select class="mep-sel" data-k="northArrowStyle" aria-label="指北针样式">',
      '      <option value="classic">双环指针（论文）</option>',
      '      <option value="compact">细箭头（汇报）</option>',
      '      <option value="compass">罗盘玫瑰（报告）</option>',
      '      <option value="cross">十字准星（野外）</option>',
      "    </select>",
      "  </div>",
      '  <div class="mep-row">',
      '    <label class="mep-lbl">图例</label>',
      '    <select class="mep-sel" data-k="legendStyle" aria-label="图例样式">',
      '      <option value="card">白底细框</option>',
      '      <option value="plain">无底（带描边）</option>',
      '      <option value="swatch">色条式</option>',
      "    </select>",
      "  </div>",
      '  <div class="mep-row">',
      '    <label class="mep-lbl">格网</label>',
      '    <select class="mep-sel" data-k="graticuleStyle" aria-label="格网样式">',
      '      <option value="solid">实线</option>',
      '      <option value="dashed">虚线</option>',
      '      <option value="dotted">点线</option>',
      '      <option value="none">不画线（只留刻度）</option>',
      "    </select>",
      "  </div>",
      '  <div class="mep-row">',
      '    <label class="mep-lbl">图框</label>',
      '    <select class="mep-sel" data-k="frameStyle" aria-label="图框样式">',
      '      <option value="double">双线（外粗内细）</option>',
      '      <option value="single">单线</option>',
      "    </select>",
      "  </div>",
      '  <div class="mep-hint mep-tpl"></div>',
      "</section>",

      // —— 尺寸：纸面 + dpi ——
      '<section class="mep-sec">',
      '  <div class="mep-sec-title">尺寸</div>',
      '  <div class="mep-presets" role="group" aria-label="纸面预设"></div>',
      '  <div class="mep-row">',
      '    <label class="mep-lbl">纸宽 mm</label>',
      '    <input type="number" class="mep-num" data-k="paperWidthMm" min="10" max="1000" step="1">',
      "  </div>",
      '  <div class="mep-row">',
      '    <label class="mep-lbl">纸高 mm</label>',
      '    <input type="number" class="mep-num" data-k="paperHeightMm" min="0" max="1000" step="1">',
      '    <span class="mep-as-hint">0=按地图比例</span>',
      "  </div>",
      '  <label class="mep-chk"><input type="checkbox" data-k="keepAspect"><span>纸高跟随地图宽高比</span></label>',
      '  <div class="mep-row">',
      '    <label class="mep-lbl">分辨率 dpi</label>',
      '    <div class="mep-dpi-group" role="group" aria-label="dpi 快捷档位"></div>',
      "  </div>",
      '  <div class="mep-row">',
      '    <label class="mep-lbl">自定义 dpi</label>',
      '    <input type="number" class="mep-num" data-k="dpi" min="30" max="2400" step="10"',
      '      aria-label="自定义 dpi（30~2400）">',
      '    <span class="mep-as-hint">30~2400</span>',
      "  </div>",
      '  <div class="mep-hint mep-dpi"></div>',
      "</section>",

      // —— 内容 ——
      '<section class="mep-sec">',
      '  <div class="mep-sec-title">内容</div>',
      '  <label class="mep-chk"><input type="checkbox" data-k="includeBase"><span>底图</span></label>',
      '  <div class="mep-row mep-row-indent">',
      '    <label class="mep-lbl">不透明度</label>',
      '    <input type="range" class="mep-range" data-k="baseOpacity" min="0" max="1" step="0.05">',
      '    <span class="mep-val" data-v="baseOpacity"></span>',
      "  </div>",
      '  <label class="mep-chk"><input type="checkbox" data-k="includeVectors"><span>矢量要素</span></label>',
      '  <div class="mep-row mep-row-indent">',
      '    <label class="mep-lbl">不透明度</label>',
      '    <input type="range" class="mep-range" data-k="vectorOpacity" min="0" max="1" step="0.05">',
      '    <span class="mep-val" data-v="vectorOpacity"></span>',
      "  </div>",
      '  <label class="mep-chk"><input type="checkbox" data-k="includeOverlays"><span>覆盖层（境界线 / 地名标注）</span></label>',
      '  <label class="mep-chk"><input type="checkbox" data-k="legend"><span>图例</span></label>',
      '  <label class="mep-chk"><input type="checkbox" data-k="labels"><span>要素标签</span></label>',
      "</section>",

      // —— 图面装饰（论文样式的图框默认开）——
      '<section class="mep-sec">',
      '  <div class="mep-sec-title">图面装饰</div>',
      '  <label class="mep-chk"><input type="checkbox" data-k="frame"><span>图框 + 刻度（论文样式）</span></label>',
      '  <div class="mep-row mep-row-indent">',
      '    <label class="mep-lbl">经纬度标注</label>',
      '    <select class="mep-sel" data-k="frameLabels">',
      '      <option value="all">四边</option>',
      '      <option value="lb">左 + 下</option>',
      '      <option value="none">不标</option>',
      "    </select>",
      "  </div>",
      '  <label class="mep-chk"><input type="checkbox" data-k="graticule"><span>经纬网线</span></label>',
      '  <label class="mep-chk"><input type="checkbox" data-k="scaleBar"><span>比例尺</span></label>',
      '  <label class="mep-chk"><input type="checkbox" data-k="northArrow"><span>指北针</span></label>',
      '  <label class="mep-chk"><input type="checkbox" data-k="attribution"><span>版权署名</span></label>',
      '  <div class="mep-note">底图数据来自天地图 / ArcGIS / GEBCO 等服务；',
      "    若用于公开发表，建议勾选或在图注标注来源。</div>",
      "</section>",

      // —— 标题 / 输出 ——
      '<section class="mep-sec">',
      '  <div class="mep-sec-title">标题与输出</div>',
      '  <div class="mep-row">',
      '    <label class="mep-lbl">图标题</label>',
      '    <input type="text" class="mep-txt" data-k="title" placeholder="选填，如 Figure 1">',
      "  </div>",
      '  <div class="mep-row">',
      '    <label class="mep-lbl">副标题</label>',
      '    <input type="text" class="mep-txt" data-k="subtitle" placeholder="选填">',
      "  </div>",
      '  <div class="mep-row">',
      '    <label class="mep-lbl">图注编号</label>',
      '    <input type="text" class="mep-txt" data-k="figureLabel" placeholder="选填，如 (a)">',
      "  </div>",
      '  <div class="mep-row">',
      '    <label class="mep-lbl">背景</label>',
      '    <select class="mep-sel" data-k="background">',
      '      <option value="#ffffff">白色</option>',
      '      <option value="transparent">透明（仅 PNG）</option>',
      '      <option value="#000000">黑色</option>',
      "    </select>",
      "  </div>",
      '  <div class="mep-row">',
      '    <label class="mep-lbl">格式</label>',
      '    <select class="mep-sel" data-k="format">',
      '      <option value="png">PNG（无损）</option>',
      '      <option value="jpeg">JPEG（体积小）</option>',
      "    </select>",
      "  </div>",
      "</section>",

      "</div>",

      '<footer class="mep-foot">',
      '  <div class="mep-warn"></div>',
      '  <div class="mep-actions">',
      '    <button type="button" class="mep-btn mep-btn-ghost" data-act="reset">恢复默认</button>',
      '    <button type="button" class="mep-btn mep-btn-ghost" data-act="snapshot" title="所见即所得的屏幕截图（原导出方式）">截图导出</button>',
      '    <button type="button" class="mep-btn mep-btn-print" data-act="print">打印 / PDF</button>',
      '    <button type="button" class="mep-btn mep-btn-primary" data-act="download">下载图片</button>',
      "  </div>",
      "</footer>",
    ].join("");

    document.body.appendChild(root);

    // 纸面预设
    var presetBox = root.querySelector(".mep-presets");
    PRESETS.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mep-preset";
      b.dataset.preset = p.id;
      b.textContent = p.label;
      b.addEventListener("click", function () {
        applyPreset(p.id);
      });
      presetBox.appendChild(b);
    });

    // dpi 按钮组
    var dpiBox = root.querySelector(".mep-dpi-group");
    DPIS.forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mep-dpi-btn";
      b.dataset.dpi = String(d);
      b.textContent = String(d);
      b.addEventListener("click", function () {
        state.dpi = d;
        syncInputs();
        renderPreview();
      });
      dpiBox.appendChild(b);
    });

    // 模板按钮（取值表来自 map-export.js，UI 不另存一份）
    var tplBox = root.querySelector(".mep-tpls");
    var TPLS = (window.MapExport && window.MapExport.TEMPLATES) || {};
    Object.keys(TPLS).forEach(function (id) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mep-preset mep-tplbtn";
      b.dataset.tpl = id;
      b.textContent = TPLS[id].label || id;
      b.title = "套用「" + (TPLS[id].label || id) + "」模板（之后仍可逐项微调）";
      b.addEventListener("click", function () {
        applyTemplate(id);
      });
      tplBox.appendChild(b);
    });
    var bCustom = document.createElement("button");
    bCustom.type = "button";
    bCustom.className = "mep-preset mep-tplbtn";
    bCustom.dataset.tpl = "custom";
    bCustom.textContent = "自定义";
    bCustom.title = "当前是手调组合（不套模板）";
    tplBox.appendChild(bCustom);

    // 绑定字段
    root.querySelectorAll("[data-k]").forEach(function (input) {
      var k = input.dataset.k;
      var ev = "change";
      if (input.type === "range" || input.type === "number" || input.type === "text") ev = "input";
      input.addEventListener(ev, function () {
        var v;
        if (input.type === "checkbox") v = input.checked;
        else if (input.type === "range" || input.type === "number") v = Number(input.value);
        else v = input.value;
        state[k] = v;
        // 手改了样式项 → 模板标记退出（「已套用的模板」不再成立，避免误导）
        if (/Style$/.test(k) && state.template !== "custom") {
          state.template = "custom";
          syncTemplateButtons();
        }
        // 尺寸类字段（纸宽/纸高/dpi）先把提示行刷新掉：数字是即时反馈，
        // 让用户等 420ms 的预览防抖才知道「1200dpi 到底出了多大」
        if (k === "dpi" || k === "paperWidthMm" || k === "paperHeightMm" || k === "keepAspect") {
          syncDpiButtons(); // 只刷档位高亮，别回写输入框（会打断正在输入的手感）
          updateHint();
        }
        schedulePreview();
      });
    });

    root.querySelector(".mep-close").addEventListener("click", close);
    root.querySelector('[data-act="reset"]').addEventListener("click", function () {
      state = Object.assign({}, DEFAULTS);
      applyPreset(state.preset);
    });
    root.querySelector('[data-act="download"]').addEventListener("click", doDownload);
    root.querySelector('[data-act="print"]').addEventListener("click", doPrint);
    // 截图导出：关掉出图面板，走旧的所见即所得截屏方案（app.js 里保留的 legacy 实现）
    root.querySelector('[data-act="snapshot"]').addEventListener("click", function () {
      close();
      if (typeof window._exportMapImageLegacy === "function") {
        window._exportMapImageLegacy();
      } else if (window.showToast) {
        window.showToast("❌ 截图导出不可用", { duration: 3000 });
      }
    });

    return root;
  }

  function syncInputs() {
    if (!el) return;
    el.querySelectorAll("[data-k]").forEach(function (input) {
      var k = input.dataset.k;
      var v = state[k];
      if (input.type === "checkbox") input.checked = !!v;
      else if (v == null) input.value = "";
      else input.value = v;
    });
    el.querySelectorAll(".mep-preset").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.preset === state.preset);
    });
    syncTemplateButtons();
    syncDpiButtons();
    updateValLabels();
    updateHint();
  }

  /** dpi 档位按钮高亮（自定义值不在档位里时全部熄灭） */
  function syncDpiButtons() {
    if (!el) return;
    el.querySelectorAll(".mep-dpi-btn").forEach(function (b) {
      b.classList.toggle("is-on", +b.dataset.dpi === Number(state.dpi));
    });
  }

  function updateValLabels() {
    if (!el) return;
    el.querySelectorAll("[data-v]").forEach(function (s) {
      s.textContent = Math.round((Number(state[s.dataset.v]) || 0) * 100) + "%";
    });
  }

  // ========== 尺寸换算：纸面 mm + dpi → 像素 ==========
  /**
   * 画布上限（浏览器硬约束，超过不是「慢」而是「直接空图/崩溃」）：
   *   · Chrome 单边 65535、总面积 2^28 ≈ 268M px；
   *   · Safari / iOS 更保守（面积上限低一个量级）。
   * 取「单边 16384 + 面积 160M」——刚好容得下 A4 横版 1200dpi（139M px），
   * 再大就按比例整体缩小（**保持宽高比**，两个方向乘同一个 s）。
   * ⚠️ 旧实现分别对宽、高做 `Math.min(6000, …)` 夹取 → 超出时宽高被压成
   *    不同比例，图会变形；且 1200dpi 一律被静默削到 6000px（等于没生效）。
   */
  var MAX_SIDE = 16384;
  var MAX_AREA = 160e6;

  function paperPx() {
    var map = window.map;
    var ratio = { x: 4, y: 3 };
    if (map) {
      var sz = map.getSize();
      ratio = { x: sz.x || 4, y: sz.y || 3 };
    }
    var dpi = Number(state.dpi) || 300;
    var wpx = Math.round((Number(state.paperWidthMm || 170) / 25.4) * dpi);
    var hpx;
    if (state.keepAspect || !Number(state.paperHeightMm)) {
      hpx = Math.round((wpx * ratio.y) / ratio.x);
    } else {
      hpx = Math.round((Number(state.paperHeightMm) / 25.4) * dpi);
    }
    wpx = Math.max(120, wpx);
    hpx = Math.max(90, hpx);

    // 等比缩放到画布上限之内（两个方向同一个 s）
    var s = Math.min(1, MAX_SIDE / wpx, MAX_SIDE / hpx);
    if (wpx * hpx * s * s > MAX_AREA) {
      s *= Math.sqrt(MAX_AREA / (wpx * hpx * s * s));
    }
    var clamped = s < 0.999;
    if (clamped) {
      wpx = Math.max(120, Math.floor(wpx * s));
      hpx = Math.max(90, Math.floor(hpx * s));
    }
    return {
      w: wpx,
      h: hpx,
      wantW: Math.round((Number(state.paperWidthMm || 170) / 25.4) * dpi),
      clamped: clamped,
      // 被夹取后的「实际等效 dpi」（纸宽不变，像素变少 → dpi 变低）
      effDpi: clamped
        ? Math.round((wpx / (Number(state.paperWidthMm || 170) / 25.4)))
        : dpi,
    };
  }

  function applyPreset(id) {
    state.preset = id;
    var p = PRESETS.filter(function (x) {
      return x.id === id;
    })[0];
    if (p) {
      if (p.wmm) {
        state.paperWidthMm = p.wmm;
        state.paperHeightMm = p.hmm || 0;
        state.keepAspect = !p.hmm;
      }
    }
    syncInputs();
    renderPreview();
  }

  /**
   * 套模板：一次性铺满「图面语言 + 相关开关」，但**不锁**任何一项。
   * 之后手改样式下拉 → template 自动降级为 custom（见 [data-k] 的绑定），
   * 这样面板上不会出现「显示套了论文、实际画的是别的东西」。
   */
  function applyTemplate(id) {
    var TPLS = (window.MapExport && window.MapExport.TEMPLATES) || {};
    var t = TPLS[id];
    state.template = t ? id : "custom";
    if (t) {
      if (t.style) {
        Object.keys(t.style).forEach(function (k) {
          state[k] = t.style[k];
        });
      }
      if (t.flags) {
        Object.keys(t.flags).forEach(function (k) {
          state[k] = t.flags[k];
        });
      }
    }
    syncInputs();
    schedulePreview(60);
  }

  function syncTemplateButtons() {
    if (!el) return;
    el.querySelectorAll(".mep-tplbtn").forEach(function (b) {
      var on = b.dataset.tpl === (state.template || "custom");
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var hint = el.querySelector(".mep-tpl");
    var TPLS = (window.MapExport && window.MapExport.TEMPLATES) || {};
    if (hint) {
      var t = TPLS[state.template];
      hint.textContent = t
        ? "已套用「" + t.label + "」模板 —— 下面任何一项都能再改（改完变自定义）"
        : "自定义组合：指北针 / 图例 / 格网 / 图框按下面选的值画";
    }
  }

  /**
   * 提示行：纸面 + dpi + 反推出的**地面覆盖范围**。
   * 不给「dpi 数字」当主信息 —— 那东西只有配了物理尺寸才有意义，
   * 写「≈300 dpi」对用户没有可操作性。
   * 被画布上限夹过时，这里必须说清「实际拿到的是多少」，
   * 否则用户以为出了 1200dpi、其实只有 800dpi。
   */
  function updateHint() {
    if (!el) return;
    var hint = el.querySelector(".mep-dpi");
    if (!hint) return;
    var map = window.map;
    var px = paperPx();
    if (!map) {
      hint.textContent = "";
      return;
    }
    // 出图 zoom（引擎同算法，仅用于提示）
    var zoomFloat = map.getZoom() + Math.log2(px.w / (map.getSize().x || 1));
    var mpp = (156543.03392804097 * Math.cos((map.getCenter().lat * Math.PI) / 180)) /
      Math.pow(2, zoomFloat);
    var gw = (mpp * px.w) / 1000;
    var gh = (mpp * px.h) / 1000;
    var fmt = function (v) {
      return v >= 1 ? v.toFixed(0) + " km" : (v * 1000).toFixed(0) + " m";
    };
    var bits = [
      "瓦片级 z" + Math.floor(zoomFloat),
      px.w + "×" + px.h + " px",
      "地面覆盖 " + fmt(gw) + " × " + fmt(gh),
    ];
    if (px.clamped) {
      bits.push("⚠️ 已按浏览器画布上限压到 " + px.w + "×" + px.h + "（实际约 " + px.effDpi + " dpi）");
    } else if (px.w * px.h > 80e6) {
      bits.push("⚠️ 尺寸较大，渲染需要十几秒");
    }
    hint.textContent = bits.join(" · ");
    hint.classList.toggle("is-warn", !!px.clamped);
  }

  // ========== 预览 ==========
  var _pendingSilent = false;
  function schedulePreview(ms, silent) {
    clearTimeout(previewTimer);
    _pendingSilent = !!silent;
    previewTimer = setTimeout(function () {
      renderPreview(_pendingSilent);
    }, ms || 420);
  }

  function buildOpts(aspectFromPreview) {
    var px = paperPx();
    return {
      // 新引擎按「纸面+dpi」自己反算 zoom，这里只给目标像素
      width: px.w,
      height: px.h,
      dpi: state.dpi,
      paperWidthMm: state.paperWidthMm,
      paperHeightMm: state.paperHeightMm,
      includeBase: state.includeBase,
      includeVectors: state.includeVectors,
      includeOverlays: state.includeOverlays,
      baseOpacity: Number(state.baseOpacity),
      vectorOpacity: Number(state.vectorOpacity),
      legend: state.legend,
      legendTitle: state.legendTitle,
      labels: state.labels,
      graticule: state.graticule,
      scaleBar: state.scaleBar,
      northArrow: state.northArrow,
      frame: state.frame,
      frameLabels: state.frameLabels,
      figureLabel: state.figureLabel,
      attribution: state.attribution,
      title: state.title,
      subtitle: state.subtitle,
      // 模板 + 四项图面样式（引擎侧 resolveStyle 负责兜底与校验）
      template: state.template,
      northArrowStyle: state.northArrowStyle,
      legendStyle: state.legendStyle,
      graticuleStyle: state.graticuleStyle,
      frameStyle: state.frameStyle,
      format: state.format,
      quality: state.quality,
      background: state.background === "transparent" ? "#ffffff" : state.background,
      onProgress: function (p) {
        if (!el) return;
        var m = el.querySelector(".mep-preview-mask span");
        if (m) m.textContent = "渲染中 " + Math.round(p * 100) + "%";
      },
    };
  }

  /**
   * 渲染预览缩略图。
   * @param silent true = 后台静默刷新（不盖「渲染中」遮罩、不闪 meta）——
   *        用于「拖地图 / 切图层」这种高频触发，用户正在看画面，别拿遮罩打断他。
   */
  function renderPreview(silent) {
    if (!el || !window.map) return;
    if (fullBusy) return; // 正在出正式图/打印：别跟它抢画布
    if (rendering) {
      pendingRender = true;
      pendingSilent = pendingSilent || !!silent;
      return;
    }
    rendering = true;
    var mask = el.querySelector(".mep-preview-mask");
    var meta = el.querySelector(".mep-preview-meta");
    var canvas = el.querySelector(".mep-preview-canvas");
    if (mask && !silent) mask.classList.add("is-on");
    if (meta && !silent) meta.textContent = "渲染中…";
    updateHint();

    EXPORT.prepare(9000)
      .then(function () {
        var opts = buildOpts();
        // 预览缩略：装进 420×200 的盒子（竖版整页 210×297 按比例会到 594px 高，
        // 渲染纯属浪费，且超过 CSS 上限也显示不出来）。
        // 注意：缩略**不影响构图** —— 引擎的 zoom 反算保证「任何宽度都覆盖
        // 屏幕同一地理范围」（coverage = 屏宽 × mpp@当前zoom，与 W 无关），
        // 所以预览看到的就是最终大图的同一片区域，只是分辨率低。
        var MAXW = 420, MAXH = 200;
        var sc = Math.min(MAXW / opts.width, MAXH / opts.height, 1);
        var pw = Math.max(80, Math.round(opts.width * sc));
        var ph = Math.max(60, Math.round(opts.height * sc));
        return EXPORT.render(Object.assign({}, opts, {
          width: pw,
          height: ph,
          onProgress: null,
        }));
      })
      .then(function (res) {
        var ctx = canvas.getContext("2d");
        canvas.width = res.canvas.width;
        canvas.height = res.canvas.height;
        ctx.drawImage(res.canvas, 0, 0);
        if (meta) {
          var r = res.report;
          // 报「正式出图的像素」而不是缩略图像素 —— 那才是用户关心的
          var pxs = paperPx();
          var bits = [pxs.w + "×" + pxs.h + " px"];
          if (r.zoom != null) bits.push("z" + r.zoom + (r.capped ? "(已达底图上限)" : ""));
          if (r.base) bits.push("底图 " + (r.base.ok || 0) + "/" + (r.base.total || 0));
          if (r.vectors) bits.push("要素 " + r.vectors);
          if (r.labels) bits.push("标签 " + r.labels);
          if (r.legend) bits.push("图例 ✓");
          meta.textContent = bits.join(" · ");
        }
        var warn = el.querySelector(".mep-warn");
        if (warn) {
          var ws = (res.report.warnings || []).slice();
          var px = paperPx();
          if (px.clamped) ws.unshift("尺寸已被浏览器画布上限压到 " + px.w + "×" + px.h);
          warn.textContent = ws.join("；");
          warn.classList.toggle("is-on", ws.length > 0);
        }
      })
      .catch(function (e) {
        var warn = el.querySelector(".mep-warn");
        if (warn) {
          warn.textContent = "预览失败：" + (e.message || e);
          warn.classList.add("is-on");
        }
      })
      .then(function () {
        rendering = false;
        if (mask) mask.classList.remove("is-on");
        if (pendingRender) {
          pendingRender = false;
          var s = pendingSilent;
          pendingSilent = false;
          renderPreview(s);
        }
      });
  }

  // ========== 下载 / 打印 ==========
  function doDownload() {
    if (!window.map) return;
    var btn = el.querySelector('[data-act="download"]');
    btn.disabled = true;
    btn.textContent = "渲染中…";
    var mask = el.querySelector(".mep-preview-mask");
    if (mask) mask.classList.add("is-on");
    fullBusy = true;

    EXPORT.prepare(15000)
      .then(function () {
        return EXPORT.render(buildOpts());
      })
      .then(function (res) {
        if (state.background === "transparent" && state.format === "png") {
          var c = res.canvas;
          var cx = c.getContext("2d");
          var d = cx.getImageData(0, 0, c.width, c.height);
          for (var i = 3; i < d.data.length; i += 4) d.data[i] = 255;
          cx.putImageData(d, 0, 0);
        }
        return EXPORT.download(res.canvas, {
          format: state.format,
          quality: state.quality,
          filename: "OGV",
        });
      })
      .then(function (info) {
        window.showToast &&
          window.showToast(
            "✅ 已保存 " + info.name + "（" + Math.round(info.size / 1024) + " KB）",
            { duration: 3200 },
          );
      })
      .catch(function (e) {
        window.showToast &&
          window.showToast("❌ 出图失败：" + (e.message || e), { duration: 5000 });
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "下载图片";
        if (mask) mask.classList.remove("is-on");
        fullBusy = false;
      });
  }

  /** 打印/PDF：把成图塞进临时窗口，走浏览器打印（矢量文字保真） */
  function doPrint() {
    if (!window.map) return;
    var btn = el.querySelector('[data-act="print"]');
    btn.disabled = true;
    btn.textContent = "准备中…";
    fullBusy = true;
    EXPORT.prepare(15000)
      .then(function () {
        return EXPORT.render(buildOpts());
      })
      .then(function (res) {
        var w = window.open("", "_blank");
        if (!w) throw new Error("浏览器拦截了弹出窗口");
        var dataUrl = res.canvas.toDataURL("image/png");
        var title = state.title || "OGV 地图";
        w.document.write(
          '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
            "<title>" +
            title +
            "</title><style>" +
            "@page{margin:10mm}" +
            "html,body{margin:0;padding:0;background:#fff}" +
            "img{max-width:100%;height:auto;display:block}" +
            "</style></head><body>" +
            '<img src="' +
            dataUrl +
            '" alt="map">' +
            "</body></html>",
        );
        w.document.close();
        setTimeout(function () {
          w.focus();
          w.print();
        }, 320);
        window.showToast("🖨️ 已打开打印窗口，选「另存为 PDF」即可", { duration: 5000 });
      })
      .catch(function (e) {
        window.showToast("❌ 打印准备失败：" + (e.message || e), { duration: 5000 });
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "打印 / PDF";
        fullBusy = false;
      });
  }

  // ========== 开关 ==========
  function saveState() {
    if (!S || !S.safeSet || !S.KEY || !S.KEY.EXPORT_OPTIONS) return;
    var out = { _v: STATE_VERSION };
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = state[k];
    });
    S.safeSet(S.KEY.EXPORT_OPTIONS, JSON.stringify(out));
  }

  function open() {
    var map = window.map;
    if (!map) {
      window.showToast && window.showToast("❌ 地图未就绪", { duration: 2000 });
      return;
    }
    el = buildUI();
    // 恢复上次设置（字段不匹配时忽略，坏配置已被 getJSON 自愈删除）
    if (S && S.getJSON && S.KEY && S.KEY.EXPORT_OPTIONS) {
      var saved = S.getJSON(S.KEY.EXPORT_OPTIONS);
      if (saved) {
        Object.keys(DEFAULTS).forEach(function (k) {
          if (saved[k] !== undefined) state[k] = saved[k];
        });
        // v1 → v2 迁移：老版本默认 150dpi（打出来发虚），只迁「没自己调过」的
        if (!saved._v || Number(saved._v) < STATE_VERSION) {
          if (Number(state.dpi) <= 150) state.dpi = DEFAULTS.dpi;
        }
      }
    }
    el.hidden = false;
    syncInputs();
    renderPreview();
    document.addEventListener("keydown", onKey);
    bindMapEvents();
  }

  function close() {
    if (el) el.hidden = true;
    document.removeEventListener("keydown", onKey);
    saveState();
  }

  function onKey(e) {
    if (e.key === "Escape" && el && !el.hidden) close();
  }

  /**
   * 预览实时跟随：把「影响画面的所有输入」都接上，改完立刻看到新预览。
   *
   * 以前只在「改参数」时重渲染 → 用户切图层 / 拖地图 / 换底图后，预览还是旧构图，
   * 得手动戳一下才知道结果。现在接四类源：
   *   · moveend / zoomend            —— 平移缩放（构图变了）
   *   · baselayerchange / overlay*   —— 底图与覆盖层（底图没了预览还亮着最误导人）
   *   · layeradd / layerremove       —— 矢量图层**懒加载完成**那一刻
   *       勾选瞬间只是开始下载 gzip，addLayer 时数据才真的画上去；
   *       只挂 change 会抓到空图层，预览等于没更新。
   *   · 面板里的 checkbox（捕获阶段）—— 图层开关 / 显示设置
   * 一律防抖 + 静默（不盖遮罩），拖地图时不会一直闪「渲染中」。
   */
  function bindMapEvents() {
    var m = window.map;
    if (!m) {
      setTimeout(bindMapEvents, 400); // 地图还没创建：稍后再绑
      return;
    }
    if (m._mepLiveBound) return;
    m._mepLiveBound = true;

    m.on("moveend zoomend", function () {
      if (el && !el.hidden) updateHint();
      liveRefresh(500);
    });
    m.on("baselayerchange overlayadd overlayremove", function () {
      liveRefresh(600);
    });
    m.on("layeradd layerremove", function () {
      liveRefresh(800);
    });
    // 捕获阶段：面板里那些 checkbox 不冒泡到 body 也能抓到（<details> 同理）
    document.addEventListener(
      "change",
      function (e) {
        var t = e.target;
        if (!t || t.type !== "checkbox") return;
        if (el && el.contains(t)) return; // 出图面板自己的参数已由 data-k 处理
        liveRefresh(600);
      },
      true,
    );
  }

  /** 静默重渲染预览（出图面板没开时什么都不做） */
  function liveRefresh(ms) {
    if (!el || el.hidden) return;
    schedulePreview(ms || 600, true);
  }

  EXPORT.open = open;
  EXPORT.close = close;
  EXPORT.isOpen = function () {
    return !!(el && !el.hidden);
  };
  EXPORT.renderPreview = renderPreview;
  /**
   * 对外参数接口（AI 助手 / 脚本调用）：合并合法字段 → 同步 UI → 重渲染预览。
   * opts 支持 DEFAULTS 里任意键 + preset（预设 id）+ open（默认 true：顺带打开面板）。
   * 只认白名单字段，类型不对的键直接丢弃，防止调用方把 state 写坏。
   */
  /** 白名单合并（applyOptions / exportNow 共用）：预设只落字段，不调 applyPreset */
  function _mergeOpts(target, opts) {
    if (!opts || typeof opts !== "object") return;
    if (typeof opts.preset === "string" && opts.preset) {
      var p = PRESETS.filter(function (x) {
        return x.id === opts.preset;
      })[0];
      target.preset = opts.preset;
      if (p && p.wmm) {
        target.paperWidthMm = p.wmm;
        target.paperHeightMm = p.hmm || 0;
        target.keepAspect = !p.hmm;
      }
    }
    Object.keys(DEFAULTS).forEach(function (k) {
      if (k === "preset" || !(k in opts)) return;
      var v = opts[k];
      if (typeof DEFAULTS[k] === "boolean" && typeof v !== "boolean") return;
      if (typeof DEFAULTS[k] === "number" && !isFinite(Number(v))) return;
      target[k] = typeof DEFAULTS[k] === "number" ? Number(v) : v;
    });
  }

  EXPORT.applyOptions = function (opts) {
    if (!opts || typeof opts !== "object") return false;
    _mergeOpts(state, opts);
    if (opts.open !== false) open(); // open 内部会 syncInputs + renderPreview
    else if (el && !el.hidden) {
      syncInputs();
      renderPreview();
    }
    return true;
  };

  /**
   * 「只算参数、不碰面板」：把 AI 传来的 preset/字段合并成完整 render opts。
   * 与 exportNow 同源（先落 preset 到字段，再 buildOpts），但**不改 state、不打开面板**。
   * 为什么要它：预览缩略图曾经直接调 MapExport.render(aiArgs)，
   *   `preset:"a4w"` 只是 UI 概念 → 纸面尺寸被忽略、默认 170mm，用户看到的预览
   *   和真正导出的图不是一张。现在预览与导出走同一套合并逻辑。
   */
  EXPORT.resolveOpts = function (opts) {
    var saved = Object.assign({}, state);
    _mergeOpts(state, opts);
    var o = buildOpts();
    delete o.onProgress;
    Object.assign(state, saved);
    return o;
  };

  /**
   * 直接出图并下载（AI 助手用）：不打开面板、不改动面板已保存的设置。
   * opts 同 applyOptions（白名单字段）+ filename（可选，文件名前缀）。
   * hooks.onProgress(0..1) 可选；返回 Promise<{name,size,report}>。
   */
  EXPORT.exportNow = function (opts, hooks) {
    if (!window.map) return Promise.reject(new Error("地图未就绪"));
    hooks = hooks || {};
    // buildOpts 读全局 state：临时合并 → 同步取参 → 立即还原，不污染用户设置
    var saved = Object.assign({}, state);
    _mergeOpts(state, opts);
    var transparentBg = state.background === "transparent"; // buildOpts 会把透明折成 #fff，先记下来
    var o = buildOpts();
    Object.assign(state, saved);
    o.onProgress = function (p) {
      if (typeof hooks.onProgress === "function") hooks.onProgress(p);
    };
    var filename =
      opts && typeof opts.filename === "string" && opts.filename.trim()
        ? opts.filename.trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)
        : "OGV";
    return EXPORT.prepare(15000)
      .then(function () {
        return EXPORT.render(o);
      })
      .then(function (res) {
        if (transparentBg && o.format === "png") {
          var c = res.canvas;
          var cx = c.getContext("2d");
          var d = cx.getImageData(0, 0, c.width, c.height);
          for (var i = 3; i < d.data.length; i += 4) d.data[i] = 255;
          cx.putImageData(d, 0, 0);
        }
        return EXPORT.download(res.canvas, {
          format: o.format,
          quality: o.quality,
          filename: filename,
        }).then(function (info) {
          info.report = res.report;
          return info;
        });
      });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindMapEvents);
  } else {
    bindMapEvents();
  }
})();
