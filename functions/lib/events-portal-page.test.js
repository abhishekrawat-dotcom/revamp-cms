// node functions/lib/events-portal-page.test.js — the events dashboard (Event_Listing.html) on one ET portal at a time
// (owner decisions of 2026-11-03; plan §4, K10; D.3–D.5):
//   D.3 the page as a file: the invented portal table is gone, portal-picker.js loads after auth.js, the Portal column
//       and the notice exist, and the toolbar, the ⋯ menu, the KPI and the Latest Activity markup are byte-identical to
//       dc1a8e1 (copies kept below), so the ETB2B AI branch merges over them cleanly;
//   D.4 the list's portal helpers pulled out by name and run in a vm (inWorkingPortal, matches, createHref,
//       rowActionsHTML, mapApiEventToRow), then the whole inline script run with the real portal-picker.js over a small
//       in-memory DOM: the first visit, switching (search and keys), the server's choice winning, a shared browser (the
//       next person never keeps the last one's portal), the 3 s wait, the remembered portal on reload, the "No portal
//       yet" notice and Show them, Set portal from the chip and the ⋯ menu,
//       an empty portal, the phone Filters sheet, tab counts, totals and the ⋯ counts following the portal;
//   D.5 mailer-performance-page.test.js still passes, unedited.
// No network, no browser, no AI: GET /api/events, /api/et/portals and /api/me/working-portal are answered from fixtures.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var PAGE = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8');
var PICKER = fs.readFileSync(path.join(ROOT, 'portal-picker.js'), 'utf8');
var ROSTER = require('./et-events').portalList();
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function count(s, needle) { return s.split(needle).length - 1; }
function flush(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 16); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }

var START = PAGE.indexOf('<script>\n(function(){');
var INLINE = START === -1 ? '' : PAGE.slice(START + '<script>'.length, PAGE.indexOf('</script>', START));

/* ======================================================================================================
   D.3 the page as a file
   ====================================================================================================== */
check('D.3 the inline script is found', INLINE.length > 50000);
check('D.3 the invented portal table is gone: no var PORTALS =, CURRENT_PORTAL, hrworld or portal: \'cio\'',
  INLINE.indexOf('var PORTALS =') === -1 && PAGE.indexOf('CURRENT_PORTAL') === -1 && PAGE.toLowerCase().indexOf('hrworld') === -1 &&
  INLINE.indexOf('portal: \'cio\'') === -1 && INLINE.indexOf('portal:\'cio\'') === -1 && !/PORTALS\[/.test(INLINE));
var portalCode = INLINE.slice(INLINE.indexOf('PORTALS — the dashboard works on one ET portal at a time'), INLINE.indexOf('     TABS\n'));
check('D.3 the portal code is one block, with no link to index.html in it', portalCode.length > 5000 && portalCode.indexOf('index.html') === -1);
check('D.3 the switcher button says "Portal" until it is known (never a guessed name)', /<button class="mp-btn" id="btn-portals-nav" type="button" aria-haspopup="listbox">\s*Portal\s*<svg/.test(PAGE) && PAGE.indexOf('Brandequity') === -1);
var scripts = PAGE.match(/<script\b[^>]*>/g) || [];
/* with ETB2B AI's (8bebdc9): event-lifecycle.js between the picker and the inline script, the chat after it; and
   edit-event-core.js (B07: the API calls of Clone, Delete and Restore) before auth.js */
/* and (B11, UX-032) the vendored QR library, which draws the QR Codes dialog's code, between the picker and event-lifecycle.js */
check('D.3 scripts: the theme bootstrap, theme-toggle.js, edit-event-core.js, auth.js, portal-picker.js, qrcode-generator.js, event-lifecycle.js, the inline script, then ETB2B AI\'s two',
  JSON.stringify(scripts) === JSON.stringify(['<script>', '<script src="theme-toggle.js">', '<script src="edit-event-core.js">', '<script src="auth.js">', '<script src="portal-picker.js">', '<script src="assets/vendor/qrcode-generator.js">', '<script src="event-lifecycle.js">', '<script>',
    '<script src="etb2b-chat.js">', '<script src="dash-bot-client.js">']), scripts);
check('D.3 portal-picker.js comes right after auth.js and before the inline script', /<script src="auth.js"><\/script>\n<!--[^\n]*-->\n<script src="portal-picker.js"><\/script>\n<!--[^\n]*-->\n<script src="assets\/vendor\/qrcode-generator.js"><\/script>\n<!--[^\n]*-->\n<script src="event-lifecycle.js"><\/script>\n<script>\n\(function\(\)\{/.test(PAGE));
check('D.3 the server sends portal-picker.js', require('./access').isServableFile('portal-picker.js') === true && fs.existsSync(path.join(ROOT, 'portal-picker.js')));
check('D.3 th.col-portal right after "Event name"', count(PAGE, '<th class="col-portal">Portal</th>') === 1 && /<th>Event name<\/th>\n\s*<th class="col-portal">Portal<\/th>/.test(PAGE));
check('D.3 #portal-notice right after #special-banner', count(PAGE, 'id="portal-notice"') === 1 && /<div id="special-banner"><\/div>\n\s*<!--[^\n]*-->\n\s*<div id="portal-notice"><\/div>/.test(PAGE));
check('D.3 the notice links to the review page as portal-review.html', INLINE.indexOf('<a class="pn-link" href="portal-review.html">Review suggested portals</a>') !== -1);
var CSS = PAGE.slice(PAGE.indexOf('<style>'), PAGE.indexOf('</style>'));
var portalCss = CSS.slice(CSS.indexOf('.toast-btn{'), CSS.indexOf('.fade-in{'));
check('D.3 the portal CSS uses tokens only (no new hex colour, no rgb)', portalCss.length > 2000 && !/#[0-9a-fA-F]{3,8}\b/.test(portalCss) && !/rgba?\(/.test(portalCss), portalCss.match(/#[0-9a-fA-F]{3,8}\b/g));
check('D.3 the Portal column and the cards\' portal line show only in All portals', /\.ev-table \.col-portal\{ display:none; \}/.test(CSS) && /#results-view\.all-portals \.ev-table \.col-portal\{ display:table-cell; \}/.test(CSS) &&
  /\.ev-card-portal\{ display:none;/.test(CSS) && /#results-view\.all-portals \.ev-card-portal\{ display:flex; \}/.test(CSS));
check('D.3 the switcher menu is at most 340 px wide and 60vh tall, its list scrolling', /#portals-nav-menu\{ width:340px; max-width:calc\(100vw - 32px\); max-height:60vh;/.test(CSS) && /\.pn-list\{ overflow-y:auto;/.test(CSS));
/* the words of the new dashboard parts on their grounds are AA in both themes, with the page's own token values */
(function () {
  function block(re) {
    var m = re.exec(PAGE), out = {};
    if (!m) return out;
    PAGE.slice(m.index + m[0].length, PAGE.indexOf('}', m.index + m[0].length)).replace(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g, function (_, k, v) { out[k] = v; return _; });
    return out;
  }
  function lum(hex) {
    var h = hex.replace('#', '');
    return [0, 2, 4].map(function (i) { var c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
      .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var PAIRS = [
    ['text', 'surface-2', 'the notice\'s words'], ['accent-strong', 'surface-2', 'the notice\'s Show them, Back and review links'], ['text', 'accent-soft', 'the first-visit callout'],
    ['text', 'surface', 'a portal in the switcher, and a name in the Portal column'], ['text-muted', 'surface', 'a count, "Loading portals…", the cards\' portal line'],
    ['text-muted', 'surface-2', 'a count on the active option'], ['tag-blue', 'tag-blue-soft', 'the "Current" tag'], ['bg', 'text', 'the toast\'s View']
  ];
  [['light', block(/:root\{/)], ['dark', block(/:root\[data-theme="dark"\]\{/)]].forEach(function (th) {
    PAIRS.forEach(function (p) {
      var a = th[1][p[0]], c = th[1][p[1]], r = a && c ? ratio(a, c) : 0;
      check('D.3 ' + th[0] + ': --' + p[0] + ' on --' + p[1] + ' ≥ 4.5 (' + p[2] + ')', r >= 4.5, { ratio: Math.round(r * 100) / 100, fg: a, bg: c });
    });
  });
  /* (with the cooler red of before B11, --accent-strong on --accent-soft fell just short in light; --text reads at AA with either) */
  check('D.3 the callout\'s links are --text, which reads at AA on --accent-soft', /\.portal-callout \.pn-link\{ color:var\(--text\); \}/.test(CSS) &&
    ratio(block(/:root\{/).text, block(/:root\{/)['accent-soft']) >= 4.5);
  check('D.3 counts are --text-muted (the page\'s --text-faint would fail AA)', /\.pn-opt \.pn-count\{[^}]*color:var\(--text-muted\)/.test(CSS) && ratio(block(/:root\{/)['text-faint'], block(/:root\{/).surface) < 4.5);
})();

/* the toolbar, the ⋯ menu, the KPI and the Latest Activity markup at dc1a8e1, copied here: they must not change.
   ETB2B AI's branch (8bebdc9, merged after this change) rewrote two of them, the KPI cards and the Latest activity
   panel, to show real figures only: those two are held to its copies below instead, which this change must leave
   alone just the same. */
var BOT_8BEBDC9 = {
  kpiCards: "function card(label, icon, n, sub){\n      var value = loading ? '<div class=\"kpi-skel skel\"></div><span class=\"sr-only\">Loading</span>'\n        : ok ? '<span class=\"kpi-num\" title=\"' + fmtNum(n) + '\">' + fmtCompact(n) + '</span>'\n        : '<span class=\"kpi-num kpi-none\" aria-label=\"No figure\">—</span>';\n      return '<div class=\"kpi-card fade-in\">' +\n        '<div class=\"kpi-top\"><span class=\"kpi-label\">' + label + '</span><span class=\"kpi-icon\">' + icon + '</span></div>' +\n        value + '<span class=\"kpi-sub\">' + (ok || loading ? sub : (p ? 'Could not be loaded' : 'No figure for that period')) + '</span>' +\n      '</div>';\n    }\n    $('kpi-grid').innerHTML =\n      card('Visitors', IC.users, vis, 'Page views of these events’ sites') +\n      card('New registrations', IC.ticket, reg, 'People who registered on these events’ sites') +\n      '<div class=\"kpi-card is-none fade-in\">' +\n        '<div class=\"kpi-top\"><span class=\"kpi-label\">Revenue</span><span class=\"kpi-icon\">' + IC.wallet + '</span></div>' +\n        '<span class=\"kpi-num kpi-none\" aria-label=\"No figure\">—</span><span class=\"kpi-sub\">Payments are not part of Oneworld 2.0 yet</span>' +\n      '</div>' + note;",
  activityMarkup: "<div class=\"card panel-card\" id=\"activity-card\">\n      <div class=\"panel-card-head\">\n        <div>\n          <h3>Latest activity</h3>\n          <p class=\"panel-sub\">Real figures across all your events, for the period you pick</p>\n        </div>\n        <div class=\"panel-card-head-right\">\n          <!-- every change on every event, with who made it (activity-log.html) -->\n          <a class=\"btn btn-secondary btn-sm\" href=\"activity-log.html\" id=\"btn-activity-log\">\n            <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" aria-hidden=\"true\"><path d=\"M12 8v4l3 2\"/><path d=\"M3.05 11a9 9 0 1 1 .5 4\"/><path d=\"M3 4v5h5\"/></svg>\n            Full activity log\n          </a>\n          <div class=\"popover-wrap\">\n            <button class=\"btn btn-secondary btn-sm\" id=\"btn-activity-range\">\n              <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"4.5\" width=\"18\" height=\"16\" rx=\"2.5\"/><path d=\"M3 9.5h18M8 3v3M16 3v3\"/></svg>\n              <span id=\"activity-range-label\">Last 30 days</span>\n              <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.3\"><path d=\"M6 9l6 6 6-6\"/></svg>\n            </button>\n            <div class=\"popover range-popover\" id=\"activity-range-popover\" hidden></div>\n          </div>\n        </div>\n      </div>\n      <div class=\"panel-card-body\" id=\"activity-body\"></div>\n    </div>"
};
var DC1A8E1 = {
  toolbar: "<div class=\"toolbar\">\n      <div class=\"toolbar-filters-group\">\n        <div class=\"search-box\">\n          <svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M21 21l-4.3-4.3\"/></svg>\n          <input type=\"text\" id=\"search-input\" placeholder=\"Search events…\">\n          <button class=\"clear-btn\" id=\"btn-clear-search\" hidden aria-label=\"Clear search\">\n            <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.3\"><path d=\"M18 6L6 18M6 6l12 12\"/></svg>\n          </button>\n          <span class=\"kbd\" id=\"search-kbd\">/</span>\n        </div>\n\n        <div class=\"popover-wrap desk-only\">\n          <button class=\"toolbar-btn\" id=\"btn-type\">Event Type <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.3\"><path d=\"M6 9l6 6 6-6\"/></svg></button>\n          <div class=\"popover\" id=\"type-popover\" hidden></div>\n        </div>\n        <div class=\"popover-wrap desk-only\">\n          <button class=\"toolbar-btn\" id=\"btn-portal\">Portal <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.3\"><path d=\"M6 9l6 6 6-6\"/></svg></button>\n          <div class=\"popover\" id=\"portal-popover\" hidden></div>\n        </div>\n        <button class=\"toolbar-btn mobile-only\" id=\"btn-mobile-filters\">\n          <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M4 5h16M7 12h10M10 19h4\"/></svg>\n          Filters\n        </button>\n\n        <button class=\"toolbar-btn qr-toolbar-btn desk-only\" id=\"btn-qr-toolbar\">\n          <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><path d=\"M14 14h3v3h-3zM20 14v3M14 20h3M20 20h.01\"/></svg>\n          QR Codes\n        </button>\n      </div>\n\n      <div class=\"toolbar-right-group\">\n        <span class=\"result-line\" id=\"result-line\"></span>\n\n        <!-- the one action on this toolbar: Mailer performance and the Activity log are in the ⋯ menu above the\n             table (Reports), and the view switch sits on that row too, beside the table it changes -->\n        <a class=\"btn btn-primary btn-create\" href=\"create-event.html?new=1\" id=\"btn-create-event\">\n          <svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" aria-hidden=\"true\"><path d=\"M12 5v14M5 12h14\"/></svg>\n          Create Event\n        </a>\n      </div>\n    </div>\n    ",
  moreMarkup: "<div class=\"popover-wrap\">\n        <button class=\"icon-btn\" id=\"btn-more\" aria-haspopup=\"true\" aria-label=\"More\">\n          <svg width=\"17\" height=\"17\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"5\" cy=\"12\" r=\"1.5\"/><circle cx=\"12\" cy=\"12\" r=\"1.5\"/><circle cx=\"19\" cy=\"12\" r=\"1.5\"/></svg>\n        </button>\n        <div class=\"popover right\" id=\"more-menu\" hidden></div>\n      </div>",
  moreMenu: "$('more-menu').innerHTML =\n      '<button class=\"popover-item\" data-special=\"draft\">' + IC.file + ' Draft Events <span class=\"mono faint\" style=\"margin-left:auto;\">' + draftCount + '</span></button>' +\n      '<button class=\"popover-item\" data-special=\"cancelled\">' + IC.ban + ' Cancelled Events <span class=\"mono faint\" style=\"margin-left:auto;\">' + cancelledCount + '</span></button>' +\n      '<button class=\"popover-item\" data-special=\"deleted\">' + IC.trash2 + ' Deleted Events <span class=\"mono faint\" style=\"margin-left:auto;\">' + deletedCount + '</span></button>' +\n      /* the cross-event reports: they used to be buttons on the toolbar, which now keeps Create Event alone */\n      '<div class=\"popover-sep\"></div><div class=\"popover-label\">Reports</div>' +\n      '<a class=\"popover-item\" href=\"mailer-performance.html\" id=\"menu-mailer-performance\">' + REPORT_IC.mailers + ' Mailer performance</a>' +\n      '<a class=\"popover-item\" href=\"activity-log.html\" id=\"menu-activity-log\">' + REPORT_IC.log + ' Activity log</a>';",
  kpiMarkup: "<section id=\"insights-section\">\n    <div class=\"insights-head\">\n      <h2 id=\"insights-title\">Upcoming Event Insights</h2>\n      <div class=\"popover-wrap\">\n        <button class=\"btn btn-secondary btn-sm\" id=\"btn-range\">\n          <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"4.5\" width=\"18\" height=\"16\" rx=\"2.5\"/><path d=\"M3 9.5h18M8 3v3M16 3v3\"/></svg>\n          <span id=\"range-label\">Last 30 days</span>\n          <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.3\"><path d=\"M6 9l6 6 6-6\"/></svg>\n        </button>\n        <div class=\"popover range-popover\" id=\"range-popover\" hidden></div>\n      </div>\n    </div>\n    <div class=\"kpi-grid\" id=\"kpi-grid\"></div>\n  </section>",
  kpiCards: "function card(label, icon, value){\n      return '<div class=\"kpi-card fade-in\">' +\n        '<div class=\"kpi-top\"><span class=\"kpi-label\">' + label + '</span><span class=\"kpi-icon\">' + icon + '</span></div>' +\n        '<span class=\"kpi-num\">' + value + '</span>' +\n      '</div>';\n    }\n    $('kpi-grid').innerHTML =\n      card('Total Visitors', IC.users, fmtCompact(vis)) +\n      card('Total Registrations', IC.ticket, fmtCompact(reg)) +\n      card('Total Revenue', IC.wallet, fmtRupee(rev));",
  activityMarkup: "<div class=\"card panel-card\" id=\"activity-card\">\n      <div class=\"panel-card-head\">\n        <div>\n          <h3>Latest Activity on this Portal</h3>\n          <p class=\"panel-sub\">Platform-wide activity for the selected period</p>\n        </div>\n        <div class=\"panel-card-head-right\">\n          <!-- every change on every event, with who made it (activity-log.html) -->\n          <a class=\"btn btn-secondary btn-sm\" href=\"activity-log.html\" id=\"btn-activity-log\">\n            <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" aria-hidden=\"true\"><path d=\"M12 8v4l3 2\"/><path d=\"M3.05 11a9 9 0 1 1 .5 4\"/><path d=\"M3 4v5h5\"/></svg>\n            Full activity log\n          </a>\n          <div class=\"popover-wrap\">\n            <button class=\"btn btn-secondary btn-sm\" id=\"btn-activity-range\">\n              <svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"3\" y=\"4.5\" width=\"18\" height=\"16\" rx=\"2.5\"/><path d=\"M3 9.5h18M8 3v3M16 3v3\"/></svg>\n              <span id=\"activity-range-label\">Last 30 days</span>\n              <svg width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.3\"><path d=\"M6 9l6 6 6-6\"/></svg>\n            </button>\n            <div class=\"popover range-popover\" id=\"activity-range-popover\" hidden></div>\n          </div>\n        </div>\n      </div>\n      <div class=\"panel-card-body\" id=\"activity-body\"></div>\n    </div>"
};
function slice(s, a, b, incl) { var i = s.indexOf(a); if (i < 0) return null; var j = s.indexOf(b, i + a.length); return j < 0 ? null : s.slice(i, incl ? j + b.length : j); }
[
  ['toolbar', 'the toolbar', '<div class="toolbar">', '<div class="chip-row" id="chip-row">', false],
  ['moreMarkup', 'the ⋯ menu\'s markup', '<div class="popover-wrap">\n        <button class="icon-btn" id="btn-more"', '<div class="popover right" id="more-menu" hidden></div>\n      </div>', true],
  /* the ⋯ menu's items, the KPI section and the KPI cards were held here until both branches had merged; B07 changes
     them on purpose (UX-034: Cancelled only while an event is cancelled, counts a dash until loaded; UX-039: a line
     saying what the cards count; UX-025: Revenue says "Payments: not available yet") and pins the new ones below */
  ['activityMarkup', 'the Latest Activity panel', '<div class="card panel-card" id="activity-card">', '<div class="panel-card-body" id="activity-body"></div>\n    </div>', true, BOT_8BEBDC9, 'ETB2B AI\'s (8bebdc9)']
].forEach(function (d) {
  var now = slice(PAGE, d[2], d[3], d[4]), was = (d[5] || DC1A8E1)[d[0]];
  check('D.3 ' + d[1] + ' is byte-identical to ' + (d[6] || 'dc1a8e1'), typeof was === 'string' && was.length > 300 && now === was, now && now.length);
});
/* B07: what replaced the three pins above; B10 (UX-018) moved Draft Events out of the ⋯ menu into a Drafts tab */
check('D.3 B10 the ⋯ menu: Cancelled only while some event is cancelled (or it is the view shown), Deleted Events always, then the Reports; no Draft Events',
  /function renderMoreMenu\(\)\{[\s\S]*?\(cancelled \|\| state\.specialView === 'cancelled' \? item\('cancelled'[\s\S]*?item\('deleted', IC\.trash2, 'Deleted Events'[\s\S]*?Mailer performance<\/a>[\s\S]*?Activity log<\/a>/.test(INLINE) &&
  INLINE.indexOf("item('draft'") === -1 && /var TABS = \[\['draft','Drafts'\],\['upcoming','Upcoming'\],\['active','Active'\],\['completed','Completed'\]\];/.test(INLINE));
check('D.3 B07 the KPI section keeps its title, period picker and grid, and has the line saying what the cards count',
  /<section id="insights-section">\n\s*<div class="insights-head">\n\s*<div>\n\s*<h2 id="insights-title">Upcoming Event Insights<\/h2>\n\s*<p class="insights-scope" id="insights-scope"><\/p>\n\s*<\/div>/.test(PAGE) &&
  PAGE.indexOf('<span id="range-label">Last 30 days</span>') !== -1 && count(PAGE, 'id="kpi-grid"') === 1);
check('D.3 B07 the KPI cards: Visitors and New registrations as before (ETB2B AI\'s), Revenue honestly "Payments: not available yet"',
  INLINE.indexOf(BOT_8BEBDC9.kpiCards.split('\n    $(\'kpi-grid\').innerHTML =')[0]) !== -1 &&
  INLINE.indexOf("card('Visitors', IC.users, vis, 'Page views of these events’ sites') +\n      card('New registrations', IC.ticket, reg, 'People who registered on these events’ sites') +") !== -1 &&
  INLINE.indexOf('<span class="kpi-sub">Payments: not available yet</span>') !== -1 && INLINE.indexOf('Payments are not part of Oneworld') === -1);
check('D.3 Create Event is still alone on the toolbar, with its working default href', DC1A8E1.toolbar.indexOf('<a class="btn btn-primary btn-create" href="create-event.html?new=1" id="btn-create-event">') !== -1);

/* (comments may quote code in backticks, as dc1a8e1's do, so they are taken out first) */
var INLINE_CODE = INLINE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
check('D.3 the inline script is ES5 (no let, const, arrows or template strings)', !/\blet\s|\bconst\s/.test(INLINE_CODE) && INLINE_CODE.indexOf('=>') === -1 && INLINE_CODE.indexOf('`') === -1);
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the regex check above still ran */ }
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(INLINE, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
  check('D.3 the inline script is ES5 by esbuild', es5 === true, es5);
}

/* ======================================================================================================
   D.4 (a) the helpers, by name
   ====================================================================================================== */
/* a function's or a var's source, braces matched outside strings, comments and regular expressions */
function sourceFrom(at) {
  var i = INLINE.indexOf('{', at), depth = 0, q = null;
  for (; i < INLINE.length; i++) {
    var ch = INLINE[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '\'' || ch === '"') { q = ch; continue; }
    if (ch === '/' && INLINE[i + 1] === '*') { i = INLINE.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && INLINE[i + 1] === '/') { i = INLINE.indexOf('\n', i); continue; }
    if (ch === '/') {
      /* a regular expression starts where a value is expected: after ( , = : [ ! & | ? { } ; or return */
      var before = INLINE.slice(at, i).replace(/\s+$/, '');
      if (/[(,=:[!&|?{};]$/.test(before) || /\breturn$/.test(before)) {
        var cls = false;
        for (i++; i < INLINE.length; i++) {
          if (INLINE[i] === '\\') { i++; continue; }
          if (INLINE[i] === '[') cls = true; else if (INLINE[i] === ']') cls = false; else if (INLINE[i] === '/' && !cls) break;
        }
        continue;
      }
    }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) break; }
  }
  return INLINE.slice(at, i + 1);
}
function fnSource(name) { var at = INLINE.indexOf('function ' + name + '('); if (at === -1) throw new Error('no function ' + name); return sourceFrom(at); }
function varSource(name) { var at = INLINE.indexOf('var ' + name + ' = {'); if (at === -1) throw new Error('no var ' + name); return sourceFrom(at) + ';'; }
var H = { window: {}, Date: Date };
H.window.RevampPortals = { nameOf: function (s) { return s === 'retail' ? 'ETRetail' : ''; }, chipHtml: function (o) { return '<span class="rvp-chip" data-chip-for="' + o.eventId + '"><button data-set-portal="' + o.eventId + '">Set portal</button></span>'; } };
vm.createContext(H);
/* the lifecycle rule is event-lifecycle.js's since ETB2B AI's merge (window.RevampLifecycle), and the search is
   searchHit (the event's own cells) with portalSearchHit (its portal's name) */
H.window.RevampLifecycle = require('../../event-lifecycle.js');
var FNS = ['esc', 'svg', 'typeLabel', 'searchLine', 'searchCells', 'searchHit', 'portalSearchHit', 'mapApiEventToRow', 'inWorkingPortal', 'workingPortal', 'onRoster', 'portalNameOf', 'portalCounts', 'portalsWithEvents',
  'createHref', 'matches', 'quickActionIcon', 'rowActionsHTML', 'portalCellHTML',
  /* B07: the row menu marks Delete and Restore "Approvers only" for anyone else (no approvers known here: everyone may) */
  'mayRemove', 'whoMayRemove', 'listingMe', 'hasDateFilters', 'listFiltered'];
/* the category names are edit-event-core.js's (RevampCore.TYPES, B11 UX-005), which the page loads first */
H.window.RevampCore = { TYPES: (new Function(/\n  var TYPES = (\{[\s\S]*?\});/.exec(fs.readFileSync(path.join(ROOT, 'edit-event-core.js'), 'utf8'))[0] + '\nreturn TYPES;'))() };
vm.runInContext([/\n  var EVENT_TYPES = [^\n]*;/.exec(INLINE)[0], varSource('TYPE_TAG_CLASS'), 'function svg(d, w){ return \'<svg>\' + d + \'</svg>\'; }'].concat(FNS.filter(function (n) { return n !== 'svg'; }).map(fnSource)).join('\n') +
  '\nvar IC = new Proxy({}, { get: function(t, k){ return "[" + String(k) + "]"; } });', H);
H.PORTAL_ROSTER = ROSTER; H.rosterState = 'ready';
function row(o) { return H.mapApiEventToRow(Object.assign({ name: 'x', category: 'ip', published: true, start: '2020-01-01T10:00', end: '2099-01-01T10:00', counters: {} }, o)); }
var R_HR = row({ id: 'a', name: 'HR Leaders Summit', portal: 'hr', portalName: 'ETHRWorld', venue: 'Taj', city: 'Mumbai', hasGeneratedSite: true });
var R_CIO = row({ id: 'b', name: 'CIO Conclave', portal: 'cio', portalName: 'ETCIO' });
var R_NONE = row({ id: 'c', name: 'Retail Leaders Summit', portal: '' });
var R_DEL = row({ id: 'd', name: 'Gone', portal: '', deletedAt: '2026-10-01T00:00:00Z' });
var R_DRAFT = row({ id: 'e', name: 'Draft', portal: '', published: false });
H.EVENTS = [R_HR, R_CIO, R_NONE, R_DEL, R_DRAFT];
function st(o) { H.state = Object.assign({ portal: 'all', portalReturn: '', search: '', filters: { types: [], portals: [], payment: [] } }, o || {}); return H.state; }

check('D.4 mapApiEventToRow keeps portal, portalName, hasGeneratedSite and published', R_HR.portal === 'hr' && R_HR.portalName === 'ETHRWorld' && R_HR.hasGeneratedSite === true && R_HR.published === true &&
  R_NONE.portal === '' && R_NONE.portalName === '' && R_NONE.hasGeneratedSite === false && R_DRAFT.published === false, [R_HR, R_NONE]);
var odd = row({ id: 'z', portal: 7, portalName: { x: 1 }, hasGeneratedSite: 'yes', published: 'true' });
check('D.4 mapApiEventToRow: anything but a string is no portal; only true is true', odd.portal === '' && odd.portalName === '' && odd.hasGeneratedSite === false && odd.published === false, odd);
check('D.4 no row is ever given a portal it does not have (the old rows were all \'cio\')', R_NONE.portal === '' && fnSource('mapApiEventToRow').indexOf('\'cio\'') === -1);

st({ portal: 'all' });
check('D.4 inWorkingPortal, All portals: every row', [R_HR, R_CIO, R_NONE].every(H.inWorkingPortal));
st({ portal: 'hr' });
check('D.4 inWorkingPortal, ETHRWorld: its rows only (not another portal\'s, not one with no portal)', H.inWorkingPortal(R_HR) && !H.inWorkingPortal(R_CIO) && !H.inWorkingPortal(R_NONE));

st({ portal: 'all', filters: { types: [], portals: ['none'], payment: [] } });
check('D.4 matches, All portals, filter [\'none\']: the rows with no portal only', H.matches(R_NONE) && !H.matches(R_HR) && !H.matches(R_CIO));
st({ portal: 'all', filters: { types: [], portals: ['hr', 'cio'], payment: [] } });
check('D.4 matches, All portals, filter [\'hr\',\'cio\']', H.matches(R_HR) && H.matches(R_CIO) && !H.matches(R_NONE));
st({ portal: 'hr', filters: { types: [], portals: ['cio'], payment: [] } });
check('D.4 matches ignores filters.portals in a one-portal view (nothing hidden where no chip says why)', H.matches(R_HR) === true);
st({ portal: 'all', search: 'ethrworld' });
check('D.4 search matches the portal\'s name', H.matches(R_HR) && !H.matches(R_CIO) && !H.matches(R_NONE));
st({ portal: 'all', search: 'no portal yet' });
check('D.4 search "no portal yet" finds the rows with none', H.matches(R_NONE) && !H.matches(R_HR));

st({ portal: 'hr' });
check('D.4 createHref on ETHRWorld: create-event.html?new=1&portal=hr', H.createHref() === 'create-event.html?new=1&portal=hr');
st({ portal: 'all' });
check('D.4 createHref on All portals: create-event.html?new=1', H.createHref() === 'create-event.html?new=1');
st({ portal: 'all', portalReturn: 'hr' });
check('D.4 createHref while Show them looks at every portal: still the working portal', H.createHref() === 'create-event.html?new=1&portal=hr');

/* the ⋯ menu's first item (the quick icons before it carry data-row-action too) */
function firstAction(e) { var h = H.rowActionsHTML(e, 'row'); var m = /data-row-action="([^"]+)"/.exec(h.slice(h.indexOf('class="popover row-menu"'))); return m && m[1]; }
check('D.4 rowActionsHTML: Set portal is the first ⋯ item of a row with no portal', firstAction(R_NONE) === 'set-portal' && firstAction(R_DRAFT) === 'set-portal' &&
  /data-row-action="set-portal" data-id="c">\[globe\] Set portal<\/button><div class="popover-sep"><\/div>/.test(H.rowActionsHTML(R_NONE, 'row')));
check('D.4 …never on a row with a portal, never in Deleted', H.rowActionsHTML(R_HR, 'row').indexOf('set-portal') === -1 && H.rowActionsHTML(R_DEL, 'row').indexOf('set-portal') === -1 && R_DEL.status === 'deleted');
var c = H.portalCounts();
check('D.4 portalCounts: live events only (Deleted is not counted), by portal', c.all === 4 && c.none === 2 && c.by.hr === 1 && c.by.cio === 1, c);
check('D.4 portalNameOf: the roster\'s name; "All portals"; "No portal yet"', H.portalNameOf('hr') === 'ETHRWorld' && H.portalNameOf('all') === 'All portals' && H.portalNameOf('none') === 'No portal yet' && H.portalNameOf('') === 'No portal yet');
check('D.4 portalCellHTML: the name (escaped) or the picker\'s chip', H.portalCellHTML(R_HR) === '<span class="ev-portal-name">ETHRWorld</span>' && H.portalCellHTML(R_NONE).indexOf('data-set-portal="c"') !== -1 &&
  H.portalCellHTML(R_DEL) === '<span class="muted">No portal yet</span>');
if (esbuild) {
  var changed = ['mapApiEventToRow', 'inWorkingPortal', 'workingPortal', 'onRoster', 'portalNameOf', 'portalCounts', 'portalsWithEvents', 'createHref', 'renderPortalsNavBtn', 'renderPortalView', 'renderPortalsNavMenu',
    'portalNavOptions', 'portalNavOptionHTML', 'renderPortalNavList', 'portalNavIds', 'markPortalNavActive', 'onPortalNavKey', 'openPortalsNav', 'pickPortalFromNav', 'switchPortal', 'showAllPortalsForNow',
    'showNoPortal', 'backToWorkingPortal', 'startPortals', 'applyWorking', 'loadRoster', 'afterRoster', 'openSetPortalFor', 'toastAction', 'portalCellHTML', 'renderPortalNotice', 'renderTabs', 'renderKPIs',
    'renderMoreMenu', 'portalFilterRows', 'renderPortalPopover', 'renderToolbarButtons', 'renderChips', 'bucketEvents', 'matches', 'rowActionsHTML', 'renderResults', 'applyView', 'wireRowEvents',
    'handleRowAction', 'openMobileFilters', 'renderApp', 'loadAndRender', 'init'];
  var notEs5 = changed.filter(function (n) { try { esbuild.transformSync(fnSource(n), { loader: 'js', target: 'es5' }); return false; } catch (e) { return true; } });
  check('D.4 every changed or added function is ES5 (esbuild, one by one)', notEs5.length === 0, notEs5);
}

/* ======================================================================================================
   D.4 (b) the whole page, run: a small in-memory DOM (the same as portal-picker.test.js's)
   ====================================================================================================== */
function makeDom() {
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', larr: '←', rarr: '→', uarr: '↑', darr: '↓', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
  function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, k) {
      if (k[0] === '#') return String.fromCharCode(k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
      return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
    });
  }
  function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

  var doc;
  function Text(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
  function El(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.localName = String(tag).toLowerCase();
    this.attrs = {}; this.childNodes = []; this.parentNode = null; this.listeners = {}; this.style = {};
    this._value = null; this._sel = false;
    var el = this;
    this.classList = {
      contains: function (c) { return el.className.split(/\s+/).indexOf(c) !== -1; },
      add: function (c) { if (!el.classList.contains(c)) el.className = (el.className + ' ' + c).trim(); },
      remove: function (c) { el.className = el.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(' '); },
      toggle: function (c, on) { if (on === undefined) on = !el.classList.contains(c); if (on) el.classList.add(c); else el.classList.remove(c); return on; }
    };
  }
  function reflect(prop, attr) {
    Object.defineProperty(El.prototype, prop, { get: function () { return this.attrs[attr] === undefined ? '' : this.attrs[attr]; }, set: function (v) { this.attrs[attr] = String(v); } });
  }
  function flag(prop) {
    Object.defineProperty(El.prototype, prop, { get: function () { return this.attrs[prop] !== undefined; }, set: function (v) { if (v) this.attrs[prop] = ''; else delete this.attrs[prop]; } });
  }
  reflect('id', 'id'); reflect('className', 'class'); reflect('type', 'type'); flag('hidden'); flag('disabled');
  Object.defineProperty(El.prototype, 'children', { get: function () { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); } });
  Object.defineProperty(El.prototype, 'isConnected', { get: function () { var n = this; while (n.parentNode) n = n.parentNode; return n === doc; } });
  Object.defineProperty(El.prototype, 'textContent', {
    get: function () { return this.childNodes.map(function (n) { return n.nodeType === 3 ? n.data : n.textContent; }).join(''); },
    set: function (v) { this.childNodes.forEach(function (n) { n.parentNode = null; }); this.childNodes = []; if (String(v)) this.appendChild(new Text(String(v))); }
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    get: function () { return this.childNodes.map(serialize).join(''); },
    set: function (v) { this.childNodes.forEach(function (n) { n.parentNode = null; }); this.childNodes = []; parseInto(this, String(v)); }
  });
  Object.defineProperty(El.prototype, 'options', { get: function () { return this.querySelectorAll('option'); } });
  Object.defineProperty(El.prototype, 'value', {
    get: function () {
      if (this.localName === 'select') {
        var opts = this.options, on = opts.filter(function (o) { return o._sel; })[0] || opts.filter(function (o) { return !o.disabled; })[0];
        return on ? on.value : '';
      }
      if (this.localName === 'option') return this.attrs.value !== undefined ? this.attrs.value : this.textContent;
      return this._value !== null ? this._value : (this.attrs.value || '');
    },
    set: function (v) {
      if (this.localName === 'select') { this.options.forEach(function (o) { o._sel = o.value === String(v); }); return; }
      this._value = String(v);
    }
  });
  El.prototype.setAttribute = function (k, v) { this.attrs[String(k).toLowerCase()] = String(v); };
  El.prototype.getAttribute = function (k) { k = String(k).toLowerCase(); return this.attrs[k] === undefined ? null : this.attrs[k]; };
  El.prototype.hasAttribute = function (k) { return this.attrs[String(k).toLowerCase()] !== undefined; };
  El.prototype.removeAttribute = function (k) { delete this.attrs[String(k).toLowerCase()]; };
  El.prototype.appendChild = function (n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; };
  El.prototype.insertBefore = function (n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; };
  El.prototype.removeChild = function (n) { var i = this.childNodes.indexOf(n); if (i !== -1) this.childNodes.splice(i, 1); n.parentNode = null; if (doc.activeElement && !doc.activeElement.isConnected) doc.activeElement = doc.body; return n; };
  El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  El.prototype.contains = function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; };
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.removeEventListener = function (t, fn) { var l = this.listeners[t] || []; var i = l.indexOf(fn); if (i !== -1) l.splice(i, 1); };
  El.prototype.focus = function () { if (this.disabled || !this.isConnected) return; doc.activeElement = this; };
  El.prototype.blur = function () { if (doc.activeElement === this) doc.activeElement = doc.body; };
  El.prototype.click = function () { fire(this, 'click'); };
  El.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
  El.prototype.scrollIntoView = function () {};
  ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'].forEach(function (k) { Object.defineProperty(El.prototype, k, { get: function () { return 0; } }); });
  El.prototype.querySelectorAll = function (sel) { var out = []; walk(this, function (n) { if (matches(n, sel)) out.push(n); }); return out; };
  El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  El.prototype.matches = function (sel) { return matches(this, sel); };
  El.prototype.closest = function (sel) { for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; };
  function walk(root, fn) { root.childNodes.forEach(function (n) { if (n.nodeType === 1) { fn(n); walk(n, fn); } }); }

  function compound(el, s) {
    var m, re = /([a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g, any = false;
    while ((m = re.exec(s))) {
      any = true;
      if (m[1] && el.localName !== m[1].toLowerCase()) return false;
      if (m[2] && el.getAttribute('id') !== m[2]) return false;
      if (m[3] && !el.classList.contains(m[3])) return false;
      if (m[4]) { var want = m[5] !== undefined ? m[5] : m[6] !== undefined ? m[6] : m[7]; var have = el.getAttribute(m[4]); if (have === null || (want !== undefined && have !== want)) return false; }
    }
    return any;
  }
  function matchOne(el, sel) {
    var parts = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    function back(node, i) {
      if (!compound(node, parts[i])) return false;
      if (i === 0) return true;
      if (parts[i - 1] === '>') { var p = node.parentNode; return !!p && p.nodeType === 1 && back(p, i - 2); }
      for (var a = node.parentNode; a && a.nodeType === 1; a = a.parentNode) if (back(a, i - 1)) return true;
      return false;
    }
    return back(el, parts.length - 1);
  }
  function matches(el, sel) { return el.nodeType === 1 && sel.split(',').some(function (s) { return matchOne(el, s); }); }

  function parseInto(parent, html) {
    var re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+|<)/g, m, stack = [parent];
    while ((m = re.exec(html))) {
      var top = stack[stack.length - 1];
      if (m[0].slice(0, 4) === '<!--') continue;
      if (m[1]) {
        var t = m[1].toLowerCase();
        for (var i = stack.length - 1; i > 0; i--) if (stack[i].localName === t) { stack.length = i; break; }
      } else if (m[2]) {
        var el = new El(m[2]), am, are = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        while ((am = are.exec(m[3]))) el.attrs[am[1].toLowerCase()] = decode(am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '');
        if (el.localName === 'option') el._sel = el.attrs.selected !== undefined;
        top.appendChild(el);
        if (!m[4] && !VOID[el.localName]) stack.push(el);
      } else if (m[5]) {
        top.appendChild(new Text(decode(m[5])));
      }
    }
  }
  function serialize(n) {
    if (n.nodeType === 3) return escText(n.data);
    var a = Object.keys(n.attrs).map(function (k) { return ' ' + k + (n.attrs[k] === '' && (k === 'hidden' || k === 'disabled' || k === 'selected') ? '' : '="' + escAttr(n.attrs[k]) + '"'); }).join('');
    return '<' + n.localName + a + '>' + (VOID[n.localName] ? '' : n.childNodes.map(serialize).join('') + '</' + n.localName + '>');
  }

  var winListeners = {};
  function fire(target, type, init) {
    var ev = { type: type, target: target, defaultPrevented: false, stopped: false, button: 0 };
    Object.keys(init || {}).forEach(function (k) { ev[k] = init[k]; });
    ev.preventDefault = function () { ev.defaultPrevented = true; };
    ev.stopPropagation = function () { ev.stopped = true; };
    var chain = [];
    for (var n = target; n; n = n.parentNode) chain.push(n);
    for (var i = 0; i < chain.length && !ev.stopped; i++) {
      ev.currentTarget = chain[i];
      (chain[i].listeners[type] || []).slice().forEach(function (fn) { fn.call(chain[i], ev); });
    }
    if (!ev.stopped) (winListeners[type] || []).slice().forEach(function (fn) { fn(ev); });
    return ev;
  }

  doc = new El('#document');
  doc.nodeType = 9;
  var html = new El('html'), head = new El('head'), body = new El('body');
  doc.appendChild(html); html.appendChild(head); html.appendChild(body);
  doc.documentElement = html; doc.head = head; doc.body = body; doc.activeElement = body; doc.readyState = 'complete';
  doc.createElement = function (t) { return new El(t); };
  doc.getElementById = function (id) { var hit = null; walk(doc, function (n) { if (!hit && n.getAttribute('id') === id) hit = n; }); return hit; };
  return { document: doc, El: El, fire: fire, winListeners: winListeners,
    key: function (target, key, extra) { var o = { key: key }; Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); return fire(target, 'keydown', o); } };
}

var BODY = PAGE.slice(PAGE.indexOf('<header class="main-nav">'), PAGE.indexOf('<script src="theme-toggle.js">'));
function response(status, json) {
  var t = json === undefined ? '' : JSON.stringify(json);
  return { status: status, ok: status >= 200 && status < 300, text: function () { return Promise.resolve(t); }, json: function () { return Promise.resolve(json); } };
}
var NOW = Date.now(), DAY = 86400000;
function iso(ms) { return new Date(ms).toISOString(); }
var ITEMS = [
  { id: 'hr-summit', name: 'HR Leaders Summit', category: 'ip', published: true, start: iso(NOW + 20 * DAY), end: iso(NOW + 21 * DAY), portal: 'hr', portalName: 'ETHRWorld', counters: { registrations: 40, views: 100 } },
  { id: 'hr-live', name: 'HR Tech Live', category: 'ip', published: true, start: iso(NOW - DAY), end: iso(NOW + DAY), portal: 'hr', portalName: 'ETHRWorld', counters: { registrations: 5, views: 9 } },
  { id: 'hr-draft', name: 'HR Awards Draft', category: 'awards', published: false, portal: 'hr', portalName: 'ETHRWorld', counters: {} },
  { id: 'cio-live', name: 'CIO Conclave', category: 'ip', published: true, start: iso(NOW - DAY), end: iso(NOW + DAY), portal: 'cio', portalName: 'ETCIO', counters: { registrations: 7, views: 70 } },
  { id: 'np-live', name: 'Retail Leaders Summit', category: 'ip', published: true, start: iso(NOW - DAY), end: iso(NOW + DAY), portal: '', portalName: '', hasGeneratedSite: true, counters: { registrations: 1 } },
  { id: 'np-draft', name: 'Lovable Import', category: 'client', published: false, portal: '', portalName: '', counters: {} },
  { id: 'gone', name: 'Deleted One', category: 'ip', published: true, portal: '', portalName: '', deletedAt: '2026-10-01T00:00:00.000Z', counters: {} }
];

/* o: store (localStorage object), server ('hr' | 'all' | null | 'pending' | 'fail'), put (status), portalsFail (n), patch(body), phone, items,
   who ({ uid }: who auth.js says is signed in, read at each call, so a test can have nobody known at load and
   somebody a moment later; left out, it is uid-asha throughout) */
function page(o) {
  o = o || {};
  var dom = makeDom(), d = dom.document;
  d.body.innerHTML = BODY;
  var mem = o.store || {}, timers = [], log = { fetch: [], opened: [] };
  var hold = { working: null };
  function route(method, url, body) {
    log.fetch.push({ method: method, url: url, body: body });
    if (url === '/api/et/portals') {
      if (o.portalsFail && o.portalsFail-- > 0) return response(502, { error: 'down' });
      return response(200, { portals: ROSTER });
    }
    if (url === '/api/me/working-portal' && method === 'GET') {
      if (o.server === 'pending') return new Promise(function (ok) { hold.working = function (v) { ok(response(200, { workingPortal: v })); }; });
      if (o.server === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      return response(200, { workingPortal: o.server === undefined ? null : o.server });
    }
    if (url === '/api/me/working-portal' && method === 'PUT') return response(o.put || 200, o.put && o.put !== 200 ? { error: 'QA HARNESS GUARD (not a product bug)' } : { ok: true, workingPortal: body.workingPortal });
    if (url === '/api/event' && method === 'PATCH') return o.patch ? o.patch(body) : response(200, { ok: true, updatedAt: 'x' });
    return response(404, {});
  }
  var ctx = {
    document: d, console: { log: function () {}, warn: function () {}, error: function () {} }, navigator: {},
    location: { hash: '', href: 'http://localhost/Event_Listing.html', pathname: '/Event_Listing.html', reload: function () {} },
    history: { replaceState: function () {} },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, clearTimeout: function () {},
    requestAnimationFrame: function () { return 0; },
    scrollTo: function () {}, open: function (u) { log.opened.push(u); },
    matchMedia: function (q) { return { matches: !!o.phone && /max-width: 640px/.test(q) }; },
    addEventListener: function (t, fn) { (dom.winListeners[t] = dom.winListeners[t] || []).push(fn); },
    innerWidth: o.phone ? 375 : 1440, innerHeight: 800,
    localStorage: { getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } },
    fetch: function (url) {
      log.fetch.push({ method: 'GET', url: url });
      /* since ETB2B AI's merge the Insights cards and Latest activity read the period's own figures: here each event's
         window is its counters, so the totals are the ones this test has always counted */
      if (/^\/api\/insights\?/.test(url)) return Promise.resolve(response(200, { byDay: [], events: (o.items || ITEMS).map(function (e) {
        var c = e.counters || {};
        return { eventId: e.id, name: e.name, window: { views: c.views || 0, registrations: c.registrations || 0, uniques: 0, lastRegistration: null, lastView: null } };
      }) }));
      if (/^\/api\/activity\/all\?/.test(url)) return Promise.resolve(response(200, { items: [], next: null }));
      if (url === '/api/promo/analytics/all') return Promise.resolve(response(200, { available: false, backend: 'none', series: [], totals: { sends: 0, opens: 0, clicks: 0 } }));
      return Promise.resolve(response(200, { items: o.items || ITEMS }));
    },
    RevampAuth: {
      getIdToken: function () { return Promise.resolve('token'); },
      currentUser: function () {
        var uid = o.who ? o.who.uid : 'uid-asha';
        return uid ? { uid: uid, email: uid === 'uid-asha' ? 'asha.rao@timesinternet.in' : 'qa-' + uid + '@timesinternet.in' } : null;
      },
      authedFetch: function (url, opts) { var body = opts && opts.body ? JSON.parse(opts.body) : undefined; return Promise.resolve(route((opts && opts.method) || 'GET', url, body)); }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (!o.noPicker) vm.runInContext(PICKER, ctx, { filename: 'portal-picker.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'event-lifecycle.js'), 'utf8'), ctx, { filename: 'event-lifecycle.js' });
  vm.runInContext(INLINE, ctx, { filename: 'Event_Listing.html (inline)' });
  function $(id) { return d.getElementById(id); }
  return {
    ctx: ctx, dom: dom, doc: d, $: $, log: log, mem: mem, hold: hold,
    runTimers: function (ms) { var due = timers.filter(function (t) { return t.ms === ms; }); timers = timers.filter(function (t) { return t.ms !== ms; }); due.forEach(function (t) { t.fn(); }); },
    rows: function () { return $('table-body').querySelectorAll('[data-row]').map(function (tr) { return tr.getAttribute('data-row'); }); },
    btn: function () { return $('btn-portals-nav').textContent.trim(); },
    result: function () { return $('result-line').textContent; },
    tabs: function () { var t = {}; $('status-tabs').querySelectorAll('[data-tab]').forEach(function (b) { t[b.getAttribute('data-tab')] = +b.querySelector('.tc').textContent; }); return t; },
    notice: function () { return $('portal-notice').textContent.replace(/\s+/g, ' ').trim(); },
    toasts: function () { return $('toast-region').children.map(function (t) { return t.textContent; }); },
    puts: function () { return log.fetch.filter(function (f) { return f.method === 'PUT'; }).map(function (f) { return f.body.workingPortal; }); },
    patches: function () { return log.fetch.filter(function (f) { return f.method === 'PATCH'; }).map(function (f) { return f.body; }); },
    create: function () { return $('btn-create-event').getAttribute('href'); },
    kpi: function () { return $('kpi-grid').querySelectorAll('.kpi-num').map(function (k) { return k.textContent; }); }
  };
}

async function main() {
  var S, store;

  /* ======== first visit: nothing remembered here, nothing on the server ======== */
  store = {};
  S = page({ store: store, server: null });
  check('D.4 first paint, before anybody has answered: the switcher says "Portal"', S.btn() === 'Portal');
  await flush();
  check('D.4 GET /api/events, /api/et/portals and /api/me/working-portal are all asked', ['/api/events', '/api/et/portals', '/api/me/working-portal'].every(function (u) { return S.log.fetch.some(function (f) { return f.url === u; }); }));
  check('D.4 first visit: All portals', S.btn() === 'All portals');
  check('D.4 …the first-visit callout asks for a portal', S.$('portal-notice').querySelector('.portal-callout') !== null &&
    S.notice().indexOf('Choose the portal you work on. The events list, Create Event and its previous editions follow it.') !== -1 && !!S.$('pn-choose'));
  check('D.4 …the Portal column is on (#results-view.all-portals) and every live row is listed', S.$('results-view').classList.contains('all-portals') && JSON.stringify(S.rows().sort()) === JSON.stringify(['cio-live', 'hr-live', 'np-live']), S.rows());
  check('D.4 …a row\'s Portal cell: its name, or the "No portal yet" chip with Set portal', S.$('table-body').querySelector('[data-row="hr-live"] td.col-portal').textContent === 'ETHRWorld' &&
    S.$('table-body').querySelector('[data-row="np-live"] td.col-portal .rvp-chip-text').textContent === 'No portal yet' &&
    !!S.$('table-body').querySelector('[data-row="np-live"] td.col-portal [data-set-portal="np-live"]'));
  check('D.4 …the cards carry the same line', S.$('card-list').querySelectorAll('.ev-card-portal').length === 3 && !!S.$('card-list').querySelector('.ev-card-portal [data-set-portal="np-live"]'));
  check('D.4 …the result line names no portal; Create Event has no portal', S.result() === 'Showing 1–3 of 3 events' && S.create() === 'create-event.html?new=1', [S.result(), S.create()]);
  check('D.4 …the toolbar\'s Portal filter is shown', S.$('btn-portal').parentNode.hidden === false);
  S.$('btn-portal').click();
  var pf = S.$('portal-popover').querySelectorAll('[data-portal]').map(function (b) { return b.getAttribute('data-portal') + ':' + b.textContent.replace(/\s+/g, ' ').trim(); });
  check('D.4 …it offers "No portal yet", then the portals that have events, by name, with counts (Deleted not counted)', JSON.stringify(pf) === JSON.stringify(['none:No portal yet 2', 'cio:ETCIO 1', 'hr:ETHRWorld 3']), pf);
  S.$('portal-popover').querySelector('[data-portal="none"]').click();
  check('D.4 …picking "No portal yet" lists the rows with none, with the chip "Portal: No portal yet"', JSON.stringify(S.rows()) === JSON.stringify(['np-live']) && S.$('chip-row').textContent.indexOf('Portal: No portal yet') !== -1);
  S.$('chip-clear-all').click();
  check('D.4 tab counts in All portals: every portal (Drafts is a tab since B10)', JSON.stringify(S.tabs()) === JSON.stringify({ draft: 2, upcoming: 1, active: 3, completed: 0 }), S.tabs());
  S.$('btn-more').click();
  check('D.4 the Drafts tab counts every portal\'s drafts in All portals', S.tabs().draft === 2 && !S.$('more-menu').querySelector('[data-special="draft"]'));
  check('D.4 the "No portal yet" notice: the count (Deleted not counted), Show them, Review suggested portals', S.notice().indexOf('2 events have no portal yet.') !== -1 && !!S.$('pn-show-none') &&
    S.$('portal-notice').querySelector('a[href="portal-review.html"]').textContent === 'Review suggested portals');

  /* ======== the switcher: open, search, keys, pick ======== */
  S.$('btn-portals-nav').click();
  var menu = S.$('portals-nav-menu');
  check('D.4 the switcher opens with "Your portal", a search box (focused) and one listbox', menu.hidden === false && menu.querySelector('.popover-label').textContent === 'Your portal' &&
    S.doc.activeElement === S.$('portal-nav-search') && S.$('portal-nav-search').getAttribute('placeholder') === 'Search portals' && S.$('portal-nav-list').getAttribute('role') === 'listbox');
  var opts = S.$('portal-nav-list').querySelectorAll('[role="option"]');
  check('D.4 the list: All portals (with the live count), then "Portals with events", then "Other ET portals" — the whole roster',
    opts[0].getAttribute('data-pn') === 'all' && opts[0].textContent.indexOf('All portals6') === 0 && opts[1].getAttribute('data-pn') === 'cio' && opts[2].getAttribute('data-pn') === 'hr' &&
    S.$('pn-g-events').textContent === 'Portals with events' && S.$('pn-g-other').textContent === 'Other ET portals' && opts.length === 1 + ROSTER.length, opts.slice(0, 3).map(function (x) { return x.textContent; }));
  check('D.4 the groups are role="group", labelled', S.$('portal-nav-list').querySelectorAll('[role="group"]').length === 2 && S.$('portal-nav-list').querySelectorAll('[role="group"]').every(function (g) { return !!S.$(g.getAttribute('aria-labelledby')); }));
  check('D.4 the current one is aria-selected with a "Current" tag', opts[0].getAttribute('aria-selected') === 'true' && opts[0].textContent.indexOf('Current') !== -1 && opts.filter(function (x) { return x.getAttribute('aria-selected') === 'true'; }).length === 1);
  check('D.4 no link anywhere in it (the old menu sent every portal to index.html)', menu.querySelectorAll('a').length === 0);
  var input = S.$('portal-nav-search');
  check('D.4 the search box points at the active option', input.getAttribute('aria-activedescendant') === 'pn-opt-all' && input.getAttribute('aria-controls') === 'portal-nav-list');
  S.dom.key(input, 'ArrowDown');
  check('D.4 ArrowDown moves to the next option', input.getAttribute('aria-activedescendant') === 'pn-opt-cio' && S.$('pn-opt-cio').classList.contains('pn-active'));
  S.dom.key(input, 'ArrowUp'); S.dom.key(input, 'ArrowUp');
  check('D.4 ArrowUp from the first wraps to the last', input.getAttribute('aria-activedescendant') === 'pn-opt-' + opts[opts.length - 1].getAttribute('data-pn'));
  S.dom.key(input, 'Escape');
  check('D.4 Escape closes it and gives focus back to the button', menu.hidden === true && S.doc.activeElement === S.$('btn-portals-nav'));
  S.$('btn-portals-nav').click();
  input = S.$('portal-nav-search');
  input.value = 'HR'; S.dom.fire(input, 'input');
  var shown = S.$('portal-nav-list').querySelectorAll('[role="option"]').map(function (x) { return x.getAttribute('data-pn'); });
  check('D.4 search covers names and slugs ("HR": ETHRWorld first, as it has events; then the other HR portals)', shown[0] === 'hr' && shown.indexOf('hrsea') !== -1 && shown.indexOf('hrme') !== -1 && shown.indexOf('all') === -1 && shown.indexOf('cio') === -1, shown);
  input.value = 'zzz'; S.dom.fire(input, 'input');
  check('D.4 a search with no match says so', S.$('portal-nav-list').textContent === 'No portal matches “zzz”.');
  input.value = 'hr'; S.dom.fire(input, 'input');
  S.dom.key(input, 'Enter');
  await flush();
  check('D.4 Enter picks: the list is on ETHRWorld', S.btn() === 'ETHRWorld' && menu.hidden === true && S.doc.activeElement === S.$('btn-portals-nav'));
  check('D.4 …only its events', JSON.stringify(S.rows()) === JSON.stringify(['hr-live']) && !S.$('results-view').classList.contains('all-portals'), S.rows());
  check('D.4 …the result line names the portal', S.result() === 'Showing 1–1 of 1 event on ETHRWorld', S.result());
  check('D.4 …the tab counts follow it', JSON.stringify(S.tabs()) === JSON.stringify({ draft: 1, upcoming: 1, active: 1, completed: 0 }), S.tabs());
  /* the third card is Revenue, a dash since ETB2B AI's merge: payments are not part of Oneworld 2.0 yet */
  check('D.4 …and the totals (Active on ETHRWorld: 9 visitors, 5 registrations)', JSON.stringify(S.kpi()) === JSON.stringify(['9', '5', '—']), S.kpi());
  S.$('btn-more').click();
  check('D.4 …and the Drafts tab\'s count (one ETHRWorld draft)', S.tabs().draft === 1);
  S.$('btn-more').click();
  check('D.4 …Create Event starts on it: ?new=1&portal=hr', S.create() === 'create-event.html?new=1&portal=hr');
  check('D.4 …the toolbar\'s Portal filter is hidden (the switcher is the portal control here)', S.$('btn-portal').parentNode.hidden === true);
  check('D.4 …the first-visit callout is gone', S.$('portal-notice').querySelector('.portal-callout') === null);
  check('D.4 …and the choice is saved for the person: PUT /api/me/working-portal "hr"', JSON.stringify(S.puts()) === JSON.stringify(['hr']));
  check('D.4 …and remembered in this browser for them', JSON.parse(store['rv.workingPortal.uid-asha']).portal === 'hr');

  /* Show them: every portal for this visit, with the no-portal filter; nothing saved */
  S.$('pn-show-none').click();
  await flush();
  check('D.4 Show them: every portal with the "No portal yet" filter, for this visit (the switcher still names the working portal)', S.btn() === 'ETHRWorld' && JSON.stringify(S.rows()) === JSON.stringify(['np-live']) && S.$('results-view').classList.contains('all-portals'));
  check('D.4 …nothing is saved (no setWorking), and Create Event still starts on ETHRWorld', JSON.stringify(S.puts()) === JSON.stringify(['hr']) && S.create() === 'create-event.html?new=1&portal=hr' &&
    JSON.parse(store['rv.workingPortal.uid-asha']).portal === 'hr');
  check('D.4 …the notice says what is shown, with Back to ETHRWorld and the review link', S.notice().indexOf('Showing the events with no portal yet.') !== -1 && S.$('pn-back').textContent === 'Back to ETHRWorld' &&
    !!S.$('portal-notice').querySelector('a[href="portal-review.html"]'));

  /* Set portal from the chip, in Show them */
  var patched = [];
  S.ctx.RevampAuth.authedFetch = (function (orig) { return function (url, opts) { if (opts && opts.method === 'PATCH') patched.push(JSON.parse(opts.body)); return orig(url, opts); }; })(S.ctx.RevampAuth.authedFetch);
  var chipBtn = S.$('table-body').querySelector('[data-set-portal="np-live"]');
  chipBtn.focus();
  chipBtn.click();
  var dlg = S.$('rv-portal-dialog');
  check('D.4 the chip\'s Set portal opens the window for that event, with the site and published notes (an AI-designed site, live)', !!dlg && dlg.querySelector('.rvp-sub').textContent === 'Retail Leaders Summit' &&
    dlg.textContent.indexOf('generated again') !== -1 && dlg.textContent.indexOf('published again') !== -1 && S.doc.activeElement === S.$('rvp-select'));
  S.$('rvp-select').value = 'cio'; S.$('rvp-save').click();
  await flush();
  check('D.4 …it PATCHes { eventId, portal, ifPortal: "" }', JSON.stringify(patched) === JSON.stringify([{ eventId: 'np-live', portal: 'cio', ifPortal: '' }]), patched);
  check('D.4 …the row has the portal now, so it leaves the "No portal yet" list', S.rows().length === 0 && !S.$('rv-portal-dialog'));
  var toastEl = S.$('toast-region').children[S.$('toast-region').children.length - 1];
  check('D.4 …the toast names it, with View (the row left the view)', toastEl && toastEl.textContent === '“Retail Leaders Summit” is now on ETCIO.View' && !!toastEl.querySelector('.toast-btn'), S.toasts());
  check('D.4 …the notice counts one fewer', S.notice().indexOf('Showing the events with no portal yet.') !== -1 && (S.$('pn-back').click(), S.notice().indexOf('1 event has no portal yet.') !== -1), S.notice());
  check('D.4 Back returns to ETHRWorld', S.btn() === 'ETHRWorld' && JSON.stringify(S.rows()) === JSON.stringify(['hr-live']));
  toastEl.querySelector('.toast-btn').click();
  await flush();
  check('D.4 View switches to the event\'s portal (and saves it)', S.btn() === 'ETCIO' && JSON.stringify(S.rows().sort()) === JSON.stringify(['cio-live', 'np-live']) && S.puts()[S.puts().length - 1] === 'cio');

  /* Show them when the current list has none of them: the list that has */
  S.$('pn-show-none').click();
  await flush();
  /* (B10, UX-018: Drafts is a tab, selected, rather than a ⋯ view under a banner) */
  check('D.4 Show them opens the list that holds the events with no portal (here Drafts)', JSON.stringify(S.rows()) === JSON.stringify(['np-draft']) &&
    S.$('status-tabs').querySelector('[aria-selected="true"]').getAttribute('data-tab') === 'draft', S.rows());
  /* the ⋯ menu's Set portal on that draft */
  var menuBtn = S.$('table-body').querySelector('[data-row-menu-btn]');
  menuBtn.click();
  var items = S.$(menuBtn.getAttribute('data-row-menu-btn')).querySelectorAll('[data-row-action]').map(function (b) { return b.getAttribute('data-row-action'); });
  check('D.4 the row\'s ⋯ menu offers Set portal first', items[0] === 'set-portal', items);
  S.$(menuBtn.getAttribute('data-row-menu-btn')).querySelector('[data-row-action="set-portal"]').click();
  check('D.4 …which opens the window for it (no site or published note: a draft from an import)', !!S.$('rv-portal-dialog') && S.$('rv-portal-dialog').querySelector('.rvp-sub').textContent === 'Lovable Import' &&
    S.$('rv-portal-dialog').textContent.indexOf('generated again') === -1);
  S.dom.key(S.$('rvp-select'), 'Escape');
  check('D.4 …Escape closes it and focus goes back to the row\'s ⋯ button', !S.$('rv-portal-dialog') && S.doc.activeElement === menuBtn);
  S.$('pn-back').click();
  /* (B10: back to Active by its tab; Drafts has no banner now) */
  S.$('status-tabs').querySelector('[data-tab="active"]').click();

  /* a 409: somebody set it meanwhile */
  S = page({ store: {}, server: 'all', patch: function () { return response(409, { error: 'This event\'s portal was changed to ETRetail meanwhile. Reload to see it.', code: 'portal-changed', current: 'retail', currentName: 'ETRetail' }); } });
  await flush();
  S.$('table-body').querySelector('[data-set-portal="np-live"]').click();
  S.$('rvp-select').value = 'hr'; S.$('rvp-save').click();
  await flush();
  check('D.4 a 409 portal-changed: the sentence in the window, and the row shows what the server has', S.$('rvp-error').textContent === 'This event\'s portal was changed to ETRetail meanwhile. Reload to see it.' &&
    S.$('table-body').querySelector('[data-row="np-live"] td.col-portal').textContent === 'ETRetail');
  S.$('rvp-cancel').click();

  /* ======== the PUT refused (the QA harness guard): kept in this browser, and still there on reload ======== */
  store = {};
  S = page({ store: store, server: null, put: 403 });
  await flush();
  S.$('btn-portals-nav').click();
  S.$('pn-opt-hr').click();
  await flush();
  check('D.4 a refused save: the list still switches, and the toast says the choice is kept in this browser', S.btn() === 'ETHRWorld' &&
    S.toasts().indexOf('Your portal choice is kept in this browser only: it could not be saved to your account.') !== -1, S.toasts());
  S = page({ store: store, server: null });
  check('D.4 reload: on ETHRWorld at once, from this browser (before any answer)', S.btn() === 'ETHRWorld' && S.create() === 'create-event.html?new=1&portal=hr');
  await flush();
  check('D.4 …and still after the server says it has no choice', S.btn() === 'ETHRWorld' && JSON.stringify(S.rows()) === JSON.stringify(['hr-live']) && S.$('portal-notice').querySelector('.portal-callout') === null);

  /* ======== the server wins when it has a choice ======== */
  S = page({ store: store, server: 'cio' });
  check('D.4 server and browser differ: the browser\'s first (instant)', S.btn() === 'ETHRWorld');
  await flush();
  check('D.4 …then the server\'s, which wins', S.btn() === 'ETCIO' && JSON.stringify(S.rows().sort()) === JSON.stringify(['cio-live']) && JSON.parse(store['rv.workingPortal.uid-asha']).portal === 'cio');

  /* ======== a shared browser: the next person to sign in never keeps the last one's portal ======== */
  var shared = { 'rv.workingPortal': 'uid-asha', 'rv.workingPortal.uid-asha': JSON.stringify({ v: 1, portal: 'hr', name: 'ETHRWorld' }) };
  var who = { uid: null };
  S = page({ store: shared, server: null, who: who });
  check('D.4 shared browser, before auth.js knows who is signed in: the last person seen here, at once', S.btn() === 'ETHRWorld', S.btn());
  who.uid = 'uid-bilal';   // auth.js answers: somebody else, with no choice on the server or in this browser
  await flush();
  check('D.4 …the next person, with no choice anywhere: All portals and the first-visit callout, never the last person\'s portal',
    S.btn() === 'All portals' && JSON.stringify(S.rows().sort()) === JSON.stringify(['cio-live', 'hr-live', 'np-live']) && !!S.$('pn-choose') &&
    S.$('results-view').classList.contains('all-portals'), [S.btn(), S.rows()]);
  check('D.4 …and Create Event starts on no portal (no ?portal= of the last person\'s)', S.create() === 'create-event.html?new=1', S.create());
  check('D.4 …the last person\'s choice is kept as it was, nothing is saved, and this browser now names the new person',
    JSON.parse(shared['rv.workingPortal.uid-asha']).portal === 'hr' && shared['rv.workingPortal'] === 'uid-bilal' && !('rv.workingPortal.uid-bilal' in shared) && S.puts().length === 0, shared);
  var who2 = { uid: null };
  S = page({ store: shared, server: null, who: who2 });
  check('D.4 …a reload before auth.js answers: no longer the last person\'s portal ("Portal" until it is known)', S.btn() === 'Portal', S.btn());
  who2.uid = 'uid-bilal';
  await flush();
  check('D.4 …then All portals and the callout', S.btn() === 'All portals' && !!S.$('pn-choose') && S.create() === 'create-event.html?new=1');
  /* the new person switching before the server has answered keeps their choice */
  shared = { 'rv.workingPortal': 'uid-asha', 'rv.workingPortal.uid-asha': JSON.stringify({ v: 1, portal: 'hr', name: 'ETHRWorld' }) };
  who = { uid: null };
  S = page({ store: shared, server: 'pending', who: who });
  who.uid = 'uid-bilal';
  await flush();
  S.$('btn-portals-nav').click(); S.$('pn-opt-cio').click();
  S.hold.working(null);
  await flush();
  check('D.4 …but a portal the new person switched to during the visit stays when the server then says it has none',
    S.btn() === 'ETCIO' && JSON.stringify(S.rows()) === JSON.stringify(['cio-live']) && !S.$('pn-choose') && JSON.parse(shared['rv.workingPortal.uid-bilal']).portal === 'cio' &&
    JSON.parse(shared['rv.workingPortal.uid-asha']).portal === 'hr', [S.btn(), S.rows()]);
  /* the same person, known at once, with no choice on the server: their own remembered portal stays */
  who = { uid: null };
  S = page({ store: { 'rv.workingPortal': 'uid-asha', 'rv.workingPortal.uid-asha': JSON.stringify({ v: 1, portal: 'hr', name: 'ETHRWorld' }) }, server: null, who: who });
  who.uid = 'uid-asha';
  await flush();
  check('D.4 …while the same person, once known, keeps their own remembered portal', S.btn() === 'ETHRWorld' && JSON.stringify(S.rows()) === JSON.stringify(['hr-live']) && !S.$('pn-choose'));

  /* ======== nothing here, the server slow: the list waits at most 3 s ======== */
  S = page({ store: {}, server: 'pending' });
  await flush();
  check('D.4 nothing remembered and the server slow: the list waits (skeleton rows, no result line yet)', S.rows().length === 0 && S.$('table-body').querySelectorAll('.skel-row').length === 5 && S.result() === '');
  S.runTimers(3000);
  await flush();
  check('D.4 …after 3 s: All portals, with the callout', S.btn() === 'All portals' && S.rows().length === 3 && !!S.$('pn-choose'));
  S.hold.working('hr');
  await flush();
  check('D.4 …a late answer still moves the list while the person has not switched', S.btn() === 'ETHRWorld' && JSON.stringify(S.rows()) === JSON.stringify(['hr-live']) && !S.$('pn-choose'));
  S = page({ store: {}, server: 'pending' });
  await flush();
  S.$('btn-portals-nav').click(); S.$('pn-opt-cio').click();
  S.hold.working('hr');
  await flush();
  check('D.4 …but never after the person switched', S.btn() === 'ETCIO' && JSON.stringify(S.rows()) === JSON.stringify(['cio-live']));
  S = page({ store: {}, server: 'fail' });
  await flush();
  check('D.4 the server cannot be reached and nothing is remembered: All portals and the callout, no wait', S.btn() === 'All portals' && S.rows().length === 3 && !!S.$('pn-choose'));

  /* ======== the roster: failed, Retry; a remembered portal the roster does not have ======== */
  S = page({ store: {}, server: null, portalsFail: 1 });
  await flush();
  S.$('btn-portals-nav').click();
  check('D.4 the roster failed: the menu says so, with Retry (the portals that have events still listed)', S.$('portal-nav-list').textContent.indexOf('The portal list could not be loaded.') !== -1 && !!S.$('pn-retry') &&
    !!S.$('pn-opt-hr') && !S.$('pn-g-other'));
  S.$('pn-retry').click();
  await flush();
  check('D.4 …Retry asks again, and the whole roster comes', S.log.fetch.filter(function (f) { return f.url === '/api/et/portals'; }).length === 2 && !!S.$('pn-g-other') && !S.$('pn-retry'));
  S = page({ store: { 'rv.workingPortal': 'uid-asha', 'rv.workingPortal.uid-asha': JSON.stringify({ v: 1, portal: 'hrworld', name: 'HRWorld' }) }, server: null });
  await flush();
  check('D.4 a remembered slug the roster does not have: All portals and the callout, never that slug', S.btn() === 'All portals' && !!S.$('pn-choose') && S.create() === 'create-event.html?new=1');

  /* ======== an empty portal ======== */
  S = page({ store: {}, server: 'auto' });
  await flush();
  check('D.4 a portal with no events: "ETAuto has no events yet", Create Event on it, Show all portals', S.$('table-body').textContent.indexOf('ETAuto has no events yet') !== -1 &&
    S.$('table-body').querySelector('a.btn-primary').getAttribute('href') === 'create-event.html?new=1&portal=auto' && !!S.$('table-body').querySelector('[data-empty-all-portals]') &&
    /* five columns on one portal since B07 took the Payment column out (UX-025) */
    S.$('table-body').querySelector('td').getAttribute('colspan') === '5');
  S.$('card-list').querySelector('[data-empty-all-portals]').click();
  await flush();
  check('D.4 …Show all portals (from the cards too, on a phone): every portal for this visit, Back to ETAuto, nothing saved', S.btn() === 'ETAuto' && S.rows().length === 3 &&
    S.notice().indexOf('Showing every portal for now.') !== -1 && S.$('pn-back').textContent === 'Back to ETAuto' && S.puts().length === 0 && S.create() === 'create-event.html?new=1&portal=auto');
  S.$('search-input').value = 'nothing like it'; S.dom.fire(S.$('search-input'), 'input');
  check('D.4 "No events match" stays for a search with no result (colspan 6 in All portals, with the Portal column)', S.$('table-body').textContent.indexOf('No events match') !== -1 && S.$('table-body').querySelector('td').getAttribute('colspan') === '6');

  /* ======== phones: the Filters sheet carries the Portal choice ======== */
  S = page({ store: {}, server: null, phone: true });
  await flush();
  S.$('pn-choose').click();
  var mp = S.$('m-portal');
  check('D.4 phone: "Choose portal" opens the Filters sheet, which starts with a Portal select', !!mp && mp.localName === 'select' && S.$('sheet-root').querySelector('label[for="m-portal"]').textContent === 'Portal' &&
    mp.options.length === 1 + ROSTER.length && mp.options[0].value === 'all' && mp.value === 'all');
  check('D.4 …in All portals the Portal filter\'s rows follow (No portal yet, and the portals with events)', JSON.stringify(S.$('sheet-root').querySelectorAll('[data-mportal]').map(function (b) { return b.getAttribute('data-mportal'); })) === JSON.stringify(['none', 'cio', 'hr']));
  mp.value = 'hr'; S.dom.fire(mp, 'change');
  await flush();
  check('D.4 …changing it switches the working portal (saved), and the sheet shows it', S.btn() === 'ETHRWorld' && S.puts()[0] === 'hr' && S.$('m-portal').value === 'hr' && S.$('sheet-root').querySelectorAll('[data-mportal]').length === 0);
  S.$('sheet-apply').click();
  check('D.4 …Show results: that portal\'s events', JSON.stringify(S.rows()) === JSON.stringify(['hr-live']));

  /* ======== portal-picker.js did not load ======== */
  S = page({ store: {}, noPicker: true });
  await flush();
  check('D.4 without portal-picker.js: every portal, no callout (the switcher could not work), the list still loads', S.btn() === 'All portals' && S.rows().length === 3 && !S.$('pn-choose') &&
    S.$('table-body').querySelector('[data-row="np-live"] td.col-portal').textContent === 'No portal yet');
  S.$('btn-portals-nav').click();
  check('D.4 …the switcher says the list could not be loaded', S.$('portal-nav-list').textContent.indexOf('The portal list could not be loaded.') !== -1);
  S.$('table-body').querySelector('[data-row="np-live"] [data-row-action="set-portal"]').click();
  check('D.4 …Set portal says to reload rather than doing nothing', S.toasts().indexOf('The portal list did not load. Reload the page and try again.') !== -1, S.toasts());

  /* ======== D.5 the Mailer performance / toolbar test still passes, unedited ======== */
  var cp = require('child_process');
  var mp5 = (function () { try { cp.execFileSync(process.execPath, [path.join(__dirname, 'mailer-performance-page.test.js')], { stdio: 'pipe' }); return true; } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); } })();
  check('D.5 mailer-performance-page.test.js passes (Create Event alone on the toolbar, ⋯ Reports, the view switch)', mp5 === true, mp5);

  if (failed) { console.error('events-portal-page: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('events-portal-page: all ' + passed + ' checks passed');
}
main().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
