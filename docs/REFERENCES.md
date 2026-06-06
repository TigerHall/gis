# 参考文献与数据来源

本文件记录 OGV 平台所使用的数据来源、引用文献、技术参考及 GitHub 仓库，方便后续查阅与更新。

---

## 数据来源

### 底图服务

| 服务 | 来源 | 说明 |
| --- | --- | --- |
| 天地图 | 国家地理信息公共服务平台 | 影像/矢量/地形底图及标注 |
| ArcGIS | Esri 在线地图服务 | 海洋专题底图、卫星影像、街道地图等 |
| OSM | OpenStreetMap 社区 | 开源众包全球地理数据 |
| ETOPO 2022 | NOAA National Centers for Environmental Information | 全球地形/水深格网数据 |

### 全球板块构造

- **全球16大板块** — USGS 板块边界数据
- **板块 (Hasterok2022)** — Hasterok et al., 2022 新一代板块构造模型
- **大陆板块 / 大洋板块** — 板块分类数据
- **洋中脊、海沟、转换断层** — 全球构造边界数据

### 洋中脊作用域

- **全球洋壳 / 全球陆壳**
- **大洋域 / 次大洋域 / 洋中脊作用域**
- **作用域边界**（1-5 级）

### 海底基础信息

- **火山** — Smithsonian 全球火山数据库
- **热点** — 全球地幔热点分布
- **大火成岩省 (Johansson)** — Johansson et al.
- **洋壳年龄 30Ma** — 全球洋壳年龄格网
- **盆地 (Evenick2021)** — Evenick et al., 2021 全球沉积盆地
- **盆地 (CGG)** — CGG 沉积盆地数据

### 大型异常区

- **LLSVP** — 大型低剪切波速省
- **Dupal 异常洋** — Dupal 同位素异常洋域

### 地质站位

- **DSDP** — Deep Sea Drilling Project（1968-1983）
- **ODP** — Ocean Drilling Program（1985-2003）
- **IODP** — International Ocean Discovery Program
- **PBDB** — [Paleobiology Database](https://paleobiodb.org/)
- **气候岩性指标** — Boucot 气候岩性指标（源自 PBDB）

### 海底矿产资源

- 多金属结核、富钴结壳、热液喷口、热液硫化物

---

## 技术引用

### 核心库

| 名称 | 版本 | 用途 | 仓库 |
| --- | --- | --- | --- |
| Leaflet | 1.x | Web GIS 地图引擎 | <https://github.com/Leaflet/Leaflet> |
| Leaflet.MarkersCanvas | — | Canvas 点渲染插件 | 自研，见 `assets/Leaflet.MarkersCanvas.js` |
| Leaflet.GzIdbLoader | — | IndexedDB 缓存加载器 | 自研，见 `assets/Leaflet.GzIdbLoader.js` |
| RBush | — | 空间索引 | <https://github.com/mourner/rbush> |
| Geoman | — | 测量与绘图编辑 | <https://github.com/geoman-io/leaflet-geoman> |
| html2canvas | — | 地图截图 | <https://github.com/niklasvh/html2canvas> |
| marked | — | Markdown 渲染 | <https://github.com/markedjs/marked> |
| toGeoJSON | — | KML 格式转换 | <https://github.com/tmcw/togeojson> |
| shp.js | — | Shapefile 解析 | <https://github.com/calvinmetcalf/shapefile-js> |

### 数据格式支持

- GeoJSON — 原生矢量格式
- Shapefile (.shp + .dbf + .shx + .prj + .cpg)
- KML / KMZ
- ZIP（内可含以上格式）
- Gzip 压缩 GeoJSON（.geojson 预压缩存储）

---

## 仓库与部署

- **GitHub 仓库**：<https://github.com/TigerHall/gis>
- **国内访问**：<https://dupal.cn/>
- **国外访问**：<https://www.dupal.cn/>
- **部署方式**：GitHub Pages，自动从 `main` 分支部署
- **数据存储**：腾讯云 COS（对象存储）加速静态 GeoJSON 文件加载

---

## 待补充

- [ ] 补充具体论文引用（DOI）
- [ ] 补充各数据集的处理方法与版本
- [ ] 补充技术实现细节博客链接
