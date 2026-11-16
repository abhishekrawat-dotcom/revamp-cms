/* A picture made for a frame has the frame's shape.

   WHY (owner, 16 Nov 2026: "the image dimension issue is still not fixed. AI has created a square image for a
   rectangular placeholder"). On ET DAVOS 2027, ETB2B AI was asked for a picture in Key Discussion Points, which had
   none. The picture was made 4:3 before the section was reworked around it, and the rework laid it out as a band
   three times as wide as tall, so the two armchairs it showed lost their seats. The 10 Nov fix (CISO Secufest) shaped
   a picture that takes an existing picture's place, but not one a rework adds, and the site's own first pictures were
   still made square (the picture model answers 1:1 when it is not told a shape, whatever the words say).

   HOW. The picture model takes ten shapes (gemini.js IMAGE_ASPECTS) and answers each only roughly: its "4:3" is
   1184 x 864 (2.8% off), its "21:9" 1536 x 672. So a picture is asked for in the supported shape nearest its frame
   and then cut, centred, to the frame's exact proportion. The page then shows the whole picture, and object-fit:
   cover in the frame has nothing left to cut.

     ASPECTS                 the shapes the picture model takes
     WORDS                   how a picture's prompt says each ("Landscape, 4:3.")
     LANDSCAPE               the shapes a banner may take (a banner is always wider than tall)
     FRAME_SHAPES            the shapes a frame that a rework adds may be given (not the very tall ones)
     DEFAULT_ASPECT          a picture whose frame is not known: 4:3, as the picture prompt has always said
     NEW_FRAME_ASPECT        a frame a rework adds, when the chat said no shape: 16:9, which sits well across the
                             section and in a column beside its text
     TOLERANCE               a picture this close to its frame's proportion (|log| of the two) is left whole
     ratioOf(aspect)         -> width / height; 0 for anything that is not one of ASPECTS
     isAspect(v)             -> true for one of ASPECTS
     nearest(w, h, list)     -> the shape in `list` (default ASPECTS) nearest w:h; '' without a size
     frameOf(w, h)           -> { w, h } whole numbers from 1 to 20000, or null: a frame's measured size, cleaned
     frameText(frame)        -> '1152:380' (the frame's size as the stored ask keeps it), '' for none
     frameFromText(v)        -> { w, h } from '1152:380' / { w, h } / an aspect '16:9', or null
     cssRatio(frame)         -> '1152 / 380' for CSS aspect-ratio; '' for none
     targetRatio(o)          -> the proportion a picture is cut to: o.frame's, else o.aspect's; 0 for none
     SITE_SHAPES             the shapes a site's own section picture is made in (landscape: a phone shows it at full
                             width, no taller than its rules allow)
     shapeForLayout(text)    -> the shape of a section's picture from the words of its planned layout: a band or a strip
                             21:9, a picture across the section 16:9, else 4:3 (site generation, before its code is
                             written; the code is then told to give the frame that shape)
     crop(bytes, ratio, o)   -> Promise<{ bytes, width, height, cropped, left, top, sourceWidth, sourceHeight }>: the
                                picture cut to exactly that proportion, in its own format (PNG stays lossless): centred,
                                or around o.focus { x, y } (0 to 1 across the picture, the point the Critic says the
                                picture is about: lib/picture-critic.js), held inside the picture. It never rejects: the
                                picture comes back as it was when it needs no cut or cannot be cut (no sharp on the
                                machine, bytes that are not a PNG, JPEG or WebP it can read), and the frame's
                                object-fit: cover does the rest. o.label names the picture in the log line (never its
                                bytes). left / top: where the cut starts in the picture it was cut from.
     focusIn(focus, cut)     -> the focus point as it falls in the cut picture ({ x, y }, 0 to 1), or null: what the page's
                                object-position is set from (editor-ai-picture.js place), so a phone frame keeps it too
   sharp is an optional native module (lib/pictures.js uses it the same way): looked up once, on first use. */
'use strict';

var ASPECTS = ['1:1', '5:4', '4:3', '3:2', '16:9', '21:9', '4:5', '3:4', '2:3', '9:16'];
var WORDS = { '1:1': 'Square, 1:1.', '5:4': 'Landscape, 5:4.', '4:3': 'Landscape, 4:3.', '3:2': 'Landscape, 3:2.', '16:9': 'Landscape, 16:9.',
  '21:9': 'Wide panorama, 21:9.', '4:5': 'Portrait, 4:5.', '3:4': 'Portrait, 3:4.', '2:3': 'Portrait, 2:3.', '9:16': 'Tall portrait, 9:16.' };
var LANDSCAPE = ['3:2', '16:9', '21:9'];
var FRAME_SHAPES = ['21:9', '16:9', '3:2', '4:3', '1:1', '4:5', '3:4'];
var DEFAULT_ASPECT = '4:3';
var NEW_FRAME_ASPECT = '16:9';
var TOLERANCE = 0.005;
var MAX_SIDE = 20000;
var MAX_INPUT_PIXELS = 60000000;

function isAspect(v) { return typeof v === 'string' && ASPECTS.indexOf(v) !== -1; }
function ratioOf(aspect) {
  if (!isAspect(aspect)) return 0;
  var x = aspect.split(':');
  return +x[0] / +x[1];
}
function nearest(w, h, list) {
  w = +w; h = +h;
  if (!(w > 0 && h > 0)) return '';
  var r = Math.log(w / h), best = '', gap = Infinity;
  (Array.isArray(list) && list.length ? list : ASPECTS).forEach(function (a) {
    if (!isAspect(a)) return;
    var d = Math.abs(Math.log(ratioOf(a)) - r);
    if (d < gap) { gap = d; best = a; }
  });
  return best;
}
function side(v) {
  var n = Math.round(+v);
  return n >= 1 && n <= MAX_SIDE ? n : 0;
}
function frameOf(w, h) {
  var a = side(w), b = side(h);
  return a && b ? { w: a, h: b } : null;
}
function frameText(f) {
  f = f && typeof f === 'object' ? frameOf(f.w, f.h) : null;
  return f ? f.w + ':' + f.h : '';
}
function frameFromText(v) {
  if (v && typeof v === 'object') return frameOf(v.w, v.h);
  var m = /^\s*(\d{1,5})\s*[:x\/]\s*(\d{1,5})\s*$/.exec(String(v == null ? '' : v));
  return m ? frameOf(m[1], m[2]) : null;
}
function cssRatio(f) {
  f = frameFromText(f);
  return f ? f.w + ' / ' + f.h : '';
}
function targetRatio(o) {
  o = o || {};
  var f = frameFromText(o.frame);
  if (f) return f.w / f.h;
  return ratioOf(o.aspect);
}

var SITE_SHAPES = ['21:9', '16:9', '4:3'];
/* the picture beside the words (a split, a column of it); a picture as a band or a strip; a picture across the
   section — read from what the layout says of the picture itself ("a band of four numbers" holds no picture) */
var PIC_WORD = '(?:photo|photograph|picture|image|plate|visual)';
var BESIDE_RE = /\bsplit\b|\bbeside\b|\bside[- ]by[- ]side\b|\btwo[- ]column\b|\bcolumns?\b|\b(?:photo|picture|image)[- ](?:left|right)\b|\b(?:left|right)[- ](?:photo|picture|image)\b/i;
var BAND_RE = new RegExp('\\b(?:band|strip|panorama|panoramic|ribbon)\\b[^.]{0,40}\\b' + PIC_WORD + '\\b|\\b' + PIC_WORD + '\\b[^.]{0,40}\\b(?:band|strip|panorama|panoramic|ribbon)\\b', 'i');
var ACROSS_RE = new RegExp('\\b(?:full[- ]width|full[- ]bleed|edge[- ]to[- ]edge|wide|widescreen|lead|banner|backdrop|cover)\\b[^.]{0,30}\\b' + PIC_WORD + '\\b|\\b' + PIC_WORD + '\\b[^.]{0,30}\\b(?:across|spanning)\\b', 'i');
function shapeForLayout(text) {
  var t = String(text == null ? '' : text);
  if (BESIDE_RE.test(t)) return DEFAULT_ASPECT;
  if (BAND_RE.test(t)) return '21:9';
  if (ACROSS_RE.test(t)) return '16:9';
  return DEFAULT_ASPECT;
}

var sharpModule;
function loadSharp() {
  if (sharpModule === undefined) {
    try { sharpModule = require('sharp'); } catch (e) {
      sharpModule = null;
      console.error('picture-shape: pictures cannot be cut to their frame here (sharp) — ' + e.message);
    }
  }
  return sharpModule;
}

/* a focus point, cleaned: { x, y } each from 0 to 1, or null */
function focusOf(v) {
  if (!v || typeof v !== 'object') return null;
  var x = +v.x, y = +v.y;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x: x, y: y } : null;
}
/* the focus of the picture a cut came from, as it falls in the cut: object-position's percentages */
function focusIn(focus, cut) {
  var f = focusOf(focus);
  if (!f || !cut || !(cut.sourceWidth > 0 && cut.sourceHeight > 0 && cut.width > 0 && cut.height > 0)) return null;
  function at(v) { return Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000; }
  return { x: at((f.x * cut.sourceWidth - (cut.left || 0)) / cut.width), y: at((f.y * cut.sourceHeight - (cut.top || 0)) / cut.height) };
}

function crop(bytes, ratio, o) {
  o = o || {};
  var same = { bytes: bytes, width: 0, height: 0, cropped: false };
  ratio = +ratio;
  if (!Buffer.isBuffer(bytes) || !bytes.length || !(ratio > 0) || !isFinite(ratio)) return Promise.resolve(same);
  var sharp = loadSharp();
  if (!sharp) return Promise.resolve(same);
  var input = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' };
  return Promise.resolve().then(function () {
    return sharp(bytes, input).metadata();
  }).then(function (meta) {
    if (!meta || ['png', 'jpeg', 'webp'].indexOf(meta.format) === -1 || (meta.pages || 1) > 1) return same;
    var turned = (meta.orientation || 1) >= 5;
    var w = turned ? meta.height : meta.width, h = turned ? meta.width : meta.height;
    if (!(w > 0 && h > 0)) return same;
    if (Math.abs(Math.log((w / h) / ratio)) <= TOLERANCE) return { bytes: bytes, width: w, height: h, cropped: false, left: 0, top: 0, sourceWidth: w, sourceHeight: h };
    var cw = w, ch = h;
    if (w / h > ratio) cw = Math.max(1, Math.min(w, Math.round(h * ratio)));
    else ch = Math.max(1, Math.min(h, Math.round(w / ratio)));
    /* centred, or around the focus point, never past the picture's own edges */
    var f = focusOf(o.focus);
    var left = f ? Math.round(f.x * w - cw / 2) : Math.floor((w - cw) / 2), top = f ? Math.round(f.y * h - ch / 2) : Math.floor((h - ch) / 2);
    left = Math.max(0, Math.min(w - cw, left));
    top = Math.max(0, Math.min(h - ch, top));
    var pipe = sharp(bytes, input).rotate().extract({ left: left, top: top, width: cw, height: ch });
    pipe = meta.format === 'jpeg' ? pipe.jpeg({ quality: 92 }) : meta.format === 'webp' ? pipe.webp({ quality: 92 }) : pipe.png();
    return pipe.toBuffer().then(function (out) { return { bytes: out, width: cw, height: ch, cropped: true, left: left, top: top, sourceWidth: w, sourceHeight: h }; });
  }).catch(function (err) {
    console.error('picture-shape: ' + (o.label || 'a picture') + ' could not be cut to its frame — ' + (err && err.message));
    return same;
  });
}

module.exports = {
  ASPECTS: ASPECTS, WORDS: WORDS, LANDSCAPE: LANDSCAPE, FRAME_SHAPES: FRAME_SHAPES, DEFAULT_ASPECT: DEFAULT_ASPECT,
  NEW_FRAME_ASPECT: NEW_FRAME_ASPECT, TOLERANCE: TOLERANCE,
  isAspect: isAspect, ratioOf: ratioOf, nearest: nearest, frameOf: frameOf, frameText: frameText, frameFromText: frameFromText,
  cssRatio: cssRatio, targetRatio: targetRatio, crop: crop, SITE_SHAPES: SITE_SHAPES, shapeForLayout: shapeForLayout,
  /* the advanced picture assistant (W2, 16 Nov 2026): a cut around the Critic's focus point */
  focusOf: focusOf, focusIn: focusIn
};
