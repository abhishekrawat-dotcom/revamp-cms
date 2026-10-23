/* node tools/build-portal-dark-logos.js [--check]

   The version of each ET portal's wordmark for a dark ground (templates/_shared/img/portals/<slug>-light.png),
   made from its version for a light ground (<slug>.png), by ET's rule for its logos (the owner, 23 Oct 2026):
   when a logo's colour changes, only its black lettering may change (to white here); the red ET square — and the
   white "ET" in it — never changes, at any cost. The versions taken from the platform's roster whitened the square
   too; these replace them.

     - the red square: every pixel inside the box of the logo's ET red (and its soft edge) is kept as it is;
     - coloured pixels anywhere else (an accent in a wordmark) are kept as they are;
     - neutral pixels (black, grey) are turned light: black becomes white, a grey tagline a light grey, each
       keeping its own transparency, so the soft edges stay soft.

   --check  writes nothing: says which portals' dark versions do not show the red square. */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));

const DIR = path.join(__dirname, '..', 'templates', '_shared', 'img', 'portals');
const CHECK = process.argv.includes('--check');

/* ET red, as the wordmarks draw it (#e81d3d, #ed1c24 and their soft edges) */
function isEtRed(r, g, b) { return r > 150 && g < 100 && b < 110 && r - g > 90; }

/* the box of the ET square: the largest single block of ET red (a wordmark may have red of its own elsewhere —
   Healthworld's heartbeat in its "o", Telecom's mast — which is not the square), and a couple of pixels round it
   for its soft edge -> { x0, y0, x1, y1, n } | null */
function redBox(data, w, h) {
  const red = new Uint8Array(w * h), seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const o = i * 4; red[i] = data[o + 3] > 200 && isEtRed(data[o], data[o + 1], data[o + 2]) ? 1 : 0; }
  let best = null;
  for (let start = 0; start < w * h; start++) {
    if (!red[start] || seen[start]) continue;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i - x) / w;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        const nx = x + d[0], ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const j = ny * w + nx;
        if (red[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      });
    }
    if (!best || n > best.n) best = { x0: x0, y0: y0, x1: x1, y1: y1, n: n };
  }
  return best ? { x0: Math.max(0, best.x0 - 2), y0: Math.max(0, best.y0 - 2), x1: Math.min(w - 1, best.x1 + 2), y1: Math.min(h - 1, best.y1 + 2), n: best.n } : null;
}

async function onDark(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, out = Buffer.from(data), box = redBox(data, w, h);
  if (!box) throw new Error(path.basename(file) + ': no ET red found — not changed by hand-off rules, look at it');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (!out[o + 3]) continue;
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) continue;          // the ET square: never changed
    const r = out[o], g = out[o + 1], b = out[o + 2], hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi - lo > 40) continue;                                                       // a colour of the wordmark's own: kept
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b), light = 255 - lum;    // black -> white, grey -> light grey
    out[o] = light; out[o + 1] = light; out[o + 2] = light;
  }
  return { png: await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer(), box };
}

async function redCount(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = redBox(data, info.width, info.height);
  return b ? b.n : 0;
}

(async function () {
  const slugs = fs.readdirSync(DIR).filter(function (f) { return /^[a-z0-9]+\.png$/.test(f); }).map(function (f) { return f.replace(/\.png$/, ''); });
  const wrong = [];
  for (const slug of slugs) {
    const src = path.join(DIR, slug + '.png'), dst = path.join(DIR, slug + '-light.png');
    if (CHECK) {
      const a = await redCount(src), b = fs.existsSync(dst) ? await redCount(dst) : 0;
      if (!b || b < a * 0.9) wrong.push(slug);
      continue;
    }
    const made = await onDark(src);
    fs.writeFileSync(dst, made.png);
    const kept = await redCount(dst), before = await redCount(src);
    if (kept !== before) throw new Error(slug + ': the ET square changed (' + before + ' red pixels before, ' + kept + ' after)');
  }
  if (CHECK) { console.log(wrong.length ? 'Dark versions without the red ET square: ' + wrong.join(', ') : 'Every dark version keeps the red ET square (' + slugs.length + ').'); process.exit(wrong.length ? 1 : 0); }
  console.log('Made ' + slugs.length + ' dark versions; the red ET square is unchanged in every one.');
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
