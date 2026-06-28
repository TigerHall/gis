/**
 * geo-config.js
 * GeoJSON 图层的路径和分组配置
 * 独立拆分以减负 geojsonloader.js，便于维护图层列表
 * 加载时机：必须在 geojsonloader.js 之前
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
        { name: "大陆板块 plate_cont", file: "plate_cont.json" },
        { name: "大洋板块 plate_ocean", file: "plate_ocean.json" },
        { name: "洋中脊和转换断层 MOR&TF", file: "ridgenew.json" },
        { name: "海沟 Trench", file: "Pb_trench.json" },
        { name: "其他板块边界 Other boundries", file: "Pb_transformall.json" },
        { name: "大西洋断裂带 Atlantic_FZ", file: "Atlantic_FZ.json" },
        { name: "印度洋断裂带 Indian_FZ", file: "Indian_FZ.json" },
        { name: "太平洋断裂带 Pacific_FZ", file: "Pacific_FZ.json" },
      ],
    },
    {
      groupName: "洋中脊作用域",
      layers: [
        {
          name: "1全球洋壳 GlobalOceanicCrust",
          file: "1GlobalOceanicCrust.json",
        },
        { name: "2大洋域 OceanDomian", file: "2OceanDomian.json" },
        { name: "3次大洋域 SubOceanDomain", file: "3SubOceanDomain.json" },
        { name: "4洋中脊作用域 RidgeDomain", file: "4RidgeDomain.json" },
        {
          name: "全球陆壳 GlobalContinentalCrust",
          file: "global_continental_crust.json",
        },
        { name: "0作用域边界 RDboundary", file: "RD_plgn1_5.json" },
      ],
    },
    {
      groupName: "海底基础信息",
      layers: [
        { name: "火山 volcanos", file: "volcanos.json" },
        { name: "热点 hotspots", file: "hotspots.json" },
        { name: "大火成岩省 (Johansson)", file: "LIP_Johansson.json" },
        { name: "洋壳年龄30Ma间隔", file: "seafloor_age_30.geojson" },
        {
          name: "盆地 (Evenick2021)",
          file: "global_basins_Evenick2021.geojson",
        },
        { name: "盆地 (CGG)", file: "Sedimentary_CGG.geojson" },
      ],
    },
    {
      groupName: "大型异常区",
      layers: [
        { name: "LLSVP", file: "LLSVP.json" },
        { name: "Dupal异常洋 DupalOcean", file: "DupalOcean.json" },
      ],
    },
    {
      groupName: "海底矿产资源",
      layers: [
        {
          name: "热液喷口 HydrothermalVents(ISA)",
          file: "hydrothermal_vents.geojson",
        },
        { name: "多金属结核 Fe-MnNodule(NOAA)", file: "Fe_MnNodule.geojson" },
        { name: "富钴结壳 Co-richCrust(NOAA)", file: "Co-richCrust.geojson" },
      ],
    },
    {
      groupName: "地质站位",
      layers: [
        { name: "DSDP", file: "DSDP.geojson" },
        { name: "ODP", file: "ODP.geojson" },
        { name: "IODP03-13", file: "IODP03-13.geojson" },
        { name: "IODP13-26", file: "IODP13-26.geojson" },
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
        { name: "2026世界杯48强", file: "wc2026_48_teams.geojson" },
        { name: "2026世界杯32强", file: "wc2026_round32_teams.geojson" },
      ],
    },
    {
      groupName: "测试数据",
      layers: [{ name: "PIC 45万点", file: "pic.geojson" }],
    },
    {
      groupName: null,
      layers: [{ name: "Dupal异常区", file: "DupalOcean.json" }],
    },
  ];
})();
