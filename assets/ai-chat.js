/*!
 * ai-chat.js —— OGV AI 助手（地图操作向，非影像分析）
 * =============================================================================
 * 与 tthh 的 Leaflet.AIChat 不同：这里**不处理照片、不用视觉模型**，核心是
 * 「AI 调工具操作地图」。两条路径：
 *
 *  ① 本地直通（零 API、离线可用）：输入先过 `window.__OGV_search`（geojsonloader.js
 *     暴露的搜索原语）—— 唯一命中直接 `__OGV_highlight` 定位；多命中在对话里
 *     列出候选卡片，点哪个定位哪个。
 *  ② 模型兜底（deepseek-chat tool-calling）：本地没命中 / 复合指令（如
 *     「打开俯冲带图层，出一张 A4 300dpi 的图」）时，模型返回结构化工具调用，
 *     本地执行后把结果回喂，最多循环 MAX_TOOL_ROUNDS 轮。
 *
 * 工具清单（全部执行本地既有原语，不新造轮子）：
 *   search_features(query)        → __OGV_search（只查站点自带矢量）
 *   zoom_to_feature(name)         → __OGV_highlight（图层则勾选 + 按 _featureCache 算 bbox fitBounds）
 *   locate(query)                 → **综合定位**：矢量 → 地名表 → 天地图（三级兜底，见 _locate）
 *   geocode(query)                → 天地图地名检索（只查坐标，不跳转；矢量里没有的地名靠它）
 *   reverse_geocode(lat,lng)      → 天地图逆地理编码（坐标 → 地名/行政区）
 *   web_search(query, count?)     → **DeepSeek 网页搜索**（见下「第四级兜底」）
 *   web_fetch(url)                → DeepSeek 网页抓取（返回 Markdown 正文）
 *   toggle_layer(name, visible)   → 面板 checkbox.checked + change 事件（沿用快捷区转发模式）
 *   list_layers(filter)           → 读面板 DOM，列图层清单 + 开关状态（模型不用瞎猜名字）
 *   list_options(filter)          → 列「地图设置」里的站点开关（3D/极地/聚类/标签/深色…）
 *   set_option(name, on)          → 拨动任意站点开关（走 change 事件 → 完整副作用 + 落盘）
 *   set_view(lat,lng,zoom|place|layer) → 精确构图（区域图靠它，避免缩到"两圈世界"）
 *   zoom_map(direction, steps)    → 原地放大/缩小
 *   set_basemap(name)             → 底图控件里的 radio（沿用 baselayerchange 落盘链路）
 *   preview_export(options)       → 先渲染缩略图贴进对话，再决定要不要下载
 *   open_export(options)          → MapExport.applyOptions（map-export-ui.js 的对外接口）
 *   export_image(options)         → MapExport.exportNow（直接出图下载）
 *   get_map_state()               → 中心点 / 缩放 / 底图 / 视野跨度
 *
 * 地名/资料的四级兜底（哪一级命中就说哪一级，不许编坐标）：
 *   ① 站点矢量（`__OGV_search`，能高亮要素 + 弹属性）
 *   ② 内置地名表 `PLACE_REGISTRY`（curated 海区，离线可用）
 *   ③ 天地图地名服务（`OGVGeo`，覆盖行政区 / POI，只给坐标不给属性）
 *   ④ **DeepSeek 网页搜索**（`OGVWeb`）—— 前三级的盲区是**非地理内容**
 *      （「马里亚纳海沟最大深度」「洋中脊热液喷口的定义」「这版规范什么时候实施」）。
 *      第四级**没有坐标**，只能给资料 + 链接，所以它只在「定位失败 / 问的是知识」时出现，
 *      模型会明确告诉用户「图上定位不到，但资料显示…」。
 *
 * 交互层：
 *   · 右下角悬浮球（L.Control，与图层控件同列）点击开关面板，可在「地图设置」
 *     里用「AI 悬浮球」开关关掉；快捷键 Ctrl/⌘ + K 随时唤起并聚焦输入框。
 *   · 每轮请求都会把「当前地图状态」拼到最后一条用户消息后面（_ctxLine），
 *     模型不必为了知道自己在哪先花一次 tool call 调 get_map_state。
 *
 * ⚠️ 所有 fitBounds 都走 _fitBoundsSafe：视野一旦超过一圈世界，Leaflet 会在屏幕上
 *    并排铺 2~3 个世界副本，出图会把它们照抄下来（标签也跟着重复）。宁可放大，
 *    也不要在一张论文图里印两个地球。
 *
 * Key 策略（与 tthh 同口径）：本机没填过 Key 时用内置 DEFAULT_API_KEY（可用
 *   window.OGV_AI_DEFAULT_KEY 覆盖）；用户自填的永远优先。存储一律走 OGVStorage。
 *
 * 依赖：geo-utils.js（OGVStorage）、geojsonloader.js（__OGV_search/__OGV_highlight）、
 *       map-export-ui.js / map-export.js（MapExport）—— 均为**运行时**依赖，加载顺序随意。
 * =============================================================================
 */
(function (global) {
  "use strict";

  // ─────────────────────────────────────────────
  //  配置
  // ─────────────────────────────────────────────
  var API_URL = "https://api.deepseek.com/chat/completions";
  /**
   * 模型：`deepseek-flash` = **DeepSeek-V4.1-Flash-1017**（官方现行型号名）。
   * ⚠️ 老的 `deepseek-chat` / `deepseek-reasoner` 是上一代命名，官方文档已改为
   *    `deepseek-flash`（Flash 线）与 `deepseek-v4-pro`（Pro 线）；继续写老名字
   *    能跑但语义不稳（哪天重定向变了，行为也跟着变），这里直接写准名字。
   * 宿主页可用 `window.OGV_AI_MODEL` 覆盖（例如换 `deepseek-v4-pro` 做更重的推理）。
   */
  var MODEL =
    (global.OGV_AI_MODEL && String(global.OGV_AI_MODEL).trim()) || "deepseek-flash";
  /**
   * 思考模式：V4 系列**默认开启**。这里显式关掉 —— 两条理由：
   *  ① 本助手的活是「查一下 / 点一下 / 出一张图」，靠工具不靠长思考，开了纯变慢；
   *  ② 官方规定「请求带 tools 时，后续每一轮都必须回传 reasoning_content」，
   *     漏回传直接 400。关掉思考 = 没有 reasoning_content = 这条陷阱不存在。
   * 需要长推理时（复杂分析）把 THINKING 置 "enabled" 即可，`messages.push(msg)`
   * 已原样保留模型返回的 reasoning_content，回传链是通的。
   */
  var THINKING = "disabled";
  /**
   * 内置默认 Key：让访客开箱即用。⚠️ 明文写在静态 JS 里 = 公网任何人都拿得到，
   * 配额与费用挂在签发账号上 —— 这是既定取舍，作废时把值改回 ""。
   * 宿主页可先写 window.OGV_AI_DEFAULT_KEY 覆盖（"" = 当作没内置 Key）。
   */
  var DEFAULT_API_KEY =
    global.OGV_AI_DEFAULT_KEY != null
      ? String(global.OGV_AI_DEFAULT_KEY)
      : "sk-edb523a619a34d3392029ddf30334c55";

  var MAX_TOOL_ROUNDS = 8; // tool-calling 循环上限（防模型死循环调工具）
  var MAX_HISTORY = 12; // 带上文条数（纯文本，不大）
  var MAX_CANDIDATES = 8; // 本地多命中时列出的候选数
  var REQ_TIMEOUT = 60000;

  // 出图意图关键词：命中就跳过本地直通，直接进模型（「出图」也是个地名时再说）
  var EXPORT_INTENT = /出图|导出|打印|pdf|a3|a4|dpi|图例|比例尺|指北针|经纬网/i;
  /**
   * 提问意图：命中就**不要**把整句当人名地名去查。
   * 否则「马里亚纳海沟最大深度」会被天地图当成 POI「马里亚纳海沟」命中，
   * 然后助手只回一句「已定位到马里亚纳海沟」—— 答非所问。
   * 这种句子交给模型：它能先 locate、再 web_search，两件事一起办。
   */
  var QA_INTENT =
    /[?？]|多少|多大|多深|多长|多厚|多宽|多重|什么|为什么|怎么|如何|哪里|在哪|哪年|哪一?年|几时|定义|区别|差别|有哪些|介绍|解释|原理|成因|对比|最新|进展|新闻|规范|标准|区别/i;

  var SYSTEM_PROMPT = [
    "你是「海洋地质一张图」（OGV）网站的 AI 助手，一个基于 Leaflet 的海洋地质数据平台。",
    "你能用工具做的事：查/定位地名与要素、开关图层、拨动站点设置、换底图、调视野、出图。",
    "规则：",
    "1. 用户提到具体地名/要素名时，用 locate（它自己会按「矢量 → 内置地名表 → 天地图」",
    "   三级查，并直接跳过去）。只想先看候选、不想跳就用 geocode。",
    "   都查不到就如实说「没找到」，不要编造坐标。",
    "2. 不知道有哪些图层/设置项时，先 list_layers / list_options，不要猜名字。",
    "   用户说「打开聚类」「关掉深色模式」这类，用 set_option（名字照 list_options 里的写）。",
    "3. 开关数据图层用 toggle_layer；换底图用 set_basemap。",
    "4. **构图比参数重要**：",
    "   - 出图前先看系统给你的「当前地图状态」。若经度跨度超过约 180°，说明地图缩得太小，",
    "     出图会变成「好几个世界拼在一起」。这时先用 set_view 把视野收到主题区域",
    "     （区域图一般 zoom 3~6；欧亚/印度洋这类大区 zoom 3~4，海区/洋中脊段 zoom 5~7）。",
    "   - 图层整体定位（zoom_to_feature 传图层名）只在用户确实想看全层时用。",
    "5. 出图：用户想直接拿到图片 → export_image；用户想先看看/自己微调 → preview_export 或 open_export。",
    "   参数：preset 可选 a4w=A4横版 / full=A4竖版 / col1=单栏85mm / col2=双栏170mm；",
    "   dpi 默认 300（论文配图），可选 96/150/300/600/1200，也可传任意 30~2400 的数字；",
    "   title/subtitle 是主副标题；graticule/legend/scaleBar/northArrow/labels/attribution 是布尔开关，",
    "   用户没提的开关不要乱改；用户说「不要图例」就 legend=false，以此类推。",
    "6. 一次回复里可以连续调多个工具（如先 set_view 再 export_image）。",
    "7. **联网搜索**（web_search / web_fetch）—— 用在本地三级都覆盖不到的地方：",
    "   - 问的是**知识/事实**而不是位置时（深度、年龄、面积、定义、某规范哪年实施、",
    "     最近有什么新闻），直接 web_search，不要拿训练数据硬答；",
    "   - locate 返回 ok:false 但它同时给了 web 结果时，说明图上定位不到 —— 先说明这一点，",
    "     再用那些资料回答，**绝不许**把没有坐标的地方说成「已定位」；",
    "   - 结果里 title/url/summary 已经够答就不用 web_fetch；只有需要具体数据、原文措辞、",
    "     表格时才 web_fetch 那一两条最相关的 URL（抓全文很贵，一次别超过 2 条）；",
    "   - 引用要给链接，格式 `[站点名](url)`，放在提到该结论的那句话后面；",
    "   - 搜索结果为空就直说「网上也没查到」，不要换个说法编一遍。",
    "8. 用简体中文简洁作答；操作完成后一句话说明做了什么，不要罗列参数。",
  ].join("\n");

  var TOOLS = [
    {
      type: "function",
      function: {
        name: "search_features",
        description:
          "只在**站点自带矢量数据**里搜（图层名 + 要素属性）。查地名用 locate / geocode —— " +
          "它们会在这个搜索之后再兜底天地图，覆盖面大得多。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词，如「欧亚板块」「火山」" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "locate",
        description:
          "按名字定位并跳过去（首选）。顺序：站点矢量 → 内置地名表 → 天地图地名服务。" +
          "矢量里有就直接高亮要素；没有就在天地图里找地名并移到该位置。返回用的哪一级、坐标。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "地名 / 要素名 / 图层名，如「南海」「舟山」「欧亚板块」" },
            zoom: { type: "number", description: "可选，定位后的缩放级别（不给就用该地名的推荐级别）" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "geocode",
        description:
          "查天地图地名服务，返回候选（名称/经纬度/地址），**不跳转**。" +
          "用于用户想「看看有哪些同名地名」或需要你先判断再决定去哪。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "地名关键词" },
            count: { type: "number", description: "返回条数，默认 8，最多 30" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "reverse_geocode",
        description: "经纬度 → 地名/行政区（天地图逆地理编码）。用户问「这个点在哪/这一带叫什么」时用。",
        parameters: {
          type: "object",
          properties: {
            lat: { type: "number", description: "纬度；不给就用地图中心" },
            lng: { type: "number", description: "经度；不给就用地图中心" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "联网搜索网页（DeepSeek 自研搜索，返回标题/链接/摘要/站点/日期/权威性）。" +
          "用在「本地矢量、地名表、天地图都覆盖不到」的地方：知识类问题（深度、年龄、定义、" +
          "规范条文、最新进展），或 locate 三级都没定位到时的资料兜底。" +
          "**它不给经纬度**，只能用来回答和引用，不能当作定位结果。" +
          "支持搜索语法：site:example.com、-site:、\"精确短语\"、lang:zh、after:2025、before:2026。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索词（1~128 字符）。用户原话很长时给出提炼后的关键词，不要照抄整句",
            },
            count: { type: "number", description: "返回条数 1~20，默认 6；只是问概念 3~5 条就够" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description:
          "抓取单个网页并返回 Markdown 正文（DeepSeek Fetch）。只有摘要不够、需要具体数值/原文/" +
          "表格时才用，一次最多 2 条 URL —— 全文很长很贵。",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "要抓取的 http(s) 地址（通常来自 web_search 的 url）" },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "zoom_to_feature",
        description: "定位到指定名称的要素或图层（缩放 + 高亮；图层会自动勾选打开）",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "要素或图层名称（来自 search_features 结果）" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "toggle_layer",
        description: "打开或关闭某个图层",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "图层名称" },
            visible: { type: "boolean", description: "true=打开，false=关闭" },
          },
          required: ["name", "visible"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "open_export",
        description: "按给定参数打开出图面板（仅在用户明确想预览/手动微调时用；否则用 export_image 直接出图）",
        parameters: {
          type: "object",
          properties: {
            preset: { type: "string", enum: ["a4w", "col1", "col2", "full", "custom"] },
            paperWidthMm: { type: "number" },
            dpi: { type: "number", description: "分辨率 dpi：常用 96/150/300/600/1200，也可给任意 30~2400；默认 300" },
            title: { type: "string", description: "图标题" },
            subtitle: { type: "string" },
            graticule: { type: "boolean", description: "经纬网+经纬度标注" },
            legend: { type: "boolean" },
            scaleBar: { type: "boolean" },
            northArrow: { type: "boolean" },
            labels: { type: "boolean", description: "要素标签" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "export_image",
        description:
          "直接渲染当前地图视野并下载图片，不打开出图面板。用户说「出图/导出/下载地图/帮我出一张图」时默认用这个。" +
          "返回里带 frame（这张图覆盖的经纬度范围）与 warnings（世界副本/缺底图/瓦片失败等），请据此向用户说明构图；warnings 里若说视野超过一圈世界，先 set_view 收视野再重出。",
        parameters: {
          type: "object",
          properties: {
            preset: { type: "string", enum: ["a4w", "col1", "col2", "full", "custom"], description: "纸面预设" },
            paperWidthMm: { type: "number", description: "自定义纸面宽度 mm（配 custom）" },
            paperHeightMm: { type: "number", description: "自定义纸面高度 mm，0=按地图宽高比自动" },
            dpi: { type: "number", description: "分辨率 dpi：常用 96/150/300/600/1200，也可给任意 30~2400；默认 300" },
            title: { type: "string", description: "图标题" },
            subtitle: { type: "string", description: "副标题" },
            graticule: { type: "boolean", description: "经纬网+经纬度标注" },
            legend: { type: "boolean", description: "图例" },
            legendTitle: { type: "string", description: "图例标题" },
            scaleBar: { type: "boolean", description: "比例尺" },
            northArrow: { type: "boolean", description: "指北针" },
            labels: { type: "boolean", description: "要素标签" },
            attribution: { type: "boolean", description: "数据来源/版权标注" },
            includeBase: { type: "boolean", description: "是否含底图" },
            includeOverlays: { type: "boolean", description: "是否含覆盖层（如标注层）" },
            format: { type: "string", enum: ["png", "jpeg"] },
            filename: { type: "string", description: "文件名前缀（可选）" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_layers",
        description:
          "列出图层面板里的图层（名称 + 分组 + 是否已打开）。不确定图层叫什么时先调这个，别猜。",
        parameters: {
          type: "object",
          properties: {
            filter: { type: "string", description: "可选关键词，如「洋中脊」「印度洋」" },
            onlyOn: { type: "boolean", description: "只列出已打开的图层" },
            limit: { type: "number", description: "最多返回多少条，默认 40" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_options",
        description:
          "列出「地图设置」里的所有站点开关（3D 视图/极地视图/点聚类/显示标签/经纬网/图例/深色模式…）" +
          "及当前状态。要改设置前先看这个，别猜开关名。",
        parameters: {
          type: "object",
          properties: {
            filter: { type: "string", description: "可选关键词，如「标签」「深色」" },
            onlyOn: { type: "boolean", description: "只列已开启的" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_option",
        description:
          "拨动某个站点开关（打开/关闭）。走真实 change 事件，所以持久化、副作用、" +
          "快捷区同步都会发生，和用户手点一样。3D/极地视图首次开启较慢（要下载引擎）。",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "开关名（照 list_options 的 name 写，可只给关键词）" },
            on: { type: "boolean", description: "true=打开，false=关闭" },
          },
          required: ["name", "on"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_view",
        description:
          "精确设置地图视野（中心经纬度 + 缩放），或按地名/图层名定位。出图前用它把视野收到主题区域。",
        parameters: {
          type: "object",
          properties: {
            lat: { type: "number", description: "中心纬度，-85~85" },
            lng: { type: "number", description: "中心经度，-180~180" },
            zoom: { type: "number", description: "缩放级别；区域图一般 3~6" },
            place: { type: "string", description: "按地名注册表定位（如「南海」），优先级高于经纬度" },
            layer: { type: "string", description: "按图层名定位（缩放到该图层全部要素）" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "zoom_map",
        description: "在当前中心原地放大 / 缩小（用户说「放大一点」「拉远看看」时用）",
        parameters: {
          type: "object",
          properties: {
            direction: { type: "string", enum: ["in", "out"], description: "in=放大，out=缩小" },
            steps: { type: "number", description: "级数，默认 1" },
          },
          required: ["direction"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_basemap",
        description: "切换底图（按名称匹配底图控件里的项，如「ArcGIS-海洋」「天地图影像」）",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "底图名称（可用部分关键词）" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "preview_export",
        description:
          "按给定参数在当前视野渲染一张缩略图并直接显示在对话里（不下载）。用户想先看看效果、或需要确认构图时用。",
        parameters: {
          type: "object",
          properties: {
            preset: { type: "string", enum: ["a4w", "col1", "col2", "full", "custom"] },
            paperWidthMm: { type: "number" },
            paperHeightMm: { type: "number" },
            dpi: { type: "number", description: "分辨率 dpi（默认 300）" },
            title: { type: "string" },
            subtitle: { type: "string" },
            graticule: { type: "boolean" },
            legend: { type: "boolean" },
            scaleBar: { type: "boolean" },
            northArrow: { type: "boolean" },
            labels: { type: "boolean" },
            attribution: { type: "boolean" },
            includeBase: { type: "boolean" },
            includeOverlays: { type: "boolean" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_map_state",
        description: "获取当前地图中心点、缩放级别、底图，以及视野横向跨度（判断会不会出现世界副本）",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  // ─────────────────────────────────────────────
  //  状态
  // ─────────────────────────────────────────────
  var _root = null;
  var _els = {};
  var _open = false;
  var _busy = false;
  var _abort = null;
  var _msgs = []; // {role:"user"|"assistant", text, cands?, geo?, img?} —— 展示态
  var _lastSearch = null; // 最近一次 search 结果（zoom_to_feature 按名解析用）
  var _geoLast = null; // 最近一次天地图候选（点击卡片用）

  var S = global.OGVStorage || null;

  // ─────────────────────────────────────────────
  //  两个用户可拨的运行开关（输入框下方那两颗 pill，默认都关）
  //  · web   联网搜索：关掉时 TOOLS 里剔除 web_search/web_fetch，
  //          并且「定位失败自动联网」也不再发生 —— 一点配额都不花。
  //  · think 深度思考：V4 默认开，我们默认关（靠工具不靠长思考）；
  //          开了之后 thinking:{type:"enabled"}，官方要求带 tools 时每轮回传
  //          reasoning_content —— messages.push(msg) 是整条入栈，链路天然成立。
  // ─────────────────────────────────────────────
  var _opt = { web: false, think: false };
  var OPT_KEY = {
    web: (S && S.KEY && S.KEY.AI_WEB_SEARCH) || "ogv_ai_web_search",
    think: (S && S.KEY && S.KEY.AI_THINKING) || "ogv_ai_thinking",
  };
  function _loadOpts() {
    try {
      _opt.web = S && S.getBool ? !!S.getBool(OPT_KEY.web, false) : false;
      _opt.think = S && S.getBool ? !!S.getBool(OPT_KEY.think, false) : false;
    } catch (e) {
      _opt.web = false;
      _opt.think = false;
    }
  }
  function _setOpt(name, on) {
    if (name !== "web" && name !== "think") return;
    _opt[name] = !!on;
    try {
      // ⚠️ 必须写 "true"/"false"：OGVStorage.getBool 只把字符串 "true" 当真，
      //    写 "1" 会被 open() 里的 _loadOpts 读成 false，开关看着点了却没生效。
      if (S && S.safeSet) S.safeSet(OPT_KEY[name], on ? "true" : "false");
    } catch (e) {}
    _syncOptBtns();
  }
  function _syncOptBtns() {
    if (!_els.optWeb || !_els.optThink) return;
    _els.optWeb.setAttribute("aria-pressed", _opt.web ? "true" : "false");
    _els.optWeb.classList.toggle("is-on", !!_opt.web);
    _els.optThink.setAttribute("aria-pressed", _opt.think ? "true" : "false");
    _els.optThink.classList.toggle("is-on", !!_opt.think);
    _els.optWeb.title = _opt.web
      ? "联网搜索已开：知识类问题会去网上查（约 0.005 元/次）"
      : "联网搜索已关：只查本站矢量、内置地名表与天地图，不产生搜索费用";
    _els.optThink.title = _opt.think
      ? "深度思考已开：复杂问题先推理再动手（响应慢几秒）"
      : "深度思考已关：地图操作不需要长思考，响应更快";
  }
  /** 当前可用工具集：联网工具按开关临时剔除（模型看不到就不会去调） */
  function _toolsFor() {
    if (_opt.web) return TOOLS;
    return TOOLS.filter(function (t) {
      var n = t.function && t.function.name;
      return n !== "web_search" && n !== "web_fetch";
    });
  }

  // ─────────────────────────────────────────────
  //  小工具
  // ─────────────────────────────────────────────
  function _el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function _esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  /**
   * 极简 Markdown（先转义再套格式，杜绝 XSS）：粗体 / 行内码 / 链接 / 列表 / 换行
   * 链接是为「联网搜索要给来源」加的：`[站点名](https://…)`。只认 http(s)，
   * 且 URL 已被 _esc 处理（引号→&quot;），塞进 href 属性是安全的。
   */
  function _md(src) {
    var t = _esc(src || "");
    t = t.replace(/`([^`\n]+)`/g, '<code class="ai-code">$1</code>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a class="ai-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
    t = t.replace(/^#{1,4}\s*(.+)$/gm, "<strong>$1</strong>");
    t = t.replace(/^\s*[-*]\s+(.+)$/gm, "• $1");
    return t.replace(/\n/g, "<br>");
  }
  function _toast(msg) {
    if (typeof global.showToast === "function") global.showToast(msg, { duration: 2500 });
  }
  function _maskKey(k) {
    k = String(k || "");
    if (k.length <= 12) return k ? k.slice(0, 2) + "****" : "";
    return k.slice(0, 8) + "****" + k.slice(-4);
  }
  function _ownKey() {
    return (S && S.safeGet && S.KEY ? S.safeGet(S.KEY.AI_KEY, "") : "") || "";
  }
  function _key() {
    return _ownKey().trim() || String(DEFAULT_API_KEY || "").trim();
  }

  // ─────────────────────────────────────────────
  //  地图原语（本地执行层）
  // ─────────────────────────────────────────────
  function _search(query) {
    if (typeof global.__OGV_search !== "function") return { items: [], total: 0 };
    try {
      return global.__OGV_search(query) || { items: [], total: 0 };
    } catch (e) {
      return { items: [], total: 0 };
    }
  }

  /** 勾选/取消勾选图层 checkbox（沿用快捷区模式：改 checked + dispatch change） */
  function _setLayerChecked(cbId, on) {
    var cb = document.getElementById(cbId);
    if (!cb) return false;
    if (!!cb.checked !== !!on) {
      cb.checked = !!on;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }

  /** 定位原语（geojsonloader 未就绪时静默失败，返回是否可用） */
  function _highlight(cbId, feat) {
    if (typeof global.__OGV_highlight !== "function") return false;
    global.__OGV_highlight(cbId, feat);
    // 单个要素也可能横跨大半个地球（板块面）→ 定位完再纠一刀世界副本
    _clampWorldSpanSoon();
    return true;
  }

  /** 递归收集 geometry 坐标 → L.latLngBounds（数据只一份、坐标恒在 -180~180）
   *  ⚠️ 纬度压到 ±85：极冠环有 lat=±90 的顶点，不压的话 fitBounds 会把
   *     南北极算进去，zoom 一路缩到「一圈半世界」。 */
  function _boundsOfCoords(coords, b) {
    if (!coords || !coords.length) return b;
    if (typeof coords[0] === "number" && coords.length >= 2) {
      var lat = Math.max(-85, Math.min(85, Number(coords[1]) || 0));
      b.extend([lat, Number(coords[0]) || 0]);
      return b;
    }
    for (var i = 0; i < coords.length; i++) _boundsOfCoords(coords[i], b);
    return b;
  }

  /** 图层整体定位：确保勾选 + 按 _featureCache 全量要素算 bbox。
   *  ⚠️ 图层是**懒加载**的（勾选后 gzip 才下载解析），刚勾上时 cache 多半还是空的，
   *     所以轮询等数据到位再 fitBounds（最长 10s，超时就只当「打开图层」成功）。
   */
  function _zoomToLayer(cbId) {
    if (!_setLayerChecked(cbId, true)) return false;
    var t0 = Date.now();
    (function poll() {
      var feats = (global._featureCache || {})[cbId] || [];
      if (feats.length && global.L && global.map) {
        var b = L.latLngBounds([]);
        for (var i = 0; i < feats.length; i++) {
          var g = feats[i] && feats[i].geometry;
          if (g) _boundsOfCoords(g.coordinates, b);
        }
        if (b.isValid()) _fitBoundsSafe(b, { padding: [50, 50], maxZoom: 10 });
        return;
      }
      if (Date.now() - t0 < 10000) setTimeout(poll, 500);
    })();
    return true;
  }

  /**
   * fitBounds + 「视野不超过一圈世界」修正。
   *
   * 为什么必须修：图层级 bbox 往往就是全球尺度（板块 / 洋壳 / 地震带…），
   * fitBounds 会一路缩到「世界宽远小于屏幕」→ 屏幕上并排铺 2~3 个世界副本；
   * 出图严格照抄屏幕视野，于是论文图里印着两个地球、标签也跟着重复。
   * 处理：fitBounds 后量横向跨度，超过 360° 就把 zoom 补回去，让一圈世界刚好铺满。
   *
   * ⚠️ **必须 `animate: false`**：`fitBounds` 默认带缩放动画，动画期间
   *   `map.getBounds()` 返回的还是**中间态**（跨度往往刚好 < 360°）→ 护栏判定
   *   「没超一圈」直接跳过，等动画结束已经晚了。实测症状：定位「全球16大板块」
   *   后停在 zoom 1.61 / 跨度 653°，手动 setZoom 却能修好。
   */
  function _fitBoundsSafe(b, opts) {
    var m = global.map;
    if (!m || !b || !b.isValid()) return;
    var o = L.Util.extend({ padding: [50, 50], maxZoom: 10 }, opts || {});
    o.animate = false; // 瞬时到位，量到的就是最终视野
    m.fitBounds(b, o);
    if (!_clampWorldSpan(m)) _clampWorldSpanSoon();
  }

  function _clampWorldSpan(m) {
    m = m || global.map;
    if (!m) return false;
    var bd = m.getBounds();
    var span = bd.getEast() - bd.getWest();
    if (!(span > 360)) return false;
    var z = Math.min(m.getMaxZoom(), m.getZoom() + Math.log2(span / 360));
    if (!(z > m.getZoom() + 1e-3)) return false;
    m.setZoom(z, { animate: false });
    return true;
  }

  /** 第三方定位（`__OGV_highlight` 内部自己 fitBounds）之后再纠一刀。
   *  ⚠️ 不能只用一个固定延时：图层是懒加载的，`_featureCache` 可能 **10s 后**才到位，
   *     480ms 的定时器早就跑完了。改为「等 moveend 再量 + 到点兜底量一次」。 */
  function _clampWorldSpanSoon(ms) {
    var m = global.map;
    if (!m) return;
    var tick = function () {
      _clampWorldSpan(m);
    };
    m.once("moveend", tick); // 动画/定位真正结束（含懒加载后的那次 fitBounds）
    setTimeout(tick, ms || 6000); // 兜底：没有 moveend 也能收尾
  }

  /** 地名注册表（geo-config ④段，深链同款）：命中即中心/范围直达，无需搜索 */
  function _placeHit(q) {
    var reg = global.PLACE_REGISTRY || [];
    var ql = String(q || "").trim().toLowerCase();
    if (!ql) return null;
    var i, j, p;
    for (i = 0; i < reg.length; i++) {
      p = reg[i];
      if (p.name && p.name.toLowerCase() === ql) return p;
      var al = p.aliases || [];
      for (j = 0; j < al.length; j++) {
        if (String(al[j]).toLowerCase() === ql) return p;
      }
    }
    for (i = 0; i < reg.length; i++) {
      p = reg[i];
      if (p.name && p.name.toLowerCase().indexOf(ql) >= 0) return p;
    }
    return null;
  }
  function _zoomToPlace(p) {
    if (!global.map) return false;
    // 一律瞬时定位 + 世界副本护栏（地名 zoom 也可能小到铺满多个世界）
    if (p.center) {
      global.map.setView(p.center, p.zoom || 6, { animate: false });
      _clampWorldSpan();
    } else if (p.bbox) {
      _fitBoundsSafe(p.bbox, { padding: [30, 30] });
    }
    return true;
  }

  /**
   * 定位到指定名称的要素/图层。返回定位到的显示名，找不到返回 null。
   * 优先精确匹配 feature，其次 layer，最后退回第一个 feature 命中。
   */
  function _zoomToName(name) {
    var q = String(name || "").trim();
    if (!q) return null;
    // ⓪ 地名注册表直达（南海/东海这类 curated 地名不用走搜索）
    var p = _placeHit(q);
    if (p) {
      _zoomToPlace(p);
      return p.name;
    }
    var res = _search(q);
    _lastSearch = res;
    var items = res.items || [];
    if (!items.length) return null;
    var ql = q.toLowerCase();
    var i, it;

    // ① 精确要素名
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (it.type === "feature" && (it.summary || "").toLowerCase() === ql) {
        _setLayerChecked(it.checkboxId, true);
        _highlight(it.checkboxId, it.feature);
        return it.summary;
      }
    }
    // ② 精确图层名
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (
        it.type === "layer" &&
        ((it.summary || "").toLowerCase() === ql || (it.label || "").toLowerCase() === ql)
      ) {
        _zoomToLayer(it.checkboxId);
        return it.summary || it.label;
      }
    }
    // ③ 退回第一个命中（feature 优先）
    var first =
      items.filter(function (x) { return x.type === "feature"; })[0] || items[0];
    if (first.type === "feature") {
      _setLayerChecked(first.checkboxId, true);
      _highlight(first.checkboxId, first.feature);
      return first.summary;
    }
    _zoomToLayer(first.checkboxId);
    return first.summary || first.label;
  }

  /** 图层名 → checkboxId（toggle_layer 用） */
  function _findLayerItem(name) {
    var res = _search(name);
    var items = res.items || [];
    var ql = String(name || "").toLowerCase();
    var layers = items.filter(function (x) { return x.type === "layer"; });
    if (!layers.length) return null;
    for (var i = 0; i < layers.length; i++) {
      var it = layers[i];
      if ((it.summary || "").toLowerCase() === ql || (it.label || "").toLowerCase() === ql)
        return it;
    }
    return layers[0];
  }

  // ─────────────────────────────────────────────
  //  图层清单 / 底图（读面板 DOM，不猜）
  // ─────────────────────────────────────────────
  var ICON_NOISE = /[⚙️🔍📋]/g;
  /**
   * 去掉标签前的图标（🏷 显示标签 → 显示标签）。
   * 为什么要单独写：ICON_NOISE 只覆盖三个图标，设置项里的 🧩🌐🧊▦✛🖱️➕📏📐💾📍⛰️🌙🕹️🔗
   * 都漏网 —— 模型拿到的名字带 emoji，再按名字回填 set_option 就容易对不上。
   * 用 Unicode 属性类一次清掉「开头所有非字母数字」的符号。
   */
  function _cleanLabel(s) {
    var t = String(s || "").replace(ICON_NOISE, "");
    try {
      t = t.replace(/^[^\p{L}\p{N}]+/u, "");
    } catch (e) {
      t = t.replace(/^[^\w\u4e00-\u9fa5]+/, "");
    }
    return t.replace(/\s+/g, " ").trim();
  }

  /** 面板里所有图层 checkbox（含小分组内的） */
  function _layerItems() {
    var out = [];
    var seen = {};
    document.querySelectorAll('input[type="checkbox"][id^="layer_"]').forEach(function (cb) {
      if (seen[cb.id]) return;
      seen[cb.id] = 1;
      var lab = cb.closest("label") || cb.parentElement;
      var name = lab ? String(lab.textContent || "") : "";
      name = name.replace(ICON_NOISE, "").replace(/\s+/g, " ").trim();
      // 组路径：逐级向外找 <details> 的 summary（小分组可无限嵌套）
      var path = [];
      var node = cb.closest("details");
      while (node) {
        var sm = node.querySelector("summary");
        if (sm) {
          var t = String(sm.textContent || "").replace(ICON_NOISE, "").replace(/\s+/g, " ").trim();
          if (t) path.unshift(t.slice(0, 24));
        }
        node = node.parentElement ? node.parentElement.closest("details") : null;
      }
      out.push({ id: cb.id, name: name, group: path.join(" › "), on: !!cb.checked });
    });
    return out;
  }

  function _listLayers(args) {
    var all = _layerItems();
    var q = String(args.filter || "").trim().toLowerCase();
    var onlyOn = !!args.onlyOn;
    var limit = Math.min(200, Math.max(5, Number(args.limit) || 40));
    var hit = all.filter(function (it) {
      if (onlyOn && !it.on) return false;
      if (!q) return true;
      return (it.name + " " + it.group).toLowerCase().indexOf(q) >= 0;
    });
    return {
      total: all.length,
      onCount: all.filter(function (x) { return x.on; }).length,
      matched: hit.length,
      shown: hit.slice(0, limit).map(function (it) {
        return { name: it.name, group: it.group, on: it.on };
      }),
      truncated: hit.length > limit,
    };
  }

  /** 底图控件里的项（L.control.layers 的 radio） */
  function _basemapItems() {
    var out = [];
    document
      .querySelectorAll(".leaflet-control-layers-base label")
      .forEach(function (lab) {
        var input = lab.querySelector('input[type="radio"]');
        var span = lab.querySelector("span");
        var name = String((span || lab).textContent || "").trim();
        if (!name || !input) return;
        out.push({ name: name, checked: !!input.checked, input: input });
      });
    return out;
  }

  // ─────────────────────────────────────────────
  //  站点设置项（「地图设置」里的开关）
  // ─────────────────────────────────────────────
  /**
   * 读 #toggleBody 里的开关。
   * ⚠️ 这些开关的主控件只有一份（app.js 渲染到 #toggleBody，带 id），
   *    快捷区只是 <button data-quick-for>，**没有**第二个 checkbox —— 所以
   *    这里只扫 #toggleBody，不会读到重复项。
   */
  /**
   * 取设置项的名字：剔除状态徽标。
   * 「安装到桌面」这类项会把「已安装 / 未安装」渲染进同一个 .cluster-toggle-text 里，
   * 直接读 textContent 会让模型看到「安装到桌面未安装」，回头 set_option 就对不上。
   */
  function _labelText(el) {
    if (!el) return "";
    var c = el.cloneNode(true);
    var tags = c.querySelectorAll ? c.querySelectorAll(".toggle-state") : [];
    for (var i = 0; i < tags.length; i++) {
      if (tags[i].parentNode) tags[i].parentNode.removeChild(tags[i]);
    }
    return c.textContent || "";
  }

  function _optionItems() {
    var out = [];
    document
      .querySelectorAll('#toggleBody input[type="checkbox"][id]')
      .forEach(function (cb) {
        var bar = cb.closest(".toggle-bar");
        var txt = bar ? bar.querySelector(".cluster-toggle-text") : null;
        var name = _cleanLabel(_labelText(txt));
        if (!name) name = cb.id;
        var grp = cb.closest("details.toggle-sub");
        var gname = grp ? String(grp.querySelector(".toggle-sub-name") ? grp.querySelector(".toggle-sub-name").textContent : "").trim() : "";
        out.push({
          id: cb.id,
          name: name,
          group: gname,
          on: !!cb.checked,
          desc: bar ? String(bar.getAttribute("title") || "") : "",
        });
      });
    return out;
  }

  function _listOptions(args) {
    var all = _optionItems();
    var q = String(args.filter || "").trim().toLowerCase();
    var onlyOn = !!args.onlyOn;
    var hit = all.filter(function (it) {
      if (onlyOn && !it.on) return false;
      if (!q) return true;
      return (it.name + " " + it.id + " " + it.group).toLowerCase().indexOf(q) >= 0;
    });
    return {
      total: all.length,
      onCount: all.filter(function (x) { return x.on; }).length,
      matched: hit.length,
      options: hit.map(function (it) {
        return { name: it.name, group: it.group, on: it.on };
      }),
    };
  }

  /** 名字 → 开关项（精确名 → 精确 id → 包含） */
  function _findOption(name) {
    var q = String(name || "").trim().toLowerCase();
    if (!q) return null;
    var all = _optionItems();
    var i;
    for (i = 0; i < all.length; i++) if (all[i].name.toLowerCase() === q) return all[i];
    for (i = 0; i < all.length; i++) if (all[i].id.toLowerCase() === q) return all[i];
    var hit = all.filter(function (it) {
      return (it.name + " " + it.id).toLowerCase().indexOf(q) >= 0;
    });
    return hit.length === 1 ? hit[0] : null; // 模糊多义时不要瞎猜
  }

  function _setOption(name, on) {
    var it = _findOption(name);
    if (!it) {
      return {
        ok: false,
        error: "没有这个设置项：「" + name + "」",
        available: _optionItems().map(function (x) { return x.name; }),
      };
    }
    var cb = document.getElementById(it.id);
    if (!cb) return { ok: false, error: "设置项控件不在了：" + it.id };
    var before = !!cb.checked;
    if (before !== !!on) {
      cb.checked = !!on;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return {
      ok: true,
      option: it.name,
      from: before,
      to: !!cb.checked,
      // 有些开关会被副作用改回去（未激活的高级功能、模块未加载的 3D、
      // 以及「安装到桌面」这种状态由浏览器决定、关不掉的项）
      note: !!cb.checked === !!on ? undefined : "被系统改回原状态（可能缺少模块、未激活，或该状态由浏览器决定）",
    };
  }

  // ─────────────────────────────────────────────
  //  地名：定位 / 检索 / 逆编码
  // ─────────────────────────────────────────────
  function _geo() {
    return global.OGVGeo || null;
  }
  /** 联网搜索模块（ogv-websearch.js）；没加载 / 没 Key 时返回 null，调用方退化为只用本地 */
  function _web() {
    var W = global.OGVWeb || null;
    return W && W.ready() ? W : null;
  }
  /**
   * 联网搜索 → 给模型/用户的精简结构。
   * 只带 summary（600~800 字，给模型读得动），不默认带 content（全文会撑爆上下文）。
   */
  function _webSearchTool(args) {
    var W = _web();
    if (!W) return { ok: false, error: "联网搜索不可用（模块未加载或没有 API Key）" };
    var q = String(args.query || "").trim();
    if (!q) return { ok: false, error: "query 不能为空" };
    return W.search(q, {
      count: Number(args.count) || 6,
      oriQuestion: args.oriQuestion,
    }).then(function (r) {
      if (!r.ok) return { ok: false, error: r.error };
      var items = (r.items || []).map(function (x) {
        return {
          title: x.title,
          url: x.url,
          summary: x.summary || x.snippet,
          site: x.site,
          date: x.date,
          // 0~4，≥3 为极权威；≥1.5 分算优质（官方口径）—— 让模型自己决定信谁
          authority: x.authority,
          score: x.score,
        };
      });
      var out = { ok: true, source: "网页搜索", query: q, count: items.length, items: items };
      if (!items.length) {
        out.hint =
          "网上也没搜到。可以换更宽的关键词、去掉限定词重搜一次；" +
          "如果用户问的其实是地点，回到 locate / geocode。";
      }
      return out;
    });
  }

  function _webFetchTool(args) {
    var W = _web();
    if (!W) return { ok: false, error: "联网抓取不可用（模块未加载或没有 API Key）" };
    return W.fetchPage(args.url).then(function (r) {
      if (!r.ok) return { ok: false, error: r.error };
      var c = String(r.content || "");
      // 正文可能几万字 → 截断，避免一次工具结果就吃掉整个上下文窗口
      var clipped = c.length > 12000;
      return {
        ok: true,
        title: r.title,
        url: args.url,
        chars: c.length,
        clipped: clipped,
        content: clipped ? c.slice(0, 12000) + "\n\n…（正文过长，已截断）" : c,
      };
    });
  }

  /** 直接飞到坐标（瞬时 + 世界副本护栏），返回实际 zoom */
  function _flyTo(lat, lng, zoom) {
    var m = global.map;
    if (!m) return null;
    var la = Math.max(-85, Math.min(85, Number(lat)));
    var ln = Number(lng);
    if (!isFinite(la) || !isFinite(ln)) return null;
    var z = Number(zoom);
    if (!isFinite(z) || z <= 0) z = Math.max(m.getZoom(), 5);
    z = Math.max(0, Math.min(m.getMaxZoom(), z));
    m.setView([la, ln], z, { animate: false });
    _clampWorldSpan(m);
    return +m.getZoom().toFixed(2);
  }

  /** 当前视野（外扩一点）作为地名检索的优先范围；
   *  ⚠️ 必须钳到 [-180,-90,180,90]：地图在世界副本态下 getBounds() 可能给出
   *     west=-190 / east=380 这种值，天地图收到越界 mapBound 直接 400 → 一条结果都没有。
   */
  function _searchBound(padX, padY) {
    var m = global.map;
    if (!m) return null;
    try {
      var bd = m.getBounds();
      var w = Math.max(-180, bd.getWest() - (padX == null ? 20 : padX));
      var s = Math.max(-90, bd.getSouth() - (padY == null ? 15 : padY));
      var e = Math.min(180, bd.getEast() + (padX == null ? 20 : padX));
      var n = Math.min(90, bd.getNorth() + (padY == null ? 15 : padY));
      if (!(e > w) || !(n > s)) return null;
      return [w, s, e, n];
    } catch (err) {
      return null;
    }
  }

  /**
   * 第四级：联网搜索兜底。
   * ⚠️ 它**不产生坐标** —— 所以调用方拿到的永远是 ok:false，只是多了一个 `web` 字段。
   *    为什么要这么设计：如果让它返回 ok:true，模型很容易顺手说「已定位到 X」，
   *    可地图根本没动。宁可让模型明确讲「图上没有，但资料这么写」。
   */
  function _locateWebFallback(q) {
    // 联网开关关着 → 这一级直接不存在（连请求都不发，一分钱不花）
    if (!_opt.web) return Promise.resolve(null);
    var W = _web();
    if (!W) return Promise.resolve(null);
    return W.search(q, { count: 5 }).then(function (r) {
      if (!r || !r.ok || !r.items || !r.items.length) return null;
      return r.items.slice(0, 5).map(function (x) {
        return {
          title: x.title,
          url: x.url,
          summary: x.summary || x.snippet,
          site: x.site,
          date: x.date,
        };
      });
    }).catch(function () {
      return null;
    });
  }

  /**
   * 综合定位：站点矢量 → 内置地名表 → 天地图 → 联网搜索（资料，无坐标）。
   * 为什么是这个顺序：矢量是**本平台的领域数据**（板块/洋中脊/站位），
   * 命中它才能高亮+弹属性；地名表是 curated 的常用海区（快、无需网络）；
   * 天地图是兜底（覆盖一切行政区/POI，但只能定位、没有我们的属性）；
   * 联网搜索只在前三级全空时出现，用来回答「这是什么东西」而不是「它在哪」。
   * @returns Promise<{ok, by:"vector"|"place"|"tianditu"|"none", name, lat, lng, zoom, web?, hint?, candidates?}>
   */
  function _locate(query, zoom) {
    var q = String(query || "").trim();
    if (!q) return Promise.resolve({ ok: false, error: "query 不能为空" });

    // ① 站点矢量（图层/要素）
    var res = _search(q);
    _lastSearch = res;
    var items = res.items || [];
    var ql = q.toLowerCase();
    var i, it;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (it.type === "feature" && (it.summary || "").toLowerCase() === ql) {
        _setLayerChecked(it.checkboxId, true);
        _highlight(it.checkboxId, it.feature);
        return Promise.resolve({
          ok: true, by: "vector", kind: "feature", name: it.summary, layer: it.label,
        });
      }
    }
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (it.type === "layer" && ((it.summary || "").toLowerCase() === ql || (it.label || "").toLowerCase() === ql)) {
        _zoomToLayer(it.checkboxId);
        return Promise.resolve({
          ok: true, by: "vector", kind: "layer", name: it.summary || it.label,
        });
      }
    }
    var firstFeat = items.filter(function (x) { return x.type === "feature"; })[0];
    if (firstFeat) {
      _setLayerChecked(firstFeat.checkboxId, true);
      _highlight(firstFeat.checkboxId, firstFeat.feature);
      return Promise.resolve({
        ok: true, by: "vector", kind: "feature", name: firstFeat.summary, layer: firstFeat.label,
        note: "精确名没命中，这是最接近的要素",
      });
    }

    // ② 内置地名表（南海/东海这类 curated 海区）
    var p = _placeHit(q);
    if (p) {
      _zoomToPlace(p);
      var m0 = global.map;
      return Promise.resolve({
        ok: true, by: "place", name: p.name,
        lat: p.center ? p.center[0] : null,
        lng: p.center ? p.center[1] : null,
        zoom: m0 ? +m0.getZoom().toFixed(2) : null,
      });
    }

    // ③ 天地图地名服务
    var G = _geo();
    if (!G || !G.ready || !G.ready()) {
      return _locateWebFallback(q).then(function (web) {
        var out = {
          ok: false,
          by: "none",
          error: "站点矢量和内置地名表里都没有，且天地图地名服务未配置",
        };
        if (web) {
          out.web = web;
          out.hint = "图上定位不到；以下是联网搜到的资料，只能用来回答，不能当坐标用。";
        }
        return out;
      });
    }
    // 当前视野稍微放宽，优先返回用户在看的这一带（全球同名地名很多）
    var bound = _searchBound(30, 20);
    return G.search(q, { count: 10, bound: bound }).then(function (r) {
      if (!r || !r.items || !r.items.length) {
        // ④ 前三级全空 → 联网（无坐标，只有资料）
        return _locateWebFallback(q).then(function (web) {
          var out = {
            ok: false,
            by: "none",
            error: "站点矢量、内置地名表、天地图都没有「" + q + "」",
          };
          if (web) {
            out.web = web;
            out.hint =
              "**图上没有这个名字**（不许说已定位）。但联网搜到了资料 —— " +
              "先明确告诉用户「没能在图上定位到」，再用这些资料回答，并在结论后给链接。";
          }
          return out;
        });
      }
      var top = r.items[0];
      var z = _flyTo(top.lat, top.lng, Number(zoom) || (r.items.length === 1 ? 9 : 7));
      return {
        ok: true,
        by: "tianditu",
        name: top.name,
        lat: +top.lat.toFixed(4),
        lng: +top.lng.toFixed(4),
        zoom: z,
        address: top.address || "",
        candidates: r.items.slice(0, 6).map(function (x) {
          return { name: x.name, lat: +x.lat.toFixed(4), lng: +x.lng.toFixed(4), address: x.address };
        }),
      };
    });
  }

  function _geocodeTool(args) {
    var G = _geo();
    if (!G) return { ok: false, error: "地名模块未加载" };
    if (!G.ready()) return { ok: false, error: "天地图地名服务未配置 token" };
    var bound = _searchBound(20, 15);
    return G.search(args.query, { count: Number(args.count) || 8, bound: bound }).then(function (r) {
      return {
        ok: !!r.ok,
        source: "天地图",
        count: (r.items || []).length,
        items: (r.items || []).map(function (x) {
          return { name: x.name, lat: +x.lat.toFixed(4), lng: +x.lng.toFixed(4), address: x.address };
        }),
        error: r.error,
      };
    });
  }

  function _reverseTool(args) {
    var G = _geo();
    if (!G) return { ok: false, error: "地名模块未加载" };
    if (!G.ready()) return { ok: false, error: "天地图地名服务未配置 token" };
    var m = global.map;
    var lat = args.lat != null ? Number(args.lat) : m ? m.getCenter().lat : NaN;
    var lng = args.lng != null ? Number(args.lng) : m ? m.getCenter().lng : NaN;
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: "坐标不合法" };
    return G.reverse(lat, lng).then(function (r) {
      r.at = { lat: +lat.toFixed(4), lng: +lng.toFixed(4) };
      return r;
    });
  }

  /** 出图预览：渲染缩略图直接贴进对话（不下载），返回给模型的只有结论 */
  function _previewExport(args) {
    var ME = global.MapExport;
    var m = global.map;
    if (!ME || typeof ME.render !== "function" || !m) {
      return { ok: false, error: "出图模块未就绪" };
    }
    // 与「正式出图」同一套参数合并（preset → 纸面字段、叠加用户已在面板里调好的设置），
    // 否则模型说「A4 横版」只会落个 preset 字符串，纸面还是默认 170mm → 预览≠成品。
    var opts;
    if (typeof ME.resolveOpts === "function") {
      try {
        opts = ME.resolveOpts(args || {});
      } catch (e) {
        opts = null;
      }
    }
    if (!opts) {
      opts = {};
      [
        "preset", "paperWidthMm", "paperHeightMm", "dpi", "title", "subtitle",
        "graticule", "legend", "legendTitle", "scaleBar", "northArrow", "labels",
        "attribution", "includeBase", "includeOverlays", "baseOpacity",
        "vectorOpacity", "background",
      ].forEach(function (k) {
        if (args[k] !== undefined) opts[k] = args[k];
      });
    }
    // 缩略图：宽固定 760，高度按纸面（或屏幕）比例
    var size = m.getSize();
    var W = 760;
    var pw = Number(opts.paperWidthMm) || 170;
    var ph = Number(opts.paperHeightMm) || 0;
    var aspect = ph > 0 ? ph / pw : (size.y || 3) / (size.x || 4);
    var H = Math.max(120, Math.round(W * aspect));
    opts.width = W;
    opts.height = H;
    var msg = _pushMsg("assistant", "🖼️ 正在渲染预览…");
    return ME.render(opts)
      .then(function (res) {
        var url = "";
        try {
          url = res.canvas.toDataURL("image/jpeg", 0.72);
        } catch (e) {}
        var r = res.report || {};
        var warn = (r.warnings || []).filter(Boolean);
        var span = r.frame ? Math.round(r.frame.east - r.frame.west) : 0;
        msg.text =
          "🖼️ 预览 · 覆盖约 " + span + "° 经度" +
          (warn.length ? "\n⚠️ " + warn.join("；") : "") +
          "\n确认构图没问题就说「下载」，我再出正式图。";
        msg.img = url;
        _renderMessages();
        return {
          ok: true,
          shown: true,
          frame: r.frame,
          warnings: warn,
          note: "缩略图已显示给用户；用户确认后再调 export_image 下载正式图",
        };
      })
      .catch(function (e) {
        msg.text = "❌ 预览失败：" + (e && e.message ? e.message : e);
        _renderMessages();
        return { ok: false, error: String((e && e.message) || e) };
      });
  }

  // ─────────────────────────────────────────────
  //  工具调用执行
  // ─────────────────────────────────────────────
  function _execTool(name, args) {
    args = args || {};
    if (name === "search_features") {
      var res = _search(args.query);
      _lastSearch = res;
      var items = (res.items || []).slice(0, 10).map(function (it) {
        return {
          type: it.type,
          name: it.type === "feature" ? it.summary : it.summary || it.label,
          group: it.label || "",
        };
      });
      var out = { total: res.total || 0, shown: items.length, items: items };
      // ⚠️ 要素索引随图层**懒加载**构建：搜不到不代表没有，可能只是所在图层还没打开过。
      //    给模型一条可执行的下一步，而不是让它直接回答「不存在」。
      if (!out.total) {
        out.hint =
          "站点矢量里没有。直接调 locate（会自动兜底天地图地名服务）；" +
          "若目标可能是某个还没打开的图层里的要素，也可以先 toggle_layer 再 search_features。";
      }
      return out;
    }
    if (name === "locate") {
      return _locate(args.query, args.zoom);
    }
    if (name === "geocode") {
      return _geocodeTool(args);
    }
    if (name === "reverse_geocode") {
      return _reverseTool(args);
    }
    if (name === "web_search") {
      if (!_opt.web) {
        return {
          ok: false,
          error:
            "联网搜索当前是关闭的。如果确实需要网上资料，告诉用户「点输入框下方的『联网搜索』打开后再问」；" +
            "能用本地数据（locate / geocode / search_features）回答的就先用本地的。",
        };
      }
      return _webSearchTool(args);
    }
    if (name === "web_fetch") {
      if (!_opt.web) return { ok: false, error: "联网搜索当前是关闭的（web_fetch 属于联网能力）" };
      return _webFetchTool(args);
    }
    if (name === "list_options") {
      return _listOptions(args);
    }
    if (name === "set_option") {
      return _setOption(args.name, !!args.on);
    }
    if (name === "zoom_map") {
      var mz = global.map;
      if (!mz) return { ok: false, error: "地图未就绪" };
      var dir = args.direction === "out" ? -1 : 1;
      var steps = Math.max(1, Math.min(4, Number(args.steps) || 1));
      var zt = Math.max(0, Math.min(mz.getMaxZoom(), mz.getZoom() + dir * steps));
      mz.setZoom(zt, { animate: false });
      _clampWorldSpan(mz);
      return { ok: true, zoom: +mz.getZoom().toFixed(2), direction: dir > 0 ? "in" : "out" };
    }
    if (name === "zoom_to_feature") {
      var hit = _zoomToName(args.name);
      return hit
        ? { ok: true, located: hit }
        : { ok: false, error: "没有找到「" + args.name + "」" };
    }
    if (name === "toggle_layer") {
      var it2 = _findLayerItem(args.name);
      if (!it2) return { ok: false, error: "没有找到图层「" + args.name + "」" };
      _setLayerChecked(it2.checkboxId, !!args.visible);
      return { ok: true, layer: it2.summary || it2.label, visible: !!args.visible };
    }
    if (name === "list_layers") {
      return _listLayers(args);
    }
    if (name === "set_view") {
      var m0 = global.map;
      if (!m0) return { ok: false, error: "地图未就绪" };
      // ① 地名注册表（南海/东海这类 curated 地名）
      if (args.place) {
        var p = _placeHit(args.place);
        if (p) {
          _zoomToPlace(p);
          return { ok: true, by: "place", place: p.name, zoom: +m0.getZoom().toFixed(1) };
        }
      }
      // ② 图层名
      if (args.layer) {
        var lit = _findLayerItem(args.layer);
        if (lit) {
          _zoomToLayer(lit.checkboxId);
          return { ok: true, by: "layer", layer: lit.summary || lit.label };
        }
      }
      // ③ 经纬度 + zoom
      var lat0 = Number(args.lat), lng0 = Number(args.lng);
      if (!isFinite(lat0) || !isFinite(lng0))
        return {
          ok: false,
          error: "要么给 place/layer，要么给 lat+lng（可带 zoom）",
        };
      var z0 = Number(args.zoom);
      if (!isFinite(z0) || z0 <= 0) z0 = m0.getZoom();
      z0 = Math.max(0, Math.min(m0.getMaxZoom(), z0));
      m0.setView([Math.max(-85, Math.min(85, lat0)), lng0], z0, { animate: false });
      _clampWorldSpan(m0);
      return { ok: true, by: "latlng", lat: lat0, lng: lng0, zoom: +m0.getZoom().toFixed(2) };
    }
    if (name === "set_basemap") {
      var items = _basemapItems();
      if (!items.length) return { ok: false, error: "底图控件未就绪" };
      var q = String(args.name || "").trim().toLowerCase();
      var picked =
        items.filter(function (x) { return x.name.toLowerCase() === q; })[0] ||
        items.filter(function (x) { return x.name.toLowerCase().indexOf(q) >= 0; })[0];
      if (!picked) {
        return {
          ok: false,
          error: "没有这张底图",
          available: items.slice(0, 20).map(function (x) { return x.name; }),
        };
      }
      if (!picked.checked) picked.input.click(); // 走 Leaflet 自己的 baselayerchange 链路（会落盘）
      return { ok: true, basemap: picked.name };
    }
    if (name === "preview_export") {
      return _previewExport(args);
    }
    if (name === "open_export") {
      var ME = global.MapExport;
      if (!ME || typeof ME.applyOptions !== "function")
        return { ok: false, error: "出图模块未就绪" };
      var opts = {};
      [
        "preset", "paperWidthMm", "dpi", "title", "subtitle",
        "graticule", "legend", "scaleBar", "northArrow", "labels",
      ].forEach(function (k) {
        if (args[k] !== undefined) opts[k] = args[k];
      });
      opts.open = true;
      ME.applyOptions(opts);
      return { ok: true, applied: opts };
    }
    if (name === "export_image") {
      var ME2 = global.MapExport;
      if (!ME2 || typeof ME2.exportNow !== "function")
        return { ok: false, error: "出图模块未就绪" };
      var eopts = {};
      [
        "preset", "paperWidthMm", "paperHeightMm", "dpi", "title", "subtitle",
        "graticule", "legend", "legendTitle", "scaleBar", "northArrow", "labels",
        "attribution", "includeBase", "includeOverlays", "format", "filename",
      ].forEach(function (k) {
        if (args[k] !== undefined) eopts[k] = args[k];
      });
      // 等渲染完成再回工具结果：模型才能拿到 frame/warnings，
      // 把「这张图盖了哪些经纬度、有没有世界副本/缺底图」讲清楚，而不是只说「已开始」。
      var msg = _pushMsg("assistant", "🖼️ 正在渲染出图…");
      return ME2.exportNow(eopts, {
        onProgress: function (p) {
          msg.text = "🖼️ 正在渲染出图… " + Math.round(p * 100) + "%";
          _renderMessages();
        },
      })
        .then(function (info) {
          var r = info.report || {};
          var bits = [Math.round(info.size / 1024) + " KB"];
          if (r.width) bits.unshift(r.width + "×" + r.height + " px");
          var warn = (r.warnings || []).filter(Boolean);
          msg.text =
            "✅ 已下载 **" + info.name + "**（" + bits.join(" · ") + "）" +
            (warn.length ? "\n⚠️ " + warn.join("；") : "");
          _saveSessions();
          _renderMessages();
          return {
            ok: true,
            file: info.name,
            width: r.width,
            height: r.height,
            frame: r.frame,
            zoom: r.zoom,
            warnings: warn,
          };
        })
        .catch(function (e) {
          msg.text = "❌ 出图失败：" + (e && e.message ? e.message : e);
          _saveSessions();
          _renderMessages();
          return { ok: false, error: String((e && e.message) || e) };
        });
    }
    if (name === "get_map_state") {
      var m = global.map;
      if (!m) return { ok: false, error: "地图未就绪" };
      var c = m.getCenter();
      var lng = c.lng;
      if (global.L && L.WorldWrap) lng = L.WorldWrap.normalizeLng(lng);
      // 视野跨度：出图会不会重复世界副本，靠它判断（>180° 就该先 set_view 收一收）
      var bd = null;
      try {
        bd = m.getBounds();
      } catch (e) {}
      var span = bd ? bd.getEast() - bd.getWest() : null;
      var bmNow = _basemapItems().filter(function (x) { return x.checked; })[0];
      return {
        ok: true,
        lat: +c.lat.toFixed(4),
        lng: +lng.toFixed(4),
        zoom: +m.getZoom().toFixed(1),
        spanLngDeg: span == null ? null : Math.round(span),
        worldCopies: span != null && span > 360,
        bbox: bd ? {
          west: +bd.getWest().toFixed(3),
          south: +bd.getSouth().toFixed(3),
          east: +bd.getEast().toFixed(3),
          north: +bd.getNorth().toFixed(3),
        } : null,
        basemap: bmNow ? bmNow.name : null,
        layersOn: _layerItems().filter(function (x) { return x.on; }).length,
        optionsOn: _optionItems().filter(function (x) { return x.on; }).length,
      };
    }
    return { ok: false, error: "未知工具 " + name };
  }

  // ─────────────────────────────────────────────
  //  模型请求（tool-calling 循环，非流式）
  // ─────────────────────────────────────────────
  function _apiRequest(messages, opt) {
    var key = _key();
    if (!key) return Promise.reject(new Error("未配置 API Key"));
    opt = opt || {};
    _abort = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (_abort) _abort.abort();
    }, REQ_TIMEOUT);
    var payload = {
      model: MODEL,
      messages: messages,
      max_tokens: 2048,
      stream: false,
      // V4 默认开思考，这里按运行开关显式声明（见文件头注释第②条）。
      // 开着时官方要求每轮回传 reasoning_content —— _askModel 里 messages.push(msg)
      // 是整条 assistant 消息入栈，含 reasoning_content，所以链路是通的。
      thinking: { type: _opt.think ? "enabled" : "disabled" },
    };
    // noTools：触到轮数上限后的「收尾总结」用它 —— 只让模型把已经做完的事说清楚，
    // 不能再调工具，否则它会继续无限拆步骤。
    if (!opt.noTools) {
      payload.tools = _toolsFor();
      if (opt.toolChoice) payload.tool_choice = opt.toolChoice;
    }
    return fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify(payload),
      signal: _abort ? _abort.signal : undefined,
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var em = (j && j.error && j.error.message) || "HTTP " + r.status;
            throw new Error(em);
          }
          return j;
        });
      })
      .finally(function () {
        clearTimeout(timer);
      });
  }

  /** 展示态 → API 消息（只带纯文本历史）
   *  @param extra 追加到最后一条用户消息后的补充说明（如「本地三级都没查到」） */
  function _historyMessages(extra) {
    var out = [{ role: "system", content: SYSTEM_PROMPT }];
    var start = Math.max(0, _msgs.length - MAX_HISTORY);
    for (var i = start; i < _msgs.length; i++) {
      var m = _msgs[i];
      if (m.role === "user" || m.role === "assistant") {
        out.push({ role: m.role, content: m.text || "" });
      }
    }
    // 把实时地图状态挂到最后一条用户消息后面（不写进历史，每次现算）：
    // 模型因此不必先花一轮 get_map_state，省时省 token，也避免它拿旧状态规划构图。
    if (out.length > 1) {
      var last = out[out.length - 1];
      if (last.role === "user") {
        var ctx = _ctxLine();
        if (ctx) last.content = last.content + "\n\n" + ctx;
        if (extra) last.content = last.content + "\n\n" + extra;
      }
    }
    return out;
  }

  /** 一行「当前地图状态」，给模型当上下文（也用于本地兜底提示） */
  function _ctxLine() {
    var m = global.map;
    if (!m) return "";
    var c = m.getCenter();
    var span = null;
    try {
      var bd = m.getBounds();
      span = Math.round(bd.getEast() - bd.getWest());
    } catch (e) {}
    var bm = _basemapItems().filter(function (x) { return x.checked; })[0];
    var on = _layerItems().filter(function (x) { return x.on; });
    var names = on.slice(0, 6).map(function (x) { return x.name; }).join(" / ");
    if (on.length > 6) names += " 等 " + on.length + " 个";
    return (
      "[当前地图] 中心 " + c.lat.toFixed(2) + "," + c.lng.toFixed(2) +
      " · zoom " + m.getZoom().toFixed(1) +
      (span != null ? " · 经度跨度 " + span + "°" + (span > 360 ? "（含世界副本，出图会重复）" : "") : "") +
      " · 底图 " + (bm ? bm.name : "无") +
      " · 已开图层 " + on.length + (names ? "：" + names : "")
    );
  }

  /**
   * tool-calling 主循环。
   * @param onStep (toolName, args) → void：把「正在做什么」显示到思考气泡里。
   * ⚠️ 工具**串行**执行（不是 forEach 同步跑完）：preview_export / export_image 是
   *    异步的，而且「先 set_view 再出图」这种顺序有意义，必须前一个完成再跑下一个。
   */
  function _askModel(onStep, hint) {
    var messages = _historyMessages(hint);
    var round = 0;

    function loop() {
      if (round++ >= MAX_TOOL_ROUNDS) {
        // 触顶时不要甩一句「已停下」把用户晾着：
        // 再要一轮**不带工具**的收尾，让模型把「已经做了什么 / 还差什么」讲清楚。
        messages.push({
          role: "user",
          content:
            "（系统提示：工具调用步数已达上限。请基于上面的工具结果，用一两句话总结" +
            "已经完成的改动和还没做完的部分，不要再调用工具。）",
        });
        return _apiRequest(messages, { noTools: true })
          .then(function (resp) {
            var m2 = resp.choices && resp.choices[0] && resp.choices[0].message;
            return (m2 && m2.content) || "（步数已达上限，先停在这里。说「继续」我再接着做）";
          })
          .catch(function () {
            return "（步数已达上限，先停在这里。说「继续」我接着做剩下的部分）";
          });
      }
      return _apiRequest(messages).then(function (resp) {
        var msg = resp.choices && resp.choices[0] && resp.choices[0].message;
        if (!msg) throw new Error("模型返回为空");
        messages.push(msg);
        if (msg.tool_calls && msg.tool_calls.length) {
          var chain = Promise.resolve();
          msg.tool_calls.forEach(function (tc) {
            chain = chain.then(function () {
              var args = {};
              try {
                args = JSON.parse(tc.function.arguments || "{}");
              } catch (e) {}
              if (typeof onStep === "function") {
                try {
                  onStep(tc.function.name, args);
                } catch (e2) {}
              }
              var out;
              try {
                out = _execTool(tc.function.name, args);
              } catch (e3) {
                out = { ok: false, error: String((e3 && e3.message) || e3) };
              }
              return Promise.resolve(out).then(function (r) {
                messages.push({
                  role: "tool",
                  tool_call_id: tc.id,
                  content: JSON.stringify(r),
                });
              });
            });
          });
          return chain.then(loop); // 结果回喂，继续
        }
        return msg.content || "（模型没有给出文字回复）";
      });
    }
    return loop();
  }

  /** 工具 → 思考气泡里的一句人话 */
  var TOOL_STEP = {
    search_features: function (a) {
      return "🔍 搜索「" + (a.query || "") + "」…";
    },
    zoom_to_feature: function (a) {
      return "🎯 定位「" + (a.name || "") + "」…";
    },
    toggle_layer: function (a) {
      return (a.visible === false ? "🚫 关闭图层「" : "📂 打开图层「") + (a.name || "") + "」…";
    },
    list_layers: function () {
      return "📋 读取图层清单…";
    },
    list_options: function () {
      return "⚙️ 读取设置项…";
    },
    set_option: function (a) {
      return (a.on === false ? "🚫 关闭「" : "✅ 打开「") + (a.name || "设置") + "」…";
    },
    locate: function (a) {
      return "📍 定位「" + (a.query || "") + "」…";
    },
    geocode: function (a) {
      return "🗺️ 天地图查地名「" + (a.query || "") + "」…";
    },
    reverse_geocode: function () {
      return "🧭 查这个坐标叫什么…";
    },
    web_search: function (a) {
      return "🌐 联网搜「" + (a.query || "") + "」…";
    },
    web_fetch: function () {
      return "📄 抓取网页正文…";
    },
    zoom_map: function (a) {
      return a.direction === "out" ? "🔍 缩小视野…" : "🔍 放大视野…";
    },
    set_view: function (a) {
      return a.place || a.layer ? "🗺️ 调整视野到「" + (a.place || a.layer) + "」…" : "🗺️ 调整视野…";
    },
    set_basemap: function (a) {
      return "🧭 切换到「" + (a.name || "") + "」底图…";
    },
    preview_export: function () {
      return "🖼️ 渲染预览（不下载）…";
    },
    export_image: function () {
      return "🖼️ 渲染并下载图片…";
    },
    open_export: function () {
      return "🛠️ 打开出图面板…";
    },
    get_map_state: function () {
      return "📍 读取当前视野…";
    },
  };

  // ─────────────────────────────────────────────
  //  DOM
  // ─────────────────────────────────────────────
  function _ensure() {
    if (_root) return;
    _root = _el("div", "ogv-ai-root");
    _root.setAttribute("role", "dialog");
    _root.setAttribute("aria-label", "AI 助手");

    var head = _el("header", "ogv-ai-head");
    var btnHist = _el("button", "ogv-ai-hbtn ogv-ai-hbtn-hist", "☰");
    btnHist.type = "button";
    btnHist.title = "历史对话";
    btnHist.setAttribute("aria-label", "历史对话");
    head.appendChild(btnHist);
    head.appendChild(_el("span", "ogv-ai-title", "AI 助手"));
    // 「测试中」徽标：功能仍在打磨，先明确告知，别让用户以为是稳定版
    head.appendChild(_el("span", "ogv-ai-beta", "测试中"));
    head.appendChild(_el("span", "ogv-ai-model", MODEL));
    var btnKey = _el("button", "ogv-ai-hbtn", "🔑");
    btnKey.type = "button";
    btnKey.title = "API Key 设置";
    var btnClear = _el("button", "ogv-ai-hbtn", "🗑️");
    btnClear.type = "button";
    btnClear.title = "新对话（当前内容会留在历史里）";
    var btnClose = _el("button", "ogv-ai-hbtn", "✕");
    btnClose.type = "button";
    btnClose.title = "关闭（Esc）";
    head.appendChild(btnKey);
    head.appendChild(btnClear);
    head.appendChild(btnClose);
    _root.appendChild(head);

    // Key 行（默认收起）
    var keyRow = _el("div", "ogv-ai-keyrow");
    var keyInput = document.createElement("input");
    keyInput.type = "password";
    keyInput.className = "ogv-ai-key";
    keyInput.placeholder = "DeepSeek API Key（sk-…），仅保存本机";
    keyInput.autocomplete = "off";
    keyInput.spellcheck = false;
    keyRow.appendChild(keyInput);
    var btnKeySave = _el("button", "ogv-ai-keysave", "保存");
    btnKeySave.type = "button";
    keyRow.appendChild(btnKeySave);
    _root.appendChild(keyRow);

    var msgs = _el("div", "ogv-ai-msgs");
    msgs.setAttribute("role", "log");
    _root.appendChild(msgs);

    // —— 历史对话抽屉（覆盖在消息区上方，不改变面板尺寸）——
    var hist = _el("div", "ogv-ai-hist");
    hist.hidden = true;
    var histTop = _el("div", "ogv-ai-hist-top");
    var btnNew = _el("button", "ogv-ai-newbtn", "＋ 开启新对话");
    btnNew.type = "button";
    var btnHistClose = _el("button", "ogv-ai-hist-x", "✕");
    btnHistClose.type = "button";
    btnHistClose.title = "收起";
    histTop.appendChild(btnNew);
    histTop.appendChild(btnHistClose);
    hist.appendChild(histTop);
    var histList = _el("div", "ogv-ai-hist-list");
    hist.appendChild(histList);
    _root.appendChild(hist);

    var comp = _el("div", "ogv-ai-comp");
    // 两个运行开关（对齐 DeepSeek 官网输入框底部那两颗 pill 的交互）
    var opts = _el("div", "ogv-ai-opts");
    var bThink = _el("button", "ogv-ai-pill");
    bThink.type = "button";
    bThink.setAttribute("data-opt", "think");
    bThink.innerHTML = '<span class="ogv-ai-pill-i" aria-hidden="true">🧠</span>深度思考';
    var bWeb = _el("button", "ogv-ai-pill");
    bWeb.type = "button";
    bWeb.setAttribute("data-opt", "web");
    bWeb.innerHTML = '<span class="ogv-ai-pill-i" aria-hidden="true">🌐</span>联网搜索';
    opts.appendChild(bThink);
    opts.appendChild(bWeb);
    comp.appendChild(opts);

    var inputRow = _el("div", "ogv-ai-inputrow");
    var ta = document.createElement("textarea");
    ta.className = "ogv-ai-input";
    ta.rows = 1;
    ta.placeholder = "给 AI 发送消息（Ctrl/⌘ + K）";
    inputRow.appendChild(ta);
    var btnSend = _el("button", "ogv-ai-send", "发送");
    btnSend.type = "button";
    inputRow.appendChild(btnSend);
    comp.appendChild(inputRow);
    _root.appendChild(comp);

    document.body.appendChild(_root);
    _els = {
      msgs: msgs, ta: ta, btnSend: btnSend,
      keyRow: keyRow, keyInput: keyInput, btnKeySave: btnKeySave, btnKey: btnKey,
      optWeb: bWeb, optThink: bThink,
      hist: hist, histList: histList, btnHist: btnHist, btnNew: btnNew, btnHistClose: btnHistClose,
    };
    _syncOptBtns();

    btnHist.addEventListener("click", function () {
      _toggleHist();
    });
    btnHistClose.addEventListener("click", function () {
      _toggleHist(false);
    });
    btnNew.addEventListener("click", function () {
      _newChat();
    });
    bThink.addEventListener("click", function () {
      _setOpt("think", !_opt.think);
    });
    bWeb.addEventListener("click", function () {
      _setOpt("web", !_opt.web);
    });
    // 会话项：点标题切换，点 📌 置顶，点 🗑 删除（事件委托，列表会反复重建）
    histList.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var pin = t.closest("[data-pin]");
      if (pin) {
        e.stopPropagation();
        _pinChat(pin.getAttribute("data-pin"), pin.getAttribute("data-on") !== "1");
        return;
      }
      var delBtn = t.closest("[data-del]");
      if (delBtn) {
        e.stopPropagation();
        _delChat(delBtn.getAttribute("data-del"));
        return;
      }
      var row = t.closest("[data-sid]");
      if (row) _switchChat(row.getAttribute("data-sid"));
    });

    btnClose.addEventListener("click", close);
    btnClear.addEventListener("click", function () {
      // 语义变化：原来是「清空对话」，现在历史会留在 IDB 里 → 改成「新对话」
      _newChat();
    });
    btnKey.addEventListener("click", function () {
      keyRow.classList.toggle("open");
      if (keyRow.classList.contains("open")) {
        keyInput.value = _ownKey(); // 只回填自己填的，内置 Key 不回填
        keyInput.focus();
      }
    });
    function saveKey() {
      var v = keyInput.value.trim();
      if (S && S.KEY) {
        if (v) S.safeSet(S.KEY.AI_KEY, v);
        else S.safeRemove(S.KEY.AI_KEY);
      }
      _renderKeyHint();
      keyRow.classList.remove("open");
      _toast(v ? "✅ Key 已保存（仅本机）" : "已删除自填 Key，回落内置");
    }
    btnKeySave.addEventListener("click", saveKey);
    keyInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        saveKey();
      }
    });

    btnSend.addEventListener("click", _send);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        _send();
      }
    });
    ta.addEventListener("input", function () {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    });
    // 候选卡片点击（事件委托：消息区反复重建，不逐个绑）
    msgs.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      // 天地图地名候选：坐标就写在按钮上，不依赖任何缓存
      var g = t.closest("[data-geo]");
      if (g) {
        var glat = Number(g.getAttribute("data-lat"));
        var glng = Number(g.getAttribute("data-lng"));
        var gname = (g.querySelector(".ogv-ai-cand-name") || {}).textContent || "地名";
        if (isFinite(glat) && isFinite(glng)) {
          _flyTo(glat, glng, 9);
          _pushMsg("assistant", "已定位到 " + gname.replace(/^📍\s*/, "") +
            "（" + glat.toFixed(3) + ", " + glng.toFixed(3) + "）");
        }
        return;
      }
      var b = t.closest("[data-cand]");
      if (!b) return;
      var idx = Number(b.getAttribute("data-cand"));
      var res = _lastSearch;
      var it = res && res.items && res.items[idx];
      if (!it) return;
      if (it.type === "feature") {
        _setLayerChecked(it.checkboxId, true);
        _highlight(it.checkboxId, it.feature);
        _pushMsg("assistant", "已定位到 **" + (it.summary || "") + "**（" + it.label + "）");
      } else {
        _zoomToLayer(it.checkboxId);
        _pushMsg("assistant", "已打开并缩放到图层 **" + (it.summary || it.label) + "**");
      }
    });
    _root.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    // Esc 挂 document 捕获阶段：焦点在任何子元素上都能关掉，且不连带关别的
    document.addEventListener(
      "keydown",
      function (e) {
        if (e.key !== "Escape" || !_open) return;
        e.stopPropagation();
        close();
      },
      true,
    );
  }

  function _renderKeyHint() {
    var k = _key();
    var own = !!_ownKey();
    _els.btnKey.title = !k
      ? "未设置 Key（点击填写）"
      : own
        ? "Key 已设置：" + _maskKey(k) + "（点击更换）"
        : "使用内置 Key " + _maskKey(k) + "（点击可填自己的）";
    _els.btnKey.classList.toggle("unset", !k);
  }

  function _pushMsg(role, text, cands) {
    var m = { role: role, text: text, cands: cands || null };
    _msgs.push(m);
    if (_msgs.length > 60) _msgs = _msgs.slice(-60);
    _saveSessions();
    _renderMessages();
    return m; // 返回引用：异步任务（如出图进度）可改 text 后调 _renderMessages() 更新
  }

  function _renderMessages() {
    var box = _els.msgs;
    box.innerHTML = "";
    if (!_msgs.length) {
      var empty = _el("div", "ogv-ai-empty");
      empty.appendChild(_el("div", "ogv-ai-empty-t", "我可以帮你："));
      [
        "「舟山在哪」→ 查地名并定位（矢量没有就用天地图）",
        "「打开火山图层」→ 开关图层",
        "「关掉深色模式 / 打开点位聚类」→ 改站点设置",
        "「放大一点」「切到卫星底图」→ 调视野 / 换底图",
        "「出一张 A4 300dpi 带经纬网的图」→ 辅助出图",
        "「马里亚纳海沟最大深度多少」→ 本地没有就联网搜（带来源链接）",
      ].forEach(function (t) {
        empty.appendChild(_el("div", "ogv-ai-empty-i", t));
      });
      empty.appendChild(
        _el("div", "ogv-ai-empty-i ogv-ai-empty-k", "快捷键 Ctrl / ⌘ + K · 需要上网时先点亮「🌐 联网搜索」"),
      );
      box.appendChild(empty);
      return;
    }
    _msgs.forEach(function (m) {
      var div = _el("div", "ogv-ai-msg ogv-ai-" + m.role);
      var body = _el("div", "ogv-ai-bubble");
      body.innerHTML = _md(m.text);
      div.appendChild(body);
      // 出图预览缩略图（内存里带 dataURL，不落存储、不进历史）
      if (m.img) {
        var im = document.createElement("img");
        im.className = "ogv-ai-thumb";
        im.src = m.img;
        im.alt = "出图预览";
        im.loading = "lazy";
        div.appendChild(im);
      }
      if (m.cands && m.cands.length) {
        var list = _el("div", "ogv-ai-cands");
        m.cands.forEach(function (c) {
          var b = _el("button", "ogv-ai-cand");
          b.type = "button";
          b.setAttribute("data-cand", String(c.idx));
          b.appendChild(_el("span", "ogv-ai-cand-name", c.name));
          b.appendChild(_el("span", "ogv-ai-cand-grp", c.group));
          list.appendChild(b);
        });
        div.appendChild(list);
      }
      // 天地图地名候选（点击直接飞过去；与上面的矢量候选分开标记，语义不同）
      if (m.geo && m.geo.length) {
        var glist = _el("div", "ogv-ai-cands");
        m.geo.forEach(function (c) {
          var b = _el("button", "ogv-ai-cand ogv-ai-geo");
          b.type = "button";
          b.setAttribute("data-geo", String(c.idx));
          b.setAttribute("data-lat", String(c.lat));
          b.setAttribute("data-lng", String(c.lng));
          b.appendChild(_el("span", "ogv-ai-cand-name", "📍 " + c.name));
          b.appendChild(_el("span", "ogv-ai-cand-grp", c.group));
          glist.appendChild(b);
        });
        div.appendChild(glist);
      }
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  // ─────────────────────────────────────────────
  //  持久化：多会话，写 IndexedDB（ogv-chatstore.js）
  // ─────────────────────────────────────────────
  //  · 每次 _msgs 变动都只是**排一次**防抖保存，真正写库在 400ms 后；
  //  · _saveSessions 这个名字保留（调用点很多），语义变成「保存当前会话」；
  //  · 刷新/切会话前用 _flushSave() 立刻落盘，避免最后一句丢在防抖窗口里。
  var _store = global.OGVChatStore || null;
  var _curId = null;
  var _curMeta = { createdAt: 0, pinned: 0 };
  var _saveTimer = null;
  var _histOpen = false;

  function _plainMsgs() {
    return _msgs
      .filter(function (m) {
        return m && (m.role === "user" || m.role === "assistant") && m.text;
      })
      .map(function (m) {
        return { role: m.role, text: String(m.text) };
      })
      .slice(-200);
  }

  /** 会话标题：首条用户消息（去掉换行、截断），没有就用时间 */
  function _titleOf(list) {
    var first = (list || []).filter(function (m) {
      return m.role === "user";
    })[0];
    var t = first ? String(first.text).replace(/\s+/g, " ").trim() : "";
    if (!t) return "新对话";
    return t.length > 28 ? t.slice(0, 28) + "…" : t;
  }

  function _saveSessions() {
    if (!_curId) {
      // 还没有会话（空态）→ 不建空记录，免得历史里一堆「新对话」
      if (!_msgs.length) return;
      _curId = _newId();
      _curMeta.createdAt = Date.now();
    }
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushSave, 400);
  }

  function _flushSave() {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    if (!_store || !_curId) return;
    var msgs = _plainMsgs();
    if (!msgs.length) return;
    _store.put({
      id: _curId,
      title: _titleOf(msgs),
      createdAt: _curMeta.createdAt || Date.now(),
      updatedAt: Date.now(),
      pinned: _curMeta.pinned ? 1 : 0,
      msgs: msgs,
    });
    if (_histOpen) _renderHist(); // 抽屉开着时同步列表顺序
  }

  function _newId() {
    try {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    } catch (e) {}
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** 首次加载：最近一个会话；没有就试一次旧的 localStorage 单会话（迁移） */
  function _loadSessions() {
    _msgs = [];
    if (!_store) return;
    _store.list().then(function (metas) {
      var top = (metas || [])[0];
      if (!top) {
        _migrateLegacy();
        return;
      }
      return _store.get(top.id).then(function (rec) {
        if (!rec) return;
        _curId = rec.id;
        _curMeta = { createdAt: rec.createdAt, pinned: rec.pinned ? 1 : 0 };
        _msgs = (rec.msgs || []).map(function (m) {
          return { role: m.role, text: m.text };
        });
        _renderMessages();
      });
    });
  }

  /** 旧版把单会话存在 localStorage（ogv_ai_sessions）—— 迁成一条 IDB 记录后删掉 */
  function _migrateLegacy() {
    if (!S || !S.getJSON || !S.KEY) return;
    var arr = null;
    try {
      arr = S.getJSON(S.KEY.AI_SESSIONS);
    } catch (e) {}
    if (!Array.isArray(arr) || !arr.length) return;
    var msgs = arr.filter(function (m) {
      return m && (m.role === "user" || m.role === "assistant") && m.text;
    });
    if (!msgs.length) return;
    _curId = _newId();
    _curMeta = { createdAt: Date.now(), pinned: 0 };
    _msgs = msgs;
    _flushSave();
    try {
      S.safeRemove(S.KEY.AI_SESSIONS);
    } catch (e) {}
    _renderMessages();
  }

  // ── 会话切换 / 新建 / 删除 / 置顶 ──
  function _newChat() {
    _flushSave();
    _curId = null;
    _curMeta = { createdAt: Date.now(), pinned: 0 };
    _msgs = [];
    _lastSearch = null;
    _geoLast = null;
    _renderMessages();
    _toggleHist(false);
    if (_els.ta) _els.ta.focus();
  }

  function _switchChat(id) {
    if (!id || id === _curId || !_store) return;
    _flushSave();
    _store.get(id).then(function (rec) {
      if (!rec) return;
      _curId = rec.id;
      _curMeta = { createdAt: rec.createdAt, pinned: rec.pinned ? 1 : 0 };
      _msgs = (rec.msgs || []).map(function (m) {
        return { role: m.role, text: m.text };
      });
      _renderMessages();
      _toggleHist(false);
    });
  }

  function _delChat(id) {
    if (!_store) return;
    _store.del(id).then(function () {
      if (id === _curId) {
        _curId = null;
        _curMeta = { createdAt: Date.now(), pinned: 0 };
        _msgs = [];
        _renderMessages();
      }
      _renderHist();
    });
  }

  function _pinChat(id, on) {
    if (!_store) return;
    _store.patch(id, { pinned: on ? 1 : 0 }).then(function () {
      if (id === _curId) _curMeta.pinned = on ? 1 : 0;
      _renderHist();
    });
  }

  // ── 历史抽屉 ──
  function _toggleHist(on) {
    if (!_els.hist) return;
    var next = on == null ? !_histOpen : !!on;
    _histOpen = next;
    _els.hist.hidden = !next;
    if (next) {
      _els.btnHist.classList.add("is-on");
      _renderHist();
    } else {
      _els.btnHist.classList.remove("is-on");
    }
  }

  /** 日期分组标签：与 DeepSeek 官网一致（今天 / 昨天 / 7 天内 / 更早） */
  function _dayGroup(ts) {
    var d = new Date(ts || 0);
    var now = new Date();
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var t = d.getTime();
    if (t >= day0) return "今天";
    if (t >= day0 - 864e5) return "昨天";
    if (t >= day0 - 7 * 864e5) return "7 天内";
    return "更早";
  }

  function _renderHist() {
    if (!_els.histList || !_store) return;
    var box = _els.histList;
    box.innerHTML = "";
    box.appendChild(_el("div", "ogv-ai-hist-tip", "加载中…"));
    _store.list().then(function (metas) {
      box.innerHTML = "";
      if (!metas.length) {
        box.appendChild(_el("div", "ogv-ai-hist-tip", "还没有历史对话"));
        return;
      }
      var order = ["置顶", "今天", "昨天", "7 天内", "更早"];
      var groups = {};
      metas.forEach(function (m) {
        var g = m.pinned ? "置顶" : _dayGroup(m.updatedAt);
        (groups[g] = groups[g] || []).push(m);
      });
      order.forEach(function (g) {
        var arr = groups[g];
        if (!arr || !arr.length) return;
        box.appendChild(_el("div", "ogv-ai-hist-group", g));
        arr.forEach(function (m) {
          var row = _el("div", "ogv-ai-hist-item");
          row.setAttribute("data-sid", m.id);
          row.setAttribute("role", "button");
          row.tabIndex = 0;
          if (m.id === _curId) row.classList.add("is-on");
          var t = _el("span", "ogv-ai-hist-t", m.title || "新对话");
          t.title = m.title || "";
          row.appendChild(t);
          var acts = _el("span", "ogv-ai-hist-acts");
          var pin = _el("button", "ogv-ai-hist-act", m.pinned ? "📌" : "📌");
          pin.type = "button";
          pin.setAttribute("data-pin", m.id);
          pin.setAttribute("data-on", m.pinned ? "1" : "0");
          pin.title = m.pinned ? "取消置顶" : "置顶";
          if (m.pinned) pin.classList.add("is-on");
          var del = _el("button", "ogv-ai-hist-act", "🗑");
          del.type = "button";
          del.setAttribute("data-del", m.id);
          del.title = "删除这条对话";
          acts.appendChild(pin);
          acts.appendChild(del);
          row.appendChild(acts);
          box.appendChild(row);
        });
      });
    });
  }

  // ─────────────────────────────────────────────
  //  发送主流程
  // ─────────────────────────────────────────────
  function _send() {
    var text = _els.ta.value.trim();
    if (!text || _busy) return;
    _els.ta.value = "";
    _els.ta.style.height = "auto";
    _pushMsg("user", text);

    // ① 出图意图 → 直接进模型（本地搜索会误命中图层名）
    // ② 提问意图 → 直接进模型（整句当 POI 查会答非所问，见 QA_INTENT）
    // ③ 本地直通：短查询先搜一次
    if (!EXPORT_INTENT.test(text) && !QA_INTENT.test(text)) {
      var res = _search(text);
      var items = res.items || [];
      if (items.length === 1) {
        var it = items[0];
        _lastSearch = res;
        if (it.type === "feature") {
          _setLayerChecked(it.checkboxId, true);
          _highlight(it.checkboxId, it.feature);
          _pushMsg("assistant", "已定位到 **" + (it.summary || text) + "**（" + it.label + "）");
        } else {
          _zoomToLayer(it.checkboxId);
          _pushMsg("assistant", "已打开并缩放到图层 **" + (it.summary || it.label) + "**");
        }
        return;
      }
      if (items.length > 1) {
        _lastSearch = res;
        var cands = items.slice(0, MAX_CANDIDATES).map(function (it2, i) {
          return {
            idx: i,
            name: it2.type === "feature" ? it2.summary : it2.summary || it2.label,
            group: it2.type === "feature" ? it2.label : "图层",
          };
        });
        _pushMsg(
          "assistant",
          "找到 " + (res.total || items.length) + " 个相关结果，点一个定位：",
          cands,
        );
        return;
      }
      // 0 命中 → 先查地名注册表（南海/东海这类 curated 地名）
      var p = _placeHit(text);
      if (p) {
        _zoomToPlace(p);
        _pushMsg("assistant", "已定位到 **" + p.name + "**");
        return;
      }
      // 还是 0 → 兜底天地图地名服务。命中就**本地直接解决**（不花 API 配额）：
      // 这正是「先查已有矢量，没有就查天地图」的那一步。
      if (_geo() && _geo().ready() && text.length >= 2) {
        _localGeocode(text);
        return;
      }
      // 天地图都没配 → 直接交给模型（它还有 web_search 这一级）
      _askModelFlow(
        "（系统提示：站点矢量与内置地名表都没有「" + text + "」，天地图也未配置 —— " +
          "可以试 web_search；它没有坐标，别当成定位结果。）",
      );
      return;
    }

    _askModelFlow();
  }

  /**
   * 本地地名兜底（同步路径的异步尾巴）。
   * 单条命中 → 直接飞过去；多条 → 列候选卡片让用户点；
   * 一条都没有 → 才把球交给模型（可能用户问的根本不是地名）。
   */
  function _localGeocode(text) {
    _busy = true;
    if (_els.btnSend) _els.btnSend.disabled = true;
    var tip = _pushMsg("assistant", "🔍 图层里没有，正在查天地图地名「" + text + "」…");
    var G = _geo();
    var bound = _searchBound(30, 20);
    // 本地三级（矢量 / 地名表 / 天地图）都空时给模型的提示：这时才轮到联网。
    var missHint =
      "（系统提示：站点矢量、内置地名表、天地图都没查到「" + text + "」。" +
      "如果用户问的是地点，可以再试 web_search 找资料（它没有坐标，别当成定位结果）；" +
      "如果问的是知识，直接用 web_search 并给链接。）";
    G.search(text, { count: 8, bound: bound })
      .then(function (r) {
        var items = (r && r.items) || [];
        if (!items.length) {
          // 地名也没有 → 交给模型（清掉那条提示，别留一句「正在查…」）
          var i0 = _msgs.indexOf(tip);
          if (i0 >= 0) _msgs.splice(i0, 1);
          _renderMessages();
          _busy = false;
          if (_els.btnSend) _els.btnSend.disabled = false;
          _askModelFlow(missHint);
          return;
        }
        if (items.length === 1) {
          var t = items[0];
          _flyTo(t.lat, t.lng, 9);
          tip.text = "📍 天地图地名：**" + t.name + "**" + (t.address ? "（" + t.address + "）" : "");
          _saveSessions();
          _renderMessages();
        } else {
          tip.text = "矢量数据里没有，天地图找到 " + items.length + " 个地名，点一个定位：";
          tip.geo = items.map(function (x, i) {
            return { idx: i, name: x.name, group: x.address || "天地图地名", lat: x.lat, lng: x.lng };
          });
          _geoLast = items;
          _saveSessions();
          _renderMessages();
        }
        _busy = false;
        if (_els.btnSend) _els.btnSend.disabled = false;
      })
      .catch(function () {
        var i1 = _msgs.indexOf(tip);
        if (i1 >= 0) _msgs.splice(i1, 1);
        _renderMessages();
        _busy = false;
        if (_els.btnSend) _els.btnSend.disabled = false;
        _askModelFlow();
      });
  }

  /** 模型路径（原来是 _send 的下半段，抽出来给地名兜底失败时复用）
   *  @param hint 附在最后一条用户消息后的补充（如「本地三级都没查到，可联网搜」） */
  function _askModelFlow(hint) {
    if (!_key()) {
      _pushMsg("assistant", "还没配置 API Key：点右上角 🔑 填一个 DeepSeek Key 即可。");
      _els.keyRow.classList.add("open");
      return;
    }
    _busy = true;
    _els.btnSend.disabled = true;
    var thinking = _el("div", "ogv-ai-msg ogv-ai-assistant");
    var thinkBubble = _el("div", "ogv-ai-bubble ogv-ai-thinking", "思考中…");
    thinking.appendChild(thinkBubble);
    _els.msgs.appendChild(thinking);
    _els.msgs.scrollTop = _els.msgs.scrollHeight;

    // 工具执行时把「正在做什么」写回思考气泡 —— 否则出图要等十几秒，用户只会看到
    // 一句不动的「思考中…」，以为卡死了。
    function onStep(toolName, args) {
      var fn = TOOL_STEP[toolName];
      thinkBubble.textContent = fn ? fn(args || {}) : "⚙️ " + toolName + "…";
      // 工具里可能 _pushMsg（预览/出图结果）→ 整块消息区被重建，气泡被摘下来。
      // 这里补挂回去，保证「正在做什么」始终在最下面可见。
      if (!thinking.parentNode) _els.msgs.appendChild(thinking);
      _els.msgs.scrollTop = _els.msgs.scrollHeight;
    }

    _askModel(onStep, hint)
      .then(function (reply) {
        _pushMsg("assistant", reply);
      })
      .catch(function (e) {
        var msg = String((e && e.message) || e);
        if (/abort|timeout/i.test(msg)) msg = "请求超时，请重试";
        _pushMsg("assistant", "⚠️ 调用失败：" + msg);
      })
      .finally(function () {
        _busy = false;
        _els.btnSend.disabled = false;
        _els.ta.focus();
      });
  }

  // ─────────────────────────────────────────────
  //  右下角悬浮球（与 Leaflet 图层控件同列）
  // ─────────────────────────────────────────────
  /**
   * 做成 L.Control 而不是 position:fixed 的裸 div：
   *   · 右下角已经有一摞 Leaflet 控件（图层切换），L.Control 会**自动排在它们上面**，
   *     不用手算 bottom 像素，也不会和 3D/极地视图的控件打架；
   *   · 自带 disableClickPropagation，点它不会顺手把地图拖走。
   * 「地图设置 → AI 悬浮球」开关控制它的存在（app.js toggleConfig）；
   * 面板打开时把它藏起来（面板自己有关闭按钮，右下角不要再压一个小球）。
   */
  var _fab = null;
  var _fabWanted = true;

  function _mountFab() {
    if (_fab || !global.L || !global.map) return;
    var Fab = L.Control.extend({
      options: { position: "bottomright" },
      onAdd: function () {
        var box = L.DomUtil.create("div", "ogv-ai-fab leaflet-control");
        var btn = L.DomUtil.create("button", "ogv-ai-fab-btn", box);
        btn.type = "button";
        btn.title = "AI 助手（Ctrl/⌘ + K）";
        btn.setAttribute("aria-label", "打开 AI 助手");
        btn.innerHTML = '<span class="ogv-ai-fab-ico" aria-hidden="true">🤖</span>';
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.disableScrollPropagation(box);
        L.DomEvent.on(btn, "click", function (ev) {
          L.DomEvent.stop(ev);
          toggle();
        });
        return box;
      },
    });
    _fab = new Fab();
    _fab.addTo(global.map);
  }

  function _unmountFab() {
    if (!_fab) return;
    try {
      if (global.map) global.map.removeControl(_fab);
    } catch (e) {}
    _fab = null;
  }

  function setFab(on) {
    _fabWanted = !!on;
    if (_fabWanted) _mountFab();
    else _unmountFab();
    _syncFab();
  }

  function _syncFab() {
    if (!_fab || !_fab._container) return;
    _fab._container.style.display = _open ? "none" : "";
  }

  function _initFab() {
    var cb = document.getElementById("aiFabToggle");
    setFab(cb ? !!cb.checked : true);
    // 兜底监听：万一 app.js 里没注册这个开关（缓存中的旧版），小球开关也不能失灵
    if (cb) {
      cb.addEventListener("change", function () {
        setFab(!!this.checked);
      });
    }
  }

  // ─────────────────────────────────────────────
  //  开关
  // ─────────────────────────────────────────────
  function open() {
    _ensure();
    _loadOpts();
    _syncOptBtns();
    _loadSessionsOnce();
    _renderKeyHint();
    _renderMessages();
    _watchExportPanel();
    _root.classList.add("open");
    _open = true;
    _syncFab();
    _els.ta.focus();
  }
  // 出图面板（#mapExportPanel）也停靠右侧：它打开时 AI 面板左移让位，关闭后弹回
  var _mepObserver = null;
  function _watchExportPanel() {
    if (_mepObserver || typeof MutationObserver === "undefined") return;
    var sync = function () {
      var mep = document.getElementById("mapExportPanel");
      if (_root) _root.classList.toggle("dock-left", !!(mep && !mep.hidden));
    };
    _mepObserver = new MutationObserver(sync);
    // 面板是懒构建的：childList 抓创建，attributes 抓 hidden 变化
    _mepObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    sync();
  }
  var _loadedOnce = false;
  function _loadSessionsOnce() {
    if (_loadedOnce) return;
    _loadedOnce = true;
    _loadSessions();
  }
  function close() {
    if (_root) _root.classList.remove("open");
    _open = false;
    _flushSave(); // 关面板/切标签页前把最后一句立刻落盘（别丢在防抖窗口里）
    _syncFab();
    if (_abort) _abort.abort();
  }
  function toggle() {
    if (_open) close();
    else open();
  }

  // ─────────────────────────────────────────────
  //  快捷键：Ctrl/⌘ + K 唤起（Ctrl+E 出图、Ctrl+F 搜索都已被占用）
  // ─────────────────────────────────────────────
  document.addEventListener("keydown", function (e) {
    var k = String(e.key || "").toLowerCase();
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || k !== "k") return;
    e.preventDefault();
    if (_open) {
      // 已经开着：把焦点送回输入框（别把它关掉 —— 用户多半是想接着问）
      if (_els.ta) {
        _els.ta.focus();
        _els.ta.select();
      }
    } else {
      open();
    }
  });

  // ─────────────────────────────────────────────
  //  初始化（悬浮球）
  // ─────────────────────────────────────────────
  function _boot() {
    _initFab();
    _loadOpts(); // 开关状态与面板是否打开无关：AI 被快捷键唤起前就要生效
    if (_els.optWeb) _syncOptBtns();
    // 关标签页/切到后台：把还在防抖窗口里的最后一句写进 IDB
    global.addEventListener("pagehide", _flushSave);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") _flushSave();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _boot);
  } else {
    _boot();
  }

  /** 外部投喂一句提问（搜索框「没找到？让 AI 联网查」按钮用它） */
  function ask(text) {
    var t = String(text || "").trim();
    if (!t) return;
    open();
    _ensure();
    if (_els.ta) {
      _els.ta.value = t;
      _els.ta.dispatchEvent(new Event("input"));
    }
    _send();
  }

  // ─────────────────────────────────────────────
  //  导出
  // ─────────────────────────────────────────────
  global.OGVAI = {
    open: open,
    close: close,
    toggle: toggle,
    ask: ask,
    /** 当前生效的 Key（ogv-websearch.js 靠它取同一个 Key，避免两处各写一份） */
    getKey: _key,
    isOpen: function () {
      return _open;
    },
    /** 悬浮球显隐（app.js 的「AI 悬浮球」开关调它） */
    setFab: setFab,
    // 探针用：不发请求的原语
    _search: _search,
    _zoomToName: _zoomToName,
    _execTool: _execTool,
    _locate: _locate,
    _web: _web,
    _webSearch: _webSearchTool,
    _optionItems: _optionItems,
    _ctxLine: _ctxLine,
    // 运行开关（联网搜索 / 深度思考）与历史会话：探针与宿主页用
    opts: function () {
      return { web: !!_opt.web, think: !!_opt.think };
    },
    setOpt: _setOpt,
    newChat: _newChat,
    listChats: function () {
      return _store ? _store.list() : Promise.resolve([]);
    },
    openChat: _switchChat,
    _toolsFor: _toolsFor,
    MODEL: MODEL,
  };
})(window);
