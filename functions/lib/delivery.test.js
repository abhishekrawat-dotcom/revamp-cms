/* node functions/lib/delivery.test.js — exits 1 on the first failure it lists.
   How a finished page is sent (lib/delivery.js, lib/css-purge.js): what is written into the page, what is
   left out, what loads later, what is versioned — and that nothing the page shows or does is lost. Also the
   sign-in gate's answer for files that are not pages (lib/access.js) and the HTML compression choice
   (lib/api.js). No network, no Firebase. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var purge = require('./css-purge');
var delivery = require('./delivery');
var hooks = require('./api')._testHooks;
var access = require('./access');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function count(text, needle) { return text.split(needle).length - 1; }
var ROOT = path.join(__dirname, '..', '..');
/* other hosts' stylesheets: none can be fetched until the tests below say so */
var REMOTE = {};
delivery._testFetch(function (url, done) { done(REMOTE[url] == null ? null : REMOTE[url]); });
function hashOf(rel) { return delivery.assetVersion(rel); }
function deliver(html) { return hooks.deliverPage(html); }

/* ---------------- css-purge ---------------- */
var CSS = '@import url(https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap);' +
  '/* a note */.used{color:red}.unused{color:blue}.used .unused{x:y}.used,.gone{a:b}' +
  '.a:not(.never){c:d}#keep{e:f}#lose{g:h}div>p{i:j}[class^=fa-]{k:l}' +
  '.bad{background:background: #3ebd00;color:red}' +
  '@media (max-width:600px){.unused{m:n}.used{o:p}}@media print{.gone{q:r}}' +
  '@font-face{font-family:x;src:url(https://e.x/f.woff)}@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(1turn)}}' +
  '.q[data-x="a,b"]{s:t}.esc\\:hover{u:v}.str::after{content:"}{"}.used:hover .unused-child{w:x}';
var words = purge.wordsOf(['<div class="used q bad str">', 'el.id = "keep"; el.classList.add("a")', 'esc:hover']);
var r = purge.purgeCss(CSS, words);
ok(/\.used\{color:red\}/.test(r.css), 'purge keeps a rule whose class the page has');
ok(!/\.unused\{color:blue\}/.test(r.css), 'purge drops a rule whose class nothing names');
ok(!/\.used \.unused\{/.test(r.css), 'purge drops a rule needing one missing class');
ok(r.css.indexOf('.used{a:b}') !== -1, 'a selector list keeps only its used selectors', r.css);
ok(/\.a:not\(\.never\)\{c:d\}/.test(r.css), 'a class inside :not() is not required');
ok(r.css.indexOf('#keep{e:f}') !== -1 && r.css.indexOf('#lose') === -1, 'ids: a script-set id keeps its rule, an unknown one does not');
ok(r.css.indexOf('div>p{i:j}') !== -1 && r.css.indexOf('[class^=fa-]{k:l}') !== -1, 'tag and attribute selectors are kept');
ok(r.css.indexOf('.bad{background:background: #3ebd00;color:red}') !== -1, 'an invalid declaration is copied byte for byte (no strict parse)');
ok(r.css.indexOf('@media (max-width:600px){.used{o:p}}') !== -1, '@media keeps its used rules only', r.css);
ok(r.css.indexOf('@media print') === -1, 'an @media left empty is dropped');
ok(r.css.indexOf('@font-face{') !== -1 && r.css.indexOf('@keyframes spin{') !== -1, '@font-face and @keyframes are kept');
ok(r.css.indexOf('@import url(https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap);') === 0, '@import is kept first, its ";" inside url() not ending it', r.css.slice(0, 120));
ok(r.css.indexOf('.q[data-x="a,b"]{s:t}') !== -1, 'a comma inside an attribute value does not split the selector');
ok(r.css.indexOf('.esc\\:hover{u:v}') !== -1, 'an escaped class name is matched unescaped');
ok(r.css.indexOf('.str::after{content:"}{"}') !== -1, 'braces inside a string do not end the rule');
ok(r.css.indexOf('a note') === -1, 'comments are left out');
var all = purge.purgeCss(CSS, { has: function () { return true; } });
ok(all.dropped === 0 && all.css.indexOf('.unused{color:blue}') !== -1 && all.css.indexOf('@media print{.gone{q:r}}') !== -1, 'with every word allowed nothing is dropped');
var big = fs.readFileSync(path.join(ROOT, 'templates', '_shared', 'et-global.css'), 'utf8');
var bigAll = purge.purgeCss(big, { has: function () { return true; } });
ok(bigAll.dropped === 0 && count(bigAll.css, '{') === count(big.replace(/\/\*[\s\S]*?\*\//g, ''), '{'), 'ET\'s bundle reads end to end: every rule comes back', bigAll.css.length + ' vs ' + big.length);

/* ---------------- delivery: a template page ---------------- */
var TEMPLATE_PAGE = [
  '<!DOCTYPE html>', '<html lang="en"><head>', '<meta charset="utf-8">', '<title>T</title>',
  '<link rel="stylesheet" href="/templates/_shared/et-global.css">',
  '<link rel="stylesheet" href="/templates/_shared/et-animate.css">',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap">',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lobster:wght@400&amp;display=swap">',
  '<link rel="stylesheet" href="/templates/tech500/theme.css">',
  '<script src="/templates/_shared/et-runtime.js"></script>',
  '<link rel="icon" type="image/svg+xml" href="/assets/et-b2b-logo.svg" data-rv-head>',
  '<link rel="stylesheet" href="/templates/_shared/rv-live.css" data-rv-runtime>',
  '<style>@font-face{font-family:Mine;src:url(https://e.x/m.woff2)}@font-face{font-family:Two;font-display:optional;src:url(https://e.x/t.woff2)}</style>',
  '</head>',
  '<body style="--body-font-family:Inter, Arial"><section data-rv-section="faq" class="container-fluid row faq"><div class="faq-item"><button class="faq-question">Q</button></div></section>',
  '<script data-rv-script="faq">RevampSections.register("faq", function (s) { RevampSections.accordion(s, {}); });</script>',
  '<video poster="/__l5e/assets-v1/x/poster.jpg" preload="auto"><source src="/__l5e/assets-v1/y/film.mp4" type="video/mp4"></video>',
  '<img src="https://storage.googleapis.com/b/p.png" alt=""><img src="/assets/et-b2b-logo.svg?v=old" alt="">',
  '<script id="rv-site-config" type="application/json" data-rv-runtime>{"eventId":"x"}</script>',
  '<script src="/templates/_shared/rv-data.js" data-rv-runtime></script>',
  '<script src="/templates/_shared/rv-forms.js?v=1" data-rv-runtime></script>',
  '<script src="/templates/_shared/rv-popups.js?lang=en" data-rv-runtime></script>',
  '</body></html>'
].join('\n');
var out = deliver(TEMPLATE_PAGE);

ok(out.indexOf('href="/templates/_shared/et-global.css') === -1 && out.indexOf('<style data-rv-inline="/templates/_shared/et-global.css">') !== -1,
  'ET\'s bundle is written into the page instead of linked');
var inlined = /<style data-rv-inline="\/templates\/_shared\/et-global\.css">([\s\S]*?)<\/style>/.exec(out);
ok(inlined && inlined[1].length < 60000, 'and cut down to what the page uses', inlined && inlined[1].length);
ok(inlined && /\.container-fluid\{/.test(inlined[1]), 'a class the page uses keeps its rules (.container-fluid)');
ok(inlined && inlined[1].indexOf('@import') === -1, 'its @import lines are not left inside the block');
ok(out.indexOf('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat') !== -1 &&
   out.indexOf('Montserrat') < out.indexOf('<style data-rv-inline="/templates/_shared/et-global.css">'),
  'the bundle\'s Montserrat @import becomes a <link> in the same place, before it (same cascade order)');
ok(out.indexOf('bootstrap-icons.css') === -1, 'the icon font\'s stylesheet is left out when the page uses no icon');
ok(deliver(TEMPLATE_PAGE.replace('class="faq-question"', 'class="faq-question"><i class="bi bi-geo-alt"></i')).indexOf('bootstrap-icons.css') !== -1,
  '…and kept when it does');
ok(out.indexOf('<style data-rv-inline="/templates/_shared/et-animate.css">') !== -1 && out.indexOf('<style data-rv-inline="/templates/tech500/theme.css">') !== -1 &&
   out.indexOf('<style data-rv-inline="/templates/_shared/rv-live.css">') !== -1, 'small stylesheets of ours are written into the page');
ok(out.indexOf('Fraunces') !== -1 && out.indexOf('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces') < out.indexOf('<style data-rv-inline="/templates/tech500/theme.css">'),
  'a theme\'s own font @import is fetched by a <link> placed before it');
ok(out.indexOf('family=Inter') !== -1, 'a Google font the page names is kept');
ok(out.indexOf('family=Lobster') === -1, 'a Google font nothing on the page names is left out');
ok(count(out, 'rel="preconnect" href="https://fonts.gstatic.com" crossorigin') === 1 && out.indexOf('<meta charset="utf-8"><link rel="preconnect"') !== -1,
  'the fonts\' connections are opened early, once, right after <meta charset>');
ok(/@font-face\{font-display:swap;font-family:Mine/.test(out), 'an @font-face with no font-display gets swap');
ok(count(out, 'font-display') >= 2 && out.indexOf('font-display:swap;font-family:Two') === -1, 'one that has its own font-display keeps it');
ok(/<script data-rv-delivery>[\s\S]*?<\/script><script src="\/templates\/_shared\/et-runtime\.js\?v=[0-9a-f]{10}" defer><\/script>/.test(out),
  'the runtime loads with defer, behind a stand-in that keeps the sections\' calls');
ok(out.indexOf('src="/templates/_shared/rv-data.js?v=' + hashOf('/templates/_shared/rv-data.js') + '"') !== -1, 'our scripts are named by content hash');
ok(out.indexOf('src="/templates/_shared/rv-forms.js?v=' + hashOf('/templates/_shared/rv-forms.js') + '"') !== -1 && out.indexOf('rv-forms.js?v=1"') === -1,
  'an older ?v= is replaced by the hash');
ok(out.indexOf('src="/templates/_shared/rv-popups.js?lang=en"') !== -1, 'an address with other parameters is left as written');
ok(out.indexOf('href="/assets/et-b2b-logo.svg?v=' + hashOf('/assets/et-b2b-logo.svg') + '"') !== -1 && out.indexOf('src="/assets/et-b2b-logo.svg?v=' + hashOf('/assets/et-b2b-logo.svg') + '"') !== -1,
  'icons and pictures of ours are versioned too');
ok(out.indexOf('src="https://storage.googleapis.com/b/p.png"') !== -1, 'other hosts\' addresses are untouched');
ok(out.indexOf('/__l5e/') === -1 && /<video preload="none">/.test(out) && /<source type="video\/mp4">/.test(out),
  'media at paths this host can never serve lose that address and stop preloading', (out.match(/<video[^>]*>|<source[^>]*>/g) || []).join(' '));
ok(out.indexOf('RevampSections.register("faq"') !== -1 && out.indexOf('data-rv-section="faq"') !== -1, 'the page\'s own content and section script are untouched');
ok(deliver(out) === deliver(out) && deliver(out).indexOf('defer defer') === -1 && count(deliver(out), 'data-rv-delivery') === 1, 'delivering a delivered page adds nothing twice');

/* the runtime stays as it was when another inline script uses RevampSections while the page is read */
var other = deliver(TEMPLATE_PAGE.replace('</body>', '<script>RevampSections.editing();</script></body>'));
ok(other.indexOf('data-rv-delivery') === -1 && /et-runtime\.js\?v=[0-9a-f]{10}"><\/script>/.test(other), 'another user of RevampSections: the runtime is not deferred');
var jsonOnly = deliver(TEMPLATE_PAGE.replace('</body>', '<script type="application/json">{"RevampSections":1}</script></body>'));
ok(jsonOnly.indexOf('data-rv-delivery') !== -1, 'a data block that mentions it does not count');

/* a page with no <head> and nothing of ours comes back as it was */
ok(deliver('<p>plain</p>') === '<p>plain</p>', 'a page with nothing to do is sent unchanged');
/* an AI-designed preview: every theme's fonts stay (the switcher names them) */
var GEN = '<html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400&display=swap">' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400&display=swap"></head><body style="--body-font-family:\'Work Sans\'">x' +
  '</body></html>';
ok(deliver(GEN).indexOf('Montserrat') === -1 && deliver(GEN).indexOf('family=Work+Sans') !== -1, 'live: an unused theme font is left out, the chosen one kept');
var GEN_PREVIEW = GEN.replace('</body>', '<script type="application/json" id="rv-themes">{"themes":[{"headingFont":"Montserrat"}]}</script></body>');
ok(deliver(GEN_PREVIEW).indexOf('family=Montserrat') !== -1, 'preview: a font the theme switcher names is kept');

/* ---------------- other hosts' stylesheets, written in once fetched ---------------- */
var MONT = 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap';
var INTER = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap';
var BI = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css';
var biRules = '';
for (var k = 0; k < 2500; k++) biRules += '.bi-unused-' + k + '::before{content:"\\f' + (100 + k) + '"}';
REMOTE[MONT] = '@font-face{font-family:Montserrat;font-display:swap;src:url(https://fonts.gstatic.com/s/m.woff2) format("woff2")}';
REMOTE[INTER] = '@font-face{font-family:Inter;font-display:swap;src:url(https://fonts.gstatic.com/s/i.woff2) format("woff2")}';
REMOTE['https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&display=swap'] = '@font-face{font-family:Fraunces;src:url(https://fonts.gstatic.com/s/f.woff2)}';
REMOTE[BI] = '@font-face{font-display:block;font-family:"bootstrap-icons";src:url("./fonts/bootstrap-icons.woff2?x") format("woff2")}' +
  '.bi::before,[class^="bi-"]::before{font-family:bootstrap-icons!important}' + biRules + '.bi-geo-alt::before{content:"\\f3e8"}';
var asked = [];
delivery._testFetch(function (url, done) { asked.push(url); done(REMOTE[url] == null ? null : REMOTE[url]); });
var ICON_PAGE = TEMPLATE_PAGE.replace('class="faq-question"', 'class="faq-question"><i class="bi bi-geo-alt"></i').replace('</head>', '<link rel="stylesheet" href="https://example.com/x.css"></head>');
var remote = deliver(ICON_PAGE);
ok(remote.indexOf('<style data-rv-remote="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap">@font-face{font-family:Inter') !== -1 &&
   remote.indexOf('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter') === -1, 'a Google Fonts sheet this server has is written into the page');
ok(/<style data-rv-remote="https:\/\/fonts\.googleapis\.com\/css2\?family=Montserrat[^"]*">@font-face\{font-family:Montserrat/.test(remote) &&
   remote.indexOf('family=Montserrat') < remote.indexOf('<style data-rv-inline="/templates/_shared/et-global.css">'), '…an @import of one too, in its place');
var biBlock = /<style data-rv-remote="https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap-icons@1\.11\.3\/font\/bootstrap-icons\.css">([\s\S]*?)<\/style>/.exec(remote);
ok(biBlock && biBlock[1].indexOf('.bi-geo-alt::before') !== -1 && biBlock[1].indexOf('bi-unused-7') === -1, 'the icon sheet is written in, cut down to the icons the page uses');
ok(biBlock && biBlock[1].indexOf('url("https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2?x")') !== -1, 'its relative font address now points at its own host');
ok(remote.indexOf('<link rel="stylesheet" href="https://example.com/x.css">') !== -1 && asked.indexOf('https://example.com/x.css') === -1, 'any other host is neither fetched nor changed');
ok(remote.indexOf('rel="preconnect" href="https://fonts.googleapis.com"') === -1 && remote.indexOf('rel="preconnect" href="https://fonts.gstatic.com" crossorigin') !== -1,
  'with every font sheet written in, only the font files\' host is preconnected');
ok(remote.indexOf('family=Lobster') === -1, 'an unused family is still left out, not fetched');
REMOTE[INTER] = null;
delivery._testFetch(function (url, done) { done(REMOTE[url] == null ? null : REMOTE[url]); });
var failed = deliver(ICON_PAGE);
ok(failed.indexOf('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap">') !== -1 &&
   failed.indexOf('rel="preconnect" href="https://fonts.googleapis.com"') !== -1, 'a sheet that could not be fetched stays a <link>, and its host is preconnected');
var pending = null;
delivery._testFetch(function (url, done) { if (url === INTER) pending = done; else done(REMOTE[url] == null ? null : REMOTE[url]); });
REMOTE[INTER] = '@font-face{font-family:Inter;src:url(https://fonts.gstatic.com/s/i2.woff2)}';
var during = deliver(ICON_PAGE);
ok(during.indexOf('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter') !== -1 && typeof pending === 'function', 'nothing waits for a fetch: the page goes out with the <link>');
pending(REMOTE[INTER]);
ok(deliver(ICON_PAGE).indexOf('src:url(https://fonts.gstatic.com/s/i2.woff2)') !== -1, '…and the next page served after it arrives has it written in');
/* /e/'s page cache (lib/api.js): a page cached while its sheet was still on its way is delivered again once it is here */
var LATE = 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&display=swap', latePending = null;
var LATE_PAGE = ICON_PAGE.replace('family=Inter:wght@400;700', 'family=Fraunces:wght@400;700');
delivery._testFetch(function (url, done) { if (url === LATE) latePending = done; else done(REMOTE[url] == null ? null : REMOTE[url]); });
var cachedEntry = hooks.cachePage('qa-late|1|t|v:off', LATE_PAGE);
ok(cachedEntry.html.indexOf('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces') !== -1 && typeof latePending === 'function', 'cached while the sheet is on its way: with its <link>');
var packedBefore = cachedEntry.packed.gzip;
ok(hooks.cachedPage('qa-late|1|t|v:off').packed.gzip === packedBefore, 'nothing new arrived: the cached page as it was (not compressed again)');
latePending('@font-face{font-family:Fraunces;src:url(https://fonts.gstatic.com/s/f1.woff2)}');
var relivered = hooks.cachedPage('qa-late|1|t|v:off');
ok(relivered && relivered.html.indexOf('src:url(https://fonts.gstatic.com/s/f1.woff2)') !== -1 && relivered.html.indexOf('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces') === -1 &&
   require('zlib').gunzipSync(relivered.packed.gzip).toString('utf8') === relivered.html, '…and once it arrives, the cached page has it written in (compressed copies redone)');
delivery._testFetch(function (url, done) { done(REMOTE[url] == null ? null : REMOTE[url]); });
ok(delivery.absoluteUrls('a{b:url(x.png)}c{d:url("data:x")}e{f:url(\'/y\')}', 'https://h.example/p/q.css') === 'a{b:url(https://h.example/p/x.png)}c{d:url("data:x")}e{f:url(\'https://h.example/y\')}',
  'relative addresses in a fetched sheet resolve against it');
delivery._testFetch(function (url, done) { done(null); });

/* ---------------- the stand-in for the runtime ---------------- */
function stubRun(after) {
  var listeners = {}, scriptAttr = 'banner';
  var doc = { currentScript: { getAttribute: function () { return scriptAttr; } }, addEventListener: function (n, f) { listeners[n] = f; } };
  var ctx = { window: {}, document: doc, console: { error: function () { ctx.errors++; } }, errors: 0 };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(/<script data-rv-delivery>([\s\S]*?)<\/script>/.exec(delivery.RUNTIME_STUB)[1], ctx);
  ctx.RevampSections.register('faq', 'F');
  ctx.RevampSections.widget('et-banner', 'B');
  doc.currentScript = null;
  ctx.RevampSections.widget('et-banner', 'X');
  after(ctx);
  if (listeners.DOMContentLoaded) listeners.DOMContentLoaded();
  return ctx;
}
var seen = [];
var stubbed = stubRun(function (ctx) {
  ok(ctx.RevampSections.q.length === 2 && ctx.RevampSections.q[1][0] === 'banner', 'the stand-in keeps register and widget calls with their section');
  ok(ctx.errors === 1, 'a widget with no section is reported, as the runtime does');
  ctx.RevampSections = { register: function (t, f) { seen.push(t + ':' + f); } };                        // an older runtime
});
ok(seen.join() === 'faq:F,banner:B', 'an older runtime that ignores the queue is handed it when the page has loaded', seen.join());
seen = [];
stubRun(function (ctx) {
  var q = ctx.RevampSections.q;
  ctx.RevampSections = { register: function (t, f) { seen.push(t + ':' + f); } };
  q.splice(0).forEach(function (c) { ctx.RevampSections.register(c[0], c[1]); });                           // this runtime: takes them over
});
ok(seen.join() === 'faq:F,banner:B', 'a runtime that took the queue over gets each call once', seen.join());
var rt = fs.readFileSync(path.join(ROOT, 'templates', '_shared', 'et-runtime.js'), 'utf8');
ok(/var waiting = window\.RevampSections && window\.RevampSections\.q;/.test(rt) && /waiting\.splice\(0\)\.forEach\(function \(call\) \{ register\(call\[0\], call\[1\]\); \}\)/.test(rt),
  'et-runtime.js takes the stand-in\'s calls over');

/* ---------------- compression choice (lib/api.js) ---------------- */
function enc(v) { return hooks.acceptedEncoding({ headers: { 'accept-encoding': v } }); }
ok(enc('gzip, deflate, br') === 'br' && enc('gzip') === 'gzip' && enc('') === '' && enc('br;q=0, gzip') === 'gzip' && enc('identity') === '' && enc('gzip;q=0') === '',
  'brotli when accepted, else gzip, never one refused with q=0');

/* ---------------- the gate's answer for files that are not pages ---------------- */
function gateAnswer(url) {
  var res = { status: 0, headers: null, body: '', writeHead: function (s, h) { this.status = s; this.headers = h; }, end: function (b) { this.body = b || ''; } };
  var passed = false;
  access.gate({ url: url, headers: {} }, res, function () { passed = true; });
  return passed ? 'next' : res.status + (res.headers && res.headers.Location ? ' ' + res.headers.Location : '');
}
ok(gateAnswer('/__l5e/assets-v1/x/film.mp4') === '404', 'signed out, a file that is not a page: 404, not the sign-in page', gateAnswer('/__l5e/assets-v1/x/film.mp4'));
ok(gateAnswer('/.well-known/ai-catalog.json') === '404' && gateAnswer('/sitemap-old.xml') === '404', '…a .well-known or other .xml file the same');
ok(gateAnswer('/sitemap.xml') === 'next' && gateAnswer('/robots.txt') === 'next', '/sitemap.xml and /robots.txt are public (lib/site-seo.js)');
ok(/^302 \/\?next=/.test(gateAnswer('/Event_Listing.html')) && /^302 /.test(gateAnswer('/dashboard')) && /^302 /.test(gateAnswer('/preview/x.y')), 'pages still go to sign-in');
ok(gateAnswer('/api/events') === '401', 'the API still answers 401');
ok(gateAnswer('/templates/_shared/et-runtime.js?v=abc') === 'next' && gateAnswer('/e/some-event') === 'next', 'public files and published pages pass');

if (failures.length) {
  console.error('delivery: ' + failures.length + ' of ' + checks + ' checks failed');
  failures.forEach(function (f) { console.error('  ✗ ' + f); });
  process.exit(1);
}
console.log('delivery: all ' + checks + ' checks passed');
