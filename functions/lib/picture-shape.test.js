/* node functions/lib/picture-shape.test.js — a picture made for a frame has the frame's shape (lib/picture-shape.js).
   The owner, 16 Nov 2026 (ET DAVOS 2027): "the image dimension issue is still not fixed. AI has created a square image
   for a rectangular placeholder". The shapes the picture model takes, the nearest one to a frame, a frame's size as the
   editor measures it, and the cut to a frame's exact proportion (with real pictures, made here with sharp). No network. */
'use strict';
var shape = require('./picture-shape');
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail) : '')); }

(async function () {
  /* the shapes */
  var gemini = require('./gemini');
  check(shape.ASPECTS.slice().sort().join() === gemini.IMAGE_ASPECTS.slice().sort().join(), 'the shapes are exactly the ones the picture model takes (gemini.js IMAGE_ASPECTS)', shape.ASPECTS);
  check(shape.ASPECTS.every(function (a) { return typeof shape.WORDS[a] === 'string' && /\d+:\d+\.$/.test(shape.WORDS[a]) && shape.WORDS[a].indexOf(a) !== -1; }), 'each shape has the words a prompt says it in');
  check(shape.FRAME_SHAPES.every(shape.isAspect) && shape.LANDSCAPE.every(function (a) { return shape.ratioOf(a) > 1.3; }) && shape.isAspect(shape.DEFAULT_ASPECT) && shape.isAspect(shape.NEW_FRAME_ASPECT),
    'a frame a rework adds, a banner and the defaults all take shapes the model makes; a banner\'s are all wide');
  check(shape.ratioOf('16:9') === 16 / 9 && shape.ratioOf('1:1') === 1 && shape.ratioOf('7:5') === 0 && shape.ratioOf('') === 0 && shape.ratioOf(null) === 0, 'a shape\'s proportion; 0 for one the model does not take');

  /* the nearest shape */
  check(shape.nearest(1152, 380) === '21:9' && shape.nearest(1184, 864) === '4:3' && shape.nearest(1024, 1024) === '1:1' && shape.nearest(1344, 768) === '16:9' &&
    shape.nearest(644, 745) === '4:5' && shape.nearest(342, 220) === '3:2' && shape.nearest(390, 844) === '9:16', 'the shape nearest a frame (the Davos band, the overview frame, a phone)',
    [shape.nearest(1152, 380), shape.nearest(644, 745), shape.nearest(342, 220)]);
  check(shape.nearest(0, 10) === '' && shape.nearest('x', 10) === '' && shape.nearest(-4, 3) === '', 'no shape without a size');
  check(shape.nearest(390, 800, shape.LANDSCAPE) === '3:2' && shape.nearest(1440, 600, shape.LANDSCAPE) === '21:9', 'the choice can be held to some shapes (a banner: wide ones)');

  /* a frame's size */
  check(JSON.stringify(shape.frameOf(1152.4, 379.6)) === '{"w":1152,"h":380}' && shape.frameOf(0, 3) === null && shape.frameOf(30000, 3) === null && shape.frameOf('12', '9').w === 12,
    'a measured frame: whole numbers from 1 to 20000');
  check(shape.frameText({ w: 1152, h: 380 }) === '1152:380' && shape.frameText(null) === '' && shape.frameText({ w: 'a' }) === '', 'kept on the turn as "1152:380"');
  check(JSON.stringify(shape.frameFromText('1152:380')) === '{"w":1152,"h":380}' && JSON.stringify(shape.frameFromText('16:9')) === '{"w":16,"h":9}' &&
    JSON.stringify(shape.frameFromText({ w: 4, h: 3 })) === '{"w":4,"h":3}' && shape.frameFromText('16:9;}') === null && shape.frameFromText('') === null && shape.frameFromText('a:b') === null,
    'read back from its text, an object or a shape, and nothing else');
  check(shape.cssRatio('21:9') === '21 / 9' && shape.cssRatio({ w: 1152, h: 380 }) === '1152 / 380' && shape.cssRatio('x') === '', 'written as CSS aspect-ratio');
  check(Math.abs(shape.targetRatio({ frame: '1152:380', aspect: '21:9' }) - 1152 / 380) < 1e-9 && shape.targetRatio({ aspect: '4:3' }) === 4 / 3 &&
    shape.targetRatio({ frame: '', aspect: 'x' }) === 0 && shape.targetRatio(null) === 0, 'the proportion a picture is cut to: its frame\'s, else its shape\'s');

  /* the cut */
  var sharp = null;
  try { sharp = require('sharp'); } catch (e) { sharp = null; }
  var notAPicture = Buffer.from('not a picture at all, just words');
  var realError = console.error, logged = [];
  console.error = function (line) { logged.push(String(line)); };
  var same = await shape.crop(notAPicture, 16 / 9, { label: 'the test picture' });
  console.error = realError;
  check(same.bytes === notAPicture && same.cropped === false, 'bytes that are not a picture come back as they were (the frame\'s cover does the rest)', same);
  check(logged.every(function (l) { return l.indexOf('not a picture at all') === -1; }), 'the log line never carries the picture\'s bytes', logged);
  var none = await shape.crop(notAPicture, 0);
  check(none.bytes === notAPicture && !none.cropped, 'no proportion: nothing is cut');
  if (!sharp) {
    console.log('picture-shape: sharp is not on this machine; the cut itself is not checked here');
  } else {
    function make(w, h, format) {
      var p = sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 90, b: 160 } } });
      return (format === 'jpeg' ? p.jpeg() : format === 'webp' ? p.webp() : p.png()).toBuffer();
    }
    async function sizeOf(buf) { var m = await sharp(buf).metadata(); return [m.width, m.height, m.format]; }
    var cases = [
      { label: 'the Davos lounge picture (4:3) for its 1152 x 380 band', from: [1184, 864, 'png'], ratio: 1152 / 380, to: [1184, 391, 'png'] },
      { label: 'the model\'s 21:9 for that band', from: [1536, 672, 'png'], ratio: 1152 / 380, to: [1536, 507, 'png'] },
      { label: 'a square for a 16:9 banner', from: [1024, 1024, 'png'], ratio: 16 / 9, to: [1024, 576, 'png'] },
      { label: 'a landscape picture for a tall frame (4:5)', from: [1184, 864, 'jpeg'], ratio: 4 / 5, to: [691, 864, 'jpeg'] },
      { label: 'a WebP stays WebP', from: [1344, 768, 'webp'], ratio: 16 / 9, to: [1344, 756, 'webp'] }
    ];
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      var src = await make(c.from[0], c.from[1], c.from[2]);
      var out = await shape.crop(src, c.ratio);
      var got = await sizeOf(out.bytes);
      check(out.cropped === true && got[0] === c.to[0] && got[1] === c.to[1] && got[2] === c.to[2] && out.width === c.to[0] && out.height === c.to[1] &&
        Math.abs(Math.log((got[0] / got[1]) / c.ratio)) < 0.003, c.label + ': cut, centred, to the exact proportion, in its own format', { got: got, want: c.to });
    }
    var exact = await make(1344, 756, 'png');
    var kept = await shape.crop(exact, 16 / 9);
    check(kept.bytes === exact && kept.cropped === false && kept.width === 1344 && kept.height === 756, 'a picture already in its frame\'s proportion is left whole (not even re-encoded)', kept.cropped);
    var near = await make(1000, 563, 'png');
    check((await shape.crop(near, 16 / 9)).cropped === false, 'within ' + (shape.TOLERANCE * 100) + '% of it, too');
    /* the cut is centred: a picture whose left and right thirds are another colour loses them evenly */
    var striped = await sharp({ create: { width: 900, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([{ input: await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer(), left: 300, top: 0 }]).png().toBuffer();
    var mid = await shape.crop(striped, 1);
    var raw = await sharp(mid.bytes).raw().toBuffer({ resolveWithObject: true });
    var px = raw.data, ch = raw.info.channels, last = px.length - ch;
    check(mid.width === 300 && mid.height === 300 && px[0] === 0 && px[last] === 0 && px[last + 1] === 0, 'the cut keeps the middle of the picture', [mid.width, mid.height, ch, px[0], px[last]]);
  }

  if (failures.length) { console.error('picture-shape: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('picture-shape: all ' + checks + ' checks passed');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
