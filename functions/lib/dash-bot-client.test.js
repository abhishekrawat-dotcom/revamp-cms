// node functions/lib/dash-bot-client.test.js — ETB2B AI on the events dashboard: the page's side of the bot
// (dash-bot-client.js, plan §5c, §7, §12 D.1). The file runs in a vm with stand-ins for everything around it: the chat
// kit (window.RevampChat, which records what it is asked to draw), the list's door (window.RvListing), sign-in
// (RevampAuth.authedFetch answers from a script), location, both storages and a clock the test moves by hand.
// When the real kit (etb2b-chat.js, Unit C) is there, a second pass runs the main turns through it on a small DOM.
// No network, no browser, no AI.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'dash-bot-client.js'), 'utf8');
/* the one assistant's shell mounts the kit and hands this brain its messages (plan §4b, §4c) */
var SHELL_SRC = fs.readFileSync(path.join(ROOT, 'etb2b-assistant.js'), 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function flush() { return new Promise(function (r) { setImmediate(r); }).then(function () { return new Promise(function (r) { setImmediate(r); }); }); }

/* ---------------- stand-ins ---------------- */
function makeClock() {
  var t = 0, seq = 0, timers = [];
  return {
    setTimeout: function (fn, ms) { var id = ++seq; timers.push({ id: id, at: t + (+ms || 0), fn: fn }); return id; },
    clearTimeout: function (id) { timers = timers.filter(function (x) { return x.id !== id; }); },
    tick: function (ms) {
      var end = t + ms;
      for (;;) {
        timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
        var next = timers[0];
        if (!next || next.at > end) break;
        timers.shift(); t = next.at; next.fn();
      }
      t = end;
    },
    pending: function () { return timers.length; }
  };
}
function makeStorage(failWrites) {
  var m = {};
  return {
    _m: m,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { if (failWrites) throw new Error('QuotaExceededError'); m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
    key: function (i) { return Object.keys(m)[i] || null; },
    get length() { return Object.keys(m).length; }
  };
}
function fakeEl(props) {
  var el = { disabled: false, textContent: '', listeners: {} };
  Object.keys(props || {}).forEach(function (k) { el[k] = props[k]; });
  el.addEventListener = function (type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); };
  el.fire = function (type, ev) { (el.listeners[type] || []).slice().forEach(function (fn) { fn(ev || {}); }); };
  el.focus = function () { el.focused = true; };
  return el;
}
/* the kit, as K6 and etb2b-chat.js describe it: it records every call and draws nothing. Like the real kit, every
   Undo bound to one handler (a card's and the peek's) is one set: a handler that returns false leaves it as it was,
   anything else spends the whole set, and markUndone(handler) spends it from outside. */
function makeKit(opt) {
  opt = opt || {};
  var kit = { mounts: [], chat: null };
  kit.mount = function (host, opts) {
    if (opt.throws) throw new Error('kit broke');
    var sets = [];
    function setOf(fn) { for (var i = 0; i < sets.length; i++) if (sets[i].fn === fn) return sets[i]; var e = { fn: fn, els: [], done: false }; sets.push(e); return e; }
    function spend(e) { e.done = true; e.els.forEach(function (el) { el.disabled = true; el.textContent = 'Undone'; }); }
    function runUndo(fn) { var e = setOf(fn); if (e.done) return; var r = fn(); if (r === false) return; spend(e); }
    var chat = {
      undoSets: sets, runUndo: runUndo,
      markUndone: function (fn) { var e = setOf(fn); if (!e.done) spend(e); },
      host: host, opts: opts, bubbles: [], users: [], dividers: [], folds: [], busy: [], opened: 0, closed: 0, open_: !!opts.startOpen,
      open: function () { chat.opened++; chat.open_ = true; },
      close: function () { chat.closed++; chat.open_ = false; },
      isOpen: function () { return chat.open_; },
      focusInput: function () {},
      setBusy: function (on, text, o) { chat.busy.push([on, text]); chat.busyOpts = o || null; },
      scopes: [], setScope: function (t) { chat.scopes.push(t); },
      divider: function (label) { chat.dividers.push(label); chat.order.push('divider:' + label); },
      fold: function (label, onUndo) { chat.folds.push({ label: label, onUndo: onUndo, click: function () { runUndo(onUndo); } }); },
      unfold: function () {},
      user: function (text, o) { chat.users.push({ text: text, o: o }); chat.order.push('user'); return fakeEl(); },
      ai: function (content, o) { var b = makeBubble(content, o, chat); chat.bubbles.push(b); chat.order.push('ai'); return b; },
      order: []
    };
    kit.mounts.push({ host: host, opts: opts });
    kit.chat = chat;
    return chat;
  };
  return kit;
}
function makeBubble(content, o, chat) {
  var b = { content: content, o: o || {}, notes: [], links: [], buttons: [], lists: [], countdowns: [], choices_: null, picked: -1 };
  b.note = function (t) { b.notes.push(t); };
  b.link = function (href, label) { var el = fakeEl({ href: href, label: label }); b.links.push(el); return el; };
  b.button = function (label, onClick, opts) {
    var el = fakeEl({ label: label, textContent: label, opts: opts });
    el.click = function () { if (!el.disabled) onClick({ currentTarget: el }); };
    b.buttons.push(el); return el;
  };
  b.undo = function (onUndo) {
    var el = fakeEl({ label: 'Undo', textContent: 'Undo', undo: true });
    var set = null;
    chat.undoSets.forEach(function (e) { if (e.fn === onUndo) set = e; });
    if (!set) { set = { fn: onUndo, els: [], done: false }; chat.undoSets.push(set); }
    set.els.push(el);
    el.click = function () { if (!el.disabled) chat.runUndo(onUndo); };
    b.buttons.push(el); return el;
  };
  b.list = function (l) { b.lists.push(l); };
  b.countdown = function (ms, label, onCancel, onDone) {
    var cd = { ms: ms, label: label, cancelled: false, text: '', cancel: function (o2) {
      if (cd.cancelled) return false; cd.cancelled = true; cd.text = (o2 && o2.text) || 'Stayed here.';
      if (!(o2 && o2.silent) && onCancel) onCancel();
      return true;
    } };
    b.countdowns.push(cd); return cd;
  };
  /* a choice whose onClick returns false is not taken, and the others stay open */
  b.choices = function (list) { b.choices_ = list; };
  b.pick = function (i) { if (b.picked !== -1) return; var r = b.choices_[i].onClick({}); if (r !== false) b.picked = i; };
  b.text = function () { return typeof b.content === 'string' ? b.content : b.content.map(function (p) { return p.v || p.name || ''; }).join(' '); };
  return b;
}
function makeListing() {
  var L = { applied: [], restored: [], help: [], n: 0 };
  L.base = { tab: 'active', specialView: null, search: 'mumbai', filters: { types: ['ip'], portals: [], payment: [] }, created: null, starts: null, mine: false, sort: { field: 'start', dir: 'asc' }, page: 2, view: 'list', shown: 7 };
  L.snapshot = function () { return JSON.parse(JSON.stringify(L.base)); };
  L.apply = function (patch) { L.applied.push(JSON.parse(JSON.stringify(patch))); var before = L.snapshot(); before.mark = ++L.n; return before; };
  L.restore = function (snap) { L.restored.push(snap); return true; };
  L.openHelp = function (el) { L.help.push(el); };
  L.me = function () { return { email: 'asha.rao@timesinternet.in', name: 'Asha Rao' }; };
  L.ready = function () { return Promise.resolve(); };
  return L;
}
function response(status, body) {
  var text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status: status, text: function () { return Promise.resolve(text); } };
}

/* one page: the client file, then the shell (as every page loads them), run in a fresh vm with its own stand-ins.
   opt.page is the mount's data-rv-assistant ('dashboard' unless said); opt.search / opt.hash its address. */
function page(opt) {
  opt = opt || {};
  var clock = makeClock();
  var session = opt.session || makeStorage(), local = opt.local || makeStorage(opt.localFails);
  var kit = opt.noKit ? null : (opt.kit || makeKit(opt.kitOpt));
  var listing = opt.noListing ? null : (opt.listing || makeListing());
  var calls = [];
  var answers = opt.answers || [];
  var assigned = [], redirected = [], confirms = [], winListeners = {}, scripts = [];
  var pageName = opt.page || 'dashboard';
  var host = fakeEl({ id: pageName === 'dashboard' ? 'rv-dash-bot' : 'rv-assistant' });
  host.attrs = { 'data-rv-assistant': pageName, 'data-keep-clear': opt.keepClear || '' };
  host.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(host.attrs, k) ? host.attrs[k] : null; };
  var launcher = fakeEl({ id: pageName === 'dashboard' ? 'dash-chat-launcher' : 'ai-chat-launcher' });
  var doc = {
    activeElement: null, readyState: 'complete',
    body: { classList: { contains: function () { return false; } } },
    head: { appendChild: function (el) { scripts.push(el.src); } },
    createElement: function (tag) { var el = fakeEl({ tagName: String(tag).toUpperCase() }); return el; },
    querySelector: function (sel) { return sel === '[data-rv-assistant]' && !opt.noHost ? host : null; },
    getElementById: function (id) { return id === host.id ? (opt.noHost ? null : host) : id === launcher.id ? launcher : null; }
  };
  var quiet = { log: function () {}, warn: function () {}, error: function () {}, info: function () {} };
  var ctx = {
    document: doc, console: opt.quiet ? quiet : console, JSON: JSON, Promise: Promise, Date: Date, Object: Object, Array: Array, Number: Number, String: String, RegExp: RegExp, Error: Error, Math: Math,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    navigator: { onLine: opt.offline ? false : true },
    location: { href: 'http://localhost/' + (pageName === 'dashboard' ? 'Event_Listing.html' : 'edit-event.html'), pathname: opt.path || (pageName === 'dashboard' ? '/Event_Listing.html' : '/edit-event.html'),
      search: opt.search || '', hash: opt.hash || '', assign: function (u) { assigned.push(u); } },
    sessionStorage: session, localStorage: local,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    confirm: function (t) { confirms.push(t); return opt.confirm === undefined ? true : (typeof opt.confirm === 'function' ? opt.confirm(t) : opt.confirm); },
    matchMedia: function (q) { return { matches: !!opt.phone && /max-width/.test(q) }; },
    addEventListener: function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    RevampChat: kit,
    RvListing: listing,
    RevampPortals: opt.portals || undefined,
    RevampAuth: opt.noAuth ? undefined : {
      whenResolved: function () { return Promise.resolve(); },
      currentUser: function () { return opt.signedOut ? null : { displayName: 'Asha Rao', email: 'asha.rao@timesinternet.in' }; },
      redirectToSignIn: function () { redirected.push(1); },
      authedFetch: function (url, o) {
        var body = o && o.body ? JSON.parse(o.body) : undefined;
        var call = { url: url, method: o && o.method, headers: o && o.headers, body: body, keepalive: !!(o && o.keepalive) };
        calls.push(call);
        if (opt.fetchFails) return Promise.reject(opt.fetchFails);
        var a = typeof opt.answer === 'function' ? opt.answer(call) : (url === '/api/dash-bot' ? answers.shift() : null);
        if (url === '/api/dash-bot/turn') return Promise.resolve(response(200, { turnId: body.turnId, status: body.status }));
        if (url === '/api/dash-bot/history' && !a) return Promise.resolve(response(200, opt.history || { turns: [] }));
        if (/^\/api\/chat\/history\?eventId=/.test(url) && !a) return Promise.resolve(response(200, opt.eventHistory || { event: { id: 'qa-main', name: 'QA Main' }, turns: [] }));
        if (!a) return Promise.resolve(response(500, { error: 'no scripted answer' }));
        if (a.reject) return Promise.reject(a.reject);
        if (a.hold) return a.hold.then(function (b) { return response(b.status || 200, b.body); });
        return Promise.resolve(response(a.status || 200, a.body));
      }
    }
  };
  ctx.window = ctx;
  ctx.top = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'dash-bot-client.js' });
  if (!opt.noShell) vm.runInContext(SHELL_SRC, ctx, { filename: 'etb2b-assistant.js' });
  var P = {
    ctx: ctx, kit: kit, listing: listing, clock: clock, session: session, local: local, calls: calls, assigned: assigned, redirected: redirected,
    confirms: confirms, host: host, launcher: launcher, winListeners: winListeners, scripts: scripts,
    chat: function () { return kit && kit.chat; },
    say: function (text, o) { return kit.chat.opts.send(text, o); },
    last: function () { var b = kit.chat.bubbles; return b[b.length - 1]; },
    turnCalls: function () { return calls.filter(function (c) { return c.url === '/api/dash-bot/turn'; }).map(function (c) { return c.body; }); },
    botCalls: function () { return calls.filter(function (c) { return c.url === '/api/dash-bot'; }); }
  };
  return flush().then(function () { return P; });
}
function ok(body) { return { status: 200, body: body }; }
function rejection(p) { return p.then(function () { return null; }, function (e) { return e; }); }

var T1 = 'TurnFilter0001', T2 = 'TurnFilter0002', T3 = 'TurnCreate0003', T4 = 'TurnOpen000004', T5 = 'TurnChoose0005', T6 = 'TurnList000006';
var FILTER_PATCH = { view: 'draft', search: '', types: [], mine: false, created: { from: '2026-10-26', to: '2026-11-01' }, starts: null, sort: null };
function filterAnswer(id, label, patch) {
  return ok({ turnId: id, kind: 'filter', parts: [{ t: 'text', v: 'Here are your drafts from last week.' }], list: null,
    action: { type: 'filter', patch: patch || FILTER_PATCH, label: label || 'Draft events · created 26 Oct – 1 Nov 2026' }, choices: null, asOf: '2026-11-03T06:35:00.000Z', notes: [] });
}
function navAnswer(id, url, label) {
  return ok({ turnId: id, kind: 'open', parts: [{ t: 'text', v: 'Here is the editor of ' }, { t: 'event', id: 'autotech-2026', name: 'Autotech 2026', href: '/edit-event.html?event=autotech-2026' }],
    list: null, action: { type: 'navigate', url: url, label: label || 'the Autotech 2026 editor', target: 'editor', eventId: 'autotech-2026' }, choices: null, asOf: '2026-11-03T06:35:00.000Z', notes: [] });
}
var PREFILL = {
  category: 'IP', method: '', portal: '',
  basics: { name: 'Retail Leadership Summit', client: '', dateMode: 'exact', start: '2027-02-12', end: '2027-02-12', month: '', quarter: '', year: '', venue: 'Jio World Centre', city: 'Mumbai' },
  brief: { text: '', current: '', previous: '' }
};
function createAnswer(id, notes, over, parts) {
  var action = { type: 'create', url: '/create-event.html?new=1&prefill=' + id, prefillId: id, prefill: PREFILL, label: 'Create Event, filled in', dropped: [] };
  Object.keys(over || {}).forEach(function (k) { action[k] = over[k]; });
  return ok({ turnId: id, kind: 'create', parts: parts || [{ t: 'text', v: 'Starting it for you.' }], list: null, action: action, choices: null, asOf: '2026-11-03T06:35:00.000Z', notes: notes || [] });
}
var LIST = {
  title: 'Events that go live this month', count: 23, more: true,
  items: [
    { id: 'awards-2026', name: 'ET Awards 2026', href: '/edit-event.html?event=awards-2026', dates: '20–21 Nov 2026', status: 'upcoming', statusLabel: 'Upcoming', type: 'awards', registrations: 1234 },
    { id: 'draft-nov', name: 'Draft Nov', href: '/edit-event.html?event=draft-nov', dates: '8 Nov 2026', status: 'draft', statusLabel: 'Site not live', type: 'ip', registrations: 1 }
  ],
  view: { view: 'upcoming', search: '', types: [], mine: false, created: null, starts: { from: '2026-11-01', to: '2026-11-30' }, sort: { field: 'start', dir: 'asc' } }
};

(async function main() {
  /* ======== static: ES5, served, and nothing it must never touch ======== */
  check('D.1 parses', (function () { try { new vm.Script(SRC); return true; } catch (e) { return false; } })());
  check('D.1 ES5: no let / const', !/\blet\s/.test(SRC) && !/\bconst\s/.test(SRC));
  check('D.1 ES5: no arrow functions, template strings or spread', SRC.indexOf('=>') === -1 && SRC.indexOf('`') === -1 && SRC.indexOf('...') === -1);
  check('D.1 ES5: no async / await or class', !/\basync\b|\bawait\b/.test(SRC) && !/\bclass\s/.test(SRC));
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still ran */ }
  if (esbuild) {
    var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('D.1 ES5 by esbuild', es5 === true, es5);
  }
  check('D.1 the page may load it (a top-level .js the server sends)', require('./access').isServableFile('dash-bot-client.js') === true);
  /* the dashboard's demo figures stay out of anything the bot says (plan checked fact 2) */
  ['PORTAL_ACTIVITY_BASE', 'generateAudience', 'IP_ACTIVITY', 'hashToEventNo'].forEach(function (w) { check('D.1 never mentions ' + w, SRC.indexOf(w) === -1); });
  check('D.1 never mentions EVENTS (the page\'s own rows)', !/\bEVENTS\b/.test(SRC));
  /* the vocabulary: nothing here deletes, cancels, publishes, approves, sends or pays */
  check('D.1 calls only its own three routes', (SRC.match(/'\/api\/[^']*'/g) || []).every(function (u) { return ['\'/api/dash-bot\'', '\'/api/dash-bot/turn\'', '\'/api/dash-bot/history\''].indexOf(u) !== -1; }), SRC.match(/'\/api\/[^']*'/g));
  check('D.1 no DELETE, publish, unpublish, approve or send call', !/'DELETE'|\/publish|unpublish|\/approve|\/send\b|\/payment/i.test(SRC));
  /* "portal" (the dashboard's own switcher, plan §17) joins them: no destructive action is in it */
  /* "records" (10 Nov 2026) adds speakers or sponsors through the console's own record routes; its Undo removes only the
     records it added itself */
  check('D.1 the action switch knows filter, portal, navigate, create, records, refuse (and undo) only',
    (SRC.match(/action\.type === '([a-z]+)'/g) || []).map(function (s) { return s.replace(/.*'([a-z]+)'/, '$1'); }).filter(function (x, i, all) { return all.indexOf(x) === i; }).sort().join(',') === 'create,filter,navigate,portal,records,refuse,undo',
    SRC.match(/action\.type === '([a-z]+)'/g));
  check('D.1 the answer is drawn by the kit (no innerHTML here)', SRC.indexOf('innerHTML') === -1 && SRC.indexOf('insertAdjacentHTML') === -1 && SRC.indexOf('document.write') === -1);
  check('D.1 NAV_OK is one regex literal (the integration test reads it from here)', /\bvar NAV_OK = \/\^\\\/\(\?:edit-event[^\n]*\$\/;/.test(SRC));

  /* ======== NAV_OK: the one whitelist ======== */
  var P0 = await page();
  var NAV = P0.ctx.RevampDashBot.NAV_OK;
  var GOOD = ['/edit-event.html?event=autotech-2026', '/edit-event.html?event=autotech-2026#content/speakers', '/edit-event.html?event=a1#settings/seo',
    '/edit-event.html?event=a1#dashboard', '/edit-event.html?event=a1#activity', '/edit-event.html?event=a1#design/editor',
    '/marketing.html?event=a1&tab=posts', '/marketing.html?event=a1&tab=posts&template=generic.announcement&mailer=mailer.announcement',
    '/marketing.html?event=a1&tab=site-posts&post=announce&mailer=mailer.reminder', '/marketing.html?event=a1&tab=mailers&mailer=mailer.award-nominations',
    '/marketing.html?event=a1&tab=posts&template=partner.presenting-spotlight',
    '/audience-registrations.html?event=a1', '/preview/a1?draft=1', '/e/a1', '/activity-log.html', '/activity-log.html?event=a1', '/mailer-performance.html',
    '/create-event.html?new=1', '/create-event.html?new=1&prefill=AbCdEf012345', '/Event_Listing.html'];
  var BAD = ['https://evil/', '//evil.example/x', '/\\evil', 'javascript:alert(1)', '/edit-event.html?event=a#x', '/edit-event.html?event=A1', '/edit-event.html?event=a1#design',
    '/edit-event.html?event=a1&x=1', '/marketing.html?event=a1&tab=sales', '/marketing.html?event=a1&tab=posts&template=../x', '/preview/a1', '/e/a1/../admin',
    '/create-event.html?new=1&discard=1', '/create-event.html?new=1&prefill=short', '/Event_Listing.html?x=1', '/event_listing.html', '/api/event?eventId=a1', ' /e/a1', '/e/a1\n'];
  check('D.1 NAV_OK lets every page ETB2B AI may open through', GOOD.every(function (u) { return NAV.test(u); }), GOOD.filter(function (u) { return !NAV.test(u); }));
  check('D.1 NAV_OK keeps everything else out', BAD.every(function (u) { return !NAV.test(u); }), BAD.filter(function (u) { return NAV.test(u); }));
  check('D.1 the countdown is 1.2 s', P0.ctx.RevampDashBot.NAV_DELAY_MS === 1200);

  /* ======== mounting ======== */
  var m = P0.kit.mounts[0];
  check('D.1 mounts once, in #rv-dash-bot', P0.kit.mounts.length === 1 && m.host === P0.host);
  var o = m.opts;
  check('D.1 the kit\'s options: id, title, launcher label, placeholder', o.id === 'dash' && o.title === 'ETB2B AI' && o.launcherLabel === 'Ask ETB2B AI' && o.placeholder === 'Ask ETB2B AI…');
  check('D.1 the welcome greets by first name', o.welcome.heading === 'Hi Asha, I’m ETB2B AI.' && /start a new event, open any event’s pages, answer questions from your events’ real numbers, and set up promotions/.test(o.welcome.text), o.welcome);
  check('D.1 four suggestions, one per ability, each with a "…" to fill or none',
    same(o.suggestions.map(function (s) { return s.text; }), ['Create an IP event called … on … in …', 'Show drafts from last week', 'Which events go live this month?', 'Make a save-the-date post and an announcement mailer for …']));
  check('D.1 the foot note says what it never does', o.footNote === 'ETB2B AI opens pages, filters this list, switches its portal and starts drafts. It never deletes, cancels, publishes or approves anything.');
  check('D.1 "Email Customer Care" sits in the header', o.help && o.help.label === 'Email Customer Care' && typeof o.help.onClick === 'function');
  check('D.1 send and loadHistory are given; it does not start open', typeof o.send === 'function' && typeof o.loadHistory === 'function' && o.startOpen === false);
  var btnEl = fakeEl();
  o.help.onClick(btnEl);                                // the kit passes its "Email Customer Care" button
  check('D.1 Email Customer Care opens the page\'s help window, which gives the focus back to it', P0.listing.help.length === 1 && P0.listing.help[0] === btnEl);
  var Pphone = await page({ phone: true });
  Pphone.kit.chat.opts.help.onClick(fakeEl());
  check('D.1 on a phone the sheet steps aside first and the focus returns to the launcher', Pphone.kit.chat.closed === 1 && Pphone.listing.help[0] === Pphone.launcher);

  var Pnone = await page({ noKit: true });
  check('D.1 no kit: nothing mounts and nothing throws (the page keeps "Need help?")', !Pnone.ctx.RevampChat && typeof Pnone.ctx.RevampDashBot === 'object');
  var Pnol = await page({ noListing: true });
  check('D.1 no RvListing: the panel still mounts (the list is optional: the shell mounts it on every page)', Pnol.kit.mounts.length === 1);
  var Pnosh = await page({ noShell: true });
  check('D.1 without the shell nothing mounts (the brain waits for it), and the brain is there for it', Pnosh.kit.mounts.length === 0 &&
    typeof Pnosh.ctx.RevampDashBot.brain.send === 'function' && typeof Pnosh.ctx.RevampDashBot.brain.replay === 'function');
  var Pout = await page({ signedOut: true });
  check('D.1 signed out: nothing mounts', Pout.kit.mounts.length === 0);
  var Pthrow = await page({ kitOpt: { throws: true }, quiet: true });
  check('D.1 a kit that throws on mount is survived', Pthrow.kit.mounts.length === 0 && typeof Pthrow.ctx.RevampDashBot === 'object');
  var Pnoname = await page({ listing: (function () { var L = makeListing(); L.me = function () { return { email: 'x@timesinternet.in', name: '' }; }; return L; })() });
  check('D.1 no name: "Hi, I’m ETB2B AI."', Pnoname.kit.mounts[0].opts.welcome.heading === 'Hi, I’m ETB2B AI.');

  /* ======== Return: Back to the dashboard reopens the panel ======== */
  var sess = makeStorage(); sess.setItem('rv.assistant.open.dashboard', '1');
  var Pret = await page({ session: sess });
  check('D.1 rv.assistant.open.dashboard = "1" → it mounts open, and the key is cleared', Pret.kit.mounts[0].opts.startOpen === true && sess.getItem('rv.assistant.open.dashboard') === null);
  Pret.kit.chat.open_ = false;
  sess.setItem('rv.assistant.open.dashboard', '1');
  (Pret.winListeners.pageshow || []).forEach(function (fn) { fn({ persisted: true }); });
  check('D.1 …and from the browser\'s memory (pageshow) too', Pret.kit.chat.opened === 1 && sess.getItem('rv.assistant.open.dashboard') === null);
  var sessOther = makeStorage(); sessOther.setItem('rv.assistant.open.console', '1');
  var Pret2 = await page({ session: sessOther });
  check('D.1 …the key is per page: another page\'s does not open the dashboard\'s panel', Pret2.kit.mounts[0].opts.startOpen === false && sessOther.getItem('rv.assistant.open.console') === '1');

  /* ======== Send ======== */
  var P = await page({ answers: [filterAnswer(T1)] });
  var sent = P.say('  Show drafts from last week ');
  check('D.1 busy at once', same(P.kit.chat.busy[0], [true, undefined]));
  await sent;
  var c0 = P.botCalls()[0];
  check('D.1 POST /api/dash-bot with {message, view, place}', c0 && c0.method === 'POST' && c0.headers['Content-Type'] === 'application/json' && same(Object.keys(c0.body).sort(), ['message', 'place', 'view']) && c0.body.message === 'Show drafts from last week', c0 && c0.body);
  check('D.1 place: the dashboard, no event', c0 && same(c0.body.place, { page: 'dashboard', eventId: '', tab: '' }), c0 && c0.body.place);
  check('D.1 no top-level eventId or slug (the QA guard reads those)', !('eventId' in c0.body) && !('slug' in c0.body));
  /* working: the portal worked in; a snapshot without it (an older page) sends the list's portal, then the same */
  check('D.1 view comes from RvListing.snapshot()', same(c0.body.view, { tab: 'active', specialView: null, search: 'mumbai', portal: '', working: '', types: ['ip'], mine: false, created: null, starts: null, sort: { field: 'start', dir: 'asc' }, shown: 7 }), c0.body.view);
  check('D.1 not busy once answered', same(P.kit.chat.busy[P.kit.chat.busy.length - 1], [false, undefined]));

  /* ======== Filter: done at once, folded, undone exactly ======== */
  var b1 = P.last();
  check('D.1 filter: RvListing.apply gets the server\'s patch', P.listing.applied.length === 1 && same(P.listing.applied[0], FILTER_PATCH));
  var held = JSON.parse(P.session.getItem('rv.dashBot.undo.' + T1) || 'null');
  check('D.1 filter: the list as it was is kept under rv.dashBot.undo.<turnId>', held && held.snap && held.snap.mark === 1 && held.snap.search === 'mumbai' && typeof held.at === 'number');
  check('D.1 filter: the card says what is shown', b1.notes.indexOf('Showing Draft events · created 26 Oct – 1 Nov 2026.') !== -1, b1.notes);
  check('D.1 filter: the panel folds to its peek, with the label', P.kit.chat.folds.length === 1 && P.kit.chat.folds[0].label === 'Showing Draft events · created 26 Oct – 1 Nov 2026');
  var undoBtn = b1.buttons.filter(function (x) { return x.label === 'Undo'; })[0];
  check('D.1 filter: the card has Undo', !!undoBtn);
  check('D.1 filter: no /turn report for doing it (it is stored done)', P.turnCalls().length === 0);
  undoBtn.click();
  await flush();
  check('D.1 filter Undo: restore(the snapshot before)', P.listing.restored.length === 1 && P.listing.restored[0].mark === 1);
  check('D.1 filter Undo: /turn undone', same(P.turnCalls(), [{ turnId: T1, status: 'undone' }]), P.turnCalls());
  check('D.1 filter Undo: the button says Undone and is spent', undoBtn.disabled === true && undoBtn.textContent === 'Undone');
  check('D.1 filter Undo: the kept snapshot is let go', P.session.getItem('rv.dashBot.undo.' + T1) === null);
  P.kit.chat.folds[0].click();
  P.kit.chat.folds[0].onUndo();
  check('D.1 filter Undo: the peek\'s Undo after that does nothing', P.listing.restored.length === 1 && P.turnCalls().length === 1);
  check('D.1 filter Undo: card and peek are one Undo (one handler)', P.kit.chat.folds[0].onUndo === P.kit.chat.undoSets[0].fn && P.kit.chat.undoSets[0].done === true);

  /* the peek's own Undo */
  var Pk = await page({ answers: [filterAnswer(T1)] });
  await Pk.say('Show drafts from last week');
  Pk.kit.chat.folds[0].click();
  await flush();
  check('D.1 the peek\'s Undo: restore and /turn undone', Pk.listing.restored.length === 1 && same(Pk.turnCalls(), [{ turnId: T1, status: 'undone' }]));
  check('D.1 …and the card\'s Undo is spent with it', Pk.last().buttons[0].disabled === true && Pk.last().buttons[0].textContent === 'Undone');

  /* an older filter asks first, and going back past a later change takes that one too */
  var Po = await page({ answers: [filterAnswer(T1), filterAnswer(T2, 'Upcoming events', { view: 'upcoming', search: '', types: [], mine: false, created: null, starts: null, sort: null })], confirm: false });
  await Po.say('drafts'); await Po.say('upcoming');
  var first = Po.kit.chat.bubbles[0].buttons[0];
  first.click();
  check('D.1 an older Undo asks first, in these words', Po.confirms.length === 1 && Po.confirms[0] === 'This puts the list back as it was before that message, including later changes. Undo?');
  check('D.1 …and "no" changes nothing (the handler says false, so the kit keeps Undo)', Po.listing.restored.length === 0 && first.disabled === false && first.textContent === 'Undo' && Po.turnCalls().length === 0);
  var Po2 = await page({ answers: [filterAnswer(T1), filterAnswer(T2, 'Upcoming events', { view: 'upcoming', search: '', types: [], mine: false, created: null, starts: null, sort: null })], confirm: true });
  await Po2.say('drafts'); await Po2.say('upcoming');
  Po2.kit.chat.bubbles[0].buttons[0].click();
  await flush();
  check('D.1 …"yes" restores the older snapshot', Po2.listing.restored.length === 1 && Po2.listing.restored[0].mark === 1);
  check('D.1 …and both turns are reported undone', same(Po2.turnCalls().map(function (t) { return t.turnId + ':' + t.status; }).sort(), [T1 + ':undone', T2 + ':undone']));
  check('D.1 …the newer card\'s Undo is spent too', Po2.kit.chat.bubbles[1].buttons[0].disabled === true);
  var Pn = await page({ answers: [filterAnswer(T1), filterAnswer(T2, 'Upcoming events')] });
  await Pn.say('a'); await Pn.say('b');
  Pn.kit.chat.bubbles[1].buttons[0].click();
  check('D.1 the newest filter\'s Undo runs at once, without asking', Pn.confirms.length === 0 && Pn.listing.restored.length === 1 && Pn.listing.restored[0].mark === 2);

  /* the newest 15 are kept */
  var many = [];
  for (var i = 0; i < 17; i++) many.push(filterAnswer('TurnMany' + (100000 + i)));
  var Pm = await page({ answers: many });
  for (var j = 0; j < 17; j++) { await Pm.say('f' + j); }
  var keys = Object.keys(Pm.session._m).filter(function (k) { return k.indexOf('rv.dashBot.undo.') === 0; });
  check('D.1 at most 15 snapshots are kept in sessionStorage', keys.length === 15, keys.length);

  /* ======== Navigate: "Opening …", Stay here, then go ======== */
  var URL1 = '/edit-event.html?event=autotech-2026#design/editor';
  var Pv = await page({ answers: [navAnswer(T4, URL1)] });
  await Pv.say('Take me to the Autotech editor');
  var bv = Pv.last(), cd = bv.countdowns[0];
  check('D.1 navigate: a 1.2 s countdown, "Opening <label>…"', cd && cd.ms === 1200 && cd.label === 'Opening the Autotech 2026 editor…', cd && cd.label);
  check('D.1 navigate: a real link to the page as well', bv.links.length === 1 && bv.links[0].href === URL1);
  Pv.clock.tick(1199);
  check('D.1 navigate: nothing before 1.2 s', Pv.assigned.length === 0);
  Pv.clock.tick(1);
  check('D.1 navigate: after 1.2 s, location.assign(url)', same(Pv.assigned, [URL1]));
  check('D.1 navigate: Back will reopen the panel', Pv.session.getItem('rv.assistant.open.dashboard') === '1');
  check('D.1 navigate: no /turn report for going (it is stored done)', Pv.turnCalls().length === 0);

  var Ps = await page({ answers: [navAnswer(T4, URL1)] });
  await Ps.say('Take me to the Autotech editor');
  Ps.clock.tick(600);
  Ps.last().countdowns[0].cancel();                 // Stay here (or Esc)
  Ps.clock.tick(5000);
  await flush();
  check('D.1 Stay here: no navigation', Ps.assigned.length === 0 && Ps.session.getItem('rv.assistant.open.dashboard') === null);
  check('D.1 Stay here: /turn undone with "stayed"', same(Ps.turnCalls(), [{ turnId: T4, status: 'undone', note: 'stayed' }]), Ps.turnCalls());

  var Pc = await page({ answers: [navAnswer(T4, URL1)] });
  await Pc.say('Take me to the Autotech editor');
  Pc.last().links[0].fire('click', { ctrlKey: true, button: 0 });
  Pc.clock.tick(5000);
  await flush();
  check('D.1 Ctrl-click on the card\'s link: no assign, the card says "Opened in a new tab."', Pc.assigned.length === 0 && Pc.last().countdowns[0].text === 'Opened in a new tab.', Pc.last().countdowns[0]);
  check('D.1 …the countdown stops silently and nothing is reported (the page did open)', Pc.last().countdowns[0].cancelled === true && Pc.turnCalls().length === 0 && Pc.last().notes.length === 0);
  var Pmid = await page({ answers: [navAnswer(T4, URL1)] });
  await Pmid.say('x');
  Pmid.last().links[0].fire('auxclick', { button: 1 });
  Pmid.clock.tick(5000);
  check('D.1 a middle click does the same', Pmid.assigned.length === 0 && Pmid.last().countdowns[0].text === 'Opened in a new tab.' && Pmid.turnCalls().length === 0);
  var Pplain = await page({ answers: [navAnswer(T4, URL1)] });
  await Pplain.say('x');
  Pplain.last().links[0].fire('click', { button: 0 });
  Pplain.clock.tick(5000);
  check('D.1 a plain click on the link: the browser goes, the timer does not go again', Pplain.assigned.length === 0 && Pplain.session.getItem('rv.assistant.open.dashboard') === '1' && Pplain.turnCalls().length === 0);

  var badUrls = ['https://evil/', '/edit-event.html?event=a#x', '//evil.example/', 'javascript:alert(1)'];
  for (var bu = 0; bu < badUrls.length; bu++) {
    var Pb = await page({ answers: [navAnswer(T4, badUrls[bu])] });
    await Pb.say('open it');
    Pb.clock.tick(5000);
    await flush();
    var bb = Pb.last();
    check('D.1 off the whitelist (' + badUrls[bu] + '): no navigation, no countdown, no link', Pb.assigned.length === 0 && bb.countdowns.length === 0 && bb.links.length === 0);
    check('D.1 …a failure line and /turn failed (' + badUrls[bu] + ')', /^That could not be done here\. /.test(bb.notes[0] || '') && Pb.turnCalls().length === 1 && Pb.turnCalls()[0].status === 'failed', [bb.notes, Pb.turnCalls()]);
  }

  /* a new message while a page is about to open means staying here */
  var Pnew = await page({ answers: [navAnswer(T4, URL1), filterAnswer(T1)] });
  await Pnew.say('open the editor');
  Pnew.clock.tick(500);
  var p2 = Pnew.say('actually, show drafts');
  Pnew.clock.tick(5000);
  await p2; await flush();
  check('D.1 typing again cancels the pending page (reported as stayed)', Pnew.assigned.length === 0 && Pnew.turnCalls().some(function (t) { return t.turnId === T4 && t.status === 'undone' && t.note === 'stayed'; }));

  /* ======== Create: the hand-off, then as navigate ======== */
  var Pcr = await page({ answers: [createAnswer(T3)] });
  await Pcr.say('Create an IP event called Retail Leadership Summit on 12 Feb 2027 at Jio World Centre, Mumbai');
  var key = 'revamp.createEvent.prefill.v1.' + T3;
  var rec = JSON.parse(Pcr.local.getItem(key) || 'null');
  check('D.1 create: localStorage holds the prefill under revamp.createEvent.prefill.v1.<prefillId>', !!rec);
  var expect = JSON.parse(JSON.stringify(PREFILL)); expect.v = 1; expect.from = 'etb2b-ai'; expect.turnId = T3; expect.prefillId = T3;
  var got = rec ? JSON.parse(JSON.stringify(rec)) : {}; var at = got.at; delete got.at;
  check('D.1 create: exactly {v:1, from:"etb2b-ai", at, turnId, prefillId, …prefill}', same(Object.keys(got).sort(), Object.keys(expect).sort()) &&
    Object.keys(expect).every(function (k) { return same(got[k], expect[k]); }) && typeof at === 'number' && at > 0, got);
  var bc = Pcr.last();
  check('D.1 create: the card says what goes in', bc.countdowns[0] && bc.countdowns[0].label === 'Opening Create Event with: IP event · Retail Leadership Summit · 12 Feb 2027 · Jio World Centre, Mumbai…', bc.countdowns[0] && bc.countdowns[0].label);
  check('D.1 create: and links to it', bc.links[0] && bc.links[0].href === '/create-event.html?new=1&prefill=' + T3 && bc.links[0].label === 'Create Event, filled in');
  Pcr.clock.tick(1200);
  check('D.1 create: then /create-event.html?new=1&prefill=<prefillId>', same(Pcr.assigned, ['/create-event.html?new=1&prefill=' + T3]));
  var Pcs = await page({ answers: [createAnswer(T3)] });
  await Pcs.say('create');
  Pcs.last().countdowns[0].cancel();
  Pcs.clock.tick(5000); await flush();
  check('D.1 create Stay here: the prefill is removed, no navigation, /turn undone', Pcs.local.getItem(key) === null && Pcs.assigned.length === 0 &&
    same(Pcs.turnCalls(), [{ turnId: T3, status: 'undone', note: 'stayed' }]));
  /* QA F6: after Stay here, the card's link still opens the page, and the history must say so */
  var prevented = 0, evPlain = { button: 0, preventDefault: function () { prevented++; } };
  Pcs.last().links[0].fire('click', evPlain);
  check('D.1 create, Stay here, then the card\'s link: the details are put back for Create Event', !!JSON.parse(Pcs.local.getItem(key) || 'null') &&
    JSON.parse(Pcs.local.getItem(key)).prefillId === T3 && JSON.parse(Pcs.local.getItem(key)).basics.name === 'Retail Leadership Summit');
  check('D.1 …the click waits for its report (no assign yet)', prevented === 1 && Pcs.assigned.length === 0);
  await flush();
  check('D.1 …the turn is reported done, once, and then the page opens', same(Pcs.turnCalls().slice(1), [{ turnId: T3, status: 'done', note: 'opened after staying' }]) &&
    same(Pcs.assigned, ['/create-event.html?new=1&prefill=' + T3]) && Pcs.session.getItem('rv.assistant.open.dashboard') === '1', [Pcs.turnCalls(), Pcs.assigned]);
  check('D.1 …that report is sent so it survives the page being left', Pcs.calls.filter(function (c) { return c.url === '/api/dash-bot/turn'; }).length === 2);
  Pcs.clock.tick(5000); await flush();
  check('D.1 …and goes only once, whatever the timer', Pcs.assigned.length === 1);

  var Psl = await page({ answers: [navAnswer(T4, URL1)] });
  await Psl.say('Take me to the Autotech editor');
  Psl.last().countdowns[0].cancel();
  await flush();
  var slow = { button: 0, preventDefault: function () {} };
  Psl.last().links[0].fire('click', slow);
  Psl.last().links[0].fire('click', slow);
  await flush();
  check('D.1 open, Stay here, then two clicks on the link: one "done" report, one navigation', same(Psl.turnCalls(), [{ turnId: T4, status: 'undone', note: 'stayed' }, { turnId: T4, status: 'done', note: 'opened after staying' }]) &&
    same(Psl.assigned, [URL1]), [Psl.turnCalls(), Psl.assigned]);
  var Pst = await page({ answers: [navAnswer(T4, URL1)] });
  await Pst.say('Take me to the Autotech editor');
  Pst.last().countdowns[0].cancel();
  var tabPrevented = 0;
  Pst.last().links[0].fire('click', { ctrlKey: true, button: 0, preventDefault: function () { tabPrevented++; } });
  await flush();
  check('D.1 open, Stay here, then Ctrl-click: reported done, this page stays, the card says "Opened in a new tab."',
    same(Pst.turnCalls().slice(1), [{ turnId: T4, status: 'done', note: 'opened after staying' }]) && Pst.assigned.length === 0 && tabPrevented === 0 &&
    Pst.last().notes.indexOf('Opened in a new tab.') !== -1, [Pst.turnCalls(), Pst.last().notes]);
  var opts4 = Pst.calls.filter(function (c) { return c.url === '/api/dash-bot/turn'; });
  check('D.1 the report for a click that leaves the page is a keepalive request; the others are not', opts4.length === 2 && !opts4[1].keepalive &&
    Pcs.calls.filter(function (c) { return c.url === '/api/dash-bot/turn'; })[1].keepalive === true, opts4.map(function (c) { return c.keepalive; }));

  /* QA F5: a create answer whose sentence the server could not keep is never an empty bubble */
  var Pce = await page({ answers: [createAnswer(T3, [], {}, [])] });
  await Pce.say('create');
  check('D.1 create with no words: the bubble says "Starting Create Event with your details."', Pce.last().content === 'Starting Create Event with your details.', Pce.last().content);
  /* the server's own shape: action.dropped, the note 'not-said', and its sentence already in the parts */
  var Pcs2 = await page({ answers: [createAnswer(T3, ['not-said'], { dropped: ['venue', 'city'] }, [{ t: 'text', v: 'Starting it. I left out the venue and the city: please type them there.' }])] });
  await Pcs2.say('create');
  check('D.1 create: what grounding left out is not said twice when the answer says it', Pcs2.last().notes.length === 0, Pcs2.last().notes);
  var Pcn = await page({ answers: [createAnswer(T3, ['not-said'], { dropped: ['venue', 'city'] })] });
  await Pcn.say('create');
  check('D.1 create: …and is named when it does not', Pcn.last().notes.indexOf('I left out the venue and the city: please type them there.') !== -1, Pcn.last().notes);
  var Pcg = await page({ answers: [createAnswer(T3, ['not-said'])] });
  await Pcg.say('create');
  check('D.1 create: a bare "not-said" still says something was left out', Pcg.last().notes.some(function (n) { return /^I left out details you didn’t type yourself/.test(n); }));
  var Pcb = await page({ answers: [createAnswer(T3, [], { url: '/create-event.html?new=1&prefill=SomethingElse01' })] });
  await Pcb.say('create'); Pcb.clock.tick(5000); await flush();
  check('D.1 create: a URL that is not this prefill\'s → failure, nothing stored', Pcb.assigned.length === 0 && Pcb.local.getItem(key) === null && Pcb.turnCalls()[0].status === 'failed');
  var Pcq = await page({ answers: [createAnswer(T3)], localFails: true });
  await Pcq.say('create'); Pcq.clock.tick(5000); await flush();
  check('D.1 create: storage refused → failure line, /turn failed, no navigation', Pcq.assigned.length === 0 && /storage is blocked/.test(Pcq.last().notes[0] || '') && Pcq.turnCalls()[0].status === 'failed');
  var Pcm = await page({ answers: [createAnswer('TurnBrief0007', [], { prefill: { category: 'IP', method: 'brief', portal: '', basics: { name: 'Retail Forum', dateMode: 'month', month: '2027-03', city: 'Bengaluru' }, brief: { text: 'a one-day forum…', current: '', previous: '' } } })] });
  await Pcm.say('brief');
  check('D.1 create: a month and a brief read as such', Pcm.last().countdowns[0].label === 'Opening Create Event with: IP event · Retail Forum · March 2027 · Bengaluru · your brief…', Pcm.last().countdowns[0].label);

  /* ======== Choose: a click runs that event's action, with no second AI call ======== */
  var URL26 = '/edit-event.html?event=autotech-2026#design/editor', URL25 = '/edit-event.html?event=autotech-2025#design/editor';
  var Pch = await page({ answers: [ok({ turnId: T5, kind: 'choose', parts: [{ t: 'text', v: 'Which one?' }], list: null, action: null, asOf: 'x', notes: [],
    choices: [
      { eventId: 'autotech-2026', name: 'Autotech 2026', dates: '20–21 Nov 2026', statusLabel: 'Upcoming', action: { type: 'navigate', url: URL26, label: 'the Autotech 2026 editor' } },
      { eventId: 'autotech-2025', name: 'Autotech 2025', dates: '14 Nov 2025', statusLabel: 'Completed', action: { type: 'navigate', url: URL25, label: 'the Autotech 2025 editor' } }
    ] })] });
  await Pch.say('Take me to the Autotech editor');
  var bch = Pch.last();
  check('D.1 choose: one button per edition, "<name> · <dates> · <status>"', bch.choices_ && same(bch.choices_.map(function (c) { return c.label; }), ['Autotech 2026 · 20–21 Nov 2026 · Upcoming', 'Autotech 2025 · 14 Nov 2025 · Completed']));
  check('D.1 choose: nothing runs before a choice', bch.countdowns.length === 0 && Pch.listing.applied.length === 0);
  bch.pick(0);
  await flush();
  check('D.1 choose: the click starts that choice\'s countdown', bch.countdowns.length === 1 && bch.links[0].href === URL26);
  check('D.1 choose: no new POST /api/dash-bot', Pch.botCalls().length === 1);
  check('D.1 choose: /turn done with the chosen id', same(Pch.turnCalls(), [{ turnId: T5, status: 'done', note: 'autotech-2026' }]), Pch.turnCalls());
  bch.pick(1);
  bch.choices_[1].onClick({});
  check('D.1 choose: a second click does nothing', bch.countdowns.length === 1 && bch.picked === 0);
  Pch.clock.tick(1200);
  check('D.1 choose: then it goes', same(Pch.assigned, [URL26]));
  /* a choice whose action cannot run leaves the others open (the kit takes a false as "not chosen") */
  var Pcf = await page({ answers: [ok({ turnId: T5, kind: 'choose', parts: [{ t: 'text', v: 'Which one?' }], list: null, action: null, asOf: 'x', notes: [],
    choices: [{ eventId: 'bad', name: 'Bad', dates: '', statusLabel: '', action: { type: 'navigate', url: 'https://evil/', label: 'evil' } },
      { eventId: 'autotech-2026', name: 'Autotech 2026', dates: '', statusLabel: 'Upcoming', action: { type: 'navigate', url: URL26, label: 'the editor' } }] })] });
  await Pcf.say('x');
  var bcf = Pcf.last();
  bcf.pick(0);
  check('D.1 choose: a choice that cannot run is not taken, and says why', bcf.picked === -1 && /^That could not be done here\./.test(bcf.notes[0] || '') && same(Pcf.turnCalls().map(function (t) { return t.status; }), ['failed']));
  bcf.pick(1);
  check('D.1 choose: …the other one still can be', bcf.picked === 1 && bcf.countdowns.length === 1 && Pcf.turnCalls().some(function (t) { return t.status === 'done' && t.note === 'autotech-2026'; }));
  /* "I could not find …": the server offers a search of the list as the one choice (no event id) */
  var SEARCH = { view: 'active', search: 'Autotek', types: [], mine: false, created: null, starts: null, sort: null };
  var Pnf = await page({ answers: [ok({ turnId: T5, kind: 'choose', parts: [{ t: 'text', v: 'I could not find an event called “Autotek” in your events.' }], list: null, action: null, asOf: 'x', notes: ['not-found'],
    choices: [{ eventId: null, name: 'Search the list for “Autotek”', dates: '', statusLabel: '', action: { type: 'filter', patch: SEARCH, label: 'Active events · matching “Autotek”' } }] })] });
  await Pnf.say('open Autotek');
  var bnf = Pnf.last();
  check('D.1 not found: one button, "Search the list for …"', bnf.choices_.length === 1 && bnf.choices_[0].label === 'Search the list for “Autotek”');
  bnf.pick(0);
  check('D.1 not found: the click filters the list, folds and reports done (with no id)', same(Pnf.listing.applied[0], SEARCH) && Pnf.kit.chat.folds.length === 1 &&
    same(Pnf.turnCalls(), [{ turnId: T5, status: 'done' }]), Pnf.turnCalls());

  /* ======== List answers and "Show these in the list" ======== */
  var Pl = await page({ answers: [ok({ turnId: T6, kind: 'reply', parts: [{ t: 'value', v: '23', metric: 'count' }, { t: 'text', v: ' events go live this month.' }], list: LIST, action: null, choices: null, asOf: '2026-11-03T06:35:00.000Z', notes: [] }),
    ok({ turnId: 'TurnUndo000008', kind: 'undo', parts: [{ t: 'text', v: 'Undoing.' }], list: null, action: { type: 'undo' }, choices: null, asOf: 'x', notes: [] })] });
  await Pl.say('Which events go live this month?');
  var bl = Pl.last();
  check('D.1 list: drawn by the kit with the server\'s rows', bl.lists.length === 1 && bl.lists[0].title === 'Events that go live this month' && bl.lists[0].count === 23 && bl.lists[0].more === true && bl.lists[0].items.length === 2);
  check('D.1 list: a row is name link, dates, status chip and registrations', same(bl.lists[0].items[0], { href: '/edit-event.html?event=awards-2026', name: 'ET Awards 2026', meta: '20–21 Nov 2026', chip: { label: 'Upcoming', tone: 'upcoming' }, value: '1,234 registrations' }), bl.lists[0].items[0]);
  check('D.1 list: "Site not live" comes through as the chip; one registration is singular', bl.lists[0].items[1].chip.label === 'Site not live' && bl.lists[0].items[1].value === '1 registration');
  check('D.1 list: figures carry their "as of"', bl.o.asOf === '2026-11-03T06:35:00.000Z');
  var show = bl.buttons.filter(function (x) { return x.label === 'Show these in the list'; })[0];
  check('D.1 list: "Show these in the list" when the server offers a list view', !!show);
  show.click();
  check('D.1 Show these in the list: apply(list.view) and the peek', same(Pl.listing.applied[0], LIST.view) && Pl.kit.chat.folds[0].label === 'Showing Events that go live this month');
  check('D.1 …kept under rv.dashBot.undo.<turnId>.list, with its own Undo', !!Pl.session.getItem('rv.dashBot.undo.' + T6 + '.list') && bl.buttons.some(function (x) { return x.label === 'Undo'; }));
  check('D.1 …the button is spent', show.disabled === true && show.textContent === 'Shown in the list');
  await Pl.say('undo that');
  check('D.1 "undo that" puts back the newest list change of this tab', Pl.listing.restored.length === 1 && Pl.listing.restored[0].mark === 1);
  check('D.1 …says so', Pl.last().content === 'Done, the list is back as it was.');
  check('D.1 …and reports nothing for a "Show these in the list" change', Pl.turnCalls().length === 0);
  var Pnl = await page({ answers: [ok({ turnId: T6, kind: 'reply', parts: [{ t: 'text', v: 'Here.' }], list: { title: 'By registrations', count: 2, more: false, items: LIST.items, view: null }, action: null, asOf: 'x', notes: [] })] });
  await Pnl.say('top events by registrations');
  check('D.1 no list view → no "Show these in the list"', !Pnl.last().buttons.some(function (x) { return x.label === 'Show these in the list'; }));

  /* a row's two figures: the one the list is ranked by leads, the other follows the dates */
  var BOTH = [
    { id: 'awards-2026', name: 'ET Awards 2026', href: '/edit-event.html?event=awards-2026', dates: '20–21 Nov 2026', status: 'upcoming', statusLabel: 'Upcoming', registrations: 10, visitors: 9000 },
    { id: 'autotech-2026', name: 'Autotech 2026', href: '/edit-event.html?event=autotech-2026', dates: '1 Dec 2026', status: 'upcoming', statusLabel: 'Upcoming', registrations: 1200, visitors: 500 },
    { id: 'solo', name: 'Solo', href: '/edit-event.html?event=solo', dates: '2 Dec 2026', status: 'upcoming', statusLabel: 'Upcoming', visitors: 1 },
    { id: 'bare', name: 'Bare', href: '/edit-event.html?event=bare', dates: '3 Dec 2026', status: 'upcoming', statusLabel: 'Upcoming' }
  ];
  function listTurn(id, list) { return ok({ turnId: id, kind: 'reply', parts: [{ t: 'text', v: 'Here.' }], list: list, action: null, asOf: 'x', notes: [] }); }
  var Pv = await page({ answers: [
    listTurn('TurnVisit00001', { title: 'Your events · by visitors, most first', count: 4, more: false, items: BOTH, view: null }),
    listTurn('TurnVisit00002', { title: 'Top events', metric: 'visitors', count: 4, more: false, items: BOTH, view: null }),
    listTurn('TurnVisit00003', { title: 'Most visited, with registrations', metric: 'registrations', count: 4, more: false, items: BOTH, view: null }),
    listTurn('TurnVisit00004', { title: 'Events that go live this month', count: 4, more: false, items: BOTH, view: null }),
    listTurn('TurnVisit00005', { title: 'Most visited events', metric: 'nonsense', count: 4, more: false, items: BOTH, view: null })] });
  await Pv.say('Which events had the most visitors?');
  var vi = Pv.last().lists[0].items;
  check('D.1 ranked by visitors (the title says so): visitors lead each row, registrations follow the dates',
    vi[0].value === '9,000 visitors' && vi[0].meta === '20–21 Nov 2026 · 10 registrations' && vi[1].value === '500 visitors' && vi[1].meta === '1 Dec 2026 · 1,200 registrations', vi);
  check('D.1 …one visitor is singular; a row with one figure shows it once', vi[2].value === '1 visitor' && vi[2].meta === '2 Dec 2026', vi[2]);
  check('D.1 …a row with no figures: no value, just its dates', vi[3].value === '' && vi[3].meta === '3 Dec 2026', vi[3]);
  await Pv.say('top events');
  vi = Pv.last().lists[0].items;
  check('D.1 the server\'s list.metric = visitors wins over a title that does not say it', vi[0].value === '9,000 visitors' && vi[0].meta === '20–21 Nov 2026 · 10 registrations', vi[0]);
  await Pv.say('most visited, with registrations');
  vi = Pv.last().lists[0].items;
  check('D.1 the server\'s list.metric = registrations wins over the title', vi[0].value === '10 registrations' && vi[0].meta === '20–21 Nov 2026 · 9,000 visitors', vi[0]);
  await Pv.say('Which events go live this month?');
  vi = Pv.last().lists[0].items;
  check('D.1 any other list: registrations lead, visitors follow the dates', vi[1].value === '1,200 registrations' && vi[1].meta === '1 Dec 2026 · 500 visitors' && vi[2].value === '1 visitor' && vi[2].meta === '2 Dec 2026', vi);
  await Pv.say('most visited events');
  vi = Pv.last().lists[0].items;
  check('D.1 an unknown list.metric is ignored (the title decides)', vi[0].value === '9,000 visitors', vi[0]);
  /* the portal the list is on (the portals change): the dashboard's snapshot names it, '' for All portals */
  function hello(id) { return ok({ turnId: id, kind: 'reply', parts: [{ t: 'text', v: 'Hello.' }], list: null, action: null, asOf: '2026-11-03T06:35:00.000Z', notes: [] }); }
  var Ppo = await page({ answers: [hello('TurnPortal0001'), hello('TurnPortal0002')] });
  Ppo.listing.base.portal = 'cio';
  await Ppo.say('How many events are running?');
  var cPortal = Ppo.botCalls()[0];
  check('D.1 view.portal is the portal the list is on', !!cPortal && cPortal.body.view.portal === 'cio', cPortal && cPortal.body.view);
  Ppo.listing.base.portal = 7;
  await Ppo.say('And now?');
  cPortal = Ppo.botCalls()[1];
  check('D.1 …and anything but a string is All portals ("")', !!cPortal && cPortal.body.view.portal === '', cPortal && cPortal.body.view);
  var Pr = await page({ answers: [ok({ turnId: T6, kind: 'reply', parts: [{ t: 'text', v: 'Hello.' }], list: null, action: null, asOf: '2026-11-03T06:35:00.000Z', notes: [] })] });
  await Pr.say('hello');
  check('D.1 a reply with no figures has no "as of"', !('asOf' in Pr.last().o) && Pr.last().buttons.length === 0 && Pr.last().countdowns.length === 0);

  /* ======== "undo that" ======== */
  var Pu = await page({ answers: [filterAnswer(T1), ok({ turnId: 'TurnUndo000009', kind: 'undo', parts: [], list: null, action: { type: 'undo' }, asOf: 'x', notes: [] })] });
  await Pu.say('drafts'); await Pu.say('undo that'); await flush();
  check('D.1 undo kind: restores the newest filter and reports it undone', Pu.listing.restored.length === 1 && same(Pu.turnCalls(), [{ turnId: T1, status: 'undone' }]));
  check('D.1 undo kind: the filter card\'s Undo is spent', Pu.kit.chat.bubbles[0].buttons[0].disabled === true);
  var Pu0 = await page({ answers: [ok({ turnId: 'TurnUndo000010', kind: 'undo', parts: [], list: null, action: { type: 'undo' }, asOf: 'x', notes: [] })] });
  await Pu0.say('undo that');
  check('D.1 undo kind with nothing to undo: says what can be done instead', Pu0.last().content === 'There’s nothing here I can undo. Pages I opened can be left with your browser’s Back button, and a new event I started can be cleared with Undo on the Create Event page.' && Pu0.listing.restored.length === 0);

  /* ======== Refuse ======== */
  var Pref = await page({ answers: [ok({ turnId: 'TurnRefuse0011', kind: 'refuse', parts: [{ t: 'text', v: 'Publishing stays with you. Open the event and use Publish at the top.' }], list: null,
    action: { type: 'refuse', what: 'publish', pointer: { text: 'Publishing stays with you. Open the event and use Publish at the top.', href: '/edit-event.html?event=qa-draft', hrefLabel: 'Open QA Draft' } }, asOf: 'x', notes: [] }),
    ok({ turnId: 'TurnRefuse0012', kind: 'refuse', parts: [{ t: 'text', v: 'Deleting or cancelling an event is never done by ETB2B AI. It stays a manual step for you.' }], list: null,
    action: { type: 'refuse', what: 'delete', pointer: { text: 'Deleting or cancelling an event is never done by ETB2B AI. It stays a manual step for you.' } }, asOf: 'x', notes: [] }),
    ok({ turnId: 'TurnRefuse0013', kind: 'refuse', parts: [], list: null, action: { type: 'refuse', what: 'other', pointer: { text: 'I can’t do that here.', href: 'https://evil.example/' } }, asOf: 'x', notes: [] })] });
  await Pref.say('Publish QA Draft');
  var br = Pref.last();
  check('D.1 refuse (publish): the link to the console, the sentence not said twice', br.links.length === 1 && br.links[0].href === '/edit-event.html?event=qa-draft' && br.links[0].label === 'Open QA Draft' && br.notes.length === 0);
  check('D.1 refuse: no countdown, no list change, no report', br.countdowns.length === 0 && Pref.listing.applied.length === 0 && Pref.assigned.length === 0 && Pref.turnCalls().length === 0);
  await Pref.say('Delete QA Draft');
  check('D.1 refuse (delete): no link', Pref.last().links.length === 0);
  await Pref.say('do the other thing');
  check('D.1 refuse: the pointer\'s text when the parts lack it; an off-list link is not shown', Pref.last().notes[0] === 'I can’t do that here.' && Pref.last().links.length === 0);

  /* ======== Errors ======== */
  var Pe = await page({ answers: [{ status: 429, body: { code: 'dash-bot-daily', error: 'You have used today’s ETB2B AI allowance. It resets at midnight (India time).' } },
    { status: 429, body: { code: 'chat-rate', retryable: true, error: 'That is a lot of messages in a short time. Please wait a few minutes and try again.' } },
    { status: 500, body: { error: 'Something on our side failed.' } }, { status: 502, body: '<html>bad gateway</html>' },
    { status: 429, body: { code: 'dash-bot-daily' } }] });
  var e1 = await rejection(Pe.say('a'));
  check('D.1 429 dash-bot-daily: its sentence (the kit puts the text back with Try again)', e1 instanceof Error || (e1 && e1.message), e1);
  check('D.1 …the allowance sentence', e1 && e1.message === 'You have used today’s ETB2B AI allowance. It resets at midnight (India time).');
  var e2 = await rejection(Pe.say('b'));
  check('D.1 429 chat-rate: its sentence', e2 && e2.message === 'That is a lot of messages in a short time. Please wait a few minutes and try again.');
  var e3 = await rejection(Pe.say('c'));
  check('D.1 any other error: the server\'s own words', e3 && e3.message === 'Something on our side failed.');
  var e4 = await rejection(Pe.say('d'));
  check('D.1 no JSON at all (a 5xx page from in front of the API): one plain sentence, Try again kept', e4 && e4.message === 'ETB2B AI didn’t answer. Nothing was changed. Try again.' && e4.retryable !== false, e4 && e4.message);
  var e5 = await rejection(Pe.say('e'));
  check('D.1 a cap with no words of its own still gets the sentence', e5 && e5.message === 'You have used today’s ETB2B AI allowance. It resets at midnight (India time).');
  check('D.1 the day\'s allowance has no Try again (retryable false); a busy minute keeps it', e1.retryable === false && e5.retryable === false && e2.retryable !== false && e3.retryable !== false);
  check('D.1 a failed turn draws no bubble of its own and stays not busy', Pe.kit.chat.bubbles.length === 0 && same(Pe.kit.chat.busy[Pe.kit.chat.busy.length - 1], [false, undefined]));
  var P401 = await page({ answers: [{ status: 401, body: { error: 'Sign in.' } }] });
  var e6 = await rejection(P401.say('a'));
  check('D.1 401: "Your session has ended. Sign in again."', e6 && e6.message === 'Your session has ended. Sign in again.' && e6.retryable === false);
  P401.clock.tick(1999);
  check('D.1 401: sign-in only after 2 s', P401.redirected.length === 0);
  P401.clock.tick(1);
  check('D.1 401: then RevampAuth.redirectToSignIn', P401.redirected.length === 1);
  var Pso = await page({ fetchFails: { status: 401, code: 'revamp/signed-out' } });
  var e7 = await rejection(Pso.say('a'));
  check('D.1 signed out before the request: the same sentence', e7 && e7.message === 'Your session has ended. Sign in again.');
  var Poff = await page({ offline: true, fetchFails: new TypeError('Failed to fetch') });
  var e8 = await rejection(Poff.say('a'));
  check('D.1 offline: its sentence', e8 && e8.message === 'You’re offline. Check your connection and try again.');
  var Pnet = await page({ fetchFails: new TypeError('Failed to fetch') });
  var e9 = await rejection(Pnet.say('a'));
  check('D.1 online but unreachable: its own sentence', e9 && e9.message === 'Could not reach ETB2B AI. Check your connection and try again.');
  var Plong = await page();
  var e10 = await rejection(Plong.say(new Array(4002).join('x')));
  check('D.1 over 4,000 characters: refused here, with the server\'s sentence, and nothing sent', e10 && /^Keep the message under 4,000 characters\./.test(e10.message) && Plong.botCalls().length === 0 && e10.retryable === false);
  var Ptl = await page({ answers: [{ status: 400, body: { code: 'too-long', error: 'Keep the message under 4,000 characters. For a longer brief, ask me to start a new event from a brief, then paste it on Create Event.' } }] });
  var e12 = await rejection(Ptl.say('x'));
  check('D.1 the server\'s too-long answer: its sentence, no Try again', e12 && /^Keep the message under 4,000/.test(e12.message) && e12.retryable === false);
  var Prt = await page({ answers: [{ status: 503, body: { error: 'The AI service is not answering.', code: 'ai-unavailable', retryable: false } }] });
  var e13 = await rejection(Prt.say('x'));
  check('D.1 the AI service down (ai-unavailable): the shell\'s sentence by its code, not the server\'s old words (UX-097)', e13 && e13.message === 'ETB2B AI is busy right now. Nothing was changed. Try again in a minute.', e13 && e13.message);
  var Pnr = await page({ answers: [{ status: 500, body: { error: 'This can not be done for that event.', retryable: false } }] });
  var e14 = await rejection(Pnr.say('x'));
  check('D.1 a server error with words of its own that says it is not worth retrying is shown without Try again', e14 && e14.message === 'This can not be done for that event.' && e14.retryable === false);
  var Pslow = await page({ answer: function (call) { return call.url === '/api/dash-bot' ? { reject: null, hang: true } : null; } });
  /* an answer that never comes */
  Pslow.ctx.RevampAuth.authedFetch = function () { return new Promise(function () {}); };
  var slow = rejection(Pslow.say('a'));
  Pslow.clock.tick(8000);
  check('D.1 after 8 s: "Still working. This can take up to a minute."', same(Pslow.kit.chat.busy[Pslow.kit.chat.busy.length - 1], [true, 'Still working. This can take up to a minute.']));
  Pslow.clock.tick(82000);
  var e11 = await slow;
  check('D.1 an answer that never comes is given up, and the text goes back', e11 && e11.message === 'ETB2B AI is taking too long to answer. Try again.');

  /* ======== notKept: the answer stands, nothing is reported ======== */
  var nk = filterAnswer(T1); delete nk.body.turnId; nk.body.notKept = true;
  var Pnk = await page({ answers: [nk, (function () { var a = navAnswer(T4, URL1); delete a.body.turnId; a.body.notKept = true; return a; })()] });
  await Pnk.say('drafts');
  check('D.1 notKept: "This message wasn’t saved to your history."', Pnk.last().notes.indexOf('This message wasn’t saved to your history.') !== -1);
  check('D.1 notKept: the filter still runs, with Undo', Pnk.listing.applied.length === 1 && Pnk.last().buttons.length === 1);
  check('D.1 notKept: its snapshot is held only in memory', !Object.keys(Pnk.session._m).some(function (k) { return k.indexOf('rv.dashBot.undo.') === 0; }));
  Pnk.last().buttons[0].click();
  await Pnk.say('open'); Pnk.last().countdowns[0].cancel(); await flush();
  check('D.1 notKept: Undo and Stay here work, with no /turn calls', Pnk.listing.restored.length === 1 && Pnk.turnCalls().length === 0);

  /* ======== History: the person's own, replayed on the first open ======== */
  var sessH = makeStorage();
  sessH.setItem('rv.dashBot.undo.TurnHist000001', JSON.stringify({ at: 1000, kind: 'filter', label: 'Draft events', snap: { tab: 'active', mark: 'h1' } }));
  sessH.setItem('rv.dashBot.undo.TurnHist000004.list', JSON.stringify({ at: 2000, kind: 'list', label: 'Events this month', snap: { tab: 'upcoming', mark: 'h4' } }));
  var HIST = { turns: [
    { id: 'TurnHist000001', question: 'Show drafts from last week', answer: 'Here are your drafts.', parts: [{ t: 'text', v: 'Here are your drafts.' }], list: null, asOf: 'a', kind: 'filter', status: 'done', action: { type: 'filter', label: 'Draft events' }, at: '2026-11-02T05:00:00Z' },
    { id: 'TurnHist000002', question: 'Show upcoming', answer: 'Here.', parts: [], list: null, asOf: 'a', kind: 'filter', status: 'done', action: { type: 'filter', label: 'Upcoming events' }, at: '2026-11-02T05:01:00Z' },
    { id: 'TurnHist000003', question: 'Show cancelled', answer: 'Here.', parts: [], list: null, asOf: 'a', kind: 'filter', status: 'undone', action: { type: 'filter', label: 'Cancelled events' }, at: '2026-11-02T05:02:00Z' },
    { id: 'TurnHist000004', question: 'Which go live this month?', answer: '23 events.', parts: [{ t: 'value', v: '23', metric: 'count' }], list: { title: 'Events this month', count: 23, more: true, items: LIST.items }, asOf: '2026-11-02T05:03:00Z', kind: 'reply', status: 'answered', action: null, at: '2026-11-02T05:03:00Z' },
    { id: 'TurnHist000005', question: 'Open Autotech', answer: 'Opening.', parts: [], list: null, asOf: 'a', kind: 'open', status: 'done', action: { type: 'navigate', label: 'Autotech 2026', url: '/edit-event.html?event=autotech-2026' }, at: '2026-11-02T05:04:00Z' },
    { id: 'TurnHist000006', question: 'Open evil', answer: 'x', parts: [], list: null, asOf: 'a', kind: 'open', status: 'done', action: { type: 'navigate', label: 'Evil', url: 'https://evil/' }, at: '2026-11-02T05:05:00Z' },
    { id: 'TurnHist000007', question: 'Open Promotions', answer: 'x', parts: [], list: null, asOf: 'a', kind: 'promo', status: 'undone', action: { type: 'navigate', label: 'Promotions', url: '/marketing.html?event=a1&tab=posts' }, at: '2026-11-02T05:06:00Z' }
  ] };
  var Ph = await page({ session: sessH, history: HIST, answers: [filterAnswer(T1)] });
  var n = await Ph.kit.chat.opts.loadHistory();
  var ch = Ph.kit.chat;
  check('D.1 history: GET /api/dash-bot/history', Ph.calls.some(function (c) { return c.url === '/api/dash-bot/history' && c.method === 'GET'; }));
  check('D.1 history: resolves with the number of turns', n === 7);
  check('D.1 history: "Earlier", the turns (question, then answer), then "Now"', same(ch.dividers, ['Earlier', 'Now']) && ch.order[0] === 'divider:Earlier' && ch.order[1] === 'user' && ch.order[2] === 'ai' && ch.order[ch.order.length - 1] === 'divider:Now');
  check('D.1 history: questions as the person typed them', same(ch.users.map(function (u) { return u.text; }), HIST.turns.map(function (t) { return t.question; })));
  check('D.1 history: answers keep their parts and lists', same(ch.bubbles[0].content, HIST.turns[0].parts) && ch.bubbles[3].lists.length === 1 && ch.bubbles[3].lists[0].count === 23);
  check('D.1 history: an old figure carries its own "as of"', ch.bubbles[3].o.asOf === '2026-11-02T05:03:00Z' && !('asOf' in ch.bubbles[0].o));
  check('D.1 history: Undo only on a filter this tab still holds', ch.bubbles[0].buttons.length === 1 && ch.bubbles[1].buttons.length === 0 && ch.bubbles[2].buttons.length === 0);
  check('D.1 history: an undone filter says so', ch.bubbles[2].notes[0] === 'Showed Cancelled events, then undone.');
  check('D.1 history: a "Show these in the list" this tab holds keeps its Undo; no new "Show these" on old lists', ch.bubbles[3].buttons.length === 1 && ch.bubbles[3].buttons[0].label === 'Undo');
  check('D.1 history: a page opened keeps its link; one off the whitelist does not; a stay says so',
    ch.bubbles[4].links.length === 1 && ch.bubbles[4].links[0].href === '/edit-event.html?event=autotech-2026' && ch.bubbles[5].links.length === 0 && ch.bubbles[6].notes[0] === 'You stayed on this page.');
  check('D.1 history: an Undo read back from the history is not a change made in this tab (changedAt stays 0)', Ph.ctx.RevampDashBot.brain.changedAt() === 0);
  await Ph.say('drafts');
  ch.bubbles[0].buttons[0].click();
  check('D.1 history: an old Undo with a newer change asks first', Ph.confirms.length === 1);
  await flush();
  check('D.1 history: …then restores the old snapshot and reports both', Ph.listing.restored[0].mark === 'h1' && Ph.turnCalls().some(function (t) { return t.turnId === 'TurnHist000001' && t.status === 'undone'; }) &&
    Ph.turnCalls().some(function (t) { return t.turnId === T1 && t.status === 'undone'; }));
  var Ph0 = await page({ history: { turns: [] } });
  check('D.1 history: none → 0, no dividers', (await Ph0.kit.chat.opts.loadHistory()) === 0 && Ph0.kit.chat.dividers.length === 0);
  /* QA F5 and F6 in the history: a create kept with no words, and a page opened from its card after Stay here */
  var Phc = await page({ history: { turns: [
    { id: 'TurnHist000008', question: 'Create an IP event called QA Dashbot Expo on 12 Feb 2027', answer: '', parts: [], list: null, asOf: 'a', kind: 'create', status: 'done',
      action: { type: 'create', label: 'Create Event, filled in', url: '/create-event.html?new=1&prefill=TurnHist000008' }, at: '2026-11-02T05:07:00Z' },
    { id: 'TurnHist000009', question: 'Open Promotions', answer: 'x', parts: [], list: null, asOf: 'a', kind: 'promo', status: 'done',
      action: { type: 'navigate', label: 'Promotions', url: '/marketing.html?event=a1&tab=posts' }, at: '2026-11-02T05:08:00Z' }
  ] } });
  await Phc.kit.chat.opts.loadHistory();
  var hc = Phc.kit.chat.bubbles;
  check('D.1 history: a create with no words reads "Starting Create Event with your details.", then what was done', hc[0].content === 'Starting Create Event with your details.' &&
    hc[0].notes[0] === 'Opened Create Event, filled in.', [hc[0].content, hc[0].notes]);
  check('D.1 history: a page opened after Stay here keeps its link and no "You stayed" line', hc[1].links.length === 1 && hc[1].notes.indexOf('You stayed on this page.') === -1);
  var Phx = await page({ answer: function (call) { return call.url === '/api/dash-bot/history' ? { status: 500, body: { error: 'x' } } : null; } });
  var hx = await rejection(Phx.kit.chat.opts.loadHistory());
  check('D.1 history: a failed read rejects, so the kit says the earlier messages could not be loaded', hx && /could not be loaded/.test(hx.message) && Phx.kit.chat.dividers.length === 0);

  /* ======== portals (plan §17): the working portal in the view, the switch and its Undo ======== */
  var Pw = await page({ answers: [hello('TurnPortalW001'), hello('TurnPortalW002')] });
  Pw.listing.base.portal = 'hr'; Pw.listing.base.working = 'cio';
  await Pw.say('Which drafts are there?');
  check('D.1p view.working is the portal worked in, view.portal the one the list shows for now', same([Pw.botCalls()[0].body.view.portal, Pw.botCalls()[0].body.view.working], ['hr', 'cio']), Pw.botCalls()[0].body.view);
  Pw.listing.base.working = 'all';
  await Pw.say('again');
  check('D.1p …All portals is "" (as the server reads it)', Pw.botCalls()[1] && Pw.botCalls()[1].body.view.working === '', Pw.botCalls()[1] && Pw.botCalls()[1].body.view);
  function switchAnswer(id, to, label) {
    return ok({ turnId: id, kind: 'portal', parts: [{ t: 'text', v: 'Switching the dashboard to the portal you asked for.' }], list: null,
      action: { type: 'portal', portal: to, label: label }, choices: null, asOf: '2026-11-03T06:35:00.000Z', notes: [] });
  }
  function withSetPortal(L, ok2) {
    L.portalSets = [];
    L.setPortal = function (v) { L.portalSets.push(v); if (!ok2) return null; var before = L.snapshot(); before.mark = ++L.n; before.working = 'cio'; return before; };
    return L;
  }
  var PS = await page({ answers: [switchAnswer('TurnSwitch0001', 'auto', 'ETAuto')], listing: withSetPortal(makeListing(), true) });
  await PS.say('switch to ETAuto');
  var bS = PS.last();
  check('D.1p switch: RvListing.setPortal gets the portal', same(PS.listing.portalSets, ['auto']), PS.listing.portalSets);
  check('D.1p switch: the card says where the dashboard now is, with Undo', bS.notes.indexOf('Now working in ETAuto.') !== -1 && bS.buttons.some(function (x) { return x.undo; }), bS.notes);
  check('D.1p switch: the panel folds to its peek', PS.kit.chat.folds.length === 1 && PS.kit.chat.folds[0].label === 'Now working in ETAuto', PS.kit.chat.folds);
  check('D.1p switch: the list as it was is kept for Undo', !!JSON.parse(PS.session.getItem('rv.dashBot.undo.TurnSwitch0001') || 'null'));
  bS.buttons.filter(function (x) { return x.undo; })[0].click();
  await flush();
  check('D.1p switch Undo: restore(the snapshot before, {portal:true}) switches back', PS.listing.restored.length === 1 && PS.listing.restored[0].working === 'cio', PS.listing.restored);
  check('D.1p switch Undo: /turn undone', same(PS.turnCalls(), [{ turnId: 'TurnSwitch0001', status: 'undone' }]), PS.turnCalls());
  /* restore() is asked to move the portal back only when ETB2B AI moved it */
  var restoreOpts = [];
  var LF = makeListing(); LF.restore = function (snap, o) { restoreOpts.push(o || null); return true; };
  var PF = await page({ answers: [filterAnswer(T1)], listing: LF });
  await PF.say('drafts');
  PF.last().buttons[0].click(); await flush();
  check('D.1p a filter\'s Undo never moves the portal worked in', restoreOpts.length === 1 && restoreOpts[0] === null, restoreOpts);
  var LB = withSetPortal(makeListing(), true), bothOpts = [];
  LB.restore = function (snap, o) { bothOpts.push([snap.mark, o || null]); return true; };
  var PB = await page({ answers: [switchAnswer('TurnSwitch0002', 'auto', 'ETAuto'), filterAnswer(T2)], listing: LB, confirm: true });
  await PB.say('switch to ETAuto'); await PB.say('drafts');
  PB.kit.chat.bubbles[0].buttons.filter(function (x) { return x.undo; })[0].click(); await flush();
  check('D.1p going back past a switch ETB2B AI made switches back too ({portal:true})', bothOpts.length === 1 && bothOpts[0][1] && bothOpts[0][1].portal === true, bothOpts);
  var PX = await page({ answers: [switchAnswer('TurnSwitch0003', 'auto', 'ETAuto')], listing: withSetPortal(makeListing(), false), quiet: true });
  await PX.say('switch to ETAuto');
  check('D.1p a switch the page refused: says so, reported failed, no Undo', PX.last().notes.some(function (n) { return /could not be switched/.test(n); }) &&
    PX.turnCalls().length === 1 && PX.turnCalls()[0].status === 'failed' && !PX.last().buttons.some(function (x) { return x.undo; }), [PX.last().notes, PX.turnCalls()]);
  var PY = await page({ answers: [switchAnswer('TurnSwitch0004', 'Bad Slug!', 'X')], listing: withSetPortal(makeListing(), true), quiet: true });
  await PY.say('switch');
  check('D.1p an odd portal value is never passed on', PY.listing.portalSets.length === 0 && PY.turnCalls()[0].status === 'failed', PY.listing.portalSets);
  var PH = await page({ history: { turns: [{ id: 'TurnSwitch0005', question: 'switch to ETAuto', parts: [{ t: 'text', v: 'Switching.' }], kind: 'portal', status: 'undone', action: { type: 'portal', label: 'ETAuto' }, at: '2026-11-03T06:00:00.000Z' }] } });
  PH.kit.chat.opts.loadHistory(); await flush();
  check('D.1p history: a switch reads "Switched to ETAuto, then undone."', PH.kit.chat.bubbles.some(function (b) { return b.notes.indexOf('Switched to ETAuto, then undone.') !== -1; }), PH.kit.chat.bubbles.map(function (b) { return b.notes; }));
  /* lists across portals name each event's portal; choices too */
  var portalList = { title: 'Draft events · across all portals', count: 2, more: false, showPortal: true,
    items: [{ id: 'a', name: 'A', href: '/edit-event.html?event=a', dates: '8 Nov 2026', status: 'draft', statusLabel: 'Draft', portal: 'ETCIO' },
      { id: 'b', name: 'B', href: '/edit-event.html?event=b', dates: 'no date yet', status: 'draft', statusLabel: 'Draft', portal: 'No portal yet' }], view: null };
  var PL = await page({ answers: [ok({ turnId: 'TurnPortalL001', kind: 'reply', parts: [{ t: 'text', v: 'Here they are.' }], list: portalList, action: null, asOf: 'x', notes: [] })] });
  await PL.say('drafts in all portals');
  var plItems = PL.last().lists[0].items;
  check('D.1p a list across portals: each row names its portal, "No portal yet" for none', plItems[0].meta === 'ETCIO · 8 Nov 2026' && plItems[1].meta === 'No portal yet · no date yet', plItems);
  portalList.showPortal = false;
  var PL2 = await page({ answers: [ok({ turnId: 'TurnPortalL002', kind: 'reply', parts: [{ t: 'text', v: 'Here.' }], list: portalList, action: null, asOf: 'x', notes: [] })] });
  await PL2.say('drafts');
  check('D.1p …a one-portal list does not repeat it', PL2.last().lists[0].items[0].meta === '8 Nov 2026', PL2.last().lists[0].items[0]);
  var PC = await page({ answers: [ok({ turnId: 'TurnChooseP001', kind: 'choose', parts: [{ t: 'text', v: 'Which one?' }], list: null, action: null, asOf: 'x', notes: [],
    choices: [{ eventId: 'a', name: 'Autotech', portal: 'ETAuto', dates: '20 Nov 2026', statusLabel: 'Upcoming', action: navAnswer('x', '/edit-event.html?event=a').body.action }] })] });
  await PC.say('open autotech');
  check('D.1p a choice names the event\'s portal', PC.last().choices_[0].label === 'Autotech · ETAuto · 20 Nov 2026 · Upcoming', PC.last().choices_[0].label);

  /* ======== the hero picture request (plan §18): the card says it, and it is handed to Create Event ======== */
  var heroPrefill = JSON.parse(JSON.stringify(PREFILL)); heroPrefill.hero = { subject: '' };
  var PHc = await page({ answers: [createAnswer('TurnHero000001', [], { prefill: heroPrefill })] });
  await PHc.say('Create an IP event called Retail Leadership Summit on 12 Feb 2027 at Jio World Centre, Mumbai');
  var heroCd = PHc.last().countdowns[0];
  check('D.1h the create card says a hero picture is made once the event is created', !!heroCd && /· a hero picture once it is created…$/.test(heroCd.label), heroCd && heroCd.label);
  var heroKept = JSON.parse(PHc.local.getItem('revamp.createEvent.prefill.v1.TurnHero000001') || 'null');
  check('D.1h the request travels in the prefill, unchanged', !!heroKept && same(heroKept.hero, { subject: '' }), heroKept && heroKept.hero);
  var PHn = await page({ answers: [createAnswer('TurnHero000002', [])] });
  await PHn.say('Create an IP event called X, no picture');
  check('D.1h no request, no mention of a picture', !/hero picture/.test(PHn.last().countdowns[0].label), PHn.last().countdowns[0].label);


  /* ======== the dash brain off the dashboard (plan §4c): an event's console, no RvListing ======== */
  function portalsStub(start, failSave) {
    var P0 = { working_: start || 'cio', sets: [] };
    P0.cachedWorking = function () { return P0.working_; };
    P0.setWorking = function (v) { P0.sets.push(v); P0.working_ = v; return failSave ? Promise.reject(new Error('Your portal choice is kept in this browser only: it could not be saved to your account.')) : Promise.resolve(v); };
    return P0;
  }
  var CON = { page: 'console', noListing: true, search: '?event=qa-main', hash: '#content/speakers' };
  function conPage(extra) { var o = {}; Object.keys(CON).forEach(function (k) { o[k] = CON[k]; }); Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); if (!o.portals) o.portals = portalsStub(); return page(o); }
  var Pe0 = await conPage({ answers: [hello('TurnConsole001')] });
  var oc = Pe0.kit.mounts[0] && Pe0.kit.mounts[0].opts;
  check('D.2 the console: the panel mounts with the kit id "ai" (the dashboard keeps "dash")', !!oc && oc.id === 'ai' && Pe0.kit.mounts[0].host === Pe0.host);
  check('D.2 …its header says it works on this event only: "This event only" (named once the history has come)', oc.scope === 'This event only');
  var DT = Pe0.ctx.RevampDashBot.TEXT;
  check('D.2 …the welcome says it works on this event only, never that it starts a new one', oc.welcome.heading === 'Hi Asha, I’m ETB2B AI.' && oc.welcome.text === DT.welcomeEvent &&
    /^I work on this event only/.test(oc.welcome.text) && !/start a new event/.test(oc.welcome.text), oc.welcome);
  check('D.2 …suggestions for this event only, each one only fills the box', same(oc.suggestions.map(function (x) { return x.text; }), ['How many registrations does this event have?', 'Open this event’s speakers', 'Make a save-the-date post for this event', 'Open this event’s registrations']));
  check('D.2 …quick ideas stay after the first turn (they fill, never send)', oc.quickIdeas.length === 2 && oc.quickIdeas.every(function (q) { return q.label && q.text && !/Create an/.test(q.text); }));
  check('D.2 …the foot note says this event only', oc.footNote === 'ETB2B AI works on this event only. It never deletes, cancels, publishes or approves anything.');
  check('D.2 …"Email Customer Care" mails Customer Care, naming the page', oc.help && oc.help.label === 'Email Customer Care' && oc.help.href === 'mailto:customercare@economictimesb2b.com?subject=' + encodeURIComponent('ETB2B EventSphere help: Event console'), oc.help);
  check('D.2 …the attach button takes pictures for the event\'s site editor, and PDFs and decks to read (owner decision 14)', oc.attach && oc.attach.max === 4 && /image\/png/.test(oc.attach.accept) && /application\/pdf/.test(oc.attach.accept) && /\.pptx/.test(oc.attach.accept) && !/text\/plain|\.docx/.test(oc.attach.accept) && oc.attach.label === 'Attach a picture, a PDF or a PowerPoint deck' && typeof oc.attach.add === 'function', oc.attach);
  check('D.2 …it is placed bottom-right, under the page\'s own windows', same(oc.placement, { right: 22, bottom: 22, compact: false }) && same(oc.zIndex, { launcher: 65, panel: 69 }));
  await Pe0.say('How many registrations here?');
  var cc = Pe0.botCalls()[0];
  check('D.2 the request: place { console, qa-main, content/speakers } and, with no list, only the portal worked in', cc && same(cc.body.place, { page: 'console', eventId: 'qa-main', tab: 'content/speakers' }) && same(cc.body.view, { working: 'cio' }), cc && cc.body);
  check('D.2 …the event is only inside place (the QA guard reads a top-level eventId)', !('eventId' in cc.body) && !('slug' in cc.body));

  /* ======== owner decision 10: the page's own lock, inside an event ========
     The server never sends any of these inside an event; an answer from an older or a tampered server is still
     neither shown nor done here. Each is said plainly, with the dashboard one click away, and reported failed. */
  function navHere(id, url, label) {
    return ok({ turnId: id, kind: 'open', parts: [{ t: 'text', v: 'Opening it.' }], list: null,
      action: { type: 'navigate', url: url, label: label || 'Promotions of QA Main', target: 'promotions', eventId: 'qa-main' }, choices: null, asOf: '2026-11-03T06:35:00.000Z', notes: [] });
  }
  function lockedSaid(P, b) {
    b = b || P.last();
    return !!b && b.content === DT.otherEvent && b.links.some(function (l) { return l.href === '/Event_Listing.html' && l.label === 'Open the dashboard'; }) &&
      P.assigned.length === 0 && P.kit.chat.folds.length === 0 && b.countdowns.length === 0 && b.lists.length === 0;
  }
  var Pe1 = await conPage({ answers: [filterAnswer('TurnConsole002')] });
  await Pe1.say('Show drafts from last week');
  check('D.2s a filter inside an event: not done, the plain line with Open the dashboard, reported failed in the event\'s conversation',
    lockedSaid(Pe1) && same(Pe1.turnCalls(), [{ turnId: 'TurnConsole002', status: 'failed', note: 'about another event', eventId: 'qa-main' }]), [Pe1.last(), Pe1.turnCalls()]);
  /* reported to the conversation the server says kept the turn, not the page's address */
  var glAnswer = filterAnswer('TurnConsoleG01'); glAnswer.body.scope = 'global';
  var PeG = await conPage({ answers: [glAnswer] });
  await PeG.say('Show drafts from last week');
  check('D.2s an answer kept in the person\'s own conversation (scope "global") is reported there, without the page\'s event',
    same(PeG.turnCalls(), [{ turnId: 'TurnConsoleG01', status: 'failed', note: 'about another event' }]), PeG.turnCalls());
  var evAnswer = filterAnswer('TurnConsoleE01'); evAnswer.body.scope = 'event'; evAnswer.body.eventId = 'qa-main';
  var PeE = await conPage({ answers: [evAnswer] });
  await PeE.say('Show drafts from last week');
  check('D.2s …and one kept in the event\'s (scope "event") is reported with that event', PeE.turnCalls().length === 1 && PeE.turnCalls()[0].eventId === 'qa-main', PeE.turnCalls());
  var relG = null;
  var PeS = await conPage({ answer: function (call) { return call.url === '/api/dash-bot' ? { hold: new Promise(function (r) { relG = r; }) } : null; } });
  var stopG = PeS.say('hello');
  PeS.kit.chat.busyOpts.onStop();
  await stopG;
  var lateG = navAnswer('TurnConsoleS01', '/edit-event.html?event=autotech-2026#design/editor'); lateG.body.scope = 'global';
  relG(lateG); await flush(); await flush();
  check('D.2 Stop on such an answer: reported stopped to the person\'s own conversation, nothing opened', same(PeS.turnCalls(), [{ turnId: 'TurnConsoleS01', status: 'stopped' }]) && PeS.assigned.length === 0, PeS.turnCalls());
  var Pe2 = await conPage({ answers: [ok({ turnId: 'TurnConsole003', kind: 'reply', parts: [{ t: 'text', v: 'Here.' }], list: LIST, action: null, asOf: 'x', notes: [] }), navHere('TurnConsole004', '/marketing.html?event=qa-main&tab=posts')] });
  await Pe2.say('Which events go live this month?');
  check('D.2s a list of events inside an event: never drawn, the plain line instead', lockedSaid(Pe2) && Pe2.kit.chat.bubbles.every(function (b) { return b.lists.length === 0; }), Pe2.last());
  await Pe2.say('Open its promotions');
  Pe2.clock.tick(1200);
  check('D.2 this event\'s own page opens: "Opening …", then the page (through the shell\'s leave)', same(Pe2.assigned, ['/marketing.html?event=qa-main&tab=posts']) && Pe2.session.getItem('rv.assistant.open.console') === '1', [Pe2.assigned, Pe2.session._m]);
  var PeD = await conPage({ answers: [ok({ turnId: 'TurnConsoleD01', kind: 'open', parts: [{ t: 'text', v: 'Opening it.' }], list: null, action: { type: 'navigate', url: '/Event_Listing.html', label: 'the events dashboard', target: 'dashboard' }, choices: null, asOf: 'x', notes: [] })] });
  await PeD.say('Take me back to the dashboard');
  PeD.clock.tick(1200);
  check('D.2 …and so does the events dashboard, to leave this event', same(PeD.assigned, ['/Event_Listing.html']), PeD.assigned);
  var Pe4 = await conPage({ answers: [navAnswer('TurnConsoleO01', '/edit-event.html?event=autotech-2026#design/editor')] });
  await Pe4.say('Open the Autotech editor');
  Pe4.clock.tick(5000);
  check('D.2s another event\'s page inside an event: never opened, its name never drawn, the plain line instead', lockedSaid(Pe4) && Pe4.kit.chat.bubbles.length === 1 &&
    same(Pe4.turnCalls(), [{ turnId: 'TurnConsoleO01', status: 'failed', note: 'about another event', eventId: 'qa-main' }]), [Pe4.last(), Pe4.assigned]);
  var odd = navHere('TurnConsoleO02', '/edit-event.html?event=autotech-2026#content/speakers'); odd.body.action.eventId = 'qa-main';
  var Pe5 = await conPage({ answers: [odd] });
  await Pe5.say('Open the speakers');
  Pe5.clock.tick(5000);
  check('D.2s …even when the action says this event but its address is another\'s', lockedSaid(Pe5), Pe5.assigned);
  var Pe6 = await conPage({ answers: [navHere('TurnConsoleO03', '/mailer-performance.html', 'Mailer performance')] });
  await Pe6.say('How did all my mailers do?');
  Pe6.clock.tick(5000);
  check('D.2s …and a page of every event (Mailer performance) is not opened from inside one', lockedSaid(Pe6), Pe6.assigned);
  var refOther = ok({ turnId: 'TurnConsoleR01', kind: 'refuse', parts: [{ t: 'text', v: 'Publishing stays with you.' }], list: null,
    action: { type: 'refuse', what: 'publish', pointer: { text: 'Publishing stays with you.', href: '/edit-event.html?event=autotech-2026', hrefLabel: 'Open Autotech 2026' } }, choices: null, asOf: 'x', notes: [] });
  var Pe7 = await conPage({ answers: [refOther] });
  await Pe7.say('publish it');
  check('D.2s a refusal whose link is another event\'s: that link never drawn', lockedSaid(Pe7) && !Pe7.last().links.some(function (l) { return /autotech/.test(l.href); }), Pe7.last().links);
  var scopedLine = ok({ turnId: 'TurnConsoleR02', kind: 'refuse', parts: [{ t: 'text', v: 'I work on QA Main here only: use the events dashboard for other events, a new event or another portal.' }], list: null,
    action: { type: 'refuse', what: 'other-event', pointer: { text: '', href: '/Event_Listing.html', hrefLabel: 'Open the dashboard' } }, choices: null, asOf: 'x', notes: ['scope-locked'] });
  var Pe8 = await conPage({ answers: [scopedLine] });
  await Pe8.say('How is Autotech doing?');
  var b8 = Pe8.last();
  check('D.2s the server\'s scoped line: its words once, with Open the dashboard, nothing else done', b8.content.length === 1 && b8.content[0].v.indexOf('I work on QA Main here only') === 0 &&
    b8.notes.length === 0 && b8.links.length === 1 && b8.links[0].href === '/Event_Listing.html' && b8.links[0].label === 'Open the dashboard' && Pe8.turnCalls().length === 0 && Pe8.assigned.length === 0, b8);
  /* the same line read back from the event's history (GET /api/chat/history keeps the action's type and label only):
     it gets its Open the dashboard again; any other refusal read back is drawn as before, with no link */
  var scopedKept = { id: 'TurnConsoleR03', question: 'How is Autotech doing?', answer: scopedLine.body.parts[0].v, parts: scopedLine.body.parts, list: null, asOf: 'x', kind: 'reply', dashKind: 'refuse',
    status: 'refused', brain: 'dash', action: { type: 'refuse', label: 'Refused: other-event' }, at: '2026-11-03T06:30:00.000Z' };
  Pe8.ctx.RevampDashBot.brain.replay(scopedKept);
  var b8h = Pe8.last();
  check('D.2s the scoped line replayed from the history keeps Open the dashboard (and only that)', b8h !== b8 && b8h.content[0].v.indexOf('I work on QA Main here only') === 0 &&
    b8h.links.length === 1 && b8h.links[0].href === '/Event_Listing.html' && b8h.links[0].label === 'Open the dashboard' && b8h.notes.length === 0 && Pe8.assigned.length === 0, b8h);
  Pe8.ctx.RevampDashBot.brain.replay(Object.assign({}, scopedKept, { id: 'TurnConsoleR04', action: { type: 'refuse', label: 'Refused: publish' } }));
  check('D.2s …another refusal replayed gets no link (as before)', Pe8.last().links.length === 0 && Pe8.last().notes.length === 0, Pe8.last());
  var Pe9 = await conPage({ answers: [ok({ turnId: 'TurnConsoleC01', kind: 'choose', parts: [{ t: 'text', v: 'Which one?' }], list: null, action: null, asOf: 'x', notes: [],
    choices: [{ eventId: 'qa-main', name: 'QA Main', action: navHere('x', '/edit-event.html?event=qa-main').body.action }, { eventId: 'autotech-2026', name: 'Autotech 2026', action: navAnswer('x', '/edit-event.html?event=autotech-2026').body.action }] })] });
  await Pe9.say('Open the console');
  check('D.2s a choice that offers another event: no choices drawn, the plain line', lockedSaid(Pe9) && !Pe9.kit.chat.bubbles.some(function (b) { return b.choices_; }), Pe9.last());
  var leakParts = ok({ turnId: 'TurnConsoleL01', kind: 'reply', parts: [{ t: 'event', id: 'autotech-2026', name: 'Autotech 2026', href: '/edit-event.html?event=autotech-2026' }, { t: 'text', v: ' has 9 registrations.' }], list: null, action: null, asOf: 'x', notes: [] });
  var Pe10 = await conPage({ answers: [leakParts] });
  await Pe10.say('How is Autotech doing?');
  check('D.2s an answer linking to another event: never drawn (its name and its number stay out)', lockedSaid(Pe10) && JSON.stringify(Pe10.kit.chat.bubbles.map(function (b) { return b.content; })).indexOf('Autotech') === -1, Pe10.kit.chat.bubbles.map(function (b) { return b.content; }));
  var Pe3 = await conPage({ answers: [createAnswer('TurnConsole005')] });
  await Pe3.say('Create an IP event called Retail Leadership Summit on 12 Feb 2027 at Jio World Centre, Mumbai');
  Pe3.clock.tick(1200);
  check('D.2s a new event inside an event: no prefill kept, Create Event not opened', lockedSaid(Pe3) && !Pe3.local.getItem('revamp.createEvent.prefill.v1.TurnConsole005') && Pe3.assigned.length === 0, [Pe3.assigned, Pe3.last()]);
  var portsE = portalsStub('cio');
  var PpE = await conPage({ portals: portsE, answers: [switchAnswer('TurnPortalE001', 'auto', 'ETAuto')] });
  await PpE.say('switch to ETAuto');
  var PeL = await conPage({});
  var eL = await rejection(PeL.say(new Array(4002).join('x')));
  check('D.2s a message too long inside an event: refused here, and the sentence offers no new event', eL && eL.message === 'Keep the message under 4,000 characters.' && PeL.botCalls().length === 0, eL && eL.message);
  check('D.2s a portal switch inside an event: the working portal never moves, nothing to undo', lockedSaid(PpE) && portsE.sets.length === 0 && PpE.ctx.RevampDashBot.brain.changedAt() === 0, [portsE.sets, PpE.last()]);
  var S = Pe0.ctx.RevampDashBot._scope;
  check('D.2s urlEvent: the event of every page address on the whitelist, none for a page of every event',
    S.urlEvent('/edit-event.html?event=a-1#design/editor') === 'a-1' && S.urlEvent('/marketing.html?event=a-1&tab=posts') === 'a-1' && S.urlEvent('/audience-registrations.html?event=a-1') === 'a-1' &&
    S.urlEvent('/preview/a-1?draft=1') === 'a-1' && S.urlEvent('/e/a-1') === 'a-1' && S.urlEvent('/activity-log.html?event=a-1') === 'a-1' && S.urlEvent('/activity-log.html') === '' &&
    S.urlEvent('/mailer-performance.html') === '' && S.urlEvent('/Event_Listing.html') === '' && S.urlEvent('/e/a-10') === 'a-10');
  check('D.2s inScope: off an event everything on the whitelist; inside one only its pages, the dashboard, a refusal staying there, and Undo',
    S.inScope({ type: 'create' }, { eventId: '' }) && S.inScope({ type: 'navigate', url: '/e/a-1' }, { eventId: 'a-1' }) && !S.inScope({ type: 'navigate', url: '/e/a-10' }, { eventId: 'a-1' }) &&
    S.inScope({ type: 'navigate', url: '/Event_Listing.html' }, { eventId: 'a-1' }) && !S.inScope({ type: 'navigate', url: '/activity-log.html' }, { eventId: 'a-1' }) &&
    S.inScope({ type: 'refuse', pointer: { text: 'x' } }, { eventId: 'a-1' }) && !S.inScope({ type: 'refuse', pointer: { href: '/e/b' } }, { eventId: 'a-1' }) &&
    S.inScope({ type: 'undo' }, { eventId: 'a-1' }) && !S.inScope({ type: 'filter' }, { eventId: 'a-1' }) && !S.inScope({ type: 'portal' }, { eventId: 'a-1' }) &&
    !S.inScope({ type: 'create' }, { eventId: 'a-1' }) && !S.inScope({ type: 'navigate', url: '/e/a-1', eventId: 'b' }, { eventId: 'a-1' }));

  /* the working portal off the dashboard, with Undo, on a page with no event (Mailer performance): inside an event
     the portal never moves (owner decision 10) */
  var MP = { page: 'mailer-performance', noListing: true, search: '' };
  function mpPage(extra) { var o = {}; Object.keys(MP).forEach(function (k) { o[k] = MP[k]; }); Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); if (!o.portals) o.portals = portalsStub(); return page(o); }
  var ports = portalsStub('cio');
  var Pp = await mpPage({ portals: ports, answers: [switchAnswer('TurnPortalE001', 'auto', 'ETAuto'), ok({ turnId: 'TurnPortalE002', kind: 'undo', parts: [], list: null, action: { type: 'undo' }, asOf: 'x', notes: [] })] });
  await Pp.say('switch to ETAuto');
  var bp = Pp.last();
  check('D.2 portal off the dashboard: RevampPortals.setWorking("auto")', same(ports.sets, ['auto']), ports.sets);
  check('D.2 …the card says what it means here', bp.notes.indexOf('Now working in ETAuto: the dashboard and Create Event will open on it.') !== -1, bp.notes);
  check('D.2 …the panel folds to "Now working in ETAuto", with Undo on the card', Pp.kit.chat.folds.length === 1 && Pp.kit.chat.folds[0].label === 'Now working in ETAuto' && bp.buttons.some(function (x) { return x.undo; }));
  bp.buttons.filter(function (x) { return x.undo; })[0].click();
  await flush();
  check('D.2 portal Undo: back to the portal worked in before ("cio"), reported undone in the person\'s own conversation', same(ports.sets, ['auto', 'cio']) &&
    same(Pp.turnCalls(), [{ turnId: 'TurnPortalE001', status: 'undone' }]) && bp.buttons.filter(function (x) { return x.undo; })[0].textContent === 'Undone', [ports.sets, Pp.turnCalls()]);
  var ports2 = portalsStub('all');
  var Pp2 = await mpPage({ portals: ports2, answers: [switchAnswer('TurnPortalE003', 'hr', 'ETHRWorld'), ok({ turnId: 'TurnPortalE004', kind: 'undo', parts: [], list: null, action: { type: 'undo' }, asOf: 'x', notes: [] })] });
  await Pp2.say('work in ETHRWorld'); await Pp2.say('undo that'); await flush();
  check('D.2 "undo that" off the dashboard puts the working portal back, and says so', same(ports2.sets, ['hr', 'all']) && Pp2.last().content === 'Done, you are back in the portal you worked in before.', [ports2.sets, Pp2.last().content]);
  /* changedAt and undoLocal: what the shell uses for a bare "undo that" (no AI call) */
  var ports5 = portalsStub('cio');
  var Pq5 = await mpPage({ portals: ports5, answers: [switchAnswer('TurnPortalE007', 'auto', 'ETAuto')] });
  var br5 = Pq5.ctx.RevampDashBot.brain;
  check('D.2u changedAt: 0 before any change', br5.changedAt() === 0);
  var t5 = Date.now();
  await Pq5.say('switch to ETAuto');
  var at5 = br5.changedAt();
  check('D.2u …then the time of the switch made in this tab', at5 >= t5 && at5 <= Date.now(), at5);
  var u5 = await br5.undoLocal();
  await flush();
  check('D.2u undoLocal: switched back with no AI call, said in the panel, reported undone', u5 && u5.ok === true && same(ports5.sets, ['auto', 'cio']) &&
    Pq5.botCalls().length === 1 && Pq5.last().content === 'Done, you are back in the portal you worked in before.' &&
    Pq5.turnCalls().some(function (t) { return t.turnId === 'TurnPortalE007' && t.status === 'undone'; }), [u5, ports5.sets, Pq5.last().content, Pq5.turnCalls()]);
  check('D.2u …the card\'s Undo is spent too, and changedAt is 0 again', br5.changedAt() === 0 && Pq5.kit.chat.bubbles[0].buttons.filter(function (x) { return x.undo; })[0].textContent === 'Undone');
  var u6 = await br5.undoLocal();
  check('D.2u undoLocal with nothing standing: says so, and nothing changes', u6 && u6.ok === false && same(ports5.sets, ['auto', 'cio']) && Pq5.last().content === Pq5.ctx.RevampDashBot.TEXT.nothingToUndo);
  var Pq6 = await page({ page: 'mailer-performance', noListing: true, search: '', answers: [switchAnswer('TurnPortalE008', 'auto', 'ETAuto')], portals: portalsStub('cio'), quiet: true });
  await Pq6.say('switch to ETAuto');
  Pq6.ctx.RevampPortals = undefined;
  var u7 = await Pq6.ctx.RevampDashBot.brain.undoLocal();
  check('D.2u a portal that cannot be switched back from this page: said plainly, the change stays undoable', u7 && u7.ok === false &&
    Pq6.last().content === 'The portal could not be switched from this page. Use the portal switcher on the events dashboard.' && Pq6.ctx.RevampDashBot.brain.changedAt() > 0, [u7, Pq6.last().content]);
  var ports3 = portalsStub('cio', true);
  var Pp3 = await mpPage({ portals: ports3, answers: [switchAnswer('TurnPortalE005', 'auto', 'ETAuto')] });
  await Pp3.say('switch to ETAuto'); await flush();
  check('D.2 the account could not be told: the card says the choice is kept in this browser', Pp3.last().notes.some(function (n) { return /kept in this browser only/.test(n); }), Pp3.last().notes);
  var Pp4 = await page({ page: 'mailer-performance', noListing: true, search: '', answers: [switchAnswer('TurnPortalE006', 'auto', 'ETAuto')], quiet: true });
  await Pp4.say('switch to ETAuto');
  check('D.2 no portal picker on the page (and none loaded yet): said, reported failed, no Undo', /The portal could not be switched from this page/.test(Pp4.last().notes[0] || '') &&
    Pp4.turnCalls()[0].status === 'failed' && !Pp4.last().buttons.some(function (x) { return x.undo; }), Pp4.last().notes);
  check('D.2 …and the shell has asked for /portal-picker.js on a page without it', Pp4.scripts.indexOf('/portal-picker.js') !== -1, Pp4.scripts);
  var Pmp = await mpPage({ answers: [createAnswer('TurnMP000005')] });
  await Pmp.say('Create an IP event called Retail Leadership Summit on 12 Feb 2027 at Jio World Centre, Mumbai');
  Pmp.clock.tick(1200);
  check('D.2 create on a page with no event: the prefill is kept and Create Event opens', !!Pmp.local.getItem('revamp.createEvent.prefill.v1.TurnMP000005') && same(Pmp.assigned, ['/create-event.html?new=1&prefill=TurnMP000005']));

  /* ======== Stop (UX-097): the late answer is neither drawn nor done, and its turn says stopped ======== */
  var release = null;
  var Pst2 = await page({ answer: function (call) {
    if (call.url !== '/api/dash-bot') return null;
    return { hold: new Promise(function (r) { release = r; }) };
  } });
  var stopping = Pst2.say('Take me to the Autotech editor');
  var bo = Pst2.kit.chat.busyOpts;
  check('D.3 the busy strip is given a Stop', !!bo && typeof bo.onStop === 'function');
  bo.onStop();
  var stopR = await stopping;
  check('D.3 Stop: the message is settled at once ({kind: "stopped"}) and the box is free', stopR && stopR.kind === 'stopped' && same(Pst2.kit.chat.busy[Pst2.kit.chat.busy.length - 1], [false, undefined]));
  release(navAnswer(T4, URL1));
  await flush(); await flush();
  Pst2.clock.tick(5000); await flush();
  check('D.3 …the answer that comes later draws nothing and opens nothing', Pst2.kit.chat.bubbles.length === 0 && Pst2.assigned.length === 0);
  check('D.3 …and its turn is reported stopped', same(Pst2.turnCalls(), [{ turnId: T4, status: 'stopped' }]), Pst2.turnCalls());
  var rel2 = null;
  var Pst3 = await page({ answer: function (call) { return call.url === '/api/dash-bot' ? { hold: new Promise(function (r) { rel2 = r; }) } : null; } });
  var s3 = Pst3.say('Show drafts');
  Pst3.ctx.RevampAssistant.stop();
  await s3;
  rel2(filterAnswer(T1)); await flush(); await flush();
  check('D.3 the shell\'s stop() reaches the brain answering: no filter runs', Pst3.listing.applied.length === 0 && same(Pst3.turnCalls(), [{ turnId: T1, status: 'stopped' }]), Pst3.turnCalls());
  var Pst4 = await page({ answers: [filterAnswer(T1)] });
  await Pst4.say('drafts');
  Pst4.kit.chat.busyOpts && Pst4.kit.chat.busyOpts.onStop();
  check('D.3 Stop after the answer has come does nothing', Pst4.listing.applied.length === 1 && Pst4.turnCalls().length === 0);

  /* ======== handoff (plan §5b): one hop, never back ======== */
  var Ph1 = await page({ answers: [ok({ kind: 'handoff', parts: [], list: null, action: null, choices: null, asOf: 'x', notes: [] }),
    ok({ kind: 'handoff', parts: [], list: null, action: null, choices: null, asOf: 'x', notes: [] })] });
  var hr1 = await Ph1.ctx.RevampDashBot.brain.send('make the hero darker', {});
  check('D.4 a "handoff" answer: nothing drawn, the shell is told to pass it on', hr1 && hr1.handoff === true && Ph1.kit.chat.bubbles.length === 0, hr1);
  var hr2 = await Ph1.ctx.RevampDashBot.brain.send('tell me about QA Draft', { handedFrom: 'edit' });
  var hb = Ph1.botCalls()[1];
  check('D.4 handed from the editor: the request says so, and the busy line says what is happening', hb && hb.body.handedFrom === 'edit' && Ph1.kit.chat.busy.some(function (b) { return b[0] === true && b[1] === 'Checking your events…'; }), hb && hb.body);
  check('D.4 …a second "handoff" is never passed back: one plain sentence, once', hr2 && hr2.kind === 'reply' && Ph1.kit.chat.bubbles.length === 1 &&
    Ph1.last().content === 'I couldn’t tell whether that is about this page. Name the part of the page, for example “the hero”.', [hr2, Ph1.kit.chat.bubbles.length]);
  var hr3 = await (await page({ answers: [hello('TurnHello00099')] })).ctx.RevampDashBot.brain.send('hello', { handedFrom: 'nonsense' });
  check('D.4 a handedFrom that is not "edit" is not sent', hr3 && hr3.kind === 'reply');

  /* ======== attachments (plan §6b): what the server is sent for the chips ======== */
  var THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';
  var RECS = [{ id: 'att1', name: 'small.png', kind: 'image', thumb: THUMB, size: 2000, type: 'image/png', wire: 'image', w: 571, h: 340 },
    { id: 'att2', name: 'brief.pdf', kind: 'doc', size: 40000, type: 'application/pdf', wire: 'pdf' },
    { id: 'att3', name: 'notes.txt', kind: 'doc', size: 600, type: 'text/plain', wire: 'text', text: 'A one-day forum.' }];
  var Pa = await page({ answers: [hello('TurnAttach0001')] });
  await Pa.say('what are these?', { attachments: RECS });
  var ab = Pa.botCalls()[0].body;
  check('D.5 attachments: numbered, a picture as its thumbnail and size, a PDF by name and size, a text file\'s words', same(ab.attachments, [
    { n: 1, kind: 'image', name: 'small.png', type: 'image/png', size: 2000, w: 571, h: 340, thumb: THUMB },
    { n: 2, kind: 'pdf', name: 'brief.pdf', type: 'application/pdf', size: 40000 },
    { n: 3, kind: 'text', name: 'notes.txt', type: 'text/plain', size: 600, text: 'A one-day forum.' }]), ab.attachments);
  var Pa0 = await page({ answers: [hello('TurnAttach0002')] });
  await Pa0.say('hello');
  check('D.5 no chips: no attachments key', !('attachments' in Pa0.botCalls()[0].body));

  /* the logo and the brief go to Create Event's own boxes (kept by the shell), named on the card */
  function createWithFiles(id, files, prefill) { return createAnswer(id, [], { files: files, prefill: prefill || PREFILL }); }
  var handed = [], handRelease = null;
  var Pf = await page({ answers: [createWithFiles('TurnFiles00001', [{ n: 1, role: 'logo' }, { n: 2, role: 'brief' }, { n: 3, role: 'none' }])] });
  Pf.ctx.RevampAssistant.handoffFiles = function (pid, items) { handed.push([pid, items.map(function (i) { return i.n + ':' + i.role + ':' + i.rec.name; })]); return new Promise(function (r) { handRelease = r; }); };
  await Pf.say('Start a new IP event called Retail Leadership Summit with this logo and brief', { attachments: [RECS[0], RECS[1], { id: 'att9', name: 'photo.jpg', kind: 'image', size: 10, type: 'image/jpeg', wire: 'image' }] });
  var fr = JSON.parse(Pf.local.getItem('revamp.createEvent.prefill.v1.TurnFiles00001') || 'null');
  check('D.5 create with files: the prefill names the logo and the brief file (name, type, size)', fr && same(fr.files, [{ n: 1, role: 'logo', name: 'small.png', type: 'image/png', size: 2000 }, { n: 2, role: 'brief', name: 'brief.pdf', type: 'application/pdf', size: 40000 }]), fr && fr.files);
  check('D.5 …the files themselves go to the shell, for Create Event', same(handed, [['TurnFiles00001', ['1:logo:small.png', '2:brief:brief.pdf']]]), handed);
  var bf = Pf.last();
  check('D.5 …the card says where each goes, and that nothing is made yet', bf.notes.indexOf('Your logo “small.png” and your brief “brief.pdf” go into Create Event’s own logo box and Overview document. Nothing is generated or created until you say so there.') !== -1, bf.notes);
  check('D.5 …and the countdown says what goes in', /· your logo · your brief document…$/.test(bf.countdowns[0].label), bf.countdowns[0].label);
  Pf.clock.tick(1200);
  check('D.5 …the page waits for the files to be kept', Pf.assigned.length === 0);
  handRelease(true); await flush();
  check('D.5 …then opens', same(Pf.assigned, ['/create-event.html?new=1&prefill=TurnFiles00001']));
  var Pf2 = await page({ answers: [createWithFiles('TurnFiles00002', [{ n: 1, role: 'logo' }])] });
  var handed2 = [];
  Pf2.ctx.RevampAssistant.handoffFiles = function (pid, items) { handed2.push(items.length); return Promise.resolve(true); };
  await Pf2.say('start a new event called X with this logo', { attachments: [{ id: 'att8', name: 'photo.jpg', kind: 'image', size: 10, type: 'image/jpeg', wire: 'image' }] });
  check('D.5 a JPEG "logo": not carried (Create Event takes PNG, WEBP or SVG), and the card says why', handed2.length === 0 && !JSON.parse(Pf2.local.getItem('revamp.createEvent.prefill.v1.TurnFiles00002')).files &&
    Pf2.last().notes.indexOf('Create Event takes a PNG, WEBP or SVG logo of up to 5 MB, so “photo.jpg” wasn’t carried: upload the logo there.') !== -1, Pf2.last().notes);
  Pf2.clock.tick(1200);
  check('D.5 …and the page opens at once (nothing to wait for)', Pf2.assigned.length === 1);
  var Pf3 = await page({ answers: [createWithFiles('TurnFiles00003', [{ n: 1, role: 'brief' }], (function () { var x = JSON.parse(JSON.stringify(PREFILL)); x.method = 'brief'; x.brief.text = 'A one-day forum.'; return x; })())] });
  await Pf3.say('start a new event from this brief', { attachments: [RECS[2]] });
  check('D.5 a text brief: its words are the prefill\'s brief (the server put them there), nothing to carry', !JSON.parse(Pf3.local.getItem('revamp.createEvent.prefill.v1.TurnFiles00003')).files &&
    Pf3.last().notes.indexOf('The words of “notes.txt” are your brief there.') !== -1, Pf3.last().notes);
  var Pf4 = await page({ answers: [createWithFiles('TurnFiles00004', [{ n: 7, role: 'logo' }, { n: 'x', role: 'brief' }])] });
  await Pf4.say('start', { attachments: [RECS[0]] });
  check('D.5 a role for a file that was not sent is ignored', !JSON.parse(Pf4.local.getItem('revamp.createEvent.prefill.v1.TurnFiles00004')).files);

  /* pictures inside an event go on to its site editor (plan §6c) */
  var carried = [], carryRelease = null;
  var editorNav = { status: 200, body: { turnId: 'TurnCarry00001', kind: 'open', parts: [{ t: 'text', v: 'Opening the site editor.' }], list: null,
    action: { type: 'navigate', url: '/edit-event.html?event=qa-main#design/editor', label: 'the QA Main site editor', target: 'editor', eventId: 'qa-main', carry: true }, choices: null, asOf: 'x', notes: ['carry'] } };
  var Pc1 = await conPage({ answers: [editorNav] });
  Pc1.ctx.RevampAssistant.carry = function (ev, recs, text) { carried.push([ev, recs.map(function (r) { return r.name; }), text]); return new Promise(function (r) { carryRelease = r; }); };
  await Pc1.say('use this as the hero background on the site', { attachments: [RECS[0]] });
  check('D.5 carry: the pictures and the words go to the shell for that event\'s editor', same(carried, [['qa-main', ['small.png'], 'use this as the hero background on the site']]), carried);
  check('D.5 …the card says they wait, unsent', Pc1.last().notes.indexOf('Your picture goes with you to the site editor, waiting in ETB2B AI’s tray with your words, unsent.') !== -1, Pc1.last().notes);
  Pc1.clock.tick(1200);
  check('D.5 …the editor opens once they are kept', Pc1.assigned.length === 0);
  carryRelease(true); await flush();
  check('D.5 …then', same(Pc1.assigned, ['/edit-event.html?event=qa-main#design/editor']));
  var Pc2 = await conPage({ answers: [editorNav] });
  var carried2 = [];
  Pc2.ctx.RevampAssistant.carry = function () { carried2.push(1); return Promise.resolve(true); };
  await Pc2.say('open the editor');
  Pc2.clock.tick(1200);
  check('D.5 carry with no pictures attached: nothing carried, the editor opens', carried2.length === 0 && Pc2.assigned.length === 1);

  /* ======== an event's own conversation (plan §4d): both brains' turns, through the shell ======== */
  var EH = { event: { id: 'qa-main', name: 'QA AIE Main' }, turns: [
    { id: 'TurnEdit000001', question: 'Make the hero darker', answer: 'Done.', kind: 'edit', status: 'applied', done: ['Hero: background made darker'], notDone: [], at: '2026-11-05T05:00:00Z' },
    { id: 'TurnDashE00001', brain: 'dash', question: 'How many registrations here?', answer: '42 registrations.', parts: [{ t: 'value', v: '42', metric: 'registrations' }, { t: 'text', v: ' registrations.' }], kind: 'reply', status: 'answered', action: null, asOf: '2026-11-05T05:01:00Z', at: '2026-11-05T05:01:00Z' },
    { id: 'TurnDashE00002', brain: 'dash', question: 'Open its promotions', answer: 'Opening.', parts: [], kind: 'reply', status: 'stopped', action: { type: 'navigate', label: 'Promotions', url: '/marketing.html?event=qa-main&tab=posts' }, at: '2026-11-05T05:02:00Z' },
    { id: 'TurnEdit000002', question: 'Use a navy background', answer: 'Not done.', kind: 'edit', status: 'failed', done: [], notDone: ['“navy” isn’t a colour this page can use'], at: '2026-11-05T05:03:00Z' }
  ] };
  var Peh = await conPage({ eventHistory: EH });
  var n2 = await Peh.kit.chat.opts.loadHistory();
  var ech = Peh.kit.chat;
  check('D.6 in an event: GET /api/chat/history?eventId=qa-main (not the dashboard\'s)', Peh.calls.some(function (c) { return c.url === '/api/chat/history?eventId=qa-main' && c.method === 'GET'; }) &&
    !Peh.calls.some(function (c) { return c.url === '/api/dash-bot/history'; }), Peh.calls.map(function (c) { return c.url; }));
  check('D.6 …the header names the event it works on only', same(ech.scopes, ['This event only: QA AIE Main']), ech.scopes);
  check('D.6 …"Earlier in this conversation", the four turns in order, then "Now"', n2 === 4 && same(ech.dividers, ['Earlier in this conversation', 'Now']) && ech.users.length === 4 &&
    same(ech.users.map(function (u) { return u.text; }), EH.turns.map(function (t) { return t.question; })), [n2, ech.dividers]);
  check('D.6 …an editor change shown plainly here, with its done lines and no Undo', ech.bubbles[0].content === 'Done.' && ech.bubbles[0].notes.indexOf('Done: Hero: background made darker') !== -1 &&
    ech.bubbles[0].notes.indexOf('Done in the site editor.') !== -1 && ech.bubbles[0].buttons.length === 0, ech.bubbles[0].notes);
  check('D.6 …a dash turn with its figures and "as of"', same(ech.bubbles[1].content, EH.turns[1].parts) && ech.bubbles[1].o.asOf === '2026-11-05T05:01:00Z');
  check('D.6 …a stopped turn says so, with no link', ech.bubbles[2].notes[0] === 'Stopped — nothing was done.' && ech.bubbles[2].links.length === 0, ech.bubbles[2].notes);
  check('D.6 …an editor change that failed says what was not done', ech.bubbles[3].notes.indexOf('Not done: “navy” isn’t a colour this page can use') !== -1 && ech.bubbles[3].notes.indexOf('This change could not be applied.') !== -1, ech.bubbles[3].notes);
  var Pgh = await page({ history: { turns: [] } });
  await Pgh.kit.chat.opts.loadHistory();
  check('D.6 on the dashboard the person\'s own conversation, as before', Pgh.calls.some(function (c) { return c.url === '/api/dash-bot/history'; }) && !Pgh.calls.some(function (c) { return /chat\/history/.test(c.url); }) &&
    Pgh.kit.mounts[0].opts.scope === 'Your events');
  var Pcrh = await page({ page: 'create-event', noListing: true, path: '/create-event.html', search: '?event=qa-main', history: { turns: [] } });
  await Pcrh.kit.chat.opts.loadHistory();
  check('D.6 Create Event is never about one event, whatever its address says: the dashboard conversation', Pcrh.calls.some(function (c) { return c.url === '/api/dash-bot/history'; }) &&
    Pcrh.kit.mounts[0].opts.scope === 'Your events' && Pcrh.kit.mounts[0].opts.attach.max === 4 && /application\/pdf/.test(Pcrh.kit.mounts[0].opts.attach.accept));
  var Pehx = await conPage({ answer: function (call) { return /chat\/history/.test(call.url) ? { status: 404, body: { error: 'x' } } : null; } });
  var ehx = await rejection(Pehx.kit.chat.opts.loadHistory());
  check('D.6 an event\'s history that cannot be read rejects (the kit says so)', ehx && /could not be loaded/.test(ehx.message));
  var Ppromo = await page({ page: 'promotions', noListing: true, path: '/marketing.html', search: '?event=qa-main&tab=mailers', answers: [hello('TurnPromo00001')], portals: portalsStub() });
  await Ppromo.say('hi');
  check('D.6 Promotions: its tab is the place\'s', same(Ppromo.botCalls()[0].body.place, { page: 'promotions', eventId: 'qa-main', tab: 'mailers' }), Ppromo.botCalls()[0].body.place);

  /* ======== the real kit, when Unit C's etb2b-chat.js is there ======== */
  var KIT = path.join(ROOT, 'etb2b-chat.js');
  if (fs.existsSync(KIT)) {
    var real = await realKitPass(fs.readFileSync(KIT, 'utf8'));
    real.forEach(function (r) { check('D.1 real kit: ' + r[0], r[1], r[2]); });
    check('D.1 real kit: the pass ran all its checks', real.length >= 19, real.map(function (r) { return r[0]; }));
  } else {
    console.log('dash-bot-client: etb2b-chat.js is not there yet, so the real-kit pass was skipped');
  }

  /* ======== kind "records": speakers and sponsors added to this event (the owner, 10 Nov 2026) ======== */
  function fakeCore(groups, items, opt) {
    opt = opt || {};
    var C = { groups: groups.slice(), items: items.slice(), created: [], deleted: [], n: 0, AV: ['#335577'] };
    function listOf(res) { return res === 'speaker-groups' || res === 'partner-tiers' ? C.groups : C.items; }
    C.fetchSub = function (res) { return Promise.resolve(listOf(res).map(function (x) { return JSON.parse(JSON.stringify(x)); })); };
    C.createSub = function (res, ev, data) {
      if (opt.failAt && C.created.length + 1 === opt.failAt) return Promise.reject(Object.assign(new Error(opt.msg || 'refused'), { status: 403 }));
      var id = 'new' + (++C.n);
      C.created.push({ res: res, ev: ev, data: data, id: id });
      listOf(res).push(Object.assign({ id: id }, data));
      return Promise.resolve({ id: id });
    };
    C.deleteSub = function (res, ev, id) {
      C.deleted.push({ res: res, ev: ev, id: id });
      var list = listOf(res);
      for (var i = 0; i < list.length; i++) if (list[i].id === id) { list.splice(i, 1); break; }
      return Promise.resolve({ ok: true });
    };
    return C;
  }
  function recordsAnswer(id, eventId, groups, extra) {
    var ev = eventId || 'qa-main';
    var action = { type: 'records', what: 'speakers', eventId: ev, count: 4, fromDocument: true, label: 'Add speakers', href: '/edit-event.html?event=' + ev + '#content/speakers',
      groups: groups || [{ name: 'Influential Speakers', entries: [{ name: 'Naven Singh', role: 'CISO', company: 'Acme Bank' }, { name: 'Bruce Schneier', role: '', company: '' }] },
        { name: 'Guest Speakers', entries: [{ name: 'Robin Uthappa', role: '', company: '' }, { name: 'Jaya Kishori', role: '', company: '' }] }] };
    Object.keys(extra || {}).forEach(function (k) { action[k] = extra[k]; });
    return ok({ turnId: id, kind: 'records', parts: [{ t: 'text', v: 'The brochure also mentions industry leaders, but does not name them.' }], list: null,
      action: action, choices: null, asOf: '2026-11-10T11:45:00.000Z', notes: [], scope: 'event', eventId: ev });
  }
  async function settle(n) { for (var si = 0; si < (n || 12); si++) await flush(); }
  function withCore(P, C) {
    P.ctx.RevampCore = C;
    P.events = [];
    P.ctx.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
    P.ctx.document.dispatchEvent = function (e) { P.events.push({ type: e.type, detail: e.detail }); return true; };
    return P;
  }
  var CONSOLE_SRC = fs.readFileSync(path.join(ROOT, 'edit-event.html'), 'utf8');
  check('R.0 the console draws its tab again when ETB2B AI adds or takes back records (only its own event, once nothing can be lost)',
    /document\.addEventListener\('rv:records-changed', function\(e\)\{[\s\S]{0,200}d\.eventId !== EV\.id[\s\S]{0,80}reloadSub\(d\.tab\);/.test(CONSOLE_SRC));
  var Prc = withCore(await conPage({ answers: [recordsAnswer('TurnRecords001')] }),
    fakeCore([{ id: 'g1', name: 'Influential Speakers', order: 1 }], [{ id: 's0', name: 'Bruce  Schneier', groupId: 'g1', order: 1 }]));
  await Prc.say('extract speakers from this pdf and add to this event.');
  await settle();
  var RC = Prc.ctx.RevampCore, rb = Prc.last();
  check('R.1 a heading the event has is used; a new one is made once, after the event\'s own',
    same(RC.created.filter(function (c) { return c.res === 'speaker-groups'; }).map(function (c) { return [c.data.name, c.data.order]; }), [['Guest Speakers', 2]]), RC.created);
  var made = RC.created.filter(function (c) { return c.res === 'speakers'; });
  check('R.1 the speakers are added in the source\'s order, under their headings, as the console makes them',
    same(made.map(function (c) { return [c.data.name, c.data.groupId, c.data.desig, c.data.comp, c.data.status, c.data.weight]; }),
      [['Naven Singh', 'g1', 'CISO', 'Acme Bank', 'confirmed', 'featured'], ['Robin Uthappa', 'new2', '', '', 'confirmed', 'featured'], ['Jaya Kishori', 'new2', '', '', 'confirmed', 'featured']]) &&
    made.every(function (c) { return c.ev === 'qa-main' && c.data.colour === '#335577' && typeof c.data.order === 'number'; }), made.map(function (c) { return c.data; }));
  check('R.1 someone already on the event is not added again, and said', !made.some(function (c) { return /Bruce/.test(c.data.name); }) &&
    rb.notes.indexOf('Already on this event, so not added again: Bruce Schneier.') !== -1, rb.notes);
  check('R.1 the card says who went where, that a document\'s names need a check, and that photos are added by hand',
    rb.notes.indexOf('Added 3 speakers: Influential Speakers — Naven Singh; Guest Speakers — Robin Uthappa, Jaya Kishori.') !== -1 &&
    rb.notes.indexOf(Prc.ctx.RevampDashBot.TEXT.recordsCheck) !== -1 && rb.notes.indexOf(Prc.ctx.RevampDashBot.TEXT.recordsNoPhotos) !== -1, rb.notes);
  check('R.1 …with Open Speakers and Undo', rb.links.some(function (l) { return l.href === '/edit-event.html?event=qa-main#content/speakers' && l.label === 'Open Speakers'; }) &&
    rb.buttons.some(function (bt) { return bt.undo; }), rb.links.map(function (l) { return l.href; }));
  check('R.1 the console\'s Speakers tab is drawn again', same(Prc.events, [{ type: 'rv:records-changed', detail: { eventId: 'qa-main', tab: 'speakers' } }]), Prc.events);
  var rt = Prc.turnCalls().filter(function (t) { return t.turnId === 'TurnRecords001'; });
  check('R.1 the turn is reported done, with what was added', rt.length === 1 && rt[0].status === 'done' && rt[0].note === 'added 3 speakers; 1 already there' && rt[0].eventId === 'qa-main', rt);
  var held = JSON.parse(Prc.session.getItem('rv.dashBot.undo.TurnRecords001') || 'null');
  check('R.1 what was added is kept for Undo after a reload', held && held.kind === 'records' && same(held.snap.items, ['new1', 'new3', 'new4']) && same(held.snap.groups, ['new2']), held);
  rb.buttons.filter(function (bt) { return bt.undo; })[0].click();
  await settle();
  check('R.2 Undo takes off exactly what was added, then the heading it made, now empty', same(RC.deleted.map(function (d) { return d.res + ':' + d.id; }), ['speakers:new1', 'speakers:new3', 'speakers:new4', 'speaker-groups:new2']) &&
    RC.items.length === 1 && RC.items[0].id === 's0' && RC.groups.length === 1, RC.deleted);
  check('R.2 …reported undone, the tab drawn again, and the Undo spent', Prc.turnCalls().some(function (t) { return t.turnId === 'TurnRecords001' && t.status === 'undone'; }) &&
    Prc.events.length === 2 && rb.buttons.filter(function (bt) { return bt.undo; })[0].disabled === true && !Prc.session.getItem('rv.dashBot.undo.TurnRecords001'));

  var Prf = withCore(await conPage({ answers: [recordsAnswer('TurnRecords002')] }), fakeCore([], [], { failAt: 3, msg: 'You have view-only access (Viewer), so this can\'t be changed from your account.' }));
  await Prf.say('add the speakers from this brochure');
  await settle();
  var rf = Prf.last(), RF = Prf.ctx.RevampCore;
  check('R.3 an event with no heading yet gets the source\'s; a refusal on the way stops the rest, said in the server\'s words',
    same(RF.created.map(function (c) { return c.res + ':' + c.data.name; }), ['speaker-groups:Influential Speakers', 'speakers:Naven Singh']) &&
    rf.notes.indexOf('Added 1 speaker: Influential Speakers — Naven Singh.') !== -1 && rf.notes.some(function (n) { return /^The rest could not be added: You have view-only access/.test(n); }), rf.notes);
  check('R.3 …what was added can still be undone, and the turn says it was partly done', rf.buttons.some(function (bt) { return bt.undo; }) &&
    Prf.turnCalls().some(function (t) { return t.turnId === 'TurnRecords002' && t.status === 'done' && /^added 1 speaker; the rest failed: You have view-only/.test(t.note); }), Prf.turnCalls());

  var Pro = withCore(await conPage({ answers: [recordsAnswer('TurnRecords003', 'other-event')] }), fakeCore([], []));
  await Pro.say('add the speakers');
  await settle();
  check('R.4 records for another event than this page\'s: nothing is added, said plainly', Pro.ctx.RevampCore.created.length === 0 && Pro.last().content === Pro.ctx.RevampDashBot.TEXT.otherEvent, Pro.last().content);

  var Prn = await conPage({ answers: [recordsAnswer('TurnRecords004')] });
  await Prn.say('add the speakers');
  await settle();
  check('R.5 a page without the console\'s record routes: nothing is done, and it says where to ask', Prn.last().notes.some(function (n) { return n.indexOf(Prn.ctx.RevampDashBot.TEXT.recordsMissing) !== -1; }) &&
    Prn.turnCalls().some(function (t) { return t.turnId === 'TurnRecords004' && t.status === 'failed'; }), Prn.last().notes);

  var Prh = withCore(await conPage({ eventHistory: { event: { id: 'qa-main', name: 'QA Main' }, turns: [
    { id: 'TurnRecords005', brain: 'dash', question: 'add the speakers from the brochure', answer: 'x', parts: [{ t: 'text', v: 'Adding them to this event\'s Speakers.' }], status: 'done', note: 'added 3 speakers',
      dashKind: 'records', kind: 'reply', action: { type: 'records', label: 'Add speakers', url: '/edit-event.html?event=qa-main#content/speakers', what: 'speakers' }, at: '2026-11-10T11:45:00.000Z' }] },
    session: (function () { var st = makeStorage(); st.setItem('rv.dashBot.undo.TurnRecords005', JSON.stringify({ at: 5, kind: 'records', label: 'added 3 speakers', snap: { eventId: 'qa-main', what: 'speakers', items: ['a', 'b'], groups: [] } })); return st; })() }), fakeCore([], []));
  await Prh.kit.chat.opts.loadHistory();
  await settle();
  var hb = (Prh.chat() ? Prh.chat().bubbles : []).filter(function (b) { return b.notes.indexOf('Added 3 speakers.') !== -1; })[0];
  check('R.6 the history says what was added, with Undo where this tab still holds it, and Open Speakers', !!hb && hb.buttons.some(function (bt) { return bt.undo; }) &&
    hb.links.some(function (l) { return l.label === 'Open Speakers'; }), Prh.chat() && Prh.chat().bubbles.map(function (b) { return b.notes; }));

  if (failed) { console.error('dash-bot-client: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('dash-bot-client: all ' + passed + ' checks passed');
})().catch(function (e) { console.error('FAIL the test itself threw: ' + (e && e.stack)); process.exit(1); });

/* ================= the real kit on a small DOM =================
   The main turns once more through etb2b-chat.js itself: it mounts, sends, folds after a filter, Undo puts the list
   back, a navigation waits 1.2 s and Stay here cancels it. The checks look for what a person sees (button words,
   link targets), not for the kit's own markup, which is Unit C's to choose. */
async function realKitPass(KIT_SRC) {
  var out = [];
  function res(name, okv, detail) { out.push([name, !!okv, detail]); }
  var dom = miniDom();
  var clock = makeClock();
  var listing = makeListing();
  var EDITOR = '/edit-event.html?event=autotech-2026#design/editor', PROMO = '/marketing.html?event=autotech-2026&tab=posts';
  var calls = [], assigned = [], answers = [filterAnswer(T1), navAnswer(T4, EDITOR), navAnswer('TurnOpen000005', PROMO, 'Promotions of Autotech 2026'),
    { status: 429, body: { code: 'dash-bot-daily', error: 'You have used today’s ETB2B AI allowance. It resets at midnight (India time).' } },
    ok({ turnId: 'TurnSwitch0009', kind: 'portal', parts: [{ t: 'text', v: 'Switching the dashboard to the portal you asked for.' }], list: null,
      action: { type: 'portal', portal: 'hr', label: 'ETHRWorld' }, choices: null, asOf: '2026-11-03T06:35:00.000Z', notes: [] })];
  listing.setPortal = function () { var before = listing.snapshot(); before.mark = ++listing.n; return before; };
  var host = dom.document.createElement('div'); host.id = 'rv-dash-bot'; host.setAttribute('data-rv-assistant', 'dashboard'); dom.document.body.appendChild(host);
  var ctx = {
    document: dom.document, console: console, JSON: JSON, Promise: Promise, Date: Date, navigator: { onLine: true },
    location: { href: 'http://localhost/Event_Listing.html', pathname: '/Event_Listing.html', search: '', hash: '', assign: function (u) { assigned.push(u); } },
    sessionStorage: makeStorage(), localStorage: makeStorage(),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent, Math: Math,
    requestAnimationFrame: function (fn) { return clock.setTimeout(fn, 16); }, cancelAnimationFrame: clock.clearTimeout,
    matchMedia: function () { return { matches: false, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} }; },
    getComputedStyle: function () { return { getPropertyValue: function () { return ''; } }; },
    addEventListener: function () {}, removeEventListener: function () {}, innerWidth: 1280, innerHeight: 800, confirm: function () { return true; },
    RvListing: listing,
    RevampAuth: {
      whenResolved: function () { return Promise.resolve(); },
      currentUser: function () { return { displayName: 'Asha Rao', email: 'asha.rao@timesinternet.in' }; },
      authedFetch: function (url, o) {
        var body = o && o.body ? JSON.parse(o.body) : undefined;
        calls.push({ url: url, body: body });
        if (url === '/api/dash-bot') { var a = answers.shift(); return Promise.resolve(response(a.status, a.body)); }
        if (url === '/api/dash-bot/history') return Promise.resolve(response(200, { turns: [] }));
        return Promise.resolve(response(200, {}));
      }
    }
  };
  ctx.window = ctx; ctx.self = ctx; ctx.top = ctx;
  dom.document.defaultView = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(KIT_SRC, ctx, { filename: 'etb2b-chat.js' }); } catch (e) { res('loads on the small DOM', false, String(e && e.message)); return out; }
  try { vm.runInContext(SRC, ctx, { filename: 'dash-bot-client.js' }); } catch (e) { res('the client runs beside it', false, String(e && e.message)); return out; }
  try { vm.runInContext(SHELL_SRC, ctx, { filename: 'etb2b-assistant.js' }); } catch (e) { res('the shell runs beside them', false, String(e && e.message)); return out; }
  await flush();
  var launcher = dom.document.getElementById('dash-chat-launcher');
  res('mounted: the launcher and html.rvc-ready', !!launcher && dom.document.documentElement.classList.contains('rvc-ready'));
  if (!launcher) return out;
  var input = dom.document.getElementById('dash-chat-input');
  try { launcher.click(); } catch (e) { res('the launcher opens', false, String(e && e.message)); return out; }
  await flush();
  res('the launcher opens the panel', launcher.getAttribute('aria-expanded') === 'true');
  function sendText(text) {
    input.value = text;
    var ev = dom.event('keydown', { key: 'Enter' });
    input.dispatchEvent(ev);
  }
  sendText('Show drafts from last week');
  await flush(); await flush();
  res('a message goes to /api/dash-bot', calls.some(function (c) { return c.url === '/api/dash-bot' && c.body && c.body.message === 'Show drafts from last week'; }), calls.map(function (c) { return c.url; }));
  res('the person\'s own bubble is drawn once (by the kit)', dom.findAll(function (el) { return /\brvc-user\b/.test(el.className) && el.textContent.indexOf('Show drafts from last week') !== -1; }).length === 1);
  res('the filter ran', listing.applied.length === 1);
  var peek = dom.document.getElementById('dash-chat-peek');
  res('the panel folded to its peek, which says what is shown', !!peek && peek.hidden === false && /Showing Draft events · created 26 Oct – 1 Nov 2026/.test(peek.textContent) && launcher.getAttribute('aria-expanded') === 'false',
    peek && peek.textContent);
  var undos = dom.findAll(function (el) { return el.tagName === 'BUTTON' && /^\s*Undo\s*$/.test(el.textContent); });
  res('Undo on the card and on the peek', undos.length === 2, undos.length);
  if (undos.length) { undos[undos.length - 1].click(); await flush(); }
  res('Undo puts the list back', listing.restored.length === 1 && listing.restored[0].mark === 1);
  res('…and the card\'s and the peek\'s Undo both say Undone', undos.length === 2 && undos.every(function (b) { return /Undone/.test(b.textContent); }), undos.map(function (b) { return b.textContent; }));
  var back = dom.findAll(function (el) { return el.tagName === 'BUTTON' && /Back to chat/.test(el.textContent); })[0];
  if (back) back.click();
  res('Back to chat reopens the panel', launcher.getAttribute('aria-expanded') === 'true' && peek.hidden === true);
  sendText('Take me to the Autotech editor');
  await flush(); await flush();
  var link = dom.findAll(function (el) { return el.tagName === 'A' && el.getAttribute('href') === EDITOR; });
  res('the page is a real link in the card', link.length === 1);
  var stay = dom.findAll(function (el) { return el.tagName === 'BUTTON' && /Stay here/.test(el.textContent); });
  res('Stay here is offered', stay.length === 1);
  if (stay.length) stay[0].click();
  clock.tick(5000);
  await flush();
  res('Stay here keeps the page, and is reported', assigned.length === 0 && calls.some(function (c) { return c.url === '/api/dash-bot/turn' && c.body.status === 'undone' && c.body.note === 'stayed'; }), assigned);
  sendText('Open the Promotions of Autotech 2026');
  await flush(); await flush();
  clock.tick(1199);
  res('nothing opens before 1.2 s', assigned.length === 0);
  clock.tick(1);
  res('…then the page opens', assigned.length === 1 && assigned[0] === PROMO, assigned);
  sendText('one more');
  await flush(); await flush();
  var errs = dom.findAll(function (el) { return /\brvc-error\b/.test(el.className); });
  var err = errs[errs.length - 1];
  res('the day\'s allowance: its sentence in an error bubble', !!err && err.textContent.indexOf('You have used today’s ETB2B AI allowance.') !== -1);
  res('…with no Try again (it cannot help today)', !!err && !/Try again/.test(err.textContent));
  res('…and the text is back in the box', input.value === 'one more');
  var help = dom.findAll(function (el) { return el.tagName === 'BUTTON' && /Email Customer Care/.test(el.textContent); })[0];
  if (help) help.click();
  res('Email Customer Care opens the page\'s help window, from its own button', !!help && listing.help.length === 1 && listing.help[0] === help);
  /* QA follow-up 2 F5: the peek after a portal switch said "Showing Now working in ETHRWorld" */
  if (launcher.getAttribute('aria-expanded') !== 'true') launcher.click();
  sendText('Switch to ETHRWorld');
  await flush(); await flush();
  var label = dom.findAll(function (el) { return /\brvc-peek-label\b/.test(el.className); })[0];
  clock.tick(100);      // the kit says it to screen readers a moment later (announce)
  var live = dom.document.getElementById('dash-chat-live');
  res('a portal switch: the peek reads "Now working in ETHRWorld", with no "Showing" in front', !!label && peek.hidden === false && label.textContent === 'Now working in ETHRWorld',
    label && label.textContent);
  res('…and the screen reader hears the same', !!live && live.textContent === 'Now working in ETHRWorld. Undo is in the ETB2B AI bar.', live && live.textContent);
  return out;
}

/* a small DOM: enough for a chat kit (elements, text, attributes, classes, events, focus, simple selectors) */
function miniDom() {
  var all = [];
  function Ev(type, init) {
    this.type = type; this.bubbles = true; this.defaultPrevented = false; this.propagationStopped = false;
    Object.keys(init || {}).forEach(function (k) { this[k] = init[k]; }, this);
  }
  Ev.prototype.preventDefault = function () { this.defaultPrevented = true; };
  Ev.prototype.stopPropagation = function () { this.propagationStopped = true; };
  Ev.prototype.stopImmediatePropagation = function () { this.propagationStopped = true; };
  function Node(type) { this.nodeType = type; this.childNodes = []; this.parentNode = null; this._ls = {}; }
  Node.prototype.appendChild = function (c) { if (c.nodeType === 11) { c.childNodes.slice().forEach(function (x) { this.appendChild(x); }, this); return c; } if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; };
  Node.prototype.insertBefore = function (c, ref) { if (!ref) return this.appendChild(c); if (c.parentNode) c.parentNode.removeChild(c); var i = this.childNodes.indexOf(ref); c.parentNode = this; this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c); return c; };
  Node.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i !== -1) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  Node.prototype.replaceChild = function (n, o) { this.insertBefore(n, o); this.removeChild(o); return o; };
  Node.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  Node.prototype.contains = function (n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; };
  Node.prototype.addEventListener = function (t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); };
  Node.prototype.removeEventListener = function (t, fn) { this._ls[t] = (this._ls[t] || []).filter(function (f) { return f !== fn; }); };
  Node.prototype.dispatchEvent = function (ev) {
    if (!ev.target) ev.target = this;
    var n = this;
    while (n) { ev.currentTarget = n; (n._ls[ev.type] || []).slice().forEach(function (fn) { if (typeof fn === 'function') fn.call(n, ev); else if (fn && fn.handleEvent) fn.handleEvent(ev); }); if (ev.propagationStopped || !ev.bubbles) break; n = n.parentNode || (n === doc ? null : null); }
    return !ev.defaultPrevented;
  };
  Object.defineProperty(Node.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  Object.defineProperty(Node.prototype, 'lastChild', { get: function () { return this.childNodes[this.childNodes.length - 1] || null; } });
  Object.defineProperty(Node.prototype, 'isConnected', { get: function () { var n = this; while (n.parentNode) n = n.parentNode; return n === doc; } });
  Object.defineProperty(Node.prototype, 'textContent', {
    get: function () { return this.nodeType === 3 ? this.data : this.childNodes.map(function (c) { return c.textContent; }).join(''); },
    set: function (v) { if (this.nodeType === 3) { this.data = String(v); return; } this.childNodes.slice().forEach(function (c) { c.parentNode = null; }); this.childNodes = []; if (v !== '' && v != null) this.appendChild(new Text(String(v))); }
  });
  function Text(t) { Node.call(this, 3); this.data = t; }
  Text.prototype = Object.create(Node.prototype);
  function Frag() { Node.call(this, 11); }
  Frag.prototype = Object.create(Node.prototype);
  function El(tag) { Node.call(this, 1); this.tagName = String(tag).toUpperCase(); this.localName = String(tag).toLowerCase(); this._a = {}; this.style = makeStyle(); this._html = ''; all.push(this); }
  El.prototype = Object.create(Node.prototype);
  function makeStyle() { var s = {}; s.setProperty = function (k, v) { s[k] = v; }; s.removeProperty = function (k) { delete s[k]; }; s.getPropertyValue = function (k) { return s[k] || ''; }; return s; }
  El.prototype.setAttribute = function (k, v) { this._a[String(k).toLowerCase()] = String(v); };
  El.prototype.getAttribute = function (k) { k = String(k).toLowerCase(); return Object.prototype.hasOwnProperty.call(this._a, k) ? this._a[k] : null; };
  El.prototype.removeAttribute = function (k) { delete this._a[String(k).toLowerCase()]; };
  El.prototype.hasAttribute = function (k) { return this.getAttribute(k) !== null; };
  El.prototype.toggleAttribute = function (k, on) { if (on === undefined) on = !this.hasAttribute(k); if (on) this.setAttribute(k, ''); else this.removeAttribute(k); return on; };
  ['id', 'type', 'href', 'title', 'placeholder', 'role', 'name', 'rel', 'target', 'tabIndex'].forEach(function (p) {
    Object.defineProperty(El.prototype, p, { get: function () { var v = this.getAttribute(p); return v == null ? '' : v; }, set: function (v) { this.setAttribute(p, v); } });
  });
  Object.defineProperty(El.prototype, 'className', { get: function () { return this.getAttribute('class') || ''; }, set: function (v) { this.setAttribute('class', v); } });
  Object.defineProperty(El.prototype, 'classList', { get: function () {
    var el = this;
    function list() { return (el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
    function put(l) { el.setAttribute('class', l.join(' ')); }
    return {
      add: function () { var l = list(); Array.prototype.forEach.call(arguments, function (c) { if (l.indexOf(c) === -1) l.push(c); }); put(l); },
      remove: function () { var a = Array.prototype.slice.call(arguments); put(list().filter(function (c) { return a.indexOf(c) === -1; })); },
      contains: function (c) { return list().indexOf(c) !== -1; },
      toggle: function (c, on) { var has = list().indexOf(c) !== -1; if (on === undefined) on = !has; if (on && !has) this.add(c); if (!on && has) this.remove(c); return on; }
    };
  } });
  Object.defineProperty(El.prototype, 'dataset', { get: function () {
    var el = this;
    return new Proxy({}, { get: function (_, k) { return el.getAttribute('data-' + String(k).replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); })) || undefined; },
      set: function (_, k, v) { el.setAttribute('data-' + String(k).replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }), v); return true; } });
  } });
  Object.defineProperty(El.prototype, 'hidden', { get: function () { return this.hasAttribute('hidden'); }, set: function (v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); } });
  Object.defineProperty(El.prototype, 'disabled', { get: function () { return this.hasAttribute('disabled'); }, set: function (v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); } });
  Object.defineProperty(El.prototype, 'innerHTML', { get: function () { return this._html; }, set: function (v) { this.textContent = ''; this._html = String(v); } });
  Object.defineProperty(El.prototype, 'children', { get: function () { return this.childNodes.filter(function (c) { return c.nodeType === 1; }); } });
  Object.defineProperty(El.prototype, 'firstElementChild', { get: function () { return this.children[0] || null; } });
  Object.defineProperty(El.prototype, 'lastElementChild', { get: function () { var c = this.children; return c[c.length - 1] || null; } });
  Object.defineProperty(El.prototype, 'parentElement', { get: function () { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; } });
  Object.defineProperty(El.prototype, 'nextSibling', { get: function () { var p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; } });
  Object.defineProperty(El.prototype, 'previousSibling', { get: function () { var p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) - 1] || null; } });
  El.prototype.value = '';
  El.prototype.selectionStart = 0; El.prototype.selectionEnd = 0;
  El.prototype.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b; };
  El.prototype.select = function () {};
  El.prototype.focus = function () { doc.activeElement = this; };
  El.prototype.blur = function () { if (doc.activeElement === this) doc.activeElement = doc.body; };
  El.prototype.click = function () { if (this.disabled) return; this.dispatchEvent(new Ev('click', { button: 0 })); };
  El.prototype.scrollIntoView = function () {};
  El.prototype.scrollTo = function () {};
  El.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; };
  El.prototype.scrollTop = 0; El.prototype.scrollHeight = 0; El.prototype.clientHeight = 0; El.prototype.offsetHeight = 0; El.prototype.offsetWidth = 0;
  function matches(el, sel) {
    sel = sel.trim();
    var m, re = /([#.]?[A-Za-z0-9_-]+|\[[^\]]+\]|\*)/g, parts = sel.match(re) || [];
    return parts.every(function (p) {
      if (p === '*') return true;
      if (p[0] === '#') return el.getAttribute('id') === p.slice(1);
      if (p[0] === '.') return el.classList.contains(p.slice(1));
      if (p[0] === '[') { m = /^\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(p); return m && (m[2] === undefined ? el.hasAttribute(m[1]) : el.getAttribute(m[1]) === m[2]); }
      return el.localName === p.toLowerCase();
    });
  }
  function descend(root, fn, outList) { root.childNodes.forEach(function (c) { if (c.nodeType === 1) { if (fn(c)) outList.push(c); descend(c, fn, outList); } }); return outList; }
  function qsa(root, sel) {
    return sel.split(',').reduce(function (acc, one) {
      var steps = one.trim().split(/\s+/);
      var found = descend(root, function (el) {
        if (!matches(el, steps[steps.length - 1])) return false;
        var n = el.parentNode, i = steps.length - 2;
        while (i >= 0 && n && n !== root.parentNode) { if (n.nodeType === 1 && matches(n, steps[i])) i--; n = n.parentNode; }
        return i < 0;
      }, []);
      found.forEach(function (f) { if (acc.indexOf(f) === -1) acc.push(f); });
      return acc;
    }, []);
  }
  El.prototype.querySelectorAll = function (s) { return qsa(this, s); };
  El.prototype.querySelector = function (s) { return qsa(this, s)[0] || null; };
  El.prototype.matches = function (s) { return s.split(',').some(function (x) { return matches(this, x); }, this); };
  El.prototype.closest = function (s) { var n = this; while (n && n.nodeType === 1) { if (n.matches(s)) return n; n = n.parentNode; } return null; };
  El.prototype.getElementsByTagName = function (t) { return qsa(this, t); };
  var doc = new Node(9);
  doc.documentElement = new El('html'); doc.appendChild(doc.documentElement);
  doc.head = new El('head'); doc.body = new El('body');
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body; doc.readyState = 'complete';
  doc.createElement = function (t) { return new El(t); };
  doc.createElementNS = function (ns, t) { return new El(t); };
  doc.createTextNode = function (t) { return new Text(String(t)); };
  doc.createDocumentFragment = function () { return new Frag(); };
  doc.getElementById = function (id) { return qsa(doc.documentElement, '#' + id)[0] || null; };
  doc.querySelectorAll = function (s) { return qsa(doc.documentElement, s).concat(matches(doc.documentElement, s) ? [doc.documentElement] : []); };
  doc.querySelector = function (s) { return doc.querySelectorAll(s)[0] || null; };
  doc.contains = function (n) { return Node.prototype.contains.call(doc, n); };
  return {
    document: doc,
    event: function (type, init) { return new Ev(type, init); },
    findAll: function (fn) { return all.filter(function (el) { return el.isConnected && fn(el); }); }
  };
}
