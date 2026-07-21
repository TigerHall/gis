(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var id = params.get('id');
  var titleEl = document.getElementById('title');
  var metaEl = document.getElementById('meta');
  var contentEl = document.getElementById('content');

  document.getElementById('year').textContent = new Date().getFullYear();

  var post = (window.POSTS || []).filter(function (p) { return p.id === id; })[0];

  if (!post) {
    titleEl.textContent = '未找到该文章';
    metaEl.textContent = '';
    contentEl.innerHTML = '<p class="empty">抱歉，这篇文章不存在或已被移动。<a href="index.html">回到首页</a></p>';
    return;
  }

  titleEl.textContent = post.title;
  document.title = post.title + ' · 地脉';

  metaEl.innerHTML = '';
  var d = document.createElement('span');
  d.textContent = post.date;
  metaEl.appendChild(d);
  (post.tags || []).forEach(function (t) {
    var s = document.createElement('span');
    s.textContent = '#' + t;
    s.style.color = 'var(--accent)';
    metaEl.appendChild(s);
  });

  function highlight() {
    if (window.hljs) {
      contentEl.querySelectorAll('pre code').forEach(function (el) {
        window.hljs.highlightElement(el);
      });
    }
  }

  fetch(post.file)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (md) {
      var html = window.marked ? window.marked.parse(md) : md;
      if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
      contentEl.innerHTML = html;
      highlight();
    })
    .catch(function (err) {
      contentEl.innerHTML =
        '<p class="empty">文章加载失败：' + err.message + '。<br>' +
        '如果你是直接双击打开本页面（file:// 协议），浏览器会拦截本地文件读取。' +
        '请在该目录运行一个本地服务器，例如 <code>python -m http.server</code>，' +
        '然后访问 <code>http://localhost:8000/blog/post.html?id=' + id + '</code>。</p>';
    });
})();
