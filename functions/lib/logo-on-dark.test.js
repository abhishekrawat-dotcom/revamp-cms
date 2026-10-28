// node functions/lib/logo-on-dark.test.js — a lock-up drawn for a light ground made again for a dark one (api.js
// onDarkCopy), by ET's logo rule: only black lettering changes, to white; nothing light and nothing coloured changes
// (the red ET square with its white "ET" above all), and lettering printed on the lock-up's own plate stays black.
// Written for Trendies Awards 2027, whose copy turned its cream tagline labels black and its white "ET" dark.
'use strict';
const hooks = require('./api.js')._testHooks;
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var W = 60, H = 20;
function picture(paint) {
  var data = Buffer.alloc(W * H * 4);                                           // all see-through
  paint(function (x0, y0, x1, y1, rgba) {
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var o = (y * W + x) * 4; data[o] = rgba[0]; data[o + 1] = rgba[1]; data[o + 2] = rgba[2]; data[o + 3] = rgba[3]; }
  });
  return { width: W, height: H, data: data };
}
function px(img, x, y) { var o = (y * W + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]; }
function same(a, b) { return a.every(function (v, i) { return v === b[i]; }); }

var BLACK = [20, 20, 20, 255], CREAM = [245, 236, 214, 255], RED = [237, 28, 36, 255], WHITE = [255, 255, 255, 255], PURPLE = [120, 40, 160, 255];
var lockup = picture(function (fill) {
  fill(2, 4, 22, 16, BLACK);                                                    // the name, black, on the see-through ground
  fill(26, 2, 44, 18, CREAM); fill(30, 8, 40, 12, BLACK);                       // a cream label with black words on it
  fill(48, 2, 58, 12, RED); fill(50, 5, 56, 9, WHITE);                          // the ET square, its white "ET"
  fill(48, 14, 58, 18, PURPLE);                                                 // a colour of its own
});
var copy = hooks.onDarkCopy(lockup);
check('a copy is made', !!copy);
check('the lettering on the see-through ground turns white', copy && px(copy, 10, 10)[0] > 220 && px(copy, 10, 10)[3] === 255, copy && px(copy, 10, 10));
check('the label keeps its cream, and its words stay black', copy && same(px(copy, 27, 3), CREAM) && same(px(copy, 35, 10), BLACK), copy && [px(copy, 27, 3), px(copy, 35, 10)]);
check('the red ET square and its white "ET" never change', copy && same(px(copy, 49, 3), RED) && same(px(copy, 53, 7), WHITE));
check('a colour of its own stays', copy && same(px(copy, 50, 15), PURPLE));
check('the see-through ground stays see-through', copy && px(copy, 0, 0)[3] === 0 && px(copy, 24, 10)[3] === 0);
check('the original is not touched', same(px(lockup, 10, 10), BLACK));

var onlyLabel = picture(function (fill) { fill(26, 2, 44, 18, CREAM); fill(30, 8, 40, 12, BLACK); });
check('lettering only on its own plate: no copy (it reads on any ground as it is)', hooks.onDarkCopy(onlyLabel) === null);
var white = picture(function (fill) { fill(2, 4, 22, 16, WHITE); });
check('a lock-up already drawn in white: no copy', hooks.onDarkCopy(white) === null);

/* a tagline running from deep maroon to black (AutoTech Summit 2027's) turns white whole, not where its tint falls
   under the line; the ET red beside it stays */
var gradient = picture(function (fill) {
  for (var x = 2; x < 42; x++) { var t = (x - 2) / 39; fill(x, 6, x + 1, 14, [Math.round(84 - 78 * t), 0, Math.round(5 - 5 * t), 255]); }
  fill(48, 2, 58, 12, RED);
});
var gradCopy = hooks.onDarkCopy(gradient);
check('a dark tagline in a gradient of tints turns white from end to end', gradCopy && px(gradCopy, 3, 10)[0] > 160 && px(gradCopy, 22, 10)[0] > 160 && px(gradCopy, 41, 10)[0] > 160, gradCopy && [px(gradCopy, 3, 10), px(gradCopy, 22, 10), px(gradCopy, 41, 10)]);
check('and the red beside it does not change', gradCopy && same(px(gradCopy, 50, 5), RED));

/* a wordmark in a dark brand colour is a colour, by ET's rule: it stays (navy, a deeper navy, maroon, indigo) */
[[31, 56, 100], [0, 32, 96], [128, 0, 0], [75, 0, 130]].forEach(function (c) {
  var mark = picture(function (fill) { fill(2, 4, 40, 16, c.concat([255])); });
  check('a wordmark in rgb(' + c + ') stays as drawn, said as "coloured"', hooks.darkCopyOf(mark).why === 'coloured', hooks.darkCopyOf(mark));
});
/* a white wordmark on a black field: no see-through ground, no copy (it came out as a blank white picture) */
var field = picture(function (fill) { fill(0, 0, W, H, [10, 10, 10, 255]); fill(10, 6, 30, 14, WHITE); });
check('a white wordmark on a black field: no copy, said as "solid"', !hooks.darkCopyOf(field).copy && hooks.darkCopyOf(field).why === 'solid', hooks.darkCopyOf(field));
/* a soft fringe with nothing solid in it, beside the red square, is never lettering */
var fringe = picture(function (fill) { fill(48, 2, 58, 12, RED); fill(47, 2, 48, 12, [80, 10, 15, 90]); fill(2, 4, 22, 16, BLACK); });
var fringeCopy = hooks.onDarkCopy(fringe);
check('a faint dark fringe beside the red square stays as drawn (no light halo)', fringeCopy && same(px(fringeCopy, 47, 5), [80, 10, 15, 90]), fringeCopy && px(fringeCopy, 47, 5));

/* ---------- why no copy: said to the owner (darkCopyOf, darkCopyNote) ---------- */
check('why: lettering only on its own plate -> "plate"', hooks.darkCopyOf(onlyLabel).why === 'plate', hooks.darkCopyOf(onlyLabel));
check('why: drawn in white -> "light"', hooks.darkCopyOf(white).why === 'light', hooks.darkCopyOf(white));
var colourOnly = picture(function (fill) { fill(2, 4, 22, 16, RED); fill(30, 4, 50, 16, PURPLE); });
check('why: lettering in colour -> "coloured"', hooks.darkCopyOf(colourOnly).why === 'coloured', hooks.darkCopyOf(colourOnly));
var solid = picture(function (fill) { fill(0, 0, W, H, [250, 250, 250, 255]); fill(2, 4, 22, 16, BLACK); });
check('why: a solid background (no see-through ground) -> "solid"', hooks.darkCopyOf(solid).why === 'solid', hooks.darkCopyOf(solid));
check('a copy is made: darkCopyOf gives it, with no reason', !!hooks.darkCopyOf(lockup).copy && !hooks.darkCopyOf(lockup).why);
check('the note: on a light site, the banner stays light in a dark theme, and why', /^In a dark theme the banner stays light, so the logo shows as drawn: .*in colour, and only black lettering may be changed for a dark background\.$/.test(hooks.darkCopyNote('coloured', false)), hooks.darkCopyNote('coloured', false));
check('the note: on a dark site, the banner stays light on it', /^The banner stays light on this dark site/.test(hooks.darkCopyNote('plate', true)));
check('the note: a reason not known reads as a failure to try again', /could not be made just now\. Upload the logo again/.test(hooks.darkCopyNote('???', false)));

/* ---------- storeOnDarkUnit: a stored copy, or why not ---------- */
(async function () {
  var png = require('./png-lite');
  var stored = {};
  var fb = { bucket: { name: 'b', file: function (p) { return {
    save: function (buf) { stored[p] = buf; return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); },
    download: function () { return stored[p] ? Promise.resolve([stored[p]]) : Promise.reject(new Error('No such object: ' + p)); } }; } } };
  stored['events/e/logo/a.png'] = png.encode(lockup);
  var made = await hooks.storeOnDarkUnit(fb, 'e', 't1', { url: 'https://storage.googleapis.com/b/events/e/logo/a.png', width: 120, height: 40 });
  check('storeOnDarkUnit: read by its address from the own bucket, stored beside the unit, shown at the unit\'s size',
    made.url && made.storagePath === 'events/e/generated/t1-logo-unit-on-dark.png' && !!stored[made.storagePath] && made.width === 120 && made.height === 40, made);
  stored['events/e/logo/b.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" width="200" height="60"><text x="0" y="40" fill="#111">Summit 2027</text></svg>');
  var text = await hooks.storeOnDarkUnit(fb, 'e', 't2', { url: 'x', storagePath: 'events/e/logo/b.svg' });
  check('storeOnDarkUnit: an SVG whose lettering is live text -> "text", nothing stored (drawn here it would lose it)', text.why === 'text' && !text.url && !stored['events/e/generated/t2-logo-unit-on-dark.png'], text);
  var FONT = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'logo-unit', 'lexend-500-digits-subset.ttf')).toString('base64');
  stored['events/e/logo/moved.svg'] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" width="200" height="60"><rect x="4" y="10" width="90" height="36" fill="#141414"/>' +
    '<style>@font-face{font-family:\'rvyear\';src:url(data:font/ttf;base64,' + FONT + ') format(\'truetype\')}</style><text x="110" y="48" fill="#141414" font-family="\'rvyear\', Arial, sans-serif" font-size="40">27</text></svg>');
  check('embeddedYearFont: a year moved as text carries its font', !!hooks.embeddedYearFont(stored['events/e/logo/moved.svg'].toString('utf8')));
  var moved = await hooks.storeOnDarkUnit(fb, 'e', 't7', { url: 'x', storagePath: 'events/e/logo/moved.svg' });
  var movedPx = moved.storagePath ? png.decode(stored[moved.storagePath]) : null;
  var lit = 0;
  if (movedPx) for (var yy = 0; yy < movedPx.height; yy++) for (var xx = Math.round(movedPx.width * 0.55); xx < movedPx.width; xx++) { var oo = (yy * movedPx.width + xx) * 4; if (movedPx.data[oo + 3] > 128 && movedPx.data[oo] > 200) lit++; }
  check('storeOnDarkUnit: an SVG whose year was moved as text is drawn in the font it carries — the year is in the copy, in white', moved.url && lit > 50, [moved, lit]);
  var none = await hooks.storeOnDarkUnit(fb, 'e', 't3', { url: '', storagePath: '' });
  check('storeOnDarkUnit: no picture -> "failed", never a rejection', none.why === 'failed', none);
  var gone = await hooks.storeOnDarkUnit(fb, 'e', 't4', { url: '', storagePath: 'events/e/logo/missing.png' });
  check('storeOnDarkUnit: a picture that cannot be had -> "failed"', gone.why === 'failed', gone);

  /* ---------- the event's name drawn as a unit: its copy for a dark ground is drawn too, with the name in it ---------- */
  var drawn = await hooks.drawnLogoUnit(fb, 'e', { design: { mode: 'light', headingFont: '', themeColor: '#123456' }, eventMeta: { name: 'Cyber Premier League' }, stamp: 't5' });
  var darkSvg = drawn && drawn.darkStoragePath ? stored[drawn.darkStoragePath].toString('utf8') : '';
  check('drawnLogoUnit: a light site\'s drawn unit brings its own copy for a dark ground', drawn && drawn.darkUrl && drawn.darkStoragePath === 'events/e/generated/t5-logo-unit-on-dark.svg', drawn);
  check('drawnLogoUnit: the copy has the event\'s name in it, in white', /Cyber/.test(darkSvg) && /#ffffff|#fff\b/i.test(darkSvg), darkSvg.slice(0, 300));
  var drawnDark = await hooks.drawnLogoUnit(fb, 'e', { design: { mode: 'dark', headingFont: '', themeColor: '#123456' }, eventMeta: { name: 'Cyber Premier League' }, stamp: 't6' });
  check('drawnLogoUnit: a dark site\'s drawn unit needs no copy', drawnDark && drawnDark.url && !drawnDark.darkUrl, drawnDark);

  if (failed) { console.error('logo-on-dark: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('logo-on-dark: all ' + passed + ' checks passed');
})().catch(function (e) { console.error('logo-on-dark: the checks did not run — ' + (e && e.stack)); process.exit(1); });
