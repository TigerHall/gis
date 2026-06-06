# 更新记录

## 2026-06-06

### Shapefile 中文乱码问题总结

- **结论**：本次问题主要是数据问题，不是前端问题
- `.cpg` 文件内容为 `GB2312` 时，浏览器 `TextDecoder` 不支持，导致解码失败
- **建议**：用文本编辑器将 `.cpg` 文件内容改为 `GBK` 或 `UTF-8`
- 前端保留对 `.cpg` 缺失/内容为 `GB2312` 的警告提示

---

## 2026-06-04

### Leaflet.VectorGrid 测试

- 用 `L.vectorGrid.slicer()` 替代手动三副本方案
- **关键修复**：`L.SVG.Tile` 的 `_drawing` 标志未设置导致 fill 不可见
- 解决：在 `rendererFactory` 中设置 `r._drawing = true`

### Shapefile 中文乱码踩坑

- 尝试过 4 种方案（修改 shp.js、注入 .cpg、自动检测编码）均不理想
- **最终方案**：不自动注入，只做警告提示，由用户自行修复数据源
- `companionExts` 扩展为 8 个文件类型（.dbf .shx .prj .cpg .xml .sbn .sbx）
- GB2312 编码自动修正为 GBK（浏览器不支持 GB2312）

---

## 2026-06-03

### 底图重构

- 新增 ETOPO 2022 全球底图（高清/普通两个版本）
- **代码重构**：统一定义 `baseLayers` 常量，删除重复的 `allBaseLayers`
- 新增 `createWorldCopyImageOverlay()` 解决 ETOPO 跨 180° 消失问题
- 修复存储键名 typo：`dupal_basemap` → `yugis_basemap`
- 默认底图改为 `etopohighLayer`（高清版）

---

## 2026-06-02

### 侧边栏图钉功能

- 新增图钉按钮（📌），可将侧边栏钉住进入文档流
- 钉住时面板改为 `position: relative`，与地图形成 flex 布局
- 状态存入 `localStorage`，刷新后自动恢复

### 导出地图图片方案演进

- **v1** → **v5** 多次迭代，最终采用 `html-to-image` + `filter` 回调
- 彻底解决线/面偏移、SVG `<use>` 404、DOM 恢复报错等问题
- 当前方案（v5）：用 `filter` 回调排除控制节点，节点不离开 DOM

---

## 2026-05-26

### 导出地图图片功能

- 用 `html2canvas` 实现地图导出
- 所有瓦片图层加 `crossOrigin: 'anonymous'`
- 绑定 Ctrl+E 快捷键触发导出

### 备案号 + GitHub Actions

- 备案号 `蜀ICP备2025119436号-2` 加在地图右下角
- 新建 `.github/workflows/deploy-cos.yml`，push 时自动同步到腾讯云 COS

### About 页面

- 新建 `about.html`，包含功能概览、数据来源、技术栈说明
- 侧边栏新增 ℹ️ 按钮入口
- 重构为头/身/脚布局，自动生成 TOC 目录

### 新增图层

- 热液喷口（721点）→ "海底矿产资源" 组
- 洋中脊岩样（5个图层，共 3470 点）→ "洋中脊作用域" 组

---

## 2026-05-24

### 线/面标签显示功能

- 线/面要素支持 tooltip 显示
- 修复 `labelToggle` HTML 默认 `checked` 与 JS 状态不一致

### 投点编辑器优化

- 粘贴框固定尺寸（252px × 48px）
- 全局粘贴监听 + 剪贴板自动读取
- 重复内容跳过（防重复触发）
- 表格列宽按列名字符数动态计算

### 状态圆点点击下载 GeoJSON

- 绿色（loaded）状态圆点支持点击下载对应 GeoJSON 文件
- 预置图层优先从缓存取完整 features，用户上传图层直接从内存取

---

## 2026-05-23

### 底图选择持久化

- `localStorage` 存储底图选择，刷新后自动恢复

### Popup 标题自动识别

- 自动不区分大小写查找 `name` 字段，显示为绿色粗体标题

### 侧边栏宽度可调节

- 面板右侧添加拖拽手柄，宽度范围 180-500px
- 宽度存入 `localStorage`，刷新后保持

### 搜索功能增强

- 搜索框右侧加清空按钮（×）
- 搜索结果区域 max-height 改为 65vh
- 搜索结果点击定位：点用 `panTo`，线/面用 `flyToBounds`

### 倒排索引搜索

- 所有数据集加载后都构建倒排索引（分词 + 交集查询）
- 支持中英文混合搜索、模糊匹配
- 索引构建状态提示（"建立搜索索引中..."）

### 增量颜色更新

- 所有颜色模式（single/sequential/field）均走增量路径
- 利用缓存的 `properties` 字段重算颜色，避免全量重建

---

## 2026-05-22

### 拖入文件夹支持

- 通过 `webkitGetAsEntry()` 检测是否为目录
- 目录：递归扫描收集所有文件后走文件夹上传逻辑
- 单文件：走原有 `loadFileAsUserLayer` 通道

### 文件夹上传支持裸 SHP 文件

- 用 JSZip 将配套文件打包成内存 zip → 喂给 `shpjs` 解析
- 缺少配套文件不阻断，记录到 `warnings` 数组统一提示

### 强制刷新自定义选项

- 版本号双击弹出三选项对话框（仿 iOS ActionSheet 风格）
- 选项：仅清空 SW 缓存 / 清空 SW + GeoJSON 数据库 / 取消

---

## 2026-05-21

### 反子午线渲染最终方案

- **放弃坐标修正**，改用**三副本方案**（worldCopy）
- 不做任何坐标修正，直接在 [-360, 0, +360] 三个位置各渲染一份
- 让跨 180° 的面自然连续显示（和底图瓦片效果一致）

### Canvas 点位不渲染修复

- `setFeatures()` 在 `addTo(map)` 之前调用导致重绘被跳过
- 修复：在 `onAdd` 末尾检查已有 features 则补调 `_redraw(true)`

### 地图限制与 UI 改进

- `MAX_LATITUDE` 设为 90，阻止用户拖到极区
- PWA 安装逻辑优化
- 版本号从 `service-worker.js` 自动读取
- SW 更新提示：检测新 SW 安装完成时弹出顶部 toast

---

## 2026-05-11

### Leaflet.MousePosition.js PWA 感知逻辑

- 未安装 PWA → 点击唤起原生安装弹窗
- 已安装 PWA 且非 iOS → 点击全屏/退出全屏
- 已安装 PWA + iOS → 不显示图标（已是 standalone 全屏）

### Canvas 聚类算法优化

- 从 DBSCAN（O(n²)）改为 Grid 网格预聚合（O(n)）
- 移除 `MAX_CLUSTER_POINTS` 限制，聚类开关直接控制

### Canvas 点点击无信息窗格修复

- 去掉 `featuresArray.length <= 10000` 条件
- 所有数据集均设置 `onFeatureClick`

---

## 2026-05-10

### Canvas 插件改造

- 重命名为 `Leaflet.MarkersCanvas.js`（UMD 格式）
- 单点半径调整为 8px（匹配 DOM 版 Marker 视觉大小）
- 修复多处 bug（变量名不一致、语法错误等）

### 内存优化

- 修复 `addUserLayer` 内存爆炸问题（45万点创建 45万个 Marker DOM）
- 改为纯坐标数组遍历计算 bounds，零 DOM 对象创建
- `layerBoundsCache` 改用轻量 `L.LatLngBounds` 对象

### 聚类全缩放级别启用

- 移除缩放条件限制，聚类在所有缩放级别都启用
- Canvas 图层复用优化：颜色模式切换时直接复用已加载的图层

---

## 早期更新

### 2026-05-09 及之前

- PIC 45万点大数据集支持
- GeoJSON 加载与缓存优化（IndexedDB）
- COS 加速（腾讯云对象存储）
- 搜索功能（全文搜索、字段搜索）
- 颜色配置（单色/渐变色/字段映射）
- 侧边栏面板交互优化
- PWA 支持（离线访问、安装提示）

---

## 技术栈

- **地图引擎**：Leaflet.js
- **渲染优化**：Canvas 渲染（大规模点数据）、VectorGrid（大规模面/线数据）
- **数据存储**：IndexedDB（GeoJSON 缓存 + 搜索索引）
- **构建工具**：无（纯静态 HTML/JS/CSS）
- **部署**：GitHub Pages + 腾讯云 COS（自动同步）

---

## 数据安全

**本站仅提供地理数据可视化功能，不收集、存储或传输任何用户数据。**

- 所有用户上传的文件仅在浏览器本地处理
- 不会上传到任何服务器
- 不会保存至任何云端
- 关闭页面后，未保存的数据将丢失

---

<!-- ## 许可证 -->

<!-- 本项目采用 MIT 许可证。您可以自由使用、修改和分发本项目的代码。 -->

---

## 联系方式

- **Issues**：[GitHub Issues](https://github.com/tigerhall/gis/issues)
- **Email**：[hehuhall@outlook.com](mailto:hehuhall@outlook.com)
