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

## I 本机测试工具链（Playwright / 脚本套路）
- Bash 工具 PATH 为空 → 命令前
  `export PATH="/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/bin:$PATH"`。
- Node：`C:/Users/hehu/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`；脚本放 `.workbuddy/artifacts/`，
  头 `module.paths.push("C:/Users/hehu/.workbuddy/binaries/node/workspace/node_modules")`。
- 带 Pillow 的 Python：`/c/Users/hehu/.workbuddy/binaries/python/envs/default/Scripts/python.exe`。
- 只有 **`playwright-core`**，没装 Playwright 自带浏览器 →
  `chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" })`。
- 本地静态服务重启用 Bash 的 `run_in_background`（`python -m http.server 8123`）；
  用 `(… &)` 起会立刻消失 → `ERR_CONNECTION_REFUSED`。
- 侧栏默认折叠（`#sidebarToggle` 未勾选 → 面板 `rect.x` 为负）→ 截图前先 `sidebarToggle.click()` 再 `pinBtn.click()`。
- 触发搜索用 `page.fill("#searchInput", q)`，直接设 `value` 不触发事件。
- `getComputedStyle` 会返回 transition 中间值 → 判样式前 `await 400ms`。
- Playwright 默认带 `--hide-scrollbars` → 量宽度假阴性，须 `ignoreDefaultArgs`。
- `page.evaluate(fn, arg)` 只序列化 `fn`：内嵌 helper 必须写在同一函数体内；
  返回 Leaflet 对象会报 `object reference chain is too long` → 用花括号函数体、不返回值。
- minified 单行文件别硬 grep → `node -e` 截 `s.slice(indexOf(k), +500)`；grep 的 `\{n\}` 在 Git Bash 报错。
- **SVG 元素没有 `.click()`** → `page.mouse.click(x,y)` 或 `dispatchEvent(new MouseEvent("click",{bubbles:true}))`。
- 假阴性 7 例：① transition 中间值 ② `--hide-scrollbars` ③ `typeof btn.onclick` 判委托按钮
  ④ case 间状态不复位 ⑤ 错误的 `instanceof` 组合筛图层 ⑥ 用旧 map 引用断言新 map
  ⑦ **zoom 动画中途量 `map.getBounds()`**（须等 `moveend`）。
- **画布错位的终极探针**：包一层
  `CanvasRenderingContext2D.prototype.drawImage` 打印实参 —— 一眼能看出 `NaN` 坐标
  （`drawImage` 对 NaN 静默返回，不报错）。ETOPO 全白就是这么抓到的（`dbg_etopo2.js`）。

## J 出图预览实时跟随 / 分辨率上限 / AI 入口 / 地名兜底 / PWA 提醒（2026-10-17, v3.5.0）

### J-1 出图预览实时跟随（`map-export-ui.js`）
四类事件源 → `liveRefresh(ms)` → `schedulePreview(ms, /*silent*/ true)`：
| 源 | 为什么是它 |
|---|---|
| `map.moveend` / `zoomend` | 构图变了 |
| `map.baselayerchange` / `overlayadd` / `overlayremove` | 换底图 / 开关覆盖层 |
| `map.layeradd` / `layerremove` | **矢量图层懒加载真正完成**。勾选只是开始下 gzip，`addLayer` 时数据才画上去 |
| `document` 的 `change`（**捕获阶段**，`el.contains(t)` 排除出图面板自己） | `<details>` 里的 checkbox 不冒泡，捕获能抓到 |

- 静默 = 不盖「渲染中」遮罩、不改 meta 文案，否则拖地图时会一直闪。
- `fullBusy`（下载/打印进行中）时预览直接让路，避免两个大 canvas 抢内存。
- ⚠️ **strict mode 陷阱**：`renderPreview` 里误用未声明的 `pendingSilent`（实为模块级 `_pendingSilent`）→
  IIFE 是 `"use strict"`，赋值直接抛 ReferenceError → **静默刷新一条都没跑，预览看着像「没实现」**。
  同类假阴性：只在 console 一闪，页面其它功能全正常。静默路径必须单独验。

### J-2 dpi 与画布上限
- 默认 **300**（150 打印发虚）；档位 96/150/300/600/**1200** + 自定义输入 30~2400。
- 上限：**单边 16384、面积 160M px**，超限按同一个 `s` **等比**压（旧代码分别 `min(6000)` → 宽高比例不一致会变形，
  且 1200dpi 静默失效）。A4 横版 1200dpi = 14031×9921（139M）刚好过。
- 提示行必须写「已压到 W×H（实际约 N dpi）」——否则用户以为出的是 1200dpi。
- 旧存档迁移：`saveState` 写 `_v:2`，读到时 `!saved._v || <2` 且 `dpi<=150` → 改成 300。

### J-3 AI 入口（`ai-chat.js`）
- 悬浮球 = `L.Control.extend({position:"bottomright"})`，**自动排在图层控件上方**（不用手算 bottom，也不和 3D/极地控件打架）；
  `L.DomEvent.disableClickPropagation` 防拖动地图；面板打开时 `display:none`。
- 显隐开关 = `app.js` 的 `aiFabToggle`（`dupal_toggle_aiFab`）。⚠️ app.js **先于** ai-chat.js 执行 →
  它的 `enable/disable` 里 `window.OGVAI` 可能还不存在；真正的初始值由 ai-chat 启动时读 `#aiFabToggle.checked` 决定。
- 快捷键 **Ctrl/⌘+K**（Ctrl+E 出图、Ctrl+F 搜索已占）；已开时只聚焦输入框、不关面板。

### J-4 地名（`assets/ogv-geocode.js` → `window.OGVGeo`）
- `search(keyword,{count,bound,level})` / `reverse(lat,lng)` / `ready()`；LRU 60 条；永不 reject（返回 `{ok,items,error}`）。
- 三级定位 `_locate`：站点矢量（可高亮属性）→ `PLACE_REGISTRY` → 天地图（只能定位）。
- ⚠️ **`mapBound` 必须钳到 [-180,-90,180,90]**：世界副本态下 `getBounds()` 会给 west=-190 / east=380，
  天地图收到越界值直接 **400**，一条都不返回（`_searchBound()` 就是干这个的）。
- ⚠️ 天地图这个 token 是**浏览器端权限**：服务端 `curl` 一定返回 `301012 权限类型错误`，联调只能用浏览器。
- 搜索框（`geojsonloader.js` 的 `renderResults`）：0 命中 → `autoGeoFallback(query)`（520ms 防抖 + `_autoGeoSeq`
  令牌防被后续搜索覆盖）→ 直接把天地图结果铺进结果框，标题「矢量数据无匹配 · 以下为天地图地名」。

### J-5 站点设置拨动（AI）
`_optionItems()` 扫 `#toggleBody input[type=checkbox][id]`（**主控件只有这一份**，快捷区是 `<button data-quick-for>` 无 checkbox）；
`_setOption` 改 `checked` + `dispatchEvent(new Event("change",{bubbles:true}))` → 持久化/副作用/快捷区同步全都走真实链路。
名字要 `_cleanLabel()` 去 emoji（`ICON_NOISE` 只盖三个图标，设置项里的 🧩🌐🧊▦… 全漏）。

### J-6 PWA 安装提醒（`assets/pwa-install.js`）
- 6s 后弹；**分享深链（`#focus/`、`?search=`、`?loc=`、`?bbox=`…）2.5s**；`standalone`/`appinstalled` 不弹；
  「以后再说」→ 静默 14 天 + 最多主动弹 3 次（`shownCount`）。
- 只有真拿到 `beforeinstallprompt` 才 `prompt()`；否则给分步图文（iOS：分享 → 添加到主屏幕）。
- 出图 / AI 面板开着 → 延后 5s 再试（右下角别叠三个浮层）。
- 样式自包含注入（`<style id="ogvPwaCss">`）：单个卡片不值得单开 css 文件再动 index/SW 清单。

## K 联网搜索 / 抓取（`ogv-websearch.js`，v3.6.0）
- **为什么要它**：天地图只回答「这个地名在哪」。问到「最大深度多少」「洋中脊热液喷口
  怎么形成」「某规范哪年实施」，天地图一条都返回不了 —— 那是 DeepSeek Search 的位置。
  它因此是地名链的**第四级**，不是替代品。
- **端点**（与 chat 同一个 Key、同一套 Bearer）：
  `POST https://api.deepseek.com/v1/tools/search` `{query,count(1~50),ori_question?,need_content?}`
  → `{results:[{rerank_score 0~3, title, url, snippet(~150字), summary(~700字), content, site_name, site_icon, date, authority -1~4}]}`
  `POST https://api.deepseek.com/v1/tools/fetch` `{url}` → `{title, content(Markdown)}`
  计费**按成功请求次数**（5 元/1000；失败/空结果不计），每账号 Search/Fetch 各 **5 QPS**。
- ⚠️ **search 没有 bbox / mapBound 这类字段** —— 别把天地图那套参数习惯带过来，只认 query。
- ⚠️ **浏览器直连可用**（与 chat/completions 同一 CORS 策略）。若被拦，`_post` 会把
  `TypeError: Failed to fetch` 翻成「网络不通（可能被浏览器拦截或离线）」并 `ok:false`，
  调用方退化成只用本地结果 —— 不会卡死。
- ⚠️ **它不产生坐标**。`_locate` 的第四级故意回 `ok:false` + `web[]` + hint
  「**图上没有这个名字（不许说已定位）**」：一旦回 `ok:true`，模型十有八九会顺手说
  「已定位到 X」，而地图根本没动。
- 省钱的三个闸：① 只在本地三级全空 / 模型主动调时触发（搜索框那颗按钮要用户点）；
  ② 内存 LRU 40 + 同 query 在途合并（`_inflight`）；③ 只给模型 `summary`，
  `content` 仅在 `need_content:true` 时才有；`web_fetch` 正文超 12000 字截断
  （否则一次工具结果就吃掉整个上下文）。
- **模型侧规则**（SYSTEM_PROMPT 第 7 条）：知识题直接搜、`locate` 失败时先声明没定位、
  摘要够就不 fetch、一次最多 fetch 2 条、结论后给 `[站点名](url)`。
  前端 `_md()` 因此加了链接规则（先 `_esc` 再套 `<a>`，只认 http(s)，URL 里的引号已转义）。
- ⚠️ **`QA_INTENT` 陷阱**：「马里亚纳海沟最大深度是多少」里有地名 → 旧直通会把它整句
  丢给天地图，POI 一命中就只回「已定位到马里亚纳海沟」，答非所问。凡是
  多少/什么/怎么/哪里/？…一律**跳过本地直通**直接进模型。

## L 模型名与思考模式（2026-10-17 核对官方文档）
- 官方现行型号名只有两个：**`deepseek-flash`**（Flash 线，= **DeepSeek-V4.1-Flash-1017**，
  1M 上下文、支持 tool calls、并发 2500）与 **`deepseek-v4-pro`**（Pro 线，= V4-Pro-0813）。
  `deepseek-chat` / `deepseek-reasoner` 是上一代命名，仍可调用但语义随官方重定向漂移。
- **思考模式 V4 默认开启**，且 `temperature`/`presence_penalty`/`frequency_penalty` 不生效
  （传了不报错也不管用）；强度用 `reasoning_effort`（low/high/max）。
- ⚠️ **带 `tools` 的请求，后续每一轮都必须回传 `reasoning_content`，漏传直接 400**。
  本项目 `messages.push(msg)` 是整条 assistant 消息入栈（含 reasoning_content），
  链路是通的；但为了延迟与成本，`THINKING = "disabled"`（`thinking:{type:"disabled"}`），
  关掉之后这条陷阱根本不会触发。

## M 出图「论文级」实现细节（v3.7.0，`map-export.js`）
- **两套坐标系**：纸面 `0..W, 0..H`（图框、图外标注）与内容区 `0..VW, 0..VH = W-2PAD`（地图）。
  `steps` 全程在 `translate(PAD,PAD)` + `rect(0,0,VW,VH).clip()` 里跑；**最后一步先 `ctx.restore()` 再 `drawFrame`**。
  ⚠️ 漏 `clip` 的典型症状：底图瓦片/屏幕标签糊进图框留白（纸上「边上有半截地图」）。
- `ptPx = (W ÷ (paperWidthMm/25.4)) / 72`（有效 dpi ÷ 72）。**只在没有 paperWidthMm 时**退回声明 dpi。
  预览 = `render()` 传缩小后的 width/height + 原样的 paperWidthMm → 有效 dpi 自动变小，与大图严格等比。
- `drawFrame(ctx, W, H, PAD, o, VW, VH, sf, {interval, labels, ptPx})`：
  `o.shiftX/shiftY` 是**内容区**偏移，所以刻度位置 `x = PAD + (lngToXc(lng))`；
  主刻度对齐经纬线、次刻度取 `(prev.p + p)/2`；标注间距下限 `fs*3.4`（太密宁可少标）。
- 装饰字号约定（pt）：经纬度 8、图例 8/标题 8.5、比例尺 7.5、图注编号 11、标题 11/副标题 8、版权 6、指北针直径 34。
- **两个只在导出图里才暴露的坑**：
  ① `PAD` 按比例算 → 高 dpi 下标注被裁（必须按 pt）；② 纬度标注遍历方向 → 间距判据要 `Math.abs`。
- 图例数据仍来自 `window._buildLegendData()`（与地图侧栏同源），符号只有 `color + geomType`，所以点要素画成圆点而非实际图标。

## N AI 会话与运行开关（v3.7.0）
- `_opt = {web, think}` 是**运行时真值**，存储只是镜像（`"true"/"false"`）。`open()` 会 `_loadOpts()` 重读 →
  任何「改了没生效」先怀疑存储格式，而不是怀疑 `_apiRequest`。
- `_toolsFor()` 是工具集唯一出口：`_apiRequest` 用它，`_execTool` 里另有**第二道拦截**（模型硬调也不放行）。
- 会话：`_saveSessions()` 只排防抖（400ms），`_flushSave()` 真写；`_curId` 为空且 `_msgs` 空时**不建记录**
  （否则历史里一堆空「新对话」）。标题 = 首条 user 消息 28 字。
- `OGVChatStore` 的 `_run(idbFn, lsFn)`：IDB 打开失败或事务失败都走 lsFn；`list()` 返回**不含 msgs** 的摘要。

## O PWA 安装状态 ⇄ 设置项同源（v3.8.0）
- **两套机制的交汇点**：`pwa-install.js`（外部事实）+ `toggleConfig`（UI 开关）。桥是三个 API：
  `isInstalled()`（真值）· `onChange(fn)`（广播）· `install()`（主动装）。
- **`initToggle` 的 `cfg.truth` 分支**：
  ```js
  if (typeof cfg.truth === "function") { checked = !!cfg.truth(); cb.checked = checked;
    S.safeSet(cfg.storageKey, String(checked)); cfg.syncStatus && cfg.syncStatus(checked); }
  ```
  之后仍走 `if (checked) cfg.enable(false)` —— 所以 **`enable` 必须判 `userInitiated`**，
  否则"恢复一个已安装状态"会再触发一次安装流程。这条对所有带 truth 的项都成立。
- **加载顺序**：`app.js` 先执行 → 渲染开关、`initToggle` 跑完（此时 `OGVInstall` 还不存在，
  `truth()` 返回 false）；`pwa-install.js` 加载完调 `window._syncPwaToggle()` 补正，并借这次
  调用订阅 `onChange`（`_pwaSubscribed` 保证只订一次）。因此 `syncPwaToggle` 必须**幂等**。
- **取消安装的回弹**：`_doInstall` 的 `userChoice` 变 `dismissed`、或走 `_showSteps()`（没有原生弹窗）
  都会 `_emit()` → 面板重算 → 开关回到 `false`。**不许停在 true**：那是在骗用户"装上了"。
- ⚠️ **`_showSteps()` 里的顺序陷阱**：主按钮先被改成 `data-pwa="later"`，紧接着
  `querySelector('.ogv-pwa-btn[data-pwa="later"]')` 会命中它自己 → 把「知道了」`display:none` 掉。
  正确顺序：先取出/隐藏**原来的** later，再改主按钮属性。
- **`neverAsk` 的边界**：它只管「自动弹窗」。`prompt()`（手动唤起提醒）受它约束，
  `install()`（设置项主动装）**不受约束**。混在一起的后果是「点了不再提示 = 从此装不了」。
- **已安装 = 不可逆**：浏览器没有卸载 API，所以已装时 `cb.disabled = true`；
  `disable()` 里按真值回弹（会有 toast 指路去浏览器菜单卸载），绝不能留下 `checked=false` 的假象。

## P 经纬网间隔自动选（v3.9.0，`map-export.js`）
- **根因**：`GRAT_INTERVALS` 照搬 `Leaflet.Graticule.js` 的 `zoomInterval`，**按整数 zoom 分档**
  （`{start:4,end:4,interval:10}`）。本项目 `MAP_CONFIG.zoomSnap:0`（无级缩放）→ `zoom=4.3`
  时每一档都命中不了 → 落到兜底 `1`：100° 宽的图画出 101 条经线，图框刻度成梳齿。
  标注跳号（61°E/69°E）是**次生症状**：1° 的格子太密，`minGap` 一格隔一格地丢。
- **现在**：`pickGraticuleIntervals(o, VW, VH, ptPx)` 在 `steps` 之前算一次，网格线（`drawGraticule`）、
  图框刻度与图外标注（`drawFrame`）**共用**。阈值按 pt 折算 ⇒ 与 dpi/纸面无关：
  经度 `≥4.0 字宽`（8pt 字要容下「180°E」≈2.5 字宽）、纬度 `≥2.2 字高`。
- ⚠️ **纬度的像素/度非线性**：取**最靠赤道那条边**（墨卡托那里最挤）→ 整幅图里没有一格小于阈值；
  取中段会让赤道侧挤、取极侧会让赤道侧丢标注。
- **两轴统一**：度数差 ≤1 档且两边都排得下 **≥4 条线** 时用同一个（格网才像「网」，格子不会变细长条）。
  长条图（3000×700）10° 会让短边只剩 2 条纬线 → 该条件下不统一（15°/10°）。
- 次刻度：半格 <16px 不画。`PAD` 同时受 `fs*3.2` 约束（`fs` 有 9px 下限，322px 预览里
  按 pt 算的留白小于字宽 → 左边「15°N」被裁成「5°N」）。
- 回归锚点：`report.graticuleIntervalDeg = {lng,lat}`、`report.frameTicks.dropped`（正常恒 0）。
  实测：全球 30/30、东亚 10/10、东经 120° 附近 2/2、舟山 0.2/0.2、竖版 10/10、长条 15/10。
