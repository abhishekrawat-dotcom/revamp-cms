/* node functions/lib/hero-banner.test.js — a generated site never opens with an empty banner unexplained (the owner,
   18 Nov 2026: "I have created two events yesterday but both hero background banner was blank" — MarTech+ Summit 2027
   and DigiPlus Fest 2027: the planned banner showed dashboards, phones and a billboard, the picture model wrote words
   on them, the check refused it twice and the banner was left empty, with no word of it and no way to add one):
     1. the plan's banner and section pictures are told never to show what carries writing;
     2. a banner refused twice is followed by one plain banner (the site's colours in words, the place, nothing that
        carries writing), when there is time for it;
     3. the editor says when the banner has no picture, and offers Background picture on it.
   No network. Exits 1 on any failure. */
'use strict';
var fs = require('fs'), path = require('path');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 500) : '') + '\n');
}
['log', 'info', 'warn', 'error'].forEach(function (k) { console[k] = function () {}; });
var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var G = require('./api-generate')._testHooks;

/* 1. the plan's words */
var schema = JSON.stringify(G.DESIGN_PLAN_SCHEMA);
check('1 the banner: nothing that carries writing — screens, phones, dashboards, billboards, signs, posters named', /NOTHING THAT CARRIES WRITING/.test(schema) &&
  ['screen', 'phone', 'dashboard', 'chart', 'billboard', 'sign', 'poster'].every(function (w) { return schema.indexOf(w) !== -1; }));
check('1 a section picture: never a screen, phone, dashboard, chart, billboard, sign, poster or document', /Never a screen, phone, dashboard, chart, billboard, sign, poster or document in it/.test(schema));

/* 2. the plain banner */
var p = G.plainBannerPrompt({ themeColor: '#5B2A86', accentColor: '#C9A227', place: 'the Mumbai skyline' });
check('2 the plain banner: the site\'s colours in words, never as codes', /in violet and gold/.test(p) && !/#[0-9a-f]{3,6}/i.test(p), p);
check('2 …the place along its foot', /faint, distant silhouette of the Mumbai skyline/.test(p), p);
check('2 …nothing that carries writing, no people, text or logos, 16:9', /NOTHING in it carries writing: no screens, devices, signs/.test(p) && /no people, no text, no letters, no numbers, no logos/.test(p) && /Landscape, 16:9\.$/.test(p), p);
var bare = G.plainBannerPrompt({});
check('2 …with no colours or place known it still reads whole', !/ in \s*with| of \s*along|undefined/.test(bare) && /Landscape, 16:9\.$/.test(bare), bare);
check('2 colour words', G.colourWords('#ED1A3B') === 'red' && G.colourWords('#0B1F3A') === 'deep blue' && G.colourWords('#F4F1EA') === 'ivory' &&
  G.colourWords('#1E7F6B') === 'teal' && G.colourWords('#333333') === 'charcoal' && G.colourWords('nope') === '');
var GEN = read('functions/lib/api-generate.js');
check('2 a banner refused twice is followed by the plain banner when 45 s are left, and the plan says so (heroImagePlain)',
  G.FALLBACK_BANNER_MS === 45000 && /got\.error && got\.refused && o\.fallback && \(!o\.deadlineAt \|\| o\.deadlineAt - Date\.now\(\) >= FALLBACK_BANNER_MS\)/.test(GEN) &&
  /fallback: plainBannerPrompt\(design\)/.test(GEN) && /design\.heroImagePlain = true/.test(GEN));

/* 3. the editor */
var ED = read('editor-template-ui.js');
check('3 a banner with no picture has Background picture (RevampAiPicture\'s veil spot), and adding one goes behind the veil',
  /emptyBannerSpot\(sec\) \? '<button data-action="section-background"/.test(ED.replace(/\|\| emptyBannerSpot\(sec\) \?/, 'emptyBannerSpot(sec) ?')) &&
  /action === 'section-background' && emptyBannerSpot\(sec\)/.test(ED) && /tg && tg\.how === 'veil' \? tg : null/.test(ED) && /P\.place\(spot, url, '', aiPictureHelpers\(\)\)/.test(ED));
check('3 the editor says the banner has no picture, why, and how to add one — on opening',
  /'The banner has no picture\. ' \+ \(why \? why \+ ' ' : ''\) \+ 'Add one: select the banner, then Background picture\.'/.test(ED) &&
  /logoUnitNotice\(\);\n      heroPictureNotice\(\);/.test(ED) && /label: empty \? 'Add a picture' : 'Replace it'/.test(ED));

process.stdout.write('hero-banner: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
