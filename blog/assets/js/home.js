(function () {
  'use strict';

  var posts = (window.POSTS || []).slice().sort(function (a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });

  var tagBar = document.getElementById('tag-bar');
  var listEl = document.getElementById('post-list');
  var emptyEl = document.getElementById('empty');
  var activeTag = null;

  document.getElementById('year').textContent = new Date().getFullYear();

  // 收集全部标签
  var tagSet = {};
  posts.forEach(function (p) {
    (p.tags || []).forEach(function (t) { tagSet[t] = (tagSet[t] || 0) + 1; });
  });
  var tags = Object.keys(tagSet).sort();

  function makeChip(label, count, onClick) {
    var c = document.createElement('span');
    c.className = 'chip';
    c.textContent = count ? label + ' · ' + count : label;
    c.addEventListener('click', onClick);
    return c;
  }

  // “全部” + 每个标签
  var allChip = makeChip('全部', posts.length, function () { setFilter(null); });
  allChip.classList.add('active');
  tagBar.appendChild(allChip);

  tags.forEach(function (t) {
    var chip = makeChip(t, tagSet[t], function () { setFilter(t); });
    chip.dataset.tag = t;
    tagBar.appendChild(chip);
  });

  function setFilter(tag) {
    activeTag = tag;
    Array.prototype.forEach.call(tagBar.children, function (c) {
      c.classList.remove('active');
    });
    if (tag === null) {
      allChip.classList.add('active');
    } else {
      Array.prototype.forEach.call(tagBar.children, function (c) {
        if (c.dataset && c.dataset.tag === tag) c.classList.add('active');
      });
    }
    render();
  }

  function render() {
    var items = activeTag
      ? posts.filter(function (p) { return (p.tags || []).indexOf(activeTag) !== -1; })
      : posts;

    listEl.innerHTML = '';
    emptyEl.style.display = items.length ? 'none' : 'block';

    items.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'post-item';

      var h2 = document.createElement('h2');
      var a = document.createElement('a');
      a.href = 'post.html?id=' + encodeURIComponent(p.id);
      a.textContent = p.title;
      h2.appendChild(a);

      var meta = document.createElement('div');
      meta.className = 'post-meta';
      var date = document.createElement('span');
      date.textContent = p.date;
      meta.appendChild(date);
      (p.tags || []).forEach(function (t) {
        var tg = document.createElement('span');
        tg.textContent = '#' + t;
        tg.style.color = 'var(--accent)';
        meta.appendChild(tg);
      });

      var ex = document.createElement('p');
      ex.className = 'excerpt';
      ex.textContent = p.excerpt || '';

      li.appendChild(h2);
      li.appendChild(meta);
      li.appendChild(ex);
      listEl.appendChild(li);
    });
  }

  render();
})();
