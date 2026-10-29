/* Promotions → Mailers: the mail's top banner. ET's own mailers open with ONE picture, 750 px wide, that already
   holds the event's art, its logo unit, and its date and venue with calendar and pin icons — never live text over
   a background picture, which Outlook on the desktop cannot show reliably. Oneworld makes the same picture for
   each event from its site's real look (owner decision C, 2026-10-29), and every mailer but Blank leads with it.

     GET  /api/promo/mailer/banner?eventId=                  { needed, fresh, fingerprint, url | null, inputs }
     POST /api/promo/mailer/banner?eventId=&fingerprint=     raw JPEG, at most 2 MiB, exactly 1500 wide and
                                                             560–900 tall -> { ok, url, fingerprint, width, height }
                                                             409 { code: 'banner-moved' } when the event changed
                                                             while it was being drawn

   Both are admin routes on a live event; lib/api.js routes them here and hands over its helpers through wire().

   WHO DRAWS IT. The browser: there is no Chrome on App Hosting. promo-banner.js (the page's client) asks GET for
   the inputs, draws them with the posts' own "Save the date" drawing (RevampPromoPosts.banner, promo-posts.js) at
   750 px and 2× (1500 px, JPEG), and uploads the picture here. The bytes are stored exactly as the browser drew
   them: nothing is re-encoded on the server.

   THE INPUTS (inputsOf) are the part of the event's Kit (lib/promo.js buildKit) the drawing reads, in the Kit's own
   shape, so the drawing takes them as a Kit: the event's name, date and place; the site's mode, colours, fonts,
   corner radius, hero picture and logo unit (with its copy for a dark ground). All of it is the event's real data:
   a date or a venue the event does not have is '' and is simply left out of the picture, never made up, and no
   example content is ever read here. The banner is NEEDED only when the site has a hero picture: without one the
   mail keeps today's logo bar and colour band.

   THE FINGERPRINT is the first 32 hex of the SHA-256 of the inputs as canonical JSON (keys sorted), with
   BANNER_VERSION among them, less the two things one server instance can see differently from another (the logo
   unit's measured width and height, and a Google Fonts address's checked form: see fingerprinted()). The stored
   banner is FRESH while its fingerprint is the one the event has now; any change to a name, date, venue, colour,
   font, picture or logo makes it stale, and a new drawing (BANNER_VERSION bumped) makes every banner stale.
   lib/promo-mailer.js asks stateFor() for each mail it builds: it puts a fresh
   banner into the mail, refuses every download, copy and export while the banner is stale (409 'banner-stale';
   the studio then asks the page to draw it again and retries), and points saved mails at the current banner
   (isBannerUrl tells it which of their pictures are this event's banners).

   STORAGE. events/<id>/promo-banner/<fingerprint 16>-<base36 time>-<16 hex>.jpg, public, cached for a year (the
   name is never reused). Banner objects are never deleted while the event lives: every mail ever sent points at
   its own. The only pictures removed are ones nothing can point at, because no record ever named them and their
   address was never answered: one that could not be made public, and one whose upload was found 'moved' or its
   event gone. The record is one document, events/<id>/promoBanner/current: { fingerprint, url, path, width, height,
   bytes, at, by } (`by` is never returned). A new edition copies neither (lib/api-events.js). */
'use strict';
const crypto = require('crypto');
const promo = require('./promo');
const { sendJson, isEventId } = require('./http');

var H = null;
/* lib/api.js hands over its helpers on each call, as it does for lib/promo.js and lib/promo-mailer.js. buildKit
   (lib/promo.js) reads them too, so they are passed on. */
function wire(helpers) { H = helpers; promo.wire(helpers); }

/* Bumped whenever the drawing changes (promo-posts.js banner(), or what is read for it here): the fingerprint
   carries it, so every event's banner is then drawn again with the new drawing. */
var BANNER_VERSION = 1;

var MAX_BYTES = 2 * 1024 * 1024;          // a mail picture: the client re-encodes once at a lower quality above this
var WIDTH = 1500;                         // 750 px in the mail, drawn at 2×
var MIN_HEIGHT = 560, MAX_HEIGHT = 900;   // 280–450 px in the mail; the drawing clamps itself to 320–440
var FOLDER = 'promo-banner';
var STORAGE = 'https://storage.googleapis.com/';
var CACHE = 'public, max-age=31536000, immutable';
var FINGERPRINT_RE = /^[0-9a-f]{32}$/;
var COLOUR_KEYS = ['theme', 'accent', 'background', 'surface', 'text', 'muted', 'heading', 'onTheme'];   // the Kit's (promo-kit.js)

var SHAPE_ERROR = 'The mail banner must be a JPEG picture 1500 pixels wide and 560 to 900 pixels tall. Reload the page and try again.';
var MOVED_ERROR = 'This event\'s look, date or venue changed while its mail banner was being drawn. It is being drawn again.';

function httpError(status, message, extra) {
  var e = new Error(message);
  e.status = status;
  e.body = Object.assign({ error: message }, extra || {});
  return e;
}
function text(v) { return v == null ? '' : String(v); }
function num(v) { var n = +v; return isFinite(n) && n > 0 ? n : 0; }
function queryOf(req) { return new URLSearchParams(String(req.url || '').split('?')[1] || ''); }

/* ---------- the inputs, their fingerprint, and the state of the stored banner ---------- */

/* Kit -> the inputs of the drawing, Kit-shaped. Only these are read: what is outside them (speakers, partners,
   counts, other pictures) never changes the picture, so it never makes the banner stale. */
function inputsOf(kit) {
  var e = (kit && kit.event) || {}, b = (kit && kit.brand) || {};
  var c = b.colours || {}, f = b.fonts || {}, lu = b.logoUnit, parts = b.logoUnitParts || {};
  var colours = {};
  COLOUR_KEYS.forEach(function (k) { colours[k] = text(c[k]); });
  function font(x) { x = x || {}; return { family: text(x.family), stack: text(x.stack), cssUrl: text(x.cssUrl) }; }
  return {
    v: BANNER_VERSION,
    event: {
      name: text(e.name),
      dateLabel: text(e.dateLabel),
      /* the place as the drawing works it out (promo-posts.js placeOf): the Kit's, else the venue and the city */
      place: text(e.place) || [text(e.venue), text(e.city)].filter(Boolean).join(', ')
    },
    brand: {
      mode: b.mode === 'dark' ? 'dark' : 'light',
      colours: colours,
      fonts: { heading: font(f.heading), body: font(f.body) },
      radius: text(b.radius),
      heroImageUrl: text(b.heroImageUrl),
      logoUnit: lu && text(lu.url) ? { url: text(lu.url), darkUrl: text(lu.darkUrl), width: num(lu.width), height: num(lu.height), tone: text(lu.tone) } : null,
      logoUnitParts: { before: text(parts.before), keyword: text(parts.keyword), after: text(parts.after) }
    }
  };
}

/* JSON with every object's keys sorted, so two equal sets of inputs always give the same text */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) {
      return JSON.stringify(k) + ':' + canonical(v[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
/* The inputs the fingerprint is taken from: all of them, less what two instances of the server can see
   differently for the same event. buildKit (lib/promo.js) fills some of the Kit in by asking the network, and
   each instance keeps its answers for hours, a failed one too: a logo unit whose page did not give its size is
   fetched and measured, and a Google Fonts address is checked and may come back as the bare family address or ''.
   App Hosting runs more than one instance, so a fingerprint built on those answers could differ by instance, and
   the browser's upload (or a send) answered by the other one would be refused as moved or stale again and again.
   - The unit's width and height are left out. The drawing measures the picture itself (promo-posts.js banner()),
     and the unit's url and darkUrl already say which picture it is.
   - A Google Fonts address, or none, stands for its family, which the family and stack already name. Every other
     stylesheet (a template's own @font-face rules, a link to another host) is never checked, so it counts as
     written: moving a font to one of them still makes the banner stale.
   The unit's tone is kept: it decides which copy of the unit is drawn and the tone of its ground.
   The inputs the browser draws from are not changed. */
var GOOGLE_FONTS_RE = /^https:\/\/fonts\.googleapis\.com\//;   // the addresses lib/promo.js checkFontCss checks
function fingerprinted(inputs) {
  if (!inputs || typeof inputs !== 'object' || !inputs.brand || typeof inputs.brand !== 'object') return inputs;
  var b = inputs.brand, out = Object.assign({}, inputs, { brand: Object.assign({}, b) });
  if (b.logoUnit && typeof b.logoUnit === 'object') {
    out.brand.logoUnit = Object.assign({}, b.logoUnit);
    delete out.brand.logoUnit.width;
    delete out.brand.logoUnit.height;
  }
  if (b.fonts && typeof b.fonts === 'object') {
    out.brand.fonts = {};
    Object.keys(b.fonts).forEach(function (k) {
      var f = b.fonts[k];
      out.brand.fonts[k] = f && typeof f === 'object'
        ? Object.assign({}, f, { cssUrl: GOOGLE_FONTS_RE.test(text(f.cssUrl)) ? '' : text(f.cssUrl) }) : f;
    });
  }
  return out;
}
function fingerprintOf(inputs) { return crypto.createHash('sha256').update(canonical(fingerprinted(inputs)), 'utf8').digest('hex').slice(0, 32); }

function needs(inputs) { return !!(inputs && inputs.brand && inputs.brand.heroImageUrl); }
function currentRef(fb, eventId) { return fb.db.collection('events').doc(eventId).collection('promoBanner').doc('current'); }

/* -> { needed, fingerprint, fresh, url }: one read of the record. Fresh only when the banner is needed and the
   record's fingerprint is the event's now. lib/promo-mailer.js calls this for every mail it builds, so it never
   rejects: a record that cannot be read is no record — the send paths then wait for a new banner instead of
   failing outright, and the studio's own preview (which is never refused) still opens. */
function stateFor(fb, eventId, kit) {
  return stateOfInputs(fb, eventId, inputsOf(kit));
}
function stateOfInputs(fb, eventId, inputs) {
  var needed = needs(inputs), fingerprint = fingerprintOf(inputs);
  return Promise.resolve().then(function () { return currentRef(fb, eventId).get(); }).then(function (snap) {
    return snap && snap.exists ? snap.data() || {} : null;
  }, function (err) {
    console.error('promo-banner: the banner record of ' + eventId + ' could not be read — ' + (err && err.message));
    return null;
  }).then(function (rec) {
    var url = rec && typeof rec.url === 'string' && rec.url ? rec.url : null;
    return { needed: needed, fingerprint: fingerprint, fresh: !!(needed && url && rec.fingerprint === fingerprint), url: url };
  });
}

/* Is this picture address one of this event's banners (the current one or an older one)? lib/promo-mailer.js
   points a saved mail's banner block at the current banner only when it holds one of these (or the bare hero it
   held before banners existed): a picture the owner chose is never touched. Only this server writes the folder. */
function isBannerUrl(url, bucket, eventId) {
  var s = text(url).trim();
  if (!bucket || !isEventId(eventId)) return false;
  var prefix = STORAGE + bucket + '/events/' + eventId + '/' + FOLDER + '/';
  if (s.indexOf(prefix) !== 0) return false;
  var name = s.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$/.test(name) && name.indexOf('..') === -1;
}

/* ---------- reading the picture ---------- */

/* A raw body of at most `limit` bytes, read into one buffer (allocated once when its length is declared), then
   cb(buffer). A larger body is answered 413 here and drained, never cut off: the browser then reads the 413
   instead of a reset connection. */
function readRaw(req, res, limit, cb) {
  var tooLarge = function () { sendJson(res, 413, { error: 'That upload is too large.' }); };
  if (req.rawBody) {
    if (req.rawBody.length > limit) return tooLarge();
    return cb(Buffer.from(req.rawBody));
  }
  var declared = parseInt((req.headers && req.headers['content-length']) || '', 10);
  if (declared > limit) { tooLarge(); req.resume(); return; }
  var buf = declared >= 0 ? Buffer.allocUnsafe(declared) : null, chunks = [], size = 0, done = false;
  req.on('data', function (c) {
    if (done) return;
    if (size + c.length > limit || (buf && size + c.length > buf.length)) {
      done = true;
      tooLarge();
      req.resume();
      return;
    }
    if (buf) c.copy(buf, size); else chunks.push(c);
    size += c.length;
  });
  req.on('end', function () {
    if (done) return;
    done = true;
    cb(buf ? buf.subarray(0, size) : Buffer.concat(chunks, size));
  });
  req.on('error', function () {
    if (done) return;
    done = true;
    sendJson(res, 400, { error: 'The upload could not be read.' });
  });
}

function isJpeg(buf) {
  var n = buf.length;
  return n > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[n - 2] === 0xff && buf[n - 1] === 0xd9;
}

/* sharp, loaded on first use with lib/pictures.js's settings (nothing cached between pictures; one thread),
   and one picture at a time in this module: an instance has 512 MiB for everything it does */
var sharpModule;
function loadSharp() {
  if (sharpModule === undefined) {
    try {
      sharpModule = require('sharp');
      sharpModule.cache(false);
      sharpModule.concurrency(1);
    } catch (e) {
      sharpModule = null;
      console.error('promo-banner: pictures cannot be read here (sharp) — ' + e.message);
    }
  }
  return sharpModule;
}
var queue = Promise.resolve();
function serially(job) {
  var run = queue.then(job, job);
  queue = run.then(function () {}, function () {});
  return run;
}
/* -> { width, height } of a JPEG the size a banner is, else an httpError */
function measure(buf) {
  var sharp = loadSharp();
  if (!sharp) return Promise.reject(httpError(503, 'The mail banner cannot be stored right now. Please try again shortly.'));
  return serially(function () { return sharp(buf, { limitInputPixels: WIDTH * MAX_HEIGHT * 2 }).metadata(); }).then(function (m) {
    /* a picture turned by its EXIF tag would show sideways in a mail client that ignores it: the browser never
       writes one */
    var turned = m && m.orientation && m.orientation !== 1;
    if (!m || m.format !== 'jpeg' || m.width !== WIDTH || !(m.height >= MIN_HEIGHT && m.height <= MAX_HEIGHT) || turned) throw httpError(400, SHAPE_ERROR);
    return { width: m.width, height: m.height };
  }, function (err) {
    if (err && err.status) throw err;
    throw httpError(400, SHAPE_ERROR);
  });
}

/* ---------- storing it ---------- */

/* Writes the record unless a newer one is there: the newer one was confirmed current after this upload was, so
   it is the better answer. With the same fingerprint (two browsers drew the same banner) this upload's picture
   is still a good one, and it is answered as stored; with another fingerprint the event changed meanwhile, and
   it is answered 'moved'. Resolves 'written' | 'kept' | 'moved'. */
function record(fb, eventId, row) {
  var eventRef = fb.db.collection('events').doc(eventId), ref = currentRef(fb, eventId);
  return fb.db.runTransaction(function (tx) {
    return Promise.all([tx.get(eventRef), tx.get(ref)]).then(function (r) {
      var ev = r[0].exists ? r[0].data() || {} : null;
      /* the event went away while its banner was being stored: no record is left under an event that is gone */
      if (!ev || !ev.createdAt || ev.deletedAt) throw httpError(404, 'This event has been deleted.', { code: 'event-gone' });
      var cur = r[1].exists ? r[1].data() || {} : null;
      if (cur && (+cur.at || 0) > row.at) return cur.fingerprint === row.fingerprint ? 'kept' : 'moved';
      tx.set(ref, row);
      return 'written';
    });
  });
}

/* ---------- the routes ---------- */

/* GET /api/promo/mailer/banner?eventId= */
function handleBanner(req, res) {
  H.withAdmin(req, res, function (fb) {
    var eventId = H.eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    /* buildKit loads the event as live (H.loadLiveEvent): a missing or deleted one is its 404 */
    promo.buildKit(fb, eventId, req, {}).then(function (kit) {
      var inputs = inputsOf(kit);
      return stateOfInputs(fb, eventId, inputs).then(function (st) {
        sendJson(res, 200, { needed: st.needed, fresh: st.fresh, fingerprint: st.fingerprint, url: st.url || null, inputs: inputs });
      });
    }).catch(function (err) { H.sendFailure(res, 'promo banner', err, 'The mail banner could not be checked. Please try again.'); });
  });
}

/* POST /api/promo/mailer/banner?eventId=&fingerprint= — the picture's raw bytes */
function handleBannerUpload(req, res) {
  H.withAdmin(req, res, function (fb, decoded) {
    var q = queryOf(req), eventId = H.eventIdOr400(res, q.get('eventId'));
    if (!eventId) return;
    var given = String(q.get('fingerprint') || '');
    if (!FINGERPRINT_RE.test(given)) { sendJson(res, 400, { error: 'The banner\'s fingerprint is missing. Reload the page and try again.' }); req.resume(); return; }
    readRaw(req, res, MAX_BYTES, function (buf) {
      if (!buf.length) return sendJson(res, 400, { error: 'empty upload' });
      if (!isJpeg(buf)) return sendJson(res, 400, { error: SHAPE_ERROR });
      var size, at, path, url;
      measure(buf).then(function (m) {
        size = m;
        return promo.buildKit(fb, eventId, req, {});
      }).then(function (kit) {
        var inputs = inputsOf(kit);
        /* drawn from inputs that are no longer the event's (or for an event that has no banner now) */
        if (!needs(inputs) || fingerprintOf(inputs) !== given) throw httpError(409, MOVED_ERROR, { code: 'banner-moved' });
        at = Date.now();
        path = 'events/' + eventId + '/' + FOLDER + '/' + given.slice(0, 16) + '-' + at.toString(36) + '-' + crypto.randomBytes(8).toString('hex') + '.jpg';
        url = STORAGE + fb.bucket.name + '/' + path;
        var file = fb.bucket.file(path);
        /* removes the picture, then fails with err: only where it is certain that no record names it */
        function dropAnd(err) { return file.delete().catch(function () {}).then(function () { throw err; }); }
        return file.save(buf, { resumable: false, metadata: { contentType: 'image/jpeg', cacheControl: CACHE } }).then(function () {
          /* an object no mail client can load must not be left behind looking like a stored banner; the record
             is written only after this, so nothing names it yet */
          return file.makePublic().catch(dropAnd);
        }).then(function () {
          var row = { fingerprint: given, url: url, path: path, width: size.width, height: size.height, bytes: buf.length, at: at, by: (decoded && decoded.email) || '' };
          return record(fb, eventId, row).then(function (how) {
            /* the transaction ended without writing: a newer record of other inputs is there */
            if (how === 'moved') return dropAnd(httpError(409, MOVED_ERROR, { code: 'banner-moved' }));
          }, function (err) {
            /* the event was gone when the transaction read it, so it wrote nothing */
            if (err && err.body && err.body.code === 'event-gone') return dropAnd(err);
            /* Any other failure may have come after the record was in fact written (a commit that landed but
               whose answer was lost on the way back). The picture is kept, as every banner is: a
               stray public picture costs nothing, while a record that names a removed one would put a broken
               picture in every mail until the event changed. */
            throw err;
          });
        });
      }).then(function () {
        sendJson(res, 200, { ok: true, url: url, fingerprint: given, width: size.width, height: size.height });
      }).catch(function (err) { H.sendFailure(res, 'promo banner upload', err, 'The mail banner could not be stored. Please try again.'); });
    });
  });
}

module.exports = { wire, inputsOf, fingerprintOf, stateFor, isBannerUrl, handleBanner, handleBannerUpload, BANNER_VERSION };
module.exports._test = { canonical, fingerprinted, readRaw, isJpeg, measure, record, needs, currentRef, MAX_BYTES, WIDTH, MIN_HEIGHT, MAX_HEIGHT, FOLDER };
