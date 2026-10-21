/* The theme box on a site's preview (/preview/<id>; added by functions/lib/api.js, themeSwitcherHtml — never on a
   published page, never on an imported site). Its data is <script id="rv-themes"> { themes, design, current, edges,
   editorBase, editor }.
   Themes (an AI-designed site only): picking one restyles the page in place with RevampTheme (rv-theme.js): the
   colours a section wrote as fixed values are first turned into the page's variables, then the theme's variables
   are set, and the ET logo in the nav (and the portal's wordmark in ET's footer) takes the version for its new ground.
   Section edges (every site): "Sharp" or "Smooth" — where one section's colour meets the next. It sets
   <html data-rv-edges>, which the page's own runtime reads to fade the colours into each other or not.
   Either choice fires 'rv:themechange' on document. "Apply in editor" opens the editor with both, where they are
   saved and published. */
(function () {
  'use strict';
  var T = window.RevampTheme, el = document.getElementById('rv-themes');
  if (!el) return;
  var data;
  try { data = JSON.parse(el.textContent); } catch (e) { return; }
  if (!data) return;
  var hasThemes = !!(T && data.themes && data.themes.length >= 2);
  var savedEdges = data.edges === 'smooth' ? 'smooth' : 'sharp';
  var onPage = document.documentElement.getAttribute('data-rv-edges');
  var edges = onPage === 'smooth' || onPage === 'sharp' ? onPage : savedEdges;

  var ET_LOGO = { dark: '/templates/_shared/img/et-business-verticals-on-dark.svg', light: '/templates/_shared/img/et-business-verticals-on-light.svg' };
  var converted = false, current = data.current || 'original';

  function fireChange() {
    var detail = { theme: current, edges: edges }, ev;
    try { ev = new CustomEvent('rv:themechange', { detail: detail }); }
    catch (e) { ev = document.createEvent('CustomEvent'); ev.initCustomEvent('rv:themechange', false, false, detail); }
    document.dispatchEvent(ev);
  }
  function chooseEdges(v) {
    edges = v === 'smooth' ? 'smooth' : 'sharp';
    document.documentElement.setAttribute('data-rv-edges', edges);
    fireChange();
    draw();
  }

  function groundLum(node) {
    for (var e = node; e && e.nodeType === 1; e = e.parentElement) {
      var m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(getComputedStyle(e).backgroundColor || '');
      if (m && (m[4] == null || +m[4] > 0.5)) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255;
    }
    return 1;
  }
  function choose(id) {
    var t = data.themes.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    if (!converted) {
      Array.prototype.forEach.call(document.querySelectorAll('style[data-rv-style]'), function (st) {
        if (st.getAttribute('data-rv-style') === 'hero') return;
        st.textContent = T.themableCss(st.textContent, data.design);
      });
      converted = true;
    }
    T.apply(document, t);
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(document.querySelectorAll('img[data-rv-et-logo]'), function (img) {
        var dark = groundLum(img) < 0.45;
        /* the ET event bar's logo names its own two versions (the portal's wordmark, functions/lib/et-nav.js) */
        img.src = img.getAttribute(dark ? 'data-rv-on-dark' : 'data-rv-on-light') || ET_LOGO[dark ? 'dark' : 'light'];
      });
      /* the portal's wordmark in ET's footer: the ink it names for the new ground (functions/lib/et-footer.js) */
      Array.prototype.forEach.call(document.querySelectorAll('img[data-rv-portal-logo]'), function (img) {
        var onLight = img.getAttribute('data-rv-on-light'), onDark = img.getAttribute('data-rv-on-dark'), src = img.getAttribute('src');
        if (!onLight || !onDark || (src !== onLight && src !== onDark)) return;
        img.setAttribute('src', groundLum(img) < 0.45 ? onDark : onLight);
      });
      fireChange();
    });
    current = id;
    draw();
  }

  function pillCss(on) {
    return 'display:inline-flex;align-items:center;border-radius:999px;padding:7px 12px;min-height:32px;cursor:pointer;font:inherit;' +
      (on ? 'background:#ffffff;color:#191b1f;border:1px solid #ffffff' : 'background:transparent;color:#ffffff;border:1px solid rgba(255,255,255,.3)');
  }

  var title = hasThemes ? 'Theme' : 'Look', what = hasThemes ? 'Try a theme' : 'Try the section edges';
  var box = document.createElement('div');
  box.setAttribute('data-rv-theme-switcher', '');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', what);
  box.style.cssText = 'position:fixed;right:16px;bottom:44px;z-index:2147483001;display:flex;flex-direction:column;gap:8px;padding:12px;' +
    'border-radius:14px;background:#191b1f;color:#fff;box-shadow:0 12px 32px rgba(0,0,0,.35);font:500 13px/1.3 Inter,Arial,sans-serif;max-width:min(320px,calc(100vw - 32px))';
  /* on a phone the open panel would cover the hero's buttons: it starts as one small button, opened by a tap
     and folded again by its × */
  var narrow = !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  var open = !narrow;
  function draw() {
    box.innerHTML = '';
    box.style.padding = open ? '12px' : '0';
    if (!open) {
      var pill = document.createElement('button');
      pill.type = 'button';
      pill.setAttribute('aria-expanded', 'false');
      pill.setAttribute('aria-label', what);
      pill.textContent = title;
      pill.style.cssText = 'border:0;border-radius:999px;background:#191b1f;color:#fff;font:600 13px/1 Inter,Arial,sans-serif;letter-spacing:.04em;padding:12px 16px;min-height:44px;cursor:pointer';
      pill.onclick = function () { open = true; draw(); };
      box.appendChild(pill);
      return;
    }
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px';
    head.innerHTML = '<b style="font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11px;color:#c9cdd6"></b>';
    head.firstChild.textContent = title;
    var hide = document.createElement('button');
    hide.type = 'button'; hide.textContent = '×'; hide.setAttribute('aria-label', narrow ? 'Fold the theme box' : 'Hide the theme box');
    hide.style.cssText = 'border:0;background:transparent;color:#c9cdd6;font-size:18px;line-height:1;cursor:pointer;padding:0 2px';
    hide.onclick = function () { if (narrow) { open = false; draw(); } else box.remove(); };
    head.appendChild(hide);
    box.appendChild(head);
    if (hasThemes) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      data.themes.forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', t.id === current ? 'true' : 'false');
        b.title = t.blurb || '';
        var c = t.colours;
        b.innerHTML = '<span aria-hidden="true" style="display:inline-flex;margin-right:7px;vertical-align:-2px">' +
          [c.bg, c.surface, c.theme].map(function (x, i) { return '<i style="width:12px;height:12px;border-radius:50%;background:' + x + ';border:1px solid rgba(255,255,255,.35);margin-left:' + (i ? -4 : 0) + 'px"></i>'; }).join('') +
          '</span>' + t.label;
        b.style.cssText = pillCss(t.id === current);
        b.onclick = function () { choose(t.id); };
        row.appendChild(b);
      });
      box.appendChild(row);
    }
    /* section edges: Sharp | Smooth */
    var er = document.createElement('div');
    er.setAttribute('data-rv-edges-control', '');
    er.setAttribute('role', 'group');
    er.setAttribute('aria-label', 'Section edges');
    er.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
    var name = document.createElement('span');
    name.textContent = 'Section edges';
    name.style.cssText = 'color:#c9cdd6;font-size:12px;margin-right:2px';
    er.appendChild(name);
    [['sharp', 'Sharp', 'Each section ends in a straight line'], ['smooth', 'Smooth', 'Where the colour changes, one section fades into the next']].forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-rv-edges-option', o[0]);
      b.setAttribute('aria-pressed', edges === o[0] ? 'true' : 'false');
      b.title = o[2];
      b.textContent = o[1];
      b.style.cssText = pillCss(edges === o[0]);
      b.onclick = function () { if (edges !== o[0]) chooseEdges(o[0]); };
      er.appendChild(b);
    });
    box.appendChild(er);
    var themeChanged = hasThemes && current !== (data.current || 'original'), edgesChanged = edges !== savedEdges;
    var href = data.editorBase || String(data.editor || '').replace(/&theme=$/, '');
    if (themeChanged) href += '&theme=' + encodeURIComponent(current);
    if (edgesChanged) href += '&edges=' + edges;
    var apply = document.createElement('a');
    apply.href = href;
    apply.textContent = themeChanged || edgesChanged ? 'Apply in editor' : 'Open in editor';
    apply.style.cssText = 'align-self:flex-start;color:#ffffff;font-weight:700;text-decoration:underline;text-underline-offset:3px';
    box.appendChild(apply);
  }
  draw();
  document.body.appendChild(box);
})();
