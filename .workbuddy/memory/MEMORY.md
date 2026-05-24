# Long-term Memory for YuGIS Project

## Project Structure
- `index.html` loads `Leaflet.MarkersCanvas.js` for canvas rendering（原 `leaflet-markers-canvas-clustered.js`，已重命名）
- `Leaflet.CanvasMarkerLayer.js` and `leaflet-markers-canvas.js` are NOT used / deleted
- One canvas plugin is sufficient: `Leaflet.MarkersCanvas.js`

## Canvas Clustering Plugin (`Leaflet.MarkersCanvas.js`)
- **命名格式**：参照 `Leaflet.GzIdbLoader.js`，采用 UMD 格式（支持 AMD/CommonJS/全局变量）
- Hover cursor: `mousemove` event handler added, reuses `_fire()` for hit detection
- Mouse leave map: `_onMouseOut` resets cursor to ""
- Point radius: 8px (matching IODP DOM-rendered points)
- Hit area: 10px (cursor responsive)
- RBush spatial index for **hit detection and viewport culling only**（聚类已改用 Grid 网格）
- **聚类算法**：Grid 网格预聚合（O(n)），替代原 DBSCAN（O(n²)）
  - `clusterRadiusPixels = 100`（屏幕像素）
  - 单点保留原始坐标，避免质心偏移视觉漂移

## File Upload Loading Animation
- 三种上传方式（按钮选中、拖入、PWA 文件链接）统一调用 `window.loadFileAsUserLayer(file)`
- `window.loadFileAsUserLayer` 在 `index.html` 中定义并挂到 `window`，内含 `showLoading`/`hideLoading`
- `geojsonloader.js` 中 `handleFileUpload` 直接调用 `window.loadFileAsUserLayer(file)`，不再重复 new FileReader

## GeoJSON Loading & Caching
- `Leaflet.GzIdbLoader.fetch()` caches decompressed JSON in IndexedDB (DB_VERSION=2)
- Cache key is the file URL (e.g., `./assets/geojson/pic.geojson`)
- On cache hit: returns parsed JSON directly (no decompression needed)
- On cache miss: fetches gz → decompresses → parses JSON → caches
- **搜索索引缓存**：IDB `searchIndex` store 存储 tokens 倒排索引，刷新页面后直接恢复
- **COS 加速**：`geoJsonCosPath` 全局配置，所有图层默认 COS，`localFallback` 自动计算
- **Gz-only**：仅加载 gz，不回退 JSON

## Critical Fix: Layer Cache Persistence
- **Problem**: `removeGeoJSONLayer()` set `layerCache[checkboxId] = null`, causing full rebuild on every uncheck/re-check
- **Fix**: `removeGeoJSONLayer` only does `map.removeLayer()`, does NOT clear `layerCache`
- `loadGeoJSONLayer` hits cache → just `addTo(map)` (no rebuild)
- `reloadLayerWithNewMode` now uses **incremental color update** for Canvas layers (all modes: single/sequential/field)
  - Uses `canvasFeaturesCache` properties + `getFeatureFillColor()` to recolor in-place
  - Calls `canvasLayer.updateColors()` (new API) which only redraws without rebuilding RBush
  - Falls back to full rebuild only if `cachedFeatures` is missing

## Large Dataset Search (Inverted Index)
- `searchIndexMap` stores inverted index per layer: `{ checkboxId: { tokens: { tok: [idx, ...] }, features: [...] } }`
- `buildSearchIndex(cbId, features, callback)` — 异步函数，先查 IDB 缓存恢复 tokens，未命中才重建
- Tokenization regex: `/[^a-z0-9\u4e00-\u9fff]+/` (supports Chinese + English)
- Multi-word search uses intersection of token result sets, limited to 30 results
- **模糊搜索**：精确匹配无结果时，对索引 keys 做 substring 匹配兜底
- **IDB 缓存**：tokens 存 IDB `searchIndex` store（DB_VERSION=2），`GzIdbLoader.getSearchIndex/setSearchIndex`
- **tokens 对象必须用 `Object.create(null)`**：普通 `{}` 有原型链，PBDB 数据中 `"constructor"` 等 token 会命中原型属性导致 `push is not a function`
- **COS 加载**：所有图层默认 COS，`localFallback` 自动计算，gz-only（不回退 JSON）

## Anti-meridian Strategy: Three-Copy (WorldCopy) Approach
- **不再使用 `fixAntimeridian`**（已从 `geojsonloader.js` 全部移除）
- 采用三副本方案：每个 feature 在原始位置 + 偏移 360° + 偏移 -360° 各渲染一份
- `buildGeoJsonLayerGroup` 第 374 行已有此逻辑：`offsets = [-360, 0, 360]`
- 线/面始终做三副本；点要素只在 ≤1万时做副本（避免内存爆炸）
- `geo-utils.js` 中的 `fixRingCoords`/`fixAntimeridian` 代码保留但不再被调用

## IODP Point Reference
- DOM-rendered points (via `L.circleMarker`): radius = 8 (non-volcano), 5 (volcano)
- Canvas-rendered points: radius = 8 (updated from 6 to match DOM version)
- Hit area should be slightly larger than radius (10px for 8px radius)

## Label / Tooltip System
- 线/面要素：`onEachFeature` 中用 `bindTooltip(name, { permanent: false, direction: 'center' })`，hover 显示
- 点要素：`createPointMarkerByType` 传 `labelText`（当前为永久标签，计划改 hover）
- 标签开关 `labelEnabled` 全局控制，`labelToggle` checkbox 联动
- 聚类开关 `clusterEnabled` 仅影响点图层（`if (isPoint)` 内）

## Point Drop Editor (`assets/pointdrop.js`)
- 表格列宽：按列名字符数+1ch 动态计算，`min(60px, Nch)`，`table-layout:fixed`
- 粘贴框固定尺寸：`252px × 48px`，`resize:none`
- 全局粘贴监听：`paste` 事件 + `visibilitychange`/`focus` 主动读剪贴板
- `_lastClipText` 防重复：paste 和 `tryReadClipboard` 两个入口均检查
- 自动展开侧边栏 + 滚动到编辑器 + Toast 提示

## Layer Status Dot Download
- 绿色圆点可点击下载 GeoJSON（`downloadLayerGeoJson` + `triggerDownload`）
- 预置图层：`searchIndexMap[cbId].features` → `GzIdbLoader.fetch(filePath)`
- 用户上传图层：`userLayerGeoJson[uid].geoJsonData`
- 投点生成的图层也可通过此方式下载保存
