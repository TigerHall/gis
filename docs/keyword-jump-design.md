# 关键词跳转地图区域 — 详细设计文档

> 状态：**应用侧地基已实施**（web+dupal 协议 + 搜索复用 + 坐标/bbox 深链 + 程序化 API + postMessage 桥）。浏览器插件 / 桌面 helper 仍待做。
> 目标：在网页或桌面检测到关键词（如「南海」）后，点击即可跳转到本地图应用并缩放至对应区域。

---

## 1. 总体架构

问题拆成**两端、解耦**：

- **地图应用侧（地基，必先做）**：自身支持「按词语聚焦区域」——URL 深链 + `window.OGV` 程序化 API + `postMessage` 桥。
- **检测端（可多选）**：
  - 浏览器插件（MV3 content script）：在任意网页检测关键词并触发跳转。
  - 桌面端：自定义协议 `ogv://focus/南海` + 轻量启动器（避免重 OCR 方案）。

检测端与地图应用只通过 **URL 参数** 或 **`postMessage` 消息** 通信，检测端不依赖地图内部实现。

```
任意网页 ──(插件检测/高亮)──> 跳转触发 ─┐
                                      ├─> 地图应用 OGV ──> 缩放定位(flyTo/fitBounds)
桌面端 ──(ogv:// 协议)────────> 触发 ──┘        ↑ 地名注册表 / 复用搜索索引
```

---

## 2. 地图应用侧：焦点 / 深链能力

### 2.1 URL 方案（采用 hash，分享友好、不受 SW 缓存干扰）

| 形式                 | 含义                                   | 解析目标                                   |
| -------------------- | -------------------------------------- | ------------------------------------------ |
| `#focus=南海`        | 跳预设区域                             | `PLACE_REGISTRY` 按 `name`/`aliases` 查    |
| `#feature=南海`      | 跳任意可搜索要素                       | 复用现有搜索 → `highlightAndLocateFeature` |
| `#loc=12,113,5`      | 直接定位 `lat,lng,zoom`                | 直接 `map.flyTo`                           |
| `#bbox=0,105,25,122` | 直接定位 `minLat,minLng,maxLat,maxLng` | `map.flyToBounds`                          |

- 解析时机：页面 `load` 完成后 + 监听 `hashchange`。
- 顺序：`#focus` / `#feature` 优先于 `#loc` / `#bbox`；同名时 `focus` 优先 curated 注册表，`feature` 走搜索 top1。
- ✅ **上述四类命令已在 `assets/app.js` 的 `window.OGV` + 解析器实现并通过语法校验**；`web+dupal://` 协议也已在 `manifest.json` 注册。

### 2.1.1 两种写法（path 式 / param 式，等效）

```
#focus/南海         ≡   #focus=南海
#search/南海        ≡   #search=南海
#loc/23.5,119.8,6   ≡   #loc=23.5,119.8,6
#bbox/0,105,25,122  ≡   #bbox=0,105,25,122
```

- `web+dupal://focus/南海` 会被拆出 `focus/南海` 走同一解析器（协议只作外部触发器）。
- `?` 后缀（query string）也可承载坐标：**`dupal.cn/?loc=23.5,119.8`** 已被解析器兼容（含 `=` 且无 `/` 时按 param 式解析）。但注意：带 `?` 的链接会与 `web+dupal` 的 `?proto=%s` 共用 query 段，建议深链优先用 **hash（`#`）**，分享/刷新更稳定、不受 SW 缓存干扰。

### 2.2 地名注册表（静态预设）

在 `geo-config.js` 暴露 `window.PLACE_REGISTRY`，首批写入南海/东海/渤海/黄海等海域 bbox。

```js
// geo-config.js
window.PLACE_REGISTRY = [
  {
    name: "南海",
    aliases: ["South China Sea", "南海海域", "南中国海"],
    bbox: [
      [0, 105],
      [25, 122],
    ], // [[minLat, minLng], [maxLat, maxLng]]
    zoom: 5, // 可选：指定 zoom 优先于 fitBounds
    center: [12, 113], // 可选：直接 flyTo 中心而非 fit
  },
  {
    name: "东海",
    aliases: ["East China Sea"],
    bbox: [
      [24, 118],
      [41, 131],
    ],
  },
  // ... 渤海 / 黄海 / 关键海槽等
];
```

> bbox 为示例近似值，实施时需按底图投影与真实范围校准；`center`+`zoom` 与 `bbox` 二选一，存在 `center` 时优先。

### 2.3 程序化 API：`window.OGV`

```js
window.OGV = {
  // 跳预设区域；命中返回 true，未命中 false
  flyToRegion(name) -> boolean,

  // 跳任意可搜索要素（复用现有搜索 + highlightAndLocateFeature）
  // 返回 Promise<boolean>
  focusFeature(name, opts?) -> Promise<boolean>,

  // 直接按 bbox 飞入；bbox: [[minLat,minLng],[maxLat,maxLng]]
  flyToBbox(bbox, opts?) -> void,

  // 预览解析结果，不执行跳转：{ type:'region'|'feature'|null, ... }
  resolve(name) -> object,

  // 供插件拉取关键词列表（已在地图页时）
  listPlaces() -> Array<{name, aliases}>
};
```

### 2.4 postMessage 桥（已开标签页平滑跳转，不刷新）

地图应用监听：

```js
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.type !== "OGV_FOCUS") return;
  const mode = d.mode || "auto";
  let ok = false;
  if (mode === "region") ok = window.OGV.flyToRegion(d.name);
  else if (mode === "feature") ok = await window.OGV.focusFeature(d.name);
  else ok = window.OGV.flyToRegion(d.name) || await window.OGV.focusFeature(d.name);
  // 可选回执
  e.source && e.source.postMessage({ type: "OGV_FOCUS_ACK", ok, name: d.name }, e.origin);
});
```

入站消息格式：

```js
{ source: "ogv-ext" | "ogv-desktop", type: "OGV_FOCUS", name: "南海", mode: "region" | "feature" | "auto" }
```

### 2.5 复用现有搜索（关键，零额外成本）

- `?feature=南海` 与 `OGV.focusFeature` 直接调用现有搜索逻辑（基于 `featureCache` / `initPrioritySearchIndices`），取 top1 结果后复用已修好的 `highlightAndLocateFeature(feat)`（按真实坐标定位，不依赖 `_featureIndex`）。
- 这意味着**任何能被搜到的要素名都能当焦点**，无需全部写死进 `PLACE_REGISTRY`。

### 2.6 待改动文件清单（应用侧）

| 文件                      | 改动                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `geo-config.js`           | 新增 `window.PLACE_REGISTRY`（南海等预设 bbox）                                                   |
| `assets/app.js`           | 新增：hash 解析、`window.OGV` 实现、`message` 监听、`hashchange` 监听；地图就绪后执行一次初始聚焦 |
| `index.html`              | 无需改动（深链走 hash，不新增 DOM）                                                               |
| `assets/geojsonloader.js` | 无需改动（复用 `highlightAndLocateFeature`）                                                      |

> 实施前需确认全局 Leaflet 地图实例变量名（记忆中为 `map`），`OGV` 内部统一引用。

### 2.7 边界与降级

- 区域/要素均未命中：toast 提示「未找到：南海」，不报错、不跳。
- 同名消歧：`focus` 模式优先 curated 注册表；`auto` 模式先 region 后 feature。
- 地图未就绪时收到消息：缓存待执行指令，地图 `load` 后再跑。

### 2.8 命令语法总览与路线图（规划）

深链的本质是一套 **`action/argument` 命令语法**，挂载在 hash 或 `web+dupal://` 协议之后。当前已落地核心四类，后续可按需扩展。下方为「域名后缀能支持的功能」总览与分阶段路线。

#### 2.8.1 已实施（Milestone 1，本次交付）

| 命令                                                   | 参数格式 | 行为                                     | 数据源           |
| ------------------------------------------------------ | -------- | ---------------------------------------- | ---------------- |
| `focus/<名>`                                           | 地名     | 飞入 curated 区域（bbox 或 center+zoom） | `PLACE_REGISTRY` |
| `search/<词>`                                          | 任意词   | 复用现有搜索，取 top1 要素定位           | 全量搜索索引     |
| `loc/<lat>,<lng>[,<zoom>]`                             | 坐标     | 直接飞到坐标                             | —                |
| `bbox/<minLat>,<minLng>,<maxLat>,<maxLng>[,<maxZoom>]` | 四至     | fitBounds 飞入                           | —                |

#### 2.8.2 规划中（Milestone 2–3，按需）

| 命令                  | 参数格式     | 行为                                        | 说明                        |
| --------------------- | ------------ | ------------------------------------------- | --------------------------- |
| `layer/<图层名>`      | 图层显示名   | 勾选/高亮指定图层并飞入其范围               | 复用现有图层 checkbox 状态  |
| `layers/<名1>,<名2>`  | 多个图层名   | 批量显示图层（场景预设）                    | 可做「主题场景」一键加载    |
| `measure/<lat>,<lng>` | 坐标         | 在该点打开测距/标记工具                     | 需地图测量模块支持          |
| `route/<a>~<b>`       | 两坐标或地名 | 两点间画线/测距                             | 复用测距 API                |
| `share/<当前视图>`    | 无参         | 生成可复现当前地图状态的深链                | 序列化 center/zoom/可见图层 |
| `q/<混合查询>`        | 自由文本     | 智能分流：地名→focus、坐标→loc、其余→search | 单一入口，体验最佳          |
| `theme/<名>`          | 主题名       | 切换底图/配色预设                           | 复用底图开关                |

#### 2.8.3 坐标输入的推荐形态

- **首选 `loc/<lat>,<lng>[,<zoom>]`**（path 式）：清晰、可与 `focus/` 等并列，分享稳定。
- **兼容 `?loc=<lat>,<lng>`**（query 式）：你提到的「`?` 后缀输入坐标」即此形态，解析器已兼容（含 `=` 无 `/` 即按 param 式）。
- **人名/地名而非坐标**：推荐直接 `search/地名`，由搜索兜底，避免手敲经纬度。
- **经纬度顺序固定 `lat,lng`**（GeoJSON / Leaflet 惯例），`bbox` 为 `minLat,minLng,maxLat,maxLng`。

#### 2.8.4 设计约束（保持语法可扩展）

- 解析器对未知 `action` 自动退化为 `search`（见 `execCommand` 的 `default` 分支），新增命令不会破坏旧链接。
- 所有命令经 `parseCommand` 统一解析，便于将来支持 JSON 体（`#cmd={...}`）等高级形态。
- 协议（web+dupal / dupal://）只是外部触发器，命令语法在应用侧唯一，插件/桌面端零耦合。

---

## 3. 浏览器插件（MV3）

### 3.1 文件结构

```
ogv-jump-ext/
  manifest.json        // MV3
  content.js           // 注入页面，检测+高亮+点击
  background.js        // 标签查询 / sendMessage 路由
  popup.html/js        // 本页检测到的地名列表
  keywords.js          // 兜底关键词（与 places.json 同步）
```

### 3.2 manifest.json（要点）

```json
{
  "manifest_version": 3,
  "name": "OGV 地名跳转",
  "permissions": ["activeTab", "scripting", "tabs", "contextMenus"],
  "host_permissions": ["https://你的域名/*"],
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

### 3.3 关键词来源（单一数据源，避免漂移）

- 插件从地图应用拉取 `https://你的域名/places.json`（由 `PLACE_REGISTRY` + 高频搜索词生成，随部署更新）。
- 离线/拉取失败时回退到内置 `keywords.js`。
- 也可在地图页打开时直接调用 `window.OGV.listPlaces()`。

### 3.4 content.js 逻辑

1. 取关键词表（内置或拉取）。
2. 扫描可见文本节点，命中关键词则包成 `<span class="ogv-jump" data-ogv-name="南海">南海</span>`（带页码内开关，默认关闭，用户点击插件图标开启）。
3. 点击 span：

```js
span.addEventListener("click", async () => {
  const name = span.dataset.ogvName;
  const tab = await findOpenOgvTab(); // background 查已开地图页
  if (tab) {
    chrome.tabs.sendMessage(tab.id, {
      type: "OGV_FOCUS",
      name,
      mode: "auto",
      source: "ogv-ext",
    });
  } else {
    chrome.tabs.create({
      url: "https://你的域名/#focus=" + encodeURIComponent(name),
    });
  }
});
```

- `findOpenOgvTab` 由 background 通过 `chrome.tabs.query({url:'https://你的域名/*'})` 实现；命中已开页 → `sendMessage` 平滑飞入，否则开深链新页。

### 3.5 增强项

- 右键菜单「在 OGV 中查看『南海』」（`contextMenus`，选中文本时触发）。
- popup 列出本页检测到的地名，点击批量跳转。

---

## 4. 桌面端方案（推荐做法）

`ogv://` 只是示意占位符——**协议名（scheme）你可以自己定**。对纯 Web 应用（你的站点 dupal.cn），推荐用与品牌一致的 `dupal`，或纯 Web 注册要求的 `web+dupal`。

### 4.1 它到底是什么

`ogv://focus/南海` = 一个**自定义 URL 协议（URL scheme）**，形如 `https://`、`mailto:`。点击/输入该链接时，操作系统把请求交给「注册了该 scheme 的应用」。对我们来说，它本质是 `#focus=南海` 深链的**桌面入口**——`focus/南海` 是命令部分，由你定义；注册后会被翻译成 `https://dupal.cn/#focus=南海`（应用侧逻辑不变，见 §2）。

### 4.2 两种注册路径（关键区别）

⚠️ **重要坑（已踩）**：`manifest.json` 的 `protocol_handlers` 在 **Chrome / Edge 稳定版不会自动注册**自定义协议（该字段 Chromium 默认不生效，需 flag）。所以仅写 manifest 字段，系统注册表里没有 `web+dupal`，地址栏 / Win+R 都找不到应用。

**正确主方案 = 运行时 `navigator.registerProtocolHandler()` + 用户手势**：浏览器规定注册必须在用户点击等手势栈内调用，否则被拒绝。

- **A. 纯 Web 注册（零原生代码，已实施）**
  - 已做成「⚙️ 地图设置 → 高级」分类下的开关 **「链接跳转🧪」**（与深色模式同款 toggle：TOGGLE_GROUPS 渲染 + toggleConfig 行为，由 initToggle 自动绑定 change）。开启即调用：
    ```js
    navigator.registerProtocolHandler('web+dupal', location.origin + '/?proto=%s', 'Dupal 地图');
    ```
    handler 用 `location.origin` 动态拼接（**不可硬编码域名**，否则 localhost / 非 dupal.cn 下报 "Can only register custom handler in the document's origin"）。成功后 `web+dupal` 写入系统，地址栏 / 网页链接 / Win+R 都能调起并聚焦。
  - `manifest.json` 的 `protocol_handlers` 字段**保留作 Firefox 等补充**（Firefox 安装 PWA 时可能自动注册），但 Chrome/Edge 不依赖它。
  - 两者都要求 scheme 以 `web+` 开头 → 用 `web+dupal`。`%s` 会被替换为完整 URL（`web+dupal://focus/南海`），应用在 `load` 时读 `proto` 参数、剥离 `web+dupal://` 前缀得到 `focus/南海`，再走 §2 逻辑。
  - **支持范围**：Chromium 系（Chrome / Edge）注册后可用；Firefox 注册的协议**不写系统注册表**，仅浏览器内点击链接生效、Win+R 用不了；Safari / iOS 基本不支持。

- **B. 原生 OS 注册（桌面全域、跨浏览器，需小助手）**
  在系统层（Windows 注册表 / macOS Info.plist / Linux .desktop）注册 `dupal://`，指向一个极小的本地 helper。helper 把 `dupal://focus/南海` 直接重写为 `https://dupal.cn/#focus=南海` 并拉起浏览器——**应用只看到干净的 hash**。可从任意桌面程序/链接触发、且不依赖 Chromium，但需分发/安装/签名该 helper。

### 4.3 轻量启动器（补充）

书签、小程序或 Electron/Tauri 小窗，输入地名即开 `https://dupal.cn/#focus=地名`，底层同样复用 §2。

### 4.4 建议

先上 **A 的运行时注册（web+dupal）+ 设置面板「启用」按钮**——已实现，用户点一次即生效，零原生代码；等需要桌面全域 / 非 Chromium 覆盖时再补 **B（`dupal://` + helper）**。应用侧 `#focus=南海` 逻辑不变。

---

## 5. 数据同步与单一数据源

```
PLACE_REGISTRY (geo-config.js)
      │  构建时生成
      ▼
places.json (站点根，随部署更新)  ──拉取──> 插件关键词表
      │
      └─> 运行时 window.OGV.listPlaces() ──> 已开地图页内的插件
```

- 南海等预设写在 `PLACE_REGISTRY`，一次性生成 `places.json`。
- 动态要素名由现有搜索索引覆盖，无需进 `places.json`。

---

## 6. 安全与隐私

- 插件默认关闭，用户页内开关开启；不收集页面内容。
- 地图应用 `message` 监听仅响应 `OGV_FOCUS` 类型，对 `source` 做白名单校验（仅信任来自扩展/桌面的已知来源或同域）。
- `ogv://` 协议解析做输入校验，防止注入。

---

## 7. 验证计划

1. **应用侧单测（无插件）**：
   - 打开 `https://你的域名/#focus=南海` → 地图飞入南海 bbox。
   - 打开 `https://你的域名/#feature=南海` → 复用搜索定位到南海要素。
   - 控制台 `OGV.flyToRegion('东海')` / `OGV.focusFeature('南海')` 手动验证。
2. **插件联调**：
   - 开启插件 → 访问含「南海」的第三方页 → 关键词高亮 → 点击 → 已开地图页平滑飞入（sendMessage）或新开页聚焦（深链）。
3. **桌面**：
   - 浏览器地址栏输入 `ogv://focus/南海` → 地图拉起并聚焦。

---

## 8. 开放问题（评审时确认）

- ✅ 全局地图实例变量名已确认 = `window.map`。
- ✅ `web+dupal` 协议已在 `manifest.json` 注册（`protocol_handlers`）；应用侧解析已在 `assets/app.js` 落地。
- `places.json` 生成方式：构建脚本自动产出，还是手写维护？（当前 `PLACE_REGISTRY` 写在 `geo-config.js`，可后续脚本导出）。
- 插件上架范围：仅你自用（unpacked 加载）还是上架商店（需更严的权限说明）？
- 桌面端是否需要「启动器小窗」，还是仅 `web+dupal` 协议即可？是否要补 `dupal://` + 原生 helper 覆盖 Safari/iOS。
- 坐标链接分享：默认走 hash（`#loc=`）还是 query（`?loc=`），需确认主推形态（文档建议 hash）。

---

_文档版本：设计稿 v1 — 2026-07-21_
