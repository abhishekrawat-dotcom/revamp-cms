/* RevampAwardCta — an award site's main button, which changes with the award's dates.

   An ET award site moves through four states, and its main button (in the hero, the nav, any section) says
   which one it is in:
     interest   before nominations open                 "Express Interest"                opens the interest form
     nominate   nominations open                        "Nominate Now"                    opens the nomination form
     soon       nominations closed, before the ceremony "Winners will be announced soon"  a status: not clickable
     winners    after the ceremony                      "View Winners"                    a link to the winners

   ---------------------------------------------------------------------------------------------------------
   The markup (written by the generator, the editor and the AI; never changed in the saved page)
   ---------------------------------------------------------------------------------------------------------
     <a|button data-rv-award-cta
        data-nominations-open="YYYY-MM-DD"   first day nominations are taken          (IST dates, all optional)
        data-nominations-close="YYYY-MM-DD"  last day nominations are taken
        data-ceremony="YYYY-MM-DD"           the day of the awards night
        data-nominate-form="<formId>"        the form "Nominate Now" opens            (functions/lib/forms.js ids)
        data-interest-form="<formId>"        the form "Express Interest" opens
        data-winners-href="<where>"          what "View Winners" goes to: https://… or /… (an address), #id (a
                                             part of this page), or a page's slug ("winners": the element gets
                                             data-rv-page-link="winners", and window.RevampPages.hrefFor(slug)
                                             when the site has pages; else it is taken as #winners)
        data-label-interest / data-label-nominate / data-label-soon / data-label-winners   (optional) the words
                                             of one state, instead of the defaults above
     >Neutral label</a>
   The element's own text is what a visitor without JavaScript sees, and what the saved page keeps. A
   [data-rv-award-cta-label] inside the element, when there is one, is where the words go (so an icon beside
   them stays); otherwise the element's text is replaced.

   ---------------------------------------------------------------------------------------------------------
   Which state (stateFor) — by the visitor's date in India (IST, UTC+5:30), every boundary day inclusive
   ---------------------------------------------------------------------------------------------------------
     after the ceremony day                      winners
     after the close day                         soon
     on or after the ceremony day, no close day  soon      (nominations do not run into the ceremony)
     on or after the open day                    nominate
     before the open day                         interest
     no open day, the close day still to come    nominate  (treated as open)
     nothing known                               interest
   A date that is not a real YYYY-MM-DD date counts as not known.

   ---------------------------------------------------------------------------------------------------------
   What it does with each state, on a published page, the preview and the editor's live view ("Edit with AI")
   ---------------------------------------------------------------------------------------------------------
     interest / nominate  the words; data-rv-form="<formId>" (an <a> also gets href="#rv-form-<formId>"), which
                          is how the forms runtime (rv-forms.js) opens a form in a pop-up. With no form id the
                          attribute is set empty, and rv-forms.js opens the event's default form.
     soon                 the words, aria-disabled="true", no href, no form, and a click does nothing.
     winners              the words and the link; the element is hidden when there is nowhere to go.
   Every element on the page is handled, and handled again when the date moves on while the page is open (once
   a minute) or when such an element is added. The element carries data-rv-award-state="<state>" for styling.
   None of this is ever saved: pages are only saved from the editor's canvas.

   In the editor's canvas (html[data-rv-editing] / data-rv-editor-mode="manual") nothing in the element is
   changed: a stylesheet marked data-rv-editor (the editor strips it on save, publishing too) puts a small
   "Today: Nominate Now" tag on each such element, so the editor shows what visitors see today while the saved
   page keeps its own words and attributes.

   API: window.RevampAwardCta (and module.exports, for node tests)
     stateFor(now: Date, { open, close, ceremony }) -> 'interest' | 'nominate' | 'soon' | 'winners'
     istDate(now: Date) -> 'YYYY-MM-DD'          the day it is in India at that moment
     datesOf(el) -> { open, close, ceremony }    an element's dates ('' when missing or not a date)
     labelFor(state, el) -> the words for that state
     winnersHref(value) -> { href, slug } | null the address "View Winners" goes to, or null when unsafe/empty
     apply(doc, now) -> number of elements handled (the page runtime calls it itself)
     DEFAULT_LABELS, STATES
   Plain ES5, no dependencies. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root && typeof root === 'object' && root.document) {
    if (root.__rvAwardCta) return;
    root.__rvAwardCta = true;
    root.RevampAwardCta = api;
    api._start(root);
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var VERSION = 1;
  var STATES = ['interest', 'nominate', 'soon', 'winners'];
  var DEFAULT_LABELS = {
    interest: 'Express Interest',
    nominate: 'Nominate Now',
    soon: 'Winners will be announced soon',
    winners: 'View Winners'
  };
  var SELECTOR = '[data-rv-award-cta]';
  /* the attributes that decide what an element shows */
  var INPUT_ATTRS = ['data-rv-award-cta', 'data-nominations-open', 'data-nominations-close', 'data-ceremony', 'data-nominate-form',
    'data-interest-form', 'data-winners-href', 'data-label-interest', 'data-label-nominate', 'data-label-soon', 'data-label-winners'];
  var FORM_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
  var SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/i;
  var IST_OFFSET_MS = 330 * 60000;

  /* ---------- dates ---------- */
  function str(v) { return v == null ? '' : String(v); }
  /* a real calendar date written YYYY-MM-DD, else '' */
  function cleanDate(v) {
    var s = str(v).trim(), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return '';
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return '';
    var days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
    return d <= days ? s : '';
  }
  function istDate(now) {
    var t = now instanceof Date ? now.getTime() : Number(now);
    if (!isFinite(t)) t = Date.now();
    return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
  }
  function stateFor(now, dates) {
    dates = dates || {};
    var today = istDate(now);
    var open = cleanDate(dates.open), close = cleanDate(dates.close), ceremony = cleanDate(dates.ceremony);
    if (ceremony && today > ceremony) return 'winners';
    if (close && today > close) return 'soon';
    if (!close && ceremony && today >= ceremony) return 'soon';
    if (open) return today >= open ? 'nominate' : 'interest';
    if (close) return 'nominate';     // no open day, the close day still to come (today <= close)
    return 'interest';
  }

  /* ---------- an element ---------- */
  function attr(el, name) { return el && el.getAttribute ? str(el.getAttribute(name)).trim() : ''; }
  function datesOf(el) {
    return { open: cleanDate(attr(el, 'data-nominations-open')), close: cleanDate(attr(el, 'data-nominations-close')), ceremony: cleanDate(attr(el, 'data-ceremony')) };
  }
  function oneLine(s, max) { return str(s).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 80); }
  function labelFor(state, el) {
    var own = oneLine(attr(el, 'data-label-' + state), 80);
    return own || DEFAULT_LABELS[state] || '';
  }
  function formIdOf(el, state) {
    var id = attr(el, state === 'nominate' ? 'data-nominate-form' : 'data-interest-form');
    return FORM_ID_RE.test(id) ? id : '';
  }
  /* where "View Winners" goes: an https/http address, a path on this host, #a-part-of-the-page, or a page's
     slug. Anything else (javascript:, data:, a protocol-relative //host, spaces) is nowhere. */
  function winnersHref(value) {
    var v = str(value).trim();
    if (!v || /[\s<>"'\x60\\]/.test(v)) return null;
    if (/^https?:\/\/[^\/]/i.test(v)) return { href: v, slug: '' };
    if (/^\/(?!\/)/.test(v)) return { href: v, slug: '' };
    if (/^#[A-Za-z][\w:.-]{0,120}$/.test(v)) return { href: v, slug: '' };
    if (SLUG_RE.test(v)) return { href: '#' + v, slug: v.toLowerCase() };
    return null;
  }

  /* ---------- the page runtime ---------- */
  var win = null, doc = null, html = null, timer = null, observer = null, lastDay = '', applying = false;

  function editing() {
    return !!html && (html.hasAttribute('data-rv-editing') || html.getAttribute('data-rv-editor-mode') === 'manual');
  }
  function each(list, fn) { Array.prototype.forEach.call(list || [], fn); }

  /* the text nodes that carry the element's words (never inside an svg) */
  function textNodes(el) {
    var out = [];
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { if (/\S/.test(c.nodeValue || '')) out.push(c); }
        else if (c.nodeType === 1 && !/^(svg|script|style|template)$/i.test(c.nodeName)) walk(c);
      }
    }(el));
    return out;
  }
  function setWords(el, words) {
    var slot = el.querySelector ? el.querySelector('[data-rv-award-cta-label]') : null;
    if (slot) { if (slot.textContent !== words) slot.textContent = words; return; }
    var nodes = textNodes(el);
    if (!nodes.length) {
      if (!el.firstElementChild) el.textContent = words;
      else el.appendChild(el.ownerDocument.createTextNode(words));
      return;
    }
    var lead = /^\s*/.exec(nodes[0].nodeValue)[0], trail = /\s*$/.exec(nodes[0].nodeValue)[0];
    var want = lead + words + trail;
    if (nodes[0].nodeValue !== want) nodes[0].nodeValue = want;
    for (var i = 1; i < nodes.length; i++) if (nodes[i].nodeValue !== '') nodes[i].nodeValue = '';
  }

  /* what the element had before this runtime touched it, so a later state can put it back */
  function original(el) {
    if (!el.__rvAwardOrig) {
      el.__rvAwardOrig = {
        target: el.hasAttribute('target') ? el.getAttribute('target') : null,
        display: el.style ? el.style.display : ''
      };
    }
    return el.__rvAwardOrig;
  }
  function setOrDrop(el, name, value) {
    if (value == null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  /* One element, for `now`. -> the state it shows */
  function applyOne(el, now) {
    var state = stateFor(now, datesOf(el));
    var o = original(el), isLink = String(el.tagName).toUpperCase() === 'A';
    setWords(el, labelFor(state, el));
    el.setAttribute('data-rv-award-state', state);
    var hide = false;
    if (state === 'interest' || state === 'nominate') {
      var id = formIdOf(el, state);
      setOrDrop(el, 'data-rv-form', id);
      setOrDrop(el, 'data-register-cta', null);
      if (isLink) setOrDrop(el, 'href', id ? '#rv-form-' + id : '#register');
      setOrDrop(el, 'target', null);
      setOrDrop(el, 'aria-disabled', null);
      setOrDrop(el, 'data-rv-page-link', null);
    } else if (state === 'soon') {
      setOrDrop(el, 'data-rv-form', null);
      setOrDrop(el, 'data-register-cta', null);
      if (isLink) setOrDrop(el, 'href', null);
      setOrDrop(el, 'target', null);
      setOrDrop(el, 'aria-disabled', 'true');
      setOrDrop(el, 'data-rv-page-link', null);
    } else {
      var go = winnersHref(attr(el, 'data-winners-href'));
      setOrDrop(el, 'data-rv-form', null);
      setOrDrop(el, 'data-register-cta', null);
      setOrDrop(el, 'aria-disabled', null);
      if (!go) hide = true;
      else {
        var href = go.href;
        if (go.slug) {
          setOrDrop(el, 'data-rv-page-link', go.slug);
          try {
            var pages = win && win.RevampPages;
            var resolved = pages && typeof pages.hrefFor === 'function' ? str(pages.hrefFor(go.slug)) : '';
            if (resolved && winnersHref(resolved)) href = resolved;
          } catch (e) { /* the pages runtime's own trouble: the #slug fallback stands */ }
        } else setOrDrop(el, 'data-rv-page-link', null);
        if (isLink) setOrDrop(el, 'href', href);
        el.__rvAwardHref = href;
        setOrDrop(el, 'target', o.target && /^https?:/i.test(href) ? o.target : null);
      }
    }
    if (hide) { el.hidden = true; if (el.style) el.style.display = 'none'; }
    else if (el.hidden || (el.style && el.style.display === 'none' && o.display !== 'none')) {
      el.hidden = false;
      if (el.style) el.style.display = o.display || '';
    }
    return state;
  }

  function apply(d, now) {
    d = d || doc;
    if (!d || !d.querySelectorAll) return 0;
    now = now || new Date();
    var n = 0;
    applying = true;
    try { each(d.querySelectorAll(SELECTOR), function (el) { applyOne(el, now); n++; }); }
    finally { applying = false; }
    return n;
  }

  /* a click on a "soon" status does nothing; "View Winners" on a <button> goes where a link would. Runs on the
     window in the capture phase, before the forms runtime (which listens on the document) sees the click. */
  function onClick(e) {
    if (editing()) return;
    var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
    var el = t && t.closest ? t.closest(SELECTOR) : null;
    if (!el) return;
    var state = el.getAttribute('data-rv-award-state');
    if (state === 'soon') {
      e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      e.stopPropagation();
      return;
    }
    if (state === 'winners' && String(el.tagName).toUpperCase() !== 'A' && el.__rvAwardHref) {
      var href = el.__rvAwardHref;
      e.preventDefault();
      if (href.charAt(0) === '#') {
        var target = doc.getElementById(href.slice(1));
        if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else win.location.hash = href;
      } else win.location.assign(href);
    }
  }

  /* ---------- the editor's canvas: a tag on each element, from a stylesheet the editor never saves ---------- */
  function cssString(s) {
    return '"' + str(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\f]/g, ' ') + '"';
  }
  /* a selector matching exactly the elements with this element's inputs (the same inputs: the same words) */
  function selectorOf(el) {
    return SELECTOR + INPUT_ATTRS.slice(1).map(function (a) {
      return el.hasAttribute(a) ? '[' + a + '=' + cssString(el.getAttribute(a)) + ']' : ':not([' + a + '])';
    }).join('');
  }
  function editorCss(d, now) {
    var groups = {}, order = [];
    each(d.querySelectorAll(SELECTOR), function (el) {
      var sel = selectorOf(el), g = groups[sel];
      if (!g) { g = groups[sel] = { label: labelFor(stateFor(now, datesOf(el)), el), staticPos: true }; order.push(sel); }
      try {
        var pos = win.getComputedStyle ? win.getComputedStyle(el).position : 'static';
        if (pos && pos !== 'static') g.staticPos = false;
      } catch (e) { /* not laid out */ }
    });
    var scope = 'html[data-rv-editing] ';
    return order.map(function (sel) {
      var g = groups[sel];
      return (g.staticPos ? scope + sel + '{position:relative}' : '') +
        scope + sel + '::after{content:' + cssString('Today: ' + g.label) + '}';
    }).join('\n') + (order.length ? '\n' + scope + SELECTOR + '::after{position:absolute;left:8px;top:-10px;z-index:5;max-width:none;' +
      'padding:2px 7px;border-radius:999px;background:#191b1f;color:#fff;font:600 10px/1.4 Inter,Arial,sans-serif;letter-spacing:.02em;' +
      'text-transform:none;white-space:nowrap;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.25)}' : '');
  }
  function paintEditor() {
    if (!doc.head) return;
    var st = doc.querySelector('style[data-rv-award-cta-editor]');
    var css = editorCss(doc, new Date());
    if (!st) {
      if (!css) return;
      st = doc.createElement('style');
      st.setAttribute('data-rv-editor', '');
      st.setAttribute('data-rv-award-cta-editor', '');
      doc.head.appendChild(st);
    }
    if (st.textContent !== css) st.textContent = css;
  }

  /* ---------- start ---------- */
  var LIVE_CSS = '[data-rv-award-cta][data-rv-award-state="soon"]{cursor:default}';
  function ensureLiveStyle() {
    if (!doc.head || doc.querySelector('style[data-rv-award-cta-style]')) return;
    var st = doc.createElement('style');
    st.setAttribute('data-rv-award-cta-style', '');
    st.setAttribute('data-rv-editor', '');      // never part of a saved or published page
    st.textContent = LIVE_CSS;
    doc.head.appendChild(st);
  }
  function refresh() {
    if (editing()) paintEditor();
    else { ensureLiveStyle(); apply(doc, new Date()); }
  }
  function watch() {
    if (observer || !win.MutationObserver || !doc.body) return;
    var pending = null;
    observer = new win.MutationObserver(function (records) {
      if (applying) return;
      var relevant = records.some(function (r) {
        if (r.type === 'attributes') return INPUT_ATTRS.indexOf(r.attributeName) !== -1;
        var nodes = Array.prototype.slice.call(r.addedNodes || []).concat(Array.prototype.slice.call(r.removedNodes || []));
        return nodes.some(function (n) { return n.nodeType === 1 && ((n.matches && n.matches(SELECTOR)) || (n.querySelector && n.querySelector(SELECTOR))); });
      });
      if (!relevant) return;
      clearTimeout(pending);
      pending = setTimeout(refresh, 50);
    });
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: INPUT_ATTRS });
    /* the editor turning editing on or off (it sets these on <html>) */
    observer.observe(html, { attributes: true, attributeFilter: ['data-rv-editing', 'data-rv-editor-mode'] });
  }
  function start(w) {
    win = w; doc = w.document; html = doc && doc.documentElement;
    if (!doc || !html) return;
    var go = function () {
      if (!doc.body) return;
      refresh();
      watch();
      lastDay = istDate(new Date());
      /* the day moves on while the page is open (a visitor leaving a tab open past midnight IST) */
      timer = setInterval(function () {
        var day = istDate(new Date());
        if (day !== lastDay) { lastDay = day; refresh(); }
      }, 60000);
    };
    /* capture on the window: before the forms runtime's own capture listener on the document */
    w.addEventListener('click', onClick, true);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', go);
    else go();
  }

  return {
    version: VERSION,
    STATES: STATES,
    DEFAULT_LABELS: DEFAULT_LABELS,
    stateFor: stateFor,
    istDate: istDate,
    cleanDate: cleanDate,
    datesOf: datesOf,
    labelFor: labelFor,
    winnersHref: winnersHref,
    apply: apply,
    _editorCss: function (d, now, w) { var keep = win; win = w || win || {}; try { return editorCss(d, now); } finally { win = keep; } },
    _start: start
  };
}));
