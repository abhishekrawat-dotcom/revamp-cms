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
check('twelve patches, P1 to P12', patches.length === 12, patches.length);
patches.forEach(function (p, i) {
  check('P' + (i + 1) + ': the platform\'s text is gone', count(studio, p.old) === 0, count(studio, p.old));
  check('P' + (i + 1) + ': its replacement is there ' + p.times + ' time(s)', count(studio, p.neu) === p.times, count(studio, p.neu));
});
/* P11 (owner D): "Use the mailer accent" reads the palette the studio keeps, which mlApplyPalette stores as MD.pal */
check('P11: the colour field reads MD.pal, once; MD.palette is gone', count(studio, 'MD.palette') === 0 &&
  count(studio, 'const fallback=hexNorm((MD&&MD.pal&&MD.pal.accent)||"")||"#4f46e5";') === 1 && count(studio, 'MD.pal=pal;') === 1);
/* P12 (owner B, decision 5): a saved version of a mailer the event can no longer make opens on itself */
check('P12: openMailer lists the mailer of the saved version being opened', count(studio, 'const avail=(MAILERS.mailers||[]).filter(m=>m.available);') === 0 &&
  count(studio, 'const avail=(MAILERS.mailers||[]).filter(m=>m.available||(saveId&&m.id===preId));') === 1);
var openSrc = (/\nfunction openMailer\(preId,saveId,fresh\)\{[\s\S]*?\n\}\n/.exec(studio) || [''])[0];
check('P12: the patched list is the one the picker is filled from and picks from', openSrc.indexOf('const avail=(MAILERS.mailers||[]).filter(m=>m.available||(saveId&&m.id===preId));') !== -1 &&
  openSrc.indexOf('$("mlPick").innerHTML=avail.map(') !== -1 && openSrc.indexOf('$("mlPick").value=(preId&&avail.some(m=>m.id===preId))?preId:avail[0].id;') !== -1);
/* the picker's choice, as the patched openMailer makes it */
function pickOf(mailers, preId, saveId) {
  var avLine = openSrc.split('\n').filter(function (l) { return /const avail=/.test(l); })[0] || 'const avail=[];';
  return vm.runInNewContext(avLine + '\n(preId&&avail.some(m=>m.id===preId))?preId:(avail[0]||{}).id', { MAILERS: { mailers: mailers }, preId: preId, saveId: saveId });
}
var MS2 = [{ id: 'mailer.a', available: true }, { id: 'mailer.b', available: false }];
check('P12: a saved version of an unavailable mailer opens on it', pickOf(MS2, 'mailer.b', 's1') === 'mailer.b');
check('P12: a fresh build of an unavailable mailer still never opens on it', pickOf(MS2, 'mailer.b', null) === 'mailer.a');
check('P12: an available mailer opens as before', pickOf(MS2, 'mailer.a', null) === 'mailer.a' && pickOf(MS2, 'mailer.a', 's2') === 'mailer.a');

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
  var win = { top: { location: { href: '' } }, addEventListener: function () {}, removeEventListener: function () {} };
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
      documentElement: { classList: { contains: function () { return false; }, add: function () {} } },
      addEventListener: function () {}, removeEventListener: function () {},
      querySelectorAll: function () { return []; },
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
    mailerCards: function () { return ''; },
    refreshMailerCards: function () {}
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
/* the 40 ms cap starts only once this file's set-up has run (the page boots after it), so the wait is counted from
   then too, not from here: the set-up of the pages below takes long enough to eat a wait started here */
pending.push(settleAfterLoad(120).then(function () { check('numbers that never come do not hold up the mailer page (capped at OW_PEEK_MS)', l4.calls.paint === 0 && /ev-head/.test(l4.els.content.innerHTML), l4.els.content.innerHTML); }));
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

/* ======================= Phase 3 (Unit M): owner B's real previews, owner C's banner, owner D's fixes ======================= */

/* ---- owner D: Download all as the console's secondary button; the stock art and its tint gone ---- */
var dl = load('?event=x');
dl.sb.MAILERS = { mailers: [], event: {} };
dl.sb.owRenderPage();
check('"Download all (.zip)" is the console\'s secondary button, as Open studio beside it',
  dl.els.content.innerHTML.indexOf('<button class="btn alt sm" onclick="downloadAllMailers()">Download all (.zip)</button>') !== -1 &&
  dl.els.content.innerHTML.indexOf('<button class="btn alt sm" onclick="openMailer()">Open studio</button>') !== -1 &&
  dl.els.content.innerHTML.indexOf('class="btn sm" onclick="downloadAllMailers()"') === -1);
/* .btn.alt (0,2,0) beats the platform's .secnav button (0,1,1), which turned a plain .btn into grey words */
var platformCss = read('promo-studio/mailer-studio.css');
check('the platform\'s .secnav button rule is still the one .btn.alt outranks', /\.secnav button\{background:transparent;color:var\(--soft\)/.test(platformCss) &&
  cssRules.indexOf('.btn.alt{background:var(--panel);color:var(--ink)}') !== -1);
check('oneworld.css has no hue-rotate (the stock art\'s tint is gone)', owCss.indexOf('hue-rotate') === -1);
check('an unavailable card\'s picture is not dimmed (it is the real mail, badged)', cssRules.indexOf('.mcard.dis .art{opacity:1;filter:none}') !== -1 &&
  !/\.mcard\.dis \.art\{[^}]*opacity:\s*\.\d/.test(cssRules));
check('no stock art is referenced by Oneworld\'s files', owSrc.indexOf('/assets/mailer-art/') === -1 && owCss.indexOf('mailer-art') === -1 && page.indexOf('mailer-art') === -1);
check('the stock art folder is gone', !fs.existsSync(path.join(ROOT, 'assets', 'mailer-art')));
check('mailer-studio.css is the platform\'s, unchanged (the copy\'s first lines)', platformCss.indexOf('/* COPIED from the promotional platform') === 0 && platformCss.indexOf('ONEWORLD') === -1);

/* ---- the new rules: on the console's tokens, AA in both themes ---- */
function ruleBody(sel) {
  var at = cssRules.indexOf('\n' + sel + '{');
  if (at === -1) return null;
  at += 1;
  return cssRules.slice(at + sel.length + 1, cssRules.indexOf('}', at));
}
function varOf(body, prop) { var m = new RegExp('(?:^|;)\\s*' + prop + ':var\\((--[\\w-]+)\\)').exec(body || ''); return m ? m[1] : null; }
[['.ow-prev .ow-ex,.ow-lb-mail .ow-ex', 'the Example badge'], ['.ow-prev .ow-ex-note', 'the Example note'], ['.ow-prev .ow-chip,.ow-lb-mail .ow-chip', 'a state chip (Past event …)'],
 ['.ow-lb-mail .ow-lb-note', 'the whole-mail view\'s example note'], ['.ow-lb-mail .ow-lb-note.ow-lb-quiet', 'its plain note'], ['.ow-lb-mail .ow-lb-bar', 'its bar']].forEach(function (p) {
  var body = ruleBody(p[0]), fg = varOf(body, 'color'), bg = varOf(body, 'background');
  check(p[1] + ' (' + p[0] + ') is drawn with the tokens', !!fg && !!bg, body);
  [['light', LIGHT], ['dark', DARK]].forEach(function (t) {
    var r = fg && bg ? ratio(t[1][fg] || '#000000', t[1][bg] || '#000000') : 0;
    check('AA, ' + t[0] + ': ' + p[1] + ' (' + r.toFixed(2) + ':1)', r >= 4.5, [p[0], t[1][fg], t[1][bg]]);
  });
});
/* words set in one rule over a ground set in another */
[['.ow-prev .ow-msg', '--panel2', 'a card\'s "could not be drawn" on the picture slot'], ['#secMail .sec-h', '--bg', 'the mailer page\'s section headings'],
 ['.ow-lb-mail .ow-lb-t small', '--panel', 'the whole-mail view\'s group line']].forEach(function (p) {
  var fg = varOf(ruleBody(p[0]), 'color');
  [['light', LIGHT], ['dark', DARK]].forEach(function (t) {
    var r = fg ? ratio(t[1][fg] || '#000000', t[1][p[1]] || '#000000') : 0;
    check('AA, ' + t[0] + ': ' + p[2] + ' (' + r.toFixed(2) + ':1)', r >= 4.5, [p[0], fg, p[1]]);
  });
});
check('the picture slot sits on the tokens', varOf(ruleBody('.mcard .art.ow-prev'), 'background') === '--panel2' && /border:1px solid var\(--line2\)/.test(ruleBody('.mcard .art.ow-prev') || ''));
check('the whole-mail view\'s scrim is the console\'s', varOf(ruleBody('.ow-lb-mail'), 'background') === '--ow-scrim');
/* the Social posts page loads this stylesheet too and styles the shared names (.ow-ex, .ow-chip, .ow-lb …) its own way */
var looseSels = [], selRe = /([^{}]+)\{/g, selM;
while ((selM = selRe.exec(cssRules))) selM[1].split(',').forEach(function (sel) {
  sel = sel.trim();
  if (/\.ow-(ex|ex-note|chip|lb|lb-col|lb-bar|lb-t|lb-note|lb-page|msg)(?![\w-])/.test(sel) && !/^\.ow-prev[\s.:]|^\.ow-lb-mail(?![\w-])/.test(sel)) looseSels.push(sel);
});
check('every rule for a shared class name is held to the mailer\'s cards or its own whole-mail view', looseSels.length === 0, looseSels);
check('cards at least 360px, one column on a phone', cssRules.indexOf('.mgrid{grid-template-columns:repeat(auto-fill,minmax(min(360px,100%),1fr));gap:18px}') !== -1);
check('a card\'s mail: 800 × 1000, scaled by --ow-s, never clickable inside', cssRules.indexOf('.ow-prev iframe{position:absolute;left:0;top:0;width:800px;height:1000px;border:0;background:#fff;transform-origin:0 0;transform:scale(var(--ow-s,.45));pointer-events:none}') !== -1);
check('a 4:5 window on the mail', /aspect-ratio:4\/5/.test(ruleBody('.mcard .art.ow-prev') || ''));
check('off-screen cards are skipped until near', cssRules.indexOf('.mcard{content-visibility:auto;contain-intrinsic-size:auto 640px}') !== -1);
check('"For award events" spans the grid', /grid-column:1\/-1/.test(ruleBody('.mgrid .ow-award-h') || ''));
check('tall mode: no scroll of its own, the content as tall as it is', cssRules.indexOf('html.ow-tall,html.ow-tall body,html.ow-tall #app{height:auto}') !== -1 &&
  cssRules.indexOf('html.ow-tall{overflow:hidden}') !== -1 && cssRules.indexOf('html.ow-tall .content{overflow:visible}') !== -1);
check('the whole-mail view sits over the studio\'s layer and under the toast and dialogs', /z-index:95/.test(ruleBody('.ow-lb-mail') || '') &&
  /#mailer\{position:fixed;inset:0;z-index:90/.test(platformCss) && /\.toast\{[^}]*z-index:200/.test(platformCss));

/* ---- a page with the platform's own card code (Phase 3) ----
   The platform's mailerCards, renderEvSaved, evSavedList, savedWhen, findMailer, mlSaves and escapeHtml run as the
   page runs them; oneworld.js replaces mailerArt and savedCardHtml (stubbed here: they must never be called) and
   wraps mailerCards, refreshMailerCards, openMailer, closeMailer, paintAnalytics and toast. The DOM is a small
   fake: each picture slot the markup writes is an element; frames, the whole-mail view and observers are recorded. */
function studioFn(name) { var m = new RegExp('\\nfunction ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}\\n').exec(studio); return m ? m[0] : null; }
function studioConst(name) { return studio.split('\n').filter(function (l) { return l.indexOf('const ' + name + '=') === 0; })[0] || null; }
var PLATFORM_PARTS = [escLines[0], studioConst('mlSaves'), studioConst('findMailer'), studioFn('savedWhen'), studioFn('evSavedList'), studioFn('renderEvSaved'), studioFn('mailerCards')];
check('the platform\'s card code is in the studio code', PLATFORM_PARTS.every(Boolean), PLATFORM_PARTS.map(Boolean));
/* the platform's refreshMailerCards rewrites #evSaved and #mgrid; here it rewrites both inside #content */
var PLATFORM = PLATFORM_PARTS.join('\n') +
  '\nfunction refreshMailerCards(){ $("content").innerHTML=\'<div id="evSaved">\'+renderEvSaved()+\'</div><div class="mgrid" id="mgrid">\'+mailerCards()+\'</div>\'; }\n';
var ORIGIN = 'https://oneworld.example';
function decode(s) { return s.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function attrsOf(tag) { var out = {}, m, re = /([\w-]+)="([^"]*)"/g; while ((m = re.exec(tag))) out[m[1]] = decode(m[2]); return out; }
function R(status, body) {
  return { ok: status >= 200 && status < 300, status: status, headers: { get: function () { return null; } },
    json: function () { return Promise.resolve(body); }, clone: function () { return R(status, body); } };
}
function page2(search, o) {
  o = o || {};
  var els = {}, posted = [], fetches = [], toasts = [], opened = [], winL = {}, docL = {}, ros = [], ios = [], palettes = [], redraws = [], stubs = { art: 0, saved: 0 }, slots = [];
  function fakeEl(tag, attrs) {
    var e = { tagName: String(tag).toUpperCase(), attrs: attrs || {}, children: [], parentNode: null, _html: '', style: {} };
    e.style.setProperty = function (k, v) { e.style[k] = v; };
    e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
    e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
    e.removeAttribute = function (k) { delete e.attrs[k]; };
    function cls() { return String(e.attrs['class'] || '').split(/\s+/).filter(Boolean); }
    e.classList = {
      add: function (c) { var l = cls(); if (l.indexOf(c) === -1) l.push(c); e.attrs['class'] = l.join(' '); },
      remove: function (c) { e.attrs['class'] = cls().filter(function (x) { return x !== c; }).join(' '); },
      contains: function (c) { return cls().indexOf(c) !== -1; },
      toggle: function (c, on) { if (on === undefined) on = !e.classList.contains(c); if (on) e.classList.add(c); else e.classList.remove(c); return on; }
    };
    Object.defineProperty(e, 'className', { get: function () { return e.attrs['class'] || ''; }, set: function (v) { e.attrs['class'] = String(v); } });
    Object.defineProperty(e, 'innerHTML', { get: function () { return e._html; }, set: function (h) { e._html = String(h); e.children = []; if (e.onHtml) e.onHtml(e._html); } });
    e.appendChild = function (c) { c.parentNode = e; e.children.push(c); return c; };
    e.removeChild = function (c) { e.children = e.children.filter(function (x) { return x !== c; }); c.parentNode = null; return c; };
    e.getBoundingClientRect = function () { return e.rect || { bottom: 0, height: 0, width: 0 }; };
    e.focus = function () { page.focused = e; };
    return e;
  }
  var content = fakeEl('div', { id: 'content' });
  content.rect = { bottom: o.height || 900, height: o.height || 900 };
  /* writing #content's markup makes its elements: the ids it holds, and one element per picture slot */
  content.onHtml = function (h) {
    Object.keys(els).forEach(function (id) { if (els[id].inContent) delete els[id]; });
    (h.match(/id="([^"]+)"/g) || []).forEach(function (m) { var id = m.slice(4, -1); var x = fakeEl('div', { id: id }); x.inContent = true; els[id] = x; });
    slots = [];
    var re = /<div class="art ow-prev"[^>]*>/g, t;
    while ((t = re.exec(h))) slots.push(fakeEl('div', attrsOf(t[0])));
  };
  els.content = content; els.mailer = fakeEl('div', { id: 'mailer' }); els.prodNav = fakeEl('div', { id: 'prodNav' });
  var body = fakeEl('body'), root = fakeEl('html');
  var navEvents = { textContent: 'Events', title: '' };
  function FakeRO(cb) { this.cb = cb; this.targets = []; ros.push(this); }
  FakeRO.prototype.observe = function (t) { this.targets.push(t); };
  FakeRO.prototype.disconnect = function () { this.targets = []; this.gone = true; };
  FakeRO.prototype.fire = function (w) { this.cb(this.targets.map(function (t) { return { target: t, contentRect: { width: w || 0 } }; })); };
  function FakeIO(cb, opts) { this.cb = cb; this.opts = opts; this.targets = []; ios.push(this); }
  FakeIO.prototype.observe = function (t) { this.targets.push(t); };
  FakeIO.prototype.unobserve = function (t) { this.targets = this.targets.filter(function (x) { return x !== t; }); };
  FakeIO.prototype.disconnect = function () { this.targets = []; this.gone = true; };
  FakeIO.prototype.fire = function () { this.cb(this.targets.slice().map(function (t) { return { target: t, isIntersecting: true }; })); };
  var win = { top: { location: { href: '' } }, scrollY: 0,
    addEventListener: function (t, fn) { (winL[t] = winL[t] || []).push(fn); },
    removeEventListener: function (t, fn) { winL[t] = (winL[t] || []).filter(function (x) { return x !== fn; }); },
    requestAnimationFrame: function (f) { setTimeout(f, 0); },
    fetch: function () { return Promise.reject(new Error('no network in tests')); } };
  win.parent = o.framed ? { postMessage: function (m, origin) { posted.push({ m: JSON.parse(JSON.stringify(m)), origin: origin }); } } : win;
  if (o.observers !== false) { win.ResizeObserver = FakeRO; win.IntersectionObserver = FakeIO; }
  win.RevampAuth = {
    whenResolved: function () { return o.boot ? Promise.resolve('someone@example.com') : new Promise(function () {}); },
    authedFetch: function (url, opts) {
      var f = { url: url, body: opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null };
      fetches.push(f);
      return o.respond ? Promise.resolve(o.respond(url, f.body, fetches)) : new Promise(function () {});
    }
  };
  var sb = {
    window: win, location: { search: search, origin: ORIGIN }, URLSearchParams: URLSearchParams,
    setTimeout: setTimeout, clearTimeout: clearTimeout, console: console,
    document: {
      body: body, documentElement: root,
      querySelector: function (sel) { return sel === '#prodNav [data-v="events"]' ? navEvents : (o.query ? o.query(sel) : null); },
      querySelectorAll: function (sel) { return sel === '.ow-prev[data-prev]' ? slots.slice() : []; },
      createElement: function (tag) { return fakeEl(tag); },
      addEventListener: function (t, fn) { (docL[t] = docL[t] || []).push(fn); },
      removeEventListener: function (t, fn) { docL[t] = (docL[t] || []).filter(function (x) { return x !== fn; }); }
    },
    AN: { range: 30, tmplMetric: 'opens', subjMetric: 'opens', data: null, openVer: null },
    MAILERS: null,
    MD: o.MD || { pal: { accent: '#123456' }, doc: null },
    $: function (id) { return els[id] || null; },
    toast: function (m, ms) { toasts.push(arguments.length > 1 ? [m, ms] : [m]); },
    openMailer: function (id, saveId) { opened.push([id, saveId]); if (o.studioOpens !== false) els.mailer.classList.add('on'); },
    closeMailer: function () { els.mailer.classList.remove('on'); },
    showAnalytics: function () { throw new Error('the platform\'s showAnalytics ran'); },
    paintAnalytics: function () { content.innerHTML = '<div class="page-h"><h2>Mailer performance</h2></div>'; },
    rankCard: function () { return ''; }, setProdNav: function () {},
    skEventPage: function () { return '<div class="sk-page"></div>'; },
    mailerArt: function () { stubs.art++; return 'STUB-ART'; },
    savedCardHtml: function () { stubs.saved++; return 'STUB-SAVED'; },
    mlApplyPalette: function (p) { palettes.push(p); },
    /* the studio's panel and inspector: each draw notes the accent its colour fields would be built with
       (fldColor reads MD.pal then) and how many palettes the studio had been handed by then */
    mlProps: function () { redraws.push(['mlProps', sb.MD.pal ? sb.MD.pal.accent : null, palettes.length]); },
    mlInspector: function () { redraws.push(['mlInspector', sb.MD.pal ? sb.MD.pal.accent : null, palettes.length]); }
  };
  vm.createContext(sb);
  vm.runInContext(PLATFORM, sb, { filename: 'mailer-studio.js (cards)' });
  vm.runInContext(owSrc, sb, { filename: 'oneworld.js' });
  var page = {
    sb: sb, els: els, posted: posted, fetches: fetches, toasts: toasts, opened: opened, winL: winL, docL: docL, ros: ros, ios: ios,
    palettes: palettes, redraws: redraws, stubs: stubs, body: body, root: root, content: content, focused: null,
    slots: function () { return slots; },
    slot: function (key) { return slots.filter(function (s) { return s.attrs['data-prev'] === key; })[0] || null; },
    /* a message from the page around the frame (or from somewhere else, to check it is ignored) */
    send: function (data, from) {
      from = from || {};
      (winL.message || []).forEach(function (fn) { fn({ data: data, origin: from.origin || ORIGIN, source: 'source' in from ? from.source : win.parent }); });
    },
    asked: function (what) { return posted.filter(function (p) { return p.m && what in p.m; }).map(function (p) { return p.m; }); },
    /* answers every banner request not yet answered */
    answerBanner: function (ok) {
      page.asked('rvBanner').forEach(function (m) { if (!page.answered[m.id]) { page.answered[m.id] = true; page.send({ rvBannerReady: { id: m.id, ok: ok !== false } }); } });
    },
    answered: {},
    lb: function () { return body.children.filter(function (c) { return c.className === 'ow-lb ow-lb-mail'; })[0] || null; },
    loads: function (re) { return fetches.filter(function (f) { return re.test(f.url); }); }
  };
  return page;
}

/* the catalog of a sparse event that is not an award (owner B's cases), with two saved versions */
var T0 = Date.now();
function sparseCatalog() {
  function m(id, group, label, available, missing, extra) {
    return Object.assign({ id: id, group: group, label: label, description: label + ' mail', available: available, suggested: 0, missing: missing || [], outline: available ? ['Header', 'Hero'] : [], subject: available ? 'Hello' : '' }, extra || {});
  }
  return {
    event: { name: 'Sparse Summit', portal: 'health', dateLabel: '1 Dec 2026', venue: '' },
    mailers: [
      m('mailer.announcement', 'Event', 'Announcement', true),
      m('mailer.award-nominations', 'Awards', 'Nominations open', false, ['an award (this event has no award record)'], { suggested: 1 }),
      m('mailer.speakers', 'Speakers', 'Speakers', false, ['speakers (2+)']),
      m('mailer.reminder', 'Event', 'Reminder', false, ['an upcoming date (this event has already taken place)']),
      m('mailer.award-winners', 'Awards', 'Winners', false, ['a published winner count (nothing has been decided yet)', 'a winners page to link to']),
      m('mailer.agenda', 'Agenda', 'Agenda', false, ['agenda sessions']),
      m('mailer.blank', 'Other', 'Blank', true)
    ],
    saves: {
      'mailer.announcement': [{ saveId: 's1', name: 'First go', savedAt: T0 - 1000, subject: 'Hi' }],
      'mailer.speakers': [{ saveId: 's2', name: 'Old line-up', savedAt: T0 - 5000, subject: 'Our speakers' }]
    },
    tracking: true
  };
}
/* the previews route's answer (functions/lib/promo-previews.js shapes) */
function previewsFor(body) {
  var items = [];
  if (body.templates) {
    items.push({ key: 'tpl:mailer.announcement', html: '<html>ANNOUNCEMENT</html>', example: false, filled: [], state: null, missing: [] });
    items.push({ key: 'tpl:mailer.award-nominations', html: '<html>AWARD</html>', example: true, filled: ['award'], state: null, missing: ['an award (this event has no award record)'] });
    items.push({ key: 'tpl:mailer.speakers', html: '<html>SPEAKERS</html>', example: true, filled: ['speakers'], state: null, missing: ['speakers (2+)'] });
    items.push({ key: 'tpl:mailer.reminder', html: '<html>REMINDER</html>', example: false, filled: [], state: 'past', missing: ['an upcoming date (this event has already taken place)'] });
    items.push({ key: 'tpl:mailer.award-winners', html: '<html>WINNERS</html>', example: true, filled: ['award'], state: null, missing: ['a published winner count (nothing has been decided yet)'] });
    items.push({ key: 'tpl:mailer.agenda', missing: ['agenda sessions'], example: false, filled: [], state: null });
    items.push({ key: 'tpl:mailer.blank', html: '<html>BLANK</html>', example: false, filled: [], state: null, missing: [] });
  }
  (body.saveIds || []).forEach(function (id) {
    items.push(id === 'big' ? { key: 'save:big', error: 'too large' } : { key: 'save:' + id, html: '<html>SAVED ' + id + '</html>', example: false, filled: [], state: null, missing: [] });
  });
  return { items: items };
}
function sparseRespond(cat, extra) {
  return function (url, b, all) {
    if (extra) { var r = extra(url, b, all); if (r) return r; }
    if (/^\/api\/promo\/mailers\?/.test(url)) return R(200, cat);
    if (/^\/api\/promo\/analytics/.test(url)) return R(200, { totals: { sends: 0 } });
    if (url === '/api/promo/mailer/previews') return R(200, previewsFor(b));
    return R(404, { error: 'nope' });
  };
}
function frameOf(slot) { return slot && slot.children.filter(function (c) { return c.tagName === 'IFRAME'; })[0] || null; }

/* ---- M.4 / M.8: the cards' pictures are slots for the real mail; award mailers grouped on an event that is not an award ---- */
var cards = page2('?event=x');
cards.sb.MAILERS = sparseCatalog();
cards.sb.owSortCatalog();
check('owSortCatalog: on an event that is not an award, the award mailers come last (the rest keep their order)',
  cards.sb.MAILERS.mailers.map(function (m) { return m.id; }).join() === 'mailer.announcement,mailer.speakers,mailer.reminder,mailer.agenda,mailer.blank,mailer.award-nominations,mailer.award-winners',
  cards.sb.MAILERS.mailers.map(function (m) { return m.id; }));
var cardsHtml = cards.sb.mailerCards();
var headAt = cardsHtml.indexOf('<div class="sec-h ow-award-h">For award events</div>');
check('"For award events" once, after the other mailers and before the award ones', count(cardsHtml, 'For award events') === 1 && headAt > cardsHtml.indexOf('data-prev="tpl:mailer.blank"') &&
  headAt < cardsHtml.indexOf('data-prev="tpl:mailer.award-nominations"') && headAt < cardsHtml.indexOf('data-prev="tpl:mailer.award-winners"'));
check('the catalog is whole again after the cards are drawn', cards.sb.MAILERS.mailers.length === 7);
check('mailerArt is Oneworld\'s: a picture slot named tpl:<id>, the sections as its tooltip', cardsHtml.indexOf('<div class="art ow-prev" data-prev="tpl:mailer.announcement" data-label="Announcement" title="Sections in this mail: Header · Hero" onclick="owPrevOpen(this)" onkeydown="owPrevKeyDown(event,this)"><span class="sk"></span></div>') !== -1);
check('… and the platform\'s card around it (its needs line on an unavailable one)', cardsHtml.indexOf('<div class="warn">needs speakers (2+)</div>') !== -1 && cardsHtml.indexOf('<div class="mcard dis">') !== -1);
var savedHtml = cards.sb.renderEvSaved();
check('savedCardHtml is Oneworld\'s: the version\'s own slot, keyed by its saved time', savedHtml.indexOf('data-prev="save:s1" data-ver="' + (T0 - 1000) + '" data-label="First go"') !== -1 &&
  savedHtml.indexOf('data-prev="save:s2" data-ver="' + (T0 - 5000) + '"') !== -1);
check('… with the platform\'s card: group, saved time, name, subject, Edit →', /<div class="grp"><span>Event<\/span><span class="savedchip">[^<]+<\/span><\/div>/.test(savedHtml) &&
  savedHtml.indexOf('<div class="nm">First go</div>') !== -1 && savedHtml.indexOf('<div class="subj"><b>Subject</b>Hi</div>') !== -1 &&
  savedHtml.indexOf('onclick=\'openMailer(&quot;mailer.announcement&quot;,&quot;s1&quot;)\'>Edit →</button>') !== -1);
check('the platform\'s mailerArt and savedCardHtml are never called', cards.stubs.art === 0 && cards.stubs.saved === 0, cards.stubs);
check('no stock art in the cards', cardsHtml.indexOf('mailer-art') === -1 && savedHtml.indexOf('mailer-art') === -1);
var awardCat = sparseCatalog();
awardCat.mailers[1].available = true; awardCat.mailers[1].missing = [];
var awardPage = page2('?event=x');
awardPage.sb.MAILERS = awardCat;
awardPage.sb.owSortCatalog();
var awardHtml = awardPage.sb.mailerCards();
check('on an award event: no "For award events" heading, the award mailers first', awardHtml.indexOf('For award events') === -1 &&
  awardPage.sb.MAILERS.mailers[0].id === 'mailer.award-nominations' && awardPage.sb.MAILERS.mailers[1].id === 'mailer.award-winners');
/* an award that is over (nominations closed, winners not out): none of its award mailers can be made, and it is
   still an award, so they are its own, not "for award events" (only the engine's NOT_AN_AWARD words say otherwise) */
var closedCat = sparseCatalog();
closedCat.mailers[1].missing = ['open nominations (this award is not taking entries)', 'a nomination link'];
var closedPage = page2('?event=x');
closedPage.sb.MAILERS = closedCat;
closedPage.sb.owSortCatalog();
var closedHtml = closedPage.sb.mailerCards();
check('on an award whose award mailers cannot be made now: no "For award events" heading, the award mailers first', closedHtml.indexOf('For award events') === -1 &&
  closedPage.sb.MAILERS.mailers[0].id === 'mailer.award-nominations' && closedPage.sb.MAILERS.mailers[1].id === 'mailer.award-winners',
  closedPage.sb.MAILERS.mailers.map(function (m) { return m.id; }));
check('… and an event whose catalog has no award mailers at all is not an award', (function () {
  var p = page2('?event=x'), c = sparseCatalog();
  c.mailers = c.mailers.filter(function (m) { return !/^mailer\.award/.test(m.id); });
  p.sb.MAILERS = c;
  return p.sb.owAwardEvent() === false && p.sb.mailerCards().indexOf('For award events') === -1;
})());

/* ---- M.5 / M.6: one previews request after the catalog and the banner; the slots; a re-save; the whole-mail view ---- */
var pv = page2('?event=x', { framed: true, boot: true, respond: sparseRespond(sparseCatalog()) });
pending.push(settle(30).then(function () {
  check('previews wait for the banner: it is asked for, and nothing is drawn yet', pv.asked('rvBanner').length === 1 && pv.asked('rvBanner')[0].rvBanner === 'ensure' &&
    pv.asked('rvBanner')[0].fresh === false && pv.loads(/previews/).length === 0 && /ev-head/.test(pv.content.innerHTML), pv.posted);
  check('… asked of our own origin only', pv.posted.every(function (p) { return p.origin === ORIGIN; }));
  check('every slot shows its loading shimmer meanwhile', pv.slots().length === 9 && pv.slots().every(function (s) { return !s.getAttribute('data-shown'); }));
  pv.send({ rvBannerReady: { id: 99, ok: true } });                 // an answer to some other question: still waiting
  return settle().then(function () {
    check('an answer to another request does not let it go', pv.loads(/previews/).length === 0);
    pv.answerBanner(true);
    return settle(30);
  });
}).then(function () {
  var asked = pv.loads(/previews/);
  check('then one request: every template and every saved version on the page', asked.length === 1 && asked[0].url === '/api/promo/mailer/previews' &&
    JSON.stringify(asked[0].body) === JSON.stringify({ templates: true, saveIds: ['s1', 's2'], eventId: 'x' }), asked);
  var ann = pv.slot('tpl:mailer.announcement');
  check('a mailer the event can make: its slot opens the whole mail (a button for the keyboard too), no badge', ann.getAttribute('data-shown') === '1' &&
    ann.classList.contains('ow-has') && ann.getAttribute('role') === 'button' && ann.getAttribute('tabindex') === '0' &&
    ann.getAttribute('aria-label') === 'See the whole mail: Announcement' && ann.innerHTML === '', ann.attrs);
  check('the frame is mounted only when the card comes near (IntersectionObserver, 1200px ahead, so a fast scroll never lands on a half-painted card)',
    !frameOf(ann) && pv.ios.length >= 1 && JSON.stringify(pv.ios[pv.ios.length - 1].opts) === JSON.stringify({ rootMargin: '1200px 0px' }));
  pv.ios[pv.ios.length - 1].fire();
  var f = frameOf(ann);
  check('… then: a locked frame of the real mail', !!f && f.srcdoc === '<html>ANNOUNCEMENT</html>' && f.getAttribute('sandbox') === '' &&
    f.getAttribute('referrerpolicy') === 'no-referrer' && f.getAttribute('aria-hidden') === 'true' && f.getAttribute('tabindex') === '-1', f && f.attrs);
  pv.ros[pv.ros.length - 1].fire(400);
  check('each frame is scaled to its card (400px wide: 0.5)', ann.style['--ow-s'] === '0.5', ann.style);
  var spk = pv.slot('tpl:mailer.speakers');
  check('an example: the badge and its note beside the mail, not in it', spk.innerHTML === '<span class="ow-ex">Example</span><span class="ow-ex-note">Example speakers — add yours to use this</span>' &&
    frameOf(spk) && frameOf(spk).srcdoc === '<html>SPEAKERS</html>', spk.innerHTML);
  check('example award facts say they are for award events', pv.slot('tpl:mailer.award-nominations').innerHTML.indexOf('Example award details — for award events') !== -1);
  check('award-winners says Oneworld does not record winners yet', pv.slot('tpl:mailer.award-winners').innerHTML.indexOf('Example winners — Oneworld does not record award winners yet') !== -1);
  var rem = pv.slot('tpl:mailer.reminder');
  check('a past event: the real mail with its chip, no Example badge', rem.innerHTML === '<span class="ow-chip">Past event</span>' && frameOf(rem).srcdoc === '<html>REMINDER</html>', rem.innerHTML);
  var ag = pv.slot('tpl:mailer.agenda');
  check('no picture for it: the slot hides and the card keeps its needs line', ag.classList.contains('ow-none') && ag.innerHTML === '' && !frameOf(ag) &&
    /<div class="warn">needs agenda sessions<\/div>/.test(pv.content.innerHTML));
  check('a saved version: its own mail', frameOf(pv.slot('save:s1')) && frameOf(pv.slot('save:s1')).srcdoc === '<html>SAVED s1</html>');

  /* the whole mail of an example: what it lacks, where to add it, and no way to open it */
  pv.sb.owPrevOpen(spk);
  var lb = pv.lb();
  var lbHtml = lb ? lb.children[0].innerHTML : '';
  check('a click opens the whole mail, full window (the page around is told)', !!lb && pv.asked('rvMailerStudio').map(function (m) { return m.rvMailerStudio; }).join() === 'open' &&
    lb.getAttribute('role') === 'dialog' && lb.getAttribute('aria-modal') === 'true');
  var lbFrame = lb && lb.children[0].children[0].children[0];
  check('… drawn 800 wide in a frame that runs nothing', !!lbFrame && lbFrame.tagName === 'IFRAME' && lbFrame.getAttribute('sandbox') === 'allow-same-origin' && lbFrame.srcdoc === '<html>SPEAKERS</html>');
  check('an example\'s whole mail: the badge, what to add and where, and no Open', lbHtml.indexOf('<span class="ow-ex">Example</span>') !== -1 &&
    lbHtml.indexOf('Example — to use this mailer, add speakers (2+).') !== -1 &&
    lbHtml.indexOf('<a href="/edit-event.html?event=x#content/speakers" target="_top">Add speakers in Content → Speakers</a>') !== -1 &&
    lbHtml.indexOf('owLbGo') === -1 && lbHtml.indexOf('Open in studio') === -1 && lbHtml.indexOf('Download') === -1, lbHtml);
  var h0 = pv.asked('rvMailerHeight').length;
  pv.content.rect = { bottom: 3000, height: 3000 };
  pv.sb.owReportHeight();
  (pv.docL.keydown || []).forEach(function (fn) { fn({ key: 'Escape' }); });
  return settle().then(function () {
    check('Escape closes it and gives the window back; its height is reported only once closed', !pv.lb() &&
      pv.asked('rvMailerStudio').map(function (m) { return m.rvMailerStudio; }).join() === 'open,close' &&
      pv.asked('rvMailerHeight').length === h0 + 1 && pv.asked('rvMailerHeight').pop().rvMailerHeight === 3000);
    pv.sb.owPrevOpen(pv.slot('tpl:mailer.award-nominations'));
    var a = pv.lb().children[0].innerHTML;
    check('an award mailer on an event that is not an award: said so, no link, no Open', a.indexOf('this mailer is for award events, and this event has no award record.') !== -1 &&
      a.indexOf('<a ') === -1 && a.indexOf('owLbGo') === -1);
    pv.sb.owLightboxClose();
    pv.sb.owPrevOpen(rem);
    var s = pv.lb().children[0].innerHTML;
    check('a past event\'s whole mail: its chip and why, no Open', s.indexOf('<span class="ow-chip">Past event</span>') !== -1 &&
      s.indexOf('This mailer needs an upcoming date (this event has already taken place).') !== -1 && s.indexOf('owLbGo') === -1 && s.indexOf('ow-ex') === -1);
    pv.sb.owLightboxClose();
    pv.sb.owPrevOpen(ann);
    var g = pv.lb().children[0].innerHTML;
    check('a mailer the event can make: the card\'s own main action (Continue its latest save)', g.indexOf('onclick="owLbGo()">Continue “First go” →</button>') !== -1);
    var told = pv.asked('rvMailerStudio').length;
    pv.sb.owLbGo();
    check('… which opens the studio on it, the window kept (no close, no second open)', !pv.lb() && JSON.stringify(pv.opened[pv.opened.length - 1]) === JSON.stringify(['mailer.announcement', 's1']) &&
      pv.asked('rvMailerStudio').length === told);
    pv.sb.closeMailer();
    check('closing the studio gives the window back', pv.asked('rvMailerStudio').pop().rvMailerStudio === 'close');
    pv.sb.owPrevOpen(pv.slot('save:s2'));
    var sv = pv.lb().children[0].innerHTML;
    check('a saved version (of a mailer it can no longer make): Edit →, which opens that version', sv.indexOf('onclick="owLbGo()">Edit →</button>') !== -1 && sv.indexOf('Old line-up') !== -1);
    pv.sb.owLbGo();
    check('… on itself (PATCHES P12 does the rest)', JSON.stringify(pv.opened[pv.opened.length - 1]) === JSON.stringify(['mailer.speakers', 's2']));
    pv.sb.closeMailer();
    pv.sb.owPrevOpen(ag);
    check('a slot with no picture opens nothing', !pv.lb());

    /* a re-save: only that version is asked for again; the template cards stay */
    pv.sb.MAILERS.saves['mailer.announcement'] = [{ saveId: 's3', name: 'Second go', savedAt: T0 + 2, subject: 'Hi' }, { saveId: 's1', name: 'First go', savedAt: T0 + 1, subject: 'Hi' }];
    pv.sb.refreshMailerCards();
    return settle(30);
  });
}).then(function () {
  var asked = pv.loads(/previews/);
  check('after a save: one more request, for the changed and the new version only', asked.length === 2 &&
    JSON.stringify(asked[1].body) === JSON.stringify({ templates: false, saveIds: ['s3', 's1'], eventId: 'x' }), asked.map(function (a) { return a.body; }));
  check('… with no second banner request (the drawing is kept for the page)', pv.asked('rvBanner').length === 1);
  check('… and every card drawn again from what is known', pv.slots().every(function (s) { return s.getAttribute('data-shown') === '1'; }) &&
    pv.slot('save:s1').getAttribute('data-ver') === String(T0 + 1));
  check('the observers are started again for the new cards (the old ones let go)', pv.ios.slice(0, -1).every(function (io) { return io.gone; }) && pv.ros.filter(function (r) { return !r.gone; }).length === 2);
}));

/* a request that fails: the card says so, with Try again; Try again asks again */
var failing = true;
var pf = page2('?event=x', { boot: true, respond: sparseRespond(sparseCatalog(), function (url) { if (url === '/api/promo/mailer/previews' && failing) return R(500, { error: 'boom' }); }) });
pending.push(settle(40).then(function () {
  var s = pf.slot('tpl:mailer.announcement');
  check('not framed: no banner is asked for, the previews go at once', pf.posted.length === 0 && pf.loads(/previews/).length === 1);
  check('a failed request: "Preview could not be drawn" with Try again, never stock art', s.classList.contains('ow-err') &&
    s.innerHTML.indexOf('Preview could not be drawn — <button type="button" class="btn alt sm" onclick="event.stopPropagation();owPrevRetry()">Try again</button>') !== -1, s.innerHTML);
  failing = false;
  pf.sb.owPrevRetry();
  return settle(30).then(function () {
    pf.ios[pf.ios.length - 1].fire();
    check('Try again asks again and draws', pf.loads(/previews/).length === 2 && !!frameOf(pf.slot('tpl:mailer.announcement')) &&
      !pf.slot('tpl:mailer.announcement').classList.contains('ow-err') && pf.slot('tpl:mailer.announcement').classList.contains('ow-has'),
      [pf.loads(/previews/).length, pf.slot('tpl:mailer.announcement').attrs]);
  });
}));
/* one mail the server could not draw: its card has Try again, which asks for it again; a saved version the server did
   not find (deleted elsewhere) is said so with no Try again, which could only find nothing again */
var drawFails = true;
var pi = page2('?event=x', { boot: true, respond: sparseRespond(sparseCatalog(), function (url, b) {
  if (url !== '/api/promo/mailer/previews') return null;
  var j = previewsFor(b);
  j.items = j.items.map(function (it) {
    if (it.key === 'tpl:mailer.announcement' && drawFails) return { key: it.key, error: 'render failed' };
    if (it.key === 'save:s2') return { key: it.key, error: 'not found' };
    return it;
  });
  return R(200, j);
}) });
pending.push(settle(40).then(function () {
  var a = pi.slot('tpl:mailer.announcement'), gone = pi.slot('save:s2');
  check('a mail the server could not draw: "Preview could not be drawn" with Try again', a.classList.contains('ow-err') &&
    a.innerHTML.indexOf('Preview could not be drawn — <button type="button" class="btn alt sm" onclick="event.stopPropagation();owPrevRetry()">Try again</button>') !== -1, a.innerHTML);
  check('a saved version the server did not find: "Preview could not be drawn", no Try again', gone.classList.contains('ow-err') &&
    gone.innerHTML === '<span class="ow-msg">Preview could not be drawn</span>', gone.innerHTML);
  drawFails = false;
  pi.sb.owPrevRetry();
  return settle(30);
}).then(function () {
  var asked = pi.loads(/previews/), a = pi.slot('tpl:mailer.announcement');
  check('Try again on it really asks again (the templates; not the version that is gone), and draws it', asked.length === 2 &&
    asked[1].body.templates === true && asked[1].body.saveIds.length === 0 && a.classList.contains('ow-has') && !a.classList.contains('ow-err') &&
    pi.slot('save:s2').innerHTML === '<span class="ow-msg">Preview could not be drawn</span>', [asked.map(function (x) { return x.body; }), a.attrs]);
}));
/* a version too large to show; without observers (an older browser) frames mount at once */
var bigCat = sparseCatalog();
bigCat.saves['mailer.blank'] = [{ saveId: 'big', name: 'Imported', savedAt: T0 - 9000 }];
var pb = page2('?event=x', { boot: true, observers: false, respond: sparseRespond(bigCat) });
pending.push(settle(40).then(function () {
  check('a version too large to show says so', pb.slot('save:big').innerHTML === '<span class="ow-msg">Preview too large to show — open it in the studio</span>');
  check('no IntersectionObserver: frames are mounted at once', !!frameOf(pb.slot('tpl:mailer.announcement')));
}));

/* deep links: to a mailer the event cannot make, its whole mail (never another mailer); to a saved version of it, the studio */
var dlk = page2('?event=x&mailer=mailer.speakers', { framed: true, boot: true, respond: sparseRespond(sparseCatalog()) });
pending.push(settle(30).then(function () {
  dlk.answerBanner(true);
  return settle(30);
}).then(function () {
  check('a deep link to an unavailable mailer opens its whole mail, not another mailer', dlk.opened.length === 0 && !!dlk.lb() &&
    dlk.lb().children[0].innerHTML.indexOf('Example — to use this mailer, add speakers (2+).') !== -1);
  /* a click inside the mail sends the keys to the frame's own document: Escape must close the view from there too */
  var lbF = dlk.lb().children[0].children[0].children[0], inner = {};
  lbF.contentDocument = { addEventListener: function (t, fn, capture) { (inner[t] = inner[t] || []).push([fn, capture]); }, querySelectorAll: function () { return []; }, body: null };
  lbF.onload();
  check('the whole mail listens for keys inside its frame (capture)', (inner.keydown || []).length === 1 && inner.keydown[0][1] === true);
  (inner.keydown || []).forEach(function (x) { x[0]({ key: 'a' }); });
  check('… another key there leaves it open', !!dlk.lb());
  (inner.keydown || []).forEach(function (x) { x[0]({ key: 'Escape' }); });
  check('… and Escape pressed inside the mail closes it, giving the window back', !dlk.lb() && dlk.asked('rvMailerStudio').pop().rvMailerStudio === 'close');
}));
var dlv = page2('?event=x&mailer=mailer.speakers&version=s2', { framed: true, boot: true, respond: sparseRespond(sparseCatalog()) });
pending.push(settle(30).then(function () {
  check('a deep link to a saved version of it opens the studio on that version', JSON.stringify(dlv.opened) === JSON.stringify([['mailer.speakers', 's2']]) && !dlv.lb());
}));
/* a row of this event's dashboard: a saved version of a mailer the event can no longer make still opens */
var aor = page2('?event=x');
aor.sb.MAILERS = sparseCatalog();
aor.sb.anOpen('p', 'x', 'mailer.speakers', 'Sparse', 's2');
check('the dashboard\'s row of an unavailable mailer\'s saved version opens it', JSON.stringify(aor.opened) === JSON.stringify([['mailer.speakers', 's2']]));
aor.sb.anOpen('p', 'x', 'mailer.speakers', 'Sparse', '');
check('… and without a version it is still said to be unavailable', aor.opened.length === 1 && aor.toasts.pop()[0] === 'That mailer is not available for this event any more');

/* ---- M.7: the frame grows to its content ---- */
/* The height goes out one animation frame later (a 0 ms timer here). A wait started while this file is still being
   read can fire before it: Node runs each timer length's list in the order the lists were made, and the 15 ms list
   was made long before. So these waits start once the file has been read, after the frame's timer. */
function settleAfterLoad(ms) { return new Promise(function (ok) { setImmediate(ok); }).then(function () { return settle(ms); }); }
var gr = page2('?event=x', { framed: true, height: 1234 });
gr.sb.MAILERS = sparseCatalog();
check('the frame\'s content and bar are watched (one ResizeObserver on #content)', gr.ros.length === 1 && gr.ros[0].targets[0] === gr.content);
gr.sb.owRenderPage();
pending.push(settleAfterLoad().then(function () {
  check('the page reports its content\'s height', JSON.stringify(gr.asked('rvMailerHeight')) === JSON.stringify([{ rvMailerHeight: 1234 }]));
  gr.ros[0].fire(); gr.ros[0].fire();
  return settle();
}).then(function () {
  check('… once per frame, and not again while it has not changed', gr.asked('rvMailerHeight').length === 1);
  gr.content.rect = { bottom: 1235, height: 1235 }; gr.ros[0].fire();
  return settle();
}).then(function () {
  check('… nor for a pixel', gr.asked('rvMailerHeight').length === 1);
  gr.content.rect = { bottom: 1500, height: 1500 }; gr.ros[0].fire();
  return settle();
}).then(function () {
  check('… and again when it grows', gr.asked('rvMailerHeight').pop().rvMailerHeight === 1500);
  gr.els.mailer.classList.add('on');
  gr.content.rect = { bottom: 1700, height: 1700 }; gr.ros[0].fire();
  return settle();
}).then(function () {
  check('never while the studio is open (the frame is the window then)', gr.asked('rvMailerHeight').length === 2);
  gr.sb.closeMailer();
  return settle();
}).then(function () {
  check('closing the studio reports the height again', gr.asked('rvMailerHeight').pop().rvMailerHeight === 1700);
  gr.content.rect = { bottom: 40, height: 40 }; gr.ros[0].fire();
  return settle();
}).then(function () {
  check('a hidden page (50px or less) is never reported', gr.asked('rvMailerHeight').length === 3);
  gr.sb.toast('Saved');
  check('before the page around answers: the studio\'s own toast', JSON.stringify(gr.toasts.pop()) === JSON.stringify(['Saved']) && gr.asked('rvToast').length === 0);
  gr.send({ rvMailerTall: true }, { origin: 'https://evil.example' });
  gr.send({ rvMailerTall: true }, { source: {} });
  check('rvMailerTall from another origin or another window is ignored', !gr.root.classList.contains('ow-tall'));
  gr.send({ rvMailerTall: true });
  check('rvMailerTall turns tall mode on', gr.root.classList.contains('ow-tall'));
  gr.sb.toast('Downloaded — saved edits included', 5000);
  check('tall, studio closed: toasts go to the console', gr.toasts.length === 0 &&
    JSON.stringify(gr.asked('rvToast').pop()) === JSON.stringify({ rvToast: { m: 'Downloaded — saved edits included', ms: 5000 } }));
  gr.els.mailer.classList.add('on');
  gr.sb.toast('Section moved');
  check('tall, studio open: the studio\'s own toast', JSON.stringify(gr.toasts.pop()) === JSON.stringify(['Section moved']) && gr.asked('rvToast').length === 1);
  gr.els.mailer.classList.remove('on');
}));
var team = page2('?scope=all', { framed: true, height: 800 });
team.sb.paintAnalytics();
pending.push(settleAfterLoad().then(function () {
  check('the team\'s page reports too, and with no answer nothing changes', team.asked('rvMailerHeight').length === 1 && !team.root.classList.contains('ow-tall'));
  team.sb.toast('Hello');
  check('… its toasts stay its own', JSON.stringify(team.toasts.pop()) === JSON.stringify(['Hello']) && team.asked('rvToast').length === 0);
  check('… and it never asks for a banner', team.asked('rvBanner').length === 0);
}));
var alone = page2('?event=x', { height: 900 });
alone.sb.MAILERS = sparseCatalog();
alone.sb.owRenderPage();
pending.push(settle().then(function () { check('opened on its own: nothing is posted', alone.posted.length === 0 && alone.ros.length === 0); }));

/* ---- M.10: a mail leaves only with its current banner ---- */
var JSONH = { 'content-type': 'application/json' };
function post(x, url, bodyObj) { return x.sb.api(url, { method: 'POST', headers: JSONH, body: JSON.stringify(bodyObj) }); }
var bn = page2('?event=x', { framed: true, respond: function (url) { return R(200, { ok: true, url: url }); } });
var docAnswer = null;
post(bn, '/api/mailer/doc', { portal: 'p', event: 'x', mailerId: 'mailer.announcement' }).then(function (r) { docAnswer = r; });
post(bn, '/api/mailer/download', { doc: { blocks: [] } });
post(bn, '/api/mailer/render', { doc: { blocks: [] }, editor: false, track: true });
post(bn, '/api/mailer/render', { doc: { blocks: [] } });
post(bn, '/api/mailer/render', { doc: { blocks: [] }, editor: true });
post(bn, '/api/mailer/save', { doc: { blocks: [] } });
pending.push(settle().then(function () {
  check('the studio\'s live render and a save go at once', bn.fetches.map(function (f) { return f.url; }).join() === '/api/promo/mailer/render,/api/promo/mailer/save' &&
    bn.fetches[0].body.editor === true, bn.fetches.map(function (f) { return f.url; }));
  check('the open, the downloads, Copy HTML and the export render wait for the banner: asked once for all of them', bn.asked('rvBanner').length === 1 && !docAnswer);
  bn.answerBanner(true);
  return settle();
}).then(function () {
  var urls = bn.fetches.slice(2).map(function (f) { return f.url; });
  check('… then they go', urls.join() === '/api/promo/mailer/doc,/api/promo/mailer/download,/api/promo/mailer/render,/api/promo/mailer/render' && docAnswer && docAnswer.status === 200, urls);
  check('… re-addressed and with the event as before', bn.fetches[2].body.eventId === 'x' && !('portal' in bn.fetches[2].body) && bn.fetches[4].body.track === true);
  post(bn, '/api/mailer/download', { doc: { blocks: [] } });
  return settle();
}).then(function () {
  check('once drawn, later sends do not wait or ask again', bn.asked('rvBanner').length === 1 && bn.fetches.length === 7);
}));
/* the server finds the banner out of date: drawn afresh, asked once more */
function staleThen(times, okBody) {
  var n = 0;
  return function (url) {
    if (!/\/api\/promo\/mailer\/(download|doc|render|relayout)/.test(url)) return R(404, {});
    n++;
    return n <= times ? R(409, { error: 'The mail\'s top banner is out of date and is being drawn again. Try again in a moment.', code: 'banner-stale' }) : R(200, okBody || { ok: true });
  };
}
var st1 = page2('?event=x', { framed: true, respond: staleThen(1) });
var st1r = null;
post(st1, '/api/mailer/download', { doc: { blocks: [] } }).then(function (r) { st1r = r; });
pending.push(settle().then(function () { st1.answerBanner(true); return settle(); }).then(function () {
  check('409 banner-stale: the banner is asked for afresh before anything is sent again', st1.asked('rvBanner').length === 2 && st1.asked('rvBanner')[1].fresh === true &&
    st1.fetches.length === 1 && !st1r);
  st1.answerBanner(true);
  return settle();
}).then(function () {
  check('… then the request is made once more, and its answer is the studio\'s', st1.fetches.length === 2 && st1r && st1r.status === 200 && st1.toasts.length === 0);
}));
/* Change layout is built afresh from the event, as an opened mailer is, and the server refuses it the same way while
   the banner is out of date (promo-mailer.js handleRelayout): it waits for the banner, and a 409 banner-stale has the
   banner drawn afresh and the layout asked for once more, where it was refused again on every later try */
var rl = page2('?event=x', { framed: true, respond: staleThen(1, { doc: { blocks: [] }, report: {}, html: '<html></html>' }) });
var rlr = null;
post(rl, '/api/mailer/relayout', { portal: 'p', event: 'x', mailerId: 'mailer.speakers', doc: { blocks: [] }, params: {} }).then(function (r) { rlr = r; });
pending.push(settle().then(function () {
  check('Change layout waits for the banner', rl.asked('rvBanner').length === 1 && rl.fetches.length === 0);
  rl.answerBanner(true);
  return settle();
}).then(function () {
  check('… a 409 banner-stale on it has the banner drawn afresh before the layout is asked for again', rl.fetches.length === 1 &&
    rl.fetches[0].url === '/api/promo/mailer/relayout' && rl.fetches[0].body.eventId === 'x' && rl.asked('rvBanner').length === 2 &&
    rl.asked('rvBanner')[1].fresh === true && !rlr);
  rl.answerBanner(true);
  return settle();
}).then(function () {
  check('… then asked for once more: the new layout comes back to the studio', rl.fetches.length === 2 && rlr && rlr.status === 200 && rl.toasts.length === 0);
}));
var st2 = page2('?event=x', { framed: true, respond: staleThen(5) });
var st2r = null;
post(st2, '/api/mailer/doc', { mailerId: 'mailer.announcement' }).then(function (r) { st2r = r; });
pending.push(settle().then(function () { st2.answerBanner(true); return settle(); }).then(function () { st2.answerBanner(false); return settle(20); }).then(function () {
  check('a second 409: no third try; the 409 goes back to the studio\'s code unchanged', st2.fetches.length === 2 && st2r && st2r.status === 409);
  check('… and the console says why, for 6 s', JSON.stringify(st2.toasts.pop()) === JSON.stringify(['The mail\'s banner could not be drawn. Reload the page and try again.', 6000]));
}));
var st3 = page2('?event=x', { framed: true, respond: function () { return R(409, { error: 'This event cannot have this mailer yet', code: 'unavailable' }); } });
var st3r = null;
post(st3, '/api/mailer/doc', { mailerId: 'mailer.speakers' }).then(function (r) { st3r = r; });
pending.push(settle().then(function () { st3.answerBanner(true); return settle(); }).then(function () {
  check('any other 409 is the studio\'s to read: no retry, no fresh banner', st3.fetches.length === 1 && st3r && st3r.status === 409 && st3.asked('rvBanner').length === 1 && st3.toasts.length === 0);
}));
var tm = page2('?event=x', { framed: true, respond: function () { return R(200, {}); } });
tm.sb.OW_BANNER_MS = 30;
var tmr = null;
post(tm, '/api/mailer/download', { doc: { blocks: [] } }).then(function (r) { tmr = r; });
pending.push(settle(80).then(function () {
  check('no answer within the limit: the request goes anyway (the server decides)', tm.fetches.length === 1 && tmr && tmr.status === 200);
}));
var un = page2('?event=x', { respond: function () { return R(200, {}); } });
post(un, '/api/mailer/download', { doc: { blocks: [] } });
pending.push(settle().then(function () { check('not framed: nothing is asked; the send goes at once', un.posted.length === 0 && un.fetches.length === 1); }));
check('the export\'s render is the plain render (it waits for the banner)', /function owMailHtml\(doc\) \{\n\s*return api\('\/api\/mailer\/render', \{ method: 'POST', headers: \{ 'content-type': 'application\/json' \}, body: JSON\.stringify\(\{ doc: doc \}\) \}\)/.test(owSrc));
/* Save as PDF: the browser lets a page open a window only just after a click, and the render may first wait up to 30 s
   for the banner, so the print window is opened at once and the mail written into it when it comes */
function printWin(list) {
  var w = { closed: false, written: [], listeners: {}, close: function () { w.closed = true; }, focus: function () {}, print: function () {},
    addEventListener: function (t, fn) { w.listeners[t] = fn; },
    document: { open: function () { w.written = []; }, write: function (h) { w.written.push(h); }, close: function () {} } };
  list.push(w);
  return w;
}
var pdWins = [], pd = page2('?event=x', { framed: true, respond: function (url) { return url === '/api/promo/mailer/render' ? R(200, { html: '<html>MAIL</html>' }) : R(404, {}); } });
pd.sb.Response = Response; pd.sb.Blob = Blob;
pd.sb.window.open = function () { return printWin(pdWins); };
var pdr = null;
pd.sb.owExport({ doc: { blocks: [] }, format: 'pdf', width: 800 }).then(function (r) { pdr = r; });
check('Save as PDF: the print window opens at once, within the click, saying it is preparing', pdWins.length === 1 && pd.fetches.length === 0 &&
  /Preparing the mail for printing/.test(pdWins[0].written.join('')));
pending.push(settle().then(function () {
  check('… while the render waits for the banner', pd.asked('rvBanner').length === 1 && pd.fetches.length === 0 && !pdr);
  pd.answerBanner(true);
  return settle();
}).then(function () {
  var w = pdWins[0];
  check('… then the mail is written into that same window, printed once it has loaded', pdWins.length === 1 && pd.fetches.length === 1 &&
    w.written.join('') === '<html>MAIL</html>' && typeof w.listeners.load === 'function' && !w.closed && pdr && pdr.status === 200, w.written);
}));
var peWins = [], pe = page2('?event=x', { respond: function () { return R(500, { error: 'The mail could not be drawn.' }); } });
pe.sb.Response = Response; pe.sb.Blob = Blob;
pe.sb.window.open = function () { return printWin(peWins); };
var peErr = null;
pe.sb.owExport({ doc: { blocks: [] }, format: 'pdf' }).then(null, function (e) { peErr = e; });
pending.push(settle().then(function () {
  check('… a mail that cannot be had closes the print window again, and the studio is told why', peWins.length === 1 && peWins[0].closed &&
    peErr && peErr.message === 'The mail could not be drawn.');
}));
var pbk = page2('?event=x', { respond: function () { return R(200, { html: '<html></html>' }); } });
pbk.sb.window.open = function () { return null; };
var pbkErr = null;
pbk.sb.owExport({ doc: { blocks: [] }, format: 'pdf' }).then(null, function (e) { pbkErr = e; });
pending.push(settle().then(function () {
  check('… a window the browser blocked is said so, and nothing is rendered', !!pbkErr && /blocked the new window/.test(pbkErr.message) && pbk.fetches.length === 0);
}));

/* ---- P11 at once: the first mailer opened on the page learns its palette: from the /doc answer when it carries
   one, else with the studio's live render. The palette waits for the doc in 25 ms steps that start only after this
   file's set-up, so these waits are counted from then (settleAfterLoad) ---- */
/* what the studio's mlLoad does with the /doc answer: takes its doc (a new object) and clears the selection */
function mlLoadLike(x, bodyObj) {
  return post(x, '/api/mailer/doc', bodyObj).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { if (j) { x.sb.MD.doc = j.doc; x.sb.MD.sel = null; } });
}
var pl = page2('?event=x', { MD: { pal: undefined, doc: null }, respond: function (url, b) {
  if (url === '/api/promo/mailer/doc') return R(200, { doc: { subject: 'S', blocks: [1] }, saved: false, save: null, html: '<html></html>' });
  if (url === '/api/promo/mailer/render') return R(200, { html: '<html></html>', palette: { accent: '#0a7d5c' } });
  return R(404, {});
} });
mlLoadLike(pl, { mailerId: 'mailer.announcement' });
pending.push(settleAfterLoad(60).then(function () {
  var r = pl.loads(/render/);
  check('a /doc answer without a palette (an older server): it is asked for once, with the live render of the opened doc', r.length === 1 && r[0].body.editor === true &&
    JSON.stringify(r[0].body.doc) === JSON.stringify({ subject: 'S', blocks: [1] }), r);
  check('… and handed to the studio (mlApplyPalette), so "Use the mailer accent" is the mail\'s', JSON.stringify(pl.palettes) === JSON.stringify([{ accent: '#0a7d5c' }]));
  check('… with nothing selected, the panel is not drawn again', pl.redraws.length === 0, pl.redraws);
}));
/* the /doc answer carries the palette (promo-mailer.js): no second drawing of the mail; the studio's chrome takes it
   once mlLoad has taken the doc, not before (an earlier mailer's doc still held does not count) */
var pdoc = page2('?event=x', { MD: { pal: undefined, doc: { blocks: ['an earlier mailer'] } }, respond: function (url) {
  if (url === '/api/promo/mailer/doc') return R(200, { doc: { subject: 'D', blocks: [2] }, saved: false, save: null, html: '<html></html>', palette: { accent: '#b0122a' } });
  if (url === '/api/promo/mailer/render') return R(200, { html: '<html></html>', palette: { accent: '#999999' } });
  return R(404, {});
} });
post(pdoc, '/api/mailer/doc', { mailerId: 'mailer.announcement' });
pending.push(settleAfterLoad(10).then(function () {
  check('a /doc answer with a palette: it is the studio\'s at once (MD.pal, so a colour field built now reads it)',
    JSON.stringify(pdoc.sb.MD.pal) === JSON.stringify({ accent: '#b0122a' }), pdoc.sb.MD.pal);
  check('… the chrome waits for mlLoad to take the doc, so mlLoad\'s own panel cannot paint the picker over it', pdoc.palettes.length === 0);
  pdoc.sb.MD.doc = { subject: 'D', blocks: [2] };
  return settle(60);
}).then(function () {
  check('… then hands it to the studio once', JSON.stringify(pdoc.palettes) === JSON.stringify([{ accent: '#b0122a' }]), pdoc.palettes);
  check('… and the mail is not drawn a second time for it: no /render', pdoc.loads(/render/).length === 0, pdoc.fetches);
}));
/* a block the sender selected before the palette arrived (a slow render), with a colour field showing */
var selShows = true, dRender = deferred();
var psel = page2('?event=x', { MD: { pal: undefined, doc: null, sel: null },
  query: function (s) { return selShows && /#mlProps \.hexf/.test(s) ? {} : null; },
  respond: function (url) {
    if (url === '/api/promo/mailer/doc') return R(200, { doc: { blocks: [{ id: 'b1', type: 'cta' }] }, saved: false, save: null, html: '<html></html>' });
    if (url === '/api/promo/mailer/render') return dRender.p;
    return R(404, {});
  } });
mlLoadLike(psel, { mailerId: 'mailer.announcement' });
pending.push(settleAfterLoad().then(function () {
  psel.sb.MD.sel = 'b1';
  check('a block selected before the palette arrives: its colour field was built with the stand-in', psel.sb.MD.pal === undefined &&
    psel.loads(/render/).length === 1 && psel.palettes.length === 0 && psel.redraws.length === 0);
  dRender.go(Promise.resolve(R(200, { html: '<html></html>', palette: { accent: '#0a7d5c' } })));
  return settle(30);
}).then(function () {
  check('… once the palette lands, the studio has it and the panel and inspector are drawn again, once, reading it',
    JSON.stringify(psel.palettes) === JSON.stringify([{ accent: '#0a7d5c' }]) &&
    JSON.stringify(psel.redraws) === JSON.stringify([['mlProps', '#0a7d5c', 1], ['mlInspector', '#0a7d5c', 1]]), psel.redraws);
}));
/* the same, but the selected block has no colour field: the sender's panel is left as it is */
var dRender2 = deferred();
var pnof = page2('?event=x', { MD: { pal: undefined, doc: null, sel: null }, query: function () { return null; },
  respond: function (url) {
    if (url === '/api/promo/mailer/doc') return R(200, { doc: { blocks: [{ id: 'b1', type: 'text' }] }, saved: false, save: null, html: '<html></html>' });
    if (url === '/api/promo/mailer/render') return dRender2.p;
    return R(404, {});
  } });
mlLoadLike(pnof, { mailerId: 'mailer.announcement' });
pending.push(settleAfterLoad().then(function () {
  pnof.sb.MD.sel = 'b1';
  dRender2.go(Promise.resolve(R(200, { html: '<html></html>', palette: { accent: '#0a7d5c' } })));
  return settle(30);
}).then(function () {
  check('… a selected block with no colour field showing: the palette is the studio\'s, the panel is not drawn again',
    pnof.palettes.length === 1 && pnof.redraws.length === 0, pnof.redraws);
}));
/* a live render (after an edit) brings its own, newer palette while this one waits for the doc: the newer one stays */
var pnew = page2('?event=x', { MD: { pal: undefined, doc: null }, respond: function (url) {
  return url === '/api/promo/mailer/doc' ? R(200, { doc: { blocks: [] }, palette: { accent: '#b0122a' } }) : R(404, {});
} });
post(pnew, '/api/mailer/doc', { mailerId: 'mailer.announcement' });
pending.push(settleAfterLoad(10).then(function () {
  pnew.sb.MD.pal = { accent: '#222222' };
  pnew.sb.MD.doc = { blocks: [] };
  return settle(60);
}).then(function () {
  check('a newer palette from a live render meanwhile is kept: the /doc one stands aside', pnew.palettes.length === 0 && pnew.sb.MD.pal.accent === '#222222', pnew.sb.MD.pal);
}));
/* a doc the studio never takes (it could not read the answer): the wait ends, with MD.pal kept for the fields */
var pnever = page2('?event=x', { MD: { pal: undefined, doc: null }, respond: function (url) {
  return url === '/api/promo/mailer/doc' ? R(200, { doc: { blocks: [] }, palette: { accent: '#b0122a' } }) : R(404, {});
} });
pnever.sb.OW_PAL_WAIT_TRIES = 2;
post(pnever, '/api/mailer/doc', { mailerId: 'mailer.announcement' });
pending.push(settleAfterLoad(120).then(function () {
  pnever.sb.MD.doc = { blocks: [] };
  return settle(60);
}).then(function () {
  check('a doc never taken: the wait for it ends (bounded), the fields still read MD.pal', pnever.palettes.length === 0 &&
    JSON.stringify(pnever.sb.MD.pal) === JSON.stringify({ accent: '#b0122a' }));
}));
check('the wait for mlLoad is bounded at 2 s', /var OW_PAL_WAIT_MS = 25, OW_PAL_WAIT_TRIES = 80;/.test(owSrc));
var pk = page2('?event=x', { MD: { pal: { accent: '#111111' }, doc: null }, respond: function (url) { return url === '/api/promo/mailer/doc' ? R(200, { doc: { blocks: [] } }) : R(200, {}); } });
post(pk, '/api/mailer/doc', { mailerId: 'mailer.announcement' });
pending.push(settle(30).then(function () { check('a palette already known is not asked for again', pk.loads(/render/).length === 0 && pk.palettes.length === 0); }));

Promise.all(pending).then(function () {
  if (failed) { console.error('promo-studio: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-studio: all ' + passed + ' checks passed');
}, function (err) { console.error('promo-studio: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
