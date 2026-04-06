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

// 加载GeoJSON的逻辑
async function loadGeoJSON() {
  const geojsonFiles = [
    "./assets/geojson/乐清.geojson",
    "./assets/geojson/平阳.geojson",
    "./assets/geojson/洞头.geojson",
    "./assets/geojson/瑞安.geojson",
    "./assets/geojson/瓯江口.geojson",
    "./assets/geojson/经开区.geojson",
    "./assets/geojson/苍南.geojson",
    "./assets/geojson/项目.geojson",
    "./assets/geojson/龙港.geojson",
    "./assets/geojson/龙湾.geojson",
    "./assets/geojson/岸线变化.geojson",
  ];

  try {
    for (const file of geojsonFiles) {
      const response = await fetch(file);
      if (!response.ok) {
        throw new Error(`加载失败：${file}，状态码：${response.status}`);
      }
      const geojson = await response.json();
      // 删掉这行加载成功的日志
      // console.log(`成功加载GeoJSON：${file}`, geojson);
      renderGeoJSON(geojson, file);
    }
    // 可选：如果想知道所有文件加载完成，只打印一行极简日志
    // console.log('所有GeoJSON文件加载完成');
  } catch (error) {
    // 保留报错日志，方便排查问题
    console.error("GeoJSON加载失败：", error);
  }
}

// 渲染GeoJSON的函数
function renderGeoJSON(geojson, fileName) {
  // 删掉这行渲染开始的日志
  // console.log(`开始渲染${fileName}的数据`);
  // 你的地图渲染逻辑（比如Leaflet/Mapbox代码）
  // L.geoJSON(geojson).addTo(map);
}

// 页面加载后立即加载GeoJSON
document.addEventListener("DOMContentLoaded", loadGeoJSON);
