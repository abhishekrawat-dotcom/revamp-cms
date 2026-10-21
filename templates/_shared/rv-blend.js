/* Section edges: "Smooth" (templates/_shared/rv-blend.js; put on preview and published pages by
   functions/lib/api.js publishTransform, which also writes the site's choice on <html data-rv-edges>).

   With <html data-rv-edges="smooth">, wherever one page section ends and the next begins on a different
   colour, the upper colour fades softly into the lower section instead of stopping at a hard line. Where one
   side is a picture or video ground (a hero, a photo band), the solid neighbour's colour fades into the
   picture's edge. Two pictures meeting, or two grounds of the same colour, are left as they are. Anything else
   ("sharp", or no attribute) draws nothing: the page is exactly as designed.

   How a fade is drawn: one absolutely placed, aria-hidden <div data-rv-edge> inside the section, along its top
   (or bottom) edge, painted above the section's own ground (its background, picture or veil) and kept inside the
   empty padding before the section's first text, picture, button or card — so it never covers content, never
   takes a click, and never moves anything (no layout shift). It carries data-rv-runtime, so a saved or
   published page never keeps one (publishTransform removes them, and the data-rv-edge-host mark it puts on
   the section); it is redrawn on every page load.

   It is redrawn when <html data-rv-edges> changes (the preview's "Section edges" choice), when the theme
   changes (the theme switcher restyles <body>; it also fires "rv:themechange" on document), when the page is
   resized, and when a section is shown or hidden. Each redraw reads every position first and writes after,
   in one pass. The header (it floats over the page once scrolled) and ET's footer always stay sharp.
   Browser code: ES5 only. */
(function () {
  'use strict';
  if (window.RevampBlend) return;
  var root = document.documentElement;
  var STYLE_ID = 'rv-blend-css';
  var KEEP_SHARP = '[data-rv-section="nav"],[data-rv-etnav],[data-rv-et-footer],[data-rv-section="footer"]';
  var MEDIA = { IMG: 1, VIDEO: 1, PICTURE: 1, CANVAS: 1 };
  var CONTENT_TAGS = { IMG: 1, SVG: 1, svg: 1, VIDEO: 1, CANVAS: 1, IFRAME: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, BUTTON: 1, PICTURE: 1, OBJECT: 1, EMBED: 1 };
  /* an eased fade (smooth at both ends) instead of a straight one, which shows a visible band */
  var EASE = [[0, 1], [12, 0.96], [25, 0.86], [38, 0.7], [50, 0.52], [62, 0.34], [75, 0.18], [88, 0.06], [100, 0]];

  function mode() { return root.getAttribute('data-rv-edges') === 'smooth' ? 'smooth' : 'sharp'; }

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.setAttribute('data-rv-runtime', '');
    st.textContent = '[data-rv-edge]{position:absolute;left:0;right:0;pointer-events:none;margin:0;padding:0;border:0}' +
      '[data-rv-edge-host="pos"]{position:relative!important}' +
      '@media print{[data-rv-edge]{display:none!important}}';
    (document.head || root).appendChild(st);
  }

  /* "rgb(1, 2, 3)" / "rgba(1, 2, 3, .5)" / "rgb(1 2 3 / 50%)" -> [r, g, b, a] or null */
  function parseColor(s) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,\/]\s*([\d.]+)(%)?)?\s*\)/.exec(s || '');
    if (!m) return null;
    var a = m[4] == null ? 1 : (+m[4]) / (m[5] ? 100 : 1);
    return [+m[1], +m[2], +m[3], a];
  }
  /* paint `top` (may be see-through) over the opaque `under` */
  function over(under, top) {
    if (!top || top[3] <= 0.02) return under;
    var a = Math.min(1, top[3]);
    return [under[0] * (1 - a) + top[0] * a, under[1] * (1 - a) + top[1] * a, under[2] * (1 - a) + top[2] * a, 1];
  }
  function sameColor(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 6; }
  function hasPicture(cs) { return /url\(/.test(cs.backgroundImage || ''); }
  function hasGradient(cs) { return /gradient\(/.test(cs.backgroundImage || ''); }
  function isOurs(el) { return el.hasAttribute && el.hasAttribute('data-rv-edge'); }
  function zOf(cs) { var z = parseInt(cs.zIndex, 10); return isNaN(z) ? 0 : z; }

  /* the opaque colour behind an element: its ancestors' backgrounds painted in order over white */
  function colourBehind(el) {
    var chain = [];
    for (var e = el.parentElement; e; e = e.parentElement) chain.push(e);
    var c = [255, 255, 255, 1];
    for (var i = chain.length - 1; i >= 0; i--) c = over(c, parseColor(getComputedStyle(chain[i]).backgroundColor));
    return c;
  }

  /* The page's sections, in order: the outermost [data-rv-section] elements (any template the loader built),
     else the body's own section-like children. */
  function sections() {
    var all = document.querySelectorAll('[data-rv-section]'), out = [], i;
    for (i = 0; i < all.length; i++) {
      var p = all[i].parentElement, nested = false;
      for (; p; p = p.parentElement) if (p.hasAttribute('data-rv-section')) { nested = true; break; }
      if (!nested) out.push(all[i]);
    }
    if (out.length < 2) {
      out = [];
      var kids = document.querySelectorAll('body > section, body > header, body > footer, body > main > section, body > div > section');
      for (i = 0; i < kids.length; i++) out.push(kids[i]);
    }
    return out;
  }

  /* What a section shows along one edge ("top" or "bottom"): a colour, or a picture/video ground (media).
     `layers` are the section's direct children that hold that ground (a background video, a veil, a coloured
     or pictured wrapper, or the block a full-width photo sits in): the fade is put after the last of them, at
     their stacking level, so it is painted above the ground. */
  function groundAt(sec, r, cs, side) {
    var g = { color: over(colourBehind(sec), parseColor(cs.backgroundColor)), media: hasPicture(cs) || hasGradient(cs), layers: [], z: null };
    var el = sec, elTop = null, depth = 0;
    function layer(top) {
      if (g.layers.indexOf(top) !== -1) return;
      var tcs = getComputedStyle(top);
      g.layers.push(top);
      var z = tcs.position === 'static' ? 0 : zOf(tcs);
      g.z = g.z == null ? z : Math.max(g.z, z);
    }
    while (el && depth < 4) {
      var next = null, nextTop = null;
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (isOurs(c)) continue;
        var cr = c.getBoundingClientRect();
        if (cr.height < 1 || cr.width < r.width * 0.9) continue;
        if (side === 'top' ? Math.abs(cr.top - r.top) > 1.5 : Math.abs(cr.bottom - r.bottom) > 1.5) continue;
        var ccs = getComputedStyle(c);
        if (ccs.display === 'none' || ccs.visibility === 'hidden') continue;
        var top = elTop || c;
        var bg = parseColor(ccs.backgroundColor);
        var isMedia = !!MEDIA[c.tagName] || hasPicture(ccs) || hasGradient(ccs);
        var painted = isMedia || (bg && bg[3] > 0.02);
        if (painted) {
          if (isMedia) g.media = true;
          else g.color = over(g.color, bg);
          if (top !== c || ccs.position !== 'static') layer(top);
        }
        if (!MEDIA[c.tagName] && !next) { next = c; nextTop = top; }
      }
      el = next; elTop = nextTop; depth++;
    }
    return g;
  }

  /* The empty space along an edge before the section's first content (text, a picture, a control, a card). */
  function freeSpace(sec, r, side) {
    var best = r.height, all = sec.getElementsByTagName('*'), i, rect;
    function take(rt) {
      if (rt.width < 1 || rt.height < 1 || rt.bottom <= r.top || rt.top >= r.bottom) return;
      var d = side === 'top' ? rt.top - r.top : r.bottom - rt.bottom;
      if (d < best) best = Math.max(0, d);
    }
    for (i = 0; i < all.length; i++) {
      var el = all[i];
      if (isOurs(el)) continue;
      var cs = null;
      if (CONTENT_TAGS[el.tagName]) {
        rect = el.getBoundingClientRect();
        /* a picture as wide as the section is its ground, not content */
        if (MEDIA[el.tagName] && rect.width >= r.width * 0.9) continue;
        cs = getComputedStyle(el);
        if (cs.visibility !== 'hidden' && cs.display !== 'none') take(rect);
        continue;
      }
      /* a card, a pill, a framed box: anything narrower than the section with its own paint */
      rect = el.getBoundingClientRect();
      if (rect.width >= r.width * 0.9 || rect.width < 1) {
        /* its own text still counts */
      } else {
        cs = getComputedStyle(el);
        var bg = parseColor(cs.backgroundColor);
        if ((bg && bg[3] > 0.05) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' ||
            parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0) { take(rect); }
      }
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType !== 3 || !/\S/.test(n.nodeValue)) continue;
        var range = document.createRange();
        range.selectNodeContents(n);
        take(range.getBoundingClientRect());
        if (range.detach) range.detach();
      }
    }
    return best;
  }

  function bandSize() {
    var w = window.innerWidth || root.clientWidth || 1024;
    if (w <= 640) return 48;
    return Math.max(64, Math.min(120, Math.round(w * 0.067)));
  }

  function gradient(c, side) {
    var r = Math.round(c[0]), g = Math.round(c[1]), b = Math.round(c[2]), stops = [];
    for (var i = 0; i < EASE.length; i++) stops.push('rgba(' + r + ',' + g + ',' + b + ',' + EASE[i][1] + ') ' + EASE[i][0] + '%');
    return 'linear-gradient(to ' + (side === 'top' ? 'bottom' : 'top') + ',' + stops.join(',') + ')';
  }

  /* ---- read: decide every fade without touching the page ---- */
  function plan() {
    var secs = sections(), info = [], i, out = [];
    for (i = 0; i < secs.length; i++) {
      var s = secs[i], cs = getComputedStyle(s), r = s.getBoundingClientRect();
      var skip = cs.display === 'none' || cs.visibility === 'hidden' || r.height < 2 ||
        cs.position === 'fixed' || cs.position === 'sticky' || cs.position === 'absolute';
      info.push({ el: s, cs: cs, r: r, skip: skip, sharp: !!(s.matches && s.matches(KEEP_SHARP)) });
    }
    var vis = info.filter(function (x) { return !x.skip; });
    var want = bandSize();
    /* a section edge meeting the page's own ground (a gap between two sections): that ground's colour fades
       into the section */
    function toGround(x, side, colour) {
      if (x.sharp) return;
      var g = groundAt(x.el, x.r, x.cs, side);
      if (!g.media && sameColor(g.color, colour)) return;
      var hh = Math.min(want, freeSpace(x.el, x.r, side) - 8, x.r.height / 2);
      if (hh >= 24) out.push({ host: x, side: side, color: colour, h: hh, layers: g.layers, z: g.z });
    }
    for (i = 0; i + 1 < vis.length; i++) {
      var a = vis[i], b = vis[i + 1], gap = b.r.top - a.r.bottom;
      if (gap < -2) continue;                                         /* overlapping by design: left alone */
      if (gap > 2) {
        if (a.el.parentNode === b.el.parentNode) {
          var page = colourBehind(a.el);
          toGround(a, 'bottom', page); toGround(b, 'top', page);
        }
        continue;
      }
      if (a.sharp || b.sharp) continue;
      var ga = groundAt(a.el, a.r, a.cs, 'bottom'), gb = groundAt(b.el, b.r, b.cs, 'top');
      if (ga.media && gb.media) continue;
      if (!ga.media && !gb.media && sameColor(ga.color, gb.color)) continue;
      var h, free;
      /* the upper colour fading down into the lower section (a solid or a picture below) */
      if (!ga.media) {
        free = freeSpace(b.el, b.r, 'top');
        h = Math.min(want, free - 8, b.r.height / 2);
        if (h >= 24) { out.push({ host: b, side: 'top', color: ga.color, h: h, layers: gb.layers, z: gb.z }); continue; }
      }
      /* else the lower colour fading up into the upper section (a solid or a picture above) */
      if (!gb.media) {
        free = freeSpace(a.el, a.r, 'bottom');
        h = Math.min(want, free - 8, a.r.height / 2);
        if (h >= 24) out.push({ host: a, side: 'bottom', color: gb.color, h: h, layers: ga.layers, z: ga.z });
      }
    }
    return out;
  }

  /* ---- write ---- */
  function clear() {
    var old = document.querySelectorAll('[data-rv-edge]'), i;
    for (i = 0; i < old.length; i++) if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
    var hosts = document.querySelectorAll('[data-rv-edge-host]');
    for (i = 0; i < hosts.length; i++) hosts[i].removeAttribute('data-rv-edge-host');
  }
  function draw(items) {
    ensureCss();
    for (var i = 0; i < items.length; i++) {
      var it = items[i], host = it.host.el;
      if (!host.hasAttribute('data-rv-edge-host')) {
        /* the fade is placed against the section itself; a section that is not yet a positioning context
           becomes one only when nothing inside it was placed against something further out */
        host.setAttribute('data-rv-edge-host', it.host.cs.position === 'static' ? 'pos' : '');
      }
      var d = document.createElement('div');
      d.setAttribute('data-rv-edge', it.side);
      d.setAttribute('data-rv-runtime', '');
      d.setAttribute('aria-hidden', 'true');
      d.style.cssText = (it.side === 'top' ? 'top:0;' : 'bottom:0;') + 'height:' + Math.round(it.h) + 'px;' +
        'z-index:' + (it.z == null ? 0 : it.z) + ';background:' + gradient(it.color, it.side);
      var last = null;
      for (var k = 0; k < it.layers.length; k++) {
        if (!last || (last.compareDocumentPosition(it.layers[k]) & 4)) last = it.layers[k];   /* the one latest in the page */
      }
      host.insertBefore(d, last ? last.nextSibling : host.firstChild);
    }
  }
  /* a static section can only become the fade's anchor when no descendant was placed against an ancestor
     outside it (that would move it) */
  function safeHost(sec) {
    var all = sec.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var op = all[i].offsetParent;
      if (op && !sec.contains(op) && getComputedStyle(all[i]).position === 'absolute') return false;
    }
    return true;
  }

  var observer = null, timer = 0, lastW = window.innerWidth, drawn = 0;
  function redraw() {
    timer = 0;
    var items = [];
    /* the old fades go first (they are skipped by every measurement anyway); then every read; then every write */
    clear();
    if (mode() === 'smooth') {
      try {
        items = plan().filter(function (it) { return it.host.cs.position !== 'static' || safeHost(it.host.el); });
      } catch (e) { items = []; }
    }
    if (items.length) draw(items);
    if (observer) observer.takeRecords();
    lastSig = signature();
    drawn = items.length;
  }
  function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { (window.requestAnimationFrame || setTimeout)(redraw); }, ms == null ? 60 : ms);
  }
  /* what a redraw depends on, besides sizes: the choice, the theme, and which sections are shown. A class
     a section gains while scrolling (an entrance animation, the header floating) changes none of it, so it
     costs nothing. */
  var lastSig = '';
  function signature() {
    var secs = sections(), sig = [mode(), root.getAttribute('data-theme') || '', document.body ? document.body.getAttribute('style') || '' : ''];
    for (var i = 0; i < secs.length; i++) sig.push(secs[i].hidden || getComputedStyle(secs[i]).display === 'none' ? 0 : 1);
    return sig.join('|');
  }
  function watch() {
    if (!window.MutationObserver) return;
    observer = observer || new MutationObserver(function () {
      var sig = signature();
      if (sig !== lastSig) schedule();
    });
    observer.disconnect();
    observer.observe(root, { attributes: true, attributeFilter: ['data-rv-edges', 'data-theme', 'class'] });
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    var secs = sections();
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].matches && secs[i].matches(KEEP_SHARP)) continue;
      observer.observe(secs[i], { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
      if (secs[i].parentNode) observer.observe(secs[i].parentNode, { childList: true });
    }
  }

  function start() {
    watch();
    redraw();
    document.addEventListener('rv:themechange', function () { schedule(30); });
    window.addEventListener('load', function () { schedule(0); setTimeout(function () { schedule(0); }, 900); });
    window.addEventListener('resize', function () {
      if (window.innerWidth === lastW) return;                    /* a phone's toolbar showing/hiding */
      lastW = window.innerWidth; schedule(150);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { schedule(0); });
  }

  /* redraw(): now; count(): fades on the page; clear(): take them all away (before the page is saved) */
  window.RevampBlend = { redraw: function () { redraw(); }, mode: mode, count: function () { return drawn; }, clear: function () { clear(); drawn = 0; if (observer) observer.takeRecords(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
