// 检查浏览器是否支持Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => {
        // 可选：也可以删掉这个Service Worker注册成功的日志
        // console.log('Service Worker注册成功：', registration.scope);
      })
      .catch((error) => {
        console.error("Service Worker注册失败：", error);
      });
  });
}
