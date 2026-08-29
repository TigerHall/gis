# OGV 项目长期记忆

## 文件架构

- `geo-config.js` 图层配置：`defaultOpacity` `color` `icon` `colorMode/colorField` `labelField` `source` `selectable` `cesium:{extrudeHeight,clampToGround,pointPixelSize,groundMode}`
- `geojsonloader.js` ~5500 行核心；`app.js` 版本号/导出/SW/toggle；`geo-utils.js` 纯函数；资源平铺 `assets/`，顺序见 `index.html`

## 通用坑

- **TDZ**：对外只暴露延后调用的 getter
- WMS 须支持 EPSG:3857
- **GzIdbLoader**：gzip → IndexedDB（DB v2，key=URL）；仅 .gz；**`setCache` 必须 await**
- 倒排索引 tokens 用 `Object.create(null)`；要素定位按 `feat.geometry` 真实坐标
- 反子午线线/面三副本，点 ≤3000 才做；主题色 `#9c9`；`.layer-panel{font-size:0}`
- 清除循环须显式排除 `dupal_user_layers`（前缀 `indexOf` 会误匹配）
- 绿色小字用 `--c-green-text-strong`（`--accent` 浅底仅 1.8:1）
- 改资源后必 bump `service-worker.js` 的 `CACHE_NAME`

## 2D 渲染

- **Canvas**（>3000 点）：点 8px / hit 10px；RBush 仅 hit 检测；`updateColors()` 增量改色
- **DOM+聚类**（≤3000）：divIcon **无 `setStyle`**
- 透明度递归 `applyLayerOpacity()`；`markerClusterGroup` 必须 `getAllChildMarkers()`
- `reloadLayerWithNewMode` 第 6 参 `forceRebuild`：iconType/iconSize 变化必传 true
- 进度条 `updateLayerProgress(id,null)` **必须 removeChild 摘节点**

## Cesium 3D

- 共享 featureCache 直喂 `GeoJsonDataSource.load()`，零转换；CDN v1.125
- **已修坑**：① Point 用 billboard 非 `entity.point` ② `ArcGisMapServerImageryProvider` CDN 报错 → `UrlTemplateImageryProvider`+`tile/{z}/{y}/{x}` ③ 贴地面无 polygon outline ④ 聚类 Label 须 `CENTER/CENTER/pixelOffset=ZERO`
- **`CLAMP_TO_GROUND` 是卡顿元凶**（每帧 O(n) 采样，n=1116 时 5620ms vs 602ms）。点默认 `"none"`，显式 `"live"` 且 ≤300 才贴地
- **关→开瞬时**：取消勾选只 `ds.show=false` + 挪 `cesiumHiddenCache`（LRU 12）；`reloadLayer/All` 须 `destroyLayer`
- 图标用 2D 同源 `getIconFactory` 转 SVG data-uri（按色缓存）；面填充 `min(opacity,0.45)`；面边界 `#555`；聚类 `pixelRange=28,minSize=4`
- 状态桥接见 `window._ogv_*`（`_layerColorMap` 等）

### 3D 性能（2026-08-29 实测）

慢的不是渲染：5 图层（含 5555 点）3D 构建仅 **0.30s**。引擎 = 下载 **94.6%** + 解析 335ms + 初始化 1.2%；**「解析 4.75s」有误已更正**。blob vs `<script src>` 仅慢 88ms。

- **`globe.maximumScreenSpaceError = 2` 默认值** ⭐（2026-08-29 翻案）：
  渐进 24→12 方案已废——锐度仅 1.4（拉普拉斯方差 ≈ 纯色），放大仍糊
  真因是**天地图只用了 t0 单子域**（per-server 并发 6 → 429 死循环）
  **修法**：天地图三底图 + 四覆盖层全走 t0~t7 八子域 → 等效并发 48
  实测 **6.8s / 锐度 568**（原 12.6s / 1.4）
  11.5% 429 被触发但 Cesium 内置重试扛住；`maximumLevel:18` 对齐 Leaflet `maxNativeZoom`
- **大气三件套**（深色原全开 =「白蒙层」）：`showGroundAtmosphere`（叠地表发糊主因）/ `scene.fog` / `skyAtmosphere`。深色全关（`setAtmosphere` 切）
- **自托管 `assets/cesium/Cesium.js`**（4.90MB）：CDN 国内 9.9s vs 同源 0.31s（省 97%）。**`CESIUM_BASE_URL` 仍须指 CDN**（Workers/Assets 拼路径依赖）。本地 404 回退；SW 不预缓存 → 点开 3D **470ms**
- **空闲预加载已禁用**（2026-08-29 移除）：PWA 缓存覆盖二次访问。保留 `CesiumViewer.preloadNow()` 手动入口与 `_loadSubs` 并发安全
- **瓦片不影响 JSON 渲染**：DataSource/Entity 管线与瓦片独立；瓦片慢时 entity 仍先出现
- **探针坑**：① WebGL canvas 须 `page.screenshot()`（`drawImage` 未开 preserveDrawingBuffer 必全黑）② `page.route` 拦不到 SW Cache Storage ③ 轮询被同步解析阻塞时用页内 MutationObserver ④ 别劫持 `script.src` setter

- `exportMapImage()`（html-to-image，不排除 `.leaflet-tooltip`）；激活码 `app.js` `_PR_CODES`；方案见 `docs/`