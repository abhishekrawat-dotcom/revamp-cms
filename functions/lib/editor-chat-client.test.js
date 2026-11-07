// node functions/lib/editor-chat-client.test.js — ETB2B AI in the site editor (ai-everywhere plan §5, §6a, §7, §8,
// §11a U4): editor-chat-client.js, the editor's place in the one ETB2B AI panel, with its seam in
// editor-template-ui.js (RevampTemplateUI.chat), editor-ai-mode.js and custom_editor.html.
//   E.1  the files: ES5, nothing typed becomes markup, no old chat panel (#panel-chat, #chat-*), no navy or purple,
//        the mount, the scripts in order, the docking reserve, the AI markers switch, the seam's names, Stop's wording
//   E.2  the pure parts: goToFor, contentUrl, focusLabel, isPicture, wouldCover, recFor
//   E.3  joining the panel: only once the editor has its site; the kit's options for the editor (id, the
//        welcome, suggestions that only fill, the honest foot note, data-keep-selection, numbered pictures)
//   E.4  routing: questions to the events side, the page and pictures to the editor; one handoff hop each way
//   E.5  "undo that": the editor's own newest change, with no AI call
//   E.6  the "Selected" chip follows the selection, and its × lets it go
//   E.7  after a change in "Edit with AI": shown, and folded only when the panel would cover it (never while
//        the person types in it); the folded bar's Undo and the card's Undo are one
//   E.8  pictures given on another page of the event: in the tray, the words in the box, nothing sent
//   E.9  the panel's shape: docked beside the canvas in "Edit myself" at every width above a phone's (400 px wide
//        from 1100 px, 340 px below, so it never lies over the canvas's toolbars or the rail's Undo / Redo);
//        floating with a half sheet in "Edit with AI", its top kept below the tools rail; the canvas refits when
//        the column comes or goes
//   E.10 the view: Stop only while a message waits for its answer, errors in the shell's words, "Open Content ›
//        Speakers" / "Open Forms", the event's conversation and its scope line, attachments, the shell's leave(), a
//        load that never finishes
//   E.11 the real "Edit with AI" live view (editor-ai-mode.js) after a change: whenShown settles once the new live
//        view is on screen, "Changed by ETB2B AI" is outlined there for 2 s, the selected section's outline is
//        drawn again, nothing throws, and the editor's own wait (aiChangeShown, from editor-template-ui.js) ends
//        well before its 10 s limit
//   E.12 Stop while a change is applied: on the change's card (taskCard, from editor-template-ui.js), pressed once,
//        gone when the change ends; never the panel's Stop, which would give the same words back for Try again
// No network, no browser, no AI: the real kit (etb2b-chat.js), shell (etb2b-assistant.js) and, in E.11, the real
// modes (editor-ai-mode.js) run in a vm over a small DOM built here, with stand-ins for the editor's seam, sign-in,
// the store and the events side; E.7 also uses a stand-in for the modes, to steer where the change is.
// (The plan names jsdom; it is not installed in this repository, so the DOM is built here as etb2b-chat.test.js
// builds its own, with a small HTML reader for the fixed markup the editor writes, and frames that load.)
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var CLIENT = read('editor-chat-client.js');
var KIT = read('etb2b-chat.js');
var SHELL = read('etb2b-assistant.js');
var UI_SRC = read('editor-template-ui.js');
var MODE_SRC = read('editor-ai-mode.js');
var PAGE = read('custom_editor.html');
var EC = require('../../editor-chat-client.js');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function flush() { return new Promise(function (r) { setImmediate(r); }); }
async function settle(n) { for (var i = 0; i < (n || 8); i++) await flush(); }
function codeOnly(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1'); }

/* ================= a small DOM (as etb2b-chat.test.js, with querySelector, closest and window events) ================= */
function Ev(type, o) {
  this.type = type; this.defaultPrevented = false; this._stop = false;
  this.key = undefined; this.shiftKey = false; this.ctrlKey = false; this.metaKey = false; this.isComposing = false; this.keyCode = 0;
  for (var k in (o || {})) this[k] = o[k];
}
Ev.prototype.preventDefault = function () { this.defaultPrevented = true; };
Ev.prototype.stopPropagation = function () { this._stop = true; };
function dispatch(target, ev) {
  ev.target = target;
  for (var n = target; n; n = n.parentNode) {
    var ls = (n._ls && n._ls[ev.type]) || [];
    ls.slice().forEach(function (fn) { fn.call(n, ev); });
    if (ev._stop) break;
  }
  return !ev.defaultPrevented;
}
function addL(type, fn) { (this._ls[type] = this._ls[type] || []).push(fn); }
function rmL(type, fn) { var l = this._ls[type] || []; var i = l.indexOf(fn); if (i !== -1) l.splice(i, 1); }

function Tx(doc, s) { this.nodeType = 3; this.ownerDocument = doc; this.data = String(s); this.parentNode = null; }
Object.defineProperty(Tx.prototype, 'textContent', { get: function () { return this.data; }, set: function (v) { this.data = String(v); } });

var ZERO = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
function El(doc, tag) {
  this.nodeType = 1; this.ownerDocument = doc; this.localName = String(tag).toLowerCase(); this.tagName = this.localName.toUpperCase();
  this._a = {}; this.childNodes = []; this.parentNode = null; this._ls = {}; this._html = '';
  var st = {};
  Object.defineProperty(st, 'setProperty', { value: function (k, v) { st[k] = String(v); } });
  Object.defineProperty(st, 'getPropertyValue', { value: function (k) { return st[k] || ''; } });
  Object.defineProperty(st, 'removeProperty', { value: function (k) { delete st[k]; } });
  this.style = st;
  this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0;
  this.value = ''; this.selectionStart = 0; this.selectionEnd = 0;
}
var EP = El.prototype;
EP.getAttribute = function (n) { n = String(n).toLowerCase(); return Object.prototype.hasOwnProperty.call(this._a, n) ? this._a[n] : null; };
EP.setAttribute = function (n, v) { this._a[String(n).toLowerCase()] = String(v); };
EP.removeAttribute = function (n) { delete this._a[String(n).toLowerCase()]; };
EP.hasAttribute = function (n) { return this.getAttribute(n) !== null; };
function reflect(prop, attr) {
  Object.defineProperty(EP, prop, { get: function () { var v = this.getAttribute(attr); return v == null ? '' : v; }, set: function (v) { this.setAttribute(attr, v); } });
}
function flag(prop, attr) {
  Object.defineProperty(EP, prop, { get: function () { return this.hasAttribute(attr); }, set: function (v) { if (v) this.setAttribute(attr, ''); else this.removeAttribute(attr); } });
}
reflect('id', 'id'); reflect('className', 'class'); reflect('type', 'type'); reflect('href', 'href'); reflect('accept', 'accept');
flag('hidden', 'hidden'); flag('disabled', 'disabled'); flag('readOnly', 'readonly'); flag('multiple', 'multiple');
Object.defineProperty(EP, 'classList', { get: function () {
  var e = this;
  function list() { return (e.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  return {
    add: function () { var l = list(); [].slice.call(arguments).forEach(function (c) { if (l.indexOf(c) === -1) l.push(c); }); e.setAttribute('class', l.join(' ')); },
    remove: function () { var rm = [].slice.call(arguments); e.setAttribute('class', list().filter(function (c) { return rm.indexOf(c) === -1; }).join(' ')); },
    contains: function (c) { return list().indexOf(c) !== -1; },
    toggle: function (c, f) { var hasIt = list().indexOf(c) !== -1; var want = f === undefined ? !hasIt : !!f; if (want) this.add(c); else this.remove(c); return want; }
  };
} });
Object.defineProperty(EP, 'textContent', {
  get: function () { return this.childNodes.map(function (c) { return c.textContent; }).join(''); },
  set: function (v) { this.childNodes.forEach(function (c) { c.parentNode = null; }); this.childNodes = []; this._html = ''; if (String(v) !== '') this.appendChild(new Tx(this.ownerDocument, v)); }
});
Object.defineProperty(EP, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) {
    this.childNodes.forEach(function (c) { c.parentNode = null; }); this.childNodes = []; this._html = String(v);
    if (this.ownerDocument._parseHtml) readHtml(this, this._html);
  }
});
/* the fixed markup the editor writes (taskCard's card, the live view's tags): tags, attributes, text; enough for it */
var VOID = { path: 1, rect: 1, circle: 1, line: 1, polyline: 1, polygon: 1, br: 1, img: 1, input: 1 };
function readHtml(host, html) {
  var re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g, m, at = host;
  while ((m = re.exec(html))) {
    if (m[5]) { at.appendChild(new Tx(host.ownerDocument, m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))); continue; }
    if (m[1]) { if (at !== host) at = at.parentNode; continue; }
    var e = new El(host.ownerDocument, m[2]);
    (m[3].match(/[\w:-]+(?:="[^"]*")?/g) || []).forEach(function (a) { var kv = /^([\w:-]+)(?:="([^"]*)")?$/.exec(a); e.setAttribute(kv[1], kv[2] == null ? '' : kv[2]); });
    at.appendChild(e);
    if (!m[4] && !VOID[e.localName]) at = e;
  }
}
Object.defineProperty(EP, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
Object.defineProperty(EP, 'lastChild', { get: function () { return this.childNodes[this.childNodes.length - 1] || null; } });
Object.defineProperty(EP, 'children', { get: function () { return this.childNodes.filter(function (c) { return c.nodeType === 1; }); } });
Object.defineProperty(EP, 'parentElement', { get: function () { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; } });
Object.defineProperty(EP, 'isConnected', { get: function () { var n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument; } });
Object.defineProperty(EP, 'offsetTop', { get: function () { return 0; } });
Object.defineProperty(EP, 'offsetHeight', { get: function () { return 0; } });
EP.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; };
EP.insertBefore = function (c, ref) {
  if (!ref) return this.appendChild(c);
  if (c.parentNode) c.parentNode.removeChild(c);
  var i = this.childNodes.indexOf(ref);
  if (i === -1) throw new Error('insertBefore: not a child');
  this.childNodes.splice(i, 0, c); c.parentNode = this; return c;
};
EP.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i === -1) throw new Error('removeChild: not a child'); this.childNodes.splice(i, 1); c.parentNode = null; return c; };
EP.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
EP.contains = function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; };
EP.addEventListener = addL; EP.removeEventListener = rmL;
EP.dispatchEvent = function (ev) { return dispatch(this, ev); };
EP.focus = function () { this.ownerDocument.activeElement = this; };
EP.blur = function () { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; };
EP.click = function () { this._clicks = (this._clicks || 0) + 1; if (this.disabled) return; dispatch(this, new Ev('click')); };
EP.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b; };
EP.getBoundingClientRect = function () {
  var n = this;
  for (; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute('hidden')) return ZERO;
  if (n !== this.ownerDocument) return ZERO;
  return this._rect || ZERO;
};
function R(x, y, w, h) { return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x: x, y: y }; }

function walk(n, fn) { if (!n) return; if (n.nodeType === 1) fn(n); (n.childNodes || []).forEach(function (c) { walk(c, fn); }); }
function all(n, pred) { var out = []; walk(n, function (e) { if (pred(e)) out.push(e); }); return out; }
function byClass(n, c) { return all(n, function (e) { return e.classList.contains(c); }); }

/* simple selectors: tag, #id, .class, [attr], [attr="v"], :not(…), compounds of them, and lists */
function compound(s) {
  var parts = [], rest = s.trim(), m;
  if (!rest) throw new SyntaxError('empty selector');
  while (rest) {
    if ((m = /^#([\w-]+)/.exec(rest))) parts.push(function (id) { return function (e) { return e.getAttribute('id') === id; }; }(m[1]));
    else if ((m = /^\.([\w-]+)/.exec(rest))) parts.push(function (c) { return function (e) { return e.classList.contains(c); }; }(m[1]));
    else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) parts.push(function (a, v) { return function (e) { return v === undefined ? e.hasAttribute(a) : e.getAttribute(a) === v; }; }(m[1], m[2]));
    else if ((m = /^:not\(([^)]+)\)/.exec(rest))) parts.push(function (inner) { return function (e) { return !inner(e); }; }(compound(m[1])));
    else if ((m = /^([a-z][\w-]*)/.exec(rest))) parts.push(function (t) { return function (e) { return e.localName === t; }; }(m[1]));
    else throw new SyntaxError('bad selector: ' + s);
    rest = rest.slice(m[0].length);
  }
  return function (e) { return parts.every(function (p) { return p(e); }); };
}
function matcher(sel) {
  var tests = String(sel).split(',').map(function (one) {
    var chain = one.trim().split(/\s+/).map(compound);
    return function (e) {
      if (!chain[chain.length - 1](e)) return false;
      var i = chain.length - 2;
      for (var n = e.parentNode; i >= 0 && n && n.nodeType === 1; n = n.parentNode) if (chain[i](n)) i--;
      return i < 0;
    };
  });
  return function (e) { return tests.some(function (t) { return t(e); }); };
}
EP.matches = function (sel) { return matcher(sel)(this); };
EP.closest = function (sel) { var m = matcher(sel); for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (m(n)) return n; return null; };
EP.querySelectorAll = function (sel) { var m = matcher(sel), self = this; return all(this, function (e) { return e !== self && m(e); }); };
EP.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };

function makeDoc() {
  var doc = { nodeType: 9, _ls: {}, parentNode: null, readyState: 'complete' };
  doc.createElement = function (t) {
    var e = new El(doc, t);
    if (e.localName === 'iframe') {
      e.contentDocument = null; e.contentWindow = null;
      Object.defineProperty(e, 'srcdoc', { get: function () { return e._srcdoc || ''; }, set: function (v) { e._srcdoc = String(v); if (doc._onSrcdoc) doc._onSrcdoc(e, e._srcdoc); } });
    }
    return e;
  };
  doc.createTextNode = function (s) { return new Tx(doc, s); };
  doc.addEventListener = addL; doc.removeEventListener = rmL;
  var html = new El(doc, 'html'); html.parentNode = doc;
  var head = new El(doc, 'head'); html.appendChild(head);
  var body = new El(doc, 'body'); html.appendChild(body);
  doc.documentElement = html; doc.head = head; doc.body = body; doc.activeElement = body;
  doc.getElementById = function (id) { var hit = null; walk(html, function (e) { if (!hit && e.getAttribute('id') === id) hit = e; }); return hit; };
  doc.querySelectorAll = function (sel) { var m = matcher(sel); return all(html, m); };
  doc.querySelector = function (sel) { return doc.querySelectorAll(sel)[0] || null; };
  return doc;
}
function makeClock(start, thrown) {
  var t = start, q = [], seq = 0;
  return {
    now: function () { return t; },
    setTimeout: function (fn, ms) { var id = ++seq; q.push({ id: id, at: t + Math.max(0, ms || 0), fn: fn }); return id; },
    clearTimeout: function (id) { q = q.filter(function (x) { return x.id !== id; }); },
    advance: function (ms) {
      var end = t + ms;
      for (;;) {
        q.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
        var nx = q[0];
        if (!nx || nx.at > end) break;
        q.shift(); t = nx.at;
        try { nx.fn(); } catch (err) { if (thrown) thrown.push(String((err && err.stack) || err).split('\n').slice(0, 2).join(' ')); else throw err; }
      }
      t = end;
    }
  };
}

/* ================= stand-ins ================= */
var NOW = Date.parse('2026-11-07T06:35:00Z');
var EVENT = 'qa-aie-main-1';
var URL_OF = function (name) { return 'https://storage.googleapis.com/revamp-qa/events/' + EVENT + '/media/' + name; };
function fileOf(name, type, size) { return { name: name, type: type, size: size || 2048 }; }

/* the editor's half (editor-template-ui.js RevampTemplateUI.chat), as its contract says, recording what it is asked */
function makeSeam() {
  var s = { view: null, sends: [], stops: 0, undos: 0, cleared: 0, uploads: [], focusFns: [], changeFns: [], focusNow: null,
    history: { turns: 0, event: { id: EVENT, name: 'QA AIE Main' } }, historyCalls: 0, uploadFails: {}, reply: null, undoResult: null, onHistory: null };
  s.readyP = new Promise(function (r) { s.readyResolve = r; });
  s.chat = {
    attachView: function (v) { s.view = v; },
    ready: function () { return s.readyP; },
    send: function (text, o) { s.sends.push({ text: text, o: o }); return s.reply ? s.reply(text, o) : Promise.resolve({ kind: 'reply', turnId: 'r1', status: 'answered' }); },
    stop: function () { s.stops++; },
    busy: function () { return false; },
    undoLast: function () { s.undos++; return Promise.resolve(s.undoResult || { ok: true, why: '' }); },
    focus: function () { return s.focusNow; },
    onFocusChange: function (fn) { s.focusFns.push(fn); },
    clearFocus: function () { s.cleared++; s.focusNow = null; s.focusFns.forEach(function (f) { f(); }); },
    upload: function (file) {
      s.uploads.push(file.name);
      if (s.uploadFails[file.name]) return Promise.reject(new Error(s.uploadFails[file.name]));
      return Promise.resolve({ url: URL_OF(file.name), name: file.name });
    },
    replayTurn: function () { return true; },
    loadHistory: function (w) { s.historyCalls++; s.writer = w; if (s.onHistory) s.onHistory(w); return Promise.resolve(s.history); },
    onAiChange: function (fn) { s.changeFns.push(fn); },
    eventName: function () { return 'QA AIE Main'; }
  };
  s.ui = { chat: s.chat, flushes: 0, left: [], order: [],
    flush: function () { s.ui.flushes++; s.ui.order.push('flush'); }, leave: function (u) { s.ui.left.push(u); s.ui.order.push('leave'); } };
  s.select = function (f) { s.focusNow = f; s.focusFns.forEach(function (fn) { fn(); }); };
  return s;
}
/* the editor's two modes (editor-ai-mode.js RevampEditorMode) */
function makeModes(mode) {
  var m = { now: mode || 'manual', fns: [], shown: [], showResult: true, rect: null, chatOpen: [], set: [] };
  m.api = {
    mode: function () { return m.now; },
    setMode: function (x) { m.set.push(x); m.now = x; m.fns.forEach(function (f) { f(x); }); },
    onModeChange: function (fn) { m.fns.push(fn); },
    show: function (key) { m.shown.push(key); return Promise.resolve(m.showResult); },
    sectionRect: function () { return m.rect; },
    setChatOpen: function (v) { m.chatOpen.push(!!v); }
  };
  return m;
}
/* the events side (dash-bot-client.js), recording what it is asked */
var DASH_FOOT = 'ETB2B AI opens pages, answers from your events’ real numbers and starts drafts. It never deletes, cancels, publishes or approves anything.';
function makeDash() {
  var d = { calls: [], stops: 0, replays: [], reply: null };
  d.brain = {
    send: function (text, o) { d.calls.push({ text: text, o: o }); return d.reply ? d.reply(text, o) : Promise.resolve({ kind: 'reply' }); },
    stop: function () { d.stops++; },
    replay: function (t, w) { d.replays.push(t); w.user(String(t.question), { at: t.at }); w.ai(String(t.answer), { at: t.at }); return true; },
    welcome: function () { return { text: 'The events side’s welcome.', suggestions: [{ label: 'Show drafts', text: 'Show drafts' }], footNote: DASH_FOOT }; }
  };
  return d;
}
function makeStore(init) {
  var m = {};
  Object.keys(init || {}).forEach(function (k) { m[k] = init[k]; });
  return { _m: m,
    get: function (k) { return Promise.resolve(Object.prototype.hasOwnProperty.call(m, k) ? m[k] : undefined); },
    put: function (k, v) { m[k] = v; return Promise.resolve(); },
    remove: function (k) { delete m[k]; return Promise.resolve(); } };
}
function makeStorage(init) {
  var m = {};
  Object.keys(init || {}).forEach(function (k) { m[k] = String(init[k]); });
  return { _m: m,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } };
}

/* the site as the live view gets it back (POST /api/event/live-view): three top-level sections */
var LIVE_HTML = '<!doctype html><html data-rv-editor-mode="ai"><head></head><body>' +
  '<section data-rv-section="hero" data-rv-key="hero" data-sec-name="Hero"><h1>QA AIE Main</h1></section>' +
  '<section data-rv-section="agenda" data-rv-key="agenda" data-sec-name="Agenda"><h2>Agenda</h2></section>' +
  '<section data-rv-section="footer" data-rv-key="footer" data-sec-name="Footer"><p>Footer</p></section></body></html>';
var FRAME_LOAD_MS = 40;              // a live view's srcdoc loads this long after it is set
var SECTION_H = 600;

/* One editor page: custom_editor.html's shell markup, the kit, the events side, the shell, the editor's stand-ins
   and then editor-chat-client.js, in the order the page loads them.
   o: { vw, vh, mode, local, store, realModes (load editor-ai-mode.js itself, with frames that load) } */
function editorPage(o) {
  o = o || {};
  var thrown = [];
  var doc = makeDoc(), clock = makeClock(NOW, thrown), winLs = [], errors = [], mqs = [];
  if (o.realModes) doc._parseHtml = true;
  var vp = { w: o.vw || 1440, h: o.vh || 900 };
  function mqMatches(q) {
    var mx = /max-width:\s*(\d+)px/.exec(q), mn = /min-width:\s*(\d+)px/.exec(q);
    if (mx) return vp.w <= +mx[1];
    if (mn) return vp.w >= +mn[1];
    return false;
  }
  function FakeMO(cb) { this.cb = cb; }
  FakeMO.prototype.observe = function () {};
  FakeMO.prototype.disconnect = function () {};
  function WinEvent(type, opts) { Ev.call(this, type, opts); }
  WinEvent.prototype = Object.create(Ev.prototype);
  var resizes = { n: 0 };
  var auth = { fetches: [],
    authedFetch: function (u) {
      auth.fetches.push(u);
      var body = u === '/api/event/live-view' ? { html: LIVE_HTML } : {};
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(body)); }, json: function () { return Promise.resolve(body); } });
    },
    whenResolved: function () { return Promise.resolve(); },
    currentUser: function () { return { displayName: 'Asha Rao', email: 'asha.rao@example.com', uid: 'u-qa' }; } };
  var seam = makeSeam(), modes = makeModes(o.mode), dash = makeDash();
  var store = o.store || makeStore();
  var sandbox = {
    document: doc,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    matchMedia: function (q) {
      var m = { media: q, ls: [], get matches() { return mqMatches(q); }, addEventListener: function (t, fn) { if (t === 'change') this.ls.push(fn); } };
      mqs.push(m);
      return m;
    },
    navigator: { onLine: true },
    console: { error: function () { errors.push([].slice.call(arguments).map(String).join(' ')); }, warn: function () {}, log: function () {}, info: function () {} },
    get innerWidth() { return vp.w; }, get innerHeight() { return vp.h; },
    requestAnimationFrame: function (fn) { return clock.setTimeout(fn, 16); },
    addEventListener: function (t, fn) { winLs.push({ type: t, fn: fn }); },
    removeEventListener: function () {},
    dispatchEvent: function (ev) { if (ev.type === 'resize') resizes.n++; winLs.filter(function (l) { return l.type === ev.type; }).forEach(function (l) { l.fn(ev); }); return true; },
    getComputedStyle: function () { return { visibility: 'visible', display: 'block' }; },
    MutationObserver: FakeMO,
    Event: WinEvent,
    location: { pathname: '/custom_editor.html', search: '?event=' + EVENT, hash: '', origin: 'https://qa.example', href: 'https://qa.example/custom_editor.html?event=' + EVENT, assign: function (u) { env.assigned.push(u); } },
    URLSearchParams: URLSearchParams, URL: URL,
    history: { state: null, replaceState: function () {} },
    sessionStorage: makeStorage(), localStorage: o.local || makeStorage(),
    RevampAuth: auth,
    RevampPortals: { setWorking: function () {}, cachedWorking: function () { return null; } },
    RevampStore: store,
    __now: clock.now
  };
  sandbox.window = sandbox; sandbox.top = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('Date.now = function () { return __now(); };', sandbox);

  /* the parts of the editor's page the client reads: the workspace under the top bar, the Forms rail button, the mount */
  var shell = doc.createElement('div'); shell.className = 'ed';
  var ws = doc.createElement('div'); ws.className = 'ed-workspace'; ws._rect = R(0, 96, vp.w, vp.h - 96);
  var main = doc.createElement('main'); main.className = 'ed-main';
  var rail = doc.createElement('nav'); rail.className = 'ed-rail'; rail._rect = R(0, 96, vp.w, 38);
  var railFixed = doc.createElement('div'); railFixed.className = 'rail-fixed'; rail.appendChild(railFixed);
  var frameEl = doc.createElement('div'); frameEl.className = 'frame tpl-frame'; frameEl.setAttribute('id', 'frame');
  main.appendChild(rail); main.appendChild(frameEl);
  var formsBtn = doc.createElement('button'); formsBtn.className = 'rail-btn'; formsBtn.setAttribute('data-panel', 'forms');
  var formsClicks = { n: 0 };
  formsBtn.addEventListener('click', function () { formsClicks.n++; });
  ws.appendChild(formsBtn); ws.appendChild(main); shell.appendChild(ws); doc.body.appendChild(shell);
  /* a live view's frame loads what it was given: its sections, laid out one under the other */
  var frames = [];
  doc._onSrcdoc = function (ifr, html) {
    frames.push(ifr);
    clock.setTimeout(function () {
      if (!ifr.isConnected) return;
      var cd = makeDoc(), re = /<section\b([^>]*)>/g, m, i = 0;
      while ((m = re.exec(html))) {
        var sec = cd.createElement('section');
        (m[1].match(/[\w-]+="[^"]*"/g) || []).forEach(function (a) { var kv = /^([\w-]+)="([^"]*)"$/.exec(a); sec.setAttribute(kv[1], kv[2]); });
        sec._rect = R(0, i * SECTION_H, 1440, SECTION_H); i++;
        cd.body.appendChild(sec);
      }
      var cw = { document: cd, scrollY: 0, innerHeight: vp.h, scrolls: [],
        getComputedStyle: function () { return { position: 'static' }; },
        scrollTo: function (a) { cw.scrolls.push(a); }, scrollBy: function () {},
        addEventListener: function () {}, focus: function () {} };
      cd.defaultView = cw;
      ifr.contentDocument = cd; ifr.contentWindow = cw;
      dispatch(ifr, new Ev('load'));       // inside the clock: what the page's listener throws is kept in thrown
    }, FRAME_LOAD_MS);
  };
  var mount = doc.createElement('div');
  mount.setAttribute('id', 'rv-assistant');
  mount.setAttribute('data-rv-assistant', 'editor');
  mount.setAttribute('data-keep-clear', '.tpl-sel-toolbar:not([hidden]), .tpl-sec-toolbar:not([hidden]), .tpl-pop:not([hidden])');
  doc.body.appendChild(mount);

  /* the editor's canvas, as editor-ai-mode.js reads it: what it serializes, and its sections' names */
  seam.ui.canvas = function () { return seam.canvas; };
  seam.canvas = { doc: null, serialize: function () { return LIVE_HTML; }, sectionByKey: function (k) { return { key: k }; }, fit: function () {}, win: null, scrollToSection: function () {} };
  seam.ui.changeCbs = [];
  seam.ui.onChange = function (fn) { seam.ui.changeCbs.push(fn); };
  seam.ui.onFormsChange = function () {};
  seam.ui.leaveEditing = function () {};
  seam.ui.selectSection = function () {};
  seam.ui.listSections = function () { return [{ key: 'hero', name: 'Hero' }, { key: 'agenda', name: 'Agenda' }, { key: 'footer', name: 'Footer' }]; };
  seam.ui.currentPage = function () { return 'home'; };
  seam.ui.undo = function () {}; seam.ui.redo = function () {};

  vm.runInContext(KIT, sandbox, { filename: 'etb2b-chat.js' });
  sandbox.RevampDashBot = { brain: dash.brain };
  vm.runInContext(SHELL, sandbox, { filename: 'etb2b-assistant.js' });
  sandbox.RevampTemplateUI = seam.ui;
  if (o.realModes) vm.runInContext(MODE_SRC, sandbox, { filename: 'editor-ai-mode.js' });
  else sandbox.RevampEditorMode = modes.api;
  vm.runInContext(CLIENT, sandbox, { filename: 'editor-chat-client.js' });

  var env = {
    doc: doc, clock: clock, win: sandbox, seam: seam, modes: modes, dash: dash, auth: auth, store: store, mount: mount, ws: ws,
    formsClicks: formsClicks, resizes: resizes, errors: errors, assigned: [], vp: vp, thrown: thrown, frames: frames, rail: rail,
    M: function () { return sandbox.RevampEditorMode; },
    A: sandbox.RevampAssistant,
    chat: function () { return sandbox.RevampAssistant.chat(); },
    $: function (part) { return doc.getElementById('ai-chat-' + part); },
    wrap: function () { return doc.querySelector('.rvc'); },
    setVw: function (w) { vp.w = w; mqs.forEach(function (m) { m.ls.forEach(function (f) { f({ matches: m.matches }); }); }); }
  };
  return env;
}
/* the editor has its site on the canvas: the client joins the panel */
async function opened(env, ok) {
  env.seam.readyResolve(ok === undefined ? true : ok);
  await settle(10);
}
function wrapText(env) { var w = env.wrap(); return w ? w.textContent : ''; }
function threadText(env) { var t = env.$('thread'); return t ? t.textContent : ''; }
async function say(env, text) {
  var input = env.$('input');
  input.value = text;
  dispatch(input, new Ev('input'));
  env.$('send').click();
  await settle(12);
}
function chipsOf(env) { return byClass(env.$('tray'), 'rvc-achip'); }
async function attachFiles(env, files) {
  var fi = env.$('file');
  fi.files = files;
  dispatch(fi, new Ev('change'));
  await settle(10);
}
/* what runAiTurn does through the view once a change is on the canvas: the answer, the change's card with its own
   Undo (editor-built), then the listeners told (onAiChange), with t.peekFn the one function both Undos share */
function editorChange(env, key, name) {
  var v = env.seam.view, d = env.doc;
  var body = v.ai('I changed the ' + name + '.');
  var card = d.createElement('div'); card.className = 'ai-task';
  var foot = d.createElement('div'); foot.className = 'ai-task-foot';
  var undo = d.createElement('button'); undo.className = 'btn chat-undo'; undo.textContent = 'Undo';
  foot.appendChild(undo); card.appendChild(foot); body.parentNode.appendChild(card);
  var t = { undone: 0, status: 'applied', button: undo, body: body };
  function undoT() {
    if (t.status === 'undone') return Promise.resolve(false);
    t.undone++; t.status = 'undone';
    undo.textContent = 'Undone'; undo.disabled = true;
    v.markUndone(t.peekFn);            // editor-template-ui.js markUndone(t): the folded bar's Undo says it too
    return Promise.resolve(true);
  }
  t.peekFn = function () { return undoT(); };
  undo.addEventListener('click', function () { undoT(); });
  var waits = env.seam.changeFns.map(function (fn) { return fn({ key: key, name: name, peekFn: t.peekFn, turnId: 't-' + key }); });
  t.waits = waits;
  return t;
}
function panelEl(env) { return env.doc.querySelector('.rvc-panel'); }
/* the page's clock runs, 10 ms at a time, until done() or maxMs: how long it took, or -1 */
async function runUntil(env, done, maxMs) {
  var start = env.clock.now();
  for (var ms = 0; ms <= maxMs; ms += 10) {
    await settle(3);
    if (done()) return env.clock.now() - start;
    env.clock.advance(10);
  }
  await settle(3);
  return done() ? env.clock.now() - start : -1;
}
async function runFor(env, ms) { await runUntil(env, function () { return false; }, ms); }
function peekUndo(env) { var p = env.$('peek'); return p ? byClass(p, 'rvc-undo')[0] : null; }

(async function main() {
  /* ======== E.1 the files ======== */
  var code = codeOnly(CLIENT);
  check('E.1 ES5: no let / const, arrows, template strings, spread, async, class', !/\blet\s/.test(code) && !/\bconst\s/.test(code) && code.indexOf('=>') === -1 &&
    code.indexOf('`') === -1 && code.indexOf('...') === -1 && !/\basync\s+function\b|\bawait\s/.test(code) && !/\bclass\s+[A-Z]/.test(code));
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the regex check above still ran */ }
  if (esbuild) {
    ['editor-chat-client.js', 'editor-ai-mode.js', 'editor-template-ui.js'].forEach(function (f) {
      var r = (function () { try { esbuild.transformSync(read(f), { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
      check('E.1 ES5 by esbuild: ' + f, r === true, r);
    });
  } else console.log('editor-chat-client: esbuild is not installed here, so its ES5 pass was skipped (the regex check ran)');
  check('E.1 no literal line separator in the client (it ends a regex literal in older engines)', !/[\u2028\u2029]/.test(CLIENT));
  check('E.1 the client writes no markup from text', !/\binnerHTML\b|insertAdjacentHTML|document\.write/.test(code));
  check('E.1 a page may load it (a top-level .js the server sends)', require('./access').isServableFile('editor-chat-client.js') === true);
  check('E.1 one global, and module.exports for this test', /root\.RevampEditorChat = api/.test(CLIENT) && /module\.exports = api/.test(CLIENT));

  /* no old chat panel anywhere in the editor's files: #panel-chat, the launcher, #chat-* ids, its open/close script */
  var EDITOR_FILES = { 'custom_editor.html': PAGE, 'editor-template-ui.js': UI_SRC, 'editor-ai-mode.js': MODE_SRC, 'editor-chat-client.js': CLIENT };
  Object.keys(EDITOR_FILES).forEach(function (f) {
    var s = EDITOR_FILES[f];
    var hits = s.match(/panel-chat|chat-launcher|getElementById\(\s*['"]chat-|id\s*=\s*["']chat-|#chat-[a-z]|wireChatPanel|chatFocusRedraw/g) || [];
    check('E.1 no old chat panel in ' + f + ' (#panel-chat, #chat-launcher, #chat-* ids, wireChatPanel)', hits.length === 0, hits.slice(0, 5));
    check('E.1 no old robot face copies in ' + f + ' (rvbh, rvbl, rvbc)', !/id=["']rvb[hlc]["']/.test(s));
  });
  check('E.1 custom_editor.html holds no navy #1c2540 or purple #3a2a6d', !/#1c2540|#3a2a6d/i.test(PAGE), (PAGE.match(/#1c2540|#3a2a6d/ig) || []).slice(0, 3));
  check('E.1 nor do the editor scripts', !/#1c2540|#3a2a6d/i.test(UI_SRC + MODE_SRC + CLIENT));

  /* the mount, the stylesheet and the scripts, in the plan's order (§4b), each once */
  var mounts = PAGE.match(/<div[^>]*data-rv-assistant[^>]*>/g) || [];
  check('E.1 one mount, data-rv-assistant="editor"', mounts.length === 1 && /data-rv-assistant="editor"/.test(mounts[0]), mounts);
  var keep = mounts[0] ? (/data-keep-clear="([^"]*)"/.exec(mounts[0]) || [])[1] || '' : '';
  check('E.1 the launcher keeps clear of the canvas\'s floating toolbars', same(keep.split(/\s*,\s*/), ['.tpl-sel-toolbar:not([hidden])', '.tpl-sec-toolbar:not([hidden])', '.tpl-pop:not([hidden])']), keep);
  check('E.1 the kit\'s stylesheet is linked once', (PAGE.match(/<link rel="stylesheet" href="etb2b-chat\.css">/g) || []).length === 1);
  var order = ['editor-template-ui.js', 'editor-ai-mode.js', 'etb2b-chat.js', 'dash-bot-client.js', 'etb2b-assistant.js', 'editor-chat-client.js'];
  var at = order.map(function (f) { return PAGE.indexOf('<script src="' + f + '"></script>'); });
  check('E.1 scripts: the editor, its modes, then the kit, the events side, the shell and the editor\'s part', at.every(function (x, i) { return x !== -1 && (i === 0 || x > at[i - 1]); }), at);
  check('E.1 each of the four ETB2B AI scripts once', order.slice(2).every(function (f) { return PAGE.split('<script src="' + f + '"></script>').length === 2; }));
  check('E.1 the docked column keeps its room beside the canvas (Edit myself, 1100 px and wider: 400 px)',
    /@media \(min-width: ?1100px\)\{ ?html\.rvc-docked body:not\(\.ed-mode-ai\) \.ed-main\{ ?margin-right: ?400px; ?\} ?\}/.test(PAGE));
  var narrowDock = /@media \(max-width: ?1099\.98px\)\{([^@]*?)\n  \}/.exec(PAGE);
  check('E.1 …and below 1100 px a 340 px column with the same room kept (it docks above a phone\'s width)', !!narrowDock &&
    /\.rvc\.rvc-is-docked\{ ?--rvc-panel-w: ?340px; ?\}/.test(narrowDock[1]) && /html\.rvc-docked body:not\(\.ed-mode-ai\) \.ed-main\{ ?margin-right: ?340px; ?\}/.test(narrowDock[1]), narrowDock && narrowDock[1]);
  check('E.1 the floating panel\'s top stays below the tools rail (--rvc-ed-top), never over its Undo / Redo',
    /\.rvc:not\(\.rvc-is-docked\):not\(\.rvc-phone\) \.rvc-panel\{ ?max-height: ?calc\(100vh - var\(--rvc-bottom\) - var\(--rvc-gap\) - var\(--rvc-lift\) - var\(--rvc-ed-top, ?98px\) - 8px\); ?\}/.test(PAGE));
  check('E.1 the change card is styled in the panel\'s palette (.rvc .ai-task, --rvc-* tokens)', /\.rvc \.ai-task\{[^}]*var\(--rvc-/.test(PAGE));
  /* UX-100: the unexplained sparkle beside "Edit with AI" is gone from the top bar; B14 (UX-078) made it a labelled
     switch in the Layers panel, which says what it does */
  check('E.1 no AI-markers sparkle in the top bar beside the mode switch (UX-100)', PAGE.indexOf('id="btn-ai-markers"') === -1);
  check('E.1 …it is the Layers panel\'s "Show AI markers" switch, labelled, saying what it marks (UX-100, B14)',
    /<label for="ai-markers-toggle">Show AI markers<\/label>/.test(PAGE) && /Marks the sections AI wrote, to check before you publish/.test(PAGE) && /<input type="checkbox" id="ai-markers-toggle">/.test(PAGE));

  /* the seam (editor-template-ui.js) and the modes (editor-ai-mode.js), by their names */
  var chatObj = /chat: \{\s*attachView:[\s\S]*?eventName:[^\n]*\n\s*\}/.exec(UI_SRC);
  ['attachView', 'ready', 'send', 'stop', 'busy', 'undoLast', 'focus', 'onFocusChange', 'clearFocus', 'upload', 'attach', 'offerPicture', 'replayTurn', 'loadHistory', 'onAiChange', 'eventName']
    .forEach(function (k) { check('E.1 RevampTemplateUI.chat.' + k, !!chatObj && new RegExp('\\b' + k + ':').test(chatObj[0])); });
  check('E.1 "Took" counts from when the message was sent (UX-097)', /startedAt: sent\.sentAt \|\| Date\.now\(\)/.test(UI_SRC));
  check('E.1 a reason never ends in two full stops (UX-097)', /function stopDot\(s\)/.test(UI_SRC) && /stopDot\(because\) \+ '\.'/.test(UI_SRC));
  check('E.1 a change being applied has its own Stop, on its card, which asks it to stop and says "Stopping after the step in progress…"',
    /card\.offerStop\(function \(\) \{ if \(chatStop\(\)\) setChatStatus\('working', CHAT_TEXT\.stopping\); \}\);/.test(UI_SRC) &&
    UI_SRC.indexOf('card.offerStop(') > UI_SRC.indexOf('currentTurn = t;                  // until setAiWorking(false)'));
  check('E.1 …a keyboard user who pressed it lands on the change\'s Undo (or the message box when nothing changed)',
    /if \(card\.stopHadFocus\) \{ card\.stopHadFocus = false; b\.focus\(\); \}/.test(UI_SRC) && (UI_SRC.match(/if \(card\.stopHadFocus && viewCan\('focusInput'\)\) chatView\.focusInput\(\);/g) || []).length === 2);
  check('E.1 Stop while waiting: "Stopped. Your page is unchanged." (the editor\'s words, as its error lines) and the turn kept as stopped', /stoppedWaiting: 'Stopped\. Your page is unchanged\.'/.test(UI_SRC) && /reportTurn\(r\.body\.turnId, 'stopped'\)/.test(UI_SRC));
  check('E.1 the wait for the page says it honestly (UX-097)', UI_SRC.indexOf('ETB2B AI is looking at your page (a few seconds)…') !== -1);
  check('E.1 the dropped suggestions are gone (UX-095)', UI_SRC.indexOf('Make the buttons rounder') === -1 && UI_SRC.indexOf('Add a short FAQ section') === -1 && CLIENT.indexOf('Make the buttons rounder') === -1);
  check('E.1 a step names what it becomes (UX-099): designLine, “old” → “new”', /function designLine\(key, value\)/.test(UI_SRC) && UI_SRC.indexOf("'” → “'") !== -1);
  check('E.1 a refused value is said as a sentence (UX-099)', /isn’t ' \+ \(\/Color\$\/\.test\(m\[1\]\) \? 'a color' : 'a setting'\) \+ ' this page can use, so it wasn’t changed\.'/.test(UI_SRC));
  check('E.1 a key typed in the panel never reaches the editor\'s shortcuts', /at\.closest\('\.rvc'\)\) return;/.test(UI_SRC));
  ['show', 'whenShown', 'sectionRect', 'setChatOpen', 'onModeChange'].forEach(function (k) { check('E.1 RevampEditorMode.' + k, new RegExp('\\n\\s*' + k + ': ').test(MODE_SRC)); });
  check('E.1 the live view outlines a change "Changed by ETB2B AI" for 2 s (UX-094)', /FLASH_TAG = 'Changed by ETB2B AI'/.test(MODE_SRC) && /FLASH_MS = 2000/.test(MODE_SRC));
  check('E.1 the live view\'s fallback is the console\'s, the hint stays short (UX-097)', MODE_SRC.indexOf('the preview could not be prepared, so this is the editor’s copy) —') === -1 &&
    /console\.info\('\[editor-ai-mode\] the preview could not be prepared/.test(MODE_SRC) && MODE_SRC.indexOf("hint.textContent = 'Live view — click any section to ask ETB2B AI about it'") !== -1);
  check('E.1 the modes open the one panel (RevampAssistant), never a #chat-launcher click', /A\.open\(\)/.test(MODE_SRC) && !/launcher\.click\(\)/.test(MODE_SRC));

  /* ======== E.2 the pure parts ======== */
  check('E.2 goToFor: the server\'s goTo wins', EC.goToFor('content:agenda', 'Speakers are entered under Content') === 'content:agenda');
  check('E.2 goToFor: forms', EC.goToFor('forms', '') === 'forms');
  check('E.2 goToFor: a goTo it does not know is none, never a guess', EC.goToFor('content:evil', 'Speakers are under Content') === '');
  check('E.2 goToFor: words that send to Content name the tab', EC.goToFor('', 'Speakers are entered under Content › Speakers, not on this page.') === 'content:speakers');
  check('E.2 goToFor: the first record named', EC.goToFor('', 'Add the session in the Content tab; its speakers follow.') === 'content:agenda');
  check('E.2 goToFor: partners are sponsors', EC.goToFor('', 'Partners are added under Content.') === 'content:sponsors');
  check('E.2 goToFor: no mention of Content, no button', EC.goToFor('', 'I changed the speakers heading.') === '');
  check('E.2 contentUrl: an address the events side may open too', EC.contentUrl(EVENT, 'content:speakers') === '/edit-event.html?event=' + EVENT + '#content/speakers');
  check('E.2 contentUrl: a bad event id gives none', EC.contentUrl('../x', 'content:speakers') === '' && EC.contentUrl('', 'content:faq') === '');
  check('E.2 contentUrl: forms is not an address', EC.contentUrl(EVENT, 'forms') === '');
  check('E.2 focusLabel: section only', EC.focusLabel({ sectionId: 'why', name: 'Why attend' }) === 'Why attend');
  var longLabel = EC.focusLabel({ sectionId: 'why', name: 'Why attend', element: { kind: 'text', text: 'Six reasons to be in the room this year at the summit of all summits' } });
  var quoted = (/“([^”]*)”$/.exec(longLabel) || [])[1] || '';
  check('E.2 focusLabel: with its text, clipped to 48 characters', longLabel.indexOf('Why attend · “Six reasons to be in the room this year at the') === 0 && quoted.length <= 48 && /…$/.test(quoted), longLabel);
  check('E.2 focusLabel: short text whole', EC.focusLabel({ sectionId: 'why', name: 'Why attend', element: { kind: 'text', text: 'Six reasons' } }) === 'Why attend · “Six reasons”');
  check('E.2 focusLabel: a picture', EC.focusLabel({ sectionId: 'hero', name: 'Hero', element: { kind: 'image', text: '' } }) === 'Hero · picture');
  check('E.2 focusLabel: nothing selected', EC.focusLabel(null) === '' && EC.focusLabel({}) === '');
  check('E.2 isPicture: by type', EC.isPicture(fileOf('a.png', 'image/png')) && EC.isPicture(fileOf('a.svg', 'image/svg+xml')) && EC.isPicture(fileOf('a.gif', 'image/gif')));
  check('E.2 isPicture: a type with no name ending', EC.isPicture({ name: 'a', type: 'image/jpeg' }));
  check('E.2 isPicture: a brief is not', !EC.isPicture(fileOf('brief.pdf', 'application/pdf')) && !EC.isPicture(fileOf('deck.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')));
  check('E.2 isPicture: the type wins over the name', !EC.isPicture(fileOf('looks.png', 'text/html')));
  check('E.2 isPicture: no type, known by its ending', EC.isPicture({ name: 'logo.SVG', type: '' }) && !EC.isPicture({ name: 'notes.txt', type: '' }));
  check('E.2 wouldCover: overlapping boxes', EC.wouldCover(R(0, 100, 1440, 500), R(1018, 160, 400, 640)));
  check('E.2 wouldCover: side by side', !EC.wouldCover(R(0, 100, 1000, 500), R(1018, 160, 400, 640)));
  check('E.2 wouldCover: touching edges do not cover', !EC.wouldCover(R(0, 0, 1018, 900), R(1018, 160, 400, 640)));
  check('E.2 wouldCover: none', !EC.wouldCover(null, R(0, 0, 1, 1)));
  var rec = EC.recFor(URL_OF('a.png'), 'a.png', 2048);
  check('E.2 recFor: the address is the chip\'s id and what is sent', rec.id === URL_OF('a.png') && rec.url === URL_OF('a.png') && rec.kind === 'image' && rec.thumb === URL_OF('a.png') && rec.size === 2048);
  check('E.2 recFor: a picture with no name', EC.recFor(URL_OF('b.png'), '', 0).name === 'Picture');
  check('E.2 the text table: the welcome names the event', EC.TEXT.welcome('QA AIE Main').indexOf('answer questions about QA AIE Main and open its other pages') !== -1);
  check('E.2 the text table: carried pictures', EC.TEXT.carried(1) === 'The picture you gave me is in the tray. Say where it goes and send.' &&
    EC.TEXT.carried(2) === 'The 2 pictures you gave me are in the tray. Say where they go and send.' && EC.TEXT.carried(0) === '');

  /* ======== E.3 joining the panel ======== */
  var env = editorPage();
  await settle(6);
  env.clock.advance(1600);
  await settle(6);
  check('E.3 no panel before the editor has its site (the shell waits for the place)', !env.wrap() && !env.A.chat());
  await opened(env);
  check('E.3 mounted once the editor has its site', !!env.wrap() && !!env.A.chat());
  check('E.3 the kit\'s id is "ai" off the dashboard', !!env.doc.getElementById('ai-chat-launcher') && !env.doc.getElementById('dash-chat-launcher'));
  check('E.3 the editor\'s view is attached', !!env.seam.view && typeof env.seam.view.ai === 'function');
  check('E.3 a click in the panel keeps the selected section (data-keep-selection)', env.wrap().hasAttribute('data-keep-selection'));
  check('E.3 the change listener is the client\'s', env.seam.changeFns.length === 1);
  check('E.3 the focus listener is there (the shell\'s chip)', env.seam.focusFns.length >= 1);
  check('E.3 the attach button says what it takes here', env.$('attach') && env.$('attach').getAttribute('aria-label') === 'Attach a picture');
  var accept = env.$('file') ? env.$('file').getAttribute('accept') || '' : '';
  check('E.3 the file dialog asks for pictures only', /image\/png/.test(accept) && /image\/svg\+xml/.test(accept) && !/pdf|text\//.test(accept), accept);
  env.A.open();
  await settle(8);
  var wt = wrapText(env);
  check('E.3 the welcome is the editor\'s (the person\'s first name, this event)', wt.indexOf('Hi Asha') !== -1 && wt.indexOf('I change this page when you ask') !== -1 && wt.indexOf('answer questions about QA AIE Main') !== -1, wt.slice(0, 300));
  check('E.3 the events side\'s welcome is not used here', wt.indexOf('The events side’s welcome.') === -1);
  check('E.3 the editor\'s suggestions', EC.TEXT.suggestions.every(function (s) { return wt.indexOf(s.label) !== -1; }) && wt.indexOf('Show drafts') === -1);
  /* the note under the box is the editor's own: here ETB2B AI does change (and can remove) parts of the page, so the
     other pages' "It never deletes … anything" would not be true */
  check('E.3 the note under the box says what ETB2B AI does in the editor', wt.indexOf('ETB2B AI changes this page when you ask, and every change has an Undo. It never saves, publishes, deletes an event or approves anything.') !== -1 &&
    wt.indexOf('It never deletes, cancels, publishes or approves anything.') === -1);
  check('E.3 the event\'s conversation was read once (the editor\'s own replay)', env.seam.historyCalls === 1);
  check('E.3 the scope line names the event', env.$('scope') && env.$('scope').textContent === 'This event: QA AIE Main', env.$('scope') && env.$('scope').textContent);
  var sug = all(env.wrap(), function (e) { return e.localName === 'button' && e.textContent === 'Shorten the overview to two sentences'; })[0];
  if (sug) sug.click();
  await settle(6);
  check('E.3 a suggestion only fills the box (UX-095)', env.$('input').value === 'Shorten the overview to two sentences' && env.seam.sends.length === 0 && env.dash.calls.length === 0, env.$('input').value);
  check('E.3 the panel opening is told to the modes (ai-chat-open)', env.modes.chatOpen[env.modes.chatOpen.length - 1] === true);

  /* ======== E.4 routing ======== */
  env.$('input').value = '';
  await say(env, 'How many registrations does this event have?');
  check('E.4 a question about the event goes to the events side', env.dash.calls.length === 1 && env.seam.sends.length === 0, { dash: env.dash.calls.length, edit: env.seam.sends.length });
  check('E.4 …with where it was asked', env.dash.calls[0] && env.dash.calls[0].o.place && env.dash.calls[0].o.place.page === 'editor' && env.dash.calls[0].o.place.eventId === EVENT);
  await say(env, 'Open its promotions');
  check('E.4 opening another page goes to the events side', env.dash.calls.length === 2 && env.seam.sends.length === 0);
  await say(env, 'Shorten the overview to two sentences');
  check('E.4 a change to the page goes to the editor', env.seam.sends.length === 1 && env.dash.calls.length === 2);
  check('E.4 …sent with no pictures and not handed over', env.seam.sends[0] && same(env.seam.sends[0].o.attachments, []) && env.seam.sends[0].o.handedFrom === undefined, env.seam.sends[0] && env.seam.sends[0].o);
  await say(env, 'Rewrite the hero tagline to sound more premium');
  check('E.4 a page cue keeps it with the editor', env.seam.sends.length === 2);
  await attachFiles(env, [fileOf('stage.png', 'image/png')]);
  var chips = chipsOf(env);
  check('E.4 an attached picture is uploaded the editor\'s own way and numbered', env.seam.uploads.indexOf('stage.png') !== -1 && chips.length === 1 &&
    chips[0].classList.contains('is-ready') && byClass(chips[0], 'rvc-achip-num')[0].textContent === '1');
  await say(env, 'How many registrations does this event have?');
  check('E.4 with a picture attached the editor answers, whatever the words', env.seam.sends.length === 3 && env.dash.calls.length === 2);
  check('E.4 …and the picture goes as its address', env.seam.sends[2] && same(env.seam.sends[2].o.attachments, [URL_OF('stage.png')]), env.seam.sends[2] && env.seam.sends[2].o);
  check('E.4 the tray is empty once sent', chipsOf(env).length === 0);

  /* one handoff hop: the editor says it is not about the page, the events side answers, and is not handed back */
  var busyAtDash = '';
  env.seam.reply = function () { return Promise.resolve({ kind: 'handoff', turnId: '', status: '' }); };
  env.dash.reply = function () { busyAtDash = env.$('busy') && !env.$('busy').hidden ? env.$('busy').textContent : ''; return Promise.resolve({ kind: 'reply' }); };
  await say(env, 'Tell me about QA AIE Draft');
  check('E.4 not about the page: the editor asked first (no cue), the events side once', env.seam.sends.length === 4 && env.dash.calls.length === 3, { edit: env.seam.sends.length, dash: env.dash.calls.length });
  check('E.4 …handed from the editor', env.dash.calls[2] && env.dash.calls[2].o.handedFrom === 'edit');
  check('E.4 …the busy line says what is happening', /Checking your events…/.test(busyAtDash), busyAtDash);
  env.dash.reply = function () { return Promise.resolve({ kind: 'handoff' }); };
  await say(env, 'Tell me about the other one');
  check('E.4 a second handoff is not followed: one call each, then a plain sentence', env.seam.sends.length === 5 && env.dash.calls.length === 4 &&
    threadText(env).indexOf('I couldn’t tell whether that is about this page.') !== -1, { edit: env.seam.sends.length, dash: env.dash.calls.length });
  /* the other way: the events side hands a message to the editor, which may not hand it back */
  env.dash.reply = function () { return Promise.resolve({ kind: 'handoff' }); };
  env.seam.reply = function () { return Promise.resolve({ kind: 'handoff', turnId: '', status: '' }); };
  await say(env, 'How many visitors came from the speakers list?');
  check('E.4 from the events side: the editor answers once, handed from the events side', env.dash.calls.length === 5 && env.seam.sends.length === 6 && env.seam.sends[5].o.handedFrom === 'dash',
    { dash: env.dash.calls.length, edit: env.seam.sends.length, o: env.seam.sends[5] && env.seam.sends[5].o });
  check('E.4 …and never back again', env.dash.calls.length === 5);
  env.seam.reply = null; env.dash.reply = null;

  /* ======== E.5 "undo that" ======== */
  var before = { edit: env.seam.sends.length, dash: env.dash.calls.length, fetch: env.auth.fetches.length };
  await say(env, 'undo that');
  check('E.5 "undo that" undoes the editor\'s newest change', env.seam.undos === 1);
  check('E.5 …with no AI call at all', env.seam.sends.length === before.edit && env.dash.calls.length === before.dash && env.auth.fetches.length === before.fetch);
  check('E.5 …and says so', threadText(env).indexOf('Undone. The page is back to how it was before my last change.') !== -1);
  for (var phrase of ['Undo', 'Put it back.', 'revert it', 'take that back']) {
    await say(env, phrase);
  }
  check('E.5 the undo phrases all undo locally', env.seam.undos === 5 && env.seam.sends.length === before.edit && env.dash.calls.length === before.dash, env.seam.undos);
  /* a bare "go back" could be undo or another page ("go back to the console"): the assistant asks, never guesses */
  await say(env, 'Go back!');
  check('E.5 a bare "go back" is asked about: no undo, no AI call', env.seam.undos === 5 && env.seam.sends.length === before.edit && env.dash.calls.length === before.dash &&
    threadText(env).indexOf('Do you want me to undo my last change, or open another page?') !== -1, env.seam.undos);
  env.seam.undoResult = { ok: false, why: 'There is no change of mine on the page to undo. Undo in the top bar steps back through your own edits.' };
  await say(env, 'undo it');
  check('E.5 nothing to undo: the editor\'s reason is said', threadText(env).indexOf('There is no change of mine on the page to undo.') !== -1);
  env.seam.undoResult = null;
  await say(env, 'undo the hero change and make it blue');
  check('E.5 a longer message is a request, for the editor', env.seam.sends.length === before.edit + 1 && env.seam.undos === 6);
  await say(env, 'go back to the dashboard');
  check('E.5 "go back to the dashboard" is opening a page, for the events side', env.dash.calls.length === before.dash + 1 && env.seam.undos === 6);

  /* ======== E.6 the "Selected" chip ======== */
  var ctx = env.$('context');
  env.seam.select({ sectionId: 'why', name: 'Why attend', element: { kind: 'text', text: 'Six reasons to be in the room this year at the summit of all summits' } });
  await settle(4);
  check('E.6 a selection shows the chip', ctx && !ctx.hidden && ctx.textContent.indexOf('Why attend · “Six reasons') !== -1, ctx && ctx.textContent);
  var ctxText = byClass(ctx, 'rvc-context-text')[0];
  check('E.6 …with what it means as its title', ctxText && ctxText.getAttribute('title') === EC.TEXT.focusTitle);
  env.seam.select({ sectionId: 'hero', name: 'Hero', element: { kind: 'image', text: '' } });
  await settle(4);
  check('E.6 it follows the selection (a picture)', ctx.textContent.indexOf('Hero · picture') !== -1, ctx.textContent);
  await say(env, 'Make it brighter');
  var lastUser = byClass(env.$('thread'), 'rvc-user').pop();
  check('E.6 the message says what it was about (↳ Hero · picture)', lastUser && lastUser.textContent.indexOf('Hero · picture') !== -1, lastUser && lastUser.textContent);
  byClass(ctx, 'rvc-context-rm')[0].click();
  await settle(4);
  check('E.6 its × lets go of the selection for the message', env.seam.cleared === 1 && ctx.hidden);
  env.seam.select(null);
  await settle(4);
  check('E.6 nothing selected: no chip', ctx.hidden);

  /* ======== E.7 after a change in "Edit with AI" ======== */
  env.modes.now = 'ai';
  env.modes.fns.forEach(function (f) { f('ai'); });
  env.A.open();
  await settle(4);
  panelEl(env)._rect = R(1018, 160, 400, 640);
  env.modes.rect = R(0, 120, 1440, 600);
  var t1 = editorChange(env, 'hero', 'Hero');
  check('E.7 the editor waits for the change to show (a promise)', t1.waits.length === 1 && t1.waits[0] && typeof t1.waits[0].then === 'function');
  await settle(8);
  check('E.7 the live view is taken to the changed section', same(env.modes.shown, ['hero']), env.modes.shown);
  check('E.7 the panel would cover it: it folds', env.chat().isFolded() && !env.chat().isOpen());
  check('E.7 the bar says what changed', byClass(env.$('peek'), 'rvc-peek-label')[0].textContent === 'Changed “Hero”', byClass(env.$('peek'), 'rvc-peek-label')[0].textContent);
  var pu = peekUndo(env);
  check('E.7 the bar has this change\'s Undo', pu && !pu.hidden && pu.textContent === 'Undo');
  pu.click();
  await settle(6);
  check('E.7 the bar\'s Undo is the change\'s own Undo (once)', t1.undone === 1);
  check('E.7 …and both say Undone', t1.button.textContent === 'Undone' && peekUndo(env).textContent === 'Undone', [t1.button.textContent, peekUndo(env).textContent]);
  /* the card's Undo first: the bar says Undone too, and its Undo does nothing more */
  byClass(env.$('peek'), 'rvc-btn').filter(function (b) { return b.textContent === 'Back to chat'; })[0].click();
  await settle(4);
  check('E.7 Back to chat reopens', env.chat().isOpen() && !env.chat().isFolded());
  var t2 = editorChange(env, 'agenda', 'Agenda');
  await settle(8);
  check('E.7 a second change folds again', env.chat().isFolded());
  t2.button.click();
  await settle(4);
  check('E.7 the card\'s Undo makes the bar\'s read Undone', peekUndo(env).textContent === 'Undone' && t2.undone === 1);
  peekUndo(env).click();
  await settle(4);
  check('E.7 …and the bar\'s Undo cannot undo it twice', t2.undone === 1);
  env.chat().open();
  await settle(4);
  /* not over it: no fold */
  env.modes.rect = R(0, 120, 980, 600);
  editorChange(env, 'overview', 'Overview');
  await settle(8);
  check('E.7 beside the panel: shown, not folded', env.modes.shown[env.modes.shown.length - 1] === 'overview' && env.chat().isOpen() && !env.chat().isFolded());
  /* someone typing in the panel keeps it open */
  env.modes.rect = R(0, 120, 1440, 600);
  env.$('input').value = 'and the footer';
  env.$('input').focus();
  editorChange(env, 'footer', 'Footer');
  await settle(8);
  check('E.7 typing in the panel: it stays open', env.chat().isOpen() && !env.chat().isFolded());
  env.$('input').value = '';
  env.doc.body.focus();
  env.doc.activeElement = env.doc.body;
  /* the live view could not show it: no fold */
  env.modes.showResult = false;
  editorChange(env, 'venue', 'Venue');
  await settle(8);
  check('E.7 not shown on the live view: not folded', env.chat().isOpen() && !env.chat().isFolded());
  env.modes.showResult = true;
  /* the panel was shut: nothing to fold */
  env.chat().close();
  await settle(4);
  editorChange(env, 'sponsors', 'Sponsors');
  await settle(8);
  check('E.7 the panel shut: no bar', !env.chat().isFolded());
  /* "Edit myself": the panel is docked beside the canvas, nothing is covered, nothing is shown in a live view */
  env.modes.now = 'manual';
  env.modes.fns.forEach(function (f) { f('manual'); });
  env.chat().open();
  await settle(4);
  var shownBefore = env.modes.shown.length;
  var tm = editorChange(env, 'hero', 'Hero');
  await settle(8);
  check('E.7 Edit myself: no live view to show, no fold, nothing waited for', env.modes.shown.length === shownBefore && !env.chat().isFolded() && tm.waits[0] === null);

  /* ======== E.10 the view ======== */
  env.seam.view.status('thinking', 'ETB2B AI is reading your request…');
  check('E.10 busy: the strip says what ETB2B AI is doing', !env.$('busy').hidden && env.$('busy').textContent.indexOf('ETB2B AI is reading your request…') !== -1);
  check('E.10 busy: Stop is offered', !env.$('stop').hidden);
  env.$('stop').click();
  await settle(4);
  check('E.10 Stop asks the editor to stop', env.seam.stops === 1);
  env.seam.view.status('thinking', 'ETB2B AI is reading your request…');
  env.seam.view.status('working', 'Applying your change — 1 of 3 steps done');
  check('E.10 applying: the box stays locked and says so', !env.$('busy').hidden && env.$('input').readOnly && env.$('busy').textContent.indexOf('Applying your change — 1 of 3 steps done') !== -1);
  check('E.10 applying: the panel\'s Stop is not offered (it would give the words back for Try again; the card has its own Stop)', env.$('stop').hidden);
  env.seam.view.status('working', 'Showing it on the page…');
  check('E.10 showing the change: no panel Stop either (the change is on the page already)', env.$('stop').hidden && env.$('busy').textContent.indexOf('Showing it on the page…') !== -1);
  var stopsBefore = env.seam.stops;
  env.$('stop').click();
  check('E.10 …a hidden Stop does nothing', env.seam.stops === stopsBefore);
  env.seam.view.status('thinking', 'ETB2B AI is looking at your page (a few seconds)…');
  check('E.10 waiting for the answer again: Stop comes back', !env.$('stop').hidden);
  env.seam.view.status('ready');
  check('E.10 ready: the box is free', env.$('busy').hidden && !env.$('input').readOnly);

  /* errors: one table (the shell's), "Your page is unchanged" in the editor */
  async function failWith(err) {
    env.seam.reply = function () { return Promise.reject(err); };
    await say(env, 'Shorten the overview to two sentences');
    env.seam.reply = null;
    var bubbles = byClass(env.$('thread'), 'rvc-ai');
    return bubbles[bubbles.length - 1];
  }
  function httpErr(status, body) { var e = new Error(body && body.error || ''); e.status = status; e.body = body; e.network = null; return e; }
  var b503 = await failWith(httpErr(503, { error: 'The AI service is unavailable.', code: 'ai-unavailable' }));
  check('E.10 a busy AI is said plainly, with Try again', b503 && b503.textContent.indexOf('ETB2B AI is busy right now. Your page is unchanged. Try again in a minute.') !== -1 &&
    all(b503, function (e) { return e.localName === 'button' && e.textContent === 'Try again'; }).length === 1, b503 && b503.textContent);
  check('E.10 …and the words go back in the box', env.$('input').value === 'Shorten the overview to two sentences');
  env.$('input').value = '';
  var bCfg = await failWith(httpErr(500, { error: 'GEMINI_API_KEY missing', code: 'ai-config' }));
  check('E.10 switched off: no jargon, no Try again', bCfg && bCfg.textContent.indexOf('ETB2B AI is switched off right now. Your page is unchanged.') !== -1 && bCfg.textContent.indexOf('GEMINI') === -1 &&
    all(bCfg, function (e) { return e.localName === 'button' && e.textContent === 'Try again'; }).length === 0, bCfg && bCfg.textContent);
  env.$('input').value = '';
  var b502 = await failWith(httpErr(502, null));
  check('E.10 an error page with no answer', b502 && b502.textContent.indexOf('ETB2B AI didn’t answer. Your page is unchanged. Try again.') !== -1, b502 && b502.textContent);
  env.$('input').value = '';
  var bNet = await failWith((function () { var e = new Error(''); e.status = 0; e.network = {}; return e; })());
  check('E.10 no answer at all', bNet && bNet.textContent.indexOf('Could not reach ETB2B AI. Check your connection and try again.') !== -1, bNet && bNet.textContent);
  env.$('input').value = '';
  var bLocal = await failWith((function () { var e = new Error('One moment — ETB2B AI is still applying your last change.'); e.local = true; return e; })());
  check('E.10 the editor\'s own "one moment" is said as it is', bLocal && bLocal.textContent.indexOf('One moment — ETB2B AI is still applying your last change.') !== -1, bLocal && bLocal.textContent);
  env.$('input').value = '';

  /* "Open Content › Speakers" (UX-098): the editor's work first, then out through its own guard */
  var host = env.doc.createElement('div');
  env.doc.body.appendChild(host);
  env.seam.view.goTo(host, 'content:speakers', '');
  var go = host.querySelector('button');
  check('E.10 the way to Content is a button that names it', go && go.textContent === 'Open Content › Speakers' && go.title === EC.TEXT.goToTitle && go.getAttribute('type') === 'button');
  go.click();
  check('E.10 …it records the editor\'s work, then leaves through the editor\'s guard', same(env.seam.ui.order.slice(-2), ['flush', 'leave']) &&
    env.seam.ui.left[env.seam.ui.left.length - 1] === '/edit-event.html?event=' + EVENT + '#content/speakers', env.seam.ui.left);
  check('E.10 …never by itself', env.assigned.length === 0);
  var host2 = env.doc.createElement('div'); env.doc.body.appendChild(host2);
  env.seam.view.goTo(host2, '', 'Sponsors are added under Content, not on the page.');
  check('E.10 from the answer\'s own words when the server named none', host2.querySelector('button') && host2.querySelector('button').textContent === 'Open Content › Sponsors');
  var host3 = env.doc.createElement('div'); env.doc.body.appendChild(host3);
  env.seam.view.goTo(host3, '', 'I changed the sponsors heading.');
  check('E.10 no Content mentioned: no button', !host3.querySelector('button'));
  var host4 = env.doc.createElement('div'); env.doc.body.appendChild(host4);
  env.modes.now = 'ai';
  env.seam.view.goTo(host4, 'forms', '');
  host4.querySelector('button').click();
  check('E.10 "Open Forms": back to Edit myself, the Forms panel opened, the editor not left', host4.querySelector('button').textContent === 'Open Forms' &&
    env.modes.set[env.modes.set.length - 1] === 'manual' && env.formsClicks.n === 1 && env.seam.ui.left.length === 1);

  /* the shell's leave() is the editor's (B04's guard for unsaved work) */
  env.A.leave('/marketing.html?event=' + EVENT + '&tab=mailers');
  check('E.10 leaving the editor goes through RevampTemplateUI.leave', env.seam.ui.left[env.seam.ui.left.length - 1] === '/marketing.html?event=' + EVENT + '&tab=mailers' && env.assigned.length === 0);

  /* attachments: pictures only, the editor's way; a brief is said plainly */
  await attachFiles(env, [fileOf('brief.pdf', 'application/pdf')]);
  var bad = chipsOf(env)[0];
  check('E.10 a PDF is refused on its chip, plainly', bad && bad.classList.contains('is-error') && bad.textContent.indexOf('In the editor I can use pictures. A brief is read by Create Event’s Generate from a brief.') !== -1, bad && bad.textContent);
  check('E.10 …and never uploaded', env.seam.uploads.indexOf('brief.pdf') === -1);
  byClass(bad, 'rvc-achip-rm')[0].click();
  env.seam.uploadFails['huge.png'] = '"huge.png" is 9.4 MB. Images can be up to 8 MB.';
  await attachFiles(env, [fileOf('huge.png', 'image/png', 9.4 * 1048576)]);
  var big = chipsOf(env)[0];
  check('E.10 the editor\'s own upload checks still run, and their sentence is the chip\'s', big && big.classList.contains('is-error') && big.textContent.indexOf('Images can be up to 8 MB.') !== -1, big && big.textContent);
  byClass(big, 'rvc-achip-rm')[0].click();
  await attachFiles(env, [fileOf('a.png', 'image/png'), fileOf('b.jpg', 'image/jpeg')]);
  check('E.10 two pictures, numbered 1 and 2', same(chipsOf(env).map(function (c) { return byClass(c, 'rvc-achip-num')[0].textContent; }), ['1', '2']));
  var sendsNow = env.seam.sends.length;
  env.$('input').value = '';
  env.$('send').click();
  await settle(6);
  check('E.10 pictures with no words: asked what they are for, nothing sent', env.seam.sends.length === sendsNow && env.$('note').textContent === EC.TEXT.needWords, env.$('note').textContent);
  env.chat().clearAttachments();
  var made = env.seam.view.addAttachment(URL_OF('made.png'), 'New picture made by ETB2B AI');
  check('E.10 a picture ETB2B AI made goes in the tray ("Use this picture")', made === true && chipsOf(env).length === 1 && chipsOf(env)[0].textContent.indexOf('New picture made by ETB2B AI') !== -1);
  check('E.10 …once', env.seam.view.addAttachment(URL_OF('made.png'), 'New picture made by ETB2B AI') === true && chipsOf(env).length === 1);
  env.chat().clearAttachments();

  /* a turn read back: user words with how many pictures went with it */
  var u = env.seam.view.user('Use these on the hero', { at: NOW - 60000, context: 'Hero', pictures: 2, picturesText: '2 pictures attached' });
  check('E.10 a message read back says how many pictures went with it', u && u.textContent.indexOf('2 pictures attached') !== -1 && u.textContent.indexOf('Use these on the hero') !== -1);
  var ans = env.seam.view.ai('Done.', { at: NOW - 59000 });
  check('E.10 an answer read back gives the editor a place for its card', ans && ans.classList.contains('rvc-ed-body') && ans.parentNode.classList.contains('rvc-ed-answer'));
  check('E.10 the view gives the thread for the steps\' scrolling', env.seam.view.thread() === env.$('thread'));
  env.modes.now = 'ai';
  var showAi = env.seam.view.show('hero');
  env.modes.now = 'manual';
  var showManual = env.seam.view.show('hero');
  check('E.10 the view\'s show() goes to the live view only in Edit with AI (else the canvas scrolls)', showAi === true && showManual === false, [showAi, showManual]);

  /* ======== E.9 the panel's shape ======== */
  var d1 = editorPage({ vw: 1440 });
  await opened(d1);
  var r0 = d1.resizes.n;
  d1.A.open();
  await settle(6);
  check('E.9 Edit myself, 1440 px: the open panel is a column beside the canvas', d1.doc.documentElement.classList.contains('rvc-docked') && d1.chat().isDocked());
  check('E.9 …the canvas is told to refit', d1.resizes.n > r0);
  check('E.9 …the column starts under the top bar', d1.wrap().style['--rvc-dock-top'] === '96px', d1.wrap().style['--rvc-dock-top']);
  check('E.9 …and the floating panel\'s top may reach only the tools rail\'s foot', d1.wrap().style['--rvc-ed-top'] === '134px', d1.wrap().style['--rvc-ed-top']);
  var r1 = d1.resizes.n;
  d1.chat().close();
  await settle(4);
  check('E.9 closed: the room is given back, and the canvas refits', !d1.doc.documentElement.classList.contains('rvc-docked') && d1.resizes.n > r1);
  d1.modes.now = 'ai';
  d1.modes.fns.forEach(function (f) { f('ai'); });
  d1.A.open();
  await settle(4);
  check('E.9 Edit with AI, 1440 px: floating at the bottom right, not docked', !d1.doc.documentElement.classList.contains('rvc-docked') && !d1.chat().isDocked());
  d1.modes.now = 'manual';
  d1.modes.fns.forEach(function (f) { f('manual'); });
  await settle(4);
  check('E.9 back to Edit myself: docked again', d1.doc.documentElement.classList.contains('rvc-docked'));
  d1.setVw(1000);
  await settle(4);
  check('E.9 narrower than 1100 px: still a column beside the canvas (floating, it would lie over its toolbars)', d1.doc.documentElement.classList.contains('rvc-docked') && d1.chat().isDocked());
  check('E.9 Edit myself docks above a phone\'s width, the phone width is the editor\'s', EC.DOCK_MIN_WIDTH === 721 && EC.PHONE_QUERY === '(max-device-width: 720px), (max-width: 720px)');
  /* a 1366 × 768 laptop at 125 % is 1093 × 614 CSS px: the open panel is a column, never over the canvas's toolbars or
     the rail's Undo / Redo */
  var d2 = editorPage({ vw: 1093, vh: 614 });
  await opened(d2);
  d2.A.open();
  await settle(4);
  check('E.9 opened at 1093 × 614 in Edit myself: docked, the canvas keeps the room beside it', d2.doc.documentElement.classList.contains('rvc-docked') && d2.chat().isDocked());
  var d2b = editorPage({ vw: 721 });
  await opened(d2b);
  d2b.A.open();
  await settle(4);
  check('E.9 at 721 px: docked', d2b.doc.documentElement.classList.contains('rvc-docked'));
  var d2c = editorPage({ vw: 720 });
  await opened(d2c);
  d2c.A.open();
  await settle(4);
  check('E.9 at 720 px (a phone in the editor): never docked, the full sheet', !d2c.doc.documentElement.classList.contains('rvc-docked') && panelEl(d2c).getAttribute('aria-modal') === 'true');
  var d3 = editorPage({ vw: 700, mode: 'ai' });
  await opened(d3);
  d3.A.open();
  await settle(4);
  check('E.9 a narrow Edit with AI: a half sheet, the live view usable above it', panelEl(d3).getAttribute('aria-modal') === 'false' && d3.doc.documentElement.classList.contains('rvc-lock') === false);
  d3.modes.now = 'manual';
  d3.modes.fns.forEach(function (f) { f('manual'); });
  await settle(4);
  /* B15 verifier: on a phone the full sheet lay over the whole editor right after "Edit myself" was chosen, hiding the
     page to be edited by hand: switched there, the open panel closes to its launcher; opened again, the full sheet */
  check('E.9 a narrow Edit with AI → Edit myself: the open panel closes, so the page to edit is in view', !d3.chat().isOpen() && !d3.A.isOpen());
  d3.A.open();
  await settle(4);
  check('E.9 a narrow Edit myself: opened again, the full sheet (720 px counts as a phone in the editor)', d3.chat().isOpen() && panelEl(d3).getAttribute('aria-modal') === 'true');
  d3.modes.now = 'ai';
  d3.modes.fns.forEach(function (f) { f('ai'); });
  await settle(4);
  check('E.9 …back to Edit with AI it stays open, as the half sheet', d3.chat().isOpen() && panelEl(d3).getAttribute('aria-modal') === 'false');
  var d4 = editorPage({ vw: 1440, mode: 'ai' });
  await opened(d4);
  d4.A.open();
  await settle(4);
  d4.modes.now = 'manual';
  d4.modes.fns.forEach(function (f) { f('manual'); });
  await settle(4);
  check('E.9 on a wide screen Edit with AI → Edit myself keeps the panel open, docked beside the canvas', d4.chat().isOpen() && d4.chat().isDocked());

  /* ======== E.8 pictures given on another page of the event ======== */
  var key = 'K7mPq2Rs9TuVwXyZ';
  var nowReal = Date.now();
  function blob(name, type) { return { type: type, size: 4096, name: name }; }
  var store = makeStore();
  store._m['aicarry:' + EVENT + ':' + key] = { v: 1, at: nowReal, text: 'use these on the hero', files: [
    { name: 'stage.jpg', type: 'image/jpeg', size: 4096, blob: blob('stage.jpg', 'image/jpeg') },
    { name: 'crowd.png', type: 'image/png', size: 4096, blob: blob('crowd.png', 'image/png') }] };
  store._m['aicarry:index'] = { v: 1, keys: {} };
  store._m['aicarry:index'].keys[EVENT + ':' + key] = nowReal;
  var local = makeStorage();
  local.setItem('rv.assistant.carry.' + EVENT, JSON.stringify({ key: key, text: 'use these on the hero', at: nowReal, n: 2 }));
  var c1 = editorPage({ store: store, local: local });
  await opened(c1);
  await settle(10);
  var cchips = chipsOf(c1);
  check('E.8 the panel opens with the carried pictures', c1.chat().isOpen());
  check('E.8 each uploaded the editor\'s own way', same(c1.seam.uploads, ['stage.jpg', 'crowd.png']), c1.seam.uploads);
  check('E.8 …in the tray, numbered', cchips.length === 2 && same(cchips.map(function (c) { return byClass(c, 'rvc-achip-num')[0].textContent; }), ['1', '2']));
  check('E.8 the words are in the box', c1.$('input').value === 'use these on the hero', c1.$('input').value);
  check('E.8 nothing is sent', c1.seam.sends.length === 0 && c1.dash.calls.length === 0);
  check('E.8 it says where they are', threadText(c1).indexOf('The 2 pictures you gave me are in the tray. Say where they go and send.') !== -1, threadText(c1).slice(-200));
  check('E.8 taken once: the pointer and the kept files are gone', local.getItem('rv.assistant.carry.' + EVENT) === null && !store._m['aicarry:' + EVENT + ':' + key]);
  check('E.8 the box has the focus, ready to send', c1.doc.activeElement === c1.$('input'));
  /* fewer arrived than were given, and one could not be uploaded */
  var store2 = makeStore();
  store2._m['aicarry:' + EVENT + ':' + key] = { v: 1, at: nowReal, text: 'hero background', files: [
    { name: 'a.jpg', type: 'image/jpeg', size: 4096, blob: blob('a.jpg', 'image/jpeg') },
    { name: 'b.png', type: 'image/png', size: 4096, blob: blob('b.png', 'image/png') }] };
  var local2 = makeStorage();
  local2.setItem('rv.assistant.carry.' + EVENT, JSON.stringify({ key: key, text: 'hero background', at: nowReal, n: 3 }));
  var c2 = editorPage({ store: store2, local: local2 });
  c2.seam.uploadFails['b.png'] = 'That picture could not be uploaded. Please try again.';
  await opened(c2);
  await settle(10);
  var said2 = threadText(c2);
  check('E.8 a picture that could not be uploaded is said', said2.indexOf('That picture could not be uploaded. Please try again.') !== -1);
  check('E.8 …and how many did not come', said2.indexOf('The picture you gave me is in the tray. Say where it goes and send. 2 pictures could not be brought over: attach them again with the paper clip.') !== -1, said2.slice(-260));
  check('E.8 …the one that came is in the tray, nothing sent', chipsOf(c2).length === 1 && c2.seam.sends.length === 0 && c2.$('input').value === 'hero background');
  /* expired, or none: nothing happens */
  var local3 = makeStorage();
  local3.setItem('rv.assistant.carry.' + EVENT, JSON.stringify({ key: key, text: 'old', at: nowReal - 11 * 60 * 1000, n: 1 }));
  var c3 = editorPage({ local: local3 });
  await opened(c3);
  await settle(8);
  check('E.8 older than ten minutes: nothing is carried, the panel stays shut', !c3.chat().isOpen() && c3.seam.uploads.length === 0 && chipsOf(c3).length === 0);

  /* ======== E.10 the event's conversation, both brains ======== */
  var h = editorPage();
  h.seam.history = { turns: 2, event: { id: EVENT, name: 'Agentic AI Summit 2027' } };
  h.seam.onHistory = function (w) {
    w.other({ brain: 'dash', question: 'How many registrations does it have?', answer: '42 registrations, as of 12:05 pm.', at: NOW - 3600000 });
  };
  await opened(h);
  h.A.open();
  await settle(8);
  check('E.10 history: the editor reads the event\'s conversation itself', h.seam.historyCalls === 1);
  check('E.10 history: a turn the events side answered is the events side\'s to draw', h.dash.replays.length === 1 && threadText(h).indexOf('42 registrations, as of 12:05 pm.') !== -1);
  check('E.10 history: the scope line comes from the event\'s name', h.$('scope').textContent === 'This event: Agentic AI Summit 2027', h.$('scope').textContent);

  /* ======== E.3 the editor's site never came: the panel answers questions and says why it cannot edit ======== */
  var nf = editorPage();
  await opened(nf, false);
  nf.clock.advance(31000);
  await settle(10);
  check('E.3 a site that never opened: the client does not join', !nf.seam.view && nf.seam.changeFns.length === 0);
  check('E.3 …the shell mounts the events side alone and says why', !!nf.wrap() && wrapText(nf).indexOf('Editing this page with ETB2B AI isn’t available right now; reload the editor.') !== -1);

  /* ======== E.11 the real "Edit with AI" live view after a change (editor-ai-mode.js) ======== */
  var lv = editorPage({ realModes: true });
  var LM = lv.M();
  check('E.11 the real modes are loaded', !!LM && typeof LM.show === 'function' && typeof LM.whenShown === 'function' && LM !== lv.modes.api);
  LM.ready();
  await opened(lv);
  var vpEl = lv.doc.querySelector('.ai-live-viewport');
  vpEl.clientWidth = 1440; vpEl.clientHeight = 804; vpEl._rect = R(0, 96, 1440, 804);
  lv.seam.select({ sectionId: 'agenda', name: 'Agenda' });       // a selected section: its outline is drawn on every live view
  LM.setMode('ai');
  function onScreen(env) { var f = env.frames[env.frames.length - 1]; return !!f && !!f.contentDocument && f.isConnected && f.style.visibility === ''; }
  var firstAt = await runUntil(lv, function () { return onScreen(lv); }, 3000);
  check('E.11 Edit with AI: the first live view is on screen, from the preview\'s own page', firstAt >= 0 && lv.auth.fetches.indexOf('/api/event/live-view') !== -1, firstAt);
  await runFor(lv, 40);
  var pick = lv.doc.querySelector('.ai-live-pick:not(.ai-live-flash)');
  check('E.11 the selected section is outlined on it', pick && !pick.hidden && pick.textContent === 'ETB2B AI: Agenda' && pick.style.top === '600px', pick && [pick.hidden, pick.textContent, pick.style.top]);
  check('E.11 nothing threw while it was drawn', lv.thrown.length === 0, lv.thrown);
  check('E.11 the panel opened with the mode, floating', lv.chat().isOpen() && !lv.chat().isDocked());

  /* a change: the client's listener asks the real modes to show it; the panel lies over the hero, so it folds */
  panelEl(lv)._rect = R(1018, 160, 400, 640);
  var framesBefore = lv.frames.length, t0 = lv.clock.now(), shownAfter = null;
  var ch = editorChange(lv, 'hero', 'Hero');
  check('E.11 the editor is given something to wait for', ch.waits.length === 1 && !!ch.waits[0] && typeof ch.waits[0].then === 'function');
  if (ch.waits[0]) ch.waits[0].then(function () { shownAfter = lv.clock.now() - t0; });
  await runUntil(lv, function () { return shownAfter !== null; }, 11000);
  check('E.11 the live view is drawn again at the change', lv.frames.length === framesBefore + 1 && onScreen(lv));
  check('E.11 the wait settles once that live view is on screen, in well under a second (not the 10 s limit)', shownAfter !== null && shownAfter < 1000, shownAfter);
  check('E.11 nothing threw on the redraw (the frame\'s load listener and its 2.5 s timer)', lv.thrown.length === 0, lv.thrown);
  await runFor(lv, 40);
  var flashEl = lv.doc.querySelector('.ai-live-flash');
  check('E.11 "Changed by ETB2B AI" is outlined over the changed section', flashEl && !flashEl.hidden && flashEl.textContent === 'Changed by ETB2B AI' &&
    flashEl.style.top === '0px' && flashEl.style.height === '600px', flashEl && [flashEl.hidden, flashEl.textContent, flashEl.style.top, flashEl.style.height]);
  check('E.11 the selected section\'s outline is drawn again on the new live view', pick && !pick.hidden && pick.textContent === 'ETB2B AI: Agenda');
  check('E.11 the panel lay over the change: folded, with this change\'s Undo', lv.chat().isFolded() && byClass(lv.$('peek'), 'rvc-peek-label')[0].textContent === 'Changed “Hero”' && !!peekUndo(lv) && !peekUndo(lv).hidden);
  check('E.11 the section\'s box is where the live view shows it', same(LM.sectionRect('hero'), { left: 0, right: 1440, top: 96, bottom: 696 }), LM.sectionRect('hero'));
  await runFor(lv, 2100);
  check('E.11 the outline goes after two seconds', flashEl.hidden);
  var none = null;
  LM.show('not-on-the-page').then(function (v) { none = v; });
  await runUntil(lv, function () { return none !== null; }, 3000);
  await runFor(lv, 40);
  check('E.11 a section the live view does not have: show() settles false, nothing outlined', none === false && flashEl.hidden, none);
  var waiting = null;
  LM.whenShown('hero').then(function (v) { waiting = v; });
  LM.setMode('manual');
  await settle(4);
  check('E.11 back to Edit myself: whoever waits is told at once (false)', waiting === false);

  /* the editor's own wait (editor-template-ui.js aiChangeShown, as it is), with the client listening */
  var acsSrc = (/  function topSectionOf\(el\) \{[\s\S]*?\n  \}\n  function aiChangeShown\(t, first\) \{[\s\S]*?\n  \}\n/.exec(UI_SRC) || [''])[0];
  var waitMs = +((/AI_SHOWN_WAIT_MS = (\d+)/.exec(UI_SRC) || [])[1] || 0);
  check('E.11 the editor\'s wait is found (aiChangeShown, AI_SHOWN_WAIT_MS 10 s)', !!acsSrc && waitMs === 10000, waitMs);
  var said = [];
  var acx = { aiChangeListeners: lv.seam.changeFns, AI_SHOWN_WAIT_MS: waitMs, CHAT_TEXT: { showing: 'Showing it on the page…' },
    setChatStatus: function (st, tx) { said.push([st, tx]); },
    pause: function (ms) { return new Promise(function (r) { lv.clock.setTimeout(r, ms); }); },
    window: { console: { error: function (e) { lv.thrown.push(String(e)); } } } };
  vm.createContext(acx);
  vm.runInContext(acsSrc + '\nthis.aiChangeShown = aiChangeShown;', acx);
  LM.setMode('ai');
  await runUntil(lv, function () { return onScreen(lv); }, 3000);
  lv.chat().open();
  await settle(4);
  var canvasSec = lv.doc.createElement('section');
  canvasSec.setAttribute('data-rv-section', 'agenda'); canvasSec.setAttribute('data-rv-key', 'agenda'); canvasSec.setAttribute('data-sec-name', 'Agenda');
  var firstEl = lv.doc.createElement('h2'); canvasSec.appendChild(firstEl);
  var notes = [];
  var tt = { status: 'applied', stopAsked: false, peekFn: function () { return Promise.resolve(true); }, turnId: 'TurnAgenda01',
    card: { note: function (x) { notes.push(x); } }, stopped: new Promise(function () {}) };
  var acsAt = null, acsStart = lv.clock.now();
  acx.aiChangeShown(tt, firstEl).then(function () { acsAt = lv.clock.now() - acsStart; });
  await runUntil(lv, function () { return acsAt !== null; }, waitMs + 1000);
  check('E.11 aiChangeShown: the editor\'s wait ends in well under a second, far from its 10 s limit', acsAt !== null && acsAt < 1000, acsAt);
  check('E.11 …the card said "Showing it on the page…" meanwhile, and nothing once shown', notes[0] === 'Showing it on the page…' && notes[notes.length - 1] === '', notes);
  check('E.11 …and the panel said it too', said.length === 1 && same(said[0], ['working', 'Showing it on the page…']), said);
  check('E.11 nothing threw', lv.thrown.length === 0, lv.thrown);

  /* ======== E.12 Stop while a change is applied: on its card (editor-template-ui.js taskCard, as it is) ======== */
  var cardSrc = (/  var TASK_BADGE = [\s\S]*?\n  function taskCard\(host\) \{[\s\S]*?\n    return api;\n  \}\n/.exec(UI_SRC) || [''])[0];
  var textSrc = (/  var CHAT_TEXT = \{[\s\S]*?\n  \};\n/.exec(UI_SRC) || [''])[0];
  check('E.12 the card and its words are found', !!cardSrc && !!textSrc);
  var cdoc = makeDoc(); cdoc._parseHtml = true;
  var ccx = { document: cdoc, chatThread: function () { return null; }, showChange: function () {} };
  vm.createContext(ccx);
  vm.runInContext(textSrc + cardSrc + '\nthis.taskCard = taskCard; this.CHAT_TEXT = CHAT_TEXT;', ccx);
  var cHost = cdoc.createElement('div'); cdoc.body.appendChild(cHost);
  var card = ccx.taskCard(cHost);
  card.step('Rework “Hero”', null, { key: 'hero' });
  card.step('Rework “Agenda”', null, { key: 'agenda' });
  check('E.12 a card that is not being applied shows no foot', card.foot && card.foot.hidden && !card.foot.querySelector('button'));
  var stopCalls = 0;
  check('E.12 the card can offer a Stop of its own (offerStop)', typeof card.offerStop === 'function');
  if (typeof card.offerStop !== 'function') card.offerStop = function () {};
  card.offerStop(function () { stopCalls++; });
  var sb = card.foot.querySelector('button') || cdoc.createElement('button');
  check('E.12 while it is applied, the card\'s foot offers Stop, named for what it stops', !card.foot.hidden && sb && sb.textContent === 'Stop' && sb.getAttribute('type') === 'button' &&
    sb.getAttribute('aria-label') === 'Stop this change' && sb.title === ccx.CHAT_TEXT.stopTitle && sb.classList.contains('btn'), sb && [sb.textContent, sb._a]);
  check('E.12 …its words say what stays', /What is already done stays on the page, and Undo takes it back\./.test(ccx.CHAT_TEXT.stopTitle));
  sb.focus();
  sb.click();
  check('E.12 pressed: the change is asked to stop, once, and the button says it is stopping', stopCalls === 1 && sb.disabled && sb.textContent === 'Stopping…', [stopCalls, sb.textContent]);
  sb.click();
  check('E.12 …a second press does nothing', stopCalls === 1);
  card.step('Add the section “FAQ”').set('run');
  check('E.12 progress meanwhile keeps the Stop where it is', card.foot.querySelector('button') === sb);
  card.status('partly');
  check('E.12 the change ended: its Stop is gone and the empty foot hidden (finishAiCard puts Undo there)', !card.foot.querySelector('button') && card.foot.hidden);
  check('E.12 …and the card remembers that Stop had the focus, so its Undo takes it', card.stopHadFocus === true);
  var card2 = ccx.taskCard(cHost);
  if (typeof card2.offerStop === 'function') card2.offerStop(function () {});
  card2.status('applied');
  check('E.12 a change that ends without Stop being pressed: Stop gone, no focus to hand on', !card2.foot.querySelector('button') && card2.stopHadFocus === false);

  console.log('editor-chat-client: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch(function (e) { console.error(e); process.exit(1); });
