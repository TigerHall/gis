// 缓存名称（更新时修改，触发缓存重建）
const CACHE_NAME = "v1.0.22";
// 需要缓存的资源（替换为你的GeoJSON路径）
const CACHE_ASSETS = [
  "./",
  `./index.html`,
  `./app.js`,
  `./manifest.json`,
  `./assets/main.css`,
  `./assets/login.js`,
  `./assets/geojsonloader.js`,
  `./assets/leaflet.js`,
  `./assets/leaflet.css`,
  `./assets/Leaflet.MousePosition.css`,
  `./assets/Leaflet.MousePosition.js`,
  `./assets/georaster-layer-for-leaflet.min.js`,
  `./assets/images/icon.svg`,
  `./assets/geojson/`,
];

// 安装阶段：缓存资源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("缓存资源：", CACHE_ASSETS);
        return cache.addAll(CACHE_ASSETS);
      })
      .then(() => self.skipWaiting()), // 立即激活新SW
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
            // 删除旧缓存
            if (name !== CACHE_NAME) {
              console.log("删除旧缓存：", name);
              return caches.delete(name);
            }
          }),
        );
      })
      .then(() => self.clients.claim()), // 接管所有客户端
  );
});

// 请求阶段：优先从缓存读取，失败则请求网络
self.addEventListener("fetch", (event) => {
  // 仅处理GET请求
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 缓存命中：直接返回；未命中：请求网络
      return (
        cachedResponse ||
        fetch(event.request)
          .then((networkResponse) => {
            // 可选：将新请求的资源存入缓存（动态缓存）
            if (event.request.url.includes(".geojson")) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse.clone());
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // 网络失败：返回兜底内容（可选）
            return new Response("无法加载资源，请检查网络", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            });
          })
      );
    }),
  );
});
