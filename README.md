# WebGIS 地质地理数据可视化

基于 Leaflet 的 WebGIS 应用，用于展示地质地理矢量数据（GeoJSON）。

## 功能特性

- **多底图切换**：天地图、ArcGIS等在线底图（矢量/影像/地形/境界）
- **图层管理**：分组建管理 GeoJSON 图层，支持勾选加载
- **颜色模式**：
  - 单一颜色：所有要素使用同一颜色
  - 内部多颜色（全部不同）：每个要素自动分配不同颜色
  - 按字段分色：按要素属性字段值分配颜色
- **交互功能**：
  - 点击要素显示详情弹窗
  - 点击面/线要素时缩放定位
  - 要素高亮显示
  - 测量工具（距离/面积）
  - 鼠标坐标实时显示
- **离线支持**：PWA 技术，支持离线访问

## 数据图层

| 分组           | 图层                                             |
| -------------- | ------------------------------------------------ |
| 地壳与大洋域   | 全球洋壳、大洋域、次大洋域、洋脊域、全球陆壳     |
| 板块           | 大陆板块、大洋板块、16板块                       |
| 断层与转换断层 | 大西洋/印度洋/太平洋转换断层、板块转换断层、海沟 |
| 洋脊与火成岩   | 洋脊、大火成岩省、LLSVP                          |
| 地质活动点     | 热点、火山、Dupal异常洋                          |

## 技术栈

- Leaflet（地图库）
- 天地图 API（底图）
- Vanilla JavaScript
- PWA（Service Worker + Manifest）

## 使用方法

1. 直接用浏览器打开 `index.html`
2. 点击左上角"要素加载"按钮展开图层面板
3. 勾选图层加载 GeoJSON 数据
4. 点击颜色按钮设置颜色模式
5. 点击要素查看详情

## 项目结构

```
gis/
├── index.html          # 主页面
├── app.js              # PWA 注册脚本
├── service-worker.js   # Service Worker
├── manifest.json       # PWA 配置
└── assets/
    ├── geojsonloader.js    # 核心功能脚本
    ├── geojsonloader.css   # 样式
    ├── leaflet.js          # Leaflet 库
    └── geojson/            # GeoJSON 数据文件
```

## 开发说明

- 图层配置在 `assets/geojsonloader.js` 的 `geoJsonGroups` 数组中
- 添加新图层：配置 name 和 file 字段
- 添加新分组：在 `geoJsonGroups` 中添加新对象

## 浏览器兼容性

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+
