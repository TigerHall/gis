# Long-term Memory for OGV Project

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
- `window.loadFileAsUserLayer` 现由 `assets/file-handler.js` 定义（原在 `index.html` 主脚本中，已拆出）
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

## File Architecture (2026-06-07 重构后)

```text
assets/
├── geo-utils.js        (405行)  纯函数工具库（颜色/坐标/样式/弹窗）
├── geo-config.js       (97行)   图层路径与分组配置（通过 window.* 全局暴露）
├── geojsonloader.js    (3366行) 核心：图层加载/样式/高亮/交互/搜索/文件上传
├── file-handler.js     (463行)  外部文件导入（loadFileAsUserLayer/drag-drop/PWA launch）
├── app.js              (705行)  应用管理（版本号/导出/SW/剪贴板/记住图层/toggle 渲染 + toggleConfig）
├── dialog.js           (401行)  全局弹窗组件（showToast/closeToast/showMarkdown）
├── pointdrop.js        (599行)  投点编辑器
│
加载顺序:
  <head>: dialog.js → geo-config.js
  <body>: 主脚本 → app.js → geojsonloader.js → file-handler.js → pointdrop.js
```

## Toggle 开关系统（数据驱动）

- 所有开关定义在 `app.js` 的 `TOGGLE_GROUPS` 数组中（文件头部），新增开关只需加一项
- `toggleConfig` 统一管理持久化 + 懒加载（scale/mousePos/Geoman 用时才创建）
- 控件初始化顺序：鼠标坐标 → 编辑测量
- `persistLayerCheckState(cb, checked)` 处理全选/全不选操作的持久化
- `dataset.persistentId` 用于用户图层 checkbox 的 localStorage key 查找

## 面板布局

- `layer-panel`：flex column，标题 + 拖拽手柄（顶部固定）、panel-scroll（中部滚动）、#appVersion（底部固定）
- `panel-scroll` 统一滚动地图设置 + 搜索栏 + 图层列表
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

## Leaflet.VectorGrid 技术备忘（2026-06-04 测试，暂未合入主应用）

### 适用场景

用 `L.vectorGrid.slicer()` 替代手动三副本 `shiftLng()` + `L.geoJSON` 渲染大规模面/线数据。
VectorGrid 自动处理世界循环（跨 180° 反子午线重复），无需手动偏移坐标。

### 关键踩坑：fill 不可见

- **根因**：`L.SVG.Tile` 重写了 `onAdd = L.Util.falseFn`，导致 `_drawing` 从未设为 `true`；而 `_updatePoly()` 起始有 `if (!this._drawing) return;`
- **后果**：所有 fill 渲染被跳过，只有 stroke 可见
- **修复**：`rendererFactory` 中设置 `r._drawing = true`

```js
rendererFactory: function(tileCoord, tileSize, opts) {
    var r = L.svg.tile(tileCoord, tileSize, opts);
    r._drawing = true;
    return r;
}
```

### 其他注意事项

- 样式函数必须显式写 `fill: true, stroke: true`
- 每要素散色：`(props.FID || props.OBJECTID) * 137.508 % 360`（黄金角）
- `interactive: true` + `.on("mouseover", fn)` 可用，`e.layer.properties` 为 GeoJSON 属性
- 不要用 `L.canvas.tile`（`L.DomEvent.fakeStop` 兼容报错），用 `L.svg.tile`
- popup 属性名要按数据实际字段匹配（如 `plate`、`Name` 等）

## Layer Group UI: `<details>` + `<summary>` 方案

- 2026-06-06 从自定义 div（`.layer-group-header` + `.layer-group-children` + JS class toggle）迁移到 `<details>` + `<summary>`
- 普通点击折叠/展开由浏览器原生处理，无需 JS
- Ctrl/Cmd+点击：`e.preventDefault()` 阻止原生 toggle，手动遍历所有 `details.open`
- 总开关全选：`details.open = true`（替代 class toggle）
- 组全选勾选：`groupDetails.open = true`（替代 class toggle）
- 箭头旋转：CSS `details[open] .layer-group-arrow` 自动控制，无需 JS
- CSS 移除 `max-height: 0/600px` 动画，`details[open]` 原生控制显示
- `.layer-panel { font-size: 0; line-height: 0 }` + `.layer-panel > * { font-size: 13px; line-height: normal }` 消除 DOM 空白文本节点在 flex 布局下的匿名 flex 项间隙（这是地图控制面板上方多余间距的根因）
- `details.layer-group { margin-bottom: 6px }` 图层组之间保持呼吸感
- `#layerItemsContainer { border-top: 1px solid #e4e8e4; padding-top: 6px }` 图层组区域上方灰色边界线
- `.toggle-section { margin-top: 0; margin-bottom: 4px }` 紧贴标题行
- `#selectAllRow { padding: 7px 12px 2px }` 减少底部间距，标题行更紧凑
- 地图控制面板自动折叠：监听 `.layer-panel` 的 `click` 事件，点击 toggle-section 外部时折叠（不受 Leaflet stopPropagation 影响）
- 首次访问自动展开，折叠后持久化到 localStorage，后续不自动展开
- Dialog 模态遮罩点击关闭：`dialog.addEventListener("click", e => e.target === dialog && dialog.close())`
- ⓘ 关于链接改为 `showMarkdown("README.md", "关于本站")` 弹窗渲染
- 地图控制面板 (`toggle-section`) 位于搜索栏上方，`overflow: hidden` 裁剪圆角，`border-radius` hover 分两种状态
- 点击 toggle-section 外部区域自动折叠（100ms 延迟后激活），持久化到 localStorage

- test.html 和 index.html 均已添加公安备案链接
- 图标路径：`./assets/images/备案编号图标.png`
- 图标样式：`vertical-align:-2px;height:1em;margin-right:3px;`（-2px 对齐中文字体）
- 绿色圆点可点击下载 GeoJSON（`downloadLayerGeoJson` + `triggerDownload`）
- 预置图层：`searchIndexMap[cbId].features` → `GzIdbLoader.fetch(filePath)`
- 用户上传图层：`userLayerGeoJson[uid].geoJsonData`
- 投点生成的图层也可通过此方式下载保存

## Sidebar Layout Restructure

- 2026-06-06 侧边栏重构为四个区域：顶部标题 → ⚙️ 地图设置 → 搜索框 → 📑 图层要素（预制数据） → 🗺️ 本地图层查看（用户上传+投点）
- 本地图层查看面板新增提示"数据仅在本机解析加载，不会上传至任何服务器"
- 地图控制重命名为"⚙️ 地图设置"
- 📑 图层要素面板带 ▶ 箭头和全选 checkbox
- ⓘ📌 在标题行右侧，flex-wrap: wrap 窄面板时换行到下方

## Upload Button: 合并为单按钮 + 弹出菜单

- 2026-06-06 将"上传矢量（单文件）"和"选择文件夹"两个按钮合并为一个"📤 上传数据"按钮
- 点击按钮向上弹出小菜单，包含"选择文件"和"选择文件夹"两个选项
- 内部仍保留两个隐藏的 `<input type="file">`（一个 accept 多文件、一个 webkitdirectory）
- 菜单弹出在按钮上方（`bottom: calc(100% + 4px)`），避免遮挡下方的图层列表
- 点击菜单外部自动关闭

## 付费高级功能（激活码）系统

- **激活码来源**：6 位数字激活码定义在 `app.js` 顶部 `_PR_CODES` 数组，每月更新
- **流程**：用户开启"高级功能"开关 → 弹窗输入激活码 → 验证通过后 `localStorage.setItem("ogv_premium_active", "true")` → 开关锁定为开启
- **激活码每月更新**（旧码从数组移除），已激活的用户 localStorage 不受影响，永久有效
- **多端同步**：激活成功后弹窗显示 QR 码（`?activate=CODE` 网址），手机扫码自动激活
- **URL 自动激活**：`?activate=837291` 参数在页面加载时自动检测并激活
- **清理保护**：`doRefresh()` 保留 `ogv_premium_active` 不被 `localStorage.clear()` 清除
- **付费门槛**：目前仅锁定下载 GeoJSON 功能（`geojsonloader.js` 中 `downloadLayerGeoJson` 的点击入口加 `premiumCheck()` 判断）
- **`window.premiumCheck()`** 供各模块调用检查激活状态
- **`window.showPremiumActivation(callback)`** 弹出激活弹窗
- **重置**：`window.premiumReset()` 清除激活状态

## MD 文档约定

- **MD 文档尽量不要用表格**（移动端阅读体验差，弹窗内滚动困难）。数据列表改用纯文本文字描述，每项一行 "**图层名** — 来源/说明"
- `showMarkdown()` 弹窗内正文段落使用 `text-indent: 2em` 首行缩进（仅 `#_mdBody > p` 直接子级段落），blockquote 内不缩进
