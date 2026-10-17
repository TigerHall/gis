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
- **海底光缆 & 光缆登陆点** — [TeleGeography](https://www.telegeography.com/) 全球海底光缆基础设施数据

### 大型异常区

- **LLSVP** — 大型低剪切波速省
- **Dupal 异常洋** — Dupal 同位素异常洋域

### 地质站位

- **DSDP** — Deep Sea Drilling Project（1968-1983）
- **ODP** — Ocean Drilling Program（1985-2003）
- **IODP** — International Ocean Discovery Program
- **洋中脊 / 洋盆岩石采样** — 各大洋中脊与洋盆的 Sr-Nd-Pb 同位素样品数据
  （按洋区分为大西洋 / 太平洋 / 印度洋三个小分组）
- **PBDB** — [Paleobiology Database](https://paleobiodb.org/)
- **气候岩性指标** — Boucot 气候岩性指标（源自 PBDB）

### 海底矿产资源

- 多金属结核、富钴结壳、热液喷口、热液硫化物
- **PMN / PMS / CFC 勘探合同区** — ISA（国际海底管理局）公布的深海勘探合同区空间数据
- **EBSA 海洋保护区** — Convention on Biological Diversity (CBD) 全球具有特殊生态意义海域（EBSA）与海洋保护区（MPA）

### 社会热点专题

- **全球军事设施** — Man (2021) 发布的 "Overseas Military Bases Dataset"（海外军事基地数据集），基于 OSINT 方法整合政府报告、新闻报道与卫星图像验证构建
- **全球海盗事件** — Anti-Shipping Activity Messages (ASAM) 全球海盗与武装劫船事件数据库（美国国家地理空间情报局 NGA）

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
| html-to-image | 1.11.11 | DOM 快照兜底（主出图路径已改为自研引擎） | <https://github.com/bubenshchykov/html-to-image> |
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

## 主要参考平台

> 2026-10-06 用户指定：**GeoLibre 作为本项目的首要参考平台**。
> 以后要加/改功能，先看它有没有现成实现与设计取舍。

### GeoLibre（OpenGeoS）

- **仓库**：<https://github.com/opengeos/GeoLibre>
- **在线版 / 文档**：<https://geolibre.app>
- **许可**：MIT（可商用、可改）
- **定位**：轻量、云原生 GIS；同一套工作区跑在浏览器 / 桌面（Win·macOS·Linux）/
  Android·iOS / Jupyter，数据留在本地。

**技术栈**（与本站差异较大，仅供取舍参考）

| 层 | GeoLibre | 本站 |
|---|---|---|
| 渲染 | **MapLibre GL JS**（WebGL）+ deck.gl | Leaflet（DOM/SVG + Canvas） |
| 框架 | React + TypeScript，npm workspaces 单仓多包 | 原生 JS 多文件，无构建 |
| 分析 | **DuckDB-WASM Spatial**（浏览器内 SQL） | IDB + rbush + 手写过滤 |
| 外壳 | Tauri v2 | 纯静态 PWA |
| 后端 | 3 个 worker + Python `geolibre_server` | 无（纯静态 + COS） |

**功能清单（对我们有参考价值的）**

- **Print Layout（出图排版）** —— 见下节，是我们出图功能的直接参照
- 3D Tiles / Time Slider（时间轴播放）
- 700+ 地理处理工具（WASM，无 Python sidecar）
- SQL 工作区（DuckDB）
- 行星底图（月球/火星/水星/金星/木卫/土卫/冥王星…），按天体设椭球
- 插件 API、项目协作（presence/chat/权限）、**Export as HTML**（整个项目导成单文件离线 HTML）、离线底图预缓存

---

### 📌 Print Layout 逐项拆解（我们出图的「目标形态」）

来源：<https://geolibre.app/user-guide/print-layout>

**界面**：左侧控件、右侧**实时预览**；改了地图要按 `Recapture map` 重新抓取
（因为它的预览是基于 live map 的截图 —— 我们是重渲染，不存在这一步）。
分隔条可拖动。布局随项目保存，一个项目一个 layout。

| 分组 | 能力 |
|---|---|
| **标题** | Title / Subtitle；位置 `Outside frame`(框上) 或 `Inside frame`(压在图上)；对齐左/中/右 |
| **页面** | 纸张 A4/A3/Letter/Legal/Tabloid；屏幕预设 **Full HD 1920×1080 / HD 1280×720 / 4K 3840×2160 / Square 1080×1080**；Custom 支持 px 或 mm；竖/横（自定义尺寸不可切）；边距 Normal / Narrow / None |
| **地图框** | Map background color（无数据处底色）、Map frame color / width（0 隐藏） |
| **比例** | **显式输入 1:N**（1:500 ~ 1:100,000 预设）；应用后会缩放 live map 再重抓；到不了就说「用了最接近的」 |
| **出图范围** | **Draw extent on map** 在地图上拖框；按 Shift 匹配页面比例；`Use active viewport` / `Clip to custom extent` / 清除 |
| **图面元素** | Title·Subtitle·Legend·Scale bar·North arrow（**可成组放置**）·Date·署名·Footer text·Page border·**Info block**(Author/Project No./CRS/Revision/scale) ·**Colorbar**(Colormap/Min/Max/Label/方向/位置/长度)·Custom legend·**Attribute table**·**Chart**(bar/pie/line) |
| **图例编辑器** | 每个可见图层一项：**改名 / 眼图标隐藏 / 上下移**；Legend title；`Group classes by layer`；重置回「自动图例」。**改的是项目图例本体**，与地图控件里的图例同源 |
| **Atlas** | 地图系列：每个要素一页，或沿线一串页面 |
| **导出** | PNG / PDF / **SVG** / Copy to Clipboard |
| **定位约束** | 元素**只能按 Position 吸附到页面角落，不能自由拖放**；v1 无自由文本框 / logo / 插图 / 套图 / 布局网格 |

**两条与我们直接相关的设计结论**

1. **坐标网格会被「连地图一起」捕获，且地图自动内缩以保证边缘标签不被裁掉。**
   —— 对应我们「经纬度要保留」：经纬网与边缘经纬度标注必须入图，
   且要考虑图幅边缘留白，别把标注切掉。
2. **图例来自「可见图层的符号系统」并可在编辑器里改名/隐藏/排序，
   改动会同步到地图控件里的图例。**
   —— 我们已有 `window._buildLegendData()`（单一数据源），
   天然满足「同源」；缺的是「编辑器」UI 与「分类按图层分组」。

**它也不做的**（我们不必强求）：自由拖放排版、自由文本框、logo/插图、套图、布局网格。

---

### CORS 与跨域的另一条佐证

GeoLibre 官方文档在「分享项目」处明确写：

> The host sends no cross-origin (CORS) headers, or it did not answer.
> Layers like this keep working in the desktop app, which is not subject to
> browser CORS, but stay empty in the browser viewer.

即：**无 CORS 头的图层在桌面端（Tauri，不受浏览器 CORS 约束）正常、
在浏览器里必然空白**。这与我们 2026-10-06 实测 31 个底图得出的结论一致
（真正会阻塞的是服务端不返 `Access-Control-Allow-Origin`，
而不是我们代码里的取图方式）。另注：它把 CORS 预检查做成
**「提示但不阻止分享」**，这个交互取舍值得借鉴。

---

## 待补充

- [ ] 补充具体论文引用（DOI）
- [ ] 补充各数据集的处理方法与版本
- [ ] 补充技术实现细节博客链接
- [ ] GeoLibre Print Layout 的对标实现进度（见 `CHANGELOG.md` 出图相关条目）
