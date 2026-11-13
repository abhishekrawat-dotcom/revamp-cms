// node functions/lib/editor-dev-export.test.js — the Developer zone's "Copy for another website" (editor-dev-export.js;
// the owner, 12 Nov 2026: "the html, css & js of this sections are not working properly in our another backend").
//   1 reading selectors: top-level splits, compounds and combinators, simple selectors, the form tried on a page
//     with nothing hovered or opened yet
//   2 CSS values: full addresses for url(…), rem as px, the variables and fonts a text uses
//   3 the reset: the other website's rules for plain elements stop at the wrapper; SVG, pictures and what the
//     runtimes add are left out — and that list is in step with what et-runtime.js and rv-popups.js make
//   4 the script: it parses, loads each runtime once however many sections a page has, waits for its section, starts
//     it, runs the section's own script once with `section` (and this) as the section, and gives the runtimes' rules
//     the wrapper's weight
//   5 the site editor: the Developer zone's two views, the copy made from the page staged as a visitor gets it, the
//     buttons; the file is loaded and served
//   6 rv-popups.js on another website: its links and pages are EventSphere's, its sizes in px
//   7 ES5
// The whole thing on a real page — copied, pasted into another website and compared with the preview — is the
// browser check (work-section-code/v1.js). No network, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var SRC = read('editor-dev-export.js');
var UI = read('editor-template-ui.js');
var PAGE = read('custom_editor.html');
var RUNTIME = read('templates/_shared/et-runtime.js');
var POPUPS = read('templates/_shared/rv-popups.js');
var passed = 0, failed = 0;
function show(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + show(detail) : ''));
}

var win = {};
vm.runInNewContext(SRC, { window: win, URL: URL, JSON: JSON, Math: Math, RegExp: RegExp, String: String, Array: Array, Object: Object, Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout });
var X = win.RevampDevExport, T = X && X._test;
check('0 RevampDevExport is there with build, loadPage and its helpers', !!(X && typeof X.build === 'function' && typeof X.loadPage === 'function' && T));

/* ======================= 1 reading selectors ======================= */
(function () {
  check('1.1 a selector list split at its own commas only', show(T.splitTop('h1, .a:is(.b, .c) > p, [title="x,y"], a::before', ',')) === show(['h1', '.a:is(.b, .c) > p', '[title="x,y"]', 'a::before']), T.splitTop('h1, .a:is(.b, .c) > p, [title="x,y"], a::before', ','));
  var c = T.compoundsOf('body.rv-generated  >  [data-rv-section] .card + li ~ :nth-child(2n+1)');
  check('1.2 compounds and their combinators', show(c) === show({ parts: ['body.rv-generated', '[data-rv-section]', '.card', 'li', ':nth-child(2n+1)'], combs: ['>', ' ', '+', '~'] }), c);
  check('1.3 joined back as they were', T.joinCompounds(c.parts, c.combs) === 'body.rv-generated > [data-rv-section] .card + li ~ :nth-child(2n+1)', T.joinCompounds(c.parts, c.combs));
  check('1.4 a "+" or "~" inside brackets or an attribute is not a combinator', show(T.compoundsOf('a[class~="x"]:nth-child(3n+2) b').parts) === show(['a[class~="x"]:nth-child(3n+2)', 'b']));
  var s = T.simplesOf('div.x#y[data-a="b.c"]:not(.z, .w)::before');
  check('1.5 the simple selectors of a compound', show(s) === show(['div', '.x', '#y', '[data-a="b.c"]', ':not(.z, .w)', '::before']), s);
  var known = function (c) { return ['card', 'pe-spk-card'].indexOf(c) !== -1; };
  check('1.6 pseudo-elements and hover / focus / open left out to try a selector', T.testable('.card:hover::before', known) === '.card' && T.testable('a:focus-visible > span::after', known) === 'a > span', [T.testable('.card:hover::before', known), T.testable('a:focus-visible > span::after', known)]);
  check('1.7 a class nothing has yet (a script adds it) left out where the compound says more', T.testable('[data-rv-reveal].rv-in', known) === '[data-rv-reveal]' && T.testable('.card.is-active', known) === '.card', [T.testable('[data-rv-reveal].rv-in', known), T.testable('.card.is-active', known)]);
  check('1.8 …but a selector that is only an unknown class stays as it is (it reaches nothing here)', T.testable('.other-sections-card', known) === '.other-sections-card');
  check('1.9 a compound that was only a pseudo-element becomes *', T.testable('::selection', known) === '*' && T.testable('.card ::placeholder', known) === '.card *');
})();

/* ======================= 2 CSS values ======================= */
(function () {
  var base = 'https://h.example/templates/tech500/css/style.css';
  check('2.1 url(…) relative to its stylesheet becomes a full address; data:, # and full ones are left', T.absoluteUrls('a{background:url(../img/a.png)} b{background:url("data:image/png;base64,AA")} c{mask:url(#m)} d{background:url(\'https://x.y/z.png\')}', base) ===
    'a{background:url("https://h.example/templates/tech500/img/a.png")} b{background:url("data:image/png;base64,AA")} c{mask:url(#m)} d{background:url(\'https://x.y/z.png\')}', T.absoluteUrls('a{background:url(../img/a.png)}', base));
  check('2.2 rem as px (16 to the rem), in clamp() and negative', T.remToPx('a{font-size:.875rem;margin:-0.5rem 0 clamp(1.75rem,3vw,2.375rem)}', 16) === 'a{font-size:14px;margin:-8px 0 clamp(28px,3vw,38px)}', T.remToPx('a{font-size:.875rem;margin:-0.5rem 0 clamp(1.75rem,3vw,2.375rem)}', 16));
  check('2.3 …never inside a word or a name', T.remToPx('.x2rem{--gap-1rem:1;}', 16) === '.x2rem{--gap-1rem:1;}', T.remToPx('.x2rem{--gap-1rem:1;}', 16));
  check('2.4 the variables a text uses, once each', show(T.varsUsed('a{color:var(--rv-text);background:var( --rv-bg , var(--rv-text))}')) === show(['--rv-text', '--rv-bg']));
  check('2.5 the font families a text names (quoted, in variables too)', show(T.familiesUsed('h1{font-family:"Fraunces", Arial, serif}--heading-font-family:"Work Sans", sans-serif;')) === show(['fraunces', 'arial', 'serif', 'work sans', 'sans-serif']), T.familiesUsed('h1{font-family:"Fraunces", Arial, serif}--heading-font-family:"Work Sans", sans-serif;'));
  check('2.5a …and in a variable whose name only has "font" in it (a template\'s --heading-font-family-v2)', T.familiesUsed('--heading-font-family-v2:"Fraunces", serif;').indexOf('fraunces') !== -1, T.familiesUsed('--heading-font-family-v2:"Fraunces", serif;'));
  check('2.6 the families a Google Fonts address loads', show(T.fontFamiliesOfUrl('https://fonts.googleapis.com/css2?family=Fraunces:wght@300;400&family=Work+Sans:wght@400&display=swap')) === show(['fraunces', 'work sans']));
  check('2.8 every selector begins with .rv-embed and the weight of four ids (ETB2B\'s pages use up to three)', /var WEIGHT = ':not\(#_#_#_#_\)';/.test(SRC) && /var SCOPE = '\.rv-embed' \+ WEIGHT;/.test(SRC));
  check('2.9 every declaration !important (as ETB2B\'s CMS sections are written), strings and brackets kept whole, comments gone', T.important('color: red; background: url("a;b.png") no-repeat; --x: calc(1px + 2px);margin:0 !important;/* c */ font: 12px/1.2 "A;B", serif') ===
    'color: red !important; background: url("a;b.png") no-repeat !important; --x: calc(1px + 2px) !important; margin:0 !important; font: 12px/1.2 "A;B", serif !important;', T.important('color: red; background: url("a;b.png") no-repeat;'));
  check('2.9a …but not inside @layer: an important declaration in a layer would outweigh the section\'s own (the picture default, rv-pictures)', /function written\(b\) \{ return ctx\.inLayer \? absoluteUrls\(b, base\) : important\(absoluteUrls\(b, base\)\); \}/.test(SRC) && /var inner = \[\], layer = \/\^@layer\\b\/i\.test\(head\);/.test(SRC));
  check('2.10 each box with its own tags, as the CMS puts it on the page; nothing stays nothing', T.styleBox('a{}') === '<style>\na{}\n</style>' && T.scriptBox('x()') === '<script>\nx()\n</script>' && T.scriptBox('') === '' && T.styleBox('a{content:"</style>"}').indexOf('</style>"') === -1);
  check('2.7 the wrapper\'s id is a safe one', T.scopeId('previous-speakers') === 'rv-embed-previous-speakers' && T.scopeId('a b"c') === 'rv-embed-a-b-c' && T.scopeId('') === 'rv-embed-section');
})();

/* ======================= 2b a rule the browser cannot give back ======================= */
(function () {
  // run in a context where build's helpers are reachable: rawBlocks and selKey are internal, so they are tried through the module's text
  var ctxWin = {};
  vm.runInNewContext(SRC.replace("root.RevampDevExport = {", "root.__raw = { rawBlocks: rawBlocks, selKey: selKey, rawBody: rawBody };\n  root.RevampDevExport = {"), { window: ctxWin, URL: URL });
  var R = ctxWin.__raw;
  var text = '/* a */ .a{color:red} @media (max-width:600px){ [data-x="1"] .b { border:1px solid var(--q); border-top:2px solid red } } .a{padding:1px}';
  var blocks = R.rawBlocks(text);
  check('2b.1 a stylesheet\'s rule blocks in order, @media ones too, by selector', blocks.length === 3 && blocks[1].key === '[data-x=1].b' && /border:1px solid var\(--q\)/.test(blocks[1].body), blocks);
  var raw = { text: text, seen: { '.a': 1 } };
  check('2b.2 the second ".a" rule\'s own words', R.rawBody({ selectorText: '.a' }, { raw: raw }) === 'padding:1px');
  check('2b.3 a selector written with quotes and spaces is the same one', R.selKey('[data-x="1"]  >  .b::before') === R.selKey("[data-x=1]>.b:before"));
  check('2b.4 build reads it when the browser hands back empty longhands', /if \(\/:\\s\*;\/\.test\(body\)\) \{ var words = rawBody\(rule, ctx\); if \(words\) body = words; \}/.test(SRC));
})();

/* ======================= 2f the banner under another page's header ======================= */
(function () {
  check('2f.1 the copy\'s banner is as tall as its content, with the room below it above it too (the owner chose to tighten it), only for the page\'s banner and only with extra room', /function bannerRoom\(win, sec, id\)/.test(SRC) && /var tight = !\(pt <= pb \+ 8 && mh < vh \* 0\.5\);/.test(SRC) && /min-height: 0 !important; padding-top: ' \+ top \+ ' !important; \}' : ''\)/.test(SRC) && /\+ bannerRoom\(win, sec, id\);/.test(SRC));
  // bannerRoom, bannerMark and placeQuiet are internal: tried through the module's text, with a page made of stand-ins
  var ctxWin = {};
  vm.runInNewContext(SRC.replace("root.RevampDevExport = {", "root.__banner = { bannerRoom: bannerRoom, bannerMark: bannerMark, placeQuiet: placeQuiet };\n  root.RevampDevExport = {"), { window: ctxWin, URL: URL });
  var B = ctxWin.__banner;
  function el(tag, attrs) {
    var e = { localName: tag, attrs: attrs || {}, childNodes: [], id: (attrs || {}).id || '' };
    e.setAttribute = function (n, v) { e.attrs[n] = v; if (n === 'id') e.id = v; };
    e.querySelector = function (q) { var m = /^\[id="(.+)"\]$/.exec(q); return m ? find(e, function (k) { return k.id === m[1]; }) : (q === 'h1' ? find(e, function (k) { return k.localName === 'h1'; }) : null); };
    e.insertBefore = function (k, ref) { var i = e.childNodes.indexOf(ref); e.childNodes.splice(i < 0 ? e.childNodes.length : i, 0, k); };
    e.appendChild = function (k) { e.childNodes.push(k); };
    Object.defineProperty(e, 'firstChild', { get: function () { return e.childNodes[0] || null; } });
    Object.defineProperty(e, 'firstElementChild', { get: function () { return e.childNodes[0] || null; } });
    e.ownerDocument = { createElement: function (t) { return el(t); } };
    return e;
  }
  function find(e, fn) { for (var i = 0; i < e.childNodes.length; i++) { var k = e.childNodes[i]; if (fn(k)) return k; var d = find(k, fn); if (d) return d; } return null; }
  function page(pt, pb, mh) { return { innerHeight: 900, innerWidth: 1440, getComputedStyle: function () { return { paddingTop: pt + 'px', paddingBottom: pb + 'px', minHeight: mh + 'px' }; } }; }
  var hero = el('section', { id: 'hero' });
  var roomy = B.bannerRoom(page(220, 110, 760), hero, 'hero');
  check('2f.2 a roomy banner: tightened, and on an ETB2B page its room starts below ETB2B\'s fixed header (100px, or the measured height)',
    /#hero\.rv-embed-hero\.rv-embed-hero\.rv-embed-hero\.rv-embed:not\(#_#_#_#_\) \{ min-height: 0 !important; padding-top: clamp\(32px, 7\.64vw, 110px\) !important; \}/.test(roomy) &&
    /body:has\(#ms_header_oauth_wrapper\):not\(:has\(section#banner:not\(\.rv-embed\)\)\) #hero\.rv-embed-hero\.rv-embed-hero\.rv-embed-hero\.rv-embed:not\(#_#_#_#_\) \{ padding-top: calc\(var\(--rv-etb2b-head, 100px\) \+ clamp\(32px, 7\.64vw, 110px\)\) !important; \}/.test(roomy), roomy);
  var snug = B.bannerRoom(page(64, 64, 0), hero, 'hero');
  check('2f.3 a banner without extra room is left as it is, but on an ETB2B page still starts below the header', snug.indexOf('min-height') === -1 && /padding-top: calc\(var\(--rv-etb2b-head, 100px\) \+ clamp\(32px, 4\.44vw, 64px\)\) !important;/.test(snug), snug);
  check('2f.4 not the banner: nothing', B.bannerRoom(page(220, 110, 760), el('section', { id: 'about' }), 'about') === '');
  var c1 = el('section', { id: 'hero' }); c1.appendChild(el('div'));
  B.bannerMark(c1, c1, 'hero', '.hero > div { color: red }');
  var mark = c1.childNodes[0];
  check('2f.5 the banner carries a hidden #banner mark (ETB2B\'s footer script then adds no margin above the page), first', mark && mark.localName === 'i' && mark.id === 'banner' && mark.attrs.hidden === '' && mark.attrs['aria-hidden'] === 'true' && mark.attrs.style === 'display:none !important', c1.childNodes.map(function (k) { return k.localName + '#' + k.id; }));
  var c2 = el('section', { id: 'hero' }); c2.appendChild(el('div'));
  B.bannerMark(c2, c2, 'hero', '.hero > div:first-child { color: red }');
  check('2f.6 …last where the section\'s CSS counts first children', c2.childNodes[1] && c2.childNodes[1].id === 'banner');
  var c3 = el('section', { id: 'hero' }); var inner = el('div'); c3.appendChild(inner);
  B.bannerMark(c3, c3, 'hero', '.a:first-child, .b:last-child { color: red }');
  check('2f.7 …inside its first child where it counts both', c3.childNodes.length === 1 && inner.childNodes[0] && inner.childNodes[0].id === 'banner');
  var link = el('link'), c4 = el('section'); c4.appendChild(el('div'));
  B.placeQuiet(c4, link, ':first-child :last-child');
  check('2f.8 …but a preload link stays out then', c4.childNodes.length === 1 && c4.childNodes[0].childNodes.length === 0);
  var c5 = el('section', { id: 'banner' }); B.bannerMark(c5, c5, 'banner', '');
  var c6 = el('section', { id: 'about' }); c6.appendChild(el('h2')); B.bannerMark(c6, c6, 'about', '');
  check('2f.9 no mark on a banner that is #banner already, nor on a section that is not the banner', c5.childNodes.length === 0 && c6.childNodes.length === 1);
  check('2f.10 build marks the banner after its pictures', /pictures\(win, sec, copy, id, css\);\n\s*bannerMark\(sec, copy, id, css\);/.test(SRC));
  check('2f.11 the common script measures ETB2B\'s header where it is not ~100px (at the start, on load and on resize), so nothing moves on the usual page',
    /var px = h \? Math\.round\(h\.getBoundingClientRect\(\)\.height\) : 0, want = px && Math\.abs\(px - 100\) > 4 \? px \+ 'px' : '';/.test(SRC) && /w\.addEventListener\('load', head\);/.test(SRC) && /function watch\(\) \{\n\s*head\(\);/.test(SRC) && /getElementById\('ms_header_oauth_wrapper'\)/.test(SRC));
})();

/* ======================= 2g pictures: the banner's first ======================= */
(function () {
  check('2g.1 the banner\'s picture is asked for first: a preload link (fetchpriority high, WebP where image-set has one), or fetchpriority on an <img> banner', /link\.setAttribute\('rel', 'preload'\);/.test(SRC) && /link\.setAttribute\('fetchpriority', 'high'\);/.test(SRC) && /if \(webp\) link\.setAttribute\('type', 'image\/webp'\);/.test(SRC) && /bigImg\.setAttribute\('fetchpriority', 'high'\);/.test(SRC));
  check('2g.2 …never where the section\'s CSS counts children', /placeQuiet\(copy, link, ownCss\);/.test(SRC) && /if \(!first\) copy\.insertBefore\(el, copy\.firstChild\);\n\s*else if \(!last\) copy\.appendChild\(el\);\n\s*else if \(el\.localName !== 'link'/.test(SRC));
  check('2g.3 every picture below the banner loads as it comes into view; the hidden dark-theme logo too; a picture gets its size', /if \(!img\.hasAttribute\('loading'\)\) img\.setAttribute\('loading', 'lazy'\);/.test(SRC) && /classList\.contains\('rv-lu-dark'\)\) img\.setAttribute\('loading', 'lazy'\)/.test(SRC) && /function sizePictures\(sec, copy\)/.test(SRC));
})();

/* ======================= 2h on a phone (the owner, 13 Nov 2026: "the mobile score is very low") ======================= */
(function () {
  var ctxWin = {};
  vm.runInNewContext(SRC.replace("root.RevampDevExport = {", "root.__phone = { fontFaces: fontFaces, fontRule: fontRule, fontsCss: fontsCss, phoneVw: phoneVw, phoneSizes: phoneSizes, pageLinks: pageLinks };\n  root.RevampDevExport = {"), { window: ctxWin, URL: URL });
  var P = ctxWin.__phone;
  // the fonts: Google lists a variable font's one file once per weight and subset
  var G = 'https://fonts.gstatic.com/s/fraunces/v38/';
  function face(w, file, range) { return '/* latin */\n@font-face {\n  font-family: \'Fraunces\';\n  font-style: normal;\n  font-weight: ' + w + ';\n  font-display: swap;\n  src: url(' + G + file + ') format(\'woff2\');\n  unicode-range: ' + range + ';\n}\n'; }
  var google = [300, 400, 700].map(function (w) { return face(w, 'ext.woff2', 'U+0100-02BA'); }).join('') + [300, 400, 700].map(function (w) { return face(w, 'latin.woff2', 'U+0000-00FF'); }).join('');
  var merged = P.fontFaces(google);
  check('2h.1 a variable font\'s weights as one rule per subset (300 700), its display, file and range kept', merged.split('@font-face').length - 1 === 2 && /font-family: 'Fraunces'; font-style: normal; font-weight: 300 700; font-display: swap; src: url\(https:\/\/fonts\.gstatic\.com\/s\/fraunces\/v38\/latin\.woff2\) format\('woff2'\); unicode-range: U\+0000-00FF; \}/.test(merged), merged);
  var statics = P.fontFaces(face(400, 'a400.woff2', 'U+0000-00FF') + face(700, 'a700.woff2', 'U+0000-00FF'));
  check('2h.2 …a font with a file per weight keeps a rule per weight', statics.split('@font-face').length - 1 === 2 && /font-weight: 400;/.test(statics) && /font-weight: 700;/.test(statics), statics);
  check('2h.3 …and a stylesheet that is not Google\'s font files is not written in', P.fontFaces(face(400, 'x.woff2', 'U+0000-00FF').replace(G, 'https://evil.example/')) === '' && P.fontFaces('') === '');
  var href = 'https://fonts.googleapis.com/css2?family=Fraunces:wght@300;400;700&display=swap', fetched = {}; fetched[href] = google;
  var inl = P.fontRule({ __rvFontCss: fetched }, href), imp = P.fontRule({}, href);
  check('2h.4 a Google Fonts address: its stylesheet where loadPage fetched it, the @import where it could not', !inl.imp && inl.faces === google && imp.imp === '@import url("' + href + '");' && !imp.faces, [inl, imp]);
  // the same page's sheet was readable in one copy (its rules came as the browser writes them) and not in the next
  var browserWrites = '@font-face { font-family: Fraunces; font-style: normal; font-weight: 800; font-display: swap; src: url("' + G + 'latin.woff2") format("woff2"); unicode-range: U+0-FF; }';
  var f = P.fontsCss([href, 'https://other.example/fonts.css'], [browserWrites, '@keyframes spin { to { transform: rotate(1turn) } }'], { __rvFontCss: fetched });
  var fj = f.extra.join('\n');
  check('2h.5 the common CSS: the @imports left first; Google\'s font rules from either source merged, one per file (the browser\'s url("…") and U+0-FF are the same file as Google\'s); the rest kept',
    show(f.imports) === show(['@import url("https://other.example/fonts.css");']) && fj.split('@font-face').length - 1 === 2 && /font-weight: 300 800; font-display: swap; src: url\("?https:\/\/fonts\.gstatic\.com\/s\/fraunces\/v38\/latin\.woff2"?\)/.test(fj) && /font-weight: 300 700;[^}]*ext\.woff2/.test(fj) && /@keyframes spin/.test(fj) && /var fonts = fontsCss\(fontLinks\(doc, base, ctx, families\), extra, win\), imports = fonts\.imports;\n\s*extra = fonts\.extra;/.test(SRC), f);
  check('2h.5a every Google Fonts address of the page fetched by loadPage alongside its fonts, within 4s',
    /var faces = fontsOf\(d\)\.then\(function \(got\) \{ try \{ f\.contentWindow\.__rvFontCss = got; \}/.test(SRC) && /Promise\.all\(\[ready, faces\]\)\.then\(function \(\) \{ finish\(null\); \}/.test(SRC) && /setTimeout\(r, 4000\)/.test(SRC));
  // pictures on a phone: measured at 412px, the page put back at its own width
  check('2h.6 a picture\'s share of a phone\'s screen, rounded up; nothing for one not shown or as wide as the screen', P.phoneVw(290) === 70.4 && P.phoneVw(364) === 88.4 && P.phoneVw(0) === 0 && P.phoneVw(412) === 0 && P.phoneVw(411.5) === 0 && P.phoneVw(100) === 24.3, [P.phoneVw(290), P.phoneVw(364), P.phoneVw(100)]);
  function img(attrs) { return { attrs: attrs, getAttribute: function (k) { return k in this.attrs ? this.attrs[k] : null; }, setAttribute: function (k, v) { this.attrs[k] = v; } }; }
  var frame = { style: { width: '1440px' } }, during = [];
  var win = { frameElement: frame, document: { documentElement: { get offsetWidth() { during.push(frame.style.width); return 1; } } } };
  function liveImg(phoneW) { return { getBoundingClientRect: function () { return { width: frame.style.width === '412px' ? phoneW : 600 }; } }; }
  var lazySrcset = 'https://s/a.png.rv-1.1024x1024.w640.webp 640w, https://s/a.png.rv-1.1024x1024.w1024.webp 1024w', SZ = '(max-width: 767px) 100vw, (max-width: 1365px) 75vw, 1024px';
  var mine = [img({ srcset: lazySrcset, sizes: SZ }), img({ srcset: 'https://s/b.webp 1x' }), img({ srcset: lazySrcset, sizes: SZ }), img({ srcset: lazySrcset, sizes: SZ })];
  var live = [liveImg(290), liveImg(290), liveImg(0), liveImg(412)];
  P.phoneSizes(win, { querySelectorAll: function () { return live; } }, { querySelectorAll: function () { return mine; } });
  check('2h.7 a lazy picture\'s sizes begins with its width on a phone; one with x candidates, one not shown there, one as wide as the screen are left', mine[0].attrs.sizes === '(max-width: 480px) 70.4vw, ' + SZ && !('sizes' in mine[1].attrs) && mine[2].attrs.sizes === SZ && mine[3].attrs.sizes === SZ, mine.map(function (m) { return m.attrs.sizes; }));
  check('2h.8 …measured with the page at a phone\'s width, then put back at its own before anything else reads it', show(during) === show(['412px', '1440px']) && frame.style.width === '1440px', during);
  P.phoneSizes(win, { querySelectorAll: function () { return live; } }, { querySelectorAll: function () { return mine; } });
  check('2h.9 …once (a copy made again does not add it twice)', mine[0].attrs.sizes === '(max-width: 480px) 70.4vw, ' + SZ, mine[0].attrs.sizes);
  // links to the event's other pages
  var links = [img({ 'data-rv-page-link': 'award-category', href: 'https://cms.example/preview/award-category' }), img({ 'data-rv-page-link': 'home', href: '/preview/x' }), img({ 'data-rv-page-link': 'award faq', href: '/preview/x/award-faq' })];
  P.pageLinks({ querySelectorAll: function (q) { return /a\[data-rv-page-link\]/.test(q) ? links : []; } }, 'https://cms.example/e/qa-awards/#overview');
  check('2h.10 a link to another page of the event goes to that page on the event\'s public site, never to the preview (EventSphere\'s sign-in for a visitor)', links[0].attrs.href === 'https://cms.example/e/qa-awards/award-category' && links[1].attrs.href === 'https://cms.example/e/qa-awards' && links[2].attrs.href === 'https://cms.example/e/qa-awards/award%20faq', links.map(function (l) { return l.attrs.href; }));
  check('2h.11 build measures the pictures on a phone and sets the page links before it writes the HTML', /bannerMark\(sec, copy, id, css\);\n\s*phoneSizes\(win, sec, copy\);\n\s*pageLinks\(copy, o\.pageUrl\);\n\s*var html = htmlOf\(copy\);/.test(SRC));
})();

/* ======================= 2e only what the other website uses ======================= */
(function () {
  check('2e.1 a speaker\'s pop-up text goes on an event site (its card leads to the speaker\'s page), stays on an awards site (jury cards)', /if \(!opt\.awards\) each\('template\[data-rv-profile\]', function \(n\) \{ n\.remove\(\); \}\);/.test(SRC) && /awards: !!\(doc\.body && doc\.body\.hasAttribute\('data-rv-awards'\)\)/.test(SRC));
  var unused = /var UNUSED_ATTRS = \[([^\]]*)\]/.exec(SRC)[1];
  var read = ['data-rv-section', 'data-rv-embed', 'data-rv-reveal', 'data-rv-carousel', 'data-rv-field', 'data-rv-id', 'data-rv-filled', 'data-rv-item', 'data-rv-repeat-template', 'data-rv-profile-name', 'data-rv-auto', 'data-rv-section-id', 'data-rv-event-id', 'data-rv-awards'];
  check('2e.2 the marks nothing on the other website reads go; none the scripts read (et-runtime.js, rv-popups.js, rv-award-cta.js)', read.every(function (a) { return unused.indexOf("'" + a + "'") === -1; }) &&
    ['data-rv-key', 'data-rv-template-id', 'data-rv-mode', 'data-rv-pristine'].every(function (a) { return unused.indexOf("'" + a + "'") !== -1 && RUNTIME.indexOf(a) === -1 && POPUPS.indexOf(a) === -1; }), unused);
})();

/* ======================= 2d inherit on the section itself ======================= */
(function () {
  var cs = { fontSize: '16px', lineHeight: '22.857px', fontStyle: 'normal', fontVariant: 'normal', fontWeight: '400', fontStretch: '100%', fontFamily: 'Inter, Arial, sans-serif', getPropertyValue: function (n) { return n === 'color' ? 'rgb(0, 0, 0)' : ''; } };
  var out = T.inheritFrom('margin: 0px; font: inherit; color: inherit !important; --x: inherit; vertical-align: baseline', cs);
  check('2d.1 "inherit" for the section itself is the event page\'s value (ETB2B\'s classic reset: section { font: inherit })', /font-size: 16px; line-height: 1\.428563; font-family: Inter, Arial, sans-serif/.test(out) && /color: rgb\(0, 0, 0\) !important/.test(out) && /--x: inherit/.test(out) && /margin: 0px/.test(out), out);
  check('2d.2 only for the selector that is the section itself; the rest keep inherit', /out\.rootAt = out\.length - 1;/.test(SRC) && /var inner = kept\.filter\(function \(k\) \{ return roots\.indexOf\(k\) === -1; \}\);/.test(SRC));
})();

/* ======================= 2c HTML the CMS keeps whole ======================= */
(function () {
  check('2c.1 the HTML is written without a double quote in any attribute (ETB2B\'s CMS turns &quot; back into ")', /function htmlOf\(node\)/.test(SRC) && /var html = htmlOf\(copy\);/.test(SRC) && /else if \(v\.indexOf\("'"\) === -1\) out \+= ' ' \+ a\.name \+ "='" \+ v \+ "'";/.test(SRC));
  var hero = 'background-image: url("https://x/a.jpg") !important; background-image: image-set(url(\'https://x/a.webp\') type(\'image/webp\'), url("https://x/a.jpg")) !important; font-family: "Bob\'s Sans", serif';
  var one = T.singleQuoted(hero);
  check('2c.2 an inline style has no double quote at all, though it held both kinds (the hero\'s picture: url("…") beside image-set(url(\'…\')))', one.indexOf('"') === -1 && /url\('https:\/\/x\/a\.jpg'\)/.test(one) && /'Bob\\'s Sans'/.test(one) && /el\.setAttribute\('style', singleQuoted\(st\)\);/.test(SRC), one);
})();

/* ======================= 3 the reset ======================= */
(function () {
  var r = T.resetCss('#rv-embed-x');
  check('3.1 the section and every plain element in it back to the browser\'s own', /^\/\*[^*]*\*\/\n#rv-embed-x, #rv-embed-x :where\(\*:not\(/.test(r) && /\) \{ all: revert; \}/.test(r), r.slice(0, 200));
  check('3.2 SVG, pictures, video, form fields and tables are left out of "all" (their attributes are part of their look)', /svg, svg \*, img, video, audio, canvas, iframe, embed, object, input, select, textarea, table, td, th/.test(r));
  check('3.3 …and get their box back instead (margin, padding, border, colour, font…)', /:where\(img, video, audio, canvas, iframe, embed, object, input, select, textarea, table, td, th\):not\([^)]*\) \{ margin: revert; padding: revert; border: revert;/.test(r));
  check('3.4 ::before / ::after of the section\'s elements too (another website\'s arrows and bullets)', /::before, #rv-embed-x :where\([^{]*\)::after \{ all: revert; \}/.test(r));
  // what the runtimes add inside a section is styled by the runtimes: it must be left out of the reset
  var made = T.RUNTIME_MADE;
  var covered = function (cls) { return made.some(function (m) { return m === '.' + cls || (/^\[class\^="rv-etnav-"\]$/.test(m) && /^rv-etnav-/.test(cls)); }); };
  var fromRuntime = [];
  RUNTIME.replace(/className\s*=\s*'([a-z0-9-]+)/g, function (m, c) { if (fromRuntime.indexOf(c) === -1) fromRuntime.push(c); });
  var fromPopups = [];
  POPUPS.replace(/el\('[a-z]+',\s*'(rv-[a-z0-9-]+)'/g, function (m, c) { if (fromPopups.indexOf(c) === -1) fromPopups.push(c); });
  // the pop-ups and the photo viewer go on <body>, outside any section: the reset never reaches them
  var inSections = fromRuntime.concat(fromPopups.filter(function (c) { return !/^rv-(pop|lb)(-|$)/.test(c); }));
  // a day tab and its two lines stand inside the row of day tabs (et-runtime.js sessionDays): ".rv-day-tabs *" covers them
  var inside = { 'rv-day-tab': 'rv-day-tabs', 'rv-day-tab-n': 'rv-day-tabs', 'rv-day-tab-d': 'rv-day-tabs' };
  check('3.5a the day tabs are put inside their row', /bar\.className = 'rv-day-tabs';[\s\S]{0,900}b\.className = 'rv-day-tab';[\s\S]{0,600}bar\.appendChild\(b\);/.test(RUNTIME));
  var missing = inSections.filter(function (c) { return !covered(c) && !(inside[c] && covered(inside[c])); });
  check('3.5 every element et-runtime.js and rv-popups.js add to a section is left out of the reset (the list is in step)', inSections.length >= 8 && missing.length === 0, { missing: missing, seen: inSections });
  check('3.6 …and the runtimes\' own rules are given the sections\' weight (and !important) by the common script, not lost under the reset', /function weigh\(\)/.test(SRC) && /return scope \+ ' ' \+ x;/.test(SRC) && /' !important'\);/.test(SRC));
})();

/* ======================= 4 the scripts ======================= */
(function () {
  var scripts = [{ src: 'https://cms.example/templates/_shared/et-runtime.js?v=1', global: 'RevampSections' },
    { src: 'https://cms.example/templates/_shared/widgets/x/script.js', section: 'speakers' },
    { src: 'https://cms.example/templates/_shared/rv-popups.js', global: 'RevampPopups' }];
  var common = T.commonJs({ title: 'QA Summit', pageUrl: 'https://cms.example/e/qa-awards#x', scripts: scripts });
  var own = T.sectionJs({ id: 'speakers', title: 'Speakers — QA Summit', ownJs: "section.setAttribute('data-own', String((+section.getAttribute('data-own') || 0) + 1));\nif (this !== section) throw new Error('this');" });
  function parses(js) { try { new Function(js); return true; } catch (e) { return e.message; } }
  check('4.1 the common script and a section\'s script parse', parses(common) === true && parses(own) === true, [parses(common), parses(own)]);
  check('4.2 the common script says what it is and where it goes', /^\/\* QA Summit — the common script of the sections copied from ETB2B EventSphere\.\n   Put it once on the page \(the CMS’s global section\)\./.test(common), common.slice(0, 200));
  check('4.3 a section with no script of its own has nothing in its JS box', T.sectionJs({ id: 'a', title: 't', ownJs: '  ' }) === '');
  check('4.4 a section\'s script hands its code to the common script, by the section\'s id', /\(window\.RevampEmbedQ = window\.RevampEmbedQ \|\| \[\]\)\.push\(\["speakers", function \(section\) \{/.test(own) && /var ID|RevampSections/.test(own) === false);
  check('4.5 jsString keeps </script> and line separators from ending the script', T.jsString('</script>\u2028') === '"<\\/script>\\u2028"', T.jsString('</script>\u2028'));
  check('4.6 the event page in the common script, without its #', /"page":"https:\/\/cms\.example\/e\/qa-awards"/.test(common));

  // a small page for them: two copied sections; the section's script before the common one, the other after
  function page() {
    var added = [], styles = [], clicks = [];
    function el(tag) {
      return { tagName: tag.toUpperCase(), attrs: {}, children: [], setAttribute: function (k, v) { this.attrs[k] = String(v); }, getAttribute: function (k) { return k in this.attrs ? this.attrs[k] : null; },
        hasAttribute: function (k) { return k in this.attrs; }, get attributes() { var a = this.attrs; return Object.keys(a).map(function (k) { return { name: k, value: a[k] }; }); } };
    }
    var sandbox = { console: console, setTimeout: setTimeout };
    var sections = { speakers: el('section'), partners: el('section') };
    sections.speakers.setAttribute('data-rv-embed', 'speakers');
    sections.partners.setAttribute('data-rv-embed', 'partners');
    var head = { firstChild: null, insertBefore: function (n) { styles.push(n); }, appendChild: function (n) { added.push(n); setTimeout(function () {
      if (/et-runtime/.test(n.src)) sandbox.RevampSections = { init: function (s) { s.inits = (s.inits || 0) + 1; } };
      if (/rv-popups/.test(n.src)) sandbox.RevampPopups = { refresh: function () { sandbox.refreshed = (sandbox.refreshed || 0) + 1; } };
      n.onload();
    }, 5); } };
    sandbox.document = { readyState: 'complete', head: head, documentElement: head, createElement: el,
      addEventListener: function (type, fn, capture) { if (type === 'click') clicks.push({ fn: fn, capture: capture }); },
      querySelector: function (sel) { return /data-rv-embed-weight/.test(sel) ? styles[0] || null : null; },
      querySelectorAll: function (sel) {
        var m = /data-rv-embed="([^"]+)"/.exec(sel);
        if (m) return sections[m[1]] ? [sections[m[1]]] : [];
        if (sel === '[data-rv-embed]') return [sections.speakers, sections.partners];
        return [];
      } };
    sandbox.window = sandbox;
    return { sandbox: sandbox, added: added, sections: sections, styles: styles, clicks: clicks };
  }
  var p = page(), ctx = vm.createContext(p.sandbox);
  vm.runInContext(own, ctx);                                   // the section's box comes first on this page
  vm.runInContext(common, ctx);
  vm.runInContext(T.commonJs({ title: 'QA Summit', pageUrl: '', scripts: [scripts[0], scripts[2]] }), ctx);   // pasted twice: one loader
  setTimeout(function () {
    var srcs = p.added.map(function (n) { return n.src; });
    check('4.7 each script loaded once though the common script is on the page twice, in order, the widget marked for its section', show(srcs) === show(['https://cms.example/templates/_shared/et-runtime.js?v=1', 'https://cms.example/templates/_shared/widgets/x/script.js', 'https://cms.example/templates/_shared/rv-popups.js']) &&
      p.added[1].getAttribute('data-rv-script') === 'speakers', srcs);
    check('4.8 every copied section on the page started once by the runtime', p.sections.speakers.inits === 1 && p.sections.partners.inits === 1, [p.sections.speakers.inits, p.sections.partners.inits]);
    check('4.9 the section\'s own script ran once, with `section` and this as the section, though it came before the common script', p.sections.speakers.getAttribute('data-own') === '1' && p.sections.partners.getAttribute('data-own') === null, p.sections.speakers.attrs);
    check('4.10 the runtimes\' rules are weighed in a style first in <head>', p.styles.length === 1 && p.styles[0].getAttribute('data-rv-embed-weight') === '', p.styles.length);
    check('4.10a the sections are started together: the page\'s people and photos marked once for both, not once per section (each reads the whole page\'s layout)', p.sandbox.refreshed === 1, p.sandbox.refreshed);
    // a click on a button that opens one of the event's forms goes to the event's own site, which opens it there
    function link(attrs) { return { nodeType: 1, attrs: attrs, getAttribute: function (k) { return k in attrs ? attrs[k] : null; }, hasAttribute: function (k) { return k in attrs; },
      closest: function (q) { return /data-rv-embed/.test(q) ? { id: '', querySelector: function () { return null; } } : this; } }; }
    function click(a) { var e = { target: a, button: 0, prevented: false, preventDefault: function () { this.prevented = true; }, stopPropagation: function () {} }; p.sandbox.location = { href: '' }; p.clicks[0].fn(e); return { prevented: e.prevented, to: p.sandbox.location.href }; }
    check('4.11 one click handler for the page (capture)', p.clicks.length === 1 && p.clicks[0].capture === true, p.clicks.length);
    var n = click(link({ href: '#rv-form-nom1', 'data-rv-form': 'nom1', 'data-rv-award-cta': '' }));
    check('4.12 "Nominate Now" (the award button\'s form) opens on the event\'s site', n.prevented && n.to === 'https://cms.example/e/qa-awards#rv-form-nom1', n);
    var r = click(link({ href: '#register', 'data-register-cta': '' }));
    check('4.13 a Register button opens the event\'s form there', r.prevented && r.to === 'https://cms.example/e/qa-awards#register', r);
    var soon = click(link({ 'data-rv-award-cta': '', 'aria-disabled': 'true', href: '#x' }));
    check('4.14 "Winners will be announced soon" stays a status: a click goes nowhere', !soon.prevented && soon.to === '', soon);
    finish();
  }, 300);
})();

/* ======================= 4b ETB2B's header height, measured by the common script ======================= */
(function () {
  function run(headPx) {
    var props = {}, events = {};
    var style = { getPropertyValue: function (n) { return props[n] || ''; }, setProperty: function (n, v) { props[n] = v; }, removeProperty: function (n) { delete props[n]; } };
    var root = { style: style, firstChild: null, insertBefore: function () {}, appendChild: function () {} };
    var header = headPx == null ? null : { getBoundingClientRect: function () { return { height: headPx }; } };
    var sb = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, addEventListener: function (t, fn) { events[t] = fn; } };
    sb.document = { readyState: 'complete', head: root, documentElement: root, createElement: function () { return {}; }, addEventListener: function () {},
      getElementById: function (id) { return id === 'ms_header_oauth_wrapper' ? header : null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; } };
    sb.window = sb;
    vm.runInContext(T.commonJs({ title: 'QA', pageUrl: '', scripts: [] }), vm.createContext(sb));
    return { props: props, events: events, setHead: function (px) { headPx = px; header = { getBoundingClientRect: function () { return { height: px }; } }; } };
  }
  var usual = run(101), other = run(140), none = run(null);
  check('4b.1 ETB2B\'s usual header (99–101px): nothing set, so the banner\'s CSS (100px) stands and nothing moves', !('--rv-etb2b-head' in usual.props), usual.props);
  check('4b.2 a header of another height: the banner\'s room follows it', other.props['--rv-etb2b-head'] === '140px', other.props);
  check('4b.3 no ETB2B header: nothing set', !('--rv-etb2b-head' in none.props), none.props);
  other.setHead(100); other.events.load();
  check('4b.4 measured again once the page has loaded (and on resize): back to the usual height, the value goes', !('--rv-etb2b-head' in other.props) && typeof other.events.resize === 'function', other.props);
})();

/* ======================= 5 the site editor ======================= */
(function () {
  var dev = UI.slice(UI.indexOf('function openDevZone('), UI.indexOf('/* ---------- choosing a picture ----------'));
  check('5.1 the Developer zone has two views: Edit this section | Copy for another website', /data-dev-mode="edit" class="active" aria-pressed="true">Edit this section</.test(dev) && /data-dev-mode="copy" aria-pressed="false">Copy for another website</.test(dev));
  check('5.2 the copy view has Copy (the tab shown), Copy all as one block and Download a test page; Apply only edits', /id="rv-dev-copy" hidden>Copy HTML</.test(dev) && /id="rv-dev-copy-all" hidden>Copy all as one block</.test(dev) && /id="rv-dev-download" hidden>Download a test page</.test(dev) &&
    /if \(mode !== 'edit'\) return;/.test(dev));
  check('5.3 the copy is made from the page as a visitor gets it: staged as it is now (RevampCore.previewDraft) and opened with its scripts off (RevampDevExport.loadPage)',
    /RevampCore\.previewDraft\(eventId, canvas\.serialize\(\)\)/.test(dev) && /RevampDevExport\.loadPage\(url\)/.test(dev) && /RevampDevExport\.build\(/.test(dev));
  check('5.4 the staged page is let go when the view is left or the zone closed', /function close\(\) \{ dropStaged\(\);/.test(dev) && /dropStaged\(\);\n\s*var back = edits \|\| loaded;/.test(dev));
  check('5.5 the copy is read-only, and what was typed under "Edit this section" waits there, unapplied', /editors\[k\]\.setOption\('readOnly', copying\)/.test(dev) && /edits = \{ html: val\('html'\), css: val\('css'\), js: val\('js'\) \}/.test(dev) && /var back = edits \|\| loaded;/.test(dev));
  check('5.6 a hidden section, or one not on the page, says why there is nothing to copy', /This section is hidden, so it is not on the site\. Show it first to copy it\./.test(dev) && /This section is not on the page visitors see/.test(dev));
  check('5.6a the copy view lists "Common CSS & JS — once per site" first, for the CMS\'s global section; the other view does not', /o\.value = 'common';\n\s*o\.textContent = 'Common CSS & JS — once per site';\n\s*pick\.insertBefore\(o, pick\.firstChild\);/.test(dev) && /var entry = pick\.querySelector\('option\[value="common"\]'\);\n\s*if \(entry\) entry\.remove\(\);/.test(dev) &&
    /RevampDevExport\.buildCommon\(/.test(dev) && /CMS’s global section/.test(dev));
  check('5.7 while it is made, the view says so and the buttons wait', /Making the copy from the page as visitors see it…/.test(dev) && /buttons\(false\)/.test(dev));
  var at = PAGE.indexOf('<script src="editor-dev-export.js"></script>'), ui = PAGE.indexOf('<script src="editor-template-ui.js"></script>');
  check('5.8 custom_editor.html loads editor-dev-export.js once, before editor-template-ui.js', at !== -1 && at < ui && PAGE.split('src="editor-dev-export.js"').length === 2);
  check('5.9 the server sends it (its list of files)', require('./access').isServableFile('editor-dev-export.js') === true);
  check('5.10 the switch has its look in the editor (and the copy notes)', /\.dev-mode button\.active\{/.test(PAGE) && /\.dev-copy-notes\{/.test(PAGE));
})();

/* ======================= 6 rv-popups.js on another website ======================= */
(function () {
  check('6.1 it knows when it was loaded from another host (its own script\'s address)', /var HOME = \(function \(\) \{\n\s*var me = doc\.currentScript;/.test(POPUPS) && /return at\.origin === location\.origin \? '' : at\.origin;/.test(POPUPS));
  check('6.2 a speaker\'s or a sponsor\'s page is EventSphere\'s there', /return HOME \+ '\/' \+ kind \+ '\/go\?' \+ q\.join\('&'\);/.test(POPUPS));
  check('6.3 the event and "awards site" are read from the card\'s wrapper (it carries what <body> has here)', /function pageOf\(n\) \{ return \(n && n\.closest && n\.closest\('\[data-rv-event-id\]'\)\) \|\| doc\.body; \}/.test(POPUPS) && /if \(awardsSite\(card\)\) return;/.test(POPUPS) && /goHref\('speakers', p, card\)/.test(POPUPS) && /\}, tile\);/.test(POPUPS));
  check('6.3a a pop-up there takes the event\'s colours from the section it opened from (its computed variables)', /var cs = window\.getComputedStyle\(wrap\), names = CSS\.match\(/.test(POPUPS));
  check('6.4 its sizes are px there (the other website\'s root size is not ours); unchanged here', /st\.textContent = HOME \? CSS\.replace\(/.test(POPUPS) && /: CSS;/.test(POPUPS));
  // the page's own address on our own pages: unchanged
  check('6.5 on our own pages the links stay on the page\'s own host (HOME is "" there)', /at\.origin === location\.origin \? ''/.test(POPUPS));
})();

/* ======================= 6b et-runtime.js: a section that comes later ======================= */
(function () {
  var init = RUNTIME.slice(RUNTIME.indexOf('    init: function (el) {'), RUNTIME.indexOf('    reveal: reveal,'));
  check('6b.1 RevampSections.init gives a section that comes later its agenda by day and its tab sets', /sessionDays\(\);/.test(init) && /if \(Array\.prototype\.some\.call\(el\.querySelectorAll\('\[data-rv-tab\]'\), function \(t\) \{ return !t\.__rvTabbed; \}\)\) tabSets\(el\);/.test(init), init);
  check('6b.2 …never for tabs a set already has (tabSets marks them), and never while editing (both functions stop there)', /each\(root\.querySelectorAll\('\[data-rv-tab\]'\), function \(t\) \{ t\.__rvTabbed = true; \}\);/.test(RUNTIME) &&
    /function sessionDays\(\) \{\n    if \(editing\(\)\) return;/.test(RUNTIME) && /function tabSets\(root\) \{\n    if \(editing\(\) \|\| root\.__rvTabs\) return;/.test(RUNTIME));
  check('6b.3 a day row is made once per list however often it is asked (its guard)', /list\.previousElementSibling\.hasAttribute\('data-rv-day-tabs'\)\)\) return;/.test(RUNTIME));
})();

/* ======================= 7 ES5 ======================= */
(function () {
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still run */ }
  check('7 esbuild is there to check ES5', !!esbuild);
  if (!esbuild) return;
  [['editor-dev-export.js', SRC], ['editor-template-ui.js', UI], ['templates/_shared/rv-popups.js', POPUPS], ['templates/_shared/et-runtime.js', RUNTIME]].forEach(function (f) {
    var es5 = (function () { try { esbuild.transformSync(f[1], { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('7 ' + f[0] + ' is ES5 by esbuild', es5 === true, es5);
  });
  var gen = T.commonJs({ title: 'x', pageUrl: 'https://a/e/x', scripts: [{ src: 'https://a/b.js', global: 'RevampSections' }] }) + '\n' + T.sectionJs({ id: 'x', title: 'x', ownJs: 'var a = 1;' });
  var es5 = (function () { try { esbuild.transformSync(gen, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
  check('7 the script it writes is ES5 too (another website may be old)', es5 === true, es5);
})();

function finish() {
  console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed — editor-dev-export');
  process.exit(failed ? 1 : 0);
}
