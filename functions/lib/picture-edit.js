/* lib/picture-edit.js — W3 "edit the picture you point at" (builder C, plan of 16 Nov 2026 §6): "warmer", "brighter",
   "crop it tighter", "make it wider", "remove the people", "fill the blank part", "show the Davos valley instead of
   the Matterhorn" change THAT picture and keep its composition, instead of making a new, unrelated one (the owner's
   complaint: "make it warmer" made a different street).

   HOW. An exact change of light or colour is done here, free and in about a second, with sharp: brighter or darker,
   warmer or cooler, more or less colour (black and white too), more or less contrast, a closer crop, a mirror. Every
   other change goes to the picture model WITH the picture as its input (gemini.js callGeminiImage opts.image, the path
   the phone banner and the logo unit already use): remove or replace something, time of day, season, weather, "less
   busy", fill a blank part, swap a landmark, match the site's style. "Wider" (extend) puts the picture in the middle of
   a wider canvas (up to 21:9) whose soft margins the model fills, the middle kept as it is.

   THE OWNER'S OWN PHOTOS (owner, 16 Nov 2026). A photo the owner gave (uploaded, attached, taken out of their
   document) may have its light, colour, crop and background changed, nothing else; faces never change. Anything
   else is refused in plain words before anything is paid for (check(), which builder A's plan calls too). The
   Critic (builder B) compares before and after and drops an edit that changed a face.

   SAFETY. The picture changed is always this event's own (lib/picture-refs.js ownOnly): never another event's, a logo
   (the logo unit, its dark copy, the ETB2B logo), Content's photos of people (speakers, partners) or a past edition's
   gallery photo. The words of the change are the owner's (builder A checks the quote); the model is told the site's
   picture rules last: no added words, letters, logos or real people; people only where the place allows them.

     NOT_SUPPORTED, SHARP_KINDS, MODEL_KINDS, MAX_WIDE
     run(job, ctx)        -> Promise<{ bytes, type, width, height, how: 'sharp'|'model', line } | { code, status, error? }>
                             never rejects. code 'not-supported': the runner makes a new picture instead (as before).
                             job: the stored job (mode 'edit', editOf { url }, change, changeKind, frame, aspect,
                                  original, peopleRule)
                             ctx: { fb, eventId, deadlineAt, record (usage), switches, refs (lib/picture-refs.js load),
                                    caller, and for a repair (builder B): base { bytes, type } (the picture to change,
                                    in hand), change (the Critic's one instruction), changeKind, review }
     check(job, ctx)      -> { ok: true, path, own } | { ok: false, code, status, error }: may this job's picture be
                             changed this way (no network)
     classify(changeKind) -> 'sharp' | 'model' | ''
     kindOf(change)       -> the changeKind the words of a change read as ('' when they say nothing)
     opsOf(change)        -> the exact operations those words ask for ({ warmth, brightness, saturation, grey,
                             contrast, zoom, flop }), or null when they ask for something else too
     sharpOps(bytes, job) -> Promise<{ bytes, type, width, height, how: 'sharp', line } | null>  (job.change's words)
     extendCanvas(bytes, ratio) -> Promise<{ bytes, type, width, height, aspect, box } | null>: the picture on a canvas
                             of the nearest model shape at least that wide (at most 21:9), the margins a soft blur of
                             it; null when it is already that wide
     editPrompt(change, o) -> the words the picture model gets with the picture */
'use strict';

var pictureRefs = require('./picture-refs');

var NOT_SUPPORTED = { code: 'not-supported', status: 501 };
var SHARP_KINDS = ['tone', 'light', 'crop', 'focus'];
var MODEL_KINDS = ['remove', 'replace', 'extend', 'style', 'season', 'fill'];
var MAX_WIDE = 21 / 9;                  // the widest shape the picture model makes (gemini.js IMAGE_ASPECTS)
var MIN_TALL = 9 / 16;
var TIMEOUT_MS = 90000;                 // one picture model call (chat-picture.js TIMEOUT_MS)
var CHECK_RESERVE_MS = 20000;           // kept back from the deadline for the look at the edited picture
var MIN_MODEL_MS = 25000;               // a model edit that cannot have this long is not started
/* the shapes the picture model takes, as width / height (gemini.js IMAGE_ASPECTS) */
var MODEL_SHAPES = [['21:9', 21 / 9], ['16:9', 16 / 9], ['3:2', 1.5], ['4:3', 4 / 3], ['5:4', 1.25], ['1:1', 1], ['4:5', 0.8], ['3:4', 0.75], ['2:3', 2 / 3], ['9:16', 9 / 16]];
var INPUT = { limitInputPixels: 60000000, failOn: 'error' };

/* what the owner is told when a change is not made (plain words; never a bare "ET") */
var WORDS = {
  'edit-source': 'I can only change pictures stored with this event, and never a logo or a speaker\'s or partner\'s photo. Nothing on your site changed.',
  'edit-unreadable': 'I could not open that picture to change it. Nothing on your site changed — try again in a minute.',
  'edit-own-photo': 'This is your own photo, so I only change its light, colour, crop or background, and never the people in it. Nothing on your site changed.',
  'edit-time': 'There was not enough time left to change the picture. Nothing on your site changed — ask again.',
  'edit-none': 'I could not tell what to change in the picture. Nothing on your site changed — say what should look different.'
};
function refused(code, status) { return { code: code, status: status, error: WORDS[code] }; }

function oneLine(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 300); }
function nearestShape(r, wider) {
  var best = null;
  MODEL_SHAPES.forEach(function (s) {
    if (wider && s[1] < r - 1e-6) return;
    var d = Math.abs(Math.log(s[1] / r));
    if (!best || d < best.d) best = { aspect: s[0], ratio: s[1], d: d };
  });
  return best || { aspect: '21:9', ratio: MAX_WIDE, d: 0 };
}

function classify(changeKind) {
  if (SHARP_KINDS.indexOf(changeKind) !== -1) return 'sharp';
  if (MODEL_KINDS.indexOf(changeKind) !== -1) return 'model';
  return '';
}

/* ---------- the words of a change ---------- */
var R = {
  small: /\b(?:a (?:little|bit|touch|tad)|slightly|subtly|gently|a little bit|marginally)\b/,
  big: /\b(?:much|a lot|far|very|really|way|significantly|lots)\b/,
  warm: /\b(?:warm(?:er|th)?|golden|sunnier|cosier|cozier)\b/,
  cool: /\b(?:cool(?:er)?|colder|bluer|icier)\b/,
  bright: /\b(?:bright(?:er|en)|lighter|lighten|more light|(?:too|less|not so) dark)\b/,
  dark: /\b(?:dark(?:er|en)|dimmer|moodier|(?:too|less|not so) bright)\b/,
  vivid: /\b(?:more (?:vivid|colou?rful|saturated|vibrant)|vivid|vibrant|richer colou?rs?|saturate|more colou?r)\b/,
  muted: /\b(?:muted|desaturat\w*|less (?:colou?rful|saturated|vivid|vibrant)|softer colou?rs?|washed out|less colou?r)\b/,
  grey: /\b(?:black and white|black & white|greyscale|grayscale|monochrome|b ?& ?w)\b/,
  contrastUp: /\b(?:more contrast|higher contrast|punchier|crisper)\b/,
  contrastDown: /\b(?:less contrast|lower contrast|flatter|softer contrast)\b/,
  zoomIn: /\b(?:zoom(?:ed)? in|crop(?: it)? (?:tighter|in|closer)|tighter crop|closer crop|crop closer|crop tighter)\b/,
  flop: /\b(?:flip|mirror)(?:ped)?\b/,
  /* anything a sharp edit cannot do: these words go to the picture model */
  other: /\b(?:remove|replace|instead|add|put|swap|change (?:the|it to)|turn (?:it )?into|night|evening|dusk|dawn|sunset|sunrise|morning|winter|summer|autumn|spring|snow|rain|fog|mist|season|weather|style|look like|empty|busy|clutter|fill|blank|wider|taller|extend|zoom(?:ed)? out|background|backdrop|sky|people|person|figures?|crowd|sign|text|logo|words?)\b/
};
function opsOf(change) {
  var t = ' ' + oneLine(change, 300).toLowerCase().replace(/[.;!?]+/g, ' ').replace(/\bchange nothing else\b|\bkeep (?:everything|the rest)(?: else)?(?: the same| as it is)?\b|\bnothing else\b/g, ' ') + ' ';
  if (!t.trim()) return null;
  var amount = R.small.test(t) ? 0.5 : R.big.test(t) ? 1.6 : 1, ops = {}, any = false;
  function set(k, v) { ops[k] = v; any = true; }
  var warm = R.warm.test(t), cool = R.cool.test(t), bright = R.bright.test(t), dark = R.dark.test(t);
  if (warm && cool) return null;
  if (warm) set('warmth', amount); else if (cool) set('warmth', -amount);
  if (bright && dark) return null;
  if (bright) set('brightness', amount); else if (dark) set('brightness', -amount);
  if (R.grey.test(t)) set('grey', true);
  else if (R.vivid.test(t)) set('saturation', amount);
  else if (R.muted.test(t)) set('saturation', -amount);
  if (R.contrastUp.test(t)) set('contrast', amount); else if (R.contrastDown.test(t)) set('contrast', -amount);
  if (R.zoomIn.test(t)) set('zoom', Math.min(1.5, 1 + 0.15 * amount));
  if (R.flop.test(t)) set('flop', true);
  /* what is left once the exact words are taken out: anything that asks for more goes to the model */
  var rest = t;
  ['warm', 'cool', 'bright', 'dark', 'grey', 'vivid', 'muted', 'contrastUp', 'contrastDown', 'zoomIn'].forEach(function (k) { rest = rest.replace(new RegExp(R[k].source, 'g'), ' '); });
  if (R.other.test(rest)) return null;
  return any ? ops : null;
}
function kindOf(change) {
  var t = oneLine(change, 300).toLowerCase();
  if (!t) return '';
  var ops = opsOf(t);
  if (ops) return ops.zoom || ops.flop ? 'crop' : ops.brightness || ops.contrast ? 'light' : 'tone';
  if (/\b(?:wider|taller|extend|zoom(?:ed)? out|fill (?:the )?frame|fills (?:the|its) frame)\b/.test(t)) return 'extend';
  if (/\b(?:fill|blank|empty (?:part|area|space|screen))\b/.test(t)) return 'fill';
  if (/\b(?:remove|take out|get rid of|without|less busy|declutter|clear)\b/.test(t)) return 'remove';
  if (/\b(?:night|evening|dusk|dawn|sunset|sunrise|morning|winter|summer|autumn|spring|snow|rain|fog|mist|season|weather)\b/.test(t)) return 'season';
  if (/\b(?:style|look like|in the (?:site's|same) (?:style|look))\b/.test(t)) return 'style';
  return 'replace';
}
/* a change to an owner's own photo that keeps to its light, colour, crop and background */
var BACKGROUND_RE = /\b(?:background|backdrop|behind (?:the|her|him|them))\b/i;
function ownPhotoAllows(kind, change) {
  /* light, colour, crop and focus; a wider frame adds only scenery around the photo, its middle kept as it is */
  if (SHARP_KINDS.indexOf(kind) !== -1 || kind === 'extend') return true;
  return BACKGROUND_RE.test(String(change || '')) && !/\b(?:face|faces|person|people|her|him|man|woman|men|women|smile|expression)\b/i.test(String(change || '').replace(BACKGROUND_RE, ' '));
}

/* ---------- may it be changed this way ---------- */
function check(job, ctx) {
  ctx = ctx || {};
  job = job || {};
  var url = (job.editOf && job.editOf.url) || '';
  var path = url ? pictureRefs.ownOnly(url, ctx) : '';
  if (!url) return { ok: true, path: '', own: false, base: false };
  if (!path || pictureRefs.contentPhoto(path)) return Object.assign({ ok: false }, refused('edit-source', 403));
  var own = pictureRefs.ownersPhoto(path);
  var change = oneLine(ctx.change || job.change, 300);
  var kind = ctx.changeKind || job.changeKind || kindOf(change);
  if (own && !ownPhotoAllows(kind, change)) return Object.assign({ ok: false }, refused('edit-own-photo', 422));
  return { ok: true, path: path, own: own, base: true };
}

/* ---------- exact edits (sharp) ---------- */
var sharpModule;
function loadSharp() {
  if (sharpModule === undefined) {
    try { sharpModule = require('sharp'); } catch (e) { sharpModule = null; console.error('picture-edit: no picture library here (sharp) — ' + e.message); }
  }
  return sharpModule;
}
function lineOf(ops) {
  var parts = [];
  if (ops.warmth) parts.push(ops.warmth > 0 ? 'warmer light' : 'cooler light');
  if (ops.brightness) parts.push(ops.brightness > 0 ? 'brighter' : 'darker');
  if (ops.grey) parts.push('black and white');
  else if (ops.saturation) parts.push(ops.saturation > 0 ? 'more colour' : 'softer colours');
  if (ops.contrast) parts.push(ops.contrast > 0 ? 'more contrast' : 'softer contrast');
  if (ops.zoom) parts.push('a closer crop');
  if (ops.flop) parts.push('mirrored');
  var s = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || 'changed';
  return s.charAt(0).toUpperCase() + s.slice(1) + ' — the same picture, nothing else changed.';
}
function outFormat(pipe, type) {
  return type === 'image/png' ? pipe.png() : type === 'image/webp' ? pipe.webp({ quality: 92 }) : pipe.jpeg({ quality: 92 });
}
function sharpOps(bytes, job) {
  job = job || {};
  var ops = opsOf(job.change);
  var sharp = loadSharp();
  if (!ops || !sharp || !Buffer.isBuffer(bytes)) return Promise.resolve(null);
  var type = pictureRefs.sniff(bytes);
  if (!type) return Promise.resolve(null);
  return Promise.resolve().then(function () {
    return sharp(bytes, INPUT).metadata();
  }).then(function (meta) {
    var turned = (meta.orientation || 1) >= 5;
    var w = turned ? meta.height : meta.width, h = turned ? meta.width : meta.height;
    if (!(w > 0 && h > 0)) return null;
    var pipe = sharp(bytes, INPUT).rotate();
    if (ops.zoom) {
      var cw = Math.max(1, Math.round(w / ops.zoom)), ch = Math.max(1, Math.round(h / ops.zoom));
      var f = job.focus && typeof job.focus === 'object' ? job.focus : { x: 0.5, y: 0.5 };
      var left = Math.max(0, Math.min(w - cw, Math.round(f.x * w - cw / 2))), top = Math.max(0, Math.min(h - ch, Math.round(f.y * h - ch / 2)));
      pipe = pipe.extract({ left: left, top: top, width: cw, height: ch }).resize(w, h, { fit: 'fill' });
    }
    if (ops.flop) pipe = pipe.flop();
    if (ops.warmth) {
      var a = ops.warmth;
      pipe = pipe.recomb([[1 + 0.07 * a, 0, 0], [0, 1 + 0.015 * a, 0], [0, 0, 1 - 0.09 * a]]);
    }
    var mod = {};
    if (ops.brightness) mod.brightness = Math.max(0.3, 1 + 0.14 * ops.brightness);
    if (ops.saturation) mod.saturation = Math.max(0, 1 + 0.3 * ops.saturation);
    if (mod.brightness || mod.saturation) pipe = pipe.modulate(mod);
    if (ops.grey) pipe = pipe.greyscale().toColourspace('srgb');
    if (ops.contrast) {
      var c = Math.max(0.5, 1 + 0.18 * ops.contrast);
      pipe = pipe.linear(c, 128 * (1 - c));
    }
    return outFormat(pipe, type).toBuffer({ resolveWithObject: true }).then(function (r) {
      return { bytes: r.data, type: type, width: r.info.width, height: r.info.height, how: 'sharp', line: lineOf(ops) };
    });
  }).catch(function (err) {
    console.error('picture-edit: an exact edit could not be made — ' + (err && err.message));
    return null;
  });
}

/* ---------- a wider (or taller) canvas ---------- */
function extendCanvas(bytes, ratio) {
  var sharp = loadSharp();
  ratio = +ratio;
  if (!sharp || !Buffer.isBuffer(bytes) || !(ratio > 0)) return Promise.resolve(null);
  return Promise.resolve().then(function () {
    return sharp(bytes, INPUT).metadata();
  }).then(function (meta) {
    var turned = (meta.orientation || 1) >= 5;
    var w = turned ? meta.height : meta.width, h = turned ? meta.width : meta.height;
    if (!(w > 0 && h > 0)) return null;
    var own = w / h, wider = ratio > own * 1.02, taller = ratio < own / 1.02;
    if (!wider && !taller) return null;
    var shapeTo = wider ? nearestShape(Math.min(ratio, MAX_WIDE), true) : nearestShape(Math.max(ratio, MIN_TALL), false);
    if (wider ? shapeTo.ratio <= own * 1.02 : shapeTo.ratio >= own / 1.02) return null;
    var cw = wider ? Math.round(h * shapeTo.ratio) : w, ch = wider ? h : Math.round(w / shapeTo.ratio);
    var box = { left: Math.floor((cw - w) / 2), top: Math.floor((ch - h) / 2), width: w, height: h };
    var upright = sharp(bytes, INPUT).rotate().flatten({ background: '#ffffff' });
    return Promise.all([
      upright.clone().resize(cw, ch, { fit: 'cover' }).blur(Math.max(8, Math.round(Math.min(cw, ch) / 40))).modulate({ brightness: 0.96, saturation: 0.85 }).toBuffer(),
      upright.clone().png().toBuffer()
    ]).then(function (x) {
      return sharp(x[0]).composite([{ input: x[1], left: box.left, top: box.top }]).png().toBuffer();
    }).then(function (canvas) {
      return { bytes: canvas, type: 'image/png', width: cw, height: ch, aspect: shapeTo.aspect, box: box };
    });
  }).catch(function (err) {
    console.error('picture-edit: the wider canvas could not be made — ' + (err && err.message));
    return null;
  });
}

/* ---------- the model's words ---------- */
function editPrompt(change, o) {
  o = o || {};
  var lines = [];
  if (o.extend) {
    lines.push('This photograph has been placed in the middle of a ' + (o.extend === 'taller' ? 'taller' : 'wider') + ' canvas; the soft, blurred bands ' +
      (o.extend === 'taller' ? 'above and below it' : 'at its left and right') + ' are empty space to fill. Extend the scene into them naturally, continuing its ' +
      'perspective, ground, sky, light and colours, so the whole canvas is one seamless photograph with no visible join. Keep the middle part exactly as it is.');
  } else {
    lines.push('Edit this photograph. The change: ' + oneLine(change, 300).replace(/[.;]+$/, '') + '.');
    lines.push('Keep everything else exactly as it is: the same scene, viewpoint, framing, objects, light and colours, except where the change itself says otherwise. It must still be the same photograph, not a new one.');
  }
  if (o.remove) lines.push('Where something is removed, fill its place with what would naturally be behind it.');
  if (o.own) lines.push('This is the event owner\'s own photograph: change only its light, colour, framing or background. Keep every person in it exactly as they are — the same face, expression, hair, body, clothes and position; never redraw, smooth, swap or add a face.');
  if (o.styleRefs) lines.push('The reference pictures that follow it are for style only: match their colour grade, light and finish, never their content.');
  if (o.subjectRefs) lines.push('A reference marked SUBJECT shows what to bring into the photograph, newly photographed and fitted to its light and perspective; never pasted as it is.');
  var people = o.peopleRule === 'allowed'
    ? 'Any person added is Indian, and the people include women; no one looks like a real, famous or named person.'
    : 'Add no people in any form: no persons, figures, silhouettes or body parts.';
  lines.push('STRICT: the result is one full-bleed photograph, edge to edge, with no border, frame, mat or caption. ' + people +
    ' Add no words, letters, numbers, signs, screens with writing, logos, flags or watermarks.');
  return lines.join(' ');
}

/* ---------- one edit ---------- */
function run(job, ctx) {
  ctx = ctx || {};
  job = job && typeof job === 'object' ? job : {};
  var eventId = String(ctx.eventId || '');
  return Promise.resolve().then(function () {
    var repair = !!(ctx.base && Buffer.isBuffer(ctx.base.bytes));
    if (job.mode !== 'edit' && !repair) return Object.assign({}, NOT_SUPPORTED);
    var change = oneLine(ctx.change || job.change, 300);
    if (!change) return repair ? refused('edit-none', 422) : Object.assign({}, NOT_SUPPORTED);
    var kind = ctx.changeKind || job.changeKind || kindOf(change);
    var ok = repair ? { ok: true, own: false, path: '' } : check(job, Object.assign({}, ctx, { change: change, changeKind: kind }));
    if (!ok.ok) return { code: ok.code, status: ok.status, error: ok.error };
    /* nothing to change from: the runner makes a new picture, as it did before edits */
    if (!repair && !ok.path) return Object.assign({}, NOT_SUPPORTED);
    /* a re-fit or a closer crop starts from the picture as it was made, before its frame cut it (job.original) */
    var originalPath = (kind === 'crop' || kind === 'focus' || kind === 'extend') && job.original ? pictureRefs.ownOnly(job.original, ctx) : '';
    var read = repair ? Promise.resolve(ctx.base.bytes) : pictureRefs.readOwn(ctx.fb, originalPath || ok.path).catch(function (err) {
      if (!originalPath) throw err;
      return pictureRefs.readOwn(ctx.fb, ok.path);
    });
    return read.then(function (bytes) {
      if (!pictureRefs.sniff(bytes)) return refused('edit-unreadable', 422);
      var o = { own: ok.own, kind: kind, change: change };
      if (classify(kind) === 'sharp' || (!job.changeKind && opsOf(change))) {
        return sharpOps(bytes, { change: change, focus: job.focus }).then(function (done) {
          return done || modelEdit(bytes, job, ctx, o);
        });
      }
      return modelEdit(bytes, job, ctx, o);
    }, function (err) {
      console.error('picture-edit: the picture to change in ' + eventId + ' could not be read — ' + (err && err.message));
      return refused('edit-unreadable', 422);
    });
  }).catch(function (err) {
    console.error('picture-edit: the edit of a picture in ' + eventId + ' failed — ' + (err && err.message));
    return { code: 'ai-unavailable', status: 502 };
  });
}

function modelEdit(bytes, job, ctx, o) {
  var gemini = require('./gemini');
  var eventId = String(ctx.eventId || '');
  var now = Date.now(), until = ctx.deadlineAt ? ctx.deadlineAt - CHECK_RESERVE_MS : now + TIMEOUT_MS + 5000;
  if (until - now < MIN_MODEL_MS) return Promise.resolve(refused('edit-time', 504));
  var type = pictureRefs.sniff(bytes);
  var target = targetRatio(job);
  var extend = o.kind === 'extend' && target > 0;
  var start = extend ? extendCanvas(bytes, target) : Promise.resolve(null);
  return start.then(function (canvas) {
    var input = canvas ? { bytes: canvas.bytes, type: canvas.type } : { bytes: bytes, type: type };
    return measure(input.bytes).then(function (size) {
      var aspect = canvas ? canvas.aspect : size ? nearestShape(size.w / size.h, false).aspect : '';
      /* references the runner loaded (lib/picture-refs.js): only for a change of style (the site's look) or one that brings
         a subject in from them; the picture changed is never one of them */
      var refs = (Array.isArray(ctx.refs) ? ctx.refs : []).filter(function (r) {
        return r && r.kind !== 'current' && ((o.kind === 'style' && r.use === 'style') || (o.kind === 'replace' && r.use === 'subject'));
      }).slice(0, 2);
      var prompt = editPrompt(o.change, { extend: canvas ? (canvas.width > canvas.box.width ? 'wider' : 'taller') : '', own: o.own, remove: o.kind === 'remove' || o.kind === 'fill',
        peopleRule: job.peopleRule, styleRefs: refs.some(function (r) { return r.use === 'style'; }), subjectRefs: refs.some(function (r) { return r.use === 'subject'; }) });
      var opts = { route: 'picture-edit', eventId: eventId, timeoutMs: Math.min(TIMEOUT_MS, until - Date.now()), deadlineAt: until,
        image: { mimeType: input.type, data: input.bytes.toString('base64') } };
      if (aspect) opts.aspectRatio = aspect;
      if (refs.length) opts.images = refs.map(function (r) { return { mimeType: r.mimeType, data: r.data, label: r.label }; });
      return Promise.resolve().then(function () { return gemini.callGeminiImage(prompt, opts); }).then(function (r) {
        r = r || {};
        if (r.usage && typeof ctx.record === 'function') { try { ctx.record(r.usage); } catch (e) { /* the runner logs its own */ } }
        if (r.error || !r.base64) return { code: r.code && gemini.FAILURES[r.code] ? r.code : 'ai-bad-output', status: r.status || 502 };
        var out = Buffer.from(String(r.base64), 'base64'), outType = pictureRefs.sniff(out);
        if (!outType) return { code: 'ai-bad-output', status: 502 };
        return measure(out).then(function (s) {
          return { bytes: out, type: outType, width: s ? s.w : 0, height: s ? s.h : 0, how: 'model',
            line: canvas ? 'The same picture, made ' + (canvas.width > canvas.box.width ? 'wider' : 'taller') + ' to fill its frame; the middle is as it was.' : 'Changed on the same picture: ' + oneLine(o.change, 160).replace(/[.;]+$/, '') + '.' };
        });
      });
    });
  });
}
function measure(bytes) {
  var sharp = loadSharp();
  if (!sharp) return Promise.resolve(null);
  return sharp(bytes, INPUT).metadata().then(function (m) {
    var turned = (m.orientation || 1) >= 5;
    var w = turned ? m.height : m.width, h = turned ? m.width : m.height;
    return w > 0 && h > 0 ? { w: w, h: h } : null;
  }, function () { return null; });
}
function targetRatio(job) {
  try { return require('./picture-shape').targetRatio({ frame: job.frame, aspect: job.aspect }); } catch (e) { return 0; }
}

module.exports = {
  NOT_SUPPORTED: NOT_SUPPORTED, SHARP_KINDS: SHARP_KINDS, MODEL_KINDS: MODEL_KINDS, MAX_WIDE: MAX_WIDE, WORDS: WORDS,
  run: run, check: check, classify: classify, kindOf: kindOf, opsOf: opsOf, sharpOps: sharpOps, extendCanvas: extendCanvas, editPrompt: editPrompt
};
