// 缓存名称（更新时修改，触发缓存重建）
const CACHE_NAME = "v2.3.5";

// 全量预缓存：安装 PWA 后全部功能离线可用（后台静默执行，不阻塞页面）
// 注意：assets/cesium/Cesium.js（4.9MB）故意不在此列 —— 它只在用户真正打开 3D 时
// 才需要，放进预缓存会让所有用户白下 5MB。它走「首次按需加载 → 动态缓存」，
// 之后离线也能秒开 3D。
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./browserconfig.xml",
  "./manifest.json",
  // 样式
  "./assets/main.css",
  "./assets/leaflet.css",
  "./assets/leaflet.markercluster.css",
  "./assets/leaflet.markercluster.default.css",
  "./assets/geojsonloader.css",
  "./assets/Leaflet.MousePosition.css",
  "./assets/leaflet-geoman.css",
  "./assets/dialog.css",
  "./assets/feature-panel.css",
  "./assets/Leaflet.LegendControl.css",
  "./assets/pointdrop.css",
  "./assets/elevation-query.css",
  "./assets/cesium-container.css",
  // 脚本
  "./assets/leaflet.js",
  "./assets/geo-utils.js",
  "./assets/Leaflet.GeoMarker.js",
  "./assets/Leaflet.GzIdbLoader.js",
  "./assets/leaflet.markercluster.js",
  "./assets/rbush.js",
  "./assets/Leaflet.MarkersCanvas.js",
  "./assets/Leaflet.MousePosition.js",
  "./assets/leaflet-geoman.js",
  "./assets/Leaflet.VectorGrid.bundled.min.js",
  "./assets/shp.min.js",
  "./assets/togeojson.min.js",
  "./assets/jszip.min.js",
  "./assets/pointdrop.js",
  "./assets/geojsonloader.js",
  "./assets/geo-config.js",
  "./assets/file-handler.js",
  "./assets/Leaflet.DemRenderer.js",
  "./assets/georaster.min.js",
  "./assets/geoblaze.min.js",
  "./assets/georaster-layer-for-leaflet.min.js",
  "./assets/app.js",
  "./assets/html-to-image.min.js",
  "./assets/dialog.js",
  "./assets/feature-panel.js",
  "./assets/Leaflet.LegendControl.js",
  "./assets/cesium-terrain.js",
  "./assets/cesium-geojson-adapter.js",
  "./assets/cesium-viewer.js",
  "./assets/marked.min.js",
  "./assets/esri-leaflet.js",
  "./assets/echarts.min.js",
  // 文档
  "./docs/CHANGELOG.md",
  "./docs/REFERENCES.md",
  "./README.md",
  // 图标
  "./assets/images/icon.svg",
  // 底图
  "./assets/xyz/etopo.jpg",
  "./assets/xyz/etopo2022high.jpg",
  // 截图
  "./assets/images/screenshot-desktop.jpg",
  "./assets/images/screenshot-mobile.jpg",
  // 其他页面
  "./test.html",
  "./about.html",
];
// 安装阶段：立即激活，后台静默缓存（不阻塞页面加载）
self.addEventListener("install", () => {
  self.skipWaiting();
  // 后台静默预缓存，不 waitUntil——SW 立即可用，页面不白屏
  caches.open(CACHE_NAME).then((cache) => {
    console.log("后台预缓存：", STATIC_ASSETS.length, "个文件");
    // 逐个缓存，一个失败不影响其他
    STATIC_ASSETS.forEach((url) => {
      cache.add(url).catch(() => {});
    });
  });
});

// 消息处理：接收页面发来的 skipWaiting 指令 / 版本查询
self.addEventListener("message", (event) => {
  if (event.data && event.data.action === "skipWaiting") {
    self.skipWaiting();
  } else if (event.data && event.data.type === "GET_VERSION") {
    // 页面主动询问当前控制它的 SW 版本 → 回传 CACHE_NAME
    var reply = { type: "SW_VERSION", version: CACHE_NAME };
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage(reply);
    } else if (event.source) {
      event.source.postMessage(reply);
    }
  }
});

// 激活阶段：清理旧缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              console.log("删除旧缓存：", name);
              return caches.delete(name);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

// 请求阶段：智能缓存策略
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;

  // 跳过跨域请求
  if (!url.startsWith(self.location.origin)) return;

  // 只在当前版本缓存里匹配，避免从旧版本缓存命中到过期的 JS/CSS（如 geojsonloader.js）
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cachedResponse) => {
        // 命中当前版本缓存
        if (cachedResponse) {
          return cachedResponse;
        }

        // 未命中，请求网络
        return fetch(event.request)
          .then((networkResponse) => {
            // 动态缓存：只缓存静态资源，跳过 .gz 数据文件（由 GzIdbLoader 管理）
            const isGzFile = /\.gz$/.test(url);
            if (networkResponse.ok && !isGzFile) {
              const responseToCache = networkResponse.clone();
              cache.put(event.request, responseToCache);
              console.log("动态缓存：", url.split("/").pop());
            }

            return networkResponse;
          })
          .catch(() => {
            // 离线兜底：如果是页面请求，返回首页缓存
            if (url.endsWith(".html") || url.endsWith("/")) {
              return cache.match("./index.html");
            }
            return new Response("离线状态，无法加载: " + url, {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            });
          });
      }),
    ),
  );
});
