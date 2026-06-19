# 静态矢量要素使用说明

本面板加载的是预置的矢量数据图层（GeoJSON 格式），所有数据已存储在服务器端，无需用户上传即可使用。

## 基本使用

- **勾选/取消**：点击图层名称前的复选框可切换图层显示
- **全选/全不选**：点击图层组标题行右侧的复选框可批量操作
- **折叠/展开**：点击图层组标题可折叠或展开该组
- **缩放至范围**：在左侧图层面板底部可通过勾选后的绿色圆点下载该图层源文件

## 图层切换

勾选后，地图会自动缩放到该图层的范围。取消勾选后，图层从地图中移除，再次勾选会恢复显示并使用之前设定的样式模式。

## 支持的样式模式

- **单色**：所有要素同一颜色
- **逐项**：每个要素按顺序分配不同颜色
- **字段**：根据要素属性中的数值字段渲染渐变颜色

---

## 支持的数据来源

### 全球板块构造

| 图层                         | 文件                          | 数据来源              |
| ---------------------------- | ----------------------------- | --------------------- |
| 全球16大板块 plate16         | `plate16.geojson`             | —                     |
| 全球280个板块 (Hasterok2022) | `plates_Hasterok2022.geojson` | Hasterok et al., 2022 |
| 大陆板块 plate_cont          | `plate_cont.json`             | —                     |
| 大洋板块 plate_ocean         | `plate_ocean.json`            | —                     |
| 洋中脊和转换断层 MOR&TF      | `ridgenew.json`               | —                     |
| 海沟 Trench                  | `Pb_trench.json`              | —                     |
| 其他板块边界 Other boundries | `Pb_transformall.json`        | —                     |
| 大西洋断裂带 Atlantic_FZ     | `Atlantic_FZ.json`            | —                     |
| 印度洋断裂带 Indian_FZ       | `Indian_FZ.json`              | —                     |
| 太平洋断裂带 Pacific_FZ      | `Pacific_FZ.json`             | —                     |

### 洋中脊作用域

| 图层                            | 文件                            | 数据来源 |
| ------------------------------- | ------------------------------- | -------- |
| 1全球洋壳 GlobalOceanicCrust    | `1GlobalOceanicCrust.json`      | —        |
| 2大洋域 OceanDomian             | `2OceanDomian.json`             | —        |
| 3次大洋域 SubOceanDomain        | `3SubOceanDomain.json`          | —        |
| 4洋中脊作用域 RidgeDomain       | `4RidgeDomain.json`             | —        |
| 全球陆壳 GlobalContinentalCrust | `global_continental_crust.json` | —        |
| 0作用域边界 RDboundary          | `RD_plgn1_5.json`               | —        |

### 海底基础信息

| 图层                   | 文件                                | 数据来源         |
| ---------------------- | ----------------------------------- | ---------------- |
| 火山 volcanos          | `volcanos.json`                     | —                |
| 热点 hotspots          | `hotspots.json`                     | —                |
| 大火成岩省 (Johansson) | `LIP_Johansson.json`                | Johansson et al. |
| 洋壳年龄30Ma间隔       | `seafloor_age_30.geojson`           | —                |
| 盆地 (Evenick2021)     | `global_basins_Evenick2021.geojson` | Evenick, 2021    |
| 盆地 (CGG)             | `Sedimentary_CGG.geojson`           | CGG              |

### 大型异常区

| 图层                   | 文件              | 数据来源 |
| ---------------------- | ----------------- | -------- |
| LLSVP                  | `LLSVP.json`      | —        |
| Dupal异常洋 DupalOcean | `DupalOcean.json` | —        |

### 海底矿产资源

| 图层                            | 文件                         | 数据来源 |
| ------------------------------- | ---------------------------- | -------- |
| 热液喷口 HydrothermalVents(ISA) | `hydrothermal_vents.geojson` | ISA      |
| 多金属结核 Fe-MnNodule(NOAA)    | `Fe_MnNodule.geojson`        | NOAA     |
| 富钴结壳 Co-richCrust(NOAA)     | `Co-richCrust.geojson`       | NOAA     |

### 地质站位

| 图层              | 文件                   | 数据来源                     |
| ----------------- | ---------------------- | ---------------------------- |
| DSDP              | `DSDP.geojson`         | DSDP                         |
| ODP               | `ODP.geojson`          | ODP                          |
| IODP03-13         | `IODP03-13.geojson`    | IODP                         |
| IODP13-26         | `IODP13-26.geojson`    | IODP                         |
| NWIR_rock         | `NWIR_ridge.geojson`   | —                            |
| SWIR_rock         | `SWIR_ridge.geojson`   | —                            |
| SEIR_rock         | `SEIR_ridge.geojson`   | —                            |
| SEIR_offaxis_rock | `SEIR_offaxis.geojson` | —                            |
| RedSea_rock       | `RedSea_rift.geojson`  | —                            |
| 古生物学 PBDB     | `PBDB.geojson`         | PBDB (Paleobiology Database) |
| 气候岩性指标 PBDB | `Boucot.geojson`       | PBDB (Paleobiology Database) |

### 测试数据

| 图层       | 文件          | 数据来源 |
| ---------- | ------------- | -------- |
| PIC 45万点 | `pic.geojson` | —        |
