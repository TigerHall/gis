# OGV 长期记忆（精编）

> 只留「会反复踩的规则」；一次性的修复过程见 `.workbuddy/memory/YYYY-MM-DD.md`。

## 0 定调：唯一配置 = `geo-config.js`
- 定制的最小单位 = **一整份 `geo-config.js`**（标题+主题色+路径+图层清单+地名表）。
- ⛔ 不加第二份配置文件（`layers.js` 已合并删除）；外置/远程/租户配置只换**这份文件的来源**。
- ⛔ 引擎禁硬编码站点/图层级设定（`fileName === "xxx.geojson"` 已清零）。
- ✅ 口径：能改配置 → 只改配置；必须改引擎 → **同时补一个配置字段**；新能力先问「能不能是字段」。

## 1 架构
`geo-config.js` 六段：①`SITE_CONFIG`(标题/主题色/天地图token) ①-2`MAP_CONFIG`(视野/缩放/panes) ①-3`BASEMAP_CONFIG`(底图+覆盖层+3D映射) ②路径 ③`window.geoJsonGroups` ④`PLACE_REGISTRY`。须先于 `geojsonloader.js`/`basemap-manager.js` 加载。
- 图层字段：`defaultOpacity color icon iconSize colorMode/colorField labelField source selectable hidden searchPriority popup:{titleField,hideFields[],maxValueLength} cesium:{...}`
- 引擎：`geojsonloader.js`(~6100行) `app.js`(版本/导出/SW/toggle) `geo-utils.js`(纯函数) `measure-export.js` `measure-tools.js` `basemap-manager.js` `feature-panel.js` `dialog.js`
- **加底图=1处**：`baseLayers` 加一条(含 cesium)，不改 HTML/引擎。**加图层=2处**：① `.geojson.gz` 放 `assets/geojson/` ② ③段加一条；不改 HTML/SW（gz 走 SW 运行时缓存，不在 `STATIC_ASSETS`）。
- 清单消费 5 处：`geojsonloader.js:3152`(同步 forEach 建 DOM)、1449/1452/3091/3248、`app.js:466`；`window.geoJsonGroups ||= []` 兜底别删。
- 渲染：整组 hidden 跳过；`groupName:null` 平铺组无 `<details>`；单图层 hidden 不渲染。
- 底图引擎 `basemap-manager.js`：`kind` = `tianditu`/`arcgis`/`wms`/`tile`/`imageWorldCopy`/`wayback`/`esriFeature`；通用 `options` `maxZoom/maxNativeZoom/minNativeZoom/opacity/pane` `attribution` `attachBoundary` `cesium:{...}`；工厂 `tdt() arcgis() gebco() etopo() esriIsland()`。
  - ⚠️ `ref` 判断须在 `kind` 校验**之前**；`findDescriptor()` 要顺 `ref` 取 `cesium`。3D 只调 `createImageryProvider()`/`createOverlayImageryProvider()`。
  - 唯一硬编码 = 兜底 ArcGIS World_Imagery（配置空/语法坏/默认不存在/3D 无 cesium）→ 宁退影像不白屏。
  - ⚠️「天地图全球境界」与 `attachBoundary` **共用同一实例 = 刻意**（该复选框即国界显隐开关），别当 bug 修。token 在 `SITE_CONFIG.tiandituToken` → `window.TDT_TK`。

## 2 视觉配置硬规则
- ⚠️ **点要素尺寸真旋钮 = `iconSize`(默认20)，非 `radius`**：点图层走 `L.GeoMarker.createPointMarkerByType()` 图标标记，Leaflet `style` 对 marker 无效 → `radius` 死代码（Canvas 亦写死 `MarkersCanvas.js:391`=8）。
- ⚠️ 带标签的点标记也按**直径**算：`GeoMarker.createLabeledMarker` 的 `d` 取 `iconSize` 原值；写 `(iconSize||8)*2` → 开标签后 20px 变 40px。
- `SITE_CONFIG` 三字段全 null = 零介入。`brandColor` 只注入 `--c-green/-hover/--c-statusbar`，**绝不碰 `--c-green-text-strong`**。`brandColorDark` 空 → 对白提亮 35%。
- ⚠️ **注入 `:root` 变量须抬优先级**（`geo-config.js` 早于 main.css 执行）：`:root:root` / `:root[data-theme="dark"]`；只浅色用的写 `:root:not([data-theme="dark"])`；**别用 `documentElement.style`**。
- 配置外置 ≠ 热更新：同域文件被 SW 预缓存，改内容要等 `CACHE_NAME` 变；真热更新走跨域绝对 URL（跨域不进 SW → 离线取不到配置）。
- **无级缩放**：`MAP_CONFIG` 给 `zoomSnap:0`（+`zoomDelta/wheelPxPerZoomLevel/wheelDebounceTime`）；读值时用 `_mapOpt(k,d)`（判 `!= null`）——**用 `||` 会把 0 弹成 1**。

## 3 配色（WCAG）
- 选中态边框/焦点环**不能用 `--accent`**(1.58:1) → 用 `--c-green-text-strong`(浅4.84/深8.06)。开关可用 `--accent`（有滑块位移这个非颜色线索）。
- 绿字一律 `--c-green-text-strong`(#3a743a)；绿底配深字(#1a1a2e, 9.3:1)不配白字。深色下它 = `--c-green-text` = #88cc88。待定：`--c-text-dim` #999/#777 未达 AA。
- `.is-on` 与 `:has()` 必须拆两条规则（列表含无效项整条丢弃）。

## 4 布局稳定性（滚动条）
- **懒预留**：`scroll-gutter-guard.js` 容器**首次真溢出**才打 `data-scroll-guttered`，此后常驻；CSS 只 `[data-scroll-guttered]{scrollbar-gutter:stable}`。别无条件 `stable`，别用 `overflow-y:scroll`。新增容器 → 加进其 `SELECTOR`。
- `.dialog-body` 上限扣头部：`min(600px, calc(100vh - 140px))`。
- 只写 `overflow-x:auto` 会让 `overflow-y` 算成 `auto`（审计误判）→ 不纵滚的元素显式 `overflow-y:hidden`。

## 5 Markdown 弹窗（`dialog.js` showMarkdown）
- `marked` 不做路径重写 → `resolveRelativeImages(root, docUrl)` 按**文档自身目录**补前缀。
- ⚠️ `overflow:hidden` 的盒子 `scrollLeft` 仍可被脚本改写 → 判据看 `overflow-x` 是否真变 `auto`。大图点击切 `.md-zoom`；**别把尺寸悬殊的图放同一表格**。

## 6 测量 / 绘制（Geoman + `measure-tools.js`）
- 形状名是 **`Line`** 不是 `Polyline`。**圆的画法 = 点一下定圆心 → 再点一下定半径**（不是按住拖）→ 实时读数不能自己记 mousedown 圆心，须读 Geoman 内部态（`Draw.Circle._layer/_centerMarker/_layerGroup`）。
- **测量时不点选要素**（`body.ogv-drawing`：`pm:drawstart` 加 / `pm:drawend·drawstop` 去；`pm:drawstart` 还要 `map.closePopup()` 收掉遗留属性窗）。
  ⚠️ **必须堵两条路径**，只做一条会出现「能吸附但一点就弹悬浮窗、点不了设置点」：
  1. **DOM 层**：CSS 要对 **pane + 可交互元素本身**各关一次，且**全部带 `!important`**。
     只关 pane **无效** —— `pointer-events` 虽可继承，但**元素自身声明优先于继承值**：
     `leaflet.css` 的 `path.leaflet-interactive{pointer-events:auto}` 与本项目
     `path.hit-area{pointer-events:stroke!important}` 都把 pane 的 none 顶掉 →
     点要素（marker 无自身声明）能屏蔽，**线/面要素照样可点**。选择器须含 `.leaflet-interactive`
     与 `.hit-area` 才能压过后者。另：**popup pane 也要关**（关掉后点击穿透到容器，落点不被吃）。
     别碰 `.leaflet-control-container`（map-pane 的**兄弟**）→ 工具条/缩放条保持可点。
  2. **Canvas 层**：`Leaflet.MarkersCanvas.js` 的 `_fire` 是**自己监听 `map` 的 click/mousemove**
     + RBush 命中检测，CSS 拦不到（点击穿透到容器后 map click 照旧触发）→ 弹属性窗、
     命中聚合簇还会 `map.setView` 跳级缩放、并把光标改成 pointer 盖掉十字准星。
     已在 `_fire` 开头用 `OGVMeasureTools.isDrawing()` 加闸。
  - **圆的半径弹窗**也要随 popup pane 一起被关掉 → `registerCircle()` 在 `openPopup()` 前显式 `setDrawing(false)`。
  - **吸附不受影响**：Geoman 吸附是几何计算，不靠 DOM 命中。
- ⚠️ **Leaflet 里 `L.Circle = L.CircleMarker.extend({...})`**（`leaflet.js: gi=fi.extend`）→ 判「地理圆 vs 像素圆」**只能写 `instanceof L.Circle`**；写 `&& !(x instanceof L.CircleMarker)` 恒为 false，会把米当像素（症状：弹窗显示「272060 px」、输入 300 圆不动）。字段也不同：Circle 用 `_mRadius`、CircleMarker 用 `_radius`。
- ⚠️ **Geoman 默认 `finishOnEnter:false` / `exitModeOnEscape:false`** → 纯键盘无法收尾（WCAG 2.1.1）。`app.js` `GEOMEN_GLOBAL_OPTS` 显式打开，走 `map.pm.setGlobalOptions()`；**`addControls()` 不吃这两个键**（工具条选项与全局选项是两套）。
- 自定义工具条按钮：`map.pm.Toolbar.createCustomControl({name,block:"draw",className,toggle:false,onClick})`，**必须在 `addControls()` 之后**；重名会抛错，用标志位挡。弹窗里的按钮**不挂 onclick** → `document` 事件委托。

## 7 2D 渲染
- Canvas(>3000点)：点 8px / hit 10px；RBush 仅 hit 检测；`updateColors()` 增量改色。DOM+聚类(≤3000)：divIcon 无 `setStyle`。
- 透明度递归 `applyLayerOpacity()`；`markerClusterGroup` 必须 `getAllChildMarkers()`。`reloadLayerWithNewMode` 第6参 `forceRebuild`：iconType/iconSize 变化必传 true。进度条 `updateLayerProgress(id,null)` **必须 removeChild 摘节点**。
- **pane 层级**（真源 `MAP_CONFIG.panes`）：`baseImagePane` 190 < 瓦片 200 < `demPane` 350 < 矢量 400 < 标记 600。**底图(单选)永远最底，覆盖层(多选)压在底图之上**。`L.imageOverlay` 默认落 `overlayPane(400)` → 必须专用 pane。
- **`L.Control.Layers` 逐图层绑 `add/remove`**（不是 map 的 layeradd）→ `map.removeLayer()` 也触发 `overlayremove`，被动移除须 `_suspendPersist` 挂起写盘，否则记忆被清空。
- **图层上色**：面不写 `colorMode` 默认 `"sequential"` → **要单色须同时写 `color` + `colorMode:"single"`**。面**填充硬上限 0.45**，描边用未截断 `layerOpacity` → 两者不同步。面描边色**硬编码 `#555`**；线要素 `color` 直接是线色。
- 图层开关在设置面板（`input[type=checkbox][id^="layer_"]`），Leaflet 图层控件只剩底图。单图层用户设置优先：`localStorage["dupal_layer_set_"+checkboxId]` 的 `colorMode/colorValue/opacity/iconValue/selectable/labelField` 会盖掉配置 → 改配置不生效先查这里。

## 8 要素弹窗（Popup）
- **不要给 `.popup-ext-btn` 挂 onclick**：Leaflet 复用 Popup 时 `setContent/update` 重写 innerHTML → 新按钮没 onclick，且 `openOn` 命中 `hasLayer` 直接 return。现行：`popupopen` 只登记 WeakMap(容器→popup) + `document` click 委托 → `closest(".leaflet-popup")` → 点击时才 `resolvePopupTarget(popup)`。
- **要素一律点击时现取，不缓存**（esri 复用弹窗会「点 B 出 A」）。**开窗走 `openFeaturePopup()`（新建 `L.popup()` + `openOn`）**，不用 `bindPopup().openPopup()`（会装两次 click → 一次点开两次窗）。DOM marker 保留 `bindPopup`（键盘可达）但不再手动 `openPopup()`。
- ⚠️ **`L.popup().openOn(map)` 【同步】触发 `popupopen`** → 自定义属性须在 `openOn` **之前**赋值。
- esri FeatureLayer 走 Leaflet 自带 `bindPopup`；`_source` = 视口生成的子图层；图层 id/名要在**弹窗内容函数里**贴到子图层。`map.addLayer()` 后须再产生一次 moveend/zoomend 才拉要素。

## 9 Cesium 3D
- 共享 featureCache 直喂 `GeoJsonDataSource.load()`；CDN v1.125。Point 用 billboard；ArcGIS 走 `UrlTemplateImageryProvider` + `tile/{z}/{y}/{x}`；聚类 Label 须 `CENTER/CENTER/pixelOffset=ZERO`。
- **`CLAMP_TO_GROUND` 是卡顿元凶** → 点默认 `"none"`，显式 `"live"` 且 ≤300 才贴地。**Z 坐标须压平**：`GeoJsonDataSource` 读到第三分量就走 `perPositionHeight` → 接边穿插，加载前 `CesiumGeoJsonAdapter.normalizeGeometryZ()`。
- 关→开瞬时：取消勾选只 `ds.show=false` + 挪 `cesiumHiddenCache`(LRU 12)；`reloadLayer/All` 须 `destroyLayer`。聚类气泡不吃 `updateOpacity` → dataSource 上记 `_ogvOpacity` 手动同步。
- 图标用 2D 同源 `getIconFactory` 转 SVG data-uri；面填充 `min(opacity,0.45)`；面边界 `#555`；聚类 `pixelRange=28,minSize=4`。深色下大气三件套全关。
- 性能：慢在下载(94.6%)不在构建。`globe.maximumScreenSpaceError=2` + 天地图 t0~t7 → 6.8s/锐度568。自托管 `assets/cesium/Cesium.js`，SW 不预缓存。

## 10 Git / 发布
- **git 操作由用户自己执行**。远程 `github.com/TigerHall/gis.git`，主分支 `main`。
- **版本号唯一真源 = `service-worker.js` 的 `CACHE_NAME`**（`app.js` 运行时发 `GET_VERSION`）。改这行即触发更新弹窗 + 缓存重建。若浏览器已缓存上一版，普通刷新仍拿旧文件 → **须再 bump 一次**。
- 线上域名 `dupal.cn`；`wzhky.com` 是**另一个项目**，别混。`.gitignore` 只忽略 `/CNAME` 与 `.workbuddy/artifacts/`；`docs/shots/` 应入库。`docs/` 随站点发布：`app.js` `fetch("docs/CHANGELOG.md")` 渲染「更新记录」。

## 11 本地存储（v3.0.2 起统一）
- **所有 storage 读写走 `window.OGVStorage`**（`geo-utils.js`，早于所有业务模块）。API：`KEY.*`/`safeGet·safeSet·safeRemove`/`getBool·getNum`/**`getJSON`（解析失败即删键+兜底）**/`keysWithPrefix·removeAll·pruneOrphans`/`clearResettable·clearApp`。**`getJSON` 删键是自愈关键**：坏值不清掉，「读-改-写」永远失败。
- **绝不用 `localStorage.clear()`** → 用 `clearResettable()`（保留 `ogv_premium_active`/`dupal_user_layers`/`dupal_user_layer_*`）。遍历 localStorage **先快照 key 数组再删**。
- ⚠️ **`dupal_layer_` 是 `dupal_layer_set_` 的前缀**（`hasSavedLayerState`/`clearAllLayerStates`/「记住图层」清理三处误吃过）→ 须显式排除。底图/覆盖层记忆：`savedOverlayNames` 唯一真源；**恢复必须写在 `rebuildLayerCtrl()` 里**。

## 12 跨标签同步
- 「值归属」与「副作用是否重放」是两件事。`app.js` `SYNC_BLOCK` 黑名单：`view3d`/`isLocationTracking`/`premium` → 不同步，只认存储值；其余纯视觉开关立即同步。同步只改 `cb.checked` + 直接调 enable/disable，**绝不回写存储**（否则回环）。

## 13 通用坑
- **数据不是代码：属性值一律按纯文本渲染**。字段来自 SHP/KML/ArcGIS，常整段是 HTML 且被 DBF 255 截断（实例 `volcanos.geojson` 的 `LAYER`）。直接拼 innerHTML 三后果：① 未闭合标签吃掉后续标记（`.popup-ext-btn-wrap` 被解析进 `<td>` → 按钮错位 33px）② 字段里 `<img>` 真发请求 ③ XSS。
  - **唯一收口 = `geo-utils.js` 的 `buildPopupContent`**（10 个调用点）：转义 → 剥标签 → 折叠空白 → 空字段整行不渲染 → 超 200 字符截断。`_getLabelText`/`_bindPermanentLabel` 已加 `_escapeLabelText`。`layer.popup` 按 `file` 从 `window.geoJsonGroups` **惰性建索引**。诊断：看 `.popup-ext-btn-wrap` 祖先链有没有 `TD/TABLE`。
- **TDZ**：对外只暴露延后调用的 getter。WMS 须支持 EPSG:3857。
- **GzIdbLoader**：gzip → IndexedDB（DB v2，key=URL）；仅 .gz；**`setCache` 必须 await**。倒排索引 tokens 用 `Object.create(null)`。反子午线线/面三副本，点 ≤3000 才做。
- `exportMapImage()`（html-to-image）须隐藏 `#waybackBar` 与 `#ogvRadiusChip`；激活码在 `app.js` `_PR_CODES`。程序化改 `checked` 要 `dispatchEvent(new Event("change",{bubbles:true}))`。

## 14 面板细节
- `hidden:true`(group/layer) 跳过渲染但保数据；整组 hidden 不生成空 `<details>`。
- **快捷区 = 面板设置的快捷键，不是第二份设置**：状态唯一来源是面板 `<input type=checkbox id>`；快捷项 `<button data-quick-for aria-pressed>` 转发 `master.checked = !checked` + `dispatchEvent("change")`；反向靠 document change 委托。**快捷区绝不能持有同 id 元素**。
- `clusterToggle`/`labelToggle` 不在 `toggleConfig`，恢复更晚 → `window._syncQuickStates()` 须可重入（渲染②后 + load 各跑一次）。
- **「已开/总数」徽标**：须读 checkbox **实时**状态；入口 `requestSubBadges()`（幂等 + rAF 合并），挂进 `_syncQuickStates()`；`initToggle()` 在副作用跑完后同步；兜底 `body.addEventListener("toggle", fn, true)`（details 的 toggle 不冒泡但走捕获）。回归判据写「徽标 === 该组实际勾选数/总数」。
- 快捷项手感：`:active` 置 `transition-duration:0s` + `scale(.94)`；`touch-action:manipulation`；hover 收进 `@media (hover:hover)`；焦点 `:focus-visible`。

## 15 本机工具链坑
- **Bash 工具 PATH 为空** → 命令前加 `export PATH="/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/bin:$PATH"`。
- Node 用绝对路径 `"C:/Users/hehu/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"`。Playwright 脚本放 `.workbuddy/artifacts/`，文件头 `module.paths.push("C:/Users/hehu/.workbuddy/binaries/node/workspace/node_modules")`。回归套件：`.workbuddy/artifacts/verify-5req.js`。
- **`getComputedStyle` 返回 transition 中间值** → 判样式前先 `await 400ms`。**Playwright 默认 `--hide-scrollbars`** → 量宽度会假阴性，须 `ignoreDefaultArgs`。
- `page.evaluate(fn,arg)` 只序列化 `fn` **本身**：内嵌 helper 必须定义在同一个函数体内，否则 `ReferenceError`（踩过）。
- minified 单行文件别硬 grep → 用 `node -e` 截 `s.slice(indexOf(k), +500)` 读源码。grep 的 `\{n\}` 在 Git Bash 报 `Invalid content of \{\}`。
- 测试假阴性已踩 5 例：① transition 中间值 ② `--hide-scrollbars` ③ 用 `typeof btn.onclick` 判委托按钮 ④ case 之间状态不复位 ⑤ **用错误的 `instanceof` 组合筛图层**（会「测出错的东西」）。
- **SVG 元素没有 `.click()`** → 用 `page.mouse.click(x,y)` 或 `dispatchEvent(new MouseEvent("click",{bubbles:true}))`。
