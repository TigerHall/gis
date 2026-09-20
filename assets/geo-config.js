/**
 * geo-config.js —— OGV 站点配置（唯一配置入口）
 *
 * 定制一个站点 = 只改本文件。共六段：
 *   ①   SITE_CONFIG   站点级：标题、主题色、天地图 token
 *   ①-2 MAP_CONFIG    地图级：初始视野、缩放上限、缩放手感（无级缩放）
 *   ①-3 BASEMAP_CONFIG 底图级：底图清单 + 覆盖层 + 3D 底图映射
 *   ②   路径配置      「数据从哪找」
 *   ③   图层清单      「有哪些图层」  ← 日常加数据只动这一段
 *   ④   地名注册表    深链 ?focus=xxx 用的 地名 → 坐标
 *
 * 设计原则：所有可调项都在这里。geojsonloader.js / app.js / basemap-manager.js
 * 是引擎，不承载任何站点专属设定 —— 若某个视觉/行为需要按图层不同，就在 ③ 里
 * 加字段，再到引擎里读它，不要在引擎里写死图层名（唯一例外见 ①-3 末尾的兜底底图）。
 *
 * 加载时机：必须在 geojsonloader.js 之前（index.html 的 <head> 内）
 *
 * ==========================================================
 * 📌 图层字段说明（③ 里每一项可用的字段）
 * ==========================================================
 *
 * 字段            | 必需 | 说明
 * ----------------|------|----------
 * name            |  是  | 图层面板中显示的名称
 * file            |  是  | GeoJSON 文件名（自动补全路径和 gz 后缀）
 * labelField      |  否  | 标签/弹窗标题使用的属性字段名
 *                    （不设置则依次查找 Name → name → NAME → 第一个字段值）
 * color           |  否  | 十六进制默认颜色（如 "#E63946"）
 *                    不设置则由 getFixedColor 自动分配索引颜色
 * icon            |  否  | 点要素图标类型或外部文件路径
 *                    内置： "volcano" / "hotspot" / "star" / "point"
 *                    外部： "./assets/images/xxx.svg"（支持 SVG/PNG/ICO）
 * iconSize        |  否  | 点要素图标尺寸（px），默认 20
 *                    这是「点的大小」的实际旋钮 —— 点要素一律渲染成图标标记，
 *                    用户在图层设置弹窗里改的尺寸会覆盖此默认值
 * source          |  否  | 数据来源/版权说明，显示在要素弹窗的「数据源」字段
 * colorMode       |  否  | 默认颜色模式："sequential" / "field" / "single"
 *                    不设置时：面 → sequential，点/线 → single
 * colorField      |  否  | colorMode="field" 时使用的字段名
 * hidden          |  否  | 置 true 时该图层不在面板渲染（数据仍在配置里，便于恢复）
 *                    写在 group 上则整组隐藏
 * selectable      |  否  | 置 false 时点击不弹出要素详情
 * defaultOpacity  |  否  | 初始不透明度（0-1）
 * searchPriority  |  否  | 置 true 时进入搜索优先队列
 * popup           |  否  | 弹窗展示微调：{ titleField, hideFields[], maxValueLength }
 *                    titleField     标题字段（未设 labelField 时生效）
 *                    hideFields[]   不展示的字段名（大小写不敏感）
 *                                   —— 用来屏蔽导出产生的无用列（FID、KML_FOLDER 等）
 *                    maxValueLength 单元格文本上限，超出截断（悬停看全文），默认 200
 *                    注：数据值一律按纯文本渲染，字段里混进的 HTML 标签会被剥掉，
 *                        不会当标记执行（也不会去下载里面的外链图片）
 * cesium          |  否  | 3D 专属：{ extrudeHeight, clampToGround, pointPixelSize, groundMode }
 *
 * ==========================================================
 * 📌 如何添加一个新图层
 * ==========================================================
 *
 * 1. 把 xxx.geojson.gz 放进 assets/geojson/（或传到 COS 同前缀下）
 *    —— 压缩必须用 gzip，GzIdbLoader 只认 .gz
 * 2. 在 ③ 的某个分组 layers 数组里加一项：
 *      { name: "地幔柱", file: "plumes.geojson", color: "#E63946" }
 *
 * 其余都不用改：不用动 index.html，也不用动 service-worker.js
 * （gz 走 SW 的运行时动态缓存，不在预缓存清单里）。
 */
(function () {
  // ==================================================================
  // ① 站点配置
  // ==================================================================
  // 三项全留 null 时，行为与加配置前完全一致（不改标题、不注入主题色）。
  // 给客户做定制站时在这里填，刷新即生效，无需改任何其他文件。
  window.SITE_CONFIG = {
    // 浏览器标题。null = 沿用 index.html 里 <title> 的原文。
    title: null,

    // 品牌主色（十六进制，如 "#2f9e7f"）。null = 沿用 CSS 默认绿 #99cc99。
    // ⚠️ 只作用于「非文字」用途：选中底色、面板描边、开关滑块、手机状态栏。
    //    文字与焦点环用的绿色另有 WCAG 要求，见 main.css 的 --c-green-text-strong
    //    —— 不要拿品牌色去替换它。#99cc99 在白底上仅 1.8:1，远达不到 AA 的 4.5:1；
    //    即使品牌色本身够深，也建议保持文字色独立可控。
    brandColor: null,

    // 深色主题下用的品牌色。null = 自动把 brandColor 对白提亮 35%
    // （暗底需要更亮的色才看得清）。想精确控制就显式填。
    brandColorDark: null,

    // 天地图开发密钥（服务端 key，形如 32 位十六进制）。
    // 天地图底图/标注/搜索/全球境界全靠它；申请入口 https://console.tianditu.gov.cn/
    // 换 key 只改这一行。引擎会把它暴露成 window.TDT_TK 供各模块复用。
    tiandituToken: "13f1ff3b1c59a59cea87cf63950b4888",
  };

  // ------------------------------------------------------------------
  // 主题注入器：把 SITE_CONFIG 变成 CSS 变量。不配置就什么都不做。
  // ------------------------------------------------------------------
  (function applySiteConfig() {
    var cfg = window.SITE_CONFIG;
    if (!cfg) return;

    // ---- 标题 ----
    // <title> 与 apple-mobile-web-app-title 都在本文件之前，可直接改。
    if (cfg.title) {
      document.title = cfg.title;
      var appleTitle = document.querySelector(
        'meta[name="apple-mobile-web-app-title"]',
      );
      if (appleTitle) appleTitle.setAttribute("content", cfg.title);
    }

    // ---- 主题色 ----
    var HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
    var light = HEX.test(cfg.brandColor || "") ? cfg.brandColor : null;
    if (!light) return; // 未配置 → 完全不碰 CSS，保持 CSS 里的默认绿

    function toRgb(hex) {
      var h = hex.slice(1);
      if (h.length === 3)
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    }
    function toward(hex, target, amt) {
      return (
        "#" +
        toRgb(hex)
          .map(function (v) {
            var n = Math.round(v + (target - v) * amt);
            if (n < 0) n = 0;
            if (n > 255) n = 255;
            return ("0" + n.toString(16)).slice(-2);
          })
          .join("")
      );
    }

    var dark = HEX.test(cfg.brandColorDark || "")
      ? cfg.brandColorDark
      : toward(light, 255, 0.35);
    // hover 取「按向黑 16%」——与 CSS 里 #99cc99 → #80b380 的比例一致
    var lightHover = toward(light, 0, 0.16);
    var darkHover = toward(dark, 0, 0.16);

    // 两条规则各管一个主题：浅色写 :root，深色写 [data-theme="dark"]。
    //
    // ⚠️ 选择器故意写成 :root:root / :root[data-theme="dark"]（优先级各抬高一档），
    //    而不是普通的 :root / [data-theme="dark"]。原因：本文件在 <head> 里
    //    比 main.css 更早执行，此刻 <link rel="stylesheet" href="main.css">
    //    还没被解析，注入的 <style> 会排在它**前面** —— 同优先级下后写的
    //    main.css 胜出，品牌色会完全不生效（实测踩过）。抬高一档之后就不再
    //    依赖插入顺序，脚本位置怎么挪都成立。
    //
    // 深色规则里不写 --c-statusbar：深色状态栏刻意用 #111 与面板同色，
    // 不跟随品牌色（见 main.css 的 [data-theme="dark"]）。
    // 但也正因抬高了优先级，浅色规则会在深色下照样生效，把 main.css 的
    // 深色 --c-statusbar 压掉。所以状态栏单列一条 :not([data-theme="dark"])
    // 规则 —— 只在浅色主题下写，深色交给 main.css 自己管。
    var style = document.createElement("style");
    style.id = "site-theme";
    style.textContent =
      ":root:root{--c-green:" +
      light +
      ";--c-green-hover:" +
      lightHover +
      ";}\n" +
      ':root:not([data-theme="dark"]){--c-statusbar:' +
      light +
      ";}\n" +
      ':root[data-theme="dark"]{--c-green:' +
      dark +
      ";--c-green-hover:" +
      darkHover +
      ";}\n";
    document.head.appendChild(style);

    // theme-color meta 由 app.js 的 syncThemeColorMeta() 读 --c-statusbar 写入，
    // 这里补一次首屏：该 meta 在本文件之后，得等 DOM 就绪。
    function syncMeta() {
      var meta = document.getElementById("themeColorMeta");
      if (meta) meta.setAttribute("content", light);
    }
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", syncMeta);
    else syncMeta();
  })();

  // ==================================================================
  // ①-2 地图配置
  // ==================================================================
  // 打开页面时的初始视野。center 是 [纬度, 经度]（注意不是 GeoJSON 的 [经度, 纬度]）。
  window.MAP_CONFIG = {
    center: [32, 107],
    zoom: 3,
    // 地图允许的最大层级。底图自身的 maxNativeZoom（超过就放大填充）在 ①-3 里单独设。
    maxZoom: 19,

    // ---- 缩放手感 ----
    // zoomSnap = 缩放档位间隔。
    //   0  = **无级缩放**：可以停在 2.5 / 4.37 这类中间层级（滚轮、双指捏合都是连续的），
    //        手感接近 Google 地图。代价：底图瓦片只能取整级，中间态靠 CSS 缩放，
    //        比整数级略糊一点点（矢量/标注不受影响）。
    //   1  = Leaflet 默认，只能停在整数级。
    //   0.5 / 0.25 之类也可以，就是「半级 / 四分之一级」档位。
    zoomSnap: 0,
    // 点「+/-」按钮、双击、键盘 +/- 一次跳几级（与 zoomSnap 独立）。
    //   zoomSnap=0 时仍建议留 1，让按钮保持「一整级」的干脆手感。
    zoomDelta: 1,
    // 滚轮：每缩放 1 级需要滚多少像素。数值越大 = 一次滚轮改变得越少 = 越慢越细腻。
    // Leaflet 默认 60。想更接近 Google 的「慢慢放大」可以调到 80~100。
    wheelPxPerZoomLevel: 80,
    // 滚轮停止后延迟多少毫秒才执行缩放（避免连续滚动被拆成很多次动画）。Leaflet 默认 40。
    wheelDebounceTime: 40,

    // ---- 自定义 pane 的 z-index（改叠放顺序只改这里）----
    // Leaflet 默认：tilePane 200 < overlayPane 400 < shadowPane 500
    //               < markerPane 600 < tooltipPane 650 < popupPane 700
    //
    // 铁律：**底图（单选）永远在最底层，覆盖层（多选）永远压在底图之上**。
    //   baseImagePane —— ETOPO 等整幅影像底图。必须 **小于 tilePane(200)**，
    //     否则会把「天地图地名标注」「天地图全球境界」这些瓦片覆盖层整个盖掉
    //     （L.imageOverlay 默认落在 overlayPane 400，不指定 pane 又会压住矢量，
    //      所以才需要这个专用 pane —— 但它的位置是「底图层」，不是「覆盖层」）。
    //   demPane       —— DEM 栅格：高于底图（含 baseImagePane），低于矢量(400)。
    panes: {
      baseImagePane: 190,
      demPane: 350,
    },
  };

  // ==================================================================
  // ①-3 底图配置（2D 图层控件 与 3D Cesium 共用同一份清单）
  // ==================================================================
  // 「底图控件里有哪些图层」全部在这里决定。index.html / basemap-manager.js
  // 里不含任何图层名与 URL。
  //
  // 📌 通用字段
  //   name          必填，控件中显示的名称。⚠️ 同时是本地记忆的键，改名会让老用户
  //                 的「上次选中的底图」失效（回落到 defaultBasemap）
  //   kind          必填，渲染种类，见下方各 kind 专属字段
  //   attribution   版权信息（地图右下角），可选
  //   options       透传给 Leaflet 图层的选项对象，可选
  //   maxZoom / maxNativeZoom / minNativeZoom / opacity / pane
  //                 上面几个常用选项的简写（等价于写进 options），可选
  //   attachBoundary  置 true 时在该底图之上叠一层「世界境界」（即下面的 boundary）。
  //                   ArcGIS / OSM 这类境外影像底图不带国界线，需要补
  //   cesium        切到该底图时 3D 用哪种 ImageryProvider，取值：
  //                   { kind:"tianditu",   service:"img_w",           maximumLevel:18 }
  //                   { kind:"urlTemplate", url:"…/{z}/{y}/{x}",      maximumLevel:19 }
  //                   { kind:"wms",         url:"…", layers:"…",      maximumLevel:12 }
  //                   { kind:"osm",         url:"https://…/",         maximumLevel:19 }
  //                   { kind:"wayback",                               maximumLevel:19 }
  //                   不写 = 3D 下回退到内置的 ArcGIS 影像兜底
  //
  // 📌 各 kind 的专属字段
  //   tianditu         service（img_w 影像 / vec_w 矢量 / ter_w 地形 /
  //                             cva_w 地名 / cia_w 影像注记 / cta_w 地形注记 / ibo_w 境界）
  //   arcgis           serviceName（如 World_Imagery）、labelServiceName（可选注记层）
  //   wms              url、layers（WMS 图层名）
  //   tile             url（XYZ 模板）
  //   imageWorldCopy   url、bounds（[[南,西],[北,东]]，自动跨 180° 复制三份）
  //   wayback          tileBase、configUrl、fallbackRelease（供底部时相条用）
  //   esriFeature      url（ArcGIS MapServer/FeatureServer 端点）、style（面样式）
  //
  // 📌 四个顶层字段
  //   defaultBasemap  首次访问（无本地记忆）时选中的底图名
  //   noneLabel       底图控件里的「无底图」项名（选中 = 卸掉所有底图，只留要素）
  //   defaultSubset   「更多底图」关闭时控件里显示的底图子集（按名称挑；顺序仍按 baseLayers）
  //   boundary        共享的「世界境界」图层定义：被 attachBoundary 引用，同时自己也是
  //                   一个可选覆盖层（见 overlays 里的 ref）
  //   baseLayers      底图清单（控件里的单选列表，数组顺序 = 显示顺序）
  //   overlays        常驻覆盖层（控件里的多选项）
  //   moreOverlays    开启「更多底图」后才出现的覆盖层
  //
  // ⚠️ 引擎内置了唯一一个硬编码底图：ArcGIS World_Imagery（影像兜底）。
  //    清单为空 / 语法写坏 / defaultBasemap 不存在 / 3D 无对应 provider 时都用它，
  //    保证地图永远不白屏。它同时也是 baseLayers 里「ArcGIS-影像」那一项。
  //
  // ⚠️ 注意：底图是「单选」，覆盖层是「多选」。同一个 layer 实例（如境界层）被多个
  //    底图 attachBoundary 引用、同时又作为 overlays 的一项，是**刻意**的：
  //    Leaflet 同一图层不会重复上图，于是「天地图全球境界」这个复选框天然变成了
  //    「国界显隐」开关 —— 选中带 attachBoundary 的底图时它自动呈选中态；取消勾选
  //    就会把那层国界从底图上摘掉（切走再切回底图会恢复）。这是既有行为，勿改。
  (function () {
    var TDT_ATTR = function (label) {
      return (
        "<a href='https://www.tianditu.gov.cn/' target='_blank'>" +
        label +
        "</a>"
      );
    };
    var ARCGIS_PREFIX = "https://server.arcgisonline.com/ArcGIS/rest/services/";
    var GEBCO24_URL = "https://wms.gebco.net/mapserv?";
    var GEBCO25_URL = "https://wms.gebco.net/2025/mapserv?";
    var GEBCO_ATTR =
      '<a href="https://www.gebco.net/" target="_blank">GEBCO</a>';
    var GEBCO25_ATTR =
      '<a href="https://www.gebco.net/" target="_blank">GEBCO 2025</a>';

    // —— 小工厂：把「同源、只差参数」的底图压成一行，避免 13 个 GEBCO 复制粘贴 ——
    function tdt(name, service, opts, cesiumLevel) {
      return Object.assign(
        {
          name: name,
          kind: "tianditu",
          service: service,
          attribution: TDT_ATTR(name),
          cesium: {
            kind: "tianditu",
            service: service,
            maximumLevel: cesiumLevel || 18,
          },
        },
        opts || {},
      );
    }
    function arcgis(name, serviceName, maxNativeZoom, maxZoom, labelServiceName) {
      var d = {
        name: name,
        kind: "arcgis",
        serviceName: serviceName,
        maxNativeZoom: maxNativeZoom,
        maxZoom: maxZoom,
        attachBoundary: true,
        attribution:
          "<a href='https://www.arcgis.com/' target='_blank'>ArcGIS Online " +
          name.replace("ArcGIS-", "") +
          "</a>",
        // ArcGIS 瓦片端点在 3D 下可直接用 UrlTemplateImageryProvider
        // （ArcGisMapServerImageryProvider 在 CDN 构建下有已知 bug，别用）
        cesium: {
          kind: "urlTemplate",
          url: ARCGIS_PREFIX + serviceName + "/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: maxNativeZoom,
        },
      };
      if (labelServiceName) d.labelServiceName = labelServiceName;
      return d;
    }
    function gebco(name, layers, url, attr) {
      return {
        name: name,
        kind: "wms",
        url: url,
        layers: layers,
        maxZoom: 12,
        attribution: attr,
        cesium: {
          kind: "wms",
          url: url,
          layers: layers,
          maximumLevel: 12,
        },
      };
    }
    // ETOPO 是本地整幅影像（默认用 baseImagePane，压在瓦片之上、矢量之下）
    function etopo(name, url, attr) {
      return {
        name: name,
        kind: "imageWorldCopy",
        url: url,
        bounds: [
          [-85.06, -180],
          [85.06, 180],
        ],
        pane: "baseImagePane",
        attribution: attr,
        // 3D 无对应 provider → 不写 cesium，回退 ArcGIS 影像
      };
    }
    function esriIsland(name, layerId) {
      return {
        name: name,
        kind: "esriFeature",
        url:
          "https://data-gis.unep-wcmc.org/server/rest/services/Global_Islands/MapServer/" +
          layerId,
        style: { color: "#3388ff", weight: 1, opacity: 0.8, fillOpacity: 0.25 },
      };
    }

    window.BASEMAP_CONFIG = {
      // 无本地记忆时的默认底图
      defaultBasemap: "ArcGIS-海洋",

      // 底图控件里的「无底图」项：选中时卸掉所有底图，地图留空白、只剩要素。
      // 它是**伪底图**（一个空 LayerGroup）：Leaflet 的图层控件是单选，选中它就会
      // 把上一张底图移除，于是露出 #map 的背景（跟随主题，见 main.css 的
      // body.basemap-none 规则）。传空字符串即隐藏该项。
      noneLabel: "无底图",

      // 「更多底图」关闭时可见的底座（够用且轻量；其余的藏进更多底图）
      defaultSubset: [
        "ETOPO",
        "ETOPO_2022",
        "天地图影像",
        "天地图矢量",
        "天地图地形",
        "ArcGIS-影像",
        "ArcGIS-海洋",
        "GEBCO2025-水深地形",
        "Esri 历史影像",
        "OpenStreetMap",
      ],

      // 共享的「世界境界」——attachBoundary 的底图都会叠它；本身也是覆盖层（见 overlays）
      // 刻意不写 attribution：它是「叠在别人之上」的辅助层，版权已在各底图自身声明
      boundary: tdt("世界境界", "ibo_w", { maxZoom: 18 }, 18),

      // ============ 底图清单（顺序 = 控件里的显示顺序）============
      baseLayers: [
        // —— ETOPO 全球底图 ——
        etopo(
          "ETOPO",
          "./assets/xyz/etopo.jpg",
          '<a href="https://www.ngdc.noaa.gov/" target="_blank">ETOPO 2022</a>',
        ),
        etopo(
          "ETOPO_2022",
          "./assets/xyz/etopo2022high.jpg",
          '<a href="https://www.ngdc.noaa.gov/" target="_blank">ETOPO 2022 HD</a>',
        ),
        // —— 天地图系列 ——
        tdt("天地图影像", "img_w", { minNativeZoom: 1, maxNativeZoom: 18, maxZoom: 22 }, 18),
        tdt("天地图矢量", "vec_w", { minNativeZoom: 1, maxNativeZoom: 18, maxZoom: 22 }, 18),
        tdt("天地图地形", "ter_w", { minNativeZoom: 1, maxNativeZoom: 18, maxZoom: 22 }, 18),
        // —— ArcGIS 系列 ——
        arcgis("ArcGIS-影像", "World_Imagery", 19, 22),
        arcgis("ArcGIS-街道", "World_Street_Map", 19, 22),
        arcgis("ArcGIS-海洋", "Ocean/World_Ocean_Base", 10, 19, "Ocean/World_Ocean_Reference"),
        arcgis("ArcGIS-物理地图", "World_Physical_Map", 19, 22),
        arcgis("ArcGIS-山体阴影地形图", "World_Shaded_Relief", 13, 22),
        arcgis("ArcGIS-世界地形", "World_Terrain_Base", 19, 22),
        arcgis("ArcGIS-地形", "World_Topo_Map", 19, 22),
        // —— GEBCO 2024 (latest) ——
        gebco("GEBCO2024-水深地形", "GEBCO_LATEST", GEBCO24_URL, GEBCO_ATTR),
        gebco("GEBCO2024-水深平面", "GEBCO_LATEST_2", GEBCO24_URL, GEBCO_ATTR),
        gebco("GEBCO2024-含冰下地形浮雕", "GEBCO_LATEST_SUB_ICE_TOPO", GEBCO24_URL, GEBCO_ATTR),
        gebco("GEBCO2024-平面着色(含冰下)", "GEBCO_LATEST_2_sub_ice_topo", GEBCO24_URL, GEBCO_ATTR),
        gebco("GEBCO2024-仅实测数据", "GEBCO_LATEST_3", GEBCO24_URL, GEBCO_ATTR),
        gebco("GEBCO2024-TID实测黑", "GEBCO_LATEST_TID", GEBCO24_URL, GEBCO_ATTR),
        gebco("GEBCO2024-TID分类着色", "GEBCO_LATEST_TID_2", GEBCO24_URL, GEBCO_ATTR),
        // —— GEBCO 2025（独立端点，端点不同不能与 2024 混用）——
        gebco("GEBCO2025-水深地形", "GEBCO_2025", GEBCO25_URL, GEBCO25_ATTR),
        gebco("GEBCO2025-水深平面", "GEBCO_2025_2", GEBCO25_URL, GEBCO25_ATTR),
        gebco("GEBCO2025-仅实测数据", "GEBCO_2025_3", GEBCO25_URL, GEBCO25_ATTR),
        gebco("GEBCO2025-含冰下浮雕", "GEBCO_2025_SUB_ICE_TOPO", GEBCO25_URL, GEBCO25_ATTR),
        gebco("GEBCO2025-平面着色(含冰下)", "GEBCO_2025_2_sub_ice_topo", GEBCO25_URL, GEBCO25_ATTR),
        gebco("GEBCO2025-TID实测黑", "GEBCO_2025_TID", GEBCO25_URL, GEBCO25_ATTR),
        gebco("GEBCO2025-TID着色", "GEBCO_2025_TID_2", GEBCO25_URL, GEBCO25_ATTR),
        // —— 其他 ——
        {
          name: "EMODnet-多色水深",
          kind: "wms",
          url: "https://ows.emodnet-bathymetry.eu/wms",
          layers: "emodnet:mean_multicolour",
          maxZoom: 16,
          // EMODnet 与 GEBCO 的 WMS 方言略有差别，单独覆盖
          options: {
            format: "image/png",
            transparent: false,
            version: "1.3.0",
            uppercase: true,
          },
          attribution:
            '<a href="https://www.emodnet-bathymetry.eu/" target="_blank">EMODnet Bathymetry</a>',
          // 3D 无对应 provider → 回退 ArcGIS 影像
        },
        {
          name: "Macrostrat-全球地质",
          kind: "tile",
          url: "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png",
          maxZoom: 16,
          attribution:
            '<a href="https://macrostrat.org/" target="_blank">Macrostrat</a>',
          cesium: {
            kind: "urlTemplate",
            // UrlTemplateImageryProvider 同样认 {z}/{x}/{y} 三个占位符，无需换顺序
            url: "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png",
            maximumLevel: 16,
          },
        },
        // Esri Wayback 历史影像：瓦片路径里的 release 编号由底部时相条动态写入
        // window.__waybackRelease，同一个图层实例即可切任意历史时相
        {
          name: "Esri 历史影像",
          kind: "wayback",
          tileBase:
            "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/",
          configUrl:
            "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json",
          fallbackRelease: 56102, // 2023-12-07，确定存在的兜底版本
          minNativeZoom: 0,
          maxNativeZoom: 19,
          maxZoom: 22,
          attribution:
            '<a href="https://livingatlas.arcgis.com/wayback/" target="_blank">Esri Wayback</a>',
          cesium: { kind: "wayback", maximumLevel: 19 },
        },
        {
          name: "OpenStreetMap",
          kind: "tile",
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          maxNativeZoom: 19,
          maxZoom: 22,
          attachBoundary: true,
          attribution:
            "<a href='https://www.openstreetmap.org/' target='_blank'>OpenStreetMap</a>",
          cesium: {
            kind: "osm",
            url: "https://tile.openstreetmap.org/",
            maximumLevel: 19,
          },
        },
      ],

      // ============ 常驻覆盖层 ============
      overlays: [
        // 引用上面 boundary 的同一个实例（Control 勾选与底图 attachBoundary 共用）
        { name: "天地图全球境界", ref: "boundary" },
        tdt("天地图地名标注", "cva_w", { maxNativeZoom: 18, maxZoom: 22 }, 18),
      ],

      // ============ 「更多底图」开启后才出现的覆盖层 ============
      moreOverlays: [
        tdt("天地图影像标注", "cia_w", { maxNativeZoom: 18, maxZoom: 22 }, 18),
        tdt("天地图地形标注", "cta_w", { maxNativeZoom: 18, maxZoom: 22 }, 18),
        // UNEP-WCMC 全球岛屿（Esri FeatureLayer，按视口按需拉取矢量）
        esriIsland("UNEP-WCMC超小海岛", 0),
        esriIsland("UNEP-WCMC小海岛", 1),
        esriIsland("UNEP-WCMC大海岛", 2),
        esriIsland("UNEP-WCMC大陆", 3),
      ],
    };
  })();

  // ==================================================================
  // ①-4 极地投影视图配置（2D：Leaflet + proj4leaflet）
  // ==================================================================
  // 极地视图是**第二张独立地图**：主视图（EPSG:3857）完全不受影响，切换时另开一个
  // L.map 容器，用 L.Proj.CRS 做极球面立体投影（北极 EPSG:3413 / 南极 EPSG:3031）。
  // 数据只渲染一份正本，坐标始终是 -180~180。
  //
  // 📌 底图为什么要单独列一份
  //    极地 CRS 下 L.TileLayer.WMS 会自动把 SRS 换成 EPSG:3413 / 3031，
  //    但只有本身支持极地 SRS 的服务才画得出来。实测：
  //      · GIBS（NASA）WMTS 原生提供 epsg3413 / epsg3031 瓦片 → 可直接用，本配置默认
  //      · GEBCO 官方 WMS 只声明 EPSG:4326 / 3395 / 3857，传极地 SRS 会直接返回
  //        ServiceException(InvalidSRS)，也没有极地瓦片端点
  //        → 极地下的 GEBCO 由离线预烘的影像提供（kind: "polarImage"），
  //          见 .workbuddy/artifacts/make-polar-gebco.js
  //
  // 📌 字段
  //    modes        北极 / 南极两套 CRS 定义 + 打开时的初始视野 [lat, lng, zoom]
  //    basemaps     极地底图清单（单选）；URL 里的 {epsg} 按当前模式替换（3413 / 3031）
  //    defaultBasemap  首次进入极地视图时选中的底图名
  //    maxZoom      视图最大层级。原生瓦片到 maxNativeZoom 为止，再放大是放大填充
  //                 （矢量不受影响，仍然清晰）
  //    maxProjected 点要素过滤半径（米，投影坐标）。立体投影会把另一个半球投到极远处
  //                 （甚至趋于无穷），必须按半径挡掉，否则会画出飞到天外的点
  //    canvasThreshold  点图层超过这个数量改用 Canvas 渲染（与主视图同源策略）
  //    imageBounds  polarImage 影像在投影坐标里的范围（正方形，与极地瓦片矩阵对齐）
  // ==================================================================
  (function () {
    var GIBS_ATTR =
      '<a href="https://earthdata.nasa.gov/gibs" target="_blank">NASA GIBS</a>';
    // GIBS 极地瓦片：512px，矩阵 TopLeftCorner = (-4194304, 4194304)，
    // 分辨率阶梯 8192 / 2^z；静态图层只挂 500m 矩阵（level 0..4）
    function gibs(name, layer, extra, attr) {
      return Object.assign(
        {
          name: name,
          kind: "tile",
          url:
            "https://gibs.earthdata.nasa.gov/wmts/epsg{epsg}/best/" +
            layer +
            "/default/500m/{z}/{y}/{x}.jpeg",
          tileSize: 512,
          maxNativeZoom: 4,
          attribution: attr || GIBS_ATTR,
        },
        extra || {},
      );
    }

    window.POLAR_CONFIG = {
      // ⚠️ 契约：resolutions.length 必须 ≥ maxZoom + 1。
      //    proj4leaflet 的 scale(z) 直接取 resolutions 的倒数表 _scales[z]，
      //    表里没有的层级返回 undefined → Leaflet 的 getZoomScale 算成 NaN →
      //    瓦片范围变非有限 → 抛 "Attempted to load an infinite number of tiles"。
      //    而且 zoomSnap:0（无级缩放）会插值到 _scales[z+1]，所以差一级不只是
      //    「最大那级不能用」，而是**滚轮滑到 maxZoom 附近就崩**。
      //    当前 7 项（索引 0..6）→ maxZoom 6 合法。
      maxZoom: 6,
      maxProjected: 6291456, // 1.5 × 4194304
      canvasThreshold: 3000,
      // polarImage 影像覆盖的投影范围（与极地瓦片矩阵同一个正方形）
      imageBounds: [
        [-4194304, -4194304],
        [4194304, 4194304],
      ],
      // 影像叠放用的 pane（落在唯一底图之下、矢量之上由 Leaflet 自身顺序决定，
      // 这里显式指定，避免和主视图的自定义 pane 混在一起）
      imagePane: "overlayPane",

      modes: {
        north: {
          label: "北极",
          epsg: "3413",
          code: "EPSG:3413",
          def:
            "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 " +
            "+datum=WGS84 +units=m +no_defs",
          origin: [-4194304, 4194304],
          // GIBS「500m」矩阵的层级分辨率阶梯（level 0 = 8192 m/px，逐级减半）。
          // 前 5 项（0..4）与 GIBS 原生层级一一对应，第 5、6 项是超出原生分辨率
          // 的放大层（URL 仍走 level 4，由 maxNativeZoom 负责夹住），
          // 保留它们才能让用户继续放大观察极区细节。
          resolutions: [8192, 4096, 2048, 1024, 512, 256, 128],
          bounds: [-4194304, -4194304, 4194304, 4194304],
          // 视野 = 以极点为中心（极地立体投影的原点就是极点，屏幕上 360° 完整不裁），
          // z1 大约覆盖纬度 60° 以上，是「极区总览」的合适层级
          view: [90, -45, 1],
        },
        south: {
          label: "南极",
          epsg: "3031",
          code: "EPSG:3031",
          def:
            "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 " +
            "+datum=WGS84 +units=m +no_defs",
          origin: [-4194304, 4194304],
          resolutions: [8192, 4096, 2048, 1024, 512, 256, 128],
          bounds: [-4194304, -4194304, 4194304, 4194304],
          view: [-90, 0, 1],
        },
      },

      defaultBasemap: "GIBS-海陆阴影水深",

      basemaps: [
        // —— GIBS：原生极地瓦片，默认 ——
        gibs("GIBS-海陆阴影水深", "BlueMarble_ShadedRelief_Bathymetry"),
        gibs("GIBS-真彩影像", "BlueMarble_NextGeneration"),
        gibs("GIBS-地形阴影", "BlueMarble_ShadedRelief"),

        // —— GEBCO：离线预烘影像（官方 WMS 不支持极地 SRS）——
        {
          name: "GEBCO2025-水深地形",
          kind: "polarImage",
          // 文件名里的 {epsg} 同样按模式替换（3413 / 3031）
          url: "./assets/xyz/gebco_{epsg}.jpg",
          attribution:
            '<a href="https://www.gebco.net/" target="_blank">GEBCO 2025</a>',
        },
      ],

      // 极地视图里的比例尺与鼠标坐标按投影坐标显示，不参与主视图的经纬度记忆键
      showScale: true,
      showMouseCoord: true,
      // 右下角底图版权条（Leaflet attribution）。默认关闭：
      // 极地视图已有左上角标题栏与自己的底图下拉，版权条在这里纯属噪声。
      // 若要恢复（例如换成需要署名的商用底图），把它改成 true 即可。
      showAttribution: false,
    };
  })();

  // ==================================================================
  // ② 路径配置
  // ==================================================================
  window.geoJsonBasePath = "./assets/geojson/";
  window.geoJsonCosPath =
    "https://dupal-1258052757.cos.ap-shanghai.myqcloud.com/assets/geojson/";

  // dupal.cn 本身就是 COS 静态域名，相对路径即 COS 路径且走 CDN 加速
  // 因此始终优先使用相对路径，加载失败时回退到 COS 直连 URL
  window.geoJsonPrimaryPath = window.geoJsonBasePath;
  window.geoJsonFallbackPath = window.geoJsonCosPath;

  // ==================================================================
  // ③ 图层清单
  // ==================================================================
  // 分组顺序 = 面板显示顺序。groupName 为 null 的组是「平铺组」，
  // 不生成折叠箭头，其图层直接平铺在上一级。
  // 详细字段见文件头说明；加图层请只改这一段。
  window.geoJsonGroups = [
    {
      groupName: "全球板块构造",
      layers: [
        { name: "全球16大板块 plate16", file: "plate16.geojson" },
        {
          name: "全球280个板块 (Hasterok2022)",
          file: "plates_Hasterok2022.geojson",
        },
        { name: "大陆板块 plate_cont", file: "plate_cont.geojson" },
        { name: "大洋板块 plate_ocean", file: "plate_ocean.geojson" },
        {
          name: "洋中脊和转换断层 MOR&TF",
          file: "ridgenew.geojson",
          color: "#E63946",
        },
        { name: "海沟 Trench", file: "Pb_trench.geojson" },
        {
          name: "其他板块边界 Other boundries",
          file: "Pb_transformall.geojson",
        },
        { name: "大西洋断裂带 Atlantic_FZ", file: "Atlantic_FZ.geojson" },
        { name: "印度洋断裂带 Indian_FZ", file: "Indian_FZ.geojson" },
        { name: "太平洋断裂带 Pacific_FZ", file: "Pacific_FZ.geojson" },
      ],
    },
    {
      groupName: "洋中脊作用域",
      layers: [
        {
          name: "1全球洋壳 GlobalOceanicCrust",
          file: "1GlobalOceanicCrust.geojson",
        },
        { name: "2大洋域 OceanDomian", file: "2OceanDomian.geojson" },
        { name: "3次大洋域 SubOceanDomain", file: "3SubOceanDomain.geojson" },
        { name: "4洋中脊作用域 RidgeDomain", file: "4RidgeDomain.geojson" },
        {
          name: "全球陆壳 GlobalContinentalCrust",
          file: "global_continental_crust.geojson",
        },
        // { name: "0作用域边界 RDboundary", file: "RD_plgn1_5.geojson" },
      ],
    },
    {
      groupName: "海底基础信息",
      layers: [
        {
          name: "火山 volcanos",
          file: "volcanos.geojson",
          labelField: "NAME",
          color: "#FF3333",
          icon: "volcano",
          colorMode: "single",
        },
        {
          name: "4.5级以上地震(2024-2026)",
          file: "EQ4_5_2024_2026.geojson",
        },
        {
          name: "7.0级以上地震(1800-2023)",
          file: "EQ7_1800_2023.geojson",
        },
        {
          name: "8.0级以上地震(1800-2023)",
          file: "EQ8_1800_2023.geojson",
        },
        {
          name: "热点 hotspots",
          file: "hotspots.geojson",
          labelField: "geodesc",
          color: "#FF3333",
          icon: "hotspot",
          colorMode: "single",
        },
        { name: "大火成岩省 (Johansson)", file: "LIP_Johansson.geojson" },
        { name: "洋壳年龄30Ma间隔", file: "seafloor_age_30.geojson" },
        // 盆地（Evenick2021 / CGG）属陆地地理信息 → 已移到下方「陆地地理信息」组
        {
          name: "海底地名点 Gazetteer_point",
          file: "Gazetteer_point.geojson.gz",
          labelField: "name",
          defaultOpacity: 0.35,
          searchPriority: true,
        },
        {
          name: "海底地名多点 Gazetteer_multipoint",
          file: "Gazetteer_multipoint.geojson.gz",
          labelField: "name",
          defaultOpacity: 0.35,
          searchPriority: true,
        },
        {
          name: "海底地名线 Gazetteer_multilinestring",
          file: "Gazetteer_multilinestring.geojson.gz",
          labelField: "name",
          defaultOpacity: 0.35,
          searchPriority: true,
        },
        {
          name: "海底地名面 Gazetteer_multipolygon",
          file: "Gazetteer_multipolygon.geojson.gz",
          labelField: "name",
          defaultOpacity: 0.35,
          searchPriority: true,
        },
      ],
    },
    {
      // 海洋地理信息：以「人在海上活动的痕迹与区划」为主
      // —— 海运（港口）、海域区划（海区）、安全事件（海盗）、通信（光缆/登陆点）
      groupName: "海洋地理信息",
      layers: [
        {
          name: "全球海盗事件 ASAM Piracy Events",
          file: "All_ASAM_Events.geojson.gz",
          labelField: "hostility_",
          colorMode: "field",
          colorField: "hostility_",
        },
        {
          name: "海底光缆 Submarine Cables",
          file: "TeleGeography_Cables.geojson.gz",
          labelField: "name",
          color: "#00ACC1",
        },
        {
          name: "光缆登陆点 Landing Points",
          file: "TeleGeography_LandingPoints.geojson.gz",
          labelField: "name",
          color: "#00897B",
        },
        {
          name: "海区 geography_marine_polys",
          file: "geography_marine_polys.geojson.gz",
          labelField: "name_zh",
          source: "https://www.naturalearthdata.com/",
          searchPriority: true,
        },
        {
          name: "港口 ports",
          file: "ports.geojson.gz",
          labelField: "name",
          source: "https://www.naturalearthdata.com/",
          searchPriority: true,
        },
      ],
    },
    {
      groupName: "大型异常区",
      layers: [
        { name: "LLSVP", file: "LLSVP.geojson" },
        { name: "Dupal异常洋 DupalOcean", file: "DupalOcean.geojson" },
      ],
    },
    {
      groupName: "海底矿产资源",
      layers: [
        {
          name: "热液喷口 HydrothermalVents(ISA)",
          file: "hydrothermal_vents.geojson",
          labelField: "Name ID",
          color: "#FF3333",
          icon: "hotspot",
          colorMode: "single",
        },
        { name: "多金属结核 Fe-MnNodule(NOAA)", file: "Fe_MnNodule.geojson" },
        { name: "富钴结壳 Co-richCrust(NOAA)", file: "Co-richCrust.geojson" },
        {
          name: "PMN 全球多金属结核勘探合同区",
          file: "01_pmn_exploration_areas.geojson.gz",
          labelField: "Contractor",
          colorMode: "field",
          colorField: "Contractor",
        },
        {
          name: "PMS 多金属硫化物勘探合同区",
          file: "02_pms_exploration_areas.geojson.gz",
          labelField: "Contractor",
          colorMode: "field",
          colorField: "Contractor",
        },
        {
          name: "CFC 富钴结壳勘探合同区",
          file: "03_cfc_exploration_areas.geojson.gz",
          labelField: "Contractor",
          colorMode: "field",
          colorField: "Contractor",
        },
        {
          name: "EBSA 海洋保护区&特殊生态区",
          file: "EBSAs_4326_Vis.geojson.gz",
          color: "#66BB6A",
          colorMode: "single",
        },
      ],
    },
    {
      groupName: "地质站位",
      layers: [
        { name: "DSDP", file: "DSDP.geojson", labelField: "Hole" },
        { name: "ODP", file: "ODP.geojson", labelField: "Fullname" },
        { name: "IODP03-13", file: "IODP03-13.geojson" },
        { name: "IODP13-26", file: "IODP13-26.geojson", labelField: "site" },
        { name: "NWIR_rock", file: "NWIR_ridge.geojson" },
        { name: "SWIR_rock", file: "SWIR_ridge.geojson" },
        { name: "SEIR_rock", file: "SEIR_ridge.geojson" },
        { name: "SEIR_offaxis_rock", file: "SEIR_offaxis.geojson" },
        { name: "RedSea_rock", file: "RedSea_rift.geojson" },
        // 以下两个图层暂与海洋地质主题无关（古生物 / 气候岩性指标），先隐藏保留
        { name: "古生物学 PBDB", file: "PBDB.geojson", hidden: true },
        { name: "气候岩性指标 PBDB", file: "Boucot.geojson", hidden: true },
      ],
    },
    {
      // 陆地地理信息：以陆地国家/行政区为主体（海洋相关内容见「海洋地理信息」组）
      groupName: "陆地地理信息",
      layers: [
        // 2026 世界杯系列与海洋地质主题无关，先隐藏保留
        {
          name: "2026世界杯8强",
          file: "wc2026_round8_teams.geojson",
          labelField: "name_zh",
          hidden: true,
        },
        {
          name: "2026世界杯16强",
          file: "wc2026_round16_teams.geojson",
          labelField: "name_zh",
          hidden: true,
        },
        {
          name: "2026世界杯32强",
          file: "wc2026_round32_teams.geojson",
          labelField: "name_zh",
          hidden: true,
        },
        {
          name: "2026世界杯48强",
          file: "wc2026_48_teams.geojson",
          labelField: "name_zh",
          hidden: true,
        },
        {
          name: "世界各国",
          file: "countries-all-195.geojson",
          labelField: "name_zh",
        },
        {
          name: "富裕国家",
          file: "countries-rich-50K.geojson",
          labelField: "name_zh",
        },
        {
          name: "贫穷国家",
          file: "countries-poor-5K.geojson",
          labelField: "name_zh",
        },
        {
          name: "人口大国",
          file: "countries-populous.geojson",
          labelField: "name_zh",
        },
        {
          name: "经济强国",
          file: "countries-economic-powers.geojson",
          labelField: "name_zh",
        },
        {
          name: "领土大国",
          file: "countries-large-territory.geojson",
          labelField: "name_zh",
        },
        {
          name: "全球军事设施 Overseas Military Bases",
          file: "OMB.geojson.gz",
          labelField: "Name",
          color: "#C62828",
        },
        {
          name: "中国县城名称 China County",
          file: "ChinaCounty.geojson.gz",
          labelField: "NAME",
          color: "#1976D2",
          searchPriority: true,
        },
        {
          name: "浙江适飞区(2026-05-12)",
          file: "浙江适飞区_20260512.geojson.gz",
          source:
            "浙江省交通运输厅 2026年5月12日 关于公布新版浙江省无人驾驶航空器适飞空域范围的公告",
          selectable: false,
          // 整区一个信息、无分类字段：单色填充（不写 colorMode 会被当成面要素
          // 默认的 sequential 上色 —— 虽然本图层只有 1 个要素看着也是纯色，
          // 但写死在配置里，以后数据加要素也还是同一个蓝）
          color: "#1976D2",
          colorMode: "single",
        },
        // —— 沉积盆地：地理上属于陆地，2026-09-17 从「海底基础信息」移入本组 ——
        {
          name: "盆地 (Evenick2021)",
          file: "global_basins_Evenick2021.geojson",
        },
        // 盆地只保留一个数据源：CGG 数据集体积过大（10MB gz），统一并入 Evenick2021
        {
          name: "盆地 (CGG)",
          file: "Sedimentary_CGG.geojson",
          hidden: true,
        },
        // {
        //   name: "国家行政区 countries",
        //   file: "countries.geojson.gz",
        //   labelField: "NAME_ZH",
        //   source: "https://www.naturalearthdata.com/",
        //   searchPriority: true,
        // },
        // {
        //   name: "省级行政区 states_provinces",
        //   file: "states_provinces.geojson.gz",
        //   labelField: "name_zh",
        //   source: "https://www.naturalearthdata.com/",
        // },
      ],
    },
    // 测试数据整组隐藏（PIC 45 万点仅用于压力测试，不对公众开放）
    {
      groupName: "测试数据",
      hidden: true,
      layers: [{ name: "PIC 45万点", file: "pic.geojson" }],
    },
    // Dupal异常区已由「大型异常区 → Dupal异常洋 DupalOcean」承载，此处重复项隐藏
    {
      groupName: null,
      layers: [{ name: "Dupal异常区", file: "DupalOcean.geojson", hidden: true }],
    },
  ];

  // ==================================================================
  // ③-补 清单兜底
  // ==================================================================
  // geojsonloader.js 会直接 window.geoJsonGroups.forEach() 建图层树，
  // 万一上面清单被误删/写错语法导致没挂上，没有兜底就是 TypeError 白屏。
  // 有它则页面照常打开、只是没有图层 —— 故障可见可控。
  window.geoJsonGroups = window.geoJsonGroups || [];

  // ========== 未来扩展位：远程配置 ==========
  // 目前整份配置随站点发布（本地文件）。若要做「改配置不发版」，在这里
  // 追加一次 fetch(远程 JSON) 覆盖上述变量即可 —— 结构不用变，谁后写入谁生效。
  // 注意两点：
  //   1. 远程来源须走跨域绝对 URL。service-worker.js 明确跳过跨域请求，
  //      因此改完即刻生效、无需 bump CACHE_NAME；代价是跨域不进 SW 缓存，
  //      离线时取不到配置（本地清单则离线可用）。
  //   2. 覆盖只能发生在 geojsonloader.js 初始化之前，否则图层树已经建好了。

  // ==================================================================
  // ④ 地名注册表（深链 / 关键词跳转用）
  // ==================================================================
  // focus/<name> 会先查这里（curated，即时、无需搜索）；未命中再退化为搜索。
  // bbox: [[minLat, minLng], [maxLat, maxLng]]；center+zoom 与 bbox 二选一，center 优先。
  // 坐标为近似示意，实施时建议按真实范围校准。
  window.PLACE_REGISTRY = [
    {
      name: "南海",
      aliases: ["South China Sea", "南海海域", "南中国海", "南海诸岛"],
      bbox: [
        [0, 105],
        [25, 122],
      ],
      center: [12, 113],
      zoom: 5,
    },
    {
      name: "东海",
      aliases: ["East China Sea", "东中国海"],
      bbox: [
        [24, 118],
        [41, 131],
      ],
      center: [31, 126],
      zoom: 5,
    },
    {
      name: "黄海",
      aliases: ["Yellow Sea", "黄东海"],
      bbox: [
        [31, 119],
        [40, 127],
      ],
      center: [35, 123],
      zoom: 6,
    },
    {
      name: "渤海",
      aliases: ["Bohai Sea", "渤黄海"],
      bbox: [
        [37, 117],
        [41, 122],
      ],
      center: [39, 119.5],
      zoom: 7,
    },
    {
      name: "台湾海峡",
      aliases: ["Taiwan Strait", "台海"],
      bbox: [
        [22, 118],
        [25.5, 122],
      ],
      center: [23.8, 119.5],
      zoom: 7,
    },
    {
      name: "巴士海峡",
      aliases: ["Luzon Strait", "巴士海峡"],
      bbox: [
        [19, 119],
        [22, 122],
      ],
      center: [20.5, 121],
      zoom: 7,
    },
  ];
})();
