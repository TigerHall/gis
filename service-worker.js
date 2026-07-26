// 缓存名称（更新时修改，触发缓存重建）
const CACHE_NAME = "v1.9.17";

// 只需要预缓存核心静态资源（小文件，快速）
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
  // 脚本（按依赖顺序）
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
  // Dialog 弹窗
  "./assets/dialog.js",
  "./assets/dialog.css",
  "./assets/pointdrop.css",
  "./assets/marked.min.js",
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
  // 其他网站
  "./test.html",
  "./about.html",
];
// 安装阶段：只缓存小文件（快速）
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("预缓存核心资源：", STATIC_ASSETS.length, "个文件");
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting()),
  );
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
