# GeoJSON 格式详解：从坐标到要素

GeoJSON 是 Web 地理数据的“普通话”。不管你后端是 PostGIS、还是某份 Excel 导出的 CSV，最终要在地图上画出来，多半得先变成 GeoJSON。

## 坐标：经度在前，纬度在后

这是 GeoJSON 规范（RFC 7946）明确规定的，和 Leaflet 的 `[lat, lng]` 正好相反：

```json
{
  "type": "Point",
  "coordinates": [104.07, 30.66]
}
```

> 记住：**GeoJSON 的坐标永远是 [经度, 纬度, 海拔?]**。如果你发现点全跑到了非洲附近，八成是经纬度写反了。

## 七种几何类型

| 类型 | 含义 |
| --- | --- |
| Point | 一个点 |
| MultiPoint | 多个点 |
| LineString | 一条线 |
| MultiLineString | 多条线 |
| Polygon | 一个面（首尾坐标须闭合） |
| MultiPolygon | 多个面 |
| GeometryCollection | 几何集合 |

## Feature：给几何挂上属性

光有坐标还不够，我们通常还要“名字”“类型”“备注”这类属性。这就用 `Feature`：

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [104.07, 30.66]
  },
  "properties": {
    "name": "成都",
    "population": 21000000
  }
}
```

## FeatureCollection：一堆要素打包

实际传输时，往往是一组要素，用 `FeatureCollection` 包起来：

```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "geometry": { ... }, "properties": { ... } },
    { "type": "Feature", "geometry": { ... }, "properties": { ... } }
  ]
}
```

## 一个常见陷阱：面的闭合

Polygon 的线性环（ring）**第一个坐标必须等于最后一个坐标**，否则很多渲染器会“自作主张”帮你补，偶尔补错：

```json
{
  "type": "Polygon",
  "coordinates": [[
    [0, 0], [0, 1], [1, 1], [1, 0], [0, 0]
  ]]
}
```

## 在 Leaflet 里渲染

拿到 GeoJSON 后，一行就能画：

```js
fetch('data.geojson')
  .then(r => r.json())
  .then(data => L.geoJSON(data, {
    onEachFeature: (f, layer) => layer.bindPopup(f.properties.name)
  }).addTo(map));
```

---

*相关阅读：[WMS 与 XYZ 瓦片：两种底图服务的取舍](post.html?id=wms-vs-xyz)*
