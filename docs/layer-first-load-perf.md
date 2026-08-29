# 要素首次渲染慢 — 根因诊断报告

> 测试方法：Playwright + Chrome（SwiftShader），本地静态服务器 + CDP 限速 10 Mbps / 40 ms RTT，
> 通过埋点 `GzIdbLoader.fetch` / `shiftGeoJSON` / `L.geoJSON` / `markersCanvas` / `Layer.addTo` 拆解各阶段，
> 并用 `PerformanceObserver(longtask)` 捕获主线程阻塞。

---

## 一、结论速览

**慢的不是「渲染」，是「取数 + 解压 + JSON 解析」。第二次快是因为 IndexedDB 缓存了解析后的对象图，跳过了整段开销。**

以 `pic.geojson.gz` 为例（10 Mbps 限速，实测）：

| 阶段 | 耗时 | 堆内存 | 占比 |
|---|---|---|---|
| 1. fetch 响应头 | 195 ms | 60 MB | 0.8% |
| 2. 流式管道搭建 | 0 ms | 60 MB | 0% |
| **3. 解压 + JSON.parse** | **20,615 ms** ⚠️ | 555 MB | **89.2%** |
| 4. IndexedDB 写入 | 1,368 ms | **842 MB** | 5.9% |
| **5. IndexedDB 读取（= 第二次）** | **933 ms** ✅ | 555 MB | 4.0% |
| 合计 | 23,111 ms | | 100% |

**第二次（IDB 命中）933 ms，比首次快 22 倍。**

---

## 二、为什么第一次这么慢

### 2.1 数据体积是根源

`assets/geojson/` 共 70 个图层、**102 MB（gz）**，其中 4 个是巨无霸：

| 图层 | gz | 解压后 JSON | 10 Mbps 下载 | 预估首次加载 |
|---|---|---|---|---|
| ⚠️ PBDB | 26.0 MB | **279.3 MB** | 20.8 s | **41.7 s** |
| ⚠️ pic | 24.4 MB | **291.9 MB** | 19.5 s | **41.3 s** |
| ⚠️ states_provinces | 20.2 MB | 60.8 MB | 16.1 s | **21.8 s** |
| ⚠️ Sedimentary_CGG | 9.7 MB | 33.5 MB | 7.8 s | **11.5 s** |
| Boucot | 1.0 MB | 9.1 MB | 0.8 s | 2.8 s |
| countries-all-195 | 1.1 MB | 8.8 MB | 0.9 s | 2.9 s |
| EQ4_5_2024_2026 | 1.3 MB | 8.8 MB | 1.0 s | 3.1 s |
| …其余 63 个 | < 1.6 MB | < 9 MB | < 1.2 s | **< 3.3 s** |

**70 个图层里只有 4 个超过 5 秒，其余 66 个都在 1–3 秒内。**

### 2.2 链路逐段拆解

```
用户勾选
  ├─ GzIdbLoader.fetch(url)
  │    ├─ getCache(url)          → IDB 查询          【第二次命中，直接返回】
  │    └─ fetchGz(gzUrl)
  │         ├─ fetch()                              网络下载（限速下 20 s）
  │         ├─ DecompressionStream("gzip")          流式解压（后台线程）
  │         └─ new Response(stream).json()  ← ⚠️    等全部解压完 + JSON.parse 279 MB
  │              → 堆峰值 555 MB
  ├─ setCache(url, data)          → IDB 结构化克隆   1.4 s，堆峰值 842 MB
  ├─ buildGeoJsonLayerGroup()     → shiftGeoJSON×3 + L.geoJSON
  └─ buildSearchIndex()           → 异步分批，不阻塞
```

**关键瓶颈在 `new Response(stream).json()`**（`Leaflet.GzIdbLoader.js:288`）：

- `Response.json()` 必须等流读完后，才能对**完整字符串**做 `JSON.parse`
- 279 MB UTF-8 文本 → JS 字符串（UTF-16）→ 内存翻倍
- `JSON.parse` 生成几十万~几百万个 JS 对象
- 这一段在**主线程**，且是一次性的集中开销

### 2.3 第二次为什么快

`fetchWithCache()` 先查 IDB，命中就直接返回**已经解析好的 JS 对象图**，跳过：

- ❌ 网络下载（20 s）
- ❌ gzip 解压
- ❌ `JSON.parse`（279 MB 文本 → 对象）

只剩 IDB 反序列化（933 ms）。所以「第二次快」是**缓存生效**的正常表现，不是渲染变快。

---

## 三、一个反直觉的发现：UI 其实没卡死

20.6 秒的等待期间，`longtask` 统计：

```
长任务(>50ms) 5 个，累计阻塞 2501 ms
  @9641ms   阻塞   78 ms
  @18670ms  阻塞   67 ms
  @29509ms  阻塞  861 ms   ← JSON.parse 尾巴
  @30371ms  阻塞 1367 ms   ← IDB 结构化克隆
```

**20 秒里主线程只阻塞了 2.5 秒**，其余时间浏览器是空闲的。

也就是说：用户感知的「卡」，主要是**这 20 秒没有任何进度反馈** ——
勾选后只有一个静态小圆点（`title="加载中..."`），不知道是在下载、解压还是解析，不知道还要等多久。

---

## 四、小图层的实测数据（本地无限速）

| 图层 | 要素数 | 冷缓存 | IDB 命中 | 内存缓存(关→开) |
|---|---|---|---|---|
| plate16 (0.2 MB) | 16 面 | 47 ms | 28 ms | **7 ms** |
| volcanos | 1,293 点 | 148 ms | 112 ms | **9 ms** |
| ODP | 1,777 点 | 183 ms | 182 ms | **7 ms** |

小图层的开销分布：`addTo(map)` 占 60-70%（DOM 图层建 3 个世界副本，1293 点 → 3879 个 marker），
`L.geoJSON` 构造占 20-25%，数据获取 < 1%。**都不慢。**

---

## 五、优化方案对比

| 方案 | 做法 | 工作量 | 风险 | 收益 |
|---|---|---|---|---|
| **A. 加载进度提示** | `fetchGz` 用 `ReadableStream` 读 `Content-Length` 上报下载/解压百分比；图层项显示「下载中 12.4/24.4 MB」→「解析中…」→「建索引…」 | 中 | 低 | 消除「不知道在干嘛」的焦虑，**感知耗时大幅下降** |
| **B. Web Worker 转移** | 新建 worker 承载 fetch + 解压 + `JSON.parse`，主线程只收结果 | 中 | 中 | 主线程零阻塞；但 279 MB 对象图回传仍需 ~1-2 s structuredClone |
| **C. 数据瘦身（治本）** | 把 4 个巨无霸按 zoom 分级 / 地理分块，或生成简化版 | 大 | 低 | 首次加载 40 s → 1-2 s，**根本性解决**；需预处理 102 MB 数据 |
| **D. 大图层二次确认** | 勾选 > 5 MB 图层时弹确认，告知预计耗时 | 小 | 极低 | 管理预期，避免误点 |

### 建议路径

1. **先做 A + D**（低成本，立刻改善体验）
2. **再做 C**（治本，把 PBDB / pic / states_provinces / Sedimentary_CGG 切片）
3. B 可作为 C 的补充 —— 数据切小后 Worker 的收益就没那么大了

---

## 六、附：内存风险

单个大图层加载时堆峰值 **842 MB**，如果同时勾选 PBDB + pic（合计 571 MB JSON），
很可能触发 OOM 或让移动端直接崩溃。这比「慢」更值得警惕。
