// node functions/lib/mailer-performance-page.test.js — Mailer performance across all events: the page
// (mailer-performance.html) is only a bar above the mailer studio's own dashboard in a frame
// (promo-mailer-studio.html?scope=all), and the events listing links to it beside "Activity log". Reads the two
// pages as files; no network, no Firebase, no browser.
const fs = require('fs');
const path = require('path');
const access = require('./access');

var ROOT = path.join(__dirname, '..', '..');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function count(s, needle) { return s.split(needle).length - 1; }

/* ---------- mailer-performance.html ---------- */
var page = fs.readFileSync(path.join(ROOT, 'mailer-performance.html'), 'utf8');

/* the server sends only an allow-list of files: the page itself, and everything it loads from this server */
check('the server sends the page', access.isServableFile('mailer-performance.html'));
var local = (page.match(/(?:src|href)="[^"]+"/g) || []).map(function (a) { return a.replace(/^(?:src|href)="|"$/g, ''); })
  .filter(function (u) { return !/^(https?:)?\/\/|^#|^data:|^about:/.test(u); });
var unserved = local.filter(function (u) { return !access.isServableFile(u.split('?')[0]); });
check('every file the page loads or links to is one the server sends', local.length >= 4 && !unserved.length, unserved);
check('the frame\'s page exists', fs.existsSync(path.join(ROOT, 'promo-mailer-studio.html')));
/* a page, so a signed-out visitor is sent to sign-in (only the sign-in page and app code are public) */
check('the page needs sign-in', access.isPublic({ method: 'GET', headers: {} }, '/mailer-performance.html') === false);

var title = (/<title>([\s\S]*?)<\/title>/.exec(page) || [])[1];
check('the title', title && title.replace(/&mdash;/g, '—') === 'Mailer performance — Oneworld 2.0', title);
check('one title, in the head', count(page, '<title>') === 1 && page.indexOf('<title>') < page.indexOf('</head>'));

var FRAME = '<iframe id="mp-frame" class="mp-frame" title="Mailer performance" src="promo-mailer-studio.html?scope=all">';
check('exactly one frame: the studio\'s dashboard for all events', count(page, FRAME) === 1 && count(page, '<iframe') === 1);
check('the frame sits in main.mp-main, after the header', /<main class="mp-main">\s*<iframe id="mp-frame"[^>]*><\/iframe>\s*<\/main>/.test(page) &&
  page.indexOf('</header>') < page.indexOf('<main class="mp-main">'));
check('the frame fills the window below the bar (contract C8)', page.indexOf('.mp-frame{display:block;width:100%;height:calc(100vh - 61px);border:0;background:#f7f8fa}') !== -1);
/* the 61px in the frame's height is the bar: 60px tall plus its 1px bottom border. If either changes, so must it */
check('the bar is 60px tall with a 1px border, as the frame\'s 61px assumes',
  /\.nav-inner\{[^}]*\bheight:60px;/.test(page) && /\.nav\{[^}]*border-bottom:1px solid/.test(page) && count(page, '- 61px)') === 2, page.match(/- \d+px\)/g));

/* scripts: the theme bootstrap (before anything paints), then theme-toggle.js, then auth.js — the page has no code
   of its own, the dashboard is the frame's */
var scripts = page.match(/<script\b[^>]*>/g) || [];
check('three scripts: the theme bootstrap, theme-toggle.js, auth.js — in that order',
  scripts.length === 3 && scripts[0] === '<script>' && scripts[1] === '<script src="theme-toggle.js">' && scripts[2] === '<script src="auth.js">', scripts);
check('the theme bootstrap runs in the head, before the styles', page.indexOf('<script>try{var t=localStorage.getItem("revamp-theme")') < page.indexOf('<style>') &&
  page.indexOf('<style>') < page.indexOf('</head>'));
check('theme-toggle.js and auth.js load at the end of the body', page.indexOf('<script src="theme-toggle.js">') > page.indexOf('</main>') &&
  page.indexOf('<script src="auth.js">') < page.indexOf('</body>'));

/* the bar: activity-log.html's header — brand, back to the events listing, the theme switch and the account menu */
var header = (/<header class="nav">([\s\S]*?)<\/header>/.exec(page) || [])[1] || '';
check('header.nav > .nav-inner', /^\s*<div class="nav-inner">/.test(header));
check('the brand goes to the events listing', /<a class="nav-brand" href="Event_Listing.html"><img [^>]*alt="ET Oneworld"><\/a>/.test(header));
var back = (/<a class="nav-back" href="Event_Listing.html"[^>]*>([\s\S]*?)<\/a>/.exec(header) || [])[1];
check('a back link to the events listing reading "Back to events"', back !== undefined && /<span class="nav-back-long">Back to events<\/span>/.test(back) &&
  /<a class="nav-back" href="Event_Listing.html" aria-label="Back to events">/.test(header), back);
check('the theme switch and the account menu, on the right', /<div class="nav-right">\s*<span data-theme-toggle-target[^>]*><\/span>\s*<span data-rv-account><\/span>\s*<\/div>/.test(header));
check('one of each', count(page, 'data-theme-toggle-target') === 1 && count(page, 'data-rv-account') === 1);
/* on a phone the words do not fit one 60px row beside the brand, the switch and the account menu: the link says
   "Events" there, and its name for screen readers stays "Back to events" */
check('on a phone the back link reads "Events"', /<span class="nav-back-short">Events<\/span>/.test(back || '') &&
  /\.nav-back-short\{ display:none; \}/.test(page) && /@media \(max-width: 480px\)\{\s*\.nav-back-long\{ display:none; \}\s*\.nav-back-short\{ display:inline; \}/.test(page));
check('dark theme defined both ways (system and the switch), and the body has its own background',
  /@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{/.test(page) && /:root\[data-theme="dark"\]\{/.test(page) && /\bbody\{ background:var\(--bg\);/.test(page));
check('the viewport is set for phones', page.indexOf('<meta name="viewport" content="width=device-width, initial-scale=1">') !== -1);

/* ---------- Event_Listing.html: the link, once, directly before "Activity log" ---------- */
var listing = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8');
var LINK = '<a class="btn btn-secondary btn-sm" href="mailer-performance.html" id="btn-mailer-performance" title="Mailer performance" aria-label="Mailer performance">';
var at = listing.indexOf(LINK), actAt = listing.indexOf('id="btn-activity-log"');
check('the events listing has the Mailer performance link once', count(listing, LINK) === 1 && count(listing, 'id="btn-mailer-performance"') === 1 &&
  count(listing, 'href="mailer-performance.html"') === 1);
check('the link comes before Activity log', at !== -1 && actAt !== -1 && at < actAt);
var block = at === -1 ? '' : listing.slice(at, listing.indexOf('</a>', at) + 4);
check('it reads "Mailers" beside a 14px stroke icon the screen reader skips; its title and accessible name are "Mailer performance"',
  /<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">/.test(block) &&
  /<\/svg>\s*Mailers\s*<\/a>$/.test(block), block);
/* the toolbar keeps one row on desktop (measured against the base commit at 1280-1920 px, with long "Showing …" lines
   and filters in use): the search box narrows, down to 180px, before the filters wrap. On a phone the right-hand
   links wrap among themselves rather than widen the page. */
var css = listing.slice(listing.indexOf('<style>'), listing.indexOf('</style>'));
check('desktop: the search box gives way (flex 1 1 180px) before the filters wrap; 290px stays its width',
  /@media \(min-width:881px\)\{ \.search-box\{ flex:1 1 180px; \} \}/.test(css) && /\.search-box\{[^}]*max-width:290px;/.test(css));
check('phones: the right-hand group may wrap and shrink', (function () {
  var m = /@media \(max-width:880px\)\{([\s\S]*?)\n  \}/.exec(css);
  return !!m && /\.toolbar-right-group\{ flex-wrap:wrap; flex-shrink:1; min-width:0; \}/.test(m[1]);
})());
check('nothing between it and the activity log\'s link but that link\'s comment',
  /^\s*<!-- the activity log across all events \(activity-log.html\) -->\s*<a class="btn btn-secondary btn-sm" href="activity-log.html" id="btn-activity-log">/.test(listing.slice(at + block.length)));
check('both sit in the toolbar\'s right-hand group', (function () {
  var g = listing.indexOf('<div class="toolbar-right-group">');
  return g !== -1 && g < at && listing.indexOf('<div class="view-toggle" id="view-toggle">', g) > actAt;
})());

if (failed) { console.error('mailer-performance-page: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('mailer-performance-page: all ' + passed + ' checks passed');
