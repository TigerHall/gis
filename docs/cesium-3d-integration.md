# Cesium 3D 集成架构方案

## 1. 核心结论：数据完全互通

现有 `.geojson.gz` 数据管线产出的就是**标准 GeoJSON 对象**，Cesium 的 `GeoJsonDataSource.load()` 可以直接消费，**零转换成本**。

```
.geojson.gz → DecompressionStream → JSON 对象 → featureCache[checkboxId]
                                                    ↓
                                    ┌───────────────┴───────────────┐
                                    ↓                               ↓
                            Leaflet L.geoJSON()          Cesium GeoJsonDataSource.load()
                            （现有 2D 路径）                （新增 3D 路径）
```

关键点：`GzIdbLoader.fetch()` 返回 `Promise<GeoJSON>`，这个 GeoJSON 对象同时缓存在 IDB 和内存 `featureCache` 中。切换到 3D 时，**不需要重新 fetch 或解压**，直接从 `featureCache` 取已缓存的 GeoJSON 喂给 Cesium 即可。

## 2. 架构设计：双引擎共享数据层

### 2.1 设计原则

- **不改动现有 2D 路径** — Leaflet 引擎及其所有插件（Canvas/聚类/GeoMarker/Legend）保持不变
- **Cesium 懒加载** — 首次切换到 3D 时才加载 Cesium 库（~4MB JS + Workers），避免影响首屏性能
- **数据层共享** — `featureCache` / `GzIdbLoader` / `geo-config.js` 三者完全复用
- **状态同步** — 图层开关 checkbox 状态驱动两个引擎，只有活跃引擎执行渲染

### 2.2 容器结构

```html
<!-- 现有 -->
<div id="map"></div>

<!-- 新增：3D 容器，默认隐藏 -->
<div id="cesiumContainer" style="display:none;"></div>
```

切换逻辑：2D 模式 `#map` 可见、`#cesiumContainer` 隐藏；3D 模式反之。两个容器叠放在同一位置，通过 `display` 切换。

### 2.3 模块依赖关系

```
                    geo-config.js (共享配置)
                          |
              ┌───────────┴───────────┐
              ↓                       ↓
     geojsonloader.js          cesium-viewer.js (新增)
     (2D: 现有编排层)          (3D: Cesium 编排层)
              │                       │
              ↓                       ↓
     Leaflet.GzIdbLoader      cesium-geojson-adapter.js (新增)
     (共享数据管线)            (featureCache → Cesium Entities)
              │                       │
              └───────┬───────────────┘
                      ↓
              featureCache (共享 GeoJSON)
```

## 3. 新增文件清单

| 文件                               | 职责                                                           | 大小估算 |
| ---------------------------------- | -------------------------------------------------------------- | -------- |
| `assets/cesium/`                   | Cesium 库静态资源（Cesium.js + Workers/ + Assets/ + Widgets/） | ~25MB    |
| `assets/cesium-viewer.js`          | Cesium Viewer 初始化、相机同步、图层编排                       | ~8KB     |
| `assets/cesium-geojson-adapter.js` | featureCache GeoJSON → Cesium Entities 适配器（含样式映射）    | ~6KB     |
| `assets/cesium-terrain.js`         | 地形 Provider 配置（GEBCO/ETOPO → Cesium terrain）             | ~3KB     |

## 4. 现有文件改动点

### 4.1 index.html

**`<head>` 新增：**

```html
<!-- Cesium CSS（仅样式，不加载 JS） -->
<link rel="stylesheet" href="./assets/cesium/Widgets/widgets.css" />
```

**`<body>` 新增容器：**

```html
<div id="cesiumContainer" style="display:none;"></div>
```

**`<body>` 底部新增脚本（在 feature-panel.js 之后）：**

```html
<!-- Cesium 3D 引擎（懒加载入口） -->
<script src="./assets/cesium-viewer.js"></script>
<script src="./assets/cesium-geojson-adapter.js"></script>
<script src="./assets/cesium-terrain.js"></script>
```

注意：Cesium 主库 `Cesium.js` **不在 `<head>` 中静态加载**，而是由 `cesium-viewer.js` 在首次切换 3D 时动态 `import()` 或 `document.createElement('script')` 加载，避免首屏多加载 4MB+。

### 4.2 app.js — TOGGLE_GROUPS 新增开关

```js
{
  category: "显示",
  items: [
    {
      id: "view3dToggle",
      label: "3D 视图",
      desc: "切换到 Cesium 3D 地球，支持地形起伏和多角度查看。首次启用需加载约 4MB 引擎库",
    },
    // ... 现有开关
  ],
}
```

`toggleConfig.view3dToggle`：

- `enable` → 隐藏 `#map`、显示 `#cesiumContainer`、调用 `CesiumViewer.activate()`（懒初始化 + 同步当前图层）
- `disable` → 隐藏 `#cesiumContainer`、显示 `#map`、调用 `CesiumViewer.deactivate()`

### 4.3 geojsonloader.js — 图层加载钩子

在 `loadGeoJSONLayer` 的 `onDataLoaded` 回调中，数据进入 `featureCache` 后，**同时通知 Cesium 引擎**（如果已激活）：

```js
function onDataLoaded(data_) {
  // ... 现有逻辑 ...
  featureCache[checkboxId] = data_.features;

  // 新增：通知 3D 引擎（如果已激活）
  if (window.CesiumViewer && window.CesiumViewer.isActive) {
    window.CesiumViewer.addLayer(checkboxId, data_);
  }
}
```

在 `removeGeoJSONLayer` 中：

```js
if (window.CesiumViewer && window.CesiumViewer.isActive) {
  window.CesiumViewer.removeLayer(checkboxId);
}
```

### 4.4 geo-config.js — 可选 3D 扩展配置

```js
{
  name: "全球16大板块",
  file: "plate16.geojson",
  // 现有 2D 配置...

  // 新增 3D 可选配置
  cesium: {
    extrudeHeight: 50000,      // 面要素拉伸高度（米），不设则贴地
    clampToGround: true,       // 线/面贴附地形
    pointPixelSize: 12,        // 点大小
    // 可选：3D 专用颜色覆盖（不设则复用 2D colorMode 逻辑）
  },
}
```

## 5. Cesium 3D 核心能力

### 5.1 GeoJSON → Cesium Entities 适配

`cesium-geojson-adapter.js` 核心逻辑：

```js
CesiumViewer.addLayer = function (checkboxId, geoJson) {
  const config = getLayerConfig(checkboxId);
  const ds = Cesium.GeoJsonDataSource.load(geoJson, {
    markerSize: config.cesium?.pointPixelSize || 32,
    markerColor: Cesium.Color.fromCssColorString(config.color || "#99cc99"),
    stroke: Cesium.Color.fromCssColorString(config.color || "#E63946"),
    fill: Cesium.Color.fromCssColorString(config.color || "#E63946").withAlpha(
      0.3,
    ),
    strokeWidth: 2,
    clampToGround: config.cesium?.clampToGround !== false,
  });

  ds.then(function (dataSource) {
    // 面要素可选拉伸
    if (config.cesium?.extrudeHeight) {
      dataSource.entities.values.forEach(function (entity) {
        if (entity.polygon) {
          entity.polygon.extrudedHeight = config.cesium.extrudeHeight;
        }
      });
    }
    viewer.dataSources.add(dataSource);
    cesiumLayerCache[checkboxId] = dataSource;
  });
};
```

### 5.2 相机同步

2D → 3D 切换时，将 Leaflet 的 center/zoom 转换为 Cesium 相机参数：

```js
function syncCameraFromLeaflet() {
  const center = map.getCenter();
  const zoom = map.getZoom();
  // zoom → camera height 经验公式（Web Mercator）
  const height =
    (40075016 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, zoom);
  viewer.camera.setView({
    destination: Cesium.Cartesian.fromDegrees(center.lng, center.lat, height),
  });
}
```

3D → 2D 切换时反向同步。

### 5.3 地形（GEBCO 3D 海底地形）

Cesium 支持多种地形 Provider：

- **Cesium World Terrain**（需 ion token，免费额度足够）
- **自定义 quantized-mesh** — 可将 GEBCO 栅格转为 terrain tiles
- **简单方案**：用 `Cesium.CesiumTerrainProvider` 指向自建 terrain 服务，或直接用 GEBCO WMS 作为 imagery + World Terrain 做基底

推荐：先用 Cesium World Terrain（含海底地形），后续可替换为自建 GEBCO terrain。

### 5.4 底图复用

Cesium 的 `ImageryLayer` 可以直接对接现有底图源：

| 现有 Leaflet 底图    | Cesium 对应 Provider                                     |
| -------------------- | -------------------------------------------------------- |
| 天地图 img_w         | `Cesium.UrlTemplateImageryProvider`（拼接 TDT 瓦片 URL） |
| ArcGIS World_Imagery | `Cesium.ArcGisMapServerImageryProvider`                  |
| GEBCO WMS            | `Cesium.WebMapServiceImageryProvider`                    |
| OSM                  | `Cesium.OpenStreetMapImageryProvider`                    |
| ETOPO 2022           | `Cesium.WebMapServiceImageryProvider`                    |

底图选择状态可从 2D 同步到 3D，切换引擎时自动匹配。

## 6. 实施阶段

| 阶段 | 目标                            | 产出                                               |
| ---- | ------------------------------- | -------------------------------------------------- |
| P1   | Cesium 容器 + 懒加载 + 基础地球 | 3D 切换能看到旋转地球                              |
| P2   | GeoJSON 图层 3D 渲染            | featureCache → GeoJsonDataSource，点/线/面正确显示 |
| P3   | 图层状态同步 + 相机同步         | 切换 2D↔3D 时图层和视角保持一致                    |
| P4   | 底图同步                        | 2D 选中底图自动映射到 3D imagery                   |
| P5   | 地形 + 3D 高级特性              | GEBCO 海底地形、面要素拉伸、3D 图标                |

## 7. 注意事项

1. **Cesium 资源体积**：`Build/Cesium/` 约 25MB（含 Workers/Assets/Widgets）。COS 静态托管可接受，但建议配 gzip 压缩传输。Workers 目录必须同源，不能用 CDN 跨域。
2. **Cesium ion token**：免费账户每月 5GB terrain/imagery 流量。如果只用自建底图 + 不用 Cesium World Terrain，则不需要 token（`Cesium.Ion.defaultAccessToken = ''` 即可跳过）。
3. **WebGL 兼容性**：Cesium 需要 WebGL 2.0。移动端旧设备可能不支持，需做降级提示。
4. **IDB 缓存共享**：`GzIdbLoader` 的 IDB 缓存对两个引擎完全透明——3D 模式首次加载某图层时如果 IDB 已有缓存（2D 模式加载过），直接命中、零网络请求。
5. **反子午线**：Cesium 原生支持全球无缝渲染（地球是球面），不需要 Leaflet 的三副本方案。这是 3D 模式的一个天然优势。
6. **聚类**：Cesium 有 `PixelCluster` 方案但不如 Leaflet markerCluster 成熟。3D 模式可先不做聚类（地球缩放后点密度自然降低），后续按需引入。
