/**
 * Leaflet.GzIdbLoader.js
 * Leaflet 插件：GZ 文件加载器 + IndexedDB 缓存
 * 功能：加载 .gz 压缩的 GeoJSON 文件，自动解压并缓存解析后的 JSON 数据
 *       同时缓存搜索倒排索引（tokens 部分），加速页面刷新后搜索恢复
 * 用途：加速重复加载，避免重复解压和索引重建
 *
 * 使用方式：
 *   L.GzIdbLoader.fetch(url) → Promise<GeoJSON>
 *   L.GzIdbLoader.clearCache() → 清除缓存
 *   L.GzIdbLoader.getCacheSize() → 获取缓存大小
 *   L.GzIdbLoader.getSearchIndex(checkboxId) → Promise<Object|null>
 *   L.GzIdbLoader.setSearchIndex(checkboxId, tokens) → Promise
 */
(function (root, factory) {
  // 支持 AMD / CommonJS / 全局变量
  if (typeof define === "function" && define.amd) {
    define(["leaflet"], factory);
  } else if (typeof exports === "object") {
    module.exports = factory(require("leaflet"));
  } else {
    factory(root.L);
  }
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  // ========== 配置 ==========
  const DB_NAME = "GzGeoJSONCache";
  const DB_VERSION = 2;
  const STORE_NAME = "geojson";
  const INDEX_STORE = "searchIndex";

  // ========== IndexedDB 封装 ==========
  function openDB() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "url" });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
        // V2: 新增搜索索引 store
        if (!db.objectStoreNames.contains(INDEX_STORE)) {
          db.createObjectStore(INDEX_STORE, { keyPath: "checkboxId" });
        }
      };

      request.onsuccess = function (e) {
        resolve(e.target.result);
      };

      request.onerror = function (e) {
        reject("IndexedDB 打开失败: " + e.target.error);
      };
    });
  }

  function getCache(url) {
    return new Promise(function (resolve, reject) {
      openDB()
        .then(function (db) {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const request = store.get(url);

          request.onsuccess = function (e) {
            const result = e.target.result;
            if (result) {
              console.log("[GzIdbLoader] 命中缓存:", url);
              resolve(result.data);
            } else {
              resolve(null);
            }
          };

          request.onerror = function (e) {
            console.warn("[GzIdbLoader] 读取缓存失败:", e.target.error);
            resolve(null);
          };
        })
        .catch(function (err) {
          console.warn("[GzIdbLoader] 打开 DB 失败:", err);
          resolve(null);
        });
    });
  }

  function setCache(url, data) {
    return new Promise(function (resolve) {
      openDB()
        .then(function (db) {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);

          // 不再计算 size（避免完整序列化 45 万点炸内存）
          // getCacheSize() 需要时再按需计算
          const record = {
            url: url,
            data: data,
            timestamp: Date.now(),
          };

          const request = store.put(record);

          request.onsuccess = function () {
            console.log("[GzIdbLoader] 已缓存:", url);
            resolve();
          };

          request.onerror = function (e) {
            console.warn("[GzIdbLoader] 写入缓存失败:", e.target.error);
            resolve(); // 写入失败不影响主流程
          };
        })
        .catch(function (err) {
          console.warn("[GzIdbLoader] 缓存写入失败:", err);
          resolve();
        });
    });
  }

  // ========== 搜索索引缓存（tokens + featureCount 用于版本检测）==========
  function getSearchIndex(cacheKey) {
    return new Promise(function (resolve) {
      openDB()
        .then(function (db) {
          const tx = db.transaction(INDEX_STORE, "readonly");
          const store = tx.objectStore(INDEX_STORE);
          const request = store.get(cacheKey);

          request.onsuccess = function (e) {
            const result = e.target.result;
            if (result) {
              console.log("[GzIdbLoader] 搜索索引缓存命中:", cacheKey);
              resolve(result);
            } else {
              resolve(null);
            }
          };

          request.onerror = function () {
            resolve(null);
          };
        })
        .catch(function () {
          resolve(null);
        });
    });
  }

  function setSearchIndex(cacheKey, indexObj) {
    return new Promise(function (resolve) {
      openDB()
        .then(function (db) {
          const tx = db.transaction(INDEX_STORE, "readwrite");
          const store = tx.objectStore(INDEX_STORE);
          const record = {
            checkboxId: cacheKey,
            tokens: indexObj.tokens,
            featureCount: indexObj.featureCount,
            timestamp: Date.now(),
          };
          const request = store.put(record);

          request.onsuccess = function () {
            console.log("[GzIdbLoader] 搜索索引已缓存:", cacheKey);
            resolve();
          };

          request.onerror = function () {
            resolve();
          };
        })
        .catch(function () {
          resolve();
        });
    });
  }

  function clearCache() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = function () {
        console.log("[GzIdbLoader] 缓存已清除");
        resolve();
      };
      request.onerror = function (e) {
        reject(e.target.error);
      };
    });
  }

  function getCacheSize() {
    return new Promise(function (resolve) {
      openDB()
        .then(function (db) {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const request = store.getAll();

          request.onsuccess = function (e) {
            const results = e.target.result;
            let totalSize = 0;
            results.forEach(function (item) {
              // 只累加有 size 字段的记录（新缓存未存 size，不在此处做 JSON.stringify 避免炸内存）
              if (typeof item.size === "number") {
                totalSize += item.size;
              }
            });
            resolve({
              count: results.length,
              size: totalSize,
              sizeFormatted: formatBytes(totalSize),
            });
          };

          request.onerror = function () {
            resolve({ count: 0, size: 0, sizeFormatted: "0 B" });
          };
        })
        .catch(function () {
          resolve({ count: 0, size: 0, sizeFormatted: "0 B" });
        });
    });
  }

  // ========== 工具函数 ==========
  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  function fetchGz(url) {
    console.log("[GzIdbLoader] 加载 gz 文件:", url);
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      const ds = new DecompressionStream("gzip");
      const decompressedStream = response.body.pipeThrough(ds);
      return new Response(decompressedStream).json();
    });
  }

  function fetchJson(url) {
    console.log("[GzIdbLoader] 加载 JSON 文件:", url);
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  // ========== 主接口 ==========
  function fetchWithCache(url) {
    const t0 = performance.now();
    // 1. 先尝试从缓存读取
    return getCache(url).then(function (cachedData) {
      if (cachedData) {
        console.log(
          "[GzIdbLoader] 缓存命中:",
          url,
          "读取耗时:",
          (performance.now() - t0).toFixed(1) + "ms",
        );
        return cachedData;
      }

      // 2. 缓存未命中，仅加载 gz
      const gzUrl = url.endsWith(".gz") ? url : url + ".gz";
      return fetchGz(gzUrl).then(function (data) {
        setCache(url, data);
        return data;
      });
    });
  }

  // ========== Leaflet 插件暴露 ==========
  L.GzIdbLoader = {
    /**
     * 加载 GeoJSON 文件（自动处理 gz 压缩和缓存）
     * @param {string} url - 文件 URL（不含 .gz 后缀）
     * @returns {Promise<Object>} GeoJSON 数据
     */
    fetch: fetchWithCache,

    /**
     * 清除所有缓存
     * @returns {Promise}
     */
    clearCache: clearCache,

    /**
     * 获取缓存统计信息
     * @returns {Promise<Object>} { count, size, sizeFormatted }
     */
    getCacheSize: getCacheSize,

    /**
     * 手动写入缓存
     * @param {string} url - 文件 URL
     * @param {Object} data - GeoJSON 数据
     * @returns {Promise}
     */
    setCache: function (url, data) {
      return setCache(url, data);
    },

    /**
     * 手动读取缓存
     * @param {string} url - 文件 URL
     * @returns {Promise<Object|null>}
     */
    getCache: getCache,

    /**
     * 读取缓存的搜索索引 tokens
     * @param {string} checkboxId - 图层 checkbox ID
     * @returns {Promise<Object|null>} tokens 倒排索引
     */
    getSearchIndex: getSearchIndex,

    /**
     * 写入搜索索引 tokens 到缓存
     * @param {string} checkboxId - 图层 checkbox ID
     * @param {Object} tokens - tokens 倒排索引
     * @returns {Promise}
     */
    setSearchIndex: setSearchIndex,
  };

  return L.GzIdbLoader;
});
