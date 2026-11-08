// node functions/lib/etb2b-assistant.test.js — the one ETB2B AI's shell (etb2b-assistant.js, plan §4, §5a, §6, §11a U2):
//   S.1  served as it is: ES5, no markup from text, only its own routes
//   S.2  where the person is: every page, the event (and the editor's ?slug=), the console's section, Promotions' tab;
//        never in a frame, on a published site, a preview or a shared link, with no mount, or signed out; the event
//        stays the one the page opened with (the activity log rewrites ?event= when its filter changes)
//   S.3  the brains: registry, the editor's rule (a corpus of 60 labelled messages), one handoff hop, local undo (by the
//        brain whose change is the newest: a portal switch is switched back, not an older page change undone), and a
//        bare "go back" asked about
//   S.4  mounting: the kit's options for each place (id, scope, welcome, help, placement, attach), the editor's wait
//        (its own place adapter, or a dash-only panel that says why), the context chip, leave()
//   S.5  the conversation per place: the dashboard's on global pages, the event's inside one (both brains)
//   S.6  errors by code, one table for both brains
//   S.7  attachments per place: types, sizes, Word refused plainly, a text file read, a picture re-encoded
//   S.8  files kept for another page: Create Event's logo and brief (IndexedDB, swept), the editor's carried pictures
//        (a pointer with an expiry), and Create Event's own inputs filled through their own change handlers, also in
//        the page's real order (its draft is filled before the shell has started)
// No network, no browser, no AI: the file runs in a vm with stand-ins for the kit, sign-in, the store and the DOM.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'etb2b-assistant.js'), 'utf8');
var DASH_SRC = fs.readFileSync(path.join(ROOT, 'dash-bot-client.js'), 'utf8');
var PREFILL_SRC = fs.readFileSync(path.join(ROOT, 'create-event-prefill.js'), 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function flush() { return new Promise(function (r) { setImmediate(r); }).then(function () { return new Promise(function (r) { setImmediate(r); }); }); }
async function settle(n) { for (var i = 0; i < (n || 6); i++) await flush(); }
function rejection(p) { return Promise.resolve(p).then(function () { return null; }, function (e) { return e; }); }

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
    }
  };
}
function makeStorage() {
  var m = {};
  return {
    _m: m,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; },
    key: function (i) { return Object.keys(m)[i] || null; },
    get length() { return Object.keys(m).length; }
  };
}
function fakeStore(init) {
  var m = {};
  Object.keys(init || {}).forEach(function (k) { m[k] = init[k]; });
  return {
    _m: m,
    get: function (k) { return Promise.resolve(Object.prototype.hasOwnProperty.call(m, k) ? m[k] : undefined); },
    put: function (k, v) { m[k] = v; return Promise.resolve(); },
    remove: function (k) { delete m[k]; return Promise.resolve(); }
  };
}
function el(props) {
  var e = { attrs: {}, listeners: {}, children: [], style: {}, hidden: false };
  Object.keys(props || {}).forEach(function (k) { e[k] = props[k]; });
  e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
  e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
  e.appendChild = function (c) { e.children.push(c); c.parentNode = e; return c; };
  e.removeChild = function (c) { e.children = e.children.filter(function (x) { return x !== c; }); c.parentNode = null; return c; };
  e.addEventListener = function (t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); };
  e.dispatchEvent = function (ev) { (e.listeners[ev.type] || []).forEach(function (fn) { fn(ev); }); if (typeof e['on' + ev.type] === 'function') e['on' + ev.type](ev); return true; };
  return e;
}
/* the kit, as plan §3a describes it: it records what it is given and draws nothing */
function makeKit() {
  var kit = { mounts: [], chat: null };
  kit.mount = function (host, opts) {
    var chat = {
      host: host, opts: opts, bubbles: [], users: [], dividers: [], scopes: [], contexts: [], open_: !!opts.startOpen, opened: 0,
      open: function () { chat.opened++; chat.open_ = true; }, close: function () { chat.open_ = false; }, isOpen: function () { return chat.open_; },
      focusInput: function () { chat.focused = true; }, setBusy: function () {}, fold: function () {}, markUndone: function () {},
      setScope: function (t) { chat.scopes.push(t); }, setContext: function (c) { chat.contexts.push(c); },
      divider: function (l) { chat.dividers.push(l); },
      user: function (t, o) { chat.users.push({ text: t, o: o }); return {}; },
      ai: function (c, o) { var b = { content: c, o: o || {}, notes: [], note: function (t) { b.notes.push(t); }, link: function () { return null; }, list: function () {}, undo: function () { return {}; } }; chat.bubbles.push(b); return b; }
    };
    kit.mounts.push({ host: host, opts: opts });
    kit.chat = chat;
    return chat;
  };
  return kit;
}
function response(status, body) {
  var text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status: status, text: function () { return Promise.resolve(text); } };
}
/* one page: the shell (and, when asked, the real dash brain before it) in a fresh vm.
   o: { page, path, search, hash, keepClear, framed, crossFrame, noMount, signedOut, noAuth, dash (load the real brain),
        brains: { name: brain } registered before boot, store, prefill (load create-event-prefill.js), els, edLoadFailed,
        loading (the page is still loading: nothing starts until fireReady()), authLater (the sign-in check answers
        at resolveAuth()) } */
function shellPage(o) {
  o = o || {};
  var clock = makeClock(), kit = o.noKit ? null : makeKit(), calls = [], assigned = [], scripts = [], anchors = [], winListeners = {};
  var docListeners = {}, dispatched = [], resolveAuth = null;
  var authReady = o.authLater ? new Promise(function (r) { resolveAuth = r; }) : null;
  var mount = el({ id: 'rv-assistant' });
  mount.attrs['data-rv-assistant'] = o.page || 'dashboard';
  if (o.keepClear) mount.attrs['data-keep-clear'] = o.keepClear;
  var bodyClasses = o.edLoadFailed ? ['ed-load-failed'] : [];
  var els = o.els || {};
  var doc = {
    readyState: o.loading ? 'loading' : 'complete', activeElement: null,
    addEventListener: function (t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    body: el({ classList: { contains: function (c) { return bodyClasses.indexOf(c) !== -1; } } }),
    head: el(),
    querySelector: function (s) { return s === '[data-rv-assistant]' && !o.noMount ? mount : null; },
    getElementById: function (id) { return els[id] || null; },
    createElement: function (tag) {
      var e = el({ tagName: String(tag).toUpperCase() });
      if (tag === 'a') e.click = function () { anchors.push(e.href); };
      if (tag === 'canvas') {
        e.getContext = function () { return { fillRect: function () { e.filled = e.fillStyle; }, drawImage: function () { e.drew = true; }, set fillStyle(v) { e.fillStyle = v; }, get fillStyle() { return e.fillStyle; } }; };
        e.toDataURL = function (type, q) { if (o.canvasThrows) throw new Error('SecurityError'); return 'data:image/jpeg;base64,' + new Array(Math.floor((o.thumbBytes || 30000) * (q || 1) * 4 / 3)).join('A'); };
      }
      return e;
    }
  };
  doc.head.appendChild = function (c) { scripts.push(c.src); c.parentNode = doc.head; if (o.onScript) o.onScript(c, ctx); return c; };
  var ctx = {
    document: doc, console: { log: function () {}, warn: function () {}, error: function () {}, info: function () {} },
    JSON: JSON, Promise: Promise, Date: Date, Object: Object, Array: Array, Math: Math, String: String, Number: Number, RegExp: RegExp, Error: Error,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent, Uint8Array: Uint8Array,
    navigator: { onLine: o.offline ? false : true },
    location: { pathname: o.path || '/Event_Listing.html', search: o.search || '', hash: o.hash || '', assign: function (u) { assigned.push(u); } },
    sessionStorage: o.session || makeStorage(), localStorage: o.local || makeStorage(),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    addEventListener: function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    dispatchEvent: function (ev) { var l = winListeners[ev.type] || []; dispatched.push({ type: ev.type, listeners: l.length }); l.forEach(function (fn) { fn(ev); }); return true; },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function (type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); },
    RevampChat: kit,
    RevampStore: o.store || undefined,
    RevampAuth: o.noAuth ? undefined : {
      whenResolved: function () { return authReady || Promise.resolve(); },
      currentUser: function () { return o.signedOut ? null : { displayName: 'Asha Rao', email: 'asha.rao@timesinternet.in' }; },
      authedFetch: function (url, opts) {
        calls.push({ url: url, method: opts && opts.method, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
        var a = o.answer ? o.answer(url) : null;
        if (a) return Promise.resolve(response(a.status || 200, a.body));
        if (url === '/api/dash-bot/history') return Promise.resolve(response(200, o.history || { turns: [] }));
        if (/^\/api\/chat\/history\?eventId=/.test(url)) return Promise.resolve(response(200, o.eventHistory || { event: { id: 'qa-main', name: 'QA Main' }, turns: [] }));
        return Promise.resolve(response(500, { error: 'no scripted answer' }));
      }
    }
  };
  ctx.window = ctx;
  if (o.crossFrame) Object.defineProperty(ctx, 'top', { get: function () { throw new Error('Blocked a frame with origin'); } });
  else ctx.top = o.framed ? {} : ctx;
  Object.keys(o.globals || {}).forEach(function (k) { ctx[k] = o.globals[k]; });
  vm.createContext(ctx);
  if (o.prefill) vm.runInContext(PREFILL_SRC, ctx, { filename: 'create-event-prefill.js' });
  if (o.dash) vm.runInContext(DASH_SRC, ctx, { filename: 'dash-bot-client.js' });
  if (o.beforeShell) o.beforeShell(ctx);
  vm.runInContext(SRC, ctx, { filename: 'etb2b-assistant.js' });
  var A = ctx.RevampAssistant;
  Object.keys(o.brains || {}).forEach(function (n) { A.registerBrain(n, o.brains[n]); });
  return settle().then(function () {
    return { ctx: ctx, A: A, kit: kit, clock: clock, calls: calls, assigned: assigned, scripts: scripts, anchors: anchors, mount: mount, winListeners: winListeners,
      dispatched: dispatched,
      /* the page has been read: DOMContentLoaded, its listeners in the order they were added */
      fireReady: function () { doc.readyState = 'interactive'; (docListeners.DOMContentLoaded || []).slice().forEach(function (fn) { fn({ type: 'DOMContentLoaded' }); }); },
      resolveAuth: function () { if (resolveAuth) resolveAuth(); },
      opts: function () { return kit && kit.mounts[0] ? kit.mounts[0].opts : null; } };
  });
}
/* a brain that records what it is asked, and answers from a script */
function fakeBrain(name, script) {
  var b = { name: name, sent: [], stops: 0, undos: 0, mounted: null };
  b.send = function (text, opts) { b.sent.push({ text: text, opts: opts }); var a = typeof script === 'function' ? script(text, opts) : { kind: 'reply' }; return Promise.resolve(a); };
  b.stop = function () { b.stops++; };
  b.onMount = function (c) { b.mounted = c; };
  b.welcome = function () { return { text: name + ' welcome', suggestions: [{ label: 's', text: 's' }], quickIdeas: [{ label: 'q', text: 'q' }], footNote: name + ' foot' }; };
  return b;
}

(async function main() {
  /* ======== S.1 served as it is ======== */
  check('S.1 parses', (function () { try { new vm.Script(SRC); return true; } catch (e) { return false; } })());
  var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  check('S.1 ES5: no let / const, arrows, template strings, spread, async, class', !/\blet\s/.test(code) && !/\bconst\s/.test(code) && code.indexOf('=>') === -1 &&
    code.indexOf('`') === -1 && code.indexOf('...') === -1 && !/\basync\s+function\b|\bawait\s/.test(code) && !/\bclass\s+[A-Z]/.test(code));
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still ran */ }
  if (esbuild) {
    ['etb2b-assistant.js', 'dash-bot-client.js', 'create-event-prefill.js'].forEach(function (f) {
      var r = (function () { try { esbuild.transformSync(fs.readFileSync(path.join(ROOT, f), 'utf8'), { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
      check('S.1 ES5 by esbuild: ' + f, r === true, r);
    });
  } else console.log('etb2b-assistant: esbuild is not installed here, so its ES5 pass was skipped (the regex checks ran)');
  check('S.1 no literal line separator inside the source (it ends a regex literal in older engines)', !/[\u2028\u2029]/.test(SRC) && !/[\u2028\u2029]/.test(DASH_SRC) && !/[\u2028\u2029]/.test(PREFILL_SRC));
  check('S.1 a page may load it (a top-level .js the server sends)', require('./access').isServableFile('etb2b-assistant.js') === true);
  check('S.1 nothing a person or a model typed becomes markup here', SRC.indexOf('innerHTML') === -1 && SRC.indexOf('insertAdjacentHTML') === -1 && SRC.indexOf('document.write') === -1);
  check('S.1 the only route it reads itself is an event\'s conversation (GET), and it never deletes, publishes, approves or sends',
    (SRC.match(/'\/api\/[^']*'/g) || []).every(function (u) { return u === '\'/api/chat/history?eventId=\''; }) && !/'DELETE'|\/publish|unpublish|\/approve|\/payment/i.test(SRC), SRC.match(/'\/api\/[^']*'/g));
  check('S.1 the scripts it may load on demand are this site\'s own two', (SRC.match(/loadScript\('([^']+)'/g) || []).sort().join() === "loadScript('/editor-store.js',loadScript('/portal-picker.js'");
  ['editor-store.js', 'portal-picker.js'].forEach(function (f) { check('S.1 …and ' + f + ' is served', require('./access').isServableFile(f) === true); });
  check('S.1 every sentence it says is in one TEXT table (the rename batch changes one place), and none says Revamp',
    !/Revamp CMS|\bRevamp\b(?![A-Z])/.test(SRC.replace(/Revamp[A-Z][A-Za-z]+/g, '')));
  /* UX-097 (B15 verifier): owner decision 6 named the product ETB2B EventSphere; no string it says, and no comment,
     names "Oneworld 2.0", and no quoted string names Oneworld at all */
  check('S.1 …and none says Oneworld 2.0 or Oneworld (owner decision 6: ETB2B EventSphere)', !/Oneworld 2\.0/.test(SRC) && !/'[^'\n]*Oneworld[^'\n]*'/.test(SRC),
    (SRC.match(/[^\n]*Oneworld[^\n]*/g) || []));

  /* ======== S.2 where the person is ======== */
  var P0 = await shellPage();
  var T = P0.A._test;
  var rp = T.readPlace;
  check('S.2 the ten pages', same(P0.A.PAGES.slice().sort(), ['activity-log', 'console', 'create-event', 'dashboard', 'editor', 'mailer-performance', 'portal-review', 'promotions', 'registrations', 'review']));
  check('S.2 the console: its event and section', same(rp('console', { search: '?event=qa-main', hash: '#content/speakers' }), { page: 'console', eventId: 'qa-main', tab: 'content/speakers' }));
  check('S.2 …#dashboard, #activity, #settings/seo, #design/editor are sections; anything else is none', same(['#dashboard', '#activity', '#settings/seo', '#design/editor', '#x', '#content/', '#content/Speakers', '#../x'].map(function (h) {
    return rp('console', { search: '?event=a1', hash: h }).tab; }), ['dashboard', 'activity', 'settings/seo', 'design/editor', '', '', '', '']));
  check('S.2 the editor: ?slug= first, then ?event=', rp('editor', { search: '?slug=qa-main&event=other' }).eventId === 'qa-main' && rp('editor', { search: '?event=qa-main' }).eventId === 'qa-main');
  check('S.2 …?slug= means nothing outside the editor', rp('console', { search: '?slug=qa-main' }).eventId === '');
  check('S.2 Promotions: its tab, only the three it has', rp('promotions', { search: '?event=a1&tab=mailers' }).tab === 'mailers' && rp('promotions', { search: '?event=a1&tab=sales' }).tab === '');
  check('S.2 review, registrations, the activity log of an event: their event', ['review', 'registrations', 'activity-log'].every(function (pg) { return rp(pg, { search: '?event=qa-main' }).eventId === 'qa-main'; }) &&
    rp('activity-log', { search: '' }).eventId === '');
  check('S.2 the dashboard, Create Event, mailer performance and portal review are never one event\'s, whatever the address says',
    ['dashboard', 'create-event', 'mailer-performance', 'portal-review'].every(function (pg) { return rp(pg, { search: '?event=qa-main' }).eventId === ''; }));
  check('S.2 an event id that is not one is dropped', ['?event=QA', '?event=-x', '?event=a/b', '?event=a%20b', '?event=' + new Array(90).join('a'), '?event=%E0%A4'].every(function (q) { return rp('console', { search: q }).eventId === ''; }));
  check('S.2 an unknown page is no place', rp('settings', {}) === null && rp('', {}) === null && rp('__proto__', {}) === null);
  check('S.2 a published site, a preview, a shared link, a template, the sign-in page and a framed studio are never places for it',
    ['/e/qa', '/s/abc', '/preview/qa', '/templates/tech500/index.html', '/preview-draft.html', '/index.html', '/promo-social-studio.html', '/promo-mailer-studio.html', '/e'].every(function (p) { return T.forbiddenPath({ pathname: p }); }) &&
    ['/edit-event.html', '/Event_Listing.html', '/create-event.html', '/marketing.html', '/review.html'].every(function (p) { return !T.forbiddenPath({ pathname: p }); }));
  check('S.2 place() reads the address afresh (the console\'s section moves)', (function () {
    P0.ctx.location.search = '?event=qa-main';
    var a = P0.A.place();
    return same(a, { page: 'dashboard', eventId: '', tab: '' });
  })());
  /* the event is the one the page opened with; only the console's section and Promotions' tab are read afresh */
  var Ppin = await shellPage({ page: 'console', path: '/edit-event.html', search: '?event=qa-main', hash: '#content/speakers', brains: { dash: fakeBrain('dash') } });
  Ppin.ctx.location.hash = '#settings/seo';
  check('S.2 place(): the console\'s section is read afresh', same(Ppin.A.place(), { page: 'console', eventId: 'qa-main', tab: 'settings/seo' }), Ppin.A.place());
  Ppin.ctx.location.search = '?event=qa-other';
  check('S.2 …but the event stays the one the page opened with', Ppin.A.place().eventId === 'qa-main');
  var Ppt = await shellPage({ page: 'promotions', path: '/marketing.html', search: '?event=qa-main&tab=posts', brains: { dash: fakeBrain('dash') } });
  Ppt.ctx.location.search = '?event=qa-main&tab=mailers';
  check('S.2 …Promotions\' tab too', same(Ppt.A.place(), { page: 'promotions', eventId: 'qa-main', tab: 'mailers' }));
  var alB = fakeBrain('dash'), alDrew = 0;
  alB.loadHistory = function () { alDrew++; return Promise.resolve(0); };
  var Pal = await shellPage({ page: 'activity-log', path: '/activity-log.html', search: '', brains: { dash: alB } });
  await Pal.opts().loadHistory(Pal.kit.chat);
  Pal.ctx.location.search = '?event=qa-main';      // the Event filter, written into the address in place
  await Pal.opts().send('How many registrations are there?', {});
  check('S.2 the activity log opened with no event, then filtered to one: the message goes as the conversation shown (no event), so it is stored there',
    alB.sent.length === 1 && alB.sent[0].opts.place.eventId === '' && Pal.opts().scope === 'Your events' && alDrew === 1 &&
    !Pal.calls.some(function (c) { return /chat\/history/.test(c.url); }) && Pal.opts().attach.label === 'Attach a brief (PDF or text) or a logo', alB.sent[0] && alB.sent[0].opts.place);
  var alB2 = fakeBrain('dash');
  var Pal2 = await shellPage({ page: 'activity-log', path: '/activity-log.html', search: '?event=qa-main', brains: { dash: alB2 } });
  Pal2.ctx.location.search = '?event=qa-two';
  await Pal2.opts().send('How many registrations here?', {});
  Pal2.ctx.location.search = '';
  await Pal2.opts().send('And yesterday?', {});
  check('S.2 …opened with an event, then switched to another or to All events: every message stays that event\'s, as the panel shows',
    alB2.sent.length === 2 && alB2.sent.every(function (x) { return x.opts.place.eventId === 'qa-main'; }) && Pal2.opts().scope === 'This event only' &&
    Pal2.opts().attach.label === 'Attach a picture', alB2.sent.map(function (x) { return x.opts.place; }));

  var never = [
    ['in a frame (a framed studio)', { page: 'promotions', framed: true, search: '?event=qa-main' }],
    ['in a frame of another site (top cannot even be read)', { page: 'console', crossFrame: true, search: '?event=qa-main' }],
    ['on a published site', { page: 'console', path: '/e/qa-main' }],
    ['on a shared link', { page: 'console', path: '/s/abc123' }],
    ['on a preview', { page: 'console', path: '/preview/qa-main' }],
    ['with no mount', { noMount: true }],
    ['signed out', { signedOut: true }],
    ['with no sign-in script at all', { noAuth: true }],
    ['with a place it does not know', { page: 'settings' }]
  ];
  for (var i = 0; i < never.length; i++) {
    var opt = never[i][1]; opt.brains = { dash: fakeBrain('dash') };
    var Pn = await shellPage(opt);
    var rd = await Pn.A.ready();
    check('S.2 never ' + never[i][0] + ': no panel, and ready() says so (null)', Pn.kit.mounts.length === 0 && rd === null, Pn.kit.mounts.length);
  }

  /* ======== S.3 the brains ======== */
  var dashB = fakeBrain('dash');
  var Pb = await shellPage({ brains: { dash: dashB } });
  check('S.3 registerBrain: dash and edit only, each with a send', Pb.A.registerBrain('other', fakeBrain('x')) === false && Pb.A.registerBrain('edit', {}) === false && Pb.A.registerBrain('edit', fakeBrain('edit')) === true);
  check('S.3 a brain registered is told the chat once mounted', dashB.mounted === Pb.kit.chat);
  var Pq = await shellPage({ dash: true });
  check('S.3 the real dash brain, loaded first (as every page orders the scripts), is picked up by itself', Pq.kit.mounts.length === 1 && Pq.opts().welcome.text === Pq.ctx.RevampDashBot.TEXT.welcome);

  /* the editor's rule (plan §5a): 60 labelled messages; at least 57 right, every undo right */
  var PIC = [{ id: 'a1', name: 'p.jpg', kind: 'image' }];
  var CORPUS = [
    ['undo', 'undo'], ['undo', 'Undo that'], ['undo', 'undo it'], ['undo', 'undo this.'], ['undo', 'Put it back'], ['undo', 'revert'], ['undo', 'Revert that!'],
    ['undo', 'revert it'], ['undo', 'Take that back'], ['undo', '  Take it back.  '],
    ['edit', 'Make the hero darker'], ['edit', 'Change the hero tagline to “Where retail meets tech”'], ['edit', 'Shorten the overview to two sentences'],
    ['edit', 'Rewrite the hero tagline to sound more premium'], ['edit', 'What can you change on this page?'], ['edit', 'Use a navy background for the agenda section'],
    ['edit', 'Make the buttons rounder'], ['edit', 'Add a short FAQ section about parking'], ['edit', 'Swap the font to something more modern'],
    ['edit', 'Make a new hero picture of a Mumbai skyline at dusk'], ['edit', 'Move the speakers section above the agenda'], ['edit', 'Hide the sponsors section'],
    ['edit', 'Add a speaker called Priya Nair'], ['edit', 'Make the whole page look more premium'], ['edit', 'Can the footer show our address?'],
    ['edit', 'Make the registration form shorter'], ['edit', 'Change the colour of the register button to red'], ['edit', 'Increase the spacing between sections'],
    ['edit', 'Put the logo on the left of the menu'], ['edit', 'Write a punchier heading for the why attend section'], ['edit', 'Remove the second paragraph of the overview'],
    ['edit', 'Translate the welcome text into Hindi'], ['edit', 'Make it feel more like a luxury event'], ['edit', 'Fix the typo in the venue line'],
    ['edit', 'Use this on the banner', PIC], ['edit', 'How many people would this fit?', PIC], ['edit', 'Show me the speakers section'],
    ['edit', 'Make the agenda easier to read on phones'], ['edit', 'Add more contrast to the stats strip'], ['edit', 'Open with a stronger first line'],
    ['dash', 'How many registrations does this event have?'], ['dash', 'How many people have signed up so far?'], ['dash', 'Open its promotions'],
    ['dash', 'Take me to the dashboard'], ['dash', 'Go to the speakers in Content'], ['dash', 'Show me the registrations'],
    ['dash', 'Make a save-the-date post for this event'], ['dash', 'Create an announcement mailer'], ['dash', 'Start a new event called QA Expo in Pune'],
    ['dash', 'Create a new IP event on 12 Feb 2027'], ['dash', 'Switch to ETAuto'], ['dash', 'Which events go live this month?'],
    ['dash', 'List my events in Mumbai'], ['dash', 'How did the visitors trend this week?'], ['dash', 'What is the conversion rate here?'],
    ['dash', 'Open the activity log'], ['dash', 'Tell me about QA AIE Draft'], ['dash', 'Is the waitlist full?'],
    ['dash', 'Draft a LinkedIn post about the speakers'], ['dash', 'What are my other events this quarter?']
  ];
  var tally = { undo: 0, edit: 0, dash: 0 }, wrong = [];
  CORPUS.forEach(function (c) { tally[c[0]]++; var got = Pb.A.route(c[1], c[2] || [], { page: 'editor' }); if (got !== c[0]) wrong.push([c[1], c[0], got]); });
  check('S.3 the corpus: 60 messages (10 undo, 30 edit, 20 dash)', CORPUS.length === 60 && same(tally, { undo: 10, edit: 30, dash: 20 }), tally);
  check('S.3 the rule gets at least 57 of 60 right', wrong.length <= 3, wrong);
  check('S.3 …and every undo phrase right (it runs with no AI call)', !wrong.some(function (w) { return w[1] === 'undo' || w[2] === 'undo'; }), wrong);
  console.log('etb2b-assistant: the router got ' + (60 - wrong.length) + ' of 60 right' + (wrong.length ? '; missed: ' + wrong.map(function (w) { return '“' + w[0] + '” (' + w[1] + ' → ' + w[2] + ')'; }).join(', ') : ''));
  check('S.3 an undo phrase inside a longer message is a message, not an undo', Pb.A.route('undo the hero change and make it blue', [], {}) === 'edit' && Pb.A.route('can you go back to the dashboard', [], {}) === 'dash');
  check('S.3 a bare "go back" could be either: it is asked about, never taken as an undo; "go back to …" names its place',
    ['go back', 'Go back.', 'GO BACK!', '  go back  '].every(function (t) { return Pb.A.route(t, [], {}) === 'ask'; }) &&
    Pb.A.route('Go back to the console', [], {}) === 'dash' && Pb.A.route('go back to the hero section', [], {}) === 'edit');
  /* B15 verifier: what only a person does goes to the events side, whose fixed sentence says who does it and where
     (an approver; Settings › Visibility for going offline), never to the editor's model, which has no such sentence
     and would cost a Sonnet call and a screenshot; the page's own words stay with the editor */
  var NEVER = ['Take the site offline', 'take this page offline please', 'Delete this event', 'delete the event', 'Cancel this event',
    'Restore the event', 'Publish the site', 'publish this page', 'Unpublish it', 'Can it go live today?', 'Make the site live', 'Approve the changes'];
  var neverWrong = NEVER.filter(function (t) { return Pb.A.route(t, [], { page: 'editor' }) !== 'dash'; });
  check('S.3 delete, cancel, restore, publish, take offline and approve go to the events side, page words or not', neverWrong.length === 0, neverWrong);
  var STAY = ['Remove the event logo from the hero', 'Change the button to “Publish now”', 'Delete the event date from the banner', 'Remove the second paragraph of the overview',
    'Delete the FAQ section', 'Add a line saying the paper is published in March'];
  var stayWrong = STAY.filter(function (t) { return Pb.A.route(t, [], { page: 'editor' }) !== 'edit'; });
  check('S.3 …while a part of the page named with them, or a quoted label, stays an edit', stayWrong.length === 0, stayWrong);

  /* in the editor: the rule, one hop, local undo */
  var editB = fakeBrain('edit', function (t) { return /handoff/.test(t) ? { kind: 'handoff' } : { kind: 'edit', turnId: 'TurnEdit01' }; });
  editB.undoLocal = function () { editB.undos++; return Promise.resolve({ ok: true }); };
  var dashE = fakeBrain('dash', function (t, o) { return /handoff/.test(t) && !o.handedFrom ? { handoff: true } : /twice/.test(t) ? { kind: 'handoff' } : { kind: 'reply' }; });
  var adapter = { welcome: { heading: 'Hi Asha, I’m ETB2B AI.', text: 'I change this page when you ask.' }, suggestions: [{ label: 'x', text: 'x' }], quickIdeas: [{ label: 'q', text: 'q' }],
    attach: { accept: 'image/*', max: 6, numbered: true, label: 'Attach a picture', add: function () { return Promise.resolve({}); } },
    dock: { minWidth: 1100, top: '56px' }, phoneSheet: 'half', phoneQuery: '(max-width: 720px)', wrapAttrs: { 'data-keep-selection': '' },
    onMount: function (c) { adapter.mountedWith = c; }, left: [], leave: function (u) { adapter.left.push(u); } };
  var Pe = await shellPage({ page: 'editor', path: '/custom_editor.html', search: '?slug=qa-main', keepClear: '.tpl-sel-toolbar:not([hidden])', brains: { dash: dashE, edit: editB } });
  check('S.3 the editor waits for its own page adapter before the panel comes', Pe.kit.mounts.length === 0);
  Pe.A.registerPlace(adapter);
  check('S.3 …registerPlace mounts it at once', Pe.kit.mounts.length === 1 && adapter.mountedWith === Pe.kit.chat && Pe.A.registerPlace({}) === false);
  var eo = Pe.opts();
  check('S.3 …with the editor\'s welcome, suggestions, quick ideas, attach, dock, half sheet and wrap attributes', eo.welcome.text === 'I change this page when you ask.' && eo.attach === adapter.attach &&
    eo.attach.max === 6 && same(eo.dock, adapter.dock) && eo.phoneSheet === 'half' && eo.phoneQuery === '(max-width: 720px)' && same(eo.wrapAttrs, { 'data-keep-selection': '' }) &&
    same(eo.suggestions, adapter.suggestions) && same(eo.quickIdeas, adapter.quickIdeas), eo);
  check('S.3 …kept clear of the editor\'s floating toolbars (the mount\'s data-keep-clear), id "ai", the event\'s scope', eo.keepClear === '.tpl-sel-toolbar:not([hidden])' && eo.id === 'ai' && eo.scope === 'This event only');
  await eo.send('Make the hero darker', { attachments: [] });
  check('S.3 a page message goes to the editor\'s brain, with the place', editB.sent.length === 1 && dashE.sent.length === 0 && same(editB.sent[0].opts.place, { page: 'editor', eventId: 'qa-main', tab: '' }));
  await eo.send('How many registrations does this event have?', { attachments: [] });
  check('S.3 a question goes to the dash brain (no Sonnet call, no screenshot)', dashE.sent.length === 1 && editB.sent.length === 1);
  await eo.send('undo that', {});
  check('S.3 "undo that": the editor\'s own undo, no brain asked', editB.undos === 1 && editB.sent.length === 1 && dashE.sent.length === 1);
  var nAsk = Pe.kit.chat.bubbles.length;
  var asked = await eo.send('go back', {});
  check('S.3 "go back" in the editor: one line asks which was meant; nothing undone, no brain asked', asked && asked.kind === 'ask' && editB.undos === 1 &&
    editB.sent.length === 1 && dashE.sent.length === 1 && Pe.kit.chat.bubbles.length === nAsk + 1 &&
    Pe.kit.chat.bubbles[nAsk].content === 'Do you want me to undo my last change, or open another page? Say “undo that”, or name the page, for example “go back to the console”.',
    Pe.kit.chat.bubbles.slice(nAsk).map(function (b) { return b.content; }));
  await eo.send('handoff me, please', {});
  check('S.3 the editor hands off once: the dash brain gets it with handedFrom "edit"', editB.sent.length === 2 && dashE.sent.length === 2 && dashE.sent[1].opts.handedFrom === 'edit');
  await eo.send('how many handoff here?', {});
  check('S.3 the dash brain hands off once: the editor gets it with handedFrom "dash", and never back', dashE.sent.length === 3 && editB.sent.length === 3 && editB.sent[2].opts.handedFrom === 'dash' && editB.sent[2].text === 'how many handoff here?');
  var bubblesBefore = Pe.kit.chat.bubbles.length;
  await eo.send('handoff twice', {});
  check('S.3 a brain that hands back is not followed: the plain sentence, once', dashE.sent.length === 4 && editB.sent.length === 4 && Pe.kit.chat.bubbles.length === bubblesBefore + 1 &&
    Pe.kit.chat.bubbles[bubblesBefore].content === 'I couldn’t tell whether that is about this page. Name the part of the page, for example “the hero”.');
  await eo.send('use this one', { attachments: PIC });
  check('S.3 a picture attached in the editor always goes to the editor', editB.sent.length === 5 && editB.sent[4].opts.attachments === PIC);
  Pe.A.stop();
  check('S.3 Stop reaches the brain that is answering', editB.stops === 1);
  Pe.A.leave('/edit-event.html?event=qa-main#content/speakers');
  check('S.3 leave(): through the editor\'s own leave (its dialog for unsaved work), never location.assign', same(adapter.left, ['/edit-event.html?event=qa-main#content/speakers']) && Pe.assigned.length === 0);
  /* "undo that" goes to the brain whose change in this panel is the newest (time as each brain reports it) */
  var clockNow = 1000000;
  function FakeDate() { this.v = clockNow; }
  FakeDate.prototype.getTime = function () { return this.v; };
  FakeDate.now = function () { return clockNow; };
  var dashAt = 0;
  var dashU = fakeBrain('dash', function () { dashAt = clockNow; return { kind: 'portal', turnId: 'TurnSwitch01' }; });
  dashU.changedAt = function () { return dashAt; };
  dashU.undoLocal = function () { dashU.undos++; dashAt = 0; return Promise.resolve({ ok: true, kind: 'portal' }); };
  var editU = fakeBrain('edit', function () { return { kind: 'edit', turnId: 'TurnEditU001', status: 'applied' }; });
  editU.undoLocal = function () { editU.undos++; return Promise.resolve({ ok: true }); };
  var Pu = await shellPage({ page: 'editor', path: '/custom_editor.html', search: '?slug=qa-main', globals: { Date: FakeDate }, brains: { dash: dashU, edit: editU } });
  Pu.A.registerPlace({});
  var uo = Pu.opts();
  clockNow += 1000; await uo.send('Make the hero darker', {});
  clockNow += 1000; await uo.send('Switch to ETAuto', {});
  check('S.3 undo: the page change went to the editor, the portal switch to the dash brain', editU.sent.length === 1 && dashU.sent.length === 1);
  await uo.send('undo that', {});
  check('S.3 …"undo that" after the portal switch: the dash brain switches back, no AI call, and the page change stays', dashU.undos === 1 && editU.undos === 0 && dashU.sent.length === 1 && editU.sent.length === 1);
  await uo.send('undo that', {});
  check('S.3 …"undo that" again: now the page change, by the editor', editU.undos === 1 && dashU.undos === 1);
  await uo.send('undo', {});
  check('S.3 …with nothing of the dash brain standing, the editor\'s own undo as before (its newest change still on the page)', editU.undos === 2 && dashU.undos === 1);
  clockNow += 1000; await uo.send('Switch to ETAuto', {});
  clockNow += 1000; await uo.send('Make the hero darker', {});
  await uo.send('undo that', {});
  check('S.3 …a page change after a portal switch is the newest: the editor undoes it', editU.undos === 3 && dashU.undos === 1);
  await uo.send('undo that', {});
  check('S.3 …then the portal switch, by the dash brain', dashU.undos === 2 && editU.undos === 3);
  clockNow += 1000; await uo.send('Make the hero darker', {}); await uo.send('Switch to ETAuto', {});
  await uo.send('undo that', {});
  check('S.3 …two changes in the same millisecond: the brain that answered last', dashU.undos === 3 && editU.undos === 3);
  /* the editor's own AI may undo too ("please take away what you just did" is not a fixed phrase): it counts */
  var editV = fakeBrain('edit', function (t) { return /take away/.test(t) ? { kind: 'undo', turnId: 'TurnEditV002', status: 'undone' } : { kind: 'edit', turnId: 'TurnEditV001', status: 'applied' }; });
  editV.undoLocal = function () { editV.undos++; return Promise.resolve({ ok: true }); };
  var dashAtV = 0;
  var dashV = fakeBrain('dash', function () { dashAtV = clockNow; return { kind: 'portal', turnId: 'TurnSwitch02' }; });
  dashV.changedAt = function () { return dashAtV; };
  dashV.undoLocal = function () { dashV.undos++; dashAtV = 0; return Promise.resolve({ ok: true }); };
  var Pv = await shellPage({ page: 'editor', path: '/custom_editor.html', search: '?slug=qa-main', globals: { Date: FakeDate }, brains: { dash: dashV, edit: editV } });
  Pv.A.registerPlace({});
  clockNow += 1000; await Pv.opts().send('Switch to ETAuto', {});
  clockNow += 1000; await Pv.opts().send('Make the hero darker', {});
  clockNow += 1000; await Pv.opts().send('please take away what you just did on the hero', {});
  await Pv.opts().send('undo that', {});
  check('S.3 …a page change the editor\'s AI already undid no longer counts: "undo that" then switches the portal back', dashV.undos === 1 && editV.undos === 0, [dashV.undos, editV.undos]);
  check('S.3 …no undo ever reached a brain\'s send (no AI call)', editU.sent.every(function (x) { return x.text !== 'undo that' && x.text !== 'undo'; }) && dashU.sent.every(function (x) { return x.text !== 'undo that'; }));

  /* the same with the real dash brain: "switch to ETAuto" in the editor. Owner decision 10: the editor is a page of
     one event, so the dash brain never moves the portal there (the server answers the scoped line; an answer that
     says otherwise is not carried out), and "undo that" goes to the editor's own undo */
  var working = [], cachedPortal = 'hr';
  var portalsR = { setWorking: function (to) { working.push(to); cachedPortal = to; return Promise.resolve(); }, cachedWorking: function () { return cachedPortal; } };
  var editR = fakeBrain('edit');
  editR.undoLocal = function () { editR.undos++; return Promise.resolve({ ok: true }); };
  var SWITCH = { turnId: 'TurnSwitch0009', kind: 'portal', parts: [{ t: 'text', v: 'Switching to ETAuto.' }], list: null, action: { type: 'portal', portal: 'auto', label: 'ETAuto' }, choices: null, notes: [] };
  var Prd = await shellPage({ page: 'editor', path: '/custom_editor.html', search: '?slug=qa-main', dash: true, brains: { edit: editR }, globals: { RevampPortals: portalsR },
    answer: function (u) { return u === '/api/dash-bot' ? { status: 200, body: SWITCH } : null; } });
  Prd.A.registerPlace({});
  function aiCalls(Pp) { return Pp.calls.filter(function (c) { return c.url === '/api/dash-bot'; }).length; }
  await Prd.opts().send('Switch to ETAuto', {});
  await settle();
  var lastRd = Prd.kit.chat.bubbles[Prd.kit.chat.bubbles.length - 1];
  check('S.3 the real dash brain in the editor: a portal switch is never carried out there, and the panel says it works on this event only',
    aiCalls(Prd) === 1 && same(working, []) && lastRd && lastRd.content === Prd.ctx.RevampDashBot.TEXT.otherEvent, [aiCalls(Prd), working, lastRd && lastRd.content]);
  check('S.3 …and the turn is reported failed, in the event\'s conversation', Prd.calls.some(function (c) {
    return c.url === '/api/dash-bot/turn' && c.body && c.body.turnId === 'TurnSwitch0009' && c.body.status === 'failed' && c.body.eventId === 'qa-main'; }), Prd.calls.map(function (c) { return c.url; }));
  await Prd.opts().send('undo that', {});
  check('S.3 …"undo that": nothing of the dash brain to take back, so the editor\'s own undo, with no AI call', editR.undos === 1 && aiCalls(Prd) === 1 && same(working, []));

  var routed = [];
  var Pr = await shellPage({ page: 'editor', search: '?slug=qa-main', brains: { dash: fakeBrain('dash'), edit: fakeBrain('edit') } });
  Pr.A.registerPlace({ route: function (t, recs, p) { routed.push([t, p.page]); return 'dash'; } });
  await Pr.opts().send('anything', {});
  check('S.3 the page adapter may route itself', same(routed, [['anything', 'editor']]));
  var dOnly = fakeBrain('dash'), eNot = fakeBrain('edit');
  var Pd = await shellPage({ page: 'console', search: '?event=qa-main', brains: { dash: dOnly, edit: eNot } });
  await Pd.opts().send('Make the hero darker', {});
  await Pd.opts().send('undo that', {});
  check('S.3 off the editor every message is the dash brain\'s (even a page change, even "undo that")', dOnly.sent.length === 2 && eNot.sent.length === 0 && eNot.undos === 0);

  /* the editor that never says it is ready: a panel that answers questions and says why it cannot edit */
  var Pw = await shellPage({ page: 'editor', search: '?slug=qa-main', brains: { dash: fakeBrain('dash'), edit: fakeBrain('edit') } });
  Pw.clock.tick(29500);
  check('S.3 the editor not ready after 29.5 s: still waiting', Pw.kit.mounts.length === 0);
  Pw.clock.tick(1000);
  check('S.3 …after 30 s the panel comes with the dash brain only, and says so', Pw.kit.mounts.length === 1 &&
    /^Editing this page with ETB2B AI isn’t available right now; reload the editor\. dash welcome$/.test(Pw.opts().welcome.text), Pw.opts() && Pw.opts().welcome);
  var wd = Pw.kit.mounts.length;
  Pw.clock.tick(60000);
  check('S.3 …and never mounts twice', Pw.kit.mounts.length === wd);
  check('S.3 …an editor that registers after that is turned away (the panel said: reload the editor)', Pw.A.registerPlace({ onMount: function () {} }) === false && Pw.kit.mounts.length === wd);
  var editLate = fakeBrain('edit'), dashLate = fakeBrain('dash');
  var Pf = await shellPage({ page: 'editor', search: '?slug=qa-main', edLoadFailed: true, brains: { dash: dashLate, edit: editLate } });
  check('S.3 the editor failed to load (body.ed-load-failed): the panel comes at once, dash only', Pf.kit.mounts.length === 1 && /isn’t available right now/.test(Pf.opts().welcome.text));
  await Pf.opts().send('Make the hero darker', {});
  check('S.3 …and the editor\'s brain is not asked while the editor has not said it is ready', editLate.sent.length === 0 && dashLate.sent.length === 1);
  var dashH = fakeBrain('dash', function () { return { handoff: true }; });
  var editH0 = fakeBrain('edit');
  var Pf2 = await shellPage({ page: 'editor', search: '?slug=qa-main', edLoadFailed: true, brains: { dash: dashH, edit: editH0 } });
  await Pf2.opts().send('use this on the banner please', {});
  check('S.3 …a handoff to an editor that is not ready is not followed: the plain sentence', editH0.sent.length === 0 && Pf2.kit.chat.bubbles.length === 1 &&
    /^I couldn’t tell whether that is about this page/.test(Pf2.kit.chat.bubbles[0].content));

  /* the context chip (the editor's selected section) */
  var ctxFns = [], cur = { label: 'Selected: Why attend', title: '“Six reasons…”' }, cleared = 0;
  var Pc = await shellPage({ page: 'editor', search: '?slug=qa-main', brains: { dash: fakeBrain('dash'), edit: fakeBrain('edit') } });
  Pc.A.registerPlace({ context: { current: function () { return cur; }, onChange: function (fn) { ctxFns.push(fn); }, clear: function () { cleared++; } } });
  check('S.3 the context chip follows the editor\'s selection', Pc.kit.chat.contexts.length === 1 && Pc.kit.chat.contexts[0].label === 'Selected: Why attend' && Pc.kit.chat.contexts[0].title === '“Six reasons…”');
  Pc.kit.chat.contexts[0].onClear();
  cur = null; ctxFns.forEach(function (fn) { fn(); });
  check('S.3 …its × clears the selection, and no selection is no chip', cleared === 1 && Pc.kit.chat.contexts[1] === null);

  /* ======== S.4 mounting: the kit's options for each place ======== */
  var Pm = await shellPage({ dash: true, globals: { RvListing: { snapshot: function () { return {}; }, me: function () { return { name: 'Asha Rao' }; }, openHelp: function () {} } } });
  var mo = Pm.opts();
  check('S.4 the dashboard: kit id "dash" (its launcher stays dash-chat-launcher), "Your events", the dashboard\'s own help', mo.id === 'dash' && mo.scope === 'Your events' && mo.help.label === 'Email Customer Care' && !mo.help.href);
  check('S.4 …the same look everywhere: "ETB2B AI", "Ask ETB2B AI", bottom-right, z 65 / 69', mo.title === 'ETB2B AI' && mo.launcherLabel === 'Ask ETB2B AI' && mo.placeholder === 'Ask ETB2B AI…' &&
    same(mo.placement, { right: 22, bottom: 22, compact: false }) && same(mo.zIndex, { launcher: 65, panel: 69 }));
  check('S.4 …the attach button takes a brief (PDF or text) or a logo here', mo.attach.label === 'Attach a brief (PDF or text) or a logo' && mo.attach.max === 4 && mo.attach.numbered === false &&
    /application\/pdf/.test(mo.attach.accept) && /\.docx/.test(mo.attach.accept) && mo.attach.hint === 'I use attachments to start a new event: a PDF or text brief, and the event’s logo.');
  var Pcon = await shellPage({ dash: true, page: 'console', path: '/edit-event.html', search: '?event=qa-main', keepClear: '.savebar.on', globals: { RevampPortals: { setWorking: function () {}, cachedWorking: function () { return 'cio'; } } } });
  var co = Pcon.opts();
  check('S.4 the console: id "ai", "This event only", kept clear of its save bar', co.id === 'ai' && co.scope === 'This event only' && co.keepClear === '.savebar.on');
  check('S.4 …help is a mail to Customer Care naming the page', co.help.href === 'mailto:customercare@economictimesb2b.com?subject=ETB2B%20EventSphere%20help%3A%20Event%20console', co.help.href);
  co.help.onClick();
  check('S.4 …which opens through a link (the page is not left)', same(Pcon.anchors, [co.help.href]) && Pcon.assigned.length === 0);
  check('S.4 …a page with the portal picker already has it: none loaded', Pcon.scripts.indexOf('/portal-picker.js') === -1);
  var Pnp = await shellPage({ dash: true, page: 'review', path: '/review.html', search: '?event=qa-main' });
  check('S.4 a page without the portal picker loads it (the dash brain switches portals through it)', Pnp.scripts.indexOf('/portal-picker.js') !== -1);
  var Pdb = await shellPage({ dash: true, globals: { RvListing: { snapshot: function () { return {}; }, me: function () { return {}; } }, RevampPortals: undefined } });
  check('S.4 the dashboard never loads it (its own switcher is the list\'s)', Pdb.scripts.indexOf('/portal-picker.js') === -1);
  var Pop = await shellPage({ brains: { dash: fakeBrain('dash') }, beforeShell: function (ctx) { ctx.sessionStorage.setItem('rv.assistant.open.dashboard', '1'); } });
  check('S.4 Back to a page ETB2B AI left: the panel opens (rv.assistant.open.<page>), and the key goes', Pop.opts().startOpen === true && Pop.ctx.sessionStorage.getItem('rv.assistant.open.dashboard') === null);
  Pop.A.markReopen();
  check('S.4 markReopen() sets this page\'s key', Pop.ctx.sessionStorage.getItem('rv.assistant.open.dashboard') === '1');
  var opened = [];
  Pop.A.onOpenChange(function (v) { opened.push(v); });
  Pop.opts().onOpenChange(true); Pop.opts().onOpenChange(false);
  check('S.4 onOpenChange: the kit\'s open and close reach the listeners', same(opened, [true, false]));
  Pop.A.open();
  check('S.4 open(), isOpen(), focusInput() reach the kit', Pop.kit.chat.opened === 1 && Pop.A.isOpen() === true && (Pop.A.focusInput(), Pop.kit.chat.focused === true));
  var Pmail = await shellPage({ page: 'mailer-performance', path: '/mailer-performance.html', brains: { dash: fakeBrain('dash') } });
  check('S.4 mailer performance: the dashboard\'s conversation and attach policy, help mails "Mailer performance"', Pmail.opts().scope === 'Your events' && /application\/pdf/.test(Pmail.opts().attach.accept) &&
    /Mailer%20performance$/.test(Pmail.opts().help.href));
  var Pnk = await shellPage({ noKit: true, brains: { dash: fakeBrain('dash') } });
  check('S.4 no kit on the page: nothing mounts, ready() says null', (await Pnk.A.ready()) === null);
  var Pnb = await shellPage({});
  check('S.4 no brain at all: nothing mounts', Pnb.kit.mounts.length === 0 && (await Pnb.A.ready()) === null);

  /* ======== S.5 the conversation per place ======== */
  var histB = fakeBrain('dash');
  var drew = [];
  histB.loadHistory = function (w) { drew.push(w); return Promise.resolve(0); };
  histB.replay = function (t, w) { w.user(t.question, { at: t.at }); w.ai('dash: ' + t.question, { at: t.at }); return true; };
  var Pg = await shellPage({ brains: { dash: histB } });
  await Pg.opts().loadHistory({ divider: function () {}, user: function () {}, ai: function () {} });
  check('S.5 a global page: the dash brain\'s own history (the person\'s dashboard conversation)', drew.length === 1 && !Pg.calls.some(function (c) { return /chat\/history/.test(c.url); }));
  var EH = { event: { id: 'qa-main', name: 'QA AIE Main\nwith a line break' }, turns: [
    { id: 'TurnEdit000001', question: 'Make the hero darker', answer: 'Done.', kind: 'edit', status: 'undone', done: ['Hero darker'], at: 'a' },
    { id: 'TurnDash000001', brain: 'dash', question: 'How many registrations?', at: 'b' },
    { id: 'TurnEdit000002', question: 'Stop that', answer: '', kind: 'edit', status: 'stopped', at: 'c' }] };
  var Pev = await shellPage({ page: 'console', search: '?event=qa-main', brains: { dash: histB }, eventHistory: EH });
  var n = await Pev.opts().loadHistory(Pev.kit.chat);
  var ch = Pev.kit.chat;
  check('S.5 inside an event: GET /api/chat/history?eventId=qa-main, both brains\' turns in order', n === 3 && Pev.calls.some(function (c) { return c.url === '/api/chat/history?eventId=qa-main'; }) &&
    same(ch.users.map(function (u) { return u.text; }), ['Make the hero darker', 'How many registrations?', 'Stop that']), ch.users);
  check('S.5 …"Earlier in this conversation" … "Now"; the header names the event in one line', same(ch.dividers, ['Earlier in this conversation', 'Now']) && same(ch.scopes, ['This event only: QA AIE Main with a line break']), ch.scopes);
  check('S.5 …the dash turn drawn by the dash brain; editor changes as plain lines with no Undo', ch.bubbles[1].content === 'dash: How many registrations?' &&
    ch.bubbles[0].notes.join('|') === 'Done: Hero darker|Done in the site editor, then undone.' && ch.bubbles[2].content === 'Stopped — nothing on the page changed.' && !ch.bubbles[2].notes.length,
    ch.bubbles.map(function (b) { return [b.content, b.notes]; }));
  var editH = fakeBrain('edit');
  var editWriter = null;
  editH.loadHistory = function (w) { editWriter = w; w.event({ id: 'qa-main', name: 'QA Main' }); w.other({ question: 'from dash', at: 'x' }); return Promise.resolve(1); };
  var Peh = await shellPage({ page: 'editor', search: '?slug=qa-main', brains: { dash: histB, edit: editH } });
  Peh.A.registerPlace({});
  await Peh.opts().loadHistory(Peh.kit.chat);
  check('S.5 in the editor its own brain replays the event\'s conversation (its changes come back with their Undo)', !!editWriter && !Peh.calls.some(function (c) { return /chat\/history/.test(c.url); }));
  check('S.5 …a dash turn it meets goes to the dash brain (writer.other), and writer.event names the event', Peh.kit.chat.bubbles.some(function (b) { return b.content === 'dash: from dash'; }) &&
    same(Peh.kit.chat.scopes, ['This event only: QA Main']));
  var Pbad = await shellPage({ page: 'console', search: '?event=qa-main', brains: { dash: histB }, answer: function (u) { return /chat\/history/.test(u) ? { status: 403, body: { error: 'no' } } : null; } });
  var hx = await rejection(Pbad.opts().loadHistory(Pbad.kit.chat));
  check('S.5 an event conversation that cannot be read rejects, with words for the kit', hx && /^Your earlier messages could not be loaded \(403\)\.$/.test(hx.message), hx && hx.message);

  /* ======== S.6 errors by code (UX-097) ======== */
  var E = P0.A.errorFor, EDIT = { page: 'editor' }, DASH = { page: 'dashboard' };
  function msg(r, p) { var e = E(r, p || DASH); return [e.message, e.retryable === false ? 'no-retry' : 'retry']; }
  var TABLE = [
    [{ status: 401, body: { error: 'x' } }, 'Your session has ended. Sign in again.', 'no-retry'],
    [{ network: { status: 401, code: 'revamp/signed-out' } }, 'Your session has ended. Sign in again.', 'no-retry'],
    [{ network: new Error('Failed to fetch') }, 'Could not reach ETB2B AI. Check your connection and try again.', 'retry'],
    [{ status: 429, body: { code: 'chat-rate', error: 'Slow down please.' } }, 'Slow down please.', 'retry'],
    [{ status: 429, body: { code: 'chat-rate' } }, 'That is a lot of messages in a short time. Please wait a few minutes and try again.', 'retry'],
    [{ status: 429, body: { code: 'dash-bot-daily' } }, 'You have used today’s ETB2B AI allowance. It resets at midnight (India time).', 'no-retry'],
    [{ status: 400, body: { code: 'too-long' } }, 'Keep the message under 4,000 characters. For a longer brief, ask me to start a new event from a brief, then paste it on Create Event.', 'no-retry'],
    [{ status: 503, body: { code: 'ai-config', error: 'Tell the Revamp team' } }, 'ETB2B AI is switched off right now. Nothing was changed. Please tell the ETB2B EventSphere support team.', 'no-retry'],
    [{ status: 429, body: { code: 'chat-rate', error: 'Slow down, says Oneworld 2.0.' } }, 'That is a lot of messages in a short time. Please wait a few minutes and try again.', 'retry'],
    [{ status: 400, body: { code: 'ai-blocked', error: 'rewording the brief' } }, 'ETB2B AI couldn’t work with that request. Nothing was changed. Try saying it another way.', 'no-retry'],
    [{ status: 429, body: { code: 'ai-quota', error: 'quota' } }, 'ETB2B AI is busy right now. Nothing was changed. Try again in a minute.', 'retry'],
    [{ status: 503, body: { code: 'ai-unavailable', retryable: false } }, 'ETB2B AI is busy right now. Nothing was changed. Try again in a minute.', 'retry'],
    [{ status: 504, body: { code: 'ai-timeout', timeoutMs: 45000 } }, 'ETB2B AI is busy right now. Nothing was changed. Try again in a minute.', 'retry'],
    [{ status: 502, body: { code: 'ai-bad-output' } }, 'ETB2B AI gave an answer it couldn’t use. Nothing was changed. Try again.', 'retry'],
    [{ status: 502, body: { code: 'ai-rejected', retryable: false, error: 'The AI service could not take this request. Tell the Revamp team.' } },
      'ETB2B AI couldn’t take that request. Nothing was changed. Try saying it another way, or remove an attachment.', 'no-retry'],
    [{ status: 502, body: { code: 'ai-rejected' } }, 'ETB2B AI couldn’t take that request. Nothing was changed. Try saying it another way, or remove an attachment.', 'no-retry'],
    [{ status: 502, body: { code: 'ai-overloaded', error: 'Something new went wrong. Tell the Revamp team.' } }, 'ETB2B AI couldn’t answer that. Nothing was changed. Try again, or say it another way.', 'retry'],
    [{ status: 422, body: { code: 'ai-new-refusal', retryable: false } }, 'ETB2B AI couldn’t answer that. Nothing was changed. Try again, or say it another way.', 'no-retry'],
    [{ status: 500, body: { code: 'module-unavailable', error: 'Something failed. Tell the Revamp team.' } }, 'ETB2B AI didn’t answer. Nothing was changed. Try again.', 'retry'],
    [{ status: 429, body: { code: 'chat-rate', error: 'Slow down, says Revamp CMS.' } }, 'That is a lot of messages in a short time. Please wait a few minutes and try again.', 'retry'],
    [{ status: 502, body: null }, 'ETB2B AI didn’t answer. Nothing was changed. Try again.', 'retry'],
    [{ status: 0, body: null }, 'ETB2B AI didn’t answer. Nothing was changed. Try again.', 'retry'],
    [{ status: 413, body: null }, 'That message and its attachments are too large to send. Remove an attachment and try again.', 'no-retry'],
    [{ status: 404, body: null }, 'ETB2B AI could not answer (error 404). Try again.', 'retry'],
    [{ status: 500, body: { error: 'Something on our side failed.' } }, 'Something on our side failed.', 'retry'],
    [{ status: 409, body: { error: 'That event has changed.', retryable: false } }, 'That event has changed.', 'no-retry'],
    [{ status: 500, body: [1, 2] }, 'ETB2B AI didn’t answer. Nothing was changed. Try again.', 'retry']
  ];
  TABLE.forEach(function (row) { var got = msg(row[0]); check('S.6 ' + JSON.stringify(row[0]).slice(0, 70) + ' → ' + row[1].slice(0, 40), got[0] === row[1] && got[1] === row[2], got); });
  check('S.6 in the editor the same sentence says "Your page is unchanged."', E({ status: 502, body: { code: 'ai-bad-output' } }, EDIT).message === 'ETB2B AI gave an answer it couldn’t use. Your page is unchanged. Try again.' &&
    E({ status: 503, body: { code: 'ai-config' } }, EDIT).message === 'ETB2B AI is switched off right now. Your page is unchanged. Please tell the ETB2B EventSphere support team.');
  check('S.6 ai-rejected in the editor: "Your page is unchanged."', E({ status: 502, body: { code: 'ai-rejected', retryable: false } }, EDIT).message === 'ETB2B AI couldn’t take that request. Your page is unchanged. Try saying it another way, or remove an attachment.' &&
    E({ status: 502, body: { code: 'ai-something' } }, EDIT).message === 'ETB2B AI couldn’t answer that. Your page is unchanged. Try again, or say it another way.');
  var saidAll = [];
  TABLE.forEach(function (row) { saidAll.push(E(row[0], DASH).message, E(row[0], EDIT).message); });
  check('S.6 no sentence errorFor gives names the old product, whatever the server said', saidAll.every(function (t) { return !/Revamp|Oneworld/.test(t); }), saidAll.filter(function (t) { return /Revamp|Oneworld/.test(t); }));
  var Poff = await shellPage({ offline: true });
  check('S.6 offline: its sentence', Poff.A.errorFor({ network: new Error('x') }, DASH).message === 'You’re offline. Check your connection and try again.');
  check('S.6 a 401 asks for sign-in', E({ status: 401 }, DASH).signIn === true && E({ network: { status: 401 } }, DASH).signIn === true);
  var allText = Object.keys(P0.A.TEXT).map(function (k) { return P0.A.TEXT[k]; }).join('\n');
  check('S.6 no sentence names the old product or carries a double full stop', !/Revamp|Oneworld|\.\.(?!\.)/.test(allText.replace(/…/g, '')), allText.match(/Revamp|Oneworld|\.\./g));
  check('S.6 the switched-off sentence and the help mail name the product as the owner did (ETB2B EventSphere)',
    /ETB2B EventSphere/.test(P0.A.TEXT.aiConfig) && P0.A.TEXT.helpSubject === 'ETB2B EventSphere help: ', [P0.A.TEXT.aiConfig, P0.A.TEXT.helpSubject]);

  /* ======== S.7 attachments per place ======== */
  var POL = T.POLICIES, cf = T.checkFile;
  function file(name, type, size, extra) { var f = { name: name, type: type, size: size }; Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; }); return f; }
  var MB = 1024 * 1024;
  var START = [
    [file('logo.png', 'image/png', 2000), ''], [file('photo.jpg', 'image/jpeg', 2000), ''], [file('x.webp', 'image/webp', 2000), ''], [file('evil.svg', '', 900), ''],
    [file('brief.pdf', 'application/pdf', 40000), ''], [file('notes.txt', 'text/plain', 600), ''], [file('notes.md', '', 600), ''],
    [file('deck.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 900), 'Create Event reads PDFs and plain text. Save the Word file as a PDF and attach it again.'],
    [file('old.doc', '', 900), 'Create Event reads PDFs and plain text. Save the Word file as a PDF and attach it again.'],
    [file('anim.gif', 'image/gif', 900), '“anim.gif” isn’t a file I can use here. Attach a picture (PNG, JPG, WEBP or SVG), a PDF or a text file.'],
    [file('tool.exe', 'application/x-msdownload', 900), '“tool.exe” isn’t a file I can use here. Attach a picture (PNG, JPG, WEBP or SVG), a PDF or a text file.'],
    [file('empty.png', 'image/png', 0), '“empty.png” is empty.'],
    [file('huge.png', 'image/png', 9 * MB), '“huge.png” is 9.0 MB. Pictures can be up to 8 MB.'],
    [file('huge.pdf', 'application/pdf', 16 * MB), '“huge.pdf” is 16.0 MB. A brief PDF can be up to 15 MB.'],
    [file('long.txt', 'text/plain', 40000), '“long.txt” is longer than 4,000 characters. Attach the part that matters, or the brief as a PDF.'],
    [file('max.png', 'image/png', 8 * MB), ''], [file('max.pdf', 'application/pdf', 15 * MB), '']
  ];
  START.forEach(function (c) { var got = cf(c[0], POL.start); check('S.7 without an event: ' + c[0].name + ' → ' + (c[1] || 'taken'), got === c[1], got); });
  var EVENT = [
    [file('photo.jpg', 'image/jpeg', 2000), ''], [file('anim.gif', 'image/gif', 900), ''], [file('logo.svg', 'image/svg+xml', 900), ''],
    [file('brief.pdf', 'application/pdf', 900), 'A brief is read when a new event’s site is generated, in Create Event. It can’t be read into this event.'],
    [file('deck.docx', '', 900), 'A brief is read when a new event’s site is generated, in Create Event. It can’t be read into this event.'],
    [file('notes.txt', 'text/plain', 90), 'A brief is read when a new event’s site is generated, in Create Event. It can’t be read into this event.'],
    [file('tool.exe', '', 900), '“tool.exe” isn’t a picture I can use. Attach a PNG, JPG, WEBP, GIF or SVG picture.']
  ];
  EVENT.forEach(function (c) { var got = cf(c[0], POL.event); check('S.7 inside an event: ' + c[0].name + ' → ' + (c[1] || 'taken'), got === c[1], got); });
  check('S.7 the editor (before its own attach path is there): a PDF is for Create Event', cf(file('brief.pdf', 'application/pdf', 9), POL.editor) === 'In the editor I can use pictures. A brief is read by Create Event’s Generate from a brief.');
  check('S.7 which policy where', P0.A.policyFor({ page: 'dashboard' }).name === 'start' && P0.A.policyFor({ page: 'create-event' }).name === 'start' && P0.A.policyFor({ page: 'console', eventId: 'a1' }).name === 'event' &&
    P0.A.policyFor({ page: 'activity-log', eventId: '' }).name === 'start' && P0.A.policyFor({ page: 'editor', eventId: 'a1' }).name === 'editor');
  /* owner decision 10: on a page that is always about one event an attachment never starts a new event, even when
     its address carries no event (the server then refuses all the same) */
  check('S.7 a page of one event with no event in its address still never takes a brief or a logo for a new event',
    ['console', 'promotions', 'review', 'registrations'].every(function (pg) { return P0.A.policyFor({ page: pg, eventId: '' }).name === 'event'; }) &&
    P0.A.policyFor({ page: 'mailer-performance', eventId: '' }).name === 'start');
  check('S.7 a name is one line with no path', T.cleanName('C:\\fake\\path\\my\nlogo.png') === 'my logo.png' && T.cleanName('') === 'file' && T.cleanName(new Array(300).join('x')).length === 120);

  /* reading a file: a picture re-encoded, a PDF by its first bytes, a text file's words */
  var imgs = [];
  function FakeImage() { var me = this; imgs.push(me); me.naturalWidth = 0; me.naturalHeight = 0;
    Object.defineProperty(me, 'src', { set: function (v) { me._src = v; setImmediate(function () { if (me._fail) { me.onerror(); return; } me.naturalWidth = me._w == null ? 1142 : me._w; me.naturalHeight = me._h == null ? 680 : me._h; me.onload(); }); }, get: function () { return me._src; } }); }
  function FakeReader() { var me = this;
    me.readAsText = function (f) { setImmediate(function () { if (f._fail) { me.onerror(); return; } me.result = f._text; me.onload(); }); };
    me.readAsArrayBuffer = function (part) { setImmediate(function () { me.result = new Uint8Array(String(part._head || '').split('').map(function (c) { return c.charCodeAt(0); })).buffer; me.onload(); }); }; }
  function blobFile(name, type, size, extra) { var f = file(name, type, size, extra); f.slice = function () { return { _head: f._head }; }; return f; }
  var URLS = { created: [], revoked: [] };
  var G = { Image: FakeImage, FileReader: FakeReader, URL: { createObjectURL: function (f) { URLS.created.push(f.name); return 'blob:' + f.name; }, revokeObjectURL: function (u) { URLS.revoked.push(u); } } };
  var Pa = await shellPage({ globals: G, brains: { dash: fakeBrain('dash') } });
  var add = Pa.opts().attach.add;
  var logo = blobFile('logo.png', 'image/png', 2000);
  var rec = await add(logo);
  check('S.7 a picture: its record (name, kind image, size, type, natural size)', rec && rec.kind === 'image' && rec.name === 'logo.png' && rec.size === 2000 && rec.type === 'image/png' && rec.w === 1142 && rec.h === 680 && rec.wire === 'image', rec);
  check('S.7 …the model sees a JPEG thumbnail of at most 120 KB, drawn on white from a blob: address (no script of the file runs)', /^data:image\/jpeg;base64,/.test(rec.thumb) && T.dataBytes(rec.thumb) <= 120 * 1024 &&
    URLS.created.indexOf('logo.png') !== -1 && URLS.revoked.indexOf('blob:logo.png') !== -1, [rec.thumb && rec.thumb.length, URLS]);
  check('S.7 …the file stays in this browser, with the chip', Pa.A.fileOf(rec) === logo && Pa.A.fileOf({ id: 'nope' }) === null);
  var gone = await add(blobFile('gone.png', 'image/png', 10));
  Pa.opts().attach.remove(gone);
  check('S.7 …a chip the person takes away lets its file go', Pa.A.fileOf(gone) === null && Pa.A.fileOf(rec) === logo);
  var Pbig = await shellPage({ globals: G, thumbBytes: 400000, brains: { dash: fakeBrain('dash') } });
  var recBig = await Pbig.opts().attach.add(blobFile('big.png', 'image/png', 3 * MB));
  check('S.7 a picture whose thumbnail stays over 120 KB at every quality: no thumbnail, the file still goes', recBig && !recBig.thumb && recBig.kind === 'image', recBig && Object.keys(recBig));
  var Ptaint = await shellPage({ globals: G, canvasThrows: true, brains: { dash: fakeBrain('dash') } });
  var recSvg = await Ptaint.opts().attach.add(blobFile('evil.svg', 'image/svg+xml', 900));
  check('S.7 an SVG the browser will not read back from the canvas: no thumbnail, still attached', recSvg && !recSvg.thumb && recSvg.type === 'image/svg+xml');
  var broken = blobFile('broken.png', 'image/png', 900);
  var e1 = await rejection((function () { var p = add(broken); imgs[imgs.length - 1]._fail = true; return p; })());
  check('S.7 a picture the browser cannot draw is refused: "could not be read as a picture"', e1 && e1.message === '“broken.png” could not be read as a picture.', e1 && e1.message);
  var pdf = await add(blobFile('brief.pdf', 'application/pdf', 40000, { _head: '%PDF-' }));
  check('S.7 a PDF by its first bytes: a document chip, by name and size only (Create Event reads it)', pdf && pdf.kind === 'doc' && pdf.wire === 'pdf' && !pdf.text && !pdf.thumb, pdf);
  var e2 = await rejection(add(blobFile('fake.pdf', 'application/pdf', 900, { _head: '<html' })));
  check('S.7 a file only named .pdf is refused', e2 && e2.message === '“fake.pdf” isn’t a PDF that can be read.');
  var txt = await add(blobFile('notes.txt', 'text/plain', 600, { _text: 'Line one\r\nLine\u0007 two  ' }));
  check('S.7 a text file\'s words are read (UTF-8), its line breaks kept, control characters gone', txt && txt.wire === 'text' && txt.text === 'Line one\nLine two', txt);
  var e3 = await rejection(add(blobFile('long.txt', 'text/plain', 5000, { _text: new Array(4002).join('x') })));
  check('S.7 over 4,000 characters is refused', e3 && /is longer than 4,000 characters/.test(e3.message));
  var e4 = await rejection(add(blobFile('blank.txt', 'text/plain', 10, { _text: '   \n ' })));
  check('S.7 a text file with no words is empty', e4 && e4.message === '“blank.txt” is empty.');
  var e5 = await rejection(add(blobFile('deck.docx', '', 900)));
  check('S.7 Word is refused plainly at once, nothing read', e5 && e5.message === 'Create Event reads PDFs and plain text. Save the Word file as a PDF and attach it again.');
  var wire = Pa.A.wireAttachments([rec, pdf, txt, { kind: 'image', name: 'x.png', thumb: 'data:image/svg+xml;base64,PHN2Zz4=', type: 'image/png', size: 1 }, { kind: 'image', name: 'fifth.png' }]);
  check('S.7 what the server is sent: numbered, at most 4, a thumbnail only when it is a JPEG data address',
    wire.length === 4 && same(wire.map(function (a) { return a.n + ':' + a.kind; }), ['1:image', '2:pdf', '3:text', '4:image']) && !!wire[0].thumb && !('thumb' in wire[3]) && wire[2].text === 'Line one\nLine two' && !('text' in wire[1]), wire);
  check('S.7 …nothing that is not a chip', same(Pa.A.wireAttachments([null, 'x', { kind: 'video' }]), []) && same(Pa.A.wireAttachments(null), []));

  /* ======== S.8 files kept for another page ======== */
  var CC = P0.A.carryCheck;
  check('S.8 carryCheck: Create Event\'s logo box takes PNG, WEBP or SVG up to 5 MB', CC('logo', { kind: 'image', type: 'image/png', size: 10, name: 'a' }) === '' && CC('logo', { kind: 'image', type: 'image/svg+xml', size: 5 * MB, name: 'a' }) === '' &&
    CC('logo', { kind: 'image', type: 'image/jpeg', size: 10, name: 'photo.jpg' }) === 'Create Event takes a PNG, WEBP or SVG logo of up to 5 MB, so “photo.jpg” wasn’t carried: upload the logo there.' &&
    !!CC('logo', { kind: 'image', type: 'image/png', size: 5 * MB + 1, name: 'a' }));
  check('S.8 …its Overview document a PDF up to 15 MB', CC('brief', { wire: 'pdf', size: 15 * MB, name: 'b' }) === '' && !!CC('brief', { wire: 'text', size: 10, name: 'n.txt' }) && CC('none', {}) === 'none');

  /* the logo and the brief for Create Event (aihandoff:<id>), with the index swept */
  var store = fakeStore({ 'aihandoff:index': { v: 1, keys: { OldOldOldOld01: Date.now() - 11 * 60000, FreshFresh0001: Date.now() - 1000 } }, 'aihandoff:OldOldOldOld01': { v: 1 }, 'aihandoff:FreshFresh0001': { v: 1 }, 'site:x:y': { keep: 1 } });
  var Ps = await shellPage({ globals: G, store: store, brains: { dash: fakeBrain('dash') } });
  var sAdd = Ps.opts().attach.add;
  var lf = blobFile('small.png', 'image/png', 2000), df = blobFile('brief.pdf', 'application/pdf', 40000, { _head: '%PDF-' }), jf = blobFile('photo.jpg', 'image/jpeg', 2000);
  var lr = await sAdd(lf), dr = await sAdd(df), jr = await sAdd(jf);
  var okH = await Ps.A.handoffFiles('Tq3x9Kd2mP8vW1zR', [{ rec: lr, role: 'logo', n: 1 }, { rec: dr, role: 'brief', n: 2 }, { rec: jr, role: 'logo', n: 3 }, { rec: lr, role: 'banner', n: 1 }]);
  var kept = store._m['aihandoff:Tq3x9Kd2mP8vW1zR'];
  check('S.8 handoffFiles keeps the logo and the brief, with their files, for Create Event', okH === true && kept && kept.v === 1 && typeof kept.at === 'number' &&
    same(kept.files.map(function (f) { return [f.n, f.role, f.name, f.type, f.size, f.blob === (f.role === 'logo' ? lf : df)]; }), [[1, 'logo', 'small.png', 'image/png', 2000, true], [2, 'brief', 'brief.pdf', 'application/pdf', 40000, true]]), kept);
  check('S.8 …a JPEG "logo" and any other role are not kept', kept.files.length === 2);
  check('S.8 …the index names it, and an entry older than ten minutes is swept (only aihandoff: keys)', !!store._m['aihandoff:index'].keys.Tq3x9Kd2mP8vW1zR && !store._m['aihandoff:index'].keys.OldOldOldOld01 &&
    !('aihandoff:OldOldOldOld01' in store._m) && ('aihandoff:FreshFresh0001' in store._m) && store._m['site:x:y'].keep === 1, Object.keys(store._m));
  check('S.8 …a bad prefill id, or nothing to keep: false, nothing written', (await Ps.A.handoffFiles('bad', [{ rec: lr, role: 'logo' }])) === false && (await Ps.A.handoffFiles('Tq3x9Kd2mP8vW1zZ', [{ rec: { id: 'gone' }, role: 'logo' }])) === false &&
    !('aihandoff:Tq3x9Kd2mP8vW1zZ' in store._m));
  /* no store on the page (the dashboard): editor-store.js is loaded for it */
  var lateStore = fakeStore();
  var Pls = await shellPage({ globals: G, brains: { dash: fakeBrain('dash') }, onScript: function (s, ctx) { if (s.src === '/editor-store.js') setImmediate(function () { ctx.RevampStore = lateStore; s.onload(); }); } });
  var lr2 = await Pls.opts().attach.add(blobFile('small.png', 'image/png', 2000));
  var okL = await Pls.A.handoffFiles('Tq3x9Kd2mP8vW1zR', [{ rec: lr2, role: 'logo', n: 1 }]);
  check('S.8 a page without the store loads /editor-store.js, then keeps the files', okL === true && Pls.scripts.indexOf('/editor-store.js') !== -1 && !!lateStore._m['aihandoff:Tq3x9Kd2mP8vW1zR']);
  var Pns = await shellPage({ globals: G, brains: { dash: fakeBrain('dash') }, onScript: function (s) { if (s.src === '/editor-store.js') setImmediate(function () { s.onerror(); }); } });
  var lr3 = await Pns.opts().attach.add(blobFile('small.png', 'image/png', 2000));
  check('S.8 …a store that cannot be had: false (Create Event then says the file did not come)', (await Pns.A.handoffFiles('Tq3x9Kd2mP8vW1zR', [{ rec: lr3, role: 'logo', n: 1 }])) === false);

  /* pictures carried to an event's site editor: a pointer with an expiry, the files in IndexedDB, taken once */
  var cstore = fakeStore();
  var Pcar = await shellPage({ page: 'console', search: '?event=qa-main', globals: G, store: cstore, brains: { dash: fakeBrain('dash') } });
  var pr = await Pcar.opts().attach.add(blobFile('photo.jpg', 'image/jpeg', 2000));
  var okC = await Pcar.A.carry('qa-main', [pr, { kind: 'doc', id: 'x' }], 'use this as the hero background on the site');
  var ptr = JSON.parse(Pcar.ctx.localStorage.getItem('rv.assistant.carry.qa-main') || 'null');
  check('S.8 carry: a pointer for the event (key, words, time, how many)', okC === true && ptr && /^[A-Za-z0-9]{16}$/.test(ptr.key) && ptr.text === 'use this as the hero background on the site' && ptr.n === 1 && typeof ptr.at === 'number', ptr);
  check('S.8 …and the picture under aicarry:<event>:<key>, in the index', !!cstore._m['aicarry:qa-main:' + ptr.key] && cstore._m['aicarry:qa-main:' + ptr.key].files[0].name === 'photo.jpg' && !!cstore._m['aicarry:index'].keys['qa-main:' + ptr.key]);
  check('S.8 …never for an id that is not an event\'s, nor with no picture', (await Pcar.A.carry('QA/../x', [pr], 'x')) === false && (await Pcar.A.carry('qa-main', [], 'x')) === false);
  var G2 = {}; Object.keys(G).forEach(function (k) { G2[k] = G[k]; });
  G2.File = function (parts, name, o) { this.parts = parts; this.name = name; this.type = o && o.type; this.size = parts[0] && parts[0].size; };
  var Ped = await shellPage({ page: 'editor', search: '?slug=qa-main', globals: G2, store: cstore, local: Pcar.ctx.localStorage, brains: { dash: fakeBrain('dash'), edit: fakeBrain('edit') } });
  var took = await Ped.A.takeCarry('qa-main');
  check('S.8 takeCarry in the editor: the words and the picture as a File, once', took && took.text === 'use this as the hero background on the site' && took.expected === 1 && took.files.length === 1 &&
    took.files[0].name === 'photo.jpg' && took.files[0].type === 'image/jpeg', took);
  check('S.8 …then nothing: the pointer and the record are gone', (await Ped.A.takeCarry('qa-main')) === null && !('aicarry:qa-main:' + ptr.key in cstore._m) && Ped.ctx.localStorage.getItem('rv.assistant.carry.qa-main') === null);
  Ped.ctx.localStorage.setItem('rv.assistant.carry.qa-main', JSON.stringify({ key: 'AbCdEfGhJkLmNpQr', text: 'old', at: Date.now() - 11 * 60000, n: 1 }));
  check('S.8 …a pointer older than ten minutes is nothing, and is removed', (await Ped.A.takeCarry('qa-main')) === null && Ped.ctx.localStorage.getItem('rv.assistant.carry.qa-main') === null);
  Ped.ctx.localStorage.setItem('rv.assistant.carry.qa-main', JSON.stringify({ key: 'AbCdEfGhJkLmNpQr', text: 'lost', at: Date.now(), n: 2 }));
  var lost = await Ped.A.takeCarry('qa-main');
  check('S.8 …a pointer whose pictures were not kept: the words come, with how many were expected', lost && lost.text === 'lost' && lost.files.length === 0 && lost.expected === 2, lost);
  Ped.ctx.localStorage.setItem('rv.assistant.carry.qa-main', '{oops');
  check('S.8 …an unreadable pointer is nothing', (await Ped.A.takeCarry('qa-main')) === null);

  /* Create Event: the files go into the page's own inputs, through their own change handlers, once the form shows them */
  var ID = 'Tq3x9Kd2mP8vW1zR';
  var ceStore = fakeStore();
  var lblob = { size: 2000, type: 'image/png', slice: function () { return this; } }, dblob = { size: 40000, type: 'application/pdf', slice: function () { return this; } };
  ceStore._m['aihandoff:' + ID] = { v: 1, at: Date.now() - 1000, files: [{ n: 1, role: 'logo', name: 'small.png', type: 'image/png', size: 2000, blob: lblob }, { n: 2, role: 'brief', name: 'brief.pdf', type: 'application/pdf', size: 40000, blob: dblob }] };
  var shown = { 'logo-cell': false, 'gb-doc-row': false };
  var changes = [];
  function input(id) {
    var i = el({ id: id });
    Object.defineProperty(i, 'files', { set: function (v) { i._files = v; }, get: function () { return i._files; } });
    return i;
  }
  var ELS = { 'f-logo': input('f-logo'), 'gb-doc': input('gb-doc'),
    'logo-cell': el({ getClientRects: function () { return shown['logo-cell'] ? [1] : []; } }), 'gb-doc-row': el({ getClientRects: function () { return shown['gb-doc-row'] ? [1] : []; } }) };
  function DataTransfer() { var list = []; this.items = { add: function (f) { list.push(f); } }; this.files = list; }
  var G3 = { DataTransfer: DataTransfer, File: G2.File };
  var Pce = await shellPage({ page: 'create-event', path: '/create-event.html', prefill: true, store: ceStore, els: ELS, globals: G3, brains: { dash: fakeBrain('dash') } });
  check('S.8 Create Event listens for the prefill (revamp:prefill-applied)', (Pce.winListeners['revamp:prefill-applied'] || []).length === 1);
  var stored = { v: 1, from: 'etb2b-ai', at: Date.now() - 1000, turnId: ID, prefillId: ID, category: 'IP', method: 'brief', portal: '',
    basics: { name: 'QA AIE Expo', client: '', dateMode: '', start: '', end: '', month: '', quarter: '', year: '', venue: '', city: 'Mumbai' }, brief: { text: '', current: '', previous: '' },
    files: [{ n: 1, role: 'logo', name: 'small.png', type: 'image/png', size: 2000 }, { n: 2, role: 'brief', name: 'brief.pdf', type: 'application/pdf', size: 40000 }] };
  var ls = makeStorage(); ls.setItem('revamp.createEvent.prefill.v1.' + ID, JSON.stringify(stored));
  var P = Pce.ctx.RevampPrefill;
  var draft = { basics: { category: 'IP', name: '', client: '', portal: '', dateMode: 'exact', start: '', end: '', venue: '', city: '', slug: '', slugTouched: false }, brief: {}, aiHero: null };
  var CATS = { IP: { dateModes: ['exact', 'month', 'quarter', 'tbd'], defaultDateMode: 'exact', venue: true }, Client: { client: true }, Awards: {} };
  P.apply(draft, CATS, P.take(ls, ID), {});
  Pce.clock.tick(0);
  await settle();
  Pce.clock.tick(500);
  check('S.8 the files are taken once from the store (by create-event-prefill.js takeFiles)', !('aihandoff:' + ID in ceStore._m));
  check('S.8 …nothing is put in while the boxes have no handler and are not on screen', !ELS['f-logo']._files && !ELS['gb-doc']._files);
  ELS['f-logo'].onchange = function (ev) { changes.push(['logo', ev.type, ELS['f-logo']._files[0].name, ELS['f-logo']._files[0].type]); };
  Pce.clock.tick(500);
  check('S.8 …a handler but the form not on screen yet: still nothing', changes.length === 0);
  shown['logo-cell'] = true;
  Pce.clock.tick(500);
  check('S.8 …the logo box on screen: the logo goes in through the page\'s own change handler (its checks run)', same(changes, [['logo', 'change', 'small.png', 'image/png']]), changes);
  ELS['gb-doc'].onchange = function (ev) { changes.push(['brief', ev.type, ELS['gb-doc']._files[0].name]); };
  shown['gb-doc-row'] = true;
  Pce.clock.tick(500);
  check('S.8 …and the brief into the Overview document, once', same(changes.slice(1), [['brief', 'change', 'brief.pdf']]), changes);
  Pce.clock.tick(5000);
  check('S.8 …each only once', changes.length === 2);
  check('S.8 …nothing is generated or created: no request at all', Pce.calls.length === 0);
  /* a file the dashboard could not keep: said in the panel */
  var Pce2 = await shellPage({ page: 'create-event', path: '/create-event.html', prefill: true, store: fakeStore(), els: ELS, globals: G3, brains: { dash: fakeBrain('dash') } });
  Pce2.ctx.dispatchEvent(new Pce2.ctx.CustomEvent('revamp:prefill-applied', { detail: { id: ID, files: [{ role: 'logo', name: 'small.png' }] } }));
  Pce2.clock.tick(0);
  await settle();
  check('S.8 a file that did not come: the panel says so, and where to add it', Pce2.kit.chat.bubbles.length === 1 &&
    Pce2.kit.chat.bubbles[0].content === '“small.png” couldn’t be brought to Create Event from the events dashboard (this browser didn’t keep it). Add it here: Upload logo, on the details form.', Pce2.kit.chat.bubbles.map(function (b) { return b.content; }));
  var badStore = fakeStore();
  badStore._m['aihandoff:' + ID] = { v: 1, at: Date.now() - 1000, files: [{ n: 1, role: 'logo', name: 'renamed.png', type: 'image/jpeg', size: 2000, blob: { size: 2000, type: 'image/jpeg', slice: function () { return this; } } }] };
  var Pce4 = await shellPage({ page: 'create-event', path: '/create-event.html', prefill: true, store: badStore, els: ELS, globals: G3, brains: { dash: fakeBrain('dash') } });
  Pce4.ctx.dispatchEvent(new Pce4.ctx.CustomEvent('revamp:prefill-applied', { detail: { id: ID, files: [{ role: 'logo', name: 'renamed.png' }] } }));
  Pce4.clock.tick(0);
  await settle();
  check('S.8 a file that is not what the box takes, by the file itself (a JPEG named .png): said, never put in', Pce4.kit.chat.bubbles.length === 1 &&
    Pce4.kit.chat.bubbles[0].content === '“renamed.png” wasn’t put in: Create Event takes a PNG, WEBP or SVG logo of up to 5 MB.', Pce4.kit.chat.bubbles.map(function (b) { return b.content; }));
  var Pce3 = await shellPage({ page: 'create-event', path: '/create-event.html', prefill: true, store: fakeStore(), els: ELS, globals: G3, brains: { dash: fakeBrain('dash') } });
  Pce3.ctx.dispatchEvent(new Pce3.ctx.CustomEvent('revamp:prefill-applied', { detail: { id: 'bad!', files: [{ role: 'logo', name: 'x' }] } }));
  Pce3.ctx.dispatchEvent(new Pce3.ctx.CustomEvent('revamp:prefill-applied', { detail: { id: ID, files: [] } }));
  Pce3.clock.tick(0);
  await settle();
  check('S.8 an event with a bad id, or no files, does nothing', Pce3.kit.chat.bubbles.length === 0);
  var Pdash = await shellPage({ brains: { dash: fakeBrain('dash') } });
  check('S.8 only Create Event listens for it', !(Pdash.winListeners['revamp:prefill-applied'] || []).length);

  /* The real order (create-event.html): the page's own init is added on DOMContentLoaded before this shell's boot, and
     fills the draft at once (apply() says which files came); the shell starts only once the sign-in check answers. */
  var roStore = fakeStore();
  roStore._m['aihandoff:' + ID] = { v: 1, at: Date.now() - 1000, files: [{ n: 1, role: 'logo', name: 'small.png', type: 'image/png', size: 2000, blob: lblob }, { n: 2, role: 'brief', name: 'brief.pdf', type: 'application/pdf', size: 40000, blob: dblob }] };
  var roShown = { 'logo-cell': false, 'gb-doc-row': false }, roChanges = [];
  var RO_ELS = { 'f-logo': input('f-logo'), 'gb-doc': input('gb-doc'),
    'logo-cell': el({ getClientRects: function () { return roShown['logo-cell'] ? [1] : []; } }), 'gb-doc-row': el({ getClientRects: function () { return roShown['gb-doc-row'] ? [1] : []; } }) };
  var roLs = makeStorage(); roLs.setItem('revamp.createEvent.prefill.v1.' + ID, JSON.stringify(stored));
  var Pro = await shellPage({ page: 'create-event', path: '/create-event.html', prefill: true, loading: true, authLater: true, store: roStore, els: RO_ELS, globals: G3, brains: { dash: fakeBrain('dash') },
    beforeShell: function (c) {
      c.document.addEventListener('DOMContentLoaded', function () {
        var d = { basics: { category: 'IP', name: '', client: '', portal: '', dateMode: 'exact', start: '', end: '', venue: '', city: '', slug: '', slugTouched: false }, brief: {}, aiHero: null };
        c.RevampPrefill.apply(d, CATS, c.RevampPrefill.take(roLs, ID), {});
      });
    } });
  Pro.fireReady();
  await settle();
  var roSaid = Pro.dispatched.filter(function (d) { return d.type === 'revamp:prefill-applied'; });
  check('S.8 the real order: Create Event says which files came while nothing listens yet (the shell waits for the sign-in check)',
    roSaid.length === 1 && roSaid[0].listeners === 0 && Pro.kit.mounts.length === 0 && ('aihandoff:' + ID in roStore._m), roSaid);
  Pro.resolveAuth();
  await settle();
  Pro.clock.tick(0);
  await settle();
  check('S.8 …once it answers, the shell reads what was said (lastApplied) and takes the files', Pro.kit.mounts.length === 1 && !('aihandoff:' + ID in roStore._m) &&
    (Pro.winListeners['revamp:prefill-applied'] || []).length === 1);
  RO_ELS['f-logo'].onchange = function (ev) { roChanges.push(['logo', ev.type, RO_ELS['f-logo']._files[0].name]); };
  RO_ELS['gb-doc'].onchange = function (ev) { roChanges.push(['brief', ev.type, RO_ELS['gb-doc']._files[0].name]); };
  roShown['logo-cell'] = true; roShown['gb-doc-row'] = true;
  Pro.clock.tick(500);
  check('S.8 …and both files still arrive in Create Event\'s own boxes, through their own change handlers', same(roChanges, [['logo', 'change', 'small.png'], ['brief', 'change', 'brief.pdf']]), roChanges);
  Pro.ctx.dispatchEvent(new Pro.ctx.CustomEvent('revamp:prefill-applied', { detail: { id: ID, files: [{ role: 'logo', name: 'small.png' }] } }));
  Pro.clock.tick(0);
  await settle();
  Pro.clock.tick(5000);
  check('S.8 …each id is taken once, however it is told (the same event again does nothing and says nothing)', roChanges.length === 2 && Pro.kit.chat.bubbles.length === 0,
    [roChanges, Pro.kit.chat.bubbles.map(function (b) { return b.content; })]);
  check('S.8 …and lastApplied() is read once', Pro.ctx.RevampPrefill.lastApplied() === null);

  if (failed) { console.error('etb2b-assistant: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('etb2b-assistant: all ' + passed + ' checks passed');
})().catch(function (e) { console.error('FAIL the test itself threw: ' + (e && e.stack)); process.exit(1); });
