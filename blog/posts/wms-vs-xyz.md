# WMS 与 XYZ 瓦片：两种底图服务的取舍

做 Web GIS，底图是绕不开的。市面上两类主流底图服务——**WMS** 和 **XYZ 瓦片**——名字都带“地图服务”，但底层思路完全不同。选错了，轻则加载慢，重则架构返工。

## XYZ：预先切好的瓦片

XYZ 是最常见的“瓦片地图”。它把世界按缩放级别切成一张张 256×256 的小图，按 `{z}/{x}/{y}` 编号：

```
https://tile.example.com/{z}/{x}/{y}.png
```

- **优点**：浏览器可以并行请求、按需加载、缓存命中率高，缩放顺滑；
- **缺点**：数据是“死图”，不能按属性动态改样式；
- **代表**：OpenStreetMap、Google、天地图、高德。

```js
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap'
}).addTo(map);
```

## WMS：按需出图

WMS（Web Map Service）不问瓦片，而是你告诉它“我要哪块范围、多大尺寸、什么坐标系”，服务器**现画一张图**返回：

```
https://wms.example.com?
  SERVICE=WMS&
  REQUEST=GetMap&
  LAYERS=bathymetry&
  BBOX=-180,-90,180,90&
  WIDTH=1024&HEIGHT=512&
  FORMAT=image/png&
  VERSION=1.3.0
```

- **优点**：样式在服务端控制，能叠加专业图层（如海底地形、地质图），可动态过滤；
- **缺点**：每次出图都要算，慢；不适合海量底图；
- **代表**：GEBCO 海底地形、各地质调查局、Macrostrat。

```js
L.tileLayer.wms('https://wms.gebco.net/mapserv?', {
  layers: 'GEBCO_LATEST',
  format: 'image/png',
  transparent: true,
  version: '1.3.0'
}).addTo(map);
```

## 怎么选？

| 场景 | 推荐 |
| --- | --- |
| 日常底图、要流畅缩放 | XYZ 瓦片 |
| 专业科研图层、要动态样式 | WMS |
| 离线/内网部署 | 预切 XYZ 瓦片 |
| 超大数据量可视化 | XYZ + 前端 Canvas |

## 一个关键的技术坑

Leaflet 默认投影是 **EPSG:3857**（Web 墨卡托）。WMS 图层**必须支持这个坐标系**才能正确渲染——如果一个 WMS 只提供 EPSG:4326（经纬度直投），直接加进来会被“裁掉”或错位。碰到这种情况，要么换端点，要么改投影。

> 实测过：GEBCO 的 `wms.gebco.net/mapserv?` 主端点支持 3857，能直接挂；但极区网格只给 4326，就得另想办法。

---

*延伸：[跨越 180° 经线：反子午线问题的来龙去脉](post.html?id=anti-meridian)*
