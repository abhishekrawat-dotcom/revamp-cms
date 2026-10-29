// node functions/lib/promo-studio.test.js — Promotions → Mailers' page (promo-mailer-studio.html): the platform's
// studio and mailer dashboard as tools/extract-promo-studio.py copies and patches them, and Oneworld's side of it
// (promo-studio/oneworld.js, oneworld.css and oneworld-theme.js). No network: oneworld.js and oneworld-theme.js run
// in a vm over stubs of the platform's functions, of RevampAuth and of the page around the frame.
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function count(s, sub) { return s.split(sub).length - 1; }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var studio = read('promo-studio/mailer-studio.js');
var page = read('promo-mailer-studio.html');
var owSrc = read('promo-studio/oneworld.js');
var owCss = read('promo-studio/oneworld.css');
var py = read('tools/extract-promo-studio.py');

/* ---- the generated studio code carries the dashboard, the nav and every patch ---- */
['function paintAnalytics', 'async function showAnalytics', 'function setProdNav', 'anOpenRow(${i})', 'anToggleVer(${i})', 'owDashPickLabel()',
  'AN.fresh=true', 'owTrackToast("download"', 'owTrackToast("copy"', 'owTrackToast("zip"'].forEach(function (s) {
  check('the studio code has ' + s, studio.indexOf(s) !== -1);
});
check('the dashboard subline is Oneworld\'s, in the skeleton and the painted page', count(studio, 'owDashSubline()') === 2, count(studio, 'owDashSubline()'));
check('no Vercel left in the studio\'s words', studio.indexOf('vercel') === -1);
check('no data written into a row\'s inline handler', studio.indexOf('anOpen(\'${') === -1);
check('the Link tracking hint is Oneworld\'s', studio.indexOf('no Oneworld address on hover') !== -1 && studio.indexOf('Opens are counted either way.') !== -1 &&
  studio.indexOf('(if tracking is configured') === -1);
check('the Link tracking field is still the one oneworld.css hides (its selector still matches)', studio.indexOf('<select onchange="MD.doc.trackLinks=') !== -1);
check('the code says it carries patches', /unchanged except PATCHES \(listed in tools\/extract-promo-studio\.py\)/.test(studio.slice(0, 400)));
function compiles(src, name) { try { new vm.Script(src, { filename: name }); return true; } catch (e) { return String(e && e.message); } }
check('mailer-studio.js parses', compiles(studio, 'mailer-studio.js') === true, compiles(studio, 'mailer-studio.js'));
check('oneworld.js parses', compiles(owSrc, 'oneworld.js') === true, compiles(owSrc, 'oneworld.js'));

/* ---- P1: escapeHtml escapes quotes too ---- */
var escLines = studio.split('\n').filter(function (l) { return /^const escapeHtml=/.test(l); });
check('one escapeHtml', escLines.length === 1, escLines.length);
var escaped = escLines.length ? vm.runInNewContext(escLines[0] + '\nescapeHtml(input)', { input: 'a"b\'c<d>&' }) : null;
check('escapeHtml: a"b\'c<d>& -> a&quot;b&#39;c&lt;d&gt;&amp;', escaped === 'a&quot;b&#39;c&lt;d&gt;&amp;', escaped);

/* ---- every patch is applied exactly as listed in the extractor ---- */
var pStart = py.indexOf('PATCHES = [');
var pBlock = py.slice(pStart, py.indexOf('\n]\n', pStart));
var patchRe = /\(r'''([\s\S]*?)''',\s*r'''([\s\S]*?)''',\s*(\d+),/g, pm, patches = [];
while ((pm = patchRe.exec(pBlock))) patches.push({ old: pm[1], neu: pm[2], times: Number(pm[3]) });
check('ten patches, P1 to P10', patches.length === 10, patches.length);
patches.forEach(function (p, i) {
  check('P' + (i + 1) + ': the platform\'s text is gone', count(studio, p.old) === 0, count(studio, p.old));
  check('P' + (i + 1) + ': its replacement is there ' + p.times + ' time(s)', count(studio, p.neu) === p.times, count(studio, p.neu));
});

/* ---- the page: the nav above the content ---- */
var order = ['class="ow-bar"', 'id="prodNav"', 'data-v="dash"', 'data-v="events"', 'id="content"'].map(function (s) { return page.indexOf(s); });
check('ow-bar, the nav and its two buttons come before the content, in that order', order.every(function (n, i) { return n !== -1 && (i === 0 || n > order[i - 1]); }), order);
check('one nav', count(page, 'id="prodNav"') === 1);
check('oneworld.js is the last script, after the studio', page.indexOf('src="promo-studio/mailer-studio.js"') !== -1 &&
  page.indexOf('src="promo-studio/mailer-studio.js"') < page.indexOf('src="promo-studio/oneworld.js"') &&
  page.indexOf('<script', page.indexOf('src="promo-studio/oneworld.js"')) === -1);

/* ---- oneworld.css ---- */
var cssRules = owCss.replace(/\/\*[\s\S]*?\*\//g, '');
check('Link tracking is hidden only while tracking is off for the event',
  cssRules.indexOf('body.ow-notrack .ml-props .fld:has(> select[onchange^="MD.doc.trackLinks"]){display:none}') !== -1 &&
  cssRules.split('\n').filter(function (l) { return /trackLinks/.test(l); }).every(function (l) { return /^body\.ow-notrack /.test(l.trim()); }));
check('the nav row', cssRules.indexOf('.ow-bar{display:flex;align-items:center;padding:14px 26px 0}') !== -1 && cssRules.indexOf('.ow-bar .pnav{margin-left:0}') !== -1);
check('the Recent mailers table scrolls inside its card', cssRules.indexOf('.an-card:has(> .an-tbl){overflow-x:auto}') !== -1);
check('the ranking cards never ask for more than the content\'s width', cssRules.indexOf('.an-grid{grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))!important}') !== -1 &&
  studio.indexOf('<div class="an-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));') !== -1);

/* ---- oneworld.js is ES5 apart from what it already had (async mlExport) ---- */
var owCode = owSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
check('oneworld.js: no let', !/\blet\s/.test(owCode));
check('oneworld.js: no const', !/\bconst\s/.test(owCode));
check('oneworld.js: no arrow functions', owCode.indexOf('=>') === -1);

/* ---- oneworld.js in a vm ---- */
function load(search, o) {
  o = o || {};
  var els = {}, owned = {}, bodyClass = {}, calls = { toast: [], open: [], paint: 0, nav: [], fetch: [] };
  function el(id) {
    var e = { id: id, _html: '', onclick: null, textContent: '', title: '', classList: { contains: function () { return false; } } };
    Object.defineProperty(e, 'innerHTML', { get: function () { return e._html; }, set: function (h) { setHtml(e, String(h)); } });
    return e;
  }
  /* writing a container's markup replaces the elements it held, as in a page */
  function setHtml(e, h) {
    (owned[e.id] || []).forEach(function (id) { delete els[id]; });
    owned[e.id] = [];
    e._html = h;
    adopt(e, h);
  }
  function adopt(e, h) {
    (h.match(/id="([^"]+)"/g) || []).forEach(function (m) { var id = m.slice(4, -1); els[id] = el(id); owned[e.id].push(id); });
  }
  ['content', 'mailer', 'prodNav'].forEach(function (id) { els[id] = el(id); });
  var navEvents = { textContent: 'Events', title: 'Pick a portal and an event' };
  var win = { top: { location: { href: '' } } };
  win.parent = win;
  win.fetch = function () { return Promise.reject(new Error('no network in tests')); };
  win.RevampAuth = {
    whenResolved: function () { return o.boot ? Promise.resolve('someone@example.com') : new Promise(function () {}); },
    authedFetch: function (url) { calls.fetch.push(url); return o.respond ? o.respond(url) : new Promise(function () {}); }
  };
  var sb = {
    window: win, location: { search: search, origin: 'https://oneworld.example' }, URLSearchParams: URLSearchParams,
    setTimeout: setTimeout, clearTimeout: clearTimeout, console: console,
    document: {
      body: { classList: { toggle: function (c, on) { bodyClass[c] = !!on; } } },
      querySelector: function (sel) {
        if (sel === '#prodNav [data-v="events"]') return navEvents;
        if (sel === '#content .ml-err') return /class="ml-err"/.test(els.content._html) ? { insertAdjacentHTML: function (pos, h) { els.content._html += h; adopt(els.content, h); } } : null;
        return null;
      }
    },
    AN: { range: 30, tmplMetric: 'opens', subjMetric: 'opens', data: null, openVer: null },
    MAILERS: null,
    $: function (id) { return els[id] || null; },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function (m, ms) { calls.toast.push(arguments.length > 1 ? [m, ms] : [m]); },
    openMailer: function (id, saveId) { calls.open.push([id, saveId]); },
    closeMailer: function () {},
    /* the platform's showAnalytics is replaced by oneworld.js's own; the platform's paintAnalytics draws the dashboard */
    showAnalytics: function () { throw new Error('the platform\'s showAnalytics ran: oneworld.js should replace it'); },
    paintAnalytics: function () {
      calls.paint++;
      if (o.paintThrows) throw new TypeError('vs.map is not a function');
      els.content.innerHTML = '<div class="page-h"><div><h2>Mailer performance</h2></div></div>';
    },
    rankCard: o.rankCard || function () { return ''; },
    setProdNav: function (v) { calls.nav.push(v); },
    findMailer: function (id) { return sb.MAILERS && (sb.MAILERS.mailers || []).filter(function (m) { return m.id === id; })[0]; },
    skEventPage: function () { return '<div class="sk-page"></div>'; },
    renderEvSaved: function () { return ''; },
    mailerCards: function () { return ''; }
  };
  vm.createContext(sb);
  vm.runInContext(owSrc, sb, { filename: 'oneworld.js' });
  return { sb: sb, els: els, calls: calls, bodyClass: bodyClass, navEvents: navEvents, win: win };
}
function json(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, headers: { get: function () { return null; } }, json: function () { return Promise.resolve(body); } }); }
function settle(ms) { return new Promise(function (ok) { setTimeout(ok, ms || 15); }); }
/* an answer the test lets through when it chooses: d.p is the promise, d.go(response) answers it */
function deferred() { var d = {}; d.p = new Promise(function (ok) { d.go = function (v) { v.then(ok); }; }); return d; }
/* the dashboard's requests a page made (the landing's peek included) */
function dashLoads(x) { return x.calls.fetch.filter(function (u) { return /^\/api\/promo\/analytics/.test(u); }); }
function lastNav(x) { return x.calls.nav[x.calls.nav.length - 1]; }

/* scope and the dashboard's addresses */
var ev = load('?event=x');
check('?event=x is the event scope', ev.sb.OW_SCOPE === 'event');
check('the event\'s numbers', ev.sb.owUrl('/api/analytics') === '/api/promo/analytics?eventId=x', ev.sb.owUrl('/api/analytics'));
ev.sb.AN.fresh = true;
check('the event\'s numbers are never cached, so fresh is not sent, and is used up', ev.sb.owUrl('/api/analytics') === '/api/promo/analytics?eventId=x' && ev.sb.AN.fresh === false);
check('an event id is encoded', load('?event=a%26b').sb.owUrl('/api/analytics') === '/api/promo/analytics?eventId=a%26b');
check('the catalog address is unchanged', ev.sb.owUrl('/api/mailers?portal=&event=x') === '/api/promo/mailers?eventId=x');
var team = load('?scope=all');
check('?scope=all is the team scope', team.sb.OW_SCOPE === 'all');
check('the team\'s numbers', team.sb.owUrl('/api/analytics') === '/api/promo/analytics/all', team.sb.owUrl('/api/analytics'));
team.sb.AN.fresh = true;
check('Refresh / Try again skip the team cache once', team.sb.owUrl('/api/analytics') === '/api/promo/analytics/all?fresh=1' && team.sb.AN.fresh === false &&
  team.sb.owUrl('/api/analytics') === '/api/promo/analytics/all');
check('an event in the address wins over scope=all', load('?event=x&scope=all').sb.OW_SCOPE === 'event');
check('the subline and the empty-state button per scope',
  ev.sb.owDashSubline() === 'Opens and clicks for every mailer of this event downloaded or copied from Oneworld.' && ev.sb.owDashPickLabel() === 'Make a mailer →' &&
  team.sb.owDashSubline() === 'Opens and clicks for every mailer downloaded or copied from this platform.' && team.sb.owDashPickLabel() === 'Pick an event →');
ev.sb.owNavLabels(); team.sb.owNavLabels();
check('the nav reads Dashboard / Mailers on an event', ev.navEvents.textContent === 'Mailers' && ev.navEvents.title === 'This event\'s mailers', ev.navEvents);
check('the nav reads Dashboard / Events for the team', team.navEvents.textContent === 'Events' && team.navEvents.title === 'Pick an event', team.navEvents);

/* the toasts: kind × state */
var TOASTS = {
  download: {
    tracked: ['Downloaded m.html — opens and clicks will show on your dashboard once it\'s sent.', 5000],
    off: ['Downloaded m.html', 5000],
    untracked: ['Downloaded m.html — not tracked this time, so its opens and clicks won\'t show on your dashboard. Download it again to track it.', 5000]
  },
  copy: {
    tracked: ['HTML copied — paste into your ESP'],
    off: ['HTML copied — paste into your ESP'],
    untracked: ['HTML copied — not tracked this time, so its opens and clicks won\'t show on your dashboard. Copy it again to track it.', 5000]
  },
  zip: {
    tracked: ['Downloaded — saved edits included'],
    off: ['Downloaded — saved edits included'],
    untracked: ['Downloaded — saved edits included. Not tracked this time: download again to see their opens and clicks on your dashboard.', 5000]
  }
};
Object.keys(TOASTS).forEach(function (kind) {
  var t = load('?event=x'), f = kind === 'download' ? 'm.html' : '';
  t.sb.MAILERS = { tracking: true };
  t.sb.owTrackToast(kind, true, f); check(kind + ' toast, tracked', JSON.stringify(t.calls.toast.pop()) === JSON.stringify(TOASTS[kind].tracked));
  t.sb.owTrackToast(kind, false, f); check(kind + ' toast, untracked this time', JSON.stringify(t.calls.toast.pop()) === JSON.stringify(TOASTS[kind].untracked));
  t.sb.MAILERS = { tracking: false };
  t.sb.owTrackToast(kind, true, f); check(kind + ' toast, tracking off', JSON.stringify(t.calls.toast.pop()) === JSON.stringify(TOASTS[kind].off));
  t.sb.owTrackToast(kind, false, f); check(kind + ' toast, tracking off wins over the flag', JSON.stringify(t.calls.toast.pop()) === JSON.stringify(TOASTS[kind].off));
});

/* the dashboard's rows go by index */
var rows = load('?event=x');
rows.sb.AN.data = { topOpenedTemplates: [{ key: 'mailer.a' }, { key: 'mailer.b' }], topClickedTemplates: [{ key: 'mailer.c' }],
  sends: [{ portal: 'p0', event: 'x', mailerId: 'mailer.a', eventName: 'E0', saveId: 's0' }, { portal: 'p1', event: 'y', mailerId: 'mailer.b', eventName: 'E1', saveId: 's1' }] };
rows.sb.anToggleVer(0);
check('anToggleVer(0) opens row 0\'s versions and repaints', rows.sb.AN.openVer === 'mailer.a' && rows.calls.paint === 1);
rows.sb.anToggleVer(0);
check('anToggleVer(0) again closes them', rows.sb.AN.openVer === null && rows.calls.paint === 2);
rows.sb.AN.tmplMetric = 'clicks'; rows.sb.anToggleVer(0);
check('anToggleVer follows the template metric', rows.sb.AN.openVer === 'mailer.c');
rows.sb.anToggleVer(4);
check('anToggleVer on a row that is not there does nothing', rows.sb.AN.openVer === 'mailer.c' && rows.calls.paint === 3);
var opened = [];
rows.sb.anOpen = function () { opened.push(Array.prototype.slice.call(arguments)); };
rows.sb.anOpenRow(1);
check('anOpenRow(1) opens row 1', JSON.stringify(opened) === JSON.stringify([['p1', 'y', 'mailer.b', 'E1', 's1']]), opened);
rows.sb.anOpenRow(7);
check('anOpenRow on a row that is not there does nothing', opened.length === 1);

/* anOpen: this event's row in this page's studio; anything else through Promotions */
var ao = load('?event=x');
ao.sb.MAILERS = { mailers: [{ id: 'mailer.a', available: true }, { id: 'mailer.b', available: false }], event: { name: 'X' } };
ao.sb.anOpen('p', 'x', 'mailer.a', 'X', 's1');
check('this event\'s row: its mailer page, then the studio on that version', JSON.stringify(ao.calls.open) === JSON.stringify([['mailer.a', 's1']]) &&
  ao.calls.nav[ao.calls.nav.length - 1] === 'events' && /ev-head/.test(ao.els.content.innerHTML), ao.calls);
ao.sb.anOpen('p', 'x', 'mailer.b', 'X', '');
check('a mailer the event no longer offers is said so, not swapped for another', ao.calls.open.length === 1 &&
  ao.calls.toast.pop()[0] === 'That mailer is not available for this event any more');
ao.sb.anOpen('p', 'other-ev', 'mailer.a', 'O', 's 2');
check('another event\'s row opens its Promotions → Mailers', ao.win.top.location.href === '/marketing.html?event=other-ev&tab=mailers&mailer=mailer.a&version=s%202', ao.win.top.location.href);
var at = load('?scope=all');
at.sb.anOpen('p', 'ev-1', 'mailer.a', 'E', '');
check('the team\'s row opens that event (no version when the row had none)', at.win.top.location.href === '/marketing.html?event=ev-1&tab=mailers&mailer=mailer.a', at.win.top.location.href);

/* showPortals: the nav's second place */
var sp = load('?scope=all'); sp.sb.showPortals();
check('team: Events goes to the event listing', sp.win.top.location.href === '/Event_Listing.html');
var sp2 = load('?event=x'); sp2.sb.MAILERS = { mailers: [], event: {} }; sp2.sb.showPortals();
check('event: Mailers shows the event\'s mailer page', sp2.calls.nav[0] === 'events' && /ev-head/.test(sp2.els.content.innerHTML) && sp2.calls.fetch.length === 0);

var CATALOG = { event: { name: 'X', portal: 'health' }, mailers: [{ id: 'mailer.a', available: true, suggested: 1 }], tracking: true };
function respond(catalog, analytics) {
  return function (url) {
    if (/^\/api\/promo\/mailers\?/.test(url)) return catalog;
    if (/^\/api\/promo\/analytics/.test(url)) return analytics;
    return json(404, { error: 'nope' });
  };
}

var pending = [];
/* showPortals before the catalog ever loaded: the mailer page, with no detour to the dashboard */
var sp3 = load('?event=x', { respond: respond(json(200, CATALOG), json(200, { totals: { sends: 4 } })) });
sp3.sb.showPortals();
pending.push(settle().then(function () {
  check('event: Mailers before the catalog loaded loads it and lands on the mailer page, numbers not asked',
    sp3.calls.paint === 0 && /ev-head/.test(sp3.els.content.innerHTML) && sp3.calls.fetch.join() === '/api/promo/mailers?eventId=x', sp3.calls);
}));

/* the dashboard: oneworld.js's showAnalytics (the platform's, with the view check and Try again) */
check('oneworld.js replaces the platform\'s showAnalytics with a declaration of its own', /\nfunction showAnalytics\(\) \{/.test(owSrc) && owSrc.indexOf('owShowAnalytics') === -1);
var skel = /async function showAnalytics\(\)\{[\s\S]*?if\(!AN\.data\) \$\("content"\)\.innerHTML=(`[\s\S]*?`);\n/.exec(studio);
var platformSkeleton = skel ? vm.runInNewContext(skel[1], { owDashSubline: function () { return 'SUB'; } }) : null;
var sk = load('?event=x');
sk.sb.owDashSubline = function () { return 'SUB'; };
function squeeze(h) { return String(h).replace(/\s+/g, ' '); }
check('its loading skeleton is the platform\'s, word for word', !!platformSkeleton && squeeze(sk.sb.owDashSkeleton()) === squeeze(platformSkeleton), [platformSkeleton, sk.sb.owDashSkeleton()]);
check('its error is the platform\'s', studio.indexOf('$("content").innerHTML=`<div class="ml-err">Could not load analytics.</div>`') !== -1 &&
  sk.sb.OW_DASH_FAILED === '<div class="ml-err">Could not load analytics.</div>');

/* the dashboard's errors end on Try again */
var de = load('?scope=all', { respond: function (url) { return /analytics/.test(url) ? Promise.reject(new TypeError('Failed to fetch')) : json(404, {}); } });
de.sb.showAnalytics();
pending.push(settle().then(function () {
  check('a failed request shows the error with Try again', /Could not load analytics\./.test(de.els.content.innerHTML) && !!de.els.owDashAgain, de.els.content.innerHTML);
  de.els.owDashAgain.onclick();
  check('Try again forgets the numbers, skips the team cache once and asks again', de.sb.AN.data === null && de.sb.AN.fresh === false &&
    JSON.stringify(dashLoads(de)) === JSON.stringify(['/api/promo/analytics/all', '/api/promo/analytics/all?fresh=1']), dashLoads(de));
  return settle().then(function () {
    check('a second failure shows one Try again', count(de.els.content.innerHTML, 'id="owDashAgain"') === 1, de.els.content.innerHTML);
  });
}));
var dh = load('?event=x', { respond: function () { return json(500, { error: 'Mailer performance could not be loaded. Please try again.' }); } });
dh.sb.showAnalytics();
dh.sb.showAnalytics();
pending.push(settle().then(function () {
  check('"Could not load analytics." gets Try again, once when two loads failed together',
    /Could not load analytics\./.test(dh.els.content.innerHTML) && count(dh.els.content.innerHTML, 'id="owDashAgain"') === 1 && dashLoads(dh).length === 2, dh.els.content.innerHTML);
}));
var dok = load('?event=x', { respond: function () { return json(200, { totals: { sends: 1 } }); } });
dok.sb.showAnalytics();
check('while it loads: the skeleton, and the nav on Dashboard', /class="sk"/.test(dok.els.content.innerHTML) && lastNav(dok) === 'dash');
pending.push(settle().then(function () {
  check('a dashboard that loaded is painted, with no Try again', !dok.els.owDashAgain && dok.calls.paint === 1 && dok.sb.AN.data.totals.sends === 1 &&
    /Mailer performance/.test(dok.els.content.innerHTML));
}));
var dp = load('?event=x', { paintThrows: true, respond: function () { return json(200, { totals: { sends: 1 } }); } });
dp.sb.showAnalytics();
pending.push(settle().then(function () {
  check('numbers that cannot be drawn end on the error and Try again, not a stuck skeleton', /Could not load analytics\./.test(dp.els.content.innerHTML) && !!dp.els.owDashAgain);
}));

/* one place at a time (OW_VIEW): a dashboard answer that comes after the user moved on is dropped */
var r1d = deferred();
var r1 = load('?event=x', { respond: function (url) { return /analytics/.test(url) ? r1d.p : json(404, {}); } });
r1.sb.MAILERS = { mailers: [], event: {} };
r1.sb.showAnalytics();
r1.sb.showPortals();                                   // Mailers, clicked before the numbers came
r1d.go(json(200, { totals: { sends: 3 } }));
pending.push(settle().then(function () {
  check('Dashboard, then Mailers before its numbers came: the late numbers do not paint over the mailer page',
    /ev-head/.test(r1.els.content.innerHTML) && r1.calls.paint === 0 && lastNav(r1) === 'events', [r1.calls.paint, r1.calls.nav]);
}));
var r2d = deferred();
var r2 = load('?event=x', { respond: function (url) { return /analytics/.test(url) ? r2d.p : json(404, {}); } });
r2.sb.MAILERS = { mailers: [], event: {} };
r2.sb.showAnalytics();
r2.sb.showPortals();
r2d.go(json(500, { error: 'x' }));
pending.push(settle().then(function () {
  check('… nor does a late failure write its error over it', /ev-head/.test(r2.els.content.innerHTML) && !/ml-err/.test(r2.els.content.innerHTML) && !r2.els.owDashAgain);
}));
var r3d = deferred();
var r3 = load('?event=x', { respond: function (url) { return /analytics/.test(url) ? r3d.p : json(404, {}); } });
r3.sb.MAILERS = { mailers: [{ id: 'mailer.a', available: true }], event: {} };
r3.sb.showAnalytics();
r3.sb.owRenderPage(); r3.sb.openMailer('mailer.a', null);   // a mailer card, then the studio, while the numbers load
r3d.go(json(200, { totals: { sends: 3 } }));
pending.push(settle().then(function () {
  check('the studio opened while the numbers load: closing it still shows the mailer page', /ev-head/.test(r3.els.content.innerHTML) && r3.calls.paint === 0);
}));
var r4d = deferred();
var r4 = load('?event=x', { respond: function (url) { return /analytics/.test(url) ? json(200, { totals: { sends: 1 } }) : r4d.p; } });
r4.sb.owBoot();
r4.sb.showAnalytics();                                 // Dashboard, clicked while the Mailers tab was still loading
pending.push(settle().then(function () {
  check('Dashboard clicked while the tab loads: it shows', r4.calls.paint === 1 && lastNav(r4) === 'dash');
  r4d.go(json(200, CATALOG));
  return settle().then(function () {
    check('… and the catalog answering later does not swap it for the mailer page', !/ev-head/.test(r4.els.content.innerHTML) &&
      /Mailer performance/.test(r4.els.content.innerHTML) && lastNav(r4) === 'dash' && r4.calls.paint === 1, [r4.calls.nav, r4.els.content.innerHTML.slice(0, 80)]);
    check('… while the catalog it brought is kept for the nav\'s Mailers', !!r4.sb.MAILERS && r4.sb.MAILERS.event.name === 'X' && r4.bodyClass['ow-notrack'] === false);
  });
}));
var r5c = deferred(), r5a = deferred();
var r5 = load('?event=x', { respond: function (url) { return /analytics/.test(url) ? r5a.p : r5c.p; } });
r5.sb.owBoot();
r5.sb.showAnalytics();
r5c.go(json(200, CATALOG));                            // the catalog first, then the dashboard's numbers
pending.push(settle().then(function () {
  check('… the other way round: the catalog first does not draw the mailer page under the Dashboard pill', !/ev-head/.test(r5.els.content.innerHTML) && lastNav(r5) === 'dash');
  r5a.go(json(200, { totals: { sends: 1 } }));
  return settle().then(function () { check('… and the numbers then paint the dashboard', r5.calls.paint >= 1 && /Mailer performance/.test(r5.els.content.innerHTML) && lastNav(r5) === 'dash'); });
}));

/* the platform's rankCard: a template's versions only as the server listed them */
var rankSrc = (/\nfunction rankCard\(title,id,rows,metric,versions\)\{[\s\S]*?\n\}\n/.exec(studio) || [''])[0];
var kfmtLine = studio.split('\n').filter(function (l) { return /^const kFmt=/.test(l); })[0] || '';
check('the platform\'s rankCard and kFmt are in the studio code', !!rankSrc && !!kfmtLine);
var rankCtx = vm.createContext({ AN: { openVer: null } });
vm.runInContext(escLines[0] + '\n' + kfmtLine + '\n' + rankSrc + '\nthis.rankCard = rankCard;', rankCtx);
var ROWS = [{ key: 'constructor', label: 'Odd', sends: 2, opens: 3, clicks: 1 }, { key: '__proto__', label: 'Odder', sends: 2, opens: 2, clicks: 0 },
  { key: 'mailer.a', label: 'Announcement', sends: 2, opens: 1, clicks: 0 }];
var VERSIONS = JSON.parse('{"__proto__":[{"key":"v1","label":"V1","sends":1,"opens":1,"clicks":0},{"key":"v2","label":"V2","sends":1,"opens":1,"clicks":0}]}');
var platformThrew = null;
try { rankCtx.rankCard('Top templates', 'tmpl', ROWS, 'opens', {}); } catch (e) { platformThrew = String(e && e.message); }
check('as copied, the platform\'s rankCard throws on a template keyed "constructor" (the reason for the wrapper)', /is not a function/.test(String(platformThrew)), platformThrew);
var rk = load('?event=x', { rankCard: rankCtx.rankCard });
var card = null, cardErr = null;
try { card = rk.sb.rankCard('Top templates', 'tmpl', ROWS, 'opens', VERSIONS); } catch (e) { cardErr = String(e && e.message); }
check('wrapped, a template keyed "constructor" is an ordinary row, and "__proto__" keeps its own 2 versions', !cardErr && /Odd/.test(card) &&
  count(card, 'class="vct"') === 1 && /Odder<span class="vct">2 versions<\/span>/.test(card), cardErr || card);
check('wrapped, subjects (no versions) are drawn as before', /Odd/.test(rk.sb.rankCard('Top subject lines', 'subj', ROWS, 'opens', undefined)));

/* the landing */
var l1 = load('?event=x', { boot: true, respond: respond(json(200, CATALOG), json(200, { totals: { sends: 2 } })) });
pending.push(settle(30).then(function () {
  check('an event with mailers out opens on its dashboard', l1.calls.paint === 1 && lastNav(l1) === 'dash' && l1.sb.AN.data && l1.sb.AN.data.totals.sends === 2 &&
    /Mailer performance/.test(l1.els.content.innerHTML), l1.calls);
  check('the numbers are asked for alongside the catalog, and only once', JSON.stringify(dashLoads(l1)) === JSON.stringify(['/api/promo/analytics?eventId=x']) &&
    l1.calls.fetch.indexOf('/api/promo/mailers?eventId=x') !== -1, l1.calls.fetch);
  check('tracking on: Link tracking shows', l1.bodyClass['ow-notrack'] === false);
  check('the nav is labelled for the event', l1.navEvents.textContent === 'Mailers');
  l1.sb.showPortals();                                 // the nav's Mailers, right after landing
  return settle().then(function () {
    check('Mailers after landing on the dashboard stays on the mailer page (no second read lands on it)', /ev-head/.test(l1.els.content.innerHTML) &&
      lastNav(l1) === 'events' && l1.calls.paint === 1 && dashLoads(l1).length === 1, l1.calls);
  });
}));
var l2 = load('?event=x', { boot: true, respond: respond(json(200, Object.assign({}, CATALOG, { tracking: false })), json(200, { totals: { sends: 0 } })) });
pending.push(settle(30).then(function () {
  check('an event with none opens on its mailer page', l2.calls.paint === 0 && /ev-head/.test(l2.els.content.innerHTML) && l2.calls.nav.indexOf('events') !== -1, l2.calls);
  check('tracking off: Link tracking is hidden', l2.bodyClass['ow-notrack'] === true);
}));
var l3 = load('?event=x', { boot: true, respond: respond(json(200, CATALOG), json(404, { error: 'event-not-found' })) });
pending.push(settle(30).then(function () { check('numbers that could not be had: the mailer page', l3.calls.paint === 0 && /ev-head/.test(l3.els.content.innerHTML)); }));
var l4 = load('?event=x', { boot: true, respond: respond(json(200, CATALOG), new Promise(function () {})) });
l4.sb.OW_PEEK_MS = 40;
pending.push(settle(120).then(function () { check('numbers that never come do not hold up the mailer page (capped at OW_PEEK_MS)', l4.calls.paint === 0 && /ev-head/.test(l4.els.content.innerHTML), l4.els.content.innerHTML); }));
var l4b = load('?event=x', { boot: true, paintThrows: true, respond: respond(json(200, CATALOG), json(200, { totals: { sends: 2 } })) });
pending.push(settle(30).then(function () {
  check('landing numbers that cannot be drawn: the dashboard\'s error and Try again', /Could not load analytics\./.test(l4b.els.content.innerHTML) && !!l4b.els.owDashAgain);
}));
var l5 = load('?event=x', { boot: true, respond: respond(json(500, { error: 'The catalog broke' }), json(200, { totals: { sends: 2 } })) });
pending.push(settle(30).then(function () {
  check('a catalog that failed: the error, Try again, and the nav to the dashboard', /Mailers could not be loaded/.test(l5.els.content.innerHTML) &&
    /The catalog broke/.test(l5.els.content.innerHTML) && !!l5.els.owBootAgain && lastNav(l5) === 'events' && l5.calls.paint === 0, l5.calls);
}));
var l6 = load('?event=x&mailer=mailer.a&version=s9', { boot: true, respond: respond(json(200, CATALOG), json(200, { totals: { sends: 2 } })) });
pending.push(settle(30).then(function () {
  check('a deep link opens the studio on that version, over the mailer page', JSON.stringify(l6.calls.open) === JSON.stringify([['mailer.a', 's9']]) &&
    /ev-head/.test(l6.els.content.innerHTML) && l6.calls.paint === 0, l6.calls);
  check('a deep link does not ask for the numbers', l6.calls.fetch.join() === '/api/promo/mailers?eventId=x', l6.calls.fetch);
}));
var l7 = load('?scope=all', { boot: true, respond: respond(json(200, CATALOG), json(200, { totals: { sends: 0 } })) });
pending.push(settle(30).then(function () {
  check('the team\'s page is the dashboard alone (no catalog)', l7.calls.paint === 1 && l7.calls.fetch.join() === '/api/promo/analytics/all', l7.calls);
  check('the nav is labelled for the team', l7.navEvents.textContent === 'Events' && l7.navEvents.title === 'Pick an event');
}));
var l8 = load('', { boot: true, respond: respond(json(200, CATALOG), json(200, {})) });
pending.push(settle(30).then(function () { check('no event and no scope: "No event"', /No event/.test(l8.els.content.innerHTML) && l8.calls.fetch.length === 0 && l8.calls.paint === 0); }));

/* ---- Oneworld's look: light or dark as the page around it (promo-studio/oneworld-theme.js), and never Liquid ---- */
var themeSrc = read('promo-studio/oneworld-theme.js');
var THEME_TAG = '<script src="promo-studio/oneworld-theme.js"></script>';
check('the theme script parses', compiles(themeSrc, 'oneworld-theme.js') === true, compiles(themeSrc, 'oneworld-theme.js'));
var themeCode = themeSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
check('the theme script is ES5', !/\blet\s/.test(themeCode) && !/\bconst\s/.test(themeCode) && themeCode.indexOf('=>') === -1);
check('the page loads it once, in its head, before any stylesheet (the first paint is already in the theme)',
  count(page, THEME_TAG) === 1 && page.indexOf(THEME_TAG) < page.indexOf('<link rel="stylesheet"') && page.indexOf(THEME_TAG) < page.indexOf('</head>'));
check('the extractor writes the same tag in the same place', count(py, THEME_TAG) === 1 && py.indexOf(THEME_TAG) < py.indexOf('<link rel="stylesheet" href="promo-studio/mailer-studio.css">'));
/* the platform keeps its Liquid choice in localStorage "mlTheme" and sets it as data-theme; none of that was copied */
check('the platform\'s Liquid switch is not on the page and its stored choice is never read', page.indexOf('theme-toggle') === -1 &&
  studio.indexOf('localStorage') === -1 && !/dataset\.theme\s*=|data-theme/.test(studio) && owSrc.indexOf('data-theme') === -1);

/* runs the theme script: parent is the framing page's <html> attributes (null: not framed), stored is revamp-theme,
   sysDark the system's preference. Returns the page's <html> and a way to fire what the script listens to. */
function runTheme(o) {
  var attrs = {}, observed = [], listeners = {};
  var root = { getAttribute: function (k) { return k in attrs ? attrs[k] : null; }, setAttribute: function (k, v) { attrs[k] = String(v); } };
  var parentAttrs = o.parent;
  var parentRootEl = parentAttrs ? { getAttribute: function (k) { return k in parentAttrs ? parentAttrs[k] : null; } } : null;
  var win = {
    matchMedia: function (q) { return { matches: /dark/.test(q) && !!o.sysDark }; },
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    MutationObserver: function (fn) { this.observe = function (node, opts) { observed.push({ node: node, opts: opts, fn: fn }); }; this.disconnect = function () { observed.length = 0; }; }
  };
  win.parent = parentRootEl ? { document: { documentElement: parentRootEl } } : win;
  var store = { revamp: o.stored === undefined ? null : o.stored };
  var sb = { window: win, document: { documentElement: root }, MutationObserver: win.MutationObserver,
    localStorage: { getItem: function (k) { return k === 'revamp-theme' ? store.revamp : null; } } };
  sb.window.localStorage = sb.localStorage;
  vm.runInNewContext(themeSrc, sb, { filename: 'oneworld-theme.js' });
  return {
    theme: function () { return attrs['data-theme']; },
    parentFlips: function (v) { parentAttrs['data-theme'] = v; observed.forEach(function (x) { x.fn([]); }); },
    observed: observed, listeners: listeners, store: store
  };
}
var T1 = runTheme({ parent: { 'data-theme': 'dark' }, stored: 'light', sysDark: false });
check('framed: the page around it decides (dark), over the stored choice and the system', T1.theme() === 'dark', T1.theme());
check('framed: it watches only the framing page\'s data-theme', T1.observed.length === 1 && JSON.stringify(T1.observed[0].opts.attributeFilter) === '["data-theme"]');
T1.parentFlips('light');
check('the switch flipped on the page around it: the studio follows to light', T1.theme() === 'light', T1.theme());
T1.parentFlips('dark');
check('… and back to dark', T1.theme() === 'dark', T1.theme());
T1.parentFlips('liquid');
check('a value Oneworld does not have is never copied (falls back to the stored choice)', T1.theme() === 'light', T1.theme());
var T2 = runTheme({ parent: {}, stored: 'liquid', sysDark: true });
check('a stored "liquid" (the platform\'s skin) is ignored: the system\'s dark', T2.theme() === 'dark', T2.theme());
var T3 = runTheme({ parent: null, stored: 'dark', sysDark: false });
check('opened on its own: the stored choice', T3.theme() === 'dark' && T3.observed.length === 0, T3.theme());
T3.store.revamp = 'light';
(T3.listeners.storage || []).forEach(function (fn) { fn({ key: 'revamp-theme' }); });
check('opened on its own: a switch flipped in another tab is followed', T3.theme() === 'light', T3.theme());
var T4 = runTheme({ parent: null, stored: null, sysDark: false });
check('nothing stored, a light system: light (the value is always set, never left empty)', T4.theme() === 'light', T4.theme());

/* the look: the platform's tokens on Oneworld's values, light and dark */
function block(sel) {
  var at = cssRules.indexOf(sel + '{');
  if (at === -1) return null;
  var body = cssRules.slice(at + sel.length + 1, cssRules.indexOf('}', at)), out = {}, m, re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  while ((m = re.exec(body))) out[m[1]] = m[2].trim();
  return out;
}
var LIGHT = block('\n:root'), DARK = block(':root[data-theme="dark"]');
check('oneworld.css has a light and a dark token block', !!LIGHT && !!DARK);
LIGHT = LIGHT || {}; DARK = DARK || {};
['--bg', '--panel', '--panel2', '--panel3', '--line', '--line2', '--line3', '--ink', '--ink2', '--soft', '--faint', '--solid', '--solid-h', '--solid-line',
  '--accent', '--accent-soft', '--accent-ink', '--ok', '--ok-soft', '--bad', '--bad-soft', '--s-open', '--s-click', '--ow-accent-text', '--ow-accent-soft'].forEach(function (k) {
  check('token ' + k + ' is set in both themes', !!LIGHT[k] && !!DARK[k], [LIGHT[k], DARK[k]]);
});
check('the console\'s palette: warm background, ET red, Inter', LIGHT['--bg'] === '#FAF7F6' && LIGHT['--accent'] === '#ED1C24' && DARK['--bg'] === '#171514' &&
  DARK['--accent'] === '#FF6B70' && /^'Inter'/.test(LIGHT['--font-body'] || ''));
/* the studio reads --accent with getComputedStyle and parses it as #rrggbb for its editing ring (mailer-studio.js) */
check('--accent is a plain #rrggbb in both themes (the editing ring parses it)', /^#[0-9A-Fa-f]{6}$/.test(LIGHT['--accent']) && /^#[0-9A-Fa-f]{6}$/.test(DARK['--accent']) &&
  studio.indexOf('getPropertyValue("--accent")') !== -1);
function lum(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { var c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
  .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0); }
function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/* words on a tint, a chip, a chosen tab or pill, a disabled control, the toast: WCAG AA (4.5:1) in both themes */
[['--ow-accent-text', '--ow-accent-soft', 'red words on the red tint (chosen tab, hashtag and timing chips)'],
 ['--ow-accent-text', '--panel', 'red words on a panel'],
 ['--ok', '--ok-soft', 'the saved chip'],
 ['--soft', '--panel2', 'grey chips and disabled buttons'],
 ['--soft', '--panel', 'a disabled mailer card\'s words'],
 ['--bad', '--bad-soft', 'an error'],
 ['--bg', '--ink', 'the toast and the chart\'s hover card']].forEach(function (p) {
  [['light', LIGHT], ['dark', DARK]].forEach(function (t) {
    var r = ratio(t[1][p[0]] || '#000000', t[1][p[1]] || '#000000');
    check('AA, ' + t[0] + ': ' + p[2] + ' (' + r.toFixed(2) + ':1)', r >= 4.5, [t[1][p[0]], t[1][p[1]]]);
  });
});
check('dark: the main button\'s words on its red pass AA', ratio(DARK['--accent-ink'], DARK['--solid']) >= 4.5, ratio(DARK['--accent-ink'], DARK['--solid']));
check('the Liquid switch and decoration never show', cssRules.indexOf('.theme-toggle,.theme-blobs{display:none!important}') !== -1);
/* the chart's series colours are matched by the literals the platform writes (S_OPEN, S_CLICK); if those change, so must the rules */
check('the chart colours oneworld.css matches are still the platform\'s', studio.indexOf('const S_OPEN="#4f46e5", S_CLICK="#eb6834";') !== -1 &&
  cssRules.indexOf('#content [stroke="#4f46e5"]{stroke:var(--s-open)}') !== -1 && cssRules.indexOf('#content [stroke="#eb6834"]{stroke:var(--s-click)}') !== -1);
/* a colour-scheme on anything that holds the mail's frame would change what the mail's own CSS sees */
var schemed = [], sre = /([^{}]+)\{[^}]*color-scheme[^}]*\}/g, sm;
while ((sm = sre.exec(cssRules))) sm[1].split(',').forEach(function (s) { schemed.push(s.trim()); });
var SCHEME_OK = ['input', 'select', 'textarea', '.ml-rail', '.ml-props', '.ed-menu', '.ml-pop', '.icpop', '.ml-ins2', '.mcard .vlist'];
check('colour-scheme only on fields and side panes, never the page or the canvas that holds the mail\'s frame', schemed.length > 0 &&
  schemed.every(function (s) { return SCHEME_OK.some(function (ok) { return s === ':root[data-theme="dark"] ' + ok; }); }), schemed);

Promise.all(pending).then(function () {
  if (failed) { console.error('promo-studio: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-studio: all ' + passed + ' checks passed');
}, function (err) { console.error('promo-studio: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
