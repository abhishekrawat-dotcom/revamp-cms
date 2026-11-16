/* lib/picture-refs.js — W3 "references" (builder C, plan of 16 Nov 2026 §6): the pictures the picture model is shown
   beside a job's words (at most picture-job.MAX_REFS, the most gemini-2.5-flash-image takes well), and the guard that
   keeps what it makes from being a copy of one of them.

   WHAT MAY BE SHOWN (owner, 16 Nov 2026): the owner's attachments, the photos taken out of an attached PDF or deck,
   and the site's own pictures; the previous edition only as STYLE, never its content. Every picture is read from this
   event's own folder in Storage (the AI is locked to the event), never another event's, never a logo (the logo unit,
   its dark copy, the ETB2B logo, a partner's logo) and never Content's own photos of people (speakers, partners);
   only a previous edition's picture may come from ETB2B's own image servers, and only as style. A picture the owner
   gives "as it is" is placed as it is (mode 'place') and is never shown to the model.

   WHAT THE MODEL IS TOLD. Each picture goes with a label (gemini.js callGeminiImage opts.images): "Reference 1,
   SUBJECT: …" (the scene to re-create as a NEW photograph) or "Reference 2, STYLE ONLY: …" (its colour grade, light
   and finish, never its content). The site's and the previous edition's are style only whatever was asked
   (picture-job.refOf).

   PEOPLE. A picture that may show people is never made from a reference that has people in it (owner): for a job
   whose people rule is 'allowed', each reference is looked at first (chat-picture.js checkPicture, Haiku, under a
   cent) and one with people — or one that could not be looked at — is left out.

   INSPIRE, NEVER COPY. Each reference loaded carries its difference hash (dHash: 9 x 8 grey, 64 bits). A picture made
   with references is compared with each (copyCheck): 10 bits or fewer of 64 apart is a copy. The Critic's look
   (lib/picture-critic.js, builder B) flags it, and the runner makes it once more, else holds it.

     COPY_DISTANCE, REF_SIDE, BLOCKED_FOLDERS
     load(job, ctx)          -> Promise<[{ mimeType, data (base64 JPEG), label, kind, use, id, url, hash, guard }]>
                                never rejects; [] = none. ctx: { fb, eventId, switches, deadlineAt, caller, record,
                                eventData (read when not given: the style card's pictures) }
     ownOnly(url, ctx)       -> the Storage path when url is one of this event's own pictures that may be shown or
                                edited, else ''. ctx: { fb | bucket (its name), eventId }
     contentPhoto(path)      -> true for a picture of Content's own records (a past edition's gallery): style only,
                                never an edit's base
     ownersPhoto(path)       -> true for a picture the owner gave (uploaded, attached, taken out of a document): only
                                its light, colour, crop and background may change, its faces never (owner, 16 Nov)
     readOwn(fb, path, o)    -> Promise<Buffer> the picture's bytes (o.maxBytes); rejects when it cannot be read
     readRef(ref, ctx)       -> Promise<{ bytes, type } | null> a reference's bytes: own Storage, or (previous edition
                                only) ETB2B's image servers through safe-fetch
     shown(bytes)            -> Promise<{ mimeType, data } | null>: a JPEG no larger than REF_SIDE, for the model
     dHash(bytes)            -> Promise<16-hex string | null>
     distance(a, b)          -> bits apart (0-64), or -1 when either is not a hash
     nearCopy(a, b)          -> true when distance(a, b) is 0..COPY_DISTANCE
     copyCheck(bytes, refs)  -> Promise<{ copy: true, id, kind, distance } | { copy: false, distance }>: the made
                                picture against every guarded reference (never the picture an edit changes)
     labelFor(use, kind, i)  -> the words that go before reference i */
'use strict';

var pictureJob = require('./picture-job');

var COPY_DISTANCE = 10;                 // of 64 bits: this close or closer is a copy (plan §6.5)
var MAX_REFS = pictureJob.MAX_REFS;
var REF_SIDE = 1024;                    // the longest side a reference is shown at: enough to read its look and scene
var READ_MAX_BYTES = 8 * 1024 * 1024;   // what is read of one picture (lib/promo.js IMAGE_MAX_BYTES)
var FETCH_TIMEOUT_MS = 10000;
var NEEDS_MS = 60000;                   // left before the deadline for the picture itself: with less, none is loaded
/* ETB2B's own image servers (lib/promo.js IMAGE_HOSTS): where a previous edition's pictures live */
var ETB2B_IMAGE_HOSTS = ['img.etb2bimg.com', 'st.etb2bimg.com', 'img.b2bstatic.com'];
/* an event's folders of Content's own pictures of real people and partners, and of logos: never shown, never edited */
var BLOCKED_FOLDERS = ['speakers', 'partners', 'logo', 'brief', 'people', 'jury', 'winners'];
var PICTURE_EXT = /\.(?:jpe?g|png|webp)$/i;

function oneLine(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function bucketName(ctx) {
  ctx = ctx || {};
  if (ctx.bucket && typeof ctx.bucket === 'string') return ctx.bucket;
  return ctx.fb && ctx.fb.bucket && ctx.fb.bucket.name ? String(ctx.fb.bucket.name) : '';
}
function isEventId(v) { return /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(String(v || '')); }

/* ---------- which pictures ---------- */
function ownOnly(url, ctx) {
  ctx = ctx || {};
  var bucket = bucketName(ctx), eventId = String(ctx.eventId || '');
  url = typeof url === 'string' ? url.trim() : '';
  if (!bucket || !isEventId(eventId) || !url || url.length > 600) return '';
  var prefix = 'https://storage.googleapis.com/' + bucket + '/events/' + eventId + '/';
  if (url.indexOf(prefix) !== 0) return '';
  var rest = url.slice(prefix.length).replace(/\?v=\d{1,20}$/, '');
  /* nothing that could leave the folder or name another object: no query, no fragment, no escapes, no dot segments */
  if (!rest || /[?#\\%\s"'<>]/.test(rest) || /(^|\/)\.{1,2}(\/|$)/.test(rest) || /\/\//.test(rest)) return '';
  var segs = rest.split('/');
  if (BLOCKED_FOLDERS.indexOf(segs[0].toLowerCase()) !== -1) return '';
  var file = segs[segs.length - 1];
  /* a logo by its name (the logo unit and its dark copy, the ETB2B logo, a partner's): lib/pictures.js isLogoPath */
  if (/logo/i.test(rest)) return '';
  /* a WebP copy (…​.rv-<hash>.<w>x<h>.w<n>.webp) is a picture too */
  if (!PICTURE_EXT.test(file)) return '';
  return 'events/' + eventId + '/' + rest;
}
function contentPhoto(path) { return /^events\/[^/]+\/gallery\//.test(String(path || '')); }
function madePath(path) { return /^events\/[^/]+\/generated\//.test(String(path || '')); }
function ownersPhoto(path) { return !!path && !madePath(path); }
/* a previous edition's picture on ETB2B's own image servers (style only) */
function etb2bImage(url) {
  var u;
  try { u = new URL(String(url || '').trim()); } catch (e) { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && ETB2B_IMAGE_HOSTS.indexOf(u.hostname.toLowerCase()) !== -1 &&
    !/logo/i.test(u.pathname) && PICTURE_EXT.test(u.pathname);
}

/* ---------- reading ---------- */
function readOwn(fb, path, o) {
  o = o || {};
  var max = o.maxBytes || READ_MAX_BYTES;
  return Promise.resolve().then(function () {
    if (!fb || !fb.bucket || typeof fb.bucket.file !== 'function') throw new Error('no Storage');
    return fb.bucket.file(path).download();
  }).then(function (got) {
    var buf = Array.isArray(got) ? got[0] : got;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('empty');
    if (buf.length > max) throw new Error('too large (' + buf.length + ' bytes)');
    return buf;
  });
}
function sniff(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return '';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}
function readRef(ref, ctx) {
  ctx = ctx || {};
  var path = ownOnly(ref && ref.url, ctx);
  var read;
  if (path) read = readOwn(ctx.fb, path);
  else if (ref && ref.kind === 'previous-edition' && etb2bImage(ref.url)) {
    read = Promise.resolve().then(function () {
      return require('./safe-fetch').safeFetch(String(ref.url).trim(), { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: READ_MAX_BYTES, maxRedirects: 0, accept: 'image/' });
    }).then(function (r) {
      if (!r || r.status !== 200) throw new Error('answered ' + (r && r.status));
      return r.body;
    });
  } else return Promise.resolve(null);
  return read.then(function (bytes) {
    var type = sniff(bytes);
    return type ? { bytes: bytes, type: type, path: path } : null;
  }, function (err) {
    console.error('picture-refs: a reference picture of ' + ctx.eventId + ' could not be read — ' + (err && err.message));
    return null;
  });
}

var sharpModule;
function loadSharp() {
  if (sharpModule === undefined) {
    try { sharpModule = require('sharp'); } catch (e) { sharpModule = null; console.error('picture-refs: no picture library here (sharp) — ' + e.message); }
  }
  return sharpModule;
}
var INPUT = { limitInputPixels: 60000000, failOn: 'error' };
/* a JPEG no larger than REF_SIDE on its longest side, a see-through picture laid on white */
function shown(bytes) {
  var sharp = loadSharp();
  if (!sharp || !Buffer.isBuffer(bytes)) return Promise.resolve(null);
  return Promise.resolve().then(function () {
    return sharp(bytes, INPUT).rotate().resize({ width: REF_SIDE, height: REF_SIDE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
  }).then(function (out) { return { mimeType: 'image/jpeg', data: out.toString('base64') }; }, function (err) {
    console.error('picture-refs: a reference picture could not be prepared — ' + (err && err.message));
    return null;
  });
}

/* ---------- the copy guard ---------- */
function dHash(bytes) {
  var sharp = loadSharp();
  if (!sharp || !Buffer.isBuffer(bytes) || !bytes.length) return Promise.resolve(null);
  return Promise.resolve().then(function () {
    return sharp(bytes, INPUT).rotate().flatten({ background: '#ffffff' }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  }).then(function (r) {
    var ch = r.info.channels || 1, px = function (x, y) { return r.data[(y * 9 + x) * ch]; };
    var hex = '';
    for (var y = 0; y < 8; y++) {
      var byte = 0;
      for (var x = 0; x < 8; x++) byte = (byte << 1) | (px(x, y) > px(x + 1, y) ? 1 : 0);
      hex += (byte < 16 ? '0' : '') + byte.toString(16);
    }
    return hex;
  }, function (err) {
    console.error('picture-refs: a picture could not be hashed — ' + (err && err.message));
    return null;
  });
}
var HASH_RE = /^[0-9a-f]{16}$/;
function distance(a, b) {
  if (!HASH_RE.test(String(a || '')) || !HASH_RE.test(String(b || ''))) return -1;
  var d = 0;
  for (var i = 0; i < 16; i += 2) {
    var x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
function nearCopy(a, b) { var d = distance(a, b); return d >= 0 && d <= COPY_DISTANCE; }
function copyCheck(bytes, refs) {
  var guarded = (Array.isArray(refs) ? refs : []).filter(function (r) { return r && r.guard !== false && HASH_RE.test(String(r.hash || '')); });
  if (!guarded.length) return Promise.resolve({ copy: false, distance: -1 });
  return dHash(bytes).then(function (h) {
    if (!h) return { copy: false, distance: -1 };
    var best = null;
    guarded.forEach(function (r) {
      var d = distance(h, r.hash);
      if (d >= 0 && (!best || d < best.distance)) best = { id: r.id || '', kind: r.kind || '', distance: d };
    });
    return best && best.distance <= COPY_DISTANCE ? Object.assign({ copy: true }, best) : { copy: false, distance: best ? best.distance : -1 };
  });
}

/* ---------- what the model is told ---------- */
var LABELS = {
  subject: 'SUBJECT: the scene to re-create. Make a NEW photograph of this kind of scene, from a new viewpoint and at a new moment; never copy it, and take no person, face, words, sign or logo from it.',
  style: 'STYLE ONLY: match its colour grade, light and finish; take none of its content: no buildings, people, words, signs, logos or layout from it.',
  previous: 'STYLE ONLY (a past edition of this event, for inspiration): match its colour grade, light and finish; never its content, people, words, signs, logos or layout.'
};
function labelFor(use, kind, i) {
  var words = kind === 'previous-edition' ? LABELS.previous : use === 'subject' ? LABELS.subject : LABELS.style;
  return 'Reference ' + (i + 1) + ', ' + words;
}

/* the style card's pictures (lib/picture-brief.js writeStyleCard keeps 2 of the site's own at events/<id>.pictureStyle) */
function styleRefsOf(eventData) {
  var card = eventData && eventData.pictureStyle && typeof eventData.pictureStyle === 'object' ? eventData.pictureStyle : null;
  var list = card && Array.isArray(card.refs) ? card.refs : [];
  return list.map(function (u, i) {
    var url = typeof u === 'string' ? u : u && u.url;
    return pictureJob.refOf({ id: 'style-' + (i + 1), kind: 'site', url: url, use: 'style' });
  }).filter(Boolean).slice(0, 2);
}

function load(job, ctx) {
  ctx = ctx || {};
  job = job && typeof job === 'object' ? job : {};
  var eventId = String(ctx.eventId || '');
  if (!ctx.fb || !isEventId(eventId)) return Promise.resolve([]);
  if (ctx.deadlineAt && ctx.deadlineAt - Date.now() < NEEDS_MS) return Promise.resolve([]);
  var edit = job.mode === 'edit';
  /* the job's own (planned by builder A from the owner's numbered attachments and document pictures): what was asked
     first, the subject before the style; never one placed as it is, never the picture an edit changes */
  var own = (Array.isArray(job.refs) ? job.refs : []).map(pictureJob.refOf).filter(function (r) {
    return r && r.use !== 'as-is' && !(edit && r.kind === 'current');
  });
  own.sort(function (a, b) { return (a.use === 'subject' ? 0 : 1) - (b.use === 'subject' ? 0 : 1); });
  var eventData = ctx.eventData && typeof ctx.eventData === 'object' ? Promise.resolve(ctx.eventData) : Promise.resolve().then(function () {
    if (edit || own.some(function (r) { return r.use === 'style'; })) return null;
    return ctx.fb.db.collection('events').doc(eventId).get().then(function (s) { return s && s.exists ? s.data() : null; });
  }).catch(function () { return null; });
  return eventData.then(function (ev) {
    var list = own.slice();
    /* a new picture with no style of its own takes the site's (one tone across the site) */
    if (!edit && !list.some(function (r) { return r.use === 'style'; })) list = list.concat(styleRefsOf(ev));
    var seen = {};
    list = list.filter(function (r) { if (seen[r.url]) return false; seen[r.url] = true; return true; }).slice(0, MAX_REFS + 2);
    var peopleJob = job.peopleRule === 'allowed';
    return Promise.all(list.map(function (r) {
      return readRef(r, Object.assign({}, ctx, { eventId: eventId })).then(function (got) {
        if (!got) return null;
        /* a past edition's gallery photo is style only */
        var use = got.path && contentPhoto(got.path) ? 'style' : r.use;
        return Promise.all([shown(got.bytes), dHash(got.bytes)]).then(function (x) {
          if (!x[0] || !peopleJob) return x.concat(false);
          /* looked at as it is shown (a small JPEG): what the model would see */
          return peopleIn({ bytes: Buffer.from(x[0].data, 'base64'), type: x[0].mimeType }, ctx).then(function (p) { return x.concat(p); });
        }).then(function (x) {
          if (!x[0]) return null;
          if (x[2] !== false) {
            console.error('picture-refs: a reference of ' + eventId + ' was left out: ' + (x[2] === null ? 'it could not be looked at' : 'it shows people') + ', and this picture may show people');
            return null;
          }
          return { mimeType: x[0].mimeType, data: x[0].data, kind: r.kind, use: use, id: r.id || '', url: r.url, hash: x[1] || '',
            /* the copy guard: every reference but the picture an edit changes */
            guard: r.kind !== 'current' };
        });
      });
    })).then(function (got) {
      var out = got.filter(Boolean).slice(0, MAX_REFS);
      out.forEach(function (r, i) { r.label = labelFor(r.use, r.kind, i); });
      return out;
    });
  }).catch(function (err) {
    console.error('picture-refs: the reference pictures of ' + eventId + ' were not loaded — ' + (err && err.message));
    return [];
  });
}
/* -> false (no people), true (people), null (could not look): today's check, read when first used */
function peopleIn(got, ctx) {
  return Promise.resolve().then(function () {
    return require('./chat-picture').checkPicture(got.bytes, got.type, 'none', { eventId: ctx.eventId, deadlineAt: ctx.deadlineAt, record: ctx.record });
  }).then(function (found) { return found && typeof found === 'object' ? found.people === true : null; }, function () { return null; });
}

module.exports = {
  COPY_DISTANCE: COPY_DISTANCE, REF_SIDE: REF_SIDE, BLOCKED_FOLDERS: BLOCKED_FOLDERS, ETB2B_IMAGE_HOSTS: ETB2B_IMAGE_HOSTS, LABELS: LABELS,
  load: load, ownOnly: ownOnly, contentPhoto: contentPhoto, ownersPhoto: ownersPhoto, madePath: madePath, readOwn: readOwn, readRef: readRef,
  shown: shown, sniff: sniff, dHash: dHash, distance: distance, nearCopy: nearCopy, copyCheck: copyCheck, labelFor: labelFor, styleRefsOf: styleRefsOf
};
