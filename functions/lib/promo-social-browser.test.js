// node functions/lib/promo-social-browser.test.js — the browser half of Promotions → Social posts:
// assets/vendor/promo-social.js (window.OWSocial: the layout editor's flattener, its export page and the PSD reader,
// built by tools/build-promo-social.js from promo-engine/src/browser.ts) and assets/vendor/html-to-image-exact.js.
// No network and no browser: the bundle runs in a vm with what a browser gives it (TextDecoder, atob, WebAssembly);
// the flattener walks a small DOM stand-in that answers as Chrome does; the PSD reader draws on a canvas stand-in
// that composites real pixels. PSDs are written in memory with the repo's own ag-psd.bundle.js.
var fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function count(s, sub) { return s.split(sub).length - 1; }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
var pending = [];

var BUNDLE_PATH = 'assets/vendor/promo-social.js';
var bundle = read(BUNDLE_PATH);
var build = require(path.join(ROOT, 'tools', 'build-promo-social.js'));

/* A vm that looks like the studio's page to the bundle: its own global is `window`, and it has the browser globals
   the PSD library reaches for when it loads (TextDecoder for layer names, atob and WebAssembly for its decoder). */
function browserContext(extra) {
  var ctx = { TextDecoder: TextDecoder, TextEncoder: TextEncoder, atob: atob, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout };
  Object.keys(extra || {}).forEach(function (k) { ctx[k] = extra[k]; });
  ctx.window = ctx;
  vm.createContext(ctx);
  return ctx;
}
function loadBundle(extra) { var ctx = browserContext(extra); vm.runInContext(bundle, ctx, { filename: BUNDLE_PATH }); return ctx; }

/* ---- B.1: the bundle parses and defines window.OWSocial ---- */
var parses = (function () { try { new vm.Script(bundle, { filename: BUNDLE_PATH }); return true; } catch (e) { return String(e && e.message); } })();
check('the bundle parses', parses === true, parses);
var W1 = loadBundle();
var OW = W1.window.OWSocial;
check('window.OWSocial is defined', !!OW);
['extract', 'renderEditableHtml', 'psdUnits', 'classify'].forEach(function (k) { check('OWSocial.' + k + ' is a function', OW && typeof OW[k] === 'function'); });
check('OWSocial.MAX_EDGE is 3840', OW && OW.MAX_EDGE === 3840, OW && OW.MAX_EDGE);
check('OWSocial.PSD_LIMITS: 120 MB file, 100 Mpx and 16,384 px canvas, 64 Mpx layer, 3840 px edge', OW && JSON.stringify(OW.PSD_LIMITS) ===
  JSON.stringify({ maxFileBytes: 120 * 1024 * 1024, maxCanvasPixels: 100000000, maxSide: 16384, maxLayerPixels: 64000000, maxEdge: 3840 }), OW && OW.PSD_LIMITS);
check('OWSocial exposes nothing beyond the contract', OW && Object.keys(OW).sort().join() === 'MAX_EDGE,PSD_LIMITS,classify,extract,psdUnits,renderEditableHtml', OW && Object.keys(OW));
check('the bundle sets one global, OWSocial', /^var OWSocial = \(\(\) => \{$/m.test(bundle) && count(bundle, '\nvar ') === 1);

/* ---- B.2: renderEditableHtml writes what the platform wrote (src/editor.ts:19-57), except D18 ---- */
// The expected strings are the platform's own output for these elements (its editor.ts, run once to make them).
var BASE = 'blob:https://oneworld.example/5f0c';
var HEAD = "<!doctype html><html><head><meta charset=\"utf-8\"><style>\n    @import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=Mulish:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400&family=Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Montserrat:wght@400;600;700;800;900&family=Oswald:wght@400;500;600;700&family=Anton&family=Bebas+Neue&family=Playfair+Display:ital,wght@0,700;1,700&display=swap');\n    *{margin:0;box-sizing:border-box}html,body{width:1080px;height:1080px}\n    .stage{position:relative;width:1080px;height:1080px;overflow:hidden}\n    .stage>.bg{position:absolute;inset:0;width:1080px;height:1080px}\n  </style></head><body><div class=\"stage\">";
var ELS = {
  image: { id: 'e1', type: 'image', x: 10, y: 20, w: 300, h: 200, rotate: 0, src: 'https://img.etb2bimg.com/a.jpg?w=1&h=2', objectFit: 'cover', objectPosition: '50% 0%', radius: '24px', background: 'rgba(0, 0, 0, 0)', padding: '0px' },
  frame: { id: 'e2', type: 'frame', x: 400, y: 100, w: 432, h: 540, rotate: 5, radius: '32.4px', border: 'none', boxShadow: 'rgba(0, 0, 0, 0.3) 0px 21.6px 64.8px 0px', background: 'rgba(255, 255, 255, 0.08)', src: 'data:image/png;base64,iVBORw0KGgo=', objectFit: 'cover', objectPosition: '50% 0%', imgScale: 1.2, imgX: -10, imgY: 5, imgRotate: 0, scrim: 'linear-gradient(rgba(0, 0, 0, 0) 46%, rgba(0, 0, 0, 0.62))' },
  shape: { id: 'e3', type: 'shape', x: 64.8, y: 700, w: 950.4, h: 120, rotate: 0, background: 'rgba(8, 10, 22, 0.34)', backdropFilter: 'blur(16px) saturate(1.15)', border: '1px solid rgba(255, 255, 255, 0.16)', radius: '32.4px', boxShadow: 'rgba(0, 0, 0, 0.28) 0px 16.2px 43.2px 0px' },
  text: { id: 'e4', type: 'text', x: 100, y: 300, w: 801, h: 120, rotate: 0, text: 'Voices <b>of</b> Last & Edition', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 49.68, fontWeight: '700', fontStyle: 'normal', color: 'rgb(255, 255, 255)', textAlign: 'start', lineHeight: '49.68px', letterSpacing: '0.9936px', textTransform: 'uppercase', textShadow: 'rgba(0, 0, 0, 0.3) 0px 4.32px 21.6px', whiteSpace: 'nowrap', background: 'rgba(0, 0, 0, 0)', backdropFilter: 'none', padding: '0px', radius: '0px', boxShadow: 'none' },
  textDefaults: { id: 'e5', type: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x' },
  quoteSrc: { id: 'e6', type: 'image', x: 1, y: 2, w: 3, h: 4, src: 'https://img.etb2bimg.com/a"b.png' },
  quoteMark: { id: 'e7', type: 'text', x: 171, y: 330, w: 120, h: 95, rotate: 0, text: '“', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 118.8, fontWeight: '700', fontStyle: 'normal', color: 'rgb(229, 57, 53)', textAlign: 'start', lineHeight: '95.04px', letterSpacing: 'normal', textTransform: 'none', textShadow: 'none', whiteSpace: 'nowrap', background: 'rgba(0, 0, 0, 0)', backdropFilter: 'none', padding: '0px', radius: '0px', boxShadow: 'none' }
};
var PLATFORM = {
  image: "<img style=\"position:absolute;left:10px;top:20px;width:300px;height:200px;object-fit:cover;object-position:50% 0%;box-sizing:border-box;background:transparent;padding:0px;border-radius:24px;box-shadow:none;transform:rotate(0deg);transform-origin:center center;\" src=\"https://img.etb2bimg.com/a.jpg?w=1&amp;h=2\">",
  frame: "<div style=\"position:absolute;left:400px;top:100px;width:432px;height:540px;overflow:hidden;border-radius:32.4px;border:none;box-shadow:rgba(0, 0, 0, 0.3) 0px 21.6px 64.8px 0px;background:rgba(255, 255, 255, 0.08);transform:rotate(5deg);transform-origin:center center;\"><img style=\"position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 0%;transform:translate(-10px, 5px) scale(1.2) rotate(0deg);transform-origin:center center\" src=\"data:image/png;base64,iVBORw0KGgo=\"><div style=\"position:absolute;inset:0;pointer-events:none;background:linear-gradient(rgba(0, 0, 0, 0) 46%, rgba(0, 0, 0, 0.62))\"></div></div>",
  shape: "<div style=\"position:absolute;left:64.8px;top:700px;width:950.4px;height:120px;background:rgba(8, 10, 22, 0.34);backdrop-filter:blur(16px) saturate(1.15);-webkit-backdrop-filter:blur(16px) saturate(1.15);border:1px solid rgba(255, 255, 255, 0.16);border-radius:32.4px;box-shadow:rgba(0, 0, 0, 0.28) 0px 16.2px 43.2px 0px;transform:rotate(0deg);transform-origin:center center;\"></div>",
  text: "<div style=\"position:absolute;left:100px;top:300px;width:801px;box-sizing:border-box;font-family:Inter, system-ui, sans-serif;font-size:49.68px;font-weight:700;font-style:normal;color:rgb(255, 255, 255);text-align:start;line-height:49.68px;letter-spacing:0.9936px;text-transform:uppercase;text-shadow:rgba(0, 0, 0, 0.3) 0px 4.32px 21.6px;background:transparent;padding:0px;border-radius:0px;box-shadow:none;transform:rotate(0deg);transform-origin:center center;white-space:nowrap;\">Voices &lt;b&gt;of&lt;/b&gt; Last &amp; Edition</div>",
  textDefaults: "<div style=\"position:absolute;left:0px;top:0px;width:10px;box-sizing:border-box;font-family:Inter;font-size:24px;font-weight:400;font-style:normal;color:#fff;text-align:left;line-height:normal;letter-spacing:normal;text-transform:none;text-shadow:none;background:transparent;padding:0;border-radius:0;box-shadow:none;transform:rotate(0deg);transform-origin:center center;white-space:pre-wrap;\">x</div>",
  quoteSrc: "<img style=\"position:absolute;left:1px;top:2px;width:3px;height:4px;object-fit:cover;object-position:center;box-sizing:border-box;background:transparent;padding:0;border-radius:0;box-shadow:none;transform:rotate(0deg);transform-origin:center center;\" src=\"https://img.etb2bimg.com/a&quot;b.png\">",
  quoteMark: "<div style=\"position:absolute;left:171px;top:330px;width:120px;box-sizing:border-box;font-family:Georgia, \"Times New Roman\", serif;font-size:118.8px;font-weight:700;font-style:normal;color:rgb(229, 57, 53);text-align:start;line-height:95.04px;letter-spacing:normal;text-transform:none;text-shadow:none;background:transparent;padding:0px;border-radius:0px;box-shadow:none;transform:rotate(0deg);transform-origin:center center;white-space:nowrap;\">“</div>"
};
function page(body, base) { return HEAD + '<img class="bg" src="' + (base || BASE) + '">' + body + '</div></body></html>'; }
function decodeAttr(s) { return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function styleAttrs(html) { var out = [], re = /style="([^"]*)"/g, m; while ((m = re.exec(html))) out.push(m[1]); return out; }

if (OW) {
  ['image', 'frame', 'shape', 'text', 'textDefaults', 'quoteSrc'].forEach(function (k) {
    var got = OW.renderEditableHtml(1080, 1080, BASE, [ELS[k]]);
    check('renderEditableHtml, ' + k + ': the platform\'s exact output', got === page(PLATFORM[k]), got);
  });
  var allGot = OW.renderEditableHtml(1080, 1080, BASE, ['image', 'frame', 'shape', 'text'].map(function (k) { return ELS[k]; }));
  check('renderEditableHtml, four elements in order: the platform\'s output joined', allGot === page(PLATFORM.image + PLATFORM.frame + PLATFORM.shape + PLATFORM.text));
  check('renderEditableHtml: text <b> and & escaped, a src with " escaped (the platform\'s own esc)',
    allGot.indexOf('Voices &lt;b&gt;of&lt;/b&gt; Last &amp; Edition') !== -1 && OW.renderEditableHtml(10, 10, BASE, [ELS.quoteSrc]).indexOf('a&quot;b.png') !== -1);

  /* D18: the platform's output for a quoted font family ends the style attribute at "Georgia, " */
  var platformStyles = styleAttrs(page(PLATFORM.quoteMark));
  check('D18 is real: the platform\'s style attribute stops at the first " of the font family', platformStyles[0] && /font-family:Georgia, $/.test(platformStyles[0]), platformStyles[0]);
  var mark = OW.renderEditableHtml(1080, 1080, BASE, [ELS.quoteMark]);
  check('D18: the quoted family is written font-family:Georgia, &quot;Times New Roman&quot;, serif, and nothing else changes',
    mark === page(PLATFORM.quoteMark.replace('Georgia, "Times New Roman", serif', 'Georgia, &quot;Times New Roman&quot;, serif')), mark);
  var markStyle = styleAttrs(mark).filter(function (s) { return s.indexOf('font-family') !== -1; })[0] || '';
  check('D18: that attribute decodes back to the original family, with its size, colour and the rest after it',
    decodeAttr(markStyle).indexOf('font-family:Georgia, "Times New Roman", serif;font-size:118.8px;font-weight:700;') !== -1 &&
    /white-space:nowrap;$/.test(decodeAttr(markStyle)), decodeAttr(markStyle));
  var sneaky = { id: 'e9', type: 'text', x: '1px;" onmouseover="alert(1)', y: 0, w: 5, h: 5, text: 'a', color: 'red" data-x="1', background: 'url(a&b)' };
  var sneakyHtml = OW.renderEditableHtml(10, 10, BASE, [sneaky]);
  var outsideStyles = sneakyHtml.replace(/style="[^"]*"/g, 'style=""');
  check('D18: a style value cannot end the attribute and add one (" and & escaped)', outsideStyles.indexOf('onmouseover') === -1 && outsideStyles.indexOf('data-x') === -1 &&
    sneakyHtml.indexOf('left:1px;&quot; onmouseover=&quot;alert(1)px') !== -1 && sneakyHtml.indexOf('background:url(a&amp;b)') !== -1, sneakyHtml);
  check('D18: the elements handed in are not changed', ELS.quoteMark.fontFamily === 'Georgia, "Times New Roman", serif' && sneaky.color === 'red" data-x="1');
  check('D18: the base picture\'s address is escaped like a src', OW.renderEditableHtml(10, 10, 'https://x/b"a&c.png', []).indexOf('<img class="bg" src="https://x/b&quot;a&amp;c.png">') !== -1);
  check('renderEditableHtml: no elements → the base alone', OW.renderEditableHtml(1080, 1080, BASE, []) === page('') && OW.renderEditableHtml(1080, 1080, BASE, null) === page(''));
}

/* ---- B.3: classify — the platform's rules and thresholds (src/psd/extract.ts:62-70) ---- */
if (OW) {
  var C = function (l) { return OW.classify(l, 1000, 1000); };
  var L = function (o) { var l = { name: 'L', left: 0, top: 0, width: 10, height: 10 }; Object.keys(o).forEach(function (k) { l[k] = o[k]; }); return l; };
  check('classify: hidden → ignore', C(L({ isHidden: true, width: 1000, height: 1000 })) === 'ignore');
  check('classify: zero width or height → ignore', C(L({ width: 0, height: 1000 })) === 'ignore' && C(L({ width: 1000, height: 0 })) === 'ignore');
  check('classify: a text layer → text, even full bleed', C(L({ text: 'Hello', width: 1000, height: 1000 })) === 'text');
  check('classify: full bleed at exactly 90% wide, 85% high, 10% in → background', C(L({ width: 900, height: 850, left: 100, top: 100 })) === 'background');
  check('classify: 89.9% wide → not background (a sizeable layer: logo)', C(L({ width: 899, height: 850, left: 100, top: 100 })) === 'logo');
  check('classify: 84.9% high → not background', C(L({ width: 900, height: 849, left: 100, top: 100 })) === 'logo');
  check('classify: 10.1% in from the left or top → not background', C(L({ width: 900, height: 850, left: 101, top: 0 })) === 'logo' && C(L({ width: 900, height: 850, left: 0, top: 101 })) === 'logo');
  check('classify: no left or top counts as 0', C({ name: 'n', width: 950, height: 900 }) === 'background');
  check('classify: area at exactly 3% → logo', C(L({ width: 300, height: 100, left: 400, top: 400 })) === 'logo');
  check('classify: just under 3% → ignore', C(L({ width: 299, height: 100, left: 400, top: 400 })) === 'ignore');
  check('classify: a layer named after an Object method still gets its geometric role', C(L({ name: 'constructor', width: 1000, height: 1000 })) === 'background' &&
    C(L({ name: 'toString', width: 5, height: 5 })) === 'ignore');
  check('classify: an override for the layer\'s own name wins (the platform\'s reassign hook)', OW.classify(L({ name: 'Badge', width: 5, height: 5 }), 1000, 1000, { Badge: 'logo' }) === 'logo');
}

/* ---- a canvas stand-in that composites real pixels (straight alpha, "over"), and an ImageData ---- */
var PIXEL_CAP = 4000000; // canvases above this record their draws but keep no pixels (a 7932 × 4818 test canvas)
function FakeImageData(data, w, h) { if (!data || data.length !== w * h * 4) throw new RangeError('ImageData size does not match'); this.data = data; this.width = w; this.height = h; }
function makeCanvasKit(opts) {
  opts = opts || {};
  var kit = { made: [], blobs: 0 };
  function Canvas() {
    var w = 0, h = 0, self = this;
    this._px = null; this.draws = [];
    Object.defineProperty(this, 'width', { get: function () { return w; }, set: function (v) { w = v | 0; self._px = null; } });
    Object.defineProperty(this, 'height', { get: function () { return h; }, set: function (v) { h = v | 0; self._px = null; } });
    kit.made.push(this);
  }
  Canvas.prototype.pixels = function () {
    var n = this.width * this.height;
    if (!n || n > PIXEL_CAP) return null;
    if (!this._px) this._px = new Uint8ClampedArray(n * 4);
    return this._px;
  };
  Canvas.prototype.getContext = function (t) {
    if (t !== '2d') return null;
    if (opts.refuseOver && this.width * this.height > opts.refuseOver) return null;
    var cv = this;
    return this._ctx || (this._ctx = {
      imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
      putImageData: function (img, x, y) {
        var px = cv.pixels(); if (!px) return;
        for (var r = 0; r < img.height; r++) for (var c = 0; c < img.width; c++) {
          var tx = x + c, ty = y + r; if (tx < 0 || ty < 0 || tx >= cv.width || ty >= cv.height) continue;
          var s = (r * img.width + c) * 4, d = (ty * cv.width + tx) * 4;
          px[d] = img.data[s]; px[d + 1] = img.data[s + 1]; px[d + 2] = img.data[s + 2]; px[d + 3] = img.data[s + 3];
        }
      },
      drawImage: function (src, dx, dy, dw, dh) {
        var scaled = dw !== undefined;
        cv.draws.push({ w: src.width, h: src.height, dx: dx, dy: dy, dw: scaled ? dw : src.width, dh: scaled ? dh : src.height, smoothing: this.imageSmoothingQuality });
        var px = cv.pixels(), sp = src.pixels(); if (!px || !sp) return;
        dw = scaled ? dw : src.width; dh = scaled ? dh : src.height;
        for (var r = 0; r < dh; r++) for (var c = 0; c < dw; c++) {
          var tx = dx + c, ty = dy + r; if (tx < 0 || ty < 0 || tx >= cv.width || ty >= cv.height) continue;
          var sx = Math.min(src.width - 1, Math.floor(c * src.width / dw)), sy = Math.min(src.height - 1, Math.floor(r * src.height / dh));
          var s = (sy * src.width + sx) * 4, d = (ty * cv.width + tx) * 4;
          var sa = sp[s + 3] / 255, da = px[d + 3] / 255, oa = sa + da * (1 - sa);
          for (var k = 0; k < 3; k++) px[d + k] = oa ? Math.round((sp[s + k] * sa + px[d + k] * da * (1 - sa)) / oa) : 0;
          px[d + 3] = Math.round(oa * 255);
        }
      }
    });
  };
  Canvas.prototype.toBlob = function (cb, type) {
    var px = this.pixels(), me = { type: type, width: this.width, height: this.height, pixels: px ? new Uint8ClampedArray(px) : null };
    kit.blobs++;
    setTimeout(function () { cb(opts.noBlob ? null : me); }, 0);
  };
  kit.document = { createElement: function (t) { if (t !== 'canvas') throw new Error('only canvases here, not ' + t); return new Canvas(); } };
  return kit;
}
function pxAt(unit, x, y) { var b = unit.blob, i = (y * b.width + x) * 4; return b.pixels ? Array.prototype.slice.call(b.pixels, i, i + 4) : null; }
function psdHeader(w, h, version) {
  var b = Buffer.alloc(26 + 4 * 4); // header, then empty colour-mode, resources, layer and image-data lengths
  b.write('8BPS', 0, 'latin1'); b.writeUInt16BE(version || 1, 4); b.writeUInt16BE(3, 12); b.writeUInt32BE(h, 14); b.writeUInt32BE(w, 18); b.writeUInt16BE(8, 22); b.writeUInt16BE(3, 24);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function errOf(p) { return p.then(function (v) { return { ok: v }; }, function (e) { return { name: e && e.name, message: e && e.message }; }); }
var TOO_LARGE = 'This PSD is too large to read in the browser. Save a flattened copy of at most 64 megapixels and 16,384 px a side (8,000 × 8,000 px fits), or upload the background and logo as pictures.';
var UNREADABLE = 'This PSD could not be read. Save it again from Photoshop with Maximize Compatibility on, or upload the background and logo as pictures.';

/* ---- B.4 (a): the PSD guards and boxes, with the PSD library replaced by a scripted one whose decode is a spy ---- */
function fakeLayer(name, left, top, w, h, rgba, more) {
  var l = { name: name, left: left, top: top, width: w, height: h, isHidden: false, text: undefined, decodes: 0 };
  l.composite = function () {
    l.decodes++; var d = new Uint8ClampedArray(w * h * 4);
    if (w * h * 4 <= PIXEL_CAP * 4) for (var i = 0; i < w * h; i++) d.set(rgba, i * 4);
    return Promise.resolve(d);
  };
  Object.keys(more || {}).forEach(function (k) { l[k] = more[k]; });
  return l;
}
pending.push(new Promise(function (resolve, reject) {
  var esbuild = require('esbuild');
  esbuild.build({
    absWorkingDir: ROOT, entryPoints: [path.join(ROOT, 'promo-engine', 'src', 'psd', 'extract.ts')], bundle: true, format: 'iife', globalName: 'PSDX',
    platform: 'browser', target: 'es2018', write: false, logLevel: 'silent',
    plugins: [{ name: 'scripted-psd', setup: function (b) {
      b.onResolve({ filter: /webtoon-psd\/index\.js$/ }, function () { return { path: 'scripted', namespace: 'scripted' }; });
      b.onLoad({ filter: /.*/, namespace: 'scripted' }, function () { return { contents: 'export default { parse: function (b) { return globalThis.__parse(b); } };', loader: 'js' }; });
    } }]
  }).then(function (r) { resolve(r.outputFiles[0].text); }, reject);
}).then(function (code) {
  function run(header, tree, kitOpts) {
    var kit = makeCanvasKit(kitOpts), calls = { parse: 0 };
    var ctx = browserContext({ document: kit.document, ImageData: FakeImageData });
    ctx.__parse = function () { calls.parse++; if (tree instanceof Error) throw tree; return tree; };
    vm.runInContext(code, ctx);
    return errOf(ctx.PSDX.psdUnits(header, { maxEdge: 3840 })).then(function (res) { return { res: res, kit: kit, calls: calls, limits: ctx.PSDX.PSD_LIMITS }; });
  }
  var decodes = function (tree) { var n = 0; (function w(t) { (t.children || []).forEach(function (c) { if (c.children) w(c); else n += c.decodes; }); })(tree); return n; };
  var huge = { width: 20000, height: 20000, children: [fakeLayer('bg', 0, 0, 20000, 20000, [1, 2, 3, 255])] };
  var lie = { width: 20000, height: 20000, children: [fakeLayer('bg', 0, 0, 20000, 20000, [1, 2, 3, 255])] };
  var fat = { width: 10000, height: 7000, children: [fakeLayer('logo', 4000, 3000, 300, 120, [9, 9, 9, 255]), fakeLayer('bg', 0, 0, 10000, 7000, [1, 2, 3, 255])] };
  // the flattened copies the "too large" sentence asks for: one full-bleed layer at the 8,000 × 8,000 it names, and
  // one row over 64 megapixels
  var flat = { width: 8000, height: 8000, children: [fakeLayer('Background', 0, 0, 8000, 8000, [1, 2, 3, 255])] };
  var flatOver = { width: 8000, height: 8001, children: [fakeLayer('Background', 0, 0, 8000, 8001, [1, 2, 3, 255])] };
  var nds2 = { width: 7932, height: 4818, children: [
    { name: 'Group', children: [fakeLayer('logo', 5000, 3000, 1300, 900, [0, 200, 0, 255])] }, // 3.06% of the canvas: a logo by the rule
    fakeLayer('icon', 100, 100, 40, 40, [0, 0, 255, 255]),
    fakeLayer('headline', 200, 200, 3000, 400, [9, 9, 9, 255], { text: 'Big headline' }),
    fakeLayer('bg', 0, 0, 7932, 4818, [200, 0, 0, 255])
  ] };
  var small = { width: 200, height: 100, children: [
    fakeLayer('edge', 170, -10, 50, 40, [0, 0, 250, 255]),
    fakeLayer('logo', 40, 30, 60, 30, [0, 200, 0, 128]),
    fakeLayer('bgTop', 0, 0, 200, 100, [0, 0, 0, 0]), // full bleed and clear: drawn over the red, which shows through
    fakeLayer('bg', 0, 0, 200, 100, [200, 0, 0, 255]),
    fakeLayer('off', 300, 300, 50, 50, [1, 1, 1, 255])
  ] };
  return Promise.all([
    run(psdHeader(20000, 20000), huge), run(psdHeader(20000, 20000, 2), huge), run(psdHeader(7932, 4818), lie), run(psdHeader(10000, 7000), fat),
    run(psdHeader(7932, 4818), nds2), run(psdHeader(200, 100), small), run(psdHeader(200, 100), new RangeError('Offset is outside the bounds of the DataView')),
    run(psdHeader(200, 100), small, { refuseOver: 15000 }), run(psdHeader(200, 100), small, { noBlob: true }),
    run(psdHeader(16384, 6103), { width: 16384, height: 6103, children: [] }), run(psdHeader(16385, 100), { width: 16385, height: 100, children: [] }),
    run(psdHeader(8000, 8000), flat), run(psdHeader(8000, 8001), flatOver)
  ]).then(function (r) {
    check('PSD 20,000 × 20,000 header → PsdTooLarge with the sentence', r[0].res.name === 'PsdTooLarge' && r[0].res.message === TOO_LARGE, r[0].res);
    check('PSD 20,000 × 20,000: refused before the library parses it and before any decode', r[0].calls.parse === 0 && decodes(huge) === 0 && r[0].kit.made.length === 0, [r[0].calls.parse, decodes(huge)]);
    check('PSB (version 2) 20,000 × 20,000 header → refused the same way', r[1].res.name === 'PsdTooLarge' && r[1].calls.parse === 0, r[1].res);
    check('a file whose layers say a bigger canvas than its header is refused after the parse, before any decode', r[2].res.name === 'PsdTooLarge' && r[2].calls.parse === 1 && decodes(lie) === 0, r[2].res);
    check('a 70 Mpx background layer → PsdTooLarge before its decode, and before the logo\'s', r[3].res.name === 'PsdTooLarge' && decodes(fat) === 0 && r[3].kit.made.length === 0, [r[3].res, decodes(fat)]);

    var n = r[4].res.ok;
    check('7932 × 4818: read', !!n && n.canvasWidth === 7932 && n.canvasHeight === 4818, r[4].res);
    if (n) {
      check('7932 × 4818: roles counted as the platform classifies them', JSON.stringify(n.roles) === JSON.stringify({ background: 1, logo: 1, text: 1, ignore: 1 }), n.roles);
      check('7932 × 4818: the logo is drawn on a canvas of its own box plus a 4 px margin, not the 38 Mpx canvas', n.logo && n.logo.width === 1308 && n.logo.height === 908 &&
        JSON.stringify(n.logo.area) === JSON.stringify({ x: 4996, y: 2996, width: 1308, height: 908 }), n.logo && n.logo.area);
      check('7932 × 4818: box is where the logo layer sits, without the margin (what the platform\'s trim compares with)',
        n.logo && JSON.stringify(n.logo.box) === JSON.stringify({ x: 5000, y: 3000, width: 1300, height: 900 }), n.logo && n.logo.box);
      var logoCanvas = r[4].kit.made.filter(function (c) { return c.draws.some(function (d) { return d.w === 1300 && d.h === 900; }); })[0];
      check('7932 × 4818: the logo layer lands at its offset in that box', logoCanvas && logoCanvas.draws[0].dx === 4 && logoCanvas.draws[0].dy === 4, logoCanvas && logoCanvas.draws);
      check('7932 × 4818: the logo\'s pixels are the layer\'s, with a transparent margin', n.logo && JSON.stringify(pxAt(n.logo, 4, 4)) === '[0,200,0,255]' &&
        JSON.stringify(pxAt(n.logo, 0, 0)) === '[0,0,0,0]' && JSON.stringify(pxAt(n.logo, 1307, 907)) === '[0,0,0,0]' && JSON.stringify(pxAt(n.logo, 1303, 903)) === '[0,200,0,255]', n.logo && [pxAt(n.logo, 4, 4), pxAt(n.logo, 0, 0)]);
      check('7932 × 4818: the background is the full canvas scaled once to 3840 on its long edge', n.background && n.background.width === 3840 && n.background.height === 2332, n.background && [n.background.width, n.background.height]);
      var scaledBg = r[4].kit.made.filter(function (c) { return c.draws.some(function (d) { return d.dw === 3840; }); })[0];
      check('7932 × 4818: that scaling draws once, smoothed at high quality', scaledBg && scaledBg.draws.length === 1 && scaledBg.draws[0].dw === 3840 && scaledBg.draws[0].smoothing === 'high', scaledBg && scaledBg.draws);
      check('7932 × 4818: both units are PNG', !!(n.background && n.logo) && n.background.blob.type === 'image/png' && n.logo.blob.type === 'image/png');
      check('7932 × 4818: the text and the small icon are never decoded', nds2.children[1].decodes === 0 && nds2.children[2].decodes === 0 && nds2.children[3].decodes === 1);
      check('7932 × 4818: every working canvas is let go (0 × 0) once its blob is made', r[4].kit.made.every(function (c) { return c.width === 0 && c.height === 0; }), r[4].kit.made.map(function (c) { return c.width + 'x' + c.height; }));
    }

    var s = r[5].res.ok;
    check('200 × 100: read', !!s, r[5].res);
    if (s) {
      check('200 × 100: background composited bottom to top (a clear top layer leaves the red)', JSON.stringify(pxAt(s.background, 10, 10)) === '[200,0,0,255]' && s.background.width === 200 && s.background.height === 100);
      check('200 × 100: box is the union of the logo layers\' visible parts', JSON.stringify(s.logo.box) === JSON.stringify({ x: 40, y: 0, width: 160, height: 60 }), s.logo.box);
      check('200 × 100: the picture covers that box plus the margin, cut at the canvas\'s edges',
        JSON.stringify(s.logo.area) === JSON.stringify({ x: 36, y: 0, width: 164, height: 64 }) && s.logo.width === 164 && s.logo.height === 64, s.logo.area);
      check('200 × 100: a layer hanging off the canvas is clipped as the platform clipped it', JSON.stringify(pxAt(s.logo, 170 - 36, 0)) === '[0,0,250,255]' &&
        JSON.stringify(pxAt(s.logo, 163, 29)) === '[0,0,250,255]' && JSON.stringify(pxAt(s.logo, 170 - 36, 30)) === '[0,0,0,0]');
      check('200 × 100: the half-clear logo keeps its alpha (no background under it in its own unit)', JSON.stringify(pxAt(s.logo, 40 - 36, 30)) === '[0,200,0,128]', pxAt(s.logo, 4, 30));
      check('200 × 100: a layer wholly off the canvas is skipped, never decoded', small.children[4].decodes === 0);
      check('200 × 100: roles', JSON.stringify(s.roles) === JSON.stringify({ background: 2, logo: 3, text: 0, ignore: 0 }), s.roles);
    }
    check('the library\'s own parse error → PsdUnreadable with the sentence', r[6].res.name === 'PsdUnreadable' && r[6].res.message === UNREADABLE, r[6].res);
    check('a canvas the browser will not give → PsdTooLarge', r[7].res.name === 'PsdTooLarge', r[7].res);
    check('a picture the browser cannot encode → PsdTooLarge', r[8].res.name === 'PsdTooLarge', r[8].res);
    check('16,384 px a side (under 100 Mpx) is allowed; nothing in it → no units', r[9].res.ok && r[9].res.ok.background === null && r[9].res.ok.logo === null, r[9].res);
    check('16,385 px a side is refused', r[10].res.name === 'PsdTooLarge', r[10].res);
    /* the sentence tells the owner what to save, so its numbers must be the reader's own limits, and the example it
       gives must really be read */
    var lim = r[11].limits || {};
    check('the "too large" sentence names the reader\'s limits: 64 megapixels a layer and 16,384 px a side',
      lim.maxLayerPixels === 64000000 && TOO_LARGE.indexOf('at most 64 megapixels') !== -1 && lim.maxSide === 16384 && TOO_LARGE.indexOf('16,384 px a side') !== -1 &&
      8000 * 8000 <= lim.maxLayerPixels && 8000 * 8000 <= lim.maxCanvasPixels && 8000 <= lim.maxSide, lim);
    check('a flattened 8,000 × 8,000 PSD (the sentence\'s example) is read: its one layer decoded once, scaled to 3840',
      !!r[11].res.ok && flat.children[0].decodes === 1 && r[11].res.ok.background && r[11].res.ok.background.width === 3840 && r[11].res.ok.background.height === 3840, r[11].res);
    check('a flattened 8,000 × 8,001 PSD (over 64 megapixels) → PsdTooLarge with the sentence, before its decode',
      r[12].res.name === 'PsdTooLarge' && r[12].res.message === TOO_LARGE && flatOver.children[0].decodes === 0 && r[12].kit.made.length === 0, r[12].res);
  });
}));

/* ---- B.4 (b): the real bundle, the real PSD library and its WASM decoder, on PSDs written in memory ---- */
var agPsd = null;
try { agPsd = require(path.join(ROOT, 'ag-psd.bundle.js')); } catch (e) { check('ag-psd.bundle.js loads (it writes this test\'s PSDs)', false, String(e && e.message)); }
function solid(w, h, rgba) { var d = new Uint8ClampedArray(w * h * 4); for (var i = 0; i < w * h; i++) d.set(rgba, i * 4); return { width: w, height: h, data: d }; }
if (agPsd && OW) {
  var psdBytes = agPsd.writePsdUint8Array({ width: 200, height: 100, imageData: solid(200, 100, [0, 0, 0, 0]), children: [
    { name: 'Background photo', left: 0, top: 0, imageData: solid(200, 100, [200, 10, 10, 255]) },
    { name: 'Brand', children: [{ name: 'Lock-up', left: 40, top: 30, imageData: solid(60, 30, [10, 200, 10, 128]) }] },
    { name: 'Corner art', left: 170, top: 0, opacity: 0.5, imageData: solid(30, 30, [0, 0, 250, 255]) },
    { name: 'Button', left: 5, top: 5, imageData: solid(4, 4, [0, 0, 255, 255]) },
    { name: 'Old layout', hidden: true, left: 0, top: 0, imageData: solid(50, 50, [9, 9, 9, 255]) }
  ] }, { generateThumbnail: false });
  var realKit = makeCanvasKit();
  var R = loadBundle({ document: realKit.document, ImageData: FakeImageData });
  pending.push(errOf(R.OWSocial.psdUnits(psdBytes, { maxEdge: 3840 })).then(function (res) {
    var u = res.ok;
    check('real PSD: read by the bundled library (WASM decode)', !!u && u.canvasWidth === 200 && u.canvasHeight === 100, res);
    if (!u) return;
    check('real PSD: roles (hidden and a 16 px button ignored)', JSON.stringify(u.roles) === JSON.stringify({ background: 1, logo: 2, text: 0, ignore: 2 }), u.roles);
    check('real PSD: the background is the photo layer, full canvas', u.background && u.background.width === 200 && u.background.height === 100 && JSON.stringify(pxAt(u.background, 100, 50)) === '[200,10,10,255]');
    check('real PSD: the logo box holds the lock-up (in a group) and the corner art', JSON.stringify(u.logo.box) === JSON.stringify({ x: 40, y: 0, width: 160, height: 60 }), u.logo.box);
    check('real PSD: the logo picture covers that box plus the margin', JSON.stringify(u.logo.area) === JSON.stringify({ x: 36, y: 0, width: 164, height: 64 }) &&
      u.logo.width === 164 && u.logo.height === 64, u.logo.area);
    check('real PSD: the lock-up\'s pixels', JSON.stringify(pxAt(u.logo, 40 - 36, 30)) === '[10,200,10,128]', pxAt(u.logo, 4, 30));
    // ag-psd stores opacity 0.5 as the byte 128; the library's composite(true, true) multiplies alpha by 128 / 255
    check('real PSD: a layer\'s opacity is applied as the platform\'s composite(true, true) applies it', JSON.stringify(pxAt(u.logo, 180 - 36, 10)) === '[0,0,250,128]', pxAt(u.logo, 144, 10));
    check('real PSD: outside the art the window is clear (the trim reads its top-left pixel)', JSON.stringify(pxAt(u.logo, 0, 63)) === '[0,0,0,0]');
  }));
  pending.push(Promise.all([
    errOf(R.OWSocial.psdUnits(new Uint8Array(Buffer.from('notapsd')).buffer)),
    errOf(R.OWSocial.psdUnits(psdHeader(20000, 20000))),
    errOf(R.OWSocial.psdUnits(psdBytes.buffer.slice(psdBytes.byteOffset, psdBytes.byteOffset + 800))),
    errOf(R.OWSocial.psdUnits(undefined))
  ]).then(function (r) {
    check('real bundle: the 7-byte "notapsd" file → PsdUnreadable', r[0].name === 'PsdUnreadable' && r[0].message === UNREADABLE, r[0]);
    check('real bundle: a 20,000 × 20,000 header → PsdTooLarge, nothing drawn', r[1].name === 'PsdTooLarge', r[1]);
    check('real bundle: a PSD cut short → PsdUnreadable, not a crash', r[2].name === 'PsdUnreadable', r[2]);
    check('real bundle: no file → PsdUnreadable', r[3].name === 'PsdUnreadable', r[3]);
  }));
}

/* ---- B.5: extract over the Testimonial, in a DOM stand-in that answers as Chrome does ---- */
var VOID = { img: 1, br: 1, meta: 1, link: 1, input: 1, hr: 1, source: 1, wbr: 1 };
var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', middot: '·', hellip: '…', mdash: '—', ndash: '–' };
function decodeText(s) { return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) { if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); return ENT[e] !== undefined ? ENT[e] : m; }); }
function Node_(type) { this.nodeType = type; this.childNodes = []; this.parentElement = null; }
Object.defineProperty(Node_.prototype, 'textContent', { get: function () { return this.nodeType === 3 ? this.data : this.childNodes.map(function (c) { return c.textContent; }).join(''); } });
function El(tag, attrs) {
  Node_.call(this, 1); this.tagName = tag.toUpperCase(); this.attrs = attrs; this.style = {}; this.ownerSVGElement = null;
  var self = this; this.classList = { contains: function (c) { return (' ' + (self.attrs['class'] || '').trim().split(/\s+/).join(' ') + ' ').indexOf(' ' + c + ' ') !== -1; } };
}
El.prototype = Object.create(Node_.prototype);
Object.defineProperties(El.prototype, {
  children: { get: function () { return this.childNodes.filter(function (c) { return c.nodeType === 1; }); } },
  innerText: { get: function () { return this.textContent.replace(/\s+/g, ' ').trim(); } },
  src: { get: function () { return this.attrs.src || ''; } },
  currentSrc: { get: function () { return this.attrs.src || ''; } }
});
El.prototype.getAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; };
El.prototype.setAttribute = function (n, v) { this.attrs[n] = String(v); };
El.prototype.contains = function (o) { for (var n = o; n; n = n.parentElement) if (n === this) return true; return false; };
El.prototype.descendants = function () { var out = []; (function w(n) { n.children.forEach(function (c) { out.push(c); w(c); }); })(this); return out; };
// Element.closest for a single class selector, the only kind extract asks (this element first, then its ancestors)
El.prototype.closest = function (sel) {
  if (!/^\.[\w-]+$/.test(sel)) throw new Error('stand-in: closest(' + sel + ')');
  for (var n = this; n; n = n.parentElement) if (n.classList.contains(sel.slice(1))) return n;
  return null;
};
El.prototype.querySelector = function (sel) { if (sel !== 'img') throw new Error('stand-in: querySelector(' + sel + ')'); return this.descendants().filter(function (e) { return e.tagName === 'IMG'; })[0] || null; };
El.prototype.getBoundingClientRect = function () { return this.ownerDocument.boxOf(this); };
function parseHtml(html) {
  var root = new El('#root', {}), stack = [root], all = [];
  var re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|[^<]+|</gi, m;
  while ((m = re.exec(html))) {
    var top = stack[stack.length - 1];
    if (m[1]) { var t = m[1].toUpperCase(); while (stack.length > 1 && stack.pop().tagName !== t) { /* close what the markup left open */ } continue; }
    if (m[2]) {
      var attrs = {}, ar = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, a;
      while ((a = ar.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = decodeText(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '');
      var el = new El(m[2], attrs); el.parentElement = top === root ? null : top; el.parentNode = top; top.childNodes.push(el); all.push(el);
      var tag = m[2].toLowerCase();
      if (tag === 'style' || tag === 'script') { var end = html.toLowerCase().indexOf('</' + tag, re.lastIndex); var raw = new Node_(3); raw.data = html.slice(re.lastIndex, end); el.childNodes.push(raw); re.lastIndex = html.indexOf('>', end) + 1; continue; }
      if (!VOID[tag] && !m[4]) stack.push(el);
      continue;
    }
    if (m[0][0] === '<' && m[0].length > 1) continue; // comment or doctype
    var tn = new Node_(3); tn.data = decodeText(m[0]); tn.parentElement = top === root ? null : top; top.childNodes.push(tn);
  }
  var htmlEl = root.children.filter(function (e) { return e.tagName === 'HTML'; })[0];
  var body = htmlEl && htmlEl.children.filter(function (e) { return e.tagName === 'BODY'; })[0];
  all.forEach(function (e) { for (var p = e.parentElement; p; p = p.parentElement) if (p.tagName === 'SVG') { e.ownerSVGElement = p; break; } });
  return { root: root, html: htmlEl, body: body, all: all };
}
// Computed styles as Chrome gives them for the Testimonial's classes (base.ts and testimonial.ts at 1080 × 1080)
var CS_DEFAULT = { display: 'block', visibility: 'visible', opacity: '1', position: 'static', overflow: 'visible', clipPath: 'none', borderRadius: '0px',
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', borderTopWidth: '0px', borderTopStyle: 'none', borderTopColor: 'rgb(255, 255, 255)', boxShadow: 'none',
  backdropFilter: 'none', objectFit: 'fill', objectPosition: '50% 50%', padding: '0px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
  fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', fontWeight: '400', fontStyle: 'normal', color: 'rgb(255, 255, 255)', textAlign: 'start',
  lineHeight: 'normal', letterSpacing: 'normal', textTransform: 'none', textShadow: 'none', whiteSpace: 'normal', columnGap: 'normal', gap: 'normal', content: 'normal', width: 'auto', height: 'auto' };
var CS = {
  canvas: { overflow: 'hidden', position: 'relative' },
  ribbon: { clipPath: 'polygon(0px 0px, 100% 0px, 84% 100%, 0px 100%)', backgroundColor: 'rgb(229, 57, 53)', fontWeight: '700', fontSize: '25.92px' },
  hashtag: { fontWeight: '700', fontSize: '28.08px', opacity: '0.92' },
  'lockup-name': { fontWeight: '700', fontSize: '71.28px', lineHeight: '72.7056px', textShadow: 'rgba(0, 0, 0, 0.22) 0px 4.32px 21.6px' },
  'tst-kicker': { fontWeight: '700', fontSize: '49.68px', lineHeight: '49.68px', letterSpacing: '0.9936px', textTransform: 'uppercase', color: 'rgb(229, 57, 53)', textShadow: 'rgba(0, 0, 0, 0.3) 0px 4.32px 21.6px' },
  'tst-card': { position: 'relative', backgroundColor: 'rgba(255, 255, 255, 0.95)', color: 'rgb(25, 27, 34)', borderRadius: '32.4px', padding: '47.52px', boxShadow: 'rgba(0, 0, 0, 0.26) 0px 21.6px 64.8px 0px' },
  'tst-quotemark': { fontFamily: 'Georgia, "Times New Roman", serif', color: 'rgb(229, 57, 53)', fontWeight: '700', fontSize: '118.8px', lineHeight: '95.04px' },
  'tst-quote': { fontSize: '38.88px', fontWeight: '600', lineHeight: '51.3216px', color: 'rgb(25, 27, 34)' },
  'tst-photo': { position: 'relative', overflow: 'hidden', borderRadius: '32.4px', boxShadow: 'rgba(0, 0, 0, 0.3) 0px 21.6px 64.8px 0px', backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  'tst-attr-name': { fontSize: '43.2px', fontWeight: '700', lineHeight: '45.36px' },
  'tst-attr-title': { fontSize: '30.24px', fontWeight: '600' },
  'footer-when': { fontSize: '29.16px', fontWeight: '700', opacity: '0.95' },
  cta: { backgroundColor: 'rgb(229, 57, 53)', fontWeight: '700', fontSize: '29.16px', padding: '19.44px 38.88px', paddingTop: '19.44px', paddingBottom: '19.44px', borderRadius: '99px', whiteSpace: 'nowrap', boxShadow: 'rgba(0, 0, 0, 0.22) 0px 10.8px 32.4px 0px' },
  'ow-qr-code': { backgroundColor: 'rgb(255, 255, 255)', padding: '8px', borderRadius: '12px', boxShadow: 'rgba(0, 0, 0, 0.18) 0px 4px 18px 0px' },
  'ow-qr-t': { fontSize: '17px', fontWeight: '600', letterSpacing: '0.51px', whiteSpace: 'nowrap' },
  'qr-clip': { overflow: 'hidden', borderRadius: '12px' }, 'qr-card': { backgroundColor: 'rgb(255, 255, 255)', borderRadius: '16px' }
};
var CS_PSEUDO = { 'tst-photo::after': { content: '""', position: 'absolute', width: '432px', height: '540px', backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0) 46%, rgba(0, 0, 0, 0.62))' } };
var BOX = { canvas: [0, 0, 1080, 1080], bg: [0, 0, 1080, 1080], scrim: [0, 0, 1080, 1080], content: [0, 0, 1080, 1080], ribbon: [0, 0, 220, 54], hashtag: [800, 54, 214, 34],
  lockup: [65, 86, 950, 74], 'lockup-name': [65, 86, 950, 74], 'tst-body': [65, 187, 950, 640], 'tst-main': [65, 187, 475, 640], 'tst-kicker': [65, 230, 470, 50],
  'tst-card': [65, 300, 475, 360], 'tst-quotemark': [112, 348, 380, 95], 'tst-quote': [112, 447, 380, 160], 'tst-photo': [583, 187, 432, 640], 'tst-plate': [583, 700, 432, 127],
  'tst-attr-name': [615, 736, 368, 46], 'tst-attr-title': [615, 786, 368, 32], footer: [65, 860, 950, 155], 'footer-when': [65, 917, 500, 40], cta: [800, 905, 215, 64],
  'ow-qr': [600, 860, 166, 192], 'ow-qr-code': [600, 860, 166, 166], 'ow-qr-t': [610, 1030, 146, 22], 'lockup-img': [65, 86, 500, 150],
  'qr-clip': [600, 860, 166, 166], 'qr-card': [590, 850, 186, 212] };
function stubDocument(html, W, H) {
  var p = parseHtml(html), doc = { documentElement: p.html, body: p.body };
  p.all.forEach(function (e) { e.ownerDocument = doc; });
  var classes = function (el) { return (el.attrs['class'] || '').trim().split(/\s+/).filter(Boolean); };
  doc.boxOf = function (el) {
    if (el.tagName === 'HTML' || el.tagName === 'BODY') return { x: 0, y: 0, width: W, height: H };
    if (el.tagName === 'STYLE') return { x: 0, y: 0, width: 0, height: 0 };
    var b = null; classes(el).forEach(function (c) { if (BOX[c]) b = BOX[c]; });
    if (!b && el.tagName === 'IMG' && el.parentElement) { var pb = doc.boxOf(el.parentElement); b = [pb.x, pb.y, pb.width, pb.height]; }
    b = b || [20, 20, 200, 30];
    return { x: b[0], y: b[1], width: b[2], height: b[3], left: b[0], top: b[1], right: b[0] + b[2], bottom: b[1] + b[3] };
  };
  doc.defaultView = { getComputedStyle: function (el, pseudo) {
    var s = {}; Object.keys(CS_DEFAULT).forEach(function (k) { s[k] = CS_DEFAULT[k]; });
    if (pseudo) { s.content = 'none'; classes(el).forEach(function (c) { var o = CS_PSEUDO[c + pseudo]; if (o) Object.keys(o).forEach(function (k) { s[k] = o[k]; }); }); return s; }
    if (el.tagName === 'STYLE') s.display = 'none';
    if (el.tagName === 'IMG') s.objectFit = 'cover';
    classes(el).forEach(function (c) { var o = CS[c]; if (o) Object.keys(o).forEach(function (k) { s[k] = o[k]; }); });
    return s;
  } };
  doc.querySelectorAll = function (sel) {
    if (sel === 'body *') return p.body.descendants();
    if (sel === '[data-edit]') return p.all.filter(function (e) { return e.getAttribute('data-edit') !== null; });
    throw new Error('stand-in: querySelectorAll(' + sel + ')');
  };
  // what the adapter's owInline does before extract: an outside picture becomes a blob:, its address kept in data-ow-src
  p.all.forEach(function (e, i) { if (e.tagName === 'IMG' && /^https?:/.test(e.attrs.src || '')) { e.attrs['data-ow-src'] = e.attrs.src; e.attrs.src = 'blob:https://oneworld.example/' + i; } });
  doc._all = p.all;
  return doc;
}
var QR = 'data:image/png;base64,iVBORw0KGgoQRQR';
var PHOTO = 'https://img.etb2bimg.com/photo/1.jpg';
// The Testimonial as the platform's template writes it (testimonial.ts + base.ts page/footerBar), with Oneworld's QR tile (§5a.3)
var FIXTURE = '<!doctype html>\n<html><head><meta charset="utf-8">\n<style>.tst-quotemark { font-family:Georgia,"Times New Roman",serif; }</style>\n</head>\n<body data-ratio="1:1">\n' +
  '  <div class="canvas"><div class="content">\n      <div class="ribbon">9th Edition</div> <div class="hashtag">#AgenticAiSummit27</div>\n' +
  '      \n    <div class="lockup">\n      \n      <div class="lockup-name">Agentic AI Summit</div>\n      \n    </div>\n      <div class="tst-body">\n        <div class="tst-main">\n' +
  '          <div class="tst-kicker">Voices of Last Edition</div>\n          <div class="tst-card">\n            <div class="tst-quotemark" aria-hidden="true">&ldquo;</div>\n' +
  '            <div class="tst-quote">An unmissable gathering of the industry&#39;s sharpest minds.</div>\n          </div>\n          \n        </div>\n' +
  '        <div class="tst-photo">\n          <img src="' + PHOTO + '" alt="">\n          <div class="tst-plate"><div class="tst-attr-name">O&#39;Brien &quot;QA&quot; &lt;b&gt;</div><div class="tst-attr-title">CTO, Acme</div></div>\n        </div>\n      </div>\n' +
  '      \n    <div class="footer">\n      <style>.ow-qr{display:flex}</style><div class="ow-qr"><img class="ow-qr-code" src="' + QR + '" alt="QR code"><div class="ow-qr-t">Scan to register</div></div><div class="footer-when">12 March 2027  ·  Taj Lands End, Mumbai</div>\n      <div class="cta">Register Now</div>\n    </div></div></div>\n</body></html>';
function testimonialHtml() {
  // Unit A's engine, once it carries the 9 post templates; until then the fixture above (the lead reruns this at step 3)
  var eng = null;
  try { eng = require('./vendor/promo-engine.js'); } catch (e) { eng = null; }
  if (!eng || typeof eng.getTemplate !== 'function' || !eng.FORMATS || !eng.FORMATS.ig_square) return { html: FIXTURE, from: 'fixture (the engine has no post templates yet)' };
  var ctx = { event: { id: 1, name: 'Agentic AI Summit', hashtag: '#AgenticAiSummit27', edition: 9, presenter: '', tagline: '', venue: 'Taj Lands End', city: 'Mumbai',
    dateLabel: '12 March 2027', ctaLabel: 'Register Now', portal: 'cio', speakers: [{ id: 's1', name: 'O\'Brien "QA" <b>', designation: 'CTO', company: 'Acme', photoUrl: PHOTO }], sponsors: [], stats: [] },
    brand: eng.getBrand('cio'), format: eng.FORMATS.ig_square, params: { theme: 'dark', kicker: 'Voices of Last Edition', quote: 'An unmissable gathering of the industry\'s sharpest minds.' },
    assets: { qrUrl: QR, qrLabel: 'Scan to register' } };
  try { return { html: eng.getTemplate('generic.testimonial').render(ctx), from: 'engine' }; } catch (e) {
    check('the engine renders the Testimonial with a quote and a QR code', false, String(e && e.message));
    return { html: FIXTURE, from: 'fixture (the engine failed)' };
  }
}
if (OW) {
  var tst = testimonialHtml();
  console.log('promo-social-browser: B.5 ran on the Testimonial from the ' + tst.from);
  var doc = stubDocument(tst.html, 1080, 1080);
  var els = null, xerr = null;
  try { els = OW.extract(doc, 1080, 1080); } catch (e) { xerr = String(e && e.stack || e); }
  check('extract runs over the Testimonial', Array.isArray(els) && els.length > 5, xerr || (els && els.length));
  if (Array.isArray(els)) {
    var stringFields = [];
    els.forEach(function (e) { Object.keys(e).forEach(function (k) { if (k !== 'text' && k !== 'src' && typeof e[k] === 'string' && e[k].indexOf('"') !== -1) stringFields.push(e.id + '.' + k + '=' + e[k]); }); });
    check('extract: no " in any style field', stringFields.length === 0, stringFields);
    var markEl = els.filter(function (e) { return e.type === 'text' && e.text === '“'; })[0];
    check('extract: the quotation mark\'s family is Georgia, \'Times New Roman\', serif', markEl && markEl.fontFamily === "Georgia, 'Times New Roman', serif", markEl);
    check('extract: other families as Chrome gave them', els.some(function (e) { return e.type === 'text' && e.fontFamily === 'Inter, system-ui, sans-serif'; }));
    var qr = els.filter(function (e) { return e.owQr; });
    var qrCode = qr.filter(function (e) { return e.type === 'image'; })[0], qrCaption = qr.filter(function (e) { return e.type === 'text'; })[0];
    check('extract: the QR code is marked owQr: true, with its own address', !!qrCode && qrCode.owQr === true && qrCode.src === QR, qr);
    check('extract: its caption is marked owQr: true too, so the two leave a saved layout together', !!qrCaption && qrCaption.owQr === true && qrCaption.text === 'Scan to register', qr);
    check('extract: the QR unit gives exactly those two elements', qr.length === 2, qr);
    check('extract: no other element carries owQr at all (a no-QR layout is the platform\'s JSON)', els.filter(function (e) { return 'owQr' in e; }).length === 2);
    check('extract: the date and venue beside the QR unit are not marked', els.some(function (e) { return e.type === 'text' && /12 March 2027/.test(e.text) && !('owQr' in e); }));
    var frame = els.filter(function (e) { return e.type === 'frame'; })[0];
    check('extract: the speaker photo becomes a frame whose src is the real address from data-ow-src, not the blob:', frame && frame.src === PHOTO && !frame.owQr, frame);
    check('extract: the photo\'s ::after scrim rides on the frame', frame && frame.scrim === 'linear-gradient(rgba(0, 0, 0, 0) 46%, rgba(0, 0, 0, 0.62))', frame && frame.scrim);
    check('extract: the card is a shape with its colour, radius and shadow', els.some(function (e) { return e.type === 'shape' && e.background === 'rgba(255, 255, 255, 0.95)' && e.radius === '32.4px'; }));
    check('extract: the name with quotes and <b> stays text (escaped only when written out)', els.some(function (e) { return e.type === 'text' && e.text === 'O\'Brien "QA" <b>'; }));
    check('extract: the clipped ribbon stays baked, as on the platform', !els.some(function (e) { return e.text === '9th Edition'; }));
    var edited = doc._all.filter(function (e) { return e.getAttribute('data-edit') !== null; });
    check('extract: what became an element is hidden for the base (renderer.ts:420)', edited.length > 0 && edited.every(function (e) { return e.style.visibility === 'hidden'; }), edited.length);
    check('extract: what stays baked is left visible', doc._all.filter(function (e) { return e.getAttribute('data-edit') === null; }).every(function (e) { return e.style.visibility !== 'hidden'; }));
    check('extract: ids e0, e1, … in order', els.every(function (e) { return /^e\d+$/.test(e.id); }) && new Set(els.map(function (e) { return e.id; })).size === els.length);
    var out = OW.renderEditableHtml(1080, 1080, BASE, els);
    var broken = [], sre = /style="[^"]*"(.)/g, sm; while ((sm = sre.exec(out))) if (sm[1] !== '>' && sm[1] !== ' ') broken.push(sm[0].slice(-60));
    check('round trip: every style attribute of the exported page closes where it should', broken.length === 0, broken);
    check('round trip: the exported quotation mark keeps its family, size and colour', out.indexOf("font-family:Georgia, 'Times New Roman', serif;font-size:118.8px;font-weight:700;font-style:normal;color:rgb(229, 57, 53);") !== -1);
  }
  // a QR unit drawn another way: on a painted card, its code clipped in a rounded box (a frame), a typed caption
  var qdoc = stubDocument('<!doctype html><html><head></head><body><div class="canvas"><div class="ow-qr qr-card"><div class="qr-clip"><img class="ow-qr-code" src="' + QR +
    '"></div><div class="ow-qr-t">Book your seat</div></div><div class="footer-when">12 March 2027</div></div></body></html>', 1080, 1080);
  var qels = null, qerr = null;
  try { qels = OW.extract(qdoc, 1080, 1080); } catch (e) { qerr = String(e && e.stack || e); }
  var qtype = function (t) { return (qels || []).filter(function (e) { return e.type === t; })[0]; };
  check('extract: a QR code clipped in a rounded box becomes a marked frame', !qerr && qtype('frame') && qtype('frame').owQr === true && qtype('frame').src === QR, qerr || qels);
  check('extract: a typed caption and the card behind the unit are marked', !!qels && qtype('text') && qtype('text').text === 'Book your seat' && qtype('text').owQr === true &&
    qtype('shape') && qtype('shape').owQr === true, qels);
  check('extract: outside the QR unit nothing is marked', !!qels && qels.filter(function (e) { return 'owQr' in e; }).length === 3 &&
    qels.some(function (e) { return e.text === '12 March 2027' && !('owQr' in e); }), qels);
}

/* ---- B.6: html-to-image-exact.js is the stock file minus the font-size floor ---- */
var stock = read('assets/vendor/html-to-image.js'), exact = read('assets/vendor/html-to-image-exact.js');
check('the font-size floor is in the stock file exactly once', count(stock, build.FRAGMENT) === 1, count(stock, build.FRAGMENT));
check('the floor is not in the exact copy', count(exact, build.FRAGMENT) === 0);
var hdrEnd = exact.indexOf('*/\n') + 3;
check('the exact copy is its header plus the stock file minus that fragment, byte for byte', exact.slice(hdrEnd) === stock.replace(build.FRAGMENT, ''));
check('its header says it is generated, from which file, and pins the stock file\'s hash', /^\/\* GENERATED by tools\/build-promo-social\.js from assets\/vendor\/html-to-image\.js/.test(exact) &&
  exact.slice(0, hdrEnd).indexOf(crypto.createHash('sha256').update(stock).digest('hex')) !== -1);
// html-to-image 1.11.13's dist/html-to-image.js from npm has this sha256; a new stock file needs its own licence checked
check('the stock file is html-to-image 1.11.13 (sha256 pinned), the version whose notice the copy carries', build.H2I_VERSION === '1.11.13' &&
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'assets/vendor/html-to-image.js'))).digest('hex') === 'a90b42909d80964269ef6d5f3d1e4a5a7e2a4c263a5d2a76a9e7151901343262');
check('the exact copy\'s header carries html-to-image\'s MIT copyright and permission notice', exact.slice(0, hdrEnd).indexOf('Copyright (c) 2017-2025 W.Y.') !== -1 &&
  exact.slice(0, hdrEnd).indexOf('Permission is hereby granted, free of charge') !== -1 && exact.slice(0, hdrEnd).indexOf('html-to-image 1.11.13') !== -1);
check('exactCopy refuses a stock file without the fragment', (function () { try { build.exactCopy(stock.replace(build.FRAGMENT, '')); return false; } catch (e) { return /found 0 time/.test(e.message); } })());
check('exactCopy refuses a stock file with it twice', (function () { try { build.exactCopy(stock + build.FRAGMENT); return false; } catch (e) { return /found 2 time/.test(e.message); } })());
var H2I = (function () { var c = browserContext({}); vm.runInContext(exact, c); return c.htmlToImage; })();
check('the exact copy still defines window.htmlToImage with toBlob, toPng, toCanvas', !!H2I && ['toBlob', 'toPng', 'toCanvas'].every(function (k) { return typeof H2I[k] === 'function'; }));
pending.push(build.buildAll().then(function (fresh) {
  check('the committed bundle is what the sources build now (reproducible: same inputs, same bytes)', fresh.bundle === bundle);
  check('the committed exact copy is what the stock file builds now', fresh.exact === exact);
}));

/* ---- B.7: the bundle is a browser file, and the PSD library is the vendored 0.4.0 ---- */
var nodeBuiltin = /\brequire\s*\(\s*["'](node:)?(fs|path|os|crypto|util|buffer|stream|child_process|http|https|net|tls|zlib|url|events|worker_threads|vm)["']/;
check('no require() of a Node built-in in the bundle', !nodeBuiltin.test(bundle));
check('no import.meta in the bundle', bundle.indexOf('import.meta') === -1);
check('the library\'s two Node fallbacks are reached only when the browser has no TextDecoder / TextEncoder', count(bundle, 'module.require') === 2 &&
  count(bundle, 'typeof TextDecoder > "u" ? (0, module.require)("util").TextDecoder') === 1 && count(bundle, 'typeof TextEncoder > "u" ? (0, module.require)("util").TextEncoder') === 1);
check('the decoder is inlined (no fetch of a .wasm file)', count(bundle, 'data:application/wasm;base64,') === 1);
var vpkg = JSON.parse(read('promo-engine/vendor/webtoon-psd/package.json'));
check('webtoon-psd/package.json: @webtoon/psd 0.4.0, MIT', vpkg.name === '@webtoon/psd' && vpkg.version === '0.4.0' && vpkg.license === 'MIT', vpkg);
check('webtoon-psd/index.js is the npm package\'s dist/index.js (sha256 pinned)', crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'promo-engine/vendor/webtoon-psd/index.js'))).digest('hex') === '311dcb64de602996e8ace5f5ebd3c896ea0f04ac47a0d3dd214d9be25b557342');
check('webtoon-psd/LICENSE is MIT, NAVER WEBTOON', /Copyright 2021-present NAVER WEBTOON/.test(read('promo-engine/vendor/webtoon-psd/LICENSE')) && /Permission is hereby granted, free of charge/.test(read('promo-engine/vendor/webtoon-psd/LICENSE')));
check('the bundle\'s header says generated and carries the library\'s MIT notice', /^\/\* GENERATED by tools\/build-promo-social\.js from promo-engine\/src\/browser\.ts/.test(bundle) &&
  bundle.slice(0, 3000).indexOf('Copyright 2021-present NAVER WEBTOON') !== -1 && bundle.slice(0, 3000).indexOf('Permission is hereby granted, free of charge') !== -1);
var notice = read('NOTICE');
check('NOTICE credits @webtoon/psd 0.4.0 and html-to-image 1.11.13, each MIT with its copyright holder', /@webtoon\/psd 0\.4\.0/.test(notice) && /Licence: MIT, Copyright 2021-present NAVER WEBTOON/.test(notice) &&
  /html-to-image 1\.11\.13 \(assets\/vendor\/html-to-image\.js/.test(notice) && /Licence: MIT, Copyright \(c\) 2017-2025 W\.Y\./.test(notice));
var editorTs = read('promo-engine/src/editor.ts'), extractTs = read('promo-engine/src/render/extract.ts'), psdTs = read('promo-engine/src/psd/extract.ts');
check('editor.ts marks its changes ONEWORLD PORT (the import and D18)', count(editorTs, 'ONEWORLD PORT') === 4 && count(editorTs, 'ONEWORLD PORT (D18)') === 3);
check('render/extract.ts marks its five changes', ['ONEWORLD PORT (1)', 'ONEWORLD PORT (2)', 'ONEWORLD PORT (3)', 'ONEWORLD PORT (4)', 'ONEWORLD PORT (5)'].every(function (m) { return extractTs.indexOf(m) !== -1; }) &&
  /renderer\.ts:420/.test(extractTs));
check('psd/extract.ts reads the vendored library (never node_modules) and has no sharp', /from "\.\.\/\.\.\/vendor\/webtoon-psd\/index\.js"/.test(psdTs) && psdTs.indexOf('from "@webtoon/psd"') === -1 && psdTs.indexOf('from "sharp"') === -1);

Promise.all(pending).then(function () {
  if (failed) { console.error('promo-social-browser: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-social-browser: all ' + passed + ' checks passed');
}, function (err) { console.error('promo-social-browser: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
