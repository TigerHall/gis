# 用 Leaflet 搭建你的第一个交互式地图

如果你只想在网页里“放一张能拖能缩放的地图”，**Leaflet** 几乎是零门槛的选择。它体积小（压缩后约 40KB）、API 直观，而且生态里的插件多到离谱。

这篇我们用不到 30 行代码，让一张地图真正跑起来。

## 最小可用骨架

一个 Leaflet 地图只需要三样东西：**一个容器 div、引入库、初始化**。

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
<div id="map" style="height: 420px;"></div>
<script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
<script>
  // 1. 创建地图，并定位到初始视角
  const map = L.map('map').setView([30.66, 104.07], 4);

  // 2. 叠加一个瓦片底图（这里用 OpenStreetMap）
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
</script>
```

就这么简单——刷新页面，你就拥有了一张可以滚轮缩放、鼠标拖拽的地图。

## 加上一个标记点

地图光秃秃的不行，我们放一个标记：

```js
L.marker([30.66, 104.07])
  .addTo(map)
  .bindPopup('<b>成都</b><br>北纬 30.66°，东经 104.07°')
  .openPopup();
```

> 经纬度顺序是 **[纬度, 经度]**（latitude, longitude），和 GeoJSON 一致，但和很多其他库相反。这是新手最容易踩的坑。

## 换个底图试试

Leaflet 不绑定任何底图。想用地形、卫星、或者天地图的中文底图，只要换掉 `tileLayer` 的 URL 即可：

```js
// 例如 Esri 的世界地形底图
L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 13 }
).addTo(map);
```

## 接下来可以玩什么

- **GeoJSON 图层**：`L.geoJSON(data).addTo(map)` 直接渲染矢量数据；
- **聚类**：引入 `leaflet.markercluster` 插件，几千个点也不卡；
- **弹窗与交互**：点击要素高亮、定位、搜索……

后面几篇会逐个展开。先把这张地图跑起来，比什么都重要。

---

*下一篇：[GeoJSON 格式详解：从坐标到要素](post.html?id=geojson-guide)*
