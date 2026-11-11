// node functions/lib/portal-picker.test.js — portal-picker.js (window.RevampPortals), the one place Oneworld 2.0's pages
// get ETB2B's portal roster, the person's working portal and the "Set this event's portal" window (plan §4, §6c, K9; D.1–D.2):
//   D.1 list() asks once and is shared, a failure is not kept; nameOf; optionsHtml escapes; chipHtml; working() and
//       cachedWorking() (the server wins when it has a choice, this browser's cache otherwise; storage that throws only
//       loses the cache; in a shared browser the next person signed in never gets the last one's portal, and becomes
//       the last person seen); setWorking() (cached first, then PUT; a failed save keeps the choice here and says so);
//       the window: a labelled modal dialog, focus on the list, Escape and focus back, Tab kept inside, the PATCH with
//       ifPortal, a 400 and a 409 'portal-changed' shown inline, Cancel / Escape / the dimmed page waiting while
//       "Saving…", a change made after the window was replaced still reported, the site and published notes only when
//       they apply, a draft's choice reported without a request; and that the file is ES5 with one global.
//   D.2 the look: the injected style uses only the shared colour tokens, and the chip and the window are AA in light and
//       dark, with the token values read from Event_Listing.html and edit-event.css at run time.
// No network, no browser: the file runs in a vm over a small in-memory DOM and stubs of RevampAuth and localStorage.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'portal-picker.js'), 'utf8');
var ROSTER = require('./et-events').portalList();   // the server's real roster, as GET /api/et/portals answers it
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function flush(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 12); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }

/* ======================================================================================================
   A small in-memory DOM: enough HTML parsing, selectors, events and focus for the picker and the page
   ====================================================================================================== */
function makeDom() {
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', middot: '\u00b7', larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d' };
  function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, k) {
      if (k[0] === '#') return String.fromCharCode(k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
      return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
    });
  }
  function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

  var doc;
  function Text(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
  function El(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.localName = String(tag).toLowerCase();
    this.attrs = {}; this.childNodes = []; this.parentNode = null; this.listeners = {}; this.style = {};
    this._value = null; this._sel = false;
    var el = this;
    this.classList = {
      contains: function (c) { return el.className.split(/\s+/).indexOf(c) !== -1; },
      add: function (c) { if (!el.classList.contains(c)) el.className = (el.className + ' ' + c).trim(); },
      remove: function (c) { el.className = el.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(' '); },
      toggle: function (c, on) { if (on === undefined) on = !el.classList.contains(c); if (on) el.classList.add(c); else el.classList.remove(c); return on; }
    };
  }
  function reflect(prop, attr) {
    Object.defineProperty(El.prototype, prop, { get: function () { return this.attrs[attr] === undefined ? '' : this.attrs[attr]; }, set: function (v) { this.attrs[attr] = String(v); } });
  }
  function flag(prop) {
    Object.defineProperty(El.prototype, prop, { get: function () { return this.attrs[prop] !== undefined; }, set: function (v) { if (v) this.attrs[prop] = ''; else delete this.attrs[prop]; } });
  }
  reflect('id', 'id'); reflect('className', 'class'); reflect('type', 'type'); flag('hidden'); flag('disabled');
  Object.defineProperty(El.prototype, 'children', { get: function () { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); } });
  Object.defineProperty(El.prototype, 'isConnected', { get: function () { var n = this; while (n.parentNode) n = n.parentNode; return n === doc; } });
  Object.defineProperty(El.prototype, 'textContent', {
    get: function () { return this.childNodes.map(function (n) { return n.nodeType === 3 ? n.data : n.textContent; }).join(''); },
    set: function (v) { this.childNodes.forEach(function (n) { n.parentNode = null; }); this.childNodes = []; if (String(v)) this.appendChild(new Text(String(v))); }
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    get: function () { return this.childNodes.map(serialize).join(''); },
    set: function (v) { this.childNodes.forEach(function (n) { n.parentNode = null; }); this.childNodes = []; parseInto(this, String(v)); }
  });
  Object.defineProperty(El.prototype, 'options', { get: function () { return this.querySelectorAll('option'); } });
  Object.defineProperty(El.prototype, 'value', {
    get: function () {
      if (this.localName === 'select') {
        var opts = this.options, on = opts.filter(function (o) { return o._sel; })[0] || opts.filter(function (o) { return !o.disabled; })[0];
        return on ? on.value : '';
      }
      if (this.localName === 'option') return this.attrs.value !== undefined ? this.attrs.value : this.textContent;
      return this._value !== null ? this._value : (this.attrs.value || '');
    },
    set: function (v) {
      if (this.localName === 'select') { this.options.forEach(function (o) { o._sel = o.value === String(v); }); return; }
      this._value = String(v);
    }
  });
  El.prototype.setAttribute = function (k, v) { this.attrs[String(k).toLowerCase()] = String(v); };
  El.prototype.getAttribute = function (k) { k = String(k).toLowerCase(); return this.attrs[k] === undefined ? null : this.attrs[k]; };
  El.prototype.hasAttribute = function (k) { return this.attrs[String(k).toLowerCase()] !== undefined; };
  El.prototype.removeAttribute = function (k) { delete this.attrs[String(k).toLowerCase()]; };
  El.prototype.appendChild = function (n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; };
  El.prototype.insertBefore = function (n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; };
  El.prototype.removeChild = function (n) { var i = this.childNodes.indexOf(n); if (i !== -1) this.childNodes.splice(i, 1); n.parentNode = null; if (doc.activeElement && !doc.activeElement.isConnected) doc.activeElement = doc.body; return n; };
  El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  El.prototype.contains = function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; };
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.removeEventListener = function (t, fn) { var l = this.listeners[t] || []; var i = l.indexOf(fn); if (i !== -1) l.splice(i, 1); };
  El.prototype.focus = function () { if (this.disabled || !this.isConnected) return; doc.activeElement = this; };
  El.prototype.blur = function () { if (doc.activeElement === this) doc.activeElement = doc.body; };
  El.prototype.click = function () { fire(this, 'click'); };
  El.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
  El.prototype.scrollIntoView = function () {};
  ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'].forEach(function (k) { Object.defineProperty(El.prototype, k, { get: function () { return 0; } }); });
  El.prototype.querySelectorAll = function (sel) { var out = []; walk(this, function (n) { if (matches(n, sel)) out.push(n); }); return out; };
  El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  El.prototype.matches = function (sel) { return matches(this, sel); };
  El.prototype.closest = function (sel) { for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; };
  function walk(root, fn) { root.childNodes.forEach(function (n) { if (n.nodeType === 1) { fn(n); walk(n, fn); } }); }

  /* selectors: lists, descendant and child combinators, tag / #id / .class / [attr] / [attr="v"] compounds */
  function compound(el, s) {
    var m, re = /([a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g, any = false;
    while ((m = re.exec(s))) {
      any = true;
      if (m[1] && el.localName !== m[1].toLowerCase()) return false;
      if (m[2] && el.getAttribute('id') !== m[2]) return false;
      if (m[3] && !el.classList.contains(m[3])) return false;
      if (m[4]) { var want = m[5] !== undefined ? m[5] : m[6] !== undefined ? m[6] : m[7]; var have = el.getAttribute(m[4]); if (have === null || (want !== undefined && have !== want)) return false; }
    }
    return any;
  }
  function matchOne(el, sel) {
    var parts = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    function back(node, i) {
      if (!compound(node, parts[i])) return false;
      if (i === 0) return true;
      if (parts[i - 1] === '>') { var p = node.parentNode; return !!p && p.nodeType === 1 && back(p, i - 2); }
      for (var a = node.parentNode; a && a.nodeType === 1; a = a.parentNode) if (back(a, i - 1)) return true;
      return false;
    }
    return back(el, parts.length - 1);
  }
  function matches(el, sel) { return el.nodeType === 1 && sel.split(',').some(function (s) { return matchOne(el, s); }); }

  /* HTML: tags, attributes, text and comments, for the well-formed markup these pages write */
  function parseInto(parent, html) {
    var re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+|<)/g, m, stack = [parent];
    while ((m = re.exec(html))) {
      var top = stack[stack.length - 1];
      if (m[0].slice(0, 4) === '<!--') continue;
      if (m[1]) {
        var t = m[1].toLowerCase();
        for (var i = stack.length - 1; i > 0; i--) if (stack[i].localName === t) { stack.length = i; break; }
      } else if (m[2]) {
        var el = new El(m[2]), am, are = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        while ((am = are.exec(m[3]))) el.attrs[am[1].toLowerCase()] = decode(am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '');
        if (el.localName === 'option') el._sel = el.attrs.selected !== undefined;
        top.appendChild(el);
        if (!m[4] && !VOID[el.localName]) stack.push(el);
      } else if (m[5]) {
        top.appendChild(new Text(decode(m[5])));
      }
    }
  }
  function serialize(n) {
    if (n.nodeType === 3) return escText(n.data);
    var a = Object.keys(n.attrs).map(function (k) { return ' ' + k + (n.attrs[k] === '' && (k === 'hidden' || k === 'disabled' || k === 'selected') ? '' : '="' + escAttr(n.attrs[k]) + '"'); }).join('');
    return '<' + n.localName + a + '>' + (VOID[n.localName] ? '' : n.childNodes.map(serialize).join('') + '</' + n.localName + '>');
  }

  /* events bubble from the target to the document (and the window, when one is given) */
  var winListeners = {};
  function fire(target, type, init) {
    var ev = { type: type, target: target, defaultPrevented: false, stopped: false, button: 0 };
    Object.keys(init || {}).forEach(function (k) { ev[k] = init[k]; });
    ev.preventDefault = function () { ev.defaultPrevented = true; };
    ev.stopPropagation = function () { ev.stopped = true; };
    var path = [];
    for (var n = target; n; n = n.parentNode) path.push(n);
    for (var i = 0; i < path.length && !ev.stopped; i++) {
      ev.currentTarget = path[i];
      (path[i].listeners[type] || []).slice().forEach(function (fn) { fn.call(path[i], ev); });
    }
    if (!ev.stopped) (winListeners[type] || []).slice().forEach(function (fn) { fn(ev); });
    return ev;
  }

  doc = new El('#document');
  doc.nodeType = 9;
  var html = new El('html'), head = new El('head'), body = new El('body');
  doc.appendChild(html); html.appendChild(head); html.appendChild(body);
  doc.documentElement = html; doc.head = head; doc.body = body; doc.activeElement = body; doc.readyState = 'complete';
  doc.createElement = function (t) { return new El(t); };
  doc.getElementById = function (id) { var hit = null; walk(doc, function (n) { if (!hit && n.getAttribute('id') === id) hit = n; }); return hit; };
  return { document: doc, El: El, fire: fire, winListeners: winListeners,
    key: function (target, key, extra) { var o = { key: key }; Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); return fire(target, 'keydown', o); } };
}

/* ======================================================================================================
   The browser around portal-picker.js
   ====================================================================================================== */
function response(status, json) {
  var t = json === undefined ? '' : JSON.stringify(json);
  return { status: status, ok: status >= 200 && status < 300, text: function () { return Promise.resolve(t); } };
}
/* o.route(method, url, body) -> Promise<response> | response; o.uid; o.storage: false (throws) | {} (shared object) */
function browser(o) {
  o = o || {};
  var dom = makeDom();
  var log = { fetch: [], reloads: 0 };
  var mem = o.store || {};
  var ls = o.storage === false ? null : {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };
  var ctx = {
    document: dom.document, console: { log: function () {}, warn: function () {}, error: function () {} },
    location: { reload: function () { log.reloads++; } },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    RevampAuth: o.noAuth ? undefined : {
      currentUser: function () { return o.uid === null ? null : { uid: o.uid || 'uid-asha', email: 'asha.rao@timesinternet.in' }; },
      authedFetch: function (url, opts) {
        var body = opts && opts.body ? JSON.parse(opts.body) : undefined;
        log.fetch.push({ method: (opts && opts.method) || 'GET', url: url, body: body, type: opts && opts.headers && opts.headers['Content-Type'] });
        return Promise.resolve(o.route((opts && opts.method) || 'GET', url, body));
      }
    }
  };
  Object.defineProperty(ctx, 'localStorage', { get: function () { if (!ls) throw new Error('SecurityError: storage is off'); return ls; } });
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'portal-picker.js' });
  return { P: ctx.RevampPortals, ctx: ctx, dom: dom, doc: dom.document, log: log, mem: mem };
}
/* the server: the roster, the working portal and the event PATCH, each scriptable */
function server(s) {
  s = s || {};
  return function (method, url, body) {
    if (method === 'GET' && url === '/api/et/portals') {
      if (s.portalsFail && s.portalsFail-- > 0) return response(502, { error: 'down' });
      return response(200, { portals: s.portals || ROSTER });
    }
    if (method === 'GET' && url === '/api/me/working-portal') {
      if (s.workingFails) return Promise.reject(new TypeError('Failed to fetch'));
      return response(s.workingStatus || 200, s.workingStatus && s.workingStatus !== 200 ? { error: 'x' } : { workingPortal: s.working === undefined ? null : s.working });
    }
    if (method === 'PUT' && url === '/api/me/working-portal') return s.put ? s.put(body) : response(200, { ok: true, workingPortal: body.workingPortal });
    if (method === 'PATCH' && url === '/api/event') return s.patch ? s.patch(body) : response(200, { ok: true, updatedAt: '2026-11-03T10:00:00.000Z' });
    return response(404, { error: 'no route ' + method + ' ' + url });
  };
}
function gets(b, url) { return b.log.fetch.filter(function (f) { return f.method === 'GET' && f.url === url; }).length; }

async function main() {
  var b, r, r2, err;

  /* ======== D.1 list() ======== */
  b = browser({ route: server() });
  var l1 = b.P.list(), l2 = b.P.list();
  r = await l1; r2 = await l2;
  check('D.1 list() reads GET /api/et/portals once for two callers', gets(b, '/api/et/portals') === 1 && r.length === ROSTER.length && JSON.stringify(r) === JSON.stringify(r2));
  r[0].name = 'changed by a page';
  var r3 = await b.P.list();
  check('D.1 list() is shared (no second request) and each caller gets its own copy', gets(b, '/api/et/portals') === 1 && r3[0].name === ROSTER[0].name);
  check('D.1 list() is the roster by name, as the server sends it', JSON.stringify(r3) === JSON.stringify(ROSTER) && r3.some(function (p) { return p.slug === 'hr' && p.name === 'ETHRWorld'; }));

  b = browser({ route: server({ portalsFail: 1 }) });
  err = await b.P.list().then(function () { return null; }, function (e) { return e; });
  check('D.1 a failed read rejects with a sentence that can be shown', err && err.message === 'The portal list could not be loaded.' && err.status === 502, err && err.message);
  r = await b.P.list();
  check('D.1 a failed read is not kept: the next call (Retry) asks again', gets(b, '/api/et/portals') === 2 && r.length === ROSTER.length);

  b = browser({ route: server({ portals: [{ slug: 'hr', name: ' ETHRWorld ' }, { slug: 'hr', name: 'Again' }, { slug: '__proto__', name: 'x' }, { slug: 'Cio', name: 'Caps' }, { slug: 'cio' }, null, { slug: 'auto', name: 'ETAuto' }] }) });
  r = await b.P.list();
  check('D.1 rows that are not a roster slug with a name are left out (and a slug given twice keeps its first)', JSON.stringify(r) === JSON.stringify([{ slug: 'hr', name: 'ETHRWorld' }, { slug: 'auto', name: 'ETAuto' }]), r);
  b = browser({ route: server({ portals: [] }) });
  err = await b.P.list().then(function () { return null; }, function (e) { return e; });
  check('D.1 an empty roster is a failure, not an empty list', err && err.message === 'The portal list could not be loaded.');

  /* ======== D.1 nameOf, optionsHtml, chipHtml ======== */
  b = browser({ route: server({ portals: [{ slug: 'hr', name: 'ETHRWorld' }, { slug: 'xss', name: 'A <b>"bold"</b> & \'co\'' }] }) });
  check('D.1 nameOf before the roster: \'\' (no cache)', b.P.nameOf('hr') === '');
  check('D.1 optionsHtml before the roster: the current portal alone, or the placeholder',
    b.P.optionsHtml('hr', 'Choose a portal') === '<option value="hr" selected>hr</option>' && b.P.optionsHtml('', 'Choose a portal') === '<option value="" disabled selected>Choose a portal</option>' && b.P.optionsHtml('', '') === '');
  await b.P.list();
  check('D.1 nameOf: the roster\'s name; \'\' for anything else', b.P.nameOf('hr') === 'ETHRWorld' && b.P.nameOf('hrworld') === '' && b.P.nameOf('__proto__') === '' && b.P.nameOf('toString') === '' && b.P.nameOf(undefined) === '' && b.P.nameOf('') === '');
  var oh = b.P.optionsHtml('xss');
  check('D.1 optionsHtml escapes names and selects the current portal', oh === '<option value="hr">ETHRWorld</option><option value="xss" selected>A &lt;b&gt;&quot;bold&quot;&lt;/b&gt; &amp; &#39;co&#39;</option>', oh);
  check('D.1 optionsHtml with no portal: a disabled placeholder first, selected', b.P.optionsHtml('', 'No portal yet — choose one') === '<option value="" disabled selected>No portal yet — choose one</option><option value="hr">ETHRWorld</option><option value="xss">A &lt;b&gt;&quot;bold&quot;&lt;/b&gt; &amp; &#39;co&#39;</option>');
  check('D.1 optionsHtml with an off-roster current portal: nothing selected but the placeholder', b.P.optionsHtml('hrworld', 'Choose a portal').indexOf('<option value="" disabled selected>Choose a portal</option>') === 0 && (b.P.optionsHtml('hrworld', 'Choose a portal').match(/selected/g) || []).length === 1);
  var chip = b.P.chipHtml({ eventId: 'q"x<y', eventName: 'Retail <Leaders>' });
  check('D.1 chipHtml: "No portal yet" and a Set portal button carrying the event id (escaped)',
    chip === '<span class="rvp-chip"><span class="rvp-chip-text">No portal yet</span><button type="button" class="rvp-chip-btn" data-set-portal="q&quot;x&lt;y" aria-label="Set the portal of Retail &lt;Leaders&gt;">Set portal</button></span>', chip);
  check('D.1 chipHtml adds the picker\'s style once', b.doc.querySelectorAll('#rv-portal-picker-css').length === 1 && (b.P.chipHtml({ eventId: 'a' }), b.doc.querySelectorAll('style').length === 1) &&
    b.doc.getElementById('rv-portal-picker-css').parentNode === b.doc.head);

  /* ======== D.1 the working portal ======== */
  var store = {};
  b = browser({ route: server({ working: null }), store: store });
  check('D.1 nothing remembered: cachedWorking() is null', b.P.cachedWorking() === null);
  check('D.1 …and working() is null when the server has no choice either', (await b.P.working()) === null && gets(b, '/api/me/working-portal') === 1);
  await b.P.list();
  r = await b.P.setWorking('hr');
  check('D.1 setWorking PUTs { workingPortal } as JSON and resolves the choice', r === 'hr' && b.log.fetch.some(function (f) { return f.method === 'PUT' && f.url === '/api/me/working-portal' && f.body.workingPortal === 'hr' && f.type === 'application/json'; }));
  check('D.1 …and caches it for this person, with its name', JSON.parse(store['rv.workingPortal.uid-asha']).portal === 'hr' && JSON.parse(store['rv.workingPortal.uid-asha']).name === 'ETHRWorld' &&
    JSON.parse(store['rv.workingPortal.uid-asha']).v === 1 && store['rv.workingPortal'] === 'uid-asha', store);
  check('D.1 cachedWorking() reads it at once', b.P.cachedWorking() === 'hr');

  b = browser({ route: server({ working: 'cio' }), store: store });
  check('D.1 a new page: the cache first (before the server is asked)', b.P.cachedWorking() === 'hr' && b.log.fetch.length === 0);
  check('D.1 …nameOf knows the cached portal\'s name before the roster has come', b.P.nameOf('hr') === 'ETHRWorld' && b.P.nameOf('cio') === '');
  check('D.1 working(): the server\'s choice wins', (await b.P.working()) === 'cio');
  check('D.1 …and replaces the cache', b.P.cachedWorking() === 'cio' && JSON.parse(store['rv.workingPortal.uid-asha']).portal === 'cio');
  check('D.1 …whose name, unknown until the roster came, is filled in then', JSON.parse(store['rv.workingPortal.uid-asha']).name === '' && (await b.P.list(), JSON.parse(store['rv.workingPortal.uid-asha']).name === 'ETCIO'));

  b = browser({ route: server({ working: null }), store: store });
  check('D.1 working(): the server has no choice -> this browser\'s', (await b.P.working()) === 'cio');
  b = browser({ route: server({ workingFails: true }), store: store });
  check('D.1 working(): the server cannot be reached -> this browser\'s (never rejects)', (await b.P.working()) === 'cio');
  b = browser({ route: server({ workingStatus: 503 }), store: store });
  check('D.1 working(): the route is not there yet (503) -> this browser\'s', (await b.P.working()) === 'cio');
  b = browser({ route: server({ working: 'all' }), store: store });
  check('D.1 working(): "all" is a choice too', (await b.P.working()) === 'all' && b.P.cachedWorking() === 'all');

  var other = {};
  b = browser({ route: server({ working: null }), store: other, uid: null });
  other['rv.workingPortal'] = 'uid-bob';
  other['rv.workingPortal.uid-bob'] = JSON.stringify({ v: 1, portal: 'auto', name: 'ETAuto' });
  other['rv.workingPortal.uid-asha'] = JSON.stringify({ v: 1, portal: 'hr', name: 'ETHRWorld' });
  check('D.1 before auth.js knows who is signed in: the last person seen in this browser', b.P.cachedWorking() === 'auto');
  b = browser({ route: server({ working: null }), store: other, uid: 'uid-asha' });
  check('D.1 once they are known: their own entry, never another person\'s', b.P.cachedWorking() === 'hr');
  other['rv.workingPortal.uid-asha'] = '{not json';
  check('D.1 a broken entry is no choice', b.P.cachedWorking() === null);
  other['rv.workingPortal.uid-asha'] = JSON.stringify({ v: 2, portal: 'hr' });
  check('D.1 an entry of another shape is no choice', b.P.cachedWorking() === null);
  other['rv.workingPortal.uid-asha'] = JSON.stringify({ v: 1, portal: 'hrworld', name: 'HRWorld' });
  check('D.1 a cached slug the roster does not have is no choice (once the roster is known)', (await b.P.list(), b.P.cachedWorking() === null));

  /* a shared browser: nobody known at load, then somebody other than the last person seen here */
  var shared = { 'rv.workingPortal': 'uid-asha', 'rv.workingPortal.uid-asha': JSON.stringify({ v: 1, portal: 'hr', name: 'ETHRWorld' }) };
  var bo = { route: server({ working: null }), store: shared, uid: null };
  b = browser(bo);
  check('D.1 shared browser, before auth.js answers: the last person seen here (the first paint)', b.P.cachedWorking() === 'hr');
  bo.uid = 'uid-bilal';
  check('D.1 …working() for the next person, with no choice anywhere: null, never the last person\'s', (await b.P.working()) === null);
  check('D.1 …this browser now names them as the last person seen; the other person\'s entry is kept, and none is made up for them',
    shared['rv.workingPortal'] === 'uid-bilal' && JSON.parse(shared['rv.workingPortal.uid-asha']).portal === 'hr' && !('rv.workingPortal.uid-bilal' in shared), shared);
  b = browser({ route: server({ working: null }), store: shared, uid: null });
  check('D.1 …so the next page\'s first paint, before auth.js answers, is theirs (none)', b.P.cachedWorking() === null);
  shared['rv.workingPortal'] = 'uid-asha';
  b = browser({ route: server({ workingFails: true }), store: shared, uid: 'uid-bilal' });
  check('D.1 …the same when the server cannot be reached', (await b.P.working()) === null && shared['rv.workingPortal'] === 'uid-bilal');

  b = browser({ route: server({ working: 'hr' }), storage: false });
  check('D.1 storage that throws: cachedWorking() is null, nothing throws', b.P.cachedWorking() === null);
  check('D.1 …working() still has the server\'s answer', (await b.P.working()) === 'hr');
  check('D.1 …setWorking still saves for the person', (await b.P.setWorking('cio')) === 'cio');

  store = {};
  b = browser({ route: server({ put: function () { return response(403, { error: 'QA HARNESS GUARD (not a product bug): the working portal is a person\'s own record.' }); } }), store: store });
  await b.P.list();
  err = await b.P.setWorking('auto').then(function () { return null; }, function (e) { return e; });
  check('D.1 setWorking: a refused save rejects with a sentence that says the choice is kept here', err && err.message === 'Your portal choice is kept in this browser only: it could not be saved to your account.' && err.status === 403, err && err.message);
  check('D.1 …and the choice is kept in this browser', b.P.cachedWorking() === 'auto');
  b = browser({ route: function (m, u) { if (m === 'PUT') return Promise.reject(new TypeError('Failed to fetch')); return server()(m, u); }, store: store });
  err = await b.P.setWorking('cio').then(function () { return null; }, function (e) { return e; });
  check('D.1 setWorking offline: the same sentence, and the choice kept', err && /kept in this browser only/.test(err.message) && b.P.cachedWorking() === 'cio');
  var before = b.log.fetch.length;
  err = await b.P.setWorking('__proto__').then(function () { return null; }, function (e) { return e; });
  check('D.1 setWorking refuses a value that is not a portal, asking nothing', err && err.status === 400 && b.log.fetch.length === before && b.P.cachedWorking() === 'cio');
  await b.P.list();
  err = await b.P.setWorking('hrworld').then(function () { return null; }, function (e) { return e; });
  check('D.1 …or a slug the roster does not have', err && err.status === 400 && /Unknown portal "hrworld"/.test(err.message));

  /* ======== D.1 the Set portal window ======== */
  function opener(bb) { var o = bb.doc.createElement('button'); o.id = 'opener'; bb.doc.body.appendChild(o); o.focus(); return o; }
  function dlg(bb) { return bb.doc.getElementById('rv-portal-dialog'); }
  function q(bb, id) { return bb.doc.getElementById(id); }

  var patches = [];
  b = browser({ route: server({ patch: function (body) { patches.push(body); return response(200, { ok: true, updatedAt: 'x' }); } }) });
  await b.P.list();
  var op = opener(b), done = [];
  b.P.openSetPortal({ eventId: 'retail-leaders', eventName: 'Retail <Leaders> Summit', current: '', onDone: function (s, n) { done.push([s, n]); } });
  var d = dlg(b);
  check('D.1 the window: role="dialog", aria-modal, labelled by its title', d && d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' &&
    q(b, d.getAttribute('aria-labelledby')).textContent === 'Set this event\'s portal' && !!q(b, d.getAttribute('aria-describedby')));
  check('D.1 …the event\'s name under the title (as text)', d.querySelector('.rvp-sub').textContent === 'Retail <Leaders> Summit' && d.innerHTML.indexOf('<Leaders>') === -1);
  check('D.1 …focus on the list', b.doc.activeElement === q(b, 'rvp-select'));
  check('D.1 …the roster in it, "Choose a portal" shown disabled', q(b, 'rvp-select').options.length === ROSTER.length + 1 && q(b, 'rvp-select').options[0].disabled && q(b, 'rvp-select').options[0].textContent === 'Choose a portal' && q(b, 'rvp-select').value === '');
  check('D.1 …a label for the list', !!d.querySelector('label[for="rvp-select"]'));
  check('D.1 …the general note, and neither the site note nor the published note', d.textContent.indexOf('The event moves to this portal\'s list on the dashboard.') !== -1 &&
    d.textContent.indexOf('generated again') === -1 && d.textContent.indexOf('published again') === -1);
  check('D.1 …the error line is an alert, hidden until needed', q(b, 'rvp-error').getAttribute('role') === 'alert' && q(b, 'rvp-error').hidden);
  /* Tab stays inside */
  var save = q(b, 'rvp-save'), sel = q(b, 'rvp-select');
  b.dom.key(sel, 'Tab', { shiftKey: true });
  check('D.1 Shift+Tab on the first control goes to the last (Set portal)', b.doc.activeElement === save);
  b.dom.key(save, 'Tab');
  check('D.1 Tab on the last control goes back to the first (the list)', b.doc.activeElement === sel);
  /* nothing chosen */
  save.click();
  check('D.1 Set portal with nothing chosen: "Choose a portal." and no request', q(b, 'rvp-error').hidden === false && q(b, 'rvp-error').textContent === 'Choose a portal.' && patches.length === 0);
  sel.value = 'hr'; b.dom.fire(sel, 'change');
  check('D.1 choosing clears the message', q(b, 'rvp-error').hidden === true);
  save.click();
  check('D.1 Set portal: "Saving…" while it goes', save.textContent === 'Saving…' && save.disabled === true);
  await flush();
  check('D.1 Set portal PATCHes /api/event { eventId, portal, ifPortal: "" }', patches.length === 1 && JSON.stringify(patches[0]) === JSON.stringify({ eventId: 'retail-leaders', portal: 'hr', ifPortal: '' }), patches);
  check('D.1 …onDone(slug, name)', JSON.stringify(done) === JSON.stringify([['hr', 'ETHRWorld']]));
  check('D.1 …the window is gone and focus is back where it was', !dlg(b) && b.doc.activeElement === op);

  /* Escape */
  op = opener(b);
  b.P.openSetPortal({ eventId: 'e1', eventName: 'E1' });
  b.dom.key(q(b, 'rvp-select'), 'Escape');
  check('D.1 Escape closes it and gives focus back', !dlg(b) && b.doc.activeElement === op);
  var other2 = b.doc.createElement('button'); b.doc.body.appendChild(other2);
  b.P.openSetPortal({ eventId: 'e1', eventName: 'E1', returnFocus: other2 });
  q(b, 'rvp-cancel').click();
  check('D.1 Cancel closes it; focus goes to opts.returnFocus when given', !dlg(b) && b.doc.activeElement === other2);
  b.P.openSetPortal({ eventId: 'e1' });
  b.dom.fire(dlg(b).parentNode, 'click');
  check('D.1 a click on the dimmed page around it closes it', !dlg(b));
  b.P.openSetPortal({ eventId: 'e1' });
  b.P.openSetPortal({ eventId: 'e2' });
  check('D.1 opening a second closes the first: one window at a time', b.doc.querySelectorAll('#rv-portal-dialog').length === 1 && b.doc.querySelectorAll('.rvp-overlay').length === 1);
  q(b, 'rvp-cancel').click();

  /* a portal already set: "Change", selected, unchanged closes without a request */
  b.P.openSetPortal({ eventId: 'e3', current: 'cio', eventName: 'X' });
  check('D.1 with a portal: "Change this event\'s portal", that portal selected, no placeholder', q(b, 'rvp-title').textContent === 'Change this event\'s portal' && q(b, 'rvp-select').value === 'cio' && !q(b, 'rvp-select').options[0].disabled);
  var n0 = patches.length;
  q(b, 'rvp-save').click(); await flush();
  check('D.1 …Set portal with the same one closes and sends nothing', !dlg(b) && patches.length === n0);

  /* the notes */
  b.P.openSetPortal({ eventId: 'e4', hasGeneratedSite: true });
  check('D.1 with an ETB2B AI-designed site: the "generated again" note', dlg(b).textContent.indexOf('Its site keeps the ETB2B bar and footer it was made with. They change to this portal\'s only if the site is generated again, which replaces the site.') !== -1 &&
    dlg(b).textContent.indexOf('published again') === -1);
  q(b, 'rvp-cancel').click();
  b.P.openSetPortal({ eventId: 'e4', published: true });
  check('D.1 published: the "published again" note, and not the site note', dlg(b).textContent.indexOf('Its live registration form keeps the privacy links it was published with until it is published again.') !== -1 &&
    dlg(b).textContent.indexOf('generated again') === -1);
  q(b, 'rvp-cancel').click();

  /* a 400 */
  b = browser({ route: server({ patch: function () { return response(400, { error: 'Unknown portal "hrworld".', code: 'unknown-portal', field: 'portal' }); } }) });
  await b.P.list();
  done = [];
  b.P.openSetPortal({ eventId: 'e5', onDone: function (s) { done.push(s); } });
  q(b, 'rvp-select').value = 'auto'; q(b, 'rvp-save').click(); await flush();
  check('D.1 a 400 is shown inline, the window stays, Set portal can be pressed again', dlg(b) && q(b, 'rvp-error').hidden === false && q(b, 'rvp-error').textContent === 'Unknown portal "hrworld".' &&
    q(b, 'rvp-save').disabled === false && q(b, 'rvp-save').textContent === 'Set portal' && done.length === 0);
  check('D.1 …and Cancel works again', q(b, 'rvp-cancel').disabled === false && (q(b, 'rvp-cancel').click(), !dlg(b)));

  /* closing while "Saving…": the window waits for the answer, and a change that was made always reaches the page */
  var release = null;
  patches = [];
  b = browser({ route: server({ patch: function (body) { patches.push(body); return new Promise(function (ok) { release = function (res) { ok(res || response(200, { ok: true, updatedAt: 'x' })); }; }); } }) });
  await b.P.list();
  op = opener(b);
  done = [];
  b.P.openSetPortal({ eventId: 'np-live', eventName: 'Retail Leaders Summit', current: '', onDone: function (s, n) { done.push([s, n]); } });
  q(b, 'rvp-select').value = 'hr'; q(b, 'rvp-save').click();
  await flush(3);
  check('D.1 Saving…: the PATCH has gone, and Cancel is disabled too', patches.length === 1 && q(b, 'rvp-save').textContent === 'Saving…' && q(b, 'rvp-save').disabled === true &&
    q(b, 'rvp-cancel').disabled === true);
  var escKey = b.dom.key(q(b, 'rvp-select'), 'Escape');
  check('D.1 …Escape does not close it (and is kept from the page underneath)', !!dlg(b) && escKey.defaultPrevented === true && escKey.stopped === true);
  b.dom.fire(dlg(b).parentNode, 'click');
  check('D.1 …nor a click on the dimmed page', !!dlg(b));
  q(b, 'rvp-cancel').click();
  check('D.1 …nor Cancel', !!dlg(b) && done.length === 0);
  release();
  await flush();
  check('D.1 …the PATCH succeeds: onDone(slug, name) once, the window closes, focus goes back', JSON.stringify(done) === JSON.stringify([['hr', 'ETHRWorld']]) && !dlg(b) && b.doc.activeElement === op, done);

  /* the window replaced by another while saving (openSetPortal closes the open one) */
  done = [];
  b.P.openSetPortal({ eventId: 'np-live', current: '', onDone: function (s, n) { done.push([s, n]); } });
  q(b, 'rvp-select').value = 'cio'; q(b, 'rvp-save').click();
  await flush(3);
  b.P.openSetPortal({ eventId: 'np-draft', eventName: 'Lovable Import' });
  release();
  await flush();
  check('D.1 a window replaced while saving: its change still reaches onDone, and the new window is left as it is',
    JSON.stringify(done) === JSON.stringify([['cio', 'ETCIO']]) && b.doc.querySelectorAll('.rvp-overlay').length === 1 && dlg(b).querySelector('.rvp-sub').textContent === 'Lovable Import', done);
  q(b, 'rvp-cancel').click();
  var lateConflicts = [];
  b.P.openSetPortal({ eventId: 'np-live', current: '', onDone: function () { lateConflicts.push('done?!'); }, onConflict: function (c, n) { lateConflicts.push([c, n]); } });
  q(b, 'rvp-select').value = 'cio'; q(b, 'rvp-save').click();
  await flush(3);
  b.P.openSetPortal({ eventId: 'np-draft' });
  release(response(409, { error: 'This event\'s portal was changed to ETHRWorld meanwhile. Reload to see it.', code: 'portal-changed', current: 'hr', currentName: 'ETHRWorld' }));
  await flush();
  check('D.1 …a 409 then still reaches onConflict (the row shows what the server has), never onDone, and the new window is untouched',
    JSON.stringify(lateConflicts) === JSON.stringify([['hr', 'ETHRWorld']]) && q(b, 'rvp-error').hidden === true && q(b, 'rvp-reload').hidden === true, lateConflicts);
  q(b, 'rvp-cancel').click();
  done = [];
  b.P.openSetPortal({ eventId: 'np-live', current: '', onDone: function (s) { done.push(s); } });
  q(b, 'rvp-select').value = 'cio'; q(b, 'rvp-save').click();
  await flush(3);
  b.P.openSetPortal({ eventId: 'np-draft' });
  release(response(500, { error: 'down' }));
  await flush();
  check('D.1 …a failure then tells the page nothing (nothing was changed)', done.length === 0 && q(b, 'rvp-error').hidden === true);
  q(b, 'rvp-cancel').click();
  /* a 409 'portal-changed' */
  var conflicts = [];
  b = browser({ route: server({ patch: function () { return response(409, { error: 'This event\'s portal was changed to ETCIO meanwhile. Reload to see it.', code: 'portal-changed', current: 'cio', currentName: 'ETCIO' }); } }) });
  await b.P.list();
  b.P.openSetPortal({ eventId: 'e6', onDone: function () { conflicts.push('done?!'); }, onConflict: function (c, n) { conflicts.push([c, n]); } });
  q(b, 'rvp-select').value = 'hr'; q(b, 'rvp-save').click(); await flush();
  check('D.1 a 409 portal-changed: its sentence inline, Reload offered (and focused), Set portal put away', dlg(b) && q(b, 'rvp-error').textContent === 'This event\'s portal was changed to ETCIO meanwhile. Reload to see it.' &&
    q(b, 'rvp-reload').hidden === false && q(b, 'rvp-save').hidden === true && b.doc.activeElement === q(b, 'rvp-reload'));
  check('D.1 …onConflict(current, currentName), never onDone', JSON.stringify(conflicts) === JSON.stringify([['cio', 'ETCIO']]), conflicts);
  q(b, 'rvp-reload').click();
  check('D.1 …Reload reloads the page', b.log.reloads === 1);
  /* no answer at all */
  b = browser({ route: function (m, u, body) { if (m === 'PATCH') return Promise.reject(new TypeError('Failed to fetch')); return server()(m, u, body); } });
  await b.P.list();
  b.P.openSetPortal({ eventId: 'e7' });
  q(b, 'rvp-select').value = 'hr'; q(b, 'rvp-save').click(); await flush();
  check('D.1 offline: the connection sentence, the window stays', dlg(b) && q(b, 'rvp-error').textContent === 'Could not reach the server. Check your connection and try again.');
  /* a server answer with no sentence of its own */
  b = browser({ route: server({ patch: function () { return { status: 500, ok: false, text: function () { return Promise.resolve('<html>oops</html>'); } }; } }) });
  await b.P.list();
  b.P.openSetPortal({ eventId: 'e8' });
  q(b, 'rvp-select').value = 'hr'; q(b, 'rvp-save').click(); await flush();
  check('D.1 a 500 with no JSON: a plain sentence, never the raw page', q(b, 'rvp-error').textContent === 'The server had a problem. Please try again.');

  /* Create Event's draft: no eventId */
  b = browser({ route: server() });
  await b.P.list();
  done = [];
  b.P.openSetPortal({ onDone: function (s, n) { done.push([s, n]); } });
  check('D.1 with no eventId: "Which portal is this event on? Everything you entered is kept."', dlg(b).querySelector('.rvp-intro').textContent === 'Which portal is this event on? Everything you entered is kept.' &&
    dlg(b).textContent.indexOf('The event moves to this portal\'s list') === -1);
  q(b, 'rvp-select').value = 'cio'; q(b, 'rvp-save').click(); await flush();
  check('D.1 …it sends nothing and only reports the choice', b.log.fetch.filter(function (f) { return f.method !== 'GET'; }).length === 0 && JSON.stringify(done) === JSON.stringify([['cio', 'ETCIO']]) && !dlg(b));
  b.P.openSetPortal({ intro: 'Pick one.', hasGeneratedSite: true, published: true });
  check('D.1 …its intro can be given; the event notes never show without an event', dlg(b).querySelector('.rvp-intro').textContent === 'Pick one.' && dlg(b).textContent.indexOf('generated again') === -1 && dlg(b).textContent.indexOf('published again') === -1);
  q(b, 'rvp-cancel').click();

  /* the roster still coming, then failing, then Retry */
  var hold = null, fails = 1;
  b = browser({ route: function (m, u, body) {
    if (u === '/api/et/portals') { if (fails-- > 0) return response(502, {}); return new Promise(function (ok) { hold = function () { ok(response(200, { portals: ROSTER })); }; }); }
    return server()(m, u, body);
  } });
  op = opener(b);
  b.P.openSetPortal({ eventId: 'e9' });
  check('D.1 while the roster is coming: the list is disabled and says so, Set portal is disabled, focus on Cancel', q(b, 'rvp-select').disabled && q(b, 'rvp-select').textContent === 'Loading portals…' &&
    q(b, 'rvp-save').disabled && b.doc.activeElement === q(b, 'rvp-cancel'));
  await flush();
  check('D.1 the roster failed: "The portal list could not be loaded." with Retry (focused)', q(b, 'rvp-load').hidden === false && q(b, 'rvp-load').textContent.indexOf('The portal list could not be loaded.') !== -1 &&
    b.doc.activeElement === q(b, 'rvp-retry') && q(b, 'rvp-save').disabled);
  q(b, 'rvp-retry').click(); await flush(3); hold(); await flush();
  check('D.1 Retry asks again; the list arrives, focus moves to it, Set portal works', q(b, 'rvp-load').hidden === true && q(b, 'rvp-select').disabled === false && q(b, 'rvp-select').options.length === ROSTER.length + 1 &&
    b.doc.activeElement === q(b, 'rvp-select') && q(b, 'rvp-save').disabled === false);
  q(b, 'rvp-cancel').click();
  check('D.1 …and closing still gives focus back', b.doc.activeElement === op);

  /* a page with no auth.js */
  b = browser({ route: server(), noAuth: true });
  err = await b.P.list().then(function () { return null; }, function (e) { return e; });
  check('D.1 with no auth.js: list() rejects with its sentence; working() is null; nothing throws', err && err.message === 'The portal list could not be loaded.' && (await b.P.working()) === null);

  /* ======== D.1 ES5, one global ======== */
  var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  check('D.1 ES5: no let / const', !/\blet\s|\bconst\s/.test(code));
  check('D.1 ES5: no arrow functions, template strings, classes, async, spread', code.indexOf('=>') === -1 && code.indexOf('`') === -1 && !/\bclass\s/.test(code) && !/\basync\b|\bawait\b/.test(code) && code.indexOf('...') === -1);
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still ran */ }
  if (esbuild) {
    var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('D.1 ES5 by esbuild', es5 === true, es5);
  }
  b = browser({ route: server() });
  var own = Object.keys(b.ctx).filter(function (k) { return ['document', 'console', 'location', 'setTimeout', 'clearTimeout', 'RevampAuth', 'window', 'localStorage'].indexOf(k) === -1; });
  check('D.1 one global, RevampPortals, with K9\'s eight names', own.join() === 'RevampPortals' &&
    Object.keys(b.P).sort().join() === ['cachedWorking', 'chipHtml', 'list', 'nameOf', 'openSetPortal', 'optionsHtml', 'setWorking', 'working'].join(), [own, Object.keys(b.P)]);
  check('D.1 loading it asks nothing of the server', b.log.fetch.length === 0);
  var access = require('./access');
  check('D.1 the server sends portal-picker.js (and, being app code, without sign-in, like auth.js)', access.isServableFile('portal-picker.js') === true && access.isPublic({ method: 'GET', headers: {} }, '/portal-picker.js') === true);
  check('D.1 no portal table of its own (the roster is the server\'s)', !/ETHRWorld|hrworld|brandequity/.test(code));

  /* ======== D.2 the look ======== */
  var css = (/var CSS = \[([\s\S]*?)\]\.join/.exec(SRC) || [])[1] || '';
  b = browser({ route: server() });
  b.P.chipHtml({ eventId: 'x' });
  var injected = b.doc.getElementById('rv-portal-picker-css').textContent;
  check('D.2 the injected style is the CSS in the file', injected.length > 500 && injected.indexOf('.rvp-dialog{') !== -1 && css.indexOf('.rvp-dialog{') !== -1);
  check('D.2 no hex colour in it', !/#[0-9a-fA-F]{3,8}\b/.test(injected), injected.match(/#[0-9a-fA-F]{3,8}\b/g));
  var ALLOWED = ['surface', 'surface-2', 'border', 'text', 'text-muted', 'accent', 'accent-strong', 'accent-soft', 'accent-contrast', 'warn-soft', 'shadow-lg', 'font-body'];
  var used = (injected.match(/var\(--[\w-]+/g) || []).map(function (v) { return v.slice(6); });
  check('D.2 only the shared tokens', used.length > 20 && used.every(function (t) { return ALLOWED.indexOf(t) !== -1; }), used.filter(function (t) { return ALLOWED.indexOf(t) === -1; }));
  var rgba = injected.match(/rgba?\([^)]*\)/g) || [];
  var LISTING = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8'), EDIT_CSS = fs.readFileSync(path.join(ROOT, 'edit-event.css'), 'utf8');
  check('D.2 the one colour that is not a token is the console\'s own scrim (the same in both themes)', rgba.length === 1 && rgba[0] === 'rgba(20,18,12,.45)' && LISTING.indexOf('.modal-scrim{ position:fixed; inset:0; background:rgba(20,18,12,.45);') !== -1, rgba);
  check('D.2 every class starts rvp-', (injected.match(/\.[a-z][\w-]*/g) || []).filter(function (c) { return !/^\.\d/.test(c); }).every(function (c) { return c.indexOf('.rvp-') === 0; }), (injected.match(/\.[a-z][\w-]*/g) || []).filter(function (c) { return c.indexOf('.rvp-') !== 0; }));
  check('D.2 the window sits above the page\'s menus and sheet (60-90) and below its toasts (100)', /\.rvp-overlay\{[^}]*z-index:95;/.test(injected));
  check('D.2 the primary button stands on --accent-strong (white on --accent is below AA at this size)', /\.rvp-btn-primary\{ background:var\(--accent-strong\); border-color:var\(--accent-strong\); color:var\(--accent-contrast\); \}/.test(injected));
  check('D.2 the chip\'s words are --text-muted on --surface-2; its button --accent-strong', /\.rvp-chip-text\{[^}]*color:var\(--text-muted\); background:var\(--surface-2\)/.test(injected) && /\.rvp-chip-btn\{[^}]*color:var\(--accent-strong\)/.test(injected));
  check('D.2 notes and errors are --text on their soft grounds (the --warn and --accent words would fail AA there)', /\.rvp-warn\{[^}]*color:var\(--text\); background:var\(--warn-soft\)/.test(injected) && /\.rvp-error\{[^}]*color:var\(--text\); background:var\(--accent-soft\)/.test(injected));
  check('D.2 focus is visible on the list and the buttons', /\.rvp-select:focus\{ outline:2px solid var\(--accent\)/.test(injected) && /\.rvp-btn:focus-visible, \.rvp-chip-btn:focus-visible\{ outline:2px solid var\(--accent\)/.test(injected));

  function block(src, startRe) {
    var m = startRe.exec(src);
    if (!m) return {};
    var body = src.slice(m.index + m[0].length, src.indexOf('}', m.index + m[0].length)), out = {};
    body.replace(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g, function (_, k, v) { out[k] = v; return _; });
    return out;
  }
  var THEMES = [
    ['Event_Listing.html light', block(LISTING, /:root\{/)], ['Event_Listing.html dark', block(LISTING, /:root\[data-theme="dark"\]\{/)],
    ['edit-event.css light', block(EDIT_CSS, /:root\s*\{/)], ['edit-event.css dark', block(EDIT_CSS, /:root\[data-theme="dark"\]\{/)]
  ];
  function lum(hex) {
    var h = hex.replace('#', '');
    return [0, 2, 4].map(function (i) { var c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
      .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function ratio(a, c) { var x = lum(a), y = lum(c); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var PAIRS = [
    ['text-muted', 'surface-2', 'the chip\'s "No portal yet"'], ['accent-strong', 'surface', 'the chip\'s Set portal on a row'], ['accent-strong', 'surface-2', 'the chip\'s Set portal on a hovered row'],
    ['text', 'surface', 'the window\'s words'], ['text-muted', 'surface', 'the window\'s name line, label and notes'], ['text', 'warn-soft', 'the site and published notes'],
    ['text', 'accent-soft', 'an error'], ['accent-contrast', 'accent-strong', 'Set portal (primary)'], ['text', 'surface-2', 'a button on hover']
  ];
  THEMES.forEach(function (th) {
    check('D.2 ' + th[0] + ': the token values were read', Object.keys(th[1]).length >= 10, Object.keys(th[1]));
    PAIRS.forEach(function (p) {
      var a = th[1][p[0]], c = th[1][p[1]], rr = a && c ? ratio(a, c) : 0;
      check('D.2 ' + th[0] + ': --' + p[0] + ' on --' + p[1] + ' ≥ 4.5 (' + p[2] + ')', rr >= 4.5, { ratio: Math.round(rr * 100) / 100, fg: a, bg: c });
    });
  });
  /* they fell short in light (3.71 and 4.38) until UX-004's readable tokens; both read now */
  check('D.2 --warn words on its tint and white on --accent read in light too (UX-004)', ratio(THEMES[0][1].warn, THEMES[0][1]['warn-soft']) >= 4.5 && ratio(THEMES[0][1]['accent-contrast'], THEMES[0][1].accent) >= 4.5);

  if (failed) { console.error('portal-picker: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('portal-picker: all ' + passed + ' checks passed');
}
main().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
