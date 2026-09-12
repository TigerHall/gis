/**
 * ScrollGutterGuard — 滚动条槽位的「懒预留」
 *
 * 要解决的问题：容器内容变长 → 滚动条出现 → 内容被挤窄；内容变短 → 滚动条消失
 * → 内容又变宽。这条横向抖动在侧栏 4 列网格、图层名、表格列上都看得很明显。
 *
 * 常见做法是给所有滚动容器无条件写 `scrollbar-gutter: stable`，但那会让
 * 「几乎不会溢出」的容器（如图例只有几条时）永久空出一条 10~15px 的右侧留白。
 *
 * 本模块换成**懒预留**：容器第一次真的溢出时才打上 `data-scroll-guttered`，
 * 从此常驻预留槽位。关键点是打标记那一刻滚动条已经在占位了，所以引入 stable
 * 这一步本身零视觉变化；之后内容再变短也不会把宽度还回去 —— 既没有来回抖动，
 * 也没有「用不上却一直占着」的浪费。
 *
 * 谁来发现「第一次溢出」：
 *   ① 文档级 MutationObserver（childList + subtree）覆盖内容增删；
 *      只对新增子树做定向 querySelectorAll，不做全文档扫描
 *   ② 若干粗粒度全量扫描（DOMContentLoaded / load / resize / 几个延迟点）
 *      覆盖「尺寸变化导致溢出」以及不经过本文件的内容更新
 * 标记过的容器进 WeakSet，后续 check 直接短路，不会反复触发重排。
 */
(function () {
  "use strict";

  // 候选滚动容器。将来新增滚动面板，把选择器加到这里即可
  var SELECTOR = [
    ".panel-scroll", // 侧栏主滚动（地图设置 / 搜索 / 图层列表）
    ".search-results", // 搜索结果下拉
    ".app-dialog .dialog-body", // 帮助 / 文档对话框正文
    ".md-toc-list", // 文档目录
    ".feature-popup-body", // 要素弹窗内容
    ".layer-dialog .dlg-tab-content", // 图层设置对话框标签页
    ".feature-panel-table-wrap", // 属性表格
    ".pd-table-wrap", // 投点数据表格
    ".leaflet-legend-control", // 图例
  ].join(",");

  var ATTR = "data-scroll-guttered";

  var hasWeakSet = typeof WeakSet === "function";
  var marked = hasWeakSet ? new WeakSet() : null;
  var markedCount = 0;
  var queue = [];
  var rafId = 0;

  function isMarked(el) {
    return hasWeakSet ? marked.has(el) : el.getAttribute(ATTR) !== null;
  }

  function markIfOverflowing(el) {
    if (!el || el.nodeType !== 1) return;
    if (isMarked(el)) return; // 短路，避免重复重排
    // +1 容忍亚像素舍入。隐藏元素 scrollHeight/clientHeight 都是 0，不会被误标
    if (el.scrollHeight <= el.clientHeight + 1) return;
    el.setAttribute(ATTR, "");
    if (hasWeakSet) marked.add(el);
    markedCount++;
  }

  function collectIn(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches(SELECTOR)) queue.push(node);
    var list = node.querySelectorAll(SELECTOR);
    for (var i = 0; i < list.length; i++) queue.push(list[i]);
  }

  function flush() {
    rafId = 0;
    var items = queue;
    queue = [];
    for (var i = 0; i < items.length; i++) markIfOverflowing(items[i]);
  }

  function schedule() {
    // rAF 回调仍在本帧绘制之前 → 加标记不产生可见跳动
    if (!rafId && typeof window.requestAnimationFrame === "function") {
      rafId = window.requestAnimationFrame(flush);
    } else if (!rafId) {
      flush();
    }
  }

  function sweepAll() {
    collectIn(document.body);
    schedule();
  }

  // ---------- ① 定向监听内容增删 ----------
  if (typeof MutationObserver === "function" && document.body) {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        // 新增子树里可能就带候选容器（对话框、弹窗都是按需创建的）
        for (var j = 0; j < rec.addedNodes.length; j++) {
          collectIn(rec.addedNodes[j]);
        }
        // 已有容器内部增删 → 它自己可能刚好越过溢出阈值
        var t = rec.target;
        if (t && t.nodeType === 1) {
          queue.push(t.matches(SELECTOR) ? t : t.closest(SELECTOR));
        }
      }
      if (queue.length) schedule();
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---------- ② 粗粒度全量扫描 ----------
  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    if (resizeTimer) return;
    resizeTimer = window.setTimeout(function () {
      resizeTimer = 0;
      sweepAll();
    }, 150);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sweepAll);
  } else {
    sweepAll();
  }
  window.addEventListener("load", sweepAll);
  // 面板内容大多是异步填进来的，补几次延迟扫描把「加载完才溢出」的捞干净
  [600, 2000, 5000].forEach(function (ms) {
    window.setTimeout(sweepAll, ms);
  });

  window.ScrollGutterGuard = {
    sweep: sweepAll,
    markedCount: function () {
      return markedCount;
    },
  };
})();
