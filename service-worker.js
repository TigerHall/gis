// 缓存名称（更新时修改，触发缓存重建）
const CACHE_NAME = "v1.3.0";

// 只需要预缓存核心静态资源（小文件，快速）
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./assets/main.css",
  "./assets/leaflet.js",
  "./assets/leaflet.css",
  "./assets/geojsonloader.js",
  "./assets/geojsonloader.css",
  "./assets/Leaflet.MousePosition.css",
  "./assets/Leaflet.MousePosition.js",
  "./assets/leaflet-geoman.css",
  "./assets/leaflet-geoman.js",
  "./assets/Leaflet.VectorGrid.bundled.min.js",
  "./assets/images/icon.svg",
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

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 命中缓存
      if (cachedResponse) {
        return cachedResponse;
      }

      // 未命中，请求网络
      return fetch(event.request)
        .then((networkResponse) => {
          // 所有同源请求都动态缓存
          if (networkResponse.ok) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
              console.log("动态缓存：", url.split("/").pop());
            });
          }

          return networkResponse;
        })
        .catch(() => {
          // 离线兜底：如果是页面请求，返回首页缓存
          if (url.endsWith(".html") || url.endsWith("/")) {
            return caches.match("./index.html");
          }
          return new Response("离线状态，无法加载: " + url, {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          });
        });
    }),
  );
});
