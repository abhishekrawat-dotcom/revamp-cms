// node functions/lib/console-portal.test.js — an event's portal in the event console (edit-event.html) and in its
// Promotions page (marketing.html): the top bar's "Name | ETHRWorld", or "No portal yet" with Set portal while the
// event has none (RevampPortals' chip, and a button of the same words on a phone); the Basics Portal field (ET's
// roster from portal-picker.js, the stored portal chosen, "No portal yet — choose one" until one is stored, a
// change sent with ifPortal, a 409 portal-changed taken in, the notes about the site's ET bar and a published
// form); the History's "Portal set"; the Registration panel's save after a portal is set (no false "someone else
// changed" conflict, a real one still caught); and edit-event-core.js without its old table of portal names. The pages'
// functions run in a vm over a small stand-in DOM, with RevampPortals, RevampCore and the server stubbed: no
// browser, no network, no Firebase. Also runs promotions-page.test.js and promo-posts.test.js, unedited.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');

var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 10); i++) p = p.then(function () { return new Promise(function (ok) { setImmediate(ok); }); }); return p; }

var CONSOLE = read('edit-event.html'), PROMO = read('marketing.html'), CORE = read('edit-event-core.js');
function inlineScripts(page) { return (page.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); }); }
var MAIN = inlineScripts(CONSOLE).filter(function (s) { return s.indexOf('function wireBasics') !== -1; })[0] || '';
var SHELL = inlineScripts(PROMO).filter(function (s) { return s.indexOf('var TABS = [') !== -1; })[0] || '';

/* a top-level function of a page's script (two-space indent, as both pages write them) */
function fnSrc(src, name) {
  var m = new RegExp('\\n  function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}\\n').exec(src);
  return m ? m[0] : '';
}
function varSrc(src, name) {
  var m = new RegExp('\\n  var ' + name + '\\b[^\\n]*\\n').exec(src);
  return m ? m[0] : '';
}
function es5Clean(code) {
  var c = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  return !/\blet\s/.test(c) && !/\bconst\s/.test(c) && c.indexOf('=>') === -1 && c.indexOf('`') === -1 &&
    !/\bclass\s/.test(c) && !/\basync\b|\bawait\b/.test(c) && c.indexOf('...') === -1;
}

/* ---------- a small stand-in DOM ---------- */
function unesc(s) { return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function attrsOf(s) { var a = {}, m, re = /([\w-]+)(?:="([^"]*)")?/g; while ((m = re.exec(s))) a[m[1]] = m[2] === undefined ? '' : unesc(m[2]); return a; }
function classList(initial) {
  var set = {};
  String(initial || '').split(/\s+/).filter(Boolean).forEach(function (c) { set[c] = true; });
  return {
    add: function (c) { set[c] = true; }, remove: function (c) { delete set[c]; }, contains: function (c) { return !!set[c]; },
    toggle: function (c, force) { var on = force === undefined ? !set[c] : !!force; if (on) set[c] = true; else delete set[c]; return on; }
  };
}
function makeDom() {
  var els = {}, dom = { els: els, activeElement: null, body: { id: 'body' } };
  dom.activeElement = dom.body;
  function el(id, tag, attrs) {
    attrs = attrs || {};
    var e = { id: id, tagName: String(tag).toUpperCase(), attrs: attrs, hidden: Object.prototype.hasOwnProperty.call(attrs, 'hidden'),
      disabled: false, style: {}, listeners: {}, classList: classList(attrs.class), textContent: '', parentNode: null, _html: '', _q: {} };
    e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
    e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
    e.removeAttribute = function (k) { delete e.attrs[k]; };
    e.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k); };
    e.addEventListener = function (t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); };
    e.fire = function (t, ev) { ev = ev || {}; if (!ev.target) ev.target = e; (e.listeners[t] || []).forEach(function (fn) { fn(ev); }); };
    e.focus = function () { dom.activeElement = e; };
    e.scrollIntoView = function () {};
    e.closest = function () { return null; };
    e.querySelector = function (sel) { return e._q[sel] || (e._q[sel] = { style: {}, textContent: '' }); };
    e.querySelectorAll = function () { return []; };
    if (e.tagName === 'SELECT') {
      e.options = []; e.selectedIndex = -1;
      Object.defineProperty(e, 'innerHTML', { get: function () { return e._html; }, set: function (v) {
        e._html = String(v); e.options = [];
        var m, re = /<option\b([^>]*)>([\s\S]*?)<\/option>/g, picked = -1;
        while ((m = re.exec(e._html))) {
          var a = attrsOf(m[1]), text = unesc(m[2].replace(/<[^>]*>/g, ''));
          e.options.push({ value: Object.prototype.hasOwnProperty.call(a, 'value') ? a.value : text, text: text, textContent: text,
            disabled: Object.prototype.hasOwnProperty.call(a, 'disabled') });
          if (Object.prototype.hasOwnProperty.call(a, 'selected')) picked = e.options.length - 1;
        }
        /* as a browser does: the last option marked selected, else the first one that is not disabled */
        if (picked < 0) for (var i = 0; i < e.options.length; i++) if (!e.options[i].disabled) { picked = i; break; }
        e.selectedIndex = picked;
      } });
      Object.defineProperty(e, 'value', { get: function () { var o = e.options[e.selectedIndex]; return o ? o.value : ''; }, set: function (v) {
        e.selectedIndex = -1;
        for (var i = 0; i < e.options.length; i++) if (e.options[i].value === String(v)) { e.selectedIndex = i; break; }
      } });
    } else {
      Object.defineProperty(e, 'innerHTML', { get: function () { return e._html; }, set: function (v) { e._html = String(v); } });
      e.value = attrs.value !== undefined ? attrs.value : '';
    }
    return e;
  }
  /* every element of the markup with an id, by id; a select gets its options, a textarea its text */
  dom.mount = function (html) {
    var m, re = /<(\w+)\b([^>]*)>/g;
    while ((m = re.exec(html))) {
      var a = attrsOf(m[2]);
      if (!a.id) continue;
      var e = el(a.id, m[1], a), close = '</' + m[1] + '>';
      if (/^(select|textarea)$/i.test(m[1])) {
        var end = html.indexOf(close, re.lastIndex), inner = html.slice(re.lastIndex, end);
        if (/^select$/i.test(m[1])) e.innerHTML = inner; else e.value = unesc(inner);
      }
      els[a.id] = e;
    }
  };
  dom.el = el;
  dom.$ = function (id) { return els[id] || null; };
  return dom;
}
/* the top bar both pages share: the name, the date line and the chip, inside the line that holds them */
function topbar(dom, withChip) {
  dom.els['ev-name'] = dom.el('ev-name', 'h1');
  var sub = dom.el('', 'span', { class: 'ev-sub' });
  dom.els['ev-meta'] = dom.el('ev-meta', 'span', { class: 'meta' });
  dom.els['ev-meta'].parentNode = sub;
  if (withChip) { dom.els['ev-portal'] = dom.el('ev-portal', 'span', { class: 'ev-portal', hidden: '' }); dom.els['ev-portal'].parentNode = sub; }
  return sub;
}
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

/* RevampPortals as portal-picker.js gives it (contract K9), recording what is asked of it.
   o: { listFails, noPlaceholder (an optionsHtml that leaves the placeholder out) } */
var ROSTER = [{ slug: 'auto', name: 'ETAuto' }, { slug: 'cio', name: 'ETCIO' }, { slug: 'hr', name: 'ETHRWorld' }];
function fakePortals(o) {
  o = o || {};
  var log = { open: [], chip: [], options: [], list: 0 };
  var RP = {
    log: log,
    list: function () { log.list++; return o.listFails ? Promise.reject(new Error('The portal list could not be loaded.')) : Promise.resolve(ROSTER.slice()); },
    nameOf: function (slug) { var p = ROSTER.filter(function (x) { return x.slug === slug; })[0]; return p ? p.name : ''; },
    optionsHtml: function (current, placeholder) {
      log.options.push([current, placeholder]);
      return (placeholder && !o.noPlaceholder ? '<option value="" disabled' + (current ? '' : ' selected') + '>' + escHtml(placeholder) + '</option>' : '') +
        ROSTER.map(function (p) { return '<option value="' + p.slug + '"' + (p.slug === current ? ' selected' : '') + '>' + escHtml(p.name) + '</option>'; }).join('');
    },
    chipHtml: function (opts) {
      log.chip.push(opts);
      return '<span class="rvp-chip">No portal yet</span><button type="button" class="rvp-set" data-set-portal="' + escHtml(opts.eventId) + '">Set portal</button>';
    },
    openSetPortal: function (opts) { log.open.push(opts); }
  };
  return RP;
}
/* a click inside the chip: closest('[data-set-portal]') finds the button */
function chipClick(host) { host.onclick({ target: { closest: function (sel) { return sel === '[data-set-portal]' ? { id: 'btn' } : null; } } }); }

/* ======================= 1. edit-event-core.js keeps no portal table ======================= */
check('1 core: no portal table', !/var PORTALS\b/.test(CORE) && !/\bhrworld\b/.test(CORE) && !/\bgov:/.test(CORE));
check('1 core: no PORTALS anywhere (export, ctx or doc)', CORE.indexOf('PORTALS') === -1);
check('1 core parses (node --check)', (function () { try { new vm.Script(CORE); return true; } catch (e) { return false; } })());
var coreSb = { window: {}, document: { getElementById: function () { return null; } }, console: console, setTimeout: setTimeout, Promise: Promise };
coreSb.window = coreSb;
var fetched = [];
coreSb.RevampAuth = { authedFetch: function (url, opts) {
  fetched.push({ url: url, opts: opts });
  var body = JSON.parse(opts.body);
  if (body.ifPortal === 'stale') return Promise.resolve({ ok: false, status: 409, json: function () {
    return Promise.resolve({ error: 'This event’s portal was changed to ETCIO meanwhile. Reload to see it.', code: 'portal-changed', current: 'cio', currentName: 'ETCIO' });
  } });
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true, updatedAt: '2026-11-03T10:00:00.000Z' }); } });
} };
vm.runInNewContext(CORE, coreSb, { filename: 'edit-event-core.js' });
var RC = coreSb.RevampCore;
check('1 core loads: RevampCore without PORTALS, TYPES kept', !!RC && RC.PORTALS === undefined && !!RC.TYPES && RC.TYPES.ip === 'IP Event');
check('1 core: the bundle a section receives has no PORTALS', RC && RC.makeCtx({}).PORTALS === undefined && !!RC.makeCtx({}).TYPES);
var pending = [];
pending.push(RC.updateEvent('ev-1', { portal: 'cio', ifPortal: 'hr' }).then(function (r) {
  var b = JSON.parse(fetched[0].opts.body);
  check('1 core: updateEvent sends the portal and ifPortal as given', fetched[0].opts.method === 'PATCH' && fetched[0].url === '/api/event' &&
    b.eventId === 'ev-1' && b.portal === 'cio' && b.ifPortal === 'hr' && r.ok === true, b);
  return RC.updateEvent('ev-1', { portal: 'auto', ifPortal: 'stale' }).then(function () { check('1 core: a 409 rejects', false); }, function (err) {
    check('1 core: a 409 portal-changed rejects with code, current and currentName', err.status === 409 && err.code === 'portal-changed' &&
      err.current === 'cio' && err.currentName === 'ETCIO' && /changed to ETCIO/.test(err.message), { status: err.status, code: err.code });
  });
}));
/* nothing else in the browser code reads the old table */
var stray = fs.readdirSync(ROOT).filter(function (f) { return /\.(html|js)$/.test(f); }).filter(function (f) {
  return /\b(?:C|RevampCore|ctx|CTX|core)\.PORTALS\b/.test(read(f));
});
check('1 no page or section file reads RevampCore.PORTALS', !stray.length, stray);

/* ======================= 2-4, 7. the console (edit-event.html) ======================= */
check('2 the console\'s script was found', MAIN.length > 100000);
check('2 the console loads portal-picker.js right after auth.js', /<script src="auth\.js"><\/script>\s*<!--[^>]*-->\s*<script src="portal-picker\.js"><\/script>/.test(CONSOLE) &&
  (CONSOLE.match(/<script src="portal-picker\.js">/g) || []).length === 1);
check('2 the console\'s top bar has #ev-portal, hidden, right after #ev-meta', /<span class="meta" id="ev-meta"><\/span>\s*<!--[^>]*-->\s*<span class="ev-portal" id="ev-portal" hidden><\/span>/.test(CONSOLE));
check('2 the console\'s window title before an event loads says Oneworld 2.0', /<title>Edit Event &mdash; Oneworld 2\.0<\/title>/.test(CONSOLE) && CONSOLE.indexOf('Revamp CMS') === -1);
check('2 the console no longer reads a table of portal names', !/\bPORTALS\b/.test(MAIN));

var NAMES = ['shownPortal', 'rosterName', 'paintPortalChip', 'openSetPortal', 'portalSet', 'paintHeader', 'errText', 'localIso', 'fgroup', 'viewBasics', 'wireBasics',
  'regSettings', 'buildRegForms', 'wireSetForm'];
var CONSOLE_FNS = {};
NAMES.forEach(function (n) { CONSOLE_FNS[n] = fnSrc(MAIN, n); check('2 found function ' + n, !!CONSOLE_FNS[n]); });
var CONSOLE_VARS = ['NO_PORTAL_CHOICE', 'NO_PORTAL_SITE_NAME', 'BASICS_PORTAL', 'DESC_MIN', 'REGF'].map(function (n) { var s = varSrc(MAIN, n); check('2 found var ' + n, !!s); return s; }).join('');

/* a node the page builds itself (the Registration panel): what its markup holds, found by #id */
function builtNode() {
  var inner = makeDom(), n = { className: '', _html: '', inner: inner };
  Object.defineProperty(n, 'innerHTML', { get: function () { return n._html; }, set: function (v) { n._html = String(v); inner.mount(n._html); } });
  n.querySelector = function (sel) { return sel.charAt(0) === '#' ? inner.$(sel.slice(1)) : null; };
  return n;
}

/* the console's functions over the stand-in DOM.
   o: { ev, RP, noChip, update(patch, opts) -> promise, fetch(id) -> promise (C.fetchEvent) } */
function loadConsole(o) {
  o = o || {};
  var dom = makeDom(), toasts = [], updates = [], fieldErrs = [], cleared = [], fetches = [];
  var sub = topbar(dom, !o.noChip);
  var sb = {
    console: { log: function () {}, error: function () {} }, setTimeout: function (fn) { fn(); }, Promise: Promise,
    document: { title: '', get activeElement() { return dom.activeElement; }, body: dom.body, getElementById: dom.$, createElement: builtNode },
    $: dom.$, esc: escHtml, svg: function () { return ''; }, IC: {}, TYPES: { ip: 'IP Event', awards: 'Awards' },
    fmtDT: function (v) { return v ? '12 Nov 2026' : 'Date to be announced'; }, fmtDate: function () { return '12 Nov 2026'; },
    panel: function (t, s, body) { return '<section>' + body + '</section>'; }, vhead: function () { return ''; },
    imgTag: function () { return ''; }, logoUnitCallout: function () { return ''; },
    clearFieldError: function (i) { cleared.push(i && i.id); }, showFieldErrors: function (errs) { fieldErrs.push(errs); },
    notify: function (m, ms) { toasts.push([m, ms]); },
    LEAVE: null, EV: null,
    C: {
      CATEGORY_KEYS: ['ip', 'client', 'awards'], typeLabel: function (k) { return ({ ip: 'IP Event', awards: 'Awards' })[k] || k; },
      updateEvent: function (id, patch, opts) {
        updates.push({ id: id, patch: JSON.parse(JSON.stringify(patch)), opts: opts ? JSON.parse(JSON.stringify(opts)) : undefined });
        return o.update ? o.update(patch, opts) : Promise.resolve({ ok: true });
      },
      fetchEvent: function (id) { fetches.push(id); return o.fetch ? o.fetch(id) : Promise.reject(new Error('fetchEvent was not expected here')); }
    }
  };
  sb.window = sb;
  if (o.RP) sb.RevampPortals = o.RP;
  vm.runInNewContext(CONSOLE_VARS + NAMES.map(function (n) { return CONSOLE_FNS[n]; }).join('\n'), sb, { filename: 'edit-event.html' });
  sb.EV = o.ev;
  return { sb: sb, dom: dom, sub: sub, toasts: toasts, updates: updates, fieldErrs: fieldErrs, cleared: cleared, fetches: fetches,
    $: dom.$, basics: function () { dom.mount(sb.viewBasics()); sb.wireBasics(); } };
}

/* ---- 2. the header ---- */
(function () {
  var RP = fakePortals();
  var c = loadConsole({ ev: { id: 'ev-1', name: 'Agentic AI Summit', portal: 'hr', portalName: 'ETHRWorld', start: '2026-11-12', category: 'ip' }, RP: RP });
  c.sb.paintHeader();
  check('2 header with a portal: "Name | ETHRWorld"', c.$('ev-name').textContent === 'Agentic AI Summit | ETHRWorld', c.$('ev-name').textContent);
  check('2 … the date line as before', c.$('ev-meta').textContent === '12 Nov 2026  |  IP Event', c.$('ev-meta').textContent);
  check('2 … the chip hidden and empty, and no room kept for it', c.$('ev-portal').hidden === true && c.$('ev-portal').innerHTML === '' && !c.sub.classList.contains('has-portal-chip'));
  check('2 … the window title says Oneworld 2.0', c.sb.document.title === 'Edit — Agentic AI Summit — Oneworld 2.0', c.sb.document.title);

  var n = loadConsole({ ev: { id: 'ev-2', name: '  ', portal: '', portalName: '', start: '2026-11-12', category: 'awards', generatedAt: '2026-10-01T00:00:00Z', published: true }, RP: fakePortals() });
  n.sb.paintHeader();
  var host = n.$('ev-portal');
  check('2 header without a portal: the name alone', n.$('ev-name').textContent === 'Untitled event', n.$('ev-name').textContent);
  check('2 … the chip shown: RevampPortals\' "No portal yet" and Set portal', host.hidden === false && host.innerHTML.indexOf('No portal yet') !== -1 &&
    /<span class="ev-portal-wide"><span class="rvp-chip">No portal yet<\/span><button[^>]*data-set-portal="ev-2"[^>]*>Set portal<\/button><\/span>/.test(host.innerHTML), host.innerHTML);
  check('2 … with the phone\'s button of the same words', /<button type="button" class="ev-portal-mini" data-set-portal="ev-2" aria-label="No portal yet\. Set portal">Set portal<\/button>/.test(host.innerHTML), host.innerHTML);
  check('2 … the chip was asked for this event', n.sb.RevampPortals.log.chip.length === 1 && n.sb.RevampPortals.log.chip[0].eventId === 'ev-2');
  check('2 … the line that holds it knows (the phone hides the date line for the button)', n.sub.classList.contains('has-portal-chip'));
  check('2 … the title says Oneworld 2.0', n.sb.document.title === 'Edit — Untitled event — Oneworld 2.0');
  chipClick(host);
  var op = n.sb.RevampPortals.log.open[0];
  check('2 Set portal opens RevampPortals\' dialog for this event, with no portal current, and the site\'s facts', !!op && op.eventId === 'ev-2' &&
    op.eventName === 'Untitled event' && op.current === '' && op.hasGeneratedSite === true && op.published === true && typeof op.onDone === 'function', op);
  op.onDone('cio', 'ETCIO');
  check('2 once set: the header names the portal and the chip goes', n.$('ev-name').textContent === 'Untitled event | ETCIO' && host.hidden === true &&
    host.innerHTML === '' && !n.sub.classList.contains('has-portal-chip'));
  check('2 … EV holds it, and the toast says so', n.sb.EV.portal === 'cio' && n.sb.EV.portalName === 'ETCIO' &&
    n.toasts.length === 1 && n.toasts[0][0] === 'Portal set to ETCIO.', n.toasts);
  check('2 … focus goes to the event\'s name (the button that opened the dialog has gone)', n.dom.activeElement === n.$('ev-name') && n.$('ev-name').attrs.tabindex === '-1');
  var n2 = loadConsole({ ev: { id: 'ev-3', name: 'X', portal: '', portalName: '' }, RP: fakePortals() });
  n2.sb.paintHeader(); chipClick(n2.$('ev-portal'));
  n2.sb.RevampPortals.log.open[0].onDone('auto', '');
  check('2 a name the dialog leaves out is the roster\'s', n2.sb.EV.portalName === 'ETAuto' && n2.$('ev-name').textContent === 'X | ETAuto');

  var off = loadConsole({ ev: { id: 'ev-4', name: 'Y', portal: 'hrworld', portalName: '' }, RP: fakePortals() });
  off.sb.paintHeader(); chipClick(off.$('ev-portal'));
  check('2 a stored value off the roster (no name from the server) counts as none: the chip, and current \'\'', off.$('ev-portal').hidden === false &&
    off.$('ev-name').textContent === 'Y' && off.sb.RevampPortals.log.open[0].current === '', off.sb.RevampPortals.log.open[0]);

  var bare = loadConsole({ ev: { id: 'ev-5', name: 'Z', portal: '', portalName: '' } });
  var ok = (function () { try { bare.sb.paintHeader(); return true; } catch (e) { return e.message; } })();
  check('2 tolerated with no RevampPortals: no error, the chip left hidden', ok === true && bare.$('ev-portal').hidden === true && bare.$('ev-portal').innerHTML === '', ok);
  var noHost = loadConsole({ ev: { id: 'ev-6', name: 'Z', portal: 'hr', portalName: 'ETHRWorld' }, RP: fakePortals(), noChip: true });
  ok = (function () { try { noHost.sb.paintHeader(); return true; } catch (e) { return e.message; } })();
  check('2 tolerated with no #ev-portal', ok === true && noHost.$('ev-name').textContent === 'Z | ETHRWorld', ok);
  var noBoth = loadConsole({ ev: { id: 'ev-7', name: 'Z', portal: '', portalName: '' }, noChip: true });
  ok = (function () { try { noBoth.sb.paintHeader(); return true; } catch (e) { return e.message; } })();
  check('2 tolerated with neither', ok === true && noBoth.$('ev-name').textContent === 'Z', ok);
})();

/* ---- 3, 4. previewBits' fallback; the History's label; Basics stores the portal ---- */
check('3 previewBits\' fallback is the name the site shows: The Economic Times Business Verticals',
  /var NO_PORTAL_SITE_NAME = 'The Economic Times Business Verticals';/.test(MAIN) &&
  /portal: portalName\(v\('portal'\)\) \|\| NO_PORTAL_SITE_NAME \}/.test(CONSOLE_FNS.wireBasics) && MAIN.indexOf("'ET Oneworld' }") === -1);
var histSrc = (/\n  var HIST_AREA = (\{[\s\S]*?\});\n/.exec(MAIN) || [])[1];
var HIST = histSrc ? vm.runInNewContext('(' + histSrc + ')') : {};
check('4 HIST_AREA[\'portal-set\'] is "Portal set"', HIST['portal-set'] === 'Portal set' && HIST.created === 'Event created', HIST['portal-set']);
var storedSrc = (/\n    var STORED = (\{[^}]*\});/.exec(CONSOLE_FNS.wireBasics) || [])[1];
var STORED = storedSrc ? vm.runInNewContext('(' + storedSrc + ')') : {};
check('4 STORED.portal is \'portal\' (the other fields as they were)', STORED.portal === 'portal' && STORED.cat === 'category' && STORED.desc === 'description' &&
  Object.keys(STORED).length === 8, STORED);

/* ---- Basics, in the vm ---- */
function ready(c) { var m = c.$('b-rdy').innerHTML; return m; }
function dirty(c) { return c.$('b-savebar').classList.contains('on'); }
function pick(c, v) { c.$('b-portal').value = v; c.$('b-portal').fire('change'); }

/* a stored portal: the list, a change sent with ifPortal, the notes */
pending.push((function () {
  var RP = fakePortals();
  var c = loadConsole({ ev: { id: 'ev-b1', name: 'Agentic AI Summit', portal: 'hr', portalName: 'ETHRWorld', start: '2026-11-12T10:00', category: 'ip',
    venue: 'Taj', city: 'Mumbai', description: 'Two days of agentic AI in practice, from the people who run it in India’s largest firms.', generatedAt: '2026-10-01T00:00:00Z', published: true }, RP: RP });
  c.sb.paintHeader();
  c.basics();
  var sel = c.$('b-portal');
  check('B1 the Portal field: a select after Category, before the roster has come it holds the stored portal alone',
    !!sel && sel.options.length === 1 && sel.value === 'hr' && sel.options[0].text === 'ETHRWorld', sel && sel.options);
  var html = c.sb.viewBasics();
  check('B1 its markup: label, the select, the hint, the note; a c6 field after Category', /<div class="field c6"><label for="b-cat">Category<\/label>[\s\S]*?<\/div><div class="field c6"><label for="b-portal">Portal<\/label><select class="inp" id="b-portal">/.test(html) &&
    html.indexOf('<p class="hint">Its previous editions, its site’s ET bar and footer, and its mailers’ branding come from this portal.</p>') !== -1 &&
    html.indexOf('<p class="hint" id="b-portal-note" hidden></p>') !== -1);
  check('B1 the listing preview names the stored portal', c.$('b-preview').innerHTML.indexOf('ETHRWorld presents') !== -1);
  return tick().then(function () {
    check('B1 once the roster has come: every portal, the stored one chosen, no "No portal yet" choice', sel.options.length === 3 && sel.value === 'hr' &&
      !sel.options.some(function (x) { return x.value === ''; }) && JSON.stringify(RP.log.options[0]) === '["hr",null]', { opts: sel.options, asked: RP.log.options });
    check('B1 … and the form is not dirty', !dirty(c));
    check('B1 the readiness list has Portal, done', /data-field="b-portal"/.test(ready(c)) && /class="rdy-item on" data-field="b-portal"/.test(ready(c)) && c.$('b-rdyn').textContent === '6 / 6', c.$('b-rdyn').textContent);
    pick(c, 'cio');
    check('B1 choosing ETCIO: one field edited', dirty(c) && c.$('b-sbwhat').textContent === '1 field edited');
    check('B1 … and the preview follows it before it is saved', c.$('b-preview').innerHTML.indexOf('ETCIO presents') !== -1);
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    var u = c.updates[0];
    check('B1 the save sends the portal with ifPortal, the portal the page showed', c.updates.length === 1 && u.id === 'ev-b1' &&
      JSON.stringify(u.patch) === JSON.stringify({ portal: 'cio', ifPortal: 'hr' }), u);
    check('B1 once saved: EV and the header follow', c.sb.EV.portal === 'cio' && c.sb.EV.portalName === 'ETCIO' && c.$('ev-name').textContent === 'Agentic AI Summit | ETCIO');
    check('B1 … not dirty, the list still the roster with ETCIO chosen', !dirty(c) && sel.value === 'cio' && sel.options.length === 3);
    var t = c.toasts[c.toasts.length - 1];
    check('B1 the save note (an AI-designed, published site): the bar and footer, and the live form\'s links', !!t &&
      t[0] === 'Basics saved. The site keeps its ET bar and footer; they change to ETCIO only if the site is generated again. Its live registration form keeps its privacy links until it is published again.' &&
      t[1] === 9000, t);
    check('B1 … and it stays under the field', c.$('b-portal-note').hidden === false &&
      c.$('b-portal-note').textContent === 'The site keeps its ET bar and footer; they change to ETCIO only if the site is generated again. Its live registration form keeps its privacy links until it is published again.');
    /* a change of the name alone sends no portal */
    c.$('b-name').value = 'Agentic AI Summit 2027'; c.$('b-name').fire('input');
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('B1 a change of the name alone sends no portal and no ifPortal', JSON.stringify(c.updates[1].patch) === JSON.stringify({ name: 'Agentic AI Summit 2027' }), c.updates[1]);
    check('B1 … and says only "Basics saved"', c.toasts[c.toasts.length - 1][0] === 'Basics saved' && c.toasts[c.toasts.length - 1][1] === 0);
  });
})());

/* no portal yet: the first choice, the first save, the choice going */
pending.push((function () {
  var RP = fakePortals();
  var c = loadConsole({ ev: { id: 'ev-b2', name: 'Retail Summit', portal: '', portalName: '', category: 'ip' }, RP: RP });
  c.sb.paintHeader();
  c.basics();
  var sel = c.$('b-portal');
  check('B2 no portal: the list says "No portal yet — choose one", chosen', sel.options.length === 1 && sel.value === '' && sel.options[0].text === 'No portal yet — choose one');
  check('B2 … the preview names what the site shows instead', c.$('b-preview').innerHTML.indexOf('The Economic Times Business Verticals presents') !== -1);
  check('B2 … the readiness list asks for it', /data-field="b-portal"><span class="tick"><\/span><span class="lb">Portal<span class="why">Choose the portal it belongs to<\/span>/.test(ready(c)), ready(c));
  return tick().then(function () {
    check('B2 once the roster has come: "No portal yet" first and chosen, then every portal', sel.options.length === 4 && sel.value === '' &&
      sel.options[0].value === '' && JSON.stringify(RP.log.options[0]) === '["","No portal yet — choose one"]' && !dirty(c), { opts: sel.options, asked: RP.log.options });
    pick(c, 'hr');
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('B2 the first portal is sent with ifPortal \'\'', JSON.stringify(c.updates[0].patch) === JSON.stringify({ portal: 'hr', ifPortal: '' }), c.updates[0]);
    check('B2 once stored, the "No portal yet" choice is gone', sel.options.length === 3 && sel.value === 'hr' && !sel.options.some(function (x) { return x.value === ''; }));
    check('B2 … the header names it and the chip goes', c.$('ev-name').textContent === 'Retail Summit | ETHRWorld' && c.$('ev-portal').hidden === true);
    check('B2 no site and not published: just "Basics saved", no note', c.toasts[c.toasts.length - 1][0] === 'Basics saved' && c.$('b-portal-note').hidden === true);
  });
})());

/* a picker that draws no placeholder still leaves a "No portal yet" choice; an off-roster value counts as none */
pending.push((function () {
  var c = loadConsole({ ev: { id: 'ev-b3', name: 'Q', portal: 'hrworld', portalName: '' }, RP: fakePortals({ noPlaceholder: true }) });
  c.sb.paintHeader();
  c.basics();
  var sel = c.$('b-portal');
  return tick().then(function () {
    check('B3 an off-roster value: "No portal yet" chosen, added even when the picker draws no placeholder', sel.value === '' && sel.options[0].value === '' &&
      sel.options[0].text === 'No portal yet — choose one' && sel.options.length === 4 && !dirty(c), sel.options);
    pick(c, 'auto');
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('B3 … its first portal is sent with ifPortal \'\' (as the server counts it)', JSON.stringify(c.updates[0].patch) === JSON.stringify({ portal: 'auto', ifPortal: '' }), c.updates[0]);
  });
})());

/* a stored portal can be changed, never removed */
pending.push((function () {
  var c = loadConsole({ ev: { id: 'ev-b4', name: 'Q', portal: 'cio', portalName: 'ETCIO' }, RP: fakePortals() });
  c.sb.paintHeader();
  c.basics();
  var sel = c.$('b-portal');
  return tick().then(function () {
    sel.innerHTML = '<option value="">No portal</option>' + sel.innerHTML;
    pick(c, '');
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('B4 removing a stored portal is refused at the field, and nothing is sent', !c.updates.length && c.fieldErrs.length === 1 &&
      JSON.stringify(c.fieldErrs[0]) === JSON.stringify([['b-portal', 'An event’s portal can be changed, not removed. Choose another portal.']]), c.fieldErrs);
  });
})());

/* a 409 portal-changed: the page takes the portal now stored, keeps the person's choice, and Try again sends it knowingly */
pending.push((function () {
  var n = 0;
  var c = loadConsole({ ev: { id: 'ev-b5', name: 'Q', portal: 'hr', portalName: 'ETHRWorld', venue: 'Taj' }, RP: fakePortals(), update: function () {
    n++;
    if (n > 1) return Promise.resolve({ ok: true });
    var err = new Error('This event’s portal was changed to ETAuto meanwhile. Reload to see it.');
    err.status = 409; err.code = 'portal-changed'; err.current = 'auto'; err.currentName = 'ETAuto';
    return Promise.reject(err);
  } });
  c.sb.paintHeader();
  c.basics();
  var sel = c.$('b-portal');
  return tick().then(function () {
    pick(c, 'cio');
    c.$('b-venue').value = 'Oberoi'; c.$('b-venue').fire('input');
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('B5 the refused save sent ifPortal hr', JSON.stringify(c.updates[0].patch) === JSON.stringify({ portal: 'cio', venue: 'Oberoi', ifPortal: 'hr' }), c.updates[0]);
    check('B5 after 409: EV and the header take the stored portal', c.sb.EV.portal === 'auto' && c.sb.EV.portalName === 'ETAuto' && c.$('ev-name').textContent === 'Q | ETAuto');
    check('B5 … the person\'s choice stays in the list, still unsaved, with the server\'s sentence', sel.value === 'cio' && dirty(c) &&
      c.$('b-sbhead').textContent === 'Not saved' && c.$('b-sbwhat').textContent === 'This event’s portal was changed to ETAuto meanwhile. Reload to see it.');
    check('B5 … the other change is kept too', c.$('b-venue').value === 'Oberoi' && c.$('b-sbwhat') && c.$('b-save').textContent === 'Try again');
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('B5 Try again sends the choice with ifPortal now the stored one', JSON.stringify(c.updates[1].patch) === JSON.stringify({ portal: 'cio', venue: 'Oberoi', ifPortal: 'auto' }), c.updates[1]);
    check('B5 … and is saved', c.sb.EV.portal === 'cio' && c.sb.EV.portalName === 'ETCIO' && !dirty(c));
  });
})());

/* the top bar's Set portal while Basics is on screen: both the list and what counts as saved follow */
pending.push((function () {
  var RP = fakePortals();
  var c = loadConsole({ ev: { id: 'ev-b6', name: 'Q', portal: '', portalName: '', venue: 'Taj' }, RP: RP });
  c.sb.paintHeader();
  c.basics();
  var sel = c.$('b-portal');
  return tick().then(function () {
    c.$('b-venue').value = 'Oberoi'; c.$('b-venue').fire('input');
    chipClick(c.$('ev-portal'));
    RP.log.open[0].onDone('hr', 'ETHRWorld');
    check('B6 Set portal from the top bar: the Basics list shows it, with no "No portal yet" choice', sel.value === 'hr' && sel.options.length === 3 &&
      !sel.options.some(function (x) { return x.value === ''; }), sel.options);
    check('B6 … the portal is not an unsaved change; the venue still is', dirty(c) && c.$('b-sbwhat').textContent === '1 field edited');
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('B6 … so Save sends the venue alone, never the portal again', JSON.stringify(c.updates[0].patch) === JSON.stringify({ venue: 'Oberoi' }), c.updates[0]);
    /* Basics left: the top bar's Set portal no longer touches its old list */
    c.dom.els['b-portal'] = c.dom.el('b-portal', 'select');
    var ok = (function () { try { c.sb.portalSet('auto', 'ETAuto'); return true; } catch (e) { return e.message; } })();
    check('B6 once Basics is left, Set portal still updates the header and touches no old field', ok === true && c.$('ev-name').textContent === 'Q | ETAuto' && sel.value === 'hr', ok);
  });
})());

/* the roster could not be loaded; and no portal-picker.js at all */
pending.push((function () {
  var c = loadConsole({ ev: { id: 'ev-b7', name: 'Q', portal: 'hr', portalName: 'ETHRWorld' }, RP: fakePortals({ listFails: true }) });
  c.sb.paintHeader();
  c.basics();
  var bare = loadConsole({ ev: { id: 'ev-b8', name: 'Q', portal: 'hr', portalName: 'ETHRWorld' } });
  bare.sb.paintHeader();
  var ran = (function () { try { bare.basics(); return true; } catch (e) { return e.message; } })();
  return tick().then(function () {
    check('B7 the roster failed: the field keeps the stored portal, and says why it cannot change', c.$('b-portal').value === 'hr' && c.$('b-portal').options.length === 1 &&
      c.$('b-portal-note').hidden === false && c.$('b-portal-note').textContent === 'The portal list could not be loaded. Reload the page to choose another portal.', c.$('b-portal-note').textContent);
    check('B8 no portal-picker.js: Basics still opens, the stored portal shown', ran === true && bare.$('b-portal').value === 'hr' && bare.$('b-portal').options.length === 1, ran);
    bare.$('b-name').value = 'Q2'; bare.$('b-name').fire('input'); bare.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('B8 … and saves as before', bare.updates.length === 1 && JSON.stringify(bare.updates[0].patch) === JSON.stringify({ name: 'Q2' }));
  });
})());

/* ---- the same, with the real portal-picker.js (ET's whole roster from et-events.js), so the two agree ---- */
function realPicker() {
  var roster = require('./et-events').portalList(), asked = [];
  var sb = { console: console, Promise: Promise, setTimeout: setTimeout,
    document: { getElementById: function () { return null; }, createElement: function () { return {}; }, head: { appendChild: function () {} } },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    RevampAuth: { authedFetch: function (url) {
      asked.push(url);
      var body = url === '/api/et/portals' ? { portals: roster } : {};
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(body)); } });
    } } };
  sb.window = sb;
  vm.runInNewContext(read('portal-picker.js'), sb, { filename: 'portal-picker.js' });
  return { RP: sb.RevampPortals, asked: asked, count: roster.length };
}
pending.push((function () {
  var real = realPicker();
  var c = loadConsole({ ev: { id: 'ev-r1', name: 'Retail Summit', portal: '', portalName: '' }, RP: real.RP });
  c.sb.paintHeader();
  var host = c.$('ev-portal');
  check('R the real chip in the console\'s top bar: "No portal yet" and Set portal for this event', host.hidden === false &&
    /<span class="rvp-chip"><span class="rvp-chip-text">No portal yet<\/span><button type="button" class="rvp-chip-btn" data-set-portal="ev-r1"/.test(host.innerHTML), host.innerHTML);
  c.basics();
  var sel = c.$('b-portal');
  return tick().then(function () {
    check('R the real roster in Basics: "No portal yet — choose one" first, disabled and chosen, then all ' + real.count + ' portals',
      sel.options.length === real.count + 1 && sel.options[0].value === '' && sel.options[0].disabled && sel.value === '' &&
      sel.options[0].text === 'No portal yet — choose one' && !dirty(c) && real.asked.indexOf('/api/et/portals') !== -1, { n: sel.options.length, first: sel.options[0] });
    pick(c, 'hr');
    check('R … the preview names the chosen portal from the roster', c.$('b-preview').innerHTML.indexOf('ETHRWorld presents') !== -1);
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('R … the save sends it with ifPortal \'\'', JSON.stringify(c.updates[0].patch) === JSON.stringify({ portal: 'hr', ifPortal: '' }), c.updates[0]);
    check('R … once stored the list is the roster alone, ETHRWorld chosen, and the header names it', sel.options.length === real.count && sel.value === 'hr' &&
      c.$('ev-name').textContent === 'Retail Summit | ETHRWorld' && host.hidden === true);
    var d = loadConsole({ ev: { id: 'ev-r2', name: 'Q', portal: 'cio', portalName: 'ETCIO' }, RP: real.RP });
    d.sb.paintHeader();
    d.basics();
    return tick().then(function () {
      check('R a stored portal with the real roster: chosen, no "No portal yet" choice, not dirty', d.$('b-portal').value === 'cio' &&
        d.$('b-portal').options.length === real.count && !dirty(d));
    });
  });
})());

/* ======================= S. the Registration panel after a portal is set =======================
   The server stamps the event's details date on every PATCH, a portal's included, and the Registration
   panel saves with ifUpdatedAt. A server that refuses as PATCH /api/event does (409 'stale' when the
   stored date is newer than the one sent) and answers GET as /api/event does, in memory. */
function fakeServer(reg) {
  var srv = { at: '2026-11-03T09:00:00.000Z', portal: '', settings: { registration: reg || { open: true, capacity: 100 } }, n: 0 };
  srv.stamp = function () { srv.n++; srv.at = '2026-11-03T10:00:' + (srv.n < 10 ? '0' : '') + srv.n + '.000Z'; return srv.at; };
  srv.update = function (patch, opts) {
    if (opts && opts.ifUpdatedAt && srv.at > opts.ifUpdatedAt) {
      var e = new Error('This event was changed meanwhile.'); e.status = 409; e.code = 'stale'; return Promise.reject(e);
    }
    if (patch.settings && patch.settings.registration) srv.settings.registration = Object.assign({}, srv.settings.registration, patch.settings.registration);
    if (patch.portal) srv.portal = patch.portal;
    return Promise.resolve({ ok: true, updatedAt: srv.stamp() });
  };
  srv.fetch = function (id) {
    return Promise.resolve(JSON.parse(JSON.stringify({ eventId: id, portal: srv.portal, updatedAt: srv.at, detailsUpdatedAt: srv.at, settings: srv.settings })));
  };
  return srv;
}
function regEv(id, srv) {
  return { id: id, name: 'Q', portal: '', portalName: '', updatedAt: srv.at, detailsUpdatedAt: srv.at, settings: JSON.parse(JSON.stringify(srv.settings)) };
}
function rg(c, id) { return c.sb.REGF.node.querySelector('#' + id); }
function regType(c, id, v) { rg(c, id).value = v; rg(c, id).fire('input'); }
function regErr(c) { var b = rg(c, 'rg-err'); return b.hidden ? '' : b.textContent; }
var STALE_MSG = 'Someone else changed this event’s registration settings since this page was opened. Reload the page to see their changes, then make yours again.';

/* S1: Set portal in the top bar, then Capacity: saved, with no false conflict */
pending.push((function () {
  var srv = fakeServer(), RP = fakePortals();
  var c = loadConsole({ ev: regEv('ev-s1', srv), RP: RP, update: srv.update, fetch: srv.fetch });
  c.sb.paintHeader();
  c.sb.wireSetForm();
  var panel = c.sb.REGF;
  check('S1 the Registration panel was built over the stand-in DOM', !!panel && !!rg(c, 'rg-capacity') && rg(c, 'rg-capacity').value === '100', panel && rg(c, 'rg-capacity').value);
  var loadedAt = srv.at, savedAt = '';
  chipClick(c.$('ev-portal'));
  /* the dialog's own PATCH { portal, ifPortal }: the server moves the details date */
  srv.portal = 'hr'; var portalAt = srv.stamp();
  RP.log.open[0].onDone('hr', 'ETHRWorld');
  check('S1 Set portal keeps the panel (a form being edited in it survives)', c.sb.REGF === panel);
  regType(c, 'rg-capacity', '150');
  rg(c, 'rg-save').fire('click');
  return tick().then(function () {
    var u = c.updates;
    check('S1 the first try sends the date the page was opened with, and is refused', u.length === 2 && u[0].opts.ifUpdatedAt === loadedAt &&
      JSON.stringify(u[0].patch) === JSON.stringify({ settings: { registration: { open: true, capacity: 150, target: null } } }), u);
    check('S1 … the event is read again once', c.fetches.length === 1 && c.fetches[0] === 'ev-s1', c.fetches);
    check('S1 … and the save is sent again with the date the portal write left', u[1] && u[1].opts.ifUpdatedAt === portalAt &&
      JSON.stringify(u[1].patch) === JSON.stringify(u[0].patch), u[1]);
    check('S1 … it is stored, and no conflict is shown', srv.settings.registration.capacity === 150 && regErr(c) === '' &&
      c.toasts[c.toasts.length - 1][0] === 'Registration settings saved', { err: regErr(c), toasts: c.toasts });
    check('S1 … the panel and EV are up to date: not dirty, the new date kept', rg(c, 'rg-save').disabled === true && rg(c, 'rg-state').textContent === '' &&
      c.sb.EV.detailsUpdatedAt === srv.at && c.sb.EV.settings.registration.capacity === 150 && c.sb.EV.portal === 'hr');
    savedAt = srv.at;
    regType(c, 'rg-target', '400');
    rg(c, 'rg-save').fire('click');
    return tick();
  }).then(function () {
    check('S1 the next Registration save sends the date its own save left, straight away: one request, no read', c.updates.length === 3 &&
      c.updates[2].opts.ifUpdatedAt === savedAt && c.fetches.length === 1 && srv.settings.registration.target === 400, { n: c.updates.length, f: c.fetches.length, u: c.updates[2] });
  });
})());

/* S2: the portal changed in Basics (no ifUpdatedAt), then Target: saved the same way */
pending.push((function () {
  var srv = fakeServer({ open: true, capacity: 80, target: 60 }), RP = fakePortals();
  var c = loadConsole({ ev: regEv('ev-s2', srv), RP: RP, update: srv.update, fetch: srv.fetch });
  c.sb.paintHeader();
  c.basics();
  return tick().then(function () {
    pick(c, 'cio');
    c.$('b-save').fire('click');
    return tick();
  }).then(function () {
    check('S2 Basics stored the portal (sent without ifUpdatedAt, as before)', srv.portal === 'cio' && c.updates.length === 1 && c.updates[0].opts === undefined, c.updates);
    var basicsAt = srv.at;
    c.sb.wireSetForm();
    regType(c, 'rg-target', '90');
    rg(c, 'rg-save').fire('click');
    return tick().then(function () {
      check('S2 the Registration save after it: refused once, read again, sent with the date Basics left, stored, no conflict shown',
        c.updates.length === 3 && c.fetches.length === 1 && c.updates[2].opts.ifUpdatedAt === basicsAt && srv.settings.registration.target === 90 &&
        srv.settings.registration.capacity === 80 && regErr(c) === '', { u: c.updates, err: regErr(c) });
    });
  });
})());

/* S3: a real conflict: somebody else saved a capacity meanwhile. Nothing is overwritten, and the person is told */
pending.push((function () {
  var srv = fakeServer({ open: true, capacity: 100 });
  var c = loadConsole({ ev: regEv('ev-s3', srv), RP: fakePortals(), update: srv.update, fetch: srv.fetch });
  c.sb.paintHeader();
  c.sb.wireSetForm();
  srv.settings.registration = { open: true, capacity: 200 }; srv.stamp();   // the other person's save
  srv.portal = 'hr'; srv.stamp();                                           // and this person's Set portal after it
  c.sb.portalSet('hr', 'ETHRWorld');
  regType(c, 'rg-capacity', '150');
  rg(c, 'rg-save').fire('click');
  return tick().then(function () {
    check('S3 the other person\'s capacity stays: one request, refused, and not sent again', c.updates.length === 1 && c.fetches.length === 1 &&
      srv.settings.registration.capacity === 200, { n: c.updates.length, srv: srv.settings });
    check('S3 … the conflict is shown, and the person\'s value is still there, unsaved', regErr(c) === STALE_MSG && rg(c, 'rg-capacity').value === '150' &&
      rg(c, 'rg-state').textContent === 'Unsaved changes' && rg(c, 'rg-save').disabled === false, regErr(c));
  });
})());

/* S4: the read fails; S5: refused again after the read; S6: another error is not read about */
pending.push((function () {
  var srv = fakeServer();
  var c = loadConsole({ ev: regEv('ev-s4', srv), RP: fakePortals(), update: srv.update, fetch: function () {
    var e = new Error('Failed to fetch'); return Promise.reject(e);
  } });
  c.sb.wireSetForm();
  srv.stamp();
  regType(c, 'rg-capacity', '150');
  rg(c, 'rg-save').fire('click');
  var d = loadConsole({ ev: regEv('ev-s5', srv), RP: fakePortals(), fetch: srv.fetch, update: function () {
    srv.stamp(); var e = new Error('stale'); e.status = 409; e.code = 'stale'; return Promise.reject(e);
  } });
  d.sb.wireSetForm();
  regType(d, 'rg-capacity', '150');
  rg(d, 'rg-save').fire('click');
  var x = loadConsole({ ev: regEv('ev-s6', srv), RP: fakePortals(), fetch: srv.fetch, update: function () {
    var e = new Error('Boom'); e.status = 500; return Promise.reject(e);
  } });
  x.sb.wireSetForm();
  regType(x, 'rg-capacity', '150');
  rg(x, 'rg-save').fire('click');
  return tick().then(function () {
    check('S4 the read fails: nothing sent again, the connection message, no claim of a conflict', c.updates.length === 1 && c.fetches.length === 1 &&
      regErr(c) === 'We couldn’t reach the server. Check your connection and try again.', regErr(c));
    check('S5 refused again after the read: the conflict shown, and no loop (two requests, one read)', d.updates.length === 2 && d.fetches.length === 1 &&
      regErr(d) === STALE_MSG, { n: d.updates.length, f: d.fetches.length, err: regErr(d) });
    check('S6 a server error is shown as before, with no read', x.updates.length === 1 && x.fetches.length === 0 &&
      regErr(x) === 'Something went wrong on our side. Please try again.', regErr(x));
  });
})());

/* ======================= 5. Promotions (marketing.html) ======================= */
check('5 Promotions loads portal-picker.js right after auth.js', /<script src="auth\.js"><\/script>\s*<!--[^>]*-->\s*<script src="portal-picker\.js"><\/script>/.test(PROMO) &&
  (PROMO.match(/<script src="portal-picker\.js">/g) || []).length === 1);
check('5 its top bar has #ev-portal, hidden, right after #ev-meta', /<span class="meta" id="ev-meta"><\/span>\s*<!--[^>]*-->\s*<span class="ev-portal" id="ev-portal" hidden><\/span>/.test(PROMO));
check('5 it no longer reads RevampCore\'s table of portal names', SHELL.indexOf('PORTALS') === -1);
var PROMO_FNS = ['paintHeader', 'paintPortalChip'].map(function (n) { var s = fnSrc(SHELL, n); check('5 found function ' + n, !!s); return s; });
function loadPromo(o) {
  var dom = makeDom(), reloads = [];
  var sub = topbar(dom, !o.noChip);
  var sb = { console: console, document: { title: '' }, $: dom.$, esc: escHtml, eventId: o.eventId || 'ev-p',
    C: { fmtDT: function () { return '12 Nov 2026'; }, TYPES: { ip: 'IP Event' } }, location: { reload: function () { reloads.push(1); } } };
  sb.window = sb;
  if (o.RP) sb.RevampPortals = o.RP;
  vm.runInNewContext(PROMO_FNS.join('\n'), sb, { filename: 'marketing.html' });
  return { sb: sb, $: dom.$, sub: sub, reloads: reloads };
}
(function () {
  var p = loadPromo({ RP: fakePortals() });
  p.sb.paintHeader({ name: 'Agentic AI Summit', portal: 'hr', portalName: 'ETHRWorld', start: '2026-11-12', category: 'ip' });
  check('5 with a portal: "Name | ETHRWorld", the chip hidden', p.$('ev-name').textContent === 'Agentic AI Summit | ETHRWorld' && p.$('ev-portal').hidden === true &&
    p.$('ev-meta').textContent === '12 Nov 2026  |  IP Event');
  check('5 … the window title as before', p.sb.document.title === 'Promotions — Agentic AI Summit — Oneworld 2.0', p.sb.document.title);

  var RP = fakePortals();
  var q = loadPromo({ RP: RP, eventId: 'ev-q' });
  q.sb.paintHeader({ name: 'Retail Summit', portal: '', portalName: '', generatedAt: '2026-10-01', published: false });
  var host = q.$('ev-portal');
  check('5 without a portal: the name alone; the chip and the phone\'s button shown', q.$('ev-name').textContent === 'Retail Summit' && host.hidden === false &&
    host.innerHTML.indexOf('<span class="rvp-chip">No portal yet</span>') !== -1 && host.innerHTML.indexOf('class="ev-portal-mini" data-set-portal="ev-q"') !== -1 &&
    q.sub.classList.contains('has-portal-chip'), host.innerHTML);
  chipClick(host);
  var op = RP.log.open[0];
  check('5 Set portal opens the dialog for this event', !!op && op.eventId === 'ev-q' && op.eventName === 'Retail Summit' && op.current === '' &&
    op.hasGeneratedSite === true && op.published === false, op);
  op.onDone('hr', 'ETHRWorld');
  check('5 once set, the page is loaded again (the Kit is loaded once)', q.reloads.length === 1);

  var bare = loadPromo({});
  var ok = (function () { try { bare.sb.paintHeader({ name: 'Z', portal: '', portalName: '' }); return true; } catch (e) { return e.message; } })();
  check('5 tolerated with no RevampPortals', ok === true && bare.$('ev-portal').hidden === true && bare.$('ev-name').textContent === 'Z', ok);
  var noHost = loadPromo({ RP: fakePortals(), noChip: true });
  ok = (function () { try { noHost.sb.paintHeader({ name: 'Z', portal: 'cio', portalName: 'ETCIO' }); return true; } catch (e) { return e.message; } })();
  check('5 tolerated with no #ev-portal (as promotions-page.test.js runs it)', ok === true && noHost.$('ev-name').textContent === 'Z | ETCIO', ok);
})();

/* ======================= the look: the header rules, on the console's tokens ======================= */
function styleOf(page) { return ((/<style>([\s\S]*?)<\/style>/.exec(page.slice(0, page.indexOf('</head>') === -1 ? 4000 : page.indexOf('</head>') + 10)) || /<style>([\s\S]*?)<\/style>/.exec(page)) || [])[1] || ''; }
var cssA = styleOf(CONSOLE).replace(/\/\*[\s\S]*?\*\//g, '').trim(), cssB = styleOf(PROMO).replace(/\/\*[\s\S]*?\*\//g, '').trim();
check('L the two pages carry the same header rules', !!cssA && cssA === cssB);
check('L the rules use the console\'s tokens only: no colour of their own', !!cssA && !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(cssA));
var used = (cssA.match(/var\((--[\w-]+)\)/g) || []).map(function (v) { return v.slice(4, -1); });
var ALLOWED = ['--surface', '--surface-2', '--border', '--text', '--text-muted', '--accent', '--accent-soft', '--warn', '--warn-soft'];
check('L … only the shared ones', used.length > 0 && used.every(function (t) { return ALLOWED.indexOf(t) !== -1; }), used);
check('L a hidden chip stays hidden (its display would beat the attribute)', /\.ev-title \.ev-portal\[hidden\]\{ display:none; \}/.test(cssA));
check('L on a phone or a narrow window: the date line and the chip give way to the button', /@media \(max-width: 680px\)\{[\s\S]*\.ev-title \.ev-sub\.has-portal-chip \.meta\{ display:none; \}[\s\S]*\.ev-portal-wide\{ display:none; \}[\s\S]*\.ev-portal-mini\{ display:inline-flex; \}/.test(cssA));
check('L the phone\'s button is a 24 px target at least', /\.ev-portal-mini\{[^}]*min-height:24px/.test(cssA));
var ee = read('edit-event.css').replace(/\/\*[\s\S]*?\*\//g, '');
function tokens(sel) {
  var at = ee.indexOf(sel + '{');
  if (at === -1) return null;
  var body = ee.slice(at + sel.length + 1, ee.indexOf('}', at)), out = {}, m, re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  while ((m = re.exec(body))) out[m[1]] = m[2].trim();
  return out;
}
function lum(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { var c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
  .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0); }
function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
var LIGHT = tokens(':root'), DARK = tokens(':root[data-theme="dark"]');
var mini = (/\.ev-portal-mini\{([^}]*)\}/.exec(cssA) || [])[1] || '';
var fgTok = (/(?:^|;)\s*color:\s*var\((--[\w-]+)\)/.exec(mini) || [])[1], bgTok = (/background:\s*var\((--[\w-]+)\)/.exec(mini) || [])[1];
[['light', LIGHT], ['dark', DARK]].forEach(function (t) {
  var fg = t[1] && t[1][fgTok], bg = t[1] && t[1][bgTok], k = fg && bg ? ratio(fg, bg) : 0;
  check('L AA, ' + t[0] + ': the phone\'s Set portal button (' + k.toFixed(2) + ':1)', k >= 4.5, [fgTok, fg, bgTok, bg]);
});

/* ======================= 7. ES5 ======================= */
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the regex checks below still run */ }
function es5(src) { if (!esbuild) return true; try { esbuild.transformSync(src, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 2).join(' '); } }
check('7 esbuild is there for the ES5 checks', !!esbuild);
inlineScripts(CONSOLE).forEach(function (s, i) { var r = es5(s); check('7 the console\'s script ' + i + ' is ES5 (esbuild)', r === true, r); });
inlineScripts(PROMO).forEach(function (s, i) { var r = es5(s); check('7 Promotions\' script ' + i + ' is ES5 (esbuild)', r === true, r); });
check('7 edit-event-core.js is ES5 (esbuild)', es5(CORE) === true, es5(CORE));
['shownPortal', 'rosterName', 'paintPortalChip', 'openSetPortal', 'portalSet', 'paintHeader', 'viewBasics', 'wireBasics', 'regSettings', 'buildRegForms'].forEach(function (n) {
  check('7 the console\'s ' + n + ': no let, const, arrows, template strings, classes, async or spread', es5Clean(CONSOLE_FNS[n]));
});
PROMO_FNS.forEach(function (s, i) { check('7 Promotions\' changed function ' + i + ': ES5 by its text', es5Clean(s)); });
check('7 the console\'s portal block is ES5 by its text', es5Clean(CONSOLE_VARS));
check('7 every page still parses', [CONSOLE, PROMO].every(function (pg) { return inlineScripts(pg).every(function (s) { try { new vm.Script(s); return true; } catch (e) { return false; } }); }));
check('7 every file the two pages load is one the server sends', [CONSOLE, PROMO].every(function (pg) {
  return (pg.match(/<script src="([^"]+)"/g) || []).map(function (t) { return t.slice(13, -1); }).every(function (u) { return require('./access').isServableFile(u.split('?')[0]); });
}));

/* ======================= 6. the Promotions tests, unedited ======================= */
['promotions-page.test.js', 'promo-posts.test.js'].forEach(function (f) {
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 120000 });
  check('6 ' + f + ' passes, unedited', r.status === 0, (r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(-3));
});

Promise.all(pending).then(function () {
  if (failed) { console.error('console-portal: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('console-portal: all ' + passed + ' checks passed');
}, function (err) { console.error('console-portal: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
