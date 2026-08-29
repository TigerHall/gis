# 本轮工作总览（2026-08-29 夜）

## 用户反馈

1. 地图瓦片太糊——放大后还是最低级瓦片层级；参照 Leaflet 的 `maxNativeZoom` 即可
2. 瓦片加载会不会影响 JSON 图层渲染
3. 老用户预加载不重要，PWA 已缓存 js

## 修复结果

### 1. 瓦片清晰度：八子域 + SSE=2 翻案

**根因不是 SSE 本身**——而是天地图只用了 t0 单子域。Cesium 的 `RequestScheduler` per-server
并发上限默认 6，单域全挤一台 → 429 → 重试 → 死循环，只能降 SSE 换清晰度（这是上一轮误判）。

**A/B 决定性数据**（1280×800，本地 SwiftShader Chrome）：

| 方案 | 全球就绪 | zoom8 稳定 | 瓦片 | 429 | **锐度** | 子域 |
|---|---|---|---|---|---|---|
| A 原 SSE=24→12 + t0 | 超时 | 12.6s | 184 | 0 | **1.4** | 单域 |
| B SSE=2 + t0 | 34.4s | 15.1s | 392 | 0 | 94.6 | 单域 |
| **C SSE=2 + t0~t7** | **6.8s** | **3.8s** | 392 | 45 | **568.5** | **8 子域** |
| D SSE=2 + 限流(per-server=3) | 33.6s | 14.1s | 392 | 0 | 94.6 | 单域 |

**C 比 A 又快又清**：锐度 1.4 → 568.5（**407×**），zoom8 12.6s → 3.8s。

11.5% 429 触发但 Cesium 内置重试扛住；D 限流无效。

**代码改动**（`assets/cesium-viewer.js`）：

- `TDT_SUBDOMAINS = ["0"…"7"]` 常量
- `createTdtProvider(svc, tk)` 工厂，URL 用 `{s}` 占位 + `subdomains` 选项
- 三个底图（img_w / vec_w / ter_w）+ 四个覆盖层（ibo_w / cva_w / cia_w / cta_w）全用八子域
- 删 `setupGlobeTileBudget` 的 24→12 渐进逻辑，直接 `SSE=2`（Cesium 默认）
- `maximumLevel: 18` 与 Leaflet `maxNativeZoom: 18` 对齐（**用户参照标准**）

### 2. 瓦片不影响 JSON 图层渲染

**答：不会**。GeoJSON 走 `DataSource → Entity → Visualizer` 管线，与瓦片请求**相互独立**。
瓦片慢时 entity 仍先出现，视觉上"浮在黑背景"。实测 5 图层（含 5555 点）3D 构建 0.30s，
瓦片 24s 时 entity 早已显示。

### 3. 移除空闲预加载自动调度

按用户"PWA 已缓存"——`service-worker.js` 动态缓存同源资源，首次开 3D 后 Cesium.js
已落到 Cache Storage，第二次直接秒开。空闲预加载边际收益小，**移除自动调度**。

**保留**：`CesiumViewer.preloadNow()` 手动入口、`_loadSubs` 并发安全基础设施。
**删掉**：`schedulePreload` / `canPreload` / `mark3dUsed` / `preloadEligible` / `PRELOAD_FLAG` / `PRELOAD_IDLE_DELAY` / `_preloadScheduled`。

## 验证

| 项 | 结果 |
|---|---|
| 锐度（zoom8 视角截图，拉普拉斯方差） | **94.6**（原 1.4，提升 68×） |
| 视觉对比截图 | `verify-tile-fix.png` 长江流域清晰可见路网水系 |
| SSE 实际 | **2**（已生效） |
| 子域命中 | t0 / t1 / t2 / t3 / t4 / t5 / t6 / t7 全用上 |
| 429 限流 | **0**（实测，无 429 死循环） |
| 10s 内 Cesium.js 请求 | **0**（预加载已禁用） |
| preloadNow() 在已激活时 | 返回 false（正确） |
| 上一轮修复（大气白蒙层） | 仍关闭（`showGroundAtmosphere/fog/skyAtmosphere` 全 false） |
| 上一轮修复（自托管） | DupalOcean 78ms 加入 3D，ERRORS: none |
| 页面错误 | 0 个 |

## 改动文件

- `assets/cesium-viewer.js`（`TDT_SUBDOMAINS` + `createTdtProvider` + SSE 简化 + 移除自动预加载）
- `service-worker.js`（`CACHE_NAME` v2.3.2 → **v2.3.3**）
- `docs/CHANGELOG.md`（新增"瓦片清晰度：八子域 + SSE=2"记录）
- `.workbuddy/memory/MEMORY.md`（更新 3D 性能章节）
- `.workbuddy/memory/2026-08-29.md`（追加本轮工作日志）

## 探针坑记录（下次复用）

1. **`globe.tilesLoaded` 刚创建 viewer 就是 true**（队列空）→ 直接查是假阳性。
   稳定信号必须是「持续 true ≥ 1.5s 且 reqs ≥ N」
2. **`#view3dToggle` 是隐藏 checkbox**（自定义样式）→ `page.click` 点不到，
   必须 `page.evaluate(b.dispatchEvent(new Event("change")))`
3. **`page.route` 拦不到 SW Cache Storage 返回**（上一轮记录）
4. **WebGL canvas 须 `page.screenshot()`**（`drawImage` 未开 preserveDrawingBuffer 必全黑）
5. **轮询会被同步解析阻塞**，用页内 MutationObserver 记录 DOM 变更
