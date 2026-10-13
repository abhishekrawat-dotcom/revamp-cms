// node functions/lib/png-lite.test.js — the PNG reader/writer behind the logo unit, on pictures made here.
const zlib = require('zlib');
const png = require('./png-lite');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail ? ' — ' + detail : ''));
}

/* a 6x4 picture: transparent, with a white 2x2 block at (1,1) and a red pixel at (4,2) */
function sample() {
  var img = { width: 6, height: 4, data: Buffer.alloc(6 * 4 * 4) };
  function put(x, y, r, g, b, a) { var o = (y * 6 + x) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a; }
  put(1, 1, 255, 255, 255, 255); put(2, 1, 255, 255, 255, 255); put(1, 2, 255, 255, 255, 255); put(2, 2, 255, 255, 255, 255);
  put(4, 2, 255, 0, 0, 255);
  return img;
}

var img = sample();
var bytes = png.encode(img);
check('encode writes a PNG', bytes.slice(1, 4).toString() === 'PNG' && bytes.readUInt32BE(16) === 6 && bytes.readUInt32BE(20) === 4 && bytes[25] === 6);
var back = png.decode(bytes);
check('decode gives the same pixels back', back && back.width === 6 && back.height === 4 && back.data.equals(img.data));

/* every row filter, as an encoder other than ours would write them */
function withFilters(img) {
  var stride = img.width * 4, raw = Buffer.alloc((stride + 1) * img.height);
  function paeth(a, b, c) { var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
  for (var y = 0; y < img.height; y++) {
    var f = (y % 4) + 1; raw[y * (stride + 1)] = f;
    for (var i = 0; i < stride; i++) {
      var x = img.data[y * stride + i], a = i >= 4 ? img.data[y * stride + i - 4] : 0, b = y ? img.data[(y - 1) * stride + i] : 0, c = (y && i >= 4) ? img.data[(y - 1) * stride + i - 4] : 0;
      raw[y * (stride + 1) + 1 + i] = (x - (f === 1 ? a : f === 2 ? b : f === 3 ? ((a + b) >> 1) : paeth(a, b, c))) & 0xff;
    }
  }
  return raw;
}
function rebuild(raw, ihdrEdit, extra) {
  var parts = [bytes.slice(0, 8)], at = 8;
  while (at < bytes.length) {
    var len = bytes.readUInt32BE(at), name = bytes.toString('latin1', at + 4, at + 8), whole = bytes.slice(at, at + 12 + len);
    if (name === 'IHDR' && ihdrEdit) { whole = Buffer.from(whole); ihdrEdit(whole.slice(8, 8 + len)); }
    if (name === 'IDAT' && raw) {
      var body = zlib.deflateSync(raw), head = Buffer.alloc(8);
      head.writeUInt32BE(body.length, 0); head.write('IDAT', 4, 'latin1');
      whole = Buffer.concat([head, body, Buffer.alloc(4)]);         // the reader does not check the CRC
      if (extra) parts.push(extra);
    }
    parts.push(whole);
    at += 12 + len;
  }
  return Buffer.concat(parts);
}
var filtered = png.decode(rebuild(withFilters(img)));
check('decode undoes the Sub, Up, Average and Paeth filters', filtered && filtered.data.equals(img.data));

check('not a PNG -> null', png.decode(Buffer.from('GIF89a' + new Array(60).join('x'))) === null);
check('empty -> null', png.decode(Buffer.alloc(0)) === null && png.decode(null) === null && png.decode('text') === null);
check('truncated -> null', png.decode(bytes.slice(0, bytes.length - 20)) === null);
check('too little pixel data -> null', png.decode(rebuild(Buffer.from('short'), null)) === null);
check('data that is not deflate -> null, no throw', png.decode(Buffer.concat([bytes.slice(0, 33), Buffer.from([0, 0, 0, 4]), Buffer.from('IDATjunk'), Buffer.alloc(4), bytes.slice(bytes.length - 12)])) === null);
check('interlaced -> null', png.decode(rebuild(null, function (ihdr) { ihdr[12] = 1; })) === null);
check('16-bit -> null', png.decode(rebuild(null, function (ihdr) { ihdr[8] = 16; })) === null);
check('too large -> null', png.decode(rebuild(null, function (ihdr) { ihdr.writeUInt32BE(100000, 0); ihdr.writeUInt32BE(100000, 4); })) === null);

/* a palette picture with a transparent entry */
(function () {
  var raw = Buffer.concat([Buffer.from([0, 0, 1, 2]), Buffer.from([0, 2, 1, 0])]);      // two rows of three pixels
  function chunk(name, body) { var h = Buffer.alloc(8); h.writeUInt32BE(body.length, 0); h.write(name, 4, 'latin1'); return Buffer.concat([h, body, Buffer.alloc(4)]); }
  var ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(3, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 3;
  var file = Buffer.concat([bytes.slice(0, 8), chunk('IHDR', ihdr), chunk('PLTE', Buffer.from([0, 0, 0, 255, 0, 0, 0, 0, 255])),
    chunk('tRNS', Buffer.from([0])), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  var p = png.decode(file);
  check('palette + tRNS', p && p.width === 3 && p.data[3] === 0 && p.data[4] === 255 && p.data[7] === 255 && p.data[10] === 255 && p.data[11] === 255, p && p.data.toString('hex'));
})();

var flat = png.flatten(img, [128, 128, 128]);
check('flatten lays it on the colour', flat.data[0] === 128 && flat.data[3] === 255 && flat.data[(1 * 6 + 1) * 4] === 255 && flat !== img && img.data[3] === 0);

var cleared = png.clearBox(img, { x: 1, y: 1, width: 2, height: 2 });
check('clearBox empties the box only', cleared.data[(1 * 6 + 1) * 4 + 3] === 0 && cleared.data[(2 * 6 + 4) * 4 + 3] === 255 && img.data[(1 * 6 + 1) * 4 + 3] === 255);
check('clearBox outside the picture changes nothing', png.clearBox(img, { x: 50, y: 50, width: 5, height: 5 }).data.equals(img.data) && png.clearBox(img, { x: -5, y: -5, width: 2, height: 2 }).data.equals(img.data));

var ink = png.inkOf(img);
check('inkOf: mostly white, a little red', ink.r === 255 && ink.g === 204 && ink.coverage > 0.2 && ink.coverage < 0.22, JSON.stringify(ink));
check('inkOf an empty box', png.inkOf(img, { x: 0, y: 0, width: 1, height: 1 }).coverage === 0);

var bounds = png.inkBounds(img, { x: 0, y: 0, width: 4, height: 4 }, null);
check('inkBounds finds the block', bounds && bounds.x === 1 && bounds.y === 1 && bounds.width === 2 && bounds.height === 2 && bounds.colour.join() === '255,255,255', JSON.stringify(bounds));
check('inkBounds of nothing -> null', png.inkBounds(img, { x: 0, y: 0, width: 1, height: 1 }, null) === null);

check('hasTransparency', png.hasTransparency(img) === true && png.hasTransparency(flat) === false);
var edge = png.edgeColour(flat, { x: 1, y: 1, width: 2, height: 2 });
check('edgeColour is the grey around the block', edge.join() === '128,128,128', edge.join());
var onGrey = png.inkBounds(flat, { x: 0, y: 0, width: 4, height: 4 }, edge);
check('inkBounds on an opaque picture', onGrey && onGrey.x === 1 && onGrey.width === 2 && onGrey.colour.join() === '255,255,255', JSON.stringify(onGrey));
var filled = png.fillBox(flat, { x: 1, y: 1, width: 2, height: 2 }, edge);
check('fillBox paints the box', filled.data[(1 * 6 + 1) * 4] === 128 && filled.data[(2 * 6 + 4) * 4] === 255 && flat.data[(1 * 6 + 1) * 4] === 255);

var cut = png.crop(img, { x: 1, y: 1, width: 2, height: 2 });
check('crop takes the box out as a picture', cut && cut.width === 2 && cut.height === 2 && cut.data.every(function (v) { return v === 255; }) && png.crop(img, { x: 40, y: 0, width: 2, height: 2 }) === null);
check('inkProfile counts lettering per row and per column', png.inkProfile(img, 'y', null).join() === '0,2,3,0' && png.inkProfile(img, 'x', null).join() === '0,2,2,0,1,0');

if (failed) { console.error('png-lite: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
console.log('png-lite: all ' + passed + ' checks passed');
