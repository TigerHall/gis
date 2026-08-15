# 经纬度格网功能 — 实现方案（v1）

> 状态：待确认实施　｜　日期：2026-08-15

## 一、需求

1. 在「地图设置」面板中新增一个开关：**经纬度格网**
2. 开启后地图上显示经纬度网格线（随缩放级别自动加密）
3. 网格在屏幕边缘显示对应的坐标刻度（经度/纬度标注）

## 二、插件调研结论

### 候选 1：leaflet/Leaflet.Graticule（官方 Leaflet 组织维护）⭐ 推荐

- GitHub: https://github.com/leaflet/Leaflet.Graticule
- 用法：`L.latlngGraticule({...}).addTo(map)`
- **Canvas 绘制**（自绘 canvas 覆盖地图全幅，move/zoom 重绘）→ 性能好，不产生海量 DOM 节点
- **showLabel: true** → 屏幕边缘绘制经纬度刻度标签，正好满足需求 3
- **zoomInterval 分级** → 不同缩放级别用不同间隔（支持经纬度分别配置）
- 可配项：`opacity / weight / color / font / fontColor / lngLineCurved / latLineCurved`
- 单文件 `Leaflet.Graticule.js`（约 10KB），无任何外部依赖
- 兼容 Leaflet 1.0+（本项目为 1.9.3，✓）

### 候选 2：turban/Leaflet.Graticule（不采用）

- 基于 `L.GeoJSON` 一次性生成全部格线 → 全球视野会产生海量 SVG path 节点，渲染/内存开销大
- **无坐标标签能力**，不满足需求 3

### 结论

采用 **leaflet/Leaflet.Graticule**。核心原因：Canvas 性能方案 + 自带边缘坐标标签，与项目"海洋站位图 + 大范围浏览"的用法契合。

## 三、集成方案（共 4 处改动）

项目设置开关为**数据驱动**架构（app.js 顶部注释：新增开关 → 在 TOGGLE_GROUPS 数组添加一项即可），改动面小且与现有开关完全一致。

### 改动 1：引入插件文件

下载 `Leaflet.Graticule.js` → 存放于 `assets/`（与其他插件同目录），在 `index.html` 的 `<head>` 中按现有顺序引入：

```html
<script src="assets/Leaflet.Graticule.js"></script>
```

### 改动 2：TOGGLE_GROUPS 添加开关项（app.js ~L18「显示」分组）

```js
{
  id: "graticuleToggle",
  label: "经纬度格网",
  desc: "开启后在地图上显示经纬度网格线，并在边缘标注坐标",
},
```

### 改动 3：toggleConfig 添加 enable / disable 回调（app.js ~L1005）

```js
graticuleToggle: {
  storageKey: TOGGLE_PREFIX + "graticule",
  enable: function () {
    if (!window._graticuleLayer) {
      window._graticuleLayer = L.latlngGraticule({
        showLabel: true,
        // 缩放分级：低 zoom 全球视野稀，高 zoom 局部加密
        zoomInterval: [
          { start: 1, end: 3, interval: 30 },
          { start: 4, end: 5, interval: 10 },
          { start: 6, end: 7, interval: 5 },
          { start: 8, end: 9, interval: 1 },
          { start: 10, end: 20, interval: 0.5 },
        ],
        color: "#8a8a8a",
        weight: 0.8,
        opacity: 0.55,
        font: "10px system-ui, sans-serif",
        fontColor: "#8a8a8a",
        latLineCurved: 4, // Web Mercator 下纬线略弯，4 段折线提升全球视野精度
      }).addTo(map);
    }
  },
  disable: function () {
    if (window._graticuleLayer) {
      map.removeLayer(window._graticuleLayer);
      window._graticuleLayer = null;
    }
  },
},
```

### 改动 4：localStorage 持久化

无需额外代码 —— `initToggle` 已统一处理（开关状态自动记忆，刷新恢复）。

## 四、关键设计决策

### 1. 缩放间隔分级（zoomInterval）

| 缩放级别 | 网格间隔 |
|---------|---------|
| 1–3（全球） | 30° |
| 4–5 | 10° |
| 6–7 | 5° |
| 8–9 | 1° |
| 10+（局部） | 0.5° |

实现后可按实际观感微调（项目常用视角：区域到站位级）。

### 2. 深色模式适配

- 方案：网格/标签颜色用中性灰 `#8a8a8a` + 半透明，浅色底图下可见、深色主题下也足够清晰
- 若实测深色主题下不明显 → 在 `darkModeToggle` 的 enable/disable 中重建一次格网图层换色（代价低）

### 3. 导出图片兼容（需实测验证）

- `exportMapImage` 基于 html-to-image 的 **DOM 截图**；格网为自绘 `<canvas>` 元素，html-to-image 支持 canvas → dataURL 转换，且自绘内容无跨域污染，理论兼容 ✓
- 验证点：若插件用 CSS transform 定位 canvas，需确认与导出时"transform 摊平"逻辑的配合（必要时在导出 filter 或摊平环节补充处理）

### 4. 投影精度

- Web Mercator（EPSG:3857）下经线为直线、纬线为轻微曲线
- 插件默认按直线绘制；`latLineCurved: 4` 用 4 段折线近似，全球视野下更贴合底图，高 zoom 无感知差异

### 5. 控件避让

- 标签绘制在屏幕四边缘，可能与左下角图例/比例尺、右上角鼠标坐标控件重叠
- 默认可接受；若干扰明显，可微调 `font` 尺寸或缩小边缘 padding

## 五、实施步骤（确认后执行）

1. 下载 `Leaflet.Graticule.js` 到 `assets/`，确认无改动需求（项目为 Leaflet 1.9.3）
2. `index.html` 引入脚本
3. `app.js` TOGGLE_GROUPS + toggleConfig 两处添加（见上）
4. 本地验证清单：
   - [ ] 开关开启/关闭即时生效，刷新后状态保持
   - [ ] 缩放时网格间隔按分级变化，边缘坐标标签正确
   - [ ] 拖动地图/切换底图/加载图层时网格不抖动、不遮挡交互
   - [ ] 导出图片包含格网
   - [ ] 深色模式下格网清晰可见
   - [ ] 与图例、比例尺、鼠标坐标控件共存不冲突
5. 更新 `docs/CHANGELOG.md` 与工作记忆

## 六、备选（若插件与导出/深色模式冲突）

退路方案：参照 leaflet/Leaflet.Graticule 的 Canvas 思路自写一个轻量 `L.Layer`（约 80 行），
同样走 `toggleConfig` 增删，样式/导出行为完全可控。仅当官方插件实测遇阻塞时启用。
