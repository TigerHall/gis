# OGV 项目长期记忆（精简版）

## 文件架构（加载顺序）

`<head>`: dialog.js → geo-config.js → **Leaflet.LegendControl.js**（新增）｜ `<body>`: 主脚本(index.html) → app.js → geojsonloader.js → file-handler.js → pointdrop.js

- `geo-config.js`: 图层路径/分组配置（window.\* 全局暴露）。图层对象支持 `defaultOpacity`、`searchPriority:true`、`selectable:false`（不可选中：点击不弹窗不缩放，用户可在设置覆盖）
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

## 点要素标记 + 图标（Leaflet.GeoMarker.js，已知坑 + 修复）

- 点要素经 `L.GeoMarker.createPointMarkerByType(map, feature, latlng, color, labelText, iconType, iconSize, opacity)` 创建为 `L.Marker`+divIcon。**无 `setStyle`**，透明度靠 divIcon 内层 `<div class="gm-op-wrap">` 或调用方 `wrapIconOpacity` 包裹（不要在 `getIconFactory` 内重复 wrapOpacity，否则双重淡出）。
- **图标大小坑（已修）**：所有内置图标（volcano/hotspot/star/point + file 风格）工厂现接收 `size` 参数，`getIconFactory(iconType, iconSize)` 用闭包把 `iconSize` 绑定进工厂 → 图标随「图标大小」设置缩放。`createPointIcon` 的 size 表示**标记总直径**（默认 16），与三角形/星同尺度。
- **致命参数错位（已修）**：原 `createPureIconMarker` 调 `wrapIconOpacity(createPointIcon, color, 8, opacity)` —— 第3参是 opacity 位、第4参是 size 位，结果把字面 `8` 当 opacity、把真实 `opacity`(0.35/0.8) 当圆形半径 → 默认点被画成 0.35px 几乎不可见。现改为 `(createPointIcon, color, opacity, iconSize||8)`。
- 圆形点路径原来完全没把 `iconSize` 传入 `createPointMarkerByType` → 已补传第7参 `iconSize`。

## 点图层透明度（聚类组根因 + 修复）

- **现象**：透明度滑杆只有圆形响应、三角形/星/热点等图形不响应。
- **根因**：点图层 ≤3000 走 DOM 且**默认开启聚类**（markerClusterGroup）。`markerClusterGroup.addLayer` 把单个 marker 存入 `_gridClusters/_gridUnclustered`，**不调用 `L.LayerGroup.addLayer`**，故 `clusterGroup.eachLayer`（遍历 `_layers`）只产出聚类气泡对象、遍历不到单个 marker。旧增量透明度循环只命中聚类气泡、够不到单个图形 marker → 不淡出。>3000 点的圆形图层走 Canvas（globalAlpha）正常淡出，造成不对称。
- **修复**：新增递归 `applyLayerOpacity(layer, op)`——对 `L.MarkerClusterGroup` 额外调 `getAllChildMarkers()`（本地 leaflet.markercluster.js 已确认有该方法，递归遍历所有 cluster + `_markers`）遍历全部子 marker 设 DOM 透明度；同时保留 `eachLayer` 递归（矢量/嵌套组/聚类气泡）。非 Canvas 增量循环改为 `cached.eachLayer(gl => applyLayerOpacity(gl, op))`。

## reloadLayerWithNewMode 重渲染坑（已修）

- 非 Canvas 分支用 `newOpacity !== undefined` 判断"仅透明度变化"并提前 return（跳过重建）。但**设置保存始终传 newOpacity**，导致图标类型/大小（`iconType`/`iconSize`）变化被吞掉、不即时生效。
- **修复**：函数增第6参 `forceRebuild`；设置保存段在 `iconChanged`（图标类型或大小变化）时传 `true`，跳过"仅透明度"短路、走重建分支（读最新 `layerIconMap`/`layerIconSizeMap`）。仅改透明度时 `forceRebuild` 为 false，保持增量更新性能。

## GeoJSON 加载/缓存

- `Leaflet.GzIdbLoader.fetch()`：IndexedDB 缓存解压后 JSON（DB_VERSION=2），key=文件 URL
- 仅加载 .gz（gz-only，不回退 JSON）；COS 加速 `geoJsonCosPath` + `localFallback`
- 搜索倒排索引存 IDB `searchIndex` store；**tokens 必须用 `Object.create(null)`**（普通 {} 遇 "constructor" 等原型键会 `push is not a function`）

## 搜索结果定位（关键坑 + 修复）

- **现象**：点击要素搜索结果不跳转。根因：原 `highlightAndLocateFeature` 非 Canvas 分支只靠 `layer.feature._featureIndex === feat._featureIndex` 匹配；但搜索结果的 `feat` 来自 `featureCache`（带 `searchPriority` 的图层由 initPrioritySearchIndices 用原始 fetch 填充、未渲染，`_featureIndex` 未赋值），跨对象匹配失败。
- **修复原则**：要素定位**始终基于 `feat.geometry` 真实坐标**（`extractCoords` 返回 [lat,lng]），`_featureIndex` 仅作「找到已渲染矢量要素→触发 dblclick 高亮弹窗」的可选增强，找不到则退回坐标定位。`renderResults` 用 `FEATURE_SEARCH_CAP=200`(每图层每阶段) + `SEARCH_PAGE/STEP=50` 分页，「查看更多」按钮基于实际 results 长度分页。

## 反子午线（anti-meridian）

- 三副本方案：`offsets=[-360,0,360]`；线/面始终三副本，点 ≤1万才做（防内存爆炸）。已移除 `fixAntimeridian`

## UI 约定

- **主题色 `#9c9`**（= `#99cc99` 浅青绿）：界面自定义标记（如地图中心十字）默认用此色，配合 `box-shadow:0 0 0 1px rgba(0,0,0,.45)` 描边保证浅色底图可见
- 图层组用 `<details>`+`<summary>`（原生折叠，无需 JS）；`.layer-panel{font-size:0}`+`>.layer-panel>*{font-size:13px}` 消除 flex 匿名项间隙
- 地图控制面板 toggle-section 点击外部自动折叠，持久化 localStorage
- 标签系统：`labelEnabled` 全局开关；聚类 `clusterEnabled` 仅点图层
- ⓘ 关于 → `showMarkdown("README.md",...)`；公安备案链接 + `./assets/images/备案编号图标.png`

## 付费激活码系统

- 6位码在 `app.js` 顶部 `_PR_CODES`（每月更新）；验证过写 `ogv_premium_active`；`window.premiumCheck()` / `showPremiumActivation()` / `premiumReset()`；仅锁定下载 GeoJSON

## 文档约定

- MD 弹窗内**不用表格**（移动端差），数据用 "**名** — 说明" 单行；`#_mdBody > p` 首行缩进 2em，blockquote 不缩进

## 导出图片（2026-07-25 终版）

- **方案**：DOM 截图 + `getBoundingClientRect` 子像素摊平 transform + 禁用瓦片动画。
  `exportMapImage()` 在 `app.js` 中，流程：
  1. 隐藏侧边栏
  2. 注入 `<style>` 禁用 `.leaflet-tile` 的 CSS transition/animation（`opacity:1 !important`）
  3. 等两帧，然后遍历 `.leaflet-pane`，用 `getBoundingClientRect()` 子像素精度计算位置（相对 `#map`），清空 transform 改 left/top
  4. `htmlToImage.toPng(mapEl, {backgroundColor, pixelRatio, filter})`
  5. filter 只排除 `.leaflet-control-container, .leaflet-control, .leaflet-popup` — **不排除 `.leaflet-tooltip`**（面要素永久标签是 tooltip）
  6. 成功后恢复 transform + 清理 style + 下载 PNG
- **关键教训**：
  - `offsetLeft` 返回整数，丢失子像素 → 平移后瓦片错乱。改用 `getBoundingClientRect` 修正
  - `.leaflet-tooltip` 在 filter 中排除会导致面要素永久标签丢失
  - 天地图不支持 `crossOrigin` 重加载，不能走 canvas 手动绘制瓦片
- **调用入口**：导出按钮、版本菜单、Ctrl+E/Cmd+E
- **后续扩展**：用户需要经纬度网格、图例等额外元素。当前架构可用同一 pipeline — 截图前在 map 容器内临时注入这些元素，截图后清除

## 图例控件（LegendControl）（2026-07-26 新增 + v2 升级）

- 插件文件：`assets/Leaflet.LegendControl.js` + `assets/Leaflet.LegendControl.css`
- `L.Control.Legend` 标准 Leaflet 控件，`position: 'bottomleft'`（与比例尺同在左下角）
- 数据来源：`window._buildLegendData()`（定义在 `geojsonloader.js`）→ 遍历 `#dataLayerContent` + `#userLayerGroup` 中已勾选且已加载到地图的图层
- **几何符号**：点用 SVG 圆形、线用横线、面用方块色块 — `_renderGeomSymbol(color, geom)`
- **字段分色可展开**：`<details>` + `<summary>` 原生折叠，▶ 箭头 CSS 旋转动画；子项用小尺寸几何符号 + 字段值名
- **模式标记**���sequential →「多色」badge；field →「N 色」badge
- 每项数据含 `geomType`（从 `_geomTypeCache` 或 `featureCache` 快速检测）和 `mode`
- 触发刷新：`scheduleLegendRefresh(delay=150ms)` → `window._refreshLegend()` → `legendControl.update(items)`
- 钩子位置：`loadGeoJSONLayer`(×2)、`removeGeoJSONLayer`、`reloadLayerWithNewMode`(×2)、用户图层添加(×2)
- 开关：`TOGGLE_GROUPS` 控件分类 `legendToggle`（checked:true），`toggleConfig.legendToggle`（enable 创建控件，disable 隐藏）

## 要素详情面板（2026-08-01 新增）

- 文件：`assets/feature-panel.js` + `assets/feature-panel.css`
- 加载顺序：在 `pointdrop.js` 之后（`<body>` 底部）
- **两种入口**：
  - 单要素：Popup [📋 查看详情] 按钮 → `window.FeaturePanel.openSingle(feature, layerId, layerName)`
  - 图层：图层项 [📋] 按钮 → `window.FeaturePanel.openLayer(layerId, layerName, features)`
- **Canvas 要素传递**：`popup._featureRef` + `popup._layerId`（在 `onFeatureClick` 中设置）
- **DOM 要素传递**：通过 `popup._source.feature` + `featureCache` 反向查找
- **属性表**：单要素模式 key-value 翻页（15条/页）；图层模式多行表格翻页 + 搜索过滤
- **图表**：ECharts 5.5.1 CDN 懒加载；柱状图/雷达图/饼图；支持「对比图层均值」
- **全局依赖**：`window._featureCache`、`window._layerIdByFileName`、`window.GeoUtils.extractNumericFields`、`window.GeoUtils.computeLayerStats`

## 图层不可选中（2026-08-07 新增）

- `layerSelectableMap[checkboxId]` 跟踪每层可否选中，false 时不弹窗不缩放
- **优先级**：localStorage 用户设置 > geo-config `selectable:false` > 默认 true
- 设置弹窗底部「可选中」复选框，持久化到 `saveLayerSettings`
- 所有要素点击路径（Canvas/DOM聚类/DOM非聚类/面线）均已接入检查
- 用户上传图层默认 selectable=true

## 弹窗按钮外移（2026-08-07 调整）

- 缩放 ⚲ 和详情 📋 按钮移到 `.leaflet-popup` 右侧外边竖向排列
- 注入 `.popup-ext-btn-wrap`（flex column, right:-36px, top:50% translateY(-50%)）
- 旧 `.popup-zoom-btn` 已移除；`.leaflet-popup{overflow:visible!important}` 防裁剪

## 用户图层存储逻辑（2026-08-07 终版梳理）

### 存储键
- `dupal_user_layers`（USER_LAYER_STORAGE_KEY）：JSON 数组 `[{id, fileName}]`，**图层清单，永不被恢复/不恢复/开关删除**
- `user_geo_<id>`（IndexedDB）：GeoJSON 真数据
- `user_<id>`（IndexedDB）：搜索索引
- `dupal_user_layer_<id>`：该图层勾选状态 `"true"/"false"`，用于恢复时还原

### 生命周期
- **上传**：`addUserLayer(data, name)` → 写 IDB + 写 `dupal_user_layers` + 写 `dupal_user_layer_<id>="true"`（初始即“打开”）+ 上图勾选渲染
- **× 按钮（唯一删除路径）**：`delCache` + `deleteSearchIndex` + `removeUserLayerMeta` —— 数据/索引/清单全清
- **重新打开**：默认**不加载**用户图层（`restoreUserLayers` 只在「恢复」回调里调用），清单仍在存储中
- **点「恢复」**：`restoreUserLayers` 按 `dupal_user_layer_<id>` 严格还原 —— `true`→勾选并加载，`false`/未保存→不勾选（默认不加载）
- **点「不恢复」**：`clearAllLayerStates` 只清 `dupal_layer_*` + `dupal_user_layer_*` 勾选键 + 设置，**排除 `dupal_user_layers` 和 IDB**，数据不丢
- **「记住图层」开关关**：只清勾选键（`dupal_layer_*`、`dupal_user_layer_*`），**不碰 `dupal_user_layers` 和 IDB**

### 关键坑（已修）
- 字符串前缀碰撞：`"dupal_user_layers".indexOf("dupal_user_layer_")===0` 为真 → 清除循环曾误删清单。两处清除逻辑都已 `key !== "dupal_user_layers"` 显式排除
- `restoreUserLayers` 的 `wasChecked` 原被 `isRememberLayerEnabled` 纠缠（关→强制不勾选）；现改为严格读 `dupal_user_layer_<id>`
- 上传时需主动 `setItem("dupal_user_layer_<id>", ...)`，否则「恢复」读不到初始打开状态

## 经纬度格网（2026-08-15 新增）

- **插件**：[leaflet/Leaflet.Graticule](https://github.com/leaflet/Leaflet.Graticule) 官方 `L.Layer.extend`，Canvas 全幅绘制 + `showLabel` 边缘经纬度刻度。17.6KB 单文件无依赖，工厂函数 `L.latlngGraticule(opts)`。下载源 jsDelivr: `https://cdn.jsdelivr.net/gh/leaflet/Leaflet.Graticule@master/Leaflet.Graticule.js`
- **集成**：index.html head 在 MousePosition.js 后引入；app.js TOGGLE_GROUPS「显示」分组加 `graticuleToggle`，toggleConfig 加 enable/disable + 顶层 `rebuildGraticuleTheme()` 函数（深色模式联动）
- **zoomInterval 分级**：1-3:30° / 4-5:10° / 6-7:5° / 8-9:1° / 10+:0.5°（适配海洋站位图视野）
- **`latLineCurved: 4`**：Web Mercator 下纬线略弯，4 段折线贴合底图；`lngLineCurved: 0`（经线是直线）
- **配色**：浅色 `#6b6b6b` opacity 0.55；深色 `#9aa0a6` opacity 0.7（中性灰两主题都清晰）
- **深色模式联动**：插件无 setStyle，改色只能重建。在 darkModeToggle enable/disable 末尾调 `rebuildGraticuleTheme()`（disable → enable）
- **验证**：playwright-core + 系统 Chrome（沙箱阻断 agent-browser Chromium 下载）跑端到端断言，0 JS 错误
- **DPR 修复**（v2）：`_reset` canvas.width = size.x * dpr，绘制前 ctx.setTransform(dpr,0,0,dpr,0,0)；容器角点 latlng 必须用 size（CSS）而非 canvas.width（DPR 后）
- **DOM 标签层**（v2）：新增 `graticule-labels.js` 替换插件 `showLabel`，fixed 定位地图外侧，pointer-events:none，z-index 1050。格式 `120°E`/`30°N`/`0°`；MIN_GAP=26 防重叠
- **地图让出边距**（v2）：格网开启时 `#map.graticule-active` 类 → `margin: 20px 40px; height: calc(100% - 40px)`，关闭时移除并 invalidateSize。窄屏 <768px 缩到 12/8
- **备案号位置**（v2 → v3 调整）：`#beianBar` 从 `right:8` → `left:8; bottom:30`（v2）→ `bottom:50`（v3 进一步避开底部经度标签行）
- **深色模式联动**（v2）：标签层 `setDark()` 只换主题不重建；Canvas 网格线继续重建换色
- **缩放分级细化**（v3）：原 0.5°@zoom10-20 太稀，14/15 一屏没线。改为 ≥2 条/视口：10-11:0.25° / 12-13:0.1° / 14:0.05° / 15-16:0.02° / 17-18:0.01° / 19-20:0.005°
- **左右纬度标签竖排**（v3）：CSS transform 旋转 90°/-90°（`.gl-left{transform:translate(-50%,-50%) rotate(90deg)}`，`.gl-right{rotate(-90deg)}`）。文字沿边框方向阅读
- **边距收紧**（v3）：左右 40→22px（竖排后宽度=文字高，22px 容纳 15px 文字）、上下 20→18px
- **回退到官方用法**（v4，2026-08-15 终版）：用户要求改用原生 `showLabel:true`（标签画在地图内边缘），撤销 v2/v3 的 DOM 标签层 + 让边距方案。`#map.graticule-active` 类规则删除；`graticule-labels.js` 保留为停用存档（文件头注明）
- **浮点累加 bug 修复**（v4）：Leaflet.Graticule 的 `__format_lat/__format_lng` 直接 `''+lng+'E'`，高 zoom 累加 0.05° 时显示成 `106.99999999999607E`。加 `Math.round(lng*1000)/1000` 修复（保留 0.001° 精度覆盖到 zoom20 的 0.005° 间隔）
- **官方插件标签格式**：`120E` / `30N` / `0`（无 ° 符号，简洁 GIS 风格）。字号 11px，DPR 高清（canvas.width × dpr），`#6b6b6b`/`#9aa0a6` 双主题
- **标签颜色加深**（v5，2026-08-15）：原浅色 `#6b6b6b` + opacity 0.55 字偏淡。改为：网格线 `#8a8a8a`（保持低调）+ 标签文字独立 `fontColor` 浅色 `#333` / 深色 `#eef0f3` + canvas opacity 0.8。线不抢眼但文字清晰
