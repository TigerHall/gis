/*!
 * Dialog.js v1.0.0 — 原生 dialog 弹窗工具
 * 依赖: dialog.css（样式）
 *
 * ── 函数列表 ──
 * showToast('消息', opts?)      顶部通知（动态堆叠，自动消失）
 * showMarkdown(url, title)     模态弹窗加载 MD 文档
 *
 * showToast opts:
 *   duration  4000   自动关闭毫秒（0=不自动关）
 *   action    ''     按钮文字
 *   onAction  null   按钮回调
 */
(function (global) {
  "use strict";

  // ==================== Toast 容器（flex 布局，自动堆叠）====================

  var _TOAST_DEFAULTS = {
    duration: 4000,
    topOffset: 20,
    gap: 8,
  };

  // 单例容器
  var _toastContainer = null;
  function _getContainer() {
    if (!_toastContainer) {
      _toastContainer = document.createElement("div");
      _toastContainer.id = "_toastContainer";
      document.body.appendChild(_toastContainer);
    }
    return _toastContainer;
  }

  function showToast(msg, opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var opt = {};
    for (var k in _TOAST_DEFAULTS) opt[k] = _TOAST_DEFAULTS[k];
    for (var k in opts) opt[k] = opts[k];

    var el = document.createElement("div");
    el.className = "toast-dialog";

    var html =
      '<div class="toast-cnt"><span class="toast-msg">' + _esc(msg) + "</span>";
    if (opt.action)
      html += '<button class="toast-action">' + _esc(opt.action) + "</button>";
    // 无操作按钮且不自动消失时，添加关闭按钮
    if (!opt.action && opt.duration === 0)
      html += '<button class="toast-close-btn">✕</button>';
    html += "</div>";
    el.innerHTML = html;

    // 插入到容器最前面（flex 自动将其置顶，其余 toast 自动下移）
    var c = _getContainer();
    c.insertBefore(el, c.firstChild);

    // 动画入场
    requestAnimationFrame(function () {
      el.classList.add("open");
    });

    // 点击 toast 外部关闭（点击容器背景）
    el.addEventListener("click", function (e) {
      if (e.target === el) _close(el);
    });

    // 操作按钮
    if (opt.onAction) {
      var btn = el.querySelector(".toast-action");
      if (btn)
        btn.addEventListener("click", function () {
          opt.onAction();
          _close(el);
        });
    }

    // 手动关闭按钮
    var closeBtn = el.querySelector(".toast-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        _close(el);
      });
    }

    if (opt.duration > 0)
      setTimeout(function () {
        _close(el);
      }, opt.duration);
  }

  function _close(el) {
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
    // 提取 h1/h2/h3
    var allHeadings = body.querySelectorAll("h1, h2, h3");
    // 只统计 h2+h3 的数量
    var subCount = Array.from(allHeadings).filter(function (h) {
      return h.tagName !== "H1";
    }).length;
    if (subCount < 2) return; // 二级三级标题太少不生成目录

    // 取第一个 h1 作为目录标题
    var firstH1 = body.querySelector("h1");
    var tocTitle = firstH1 ? _esc(firstH1.textContent) + " — 目录" : "📑 目录";

    // 给每个 heading 加 id（marked 的 gfm 模式已自动生成 id，但兜底）
    allHeadings.forEach(function (h, i) {
      if (!h.id) {
        h.id = "toc-" + i;
      }
    });

    // 构建目录 HTML（只渲染 h2/h3，不渲染 h1）
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
      if (tag === "h1") return; // 跳过一级标题
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

    // 插入到 body 最前面
    var tocWrap = document.createElement("div");
    tocWrap.innerHTML = tocHtml;
    var tocNode = tocWrap.firstElementChild;
    body.insertBefore(tocNode, body.firstChild);

    // 点击目录项平滑滚动
    tocNode.addEventListener("click", function (e) {
      var a = e.target.closest(".md-toc-item");
      if (!a) return;
      e.preventDefault();
      var id = a.getAttribute("href").slice(1);
      var target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  // ==================== 回到顶部按钮 ====================

  function addBackTop(dialog) {
    var body = document.getElementById("_mdBody");
    if (!body) return;
    // 已有按钮则不重复添加
    if (body.querySelector(".md-back-top")) return;

    var btn = document.createElement("button");
    btn.className = "md-back-top";
    btn.innerHTML = "⬆";
    btn.title = "回到顶部";
    body.appendChild(btn);

    // 滚动时显示/隐藏
    body.addEventListener("scroll", function () {
      btn.classList.toggle("visible", body.scrollTop > 300);
    });

    // 点击回到顶部
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
  global.showMarkdown = showMarkdown;
})(window);
