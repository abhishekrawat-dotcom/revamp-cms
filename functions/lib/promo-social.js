/* Promotions → Social posts: the promotional platform's post studio (the owner's Social Post Generator), on
   Oneworld's events. The nine post templates, their formats and their brand kits are the platform's own code
   (promo-engine/src/templates, built to ./vendor/promo-engine.js); this file is the platform's server routes for
   them (app/src/server.ts /api/catalog, /api/assets, /api/psd|background|logo, /api/preview, /api/download and
   /api/editor/*) on Oneworld's data and storage:

     GET    /api/promo/social/catalog?eventId=           the event's header facts, the formats, the templates
     GET    /api/promo/social/art?eventId=               which uploaded pictures the posts use
     POST   /api/promo/social/art?eventId=&slot=&from=   (raw, ≤ 8 MiB) a background, the logo, or a PSD's unit
     POST   /api/promo/social/art/psd  { eventId, name, bytes, canvasWidth, canvasHeight, found }   a PSD's summary
     DELETE /api/promo/social/art?eventId=&slot=         Remove one picture (the object itself is kept)
     POST   /api/promo/social/html     { eventId, items: [{ templateId, format, params, preview? }], captionOnly? }
     GET    /api/promo/social/layout?eventId=&templateId=&format=&theme=&bg=     a saved layout, if any
     POST   /api/promo/social/layout/base?eventId=&key=  (raw PNG / WebP) a layout's flattened picture
     POST   /api/promo/social/layout   { eventId, templateId, format, theme, bg, width, height, base, elements,
                                         params, caption }                    Save
     POST   /api/promo/social/layout/reset  { eventId, templateId, format, theme, bg }
     POST   /api/promo/social/picture?eventId=           (raw, ≤ 8 MiB) a picture for the layout editor's Image
                                                         and Frame elements ("Upload a picture")

   NO CHROME HERE. App Hosting has no browser, so the server never draws a post: the html route hands the
   template's HTML (and its caption) to the browser, which draws it (promo-studio/oneworld-social.js). Every
   picture the posts use is a public address the image proxy (lib/promo.js imageUrlProblem) allows.

   THE EVENT. The templates read the platform's EventEntity, built from Oneworld's own event by lib/promo-mailer.js
   eventFor (the mailers' adapter), plus three facts only posts need: the presenting partner (the platform's own
   rule, model/normalize.ts), the QR code's address, and the site's address only while the site is live.

   STORED (Admin SDK only; none of it is copied to a new edition, lib/api-events.js):
     events/<id>/promoSocial/art             { background, logoUnit, bg1, bg2, bg3, psd, updatedAt }
     events/<id>/promoSocialLayouts/<key>    a saved layout: base picture, elements (JSON), options, caption
     Storage events/<id>/promo-art/…         uploaded pictures — kept while the event lives, even once replaced or
                                             removed: a saved layout may still show one
     Storage events/<id>/promo-layouts/<key>/…   a layout's base picture; the others in its folder are swept after
                                             each save and reset

   EXAMPLES (lib/promo-examples.js). A card's preview may fill what the event lacks with marked example content;
   none of it may be saved, uploaded or drawn for real: every route here that takes options, elements or bytes
   refuses an example marker with 422 code 'example'. */
'use strict';
const crypto = require('crypto');
const path = require('path');
const engine = require('./vendor/promo-engine');
const promo = require('./promo');
const mailer = require('./promo-mailer');
const examples = require('./promo-examples');
const { imageInfo } = require('./logo-unit');
const { sendJson, isEventId } = require('./http');
const { logActivity } = require('./activity');

var H = null;
/* lib/api.js hands over its helpers on each call. The event these routes read is built by lib/promo-mailer.js,
   whose own helpers are set only by its own routes' wrapper: wiring it here too means a fresh instance whose first
   Promotions request is a social one still works (and promo-mailer wires lib/promo.js in turn). */
function wire(helpers) { H = helpers; mailer.wire(helpers); }

/* Every limit in one place, read at the moment it is used, so a test can lower one (the WebP step, the folder
   sweep) without making megabytes of pictures. */
var KB = 1024, MB = 1024 * 1024;
var NUMBERS = {
  uploadMax: 8 * MB,           // a raw upload: the browser already sends at most this (oneworld-social-art.js owFit)
  storeMax: 8 * MB,            // a normalised PNG larger than this is kept as WebP instead
  webpMax: 7.5 * MB,           // the WebP must load through the image proxy, which stops at 8 MiB (promo.js IMAGE_MAX_BYTES)
  webpQualities: [92, 85, 75],
  maxEdge: 3840,               // the long edge of a stored picture (the status line shows the stored size)
  maxPixels: 16777216,         // 4096²: one decoded picture at a time stays well inside an instance's 512 MiB
  htmlItems: 36,               // nine templates × four formats: the whole ZIP in one request
  elements: 400,
  elementsBytes: 900000,       // Firestore counts bytes, and a Devanagari letter is three of them
  docBytes: 1000000,           // a Firestore document holds 1 MiB; the rest is headroom for the other fields
  dataSrcLength: 300 * KB + 64,  // one pasted data: picture (the platform's placeholder is one), with its header
  dataTotal: 600 * KB,         // every data: picture of one layout together
  paramsBytes: 20000,
  paramKeys: 40,
  paramText: 2000,
  paramList: 60,
  statsRows: 12,
  elementText: 2000,
  styleLength: 400,
  captionText: 3000,
  psdName: 120
};
var CACHE = 'public, max-age=31536000, immutable';
var SLOTS = ['background', 'logoUnit', 'bg1', 'bg2', 'bg3'];
var SLOT_LABELS = { background: 'PSD background', logoUnit: 'Logo', bg1: 'Background 1', bg2: 'Background 2', bg3: 'Background 3' };
/* which source may fill which slot (the platform's three upload routes): a PSD gives the PSD background and the
   logo; a plain upload gives a numbered background or the logo */
var SLOT_FROM = { background: ['psd'], logoUnit: ['psd', 'upload'], bg1: ['upload'], bg2: ['upload'], bg3: ['upload'] };

var EXAMPLE_REFUSED = 'Example content cannot be saved, downloaded or sent. Add the event\'s own speakers, partners and details, then try again.';
var NOT_A_PICTURE = 'That file is not a picture Oneworld can read. Upload a PNG, JPG, WebP, GIF, AVIF, TIFF or SVG.';
var TOO_MANY_PIXELS = 'That picture is too large to use (more than 16 million pixels). Make it smaller and upload it again.';
var TOO_LARGE_UPLOAD = 'That upload is too large.';
var TOO_LARGE_STORED = 'That picture is too large to keep, even compressed. Make it smaller and upload it again.';
var LAYOUT_CHANGED = 'This layout was changed by someone else meanwhile. Reload it, then save again.';
var LAYOUT_TOO_LARGE = 'This layout is too large to save. Remove some pictures or text and save again.';
var NOT_THIS_LAYOUT = 'That picture is not this layout\'s.';
/* the picture-address rule (owner O2 = c): the editor says the same when an address is pasted */
var PICTURE_REFUSED = 'Oneworld can only use pictures from this event\'s own files or ET\'s image servers. Use Insert → speakers or sponsors, or use Upload a picture.';
var QR_LABEL = 'Scan to register';

function httpErr(status, message, extra) { var e = new Error(message); e.status = status; e.body = Object.assign({ error: message }, extra || {}); return e; }
function exampleErr() { return httpErr(422, EXAMPLE_REFUSED, { code: 'example' }); }
function own(table, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key); }
function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function queryOf(req) { return new URLSearchParams(String(req.url || '').split('?')[1] || ''); }
function fail(res, what, err) { H.sendFailure(res, 'promo social ' + what, err, 'Something went wrong with the posts. Please try again.'); }
/* A raw upload refused before its body was all read is answered only once the rest has arrived (read and thrown
   away). Answered earlier, the server stops reading while the browser is still sending: the browser then sees a
   stalled or reset upload ("Failed to fetch") instead of the answer. Never req.destroy(), for the same reason. */
function drainThen(req, fn) {
  var done = false;
  var go = function () { if (!done) { done = true; fn(); } };
  if (req.readableEnded || req.complete) return go();
  req.on('end', go);
  req.on('error', go);
  req.on('close', go);
  try { req.resume(); } catch (e) { go(); }
}
function newName() { return Date.now().toString(36) + '-' + crypto.randomBytes(8).toString('hex'); }
function publicUrl(bucket, objectPath) { return 'https://storage.googleapis.com/' + bucket + '/' + objectPath; }
function notFound(err) { return !!err && (err.code === 404 || err.code === '404'); }
function byOf(decoded) { return (decoded && decoded.email) || ''; }

/* ---------- the event, as the templates read it ---------- */

/* -> { ev, stored, kit }: the mailers' event, plus what posts need of their own */
function socialEventFor(fb, eventId, req) {
  return mailer.eventFor(fb, eventId, req).then(function (got) {
    var ev = Object.assign({}, got.ev), ke = (got.kit && got.kit.event) || {};
    var published = got.kit && got.kit.event ? ke.published === true : !!(got.stored && got.stored.published === true);
    /* the platform's presenter rule (model/normalize.ts): the first partner of a "presenting" or "title" tier, else
       the portal's own name */
    var tier = (ev.sponsorTiers || []).filter(function (t) { return /presenting|title/i.test(String(t.tier || '')); })[0];
    var first = tier && tier.sponsors && tier.sponsors[0];
    var title = first ? first.title : undefined;
    ev.presenter = title != null ? title : engine.getBrand(ev.portal).presenter;
    /* the QR code points where Oneworld's own posts point it (promo-posts.js linkOf): the registration form of a
       site that is live, else nowhere — a code must never lead to a page that does not open */
    ev.qrUrl = published ? String(ke.registerUrl || ke.siteUrl || ev.ctaUrl || '') : '';
    /* "Website ↗" only for a site that is live */
    ev.micrositeUrl = published ? ev.micrositeUrl : undefined;
    return { ev: ev, stored: got.stored || {}, kit: got.kit || null, published: published };
  });
}

/* The two options every template gets while the site is published (owner O2's QR merge). The platform's form
   drops an empty value before the defaults are put back (index.html collectParams; registry.ts resolveParams),
   so "clear the caption to remove the code" cannot work there: a select does it. */
function qrOptions(qrUrl) {
  return [
    { key: 'qr', label: 'QR code', type: 'select', default: 'on',
      options: [{ value: 'on', label: 'Show the QR code' }, { value: 'off', label: 'No QR code' }],
      hint: 'Points to ' + qrUrl + '. Shown only while the site is published.' },
    { key: 'qrLabel', label: 'QR code caption', type: 'text', default: QR_LABEL,
      hint: 'Leave it empty for “' + QR_LABEL + '”. To leave the QR code out, choose No QR code.' }
  ];
}

/* the site's address as a QR code, drawn exactly as Oneworld's own posts draw theirs (promo-posts.js qrSvg): UTF-8,
   the smallest version that fits, error correction M (it still reads with a scuff or a glare), a quiet margin of 2,
   one dark path on a white square, crisp edges — as a data: picture, so the browser draws it with no request */
var qrLib = null, qrCache = new Map();
function qrDataUri(url) {
  url = String(url || '');
  if (!url) return '';
  if (qrCache.has(url)) return qrCache.get(url);
  var out = '';
  try {
    if (!qrLib) qrLib = require(path.join(__dirname, '..', '..', 'assets', 'vendor', 'qrcode-generator.js'));
    var Q = qrLib;
    if (Q.stringToBytesFuncs && Q.stringToBytesFuncs['UTF-8']) Q.stringToBytes = Q.stringToBytesFuncs['UTF-8'];
    var q = Q(0, 'M'); q.addData(url); q.make();
    var n = q.getModuleCount(), quiet = 2, size = n + quiet * 2, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
    var esc = String(url).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size * 8 + '" height="' + size * 8 + '" viewBox="0 0 ' + size + ' ' + size +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code: ' + esc + '"><rect width="' + size + '" height="' + size +
      '" fill="#ffffff"/><path d="' + d + '" fill="#111111"/></svg>';
    out = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  } catch (err) {
    /* an address too long for any QR code: the post goes out without one, as Oneworld's own posts do */
    console.error('promo-social: no QR code could be drawn for ' + url.slice(0, 200) + ' — ' + (err && err.message || err));
    out = '';
  }
  if (qrCache.size >= 64) qrCache.delete(qrCache.keys().next().value);
  qrCache.set(url, out);
  return out;
}

/* ---------- uploaded pictures ---------- */

function artRef(fb, eventId) { return fb.db.collection('events').doc(eventId).collection('promoSocial').doc('art'); }
function unitOf(u) { return u && typeof u === 'object' && typeof u.url === 'string' && u.url ? u : null; }
/* change some top-level fields of a document inside a transaction. update() replaces each named field whole; a set
   with merge would merge a picture's record into the one it replaces, keeping any field the new one lacks. */
function writePatch(t, ref, snap, patch) { if (snap.exists) t.update(ref, patch); else t.set(ref, patch); }

/* which pictures a render uses (the platform's getAssets, store.ts:91-101, without its portal-wide default, which
   no screen ever wrote): the chosen numbered background when it is there, else the PSD's; the logo when there is one */
function artFor(doc, bg) {
  doc = doc || {};
  var b = String(bg == null ? '' : bg);
  var slot = (b === '1' || b === '2' || b === '3') ? unitOf(doc['bg' + b]) : null;
  var background = slot || unitOf(doc.background);
  var logo = unitOf(doc.logoUnit);
  var out = {};
  if (background) out.backgroundUrl = background.url;
  if (logo) out.logoUnitUrl = logo.url;
  return out;
}

/* GET art's answer: the platform's booleans (store.ts assetStatus), plus each picture and the last PSD's size */
function artAnswer(doc) {
  doc = doc || {};
  var out = { units: {}, psd: null };
  SLOTS.forEach(function (s) {
    var u = unitOf(doc[s]);
    out[s] = !!u;
    if (u) out.units[s] = { url: u.url, width: u.width, height: u.height, from: u.from, at: u.at };
  });
  if (doc.psd && typeof doc.psd === 'object') out.psd = { canvasWidth: doc.psd.canvasWidth, canvasHeight: doc.psd.canvasHeight, at: doc.psd.at };
  return out;
}

/* sharp is an optional native module, loaded on first use with the settings lib/pictures.js uses: nothing cached
   between pictures, one thread. A test may hand in a stand-in (setSharp). */
var sharpModule, sharpOverride = null;
function loadSharp() {
  if (sharpOverride) return sharpOverride;
  if (sharpModule === undefined) {
    try {
      sharpModule = require('sharp');
      sharpModule.cache(false);
      sharpModule.concurrency(1);
    } catch (e) {
      sharpModule = null;
      console.error('promo-social: pictures cannot be read here (sharp) — ' + e.message);
    }
  }
  return sharpModule;
}

/* One picture at a time per instance (lib/pictures.js serially): a decoded picture holds its pixels in memory, and
   two admins uploading at once — or a PSD's background and logo arriving back to back — must not hold two. */
var queue = Promise.resolve();
function serially(job) {
  var run = queue.then(job, job);
  queue = run.then(function () {}, function () {});
  return run;
}

/* raw bytes -> { data, type, ext, width, height }: turned upright, no larger than NUMBERS.maxEdge on its long
   edge, a PNG — or WebP when the PNG would be over NUMBERS.storeMax, stepping the quality down until it fits the
   image proxy. trim: null, 'default' (an uploaded logo: the platform's sharp().trim(), untrimmed when that fails)
   or 'psd' (a PSD's logo: trim({ threshold: 1 }), the platform's psd/extract.ts). */
function normalise(raw, trim) {
  return serially(function () {
    var sharp = loadSharp();
    if (!sharp) throw httpErr(503, 'Pictures cannot be stored right now. Please try again in a little while.');
    var opts = { limitInputPixels: NUMBERS.maxPixels, sequentialRead: true };
    return Promise.resolve().then(function () { return sharp(raw).metadata(); }).then(function (m) {
      var w = +m.width || 0, h = +(m.pageHeight || m.height) || 0;
      if (!w || !h) throw httpErr(400, NOT_A_PICTURE);
      if (w * h > NUMBERS.maxPixels) throw httpErr(400, TOO_MANY_PIXELS);
    }, function (err) {
      throw /pixel limit/i.test(String(err && err.message)) ? httpErr(400, TOO_MANY_PIXELS) : httpErr(400, NOT_A_PICTURE);
    }).then(function () {
      var fit = { width: NUMBERS.maxEdge, height: NUMBERS.maxEdge, fit: 'inside', withoutEnlargement: true };
      var plain = function () { return sharp(raw, opts).rotate().resize(fit).png().toBuffer({ resolveWithObject: true }); };
      var first = trim ? sharp(raw, opts).rotate().trim(trim === 'psd' ? { threshold: 1 } : undefined).resize(fit).png().toBuffer({ resolveWithObject: true }).then(null, plain)
        : plain();
      return first.then(null, function (err) {
        throw /pixel limit/i.test(String(err && err.message)) ? httpErr(400, TOO_MANY_PIXELS) : httpErr(400, NOT_A_PICTURE);
      });
    }).then(function (png) {
      var info = png.info || {};
      if (png.data.length <= NUMBERS.storeMax) return { data: png.data, type: 'image/png', ext: 'png', width: info.width, height: info.height };
      /* a photograph as a PNG of 3840 px can pass 30 MB: kept as WebP, the first quality that fits */
      var qs = NUMBERS.webpQualities.slice();
      var step = function () {
        if (!qs.length) throw httpErr(400, TOO_LARGE_STORED);
        var q = qs.shift();
        return sharp(png.data, { limitInputPixels: false }).webp({ quality: q }).toBuffer({ resolveWithObject: true }).then(function (wp) {
          if (wp.data.length <= NUMBERS.webpMax) return { data: wp.data, type: 'image/webp', ext: 'webp', width: wp.info.width || info.width, height: wp.info.height || info.height };
          return step();
        });
      };
      return step();
    });
  });
}

/* the whole body of a raw upload as one Buffer, or a 413 once it has all arrived (what is past the limit is read
   and thrown away, never kept; see drainThen) */
function readRaw(req, limit) {
  return new Promise(function (resolve, reject) {
    if (Buffer.isBuffer(req.rawBody)) {
      if (req.rawBody.length > limit) return reject(httpErr(413, TOO_LARGE_UPLOAD));
      return resolve(req.rawBody);
    }
    var declared = parseInt(req.headers && req.headers['content-length'], 10);
    var tooLarge = declared > limit;
    /* one buffer of the announced size, filled as the bytes come; chunks only when no size was announced */
    var buf = !tooLarge && declared > 0 ? Buffer.allocUnsafe(declared) : null, chunks = [], size = 0, done = false;
    req.on('data', function (c) {
      if (done || tooLarge) return;
      if (size + c.length > limit) { tooLarge = true; buf = null; chunks = []; return; }
      if (buf && size + c.length > buf.length) { chunks.push(buf.subarray(0, size)); buf = null; }
      if (buf) c.copy(buf, size); else chunks.push(c);
      size += c.length;
    });
    req.on('end', function () {
      if (done) return;
      done = true;
      if (tooLarge) return reject(httpErr(413, TOO_LARGE_UPLOAD));
      resolve(buf ? buf.subarray(0, size) : Buffer.concat(chunks, size));
    });
    req.on('error', function () { if (!done) { done = true; reject(httpErr(400, 'The upload did not come through.')); } });
  });
}

/* Pixels are never example content (the example pictures are never uploaded, plan §5h), but a picture made of
   text — an SVG — can carry an example address or id in its markup, and is refused like any other example
   content. A raster file is not searched: its compressed bytes would only ever match by chance. */
function bytesAreExample(raw) {
  if (raw.subarray(0, 4096).indexOf(0) !== -1) return false;
  return examples.isExample(raw.toString('utf8'));
}

function storePublic(fb, objectPath, data, contentType) {
  var file = fb.bucket.file(objectPath);
  return file.save(data, { resumable: false, metadata: { contentType: contentType, cacheControl: CACHE } })
    .then(function () { return file.makePublic(); })
    .then(function () { return publicUrl(fb.bucket.name, objectPath); });
}

/* ---------- the routes: catalog and HTML ---------- */

/* an admin request with a JSON body, its event id checked: cb(fb, decoded, body, eventId) */
function withEvent(req, res, limit, cb) {
  H.withAdminBody(req, res, limit, function (fb, decoded, body) {
    var eventId = H.eventIdOr400(res, body.eventId);
    if (eventId) cb(fb, decoded, body, eventId);
  });
}
/* an admin request whose event id is in the query: cb(fb, decoded, q, eventId). raw: the request carries an
   upload, so a refused id is answered once that upload has arrived (drainThen). */
function withQueryEvent(req, res, cb, raw) {
  H.withAdmin(req, res, function (fb, decoded) {
    var q = queryOf(req), id = q.get('eventId');
    if (raw && !isEventId(String(id == null ? '' : id).trim())) return drainThen(req, function () { H.eventIdOr400(res, id); });
    var eventId = H.eventIdOr400(res, id);
    if (eventId) cb(fb, decoded, q, eventId);
  });
}
/* a raw route's refusal, once its upload has arrived */
function refuseRaw(req, res, status, body) { drainThen(req, function () { sendJson(res, status, body); }); }

/* GET /api/promo/social/catalog?eventId= — the platform's /api/catalog (server.ts:260-275) */
function handleCatalog(req, res) {
  withQueryEvent(req, res, function (fb, decoded, q, eventId) {
    Promise.all([H.loadLiveEvent(fb, eventId), socialEventFor(fb, eventId, req)]).then(function (r) {
      var got = r[1], ev = got.ev;
      return Promise.resolve(engine.buildCatalog(ev)).then(function (catalog) {
        if (ev.qrUrl) {
          catalog.categories.forEach(function (c) {
            c.templates.forEach(function (t) { t.params = t.params.concat(qrOptions(ev.qrUrl)); });
          });
        }
        sendJson(res, 200, {
          event: {
            name: ev.name, hashtag: ev.hashtag, edition: ev.edition, dateLabel: ev.dateLabel, venue: ev.venue || ev.city,
            counts: { speakers: ev.speakers.length, sponsorTiers: ev.sponsorTiers.length, sessions: ev.sessions.length },
            micrositeUrl: ev.micrositeUrl, link: ev.qrUrl, published: got.published
          },
          /* FORMATS[f] already carries its id (the platform's own note) */
          formats: engine.DEFAULT_FORMATS.map(function (f) { return Object.assign({}, engine.FORMATS[f]); }),
          catalog: catalog
        });
      });
    }).catch(function (err) { fail(res, 'catalog', err); });
  });
}

/* one item of the html route: { templateId, format, width, height, caption, html?, example?, filled?, state? } or
   { templateId, format, error, missing? }. ctx: { ev, art, brand, captionOnly, base } */
function renderItem(item, ctx) {
  var id = String((item && item.templateId) || '').slice(0, 80);
  var fmtId = String((item && item.format) || '');
  var tpl = engine.getTemplate(id);
  if (!tpl) return { templateId: id, format: fmtId, error: 'unknown template' };
  /* the platform's fallback (server.ts:415), looked up as the format's own entry: "constructor" is not a format */
  var fmt = own(engine.FORMATS, fmtId) ? engine.FORMATS[fmtId] : engine.FORMATS.ig_portrait;
  var params = isPlainObject(item.params) ? item.params : {};
  var ev = ctx.ev, out = { templateId: tpl.id, format: fmt.id, width: fmt.width, height: fmt.height };
  var filled = [], state = '';
  if (item.preview === true) {
    /* a card's preview: only the gap filled, with marked examples (owner B) */
    var f = examples.fillFor(tpl.id, ev, params, { base: ctx.base }) || {};
    filled = Array.isArray(f.filled) ? f.filled : [];
    state = f.state ? String(f.state) : '';
    if (state && !filled.length) {
      /* a gap of the event's state (no date or venue yet): the real event, drawn without what it lacks */
    } else {
      ev = f.ev || ev;
      params = isPlainObject(f.params) ? f.params : params;
      var after = tpl.requires(ev);
      if (!after.ok) return { templateId: tpl.id, format: fmt.id, error: 'needs ' + after.missing.join(', '), missing: after.missing };
    }
  } else {
    var avail = tpl.requires(ev);
    /* the platform answered a render it could not make with a 500; Oneworld says what is missing */
    if (!avail.ok) return { templateId: tpl.id, format: fmt.id, error: 'needs ' + avail.missing.join(', '), missing: avail.missing };
  }
  var p = engine.resolveParams(tpl, params);
  var assets = artFor(ctx.art, params.bg);
  if (ev.qrUrl && p.qr !== 'off') {
    var code = qrDataUri(ev.qrUrl);
    if (code) {
      assets.qrUrl = code;
      assets.qrLabel = String(p.qrLabel == null ? '' : p.qrLabel).trim().slice(0, 60) || QR_LABEL;
    }
  }
  var tctx = { event: ev, brand: ctx.brand, format: fmt, params: p, assets: assets };
  /* the caption exactly as the template writes it, not trimmed (server.ts:464). A preview with examples in it has
     none: that caption would name the example people in plain words, with no marker isExample could find, and no
     card reads it (the Caption tab and the ZIP ask without preview). */
  out.caption = filled.length ? '' : tpl.caption(tctx);
  if (!ctx.captionOnly) {
    var html = tpl.render(tctx);
    out.html = filled.length ? examples.markPostHtml(html, filled) : html;
  }
  if (item.preview === true) {
    out.example = filled.length > 0;
    out.filled = filled;
    if (state) out.state = state;
  }
  return out;
}

/* POST /api/promo/social/html — the template's HTML and caption for each item, for the browser to draw: the
   platform's /api/preview, /api/download and /api/editor/load (server.ts:389-471, 614-640) without the drawing */
function handleHtml(req, res) {
  withEvent(req, res, H.BODY_LIMITS.small, function (fb, decoded, body, eventId) {
    var items = body.items;
    if (!Array.isArray(items) || !items.length || items.length > NUMBERS.htmlItems) {
      return sendJson(res, 400, { error: 'Ask for 1 to ' + NUMBERS.htmlItems + ' posts at a time.' });
    }
    /* options a request sends are the user's own; example content in them would be drawn as if it were real */
    if (items.some(function (it) { return it && examples.isExample(it.params); })) return sendJson(res, 422, exampleErr().body);
    Promise.all([H.loadLiveEvent(fb, eventId), socialEventFor(fb, eventId, req), artRef(fb, eventId).get()]).then(function (r) {
      var ev = r[1].ev, art = r[2].exists ? r[2].data() : {};
      var ctx = { ev: ev, art: art, brand: engine.getBrand(ev.portal), captionOnly: body.captionOnly === true, base: H.publicBaseFor(req) };
      var out = items.map(function (item) {
        try { return renderItem(item, ctx); }
        catch (err) {
          /* one template that throws costs its own item, never the other 35 */
          console.error('promo-social: a post could not be made (' + String(item && item.templateId).slice(0, 80) + ') — ' + (err && err.stack || err));
          return { templateId: String((item && item.templateId) || '').slice(0, 80), format: String((item && item.format) || '').slice(0, 40), error: 'render failed' };
        }
      });
      sendJson(res, 200, { items: out });
    }).catch(function (err) { fail(res, 'html', err); });
  });
}

/* ---------- the routes: uploaded pictures ---------- */

/* GET /api/promo/social/art?eventId= — the platform's /api/assets (server.ts:485-489) */
function handleArt(req, res) {
  withQueryEvent(req, res, function (fb, decoded, q, eventId) {
    Promise.all([H.loadLiveEvent(fb, eventId), artRef(fb, eventId).get()]).then(function (r) {
      sendJson(res, 200, artAnswer(r[1].exists ? r[1].data() : {}));
    }).catch(function (err) { fail(res, 'art', err); });
  });
}

/* POST /api/promo/social/art?eventId=&slot=&from= — the platform's /api/background, /api/logo and the units of
   /api/psd (server.ts:492-523; store.ts:62-80). The previous picture of the slot is kept in Storage: a saved
   layout may still show it (its image element holds that address). */
function handleArtUpload(req, res) {
  withQueryEvent(req, res, function (fb, decoded, q, eventId) {
    var slot = String(q.get('slot') || ''), from = String(q.get('from') || '');
    if (!own(SLOT_FROM, slot) || SLOT_FROM[slot].indexOf(from) === -1) return refuseRaw(req, res, 400, { error: 'unknown slot' });
    H.loadLiveEvent(fb, eventId).then(function () {
      return readRaw(req, NUMBERS.uploadMax);
    }).then(function (raw) {
      if (!raw.length) throw httpErr(400, 'empty upload');
      if (bytesAreExample(raw)) throw exampleErr();
      var trim = slot === 'logoUnit' ? (from === 'psd' ? 'psd' : 'default') : null;
      return normalise(raw, trim);
    }).then(function (pic) {
      var objectPath = 'events/' + eventId + '/promo-art/' + slot + '-' + newName() + '.' + pic.ext;
      return storePublic(fb, objectPath, pic.data, pic.type).then(function (url) {
        var unit = { url: url, path: objectPath, width: pic.width, height: pic.height, bytes: pic.data.length, type: pic.type,
          from: from, at: Date.now(), by: byOf(decoded) };
        var ref = artRef(fb, eventId);
        /* read, change one slot, write: a PSD's summary that runs meanwhile sees this picture, never an older one */
        return fb.db.runTransaction(function (t) {
          return t.get(ref).then(function (snap) {
            var patch = { updatedAt: unit.at };
            patch[slot] = unit;
            writePatch(t, ref, snap, patch);
          });
        }).then(function () { return unit; });
      });
    }).then(function (unit) {
      var size = { width: unit.width, height: unit.height, bytes: unit.bytes };
      /* the platform's answers: a numbered background says its slot (store.ts:69), the logo does not (:79) */
      sendJson(res, 200, /^bg[123]$/.test(slot) ? Object.assign({ ok: true, slot: slot.slice(2) }, size) : Object.assign({ ok: true }, size));
      logActivity(fb, eventId, decoded, 'updated', 'Post art: ' + (slot === 'logoUnit' && from === 'psd' ? 'Logo from the PSD' : SLOT_LABELS[slot]) + ' uploaded', { area: 'promotions' });
    }).catch(function (err) { drainThen(req, function () { fail(res, 'art upload', err); }); });
  }, true);
}

/* POST /api/promo/social/art/psd — what the browser found in a PSD it read itself (the PSD never leaves the
   browser): its name and size are kept, and a PSD-made picture this PSD did not produce is cleared. A logo that
   was uploaded on its own stays. (The platform also kept the PSD's layer table; nothing ever read it.) */
function handleArtPsd(req, res) {
  withEvent(req, res, H.BODY_LIMITS.tiny, function (fb, decoded, body, eventId) {
    if (examples.isExample(body)) return sendJson(res, 422, exampleErr().body);
    var found = body.found, w = +body.canvasWidth, h = +body.canvasHeight, bytes = +body.bytes;
    if (!isPlainObject(found) || typeof found.background !== 'boolean' || typeof found.logoUnit !== 'boolean' ||
        !(Number.isInteger(w) && w > 0 && w <= 300000) || !(Number.isInteger(h) && h > 0 && h <= 300000) ||
        !(Number.isFinite(bytes) && bytes >= 0)) {
      return sendJson(res, 400, { error: 'The PSD\'s summary could not be read. Upload the PSD again.' });
    }
    var name = String(body.name == null ? '' : body.name).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, NUMBERS.psdName);
    var ref = artRef(fb, eventId), now = Date.now();
    H.loadLiveEvent(fb, eventId).then(function () {
      return fb.db.runTransaction(function (t) {
        return t.get(ref).then(function (snap) {
          var doc = snap.exists ? (snap.data() || {}) : {};
          var patch = { psd: { name: name, bytes: Math.round(bytes), canvasWidth: w, canvasHeight: h, at: now, by: byOf(decoded) }, updatedAt: now };
          var cleared = [];
          ['background', 'logoUnit'].forEach(function (s) {
            var u = unitOf(doc[s]);
            if (!found[s] && u && u.from === 'psd') { patch[s] = null; cleared.push(s); }
          });
          writePatch(t, ref, snap, patch);
          var after = Object.assign({}, doc, patch);
          return { after: after, cleared: cleared };
        });
      });
    }).then(function (r) {
      var sizeOf = function (s) { var u = unitOf(r.after[s]); return found[s] && u && u.from === 'psd' ? { width: u.width, height: u.height } : null; };
      sendJson(res, 200, { ok: true, background: sizeOf('background'), logoUnit: sizeOf('logoUnit') });
      r.cleared.forEach(function (s) {
        logActivity(fb, eventId, decoded, 'deleted', 'Post art: ' + (s === 'logoUnit' ? 'Logo from the PSD' : SLOT_LABELS[s]) + ' cleared by a new PSD', { area: 'promotions' });
      });
    }).catch(function (err) { fail(res, 'psd', err); });
  });
}

/* DELETE /api/promo/social/art?eventId=&slot= — Remove (new in Oneworld). Idempotent. The object stays in
   Storage: a saved layout may still show it. */
function handleArtDelete(req, res) {
  withQueryEvent(req, res, function (fb, decoded, q, eventId) {
    var slot = String(q.get('slot') || '');
    if (SLOTS.indexOf(slot) === -1) return sendJson(res, 400, { error: 'unknown slot' });
    var ref = artRef(fb, eventId);
    H.loadLiveEvent(fb, eventId).then(function () {
      return fb.db.runTransaction(function (t) {
        return t.get(ref).then(function (snap) {
          var doc = snap.exists ? (snap.data() || {}) : {};
          if (!unitOf(doc[slot])) return false;
          var patch = { updatedAt: Date.now() };
          patch[slot] = null;
          writePatch(t, ref, snap, patch);
          return true;
        });
      });
    }).then(function (removed) {
      sendJson(res, 200, { ok: true, removed: removed });
      if (removed) logActivity(fb, eventId, decoded, 'deleted', 'Post art: ' + SLOT_LABELS[slot] + ' removed', { area: 'promotions' });
    }).catch(function (err) { fail(res, 'art delete', err); });
  });
}

/* POST /api/promo/social/picture?eventId= — a picture for one Image or Frame element of the layout editor
   ("Upload a picture", owner O2 = c): kept like a numbered background, under this event's own folder, so the
   image proxy loads it and a saved layout may point at it. It is not one of the posts' art slots. */
function handlePicture(req, res) {
  withQueryEvent(req, res, function (fb, decoded, q, eventId) {
    H.loadLiveEvent(fb, eventId).then(function () {
      return readRaw(req, NUMBERS.uploadMax);
    }).then(function (raw) {
      if (!raw.length) throw httpErr(400, 'empty upload');
      if (bytesAreExample(raw)) throw exampleErr();
      return normalise(raw, null);
    }).then(function (pic) {
      var objectPath = 'events/' + eventId + '/promo-art/picture-' + newName() + '.' + pic.ext;
      return storePublic(fb, objectPath, pic.data, pic.type).then(function (url) {
        sendJson(res, 200, { ok: true, url: url, width: pic.width, height: pic.height, bytes: pic.data.length });
        logActivity(fb, eventId, decoded, 'updated', 'Post picture uploaded', { area: 'promotions' });
      });
    }).catch(function (err) { drainThen(req, function () { fail(res, 'picture', err); }); });
  }, true);
}

/* ---------- the routes: saved layouts ---------- */

/* The platform's key (server.ts:609, layouts.ts:8-11): template, format, theme and background choice */
function layoutKey(templateId, format, theme, bg) { return templateId + '__' + format + '__' + (theme || 'dark') + '_bg' + (bg || 'psd'); }
/* -> { tpl, fmt, theme, bg, key } or an error sentence. Every part is checked against its own list: the key
   becomes a Firestore document id and a Storage folder. */
function keyParts(templateId, format, theme, bg) {
  var tpl = engine.getTemplate(String(templateId || ''));
  if (!tpl) return 'unknown template';
  var f = String(format || '');
  if (!own(engine.FORMATS, f) || tpl.formats.indexOf(f) === -1) return 'unknown format';
  var th = theme == null || theme === '' ? 'dark' : String(theme);
  if (th !== 'dark' && th !== 'light') return 'unknown theme';
  var b = bg == null ? '' : String(bg);
  if (['', '1', '2', '3'].indexOf(b) === -1) return 'unknown background';
  return { tpl: tpl, fmt: engine.FORMATS[f], theme: th, bg: b, key: layoutKey(tpl.id, f, th, b) };
}
function parseKey(key) {
  var m = /^([a-z]+\.[a-z0-9-]+)__([a-z_]+)__(dark|light)_bg(psd|1|2|3)$/.exec(String(key || ''));
  if (!m) return 'unknown layout';
  var k = keyParts(m[1], m[2], m[3], m[4] === 'psd' ? '' : m[4]);
  return typeof k === 'string' || k.key !== key ? 'unknown layout' : k;
}
function layoutRef(fb, eventId, key) { return fb.db.collection('events').doc(eventId).collection('promoSocialLayouts').doc(key); }
function layoutFolder(eventId, key) { return 'events/' + eventId + '/promo-layouts/' + key + '/'; }
/* the object a base address names, when it is one of this layout's own base pictures — else '' */
function basePathOf(url, bucket, eventId, key) {
  var prefix = 'https://storage.googleapis.com/' + bucket + '/' + layoutFolder(eventId, key);
  var s = String(url || '');
  if (!bucket || s.indexOf(prefix) !== 0) return '';
  var name = s.slice(prefix.length);
  return /^[0-9a-z]{1,12}-[0-9a-f]{16}\.(png|webp)$/.test(name) ? layoutFolder(eventId, key) + name : '';
}
/* the import an imported site was made from (the same rule as lib/promo.js importIdOf): its pictures live in that
   import's folder, which the image proxy allows for this event only */
function importIdOf(stored) {
  var m = /^imported-([a-z0-9][a-z0-9-]{0,59})$/.exec(String((stored && (stored.templateId || (stored.site && stored.site.templateId))) || ''));
  return m ? m[1] : '';
}
function urlProblem(src, bucket, eventId, importId) {
  var fn = promo.imageUrlProblem || (promo._test && promo._test.imageUrlProblem);
  /* the rule cannot be read: no address passes (a saved layout must never point the console anywhere) */
  if (typeof fn !== 'function') return 'Pictures cannot be checked right now.';
  return fn(src, bucket, eventId, importId);
}

var NUMBER_FIELDS = ['x', 'y', 'w', 'h', 'rotate', 'fontSize', 'imgScale', 'imgX', 'imgY', 'imgRotate'];
var STYLE_FIELDS = ['fontWeight', 'fontStyle', 'color', 'textAlign', 'lineHeight', 'letterSpacing', 'textTransform', 'textShadow',
  'whiteSpace', 'padding', 'background', 'backdropFilter', 'border', 'radius', 'boxShadow', 'objectFit', 'objectPosition', 'scrim'];
var ELEMENT_TYPES = ['text', 'image', 'shape', 'frame'];
/* What a style value may not hold. These values are written into a style attribute and set on the stage, so none
   may close the attribute (" and, defensively, < >), load anything (url(, and no quote at all: a CSS string can
   name a picture through image-set()), hide such a thing in an escape (\), or run anything. Computed styles never
   hold any of it; the font family, which does hold quotes, is checked on its own. */
var BAD_STYLE = /["'<>\\\u0000-\u001f\u007f]|url\(|expression\(|javascript:/i;
var FONT_FAMILY = /^[A-Za-z0-9 ,'_.-]{1,200}$/;
var DATA_PICTURE = /^data:image\/(png|jpeg|webp|svg\+xml)(;charset=[A-Za-z0-9_-]+)?(;base64,[A-Za-z0-9+/=\s]*|;utf8,[\s\S]*)$/;
var OWN_ASSET = /^https?:\/\/[^/\s"'<>]+(\/(templates|assets)\/[^\s"'<>]+)$/;
var OWN_PATH = /^\/(templates|assets)\/[^\s"'<>]+$/;

/* a picture address an element may keep: an address the image proxy loads for this event, one of this app's own
   files (kept as its path, exactly as the browser's inliner treats it, oneworld.js), or a small data: picture
   (the platform's own placeholder is one). '' = refused. */
function cleanSrc(src, where) {
  var s = String(src).trim();
  if (!s) return '';
  if (/^data:/i.test(s)) return DATA_PICTURE.test(s) && s.length <= NUMBERS.dataSrcLength ? s : '';
  if (/^https:\/\//i.test(s) && !urlProblem(s, where.bucket, where.eventId, where.importId)) return s;
  var m = OWN_ASSET.exec(s);
  var p = m ? m[1] : (OWN_PATH.test(s) ? s : '');
  /* Kept only in the one form the server reads it (access.js canonicalPath): no % escape, no backslash, no . or ..
     segment and no doubled slash. The browser drops "/./" before it asks and server.js decodes "%70" to "p", so a
     path in any other form names a different file from the one these checks read: "/assets/./promo-examples/…"
     would load the example library. No file this app serves needs an escape (none has a space or such in its
     name), so one is refused rather than decoded. */
  if (!p || /[%\\\u0000]/.test(p) || path.posix.normalize(p) !== p) return '';
  return p;
}
/* the example library's pictures (owner B): never kept in a layout, in any letter case (a case-blind disk serves
   them so). Checked on the kept path as well as by isExample, so the rule holds whatever the marker test reads. */
function isExampleSrc(src) {
  var lib = String(examples.EXAMPLE_PATH || '/assets/promo-examples/').toLowerCase();
  return String(src).split(/[?#]/)[0].toLowerCase().indexOf(lib) === 0 || examples.isExample(src);
}

/* -> { list, dataBytes } with every element checked and only its known fields kept, or an httpErr */
function cleanElements(raw, where) {
  if (!Array.isArray(raw)) throw httpErr(400, 'This layout has no elements to save.');
  if (raw.length > NUMBERS.elements) throw httpErr(400, 'This layout has more than ' + NUMBERS.elements + ' elements. Remove some and save again.');
  var dataBytes = 0;
  var list = raw.map(function (el, i) {
    var bad = function (why) { return httpErr(400, 'Element ' + (i + 1) + ' of this layout cannot be saved: ' + why + '. Undo that change, or Reset the layout, then save again.'); };
    if (!isPlainObject(el)) throw bad('it is not an element');
    var out = {};
    if (typeof el.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(el.id)) throw bad('its id is not one Oneworld can keep');
    out.id = el.id;
    if (ELEMENT_TYPES.indexOf(el.type) === -1) throw bad('its kind is unknown');
    out.type = el.type;
    NUMBER_FIELDS.forEach(function (k) {
      if (el[k] == null || el[k] === '') return;
      var n = typeof el[k] === 'number' ? el[k] : (typeof el[k] === 'string' && /^-?\d+(\.\d+)?$/.test(el[k].trim()) ? +el[k] : NaN);
      if (!Number.isFinite(n) || Math.abs(n) > 100000) throw bad('its ' + k + ' is not a number Oneworld can keep');
      out[k] = n;
    });
    if (el.fontFamily != null && el.fontFamily !== '') {
      /* the browser reports a family with quotes ('Georgia, "Times New Roman", serif'); kept with single ones, so the
         value can never end the style attribute it is written into */
      var ff = String(el.fontFamily).replace(/"/g, '\'');
      if (!FONT_FAMILY.test(ff)) throw bad('its font is not one Oneworld can use');
      out.fontFamily = ff;
    }
    if (el.text != null) {
      if (typeof el.text !== 'string' && typeof el.text !== 'number') throw bad('its text is not text');
      var text = String(el.text);
      if (text.length > NUMBERS.elementText) throw bad('its text is longer than ' + NUMBERS.elementText.toLocaleString('en-US') + ' characters');
      out.text = text;
    }
    STYLE_FIELDS.forEach(function (k) {
      if (el[k] == null) return;
      if (typeof el[k] !== 'string' && typeof el[k] !== 'number') throw bad('its ' + k + ' is not a style value');
      var v = String(el[k]);
      if (v.length > NUMBERS.styleLength) throw bad('its ' + k + ' is too long');
      if (BAD_STYLE.test(v)) throw bad('its ' + k + ' holds something Oneworld does not allow in a style');
      out[k] = v;
    });
    if (el.src != null && el.src !== '') {
      if (typeof el.src !== 'string') throw bad('its picture address is not an address');
      var src = cleanSrc(el.src, where);
      if (!src) throw httpErr(400, PICTURE_REFUSED, { code: 'picture-not-allowed', element: i + 1 });
      /* the request was searched for markers before it was read; this is the address as it will be kept */
      if (isExampleSrc(src)) throw exampleErr();
      if (/^data:/i.test(src)) dataBytes += src.length;
      out.src = src;
    }
    /* the QR code's picture: dropped by the editor once the site is no longer published */
    if (el.owQr === true) out.owQr = true;
    return out;
  });
  return { list: list, dataBytes: dataBytes };
}

/* the applied options of a layout: only this template's own options (plus theme, background and the two QR
   options), each a value the platform's form could have sent */
function cleanParams(tpl, raw, k) {
  if (raw != null && !isPlainObject(raw)) throw httpErr(400, 'The post\'s options could not be read.');
  raw = raw || {};
  var types = {};
  tpl.params.forEach(function (p) { types[p.key] = p.type; });
  types.qr = 'select'; types.qrLabel = 'text';
  var out = {}, n = 0;
  /* a value as the form sends it: text (a number field's too), or a number from a template's own default */
  var text = function (key, v) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'string') throw httpErr(400, 'The option “' + key + '” cannot be saved.');
    if (v.length > NUMBERS.paramText) throw httpErr(400, 'The option “' + key + '” is longer than ' + NUMBERS.paramText.toLocaleString('en-US') + ' characters.');
    return v;
  };
  Object.keys(raw).forEach(function (key) {
    if (key === 'theme' || key === 'bg' || !own(types, key)) return;           // unknown options are dropped
    var v = raw[key];
    if (v == null) return;
    if (++n > NUMBERS.paramKeys) throw httpErr(400, 'This post has too many options to save.');
    var type = types[key];
    if (type === 'multiselect') {
      if (!Array.isArray(v) || v.length > NUMBERS.paramList) throw httpErr(400, 'The option “' + key + '” cannot be saved.');
      out[key] = v.map(function (x) { var s = text(key, x); return String(s); });
    } else if (type === 'stats') {
      if (!Array.isArray(v) || v.length > NUMBERS.statsRows) throw httpErr(400, 'The option “' + key + '” cannot be saved.');
      out[key] = v.map(function (row) {
        if (!isPlainObject(row)) throw httpErr(400, 'The option “' + key + '” cannot be saved.');
        return { value: String(text(key, row.value == null ? '' : row.value)), label: String(text(key, row.label == null ? '' : row.label)) };
      });
    } else out[key] = text(key, v);
  });
  /* the theme and background are the layout's own (they are in its key) */
  out.theme = k.theme;
  if (k.bg) out.bg = k.bg;
  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > NUMBERS.paramsBytes) throw httpErr(413, LAYOUT_TOO_LARGE);
  return out;
}

var NETWORKS = ['linkedin', 'instagram', 'x'];
function cleanCaption(raw) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) throw httpErr(400, 'The caption could not be read.');
  var network = raw.network == null || raw.network === '' ? 'linkedin' : String(raw.network);
  if (NETWORKS.indexOf(network) === -1) throw httpErr(400, 'The caption is for a network Oneworld does not know.');
  if (raw.text != null && typeof raw.text !== 'string') throw httpErr(400, 'The caption could not be read.');
  var text = raw.text == null ? null : raw.text;
  if (text != null && text.length > NUMBERS.captionText) throw httpErr(400, 'The caption is longer than ' + NUMBERS.captionText.toLocaleString('en-US') + ' characters.');
  return { network: network, text: text };
}

/* After a save or a reset, every object in the layout's folder but its committed base is deleted — the base it
   replaced, and any left by a save that failed. The objects to go are first marked on the layout's document
   (`sweeping`), in a transaction: a save still in flight whose base is one of them then fails with 409 instead of
   committing a picture that is about to be deleted, and one that committed first keeps its base, which is then
   not marked. A document left holding only the marks (after a reset) is removed at the end. Resolves the number
   of objects deleted; never rejects (the save or reset itself has already happened). */
function sweepFolder(fb, eventId, key) {
  var ref = layoutRef(fb, eventId, key);
  return fb.bucket.getFiles({ prefix: layoutFolder(eventId, key) }).then(function (r) {
    var names = (r[0] || []).map(function (f) { return f.name; });
    if (!names.length) return [];
    return fb.db.runTransaction(function (t) {
      return t.get(ref).then(function (snap) {
        var d = snap.exists ? (snap.data() || {}) : null;
        var keep = d && d.elements ? d.basePath : '';
        var doomed = names.filter(function (n) { return n !== keep; });
        /* marks left by an earlier tidy-up name objects that are gone now (they are no longer listed): replaced */
        if (doomed.length || (d && Array.isArray(d.sweeping) && d.sweeping.length)) writePatch(t, ref, snap, { sweeping: doomed });
        return doomed;
      });
    });
  }).then(function (doomed) {
    return Promise.all(doomed.map(function (n) {
      return fb.bucket.file(n).delete().then(null, function (err) { if (!notFound(err)) throw err; });
    })).then(function () {
      return fb.db.runTransaction(function (t) {
        return t.get(ref).then(function (snap) { if (snap.exists && !(snap.data() || {}).elements) t.delete(ref); });
      });
    }).then(function () { return doomed.length; });
  }).then(null, function (err) {
    console.error('promo-social: the layout folder ' + layoutFolder(eventId, key) + ' could not be tidied — ' + (err && err.stack || err));
    return 0;
  });
}

/* GET /api/promo/social/layout?eventId=&templateId=&format=&theme=&bg= — the platform's /api/editor/load for a
   saved layout (server.ts:614-621); an unsaved one is drawn in the browser from the html route */
function handleLayout(req, res) {
  withQueryEvent(req, res, function (fb, decoded, q, eventId) {
    var k = keyParts(q.get('templateId'), q.get('format'), q.get('theme'), q.get('bg'));
    if (typeof k === 'string') return sendJson(res, 400, { error: k });
    Promise.all([H.loadLiveEvent(fb, eventId), layoutRef(fb, eventId, k.key).get()]).then(function (r) {
      var d = r[1].exists ? (r[1].data() || {}) : null;
      if (!d || typeof d.elements !== 'string' || !d.baseUrl) return sendJson(res, 200, { saved: false });
      var elements;
      try { elements = JSON.parse(d.elements); } catch (e) { elements = null; }
      if (!Array.isArray(elements)) {
        console.error('promo-social: the saved layout ' + eventId + '/' + k.key + ' could not be read — drawn from the template instead');
        return sendJson(res, 200, { saved: false });
      }
      sendJson(res, 200, { saved: true, width: d.width, height: d.height, base: d.baseUrl, elements: elements,
        params: isPlainObject(d.params) ? d.params : {}, caption: d.caption || null, savedAt: d.savedAt || 0 });
    }).catch(function (err) { fail(res, 'layout', err); });
  });
}

/* POST /api/promo/social/layout/base?eventId=&key= — the layout's flattened picture, drawn in the browser at twice
   the format's size: a PNG, or WebP when the PNG would be too large to load through the image proxy */
function handleLayoutBase(req, res) {
  withQueryEvent(req, res, function (fb, decoded, q, eventId) {
    var k = parseKey(q.get('key'));
    if (typeof k === 'string') return refuseRaw(req, res, 400, { error: k });
    H.loadLiveEvent(fb, eventId).then(function () {
      return readRaw(req, NUMBERS.uploadMax);
    }).then(function (raw) {
      if (!raw.length) throw httpErr(400, 'empty upload');
      var info = imageInfo(raw);
      if (info.type !== 'png' && info.type !== 'webp') throw httpErr(400, 'A layout\'s picture must be a PNG or a WebP.');
      var w = k.fmt.width * 2, h = k.fmt.height * 2;
      if (info.width !== w || info.height !== h) throw httpErr(400, 'A layout\'s picture must be ' + w + ' × ' + h + ' px (twice the post\'s size).');
      var objectPath = layoutFolder(eventId, k.key) + newName() + '.' + info.type;
      return storePublic(fb, objectPath, raw, info.mime).then(function (url) {
        sendJson(res, 200, { url: url, width: w, height: h });
      });
    }).catch(function (err) { drainThen(req, function () { fail(res, 'layout base', err); }); });
  }, true);
}

/* POST /api/promo/social/layout — Save (the platform's /api/editor/save, server.ts:644-649). The options the layout
   was drawn with are kept too (the platform dropped them), so a reopened layout and its options match. */
function handleLayoutSave(req, res) {
  withEvent(req, res, H.BODY_LIMITS.ai, function (fb, decoded, body, eventId) {
    var k = keyParts(body.templateId, body.format, body.theme, body.bg);
    if (typeof k === 'string') return sendJson(res, 400, { error: k });
    if (examples.isExample({ elements: body.elements, params: body.params, caption: body.caption, base: body.base })) return sendJson(res, 422, exampleErr().body);
    if (+body.width !== k.fmt.width || +body.height !== k.fmt.height) return sendJson(res, 400, { error: 'This layout\'s size is not its format\'s.' });
    var bucket = fb.bucket && fb.bucket.name, ref = layoutRef(fb, eventId, k.key), base = String(body.base || '');
    var row;
    H.loadLiveEvent(fb, eventId).then(function (stored) {
      var els = cleanElements(body.elements, { bucket: bucket, eventId: eventId, importId: importIdOf(stored) });
      var params = cleanParams(k.tpl, body.params, k), caption = cleanCaption(body.caption);
      var json = JSON.stringify(els.list);
      var bytes = Buffer.byteLength(json, 'utf8');
      if (bytes > NUMBERS.elementsBytes || els.dataBytes > NUMBERS.dataTotal) throw httpErr(413, LAYOUT_TOO_LARGE);
      if (bytes + Buffer.byteLength(JSON.stringify({ params: params, caption: caption }), 'utf8') + 2 * base.length + 4096 > NUMBERS.docBytes) throw httpErr(413, LAYOUT_TOO_LARGE);
      var now = Date.now();
      return fb.db.runTransaction(function (t) {
        return t.get(ref).then(function (snap) {
          var cur = snap.exists ? (snap.data() || {}) : {};
          var sweeping = Array.isArray(cur.sweeping) ? cur.sweeping : [];
          var check;
          if (cur.elements && cur.baseUrl && base === cur.baseUrl) check = Promise.resolve(cur.basePath);
          else {
            var p = basePathOf(base, bucket, eventId, k.key);
            if (!p) throw httpErr(400, NOT_THIS_LAYOUT);
            /* about to be deleted by another save's tidy-up, or already gone: someone else saved meanwhile */
            if (sweeping.indexOf(p) !== -1) throw httpErr(409, LAYOUT_CHANGED);
            check = fb.bucket.file(p).getMetadata().then(function () { return p; }, function (err) {
              if (notFound(err)) throw httpErr(409, LAYOUT_CHANGED);
              throw err;
            });
          }
          return check.then(function (basePath) {
            row = { templateId: k.tpl.id, format: k.fmt.id, theme: k.theme, bg: k.bg, width: k.fmt.width, height: k.fmt.height,
              baseUrl: publicUrl(bucket, basePath), basePath: basePath, elements: json, params: params, caption: caption,
              savedAt: now, by: byOf(decoded) };
            /* another tidy-up's marks stay until it is done */
            if (sweeping.length) row.sweeping = sweeping;
            t.set(ref, row);
          });
        });
      });
    }).then(function () {
      return sweepFolder(fb, eventId, k.key);
    }).then(function () {
      sendJson(res, 200, { ok: true, savedAt: row.savedAt });
      logActivity(fb, eventId, decoded, 'updated', 'Post layout saved: ' + k.tpl.label + ' · ' + k.fmt.ratio, { area: 'promotions' });
    }).catch(function (err) { fail(res, 'layout save', err); });
  });
}

/* POST /api/promo/social/layout/reset — the platform's /api/editor/reset (server.ts:650-654): the saved layout and
   its pictures go; the template is drawn again from the event */
function handleLayoutReset(req, res) {
  withEvent(req, res, H.BODY_LIMITS.tiny, function (fb, decoded, body, eventId) {
    var k = keyParts(body.templateId, body.format, body.theme, body.bg);
    if (typeof k === 'string') return sendJson(res, 400, { error: k });
    var ref = layoutRef(fb, eventId, k.key);
    H.loadLiveEvent(fb, eventId).then(function () {
      /* the layout becomes a document with no elements (so nothing reads it as saved); the tidy-up then marks and
         deletes every picture of its folder, and removes the document */
      return fb.db.runTransaction(function (t) {
        return t.get(ref).then(function (snap) {
          var d = snap.exists ? (snap.data() || {}) : null;
          if (!d) return false;
          t.set(ref, Array.isArray(d.sweeping) && d.sweeping.length ? { sweeping: d.sweeping } : {});
          return !!d.elements;
        });
      });
    }).then(function (removed) {
      return sweepFolder(fb, eventId, k.key).then(function () {
        sendJson(res, 200, { ok: true, removed: removed });
        if (removed) logActivity(fb, eventId, decoded, 'deleted', 'Post layout reset: ' + k.tpl.label + ' · ' + k.fmt.ratio, { area: 'promotions' });
      });
    }).catch(function (err) { fail(res, 'layout reset', err); });
  });
}

/* the routes this file answers, for lib/api.js's ROUTES (a test checks they match) */
var ROUTES = {
  'GET /api/promo/social/catalog': 'handleCatalog',
  'GET /api/promo/social/art': 'handleArt',
  'POST /api/promo/social/art': 'handleArtUpload',
  'POST /api/promo/social/art/psd': 'handleArtPsd',
  'DELETE /api/promo/social/art': 'handleArtDelete',
  'POST /api/promo/social/html': 'handleHtml',
  'GET /api/promo/social/layout': 'handleLayout',
  'POST /api/promo/social/layout/base': 'handleLayoutBase',
  'POST /api/promo/social/layout': 'handleLayoutSave',
  'POST /api/promo/social/layout/reset': 'handleLayoutReset',
  'POST /api/promo/social/picture': 'handlePicture'
};

module.exports = {
  wire, handleCatalog, handleArt, handleArtUpload, handleArtPsd, handleArtDelete, handleHtml,
  handleLayout, handleLayoutBase, handleLayoutSave, handleLayoutReset, handlePicture, ROUTES
};
/* the pure parts and the knobs, for promo-social.test.js */
module.exports._test = {
  NUMBERS, SLOTS, socialEventFor, qrOptions, qrDataUri, artFor, artAnswer, normalise, readRaw, layoutKey, keyParts, parseKey,
  basePathOf, importIdOf, cleanSrc, cleanElements, cleanParams, cleanCaption, sweepFolder, PICTURE_REFUSED, EXAMPLE_REFUSED,
  setSharp: function (s) { sharpOverride = s || null; }
};
