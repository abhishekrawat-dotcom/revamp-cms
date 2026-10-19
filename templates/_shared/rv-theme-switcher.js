/* The theme switcher on the preview of an AI-designed site (/preview/<id>; added by functions/lib/api.js,
   themeSwitcherHtml — never on a published page). Its data is <script id="rv-themes"> { themes, design, current,
   editor }. Picking a theme restyles the page in place with RevampTheme (rv-theme.js): the colours a section
   wrote as fixed values are first turned into the page's variables, then the theme's variables are set, and
   the ET logo in the nav (and the portal's wordmark in ET's footer) takes the version for its new ground. "Apply in editor" opens the editor
   in that theme, where it is saved and published. */
(function () {
  'use strict';
  var T = window.RevampTheme, el = document.getElementById('rv-themes');
  if (!T || !el) return;
  var data;
  try { data = JSON.parse(el.textContent); } catch (e) { return; }
  if (!data || !data.themes || data.themes.length < 2) return;

  var ET_LOGO = { dark: '/templates/_shared/img/et-business-verticals-on-dark.svg', light: '/templates/_shared/img/et-business-verticals-on-light.svg' };
  var converted = false, current = data.current || 'original';

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
    });
    current = id;
    draw();
  }

  var box = document.createElement('div');
  box.setAttribute('data-rv-theme-switcher', '');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Try a theme');
  box.style.cssText = 'position:fixed;right:16px;bottom:44px;z-index:2147483001;display:flex;flex-direction:column;gap:8px;padding:12px;' +
    'border-radius:14px;background:#191b1f;color:#fff;box-shadow:0 12px 32px rgba(0,0,0,.35);font:500 13px/1.3 Inter,Arial,sans-serif;max-width:min(320px,calc(100vw - 32px))';
  function draw() {
    box.innerHTML = '';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px';
    head.innerHTML = '<b style="font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:11px;color:#c9cdd6">Theme</b>';
    var hide = document.createElement('button');
    hide.type = 'button'; hide.textContent = '×'; hide.setAttribute('aria-label', 'Hide the theme switcher');
    hide.style.cssText = 'border:0;background:transparent;color:#c9cdd6;font-size:18px;line-height:1;cursor:pointer;padding:0 2px';
    hide.onclick = function () { box.remove(); };
    head.appendChild(hide);
    box.appendChild(head);
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
      b.style.cssText = 'display:inline-flex;align-items:center;border-radius:999px;padding:7px 12px;cursor:pointer;font:inherit;' +
        (t.id === current ? 'background:#ffffff;color:#191b1f;border:1px solid #ffffff' : 'background:transparent;color:#ffffff;border:1px solid rgba(255,255,255,.3)');
      b.onclick = function () { choose(t.id); };
      row.appendChild(b);
    });
    box.appendChild(row);
    var apply = document.createElement('a');
    apply.href = data.editor + encodeURIComponent(current);
    apply.textContent = current === (data.current || 'original') ? 'Open in editor' : 'Apply in editor';
    apply.style.cssText = 'align-self:flex-start;color:#ffffff;font-weight:700;text-decoration:underline;text-underline-offset:3px';
    box.appendChild(apply);
  }
  draw();
  document.body.appendChild(box);
})();
