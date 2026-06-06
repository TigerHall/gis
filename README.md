# OGV 海洋地质一张图

基于 Leaflet 的 WebGIS 应用，用于展示全球海洋地质矢量数据。

- **国内访问**：<https://dupal.cn/>
- **国外访问**：<https://www.dupal.cn/>

## 联系我们

- **数据与研究**　余老师：[yuxing@sio.org.cn](mailto:yuxing@sio.org.cn)
- **网站技术问题**　何同学：[hehuhall@outlook.com](mailto:hehuhall@outlook.com)

欢迎将已发表的论文 DOI/链接和数据内容邮件告知，我们会很乐意在平台上加入你的科研数据。目前对百兆左右的矢量类数据渲染支持较好，过大的数据正在研究如何流畅展示。

## 功能概览

- **多底图切换**：天地图影像/矢量/地形、ArcGIS 海洋/影像/街道/地形、OSM、ETOPO 2022 全球底图
- **图层管理**：40+ 矢量图层按分组加载，支持复选框开关、全选/全不选
- **颜色模式**：单一色、内部多色、按字段着色，支持字段值筛选
- **大数据渲染**：Canvas 点渲染 + Grid 网格聚类 + RBush 空间索引，流畅展示 45 万+ 点位
- **智能搜索**：倒排索引 + 模糊匹配，毫秒级检索任意图层要素，支持中文/英文混合搜索
- **投点编辑**：自定义投点编辑器，支持坐标粘贴批量导入，表格编辑
- **文件上传**：支持 GeoJSON / Shapefile / KML / KMZ / ZIP 格式，支持文件夹递归扫描
- **GeoJSON 下载**：点击加载状态圆点即可下载图层原始 GeoJSON
- **测量工具**：距离与面积测量（Geoman 插件）
- **编辑工具**：绘制、修改、删除矢量要素
- **导出图片**：Ctrl+E 一键截图导出 PNG
- **PWA 离线**：Service Worker 缓存，可安装到桌面，离线可用
- **标签显示**：控制点要素名称标签开关
- **鼠标坐标**：实时显示光标所在位置经纬度

## 数据来源

### 底图服务

| 服务 | 说明 |
| ------ | ------ |
| 天地图 | 国家地理信息公共服务平台，提供影像/矢量/地形底图及标注 |
| ArcGIS | Esri 在线地图服务，提供海洋专题底图、卫星影像、街道地图等 |
| OSM | 开源众包地图，社区贡献的全球地理数据 |
| ETOPO 2022 | NOAA 全球地形/水深格网数据 |

### 全球板块构造

- **全球16大板块** — USGS 板块边界数据
- **板块 (Hasterok2022)** — Hasterok et al., 2022 新一代板块构造模型
- **大陆板块 / 大洋板块** — 板块分类数据
- **洋中脊** — 全球洋中脊分布
- **海沟** — 全球海沟分布
- **转换断层** — 全球转换断层，含大西洋/印度洋/太平洋分区

### 洋中脊作用域

- **全球洋壳 / 全球陆壳** — 洋壳与陆壳范围
- **大洋域 / 次大洋域 / 洋中脊作用域** — 大洋域分级分类
- **作用域边界** — 1-5 级作用域边界

### 海底基础信息

- **火山** — Smithsonian 全球火山数据库
- **热点** — 全球地幔热点分布
- **大火成岩省 (Johansson)** — Johansson et al. 大火成岩省数据集
- **洋壳年龄 30Ma** — 全球洋壳年龄格网
- **盆地 (Evenick2021)** — Evenick et al., 2021 全球沉积盆地
- **盆地 (CGG)** — CGG 沉积盆地数据

### 大型异常区

- **LLSVP** — 大型低剪切波速省（Large Low-Shear-Velocity Province）
- **Dupal 异常洋** — Dupal 同位素异常洋域

### 海底矿产资源

- 多金属结核、富钴结壳、热液喷口、热液硫化物

### 地质站位

- **DSDP** — Deep Sea Drilling Project（深海钻探计划，1968-1983）
- **ODP** — Ocean Drilling Program（大洋钻探计划，1985-2003）
- **IODP 航次 3-13 / 13-26** — International Ocean Discovery Program（国际大洋发现计划）
- **古生物学 PBDB** — [Paleobiology Database](https://paleobiodb.org/)（古生物学数据库）
- **气候岩性指标** — Boucot 气候岩性指标数据（源自 PBDB）

## 技术栈

| 技术 | 用途 |
| ------ | ------ |
| Leaflet.js | Web GIS 地图引擎 |
| Canvas 点渲染 | 40 万+ 级点位高性能渲染 |
| Grid Clustering | O(n) 网格预聚合聚类算法 |
| RBush | 空间索引（命中检测 + 视口裁剪） |
| IndexedDB | GeoJSON 数据与搜索索引本地缓存 |
| 倒排索引 | 全文搜索，支持中文分词 + 模糊匹配 |
| Gzip 压缩 | GeoJSON 数据 gz 存储，PWA 加速加载 |
| Geoman | 测量与绘图编辑工具 |
| html2canvas | 地图截图导出 |
| PWA / Service Worker | 离线缓存与可安装应用 |

## 使用方法

### 基础使用

1. 直接用浏览器打开 `index.html`
2. 点击左侧"要素加载"按钮展开图层面板
3. 按分组浏览并勾选图层加载数据
4. 使用 ⚙️ 地图设置面板开关各项功能
5. 点击要素查看详情弹窗
6. 使用 🎨 调色板设置颜色模式

### 打开外部文件

- **拖放打开**：将 `.geojson` / `.json` / `.kml` / `.kmz` / `.shp` 文件或文件夹拖入页面即可加载
- **文件上传**：点击"📄 上传矢量"按钮选择文件
- **文件夹上传**：点击"📁 选择文件夹"按钮扫描目录内所有矢量文件

### 快捷键

- **Ctrl+E** — 导出地图为 PNG 图片

## 项目结构

```text
gis/
├── index.html              # 主页面
├── service-worker.js       # Service Worker 离线缓存
├── manifest.json           # PWA 配置
├── about.html              # 关于页面
├── assets/
│   ├── geojsonloader.js    # 核心功能脚本
│   ├── geojsonloader.css   # 图层管理样式
│   ├── main.css            # 布局与主样式
│   ├── dialog.js           # 弹窗与 Toast 工具
│   ├── dialog.css          # 弹窗样式
│   ├── pointdrop.js        # 投点编辑器
│   ├── geo-utils.js        # 地理工具函数
│   ├── marked.min.js       # Markdown 渲染
│   ├── leaflet.js          # Leaflet 库
│   ├── Leaflet.MarkersCanvas.js  # Canvas 点渲染插件
│   ├── Leaflet.GzIdbLoader.js    # IndexedDB 缓存加载器
│   └── geojson/            # GeoJSON 数据文件
```

## 开发说明

- 图层配置在 `assets/geojsonloader.js` 的 `geoJsonGroups` 数组中
- 添加新图层：在对应分组中添加 `{ name, file }` 配置
- 添加新分组：在 `geoJsonGroups` 中添加新对象
- 搜索索引自动在 IndexedDB 中缓存，刷新页面后直接恢复
- 所有矢量数据已压缩为 `.geojson` 文件通过 COS 加速加载

## 浏览器兼容性

- Chrome 90+
- Firefox 90+
- Safari 15+
- Edge 90+

## 许可与备案

- 蜀ICP备2025119436号-2
- 浙公网安备33030402001567号
- 数据版权归原作者所有，仅供学术参考
