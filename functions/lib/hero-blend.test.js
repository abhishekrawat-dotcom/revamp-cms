/* The banner runs on into the page, and its white overlay can be set by hand (owner, 10 Nov 2026: "the hero banner …
   should be continued till the end of website in terms of website background color ending with hero background image
   color"; "an option to reduce opacity of the white overlay in the header banner manually"). Plain node. */
'use strict';
var fs = require('fs'), path = require('path');
var G = require('./gen-design'), H = require('./api')._testHooks, png = require('./png-lite');
var ROOT = path.join(__dirname, '..', '..');
var passed = 0, failed = 0;
function check(name, ok, info) { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (info !== undefined ? ' — ' + JSON.stringify(info).slice(0, 300) : '')); } }

/* 1. the page's colours from the colour the banner picture ends in */
var light = G.pageColoursFrom([186, 160, 134], 'light', '#1e1512');
check('a light site: the picture\'s warm stone, taken light enough to be a page; cards a step towards the text',
  light && light.backgroundColor === '#f0eae4' && light.surfaceColor === '#e3ddd8' && G.contrastOf(light.backgroundColor, '#1e1512') >= 7, light);
var dark = G.pageColoursFrom([186, 160, 134], 'dark', '#f4f1ec');
check('a dark site: the same colour taken dark enough, text still readable', dark && G.contrastOf(dark.backgroundColor, '#f4f1ec') >= 7 && dark.backgroundColor !== '#0b0b10', dark);
check('a green jungle edge gives a green-tinted light page', (function () { var j = G.pageColoursFrom([40, 90, 50], 'light', '#14161b'); return j && /^#[0-9a-f]{6}$/.test(j.backgroundColor) && parseInt(j.backgroundColor.slice(3, 5), 16) > parseInt(j.backgroundColor.slice(1, 3), 16); })());
check('kept as designed when the site\'s text would not read on it, or there is no colour', G.pageColoursFrom([186, 160, 134], 'light', '#bbbbbb') === null && G.pageColoursFrom(null, 'light') === null);

/* 2. the banner's foot fades into the page (only a picture banner) */
var withPic = G.heroCss({ image: 'https://x.test/hero.png', mode: 'light' }), noPic = G.heroCss({ mode: 'light' });
check('a picture banner fades at its foot into the page\'s background', /\.hero-root::after\{content:"";position:absolute;left:0;right:0;bottom:0;height:min\(30%,240px\);background:linear-gradient\(to bottom,rgba\(0,0,0,0\),var\(--rv-bg\)\)/.test(withPic));
check('a banner without a picture has no fade', !/hero-root::after/.test(noPic));

/* 3. the colour along a PNG's bottom edge */
var w = 40, h = 50, data = Buffer.alloc(w * h * 4);
for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var o = (y * w + x) * 4; var low = y >= 47; data[o] = low ? 40 : 250; data[o + 1] = low ? 90 : 250; data[o + 2] = low ? 50 : 250; data[o + 3] = 255; }
var bytes = png.encode({ width: w, height: h, data: data });
check('the bottom edge\'s colour is read from a PNG; a JPEG is left alone', JSON.stringify(H.bottomColour(bytes, 'image/png')) === '[40,90,50]' && H.bottomColour(bytes, 'image/jpeg') === null, H.bottomColour(bytes, 'image/png'));
/* lib/api.js and the route modules moved out of it as they were (BE-017): the AI site generation, the editor's chat, the Lovable import */
var API = ['api.js', 'api-generate.js', 'api-chat.js', 'api-import.js'].map(function (f) { return fs.readFileSync(path.join(__dirname, f), 'utf8'); }).join('\n');
check('a new site\'s page and cards take the banner\'s colour', /var runOn = heroImage\.heroBottom \? genDesign\.pageColoursFrom\(heroImage\.heroBottom, design\.mode, design\.textColor\) : null;/.test(API) &&
  /if \(runOn\) \{ design\.backgroundColor = runOn\.backgroundColor; design\.surfaceColor = runOn\.surfaceColor; design\.pageFromHero = true; \}/.test(API));

/* 4. the banner overlay by hand (Theme › Banner overlay) and through ETB2B AI */
var CANVAS = fs.readFileSync(path.join(ROOT, 'editor-canvas.js'), 'utf8'), ED = fs.readFileSync(path.join(ROOT, 'custom_editor.html'), 'utf8'), UI = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
check('the editor keeps it as a saved design rule: the veil\'s opacity, 100 = as designed', /var HERO_VEIL = '\[data-rv-section="hero"\] \.hero-veil';/.test(CANVAS) &&
  /if \(rules\.heroVeil != null\) css\.push\(HERO_VEIL \+ '\{ opacity: ' \+ Math\.max\(0, Math\.min\(100, rules\.heroVeil\)\) \/ 100 \+ ' !important; \}'\);/.test(CANVAS) &&
  /if \(n >= 100\) delete rules\.heroVeil; else rules\.heroVeil = n;/.test(CANVAS) && /if \(key === 'heroVeil'\) return !!doc\.querySelector\(HERO_VEIL\);/.test(CANVAS));
check('Theme has the "Banner overlay" slider, 0-100%', /\{ group: 'colors', key: 'heroVeil', label: 'Banner overlay', kind: 'range', min: 0, max: 100, step: 1, unit: '%', said: 'Banner overlay' \}/.test(ED));
check('…with a plain reason on a banner that has no separate overlay', /heroVeil: 'This banner has no separate white overlay over its picture to adjust\./.test(UI) && /'bgOpacity', 'heroVeil', 'bodyFont'/.test(UI));
check('ETB2B AI sets the same value instead of reworking the banner', /heroVeil: \[0, 100\]/.test(API) && /The banner\\'s white overlay \(the wash over its picture\) is `design\.heroVeil`/.test(API) && /never rework the banner for that/.test(API));
console.log('hero-blend: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
