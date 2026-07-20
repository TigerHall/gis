/**
 * geo-config.js
 * GeoJSON 图层的路径和分组配置
 * 独立拆分以减负 geojsonloader.js，便于维护图层列表
 * 加载时机：必须在 geojsonloader.js 之前
 *
 * ==========================================================
 * 📌 如何添加一个新图层
 * ==========================================================
 *
 * 1. 将 GeoJSON 文件放入 assets/geojson/ 目录
 * 2. 在下方 window.geoJsonGroups 数组中添加一项：
 *
 *    示例 —— 简单添加：
 *      { name: "图层显示名称", file: "文件名.geojson" }
 *
 *    完整选项：
 *      { name: "图层名", file: "file.geojson",
 *        labelField: "字段名",   // ← 可选：指定标签和弹窗标题使用的字段
 *        colorMode: "field",     // ← 可选：默认颜色模式（"sequential"/"field"/"single"）
 *        colorField: "字段名",   // ← 可选：colorMode="field" 时使用的分色字段
 *      }
 *
 *    示例 —— 按 Contractor 字段分色：
 *      { name: "PMN 勘探合同区", file: "areas.geojson",
 *        labelField: "Contractor",
 *        colorMode: "field",
 *        colorField: "Contractor",
 *      }
 *
 * 3. 如需添加新分组，在 geoJsonGroups 数组中新增一个对象：
 *
 *    {
 *      groupName: "分组名称",        // ← 图层面板中显示的组名
 *      layers: [
 *        { name: "图层1", file: "a.geojson" },
 *        { name: "图层2", file: "b.geojson", labelField: "name_zh" },
 *      ],
 *    }
 *
 * 4. 文件命名规则：
 *    - 自动补全 .gz 后缀（系统按需加载 .geojson.gz 或 .json.gz）
 *    - 文件路径以 window.geoJsonBasePath 为前缀（默认 ./assets/geojson/）
 *
 * 5. 默认使用 COS CDN 加速加载，无需额外配置。
 *
 * ==========================================================
 * 📌 图层配置选项
 * ==========================================================
 *
 * 字段            | 必需 | 说明
 * ----------------|------|----------
 * name            |  是  | 图层面板中显示的名称
 * file            |  是  | GeoJSON 文件名（自动补全路径和 gz 后缀）
 * labelField      |  否  | 标签/弹窗标题使用的属性字段名
 *                    （不设置则依次查找 Name → name → NAME → 第一个字段值）
 * color           |  否  | 十六进制默认颜色（如 "#E63946"）
 *                    不设置则由 getFixedColor 自动分配索引颜色
 * icon            |  否  | 点要素图标类型或外部文件路径
 *                    内置： "volcano" / "hotspot" / "star" / "point"
 *                    外部： "./assets/images/xxx.svg"（支持 SVG/PNG/ICO）
 *                    不设置或无法识别则使用默认圆形点兜底
 *
 * source          |  否  | 数据来源/版权说明，显示在要素弹窗的「数据源」字段
 *                    例如： source: "浙江省交通运输厅 2026年5月公告"
 *
 * colorMode       |  否  | 默认颜色模式（首次加载时生效，用户设置后不再覆盖）
 *                    取值：
 *                    - "sequential" —— 内部多颜色（每要素不同色，默认）
 *                    - "field"      —— 按字段唯一值分色（需配合 colorField）
 *                    - "single"     —— 全部要素单一颜色（需配合 color 字段）
 *                    提示：省略此字段默认 sequential，用户可在图层面板自由切换
 *
 * colorField      |  否  | colorMode="field" 时使用的字段名
 *                    指定后每个不同字段值自动分配独立颜色
 *                    示例：{ colorMode: "field", colorField: "Contractor" }
 *
 * ==========================================================
 */
(function () {
  // ========== 路径配置 ==========
  window.geoJsonBasePath = "./assets/geojson/";
  window.geoJsonCosPath =
    "https://dupal-1258052757.cos.ap-shanghai.myqcloud.com/assets/geojson/";

  // dupal.cn 本身就是 COS 静态域名，相对路径即 COS 路径且走 CDN 加速
  // 因此始终优先使用相对路径，加载失败时回退到 COS 直连 URL
  window.geoJsonPrimaryPath = window.geoJsonBasePath;
  window.geoJsonFallbackPath = window.geoJsonCosPath;

  // ========== GeoJSON 分组配置 ==========
  window.geoJsonGroups = [
    {
      groupName: "全球板块构造",
      layers: [
        { name: "全球16大板块 plate16", file: "plate16.geojson" },
        {
          name: "全球280个板块 (Hasterok2022)",
          file: "plates_Hasterok2022.geojson",
        },
        { name: "大陆板块 plate_cont", file: "plate_cont.geojson" },
        { name: "大洋板块 plate_ocean", file: "plate_ocean.geojson" },
        {
          name: "洋中脊和转换断层 MOR&TF",
          file: "ridgenew.geojson",
          color: "#E63946",
        },
        { name: "海沟 Trench", file: "Pb_trench.geojson" },
        {
          name: "其他板块边界 Other boundries",
          file: "Pb_transformall.geojson",
        },
        { name: "大西洋断裂带 Atlantic_FZ", file: "Atlantic_FZ.geojson" },
        { name: "印度洋断裂带 Indian_FZ", file: "Indian_FZ.geojson" },
        { name: "太平洋断裂带 Pacific_FZ", file: "Pacific_FZ.geojson" },
      ],
    },
    {
      groupName: "洋中脊作用域",
      layers: [
        {
          name: "1全球洋壳 GlobalOceanicCrust",
          file: "1GlobalOceanicCrust.geojson",
        },
        { name: "2大洋域 OceanDomian", file: "2OceanDomian.geojson" },
        { name: "3次大洋域 SubOceanDomain", file: "3SubOceanDomain.geojson" },
        { name: "4洋中脊作用域 RidgeDomain", file: "4RidgeDomain.geojson" },
        {
          name: "全球陆壳 GlobalContinentalCrust",
          file: "global_continental_crust.geojson",
        },
        { name: "0作用域边界 RDboundary", file: "RD_plgn1_5.geojson" },
      ],
    },
    {
      groupName: "海底基础信息",
      layers: [
        {
          name: "火山 volcanos",
          file: "volcanos.geojson",
          labelField: "NAME",
          color: "#FF3333",
          icon: "volcano",
        },
        {
          name: "4.5级以上地震(2024-2026)",
          file: "EQ4_5_2024_2026.geojson",
        },
        {
          name: "7.0级以上地震(1800-2023)",
          file: "EQ7_1800_2023.geojson",
        },
        {
          name: "8.0级以上地震(1800-2023)",
          file: "EQ8_1800_2023.geojson",
        },
        {
          name: "热点 hotspots",
          file: "hotspots.geojson",
          labelField: "geodesc",
          color: "#FF3333",
          icon: "hotspot",
        },
        { name: "大火成岩省 (Johansson)", file: "LIP_Johansson.geojson" },
        { name: "洋壳年龄30Ma间隔", file: "seafloor_age_30.geojson" },
        {
          name: "盆地 (Evenick2021)",
          file: "global_basins_Evenick2021.geojson",
        },
        { name: "盆地 (CGG)", file: "Sedimentary_CGG.geojson" },
        {
          name: "海底光缆 Submarine Cables",
          file: "TeleGeography_Cables.geojson.gz",
          labelField: "name",
          color: "#00ACC1",
        },
        {
          name: "光缆登陆点 Landing Points",
          file: "TeleGeography_LandingPoints.geojson.gz",
          labelField: "name",
          color: "#00897B",
        },
        {
          name: "海底地名点 Gazetteer_point",
          file: "Gazetteer_point.geojson.gz",
          labelField: "name",
          defaultOpacity: 0.35,
          searchPriority: true,
        },
        {
          name: "海底地名多点 Gazetteer_multipoint",
          file: "Gazetteer_multipoint.geojson.gz",
          labelField: "name",
          defaultOpacity: 0.35,
          searchPriority: true,
        },
        {
          name: "海底地名线 Gazetteer_multilinestring",
          file: "Gazetteer_multilinestring.geojson.gz",
          labelField: "name",
          defaultOpacity: 0.35,
          searchPriority: true,
        },
        {
          name: "海底地名面 Gazetteer_multipolygon",
          file: "Gazetteer_multipolygon.geojson.gz",
          labelField: "name",
          defaultOpacity: 0.35,
          searchPriority: true,
        },
      ],
    },
    {
      groupName: "大型异常区",
      layers: [
        { name: "LLSVP", file: "LLSVP.geojson" },
        { name: "Dupal异常洋 DupalOcean", file: "DupalOcean.geojson" },
      ],
    },
    {
      groupName: "海底矿产资源",
      layers: [
        {
          name: "热液喷口 HydrothermalVents(ISA)",
          file: "hydrothermal_vents.geojson",
          labelField: "Name ID",
          color: "#FF3333",
          icon: "hotspot",
        },
        { name: "多金属结核 Fe-MnNodule(NOAA)", file: "Fe_MnNodule.geojson" },
        { name: "富钴结壳 Co-richCrust(NOAA)", file: "Co-richCrust.geojson" },
        {
          name: "PMN 全球多金属结核勘探合同区",
          file: "01_pmn_exploration_areas.geojson.gz",
          labelField: "Contractor",
          colorMode: "field",
          colorField: "Contractor",
        },
        {
          name: "PMS 多金属硫化物勘探合同区",
          file: "02_pms_exploration_areas.geojson.gz",
          labelField: "Contractor",
          colorMode: "field",
          colorField: "Contractor",
        },
        {
          name: "CFC 富钴结壳勘探合同区",
          file: "03_cfc_exploration_areas.geojson.gz",
          labelField: "Contractor",
          colorMode: "field",
          colorField: "Contractor",
        },
        {
          name: "EBSA 海洋保护区&特殊生态区",
          file: "EBSAs_4326_Vis.geojson.gz",
          color: "#66BB6A",
          colorMode: "single",
        },
      ],
    },
    {
      groupName: "地质站位",
      layers: [
        { name: "DSDP", file: "DSDP.geojson", labelField: "Hole" },
        { name: "ODP", file: "ODP.geojson", labelField: "Fullname" },
        { name: "IODP03-13", file: "IODP03-13.geojson" },
        { name: "IODP13-26", file: "IODP13-26.geojson", labelField: "site" },
        { name: "NWIR_rock", file: "NWIR_ridge.geojson" },
        { name: "SWIR_rock", file: "SWIR_ridge.geojson" },
        { name: "SEIR_rock", file: "SEIR_ridge.geojson" },
        { name: "SEIR_offaxis_rock", file: "SEIR_offaxis.geojson" },
        { name: "RedSea_rock", file: "RedSea_rift.geojson" },
        { name: "古生物学 PBDB", file: "PBDB.geojson" },
        { name: "气候岩性指标 PBDB", file: "Boucot.geojson" },
      ],
    },
    {
      groupName: "社会热点专题",
      layers: [
        {
          name: "2026世界杯8强",
          file: "wc2026_round8_teams.geojson",
          labelField: "name_zh",
        },
       {
          name: "2026世界杯16强",
          file: "wc2026_round16_teams.geojson",
          labelField: "name_zh",
        },
        {
          name: "2026世界杯32强",
          file: "wc2026_round32_teams.geojson",
          labelField: "name_zh",
        },
        {
          name: "2026世界杯48强",
          file: "wc2026_48_teams.geojson",
          labelField: "name_zh",
        },
        {
          name: "世界各国",
          file: "countries-all-195.geojson",
          labelField: "name_zh",
        },
        {
          name: "富裕国家",
          file: "countries-rich-50K.geojson",
          labelField: "name_zh",
        },
        {
          name: "贫穷国家",
          file: "countries-poor-5K.geojson",
          labelField: "name_zh",
        },
        {
          name: "人口大国",
          file: "countries-populous.geojson",
          labelField: "name_zh",
        },
        {
          name: "经济强国",
          file: "countries-economic-powers.geojson",
          labelField: "name_zh",
        },
        {
          name: "领土大国",
          file: "countries-large-territory.geojson",
          labelField: "name_zh",
        },
        {
          name: "全球军事设施 Overseas Military Bases",
          file: "OMB.geojson.gz",
          labelField: "Name",
          color: "#C62828",
        },
        {
          name: "全球海盗事件 ASAM Piracy Events",
          file: "All_ASAM_Events.geojson.gz",
          labelField: "hostility_",
          colorMode: "field",
          colorField: "hostility_",
        },
        {
          name: "中国县城名称 China County",
          file: "ChinaCounty.geojson.gz",
          labelField: "NAME",
          color: "#1976D2",
          searchPriority: true,
        },
        {
          name: "浙江适飞区(2026-05-12)",
          file: "浙江适飞区_20260512.geojson.gz",
          source:
            "浙江省交通运输厅 2026年5月12日 关于公布新版浙江省无人驾驶航空器适飞空域范围的公告",
        },
        {
          name: "国家行政区 countries",
          file: "countries.geojson.gz",
          labelField: "NAME_ZH",
          source: "https://www.naturalearthdata.com/",
          searchPriority: true,
        },
        {
          name: "海区 geography_marine_polys",
          file: "geography_marine_polys.geojson.gz",
          labelField: "name_zh",
          source: "https://www.naturalearthdata.com/",
          searchPriority: true,
        },
        {
          name: "港口 ports",
          file: "ports.geojson.gz",
          labelField: "name",
          source: "https://www.naturalearthdata.com/",
          searchPriority: true,
        },
        {
          name: "省级行政区 states_provinces",
          file: "states_provinces.geojson.gz",
          labelField: "name_zh",
          source: "https://www.naturalearthdata.com/",
        },
      ],
    },
    {
      groupName: "测试数据",
      layers: [{ name: "PIC 45万点", file: "pic.geojson" }],
    },
    {
      groupName: null,
      layers: [{ name: "Dupal异常区", file: "DupalOcean.geojson" }],
    },
  ];
})();
