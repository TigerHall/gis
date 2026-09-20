# OGV 长期记忆（索引 + 硬规则）
> 只留「会反复踩的规则」。细节在同目录 `INTERNALS.md`（A 测量绘制 / B 2D+世界副本 / C 弹窗 / D Cesium 3D / E 数据渲染通用坑 / F 极地视图与图源 / G 底图管理）。
> 修复过程见 daily log。

## 0 定调
- 定制最小单位 = **一整份 `geo-config.js`**（标题+主题色+路径+图层清单+地名表）。
- ⛔ 不加第二份配置文件；外置/远程配置只换**这份文件的来源**。
- ⛔ 引擎禁硬编码站点/图层级设定（`fileName === "xxx.geojson"` 已清零）。
- ✅ 能改配置 → 只改配置；必须改引擎 → **同时补一个配置字段**；新能力先问「能不能是字段」。

## 1 架构
- `geo-config.js` 七段：①`SITE_CONFIG` ①-2`MAP_CONFIG` ①-3`BASEMAP_CONFIG` ①-4`POLAR_CONFIG` ②路径 ③`window.geoJsonGroups` ④`PLACE_REGISTRY`；须先于 `geojsonloader.js`/`basemap-manager.js` 加载。字段清单与消费点见 INTERNALS。
- **加图层 = 2 处**：`assets/geojson/*.geojson.gz` + ③段加一条。gzip 走运行时缓存、**不进 SW `STATIC_ASSETS`** → 不动 HTML/SW。清单消费 5 处：`geojsonloader.js:3152/1449/1452/3091/3248`、`app.js:466`；`window.geoJsonGroups ||= []` 兜底别删。
- ⚠️ **map 引用三类**：`geojsonloader.js` 用全局 `map`（`waitForMap` 判 `typeof map` → 换 `window.map` 自动跟随）；`basemap-manager.js:21`/`feature-panel.js:11` 是**加载期快照** `var map = window.map` → 换实例**必须 rebind**；`app.js:548/605/618` 函数内读，安全。
- ⚠️ **`map.getBounds()` 不可信**（主视图不 wrap；极地下退化成零高度线）→ 视口裁剪**一律用像素坐标**。

## 2 视觉配置硬规则
- ⚠️ **点尺寸真旋钮 = `iconSize`(默认 20)，非 `radius`**（点走 `createPointMarkerByType()` 图标标记，`style`/`radius` 死代码；Canvas 写死 `MarkersCanvas.js:391`=8）。带标签时按**直径**算（写 `*2` → 20px 变 40px）。
- `SITE_CONFIG` 三字段全 null = 零介入。`brandColor` 只注入 `--c-green/-hover/--c-statusbar`，**绝不碰 `--c-green-text-strong`**；`brandColorDark` 空 → 对白提亮 35%。
- ⚠️ **注入 `:root` 变量须抬优先级**（本文件早于 main.css）：`:root:root` / `:root[data-theme="dark"]`；只浅色用 `:root:not([data-theme="dark"])`；**别用 `documentElement.style`**。
- 配置外置 ≠ 热更新：同域文件被 SW 预缓存；真热更新走跨域绝对 URL（跨域不进 SW → 离线取不到）。
- **无级缩放**：`MAP_CONFIG` 给 `zoomSnap:0`；读值用 `_mapOpt(k,d)`（判 `!= null`）——**`||` 会把 0 弹成 1**。鼠标位置控件的缩放读数**保留 1 位小数**。

## 3 配色 / 布局（WCAG）
- 选中态边框/焦点环**不能用 `--accent`**(1.58:1) → 用 `--c-green-text-strong`(浅 4.84 / 深 8.06)。开关可用 `--accent`（有滑块位移这个非颜色线索）。
- 绿字一律 `--c-green-text-strong`(#3a743a)；绿底配深字(#1a1a2e, 9.3:1)。深色下 = `--c-green-text` = #88cc88。待定：`--c-text-dim` #999/#777 未达 AA。
- `.is-on` 与 `:has()` 必须拆两条规则（列表含无效项整条丢弃）。
- **滚动条懒预留**：`scroll-gutter-guard.js` 容器**首次真溢出**才打 `data-scroll-guttered` 并常驻；CSS 只写 `[data-scroll-guttered]{scrollbar-gutter:stable}`。新增容器 → 加进其 `SELECTOR`。
- `.dialog-body` 上限扣头部：`min(600px, calc(100vh - 140px))`。只写 `overflow-x:auto` 会让 `overflow-y` 变 `auto`（审计误判）→ 不纵滚元素显式 `overflow-y:hidden`。

## 4 Markdown 弹窗（`dialog.js` showMarkdown）
- `marked` 不做路径重写 → `resolveRelativeImages(root, docUrl)` 按**文档自身目录**补前缀。
- ⚠️ `overflow:hidden` 的盒子 `scrollLeft` 仍可被脚本改写 → 判据看 `overflow-x` 是否真变 `auto`。大图点击切 `.md-zoom`；**别把尺寸悬殊的图放同一表格**。

## 5 引擎内部细节 → `INTERNALS.md`
- **A 测量/绘制**：形状名 `Line`；圆两点定圆心/半径；测量屏蔽点选**必须堵 DOM + Canvas 两条路径**；`L.Circle` 只能 `instanceof` 判；Geoman 键盘收尾两开关。
- **B 2D 渲染**：世界副本在渲染层（数据只 1 份、坐标恒 -180~180、极地自动关环绕）；pane 层级；面上色须 `color` + `colorMode:"single"`；`dupal_layer_set_` 会盖配置。
- **C 弹窗**：`.popup-ext-btn` 不挂 onclick（走 `document` 委托）；开窗用 `openFeaturePopup()`；`openOn` 同步触发 `popupopen`。
- **D Cesium 3D**：`CLAMP_TO_GROUND` 是卡顿元凶；Z 须压平；`cos(lat)` 极地必崩 → 用 `map.getScale()`。⚠️ **南北极「空洞」是地形覆盖不到极点（默认地形也是 Web Mercator ±85.05），垫影像无效甚至会破坏基底层兜底** → 已决定不做（注释在 `cesium-viewer.js` syncBasemap 上方）。⚠️ 验收 3D 底图**别用「停用→再启用」序列**（该路径基底层会缺），要在 3D 激活时切 2D 底图。
- **E 通用坑**：属性值一律纯文本（收口 `buildPopupContent`）；TDZ；GzIdbLoader `setCache` 必须 await。

## 6 Git / 发布 / 存储 / 同步
- **git 操作由用户自己执行**。远程 `github.com/TigerHall/gis.git`，主分支 `main`。
- **版本号唯一真源 = `service-worker.js` 的 `CACHE_NAME`**（`app.js` 运行时发 `GET_VERSION`）。改这行即触发更新弹窗 + 缓存重建；浏览器已缓存上一版时普通刷新仍拿旧文件 → **须再 bump 一次**。
- 线上域名 `dupal.cn`；`wzhky.com` 是**另一个项目**。`.gitignore` 只忽略 `/CNAME` 与 `.workbuddy/artifacts/`；`docs/shots/` 应入库。`app.js` 读 `docs/CHANGELOG.md` 渲染「更新记录」。
- **所有 storage 走 `window.OGVStorage`**（`geo-utils.js`，早于所有业务模块）：`KEY.*` / `safeGet·safeSet·safeRemove` / `getBool·getNum` / **`getJSON`（解析失败即删键 + 兜底）** / `keysWithPrefix·removeAll·pruneOrphans` / `clearResettable·clearApp`。**`getJSON` 删键是自愈关键**：坏值不清掉，「读-改-写」永远失败。
- **绝不用 `localStorage.clear()`** → `clearResettable()`（保留 `ogv_premium_active`/`dupal_user_layers`/`dupal_user_layer_*`）。遍历 localStorage **先快照 key 数组再删**。
- ⚠️ **`dupal_layer_` 是 `dupal_layer_set_` 的前缀**（`hasSavedLayerState`/`clearAllLayerStates`/记住图层清理三处误吃过）→ 须显式排除。底图/覆盖层记忆唯一真源 `savedOverlayNames`；**恢复必须写在 `rebuildLayerCtrl()` 里**。
- **跨标签同步**：「值归属」与「副作用是否重放」是两件事。`SYNC_BLOCK` 黑名单 `view3d`/`isLocationTracking`/`premium` → 不同步、只认存储值；其余纯视觉开关立即同步。同步只改 `cb.checked` + 直接调 enable/disable，**绝不回写存储**。

## 7 面板细节
- `hidden:true`(group/layer) 跳过渲染但保数据；整组 hidden 不生成空 `<details>`。
- **快捷区 = 面板设置的快捷键，不是第二份设置**：状态唯一来源是面板 `<input type=checkbox id>`；快捷项 `<button data-quick-for aria-pressed>` 转发 `master.checked=!checked` + `dispatchEvent("change")`；反向靠 document change 委托。**快捷区绝不能持有同 id 元素**。
- `clusterToggle`/`labelToggle` 不在 `toggleConfig`、恢复更晚 → `window._syncQuickStates()` 须可重入（渲染②后 + load 各跑一次）。「已开/总数」徽标走 `requestSubBadges()`（幂等 + rAF 合并），兜底 `body.addEventListener("toggle",fn,true)`（details 不冒泡但走捕获）。快捷项手感：`:active` 置 `transition-duration:0s` + `scale(.94)`；`touch-action:manipulation`。

## 8 本机工具链坑
- **Bash 工具 PATH 为空** → 前加 `export PATH="/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/bin:$PATH"`。
- Node 绝对路径 `"C:/Users/hehu/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"`。Playwright 脚本放 `.workbuddy/artifacts/`，头 `module.paths.push("C:/Users/hehu/.workbuddy/binaries/node/workspace/node_modules")`。
- **`getComputedStyle` 返回 transition 中间值** → 判样式前 `await 400ms`。**Playwright 默认 `--hide-scrollbars`** → 量宽度假阴性，须 `ignoreDefaultArgs`。`page.evaluate(fn,arg)` 只序列化 `fn`：内嵌 helper 必须定义在同一函数体内。
- minified 单行文件别硬 grep → `node -e` 截 `s.slice(indexOf(k), +500)`；grep 的 `\{n\}` 在 Git Bash 报错。**SVG 元素没有 `.click()`** → `page.mouse.click(x,y)` 或 `dispatchEvent(new MouseEvent("click",{bubbles:true}))`。
- 测试假阴性已踩 6 例：① transition 中间值 ② `--hide-scrollbars` ③ `typeof btn.onclick` 判委托按钮 ④ case 间状态不复位 ⑤ 错误的 `instanceof` 组合筛图层 ⑥ 用旧 map 引用断言新 map。

## 9 极地视图 / 极冠环
- 极地视图 = **第二张独立的 `L.Proj.CRS` map**（北极 EPSG:3413 / 南极 EPSG:3031 极球面立体），主 `EPSG:3857` map 完全不动 → 不存在「一个 layer 被两张图抢」；数据按面板勾选 + `window._featureCache` 重建一份，默认底图 **GIBS**。全部坑（resolutions 契约 / 不给瓦片设 bounds / `getBounds` 退化 / 投影坐标钳制 / 矢量清洗）见 `INTERNALS.md` §F。
- ⚠️ **`fixAntimeridian` 不能作用于「极冠环」**（含 `|lat| ≥ 87` 顶点的环）：极冠环是沿 ±180° 切开、靠一段横躺在极点上的顶点闭合的；Mercator 把那段钳到 ±85.051 后会**正好躺在世界上下边上**，环就着地图边闭合。一旦展开，该段被折算成 290°→-70°、折叠成零面积尖刺，环改走**横贯地图的弦**闭合 → 非零环绕自我抵消 → **极冠整块消失**（症状：北极顶横贯纯色平板带、南极冠无填充）。`fixRingCoords` 已加 `POLAR_RING_LAT = 87` 短路。详见 `INTERNALS.md` §F。
- ⚠️ **判定「面是否覆盖某点」只有两条可信路径**：浏览器 `path.isPointInFill()`（配 `svg.getScreenCTM().inverse()`，**每次采样前重取 CTM**）与离线**非零环绕**复算。`Polyline._containsPoint` 是**到边距离**判定，`d` 属性正则取点会把各子路径**说平成一串**（跨子路径产生假弦）——两者都骗过我一次。
- **极地视图版权条**：`POLAR_CONFIG.showAttribution`（默认 `false`）→ `attributionControl: !!cfg.showAttribution`。

## 10 底图控件「无底图」
- `BASEMAP_CONFIG.noneLabel`（默认 `"无底图"`，空串=隐藏）= **伪底图**：一个空 `L.layerGroup([])` 混进 `allBaseLayers`，**靠「底图区是单选」自动卸掉上一张底图**，不手动遍历；位置在 `getVisibleBaseLayers()` 过滤**之后**追加 → 恒在末尾。
- 状态外显 = `body.basemap-none`（`syncNoneState()`；`rebuildLayerCtrl()` + `baselayerchange` 各一次）→ `main.css` 把 `#map` 背景从 Leaflet 默认 `#ddd` 换成 `--c-bg`。3D 靠导出的 `noneName` 识别 → 不铺影像。
- ⚠️ 验收时「无底图下仍有瓦片 `<img>`」先查**覆盖层**（用户勾选的，本就该留）；要归零的是底图瓦片。
