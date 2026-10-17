# OGV 长期记忆（索引 + 硬规则）
> 只留「会反复踩的规则」。细节见同目录 `INTERNALS.md`（A 测量绘制 / B 2D+世界副本 / C 弹窗 / D Cesium 3D / E 通用坑 / F 极地视图与图源 / G 底图管理）。修复过程见 daily log。

## 0 定调
- 定制最小单位 = **一整份 `geo-config.js`**（标题+主题色+路径+图层清单+地名表）。⛔ 不加第二份配置；外置只换**这份文件的来源**。
- ⛔ 引擎禁硬编码站点/图层级设定。✅ 能改配置 → 只改配置；必须改引擎 → **同时补一个配置字段**。
- ⭐ **首要参考平台 = [GeoLibre](https://github.com/opengeos/GeoLibre)**：加/改功能先看它的实现与取舍。见 `docs/REFERENCES.md`。

## 1 架构
- **AI = `assets/ai-chat.js`**（`window.OGVAI`）：本地直通（`__OGV_search`）→ `PLACE_REGISTRY` → 天地图 → **联网** → 模型 tool-calling（≤8 轮、非流式、工具串行；触顶再来一轮 `noTools` 收尾）。出图走 `MapExport.applyOptions`/`exportNow`/`resolveOpts`。
  - 入口 = 右下角 **`L.Control` 悬浮球**（在图层控件上方，`aiFabToggle` 可关）+ **Ctrl/⌘+K**（`Ctrl+E`/`Ctrl+F` 已占）；模型 `deepseek-flash` = **V4.1-Flash-1017**（`deepseek-chat` 是旧名，能跑但不稳），`OGV_AI_MODEL` 可覆盖。
  - 输入框两颗 pill = 运行开关（`_opt.web/think` → `ogv_ai_web_search`/`ogv_ai_thinking`）：关联网 = 工具集剔除 `web_*` 且不自动联网；关思考 = `thinking:{type:"disabled"}`。⚠️ `getBool` 只认 `"true"`，写 `"1"` 会被 `open()` 读回 false（症状：点了像没生效）。
  - 历史对话 = `ogv-chatstore.js`（IDB `ogv-ai/sessions`，永不 reject，不可用降级 localStorage）；`☰` 抽屉分组；400ms 防抖 + 关窗/切后台立即 flush；旧 `ogv_ai_sessions` 自动迁移。
  - ⚠️ 开思考时每轮须回传 `reasoning_content`（`messages.push(msg)` 整条入栈即成立，真 API 已验）。
  - ⚠️ **提问意图必须拦**（`QA_INTENT`：多少/什么/怎么/哪里/？…）→ 否则「最大深度多少」被天地图当 POI 命中，只回「已定位」。
- **地名 = `ogv-geocode.js`（`OGVGeo`）**、**联网 = `ogv-websearch.js`（`OGVWeb`）**：全站唯一出口 + LRU + **永不 reject**。
  - ⚠️ 天地图 `mapBound` 须钳 ±180/±90（世界副本态给 -190/380 → 400）；token 是**浏览器端权限**，curl 必报 301012。
  - ⚠️ 联网**无坐标** → 只作第四级，`_locate` 回 `ok:false`+`web[]`+hint「不许说已定位」；按成功计费、QPS 5 → 缓存 + 在途合并。
- ⚠️ **要素搜索只覆盖已加载过的图层**（懒加载建索引）→ 搜不到 ≠ 没有；0 命中回 hint 让模型先 `toggle_layer`。
- ⚠️ **世界副本护栏必须 `fitBounds({animate:false})`**：动画期 `getBounds()` 是中间态（实测停在 1.61/653°）。第三方定位用 `_clampWorldSpanSoon`（`moveend` 后再量 + 6s 兜底）。
- `geo-config.js` 七段：①`SITE_CONFIG` ①-2`MAP_CONFIG` ①-3`BASEMAP_CONFIG` ①-4`POLAR_CONFIG` ②路径 ③`window.geoJsonGroups` ④`PLACE_REGISTRY`；须先于 `geojsonloader.js`/`basemap-manager.js`。
- **加图层 = 2 处**：`assets/geojson/*.geojson.gz` + ③段一条。gzip 走运行时缓存、**不进 SW** → 不动 HTML/SW。清单消费 5 处（`geojsonloader.js` 4 + `app.js:466`）；`window.geoJsonGroups ||= []` 兜底别删。
- ✅ **组内可挂小分组**：`group.subgroups=[{groupName,hidden?,layers?,subgroups?}]`，可无限递归。DOM 沿用 `.layer-group` 等 → 后代选择器天然覆盖。⚠️ 假设只有一层的老逻辑要逐级向上改（`closest()` 只给最近一层）：`expandToLayerGroup`、`updateLayerItemStatus`、Ctrl+点判据（`:not(.layer-subgroup)`）、`getLayerPopupConfig`。搜索按完整路径注册。
- ⚠️ **map 引用三类**：`geojsonloader.js` 用全局 `map`（自动跟随）；`basemap-manager.js:21`/`feature-panel.js:11` 是**加载期快照** → 换实例必须 rebind；`app.js:548/605/618` 函数内读，安全。
- ⚠️ **`map.getBounds()` 不可信**（不 wrap；极地退化成零高度线）→ 视口裁剪**一律像素坐标**。

## 2 视觉配置硬规则
- ⚠️ **点尺寸真旋钮 = `iconSize`(默认 20)，非 `radius`**（`style`/`radius` 死代码；Canvas 写死 `MarkersCanvas.js:391`=8）。带标签时按**直径**算（写 `*2` → 20px 变 40px）。
- `SITE_CONFIG` 三字段全 null = 零介入。`brandColor` 只注入 `--c-green/-hover/--c-statusbar`，**绝不碰 `--c-green-text-strong`**；`brandColorDark` 空 → 对白提亮 35%。
- ⚠️ **注入 `:root` 变量须抬优先级**（本文件早于 main.css）：`:root:root` / `:root[data-theme="dark"]`；只浅色用 `:root:not([data-theme="dark"])`；**别用 `documentElement.style`**。
- 配置外置 ≠ 热更新（同域被 SW 预缓存）；真热更新走跨域绝对 URL（跨域不进 SW → 离线取不到）。
- **无级缩放**：`MAP_CONFIG.zoomSnap:0`；读值用 `_mapOpt(k,d)`（判 `!= null`）——**`||` 会把 0 弹成 1**。

## 2-出图 出图引擎（`map-export*.js`）
- **尺寸 = 纸面 mm + dpi，zoom 由引擎反算**：`zoomNeeded = zoomNow + log2(目标px/屏宽)` → `zoomTile=floor()`、`S=2^(need-tile)`。⚠️ 不许填像素（填 px 只是拉伸瓦片）。⇒ **不变量：出图范围 == 屏幕视野**。
- ⚠️ **坐标系只能有一套**：`画布坐标 = 瓦片像素 × S`（`project()` 不含 S 与 `drawXYZ` 含 S 混用只在 S===1 时碰巧对）。同源：`metersPerPx ÷S`、`scaleFactor = W/屏宽`。
- **验收锚点**：`report.frame` 必须 ≈ `map.getBounds()`；改坐标代码必跑此断言。
- **预览实时跟随**四类源：`moveend/zoomend`、`baselayerchange/overlay*`、**`layeradd/layerremove`**（懒加载真完成）、面板 checkbox 的 `change`（**捕获阶段**）。一律静默防抖。
- **dpi**：默认 **300**，档位 96/150/300/600/**1200** + 自定义 30~2400；画布上限 **单边 16384 / 面积 160M**，超限**等比**压并写出实际 dpi（分别夹宽高会变形）。
- ⚠️ **`b.getNorth()` 返回数字不是 LatLng**：`.getNorth().lat`→`NaN`→`drawImage` **静默不画**而 `ok` 仍是 1（ETOPO 全白）。**坐标出 NaN 先查这类 `.lat`**。
- **预览必须与成品同源**：走 `MapExport.resolveOpts()`。⚠️ `preset:"a4w"` 只是 UI 概念，直接喂 `render()` 会被忽略 → 预览≠成品。
- **底图失败不许静默**：全失败 / ≥30% / `skipped` / 影像失败，四类都进 `report.warnings`。
- **跨180°环绕** = 反环绕（逐点选最近的 ±360° 副本）+ 按 k×worldW 平移多副本。**底图识别**认 `baseLayers` ∩ 实际挂着的图层；⚠️ `ArcGIS-海洋` 是 LayerGroup 且 `ibo_w` 排第一 → 先剔除 `overlays/moreOverlays`。
- **WMS** 自己拼 GetMap，**`srs` 必须与 bbox 单位一致**（度→4326；写 3857 得空白图而 `loadImage` 仍「成功」）。GEBCO 20~54s → 超时 120s + 屏幕瓦片回退。
- **`L.Polygon extends L.Polyline`** → 判面先判 Polygon；多环**同一 path 再 `fill("evenodd")`**；`_isHitLayer` 排除。**`dashArray` 是字符串** → `setLineDash` 前归一。**经纬网**照搬 `Leaflet.Graticule.js` 间隔但按**屏幕 zoom** 取、**不走 `project()`**。
- **点图标复刻屏幕 DOM**：`createImageBitmap` **不支持 SVG** → 走 `<img>`；点必须在**面/线后**画；>3000 点走 `L.MarkersCanvas`。
- **要素标签读 DOM**（`.station-label:not(.hidden)`+`.leaflet-tooltip`）按 `k=W/屏宽` 映射（低缩放时标签被隐藏）。标签要**矩形避让**。
- **构图护栏**：`maxWorlds`（默认 1）给 zoom 地板；`report.warnings` 必须说清「为什么长这样」。
- **论文级图廓**（`frame`，默认开）：`PAD` 留白 + 内容区 `VW×VH` 与纸面 `W×H` **分离**；绘制前 `translate(PAD,PAD)`+`clip`，收尾 `restore()` 后再画图框。⚠️ `zoom` 反算 / `shiftX·Y` / `scaleFactor` / `frame` **必须全用 VW·VH**（混用纸面宽 = 构图跑偏）。⚠️ 留白按 **pt** 算（`8pt×3.6`）：按「纸宽 2.6%」算时 300dpi 下 `25°N` 被裁成 `5°N`。
- ⚠️ **装饰字号走有效 dpi**：`ptPx = (画布宽 ÷ 纸宽英寸) / 72`，**不是**声明 dpi。预览同纸面但像素少（170mm@322px = 48dpi），按 300dpi 算 → 8pt 字占缩略图 10% 宽（图例盖半张图）。
- ⚠️ **纬度标注遍历是南→北（y 递减）**：间距判据必须 `Math.abs(y - lastY)`，写成 `y - lastY` 会把除第一个外的全判「太密」跳过（症状：只标一个纬度）。
- ⚠️ 别在 `state` 对象上挂方法（`Object.assign` 会覆盖）。图例/比例尺用**直角**（圆角像 App UI），字体 `FONT_SERIF`(Times→宋体) 给标注·图例·图注。

## 3 配色 / 布局（WCAG）
- 选中态边框/焦点环**不能用 `--accent`**(1.58:1) → 用 `--c-green-text-strong`(浅 4.84/深 8.06)。开关可用 `--accent`（滑块位移是非颜色线索）。
- 绿字一律 `--c-green-text-strong`(#3a743a)；绿底配深字(#1a1a2e, 9.3:1)；深色下 `--c-green-text`=#88cc88。待定：`--c-text-dim` 未达 AA。
- `.is-on` 与 `:has()` 必须拆两条规则（含无效项整条丢弃）。
- **滚动条懒预留**：`scroll-gutter-guard.js` 首次真溢出才打 `data-scroll-guttered`；新增容器要加进其 `SELECTOR`。
- `.dialog-body` 上限 `min(600px, calc(100vh - 140px))`；只写 `overflow-x:auto` 会让 `overflow-y` 变 auto → 不纵滚元素显式 `overflow-y:hidden`。

## 4 Markdown 弹窗（`dialog.js`）
- `marked` 不重写路径 → `resolveRelativeImages(root, docUrl)` 按**文档自身目录**补前缀。大图点击切 `.md-zoom`；**别把尺寸悬殊的图放同一表格**。
- ⚠️ `overflow:hidden` 的盒子 `scrollLeft` 仍可被改写 → 判据看 `overflow-x` 是否真变 `auto`。

## 5 引擎内部细节 → `INTERNALS.md`
- **A 测量**：形状名 `Line`；圆两点定圆心/半径；屏蔽点选**要堵 DOM + Canvas 两条路**；`L.Circle` 只能 `instanceof`；Geoman 键盘收尾两开关。
- **B 2D**：世界副本在渲染层（数据 1 份、坐标恒 -180~180、极地自动关环绕）；面上色须 `color`+`colorMode:"single"`；`dupal_layer_set_` 会盖配置。
- **C 弹窗**：`.popup-ext-btn` 不挂 onclick（走 `document` 委托）；开窗用 `openFeaturePopup()`。
- **D 3D**：`CLAMP_TO_GROUND` 是卡顿元凶；Z 须压平；`cos(lat)` 极地必崩 → 用 `map.getScale()`。⚠️ 极地「空洞」是地形覆盖不到极点（默认地形也 ±85.05），**已决定不做**。⚠️ 验收 3D 底图**别用「停用→再启用」**（该路径基底层会缺）。
- **E 通用**：属性值一律纯文本（收口 `buildPopupContent`）；TDZ；`GzIdbLoader.setCache` 必须 await。

## 6 Git / 发布 / 存储 / 同步
- **git 由用户自己执行**。远程 `github.com/TigerHall/gis.git`，主分支 `main`。
- **版本号唯一真源 = `service-worker.js` 的 `CACHE_NAME`**。改这行即触发更新弹窗 + 缓存重建；普通刷新可能仍拿旧文件 → **须再 bump 一次**。
- 线上 `dupal.cn`；`wzhky.com` 是**另一个项目**。`.gitignore` 只忽略 `/CNAME` 与 `.workbuddy/artifacts/`。`app.js` 读 `docs/CHANGELOG.md` 渲染更新记录。
- **storage 全走 `window.OGVStorage`**（`geo-utils.js`）：`KEY.*`/`safeGet·Set·Remove`/`getBool·Num`/**`getJSON`（解析失败即删键）**/`keysWithPrefix·removeAll·pruneOrphans`/`clearResettable·clearApp`。**`getJSON` 删键是自愈关键**。
- **绝不用 `localStorage.clear()`** → `clearResettable()`（保留 `ogv_premium_active`/`dupal_user_layer*`）。遍历 **先快照 key 数组再删**。
- ⚠️ **`dupal_layer_` 是 `dupal_layer_set_` 的前缀**（三处误吃）→ 须显式排除。底图记忆唯一真源 `savedOverlayNames`；**恢复写在 `rebuildLayerCtrl()` 里**。
- **跨标签同步**：「值归属」与「副作用是否重放」是两件事。`SYNC_BLOCK` = `view3d`/`isLocationTracking`/`premium` → 不同步、只认存储；其余纯视觉开关立即同步。同步只改 `cb.checked` + 调 enable/disable，**绝不回写存储**。

## 7 面板细节
- `hidden:true` 跳过渲染但保数据；整组 hidden 不生成空 `<details>`。
- **快捷区 = 面板设置的快捷方式，不是第二份设置**：状态唯一来源是面板 `<input type=checkbox id>`；快捷项 `<button data-quick-for aria-pressed>` 转发 `master.checked=!checked` + `dispatchEvent("change")`。**快捷区绝不能持有同 id 元素**。
- `clusterToggle`/`labelToggle` 不在 `toggleConfig`、恢复更晚 → `_syncQuickStates()` 须可重入。徽标走 `requestSubBadges()`（幂等 + rAF），兜底 `body.addEventListener("toggle",fn,true)`。快捷项手感：`:active` 置 `transition-duration:0s`+`scale(.94)`、`touch-action:manipulation`。
- **新增设置项 = `TOGGLE_GROUPS` 一条 + `toggleConfig` 一条**（`#toggleBody` 的 checkbox 是唯一主控件，带 id 才被 `initToggle` 注册）。⚠️ `app.js` 早于 `ai-chat.js`/`map-export-ui.js` → enable/disable 里访问它们必须容错。
- 开关状态若**不来自存储**而来自外部事实（是否已安装 PWA）→ `toggleConfig` 里给 `truth()`+`syncStatus(on)`，`initToggle` 跳过 `getBool`、存储只写镜像。
- ⚠️ **`initToggle` 的恢复循环是串行的**：任一 `enable()/disable()` 抛错，**后面所有开关都不初始化**（症状：面板一半开关失灵）。碰未就绪插件必判空（`L.control.legend` / `map.pm` 已踩过）。
- **PWA = `assets/pwa-install.js`**（`OGVInstall`）：**没装就每次进入都提醒**（6s；深链 2.5s；切回前台 >10min 补一次）；`isInstalled()` = `standalone` ∥ `appinstalled` ∥ `installedAt` ∥ `getInstalledRelatedApps()`。
  - 「以后再说」/✕/Esc = **只压本次页面**（内存 `_dismissedThisPage`，刷新即失效）；「**不再提示**」= `neverAsk` 永久，且 `prompt()` 里也是硬门槛。但 `install()`（设置面板主动装）**不受 neverAsk 限制**。
  - 只有真拿到 `beforeinstallprompt` 才 `prompt()`，否则给图文步骤；改主按钮属性前**先藏原来的 `later`**（反序会让「知道了」被 `display:none` 吃掉）。
  - **设置项「操作 → 安装到桌面」= 普通开关 + `cfg.truth`**：状态真值来自 `isInstalled()`，存储只当镜像；已装时 `disabled` + 徽标「已安装」。变化经 `OGVInstall.onChange` 广播（app.js 早于本文件 → 它挂 `window._syncPwaToggle`，本文件加载完回叫一次）。
- 「测试中」徽标：`.ogv-ai-beta` / `.mep-beta`（浅 `#8a6210` 5.3:1，深 `#e0b355`）。

## 8 本机工具链坑（完整见 `INTERNALS.md` §I）
- Bash 工具 PATH 为空 → 前加 `export PATH="/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:$PATH"`。Node `…/node/versions/22.22.2-6/node.exe`；脚本放 `.workbuddy/artifacts/` 且首行 `module.paths.push("…/node/workspace/node_modules")`。
- ⚠️ 只有 **`playwright-core`** → 必须 `executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"`；侧栏默认折叠 → 截图/搜索前先展开，搜索用 `page.fill("#searchInput",q)`。
- ⚠️ 测试假阴性已 8 例（transition 中间值 / `--hide-scrollbars` / `typeof btn.onclick` / case 间不复位 / 错的 `instanceof` / 旧 map 引用 / 动画中途量 `getBounds()` / **strict 下未声明变量的静默路径**）。

## 9 极地视图 / 极冠环
- 极地 = **第二张独立的 `L.Proj.CRS` map**（北极 3413 / 南极 3031），主 map 不动；默认底图 GIBS。契约见 `INTERNALS.md` §F。
- ⚠️ **`fixAntimeridian` 绝不能作用于极冠环**（含 `|lat| ≥ 87`，`POLAR_RING_LAT=87` 短路）：展开后环改走横贯地图的弦 → 非零环绕自我抵消 → 极冠整块消失（北极顶平板带、南极冠无填充）。
- ⚠️ **判「面是否覆盖某点」只有两条可信路径**：`path.isPointInFill()`（每次采样前重取 CTM）与离线**非零环绕**复算。`Polyline._containsPoint` 是到边距离、正则取 `d` 会把子路径说平——两者都骗过我。
- 极地版权条：`POLAR_CONFIG.showAttribution`（默认 false）。

## 10 底图控件「无底图」
- `BASEMAP_CONFIG.noneLabel`（默认 `"无底图"`）= **伪底图**：空 `L.layerGroup([])` 混进 `allBaseLayers`，**靠「底图区单选」自动卸掉上一张**；在过滤**之后**追加 → 恒在末尾。
- 状态外显 = `body.basemap-none`（`syncNoneState()`）→ `main.css` 把 `#map` 背景从 `#ddd` 换成 `--c-bg`。3D 靠导出的 `noneName` 识别。
- ⚠️ 验收「无底图下仍有瓦片 `<img>`」先查**覆盖层**；要归零的是底图瓦片。
