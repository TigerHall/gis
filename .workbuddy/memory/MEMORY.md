# OGV 项目长期记忆

## 文件架构

- `geo-config.js` 图层配置：`defaultOpacity` `color` `icon` `colorMode/colorField` `labelField` `source` `selectable` `hidden` `cesium:{extrudeHeight,clampToGround,pointPixelSize,groundMode}`
- `geojsonloader.js` ~5500 行核心；`app.js` 版本号/导出/SW/toggle；`geo-utils.js` 纯函数；`measure-export.js` 测量转图层；资源平铺 `assets/`，顺序见 `index.html`

## 图层下架 / 面板约定

- **`hidden: true`**（可写 group 或 layer）→ 跳过渲染但数据保留，随时一键恢复；
  整组 hidden 时不生成空 `details`（`visibleLayerCount` 计数）
- 设置面板：`#quickBar` 常用功能（8 项图标网格）+ `details.toggle-sub` 次级折叠（折叠态显 `已开/总数` 徽标）
- **快捷区 = 地图设置的快捷键，不是第二份设置**（2026-09-12 定型）：
  状态唯一来源是面板里的 `<input type="checkbox" id="xxx">`（`toggleConfig` 按 id 注册）；
  快捷项是 `<button id="xxxQuick" data-quick-for="xxx" aria-pressed>`，点击转发
  `master.checked = !checked` + `dispatchEvent("change")`，反向靠 `document` 的 change 委托。
  **快捷区绝不能持有同 id 元素**（重复 id 会让 `getElementById` / `initToggle` 抓错那一个）
- 动作按钮（`exportMapBtn`）用 `data-action` 绑定，快捷区与「操作」分类两处入口共用同一个处理函数
- **`clusterToggle`/`labelToggle` 不在 `toggleConfig`**，由 `geojsonloader.js` 更晚恢复 →
  `window._syncQuickStates()` 必须可重入（渲染②后 + `load` 事件各跑一次）
- 快捷项手感（原透明 checkbox 铺满 = 按下零反馈）：`:active` 置 `transition-duration:0s` +
  `scale(.94)`（跟手来自「立刻」而非「更快」）；`touch-action:manipulation`；
  hover 收进 `@media (hover:hover)`；焦点用 `:focus-visible` 不用 `:focus-within`
- **CSS**：`.is-on` 与 `:has()` 必须拆成两条规则（选择器列表含无效项会整条丢弃）
- **选中态边框与焦点环都不能用 `--accent`**（#99cc99 对 #eee 仅 1.58:1，WCAG 1.4.11 要 ≥3:1；
  对 #fafafa 作焦点环 1.8:1 也不满足 2.4.11 的 3:1）→ 用 `--c-green-text-strong`
  （浅 4.84:1 / 深 8.06:1）。开关能有 `--accent` 是因为有「滑块位移」这个非颜色线索，纯色块控件没有
- **绿字一律走 `--c-green-text-strong`（现 #3a743a）**，`--accent`/`--accent-lighter`/`--c-green-text` 都太浅（1.7–3.8:1）。`--section-text` 已指向它
- **绿底要配深字**（`#1a1a2e`，9.3:1），别配白字（1.83:1）——`feature-panel.css` 的既有范式
- 深色主题下 `--c-green-text-strong` 与 `--c-green-text` **同值 #88cc88** → 改浅色 token 不影响深色
- **待定**：`--c-text-dim` #999（浅 2.61）/ #777（深 3.97）未达 AA，属可见设计取舍，未改
- 程序化改 `checked` 要 `dispatchEvent(new Event("change",{bubbles:true}))` 才生效
- 导出图片记得一起隐藏 `#waybackBar`

## 布局稳定性（滚动条槽位）

- **用「懒预留」，不要无条件 `scrollbar-gutter: stable`**（2026-09-12 定，取代早先的一刀切）。
  机制在 `assets/scroll-gutter-guard.js`：容器**第一次真的溢出**时才打
  `data-scroll-guttered`，此后常驻；CSS 只有一条 `[data-scroll-guttered]{scrollbar-gutter:stable}`（main.css）。
  打标记那一刻滚动条已在占位 → 引入 stable 零视觉变化；之后变短也不还回去 → 无往返抖动。
  侧栏宽固定，无条件预留会让「很少溢出」的容器（图例只有几条时）白留 10px
- **判定标准是「会不会经常在 溢出↔不溢出 之间往返」，不是「有没有 `overflow-y:auto`」**：
  `.panel-scroll`/`.search-results`/`.dialog-body`/`.md-toc-list` 实测恒溢出 → 预留≈零成本；
  `.feature-panel-table-wrap` 会往返（2 行不溢 / 20 长行溢，预留 15px）；
  `.leaflet-legend-control` 极少溢出（900px 视口要 ≥20 条才滚）
- **守卫怎么发现首次溢出**：文档级 `MutationObserver`(childList+subtree) 只对
  新增子树做定向 `querySelectorAll` + `rec.target.closest(SELECTOR)`，合并到 rAF 执行；
  外加 `DOMContentLoaded`/`load`/`resize`(防抖150ms)/600·2000·5000ms 粗扫。
  标记进 `WeakSet`，`check()` 先查后标，避免反复重排
- **新增滚动容器时**把选择器加进 `scroll-gutter-guard.js` 的 `SELECTOR` 数组即可
- **别用 `overflow-y: scroll` 替代** —— 它会连滚动条轨道一起画出来，视觉更脏
- **对话框正文上限要扣掉头部**：`.dialog-body` 原 `min(80vh,600px)` 没算头部(~57px)，
  视口 <525px 时 `.app-dialog` 自身也溢出 → 两层嵌套滚动条 + 正文被推窄 15px。
  现为 `min(600px, calc(100vh - 140px))`（视口 ≥700px 时与原先完全一致）
- **只写 `overflow-x: auto` 会让 `overflow-y` 由 `visible` 计算成 `auto`** →
  审计会误判成「未预留的纵向滚动容器」。`pre` 这类不会纵向滚的元素应显式
  `overflow-y: hidden` 消歧
- **供应商样式表不动**：`leaflet.css` 的 `.leaflet-popup-scrolled`（要 `L.popup`
  的 `maxHeight`）/ `.leaflet-control-layers-scrollbar`（要 `L.control.layers`）本项目都没用到

## Markdown 文档弹窗（`dialog.js` `showMarkdown`）

- **`marked` 不做路径重写**，`body.innerHTML = marked.parse(md)` 产出的
  `<img src="shots/x.png">` 是以**页面 URL** 为基准解析的 → `docs/` 下文档写相对图必 404。
  已加 `resolveRelativeImages(root, docUrl)`：按**文档自身目录**补前缀
  （`docs/CHANGELOG.md` + `shots/a.png` → `docs/shots/a.png`）。
  这样 App 内与 GitHub（文件在 `docs/`）**两边同时成立** —— 不要图省事写成 `docs/shots/...`，
  在 GitHub 上会变成 `docs/docs/shots/`。只改相对路径，`/` `//` `http:` `data:` `#` 不动
- **`.dialog-body` 是 `overflow-x: hidden`**（防宽表格撑破弹窗）→ 弹窗内出现超宽内容时
  用户**拖不动**。⚠️ `overflow:hidden` 的盒子 `scrollLeft` 仍可被脚本改写，
  只断言 `scrollLeft` 会把「用户滚不动」漏判成「能滚」——判据必须是 `overflow-x` 真变 `auto`
- 大图查看 = 点击切 `img.md-zoom` + `<dialog>` 加 `.md-zoomed`
  （宽 `min(1840px,96vw)`，`overflow-x: auto`）→ 原始像素显示，再点还原。
  对照图多为**2 倍图**（3420×1860），塞进 680px 弹窗只有 18% 缩放

## 通用坑

- **TDZ**：对外只暴露延后调用的 getter
- WMS 须支持 EPSG:3857
- **GzIdbLoader**：gzip → IndexedDB（DB v2，key=URL）；仅 .gz；**`setCache` 必须 await**
- 倒排索引 tokens 用 `Object.create(null)`；要素定位按 `feat.geometry` 真实坐标
- 反子午线线/面三副本，点 ≤3000 才做；主题色 `#9c9`；`.layer-panel{font-size:0}`
- 清除循环须显式排除 `dupal_user_layers`（前缀 `indexOf` 会误匹配）
- 绿色小字用 `--c-green-text-strong`（`--accent` 浅底仅 1.8:1）
- 改资源后必 bump `service-worker.js` 的 `CACHE_NAME`
- **版本号唯一真源 = `service-worker.js` 的 `CACHE_NAME`**（`app.js` 运行时发
  `GET_VERSION` 问 controlling SW，不硬编码；`manifest.json` 无 version 字段）。
  改这一行即可，会顺带触发 SW 更新弹窗 + 缓存重建 —— 但**未提交/未发布的版本号不必为新改动二次 bump**

## 2D 渲染

- **Canvas**（>3000 点）：点 8px / hit 10px；RBush 仅 hit 检测；`updateColors()` 增量改色
- **DOM+聚类**（≤3000）：divIcon **无 `setStyle`**
- 透明度递归 `applyLayerOpacity()`；`markerClusterGroup` 必须 `getAllChildMarkers()`
- `reloadLayerWithNewMode` 第 6 参 `forceRebuild`：iconType/iconSize 变化必传 true
- 进度条 `updateLayerProgress(id,null)` **必须 removeChild 摘节点**
- **pane 层级**：瓦片 200 < `baseImagePane` 250（影像底图）< `demPane` 350（DEM）< 矢量 400 < 标记 600
  DEM 画布要挪进 `demPane` 才盖得住底图（`Leaflet.DemRenderer.js` `_moveCanvasToDemPane()`）

## Cesium 3D

- 共享 featureCache 直喂 `GeoJsonDataSource.load()`，零转换；CDN v1.125
- **已修坑**：① Point 用 billboard 非 `entity.point` ② `ArcGisMapServerImageryProvider` CDN 报错 → `UrlTemplateImageryProvider`+`tile/{z}/{y}/{x}` ③ 贴地面无 polygon outline ④ 聚类 Label 须 `CENTER/CENTER/pixelOffset=ZERO`
- **`CLAMP_TO_GROUND` 是卡顿元凶**（每帧 O(n) 采样，n=1116 时 5620ms vs 602ms）。点默认 `"none"`，显式 `"live"` 且 ≤300 才贴地
- **关→开瞬时**：取消勾选只 `ds.show=false` + 挪 `cesiumHiddenCache`（LRU 12）；`reloadLayer/All` 须 `destroyLayer`
- 图标用 2D 同源 `getIconFactory` 转 SVG data-uri（按色缓存）；面填充 `min(opacity,0.45)`；面边界 `#555`；聚类 `pixelRange=28,minSize=4`
- 状态桥接见 `window._ogv_*`（`_layerColorMap` 等）
- **Z 坐标须压平**：`GeoJsonDataSource` 读到第三分量就走 `perPositionHeight` → 不同 SHP 的 Z 基准不一 → 「有的没贴地、接边穿插」。修法 = 加载前 `CesiumGeoJsonAdapter.normalizeGeometryZ()`（无 Z 时零拷贝原对象，不动 2D 共享数据）
- 聚类气泡不吃 `updateOpacity` → dataSource 上记 `_ogvOpacity` 手动同步

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

## Git 与发布

- **git 操作（add / commit / push / tag）由用户自己执行，不要代劳**（2026-09-12 用户明确）
- 远程 `https://github.com/TigerHall/gis.git`，主分支 `main`，**无 tag** ——
  版本号只活在 `service-worker.js` 的 `CACHE_NAME`，GitHub 上看不到版本标记
- `.gitignore` 只忽略 `/CNAME` 与 `.workbuddy/artifacts/`（AI 过程产物：调试截图、
  一次性探针脚本），有价值的结论迁 `docs/`。⚠️ `docs/shots/` **不在**忽略之列 ——
  它是「应入库」的文档资产，别误当成 artifacts
- `.gitattributes`：`* text=auto eol=lf` + 二进制显式声明（`*.gz` `*.png` `*.jpg`
  `*.webp` `*.ico` `*.gif` `*.woff*` `*.ttf` `*.map`）→ 入库 PNG 不会被行尾转换损坏
- **`docs/` 会随站点发布**：`app.js` 运行时 `fetch("docs/CHANGELOG.md")` 渲染「更新记录」，
  所以 `docs/` 下的东西既进仓库也上线上 → 「入库」与「上线」是同一件事
- **待办**：`docs/shots/` **15 张 / 约 1.50 MB** 仍 **untracked**，等用户自行 `git add`
- `docs/shots/` 下的图**已全部被 `docs/CHANGELOG.md` 引用**，无孤儿文件
  （新增的 `wayback-bar-2x.png` 也在内）

## CHANGELOG 内嵌截图

- Markdown 相对路径按**页面 URL** 解析（`marked` 不重写）→ `assets/dialog.js` 的
  `resolveRelativeImages(root, docUrl)` 按文档所在目录补前缀，App（`docs/`）与
  GitHub 两边同时成立
- 图片 `max-width:100%` **只封顶不放大**；⚠️ 别把尺寸悬殊的两张图放进同一张表格 ——
  列宽按原图比例分配，1440 与 408 并排会把 408 那张压到 **132px**（等于白截）
- 细节图用 `deviceScaleFactor: 2` **重新渲染**，不要位图放大（203×42 的控件放大必糊）
- 点击放大 = `.md-zoom` + `.app-dialog.md-zoomed`；`.dialog-body` 平时 `overflow-x:hidden`
  （防宽表格撑破），放大态必须放开成 `auto`，否则右半张图鼠标拖不到（脚本仍能改 `scrollLeft`，会漏判）

## 本机工具链坑

- **Bash 工具 PATH 为空** → 命令前必须 `export PATH="/usr/bin:/bin:/c/Program Files/nodejs"`；PowerShell 工具 stdout 不回传，只能用 Bash
- Playwright 脚本在 `~/.workbuddy/binaries/node/workspace/`，跑前须 `export NODE_PATH=.../node_modules`
- Geoman 形状名是 **`Line`** 不是 `Polyline`（`enableDraw("Polyline")` 抛错）
- **`getComputedStyle` 会返回 transition 的中间值**：改完类名立刻读 = 读到旧值。
  判定样式前先 `await 400ms`，否则会把「样式没生效」误判成 bug
- **Playwright 默认传 `--hide-scrollbars`** → headless 下滚动条**根本不渲染**，
  `scrollbar-gutter: auto` 永远不占位，量「滚动条出现后宽度变化」会得到
  **抖动 0px 的假阴性**。必须 `ignoreDefaultArgs: ["--hide-scrollbars"]`
- **`page.evaluate(fn, arg)` 只序列化 `fn`** → 函数体内不能引用模块级常量
  （报 `ReferenceError: XXX is not defined`），字面量要写在函数里
- **`overflow: hidden` 的盒子 `scrollLeft` 仍可被脚本改写** → 用 `scrollLeft` 能改变
  来判「能否横向滚动」会漏判。必须查 `getComputedStyle(el).overflowX` 是否 `auto`/`scroll`
- **量尺寸/样式前必须等过渡结束**（本项目第三次踩）：新加的 `transition: width .18s`
  让点击后立即测量拿到插值起点，会误判成「CSS 规则没生效」