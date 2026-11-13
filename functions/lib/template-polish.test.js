/* node functions/lib/template-polish.test.js — exits 1 on the first failure it lists.
   The four real templates and the shared files of a published site, launch-check polish (13 Nov 2026):
     1 TPL-053  ETB2B's scroll reveal hides a block only under html.rv-anim (set by et-runtime.js, early by the served
                page's stand-in, by the common script of a section copied onto another website); reduced motion
                shows every block at once
     2 TPL-054  a keyboard focus ring on links, buttons, summaries and focusable elements
     3 TPL-057  the brand colours of retail, cx and making-ai-work read the theme colour (the accent too)
     4 TPL-059 / 060 / 061  the marquee, the power chain on a tablet and a phone, small layout faults
     5 TPL-062  the template preview page
     6 TPL-048  retail: no decorative arrows, one model exhibitor category, its figures marked samples
   The browser check (four templates at 1280, 768 and 390 px, motion on and off) is the run that goes with it.
   No network, no Firebase. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : '')); }

/* ---------- 1. motion: hidden only under html.rv-anim ---------- */
var ANIM = read('templates/_shared/et-animate.css');
var rules = ANIM.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) || [];
var hiding = rules.filter(function (r) { return /opacity:0/.test(r.split('{')[1]) && !/^\s*(from|to|\d+%)/.test(r) && !/@keyframes/.test(r); });
ok(hiding.length >= 4, '1.1 et-animate.css still has the hidden start states', hiding.length);
hiding.forEach(function (r) {
  var sels = r.split('{')[0].split(',').map(function (s) { return s.trim(); });
  ok(sels.every(function (s) { return /^html\.rv-anim /.test(s); }), '1.2 a hidden start state holds only under html.rv-anim: ' + sels[0], r.slice(0, 160));
});
ok(/@media \(prefers-reduced-motion: reduce\)\{\.animated,html\.rv-anim \.animated\{opacity:1!important;[^}]*transform:none!important;[^}]*animation:none!important\}\}/.test(ANIM),
  '1.3 reduced motion: every .animated block shown at once, still (in both weights)');
ok(/\.fadeInUp\.go\{animation-name:fadeInUp/.test(ANIM) && /@keyframes fadeInUp/.test(ANIM), '1.4 the reveal itself is as it was');
var RUNTIME = read('templates/_shared/et-runtime.js');
ok(/if \(!editing\(\)\) document\.documentElement\.classList\.add\('rv-anim'\);/.test(RUNTIME), '1.5 et-runtime.js sets html.rv-anim as it runs (never while editing)');
ok(RUNTIME.indexOf("classList.add('rv-anim')") < RUNTIME.indexOf('function reveal(root)'), '1.6 … before any reveal');
/* the served page's stand-in: the class from <head>, gone again when the runtime never arrives */
var delivery = require('./delivery');
var stubSrc = /^<script data-rv-delivery>([\s\S]*?)<\/script>$/.exec(String(delivery.RUNTIME_STUB || ''));
ok(!!stubSrc, '1.7 the served page\'s stand-in is one inline script', delivery.RUNTIME_STUB);
if (stubSrc) {
  function runStub(arrives) {
    var classes = {}, onload = null;
    var w = { addEventListener: function (t, f) { if (t === 'load') onload = f; }, console: console };
    var d = { documentElement: { classList: { add: function (c) { classes[c] = 1; }, remove: function (c) { delete classes[c]; } } }, addEventListener: function () {}, currentScript: null };
    vm.runInNewContext(stubSrc[1], { window: w, document: d, console: console });
    var early = !!classes['rv-anim'];
    if (arrives) w.RevampSections = { register: function () {} };
    if (onload) onload();
    return { early: early, after: !!classes['rv-anim'] };
  }
  var fine = runStub(true), failed = runStub(false);
  ok(fine.early && fine.after, '1.8 the stand-in sets html.rv-anim at once, and it stays when the runtime arrives', fine);
  ok(failed.early && !failed.after, '1.9 … and takes it off once the page has loaded without the runtime: everything shows', failed);
}
/* a section copied onto another website (Developer zone › Copy for another website) */
var EXPORT = read('editor-dev-export.js');
ok(/var RUNTIME_HTML = \/\^\(html\|:root\|\\\.rv-motion\|\\\.rv-anim\|/.test(EXPORT), '1.10 the copy keeps html.rv-anim in a rule\'s <html> part (the runtime sets it on the other website too)');
ok((EXPORT.match(/d\.documentElement\.classList\.add\('rv-motion', 'rv-anim'\)/g) || []).length === 2, '1.11 the page the rules are tried on has html.rv-anim, as a visitor\'s has');
var win = {};
vm.runInNewContext(EXPORT, { window: win, URL: URL, JSON: JSON, Math: Math, RegExp: RegExp, String: String, Array: Array, Object: Object, Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout });
var T = win.RevampDevExport && win.RevampDevExport._test;
function runCommon(scripts, runtimeComes, done) {
  var classes = {}, sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, addEventListener: function () {} };
  var root = { classList: { add: function (c) { classes[c] = 1; }, remove: function (c) { delete classes[c]; }, contains: function (c) { return !!classes[c]; } },
    style: { getPropertyValue: function () { return ''; }, setProperty: function () {}, removeProperty: function () {} }, setAttribute: function () {}, firstChild: null, insertBefore: function () {},
    appendChild: function (n) { setTimeout(function () { if (runtimeComes) sb.RevampSections = { init: function () {} }; (runtimeComes ? n.onload : n.onerror)(); }, 2); } };
  sb.document = { readyState: 'complete', head: root, documentElement: root, createElement: function () { return { setAttribute: function () {} }; }, addEventListener: function () {},
    getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; } };
  sb.window = sb;
  vm.runInContext(T.commonJs({ title: 'QA', pageUrl: 'https://cms.example/e/qa', scripts: scripts }), vm.createContext(sb));
  var early = !!classes['rv-anim'];
  setTimeout(function () { done(early, !!classes['rv-anim']); }, 40);
}
var pending = 2;
function finish() { if (--pending) return; report(); }
var RT = [{ src: 'https://cms.example/templates/_shared/et-runtime.js', global: 'RevampSections' }];
runCommon(RT, true, function (early, after) {
  ok(early && after, '1.12 the copy\'s common script sets html.rv-anim at once and keeps it once the runtime has come (the reveal still runs there)', [early, after]);
  finish();
});
runCommon(RT, false, function (early, after) {
  ok(early && !after, '1.13 … and takes it off when the runtime did not come: the copied sections still show', [early, after]);
  finish();
});

/* ---------- 2. keyboard focus ---------- */
var PLATFORM = read('templates/_shared/et-platform.css');
ok(/:where\(html:not\(\[data-rv-editing\]\)\) a:focus-visible,\s*:where\(html:not\(\[data-rv-editing\]\)\) button:focus-visible,\s*:where\(html:not\(\[data-rv-editing\]\)\) summary:focus-visible,\s*:where\(html:not\(\[data-rv-editing\]\)\) :where\(\[tabindex\]:not\(\[tabindex="-1"\]\)\):focus-visible\{\s*outline:2px solid currentColor;\s*outline-offset:2px;\s*\}/.test(PLATFORM),
  '2.1 et-platform.css: a 2px ring in the text colour on keyboard focus (links, buttons, summaries, focusable elements), never while editing');
['tech500', 'retail-leadership-summit', 'cx-leaders-forum', 'making-ai-work'].forEach(function (id) {
  var shared = JSON.parse(read('templates/' + id + '/template.json')).shared || [];
  ok(shared.indexOf('et-platform.css') > shared.indexOf('et-global.css') && shared.indexOf('et-global.css') !== -1, '2.2 ' + id + ': et-platform.css comes after the bundle\'s a:focus{outline:0}, which it follows', shared);
});

/* ---------- 3. theme colour ---------- */
/* the banner is left out: its scrim and its words' shadow keep their own dark colour, which keeps the words readable
   over any picture whatever the theme colour */
function cssOf(id) {
  var out = read('templates/' + id + '/theme.css');
  fs.readdirSync(path.join(ROOT, 'templates', id, 'sections')).forEach(function (s) {
    if (s === 'banner') return;
    var p = path.join(ROOT, 'templates', id, 'sections', s, 'style.css');
    if (fs.existsSync(p)) out += '\n' + fs.readFileSync(p, 'utf8');
  });
  return out.replace(/\/\*[\s\S]*?\*\//g, '');
}
[['retail-leadership-summit', /#ff927a|255,\s*146,\s*122/i, '#FF927A'], ['making-ai-work', /#186bf9|24,\s*107,\s*249/i, '#186BF9'], ['cx-leaders-forum', /#071912|7,\s*25,\s*18/i, '#071912']].forEach(function (c) {
  var css = cssOf(c[0]);
  var literal = css.split('\n').filter(function (l) { return c[1].test(l) && !/--theme-color(-hex)?\s*:/.test(l) && !/var\(--theme-color, /.test(l); });
  ok(literal.length === 0, '3.1 ' + c[0] + ': the brand colour ' + c[2] + ' is read from the theme colour wherever it is drawn', literal.join(' | '));
  ok((css.match(/var\(--theme-color, /g) || []).length >= (c[0] === 'cx-leaders-forum' ? 2 : 5), '3.2 ' + c[0] + ': … with the colour itself as fallback, so the default look is unchanged');
});
var CX = cssOf('cx-leaders-forum');
ok(!/#de3d61|222,?\s*61,?\s*97/i.test(CX.replace(/var\(--accent-color, #DE3D61\)/g, '')), '3.3 cx: the pink accent reads --accent-color', CX.match(/.{40}#de3d61.{10}/i));
ok(/#who-should-attend \.circul_point \[stroke="#E81F3D" i\] \{\s*stroke: var\(--accent-color, #E81F3D\);/.test(CX), '3.4 cx: the bullets\' SVG ring (stroke="#E81F3D") follows it too');
var CANVAS = read('editor-canvas.js');
ok(/if \(!generated && body\.classList\.contains\('microsite'\)\) body\.style\.setProperty\('--accent-color', hex\);/.test(CANVAS), '3.5 the editor\'s theme colour sets --accent-color on a real template (not an AI-designed site, which has its own)');
['tech500', 'retail-leadership-summit', 'cx-leaders-forum', 'making-ai-work'].forEach(function (id) {
  ok(/\bmicrosite\b/.test(JSON.parse(read('templates/' + id + '/template.json')).body.class), '3.6 ' + id + ': <body class="microsite">, which the editor knows a real template by');
});

/* ---------- 4. small faults ---------- */
var MARQUEE = read('templates/making-ai-work/sections/fact-marquee/style.css');
ok(/@media \(prefers-reduced-motion:reduce\)\{\s*#fact-marquee \.marquee-content\{animation:none;[^}]*\}\s*#fact-marquee \.marquee-wrapper\{overflow-x:auto;/.test(MARQUEE), '4.1 making-ai-work marquee: still for reduced motion, scrolled by hand');
var CHAIN = read('templates/tech500/sections/power-chain/style.css');
var tablet = /@media \(max-width: 991px\) \{\s*#power-chain \.power-chain-journey \{[^}]*overflow: visible;[\s\S]*?#power-chain \.power-chain-track \{[^}]*display: flex;[^}]*flex-wrap: wrap;[^}]*justify-content: center;[^}]*min-width: 0;[\s\S]*?#power-chain \.power-chain-item \{\s*flex: 0 0 calc\(\(100% - 24px\) \/ 3\);[\s\S]*?#power-chain \.power-chain-track::before,\s*#power-chain \.power-chain-item:not\(:last-child\)::after \{\s*display: none;/;
ok(tablet.test(CHAIN), '4.2 tech500 power chain below 992px: every role in view, three to a row, the joining line and dots gone');
ok(/@media \(max-width: 599px\) \{\s*#power-chain \.power-chain-item \{\s*flex-basis: calc\(\(100% - 12px\) \/ 2\);/.test(CHAIN) && CHAIN.lastIndexOf('max-width: 991px') > CHAIN.lastIndexOf('max-width: 479px'),
  '4.3 … two to a row on a phone, and these rules come after the strip\'s own');
var MAWT = read('templates/making-ai-work/theme.css');
ok(/\.page_hdng4 h2\{\s*font-variant-numeric[^}]*line-height:1\.15;/.test(MAWT) && !/line-height:90%/.test(MAWT) && /\.page_hdng4 h2\{font-size:32px;line-height:1\.15\}/.test(MAWT), '4.4 making-ai-work headings: line-height 1.15, a two-line heading no longer overlaps itself');
ok(/@media \(max-width: 600px\) \{\s*#events-wdgt \.events-wdgt-box \{ width: 100%; \}/.test(read('templates/retail-leadership-summit/sections/awaits/style.css')), '4.5 retail awaits: one card to a row at 600px and below');
var STATS = read('templates/cx-leaders-forum/sections/stats-3/style.css');
ok(/@media screen and \(max-width: 767px\) \{[\s\S]*#stats-3 \.row \{\s*justify-content: center;[\s\S]*#stats-3 \.stat-box:nth-child\(2n\+1\) \{\s*border-left: 0;/.test(STATS), '4.6 cx stats: the third stat centred on its row, no divider before the first of a row');

/* ---------- 5. the template preview page ---------- */
var PREVIEW = read('templates/preview.html');
ok(/var REAL = \['tech500', 'retail-leadership-summit', 'cx-leaders-forum', 'making-ai-work'\];/.test(PREVIEW) && /if \(REAL\.indexOf\(id\) === -1\) \{ notFound\(\); return; \}/.test(PREVIEW), '5.1 only the four real templates');
ok(/\/\^gen-\(\[a-z0-9\]\[a-z0-9-\]\{0,79\}\)\$\/\.exec\(id\)/.test(PREVIEW) && /location\.replace\('\/preview\/' \+ encodeURIComponent\(gen\[1\]\)\)/.test(PREVIEW), '5.2 ?t=gen-<event> goes to /preview/<event>');
ok(/document\.body\.textContent = 'This template could not be found\.';/.test(PREVIEW) && !/Could not load template/.test(PREVIEW), '5.3 a plain message when it cannot be shown');
ok(!/editor-canvas\.js|editor-fill\.js|RevampCanvas|RevampFill|\/api\/draft/.test(PREVIEW) && /<script src="_shared\/template-loader\.js"><\/script>/.test(PREVIEW), '5.4 no editor scripts, no draft request: the loader only');
function previewRun(t) {
  var said = { replaced: null, text: null, built: null };
  var body = { style: {}, set textContent(v) { said.text = v; } };
  var ctx = { URLSearchParams: URLSearchParams, location: { search: t == null ? '' : '?t=' + encodeURIComponent(t), replace: function (u) { said.replaced = u; } },
    document: { body: body, title: '', open: function () {}, write: function () {}, close: function () {} }, window: {}, console: console,
    RevampTemplates: { build: function (id) { said.built = id; return { then: function () { return { catch: function () {} }; } }; } } };
  vm.runInNewContext(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/.exec(PREVIEW)[1], ctx);
  return said;
}
var p1 = previewRun('gen-agentic-ai-2027'), p2 = previewRun('tech500-check'), p3 = previewRun('making-ai-work'), p4 = previewRun(null), p5 = previewRun('gen-../x');
ok(p1.replaced === '/preview/agentic-ai-2027' && !p1.built, '5.5 run: gen- goes to the event\'s preview', p1);
ok(p2.text === 'This template could not be found.' && !p2.built && !p2.replaced, '5.6 run: any other id is not found', p2);
ok(p3.built === 'making-ai-work' && p4.built === 'tech500', '5.7 run: a real template is built (tech500 when none is named)', [p3, p4]);
ok(p5.text === 'This template could not be found.' && !p5.replaced, '5.8 run: a gen- id that is not an event id goes nowhere', p5);

/* ---------- 6. retail ---------- */
var PRI = read('templates/retail-leadership-summit/sections/priorities/index.html'), PRICSS = read('templates/retail-leadership-summit/sections/priorities/style.css');
ok(PRI.indexOf('action-icon') === -1 && /#agenda-highlights \.action-icon \{ display: none; \}/.test(PRICSS) && PRICSS.indexOf('file_17599212185587') === -1, '6.1 retail discussion points: no decorative arrows (and none on a page saved with them)');
var EXH = read('templates/retail-leadership-summit/sections/exhibitors/index.html');
ok((EXH.match(/class="accordion-bx"/g) || []).length === 1 && /<div class="accordion-bx" data-rv-sample>/.test(EXH) && />Exhibitor category</.test(EXH) && !/Retail Tech Solutions|Payment Solutions/.test(EXH),
  '6.2 retail exhibitors: one neutral model category, marked a sample (the wizard\'s list makes one card per category)');
var STATSR = read('templates/retail-leadership-summit/sections/stats/index.html');
ok((STATSR.match(/<section data-rv-sample>/g) || []).length === 5, '6.3 retail figures not filled in are marked samples (TPL-051), so the check before publishing holds them back');
var RT_MAP = JSON.parse(read('templates/retail-leadership-summit/template.json')).content.map;
ok(RT_MAP.some(function (m) { return m.from === 'exhibitors' && m.fill.some(function (r) { return r.list === '.accordion-bx' && r.items === 'exhibitors.items'; }); }) &&
  RT_MAP.some(function (m) { return m.from === 'stats' && m.fill.some(function (r) { return r.items === 'stats.items'; }); }), '6.4 … both still filled from Create Event');

function report() {
  if (failures.length) {
    console.error('template-polish: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('template-polish: all ' + checks + ' checks passed');
}
