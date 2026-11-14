/* node functions/lib/events-dashboard-finding.test.js — batch B10 on the events dashboard (Event_Listing.html): finding
   and opening events.
     UX-018  Drafts is a tab with its count (Drafts, Upcoming, Active, Completed), no longer behind ⋯; "#tab=draft" and
             "#…&view=draft" open it; the tab picked is remembered in this browser, and the list this browser tab last
             showed is what "Back to events" (a plain link from the console, editor and Create Event) comes back to; with
             nothing to go on the page opens on the first of Active, Upcoming and Drafts that has events; the Deleted
             banner goes back to the tab it came from;
     UX-019  a search counts its matches on every tab and ⋯ view, and an empty tab says where the matches are, each a
             button that opens it (or on other portals, with Show all portals); Clear search and Clear filters each
             clear only their own;
     UX-020  a click on the name follows its link (the venue tooltip is for hover and focus only, with no "—" for a
             missing city), and a tap anywhere on a card opens the event;
     UX-021  (fixed before B10) the row ⋯ menu is pinned to the screen from <body>, flipped above its button near the
             bottom, and closed on scroll;
     UX-029  QR codes, Need help? and the phone Filters sheet are real dialogs (role, name, focus in, Tab kept inside,
             Escape, focus back); the sortable headers are buttons with aria-sort; touch targets of 44 px on phones;
     UX-030  dates as entered: ranges, no made-up time, a month or "to be announced" in Create Event's words;
     UX-031  one Filters button on phones, no squeezed nav, QR codes from a published row's ⋯ menu at /e/<id>;
     UX-033  undated events sort after the dated ones, a month by its first day;
     UX-036  long names wrap; a card's buttons have their own row;
     UX-037  List or Cards remembered, 20 a page, a Last edited sort that Drafts opens on;
     UX-041  Upcoming in a calm blue (--info), ET red kept for danger.
   And ETB2B AI's Delete and Restore sentences (B07) still name controls that are where they say.
   Part 1 reads the files; part 2 runs the page's own script in node's vm over fixtures/mini-dom.js with the real
   edit-event-core.js and event-lifecycle.js and an in-memory server; part 3, when this machine has Chrome and
   puppeteer-core (as events-dashboard-standards.test.js finds them), lays the page out in a real browser at 1440 and
   390 px on fixtures. No network, no production, no AI. Exits 1 on any failure. */
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
var CSS = PAGE.slice(PAGE.indexOf('<style>'), PAGE.indexOf('</style>'));
var BODY = PAGE.slice(PAGE.indexOf('<header class="main-nav">'), PAGE.indexOf('<script src="theme-toggle.js">'));
var ROSTER = require('./et-events').portalList();

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function flush(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 20); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }
function response(status, json) {
  var t = json === undefined ? '' : JSON.stringify(json);
  return { status: status, ok: status >= 200 && status < 300, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(json === undefined ? {} : JSON.parse(t)); } };
}
/* the CSS block of the phone rules (max-width:880px), and of the 640 px one */
function mediaBlock(q) {
  var at = CSS.indexOf('@media (' + q + ')');
  if (at === -1) return '';
  var i = CSS.indexOf('{', at), depth = 0;
  for (; i < CSS.length; i++) { if (CSS[i] === '{') depth++; else if (CSS[i] === '}') { depth--; if (!depth) break; } }
  return CSS.slice(at, i + 1);
}

/* ======================================================================================================
   1. the files
   ====================================================================================================== */
check('the inline script is found', INLINE.length > 50000);
check('the inline script is ES5 (no let, const, arrows or template strings)', !/\blet\s|\bconst\s/.test(CODE) && CODE.indexOf('=>') === -1 && CODE.indexOf('`') === -1);
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the word check above still runs */ }
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(INLINE, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n')[0]; } })();
  check('the inline script is ES5 by esbuild', es5 === true, es5);
}
/* UX-018 */
check('UX-018 four tabs, in the order an event moves: Drafts, Upcoming, Active, Completed', /var TABS = \[\['draft','Drafts'\],\['upcoming','Upcoming'\],\['active','Active'\],\['completed','Completed'\]\];/.test(INLINE));
check('UX-018 no Draft Events in the ⋯ menu any more', CODE.indexOf("item('draft'") === -1 && CODE.indexOf("'Draft Events'") === -1);
check('UX-018 the console, the site editor and Create Event go back with a plain link to the list, which then opens where it was',
  /<a class="back-btn" href="Event_Listing\.html">/.test(fs.readFileSync(path.join(ROOT, 'edit-event.html'), 'utf8')) &&
  /<a class="back-btn" href="Event_Listing\.html">/.test(fs.readFileSync(path.join(ROOT, 'custom_editor.html'), 'utf8')) &&
  fs.readFileSync(path.join(ROOT, 'create-event.html'), 'utf8').indexOf("window.location.href = 'Event_Listing.html'") !== -1 &&
  fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8').indexOf("var LISTING_URL = 'Event_Listing.html';") !== -1);
check('UX-018 every storage read and write is wrapped (a private window must not stop the page)',
  /function memoGet\(store, key\)\{\n\s*try \{/.test(INLINE) && /function memoSet\(store, key, value\)\{\n\s*try \{/.test(INLINE) &&
  !/(localStorage|sessionStorage)\s*\./.test(CODE));
/* UX-029 */
var phone = mediaBlock('max-width:880px'), narrow = mediaBlock('max-width: 640px');
check('UX-018 the four tabs sit on the left of their bar, not floated in the middle where they ran into the Sort menu',
  /\.section-bar-left\{ display:flex; align-items:flex-end; align-self:stretch;/.test(CSS) && !/\.section-bar-left\{[^}]*position:absolute/.test(CSS) && CSS.indexOf('@media (max-width:1100px)') === -1);
check('UX-029 the sortable headers are buttons', (PAGE.match(/<th class="sortable" data-sort="(start|visitors|registrations)"><button type="button" class="th-sort">/g) || []).length === 3);
check('UX-029 touch targets of 44 px on phones: icon buttons, toolbar buttons, menu items, pages, the sort menu, the tabs',
  /\.icon-btn\{ width:44px; height:44px; \}/.test(phone) && /\.toolbar-btn, \.sync-btn, \.sort-pick select\{ min-height:44px; \}/.test(phone) && /\.popover-item\{ min-height:44px; \}/.test(phone) &&
  /\.pagination button\{ min-width:44px; height:44px; \}/.test(phone) && /\.tabs-row button\{[^}]*min-height:44px;/.test(phone) && /\.search-box \.clear-btn::after\{ content:''; position:absolute; inset:-14px; \}/.test(phone), phone.slice(0, 300));
/* UX-031 */
check('UX-031 every desk-only part of the toolbar is hidden on phones, its wrappers too', /\.toolbar \.desk-only\{ display:none; \}/.test(phone) && phone.indexOf('.toolbar-btn.desk-only') === -1);
/* since Speakers and Sponsors joined Events (11 Nov) the header has no room for them below 960px (Sponsors was cut in
   half at 768px, and a phone could not reach either): there the same links are a row of their own under the bar */
var midNav = mediaBlock('max-width: 959px');
check('UX-031 the header nav is not drawn below 960px, phone width included: its links are the row under the bar (#page-nav) there',
  /\.main-nav-scroll\{ display:none; \}/.test(midNav) && /\.page-nav\{ display:flex;/.test(midNav) && /\.page-nav\{ display:none; \}/.test(PAGE) &&
  /<nav class="page-nav" id="page-nav" aria-label="Pages"><\/nav>/.test(PAGE) && /if \(\$\('page-nav'\)\) \$\('page-nav'\)\.innerHTML = links;/.test(PAGE), midNav.slice(0, 200));
check('UX-031 the header\'s page links never shrink (nothing cut), the portal name gives way with … instead', /\.main-nav-scroll\{ flex:0 0 auto;/.test(PAGE) && /\.main-nav-portals\{ flex:0 1 auto; min-width:0; \}/.test(PAGE) &&
  /\.mp-label\{ min-width:0; overflow:hidden; text-overflow:ellipsis; \}/.test(PAGE));
/* (a comment may still say what the address used to be) */
check('UX-031 the made-up domain is gone from the page', PAGE.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').indexOf('events.economictimes.indiatimes.com') === -1 &&
  CODE.indexOf('eventSlug') === -1 && /C\.publicUrl\(e\)/.test(CODE));
/* UX-036 */
check('UX-036 a long name wraps anywhere', /\.ev-name-main \.ev-link\{[^}]*overflow-wrap:anywhere;/.test(CSS));
/* UX-037 */
check('UX-037 20 events a page', /\n  var PAGE_SIZE = 20;/.test(INLINE));
/* UX-041 */
function block(re) { var at = CSS.search(re); return at === -1 ? '' : CSS.slice(at, CSS.indexOf('}', at)); }
check('UX-041 --info and --info-soft in light, in dark (system) and in dark (chosen)', /--info: #1D5FA3;/.test(block(/:root\{/)) && /--info:#7EB6E8;/.test(block(/:root:not\(\[data-theme="light"\]\)\{/)) &&
  /--info:#7EB6E8;/.test(block(/:root\[data-theme="dark"\]\{/)) && /--info-soft/.test(block(/:root\{/)));
check('UX-041 Upcoming\'s dot, left bar and "In 3 days" use --info, not ET red', /\.status-dot\.upcoming\{ background:var\(--info\); \}/.test(CSS) &&
  /tr\.st-upcoming td:first-child\{ box-shadow:inset 3px 0 0 var\(--info\); \}/.test(CSS) && /\.ev-date-cell \.d3\{[^}]*color:var\(--info\);/.test(CSS) && !/st-upcoming[^}]*--accent/.test(CSS));
/* contrast of the blue on the page's grounds (WCAG AA for text and for the 3 px bar) */
function lum(hex) { var c = hex.replace('#', ''); return [0, 2, 4].map(function (i) { var v = parseInt(c.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0); }
function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
check('UX-041 the blue reads at AA on the light and dark surfaces', ratio('#1D5FA3', '#FFFFFF') >= 4.5 && ratio('#1D5FA3', '#F1F0EC') >= 4.5 && ratio('#7EB6E8', '#1B1A16') >= 4.5 && ratio('#7EB6E8', '#232219') >= 4.5);
/* the new rules' colours are the page's own tokens */
['.th-sort{', '.ev-card-actions{', '.sort-pick{', '.sort-pick select{', '.v.v-wrap{'].forEach(function (sel) {
  var at = CSS.indexOf(sel), rule = at === -1 ? '' : CSS.slice(at, CSS.indexOf('}', at));
  check('the ' + sel.replace(/\{$/, '') + ' rule uses colour tokens only', at !== -1 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rule), rule);
});
/* ETB2B AI (B07's sentences): the controls they name are where they say, after B10 moved Drafts out of ⋯ */
var BOT = require('./dash-bot');
var REF = BOT._test && BOT._test.REFUSALS ? BOT._test.REFUSALS : null;
if (!REF) { var botSrc = fs.readFileSync(path.join(__dirname, 'dash-bot.js'), 'utf8'); REF = { delete: { text: (/delete: \{ text: '([^']+)'/.exec(botSrc) || [])[1] }, restore: { text: (/restore: \{ text: '([^']+)'/.exec(botSrc) || [])[1] } }; }
check('ETB2B AI: its Delete sentence names the row\'s More actions and Delete event, both still there', /More actions \(⋯\), then Delete event/.test(REF.delete.text) &&
  /aria-label="More actions"/.test(CODE) && CODE.indexOf("['delete', IC.trash, 'Delete event', true, locked]") !== -1, REF.delete);
check('ETB2B AI: its Restore sentence names More (⋯) above the list, then Deleted Events, which stays in ⋯', /More \(⋯\) above this list, then Deleted Events, then Restore on its row/.test(REF.restore.text) &&
  CODE.indexOf("item('deleted', IC.trash2, 'Deleted Events'") !== -1 && /id="btn-more" aria-haspopup="true" aria-label="More"/.test(PAGE), REF.restore);

/* ======================================================================================================
   2. the page, run
   ====================================================================================================== */
var NOW = Date.now(), DAY = 86400000;
function iso(ms) { return new Date(ms).toISOString(); }
/* an India wall-clock time n days from now, as Create Event saves it ("2026-11-20T09:30", no zone) */
function wall(n, hhmm) { return new Date(NOW + 330 * 60000 + n * DAY).toISOString().slice(0, 10) + 'T' + (hhmm || '09:00'); }
function dayOf(n) { return new Date(NOW + 330 * 60000 + n * DAY).toISOString().slice(0, 10); }
var ME = 'asha.rao@timesinternet.in';
function baseItems() {
  return [
    { id: 'live-summit', name: 'Live Summit', category: 'ip', published: true, start: wall(-1), end: wall(1, '18:00'), portal: 'cio', portalName: 'ETCIO', counters: { registrations: 12, views: 90 }, updatedAt: iso(NOW - 9 * DAY) },
    { id: 'up-near', name: 'QA Search Upcoming Near', category: 'ip', published: true, start: wall(3, '10:41'), end: wall(5, '18:00'), portal: 'cio', portalName: 'ETCIO', venue: 'Taj', city: 'Mumbai', counters: { registrations: 3, views: 30 }, updatedAt: iso(NOW - 5 * DAY) },
    { id: 'up-far', name: 'QA Search Upcoming Far', category: 'client', published: true, start: wall(40), end: wall(40, '18:00'), portal: 'cio', portalName: 'ETCIO', createdBy: 'bob@timesinternet.in', counters: { registrations: 5, views: 50 }, updatedAt: iso(NOW - 4 * DAY) },
    { id: 'up-month', name: 'Month Booked', category: 'ip', published: true, dateMode: 'month', dateLabel: '', portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW - 3 * DAY) },
    { id: 'up-tba', name: 'Aaa To Be Announced', category: 'ip', published: true, dateMode: 'tbd', dateLabel: 'Date to be announced', portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW - 2 * DAY) },
    { id: 'draft-old', name: 'QA Search Draft Old', category: 'awards', published: false, portal: 'cio', portalName: 'ETCIO', createdBy: ME, counters: {}, updatedAt: iso(NOW - 30 * DAY) },
    { id: 'draft-new', name: 'Draft New', category: 'ip', published: false, portal: 'cio', portalName: 'ETCIO', createdBy: ME, counters: {}, updatedAt: iso(NOW - DAY) },
    { id: 'done-one', name: 'Done One', category: 'ip', published: true, start: wall(-20), end: wall(-19), portal: 'cio', portalName: 'ETCIO', counters: { registrations: 40 }, updatedAt: iso(NOW - 15 * DAY) },
    { id: 'hr-search', name: 'QA Search On ETHRWorld', category: 'ip', published: true, start: wall(9), end: wall(9), portal: 'hr', portalName: 'ETHRWorld', counters: {}, updatedAt: iso(NOW - 6 * DAY) }
  ];
}
/* the month-booked event: a month three months on, in Create Event's words ("June 2027") */
var MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var monthAhead = new Date(NOW + 330 * 60000 + 75 * DAY);
var MONTH_LABEL = MONTH_LONG[monthAhead.getUTCMonth()] + ' ' + monthAhead.getUTCFullYear();
function baseDeleted() {
  return [{ id: 'gone-search', name: 'QA Search Gone', category: 'ip', published: true, start: wall(5), end: wall(6), portal: 'cio', portalName: 'ETCIO', deletedAt: '2026-11-01T06:00:00.000Z', deletedBy: 'boss@timesinternet.in', counters: {} }];
}

/* o: items, deleted, hash, local (localStorage map), session (sessionStorage map), working (default ETCIO, where the
   fixtures are; ETHRWorld's one event is "another portal"), noStorage, hover, width */
function page(o) {
  o = o || {};
  if (!o.working) o.working = 'cio';
  var live = (o.items || baseItems()).map(function (x) { var c = JSON.parse(JSON.stringify(x)); if (c.id === 'up-month' && !c.dateLabel) c.dateLabel = MONTH_LABEL; return c; });
  var gone = (o.deleted || baseDeleted()).map(function (x) { return JSON.parse(JSON.stringify(x)); });
  var nav = [], opened = [], timers = [], scrolled = [];
  var dom = makeDom(), d = dom.document;
  d.body.innerHTML = BODY;
  function store(mem) {
    return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
  }
  var local = o.local || {}, session = o.session || {};
  var ctx = {
    document: d, console: { log: function () {}, warn: function () {}, error: function () {} },
    navigator: { onLine: true },
    location: { hash: o.hash || '', href: 'http://localhost/Event_Listing.html' + (o.hash || ''), pathname: '/Event_Listing.html', origin: 'http://localhost', reload: function () {} },
    history: { replaceState: function (s, t, url) { if (/^#/.test(url)) ctx.location.hash = url; } },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, clearTimeout: function () {},
    requestAnimationFrame: function (fn) { fn(); return 0; },
    scrollTo: function (x) { scrolled.push(x); }, open: function (u, t) { opened.push([u, t]); },
    matchMedia: function (q) { return { matches: /hover: hover/.test(q) ? o.hover !== false : false }; },
    addEventListener: function (t, fn) { (dom.winListeners[t] = dom.winListeners[t] || []).push(fn); },
    innerWidth: o.width || 1440, innerHeight: 900,
    fetch: function (url) {
      if (url === '/api/events') return Promise.resolve(response(200, { items: live }));
      if (url === '/api/events?deleted=1') return Promise.resolve(response(200, { items: gone }));
      if (url === '/api/settings/approvals') return Promise.resolve(response(200, { approvers: [], allowSelf: false, required: true }));
      if (/^\/api\/insights\?/.test(url)) return Promise.resolve(response(200, { byDay: [], events: [] }));
      if (/^\/api\/activity\/all\?/.test(url)) return Promise.resolve(response(200, { items: [], next: null }));
      if (url === '/api/promo/analytics/all') return Promise.resolve(response(200, { available: false, backend: 'none', series: [], totals: {} }));
      return Promise.resolve(response(404, { error: 'not here' }));
    },
    RevampAuth: {
      getIdToken: function () { return Promise.resolve('token'); },
      currentUser: function () { return { uid: 'u-asha', email: ME, displayName: 'Asha Rao' }; },
      authedFetch: function () { return Promise.resolve(response(404, {})); },
      redirectToSignIn: function () {}
    },
    RevampPortals: {
      list: function () { return Promise.resolve(ROSTER.map(function (p) { return { slug: p.slug, name: p.name }; })); },
      working: function () { return Promise.resolve(o.working || 'all'); }, cachedWorking: function () { return o.working || 'all'; },
      setWorking: function (v) { return Promise.resolve(v); },
      nameOf: function (slug) { var p = ROSTER.filter(function (r) { return r.slug === slug; })[0]; return p ? p.name : ''; },
      chipHtml: function (x) { return '<span class="rvp-chip"><button type="button" data-set-portal="' + x.eventId + '">Set portal</button></span>'; },
      openSetPortal: function () {}
    }
  };
  if (o.noStorage) {
    /* a private window that refuses storage: every access throws */
    Object.defineProperty(ctx, 'localStorage', { get: function () { throw new Error('SecurityError'); } });
    Object.defineProperty(ctx, 'sessionStorage', { get: function () { throw new Error('SecurityError'); } });
  } else { ctx.localStorage = store(local); ctx.sessionStorage = store(session); }
  ctx.window = ctx;
  Object.defineProperty(ctx.location, 'href', { get: function () { return 'http://localhost/Event_Listing.html'; }, set: function (v) { nav.push(v); } });
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx, { filename: 'edit-event-core.js' });
  vm.runInContext(LIFE, ctx, { filename: 'event-lifecycle.js' });
  /* the vendored QR library the page loads before its own script (B11, UX-032: the QR code is drawn in the page) */
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'vendor', 'qrcode-generator.js'), 'utf8'), ctx, { filename: 'qrcode-generator.js' });
  vm.runInContext(INLINE, ctx, { filename: 'Event_Listing.html (inline)' });
  function $(id) { return d.getElementById(id); }
  var S = {
    ctx: ctx, dom: dom, doc: d, $: $, nav: nav, opened: opened, local: local, session: session, live: live,
    rows: function () { return $('table-body').querySelectorAll('[data-row]').map(function (tr) { return tr.getAttribute('data-row'); }); },
    cards: function () { return $('card-list').querySelectorAll('[data-card]').map(function (c) { return c.getAttribute('data-card'); }); },
    tabs: function () { var t = {}; $('status-tabs').querySelectorAll('[data-tab]').forEach(function (b) { t[b.getAttribute('data-tab')] = b.querySelector('.tc').textContent; }); return t; },
    tabOrder: function () { return $('status-tabs').querySelectorAll('[data-tab]').map(function (b) { return b.textContent.replace(/\s*\d+.*$|\s*–.*$/, '').trim(); }); },
    selected: function () { var b = $('status-tabs').querySelector('[aria-selected="true"]'); return b ? b.getAttribute('data-tab') : null; },
    tab: function (name) { $('status-tabs').querySelector('[data-tab="' + name + '"]').click(); },
    more: function () { var t = {}; $('more-menu').querySelectorAll('[data-special]').forEach(function (b) { t[b.getAttribute('data-special')] = b.querySelector('.mono').textContent; }); return t; },
    view: function (name) { $('more-menu').querySelector('[data-special="' + name + '"]').click(); },
    search: function (q) { $('search-input').value = q; dom.fire($('search-input'), 'input'); },
    table: function () { return $('table-body').textContent.replace(/\s+/g, ' ').trim(); },
    menu: function (id) { var m = $('rowmenu-row-' + id); return m ? m.querySelectorAll('[data-row-action]').map(function (b) { return b.getAttribute('data-row-action'); }) : null; },
    menuBtn: function (id) { return $('table-body').querySelector('[data-row-menu-btn="rowmenu-row-' + id + '"]'); },
    cell: function (id) { var tr = $('table-body').querySelector('[data-row="' + id + '"]'); return tr ? tr.querySelector('.ev-date-cell').textContent : null; },
    run: function (ms) { var due = timers.filter(function (t) { return t.ms === ms; }); timers = timers.filter(function (t) { return t.ms !== ms; }); due.forEach(function (t) { t.fn(); }); }
  };
  return S;
}

async function main() {
  /* ======== UX-018 the Drafts tab, the address, the landing ======== */
  var S = page();
  await flush();
  check('UX-018 the tabs: Drafts, Upcoming, Active, Completed, each with its count', same(S.tabOrder(), ['Drafts', 'Upcoming', 'Active', 'Completed']) &&
    same(S.tabs(), { draft: '2', upcoming: '4', active: '1', completed: '1' }), [S.tabOrder(), S.tabs()]);
  check('UX-018 each is a real tab button', S.$('status-tabs').getAttribute('role') === 'tablist' && S.$('status-tabs').querySelectorAll('[data-tab]').every(function (b) { return b.getAttribute('role') === 'tab' && b.getAttribute('type') === 'button'; }));
  check('UX-018 the ⋯ menu has Deleted Events (with its count) and no Draft Events', same(S.more(), { deleted: '1' }), S.more());
  check('UX-018 with nothing remembered and something live, the page opens on Active', S.selected() === 'active' && same(S.rows(), ['live-summit']), [S.selected(), S.rows()]);
  check('…and keeps a plain address', S.ctx.location.hash === '', S.ctx.location.hash);
  S.tab('draft');
  check('UX-018 the Drafts tab lists the drafts, selected, with no banner over it', S.selected() === 'draft' && same(S.rows().sort(), ['draft-new', 'draft-old']) && S.$('special-banner').innerHTML === '', [S.selected(), S.rows()]);
  check('…the address keeps it (view=draft, as ETB2B AI and old links read it)', S.ctx.location.hash === '#tab=active&view=draft', S.ctx.location.hash);
  check('…the tab picked is remembered in this browser', S.local['rv.listing.tab'] === 'draft', S.local);
  check('…and this browser tab remembers the list shown, for "Back to events"', S.session['rv.listing.where'] === '#tab=active&view=draft', S.session);
  check('UX-037 Drafts opens on Last edited, newest first', same(S.rows(), ['draft-new', 'draft-old']) && S.$('sort-select').value === 'updated', [S.rows(), S.$('sort-select').value]);
  check('UX-018 no Insights for drafts (no live site to count)', S.$('insights-section').hidden === true);
  S.tab('upcoming');
  check('UX-037 another tab goes back to its own order (Event date) when the sort was left alone', S.$('sort-select').value === 'start', S.$('sort-select').value);

  /* Back to events: a plain link, no address — the list this browser tab showed */
  S.tab('upcoming');
  S.search('near');
  var where = S.session['rv.listing.where'];
  var B = page({ local: S.local, session: S.session });
  await flush();
  check('UX-018 "Back to events" (no address) comes back to the list it left: Upcoming, with its search', where === '#tab=upcoming&q=near' && B.selected() === 'upcoming' &&
    B.$('search-input').value === 'near' && same(B.rows(), ['up-near']), [where, B.selected(), B.rows()]);
  /* a new visit (a new browser tab: no session memory) opens on the tab last picked */
  var V = page({ local: { 'rv.listing.tab': 'draft' } });
  await flush();
  check('UX-018 a new visit opens on the tab last picked (Drafts)', V.selected() === 'draft' && same(V.rows(), ['draft-new', 'draft-old']), [V.selected(), V.rows()]);
  var V2 = page({ local: { 'rv.listing.tab': 'completed' }, items: baseItems().filter(function (e) { return e.id !== 'done-one'; }) });
  await flush();
  check('UX-018 …unless that tab is empty today: then the first of Active, Upcoming, Drafts with events', V2.selected() === 'active', V2.selected());
  var V3 = page({ items: baseItems().filter(function (e) { return e.id !== 'live-summit'; }) });
  await flush();
  check('UX-018 nothing live and nothing remembered: Upcoming', V3.selected() === 'upcoming', V3.selected());
  var V4 = page({ items: baseItems().filter(function (e) { return e.published === false; }) });
  await flush();
  check('UX-018 drafts only: Drafts, so a team whose events are all drafts never lands on an empty list', V4.selected() === 'draft' && V4.rows().length === 2, [V4.selected(), V4.rows()]);
  var V5 = page({ hash: '#tab=completed', items: baseItems().filter(function (e) { return e.id !== 'done-one'; }) });
  await flush();
  check('UX-018 an address is followed exactly, even to an empty tab', V5.selected() === 'completed' && /No completed events/.test(V5.table()), V5.selected());
  var V6 = page({ hash: '#tab=draft' });
  await flush();
  check('UX-018 "#tab=draft" opens Drafts', V6.selected() === 'draft' && V6.rows().length === 2, V6.selected());
  var V7 = page({ hash: '#tab=upcoming&view=draft&q=old' });
  await flush();
  check('UX-018 "#…&view=draft" (the address the list writes, and ETB2B AI\'s) opens Drafts too', V7.selected() === 'draft' && same(V7.rows(), ['draft-old']), [V7.selected(), V7.rows()]);
  var P = page({ noStorage: true });
  await flush();
  check('UX-018 storage refused (a private window): the page still opens, on Active, and tabs still switch', P.selected() === 'active' && (P.tab('draft'), P.selected() === 'draft'), P.selected());

  /* the Deleted banner goes back to where it came from */
  S = page();
  await flush();
  S.tab('draft');
  S.$('btn-more').click();
  S.view('deleted');
  check('UX-018 Deleted Events (from ⋯) says "Back to Drafts" when opened from Drafts', S.selected() === null && /Back to Drafts/.test(S.$('special-banner').textContent), S.$('special-banner').textContent);
  S.$('btn-back-tabs').click();
  check('…and goes back there', S.selected() === 'draft' && S.rows().length === 2, S.selected());

  /* ======== UX-019 search across tabs ======== */
  S = page();
  await flush();
  S.tab('completed');
  S.search('QA Search');
  check('UX-019 while searching, every tab counts its matches (here: 1 draft, 2 upcoming, 0 active, 0 completed)', same(S.tabs(), { draft: '1', upcoming: '2', active: '0', completed: '0' }), S.tabs());
  check('…said as matches to screen readers', /<span class="tc">2<\/span><span class="sr-only"> matches<\/span>/.test(S.$('status-tabs').innerHTML));
  check('…and the ⋯ menu counts the deleted match', S.more().deleted === '1', S.more());
  var t = S.table();
  check('UX-019 the empty tab says where the matches are, each a button', /No matches in Completed/.test(t) && /1 in Drafts, 2 in Upcoming, 1 in Deleted Events\./.test(t) &&
    /Show Drafts \(1\)/.test(t) && /Show Upcoming \(2\)/.test(t) && /Show Deleted Events \(1\)/.test(t) && !/No events match/.test(t), t);
  check('…with the search icon, and only "Clear search" (no filter is on)', /M21 21l-4\.3-4\.3/.test(S.$('table-body').innerHTML) && !!S.$('table-body').querySelector('[data-empty-clear-search]') && !S.$('table-body').querySelector('[data-empty-clear]'));
  S.$('table-body').querySelector('[data-empty-tab="upcoming"]').click();
  check('UX-019 a button opens that tab, the search kept', S.selected() === 'upcoming' && same(S.rows(), ['up-near', 'up-far']) && S.$('search-input').value === 'QA Search', [S.selected(), S.rows()]);
  check('…and that tab is remembered as picked', S.local['rv.listing.tab'] === 'upcoming');
  S.tab('active');
  S.$('btn-type').click();
  S.$('type-popover').querySelector('[data-type="awards"]').click();
  t = S.table();
  check('UX-019 a search and a filter: the counts and the message follow both (the awards draft only)', same(S.tabs(), { draft: '1', upcoming: '0', active: '0', completed: '0' }) && /No matches in Active/.test(t) && /1 in Drafts\./.test(t), [S.tabs(), t]);
  check('…with Clear search and Clear filters, each its own', !!S.$('table-body').querySelector('[data-empty-clear-search]') && !!S.$('table-body').querySelector('[data-empty-clear]'));
  S.$('table-body').querySelector('[data-empty-clear]').click();
  check('UX-019 Clear filters keeps the search (it used to clear the search the person wanted)', S.$('search-input').value === 'QA Search' && same(S.tabs(), { draft: '1', upcoming: '2', active: '0', completed: '0' }), [S.$('search-input').value, S.tabs()]);
  S.$('btn-type').click();
  S.$('type-popover').querySelector('[data-type="awards"]').click();
  S.$('table-body').querySelector('[data-empty-clear-search]').click();
  check('UX-019 Clear search keeps the filters', S.$('search-input').value === '' && S.$('chip-row').textContent.indexOf('Type: Awards') !== -1 && same(S.tabs(), { draft: '1', upcoming: '0', active: '0', completed: '0' }), [S.tabs(), S.$('chip-row').textContent]);
  S.$('chip-clear-all').click();
  check('…and with neither, the tabs count every event again', same(S.tabs(), { draft: '2', upcoming: '4', active: '1', completed: '1' }), S.tabs());
  S.search('zzz nothing');
  t = S.table();
  check('UX-019 no match anywhere: "No events match", naming the search', /No events match/.test(t) && /No event in any tab matches “zzz nothing”\. Try a different search term\./.test(t), t);
  /* one portal: the match is on another one */
  var Pt = page({ working: 'cio' });
  await flush();
  Pt.search('ETHRWorld');
  check('UX-019 on ETCIO, a search that matches only on another portal says so, with Show all portals', /No matches on ETCIO/.test(Pt.table()) && /1 event on another portal matches\./.test(Pt.table()) &&
    !!Pt.$('table-body').querySelector('[data-empty-all-portals]'), Pt.table());
  Pt.$('table-body').querySelector('[data-empty-all-portals]').click();
  check('…which looks at every portal for now, the search kept, and says where the match is', /No matches in Active/.test(Pt.table()) && /1 in Upcoming\./.test(Pt.table()) && Pt.$('search-input').value === 'ETHRWorld', Pt.table());

  /* ======== UX-020 the name and the card open the event ======== */
  S = page();
  await flush();
  S.tab('upcoming');
  var link = S.$('table-body').querySelector('[data-row="up-near"] a.ev-link');
  var ev = S.dom.fire(link, 'click');
  check('UX-020 a click on the name is not stopped (the link opens the console), and shows no tooltip', !ev.defaultPrevented && !ev.stopped && link.getAttribute('href') === 'edit-event.html?event=up-near' &&
    S.$('venue-quickview').hidden === true && S.nav.length === 0, [ev.defaultPrevented, S.$('venue-quickview').hidden, S.nav]);
  S.dom.fire(link, 'focus');
  check('UX-020 keyboard focus on the name shows venue and creator', S.$('venue-quickview').hidden === false && /Taj, Mumbai/.test(S.$('venue-quickview').textContent), S.$('venue-quickview').textContent);
  S.dom.fire(link, 'blur'); S.run(220);
  var noCity = S.$('table-body').querySelector('[data-row="up-far"] a.ev-link');
  S.dom.fire(noCity, 'mouseenter');
  check('UX-020 on hover too; a missing city is left out ("Venue to be confirmed", never ", —")', S.$('venue-quickview').hidden === false && /Venue to be confirmed/.test(S.$('venue-quickview').textContent) &&
    S.$('venue-quickview').textContent.indexOf('—') === -1 && /Created by bob@timesinternet\.in/.test(S.$('venue-quickview').textContent), S.$('venue-quickview').textContent);
  S.dom.fire(link, 'focus');
  check('…and an unknown creator is left out too (no "Created by —")', /Taj, Mumbai/.test(S.$('venue-quickview').textContent) && S.$('venue-quickview').textContent.indexOf('Created by') === -1, S.$('venue-quickview').textContent);
  var touch = page({ hover: false });
  await flush();
  var tl = touch.$('table-body').querySelector('a.ev-link');
  check('UX-020 where there is no mouse (a phone), hovering is not wired at all', !(tl.listeners.mouseenter || []).length && (tl.listeners.focus || []).length === 1);
  S.$('card-list').querySelector('[data-card="up-near"] .ev-card-info').click();
  check('UX-020 a tap anywhere on a card opens the event', S.nav[S.nav.length - 1] === 'edit-event.html?event=up-near', S.nav);
  var navs = S.nav.length;
  S.$('card-list').querySelector('[data-card="up-near"] [data-row-menu-btn]').click();
  check('…but not a tap on one of its buttons (the ⋯ menu opens instead)', S.nav.length === navs && S.$('rowmenu-card-up-near').hidden === false);
  S.dom.fire(S.$('card-list').querySelector('[data-card="up-far"] .ev-card-top'), 'click', { ctrlKey: true });
  check('…with Ctrl held, in a new browser tab, as a link would', same(S.opened[S.opened.length - 1], ['edit-event.html?event=up-far', '_blank']), S.opened);
  S.$('btn-more').click(); S.view('deleted');
  navs = S.nav.length;
  S.$('card-list').querySelector('[data-card="gone-search"]').click();
  check('UX-020 a deleted event\'s card opens nothing (the console cannot open it)', S.nav.length === navs && S.$('card-list').querySelector('[data-card="gone-search"]').classList.contains('is-static'));
  check('UX-036 a card\'s buttons sit on a row of their own, under its figures', S.$('card-list').querySelectorAll('.ev-card').every(function (c) { var last = c.children[c.children.length - 1]; return last.classList.contains('ev-card-actions') && !!last.querySelector('[data-row-menu-btn]'); }) &&
    !S.$('card-list').querySelector('.ev-card-top [data-row-menu-btn]'));

  /* ======== UX-021 (fixed before B10): the row menu is pinned to the screen and flips near the bottom ======== */
  S = page();
  await flush();
  S.tab('upcoming');
  var btn = S.menuBtn('up-far');
  btn.getBoundingClientRect = function () { return { top: 850, bottom: 882, left: 1160, right: 1192, width: 32, height: 32 }; };
  var panel = S.$('rowmenu-row-up-far');
  Object.defineProperty(panel, 'offsetHeight', { get: function () { return 220; } });
  Object.defineProperty(panel, 'offsetWidth', { get: function () { return 230; } });
  btn.click();
  check('UX-021 the open menu is moved to <body> and pinned to the screen', panel.parentNode === S.doc.body && panel.style.position === 'fixed' && panel.hidden === false, [panel.parentNode && panel.parentNode.localName, panel.style]);
  check('UX-021 near the bottom of the window it opens above its button, in full', panel.style.top === (850 - 6 - 220) + 'px' && panel.style.left === (1192 - 230) + 'px', panel.style);
  (S.dom.winListeners.scroll || []).forEach(function (fn) { fn({}); });
  check('UX-021 scrolling closes it and puts it back in its row', panel.hidden === true && panel.parentNode !== S.doc.body);

  /* ======== UX-029 the sortable headers ======== */
  var ths = S.$('table-wrap').querySelectorAll('th.sortable');
  check('UX-029 the sorted column says so (aria-sort), the others do not', ths[0].getAttribute('aria-sort') === 'ascending' && ths[1].getAttribute('aria-sort') === null && ths[2].getAttribute('aria-sort') === null);
  ths[2].querySelector('button.th-sort').click();
  check('UX-029 its button sorts (keyboard: Enter or Space on a button is a click): Registrations, most first', ths[2].getAttribute('aria-sort') === 'descending' && ths[0].getAttribute('aria-sort') === null &&
    S.rows()[0] === 'up-far' && S.$('sort-select').value === 'registrations', [S.rows(), ths[2].getAttribute('aria-sort')]);
  ths[2].querySelector('button.th-sort').click();
  check('…and again the other way', ths[2].getAttribute('aria-sort') === 'ascending' && S.rows()[S.rows().length - 1] === 'up-far', S.rows());
  S.tab('draft');
  check('UX-037 a sort the person picked stays when the tab changes', S.$('sort-select').value === 'registrations', S.$('sort-select').value);

  /* ======== UX-029 the dialogs: QR codes, Need help?, the Filters sheet ======== */
  S = page();
  await flush();
  var qrBtn = S.$('btn-qr-toolbar');
  qrBtn.focus();
  qrBtn.click();
  var card = S.$('sheet-root').querySelector('.modal-card');
  check('UX-029 QR codes is a dialog named by its title', card && card.getAttribute('role') === 'dialog' && card.getAttribute('aria-modal') === 'true' && card.getAttribute('aria-labelledby') === 'qr-title' && !!S.$('qr-title'));
  check('…the focus moves into it (the event picker)', S.doc.activeElement === S.$('qr-event-select'), S.doc.activeElement && S.doc.activeElement.id);
  S.$('qr-continue').focus();
  S.dom.key(S.$('qr-continue'), 'Tab');
  check('…Tab from its last control goes round to its first, never to the page behind', S.doc.activeElement === S.$('qr-close'), S.doc.activeElement && S.doc.activeElement.id);
  S.dom.key(S.$('qr-close'), 'Tab', { shiftKey: true });
  check('…and Shift+Tab from its first to its last', S.doc.activeElement === S.$('qr-continue'), S.doc.activeElement && S.doc.activeElement.id);
  S.$('qr-continue').click();
  check('…each step is a dialog again, with the focus in it', S.$('sheet-root').querySelector('.modal-card').getAttribute('role') === 'dialog' && S.doc.activeElement === S.$('qr-sec-website'));
  S.dom.key(S.doc.activeElement, 'Escape');
  check('UX-029 Escape closes it, and the focus goes back to QR Codes', S.$('sheet-root').innerHTML === '' && S.doc.activeElement === qrBtn);
  var help = S.$('btn-help');
  help.focus(); help.click();
  card = S.$('sheet-root').querySelector('.modal-card');
  check('UX-029 Need help? is a dialog named by its title, the focus in its message box', card.getAttribute('role') === 'dialog' && card.getAttribute('aria-labelledby') === 'help-title' && S.doc.activeElement === S.$('help-message'));
  check('…its fields are labelled and its copy button named', !!S.$('sheet-root').querySelector('label[for="help-subject"]') && !!S.$('sheet-root').querySelector('label[for="help-message"]') && S.$('help-copy-email').getAttribute('aria-label') === 'Copy address');
  S.dom.key(S.$('help-message'), 'Escape');
  check('…Escape closes it, focus back on Need help?', S.$('sheet-root').innerHTML === '' && S.doc.activeElement === help);
  var fb = S.$('btn-mobile-filters');
  fb.focus(); fb.click();
  var sheet = S.$('sheet-card');
  check('UX-029 the phone Filters sheet is a dialog, the focus on its first control', sheet && sheet.getAttribute('role') === 'dialog' && sheet.getAttribute('aria-labelledby') === 'sheet-title' && S.doc.activeElement === S.$('m-portal'));
  var ip = S.$('sheet-root').querySelector('[data-mtype="ip"]');
  ip.focus(); ip.click();
  check('…ticking a box redraws it and the focus stays on that box', S.doc.activeElement && S.doc.activeElement.getAttribute('data-mtype') === 'ip' && /check-row on/.test(S.$('sheet-root').innerHTML));
  S.dom.key(S.doc.activeElement, 'Escape');
  check('…Escape closes it, focus back on Filters, and the list is drawn with the box ticked', S.$('sheet-root').innerHTML === '' && S.doc.activeElement === fb &&
    S.$('chip-row').textContent.indexOf('Type: IP Event') !== -1, S.$('chip-row').textContent);
  S.$('chip-clear-all').click();

  /* ======== UX-031 QR codes from a published row ======== */
  S.tab('upcoming');
  check('UX-031 a published row\'s ⋯ menu has QR codes', S.menu('up-near').indexOf('qr') !== -1);
  S.tab('draft');
  check('…a draft\'s has not (no site on the web yet)', S.menu('draft-new').indexOf('qr') === -1);
  S.tab('upcoming');
  var mb = S.menuBtn('up-near');
  mb.click();
  S.$('rowmenu-row-up-near').querySelector('[data-row-action="qr"]').click();
  check('UX-031 it opens on that event', /QR Codes/.test(S.$('qr-title').textContent) && /QA Search Upcoming Near/.test(S.$('sheet-root').textContent) && !!S.$('qr-sec-website'));
  S.$('qr-sec-website').click();
  /* through the scan counter: /e/<id>?qr=1 (LST-038), which sends the visitor on to /e/<id> */
  check('UX-031 its address is the real one, /e/<id> (owner decision #2), never a made-up domain', S.$('qr-link-text').textContent === 'http://localhost/e/up-near?qr=1' &&
    S.$('qr-img').getAttribute('data-qr-text') === 'http://localhost/e/up-near?qr=1' && /^data:image\/svg\+xml/.test(S.$('qr-img').src || S.$('qr-img').getAttribute('src')), [S.$('qr-link-text').textContent, S.$('qr-img').getAttribute('data-qr-text'), String(S.$('qr-img').src).slice(0, 40), S.$('qr-fail').hidden]);
  S.$('qr-done').click();
  check('…closing it gives the focus back to the row\'s ⋯ button', S.doc.activeElement === mb);

  /* ======== UX-030 dates as entered; UX-033 undated last ======== */
  S = page();
  await flush();
  S.tab('upcoming');
  function fmt(n) { var x = dayOf(n).split('-'); return +x[2] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+x[1] - 1] + ' ' + x[0]; }
  var a = dayOf(3).split('-'), b = dayOf(5).split('-');
  /* RevampCore.fmtRange's style (UX-010): "5–7 Dec 2026", "30 Nov – 2 Dec 2026" */
  var range = a[1] === b[1] ? +a[2] + '–' + fmt(5) : fmt(3).replace(/ \d{4}$/, a[0] === b[0] ? '' : ' ' + a[0]) + ' – ' + fmt(5);
  check('UX-030 a multi-day event shows its range and its start time as entered', S.cell('up-near').indexOf(range) === 0 && /10:41 am/.test(S.cell('up-near')) && /In 3 days/.test(S.cell('up-near')), [S.cell('up-near'), range]);
  check('UX-030 a one-day event with an end: the day and its hours', S.cell('up-far') === fmt(40) + '9:00 am – 6:00 pm', S.cell('up-far'));
  check('UX-030 a month booked in Create Event shows its words ("' + MONTH_LABEL + '"), not "Date not set"', S.cell('up-month') === MONTH_LABEL, S.cell('up-month'));
  check('UX-030 "to be announced" shows as such', S.cell('up-tba') === 'Date to be announced', S.cell('up-tba'));
  check('UX-033 Upcoming, soonest first: the dated events, the month by its first day, then the undated one last', same(S.rows(), ['up-near', 'up-far', 'up-month', 'up-tba']), S.rows());
  S.$('table-wrap').querySelectorAll('th.sortable')[0].querySelector('button').click();
  check('UX-033 latest first, the undated one still last', same(S.rows(), ['up-month', 'up-far', 'up-near', 'up-tba']), S.rows());
  var cardDate = S.$('card-list').querySelector('[data-card="up-near"] .v-wrap');
  check('UX-030 the card shows the same words on a line that wraps', !!cardDate && cardDate.textContent === range + ' · 10:41 am', cardDate && cardDate.textContent);
  /* the date helpers on their own */
  var W = page({ items: [
    { id: 'date-only', name: 'Date Only', published: true, start: dayOf(2), end: null, counters: {} },
    { id: 'zoned', name: 'Zoned', published: true, start: '2099-03-01T04:30:00.000Z', end: '2099-03-01T12:30:00.000Z', counters: {} },
    { id: 'none', name: 'No Date', published: true, dateMode: 'none', dateLabel: '', counters: {} },
    { id: 'quarter', name: 'Quarter', published: true, dateMode: 'quarter', dateLabel: 'Q2 2099', counters: {} },
    { id: 'reversed', name: 'Reversed', published: true, start: '2099-05-10T09:00', end: '2099-05-08T09:00', counters: {} }
  ], working: 'all' });
  await flush();
  W.tab('upcoming');
  check('UX-030 a date with no time: no made-up "05:30 am"', W.cell('date-only') === fmt(2) + 'In 2 days', W.cell('date-only'));
  check('UX-030 a server time is read in India time (04:30 Z is 10:00 am)', W.cell('zoned') === '1 Mar 2099' + '10:00 am – 6:00 pm', W.cell('zoned'));
  check('UX-030 no date at all: "Date not set"', W.cell('none') === 'Date not set', W.cell('none'));
  check('UX-030 a quarter in its words', W.cell('quarter') === 'Q2 2099', W.cell('quarter'));
  check('UX-030 an end before the start is no range', W.cell('reversed') === '10 May 2099' + '9:00 am', W.cell('reversed'));
  check('UX-033 a quarter sorts by its first day, before a later date; no date at all last', same(W.rows(), ['date-only', 'zoned', 'quarter', 'reversed', 'none']), W.rows());

  /* ======== UX-037 the view remembered, 20 a page, Last edited ======== */
  var many = [];
  for (var i = 0; i < 25; i++) many.push({ id: 'qa-ux-b10-' + i, name: 'Draft ' + (i < 10 ? '0' : '') + i, published: false, counters: {}, updatedAt: iso(NOW - i * 3600000) });
  S = page({ items: many, working: 'all' });
  await flush();
  check('UX-037 20 a page (25 drafts: two pages, the newest edited first)', S.rows().length === 20 && S.rows()[0] === 'qa-ux-b10-0' && S.$('pagination').querySelectorAll('[data-page]').length === 4 &&
    /Showing 1–20 of 25 events/.test(S.$('result-line').textContent), [S.rows().length, S.$('result-line').textContent]);
  S.$('sort-select').value = 'start'; S.dom.fire(S.$('sort-select'), 'change');
  S.$('sort-select').value = 'updated'; S.dom.fire(S.$('sort-select'), 'change');
  check('UX-037 the Sort menu: Last edited, newest first', S.rows()[0] === 'qa-ux-b10-0' && S.rows()[19] === 'qa-ux-b10-19', S.rows().slice(0, 3));
  check('UX-037 Last edited is an order an Undo puts back (RvListing)', /var LISTING_SORTS = \{ start:1, updated:1, registrations:1, visitors:1 \};/.test(INLINE) &&
    (S.ctx.RvListing.restore(Object.assign(S.ctx.RvListing.snapshot(), { sort: { field: 'updated', dir: 'asc' } })), S.rows()[0] === 'qa-ux-b10-24'), S.rows()[0]);
  S.$('view-toggle').querySelector('[data-view="grid"]').click();
  check('UX-037 Card view is remembered in this browser', S.local['rv.listing.layout'] === 'grid' && S.$('results-view').classList.contains('view-grid'));
  var R = page({ items: many, local: S.local, working: 'all' });
  await flush();
  check('…and a reload opens in Card view', R.$('results-view').classList.contains('view-grid') && R.$('view-toggle').querySelector('[data-view="grid"]').getAttribute('aria-pressed') === 'true');

  /* ======== launch polish (13 Nov 2026): LST-016, LST-030, LST-044, LST-046 ======== */
  /* LST-030 the page and an order the person picked are kept in the address, and come back on reload and Back */
  var P = page({ items: many, working: 'all' });
  await flush();
  P.$('pagination').querySelectorAll('[data-page="2"]')[0].click();
  check('LST-030 page 2 is in the address', P.rows().length === 5 && P.ctx.location.hash === '#tab=active&view=draft&page=2', [P.rows().length, P.ctx.location.hash]);
  P.ctx.RvListing.restore(Object.assign(P.ctx.RvListing.snapshot(), { sort: { field: 'updated', dir: 'asc' }, page: 2 }));
  var P2rows = P.rows();
  check('LST-030 an order picked (Last edited, oldest first) is in the address with the page', P.ctx.location.hash === '#tab=active&view=draft&sort=updated-asc&page=2' &&
    same(P2rows, ['qa-ux-b10-4', 'qa-ux-b10-3', 'qa-ux-b10-2', 'qa-ux-b10-1', 'qa-ux-b10-0']), [P.ctx.location.hash, P2rows]);
  var P3 = page({ items: many, working: 'all', hash: P.ctx.location.hash });
  await flush();
  var cur = P3.$('pagination').querySelector('[aria-current="true"]');
  check('…a reload opens on that page in that order', same(P3.rows(), P2rows) && P3.$('sort-select').value === 'updated' && !!cur && cur.textContent === '2' &&
    P3.ctx.location.hash === '#tab=active&view=draft&sort=updated-asc&page=2', [P3.rows(), P3.$('sort-select').value, P3.ctx.location.hash]);
  var P4 = page({ items: many, working: 'all', session: P.session });
  await flush();
  check('…and so does "Back to events" (a plain link: this browser tab\'s last list)', same(P4.rows(), P2rows), P4.rows());
  var P5 = page({ items: many, working: 'all', hash: '#tab=active&view=draft&page=9' });
  check('…a page past the end waits for the events (still page 9 while they load)', /&page=9$/.test(P5.ctx.location.hash), P5.ctx.location.hash);
  await flush();
  check('…then is the last page', P5.rows().length === 5 && P5.ctx.location.hash === '#tab=active&view=draft&page=2', [P5.rows().length, P5.ctx.location.hash]);
  P5.tab('upcoming');
  check('…and another tab opens on its page 1, in its own order', !/page=|sort=/.test(P5.ctx.location.hash), P5.ctx.location.hash);

  /* LST-016 an empty list has no "Showing 0–0 of 0" above it; a search from the address shows as one from the start */
  var E = page();
  await flush();
  E.search('zz-nothing-matches-this');
  check('LST-016 no result line above an empty list', E.$('result-line').hidden === true && E.$('result-line').textContent === '', [E.$('result-line').hidden, E.$('result-line').textContent]);
  E.search('');
  check('…and it is back with the rows', E.$('result-line').hidden === false && /^Showing 1–/.test(E.$('result-line').textContent), E.$('result-line').textContent);
  var Q = page({ hash: '#tab=upcoming&q=QA' });
  check('LST-016 a search from the address: in the box, Clear shown, the "/" hint hidden, from the start', Q.$('search-input').value === 'QA' && Q.$('btn-clear-search').hidden === false && Q.$('search-kbd').hidden === true);
  check('LST-016 in Card view an empty list\'s message spans the whole row', /#results-view\.view-grid \.card-list > \.empty-state\{ grid-column:1 \/ -1; \}/.test(CSS));
  check('LST-021 the logo goes to this page, not to the sign-in page', /<a class="main-nav-brand" href="Event_Listing\.html">/.test(BODY) && BODY.indexOf('href="index.html"') === -1);

  /* LST-044 menus: the buttons say open or shut, an option ticks where it is, Esc gives the focus back */
  var K = page({ items: baseItems().concat([{ id: 'site-saved', name: 'Saved Site', category: 'ip', published: true, start: wall(-1), end: wall(1, '18:00'), portal: 'cio', portalName: 'ETCIO', templateId: 'tech500', site: { version: 3 }, counters: {} }]) });
  await flush();
  var bt = K.$('btn-type');
  check('LST-044 the pop-over buttons say they open one, shut', ['btn-type', 'btn-portal', 'btn-range', 'btn-activity-range', 'btn-more', 'btn-portals-nav'].every(function (id) {
    var b = K.$(id); return b && b.getAttribute('aria-expanded') === 'false' && !!b.getAttribute('aria-haspopup');
  }) && bt.getAttribute('aria-controls') === 'type-popover' && K.$('btn-portals-nav').getAttribute('aria-haspopup') === 'listbox');
  bt.click();
  var opts = K.$('type-popover').querySelectorAll('[role="menuitemcheckbox"]');
  check('…Event type opens as a menu of checkboxes, its button says so', K.$('type-popover').hidden === false && bt.getAttribute('aria-expanded') === 'true' && K.$('type-popover').getAttribute('role') === 'menu' &&
    opts.length >= 2 && opts.every(function (o) { return o.getAttribute('aria-checked') === 'false'; }), [bt.getAttribute('aria-expanded'), opts.length]);
  var first = opts[0];
  first.focus(); first.click();
  check('…an option ticks in place: the same button, checked, still focused, the list filtered', K.$('type-popover').contains(first) && first.getAttribute('aria-checked') === 'true' && first.classList.contains('on') &&
    K.doc.activeElement === first && K.$('type-popover').hidden === false && /Type:/.test(K.$('chip-row').textContent), [first.getAttribute('aria-checked'), K.doc.activeElement === first]);
  K.dom.key(first, 'ArrowDown');
  check('…Down moves to the next option', K.doc.activeElement === opts[1]);
  first.click();
  check('…and a second click unticks it', first.getAttribute('aria-checked') === 'false' && !first.classList.contains('on') && K.$('chip-row').textContent.indexOf('Type:') === -1);
  K.dom.key(K.doc.activeElement, 'Escape');
  check('…Esc shuts it and gives the focus back to Event type', K.$('type-popover').hidden === true && bt.getAttribute('aria-expanded') === 'false' && K.doc.activeElement === bt);
  var mb = K.menuBtn('live-summit');
  mb.focus(); mb.click();
  check('LST-044 a row\'s ⋯ says it is open', mb.getAttribute('aria-haspopup') === 'true' && mb.getAttribute('aria-expanded') === 'true');
  K.dom.key(K.doc.activeElement, 'Escape');
  check('…Esc shuts it and the focus is back on that ⋯', mb.getAttribute('aria-expanded') === 'false' && K.doc.activeElement === mb && K.$('rowmenu-row-live-summit').hidden === true);

  /* LST-046 the pencil opens the site editor; the row still opens the console; no "Event setup" in ⋯ */
  function pencil(id) { return K.$('table-body').querySelector('[data-row="' + id + '"] [data-row-action="edit"]'); }
  check('LST-046 the pencil: "Edit site" once a site is saved (with Preview), "Design the site" before (no Preview)', pencil('site-saved').getAttribute('aria-label') === 'Edit site' &&
    !!K.$('table-body').querySelector('[data-row="site-saved"] [data-row-action="view"]') && pencil('live-summit').getAttribute('aria-label') === 'Design the site' &&
    !K.$('table-body').querySelector('[data-row="live-summit"] [data-row-action="view"]') && !K.$('table-body').querySelector('[data-row-action="design"]'));
  pencil('site-saved').click();
  pencil('live-summit').click();
  K.$('table-body').querySelector('[data-row="site-saved"]').click();
  check('…it opens the editor on the event\'s template; the row opens the console', same(K.nav.slice(-3), ['/custom_editor.html?event=site-saved&template=tech500', '/custom_editor.html?event=live-summit', 'edit-event.html?event=site-saved']), K.nav.slice(-3));
  check('…and the ⋯ menu has no "Event setup"', K.menu('site-saved').indexOf('setup') === -1 && K.menu('live-summit')[0] === 'duplicate', K.menu('site-saved'));

  console.log('events-dashboard-finding (node): ' + passed + ' passed, ' + failed + ' failed');
}

/* ======================================================================================================
   3. a real browser, when this machine has one: the layout parts node cannot see
   ====================================================================================================== */
function driver() {
  var tries = [process.env.RV_PUPPETEER, 'puppeteer-core', path.join(process.env.HOME || '', '.revamp-cms-qa', 'node_modules', 'puppeteer-core')].filter(Boolean);
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]); } catch (e) { /* next */ } }
  return null;
}
async function browserPart() {
  var CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .filter(Boolean).filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
  var puppeteer = driver();
  if (!puppeteer || !CHROME) { console.log('events-dashboard-finding: the browser part skipped — no Chrome / puppeteer-core here (set CHROME_PATH and RV_PUPPETEER)'); return; }
  var ORIGIN = 'http://dashboard.test';
  var TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  var AUTH = '(function(){var u={uid:"qa",email:"qa-agent@timesinternet.in",displayName:"QA Agent",getIdToken:function(){return Promise.resolve("t");}};' +
    'function t(){return Promise.resolve("t");}window.RevampAuth={getIdToken:t,currentUser:function(){return u;},onAuthChange:function(cb){setTimeout(function(){cb(u);},0);return function(){};},' +
    'whenResolved:function(){return Promise.resolve(u);},authedFetch:function(url,o){o=o||{};var h={};for(var k in (o.headers||{}))h[k]=o.headers[k];h.Authorization="Bearer t";o.headers=h;return fetch(url,o);},' +
    'redirectToSignIn:function(){},mountAccountMenu:function(){},ensureSession:t};})();';
  var LONG = 'QAUXB10' + 'Averyveryverylongeventnamewithnospacesatallsoitcannotwrapanywhereatallreally'.slice(0, 70);
  var items = baseItems().map(function (e) { var c = JSON.parse(JSON.stringify(e)); if (c.id === 'up-month') c.dateLabel = MONTH_LABEL; return c; });
  items.push({ id: 'qa-ux-b10-long', name: LONG, category: 'ip', published: true, start: wall(12), end: wall(12, '18:00'), portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW) });
  for (var i = 0; i < 6; i++) items.push({ id: 'qa-ux-b10-up' + i, name: 'QA Upcoming ' + i, category: 'ip', published: true, start: wall(14 + i), end: wall(14 + i, '18:00'), portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW - i * DAY) });
  function api(u) {
    if (u.pathname === '/api/events') return u.searchParams.get('deleted') ? { items: baseDeleted() } : { items: items };
    if (u.pathname === '/api/et/portals') return { portals: ROSTER };
    if (u.pathname === '/api/me/working-portal') return { workingPortal: 'cio' };
    if (u.pathname === '/api/settings/approvals') return { approvers: [], allowSelf: false, required: true };
    if (u.pathname === '/api/insights') return { byDay: [], events: [] };
    if (u.pathname === '/api/promo/analytics/all') return { available: false, backend: 'none', series: [], totals: {} };
    if (u.pathname === '/api/activity/all') return { items: [], next: null };
    if (u.pathname === '/api/dash-bot/history') return { turns: [] };
    return null;
  }
  function serve(r) {
    var u = new URL(r.url());
    if (u.origin !== ORIGIN) {
      return r.abort();
    }
    if (u.pathname === '/auth.js') return r.respond({ status: 200, contentType: TYPES['.js'], body: AUTH });
    if (/^\/api\//.test(u.pathname)) { var body = api(u); return r.respond({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body || { error: 'not here' }) }); }
    if (/^\/edit-event\.html/.test(u.pathname)) return r.respond({ status: 200, contentType: TYPES['.html'], body: '<!doctype html><title>console</title>' });
    var file = path.join(ROOT, decodeURIComponent(u.pathname));
    if (file.indexOf(ROOT + path.sep) !== 0 || !fs.existsSync(file)) return r.respond({ status: 404, body: 'not found' });
    return r.respond({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  }
  var browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });
  async function open(url, size) {
    var pg = await browser.newPage();
    pg.errors = [];
    pg.on('pageerror', function (e) { pg.errors.push(String(e.message)); });
    await pg.setRequestInterception(true);
    pg.on('request', serve);
    if (size.device) await pg.emulate(puppeteer.KnownDevices[size.device]);
    else await pg.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 });
    /* the colours checked here are the light theme's: headless Chrome otherwise follows the computer's own
       appearance, and a Mac that turns Dark by itself in the evening made this test fail with nothing changed */
    await pg.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await pg.goto(ORIGIN + url, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(function (r) { setTimeout(r, 300); });
    return pg;
  }
  try {
    /* desktop, Upcoming with the long name */
    var dk = await open('/Event_Listing.html#tab=upcoming', { w: 1440, h: 900 });
    var lay = await dk.evaluate(function () {
      var wrap = document.getElementById('table-wrap'), table = wrap.querySelector('table'), long = document.querySelector('[data-row="qa-ux-b10-long"]');
      var act = long ? long.querySelector('.row-actions').getBoundingClientRect() : null, w = wrap.getBoundingClientRect();
      return { table: Math.round(table.getBoundingClientRect().width), wrap: Math.round(w.width), scrollW: wrap.scrollWidth, clientW: wrap.clientWidth, actRight: act ? Math.round(act.right) : null, wrapRight: Math.round(w.right),
        dot: getComputedStyle(document.querySelector('.status-dot.upcoming')).backgroundColor, bar: getComputedStyle(document.querySelector('tr.st-upcoming td')).boxShadow, page: document.documentElement.scrollWidth };
    });
    check('browser 1440: UX-036 a 77-character unbroken name wraps: the table fits its card, the Actions column in view', lay.scrollW <= lay.clientW && lay.actRight !== null && lay.actRight <= lay.wrapRight && lay.page <= 1440, lay);
    check('browser 1440: UX-041 Upcoming is blue (#1D5FA3), not ET red', lay.dot === 'rgb(29, 95, 163)' && /rgb\(29, 95, 163\)/.test(lay.bar), [lay.dot, lay.bar]);
    /* the ⋯ menu of the last row (UX-021) */
    var last = await dk.evaluate(function () { var b = document.querySelectorAll('#table-body [data-row-menu-btn]'); b = b[b.length - 1]; b.scrollIntoView({ block: 'end' }); return b.getAttribute('data-row-menu-btn'); });
    await new Promise(function (r) { setTimeout(r, 100); });
    await dk.click('[data-row-menu-btn="' + last + '"]');
    var menu = await dk.evaluate(function (id) {
      var m = document.getElementById(id), r = m.getBoundingClientRect();
      return { parent: m.parentNode === document.body, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, items: m.querySelectorAll('[data-row-action]').length };
    }, last);
    /* (three items or more since LST-046 took "Event setup" out of the menu: the row itself opens the console) */
    check('browser 1440: UX-021 the last row\'s ⋯ menu is whole on screen', menu.parent && menu.top >= 0 && menu.bottom <= menu.vh && menu.items >= 3, menu);
    await dk.keyboard.press('Escape');
    /* the sort headers by keyboard (UX-029) */
    await dk.focus('th[data-sort="registrations"] button');
    await dk.keyboard.press('Enter');
    var srt = await dk.evaluate(function () { return document.querySelector('th[data-sort="registrations"]').getAttribute('aria-sort'); });
    check('browser 1440: UX-029 Enter on a header sorts by it', srt === 'descending', srt);
    check('browser 1440: no page error', !dk.errors.length, dk.errors);
    await dk.close();

    /* a phone */
    var ph = await open('/Event_Listing.html#tab=upcoming', { device: 'iPhone 13' });
    var p = await ph.evaluate(function () {
      function vis(el) { return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; }
      function box(el) { var r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }
      var tb = document.getElementById('status-tabs');
      return {
        page: document.documentElement.scrollWidth, vw: window.innerWidth,
        type: vis(document.getElementById('btn-type')), portal: vis(document.getElementById('btn-portal')), filters: vis(document.getElementById('btn-mobile-filters')),
        search: Math.round(document.querySelector('.search-box').getBoundingClientRect().width), nav: vis(document.querySelector('.main-nav-scroll')),
        icon: box(document.querySelector('#card-list [data-row-menu-btn]')), page1: document.querySelectorAll('#pagination button').length ? box(document.querySelector('#pagination button')) : null,
        tabsScroll: tb.scrollWidth > tb.clientWidth, selectedVisible: (function () { var s = tb.querySelector('[aria-selected="true"]').getBoundingClientRect(), t = tb.getBoundingClientRect(); return s.left >= t.left - 1 && s.right <= t.right + 1; })(),
        tabH: Math.round(tb.querySelector('button').getBoundingClientRect().height),
        syncH: Math.round(document.getElementById('sync-label').getBoundingClientRect().height),
        cardDate: document.querySelector('#card-list [data-card="up-near"] .v-wrap').getBoundingClientRect().height > 0
      };
    });
    check('browser iPhone: no sideways scroll with four tabs', p.page <= p.vw, p);
    check('browser iPhone: UX-031 one Filters button: no Event Type or Portal beside it', p.filters && !p.type && !p.portal, p);
    check('browser iPhone: UX-031 the search box has the row (no "Search eve…")', p.search >= 220, p.search);
    check('browser iPhone: UX-031 no squeezed nav in the header', p.nav === false, p.nav);
    check('browser iPhone: UX-029 icon buttons and tabs are 44 px touch targets', p.icon[0] >= 44 && p.icon[1] >= 44 && p.tabH >= 44, [p.icon, p.tabH]);
    check('browser iPhone: the selected tab is in view in the tab strip', p.selectedVisible, p);
    check('browser iPhone: "Updated …" stays on one line beside the Sort menu', p.syncH > 0 && p.syncH < 24, p.syncH);
    await ph.tap('#card-list [data-card="up-near"] .ev-card-info');
    await new Promise(function (r) { setTimeout(r, 600); });
    check('browser iPhone: UX-020 a tap on a card opens the event\'s console', /\/edit-event\.html\?event=up-near$/.test(ph.url()), ph.url());
    check('browser iPhone: no page error', !ph.errors.length, ph.errors);
    await ph.close();
  } catch (e) {
    check('the browser part ran to the end', false, String(e && e.stack || e));
  } finally {
    await browser.close();
  }
}

main().then(browserPart).then(function () {
  console.log('events-dashboard-finding: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (e) { console.error('CRASH ' + (e && e.stack || e)); process.exit(1); });
