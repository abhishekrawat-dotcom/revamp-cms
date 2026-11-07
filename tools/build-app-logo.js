/* node tools/build-app-logo.js [--check]

   The app's own logo, for the top bar of the events dashboard, sign-in, Create Event, the Activity log and Mailer
   performance (UX-023). assets/app-logo.png is the logo for a light ground, kept here so the pages no longer load
   it from another site; this makes assets/app-logo-dark.png, the same logo for a dark ground.

   ET's rule for its logos (the owner, 23 Oct 2026): when a logo's colour changes, only its black or grey
   lettering may change; the red ET square, and the white "ET" in it, never changes. It is the rule
   tools/build-portal-dark-logos.js already applies to the 56 portal wordmarks, so this uses that very function:
   neutral dark pixels outside the ET square are turned light, each keeping its own transparency; the ET square
   and any colour of the logo's own (the blue arrow round the globe) are left exactly as drawn.

   The dashboard used to show the light logo on its dark ground, where only the red square could be seen, and the
   other pages put it on a white chip. Each page now shows one of the two pictures by its theme (app-logo.css).

   --check  writes nothing: fails when the dark copy is missing, a different size, or its ET square or any of its
            coloured pixels differ from the light one's. */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));
const dark = require('./build-portal-dark-logos');

const LIGHT = path.join(__dirname, '..', 'assets', 'app-logo.png');
const DARK = path.join(__dirname, '..', 'assets', 'app-logo-dark.png');

/* -> { w, h, data } in RGBA */
function pixels(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(function (r) {
    return { w: r.info.width, h: r.info.height, data: r.data };
  });
}

/* What may differ between the two: only neutral pixels outside the ET square. Answers the first pixel that
   breaks that, or null. */
function firstBreak(a, b) {
  if (a.w !== b.w || a.h !== b.h) return 'the sizes differ (' + a.w + '×' + a.h + ' and ' + b.w + '×' + b.h + ')';
  const box = dark.redBox(a.data, a.w, a.h);
  if (!box) return 'no ET square was found in the light logo';
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const o = (y * a.w + x) * 4;
    const same = a.data[o] === b.data[o] && a.data[o + 1] === b.data[o + 1] && a.data[o + 2] === b.data[o + 2] && a.data[o + 3] === b.data[o + 3];
    if (same) continue;
    if (a.data[o + 3] !== b.data[o + 3]) return 'pixel ' + x + ',' + y + ' changed its transparency';
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) return 'pixel ' + x + ',' + y + ' is inside the ET square';
    const r = a.data[o], g = a.data[o + 1], bl = a.data[o + 2];
    if (Math.max(r, g, bl) - Math.min(r, g, bl) > 40) return 'pixel ' + x + ',' + y + ' is a colour of the logo\'s own';
  }
  return null;
}

module.exports = { firstBreak: firstBreak, pixels: pixels, LIGHT: LIGHT, DARK: DARK };

if (require.main === module) (async function () {
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(DARK)) { console.error('assets/app-logo-dark.png is missing: run node tools/build-app-logo.js'); process.exit(1); }
    const why = firstBreak(await pixels(LIGHT), await pixels(DARK));
    if (why) { console.error('The dark logo breaks ET\'s logo rule: ' + why + '.'); process.exit(1); }
    console.log('The dark logo changes only the lettering; the red ET square is exactly as drawn.');
    return;
  }
  const made = await dark.onDark(LIGHT);
  fs.writeFileSync(DARK, made.png);
  const why = firstBreak(await pixels(LIGHT), await pixels(DARK));
  if (why) throw new Error('the dark logo breaks ET\'s logo rule: ' + why);
  if (await dark.redCount(DARK) !== await dark.redCount(LIGHT)) throw new Error('the ET square changed');
  console.log('Made assets/app-logo-dark.png; the red ET square is unchanged.');
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
