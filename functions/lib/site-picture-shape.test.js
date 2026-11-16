/* node functions/lib/site-picture-shape.test.js — a site's own first pictures have their frame's shape.
   The owner, 16 Nov 2026: "AI has created a square image for a rectangular placeholder". ET DAVOS 2027's banner and its
   overview picture were made 1024 x 1024: site generation never told the picture model a shape, and it answers a square
   then, whatever its words say ("Landscape, 16:9.", "Landscape, 4:3."). Now (lib/api-generate.js, lib/picture-shape.js):
     - the banner is asked for 16:9 and cut to exactly 16:9;
     - a section's picture is asked for in the shape its planned layout gives it (a band 21:9, across the section 16:9,
       beside the words 4:3), its words say that shape, it is cut to exactly it, and the section's code is told to give
       its frame that shape at every screen width;
     - the dashboard's first banner (lib/ai-hero.js) and a phone's banner (lib/phone-banner.js) are cut to 16:9 and 9:16.
   No network and no paid AI: the picture model and Storage are stood in for, the pictures made here with sharp. */
'use strict';
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 500) : '')); }

var sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }
/* the picture model's answer for each shape it is asked for, at the size it really answers in */
var MODEL_SIZE = { '1:1': [1024, 1024], '16:9': [1344, 768], '21:9': [1536, 672], '4:3': [1184, 864], '9:16': [768, 1344] };
var gemini = require('./gemini');
var calls = [];
gemini.callGeminiImage = function (prompt, opts) {
  calls.push({ prompt: prompt, opts: opts });
  var size = MODEL_SIZE[opts && opts.aspectRatio] || MODEL_SIZE['1:1'];
  return sharp({ create: { width: size[0], height: size[1], channels: 3, background: { r: 30, g: 60, b: 120 } } }).png().toBuffer()
    .then(function (b) { return { mimeType: 'image/png', base64: b.toString('base64') }; });
};
var pictures = require('./pictures');
pictures.storeVariants = function () { return Promise.resolve(null); };
var shape = require('./picture-shape');

function fakeFb() {
  var saved = {};
  return { saved: saved, bucket: { name: 'test-bucket', file: function (p) {
    return { save: function (buf, opts) { saved[p] = { buf: buf, opts: opts }; return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } };
  } }, db: null };
}
function sizeOf(buf) { return sharp(buf).metadata().then(function (m) { return [m.width, m.height, m.format]; }); }

(async function () {
  /* the layouts ET DAVOS 2027's plan wrote, read for their picture's shape */
  ok(shape.shapeForLayout('An asymmetric typographic split: a giant red condensed-italic statement across seven columns on the left, and a five-column body paragraph on the right. The picture fills the side of the section that its words leave empty; nothing stands alone in a half-empty column.') === '4:3',
    'the overview\'s split: the picture beside the words is 4:3 ("across seven columns" is the statement, not the picture)');
  ok(shape.shapeForLayout('A full-width lead photo above a row of four tall portrait cards with large red outlined numerals') === '16:9', 'a full-width lead photo across the section is 16:9');
  ok(shape.shapeForLayout('A full-width photo with a white-to-transparent gradient on the left carrying a red condensed-italic headline') === '16:9', 'a full-width photo is 16:9');
  ok(shape.shapeForLayout('A picture-left, text-right split with the six Cs as a 2x3 list of red initial-letter tiles') === '4:3', 'picture left, text right is 4:3');
  ok(shape.shapeForLayout('A slim panoramic photo band under the heading, then three cards') === '21:9' && shape.shapeForLayout('a photo strip across the top') === '21:9', 'a picture as a band or a strip is 21:9');
  ok(shape.shapeForLayout('One full-width band on the surface tint with four huge red numerals in a row') === '4:3' && shape.shapeForLayout('') === '4:3' && shape.shapeForLayout(null) === '4:3',
    'a band of numbers holds no picture: the default 4:3');
  ok(shape.SITE_SHAPES.every(function (a) { return shape.ratioOf(a) > 1; }), 'a site\'s own section pictures are landscape (a phone shows them at full width)');

  if (!sharp) {
    console.log('site-picture-shape: sharp is not on this machine; the pictures themselves are not checked here');
  } else {
    var hooks = require('./api')._testHooks;
    var fb = fakeFb(), design = { mode: 'light', themeColor: '#d62d20', accentColor: '#1f2a44' };
    /* the banner */
    calls.length = 0;
    var hero = await hooks.buildHeroImage(fb, 'qa-shape', { theme: 'Davos' }, '#d62d20', 'A wide key visual. Landscape, 16:9.', '20261116000000');
    var heroSaved = fb.saved['events/qa-shape/generated/20261116000000-hero-bg.png'];
    var heroSize = heroSaved ? await sizeOf(heroSaved.buf) : [];
    ok(calls.length === 1 && calls[0].opts.aspectRatio === '16:9' && hooks.HERO_SHAPE === '16:9', 'the banner is asked for 16:9 (it was asked for nothing, and came back square)', calls.map(function (c) { return c.opts; }));
    ok(hero.heroImageUrl && heroSize[0] === 1344 && heroSize[1] === 756 && heroSaved.opts.metadata.contentType === 'image/png' && Array.isArray(hero.heroBottom),
      'and stored cut to exactly 16:9 (the model\'s 1344 x 768 is 1344 x 756), its bottom colour still read', { hero: hero, size: heroSize });
    /* a section's picture in each shape */
    var cases = [['what-awaits', '16:9', [1344, 756]], ['moments', '21:9', [1536, 658]], ['overview', '4:3', [1152, 864]], ['odd', '9:16', [1152, 864]]];
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      calls.length = 0;
      var made = await hooks.buildSectionImage(fb, 'qa-shape', c[0], 'a calm Alpine town in snow at dusk', design, '20261116000000', 'It illustrates a section.', 'ET DAVOS 2027', '', 'place', c[1]);
      var want = shape.SITE_SHAPES.indexOf(c[1]) !== -1 ? c[1] : '4:3';
      var saved = fb.saved['events/qa-shape/generated/20261116000000-' + c[0] + '.png'];
      var got = saved ? await sizeOf(saved.buf) : [];
      ok(made && made.shape === want && calls[0].opts.aspectRatio === want && got[0] === c[2][0] && got[1] === c[2][1] &&
        calls[0].prompt.indexOf(shape.WORDS[want]) !== -1 && (want === '4:3' || calls[0].prompt.indexOf('Landscape, 4:3.') === -1),
        'a section picture asked for ' + c[1] + ': made ' + want + ', its words say so, and cut to it (' + c[2].join(' x ') + ')', { made: made, opts: calls[0] && calls[0].opts, got: got, words: calls[0] && calls[0].prompt.slice(-260) });
    }
    /* the section's code is told the frame's shape */
    var plan = { design: design, sections: [
      { id: 'overview', kind: 'custom', purpose: 'What this is', layout: 'picture left, text right', image: 'Davos in snow', imageKind: 'place', imageUrl: 'https://storage.googleapis.com/b/events/qa-shape/generated/x-overview.png', imageShape: '4:3' },
      { id: 'what-awaits', kind: 'custom', purpose: 'What awaits', layout: 'A full-width lead photo above four cards', image: 'the Promenade', imageKind: 'place', imageUrl: 'https://storage.googleapis.com/b/events/qa-shape/generated/x-what-awaits.png', imageShape: '16:9' },
      { id: 'older', kind: 'custom', purpose: 'A site planned before', layout: 'picture beside text', image: 'a hall', imageKind: 'place', imageUrl: 'https://storage.googleapis.com/b/events/qa-shape/generated/x-older.png' }
    ] };
    var prompt = hooks.buildSectionCodePrompt({ designPlan: plan, eventMeta: { name: 'ET DAVOS 2027' } });
    ok(/Section "overview" has a picture, already made\.[^\n]*It was made 4:3: its frame is exactly that shape at every screen width \(aspect-ratio: 4 \/ 3, sized by its width, with no height, min-height or max-height of its own\), and the picture fills it \(width: 100%; height: 100%; object-fit: cover\)\./.test(prompt) &&
      /Section "what-awaits" has a picture[^\n]*It was made 16:9: [^\n]*aspect-ratio: 16 \/ 9/.test(prompt),
      'the section\'s code gives each picture\'s frame the shape it was made in', prompt.split('\n').filter(function (l) { return /has a picture/.test(l); }));
    ok(/Section "older" has a picture[^\n]*at least 460px tall on desktop, object-fit: cover/.test(prompt) && !/Section "older"[^\n]*It was made/.test(prompt),
      'a plan from before shapes were kept is written as before');
    var gd = require('./gen-design');
    ok(/the aspect-ratio its frame was given, else 16\/10/.test(gd.MOBILE_RULES), 'on a phone a picture\'s frame keeps the aspect-ratio it was given');
    /* the dashboard's first banner and a phone's banner, read from their source: cut to their own shapes */
    var fs = require('fs'), path = require('path');
    var aiHero = fs.readFileSync(path.join(__dirname, 'ai-hero.js'), 'utf8'), phone = fs.readFileSync(path.join(__dirname, 'phone-banner.js'), 'utf8');
    ok(/pictureShape\.crop\(bytes, pictureShape\.ratioOf\(chatPicture\.WIDE_ASPECT\)/.test(aiHero), 'the dashboard\'s first banner is cut to exactly 16:9');
    ok(/pictureShape\.crop\(bytes, pictureShape\.ratioOf\(ASPECT\)/.test(phone) && /var ASPECT = '9:16'/.test(phone), 'a phone\'s banner is cut to exactly 9:16');
  }

  if (failures.length) { console.error('site-picture-shape: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('site-picture-shape: all ' + checks + ' checks passed');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
