/* Tap targets on a phone, on a published or previewed site (UX-002 screen-size sweep).

   A site's own controls (an AI-designed section's, an imported design's, an ET bar or footer built before it had
   phone rules) are often smaller than a thumb: a "NOMINATE" link 17px tall, a phone number 21px, a footer link
   16px, carousel dots 8px. In a window up to 860px wide (where a site's ET bar takes its phone layout) every link,
   button and summary smaller than 40px gets a bigger area that takes the tap, while nothing on the page moves or
   changes how it looks:
     - a control that paints nothing (no background, border or shadow): padding on the side it grows, the same
       amount taken off its margin, so its box grows and its words, and everything around it, stay where they were;
     - one that paints only a background (a carousel dot): a transparent border instead of the padding, with the
       background kept to its old area (background-clip) and its corners kept round by growing their radius;
     - one with a border or a shadow and at most 8px short (a 36px arrow): it grows that little, visibly, around
       its middle (a least width and height, and the same amount taken off its margins).
   A box never grows past 4px short of the middle of another control (in a dense list each link keeps its own
   middle, as the ET footer's own phone rules do), nor past the window's sides or the page's end; a link inside a
   line of text is left as it is (it is part of the text). Once grown, each control's words, its parent and its
   neighbours are measured again, and one that moved anything goes back as it was. Places are the layout's own
   (offsetLeft and offsetTop), not those of a reveal animation passing by. It runs once the page has loaded, again
   when the window changes size, when the page adds or removes parts (a menu, a carousel's dots) and when a class
   changes. The site editor never has it: only the publish and serve pass below writes it into a page, never into
   the saved page the editor opens.

   functions/lib/site-a11y.js (pagePass) writes this file into every published and previewed page, afresh each
   time the page is served, so a site that was live before it existed has it without being published again.
   ES5, no dependencies; window.RevampTaps in a browser, module.exports in Node, where plan() is tested. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else { root.RevampTaps = api; api.start(); }
})(this, function () {
  'use strict';
  var MIN = 40, NEAR = 4, VISIBLE_MAX = 8, PHONE = '(max-width: 860px)';
  var CTRL = 'a[href],button,summary,[role="button"],[role="tab"],[role="link"]';
  var SIDES = ['top', 'right', 'bottom', 'left'];
  var grown = [], report = [];

  /* How far each side of a box may grow so that the box is MIN x MIN where there is room.
     box, others[i]: { l, t, r, b } in the page's layout (others: every other control); page: { w, h }, the window's
     width and the page's height (a box grown past them would make the page wider or longer).
     -> { top, right, bottom, left } in px, 0 where that side need not or cannot grow */
  function plan(box, others, page, min) {
    min = min || MIN;
    var needW = Math.max(0, min - (box.r - box.l)), needH = Math.max(0, min - (box.b - box.t));
    var lim = { top: Math.max(0, box.t), bottom: Math.max(0, page.h - box.b), left: Math.max(0, box.l), right: Math.max(0, page.w - box.r) };
    /* the columns and rows the box may come to cover */
    var colL = box.l - needW / 2, colR = box.r + needW / 2, rowT = box.t - needH / 2, rowB = box.b + needH / 2;
    for (var i = 0; i < (others || []).length; i++) {
      var o = others[i], cx = (o.l + o.r) / 2, cy = (o.t + o.b) / 2;
      /* a control whose middle is inside this one is a part of it (an icon button inside a card link) */
      if (cx >= box.l && cx <= box.r && cy >= box.t && cy <= box.b) continue;
      if (cx + NEAR > colL && cx - NEAR < colR) {
        if (cy >= box.b) lim.bottom = Math.min(lim.bottom, cy - NEAR - box.b);
        else if (cy <= box.t) lim.top = Math.min(lim.top, box.t - (cy + NEAR));
      }
      if (cy + NEAR > rowT && cy - NEAR < rowB) {
        if (cx >= box.r) lim.right = Math.min(lim.right, cx - NEAR - box.r);
        else if (cx <= box.l) lim.left = Math.min(lim.left, box.l - (cx + NEAR));
      }
    }
    var v = split(needH, lim.top, lim.bottom), h = split(needW, lim.left, lim.right);
    return { top: v[0], bottom: v[1], left: h[0], right: h[1] };
  }
  /* need shared by two sides: half each, and what one side has no room for goes to the other where it can; in
     half pixels, rounded up, so a 32.6px box comes to 40.6 rather than 39.6, and never past a side's room */
  function split(need, a, b) {
    a = Math.max(0, Math.floor(a * 2) / 2); b = Math.max(0, Math.floor(b * 2) / 2);
    var half = Math.ceil(need) / 2, x = Math.min(Math.ceil(half * 2) / 2, a), y = Math.min(Math.ceil((need - x) * 2) / 2, b);
    x = Math.min(Math.ceil((need - y) * 2) / 2, a);
    return [Math.max(0, x), Math.max(0, y)];
  }

  /* ---------- in the page ---------- */
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function seen(c) { return !/^(transparent|rgba\([^)]*,\s*0(\.0+)?\))$/.test(String(c || '').replace(/\s+/g, ' ').trim()); }
  /* where a control is in the page's layout, whatever a transform does to it for a moment (offsetLeft/Top), and its
     size to the fraction of a pixel (offsetWidth/Height are whole numbers: a 19.5px link planned as 20 ends at 39.5) */
  function layoutBox(el) {
    var x = 0, y = 0, e = el, r = el.getBoundingClientRect();
    while (e) { x += e.offsetLeft || 0; y += e.offsetTop || 0; e = e.offsetParent; }
    return { l: x, t: y, r: x + r.width, b: y + r.height };
  }
  function shown(el) { return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0; }
  /* a link that is a few words of a sentence: the text is the target, as everywhere on the web */
  function inText(el, cs) {
    if (cs.display !== 'inline') return false;
    var p = el.parentElement, own = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    return !!p && String(p.textContent || '').replace(/\s+/g, ' ').trim().length > own.length + 3;
  }
  /* how it may grow: 'pad' (paints nothing), 'clip' (a background only), 'visible' (a border or a shadow), or '' */
  function modeOf(cs, g) {
    var bordered = SIDES.some(function (s) {
      return num(cs.getPropertyValue('border-' + s + '-width')) > 0 && cs.getPropertyValue('border-' + s + '-style') !== 'none' && seen(cs.getPropertyValue('border-' + s + '-color'));
    });
    var shadow = cs.boxShadow && cs.boxShadow !== 'none';
    if (bordered || shadow) return g.top + g.bottom <= VISIBLE_MAX && g.left + g.right <= VISIBLE_MAX ? 'visible' : '';
    if (seen(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none')) {
      /* corners in % cannot be grown to the same curve */
      return /%/.test(cs.borderTopLeftRadius + cs.borderTopRightRadius + cs.borderBottomLeftRadius + cs.borderBottomRightRadius) ? '' : 'clip';
    }
    return 'pad';
  }
  function apply(el, cs, g, mode) {
    var s = el.style, saved = {};
    function set(p, val) {
      if (!saved.hasOwnProperty(p)) saved[p] = [s.getPropertyValue(p), s.getPropertyPriority(p)];
      s.setProperty(p, val, 'important');
    }
    var bare = SIDES.every(function (side) { return !num(cs.getPropertyValue('padding-' + side)) && !num(cs.getPropertyValue('border-' + side + '-width')); });
    if (mode === 'visible') {
      var bb = cs.boxSizing === 'border-box';
      var cw = bb ? el.offsetWidth : num(cs.width), ch = bb ? el.offsetHeight : num(cs.height);
      if (g.left || g.right) set('min-width', cw + g.left + g.right + 'px');
      if (g.top || g.bottom) set('min-height', ch + g.top + g.bottom + 'px');
      SIDES.forEach(function (side) { if (g[side]) set('margin-' + side, num(cs.getPropertyValue('margin-' + side)) - g[side] + 'px'); });
      el.__rvTaps = saved;
      grown.push(el);
      return;
    }
    SIDES.forEach(function (side) {
      var v = g[side];
      if (!v) return;
      if (mode === 'clip') {
        set('border-' + side + '-width', v + 'px'); set('border-' + side + '-style', 'solid'); set('border-' + side + '-color', 'transparent');
      } else set('padding-' + side, num(cs.getPropertyValue('padding-' + side)) + v + 'px');
      set('margin-' + side, num(cs.getPropertyValue('margin-' + side)) - v + 'px');
    });
    if (mode === 'clip') {
      set('background-clip', 'padding-box');
      /* Each corner grows by the border beside it, from the radius the browser really draws: a pill's 999px is drawn
         as half its height, and growing the 999px instead would flatten its ends. */
      var CORNERS = [['top', 'left'], ['top', 'right'], ['bottom', 'right'], ['bottom', 'left']], w = el.offsetWidth, h = el.offsetHeight;
      var radii = CORNERS.map(function (k) {
        var r = String(cs.getPropertyValue('border-' + k[0] + '-' + k[1] + '-radius') || '0').split(/\s+/);
        return [num(r[0]), num(r[1] == null ? r[0] : r[1])];
      });
      var f = Math.min(1, w / (radii[0][0] + radii[1][0] || 1), w / (radii[3][0] + radii[2][0] || 1), h / (radii[0][1] + radii[3][1] || 1), h / (radii[1][1] + radii[2][1] || 1));
      CORNERS.forEach(function (k, i) {
        var rx = radii[i][0] * f, ry = radii[i][1] * f;
        if (rx > 0 || ry > 0) set('border-' + k[0] + '-' + k[1] + '-radius', (rx + g[k[1]]) + 'px ' + (ry + g[k[0]]) + 'px');
      });
    }
    /* A box that had no padding and no border measures the same either way, so a size the page gives it (a dot's 8px,
       or the 28px it widens to when it is the current one) is kept for its content when it takes the growth outside.
       Nothing here writes a width or a height: a size the page changes later is still the page's to change. A box with
       padding or a border of its own keeps its sizing; if that squeezes its content, the check after puts it back. */
    if (bare && cs.boxSizing === 'border-box') set('box-sizing', 'content-box');
    el.__rvTaps = saved;
    grown.push(el);
  }
  function undo(el) {
    var saved = el.__rvTaps;
    if (!saved) return;
    for (var p in saved) if (saved.hasOwnProperty(p)) {
      if (saved[p][0]) el.style.setProperty(p, saved[p][0], saved[p][1]); else el.style.removeProperty(p);
    }
    el.__rvTaps = null;
  }
  function undoAll() { while (grown.length) undo(grown.pop()); }
  /* While this file measures and changes a control, the control's own transitions are held (a dot's
     "transition: all" would otherwise animate the growth, and a measure taken then is of half of it); they are
     given back once the change is drawn, so its hover and its widening when current animate as before. */
  var held = [];
  function hold(el) {
    if (el.__rvTapsT) return;
    el.__rvTapsT = [el.style.getPropertyValue('transition-property'), el.style.getPropertyPriority('transition-property')];
    el.style.setProperty('transition-property', 'none', 'important');
    held.push(el);
  }
  function release() {
    if (!held.length) return;
    void document.documentElement.offsetHeight;
    while (held.length) {
      var el = held.pop(), t = el.__rvTapsT;
      el.__rvTapsT = null;
      if (t[0]) el.style.setProperty('transition-property', t[0], t[1]); else el.style.removeProperty('transition-property');
    }
  }
  /* an element's content box on the screen: what stays where it was when a box grows the way this file grows it
     (a neighbour grown as well keeps its content box too) */
  function content(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    var l = num(cs.borderLeftWidth) + num(cs.paddingLeft), t = num(cs.borderTopWidth) + num(cs.paddingTop);
    return [r.left + l, r.top + t, r.width - l - num(cs.borderRightWidth) - num(cs.paddingRight), r.height - t - num(cs.borderBottomWidth) - num(cs.paddingBottom)];
  }
  /* an element's margin box on the screen: the room it takes in the layout, which a box grown here keeps, whichever
     way it grew */
  function room(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    var l = num(cs.marginLeft), t = num(cs.marginTop);
    return [r.left - l, r.top - t, r.width + l + num(cs.marginRight), r.height + t + num(cs.marginBottom)];
  }
  /* what must not move: the control's words, and the room its parent and its neighbours take */
  var MARKS = ['own', 'parent', 'previous', 'next'];
  function marks(el) { return [content(el), room(el.parentElement), room(el.previousElementSibling), room(el.nextElementSibling)]; }
  /* -> '' when nothing moved, else which of the marks did and by how much. t.before / t.size: as they were.
     A control's words stay put (one that grows visibly may shift them by at most half its growth, and its content
     may grow by its growth), and its box must have grown as planned: a box whose size the page fixed only squeezes
     its content, which is no bigger target. */
  function moved(t) {
    var a = t.before, b = marks(t.el), vis = t.mode === 'visible';
    for (var i = 0; i < a.length; i++) {
      if (!a[i] || !b[i]) { if (a[i] !== b[i]) return MARKS[i]; continue; }
      for (var k = 0; k < a[i].length; k++) {
        var d = b[i][k] - a[i][k], ok = 0.5;
        if (i === 0 && vis) ok = k < 2 ? VISIBLE_MAX / 2 : (k === 2 ? t.g.left + t.g.right : t.g.top + t.g.bottom) + 0.5;
        if (Math.abs(d) > ok) return MARKS[i] + ' ' + 'xywh'.charAt(k) + ' ' + Math.round(d * 10) / 10;
      }
    }
    var r = t.el.getBoundingClientRect();
    if (r.width + 0.5 < t.size[0] + t.g.left + t.g.right || r.height + 0.5 < t.size[1] + t.g.top + t.g.bottom) return 'no room';
    return '';
  }
  /* An absolutely placed control takes no room in the layout, so its margins only place it: one centred by a
     transform of half its own size (a carousel's arrow) would otherwise shift by half its growth. Its content is put
     back where it was, through its margins. */
  function place(list) {
    /* by the middle of its content: one that grows visibly has a bigger content box, around the same middle */
    list.forEach(function (t) { var c = content(t.el), o = t.before[0]; t.shift = [c[0] + c[2] / 2 - o[0] - o[2] / 2, c[1] + c[3] / 2 - o[1] - o[3] / 2]; });
    list.forEach(function (t) {
      var s = t.el.style, saved = t.el.__rvTaps, cs = getComputedStyle(t.el);
      [['margin-left', cs.marginLeft, t.shift[0]], ['margin-top', cs.marginTop, t.shift[1]]].forEach(function (m) {
        if (!m[2] || !saved) return;
        if (!saved.hasOwnProperty(m[0])) saved[m[0]] = [s.getPropertyValue(m[0]), s.getPropertyPriority(m[0])];
        s.setProperty(m[0], num(m[1]) - m[2] + 'px', 'important');
      });
    });
  }
  function run() {
    var doc = document, html = doc.documentElement;
    grown.forEach(hold);
    undoAll();
    report = [];
    if (!window.matchMedia || !window.matchMedia(PHONE).matches) return release();
    var all = Array.prototype.filter.call(doc.querySelectorAll(CTRL), function (el) {
      return el.offsetWidth != null && shown(el) && !el.disabled && !el.hasAttribute('data-rv-a11y');
    });
    /* the small ones are held still and measured again, where a transition of their own was under way */
    var boxes = all.map(layoutBox);
    all.forEach(function (el, i) { var b = boxes[i]; if (b.r - b.l < MIN || b.b - b.t < MIN) hold(el); });
    boxes = all.map(layoutBox);
    var vw = html.clientWidth, sw = html.scrollWidth, page = { w: vw, h: html.scrollHeight }, todo = [];
    all.forEach(function (el, i) {
      var b = boxes[i];
      if (b.r - b.l >= MIN && b.b - b.t >= MIN) return;
      var cs = getComputedStyle(el);
      if (inText(el, cs) || cs.position === 'fixed') return;
      var g = plan(b, boxes.filter(function (o, j) { return j !== i; }), page);
      if (!(g.top || g.right || g.bottom || g.left)) return;
      var mode = modeOf(cs, g);
      /* a border is drawn in whole pixels (3.5px is drawn as 3), so a transparent one is given whole pixels */
      if (mode === 'clip') SIDES.forEach(function (side) { g[side] = Math.ceil(g[side]); });
      if (mode) todo.push({ el: el, cs: cs, g: g, mode: mode });
    });
    todo.forEach(function (t) { var r = t.el.getBoundingClientRect(); t.before = marks(t.el); t.size = [r.width, r.height]; });
    todo.forEach(function (t) { apply(t.el, t.cs, t.g, t.mode); });
    todo.forEach(function (t) { if (t.cs.position === 'absolute') t.fix = true; });
    place(todo.filter(function (t) { return t.fix; }));
    /* All of them at once, then a look: those that moved nothing stay. One that moved something can make others
       below it look moved too (a footer's logo link moves every link under it), so those go back together and are
       then tried again one at a time, in the page's order, each kept only if it moves nothing by itself. */
    var back = todo.filter(function (t) { t.why = moved(t); return !!t.why; });
    back.forEach(function (t) { undo(t.el); });
    back.forEach(function (t) {
      apply(t.el, t.cs, t.g, t.mode);
      if (t.fix) place([t]);
      t.why = moved(t);
      if (t.why) undo(t.el);
    });
    /* and nothing may make the page wider than it was */
    var wider = html.scrollWidth > Math.max(sw, vw);
    if (wider) undoAll();
    release();
    /* what this run did, for a check of the page (RevampTaps.report()) */
    report = todo.map(function (t) { return { el: t.el, mode: t.mode, grow: t.g, kept: !!t.el.__rvTaps, why: t.why || '', wider: wider }; });
  }
  var timer = 0, first = 0, runs = [];
  function later(ms) {
    var now = Date.now();
    if (!first) first = now;
    clearTimeout(timer);
    /* a page that keeps changing is still seen to at least every 3 seconds, and one that changes its classes all the
       time (a page reacting to every run) is seen to at most once a second */
    runs = runs.filter(function (t) { return now - t < 3000; });
    if (runs.length >= 6) ms = Math.max(ms, 1000);
    timer = setTimeout(function () { first = 0; runs.push(Date.now()); try { run(); } catch (e) { undoAll(); release(); } }, now - first > 3000 ? 0 : ms);
  }
  function start() {
    if (typeof window === 'undefined' || !window.addEventListener || window.__rvTapsOn) return;
    window.__rvTapsOn = true;
    if (document.readyState === 'complete') later(0); else window.addEventListener('load', function () { later(0); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { later(100); });
    window.addEventListener('resize', function () { later(250); });
    window.addEventListener('orientationchange', function () { later(250); });
    /* Parts added or taken away (a menu, a carousel's dots): soon after. A class changed (the ET bar becoming the
       floating one as the page scrolls, a carousel's current dot): at once, as the sizes worked out for the old class
       are written on the controls and would hold them as they were (the bar's menu button out of its place). */
    if (window.MutationObserver) {
      var watch = function () {
        new MutationObserver(function (list) {
          for (var i = 0; i < list.length; i++) if (list[i].type === 'attributes') return later(30);
          later(500);
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      };
      if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
    }
  }
  return { plan: plan, split: split, run: run, start: start, report: function () { return report; }, MIN: MIN, PHONE: PHONE };
});
