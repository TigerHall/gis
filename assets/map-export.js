/**
 * map-export.js —— 论文级地图出图引擎
 *
 * 解决的问题（2026-10-06 实测诊断）：
 *   旧 exportMapImage() 只 requestAnimationFrame 两帧就截图。WMS 底图
 *   （GEBCO 13 个）单瓦片要几百 ms ~ 数秒，两帧远远等不到 → 导出的图
 *   瓦片大面积缺失（实测「立刻导出 11 色 / 等瓦片后 2863 色」）。
 *   ⚠️ 与 CORS 无关：31 个底图逐个实测，会污染 canvas 的 = 0 个
 *      （crossOrigin 已在 basemap-manager.js 各 kind 铺好）。
 *
 * 本引擎的做法：
 *   1. 不截屏。按「目标像素尺寸」重新向瓦片服务要图，矢量要素自己画。
 *      → 输出分辨率与浏览器窗口解耦，可直接出 300dpi 印刷尺寸。
 *   2. XYZ 类底图：按 zoom 的瓦片矩阵手工拼（可跨 180° 环绕）。
 *      WMS 类底图：单次 GetMap 要整幅，天然就是目标分辨率。
 *      本地影像：直接 drawImage 缩放。
 *   3. 矢量要素读 Leaflet 内部几何 → canvas 路径重绘，
 *      不依赖 DOM 快照（DOM 快照对 L.divIcon / canvas 点层不可靠）。
 *   4. 图例 / 比例尺 / 指北针 / 标题 / 版权署名都在 canvas 上绘制，
 *      可单独开关。版权署名默认开（服务条款要求），
 *      但允许用户关闭 —— 关闭后由使用者在图注/正文自行标注来源。
 *
 * 暴露：window.MapExport = { open, close, isOpen, render, download }
 *       app.js 的「导出图片」按钮改为调 MapExport.open()。
 */
(function () {
  "use strict";

  if (!window.L) {
    console.warn("[MapExport] Leaflet 未就绪，跳过注册");
    return;
  }

  // 投影：Web Mercator（EPSG:3857）。与主图一致，故只支持主图，
  // 极地视图（3413/3031）出图另行处理。
  var EARTH_R = 6378137;
  var MAX_LAT = 85.0511287798;

  var TILE = 256; // 标准 XYZ 瓦片边长

  /**
   * 出图用的两套字体（论文图的关键细节之一）：
   *  · SERIF —— 经纬度标注、图注编号、比例尺数字、指北针 N：学术图里一律衬线（Times）；
   *  · SANS  —— 图例的中文名（Times 没有中文字形，浏览器会掉到系统宋体，反而更像论文）。
   * 中文 fallback 显式给出 Songti SC / SimSun：Windows 与 macOS 都能落到真正的宋体。
   */
  var FONT_SERIF = '"Times New Roman", "Nimbus Roman", "Songti SC", SimSun, serif';
  var FONT_SANS = '"Microsoft YaHei", "PingFang SC", Arial, sans-serif';

  // ========== 投影换算 ==========
  function lonToX(lon, scale, originX) {
    return ((lon + 180) / 360) * scale + originX;
  }
  function latToY(lat, scale, originY) {
    var s = Math.sin((lat * Math.PI) / 180);
    return (
      (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale + originY
    );
  }
  function clampLat(lat) {
    return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  }

  /** 把任意经度归一到 [-180,180]。跨 180° 的要素靠它环绕回正确一侧 */
  function normLng(lng) {
    var x = ((lng + 180) % 360 + 360) % 360 - 180;
    return x === -180 ? 180 : x;
  }

  /** 由中心点 + 目标像素尺寸，算出该尺度下世界像素矩阵的左上角原点 */
  function computeOrigin(center, zoom) {
    var scale = TILE * Math.pow(2, zoom);
    return {
      scale: scale,
      x: lonToX(center.lng, scale, 0),
      y: latToY(clampLat(center.lat), scale, 0),
    };
  }

  /** 某 zoom 下瓦片总数（2^z） */
  function tileCount(zoom) {
    return Math.pow(2, zoom);
  }

  // ========== 工具 ==========
  /**
   * 加载远程图片。
   *
   * ⚠️ 2026-10-06 改：原来用 `new Image()` + `crossOrigin="anonymous"`，
   *    实测 GEBCO WMS 那种「无文件扩展名、带长 query 的 URL」会**永久挂起**
   *    （既不 onload 也不 onerror，直到 timeout），但同一个 URL 用 fetch
   *    能正常拿到 371KB PNG，加个 cache-buster 的 <img> 也能加载。
   *    这是 <img> 对该类 URL 的缓存/解码怪癖，不是服务端问题。
   *    所以改成 fetch → Blob → createImageBitmap：
   *      · 能拿到真实错误信息（便于排障）
   *      · 避免 <img> 的怪癖
   *      · Blob 画进 canvas 不会污染（CORS 已在 fetch 层过掉）
   *    老浏览器没有 createImageBitmap 时退回 new Image()。
   */
  function loadImage(url, timeout) {
    var t = timeout || 20000;
    return new Promise(function (resolve) {
      var settled = false;
      var done = function (v) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(v);
      };
      var timer = setTimeout(function () {
        done({ __failed: true, reason: "timeout" });
      }, t);

      if (window.fetch && window.createImageBitmap) {
        window
          .fetch(url, { mode: "cors", credentials: "omit" })
          .then(function (resp) {
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            return resp.blob();
          })
          .then(function (blob) {
            if (!blob.type || blob.type.indexOf("image") !== 0) {
              // 服务端可能返回 XML 错误串（WMS 参数错时）——直接判失败
              return blob
                .slice(0, 64)
                .text()
                .then(function (txt) {
                  if (/^</.test(txt.trim())) throw new Error("非图片响应: " + txt.slice(0, 60));
                  return createImageBitmap(blob);
                });
            }
            return createImageBitmap(blob);
          })
          .then(function (bmp) {
            done(bmp);
          })
          .catch(function (e) {
            done({ __failed: true, reason: String(e && e.message ? e.message : e) });
          });
        return;
      }

      // ---- 兜底：老浏览器 ----
      var im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = function () {
        done(im);
      };
      im.onerror = function () {
        done({ __failed: true, reason: "img error" });
      };
      im.src = url;
    });
  }

  /** loadImage 的结果是不是失败占位（Image 实例没有这个私有标记） */
  function imgOk(im) {
    return !!im && !im.__failed;
  }

  /** 等待地图上所有瓦片（含矢量 canvas 重绘）就绪 —— 旧实现缺的就是这一步 */
  function waitForMapReady(map, timeout) {
    return new Promise(function (resolve) {
      var start = Date.now();
      var limit = timeout || 12000;
      function check() {
        var imgs = map.getContainer().querySelectorAll(
          "img.leaflet-tile, img.leaflet-image-layer",
        );
        var pending = 0;
        imgs.forEach(function (im) {
          if (im.complete && im.naturalWidth > 0) return;
          pending++;
        });
        // 再等一帧，确保 Leaflet 的 canvas 渲染器已重绘
        requestAnimationFrame(function () {
          if (pending === 0 || Date.now() - start > limit) {
            resolve({ waited: Date.now() - start, ok: pending === 0 });
            return;
          }
          setTimeout(check, 120);
        });
      }
      // 先给瓦片一点启动时间（刚 setView 的那一瞬间一张都没有）
      setTimeout(check, 150);
    });
  }

  // ========== 底图描述：把 Leaflet 图层还原成「可重新请求的瓦片源」 ==========
  // 为什么不直接复用 map 上已有的 <img>？
  //   因为那些 img 只覆盖当前视野的 zoom。出图要更高分辨率就必须重新按
  //   目标 zoom 请求，复用旧图等于放大 → 论文级出图必须重新取。
  //
  // ⚠️ 认底图必须以「地图上真正挂着的图层」为准，不能只读配置名：
  //   ① ArcGIS-海洋 是 LayerGroup（底图 + 注记层两个子层），本身不是 TileLayer
  //   ② 覆盖层（天地图世界境界 ibo_w 等）也是 TileLayer，会被误认成底图
  //      （实测踩过：ArcGIS-海洋 下拿到的是「天地图世界境界」）
  //   ③ 用户可能手动 removeLayer/addLayer，或当前是「无底图」伪底图（空 LayerGroup）
  //      —— 只读 _currentBasemapName 会拿到「图上根本没有」的图层
  // 所以：先把 baseLayers 的所有图层对象收集成集合，再与 map 上实际挂着的图层求交集。
  function basemapLayersOnMap(map) {
    var bm = window.BasemapManager;
    var hit = null;
    if (!bm || !bm.baseLayers) return null;
    var keys = Object.keys(bm.baseLayers);
    map.eachLayer(function (l) {
      if (hit) return;
      // LayerGroup 也算（ArcGIS-海洋 / 无底图都是组）
      for (var i = 0; i < keys.length; i++) {
        if (bm.baseLayers[keys[i]] === l) {
          hit = { name: keys[i], layer: l };
          return;
        }
      }
    });
    if (hit) return hit;
    // 图上没有任何已注册底图（理论上不会发生）→ 退回配置名
    var name = window._currentBasemapName || (bm.config && bm.config.defaultBasemap);
    if (name && bm.baseLayers[name]) return { name: name, layer: bm.baseLayers[name] };
    return null;
  }

  function centerLngAt(map) {
    try {
      return map.getCenter().lng;
    } catch (e) {
      return 0;
    }
  }

  /**
   * 从多个并排的 ImageOverlay 副本里，挑「当前视野中心落在其经度范围内」的那一个。
   * ETOPO / ETOPO_2022 由 imageWorldCopy 复制成 3 份（-540..180 / -180..540 / 180..900），
   * 它们的 bounds 都很宽，必须按中心经度选，不能取第一个。
   */
  function pickImageCopy(copies, centerLng) {
    if (!copies.length) return null;
    if (copies.length === 1) return copies[0];
    var clng = centerLng;
    while (clng < -180) clng += 360;
    while (clng > 180) clng -= 360;
    for (var i = 0; i < copies.length; i++) {
      var b = copies[i].getBounds && copies[i].getBounds();
      if (!b || !b.isValid()) continue;
      var w = b.getWest();
      var e = b.getEast();
      if (w <= -180 && e >= 180) w = -180; // 归一化到 [-180,180] 再比
      if (clng >= w && clng <= e) return copies[i];
    }
    // 都不含（理论上不会）→ 退化为第一个
    return copies[0];
  }

  /**
   * 所有「覆盖层」图层对象集合（境界线/标注等）。
   * ⚠️ 底图组里可能**混着覆盖层**：ArcGIS 系列开了 `attachBoundary`，
   *    `ArcGIS-海洋` 的 LayerGroup 实测含 3 个子层
   *    [天地图世界境界 ibo_w, Ocean_Base, Ocean_Reference]，
   *    且 ibo_w 排在**第一位** → 取 tileLayers[0] 会选中覆盖层当底图，
   *    覆盖层又因 isBase() 被排除 → 覆盖层彻底不出现。
   *    所以收瓦片层时必须先把覆盖层挑掉。
   */
  function overlayLayerSet() {
    var bm = window.BasemapManager;
    var set = [];
    if (!bm) return set;
    [bm.overlays, bm.moreOverlays].forEach(function (group) {
      if (!group) return;
      Object.keys(group).forEach(function (k) {
        var l = group[k];
        if (set.indexOf(l) === -1) set.push(l);
      });
    });
    return set;
  }

  function describeBasemap(map) {
    var found = basemapLayersOnMap(map);
    if (!found) return null;
    var layer = found.layer;
    var overlaySet = overlayLayerSet();

    var tileLayers = [];
    if (layer instanceof L.LayerGroup) {
      // LayerGroup 里两种子层都要收，但要**剔除覆盖层**：
      //   TileLayer    —— ArcGIS-海洋（底图 + 注记层）
      //   ImageOverlay —— ETOPO / ETOPO_2022（整幅影像，跨 180° 复制三份）
      layer.eachLayer(function (c) {
        if (!(c instanceof L.TileLayer || c instanceof L.ImageOverlay)) return;
        if (overlaySet.indexOf(c) !== -1) return; // ← 覆盖层不当前图
        tileLayers.push(c);
      });
    } else if (layer instanceof L.TileLayer || layer instanceof L.ImageOverlay) {
      if (overlaySet.indexOf(layer) === -1) tileLayers.push(layer);
    }
    // 「无底图」是空 LayerGroup → 没有任何瓦片层，返回 null 表示「本次不出底图」
    if (!tileLayers.length) return null;

    var desc = { name: found.name, kind: null, layers: tileLayers };

    // WMS 优先判定：Leaflet 的 TileLayer.WMS 才有 _wms
    var wmsLayer = tileLayers.filter(function (l) {
      return l instanceof L.TileLayer.WMS || l._wms !== undefined;
    })[0];
    if (wmsLayer) {
      desc.kind = "wms";
      desc.layer = wmsLayer;
      // 交给 drawWMS 重建完整 GetMap 请求，这里只留服务地址
      desc.url = String(wmsLayer._url || "").replace(/\?.*$/, "");
      return desc;
    }

    var tile = tileLayers[0];
    if (tile instanceof L.ImageOverlay) {
      desc.kind = "image";
      desc.url = tile._url;
      // ⚠️ imageWorldCopy 型底图（ETOPO）由 basemap-manager 复制 3 份并排，
      //   视野中心只落在其中一份上。挑对那一份，否则整幅图横移一个世界 → 出图空白。
      //   实测踩过：中心 125° 时误取第一份(-540..-180) → 画到画布外。
      desc.layer = pickImageCopy(tileLayers, centerLngAt(map));
      return desc;
    }

    desc.kind = "xyz";
    desc.layer = tile;
    desc.url = String(tile._url || "").replace(/\{r\}/g, "");
    desc.maxNativeZoom = tile.options.maxNativeZoom;
    desc.subdomains = tile.options.subdomains || "abc";
    // ArcGIS 的注记层作为第二张图叠在同一底图上（它不报版权）
    desc.labelLayer =
      tileLayers.length > 1 && tileLayers[1] instanceof L.TileLayer
        ? tileLayers[1]
        : null;
    if (desc.labelLayer) {
      desc.labelUrl = String(desc.labelLayer._url || "").replace(/\{r\}/g, "");
      desc.labelMaxNativeZoom = desc.labelLayer.options.maxNativeZoom;
    }
    return desc;
  }

  /** 找出当前叠加的所有「瓦片型覆盖层」（境界线、标注层等），出图时一并画上 */
  function describeOverlays(map, baseDesc) {
    var out = [];
    // 底图自身的瓦片层要排除：ArcGIS-海洋 是 LayerGroup，
    // 它的子层并不在 map._layers 里，但保险起见按对象比对排除
    var baseLayers = (baseDesc && baseDesc.layers) || [];
    function isBase(l) {
      return baseLayers.indexOf(l) !== -1;
    }
    map.eachLayer(function (layer) {
      // 只处理直接挂在 map 上的图层；LayerGroup 的子层不重复处理
      if (layer instanceof L.LayerGroup) return;
      if (isBase(layer)) return;
      if (layer instanceof L.TileLayer) {
        var url = layer._url;
        if (!url) return;
        if (layer instanceof L.TileLayer.WMS || layer._wms !== undefined) return;
        out.push({
          kind: "xyz",
          layer: layer,
          url: String(url).replace(/\{r\}/g, ""),
          maxNativeZoom: layer.options.maxNativeZoom,
          // ⚠️ subdomains 必须带上：drawXYZ 里算 {s} 要读 desc.subdomains.length，
          // 缺字段就是 "Cannot read properties of undefined (reading 'length')"。
          // 天地图的境界线 / 地名标注覆盖层就是走这条路。
          subdomains: layer.options.subdomains || "abc",
          opacity: layer.options.opacity,
        });
      } else if (layer instanceof L.ImageOverlay && layer._url) {
        out.push({ kind: "image", layer: layer, url: layer._url });
      }
    });
    return out;
  }

  // ========== 底图绘制 ==========

  /**
   * XYZ：按目标 zoom 的瓦片矩阵拼图（支持跨 180° 环绕）。
   *
   * 坐标系：画布坐标 = 瓦片像素 × o.S（见 render() 的说明）。
   * 瓦片列号 col 的左边缘画布坐标 = col × TILE × o.S，
   * 起点 col = floor(o.shiftX / (TILE×o.S))。
   */
  function drawXYZ(ctx, desc, o, w, h, opacity, onProgress) {
    if (!desc || !desc.url)
      return Promise.resolve({ ok: 0, fail: 0, total: 0, skipped: true });
    var zoom = o.zoom;
    var n = tileCount(zoom);
    var box = TILE * o.S; // 单个瓦片在画布上的目标边长
    var cols = Math.ceil(w / box) + 2; // +2 余量，覆盖环绕的两个副本
    var rows = Math.ceil(h / box) + 2;

    // 目标 zoom 不得超过服务原生上限，否则拿到的是放大过的低清图
    var maxZ = desc.maxNativeZoom;
    var jobs = [];
    var total = 0;
    var done = 0;
    var okN = 0;
    var failN = 0;

    var subs = desc.subdomains || "abc";

    ctx.save();
    ctx.globalAlpha = opacity == null ? 1 : opacity;
    // 起点瓦片列：把「环绕」纳入考虑 —— 从 leftWorld/box 向下取整即可
    // 起点瓦片列：画布左上角(0,0) 对应的瓦片列/行
    // shiftX 是画布坐标，除以 box 得瓦片列号
    var startCol = Math.floor(o.shiftX / box);
    var startRow = Math.floor(o.shiftY / box);
    for (var c = 0; c < cols; c++) {
      for (var r = 0; r < rows; r++) {
        var col = startCol + c;
        var row = startRow + r;
        if (row < 0 || row >= n) continue; // 极点外无瓦片
        // 环绕：只改 URL 里的 x，不改绘制位置（位置用未环绕的列号）
        var wrapped = ((col % n) + n) % n;
        var px = col * box - o.shiftX;
        var py = row * box - o.shiftY;
        // 屏幕外的不画（省 CPU）
        if (px > w || py > h || px + box < 0 || py + box < 0) continue;
        total++;
        (function (px, py, ux, uy) {
          var finalUrl = desc.url
            .replace("{z}", zoom)
            .replace("{x}", ux)
            .replace("{y}", uy)
            .replace("{s}", String(subs).charAt(Math.abs(ux) % subs.length))
            // 天地图用 {tk}；其他服务即使模板里有也一并替换掉
            .replace("{tk}", window.TDT_TK || "")
            .replace("{r}", "");
          jobs.push(
            loadImage(finalUrl).then(function (im) {
              done++;
              if (imgOk(im)) {
                try {
                  ctx.drawImage(im, px, py, box, box);
                  okN++;
                } catch (e) {
                  failN++;
                }
              } else failN++;
              if (onProgress && total) onProgress(done / total);
            })
          );
        })(px, py, wrapped, row);
      }
    }
    ctx.restore();
    return Promise.all(jobs).then(function () {
      return { ok: okN, fail: failN, total: total, capped: maxZ && zoom > maxZ };
    });
  }

  /**
   * 把超出 [-180,180] 的经度折算回合法范围（就近折回）。
   * 用于 WMS bbox —— 天 real 服务端只认半球范围。
   * 注：矢量层不走这里（project 里已 normLng，可自由环绕）。
   */
  function wrapToValidRange(lng) {
    var x = lng;
    while (x > 180) x -= 360;
    while (x < -180) x += 360;
    return x;
  }

  /**
   * WMS 出图的兜底：复用**屏幕上已经加载好的瓦片**。
   *
   * 为什么需要：GEBCO WMS 服务端本身就慢 —— 实测小 bbox(378×416) 就要 20s，
   * 双倍尺寸 54s。请求一张整幅 GetMap 动辄超时 → 用户拿到一张空白图。
   * 而地图当前视野里的 WMS 瓦片**早就加载完了**，且都带
   * crossOrigin:"anonymous"（canvas 不污染），直接拿来拼比重新求快得多。
   *
   * 换算：瓦片 (x,y,z) 的左边缘占世界宽度 x/2^z，
   * 画布坐标 = 世界宽 × (x/2^z) − shiftX，宽同理。
   */
  function drawWmsFromScreenTiles(layer, ctx, o, W, H, worldW) {
    var tiles = layer._tiles;
    if (!tiles) return { ok: 0, fail: 0, total: 0 };
    var okN = 0;
    var total = 0;
    Object.keys(tiles).forEach(function (k) {
      var t = tiles[k];
      var el = t && t.el;
      var c = t && t.coords;
      if (!el || !c || !el.complete || !el.naturalWidth) return;
      var zt = Math.pow(2, c.z);
      var px = (c.x / zt) * worldW - o.shiftX;
      var wpx = (1 / zt) * worldW;
      var py = (c.y / zt) * worldW - o.shiftY; // 瓦片同样占世界宽的 1/2^z
      var hpx = wpx;
      if (px > W || py > H || px + wpx < 0 || py + hpx < 0) return;
      total++;
      try {
        ctx.drawImage(el, px, py, wpx, hpx);
        okN++;
      } catch (e) {}
    });
    return { ok: okN, fail: total - okN, total: total };
  }

  /**
   * WMS：优先一次 GetMap 要整幅（天然就是目标分辨率）；
   * 失败/超时则回退复用屏幕瓦片（至少不比「你看到的」差）。
   * ⚠️ 必须自己拼全部参数：Leaflet 的 TileLayer.WMS 是按单瓦片 bbox 逐个请求的，
   *    它的 _url 只是服务地址，不含 GetMap 的必需参数。
   * ⚠️ srs 必须与 bbox 单位一致：bbox 是**度数**，只能声明 EPSG:4326。
   *    踩过：写 EPSG:3857 却是度数 bbox → 服务端当成米，落在原点一小块 →
   *    回一张空白图，而 loadImage 是成功的（report 1/1，图里什么都没有）。
   */
  function drawWMS(ctx, desc, o, w, h, opacity, onProgress) {
    var ows = desc.layer.options;
    // 画布四角 → 经纬度（用同一个 project 反算，保证与矢量层完全对齐）
    var nw = unproject(o, 0, 0);
    var se = unproject(o, w, h);
    // 屏幕 y 向下增大 → 纬度向南减小，故 nw 是西/北，se 是东/南
    // ⚠️ 中心在 170°E 这类位置时，反算出的经度会超出 ±180（如 82..258）。
    //    WMS 的 bbox 必须是法定半球范围，否则服务端直接报错。
    //    实测：GEBCO 遇到 -180..180 之外的 bbox 返回的是错误 XML。
    //    取 [-180,180] 内的那一段，并整体平移使视野尽量居中。
    var minX = wrapToValidRange(nw.x);
    var maxX = wrapToValidRange(se.x);
    if (maxX < minX) {
      var t = minX;
      minX = maxX;
      maxX = t;
    }
    var minY = se.y,
      maxY = nw.y;

    var fmt = ows.format || "image/png";
    // ⚠️ srs 必须与 bbox 单位一致。upCache 里 bbox 是**度数**（这里用
    //    canvas 反算经纬度），所以只能声明 EPSG:4326。
    //    踩过：写 EPSG:3857 却是度数 bbox → 服务端把它当成米，落在原点
    //    附近一小块 → 回一张 3.7KB 的空白图，而 loadImage 是成功的
    //    （report 显示 1/1，其实图里什么都没有）。
    var params = [
      "service=WMS",
      "request=GetMap",
      "version=" + (ows.version || "1.1.1"),
      "layers=" + encodeURIComponent(ows.layers || ""),
      "styles=" + encodeURIComponent(ows.styles || ""),
      "srs=EPSG:4326",
      "bbox=" + [minX, minY, maxX, maxY].join(","),
      "width=" + Math.round(w),
      "height=" + Math.round(h),
      "format=" + fmt,
      "transparent=" + (ows.transparent ? "true" : "false"),
    ];
    var url =
      desc.url + (desc.url.indexOf("?") === -1 ? "?" : "&") + params.join("&");

    if (onProgress) onProgress(0.3);
    // GEBCO 这类 WMS 服务端渲染就是慢（实测小图 20s、双倍 54s），
    // 超时放到 120s，避免「好好的图被我们提前判死」
    return loadImage(url, 120000).then(function (im) {
      if (onProgress) onProgress(0.8);
      if (!imgOk(im)) {
        // 回退：复用屏幕已加载瓦片。至少能给出「你在地图上看到的」，
        // 而不是一张空白图。
        var worldW = o.worldW; // 画布上的世界宽（= worldSize × S）
        var fromScreen = drawWmsFromScreenTiles(desc.layer, ctx, o, w, h, worldW);
        if (fromScreen.ok > 0) {
          return {
            ok: fromScreen.ok,
            fail: 0,
            total: fromScreen.total,
            usedScreenTiles: true,
            wmsFailed: false,
          };
        }
        return {
          ok: 0,
          fail: 1,
          total: 1,
          wmsFailed: true,
          wmsUrl: url,
          wmsErr: im && im.reason,
        };
      }
      ctx.save();
      ctx.globalAlpha = opacity == null ? 1 : opacity;
      ctx.drawImage(im, 0, 0, w, h);
      ctx.restore();
      return { ok: 1, fail: 0, total: 1 };
    });
  }

  /** 画布像素 → 经纬度（与 project 严格互逆） */
  function unproject(o, px, py) {
    var S = o.S || 1;
    // 先还原成瓦片级世界像素
    var wx = (px + o.shiftX) / S;
    var wy = (py + o.shiftY) / S;
    return {
      x: (wx / o.worldSize) * 360 - 180,
      y:
        (180 / Math.PI) *
        Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / o.worldSize))),
    };
  }

  /**
   * 本地整幅影像（ETOPO 等）：按其自身经纬范围对齐绘制。
   * ⚠️ ETOPO 类图层由 basemap-manager 复制 3 份并排（bounds 分别是
   *    -540..180 / -180..540 / 180..900），单份宽 360°。
   *    取哪一份要看**当前视野中心落在哪份的经度范围内**。
   *
   * 坐标系统一为「世界像素」：经度 lng → (lng+180)/360 × worldPx，
   * 与 project() 完全一致（project 里的 normLng 已把 lng 归一到 [-180,180]），
   * 所以这里也要先归一化再取 360 的倍数，避免横移一个世界导致出图空白。
   */
  function drawImageOverlay(ctx, desc, o, w, h, opacity, centerLng) {
    return loadImage(desc.url, 40000).then(function (im) {
      if (!imgOk(im)) return { ok: 0, fail: 1, total: 1, err: im && im.reason };
      var b = desc.layer.getBounds && desc.layer.getBounds();
      ctx.save();
      ctx.globalAlpha = opacity == null ? 1 : opacity;
      if (b && b.isValid()) {
        // 统一用「画布上的世界宽」（= 瓦片级 worldSize × S），与 project 同口径
        var worldPx = o.worldW;
        var nwLng = normLng(b.getNorthWest().lng);
        var seLng = normLng(b.getSouthEast().lng);
        var copySpan = ((seLng - nwLng) / 360) * worldPx; // 一份的像素宽
        // bounds 宽 ≤360° 是正常单幅；>360°（如 1080°）是跨 180° 复制多份
        var dwFull = copySpan > worldPx ? worldPx : copySpan;
        if (!(dwFull > 0) || !isFinite(dwFull)) dwFull = worldPx;
        // ⚠️ `b.getNorth()` / `b.getSouth()` 返回的是**数字**，不是 LatLng！
        //    写成 `b.getNorth().lat` 会拿到 undefined → clampLat → NaN →
        //    `drawImage(img, x, NaN, w, h)` **静默什么都不画**（不报错）。
        //    实测症状：ETOPO / ETOPO_2022 报 `{ok:1}` 但出图纯白。
        var bNorth = clampLat(Number(b.getNorth()));
        var bSouth = clampLat(Number(b.getSouth()));
        var dhFull =
          (latToY(bSouth, o.worldSize, 0) - latToY(bNorth, o.worldSize, 0)) *
          (o.S || 1);
        if (!(dhFull > 0) || !isFinite(dhFull)) dhFull = worldPx;

        // 该份左边缘的画布坐标
        var leftWorld = ((nwLng + 180) / 360) * worldPx;
        var clng = normLng(centerLng);
        var centerWorld = ((clng + 180) / 360) * worldPx;
        // ⚠️ 这里必须是 floor 而不是 round：
        //   `centerWorld - leftWorld` 是「中心在副本内的偏移」，落在哪个副本看整数部分。
        //   写成 round 时，只要偏移超过半个副本（中心经度 > 0°）就会整整平移一个世界
        //   → 整幅影像被画到画布右侧外面。实测症状：ETOPO / ETOPO_2022 报 ok:1 却全白。
        var kBase = Math.floor((centerWorld - leftWorld) / dwFull);
        var topCanvas = latToY(bNorth, o.worldSize, 0) * (o.S || 1) - o.shiftY;

        // 画布上可能同时露出多份（视野比一圈世界宽时）→ 逐份试，越界跳过
        for (var kk = kBase - 1; kk <= kBase + 1; kk++) {
          var x = leftWorld + kk * dwFull - o.shiftX;
          if (x > w + 1 || x + dwFull < -1) continue;
          ctx.drawImage(im, x, topCanvas, dwFull, dhFull);
        }
      } else {
        ctx.drawImage(im, 0, 0, w, h);
      }
      ctx.restore();
      return { ok: 1, fail: 0, total: 1 };
    });
  }

  // ========== 矢量要素重绘 ==========
  // 读 Leaflet 内部的几何与样式，在目标 canvas 上按同比例重画。
  // 为什么不用 DOM 快照：L.divIcon / MarkersCanvas 是 canvas，html-to-image
  // 对它们不可靠；且 DOM 快照无法出高分辨率。
  //
  // ⚠️ 三个必须踩准的点（都实测踩过）：
  //  1. **L.Polygon 继承自 L.Polyline**（Leaflet 1.9.x）。所以必须先判 Polygon，
  //     写成 `L.Path && !(L.Polyline)` 会让**所有面都掉进线分支** → 面只描边不填充，
  //     视觉上就是「导出图里没有面要素」。
  //  2. 线要素带一条**透明点击热区**（`geojsonloader.js:1273` 建，`opacity:0`、
  //     `_isHitLayer:true`）。不排除它会数出双倍要素，且画出看不见的粗线。
  //  3. `opacity:0` 的图层一律跳过（热区、全透明图层）。

  /**
   * 把 Leaflet 的 dashArray 归一成 canvas 认的数组。
   * ⚠️ 踩过：Leaflet 的 options.dashArray 是**字符串**（如 "4,2"），
   *    直接传给 ctx.setLineDash 会抛
   *    "The provided value cannot be converted to a sequence" → 整张图预览失败。
   *    天地图/ArcGIS 底图自带的注记边线就是带 dashArray 的，所以一切换底图就炸。
   */
  function toDashArray(da) {
    if (!da) return null;
    if (Array.isArray(da)) return da.filter(function (n) { return isFinite(n); });
    // 字符串 "4,2" / "4 2" / CSS 变量值
    var parts = String(da)
      .split(/[,\s]+/)
      .map(Number)
      .filter(function (n) {
        return isFinite(n) && n >= 0;
      });
    return parts.length ? parts : null;
  }

  function collectVectorPaths(map) {
    var paths = [];
    var markers = [];
    var pointLayers = [];

    map.eachLayer(function (layer) {
      // 线要素的透明点击热区：不是真实视觉内容
      if (layer._isHitLayer) return;
      var op = layer.options || {};
      // 全透明图层（opacity 0）不画
      if (op.opacity === 0 && !layer._isHitLayer) {
        // 仍要放过 opacity:0 但有 fillOpacity 的面（如「无色面 + 描边」的设计）
        if (!(op.fillOpacity > 0)) return;
      }

      // ⓪ Canvas 点层（Leaflet.MarkersCanvas，>3000 点的大数据集）
      //    ⚠️ 它既不是 L.Marker 也不是 L.Path，**一个 DOM 节点都没有**。
      //    以前这里没有分支 → 大数据点层出图是**整层空白**，而且不报错，
      //    用户只会看到「图里少了整整一个图层」。
      //    它自己存了预投影前的要素数组（_features = [{lat,lng,color}]），照着重绘即可。
      if (layer._features && typeof layer.setFeatures === "function") {
        pointLayers.push(layer);
        return;
      }

      // ① 面：必须先判 Polygon（它继承 Polyline）
      if (layer instanceof L.Polygon || layer instanceof L.Rectangle) {
        var rings = latLngsToRings(layer.getLatLngs());
        if (rings.length) {
          paths.push({
            type: "polygon",
            rings: rings,
            color: op.color,
            fillColor: op.fillColor,
            weight: op.weight,
            opacity: op.opacity,
            fillOpacity: op.fillOpacity,
            dashArray: toDashArray(op.dashArray),
          });
        }
        return;
      }
      // ② 圆（CircleMarker 也是 Path）
      if (layer instanceof L.CircleMarker) {
        var ll = layer.getLatLng && layer.getLatLng();
        if (ll) {
          paths.push({
            type: "circle",
            latlng: ll,
            radius: layer.getRadius ? layer.getRadius() : 5,
            color: op.color,
            fillColor: op.fillColor,
            weight: op.weight,
            opacity: op.opacity,
            fillOpacity: op.fillOpacity,
          });
        }
        return;
      }
      // ③ 线
      if (layer instanceof L.Polyline) {
        var lines = latLngsToLines(layer.getLatLngs());
        if (lines.length) {
          paths.push({
            type: "line",
            lines: lines,
            color: op.color,
            weight: op.weight,
            opacity: op.opacity,
            dashArray: toDashArray(op.dashArray),
          });
        }
        return;
      }
      // ④ 其他 Path（Circle 等有 getLatLng 的）
      if (layer instanceof L.Path) {
        if (typeof layer.getLatLng === "function") {
          var c2 = layer.getLatLng();
          if (c2) {
            paths.push({
              type: "circle",
              latlng: c2,
              radius: layer.getRadius ? layer.getRadius() : 5,
              color: op.color,
              fillColor: op.fillColor,
              weight: op.weight,
              opacity: op.opacity,
              fillOpacity: op.fillOpacity,
            });
          }
        }
        return;
      }
      // ⑤ 点标记
      if (layer instanceof L.Marker) markers.push(layer);
    });

    return { paths: paths, markers: markers, pointLayers: pointLayers };
  }

  /**
   * 点标记 → 「屏幕上那个图标」的描述。
   *
   * 以前出图把点一律画成半径 3px 的红点 —— 与屏幕差得离谱：
   * 屏幕上是带白边的火山三角/热点火焰（L.divIcon 内联 SVG），出图变成小红点，
   * 论文图里根本看不出是什么。这里直接把**已经渲染出来的 DOM 图标**序列化成
   * data URL 再 drawImage，形状/颜色/尺寸与屏幕完全一致。
   *
   * ⚠️ 位置不能用 latlng 直接当图标中心：带标签的图标是 [120,20] 的 wrapper、
   *    iconAnchor 在左端（见 Leaflet.GeoMarker.createSvgLabeledMarker），
   *    图标实际画在坐标点右侧。所以量 DOM 矩形、算它相对「坐标点屏幕位置」的偏移。
   *    这样任意 anchor / wrapper 结构都对。
   */
  function describeMarker(mk, map) {
    var el = mk.getElement && mk.getElement();
    if (!el) return null;
    var node =
      el.querySelector(".station-icon-svg > svg") ||
      el.querySelector("svg") ||
      el.querySelector("img");
    if (!node) return null;
    var r = node.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var ll = mk.getLatLng && mk.getLatLng();
    if (!ll) return null;

    var url = null;
    if (node.tagName.toLowerCase() === "img") {
      url = node.currentSrc || node.src;
    } else {
      // 内联 SVG → data URL（同一标签/图标的 marker 共用同一条 URL，只加载一次）
      var clone = node.cloneNode(true);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(Math.round(r.width)));
      clone.setAttribute("height", String(Math.round(r.height)));
      try {
        url =
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(new XMLSerializer().serializeToString(clone));
      } catch (e) {
        url = null;
      }
    }
    if (!url) return null;

    var c = map.latLngToContainerPoint(ll);
    var cr = map.getContainer().getBoundingClientRect();
    // 容器有虚线边框：clientWidth 不含边框，getBoundingClientRect 含
    var bw = Math.max(0, (cr.width - map.getSize().x) / 2);
    return {
      ll: ll,
      url: url,
      // 图标中心 − 坐标点的屏幕偏移（CSS px）
      dx: r.left + r.width / 2 - (cr.left + bw + c.x),
      dy: r.top + r.height / 2 - (cr.top + bw + c.y),
      w: r.width,
      h: r.height,
    };
  }

  /**
   * 加载「点图标」。
   * ⚠️ 不能直接复用 loadImage：它走 fetch → Blob → createImageBitmap，
   *    而 **createImageBitmap 不支持 SVG blob**（直接 reject）。
   *    而本项目的点图标全是内联 SVG（L.divIcon），序列化后正是 svg data URL。
   *    所以 SVG 一律走 <img>（data URL 不解码成文件、不污染 canvas）。
   */
  function loadIconImage(url, timeout) {
    var t = timeout || 8000;
    var isSvg = /^data:image\/svg/i.test(url);
    if (!isSvg && window.fetch && window.createImageBitmap) {
      return loadImage(url, t).then(function (im) {
        // 网络上的 .svg 文件同样过不了 createImageBitmap → 再给 <img> 一次机会
        if (!imgOk(im) && /\.svg(\?|#|$)/i.test(url)) return imgFallback(url, t);
        return imgOk(im) ? im : null;
      });
    }
    return imgFallback(url, t);
  }

  function imgFallback(url, t) {
    return new Promise(function (resolve) {
      var im = new Image();
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, t);
      im.crossOrigin = "anonymous";
      im.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(im);
      };
      im.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      };
      im.src = url;
    });
  }

  /** 预加载所有点图标（同 URL 只加载一次），返回 { url: ImageBitmap|Image } */
  function preloadIcons(descs) {
    var cache = {};
    var jobs = [];
    (descs || []).forEach(function (d) {
      if (!d || !d.url || cache[d.url] !== undefined) return;
      cache[d.url] = null;
      jobs.push(
        loadIconImage(d.url, 8000).then(function (im) {
          if (im) cache[d.url] = im;
        }),
      );
    });
    return Promise.all(jobs).then(function () {
      return cache;
    });
  }

  /**
   * 把 Leaflet 的 getLatLngs() 结果摊平成「环数组」。
   *
   * ⚠️ 不能按固定层数判断。实测踩过：`1全球洋壳 GlobalOceanicCrust` 的
   * getLatLngs() 长度 48，且 `ll[0]` 是**长度 1 的数组**（`[[ring…]]`，
   * 源数据是 MultiPolygon 却被套了一层）。按「看 ll[0][0] 有没有 lat」判断
   * 层级，会把这种形状误判成「空环」→ 面画不出来（表现：出图里没有面要素）。
   * 所以改成**递归摊平到「叶子是 latlng 序列」为止**，对任意嵌套都成立。
   */
  function latLngsToRings(ll) {
    var out = [];
    (function walk(node, depth) {
      if (!Array.isArray(node) || !node.length || depth > 6) return;
      // 叶子判定：元素本身是 {lat,lng} → 这一层就是一条环
      var isLeafRing =
        node[0] && typeof node[0] === "object" && node[0].lat !== undefined;
      if (isLeafRing) {
        out.push(node);
        return;
      }
      for (var i = 0; i < node.length; i++) walk(node[i], depth + 1);
    })(ll, 0);
    return out;
  }

  function latLngsToLines(ll) {
    var out = [];
    (function walk(node, depth) {
      if (!Array.isArray(node) || !node.length || depth > 6) return;
      var isLeafLine =
        node[0] && typeof node[0] === "object" && node[0].lat !== undefined;
      if (isLeafLine) {
        out.push(node);
        return;
      }
      for (var i = 0; i < node.length; i++) walk(node[i], depth + 1);
    })(ll, 0);
    return out;
  }

  /**
   * 跨 180° 经线的「反环绕」。
   *
   * 屏幕上有 worldCopyJump：一条从 170°E 到 -170°W 的线会在地图左右两侧
   * 各画一份副本，看起来连续跨过图幅边缘。
   *
   * canvas 这边必须自己复刻这件事，否则：
   *   · 整条几何绕远路横穿整个图幅（一条斜线把地图劈开）
   *   · 或整块跑到画布外 → 「出图里没有要素」
   *
   * 做法两步：
   *   ① **反环绕**：逐点选「离上一个点最近的 ±360° 副本」，
   *      让跨 180° 的几何内部不再横穿世界。
   *   ② **整体偏移**：把整块几何按 k×世界宽 平移，凡是与画布有交集的
   *      副本都画出来（画布通常远窄于世界，k 只需取 -1/0/1，但按范围算更稳）。
   */
  function unwrapLatLngs(latlngs, project, worldW) {
    var out = [];
    var prev = null;
    for (var i = 0; i < latlngs.length; i++) {
      var p = project(latlngs[i]);
      if (prev !== null && worldW > 0) {
        p.x += Math.round((prev - p.x) / worldW) * worldW;
      }
      out.push(p);
      prev = p.x;
    }
    return out;
  }

  /** 一批点中，k 的取值范围（画布 [0,W] 与平移 k×worldW 后有交集的所有 k） */
  function offsetRange(pts, worldW, W) {
    if (!pts.length || !(worldW > 0)) return [0, 0];
    var minX = Infinity,
      maxX = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].x < minX) minX = pts[i].x;
      if (pts[i].x > maxX) maxX = pts[i].x;
    }
    var kMin = Math.floor((0 - maxX) / worldW);
    var kMax = Math.ceil((W - minX) / worldW);
    return [kMin, kMax];
  }

  /** 把已反环绕的点按 k×worldW 平移后画成一条子路径 */
  function traceShifted(ctx, pts, k, worldW, close) {
    ctx.moveTo(pts[0].x + k * worldW, pts[0].y);
    for (var i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x + k * worldW, pts[i].y);
    }
    if (close) ctx.closePath();
  }

  /**
   * 把收集到的矢量内容画到画布上。
   *
   * @param data      collectVectorPaths() 的结果
   * @param iconCache preloadIcons() 的结果（url → ImageBitmap）
   * @param posK      画布像素 ÷ 屏幕 CSS 像素（图标的**视觉大小与偏移**靠它换算，
   *                  不能复用 styleScale：那是线宽/字号的缩放，允许被用户覆盖）
   */
  function drawVectors(
    ctx,
    project,
    scaleFactor,
    opacity,
    worldW,
    W,
    H,
    data,
    iconCache,
    posK,
  ) {
    var n = 0;
    if (!worldW) worldW = 0;
    if (!posK) posK = scaleFactor;

    ctx.save();
    ctx.globalAlpha = opacity == null ? 1 : opacity;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    var baseA = opacity == null ? 1 : opacity;

    /** 屏幕坐标 → 该点需要画的所有世界副本的 k 区间 */
    function ksOf(x) {
      if (!(worldW > 0)) return [0, 0];
      return [Math.floor((0 - x) / worldW), Math.ceil((W - x) / worldW)];
    }

    /**
     * 点要素统一最后画。
     * ⚠️ 层级必须照搬 Leaflet 的 pane：overlayPane(400) < markerPane(600)。
     *    之前把点画在面之前 → 任何半透明的大面（如「全球洋壳」）都会把点**盖成**
     *    一片浑浊的棕色（实测：红三角被 0.3 透明度的褐色面糊成金褐色）。
     */
    function drawPoints() {
      // ---- 点 ①：DOM 标记（可以拿到真实图标）----
      (data.markers || []).forEach(function (mk) {
      var d = mk._iconDesc;
      var ll = d ? d.ll : mk.getLatLng && mk.getLatLng();
      if (!ll) return;
      var pos = project(ll);
      if (pos.y < -H || pos.y > H * 2) return; // 极点外/明显越界（省 CPU）
      var img = d && iconCache ? iconCache[d.url] : null;
      var kk = ksOf(pos.x);

      if (img && d.w > 0) {
        // 真实图标：尺寸与偏移都按屏幕比例放大
        var dw = d.w * posK;
        var dh = d.h * posK;
        var cy = pos.y + d.dy * posK;
        for (var k = kk[0]; k <= kk[1]; k++) {
          var iconCx = pos.x + d.dx * posK + k * worldW;
          if (iconCx + dw / 2 < 0 || iconCx - dw / 2 > W) continue;
          if (cy + dh / 2 < 0 || cy - dh / 2 > H) continue;
          try {
            ctx.drawImage(img, iconCx - dw / 2, cy - dh / 2, dw, dh);
            n++;
          } catch (e) {}
        }
        return;
      }

      // 兜底：取不到图标（标记不在 DOM 里 / SVG 序列化失败）→ 小圆点
      var r = Math.max(1.5, 3 * scaleFactor);
      for (var k2 = kk[0]; k2 <= kk[1]; k2++) {
        var cx = pos.x + k2 * worldW;
        if (cx < -r || cx > W + r) continue;
        ctx.beginPath();
        ctx.arc(cx, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = "#e63946";
        ctx.globalAlpha = baseA;
        ctx.fill();
        ctx.lineWidth = Math.max(0.5, 1 * scaleFactor);
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        n++;
      }
    });

    // ---- 点 ②：Canvas 点层（大数据集，无 DOM）----
    (data.pointLayers || []).forEach(function (layer) {
      var feats = layer._features || [];
      if (!feats.length) return;
      var oo = layer.options || {};
      var size = Math.max(2, (oo.iconSize || 20) * posK);
      var singleImg = imgOk(oo.iconImage) ? oo.iconImage : null;
      var colorImgs = oo.iconImages || null;
      var op2 = oo.opacity == null ? 1 : oo.opacity;
      ctx.globalAlpha = baseA * op2;
      for (var i = 0; i < feats.length; i++) {
        var f = feats[i];
        if (!f || !isFinite(f.lat) || !isFinite(f.lng)) continue;
        var p = project({ lat: f.lat, lng: f.lng });
        if (p.y < -size || p.y > H + size) continue;
        var img2 = singleImg || (colorImgs ? colorImgs[f.color] : null);
        var kk2 = ksOf(p.x);
        for (var k3 = kk2[0]; k3 <= kk2[1]; k3++) {
          var x3 = p.x + k3 * worldW;
          if (x3 < -size || x3 > W + size) continue;
          if (imgOk(img2)) {
            try {
              ctx.drawImage(img2, x3 - size / 2, p.y - size / 2, size, size);
              n++;
            } catch (e) {}
          } else {
            ctx.beginPath();
            ctx.arc(x3, p.y, size / 2, 0, Math.PI * 2);
            ctx.fillStyle = f.color || "#e63946";
            ctx.fill();
            n++;
          }
        }
      }
      ctx.globalAlpha = baseA;
    });
    }

    // ---- 面 / 线（先画）----
    data.paths.forEach(function (p) {
      var fo;
      // ---------- 面 ----------
      if (p.type === "polygon") {
        // 先反环绕每个环，再算整块的平移范围
        var un = p.rings.map(function (ring) {
          return ring && ring.length ? unwrapLatLngs(ring, project, worldW) : null;
        });
        if (!un.some(Boolean)) return;
        var range = [0, 0];
        var all = [];
        un.forEach(function (u) {
          if (!u) return;
          all = all.concat(u);
          var rr = offsetRange(u, worldW, W);
          range[0] = Math.min(range[0], rr[0]);
          range[1] = Math.max(range[1], rr[1]);
        });
        fo = p.fillOpacity == null ? 0.4 : p.fillOpacity;
        for (var k = range[0]; k <= range[1]; k++) {
          ctx.beginPath();
          un.forEach(function (u) {
            if (!u) return;
            traceShifted(ctx, u, k, worldW, true);
          });
          if (fo > 0) {
            ctx.fillStyle = p.fillColor || p.color || "#888";
            ctx.globalAlpha = baseA * fo;
            ctx.fill("evenodd");
            ctx.globalAlpha = baseA;
          }
          if (p.weight > 0) {
            ctx.strokeStyle = p.color || "#333";
            ctx.lineWidth = Math.max(0.6, p.weight * scaleFactor);
            ctx.globalAlpha = baseA * (p.opacity == null ? 1 : p.opacity);
            if (p.dashArray && p.dashArray.length) ctx.setLineDash(p.dashArray);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = baseA;
          }
          n++;
        }
        return;
      }

      // ---------- 圆 ----------
      if (p.type === "circle") {
        var cp = project(p.latlng);
        var cr = Math.max(1, p.radius * scaleFactor);
        for (var kc = -1; kc <= 1; kc++) {
          var ccx = cp.x + kc * worldW;
          if (ccx < -cr || ccx > W + cr) continue;
          ctx.beginPath();
          ctx.arc(ccx, cp.y, cr, 0, Math.PI * 2);
          fo = p.fillOpacity == null ? 0.4 : p.fillOpacity;
          if (fo > 0) {
            ctx.fillStyle = p.fillColor || p.color || "#888";
            ctx.globalAlpha = baseA * fo;
            ctx.fill();
          }
          if (p.weight > 0) {
            ctx.strokeStyle = p.color || "#333";
            ctx.lineWidth = Math.max(0.6, p.weight * scaleFactor);
            ctx.globalAlpha = baseA * (p.opacity == null ? 1 : p.opacity);
            ctx.stroke();
          }
          ctx.globalAlpha = baseA;
          n++;
        }
        return;
      }

      // ---------- 线 ----------
      (p.lines || []).forEach(function (line) {
        if (!line || !line.length) return;
        var u = unwrapLatLngs(line, project, worldW);
        var rng = offsetRange(u, worldW, W);
        for (var kk = rng[0]; kk <= rng[1]; kk++) {
          ctx.beginPath();
          traceShifted(ctx, u, kk, worldW, false);
          ctx.strokeStyle = p.color || "#333";
          ctx.lineWidth = Math.max(0.6, p.weight * scaleFactor);
          ctx.globalAlpha = baseA * (p.opacity == null ? 1 : p.opacity);
          if (p.dashArray && p.dashArray.length) ctx.setLineDash(p.dashArray);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = baseA;
          n++;
        }
      });
    });

    // ---- 点（最后画，压在面/线之上，与屏幕的 markerPane 一致）----
    drawPoints();

    ctx.restore();
    return n;
  }

  // ========== 经纬网间隔：按像素密度自动挑「整齐度数」 ==========
  // ⚠️ 旧实现照搬 Leaflet.Graticule.js 的 zoomInterval 表（按**整数 zoom** 查表）。
  //    本项目开了 zoomSnap:0（无级缩放），zoom 常是 4.3 这种小数 → 表里每个
  //    {start,end} 都是整数区间，一律命中不了 → 落到兜底的 1°，于是 100° 宽的图里
  //    画出 101 条经线、图框刻度和外框标注挤成一排梳齿（2026-10-18 报的问题）。
  //    现在改成：按「标注之间至少留几倍字宽」反推一个整齐的度数，
  //    网格线、图框刻度、图外标注**共用同一个间隔**（论文图的规矩：线跟着标注走）。
  var NICE_DEG = [0.1, 0.2, 0.5, 1, 2, 2.5, 5, 10, 15, 20, 30, 45, 60, 90, 180];

  function niceInterval(pxPerDeg, minPx) {
    if (!(pxPerDeg > 0) || !(minPx > 0)) return 10;
    for (var i = 0; i < NICE_DEG.length; i++) {
      if (NICE_DEG[i] * pxPerDeg >= minPx - 1e-6) return NICE_DEG[i];
    }
    return NICE_DEG[NICE_DEG.length - 1];
  }

  /** 图外经纬度标注字号（px）= 8pt。drawFrame 与「选间隔」必须用同一个值。 */
  function frameLabelFontPx(ptPx) {
    return Math.max(9, 8 * (Number(ptPx) || 8));
  }

  /**
   * 选经纬网间隔（度）。两轴各自独立：
   *   · 经度：画布上「像素/度」是常数；
   *   · 纬度：墨卡托非线性 → 取可见范围**最靠赤道的那条边**的像素/度（那里最挤），
   *     这样整幅图里每个格子都不小于阈值，两极方向只会更疏，不会挤成一团。
   * 阈值 = 相邻标注的最小像素间距，按字号（8pt）折算，与纸面/dpi 无关：
   *   经度标注横排要容下「180°E」（约 2.5 字宽）→ 4.0 字宽；
   *   纬度标注只要上下不压住 → 2.6 字高。
   */
  function pickGraticuleIntervals(o, VW, VH, ptPx) {
    var fs = frameLabelFontPx(ptPx);
    // 画布上「每度经度 = 多少像素」= 整幅世界宽 ÷ 360（经度方向恒等距）
    var pxPerDegLng = Math.max(1e-6, (o.worldSize * o.S) / 360);
    var north = unproject(o, VW / 2, 0).y;
    var south = unproject(o, VW / 2, VH).y;
    var latRef = south <= 0 && north >= 0 ? 0 : Math.abs(south) < Math.abs(north) ? south : north;
    latRef = Math.max(-84, Math.min(84, latRef));
    var yA = latToY(clampLat(latRef), o.worldSize, 0) * o.S - o.shiftY;
    var yB = latToY(clampLat(latRef + 1), o.worldSize, 0) * o.S - o.shiftY;
    var pxPerDegLat = Math.abs(yB - yA);
    if (!(pxPerDegLat > 1e-9)) pxPerDegLat = pxPerDegLng;
    var ivLng = niceInterval(pxPerDegLng, fs * 4.0);
    var ivLat = niceInterval(pxPerDegLat, fs * 2.2);
    // 两轴尽量用同一个度数：格网是「网」，一横一竖两套刻度会让格子变成细长条。
    // 但只在**两轴都还剩得下至少 3 条线**时才统一——极端长条图（宽 3000×高 700）
    // 若强行统一，短边只剩 1~2 条纬线，等于没有格网。
    var ivMax = Math.max(ivLng, ivLat);
    if (ivMax / Math.min(ivLng, ivLat) <= 2.5) {
      var spanLng = (VW / (o.worldSize * o.S)) * 360;
      var spanLat = Math.abs(north - south);
      if (spanLng / ivMax >= 4 && spanLat / ivMax >= 4) {
        ivLng = ivMax;
        ivLat = ivMax;
      }
    }
    return { lng: ivLng, lat: ivLat };
  }  /** 把起点吸附到「step 整数倍」的格点上（收掉浮点尾巴，避免 60.00000000001 这种标注） */
  function latticeStart(v, step) {
    return Math.round(Math.ceil(v / step - 1e-9) * step * 1e6) / 1e6;
  }

  function fmtLng(v) {
    // ⚠️ 画布横向可越出 ±180（中心在 170°E 时经线会取到 190、220…）。
    //    标注必须先把经度折回 (-180,180]，与鼠标坐标控件读数一致，
    //    否则 -190 会标成「190°W」（正确应为 170°E）。
    if (isFinite(v)) {
      v = ((((v + 180) % 360) + 360) % 360) - 180; // [-180,180)
      if (v === -180) v = 180; // 180° 经线惯例不标 E/W
    }
    var a = Math.abs(v);
    if (a < 1e-6) return "0°";
    if (Math.abs(a - 180) < 1e-6) return "180°";
    return (a === Math.round(a) ? a : a.toFixed(1)) + (v > 0 ? "°E" : "°W");
  }
  function fmtLat(v) {
    var a = Math.abs(v);
    if (a < 1e-6) return "0°";
    return (a === Math.round(a) ? a : a.toFixed(1)) + (v > 0 ? "°N" : "°S");
  }

  /**
   * 画经纬网 + 边缘经纬度标注。
   *
   * ⚠️ 这里**不走 project()**：project 里的 normLng 会把 200° 折回 -160°，
   *    而画布可能覆盖一个以上世界宽度（低缩放 + 大幅面时），
   *    直接按未归一化的经度算 x 才能正确重复出多份网格。
   */
  function drawGraticule(ctx, o, W, H, scaleFactor, ivs) {
    var ivLng = ivs && ivs.lng ? ivs.lng : 10;
    var ivLat = ivs && ivs.lat ? ivs.lat : ivLng;
    var worldSize = o.worldSize;
    var S = o.S;

    function lngToX(lng) {
      return ((lng + 180) / 360) * worldSize * S - o.shiftX;
    }
    function latToYc(lat) {
      return latToY(clampLat(lat), worldSize, 0) * S - o.shiftY;
    }

    // 画布横向覆盖的经度范围
    var west = (0 + o.shiftX) / (worldSize * S) * 360 - 180;
    var east = (W + o.shiftX) / (worldSize * S) * 360 - 180;
    var north = unproject(o, W / 2, 0).y;
    var south = unproject(o, W / 2, H).y;

    var lineW = Math.max(0.5, 0.7 * Math.min(scaleFactor, 3));

    ctx.save();
    // 网格线克制一点：论文图里的经纬网是「辅助线」，不该抢底图的视觉权重
    ctx.strokeStyle = "rgba(90,90,90,0.45)";
    ctx.lineWidth = lineW;
    ctx.setLineDash([]);

    // 经线（格点 = ivLng 的整数倍，与 drawFrame 的刻度/标注同一套格点）
    var l0 = latticeStart(west, ivLng);
    for (var k = 0; ; k++) {
      var lng = l0 + k * ivLng;
      if (lng > east + 1e-9) break;
      var x = lngToX(lng);
      if (x < 0 || x > W) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    // 纬线（墨卡托在 ±85 以外已无意义）
    var b0 = latticeStart(Math.max(-84, south), ivLat);
    var latTop = Math.min(84, north);
    for (var j = 0; ; j++) {
      var lat = b0 + j * ivLat;
      if (lat > latTop + 1e-9) break;
      var y = latToYc(lat);
      if (y < 0 || y > H) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // ⚠️ 经纬度标注**不在这里画**：论文图的标注在图框**外侧**，必须画在图廓留白里。
    //    那部分在 render() 里是 clip 掉的（内容区 0..VW），所以由 drawFrame 负责。
    //    这里只返回两轴间隔，供 drawFrame 对齐刻度。
    ctx.restore();
    return { lng: ivLng, lat: ivLat };
  }

  // ========== 图廓 / 刻度 / 图外经纬度标注（论文图的关键） ==========
  /**
   * 画「图框 + 向内刻度 + 图框外经纬度标注」。
   *
   * 论文插图的标配：
   *   · 一条实线图框（外粗内细的双线是地学期刊常见变体）；
   *   · 框内侧一圈短刻度，主刻度对齐经纬网、次刻度在半格；
   *   · 经纬度写在**框外**（左/下为主，四边也常见），Times 衬线；
   *   · 刻度朝向框内，标注绝不压图。
   *
   * ⚠️ 本函数在**纸面坐标系**里画（0..W, 0..H），而经纬度换算得到的是
   *    **内容区坐标**（0..VW）—— 所以每个位置都要 + PAD 才是纸面坐标。
   *    这两套坐标搞混的典型症状：刻度整体偏移一个边距、标注跑到图里面。
   *
   * @returns {{xTicks:number,yTicks:number,intervalLng:number,intervalLat:number,labels:string}}
   */
  function drawFrame(ctx, W, H, PAD, o, VW, VH, scaleFactor, opts) {
    opts = opts || {};
    // 两轴各有自己的间隔（墨卡托下同一度数的纬度在画布上比经度更疏）
    var ivLng = Number(opts.intervalLng) || Number(opts.interval) || 10;
    var ivLat = Number(opts.intervalLat) || ivLng;
    var sf = Math.min(scaleFactor, 6);
    // 印刷单位（1pt 的像素数）；拿不到就按 96dpi 近似
    var P = Number(opts.ptPx) || sf * 1.33;
    var x0 = PAD;
    var y0 = PAD;
    var x1 = PAD + VW;
    var y1 = PAD + VH;

    function lngToXc(lng) {
      return ((lng + 180) / 360) * o.worldSize * o.S - o.shiftX;
    }
    function latToYc(lat) {
      return latToY(clampLat(lat), o.worldSize, 0) * o.S - o.shiftY;
    }

    var west = o.shiftX / (o.worldSize * o.S) * 360 - 180;
    var east = (VW + o.shiftX) / (o.worldSize * o.S) * 360 - 180;
    var north = unproject(o, VW / 2, 0).y;
    var south = unproject(o, VW / 2, VH).y;

    var xs = [];
    var l0 = latticeStart(west, ivLng);
    for (var k = 0; ; k++) {
      var lng = l0 + k * ivLng;
      if (lng > east + 1e-9) break;
      xs.push({ v: lng, p: lngToXc(lng) });
    }
    var ys = [];
    var b0 = latticeStart(Math.max(-84, south), ivLat);
    var latTop = Math.min(84, north);
    for (var j = 0; ; j++) {
      var lat = b0 + j * ivLat;
      if (lat > latTop + 1e-9) break;
      ys.push({ v: lat, p: latToYc(lat) });
    }

    ctx.save();
    ctx.setLineDash([]);
    // ① 图框：外粗内细（内线只画一半透明度，避免抢主线）
    ctx.strokeStyle = "#222";
    ctx.lineWidth = Math.max(1, 0.85 * P);
    ctx.strokeRect(x0, y0, VW, VH);
    var gi = Math.max(2, 1.5 * P);
    ctx.strokeStyle = "rgba(34,34,34,0.5)";
    ctx.lineWidth = Math.max(0.5, 0.4 * P);
    ctx.strokeRect(x0 + gi, y0 + gi, VW - 2 * gi, VH - 2 * gi);

    // ② 刻度：主刻度对齐经纬线，次刻度在每格中点（向内）
    var tickLen = Math.max(4, 2.2 * P);
    var minorLen = tickLen * 0.55;
    ctx.strokeStyle = "#222";
    ctx.lineWidth = Math.max(0.6, 0.6 * P);

    function vTick(px, len) {
      if (px <= 0.5 || px >= VW - 0.5) return;
      var x = x0 + px;
      ctx.beginPath();
      ctx.moveTo(x, y0); // 上
      ctx.lineTo(x, y0 + len);
      ctx.moveTo(x, y1); // 下
      ctx.lineTo(x, y1 - len);
      ctx.stroke();
    }
    function hTick(py, len) {
      if (py <= 0.5 || py >= VH - 0.5) return;
      var y = y0 + py;
      ctx.beginPath();
      ctx.moveTo(x0, y); // 左
      ctx.lineTo(x0 + len, y);
      ctx.moveTo(x1, y); // 右
      ctx.lineTo(x1 - len, y);
      ctx.stroke();
    }

    ctx.lineWidth = Math.max(0.4, 0.45 * P);
    // 次刻度只在「半格还看得见」时画：间隔自动选到很密时（<8px 半格）会退化成梳齿
    xs.forEach(function (t, i) {
      var prev = xs[i - 1];
      if (prev && t.p - prev.p >= 16) vTick((prev.p + t.p) / 2, minorLen);
      vTick(t.p, tickLen);
    });
    ys.forEach(function (t, i) {
      var prev = ys[i - 1];
      if (prev && Math.abs(prev.p - t.p) >= 16) hTick((prev.p + t.p) / 2, minorLen);
      hTick(t.p, tickLen);
    });

    // ③ 图框外经纬度标注
    var mode = opts.labels == null ? "all" : String(opts.labels);
    var fs = frameLabelFontPx(P); // 与 pickGraticuleIntervals 用同一字号
    ctx.font = "500 " + fs + "px " + FONT_SERIF;
    ctx.fillStyle = "#111";
    var gap = Math.max(3, 1.3 * P);
    var cornerGuard = fs * 2.8;
    // 兜底跳过：间隔已由 pickGraticuleIntervals 按字宽/像素反选（不会密），
    // 阈值取在「选中间隔的最小间距」之下 → 正常情况下 dropped 恒为 0，
    // 只在极地夹到 ±84°、跨 180° 这类边界情况下兜一下，宁可少标一个也不重叠。
    var minGapX = fs * 3.4;
    var minGapY = fs * 2.0;
    var lastX = -1e9;
    var lastY = -1e9;
    var dropX = 0;
    var dropY = 0;

    function put(text, x, y, align, baseline) {
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      // 白描边：即便纸面是深色/底图外沿不干净，也保证读得清
      ctx.lineWidth = Math.max(2, fs * 0.14);
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }

    if (mode !== "none" && PAD >= fs * 1.15) {
      var topOn = mode === "all";
      var bottomOn = mode === "all" || mode === "lb" || mode === "bottom";
      var leftOn = mode === "all" || mode === "lb" || mode === "left";
      var rightOn = mode === "all";
      xs.forEach(function (t) {
        var x = x0 + t.p;
        if (x < x0 + cornerGuard || x > x1 - cornerGuard) return;
        if (x - lastX < minGapX) {
          dropX++;
          return;
        }
        lastX = x;
        var s = fmtLng(t.v);
        if (topOn) put(s, x, y0 - gap, "center", "bottom");
        if (bottomOn) put(s, x, y1 + gap, "center", "top");
      });
      ys.forEach(function (t) {
        var y = y0 + t.p;
        if (y < y0 + cornerGuard || y > y1 - cornerGuard) return;
        // ⚠️ 纬度是**从南往北**遍历的，y 递减 → 必须用绝对值比较间距，
        //    写成 y - lastY 会让「第二个开始的每一个」都判成太密而全部跳过
        //    （症状：只有最下面一个纬度标注）。
        if (Math.abs(y - lastY) < minGapY) {
          dropY++;
          return;
        }
        lastY = y;
        var s = fmtLat(t.v);
        if (leftOn) put(s, x0 - gap, y, "right", "middle");
        if (rightOn) put(s, x1 + gap, y, "left", "middle");
      });
    }

    ctx.restore();
    return {
      xTicks: xs.length,
      yTicks: ys.length,
      interval: ivLng,
      intervalLng: ivLng,
      intervalLat: ivLat,
      labels: mode,
      dropped: dropX + dropY,
    };
  }

  /** 图注编号「(a)」：论文图左上角的小标号，白描边保证压深色底图也可读 */
  function drawFigureLabel(ctx, scaleFactor, text, ptPx) {
    if (!text) return;
    var P = Number(ptPx) || Math.min(scaleFactor, 6) * 1.33;
    var fs = Math.max(11, 11 * P); // 11pt ≈ 论文图注的标准字号
    var pad = Math.max(6, 4 * P);
    ctx.save();
    ctx.font = "600 " + fs + "px " + FONT_SERIF;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.lineWidth = Math.max(2.4, fs * 0.14);
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.strokeText(text, pad, pad);
    ctx.fillStyle = "#111";
    ctx.fillText(text, pad, pad);
    ctx.restore();
  }

  // ========== 要素标签（读屏幕上真实渲染的标签，保证与所见一致）==========
  /**
   * 从 DOM 里收集当前**真正可见**的标签：
   *   · 点要素标签 = marker pane 里的 `.station-label`（不是 `.hidden` 的那些）
   *   · 线/面要素标签 = `.leaflet-tooltip` 永久 tooltip（geojsonloader 用
   *     `_bindPermanentLabel` 绑的，className 为 feature-label）
   *
   * 为什么读 DOM 而不是从图层数据重建：
   *   ① 标签在低缩放下会被置灰隐藏（`.station-label.hidden`），
   *      只有 DOM 知道当前该不该显示 —— 读 DOM 才能「和显示的效果一样」
   *   ② 线/面标签的位置由 Leaflet 自己算（多边形取形心、线取沿线），
   *      重建等于把这些逻辑抄一遍，还抄不准
   * 坐标换算：画布与屏幕覆盖同一地理范围 ⇒ 等比线性映射，k = W / 屏宽。
   */
  function collectScreenLabels(map, W, H, maxCount) {
    var out = [];
    var container = map.getContainer();
    var size = map.getSize();
    if (!size.x || !size.y) return out;
    var cr = container.getBoundingClientRect();
    // 容器有虚线边框，clientWidth 不含边框 → 去掉边框再换算
    var bw = Math.max(0, (cr.width - size.x) / 2);
    var k = W / size.x;
    var cap = maxCount || 2000;

    function push(el, cls) {
      if (out.length >= cap) return;
      var txt = (el.textContent || "").trim();
      if (!txt) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // 容器内容坐标系（CSS px）
      var px = r.left + r.width / 2 - cr.left - bw;
      var py = r.top + r.height / 2 - cr.top - bw;
      // 画布坐标：中心对齐 + 等比缩放
      out.push({
        text: txt,
        x: W / 2 + (px - size.x / 2) * k,
        y: H / 2 + (py - size.y / 2) * k,
        cls: cls,
        fontSize: parseFloat(getComputedStyle(el).fontSize) || 10,
      });
    }

    // 点要素标签（跳过被隐藏的）
    container.querySelectorAll(".station-label").forEach(function (el) {
      if (el.classList.contains("hidden")) return;
      if (el.style.display === "none") return;
      push(el, "station");
    });
    // 线/面永久标签
    container.querySelectorAll(".leaflet-tooltip").forEach(function (el) {
      push(el, "feature");
    });

    return out;
  }

  /**
   * 把收集到的标签画到画布上（带白色光晕，压在深色底图上也能读）。
   *
   * ⚠️ 加了**避让**：屏幕上标签会互相压（Leaflet 不管），但印在论文图里就是
   *    一片糊字（实测「TianshanVolcanicGroup」「VitiazPlateau」叠在一起）。
   *    这里按绘制顺序占位，压到已有标签的整条丢弃 —— 宁可少标，不要糊。
   *    返回 { drawn, skipped }。
   */
  function drawScreenLabels(ctx, labels, W, H, scaleFactor) {
    var res = { drawn: 0, skipped: 0 };
    if (!labels || !labels.length) return res;
    var boxes = []; // [{x0,y0,x1,y1}]
    function hit(b) {
      for (var i = 0; i < boxes.length; i++) {
        var o = boxes[i];
        if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return true;
      }
      return false;
    }
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    labels.forEach(function (lb) {
      if (lb.x < -60 || lb.x > W + 60 || lb.y < -30 || lb.y > H + 30) return;
      // 字号按屏幕比例放大（画布/屏幕同地理范围 ⇒ 视觉大小一致）
      var fs = Math.max(6, lb.fontSize * scaleFactor);
      ctx.font =
        (lb.cls === "station" ? "" : "600 ") +
        fs +
        "px 'Microsoft YaHei', Arial, sans-serif";
      var tw = ctx.measureText(lb.text).width;
      var box = {
        x0: lb.x - tw / 2 - 2,
        x1: lb.x + tw / 2 + 2,
        y0: lb.y - fs * 0.65,
        y1: lb.y + fs * 0.65,
      };
      if (hit(box)) {
        res.skipped++;
        return;
      }
      boxes.push(box);
      ctx.lineWidth = Math.max(1, fs * 0.28);
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineJoin = "round";
      ctx.strokeText(lb.text, lb.x, lb.y);
      ctx.fillStyle = "#222";
      ctx.fillText(lb.text, lb.x, lb.y);
      res.drawn++;
    });
    ctx.restore();
    return res;
  }

  // ========== 装饰元素：比例尺 / 指北针 / 图例 / 标题 / 版权 ==========

  function niceScale(km) {
    // 取 1/2/5 × 10^n 中最接近目标长度的一段
    var pow = Math.pow(10, Math.floor(Math.log(km) / Math.LN10));
    var candidates = [1, 2, 5, 10].map(function (m) {
      return m * pow;
    });
    var best = candidates[0];
    var bestDiff = Infinity;
    candidates.forEach(function (c) {
      var d = Math.abs(c - km);
      if (d < bestDiff) {
        bestDiff = d;
        best = c;
      }
    });
    return best;
  }

  /**
   * 比例尺（论文样式）：
   *   · 两段黑白交替的实心条 + 端点/中点向上短刻度；
   *   · 数字写在**条上方**（0 / 中值 / 末值+单位），Times 衬线；
   *   · 白底是直角矩形，不用圆角 —— 圆角卡片在这个语境里显得像 App UI。
   */
  function drawScaleBar(ctx, w, h, metersPerPx, scaleFactor, ptPx) {
    var sf = Math.min(scaleFactor, 6);
    var P = Number(ptPx) || sf * 1.33;
    var targetM = metersPerPx * (w / 5);
    var targetKm = niceScale(targetM / 1000);
    var barPx = (targetKm * 1000) / metersPerPx;
    // 保底：至少 40px，否则数字会挤在一起
    if (barPx > w * 0.55) barPx = w * 0.55;

    var fontPx = Math.max(9, 7.5 * P);
    var pad = Math.max(7, 2.4 * P);
    var barH = Math.max(2.6, 2.6 * P); // ≈1mm 高，印刷上刚好
    var x = pad * 1.5;
    var y = h - pad * 1.5 - barH;
    var unit = "km";
    if (targetKm < 1) {
      unit = "m";
    }

    ctx.save();
    // 白底：只比内容大一点，避免大块白斑（右侧多留一点给单位）
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    var boxW = barPx + pad * 1.1 + fontPx * 1.1;
    var boxH = barH + fontPx * 1.6;
    ctx.fillRect(x - pad * 0.55, y - fontPx * 1.4, boxW, boxH);

    ctx.strokeStyle = "#111";
    ctx.lineWidth = Math.max(0.7, 0.5 * P);
    ctx.strokeRect(x, y, barPx, barH);
    ctx.fillStyle = "#111";
    ctx.fillRect(x, y, barPx / 2, barH); // 左半黑、右半白

    // 三个向上的短刻度
    var tick = Math.max(2.5, barH * 1.1);
    [0, 0.5, 1].forEach(function (t) {
      ctx.beginPath();
      ctx.moveTo(x + barPx * t, y);
      ctx.lineTo(x + barPx * t, y - tick);
      ctx.stroke();
    });

    ctx.font = "500 " + fontPx + "px " + FONT_SERIF;
    ctx.fillStyle = "#111";
    ctx.textBaseline = "bottom";
    var ty = y - tick - 1.6 * sf;
    var mid = targetKm / 2;
    var fmt = function (v) {
      return Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(1);
    };
    ctx.textAlign = "left";
    ctx.fillText("0", x, ty);
    ctx.textAlign = "center";
    ctx.fillText(fmt(targetKm < 1 ? targetKm * 1000 : mid), x + barPx / 2, ty);
    // 末值右对齐于条尾，单位单独写在条**外侧** ——
    // 写成「1000 km」右对齐会向内挤，把中点数字压得只剩一条缝。
    ctx.textAlign = "right";
    ctx.fillText(fmt(targetKm < 1 ? targetKm * 1000 : targetKm), x + barPx, ty);
    ctx.textAlign = "left";
    ctx.fillText(unit, x + barPx + fontPx * 0.22, ty);
    ctx.restore();
    return targetKm;
  }

  /**
   * 指北针（论文样式）：细双环 + 半黑半白三角指针 + 衬线 N。
   * 上一版是「实心红三角 + 圆底 + 无衬线 N」，放在论文图里像个 App 图标；
   * 学术插图基本都用手绘感的黑白指针：左半实心（阴影侧）、右半空心留白。
   */
  function drawNorthArrow(ctx, w, h, scaleFactor, ptPx) {
    var sf = Math.min(scaleFactor, 6);
    var P = Number(ptPx) || sf * 1.33;
    var size = Math.max(24, 34 * P); // 圆直径 ≈ 12mm，与论文图里的指北针同量级
    var pad = Math.max(9, 3 * P);
    var cx = w - pad - size / 2;
    var cy = pad + size / 2;
    var r = size / 2;

    ctx.save();
    // 白色圆底：压在任何底图上都可读（不透明度略高，但不至于像个白饼）
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    // 外环 + 内细环
    ctx.strokeStyle = "#222";
    ctx.lineWidth = Math.max(1, 0.7 * P);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(34,34,34,0.42)";
    ctx.lineWidth = Math.max(0.5, 0.35 * P);
    ctx.stroke();

    // 指针：上尖下宽，左半实心、右半空心（描边）
    var tipY = cy - r * 0.66;
    var botY = cy + r * 0.34;
    var notchY = cy + r * 0.14; // 底部中间的凹口，形成经典「箭头脚」
    var halfW = r * 0.24;

    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - halfW, botY);
    ctx.lineTo(cx, notchY);
    ctx.closePath();
    ctx.fillStyle = "#222";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx + halfW, botY);
    ctx.lineTo(cx, notchY);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = Math.max(0.6, 0.45 * P);
    ctx.stroke();

    // N：衬线、粗体，压在指针下方的圆内
    ctx.fillStyle = "#111";
    ctx.font = "700 " + Math.max(9, r * 0.4) + "px " + FONT_SERIF;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", cx, cy + r * 0.63);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 收集版权文案：底图 attribution + 覆盖层 + 数据源 */
  function collectAttribution(map) {
    var parts = [];
    function take(a) {
      if (!a) return;
      var s = String(a);
      if (s === "undefined" || s === "null") return;
      if (parts.indexOf(s) === -1) parts.push(s);
    }
    map.eachLayer(function (l) {
      // LayerGroup 的 attribution 挂在组上（ArcGIS-海洋 就是这样）
      if (l.options) take(l.options.attribution);
    });
    return parts;
  }

  /**
   * 图例（论文样式）：直角白底卡片 + 细边 + 标题下分隔线 + 对齐的符号列。
   * 上一版是圆角卡片 + 无衬线字，配色可以但「像 App」；论文图例的特征是
   * 直角、细线、符号左右严格对齐、字用衬线（中文落宋体）。
   * startY：起始 y（标题下方），避免与图标题压在一起。
   */
  function drawLegend(ctx, w, h, scaleFactor, opts) {
    var items = [];
    try {
      if (typeof window._buildLegendData === "function") {
        items = window._buildLegendData() || [];
      }
    } catch (e) {
      items = [];
    }
    if (!items.length) return false;
    if (opts.filter) {
      items = items.filter(function (it) {
        return opts.filter(it);
      });
    }
    if (!items.length) return false;
    if (opts.maxItems && items.length > opts.maxItems) {
      items = items.slice(0, opts.maxItems);
    }

    var sf = Math.min(scaleFactor, 6);
    var P = Number(opts.ptPx) || sf * 1.33;
    var fontPx = Math.max(9, 8 * P);
    var titlePx = Math.max(10, 8.5 * P);
    var symW = fontPx * 1.8;
    var rowH = fontPx * 1.55;
    var pad = Math.max(6, 2 * P);

    // 先量文本宽度
    ctx.save();
    ctx.font = "500 " + fontPx + "px " + FONT_SERIF;
    var maxText = 0;
    items.forEach(function (it) {
      var t = measure(ctx, String(it.name || ""));
      if (t > maxText) maxText = t;
    });
    var titleW = 0;
    ctx.font = "600 " + titlePx + "px " + FONT_SERIF;
    if (opts.legendTitle) titleW = measure(ctx, opts.legendTitle);
    ctx.restore();

    var boxW = Math.max(maxText + symW + pad, titleW) + pad * 2;
    var headH = opts.legendTitle ? titlePx + pad * 0.85 : 0;
    var boxH = headH + items.length * rowH + pad * 1.1;
    // 从内容区左上角缩进一点：贴死图框会显得局促（论文图例通常留 2~3mm）
    var x = pad * 1.8;
    var y = Math.max(pad * 1.8, opts.startY || 0);

    ctx.save();
    // 直角白底（不透明度高一点，保证图例本身可读）
    ctx.fillStyle = "rgba(255,255,255,0.93)";
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = Math.max(0.6, 0.5 * P);
    ctx.strokeRect(x, y, boxW, boxH);

    var cy = y + pad * 0.55;
    if (opts.legendTitle) {
      ctx.fillStyle = "#111";
      ctx.font = "600 " + titlePx + "px " + FONT_SERIF;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(opts.legendTitle, x + pad, cy);
      cy += titlePx + pad * 0.55;
      // 标题下的细分隔线：论文图例的标志性细节
      ctx.beginPath();
      ctx.moveTo(x, cy - pad * 0.28);
      ctx.lineTo(x + boxW, cy - pad * 0.28);
      ctx.strokeStyle = "rgba(34,34,34,0.45)";
      ctx.lineWidth = Math.max(0.4, 0.32 * P);
      ctx.stroke();
    }

    items.forEach(function (it) {
      var gx = x + pad;
      var gy = cy + rowH / 2;
      var color = it.color || "#888";
      var gt = it.geomType || "polygon";

      if (gt === "point") {
        ctx.beginPath();
        ctx.arc(gx + symW * 0.4, gy, Math.max(2, fontPx * 0.27), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = Math.max(0.6, 0.5 * P);
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        ctx.lineWidth = Math.max(0.4, 0.32 * P);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.stroke();
      } else if (gt === "line") {
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + symW * 0.8, gy);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.3, 1.8 * sf);
        ctx.stroke();
      } else {
        var bw = symW * 0.8;
        var bh = fontPx * 0.78;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(gx, gy - bh / 2, bw, bh);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.6, 0.5 * P);
        ctx.strokeRect(gx, gy - bh / 2, bw, bh);
      }

      ctx.fillStyle = "#111";
      ctx.font = "500 " + fontPx + "px " + FONT_SERIF;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(it.name || ""), gx + symW, gy);
      cy += rowH;
    });
    ctx.restore();
    return true;
  }

  function measure(ctx, text) {
    return ctx.measureText(text).width;
  }

  function drawAttribution(ctx, w, h, scaleFactor, attributions, ptPx) {
    if (!attributions || !attributions.length) return;
    // 版权署名用小号衬线字：论文图里它本来就该最弱
    var P = Number(ptPx) || Math.min(scaleFactor, 6) * 1.33;
    var fontPx = Math.max(7, 6 * P);
    ctx.save();
    ctx.font = "400 " + fontPx + "px " + FONT_SERIF;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    // 半透明底板：论文印刷时叠加在深色底图上也要能读
    var maxW = 0;
    var lineH = fontPx * 1.25;
    attributions.forEach(function (a) {
      var t = stripHtml(a);
      var ww = measure(ctx, t);
      if (ww > maxW) maxW = ww;
    });
    var pad = fontPx * 0.6;
    var boxH = attributions.length * lineH + pad * 1.6;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(w - maxW - pad * 2.4, h - boxH, maxW + pad * 2.4, boxH);
    var ty = h - pad * 0.8;
    ctx.fillStyle = "#333";
    attributions.forEach(function (a) {
      ctx.fillText(stripHtml(a), w - pad * 1.2, ty);
      ty -= lineH;
    });
    ctx.restore();
  }

  function stripHtml(s) {
    return String(s)
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** 画图标题，返回占用的高度（0 = 没画）——图例据此下移，避免重叠。
   *  offsetX：图注编号「(a)」占位时标题右移，两者不叠。 */
  function drawTitle(ctx, w, scaleFactor, title, subtitle, offsetX, ptPx) {
    if (!title) return 0;
    var sf = Math.min(scaleFactor, 6);
    var P = Number(ptPx) || sf * 1.33;
    var fontPx = Math.max(12, 11 * P);
    var subPx = Math.max(9, 8 * P);
    var pad = Math.max(7, 2.2 * P);
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    var x = pad + (offsetX || 0);
    var y = pad;
    // 白描边（比 shadow 更干净：阴影在大字号下会糊成灰边）
    function out(text, font, yy) {
      ctx.font = font;
      ctx.lineWidth = Math.max(2.4, 3.2 * sf);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.strokeText(text, x, yy);
      ctx.fillStyle = "#111";
      ctx.fillText(text, x, yy);
    }
    out(title, "600 " + fontPx + "px " + FONT_SERIF, y);
    var used = fontPx * 1.25;
    if (subtitle) {
      out(subtitle, "400 " + subPx + "px " + FONT_SERIF, y + fontPx * 1.2);
      used = fontPx * 1.2 + subPx * 1.35;
    }
    ctx.restore();
    return used + pad;
  }

  // ========== 主渲染流程 ==========

  /**
   * @param {Object} opts
   *   width, height   目标像素尺寸
   *   zoom            目标 zoom（可 > 当前地图 zoom）
   *   includeBase     是否含底图
   *   includeVectors  是否含矢量要素
   *   includeOverlays 是否含覆盖层（境界线/标注）
   *   baseOpacity     底图透明度 0~1
   *   vectorOpacity   矢量透明度 0~1
   *   background      背景色（默认 #fff，论文图不要透明底）
   *   legend / scaleBar / northArrow / title / subtitle  装饰开关
   *   legendTitle / legendFilter / legendMaxItems
   *   format          'png' | 'jpeg'
   *   quality         jpeg 质量
   *   scaleFactor     线宽/字号缩放（默认按宽度自适应）
   */
  /**
   * 尺寸/分辨率模型（2026-10-06 重做）
   *
   * 之前踩的坑：把 width/height 当「像素数」自由填，结果调大只等于把整幅图
   * 拉伸模糊，**并没有提升地面分辨率** —— 真正决定清晰度的是 zoom。
   * 所以改成：**用户只关心「纸面尺寸(mm/in) + dpi」，zoom 由引擎反算**。
   *
   *   zoomNeeded = zoomFloat(纸面尺寸 → 世界像素)   ← 保证地面真实分辨率
   *   zoomTile   = floor(zoomNeeded)                ← 瓦片服务只认整数级
   *   底图/矢量全部画在「虚构的高清坐标系」里，最后整体乘以
   *   2^(zoomFloat - zoomTile) 缩到目标画布 → 清晰度与要求一致。
   *
   * 这样「dpi 从 96→600」或「纸面从 85mm→247mm」都会真的变清晰，
   * 而不是把同一张瓦片放大。
   */
  function render(opts) {
    var map = window.map;
    if (!map) return Promise.reject(new Error("地图未就绪"));

    opts = opts || {};
    // 支持两种传法：width/height（像素，老用法）或 paper/MM 系列（新用法）
    var dpi = Number(opts.dpi || 96);
    var W = opts.width
      ? Math.max(64, Math.round(opts.width))
      : Math.max(64, Math.round((Number(opts.paperWidthMm || 170) / 25.4) * dpi));
    var H = opts.height
      ? Math.max(64, Math.round(opts.height))
      : Math.max(64, Math.round((Number(opts.paperHeightMm || 110) / 25.4) * dpi));

    var center = map.getCenter();
    var zoomNow = map.getZoom();
    var desc = describeBasemap(map);

    // ---- 图廓留白（2026-10-17）----
    // 论文图的经纬度标注、刻度都在**图框外**，所以地图内容必须从纸面边缘缩进来。
    // PAD 之内画图廓与标注，PAD 之外不画任何内容（clip 掉）。
    // ⚠️ 视图尺寸 VW/VH 才是「地图内容区」：zoom 反算、shiftX/Y、scaleFactor、
    //    frame 全部必须用 VW/VH。混用纸面 W/H 会让构图跑偏（等于白留了一圈边）。
    var frameOn = opts.frame !== false;
    var sx0 = map.getSize().x || W;
    // 装饰的「印刷单位」基准：1pt = dpi/72 画布像素（详见下文 ptPx 的说明）
    // ⚠️ 用**有效 dpi**（画布像素 ÷ 纸面英寸），不是声明 dpi：
    //    预览缩略图是「同样的纸面、更少的像素」（170mm → 322px = 48dpi），
    //    若按声明值 300dpi 算，8pt 的字在 322px 图上会占 10% 宽（实测图例把半张图盖满）。
    //    按有效 dpi 算，缩略图与大图是**严格等比**，预览才可信。
    var _mmW = Number(opts.paperWidthMm) || 0;
    var effDpi = _mmW > 0 ? W / (_mmW / 25.4) : Number(dpi) || 96;
    var ptPx = effDpi / 72;
    // 留白必须按 **pt** 算：经纬度标注是 8pt，1200dpi 时那是 133px 高的字，
    // 用「W 的百分之几」定留白会在高 dpi 下直接放不下（字被裁掉一半）。
    // 宽度要能容下最长的纬度标注「25°N」（4 个字符 ≈ 3.4em），否则左右标注会被纸边裁掉。
    var PAD = frameOn
      ? Math.round(Math.max(14, Math.min(W * 0.12, 8 * ptPx * 3.6), frameLabelFontPx(ptPx) * 3.2))
      : 0;
    var VW = W - PAD * 2;
    var VH = H - PAD * 2;
    if (VW < 120 || VH < 90) {
      // 纸面太小：把留白压到 4%，保住内容区
      PAD = frameOn ? Math.max(6, Math.round(Math.min(W, H) * 0.04)) : 0;
      VW = W - PAD * 2;
      VH = H - PAD * 2;
    }

    // 服务原生上限：超过它只能拿放大过的低清瓦片，反算时会触发提醒
    var capZ =
      desc && desc.maxNativeZoom
        ? desc.maxNativeZoom
        : desc && desc.labelMaxNativeZoom
          ? desc.labelMaxNativeZoom
          : null;

    // ---- 反算需要的完美 zoom ----
    // 视野中心经度所在的「可见宽度」按屏幕宽推算（就地取材，够精确）：
    // 屏幕现在用 zoomNow 展示 n 米宽，出图要覆盖同样地理范围的 W 像素。
    var zoomNeeded = opts.zoom != null ? opts.zoom : zoomNow + Math.log2(VW / sx0);

    // ---- 构图护栏①：横向最多覆盖 maxWorlds 圈世界 ----
    // 为什么会超：地图缩到很小时，屏幕本身就铺着好几个「世界副本」（WorldWrap），
    // 出图按「覆盖 = 屏幕视野」一比一照抄 → 一张论文图里并排印着 2~3 个地球，
    // 标签还会跟名字一起重复（实测：欧亚图里出现了两个 Crebus 标签）。
    // 这里把 zoom 抬到「世界宽 ≈ 画布宽 × maxWorlds」，从根上不产生副本；
    // 同时世界高也 ≤ 画布高，上下那条**超出 ±85° 的白带**跟着一起消失。
    // 只在「视野真的超过一圈」时生效，正常出图完全不受影响（不变量仍成立）。
    // maxWorlds=0 → 关掉护栏，完全按屏幕视野出。
    var maxWorlds = opts.maxWorlds == null ? 1 : Number(opts.maxWorlds);
    var zoomFloorWorlds = null;
    var clampedByWorlds = false;
    if (opts.zoom == null && maxWorlds > 0) {
      zoomFloorWorlds = Math.log2(VW / (TILE * maxWorlds));
      if (zoomNeeded < zoomFloorWorlds - 1e-6) {
        zoomNeeded = zoomFloorWorlds;
        clampedByWorlds = true;
      }
    }

    var zoomTile = Math.floor(zoomNeeded);
    zoomTile = Math.max(0, Math.min(22, zoomTile));
    var zoomFloat = Math.floor(zoomNeeded); // 整数瓦片级
    var upscale = Math.pow(2, zoomNeeded - zoomFloat); // 1..2 之间的残余精度

    if (capZ != null && zoomTile > capZ) {
      zoomTile = capZ;
      zoomNeeded = capZ;
      upscale = 1;
    }

    // ---- 统一坐标系（2026-10-06 重做） ----
    // ⚠️ 之前踩的大坑：project() 用的是「瓦片级世界坐标」（不含 upscale），
    //    而 drawXYZ 贴瓦片用的是 `col×TILE×upscale`（含 upscale）。
    //    两者只有在 upscale === 1 时才碰巧一致 —— 也就是**显式传整数 zoom**
    //    时正常；一旦走引擎的 zoom 反算（upscale 必为 1~2 的小数），
    //    底图与矢量就按不同比例摆放 → 跨 180° 处错位 + 密集条纹。
    //
    //    现在定义唯一口径：**画布坐标系** = 瓦片级世界像素 × S
    //      S = upscale（画布像素 / 瓦片像素）
    //      worldW = 画布上的世界宽度
    //    project / 底图 / WMS / 影像 / 矢量全部只用这一套。
    var worldSize = TILE * Math.pow(2, zoomTile); // 瓦片级世界宽（瓦片像素）
    var S = upscale; // 画布像素 ÷ 瓦片像素
    var worldW = worldSize * S; // 画布上的世界宽度
    var originX = lonToX(normLng(center.lng), worldSize, 0) * S;
    var originY = latToY(clampLat(center.lat), worldSize, 0) * S;
    var shiftX = originX - VW / 2;
    var shiftY = originY - VH / 2;

    function project(latlng) {
      // normLng 归一化后再 ×S，与底图瓦片同一坐标系；
      // 跨 180° 的要素由 drawVectors 的 unwrap + 多副本平移补齐
      return {
        x: lonToX(normLng(latlng.lng), worldSize, 0) * S - shiftX,
        y: latToY(clampLat(latlng.lat), worldSize, 0) * S - shiftY,
      };
    }

    // 地面每画布像素的米数。
    // ⚠️ 是 **÷ S**。1 瓦片像素 = 156543.03·cos(lat)/2^zoomTile 米，
    //    1 画布像素 = 1/S 瓦片像素 → 要除以 S。
    //    之前写成 ×upscale（方向反了），upscale≠1 时比例尺就是错的。
    var metersPerPx =
      (156543.03392804097 * Math.cos((clampLat(center.lat) * Math.PI) / 180)) /
      Math.pow(2, zoomTile) /
      S;

    // 线宽/字号/点半径缩放：屏幕 CSS 像素 → 画布像素。
    // 画布与屏幕覆盖**同一地理范围**，宽度比就是缩放比（与 S 无关）。
    // 之前用 upscale 会画得比屏幕上粗一倍左右。
    // ⚠️ 用视图宽 VW（不是纸面宽 W）：加了图廓留白后，内容区才是与屏幕同范围的区域。
    var scaleFactor = opts.scaleFactor || VW / sx0;


    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");

    var bg = opts.background || "#ffffff";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 底图 / 覆盖层 / WMS / 影像共用上下文
    var o = {
      zoom: zoomTile,
      worldSize: worldSize, // 瓦片级世界宽
      S: S, // 画布像素 ÷ 瓦片像素
      worldW: worldW, // 画布上的世界宽度
      shiftX: shiftX,
      shiftY: shiftY,
    };

    // 内容区坐标系：整体平移到图廓内侧，并把溢出裁掉。
    // 为什么必须裁：底图瓦片、WMS 影像、屏幕标签换算后都可能落在 0..VW 之外，
    // 不裁就会糊到图廓的留白里（纸上表现为「边上有半截地图」）。
    ctx.save();
    if (PAD > 0) {
      ctx.translate(PAD, PAD);
      ctx.beginPath();
      ctx.rect(0, 0, VW, VH);
      ctx.clip();
    }

    var report = {
      width: W,
      height: H,
      zoom: zoomTile,
      zoomNeeded: zoomNeeded,
      dpi: dpi,
      metersPerPx: metersPerPx,
      // 出图覆盖的真实地理范围（画布四角反算）。
      // 既是给用户的「这张图到底盖了多大地方」，也是自动化验收的锚点：
      // 横向范围应与 map.getBounds() 的 west/east 一致
      // （因为 zoomNeeded 就是按「覆盖屏幕同一地面宽度」反算的）。
      frame: {
        west: unproject(o, 0, VH / 2).x,
        east: unproject(o, VW, VH / 2).x,
        north: unproject(o, VW / 2, 0).y,
        south: unproject(o, VW / 2, VH).y,
      },
      capped: capZ != null && zoomNow + Math.log2(W / map.getSize().x) > capZ,
      base: null,
      overlays: null,
      vectors: 0,
      vectorParts: null,
      legend: false,
      labels: 0,
      graticuleIntervalDeg: null,
      scaleBarKm: null,
      attributions: [],
      warnings: [],
    };

    // ---- 构图护栏②：把「画面为什么长这样」说清楚 ----
    // 这两个是出图最常见的两种「看起来坏了」，本质都是视野/纸面比例问题，
    // 不提示的话用户只会反复重出同一张错图。
    var spanLng = report.frame.east - report.frame.west;
    if (clampedByWorlds) {
      report.worldClamped = true;
      report.warnings.push(
        "视野比一圈地球还宽，已自动放大到「整幅世界刚好铺满纸宽」，避免画面重复世界副本" +
          "（想保留屏幕原样就把 maxWorlds 设为 0）",
      );
    } else if (spanLng > 360.5) {
      report.warnings.push(
        "当前视野横向跨度 " +
          Math.round(spanLng) +
          "°（超过一圈地球）→ 画面会出现重复的世界副本；建议先放大地图，或把纸面比例调成接近屏幕",
      );
    }
    if (report.frame.north > 85.06 || report.frame.south < -85.06) {
      report.warnings.push(
        "视野超出墨卡托可表示的 ±85.05°，画面上下会留出空白带；" +
          "把纸面高度调矮（或让纸高跟随地图比例）即可填满",
      );
    }
    if (opts.includeBase !== false && !desc) {
      report.warnings.push(
        "当前是「无底图」，只画矢量要素；想带底图请先在底图控件里选一张",
      );
    }

    var steps = [];
    var onProgress = function (p) {
      if (opts.onProgress) opts.onProgress(p);
    };

    // ---- 经纬网间隔：一次算好，网格线 / 图框刻度 / 图外标注共用 ----
    // 必须在 steps 之前算：drawGraticule 与 drawFrame 各画一半，间隔不一致就会
    // 出现「网格比标注密一档」的散乱感（也正是 2026-10-18 报的问题之一）。
    var gratIvs = pickGraticuleIntervals(o, VW, VH, ptPx);
    report.graticuleIntervalDeg = { lng: gratIvs.lng, lat: gratIvs.lat };

    // ---- 1. 底图 ----
    if (opts.includeBase !== false && desc) {
      steps.push(function () {
        if (desc.kind === "xyz") {
          return drawXYZ(ctx, desc, o, VW, VH, opts.baseOpacity, onProgress)
            .then(function (r) {
              report.base = r;
              // ⚠️ 底图没画上是最容易被误判成「出图坏了」的情况，必须明说。
              //    实测：OSM 12/12 全失败、Esri 历史影像没有静态瓦片地址（skipped），
              //    两者以前都只留一句空 warnings，用户只看到一张白底图。
              if (r.skipped) {
                report.warnings.push(
                  "「" + desc.name + "」没有可静态请求的瓦片地址（动态服务），本次出图不含这张底图",
                );
              } else if (r.total && !r.ok) {
                report.warnings.push(
                  "底图「" + desc.name + "」的 " + r.fail + "/" + r.total +
                    " 张瓦片全部加载失败（跨域/防盗链/网络），画面里没有底图",
                );
              } else if (r.total && r.fail >= r.total * 0.3) {
                report.warnings.push(
                  "底图「" + desc.name + "」有 " + r.fail + "/" + r.total + " 张瓦片没取到，画面可能残缺",
                );
              }
              if (report.capped)
                report.warnings.push(
                  "底图原生最高 " + capZ + " 级，超出部分由引擎放大，清晰度略降",
                );
              // ArcGIS 等「底图 + 注记层」结构：注记层要叠在同一底图上
              if (desc.labelUrl) {
                return drawXYZ(
                  ctx,
                  {
                    kind: "xyz",
                    url: desc.labelUrl,
                    maxNativeZoom: desc.labelMaxNativeZoom,
                    subdomains: desc.subdomains,
                  },
                  o,
                  VW,
                  VH,
                  opts.baseOpacity,
                  null,
                ).then(function (r2) {
                  report.label = r2;
                });
              }
            });
        }
        if (desc.kind === "wms") {
          return drawWMS(ctx, desc, o, VW, VH, opts.baseOpacity, onProgress).then(function (r) {
            report.base = r;
            if (r.usedScreenTiles)
              report.warnings.push(
                "WMS 服务响应慢，已改用屏幕已加载瓦片拼图（分辨率等同当前视图）",
              );
            if (r.wmsFailed) {
              report.warnings.push("WMS 底图请求失败或超时：" + (r.wmsErr || "未知原因"));
              console.warn("[MapExport] WMS 失败 URL:", r.wmsUrl);
            }
          });
        }
        return drawImageOverlay(ctx, desc, o, VW, VH, opts.baseOpacity, center.lng).then(function (r) {
          report.base = r;
          if (!r.ok) {
            report.warnings.push(
              "「" + desc.name + "」的影像图整幅加载失败（" + (r.err || "未知原因") + "），画面里没有底图",
            );
          }
        });
      });
    }

    // ---- 2. 覆盖层（境界线 / 标注）----
    if (opts.includeOverlays) {
      steps.push(function () {
        var ovs = describeOverlays(map, desc);
        var jobs = ovs.map(function (od) {
          if (od.kind === "xyz")
            return drawXYZ(
              ctx,
              od,
              o,
              VW,
              VH,
              opts.baseOpacity == null ? od.opacity : opts.baseOpacity,
              null,
            );
          return drawImageOverlay(ctx, od, o, VW, VH, od.opacity, center.lng);
        });
        return Promise.all(jobs).then(function (rs) {
          report.overlays = {
            count: ovs.length,
            ok: rs.filter(function (r) {
              return r.ok;
            }).length,
          };
        });
      });
    }

    // ---- 3. 经纬网（在矢量之下，与屏幕层级一致）----
    if (opts.graticule) {
      steps.push(function () {
        drawGraticule(ctx, o, VW, VH, scaleFactor, gratIvs);
      });
    }

    // ---- 4. 矢量要素 ----
    if (opts.includeVectors !== false) {
      steps.push(function () {
        onProgress(0.85);
        // worldW = 该瓦片级下「一整圈世界」在画布上的像素宽，
        // 跨 180° 环绕全靠它做平移单位
        var data = collectVectorPaths(map);
        data.markers.forEach(function (mk) {
          mk._iconDesc = describeMarker(mk, map);
        });
        // 图标是异步资源：先全部就位再画，否则 getIcon 还没回来就只剩兜底小圆点
        return preloadIcons(
          data.markers.map(function (mk) {
            return mk._iconDesc;
          }),
        ).then(function (iconCache) {
          var parts = {
            paths: data.paths.length,
            markers: data.markers.length,
            icons: 0,
            points: 0,
          };
          data.markers.forEach(function (mk) {
            if (mk._iconDesc && iconCache[mk._iconDesc.url]) parts.icons++;
          });
          data.pointLayers.forEach(function (l) {
            parts.points += (l._features || []).length;
          });
          report.vectorParts = parts;
          report.vectors = drawVectors(
            ctx,
            project,
            scaleFactor,
            opts.vectorOpacity,
            o.worldW,
            VW,
            VH,
            data,
            iconCache,
            VW / sx0,
          );
        });
      });
    }

    // ---- 5. 要素标签（在矢量之上）----
    // 标签数 = 屏幕上真实可见的标签数；点图层上万时 DOM 本来也没那么多，
    // 但仍加个上限兜底，避免极端情况下卡死。
    if (opts.labels) {
      steps.push(function () {
        onProgress(0.9);
        var labels = collectScreenLabels(map, VW, VH, opts.maxLabels || 2000);
        var lbRes = drawScreenLabels(ctx, labels, VW, VH, scaleFactor);
        report.labels = lbRes.drawn;
        report.labelsSkipped = lbRes.skipped;
        // 标签是「照搬屏幕」的：屏幕上没开标签开关时，这里自然是 0 条。
        // 不提示的话用户会以为出图坏了 —— 明确告诉他去哪开。
        if (report.labels === 0) {
          report.warnings.push(
            "图上没有要素标签（标签跟随屏幕显示，请在「设置 → 标签」里打开后再出图）",
          );
        }
      });
    }

    // ---- 6. 装饰 ----
    steps.push(function () {
      onProgress(0.92);
      // 图注「(a)」：论文图左上角那个小标号，独立于标题
      if (opts.figureLabel) drawFigureLabel(ctx, scaleFactor, opts.figureLabel, ptPx);
      // 标题先画，返回占用高度 → 图例下移，两者不重叠
      var titleH = 0;
      if (opts.title) {
        titleH = drawTitle(
          ctx,
          VW,
          scaleFactor,
          opts.title,
          opts.subtitle,
          opts.figureLabel ? 11 * ptPx * 1.25 : 0,
          ptPx,
        );
      }
      if (opts.scaleBar) {
        report.scaleBarKm = drawScaleBar(ctx, VW, VH, metersPerPx, scaleFactor, ptPx);
      }
      if (opts.northArrow) drawNorthArrow(ctx, VW, VH, scaleFactor, ptPx);
      if (opts.legend) {
        report.legend = drawLegend(ctx, VW, VH, scaleFactor, {
          legendTitle: opts.legendTitle,
          filter: opts.legendFilter,
          maxItems: opts.legendMaxItems,
          startY: Math.max(titleH, opts.figureLabel ? 16 * ptPx : 0) || undefined,
          ptPx: ptPx,
        });
        if (!report.legend) report.warnings.push("当前没有可入图的矢量图层（图例为空）");
      }
      // 版权署名：按服务条款应保留，但可由用户在 UI 里关闭
      // （已关闭时在图注/正文自行标注来源）
      if (opts.attribution) {
        report.attributions = collectAttribution(map);
        drawAttribution(ctx, VW, VH, scaleFactor, report.attributions, ptPx);
      }
      onProgress(1);
    });

    // ---- 7. 图廓 + 刻度 + 经纬度标注 ----
    // 画在留白里，所以必须先退出内容区的 translate+clip（第 6 步之前 save 的那一层）。
    steps.push(function () {
      ctx.restore();
      if (!frameOn) return;
      report.frameTicks = drawFrame(ctx, W, H, PAD, o, VW, VH, scaleFactor, {
        intervalLng: gratIvs.lng,
        intervalLat: gratIvs.lat,
        labels: opts.frameLabels == null ? "all" : opts.frameLabels,
        ptPx: ptPx,
      });
    });

    return steps
      .reduce(function (p, fn) {
        return p.then(fn);
      }, Promise.resolve())
      .then(function () {
        return { canvas: canvas, report: report };
      });
  }

  // ========== 输出 ==========
  function toBlob(canvas, format, quality) {
    return new Promise(function (resolve, reject) {
      var mime = format === "jpeg" ? "image/jpeg" : "image/png";
      canvas.toBlob(
        function (b) {
          if (b) resolve(b);
          else
            reject(
              new Error(
                "画布导出失败（可能被跨域资源污染）",
              ),
            );
        },
        mime,
        format === "jpeg" ? quality || 0.92 : undefined,
      );
    });
  }

  function download(canvas, opts) {
    var format = opts.format || "png";
    var ext = format === "jpeg" ? "jpg" : "png";
    return toBlob(canvas, format, opts.quality).then(function (blob) {
      var now = new Date();
      var ts =
        String(now.getHours()).padStart(2, "0") +
        String(now.getMinutes()).padStart(2, "0") +
        String(now.getSeconds()).padStart(2, "0");
      var name = (opts.filename || "OGV_map") + "_" + ts + "." + ext;
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 稍后再 revoke：部分浏览器下载需要 URL 存活一会儿
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 4000);
      return { name: name, size: blob.size };
    });
  }

  /** 出图前先把地图瓦片等齐（旧实现最大的问题） */
  function prepare(timeout) {
    var map = window.map;
    if (!map) return Promise.resolve({ ok: false, waited: 0 });
    return waitForMapReady(map, timeout);
  }

  window.MapExport = {
    render: render,
    download: download,
    toBlob: toBlob,
    prepare: prepare,
    describeBasemap: describeBasemap,
    computeOrigin: computeOrigin,
    // 供 UI 做「物理尺寸 ↔ 像素」换算
    metersPerPixel: function (lat, zoom) {
      return (
        (156543.03392804097 * Math.cos((clampLat(lat) * Math.PI) / 180)) /
        Math.pow(2, zoom)
      );
    },
    open: null, // 由 map-export-ui.js 挂载
    close: null,
    isOpen: function () {
      return false;
    },
  };
})();
