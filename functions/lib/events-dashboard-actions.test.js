/* node functions/lib/events-dashboard-actions.test.js — batch B07 on the events dashboard (Event_Listing.html):
     UX-016  Clone, Delete and Restore really happen (POST /api/event/clone, DELETE /api/event, POST /api/event/restore,
             through edit-event-core.js), ask first where something is taken away, show progress, read the list again
             and offer Open copy / Undo / Show it; Mark as completed and Delete permanently are gone; Delete and Restore
             are for approvers only (owner decision #4), muted "Approvers only" for anyone else;
     UX-034  Deleted Events is filled from GET /api/events?deleted=1, Cancelled is offered only while an event is
             cancelled, and the Draft and Deleted views have no Insights;
     UX-027  a failed load is one message where the list would be, worded by its cause, with Try again (and Sign in),
             no counts, no Insights, no Latest activity, no "Create your first event";
     UX-035  each empty tab says what fits it; "No events match" has a search icon;
     UX-039  the Insights cards count what a search or filter leaves, and say what they count;
     UX-022  the top bar has Events only, the "Updated" button really reads the events again and says when, and the
             Event ID chip is gone; UX-025 no Payment column, no Paid / Free filter, Revenue "not available yet";
     UX-026  the Audience Segmentation card and its generated audiences are gone; UX-017 (done before B07) stays done.
   The page's own inline script runs in node's vm over a small DOM (fixtures/mini-dom.js) with the real
   edit-event-core.js and event-lifecycle.js; every /api answer comes from an in-memory stand-in for the server that
   keeps the rule the real one keeps (functions/lib/event-remove-approvers.test.js holds the real routes to it).
   No network, no browser, no AI. Exits 1 on any failure. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var makeDom = require('./fixtures/mini-dom').makeDom;

var ROOT = path.join(__dirname, '..', '..');
var PAGE = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8');
var CORE = fs.readFileSync(path.join(ROOT, 'edit-event-core.js'), 'utf8');
var LIFE = fs.readFileSync(path.join(ROOT, 'event-lifecycle.js'), 'utf8');
var START = PAGE.indexOf('<script>\n(function(){');
var INLINE = START === -1 ? '' : PAGE.slice(START + '<script>'.length, PAGE.indexOf('</script>', START));
var CODE = INLINE.replace(/\/\*[\s\S]*?\*\//g, '');
/* the page with its comments taken out (they say what was removed and why, by name) */
var LIVE = PAGE.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
var BODY = PAGE.slice(PAGE.indexOf('<header class="main-nav">'), PAGE.indexOf('<script src="theme-toggle.js">'));
var ROSTER = require('./et-events').portalList();

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '')); }
function flush(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 20); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }
function response(status, json) {
  var t = json === undefined ? '' : JSON.stringify(json);
  return { status: status, ok: status >= 200 && status < 300, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(json === undefined ? {} : JSON.parse(t)); } };
}

/* ======================================================================================================
   1. the page as a file: what B07 took out stays out
   ====================================================================================================== */
check('the inline script and edit-event-core.js are found', INLINE.length > 50000 && CORE.length > 20000);
check('UX-016 no pretend actions left: no "Mark as completed", "Delete permanently", "Duplicated as", "deleted permanently", no made-up ev_ ids, no splice of the list',
  LIVE.indexOf('Mark as completed') === -1 && LIVE.indexOf('Delete permanently') === -1 && LIVE.indexOf('Duplicated as') === -1 && LIVE.indexOf('deleted permanently') === -1 &&
  CODE.indexOf("'ev_'") === -1 && CODE.indexOf('EVENTS.splice') === -1 && CODE.indexOf("e.status = 'completed'") === -1 && CODE.indexOf("e.status = 'cancelled'") === -1);
check('UX-016 the actions go through edit-event-core.js: cloneEvent, deleteEvent, restoreEvent, slugAvailable',
  /C\.cloneEvent\(e\.id, slug, n\)/.test(CODE) && /C\.deleteEvent\(e\.id\)/.test(CODE) && /C\.restoreEvent\(e\.id\)/.test(CODE) && /C\.slugAvailable\(slug\)/.test(CODE));
check('UX-016 edit-event-core.js loads before auth.js and the inline script, and the server sends it',
  PAGE.indexOf('<script src="edit-event-core.js"></script>') !== -1 && LIVE.indexOf('<script src="edit-event-core.js">') < LIVE.indexOf('<script src="auth.js">') &&
  require('./access').isServableFile('edit-event-core.js') === true);
check('UX-017 (done before B07) stays done: no PORTAL_ACTIVITY_BASE, no newsletter or subscriber panels, no generated deltas',
  LIVE.indexOf('PORTAL_ACTIVITY_BASE') === -1 && LIVE.indexOf('renderNewsletterPanel') === -1 && LIVE.indexOf('renderSubscriberPanel') === -1 && !/Math\.sin\(/.test(CODE));
check('UX-022 the top bar: Events only; no Awards, CRM, Webinars or More Products, no link to index.html but the logo',
  LIVE.indexOf('More Products') === -1 && LIVE.indexOf('btn-more-products') === -1 && !/label:'(Awards|CRM|Webinars|Payments|Event Edition|Marketing Dashboard)'/.test(CODE) &&
  (LIVE.match(/href="index\.html"/g) || []).length === 1 && CODE.indexOf("href:'index.html'") === -1);
check('UX-022 no "Updated 2 min ago" text, no "Event data refreshed" toast, no Event ID chip', LIVE.indexOf('Updated 2 min ago') === -1 && LIVE.indexOf('Event data refreshed') === -1 &&
  LIVE.indexOf('Event ID:') === -1 && LIVE.indexOf('hashToEventNo') === -1 && LIVE.indexOf('ev-id-chip') === -1);
check('UX-025 no Payment column, no Paid / Free filter, no rupee figures, Revenue honestly "not available yet"',
  LIVE.indexOf('data-sort="payment"') === -1 && LIVE.indexOf('data-mpay') === -1 && LIVE.indexOf('Paid events') === -1 && LIVE.indexOf('pay-free') === -1 &&
  LIVE.indexOf('fmtRupee') === -1 && LIVE.indexOf('Payments: not available yet') !== -1 && LIVE.indexOf('payments, anything') === -1);
check('UX-026 the Audience Segmentation card and its generated audiences are gone', LIVE.indexOf('Audience Segmentation') === -1 && LIVE.indexOf('segment-card') === -1 &&
  LIVE.indexOf('generateAudience') === -1 && LIVE.indexOf('COMPANY_POOL') === -1 && LIVE.indexOf('Attendance Intent') === -1 && !/\.seg-[a-z]/.test(LIVE));
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the word check below still runs */ }
check('the inline script is ES5 (no let, const, arrows or template strings)', !/\blet\s|\bconst\s/.test(CODE) && CODE.indexOf('=>') === -1 && CODE.indexOf('`') === -1);
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(INLINE, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n')[0]; } })();
  check('the inline script is ES5 by esbuild', es5 === true, es5);
}
/* the new parts' colours are the page's own tokens, so light and dark both work */
var CSS = PAGE.slice(PAGE.indexOf('<style>'), PAGE.indexOf('</style>'));
['.btn-danger{', '.popover-item.is-locked', '.dlg-error{', '.field-hint{', '.insights-scope{', '.ev-deleted-note{', '.empty-state.is-failed'].forEach(function (sel) {
  var at = CSS.indexOf(sel), rule = at === -1 ? '' : CSS.slice(at, CSS.indexOf('}', at));
  check('the ' + sel.replace(/\{$/, '') + ' rule uses colour tokens only', at !== -1 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rule), rule);
});

/* ======================================================================================================
   2. the page, run
   ====================================================================================================== */
var NOW = Date.now(), DAY = 86400000;
function iso(ms) { return new Date(ms).toISOString(); }
var ME = 'asha.rao@timesinternet.in';
function baseItems() {
  return [
    { id: 'live-summit', name: 'Live Summit', category: 'ip', published: true, publishedPath: '/e/live-summit', start: iso(NOW - DAY), end: iso(NOW + DAY), portal: 'cio', portalName: 'ETCIO', counters: { registrations: 12, views: 90 } },
    { id: 'up-one', name: 'Upcoming One', category: 'ip', published: true, start: iso(NOW + 10 * DAY), end: iso(NOW + 11 * DAY), portal: 'cio', portalName: 'ETCIO', venue: 'Taj', city: 'Mumbai', counters: { registrations: 3, views: 30 } },
    { id: 'up-two', name: 'Upcoming Two', category: 'client', published: true, start: iso(NOW + 20 * DAY), end: iso(NOW + 21 * DAY), portal: 'cio', portalName: 'ETCIO', city: 'Pune', counters: { registrations: 5, views: 50 } },
    { id: 'a-draft', name: 'A Draft', category: 'awards', published: false, portal: 'cio', portalName: 'ETCIO', createdBy: ME, counters: {} }
  ];
}
function baseDeleted() {
  return [{ id: 'gone-one', name: 'Gone One', category: 'ip', published: true, start: iso(NOW + 5 * DAY), end: iso(NOW + 6 * DAY), portal: 'cio', portalName: 'ETCIO', deletedAt: '2026-11-01T06:00:00.000Z', deletedBy: 'boss@timesinternet.in', counters: { registrations: 2 } }];
}

/* o: items, deleted, approvers (the config; undefined: none named), approvalsFail, liveFail (status | 'net'),
   deletedFail, offline, cloneFail, deleteFail, restoreFail, taken (addresses in use) */
function page(o) {
  o = o || {};
  var live = (o.items || baseItems()).map(function (x) { return JSON.parse(JSON.stringify(x)); });
  var gone = (o.deleted || baseDeleted()).map(function (x) { return JSON.parse(JSON.stringify(x)); });
  var log = [], nav = [], signIns = 0, timers = [];
  var dom = makeDom(), d = dom.document;
  d.body.innerHTML = BODY;
  function approvers() { return o.approvers || []; }
  function taken(id) { return (o.taken || []).indexOf(id) !== -1 || live.concat(gone).some(function (e) { return e.id === id; }); }
  function mayRemove() { var a = approvers(); return !a.length || a.indexOf(ME) !== -1; }
  function readEvents(url) {
    if (url === '/api/events') {
      if (o.liveFail === 'net') return Promise.reject(new TypeError('Failed to fetch'));
      if (o.liveFail) return Promise.resolve(response(o.liveFail, { error: 'Something went wrong on the server. Please try again.' }));
      return Promise.resolve(response(200, { items: live }));
    }
    if (url === '/api/events?deleted=1') return Promise.resolve(o.deletedFail ? response(500, { error: 'x' }) : response(200, { items: gone }));
    if (url === '/api/settings/approvals') return Promise.resolve(o.approvalsFail ? response(500, { error: 'x' }) : response(200, { approvers: approvers(), allowSelf: false, required: true }));
    if (/^\/api\/insights\?/.test(url)) return Promise.resolve(response(200, { byDay: [], events: live.map(function (e) {
      var c = e.counters || {};
      return { eventId: e.id, name: e.name, window: { views: c.views || 0, registrations: c.registrations || 0, uniques: 0, lastRegistration: null, lastView: null } };
    }) }));
    if (/^\/api\/activity\/all\?/.test(url)) return Promise.resolve(response(200, { items: [], next: null }));
    if (url === '/api/promo/analytics/all') return Promise.resolve(response(200, { available: false, backend: 'none', series: [], totals: {} }));
    return Promise.resolve(response(404, { error: 'not here' }));
  }
  /* the mutations, as the server answers them (the approver rule included) */
  function route(method, url, body) {
    log.push({ method: method, url: url, body: body });
    var m;
    if (method === 'GET' && (m = /^\/api\/event\/slug-available\?slug=(.*)$/.exec(url))) {
      var s = decodeURIComponent(m[1]);
      return response(200, taken(s) ? { available: false, suggestion: s + '-2', reason: 'taken', message: 'That address is already used by another event.' } : { available: true, suggestion: '', slug: s });
    }
    if (method === 'POST' && url === '/api/event/clone') {
      if (o.cloneFail) return response(o.cloneFail.status, o.cloneFail.body);
      if (taken(body.eventId)) return response(409, { error: 'That address is already used by another event. Try "' + body.eventId + '-2".', code: 'slug-taken', suggestion: body.eventId + '-2' });
      var src = live.filter(function (e) { return e.id === body.sourceEventId; })[0];
      live.push({ id: body.eventId, name: body.name, category: src.category, published: false, portal: src.portal, portalName: src.portalName, createdBy: ME, counters: {} });
      return response(200, { eventId: body.eventId, name: body.name, templateId: null, copied: {} });
    }
    if (method === 'DELETE' && (m = /^\/api\/event\?eventId=([^&]+)$/.exec(url))) {
      if (o.deleteFail) return response(o.deleteFail, { error: 'The event could not be deleted. Please try again.' });
      if (!mayRemove()) return response(403, { error: 'Only an approver (' + approvers().join(', ') + ') can delete an event.', code: 'not-an-approver', approvers: approvers() });
      var i = live.map(function (e) { return e.id; }).indexOf(m[1]);
      if (i !== -1) { var e = live.splice(i, 1)[0]; e.deletedAt = new Date().toISOString(); e.deletedBy = ME; gone.unshift(e); }
      return response(200, { ok: true, eventId: m[1] });
    }
    if (method === 'POST' && url === '/api/event/restore') {
      if (o.restoreFail) return response(o.restoreFail, { error: 'The event could not be restored. Please try again.' });
      if (!mayRemove()) return response(403, { error: 'Only an approver (' + approvers().join(', ') + ') can restore a deleted event.', code: 'not-an-approver', approvers: approvers() });
      var j = gone.map(function (e) { return e.id; }).indexOf(body.eventId);
      if (j !== -1) { var r = gone.splice(j, 1)[0]; delete r.deletedAt; delete r.deletedBy; live.push(r); }
      return response(200, { ok: true, eventId: body.eventId, published: !!(r && r.published) });
    }
    return response(404, { error: 'No such endpoint' });
  }
  var ctx = {
    document: d, console: { log: function () {}, warn: function () {}, error: function () {} },
    navigator: { onLine: o.offline ? false : true },
    location: { hash: '', href: 'http://localhost/Event_Listing.html', pathname: '/Event_Listing.html', origin: 'http://localhost', reload: function () {} },
    history: { replaceState: function () {} },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, clearTimeout: function () {},
    requestAnimationFrame: function () { return 0; },
    scrollTo: function () {}, open: function (u) { nav.push(u); },
    matchMedia: function () { return { matches: false }; },
    addEventListener: function (t, fn) { (dom.winListeners[t] = dom.winListeners[t] || []).push(fn); },
    innerWidth: 1440, innerHeight: 900,
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    fetch: function (url, opts) { log.push({ method: (opts && opts.method) || 'GET', url: url }); return readEvents(url); },
    RevampAuth: {
      getIdToken: function () { return Promise.resolve('token'); },
      currentUser: function () { return { uid: 'u-asha', email: ME, displayName: 'Asha Rao' }; },
      authedFetch: function (url, opts) { var body = opts && opts.body ? JSON.parse(opts.body) : undefined; return Promise.resolve(route((opts && opts.method) || 'GET', url, body)); },
      redirectToSignIn: function () { signIns++; }
    },
    /* portal-picker.js as the page uses it: ET's roster, every portal as the working one */
    RevampPortals: {
      list: function () { return Promise.resolve(ROSTER.map(function (p) { return { slug: p.slug, name: p.name }; })); },
      working: function () { return Promise.resolve(o.working || 'all'); }, cachedWorking: function () { return o.working || 'all'; },
      setWorking: function (v) { return Promise.resolve(v); },
      nameOf: function (slug) { var p = ROSTER.filter(function (r) { return r.slug === slug; })[0]; return p ? p.name : ''; },
      chipHtml: function (x) { return '<span class="rvp-chip"><button type="button" data-set-portal="' + x.eventId + '">Set portal</button></span>'; },
      openSetPortal: function () {}
    }
  };
  ctx.window = ctx;
  /* a navigation is recorded, never followed */
  Object.defineProperty(ctx.location, 'href', { get: function () { return 'http://localhost/Event_Listing.html'; }, set: function (v) { nav.push(v); } });
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx, { filename: 'edit-event-core.js' });
  vm.runInContext(LIFE, ctx, { filename: 'event-lifecycle.js' });
  vm.runInContext(INLINE, ctx, { filename: 'Event_Listing.html (inline)' });
  function $(id) { return d.getElementById(id); }
  var S = {
    ctx: ctx, dom: dom, doc: d, $: $, log: log, nav: nav, live: live, gone: gone, o: o,
    signIns: function () { return signIns; },
    /* the timers the page set with this delay (0: "at once" ones such as the address check) */
    run: function (ms) { var due = timers.filter(function (t) { return t.ms === ms; }); timers = timers.filter(function (t) { return t.ms !== ms; }); due.forEach(function (t) { t.fn(); }); },
    rows: function () { return $('table-body').querySelectorAll('[data-row]').map(function (tr) { return tr.getAttribute('data-row'); }); },
    tabs: function () { var t = {}; $('status-tabs').querySelectorAll('[data-tab]').forEach(function (b) { t[b.getAttribute('data-tab')] = b.querySelector('.tc').textContent; }); return t; },
    more: function () { var t = {}; $('more-menu').querySelectorAll('[data-special]').forEach(function (b) { t[b.getAttribute('data-special')] = b.querySelector('.mono').textContent; }); return t; },
    tab: function (name) { $('status-tabs').querySelectorAll('[data-tab]').filter(function (b) { return b.getAttribute('data-tab') === name; })[0].click(); },
    view: function (name) { $('more-menu').querySelectorAll('[data-special]').filter(function (b) { return b.getAttribute('data-special') === name; })[0].click(); },
    /* a row's ⋯ menu: its items as [action, words, locked]; act() opens the menu and clicks one */
    menu: function (id) {
      var m = $('rowmenu-row-' + id);
      return m ? m.querySelectorAll('[data-row-action]').map(function (b) { return [b.getAttribute('data-row-action'), b.textContent.trim(), b.getAttribute('aria-disabled') === 'true']; }) : null;
    },
    act: function (id, action) {
      var btn = $('table-body').querySelectorAll('[data-row-menu-btn]').filter(function (b) { return b.getAttribute('data-row-menu-btn') === 'rowmenu-row-' + id; })[0];
      btn.click();
      var item = $('rowmenu-row-' + id).querySelectorAll('[data-row-action]').filter(function (b) { return b.getAttribute('data-row-action') === action; })[0];
      item.click();
      return btn;
    },
    dialog: function () { return $('dlg-card'); },
    toasts: function () { return $('toast-region').children.map(function (t) { return t.textContent; }); },
    toastButton: function (label) {
      var all = [];
      $('toast-region').children.forEach(function (t) { t.querySelectorAll('button').forEach(function (b) { if (b.textContent === label) all.push(b); }); });
      return all[all.length - 1] || null;
    },
    calls: function (method, re) { return log.filter(function (c) { return c.method === method && re.test(c.url); }); },
    kpi: function () { return $('kpi-grid').querySelectorAll('.kpi-num').map(function (k) { return k.textContent; }); },
    table: function () { return $('table-body').textContent.replace(/\s+/g, ' ').trim(); }
  };
  return S;
}

async function main() {
  /* ======== the row menus (UX-016) ======== */
  var S = page();
  await flush();
  check('the Active tab lists the running event', JSON.stringify(S.rows()) === JSON.stringify(['live-summit']), S.rows());
  /* (B10, UX-031: a published event's menu also has QR codes) */
  check('UX-016 an Active row: Event setup, Clone event, Copy event link, QR codes, Delete event; no "Mark as completed"',
    JSON.stringify(S.menu('live-summit').map(function (x) { return x[0]; })) === JSON.stringify(['setup', 'duplicate', 'copylink', 'qr', 'delete']) &&
    S.menu('live-summit').every(function (x) { return x[2] === false; }) && /Delete event/.test(S.$('rowmenu-row-live-summit').innerHTML) &&
    / danger"/.test(S.$('rowmenu-row-live-summit').innerHTML), S.menu('live-summit'));
  check('UX-022 the "Updated" button says when the list was read', /^Updated \d/.test(S.$('sync-label').textContent), S.$('sync-label').textContent);
  check('UX-022 the top bar has Events only', S.$('main-nav-links').querySelectorAll('a').length === 1 && S.$('main-nav-links').textContent.trim() === 'Events' &&
    S.$('main-nav-links').querySelector('a').getAttribute('aria-current') === 'page');
  /* B10 (UX-018): Drafts is a tab with its count, no longer in the ⋯ menu */
  check('UX-034 the ⋯ menu: Deleted Events with its count, no Cancelled (nothing is cancelled); Drafts is a tab', JSON.stringify(S.more()) === JSON.stringify({ deleted: '1' }) && S.tabs().draft === '1', [S.more(), S.tabs()]);
  check('UX-025 the table has no Payment column, five columns on All portals with the Portal one', S.$('table-wrap').querySelectorAll('th').length === 6 &&
    S.$('table-wrap').textContent.indexOf('Payment') === -1);

  /* ======== Clone ======== */
  var opener = S.act('live-summit', 'duplicate');
  var dlg = S.dialog();
  check('UX-016 Clone opens a window: its title, what is and is not copied, name and address filled in', !!dlg && dlg.getAttribute('role') === 'dialog' && dlg.getAttribute('aria-modal') === 'true' &&
    S.$('dlg-title').textContent === 'Clone “Live Summit”' && /new draft on ETCIO/.test(S.$('dlg-sub').textContent) && /registrations, figures and live page are not/.test(S.$('dlg-sub').textContent) &&
    S.$('clone-name').value === 'Live Summit (Copy)' && S.$('clone-slug').value === 'live-summit-copy', dlg && dlg.textContent);
  check('…the focus starts on the name', S.doc.activeElement === S.$('clone-name'));
  S.run(0); await flush();
  check('…the address is checked at once (GET /api/event/slug-available), and said to be free with where it will be',
    S.calls('GET', /slug-available\?slug=live-summit-copy$/).length === 1 && /Free: the copy will be at http:\/\/localhost\/e\/live-summit-copy/.test(S.$('clone-slug-hint').textContent), S.$('clone-slug-hint').textContent);
  S.$('clone-name').value = 'Live Summit 2027'; S.dom.fire(S.$('clone-name'), 'input');
  check('…the address follows the name until the address is typed into', S.$('clone-slug').value === 'live-summit-2027');
  S.run(350); await flush();
  check('…and is checked again after a pause', S.calls('GET', /slug-available\?slug=live-summit-2027$/).length === 1);
  var before = S.calls('GET', /^\/api\/events$/).length;
  S.$('dlg-ok').click();
  check('…Clone event shows it is working, and every control waits', S.$('dlg-ok').disabled === true && /^Cloning…/.test(S.$('dlg-ok').textContent) && S.$('dlg-cancel').disabled === true && S.$('clone-name').disabled === true);
  await flush();
  var clone = S.calls('POST', /^\/api\/event\/clone$/);
  check('UX-016 POST /api/event/clone with the source, the address and the name', clone.length === 1 && JSON.stringify(clone[0].body) === JSON.stringify({ sourceEventId: 'live-summit', eventId: 'live-summit-2027', name: 'Live Summit 2027' }), clone);
  check('…the window closes, the list is read again from the server', !S.dialog() && S.calls('GET', /^\/api\/events$/).length === before + 1);
  check('…a toast says where the copy is, with Open copy', S.toasts().some(function (t) { return /“Live Summit 2027” is ready in Drafts\.Open copy/.test(t); }), S.toasts());
  S.toastButton('Open copy').click();
  check('…Open copy opens the copy\'s console', S.nav[S.nav.length - 1] === 'edit-event.html?event=live-summit-2027', S.nav);
  S.tab('draft');
  check('…and the copy is in Drafts (from the server, not made up on the page)', S.rows().indexOf('live-summit-2027') !== -1 && S.tabs().draft === '2', [S.rows(), S.tabs()]);
  check('UX-034 the Draft view has no Insights', S.$('insights-section').hidden === true);
  S.tab('active');

  /* a taken address: the next free one at first; then the server's 409 with a suggestion to use */
  S = page({ taken: ['upcoming-one-copy'] });
  await flush();
  S.tab('upcoming');
  S.act('up-one', 'duplicate');
  S.run(0); await flush(); S.run(0); await flush();
  check('Clone: an address already in use at first is quietly swapped for the next free one', S.$('clone-slug').value === 'upcoming-one-copy-2' && /Free:/.test(S.$('clone-slug-hint').textContent), [S.$('clone-slug').value, S.$('clone-slug-hint').textContent]);
  S.$('clone-slug').value = 'Bad Address!'; S.dom.fire(S.$('clone-slug'), 'input'); S.run(350); await flush();
  check('…a typed address of the wrong shape says so, with the right shape to use', S.$('clone-slug-hint').className.indexOf('is-bad') !== -1 && /single hyphens only/.test(S.$('clone-slug-hint').textContent) &&
    !!S.$('clone-slug-hint').querySelector('[data-use-slug="bad-address"]'), S.$('clone-slug-hint').innerHTML);
  S.$('dlg-ok').click(); await flush();
  check('…and Clone does not send it', S.calls('POST', /clone/).length === 0 && /single hyphens only/.test(S.$('dlg-error').textContent) && S.$('dlg-error').hidden === false);
  S.o.taken.push('up-one-again');
  S.$('clone-slug').value = 'up-one-again'; S.dom.fire(S.$('clone-slug'), 'input');
  S.$('dlg-ok').click(); await flush();
  check('…a 409 from the server (taken meanwhile): the window stays, says so, and offers the free one', !!S.dialog() && S.$('dlg-ok').disabled === false &&
    /already used by another event/.test(S.$('clone-slug-hint').textContent) && !!S.$('clone-slug-hint').querySelector('[data-use-slug="up-one-again-2"]'), S.$('clone-slug-hint').innerHTML);
  S.$('clone-slug-hint').querySelector('[data-use-slug="up-one-again-2"]').click();
  check('…Use it puts that address in', S.$('clone-slug').value === 'up-one-again-2');
  S.dom.key(S.$('dlg-card'), 'Escape');
  check('…Escape closes the window, and the focus goes back to the row\'s ⋯ button', !S.dialog() && S.doc.activeElement && S.doc.activeElement.getAttribute('data-row-menu-btn') === 'rowmenu-row-up-one');
  S = page({ cloneFail: { status: 500, body: { error: 'The event could not be copied, and nothing was created. Please try again.' } } });
  await flush();
  S.act('live-summit', 'duplicate'); S.run(0); await flush();
  S.$('dlg-ok').click(); await flush();
  check('Clone: a server failure is said in the window, which stays open with Clone ready again', !!S.dialog() && /nothing was created/.test(S.$('dlg-error').textContent) && S.$('dlg-ok').disabled === false && S.$('dlg-ok').textContent === 'Clone event');

  /* ======== Delete, with Undo ======== */
  S = page();
  await flush();
  S.act('live-summit', 'delete');
  check('UX-016 Delete asks first, naming the event: "Move “Live Summit” to Deleted?"', !!S.dialog() && S.$('dlg-title').textContent === 'Move “Live Summit” to Deleted?' && S.calls('DELETE', /./).length === 0);
  var text = S.dialog().textContent;
  check('…it says what happens: restorable, the live site stops at its address, its registrations are kept, shared preview links stop',
    /where an approver can restore it/.test(text) && /Its live site stops showing at once: http:\/\/localhost\/e\/live-summit/.test(text) && /Its 12 registrations are kept/.test(text) && /shared preview links stop/.test(text), text);
  check('…the red button reads "Move to Deleted", and the focus starts on Cancel', /btn-danger/.test(S.$('dlg-ok').className) && S.$('dlg-ok').textContent === 'Move to Deleted' && S.doc.activeElement === S.$('dlg-cancel'));
  S.$('dlg-cancel').click();
  check('…Cancel deletes nothing', !S.dialog() && S.calls('DELETE', /./).length === 0 && S.rows().indexOf('live-summit') !== -1);
  S.act('live-summit', 'delete');
  S.$('dlg-ok').click();
  check('…Move to Deleted shows it is working', S.$('dlg-ok').textContent === 'Deleting…' && S.$('dlg-cancel').disabled === true);
  S.dom.key(S.$('dlg-card'), 'Escape');
  check('…and cannot be closed half-way', !!S.dialog());
  await flush();
  check('UX-016 DELETE /api/event?eventId=live-summit, then the list is read again', S.calls('DELETE', /^\/api\/event\?eventId=live-summit$/).length === 1 && !S.dialog() && S.gone[0].id === 'live-summit');
  check('…the row has left Active and Deleted Events counts it', S.rows().indexOf('live-summit') === -1 && S.more().deleted === '2', [S.rows(), S.more()]);
  check('…a toast says where it went, with Undo', S.toasts().some(function (t) { return t === '“Live Summit” moved to Deleted Events.Undo'; }), S.toasts());
  S.toastButton('Undo').click(); await flush();
  check('…Undo is a real Restore (POST /api/event/restore) and the event is back in Active', S.calls('POST', /^\/api\/event\/restore$/).length === 1 && S.rows().indexOf('live-summit') !== -1 && S.more().deleted === '1', S.rows());
  check('…and says so, with Show it', S.toasts().some(function (t) { return t === '“Live Summit” is back in Active.Show it'; }), S.toasts());
  S = page({ deleteFail: 500 });
  await flush();
  S.act('live-summit', 'delete'); S.$('dlg-ok').click(); await flush();
  check('Delete: a server failure is said in the window, nothing moves, Move to Deleted is ready again', !!S.dialog() && /could not be deleted/.test(S.$('dlg-error').textContent) &&
    S.rows().indexOf('live-summit') !== -1 && S.$('dlg-ok').disabled === false);

  /* ======== Deleted Events and Restore (UX-034) ======== */
  S = page();
  await flush();
  S.view('deleted');
  check('UX-034 Deleted Events is filled from GET /api/events?deleted=1', S.calls('GET', /^\/api\/events\?deleted=1$/).length === 1 && JSON.stringify(S.rows()) === JSON.stringify(['gone-one']), S.rows());
  check('…its row says when and by whom, and its name opens nothing (the console cannot open a deleted event)', /Deleted 01 Nov 2026 by boss@timesinternet\.in/.test(S.table()) &&
    !S.$('table-body').querySelector('a.ev-link') && !!S.$('table-body').querySelector('span.ev-link'), S.table());
  check('…its ⋯ menu has Restore only (no Delete permanently)', JSON.stringify(S.menu('gone-one')) === JSON.stringify([['restore', 'Restore', false]]), S.menu('gone-one'));
  check('…no Insights here either, and the banner says what can be done', S.$('insights-section').hidden === true && /Showing Deleted events · restore any of them from its ⋯ menu/.test(S.$('special-banner').textContent), S.$('special-banner').textContent);
  S.act('gone-one', 'restore');
  check('UX-016 Restore asks first: its site goes live again at its address, and which list it comes back to',
    S.$('dlg-title').textContent === 'Restore “Gone One”?' && /Its site goes live again at http:\/\/localhost\/e\/gone-one/.test(S.dialog().textContent) && /It will be in Upcoming\./.test(S.dialog().textContent), S.dialog().textContent);
  S.$('dlg-ok').click(); await flush();
  check('…POST /api/event/restore { eventId }, the row leaves Deleted Events, and the toast offers Show it', S.calls('POST', /restore/).length === 1 && JSON.stringify(S.calls('POST', /restore/)[0].body) === '{"eventId":"gone-one"}' &&
    S.rows().length === 0 && S.toasts().some(function (t) { return t === '“Gone One” is back in Upcoming.Show it'; }), [S.rows(), S.toasts()]);
  check('…the empty Deleted Events says what it is for', /No deleted events/.test(S.table()) && /An event an approver deletes waits here, and can be restored\./.test(S.table()) && !/Create Event/.test(S.table()), S.table());
  S.toastButton('Show it').click();
  check('…Show it opens Upcoming, where it now is', S.rows().indexOf('gone-one') !== -1 && S.$('status-tabs').querySelector('[aria-selected="true"]').getAttribute('data-tab') === 'upcoming', S.rows());

  /* ======== approvers only (owner decision #4) ======== */
  S = page({ approvers: ['boss@timesinternet.in'] });
  await flush();
  var items = S.menu('live-summit');
  /* Delete is found by its action: B10 (UX-031) put QR codes before it on a published event's menu */
  var del = items.filter(function (x) { return x[0] === 'delete'; })[0];
  check('a team member who is not an approver: Delete stays in the menu, muted, "Approvers only", not red',
    !!del && del[2] === true && /Approvers only/.test(del[1]) && /is-locked/.test(S.$('rowmenu-row-live-summit').innerHTML) && !/ danger"/.test(S.$('rowmenu-row-live-summit').innerHTML), items);
  check('…Clone stays open to everyone', items[1][0] === 'duplicate' && items[1][2] === false);
  S.act('live-summit', 'delete');
  check('…clicking it opens nothing, sends nothing, and says who can', !S.dialog() && S.calls('DELETE', /./).length === 0 &&
    S.toasts().indexOf('Only an approver (boss@timesinternet.in) can delete or restore an event.') !== -1, S.toasts());
  S.view('deleted');
  check('…Restore in Deleted Events is the same, and the banner says an approver can restore them', S.menu('gone-one')[0][2] === true && /an approver can restore them/.test(S.$('special-banner').textContent));
  S = page({ approvers: ['Asha.Rao@timesinternet.in'] });
  await flush();
  check('an approver (any case) gets Delete in red', S.menu('live-summit').filter(function (x) { return x[0] === 'delete'; })[0][2] === false && / danger"/.test(S.$('rowmenu-row-live-summit').innerHTML));
  /* the approvers could not be read: both stay offered, the server decides, and its 403 is said and corrects the menu */
  S = page({ approvers: ['boss@timesinternet.in'], approvalsFail: true });
  await flush();
  check('approvers not known: Delete is offered (the server decides)', S.menu('live-summit')[3][2] === false);
  S.act('live-summit', 'delete'); S.$('dlg-ok').click(); await flush();
  check('…the server\'s refusal is said in the window, and nothing moves', !!S.dialog() && S.$('dlg-error').textContent === 'Only an approver (boss@timesinternet.in) can delete an event.' && S.rows().indexOf('live-summit') !== -1, S.$('dlg-error').textContent);
  S.$('dlg-cancel').click();
  check('…and from then on the menu marks it "Approvers only"', S.menu('live-summit').filter(function (x) { return x[0] === 'delete'; })[0][2] === true);

  /* ======== a failed load (UX-027) ======== */
  S = page({ liveFail: 500 });
  await flush();
  check('UX-027 a 5xx: "Our server had a problem", with Try again, where the list would be', /Our server had a problem/.test(S.table()) && /Nothing has been lost/.test(S.table()) && !!S.$('table-body').querySelector('[data-load-retry]'), S.table());
  check('…no "No active events", no "Create your first event", no Create Event button there', !/No active events|first event|Create Event/.test(S.table()));
  check('…no counts: a dash on every tab and in the ⋯ menu', JSON.stringify(S.tabs()) === JSON.stringify({ draft: '–', upcoming: '–', active: '–', completed: '–' }) && JSON.stringify(S.more()) === JSON.stringify({ deleted: '–' }), [S.tabs(), S.more()]);
  check('…no Insights and no Latest activity, and no banner on top of it', S.$('insights-section').hidden === true && S.$('lower-panels').hidden === true && S.$('error-slot').innerHTML === '');
  check('…the "Updated" button says it did not load', S.$('sync-label').textContent === 'Not loaded');
  S.o.liveFail = 0;
  S.$('table-body').querySelector('[data-load-retry]').click(); await flush();
  check('…Try again loads it, and everything comes back', JSON.stringify(S.rows()) === JSON.stringify(['live-summit']) && S.$('insights-section').hidden === false && S.$('lower-panels').hidden === false && S.tabs().upcoming === '2', S.tabs());
  S = page({ liveFail: 401 });
  await flush();
  check('UX-027 a 401: "Please sign in again", with Sign in', /Please sign in again/.test(S.table()) && !!S.$('table-body').querySelector('[data-load-signin]'));
  S.$('card-list').querySelector('[data-load-signin]').click();
  check('…Sign in (from the phone cards too) goes to the sign-in page', S.signIns() === 1);
  S = page({ liveFail: 'net', offline: true });
  await flush();
  check('UX-027 offline: "You’re offline"', /You’re offline/.test(S.table()), S.table());
  S.o.liveFail = 0; S.ctx.navigator.onLine = true;
  (S.dom.winListeners.online || []).forEach(function (fn) { fn({}); }); await flush();
  check('…back online, the events load by themselves', JSON.stringify(S.rows()) === JSON.stringify(['live-summit']));
  S = page({ liveFail: 'net' });
  await flush();
  check('UX-027 the server not reached while online: says so', /The server could not be reached/.test(S.table()));
  S = page({ deletedFail: true });
  await flush();
  check('only the deleted list failed: the events are all there, Deleted Events counts a dash', JSON.stringify(S.rows()) === JSON.stringify(['live-summit']) && S.more().deleted === '–', S.more());
  S.view('deleted');
  check('…and Deleted Events says it could not be loaded, with Try again', /Deleted Events could not be loaded/.test(S.table()) && !!S.$('table-body').querySelector('[data-empty-retry]'));
  S.o.deletedFail = false;
  S.$('table-body').querySelector('[data-empty-retry]').click(); await flush();
  check('…Try again reads it', JSON.stringify(S.rows()) === JSON.stringify(['gone-one']), S.rows());

  /* ======== the empty states (UX-035) and views (UX-034) ======== */
  S = page({ items: baseItems().filter(function (e) { return e.id !== 'live-summit'; }), deleted: [] });
  await flush();
  /* B10 (UX-018): with nothing live, a page opened with no address and nothing remembered lands on Upcoming */
  check('UX-018 nothing live: the page opens on Upcoming, not an empty Active', S.$('status-tabs').querySelector('[aria-selected="true"]').getAttribute('data-tab') === 'upcoming' && S.rows().length === 2, S.rows());
  S.tab('active');
  check('UX-035 an empty Active tab: "Nothing is live right now", with Show upcoming (2), no "Create your first event"',
    /Nothing is live right now/.test(S.table()) && /Events show here while they run\./.test(S.table()) && /Show upcoming \(2\)/.test(S.table()) && !/first event/.test(S.table()), S.table());
  S.$('table-body').querySelector('[data-empty-tab]').click();
  check('…Show upcoming opens Upcoming', S.$('status-tabs').querySelector('[aria-selected="true"]').getAttribute('data-tab') === 'upcoming' && S.rows().length === 2);
  S.tab('completed');
  check('UX-035 an empty Completed tab: "Events move here after their end date.", no Create Event', /No completed events/.test(S.table()) && /Events move here after their end date\./.test(S.table()) && !/Create Event/.test(S.table()), S.table());
  S.$('search-input').value = 'nothing like it'; S.dom.fire(S.$('search-input'), 'input');
  var empty = S.$('table-body').innerHTML;
  check('UX-035 "No events match" has the search icon, not the "+"', /No events match/.test(empty) && /width="40"[^>]*>[^]*?M21 21l-4\.3-4\.3/.test(empty) && empty.indexOf('M12 8v8M8 12h8') === -1, empty.slice(0, 400));
  S = page({ items: [], deleted: [] });
  await flush();
  check('UX-035 "Create your first event" only when there is no event at all', /Create your first event/.test(S.table()) && /It takes about ten minutes\./.test(S.table()) && !!S.$('table-body').querySelector('a.btn-primary'));
  S = page({ items: baseItems().concat([{ id: 'called-off', name: 'Called Off', category: 'ip', published: true, status: 'cancelled', portal: 'cio', counters: {} }]) });
  await flush();
  check('UX-034 Cancelled Events is offered only while an event is cancelled', S.more().cancelled === '1');
  S.view('cancelled');
  check('…and lists it, with no Insights', JSON.stringify(S.rows()) === JSON.stringify(['called-off']) && S.$('insights-section').hidden === true);

  /* ======== the Insights cards follow the list (UX-039) ======== */
  S = page();
  await flush();
  S.tab('upcoming');
  check('UX-039 no search: every Upcoming event counted, and the line says so', JSON.stringify(S.kpi()) === JSON.stringify(['80', '8', '—']) && S.$('insights-scope').textContent === 'All 2 upcoming events', [S.kpi(), S.$('insights-scope').textContent]);
  S.$('search-input').value = 'Pune'; S.dom.fire(S.$('search-input'), 'input');
  check('UX-039 a search showing one event: the cards count only it, and say "for the one event shown"', JSON.stringify(S.rows()) === JSON.stringify(['up-two']) &&
    JSON.stringify(S.kpi()) === JSON.stringify(['50', '5', '—']) && S.$('insights-scope').textContent === 'For the one event shown (search and filters applied)', [S.kpi(), S.$('insights-scope').textContent]);
  S.$('btn-clear-search').click();
  check('…clearing it counts the whole tab again', JSON.stringify(S.kpi()) === JSON.stringify(['80', '8', '—']));
  S = page({ working: 'cio' });
  await flush();
  S.tab('upcoming');
  check('…on one portal the line names it', S.$('insights-scope').textContent === 'All 2 upcoming events on ETCIO', S.$('insights-scope').textContent);

  /* ======== the "Updated" button really reads the events again (UX-022) ======== */
  S = page();
  await flush();
  var reads = S.calls('GET', /^\/api\/events$/).length;
  S.live.push({ id: 'new-one', name: 'New One', category: 'ip', published: true, start: iso(NOW - DAY), end: iso(NOW + DAY), portal: 'cio', counters: {} });
  S.$('btn-sync').click();
  check('UX-022 "Updated" reads the events again, and says so while it does', S.$('sync-label').textContent === 'Updating…' && S.$('btn-sync').getAttribute('aria-busy') === 'true');
  await flush();
  check('…GET /api/events once more, the new event is in the list, and the time is shown again', S.calls('GET', /^\/api\/events$/).length === reads + 1 && S.rows().indexOf('new-one') !== -1 && /^Updated \d/.test(S.$('sync-label').textContent));
  check('…with a toast that says the list is up to date', S.toasts().some(function (t) { return /^The list is up to date \(read at /.test(t); }), S.toasts());

  console.log('events-dashboard-actions: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
main().catch(function (e) { console.error('CRASH ' + (e && e.stack || e)); process.exit(1); });
