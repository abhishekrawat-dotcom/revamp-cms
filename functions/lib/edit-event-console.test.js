// node functions/lib/edit-event-console.test.js — the event console says only what is true (UX-059 to UX-064):
//   - RevampCore's readings: where the site stands (siteState: Draft / Live since / Offline, waiting, rejected,
//     newer changes), who may take it offline, the Basics rows, the short description's lengths, and what a live
//     page tells search engines (readSiteHead)
//   - the Dashboard (edit-event-dashboard.js, run in a vm over the real core with the API stubbed): real figures
//     or "not known", never '+31 today', 'NaN%', made-up colleagues or a hand-ticked checklist
//   - the console page (edit-event.html, read as a file; its route table run in a vm): no button that says
//     "saved" without saving, no per-browser "published" flag, Payment inside the event, the gallery uploading
//     its photos, Basics editable over the limit
//   - the rail (sidebar.js) and the server's file list (access.js): Payment never leads to the prototype
// No network, no Firebase, no browser.
var fs = require('fs'), path = require('path'), vm = require('vm');
var access = require('./access');

var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : '')); }
function es5(name, src) {
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  check(name + ' is ES5: no let, const or arrow functions', !/\blet\s/.test(code) && !/\bconst\s/.test(code) && code.indexOf('=>') === -1);
}

/* ---------- the core, in a vm ---------- */
function loadCore(extra) {
  var win = { location: { origin: 'https://revamp.example' } };
  var ctx = Object.assign({ window: win, location: win.location, console: console, Promise: Promise, URLSearchParams: URLSearchParams, setTimeout: setTimeout,
    document: { getElementById: function () { return null; } } }, extra || {});
  ctx.window = win;
  vm.createContext(ctx);
  vm.runInContext(read('edit-event-core.js'), ctx);
  return { C: win.RevampCore, ctx: ctx, win: win };
}
var core = loadCore(), C = core.C;
es5('edit-event-core.js', read('edit-event-core.js'));
es5('edit-event-dashboard.js', read('edit-event-dashboard.js'));
es5('sidebar.js', read('sidebar.js'));

/* ---- siteState ---- */
function chips(st) { return st.chips.map(function (c) { return c.text + '|' + c.tone + (c.href ? '|' + c.href : ''); }); }
var st = C.siteState({ eventId: 'ev-a' });
check('siteState: a new event is a Draft, not saved', !st.live && !st.offline && st.savedVersion === 0 && JSON.stringify(chips(st)) === '["Draft|mute"]' && /not been saved/.test(st.chips[0].title), chips(st));
st = C.siteState({ eventId: 'ev-a', site: { version: 3 } });
check('siteState: saved, never published: Draft, saved', JSON.stringify(chips(st)) === '["Draft|mute"]' && st.savedVersion === 3 && /saved but has not been published/.test(st.chips[0].title), st);
st = C.siteState({ eventId: 'ev-a', published: true, publishedVersion: 9, publishedAt: '2026-11-01T06:30:00.000Z', site: { version: 9 } });
check('siteState: live: "Live since <date>" in green, nothing newer', st.live && st.liveVersion === 9 && !st.newer && st.chips.length === 1 && /^Live since \d{1,2} Nov 2026$/.test(st.chips[0].text) && st.chips[0].tone === 'ok' && /Version 9/.test(st.chips[0].title), chips(st));
st = C.siteState({ eventId: 'ev-a', published: true, publishedVersion: 9, publishedAt: '2026-11-01T06:30:00.000Z', site: { version: 11 } });
check('siteState: live with newer saves: a second chip says they are not published', st.newer && st.chips[1].text === 'Newer changes not published' && st.chips[1].tone === 'warn' && /Version 11 is saved; version 9 is live/.test(st.chips[1].title), chips(st));
st = C.siteState({ eventId: 'ev-a', published: true, publishedVersion: 9, publishedAt: '2026-11-01T06:30:00.000Z', site: { version: 11 },
  approval: { id: 'req123456', toVersion: 11, requestedBy: 'a@timesinternet.in', requestedAt: '2026-11-02T06:30:00.000Z' } });
check('siteState: a request waiting: amber, links to its review page, and "newer" is not said twice', st.pending && !st.newer &&
  st.chips[1].text === 'Waiting for approval · Review' && st.chips[1].tone === 'warn' && st.chips[1].href === '/review.html?event=ev-a&request=req123456' &&
  /a@timesinternet\.in/.test(st.chips[1].title), chips(st));
st = C.siteState({ eventId: 'ev-a', site: { version: 4 } }, { requests: [{ id: 'rq1', status: 'rejected', toVersion: 4, decidedBy: 'b@timesinternet.in' }], rejectNote: 'Fix the date' });
check('siteState: the newest request rejected: red, with who and why, linked', st.rejected && st.chips[1].text === 'Changes rejected · Review' && st.chips[1].tone === 'bad' &&
  st.chips[1].href === '/review.html?event=ev-a&request=rq1' && /b@timesinternet\.in: Fix the date/.test(st.chips[1].title), chips(st));
st = C.siteState({ eventId: 'ev-a', site: { version: 4 } }, { requests: [{ id: 'rq2', status: 'approved' }, { id: 'rq1', status: 'rejected' }] });
check('siteState: an older rejection does not count once a newer request was approved', !st.rejected && st.chips.length === 1, chips(st));
st = C.siteState({ eventId: 'ev-a', site: { version: 4 }, approval: { id: 'rq3', toVersion: 4 } }, { requests: [{ id: 'rq1', status: 'rejected' }] });
check('siteState: a request waiting wins over an older rejection', st.pending && !st.rejected, chips(st));
st = C.siteState({ eventId: 'ev-a', published: false, unpublishedAt: '2026-11-02T06:30:00.000Z', site: { version: 9 } });
check('siteState: taken offline: "Offline", not a draft', st.offline && !st.live && st.chips[0].text === 'Offline' && /taken offline/.test(st.chips[0].title), chips(st));
st = C.siteState({ eventId: 'ev-a', published: 'yes', publishedVersion: 3 });
check('siteState: every chip has a word or two for a narrow top bar', ['Draft', 'Live', 'Offline', 'Waiting for approval', 'Rejected', 'Not published'].every(function (w) {
  return [C.siteState({}), C.siteState({ published: true }), C.siteState({ unpublishedAt: 'x' }), C.siteState({ approval: { id: 'r' } }),
    C.siteState({}, { requests: [{ id: 'q', status: 'rejected' }] }), C.siteState({ published: true, publishedVersion: 1, site: { version: 2 } })]
    .some(function (x) { return x.chips.some(function (c) { return c.short === w; }); });
}));
check('siteState: only a real true is live', !st.live && st.liveVersion === 0, st);

/* ---- mayTakeOffline ---- */
check('mayTakeOffline: not known yet: the server decides', C.mayTakeOffline(null) === true);
check('mayTakeOffline: no approvers named: anyone signed in', C.mayTakeOffline({ me: 'x@timesinternet.in', approvers: [] }) === true);
check('mayTakeOffline: an approver (any case)', C.mayTakeOffline({ me: 'Boss@TimesInternet.in', approvers: ['boss@timesinternet.in'] }) === true);
check('mayTakeOffline: a team member who is not one', C.mayTakeOffline({ me: 'member@timesinternet.in', approvers: ['boss@timesinternet.in'] }) === false);

/* ---- basicsGaps and DESC ---- */
check('DESC: 40 / 160 / 220', C.DESC.min === 40 && C.DESC.ideal === 160 && C.DESC.max === 220, C.DESC);
var full = { name: 'ETCIO Conclave', start: '2027-05-21T10:00', end: '2027-05-22T18:00', venue: 'Grand Hyatt', city: 'Goa', desc: new Array(12).join('word ') + 'end.', cat: 'ip', portal: 'cio' };
var gaps = C.basicsGaps(full);
check('basicsGaps: six rows (the portal last), all done for a filled event', gaps.length === 6 && gaps.every(function (g) { return !g.why; }) &&
  gaps[5].key === 'portal' && gaps[5].label === 'Portal' && gaps[5].field === 'b-portal', gaps);
gaps = C.basicsGaps({ name: ' ', start: '', venue: '', city: '', desc: 'short', cat: '', portal: '' });
check('basicsGaps: an empty event has six things to do', gaps.filter(function (g) { return g.why; }).length === 6 && /Add at least 40 characters \(now 5\)/.test(gaps[3].why) &&
  gaps[5].why === 'Choose the portal it belongs to', gaps);
gaps = C.basicsGaps(Object.assign({}, full, { portal: undefined }));
check('basicsGaps: no portal yet is the one thing to do', gaps.filter(function (g) { return g.why; }).length === 1 && gaps[5].why === 'Choose the portal it belongs to', gaps[5]);
gaps = C.basicsGaps(Object.assign({}, full, { desc: new Array(331).join('x') }));
check('basicsGaps: a 330-character description: "Shorten to 160"', gaps[3].why === 'Shorten to 160 characters (now 330)', gaps[3]);
gaps = C.basicsGaps(Object.assign({}, full, { end: '2027-05-20T10:00' }));
check('basicsGaps: an end before the start points at the end', gaps[1].field === 'b-end' && /before the start/.test(gaps[1].why), gaps[1]);
gaps = C.basicsGaps(Object.assign({}, full, { start: '2027-05-21', end: '' }));
check('basicsGaps: a date without a time is a date', !gaps[1].why, gaps[1]);

/* ---- readSiteHead ---- */
var PAGE = '<!DOCTYPE html><html><head><meta charset="utf-8"><title data-rv-head>Brand World &amp; Summit 2026</title>' +
  '<!-- <meta name="description" content="a comment"> -->' +
  '<meta name="description" content="India&#39;s brand leaders meet in Mumbai. &quot;Bold&quot;" data-rv-head>' +
  '<link rel="canonical" href="https://revamp-cms--revamp-cms.us-east4.hosted.app/e/brand-world-summit-2026" data-rv-head>' +
  '<meta property="og:title" content="Brand World Summit 2026" data-rv-head>' +
  "<meta content='https://storage.googleapis.com/b/hero.jpg' property='og:image' data-rv-seo>" +
  '<meta name="robots" content="index, follow, max-image-preview:large" data-rv-seo>' +
  '<script type="application/ld+json" data-rv-seo>{"@context":"https://schema.org","@type":"Event","name":"Brand World Summit 2026"}</script>' +
  '</head><body><script type="application/ld+json">{"@type":"Event"}</script></body></html>';
var h = C.readSiteHead(PAGE);
check('readSiteHead: the title, entities read', h.title === 'Brand World & Summit 2026', h.title);
check('readSiteHead: the description (not the one in a comment), entities read', h.description === 'India\'s brand leaders meet in Mumbai. "Bold"', h.description);
check('readSiteHead: the canonical address', h.canonical === 'https://revamp-cms--revamp-cms.us-east4.hosted.app/e/brand-world-summit-2026', h.canonical);
check('readSiteHead: the share picture, whatever the attribute order and quotes', h.image === 'https://storage.googleapis.com/b/hero.jpg', h.image);
check('readSiteHead: robots read, the page may be listed, an Event is given', h.robots === 'index, follow, max-image-preview:large' && h.noindex === false && h.eventLd === true, h);
h = C.readSiteHead('<html><head><title>X</title><meta name="robots" content="noindex, nofollow"><script type="application/ld+json">{"@type":"Organization"}</script></head><body><script type="application/ld+json">{"@type":"Event"}</script></body></html>');
check('readSiteHead: noindex is seen; an Event only in the body, or another type, is not an Event in the head', h.noindex === true && h.eventLd === false && h.description === '' && h.image === '' && h.canonical === '', h);
h = C.readSiteHead('<html><head><script type="application/ld+json">{not json</script><meta name="robots" content="none"></head></html>');
check('readSiteHead: a broken block is nothing; robots "none" is noindex', h.eventLd === false && h.noindex === true, h);
check('readSiteHead: nothing in, nothing out', JSON.stringify(C.readSiteHead('')) === JSON.stringify({ title: '', description: '', canonical: '', ogTitle: '', image: '', robots: '', noindex: false, eventLd: false }));

/* ---------- the Dashboard, in a vm over the real core ---------- */
var dashSrc = read('edit-event-dashboard.js');
['+31 today', '+12.4%', 'benchmark', 'Abhishek', 'Vishakha', 'Ayush', 'September', 'Shift-click', 'checklist', 'Synced', 'actually doing'].forEach(function (s) {
  check('the Dashboard file has no "' + s + '"', dashSrc.indexOf(s) === -1);
});

function makeDash(opts) {
  opts = opts || {};
  var env = loadCore();
  var DC = env.C, calls = { stats: 0, log: 0, forms: 0, counts: 0, state: 0, render: 0 };
  DC.fetchStats = function () { calls.stats++; return opts.statsErr ? Promise.reject(new Error(opts.statsErr)) : Promise.resolve(opts.stats); };
  DC.fetchActivityLog = function (id, o) { calls.log++; calls.logOpts = o; return opts.logPromise || Promise.resolve({ items: opts.log || [] }); };
  DC.fetchForms = function () { calls.forms++; return Promise.resolve(opts.forms || { forms: [{ id: 'f1' }], registration: { open: true } }); };
  env.ctx.window.EditEventDashboard = undefined;
  vm.runInContext(dashSrc, env.ctx);
  var D = env.win.EditEventDashboard;
  var onScreen = { id: 'dash-root' };
  var ctx = DC.makeCtx({ EV: opts.ev, S: {}, render: function () { calls.render++; } });
  ctx.$ = function (id) { return id === 'dash-root' ? onScreen : null; };
  ctx.approval = function () { return opts.approval || null; };
  ctx.refreshState = function () { calls.state++; return Promise.resolve(); };
  ctx.contentCounts = function () { calls.counts++; return Promise.resolve(opts.counts || { speakers: 0, agenda: 0, sponsors: 0 }); };
  ctx.isAward = function () { return !!opts.award; };
  ctx.log = { when: function (iso) { return 'W(' + iso + ')'; }, who: function (by) { return by === 'platform' ? 'Platform (automated)' : by; }, action: function (a) { return { 'site-saved': 'Site saved to staging', published: 'Published (live)' }[a] || a; } };
  return { D: D, ctx: ctx, calls: calls };
}
function settle() { return new Promise(function (r) { setTimeout(r, 20); }); }
function text(html) { return html.replace(/<[^>]+>/g, ' ').replace(/&rsaquo;/g, '›').replace(/&amp;/g, '&').replace(/\s+/g, ' '); }

var NEW_EV = { id: 'qa-new', eventId: 'qa-new', name: 'New event' };
function days(n, regs) { var out = []; for (var i = 0; i < n; i++) out.push({ date: 'd' + i, views: 0, uniques: 0, registrations: 0 }); (regs || []).forEach(function (r) { out[n - 1 - r[0]].registrations = r[1]; }); return out; }
var STATS = { registrations: 2, confirmed: 2, waitlist: 0, cancelled: 0, checkedIn: 0, pending: 0, awaitingApproval: 1, visitors: 0, uniques: 0,
  visitsCounted: false, conversion: 0, capacity: null, target: null, byDay: days(30, [[0, 1], [3, 1]]) };

(async function () {
  /* a brand-new event, before anything has arrived */
  var t = makeDash({ ev: NEW_EV, stats: STATS });
  var first = t.D.view(t.ctx);
  check('Dashboard, first draw: says it is loading, no made-up figure', /Loading…/.test(first) && !/NaN|\+31|12\.4%/.test(first), text(first).slice(0, 400));
  check('Dashboard, first draw: the site line says Draft, not saved', /Draft/.test(first) && /The site has not been saved yet/.test(text(first)), text(first).slice(0, 400));
  check('Dashboard: tiles are not squeezed by an inline four-column rule', !/grid-template-columns:repeat\(4,1fr\)/.test(first) && /class="stat-grid dash-tiles"/.test(first));
  t.D.wire(t.ctx);
  check('Dashboard: opening it fetches the figures, the latest 5 log rows, the counts, the forms and the state', t.calls.stats === 1 && t.calls.log === 1 && t.calls.logOpts.limit === 5 && t.calls.counts === 1 && t.calls.forms === 1 && t.calls.state === 1, t.calls);
  await settle();
  check('Dashboard: the answers draw the view again, each part as it arrives', t.calls.render >= 2, t.calls);
  var v = t.D.view(t.ctx), tv = text(v);
  check('Dashboard: registrations are the real total, with the real last-7-days count', /Registrations 2 2 in the last 7 days/.test(tv), tv.slice(0, 600));
  check('Dashboard: page views are said not to be counted (no zeros passed off as real)', /Page views Not counted Visits to the site are not counted yet/.test(tv) && !/NaN/.test(v), tv.slice(0, 600));
  check('Dashboard: responses waiting for the organiser\'s approval, linked to Reporting', /Responses to approve 1 Approve or decline them in Reporting/.test(tv) && /data-goto="audience\/reg"/.test(v), tv.slice(0, 600));
  check('Dashboard: no capacity: "No limit", leading to where it is set', /Seats left No limit No capacity set/.test(tv) && /data-goto="settings\/form"/.test(v), tv.slice(0, 600));
  check('Dashboard: no target set: no target bar', !/Registration target/.test(tv));
  check('Dashboard: by status, from the stats', /Registrations 2 in all/.test(tv) && /Confirmed 2/.test(tv) && /Cancelled 0/.test(tv) && !/Checked in/.test(tv), tv);
  check('Dashboard: no log yet: "No changes yet", and the way to the full log', /No changes yet/.test(tv) && /data-goto="activity"/.test(v));
  check('Dashboard: Ready to publish is worked out, read-only, no checkbox, no percent', /Ready to publish/.test(tv) && /Basics 1 of 6 filled in/.test(tv) && /Speakers None on the site yet/.test(tv) &&
    /Site Not saved yet: open the site editor and save it/.test(tv) && /Registration Open · 1 form/.test(tv) && /1 of 6 ready/.test(tv) && !/class="cb"/.test(v) && !/data-chk/.test(v) && !/%<\/b>/.test(v), tv);
  check('Dashboard: a stamp says when the figures were read; Refresh is there', /Updated /.test(tv) && /id="dash-refresh"/.test(v) && !/id="dash-refresh" disabled/.test(v));
  t.D.wire(t.ctx);
  check('Dashboard: drawn again within a minute: nothing fetched again', t.calls.stats === 1, t.calls);

  /* Refresh */
  var btn = null;
  t.ctx.$ = function (id) { if (id === 'dash-refresh') return btn = btn || {}; return id === 'dash-root' ? {} : null; };
  t.D.wire(t.ctx);
  btn.onclick();
  check('Dashboard: Refresh fetches again and shows it is refreshing', t.calls.stats === 2 && t.calls.state === 2 && /Refreshing…/.test(t.D.view(t.ctx)), t.calls);
  await settle();

  /* a live event with a log, a target, a capacity, counted visits and content */
  var LIVE = { id: 'brand-world-summit-2026', eventId: 'brand-world-summit-2026', name: 'Brand World Summit 2026', start: '2026-12-05T10:41', venue: 'Jio World', city: 'Mumbai',
    category: 'ip', description: 'The annual gathering of India\'s marketing and brand leaders, with talks, awards and an evening of networking.',
    portal: 'brandequity', portalName: 'ET BrandEquity',
    published: true, publishedVersion: 9, publishedAt: '2026-10-20T06:30:00.000Z', site: { version: 10, updatedAt: '2026-11-01T06:30:00.000Z' },
    approval: { id: 'req99', toVersion: 10, requestedBy: 'a@timesinternet.in' } };
  t = makeDash({ ev: LIVE, award: false, counts: { speakers: 12, agenda: 1, sponsors: 0 },
    stats: Object.assign({}, STATS, { registrations: 150, confirmed: 140, checkedIn: 0, visitsCounted: true, visitors: 0, uniques: 0, target: 300, capacity: 200 }),
    log: [{ at: '2026-11-02T05:00:00Z', by: 'a@timesinternet.in', action: 'site-saved', detail: 'Hero text changed' },
      { at: '2026-10-20T06:30:00Z', by: 'platform', action: 'published', detail: 'version 9' }] });
  t.D.view(t.ctx); t.D.wire(t.ctx); await settle();
  v = t.D.view(t.ctx); tv = text(v);
  check('Dashboard (live): the site line: saved, live since, waiting with its review link, and the live site', /Last saved .* \(version 10\)/.test(tv) && /Live since .* \(version 9\)/.test(tv) &&
    /href="\/review\.html\?event=brand-world-summit-2026&amp;request=req99"/.test(v) && /View live site/.test(tv) && /https:\/\/revamp\.example\/e\/brand-world-summit-2026/.test(v), tv.slice(0, 500));
  check('Dashboard (live): counted visits but none yet: "—", never NaN', /Visitor to registration — No page views yet/.test(tv) && !/NaN/.test(v), tv.slice(0, 700));
  check('Dashboard (live): target and seats from the registration settings', /50% of the target of 300/.test(tv) && /Seats left 60 140 of 200 confirmed/.test(tv) && /Registration target/.test(tv) && /150 of 300/.test(tv), tv.slice(0, 900));
  check('Dashboard (live): the funnel has no Checked in stage without check-ins, and no NaN', /From visit to registration/.test(tv) && /No page views yet/.test(tv) && !/Checked in/.test(tv), tv);
  check('Dashboard (live): Recent activity is the log, in its own words', /Site saved to staging › Hero text changed/.test(tv) && /by a@timesinternet\.in/.test(tv) && /Published \(live\) › version 9/.test(tv) && /by Platform \(automated\)/.test(tv) && /W\(2026-11-02T05:00:00Z\)/.test(tv), tv);
  check('Dashboard (live): Ready to publish from the records', /Basics 6 of 6 filled in/.test(tv) && /Speakers 12 speakers on the site/.test(tv) && /Agenda 1 session on the site/.test(tv) && /Sponsors None on the site yet/.test(tv) && /Site Saved in the site editor/.test(tv) && /5 of 6 ready/.test(tv), tv);

  /* a stored portal off ET's roster (the server gives it no name) is no portal: Basics still asks for one */
  t = makeDash({ ev: Object.assign({}, LIVE, { portal: 'hrworld', portalName: '' }), award: false, counts: { speakers: 12, agenda: 1, sponsors: 0 },
    stats: Object.assign({}, STATS, { visitsCounted: true }) });
  t.D.view(t.ctx); t.D.wire(t.ctx); await settle();
  tv = text(t.D.view(t.ctx));
  check('Dashboard: a portal off the roster counts as none (Basics 5 of 6, Portal left to do)', /Basics 5 of 6 filled in/.test(tv), tv);

  /* one slow answer does not hold back the rest */
  var releaseLog;
  t = makeDash({ ev: NEW_EV, stats: STATS, logPromise: new Promise(function (res) { releaseLog = res; }) });
  t.D.view(t.ctx); t.D.wire(t.ctx); await settle();
  tv = text(t.D.view(t.ctx));
  check('Dashboard: the figures are drawn while the log is still on its way', t.calls.render >= 1 && /Registrations 2 2 in the last 7 days/.test(tv) && /Recent activity The latest changes to this event Loading…/.test(tv) && /Refresh/.test(tv), tv.slice(0, 900));
  releaseLog({ items: [{ at: 'x', by: 'b@timesinternet.in', action: 'published', detail: '' }] }); await settle();
  tv = text(t.D.view(t.ctx));
  check('Dashboard: and the log when it comes', /Published \(live\)/.test(tv) && /Updated /.test(tv), tv.slice(0, 900));

  /* an award: its speakers are its jury */
  t = makeDash({ ev: LIVE, award: true, counts: { speakers: 1, agenda: 0, sponsors: 2 }, stats: STATS });
  t.D.view(t.ctx); t.D.wire(t.ctx); await settle();
  tv = text(t.D.view(t.ctx));
  check('Dashboard (award): Jury, not Speakers', /Jury 1 jury member on the site/.test(tv) && /Add a jury member/.test(tv) && !/Add a speaker/.test(tv), tv);

  /* the figures could not be read */
  t = makeDash({ ev: NEW_EV, statsErr: 'We couldn’t reach the server.' });
  t.D.view(t.ctx); t.D.wire(t.ctx); await settle();
  v = t.D.view(t.ctx); tv = text(v);
  check('Dashboard: a failed load says so and offers Refresh, with no figure shown', /The figures could not be loaded: We couldn’t reach the server\./.test(tv) && /Not loaded/.test(tv) && /Use Refresh to try again/.test(tv), tv.slice(0, 600));

  /* ---------- the console page, as a file ---------- */
  var page = read('edit-event.html');
  var inline = (page.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); });
  var main = inline.filter(function (s) { return s.indexOf('var SECTIONS = [') !== -1; })[0] || '';
  check('the console script parses', (function () { try { new vm.Script(main); return true; } catch (e) { return false; } })());
  es5('the console script', main);
  check('no button anywhere says it saved without saving (no data-save wiring)', page.indexOf('data-save') === -1 && !/notify\(b\.getAttribute\('data-save'\)\)/.test(page));
  check('nothing about the event is kept in this browser: no "published" flag, no checklist', !/S\.published/.test(page) && !/S\.checklist/.test(page) && !/localStorage\.setItem\(KEY/.test(page) && /localStorage\.removeItem\('revamp-edit-event-' \+ eventSlug\)/.test(page));
  check('the fake Archive is gone', page.indexOf('Archive requested') === -1 && page.indexOf('Archive event') === -1);
  check('no fake settings remain (GST, corporate social accounts, toggles that toast)', ['Collect GST', 'linkedin.com/company/et-oneworld', 'x.com/ETOneworld', 'Setting enabled', 'wireReminders', 'Social links saved', 'social-card.png', 'Sitemap submitted', 'Make it live', 'Make private', 'Private draft'].every(function (s) { return page.indexOf(s) === -1; }));
  var seoFn = (/function viewSEO\(\)\{[\s\S]*?\n  \}\n/.exec(page) || [''])[0];
  check('URL & SEO reads the live page and shows no made-up address', /C\.readSiteHead\(html\)/.test(page) && /fetch\(location\.origin \+ '\/e\/' \+ encodeURIComponent\(EV\.id\)/.test(page) && seoFn && seoFn.indexOf('etoneworld') === -1 && seoFn.indexOf('<input') === -1 && seoFn.indexOf('<textarea') === -1, seoFn.slice(0, 200));
  check('Visibility: Publish is the header\'s, taking offline is the real unpublish', /pub\.onclick = doPublish/.test(page) && /off\.onclick = takeOffline/.test(page) && /C\.unpublishEvent\(EV\.id\)/.test(page) && /C\.mayTakeOffline\(APPROVAL\)/.test(page));
  /* the release re-check of 5 Nov: a team member who is not an approver saw "Take the site offline…" for 2-9 s, until
     who approves had been read; now it is drawn only once that is known (or could not be read: the server decides) */
  check('Visibility: no offline button before who approves is known; "Checking…" until then, and the button if that read fails',
    /if \(!APPROVAL && !APPROVAL_FAILED\) notes\.push\('Checking who can take the site offline…'\);\s*else if \(may\) acts\.push\('<button class="btn btn-danger" type="button" id="vis-offline">/.test(page) &&
    /APPROVAL_FAILED = true;\s*if \(routeId\(\) === 'settings\/visibility'\) render\(\);/.test(page) && /APPROVAL = a;\s*APPROVAL_FAILED = false;/.test(page));
  check('Visibility: what cannot be done yet is listed as such, not offered as a select', /panel\('Not available yet'/.test(page) && !/Password protected<\/option>/.test(page) && !/Take offline automatically/.test(page));
  check('the header carries the state chips and paints them on every view', /<span class="ev-state" id="ev-state" hidden><\/span>/.test(page) && /function paintState\(\)/.test(page) && /paintState\(\);\n  \}/.test(page) && /setTimeout\(loadApproval, 0\)/.test(page));
  check('Basics: no maxlength on the description; the over-limit line is there from the start', !/maxlength="' \+ DESC_MAX/.test(page) && /id="b-desc-over" role="status" hidden/.test(page) && /' too long: it can be up to ' \+\n?\s*DESC_MAX/.test(page) && /var DESC_MIN = C\.DESC\.min, DESC_IDEAL = C\.DESC\.ideal, DESC_MAX = C\.DESC\.max;/.test(page));
  check('Basics: its checklist is the shared rule', /var items = C\.basicsGaps\(\{ name: v\('name'\)/.test(page));
  var gal = page.slice(page.indexOf('var GAL_PENDING = [];'), page.indexOf('function galDragDrop()'));
  check('Gallery: photos are uploaded (8 MB), then recorded by address; never inline', /C\.uploadImage\(EV\.id, 'gallery', p\.file\)/.test(gal) && /C\.createSub\('gallery', EV\.id, \{ imageUrl: u\.url, caption: '', order: p\.order \}\)/.test(gal) && gal.indexOf('readImage(') === -1 && gal.indexOf('STOPGAP') === -1 && gal.indexOf('img.src') === -1);
  check('Gallery: each photo shows "Uploading…", then the photo or "Not added" with Retry and Remove; the formats are said', /Uploading…/.test(gal) && /Not added\. /.test(gal) && /data-galretry/.test(gal) && /data-galdrop/.test(gal) && /JPG, PNG, WebP or GIF, up to 8 MB each\./.test(gal) && /accept="' \+ GAL_TYPES \+ '"/.test(gal));
  check('Gallery: an upload counts as a write that is out (leaving asks first), without holding the tab', /SUB_BUSY\.gallery = \(SUB_BUSY\.gallery \|\| 0\) \+ 1;/.test(gal) && /SUB_BUSY\.gallery--;/.test(gal) && gal.indexOf('SUB_HELD') === -1);
  var galFns = ['galKind', 'galWhy'].map(function (n) { return (new RegExp('  function ' + n + '\\(([^)]*)\\)\\{[\\s\\S]*?\\n  \\}\\n')).exec(gal)[0]; }).join('\n');
  var G = vm.runInNewContext('var GAL_TYPES = ' + JSON.stringify((/var GAL_TYPES = '([^']+)'/.exec(gal) || [])[1]) + '; function errText(e){ return "T:" + e.message; }\n' + galFns + '; ({ kind: galKind, why: galWhy })', {});
  check('Gallery: JPG, PNG, WebP and GIF are photos; SVG, PSD and the unknown are not', G.kind({ type: 'image/jpeg' }) === 'image/jpeg' && G.kind({ type: 'image/jpg' }) === 'image/jpeg' &&
    G.kind({ type: '', name: 'a.PNG' }) === 'image/png' && G.kind({ type: 'image/webp' }) && G.kind({ type: 'image/gif' }) && !G.kind({ type: 'image/svg+xml' }) &&
    !G.kind({ type: 'image/vnd.adobe.photoshop', name: 'banner.psd' }) && !G.kind({ type: '', name: 'x' }));
  var w415 = G.why({ status: 415, message: 'x' }, { size: 10 }), w413 = G.why({ status: 413 }, { size: 9.5 * 1048576 }), w0 = G.why({ status: 0, message: 'offline' }, { size: 1 });
  check('Gallery: a file that is not a photo, or too big, says so plainly and offers no Retry', w415.text === 'This is not a photo the site can show. Use JPG, PNG, WebP or GIF.' && w415.fixable === false &&
    w413.text === 'It is 9.5 MB; a photo can be up to 8 MB.' && w413.fixable === false, [w415, w413]);
  check('Gallery: a failure to send can be retried', w0.fixable === true && w0.text === 'T:offline', w0);
  check('Gallery: a file the browser cannot show gets no broken preview, and Retry is only offered when it can help', /if \(galKind\(file\)\) try \{ preview = URL\.createObjectURL\(file\)/.test(gal) && /\(p\.fixable \? '<button class="btn btn-secondary btn-sm" type="button" data-galretry=/.test(gal));
  check('Payment: one honest panel inside the event', /'payment':\s+viewPayment/.test(page) && /Online payment and invoices are not part of Oneworld 2\.0 yet\. Registrations are free and are not affected\./.test(page) && /data-goto="content\/basics">Back to Content/.test(page));

  /* the route table, run */
  var sections = (/var SECTIONS = (\[[\s\S]*?\n  \]);/.exec(main) || [])[1];
  var fns = ['secById', 'resolveRoute'].map(function (n) { return (new RegExp('  function ' + n + '\\(([^)]*)\\)\\{[\\s\\S]*?\\n  \\}\\n')).exec(main)[0]; }).join('\n');
  var routes = vm.runInNewContext('var IC = new Proxy({}, { get: function () { return ""; } }); var EV = { id: "x" }; var RevampRail = { href: function (s) { return "/rail/" + s; } };' +
    'function editorUrl(){ return "/editor"; } var SECTIONS = ' + sections + ';\n' + fns + '; ({ resolve: resolveRoute, SECTIONS: SECTIONS })', { Proxy: Proxy, String: String });
  function r(x) { return JSON.stringify(routes.resolve(x)); }
  check('routes: Payment is a view of the console, not another page', r('payment') === '{"sec":"payment","tab":null}' && r('audience/payments') === '{"sec":"payment","tab":null}', r('payment'));
  check('routes: the removed Settings tabs lead to the tab that covers them', r('settings/links') === '{"sec":"settings","tab":"seo"}' && r('settings/advanced') === '{"sec":"settings","tab":"visibility"}', [r('settings/links'), r('settings/advanced')]);
  check('routes: Settings has Registration forms, URL & SEO and Visibility', JSON.stringify(routes.SECTIONS.filter(function (s) { return s.id === 'settings'; })[0].tabs.map(function (x) { return x.id; })) === '["form","seo","visibility"]');
  check('routes: everything else as before', r('settings/history') === '{"sec":"activity","tab":null}' && r('dashboard') === '{"sec":"dashboard","tab":null}' && r('design/editor') === '{"url":"/editor"}' && r('nonsense') === '{"sec":"content","tab":"basics"}');

  /* ---------- the rail and the server's file list ---------- */
  var railWin = {};
  vm.runInNewContext(read('sidebar.js'), { window: railWin, document: { getElementById: function () { return null; } }, location: { search: '' }, URLSearchParams: URLSearchParams });
  check('rail: Payment opens the console\'s Payment view of the same event', railWin.RevampRail.href('payment', 'brand-world-summit-2026') === '/edit-event.html?event=brand-world-summit-2026#payment');
  check('rail: no link to the payment prototype anywhere in it', read('sidebar.js').indexOf('/payment/html_version') === -1);
  check('server: the payment prototype is not served', !access.isServableFile('payment/html_version/index.html') && !access.isServableFile('payment/html_version/index.js') && !access.isServableFile('payment/html_version/styles.css'));
  check('server: nothing else changed in what is served', access.isServableFile('edit-event.html') && access.isServableFile('templates/_shared/rv-forms.js') && access.isServableFile('promo-studio/mailer-studio.js'));
  check('access.notAnApprover: no approvers named: anyone', access.notAnApprover([], 'x@timesinternet.in', 'x') === '' && access.notAnApprover(null, 'x@timesinternet.in') === '');
  check('access.notAnApprover: an approver, any case', access.notAnApprover(['Boss@timesinternet.in'], 'boss@TIMESINTERNET.in', 'x') === '');
  check('access.notAnApprover: anybody else is told who can', access.notAnApprover(['boss@timesinternet.in', 'two@timesinternet.in'], 'member@timesinternet.in', 'take a live site offline') ===
    'Only an approver (boss@timesinternet.in, two@timesinternet.in) can take a live site offline.');

  console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
