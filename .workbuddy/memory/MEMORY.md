# OGV 项目长期记忆

## 文件架构（加载顺序）

`<head>`: leaflet.js → esri-leaflet → geo-utils → GeoMarker → GzIdbLoader → MousePosition → Graticule → LegendControl → geojsonloader.css → geoman → markercluster → rbush → MarkersCanvas → shp/togeojson/jszip → dialog → georaster/geoblaze → geo-config.js → main.css → cesium-container.css
`<body>`: 主脚本(index.html: map init + allBaseLayers) → Leaflet.ElevationQuery → app.js → geojsonloader.js → file-handler.js → DemRenderer → marked → pointdrop.js → feature-panel.js → cesium-terrain.js → cesium-geojson-adapter.js → cesium-viewer.js

- `geo-config.js`: 图层路径/分组配置（window.\* 全局暴露）。支持 `defaultOpacity`、`searchPriority:true`、`selectable:false`、`color`/`icon`/`colorMode`/`colorField`/`source`
- `geojsonloader.js`: 图层加载/样式/高亮/交互/搜索/上传（最大核心文件，~5500行）
- `file-handler.js`: `window.loadFileAsUserLayer(file)` 统一入口
- `app.js`: 版本号/导出/SW/剪贴板/记住图层/toggle（TOGGLE_GROUPS 数据驱动）
- `geo-utils.js`: 纯函数 ｜ `dialog.js`: showToast/showMarkdown

## 底图（index.html 主脚本内）

- 所有底图集中在 `allBaseLayers` 单一对象；`getDefaultBaseLayers()` / `getVisibleBaseLayers()`
- 已接入：天地图系列（img/vec/ter/ibo + 标注层）、ArcGIS 系列、GEBCO WMS 2024+2025（14层）、ETOPO 2022、OSM、EMODnet、Macrostrat
- **GEBCO WMS**：端点 `https://wms.gebco.net/mapserv?`（2024）/ `https://wms.gebco.net/2025/mapserv?`（2025），均 `version:"1.1.1"`、`maxZoom:12`、`transparent:true`、`crossOrigin:"anonymous"`，仅"更多底图"模式
- **关键坑**：WMS 图层须支持 EPSG:3857 才能在 Leaflet 默认投影渲染；仅 EPSG:4326 的图层会被裁掉

## Canvas 插件（Leaflet.MarkersCanvas.js）

- 单点半径 8px、hit area 10px；RBush 仅用于 hit 检测 + 视口裁剪；聚类用 Grid 网格预聚合（clusterRadiusPixels=100）
- `updateColors()` 增量改色（不重建 RBush）；透明度用 `ctx.globalAlpha = options.opacity||1`

## 点要素标记（Leaflet.GeoMarker.js）

- `L.GeoMarker.createPointMarkerByType(map, feature, latlng, color, labelText, iconType, iconSize, opacity)` → `L.Marker`+divIcon。**无 `setStyle`**，透明度靠 `wrapIconOpacity` 包裹
- **已修坑**：`createPureIconMarker` 参数错位（opacity 和 size 位颠倒）→ 默认点画成 0.35px。现 `(createPointIcon, color, opacity, iconSize||8)`
- 所有内置图标工厂接收 `size` 参数，`getIconFactory(iconType, iconSize)` 闭包绑定

## 点图层透明度（聚类组根因 + 修复）

- **根因**：≤3000 点走 DOM + 聚类（markerClusterGroup）。`addLayer` 不调用 `L.LayerGroup.addLayer`，`eachLayer` 只遍历聚类气泡、够不到单个 marker
- **修复**：递归 `applyLayerOpacity(layer, op)` 对 `L.MarkerClusterGroup` 调 `getAllChildMarkers()` 遍历全部子 marker

## reloadLayerWithNewMode 重渲染坑（已修）

- 设置保存始终传 newOpacity，导致 iconType/iconSize 变化被"仅透明度"短路吞掉
- **修复**：增第6参 `forceRebuild`；iconChanged 时传 true 走重建分支

## GeoJSON 加载/缓存

- `L.GzIdbLoader.fetch(url)` → `DecompressionStream("gzip")` → JSON → IndexedDB 缓存（DB_VERSION=2，key=URL）
- 仅加载 .gz（gz-only）；COS 加速 `geoJsonCosPath` + `localFallback`
- 搜索倒排索引存 IDB `searchIndex` store；**tokens 必须用 `Object.create(null)`**
- `featureCache[checkboxId]` 内存缓存 features 数组（`window._featureCache`），`layerCache[checkboxId]` 缓存 Leaflet 图层组

## 搜索结果定位（关键坑 + 修复）

- **根因**：搜索结果 feat 来自 featureCache（`_featureIndex` 未赋值），跨对象匹配失败
- **修复**：要素定位始终基于 `feat.geometry` 真实坐标，`_featureIndex` 仅作可选增强

## 反子午线

- 三副本方案：`offsets=[-360,0,360]`；线/面始终三副本，点 ≤1万才做

## UI 约定

- **主题色 `#9c9`**（`#99cc99`）；图层组用 `<details>`+`<summary>`；`.layer-panel{font-size:0}` 消除 flex 间隙
- 标签 `labelEnabled` 全局开关；聚类 `clusterEnabled` 仅点图层
- MD 弹窗不用表格，数据用单行；`#_mdBody > p` 首行缩进 2em

## 付费激活码

- 6位码在 `app.js` `_PR_CODES`；仅锁定下载 GeoJSON

## 导出图片（app.js `exportMapImage()`）

- DOM 截图 + `getBoundingClientRect` 子像素摊平 transform + 禁用瓦片动画
- `htmlToImage.toPng(mapEl, {backgroundColor, pixelRatio, filter})`；filter 排除 `.leaflet-control-container/.leaflet-control/.leaflet-popup`，**不排除 `.leaflet-tooltip`**
- 关键教训：`offsetLeft` 丢子像素 → 瓦片错乱；天地图不支持 `crossOrigin` 重加载

## 图例控件（LegendControl）

- `L.Control.Legend` position `bottomleft`；数据来源 `window._buildLegendData()`
- 几何符号：点=SVG圆形、线=横线、面=方块；字段分色可展开 `<details>`
- 触发：`scheduleLegendRefresh(150ms)` → `window._refreshLegend()`
- 钩子：`loadGeoJSONLayer`/`removeGeoJSONLayer`/`reloadLayerWithNewMode`/用户图层添加

## 要素详情面板（feature-panel.js）

- 单要素：Popup [📋] → `FeaturePanel.openSingle(feature, layerId, layerName)`
- 图层：图层项 [📋] → `FeaturePanel.openLayer(layerId, layerName, features)`
- Canvas 要素传递：`popup._featureRef` + `popup._layerId`
- 图表：ECharts 5.5.1 CDN 懒加载；柱状图/雷达图/饼图

## 图层不可选中

- `layerSelectableMap[checkboxId]` false 时不弹窗不缩放
- 优先级：localStorage > geo-config `selectable:false` > 默认 true

## 用户图层存储

- `dupal_user_layers`：清单 `[{id, fileName}]`（永不被恢复/不恢复/开关删除）
- `user_geo_<id>`(IDB)：GeoJSON 数据 ｜ `user_<id>`(IDB)：搜索索引 ｜ `dupal_user_layer_<id>`：勾选状态
- **关键坑**：`"dupal_user_layers".indexOf("dupal_user_layer_")===0` 为真 → 清除循环曾误删清单，已显式排除

## 经纬度格网（v5 终版）

- 插件：leaflet/Leaflet.Graticule 官方 `L.latlngGraticule(opts)`，Canvas 全幅绘制
- zoomInterval：1-3:30° / 4-5:10° / 6-7:5° / 8-9:1° / 10-11:0.25° / 12-13:0.1° / 14:0.05° / 15-16:0.02° / 17-18:0.01° / 19-20:0.005°
- `latLineCurved:4`（纬线4段折线贴合 Mercator）；标签用原生 `showLabel:true`（地图内边缘）
- 浮点累加 bug：`__format_lat/lng` 加 `Math.round(lng*1000)/1000`
- 配色：网格线 `#8a8a8a`，标签文字浅色 `#333`/深色 `#eef0f3`，opacity 0.8
- 深色模式联动：`rebuildGraticuleTheme()` 重建换色

## Cesium 3D 集成（2026-08-16 已实现）

- **数据互通确认**：`GzIdbLoader.fetch()` 返回标准 GeoJSON → `Cesium.GeoJsonDataSource.load()` 直接消费，零转换
- **架构**：双引擎共享数据层 — featureCache + geo-config 复用，Leaflet 2D / Cesium 3D 并行，toggle 切换
- **新增文件（4 个）**：`cesium-viewer.js`（编排+懒加载+相机同步+底图映射）/ `cesium-geojson-adapter.js`（featureCache→Entities+样式映射）/ `cesium-terrain.js`（Ion Token+World Terrain）/ `cesium-container.css`（容器样式）
- **Cesium CDN**：v1.125，`CESIUM_BASE_URL` 指向 `https://cesium.com/downloads/cesiumjs/releases/1.125/Build/Cesium/`；后续可改为自托管 `./assets/cesium/`
- **懒加载**：`cesium-viewer.js` 的 `activate()` 首次调用时 `document.createElement('script')` 动态加载 Cesium.js ~4MB
- **容器**：`#cesiumContainer` 与 `#map` 同位置叠放，`body.view-3d-active` 类切换 display
- **geojsonloader 钩子（7 处）**：onDataLoaded（缓存命中+新加载）、removeGeoJSONLayer、用户图层 load/remove/checkbox toggle、selectAll/unselectAll
- **状态桥接**：`window._ogv_layerColorMap/_ogv_colorMode/_ogv_fieldKey/_ogv_layerOpacityMap/_ogv_cesiumConfig` 只读暴露给 adapter
- **相机同步**：`zoomToHeight(lat,zoom) = 40075016*cos(lat)/2^zoom`；`heightToZoom` 反向
- **底图映射**：天地图→UrlTemplateImageryProvider、ArcGIS→ArcGisMapServerImageryProvider、GEBCO→WebMapServiceImageryProvider、OSM→OpenStreetMapImageryProvider
- **view3dToggle**：`enable(userInitiated)` 仅用户主动点击才激活（避免页面恢复加载 4MB）；`deactivate()` 反向同步相机到 Leaflet
- **geo-config 3D 扩展**：可选 `cesium: { extrudeHeight, clampToGround, pointPixelSize }`，存入 `window._ogv_cesiumConfig`
- **优势**：Cesium 原生球面渲染无需反子午线三副本；IDB 缓存两引擎共享
- **详细方案**：`docs/cesium-3d-integration.md`
- **关键坑（已修）**：① `Cesium.Cartesian.fromDegrees` 漏写 `3` → TypeError；统一用 `window.Cesium.` + `getCartesian3()` 回退（从 camera.position.constructor 获取）② 贴地面 outline 不支持 → clampToGround 时 `outline=false` ③ `markerSize` 直接传数值，不需要 `Cartesian2.fromElements`
- **3D 交互（第二轮）**：`flyToFeature(feature)`（包围盒→flyTo 点/矩形）供缩放至/搜索结果定位；`reloadLayer(checkboxId)` 颜色模式变更后重建数据源；点击拾取用 `ScreenSpaceEventHandler LEFT_CLICK + scene.pick`，entity 存 `_ogv={layerId,featureIndex,fileName,layerName}`，弹窗复用 `GeoUtils.buildPopupContent`
- **颜色一致性**：adapter `getFeatureColor` 复用 `GeoUtils.getFeatureColorByIndex/Field`；`parseColor` 用 `Color.fromCssColorString` 兼容 hsl/rgb/hex
- **底图 3D 联动**：`window._currentBasemapName`（index.html 暴露）+ `baselayerchange` → `CesiumViewer.syncBasemap()`
- **地形数据源**：Ion Token 优先 → `ArcGISTiledElevationTerrainProvider.fromUrl(WorldElevation3D/Terrain3D/ImageServer)`（公开免费）→ 平坦椭球体
- **提示**：3D 操作提示用 `showToast` 弹窗显示 5s（不再用 `#cesiumModeIndicator` 常驻提示条）；`view3dToggle` label `3D 视图🧪`
- **第三轮坑（已修）**：① `ArcGisMapServerImageryProvider` 在 Cesium 1.125 CDN 下 `getDerivedResource` undefined bug → 改用 `UrlTemplateImageryProvider` + `tile/{z}/{y}/{x}` 直接瓦片端点 ② `addLayer` 幂等（已存在跳过），避免 syncAllLayers/onDataLoaded 重复 remove+add 闪烁 ③ `view3dToggle` 状态刷新后由 `cesium-viewer.js` 的 `autoRestore3D()` 自动进入 3D（app.js `initToggle` 恢复勾选 + `enable(false)` 静默恢复不拦截）
- **3D 覆盖层**：天地图瓦片覆盖层（ibo_w/cva_w/cia_w/cta_w）通过 `OVERLAY_LAYERS` 映射 + `syncOverlays()`（`UrlTemplateImageryProvider`）叠加到底图之上；`window.getCheckedOverlays()`（index.html）+ `overlayadd/remove` 联动；`syncBasemap` 重建底图后重叠加
- **2D popup 按钮**：`.popup-ext-btn-wrap` 横排文字按钮（⚲ 缩放至 / 📋 详情），插入到 `.leaflet-popup-content` 内部（`.feature-popup` 之后、图层名 footer 下方），与 3D 悬浮窗一致（不再 `container.appendChild` 到 `.leaflet-popup` 外层）
