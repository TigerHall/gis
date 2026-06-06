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

  // ==================== Toast ====================

  var _TOAST_DEFAULTS = {
    duration: 4000,
    topOffset: 20,
    gap: 8,
  };

  function showToast(msg, opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    var opt = {};
    for (var k in _TOAST_DEFAULTS) opt[k] = _TOAST_DEFAULTS[k];
    for (var k in opts) opt[k] = opts[k];

    var el = document.createElement("dialog");
    el.className = "toast-dialog";

    var html =
      '<div class="toast-cnt"><span class="toast-msg">' + _esc(msg) + "</span>";
    if (opt.action)
      html += '<button class="toast-action">' + _esc(opt.action) + "</button>";
    html += "</div>";
    el.innerHTML = html;

    document.body.appendChild(el);
    el.show();

    // 堆叠：新在上，旧往下推
    var existing = Array.from(document.querySelectorAll(".toast-dialog[open]"))
      .filter(function (d) {
        return d !== el;
      })
      .reverse();

    var cursor = opt.topOffset + el.offsetHeight + opt.gap;
    existing.forEach(function (d) {
      d.style.top = cursor + "px";
      cursor += d.offsetHeight + opt.gap;
    });
    el.style.top = opt.topOffset + "px";

    // 点击外部关闭
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

    if (opt.duration > 0)
      setTimeout(function () {
        _close(el);
      }, opt.duration);
  }

  function _close(el) {
    if (!el.open) return;
    el.close();
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
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
        })
        .catch(function () {
          body.innerHTML = "<p>❌ 加载失败</p>";
        });
    } else {
      body.innerHTML =
        '<p>需要 <a href="https://cdn.jsdelivr.net/npm/marked/marked.min.js" target="_blank">marked.js</a> 来渲染 Markdown</p>';
    }
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
