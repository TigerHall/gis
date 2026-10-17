/*!
 * ogv-websearch.js —— DeepSeek 网页搜索 / 抓取（`window.OGVWeb`）
 * =============================================================================
 * 为什么单独一个文件：地名（天地图）与「资料/事实」是两件事。
 *   天地图只会告你「这个地方在哪」，问到「马里亚纳海沟最大深度多少」「洋中脊
 *   热液喷口的定义」这类**非地理**问题时，它一条都返回不了 —— 那才是联网搜索的
 *   位置。同理，AI 助手在本地矢量 / 地名表 / 天地图**三级全空**时，也靠它兜底。
 *
 * 后端 = DeepSeek 官方 Search / Fetch（与 chat 同一个 Key、同一套 Bearer 鉴权）：
 *   POST https://api.deepseek.com/v1/tools/search
 *        {query, count(1~50), ori_question?, need_content?, localization?}
 *        → {results:[{rerank_score,title,url,snippet,summary,content,site_name,
 *                     site_icon,date,authority}]}
 *   POST https://api.deepseek.com/v1/tools/fetch   {url} → {title, content(Markdown)}
 * ⚠️ 不要往 search 里塞越界的 mapBound 那类字段（这里根本没有）——它只认 query。
 * ⚠️ 浏览器直连要能过 CORS；DeepSeek 官方 API 是开放给浏览器调用的（与 chat 同源
 *    策略一致），若某天被拦，本模块 `search()` 会返回 {ok:false,error:"网络不通…"}，
 *    调用方（AI 助手）会退化成「只用本地结果」，不会卡死。
 *
 * 计费：Search / Fetch **按成功请求次数**（每 1000 次 5 元），失败 / 空结果不计费；
 *       QPS 每账号各 5。所以这里做了两层省：内存 LRU（40 条）+ 同 query 在途合并。
 *
 * 对外：
 *   OGVWeb.ready()                   → 有没有可用 Key
 *   OGVWeb.search(q, {count, needContent, oriQuestion}) → Promise<{ok,items,error,cached}>
 *   OGVWeb.fetchPage(url)            → Promise<{ok,title,content,error}>
 *   OGVWeb.clearCache()
 *   OGVWeb.KEY_URL                   → 当前用的端点（排障用）
 * 永不 reject：所有分支都 resolve 成 {ok:false,error}，调用方不必写 catch。
 * =============================================================================
 */
(function (global) {
  "use strict";

  var SEARCH_URL = "https://api.deepseek.com/v1/tools/search";
  var FETCH_URL = "https://api.deepseek.com/v1/tools/fetch";

  var CACHE_MAX = 40; // 搜索结果条数上限（LRU）
  var SEARCH_TIMEOUT = 20000;
  var FETCH_TIMEOUT = 25000;
  var MAX_COUNT = 20; // 我们最多要 20 条（再多模型也读不完，纯浪费上下文）

  var _cache = new Map(); // key → {t, items}
  var _inflight = new Map(); // key → Promise（同 query 合并）

  // ─────────────────────────────────────────────
  //  Key：与 ai-chat.js 同一口径（用户自填 > 内置默认）
  // ─────────────────────────────────────────────
  function _key() {
    // ① ai-chat.js 已加载 → 它最清楚优先级（自填 Key 优先于内置）
    try {
      if (global.OGVAI && typeof global.OGVAI.getKey === "function") {
        var k1 = global.OGVAI.getKey();
        if (k1) return String(k1).trim();
      }
    } catch (e) {}
    // ② 宿主页覆盖
    if (global.OGV_AI_DEFAULT_KEY != null && String(global.OGV_AI_DEFAULT_KEY).trim()) {
      return String(global.OGV_AI_DEFAULT_KEY).trim();
    }
    // ③ 直接读存储（ai-chat 还没初始化时也能用）
    try {
      var S = global.OGVStorage;
      if (S && S.KEY && S.KEY.AI_KEY) {
        var k2 = S.safeGet(S.KEY.AI_KEY, "");
        if (k2 && String(k2).trim()) return String(k2).trim();
      }
    } catch (e2) {}
    return "";
  }

  function ready() {
    return !!_key();
  }

  // ─────────────────────────────────────────────
  //  HTTP（带超时 + 统一错误话术）
  // ─────────────────────────────────────────────
  function _post(url, body, timeoutMs) {
    var key = _key();
    if (!key) return Promise.resolve({ ok: false, error: "未配置 API Key" });
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctl) ctl.abort();
    }, timeoutMs);
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined,
    })
      .then(function (r) {
        return r.json().then(
          function (j) {
            return { status: r.status, ok: r.ok, json: j };
          },
          function () {
            // 非 JSON（比如 413/502 的 HTML 页）—— 也要把状态码带出去
            return { status: r.status, ok: r.ok, json: null };
          },
        );
      })
      .then(function (res) {
        if (res.ok) return { ok: true, json: res.json || {} };
        return { ok: false, error: _httpMsg(res.status, res.json), status: res.status };
      })
      .catch(function (e) {
        var msg = String((e && e.message) || e);
        if (/abort/i.test(msg)) return { ok: false, error: "联网搜索超时（" + Math.round(timeoutMs / 1000) + "s）" };
        // TypeError: Failed to fetch → 断网 / CORS / 被拦截
        if (/failed to fetch|networkerror|load failed/i.test(msg))
          return { ok: false, error: "网络不通（可能被浏览器拦截或离线）" };
        return { ok: false, error: msg };
      })
      .then(function (out) {
        clearTimeout(timer);
        return out;
      });
  }

  function _httpMsg(status, j) {
    var m = j && j.error && j.error.message;
    if (status === 401) return "API Key 无效或缺失";
    if (status === 402) return "账号余额不足，联网搜索需要充值";
    if (status === 403) return "被抓取站点被安全策略拒绝";
    if (status === 404) return "没抓到可用的网页内容";
    if (status === 429) return "触发限速（Search/Fetch 每账号 5 QPS），稍后再试";
    if (status >= 500) return "服务端错误（HTTP " + status + "），稍后重试";
    return m || "HTTP " + status;
  }

  // ─────────────────────────────────────────────
  //  结果整形 + 缓存
  // ─────────────────────────────────────────────
  var _hit = 0;
  function _shape(r) {
    return {
      title: String(r.title || "").trim() || String(r.url || ""),
      url: String(r.url || ""),
      // snippet 是给前端展示的短摘要（100~200 字），summary 给模型读（600~800 字）
      snippet: String(r.snippet || "").trim(),
      summary: String(r.summary || "").trim(),
      content: String(r.content || ""),
      site: r.site_name || "",
      icon: r.site_icon || "",
      date: r.date ? String(r.date).slice(0, 10) : "",
      authority: typeof r.authority === "number" ? r.authority : -1,
      score: typeof r.rerank_score === "number" ? r.rerank_score : 0,
    };
  }

  function _cacheGet(k) {
    var v = _cache.get(k);
    if (!v) return null;
    // 触到就挪到队尾（Map 保插入序 → 队首即最旧）
    _cache.delete(k);
    _cache.set(k, v);
    _hit++;
    return v.items;
  }
  function _cacheSet(k, items) {
    _cache.set(k, { t: Date.now(), items: items });
    while (_cache.size > CACHE_MAX) {
      var first = _cache.keys().next();
      if (first.done) break;
      _cache.delete(first.value);
    }
  }

  // ─────────────────────────────────────────────
  //  search
  // ─────────────────────────────────────────────
  /**
   * @param q   搜索词（1~128 字符）
   * @param opt {count, needContent, oriQuestion}
   * @returns Promise<{ok, items:[…], error?, cached?, hit?}>
   */
  function search(q, opt) {
    opt = opt || {};
    var query = String(q || "").trim();
    if (!query) return Promise.resolve({ ok: false, items: [], error: "query 不能为空" });
    if (query.length > 128) query = query.slice(0, 128);

    var count = Math.max(1, Math.min(MAX_COUNT, Number(opt.count) || 6));
    var needContent = !!opt.needContent;
    var ck = query + "|" + count + "|" + (needContent ? 1 : 0);

    var cached = _cacheGet(ck);
    if (cached) return Promise.resolve({ ok: true, items: cached, cached: true });

    var flying = _inflight.get(ck);
    if (flying) return flying;

    var body = { query: query, count: count, need_content: needContent };
    // ori_question：用户原话，帮搜索引擎理解意图（比 query 更完整时才有意义）
    if (opt.oriQuestion && String(opt.oriQuestion).trim() && String(opt.oriQuestion).trim() !== query) {
      body.ori_question = String(opt.oriQuestion).trim().slice(0, 128);
    }

    var p = _post(SEARCH_URL, body, SEARCH_TIMEOUT).then(function (r) {
      _inflight.delete(ck);
      if (!r.ok) return { ok: false, items: [], error: r.error };
      var arr = (r.json && r.json.results) || [];
      var items = arr.map(_shape).filter(function (x) {
        return x.url;
      });
      // 空结果不缓存（可能是瞬时问题；而且空数组缓存了会让人以为「就是没有」）
      if (items.length) _cacheSet(ck, items);
      return { ok: true, items: items };
    });
    _inflight.set(ck, p);
    return p;
  }

  // ─────────────────────────────────────────────
  //  fetchPage（抓正文，转 Markdown）
  // ─────────────────────────────────────────────
  function fetchPage(url) {
    var u = String(url || "").trim();
    if (!/^https?:\/\/[^\s]+$/i.test(u)) {
      return Promise.resolve({ ok: false, error: "url 必须是 http(s) 开头的完整地址" });
    }
    var ck = "fetch|" + u;
    var cached = _cacheGet(ck);
    if (cached && cached[0]) return Promise.resolve({ ok: true, title: cached[0].title, content: cached[0].content, cached: true });

    return _post(FETCH_URL, { url: u }, FETCH_TIMEOUT).then(function (r) {
      if (!r.ok) return { ok: false, error: r.error };
      var title = String((r.json && r.json.title) || "");
      var content = String((r.json && r.json.content) || "");
      if (!content) return { ok: false, error: "这个页面没有可提取的正文" };
      _cacheSet(ck, [{ title: title, content: content }]);
      return { ok: true, title: title, content: content };
    });
  }

  function clearCache() {
    _cache.clear();
    _inflight.clear();
    _hit = 0;
  }

  global.OGVWeb = {
    ready: ready,
    search: search,
    fetchPage: fetchPage,
    clearCache: clearCache,
    SEARCH_URL: SEARCH_URL,
    FETCH_URL: FETCH_URL,
    stats: function () {
      return { cache: _cache.size, inflight: _inflight.size, hits: _hit };
    },
  };
})(window);
