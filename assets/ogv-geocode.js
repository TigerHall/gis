/*!
 * ogv-geocode.js —— 地名检索 / 逆地理编码（天地图）全站唯一出口
 * =============================================================================
 * 为什么单独成模块：
 *   · 站点自带矢量数据只能回答「我有的图层里有没有这个名」；用户查「舟山」
 *     「东京湾」这类地名时，矢量里 99% 没有 → 以前只能给一句「无匹配结果」。
 *   · 天地图地名服务正好补这一层，且 token 已经在 geo-config 的
 *     SITE_CONFIG.tiandituToken 里（basemap-manager 会暴露成 window.TDT_TK）。
 *   · 搜索框、AI 助手、以及以后任何「按名字找地方」的入口都走这一份实现，
 *     避免三处各写一遍 URL 与字段解析。
 *
 * 提供：
 *   OGVGeo.ready()                       → 是否已配置 token
 *   OGVGeo.search(keyword, opts)         → Promise<{items:[{name,lat,lng,address,type,level}], source, error?}>
 *   OGVGeo.reverse(lat, lng)             → Promise<{ok,name,address,lat,lng,pois}>
 *   OGVGeo.clearCache()
 *
 * ⚠️ 天地图这个 key 是「浏览器端」权限类型：请求必须由页面发出（带 Origin/Referer），
 *    服务端 curl 直接访问会返回 301012「权限类型错误」。所以不要在 Node 脚本里调它。
 * ⚠️ 返回坐标是 **CGCS2000 / WGS-84 近似**（天地图 lonlat 与 Leaflet 底图同系），
 *    不要拿 GCJ-02 的纠偏逻辑去套，否则会偏 300~500m。
 * =============================================================================
 */
(function (global) {
  "use strict";

  var SEARCH_URL = "https://api.tianditu.gov.cn/v2/search";
  var GEOCODE_URL = "https://api.tianditu.gov.cn/geocoder";
  var TIMEOUT = 9000;

  // 简单 LRU：地名查询重复率很高（同一个「南海」会被搜索框、AI、出图反复问）
  var CACHE_MAX = 60;
  var _cacheS = {};
  var _cacheSKeys = [];
  var _cacheR = {};

  function _tk() {
    var tk = global.TDT_TK || "";
    if (!tk && global.SITE_CONFIG && global.SITE_CONFIG.tiandituToken) {
      tk = global.SITE_CONFIG.tiandituToken;
    }
    return String(tk || "");
  }

  function ready() {
    return !!_tk();
  }

  function _fetchJSON(url) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, TIMEOUT);
    return fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) {
        return r.json();
      })
      .finally(function () {
        clearTimeout(timer);
      });
  }

  /** lonlat "116.3,39.9" → {lat,lng}（天地图是「经度,纬度」） */
  function _parseLonLat(s) {
    var a = String(s || "").split(",");
    if (a.length < 2) return null;
    var lng = parseFloat(a[0]);
    var lat = parseFloat(a[1]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  function _normItem(raw) {
    if (!raw) return null;
    var ll = _parseLonLat(raw.lonlat);
    if (!ll) return null;
    return {
      name: String(raw.name || "").trim(),
      address: String(raw.address || "").trim(),
      level: raw.level || raw.poiType || "",
      type: raw.poiType != null ? String(raw.poiType) : "",
      lat: ll.lat,
      lng: ll.lng,
      source: "天地图",
    };
  }

  function _dedupe(items) {
    var seen = {};
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.name) continue;
      var k = it.name + "@" + it.lat.toFixed(3) + "," + it.lng.toFixed(3);
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(it);
    }
    return out;
  }

  function _cachePut(q, val) {
    if (!_cacheS[q]) {
      _cacheSKeys.push(q);
      if (_cacheSKeys.length > CACHE_MAX) {
        var old = _cacheSKeys.shift();
        delete _cacheS[old];
      }
    }
    _cacheS[q] = val;
  }

  /**
   * 地名检索。
   * @param keyword 关键字（中文/英文地名、POI 均可）
   * @param opts {count, bound:[w,s,e,n], level}
   * @returns Promise<{ok, items, source, error?}> —— 永不 reject（调用方不必写 catch）
   */
  function search(keyword, opts) {
    opts = opts || {};
    var q = String(keyword || "").trim();
    if (!q) return Promise.resolve({ ok: true, items: [], source: "empty" });
    if (_cacheS[q]) return Promise.resolve(_cacheS[q]);

    var tk = _tk();
    if (!tk) {
      return Promise.resolve({ ok: false, items: [], source: "none", error: "未配置天地图 token" });
    }

    var count = Math.min(30, Math.max(1, Number(opts.count) || 12));
    // mapBound 越界（地图在世界副本态下 getBounds() 会给 -190/380 这种值）
    // 天地图直接 400，一条都不返回 —— 这里统一钳到合法范围
    var bound = opts.bound || [-180, -90, 180, 90];
    var w = Math.max(-180, Number(bound[0]));
    var s = Math.max(-90, Number(bound[1]));
    var e = Math.min(180, Number(bound[2]));
    var n = Math.min(90, Number(bound[3]));
    if (!(e > w) || !(n > s)) {
      bound = [-180, -90, 180, 90];
    } else {
      bound = [w, s, e, n];
    }

    function once(queryType) {
      var postStr = JSON.stringify({
        keyWord: q,
        queryType: queryType,
        mapBound: bound.join(","),
        level: Number(opts.level) || 12,
        start: 0,
        count: count,
      });
      var url =
        SEARCH_URL +
        "?postStr=" +
        encodeURIComponent(postStr) +
        "&type=query&tk=" +
        encodeURIComponent(tk);
      return _fetchJSON(url).then(function (data) {
        var items = [];
        // 地名/行政区命中在 areas，POI 命中在 pois —— 两类都收
        (data && data.areas ? data.areas : []).forEach(function (a) {
          var it = _normItem(a);
          if (it) items.push(it);
        });
        (data && data.pois ? data.pois : []).forEach(function (p) {
          var it = _normItem(p);
          if (it) items.push(it);
        });
        return items;
      });
    }

    // queryType 7 = 地名搜索（先给「南海」「舟山」这类地名），空了退回 1 = 普通搜索
    return once(7)
      .then(function (items) {
        if (items.length) return items;
        return once(1);
      })
      .then(function (items) {
        var res = {
          ok: true,
          items: _dedupe(items).slice(0, count),
          source: "tianditu",
        };
        if (res.items.length) _cachePut(q, res); // 空结果不缓存：可能是瞬时失败
        return res;
      })
      .catch(function (e) {
        return {
          ok: false,
          items: [],
          source: "tianditu",
          error: String((e && e.message) || e || "地名服务请求失败"),
        };
      });
  }

  /**
   * 逆地理编码：坐标 → 地名。
   * 海域坐标天地图常常只给一个行政区或空串，此时退回最近 POI 名，
   * 仍然为空就返回 ok:false 让调用方说「这一带没有地名」。
   */
  function reverse(lat, lng) {
    var la = Number(lat);
    var ln = Number(lng);
    if (!isFinite(la) || !isFinite(ln)) {
      return Promise.resolve({ ok: false, error: "坐标不合法" });
    }
    var k = la.toFixed(4) + "," + ln.toFixed(4);
    if (_cacheR[k]) return Promise.resolve(_cacheR[k]);

    var tk = _tk();
    if (!tk) return Promise.resolve({ ok: false, error: "未配置天地图 token" });

    var postStr = JSON.stringify({ lon: ln, lat: la, ver: 1 });
    var url =
      GEOCODE_URL +
      "?postStr=" +
      encodeURIComponent(postStr) +
      "&type=geocode&tk=" +
      encodeURIComponent(tk);

    return _fetchJSON(url)
      .then(function (data) {
        var r = data && data.result;
        if (Array.isArray(r)) r = r[0];
        if (!r) {
          return { ok: false, error: (data && data.msg) || "无返回结果" };
        }
        var loc = r.location || {};
        var addr = String(r.formatted_address || "").trim();
        var comp = r.addressComponent || {};
        var poiName = "";
        var pois = Array.isArray(r.pois) ? r.pois : [];
        if (pois.length) poiName = String(pois[0].name || "").trim();
        var name = poiName || addr || String(comp.province || "") + String(comp.city || "");
        var out = {
          ok: !!name,
          name: name,
          address: addr,
          lat: isFinite(parseFloat(loc.lat)) ? parseFloat(loc.lat) : la,
          lng: isFinite(parseFloat(loc.lon)) ? parseFloat(loc.lon) : ln,
          province: comp.province || "",
          city: comp.city || "",
          county: comp.county || "",
          pois: pois.slice(0, 5).map(function (p) {
            return { name: p.name || "", address: p.address || "" };
          }),
        };
        if (!out.ok) out.error = "该坐标附近没有地名（多为海域/无人区）";
        _cacheR[k] = out;
        return out;
      })
      .catch(function (e) {
        return { ok: false, error: String((e && e.message) || e || "逆地理编码失败") };
      });
  }

  function clearCache() {
    _cacheS = {};
    _cacheSKeys = [];
    _cacheR = {};
  }

  global.OGVGeo = {
    ready: ready,
    search: search,
    reverse: reverse,
    clearCache: clearCache,
  };
})(window);
