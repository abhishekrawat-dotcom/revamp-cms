// node functions/lib/logo-crop.test.js — a previous edition's sponsors cropped out of its logo unit
// (api.js: ownUnitBox, cropToOwnUnit, cropSvgToOwnUnit; svg-year.js: cropTo), on drawings made here and on
// the real lock-up it first failed on: "SAMSUNG Ads & ShareChat moj / PRESENT" above the event's own
// lock-up and "IN ASSOCIATION WITH / HAVAS Media Network" below it, so that no one box could hold the
// extras and nothing else, and the lock-up was an SVG drawn as outlines, which was never cropped at all.
// No network: the model's readings are given here as it gave them.
const fs = require('fs'), path = require('path');
/* the model's readings, replayed: api.js takes callGeminiJson from gemini.js when it is loaded, so it is
   replaced before. Each answer is picked by the height of the picture shown (the whole lock-up, or the cut). */
const gemini = require('./gemini');
var answers = null, asked = 0;
gemini.callGeminiJson = function (prompt, schema, opts) {
  asked++;
  var shown = require('./png-lite').decode(Buffer.from(opts.images[0].data, 'base64'));
  var answer = answers && answers(shown);
  return Promise.resolve(answer ? { parsed: answer } : { error: { code: 'ai-config' } });
};
const hooks = require('./api.js')._testHooks;
const png = require('./png-lite');
const sy = require('./svg-year');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail ? ' — ' + detail : '')); }

/* The failing shape, small: a 500 x 300 drawing shown at half size. Extras above (a row of sponsor marks
   and a "present" line) and below ("in association with" and a partner); the event's own lock-up between:
   the publisher's mark, an emblem, a divider, the name in two lines and a script word across both. */
function r(x, y, w, h, fill, more) { return '<path' + (more || '') + ' d="M' + x + ' ' + y + 'h' + w + 'v' + h + 'h-' + w + 'z" fill="' + fill + '"/>'; }
var TOP = r(20, 10, 100, 30, '#000') + r(135, 20, 10, 10, '#777') + r(170, 10, 130, 30, '#f5a623') + r(320, 10, 40, 30, '#ffd400') +
  r(220, 52, 60, 6, '#000');                                                     // "SAMSUNG Ads & ShareChat moj" / "PRESENT"
var OWN = r(150, 80, 180, 15, '#e4002b') +                                       // the publisher's mark
  r(10, 110, 80, 90, '#fd1458') + r(110, 110, 2, 90, '#444') +                   // emblem, divider
  r(130, 110, 360, 40, '#000') + r(130, 160, 170, 40, '#000') + r(340, 140, 100, 75, '#e4002b');   // "Brand World" / "Summit" / "South"
var BOTTOM = r(190, 228, 120, 6, '#000') + r(150, 250, 200, 40, '#e4002b');      // "IN ASSOCIATION WITH" / "HAVAS"
function drawing(inner, attrs) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300" width="250" height="150"' + (attrs || '') + '>' + inner + '</svg>'; }
var LOCKUP = drawing(TOP + OWN + BOTTOM);
/* the reading, as the model gives it: boxes in the pixels of the 1000 px drawing it was shown (2 px a unit) */
function px(x, y, w, h) { return { x: x * 2, y: y * 2, width: w * 2, height: h * 2 }; }
var READ = { extras: 'SAMSUNG Ads & ShareChat moj PRESENT IN ASSOCIATION WITH HAVAS', ownBox: px(0, 76, 500, 142),
  extraBoxes: [px(15, 5, 350, 56), px(145, 224, 210, 70)] };

(async function () {
  var clearR = await hooks.rasterise(LOCKUP, { clear: true });
  if (!clearR) { check('resvg draws an SVG here', false); return finish(); }
  var clear = png.decode(clearR.png);
  check('rasterise { clear }: drawn on nothing', clear && clear.width === 1000 && clear.height === 600 && png.hasTransparency(clear));
  var grey = await hooks.rasterise(LOCKUP);
  check('rasterise: still on grey by default', grey && !png.hasTransparency(png.decode(grey.png)));
  var small = await hooks.rasterise(LOCKUP, { clear: true, width: 250 });
  check('rasterise { width }: drawn that wide', small && small.width === 250 && small.height === 150);

  /* ---- the reading the model used to be asked for could not describe this shape ---- */
  check('a reading with no own lock-up and no extras\' boxes (as the old one was) is not cut', hooks.ownUnitBox(clear, { extras: READ.extras, ownBox: null, extraBoxes: [] }) === null);
  check('the reading asks where the event\'s own lock-up is and where each group of extras is, not for one box round all of them',
    hooks.LOGO_READ_SCHEMA.properties.ownBox && hooks.LOGO_READ_SCHEMA.properties.extraBoxes && !hooks.LOGO_READ_SCHEMA.properties.unitBox &&
    hooks.LOGO_READ_SCHEMA.required.indexOf('ownBox') !== -1 && hooks.LOGO_READ_SCHEMA.required.indexOf('extraBoxes') !== -1);

  /* ---- the cut, on the pixels ---- */
  var keep = hooks.ownUnitBox(clear, READ);
  check('extras above and below are both cut away', keep && keep.y > 116 && keep.y < 160 && keep.y + keep.height > 430 && keep.y + keep.height < 456, JSON.stringify(keep));
  check('nothing of the lock-up is cut: the publisher\'s mark, the emblem and the script word are all inside',
    keep && keep.y <= 160 && keep.x <= 20 && keep.x + keep.width >= 980 && keep.y + keep.height >= 430, JSON.stringify(keep));
  var cutPng = hooks.cropToOwnUnit(clear, READ);
  check('cropToOwnUnit: that box, as a picture', cutPng && cutPng.width === keep.width && cutPng.height === keep.height);
  var onWhite = png.flatten(clear, [255, 255, 255]);
  var keepWhite = hooks.ownUnitBox(onWhite, READ);
  check('an opaque picture is cut the same way (its ground read from its edges)', keepWhite && Math.abs(keepWhite.y - keep.y) <= 1 && Math.abs(keepWhite.height - keep.height) <= 2, JSON.stringify(keepWhite));

  /* ---- the cut, on the drawing ---- */
  var cut = await hooks.cropSvgToOwnUnit(LOCKUP, READ);
  var vb = cut && sy.viewBoxOf(cut);
  check('cropSvgToOwnUnit: the drawing is cut down to its own lock-up', vb && vb.y > 58 && vb.y < 80 && vb.y + vb.height > 215 && vb.y + vb.height < 228 && vb.x <= 10 && vb.x + vb.width >= 490, JSON.stringify(vb));
  check('…shown at the scale it was', cut && Math.abs(parseFloat(/\swidth="([\d.]+)"/.exec(cut)[1]) - vb.width / 2) < 0.01 && Math.abs(parseFloat(/\sheight="([\d.]+)"/.exec(cut)[1]) - vb.height / 2) < 0.01);
  check('…with the extras\' shapes gone from the file and every shape of its own still there', cut && sy.shapesIn(cut).length === 6 && cut.indexOf('#f5a623') === -1 && cut.indexOf('d="M150 250') === -1, cut && sy.shapesIn(cut).length);
  var again = cut && png.decode((await hooks.rasterise(cut, { clear: true })).png);
  var ownOnly = png.decode((await hooks.rasterise(drawing(OWN), { clear: true })).png);
  check('…and drawn, it is exactly the lock-up drawn on its own', again && png.inkRuns(png.inkProfile(again, 'y', null)).length === 2 &&
    Math.abs(png.inkBounds(again, { x: 0, y: 0, width: again.width, height: again.height }, null).height / again.width -
      png.inkBounds(ownOnly, { x: 0, y: 0, width: 1000, height: 600 }, null).height / 1000) < 0.01);

  /* ---- where a clean cut cannot be made, nothing is cut (the owner is told the extras are still there) ---- */
  check('an extras box round the whole picture says nothing: not cut', hooks.ownUnitBox(clear, { extras: 'x', ownBox: READ.ownBox, extraBoxes: [px(0, 0, 500, 300)] }) === null);
  check('…but beside boxes that do say where they are, it is only ignored', !!hooks.ownUnitBox(clear, { extras: 'x', ownBox: READ.ownBox, extraBoxes: [px(0, 0, 500, 300)].concat(READ.extraBoxes) }));
  check('no own lock-up read: not cut', hooks.ownUnitBox(clear, { extras: 'x', ownBox: null, extraBoxes: READ.extraBoxes }) === null);
  check('the own lock-up said to be everywhere: nothing to take away, not cut', hooks.ownUnitBox(clear, { extras: 'x', ownBox: px(0, 0, 500, 300), extraBoxes: READ.extraBoxes }) === null);
  check('the publisher\'s mark half inside the own box is never cut away, even inside an extras box too',
    (function () { var k = hooks.ownUnitBox(clear, { extras: 'x', ownBox: px(0, 88, 500, 130), extraBoxes: [px(15, 5, 350, 90), px(145, 224, 210, 70)] }); return k && k.y <= 160; })());
  var middle = drawing(r(20, 20, 300, 40, '#000') + r(40, 90, 200, 20, '#e4002b') + r(20, 140, 300, 40, '#000'));
  var midClear = png.decode((await hooks.rasterise(middle, { clear: true })).png);
  check('an extra between two parts of the lock-up: not cut', hooks.ownUnitBox(midClear, { extras: 'x', ownBox: px(15, 15, 310, 170), extraBoxes: [px(35, 85, 210, 30)] }) === null);
  check('…nor when the part beyond it was left out of the own box (it may be the event\'s): not cut',
    hooks.ownUnitBox(midClear, { extras: 'x', ownBox: px(15, 15, 310, 50), extraBoxes: [px(35, 85, 210, 30)] }) === null);
  var touching = drawing(r(20, 20, 300, 80, '#000') + r(20, 100, 300, 30, '#e4002b'));
  var touchClear = png.decode((await hooks.rasterise(touching, { clear: true })).png);
  check('an extra with no empty line between it and the lock-up: not cut', hooks.ownUnitBox(touchClear, { extras: 'x', ownBox: px(15, 15, 310, 85), extraBoxes: [px(15, 100, 310, 32)] }) === null);
  check('…and the drawing is left alone', (await hooks.cropSvgToOwnUnit(touching, { extras: 'x', ownBox: px(15, 15, 310, 85), extraBoxes: [px(15, 100, 310, 32)] })) === null);
  check('too little left to be a lock-up: not cut', hooks.ownUnitBox(clear, { extras: 'x', ownBox: px(220, 52, 60, 6), extraBoxes: [px(0, 76, 500, 224)] }) === null);

  /* a line the model counted as neither (a tagline it left out of the own box) is never cut away */
  var tagline = drawing(TOP + OWN.replace(/<path d="M340[^>]*>/, '') + r(130, 212, 200, 6, '#444') + r(150, 250, 200, 40, '#e4002b'));
  var tagClear = png.decode((await hooks.rasterise(tagline, { clear: true })).png);
  var tagKeep = hooks.ownUnitBox(tagClear, { extras: 'x', ownBox: px(0, 76, 500, 128), extraBoxes: [px(15, 5, 350, 56), px(145, 245, 210, 50)] });
  check('a line in neither kind of box stays', tagKeep && tagKeep.y + tagKeep.height >= 436 && tagKeep.y + tagKeep.height < 500, JSON.stringify(tagKeep));

  /* a sponsor beside the lock-up, on the same lines: cut away by columns */
  var beside = drawing(r(10, 60, 280, 40, '#000') + r(10, 110, 200, 40, '#000') + r(360, 80, 120, 50, '#f5a623'));
  var besideClear = png.decode((await hooks.rasterise(beside, { clear: true })).png);
  var besideKeep = hooks.ownUnitBox(besideClear, { extras: 'x', ownBox: px(5, 55, 290, 100), extraBoxes: [px(355, 75, 130, 60)] });
  check('a sponsor beside the lock-up is cut away by columns', besideKeep && besideKeep.x + besideKeep.width <= 650 && besideKeep.x + besideKeep.width >= 580 && besideKeep.x <= 20, JSON.stringify(besideKeep));

  /* ---- the drawn check that keeps an SVG cut honest ---- */
  check('sameDrawing: the same picture', hooks.sameDrawing(clear, png.decode(clearR.png)));
  check('sameDrawing: a picture with a shape missing is not the same', !hooks.sameDrawing(clear, png.decode((await hooks.rasterise(drawing(TOP + BOTTOM), { clear: true })).png)));
  check('sameDrawing: pictures of different sizes are not the same', !hooks.sameDrawing(clear, small && png.decode(small.png)));

  /* ---- svgYear.cropTo ---- */
  var withKept = drawing(TOP + '<path id="m" d="M0 0h5v5H0z" fill="#000"/><g transform="translate(1 0)">' + r(20, 280, 10, 10, '#000') + '</g>' + OWN);
  var c2 = sy.cropTo(withKept, { x: 0, y: 70, width: 500, height: 150 });
  check('cropTo: the viewBox and the size follow the box', /viewBox="0 70 500 150" width="250" height="75"/.test(c2));
  check('cropTo: a shape anything could point to, or one a transform moves, stays (unseen)', /id="m"/.test(c2) && /translate\(1 0\)/.test(c2) && sy.shapesIn(c2).length === 8, sy.shapesIn(c2).length);
  check('cropTo: a shape reaching into the box stays', sy.shapesIn(sy.cropTo(LOCKUP, { x: 0, y: 30, width: 500, height: 100 })).some(function (s) { return s.box.y === 10; }));
  check('cropTo: stretched to its size (preserveAspectRatio none), each side keeps its own scale',
    /width="250" height="100"/.test(sy.cropTo(drawing(OWN, ' preserveAspectRatio="none"').replace('height="150"', 'height="300"'), { x: 0, y: 50, width: 500, height: 100 })));
  check('cropTo: a drawing without a size of its own is cut one to one', /viewBox="0 70 500 150" width="500" height="150"/.test(sy.cropTo('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300">' + OWN + '</svg>', { x: 0, y: 70, width: 500, height: 150 })));
  check('cropTo: an empty box is refused', sy.cropTo(LOCKUP, { x: 0, y: 0, width: 0, height: 10 }) === null);

  /* ---- the real lock-up (brand-world-summit-south2025), with the boxes the model gave for it ---- */
  var real = fs.readFileSync(path.join(__dirname, 'fixtures', 'logo-crop', 'brand-world-summit-south-2025.svg'), 'utf8');
  var REAL_READ = { extras: 'SAMSUNG Ads & ShareChat moj PRESENT IN ASSOCIATION WITH HAVAS Media Network',
    ownBox: { x: 0, y: 158.95, width: 1000, height: 311.542 },
    extraBoxes: [{ x: 0, y: 4.046, width: 1000, height: 120.224 }, { x: 312, y: 478.584, width: 327, height: 99.416 }] };
  var realCut = await hooks.cropSvgToOwnUnit(real, REAL_READ);
  var rvb = realCut && sy.viewBoxOf(realCut);
  /* in the drawing's units: the sponsors' row ends at ~89, PRESENT at ~131, the publisher's mark starts at
     ~175, the lock-up ends at ~516 and IN ASSOCIATION WITH starts at ~526 */
  check('the real lock-up: cut between PRESENT and the publisher\'s mark, and between the lock-up and IN ASSOCIATION WITH',
    rvb && rvb.y > 131 && rvb.y < 175 && rvb.y + rvb.height > 516 && rvb.y + rvb.height < 526 && rvb.x === 0 && rvb.width === 1096, JSON.stringify(rvb));
  check('the real lock-up: the sponsors\' shapes are gone from the file', realCut && sy.shapesIn(realCut).length < sy.shapesIn(real).length && sy.shapesIn(realCut).length >= 40);
  var info = realCut && require('./logo-unit').imageInfo(Buffer.from(realCut, 'utf8'));
  check('the real lock-up: a usable logo unit of its new size', info && info.type === 'svg' && Math.round(info.width) === 571 && Math.round(info.height) === 192 && !require('./logo-unit').plausibleUnit(info), JSON.stringify(info));
  check('the real lock-up: the old reading (no boxes) still leaves it alone', (await hooks.cropSvgToOwnUnit(real, { extras: REAL_READ.extras, ownBox: null, extraBoxes: [] })) === null);

  /* ---- end to end: buildLogoUnit with the event's previous edition, its readings replayed as the model
     gave them (first the whole lock-up, then the cut), stored in memory ---- */
  var FIRST = { allText: 'SAMSUNG Ads & ShareChat moj PRESENT ET BRAND EQUITY.com Brand World Summit South IN ASSOCIATION WITH HAVAS Media Network',
    year: '', yearBox: [], yearFont: 'sans-serif', yearWeight: 'regular', extras: REAL_READ.extras,
    extraBoxes: [{ text: 'SAMSUNG Ads & ShareChat moj PRESENT', box: [7, 0, 215, 1000] }, { text: 'IN ASSOCIATION WITH HAVAS Media Network', box: [828, 312, 1000, 639] }],
    ownBox: [275, 0, 814, 1000] };
  var CLEAN = { allText: 'ET BRAND EQUITY.com Brand World Summit South', year: '', yearBox: [], yearFont: 'sans-serif', yearWeight: 'regular', extras: '', extraBoxes: [], ownBox: [] };
  async function build(reply) {
    var stored = {};
    var fb = { bucket: { name: 'b', file: function (p) { return { save: function (buf) { stored[p] = buf; return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } }; } } };
    answers = reply; asked = 0;
    var unit = await hooks.buildLogoUnit(fb, '', {
      eventMeta: { name: 'Brand World Summit 2026', start: '2026-12-05T10:41' }, design: { mode: 'light', headingFont: 'Inter' }, stamp: 't',
      sourceDocs: [{ type: 'previousEdition', url: 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025', editionHints: { years: ['2025'] },
        logoCandidates: [{ kind: 'inline-svg', svg: real }] }]
    });
    return { unit: unit, svg: stored[unit.storagePath] ? stored[unit.storagePath].toString('utf8') : '' };
  }
  var e2e = await build(function (shown) { return shown.height > 500 ? FIRST : CLEAN; });
  check('end to end: read twice (the whole lock-up, then the cut)', asked === 2, asked);
  check('end to end: the stored unit is the cut drawing, at its new size', e2e.svg && /viewBox="0 153\.\d+ 1096 368\.\d+"/.test(e2e.svg) && e2e.unit.width === 571 && Math.round(e2e.unit.height) === 192,
    JSON.stringify(e2e.unit) + ' ' + (/<svg\b[^>]*>/.exec(e2e.svg) || [''])[0]);
  check('end to end: the owner is told what was cropped out, not that it could not be', /belonged to the previous edition and was cropped out/.test(e2e.unit.note) && !/could not be cropped/.test(e2e.unit.note), e2e.unit.note);
  var stays = await build(function () { return FIRST; });
  check('end to end: a cut the second reading still finds extras in is not kept, and the owner is told', stays.svg === real && /could not be cropped out cleanly/.test(stays.unit.note) && stays.unit.height === 330, stays.unit.note);
  var noBoxes = await build(function () { return Object.assign({}, FIRST, { extraBoxes: [], ownBox: [] }); });
  check('end to end: a reading with no boxes leaves the lock-up whole, and the owner is told', noBoxes.svg === real && /could not be cropped out cleanly/.test(noBoxes.unit.note) && asked === 1, noBoxes.unit.note);
  var unread = await build(function () { return null; });
  check('end to end: no reading at all: the lock-up as it is', unread.svg === real && unread.unit.note === '');
  finish();
})().catch(function (e) { check('the checks ran', false, e.stack); finish(); });

function finish() {
  if (failed) { console.error('logo-crop: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('logo-crop: all ' + passed + ' checks passed');
}
