// node functions/lib/etb2b-chat.test.js — the ETB2B AI chat kit (etb2b-chat.js, window.RevampChat, and
// etb2b-chat.css), as the events dashboard's ETB2B AI uses it (dash-bot plan §7, K6; checks C.1–C.12).
// etb2b-chat.js runs in a vm over a small DOM built here (elements, attributes, classes, text, events that
// bubble to the document, focus) with a fake clock, so the 8 s "still working" line, the 1.2 s countdown and the
// 6 s wait for the history replay are exact. The stylesheet is read as text: every colour is a console token,
// the phone sheet and the layers are as planned, and the token pairs it uses pass WCAG AA in the console's
// light and dark values, read from Event_Listing.html at run time. No network, no AI.
'use strict';
process.env.TZ = 'UTC';   // a turn's own time is drawn in the person's clock; the test fixes it
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'etb2b-chat.js'), 'utf8');
var CSS = fs.readFileSync(path.join(ROOT, 'etb2b-chat.css'), 'utf8');
var PAGE = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8');

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
    toggle: function (c, f) { var has = list().indexOf(c) !== -1; var want = f === undefined ? !has : !!f; if (want) this.add(c); else this.remove(c); return want; }
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
EP.click = function () { if (this.disabled) return; dispatch(this, new Ev('click')); };
EP.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b; };

function walk(n, fn) { if (!n) return; if (n.nodeType === 1) fn(n); (n.childNodes || []).forEach(function (c) { walk(c, fn); }); }
function all(n, pred) { var out = []; walk(n, function (e) { if (pred(e)) out.push(e); }); return out; }
function byClass(n, c) { return all(n, function (e) { return e.classList.contains(c); }); }
function byTag(n, t) { return all(n, function (e) { return e.localName === t; }); }

function makeDoc() {
  var doc = { nodeType: 9, _ls: {}, parentNode: null };
  doc.createElement = function (t) { return new El(doc, t); };
  doc.createTextNode = function (s) { return new Tx(doc, s); };
  doc.addEventListener = addL; doc.removeEventListener = rmL;
  var html = new El(doc, 'html'); html.parentNode = doc;
  var body = new El(doc, 'body'); html.appendChild(body);
  doc.documentElement = html; doc.body = body; doc.activeElement = body;
  doc.getElementById = function (id) { var hit = null; walk(html, function (e) { if (!hit && e.getAttribute('id') === id) hit = e; }); return hit; };
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
function setup(o) {
  o = o || {};
  var doc = makeDoc();
  var clock = makeClock(NOW);
  var mq = { matches: !!o.phone, ls: [], addEventListener: function (t, fn) { if (t === 'change') this.ls.push(fn); } };
  var errors = [];
  var sandbox = {
    document: doc,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    matchMedia: function (q) { mq.media = q; return mq; },
    navigator: { onLine: !o.offline },
    console: { error: function () { errors.push([].slice.call(arguments).map(String).join(' ')); }, log: function () {} },
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
  return { doc: doc, clock: clock, mq: mq, errors: errors, win: sandbox, host: host, RC: sandbox.RevampChat };
}

var SUGGESTIONS = [
  { label: 'Create an IP event called … on … in …', text: 'Create an IP event called … on … in …' },
  { label: 'Show drafts from last week', text: 'Show drafts from last week' },
  { label: 'Which events go live this month?', text: 'Which events go live this month?' },
  { label: 'Make a save-the-date post and an announcement mailer for …', text: 'Make a save-the-date post and an announcement mailer for …' }
];
var FOOT = 'ETB2B AI opens pages, filters this list and starts drafts. It never deletes, cancels, publishes or approves anything.';
function mountChat(env, extra) {
  var log = { sent: [], open: [], history: 0, help: [] };
  var pending = [];
  var opts = {
    id: 'dash', title: 'ETB2B AI', launcherLabel: 'Ask ETB2B AI', placeholder: 'Ask ETB2B AI…',
    welcome: { heading: 'Hi Asha, I’m ETB2B AI.', text: 'I can start a new event, open any event’s pages, answer questions from your events’ real numbers, and set up promotions.' },
    suggestions: SUGGESTIONS, footNote: FOOT,
    help: { label: 'Email Customer Care', onClick: function (b) { log.help.push(b); } },
    send: function (t) { log.sent.push(t); return new Promise(function (ok, no) { pending.push({ ok: ok, no: no }); }); },
    loadHistory: function () { log.history++; return null; },
    onOpenChange: function (v) { log.open.push(v); }
  };
  Object.keys(extra || {}).forEach(function (k) { opts[k] = extra[k]; });
  var chat = env.RC.mount(env.host, opts);
  var $ = function (part) { return env.doc.getElementById('dash-chat-' + part); };
  return { chat: chat, log: log, pending: pending, opts: opts, $: $ };
}
function key(target, k, o) { var e = new Ev('keydown', Object.assign({ key: k }, o || {})); dispatch(target, e); return e; }
function type(m, text) { m.$('input').value = text; dispatch(m.$('input'), new Ev('input')); }
function turns(m) { return m.$('thread').children.filter(function (c) { return c.classList.contains('rvc-turn'); }); }
function btnIn(node, label) { return all(node, function (e) { return e.localName === 'button' && e.textContent === label; })[0] || null; }

(async function main() {
  /* ======== C.1 the file: ES5, text only, one global ======== */
  var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  check('C.1 no let', !/\blet\s/.test(code));
  check('C.1 no const', !/\bconst\s/.test(code));
  check('C.1 no arrow functions', code.indexOf('=>') === -1);
  check('C.1 no async / await', !/\basync\b|\bawait\b/.test(code));
  check('C.1 no class', !/\bclass\s+[A-Za-z]/.test(code));
  check('C.1 no template strings', code.indexOf('`') === -1);
  check('C.1 no spread or rest', code.indexOf('...') === -1);
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
  check('C.1 innerHTML is assigned only fixed drawings', assigns.length >= 4 && assigns.every(function (n) {
    if (!/^[A-Z][A-Z_]*$/.test(n)) return false;
    var def = new RegExp('var ' + n + " = ((?:'[^'\\\\]*'\\s*\\+?\\s*)+);").exec(SRC);
    return !!def;
  }), assigns);
  check('C.1 no other way to write markup', !/outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code));
  check('C.1 reads and writes no storage', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code));
  var env0 = setup();
  var ownGlobals = Object.keys(env0.win).filter(function (k) { return ['document', 'setTimeout', 'clearTimeout', 'matchMedia', 'navigator', 'console', '__now', 'window'].indexOf(k) === -1; });
  check('C.1 one global, RevampChat, with mount()', ownGlobals.join() === 'RevampChat' && Object.keys(env0.RC).join() === 'mount', ownGlobals);
  var access = require('./access');
  check('C.1 the page may load both files', access.isServableFile('etb2b-chat.js') === true && access.isServableFile('etb2b-chat.css') === true);
  check('C.1 the product names are right', SRC.indexOf('Revamp CMS') === -1 && CSS.indexOf('Revamp CMS') === -1 && !/\bRevamp\b(?!Chat)/.test(SRC.replace(/RevampChat/g, '')));

  /* ======== C.2 mount: the markup, ids, roles and ARIA ======== */
  var env = setup();
  var m = mountChat(env);
  var L = m.$('launcher'), P = m.$('panel');
  ['launcher', 'panel', 'title', 'thread', 'input', 'send', 'status', 'busy'].forEach(function (p) { check('C.2 #dash-chat-' + p + ' exists', !!m.$(p)); });
  check('C.2 the launcher is a button that says what it opens', L.localName === 'button' && L.getAttribute('type') === 'button' && L.classList.contains('rvc-launcher') &&
    L.getAttribute('aria-expanded') === 'false' && L.getAttribute('aria-controls') === 'dash-chat-panel', L._a);
  check('C.2 the launcher reads "Ask ETB2B AI" and its name holds those words (label in name)',
    byClass(L, 'rvc-launcher-label')[0].textContent === 'Ask ETB2B AI' && L.getAttribute('aria-label').indexOf('Ask ETB2B AI') === 0);
  check('C.2 the panel is a non-modal dialog named by its title, shut', P.getAttribute('role') === 'dialog' && P.getAttribute('aria-modal') === 'false' &&
    P.getAttribute('aria-labelledby') === 'dash-chat-title' && P.hidden === true);
  check('C.2 the title is "ETB2B AI" in a heading', m.$('title').localName === 'h2' && m.$('title').textContent === 'ETB2B AI');
  check('C.2 the status pill is role=status and says Ready', m.$('status').getAttribute('role') === 'status' && m.$('status').textContent === 'Ready');
  var T = m.$('thread');
  check('C.2 the thread is a polite log of additions, scrollable by keyboard', T.getAttribute('role') === 'log' && T.getAttribute('aria-live') === 'polite' &&
    T.getAttribute('aria-relevant') === 'additions' && T.getAttribute('tabindex') === '0' && !!T.getAttribute('aria-label'));
  var lbl = all(P, function (e) { return e.localName === 'label'; })[0];
  check('C.2 the message box is a labelled textarea', m.$('input').localName === 'textarea' && lbl && lbl.getAttribute('for') === 'dash-chat-input' &&
    lbl.textContent === 'Message ETB2B AI' && lbl.classList.contains('rvc-sr') && m.$('input').getAttribute('placeholder') === 'Ask ETB2B AI…');
  check('C.2 Enter is "send" on phone keyboards', m.$('input').getAttribute('enterkeyhint') === 'send');
  check('C.2 Send is an icon button with a name', m.$('send').localName === 'button' && m.$('send').getAttribute('aria-label') === 'Send' && m.$('send').getAttribute('type') === 'button');
  check('C.2 the busy strip starts hidden', m.$('busy').hidden === true);
  var close = byClass(P, 'rvc-close')[0];
  check('C.2 Close has a name', close && close.getAttribute('aria-label') === 'Close ETB2B AI');
  var help = byClass(P, 'rvc-head-help')[0];
  check('C.2 "Email Customer Care" sits in the header', help && help.textContent === 'Email Customer Care' && byClass(P, 'rvc-head')[0].contains(help));
  help.click();
  check('C.2 it calls the page\'s help, handing it the button so focus can come back', m.log.help.length === 1 && m.log.help[0] === help);
  check('C.2 the foot note is under the box', byClass(P, 'rvc-footnote')[0].textContent === FOOT);
  check('C.2 the welcome greets by name', byClass(T, 'rvc-welcome-h')[0].textContent === 'Hi Asha, I’m ETB2B AI.');
  check('C.2 four suggestions', byClass(T, 'rvc-suggestion').length === 4);
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
    check('C.3 loadHistory is handed a writer {divider, user, ai}', !!writer && typeof writer.divider === 'function' && typeof writer.user === 'function' && typeof writer.ai === 'function');
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
  var ut = turns(m);
  check('C.4 the kit draws the person\'s own bubble', ut.length === 1 && ut[0].classList.contains('rvc-user') && byClass(ut[0], 'rvc-msg')[0].textContent === 'Show drafts from last week');
  check('C.4 the box is emptied', IN.value === '');
  check('C.4 while thinking: Send disabled, the box read-only and aria-disabled (focus kept)', SEND.disabled === true && IN.readOnly === true &&
    IN.getAttribute('aria-disabled') === 'true' && env.doc.activeElement === IN);
  check('C.4 while thinking: the status pill and the busy strip say so', m.$('status').textContent === 'Thinking…' && m.$('busy').hidden === false &&
    byClass(m.$('busy'), 'rvc-busy-text')[0].textContent === 'ETB2B AI is thinking…' && P.getAttribute('aria-busy') === 'true');
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
  check('C.4 a failure: Try again', !!again);
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
  })();

  /* ======== C.5 text only ======== */
  var XSS = '<img src=x onerror=alert(1)>';
  var ux = m.chat.user(XSS);
  var umsg = byClass(ux, 'rvc-msg')[0];
  check('C.5 a person\'s message is text, not markup', umsg.textContent === XSS && umsg.childNodes.every(function (c) { return c.nodeType === 3; }) && byTag(ux, 'img').length === 0);
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
  check('C.5 the whole sentence reads in order', byClass(bx.node, 'rvc-text')[0].textContent ===
    'See ' + XSS + ', Evil twoEvil threeEvil fourEvil five and Autotech 2026 has 1,234 registrations so far; an event I could not find');
  var lk = bx.link('https://evil.example/', 'Open it');
  var lk2 = bx.link('/marketing.html?event=autotech-2026&tab=posts', 'Promotions');
  check('C.5 link(): only a path on this site is an <a>', lk.localName === 'span' && lk2.localName === 'a' && lk2.getAttribute('href') === '/marketing.html?event=autotech-2026&tab=posts');
  var lc = bx.list({ title: 'X', items: [{ name: XSS, href: 'javascript:alert(1)' }] });
  check('C.5 list(): a bad address is text, a name is text', byTag(lc, 'a').length === 0 && byTag(lc, 'img').length === 0 && byClass(lc, 'rvc-row-name')[0].textContent === XSS);

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

  /* ======== C.7 suggestions fill the box and never send ======== */
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

  /* ======== C.11 fold: the one-line bar after a list change ======== */
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
    var fnU = function () { undone++; };
    mm.chat.ai('Showing Draft events').undo(fnU);
    mm.chat.fold('Draft events', fnU);
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
    mm.chat.fold('Draft events', fnU);
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
    function cd(c, label) { return c.countdown(1200, label, function () { log.cancel++; }, function () { log.done++; }); }
    check('C.12 no Stay here in the bar until one is needed (no hidden twin)', !btnIn(peek, 'Stay here'));

    /* (a) Close while "Opening …" shows */
    mm.chat.open();
    var c1 = cd(mm.chat.ai('Opening the editor.'), 'the Autotech editor');
    e.clock.advance(600);
    closeB.click();
    e.clock.advance(5000);
    check('C.12 Close during a countdown: the page stays (onCancel once, never onDone)', !c1.isRunning() && log.cancel === 1 && log.done === 0, log);
    check('C.12 … and the card says why', byClass(c1.node, 'rvc-cd-text')[0].textContent === 'Stayed here, as ETB2B AI was closed.' && !btnIn(c1.node, 'Stay here'));
    check('C.12 … the panel is shut, focus on the launcher', mm.chat.isOpen() === false && e.doc.activeElement === launcher && peek.hidden === true);
    mm.chat.open();
    var c2 = cd(mm.chat.ai('x'), 'Promotions');
    launcher.click();
    e.clock.advance(5000);
    check('C.12 the launcher\'s close stops it too', !c2.isRunning() && log.cancel === 2 && log.done === 0);
    mm.chat.open();
    var c3 = cd(mm.chat.ai('x'), 'Registrations');
    mm.chat.close();
    e.clock.advance(5000);
    check('C.12 chat.close() stops it too', !c3.isRunning() && log.cancel === 3 && log.done === 0);

    /* (b) an answer that opens a page arrives while the panel is shut */
    var search = e.doc.createElement('input');
    e.doc.body.appendChild(search);
    search.focus();
    var c4 = cd(mm.chat.ai('Opening the editor.'), 'the Autotech editor');
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

    var c5 = cd(mm.chat.ai('x'), 'Promotions');
    key(search, 'Escape');
    check('C.12 shut: Esc in the page is Stay here', !c5.isRunning() && log.cancel === 5 && log.done === 0 && !btnIn(peek, 'Stay here'));

    var c6 = cd(mm.chat.ai('x'), 'Insights');
    btnIn(peek, 'Stay here').focus();
    key(btnIn(peek, 'Stay here'), 'Escape');
    check('C.12 Esc on the bar\'s Stay here: stays, and the focus goes to Back to chat (not lost)', !c6.isRunning() && log.cancel === 6 && e.doc.activeElement === btnIn(peek, 'Back to chat'));

    var c7 = cd(mm.chat.ai('x'), 'the Autotech editor');
    launcher.click();
    check('C.12 opening the panel moves it back into its card: the bar and its Stay here go, it keeps running', mm.chat.isOpen() && peek.hidden === true && !btnIn(peek, 'Stay here') && c7.isRunning() &&
      !!btnIn(c7.node, 'Stay here'));
    e.clock.advance(1200);
    check('C.12 … and opens when its time is up, as Stay here was in sight', log.done === 1 && log.cancel === 6);

    mm.chat.close();
    search.focus();
    var c8 = cd(mm.chat.ai('x'), 'Promotions');
    e.clock.advance(1200);
    check('C.12 shut, left alone: it opens at 1.2 s (do it, then undo) and the bar\'s Stay here is locked', log.done === 2 && !c8.isRunning() &&
      btnIn(peek, 'Stay here').getAttribute('aria-disabled') === 'true');
    btnIn(peek, 'Stay here').click();
    check('C.12 … a click on it then does nothing', log.cancel === 6);
    var c8b = cd(mm.chat.ai('x'), 'Insights');          // that page did not open after all, and another is asked for
    check('C.12 the next page on its way gets a working Stay here again', !btnIn(peek, 'Stay here').hasAttribute('aria-disabled') && byClass(peek, 'rvc-stay').length === 1);
    btnIn(peek, 'Stay here').click();
    check('C.12 … which stops it', !c8b.isRunning() && log.cancel === 7 && log.done === 2);
    log.cancel = 6;                                      // the counts below go on from before this aside

    /* (c) while folded after a list change, and a second page while one is on its way */
    mm.chat.open();
    var fnU = function () {};
    mm.chat.fold('Draft events', fnU);
    var c9 = cd(mm.chat.ai('x'), 'Promotions');
    check('C.12 folded: the bar switches from the list change to "Opening …" with Stay here', byClass(peek, 'rvc-peek-label')[0].textContent === 'Opening Promotions…' &&
      btnIn(peek, 'Undo').hidden === true && !!btnIn(peek, 'Stay here'));
    var c10 = cd(mm.chat.ai('x'), 'Registrations');
    check('C.12 a second page while one is on its way: the first stays (onCancel), the bar shows the second', !c9.isRunning() && c10.isRunning() && log.cancel === 7 &&
      byClass(peek, 'rvc-peek-label')[0].textContent === 'Opening Registrations…' && byClass(peek, 'rvc-stay').length === 1);
    mm.chat.fold('Upcoming events', fnU);
    e.clock.advance(5000);
    check('C.12 a fold stops a page on its way (the list change is the newest thing asked for)', !c10.isRunning() && log.cancel === 8 && log.done === 2 &&
      byClass(peek, 'rvc-peek-label')[0].textContent === 'Showing Upcoming events' && !btnIn(peek, 'Stay here') && btnIn(peek, 'Undo').hidden === false);
    mm.chat.open();
    var c11 = cd(mm.chat.ai('x'), 'Insights');
    mm.chat.fold('Draft events', fnU);
    e.clock.advance(5000);
    check('C.12 … from the open panel too', !c11.isRunning() && log.cancel === 9 && log.done === 2);
  })();

  /* ======== phones: the sheet ======== */
  await (async function () {
    var vv = { height: 500, offsetTop: 12, _ls: {}, addEventListener: function (t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); } };
    var e = setup({ phone: true, vv: vv });
    var mm = mountChat(e);
    var panel = mm.$('panel'), html = e.doc.documentElement;
    check('PH the phone width is the stylesheet\'s 600px', e.mq.media === '(max-width: 600px)');
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
    mm.chat.setBusy(false);
    mm.chat.fold('Draft events', function () {});
    check('PH folding frees the page', !html.classList.contains('rvc-lock') && panel.getAttribute('aria-modal') === 'false');
    mm.chat.open();
    e.mq.matches = false; e.mq.ls.forEach(function (f) { f(); });
    check('PH widening past a phone: not modal, the page free', panel.getAttribute('aria-modal') === 'false' && !html.classList.contains('rvc-lock') && !panel.classList.contains('rvc-has-vv'));
    var t2 = key(mm.$('send'), 'Tab');
    check('PH on a desktop Tab is not trapped', !t2.defaultPrevented);
    e.mq.matches = true; e.mq.ls.forEach(function (f) { f(); });
    mm.chat.close();
    check('PH closing frees the page', !html.classList.contains('rvc-lock'));
  })();

  /* a page callback that throws does not break the chat */
  (function () {
    var e = setup();
    var mm = mountChat(e, { onOpenChange: function () { throw new Error('stub: page callback'); } });
    mm.chat.open();
    check('a throwing onOpenChange is reported, and the panel still opens', mm.chat.isOpen() && e.errors.length === 1);
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
  function stripVars(s) { var calls = varCalls(s), out = '', at = 0; calls.forEach(function (c) { if (c.start >= at) { out += s.slice(at, c.start) + 'VAR'; at = c.end; } }); return out + s.slice(at); }
  var bare = stripVars(css);
  var hexes = bare.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  check('C.9 no hex colour outside a var() fallback', hexes.length === 0, hexes);
  check('C.9 no rgb()/hsl() outside a var() fallback', !/\b(rgba?|hsla?)\(/i.test(bare));
  var decls = [];
  bare.replace(/\{([^{}]*)\}/g, function (mm2, body) { body.split(';').forEach(function (d) { var k = d.indexOf(':'); if (k !== -1) decls.push([d.slice(0, k).trim(), d.slice(k + 1).trim()]); }); });
  var named = decls.filter(function (d) { return /^(color|background|background-color|border|border-color|border-top-color|fill|stroke|outline|box-shadow)$/.test(d[0]) && /\b(white|black|red|navy|purple|gray|grey|blue|green|yellow|orange|pink|silver)\b/i.test(d[1]); });
  check('C.9 no named colour', named.length === 0, named);
  check('C.9 none of the editor\'s navy or purple anywhere', !/1c2540|3a2a6d|ede8fb|dfe6f5|5fe3ff/i.test(CSS + SRC));
  check('C.9 the script draws no colour of its own', !/#[0-9a-fA-F]{3,8}\b/.test(code.replace(/'#'/g, '')) && !/\brgba?\(/.test(code));

  function block(src, marker) {
    var i = src.indexOf(marker);
    if (i === -1) return '';
    var j = src.indexOf('{', i + marker.length - 1), depth = 0, k = j;
    for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (depth === 0) break; } }
    return src.slice(j + 1, k);
  }
  function tokensOf(s) { var out = {}; s.replace(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi, function (mm3, k, v) { out[k] = v.trim(); }); return out; }
  var LIGHT = tokensOf(block(PAGE, ':root{'));
  var DARK = Object.assign({}, LIGHT, tokensOf(block(PAGE, ':root[data-theme="dark"]{')));
  check('C.9 the console\'s tokens were read from Event_Listing.html', LIGHT.surface === '#FFFFFF' && DARK.surface === '#201C1B' && Object.keys(LIGHT).length > 40, Object.keys(LIGHT).length);
  var calls = varCalls(css);
  /* the page's tokens (with fallbacks); the kit's own --rvc-vh / --rvc-vt (set from script, with fallbacks) are not */
  var aliases = calls.filter(function (c) { return c.fallback !== null && !/^--rvc-/.test(c.name); });
  function norm(v) { return String(v).toLowerCase().replace(/\s+/g, ''); }
  var wrong = aliases.filter(function (c) { var t = c.name.replace(/^--/, ''); return !LIGHT[t] || norm(LIGHT[t]) !== norm(c.fallback); }).map(function (c) { return c.name + ' ' + c.fallback; });
  check('C.9 every fallback is the console\'s own light value of that token', aliases.length >= 25 && wrong.length === 0, wrong);
  var rvcBlock = block(css, '.rvc{');
  var outside = calls.filter(function (c) { return !/^--rvc-/.test(c.name) && (c.start < css.indexOf('.rvc{') || c.start > css.indexOf('.rvc{') + rvcBlock.length + 6); }).map(function (c) { return c.name; });
  check('C.9 the page\'s tokens are read only once, in the .rvc block', outside.length === 0 && aliases.length === Object.keys(aliases.reduce(function (o, c) { o[c.name] = 1; return o; }, {})).length, outside);
  check('C.9 everywhere else the kit uses its own --rvc-* names', calls.filter(function (c) { return c.fallback === null; }).every(function (c) { return /^--rvc-/.test(c.name); }));
  var defined = {};
  rvcBlock.replace(/(--rvc-[a-z0-9-]+)\s*:/g, function (mm4, k) { defined[k] = 1; });
  var undef = calls.filter(function (c) { return c.fallback === null && !defined[c.name] && ['--rvc-vh', '--rvc-vt'].indexOf(c.name) === -1; }).map(function (c) { return c.name; });
  check('C.9 every --rvc-* used is defined (or is the sheet\'s own --rvc-vh / --rvc-vt, which carry fallbacks)', undef.length === 0, undef);
  var planTokens = ['surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'text', 'text-muted', 'text-faint', 'accent', 'accent-strong', 'accent-soft', 'accent-contrast',
    'crit', 'crit-soft', 'ok', 'ok-soft', 'draft', 'draft-soft', 'shadow-md', 'shadow-lg', 'r-sm', 'r-lg', 'font-body'];
  check('C.9 it uses the console tokens of plan §7b', planTokens.every(function (t) { return aliases.some(function (c) { return c.name === '--' + t; }); }));

  function mediaBlock(q) { var i = css.indexOf('@media ' + q); return i === -1 ? '' : block(css, '@media ' + q); }
  var phone = mediaBlock('(max-width:600px)');
  check('C.9 phones: a full-screen sheet with 100dvh and the safe areas', /\.rvc-panel\{[^}]*left:0; right:0; top:0; bottom:0;[^}]*height:100dvh/.test(phone) && /env\(safe-area-inset-top/.test(phone) && /env\(safe-area-inset-bottom/.test(phone));
  check('C.9 phones: a 16px textarea (no zoom on iOS)', /\.rvc-input\{[^}]*font-size:16px/.test(phone));
  check('C.9 phones: 44px Close and Send, 44px buttons', /\.rvc-close\{[^}]*width:44px; height:44px/.test(phone) && /\.rvc-send\{[^}]*width:44px; height:44px/.test(phone) && /\.rvc-btn, \.rvc-choice, \.rvc-suggestion\{ min-height:44px/.test(phone));
  check('C.9 phones: a 52px round launcher, label hidden, above the home bar', /\.rvc-launcher\{[^}]*bottom:calc\(16px \+ env\(safe-area-inset-bottom[^}]*width:52px; height:52px[^}]*border-radius:50%/.test(phone) && /\.rvc-launcher-label\{ display:none; \}/.test(phone));
  check('C.9 phones: the keyboard-aware height', /\.rvc-panel\.rvc-has-vv\{[^}]*height:var\(--rvc-vh/.test(phone));
  var narrow = mediaBlock('(max-width:880px)');
  check('C.9 601–880px: the panel is 380px at 16px from the left', /\.rvc-panel\{ left:16px; width:380px; max-width:calc\(100vw - 32px\); z-index:69; \}/.test(narrow));
  check('C.9 desktop: the panel at left 22, bottom 84, 400 wide, never taller than the room under the nav', /\.rvc-panel\{[^}]*left:22px; bottom:84px; z-index:85;[^}]*width:400px;[^}]*height:min\(640px, calc\(100vh - 156px\)\)/.test(css));
  check('C.9 the folded bar: as wide as the panel, above the launcher, its label on up to two lines (not cut to "Showing Draft eve…")',
    /\.rvc-peek\{[^}]*left:22px; bottom:84px; z-index:65;[^}]*width:400px;[^}]*min-height:48px/.test(css) && /\.rvc-peek-label\{[^}]*-webkit-line-clamp:2/.test(css) && !/\.rvc-peek-label\{[^}]*white-space:nowrap/.test(css));
  check('C.9 desktop: the launcher in the old "Need help?" place', /\.rvc-launcher\{[^}]*position:fixed; left:22px; bottom:22px; z-index:65;/.test(css));
  var rm = mediaBlock('(prefers-reduced-motion: reduce)');
  check('C.9 reduced motion: animations off, the countdown bar still and full', /animation:none !important/.test(rm) && /\.rvc-cd-bar i\{ width:100%; \}/.test(rm) && /\.rvc-spin/.test(rm));
  var zs = (css.match(/z-index:\s*(\d+)/g) || []).map(function (z) { return Number(z.replace(/\D/g, '')); });
  check('C.9 layers: only 65 (launcher, bar), 85 (panel) and 69 (the panel from 601 to 880px)', zs.length === 5 && zs.every(function (z) { return z === 65 || z === 69 || z === 85; }) &&
    /\.rvc-peek\{[^}]*z-index:65/.test(css), zs);
  /* the page's own layers, read from Event_Listing.html, against the kit's at each width */
  function zOf(src, re) { var mz = re.exec(src); return mz ? Number(mz[1]) : NaN; }
  var Z = {
    sheet: zOf(PAGE, /\.bottom-sheet-scrim\{[^}]*z-index:(\d+)/), nav: zOf(PAGE, /\.main-nav\{[^}]*z-index:(\d+)/), popover: zOf(PAGE, /\.popover\{[^}]*z-index:(\d+)/),
    modal: zOf(PAGE, /\.modal-scrim\{[^}]*z-index:(\d+)/), toast: zOf(PAGE, /#toast-region\{[^}]*z-index:(\d+)/)
  };
  var K = {
    launcher: zOf(css, /\.rvc-launcher\{[^}]*z-index:(\d+)/), peek: zOf(css, /\.rvc-peek\{[^}]*z-index:(\d+)/), panel: zOf(css, /\.rvc-panel\{[^}]*z-index:(\d+)/),
    panelNarrow: zOf(narrow, /\.rvc-panel\{[^}]*z-index:(\d+)/), panelPhone: zOf(phone, /\.rvc-panel\{[^}]*z-index:(\d+)/)
  };
  check('C.9 the page\'s layers were read (Filters sheet, nav, popovers, modals, toasts)', [Z.sheet, Z.nav, Z.popover, Z.modal, Z.toast].every(function (z) { return z > 0; }), Z);
  check('C.9 the page\'s Filters button is hidden only above 880px (so from 601 to 880px it sits beside the open panel)',
    /@media \(min-width:881px\)\{ \.mobile-only\{ display:none !important; \} \}/.test(PAGE) && /<button class="[^"]*\bmobile-only\b[^"]*" id="btn-mobile-filters">/.test(PAGE));
  check('C.9 the launcher and the folded bar: above the nav and popovers, below the Filters sheet', K.launcher === K.peek && K.launcher > Z.nav && K.launcher > Z.popover && K.launcher < Z.sheet, { K: K, Z: Z });
  check('C.9 601–880px: the open panel is below the Filters sheet and its scrim, so the sheet opens over it', K.panelNarrow < Z.sheet, { panel: K.panelNarrow, sheet: Z.sheet });
  check('C.9 601–880px: … and still above the nav, the popovers, the launcher and the bar', K.panelNarrow > Z.nav && K.panelNarrow > Z.popover && K.panelNarrow > K.launcher, K);
  check('C.9 desktop and phone: the panel is above the page, below modals and toasts', K.panel === 85 && K.panelPhone === 85 && K.panel < Z.modal && Z.modal < Z.toast && K.panel > Z.sheet, { K: K, Z: Z });
  check('C.9 :focus-visible rules', /\.rvc :focus-visible\{ outline:2px solid var\(--rvc-accent\)/.test(css) && /\.rvc-launcher:focus-visible/.test(css) && /\.rvc-compose:focus-within/.test(css));
  check('C.9 the console\'s :focus-visible {border-radius:4px} cannot square the round launcher or the buttons',
    /:focus-visible\{[^}]*border-radius:4px/.test(PAGE) && /\.rvc \.rvc-launcher:focus-visible\{ border-radius:100px; \}/.test(css) && /\.rvc \.rvc-launcher:focus-visible\{ border-radius:50%; \}/.test(phone) &&
    /\.rvc \.rvc-send:focus-visible/.test(css) && /\.rvc \.rvc-btn:focus-visible/.test(css));
  check('C.9 the kit does not hide the page\'s help button (the page does that, under html.rvc-ready)', CSS.indexOf('help-fab') === -1);
  check('C.9 the page is locked behind the phone sheet', /html\.rvc-lock, html\.rvc-lock body\{ overflow:hidden; \}/.test(css));
  check('C.9 hidden wins over the kit\'s own display rules', /\.rvc \[hidden\]\{ display:none !important; \}/.test(css));
  check('C.9 names wrap rather than push the sheet sideways', /\.rvc-msg\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/.test(css) && /\.rvc-row-name\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/.test(css));

  /* ======== C.10 the pairs pass WCAG AA, light and dark ======== */
  function lum(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [0, 2, 4].map(function (i) { var c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
      .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function ratio(a, b2) { var x = lum(a), y = lum(b2); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var PAIRS = [
    ['text', 'surface', 4.5, 'words on the panel'], ['text', 'surface-2', 4.5, 'an answer'], ['text', 'accent-soft', 4.5, 'the person\'s bubble'],
    ['text-muted', 'surface', 4.5, 'the foot note, the welcome, the status'], ['text-muted', 'surface-2', 4.5, '"as of", notes and missing parts in an answer'],
    ['accent-strong', 'surface', 4.5, 'links in a list card'], ['accent-strong', 'surface-2', 4.5, 'links in an answer and the help button on hover'],
    ['crit', 'crit-soft', 4.5, 'an error'], ['crit', 'surface', 4.5, '"Not sent"'],
    ['accent-contrast', 'accent-strong', 4.5, 'a primary button'],
    ['text', 'draft-soft', 4.5, 'the Draft chip'], ['text', 'ok-soft', 4.5, 'the Active chip'], ['text', 'warn-soft', 4.5, 'the Cancelled chip'],
    ['text', 'crit-soft', 4.5, 'the Deleted chip'], ['text', 'surface-3', 4.5, 'the Completed chip and the count'],
    ['accent', 'surface', 3, 'the Send button and the focus ring against the panel'], ['accent-contrast', 'accent', 3, 'the Send icon']
  ];
  [['light', LIGHT], ['dark', DARK]].forEach(function (th) {
    PAIRS.forEach(function (p) {
      var a = th[1][p[0]], c = th[1][p[1]];
      var r = a && c ? ratio(a, c) : 0;
      check('C.10 ' + th[0] + ': --' + p[0] + ' on --' + p[1] + ' ≥ ' + p[2] + ' (' + p[3] + ')', r >= p[2], { ratio: Math.round(r * 100) / 100, fg: a, bg: c });
    });
  });
  check('C.10 the "as of" line uses --text-muted, not the too-pale --text-faint', /\.rvc-asof\{[^}]*color:var\(--rvc-text-muted\)/.test(css) && ratio(LIGHT['text-faint'], LIGHT['surface-2']) < 4.5);
  check('C.10 chip words are --text (the page\'s own status colours as words would fail AA)', /\.rvc-chip\{[^}]*color:var\(--rvc-text\)/.test(css) && ratio(LIGHT.draft, LIGHT['draft-soft']) < 4.5);
  check('C.10 a primary button is on --accent-strong (white on --accent fails AA at this size)', /\.rvc-btn-primary\{ background:var\(--rvc-accent-strong\)/.test(css) && ratio(LIGHT['accent-contrast'], LIGHT.accent) < 4.5);

  if (failed) { console.error('etb2b-chat: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('etb2b-chat: all ' + passed + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.error('etb2b-chat: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
