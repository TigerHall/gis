/*!
 * ogv-chatstore.js —— AI 历史对话的 IndexedDB 存储（唯一写入口）
 * =============================================================================
 * 为什么要单独一层：
 *   · 历史对话带全文，条数会长；localStorage 5MB 且是同步阻塞，不适合当主存；
 *   · IndexedDB 天然异步、容量大，还能按 updatedAt 建索引 → 侧栏分组排序不用
 *     每次把全部会话读出来再排。
 *   · 但 IDB 在**隐私模式 / 部分内嵌 WebView** 里会直接抛错或永远 pending。
 *     所以整层**永不 reject**：打不开就自动降级到 localStorage（同一个 API），
 *     调用方（ai-chat.js）不需要写两套逻辑。
 *
 * 数据模型（store: sessions，keyPath: id）：
 *   { id, title, createdAt, updatedAt, pinned: 0|1, msgs: [{role,text}] }
 *   索引 updatedAt（侧栏按最近更新倒序）。
 *
 * API（全部返回 Promise）：
 *   ready()        → Promise<boolean> 是否可用（含降级）
 *   list()         → [meta] 不含 msgs 的摘要，按 pinned desc, updatedAt desc
 *   get(id)        → 单条完整记录 | null
 *   put(rec)       → 写入/覆盖
 *   patch(id, o)   → 只改部分字段（置顶、改标题）
 *   del(id)        → 删除
 *   clear()        → 清空全部
 *   kind           → "idb" | "ls"（降级时）
 * =============================================================================
 */
(function (global) {
  "use strict";

  var DB_NAME = "ogv-ai";
  var DB_VER = 1;
  var STORE = "sessions";
  var LS_KEY = "ogv_ai_hist_v1";
  var MAX_SESSIONS = 60; // 超出后丢弃最旧的**非置顶**会话

  var _db = null;
  var _opening = null;
  var _kind = null; // null = 还没试过

  // ─────────────────────────────────────────────
  //  降级实现（localStorage）
  // ─────────────────────────────────────────────
  function _lsRead() {
    try {
      var raw = global.localStorage.getItem(LS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }
  function _lsWrite(arr) {
    try {
      global.localStorage.setItem(LS_KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ─────────────────────────────────────────────
  //  IDB 打开
  // ─────────────────────────────────────────────
  function _openDB() {
    if (_db) return Promise.resolve(_db);
    if (_opening) return _opening;
    _opening = new Promise(function (resolve, reject) {
      var idb = global.indexedDB;
      if (!idb) return reject(new Error("no indexedDB"));
      var req;
      try {
        req = idb.open(DB_NAME, DB_VER);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var st = db.createObjectStore(STORE, { keyPath: "id" });
          st.createIndex("updatedAt", "updatedAt");
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("idb open error"));
      };
      req.onblocked = function () {
        reject(new Error("idb blocked"));
      };
    }).then(
      function (db) {
        _db = db;
        _kind = "idb";
        // 版本升级时别的标签页会触发 versionchange → 主动让路，别把人家卡住
        db.onversionchange = function () {
          try {
            db.close();
          } catch (e) {}
          _db = null;
          _opening = null;
        };
        return db;
      },
      function (e) {
        _kind = "ls";
        _opening = null;
        throw e;
      },
    );
    return _opening;
  }

  function _tx(mode, fn) {
    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var st = t.objectStore(STORE);
        var out;
        try {
          out = fn(st);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = function () {
          resolve(out);
        };
        t.onerror = function () {
          reject(t.error || new Error("tx error"));
        };
        t.onabort = function () {
          reject(t.error || new Error("tx abort"));
        };
      });
    });
  }

  function _req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () {
        resolve(r.result);
      };
      r.onerror = function () {
        reject(r.error);
      };
    });
  }

  /** 统一入口：IDB 走 fn(db)，失败自动降级到 localStorage 走 fn(null) */
  function _run(idbFn, lsFn) {
    return _openDB().then(
      function () {
        return idbFn();
      },
      function () {
        return lsFn ? lsFn() : null;
      },
    )
      .catch(function () {
        return lsFn ? lsFn() : null;
      });
  }

  // ─────────────────────────────────────────────
  //  对外 API
  // ─────────────────────────────────────────────
  function ready() {
    return _openDB().then(
      function () {
        return true;
      },
      function () {
        return false; // 降级也算「可用」，调用方不需要区分；kind 能查到
      },
    );
  }

  function _sortMeta(a, b) {
    if ((b.pinned | 0) !== (a.pinned | 0)) return (b.pinned | 0) - (a.pinned | 0);
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  }

  function list() {
    return _run(
      function () {
        return _tx("readonly", function (st) {
          var r = st.getAll();
          return _req(r);
        }).then(function (all) {
          return (all || []).map(function (s) {
            return {
              id: s.id,
              title: s.title || "",
              createdAt: s.createdAt || 0,
              updatedAt: s.updatedAt || 0,
              pinned: s.pinned ? 1 : 0,
              count: (s.msgs || []).length,
            };
          }).sort(_sortMeta);
        });
      },
      function () {
        return _lsRead().map(function (s) {
          return {
            id: s.id,
            title: s.title || "",
            createdAt: s.createdAt || 0,
            updatedAt: s.updatedAt || 0,
            pinned: s.pinned ? 1 : 0,
            count: (s.msgs || []).length,
          };
        }).sort(_sortMeta);
      },
    ).then(function (v) {
      return v || [];
    });
  }

  function get(id) {
    if (!id) return Promise.resolve(null);
    return _run(
      function () {
        return _tx("readonly", function (st) {
          return _req(st.get(id));
        }).then(function (v) {
          return v || null;
        });
      },
      function () {
        var hit = _lsRead().filter(function (s) {
          return s.id === id;
        })[0];
        return hit || null;
      },
    ).then(function (v) {
      return v || null;
    });
  }

  function put(rec) {
    if (!rec || !rec.id) return Promise.resolve(false);
    var clean = {
      id: String(rec.id),
      title: String(rec.title || "").slice(0, 120),
      createdAt: Number(rec.createdAt) || Date.now(),
      updatedAt: Number(rec.updatedAt) || Date.now(),
      pinned: rec.pinned ? 1 : 0,
      msgs: Array.isArray(rec.msgs) ? rec.msgs.slice(-200) : [],
    };
    return _run(
      function () {
        return _tx("readwrite", function (st) {
          st.put(clean);
          return true;
        });
      },
      function () {
        var arr = _lsRead().filter(function (s) {
          return s.id !== clean.id;
        });
        arr.push(clean);
        // 超量：先丢最旧的未置顶
        if (arr.length > MAX_SESSIONS) {
          arr.sort(_sortMeta);
          var keep = [], dropped = 0;
          arr.forEach(function (s) {
            if (dropped < arr.length - MAX_SESSIONS && !s.pinned) {
              dropped++;
              return;
            }
            keep.push(s);
          });
          arr = keep;
        }
        return _lsWrite(arr);
      },
    ).then(function (v) {
      return !!v;
    });
  }

  function patch(id, fields) {
    if (!id || !fields) return Promise.resolve(false);
    return get(id).then(function (cur) {
      if (!cur) return false;
      var next = Object.assign({}, cur, fields);
      next.id = cur.id;
      next.createdAt = cur.createdAt;
      return put(next);
    });
  }

  function del(id) {
    if (!id) return Promise.resolve(false);
    return _run(
      function () {
        return _tx("readwrite", function (st) {
          st.delete(id);
          return true;
        });
      },
      function () {
        return _lsWrite(_lsRead().filter(function (s) {
          return s.id !== id;
        }));
      },
    ).then(function (v) {
      return !!v;
    });
  }

  function clear() {
    return _run(
      function () {
        return _tx("readwrite", function (st) {
          st.clear();
          return true;
        });
      },
      function () {
        return _lsWrite([]);
      },
    ).then(function (v) {
      return !!v;
    });
  }

  global.OGVChatStore = {
    ready: ready,
    list: list,
    get: get,
    put: put,
    patch: patch,
    del: del,
    clear: clear,
    /** "idb" | "ls" | null（还没初始化） */
    get kind() {
      return _kind;
    },
  };
})(window);
