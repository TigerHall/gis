# OGV 长期记忆（索引 + 硬规则）
> 只留「会反复踩的规则」，每条尽量一行。细节见同目录 `INTERNALS.md`：A 测量 / B 2D+世界副本 / C 弹窗 / D 3D / E 通用坑 / F 极地 / G 底图 / H 极冠环 / I 工具链 / J 出图+AI+PWA / K 联网 / M 出图论文级 / O PWA / P 经纬网 / **Q 出图坐标与合成**。修复过程见 daily log。

## 0 定调
- 定制最小单位 = **一整份 `geo-config.js`**（标题+主题色+路径+图层清单+地名表）。⛔ 不加第二份配置，外置只换**这份文件的来源**。
- ⛔ 引擎禁硬编码站点/图层级设定。✅ 能改配置 → 只改配置；必须改引擎 → **同时补一个配置字段**。
- ⭐ 首要参考 = [GeoLibre](https://github.com/opengeos/GeoLibre)（见 `docs/REFERENCES.md`）。

## 1 架构
- **AI = `assets/ai-chat.js`**（`OGVAI`）：本地直通 → `PLACE_REGISTRY` → 天地图 → 联网 → 模型 tool-calling（≤8 轮、非流式、串行；触顶再一轮 `noTools` 收尾）。入口 = 右下 `L.Control` 悬浮球（`aiFabToggle`）+ **Ctrl/⌘+K**；模型 `deepseek-flash` = `V4.1-Flash-1017`（`deepseek-chat` 旧名能跑但不稳），`OGV_AI_MODEL` 可覆盖。
- 两颗 pill = `_opt.web/think`：关联网 = 剔 `web_*` 且不自动联网；关思考 = `thinking:{type:"disabled"}`。⚠️ `getBool` 只认 `"true"`（写 `"1"` 像没生效）。会话存 `ogv-chatstore.js`（IDB `ogv-ai/sessions`，永不 reject，降级 localStorage）。见 §N。
- ⚠️ 开思考每轮须回传 `reasoning_content`（整条 msg 入栈即成立）。
- ⚠️ **内置 Key 已删**（2026-10-27 泄露失效）：`DEFAULT_API_KEY` 必须为空，没 Key 只走本地直通；401/402 要翻成人话。
- **输入框** = 一个 `.ogv-ai-box` 包住「textarea + 工具条」（🧠 思考 / 🌐 联网 / 🎤 语音 + ↑ 发送）；语音双入口（点 🎤 开关 / 按住输入框 380ms），**发送与关窗必先 `_voiceCancel`**，`_voiceFinish` 要保留未定稿 interim。**已改成浮层**（`.ogv-ai-comp` absolute、无分割线、静止态 `border:1px solid transparent`），消息区靠 `_syncComposerPad()`（ResizeObserver）写 `padding-bottom = 浮层高 + 10`，否则最后一条被永久压住；窄屏上限由 **CSS `max-height`** 决定（JS 读 computedStyle，别写死）。
- **矢量属性分析** = `describe_layer`（前端统计：类型/缺失/唯一值/Top/均值/中位数/标准差，>6 万行等距抽样）+ `query_features`（≤5 行、字段白名单）。**绝不把整份 properties 喂给模型**。
- ⚠️ **提问意图必须拦**（`QA_INTENT`：多少/什么/怎么/哪里/？）→ 否则被天地图当 POI，只回「已定位」。
- ⚠️ **窄屏浮层**：高度 `clamp(px, dvh, px)` 且留 `vh` 兜底（地址栏收起不露白）；「点地图自动收起」走 `close({keepRequest:true})` —— **绝不中断在途请求**。判定 `(max-width:760px),(max-height:520px)`，宽屏不收起。
- **地名 `ogv-geocode.js`（`OGVGeo`）/ 联网 `ogv-websearch.js`（`OGVWeb`）**：全站唯一出口 + LRU + **永不 reject**。
- ⚠️ 天地图 `mapBound` 须钳 ±180/±90（世界副本给 -190/380 → 400）；token 是**浏览器端权限**，curl 必报 301012。
- ⚠️ 联网**无坐标** → 只作第四级，`_locate` 回 `ok:false`+`web[]`+hint「不许说已定位」；按成功计费、QPS 5 → 缓存 + 在途合并。
- ⚠️ **要素搜索只覆盖已加载图层**（懒加载建索引）→ 搜不到 ≠ 没有；0 命中回 hint 让模型先 `toggle_layer`。
- ⚠️ **世界副本护栏 `fitBounds({animate:false})`**：动画期 `getBounds()` 是中间态（实测停 1.61/653°）；第三方定位用 `_clampWorldSpanSoon`（`moveend` 后量 + 6s 兜底）。
- `geo-config.js` 七段：①`SITE_CONFIG` ①-2`MAP_CONFIG` ①-3`BASEMAP_CONFIG` ①-4`POLAR_CONFIG` ②路径 ③`geoJsonGroups` ④`PLACE_REGISTRY`；须先于 `geojsonloader.js`/`basemap-manager.js`。
- **加图层 = 2 处**：`assets/geojson/*.geojson.gz` + ③段一条（gzip 不进 SW）。清单消费 5 处（`geojsonloader.js` 4 + `app.js:466`）；`window.geoJsonGroups ||= []` 兜底别删。
- ✅ **组内可挂小分组**：`subgroups` 可无限递归，DOM 沿用 `.layer-group`。⚠️ 假设只有一层的老逻辑要逐级向上改（`closest()` 只给最近一层）：`expandToLayerGroup`、`updateLayerItemStatus`、Ctrl+点判据、`getLayerPopupConfig`；搜索按完整路径注册。
- ⚠️ **map 引用三类**：`geojsonloader.js` 用全局 `map`（跟随）；`basemap-manager.js:21`/`feature-panel.js:11` 是**加载期快照** → 换实例必须 rebind；`app.js:548/605/618` 函数内读，安全。
- ⚠️ **`map.getBounds()` 不可信**（不 wrap；极地退化成零高度线）→ 视口裁剪**一律像素坐标**。

## 2 视觉配置硬规则
- ⚠️ **点尺寸真旋钮 = `iconSize`(默认 20)**，非 `radius`（`style`/`radius` 死代码；Canvas 写死 `MarkersCanvas.js:391`=8）。带标签时按**直径**算（`*2` → 20px 变 40px）。
- `SITE_CONFIG` 三字段全 null = 零介入。`brandColor` 只注入 `--c-green/-hover/--c-statusbar`，**绝不碰 `--c-green-text-strong`**；`brandColorDark` 空 → 对白提亮 35%。
- ⚠️ **注入 `:root` 变量须抬优先级**（本文件早于 main.css）：`:root:root` / `:root[data-theme="dark"]`；只浅色用 `:root:not([data-theme="dark"])`；**别用 `documentElement.style`**。
- 配置外置 ≠ 热更新（同域被 SW 预缓存）；真热更新走跨域绝对 URL（跨域不进 SW → 离线取不到）。
- **无级缩放**：`MAP_CONFIG.zoomSnap:0`；读值用 `_mapOpt(k,d)`（判 `!= null`）——**`||` 会把 0 弹成 1**。

## 3 出图（`map-export*.js`）— 细则见 §J / §M / §P / **§Q**
- **尺寸 = 纸面 mm + dpi，zoom 引擎反算**（不许填像素，填 px 只是拉伸瓦片）⇒ **不变量：出图范围 == 屏幕视野**。
- ⚠️ **坐标系只能一套**（画布坐标 = 瓦片像素 × S）；**验收锚点 `report.frame ≈ map.getBounds()`**，改坐标必跑。
- **预览必须与成品同源**（走 `resolveOpts()`）；跟随源 = `moveend/zoomend` + 底图切换 + `layeradd/remove` + 面板 checkbox（捕获阶段），一律静默防抖。
- ⚠️ **`b.getNorth()` 是数字不是 LatLng**：`.getNorth().lat` → NaN → `drawImage` **静默不画**而 `ok` 仍是 1（ETOPO 全白）。**坐标出 NaN 先查这类 `.lat`**。
- ⚠️ **论文级图廓**：`PAD` + 内容区 `VW×VH` 与纸面 `W×H` **分离**；`zoom` 反算 / `shiftX·Y` / `scaleFactor` **全用 VW·VH**；留白按 **pt** 且受 `标注字号×3.2` 约束；**装饰字号走有效 dpi**（`ptPx = 画布宽 ÷ 纸宽英寸 ÷ 72`）；**纬度标注遍历南→北，间距判据必须 `Math.abs`**。
- ⚠️ **点要素「和看到的不一样」三个根因**（已修 2026-10-27）：① 只认 `<svg>/<img>` → `.station-dot` 掉进 3px 红点兜底；② 只按 `L.Marker` 对象收 → 藏在 `WorldCopyGroup`/`markerClusterGroup` 里的收不到；③ Canvas 点层自套规则（拉伸 iconSize²、兜底 `iconSize/2`、永不聚类）。**正解 = 抄屏幕**：DOM 点扫 `markerPane` 真实元素，Canvas 点直接用 `layer._lastClusters`；兜底圆半径 = 屏幕的 8。
- **模板/样式**：`TEMPLATES` + `STYLE_ENUM` + `resolveStyle()`（`paper/report/slide/field` × 指北针/图例/格网/图框）。新增样式 = 枚举加值 + `draw*` 加分支，**不为模板写单独绘制代码**；模板只给「未显式指定」的项兜底。

## 4 配色 / 布局（WCAG）
- 选中态边框/焦点环**不能用 `--accent`**(1.58:1) → 用 `--c-green-text-strong`(浅 4.84/深 8.06)。开关可用 `--accent`（滑块位移是非颜色线索）。
- 绿字一律 `--c-green-text-strong`(#3a743a)；绿底配深字(#1a1a2e, 9.3:1)；深色下 `--c-green-text`=#88cc88。待定：`--c-text-dim` 未达 AA。
- `.is-on` 与 `:has()` 必须拆两条规则（含无效项整条丢弃）。
- **滚动条懒预留**：`scroll-gutter-guard.js` 首次真溢出才打 `data-scroll-guttered`；新增容器要加进其 `SELECTOR`。
- `.dialog-body` 上限 `min(600px, calc(100vh - 140px))`；只写 `overflow-x:auto` 会让 `overflow-y` 变 auto → 不纵滚元素显式 `overflow-y:hidden`。

## 5 Markdown 弹窗（`dialog.js`）
- `marked` 不重写路径 → `resolveRelativeImages(root, docUrl)` 按**文档自身目录**补前缀。大图点击切 `.md-zoom`；**别把尺寸悬殊的图放同一表格**。
- ⚠️ `overflow:hidden` 的盒子 `scrollLeft` 仍可被改写 → 判据看 `overflow-x` 是否真变 `auto`。

## 6 引擎内部细节 → 全部见 `INTERNALS.md` §A~§E
- 只记三条最容易忘的：形状名 `Line`（不是 Polyline）；`L.Circle` 只能 `instanceof`；面上色须 `color`+`colorMode:"single"`。另：`GzIdbLoader.setCache` 必须 await。

## 7 Git / 发布 / 存储 / 同步
- **git 由用户自己执行**。远程 `github.com/TigerHall/gis.git`，主分支 `main`。线上 `dupal.cn`；`wzhky.com` 是**另一个项目**。
- **版本号唯一真源 = `service-worker.js` 的 `CACHE_NAME`**。改这行即触发更新弹窗 + 缓存重建；普通刷新可能仍拿旧文件 → **须再 bump 一次**。`.gitignore` 只忽略 `/CNAME` 与 `.workbuddy/artifacts/`；`app.js` 读 `docs/CHANGELOG.md`。
- **storage 全走 `window.OGVStorage`**（`geo-utils.js`）：`KEY.*` / `safeGet·Set` / `getBool·Num` / **`getJSON`（解析失败即删键，自愈关键）** / `keysWithPrefix` / `clearResettable·clearApp`。**绝不用 `localStorage.clear()`** → `clearResettable()`（保留 `ogv_premium_active`/`dupal_user_layer*`）；遍历**先快照 key 数组再删**。
- ⚠️ **`dupal_layer_` 是 `dupal_layer_set_` 的前缀**（三处误吃）→ 须显式排除。底图记忆唯一真源 `savedOverlayNames`；**恢复写在 `rebuildLayerCtrl()` 里**。
- **跨标签同步**：「值归属」与「副作用是否重放」是两件事。`SYNC_BLOCK` = `view3d`/`isLocationTracking`/`premium` → 不同步、只认存储；其余纯视觉开关立即同步。同步只改 `cb.checked` + 调 enable/disable，**绝不回写存储**。

## 8 面板细节
- `hidden:true` 跳过渲染但保数据；整组 hidden 不生成空 `<details>`。
- **快捷区 = 面板设置的快捷方式，不是第二份设置**：状态唯一来源是面板 `<input type=checkbox id>`；快捷项 `<button data-quick-for>` 转发 `master.checked=!checked` + `dispatchEvent("change")`。**快捷区绝不能持有同 id 元素**。`_syncQuickStates()` 须可重入；徽标 `requestSubBadges()`（幂等+rAF），兜底 `body` 捕获阶段监听 `toggle`。
- **新增设置项 = `TOGGLE_GROUPS` 一条 + `toggleConfig` 一条**（`#toggleBody` 的 checkbox 是唯一主控件，带 id 才被 `initToggle` 注册）。⚠️ `app.js` 早于 `ai-chat.js`/`map-export-ui.js` → enable/disable 里访问它们必须容错。
- 开关状态若不来自存储而来自外部事实（如 PWA 已装）→ `toggleConfig` 给 `truth()`+`syncStatus(on)`，`initToggle` 跳过 `getBool`、存储只写镜像。见 §O。
- ⚠️ **`initToggle` 的恢复循环是串行的**：任一 `enable()/disable()` 抛错，**后面所有开关都不初始化**（症状：面板一半开关失灵）。碰未就绪插件必判空（`L.control.legend` / `map.pm` 已踩过）。
- **PWA `assets/pwa-install.js`**：**没装就每次进入都提醒**；`isInstalled()` = `standalone` ∥ `appinstalled` ∥ `installedAt` ∥ `getInstalledRelatedApps()`。「以后再说」/✕/Esc = **只压本次页面**；「不再提示」永久且 `prompt()` 也受约束，但 `install()` **不受限**。只有真拿到 `beforeinstallprompt` 才 `prompt()`。细节 §J-6/§O。
- 「测试中」徽标：`.ogv-ai-beta` / `.mep-beta`（浅 `#8a6210` 5.3:1，深 `#e0b355`）。

## 9 本机工具链坑（完整见 `INTERNALS.md` §I）
- Bash 工具 PATH 为空 → 前加 `export PATH="/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH"`。Node `…/node/versions/22.22.2-6/node.exe`；脚本放 `.workbuddy/artifacts/` 且首行 `module.paths.push("…/node/workspace/node_modules")`。
- ⚠️ 只有 **`playwright-core`** → 必须 `executablePath:"…/chrome.exe"`；侧栏默认折叠 → 截图/搜索前先展开（`page.fill("#searchInput",q)`）。本地服务用 `python -m http.server` 且**必须 `run_in_background`**（`&` 起在子 shell 会被回收）。
- ⚠️ 测试假阴性已 8 例（transition 中间值 / `--hide-scrollbars` / `typeof btn.onclick` / case 间不复位 / 错的 `instanceof` / 旧 map 引用 / 动画中途量 `getBounds()` / **strict 下未声明变量的静默路径**）。

## 10 极地视图 / 极冠环
- 极地 = **第二张独立的 `L.Proj.CRS` map**（北极 3413 / 南极 3031），主 map 不动；默认底图 GIBS。契约见 §F。
- ⚠️ **`fixAntimeridian` 绝不能作用于极冠环**（`|lat| ≥ 87`，`POLAR_RING_LAT=87` 短路）：展开后环改走横贯地图的弦 → 非零环绕自我抵消 → 极冠整块消失。
- ⚠️ **判「面是否覆盖某点」只有两条可信路径**：`path.isPointInFill()`（每次采样前重取 CTM）与离线**非零环绕**复算。`Polyline._containsPoint` 是到边距离、正则取 `d` 会把子路径说平——两者都骗过我。
- 极地版权条：`POLAR_CONFIG.showAttribution`（默认 false）。

## 11 底图控件「无底图」
- `BASEMAP_CONFIG.noneLabel`（默认 `"无底图"`）= **伪底图**：空 `L.layerGroup([])` 混进 `allBaseLayers`，**靠「底图区单选」自动卸掉上一张**；在过滤**之后**追加 → 恒在末尾。
- 状态外显 = `body.basemap-none`（`syncNoneState()`）→ `main.css` 把 `#map` 背景换成 `--c-bg`。3D 靠导出的 `noneName` 识别。⚠️ 验收「无底图下仍有瓦片 `<img>`」先查**覆盖层**。

## 12 投点 / 点集转线转面（`pointdrop.js`）
- **转线/转面**：分组字段（**可多选**，按组合值分线/面）+ 排序字段（含「# 表格行序」）+ 降序 + 闭合线 → **一次只出一个图层，图层里可含多条线/多个面**。线 ≥2 点、面 ≥3 点（不足的分组跳过并报数）；面自动补首点闭合，线按勾选补。属性 = 分组字段 + `Name`（用组值当标签）+ `点数`，线加 `长度_km`、面加 `面积_km²`（与 `calculatePolygonArea` 同源）。排序用 `localeCompare(...,{numeric:true})`（`A2 < A10`）。
- ⚠️ **`onPasteInput` 二次解析会清空字段**：它挂在 textarea 的 `input` 上，解析完又把提示文字**回写进同一个 textarea** → 用户再敲一个字就拿提示文字重解析，`pointDropCols` 被改成 `[]`（数据行还在、列全丢；症状：分组明明选了字段却全归一组）。修法：**先切出数据行，确认有行再动 `pointDropCols`**。凡「把提示写回被监听的输入框」都按这个顺序。
