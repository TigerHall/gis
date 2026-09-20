# OGV 引擎内部细节（INTERNALS）
> MEMORY.md 的配套详情。动到这里对应的模块时先读本文件。
> 修订方式：改代码 → 同步改本节被影响的那一条，别重排。

## A 测量 / 绘制（Geoman + `measure-tools.js`）
- 形状名是 **`Line`** 不是 `Polyline`。
- **圆 = 点一下定圆心 → 再点一下定半径**（不是按住拖）→ 实时读数须读 Geoman 内部态（`Draw.Circle._layer/_centerMarker/_layerGroup`），别自己记 mousedown 圆心。
- 距离/半径读数走 `L.LatLng.distanceTo()`（纯经纬度球面）= **与 CRS 无关**，换投影不用改。
- **测量时不点选要素**：`body.ogv-drawing`（`pm:drawstart` 加 / `pm:drawend·drawstop` 去；`drawstart` 还要 `map.closePopup()`）。
  ⚠️ **必须堵两条路径**，只做一条会「能吸附但一点就弹悬浮窗、点不了设置点」：
  1. **DOM 层**：CSS 对 **pane + 可交互元素本身**各关一次，且**全带 `!important`**。
     只关 pane **无效** —— `pointer-events` 虽可继承，但**元素自身声明优先于继承值**：
     `leaflet.css` 的 `path.leaflet-interactive{pointer-events:auto}` 与本项目
     `path.hit-area{pointer-events:stroke!important}` 都把 pane 的 none 顶掉 →
     点 marker（无自身声明）能屏蔽，**线/面要素照样可点**。选择器须含 `.leaflet-interactive`
     与 `.hit-area` 才能压过后者。另：**popup pane 也要关**（关掉后点击穿透到容器，落点不被吃）。
     别碰 `.leaflet-control-container`（map-pane 的**兄弟**）→ 工具条/缩放条保持可点。
  2. **Canvas 层**：`Leaflet.MarkersCanvas.js` 的 `_fire` 是**自己监听 `map` 的 click/mousemove**
     + RBush 命中检测，CSS 拦不到（点击穿透到容器后 map click 照旧触发）→ 弹属性窗、
     命中聚合簇还会 `map.setView` 跳级缩放、并把光标改成 pointer 盖掉十字准星。
     已在 `_fire` 开头用 `OGVMeasureTools.isDrawing()` 加闸。
- **圆的半径弹窗**也要随 popup pane 一起被关掉 → `registerCircle()` 在 `openPopup()` 前显式 `setDrawing(false)`。
- **吸附不受影响**：Geoman 吸附是几何计算，不靠 DOM 命中。
- ⚠️ **Leaflet 里 `L.Circle = L.CircleMarker.extend({...})`** → 判「地理圆 vs 像素圆」**只能写 `instanceof L.Circle`**；写 `&& !(x instanceof L.CircleMarker)` 恒为 false，会把米当像素（症状：弹窗显示「272060 px」、输入 300 圆不动）。字段也不同：Circle 用 `_mRadius`、CircleMarker 用 `_radius`。
- ⚠️ **Geoman 默认 `finishOnEnter:false` / `exitModeOnEscape:false`** → 纯键盘无法收尾（WCAG 2.1.1）。`app.js` `GEOMEN_GLOBAL_OPTS` 显式打开，走 `map.pm.setGlobalOptions()`；**`addControls()` 不吃这两个键**。
- 自定义工具条按钮：`map.pm.Toolbar.createCustomControl({name,block:"draw",className,toggle:false,onClick})`，**必须在 `addControls()` 之后**；重名会抛错，用标志位挡。弹窗里的按钮**不挂 onclick** → `document` 事件委托。

## B 2D 渲染
- Canvas(>3000点)：点 8px / hit 10px；RBush 仅 hit 检测；`updateColors()` 增量改色。DOM+聚类(≤3000)：divIcon 无 `setStyle`。
- **世界副本已在渲染层**（`assets/Leaflet.WorldWrap.js`）：数据只留 1 份 [-180,180]，副本是绘制期产物、k 无限（和瓦片一样循环）。
  - 矢量：补丁 `Polyline.prototype._project` → `multiplyRings()` 复制 `_rings` k 份 + 扩 `_rawPxBounds`；moveend/zoomend 比对 `layer._ogvWrapKs` **变了才** `redraw()`（Leaflet 平移不重投影，只 CSS 位移）。
  - DOM 点：`L.WorldCopyGroup`（extends `LayerGroup`，按 k 池化 `factory(k)`，`maxPool` 上限，`sync()` 在 moveend/zoomend）。
  - Canvas 点：`MarkersCanvas v2.0` 空间索引改为**投影空间** `Float64Array _px` + k 循环；`pointOf` 是**每 k 一个函数**；`_animateZoom` 走像素 transform（`_latLngBoundsToNewLayerBounds` 在极地下会挂）。
  - 关键 API：`info()/periodPixels()/periodProjected()/viewRectProjected()/ksForRect()/normalizeLng()/toContainer()`。
  - ⚠️ `viewRectProjected()` = `map.getPixelBounds()` + `transformation.untransform()`，**不要再加 `getPixelOrigin()`**（`getPixelBounds()` 已在 latLngToPoint 空间；加了就整体偏一个 origin，症状：lng=360 时 ks 仍为 `[0]`）。
  - **`crs.wrapLng` 缺失（极地）→ period=0 → 自动关环绕**（否则副本落在无意义位置）。
- 光标读数的经度须 `WorldWrap.normalizeLng()` 再显示（`Leaflet.MousePosition.js`）→ 只出现 -180~180，不出现 456。
- 透明度递归 `applyLayerOpacity()`；`markerClusterGroup` 必须 `getAllChildMarkers()`。`reloadLayerWithNewMode` 第6参 `forceRebuild`：iconType/iconSize 变化必传 true。进度条 `updateLayerProgress(id,null)` **必须 removeChild 摘节点**。
- **pane 层级**（真源 `MAP_CONFIG.panes`）：`baseImagePane` 190 < 瓦片 200 < `demPane` 350 < 矢量 400 < 标记 600。**底图(单选)永远最底，覆盖层(多选)压在底图之上**。`L.imageOverlay` 默认落 `overlayPane(400)` → 必须专用 pane。
- **`L.Control.Layers` 逐图层绑 `add/remove`**（不是 map 的 layeradd）→ `map.removeLayer()` 也触发 `overlayremove`，被动移除须 `_suspendPersist` 挂起写盘，否则记忆被清空。
- **图层上色**：面不写 `colorMode` 默认 `"sequential"` → **要单色须同时写 `color` + `colorMode:"single"`**。面**填充硬上限 0.45**，描边用未截断 `layerOpacity` → 两者不同步。面描边色**硬编码 `#555`**；线要素 `color` 直接是线色。
- 图层开关在设置面板（`input[type=checkbox][id^="layer_"]`），Leaflet 图层控件只剩底图。单图层用户设置优先：`localStorage["dupal_layer_set_"+checkboxId]` 的 `colorMode/colorValue/opacity/iconValue/selectable/labelField` 会盖掉配置 → 改配置不生效先查这里。

## C 要素弹窗（Popup）
- **不要给 `.popup-ext-btn` 挂 onclick**：Leaflet 复用 Popup 时 `setContent/update` 重写 innerHTML → 新按钮没 onclick，且 `openOn` 命中 `hasLayer` 直接 return。现行：`popupopen` 只登记 WeakMap(容器→popup) + `document` click 委托 → `closest(".leaflet-popup")` → 点击时才 `resolvePopupTarget(popup)`。
- **要素一律点击时现取，不缓存**（esri 复用弹窗会「点 B 出 A」）。**开窗走 `openFeaturePopup()`（新建 `L.popup()` + `openOn`）**，不用 `bindPopup().openPopup()`（会装两次 click → 一次点开两次窗）。DOM marker 保留 `bindPopup`（键盘可达）但不再手动 `openPopup()`。
- ⚠️ **`L.popup().openOn(map)` 【同步】触发 `popupopen`** → 自定义属性须在 `openOn` **之前**赋值。
- esri FeatureLayer 走 Leaflet 自带 `bindPopup`；`_source` = 视口生成的子图层；图层 id/名要在**弹窗内容函数里**贴到子图层。`map.addLayer()` 后须再产生一次 moveend/zoomend 才拉要素。

## D Cesium 3D
- 共享 featureCache 直喂 `GeoJsonDataSource.load()`；CDN v1.125。Point 用 billboard；ArcGIS 走 `UrlTemplateImageryProvider` + `tile/{z}/{y}/{x}`；聚类 Label 须 `CENTER/CENTER/pixelOffset=ZERO`。
- **`CLAMP_TO_GROUND` 是卡顿元凶** → 点默认 `"none"`，显式 `"live"` 且 ≤300 才贴地。**Z 坐标须压平**：`GeoJsonDataSource` 读到第三分量就走 `perPositionHeight` → 接边穿插，加载前 `CesiumGeoJsonAdapter.normalizeGeometryZ()`。
- 关→开瞬时：取消勾选只 `ds.show=false` + 挪 `cesiumHiddenCache`(LRU 12)；`reloadLayer/All` 须 `destroyLayer`。聚类气泡不吃 `updateOpacity` → dataSource 上记 `_ogvOpacity` 手动同步。
- 图标用 2D 同源 `getIconFactory` 转 SVG data-uri；面填充 `min(opacity,0.45)`；面边界 `#555`；聚类 `pixelRange=28,minSize=4`。深色下大气三件套全关。
- ⚠️ **`zoomToHeight`/`heightToZoom`（`cesium-viewer.js:415/423`）含 `Math.cos(lat)`** → lat→±90 时 height→0、zoom→-Infinity → **极地必崩**；且 Mercator 下本应为 `1/cos(lat)`，此式本身有偏差。用 `map.getScale()` 替代。
- 性能：慢在下载(94.6%)不在构建。`globe.maximumScreenSpaceError=2` + 天地图 t0~t7 → 6.8s/锐度568。自托管 `assets/cesium/Cesium.js`，SW 不预缓存。
- ⚠️ **南北极「空洞」= 地形覆盖不到极点，不是影像缺失 → 垫影像无效，别再做**（v3.0.10 结论，注释留在 `cesium-viewer.js` `syncBasemap()` 上方）：
  - 默认地形 ArcGIS World Elevation 3D 是 **Web Mercator 瓦片**（矩形上限 ±85.0511°）。转储 `globe._surface._tilesToRender`：相机停在 89.5°N 时视锥内纬度 >80° 的地块只有一个 `L1 lat[0,85.05]`，**极点附近一个地块都没有** → 像素直接露星空。换 `EllipsoidTerrainProvider`（覆盖 ±90°）后立刻出现 112 个 `lat[84.37,90]` 地块。
  - 三条垫图路线全部无量纲效果：极冠条带 20°~90° / 全球单张 ±90°（`SingleTileImageryProvider`）均 97.8% 近黑；手写「任何瓦片返回同一张图」的 provider = 100% 黑。
  - **单层底图时近黑 0%** —— Cesium 会把基底层边缘瓦片拉伸盖住极点（`_isBaseLayer` + 交线退化）。**一旦在底下多垫一层，这个兜底反而失效**（0% → 100%）。所以「垫图」不但没用，还是有副作用的。
  - 真能解的两条路都不是垫图：给 Cesium ion token（Cesium World Terrain 覆盖 ±90°）或进极区切椭球地形 —— 都改变地形表现，用户已明确「加不了就算了」。
- ⚠️ **验收 3D 底图别用「停用→再启用」序列**：该路径下 `imageryLayers` 会缺少基底层（既有怪癖，与底图逻辑无关）。**要在 3D 已激活的状态下切 2D 底图**，让 `baselayerchange → syncBasemap()` 实时触发，才能看到 `[基底层, 覆盖层…]` 的正常分层。

## E 数据渲染通用坑
- **数据不是代码：属性值一律按纯文本渲染**。字段来自 SHP/KML/ArcGIS，常整段是 HTML 且被 DBF 255 截断（实例 `volcanos.geojson` 的 `LAYER`）。直接拼 innerHTML 三后果：① 未闭合标签吃掉后续标记（`.popup-ext-btn-wrap` 被解析进 `<td>` → 按钮错位 33px）② 字段里 `<img>` 真发请求 ③ XSS。
  - **唯一收口 = `geo-utils.js` 的 `buildPopupContent`**（10 个调用点）：转义 → 剥标签 → 折叠空白 → 空字段整行不渲染 → 超 200 字符截断。`_getLabelText`/`_bindPermanentLabel` 已加 `_escapeLabelText`。`layer.popup` 按 `file` 从 `window.geoJsonGroups` **惰性建索引**。诊断：看 `.popup-ext-btn-wrap` 祖先链有没有 `TD/TABLE`。
- **TDZ**：对外只暴露延后调用的 getter。WMS 须支持 EPSG:3857（`L.TileLayer.WMS` 的 `crs` 默认取 `map.options.crs.code` → 换 CRS 时 WMS 会自动改发 `SRS`）。
- **GzIdbLoader**：gzip → IndexedDB（DB v2，key=URL）；仅 .gz；**`setCache` 必须 await**。倒排索引 tokens 用 `Object.create(null)`。
- `exportMapImage()`（html-to-image）须隐藏 `#waybackBar` 与 `#ogvRadiusChip`；激活码在 `app.js` `_PR_CODES`。程序化改 `checked` 要 `dispatchEvent(new Event("change",{bubbles:true}))`。

## F 极地视图 / 极地图源细节
- **GEBCO 官方 WMS 不支持极地 SRS**（`wms.gebco.net/2025/mapserv` 传 `SRS=EPSG:3413/3031` 返 `InvalidSRS`，也无极地瓦片端点）→ 只能离线预烘。`north-polar`/`south-polar` 端点历史上实测 **18.2 s/瓦片**，即使可用也太慢，别当主力。
- **GIBS 极地 WMTS**：`https://gibs.earthdata.nasa.gov/wmts/epsg{3413|3031}/best/{layer}/default/{matrixSet}/{z}/{y}/{x}.jpeg`，`{z}` = 我们的 zoom 直接对应（不需要 ±1）。矩阵集共 4 套 `1km / 500m / 250m / 31.25m`，原点一律 `(-4194304, 4194304)`、**512px 瓦片**；而 `BlueMarble_ShadedRelief_Bathymetry` / `_NextGeneration` / `_ShadedRelief` **只挂 `500m`**（level 0 = 2×2 → level 4 = 32×32，逐级分辨率减半，level 0 = 8192 m/px）。**z ≥ 5 直接 400**，必须靠 `maxNativeZoom: 4` 夹住。矩阵集清单可用 `probe-gibs-matrices.js` 从能力文档复读。
- ⚠️ **`putImageData` 不改变画布尺寸、也不缩放**（1:1 覆盖写，超出部分裁掉）→ 预烘脚本必须先把 `canvas.width/height` 设成**输出**尺寸再 put；否则导出的是被压扁的窄带，而脚本自报的尺寸还是「输出尺寸」（`make-polar-gebco.js` 曾自报 1024×1024 而文件实际 1536×222）。**自报尺寸不可信**：从 JPEG 字节流读 SOF 标记里的宽高对账。
- GEBCO 源图取法：`EPSG:4326` 极冠整条（北极 lat 38~90、南极 lat -90~-38）一张 WMS GetMap；**宽度别超 1536**（2048 会被服务端掐断），失败重试 3s·n 退避。想更清晰要按纬度切多条带分别取图再拼。
- ⚠️ **契约：`resolutions.length ≥ maxZoom + 1`**。proj4leaflet 的 `scale(z)` 就是 `_scales[z]`，缺项 = `undefined` → `getZoomScale()` 除出 NaN → `_pxBoundsToTileRange()` 非有限 → 抛 `Attempted to load an infinite number of tiles`。`zoomSnap:0` 会插值 `_scales[z+1]`，所以不是「最大级不能用」而是**滑到 maxZoom 附近就崩**。引擎 `maxZoomFor()` 取 min 并告警兜底。
- ⚠️ **绝不给极地瓦片层设 `bounds`（经纬度包络）**：**极点在正方形内部、不在边上** → 只采样四边得到「纬度环带」，靠近极点的瓦片（60°~90°）与之不相交 → `_isValidTile()` 全 false → **一块瓦片都不出**。越界拦截已由 CRS `bounds` → `_globalTileRange` 免费提供（实测 = GIBS z2 的 8×8）。
- ⚠️ **极地下 `map.getBounds()` 退化成零高度纬度线**：极点居中时视口四角到极点等距 → Leaflet 只取两个对角点 → latMin==latMax。**聚类 / MarkersCanvas / 大图层视口过滤全部整批丢要素**（症状：底图和线都在、点一个不显示），`.pad(1)` 对 0 高度无效。**修在地图实例层**（`patchBounds`：沿视口矩形 5×5 网格在**像素空间**采样；极点在视口内时纬度取 ±90、经度写 -180~180）。判据：**漏必须 = 0**，「多」是极冠外接盒固有误差、可接受。
- 立体投影平面无限 → 中心钳制靠 `moveend/zoomend` 在**投影坐标**里夹；**不能用 `setMaxBounds(latLngBounds)`**（它拿东北/西南角各自投影，而极地经纬度极值不在角上 → 可平移范围算成 1/4，地图推不动）。
- 空间口径：**`getPixelBounds()` 是绝对像素**（`_getTopLeftPoint()` 已含 `-mapPanePos`），可直接喂 `map.unproject()`；只有 `layerPointToLatLng()` 需要 `+ getPixelOrigin()`。Leaflet map 实例**无法从容器反查**（属性不可枚举）→ 调试走 `PolarView._map()`。
- 极地下 `L.WorldWrap.periodProjected()` = 0 → 世界副本自动退化单份（跨 180° 线是**一条连续线**，坐标恒 -180~180）。
- ⚠️ **极地矢量渲染前必须「投影 → 裁剪 → 反投影」**（`PolarView.sanitizeVectorFeatures`）：全球面（板块）直接投会到 10¹³ m，一个 path 撑满全屏、把底图整个盖住（症状：极地视图里只有一片纯色）。流程 = 投影 → Sutherland–Hodgman 裁到 `imageBounds` 正方形 → 反投影回 lat/lng；环 bbox 与视口无交即丢；**外环被丢则整个面丢**（只剩洞会填成实心）。返回 `{features, stat:{total,kept,dropped,clipped,hit}}` 存 `state.geomStat[id]`。点要素走 `keepInPolar`（含 MultiPoint 子选）。

## G 底图管理（`basemap-manager.js`）- `kind` = `tianditu / arcgis / wms / tile / imageWorldCopy / wayback / esriFeature`；通用 `options`：`maxZoom / maxNativeZoom / minNativeZoom / opacity / pane`、`attribution`、`attachBoundary`、`cesium:{...}`；工厂 `tdt() arcgis() gebco() etopo() esriIsland()`。
- ⚠️ `ref` 判断须在 `kind` 校验**之前**；`findDescriptor()` 要顺 `ref` 取 `cesium`。3D 只调 `createImageryProvider()` / `createOverlayImageryProvider()`。
- 唯一硬编码 = 兜底 ArcGIS World_Imagery（配置空 / 语法坏 / 默认缺失 / 3D 无 cesium）→ **宁退影像不白屏**。
- ⚠️「天地图全球境界」与 `attachBoundary` **共用同一实例 = 刻意**（该复选框即国界显隐开关）。token 在 `SITE_CONFIG.tiandituToken` → `window.TDT_TK`。
- 加底图 = **1 处**：`BASEMAP_CONFIG.baseLayers` 加一条（含 `cesium`）。
- **「无底图」= 伪底图**（`BASEMAP_CONFIG.noneLabel`，v3.0.10）：一个空 `L.layerGroup([])` 混进 `allBaseLayers`，**靠 Leaflet 图层控件「底图区是单选」这一特性**自动卸掉上一张底图，不做手动遍历。位置固定在最后 —— `getVisibleBaseLayers()` 在「默认子集 / 更多底图」过滤**之后**追加，两种状态都在末尾。`noneLabel` 传空串 = 隐藏该项。
  - 状态外显 = `body.basemap-none`（`syncNoneState()` 在 `rebuildLayerCtrl()` + `baselayerchange` 各调一次），`main.css` 据此把 `#map` 背景从 Leaflet 默认 `#ddd` 换成 `--c-bg`（不换的话深色主题下会亮一块）。
  - 记忆照常：它就是个普通底图名，走 `OGVStorage.KEY.BASEMAP`。
  - 3D 侧靠导出的 `BasemapManager.noneName` 识别 → `CesiumViewer.syncBasemap()` 不铺影像，只留覆盖层。
  - ⚠️ 验收时若看到「无底图下还有瓦片 `<img>`」，先查**覆盖层**（如「天地图全球境界」，`z=18`）—— 覆盖层是用户勾选的，本该保留；底图瓦片（`z=19`）才是要归零的。

## H 极冠环与 `fixAntimeridian`（v3.0.9 修）
**症状**：全球面图层（大陆板块 `plate_cont` / 大洋板块 `plate_ocean` / `plate16`）在南北极
渲染错 —— 北极顶上一条**横贯全宽、边界笔直**的纯色平板带；南极冠**完全没有板块填充**。
主视图与极地视图都中招（主视图最显眼，因为有经纬网、易与地理对上）。

**根因**：`geo-utils.js` 的 `fixRingCoords()`（`fixAntimeridian` 的内层）对**极冠环**做了经度展开。

极冠环的写法（`plate16 #1` mp14.ring0，913 点；`plate_cont #130` mp1.ring0，783 点）：
```
… (-179.993,-87.368) → (-180,-88.676) → (-179.996,-89.499) → (-179.999,-89.999)
  → (-110,-89.999) → (179.999,-89.999) → (179.999,-88.730) → …
```
即「沿 ±180° 下到极点 → 在极点横移 → 沿另一侧上回」。Web Mercator 把 `|lat|>85.0511287798`
钳到 ±85.051，那一段横移于是**正好落在世界上下边上**；环就着地图边闭合，极冠被完整填充。

展开会 `-110 → 179.999` 这一步 290° 跳变折算成 **-70°**，横移段被折成原地往返的零面积尖刺，
环改成走一条**横贯地图的弦**闭合 → SVG 非零环绕**自我抵消** → 极冠整块消失。

**修法**：`fixRingCoords` 开头短路 —— 含 `|lat| ≥ POLAR_RING_LAT`(87) 顶点的环原样返回。
87 取在「真极冠」与「格陵兰最北 83.6°」之间。极冠环本来就已在 ±180° 切开，无跳变可展开。

**单环 A/B 结果**（`ring-ab.js`，南极冠 913 点环 6 个采样点 / 北极 `plate_ocean #61` 6 个）：
| 环的写法 | 南极命中 | 北极命中 |
|---|---|---|
| 原样（= 修后） | **6/6** | **3/6** |
| 展开（= 修前） | 1/6 | 1/6 |
| 极点吸附到 ±clamp | 1/6 | 1/6 |
| 展开 + 矩形裁剪（Sutherland–Hodgman） | 1/6 | 1/6 |
→ 「矩形裁剪」「极点吸附」两条候选全部否掉；只有「不展开」正确。

**同类脏数据（顺带记录，未单独修）**：
- `plate16 #1/#10` 等要素带一堆**零面积退化 6 点小环**（经度恒 180、跨度 0°、面积 0），
  是源数据里切反子午线留下的碎片，填充无影响，只是多几条 path。
- `plate_ocean #61` 的环**展开后跨 385.6°**（超过一圈 → 自交）；原样坐标下正常，
  所以不展开同时也顺手压掉了这个隐患。

**验证套路**：`probe-latscan.js` 沿纬线每 10° 经度扫「覆盖该点的面数」，南极 −68°~−86°
由全 0 → 全 1；`probe-overlap.js` 数叠加层数；`winding-check.js` 离线非零环绕对照。

**测量工具本身的三个坑（各骗到过我一次）**：
1. `path.getAttribute("d")` 正则取点会把**各子路径说平成一串** → 跨子路径产生假「长水平弦」。
   判「源数据有没有长段」要离线解析 ring，不要在 `d` 上做。
2. Leaflet `Polyline._containsPoint` 是**到边距离**判定，不是填充判定 → 「没命中」不等于「没填充」。
3. `svg.getScreenCTM()` 在**平移后过期** → 同一段 evaluate 里平移前后复用同一个 inverse
   会得到假阴性（我据此误判「世界副本平移后覆盖为 0」，靠截图才纠正）。每次采样前重取。
