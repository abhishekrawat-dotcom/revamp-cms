/* node functions/lib/site-a11y.test.js — exits 1 on the first failure it lists.
   Accessibility and search on a published page (lib/site-a11y.js, lib/site-seo.js, the reading colours of
   templates/_shared/rv-theme.js), and the page pass as the publish transform runs it (lib/api.js). No network. */
const A = require('./site-a11y');
const S = require('./site-seo');
const T = require('../../templates/_shared/rv-theme.js');
const hooks = require('./api')._testHooks;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function count(text, needle) { return text.split(needle).length - 1; }

/* ---- reading colours ---- */
['#f42a58', '#ed1c24', '#186bf9', '#f5d000', '#0044cc', '#ff5e14', '#e4002b', '#2bb673', '#808080', '#ffffff', '#000000', '#7c3aed', '#14b8a6'].forEach(function (c) {
  var fill = T.fillFor(c), ink = T.inkOn(fill);
  ok(T.contrast(fill, ink) >= 4.5, 'a ' + c + ' button\'s words read (4.5:1) on its ground', fill + ' / ' + ink + ' = ' + T.contrast(fill, ink).toFixed(2));
  ok(T.contrast(T.readableOn(c, ['#ffffff', '#f4f5f7']), '#f4f5f7') >= 4.5 && T.contrast(T.readableOn(c, ['#0c0d11', '#17181f']), '#17181f') >= 4.5, c + ' as text reads on light and on dark panels');
});
ok(T.fillFor('#186bf9') === '#186bf9' && T.inkOn('#186bf9') === '#ffffff', 'a brand colour white already reads on is left as it is');
ok(T.fillFor('#f5d000') === '#f5d000' && T.inkOn('#f5d000') === '#14161b', 'a light brand colour keeps its colour and gets dark words');
var pinkFill = T.fillFor('#f42a58');
ok(pinkFill !== '#f42a58' && T.contrast(pinkFill, '#f42a58') < 1.25 && T.inkOn(pinkFill) === '#ffffff', 'a mid-tone (pink) keeps white words on a shade only a little deeper', pinkFill);
ok(T.contrast(T.fillFor('#ed1c24'), '#ed1c24') < 1.05, 'ET red barely moves', T.fillFor('#ed1c24'));
var v = T.varsOf(T.themesFor({ mode: 'light', themeColor: '#f42a58', accentColor: '#f13411', backgroundColor: '#f5f3ee', surfaceColor: '#f5e7e5' })[0]);
ok(v['--rv-on-theme'] && v['--rv-theme-fill'] && v['--rv-theme-ink'] && v['--rv-on-accent'] && v['--rv-accent-ink'], 'a theme carries its reading colours', JSON.stringify(v));

/* ---- the palette on <body> ---- */
var STYLE = '--theme-color:#f42a58;--accent-color:#f13411;--heading-font-family:"Fraunces", Arial, sans-serif;--rv-bg:#f5f3ee;--rv-surface:#f5e7e5;--rv-text:#1a1414;--rv-muted:#8a8080;font-size:18px';
var withVars = A.readingVars(STYLE);
ok(/--rv-on-theme:#ffffff/.test(withVars) && /--rv-theme-fill:#/.test(withVars) && /--rv-theme-ink:#/.test(withVars), 'the reading colours go on <body>', withVars);
ok(/--heading-font-family:"Fraunces", Arial, sans-serif/.test(withVars) && /font-size:18px/.test(withVars), 'the rest of the style is kept');
var pal = A.palette(withVars);
ok(T.contrast(pal.muted, '#f5e7e5') >= 4.5 && /--rv-muted:#/.test(withVars) && !/--rv-muted:#8a8080/.test(withVars), 'quiet text that does not read on the panels is made to', pal.muted);
ok(A.readingVars(withVars) === withVars, 'setting them again changes nothing');

/* ---- the contrast guard ---- */
var css = [
  '[data-rv-section="x"]{position:relative}',
  '[data-rv-section="x"] .x-kicker{font-size:0.875rem;font-weight:700;color:var(--theme-color)}',
  '[data-rv-section="x"] .x-btn{background:var(--theme-color);color:#fff;padding:12px}',
  '[data-rv-section="x"] .x-btn:hover{background:var(--accent-color);color:#fff}',
  '[data-rv-section="x"] .x-title{font-size:40px;color:var(--theme-color)}',
  '[data-rv-section="x"] .x-title span{color:var(--theme-color)}',
  '[data-rv-section="x"] .x-icon{color:var(--accent-color)}',
  '[data-rv-section="x"] .x-note{color:#9a9090}',
  '[data-rv-section="x"] .x-white{color:#ffffff}',
  '[data-rv-section="x"] .x-body{color:var(--rv-text)}'
].join('\n');
var g = A.guardCss(css, 'x', pal);
ok(/\.x-kicker\{[^}]*color:var\(--rv-theme-ink,var\(--theme-color\)\)/.test(g), 'the brand colour as small text becomes the readable brand ink', g);
ok(/\.x-btn\{background:var\(--rv-theme-fill,var\(--theme-color\)\);color:var\(--rv-on-theme,#fff\)/.test(g), 'a brand button takes the readable button ground and words');
ok(/\.x-btn:hover\{background:var\(--accent-color\);color:#fff\}/.test(g), 'a hover state is left alone');
ok(/\.x-title\{font-size:40px;color:var\(--theme-color\)\}/.test(g) && /\.x-title span\{color:var\(--theme-color\)\}/.test(g), 'large text (3:1 is enough) is left alone, and what sits inside it');
ok(/\.x-icon\{color:var\(--accent-color\)\}/.test(g), 'an icon\'s colour is not text');
var note = /\.x-note\{color:(#[0-9a-f]{6})\}/.exec(g);
ok(note && note[1] !== '#9a9090' && T.contrast(note[1], '#f5e7e5') >= 4.5 && T.contrast(note[1], '#f5f3ee') >= 4.5, 'a fixed grey that nearly reads is taken darker until it does', note && note[1]);
ok(/\.x-white\{color:#ffffff\}/.test(g), 'a colour far from reading here was meant for another ground: left alone');
ok(/\.x-body\{color:var\(--rv-text\)\}/.test(g), 'text that reads is left alone');
ok(A.guardCss(g, 'x', pal) === g, 'guarding again changes nothing');
var mixed = css + '\n[data-rv-section="x"] .x-card{background:#111111}';
ok(/\.x-note\{color:#9a9090\}/.test(A.guardCss(mixed, 'x', pal)) && /\.x-btn\{background:var\(--rv-theme-fill/.test(A.guardCss(mixed, 'x', pal)), 'a section that also paints a dark ground: words without a ground of their own are left alone, buttons are still fixed');
var dark = '[data-rv-section="f"].ft,[data-rv-section="f"] .ft{background-color:#0b1120;color:#f8f9fa}\n[data-rv-section="f"] .ft-legal{font-size:0.875rem;color:#64748b}';
var gd = A.guardCss(dark, 'f', pal), legal = /\.ft-legal\{[^}]*color:(#[0-9a-f]{6})/.exec(gd);
ok(legal && T.contrast(legal[1], '#0b1120') >= 4.5, 'a section with its own dark ground: its grey legal line is taken lighter until it reads', legal && legal[1]);
var hero = '[data-rv-section="hero"]{background-image:url("x.jpg")}\n[data-rv-section="hero"] .t{color:#777777}\n[data-rv-section="hero"] .b{background:var(--theme-color);color:#ffffff}';
var gh = A.guardCss(hero, 'hero', pal);
ok(/\.t\{color:#777777\}/.test(gh) && /\.b\{background:var\(--rv-theme-fill/.test(gh), 'over a picture only what paints its own ground is measured');
ok(A.guardCss('not css {{{', 'x', pal) === 'not css {{{', 'a sheet that does not parse is left as it is');
var bandCss = '[data-rv-section="b"].b,[data-rv-section="b"] .b{background:var(--theme-color);padding:40px}\n[data-rv-section="b"] .b-text{font-size:1rem;color:#ffffff}';
var gb = A.guardCss(bandCss, 'b', pal);
ok(/\.b\{background:var\(--rv-theme-fill,var\(--theme-color\)\)/.test(gb) && /\.b-text\{font-size:1rem;color:#ffffff\}/.test(gb) && A.guardCss(gb, 'b', pal) === gb, 'a band in the brand colour with white words takes the readable ground, its words stay white', gb);
var lit = A.guardCss('[data-rv-section="x"] .y{background:#f42a58;color:#fff}', 'x', pal);
ok(/\.y\{background:var\(--rv-theme-fill,var\(--theme-color\)\);color:var\(--rv-on-theme,#fff\)\}/.test(lit), 'a button painted in the brand colour\'s very value is treated as a brand button', lit);
var palBlue = A.palette(A.readingVars('--theme-color:#0a3d91;--accent-color:#f5a623;--rv-bg:#ffffff;--rv-surface:#f4f5f7;--rv-text:#14161b;--rv-muted:#545b66'));
var gblue = A.guardCss('[data-rv-section="x"] .btn{background:var(--theme-color);color:#fff}\n[data-rv-section="x"] .note{color:#999999}', 'x', palBlue);
ok(!/#999999/.test(gblue), 'a dark brand button does not make its section count as two-toned', gblue);

/* ---- zoom and the outline of headings ---- */
ok(A.viewportContent('width=device-width, initial-scale=1, maximum-scale=5, minimum-scale=1, user-scalable=0') === 'width=device-width, initial-scale=1, maximum-scale=5, minimum-scale=1', 'zoom allowed, minimum-scale kept');
ok(A.viewportContent('width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no') === 'width=device-width, initial-scale=1', 'a maximum-scale under 5 goes too');
function levels(list) { return A.headingLevels(list.map(function (l) { return typeof l === 'number' ? { level: l } : { level: l[0], inTemplate: true }; })).map(function (r) { return r.level; }).join(','); }
ok(levels([1, 2, 4, 4, 2, 3]) === '1,2,3,3,2,3', 'a skipped level is announced one below, siblings level with each other', levels([1, 2, 4, 4, 2, 3]));
ok(levels([2, 5, 5, 5]) === '2,3,3,3', 'footer h5s after an h2', levels([2, 5, 5, 5]));
ok(levels([1, 2, [5], 5, 5]) === '1,2,3,3,3', 'a heading inside a <template> takes the level of where it stands', levels([1, 2, [5], 5, 5]));
ok(levels([3, 2, 1]) === '3,2,1', 'going up a level is always fine');

/* ---- the page pass, as the transform runs it ---- */
var PAGE = [
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, minimum-scale=1, user-scalable=0">',
  '<title>T</title></head>',
  '<body id="gen" data-rv-template-id="gen-qa-x" class="microsite rv-generated" style="' + STYLE.replace(/"/g, '&quot;') + '">',
  '<div id="content"><div class="col-md-12 no-padding">',
  '<header data-rv-section="nav" id="nav"><a href="#hero">X</a></header><style data-rv-style="nav">[data-rv-section="nav"] .c{background:var(--theme-color);color:#ffffff}</style>',
  '<section data-rv-section="hero" id="hero"><h1>Summit</h1><img class="rv-lu-img" src="https://x/logo.svg" alt="Logo"><video poster="https://x/poster.jpg"></video></section>',
  '<style data-rv-style="hero">[data-rv-section="hero"]{background-image:url("https://x/hero.jpg")}</style>',
  '<section data-rv-section="speakers" id="speakers"><h2>Speakers</h2><template data-rv-repeat-template="speakers"><article><h4>Name</h4></article></template><article><h4>Asha</h4><img src="https://x/a.jpg"></article></section>',
  '<style data-rv-style="speakers">[data-rv-section="speakers"] .k{font-size:14px;color:var(--theme-color)}</style>',
  '<footer data-rv-section="footer" id="footer" data-rv-et-footer="brandequity"><p>f</p></footer>',
  '</div></div></body></html>'
].join('\n');
var EVENT = { name: 'QA Summit </script><b>', start: '2027-02-05T10:00', end: '2027-02-06T18:00', venue: 'Taj Lands End', city: 'Mumbai', dateMode: 'exact', description: 'Two days.' };
var live = hooks.publishTransform(PAGE, { eventId: 'qa-x', event: EVENT, mode: 'live', templateId: 'gen-qa-x', publicBase: 'https://cms.example' });
ok(/<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, minimum-scale=1">/.test(live), 'the published page allows zoom');
ok(/<img src="https:\/\/x\/a\.jpg" alt="">/.test(live) && /alt="Logo"/.test(live), 'a picture without alt text gets alt="", one with it keeps it');
ok(/<h4 aria-level="3" data-rv-level="">Asha<\/h4>/.test(live) && /<template data-rv-repeat-template="speakers"><article><h4 aria-level="3" data-rv-level="">Name/.test(live), 'the skipped heading level is announced one below, in the repeat template too');
ok(/<\/style>\n<main data-rv-main><section data-rv-section="hero"/.test(live) && /<\/main><footer data-rv-section="footer"/.test(live) && count(live, '<main') === 1, 'the sections between the top bar and the footer are the main landmark', (live.match(/[^\n]{0,40}<\/?main[^\n]{0,40}/g) || []).join(' | '));
ok(/--rv-on-theme:#ffffff/.test(live) && /\.c\{background:var\(--rv-theme-fill,var\(--theme-color\)\);color:var\(--rv-on-theme,#ffffff\)\}/.test(live), 'an AI-designed site: the reading colours on <body>, the top bar\'s button reads');
ok(/\.k\{font-size:14px;color:var\(--rv-theme-ink,var\(--theme-color\)\)\}/.test(live), 'an AI-designed site: brand-coloured small text reads');
var ld = /<script type="application\/ld\+json" data-rv-seo>([^<]*)<\/script>/.exec(live);
var data = ld && JSON.parse(ld[1]);
ok(data && data['@type'] === 'Event' && data.startDate === '2027-02-05T10:00:00+05:30' && data.endDate === '2027-02-06T18:00:00+05:30' && data.location.name === 'Taj Lands End' &&
  data.location.address.addressLocality === 'Mumbai' && data.url === 'https://cms.example/e/qa-x' && data.organizer.name === 'ETBrandEquity.com', 'the schema.org Event, from the event, India time, the portal as organiser', ld && ld[1]);
ok(data && data.name === 'QA Summit </script><b>' && ld[1].indexOf('</script') === -1, 'the name is kept and cannot end the script block');
ok(/<meta property="og:image" content="https:\/\/x\/hero\.jpg" data-rv-seo>/.test(live) && /<meta name="twitter:card" content="summary_large_image"/.test(live) && data.image[0] === 'https://x/hero.jpg', 'no share picture set: the hero\'s picture is the link preview (not its SVG logo)');
ok(/<meta name="robots" content="index, follow, max-image-preview:large" data-rv-seo>/.test(live) && !/noindex/.test(live), 'a live page may be indexed, with large previews');
ok(hooks.publishTransform(live, { eventId: 'qa-x', event: EVENT, mode: 'live', templateId: 'gen-qa-x', publicBase: 'https://cms.example' }) === live, 'running the transform again changes nothing');
ok(hooks.sitePagePass(live, { mode: 'live', event: EVENT, templateId: 'gen-qa-x' }) === live, 'the pass on a page that already had it (as /e/ serves it) changes nothing');
var preview = hooks.publishTransform(PAGE, { eventId: 'qa-x', event: EVENT, mode: 'preview', templateId: 'gen-qa-x' });
ok(/noindex/.test(preview) && !/max-image-preview/.test(preview), 'a preview stays noindex');
var shared = hooks.publishTransform(PAGE, { eventId: 'qa-x', event: Object.assign({}, EVENT, { settings: { seo: { shareImageUrl: 'https://x/share.jpg' } } }), mode: 'live', templateId: 'gen-qa-x', publicBase: 'https://cms.example' });
ok(count(shared, 'property="og:image"') === 1 && /og:image" content="https:\/\/x\/share\.jpg"/.test(shared), 'the owner\'s share picture wins');
var tbd = hooks.publishTransform(PAGE, { eventId: 'qa-x', event: { name: 'X', dateMode: 'tbd' }, mode: 'live', templateId: 'gen-qa-x' });
ok(tbd.indexOf('application/ld+json') === -1, 'no Event without a date');
var imported = PAGE.replace('data-rv-template-id="gen-qa-x"', 'data-rv-template-id="imported-imp-x"').replace('id="gen"', 'id="imported"').replace(' class="microsite rv-generated"', '');
var imp = hooks.publishTransform(imported, { eventId: 'qa-x', event: EVENT, mode: 'live', templateId: 'imported-imp-x' });
ok(imp.indexOf('<main') === -1 && /\.k\{font-size:14px;color:var\(--theme-color\)\}/.test(imp), 'an imported page keeps its own structure and colours');
var hasMain = PAGE.replace('<section data-rv-section="hero"', '<main><section data-rv-section="hero"').replace('<footer', '</main><footer');
ok(count(hooks.publishTransform(hasMain, { eventId: 'qa-x', event: EVENT, mode: 'live', templateId: 'gen-qa-x' }), '<main') === 1, 'a page with its own main gets no second one');
ok(hooks.sitePagePass('<p>broken <b', { mode: 'live' }) === '<p>broken <b', 'a page it cannot read is left as it is');

/* ---- search engines ---- */
var robots = S.robotsTxt('https://cms.example');
ok(/Allow: \/e\//.test(robots) && /Disallow: \/preview\//.test(robots) && /Disallow: \/api\//.test(robots) && /Allow: \/api\/public\//.test(robots) && /Sitemap: https:\/\/cms\.example\/sitemap\.xml/.test(robots), 'robots.txt: sites crawlable, previews and the API not, the sitemap named');
var map = S.sitemapXml([{ loc: 'https://cms.example/e/a&b', lastmod: '2026-10-19T10:12:21.799Z' }, { loc: 'javascript:x' }]);
ok(/<loc>https:\/\/cms\.example\/e\/a&amp;b<\/loc><lastmod>2026-10-19T10:12:21Z<\/lastmod>/.test(map) && map.indexOf('javascript') === -1, 'sitemap: escaped, only web addresses', map);
ok(S.isoDate('2027-02-30T25:00') === '' && S.isoDate('2027-02-05') === '2027-02-05' && S.eventJsonLd({ name: 'X', start: '2027-02-05T10:00', end: '2027-02-04T10:00' }, {}).endDate === undefined, 'impossible times and an end before the start are left out');

if (failures.length) {
  console.error('site-a11y: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('site-a11y: all ' + checks + ' checks passed');
