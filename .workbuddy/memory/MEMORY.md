# OGV 项目长期记忆（精简版）

## 文件架构（加载顺序）
`<head>`: dialog.js → geo-config.js ｜ `<body>`: 主脚本(index.html) → app.js → geojsonloader.js → file-handler.js → pointdrop.js
- `geo-config.js`: 图层路径/分组配置（window.* 全局暴露）。图层对象支持 `defaultOpacity`（默认不透明度，未覆盖用户设置时生效）与 `searchPriority:true`（搜索优先：未勾选也可搜、结果置顶，启动 2s 后后台静默建索引）
- `geojsonloader.js`: 图层加载/样式/高亮/交互/搜索/上传（最大核心文件）
- `file-handler.js`: `window.loadFileAsUserLayer(file)` 统一入口（按钮/拖入/PWA）
- `app.js`: 版本号/导出/SW/剪贴板/记住图层/toggle（TOGGLE_GROUPS 数据驱动）
- `geo-utils.js`: 纯函数（颜色/坐标/样式/弹窗）｜ `dialog.js`: showToast/showMarkdown

## 底图 WMS 源（index.html 主脚本内）
- 所有底图集中在 `allBaseLayers` 单一对象；`getDefaultBaseLayers()` 定义默认可见子集，`getVisibleBaseLayers()` 在"更多底图"开关开启时返回全部 `allBaseLayers`
- 已接入：天地图系列、ArcGIS 系列、ETOPO 2022、OSM、EMODnet、Macrostrat
- **GEBCO WMS（2026-07-19 扩充）**：主端点 `https://wms.gebco.net/mapserv?`（GEBCO_2024 latest 网格，EPSG:3857）、2025 端点 `https://wms.gebco.net/2025/mapserv?`（GEBCO_2025 网格）。共 14 个图层（含原有 GEBCO_LATEST / GEBCO_LATEST_2）。新增层均 `version:"1.1.1"`、`maxZoom:12`、`transparent:true`、`crossOrigin:"anonymous"`，仅出现在"更多底图"模式。WMS 1.1.1 + EPSG:3857 在 Leaflet 默认投影下已验证可渲染（curl GetMap 返回 200 image/png）
- **关键坑**：WMS 图层须支持 EPSG:3857 才能在 Leaflet 默认投影渲染；仅 EPSG:4326 的图层（如 GEBCO 极区网格）不能直接加，会被裁掉

## Canvas 插件（Leaflet.MarkersCanvas.js，UMD）
- 单点半径 8px、hit area 10px（与 IODP DOM 点一致）
- RBush 仅用于 hit 检测 + 视口裁剪；聚类改用 Grid 网格预聚合（clusterRadiusPixels=100），O(n)
- `updateColors()` 增量改色（不重建 RBush）
- **透明度**：`_redraw` 用 `ctx.globalAlpha = options.opacity||1`（options.opacity 由 geojsonloader 创建/更新时传入）；图层透明度滑杆在 `reloadLayerWithNewMode` 的 canvas 分支写 `canvasLayer.options.opacity` 并重绘

## 点要素透明度（已知坑 + 修复）
- **根因**：点要素经 `L.GeoMarker.createPointMarkerByType` 创建为 `L.Marker`+divIcon，**无 `setStyle`**，所以透明度滑杆更新循环（只对 `setStyle` 生效）和 `getGeoJsonStyle` 给点返回的 opacity 都对点无效 → 点始终全不透明。
- **修复**：`createPointMarkerByType` 增 `opacity` 参数，把透明度烘焙进 divIcon 内层 `<div class="gm-op-wrap">`；滑杆更新循环对 marker 改 `.gm-op-wrap`（或外层）元素 opacity。线/面仍走 `setStyle`。聚类气泡（缩小时）透明度不随滑杆实时变（已知 minor 限制）。

## GeoJSON 加载/缓存
- `Leaflet.GzIdbLoader.fetch()`：IndexedDB 缓存解压后 JSON（DB_VERSION=2），key=文件 URL
- 仅加载 .gz（gz-only，不回退 JSON）；COS 加速 `geoJsonCosPath` + `localFallback`
- 搜索倒排索引存 IDB `searchIndex` store；**tokens 必须用 `Object.create(null)`**（普通 {} 遇 "constructor" 等原型键会 `push is not a function`）

## 反子午线（anti-meridian）
- 三副本方案：`offsets=[-360,0,360]`；线/面始终三副本，点 ≤1万才做（防内存爆炸）。已移除 `fixAntimeridian`

## UI 约定
- 图层组用 `<details>`+`<summary>`（原生折叠，无需 JS）；`.layer-panel{font-size:0}`+`>.layer-panel>*{font-size:13px}` 消除 flex 匿名项间隙
- 地图控制面板 toggle-section 点击外部自动折叠，持久化 localStorage
- 标签系统：`labelEnabled` 全局开关；聚类 `clusterEnabled` 仅点图层
- ⓘ 关于 → `showMarkdown("README.md",...)`；公安备案链接 + `./assets/images/备案编号图标.png`

## 付费激活码系统
- 6位码在 `app.js` 顶部 `_PR_CODES`（每月更新）；验证过写 `ogv_premium_active`；`window.premiumCheck()` / `showPremiumActivation()` / `premiumReset()`；仅锁定下载 GeoJSON

## 文档约定
- MD 弹窗内**不用表格**（移动端差），数据用 "**名** — 说明" 单行；`#_mdBody > p` 首行缩进 2em，blockquote 不缩进
