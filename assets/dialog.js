/*!
 * Dialog.js v1.1.0 — 原生 dialog 弹窗工具
 * 依赖: dialog.css（必须引入）
 * 可选依赖: marked.js（showMarkdown 需要）
 *
 * ========================================
 *  快速开始
 * ========================================
 *
 * 1. 引入资源（顺序重要）：
 *    <link rel="stylesheet" href="./assets/dialog.css">
 *    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>  <!-- 可选 -->
 *    <script src="./assets/dialog.js"></script>
 *
 * 2. 使用：
 *    // 顶部通知（自动堆叠、自动消失）
 *    showToast('消息内容');
 *
 *    // 带操作按钮（如刷新）
 *    showToast('新版本可用', { action: '刷新', onAction: () => location.reload() });
 *
 *    // 不自动消失（无操作按钮时自动加上 ✕ 关闭按钮）
 *    showToast('正在处理…', { duration: 0 });
 *
 *    // 获取引用，手动关闭（如导出流程：先 loading → 完成时关掉再弹新 toast）
 *    var t = showToast('⏳ 处理中…', { duration: 0 });
 *    // ... 完成后 ...
 *    closeToast(t);
 *    showToast('✅ 完成');
 *
 *    // 底部弹出
 *    showToast('消息', { position: 'bottom' });
 *
 *    // 角落弹出
 *    showToast('消息', { position: 'top-right' });
 *    showToast('消息', { position: 'bottom-left' });
 *
 *    // 模态弹窗加载 Markdown 文档
 *    showMarkdown('docs/CHANGELOG.md', '更新记录');
 *
 * ========================================
 *  函数说明
 * ========================================
 *
 * ── showToast(msg, opts?) ─────────────
 *   msg     : string  - 通知文字（支持 HTML）
 *   opts    : object  - 可选参数：
 *     duration  : number  - 自动关闭毫秒，默认 4000，0=不自动关
 *     action    : string  - 按钮文字，设置后显示操作按钮
 *     onAction  : function- 按钮回调，点击后自动关闭 toast
 *     position  : string  - 弹出位置，默认 'top'
 *                          支持: top / bottom / top-left / top-right
 *                                / bottom-left / bottom-right
 *
 *   返回值：创建的 toast DOM 元素。可保存引用，后续用 closeToast() 手动关闭。
 *
 *   行为说明：
 *     - 新 toast 插入到容器最前面，flex 自动推下旧 toast
 *     - toast 移除时触发 CSS transition，动画结束后移除 DOM
 *     - 不自动消失 + 无操作按钮 → 自动添加 ✕ 关闭按钮
 *     - 点击 toast 外部区域（容器背景）关闭
 *
 * ── closeToast(el) ────────────────────
 *   el : DOM 元素 - showToast 返回的 toast 元素
 *   关闭指定 toast（带动画退场）
 *
 * ── showMarkdown(url, title) ──────────
 *   url   : string  - Markdown 文件路径
 *   title : string  - 弹窗标题
 *
 *   行为说明：
 *     - 使用原生 <dialog> 模态弹窗，有遮罩
 *     - 点击遮罩区域关闭，点击 ✕ 关闭
 *     - 需要 window.marked（marked.js）来渲染 MD → HTML
 *     - 自动生成折叠目录（取第一个 h1 为目录名，展示 h2/h3）
 *     - 正文 h2/h3 自动编号
 *     - 表格、代码块等有完整样式
 *     - 右下角回到顶部按钮（滚动超过 300px 显示）
 *     - 弹窗 DOM 为单例，首次创建后复用
 *
 * ========================================
 *  技术细节
 * ========================================
 *
 * Toast 原理：
 *   Toast 使用普通的 <div> 放在一个 fixed + flex-column 容器内。
 *   不同位置使用独立的容器（_toastContainer-{position}），互不干扰。
 *   新增：insertBefore 插入到容器最前 → flex 自动置换
 *   移除：closeToast(el) → CSS transition 退场 → 250ms 后 removeChild → flex 自动重排
 *
 * 模态弹窗原理：
 *   使用原生 <dialog> + showModal()，浏览器自动管理：
 *   - Top Layer 层级（高于一切）
 *   - 焦点锁定
 *   - ESC 关闭
 *   - ::backdrop 遮罩
 */

(function (global) {
  "use strict";

  // ==================== Toast ====================

  var _TOAST_DEFAULTS = {
    duration: 4000,
    gap: 8,
    position: "top",
  };

  // 位置 → 容器配置
  var _POSITIONS = {
    top: {
      justify: "center",
      dir: "column",
      edge: "top",
      edgeVal: 20,
      animY: -16,
    },
    bottom: {
      justify: "center",
      dir: "column-reverse",
      edge: "bottom",
      edgeVal: 20,
      animY: 16,
    },
    "top-left": {
      justify: "start",
      dir: "column",
      edge: "top",
      edgeVal: 20,
      animY: -16,
    },
    "top-right": {
      justify: "end",
      dir: "column",
      edge: "top",
      edgeVal: 20,
      animY: -16,
    },
    "bottom-left": {
      justify: "start",
      dir: "column-reverse",
      edge: "bottom",
      edgeVal: 20,
      animY: 16,
    },
    "bottom-right": {
      justify: "end",
      dir: "column-reverse",
      edge: "bottom",
      edgeVal: 20,
      animY: 16,
    },
  };

  // 容器缓存
  var _containers = {};

  function _getContainer(position) {
    if (!_POSITIONS[position]) position = "top";
    var key = position;
    if (!_containers[key]) {
      var cfg = _POSITIONS[key];
      var c = document.createElement("div");
      c.className = "_toastContainer _toastContainer-" + key;

      // 边距
      c.style[cfg.edge] = cfg.edgeVal + "px";
      // 水平对齐
      c.style[cfg.dir === "column" ? "flex-direction" : "flex-direction"] =
        cfg.dir;

      document.body.appendChild(c);
      _containers[key] = c;
    }
    return _containers[key];
  }

  function showToast(msg, opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var opt = {};
    for (var k in _TOAST_DEFAULTS) opt[k] = _TOAST_DEFAULTS[k];
    for (var k in opts) opt[k] = opts[k];

    var pos = opt.position || "top";
    if (!_POSITIONS[pos]) pos = "top";

    var el = document.createElement("div");
    el.className = "toast-dialog toast-" + pos;

    var html =
      '<div class="toast-cnt"><span class="toast-msg">' + _esc(msg) + "</span>";
    if (opt.action)
      html += '<button class="toast-action">' + _esc(opt.action) + "</button>";
    // 无操作按钮且不自动消失时，添加关闭按钮
    if (!opt.action && opt.duration === 0)
      html += '<button class="toast-close-btn">✕</button>';
    html += "</div>";
    el.innerHTML = html;

    // 插入到对应位置的容器最前面（flex 自动将其置顶，其余 toast 自动下移）
    var c = _getContainer(pos);
    c.insertBefore(el, c.firstChild);

    // 动画入场
    requestAnimationFrame(function () {
      el.classList.add("open");
    });

    // 点击 toast 外部关闭（点击容器背景）
    el.addEventListener("click", function (e) {
      if (e.target === el) closeToast(el);
    });

    // 操作按钮
    if (opt.onAction) {
      var btn = el.querySelector(".toast-action");
      if (btn)
        btn.addEventListener("click", function () {
          opt.onAction();
          closeToast(el);
        });
    }

    // 手动关闭按钮
    var closeBtn = el.querySelector(".toast-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        closeToast(el);
      });
    }

    if (opt.duration > 0)
      setTimeout(function () {
        closeToast(el);
      }, opt.duration);

    // 返回元素引用，方便调用方后续 closeToast
    return el;
  }

  // ---------- 公开的关闭函数 ----------

  function closeToast(el) {
    if (!el || !el.parentNode) return;
    el.classList.remove("open");
    el.classList.add("closing");
    // 等动画结束再移除 DOM
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 250);
  }

  // ==================== 模态弹窗（加载 MD） ====================

  function showMarkdown(url, title) {
    var dialog = document.getElementById("_mdDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "_mdDialog";
      dialog.className = "app-dialog modal-dialog";
      dialog.innerHTML =
        '<div class="dialog-header">' +
        '<h3 id="_mdTitle">文档</h3>' +
        '<button class="dialog-close" onclick="this.closest(\'dialog\').close()">×</button>' +
        "</div>" +
        '<div class="dialog-body" id="_mdBody"><p>加载中…</p></div>';
      document.body.appendChild(dialog);

      // 点击遮罩（backdrop）关闭弹窗
      dialog.addEventListener("click", function (e) {
        if (e.target === dialog) dialog.close();
      });
    }

    document.getElementById("_mdTitle").textContent = title || "文档";
    var body = document.getElementById("_mdBody");
    body.innerHTML = "<p>加载中…</p>";
    dialog.showModal();

    if (typeof marked !== "undefined") {
      fetch(url)
        .then(function (r) {
          return r.text();
        })
        .then(function (md) {
          body.innerHTML = marked.parse(md);
          // 渲染完成后构建折叠式目录
          buildTOC(body, dialog);
          // 添加回到顶部按钮
          addBackTop(dialog);
        })
        .catch(function () {
          body.innerHTML = "<p>❌ 加载失败</p>";
        });
    } else {
      body.innerHTML =
        '<p>需要 <a href="https://cdn.jsdelivr.net/npm/marked/marked.min.js" target="_blank">marked.js</a> 来渲染 Markdown</p>';
    }
  }

  // ==================== 构建折叠目录 ====================

  function buildTOC(body, dialog) {
    var allHeadings = body.querySelectorAll("h1, h2, h3");
    var subCount = Array.from(allHeadings).filter(function (h) {
      return h.tagName !== "H1";
    }).length;
    if (subCount < 2) return;

    var firstH1 = body.querySelector("h1");
    var tocTitle = firstH1 ? _esc(firstH1.textContent) + " — 目录" : "📑 目录";

    allHeadings.forEach(function (h, i) {
      if (!h.id) h.id = "toc-" + i;
    });

    var tocHtml = '<div class="md-toc">';
    tocHtml +=
      '<details class="md-toc-details" open>' +
      '<summary class="md-toc-summary">' +
      tocTitle +
      "</summary>" +
      '<div class="md-toc-list">';
    var h2n = 0,
      h3n = 0;
    allHeadings.forEach(function (h) {
      var tag = h.tagName.toLowerCase();
      if (tag === "h1") return;
      var cls = "md-toc-item toc-" + tag;
      var num = "";
      if (tag === "h2") {
        h2n++;
        h3n = 0;
        num = h2n + ". ";
      } else if (tag === "h3") {
        h3n++;
        num = h2n + "." + h3n + " ";
      }
      tocHtml +=
        '<a class="' +
        cls +
        '" href="#' +
        h.id +
        '">' +
        _esc(num + h.textContent) +
        "</a>";
    });
    tocHtml += "</div></details></div>";

    var tocWrap = document.createElement("div");
    tocWrap.innerHTML = tocHtml;
    var tocNode = tocWrap.firstElementChild;
    body.insertBefore(tocNode, body.firstChild);

    tocNode.addEventListener("click", function (e) {
      var a = e.target.closest(".md-toc-item");
      if (!a) return;
      e.preventDefault();
      var id = a.getAttribute("href").slice(1);
      var target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // ==================== 回到顶部按钮 ====================

  function addBackTop(dialog) {
    var body = document.getElementById("_mdBody");
    if (!body) return;
    if (body.querySelector(".md-back-top")) return;

    var btn = document.createElement("button");
    btn.className = "md-back-top";
    btn.innerHTML = "⬆";
    btn.title = "回到顶部";
    body.appendChild(btn);

    body.addEventListener("scroll", function () {
      btn.classList.toggle("visible", body.scrollTop > 300);
    });

    btn.addEventListener("click", function () {
      body.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // ==================== 工具 ====================

  function _esc(str) {
    var d = document.createElement("div");
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

  // ==================== 暴露全局 ====================

  global.showToast = showToast;
  global.closeToast = closeToast;
  global.showMarkdown = showMarkdown;
})(window);
