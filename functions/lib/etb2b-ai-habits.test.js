// node functions/lib/etb2b-ai-habits.test.js — ETB2B AI learns, part 1, in the browser (etb2b-ai-habits.js, with the
// chat kit etb2b-chat.js it draws into): the one-click suggestions, "Save as shortcut", the person's shortcuts and a
// shortcut's run.
//   B.1  the kit's one-click row (setChips): above the box, a label, the chips and Shortcuts; a chip SENDS; locked
//        while an answer is awaited; the quick ideas stand aside while it shows; the arrow keys move along it
//   B.2  the kit's ask(), currentAnswer(), isBusy(), undoBind / undoRun / undoState, leaveCount()
//   B.3  the pure parts: which answers may be saved, what became of a request of a run, the offered name, the row's
//        label, what the server's lists are read as
//   B.4  attached to the panel: the suggestions are read when the panel first opens, for this page and this event;
//        their titles say whose they are; one click sends the request as a typed message would
//   B.5  "Save as shortcut" only under an answer that did what was asked; the form (name offered, Enter saves, Escape
//        cancels), a new shortcut or one more request in one, what the server says when it cannot
//   B.6  the shortcuts list in the conversation: Run, Rename, Delete (asked first), Escape closes it
//   B.7  a run: each request sent in order and answered, no "Save as shortcut" while it runs, a list with Undo per
//        request and Undo all (newest first, the brains' own Undo say "Undone" with it); a failure goes on, one that
//        cannot be tried again ends it; Stop ends it
//   B.8  a request that opens a page: Stay here keeps the run here; the page opening carries the rest of the run to
//        it, which goes on there on the same event only (another event: fail closed, nothing sent)
// The kit and the file run in a vm over a small DOM (as functions/lib/etb2b-chat.test.js), with a scripted server.
// No network, no AI. Exits 1 on any failure.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var KIT = fs.readFileSync(path.join(ROOT, 'etb2b-chat.js'), 'utf8');
var SRC = fs.readFileSync(path.join(ROOT, 'etb2b-ai-habits.js'), 'utf8');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : ''));
}
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
async function until(pred, ms) {
  var end = Date.now() + (ms || 1500);
  while (Date.now() < end) { try { if (pred()) return true; } catch (e) { /* not yet */ } await tick(5); }
  try { return !!pred(); } catch (e) { return false; }
}

/* ================= a small DOM (as functions/lib/etb2b-chat.test.js) ================= */
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
function reflect(prop, attr) { Object.defineProperty(EP, prop, { get: function () { var v = this.getAttribute(attr); return v == null ? '' : v; }, set: function (v) { this.setAttribute(attr, v); } }); }
function flag(prop, attr) { Object.defineProperty(EP, prop, { get: function () { return this.hasAttribute(attr); }, set: function (v) { if (v) this.setAttribute(attr, ''); else this.removeAttribute(attr); } }); }
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
EP.click = function () { if (this.disabled) return; dispatch(this, new Ev('click')); };
EP.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b; };
EP.select = function () {};
EP.getBoundingClientRect = function () { return this._rect || ZERO; };
EP.closest = function (sel) { var t = compound(sel); for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (t(n)) return n; return null; };
EP.querySelector = function (sel) { var t = compound(sel), me = this; return all(this, function (e) { return e !== me && t(e); })[0] || null; };
function walk(n, fn) { if (!n) return; if (n.nodeType === 1) fn(n); (n.childNodes || []).forEach(function (c) { walk(c, fn); }); }
function all(n, pred) { var out = []; walk(n, function (e) { if (pred(e)) out.push(e); }); return out; }
function byClass(n, c) { return all(n, function (e) { return e.classList.contains(c); }); }
function compound(s) {
  var parts = [], rest = String(s).trim(), m;
  while (rest) {
    if ((m = /^#([\w-]+)/.exec(rest))) parts.push(function (id) { return function (e) { return e.getAttribute('id') === id; }; }(m[1]));
    else if ((m = /^\.([\w-]+)/.exec(rest))) parts.push(function (c) { return function (e) { return e.classList.contains(c); }; }(m[1]));
    else if ((m = /^\[([\w-]+)(?:="([^"]*)")?\]/.exec(rest))) parts.push(function (a, v) { return function (e) { return v === undefined ? e.hasAttribute(a) : e.getAttribute(a) === v; }; }(m[1], m[2]));
    else if ((m = /^([a-z][\w-]*)/.exec(rest))) parts.push(function (t) { return function (e) { return e.localName === t; }; }(m[1]));
    else throw new SyntaxError('bad selector: ' + s);
    rest = rest.slice(m[0].length);
  }
  return function (e) { return parts.every(function (p) { return p(e); }); };
}
function makeDoc() {
  var doc = { nodeType: 9, _ls: {}, parentNode: null };
  doc.createElement = function (t) { return new El(doc, t); };
  doc.createTextNode = function (s) { return new Tx(doc, s); };
  doc.addEventListener = addL; doc.removeEventListener = rmL;
  var html = new El(doc, 'html'); html.parentNode = doc;
  var body = new El(doc, 'body'); html.appendChild(body);
  doc.documentElement = html; doc.body = body; doc.activeElement = body; doc.head = body;
  doc.getElementById = function (id) { var hit = null; walk(html, function (e) { if (!hit && e.getAttribute('id') === id) hit = e; }); return hit; };
  doc.querySelectorAll = function (sel) { var t = compound(sel); return all(html, t); };
  doc.querySelector = function (sel) { return doc.querySelectorAll(sel)[0] || null; };
  return doc;
}
function memStore() {
  var m = {};
  return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; }, _m: m };
}
function btnIn(node, label) { return all(node, function (e) { return e.localName === 'button' && e.textContent === label; })[0] || null; }
function key(target, k) { var e = new Ev('keydown', { key: k }); dispatch(target, e); return e; }

var AUTO = 'autotech-summit-2026', RETAIL = 'retail-leaders-2026';
/* a page with the kit, the habits file, a scripted server and a scripted brain (standing in for the shell and its
   brains: the shell tells the habits file which brain answered, as etb2b-assistant.js does) */
function page(o) {
  o = o || {};
  var doc = makeDoc(), winLs = [];
  var server = { chips: o.chips || [], shortcuts: o.shortcuts || [], kindName: o.kindName || 'IP events', gets: [], posts: [], fail: null, seq: 0 };
  var sandbox = {
    document: doc, setTimeout: setTimeout, clearTimeout: clearTimeout,
    matchMedia: function (q) { return { media: q, matches: false, addEventListener: function () {} }; },
    navigator: { onLine: true }, console: { error: function () {}, warn: function () {}, log: function () {} },
    innerWidth: 1440, innerHeight: 900, requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
    addEventListener: function (t, fn) { winLs.push({ type: t, fn: fn }); }, removeEventListener: function () {},
    getComputedStyle: function () { return { visibility: 'visible', display: 'block' }; },
    location: { origin: 'http://localhost', pathname: '/edit-event.html', search: '?event=' + (o.eventId || AUTO) },
    sessionStorage: o.session || memStore(),
    RevampAuth: {
      authedFetch: function (url, opts) {
        var method = (opts && opts.method) || 'GET', body = opts && opts.body ? JSON.parse(opts.body) : undefined, status = 200, out = null;
        if (method === 'GET' && url.indexOf('/api/ai-habits?') === 0) {
          server.gets.push(url);
          out = { chips: server.chips, shortcuts: server.shortcuts, scope: 'event', kind: 'ip', kindName: server.kindName };
        } else if (method === 'POST' && url === '/api/ai-habits/shortcuts') {
          server.posts.push(body);
          if (server.fail) { status = server.fail.status; out = server.fail.body; server.fail = null; }
          else {
            var list = server.shortcuts, saved = null;
            if (body.op === 'add' && body.id) { list.forEach(function (x) { if (x.id === body.id) { x.steps.push({ text: body.text, page: body.page }); saved = { id: x.id, name: x.name, steps: x.steps.length }; } }); }
            else if (body.op === 'add') { var x = { id: 'abc' + String(++server.seq).padStart(9, '0'), name: body.name, steps: [{ text: body.text, page: body.page }] }; list.push(x); saved = { id: x.id, name: x.name, steps: 1 }; }
            else if (body.op === 'rename') list.forEach(function (y) { if (y.id === body.id) y.name = body.name; });
            else if (body.op === 'delete') server.shortcuts = list = list.filter(function (y) { return y.id !== body.id; });
            out = { shortcuts: JSON.parse(JSON.stringify(list)) };
            if (saved) out.saved = saved;
          }
        } else { status = 404; out = { error: 'no' }; }
        return Promise.resolve({ ok: status < 400, status: status, text: function () { return Promise.resolve(JSON.stringify(out)); } });
      }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(KIT, sandbox, { filename: 'etb2b-chat.js' });
  vm.runInContext(SRC, sandbox, { filename: 'etb2b-ai-habits.js' });
  var host = doc.createElement('div');
  doc.body.appendChild(host);
  var log = { sent: [] }, script = [], openFns = [], undos = {}, undoLog = [], habits = null;
  var chat = sandbox.RevampChat.mount(host, {
    id: 'ai', title: 'ETB2B AI', quickIdeas: o.quickIdeas || [],
    onOpenChange: function (v) { openFns.forEach(function (f) { f(v); }); },
    send: function (t) {
      log.sent.push(t);
      var f = script.shift();
      var p = f ? Promise.resolve().then(function () { return f(t); }) : Promise.resolve({ brain: 'dash', r: { kind: 'reply', turnId: 'TurnDefault0001', notes: [] } });
      return p.then(function (x) {
        if (habits) habits.turn({ text: t, brain: x.brain, result: x.r });
        return x.r;
      }, function (err) {
        if (habits) habits.turn({ text: t, brain: 'dash', error: err });
        throw err;
      });
    }
  });
  var place = { page: o.page || 'console', eventId: o.eventId === undefined ? AUTO : o.eventId, tab: '' };
  var H = sandbox.RevampAiHabits;
  var me = {
    doc: doc, win: sandbox, chat: chat, log: log, script: script, server: server, undos: undos, undoLog: undoLog, winLs: winLs, place: place,
    $: function (part) { return doc.getElementById('ai-chat-' + part); },
    attach: function () { habits = H.attach({ chat: function () { return chat; }, place: function () { return place; }, promoKind: function () { return o.promo || ''; },
      undoHandle: function (b, id) { return undos[id] || null; }, onOpenChange: function (f) { openFns.push(f); } }); return habits; },
    H: H, thread: function () { return doc.getElementById('ai-chat-thread'); },
    /* a brain's answer that made a change, with its own Undo bound to a handler the hub can hand out */
    change: function (turnId, words, brain) {
      return function () {
        var b = chat.ai(words || 'Done.', {});
        var h = function () { undoLog.push(turnId); return true; };
        undos[turnId] = h;
        b.undo(h);
        return { brain: brain || 'edit', r: { kind: 'edit', status: 'applied', turnId: turnId } };
      };
    },
    /* a dash answer that opens a page after a short "Opening …" */
    opens: function (turnId, ms, gone) {
      return function () {
        var b = chat.ai('Opening the speakers.', {});
        b.countdown(ms || 40, 'Opening Speakers…', function () {}, function () { if (gone) gone(); });
        return { brain: 'dash', r: { kind: 'open', turnId: turnId, notes: [] } };
      };
    }
  };
  return me;
}

(async function () {
  /* ======== B.3 pure parts ======== */
  (function () {
    var e = page(), T = e.H._test;
    check('B.3 worked: a dash answer kept, a page opened, a question answered', T.worked('dash', { kind: 'reply', turnId: 'TurnAAAAAAAAAA01', notes: [] }) && T.worked('dash', { kind: 'open', turnId: 'TurnAAAAAAAAAA01' }) && T.worked('dash', { kind: 'filter', turnId: 'TurnAAAAAAAAAA01' }));
    check('B.3 …never a refusal, a question back, an undo, one not kept or "an event I could not find"', !T.worked('dash', { kind: 'refuse', turnId: 'TurnAAAAAAAAAA01' }) && !T.worked('dash', { kind: 'choose', turnId: 'TurnAAAAAAAAAA01' }) &&
      !T.worked('dash', { kind: 'undo', turnId: 'TurnAAAAAAAAAA01' }) && !T.worked('dash', { kind: 'reply' }) && !T.worked('dash', { kind: 'reply', turnId: 'TurnAAAAAAAAAA01', notes: ['not-found'] }) && !T.worked('dash', { handoff: true, kind: 'handoff' }));
    check('B.3 worked: an editor\'s change applied or partly, never a reply, a failed or stopped one', T.worked('edit', { kind: 'edit', status: 'applied' }) && T.worked('promo', { kind: 'edit', status: 'partly' }) &&
      !T.worked('edit', { kind: 'reply' }) && !T.worked('edit', { kind: 'edit', status: 'failed' }) && !T.worked('promo', { kind: 'edit', status: 'stopped' }) && !T.worked('', { kind: 'edit', status: 'applied' }));
    check('B.3 stateOf', T.stateOf('dash', { kind: 'open', turnId: 'TurnAAAAAAAAAA01' }, true) === 'opened' && T.stateOf('dash', { kind: 'reply', turnId: 'TurnAAAAAAAAAA01' }) === 'answered' &&
      T.stateOf('dash', { kind: 'refuse', turnId: 'TurnAAAAAAAAAA01' }) === 'failed' && T.stateOf('edit', { kind: 'edit', status: 'partly' }) === 'partly' && T.stateOf('edit', { kind: 'stopped' }) === 'stopped' && T.stateOf('edit', null) === 'failed');
    check('B.3 the name offered is the request\'s first words', T.nameFor('Make a save-the-date post and an announcement mailer') === 'Make a save-the-date post…' && T.nameFor('Shorten the title') === 'Shorten the title', T.nameFor('Make a save-the-date post and an announcement mailer'));
    check('B.3 the row\'s label says whose they are', T.rowLabel([{ from: 'you' }], '') === 'You often ask' && T.rowLabel([{ from: 'team' }], 'IP events') === 'Often asked for IP events' &&
      T.rowLabel([{ from: 'team' }], '') === 'Often asked here' && T.rowLabel([{ from: 'you' }, { from: 'team' }], 'IP events') === 'Often asked' && T.rowLabel([], '') === '');
    check('B.3 the server\'s lists are read safely (four chips at most, real shortcuts only)', T.cleanChips([1, { label: 'a' }, { label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }, { label: 'D', text: 'd' }, { label: 'E', text: 'e' }]).length === 4 &&
      T.cleanShortcuts([{ id: 'x', name: 'n', steps: [{ text: 'a' }] }, { id: 'abcdefabcdef', name: 'ok', steps: [{ text: '' }] }, { id: 'abcdefabcde1', name: 'ok', steps: [{ text: 'go' }] }]).length === 1);
  })();

  /* ======== B.1 / B.2 the kit's row and calls ======== */
  await (async function () {
    var e = page({ quickIdeas: [{ label: 'An idea', text: 'An idea' }] });
    var row = e.$('chips');
    check('B.1 no row until a page sets one', row && row.hidden === true);
    var clicks = [];
    e.chat.setChips({ label: 'You often ask', hint: 'One click sends it.', items: [{ label: 'Shorten title', title: 'Sends it', onClick: function () { clicks.push('a'); } }, { label: 'Open speakers', onClick: function () { clicks.push('b'); } }],
      more: { label: 'Shortcuts (2)', title: 'Yours', onClick: function () { clicks.push('more'); } } });
    var chips = byClass(row, 'rvc-chip-btn'), more = byClass(row, 'rvc-chip-more')[0];
    var panel = e.$('panel');
    check('B.1 the row: a label, the chips and Shortcuts, above the box', row.hidden === false && byClass(row, 'rvc-chiprow-label')[0].textContent === 'You often ask' && chips.length === 2 && more.textContent === 'Shortcuts (2)' &&
      panel.childNodes.indexOf(row) === panel.childNodes.indexOf(byClass(panel, 'rvc-compose')[0]) - 1 && row.getAttribute('role') === 'group' && row.getAttribute('aria-label') === 'You often ask');
    check('B.1 a chip says what it does (its title, and the hint for screen readers)', chips[0].getAttribute('title') === 'Sends it' && e.doc.getElementById(chips[0].getAttribute('aria-describedby')).textContent === 'One click sends it.');
    chips[1].click(); more.click();
    check('B.1 a chip\'s click is its own, and so is Shortcuts\'', clicks.join() === 'b,more');
    chips[0].focus();
    key(chips[0], 'ArrowRight');
    check('B.1 the arrow keys move along the row', e.doc.activeElement === chips[1]);
    key(chips[1], 'ArrowRight');
    check('B.1 …to Shortcuts, and End / Home to its ends', e.doc.activeElement === more && (key(more, 'Home'), e.doc.activeElement === chips[0]));
    e.chat.open();
    e.chat.ai('Hello');
    check('B.1 the quick ideas stand aside while the row shows', e.$('quick').hidden === true);
    var hold = null;
    e.script.push(function () { return new Promise(function (r) { hold = r; }); });
    var asked = e.chat.ask('How many registrations?');
    await until(function () { return e.log.sent.length === 1; });
    check('B.2 ask() sends as typed: the person\'s bubble, then the send', e.log.sent[0] === 'How many registrations?' && /How many registrations\?/.test(e.thread().textContent));
    check('B.1 the row is locked while an answer is awaited', chips[0].getAttribute('aria-disabled') === 'true' && (chips[0].click(), clicks.length === 2) && e.chat.isBusy() === true);
    var again = await e.chat.ask('Something else');
    check('B.2 ask() while a message is answered sends nothing', again.busy === true && e.log.sent.length === 1);
    var b = e.chat.ai('42 registrations so far.', {});
    check('B.2 currentAnswer(): the answer drawn for the message being answered', e.chat.currentAnswer() === b);
    hold({ brain: 'dash', r: { kind: 'reply', turnId: 'TurnAAAAAAAAAA01' } });
    var done = await asked;
    check('B.2 …it says how it ended, and the row is free again', done.ok === true && done.result.kind === 'reply' && chips[0].getAttribute('aria-disabled') === null && e.chat.currentAnswer() === null && e.chat.isBusy() === false);
    e.script.push(function () { return Promise.reject(new Error('That did not work.')); });
    var bad = await e.chat.ask('Fail please');
    check('B.2 a failure is said, as for a typed message', bad.ok === false && /That did not work\./.test(e.thread().textContent));
    /* undoBind / undoRun / undoState: one change, two Undo controls */
    var undone = 0, own = e.chat.ai('Changed.', {});
    var h = function () { undone++; return true; };
    var ownBtn = own.undo(h);
    var mine = e.doc.createElement('button');
    mine.textContent = 'Undo';
    e.chat.undoBind(mine, h);
    check('B.2 undoState before', e.chat.undoState(h) === 'ready' && e.chat.undoState(function () {}) === 'none');
    var ok = await e.chat.undoRun(h);
    check('B.2 undoRun: undone once, and both controls say "Undone"', ok === true && undone === 1 && ownBtn.textContent === 'Undone' && mine.textContent === 'Undone' && e.chat.undoState(h) === 'done');
    check('B.2 …a second undoRun does nothing more', (await e.chat.undoRun(h)) === true && undone === 1);
    var no = function () { return Promise.resolve(false); }, nb = e.chat.ai('Another.', {}).undo(no);
    check('B.2 undoRun of one that could not be undone: false, its Undo ready again', (await e.chat.undoRun(no)) === false && nb.textContent === 'Undo' && e.chat.undoState(no) === 'ready');
    var c0 = e.chat.leaveCount();
    e.chat.ai('Opening.', {}).countdown(20, 'Opening Speakers…', function () {}, function () {});
    check('B.2 isLeaving while "Opening …" runs', e.chat.isLeaving() === true);
    await until(function () { return !e.chat.isLeaving(); });
    check('B.2 leaveCount: one ran out', e.chat.leaveCount().went === c0.went + 1 && e.chat.leaveCount().stayed === c0.stayed);
    e.chat.setChips(null);
    check('B.1 setChips(null) takes the row away and the quick ideas come back', row.hidden === true && e.$('quick').hidden === false);
  })();

  /* ======== B.4 attached: the suggestions ======== */
  var CHIPS = [{ label: 'Count registrations', text: 'How many registrations so far?', from: 'you', count: 5 }, { label: 'Open speakers', text: 'Open the speakers', from: 'team', count: 9 }];
  await (async function () {
    var e = page({ chips: CHIPS, shortcuts: [{ id: 'abcdefabcdef', name: 'My launch set', steps: [{ text: 'a', page: 'console' }] }] });
    var api = e.attach();
    check('B.4 attached; Shortcuts shows at once, nothing is read before the panel opens', !!api && byClass(e.$('chips'), 'rvc-chip-more').length === 1 && e.server.gets.length === 0);
    e.chat.open();
    await until(function () { return byClass(e.$('chips'), 'rvc-chip-btn').length === 2; });
    check('B.4 read when the panel first opens, for this page and this event', e.server.gets.length === 1 && e.server.gets[0] === '/api/ai-habits?page=console&eventId=' + AUTO, e.server.gets);
    var row = e.$('chips'), chips = byClass(row, 'rvc-chip-btn');
    check('B.4 the chips, labelled for whose they are, with what they send in their titles', byClass(row, 'rvc-chiprow-label')[0].textContent === 'Often asked' &&
      chips[0].textContent === 'Count registrations' && chips[0].getAttribute('title') === '“How many registrations so far?” (you asked this 5 times)' &&
      chips[1].getAttribute('title') === '“Open the speakers” (your team asked this 9 times)' && byClass(row, 'rvc-chip-more')[0].textContent === 'Shortcuts (1)', [chips[0].getAttribute('title'), chips[1].getAttribute('title')]);
    chips[0].click();
    await until(function () { return e.log.sent.length === 1; });
    check('B.4 one click sends the request, as a typed message would', e.log.sent[0] === 'How many registrations so far?');
    await tick(20);
    e.chat.close(); e.chat.open();
    await tick(20);
    check('B.4 read again after a turn at most every 30 s (not on every open)', e.server.gets.length === 1, e.server.gets.length);
    e.server.chips = [];
    await api.refresh();
    check('B.4 no chips: only Shortcuts is left in the row', byClass(e.$('chips'), 'rvc-chip-btn').length === 0 && e.$('chips').hidden === false);
  })();

  /* ======== B.5 Save as shortcut ======== */
  await (async function () {
    var e = page({ chips: [] });
    e.attach();
    e.chat.open();
    e.script.push(function () { e.chat.ai('I can’t do that here.', {}); return { brain: 'dash', r: { kind: 'refuse', turnId: 'TurnRRRRRRRRRR01' } }; });
    await e.chat.ask('Delete this event');
    check('B.5 never under a refusal', !btnIn(e.thread(), 'Save as shortcut'));
    e.script.push(function () { var b = e.chat.ai('That change could not be made.', {}); return { brain: 'edit', r: { kind: 'edit', status: 'failed', turnId: 'TurnFFFFFFFFFF01' } }; });
    await e.chat.ask('Make it pop');
    check('B.5 never under a change that failed', !btnIn(e.thread(), 'Save as shortcut'));
    e.script.push(e.change('TurnSSSSSSSSSS01', 'I shortened the hero title.'));
    await e.chat.ask('Make a save-the-date post and an announcement mailer for this event');
    var save = btnIn(e.thread(), 'Save as shortcut');
    check('B.5 under an answer that did what was asked', !!save);
    save.click();
    var form = byClass(e.thread(), 'rvc-hb-save')[0], input = form && byClass(form, 'rvc-hb-input')[0];
    check('B.5 the form: its name offered from the request, focused; no "Add it to" with no shortcuts yet', !!input && input.value === 'Make a save-the-date post…' && e.doc.activeElement === input &&
      !byClass(form, 'rvc-hb-select').length && save.getAttribute('aria-disabled') === 'true');
    key(input, 'Escape');
    check('B.5 Escape cancels the form, not the panel', !byClass(e.thread(), 'rvc-hb-save').length && e.chat.isOpen() === true && save.getAttribute('aria-disabled') === null && e.doc.activeElement === save);
    save.click();
    form = byClass(e.thread(), 'rvc-hb-save')[0]; input = byClass(form, 'rvc-hb-input')[0];
    input.value = '';
    btnIn(form, 'Save').click();
    check('B.5 no name: said, nothing sent', byClass(form, 'rvc-hb-err')[0].textContent === 'Give the shortcut a name.' && e.server.posts.length === 0);
    input.value = 'My launch set';
    e.server.fail = { status: 409, body: { error: 'You already have a shortcut called “My launch set”. Choose another name, or add this request to it.', code: 'name-taken' } };
    key(input, 'Enter');
    await until(function () { return !byClass(form, 'rvc-hb-err')[0].hidden; });
    check('B.5 Enter saves; what the server says when it cannot is shown', e.server.posts.length === 1 && /already have a shortcut called/.test(byClass(form, 'rvc-hb-err')[0].textContent));
    key(input, 'Enter');
    await until(function () { return !byClass(e.thread(), 'rvc-hb-save').length; });
    var p = e.server.posts[1];
    check('B.5 saved: the request\'s words, this page and this event, the name', p.op === 'add' && p.text === 'Make a save-the-date post and an announcement mailer for this event' && p.page === 'console' && p.eventId === AUTO && p.name === 'My launch set' && !p.id, p);
    check('B.5 …"Saved", a note saying where to run it, and Shortcuts counts it', save.textContent === 'Saved' && /Saved as “My launch set”\. Run it from Shortcuts/.test(e.thread().textContent) &&
      byClass(e.$('chips'), 'rvc-chip-more')[0].textContent === 'Shortcuts (1)');
    /* one more request into the shortcut the person has */
    e.script.push(e.change('TurnSSSSSSSSSS02', 'Done.', 'promo'));
    await e.chat.ask('Use the site banner on the post');
    var save2 = all(e.thread(), function (x) { return x.localName === 'button' && x.textContent === 'Save as shortcut'; }).pop();
    save2.click();
    var f2 = byClass(e.thread(), 'rvc-hb-save')[0], sel = byClass(f2, 'rvc-hb-select')[0];
    check('B.5 with shortcuts: "Add it to" a new one or one of them', !!sel && sel.childNodes.length === 2 && sel.childNodes[1].textContent === 'My launch set (1 request)');
    sel.value = sel.childNodes[1].value;
    dispatch(sel, new Ev('change'));
    btnIn(f2, 'Save').click();
    await until(function () { return e.server.posts.length === 3 && !byClass(e.thread(), 'rvc-hb-save').length; });
    check('B.5 added to it: its id, no name', e.server.posts[2].id === sel.childNodes[1].value && !e.server.posts[2].name && /Added to “My launch set”, which now holds 2 requests\./.test(e.thread().textContent), e.server.posts[2]);
  })();

  /* ======== B.6 the shortcuts list ======== */
  await (async function () {
    var e = page({ shortcuts: [{ id: 'abcdefabcdef', name: 'My launch set', steps: [{ text: 'Post', page: 'console' }, { text: 'Mailer', page: 'console' }] }, { id: 'abcdefabcde2', name: 'Numbers', steps: [{ text: 'How many?', page: 'console' }] }] });
    e.attach();
    e.chat.open();
    await until(function () { return e.server.gets.length === 1 && byClass(e.$('chips'), 'rvc-chip-more')[0].textContent === 'Shortcuts (2)'; });
    byClass(e.$('chips'), 'rvc-chip-more')[0].click();
    var card = byClass(e.thread(), 'rvc-hb-shortcuts')[0];
    var items = card ? byClass(card, 'rvc-hb-item') : [];
    check('B.6 the list in the conversation: each with its requests, Run, Rename, Delete; Run focused', items.length === 2 && /My launch set2 requests/.test(items[0].textContent) &&
      !!btnIn(items[0], 'Run') && btnIn(items[0], 'Run').getAttribute('aria-label') === 'Run My launch set' && !!btnIn(items[0], 'Rename') && !!btnIn(items[0], 'Delete') && e.doc.activeElement === btnIn(items[0], 'Run'));
    btnIn(items[1], 'Rename').click();
    var ri = byClass(items[1], 'rvc-hb-input')[0];
    check('B.6 Rename: the name in a box', !!ri && ri.value === 'Numbers' && e.doc.activeElement === ri);
    ri.value = 'Registrations so far';
    key(ri, 'Enter');
    await until(function () { return e.server.posts.length === 1 && /Renamed to “Registrations so far”\./.test(e.thread().textContent); });
    check('B.6 …renamed on the server, the list drawn again', e.server.posts[0].op === 'rename' && e.server.posts[0].id === 'abcdefabcde2' && /Registrations so far/.test(byClass(e.thread(), 'rvc-hb-shortcuts')[0].textContent) && byClass(e.thread(), 'rvc-hb-shortcuts').length === 1);
    card = byClass(e.thread(), 'rvc-hb-shortcuts')[0];
    items = byClass(card, 'rvc-hb-item');
    btnIn(items[0], 'Delete').click();
    check('B.6 Delete asks first ("Keep it" is focused)', /Delete “My launch set”\? This can’t be undone\./.test(items[0].textContent) && e.doc.activeElement === btnIn(items[0], 'Keep it') && e.server.posts.length === 1);
    btnIn(items[0], 'Keep it').click();
    check('B.6 Keep it: nothing deleted', !!btnIn(items[0], 'Run') && e.server.posts.length === 1);
    btnIn(items[0], 'Delete').click();
    all(items[0], function (x) { return x.localName === 'button' && x.textContent === 'Delete'; })[0].click();
    await until(function () { return e.server.posts.length === 2 && /“My launch set” is deleted\./.test(e.thread().textContent); });
    check('B.6 …deleted on the server; the row counts one', e.server.posts[1].op === 'delete' && byClass(e.$('chips'), 'rvc-chip-more')[0].textContent === 'Shortcuts (1)');
    card = byClass(e.thread(), 'rvc-hb-shortcuts')[0];
    key(btnIn(card, 'Run'), 'Escape');
    check('B.6 Escape closes the list (the panel stays open)', !byClass(e.thread(), 'rvc-hb-shortcuts').length && e.chat.isOpen() === true);
    byClass(e.$('chips'), 'rvc-chip-more')[0].click();
    byClass(e.$('chips'), 'rvc-chip-more')[0].click();
    check('B.6 Shortcuts again closes it', !byClass(e.thread(), 'rvc-hb-shortcuts').length);
  })();

  /* ======== B.7 a run ======== */
  await (async function () {
    var steps = [{ text: 'Shorten the hero title', page: 'editor' }, { text: 'Make the background darker', page: 'editor' }, { text: 'Add a speakers section', page: 'editor' }];
    var e = page({ page: 'editor', shortcuts: [{ id: 'abcdefabcdef', name: 'Hero refresh', steps: steps }] });
    e.attach();
    e.chat.open();
    await until(function () { return byClass(e.$('chips'), 'rvc-chip-more')[0].textContent === 'Shortcuts (1)'; });
    e.script.push(e.change('TurnRun0000001'), e.change('TurnRun0000002'), e.change('TurnRun0000003'));
    byClass(e.$('chips'), 'rvc-chip-more')[0].click();
    btnIn(byClass(e.thread(), 'rvc-hb-shortcuts')[0], 'Run').click();
    await until(function () { return byClass(e.thread(), 'rvc-hb-steps').length === 1; }, 3000);
    check('B.7 each request sent in order, on this page', e.log.sent.join('|') === steps.map(function (s) { return s.text; }).join('|'), e.log.sent);
    check('B.7 the list closes and the run says what it does', !byClass(e.thread(), 'rvc-hb-shortcuts').length && /Running “Hero refresh”: 3 requests, one after another\./.test(e.thread().textContent));
    check('B.7 no "Save as shortcut" while a shortcut runs', !btnIn(e.thread(), 'Save as shortcut'));
    var list = byClass(e.thread(), 'rvc-hb-steps')[0], rows = byClass(list, 'rvc-hb-step');
    check('B.7 the end: how many were done, each request with its state and its Undo', /“Hero refresh”: 3 of 3 done\./.test(e.thread().textContent) && rows.length === 3 &&
      rows.every(function (r) { return /Done/.test(r.textContent) && byClass(r, 'rvc-undo').length === 1; }) && !!btnIn(e.thread(), 'Undo all'));
    var stepUndo = byClass(rows[1], 'rvc-undo')[0];
    check('B.7 a request\'s Undo is described by its words', e.doc.getElementById(stepUndo.getAttribute('aria-describedby')).textContent === '2. Make the background darker');
    stepUndo.click();
    await until(function () { return e.undoLog.length === 1; });
    var ownUndos = all(e.thread(), function (x) { return x.classList.contains('rvc-undo') && !list.contains(x); });
    check('B.7 Undo per request: that one only, and the answer\'s own Undo says "Undone" with it', e.undoLog.join() === 'TurnRun0000002' && stepUndo.textContent === 'Undone' && ownUndos[1].textContent === 'Undone' && ownUndos[0].textContent === 'Undo');
    btnIn(e.thread(), 'Undo all').click();
    await until(function () { return btnIn(e.thread(), 'All undone'); });
    check('B.7 Undo all: the rest, newest first, each once', e.undoLog.join() === 'TurnRun0000002,TurnRun0000003,TurnRun0000001' && ownUndos.every(function (x) { return x.textContent === 'Undone'; }), e.undoLog);
    check('B.7 the run is not carried anywhere once it ends', e.win.sessionStorage.getItem('rv.aiHabits.run') === null);

    /* a failure goes on with the rest; one that cannot be tried again ends the run */
    e.log.sent.length = 0;
    e.script.push(function () { return Promise.reject(new Error('ETB2B AI is busy right now.')); }, e.change('TurnRun0000005'), e.change('TurnRun0000006'));
    byClass(e.$('chips'), 'rvc-chip-more')[0].click();
    btnIn(byClass(e.thread(), 'rvc-hb-shortcuts')[0], 'Run').click();
    await until(function () { return byClass(e.thread(), 'rvc-hb-steps').length === 2; }, 3000);
    var l2 = byClass(e.thread(), 'rvc-hb-steps')[1];
    check('B.7 a failed request: said, and the run goes on', e.log.sent.length === 3 && /Not done/.test(byClass(l2, 'rvc-hb-step')[0].textContent) && /2 of 3 done/.test(e.thread().textContent));
    e.log.sent.length = 0;
    e.script.push(function () { var x = new Error('You have used today’s ETB2B AI allowance.'); x.retryable = false; return Promise.reject(x); });
    byClass(e.$('chips'), 'rvc-chip-more')[0].click();
    btnIn(byClass(e.thread(), 'rvc-hb-shortcuts')[0], 'Run').click();
    await until(function () { return byClass(e.thread(), 'rvc-hb-steps').length === 3; }, 3000);
    check('B.7 …a failure that would come again (today\'s allowance) ends it', e.log.sent.length === 1 && /“Hero refresh” stopped after request 1 of 3\./.test(e.thread().textContent) &&
      /Not run/.test(byClass(byClass(e.thread(), 'rvc-hb-steps')[2], 'rvc-hb-step')[2].textContent));
    /* Stop */
    e.log.sent.length = 0;
    e.script.push(function () { e.chat.setBusy(true, 'Thinking…', { onStop: function () {} }); return new Promise(function () { /* never answers */ }); });
    byClass(e.$('chips'), 'rvc-chip-more')[0].click();
    btnIn(byClass(e.thread(), 'rvc-hb-shortcuts')[0], 'Run').click();
    await until(function () { return e.$('stop') && e.$('stop').hidden === false; });
    e.$('stop').click();
    await until(function () { return byClass(e.thread(), 'rvc-hb-steps').length === 4; }, 3000);
    check('B.7 Stop ends the run', e.log.sent.length === 1 && /“Hero refresh” stopped after request 1 of 3\./.test(byClass(e.thread(), 'rvc-turn').slice(-1)[0].textContent));
    /* a second run while one runs, or while a message is answered, is not started */
    var hold = null;
    e.script.push(function () { return new Promise(function (r) { hold = r; }); });
    var typed = e.chat.ask('A typed message');
    await until(function () { return e.chat.isBusy() && typeof hold === 'function'; });
    var before = e.log.sent.length;
    byClass(e.$('chips'), 'rvc-chip-more')[0].click();
    btnIn(byClass(e.thread(), 'rvc-hb-shortcuts')[0], 'Run').click();
    check('B.7 while a message is answered, a shortcut waits for it (said, nothing sent)', e.log.sent.length === before && /Wait for the answer to the message first/.test(e.thread().textContent));
    hold({ brain: 'dash', r: { kind: 'reply', turnId: 'TurnZZZZZZZZZZ01' } });
    await typed;
  })();

  /* ======== B.8 a request that opens a page ======== */
  await (async function () {
    var steps = [{ text: 'Open the speakers', page: 'console' }, { text: 'Shorten the hero title', page: 'editor' }];
    var SC = [{ id: 'abcdefabcdef', name: 'Speakers then hero', steps: steps }];
    /* Stay here: the run goes on on this page */
    var e = page({ shortcuts: JSON.parse(JSON.stringify(SC)) });
    e.attach();
    e.chat.open();
    await until(function () { return byClass(e.$('chips'), 'rvc-chip-more')[0].textContent === 'Shortcuts (1)'; });
    e.script.push(e.opens('TurnOpen000001', 400), e.change('TurnOpen000002'));
    byClass(e.$('chips'), 'rvc-chip-more')[0].click();
    btnIn(byClass(e.thread(), 'rvc-hb-shortcuts')[0], 'Run').click();
    await until(function () { return e.chat.isLeaving(); });
    var carried = JSON.parse(e.win.sessionStorage.getItem('rv.aiHabits.run') || 'null');
    check('B.8 while "Opening …" runs, the rest of the run is kept for the page it opens', !!carried && carried.i === 1 && carried.eventId === AUTO && carried.steps.length === 2 && carried.steps[0].state === 'opened', carried);
    btnIn(e.thread(), 'Stay here').click();
    await until(function () { return byClass(e.thread(), 'rvc-hb-steps').length === 1; }, 3000);
    check('B.8 Stay here: the run goes on here', e.log.sent.join('|') === 'Open the speakers|Shorten the hero title' && /Stayed on this page/.test(byClass(e.thread(), 'rvc-hb-steps')[0].textContent) &&
      e.win.sessionStorage.getItem('rv.aiHabits.run') === null);

    /* the page opens: the next page goes on with the run, on the same event only */
    var session = memStore();
    var a = page({ shortcuts: JSON.parse(JSON.stringify(SC)), session: session });
    a.attach();
    a.chat.open();
    await until(function () { return byClass(a.$('chips'), 'rvc-chip-more')[0].textContent === 'Shortcuts (1)'; });
    a.script.push(a.opens('TurnOpen000011', 30));
    byClass(a.$('chips'), 'rvc-chip-more')[0].click();
    btnIn(byClass(a.thread(), 'rvc-hb-shortcuts')[0], 'Run').click();
    await until(function () { return a.chat.leaveCount().went === 1; });
    /* the browser opens the new page */
    a.winLs.filter(function (l) { return l.type === 'pagehide'; }).forEach(function (l) { l.fn({}); });
    var kept = JSON.parse(session.getItem('rv.aiHabits.run') || 'null');
    check('B.8 the page opened: the rest of the run is waiting for it', !!kept && kept.i === 1 && kept.name === 'Speakers then hero', kept);
    var b = page({ page: 'editor', shortcuts: JSON.parse(JSON.stringify(SC)), session: session });
    b.script.push(b.change('TurnOpen000012'));
    b.attach();
    await until(function () { return byClass(b.thread(), 'rvc-hb-steps').length === 1; }, 3000);
    check('B.8 the next page, same event: it goes on with request 2, and opens the panel for it', b.chat.isOpen() === true && b.log.sent.join('|') === 'Shorten the hero title' &&
      /Going on with “Speakers then hero”: request 2 of 2\./.test(b.thread().textContent), b.log.sent);
    var rows = byClass(byClass(b.thread(), 'rvc-hb-steps')[0], 'rvc-hb-step');
    check('B.8 …the request done on the page before is said so (its Undo is not here); this one has its Undo', /Done on the page before/.test(rows[0].textContent) && !byClass(rows[0], 'rvc-undo').length &&
      /Done/.test(rows[1].textContent) && byClass(rows[1], 'rvc-undo').length === 1 && session.getItem('rv.aiHabits.run') === null);
    /* another event: fail closed */
    var s2 = memStore();
    s2.setItem('rv.aiHabits.run', JSON.stringify({ v: 1, id: 'abcdefabcdef', name: 'Speakers then hero', eventId: AUTO, page: 'console', at: Date.now(), i: 1, steps: [{ text: 'Open the speakers', state: 'opened' }, { text: 'Shorten the hero title', state: 'waiting' }] }));
    var c = page({ eventId: RETAIL, session: s2 });
    c.attach();
    await until(function () { return /The rest of “Speakers then hero” was not run: this page is not about the same event\./.test(c.thread().textContent); }, 2000);
    check('B.8 another event: the rest is not run, and said; nothing sent', c.log.sent.length === 0 && /not about the same event/.test(c.thread().textContent) && s2.getItem('rv.aiHabits.run') === null);
    /* too late: forgotten */
    var s3 = memStore();
    s3.setItem('rv.aiHabits.run', JSON.stringify({ v: 1, id: 'abcdefabcdef', name: 'Old', eventId: AUTO, page: 'console', at: Date.now() - 5 * 60000, i: 1, steps: [{ text: 'a', state: 'opened' }, { text: 'b', state: 'waiting' }] }));
    var d = page({ session: s3 });
    d.attach();
    await tick(60);
    check('B.8 a run carried long ago is forgotten', d.log.sent.length === 0 && s3.getItem('rv.aiHabits.run') === null && !/Going on with/.test(d.thread().textContent));
  })();

  /* the words a person reads: plain, sentence case, ETB2B never "ET" alone, no old product names */
  (function () {
    var e = page(), T = e.H.TEXT, words = [];
    (function walkT(o) { Object.keys(o).forEach(function (k) { if (typeof o[k] === 'string') words.push(o[k]); else if (o[k] && typeof o[k] === 'object') walkT(o[k]); }); })(T);
    check('B.9 no old product name, and no bare "ET"', !words.some(function (w) { return /\bRevamp\b|\bOneworld\b|\bET\b(?!B2B)/.test(w); }), words.filter(function (w) { return /\bET\b/.test(w); }));
    check('B.9 sentence case: every line starts with a capital, a number, a quote or a placeholder', words.every(function (w) { return /^[A-Z0-9“{]/.test(w); }), words.filter(function (w) { return !/^[A-Z0-9“{]/.test(w); }));
  })();

  console.log('etb2b-ai-habits: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.log('etb2b-ai-habits test crashed: ' + (e && e.stack || e)); process.exit(1); });
