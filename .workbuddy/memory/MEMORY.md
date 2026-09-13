# OGV 项目长期记忆

## 项目定调：配置只有一份 `geo-config.js`（**做任何扩展/定制前先读这条**）

> 用户 2026-09-13 明确：**"定制的最小单位本来就是『一整份配置』= `geo-config.js`"。**

- **定制/扩展 = 换一整份 `geo-config.js`**，不是「换一份图层清单」。所以配置**必须是一个文件**（站点标题 + 主题色 + 路径 + 图层清单 + 地名表都在里面）。
- ⛔ **不得再拆第二份配置文件**。曾拆出 `assets/layers.js`，用户判定不必要 → 已合并回 `geo-config.js` 并删除。**将来若又想做「外置清单 / 远程清单 / 租户配置」，仍然只有这一个文件**，只是它的来源可以变（本地 → COS → 按 `OGV_TENANT` 选），**绝不新增第二个文件**。
- ⛔ **引擎（`geojsonloader.js` 等）不得硬编码任何站点级或图层级设定。** 今后凡「某个图层要特殊一点」「标题/主题色要换」「客户站只保留 3 个图层」这类需求，**一律落成 `geo-config.js` 的字段**，引擎只读字段。禁止再写 `if (fileName === "xxx.geojson")`。
  - 已清零，保持：`grep 'fileName === "' assets/geojsonloader.js` → **0**。
- ✅ **判断口径（以后照这个走）**：
  1. 能靠改 `geo-config.js` 达成的 → **只改配置**，不动引擎。
  2. 必须改引擎时 → **同步在 `geo-config.js` 补一个字段**，让下一个同类需求只用改配置。
  3. 新增/调整任何「扩展能力」（主题、标题、图层视觉、多租户、数据入驻）→ **都按这条更新**：先问「这能不能是一个配置字段」。

## 文件架构

- **`geo-config.js` = 唯一配置入口**（2026-09-13 定稿，**不再分层**）：**六段**（v3.0.0 起）—— ① `SITE_CONFIG`（标题/主题色/天地图 token）①-2 `MAP_CONFIG`（初始视野/缩放上限）①-3 `BASEMAP_CONFIG`（底图清单+覆盖层+3D 映射）② 路径 ③ `window.geoJsonGroups` 图层清单 ④ `PLACE_REGISTRY`。`layers.js` 已合并回来并**删除**。`index.html` 里必须在 `geojsonloader.js` / `basemap-manager.js` 之前。
  - 清单字段：`defaultOpacity` `color` `icon` `iconSize` `colorMode/colorField` `labelField` `source` `selectable` `hidden` `searchPriority` `popup:{titleField,hideFields[],maxValueLength}` `cesium:{...}`
- **底图引擎 `assets/basemap-manager.js`（v3.0.0 新增）**：把 `BASEMAP_CONFIG` 变成真实图层 + 图层控件 + 底图/覆盖层本地记忆 + Esri 历史影像时相条 + 3D ImageryProvider 映射。**不含任何图层名与 URL。**
  - 七种 `kind`：`tianditu`(service) / `arcgis`(serviceName,labelServiceName) / `wms`(url,layers) / `tile`(url) / `imageWorldCopy`(url,bounds) / `wayback`(tileBase,configUrl,fallbackRelease) / `esriFeature`(url,style)
  - 通用字段：`options`（透传 Leaflet）、`maxZoom/maxNativeZoom/minNativeZoom/opacity/pane`（简写）、`attribution`、`attachBoundary`（叠共享国界）、`cesium:{kind,service|url,layers,maximumLevel}`（3D 用哪种 provider）
  - 配置里用工厂函数压同源重复：`tdt()/arcgis()/gebco()/etopo()/esriIsland()`（13 个 GEBCO 各一行）
  - `ref` 机制：`{ name:"天地图全球境界", ref:"boundary" }` 复用 `cfg.boundary` 的**同一实例**。⚠️ 实现上 **`ref` 判断必须排在 `kind` 校验之前**（`buildOne()`），`findDescriptor()` 也要顺 `ref` 取 `cesium` 描述 —— 两点都是踩过的坑
  - **唯一硬编码图层 = 兜底 ArcGIS World_Imagery**，覆盖四种场景：配置空 / 语法坏 / `defaultBasemap` 不存在 / 3D 那条没写 `cesium`。**宁可退一张固定影像也不白屏**（`cesium-viewer.js` 里另有一份同名兜底，防 manager 未加载）
  - 3D 不再另抄底图 switch：`cesium-viewer.js` 只调 `BasemapManager.createImageryProvider(name)`；覆盖层同理走 `createOverlayImageryProvider(name)`（非天地图瓦片类返回 null = 3D 无对应物）。天地图 t0~t7 八子域优化在 manager 的 `createTdtProvider()` 里
  - ⚠️ **「天地图全球境界」与 `attachBoundary` 底图共用同一实例 = 既有行为，刻意保留**：Leaflet 同一图层不重复上图 → 该复选框天然是「国界显隐」开关（选 ArcGIS/OSM 底图时自动呈选中态；取消勾选会把国界摘掉，切走再切回恢复）。别当 bug 修，会连带改掉 3D 侧国界叠加
  - ⚠️ **天地图 token 在 `SITE_CONFIG.tiandituToken`**，引擎把它导出成 `window.TDT_TK` 供 2D/3D/搜索/高程共用
- **加底图的完整动作 = 1 处**：在 `BASEMAP_CONFIG.baseLayers` 加一条（含 `cesium` 描述）。**不需改** `index.html` / `cesium-viewer.js` / `basemap-manager.js`
- **加图层的完整动作 = 2 处**：① 把 `xxx.geojson.gz` 放进 `assets/geojson/`（或传 COS 同前缀）② 在 `geo-config.js` 的 ③ 段加一条。**不需改** `index.html` / `service-worker.js`（gz 走 SW 运行时动态缓存，不在 `STATIC_ASSETS` 里）
- **`geojsonloader.js` 已无任何按图层名硬编码**（2026-09-13 清零见上「项目定调」）
- ⚠️ **点要素尺寸的真实旋钮是 `iconSize`，不是 radius**：所有点图层都经 `L.GeoMarker.createPointMarkerByType()` 渲染成**图标标记**（`Leaflet.GeoMarker.js` 里 `circleMarker` 出现 **0 次**），而 Leaflet 的 `style` 选项**不作用于 marker** → `getGeoJsonStyle()` 里的 `radius`（原「火山 5 / 其他 8」）是**死代码**，根本画不出来。Canvas 路径同样写死（`Leaflet.MarkersCanvas.js:391` 的 `8`）。配置 `layer.iconSize`（默认 20）实测生效，用户弹窗里的设置会覆盖它
- **`SITE_CONFIG` 三字段全 `null` = 零介入**（不改标题、不注入样式）。`brandColor` 只注入 `--c-green`/`--c-green-hover`/`--c-statusbar`（= `--accent`、面板描边、开关、手机状态栏），**绝不碰 `--c-green-text-strong`**（WCAG 文字色）。`brandColorDark` 留空 → 自动按「对白提亮 35%」推导，hover 按「对黑 16%」
- ⚠️ **向 `:root` 注入 CSS 变量必须抬高一档优先级**：`geo-config.js` 在 `<head>` 里比 `main.css` 的 `<link>` **更早**执行 → 注入的 `<style>` 排在它**前** → 同优先级下后写的 main.css 胜出，变量白设（实测踩过）。用 `:root:root` / `:root[data-theme="dark"]`（0,2,0）。但抬高后浅色规则在深色下也生效 → 只该浅色用的变量（如 `--c-statusbar`）要单写成 `:root:not([data-theme="dark"])`。**别改用 `documentElement.style`**（内联优先级最高，会把深色取值一并压掉）
- 清单消费点只有 5 处：`geojsonloader.js:3152`（同步 `forEach` 建 DOM）、1449/1452/3091/3248（路径+回退）、`app.js:466`（地名）。`geo-config.js` 里有 `window.geoJsonGroups = window.geoJsonGroups || []` 兜底 —— **别删**，否则清单缺失时 `forEach` 直接白屏
- 渲染规则（算期望值时必须带上，否则会误判成 bug）：整组 `hidden` 跳过；`groupName: null` 的平铺组**不产生 `<details>`**；单图层 `hidden` 不渲染。当前 = 8 组 / 59 项（68 − 8 − 1）
- **配置外置 ≠ 配置热更新**：`dupal.cn` 本身就是 COS 静态域名 → `./assets/geo-config.js` 是**同域**文件，会被 SW 预缓存，改内容仍要等 `CACHE_NAME` 变化。要真热更新须走**跨域绝对 URL**（`service-worker.js` 有 `if (!url.startsWith(self.location.origin)) return;` 跳过跨域），代价是跨域不进 SW 缓存 → 离线取不到配置
- `geojsonloader.js` ~6100 行核心；`app.js` 版本号/导出/SW/toggle；`geo-utils.js` 纯函数；`measure-export.js` 测量转图层；资源平铺 `assets/`，顺序见 `index.html`

## 图层 / 设置面板

- **`hidden: true`**（group 或 layer 均可）→ 跳过渲染但数据保留；整组 hidden 不生成空 `details`（`visibleLayerCount` 计数）
- 设置面板：`#quickBar` 图标网格 + `details.toggle-sub` 次级折叠（折叠态显 `已开/总数` 徽标）
- **快捷区 = 地图设置的快捷键，不是第二份设置**：
  - 状态唯一来源是面板 `<input type="checkbox" id="xxx">`（`toggleConfig` 按 id 注册）
  - 快捷项是 `<button data-quick-for="xxx" aria-pressed>`，点击转发 `master.checked = !checked` + `dispatchEvent("change")`，反向靠 `document` change 委托
  - **快捷区绝不能持有同 id 元素**（会让 `getElementById`/`initToggle` 抓错）
- 动作按钮用 `data-action` 绑定，多处入口共用一个处理函数
- **`clusterToggle`/`labelToggle` 不在 `toggleConfig`**，由 `geojsonloader.js` 更晚恢复 → `window._syncQuickStates()` 必须可重入（渲染②后 + `load` 各跑一次）
- 快捷项手感：`:active` 置 `transition-duration:0s` + `scale(.94)`；`touch-action:manipulation`；hover 收进 `@media (hover:hover)`；焦点用 `:focus-visible`
- 程序化改 `checked` 要 `dispatchEvent(new Event("change",{bubbles:true}))`；导出图片记得隐藏 `#waybackBar`
- **「已开/总数」分组徽标 `updateSubBadges()`**（v3.0.4 重写）：
  - 徽标读 checkbox **实时**状态，而开关是在面板**渲染之后**才恢复的（`initToggle` 程序化赋值不触发 change；cluster/label 更晚）→ 「渲染时算一次 + 只监听 change」会永久停在 HTML 默认值。
    表现：高级组激活后仍 0/5，拨一个才 2/5，刷新又回 0/5
  - 刷新入口 **`requestSubBadges()`：幂等 + rAF 合并**（同一帧改 20 个开关只重算一次），
    `window._updateSubBadges` 对外暴露；已挂进 `window._syncQuickStates()`，一处覆盖所有调用点
  - `initToggle()` 必须在**副作用跑完后**再同步一次（premium 未激活时 `enable()` 会强制取消勾选）
  - 兜底：`<details>` 的 `toggle` 事件**不冒泡但走捕获阶段** → `body.addEventListener("toggle", fn, true)`
  - 回归判据写「徽标 === 该组实际勾选数/总数」，别写死固定数字

## 配色与对比度（WCAG）

- **选中态边框与焦点环不能用 `--accent`**（#99cc99 对 #eee 仅 1.58:1，需 ≥3:1）→ 用 `--c-green-text-strong`（浅 4.84 / 深 8.06）。开关能用 `--accent` 是因为有「滑块位移」这个非颜色线索
- **绿字一律 `--c-green-text-strong`**（现 #3a743a）；`--accent`/`--accent-lighter`/`--c-green-text` 太浅（1.7–3.8:1）。`--section-text` 已指向它
- **绿底配深字**（`#1a1a2e`，9.3:1），别配白字（1.83:1）
- 深色主题下 `--c-green-text-strong` 与 `--c-green-text` 同值 #88cc88 → 改浅色 token 不影响深色
- **待定**：`--c-text-dim` #999（浅 2.61）/ #777（深 3.97）未达 AA，属可见设计取舍
- **CSS**：`.is-on` 与 `:has()` 必须拆两条规则（选择器列表含无效项会整条丢弃）

## 布局稳定性（滚动条槽位）

- **用「懒预留」，不要无条件 `scrollbar-gutter: stable`**。机制在 `assets/scroll-gutter-guard.js`：容器**第一次真溢出**时打 `data-scroll-guttered`，此后常驻；CSS 只有 `[data-scroll-guttered]{scrollbar-gutter:stable}`。打标记时滚动条已在占位 → 零视觉变化；变短也不还回去 → 无往返抖动
- 判定标准是「会不会经常在 溢出↔不溢出 之间往返」：`.panel-scroll`/`.search-results`/`.dialog-body`/`.md-toc-list` 恒溢出 → 预留零成本；`.feature-panel-table-wrap` 会往返（预留 15px）；`.leaflet-legend-control` 极少溢出
- 实现：文档级 `MutationObserver`(childList+subtree) 只对新增子树做定向 `querySelectorAll` + `rec.target.closest(SELECTOR)`，合并到 rAF；外加 `DOMContentLoaded`/`load`/`resize`(防抖150ms)/600·2000·5000ms 粗扫。标记进 `WeakSet` 避免反复重排
- 新增滚动容器 → 把选择器加进 `scroll-gutter-guard.js` 的 `SELECTOR` 数组
- **别用 `overflow-y: scroll` 替代**（会画出滚动条轨道）
- `.dialog-body` 上限须扣头部：`min(600px, calc(100vh - 140px))`（否则视口 <525px 时两层嵌套滚动）
- 只写 `overflow-x: auto` 会让 `overflow-y` 计算成 `auto` → 审计误判。不会纵向滚的元素应显式 `overflow-y: hidden`

## Markdown 文档弹窗（`dialog.js` `showMarkdown`）

- **`marked` 不做路径重写** → 已加 `resolveRelativeImages(root, docUrl)` 按**文档自身目录**补前缀，App 内与 GitHub 两边同时成立。不要图省事写成 `docs/shots/...`
- `.dialog-body` 平时 `overflow-x: hidden`（防宽表格撑破）→ 超宽内容拖不动。⚠️ `overflow:hidden` 的盒子 `scrollLeft` 仍可被脚本改写，判据必须是 `overflow-x` 真变 `auto`
- 大图查看 = 点击切 `img.md-zoom` + `<dialog>.md-zoomed`（宽 `min(1840px,96vw)`，`overflow-x: auto`）→ 原始像素
- 图片 `max-width:100%` 只封顶不放大；⚠️ 别把尺寸悬殊的图放同一表格（列宽按原图比例，1440 与 408 并排会把 408 压到 132px）
- 细节图用 `deviceScaleFactor: 2` 重渲染，不要位图放大

## 2D 渲染

- **Canvas**（>3000 点）：点 8px / hit 10px；RBush 仅 hit 检测；`updateColors()` 增量改色
- **DOM+聚类**（≤3000）：divIcon **无 `setStyle`**（`Leaflet.MarkersCanvas.js` 扩展支持箭头/十字/点三种 SVG 形状）
- 透明度递归 `applyLayerOpacity()`；`markerClusterGroup` 必须 `getAllChildMarkers()`
- `reloadLayerWithNewMode` 第 6 参 `forceRebuild`：iconType/iconSize 变化必传 true
- 进度条 `updateLayerProgress(id,null)` **必须 removeChild 摘节点**
- **pane 层级**（数值真源 = `geo-config.js` 的 `MAP_CONFIG.panes`，`index.html` 只负责建 pane）：
  `baseImagePane` **190** < 瓦片 200 < `demPane` 350 < 矢量 400 < 标记 600。
  **铁律：底图（单选）永远在最底层，覆盖层（多选）永远压在底图之上。**
  ⚠️ `baseImagePane` 曾设 250 → ETOPO 把「天地图地名标注/全球境界」（瓦片，200）整个盖住。
  `L.imageOverlay` 默认落 `overlayPane(400)` 会压矢量，所以要专用 pane —— 但位置是**底图档**（<200），不是覆盖层档
- **`L.Control.Layers` 是逐图层绑事件的**：`onAdd` 里 `layer.on("add remove", _onLayerChange)`，
  **不是**绑在 map 的 `layeradd/layerremove`。→ **`map.removeLayer()` 也会触发 `overlayremove`**，
  被动移除（如收起「更多底图」）必须用 `_suspendPersist` 挂起写盘，否则记忆被清空。
  同理 `overlayadd` 也不要求「通过控件点选」，程序化 `addLayer` 同样会触发
- **图层上色**（`geojsonloader.js` 的 `getGeoJsonStyle()` / `getFeatureFillColor()`）：
  - **面要素不写 `colorMode` → 默认 `"sequential"`**（按序号取 HSL：0 号 = `hsl(0,60%,40%)` = rgb(163,41,41) 深砖红）。
    单要素图层看着是纯色，其实只是「索引 0 的颜色」。**要单色必须同时写 `color` + `colorMode:"single"`** —— 只写 `color` 在 sequential 分支根本不被读
  - 面**填充有硬上限 0.45**：`fillOpacity = Math.min(layerOpacity, 0.45)`；而**描边 opacity 用未截断的 `layerOpacity`**（默认 0.8）→ 两个值不同步，「调透明度」会同时改
  - 面**描边色全站硬编码 `#555`**（无配置字段）；线要素的 `color` 直接就是线色
- **图层开关在设置面板**，不在 Leaflet 图层控件里：`input[type="checkbox"][id^="layer_"]`，id = `layer_` + `makeLayerStableId(name, file)`。Leaflet 图层控件自 v3.0.0 起**只剩底图**
- 单图层「用户设置」优先于配置：`localStorage["dupal_layer_set_" + checkboxId]` 里的
  `colorMode / colorValue / opacity / iconValue / selectable / labelField` 会盖掉 `geo-config.js` 的默认值 ——
  改了配置但界面没变，先查这里

## 要素弹窗（Popup）—— 按钮必须用事件委托

- **不要给 `.popup-ext-btn` 挂 `onclick`**。Leaflet 复用同一 Popup 时 `setContent()/update()` 会重写
  `_contentNode.innerHTML` → 重渲染的按钮**没有 onclick**；而 popup 还在图上 → `openOn()` 走
  `map.addLayer()` 命中 `hasLayer` 直接 return → **`popupopen` 不二次触发**，没有补挂的时机
- 现行做法：`map.on("popupopen")` 只登记 `WeakMap(弹窗容器元素 → popup)`；`document` 上**单一 click
  委托** → `.popup-ext-btn[data-act]` → `closest(".leaflet-popup")` 查回 popup → **点击时才**
  `resolvePopupTarget(popup)`（`popup._featureRef` → `popup._source.feature`）。
  弹窗**容器元素**在 Popup 生命周期内是同一个（`setContent` 只换内部内容）→ 映射永不失效
- **要素一律点击时现取，不要缓存**：esri 复用同一弹窗时缓存会让「点 B 详情出 A」
- **开窗一律走 `openFeaturePopup()`（新建独立 `L.popup()` 再 `openOn(map)`），不要用
  `layer.bindPopup().openPopup()`** —— `bindPopup` 会顺带把 `click→_openPopup` 装到 layer 上，
  与业务 click 处理器撞成**一次点击开两次窗**（第二次 `_prepareOpen→update()` 抹掉按钮接线）
- **DOM marker 保留 `bindPopup`**（它有键盘可达性），但**不要再手动 `marker.openPopup()`**
- **Canvas 的要素记录必须自带 geometry**：`featuresArray` 只有 `{lat,lng,color,_idx,properties}`，
  直接喂给弹窗会让「缩放至」失效（`computeBounds` 读 `feature.geometry.coordinates`）与 3D
  `flyToFeature()` 失效（它开头 `if (!feature.geometry) return`）。补
  `geometry:{type:"Point",coordinates:[lng,lat]}` 即可，详情面板图表也读 geometry
- **esri FeatureLayer 走的是 Leaflet 自带的 `bindPopup`**（`_popupFunction` 是 undefined），
  弹窗 `_source` = 它按视口生成的**子图层**，点击后 `_source.feature` 是有值的；
  图层 id/名要**在渲染时**（弹窗内容函数里）贴到子图层上 —— `ly.on("layeradd")` **不触发**
  （esri 内部 add 不经过 `FeatureGroup.addLayer`）
- esri 图层 `map.addLayer()` 后**必须再产生一次 moveend/zoomend** 才开始拉要素（cell 式视口查询）

## Cesium 3D

- 共享 featureCache 直喂 `GeoJsonDataSource.load()`，零转换；CDN v1.125
- **已修坑**：① Point 用 billboard ② `ArcGisMapServerImageryProvider` CDN 报错 → `UrlTemplateImageryProvider`+`tile/{z}/{y}/{x}` ③ 贴地面无 polygon outline ④ 聚类 Label 须 `CENTER/CENTER/pixelOffset=ZERO`
- **`CLAMP_TO_GROUND` 是卡顿元凶**（每帧 O(n) 采样）。点默认 `"none"`，显式 `"live"` 且 ≤300 才贴地
- **关→开瞬时**：取消勾选只 `ds.show=false` + 挪 `cesiumHiddenCache`（LRU 12）；`reloadLayer/All` 须 `destroyLayer`
- 图标用 2D 同源 `getIconFactory` 转 SVG data-uri；面填充 `min(opacity,0.45)`；面边界 `#555`；聚类 `pixelRange=28,minSize=4`
- **Z 坐标须压平**：`GeoJsonDataSource` 读到第三分量就走 `perPositionHeight` → 接边穿插。修法 = 加载前 `CesiumGeoJsonAdapter.normalizeGeometryZ()`
- 聚类气泡不吃 `updateOpacity` → dataSource 上记 `_ogvOpacity` 手动同步；状态桥接见 `window._ogv_*`

### 3D 性能（实测）

- 慢的不是渲染：5 图层（含 5555 点）构建仅 **0.30s**。引擎 = 下载 **94.6%** + 解析 335ms + 初始化 1.2%
- **`globe.maximumScreenSpaceError = 2`**：真因是天地图只用单子域（per-server 并发 6 → 429 死循环）。**修法**：天地图三底图 + 四覆盖层全走 t0~t7 八子域 → **6.8s / 锐度 568**（原 12.6s / 1.4）。`maximumLevel:18` 对齐 Leaflet `maxNativeZoom`
- **大气三件套**深色全关（原全开 = 白蒙层）：`showGroundAtmosphere`/`scene.fog`/`skyAtmosphere`
- **自托管 `assets/cesium/Cesium.js`**（4.90MB）：CDN 国内 9.9s vs 同源 0.31s。**`CESIUM_BASE_URL` 仍须指 CDN**（Workers/Assets 拼路径依赖）。SW 不预缓存 → 点开 3D 470ms
- 瓦片不影响 JSON 渲染；空闲预加载已禁用，保留 `CesiumViewer.preloadNow()` 手动入口

## Git 与发布

- **git 操作（add / commit / push / tag）由用户自己执行**（2026-09-12 用户明确）
- 远程 `https://github.com/TigerHall/gis.git`，主分支 `main`，**无 tag**。版本号唯一真源 = `service-worker.js` 的 `CACHE_NAME`（`app.js` 运行时发 `GET_VERSION` 问 controlling SW）。改这一行即触发 SW 更新弹窗 + 缓存重建；**未提交/未发布的版本号不必二次 bump**——**例外**：若浏览器**已经加载并缓存过上一版**（本地联调时基本必然），普通刷新仍会拿到旧文件，此时**必须再 bump 一次**才能在正常刷新下看到修复（2026-09-13 修复弹窗按钮时踩到）
- 线上域名是 **`dupal.cn`**；`wzhky.com` 是**另一个项目**（低空影像一张图），别搞混
- `.gitignore` 只忽略 `/CNAME` 与 `.workbuddy/artifacts/`（AI 过程产物）。⚠️ `docs/shots/` **不在**忽略之列 —— 是应入库的文档资产
- `.gitattributes`：`* text=auto eol=lf` + 二进制显式声明 → 入库 PNG 不被行尾转换损坏
- **`docs/` 会随站点发布**：`app.js` 运行时 `fetch("docs/CHANGELOG.md")` 渲染「更新记录」→「入库」与「上线」是同一件事
- **待办**：`docs/shots/` 15 张 / 约 1.50 MB 仍 **untracked**，等用户自行 `git add`；已全部被 `docs/CHANGELOG.md` 引用，无孤儿

## 本地存储（v3.0.2 起统一）

- **所有 localStorage / sessionStorage 读写必须走 `window.OGVStorage`**（`geo-utils.js`，
  索引页第 16 行，早于所有业务模块）。裸调用已清零
- API：`KEY.*` 键名常量 / `safeGet·safeSet·safeRemove`（吞异常）/ `getBool·getNum`
  （非法值回退）/ **`getJSON`（解析失败即删键+兜底）** / `keysWithPrefix·removeAll·
  pruneOrphans` / `clearResettable·clearApp` / `dropObsoleteKeys`
- **`getJSON` 删键是自愈的关键**：坏值不清掉，「读-改-写」里读永远失败 → 覆盖层记忆曾整类静默失效
- **绝不用 `localStorage.clear()`**：按 origin 清，会删同域他页数据 + 让 IDB 用户图层变孤儿。
  用 `clearResettable()`（保留 `ogv_premium_active` / `dupal_user_layers` / `dupal_user_layer_*`）
- **⚠️ `dupal_layer_` 是 `dupal_layer_set_` 的前缀**：`hasSavedLayerState`、
  `clearAllLayerStates`、「记住图层」关闭清理三处都误吃过，必须显式排除
- 遍历 localStorage 先快照再删（边遍历 `length` 边删会跳项）
- 孤儿键回收：白名单 = 当前面板 checkbox id ∪ 用户图层 persistentId，三个前缀下不在白名单即删
- **底图/覆盖层记忆（`basemap-manager.js`）**：`savedOverlayNames` 是唯一真源，
  `persistOverlay()` 只在状态真变时落盘。**恢复必须写在 `rebuildLayerCtrl()` 里**，
  不能只在模块初始化时做一次 —— 本模块先于 `app.js` 加载，`#moreBasemapToggle`
  那时还没被设成记忆值 → 可见集合不含 `moreOverlays` → 第一次 rebuild 会把它们摘掉
- 用户资产 = `ogv_premium_active`、`dupal_user_layers`、`dupal_user_layer_*`，任何清理都保留

## 跨标签同步（storage 事件，分级）

- **「值的归属」与「副作用是否重放」是两件事** —— storage 事件本身就是「对方已写完」的
  通知，天然后写入者生效，没有争议；真正的决策是收到后**要不要在本地跑 enable/disable**
- `app.js` `SYNC_BLOCK` 黑名单：`view3d` / `isLocationTracking` / `premium` / `elevationRead`
  → 不参与同步，只认存储值，下次加载生效。其余纯视觉开关立即同步
- **`view3d` 必须排除**：`cesium-viewer.js` 每次页面加载都 `resetToggleState()` 把开关写回
  false，一旦同步会两页互相关掉对方的 3D，来回震荡
- **`isLocationTracking` 必须排除**：A 关 → B 的 `watchPosition` 被 `clearWatch` 掉
- **`premium` 必须排除**：会弹激活码对话框，且 `_activated` 是闭包变量改不了
- 同步实现只改 `cb.checked`（程序化赋值不触发 change）+ 直接调 enable/disable，
  **绝不回写存储**，否则两页互相触发形成回环

## 通用坑

- **localStorage 记忆：21 个 key / 3 套命名空间**（2026-09-13 全面审计，报告见当日日志 j 节）
  - `dupal_toggle_*`（15 个控件开关）、`dupal_cluster_enabled` / `dupal_label_enabled`（**没走 toggle 前缀，风格不一**）、`dupal_premium`（**只写不读的孤儿**）
  - `dupal_layer_<cbId>` 勾选 · `dupal_layer_set_<cbId>` 设置 · `dupal_user_layer_<pid>` 用户图层勾选 · `dupal_user_layers` 用户图层元数据
  - `dupal_map_state` · `dupal_panel_width` · `dupal_sidebar_pinned` · `dupal_details_open_<id>`(4) · `dupal_basemap` · `dupal_overlays` · `dupal_wayback_release`
  - `ogv_premium_active` · `ogv_feature_panel_width`（**`ogv_` 第二套命名空间**）· sessionStorage `_pr_just_activated`（**无前缀第三套**）
  - ⚠️ **`dupal_layer_set_` 与 `dupal_layer_` 同前缀** → `hasSavedLayerState()`（`geojsonloader.js:5799`）的 `indexOf("dupal_layer_")===0` 会把「只调过颜色/透明度」误判成「有已保存图层」，**每次打开都弹「恢复图层」**（实测确认）。任何按键名前缀判定的地方都要想到这对
  - ⚠️ **`app.js:745` `doRefresh()` 用 `localStorage.clear()` 无差别清空**（「🧹 清理网页缓存」实际是全清）：`dupal_user_layers` 一丢，IDB 里的 `user_geo_<pid>` 就成永久孤儿。改这里必须改按前缀删
  - ⚠️ **「读-改-写」型持久化必须能自愈**：`basemap-manager.js:496 persistOverlay` 解析失败被 `catch` 吞掉 → 之后**永远写不进去**且坏值长留（`overlays` 勾选静默失效，实测确认）。解析失败要 `removeItem` + 重置默认值
  - ⚠️ **边遍历 `localStorage.length` 边 `removeItem` 会跳项**（`geojsonloader.js:5834` 潜伏）→ 一律先快照 key 数组再删
  - 🟡 **图层开关不在 Leaflet 图层控件里**（那个只剩底图），在设置面板：`input[type=checkbox][id^="layer_"]`
- ⚠️ **数据不是代码：属性值一律按纯文本渲染**（2026-09-13 修，用户定调「这一类的数据都要面对这种问题」）。数据来自 SHP / KML / ArcGIS 导出，某些字段整段是 HTML，且常被 DBF 的 255 字符上限**截断**（实例：`volcanos.geojson` 的 `LAYER` 字段 = 末尾停在 `<td colspan` 的 KML `<table>`，1293 个要素值相同）。
  - 把值直接拼进 `innerHTML` 的三个实测后果：① 未闭合标签「吃掉」其后的标记 → `.popup-ext-btn-wrap` 被解析进 `<td>`（祖先链 `TD < TR < TABLE`），「缩放至 / 详情」**错位 33px**；② 字段里的 `<img>` **真发请求**（外链 / http 明文 → `ERR_NAME_NOT_RESOLVED`）；③ XSS 面
  - **唯一收口点 = `geo-utils.js` 的 `buildPopupContent`**（10 个调用点全汇聚于此：`geojsonloader.js` 8 处 + `index.html` 内联图层 + `cesium-viewer.js`）。策略：转义 → 剥标签（**行内标签不留空格**，否则 `<b>粗体</b>说明` 变「粗体 说明」；块级才用空格分隔）→ 折叠空白 → **剥完为空的字段整行不渲染** → 超 200 字符截断（全文进 `title`）
  - 同类入口：`geojsonloader.js` 的 `_getLabelText` / `_bindPermanentLabel` 也把数据喂给了 `innerHTML`（`bindTooltip(String)` 与 divIcon 的 `html`）→ 已加 `_escapeLabelText`。✅ `feature-panel.js`（详情面板）本来就有 `_escapeHtml`/`_escapeAttr`，无需改
  - 新配置 `layer.popup = { titleField, hideFields[], maxValueLength }`：`geo-utils.js` 按 `file` 从 `window.geoJsonGroups` **惰性建索引**查找（不给 10 个调用点逐个加参数 —— 迟早漏一个）。已删除 `geo-utils.js` 里只剩空壳的硬编码 `POPUP_FIELD_CONFIG`
  - 诊断口径：判断弹窗结构有没有被数据破坏，看 `.popup-ext-btn-wrap` 的**祖先链**里有没有 `TD`/`TABLE`，以及按钮中心 vs 弹窗中心的偏移（正常 = 0px）
- ⚠️ **`L.popup(...).openOn(map)` 会【同步】触发 `popupopen`** → 给 popup 挂的自定义属性必须在 `openOn` **之前**赋值。写在后面 = 事件早已跑完，`map.on("popupopen")` 处理器里 `if (!feature) return` 静默退出 → 弹窗「缩放至 / 详情」按钮**拿不到 `onclick`，点了没反应**（2026-09-13 修复；Canvas 路径 >3000 点长期中招，DOM marker 路径因走 `bindPopup` + `popup._source` 而侥幸正常）
- **弹窗要素引用的两条来源**（`geojsonloader.js` popupopen 处理器）：Canvas 路径是自己 `new L.popup` → 靠 `popup._featureRef`；DOM marker 路径是 `bindPopup` → 靠 `popup._source.feature` + `marker._ogvLayerId`（`_ogvLayerId` 在 `pointToLayer` 里就挂好了，没有时序问题）
- **TDZ**：对外只暴露延后调用的 getter
- WMS 须支持 EPSG:3857
- **GzIdbLoader**：gzip → IndexedDB（DB v2，key=URL）；仅 .gz；**`setCache` 必须 await**
- 倒排索引 tokens 用 `Object.create(null)`；要素定位按 `feat.geometry` 真实坐标
- 反子午线线/面三副本，点 ≤3000 才做；主题色 `#9c9`；`.layer-panel{font-size:0}`
- 清除循环须显式排除 `dupal_user_layers`（前缀 `indexOf` 会误匹配）
- `exportMapImage()`（html-to-image，不排除 `.leaflet-tooltip`）；激活码 `app.js` `_PR_CODES`

## 本机工具链坑

- **Bash 工具 PATH 为空** → 命令前必须把 PortableGit 的 coreutils 加进去（**`/usr/bin:/bin` 里没有 `head`/`curl`**，2026-09-13 实测踩到）：
  `export PATH="/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/bin"`；
  node 用绝对路径 `"C:/Users/hehu/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"`；
  验证 HTTP 可达性没有 `curl` → 用 `node -e` 起 `http.get`
- Playwright 脚本在 `.workbuddy/artifacts/`（新脚本也放这），文件头要 `module.paths.push("C:\\Users\\hehu\\.workbuddy\\binaries\\node\\workspace\\node_modules")`
- Geoman 形状名是 **`Line`** 不是 `Polyline`
- **`getComputedStyle` 会返回 transition 中间值**：改完类名立刻读 = 读到旧值，判定样式前先 `await 400ms`
- **Playwright 默认传 `--hide-scrollbars`** → headless 下滚动条不渲染，量宽度变化会得抖动 0px 的假阴性。必须 `ignoreDefaultArgs: ["--hide-scrollbars"]`
- **`page.evaluate(fn, arg)` 只序列化 `fn`** → 函数体内不能引用模块级常量
- **`overflow: hidden` 的盒子 `scrollLeft` 仍可被脚本改写** → 判「能否横向滚动」会漏判，必须查 `overflowX`
- **量尺寸/样式前必须等过渡结束**（已踩三次）
- **测试假阴性已踩四例**：① `getComputedStyle` 读到 transition 中间值 ② `--hide-scrollbars` 让滚动条不渲染 ③ **用 `typeof btn.onclick` 判断事件委托实现的按钮**（委托本来就没有 onclick → 必得假阴性，改成断言「点击后地图/面板真的变了」）④ **case 之间状态不复位**（扫码点前必须 `map.setView(...)`，否则沿用上一 case 的视图/残留 DOM → 报「弹窗没出现」）
- **图元元素没有 `.click()`**：`SVGElement` 只有 `HTMLElement` 有 → SVG 用 `page.mouse.click(x,y)`，或 `dispatchEvent(new MouseEvent("click",{bubbles:true}))`
