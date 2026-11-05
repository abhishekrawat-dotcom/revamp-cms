// node functions/lib/events-dashboard-page.test.js — the events dashboard (Event_Listing.html) with ETB2B AI on it
// (plan §2, §7a, K7, K9, §12 D.2). Three kinds of check:
//   1. the page as a file: script order, the kit's stylesheet, the mount point, "Need help?" kept as the fallback;
//   2. the list's pure helpers pulled out by name and run in a vm (the address, the India-time day filters, rows);
//   3. the page's whole inline script run in a vm over a forgiving stand-in DOM, with GET /api/events answered from
//      fixtures, so window.RvListing (the bot's one door into the list) is driven for real: apply, restore, the
//      address, the chips and the help window.
// No network, no browser, no AI. The toolbar, ⋯ menu, KPI and Latest Activity markup are not pinned here
// (mailer-performance-page.test.js pins the toolbar; the UX sweep will change the rest).
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var PAGE = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function count(s, needle) { return s.split(needle).length - 1; }
function flush() { return new Promise(function (r) { setImmediate(r); }).then(function () { return new Promise(function (r) { setImmediate(r); }); }); }

var START = PAGE.indexOf('<script>\n(function(){');
var INLINE = START === -1 ? '' : PAGE.slice(START + '<script>'.length, PAGE.indexOf('</script>', START));

/* ======== 1. the page as a file ======== */
check('D.2 the inline script is found', INLINE.length > 50000);
var scripts = (PAGE.match(/<script\b[^>]*>/g) || []);
/* portal-picker.js (the portals change) sits right after auth.js, and event-lifecycle.js stays right before the inline script */
/* edit-event-core.js (B07): the API calls Clone, Delete and Restore make, before auth.js (it reads RevampAuth only when one runs) */
check('D.2 script order: theme bootstrap, theme-toggle.js, edit-event-core.js, auth.js, portal-picker.js, event-lifecycle.js, the inline script, etb2b-chat.js, dash-bot-client.js',
  same(scripts, ['<script>', '<script src="theme-toggle.js">', '<script src="edit-event-core.js">', '<script src="auth.js">', '<script src="portal-picker.js">', '<script src="event-lifecycle.js">', '<script>', '<script src="etb2b-chat.js">', '<script src="dash-bot-client.js">']), scripts);
check('D.2 the second plain <script> is the inline script itself', PAGE.indexOf('<script src="event-lifecycle.js"></script>\n<script>\n(function(){') !== -1);
check('D.2 the kit\'s scripts come after the inline script (RvListing exists before they run)', PAGE.indexOf('<script src="etb2b-chat.js">') > PAGE.indexOf('})();\n</script>', START) &&
  PAGE.indexOf('<script src="dash-bot-client.js">') > PAGE.indexOf('<script src="etb2b-chat.js">'));
var link = PAGE.indexOf('<link rel="stylesheet" href="etb2b-chat.css">');
check('D.2 etb2b-chat.css is linked once, in the head (before the page\'s styles and its header)', count(PAGE, 'href="etb2b-chat.css"') === 1 && link !== -1 && link < PAGE.indexOf('<style>') && link < PAGE.indexOf('<header'));
var access = require('./access');
['event-lifecycle.js', 'etb2b-chat.js', 'etb2b-chat.css', 'dash-bot-client.js'].forEach(function (f) { check('D.2 the server sends ' + f, access.isServableFile(f) === true); });
check('D.2 one rule for the lifecycle: no function lifecycleOf( here, RevampLifecycle.of( used', INLINE.indexOf('function lifecycleOf(') === -1 && INLINE.indexOf('lifecycleOf(') === -1 && INLINE.indexOf('window.RevampLifecycle.of(ev, Date.now())') !== -1);
check('D.2 "Need help?" stays in the markup', /<button class="help-fab" id="btn-help" type="button">[\s\S]*?Need help\?\s*<\/button>/.test(PAGE));
check('D.2 …with its click handler', INLINE.indexOf("$('btn-help').addEventListener('click', function(){ openHelpModal($('btn-help')); });") !== -1);
check('D.2 …hidden only once ETB2B AI has mounted (html.rvc-ready)', PAGE.indexOf('html.rvc-ready .help-fab{ display:none; }') !== -1 && /\.help-fab\{ position:fixed; bottom:22px; left:22px; z-index:80;/.test(PAGE));
check('D.2 openHelpModal stays, and RvListing.openHelp calls it', INLINE.indexOf('function openHelpModal(returnTo){') !== -1 && INLINE.indexOf('openHelp: function(returnTo){ openHelpModal(returnTo); }') !== -1);
var mountAt = PAGE.indexOf('<div id="rv-dash-bot"></div>');
check('D.2 <div id="rv-dash-bot"> sits right before #toast-region', count(PAGE, 'id="rv-dash-bot"') === 1 && mountAt !== -1 && /<div id="rv-dash-bot"><\/div>\n<div id="toast-region"><\/div>/.test(PAGE));
check('D.2 Create Event is still alone on the toolbar (nothing of the bot\'s added there)', (function () {
  var toolbar = PAGE.slice(PAGE.indexOf('<div class="toolbar-right-group">'), PAGE.indexOf('<div class="chip-row" id="chip-row">'));
  return toolbar.indexOf('id="btn-create-event"') !== -1 && !/ETB2B|rv-dash-bot|rvc-/.test(toolbar);
})());
check('D.2 one window.* name added by the inline script: RvListing', (INLINE.match(/window\.[A-Za-z]+\s*=(?!=)/g) || []).join(',') === 'window.RvListing =', INLINE.match(/window\.[A-Za-z]+\s*=(?!=)/g));
check('D.2 the inline script never reads the bot\'s storage or calls its routes', INLINE.indexOf('dashBot') === -1 && INLINE.indexOf('/api/dash-bot') === -1);
check('D.2 the inline script is ES5 (no let, const, arrows, template strings)', !/\blet\s|\bconst\s/.test(INLINE) && INLINE.indexOf('=>') === -1 && INLINE.indexOf('`') === -1);
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the regex check above still ran */ }
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(INLINE, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
  check('D.2 the inline script is ES5 by esbuild', es5 === true, es5);
}
check('D.2 a hashchange listener', INLINE.indexOf("window.addEventListener('hashchange', function(){") !== -1);
check('D.2 the address is kept in step from renderResults (every change to the list passes there)', /function renderResults\(\)\{[\s\S]{0,400}?syncHash\(\);\n    renderChips\(\);/.test(INLINE));

/* ======== 2. the pure helpers, by name ======== */
function fnSource(name) {
  var at = INLINE.indexOf('function ' + name + '(');
  if (at === -1) throw new Error('no function ' + name);
  var i = INLINE.indexOf('{', at), depth = 0;
  for (; i < INLINE.length; i++) { if (INLINE[i] === '{') depth++; else if (INLINE[i] === '}') { depth--; if (!depth) break; } }
  return INLINE.slice(at, i + 1);
}
function varSource(name) {
  var m = new RegExp('\\n  var ' + name + ' = [^\\n]*;').exec(INLINE);
  if (!m) throw new Error('no var ' + name);
  return m[0];
}
var helpers = {};
vm.createContext(helpers);
vm.runInContext([varSource('EVENT_TYPES'), varSource('MONTH_SHORT'), varSource('IST_OFFSET_MIN')].concat(
  ['pad2', 'validDay', 'istDay', 'cleanRange', 'inDays', 'fmtDayRange', 'parseListingHash', 'listingHash', 'searchLine', 'searchCells', 'searchHit', 'mapApiEventToRow'].map(fnSource)).join('\n'), helpers);
var H = helpers;

/* the parse of dc1a8e1, pasted unchanged, for "#tab=…&q=…" means exactly what it always did */
function todayParse(hash) {
  var st = { tab: 'active', search: '' };
  try {
    var parts = (hash || '').replace('#', '').split('&').reduce(function (acc, p) {
      var kv = p.split('='); if (kv[0]) acc[kv[0]] = decodeURIComponent(kv[1] || ''); return acc;
    }, {});
    if (parts.tab && ['active', 'upcoming', 'completed'].indexOf(parts.tab) !== -1) st.tab = parts.tab;
    if (parts.q) st.search = parts.q;
  } catch (e) { /* as it was */ }
  return st;
}
function nowParse(hash) { var p = H.parseListingHash(hash); return { tab: p.tab || 'active', search: p.search || '' }; }
['#tab=upcoming&q=x', '#tab=completed', '#q=hello%20world', '', '#', '#tab=bogus&q=', '#tab=active&q=a%2Bb', '#q=caf%C3%A9&tab=upcoming', '#tab=upcoming&tab=completed'].forEach(function (h) {
  check('D.2 parseListingHash("' + h + '") gives exactly today\'s tab and search', same(nowParse(h), todayParse(h)), [nowParse(h), todayParse(h)]);
});
check('D.2 "#tab=upcoming&q=x" → {tab, search} and nothing else', same(JSON.parse(JSON.stringify(H.parseListingHash('#tab=upcoming&q=x'))), { tab: 'upcoming', search: 'x' }));
var full = JSON.parse(JSON.stringify(H.parseListingHash('#tab=completed&q=Auto%20tech&view=draft&type=ip,awards&created=2026-10-26..2026-11-01&starts=2026-11-01..2026-11-30&mine=1')));
check('D.2 parseListingHash reads view, type, created, starts and mine', same(full, { tab: 'completed', search: 'Auto tech', specialView: 'draft', types: ['ip', 'awards'],
  created: { from: '2026-10-26', to: '2026-11-01' }, starts: { from: '2026-11-01', to: '2026-11-30' }, mine: true }), full);
var junk = JSON.parse(JSON.stringify(H.parseListingHash('#tab=drafts&view=archived&type=nonsense,ip,ip&created=2026-02-30..2026-03-01&starts=yesterday&mine=yes&x=1&q=%E0%A4%A')));
check('D.2 junk, impossible days and unknown types are left out', same(junk, { types: ['ip'], created: { from: '', to: '2026-03-01' } }), junk);
check('D.2 a reversed range is turned round; a view of deleted is read', same(JSON.parse(JSON.stringify(H.parseListingHash('#created=2026-11-01..2026-10-26&view=deleted'))), { created: { from: '2026-10-26', to: '2026-11-01' }, specialView: 'deleted' }));
check('D.2 days outside 2000–2100 are not days', H.parseListingHash('#starts=1999-12-31..2101-01-01').starts === undefined);
var STATES = [
  { tab: 'active', search: '', specialView: null, filters: { types: [] }, created: null, starts: null, mine: false },
  { tab: 'upcoming', search: 'a&b=c #1 ✓', specialView: 'cancelled', filters: { types: ['client', 'awards'] }, created: { from: '2026-10-26', to: '2026-11-01' }, starts: { from: '', to: '2026-12-31' }, mine: true },
  { tab: 'completed', search: '', specialView: 'draft', filters: { types: [] }, created: { from: '2026-01-01', to: '' }, starts: null, mine: false }
];
STATES.forEach(function (s, i) {
  var h = H.listingHash(s), back = H.parseListingHash(h);
  var round = { tab: back.tab || 'active', search: back.search || '', specialView: back.specialView || null, filters: { types: back.types || [] }, created: back.created || null, starts: back.starts || null, mine: back.mine === true };
  check('D.2 listingHash → parseListingHash round-trips (' + i + ')', same(JSON.parse(JSON.stringify(round)), s), [h, round]);
});
check('D.2 the plain list keeps today\'s address', H.listingHash(STATES[0]) === '#tab=active' && H.listingHash({ tab: 'upcoming', search: 'x', filters: { types: [] } }) === '#tab=upcoming&q=x');

/* India-time days, both ends included */
var R = { from: '2026-10-26', to: '2026-11-01' };
check('D.2 inDays: the first moment of the first day (00:00 IST = 18:30 UTC the day before) is in', H.inDays('2026-10-25T18:30:00.000Z', R) === true);
check('D.2 inDays: a second before it is out', H.inDays('2026-10-25T18:29:59.999Z', R) === false);
check('D.2 inDays: the last moment of the last day (23:59 IST) is in', H.inDays('2026-11-01T18:29:59.999Z', R) === true);
check('D.2 inDays: the next IST day is out', H.inDays('2026-11-01T18:30:00.000Z', R) === false);
check('D.2 inDays: a date typed into Create Event (no zone) is its own day', H.inDays('2026-11-01T23:30', R) === true && H.inDays('2026-10-25T23:59', R) === false && H.inDays('2026-10-26', R) === true);
check('D.2 inDays: an offset is honoured', H.inDays('2026-11-01T23:59:00+05:30', R) === true && H.inDays('2026-11-01T20:00:00-04:00', R) === false);
check('D.2 inDays: no date, or a broken one, never matches a range', H.inDays(null, R) === false && H.inDays('', R) === false && H.inDays('soon', R) === false && H.inDays('2026-02-30', R) === false);
check('D.2 inDays: open ends', H.inDays('2030-01-01T00:00', { from: '2026-10-26', to: '' }) === true && H.inDays('2020-01-01T00:00', { from: '', to: '2026-11-01' }) === true && H.inDays('2026-11-02T00:00', { from: '', to: '2026-11-01' }) === false);
check('D.2 inDays: no range is no filter', H.inDays(null, null) === true);
check('D.2 the chip wording for a range', H.fmtDayRange(R) === '26 Oct – 1 Nov 2026' && H.fmtDayRange({ from: '2026-11-01', to: '2026-11-30' }) === '1 – 30 Nov 2026' &&
  H.fmtDayRange({ from: '2026-12-20', to: '2027-01-05' }) === '20 Dec 2026 – 5 Jan 2027' && H.fmtDayRange({ from: '2026-11-03', to: '2026-11-03' }) === '3 Nov 2026' &&
  H.fmtDayRange({ from: '2026-10-26', to: '' }) === 'from 26 Oct 2026' && H.fmtDayRange({ from: '', to: '2026-11-01' }) === 'until 1 Nov 2026');

/* rows keep what the date and "mine" filters (and the bot's views) need */
H.window = { RevampLifecycle: { of: function (ev) { return ev.published ? 'upcoming' : 'draft'; } } };
var row = H.mapApiEventToRow({ id: 'auto-26', name: 'Autotech', category: 'ip', start: '2026-11-20T10:00', end: null, createdAt: '2026-10-27T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z',
  createdBy: 'asha.rao@timesinternet.in', published: true, publishedPath: '/e/auto-26', templateId: 'tech500', dateLabel: '', dateMode: 'exact', counters: { registrations: 4, views: 9 } });
check('D.2 rows keep createdAt, updatedAt, published, publishedPath, templateId, dateLabel and createdBy',
  row.createdAt === '2026-10-27T10:00:00.000Z' && row.updatedAt === '2026-11-01T10:00:00.000Z' && row.published === true && row.publishedPath === '/e/auto-26' &&
  row.templateId === 'tech500' && row.dateLabel === '' && row.createdBy === 'asha.rao@timesinternet.in' && row.dateMode === 'exact', row);
check('D.2 rows still carry what the table shows, as before', row.status === 'upcoming' && row.registrations === 4 && row.visitors === 9 && row.type === 'ip' && row.venue === 'Venue to be confirmed');
var row2 = H.mapApiEventToRow({ id: 'm', name: 'Month only', published: 'yes', dateLabel: 'November 2026', dateMode: 'month' });
check('D.2 a month-only event keeps its words; "published" is only ever true', row2.dateLabel === 'November 2026' && row2.dateMode === 'month' && row2.published === false && row2.createdAt === null && row2.publishedPath === null);

/* the search: name, venue, city and client, each on its own, read as ETB2B AI's server reads them */
var row3 = H.mapApiEventToRow({ id: 'infy', name: ' Infosys\n Leaders   Meet ', city: 'Mumbai', client: 'Infosys \t Ltd', createdBy: 'ravi@infosys.com', category: 'client' });
check('D.2 rows keep the client', row3.client === 'Infosys \t Ltd' && row2.client === '' && H.mapApiEventToRow({ id: 'n', client: 7 }).client === '');
check('D.2 rows carry the four search cells, spaces and line breaks folded, lower case, the table\'s fill-in words left out',
  same(JSON.parse(JSON.stringify(row3.searchIn)), ['infosys leaders meet', '', 'mumbai', 'infosys ltd']) && same(JSON.parse(JSON.stringify(row.searchIn)), ['autotech', '', '', '']), [row3.searchIn, row.searchIn]);
check('D.2 search: the client is searched', H.searchHit(row3, 'Ltd') === true && H.searchHit(row3, 'infosys ltd') === true);
check('D.2 search: the words searched for are folded the same way (case, spaces)', H.searchHit(row3, '  INFOSYS    LTD ') === true && H.searchHit(row3, 'leaders meet') === true);
check('D.2 search: each field on its own, never across two', H.searchHit(row3, 'Mumbai Infosys') === false && H.searchHit(row3, 'meet mumbai') === false);
check('D.2 search: the creator\'s e-mail, the type and the portal are not in the event\'s own search cells (the server does not search them there; a portal\'s name is matched on its own, below)',
  H.searchHit(row3, 'ravi') === false && H.searchHit(row3, 'infosys.com') === false && H.searchHit(row3, 'custom') === false && H.searchHit(row3, 'ETCIO') === false);
check('D.2 search: "Venue to be confirmed" and "—" are the table\'s words, not the event\'s', H.searchHit(row, 'confirmed') === false && H.searchHit(row3, '—') === false);
check('D.2 search: an empty search matches everything; a row with no cells matches nothing', H.searchHit(row3, '') === true && H.searchHit(row3, '   ') === true && H.searchHit({}, 'x') === false);

/* ======== 3. the whole page, run ======== */
function stand(opt) {
  opt = opt || {};
  var ids = {}, replaced = [], scrolled = [], winLs = {}, docLs = {};
  function parseAttrs(s) {
    var a = {}, re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, m;
    while ((m = re.exec(s))) a[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    return a;
  }
  function selMatch(sel, tag, attrs) {
    var m;
    if ((m = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(sel))) return m[2] === undefined ? m[1] in attrs : attrs[m[1]] === m[2];
    if (sel[0] === '#') return attrs.id === sel.slice(1);
    if (sel[0] === '.') return (' ' + (attrs['class'] || '') + ' ').indexOf(' ' + sel.slice(1) + ' ') !== -1;
    return tag === sel.toLowerCase();
  }
  function El(id, attrs, tag) {
    var el = this;
    this.id = id || ''; this.tagName = (tag || 'div').toUpperCase(); this._attrs = attrs || {}; this._html = ''; this._qsa = {};
    this.textContent = ''; this.value = this._attrs.value || ''; this.hidden = false; this.disabled = false; this.className = this._attrs['class'] || '';
    this.style = {}; this.listeners = {}; this.children = []; this.focused = 0; this.isConnected = true;
    this.offsetLeft = 0; this.offsetWidth = 0; this.offsetHeight = 0;
    var cls = {};
    this.classList = { add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; }, contains: function (c) { return !!cls[c]; }, toggle: function (c, on) { if (on === undefined) on = !cls[c]; if (on) cls[c] = 1; else delete cls[c]; return on; } };
    Object.defineProperty(this, 'innerHTML', {
      get: function () { return el._html; },
      set: function (v) {
        el._html = String(v); el._qsa = {};
        /* what it held is gone: an id inside it is a new element from now on */
        (el._html.match(/\bid="[^"]+"/g) || []).forEach(function (x) { delete ids[x.slice(4, -1)]; });
      }
    });
  }
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.removeEventListener = function () {};
  El.prototype.fire = function (t, ev) { var self = this; (this.listeners[t] || []).slice().forEach(function (fn) { fn.call(self, ev || { target: self, stopPropagation: function () {}, preventDefault: function () {} }); }); };
  El.prototype.setAttribute = function (k, v) { this._attrs[String(k).toLowerCase()] = String(v); };
  El.prototype.getAttribute = function (k) { k = String(k).toLowerCase(); return k in this._attrs ? this._attrs[k] : null; };
  El.prototype.removeAttribute = function (k) { delete this._attrs[String(k).toLowerCase()]; };
  El.prototype.querySelectorAll = function (sel) {
    if (this._qsa[sel]) return this._qsa[sel];
    var out = [], re = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g, m;
    while ((m = re.exec(this._html))) {
      var attrs = parseAttrs(m[2]), tag = m[1].toLowerCase();
      if (sel.split(',').some(function (s) { return selMatch(s.trim(), tag, attrs); })) out.push(new El(attrs.id, attrs, tag));
    }
    this._qsa[sel] = out;
    return out;
  };
  El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  El.prototype.appendChild = function (c) { this.children.push(c); return c; };
  El.prototype.remove = function () { this.isConnected = false; };
  El.prototype.focus = function () { this.focused++; doc.activeElement = this; };
  El.prototype.closest = function () { return null; };
  El.prototype.contains = function () { return false; };
  El.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
  El.prototype.scrollIntoView = function () {};
  var doc = {
    activeElement: { tagName: 'BODY' },
    documentElement: new El('', {}, 'html'),
    body: new El('', {}, 'body'),
    /* each element by id comes with a parent of its own (the toolbar hides the Portal filter's popover-wrap) */
    getElementById: function (id) { if (!ids[id]) { ids[id] = new El(id, { id: id }); ids[id].parentNode = new El('', {}, 'div'); } return ids[id]; },
    /* closeAll() hides every .popover: here, the popovers and menus the page has asked for by id */
    querySelectorAll: function (sel) { return sel === '.popover' ? Object.keys(ids).filter(function (k) { return /popover|menu/.test(k); }).map(function (k) { return ids[k]; }) : []; },
    querySelector: function () { return null; },
    createElement: function (t) { return new El('', {}, t); },
    addEventListener: function (t, fn) { (docLs[t] = docLs[t] || []).push(fn); }
  };
  var fetched = [];
  var ctx = {
    document: doc, console: { log: function () {}, warn: function () {}, error: function () {} },
    navigator: {},
    location: { hash: opt.hash || '', href: 'http://localhost/Event_Listing.html' + (opt.hash || ''), pathname: '/Event_Listing.html' },
    history: { replaceState: function (s, t, url) { replaced.push(url); if (/^#/.test(url)) ctx.location.hash = url; } },
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    requestAnimationFrame: function () { return 0; },
    scrollTo: function (a, b) { scrolled.push(typeof a === 'object' ? a : { top: b }); },
    matchMedia: function (q) { return { matches: !!opt.reducedMotion && /reduced-motion/.test(q) }; },
    addEventListener: function (t, fn) { (winLs[t] = winLs[t] || []).push(fn); },
    innerWidth: 1280, innerHeight: 720,
    fetch: function (url) {
      fetched.push(url);
      if (opt.fail) return Promise.reject(new TypeError('Failed to fetch'));
      /* B07: the page's two other reads of its own, the deleted events (Deleted Events) and who the approvers are
         (Delete and Restore), answered here so the panel's reads below are counted as before */
      if (url === '/api/events?deleted=1') return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ items: opt.deleted || [] }); } });
      if (url === '/api/settings/approvals') return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ approvers: opt.approvers || [], allowSelf: false, required: true }); } });
      /* the "Latest activity" panel's own reads, answered by the test when it gives opt.api */
      var a = opt.api && url !== '/api/events' ? opt.api(url) : null;
      if (a && a.pending) return new Promise(function () {});   // an answer that has not come yet
      if (a) return a.reject ? Promise.reject(new TypeError('Failed to fetch')) :
        Promise.resolve({ ok: (a.status || 200) < 300, status: a.status || 200, json: function () { return Promise.resolve(a.body); } });
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ items: opt.items || ITEMS }); } });
    },
    RevampAuth: {
      getIdToken: function () { return Promise.resolve('token'); },
      currentUser: function () { return opt.user === undefined ? { email: 'Asha.Rao@timesinternet.in', displayName: 'Asha Rao' } : opt.user; }
    }
  };
  /* a browser that can tell when the "Latest activity" card comes near the screen (opt.io): the test says when */
  var observers = [];
  if (opt.io) ctx.IntersectionObserver = function (cb, o) { var me = { cb: cb, o: o, watched: [], gone: false }; observers.push(me); this.observe = function (el) { me.watched.push(el); }; this.disconnect = function () { me.gone = true; }; };
  /* window.RevampPortals as portal-picker.js gives it (its contract K9), which the page loads before its own script:
     ET's roster, and the person's working portal (opt.working: a slug, 'all', or none chosen yet). Its own reads
     never reach fetch here, so the page's reads above are counted as before. */
  if (!opt.noPortals) {
    var roster = require('./et-events').portalList();
    var nameOf = function (slug) { var p = roster.filter(function (r) { return r.slug === slug; })[0]; return p ? p.name : ''; };
    ctx.RevampPortals = {
      list: function () { return Promise.resolve(roster.map(function (p) { return { slug: p.slug, name: p.name }; })); },
      working: function () { return Promise.resolve(opt.working || null); },
      cachedWorking: function () { return opt.working || null; },
      setWorking: function (v) { return Promise.resolve(v); },
      nameOf: nameOf,
      chipHtml: function (o) { return '<span class="rvp-chip"><span class="rvp-chip-text">No portal yet</span><button type="button" class="rvp-chip-btn" data-set-portal="' + o.eventId + '">Set portal</button></span>'; },
      openSetPortal: function () {}
    };
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'event-lifecycle.js'), 'utf8'), ctx, { filename: 'event-lifecycle.js' });
  vm.runInContext(INLINE, ctx, { filename: 'Event_Listing.html (inline)' });
  return { ctx: ctx, doc: doc, $: function (id) { return doc.getElementById(id); }, replaced: replaced, scrolled: scrolled, winLs: winLs, docLs: docLs, fetched: fetched, observers: observers,
    L: ctx.RvListing, snap: function () { return JSON.parse(JSON.stringify(ctx.RvListing.snapshot())); } };
}
var ME = 'asha.rao@timesinternet.in';
var ITEMS = [
  { id: 'draft-week', name: 'Draft Week', category: 'ip', published: false, createdAt: '2026-10-27T10:00:00.000Z', createdBy: ME, counters: {} },
  { id: 'draft-edge', name: 'Draft Edge', category: 'client', published: false, createdAt: '2026-10-25T18:30:00.000Z', createdBy: 'bob@timesinternet.in', counters: {} },
  { id: 'draft-before', name: 'Draft Before', category: 'ip', published: false, createdAt: '2026-10-25T18:29:59.000Z', createdBy: ME, counters: {} },
  { id: 'draft-old', name: 'Draft Old', category: 'awards', published: false, createdAt: '2026-10-01T10:00:00.000Z', createdBy: ME, counters: {} },
  { id: 'live-upcoming', name: 'Live Upcoming', category: 'ip', published: true, start: '2099-11-20T10:00', end: '2099-11-21T18:00', createdAt: '2026-10-20T00:00:00.000Z', createdBy: ME, counters: { registrations: 5 } },
  { id: 'live-active', name: 'Live Active', category: 'awards', published: true, start: '2020-01-01T10:00', end: '2099-01-01T10:00', createdAt: '2026-10-28T00:00:00.000Z', createdBy: 'bob@timesinternet.in', counters: {} },
  { id: 'month-only', name: 'Month Only', category: 'ip', published: true, dateMode: 'month', dateLabel: 'November 2026', createdAt: '2026-10-29T00:00:00.000Z', createdBy: ME, counters: {} }
];
function shownIds(S) { return (S.$('table-body').innerHTML.match(/data-row="([^"]+)"/g) || []).map(function (x) { return x.slice(10, -1); }); }

(async function main() {
  var S = stand();
  await flush();
  var L = S.L;
  /* setPortal: ETB2B AI's "switch to ETAuto" (plan §17) */
  check('D.2 window.RvListing has K7\'s six names and setPortal', L && same(Object.keys(L).sort(), ['apply', 'me', 'openHelp', 'ready', 'restore', 'setPortal', 'snapshot']) && Object.keys(L).every(function (k) { return typeof L[k] === 'function'; }));
  var readyHit = false; await L.ready().then(function () { readyHit = true; });
  check('D.2 ready() settles once the events have loaded', readyHit && S.fetched[0] === '/api/events');
  check('D.2 a page opened with no address keeps it (no #tab=active written on load)', S.replaced.length === 0, S.replaced);
  check('D.2 me(): the signed-in person', same(JSON.parse(JSON.stringify(L.me())), { email: 'Asha.Rao@timesinternet.in', name: 'Asha Rao' }));
  var base = S.snap();
  check('D.2 snapshot(): {tab, specialView, search, filters, created, starts, mine, sort, page, view} (+ portal, working, listPortal, portalReturn, shown)', same(Object.keys(base), ['tab', 'specialView', 'search', 'filters', 'created', 'starts', 'mine', 'sort', 'page', 'view', 'portal', 'working', 'listPortal', 'portalReturn', 'shown']) &&
    same(base, { tab: 'active', specialView: null, search: '', filters: { types: [], portals: [], payment: [] }, created: null, starts: null, mine: false, sort: { field: 'start', dir: 'asc' }, page: 1, view: 'list', portal: '', working: 'all', listPortal: 'all', portalReturn: '', shown: 1 }), base);
  var s1 = L.snapshot(); s1.filters.types.push('ip');
  check('D.2 snapshot() is a copy (changing it changes nothing)', S.snap().filters.types.length === 0);
  check('D.2 the Active tab lists the live, running event', same(shownIds(S), ['live-active']));

  /* apply: "Show drafts from last week" */
  S.L.restore(Object.assign(S.snap(), { search: 'draft', filters: { types: [], portals: ['cio'], payment: ['free'] }, page: 1 }));
  var beforeApply = S.snap();
  var before = JSON.parse(JSON.stringify(L.apply({ view: 'draft', search: '', types: [], mine: false, created: { from: '2026-10-26', to: '2026-11-01' }, starts: null, sort: null })));
  delete before.shown; delete beforeApply.shown;
  check('D.2 apply() returns the list as it was before', same(before, beforeApply), [before, beforeApply]);
  var after = S.snap();
  check('D.2 apply(): Draft events, created 26 Oct – 1 Nov, page 1', after.specialView === 'draft' && after.tab === 'active' && same(after.created, { from: '2026-10-26', to: '2026-11-01' }) && after.page === 1 && after.search === '');
  check('D.2 apply(): a filter the card does not name (portal, payment) is cleared', same(after.filters, { types: [], portals: [], payment: [] }));
  check('D.2 apply(): exactly the drafts made in those India-time days', same(shownIds(S).sort(), ['draft-edge', 'draft-week']), shownIds(S));
  check('D.2 apply(): the result line counts them', S.$('result-line').textContent === 'Showing 1–2 of 2 events', S.$('result-line').textContent);
  check('D.2 apply(): the address follows', S.ctx.location.hash === '#tab=active&view=draft&created=2026-10-26..2026-11-01', S.ctx.location.hash);
  check('D.2 apply(): the search box shows the search (now empty)', S.$('search-input').value === '' && S.$('btn-clear-search').hidden === true);
  check('D.2 apply(): the results come into view (smooth)', S.scrolled.length >= 1 && S.scrolled[S.scrolled.length - 1].top === 0 && S.scrolled[S.scrolled.length - 1].behavior === 'smooth');
  var chips = S.$('chip-row').innerHTML;
  check('D.2 the created chip says the range and has a ✕ with a name', chips.indexOf('Created 26 Oct – 1 Nov 2026') !== -1 && /<button type="button" data-chip="0" aria-label="Remove filter: Created 26 Oct – 1 Nov 2026"><svg/.test(chips), chips);
  check('D.2 the Draft banner says what is shown', S.$('special-banner').innerHTML.indexOf('Showing <strong>Draft events</strong>') !== -1);

  /* the chip's ✕ */
  S.$('chip-row').querySelectorAll('[data-chip]')[0].fire('click');
  check('D.2 the created chip\'s ✕ removes that filter: every draft shows again', S.snap().created === null && same(shownIds(S).sort(), ['draft-before', 'draft-edge', 'draft-old', 'draft-week']) &&
    S.ctx.location.hash === '#tab=active&view=draft', [shownIds(S), S.ctx.location.hash]);

  /* restore: exactly as it was */
  check('D.2 restore() puts back tab, view, search, filters, sort and page', L.restore(before) === true && same((function () { var x = S.snap(); delete x.shown; return x; })(), before));
  check('D.2 restore(): the search box and the address follow', S.$('search-input').value === 'draft' && S.ctx.location.hash === '#tab=active&q=draft');
  L.restore(base);

  /* starts and mine, and their chips */
  L.apply({ view: 'upcoming', search: '', types: ['ip'], mine: true, created: null, starts: { from: '2099-11-01', to: '2099-11-30' }, sort: { field: 'registrations', dir: 'desc' } });
  var a2 = S.snap();
  check('D.2 apply(): a type, "mine", a start window and a sort', a2.tab === 'upcoming' && a2.specialView === null && same(a2.filters.types, ['ip']) && a2.mine === true && same(a2.sort, { field: 'registrations', dir: 'desc' }));
  check('D.2 …only the person\'s own upcoming IP events starting in the window (email compared without case)', same(shownIds(S), ['live-upcoming']), shownIds(S));
  var chips2 = S.$('chip-row').innerHTML;
  check('D.2 the starts and "mine" chips each have a ✕', /Starts 1 – 30 Nov 2099<button type="button" data-chip="\d" aria-label="Remove filter: Starts 1 – 30 Nov 2099">/.test(chips2) &&
    /Created by you<button type="button" data-chip="\d" aria-label="Remove filter: Created by you">/.test(chips2), chips2);
  check('D.2 the address holds it all', S.ctx.location.hash === '#tab=upcoming&type=ip&starts=2099-11-01..2099-11-30&mine=1', S.ctx.location.hash);
  S.$('chip-clear-all').fire('click');
  var cleared = S.snap();
  check('D.2 "Clear all" clears the date and "mine" filters too', cleared.created === null && cleared.starts === null && cleared.mine === false && cleared.filters.types.length === 0 && S.ctx.location.hash === '#tab=upcoming');
  L.apply({ view: 'upcoming', mine: false, starts: { from: '2026-01-01', to: '2026-01-02' } });
  check('D.2 nothing in the window: "No events match", and Clear filters clears the window', /No events match/.test(S.$('table-body').innerHTML) && (function () {
    /* B07: the button carries data-empty-clear (it is drawn in the table and in the phone cards alike) */
    S.$('table-body').querySelectorAll('[data-empty-clear]')[0].fire('click'); return S.snap().starts === null && same(shownIds(S), ['live-upcoming', 'month-only']);
  })(), shownIds(S));
  L.apply({ view: 'cancelled', search: 'x'.repeat(200), types: ['ip', 'bogus', 'ip'], created: { from: '2026-13-01', to: 'x' }, sort: { field: 'payment-ish', dir: 'up' } });
  var a3 = S.snap();
  check('D.2 apply() cuts the search to 80, drops unknown types and broken dates, keeps the sort it cannot use', a3.specialView === 'cancelled' && a3.search.length === 80 && same(a3.filters.types, ['ip']) && a3.created === null && same(a3.sort, { field: 'registrations', dir: 'desc' }));
  L.apply({ view: 'deleted' });
  check('D.2 apply() never opens the deleted view (the bot cannot)', S.snap().specialView === 'cancelled');
  L.restore({ tab: 'nope', specialView: 'evil', search: 5, filters: { types: ['ip', 7, 'ip'], portals: [1, 'cio', 'nowhere', '__proto__'], payment: ['paid', 'gratis'] }, created: 'x', starts: { from: '2026-11-01', to: '2026-10-01' }, mine: 'yes', sort: { field: 'drop table', dir: 'x' }, page: -4, view: 'cards' });
  var r3 = S.snap();
  /* (payment is always empty since B07 took the Paid / Free filter out, UX-025) */
  check('D.2 restore() takes only what makes sense', r3.tab === 'active' && r3.specialView === null && r3.search === '' && same(r3.filters, { types: ['ip'], portals: ['cio'], payment: [] }) &&
    r3.created === null && same(r3.starts, { from: '2026-10-01', to: '2026-11-01' }) && r3.mine === false && r3.page === 1 && r3.view === 'list', r3);
  check('D.2 restore(junk) refuses', L.restore(null) === false && L.restore('x') === false);
  L.restore(base);

  /* the address, typed or pasted over: hashchange */
  check('D.2 a hashchange listener is registered', (S.winLs.hashchange || []).length === 1);
  S.ctx.location.hash = '#tab=completed&q=Live&view=draft&type=awards,ip&mine=1';
  S.winLs.hashchange[0]();
  var hc = S.snap();
  check('D.2 hashchange: the list takes the new address', hc.tab === 'completed' && hc.search === 'Live' && hc.specialView === 'draft' && same(hc.filters.types, ['awards', 'ip']) && hc.mine === true && hc.page === 1);
  check('D.2 hashchange: the search box follows', S.$('search-input').value === 'Live' && S.$('btn-clear-search').hidden === false);
  S.ctx.location.hash = '#tab=upcoming';
  S.winLs.hashchange[0]();
  var hc2 = S.snap();
  check('D.2 hashchange: keys it leaves out go back to their defaults', hc2.tab === 'upcoming' && hc2.search === '' && hc2.specialView === null && hc2.filters.types.length === 0 && hc2.mine === false);

  /* the help window, opened from the panel, gives the focus back */
  var opener = S.doc.createElement('button');
  L.openHelp(opener);
  check('D.2 openHelp(): the page\'s own help window', /<h3>Need help\?<\/h3>/.test(S.$('sheet-root').innerHTML) && S.$('sheet-root').innerHTML.indexOf('customercare@economictimesb2b.com') !== -1);
  check('D.2 openHelp(): the focus moves into it', S.$('help-message').focused === 1);
  S.$('help-close').fire('click');
  check('D.2 closing it gives the focus back to what opened it', S.$('sheet-root').innerHTML === '' && opener.focused === 1);
  S.$('btn-help').fire('click');
  S.$('help-cancel').fire('click');
  check('D.2 "Need help?" works as before, and gets its focus back too', S.$('btn-help').focused === 1);

  /* reduced motion: no smooth scroll */
  var Srm = stand({ reducedMotion: true }); await flush();
  Srm.L.apply({ view: 'upcoming' });
  check('D.2 under reduced motion the jump is instant', Srm.scrolled[Srm.scrolled.length - 1].behavior === 'auto');

  /* a page opened with an address */
  var Sh = stand({ hash: '#tab=upcoming&q=x' }); await flush();
  var sh = Sh.snap();
  check('D.2 "#tab=upcoming&q=x" opens on Upcoming with the search x, as ever', sh.tab === 'upcoming' && sh.search === 'x' && sh.specialView === null && sh.created === null && Sh.$('search-input').value === 'x');
  var Sd = stand({ hash: '#tab=active&view=draft&created=2026-10-26..2026-11-01' }); await flush();
  check('D.2 an address with the new keys opens on that list', same(shownIds(Sd).sort(), ['draft-edge', 'draft-week']) && Sd.$('chip-row').innerHTML.indexOf('Created 26 Oct – 1 Nov 2026') !== -1);

  /* signed out or failing: ready() still settles, and "mine" matches nobody without a person */
  var Sf = stand({ fail: true }); await flush();
  var settled = false; await Sf.L.ready().then(function () { settled = true; });
  /* B07 (UX-027): the failure is one message where the list would be, worded by its cause, with Try again; no counts, no
     Insights, no Latest activity, and no "Create your first event" */
  check('D.2 ready() settles when the load fails too, and the list says so in its place', settled && /The server could not be reached/.test(Sf.$('table-body').innerHTML) &&
    /data-load-retry/.test(Sf.$('table-body').innerHTML) && Sf.$('error-slot').innerHTML === '', Sf.$('table-body').innerHTML.slice(0, 300));
  check('D.2 …with no counts (a dash on each tab), no Insights, no Latest activity, no "Create your first event"',
    /<span class="tc">–<\/span>/.test(Sf.$('status-tabs').innerHTML) && !/<span class="tc">0<\/span>/.test(Sf.$('status-tabs').innerHTML) && Sf.$('insights-section').hidden === true &&
    Sf.$('lower-panels').hidden === true && !/first event|Create Event/.test(Sf.$('table-body').innerHTML) && Sf.$('result-line').textContent === '');
  var Sn = stand({ user: null }); await flush();
  Sn.L.apply({ view: 'upcoming', mine: true });
  check('D.2 "mine" with nobody signed in shows nothing rather than everything', shownIds(Sn).length === 0 && same(JSON.parse(JSON.stringify(Sn.L.me())), { email: '', name: '' }));

  /* one search everywhere: what ETB2B AI's server picks for a search (functions/lib/dash-bot.js runList) is exactly
     what this page shows for it, through "Show these in the list" and typed into the box alike */
  var PARITY = [
    { id: 'infy-summit', name: 'Infosys Leaders Summit', category: 'client', client: 'Infosys', published: true, start: '2099-03-10T10:00', createdAt: '2026-10-01T00:00:00.000Z', createdBy: ME, counters: {} },
    { id: 'cx-forum', name: 'CX Forum', category: 'client', client: 'Infosys  Ltd', venue: 'Taj Lands End', city: 'Mumbai', published: true, start: '2099-04-10T10:00', createdAt: '2026-10-02T00:00:00.000Z', createdBy: 'bob@timesinternet.in', counters: {} },
    { id: 'campus-day', name: 'ET Times Campus Day', category: 'ip', venue: 'Infosys Campus', city: 'Bengaluru', published: true, start: '2099-05-10T10:00', createdAt: '2026-10-03T00:00:00.000Z', createdBy: ME, counters: {} },
    { id: 'cio-meet', name: 'CIO Meet', category: 'ip', city: 'Pune', published: true, start: '2099-06-10T10:00', createdAt: '2026-10-04T00:00:00.000Z', createdBy: 'ravi@infosys.com', counters: {} },
    { id: 'honours', name: 'Leadership Honours', category: 'awards', city: 'Delhi', published: true, start: '2099-07-10T10:00', createdAt: '2026-10-05T00:00:00.000Z', createdBy: ME, counters: {} },
    { id: 'roundtable', name: 'Roundtable', category: 'client', published: true, start: '2099-08-10T10:00', createdAt: '2026-10-06T00:00:00.000Z', createdBy: ME, counters: {} }
  ];
  var bot = require('./dash-bot')._test;
  var sctx = bot.contextFor({ decoded: { email: ME }, name: 'Asha Rao', message: 'Which upcoming events are for Infosys?', view: {}, docs: PARITY.map(function (d) { return { id: d.id, data: d }; }) });
  sctx.events.forEach(function (ev) { sctx.totals[ev.id] = null; });   // the list needs no totals here (no network)
  var Sp = stand({ items: PARITY }); await flush();
  var EXPECT = {
    'Infosys': ['campus-day', 'cx-forum', 'infy-summit'],      // client, client with two spaces, venue; not the creator's e-mail
    'infosys ltd': ['cx-forum'],
    'Times': ['campus-day'],                                     // a name, not every timesinternet.in creator
    'timesinternet': [], 'ETCIO': [], 'ravi': [], 'Awards': [], 'Custom': [],   // e-mail, type: searched by neither; no event here is on ETCIO
    'confirmed': [],                                             // "Venue to be confirmed" is the table's fill-in
    'Mumbai': ['cx-forum'], 'Mumbai Infosys': []                 // a field on its own, never across two
  };
  for (var q in EXPECT) {
    var rr = await bot.runList({ statuses: ['upcoming'], search: q, limit: 20 }, sctx);
    var serverIds = rr.list.items.map(function (it) { return it.id; }).sort();
    check('D.2 one search: the server picks ' + JSON.stringify(EXPECT[q]) + ' for "' + q + '"', same(serverIds, EXPECT[q]), serverIds);
    check('D.2 one search: "' + q + '" can be shown in the list', !!rr.list.view && rr.list.view.view === 'upcoming' && rr.list.view.search === q, rr.list.view);
    Sp.L.restore(base);
    Sp.L.apply(rr.list.view);
    check('D.2 one search: "Show these in the list" for "' + q + '" shows the server\'s events', same(shownIds(Sp).sort(), serverIds), [shownIds(Sp), serverIds]);
    Sp.L.restore(Object.assign({}, base, { tab: 'upcoming' }));
    Sp.$('search-input').value = q;
    Sp.$('search-input').fire('input');
    check('D.2 one search: "' + q + '" typed into the box shows the same events', Sp.snap().search === q.trim() && same(shownIds(Sp).sort(), serverIds), [shownIds(Sp), serverIds]);
  }
  Sp.L.restore(base);

  /* ======== D.2 the list works on one portal at a time (the portals change): ETB2B AI follows it, never moves it ======== */
  var PORTAL_ITEMS = [
    { id: 'cio-active', name: 'CIO Active Forum', category: 'ip', published: true, start: '2020-01-01T10:00', end: '2099-01-01T10:00', city: 'Pune', portal: 'cio', portalName: 'ETCIO', createdAt: '2026-10-20T00:00:00.000Z', createdBy: ME, counters: {} },
    { id: 'hr-active', name: 'HR Active Summit', category: 'ip', published: true, start: '2020-01-01T10:00', end: '2099-01-01T10:00', city: 'Mumbai', portal: 'hr', portalName: 'ETHRWorld', createdAt: '2026-10-21T00:00:00.000Z', createdBy: ME, counters: {} },
    { id: 'none-active', name: 'Unsorted Active Meet', category: 'ip', published: true, start: '2020-01-01T10:00', end: '2099-01-01T10:00', city: 'Delhi', portal: '', portalName: '', createdAt: '2026-10-22T00:00:00.000Z', createdBy: ME, counters: {} }
  ];
  var Sw = stand({ items: PORTAL_ITEMS, working: 'cio' }); await flush();
  var sw = Sw.snap();
  check('D.2 portals: snapshot() says the portal the list is on (ETCIO), and the list shows only its events', sw.portal === 'cio' && same(shownIds(Sw), ['cio-active']), [sw.portal, shownIds(Sw)]);
  Sw.L.apply({ view: 'active', search: 'forum', types: [], mine: false, created: null, starts: null, sort: null });
  check('D.2 portals: apply() keeps the portal (ETB2B AI never switches it)', Sw.snap().portal === 'cio' && same(shownIds(Sw), ['cio-active']), [Sw.snap().portal, shownIds(Sw)]);
  Sw.L.restore(Object.assign(Sw.snap(), { portal: 'hr', search: '', filters: { types: [], portals: ['none', 'hr', 'nowhere', '__proto__', 'none', 7], payment: [] } }));
  var sr = Sw.snap();
  check('D.2 portals: restore() never moves the portal (Undo cannot reach the saved choice)', sr.portal === 'cio' && same(shownIds(Sw), ['cio-active']), [sr.portal, shownIds(Sw)]);
  check('D.2 portals: restore() keeps "none" and ET\'s portals in the Portal filter, once each, and drops the rest', same(sr.filters.portals, ['none', 'hr']), sr.filters.portals);
  var Sall = stand({ items: PORTAL_ITEMS, working: 'all' }); await flush();
  check('D.2 portals: All portals is "" in the snapshot (the bot\'s "every portal")', Sall.snap().portal === '' && same(shownIds(Sall).sort(), ['cio-active', 'hr-active', 'none-active']), [Sall.snap().portal, shownIds(Sall)]);
  /* one search, with portals: the server and the list agree on the portal's name too */
  var pctx = bot.contextFor({ decoded: { email: ME }, name: 'Asha Rao', message: 'Which events are running?', view: {}, docs: PORTAL_ITEMS.map(function (d) { return { id: d.id, data: d }; }) });
  pctx.events.forEach(function (ev) { pctx.totals[ev.id] = null; });
  var PEXPECT = { 'ETHRWorld': ['hr-active'], 'hrworld': ['hr-active'], 'ETCIO': ['cio-active'], 'No portal yet': ['none-active'], 'Mumbai': ['hr-active'], 'Active': ['cio-active', 'hr-active', 'none-active'] };
  for (var pq in PEXPECT) {
    var pr = await bot.runList({ statuses: ['active'], search: pq, limit: 20 }, pctx);
    var pIds = pr.list.items.map(function (it) { return it.id; }).sort();
    check('D.2 portals, one search: the server picks ' + JSON.stringify(PEXPECT[pq]) + ' for "' + pq + '" in all portals', same(pIds, PEXPECT[pq]), pIds);
    Sall.L.restore(Object.assign(Sall.snap(), { search: '', tab: 'active', specialView: null }));
    Sall.L.apply(pr.list.view);
    check('D.2 portals, one search: "Show these in the list" for "' + pq + '" shows the server\'s events', !!pr.list.view && same(shownIds(Sall).sort(), pIds), [shownIds(Sall), pIds]);
    Sall.L.restore(Object.assign(Sall.snap(), { search: '' }));
    Sall.$('search-input').value = pq;
    Sall.$('search-input').fire('input');
    check('D.2 portals, one search: "' + pq + '" typed into the box shows the same events', same(shownIds(Sall).sort(), pIds), [shownIds(Sall), pIds]);
  }
  var cctx = bot.contextFor({ decoded: { email: ME }, name: 'Asha Rao', message: 'Which events are running?', view: { portal: 'cio' }, docs: PORTAL_ITEMS.map(function (d) { return { id: d.id, data: d }; }) });
  cctx.events.forEach(function (ev) { cctx.totals[ev.id] = null; });
  var cr = await bot.runList({ statuses: ['active'], search: 'Active', limit: 20 }, cctx);
  Sw.L.restore(Object.assign(Sw.snap(), { search: '', filters: { types: [], portals: [], payment: [] } }));
  Sw.L.apply(cr.list.view);
  check('D.2 portals: on ETCIO the server lists ETCIO\'s events only, and "Show these in the list" there shows the same', same(cr.list.items.map(function (it) { return it.id; }), ['cio-active']) &&
    !!cr.list.view && same(shownIds(Sw), ['cio-active']), [cr.list.items.map(function (it) { return it.id; }), shownIds(Sw)]);

  var octx = bot.contextFor({ decoded: { email: ME }, name: 'Asha Rao', message: 'Find No portal yet', view: {}, docs: [{ id: 'odd', data: { name: 'Odd Portal Meet', portal: 'nowhere', published: true } }] });
  octx.events.forEach(function (ev) { octx.totals[ev.id] = null; });
  var orr = await bot.runList({ statuses: [], search: 'No portal yet', limit: 20 }, octx);
  check('D.2 portals: a stored portal off ET\'s roster is "No portal yet" to the bot, as the events list says (api.js eventListItem)',
    octx.events[0].portal === '' && same(orr.list.items.map(function (it) { return it.id; }), ['odd']), [octx.events[0].portal, orr.list.items.map(function (it) { return it.id; })]);

  /* ======== D.2p ETB2B AI and portals (plan §17): another portal looked at for now, the switch, and their Undo ======== */
  var Sp2 = stand({ items: PORTAL_ITEMS, working: 'cio' }); await flush();
  var portalSaves = [];
  Sp2.ctx.RevampPortals.setWorking = function (v) { portalSaves.push(v); return Promise.resolve(v); };
  var p2before = Sp2.snap();
  check('D.2p snapshot: the scope on screen, the portal worked in, and the list\'s own portal state', p2before.portal === 'cio' && p2before.working === 'cio' && p2before.listPortal === 'cio' && p2before.portalReturn === '', p2before);
  /* the server's own patch for "Show ETHRWorld's active events", run through the page */
  var hctx = bot.contextFor({ decoded: { email: ME }, name: 'Asha Rao', message: 'Show ETHRWorld\'s active events', view: { portal: 'cio', working: 'cio' }, docs: PORTAL_ITEMS.map(function (d) { return { id: d.id, data: d }; }) });
  var hAns = await bot.cleanAnswer({ kind: 'filter', filter: { view: 'active', portal: 'hr' }, text: 'Here they are.' }, hctx);
  check('D.2p the server\'s patch names ETHRWorld, and its card says so', !!hAns.action && hAns.action.patch.portal === 'hr' && /in ETHRWorld$/.test(hAns.action.label), hAns.action);
  var undoSnap = Sp2.L.apply(hAns.action.patch);
  var p2look = Sp2.snap();
  check('D.2p apply(portal: another one): the list shows exactly that portal\'s events', same(shownIds(Sp2), ['hr-active']), shownIds(Sp2));
  check('D.2p …looked at for now: the portal worked in is not moved, and nothing is saved', p2look.working === 'cio' && p2look.listPortal === 'all' && p2look.portalReturn === 'cio' && p2look.portal === 'hr' && portalSaves.length === 0, [p2look, portalSaves]);
  var notice = Sp2.$('portal-notice').innerHTML;
  check('D.2p …the notice names the portal looked at, with the way back', notice.indexOf('Showing ETHRWorld for now.') !== -1 && notice.indexOf('Back to ETCIO') !== -1, notice);
  Sp2.L.restore(undoSnap);
  var p2back = Sp2.snap();
  check('D.2p Undo (restore): back on ETCIO exactly, nothing saved', p2back.portal === 'cio' && p2back.listPortal === 'cio' && p2back.portalReturn === '' && same(shownIds(Sp2), ['cio-active']) && portalSaves.length === 0, [p2back, shownIds(Sp2)]);
  Sp2.L.apply({ view: 'active', search: '', types: [], mine: false, created: null, starts: null, sort: null, portal: 'none' });
  check('D.2p apply(portal: none): the events with no portal yet, and the notice says so', same(shownIds(Sp2), ['none-active']) && Sp2.$('portal-notice').innerHTML.indexOf('Showing the events with no portal yet.') !== -1, shownIds(Sp2));
  Sp2.L.apply({ view: 'active', search: '', types: [], mine: false, created: null, starts: null, sort: null, portal: 'all' });
  check('D.2p apply(portal: all): every portal, for now', same(shownIds(Sp2).sort(), ['cio-active', 'hr-active', 'none-active']) && Sp2.snap().working === 'cio' && Sp2.snap().portal === '', [shownIds(Sp2), Sp2.snap()]);
  Sp2.L.apply({ view: 'active', search: '', types: [], mine: false, created: null, starts: null, sort: null, portal: 'cio' });
  check('D.2p apply(portal: the one worked in): back on it', same(shownIds(Sp2), ['cio-active']) && Sp2.snap().portalReturn === '' && Sp2.snap().listPortal === 'cio');
  Sp2.L.apply({ view: 'active', search: '', types: [], mine: false, created: null, starts: null, sort: null, portal: '<b>' });
  check('D.2p apply(portal: anything else) is ignored', same(shownIds(Sp2), ['cio-active']) && Sp2.snap().listPortal === 'cio');
  /* "Show these in the list" for a list on another portal (the server's view carries the portal) */
  var nctx = bot.contextFor({ decoded: { email: ME }, name: 'Asha Rao', message: 'Which active events have no portal?', view: { portal: 'cio', working: 'cio' }, docs: PORTAL_ITEMS.map(function (d) { return { id: d.id, data: d }; }) });
  nctx.events.forEach(function (ev) { nctx.totals[ev.id] = null; });
  var nr = await bot.runList({ statuses: ['active'], portal: 'none', limit: 20 }, nctx);
  var nUndo = Sp2.L.apply(nr.list.view);
  check('D.2p "Show these in the list" for the events with no portal: the server\'s events, on the list', !!nr.list.view && nr.list.view.portal === 'none' &&
    same(nr.list.items.map(function (it) { return it.id; }), ['none-active']) && same(shownIds(Sp2), ['none-active']), [nr.list.view, shownIds(Sp2)]);
  Sp2.L.restore(nUndo);
  /* the switch: saved for the person, as the switcher saves it; its Undo switches back */
  var swUndo = Sp2.L.setPortal('hr');
  check('D.2p setPortal(): the switcher moves, the list shows that portal, and it is saved', !!swUndo && swUndo.working === 'cio' && Sp2.snap().working === 'hr' &&
    same(shownIds(Sp2), ['hr-active']) && same(portalSaves, ['hr']), [swUndo && swUndo.working, Sp2.snap().working, portalSaves]);
  Sp2.L.restore(swUndo);
  check('D.2p a plain restore() of that snapshot never moves the portal worked in', Sp2.snap().working === 'hr' && same(portalSaves, ['hr']), [Sp2.snap().working, portalSaves]);
  Sp2.L.restore(swUndo, { portal: true });
  check('D.2p restore(…, {portal: true}): switched back to ETCIO, and saved', Sp2.snap().working === 'cio' && same(shownIds(Sp2), ['cio-active']) && same(portalSaves, ['hr', 'cio']), [Sp2.snap().working, portalSaves]);
  check('D.2p setPortal(): a portal off ET\'s roster, or an odd value, is refused (null), nothing saved',
    Sp2.L.setPortal('nowhere') === null && Sp2.L.setPortal('<x>') === null && Sp2.snap().working === 'cio' && same(portalSaves, ['hr', 'cio']), portalSaves);
  var allUndo = Sp2.L.setPortal('all');
  check('D.2p setPortal("all"): All portals', !!allUndo && Sp2.snap().working === 'all' && same(shownIds(Sp2).sort(), ['cio-active', 'hr-active', 'none-active']));
  Sp2.L.restore(allUndo, { portal: true });
  check('D.2p …and back', Sp2.snap().working === 'cio' && same(portalSaves, ['hr', 'cio', 'all', 'cio']), portalSaves);

  /* ======== D.3 "Latest activity": real figures for the period picked, or a dash and the reason (QA F4, UX-017) ======== */
  var ACT = INLINE.slice(INLINE.indexOf('     LATEST ACTIVITY —'), INLINE.indexOf('     APP RENDER'));
  check('D.3 the activity code is found', ACT.length > 3000);
  ['PORTAL_ACTIVITY_BASE', 'renderNewsletterPanel', 'renderSubscriberPanel', 'RANGE_FACTOR', 'computeRangeFactor', 'IP_ACTIVITY'].forEach(function (w) {
    check('D.3 the invented figures are gone: no ' + w, INLINE.indexOf(w) === -1);
  });
  check('D.3 no figure is generated (no Math.sin / Math.random, no fixed totals)', !/Math\.(sin|random)/.test(ACT) && !/5240|21860|312400|58200|2140/.test(ACT));
  check('D.3 the card is "Latest activity", not "on this Portal"', PAGE.indexOf('Latest Activity on this Portal') === -1 && PAGE.indexOf('<h3>Latest activity</h3>') !== -1);
  check('D.3 its total is the page\'s text colour (it was the button\'s black, unreadable in dark mode)', /\.activity-row-total\{[^}]*color:var\(--text\);/.test(PAGE));

  function istToday() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
  function plusDays(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  var TODAY = istToday(), FROM30 = plusDays(TODAY, -29);
  /* 40 days of real-looking day totals: the 10 before the window carry big numbers, which must never be counted */
  var BYDAY = [];
  for (var di = -39; di <= 0; di++) BYDAY.push({ date: plusDays(TODAY, di), views: di < -29 ? 100000 : 10 + (di + 29), uniques: 1, registrations: di < -29 ? 50000 : (di === 0 ? 4 : 1) });
  function windowOf(field, from, to) { return BYDAY.filter(function (d) { return d.date >= from && d.date <= to; }).reduce(function (n, d) { return n + d[field]; }, 0); }
  var REG30 = windowOf('registrations', FROM30, TODAY), VIEWS30 = windowOf('views', FROM30, TODAY);
  var INS_EVENTS = [
    { eventId: 'live-active', name: 'Live Active', window: { registrations: 20, views: 400, uniques: 1, lastRegistration: TODAY, lastView: TODAY } },
    { eventId: 'live-upcoming', name: 'Live <Upcoming>', window: { registrations: 13, views: 34, uniques: 1, lastRegistration: plusDays(TODAY, -2), lastView: plusDays(TODAY, -1) } },
    { eventId: 'month-only', name: 'Month Only', window: { registrations: 0, views: 0, uniques: 0, lastRegistration: null, lastView: null } }
  ];
  var CHANGES = [
    { id: 'c1', eventId: 'live-active', eventName: 'Live Active', at: new Date().toISOString(), by: ME, byLabel: ME, action: 'site-published', detail: 'Published the site' },
    { id: 'c2', eventId: 'live-upcoming', eventName: 'Live Upcoming', at: new Date(Date.now() - 3600000).toISOString(), by: 'platform', byLabel: 'Platform (automated)', action: 'content-updated', detail: 'Changed <speakers>' },
    { id: 'c3', eventId: 'draft-week', eventName: 'Draft Week', at: new Date(Date.now() - 7200000).toISOString(), by: ME, byLabel: ME, action: 'event-created', detail: '' }
  ];
  var actCalls = [];
  function actApi(over) {
    over = over || {};
    return function (url) {
      actCalls.push(url);
      var u = new URL(url, 'http://localhost');
      if (u.pathname === '/api/insights') {
        if (over.insights) return over.insights(u);
        var from = u.searchParams.get('from'), to = u.searchParams.get('to');
        return { body: { days: 0, from: from, to: to, byDay: BYDAY.filter(function (d) { return d.date >= from && d.date <= to; }), events: INS_EVENTS } };
      }
      if (u.pathname === '/api/promo/analytics/all') return over.mailers ? over.mailers(u) : { body: { available: false, backend: 'none', series: [], totals: { sends: 0, opens: 0, clicks: 0 } } };
      if (u.pathname === '/api/activity/all') return over.changes ? over.changes(u) : { body: { items: CHANGES, next: null, scanned: 3 } };
      return null;
    };
  }
  function rowsOf(S) {
    var html = S.$('activity-body').innerHTML, out = {};
    html.split('<div class="activity-item ').slice(1).forEach(function (chunk) {
      var key = (/data-act-key="([a-z]+)"/.exec(chunk) || [])[1] || (/Newsletters and subscribers/.test(chunk) ? 'newsletters' : '?');
      var total = (/<span class="activity-row-total mono">([\s\S]*?)<\/span><span class="activity-row-chevron/.exec(chunk) || [])[1] || '';
      var desc = (/<span class="activity-row-desc">([\s\S]*?)<\/span>/.exec(chunk) || [])[1] || '';
      out[key] = { total: total.replace(/<[^>]+>/g, ''), desc: desc, html: chunk };
    });
    return out;
  }
  function clickRow(S, key) {
    var b = S.$('activity-body').querySelectorAll('[data-act-key]').filter(function (x) { return x.getAttribute('data-act-key') === key; })[0];
    if (b) b.fire('click');
    return !!b;
  }
  async function settle() { for (var i = 0; i < 6; i++) await flush(); }

  actCalls = [];
  var Sa = stand({ api: actApi() });
  await settle();
  /* B07: then the deleted events and who the approvers are, before the panel's three */
  check('D.3 the events are read first; the panel reads only after they have loaded', Sa.fetched[0] === '/api/events' && Sa.fetched[1] === '/api/events?deleted=1' &&
    Sa.fetched[2] === '/api/settings/approvals' && Sa.fetched.length === 6, Sa.fetched);
  check('D.3 the last 30 days are asked for as India days, from and to', actCalls.indexOf('/api/insights?from=' + FROM30 + '&to=' + TODAY) !== -1, actCalls);
  var expFrom = new Date(Date.parse(FROM30 + 'T00:00:00+05:30')).toISOString(), expTo = new Date(Date.parse(TODAY + 'T00:00:00+05:30') + 86400000).toISOString();
  check('D.3 the Activity log is asked for the same whole India days', actCalls.indexOf('/api/activity/all?limit=100&from=' + encodeURIComponent(expFrom) + '&to=' + encodeURIComponent(expTo)) !== -1, actCalls);
  check('D.3 Mailer performance is asked once', actCalls.filter(function (u) { return u === '/api/promo/analytics/all'; }).length === 1);
  var R = rowsOf(Sa);
  check('D.3 five rows, in order', same(Object.keys(R), ['registrations', 'visitors', 'mailers', 'changes', 'newsletters']), Object.keys(R));
  check('D.3 New registrations: the sum of the window\'s days only (' + REG30 + ')', R.registrations.total === String(REG30), R.registrations);
  check('D.3 Visitors: the window\'s page views (' + VIEWS30 + ')', R.visitors.total === String(VIEWS30), R.visitors);
  check('D.3 Mailer opens with tracking off: a dash and why, never a number', R.mailers.total === '—' && R.mailers.desc === 'Mailer tracking is not switched on yet, so no opens are counted', R.mailers);
  check('D.3 Changes to events: how many the Activity log has in the period', R.changes.total === '3', R.changes);
  check('D.3 Newsletters and subscribers: a dash and "not part of Oneworld 2.0 yet", and it opens nothing', R.newsletters.total === '—' &&
    /Not part of Oneworld 2\.0 yet/.test(R.newsletters.desc) && R.newsletters.html.indexOf('data-act-key') === -1, R.newsletters);
  check('D.3 none of the old invented totals', !/5\.24K|21\.86K|3\.12L|58\.20K|2\.14K/.test(Sa.$('activity-body').innerHTML));
  check('D.3 the exact figure is in the title of the short one', R.visitors.html.indexOf('title="' + VIEWS30.toLocaleString('en-IN') + '"') !== -1);

  clickRow(Sa, 'registrations');
  var reg = Sa.$('activity-body').innerHTML;
  check('D.3 opened: the events with registrations in the period, most first, each linked to its Dashboard', reg.indexOf('Live Active') < reg.indexOf('Live &lt;Upcoming&gt;') &&
    reg.indexOf('Month Only') === -1 && reg.indexOf('href="edit-event.html?event=live-active#dashboard"') !== -1 && />20<\/td>/.test(reg) && />13<\/td>/.test(reg), reg.slice(reg.indexOf('act-table'), reg.indexOf('act-table') + 900));
  check('D.3 …with the day of the last one, and names escaped', reg.indexOf('<td>Today</td>') !== -1 && reg.indexOf('<td>2 days ago</td>') !== -1 && reg.indexOf('Live <Upcoming>') === -1);
  clickRow(Sa, 'changes');
  var chg = Sa.$('activity-body').innerHTML;
  check('D.3 opened: the latest changes, who, which event, when, escaped', chg.indexOf('Published the site') !== -1 && chg.indexOf('Changed &lt;speakers&gt;') !== -1 && chg.indexOf('Platform (automated) · Live Upcoming · ') !== -1 &&
    chg.indexOf('event-created') !== -1, chg.slice(chg.indexOf('act-changes'), chg.indexOf('act-changes') + 700));
  clickRow(Sa, 'mailers');
  var ml = Sa.$('activity-body').innerHTML;
  check('D.3 opened with tracking off: the reason and a way to Mailer performance, no tiles', ml.indexOf('Mailer tracking is not switched on yet, so no opens are counted.') !== -1 && ml.indexOf('href="mailer-performance.html"') !== -1 && ml.indexOf('act-kpi-tile') === -1);

  /* the period changes: Today */
  Sa.$('btn-activity-range').fire('click', { stopPropagation: function () {} });
  var todayBtn = Sa.$('activity-range-popover').querySelectorAll('[data-arange]').filter(function (b) { return b.getAttribute('data-arange') === 'today'; })[0];
  todayBtn.fire('click');
  await settle();
  R = rowsOf(Sa);
  check('D.3 Today: asked for today alone', actCalls.indexOf('/api/insights?from=' + TODAY + '&to=' + TODAY) !== -1 && Sa.$('activity-range-label').textContent === 'Today', actCalls);
  check('D.3 Today: today\'s figures (4 registrations, ' + windowOf('views', TODAY, TODAY) + ' visitors)', R.registrations.total === '4' && R.visitors.total === String(windowOf('views', TODAY, TODAY)), [R.registrations.total, R.visitors.total]);
  check('D.3 Mailer performance is not read again for a new period', actCalls.filter(function (u) { return u === '/api/promo/analytics/all'; }).length === 1);

  /* mailers tracked: the series' opens in the period; a period older than its 30 days says so */
  var SERIES = [];
  for (var si = -29; si <= 0; si++) SERIES.push({ date: plusDays(TODAY, si), opens: si === 0 ? 7 : 2, clicks: si === 0 ? 3 : 0 });
  actCalls = [];
  var Sm = stand({ api: actApi({ mailers: function () { return { body: { available: true, backend: 'firestore', series: SERIES, totals: { sends: 4, opens: 65, clicks: 3 } } }; } }) });
  await settle();
  R = rowsOf(Sm);
  check('D.3 Mailer opens with tracking on: the opens of the period (65)', R.mailers.total === '65' && R.mailers.desc === 'Opens of the mailers made in Promotions', R.mailers);
  clickRow(Sm, 'mailers');
  check('D.3 …opened: opens and clicks, and Mailer performance', /Opens<\/div><div class="act-kpi-value mono">65</.test(Sm.$('activity-body').innerHTML) && /Clicks<\/div><div class="act-kpi-value mono">3</.test(Sm.$('activity-body').innerHTML));
  Sm.$('btn-activity-range').fire('click', { stopPropagation: function () {} });
  Sm.$('activity-range-popover').querySelectorAll('[data-arange]').filter(function (b) { return b.getAttribute('data-arange') === 'custom'; })[0].fire('click');
  Sm.$('arange-start').value = plusDays(TODAY, -60);
  Sm.$('arange-end').value = plusDays(TODAY, -45);
  Sm.$('arange-apply').fire('click');
  await settle();
  R = rowsOf(Sm);
  check('D.3 a custom period: asked for its own days, not the days since', actCalls.indexOf('/api/insights?from=' + plusDays(TODAY, -60) + '&to=' + plusDays(TODAY, -45)) !== -1, actCalls);
  check('D.3 …its figures are its own days\' (the big ones before the window)', R.registrations.total === String(windowOf('registrations', plusDays(TODAY, -60), plusDays(TODAY, -45))), R.registrations);
  check('D.3 …and mailer opens older than 30 days are a dash and why', R.mailers.total === '—' && /kept for the last 30 days/.test(R.mailers.desc), R.mailers);

  /* an empty period reads in words; a period longer than a year is its newest 365 days, and says so */
  var Sz = stand({ api: actApi({ insights: function (u) { return { body: { byDay: [], events: [] } }; }, changes: function () { return { body: { items: [], next: null } }; } }) });
  await settle();
  clickRow(Sz, 'registrations');
  check('D.3 no registrations in the period: said in words', Sz.$('activity-body').innerHTML.indexOf('No registrations on your events in ') !== -1 && rowsOf(Sz).registrations.total === '0');
  Sz.$('btn-activity-range').fire('click', { stopPropagation: function () {} });
  Sz.$('activity-range-popover').querySelectorAll('[data-arange]').filter(function (b) { return b.getAttribute('data-arange') === 'today'; })[0].fire('click');
  await settle();
  check('D.3 …"today" for Today', Sz.$('activity-body').innerHTML.indexOf('No registrations on your events today.') !== -1);
  actCalls = [];
  Sz.$('btn-activity-range').fire('click', { stopPropagation: function () {} });
  Sz.$('activity-range-popover').querySelectorAll('[data-arange]').filter(function (b) { return b.getAttribute('data-arange') === 'custom'; })[0].fire('click');
  Sz.$('arange-start').value = plusDays(TODAY, -800);
  Sz.$('arange-end').value = TODAY;
  Sz.$('arange-apply').fire('click');
  await settle();
  check('D.3 a period longer than a year: its newest 365 days are asked for, and the card says so', actCalls.indexOf('/api/insights?from=' + plusDays(TODAY, -364) + '&to=' + TODAY) !== -1 &&
    Sz.$('activity-body').innerHTML.indexOf('These figures cover the last 365 days of that period') !== -1, actCalls);

  /* nothing of the card's own is read until it comes near the screen; the Insights cards at the top read the period's
     day figures at once (D.4), and the card then uses that same read */
  actCalls = [];
  var Sl = stand({ api: actApi(), io: true });
  await settle();
  var INS30 = '/api/insights?from=' + FROM30 + '&to=' + TODAY;
  check('D.3 with the card off screen, only the Insights cards\' read is made, and every row of the card waits', same(actCalls, [INS30]) && Sl.observers.length === 1 && Sl.observers[0].watched[0] === Sl.$('activity-card') &&
    /300px/.test(Sl.observers[0].o.rootMargin) && rowsOf(Sl).registrations.html.indexOf('act-total-skel') !== -1, [actCalls, Sl.observers.length]);
  Sl.observers[0].cb([{ isIntersecting: false }]);
  await settle();
  check('D.3 …still nothing more while it is not near', same(actCalls, [INS30]));
  Sl.observers[0].cb([{ isIntersecting: true }]);
  await settle();
  check('D.3 …and once it is, its own two are read (the day figures are not read twice), and the watch stops', actCalls.length === 3 && actCalls.filter(function (u) { return u === INS30; }).length === 1 &&
    Sl.observers[0].gone === true && rowsOf(Sl).registrations.total === String(REG30), actCalls);

  /* failures: a dash and a way to try again, never a zero */
  actCalls = [];
  var insightsTries = 0;
  var Sf = stand({ api: actApi({
    insights: function () { insightsTries++; return insightsTries === 1 ? { status: 500, body: { error: 'We could not load these numbers just now.' } } : { body: { byDay: BYDAY.slice(-30), events: INS_EVENTS } }; },
    changes: function () { return { body: { items: [{ id: 'x' }] } }; },
    mailers: function () { return { body: { items: [] } }; }
  }) });
  await settle();
  R = rowsOf(Sf);
  check('D.3 a failed read: a dash, "Could not be loaded", never 0', R.registrations.total === '—' && R.visitors.total === '—' && /Could not be loaded/.test(R.registrations.desc), R.registrations);
  check('D.3 an answer of the wrong shape is a failure too (not 0)', R.mailers.total === '—' && /Could not be loaded/.test(R.mailers.desc), R.mailers);
  clickRow(Sf, 'registrations');
  var retry = Sf.$('activity-body').querySelectorAll('[data-act-retry]');
  check('D.3 opened, a failed row offers Try again', retry.length === 1 && Sf.$('activity-body').innerHTML.indexOf('These figures could not be loaded.') !== -1);
  retry[0].fire('click');
  await settle();
  R = rowsOf(Sf);
  check('D.3 Try again reads it again, and the figures come', insightsTries === 2 && R.registrations.total === String(REG30), [insightsTries, R.registrations]);
  var Sx = stand({ api: actApi({ changes: function () { var many = []; for (var k = 0; k < 100; k++) many.push(CHANGES[0]); return { body: { items: many, next: 'events/x/activity/y' } }; } }) });
  await settle();
  check('D.3 more changes than one page: "100+", never a guess', rowsOf(Sx).changes.total === '100+', rowsOf(Sx).changes);
  var Sn = stand({ api: actApi(), fail: false, items: [] });
  await settle();
  check('D.3 an account with no events still gets only real figures', rowsOf(Sn).registrations.total === String(REG30));
  var Se = stand({ fail: true });
  await settle();
  /* B07 (UX-027): the panel is not shown at all then, so no figure stands beside a list that failed */
  check('D.3 when the events cannot be loaded, the panel shows no figure at all (it is not shown)', Se.$('activity-body').innerHTML.indexOf('5.24K') === -1 && Se.$('lower-panels').hidden === true, Se.$('activity-body').innerHTML.slice(0, 300));

  /* ======== D.4 the Insights cards: the tab's events in the period picked beside them (QA follow-up, UX-022) ======== */
  function kpisOf(S) {
    var out = {};
    S.$('kpi-grid').innerHTML.split('<div class="kpi-card').slice(1).forEach(function (chunk) {
      var label = (/<span class="kpi-label">([^<]*)<\/span>/.exec(chunk) || [])[1] || '?';
      var num = (/<span class="kpi-num[^"]*"[^>]*>([^<]*)<\/span>/.exec(chunk) || [])[1];
      var sub = (/<span class="kpi-sub">([^<]*)<\/span>/.exec(chunk) || [])[1] || '';
      out[label] = { num: num === undefined ? null : num, sub: sub, html: chunk };
    });
    return out;
  }
  function pickRange(S, mode) {
    S.$('btn-range').fire('click', { stopPropagation: function () {} });
    var b = S.$('range-popover').querySelectorAll('[data-range]').filter(function (x) { return x.getAttribute('data-range') === mode; })[0];
    b.fire('click');
    return b;
  }
  actCalls = [];
  var Sk = stand({ api: actApi() });
  await settle();
  var K = kpisOf(Sk);
  check('D.4 three cards: Visitors, New registrations, Revenue', same(Object.keys(K), ['Visitors', 'New registrations', 'Revenue']), Object.keys(K));
  check('D.4 Active tab, last 30 days: only the active event\'s own window (400 views, 20 registrations), not every event\'s', K.Visitors.num === '400' && K['New registrations'].num === '20', K);
  check('D.4 …read from the same day figures as Latest activity, once', actCalls.filter(function (u) { return u === '/api/insights?from=' + FROM30 + '&to=' + TODAY; }).length === 1, actCalls);
  check('D.4 the label is the period read', Sk.$('range-label').textContent === 'Last 30 days');
  check('D.4 Revenue: a dash and "Payments: not available yet" (the console\'s words, UX-025), never a sum of ticket prices', K.Revenue.num === '—' && K.Revenue.sub === 'Payments: not available yet' && Sk.$('kpi-grid').innerHTML.indexOf('₹') === -1, K.Revenue);
  check('D.4 no "Total …" all-time cards are left', !/Total (Visitors|Registrations|Revenue)/.test(INLINE.slice(INLINE.indexOf('function renderKPIs('), INLINE.indexOf('function renderRangePopover('))));
  Sk.L.restore(Object.assign(Sk.snap(), { tab: 'upcoming' }));
  K = kpisOf(Sk);
  check('D.4 Upcoming tab: the upcoming events\' window (34 views, 13 registrations)', K.Visitors.num === '34' && K['New registrations'].num === '13' && Sk.$('insights-title').textContent === 'Upcoming Event Insights', [K.Visitors, K['New registrations']]);
  actCalls = [];
  pickRange(Sk, '7');
  await settle();
  check('D.4 Last 7 days: that period is read and named', actCalls.indexOf('/api/insights?from=' + plusDays(TODAY, -6) + '&to=' + TODAY) !== -1 && Sk.$('range-label').textContent === 'Last 7 days', [actCalls, Sk.$('range-label').textContent]);
  actCalls = [];
  pickRange(Sk, 'custom');
  check('D.4 Custom range opens its date fields (the picker is drawn again with them)', !!Sk.$('range-popover').innerHTML.match(/id="range-start"/) && actCalls.length === 0);
  Sk.$('range-start').value = plusDays(TODAY, -20);
  Sk.$('range-end').value = plusDays(TODAY, -10);
  Sk.$('range-apply').fire('click');
  await settle();
  check('D.4 a custom period: its own days are read', actCalls.indexOf('/api/insights?from=' + plusDays(TODAY, -20) + '&to=' + plusDays(TODAY, -10)) !== -1, actCalls);
  var Skl = stand({ api: actApi({ insights: function () { return { status: 500, body: { error: 'We could not load these numbers just now.' } }; } }) });
  await settle();
  K = kpisOf(Skl);
  check('D.4 a failed read: dashes and "Could not be loaded", never 0', K.Visitors.num === '—' && K['New registrations'].num === '—' && K.Visitors.sub === 'Could not be loaded' &&
    Skl.$('kpi-grid').innerHTML.indexOf('id="kpi-retry"') !== -1, K);
  var Skw = stand({ api: actApi({ insights: function () { return { pending: true }; } }) });
  await settle();
  check('D.4 while loading: a placeholder, not a number', kpisOf(Skw).Visitors.num === null && Skw.$('kpi-grid').innerHTML.indexOf('kpi-skel') !== -1, kpisOf(Skw).Visitors);

  /* "Custom range" redraws its own popover: the click that does it must not close the popover (QA follow-up) */
  var Sc = stand({ api: actApi() });
  await settle();
  var docClick = function (S, ev) { (S.docLs.click || []).forEach(function (fn) { fn(ev); }); };
  function wrapNode(inside) { return { nodeType: 1, matches: function (sel) { return inside && sel.indexOf('.popover-wrap') !== -1; } }; }
  [['range-popover', 'btn-range', 'data-range'], ['activity-range-popover', 'btn-activity-range', 'data-arange']].forEach(function (c) {
    Sc.$(c[1]).fire('click', { stopPropagation: function () {} });
    check('D.4 ' + c[0] + ' is open', Sc.$(c[0]).hidden === false);
    var custom = Sc.$(c[0]).querySelectorAll('[' + c[2] + ']').filter(function (x) { return x.getAttribute(c[2]) === 'custom'; })[0];
    custom.fire('click');
    /* the button that was clicked is gone (its popover was drawn again): closest() finds nothing, the click's path does */
    docClick(Sc, { target: custom, composedPath: function () { return [custom, Sc.$(c[0]), wrapNode(true)]; } });
    check('D.4 ' + c[0] + ': Custom range keeps it open, with its date fields', Sc.$(c[0]).hidden === false && /type="date"/.test(Sc.$(c[0]).innerHTML));
    docClick(Sc, { target: Sc.$('page-title'), composedPath: function () { return [Sc.$('page-title'), wrapNode(false)]; } });
    check('D.4 ' + c[0] + ': a click outside still closes it', Sc.$(c[0]).hidden === true);
  });
  check('D.4 the page asks the click\'s own path (composedPath), and closest() only as the fallback', /function clickWasIn\(e, sel\)\{[\s\S]{0,200}composedPath\(\)/.test(INLINE));
  check('D.4 the empty state\'s icon is a block (no descender gap under it in standards mode)', /\.empty-state > svg\{ display:block; margin:0 auto; \}/.test(PAGE));

  /* the server's side: GET /api/insights?from=&to= (functions/lib/api-audience.js) */
  var AUD = require('./api-audience');
  var NOWMS = Date.UTC(2026, 10, 3, 6, 35);
  function win(q) { return AUD.insightsWindow(new URLSearchParams(q), NOWMS); }
  check('D.3 insights window: from..to, both included', same(win('from=2026-10-30&to=2026-11-02').days, ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']));
  check('D.3 insights window: cut at today (India)', same(win('from=2026-11-02&to=2026-11-30').days, ['2026-11-02', '2026-11-03']));
  check('D.3 insights window: one that has not started is refused', !!win('from=2026-11-04&to=2026-11-05').error);
  check('D.3 insights window: not a day, or reversed, is refused', !!win('from=2026-02-30&to=2026-03-01').error && !!win('from=2026-11-02&to=2026-11-01').error && !!win('from=x&to=2026-11-01').error);
  check('D.3 insights window: at most 365 days, the newest', win('from=2020-01-01&to=2026-11-03').days.length === 365 && win('from=2020-01-01&to=2026-11-03').days[364] === '2026-11-03');
  check('D.3 insights window: no from / to keeps ?days=', win('days=7').days.length === 7);
  var ew = AUD.eventWindow({ daily: { '2026-11-01': { views: 5, uniques: 2, registrations: 1 }, '2026-11-02': { views: 3 } }, a: { legacyDays: null } }, ['2026-10-31', '2026-11-01', '2026-11-02']);
  check('D.3 an event\'s window: its sums and the newest day of each', same(ew, { registrations: 1, views: 8, uniques: 2, lastRegistration: '2026-11-01', lastView: '2026-11-02' }), ew);
  ew = AUD.eventWindow({ daily: { '2026-11-02': { registrations: 9, views: 1 } }, a: { legacyDays: { '2026-10-31': 2 } } }, ['2026-10-31', '2026-11-01', '2026-11-02']);
  check('D.3 an older event\'s registrations come from its own records (legacyDays), as the Insights page has them', ew.registrations === 2 && ew.lastRegistration === '2026-10-31' && ew.views === 1, ew);

  if (failed) { console.error('events-dashboard-page: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('events-dashboard-page: all ' + passed + ' checks passed');
})().catch(function (e) { console.error('FAIL the test itself threw: ' + (e && e.stack)); process.exit(1); });
