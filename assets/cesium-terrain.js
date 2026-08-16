/**
 * cesium-terrain.js
 * Cesium 地形 Provider 配置
 *
 * 地形数据源策略（按优先级）：
 * 1. 配置了 Cesium Ion Token → Cesium World Terrain（含海底地形）
 * 2. 否则 → ArcGIS World Elevation 3D（公开免费，无需 token）
 * 3. 都不可用 → 平坦椭球体
 *
 * ArcGIS 高程数据源说明：
 *   Cesium 原生支持 ArcGIS 高程服务（ImageService，LERC 编码高程瓦片）。
 *   公开服务：https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer
 *   通过 Cesium.ArcGISTiledElevationTerrainProvider 加载，可直接替换 Cesium World Terrain。
 *
 * 暴露：window.CesiumTerrain
 */

(function () {
  "use strict";

  // ========== 配置 ==========
  // Cesium Ion 免费账户每月 5GB 流量，足够个人项目使用
  // 获取 token: https://ion.cesium.com/tokens
  // 留空则回退到 ArcGIS World Elevation 3D（公开服务，无需 token）
  var CESIUM_ION_TOKEN = ""; // ← 在此填入你的 Cesium Ion Token

  // ArcGIS 高程服务地址（公开，无需 token）
  var ARCGIS_ELEVATION_URL =
    "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer";

  // 是否启用 ArcGIS 高程（无 Ion Token 时的回退方案）
  // 注：ArcGIS 高程瓦片为规则网格 heightmap，几何密度高于 quantized-mesh，
  //     在低端设备上可能稍慢，可设为 false 禁用
  var ENABLE_ARCGIS_TERRAIN = true;

  /**
   * 创建 ArcGIS 高程 Provider（优先 fromUrl，回退构造器）
   */
  function createArcGisTerrain() {
    var Cs = window.Cesium;
    if (Cs.ArcGISTiledElevationTerrainProvider) {
      // 新版静态方法
      if (
        typeof Cs.ArcGISTiledElevationTerrainProvider.fromUrl === "function"
      ) {
        return Cs.ArcGISTiledElevationTerrainProvider.fromUrl(
          ARCGIS_ELEVATION_URL,
        );
      }
      // 旧版构造器
      return Promise.resolve(
        new Cs.ArcGISTiledElevationTerrainProvider({
          url: ARCGIS_ELEVATION_URL,
        }),
      );
    }
    return Promise.reject(
      new Error("ArcGISTiledElevationTerrainProvider 不可用"),
    );
  }

  var CesiumTerrain = {
    /**
     * 获取地形 Provider
     * @returns {Promise<Cesium.TerrainProvider|undefined>}
     */
    getTerrainProvider: function () {
      if (!window.Cesium) return Promise.resolve(undefined);

      // 1) 有 Ion Token → Cesium World Terrain（含海底地形）
      if (CESIUM_ION_TOKEN) {
        return window.Cesium.createWorldTerrainAsync().catch(function (e) {
          console.warn(
            "[CesiumTerrain] World Terrain 加载失败，回退 ArcGIS 高程:",
            e,
          );
          if (ENABLE_ARCGIS_TERRAIN) {
            return createArcGisTerrain().catch(function (e2) {
              console.warn("[CesiumTerrain] ArcGIS 高程加载失败:", e2);
              return undefined;
            });
          }
          return undefined;
        });
      }

      // 2) 无 Ion Token → ArcGIS World Elevation 3D
      if (ENABLE_ARCGIS_TERRAIN) {
        console.log("[CesiumTerrain] 使用 ArcGIS World Elevation 3D 高程");
        return createArcGisTerrain().catch(function (e) {
          console.warn(
            "[CesiumTerrain] ArcGIS 高程加载失败，降级平坦椭球体:",
            e,
          );
          return undefined;
        });
      }

      // 3) 无地形
      console.log("[CesiumTerrain] 未配置地形，使用平坦椭球体");
      return Promise.resolve(undefined);
    },

    /**
     * 初始化 Ion Token
     * 在 CesiumViewer 创建 Viewer 之前调用
     */
    initIonToken: function () {
      if (!window.Cesium) return;
      if (CESIUM_ION_TOKEN) {
        window.Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
      } else {
        // 无 Token 时设置空字符串，避免控制台报默认 Token 过期警告
        window.Cesium.Ion.defaultAccessToken = "";
      }
    },

    /**
     * 是否已配置 Ion Token
     */
    hasIonToken: function () {
      return !!CESIUM_ION_TOKEN;
    },

    /**
     * 是否启用 ArcGIS 高程
     */
    hasArcGisTerrain: function () {
      return ENABLE_ARCGIS_TERRAIN;
    },
  };

  window.CesiumTerrain = CesiumTerrain;
})();
