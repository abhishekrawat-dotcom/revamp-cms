// node functions/lib/etb2b-chat.test.js — the ETB2B AI chat kit (etb2b-chat.js, window.RevampChat, and
// etb2b-chat.css): one look on every page (ai-everywhere plan §3), with the dashboard's checks C.1–C.12 and the
// new parts K.1–K.16 (the corner and its lift, docking, the half sheet, the scope line, attachments, the context
// chip, slots, readable answers, reveal, Stop, quick ideas, keys that stay in the chat).
// etb2b-chat.js runs in a vm over a small DOM built here (elements, attributes, classes, text, events that
// bubble to the document, focus, simple selectors, boxes a test sets) with a fake clock, so the 8 s "still
// working" line, the 1.2 s countdown, the 6 s wait for the history replay and the one-frame lift are exact. The
// stylesheet is read as text: its palette is the dashboard's own light and dark values (read from
// Event_Listing.html at run time), no colour is written outside the palette, the corner, the layers and the
// phone sheets are as planned, and the pairs the kit draws pass WCAG AA in both themes. No network, no AI.
'use strict';
process.env.TZ = 'UTC';   // a turn's own time is drawn in the person's clock; the test fixes it
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'etb2b-chat.js'), 'utf8');
var CSS = fs.readFileSync(path.join(ROOT, 'etb2b-chat.css'), 'utf8');
var PAGE = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8');
function readMaybe(f) { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return ''; } }
var CONSOLE_CSS = readMaybe('edit-event.css');
var CREATE_PAGE = readMaybe('create-event.html');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}
function flush() { return new Promise(function (r) { setImmediate(r); }); }
async function settle(n) { for (var i = 0; i < (n || 6); i++) await flush(); }

/* ================= a small DOM ================= */
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
reflect('id', 'id'); reflect('className', 'class'); reflect('type', 'type'); reflect('href', 'href');
flag('hidden', 'hidden'); flag('disabled', 'disabled'); flag('readOnly', 'readonly');
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
  set: function (v) { this.childNodes.forEach(function (c) { c.parentNode = null; }); this.childNodes = []; this._html = String(v); }
});
Object.defineProperty(EP, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
Object.defineProperty(EP, 'lastChild', { get: function () { return this.childNodes[this.childNodes.length - 1] || null; } });
Object.defineProperty(EP, 'children', { get: function () { return this.childNodes.filter(function (c) { return c.nodeType === 1; }); } });
/* a test lays out what it needs: doc._layout(el) -> {top, h} (offsetTop / offsetHeight) */
Object.defineProperty(EP, 'offsetTop', { get: function () { var d = this.ownerDocument; return d._layout ? (d._layout(this) || {}).top || 0 : 0; } });
Object.defineProperty(EP, 'offsetHeight', { get: function () { var d = this.ownerDocument; return d._layout ? (d._layout(this) || {}).h || 0 : 0; } });
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
/* a box: the one a test gave it (_rect), none while it or a parent is hidden or it is not on the page */
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
function byTag(n, t) { return all(n, function (e) { return e.localName === t; }); }

/* simple selectors only, as keepClear uses them: tag, #id, .class, [attr], [attr="v"], :not(…), and lists */
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

function makeDoc() {
  var doc = { nodeType: 9, _ls: {}, parentNode: null, qsaCalls: 0 };
  doc.createElement = function (t) { return new El(doc, t); };
  doc.createTextNode = function (s) { return new Tx(doc, s); };
  doc.addEventListener = addL; doc.removeEventListener = rmL;
  var html = new El(doc, 'html'); html.parentNode = doc;
  var body = new El(doc, 'body'); html.appendChild(body);
  doc.documentElement = html; doc.body = body; doc.activeElement = body;
  doc.getElementById = function (id) { var hit = null; walk(html, function (e) { if (!hit && e.getAttribute('id') === id) hit = e; }); return hit; };
  doc.querySelectorAll = function (sel) {
    doc.qsaCalls++;
    var tests = String(sel).split(',').map(compound);
    return all(html, function (e) { return tests.some(function (t) { return t(e); }); });
  };
  return doc;
}

/* ================= a fake clock ================= */
function makeClock(start) {
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
        q.shift(); t = nx.at; nx.fn();
      }
      t = end;
    }
  };
}

var NOW = Date.parse('2026-11-03T06:35:00Z');   // Tuesday 3 Nov 2026, 12:05 IST
var PHONE_Q = '(max-width: 600px)';
function setup(o) {
  o = o || {};
  var doc = makeDoc();
  var clock = makeClock(NOW);
  var mqs = {};
  var errors = [], winLs = [], mos = [];
  function FakeMO(cb) { this.cb = cb; this.target = null; this.o = null; mos.push(this); }
  FakeMO.prototype.observe = function (target, opt) { this.target = target; this.o = opt; };
  FakeMO.prototype.disconnect = function () {};
  var sandbox = {
    document: doc,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    matchMedia: function (q) {
      if (!mqs[q]) {
        mqs[q] = { media: q, matches: /max-width/.test(q) ? !!o.phone : /min-width/.test(q) ? !!o.wide : false, ls: [],
          addEventListener: function (t, fn) { if (t === 'change') this.ls.push(fn); } };
      }
      return mqs[q];
    },
    navigator: { onLine: !o.offline },
    console: { error: function () { errors.push([].slice.call(arguments).map(String).join(' ')); }, log: function () {} },
    innerWidth: o.vw || 1440, innerHeight: o.vh || 900,
    requestAnimationFrame: function (fn) { return clock.setTimeout(fn, 16); },
    addEventListener: function (t, fn, opt) { winLs.push({ type: t, fn: fn, o: opt }); },
    removeEventListener: function () {},
    getComputedStyle: function (e) { return { visibility: e._vis || 'visible', display: e._disp || 'block' }; },
    MutationObserver: FakeMO,
    __now: clock.now
  };
  if (o.vv) sandbox.visualViewport = o.vv;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('Date.now = function () { return __now(); };', sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'etb2b-chat.js' });
  var host = doc.createElement('div');
  host.setAttribute('id', 'rv-dash-bot');
  doc.body.appendChild(host);
  return {
    doc: doc, clock: clock, mqs: mqs, errors: errors, win: sandbox, host: host, RC: sandbox.RevampChat, winLs: winLs, mos: mos,
    setMq: function (q, v) { var m = mqs[q]; m.matches = v; m.ls.forEach(function (f) { f({ matches: v }); }); }
  };
}

var SUGGESTIONS = [
  { label: 'Create an IP event called … on … in …', text: 'Create an IP event called … on … in …' },
  { label: 'Show drafts from last week', text: 'Show drafts from last week' },
  { label: 'Which events go live this month?', text: 'Which events go live this month?' },
  { label: 'Make a save-the-date post and an announcement mailer for …', text: 'Make a save-the-date post and an announcement mailer for …' }
];
var FOOT = 'ETB2B AI opens pages, filters this list and starts drafts. It never deletes, cancels, publishes or approves anything.';
function mountChat(env, extra) {
  var log = { sent: [], sentOpts: [], open: [], history: 0, help: [] };
  var pending = [];
  var opts = {
    id: 'dash', title: 'ETB2B AI', launcherLabel: 'Ask ETB2B AI', placeholder: 'Ask ETB2B AI…',
    welcome: { heading: 'Hi Asha, I’m ETB2B AI.', text: 'I can start a new event, open any event’s pages, answer questions from your events’ real numbers, and set up promotions.' },
    suggestions: SUGGESTIONS, footNote: FOOT,
    help: { label: 'Email Customer Care', onClick: function (b) { log.help.push(b); } },
    send: function (t, o) { log.sent.push(t); log.sentOpts.push(o); return new Promise(function (ok, no) { pending.push({ ok: ok, no: no }); }); },
    loadHistory: function () { log.history++; return null; },
    onOpenChange: function (v) { log.open.push(v); }
  };
  Object.keys(extra || {}).forEach(function (k) { opts[k] = extra[k]; });
  var chat = env.RC.mount(env.host, opts);
  var pre = (opts.id === 'dash' || opts.id == null) ? 'dash' : opts.id;
  var $ = function (part) { return env.doc.getElementById(pre + '-chat-' + part); };
  var wrap = env.host.children[env.host.children.length - 1];
  return { chat: chat, log: log, pending: pending, opts: opts, $: $, wrap: wrap };
}
function key(target, k, o) { var e = new Ev('keydown', Object.assign({ key: k }, o || {})); dispatch(target, e); return e; }
function type(m, text) { m.$('input').value = text; dispatch(m.$('input'), new Ev('input')); }
function turns(m) { return m.$('thread').children.filter(function (c) { return c.classList.contains('rvc-turn'); }); }
function btnIn(node, label) { return all(node, function (e) { return e.localName === 'button' && e.textContent === label; })[0] || null; }
function fileOf(name, size, t) { return { name: name, size: size || 1000, type: t || 'image/png' }; }

(async function main() {
  /* ======== C.1 the file: ES5, text only, one global, one table of words ======== */
  var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  check('C.1 no let', !/\blet\s/.test(code));
  check('C.1 no const', !/\bconst\s/.test(code));
  check('C.1 no arrow functions', code.indexOf('=>') === -1);
  check('C.1 no async / await', !/\basync\b|\bawait\b/.test(code));
  check('C.1 no class', !/\bclass\s+[A-Za-z]/.test(code));
  check('C.1 no template strings', code.indexOf('`') === -1);
  check('C.1 no spread or rest', code.indexOf('...') === -1);
  check('C.1 no ES2015+ library calls (includes, startsWith, Array.from, Object.assign, .catch)', !/\.includes\(|\.startsWith\(|\.endsWith\(|Array\.from|Object\.assign|\.catch\(/.test(code));
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the regex checks above still run */ }
  check('C.1 esbuild is there to check ES5', !!esbuild);
  if (esbuild) {
    var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('C.1 ES5 by esbuild', es5 === true, es5);
  }
  check('C.1 parses (node --check)', (function () { try { new vm.Script(SRC); return true; } catch (e) { return e.message; } })() === true);
  var assigns = [];
  SRC.replace(/\.innerHTML\s*=\s*([^;]+);/g, function (m, rhs) { assigns.push(rhs.trim()); });
  check('C.1 innerHTML is assigned only fixed drawings', assigns.length >= 6 && assigns.every(function (n) {
    if (!/^[A-Z][A-Z_]*$/.test(n)) return false;
    var def = new RegExp('var ' + n + " = ((?:'[^'\\\\]*'\\s*\\+?\\s*)+);").exec(SRC);
    return !!def;
  }), assigns);
  check('C.1 no other way to write markup', !/outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|createContextualFragment|DOMParser/.test(code));
  check('C.1 reads and writes no storage', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code));
  check('C.1 no network of its own', !/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(code));
  var env0 = setup();
  var KNOWN = ['document', 'setTimeout', 'clearTimeout', 'matchMedia', 'navigator', 'console', '__now', 'window', 'innerWidth', 'innerHeight',
    'requestAnimationFrame', 'addEventListener', 'removeEventListener', 'getComputedStyle', 'MutationObserver'];
  var ownGlobals = Object.keys(env0.win).filter(function (k) { return KNOWN.indexOf(k) === -1; });
  check('C.1 one global, RevampChat, with mount()', ownGlobals.join() === 'RevampChat' && Object.keys(env0.RC).join() === 'mount', ownGlobals);
  var access = require('./access');
  check('C.1 the page may load both files', access.isServableFile('etb2b-chat.js') === true && access.isServableFile('etb2b-chat.css') === true);
  check('C.1 the product names are right', SRC.indexOf('Revamp CMS') === -1 && CSS.indexOf('Revamp CMS') === -1 && !/\bRevamp\b(?!Chat)/.test(SRC.replace(/RevampChat/g, '')));
  check('C.1 every sentence lives in one TEXT table', /\n  var TEXT = \{\n/.test(SRC) && (SRC.match(/var TEXT = \{/g) || []).length === 1);
  (function () {
    /* the words a person reads, wherever the kit puts words on the page outside the TEXT table: only symbols */
    var start = SRC.indexOf('  var TEXT = {'), end = SRC.indexOf('\n  };\n', start);
    var rest = (SRC.slice(0, start) + SRC.slice(end)).replace(/\/\*[\s\S]*?\*\//g, '');
    var lits = [];
    function take(re) { rest.replace(re, function (mm0, lit) { lits.push(lit); }); }
    take(/\bel\(\s*'[^']*'\s*,\s*(?:'[^']*'|null)\s*,\s*'([^']*)'/g);
    take(/\bbutton\(\s*'[^']*'\s*,\s*'([^']*)'\s*\)/g);
    take(/\btxt\(\s*'([^']*)'\s*\)/g);
    take(/\.textContent\s*=\s*'([^']*)'/g);
    take(/setAttribute\(\s*'(?:aria-label|title|placeholder|alt)'\s*,\s*'([^']*)'/g);
    var wordy = lits.filter(function (x) { return /[A-Za-z]/.test(x.replace(/\\./g, '')); });
    check('C.1 no words are put on the page from outside TEXT (only symbols: ×, ·, …)', lits.length >= 5 && wordy.length === 0, wordy);
  })();

  /* ======== C.2 mount: the markup, ids, roles and ARIA ======== */
  var env = setup();
  var m = mountChat(env);
  var L = m.$('launcher'), P = m.$('panel');
  ['launcher', 'panel', 'title', 'thread', 'input', 'send', 'status', 'busy', 'stop', 'scope', 'context', 'tray', 'note', 'quick'].forEach(function (p) { check('C.2 #dash-chat-' + p + ' exists', !!m.$(p)); });
  check('C.2 the launcher is a button that says what it opens', L.localName === 'button' && L.getAttribute('type') === 'button' && L.classList.contains('rvc-launcher') &&
    L.getAttribute('aria-expanded') === 'false' && L.getAttribute('aria-controls') === 'dash-chat-panel', L._a);
  check('C.2 the launcher reads "Ask ETB2B AI" and its name holds those words (label in name)',
    byClass(L, 'rvc-launcher-label')[0].textContent === 'Ask ETB2B AI' && L.getAttribute('aria-label').indexOf('Ask ETB2B AI') === 0);
  check('C.2 the panel is a non-modal dialog named by its title, shut', P.getAttribute('role') === 'dialog' && P.getAttribute('aria-modal') === 'false' &&
    P.getAttribute('aria-labelledby') === 'dash-chat-title' && P.hidden === true);
  check('C.2 the title is "ETB2B AI" in a heading', m.$('title').localName === 'h2' && m.$('title').textContent === 'ETB2B AI');
  check('C.2 the status pill is role=status and says Ready', m.$('status').getAttribute('role') === 'status' && m.$('status').textContent === 'Ready');
  var T = m.$('thread');
  check('C.2 the thread is a polite log of additions, scrollable by keyboard (UX-100)', T.getAttribute('role') === 'log' && T.getAttribute('aria-live') === 'polite' &&
    T.getAttribute('aria-relevant') === 'additions' && T.getAttribute('tabindex') === '0' && T.getAttribute('aria-label') === 'Conversation with ETB2B AI');
  var lbl = all(P, function (e) { return e.localName === 'label'; })[0];
  check('C.2 the message box is a labelled textarea (UX-100)', m.$('input').localName === 'textarea' && lbl && lbl.getAttribute('for') === 'dash-chat-input' &&
    lbl.textContent === 'Message ETB2B AI' && lbl.classList.contains('rvc-sr') && m.$('input').getAttribute('placeholder') === 'Ask ETB2B AI…');
  check('C.2 Enter is "send" on phone keyboards', m.$('input').getAttribute('enterkeyhint') === 'send');
  check('C.2 Send is an icon button with a name', m.$('send').localName === 'button' && m.$('send').getAttribute('aria-label') === 'Send' && m.$('send').getAttribute('type') === 'button');
  check('C.2 the busy strip starts hidden, and is not hidden from screen readers (its Stop must be reachable)', m.$('busy').hidden === true && !m.$('busy').hasAttribute('aria-hidden') &&
    byClass(m.$('busy'), 'rvc-busy-text')[0].getAttribute('aria-hidden') === 'true');
  check('C.2 Stop sits in the busy strip, hidden until an adapter offers it', m.$('busy').contains(m.$('stop')) && m.$('stop').hidden === true && m.$('stop').textContent === 'Stop' &&
    m.$('stop').getAttribute('aria-label') === 'Stop waiting for ETB2B AI');
  var close = byClass(P, 'rvc-close')[0];
  check('C.2 Close has a name', close && close.getAttribute('aria-label') === 'Close ETB2B AI');
  var help = byClass(P, 'rvc-head-help')[0];
  check('C.2 "Email Customer Care" sits in the header', help && help.textContent === 'Email Customer Care' && byClass(P, 'rvc-head')[0].contains(help));
  help.click();
  check('C.2 it calls the page\'s help, handing it the button so focus can come back', m.log.help.length === 1 && m.log.help[0] === help);
  check('C.2 the foot note is under the box', byClass(P, 'rvc-footnote')[0].textContent === FOOT);
  check('C.2 the welcome greets by name', byClass(T, 'rvc-welcome-h')[0].textContent === 'Hi Asha, I’m ETB2B AI.');
  check('C.2 four suggestions', byClass(T, 'rvc-suggestion').length === 4);
  check('C.2 without attach: no attach button, no file input, no drop overlay', !m.$('attach') && !m.$('file') && byClass(P, 'rvc-drop').length === 0 && !byClass(P, 'rvc-compose')[0].classList.contains('has-attach'));
  check('C.2 without scope: the scope line and its dot are hidden', m.$('scope').hidden === true && byClass(P, 'rvc-scope-sep')[0].hidden === true);
  check('C.2 order in the panel: head, thread, busy, context, tray, note, compose, quick ideas, foot note',
    P.children.map(function (c) { return c.className.split(' ')[0]; }).join() === 'rvc-head,rvc-thread,rvc-busy,rvc-context,rvc-tray,rvc-attach-note,rvc-compose,rvc-quick,rvc-footnote',
    P.children.map(function (c) { return c.className; }));
  var FACE = /var FACE_SVG = ((?:'[^']*'\s*\+?\s*)+);/.exec(SRC)[1];
  check('C.2 the face has no id, gradient or url(#…) (no duplicate ids)', FACE.indexOf('id=') === -1 && FACE.indexOf('url(#') === -1 && FACE.indexOf('Gradient') === -1);
  check('C.2 the face is drawn with classes, not colours', FACE.indexOf('fill="#') === -1 && FACE.indexOf('stroke="#') === -1 && /rvc-f-dot/.test(FACE));
  check('C.2 html.rvc-ready is set after the mount', env.doc.documentElement.classList.contains('rvc-ready'));
  check('C.2 nothing else is on the page body but the host', env.doc.body.children.length === 1 && env.host.children.length === 1);

  (function () {
    var e1 = setup();
    var threw1 = false; try { e1.RC.mount(null, { send: function () {} }); } catch (x) { threw1 = true; }
    var threw2 = false; try { e1.RC.mount(e1.host, {}); } catch (x) { threw2 = true; }
    check('C.2 no host, or no send: the mount throws', threw1 && threw2);
    check('C.2 … and html.rvc-ready stays off, so the page keeps its own help button', !e1.doc.documentElement.classList.contains('rvc-ready') && e1.host.children.length === 0);
    var e2 = setup();
    var c2 = e2.RC.mount('rv-dash-bot', { send: function () { return Promise.resolve(); } });
    check('C.2 the host may be given by its id; the defaults are ETB2B AI\'s', !!c2 && e2.doc.getElementById('rv-chat-title').textContent === 'ETB2B AI' &&
      e2.doc.getElementById('rv-chat-launcher').getAttribute('aria-label') === 'Ask ETB2B AI');
    var e3 = setup();
    e3.RC.mount(e3.host, { id: 'ai', send: function () { return Promise.resolve(); } });
    check('C.2 id "ai" (every page but the dashboard) gives ai-chat-* ids', !!e3.doc.getElementById('ai-chat-launcher') && !!e3.doc.getElementById('ai-chat-panel'));
  })();

  /* ======== C.3 open and close ======== */
  L.click();
  check('C.3 open: aria-expanded=true and the panel shows', L.getAttribute('aria-expanded') === 'true' && P.hidden === false && m.chat.isOpen() === true);
  check('C.3 open: focus is in the message box', env.doc.activeElement === m.$('input'));
  check('C.3 open: onOpenChange(true)', m.log.open.join() === 'true');
  check('C.3 open: loadHistory once', m.log.history === 1);
  check('C.3 the launcher goes quiet after the first open', L.classList.contains('is-quiet'));
  var esc = key(m.$('input'), 'Escape');
  check('C.3 Esc in the panel closes it and focuses the launcher', P.hidden === true && L.getAttribute('aria-expanded') === 'false' &&
    env.doc.activeElement === L && esc.defaultPrevented && m.log.open.join() === 'true,false');
  m.chat.open();
  check('C.3 a second open does not load the history again', m.log.history === 1 && m.log.open.join() === 'true,false,true');
  key(env.doc.body, 'Escape');
  check('C.3 Esc on the page (outside the panel) leaves the panel open', m.chat.isOpen() === true);
  close.click();
  check('C.3 Close shuts it and focuses the launcher', m.chat.isOpen() === false && env.doc.activeElement === L);
  L.click(); L.click();
  check('C.3 the launcher toggles', m.chat.isOpen() === false && m.log.open.join() === 'true,false,true,false,true,false');
  m.chat.open();

  (function () {
    var e = setup();
    var mm = mountChat(e, { startOpen: true });
    check('C.3 startOpen: open at mount, history loaded, onOpenChange(true)', mm.chat.isOpen() && mm.log.history === 1 && mm.log.open.join() === 'true' && e.doc.activeElement === mm.$('input'));
  })();

  /* the replay: a new message waits for it, so earlier turns sit above */
  await (async function () {
    var e = setup();
    var release;
    var mm = mountChat(e, { loadHistory: function () {
      return new Promise(function (ok) { release = function () { mm.chat.divider('Earlier'); mm.chat.user('Old question', { at: '2026-11-02T10:00:00Z' }); mm.chat.ai('Old answer'); mm.chat.divider('Now'); ok(); }; });
    } });
    mm.chat.open();
    var loading = byClass(mm.$('thread'), 'rvc-loading')[0];
    check('C.3 while the replay loads, a line says so', !!loading && loading.textContent === 'Loading your earlier messages…');
    type(mm, 'hello');
    key(mm.$('input'), 'Enter');
    await settle();
    check('C.3 a message sent during the replay waits for it', mm.log.sent.length === 0 && mm.$('send').disabled === true);
    release();
    await settle();
    var kids = mm.$('thread').children.map(function (c) { return c.className.split(' ')[0] + ':' + (c.classList.contains('rvc-turn') ? byClass(c, 'rvc-msg')[0].textContent : c.textContent); });
    check('C.3 … then the replay is above the new message', mm.log.sent.join() === 'hello' &&
      JSON.stringify(kids.slice(1)) === JSON.stringify(['rvc-divider:Earlier', 'rvc-turn:Old question', 'rvc-turn:Old answer', 'rvc-divider:Now', 'rvc-turn:hello']), kids);
    check('C.3 the loading line is gone', byClass(mm.$('thread'), 'rvc-loading').length === 0);
    var t0 = all(mm.$('thread'), function (x) { return x.localName === 'time'; })[0];
    check('C.3 a replayed turn shows its own time', t0 && t0.getAttribute('datetime') === '2026-11-02T10:00:00.000Z' && t0.textContent === '2 Nov, 10:00', t0 && t0.textContent);
  })();
  await (async function () {
    var e = setup();
    var mm = mountChat(e, { loadHistory: function () { return new Promise(function () {}); } });
    mm.chat.open();
    type(mm, 'still there?');
    key(mm.$('input'), 'Enter');
    await settle();
    e.clock.advance(5999); await settle();
    check('C.3 a replay that never answers holds a message 6 s at most (not yet at 5.999 s)', mm.log.sent.length === 0);
    e.clock.advance(1); await settle();
    check('C.3 … and lets it go at 6 s', mm.log.sent.join() === 'still there?');
  })();
  /* a replay later than the 6 s wait: it still goes above the new message, never between it and its answer */
  function order(mm) {
    return mm.$('thread').children.slice(1).map(function (c) {
      return c.classList.contains('rvc-turn') ? byClass(c, 'rvc-msg')[0].textContent : c.className.split(' ')[0] + ':' + c.textContent;
    });
  }
  var OLD_AT = '2026-11-02T10:00:00Z';
  /* the way dash-bot-client.js replays: chat.divider, then each turn with its own time, then chat.divider */
  function adapterReplay(c) { c.divider('Earlier'); c.user('Old q', { at: OLD_AT }); c.ai('Old a', { at: OLD_AT }); c.divider('Now'); }
  await (async function () {
    var e = setup();
    var release;
    var mm = mountChat(e, { loadHistory: function () { return new Promise(function (ok) { release = function () { adapterReplay(mm.chat); ok(2); }; }); } });
    mm.chat.open();
    type(mm, 'new question'); key(mm.$('input'), 'Enter'); await settle();
    e.clock.advance(6000); await settle();
    check('C.3 late replay: the message went at 6 s', mm.log.sent.join() === 'new question');
    release(); await settle();          // the replay comes after the 6 s wait, before the answer
    mm.chat.ai('answer to new question');
    mm.pending[0].ok(); await settle();
    check('C.3 late replay (after 6 s, before the answer): it sits above the new question, which stays with its answer',
      JSON.stringify(order(mm)) === JSON.stringify(['rvc-divider:Earlier', 'Old q', 'Old a', 'rvc-divider:Now', 'new question', 'answer to new question']), order(mm));
    check('C.3 late replay: the loading line is gone', byClass(mm.$('thread'), 'rvc-loading').length === 0);
    mm.chat.ai('a later answer');
    check('C.3 … and once it is in, new turns go at the end again', order(mm).pop() === 'a later answer');
  })();
  await (async function () {
    var e = setup();
    var release;
    var mm = mountChat(e, { loadHistory: function () { return new Promise(function (ok) { release = function () { adapterReplay(mm.chat); ok(2); }; }); } });
    mm.chat.open();
    type(mm, 'new question'); key(mm.$('input'), 'Enter'); await settle();
    e.clock.advance(6000); await settle();
    mm.chat.ai('answer to new question');
    mm.pending[0].ok(); await settle();
    release(); await settle();          // the replay comes after the answer too
    check('C.3 late replay (after the answer): it still goes above the new question',
      JSON.stringify(order(mm)) === JSON.stringify(['rvc-divider:Earlier', 'Old q', 'Old a', 'rvc-divider:Now', 'new question', 'answer to new question']), order(mm));
  })();
  await (async function () {
    var e = setup();
    var release, writer = null;
    var mm = mountChat(e, { loadHistory: function (w) {
      writer = w;
      /* through the writer, a turn needs no time of its own */
      return new Promise(function (ok) { release = function () { w.divider('Earlier'); w.user('Old q'); w.ai('Old a').note('Showed Draft events.'); w.divider('Now'); ok(2); }; });
    } });
    mm.chat.open();
    check('C.3 loadHistory is handed a writer {divider, user, ai, custom}', !!writer && typeof writer.divider === 'function' && typeof writer.user === 'function' &&
      typeof writer.ai === 'function' && typeof writer.custom === 'function');
    type(mm, 'new question'); key(mm.$('input'), 'Enter'); await settle();
    e.clock.advance(6000); await settle();
    release(); await settle();
    mm.chat.ai('answer to new question');
    mm.pending[0].ok(); await settle();
    check('C.3 late replay through the writer: above the new question, turns with no time of their own included',
      JSON.stringify(order(mm)) === JSON.stringify(['rvc-divider:Earlier', 'Old q', 'Old aShowed Draft events.', 'rvc-divider:Now', 'new question', 'answer to new question']), order(mm));
  })();
  await (async function () {
    var e = setup();
    var release;
    var mm = mountChat(e, { loadHistory: function () { return new Promise(function (ok) { release = function () { adapterReplay(mm.chat); ok(2); }; }); } });
    mm.chat.open();
    mm.chat.close();
    release(); await settle();
    check('C.3 a replay that lands while the panel is shut is not a "new reply"', !mm.$('launcher').classList.contains('has-new'));
    mm.chat.open();
    check('C.3 … and on time, the replay is in order with nothing rerouted', JSON.stringify(order(mm)) === JSON.stringify(['rvc-divider:Earlier', 'Old q', 'Old a', 'rvc-divider:Now']), order(mm));
  })();
  await (async function () {
    var e = setup();
    var mm = mountChat(e, { loadHistory: function () { return Promise.reject(new Error('stub: history 500')); } });
    mm.chat.open();
    await settle();
    var line = byClass(mm.$('thread'), 'rvc-loading')[0];
    check('C.3 a failed replay says so, in its place', line && line.textContent === 'Your earlier messages could not be loaded.' && e.errors.length === 1);
  })();

  /* ======== C.4 send ======== */
  var IN = m.$('input'), SEND = m.$('send');
  type(m, '  Show drafts from last week  ');
  key(IN, 'Enter', { shiftKey: true });
  await settle();
  check('C.4 Shift+Enter does not send', m.log.sent.length === 0);
  var ent = key(IN, 'Enter');
  await settle();
  check('C.4 Enter sends the trimmed text', m.log.sent.join('|') === 'Show drafts from last week' && ent.defaultPrevented);
  check('C.4 send gets (text, {attachments:[], context:null})', JSON.stringify(m.log.sentOpts[0]) === JSON.stringify({ attachments: [], context: null }), m.log.sentOpts[0]);
  var ut = turns(m);
  check('C.4 the kit draws the person\'s own bubble', ut.length === 1 && ut[0].classList.contains('rvc-user') && byClass(ut[0], 'rvc-msg')[0].textContent === 'Show drafts from last week');
  check('C.4 the box is emptied', IN.value === '');
  check('C.4 while thinking: Send disabled, the box read-only and aria-disabled (focus kept)', SEND.disabled === true && IN.readOnly === true &&
    IN.getAttribute('aria-disabled') === 'true' && env.doc.activeElement === IN);
  check('C.4 while thinking: the status pill and the busy strip say so', m.$('status').textContent === 'Thinking…' && m.$('busy').hidden === false &&
    byClass(m.$('busy'), 'rvc-busy-text')[0].textContent === 'ETB2B AI is thinking…' && P.getAttribute('aria-busy') === 'true');
  check('C.4 … with no Stop unless the adapter offers one', m.$('stop').hidden === true);
  type(m, 'Another one');
  key(IN, 'Enter');
  SEND.click();
  await settle();
  check('C.4 a second Enter (or Send) while one is pending does nothing', m.log.sent.length === 1);
  env.clock.advance(7999);
  check('C.4 not "still working" before 8 s', byClass(m.$('busy'), 'rvc-busy-text')[0].textContent === 'ETB2B AI is thinking…');
  env.clock.advance(1);
  check('C.4 after 8 s: "Still working. This can take up to a minute."', byClass(m.$('busy'), 'rvc-busy-text')[0].textContent === 'Still working. This can take up to a minute.' &&
    m.$('status').textContent === 'Still working… This can take up to a minute.');
  m.chat.ai('Here they are.');
  m.pending[0].ok();
  await settle();
  check('C.4 an answer unlocks the box and says Ready', SEND.disabled === false && IN.readOnly === false && !IN.hasAttribute('aria-disabled') &&
    m.$('busy').hidden === true && m.$('status').textContent === 'Ready' && !P.hasAttribute('aria-busy'));
  check('C.4 the text typed while locked is left alone', IN.value === 'Another one');
  type(m, '   ');
  key(IN, 'Enter');
  await settle();
  check('C.4 an empty message is not sent', m.log.sent.length === 1);

  type(m, 'Open Autotech');
  key(IN, 'Enter');
  await settle();
  m.pending[1].no(new Error('That is a lot of messages in a short time. Please wait a few minutes and try again.'));
  await settle();
  var errT = turns(m).filter(function (t) { return t.classList.contains('rvc-error'); });
  check('C.4 a failure: an error bubble with the reason', errT.length === 1 && byClass(errT[0], 'rvc-text')[0].textContent === 'That is a lot of messages in a short time. Please wait a few minutes and try again.');
  check('C.4 a failure: the text is back in the box', IN.value === 'Open Autotech' && SEND.disabled === false);
  var failedU = turns(m).filter(function (t) { return t.classList.contains('is-failed'); });
  check('C.4 a failure: the person\'s bubble says "Not sent"', failedU.length === 1 && byClass(failedU[0], 'rvc-failed-note')[0].textContent === 'Not sent');
  var again = btnIn(errT[0], 'Try again');
  check('C.4 a failure: Try again (UX-097)', !!again);
  again.click();
  await settle();
  check('C.4 Try again sends the same text again', m.log.sent.join('|') === 'Show drafts from last week|Open Autotech|Open Autotech');
  check('C.4 … without a second bubble, and the error goes', turns(m).filter(function (t) { return t.classList.contains('rvc-user') && byClass(t, 'rvc-msg')[0].textContent === 'Open Autotech'; }).length === 1 &&
    turns(m).filter(function (t) { return t.classList.contains('rvc-error'); }).length === 0 && turns(m).filter(function (t) { return t.classList.contains('is-failed'); }).length === 0);
  check('C.4 … and the box is empty again', IN.value === '');
  m.pending[2].no(new Error('Second failure'));
  await settle();
  key(IN, 'Enter');   // the restored text, sent as is: the same as Try again
  await settle();
  check('C.4 Enter on the restored text is the same as Try again', m.log.sent.length === 4 && turns(m).filter(function (t) { return t.classList.contains('rvc-error'); }).length === 0 &&
    turns(m).filter(function (t) { return t.classList.contains('rvc-user') && byClass(t, 'rvc-msg')[0].textContent === 'Open Autotech'; }).length === 1);
  var e4 = new Error('You have used today’s ETB2B AI allowance. It resets at midnight (India time).');
  e4.retryable = false;
  m.pending[3].no(e4);
  await settle();
  var last = turns(m)[turns(m).length - 1];
  check('C.4 retryable:false: the sentence, and no Try again', last.classList.contains('rvc-error') && byClass(last, 'rvc-text')[0].textContent === e4.message && !btnIn(last, 'Try again'));
  check('C.4 focus is back in the box after an answer or a failure', env.doc.activeElement === IN);

  await (async function () {
    var e = setup({ offline: true });
    var mm = mountChat(e);
    mm.chat.open();
    type(mm, 'hi'); key(mm.$('input'), 'Enter'); await settle();
    mm.pending[0].no(new TypeError('Failed to fetch'));
    await settle();
    var t = turns(mm).pop();
    check('C.4 offline: "You’re offline. Check your connection and try again."', byClass(t, 'rvc-text')[0].textContent === 'You’re offline. Check your connection and try again.' && mm.$('input').value === 'hi');
    var e2 = setup();
    var m2 = mountChat(e2, { send: function () { throw new Error('stub: thrown'); } });
    m2.chat.open();
    type(m2, 'boom'); key(m2.$('input'), 'Enter'); await settle();
    check('C.4 a send that throws is a failure like any other', byClass(turns(m2).pop(), 'rvc-text')[0].textContent === 'stub: thrown' && m2.$('input').value === 'boom' && m2.$('send').disabled === false);
    var e3 = setup();
    var m3 = mountChat(e3, { send: function () { var x = new Error('signed out'); x.silent = true; return Promise.reject(x); } });
    m3.chat.open();
    type(m3, 'x'); key(m3.$('input'), 'Enter'); await settle();
    check('C.4 silent:true: no error bubble (the adapter says it), the text is back', turns(m3).filter(function (t2) { return t2.classList.contains('rvc-error'); }).length === 0 && m3.$('input').value === 'x');
    var e5 = setup();
    var m5 = mountChat(e5, { send: function () { return Promise.reject(new Error('')); } });
    m5.chat.open();
    type(m5, 'y'); key(m5.$('input'), 'Enter'); await settle();
    check('C.4 a failure with no words gets the kit\'s own sentence', byClass(turns(m5).pop(), 'rvc-text')[0].textContent === 'ETB2B AI could not answer just now. Try again.');
    var e6 = setup();
    var m6 = mountChat(e6, { send: function () { return Promise.reject(new Error('Use **this**, not that.')); } });
    m6.chat.open();
    type(m6, 'z'); key(m6.$('input'), 'Enter'); await settle();
    var errB = turns(m6).pop();
    check('C.4 an error sentence is shown exactly as given (no formatting)', byClass(errB, 'rvc-text')[0].textContent === 'Use **this**, not that.' && byTag(errB, 'b').length === 0);
  })();

  /* ======== C.5 text only ======== */
  var XSS = '<img src=x onerror=alert(1)>';
  var ux = m.chat.user(XSS);
  var uwords = byClass(ux, 'rvc-msg-words')[0];
  check('C.5 a person\'s message is text, not markup', uwords.textContent === XSS && uwords.childNodes.every(function (c) { return c.nodeType === 3; }) && byTag(ux, 'img').length === 0);
  var bx = m.chat.ai([
    { t: 'text', v: 'See ' },
    { t: 'event', id: 'x', name: XSS, href: 'javascript:alert(1)' },
    { t: 'text', v: ', ' },
    { t: 'event', id: 'y', name: 'Evil two', href: '//evil.example/x' },
    { t: 'event', id: 'z', name: 'Evil three', href: '/\\evil.example' },
    { t: 'event', id: 'w', name: 'Evil four', href: '/\t/evil.example' },
    { t: 'event', id: 'v', name: 'Evil five', href: 'https://evil.example/' },
    { t: 'text', v: ' and ' },
    { t: 'event', id: 'autotech-2026', name: 'Autotech 2026', href: '/edit-event.html?event=autotech-2026' },
    { t: 'text', v: ' has ' },
    { t: 'value', v: '1,234', metric: 'registrations', id: 'autotech-2026' },
    { t: 'text', v: ' registrations so far; ' },
    { t: 'missing', v: 'an event I could not find' }
  ]);
  var links = byTag(bx.node, 'a');
  check('C.5 only the path on this site became a link', links.length === 1 && links[0].getAttribute('href') === '/edit-event.html?event=autotech-2026' && links[0].textContent === 'Autotech 2026', links.map(function (a) { return a.getAttribute('href'); }));
  check('C.5 javascript:, //x, /\\x, /<tab>/x and https: stay text', byClass(bx.node, 'rvc-ev-plain').map(function (s) { return s.textContent; }).join('|') === [XSS, 'Evil two', 'Evil three', 'Evil four', 'Evil five'].join('|'));
  check('C.5 no markup from an event name', byTag(bx.node, 'img').length === 0);
  var val = byClass(bx.node, 'rvc-val')[0];
  check('C.5 a value is <strong> with its metric', val && val.localName === 'strong' && val.textContent === '1,234' && val.getAttribute('data-metric') === 'registrations');
  check('C.5 a missing event reads as such', byClass(bx.node, 'rvc-missing')[0].textContent === 'an event I could not find');
  check('C.5 the whole sentence reads in order (parts are drawn as they are, not formatted)', byClass(bx.node, 'rvc-text')[0].textContent ===
    'See ' + XSS + ', Evil twoEvil threeEvil fourEvil five and Autotech 2026 has 1,234 registrations so far; an event I could not find');
  var lk = bx.link('https://evil.example/', 'Open it');
  var lk2 = bx.link('/marketing.html?event=autotech-2026&tab=posts', 'Promotions');
  check('C.5 link(): only a path on this site is an <a>', lk.localName === 'span' && lk2.localName === 'a' && lk2.getAttribute('href') === '/marketing.html?event=autotech-2026&tab=posts');
  var lc = bx.list({ title: 'X', items: [{ name: XSS, href: 'javascript:alert(1)' }] });
  check('C.5 list(): a bad address is text, a name is text', byTag(lc, 'a').length === 0 && byTag(lc, 'img').length === 0 && byClass(lc, 'rvc-row-name')[0].textContent === XSS);
  var bscript = m.chat.ai('<script>alert(1)</script>\n- <b onclick=x>bold</b>\n**<img src=x>**');
  check('C.5 formatted words stay words: no <script>, <img> or onclick from an answer', byTag(bscript.node, 'script').length === 0 && byTag(bscript.node, 'img').length === 0 &&
    all(bscript.node, function (e2) { return e2.hasAttribute('onclick'); }).length === 0 &&
    byClass(bscript.node, 'rvc-text')[0].textContent === '<script>alert(1)</script><b onclick=x>bold</b><img src=x>');

  /* ======== C.6 bubbles and cards ======== */
  var b = m.chat.ai('Events that go live this month', { asOf: '2026-11-03T06:30:00Z' });
  var card = b.list({ title: 'Go live this month', count: 23, more: true, items: [
    { href: '/edit-event.html?event=agentic-ai-2026', name: 'Agentic AI Summit 2026', meta: '20–21 Nov 2026', chip: { label: 'Active', tone: 'active' }, value: 1234 },
    { href: '/edit-event.html?event=qa-draft', name: 'QA Draft', meta: '25 Nov 2026', chip: { label: 'Site not live', tone: 'nonsense' }, value: '0 registrations' }
  ] });
  var rows = byClass(card, 'rvc-row');
  check('C.6 list: the title and the count (said in full to screen readers)', byClass(card, 'rvc-list-title')[0].textContent === 'Go live this month' &&
    byClass(card, 'rvc-count')[0].textContent === '23 (23 in all)');
  check('C.6 list: one row per item, the name a link', rows.length === 2 && byTag(rows[0], 'a')[0].getAttribute('href') === '/edit-event.html?event=agentic-ai-2026' &&
    byTag(rows[0], 'a')[0].textContent === 'Agentic AI Summit 2026');
  check('C.6 list: dates, the status chip and its tone', byClass(rows[0], 'rvc-row-dates')[0].textContent === '20–21 Nov 2026' &&
    byClass(rows[0], 'rvc-chip')[0].textContent === 'Active' && byClass(rows[0], 'rvc-chip')[0].classList.contains('rvc-tone-active'));
  check('C.6 list: an unknown tone is muted', byClass(rows[1], 'rvc-chip')[0].classList.contains('rvc-tone-muted'));
  check('C.6 list: a number is grouped the Indian way; a string is kept', byClass(rows[0], 'rvc-row-val')[0].textContent === '1,234' && byClass(rows[1], 'rvc-row-val')[0].textContent === '0 registrations');
  check('C.6 list: more → "Showing 2 of 23."', byClass(card, 'rvc-list-more')[0].textContent === 'Showing 2 of 23.');
  var big = m.chat.ai('').list({ title: 'Big', count: 1234567, items: [] });
  check('C.6 list: a large count reads 12,34,567', byClass(big, 'rvc-count')[0].textContent.indexOf('12,34,567') === 0);
  check('C.6 "as of 12:00 IST" on today\'s numbers', byClass(b.node, 'rvc-asof')[0].textContent === 'as of 12:00 IST');
  check('C.6 "as of 1 Nov, 12:00 IST" on an older one', byClass(m.chat.ai('x', { asOf: '2026-11-01T06:30:00Z' }).node, 'rvc-asof')[0].textContent === 'as of 1 Nov, 12:00 IST');
  check('C.6 "as of 3 Nov 2025, 12:00 IST" from another year', byClass(m.chat.ai('x', { asOf: '2025-11-03T06:30:00Z' }).node, 'rvc-asof')[0].textContent === 'as of 3 Nov 2025, 12:00 IST');
  check('C.6 an IST date that is not the UTC date (23:30 UTC = 05:00 IST next day)', byClass(m.chat.ai('x', { asOf: '2026-11-02T23:30:00Z' }).node, 'rvc-asof')[0].textContent === 'as of 05:00 IST');
  check('C.6 no "as of" line without asOf, or with a bad one', byClass(m.chat.ai('x').node, 'rvc-asof').length === 0 && byClass(m.chat.ai('x', { asOf: 'junk' }).node, 'rvc-asof').length === 0);

  var undos = 0;
  var fnU = function () { undos++; };
  var u = b.undo(fnU);
  u.click();
  check('C.6 undo: fires once, then reads Undone and is disabled', undos === 1 && u.textContent === 'Undone' && u.getAttribute('aria-disabled') === 'true');
  u.click();
  check('C.6 undo: a second click does nothing', undos === 1);
  var asked = 0, sayNo = true;
  var u2 = m.chat.ai('older').undo(function () { asked++; return sayNo ? false : undefined; });
  u2.click();
  check('C.6 undo: a handler that returns false (the person said no) leaves Undo as it was', asked === 1 && u2.textContent === 'Undo' && !u2.hasAttribute('aria-disabled'));
  sayNo = false; u2.click();
  check('C.6 undo: … and it can be pressed again', asked === 2 && u2.textContent === 'Undone');
  var resolveU;
  var u3 = m.chat.ai('async').undo(function () { return new Promise(function (ok) { resolveU = ok; }); });
  u3.click();
  check('C.6 undo: a promise keeps it busy', u3.getAttribute('aria-busy') === 'true' && u3.getAttribute('aria-disabled') === 'true' && u3.textContent === 'Undo');
  u3.click();
  resolveU(); await settle();
  check('C.6 undo: … then Undone', u3.textContent === 'Undone' && !u3.hasAttribute('aria-busy'));
  var u4 = m.chat.ai('marked').undo(function () { throw new Error('should not run'); });
  var fnMark = function () { throw new Error('should not run either'); };
  var u5 = m.chat.ai('marked2').undo(fnMark);
  m.chat.markUndone(fnMark);
  check('C.6 markUndone(fn): every Undo bound to it reads Undone, without running it', u5.textContent === 'Undone' && u4.textContent === 'Undo');

  var bn = m.chat.ai('Here they are.');
  var seen = null;
  var sb = bn.button('Show these in the list', function (e) { seen = e; });
  sb.click();
  check('C.6 button(): in the foot, a real button, called with the event', sb.localName === 'button' && sb.getAttribute('type') === 'button' && sb.classList.contains('rvc-btn') &&
    byClass(bn.node, 'rvc-foot')[0].contains(sb) && seen && seen.type === 'click');
  check('C.6 button({primary}) has the primary look', bn.button('Go', function () {}, { primary: true }).classList.contains('rvc-btn-primary'));
  var nt = bn.note('This message wasn’t saved to your history.');
  check('C.6 note(): a muted line in the answer', nt.classList.contains('rvc-note') && nt.textContent === 'This message wasn’t saved to your history.');

  var cancels = 0, dones = 0;
  var bc = m.chat.ai('');
  var cd = bc.countdown(1200, 'the Autotech editor', function () { cancels++; }, function () { dones++; });
  var bar = byClass(cd.node, 'rvc-cd-bar')[0];
  check('C.6 countdown: "Opening … …" with Stay here and the bar timed to the wait', byClass(cd.node, 'rvc-cd-text')[0].textContent === 'Opening the Autotech editor…' &&
    !!btnIn(cd.node, 'Stay here') && bar.childNodes[0].style.animationDuration === '1200ms' && cd.isRunning());
  check('C.6 countdown: one sentence for screen readers, the visible line hidden from them', byClass(cd.node, 'rvc-cd-text')[0].getAttribute('aria-hidden') === 'true' &&
    byClass(cd.node, 'rvc-sr')[0].textContent === 'Opening the Autotech editor in a moment. Press Escape or choose Stay here to stay on this page.');
  env.clock.advance(1199);
  check('C.6 countdown: nothing before the time', dones === 0 && cancels === 0);
  env.clock.advance(1);
  check('C.6 countdown: fires after the time (onDone), not onCancel', dones === 1 && cancels === 0 && !cd.isRunning() && btnIn(cd.node, 'Stay here').getAttribute('aria-disabled') === 'true');
  check('C.6 countdown: cancel() after it fired does nothing', cd.cancel() === false && cancels === 0);
  var cd2 = m.chat.ai('').countdown(1200, 'Promotions', function () { cancels++; }, function () { dones++; });
  check('C.6 countdown: cancel() stops it and calls onCancel once', cd2.cancel() === true && cd2.cancel() === false && cancels === 1);
  env.clock.advance(5000);
  check('C.6 countdown: … and it never fires', dones === 1 && byClass(cd2.node, 'rvc-cd-text')[0].textContent === 'Stayed here.' && !btnIn(cd2.node, 'Stay here'));
  var cd3 = m.chat.ai('').countdown(1200, 'Create Event', function () { cancels++; });
  m.$('input').focus();
  var escC = key(m.$('input'), 'Escape');
  check('C.6 countdown: Esc is Stay here, and the panel stays open', !cd3.isRunning() && cancels === 2 && escC.defaultPrevented && m.chat.isOpen());
  var cd4 = m.chat.ai('').countdown(1200, 'Registrations', function () { cancels++; });
  var stay = btnIn(cd4.node, 'Stay here');
  stay.focus(); stay.click();
  check('C.6 countdown: Stay here cancels, and focus goes back to the box', !cd4.isRunning() && cancels === 3 && env.doc.activeElement === m.$('input'));
  var cd5 = m.chat.ai('').countdown(1200, 'Insights', function () { cancels++; });
  cd5.cancel({ silent: true, text: 'Opened in a new tab.' });
  check('C.6 countdown: cancel({silent, text}) shows the words and does not call onCancel', cancels === 3 && byClass(cd5.node, 'rvc-cd-text')[0].textContent === 'Opened in a new tab.');
  var cdFull = m.chat.ai('').countdown(1200, 'Opening Promotions…', function () {});
  check('C.6 countdown: a label that is already the whole line is not doubled', byClass(cdFull.node, 'rvc-cd-text')[0].textContent === 'Opening Promotions…' &&
    byClass(cdFull.node, 'rvc-sr')[0].textContent === 'Opening Promotions in a moment. Press Escape or choose Stay here to stay on this page.');
  cdFull.cancel({ silent: true });
  var cd6 = m.chat.ai('').countdown(1200, 'A', function () {}), cd7 = m.chat.ai('').countdown(1200, 'B', function () {});
  key(m.$('input'), 'Escape');
  check('C.6 countdown: Esc stops the newest first', cd6.isRunning() && !cd7.isRunning());
  cd6.cancel();

  var picks = [];
  var bch = m.chat.ai('Which one?');
  var grp = bch.choices([
    { label: 'Autotech 2026 · 20–21 Nov 2026 · Upcoming', onClick: function () { picks.push(2026); } },
    { label: 'Autotech 2025 · 14 Nov 2025 · Completed', onClick: function () { picks.push(2025); } }
  ]);
  var cb = byClass(grp, 'rvc-choice');
  check('C.6 choices: one button per choice, in a named group', cb.length === 2 && grp.getAttribute('role') === 'group' && cb[0].textContent === 'Autotech 2026 · 20–21 Nov 2026 · Upcoming');
  cb[0].click(); cb[1].click(); cb[0].click();
  check('C.6 choices: a click runs that one only, once', picks.join() === '2026');
  check('C.6 choices: the chosen one is marked, all are locked', cb[0].classList.contains('is-chosen') && cb[0].textContent.indexOf('(chosen)') !== -1 &&
    cb.every(function (x) { return x.getAttribute('aria-disabled') === 'true'; }));
  var maybe = 0;
  var cbn = byClass(m.chat.ai('?').choices([{ label: 'One', onClick: function () { maybe++; return false; } }]), 'rvc-choice');
  cbn[0].click(); cbn[0].click();
  check('C.6 choices: onClick returning false leaves them open', maybe === 2 && !cbn[0].hasAttribute('aria-disabled'));
  var dv = m.chat.divider('Earlier');
  check('C.6 divider()', dv.classList.contains('rvc-divider') && dv.textContent === 'Earlier' && m.$('thread').lastChild === dv);
  var ua = m.chat.user('Hello', { at: Date.parse('2026-11-03T06:00:00Z') });
  check('C.6 user({at}): the time of a turn today', byTag(ua, 'time')[0].textContent === '06:00');

  check('C.6 the thread follows new turns when at the end', (function () {
    T.scrollHeight = 2000; T.clientHeight = 400; T.scrollTop = 1600;
    m.chat.ai('a'); T.scrollHeight = 2100;
    var b2 = m.chat.ai('b');
    T.scrollHeight = 2300;
    b2.note('grew');
    return T.scrollTop === 2300;
  })());
  check('C.6 … and keeps its place when the person has scrolled up', (function () {
    T.scrollTop = 200; T.scrollHeight = 2500;
    m.chat.ai('c');
    return T.scrollTop === 200;
  })());

  m.chat.close();
  m.chat.ai('An answer while it was shut');
  check('C.6 an answer while shut marks the launcher (new reply)', L.classList.contains('has-new') && L.getAttribute('aria-label') === 'Ask ETB2B AI (new reply)');
  m.chat.open();
  check('C.6 … cleared on open', !L.classList.contains('has-new') && L.getAttribute('aria-label') === 'Ask ETB2B AI');

  /* ======== C.7 suggestions fill the box and never send (UX-095) ======== */
  await (async function () {
    var e = setup();
    var mm = mountChat(e);
    var sg = byClass(mm.$('thread'), 'rvc-suggestion');
    sg[0].click();
    var t = SUGGESTIONS[0].text;
    check('C.7 a suggestion opens the panel and fills the box', mm.chat.isOpen() && mm.$('input').value === t && e.doc.activeElement === mm.$('input'));
    check('C.7 the first "…" is selected, so typing replaces it', mm.$('input').selectionStart === t.indexOf('…') && mm.$('input').selectionEnd === t.indexOf('…') + 1);
    sg[1].click();
    check('C.7 one with no "…" puts the caret at the end', mm.$('input').value === SUGGESTIONS[1].text && mm.$('input').selectionStart === SUGGESTIONS[1].text.length);
    await settle();
    check('C.7 no send', mm.log.sent.length === 0);
    check('C.7 the hint says nothing is sent until Enter', byClass(mm.$('thread'), 'rvc-suggest-hint')[0].textContent === 'Pick one to start your message. Nothing is sent until you press Enter.');
    mm.chat.setBusy(true);
    sg[2].click();
    check('C.7 while thinking, a suggestion does not overwrite the box', mm.$('input').value === SUGGESTIONS[1].text);
    mm.chat.setBusy(false);
    mm.chat.setBusy(true, 'Opening Create Event…');
    check('C.7 setBusy(on, text): the strip shows that text', byClass(mm.$('busy'), 'rvc-busy-text')[0].textContent === 'Opening Create Event…');
    mm.chat.setBusy(false);
    /* an adapter that calls setBusy(true) again while busy (as dash-bot-client.js does) */
    mm.chat.setBusy(true);
    e.clock.advance(5000);
    mm.chat.setBusy(true);
    e.clock.advance(3000);
    check('C.4 setBusy(true) again while busy keeps the 8 s clock of the first call', mm.$('status').textContent.indexOf('Still working…') === 0 &&
      byClass(mm.$('busy'), 'rvc-busy-text')[0].textContent === 'Still working. This can take up to a minute.');
    mm.chat.setBusy(true, 'Still working. This can take up to a minute.');
    mm.chat.setBusy(true);
    check('C.4 … and once "Still working…" the pill keeps saying so', mm.$('status').textContent.indexOf('Still working…') === 0 &&
      byClass(mm.$('busy'), 'rvc-busy-text')[0].textContent === 'Still working. This can take up to a minute.');
    mm.chat.setBusy(false); mm.chat.setBusy(false);
    check('C.4 setBusy(false) twice is harmless: Ready, unlocked', mm.$('status').textContent === 'Ready' && mm.$('send').disabled === false && mm.$('busy').hidden === true);
    mm.chat.setBusy(true);
    check('C.4 a new busy spell starts at "Thinking…" again', mm.$('status').textContent === 'Thinking…' && byClass(mm.$('busy'), 'rvc-busy-text')[0].textContent === 'ETB2B AI is thinking…');
    mm.chat.setBusy(false);
  })();

  /* ======== C.8 two chats on one page ======== */
  (function () {
    var e = setup();
    mountChat(e);
    e.RC.mount(e.host, { id: 'dash', send: function () { return Promise.resolve(); } });
    e.RC.mount(e.host, { id: 'ed', send: function () { return Promise.resolve(); } });
    var ids = all(e.doc.documentElement, function (x) { return x.hasAttribute('id'); }).map(function (x) { return x.getAttribute('id'); });
    var dup = ids.filter(function (x, i) { return ids.indexOf(x) !== i; });
    check('C.8 two mounts → no duplicate ids', dup.length === 0, dup);
    check('C.8 a second "dash" gets dash-2-…, and "ed" its own', !!e.doc.getElementById('dash-2-chat-panel') && !!e.doc.getElementById('ed-chat-panel') &&
      e.doc.getElementById('dash-2-chat-launcher').getAttribute('aria-controls') === 'dash-2-chat-panel' &&
      e.doc.getElementById('dash-2-chat-panel').getAttribute('aria-labelledby') === 'dash-2-chat-title');
  })();

  /* ======== C.11 fold: the one-line bar after a change ======== */
  await (async function () {
    var e = setup();
    var undone = 0;
    var mm = mountChat(e);
    mm.chat.open();
    var th = mm.$('thread'), panel = mm.$('panel'), peek = e.doc.getElementById('dash-chat-peek'), launcher = mm.$('launcher');
    var fnUndo = function () { undone++; };
    var bb = mm.chat.ai('Showing Draft events · created 26 Oct – 1 Nov 2026');
    var cardUndo = bb.undo(fnUndo);
    th.scrollHeight = 1000; th.clientHeight = 400; th.scrollTop = 120;
    mm.log.open.length = 0;
    mm.chat.fold('Draft events · created 26 Oct – 1 Nov 2026', fnUndo);
    var pl = byClass(peek, 'rvc-peek-label')[0];
    var pu = btnIn(peek, 'Undo'), pb = btnIn(peek, 'Back to chat');
    check('C.11 fold: the panel hides and the bar shows', panel.hidden === true && peek.hidden === false && mm.chat.isOpen() === false && mm.chat.isFolded() === true);
    check('C.11 fold: the bar has the label, Undo and Back to chat', pl.textContent === 'Showing Draft events · created 26 Oct – 1 Nov 2026' && pl.getAttribute('title') === pl.textContent &&
      pu && !pu.hidden && pb && !pb.hidden);
    check('C.11 fold: focus goes to the bar\'s Undo; the launcher is not expanded; onOpenChange(false)', e.doc.activeElement === pu && launcher.getAttribute('aria-expanded') === 'false' && mm.log.open.join() === 'false');
    e.clock.advance(60);
    check('C.11 fold: said to screen readers', e.doc.getElementById('dash-chat-live').textContent === 'Showing Draft events · created 26 Oct – 1 Nov 2026. Undo is in the ETB2B AI bar.');
    th.scrollTop = 0;   // a browser may forget a hidden box's place
    pb.click();
    check('C.11 Back to chat: the panel, at the same scroll place, focus in the box', panel.hidden === false && peek.hidden === true && th.scrollTop === 120 &&
      e.doc.activeElement === mm.$('input') && mm.chat.isOpen() === true && mm.log.open.join() === 'false,true');
    mm.chat.fold('Showing Draft events · created 26 Oct – 1 Nov 2026', fnUndo);
    check('C.11 a label that already starts with "Showing" is not doubled', byClass(peek, 'rvc-peek-label')[0].textContent === 'Showing Draft events · created 26 Oct – 1 Nov 2026');
    /* QA follow-up 2 F5: a portal switch's label already says what happened */
    pb.click();
    mm.chat.fold('Now working in ETHRWorld', fnUndo);
    e.clock.advance(60);
    check('C.11 a label that starts with "Now" gets no "Showing" in front, on the bar or for screen readers',
      byClass(peek, 'rvc-peek-label')[0].textContent === 'Now working in ETHRWorld' && byClass(peek, 'rvc-peek-label')[0].getAttribute('title') === 'Now working in ETHRWorld' &&
      e.doc.getElementById('dash-chat-live').textContent === 'Now working in ETHRWorld. Undo is in the ETB2B AI bar.', [byClass(peek, 'rvc-peek-label')[0].textContent, e.doc.getElementById('dash-chat-live').textContent]);
    mm.chat.fold('Nowhere events', fnUndo);
    check('C.11 …a word that only begins with "now" still gets it', byClass(peek, 'rvc-peek-label')[0].textContent === 'Showing Nowhere events');
    /* K.13 the editor's fold after a page change (UX-094) */
    mm.chat.fold('Changed “Hero”', fnUndo);
    e.clock.advance(60);
    check('K.13 a label that starts with "Changed" is shown as it is (the editor\'s fold, UX-094)', byClass(peek, 'rvc-peek-label')[0].textContent === 'Changed “Hero”' &&
      e.doc.getElementById('dash-chat-live').textContent === 'Changed “Hero”. Undo is in the ETB2B AI bar.');
    mm.chat.fold('Changeday', fnUndo);
    check('K.13 …a word that only begins with "change" still gets "Showing"', byClass(peek, 'rvc-peek-label')[0].textContent === 'Showing Changeday');
    pb.click();
    mm.chat.fold('Showing Draft events · created 26 Oct – 1 Nov 2026', fnUndo);
    th.scrollTop = 0;
    launcher.click();
    check('C.11 the launcher unfolds too, to the same place', panel.hidden === false && peek.hidden === true && th.scrollTop === 120);
    mm.chat.fold('Draft events', fnUndo);
    btnIn(peek, 'Undo').click();
    check('C.11 the bar\'s Undo calls onUndo once', undone === 1);
    check('C.11 … and the card\'s Undo for the same change reads Undone too', cardUndo.textContent === 'Undone' && byClass(peek, 'rvc-undo')[0].textContent === 'Undone');
    cardUndo.click(); byClass(peek, 'rvc-undo')[0].click();
    check('C.11 … so it is never undone twice', undone === 1);
    e.clock.advance(60);
    check('C.11 … and "Undone." is said while folded', e.doc.getElementById('dash-chat-live').textContent === 'Undone.');
    var fn2 = function () { undone++; };
    mm.chat.fold('Upcoming events', fn2);
    check('C.11 a new fold with a new change has a fresh Undo', byClass(peek, 'rvc-undo')[0].textContent === 'Undo' && !byClass(peek, 'rvc-undo')[0].hasAttribute('aria-disabled'));
    cardUndo.click();
    check('C.11 … and the old card is not tied to the new bar', undone === 1 && byClass(peek, 'rvc-undo')[0].textContent === 'Undo');
    mm.chat.unfold();
    mm.chat.fold('Upcoming events', null);
    check('C.11 fold without onUndo: no Undo, focus on Back to chat', byClass(peek, 'rvc-undo')[0].hidden === true && e.doc.activeElement === btnIn(peek, 'Back to chat'));
    key(btnIn(peek, 'Back to chat'), 'Escape');
    check('C.11 Esc in the bar closes it, focus on the launcher', peek.hidden === true && panel.hidden === true && e.doc.activeElement === launcher && !mm.chat.isFolded());
    mm.chat.unfold();
    check('C.11 unfold() when not folded does nothing', mm.chat.isOpen() === false);
  })();

  /* someone working in the page keeps their focus: a key meant for the search box never lands on Undo */
  await (async function () {
    var e = setup();
    var undone = 0;
    var mm = mountChat(e);
    var search = e.doc.createElement('input');
    search.setAttribute('id', 'search');
    e.doc.body.appendChild(search);
    var peek = e.doc.getElementById('dash-chat-peek');
    mm.chat.open();
    type(mm, 'Show drafts from last week'); key(mm.$('input'), 'Enter'); await settle();
    search.focus();                                   // the person goes back to the page while ETB2B AI thinks
    var fnU2 = function () { undone++; };
    mm.chat.ai('Showing Draft events').undo(fnU2);
    mm.chat.fold('Draft events', fnU2);
    mm.pending[0].ok(); await settle();
    check('C.11 fold while the focus is in the page: the focus stays there', e.doc.activeElement === search, e.doc.activeElement && e.doc.activeElement.className);
    check('C.11 … the bar still shows, with Undo', peek.hidden === false && btnIn(peek, 'Undo') && !btnIn(peek, 'Undo').hidden);
    e.clock.advance(60);
    check('C.11 … and it is still said to screen readers', e.doc.getElementById('dash-chat-live').textContent === 'Showing Draft events. Undo is in the ETB2B AI bar.');
    key(search, ' ');
    check('C.11 … so a key typed there does not undo the change', undone === 0);
    /* nothing on the page had the focus: the bar may take it */
    mm.chat.open();
    e.doc.activeElement.blur();
    check('C.11 (nothing has the focus: it is on the body)', e.doc.activeElement === e.doc.body);
    mm.chat.fold('Draft events', fnU2);
    check('C.11 fold with no focus anywhere: Undo takes it', e.doc.activeElement === btnIn(peek, 'Undo'));
  })();
  await (async function () {
    var e = setup();
    var mm = mountChat(e);
    var search = e.doc.createElement('input');
    e.doc.body.appendChild(search);
    mm.chat.open();
    type(mm, 'Open Autotech'); key(mm.$('input'), 'Enter'); await settle();
    search.focus();
    mm.pending[0].no(new Error('stub: failed'));
    await settle();
    check('C.11 a failure while the focus is in the page: the focus stays there', e.doc.activeElement === search);
    check('C.11 … the failure is still shown and the text is back in the box', turns(mm).pop().classList.contains('rvc-error') && mm.$('input').value === 'Open Autotech');
    mm.$('input').focus();
    key(mm.$('input'), 'Enter'); await settle();
    search.focus();
    mm.pending[1].ok(); await settle();
    check('C.11 an answer while the focus is in the page: the focus stays there too', e.doc.activeElement === search);
    mm.$('send').focus();
    type(mm, 'again'); key(mm.$('input'), 'Enter'); await settle();
    mm.$('send').focus();
    mm.pending[2].no(new Error('stub: failed again'));
    await settle();
    check('C.11 a failure while the focus is in the chat: back in the box', e.doc.activeElement === mm.$('input'));
  })();

  /* ======== C.12 a page about to open: its Stay here is always in sight ======== */
  await (async function () {
    var e = setup();
    var mm = mountChat(e);
    var peek = e.doc.getElementById('dash-chat-peek'), launcher = mm.$('launcher'), live = e.doc.getElementById('dash-chat-live');
    var closeB = byClass(mm.$('panel'), 'rvc-close')[0];
    var log = { cancel: 0, done: 0 };
    function cdOf(c, label) { return c.countdown(1200, label, function () { log.cancel++; }, function () { log.done++; }); }
    check('C.12 no Stay here in the bar until one is needed (no hidden twin)', !btnIn(peek, 'Stay here'));

    /* (a) Close while "Opening …" shows */
    mm.chat.open();
    var c1 = cdOf(mm.chat.ai('Opening the editor.'), 'the Autotech editor');
    e.clock.advance(600);
    closeB.click();
    e.clock.advance(5000);
    check('C.12 Close during a countdown: the page stays (onCancel once, never onDone)', !c1.isRunning() && log.cancel === 1 && log.done === 0, log);
    check('C.12 … and the card says why', byClass(c1.node, 'rvc-cd-text')[0].textContent === 'Stayed here, as ETB2B AI was closed.' && !btnIn(c1.node, 'Stay here'));
    check('C.12 … the panel is shut, focus on the launcher', mm.chat.isOpen() === false && e.doc.activeElement === launcher && peek.hidden === true);
    mm.chat.open();
    var c2 = cdOf(mm.chat.ai('x'), 'Promotions');
    launcher.click();
    e.clock.advance(5000);
    check('C.12 the launcher\'s close stops it too', !c2.isRunning() && log.cancel === 2 && log.done === 0);
    mm.chat.open();
    var c3 = cdOf(mm.chat.ai('x'), 'Registrations');
    mm.chat.close();
    e.clock.advance(5000);
    check('C.12 chat.close() stops it too', !c3.isRunning() && log.cancel === 3 && log.done === 0);

    /* (b) an answer that opens a page arrives while the panel is shut */
    var search = e.doc.createElement('input');
    e.doc.body.appendChild(search);
    search.focus();
    var c4 = cdOf(mm.chat.ai('Opening the editor.'), 'the Autotech editor');
    var pStay = btnIn(peek, 'Stay here');
    check('C.12 shut: the bar shows "Opening …" with Stay here and Back to chat (no Undo)', peek.hidden === false && mm.chat.isFolded() === true &&
      byClass(peek, 'rvc-peek-label')[0].textContent === 'Opening the Autotech editor…' && !!pStay && !!btnIn(peek, 'Back to chat') && btnIn(peek, 'Undo').hidden === true);
    check('C.12 shut: the panel stays shut and the focus stays in the page', mm.chat.isOpen() === false && launcher.getAttribute('aria-expanded') === 'false' && e.doc.activeElement === search);
    e.clock.advance(60);
    check('C.12 shut: said to screen readers, with the way to stay', live.textContent === 'Opening the Autotech editor in a moment. Press Escape or choose Stay here to stay on this page.');
    pStay.click();
    e.clock.advance(5000);
    check('C.12 the bar\'s Stay here stops it (onCancel once, never onDone)', !c4.isRunning() && log.cancel === 4 && log.done === 0);
    check('C.12 … the bar says so, and its Stay here goes', byClass(peek, 'rvc-peek-label')[0].textContent === 'Stayed here.' && !btnIn(peek, 'Stay here') && peek.hidden === false &&
      live.textContent === 'Stayed here.' && byClass(c4.node, 'rvc-cd-text')[0].textContent === 'Stayed here.');

    var c5 = cdOf(mm.chat.ai('x'), 'Promotions');
    key(search, 'Escape');
    check('C.12 shut: Esc in the page is Stay here', !c5.isRunning() && log.cancel === 5 && log.done === 0 && !btnIn(peek, 'Stay here'));

    var c6 = cdOf(mm.chat.ai('x'), 'Insights');
    btnIn(peek, 'Stay here').focus();
    key(btnIn(peek, 'Stay here'), 'Escape');
    check('C.12 Esc on the bar\'s Stay here: stays, and the focus goes to Back to chat (not lost)', !c6.isRunning() && log.cancel === 6 && e.doc.activeElement === btnIn(peek, 'Back to chat'));

    var c7 = cdOf(mm.chat.ai('x'), 'the Autotech editor');
    launcher.click();
    check('C.12 opening the panel moves it back into its card: the bar and its Stay here go, it keeps running', mm.chat.isOpen() && peek.hidden === true && !btnIn(peek, 'Stay here') && c7.isRunning() &&
      !!btnIn(c7.node, 'Stay here'));
    e.clock.advance(1200);
    check('C.12 … and opens when its time is up, as Stay here was in sight', log.done === 1 && log.cancel === 6);

    mm.chat.close();
    search.focus();
    var c8 = cdOf(mm.chat.ai('x'), 'Promotions');
    e.clock.advance(1200);
    check('C.12 shut, left alone: it opens at 1.2 s (do it, then undo) and the bar\'s Stay here is locked', log.done === 2 && !c8.isRunning() &&
      btnIn(peek, 'Stay here').getAttribute('aria-disabled') === 'true');
    btnIn(peek, 'Stay here').click();
    check('C.12 … a click on it then does nothing', log.cancel === 6);
    var c8b = cdOf(mm.chat.ai('x'), 'Insights');          // that page did not open after all, and another is asked for
    check('C.12 the next page on its way gets a working Stay here again', !btnIn(peek, 'Stay here').hasAttribute('aria-disabled') && byClass(peek, 'rvc-stay').length === 1);
    btnIn(peek, 'Stay here').click();
    check('C.12 … which stops it', !c8b.isRunning() && log.cancel === 7 && log.done === 2);
    log.cancel = 6;                                      // the counts below go on from before this aside

    /* (c) while folded after a list change, and a second page while one is on its way */
    mm.chat.open();
    var fnU3 = function () {};
    mm.chat.fold('Draft events', fnU3);
    var c9 = cdOf(mm.chat.ai('x'), 'Promotions');
    check('C.12 folded: the bar switches from the list change to "Opening …" with Stay here', byClass(peek, 'rvc-peek-label')[0].textContent === 'Opening Promotions…' &&
      btnIn(peek, 'Undo').hidden === true && !!btnIn(peek, 'Stay here'));
    var c10 = cdOf(mm.chat.ai('x'), 'Registrations');
    check('C.12 a second page while one is on its way: the first stays (onCancel), the bar shows the second', !c9.isRunning() && c10.isRunning() && log.cancel === 7 &&
      byClass(peek, 'rvc-peek-label')[0].textContent === 'Opening Registrations…' && byClass(peek, 'rvc-stay').length === 1);
    mm.chat.fold('Upcoming events', fnU3);
    e.clock.advance(5000);
    check('C.12 a fold stops a page on its way (the list change is the newest thing asked for)', !c10.isRunning() && log.cancel === 8 && log.done === 2 &&
      byClass(peek, 'rvc-peek-label')[0].textContent === 'Showing Upcoming events' && !btnIn(peek, 'Stay here') && btnIn(peek, 'Undo').hidden === false);
    mm.chat.open();
    var c11 = cdOf(mm.chat.ai('x'), 'Insights');
    mm.chat.fold('Draft events', fnU3);
    e.clock.advance(5000);
    check('C.12 … from the open panel too', !c11.isRunning() && log.cancel === 9 && log.done === 2);
  })();

  /* ======== phones: the full sheet ======== */
  await (async function () {
    var vv = { height: 500, offsetTop: 12, _ls: {}, addEventListener: function (t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); } };
    var e = setup({ phone: true, vv: vv });
    var mm = mountChat(e);
    var panel = mm.$('panel'), html = e.doc.documentElement;
    check('PH the phone query is the stylesheet\'s 600px, asked once', !!e.mqs[PHONE_Q] && Object.keys(e.mqs).join() === PHONE_Q, Object.keys(e.mqs));
    check('PH the wrap carries rvc-phone while it is a phone (the stylesheet\'s phone rules hang on it)', mm.wrap.classList.contains('rvc-phone') && !mm.wrap.classList.contains('rvc-half'));
    mm.chat.open();
    check('PH open on a phone: aria-modal=true and the page is locked', panel.getAttribute('aria-modal') === 'true' && html.classList.contains('rvc-lock'));
    check('PH the sheet follows the visible part of the screen (keyboard up)', panel.classList.contains('rvc-has-vv') && panel.style['--rvc-vh'] === '500px' && panel.style['--rvc-vt'] === '12px');
    vv.height = 320; vv._ls.resize.forEach(function (f) { f(); });
    check('PH … and keeps following it', panel.style['--rvc-vh'] === '320px');
    var helpB = byClass(panel, 'rvc-head-help')[0], sendB = mm.$('send');
    sendB.focus();
    var tab = key(sendB, 'Tab');
    check('PH Tab from Send goes round to the first control', tab.defaultPrevented && e.doc.activeElement === helpB);
    var stab = key(helpB, 'Tab', { shiftKey: true });
    check('PH Shift+Tab from the first control goes to Send', stab.defaultPrevented && e.doc.activeElement === sendB);
    mm.chat.setBusy(true);
    helpB.focus();
    key(helpB, 'Tab', { shiftKey: true });
    check('PH while Send is disabled the box is the last stop', e.doc.activeElement === mm.$('input'));
    mm.chat.setBusy(true, 'Checking…', { onStop: function () {} });
    helpB.focus();
    key(helpB, 'Tab', { shiftKey: true });
    check('PH … Stop, above the box, does not change the last stop', e.doc.activeElement === mm.$('input'));
    mm.chat.setBusy(false);
    mm.chat.fold('Draft events', function () {});
    check('PH folding frees the page', !html.classList.contains('rvc-lock') && panel.getAttribute('aria-modal') === 'false');
    mm.chat.open();
    e.setMq(PHONE_Q, false);
    check('PH widening past a phone: not modal, the page free, rvc-phone off', panel.getAttribute('aria-modal') === 'false' && !html.classList.contains('rvc-lock') &&
      !panel.classList.contains('rvc-has-vv') && !mm.wrap.classList.contains('rvc-phone'));
    var t2 = key(mm.$('send'), 'Tab');
    check('PH on a desktop Tab is not trapped', !t2.defaultPrevented);
    e.setMq(PHONE_Q, true);
    mm.chat.close();
    check('PH closing frees the page', !html.classList.contains('rvc-lock'));
  })();
  /* the trap with quick ideas under the box: the last idea is the last stop */
  await (async function () {
    var e = setup({ phone: true });
    var mm = mountChat(e, { quickIdeas: [{ label: 'Shorten the overview', text: 'Shorten the overview to two sentences' }, { label: 'New hero picture', text: 'Make a new hero picture of …' }] });
    mm.chat.open();
    mm.chat.ai('First answer');
    var qb = byClass(mm.$('quick'), 'rvc-quick-btn');
    qb[1].focus();
    var tq = key(qb[1], 'Tab');
    check('K.15 phone: Tab from the last quick idea goes round to the first control', tq.defaultPrevented && e.doc.activeElement === byClass(mm.$('panel'), 'rvc-head-help')[0]);
    mm.$('send').focus();
    check('K.15 … and from Send it goes on to the ideas (not trapped there)', !key(mm.$('send'), 'Tab').defaultPrevented);
  })();

  /* a page callback that throws does not break the chat */
  (function () {
    var e = setup();
    var mm = mountChat(e, { onOpenChange: function () { throw new Error('stub: page callback'); } });
    mm.chat.open();
    check('a throwing onOpenChange is reported, and the panel still opens', mm.chat.isOpen() && e.errors.length === 1);
  })();

  /* ======== K.1 the page's own choices: corner, layers, wrap attributes ======== */
  (function () {
    var e = setup();
    var mm = mountChat(e, { placement: { right: 30, bottom: 40, compact: true }, zIndex: { launcher: 66, panel: 72 },
      wrapAttrs: { 'data-keep-selection': '', 'aria-label': 'ETB2B AI', onclick: 'alert(1)', 'data-x"y': 'z', style: 'color:red' } });
    var w = mm.wrap;
    check('K.1 placement: right and bottom go on the wrap as --rvc-right / --rvc-bottom', w.style['--rvc-right'] === '30px' && w.style['--rvc-bottom'] === '40px');
    check('K.1 placement.compact: the round face at every width', w.classList.contains('rvc-compact'));
    check('K.1 zIndex: --rvc-z-launcher / --rvc-z-panel', w.style['--rvc-z-launcher'] === '66' && w.style['--rvc-z-panel'] === '72');
    check('K.1 wrapAttrs: data-* and aria-* only (data-keep-selection keeps the editor\'s selection)', w.getAttribute('data-keep-selection') === '' && w.getAttribute('aria-label') === 'ETB2B AI' &&
      w.getAttribute('onclick') === null && w.getAttribute('style') === null && w.getAttribute('data-x"y') === null);
    var e2 = setup();
    var m2 = mountChat(e2, { placement: { right: 'calc(1px)', bottom: -5, compact: 'yes' }, zIndex: { launcher: 'x', panel: 1.5 } });
    check('K.1 nothing odd is taken: no corner, no layers, no compact', m2.wrap.style['--rvc-right'] === undefined && m2.wrap.style['--rvc-bottom'] === undefined &&
      !m2.wrap.classList.contains('rvc-compact') && m2.wrap.style['--rvc-z-launcher'] === undefined && m2.wrap.style['--rvc-z-panel'] === undefined);
    var e3 = setup();
    var m3 = mountChat(e3);
    check('K.1 by default the wrap sets nothing (the stylesheet\'s corner, 22 / 22, and layers, 65 / 69)', Object.keys(m3.wrap.style).length === 0 && m3.wrap.getAttribute('data-rvc') === 'dash');
  })();

  /* ======== K.2 keepClear: the launcher never covers a page's own bar ======== */
  await (async function () {
    /* Create Event's footer at 1440×900: [0,857,1440×43] → the launcher stands 51px up (29 of lift) */
    var e = setup({ vw: 1440, vh: 900 });
    var foot = e.doc.createElement('div');
    foot.setAttribute('id', 'wiz-foot');
    foot._rect = R(0, 857, 1440, 43);
    e.doc.body.appendChild(foot);
    var mm = mountChat(e, { keepClear: '#wiz-foot' });
    mm.$('launcher')._rect = R(1248, 834, 170, 44);   // x vw−192…vw−22, y vh−66…vh−22
    check('K.2 nothing is measured before the next frame', mm.chat.lift() === 0);
    e.clock.advance(16);
    check('K.2 Create Event 1440×900: lift 29 → launcher bottom 51px (footer + 8)', mm.chat.lift() === 29 && mm.wrap.style['--rvc-lift'] === '29px', mm.chat.lift());
    var scrollL = e.winLs.filter(function (l) { return l.type === 'scroll'; })[0];
    check('K.2 a scroll anywhere (capture, passive) and a resize measure again', !!scrollL && scrollL.o && scrollL.o.capture === true && scrollL.o.passive === true &&
      e.winLs.some(function (l) { return l.type === 'resize'; }));
    var mo = e.mos[0];
    check('K.2 a change to the page (class, hidden, style, nodes) measures again', e.mos.length === 1 && mo.target === e.doc.body && mo.o.subtree === true && mo.o.childList === true &&
      mo.o.attributes === true && JSON.stringify(mo.o.attributeFilter) === JSON.stringify(['class', 'hidden', 'style']));
    /* the footer goes (a step without it): the lift goes back to 0 in one frame, however many changes came */
    foot.hidden = true;
    var before = e.doc.qsaCalls;
    mo.cb([{ target: foot }]); mo.cb([{ target: foot }]); scrollL.fn(); mo.cb([{ target: e.doc.body }]);
    e.clock.advance(16);
    check('K.2 many changes in one frame: measured once', e.doc.qsaCalls - before === 1, e.doc.qsaCalls - before);
    check('K.2 a hidden bar is not in the way: lift 0', mm.chat.lift() === 0 && mm.wrap.style['--rvc-lift'] === '0px');
    foot.hidden = false;
    before = e.doc.qsaCalls;
    mo.cb([{ target: mm.$('thread') }, { target: mm.wrap }]);
    e.clock.advance(16);
    check('K.2 the kit\'s own changes are not the page\'s: nothing measured', e.doc.qsaCalls === before);
    mm.chat.relayout();
    check('K.2 relayout() measures at once', mm.chat.lift() === 29);
    foot._vis = 'hidden';
    check('K.2 a bar with visibility:hidden is not in the way', mm.chat.relayout() === 0);
    foot._vis = undefined;
    /* 1280×720: footer [0,677,1280×43] */
    e.win.innerWidth = 1280; e.win.innerHeight = 720;
    foot._rect = R(0, 677, 1280, 43);
    mm.$('launcher')._rect = R(1088, 654, 170, 44);
    check('K.2 Create Event 1280×720: lift 29 → 51px', mm.chat.relayout() === 29);
    e.win.innerWidth = 1440; e.win.innerHeight = 900;
    mm.$('launcher')._rect = R(1248, 834, 170, 44);
    /* beside the launcher's column, well above it, below the window */
    foot._rect = R(0, 857, 1000, 43);
    check('K.2 a bar beside the launcher\'s column does not lift it', mm.chat.relayout() === 0);
    foot._rect = R(1100, 600, 340, 40);
    check('K.2 a bar well above the launcher (more than 40px) does not lift it', mm.chat.relayout() === 0);
    foot._rect = R(1100, 760, 340, 40);
    check('K.2 a toolbar within 40px above the launcher lifts it clear (900 − 760 + 8 − 22 = 126)', mm.chat.relayout() === 126);
    foot._rect = R(0, 900, 1440, 43);
    check('K.2 a bar below the window does not lift it', mm.chat.relayout() === 0);
    foot._rect = R(1200, 100, 240, 800);
    check('K.2 the lift is capped at 45 % of the window (405 of 900)', mm.chat.relayout() === 405);
    /* the console's save bar: Save changes [1298,859,106×27] in a bar from 849 */
    var e2 = setup({ vw: 1440, vh: 900 });
    var bar2 = e2.doc.createElement('div');
    bar2.className = 'savebar';
    bar2._rect = R(300, 849, 1140, 35);
    e2.doc.body.appendChild(bar2);
    var m2 = mountChat(e2, { keepClear: '.savebar.on' });
    m2.$('launcher')._rect = R(1248, 834, 170, 44);
    e2.clock.advance(16);
    check('K.2 console: the save bar without .on (not shown) does not lift it', m2.chat.lift() === 0);
    bar2.classList.add('on');
    e2.mos[0].cb([{ target: bar2 }]);
    e2.clock.advance(16);
    check('K.2 console: .savebar.on shows → lift 37 → launcher bottom 59px, clear of Save and Discard', m2.chat.lift() === 37);
    /* a phone: 390×844, footer [0,787,390×57] → the round launcher 65px up */
    var e3 = setup({ phone: true, vw: 390, vh: 844 });
    var f3 = e3.doc.createElement('div');
    f3.setAttribute('id', 'wiz-foot');
    f3._rect = R(0, 787, 390, 57);
    e3.doc.body.appendChild(f3);
    var m3 = mountChat(e3, { keepClear: '#wiz-foot' });
    m3.$('launcher')._rect = R(322, 776, 52, 52);
    e3.clock.advance(16);
    check('K.2 phone 390×844: lift 49 → launcher bottom 65px (footer + 8)', m3.chat.lift() === 49, m3.chat.lift());
    m3.$('launcher')._rect = ZERO;                        // drawn under the sheet, or not yet laid out
    check('K.2 … the same from the corner\'s known place when the launcher has no box', m3.chat.relayout() === 49);
    /* several selectors, the kit's own elements never count, a bad selector is reported and ignored */
    var e4 = setup({ vw: 1440, vh: 900 });
    var m4 = mountChat(e4, { keepClear: '.rvc-launcher, .rvc-panel' });
    m4.$('launcher')._rect = R(1248, 834, 170, 44);
    check('K.2 the kit\'s own elements are never a bar to keep clear of', m4.chat.relayout() === 0);
    var e5 = setup({ vw: 1440, vh: 900 });
    var m5 = mountChat(e5, { keepClear: '###' });
    e5.clock.advance(16);
    check('K.2 a selector the browser refuses: reported once, ignored, the chat works', m5.chat.lift() === 0 && e5.errors.length === 1 && m5.chat.relayout() === 0 && e5.errors.length === 1);
    var e6 = setup();
    var m6 = mountChat(e6);
    e6.clock.advance(16);
    check('K.2 no keepClear: no observer, no scroll listener, never lifted', e6.mos.length === 0 && e6.winLs.length === 0 && m6.chat.relayout() === 0 && m6.wrap.style['--rvc-lift'] === undefined);
    var e7 = setup({ vw: 1440, vh: 900 });
    var toolbar = e7.doc.createElement('div');
    toolbar.className = 'tpl-sel-toolbar';
    toolbar._rect = R(1150, 780, 280, 40);
    e7.doc.body.appendChild(toolbar);
    var m7 = mountChat(e7, { keepClear: '.tpl-sel-toolbar:not([hidden]), .tpl-sec-toolbar:not([hidden]), .tpl-pop:not([hidden])' });
    m7.$('launcher')._rect = R(1248, 834, 170, 44);
    check('K.2 editor: a floating toolbar near the corner lifts it (the plan\'s :not([hidden]) list)', m7.chat.relayout() === 900 - 780 + 8 - 22);
    toolbar.setAttribute('hidden', '');
    check('K.2 editor: … a hidden toolbar does not', m7.chat.relayout() === 0);
  })();

  /* ======== K.3 the editor's docked column ======== */
  await (async function () {
    var e = setup({ wide: true });
    var html = e.doc.documentElement, log = [];
    var mm = mountChat(e, { dock: { minWidth: 1100, top: 56 },
      onDockChange: function (d) { log.push('dock:' + d + ':' + html.classList.contains('rvc-docked')); },
      onOpenChange: function (v) { log.push('open:' + v + ':' + html.classList.contains('rvc-docked')); } });
    check('K.3 it asks for (min-width: 1100px) and sets the column\'s top', !!e.mqs['(min-width: 1100px)'] && mm.wrap.style['--rvc-dock-top'] === '56px');
    check('K.3 shut: not docked', mm.chat.isDocked() === false && !html.classList.contains('rvc-docked'));
    mm.chat.open();
    check('K.3 open at ≥1100px: docked; html.rvc-docked is set before onDockChange and onOpenChange run (the page refits then)',
      mm.chat.isDocked() === true && mm.wrap.classList.contains('rvc-is-docked') && JSON.stringify(log) === JSON.stringify(['dock:true:true', 'open:true:true']), log);
    check('K.3 docked: not modal', mm.$('panel').getAttribute('aria-modal') === 'false');
    log.length = 0;
    mm.chat.close();
    check('K.3 close: undocked, the page gets its room back', !mm.chat.isDocked() && !html.classList.contains('rvc-docked') && !mm.wrap.classList.contains('rvc-is-docked') &&
      JSON.stringify(log) === JSON.stringify(['dock:false:false', 'open:false:false']), log);
    mm.chat.open();
    mm.chat.setDock(false);
    check('K.3 setDock(false) while open: it floats, still open', !mm.chat.isDocked() && mm.chat.isOpen() && !html.classList.contains('rvc-docked'));
    mm.chat.setDock(true);
    check('K.3 setDock(true): docked again', mm.chat.isDocked() && html.classList.contains('rvc-docked'));
    e.setMq('(min-width: 1100px)', false);
    check('K.3 narrower than 1100px: it floats', !mm.chat.isDocked() && !html.classList.contains('rvc-docked'));
    e.setMq('(min-width: 1100px)', true);
    check('K.3 wide again: docked', mm.chat.isDocked());
    mm.chat.fold('Changed “Hero”', function () {});
    check('K.3 a fold undocks (the bar floats at the corner)', !mm.chat.isDocked() && !html.classList.contains('rvc-docked'));
    mm.chat.open();
    e.setMq(PHONE_Q, true);
    check('K.3 a phone never docks', !mm.chat.isDocked());
    var e2 = setup({ wide: true });
    var m2 = mountChat(e2);
    m2.chat.open(); m2.chat.setDock(true);
    check('K.3 without opts.dock, setDock(true) does nothing', !m2.chat.isDocked() && !e2.doc.documentElement.classList.contains('rvc-docked') && !e2.mqs['(min-width: 1100px)']);
    var e3 = setup({ wide: true });
    var m3 = mountChat(e3, { dock: { top: 'calc(10px)' } });
    var e4 = setup({ wide: true });
    var m4 = mountChat(e4, { dock: { minWidth: 1200, top: '3.5rem' } });
    check('K.3 the column\'s top: a length or 0px; minWidth from the page', m3.wrap.style['--rvc-dock-top'] === '0px' && m4.wrap.style['--rvc-dock-top'] === '3.5rem' && !!e4.mqs['(min-width: 1200px)']);
    var e5 = setup({ wide: true });
    var m5 = mountChat(e5, { dock: {}, startOpen: true });
    check('K.3 startOpen with a dock opens docked', m5.chat.isDocked() && e5.doc.documentElement.classList.contains('rvc-docked'));
  })();

  /* ======== K.4 the half sheet, and a page's own phone width ======== */
  await (async function () {
    var vv = { height: 500, offsetTop: 0, _ls: {}, addEventListener: function (t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); } };
    var e = setup({ phone: true, vh: 844, vv: vv });
    var mm = mountChat(e, { phoneSheet: 'half', phoneQuery: '(max-width: 720px)' });
    var html = e.doc.documentElement, panel = mm.$('panel');
    check('K.4 the page\'s phone width is the one asked (the editor\'s 720px), not 600px', !!e.mqs['(max-width: 720px)'] && !e.mqs[PHONE_Q]);
    mm.chat.open();
    check('K.4 half sheet: rvc-phone and rvc-half, not modal, the page not locked', mm.wrap.classList.contains('rvc-phone') && mm.wrap.classList.contains('rvc-half') &&
      panel.getAttribute('aria-modal') === 'false' && !html.classList.contains('rvc-lock'));
    check('K.4 half sheet: it stands on the keyboard (--rvc-vb = 844 − 0 − 500)', panel.style['--rvc-vb'] === '344px' && panel.classList.contains('rvc-has-vv'));
    mm.$('send').focus();
    check('K.4 half sheet: Tab is not trapped (the page above is usable)', !key(mm.$('send'), 'Tab').defaultPrevented);
    mm.chat.setPhoneSheet('full');
    check('K.4 setPhoneSheet(\'full\'): modal and locked', panel.getAttribute('aria-modal') === 'true' && html.classList.contains('rvc-lock') && !mm.wrap.classList.contains('rvc-half'));
    mm.chat.setPhoneSheet('half');
    check('K.4 setPhoneSheet(\'half\'): free again', panel.getAttribute('aria-modal') === 'false' && !html.classList.contains('rvc-lock'));
    var e2 = setup({ phone: true });
    mountChat(e2, { phoneQuery: 'screen and (orientation: portrait)' });
    check('K.4 a query that is not a plain width is not taken (the default 600px is used)', !!e2.mqs[PHONE_Q] && Object.keys(e2.mqs).length === 1);
  })();

  /* ======== K.5 the scope line: whose conversation this is ======== */
  (function () {
    var e = setup();
    var mm = mountChat(e, { scope: 'Your events' });
    var sc = mm.$('scope'), sep = byClass(mm.$('panel'), 'rvc-scope-sep')[0];
    check('K.5 opts.scope: shown beside the status, as text', sc.textContent === 'Your events' && sc.hidden === false && sep.hidden === false && sc.getAttribute('title') === 'Your events' &&
      sc.parentNode === mm.$('status').parentNode);
    mm.chat.setScope('This event: <b>Agentic AI Summit 2027</b>');
    check('K.5 setScope: replaced, as text', sc.textContent === 'This event: <b>Agentic AI Summit 2027</b>' && byTag(sc, 'b').length === 0);
    check('K.5 the status keeps role=status and its own words', mm.$('status').getAttribute('role') === 'status' && mm.$('status').textContent === 'Ready');
    mm.chat.setScope('');
    check('K.5 setScope(\'\'): hidden', sc.hidden === true && sep.hidden === true);
  })();

  /* ======== K.6 attachments: the attach button, paste, drop, chips, and what send gets ======== */
  await (async function () {
    var e = setup();
    var adds = [], removed = [];
    var ATT = { accept: 'image/png,image/jpeg,application/pdf,.txt', max: 3, numbered: true, label: 'Attach a picture or a PDF', hint: 'I use a PDF brief and the logo to start a new event.',
      add: function (file) { return new Promise(function (ok, no) { adds.push({ file: file, ok: ok, no: no }); }); },
      remove: function (rec) { removed.push(rec); } };
    var mm = mountChat(e, { attach: ATT });
    mm.chat.open();
    var compose = byClass(mm.$('panel'), 'rvc-compose')[0], ab = mm.$('attach'), fi = mm.$('file');
    check('K.6 a paper-clip button left of the box, named by the page\'s label', !!ab && ab.localName === 'button' && ab.getAttribute('type') === 'button' &&
      ab.getAttribute('aria-label') === 'Attach a picture or a PDF' && compose.children.indexOf(ab) < compose.children.indexOf(mm.$('input')) && compose.classList.contains('has-attach'));
    check('K.6 … its title says what attachments are for here', ab.getAttribute('title') === ATT.hint);
    check('K.6 a hidden file input: several files, the page\'s types, out of the Tab order', fi.localName === 'input' && fi.getAttribute('type') === 'file' && fi.hasAttribute('multiple') &&
      fi.getAttribute('accept') === ATT.accept && fi.getAttribute('tabindex') === '-1' && fi.getAttribute('aria-hidden') === 'true');
    ab.click();
    check('K.6 the button opens the file picker', fi._clicks === 1);
    fi.files = [fileOf('photo.jpg', 2000, 'image/jpeg'), fileOf('deck.docx', 0, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')];
    dispatch(fi, new Ev('change'));
    check('K.6 the page\'s add() is called once per file', adds.length === 2 && adds[0].file.name === 'photo.jpg' && adds[1].file.name === 'deck.docx');
    check('K.6 the input is emptied, so the same file can be chosen again', fi.value === '');
    var tray = mm.$('tray'), chipEls = byClass(tray, 'rvc-achip');
    check('K.6 chips show at once, "Adding…", with the tray\'s hint', tray.hidden === false && chipEls.length === 2 && chipEls.every(function (c) { return c.classList.contains('is-adding'); }) &&
      byClass(chipEls[0], 'rvc-achip-state')[0].textContent === 'Adding…' && byClass(tray, 'rvc-tray-hint')[0].textContent === ATT.hint && byClass(tray, 'rvc-tray-hint')[0].hidden === false);
    check('K.6 the chips are a named list', byClass(tray, 'rvc-chips')[0].getAttribute('role') === 'list' && byClass(tray, 'rvc-chips')[0].getAttribute('aria-label') === 'Attachments' &&
      chipEls[0].getAttribute('role') === 'listitem');
    var REC1 = { id: 'a1', name: 'photo.jpg', kind: 'image', thumb: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', size: 2000 };
    adds[0].ok(REC1);
    adds[1].no(new Error('Create Event reads PDFs and plain text. Save the Word file as a PDF and attach it again.'));
    await settle();
    chipEls = byClass(tray, 'rvc-achip');
    var img = byTag(chipEls[0], 'img')[0];
    check('K.6 ready: the thumbnail, numbered 1, its name; nothing visible but the name', chipEls[0].classList.contains('is-ready') && img && img.getAttribute('src') === REC1.thumb && img.getAttribute('alt') === '' &&
      byClass(chipEls[0], 'rvc-achip-num')[0].textContent === '1' && byClass(chipEls[0], 'rvc-achip-num')[0].hidden === false &&
      byClass(chipEls[0], 'rvc-achip-name')[0].textContent === 'photo.jpg');
    check('K.6 … and screen readers hear it is attached', byClass(chipEls[0], 'rvc-achip-state')[0].textContent === ', attached');
    check('K.6 refused: an error chip with the page\'s sentence, not numbered', chipEls[1].classList.contains('is-error') &&
      byClass(chipEls[1], 'rvc-achip-state')[0].textContent === 'Create Event reads PDFs and plain text. Save the Word file as a PDF and attach it again.' &&
      byClass(chipEls[1], 'rvc-achip-num')[0].hidden === true && byTag(chipEls[1], 'img').length === 0 && byClass(chipEls[1], 'rvc-doc-ico').length === 1);
    e.clock.advance(60);
    check('K.6 said to screen readers', e.doc.getElementById('dash-chat-live').textContent === 'deck.docx could not be attached: Create Event reads PDFs and plain text. Save the Word file as a PDF and attach it again.');
    check('K.6 × has a name: "Remove <file>"', byClass(chipEls[0], 'rvc-achip-rm')[0].getAttribute('aria-label') === 'Remove photo.jpg' && byClass(chipEls[1], 'rvc-achip-rm')[0].getAttribute('aria-label') === 'Remove deck.docx');
    check('K.6 attachments() gives only the ready ones', JSON.stringify(mm.chat.attachments()) === JSON.stringify([REC1]));
    /* × on an error chip takes it away; the page's remove() is only for something it gave */
    byClass(chipEls[1], 'rvc-achip-rm')[0].click();
    chipEls = byClass(tray, 'rvc-achip');
    check('K.6 × takes an error chip away; the page\'s remove() is not called for it', chipEls.length === 1 && removed.length === 0);
    e.clock.advance(60);
    check('K.6 … and says so', e.doc.getElementById('dash-chat-live').textContent === 'deck.docx removed.');
    /* the limit: 3 (one is ready), so two more go to add() and the third gets a chip that says why */
    fi.files = [fileOf('b.png'), fileOf('c.png'), fileOf('d.png')];
    dispatch(fi, new Ev('change'));
    chipEls = byClass(tray, 'rvc-achip');
    check('K.6 past the limit: the files that fit go to add(), one chip says "Up to 3 files per message."', adds.length === 4 && chipEls.length === 4 &&
      byClass(chipEls[3], 'rvc-achip-name')[0].textContent === 'd.png' && byClass(chipEls[3], 'rvc-achip-state')[0].textContent === 'Up to 3 files per message.' &&
      chipEls[3].classList.contains('is-error'));
    fi.files = [fileOf('e.png'), fileOf('f.png')];
    dispatch(fi, new Ev('change'));
    chipEls = byClass(tray, 'rvc-achip');
    check('K.6 … an error chip does not count; several over: one chip names how many', adds.length === 4 && chipEls.length === 5 &&
      byClass(chipEls[4], 'rvc-achip-name')[0].textContent === '2 files' && byClass(chipEls[4], 'rvc-achip-state')[0].textContent === 'Up to 3 files per message.');
    byClass(chipEls[4], 'rvc-achip-rm')[0].click();
    byClass(chipEls[3], 'rvc-achip-rm')[0].click();
    chipEls = byClass(tray, 'rvc-achip');
    check('K.6 (the two error chips are gone: photo, b, c)', chipEls.length === 3 && removed.length === 0);
    /* removed while it was still being added: no chip when it arrives, and the page may let it go */
    var bRm = byClass(chipEls[1], 'rvc-achip-rm')[0];
    bRm.focus();
    bRm.click();
    check('K.6 the focus moves on to the next ×, not lost', e.doc.activeElement === byClass(byClass(tray, 'rvc-achip')[1], 'rvc-achip-rm')[0]);
    adds[2].ok({ id: 'b', name: 'b.png', kind: 'image', thumb: 'data:image/png;base64,iVBORw0KGgo=' });
    await settle();
    chipEls = byClass(tray, 'rvc-achip');
    check('K.6 one removed while it was being added: no chip when it arrives, and the page hears of it (remove)', chipEls.length === 2 && removed.length === 1 && removed[0].id === 'b');
    adds[3].ok({ id: 'c', name: 'brief.pdf', kind: 'doc', size: 50000 });
    await settle();
    chipEls = byClass(tray, 'rvc-achip');
    check('K.6 a document is a chip with a document icon and its name, numbered after the picture', chipEls.length === 2 && byClass(chipEls[1], 'rvc-achip-name')[0].textContent === 'brief.pdf' &&
      byClass(chipEls[1], 'rvc-doc-ico').length === 1 && byTag(chipEls[1], 'img').length === 0 && byClass(tray, 'rvc-achip-num').map(function (x) { return x.textContent; }).join() === '1,2');
    byClass(chipEls[0], 'rvc-achip-rm')[0].click();
    check('K.6 × on a ready chip: gone, the page\'s remove() hears of it, the rest renumbered', removed.length === 2 && removed[1] === REC1 &&
      byClass(tray, 'rvc-achip-num').filter(function (x) { return !x.hidden; }).map(function (x) { return x.textContent; }).join() === '1');
    /* send with words: the ready ones go with the message, and leave the tray */
    mm.chat.clearAttachments();
    check('K.6 clearAttachments(): the tray is empty and hidden (the page\'s remove() is not called)', tray.hidden === true && byClass(tray, 'rvc-achip').length === 0 && removed.length === 2);
    var REC2 = { id: 'p2', name: 'brief.pdf', kind: 'doc', size: 50000 };
    check('K.6 addAttachment(rec): a ready chip (the editor\'s "Use this picture")', mm.chat.addAttachment(REC1) === true && mm.chat.addAttachment(REC2) === true && byClass(tray, 'rvc-achip').length === 2);
    check('K.6 … the same one again is not doubled', mm.chat.addAttachment({ id: 'a1', name: 'photo.jpg' }) === true && byClass(tray, 'rvc-achip').length === 2);
    check('K.6 … numbered in order: 1 and 2', byClass(tray, 'rvc-achip-num').map(function (x) { return x.textContent; }).join() === '1,2');
    /* no words with an attachment */
    type(mm, '');
    key(mm.$('input'), 'Enter');
    await settle();
    var note = mm.$('note');
    check('K.6 Send with no words but attachments: nothing sent, a line says what to do', mm.log.sent.length === 0 && note.hidden === false &&
      note.textContent === 'Say what the attachment is for, for example “use this as the logo”.' && mm.$('input').getAttribute('aria-describedby') === 'dash-chat-note');
    type(mm, 'S');
    check('K.6 … typing clears that line', note.hidden === true);
    type(mm, 'Start a new event with this brief and logo');
    key(mm.$('input'), 'Enter');
    await settle();
    check('K.6 send gets the ready attachments, in order, and no context', mm.log.sent.length === 1 && mm.log.sentOpts[0].attachments.length === 2 &&
      mm.log.sentOpts[0].attachments[0] === REC1 && mm.log.sentOpts[0].attachments[1] === REC2 && mm.log.sentOpts[0].context === null);
    check('K.6 the tray is empty once they are sent', tray.hidden === true && mm.chat.attachments().length === 0);
    var ub = turns(mm).pop();
    var sentImg = byTag(ub, 'img')[0];
    check('K.6 the person\'s bubble shows the thumbnail (named) and the document\'s name, numbered', sentImg && sentImg.getAttribute('src') === REC1.thumb && sentImg.getAttribute('alt') === 'photo.jpg' &&
      byClass(ub, 'rvc-sent-name')[0].textContent === 'brief.pdf' && byClass(ub, 'rvc-sent-num').map(function (x) { return x.textContent; }).join() === '1,2');
    check('K.6 … the words are still the words', byClass(ub, 'rvc-msg-words')[0].textContent === 'Start a new event with this brief and logo');
    /* a failure puts them back, first, with the words */
    mm.pending[0].no(new Error('ETB2B AI is busy right now. Nothing was changed. Try again in a minute.'));
    await settle();
    check('K.6 a failure: the attachments are back in the tray, ready, and the words in the box', JSON.stringify(mm.chat.attachments()) === JSON.stringify([REC1, REC2]) &&
      mm.$('input').value === 'Start a new event with this brief and logo');
    var errB = turns(mm).pop();
    btnIn(errB, 'Try again').click();
    await settle();
    check('K.6 Try again sends them again, with the same bubble', mm.log.sent.length === 2 && mm.log.sentOpts[1].attachments.length === 2 && mm.chat.attachments().length === 0 &&
      turns(mm).filter(function (t) { return t.classList.contains('rvc-user'); }).length === 1 && byClass(turns(mm).pop(), 'rvc-sent-item').length === 2);
    mm.pending[1].ok();
    await settle();
    /* an attachment still being added holds Send */
    fi.files = [fileOf('late.png')];
    dispatch(fi, new Ev('change'));
    type(mm, 'Use this as the logo');
    key(mm.$('input'), 'Enter');
    await settle();
    check('K.6 Send while one is still being added: not sent, the line says so', mm.log.sent.length === 2 && note.hidden === false &&
      note.textContent === 'An attachment is still being added. Send again in a moment.' && mm.$('input').value === 'Use this as the logo');
    adds[adds.length - 1].ok({ id: 'late', name: 'late.png', kind: 'image', thumb: 'data:image/png;base64,iVBORw0KGgo=' });
    await settle();
    key(mm.$('input'), 'Enter');
    await settle();
    check('K.6 … and goes once it is ready', mm.log.sent.length === 3 && mm.log.sentOpts[2].attachments[0].id === 'late');
    mm.pending[2].ok(); await settle();
    /* full: addAttachment says no */
    mm.chat.addAttachment({ id: 'x1', name: 'x1' }); mm.chat.addAttachment({ id: 'x2', name: 'x2' }); mm.chat.addAttachment({ id: 'x3', name: 'x3' });
    check('K.6 addAttachment when the tray is full: false', mm.chat.addAttachment({ id: 'x4', name: 'x4' }) === false && mm.chat.attachments().length === 3);
    mm.chat.clearAttachments();
  })();
  await (async function () {
    /* paste and drop */
    var e = setup();
    var adds = [];
    var mm = mountChat(e, { attach: { add: function (f) { adds.push(f); return Promise.resolve({ id: f.name, name: f.name, kind: 'image', thumb: 'data:image/png;base64,iVBORw0KGgo=' }); } } });
    mm.chat.open();
    var input = mm.$('input');
    var pv = new Ev('paste', { clipboardData: { files: [fileOf('shot.png')], items: [] } });
    dispatch(input, pv);
    check('K.6 paste of a picture into the box attaches it (and does not paste its name)', adds.length === 1 && adds[0].name === 'shot.png' && pv.defaultPrevented);
    var pi = new Ev('paste', { clipboardData: { files: [], items: [{ kind: 'string' }, { kind: 'file', getAsFile: function () { return fileOf('clip.png'); } }] } });
    dispatch(input, pi);
    check('K.6 … from the clipboard\'s items too', adds.length === 2 && adds[1].name === 'clip.png' && pi.defaultPrevented);
    var pt = new Ev('paste', { clipboardData: { files: [], items: [{ kind: 'string' }] } });
    dispatch(input, pt);
    check('K.6 paste of words is left to the box', adds.length === 2 && !pt.defaultPrevented);
    var panel = mm.$('panel'), drop = byClass(panel, 'rvc-drop')[0], th = mm.$('thread');
    check('K.6 the drop overlay is there, hidden, out of the screen reader\'s way', !!drop && drop.hidden === true && drop.getAttribute('aria-hidden') === 'true' &&
      byClass(drop, 'rvc-drop-h')[0].textContent === 'Drop to attach');
    var de = new Ev('dragenter', { dataTransfer: { types: ['text/plain'] } });
    dispatch(th, de);
    check('K.6 dragging words over the panel: ignored', drop.hidden === true && !de.defaultPrevented);
    var d1 = new Ev('dragenter', { dataTransfer: { types: ['Files'] } }), d2 = new Ev('dragenter', { dataTransfer: { types: ['Files'] } });
    dispatch(th, d1); dispatch(input, d2);
    check('K.6 dragging a file over the panel: "Drop to attach"', drop.hidden === false && d1.defaultPrevented && panel.classList.contains('is-dropping'));
    var dov = new Ev('dragover', { dataTransfer: { types: ['Files'], dropEffect: 'none' } });
    dispatch(th, dov);
    check('K.6 dragover is accepted as a copy', dov.defaultPrevented && dov.dataTransfer.dropEffect === 'copy');
    dispatch(th, new Ev('dragleave', { dataTransfer: { types: ['Files'] } }));
    check('K.6 leaving one inner part keeps it (entered twice)', drop.hidden === false);
    dispatch(input, new Ev('dragleave', { dataTransfer: { types: ['Files'] } }));
    check('K.6 leaving the panel hides it', drop.hidden === true);
    dispatch(th, new Ev('dragenter', { dataTransfer: { types: ['Files'] } }));
    var dr = new Ev('drop', { dataTransfer: { types: ['Files'], files: [fileOf('dropped.jpg')] } });
    dispatch(th, dr);
    check('K.6 a drop attaches the file and hides the overlay', adds.length === 3 && adds[2].name === 'dropped.jpg' && dr.defaultPrevented && drop.hidden === true);
    dispatch(th, new Ev('dragenter', { dataTransfer: { types: ['Files'] } }));
    key(input, 'Escape');
    check('K.6 Esc while dragging hides the overlay and keeps the panel open', drop.hidden === true && mm.chat.isOpen());
    await settle();
    check('K.6 default label and limit (4)', mm.$('attach').getAttribute('aria-label') === 'Attach a file' && mm.$('file').getAttribute('accept') === null);
    var e2 = setup();
    var m2 = mountChat(e2);
    var pv2 = new Ev('paste', { clipboardData: { files: [fileOf('shot.png')] } });
    dispatch(m2.$('input'), pv2);
    check('K.6 without attach, a pasted file is left alone', !pv2.defaultPrevented && m2.chat.addAttachment({ id: 'x', name: 'x' }) === false);
  })();
  await (async function () {
    /* what may be drawn: names are text, only safe picture addresses, a throwing add() */
    var e = setup();
    var mm = mountChat(e, { attach: { add: function (f) {
      if (f.name === 'throws.png') throw new Error('stub: add threw');
      if (f.name === 'nothing.png') return Promise.resolve(null);
      return Promise.resolve({ id: f.name, name: f.name + '<img src=x onerror=alert(1)>', kind: 'image', thumb: f.thumb });
    } } });
    mm.chat.open();
    var bad = ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'http://evil.example/x.png', 'https://evil.example/x.png" onerror="x', '//evil.example/x.png', 'blob:https://x.example/../a'];
    var files = bad.map(function (s, i) { var f = fileOf('f' + i + '.png'); f.thumb = s; return f; });
    var fi = mm.$('file');
    fi.files = files.slice(0, 4);
    dispatch(fi, new Ev('change'));
    await settle();
    var tray = mm.$('tray');
    check('K.6 a thumbnail address that is not a picture\'s (javascript:, SVG data, http:, quotes) is not drawn', byTag(tray, 'img').length === 0 && byClass(tray, 'rvc-doc-ico').length === 4);
    check('K.6 a file\'s name is text, never markup', byClass(tray, 'rvc-achip-name')[0].textContent === 'f0.png<img src=x onerror=alert(1)>' && byTag(tray, 'img').length === 0);
    mm.chat.clearAttachments();
    fi.files = files.slice(4);
    dispatch(fi, new Ev('change'));
    await settle();
    check('K.6 … nor another site\'s //address, nor a blob: address with a path in it', byTag(tray, 'img').length === 0 && byClass(tray, 'rvc-doc-ico').length === 2);
    mm.chat.clearAttachments();
    var okAddr = ['data:image/png;base64,iVBORw0KGgo=', 'blob:https://oneworld.example/5f2b8c1e-0d1a-4c7b-9d1e-2f3a4b5c6d7e', 'https://firebasestorage.googleapis.com/v0/b/x/o/a.png?alt=media', '/media/a.png'];
    fi.files = okAddr.map(function (s, i) { var f = fileOf('ok' + i + '.png'); f.thumb = s; return f; });
    dispatch(fi, new Ev('change'));
    await settle();
    check('K.6 picture data, blob:, https: and our own paths are drawn', byTag(tray, 'img').map(function (x) { return x.getAttribute('src'); }).join('|') === okAddr.join('|'));
    mm.chat.clearAttachments();
    fi.files = [fileOf('throws.png'), fileOf('nothing.png')];
    dispatch(fi, new Ev('change'));
    await settle();
    var ch = byClass(tray, 'rvc-achip');
    check('K.6 an add() that throws, or gives nothing, is an error chip', ch.length === 2 && ch.every(function (c) { return c.classList.contains('is-error'); }) &&
      byClass(ch[0], 'rvc-achip-state')[0].textContent === 'stub: add threw' && byClass(ch[1], 'rvc-achip-state')[0].textContent === 'It could not be attached.');
    var wide = 'x'.repeat(400) + '\u0000\n.png';
    var long = e.RC.mount(e.host, { id: 'long', send: function () { return Promise.resolve(); }, attach: { add: function () { return Promise.resolve({ id: 'l', name: wide, kind: 'doc' }); } } });
    var lfi = e.doc.getElementById('long-chat-file');
    lfi.files = [fileOf('a')];
    dispatch(lfi, new Ev('change'));
    await settle();
    var lname = byClass(e.doc.getElementById('long-chat-tray'), 'rvc-achip-name')[0].textContent;
    check('K.6 a name is one line, at most 200 characters, with no control characters', lname.length === 200 && !/[\u0000-\u001F]/.test(lname) && !!long);
  })();

  /* ======== K.7 the context chip ("Selected: …") ======== */
  await (async function () {
    var e = setup();
    var cleared = 0;
    var mm = mountChat(e);
    mm.chat.open();
    var row = mm.$('context');
    check('K.7 hidden until set', row.hidden === true);
    mm.chat.setContext({ label: 'Why attend · “Six reasons…”', title: 'Why attend · “Six reasons to attend this year”', onClear: function () { cleared++; } });
    var txtEl = byClass(row, 'rvc-context-text')[0], rm = byClass(row, 'rvc-context-rm')[0];
    check('K.7 shown above the box: "Selected: <label>", the full words as its title', row.hidden === false && txtEl.textContent === 'Selected: Why attend · “Six reasons…”' &&
      txtEl.getAttribute('title') === 'Why attend · “Six reasons to attend this year”');
    check('K.7 its × is named', rm.localName === 'button' && rm.getAttribute('aria-label') === 'Remove “Why attend · “Six reasons…”” from the message');
    type(mm, 'Make this shorter');
    key(mm.$('input'), 'Enter');
    await settle();
    check('K.7 send gets {context: label}', mm.log.sentOpts[0].context === 'Why attend · “Six reasons…”');
    var ub = turns(mm).pop();
    check('K.7 the person\'s bubble shows "↳ label" above the words', byClass(ub, 'rvc-msg-ctx')[0].textContent === '↳ Why attend · “Six reasons…”' &&
      byClass(ub, 'rvc-msg')[0].firstChild === byClass(ub, 'rvc-msg-ctx')[0] && byClass(ub, 'rvc-msg-words')[0].textContent === 'Make this shorter');
    check('K.7 the chip stays (the section is still selected)', row.hidden === false);
    mm.pending[0].ok(); await settle();
    rm.click();
    check('K.7 × calls onClear once, hides the chip and puts the focus in the box', cleared === 1 && row.hidden === true && e.doc.activeElement === mm.$('input'));
    type(mm, 'Next'); key(mm.$('input'), 'Enter'); await settle();
    check('K.7 … the next message has no context', mm.log.sentOpts[1].context === null && byClass(turns(mm).pop(), 'rvc-msg-ctx').length === 0);
    mm.pending[1].ok(); await settle();
    mm.chat.setContext({ label: 'Hero', prefix: 'About: ' });
    check('K.7 a page may say it its own way (prefix)', byClass(row, 'rvc-context-text')[0].textContent === 'About: Hero');
    mm.chat.setContext(null);
    check('K.7 setContext(null) hides it', row.hidden === true);
    mm.chat.setContext({ label: '   ' });
    check('K.7 an empty label is no context', row.hidden === true);
    var rep = mm.chat.user('Older question', { at: OLD_AT, context: 'Agenda', attachments: [{ name: 'speaker.jpg', kind: 'image' }] });
    check('K.7 a replayed turn may carry its context and attachment names (no picture: the replay has none)', byClass(rep, 'rvc-msg-ctx')[0].textContent === '↳ Agenda' &&
      byClass(rep, 'rvc-sent-name')[0].textContent === 'speaker.jpg' && byTag(rep, 'img').length === 0);
  })();

  /* ======== K.8 an adapter's own nodes: slot(), custom(), text(), thread() ======== */
  (function () {
    var e = setup();
    var mm = mountChat(e);
    mm.chat.open();
    var bb = mm.chat.ai('Here is the change.');
    var s1 = bb.slot();
    check('K.8 slot(): an empty element inside the answer', s1.localName === 'div' && s1.classList.contains('rvc-slot') && bb.node.contains(s1) && s1.childNodes.length === 0);
    var cardEl = e.doc.createElement('div'); cardEl.className = 'ai-task'; cardEl.textContent = 'Change made';
    s1.appendChild(cardEl);
    var s2 = bb.slot();
    check('K.8 slots follow each other in the order asked', byClass(bb.node, 'rvc-extra')[0].children.indexOf(s2) === byClass(bb.node, 'rvc-extra')[0].children.indexOf(s1) + 1);
    var un = bb.undo(function () {});
    check('K.8 the kit\'s Undo still goes in the foot, after the slots', byClass(bb.node, 'rvc-foot')[0].contains(un));
    var node = e.doc.createElement('figure'); node.className = 'chat-made-pic';
    var cb2 = mm.chat.custom('ai', node);
    check('K.8 custom(\'ai\', node): a whole turn from ETB2B AI holding the node, with a bubble\'s calls', cb2.node.classList.contains('rvc-ai') && cb2.node.classList.contains('rvc-custom') &&
      cb2.node.contains(node) && typeof cb2.undo === 'function' && typeof cb2.slot === 'function' && turns(mm).pop() === cb2.node);
    var unode = e.doc.createElement('div'); unode.textContent = 'Use this picture';
    var ut2 = mm.chat.custom('user', unode);
    check('K.8 custom(\'user\', node): the person\'s turn', ut2.classList.contains('rvc-user') && ut2.classList.contains('rvc-custom') && ut2.contains(unode) && turns(mm).pop() === ut2);
    var past = mm.chat.custom('ai', e.doc.createElement('div'), { at: OLD_AT });
    check('K.8 custom with its own time shows it', byTag(past.node, 'time')[0].textContent === '2 Nov, 10:00');
    bb.text('**Done.** The hero now reads “Where retail meets tech”.');
    check('K.8 text(): the answer\'s words replaced (formatted)', byClass(bb.node, 'rvc-text')[0].textContent === 'Done. The hero now reads “Where retail meets tech”.' &&
      byTag(byClass(bb.node, 'rvc-text')[0], 'b')[0].textContent === 'Done.' && bb.node.contains(cardEl));
    check('K.8 thread() is the conversation\'s scroller', mm.chat.thread() === mm.$('thread'));
    mm.chat.close();
    mm.chat.custom('ai', e.doc.createElement('div'));
    check('K.8 a custom answer while shut is a new reply too', mm.$('launcher').classList.contains('has-new'));
  })();

  /* ======== K.9 readable answers: bold, lists, paragraphs (UX-096) ======== */
  (function () {
    var e = setup();
    var mm = mountChat(e);
    var ANSWER = '**Design (whole site):**\n- Theme colour: deep navy\n- Headings in capitals\n\nThe wording:\n1. Hero: “The Biggest” → “South India’s Biggest”\n2. Overview shortened\n\n## What next\nPress **Save** when you are happy.\nNothing goes live until you publish.';
    var bb = mm.chat.ai(ANSWER);
    var tb = byClass(bb.node, 'rvc-text')[0];
    var kids = tb.children.map(function (c) { return c.localName + (c.className ? '.' + c.className : ''); });
    check('K.9 the structure: a paragraph, a list, a paragraph, a numbered list, a heading, a paragraph', JSON.stringify(kids) === JSON.stringify(['p.rvc-fp', 'ul.rvc-fl', 'p.rvc-fp', 'ol.rvc-fl', 'p.rvc-fh', 'p.rvc-fp']), kids);
    check('K.9 no ** or list markers are left in the words', tb.textContent.indexOf('**') === -1 && tb.textContent.indexOf('- ') === -1 && tb.textContent.indexOf('1. ') === -1 && tb.textContent.indexOf('##') === -1);
    check('K.9 **x** is bold', byTag(tb, 'b').map(function (x) { return x.textContent; }).join('|') === 'Design (whole site):|What next|Save');
    check('K.9 the list items', byTag(byTag(tb, 'ul')[0], 'li').map(function (x) { return x.textContent; }).join('|') === 'Theme colour: deep navy|Headings in capitals' &&
      byTag(byTag(tb, 'ol')[0], 'li').length === 2 && byTag(tb, 'ol')[0].getAttribute('start') === null);
    check('K.9 a line break inside a paragraph is kept (pre-wrap shows it)', tb.children[5].textContent === 'Press Save when you are happy.\nNothing goes live until you publish.');
    var b2 = mm.chat.ai('3. third\n4. fourth');
    check('K.9 a numbered list keeps its first number', byTag(b2.node, 'ol')[0].getAttribute('start') === '3');
    var b3 = mm.chat.ai('A **bold** word, and a lone ** marker');
    check('K.9 a lone ** is dropped, not shown; a pair is bold', byClass(b3.node, 'rvc-text')[0].textContent === 'A bold word, and a lone  marker' &&
      byTag(b3.node, 'b').length === 1 && byTag(b3.node, 'b')[0].textContent === 'bold', byTag(b3.node, 'b').map(function (x) { return x.textContent; }));
    var b3b = mm.chat.ai('**one** and **two**');
    check('K.9 … two pairs, two bolds', byTag(b3b.node, 'b').map(function (x) { return x.textContent; }).join('|') === 'one|two');
    var b4 = mm.chat.ai('• one\n* two\n- three');
    check('K.9 "• ", "* " and "- " are all one list', byTag(b4.node, 'ul').length === 1 && byTag(b4.node, 'li').length === 3);
    var b5 = mm.chat.ai('**Total: 42**', { plain: true });
    check('K.9 plain:true draws the words as they are', byClass(b5.node, 'rvc-text')[0].textContent === '**Total: 42**' && byTag(b5.node, 'b').length === 0);
    var b5b = mm.chat.ai('First paragraph.\n\n\nSecond paragraph.\n  \nThird.');
    check('K.9 a blank line (or several, or one with spaces) starts a new paragraph', byClass(b5b.node, 'rvc-text')[0].children.map(function (x) { return x.textContent; }).join('|') === 'First paragraph.|Second paragraph.|Third.');
    var b5c = mm.chat.ai('1. one\n\n2. two');
    check('K.9 a numbered list split by a blank line keeps counting (start)', byTag(b5c.node, 'ol').length === 2 && byTag(b5c.node, 'ol')[1].getAttribute('start') === '2');
    var b6 = mm.chat.ai('Price: 2026. That was the year.');
    check('K.9 ordinary sentences are one paragraph', byClass(b6.node, 'rvc-text')[0].children.length === 1 && byTag(b6.node, 'ol').length === 0);
    var b7 = mm.chat.ai(42);
    check('K.9 a number is drawn as it is', byClass(b7.node, 'rvc-text')[0].textContent === '42');
    check('K.9 every node in an answer is one the kit built (p, ul, ol, li, b, text)', all(tb, function (x) { return ['div', 'p', 'ul', 'ol', 'li', 'b'].indexOf(x.localName) === -1; }).length === 0);
  })();

  /* ======== K.10 reveal: a long answer from its top, the card's Undo into view, history at the newest ======== */
  await (async function () {
    var e = setup();
    var mm = mountChat(e);
    mm.chat.open();
    var th = mm.$('thread');
    var layout = new Map();
    e.doc._layout = function (x) { return layout.get(x) || null; };
    th.clientHeight = 400; th.scrollHeight = 2000; th.scrollTop = 1600;
    var orig = th.appendChild;
    var nextBox = null;
    th.appendChild = function (c) { if (nextBox) { layout.set(c, nextBox); nextBox = null; th.scrollHeight += 900; } return orig.call(this, c); };
    nextBox = { top: 2000, h: 900 };
    var longB = mm.chat.ai('A long answer…');
    check('K.10 a new answer taller than the conversation is shown from its top (not its end)', th.scrollTop === 1992, th.scrollTop);
    longB.note('more');
    check('K.10 … and stays there while its card grows (the reader is mid-answer)', th.scrollTop === 1992);
    th.scrollTop = th.scrollHeight - 400;
    nextBox = { top: 2900, h: 120 };
    mm.chat.ai('Short.');
    check('K.10 a short answer: to the end, as before', th.scrollTop === th.scrollHeight);
    var foot = byClass(longB.node, 'rvc-foot')[0];
    layout.set(foot, { top: 2850, h: 40 });
    th.scrollTop = 1992;
    check('K.10 reveal(node): the card\'s foot (its Undo) is brought into view with the least scroll', mm.chat.reveal(foot) === true && th.scrollTop === 2850 + 40 - 400 + 8, th.scrollTop);
    layout.set(foot, { top: 100, h: 40 });
    mm.chat.reveal(foot);
    check('K.10 reveal of something above: scrolled up to it', th.scrollTop === 92);
    var stray = e.doc.createElement('div');
    check('K.10 reveal of a node outside the conversation does nothing', mm.chat.reveal(stray) === false && mm.chat.reveal(null) === false);
    th.clientHeight = 0;
    check('K.10 reveal while the panel is shut (no height) does nothing', mm.chat.reveal(foot) === false);
    th.appendChild = orig;
    e.doc._layout = null;
    /* the history replay ends at the newest turn (with its Undo) */
    var e2 = setup();
    var release;
    var m2 = mountChat(e2, { loadHistory: function () { return new Promise(function (ok) { release = ok; }); } });
    m2.chat.open();
    var t2 = m2.$('thread');
    t2.clientHeight = 400;
    m2.chat.divider('Earlier in this conversation');
    m2.chat.user('Old q', { at: OLD_AT });
    m2.chat.ai('Old a', { at: OLD_AT }).undo(function () {});
    t2.scrollHeight = 1592; t2.scrollTop = 0;
    release(); await settle();
    check('K.10 after the replay the conversation shows its newest turn (UX-096: not "Earlier…" at the top)', t2.scrollTop === 1592);
  })();

  /* ======== K.11 Stop (UX-097) ======== */
  await (async function () {
    var e = setup();
    var stops = 0;
    var mm = mountChat(e, { attach: { add: function (f) { return Promise.resolve({ id: f.name, name: f.name, kind: 'image', thumb: 'data:image/png;base64,iVBORw0KGgo=' }); } } });
    mm.chat.open();
    mm.chat.addAttachment({ id: 'p1', name: 'photo.jpg', kind: 'image', thumb: 'data:image/png;base64,iVBORw0KGgo=' });
    type(mm, 'Make the whole page look more premium');
    key(mm.$('input'), 'Enter');
    await settle();
    /* the adapter, inside send: it can stop waiting */
    mm.chat.setBusy(true, 'ETB2B AI is looking at your page (a few seconds)…', { onStop: function () { stops++; } });
    var stopB = mm.$('stop');
    check('K.11 Stop shows in the busy strip while the adapter offers it', stopB.hidden === false && byClass(mm.$('busy'), 'rvc-busy-text')[0].textContent === 'ETB2B AI is looking at your page (a few seconds)…');
    mm.chat.setBusy(true, 'Changing “Hero”…');
    check('K.11 setBusy(true, text) again keeps Stop', stopB.hidden === false);
    stopB.focus();
    stopB.click();
    check('K.11 Stop: onStop once, the box free, Ready', stops === 1 && mm.$('send').disabled === false && mm.$('input').readOnly === false && mm.$('status').textContent === 'Ready' &&
      mm.$('busy').hidden === true);
    var ub = turns(mm).filter(function (t) { return t.classList.contains('rvc-user'); }).pop();
    var nt = byClass(ub, 'rvc-failed-note')[0];
    check('K.11 the person\'s message says "Stopped", with Try again', ub.classList.contains('is-stopped') && nt && nt.classList.contains('is-stopped') &&
      nt.textContent === 'Stopped · Try again' && !!btnIn(ub, 'Try again'));
    check('K.11 the words and the attachment are back, the focus in the box', mm.$('input').value === 'Make the whole page look more premium' && mm.chat.attachments().length === 1 &&
      e.doc.activeElement === mm.$('input'));
    e.clock.advance(60);
    check('K.11 "Stopped." is said', e.doc.getElementById('dash-chat-live').textContent === 'Stopped.');
    /* the late answer: the kit leaves it alone, even after a new message has started */
    type(mm, 'How many registrations?');
    mm.chat.clearAttachments();
    key(mm.$('input'), 'Enter');
    await settle();
    check('K.11 a new message can be sent at once', mm.log.sent.length === 2 && mm.$('send').disabled === true);
    mm.pending[0].ok(); await settle();
    check('K.11 the stopped send settling does not unlock the new one', mm.$('send').disabled === true && mm.$('status').textContent === 'Thinking…');
    mm.pending[1].ok(); await settle();
    check('K.11 … the new one unlocks when its own answer is in', mm.$('send').disabled === false);
    /* a stopped send that fails later draws no error */
    type(mm, 'Rewrite everything');
    key(mm.$('input'), 'Enter'); await settle();
    mm.chat.setBusy(true, 'Thinking…', { onStop: function () { stops++; } });
    mm.$('stop').click();
    var errsBefore = turns(mm).filter(function (t) { return t.classList.contains('rvc-error'); }).length;
    mm.pending[2].no(new Error('ETB2B AI is busy right now.'));
    await settle();
    check('K.11 a stopped send that fails later draws no error bubble', turns(mm).filter(function (t) { return t.classList.contains('rvc-error'); }).length === errsBefore && stops === 2);
    /* Try again on the stopped message */
    var stoppedU = turns(mm).filter(function (t) { return t.classList.contains('is-stopped'); }).pop();
    btnIn(stoppedU, 'Try again').click();
    await settle();
    check('K.11 Try again re-sends the same words, in the same bubble, without the Stopped line', mm.log.sent[3] === 'Rewrite everything' &&
      !stoppedU.classList.contains('is-stopped') && byClass(stoppedU, 'rvc-failed-note').length === 0 && turns(mm).pop() === stoppedU);
    mm.pending[3].ok(); await settle();
    /* setBusy options */
    mm.chat.setBusy(true, 'x', { onStop: function () {} });
    mm.chat.setBusy(true, 'y', { onStop: null });
    check('K.11 {onStop:null} takes Stop away', mm.$('stop').hidden === true);
    mm.chat.setBusy(false);
    mm.chat.setBusy(true, 'z', {});
    check('K.11 a new busy spell starts without Stop', mm.$('stop').hidden === true);
    mm.chat.setBusy(false);
    var hadStops = stops;
    mm.chat.setBusy(true, 'outside a message', { onStop: function () { stops++; } });
    mm.$('stop').click();
    check('K.11 Stop with no message being answered: onStop, unlocked, nothing marked', stops === hadStops + 1 && mm.$('send').disabled === false);
  })();

  /* ======== K.12 quick ideas under the box (UX-095) ======== */
  await (async function () {
    var e = setup();
    var mm = mountChat(e, { quickIdeas: [
      { label: 'Shorten the overview', text: 'Shorten the overview to two sentences' },
      { label: 'New hero picture', text: 'Make a new hero picture of …' },
      { text: 'Only text' },
      { label: 'A fourth one', text: 'never shown' }
    ] });
    var q = mm.$('quick');
    check('K.12 hidden until the conversation has a turn', q.hidden === true && q.getAttribute('role') === 'group' && q.getAttribute('aria-label') === 'Quick ideas');
    check('K.12 at most three', byClass(q, 'rvc-quick-btn').map(function (x) { return x.textContent; }).join('|') === 'Shorten the overview|New hero picture|Only text');
    mm.chat.open();
    mm.chat.ai('Hello');
    check('K.12 shown once there is a turn', q.hidden === false);
    var qb = byClass(q, 'rvc-quick-btn');
    qb[1].click();
    check('K.12 a quick idea fills the box and selects its "…"; nothing is sent', mm.$('input').value === 'Make a new hero picture of …' &&
      mm.$('input').selectionStart === 'Make a new hero picture of '.length && mm.log.sent.length === 0 && e.doc.activeElement === mm.$('input'));
    key(mm.$('input'), 'Enter'); await settle();
    check('K.12 they stay after a turn (they do not vanish)', q.hidden === false && byClass(q, 'rvc-quick-btn').length === 3);
    qb[0].click();
    check('K.12 while thinking, a quick idea does not overwrite the box', mm.$('input').value === '');
    mm.pending[0].ok(); await settle();
    mm.chat.setQuickIdeas([{ label: 'Open Content › Speakers', text: 'Open Content › Speakers' }]);
    check('K.12 setQuickIdeas() replaces them (the editor\'s two modes)', byClass(q, 'rvc-quick-btn').map(function (x) { return x.textContent; }).join() === 'Open Content › Speakers' && q.hidden === false);
    mm.chat.setQuickIdeas([]);
    check('K.12 setQuickIdeas([]) hides them', q.hidden === true);
    var e2 = setup();
    var m2 = mountChat(e2, { quickIdeas: [{ label: 'x', text: 'x' }], loadHistory: function (w) { w.user('Old', { at: OLD_AT }); return Promise.resolve(); } });
    m2.chat.open(); await settle();
    check('K.12 a replayed turn counts as a turn', m2.$('quick').hidden === false);
  })();

  /* ======== K.14 keys pressed in the chat stay in the chat ======== */
  await (async function () {
    var e = setup();
    var pageKeys = [];
    e.doc.addEventListener('keydown', function (ev) { pageKeys.push(ev.key + (ev.ctrlKey ? '+ctrl' : '')); });
    e.doc.addEventListener('keyup', function (ev) { pageKeys.push('up:' + ev.key); });
    var mm = mountChat(e);
    mm.chat.open();
    var input = mm.$('input');
    key(input, 'z', { ctrlKey: true });
    key(input, 'Delete');
    key(input, 'ArrowLeft');
    dispatch(input, new Ev('keyup', { key: 'z' }));
    check('K.14 the page\'s shortcuts never hear a key typed in the box (Ctrl+Z, Delete, arrows, keyup)', pageKeys.length === 0, pageKeys);
    type(mm, 'hello');
    var ent = key(input, 'Enter');
    await settle();
    check('K.14 … Enter still sends', mm.log.sent.length === 1 && ent.defaultPrevented && pageKeys.length === 0);
    mm.pending[0].ok(); await settle();
    var closeB = byClass(mm.$('panel'), 'rvc-close')[0];
    key(closeB, 'Delete');
    check('K.14 … nor one pressed on a button in the panel', pageKeys.length === 0);
    var escE = key(input, 'Escape');
    check('K.14 Esc in the box closes the chat (and does not deselect the page\'s section)', !mm.chat.isOpen() && escE.defaultPrevented && pageKeys.length === 0);
    key(mm.$('launcher'), 'Escape');
    check('K.14 a key on the launcher stays in the chat too', pageKeys.length === 0);
    key(e.doc.body, 'Escape');
    key(e.doc.body, 'z', { ctrlKey: true });
    check('K.14 keys on the page are the page\'s', pageKeys.join() === 'Escape,z+ctrl');
    mm.chat.fold('Changed “Hero”', function () {});
    key(byClass(e.doc.getElementById('dash-chat-peek'), 'rvc-undo')[0], 'Enter');
    check('K.14 a key on the folded bar stays in the chat', pageKeys.join() === 'Escape,z+ctrl');
  })();

  check('nothing is console.error\'d in the normal flows', env.errors.length === 0, env.errors);

  /* ======== C.9 the stylesheet ======== */
  var css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  function varCalls(s) {
    var out = [], i = 0;
    while ((i = s.indexOf('var(', i)) !== -1) {
      var depth = 0, j = i + 3;
      for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')') { depth--; if (depth === 0) break; } }
      var inner = s.slice(i + 4, j), k = inner.indexOf(',');
      out.push({ name: (k === -1 ? inner : inner.slice(0, k)).trim(), fallback: k === -1 ? null : inner.slice(k + 1).trim(), start: i, end: j + 1 });
      i = j + 1;
    }
    return out;
  }
  function block(src, marker) {
    var i = src.indexOf(marker);
    if (i === -1) return '';
    var j = src.indexOf('{', i + marker.length - 1), depth = 0, k = j;
    for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (depth === 0) break; } }
    return src.slice(j + 1, k);
  }
  /* a block with its selector, to cut it out of the sheet */
  function blockSpan(src, marker) {
    var i = src.indexOf(marker);
    if (i === -1) return null;
    var j = src.indexOf('{', i + marker.length - 1), depth = 0, k = j;
    for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (depth === 0) break; } }
    return { start: i, end: k + 1, body: src.slice(j + 1, k) };
  }
  function tokensOf(s) { var out = {}; s.replace(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi, function (mm3, k, v) { out[k] = v.trim(); }); return out; }
  function norm(v) { return String(v).toLowerCase().replace(/\s+/g, ''); }

  var lightSpan = blockSpan(css, '\n.rvc{');
  var darkMediaSpan = blockSpan(css, '@media (prefers-color-scheme: dark){');
  var darkThemeSpan = blockSpan(css, '\n:root[data-theme="dark"] .rvc{');
  check('C.9 three palette blocks: .rvc (light), the system\'s dark (unless the page says light), the page\'s dark switch',
    !!lightSpan && !!darkMediaSpan && !!darkThemeSpan && /:root:not\(\[data-theme="light"\]\) \.rvc\{/.test(darkMediaSpan ? css.slice(darkMediaSpan.start, darkMediaSpan.end) : ''));
  var KIT_LIGHT = tokensOf(lightSpan.body);
  var KIT_DARK_MEDIA = tokensOf(block(css.slice(darkMediaSpan.start, darkMediaSpan.end), ':root:not([data-theme="light"]) .rvc{'));
  var KIT_DARK_THEME = tokensOf(darkThemeSpan.body);
  var KIT_DARK = Object.assign({}, KIT_LIGHT, KIT_DARK_THEME);
  /* everything outside the three palette blocks */
  var outsidePalette = [lightSpan, darkMediaSpan, darkThemeSpan].sort(function (a, b2) { return b2.start - a.start; })
    .reduce(function (s, sp) { return s.slice(0, sp.start) + s.slice(sp.end); }, css);
  var hexes = outsidePalette.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  check('C.9 no hex colour outside the palette blocks', hexes.length === 0, hexes);
  check('C.9 no rgb()/hsl() outside the palette blocks', !/\b(rgba?|hsla?)\(/i.test(outsidePalette));
  var decls = [];
  outsidePalette.replace(/\{([^{}]*)\}/g, function (mm2, body) { body.split(';').forEach(function (d) { var k = d.indexOf(':'); if (k !== -1) decls.push([d.slice(0, k).trim(), d.slice(k + 1).trim()]); }); });
  var named = decls.filter(function (d) { return /^(color|background|background-color|border|border-color|border-top|border-top-color|fill|stroke|outline|box-shadow)$/.test(d[0]) && /\b(white|black|red|navy|purple|gray|grey|blue|green|yellow|orange|pink|silver)\b/i.test(d[1]); });
  check('C.9 no named colour', named.length === 0, named);
  check('C.9 none of the editor\'s navy or purple anywhere', !/1c2540|3a2a6d|ede8fb|dfe6f5|5fe3ff/i.test(CSS + SRC));
  check('C.9 the script draws no colour of its own', !/#[0-9a-fA-F]{3,8}\b/.test(code.replace(/'#'/g, '')) && !/\brgba?\(/.test(code));

  var LIGHT = tokensOf(block(PAGE, ':root{'));
  var DARK = Object.assign({}, LIGHT, tokensOf(block(PAGE, ':root[data-theme="dark"]{')));
  check('C.9 the dashboard\'s tokens were read from Event_Listing.html', LIGHT.surface === '#FFFFFF' && DARK.surface === '#1B1A16' && Object.keys(LIGHT).length > 40, Object.keys(LIGHT).length);
  var PALETTE = ['surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'text', 'text-muted', 'text-faint', 'accent', 'accent-strong', 'accent-soft', 'accent-contrast',
    'draft', 'draft-soft', 'ok', 'ok-soft', 'warn', 'warn-soft', 'crit', 'crit-soft', 'shadow-sm', 'shadow-md', 'shadow-lg', 'r-sm', 'r-md', 'r-lg'];
  var badLight = PALETTE.filter(function (t) { return !KIT_LIGHT['rvc-' + t] || norm(KIT_LIGHT['rvc-' + t]) !== norm(LIGHT[t]); });
  check('C.9 the light palette is the dashboard\'s :root, value for value (one look: ET red #FF0035 on every page)', badLight.length === 0 && KIT_LIGHT['rvc-accent'] === '#FF0035', badLight);
  check('C.9 the kit\'s font is the dashboard\'s Inter stack', norm(KIT_LIGHT['rvc-font']) === norm(LIGHT['font-body']));
  var DARK_KEYS = PALETTE.filter(function (t) { return !/^r-/.test(t); });
  var badDark = DARK_KEYS.filter(function (t) { return !KIT_DARK_THEME['rvc-' + t] || norm(KIT_DARK_THEME['rvc-' + t]) !== norm(DARK[t]); });
  check('C.9 the dark palette is the dashboard\'s dark block, value for value', badDark.length === 0, badDark);
  check('C.9 the system\'s dark and the page\'s dark are the same palette', JSON.stringify(KIT_DARK_MEDIA) === JSON.stringify(KIT_DARK_THEME) && Object.keys(KIT_DARK_THEME).length === DARK_KEYS.length);
  var calls = varCalls(css);
  check('C.9 the kit reads no page token: every var() is the kit\'s own --rvc-*', calls.length > 100 && calls.every(function (c) { return /^--rvc-/.test(c.name); }),
    calls.filter(function (c) { return !/^--rvc-/.test(c.name); }).map(function (c) { return c.name; }));
  var undef = calls.filter(function (c) { return !KIT_LIGHT[c.name.slice(2)] && ['--rvc-vh', '--rvc-vt', '--rvc-vb'].indexOf(c.name) === -1; }).map(function (c) { return c.name; });
  check('C.9 every --rvc-* used is defined in .rvc (or is the sheet\'s own --rvc-vh / -vt / -vb, set from script, with fallbacks)', undef.length === 0, undef);
  check('C.9 … and --rvc-vh / -vt / -vb always carry a fallback', calls.filter(function (c) { return ['--rvc-vh', '--rvc-vt', '--rvc-vb'].indexOf(c.name) !== -1; }).every(function (c) { return c.fallback !== null; }));
  check('C.9 the corner\'s defaults: right 22, bottom 22, lift 0, 62 above the launcher, 400 wide, layers 65 / 69', KIT_LIGHT['rvc-right'] === '22px' && KIT_LIGHT['rvc-bottom'] === '22px' &&
    KIT_LIGHT['rvc-lift'] === '0px' && KIT_LIGHT['rvc-gap'] === '62px' && KIT_LIGHT['rvc-panel-w'] === '400px' && KIT_LIGHT['rvc-z-launcher'] === '65' && KIT_LIGHT['rvc-z-panel'] === '69' &&
    KIT_LIGHT['rvc-dock-top'] === '0px');

  function mediaBlock(q) { var i = css.indexOf('@media ' + q); return i === -1 ? '' : block(css, '@media ' + q); }
  check('C.9 desktop: the launcher at the bottom-right corner, lifted with --rvc-lift', /\.rvc-launcher\{\s*position:fixed; right:var\(--rvc-right\); bottom:calc\(var\(--rvc-bottom\) \+ var\(--rvc-lift\)\); z-index:var\(--rvc-z-launcher\);/.test(css) &&
    !/\bleft:/.test(block(css, '\n.rvc-launcher{')));
  check('C.9 desktop: the panel right-aligned above it, 400 wide, never taller than the room under a top bar (lift included)',
    /\.rvc-panel\{\s*position:fixed; right:var\(--rvc-right\); bottom:calc\(var\(--rvc-bottom\) \+ var\(--rvc-lift\) \+ var\(--rvc-gap\)\); z-index:var\(--rvc-z-panel\);/.test(css) &&
    /\.rvc-panel\{[^}]*width:var\(--rvc-panel-w\); max-width:calc\(100vw - 2 \* var\(--rvc-right\)\);/.test(css) &&
    /\.rvc-panel\{[^}]*height:min\(640px, calc\(100vh - var\(--rvc-bottom\) - var\(--rvc-gap\) - 72px - var\(--rvc-lift\)\)\)/.test(css) && !/\bleft:/.test(block(css, '\n.rvc-panel{')) &&
    !/\bleft:/.test(block(css, '\n.rvc-peek{')));
  check('C.9 the folded bar: as wide as the panel, above the launcher at the right, its label on up to two lines',
    /\.rvc-peek\{\s*position:fixed; right:var\(--rvc-right\); bottom:calc\(var\(--rvc-bottom\) \+ var\(--rvc-lift\) \+ var\(--rvc-gap\)\); z-index:var\(--rvc-z-launcher\);/.test(css) &&
    /\.rvc-peek\{[^}]*width:var\(--rvc-panel-w\);[^}]*min-height:48px/.test(css) && /\.rvc-peek-label\{[^}]*-webkit-line-clamp:2/.test(css) && !/\.rvc-peek-label\{[^}]*white-space:nowrap/.test(css));
  check('C.9 the lift moves smoothly (120 ms), and not at all under reduced motion', /\.rvc-launcher\{[^}]*transition:[^;]*bottom \.12s ease/.test(css) && /\.rvc-panel\{[^}]*transition:bottom \.12s ease/.test(css) &&
    /\.rvc-peek\{[^}]*transition:bottom \.12s ease/.test(css));
  var narrow = mediaBlock('(max-width:880px)');
  check('C.9 601–880px: the corner 16px in, the panel 380 wide', /\.rvc\{ --rvc-right:16px; --rvc-panel-w:380px; \}/.test(narrow));
  check('C.9 phones: a full-screen sheet with 100dvh and the safe areas', /\.rvc\.rvc-phone \.rvc-panel\{[^}]*left:0; right:0; top:0; bottom:0;[^}]*height:100dvh/.test(css) && /\.rvc\.rvc-phone \.rvc-panel\{[^}]*env\(safe-area-inset-top/.test(css) &&
    /\.rvc\.rvc-phone \.rvc-panel\{[^}]*env\(safe-area-inset-bottom/.test(css));
  check('C.9 phones: a 16px textarea (no zoom on iOS)', /\.rvc\.rvc-phone \.rvc-input\{[^}]*font-size:16px/.test(css));
  check('C.9 phones: 44px Close, Send and attach, 44px buttons', /\.rvc\.rvc-phone \.rvc-close\{ width:44px; height:44px; \}/.test(css) && /\.rvc\.rvc-phone \.rvc-send, \.rvc\.rvc-phone \.rvc-attach\{ width:44px; height:44px; \}/.test(css) &&
    /\.rvc\.rvc-phone \.rvc-btn, \.rvc\.rvc-phone \.rvc-choice, \.rvc\.rvc-phone \.rvc-suggestion\{ min-height:44px; \}/.test(css));
  check('C.9 phones: a 52px round launcher at right 16 / bottom 16, above the home bar, lifted too, label hidden',
    /\.rvc\.rvc-phone \.rvc-launcher\{ right:16px; bottom:calc\(16px \+ env\(safe-area-inset-bottom, 0px\) \+ var\(--rvc-lift\)\); \}/.test(css) &&
    /\.rvc\.rvc-compact \.rvc-launcher, \.rvc\.rvc-phone \.rvc-launcher\{ width:52px; height:52px; padding:0; justify-content:center; border-radius:50%; \}/.test(css) &&
    /\.rvc\.rvc-compact \.rvc-launcher-label, \.rvc\.rvc-phone \.rvc-launcher-label\{ display:none; \}/.test(css));
  check('C.9 phones: the keyboard-aware height', /\.rvc\.rvc-phone \.rvc-panel\.rvc-has-vv\{[^}]*height:var\(--rvc-vh/.test(css));
  check('C.9 phones: the folded bar spans the width, above the launcher, lifted too', /\.rvc\.rvc-phone \.rvc-peek\{[^}]*left:16px; right:16px;[^}]*bottom:calc\(80px \+ env\(safe-area-inset-bottom, 0px\) \+ var\(--rvc-lift\)\)/.test(css));
  check('C.9 the half sheet: 56vh at the bottom, rounded top, standing on the keyboard', /\.rvc\.rvc-phone\.rvc-half \.rvc-panel\{[^}]*top:auto; bottom:0; height:56vh;/.test(css) &&
    /\.rvc\.rvc-phone\.rvc-half \.rvc-panel\.rvc-has-vv\{[^}]*bottom:var\(--rvc-vb, 0px\); height:min\(56vh, var\(--rvc-vh, 56vh\)\)/.test(css));
  check('C.9 the docked column: full height at the right edge from --rvc-dock-top, square, no shadow; the launcher hidden meanwhile',
    /\.rvc\.rvc-is-docked \.rvc-panel\{[^}]*top:var\(--rvc-dock-top\); right:0; bottom:0; left:auto;[^}]*height:auto;[^}]*border-radius:0; box-shadow:none;/.test(css) &&
    /\.rvc\.rvc-is-docked \.rvc-launcher\{ display:none; \}/.test(css));
  check('C.9 compact: 70px above the 52px face', /\.rvc\.rvc-compact\{ --rvc-gap:70px; \}/.test(css));
  var rm = mediaBlock('(prefers-reduced-motion: reduce)');
  check('C.9 reduced motion: animations and transitions off, the countdown bar still and full', /animation:none !important/.test(rm) && /\.rvc-launcher, \.rvc-panel, \.rvc-peek,[^{]*\{ transition:none !important; \}/.test(rm) &&
    /\.rvc-cd-bar i\{ width:100%; \}/.test(rm) && /\.rvc-spin/.test(rm));
  var zs = (css.match(/z-index:\s*[^;]+/g) || []).map(function (z) { return z.replace(/^z-index:\s*/, '').trim(); });
  check('C.9 layers: the launcher and the bar on --rvc-z-launcher, the panel on --rvc-z-panel (and the drop overlay inside it at 2)',
    zs.sort().join() === ['2', 'var(--rvc-z-launcher)', 'var(--rvc-z-launcher)', 'var(--rvc-z-panel)'].sort().join(), zs);
  /* the pages' own layers against the kit's */
  function zOf(src, re) { var mz = re.exec(src); return mz ? Number(mz[1]) : NaN; }
  var Z = {
    sheet: zOf(PAGE, /\.bottom-sheet-scrim\{[^}]*z-index:(\d+)/), nav: zOf(PAGE, /\.main-nav\{[^}]*z-index:(\d+)/), popover: zOf(PAGE, /\.popover\{[^}]*z-index:(\d+)/),
    modal: zOf(PAGE, /\.modal-scrim\{[^}]*z-index:(\d+)/), toast: zOf(PAGE, /#toast-region\{[^}]*z-index:(\d+)/)
  };
  var K = { launcher: Number(KIT_LIGHT['rvc-z-launcher']), panel: Number(KIT_LIGHT['rvc-z-panel']) };
  check('C.9 the dashboard\'s layers were read (Filters sheet, nav, popovers, modals, toasts)', [Z.sheet, Z.nav, Z.popover, Z.modal, Z.toast].every(function (z) { return z > 0; }), Z);
  check('C.9 the launcher and the folded bar: above the nav and popovers, below the Filters sheet', K.launcher > Z.nav && K.launcher > Z.popover && K.launcher < Z.sheet, { K: K, Z: Z });
  check('C.9 the open panel: above the launcher, the nav and popovers; below the Filters sheet, modals and toasts (a page\'s own window always wins)',
    K.panel > K.launcher && K.panel > Z.nav && K.panel < Z.sheet && K.panel < Z.modal && Z.modal < Z.toast, { K: K, Z: Z });
  var consoleZ = { scrim: zOf(CONSOLE_CSS, /\.drawer-bg\{[^}]*z-index:(\d+)/), toast: zOf(CONSOLE_CSS, /\.toast-host\{[^}]*z-index:(\d+)/) };
  check('C.9 the console\'s drawers (70/71) and toasts (99) open above the panel (plan §2: at 85 it hid a drawer\'s Save)',
    consoleZ.scrim > K.panel && consoleZ.toast > K.panel, consoleZ);
  var guideZ = zOf(CREATE_PAGE, /\.gb-guide\{[^}]*z-index:\s*(\d+)/);
  check('C.9 Create Event\'s brief guide (71) opens above the panel', guideZ > K.panel, guideZ);
  check('C.9 :focus-visible rules, the kit\'s accent, every control keeps its shape', /\.rvc :focus-visible\{ outline:2px solid var\(--rvc-accent\)/.test(css) && /\.rvc-launcher:focus-visible/.test(css) &&
    /\.rvc-compose:focus-within/.test(css) && /\.rvc \.rvc-launcher:focus-visible\{ border-radius:100px; \}/.test(css) && /\.rvc \.rvc-send:focus-visible, \.rvc \.rvc-attach:focus-visible/.test(css) &&
    /\.rvc \.rvc-btn:focus-visible/.test(css) && /\.rvc-quick-btn:focus-visible/.test(css) && /\.rvc \.rvc-achip-rm:focus-visible, \.rvc \.rvc-context-rm:focus-visible\{ border-radius:50%; \}/.test(css));
  check('C.9 a page\'s :focus-visible {border-radius:4px} (dashboard, editor, Create Event) cannot square the round launcher', /:focus-visible\{[^}]*border-radius:4px/.test(PAGE) &&
    /\.rvc\.rvc-compact \.rvc-launcher:focus-visible, \.rvc\.rvc-phone \.rvc-launcher:focus-visible\{ border-radius:50%; \}/.test(css));
  check('C.9 a page\'s own heading and body rules do not reach inside (fonts, tracking, line height)', /\.rvc h2, \.rvc h3\{ font-family:inherit; letter-spacing:normal;/.test(css) &&
    /\.rvc\{[^}]*font-size: 14px; line-height: 1\.5; letter-spacing: normal; text-align: left;/.test(css));
  check('C.9 the kit does not hide the page\'s help button (the page does that, under html.rvc-ready)', CSS.indexOf('help-fab') === -1);
  check('C.9 the page is locked behind the full phone sheet', /html\.rvc-lock, html\.rvc-lock body\{ overflow:hidden; \}/.test(css));
  check('C.9 hidden wins over the kit\'s own display rules', /\.rvc \[hidden\]\{ display:none !important; \}/.test(css));
  check('C.9 names wrap rather than push the sheet sideways', /\.rvc-msg\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/.test(css) && /\.rvc-row-name\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/.test(css) &&
    /\.rvc-achip-name\{[^}]*text-overflow:ellipsis/.test(css) && /\.rvc-scope\{[^}]*text-overflow:ellipsis/.test(css) && /\.rvc-context-text\{[^}]*text-overflow:ellipsis/.test(css));
  check('C.9 the thread is the offset parent of its turns (for showing an answer from its top)', /\.rvc-thread\{ position:relative;/.test(css));
  check('C.9 the drop overlay lets the drag through (pointer-events:none)', /\.rvc-drop\{[^}]*pointer-events:none/.test(css));

  /* ======== C.10 the pairs pass WCAG AA, light and dark (UX-100) ======== */
  function lum(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [0, 2, 4].map(function (i) { var c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
      .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function ratio(a, b2) { var x = lum(a), y = lum(b2); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var PAIRS = [
    ['text', 'surface', 4.5, 'words on the panel'], ['text', 'surface-2', 4.5, 'an answer, the context chip'], ['text', 'accent-soft', 4.5, 'the person\'s bubble, its ↳ line, the drop overlay'],
    ['text-muted', 'surface', 4.5, 'the sender, the time, dividers, the status, the scope, the foot note, the tray hint, "Stopped"'],
    ['text-muted', 'surface-2', 4.5, '"as of", notes and missing parts in an answer, the busy strip, a chip\'s "Adding…"'],
    ['accent-strong', 'surface', 4.5, 'links in a list card, Try again under a stopped message'], ['accent-strong', 'surface-2', 4.5, 'links in an answer and the help button on hover'],
    ['crit', 'crit-soft', 4.5, 'an error, an attachment the page refused'], ['crit', 'surface', 4.5, '"Not sent"'],
    ['accent-contrast', 'accent-strong', 4.5, 'a primary button'], ['surface', 'text', 4.5, 'the number on an attachment'],
    ['text', 'draft-soft', 4.5, 'the Draft chip'], ['text', 'ok-soft', 4.5, 'the Active chip'], ['text', 'warn-soft', 4.5, 'the Cancelled chip'],
    ['text', 'crit-soft', 4.5, 'the Deleted chip'], ['text', 'surface-3', 4.5, 'the Completed chip and the count'],
    ['accent', 'surface', 3, 'the Send button and the focus ring against the panel'], ['accent-contrast', 'accent', 3, 'the Send icon']
  ];
  [['light', KIT_LIGHT], ['dark', KIT_DARK]].forEach(function (th) {
    PAIRS.forEach(function (p) {
      var a = th[1]['rvc-' + p[0]], c = th[1]['rvc-' + p[1]];
      var r = a && c ? ratio(a, c) : 0;
      check('C.10 ' + th[0] + ': --rvc-' + p[0] + ' on --rvc-' + p[1] + ' ≥ ' + p[2] + ' (' + p[3] + ')', r >= p[2], { ratio: Math.round(r * 100) / 100, fg: a, bg: c });
    });
  });
  check('C.10 the sender, the dividers, the status and the scope use --text-muted (UX-100: they were 3.06:1)', /\.rvc-meta\{[^}]*color:var\(--rvc-text-muted\)/.test(css) &&
    /\.rvc-divider\{[^}]*color:var\(--rvc-text-muted\)/.test(css) && /\.rvc-status\{[^}]*color:var\(--rvc-text-muted\)/.test(css) && /\.rvc-scope\{[^}]*color:var\(--rvc-text-muted\)/.test(css));
  check('C.10 … at 11px or more', /\.rvc-meta\{[^}]*font-size:11px/.test(css) && /\.rvc-divider\{[^}]*font-size:11px/.test(css));
  check('C.10 the "as of" line uses --text-muted, not the too-pale --text-faint', /\.rvc-asof\{[^}]*color:var\(--rvc-text-muted\)/.test(css) && ratio(KIT_LIGHT['rvc-text-faint'], KIT_LIGHT['rvc-surface-2']) < 4.5);
  check('C.10 chip words are --text (the status colours as words would fail AA)', /\.rvc-chip\{[^}]*color:var\(--rvc-text\)/.test(css) && ratio(KIT_LIGHT['rvc-draft'], KIT_LIGHT['rvc-draft-soft']) < 4.5);
  check('C.10 a primary button is on --accent-strong (white on --accent fails AA at this size)', /\.rvc-btn-primary\{ background:var\(--rvc-accent-strong\)/.test(css) && ratio(KIT_LIGHT['rvc-accent-contrast'], KIT_LIGHT['rvc-accent']) < 4.5);
  check('C.10 the ↳ line on the person\'s bubble is --text', /\.rvc-msg-ctx\{[^}]*color:var\(--rvc-text\)/.test(css));
  check('C.10 the contrast numbers of the plan (§8 UX-100)', Math.round(ratio(KIT_LIGHT['rvc-text-muted'], KIT_LIGHT['rvc-surface']) * 100) / 100 === 5.43 &&
    Math.round(ratio(KIT_DARK['rvc-text-muted'], KIT_DARK['rvc-surface']) * 100) / 100 === 6.75);

  if (failed) { console.error('etb2b-chat: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('etb2b-chat: all ' + passed + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.error('etb2b-chat: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
