/**
 * app.js
 * 应用管理：版本号显示、清理菜单、导出图片、PWA 更新弹窗
 * 与地图核心逻辑无关，独立拆分以保持关注点分离
 * 加载时机：必须在 dialog.js + 主脚本块之后（依赖 showToast/map）
 *
 * ⚠️ 新增地图设置开关 → 在下方 TOGGLE_GROUPS 数据数组中添加一项即可
 */

// ========== 付费激活码（每月更新） ==========
var _PR_CODES = ["837291", "460518", "915742", "283604", "671849"];

// 统一存储层（geo-utils.js 提供，索引页第 16 行加载）—— 所有
// localStorage / sessionStorage 读写都经它，异常吞掉、坏值自愈、清理按前缀
var S = window.OGVStorage;
// 启动时回收历史废弃键（dupal_premium / dupal_toggle_sectionOpen）
S.dropObsoleteKeys();

(function () {
  // ========== 数据驱动渲染（必须在 toggleConfig 执行前创建 DOM）==========
  // 面板分两层，解决「设置项太多、找东西靠翻」的问题：
  //   ① #quickBar    —— 常用功能图标快捷区，置顶、一屏可达（quick: true 的项）
  //   ② #toggleBody  —— 全量开关按分类收进二级折叠 <details>
  // 两者不是两份设置：② 里才是真正持有状态的主控件（带 id，toggleConfig 按 id 注册、
  // geojsonloader 按 id 恢复），① 只是它的快捷入口 —— 读它的状态、点击时转发 change。
  // 所以 ① 里绝不能出现同 id 元素：重复 id 会让 getElementById 静默抓到错误的那一个。
  (function () {
    var quickBar = document.getElementById("quickBar");
    var body = document.getElementById("toggleBody");
    if (!body || body.children.length > 0) return;

    // 徽标刷新的 rAF 句柄（渲染① 结束时就会用到，必须在最前面初始化）
    var _badgeRaf = 0;

    // 字段说明：
    //   id       —— 必须是 toggleConfig 中的键（控件开关已按 id 注册）
    //   icon     —— 纯装饰性图标，语义由可见文字/aria-label 承担
    //   quick    —— true 时额外在快捷区放一个入口（二级折叠里依然保留，见上方说明）
    //   type     —— "button" 表示动作按钮（无开关状态），默认是开关
    var TOGGLE_GROUPS = [
      {
        category: "显示",
        items: [
          {
            id: "view3dToggle",
            label: "3D 视图",
            icon: "🌐",
            desc: "切换到 Cesium 3D 地球，支持地形起伏和多角度查看。首次启用需下载约 4MB 引擎库（有进度提示，可取消）；刷新页面后不会自动进入",
          },
          {
            id: "clusterToggle",
            label: "点要素聚类",
            icon: "🧩",
            quick: true,
            desc: "开启后点要素按空间距离聚合成群组显示，大幅减轻渲染压力，页面操作更流畅",
            checked: true,
          },
          {
            id: "labelToggle",
            label: "显示标签",
            icon: "🏷️",
            quick: true,
            desc: "开启后在地图上显示各点要素的名称标签，便于识别站位和热点位置",
          },
          {
            id: "graticuleToggle",
            label: "经纬度格网",
            icon: "▦",
            desc: "开启后在地图上显示经纬度网格线，并在边缘标注坐标，随缩放自动调整网格密度",
          },
          {
            id: "centerCrossToggle",
            label: "中心十字",
            icon: "✛",
            desc: "开启后在地图正中心渲染十字标记，帮助直观定位当前地图中心位置；关闭时移除",
          },
          {
            id: "optimizeSearchToggle",
            label: "优化搜索",
            icon: "🎯",
            desc: "开启后点击搜索结果缩放至目标时，仅突出显示该目标（隐藏同图层其他目标、淡化其他图层），移动或缩放地图后自动恢复",
            checked: true,
          },
        ],
      },
      {
        category: "控件",
        items: [
          {
            id: "legendToggle",
            label: "图例",
            icon: "🗂️",
            desc: "开启后在地图左下角显示当前可见图层的图例，包含颜色图块和图层名称",
            checked: true,
          },
          {
            id: "mouseCoordToggle",
            label: "鼠标坐标",
            icon: "🖱️",
            quick: true,
            desc: "开启/关闭鼠标位置经纬度坐标显示控件，实时查看光标所在位置的经纬度",
            checked: true,
          },
          {
            id: "zoomToggle",
            label: "缩放控件",
            icon: "➕",
            desc: "开启/关闭地图左上角的加减号缩放控件（仍可用鼠标滚轮缩放）；3D 模式下同步显示三视图切换与操作帮助按钮",
          },
          {
            id: "scaleToggle",
            label: "比例尺",
            icon: "📏",
            desc: "开启/关闭地图左下角的比例尺条，直观显示当前缩放级别下的距离比例",
          },
          {
            id: "geomenToggle",
            label: "编辑测量",
            icon: "📐",
            quick: true,
            desc: "开启/关闭要素编辑与测量工具栏（绘制、修改、删除、测距、测面）；绘制结果可用「测量转图层」导出为 GeoJSON",
          },
          {
            id: "layerCtrlToggle",
            label: "图层控件",
            icon: "🧭",
            desc: "开启/关闭右上角的图层切换控件，可切换天地图不同底图图层",
            checked: true,
          },
          {
            id: "moreBasemapToggle",
            label: "更多底图",
            icon: "🗺️",
            quick: true,
            desc: "开启后显示更多底图和覆盖层选项（ArcGIS扩展、天地图标注等）",
          },
        ],
      },
      {
        category: "数据",
        items: [
          {
            id: "clipboardToggle",
            label: "识别粘贴",
            icon: "📋",
            quick: true,
            desc: "开启后自动读取剪贴板中的坐标/CSV数据并解析为投点图层；关闭后需手动粘贴",
            checked: true,
          },
          {
            id: "rememberLayerToggle",
            label: "记住图层",
            icon: "💾",
            desc: "开启后记住用户上传的图层和勾选状态，刷新页面自动恢复",
            checked: true,
          },
        ],
      },
      {
        category: "高级",
        items: [
          {
            id: "isLocationTracking",
            label: "显示位置",
            icon: "📍",
            desc: "开启后持续获取设备 GPS 位置，在地图上实时显示当前位置标记",
          },
          {
            id: "elevationReadToggle",
            label: "读取高程",
            icon: "⛰️",
            quick: true,
            desc: "开启后点击地图任意位置，实时查询该坐标的高程/水深（数据源可切换，默认 GEBCO）",
          },
          {
            id: "darkModeToggle",
            label: "深色模式",
            icon: "🌙",
            desc: "开启后切换为深色主题，适合弱光环境使用，减少屏幕眩光",
          },
          {
            id: "premiumToggle",
            label: "高级功能",
            icon: "🕹️",
            desc: "开启后进入激活流程，输入激活码解锁下载 GeoJSON 等高级功能",
          },
          {
            id: "linkJumpToggle",
            label: "链接跳转",
            icon: "🔗",
            desc: "开启后注册 web+dupal 协议，可从地址栏 / 网页链接 / Win+R 直接打开 web+dupal://focus/南海 并自动聚焦对应区域（仅 Chrome/Edge 有效，且需在 https 下）",
          },
        ],
      },
      {
        category: "操作",
        items: [
          {
            type: "button",
            id: "exportMapBtn",
            label: "导出图片",
            icon: "📷",
            quick: true,
            desc: "将当前地图截图导出为 PNG 图片（快捷键 Ctrl/⌘ + E）",
          },
        ],
      },
    ];

    function escapeAttr(s) {
      return String(s === undefined || s === null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    // ---- 渲染 ①：常用功能快捷区（图标 + 文字）----
    var quickHtml = "";
    var quickNum = 0;
    for (var qg = 0; qg < TOGGLE_GROUPS.length; qg++) {
      var qItems = TOGGLE_GROUPS[qg].items;
      for (var qi = 0; qi < qItems.length; qi++) {
        var q = qItems[qi];
        if (!q.quick) continue;
        quickNum++;
        // 统一用原生 <button>：
        //   ① 快捷区不是独立的表单控件，只是「地图设置」里那个开关的快捷入口，
        //      用 aria-pressed 表达开关状态，语义比「第二个 checkbox」准确
        //   ② button 自带 :active / :focus-visible / 键盘 Enter·Space，
        //      按压反馈由 CSS 直接给，不必再靠透明 checkbox 铺满整块
        if (q.type === "button") {
          quickHtml +=
            '<button type="button" class="quick-item" id="' +
            q.id +
            '" data-action="' +
            q.id +
            '" title="' +
            escapeAttr(q.desc) +
            '">' +
            '<span class="quick-icon" aria-hidden="true">' +
            (q.icon || "•") +
            "</span>" +
            '<span class="quick-text">' +
            q.label +
            "</span>" +
            "</button>";
        } else {
          quickHtml +=
            '<button type="button" class="quick-item" id="' +
            q.id +
            'Quick" data-quick-for="' +
            q.id +
            '" aria-pressed="false" title="' +
            escapeAttr(q.desc) +
            '">' +
            '<span class="quick-icon" aria-hidden="true">' +
            (q.icon || "•") +
            "</span>" +
            '<span class="quick-text">' +
            q.label +
            "</span>" +
            "</button>";
        }
      }
    }
    quickHtml =
      '<div class="quick-bar-title" id="quickBarTitle"' +
      ' title="这里只是下方「地图设置」里对应开关的快捷方式，状态与那边完全同步">' +
      "⚡ 常用功能</div>" +
      '<div class="quick-grid">' +
      quickHtml +
      "</div>";
    if (quickBar) {
      quickBar.innerHTML = quickHtml;

      // 快捷区的状态单向来源于「地图设置」里的 checkbox（唯一数据源）。
      // 做成可重复调用的全局函数：有些开关（点聚类、显示标签）不在 toggleConfig 里，
      // 由 geojsonloader.js 在更晚的时机按 localStorage 恢复；地图设置那边也可能
      // 被程序化改动（搜索框清空、退出 3D 等），所以任何时刻都能重算一次。
      window._syncQuickStates = function () {
        var items = quickBar.querySelectorAll("[data-quick-for]");
        for (var i = 0; i < items.length; i++) {
          var master = document.getElementById(
            items[i].getAttribute("data-quick-for"),
          );
          var on = !!(master && master.checked);
          items[i].classList.toggle("is-on", on);
          items[i].setAttribute("aria-pressed", on ? "true" : "false");
        }
        // 徽标和快捷区读的是同一批 checkbox —— 顺手一起刷，省得每个调用点都补一遍
        if (typeof requestSubBadges === "function") requestSubBadges();
      };
      window._syncQuickStates();

      // 点快捷项 = 拨动地图设置里的那个开关，让它走完整流程
      // （localStorage 持久化 / enable·disable / 分类徽标刷新都挂在那一边）
      quickBar.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest && e.target.closest("[data-quick-for]");
        if (!btn || !quickBar.contains(btn)) return;
        var master = document.getElementById(btn.getAttribute("data-quick-for"));
        if (!master) return;
        master.checked = !master.checked;
        master.dispatchEvent(new Event("change", { bubbles: true }));
        window._syncQuickStates();
      });

      // 反向兜底：地图设置里的开关被别处改动时，快捷区跟着变
      document.addEventListener("change", function (e) {
        if (e.target && e.target.type === "checkbox") window._syncQuickStates();
      });

      // 补齐「加载后才被其他模块恢复」的开关状态
      window.addEventListener("load", function () {
        setTimeout(window._syncQuickStates, 0);
        setTimeout(window._syncQuickStates, 900);
      });
    }

    // ---- 渲染 ②：地图设置（全量开关）→ 按分类的二级折叠 ----
    // 快捷区是「地图设置」的快捷方式，不是另一份设置：每个开关在这里都有实体，
    // 快捷项额外在置顶区有一个入口。面板这一份才是主控件（在 toggleConfig 里注册、
    // 带 id），快捷区只读它的状态、点它来切换。
    var html = "";
    for (var gi = 0; gi < TOGGLE_GROUPS.length; gi++) {
      var group = TOGGLE_GROUPS[gi];
      if (!group.items.length) continue;

      html +=
        '<details class="toggle-sub" id="toggleSub' +
        gi +
        '" data-persist-details>' +
        '<summary>' +
        '<span class="toggle-sub-name">' +
        group.category +
        "</span>" +
        '<span class="toggle-sub-badge" id="toggleSubBadge' +
        gi +
        '"></span>' +
        "</summary>" +
        '<div class="toggle-sub-body">';

      for (var jj = 0; jj < group.items.length; jj++) {
        var item = group.items[jj];
        if (item.type === "button") {
          // 动作按钮：快捷区那份带 id，这里的镜像靠 data-action 绑定
          html +=
            '<div class="toggle-bar" id="' +
            item.id +
            'Bar" title="' +
            escapeAttr(item.desc) +
            '">' +
            '<button class="action-btn" data-action="' +
            item.id +
            '">' +
            (item.icon ? item.icon + " " : "") +
            item.label +
            "</button>" +
            "</div>";
        } else {
          // 开关一律带 id：这一份是「主控件」（toggleConfig 按 id 注册、
          // geojsonloader 按 id 恢复），快捷区只是它的另一个入口。
          // 也正因如此，同一个 id 只能出现在这里 —— 快捷区用的是 <button>，不带 checkbox。
          html +=
            '<div class="toggle-bar" id="' +
            item.id +
            'Bar" title="' +
            escapeAttr(item.desc) +
            '">' +
            '<label class="cluster-toggle-label">' +
            '<span class="cluster-toggle-text">' +
            (item.icon ? item.icon + " " : "") +
            item.label +
            "</span>" +
            '<input type="checkbox" id="' +
            item.id +
            '"' +
            (item.checked ? " checked" : "") +
            ">" +
            '<span class="cluster-toggle-switch"></span>' +
            "</label>" +
            "</div>";
        }
      }
      html += "</div></details>";
    }
    body.innerHTML = html;

    // 主控件就位后补一次同步：渲染①时地图设置还没生成，快捷区拿不到状态
    if (window._syncQuickStates) window._syncQuickStates();

    // 子分组徽标：显示「已开 / 总数」，让折叠状态下也能一眼看出哪里开着东西
    //
    // ⚠️ 徽标读的是 checkbox 的**实时**状态，但开关是在渲染之后才恢复的：
    //    initToggle 是程序化赋值（cb.checked = x）—— **不触发 change**；
    //    cluster / label 更晚，由 geojsonloader 恢复。而「高级」组五项默认全是关的，
    //    所以「渲染时算一次 + 只监听 change」会永久停在 0/5：
    //    激活高级功能后还是 0/5，随手拨一个别的才跳成 2/5，刷新又回到 0/5。
    //
    // 修法：刷新收敛成一个**幂等**入口 requestSubBadges()，谁改了开关都调它，
    //      内部用 rAF 合并（同一帧内改 20 个开关也只重算一次），重复调用零成本。
    function updateSubBadges() {
      var subs = body.querySelectorAll("details.toggle-sub");
      for (var i = 0; i < subs.length; i++) {
        var sub = subs[i];
        var boxes = sub.querySelectorAll('input[type="checkbox"]');
        var badge = sub.querySelector(".toggle-sub-badge");
        if (!badge) continue;
        var on = 0;
        for (var b = 0; b < boxes.length; b++) if (boxes[b].checked) on++;
        if (boxes.length) {
          badge.textContent = on + "/" + boxes.length;
          badge.classList.toggle("has-on", on > 0);
        } else {
          // 纯动作按钮的分类（「操作」）没有开关可统计，
          // 退化成项目数，避免折叠标题右侧空着一块
          var acts = sub.querySelectorAll(".action-btn").length;
          badge.textContent = acts ? acts + " 项" : "";
          badge.classList.remove("has-on");
        }
      }
    }
    // rAF 合并：把同一帧内的 N 次请求压成一次重算
    function requestSubBadges() {
      if (_badgeRaf) return;
      var raf =
        window.requestAnimationFrame ||
        function (fn) {
          return setTimeout(fn, 16);
        };
      _badgeRaf = raf(function () {
        _badgeRaf = 0;
        updateSubBadges();
      });
    }
    // 对外暴露：其他模块（geojsonloader 恢复 cluster/label）也能主动触发一次
    window._updateSubBadges = requestSubBadges;

    body.addEventListener("change", function (e) {
      if (e.target && e.target.type === "checkbox") requestSubBadges();
    });
    // 兜底：<details> 的 toggle 事件不冒泡，但**会走捕获阶段** —— 展开/收起分组时
    // 再刷一次，保证只要徽标看得见就是准的
    body.addEventListener(
      "toggle",
      function (e) {
        if (
          e.target &&
          e.target.classList &&
          e.target.classList.contains("toggle-sub")
        )
          requestSubBadges();
      },
      true,
    );
    // 面板首次渲染 / 重开时各刷一次
    requestSubBadges();
    updateSubBadges();

    // 动作按钮：快捷区和地图设置里各有一个入口，用 data-action 统一绑定，
    // 不再依赖 id（面板里那个是镜像，不能重复用 id）
    var ACTION_HANDLERS = {
      exportMapBtn: exportMapImage,
    };
    var actionEls = document.querySelectorAll("[data-action]");
    for (var ai = 0; ai < actionEls.length; ai++) {
      (function (el) {
        var fn = ACTION_HANDLERS[el.getAttribute("data-action")];
        if (fn) {
          el.addEventListener("click", function () {
            fn();
          });
        }
      })(actionEls[ai]);
    }
  })();

  // ========== 版本号显示 ==========
  // 版号 = 当前真正控制页面的 Service Worker 的版本。
  // 由页面主动向 controlling SW 请求（GET_VERSION），SW 回传其 CACHE_NAME，
  // 保证 div 显示的是「正在运行的版本」，而不是将来才生效的新版本。
  var _appVersion = "";
  // 用户点了弹窗刷新后才置 true，避免首次访问被 controllerchange 误触发 reload
  var _needsReload = false;
  function setAppVersion(v) {
    if (!v) return;
    _appVersion = v;
    var el = document.getElementById("appVersion");
    if (el) el.textContent = v;
  }
  function requestAppVersion() {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "GET_VERSION" });
    }
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.type === "SW_VERSION") setAppVersion(e.data.version);
    });
    // 新 SW 接管页面（点击刷新触发 skipWaiting 之后）才会进入这里
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      requestAppVersion();
      if (_needsReload) {
        _needsReload = false;
        location.reload();
      }
    });
    // 页面加载且 SW 已控制时，主动问一次版本
    window.addEventListener("load", requestAppVersion);
  }

  // ========== 深链 / 关键词跳转（web+dupal 协议 + hash 深链）==========
  // 能力：focus/南海（curated bbox）、search/南海（复用现有搜索）、loc/23.5,119.8,6、bbox/0,105,25,122
  // 来源：① web+dupal:// 协议（manifest protocol_handlers 注册，PWA 安装即生效）
  //       ② #focus/南海 或 #focus=南海（hash 深链，分享友好）
  // 检测端（浏览器插件 / 桌面 helper）只通过 url 或 postMessage 通信，不依赖地图内部实现。
  (function () {
    function getPlaceRegistry() {
      return window.PLACE_REGISTRY || [];
    }

    // 解析地名注册表（精确名/别名 → 模糊包含）
    function resolveRegion(name) {
      var q = String(name || "")
        .trim()
        .toLowerCase();
      if (!q) return null;
      var list = getPlaceRegistry();
      for (var i = 0; i < list.length; i++) {
        if (list[i].name && list[i].name.toLowerCase() === q) return list[i];
      }
      for (var j = 0; j < list.length; j++) {
        var aliases = list[j].aliases || [];
        for (var a = 0; a < aliases.length; a++) {
          if (aliases[a].toLowerCase() === q) return list[j];
        }
      }
      for (var k = 0; k < list.length; k++) {
        var hay = (list[k].name || "").toLowerCase();
        if (hay && hay.indexOf(q) !== -1) return list[k];
      }
      return null;
    }

    function flyToRegion(name) {
      var reg = resolveRegion(name);
      if (!reg) return false;
      var map = window.map;
      if (!map) return false;
      if (reg.center) {
        map.setView(reg.center, reg.zoom || 6, { animate: true });
      } else if (reg.bbox) {
        map.fitBounds(reg.bbox, {
          padding: [40, 40],
          maxZoom: reg.zoom || 14,
          animate: true,
        });
      } else {
        return false;
      }
      return true;
    }

    // 复用现有搜索：取 top1 要素结果 → highlightAndLocateFeature（按真实坐标定位，无需图层已渲染）
    // 搜索索引为异步构建，故带重试直到命中或超时
    function focusFeature(name) {
      return new Promise(function (resolve) {
        if (!window.__OGV_search || !window.__OGV_highlight) {
          resolve(false);
          return;
        }
        var tries = 20; // 最多 ~8s 等索引就绪
        var attempt = function () {
          var res = window.__OGV_search(name);
          var items = res && res.items ? res.items : [];
          var featItem = null;
          for (var i = 0; i < items.length; i++) {
            if (items[i].type === "feature" && items[i].feature) {
              featItem = items[i];
              break;
            }
          }
          if (!featItem) {
            for (var m = 0; m < items.length; m++) {
              if (items[m].feature) {
                featItem = items[m];
                break;
              }
            }
          }
          if (featItem) {
            window.__OGV_highlight(featItem.checkboxId, featItem.feature);
            resolve(true);
          } else if (tries-- > 0) {
            setTimeout(attempt, 400);
          } else {
            resolve(false);
          }
        };
        attempt();
      });
    }

    function flyToBbox(bbox, zoom) {
      var map = window.map;
      if (!map || !bbox) return false;
      var b = L.latLngBounds(bbox);
      if (!b.isValid()) return false;
      map.fitBounds(b, {
        padding: [40, 40],
        maxZoom: zoom || 14,
        animate: true,
      });
      return true;
    }

    function flyToLoc(lat, lng, zoom) {
      var map = window.map;
      if (!map || isNaN(lat) || isNaN(lng)) return false;
      map.setView([lat, lng], zoom || Math.max(map.getZoom(), 8), {
        animate: true,
      });
      return true;
    }

    // 命令解析：path 式 focus/南海 与 param 式 #focus=南海 双支持
    function parseCommand(str) {
      if (!str) return null;
      str = decodeURIComponent(str).trim();
      if (str.indexOf("=") !== -1 && str.indexOf("/") === -1) {
        var eq = str.indexOf("=");
        return {
          action: str.slice(0, eq).trim(),
          arg: str.slice(eq + 1).trim(),
        };
      }
      var slash = str.indexOf("/");
      if (slash !== -1) {
        return {
          action: str.slice(0, slash).trim(),
          arg: str.slice(slash + 1).trim(),
        };
      }
      return { action: "focus", arg: str }; // 仅关键词则默认当区域
    }

    function execCommand(cmd) {
      if (!cmd || !window.map) return Promise.resolve(false);
      var arg = cmd.arg;
      switch (cmd.action) {
        case "focus":
        case "region":
          return Promise.resolve(flyToRegion(arg));
        case "search":
        case "feature":
          return focusFeature(arg);
        case "loc":
        case "coords":
        case "coord": {
          var p = arg.split(",").map(Number);
          return Promise.resolve(flyToLoc(p[0], p[1], p[2]));
        }
        case "bbox": {
          var b = arg.split(",").map(Number);
          return Promise.resolve(
            flyToBbox(
              [
                [b[0], b[1]],
                [b[2], b[3]],
              ],
              b[4],
            ),
          );
        }
        default:
          return focusFeature(arg); // 未知 action 退化搜索
      }
    }

    function sendAck(e, ok, name) {
      try {
        if (e.source && e.origin)
          e.source.postMessage(
            { type: "OGV_FOCUS_ACK", ok: ok, name: name },
            e.origin,
          );
      } catch (err) {}
    }

    // 对外程序化 API（插件 / 桌面 / 控制台可用）
    window.OGV = {
      flyToRegion: flyToRegion,
      focusFeature: focusFeature,
      flyToBbox: flyToBbox,
      flyToLoc: flyToLoc,
      resolveRegion: resolveRegion,
      listPlaces: function () {
        return getPlaceRegistry().map(function (r) {
          return { name: r.name, aliases: r.aliases || [] };
        });
      },
      exec: execCommand,
      parse: parseCommand,
    };

    // postMessage 桥：已开标签页平滑跳转（不刷新），优先 region 后 feature
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.type !== "OGV_FOCUS") return;
      var mode = d.mode || "auto";
      var name = d.name;
      if (mode === "region") {
        sendAck(e, flyToRegion(name), name);
      } else if (mode === "feature") {
        focusFeature(name).then(function (v) {
          sendAck(e, v, name);
        });
      } else {
        if (flyToRegion(name)) sendAck(e, true, name);
        else
          focusFeature(name).then(function (v) {
            sendAck(e, v, name);
          });
      }
    });

    // 命令来源：优先 web+dupal 协议参数，其次 hash
    function getCommandSource() {
      try {
        var proto = new URLSearchParams(window.location.search).get("proto");
        if (proto && proto.indexOf("web+dupal://") === 0) {
          return { raw: proto.slice("web+dupal://".length), fromProto: true };
        }
      } catch (err) {}
      if (window.location.hash && window.location.hash.length > 1) {
        return { raw: window.location.hash.slice(1), fromProto: false };
      }
      return null;
    }

    function runDeepLink() {
      var src = getCommandSource();
      if (!src || !src.raw) return;
      var cmd = parseCommand(src.raw);
      execCommand(cmd).then(function (ok) {
        if (ok === false && window.showToast) {
          window.showToast("未找到：" + (cmd ? cmd.arg : src.raw));
        }
        // 协议来源：规范化成 hash，使刷新/分享可复现；replaceState 不会触发 hashchange
        if (src.fromProto && cmd) {
          try {
            window.history.replaceState(
              {},
              document.title,
              window.location.pathname + "#" + cmd.action + "/" + cmd.arg,
            );
          } catch (err) {}
        }
      });
    }

    // 地图为同步创建，load 时延 600ms 确保图层/索引开始加载；search 类命令内部自带重试
    window.addEventListener("load", function () {
      setTimeout(runDeepLink, 600);
    });
    window.addEventListener("hashchange", function () {
      setTimeout(runDeepLink, 0);
    });
  })();

  // ========== 版号点击 → 清理菜单 ==========
  (function () {
    var el = document.getElementById("appVersion");
    if (!el) return;

    function clearSWCache() {
      if (!window.caches) return Promise.resolve();
      return caches.keys().then(function (names) {
        return Promise.all(
          names.map(function (n) {
            return caches.delete(n);
          }),
        );
      });
    }
    function clearIDB() {
      if (window.L && window.L.GzIdbLoader && window.L.GzIdbLoader.clearCache) {
        return window.L.GzIdbLoader.clearCache();
      }
      return new Promise(function (resolve) {
        var req = indexedDB.deleteDatabase("GzGeoJSONCache");
        req.onsuccess = req.onerror = resolve;
      });
    }
    function doRefresh(all) {
      // ⚠️ 不能用 localStorage.clear()：它按 origin 清，会连带删掉
      //   ① 同域其他页面（如写真集 tthh）的数据
      //   ② 用户上传图层的清单 dupal_user_layers —— 一删，IndexedDB 里的
      //      数据就再也找不到主人，变成永久孤儿
      // 统一走存储层：只清本应用的键，且保留「用户资产」
      S.clearResettable();
      var tasks = [clearSWCache()];
      if (all) tasks.push(clearIDB());
      Promise.all(tasks).then(function () {
        location.reload(true);
      });
    }
    function toggleMenu() {
      // 菜单是 #appVersion 的前一个兄弟节点
      var menu = el.previousElementSibling;
      if (!menu || !menu.classList.contains("refresh-menu")) {
        menu = null;
      }
      if (menu) {
        menu.remove();
        return;
      }
      menu = document.createElement("div");
      menu.className = "refresh-menu";
      menu.innerHTML =
        '<button data-mode="export">📷 导出图片</button>' +
        '<button data-mode="refresh">🔄 刷新页面</button>' +
        '<button data-mode="sw">🧹 清理网页缓存</button>' +
        '<button data-mode="all">🗑️ 彻底清理</button>' +
        '<button id="changelogBtn">📝 更新记录</button>';
      menu.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-mode]");
        if (!btn) return;
        menu.remove();
        if (btn.dataset.mode === "export") {
          exportMapImage();
        } else if (btn.dataset.mode === "refresh") {
          location.reload();
        } else {
          doRefresh(btn.dataset.mode === "all");
        }
      });
      // 插入到 #appVersion 前面（版号上方）
      el.parentNode.insertBefore(menu, el);

      // 更新记录按钮事件
      setTimeout(function () {
        var clogBtn = document.getElementById("changelogBtn");
        if (clogBtn) {
          clogBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            menu.remove();
            showMarkdown("docs/CHANGELOG.md", "📝 更新记录");
          });
        }
      }, 0);
    }

    el.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleMenu();
    });
  })();

  // ========== 导出地图图片 ==========
  // 主方案：navigator.mediaDevices.getDisplayMedia() 系统屏幕截图。
  //   截图前隐藏侧边栏/控件，从视频帧裁剪到地图区域，统一 scale 防拉伸。
  // 降级方案（iOS / 不支持 getDisplayMedia 的平台）：
  //   隐藏 UI → 显示系统截图指引 → 用户自行截图后移动/缩放地图恢复。
  function exportMapImage() {
    if (!window.map) return;
    // 关掉已有 toast
    if (window._exportToast) {
      closeToast(window._exportToast);
      window._exportToast = null;
    }

    var mapEl = document.getElementById("map");
    var panel = document.getElementById("layerPanel");
    var trigger = document.getElementById("layerTrigger");
    var controlContainer = document.querySelector(".leaflet-control-container");
    var waybackBar = document.getElementById("waybackBar");

    // 记录原始状态用于恢复
    var panelWasActive = panel && panel.classList.contains("active");
    var panelOrigDisplay = panel ? panel.style.display : null;

    // ----- 辅助：恢复 UI -----
    function restoreUI() {
      if (panel) panel.style.display = panelOrigDisplay || "";
      if (panelWasActive && panel) panel.classList.add("active");
      if (trigger) trigger.style.display = "";
      if (controlContainer) controlContainer.style.display = "";
      if (waybackBar) waybackBar.style.display = "";
      map.invalidateSize();
      // 移除降级监听（如果有）
      map.off("movestart zoomstart", restoreUI);
    }

    // 隐藏侧边栏 + 触发按钮 + 地图控件 + 底部时相条
    if (panelWasActive) panel.classList.remove("active");
    if (panel) panel.style.display = "none";
    if (trigger) trigger.style.display = "none";
    if (controlContainer) controlContainer.style.display = "none";
    if (waybackBar) waybackBar.style.display = "none";

    // ----- iOS 检测（必须放在 getDisplayMedia 前面）-----
    // iOS 16.4+ 也有了 getDisplayMedia，但唤起的是屏幕录制而不是标签页选择器，
    // 不符合我们的截图需求。iOS 先用 html-to-image 截取地图区域（避免系统截图
    // 包含手机界面元素），失败时降级到系统截图指引。
    var isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    if (isIOS) {
      // ----- iOS 方案：html-to-image 截取地图区域 -----
      if (!window.htmlToImage) {
        showToast("❌ 截图库未加载", { duration: 3000 });
        restoreUI();
        return;
      }

      // 注入临时样式：禁用瓦片过渡/淡入动画
      var tempStyleId = "_export_disable_tile_transition";
      var tempStyle = document.getElementById(tempStyleId);
      if (!tempStyle) {
        tempStyle = document.createElement("style");
        tempStyle.id = tempStyleId;
        tempStyle.textContent =
          ".leaflet-tile-pane img.leaflet-tile { transition: none !important; animation: none !important; opacity: 1 !important; }" +
          ".leaflet-tile-pane { transition: none !important; animation: none !important; }";
        document.head.appendChild(tempStyle);
      }

      // 等两帧让 UI 隐藏 + 瓦片稳定
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          htmlToImage
            .toPng(mapEl, {
              backgroundColor: "#fff",
              pixelRatio: Math.min(window.devicePixelRatio || 2, 3),
              filter: function (node) {
                if (!node || !node.classList) return true;
                if (node.closest) {
                  return !node.closest(
                    ".leaflet-control-container, .leaflet-control, .leaflet-popup",
                  );
                }
                return true;
              },
            })
            .then(function (dataUrl) {
              if (tempStyle && tempStyle.parentNode)
                tempStyle.parentNode.removeChild(tempStyle);
              restoreUI();
              var now = new Date();
              var ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
                .map(function (n) {
                  return String(n).padStart(2, "0");
                })
                .join("");
              var a = document.createElement("a");
              a.download = "OGV_" + ts + ".png";
              a.href = dataUrl;
              a.click();
              showToast("✅ 导出成功", { duration: 3000 });
            })
            .catch(function () {
              // html-to-image 失败 → 降级到系统截图指引
              if (tempStyle && tempStyle.parentNode)
                tempStyle.parentNode.removeChild(tempStyle);
              showToast("📱 请使用系统截图（电源键+音量上）后移动地图恢复", {
                duration: 0,
              });
              map.once("movestart zoomstart", function () {
                restoreUI();
                if (window._exportToast) {
                  closeToast(window._exportToast);
                  window._exportToast = null;
                }
                showToast("✅ 已恢复界面", { duration: 2000 });
              });
            });
        });
      });
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      // ----- 降级方案（不支持 getDisplayMedia 的非 iOS 平台）-----
      showToast("📸 请使用系统截图后缩放或移动地图恢复", { duration: 0 });
      map.once("movestart zoomstart", function () {
        restoreUI();
        if (window._exportToast) {
          closeToast(window._exportToast);
          window._exportToast = null;
        }
        showToast("✅ 已恢复界面", { duration: 2000 });
      });
      return;
    }

    // ----- 主方案：getDisplayMedia（桌面浏览器）-----
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      // 等两帧让 UI 隐藏
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var now = new Date();
          var ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(function (n) {
              return String(n).padStart(2, "0");
            })
            .join("");

          navigator.mediaDevices
            .getDisplayMedia({
              preferCurrentTab: true,
              video: { width: { ideal: 99999 }, height: { ideal: 99999 } },
            })
            .then(function (stream) {
              var video = document.createElement("video");
              video.srcObject = stream;
              video.onloadedmetadata = function () {
                video.play().then(function () {
                  if (window._exportToast) {
                    closeToast(window._exportToast);
                    window._exportToast = null;
                  }

                  requestAnimationFrame(function () {
                    var mr = mapEl.getBoundingClientRect();
                    var vw = video.videoWidth;
                    var vh = video.videoHeight;
                    var scale = vw / window.innerWidth;
                    var pixelRatio = Math.min(window.devicePixelRatio || 2, 3);

                    var canvas = document.createElement("canvas");
                    canvas.width = mr.width * pixelRatio;
                    canvas.height = mr.height * pixelRatio;
                    var ctx = canvas.getContext("2d");

                    ctx.drawImage(
                      video,
                      mr.left * scale,
                      mr.top * scale,
                      mr.width * scale,
                      mr.height * scale,
                      0,
                      0,
                      canvas.width,
                      canvas.height,
                    );

                    stream.getTracks().forEach(function (t) {
                      t.stop();
                    });

                    canvas.toBlob(function (blob) {
                      if (!blob) {
                        var dataUrl = canvas.toDataURL("image/png");
                        if (dataUrl && dataUrl.indexOf("data:image") === 0) {
                          blob = dataURLToBlob(dataUrl);
                        }
                      }
                      if (blob) {
                        var url = URL.createObjectURL(blob);
                        var a = document.createElement("a");
                        a.download = "OGV_" + ts + ".png";
                        a.href = url;
                        a.click();
                        URL.revokeObjectURL(url);
                        showToast("✅ 导出成功", { duration: 3000 });
                      } else {
                        showToast("❌ 导出失败", { duration: 3000 });
                      }
                      restoreUI();
                    });
                  });
                });
              };
              video.onerror = function () {
                stream.getTracks().forEach(function (t) {
                  t.stop();
                });
                showToast("❌ 截图失败", { duration: 3000 });
                restoreUI();
              };
            })
            .catch(function () {
              // 用户取消
              restoreUI();
            });
        });
      });
      return;
    }
  }

  // 辅助：dataURL → Blob（用于降级）
  function dataURLToBlob(dataUrl) {
    var parts = dataUrl.split(",");
    var mime = parts[0].match(/:(.*?);/)[1];
    var bstr = atob(parts[1]);
    var n = bstr.length;
    var u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], { type: mime });
  }

  // Ctrl+E 快捷键导出图片
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault();
      exportMapImage();
    }
  });

  // ========== SW 更新弹窗 ==========
  var _swRegistration = null;

  window._showUpdateToast = function (newVersion) {
    var versionLabel = newVersion || _appVersion || "";
    var msg = versionLabel
      ? "新版本 " + versionLabel + " 已就绪"
      : "📦 新版本可用";
    showToast(msg, {
      duration: 0,
      action: "刷新",
      onAction: function () {
        // 通知新 SW 激活；真正 reload 由 controllerchange 在接管页面后执行，
        // 保证 reload 时已经由新 SW 控制、能拉到新资源（geojsonloader 等）
        _needsReload = true;
        if (_swRegistration && _swRegistration.waiting) {
          _swRegistration.waiting.postMessage({ action: "skipWaiting" });
        }
      },
    });
  };
  if (window._swUpdateAvailable) window._showUpdateToast(_appVersion);

  // ========== Service Worker 注册 ==========
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("service-worker.js")
        .then(function (registration) {
          _swRegistration = registration;

          // 检测新版本：SW 文件变化时会触发 updatefound
          registration.addEventListener("updatefound", function () {
            var newWorker = registration.installing;
            newWorker.addEventListener("statechange", function () {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // 新 SW 已安装且旧 SW 仍在控制页面 → 有更新可用
                window._swUpdateAvailable = true;
                // 尝试读取新 SW 的版本号（当前页面还是旧版本）
                var _newVersion = "";
                try {
                  fetch("service-worker.js?" + Date.now())
                    .then(function (r) {
                      return r.text();
                    })
                    .then(function (src) {
                      var m = src.match(/CACHE_NAME\s*=\s*["']([^"']+)["']/);
                      if (m) _newVersion = m[1];
                    })
                    .finally(function () {
                      if (window._showUpdateToast)
                        window._showUpdateToast(_newVersion);
                    });
                } catch (e) {
                  if (window._showUpdateToast) window._showUpdateToast();
                }
              }
            });
          });
        })
        .catch(function (error) {
          console.error("Service Worker注册失败：", error);
        });
    });
  }

  // ========== 自动识别剪贴板开关初始化 ==========
  (function () {
    var cb = document.getElementById("clipboardToggle");
    if (cb) {
      cb.checked = S.getBool(S.KEY.TOGGLE + "clipboard", true); // 默认开启
      cb.addEventListener("change", function () {
        S.safeSet(S.KEY.TOGGLE + "clipboard", String(this.checked));
      });
    }
  })();

  // ========== 记住图层开关初始化 ==========
  (function () {
    var cb = document.getElementById("rememberLayerToggle");
    if (cb) {
      cb.checked = S.getBool(S.KEY.TOGGLE + "rememberLayer", true); // 默认开启
      cb.addEventListener("change", function () {
        S.safeSet(S.KEY.TOGGLE + "rememberLayer", String(this.checked));
        if (!this.checked) {
          // 关闭 → 只清除勾选状态，不删除用户图层数据
          // ⚠️ 必须排除 LAYER_SETTINGS（dupal_layer_set_ 也以 dupal_layer_ 开头）:
          //    颜色/透明度不属于「记住图层」的语义，不该被顺手清掉
          [S.KEY.LAYER_CHECK, S.KEY.USER_LAYER_CHECK].forEach(function (p) {
            S.keysWithPrefix(p).forEach(function (k) {
              if (k.indexOf(S.KEY.LAYER_SETTINGS) !== 0) S.safeRemove(k);
            });
          });
        } else {
          // 打开 → 保存当前所有用户图层
          var userLayerGeoJson = window._userLayerGeoJson || {};
          Object.keys(userLayerGeoJson).forEach(function (uid) {
            var info = userLayerGeoJson[uid];
            if (info && info.persistentId) {
              var pid = info.persistentId;
              L.GzIdbLoader.setCache("user_geo_" + pid, info.geoJsonData);
              var list2 = S.getJSON(S.KEY.USER_LAYER_LIST, []);
              if (!Array.isArray(list2)) list2 = [];
              if (
                !list2.find(function (e) {
                  return e.id === pid;
                })
              ) {
                list2.push({ id: pid, fileName: info.fileName });
                S.setJSON(S.KEY.USER_LAYER_LIST, list2);
              }
            }
          });
        }
      });
    }
  })();

  // ========== 更多底图开关初始化及事件绑定 ==========
  (function () {
    var cb = document.getElementById("moreBasemapToggle");
    if (cb) {
      cb.checked = S.getBool(S.KEY.TOGGLE + "moreBasemap", false);
      cb.addEventListener("change", function () {
        S.safeSet(S.KEY.TOGGLE + "moreBasemap", String(this.checked));
        if (typeof window.rebuildLayerCtrl === "function")
          window.rebuildLayerCtrl();
      });
    }
  })();
})();

// ========== 地图控件开关持久化 ==========
(function () {
  var TOGGLE_PREFIX = "dupal_toggle_";

  // Geoman 选项
  var GEOMEN_OPTS = {
    position: "topright",
    drawCircleMarker: true,
    drawText: true,
    drawMarker: false,
    drawCircle: true,
    drawPolyline: true,
    drawPolygon: true,
    drawRectangle: false,
    editMode: false,
    dragMode: true,
    cutPolygon: false,
    rotateMode: false,
    removalMode: true,
  };

  // 上面是「工具条上放哪些按钮」；下面是「绘制过程中的键盘行为」，
  // 两者在 Geoman 里是两套配置（addControls 不吃 finishOnEnter），必须分开给。
  // 这份 Geoman 的默认值是 finishOnEnter:false / exitModeOnEscape:false
  // （leaflet-geoman.js 内 `exitModeOnEscape:!1,finishOnEnter:!1`），
  // 后果是画线/画多边形时**只能用鼠标双击、或点回起点**才能收尾，Esc 也退不出去
  // —— 纯键盘用户无法完成一次测量（WCAG 2.1.1 键盘可操作，A 级）。
  // 打开后：回车 = 结束当前图形，Esc = 取消当前绘制。
  // 二者都只在「真的有某个绘制模式在跑」时才生效（_handleEnterKey 先查
  // getActiveShape()、_handleEscapeKey 先查 global*ModeEnabled()），
  // 所以不会抢走搜索框等别处的回车 / Esc。
  var GEOMEN_GLOBAL_OPTS = {
    finishOnEnter: true,
    exitModeOnEscape: true,
  };

  // 高程读取插件单例（懒加载，绑定到地图）
  function ensureElevationQuery() {
    if (!window._elevationQuery) {
      window._elevationQuery = map.elevationQuery({
        source: "gebco", // 默认 GEBCO WMS；后续换源改这里或调用 eq.setSource(...)
      });
    }
    return window._elevationQuery;
  }

  // 开关配置：cbId → { storageKey, control?, enable?, disable? }
  // 深色模式切换时重建格网（换配色；仅当格网已开启）
  function rebuildGraticuleTheme() {
    var cb = document.getElementById("graticuleToggle");
    if (!cb || !cb.checked) return;
    // Canvas 网格线：插件无 setStyle，重建换色
    if (window._graticuleLayer) {
      toggleConfig.graticuleToggle.disable();
      toggleConfig.graticuleToggle.enable();
    }
  }

  var toggleConfig = {
    view3dToggle: {
      storageKey: TOGGLE_PREFIX + "view3d",
      enable: function (userInitiated) {
        if (window.CesiumViewer) {
          window.CesiumViewer.activate();
        } else if (userInitiated) {
          // 仅用户主动点击时 CesiumViewer 未就绪才报错并回退
          window.showToast("3D 引擎模块未加载", { duration: 3000 });
          var cb = document.getElementById("view3dToggle");
          if (cb) cb.checked = false;
        }
        // 注意：刷新页面后不会自动进入 3D —— cesium-viewer.js 会在加载时
        // 把持久化开关强制复位为「关」，只有用户主动拨动才会走到这里。
      },
      disable: function () {
        if (window.CesiumViewer) {
          // 先取消可能正在进行的加载（下载过程中关开关要立刻中断）
          window.CesiumViewer.cancelActivate();
          window.CesiumViewer.deactivate();
        }
      },
    },
    isLocationTracking: {
      storageKey: TOGGLE_PREFIX + "isLocationTracking",
      enable: function () {
        if (!navigator.geolocation) {
          window.showToast("❌ 设备不支持 GPS 定位", { duration: 2000 });
          var cb = document.getElementById("isLocationTracking");
          if (cb) cb.checked = false;
          S.safeSet(TOGGLE_PREFIX + "isLocationTracking", "false");
          return;
        }
        // 创建标记对象但不添加到地图（等待首次定位成功再显示）
        var marker = L.circleMarker([0, 0], {
          radius: 8,
          color: "#1890ff",
          fillColor: "#1890ff",
          fillOpacity: 0.6,
          weight: 2,
          opacity: 0.8,
        });
        marker._isLiveLocation = true;

        // 精度圈
        var accuracyCircle = L.circle([0, 0], {
          radius: 0,
          color: "#1890ff",
          fillColor: "#1890ff",
          fillOpacity: 0.1,
          weight: 1,
          opacity: 0.3,
        });
        accuracyCircle._isLiveLocation = true;

        var _locMarkersAdded = false;

        window._locationWatchId = navigator.geolocation.watchPosition(
          function (pos) {
            var latlng = [pos.coords.latitude, pos.coords.longitude];
            if (!_locMarkersAdded) {
              marker.addTo(map);
              accuracyCircle.addTo(map);
              _locMarkersAdded = true;
            }
            marker.setLatLng(latlng);
            accuracyCircle.setLatLng(latlng);
            accuracyCircle.setRadius(pos.coords.accuracy || 10);
          },
          function (err) {
            // 定位失败时不反复弹窗
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
        );

        window._locationMarker = marker;
        window._locationAccuracyCircle = accuracyCircle;
      },
      disable: function () {
        if (window._locationWatchId != null) {
          navigator.geolocation.clearWatch(window._locationWatchId);
          window._locationWatchId = null;
        }
        if (window._locationMarker) {
          map.removeLayer(window._locationMarker);
          window._locationMarker = null;
        }
        if (window._locationAccuracyCircle) {
          map.removeLayer(window._locationAccuracyCircle);
          window._locationAccuracyCircle = null;
        }
      },
    },
    darkModeToggle: {
      storageKey: TOGGLE_PREFIX + "darkMode",
      enable: function () {
        document.documentElement.setAttribute("data-theme", "dark");
        document.documentElement.style.colorScheme = "dark";
        syncThemeColorMeta();
        rebuildGraticuleTheme();
        syncCesiumSceneTheme();
      },
      disable: function () {
        document.documentElement.removeAttribute("data-theme");
        document.documentElement.style.colorScheme = "light";
        syncThemeColorMeta();
        rebuildGraticuleTheme();
        syncCesiumSceneTheme();
      },
    },
    graticuleToggle: {
      storageKey: TOGGLE_PREFIX + "graticule",
      enable: function () {
        if (window._graticuleLayer) return;
        if (typeof L.latlngGraticule !== "function") {
          window.showToast("❌ 格网插件未加载", { duration: 3000 });
          var cb = document.getElementById("graticuleToggle");
          if (cb) {
            cb.checked = false;
            S.safeSet(TOGGLE_PREFIX + "graticule", "false");
          }
          return;
        }
        // 深色模式用浅色网格线，浅色模式用深灰网格线；
        // 标签文字单独用深色/亮色保证清晰（fontColor 独立于 color）
        var isDark =
          document.documentElement.getAttribute("data-theme") === "dark";
        var lineColor = isDark ? "#a0a6ad" : "#8a8a8a";
        var labelColor = isDark ? "#eef0f3" : "#333333";
        var lineOpacity = 0.8;
        var zoomInterval = [
          { start: 1, end: 3, interval: 30 },
          { start: 4, end: 5, interval: 10 },
          { start: 6, end: 7, interval: 5 },
          { start: 8, end: 9, interval: 1 },
          { start: 10, end: 11, interval: 0.25 },
          { start: 12, end: 13, interval: 0.1 },
          { start: 14, end: 14, interval: 0.05 },
          { start: 15, end: 16, interval: 0.02 },
          { start: 17, end: 18, interval: 0.01 },
          { start: 19, end: 20, interval: 0.005 },
        ];
        // 官方用法：网格线 + 内置边缘坐标标签（canvas 绘制在地图内边缘）
        window._graticuleLayer = L.latlngGraticule({
          showLabel: true,
          zoomInterval: zoomInterval,
          color: lineColor,
          weight: 0.8,
          opacity: lineOpacity,
          font: "11px system-ui, sans-serif",
          fontColor: labelColor,
          latLineCurved: 4, // Web Mercator 下纬线略弯，4 段折线贴合底图
        }).addTo(map);
      },
      disable: function () {
        if (window._graticuleLayer) {
          map.removeLayer(window._graticuleLayer);
          window._graticuleLayer = null;
        }
      },
    },
    mouseCoordToggle: {
      storageKey: TOGGLE_PREFIX + "mouseCoord",
      enable: function () {
        if (!window._mousePosControl) {
          window._mousePosControl = L.control
            .mousePosition({
              position: "topright",
              showZoom: true,
              zoomLabel: "缩放: {zoom} ",
              format: "经度: {lng}, 纬度: {lat}",
              precision: 5,
              showFullscreen: true,
            })
            .addTo(map);
        }
      },
      disable: function () {
        if (window._mousePosControl) {
          map.removeControl(window._mousePosControl);
          window._mousePosControl = null;
        }
      },
    },
    geomenToggle: {
      storageKey: TOGGLE_PREFIX + "geomen",
      enable: function () {
        map.pm.addControls(GEOMEN_OPTS);
        map.pm.setLang("zh");
        map.pm.setGlobalOptions(GEOMEN_GLOBAL_OPTS);
        // 「清除全部测量」按钮由 measure-tools.js 注册（Geoman 的 Removal Mode
        // 只能逐个删，没有「全部清除」）。必须在 addControls **之后**调用 ——
        // 实测 createCustomControl 会把按钮立即渲染进已建好的工具条。
        if (window.OGVMeasureTools) window.OGVMeasureTools.installToolbarButtons();
      },
      disable: function () {
        map.pm.removeControls();
      },
    },
    zoomToggle: {
      storageKey: TOGGLE_PREFIX + "zoom",
      // enable/disable 优先于 control：同时兼职 3D 辅助控件（全屏/操作帮助）开关
      enable: function () {
        map.zoomControl.addTo(map);
        document.body.classList.add("ogv-zoom-ctl");
      },
      disable: function () {
        map.removeControl(map.zoomControl);
        document.body.classList.remove("ogv-zoom-ctl");
      },
    },
    scaleToggle: {
      storageKey: TOGGLE_PREFIX + "scale",
      enable: function () {
        if (!window._scaleControl) {
          window._scaleControl = L.control
            .scale({
              imperial: false,
              maxWidth: 100,
              position: "bottomleft",
            })
            .addTo(map);
        }
      },
      disable: function () {
        if (window._scaleControl) {
          map.removeControl(window._scaleControl);
          window._scaleControl = null;
        }
      },
    },
    legendToggle: {
      storageKey: TOGGLE_PREFIX + "legend",
      enable: function () {
        if (!window._legendControl) {
          window._legendControl = L.control
            .legend({ position: "bottomleft" })
            .addTo(map);
          // 立即用当前可见图层填充图例
          if (typeof window._buildLegendData === "function") {
            var items = window._buildLegendData();
            window._legendControl.update(items);
          }
        } else {
          window._legendControl.setVisible(true);
        }
      },
      disable: function () {
        if (window._legendControl) {
          window._legendControl.setVisible(false);
        }
      },
    },
    layerCtrlToggle: {
      storageKey: TOGGLE_PREFIX + "layerCtrl",
      enable: function () {
        window.rebuildLayerCtrl();
      },
      disable: function () {
        if (window._layerCtrlControl) {
          map.removeControl(window._layerCtrlControl);
          window._layerCtrlControl = null;
        }
      },
    },
    premiumToggle: {
      storageKey: TOGGLE_PREFIX + "premium",
      enable: function () {
        if (
          typeof window.premiumCheck === "function" &&
          window.premiumCheck()
        ) {
          return; // 已激活，无需再次弹窗
        }
        if (typeof window.showPremiumActivation === "function") {
          window.showPremiumActivation(function (ok) {
            if (!ok) {
              var cb = document.getElementById("premiumToggle");
              if (cb) {
                cb.checked = false;
                S.safeSet(TOGGLE_PREFIX + "premium", "false");
              }
            }
          });
        }
      },
      disable: function () {
        // 已激活后不允许关闭
        if (
          typeof window.premiumCheck === "function" &&
          window.premiumCheck()
        ) {
          var cb = document.getElementById("premiumToggle");
          if (cb) {
            cb.checked = true;
            S.safeSet(TOGGLE_PREFIX + "premium", "true");
          }
          return;
        }
      },
    },
    elevationReadToggle: {
      storageKey: TOGGLE_PREFIX + "elevationRead",
      enable: function () {
        ensureElevationQuery().enable();
      },
      disable: function () {
        if (window._elevationQuery) window._elevationQuery.disable();
      },
    },
    linkJumpToggle: {
      storageKey: TOGGLE_PREFIX + "linkJump",
      enable: function (userInitiated) {
        // 静默恢复（页面加载读取已保存状态）：协议已在浏览器注册过，
        // 无需重注册、也不提示，避免无用户手势被浏览器拒绝
        if (!userInitiated) return;
        try {
          if (!("registerProtocolHandler" in navigator)) {
            window.showToast("当前浏览器不支持自定义协议注册", {
              duration: 2500,
            });
            return;
          }
          // handler 必须与当前页面 origin 同源，故用 location.origin 动态拼接
          // （避免硬编码 dupal.cn 在 localhost / 其他域名下测试报 "document's origin" 错误）
          navigator.registerProtocolHandler(
            "web+dupal",
            location.origin + "/?proto=%s",
            "Dupal地图",
          );
          window.showToast(
            "✅ 已启用链接跳转：可用 web+dupal://focus/南海 直接打开并聚焦",
            { duration: 3000 },
          );
        } catch (e) {
          // 手动点击开关（处于用户手势栈内）通常成功注册，失败时静默忽略
        }
      },
    },
    centerCrossToggle: {
      storageKey: TOGGLE_PREFIX + "centerCross",
      enable: function () {
        if (window._centerCross) return;
        var wrap = document.createElement("div");
        wrap.className = "map-center-cross";
        wrap.setAttribute("aria-hidden", "true");
        wrap.style.cssText =
          "position:absolute;left:50%;top:50%;width:24px;height:24px;" +
          "transform:translate(-50%,-50%);pointer-events:none;z-index:650;";
        var hLine = document.createElement("div");
        hLine.style.cssText =
          "position:absolute;left:0;top:50%;width:100%;height:2px;" +
          "transform:translateY(-50%);background:#9c9;" +
          "box-shadow:0 0 0 1px rgba(0,0,0,.45);";
        var vLine = document.createElement("div");
        vLine.style.cssText =
          "position:absolute;top:0;left:50%;height:100%;width:2px;" +
          "transform:translateX(-50%);background:#9c9;" +
          "box-shadow:0 0 0 1px rgba(0,0,0,.45);";
        wrap.appendChild(hLine);
        wrap.appendChild(vLine);
        map.getContainer().appendChild(wrap);
        window._centerCross = wrap;
      },
      disable: function () {
        if (window._centerCross) {
          window._centerCross.remove();
          window._centerCross = null;
        }
      },
    },
    optimizeSearchToggle: {
      storageKey: TOGGLE_PREFIX + "optimizeSearch",
      enable: function () {
        window.OGV_OPT_SEARCH = window.OGV_OPT_SEARCH || {};
        window.OGV_OPT_SEARCH.enabled = true;
      },
      disable: function () {
        window.OGV_OPT_SEARCH = window.OGV_OPT_SEARCH || {};
        window.OGV_OPT_SEARCH.enabled = false;
        // 关闭开关时若正处于隔离态，立即恢复全部目标显示
        if (window.__OGV_restoreIsolation) window.__OGV_restoreIsolation();
      },
    },
  };

  // 同步 iOS/Android 状态栏与挖孔区（留白区）主题色：
  // 读取当前主题下的 --c-statusbar 变量并写入 theme-color meta，
  // 让深色模式下灵动岛/刘海/底部 Home 条区域也跟随变暗
  function syncThemeColorMeta() {
    var meta = document.getElementById("themeColorMeta");
    if (!meta) return;
    var color = getComputedStyle(document.documentElement)
      .getPropertyValue("--c-statusbar")
      .trim();
    if (color) meta.setAttribute("content", color);
  }

  /**
   * 让 3D 场景配色（星空 / 背景色 / 大气）跟随当前黑白模式
   * 未开启 3D 时 CesiumViewer.applySceneTheme() 内部会自行跳过
   */
  function syncCesiumSceneTheme() {
    if (!window.CesiumViewer || !window.CesiumViewer.applySceneTheme) return;
    try {
      window.CesiumViewer.applySceneTheme();
    } catch (e) {
      console.warn("[app] 3D 场景主题同步失败:", e);
    }
  }

  // 初始化主题：无存储值时按系统偏好「预设」开关状态，但**不落盘**。
  // ⚠️ 旧实现会立刻把系统偏好写进 localStorage —— 首次访问就把它固化成了用户
  //    选择，之后用户在系统里改深浅色，页面再也跟不动了。
  (function initTheme() {
    if (S.safeGet(TOGGLE_PREFIX + "darkMode") !== null) return;
    var isDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    // initToggle 把 cb.checked 当作 defaultChecked，这里预设即生效
    var cb = document.getElementById("darkModeToggle");
    if (cb) {
      cb.checked = !!isDark;
      if (window._syncQuickStates) window._syncQuickStates();
    }
  })();

  function initToggle(cbId, cfg) {
    var cb = document.getElementById(cbId);
    if (!cb) return;

    var defaultChecked = cb.checked;
    var checked = S.getBool(cfg.storageKey, defaultChecked);
    cb.checked = checked;

    // 快捷区那个按钮的选中态跟着这里走。
    // 快捷区不带自己的 checkbox，状态只存在于这一个 cb 上，
    // 所以每次状态变化都让快捷区重算一遍（含 aria-pressed）。
    function syncQuickState() {
      if (window._syncQuickStates) window._syncQuickStates();
    }
    syncQuickState();

    // 同步控件状态：勾选时创建（懒加载），未勾选时移除
    // 恢复已保存状态用静默模式（userInitiated=false），避免每次进入都弹提示
    if (checked) {
      if (cfg.enable) cfg.enable(false);
      else if (cfg.control) cfg.control.addTo(map);
    } else {
      if (cfg.disable) cfg.disable();
      else if (cfg.control) map.removeControl(cfg.control);
    }
    // 副作用可能又把 cb 改回去（例如未激活时 premium 的 enable() 会强制取消勾选），
    // 所以副作用跑完必须再同步一次 —— 否则徽标算的是「恢复前」的状态
    syncQuickState();

    cb.addEventListener("change", function () {
      S.safeSet(cfg.storageKey, String(this.checked));
      syncQuickState();
      // 用户主动拨动开关才视为 userInitiated，触发注册与提示
      if (this.checked) {
        if (cfg.enable) cfg.enable(true);
        else if (cfg.control) cfg.control.addTo(map);
      } else {
        if (cfg.disable) cfg.disable();
        else if (cfg.control) map.removeControl(cfg.control);
      }
    });
  }

  // 同步高级功能激活状态 → 开关
  // （旧版还会写一份 dupal_premium，全项目无人读取，已随存储层一并清理）
  if (S.safeGet(S.KEY.PREMIUM) === "true") {
    var _pcb = document.getElementById("premiumToggle");
    if (_pcb) {
      _pcb.checked = true;
      if (window._syncQuickStates) window._syncQuickStates();
    }
  }

  for (var cbId in toggleConfig) {
    if (toggleConfig.hasOwnProperty(cbId)) initToggle(cbId, toggleConfig[cbId]);
  }

  // ========== 跨标签同步 ==========
  // 别的标签页改了开关 → storage 事件通知本页。值的归属没有歧义：事件本身就是
  // 「对方已经写完」的通知，天然以后写入为准。真正的分歧在**下一步要不要在本页
  // 重放 enable/disable**：
  //
  //   SYNC_SAFE  —— 纯视觉 / 幂等，立刻重放，体验最好
  //   SYNC_BLOCK —— 副作用重不得，一律不同步，等本页下次加载按存储值自然生效：
  //      view3d            4.9 MB 引擎 + 第二个 WebGL 场景；更要命的是
  //                        cesium-viewer.js 每次加载都会把开关复位为 false，
  //                        一旦同步两页会互相把对方的 3D 关掉，来回震荡
  //      isLocationTracking clearWatch 会被别的标签页关掉（等于 A 关了 B 的定位）
  //      premium           会弹出激活码对话框；且 _activated 是闭包变量改不了
  //      elevationRead     插件 enable() 的幂等性未验证
  var SYNC_BLOCK = {
    view3dToggle: 1,
    isLocationTracking: 1,
    premiumToggle: 1,
    elevationReadToggle: 1,
  };
  window.addEventListener("storage", function (e) {
    if (!e || !e.key || e.key.indexOf(TOGGLE_PREFIX) !== 0) return;
    for (var id in toggleConfig) {
      if (!toggleConfig.hasOwnProperty(id)) continue;
      var cfg = toggleConfig[id];
      if (cfg.storageKey !== e.key) continue;
      if (SYNC_BLOCK[id]) return; // 危险组：不参与同步
      var cb = document.getElementById(id);
      if (!cb) return;
      var v = e.newValue === "true";
      if (cb.checked === v) return;
      // 程序化赋值 .checked 不会触发 change → 不会回写存储 → 不会形成回环
      cb.checked = v;
      if (v) {
        if (cfg.enable) cfg.enable(false);
        else if (cfg.control) cfg.control.addTo(map);
      } else {
        if (cfg.disable) cfg.disable();
        else if (cfg.control) map.removeControl(cfg.control);
      }
      if (window._syncQuickStates) window._syncQuickStates();
      return;
    }
  });

  // ========== 高级功能激活码验证 ==========
  (function () {
    var _activated = false;
    var _PR_KEY = S.KEY.PREMIUM;

    _activated = S.safeGet(_PR_KEY) === "true";

    // 已激活 → 同步勾上高级功能开关
    if (_activated) {
      var cb = document.getElementById("premiumToggle");
      if (cb) {
        cb.checked = true;
        if (window._syncQuickStates) window._syncQuickStates();
      }
    }

    window.premiumCheck = function () {
      return _activated;
    };

    window.showPremiumActivation = function (callback) {
      if (_activated) {
        if (typeof callback === "function") callback(true);
        return;
      }

      var dlg = document.createElement("dialog");
      dlg.className = "app-dialog premium-dialog";
      dlg.innerHTML =
        '<div class="dialog-header"><h3>🔒 激活高级功能</h3></div>' +
        '<div class="dialog-body">' +
        "<p>请输入激活码：</p>" +
        '<input id="prCodeInput" class="premium-input" type="text" placeholder="输入激活码" />' +
        '<p id="prError" class="premium-error">激活码无效，请检查后重试</p>' +
        '<div class="premium-btns">' +
        '<button id="prCancel" class="premium-btn premium-btn-cancel">取消</button>' +
        '<button id="prSubmit" class="premium-btn premium-btn-submit">验证激活</button>' +
        "</div>" +
        '<p style="margin:8px 0 0;color:var(--text-muted);font-size:11px;">激活永久有效，请勿清除本网站浏览器数据</p>' +
        '<p style="margin:2px 0 0;color:var(--text-muted);font-size:11px;">更换设备后联系管理员重新发码</p>' +
        "</div>";
      document.body.appendChild(dlg);
      dlg.showModal();

      var input = dlg.querySelector("#prCodeInput");
      var errEl = dlg.querySelector("#prError");
      input.focus();

      function showQrAfterActivate(code) {
        // 替换弹窗内容为成功信息 + 二维码
        dlg.querySelector(".dialog-body").innerHTML =
          '<div style="text-align:center;">' +
          '<p style="font-size:15px;font-weight:600;color:var(--accent);margin:0 0 4px;">✅ 高级功能已激活</p>' +
          '<p style="font-size:12px;color:var(--text-muted);margin:0 0 14px;">扫二维码在手机上同步激活此功能</p>' +
          '<img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=' +
          encodeURIComponent(
            location.origin + location.pathname + "?activate=" + code,
          ) +
          '" alt="QR" style="width:140px;height:140px;border-radius:6px;border:1px solid var(--border-light);" />' +
          '<p style="margin:6px 0 0;font-size:10px;color:var(--text-faint);">' +
          (location.origin + location.pathname + "?activate=" + code) +
          "</p>" +
          '<button id="prDone" class="premium-btn premium-btn-submit" style="margin-top:14px;padding:7px 24px;">完成</button>' +
          "</div>";
        dlg.querySelector("#prDone").addEventListener("click", function () {
          dlg.close();
          document.body.removeChild(dlg);
        });
      }

      function doActivate() {
        var code = input.value.trim();
        if (!code) {
          errEl.style.display = "block";
          return;
        }
        if (_PR_CODES.indexOf(code) >= 0) {
          _activated = true;
          S.safeSet(_PR_KEY, "true");
          var _pcb2 = document.getElementById("premiumToggle");
          if (_pcb2) _pcb2.checked = true;
          if (window._syncQuickStates) window._syncQuickStates();
          showQrAfterActivate(code);
          if (typeof callback === "function") callback(true);
        } else {
          errEl.style.display = "block";
        }
      }

      dlg.querySelector("#prSubmit").addEventListener("click", doActivate);
      dlg.querySelector("#prCancel").addEventListener("click", function () {
        dlg.close();
        document.body.removeChild(dlg);
        if (typeof callback === "function") callback(false);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          doActivate();
        }
      });
      dlg.addEventListener("close", function () {
        if (document.body.contains(dlg)) document.body.removeChild(dlg);
      });
    };

    // 调试入口：控制台 window.premiumReset() 复位激活态
    // ⚠️ 必须同时复位开关本身和它的持久化值，否则开关仍显示「已激活」，
    //    下次刷新又会被 initToggle 勾回来
    window.premiumReset = function () {
      _activated = false;
      S.safeRemove(_PR_KEY);
      S.safeSet(S.KEY.TOGGLE + "premium", "false");
      var cb = document.getElementById("premiumToggle");
      if (cb) {
        cb.checked = false;
        if (window._syncQuickStates) window._syncQuickStates();
      }
    };

    // sessionStorage 也要防抛：Safari 无痕 / 存储被禁时访问本身就抛 SecurityError
  function _ss() {
    try {
      return window.sessionStorage || null;
    } catch (e) {
      return null;
    }
  }
  function _ssGet(k) {
    try {
      var ss = _ss();
      return ss ? ss.getItem(k) : null;
    } catch (e) {
      return null;
    }
  }
  function _ssSet(k, v) {
    try {
      var ss = _ss();
      if (ss) ss.setItem(k, String(v));
    } catch (e) {}
  }
  function _ssRemove(k) {
    try {
      var ss = _ss();
      if (ss) ss.removeItem(k);
    } catch (e) {}
  }

  // ========== URL 参数自动激活（扫码直达）==========
    (function () {
      // 刚通过 URL 激活完成的页面，显示提示
      if (_ssGet("_pr_just_activated")) {
        _ssRemove("_pr_just_activated");
        setTimeout(function () {
          if (typeof window.showToast === "function")
            window.showToast("✅ 已使用激活码激活高级功能", { duration: 5000 });
        }, 500);
      }
      var m = location.search.match(/[?&]activate=(\d{6})\b/);
      if (m) {
        var code = m[1];
        if (_PR_CODES.indexOf(code) >= 0) {
          _activated = true;
          S.safeSet(_PR_KEY, "true");
          _ssSet("_pr_just_activated", "1");
          history.replaceState(null, "", location.pathname + location.hash);
          location.reload();
        }
      }
    })();
  })();
})();
