/* Just enough PNG to look at a logo and to touch one small part of it, with nothing but zlib.

   A logo unit taken from a previous edition's site is usually a PNG with a transparent background and white
   or black lettering. Two things need its pixels:
     - a vision model reads a transparent picture as if it lay on white, so white lettering is invisible to
       it. flatten() lays the picture on a mid grey first — what the model is shown, never what is published;
     - when the edition's year is drawn into the picture, clearBox() empties that one rectangle so the new
       year can be set over it; every other pixel stays exactly as it was.

   decode(buf)  -> { width, height, data: Buffer (RGBA, 8 bits a channel) } | null
                   null for anything this does not read: not a PNG, 16-bit, interlaced, damaged, or larger
                   than MAX_PIXELS. Never throws.
   encode(img)  -> Buffer (a PNG, RGBA)
   flatten(img, [r, g, b]) -> a new image, opaque, on that colour
   clearBox(img, { x, y, width, height }) -> a new image with that rectangle fully transparent
   fillBox(img, box, [r, g, b]) -> the same for an opaque picture: the rectangle painted in one colour
   inkOf(img, box?) -> { r, g, b, coverage } the average colour of the visible pixels (weighted by how
                   opaque each is), in the box or in the whole picture; coverage 0..1 is how much of it is ink
   inkBounds(img, box, background) -> the exact box and colour of the lettering inside a box, or null
   edgeColour(img, box) -> [r, g, b] the colour around a box;  hasTransparency(img) -> boolean
   crop(img, box) -> that part as its own picture;  inkProfile(img, 'x'|'y', background) -> lettering per column / row
   inkRuns(profile) -> [{ from, to }] the runs of lettering in a profile, with empty lines between them
   inkCount(img, box, background, within?, without?) -> how many pixels of lettering a box holds (only those
                   inside one of the `within` boxes, when given, and none inside one of the `without` boxes)
   No network, no Firebase: see png-lite.test.js. */

const zlib = require('zlib');

var SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
var MAX_PIXELS = 6000000;            // a logo, not a photograph: 6 MP of RGBA is 24 MB in memory
var CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function paeth(a, b, c) {
  var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decode(buf) {
  try { return decodeUnsafe(buf); } catch (e) { return null; }
}
function decodeUnsafe(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 45 || buf.compare(SIGNATURE, 0, 8, 0, 8) !== 0) return null;
  var width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null, idat = [];
  var at = 8;
  while (at + 12 <= buf.length) {
    var len = buf.readUInt32BE(at), name = buf.toString('latin1', at + 4, at + 8), body = at + 8;
    if (body + len + 4 > buf.length) return null;
    if (name === 'IHDR') {
      width = buf.readUInt32BE(body); height = buf.readUInt32BE(body + 4);
      depth = buf[body + 8]; type = buf[body + 9]; interlace = buf[body + 12];
    } else if (name === 'PLTE') palette = buf.slice(body, body + len);
    else if (name === 'tRNS') trns = buf.slice(body, body + len);
    else if (name === 'IDAT') idat.push(buf.slice(body, body + len));
    else if (name === 'IEND') break;
    at = body + len + 4;
  }
  if (!width || !height || width * height > MAX_PIXELS) return null;
  if (depth !== 8 || interlace !== 0 || !CHANNELS[type] || !idat.length) return null;
  if (type === 3 && !palette) return null;

  var bpp = CHANNELS[type], stride = width * bpp;
  var raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height + 1024 });
  if (raw.length < (stride + 1) * height) return null;

  var out = Buffer.alloc(width * height * 4), prev = Buffer.alloc(stride), line = Buffer.alloc(stride);
  for (var y = 0; y < height; y++) {
    var start = y * (stride + 1), filter = raw[start];
    for (var i = 0; i < stride; i++) {
      var x = raw[start + 1 + i], a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) x += a;
      else if (filter === 2) x += b;
      else if (filter === 3) x += (a + b) >> 1;
      else if (filter === 4) x += paeth(a, b, c);
      else if (filter !== 0) return null;
      line[i] = x & 0xff;
    }
    for (var px = 0; px < width; px++) {
      var o = (y * width + px) * 4, s = px * bpp;
      if (type === 6) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = line[s + 3]; }
      else if (type === 2) {
        out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2];
        /* one colour may be named as the transparent one */
        out[o + 3] = trns && trns.length >= 6 && line[s] === trns[1] && line[s + 1] === trns[3] && line[s + 2] === trns[5] ? 0 : 255;
      } else if (type === 0) {
        out[o] = out[o + 1] = out[o + 2] = line[s];
        out[o + 3] = trns && trns.length >= 2 && line[s] === trns[1] ? 0 : 255;
      } else if (type === 4) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = line[s + 1]; }
      else {
        var idx = line[s] * 3;
        if (idx + 2 >= palette.length) return null;
        out[o] = palette[idx]; out[o + 1] = palette[idx + 1]; out[o + 2] = palette[idx + 2];
        out[o + 3] = trns && line[s] < trns.length ? trns[line[s]] : 255;
      }
    }
    var swap = prev; prev = line; line = swap;
  }
  return { width: width, height: height, data: out };
}

function chunk(name, body) {
  var head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(name, 4, 'latin1');
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.slice(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}
function encode(img) {
  var stride = img.width * 4, raw = Buffer.alloc((stride + 1) * img.height);
  for (var y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;                                   // no filter: a logo deflates well as it is
    img.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function flatten(img, rgb) {
  var out = Buffer.alloc(img.data.length), d = img.data;
  for (var i = 0; i < d.length; i += 4) {
    var a = d[i + 3] / 255;
    out[i] = Math.round(d[i] * a + rgb[0] * (1 - a));
    out[i + 1] = Math.round(d[i + 1] * a + rgb[1] * (1 - a));
    out[i + 2] = Math.round(d[i + 2] * a + rgb[2] * (1 - a));
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

/* the box, kept inside the picture and on whole pixels */
function clampBox(img, box) {
  var x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  var x1 = Math.min(img.width, Math.ceil(box.x + box.width)), y1 = Math.min(img.height, Math.ceil(box.y + box.height));
  return { x0: x0, y0: y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

function clearBox(img, box) {
  var out = Buffer.from(img.data), b = clampBox(img, box);
  for (var y = b.y0; y < b.y1; y++) out.fill(0, (y * img.width + b.x0) * 4, (y * img.width + b.x1) * 4);
  return { width: img.width, height: img.height, data: out };
}

function inkOf(img, box) {
  var b = box ? clampBox(img, box) : { x0: 0, y0: 0, x1: img.width, y1: img.height };
  var r = 0, g = 0, bl = 0, weight = 0, d = img.data;
  for (var y = b.y0; y < b.y1; y++) {
    for (var x = b.x0; x < b.x1; x++) {
      var o = (y * img.width + x) * 4, a = d[o + 3] / 255;
      if (!a) continue;
      r += d[o] * a; g += d[o + 1] * a; bl += d[o + 2] * a; weight += a;
    }
  }
  var area = (b.x1 - b.x0) * (b.y1 - b.y0);
  if (!weight) return { r: 0, g: 0, b: 0, coverage: 0 };
  return { r: Math.round(r / weight), g: Math.round(g / weight), b: Math.round(bl / weight), coverage: area ? weight / area : 0 };
}

/* does the picture have a see-through background (rather than a few soft edges on an opaque one)? */
function hasTransparency(img) {
  var clear = 0, d = img.data, total = img.width * img.height;
  for (var i = 3; i < d.length; i += 4) if (d[i] < 16) clear++;
  return clear > total * 0.03;
}

/* the colour around a box — what the box is painted with when its content is removed from an opaque
   picture: the most common colour (to the nearest 8 levels) on the outline of the box */
function edgeColour(img, box) {
  var b = clampBox(img, box), counts = {}, best = null, bestN = 0, d = img.data;
  function see(x, y) {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    var o = (y * img.width + x) * 4, key = (d[o] >> 3) + ',' + (d[o + 1] >> 3) + ',' + (d[o + 2] >> 3);
    var c = counts[key] || (counts[key] = { n: 0, r: 0, g: 0, b: 0 });
    c.n++; c.r += d[o]; c.g += d[o + 1]; c.b += d[o + 2];
    if (c.n > bestN) { bestN = c.n; best = c; }
  }
  for (var x = b.x0; x < b.x1; x++) { see(x, b.y0 - 1); see(x, b.y1); }
  for (var y = b.y0; y < b.y1; y++) { see(b.x0 - 1, y); see(b.x1, y); }
  if (!best) return [255, 255, 255];
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

function fillBox(img, box, rgb) {
  var out = Buffer.from(img.data), b = clampBox(img, box);
  for (var y = b.y0; y < b.y1; y++) {
    for (var x = b.x0; x < b.x1; x++) {
      var o = (y * img.width + x) * 4;
      out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = 255;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/* Is this pixel lettering? On a see-through picture: anything visible. On an opaque one: anything that is
   not the background colour. */
function isInk(d, o, background) {
  if (!background) return d[o + 3] >= 96;
  return Math.abs(d[o] - background[0]) + Math.abs(d[o + 1] - background[1]) + Math.abs(d[o + 2] - background[2]) > 96;
}

/* The lettering inside a box: where exactly it sits ({ x, y, width, height }, or null when the box is
   empty) and its colour. A vision model's box is a little loose or a little tight; this is the box of the
   pixels themselves. `background`: [r, g, b] for an opaque picture, null for a see-through one. */
function inkBounds(img, box, background) {
  var b = clampBox(img, box), d = img.data;
  var x0 = b.x1, y0 = b.y1, x1 = b.x0 - 1, y1 = b.y0 - 1, r = 0, g = 0, bl = 0, n = 0;
  for (var y = b.y0; y < b.y1; y++) {
    for (var x = b.x0; x < b.x1; x++) {
      var o = (y * img.width + x) * 4;
      if (!isInk(d, o, background)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      /* the colour of the letters is the colour of their solid middles, not of their soft edges */
      if (background || d[o + 3] >= 250) { r += d[o]; g += d[o + 1]; bl += d[o + 2]; n++; }
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  return {
    x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1,
    colour: n ? [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] : null
  };
}

/* the part of the picture inside a box, as a picture of its own (null when the box holds nothing) */
function crop(img, box) {
  var b = clampBox(img, box), w = b.x1 - b.x0, h = b.y1 - b.y0;
  if (w <= 0 || h <= 0) return null;
  var out = Buffer.alloc(w * h * 4);
  for (var y = 0; y < h; y++) img.data.copy(out, y * w * 4, ((b.y0 + y) * img.width + b.x0) * 4, ((b.y0 + y) * img.width + b.x1) * 4);
  return { width: w, height: h, data: out };
}

/* How much lettering each row (axis 'y') or column (axis 'x') of the picture holds: an array of counts.
   Where it is 0 the picture can be cut without cutting through anything. */
function inkProfile(img, axis, background) {
  var n = axis === 'y' ? img.height : img.width, counts = new Array(n).fill(0), d = img.data;
  for (var y = 0; y < img.height; y++) {
    for (var x = 0; x < img.width; x++) {
      if (isInk(d, (y * img.width + x) * 4, background)) counts[axis === 'y' ? y : x]++;
    }
  }
  return counts;
}

/* The runs of a profile that hold lettering, with the empty lines between them: [{ from, to }] (to is one
   past the last line). A picture can be cut between two runs without cutting through anything. */
function inkRuns(profile) {
  var runs = [], from = -1;
  for (var i = 0; i <= profile.length; i++) {
    var inked = i < profile.length && profile[i] > 0;
    if (inked && from === -1) from = i;
    else if (!inked && from !== -1) { runs.push({ from: from, to: i }); from = -1; }
  }
  return runs;
}

/* How many pixels of lettering a box holds — all of them, or (with `within`, a list of boxes) only those
   that also lie inside at least one of those boxes. */
function inkCount(img, box, background, within, without) {
  var b = clampBox(img, box), d = img.data, n = 0;
  var areas = within ? within.map(function (w) { return clampBox(img, w); }) : null;
  var outside = without && without.length ? without.map(function (w) { return clampBox(img, w); }) : null;
  for (var y = b.y0; y < b.y1; y++) {
    for (var x = b.x0; x < b.x1; x++) {
      if (!isInk(d, (y * img.width + x) * 4, background)) continue;
      if (areas && !areas.some(function (a) { return x >= a.x0 && x < a.x1 && y >= a.y0 && y < a.y1; })) continue;
      if (outside && outside.some(function (a) { return x >= a.x0 && x < a.x1 && y >= a.y0 && y < a.y1; })) continue;
      n++;
    }
  }
  return n;
}

module.exports = { decode, encode, flatten, clearBox, fillBox, crop, inkOf, inkBounds, inkProfile, inkRuns, inkCount, edgeColour, hasTransparency, MAX_PIXELS };
