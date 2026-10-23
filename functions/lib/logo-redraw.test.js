// node functions/lib/logo-redraw.test.js — the year redrawn in a lock-up's own lettering (api.js redrawYearInPng):
// only the new year's shape is taken from the image model's picture, fitted to the old year's place and height,
// and painted in the old year's colour into the original picture, whose other pixels stay as they were.
const png = require('./png-lite');
let imageAnswer = null, imageCalls = 0;
require('./gemini').callGeminiImage = function () { imageCalls++; return Promise.resolve(imageAnswer); };
const api = require('./api.js')._testHooks;
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function picture(w, h, fill) {
  var data = Buffer.alloc(w * h * 4);
  if (fill) for (var i = 0; i < data.length; i += 4) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255; }
  return { width: w, height: h, data: data };
}
function paint(img, x0, y0, x1, y1, rgb) {
  for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var o = (y * img.width + x) * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255; }
}
function px(img, x, y) { var o = (y * img.width + x) * 4; return Array.from(img.data.slice(o, o + 4)); }

/* the lock-up: see-through, a word (x 10–90) and its year '26 (x 110–190), both in the brand red */
var RED = [230, 30, 60];
var original = picture(200, 80);
paint(original, 10, 20, 90, 60, RED);
paint(original, 110, 20, 190, 60, RED);
/* the model's picture: twice the size, on white, the new year in black — a block with a counter in it */
var edited = picture(400, 160, [255, 255, 255]);
paint(edited, 20, 40, 180, 120, [0, 0, 0]);          // the word, redrawn as the model saw it
paint(edited, 220, 40, 380, 120, [0, 0, 0]);
paint(edited, 280, 60, 320, 100, [255, 255, 255]);
var readings = 0;
function readFn(pic, decoded) {
  readings++;
  return Promise.resolve(decoded.width === 400 ? { year: '’27', box: { x: 214, y: 34, width: 172, height: 92 } } : null);
}

(async function () {
  imageAnswer = { mimeType: 'image/png', base64: png.encode(edited).toString('base64') };
  var reading = { year: '’26', box: { x: 106, y: 16, width: 88, height: 48 } };
  var out = await api.redrawYearInPng(original, reading, '2027', 'qa-redraw', 0, readFn, 4000);
  check('a redrawn year is made', !!out && out.info.type === 'png', out && out.info);
  if (out) {
    var d = out.decoded;
    check('the same size as the original', d.width === 200 && d.height === 80, [d.width, d.height]);
    check('painted in the old year\'s own colour, not the model\'s black', px(d, 115, 25).slice(0, 3).join() === RED.join() && px(d, 115, 25)[3] === 255, px(d, 115, 25));
    check('the new shape\'s counter is see-through, as the ground is', px(d, 150, 40)[3] === 0, px(d, 150, 40));
    check('as tall as the old year, on its foot: nothing above or below it', px(d, 115, 18)[3] === 0 && px(d, 115, 61)[3] === 0 && px(d, 115, 58)[3] === 255, [px(d, 115, 18), px(d, 115, 61), px(d, 115, 58)]);
    check('everything else is the original\'s, pixel for pixel', px(d, 50, 40).join() === px(original, 50, 40).join() && px(d, 5, 5).join() === px(original, 5, 5).join());
  }
  check('one image call and one reading of its answer', imageCalls === 1 && readings === 1, [imageCalls, readings]);

  /* the model's picture does not show the new year: nothing is made, and the caller sets it in a font */
  readings = 0;
  var wrong = await api.redrawYearInPng(original, reading, '2027', 'qa-redraw', 0, function () { readings++; return Promise.resolve({ year: '’26', box: { x: 214, y: 34, width: 172, height: 92 } }); }, 4000);
  check('a picture still showing the old year is not used', wrong === null);
  /* a new year far wider than the old one is something else */
  var wide = picture(400, 160, [255, 255, 255]);
  paint(wide, 20, 40, 399, 120, [0, 0, 0]);
  imageAnswer = { mimeType: 'image/png', base64: png.encode(wide).toString('base64') };
  var tooWide = await api.redrawYearInPng(original, reading, '2027', 'qa-redraw', 0, function () { return Promise.resolve({ year: '’27', box: { x: 15, y: 34, width: 384, height: 92 } }); }, 4000);
  check('a shape much wider than the old year is not used', tooWide === null);
  /* the image model fails: nothing, no throw */
  imageAnswer = { error: 'quota', code: 'ai-quota' };
  check('a failed image call gives nothing', (await api.redrawYearInPng(original, reading, '2027', 'qa-redraw', 0, readFn, 4000)) === null);
  /* too little time left in the plan: not tried at all */
  imageCalls = 0;
  check('not tried with too little time left', (await api.redrawYearInPng(original, reading, '2027', 'qa-redraw', Date.now() + 30000, readFn, 4000)) === null && imageCalls === 0);

  if (failed) { console.error('logo-redraw: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('logo-redraw: all ' + passed + ' checks passed');
})().catch(function (err) { console.error('logo-redraw: crashed — ' + (err && err.stack)); process.exit(1); });
