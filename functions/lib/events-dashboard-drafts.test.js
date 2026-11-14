/* node functions/lib/events-dashboard-drafts.test.js — Create Event's unfinished drafts on the events dashboard's Drafts
   tab (UX-048, batch B08). Before, a draft lived in one browser only and the dashboard never showed it. Now Create Event
   saves each one to the person's account (create-drafts.js, functions/lib/create-drafts.js) and the Drafts tab lists
   them above the draft events, in a box of their own ("Unfinished in Create Event"), so the two kinds are told apart:
   each with Resume (create-event.html?draft=<id>, any computer) and Discard (asked first), on the working portal (one
   with no portal yet is shown on every portal; the others are counted, with where to see them), narrowed by the search
   and the Type filter like the events, hidden (and said) while a date filter is on, and counted in the Drafts tab.
   The page's own script runs in node's vm over fixtures/mini-dom.js with the real edit-event-core.js,
   event-lifecycle.js and create-drafts.js and an in-memory server. No network, no production, no AI. Exits 1 on any
   failure. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var makeDom = require('./fixtures/mini-dom').makeDom;

var ROOT = path.join(__dirname, '..', '..');
var PAGE = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8');
var CORE = fs.readFileSync(path.join(ROOT, 'edit-event-core.js'), 'utf8');
var LIFE = fs.readFileSync(path.join(ROOT, 'event-lifecycle.js'), 'utf8');
var DRAFTS_JS = fs.readFileSync(path.join(ROOT, 'create-drafts.js'), 'utf8');
var START = PAGE.indexOf('<script>\n(function(){');
var INLINE = START === -1 ? '' : PAGE.slice(START + '<script>'.length, PAGE.indexOf('</script>', START));
var BODY = PAGE.slice(PAGE.indexOf('<header class="main-nav">'), PAGE.indexOf('<script src="theme-toggle.js">'));
var CSS = PAGE.slice(PAGE.indexOf('<style>'), PAGE.indexOf('</style>'));
var ROSTER = require('./et-events').portalList();

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 900) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function flush(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 30); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }
function response(status, json) {
  var t = json === undefined ? '' : JSON.stringify(json);
  return { status: status, ok: status >= 200 && status < 300, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(json === undefined ? {} : JSON.parse(t)); } };
}

/* ---------- the files ---------- */
check('the page loads create-drafts.js before its own script', PAGE.indexOf('<script src="create-drafts.js"></script>') !== -1 && PAGE.indexOf('<script src="create-drafts.js"></script>') < START);
check('the box sits above the list, with a name for screen readers', /<section id="create-drafts" aria-label="Unfinished in Create Event"><\/section>\s*\n\s*<div id="results-view"/.test(PAGE));
check('the box\'s rules use the page\'s colour tokens only', (function () {
  var rules = CSS.split('\n').filter(function (l) { return /^\s*\.cdraft|#create-drafts/.test(l); });
  return rules.length >= 8 && rules.every(function (l) { return !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l.replace(/#create-drafts/g, '')); });
})());
check('the box is drawn with the list, so the search and filters narrow it (renderResults)', /function renderResults\(\)\{[\s\S]{0,900}?renderCreateDrafts\(\);/.test(INLINE));
check('the inline script stays ES5', !/\blet\s|\bconst\s/.test(INLINE.replace(/\/\*[\s\S]*?\*\//g, '')) && INLINE.indexOf('=>') === -1 && INLINE.indexOf('`') === -1);

/* ---------- the page, run ---------- */
var NOW = Date.now(), DAY = 86400000;
function iso(ms) { return new Date(ms).toISOString(); }
var ME = 'asha.rao@timesinternet.in';
function items(o) {
  var list = [
    { id: 'live-summit', name: 'Live Summit', category: 'ip', published: true, start: iso(NOW - DAY).slice(0, 16), end: iso(NOW + DAY).slice(0, 16), portal: 'cio', portalName: 'ETCIO', counters: {}, updatedAt: iso(NOW - 9 * DAY) },
    { id: 'draft-event-a', name: 'Draft Event A', category: 'ip', published: false, portal: 'cio', portalName: 'ETCIO', createdBy: ME, counters: {}, updatedAt: iso(NOW - DAY) },
    { id: 'qa-ux-b08-made', name: 'CIO Forum Made', category: 'ip', published: false, portal: 'cio', portalName: 'ETCIO', createdBy: ME, counters: {}, updatedAt: iso(NOW - 2 * DAY) }
  ];
  return o && o.noDraftEvents ? list.filter(function (e) { return e.published; }) : list;
}
function drafts() {
  return [
    { id: 'draft-mh1aaa-aaa111', rev: 3, savedAt: iso(NOW - 3600e3), updatedAt: iso(NOW - 3600e3),
      summary: { name: 'CIO Annual Forum 2027', category: 'IP', portal: 'cio', client: '', method: 'template', phase: 'details', eventId: '' } },
    { id: 'draft-mh1bbb-bbb222', rev: 1, savedAt: iso(NOW - 7200e3), updatedAt: iso(NOW - 7200e3),
      summary: { name: '', category: '', portal: '', client: '', method: '', phase: 'category', eventId: '' } },
    { id: 'draft-mh1ccc-ccc333', rev: 2, savedAt: iso(NOW - 9000e3), updatedAt: iso(NOW - 9000e3),
      summary: { name: 'CIO Forum Made', category: 'IP', portal: 'cio', client: '', method: 'template', phase: 'details', eventId: 'qa-ux-b08-made' } },
    { id: 'draft-mh1ddd-ddd444', rev: 1, savedAt: iso(NOW - 10000e3), updatedAt: iso(NOW - 10000e3),
      summary: { name: 'HR Awards Night', category: 'Awards', portal: 'hr', client: '', method: 'brief', phase: 'details', eventId: '' } }
  ];
}

/* o: hash, working, noDraftEvents, draftList (the account's list), listFail, deleteFail */
function page(o) {
  o = o || {};
  var dom = makeDom(), d = dom.document;
  d.body.innerHTML = BODY;
  var mem = {}, session = {}, calls = [], timers = [];
  function store(m) { return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }
  var account = { list: o.draftList || drafts(), listFail: o.listFail || 0, deleteFail: o.deleteFail || 0 };
  var ctx = {
    document: d, console: { log: function () {}, warn: function () {}, error: function () {} },
    navigator: { onLine: true },
    location: { hash: o.hash || '', pathname: '/Event_Listing.html', origin: 'http://localhost', reload: function () {} },
    history: { replaceState: function (s, t, url) { if (/^#/.test(url)) ctx.location.hash = url; } },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, clearTimeout: function () {},
    requestAnimationFrame: function (fn) { fn(); return 0; },
    scrollTo: function () {}, open: function () {},
    matchMedia: function () { return { matches: false }; },
    addEventListener: function (t, fn) { (dom.winListeners[t] = dom.winListeners[t] || []).push(fn); },
    innerWidth: 1440, innerHeight: 900,
    fetch: function (url) {
      if (url === '/api/events') return Promise.resolve(response(200, { items: items(o) }));
      if (url === '/api/events?deleted=1') return Promise.resolve(response(200, { items: [] }));
      if (url === '/api/settings/approvals') return Promise.resolve(response(200, { approvers: [], allowSelf: false, required: true }));
      if (/^\/api\/insights\?/.test(url)) return Promise.resolve(response(200, { byDay: [], events: [] }));
      if (/^\/api\/activity\/all\?/.test(url)) return Promise.resolve(response(200, { items: [], next: null }));
      if (url === '/api/promo/analytics/all') return Promise.resolve(response(200, { available: false, backend: 'none', series: [], totals: {} }));
      return Promise.resolve(response(404, { error: 'not here' }));
    },
    RevampAuth: {
      getIdToken: function () { return Promise.resolve('token'); },
      currentUser: function () { return { uid: 'u-asha', email: ME, displayName: 'Asha Rao' }; },
      /* the account's drafts (functions/lib/create-drafts.js), as the person's own sign-in reaches them */
      authedFetch: function (url, opts) {
        var method = (opts && opts.method) || 'GET';
        calls.push(method + ' ' + url);
        if (method === 'GET' && url === '/api/me/create-drafts') {
          if (account.listFail) { account.listFail--; return Promise.resolve(response(500, { error: 'Your drafts could not be read. Please try again.' })); }
          return Promise.resolve(response(200, { drafts: account.list }));
        }
        var m = /^\/api\/me\/create-draft\?id=(.+)$/.exec(url);
        if (method === 'DELETE' && m) {
          if (account.deleteFail) { account.deleteFail--; return Promise.resolve(response(500, { error: 'Your draft could not be removed from your account. Please try again.' })); }
          var had = account.list.length;
          account.list = account.list.filter(function (x) { return x.id !== decodeURIComponent(m[1]); });
          return Promise.resolve(response(200, { ok: true, removed: account.list.length < had }));
        }
        return Promise.resolve(response(404, {}));
      },
      redirectToSignIn: function () {}
    },
    RevampPortals: {
      list: function () { return Promise.resolve(ROSTER.map(function (p) { return { slug: p.slug, name: p.name }; })); },
      working: function () { return Promise.resolve(o.working || 'cio'); }, cachedWorking: function () { return o.working || 'cio'; },
      setWorking: function (v) { return Promise.resolve(v); },
      nameOf: function (slug) { var p = ROSTER.filter(function (r) { return r.slug === slug; })[0]; return p ? p.name : ''; },
      chipHtml: function () { return ''; }, openSetPortal: function () {}
    }
  };
  ctx.localStorage = store(mem); ctx.sessionStorage = store(session);
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx, { filename: 'edit-event-core.js' });
  vm.runInContext(DRAFTS_JS, ctx, { filename: 'create-drafts.js' });
  vm.runInContext(LIFE, ctx, { filename: 'event-lifecycle.js' });
  vm.runInContext(INLINE, ctx, { filename: 'Event_Listing.html (inline)' });
  function $(id) { return d.getElementById(id); }
  return {
    ctx: ctx, dom: dom, $: $, calls: calls, account: account, mem: mem,
    box: function () { return $('create-drafts').textContent.replace(/\s+/g, ' ').trim(); },
    names: function () { return $('create-drafts').querySelectorAll('.cdraft-name').map(function (a) { return a.textContent; }); },
    tabs: function () { var t = {}; $('status-tabs').querySelectorAll('[data-tab]').forEach(function (b) { t[b.getAttribute('data-tab')] = b.querySelector('.tc').textContent; }); return t; },
    tab: function (name) { $('status-tabs').querySelector('[data-tab="' + name + '"]').click(); },
    search: function (q) { $('search-input').value = q; dom.fire($('search-input'), 'input'); },
    rows: function () { return $('table-body').querySelectorAll('[data-row]').map(function (tr) { return tr.getAttribute('data-row'); }); },
    list: function () { return $('table-body').textContent.replace(/\s+/g, ' ').trim(); },
    toasts: function () { return $('toast-region').textContent; }
  };
}

async function main() {
  var P = page();
  await flush();
  check('on another tab nothing of the drafts is shown', P.$('create-drafts').innerHTML === '' && !/Unfinished/.test(P.box()));
  check('the account\'s drafts are read once, with the person\'s sign-in', P.calls.filter(function (c) { return c === 'GET /api/me/create-drafts'; }).length === 1, P.calls);
  check('the Drafts tab counts the draft events and the unfinished drafts it shows (2 + 3)', P.tabs().draft === '5', P.tabs());
  P.tab('draft');
  check('Drafts: the box "Unfinished in Create Event" with its own count, above the draft events', /^Unfinished in Create Event\s*3\s*Events you started/.test(P.box()) && same(P.rows().sort(), ['draft-event-a', 'qa-ux-b08-made']), [P.box(), P.rows()]);
  check('…on the working portal only, with no-portal drafts too, and the other portal\'s one counted with where to see it',
    same(P.names(), ['CIO Annual Forum 2027', 'Untitled event', 'CIO Forum Made']) && P.box().indexOf('1 more is on other portals: choose All portals to see it.') !== -1, [P.names(), P.box()]);
  check('…told apart from the events: not events yet, saved to the account, resumable anywhere',
    P.box().indexOf('Events you started in Create Event and have not finished, saved to your account as you typed them. Resume one on any computer.') !== -1 &&
    P.box().indexOf('Not an event yet: it becomes one when you finish it in Create Event.') !== -1, P.box());
  check('…one that already made its event says so, and that the event is below', P.box().indexOf('Its event, qa-ux-b08-made, is already created: it is in the draft events below too.') !== -1, P.box());
  var first = P.$('create-drafts').querySelector('[data-cdraft="draft-mh1aaa-aaa111"]');
  check('…each row: its type, portal, where it stopped and when it was last edited', !!first && /IP event · ETCIO · Details and content · Last edited /.test(first.textContent), first && first.textContent);
  check('…the no-portal one says so, and where it stopped', /No portal yet · Choosing the portal and type/.test(P.$('create-drafts').querySelector('[data-cdraft="draft-mh1bbb-bbb222"]').textContent));
  var resume = first.querySelector('a.btn');
  check('…Resume opens Create Event on that draft (any computer: the draft is in the account)', resume.textContent === 'Resume' && resume.getAttribute('href') === 'create-event.html?draft=draft-mh1aaa-aaa111' &&
    first.querySelector('.cdraft-name').getAttribute('href') === 'create-event.html?draft=draft-mh1aaa-aaa111' && resume.getAttribute('aria-label') === 'Resume CIO Annual Forum 2027');

  /* the search narrows them, as it narrows the events, and the counts follow */
  P.search('annual');
  check('search: only the unfinished draft that matches, and the Drafts tab counts it', same(P.names(), ['CIO Annual Forum 2027']) && P.tabs().draft === '1' && P.rows().length === 0, [P.names(), P.tabs()]);
  check('…the empty list says the match is above, not "No matches"', /No draft events match/.test(P.list()) && P.list().indexOf('1 unfinished Create Event draft matches: it is above.') !== -1 && P.box().indexOf('2 do not match the search or filters.') !== -1, [P.list(), P.box()]);
  P.search('ETCIO');
  check('search by the portal\'s name finds them too', same(P.names(), ['CIO Annual Forum 2027', 'CIO Forum Made']), P.names());
  P.tab('active');
  P.search('annual');
  check('on another tab, "No matches" names Drafts, where the unfinished one is', /No matches in Active/.test(P.list()) && P.list().indexOf('1 in Drafts') !== -1, P.list());
  P.search('');
  P.tab('draft');

  /* Discard: asked first, then gone from the account and here, and the focus has somewhere to go */
  P.$('create-drafts').querySelector('[data-cdraft-discard="draft-mh1aaa-aaa111"]').click();
  var dlg = P.$('dlg-card');
  check('Discard asks first, naming the draft and what goes', !!dlg && P.$('dlg-title').textContent === 'Discard “CIO Annual Forum 2027”?' &&
    P.$('dlg-sub').textContent === 'Everything entered in this draft is deleted, from your account and from every computer, with its logo and pictures. This cannot be undone.' &&
    P.$('dlg-ok').textContent === 'Discard draft' && dlg.getAttribute('role') === 'dialog' && dlg.getAttribute('aria-modal') === 'true');
  P.$('dlg-cancel').click();
  await flush();
  check('…Cancel keeps it: nothing is sent', !P.$('dlg-card') && P.calls.every(function (c) { return !/^DELETE/.test(c); }) && P.names().length === 3);
  P.mem['revamp.createEvent.draft.v2.draft-mh1aaa-aaa111'] = '{}';
  P.mem['revamp.createEvent.current.v2'] = 'draft-mh1aaa-aaa111';
  P.$('create-drafts').querySelector('[data-cdraft-discard="draft-mh1aaa-aaa111"]').click();
  P.$('dlg-ok').click();
  await flush();
  check('…Discard draft removes it from the account', P.calls.indexOf('DELETE /api/me/create-draft?id=draft-mh1aaa-aaa111') !== -1 && !P.account.list.some(function (x) { return x.id === 'draft-mh1aaa-aaa111'; }), P.calls);
  check('…and from this browser, and from the list, with a toast; the counts follow', !('revamp.createEvent.draft.v2.draft-mh1aaa-aaa111' in P.mem) && !('revamp.createEvent.current.v2' in P.mem) &&
    same(P.names(), ['Untitled event', 'CIO Forum Made']) && P.tabs().draft === '4' && P.toasts().indexOf('Draft discarded: CIO Annual Forum 2027') !== -1, [P.names(), P.tabs(), P.toasts()]);
  check('…the focus goes to the next unfinished draft', P.dom.document.activeElement && P.dom.document.activeElement.textContent === 'Untitled event', P.dom.document.activeElement && P.dom.document.activeElement.textContent);
  P.$('create-drafts').querySelector('[data-cdraft-discard="draft-mh1ccc-ccc333"]').click();
  check('Discard of one that made its event says the event stays', P.$('dlg-card').textContent.indexOf('Its event, qa-ux-b08-made, is not deleted: it stays in your draft events.') !== -1);
  P.account.deleteFail = 1;
  P.$('dlg-ok').click();
  await flush();
  check('…a Discard that fails says so in the dialog, and nothing is taken off the list', P.$('dlg-error').hidden === false && P.$('dlg-error').textContent ===
    'The draft could not be discarded: Your draft could not be removed from your account. Please try again. It is still in your account.' && P.names().length === 2, [P.$('dlg-error').textContent, P.names()]);
  P.$('dlg-ok').click();
  await flush();
  check('…and Discard again works', !P.$('dlg-card') && same(P.names(), ['Untitled event']) && P.rows().indexOf('qa-ux-b08-made') !== -1, [P.names(), P.rows()]);

  /* All portals: every one, nothing said about other portals */
  P = page({ working: 'all' });
  await flush();
  P.tab('draft');
  check('All portals: every unfinished draft, and no "on other portals" line', P.names().length === 4 && P.box().indexOf('other portals') === -1, [P.names(), P.box()]);

  /* the Type filter and a date filter, from the address */
  P = page({ hash: '#tab=active&view=draft&type=awards', working: 'all' });
  await flush();
  check('the Type filter narrows them by their type (Awards)', same(P.names(), ['HR Awards Night']), P.names());
  P = page({ hash: '#tab=active&view=draft&created=2026-01-01..2026-12-31' });
  await flush();
  /* NU-032: with none shown, one line says why, and no box with a 0 in it */
  check('a date filter hides them, and says why (they have no dates yet), in one line with no empty box', P.names().length === 0 &&
    P.box().indexOf('3 unfinished Create Event drafts are not shown while a date filter is on: they have no dates yet.') === 0 && !P.$('create-drafts').querySelector('.cdrafts'), P.box());

  /* NU-032: none on the portal the person works in: no empty box, only where they are, with the way there */
  P = page({ working: 'hr', draftList: drafts().filter(function (x) { return x.summary.portal; }).map(function (x) { return x.summary.portal === 'hr' ? Object.assign({}, x, { summary: Object.assign({}, x.summary, { portal: 'cio' }) }) : x; }) });
  await flush();
  P.tab('draft');
  check('none on this portal: no "Unfinished in Create Event" box with a 0, one line instead: how many are on other portals, and Show them',
    P.box() === '3 unfinished Create Event drafts are on other portals. Show them' && !P.$('create-drafts').querySelector('.cdrafts') && !/Unfinished in Create Event/.test(P.box()) && !!P.$('cdrafts-elsewhere'), P.box());
  P.$('cdrafts-elsewhere').click();
  await flush();
  check('…Show them looks at every portal for now (the way back to the portal is on the notice), and lists them', P.names().length === 3 && /Back to ETHRWorld/.test(P.$('portal-notice').textContent), [P.names(), P.$('portal-notice').textContent]);

  /* no draft event at all, only unfinished ones */
  P = page({ noDraftEvents: true });
  await flush();
  P.tab('draft');
  check('no draft events but unfinished ones: the list says the unfinished ones are above', /No draft events/.test(P.list()) && P.list().indexOf('Your unfinished Create Event drafts are above.') !== -1 && P.names().length === 3, [P.list(), P.names()]);

  /* none at all: no box */
  P = page({ draftList: [] });
  await flush();
  P.tab('draft');
  check('no unfinished drafts: no box, and the tab counts the draft events only', P.$('create-drafts').innerHTML === '' && P.tabs().draft === '2', P.tabs());

  /* the account cannot be read: said in the box, with Try again; the events are not affected */
  P = page({ listFail: 1 });
  await flush();
  P.tab('draft');
  check('the drafts cannot be read: said, with Try again, and the draft events still listed', /Your unfinished Create Event drafts could not be loaded: Your drafts could not be read\. Please try again\. Your events below are not affected\./.test(P.box()) &&
    !!P.$('cdrafts-retry') && P.rows().length === 2 && P.$('create-drafts').querySelector('[role="alert"]') !== null, P.box());
  P.$('cdrafts-retry').click();
  await flush();
  check('…Try again reads them', P.names().length === 3, P.names());

  /* the "Updated" button reads them again */
  P = page();
  await flush();
  var before = P.calls.filter(function (c) { return c === 'GET /api/me/create-drafts'; }).length;
  P.$('btn-sync').click();
  await flush();
  check('"Updated" reads the unfinished drafts again too', P.calls.filter(function (c) { return c === 'GET /api/me/create-drafts'; }).length === before + 1, P.calls);

  console.log('events-dashboard-drafts: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
main().catch(function (e) { console.error('CRASH ' + (e && e.stack || e)); process.exit(1); });
