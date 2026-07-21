// 文章元数据索引。新增文章时，在此数组追加一项并在 posts/ 目录放入同名 .md 文件即可。
// file 字段为相对于 blog/ 根目录的路径。
window.POSTS = [
  {
    id: 'leaflet-first-map',
    title: '用 Leaflet 搭建你的第一个交互式地图',
    date: '2026-07-18',
    tags: ['Leaflet', '入门', '教程'],
    excerpt: '从零开始，用不到 30 行代码让一张可缩放、可拖动的交互式地图在浏览器里跑起来。',
    file: 'posts/leaflet-first-map.md'
  },
  {
    id: 'geojson-guide',
    title: 'GeoJSON 格式详解：从坐标到要素',
    date: '2026-07-15',
    tags: ['GeoJSON', '数据格式'],
    excerpt: '经纬度到底谁在前？Feature 与 FeatureCollection 有什么区别？一篇讲清地理数据的通用交换格式。',
    file: 'posts/geojson-guide.md'
  },
  {
    id: 'wms-vs-xyz',
    title: 'WMS 与 XYZ 瓦片：两种底图服务的取舍',
    date: '2026-07-11',
    tags: ['WMS', '瓦片地图', '底图'],
    excerpt: '同样是“看地图”，WMS 按需出图与 XYZ 预切瓦片走的是两条完全不同的路，选错会直接影响性能。',
    file: 'posts/wms-vs-xyz.md'
  },
  {
    id: 'anti-meridian',
    title: '跨越 180° 经线：反子午线问题的来龙去脉',
    date: '2026-07-06',
    tags: ['反子午线', '投影', '坑'],
    excerpt: '为什么一条本应连续的国界线，在地图上会被“扯”成左右两半？聊聊 Web 地图里最隐蔽的显示陷阱。',
    file: 'posts/anti-meridian.md'
  },
  {
    id: 'learning-roadmap',
    title: '一个 GIS 自学者的五年路线图',
    date: '2026-06-28',
    tags: ['学习路线', '随笔'],
    excerpt: '从看不懂投影参数，到能独立搭一套带搜索、聚类、多底图的 Web GIS，这五年我踩过的路与读过的书。',
    file: 'posts/learning-roadmap.md'
  }
];
