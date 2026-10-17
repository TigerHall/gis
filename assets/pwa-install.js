/*!
 * pwa-install.js —— 首次进入的「安装到桌面」提醒
 * =============================================================================
 * 为什么需要：
 *   · 本站是纯静态单页 + Service Worker 全量预缓存，装成 PWA 后**离线可用**、
 *     点图标直接进（不用再敲域名）；
 *   · 从分享链接进来的访客（带 #focus/南海、?search=xxx 这类深链）通常只看一次
 *     就关掉 —— 给他一个「装到桌面下次一点就开」的入口，比让他记住域名有用得多。
 *
 * 行为（2026-10-18 修订：**没装就每次进入都提醒**）：
 *   1. 已经装过（standalone / appinstalled / 存过标记）→ 永不打扰；
 *   2. **没装就提醒**：每次进入页面都会提醒一次；从后台切回前台时（间隔 > 10 分钟）
 *      再提醒一次 —— 装没装是硬状态，不看「弹过几次」；
 *   3. 「以后再说」/ ✕ / Esc → **只压本次页面**（内存标记，刷新即失效）；
 *      下次进入照旧提醒。想要彻底清静请点「不再提示」；
 *   4. 「不再提示」→ `neverAsk=true`，**永久不弹**（哪怕一直没装）；
 *   5. 默认 6s 后弹；**分享深链进来 2.5s 就弹**（这类访客最值得留）；
 *   6. 有 beforeinstallprompt（Chromium）→ 一键真安装（走原生弹窗）；
 *      没有（iOS Safari / Firefox）→ 给手动安装图文步骤，不假装能一键装。
 *
 * 与设置面板的关系（「操作 → 安装到桌面」开关）：
 *   开关的**真值就是这个模块的 isInstalled()**，与「鼠标坐标」那类开关共用同一套
 *   toggleConfig 机制（见 app.js 的 cfg.truth）。所以装好那一刻开关自动变开、
 *   已安装时开关禁用；用户在面板里主动拨开 = 主动发起安装（不受 neverAsk 限制）。
 *   状态变化通过 onChange(fn) 广播，面板不必轮询。
 *
 * 存储：ogv_pwa_state = { installedAt, shownAt, neverAsk }（dismissedAt 已废弃）
 * 依赖：无（OGVStorage 有就用，没有退回裸 localStorage 且异常全吞）
 * =============================================================================
 */
(function (global) {
  "use strict";

  var KEY = "ogv_pwa_state";
  var DEFAULT_DELAY = 6000;
  var SHARED_DELAY = 2500;
  var REFRESH_GAP = 10 * 60000; // 切回前台后至少隔 10 分钟才再提醒（别一刷新就弹）

  var _el = null;
  var _timer = null;
  var _lastShowAt = 0;
  // 「以后再说」/✕/Esc 只压这一次页面加载：这是内存变量，刷新即清空。
  // 为什么不用 dismissedAt + 天数：用户要的是「没装就每次进入都提醒」，
  // 按天数冷却会把「每次」变成「每两周一次」。
  var _dismissedThisPage = false;
  var _subs = []; // onChange 订阅者（设置面板的开关同步用）

  // ── 存储（OGVStorage 优先）──
  function _read() {
    try {
      var S = global.OGVStorage;
      var raw = S && S.safeGet ? S.safeGet(KEY, "") : global.localStorage.getItem(KEY);
      var o = raw ? JSON.parse(raw) : {};
      return o && typeof o === "object" ? o : {};
    } catch (e) {
      return {};
    }
  }
  function _write(o) {
    try {
      var s = JSON.stringify(o);
      var S = global.OGVStorage;
      if (S && S.safeSet) S.safeSet(KEY, s);
      else global.localStorage.setItem(KEY, s);
    } catch (e) {}
  }

  // ── 环境判定 ──
  function isStandalone() {
    try {
      if (global.navigator.standalone) return true; // iOS 主屏幕
      return !!(global.matchMedia && global.matchMedia("(display-mode: standalone)").matches);
    } catch (e) {
      return false;
    }
  }
  function isIOS() {
    var ua = global.navigator.userAgent || "";
    // iPadOS 13+ 把自己伪装成 Mac，用触摸点数量区分
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (global.navigator.maxTouchPoints || 0) > 1);
  }
  function isMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(global.navigator.userAgent || "");
  }

  /** 分享/深链入口：这类访客最值得引导安装 */
  function isSharedEntry() {
    try {
      var h = String(global.location.hash || "");
      var q = String(global.location.search || "");
      if (/#(focus|search|loc|bbox|query|proto)[/=]/i.test(h)) return true;
      if (/[?&](focus|search|loc|bbox|proto|file|url|q)=/i.test(q)) return true;
    } catch (e) {}
    return false;
  }

  function _shouldShow() {
    if (isInstalled()) return false; // 已装（从桌面启动 / 装过）
    if (_dismissedThisPage) return false; // 本页已经说过「以后再说」
    if (_read().neverAsk) return false; // 点过「不再提示」→ 永久闭嘴，哪怕一直没装
    return true; // 没装就提醒，不看「弹过几次」
  }

  /**
   * 「装了吗」的唯一判定。
   * 三条证据任一成立即为已装：以 standalone 运行（从桌面图标启动）、
   * 浏览器报过 appinstalled、曾经存下 installedAt。
   * ⚠️ 它同时是设置面板那个开关的真值 —— 所以不要在这里掺「提醒过几次」之类的
   *    提醒状态，那是另一个维度（neverAsk 只管自动弹窗，不影响安装）。
   */
  function isInstalled() {
    if (isStandalone()) return true;
    return !!_read().installedAt;
  }

  /** 状态变化广播：装好 / 取消安装 / 取消「不再提示」都通知订阅者重算 UI */
  function _emit() {
    for (var i = 0; i < _subs.length; i++) {
      try {
        _subs[i](isInstalled());
      } catch (e) {}
    }
  }
  function onChange(fn) {
    if (typeof fn !== "function") return function () {};
    _subs.push(fn);
    return function () {
      var k = _subs.indexOf(fn);
      if (k >= 0) _subs.splice(k, 1);
    };
  }

  // ── 样式（自包含：只有一个卡片，不值得单开 css 文件再动 index/SW）──
  var CSS = [
    ".ogv-pwa{position:fixed;left:50%;transform:translateX(-50%);",
    "bottom:calc(18px + env(safe-area-inset-bottom));width:min(440px,calc(100vw - 24px));",
    "z-index:1200;display:flex;gap:10px;align-items:flex-start;",
    "padding:12px 14px;border-radius:14px;border:1px solid var(--c-border,#ddd);",
    "background:var(--c-bg,#fff);color:var(--c-text,#222);",
    "box-shadow:0 10px 30px rgba(0,0,0,.28);font-size:13px;line-height:1.5;",
    "animation:ogvPwaIn .28s ease-out}",
    "@keyframes ogvPwaIn{from{opacity:0;transform:translateX(-50%) translateY(12px)}",
    "to{opacity:1;transform:translateX(-50%) translateY(0)}}",
    ".ogv-pwa-ico{width:38px;height:38px;border-radius:9px;flex:none;",
    "background:var(--c-green,#99cc99);display:flex;align-items:center;",
    "justify-content:center;font-size:20px}",
    ".ogv-pwa-main{flex:1;min-width:0}",
    ".ogv-pwa-t{font-weight:600;margin-bottom:2px}",
    ".ogv-pwa-d{color:var(--c-text-dim,#777);font-size:12px}",
    ".ogv-pwa-d b{color:var(--c-text,#222)}",
    ".ogv-pwa-btns{display:flex;gap:6px;margin-top:9px}",
    ".ogv-pwa-btn{padding:6px 12px;font-size:12.5px;border-radius:8px;",
    "border:1px solid var(--c-border,#ddd);background:var(--c-bg,#fff);",
    "color:var(--c-text,#222);cursor:pointer;font-family:inherit}",
    ".ogv-pwa-btn:hover{background:var(--c-bg-hover,#f0f0f0)}",
    ".ogv-pwa-btn.primary{background:var(--c-green,#99cc99);border-color:transparent;",
    "color:#1a1a2e;font-weight:600}",
    ".ogv-pwa-btn.primary:hover{background:var(--c-green-hover,#88bb88)}",
    // 「不再提示」：比次要按钮还轻（无边框、灰字），但点下去是永久的
    ".ogv-pwa-never{border-color:transparent;background:transparent;",
    "color:var(--c-text-dim,#888);padding:6px 4px;margin-left:auto}",
    ".ogv-pwa-never:hover{color:var(--c-red,#c62828);background:transparent;",
    "text-decoration:underline}",
    ".ogv-pwa-x{border:none;background:transparent;color:var(--c-text-dim,#888);",
    "font-size:15px;cursor:pointer;line-height:1;padding:2px 4px;flex:none}",
    ".ogv-pwa-steps{margin-top:8px;font-size:12px;color:var(--c-text-dim,#777);",
    "border-left:2px solid var(--c-green,#99cc99);padding-left:8px;display:none}",
    ".ogv-pwa-steps.on{display:block}",
    ".ogv-pwa-steps b{color:var(--c-text,#222)}",
    "@media (max-width:520px){.ogv-pwa{bottom:calc(10px + env(safe-area-inset-bottom))}}",
  ].join("");

  function _injectCSS() {
    if (document.getElementById("ogvPwaCss")) return;
    var st = document.createElement("style");
    st.id = "ogvPwaCss";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ── DOM ──
  function _build() {
    if (_el) return _el;
    _injectCSS();
    var box = document.createElement("div");
    box.className = "ogv-pwa";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "安装应用提示");
    box.innerHTML =
      '<div class="ogv-pwa-ico" aria-hidden="true">🗺️</div>' +
      '<div class="ogv-pwa-main">' +
      '  <div class="ogv-pwa-t">把地图装到桌面</div>' +
      '  <div class="ogv-pwa-d">装好后<b>离线也能看</b>，下次一点就开，不用再找链接。</div>' +
      '  <div class="ogv-pwa-steps"></div>' +
      '  <div class="ogv-pwa-btns">' +
      '    <button type="button" class="ogv-pwa-btn primary" data-pwa="install">立即安装</button>' +
      '    <button type="button" class="ogv-pwa-btn" data-pwa="later" ' +
      '      title="本次不再提醒（下次进入还会提示）">以后再说</button>' +
      '    <button type="button" class="ogv-pwa-btn ogv-pwa-never" data-pwa="never" ' +
      '      title="以后不再提醒（哪怕没有安装，仍可到「操作 → 安装到桌面」手动安装）">不再提示</button>' +
      "  </div>" +
      "</div>" +
      '<button type="button" class="ogv-pwa-x" data-pwa="close" aria-label="关闭">✕</button>';

    box.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-pwa]") : null;
      if (!b) return;
      var act = b.getAttribute("data-pwa");
      if (act === "install") _doInstall();
      else if (act === "later") _dismiss();
      else if (act === "never") _never();
      else _dismiss(); // ✕ 与 Esc 同义：本次页面不再打扰
    });
    document.body.appendChild(box);
    _el = box;
    return box;
  }

  function _stepsHTML() {
    if (isIOS()) {
      return "iOS：点底部 <b>分享</b> 按钮 → 下滑选 <b>「添加到主屏幕」</b> → 完成。";
    }
    return (
      "桌面浏览器：点地址栏右侧的 <b>安装</b> 图标（⊕ / 显示器形），或菜单里选 <b>「安装此应用」</b>。"
    );
  }

  function _doInstall() {
    var p = global._pwaInstallPrompt;
    if (p && typeof p.prompt === "function") {
      try {
        p.prompt();
        var choice = p.userChoice;
        if (choice && typeof choice.then === "function") {
          choice.then(function (res) {
            if (res && res.outcome === "accepted") {
              _markInstalled(); // 写 installedAt + 广播 → 设置里的开关自动变开
            } else {
              // 原生弹窗里点了取消：本次页面不再提醒，开关回弹到「未安装」
              _dismiss();
            }
          });
        } else {
          _close();
          _emit();
        }
      } catch (e) {
        _showSteps();
      }
      global._pwaInstallPrompt = null;
      return;
    }
    // 拿不到 prompt 事件（iOS / 已消费过 / 浏览器不支持）→ 给步骤，不假装能一键装
    _showSteps();
  }

  function _showSteps() {
    var box = _build();
    var s = box.querySelector(".ogv-pwa-steps");
    if (!s) return;
    s.innerHTML = _stepsHTML();
    s.classList.add("on");
    // ⚠️ 顺序要紧：先把原来的「以后再说」藏掉，再改主按钮的属性。
    // 反过来的话主按钮刚被改成 data-pwa="later"，querySelector 会先抓到它，
    // 于是「知道了」被 display:none 吃掉，只剩一个光秃秃的说明块。
    var later = box.querySelector('.ogv-pwa-btn[data-pwa="later"]');
    if (later) later.style.display = "none";
    var btn = box.querySelector('[data-pwa="install"]');
    if (btn) {
      btn.textContent = "知道了";
      // 从「立即安装」改成「知道了」→ 走 dismiss 语义（只压本次页面），
      // 否则用户关掉后本页还会再弹一次同样的说明
      btn.setAttribute("data-pwa", "later");
    }
    // 拿不到原生 prompt 说明没装成：让设置面板的开关回到「未安装」，
    // 不能停在「已安装」骗人（真实状态由 isInstalled() 决定）
    _emit();
  }

  function _dismiss() {
    // 只压本次页面加载：刷新 / 下次进入照旧提醒
    _dismissedThisPage = true;
    var st = _read();
    st.shownAt = Date.now();
    _write(st);
    _close();
    _emit(); // 让设置面板那个开关回弹到「未安装」
  }

  /** 「不再提示」：永久抑制**自动弹窗**（不是「不再允许安装」） */
  function _never() {
    var st = _read();
    st.neverAsk = true;
    st.shownAt = Date.now();
    _write(st);
    _dismissedThisPage = true;
    _close();
    _emit();
    if (global.showToast) {
      global.showToast("已关闭安装提醒（可在「操作 → 安装到桌面」手动安装）", {
        duration: 2800,
      });
    }
  }
  function setNeverAsk(v) {
    var st = _read();
    st.neverAsk = !!v;
    if (!st.neverAsk) st.shownAt = Date.now(); // 重新开启提醒时不要立刻补弹
    _write(st);
    _emit();
  }

  function _markInstalled() {
    var st = _read();
    if (!st.installedAt) {
      st.installedAt = Date.now();
      _write(st);
    }
    _dismissedThisPage = false;
    _close();
    _emit();
  }

  function _close() {
    if (_el && _el.parentNode) _el.parentNode.removeChild(_el);
    _el = null;
  }

  function schedule(force) {
    if (_timer) clearTimeout(_timer);
    if (!force && !_shouldShow()) return;
    var st = _read();
    st.shownAt = Date.now();
    _write(st);
    // 手动触发（force）立刻弹；自动路径按入口类型给延时，别打断首屏
    var delay = force ? 150 : isSharedEntry() ? SHARED_DELAY : DEFAULT_DELAY;
    _timer = setTimeout(function () {
      show(force);
    }, delay);
  }

  /** 真正决定「现在弹不弹」：被别的浮层占着右下角时稍微等一等，不叠加 */
  function show(force) {
    // 「不再提示」是**硬门槛**：连设置里的手动唤起也不弹（否则等于没关掉）
    if (_read().neverAsk) return;
    if (!force && !_shouldShow()) return;
    var mep = document.getElementById("mapExportPanel");
    var ai = document.querySelector(".ogv-ai-root.open");
    if ((mep && !mep.hidden) || ai) {
      _timer = setTimeout(function () {
        show(force);
      }, 5000);
      return;
    }
    _lastShowAt = Date.now();
    _build();
  }

  // ── 全局事件 ──
  global.addEventListener("beforeinstallprompt", function (e) {
    global._pwaInstallPrompt = e; // 同时更新供「设置」手动触发
  });
  global.addEventListener("appinstalled", _markInstalled);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && _el) _dismiss();
  });

  /**
   * 没装就提醒：装没装是个硬状态，不看「弹过几次」。
   * 从后台切回前台 / 从 bfcache 回来时补一次（10 分钟内不重复，避免切来切去反复弹）。
   */
  function _recheck() {
    if (isStandalone()) {
      _markInstalled();
      return;
    }
    if (_el) return; // 已经在显示
    if (Date.now() - _lastShowAt < REFRESH_GAP) return;
    schedule(false);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") _recheck();
  });
  global.addEventListener("pageshow", function (e) {
    if (e && e.persisted) _recheck(); // bfcache 恢复
  });
  // 装好那一刻浏览器会切到 standalone，这里顺便把标记落盘
  try {
    var mq = global.matchMedia("(display-mode: standalone)");
    if (mq && mq.addEventListener) {
      mq.addEventListener("change", function (ev) {
        if (ev.matches) _markInstalled();
      });
    }
  } catch (e) {}

  /**
   * 补充判定：**从浏览器地址栏进来**（不是从桌面图标启动）时 standalone 检测不出来，
   * 而老用户可能在我们有这段代码之前就装过了 —— 他永远等不到 appinstalled。
   * Chrome 的 getInstalledRelatedApps() 能直接问系统「这台机器装了我吗」：
   * 同源 PWA 会出现在返回值里。没有这个 API / 查询失败都当「不知道」，不做任何假设。
   */
  function _probeRelated() {
    try {
      var nav = global.navigator;
      if (!nav || typeof nav.getInstalledRelatedApps !== "function") return;
      nav
        .getInstalledRelatedApps()
        .then(function (apps) {
          if (!apps || !apps.length) return;
          if (_read().installedAt) return;
          var st = _read();
          st.installedAt = Date.now();
          _write(st);
          _emit();
        })
        .catch(function () {});
    } catch (e) {}
  }

  // 对外：设置面板 / AI 想要「手动唤起安装提示」时调它
  global.OGVInstall = {
    /** 「自动提醒」的手动唤起：**仍受 neverAsk 约束**（用户说过别再烦他） */
    prompt: function () {
      schedule(true);
    },
    /**
     * 主动安装：用户在「操作 → 安装到桌面」拨开开关时走这里。
     * **不受 neverAsk 限制** —— neverAsk 只是「别自动弹窗」，不是「不许装」。
     * 有 beforeinstallprompt 就走原生弹窗，没有就给手动图文步骤（并广播状态，
     * 让开关回弹到「未安装」，绝不假装装上了）。
     */
    install: function () {
      _dismissedThisPage = false;
      if (isInstalled()) {
        _emit();
        return false;
      }
      _build();
      _doInstall();
      return true;
    },
    hide: _close,
    /** 永久不再提醒（设置里也可以给一个入口） */
    never: _never,
    setNeverAsk: setNeverAsk,
    neverAsk: function () {
      return !!_read().neverAsk;
    },
    isInstalled: isInstalled,
    isStandalone: isStandalone,
    /** 能不能走浏览器原生安装弹窗（决定面板里是「一键装」还是「给步骤」） */
    canPrompt: function () {
      return !!(
        global._pwaInstallPrompt &&
        typeof global._pwaInstallPrompt.prompt === "function"
      );
    },
    /** 订阅安装状态变化：装好 / 取消 / 改 neverAsk 都会回调 (isInstalled) */
    onChange: onChange,
    state: _read,
  };

  // 设置面板（app.js）比本文件先执行，「操作 → 安装到桌面」的开关早就渲染好了，
  // 但当时 OGVInstall 还不存在 → 它把首次同步挂在 window 上等我们。这里回一声。
  try {
    if (typeof global._syncPwaToggle === "function") global._syncPwaToggle();
  } catch (e) {}

  // 老用户（在我们的代码之前就装过、且从地址栏进来的）兜底认一次
  _probeRelated();

  // 等地图首屏稳定再弹（别和「加载中」叠在一起）
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      schedule(false);
    });
  } else {
    schedule(false);
  }
})(window);
