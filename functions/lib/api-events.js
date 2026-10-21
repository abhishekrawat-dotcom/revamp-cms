// The life of an event record beyond create / read / update (those stay in lib/api.js), plus the one way
// a picture gets into the product:
//
//   POST   /api/event/upload            handleUpload          an image -> Cloud Storage -> { url, path }
//   GET    /api/event/slug-available    handleSlugAvailable   "is this address free?" -> { available, suggestion }
//   DELETE /api/event?eventId=          handleEventDelete     soft delete (restorable; the address stays reserved)
//   DELETE /api/event?eventId=&discard=1                       a draft its creator has just made and abandoned
//                                                              is removed for good and its address freed
//   POST   /api/event/restore           handleEventRestore    undo of the above
//   POST   /api/event/clone             handleEventClone      a new, unpublished event copied from another
//
// All five are admin routes (lib/http.js's requireAdmin). lib/api.js's router sends them here.
//
// Two rules hold for everything in this file, for the reason lib/http.js gives at its top: a handler
// answers the request on every path, and nothing may throw inside a stream or promise callback — an
// uncaught exception ends the whole server process, not just this request. Hence guard() around every
// callback body and a .catch() on every chain.
const crypto = require('crypto');
const admin = require('firebase-admin');
const { sendJson, parseJsonBody, requireAdmin, isEventId, isReservedEventId, str } = require('./http');
const { logActivity, actorOf } = require('./activity');
const pictures = require('./pictures');

/* Runs fn; a synchronous throw becomes a 500 for this request instead of an uncaught exception. */
function guard(res, where, fn) {
  try { return fn(); }
  catch (err) { fail(res, where, err); }
}

/* The single place a failure nobody planned for is answered: the detail goes to the log, the person
   gets a sentence they can act on. A rejection that carries its own `status` was planned (see reject()). */
function fail(res, where, err, message) {
  if (err && err.status) return sendJson(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
  console.error('api-events: ' + where + ' failed — ' + ((err && err.stack) || err));
  sendJson(res, 500, { error: message || 'Something went wrong on the server. Please try again.' });
}

function reject(status, message, extra) {
  return Object.assign(new Error(message), { status: status, extra: extra || null });
}

function queryOf(req) { return new URLSearchParams(String(req.url || '').split('?')[1] || ''); }

/* events/import-<importId> documents are the Lovable import pipeline's own records (lib/firebase.js);
   they share the collection but are never events, so no route here may address one as an event. */
function isImportId(id) { return id.indexOf('import-') === 0; }

function eventRef(fb, id) { return fb.db.collection('events').doc(id); }

/* =====================================================================================================
   "THIS EVENT EXISTS" — the one rule this file uses, for the slug check and for clone's target.

   An address is TAKEN when events/<id> is a document that was really created as an event — it carries
   `createdAt`, which only POST /api/event and clone (below) stamp — or that is a deleted event
   (`deletedAt`; a deleted event keeps its address so that Restore can never collide with a newer event
   and old links can never start showing somebody else's site).

   A document WITHOUT createdAt is not an event: it is a shell left by an AI step that wrote
   { ...eventMeta, updatedAt } with merge before the event was created, or the parent of content written
   under an id that never existed. Such an address is free. (Clone is stricter for its own target, because
   it writes content records with fixed ids: see targetLeftovers().)
   ===================================================================================================== */
function isTaken(snap) {
  if (!snap || !snap.exists) return false;
  var d = snap.data() || {};
  return !!(d.createdAt || d.deletedAt);
}

/* The address rule, the same one the client's RevampCore.slugify() applies: lowercase letters, digits
   and single hyphens, starting with a letter or digit, at most 80 characters (lib/http.js's isEventId). */
function slugify(v) {
  return String(v == null ? '' : v).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

/* The nearest address to a reserved one (lib/http.js's isReservedEventId) that is not reserved:
   "gen-summit" -> "summit", "2027" -> "event-2027", "new" -> "new-event". */
function unreserved(id) {
  var s = String(id);
  while (/^(gen|imported|import)-/.test(s)) s = s.replace(/^(gen|imported|import)-+/, '');
  if (!s) return 'event';
  if (/^\d+$/.test(s)) return 'event-' + s;
  return isReservedEventId(s) ? s + '-event' : s;
}
var RESERVED_MESSAGE = 'That address is reserved.';
function reservedMessage(suggestion) { return RESERVED_MESSAGE + (suggestion ? ' Try "' + suggestion + '".' : ' Choose another.'); }

/* A free address close to the one asked for: "<base>-2", "-3", … (an existing numeric suffix is counted
   on from, so "summit-2" suggests "summit-3", not "summit-2-2"). One batched read for twenty candidates;
   if every one of them is in use, a short random suffix — which is checked too. Resolves '' only when
   nothing usable can be derived (the text had no letter or digit at all). */
function suggestFreeSlug(fb, wanted) {
  var base = slugify(wanted);
  if (!base) return Promise.resolve('');
  if (isReservedEventId(base)) base = unreserved(base);
  var m = /^(.*?)-(\d{1,4})$/.exec(base);
  var stem = m ? m[1] : base, from = m ? (+m[2] + 1) : 2;
  var candidates = [];
  if (base !== String(wanted)) candidates.push(base);      // the tidied form of what was typed comes first
  for (var n = from; n < from + 20; n++) {
    var suffix = '-' + n;
    candidates.push(stem.slice(0, 80 - suffix.length).replace(/-+$/, '') + suffix);
  }
  var rnd = '-' + crypto.randomBytes(3).toString('hex');
  candidates.push(stem.slice(0, 80 - rnd.length).replace(/-+$/, '') + rnd);
  candidates = candidates.filter(function (c, i, arr) { return isEventId(c) && !isReservedEventId(c) && arr.indexOf(c) === i; });
  if (!candidates.length) return Promise.resolve('');
  return fb.db.getAll.apply(fb.db, candidates.map(function (c) { return eventRef(fb, c); })).then(function (snaps) {
    for (var i = 0; i < snaps.length; i++) if (!isTaken(snaps[i])) return candidates[i];
    return '';
  });
}

/* ---------- GET /api/event/slug-available?slug= ----------
   -> 200 { available, suggestion, slug, reason, message }
     available   true only when exactly this text can be used as a new event's address right now
     suggestion  an address that is free: the slug itself when available, otherwise the nearest free one
                 ('' when none could be derived)
     reason      'invalid' | 'reserved' | 'taken' when not available — the wizard words its own message,
                 `message` is a ready sentence for callers that do not
   A check, not a reservation: POST /api/event still answers 409 if somebody else takes the address
   between this answer and the submit. */
function handleSlugAvailable(req, res) {
  requireAdmin(req, res, function (fb) {
    guard(res, 'slug-available', function () {
      var raw = String(queryOf(req).get('slug') || '').trim();
      if (!raw) return sendJson(res, 400, { error: 'Enter an address to check.' });
      if (raw.length > 200) return sendJson(res, 400, { error: 'That address is too long — use up to 80 characters.' });

      var reason = '';
      if (!isEventId(raw)) reason = 'invalid';
      else if (isReservedEventId(raw)) reason = 'reserved';

      var check = reason ? Promise.resolve(false) : eventRef(fb, raw).get().then(function (snap) {
        if (isTaken(snap)) { reason = 'taken'; return false; }
        return true;
      });
      check.then(function (free) {
        if (free) return sendJson(res, 200, { available: true, suggestion: raw, slug: raw, reason: '', message: '' });
        return suggestFreeSlug(fb, raw).then(function (suggestion) {
          var message = reason === 'invalid'
            ? 'An address can use lowercase letters, numbers and hyphens only, up to 80 characters.'
            : reason === 'reserved'
              ? reservedMessage(suggestion)
              : 'That address is already used by another event.';
          sendJson(res, 200, { available: false, suggestion: suggestion, slug: raw, reason: reason, message: message });
        });
      }).catch(function (err) { fail(res, 'slug-available', err, 'The address could not be checked. Please try again.'); });
    });
  });
}

/* =====================================================================================================
   POST /api/event/upload   { eventId, kind, fileName, mimeType, dataBase64 } -> 200 { url, path, contentType, size }

   The only way a picture enters the product. Before this route, pictures were stored as data: URLs inside
   Firestore documents, which fail above 1 MiB and bloat every read of the record.

   WHAT COUNTS AS AN IMAGE is decided by the file's first bytes, never by its name or the type the browser
   declared: a renamed PDF, PSD or HTML file is refused whatever it claims to be, and the object is stored
   under the type its bytes really are (a JPEG saved as "photo.png" is served as image/jpeg, so it
   displays). The declared type is still enforced in one direction: a caller that says it is sending
   something that is not an image is refused before the bytes are looked at.

   SVG is XML that can carry script. It is accepted only (a) when it has no script, event handlers,
   embedded documents or entity tricks, and (b) as a file on the storage host — a different origin from the
   CMS and from every published site — so that even an SVG that slipped past (a) can run nothing with this
   product's cookies or session when someone opens its URL directly; inside <img> or CSS, where every
   page uses it, a browser runs no script at all. Nothing here ever returns SVG markup for inlining.

   The event document need not exist yet: the wizard uploads the logo before it creates the event, and a
   Storage object is not a Firestore document, so nothing appears in any list. A deleted event is refused.
   ===================================================================================================== */
var UPLOAD_KINDS = ['speakers', 'partners', 'gallery', 'logo', 'banner', 'media', 'brief'];
/* how an upload reads in the activity log */
var UPLOAD_LABELS = { speakers: 'Speaker picture', partners: 'Partner logo', gallery: 'Gallery picture', logo: 'Logo', banner: 'Banner picture', media: 'Picture', brief: 'Brief document' };
var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/* 8 MB of image is ~10.7 MB of base64; the rest is the JSON around it. A larger body is cut off by
   readBody with a 413 before it is buffered. */
var MAX_UPLOAD_BODY = 12 * 1024 * 1024;
var IMAGE_TYPES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg'
};
var NOT_AN_IMAGE = ' is not an image we can use. Upload a PNG, JPG, WebP, GIF or SVG file.';

function normaliseMime(v) {
  var m = String(v == null ? '' : v).toLowerCase().split(';')[0].trim();
  if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg';
  if (m === 'image/svg' || m === 'image/svg-xml') return 'image/svg+xml';
  if (m === 'image/x-png') return 'image/png';
  return m;
}

var SVG_START = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>\[]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;
/* Anything in an SVG that can run code, load another document or expand into either. A DOCTYPE with an
   internal subset ("[ <!ENTITY … ]") never matches SVG_START, so entity-built markup is refused there. */
var SVG_ACTIVE = /<\s*script[\s>\/]|<\s*foreignObject[\s>\/]|<\s*(?:iframe|embed|object)[\s>\/]|[\s"'\/]on[a-z]{2,}\s*=|javascript\s*:|<!ENTITY|data\s*:\s*text\/html/i;

/* A browser reads "java&#115;cript:" and "java<newline>script:" as "javascript:", so the text is also
   checked the way a browser would end up reading it: character references resolved, and the tab and
   line-break characters a URL parser drops removed. */
function svgIsActive(text) {
  if (SVG_ACTIVE.test(text)) return true;
  var read = text.replace(/&#(x[0-9a-f]+|\d+);?/gi, function (m, n) {
    var code = n.charAt(0).toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  }).replace(/&(colon|tab|newline);/gi, function (m, name) {
    return { colon: ':', tab: '\t', newline: '\n' }[name.toLowerCase()];
  }).replace(/[\t\n\r]/g, '');
  return read !== text && SVG_ACTIVE.test(read);
}

/* The type the bytes are, or '' when they are none of the five formats accepted. */
function sniffImage(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.length >= 6) {
    var six = buf.toString('latin1', 0, 6);
    if (six === 'GIF87a' || six === 'GIF89a') return 'image/gif';
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  // SVG is text: no NUL byte anywhere near the start, and the document element is <svg>
  var head = buf.slice(0, 4096);
  if (head.indexOf(0) === -1) {
    var text = head.toString('utf8').replace(/^\uFEFF/, '');
    if (SVG_START.test(text)) return 'image/svg+xml';
  }
  return '';
}

/* The stored object's name. Never the caller's own file name as it came: that could repeat (two people
   uploading "logo.png" would overwrite each other, and a long-cached URL would show the old picture) and
   could carry path characters. A time prefix keeps a folder listing in upload order, the random part
   makes a collision impossible in practice, and what is kept of the original name — letters, digits and
   hyphens only — is there so a person reading the bucket can tell the files apart. The extension always
   comes from the detected type. */
function storedName(fileName, ext) {
  var base = String(fileName == null ? '' : fileName).split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex') + '-' + (base || 'image') + '.' + ext;
}

/* Public objects are addressed on Google's storage host, which answers from anywhere — the CMS, a
   published page, a local preview — with no dependence on which host the editor happened to run on. */
function publicUrl(fb, storagePath) {
  return 'https://storage.googleapis.com/' + fb.bucket.name + '/' +
    storagePath.split('/').map(encodeURIComponent).join('/');
}

function handleUpload(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    parseJsonBody(req, res, function (body) {
      guard(res, 'upload', function () {
        var eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
        var kind = typeof body.kind === 'string' ? body.kind.trim() : '';
        var fileName = str(body.fileName, 200) || 'image';
        var shown = '"' + fileName.slice(0, 80) + '"';
        if (!isEventId(eventId) || isImportId(eventId)) return sendJson(res, 400, { error: 'A valid eventId is required.' });
        if (UPLOAD_KINDS.indexOf(kind) === -1) {
          return sendJson(res, 400, { error: 'kind must be one of: ' + UPLOAD_KINDS.join(', ') + '.' });
        }
        var declared = normaliseMime(body.mimeType);
        if (declared && !IMAGE_TYPES[declared]) return sendJson(res, 415, { error: shown + NOT_AN_IMAGE });

        if (typeof body.dataBase64 !== 'string' || !body.dataBase64) {
          return sendJson(res, 400, { error: 'The file is empty — choose an image and try again.' });
        }
        // a data: URL is tolerated (FileReader hands one out), but only its payload is ever used
        var b64 = body.dataBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(b64)) return sendJson(res, 400, { error: 'The file did not arrive intact. Please try again.' });
        var buffer = Buffer.from(b64, 'base64');
        if (!buffer.length) return sendJson(res, 400, { error: 'The file is empty — choose an image and try again.' });
        if (buffer.length > MAX_IMAGE_BYTES) {
          return sendJson(res, 413, { error: shown + ' is ' + (buffer.length / 1048576).toFixed(1) + ' MB. Images can be up to 8 MB.' });
        }

        var contentType = sniffImage(buffer);
        if (!contentType) return sendJson(res, 415, { error: shown + NOT_AN_IMAGE });
        if (contentType === 'image/svg+xml' && svgIsActive(buffer.toString('utf8'))) {
          return sendJson(res, 415, { error: shown + ' contains scripts or embedded content, which is not allowed in an SVG. Export it as a plain SVG, or use a PNG.' });
        }

        var storagePath = 'events/' + eventId + '/' + kind + '/' + storedName(fileName, IMAGE_TYPES[contentType]);
        var file = fb.bucket.file(storagePath), live = false;
        eventRef(fb, eventId).get().then(function (snap) {
          if (snap.exists && (snap.data() || {}).deletedAt) throw reject(404, 'This event has been deleted. Restore it before adding images.');
          live = snap.exists && !!(snap.data() || {}).createdAt;   // the wizard uploads before the event exists: not logged then
          /* The name is unique for ever, so the object never changes: browsers and Google's edge may keep
             it for a year without asking again. (Replacing a picture means a new upload and a new URL.) */
          return file.save(buffer, {
            resumable: false,
            gzip: pictures.gzipWorthIt(contentType, buffer),     // an SVG is stored gzipped: sent compressed (pictures.js)
            metadata: {
              contentType: contentType,
              cacheControl: 'public, max-age=31536000, immutable',
              metadata: { uploadedBy: actorOf(decoded), originalName: fileName.replace(/[^\x20-\x7E]/g, '_').slice(0, 120) }
            }
          });
        }).then(function () {
          return file.makePublic().catch(function (err) {
            // an object nobody can load must not be left behind looking like a successful upload
            return file.delete().catch(function () { /* best effort */ }).then(function () { throw err; });
          });
        }).then(function () {
          /* WebP copies at a few widths, next to the original (lib/pictures.js): the page a visitor sees
             loads those. A picture that gets none (an SVG, a GIF, a failure, too slow) is shown as it is. */
          return kind === 'brief' ? null : pictures.storeVariants(fb, storagePath, buffer, { budgetMs: 20000 });
        }).then(function (made) {
          var answer = { url: publicUrl(fb, storagePath), path: storagePath, contentType: contentType, size: buffer.length };
          if (made) { answer.width = made.width; answer.height = made.height; }
          sendJson(res, 200, answer);
          if (live) logActivity(fb, eventId, decoded, 'file-uploaded', (UPLOAD_LABELS[kind] || kind) + ' uploaded: ' + fileName.slice(0, 120),
            { area: kind === 'logo' || kind === 'banner' ? 'design' : 'content' });
        }).catch(function (err) { fail(res, 'upload', err, 'The image could not be stored. Please try again.'); });
      });
    }, MAX_UPLOAD_BODY, 'That file is too large. Images can be up to 8 MB.');
  });
}

/* =====================================================================================================
   DELETE /api/event?eventId=   and   POST /api/event/restore { eventId }

   Delete is soft: the record, its content, its registrations and its files all stay; `deletedAt` and
   `deletedBy` are set and nothing else is touched. Every list and every public route treats an event
   with deletedAt as if it did not exist (contract, section 14), so the public page stops being served at
   once; the address stays reserved (isTaken above). `published` is deliberately left as it was: Restore
   is an undo and puts the event back exactly as it stood, live page included.

   Both are safe to repeat — deleting a deleted event, or restoring one that is not deleted, answers 200
   and changes nothing (and records nothing in the history), so a double click or a retried request
   cannot fail or lie.
   ===================================================================================================== */
function readEventIdFrom(value) {
  var id = typeof value === 'string' ? value.trim() : '';
  return isEventId(id) && !isImportId(id) ? id : '';
}

/* ---------- DELETE /api/event?eventId=&discard=1 ----------
   The Create Event wizard makes the event before it generates or imports a site for it, so an owner who
   cancels half-way has an empty draft they never asked to keep. A soft delete would hold its address for
   ever — cancelling "Tech Summit 2027" once would lock them out of /e/tech-summit-2027. So that one draft,
   and only that one, can be removed for good: the document, everything under it and its files.

   It is irreversible, so it is allowed only while nothing can be lost by it. ALL of these must hold:
     - the caller created the event, less than 24 hours ago;
     - it was never published and nobody has registered for it;
     - its site was saved at most once (the wizard's own first save — an edit in the editor is the second).
   Anything else answers 409 { code: 'not-discardable' } and changes nothing; the owner deletes such an
   event from the events list, where it can be restored.

   The event is first marked deleted (with `discardingAt`) in the transaction that checks the rules, so
   from that instant every other route refuses to write to it and nothing new can appear under it while
   its content is being removed. If removal fails part-way the mark stays, the event stays out of every
   list, and the same request can simply be sent again. */
var DISCARD_WINDOW_MS = 24 * 60 * 60 * 1000;
var NOT_DISCARDABLE = 'This event has been worked on — delete it from the events list instead.';

function discardBlocker(d, actor) {
  if (d.discardingAt) return '';                                   // a discard that was interrupted: finish it
  if (d.deletedAt) return 'deleted';
  if (!d.createdBy || d.createdBy !== actor) return 'not-creator';
  var age = Date.now() - Date.parse(d.createdAt);
  if (!(age >= 0 && age < DISCARD_WINDOW_MS)) return 'too-old';
  if (d.published === true || d.publishedAt) return 'published';
  if (d.counters && +d.counters.registrations > 0) return 'has-registrations';
  if (d.site && +d.site.version > 1) return 'site-edited';
  return '';
}

function handleEventDiscard(req, res, fb, decoded, eventId) {
  var ref = eventRef(fb, eventId), now = new Date().toISOString(), actor = actorOf(decoded);
  fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      if (!isTaken(snap)) throw reject(404, 'No event found for "' + eventId + '".');
      var d = snap.data() || {};
      var why = discardBlocker(d, actor);
      if (why === 'deleted') throw reject(404, 'This event has been deleted.');
      if (why) throw reject(409, NOT_DISCARDABLE, { code: 'not-discardable', reason: why });
      if (!d.discardingAt) tx.update(ref, { deletedAt: now, deletedBy: actor, discardingAt: now, updatedAt: now });
    });
  }).then(function () {
    return fb.bucket.deleteFiles({ prefix: 'events/' + eventId + '/' });
  }).then(function () {
    return fb.db.recursiveDelete(ref);                             // the document and every subcollection
  }).then(function () {
    console.log('api-events: ' + actor + ' discarded the draft "' + eventId + '"');
    sendJson(res, 200, { ok: true, eventId: eventId, discarded: true });
  }).catch(function (err) {
    fail(res, 'discard', err, 'The draft could not be removed completely. Please try again.');
  });
}

function handleEventDelete(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    guard(res, 'delete', function () {
      var eventId = readEventIdFrom(queryOf(req).get('eventId'));
      if (!eventId) return sendJson(res, 400, { error: 'A valid eventId is required.' });
      if (queryOf(req).get('discard') === '1') return handleEventDiscard(req, res, fb, decoded, eventId);
      var ref = eventRef(fb, eventId), now = new Date().toISOString(), result = null;
      fb.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          // a shell (no createdAt) is not an event: marking it deleted would reserve an address nobody used
          if (!isTaken(snap)) throw reject(404, 'No event found for "' + eventId + '".');
          var d = snap.data() || {};
          if (d.deletedAt) { result = { changed: false, deletedAt: d.deletedAt, name: d.name }; return; }
          tx.update(ref, { deletedAt: now, deletedBy: actorOf(decoded), updatedAt: now });
          result = { changed: true, deletedAt: now, name: d.name };
        });
      }).then(function () {
        if (!result.changed) return;
        return logActivity(fb, eventId, decoded, 'deleted', result.name ? '"' + str(result.name, 120) + '"' : '');
      }).then(function () {
        sendJson(res, 200, { ok: true, eventId: eventId, deletedAt: result.deletedAt });
      }).catch(function (err) { fail(res, 'delete', err, 'The event could not be deleted. Please try again.'); });
    });
  });
}

function handleEventRestore(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    parseJsonBody(req, res, function (body) {
      guard(res, 'restore', function () {
        var eventId = readEventIdFrom(body.eventId);
        if (!eventId) return sendJson(res, 400, { error: 'A valid eventId is required.' });
        var ref = eventRef(fb, eventId), now = new Date().toISOString(), result = null;
        var FieldValue = admin.firestore.FieldValue;
        fb.db.runTransaction(function (tx) {
          return tx.get(ref).then(function (snap) {
            if (!isTaken(snap)) throw reject(404, 'No event found for "' + eventId + '".');
            var d = snap.data() || {};
            // a draft that is being removed for good (see handleEventDiscard) has already lost content
            if (d.discardingAt) throw reject(409, 'This draft is being removed and cannot be restored.', { code: 'discarding' });
            result = { changed: !!d.deletedAt, published: d.published === true, name: d.name };
            if (!d.deletedAt) return;
            tx.update(ref, { deletedAt: FieldValue.delete(), deletedBy: FieldValue.delete(), updatedAt: now });
          });
        }).then(function () {
          if (!result.changed) return;
          return logActivity(fb, eventId, decoded, 'restored', result.published ? 'its public page is live again' : '');
        }).then(function () {
          sendJson(res, 200, { ok: true, eventId: eventId, published: result.published });
        }).catch(function (err) { fail(res, 'restore', err, 'The event could not be restored. Please try again.'); });
      });
    }, 4096);
  });
}

/* =====================================================================================================
   POST /api/event/clone   { sourceEventId, eventId, name }
     -> 200 { eventId, name, templateId, createdAt, copied: { <collection>: n, …, files: n, site: bool } }
     -> 409 { error, code: 'slug-taken', suggestion }   when the new address is in use

   WHAT IS COPIED
     - the event document: details, settings, design and everything the AI pipeline saved on it
       (designPlan, generatedSections, theme, structurePlan) — a deny-list rather than an allow-list, so a
       field another part of the backend adds later is carried over without this file knowing about it
     - the nine content subcollections, with the SAME document ids, so that the links between them
       (a speaker's groupId, a session's speakerIds, a partner's tierId) still point at the right record
     - the Promotions message / post / banner templates, each reset to a draft that was never posted
     - the registration forms (events/<id>/forms), same ids, so the copy's buttons and embedded forms open
       the same forms; settings.registration.defaultFormId comes with the settings
     - the event's files in Storage — uploads, generated imagery and the saved site — and every reference
       to them, so the copy never depends on the original's files (deleting or changing the original must
       not break the copy's pictures)
   WHAT IS NEVER COPIED
     registrations, leads, saved audiences, statistics, activity, drafts, briefs and research sources; the published page and
     every published* field; deletedAt; counters; aiUsage (what the AI cost the source). The copy is an unpublished draft with new timestamps.

   A COPY OF AN AI-DESIGNED OR IMPORTED SITE MUST STILL OPEN IN THE EDITOR
     - AI-designed: templateId is 'gen-<eventId>', and lib/api.js builds that template on request from
       the designPlan and generatedSections fields of events/<eventId> (generated-template,
       generated-section). Both fields are copied, and the copy's templateId is rewritten to point at
       ITSELF ('gen-<newId>') — left alone it would keep loading the original's design, and would break
       the day the original is deleted or redesigned.
     - Imported: templateId is 'imported-<importId>', served from events/import-<importId> and its own
       Storage folder — a record that belongs to the import, not to any event. The copy keeps the same
       templateId; nothing of the import is duplicated.

   ORDER, AND WHAT HAPPENS WHEN A STEP FAILS
     1. Reserve the address in a transaction (so two clones, or a clone and a create, cannot both win) with
        a nameless placeholder — lists show real, named events only, so nobody sees a half-made event.
     2. Copy files, then content records.
     3. Write the real event document over the placeholder.
     If 2 or 3 fails, everything written so far is removed and the address is released; the answer is an
     error and the original is untouched throughout (it is only ever read).
   ===================================================================================================== */
var CONTENT_COLLECTIONS = ['speakers', 'speakerGroups', 'sessions', 'agendaGroups', 'partners', 'partnerTiers',
  'gallery', 'faqs', 'contacts'];
/* The Promotions pages' message, post and banner templates are the event's own wording and are copied
   too, each back to an unsent draft. Its leads and saved audiences are lists of people and are not. */
var PROMO_TEMPLATES = 'promoTemplates';
/* The registration forms (lib/api-forms.js) are the event's own too, and the copied site names them by id. */
var FORMS = 'forms';
var CLONED_COLLECTIONS = CONTENT_COLLECTIONS.concat([PROMO_TEMPLATES, FORMS]);
var PEOPLE_COLLECTIONS = ['registrations', 'leads', 'promoAudiences'];

/* Fields of the source document that describe ITS life, not the event's design or content. */
var NOT_CLONED_FIELDS = ['published', 'publishedAt', 'publishedBy', 'publishedVersion', 'publishedPath',
  'publishedUrl', 'unpublishedAt', 'unpublishedBy', 'stagingUrl', 'deletedAt', 'deletedBy', 'counters', 'aiUsage',
  'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'detailsUpdatedAt', 'site', 'siteLock', 'cloningFrom', 'clonedFrom',
  'eventId', 'id', 'slug', 'name', 'status'];

/* Storage folders under events/<id>/ that are not carried over: the live page and the old preview page
   (a copy starts unpublished) and the documents uploaded for AI generation (inputs, like drafts). */
var NOT_CLONED_FOLDERS = ['published', 'staging', 'briefs'];
var SITE_FOLDER = 'site';
var CLONE_CONCURRENCY = 12;
var BATCH_SIZE = 400;          // Firestore allows 500 writes per batch

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Returns a function that rewrites, in any text, every reference to the source event that would make the
   copy depend on — or act as — the original:
     events/<src>/…            Storage paths and public URLs (plain and %2F-encoded)  -> the copy's files
     gen-<src>                 the AI-designed template id                             -> the copy's own
     data-rv-event-id="<src>"  the id a page registers and reports visits under        -> the copy's
     "eventId":"<src>"         the same id in a page's embedded config block
     ?eventId=<src>            section/template URLs baked into saved markup
   Each pattern ends where the id ends, so "summit" never matches inside "summit-2026". */
function referenceRewriter(src, dst) {
  var S = escapeRegExp(src), END = '(?![a-z0-9-])';
  var rules = [
    [new RegExp('(^|[/"\'(=\\s])events/' + S + '/', 'g'), '$1events/' + dst + '/'],
    [new RegExp('events%2F' + S + '%2F', 'gi'), 'events%2F' + dst + '%2F'],
    [new RegExp('(^|[^a-z0-9-])gen-' + S + END, 'g'), '$1gen-' + dst],
    [new RegExp('(data-rv-event-id=\\\\?["\'])' + S + '(\\\\?["\'])', 'g'), '$1' + dst + '$2'],
    [new RegExp('(\\\\?"eventId\\\\?"\\s*:\\s*\\\\?")' + S + '(\\\\?")', 'g'), '$1' + dst + '$2'],
    [new RegExp('([?&](?:amp;)?eventId=)' + S + END, 'g'), '$1' + dst]
  ];
  return function (text) {
    if (typeof text !== 'string' || text.indexOf(src) === -1) return text;
    for (var i = 0; i < rules.length; i++) text = text.replace(rules[i][0], rules[i][1]);
    return text;
  };
}

/* Applies fn to every string inside plain objects and arrays. Anything else Firestore hands back
   (Timestamp, GeoPoint, DocumentReference, Buffer) is passed through untouched. */
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map(function (v) { return mapStrings(v, fn); });
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    var out = {};
    Object.keys(value).forEach(function (k) { out[k] = mapStrings(value[k], fn); });
    return out;
  }
  return value;
}

/* Runs worker(item) over items, at most `limit` at a time; rejects with the first failure. */
function eachLimit(items, limit, worker) {
  return new Promise(function (resolve, rejectAll) {
    var next = 0, active = 0, failed = false;
    if (!items.length) return resolve();
    function pump() {
      if (failed) return;
      if (next >= items.length && active === 0) return resolve();
      while (active < limit && next < items.length) {
        active++;
        var p;
        try { p = Promise.resolve(worker(items[next++])); } catch (e) { p = Promise.reject(e); }
        p.then(function () { active--; pump(); }, function (err) { if (!failed) { failed = true; rejectAll(err); } });
      }
    }
    pump();
  });
}

/* Content written under an id before any event existed there (possible until the API started refusing
   such writes) would silently become part of the copy, because clone keeps document ids. An address with
   leftovers is therefore not offered to clone; it is reported as taken, with a free suggestion. Deleting
   somebody's stray records to make room is not this route's call. */
function targetLeftovers(fb, eventId) {
  var ref = eventRef(fb, eventId);
  return Promise.all(CLONED_COLLECTIONS.concat(PEOPLE_COLLECTIONS).map(function (name) {
    return ref.collection(name).limit(1).get().then(function (snap) { return snap.empty ? '' : name; });
  })).then(function (found) { return found.filter(Boolean); });
}

/* Copies events/<src>/** to events/<dst>/** (minus NOT_CLONED_FOLDERS). Resolves { files, site }: how many
   were copied, and whether any of them was part of the saved site; every destination path is pushed
   onto `written` as it is started, for undo.
   Uploads and generated imagery are public objects and a copy does not inherit that, so each is made
   public again. The saved site is private and stays private; its two files are text that names the
   event and its files, so they are rewritten rather than copied byte for byte. */
function copyFiles(fb, src, dst, rewrite, written) {
  var prefix = 'events/' + src + '/', copied = { files: 0, site: false };
  return fb.bucket.getFiles({ prefix: prefix }).then(function (r) {
    var files = (r[0] || []).filter(function (f) {
      var rest = f.name.slice(prefix.length), folder = rest.split('/')[0];
      /* a banner video uploaded but not yet checked (lib/api-hero-video.js) is private until its bytes are
         read: a copy, made public below, must not skip that check */
      if (((f.metadata || {}).metadata || {}).rvPending === '1') return false;
      return rest && rest.indexOf('/') !== -1 && !/\/$/.test(rest) && NOT_CLONED_FOLDERS.indexOf(folder) === -1;
    });
    return eachLimit(files, CLONE_CONCURRENCY, function (f) {
      var rest = f.name.slice(prefix.length), folder = rest.split('/')[0];
      var target = fb.bucket.file('events/' + dst + '/' + rest);
      written.push(target.name);
      if (folder === SITE_FOLDER) {
        var meta = f.metadata || {};
        return f.download().then(function (data) {
          var isText = /\.(json|html?)$/i.test(rest);
          var out = isText ? Buffer.from(rewrite(data[0].toString('utf8')), 'utf8') : data[0];
          var metadata = { contentType: meta.contentType || (/\.json$/i.test(rest) ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8') };
          if (meta.cacheControl) metadata.cacheControl = meta.cacheControl;
          return target.save(out, { resumable: false, metadata: metadata });
        }).then(function () {
          copied.files++;
          copied.site = true;
        });
      }
      return f.copy(target).then(function () { return target.makePublic(); }).then(function () { copied.files++; });
    }).then(function () { return copied; });
  });
}

/* Copies the content subcollections and the promotion templates, keeping ids. Resolves { speakers: n, … }. */
function copyContent(fb, src, dst, rewrite, actor, now) {
  var counts = {}, writes = [];
  return Promise.all(CLONED_COLLECTIONS.map(function (name) {
    return eventRef(fb, src).collection(name).get().then(function (snap) {
      counts[name] = snap.size;
      snap.docs.forEach(function (d) {
        var data = mapStrings(d.data() || {}, rewrite);
        data.createdAt = now; data.updatedAt = now; data.createdBy = actor;
        delete data.updatedBy;
        if (name === PROMO_TEMPLATES) { data.status = 'draft'; data.postedAt = null; }
        if (name === FORMS) { data.createdBy = actor; data.updatedBy = actor; data.rev = 1; }
        writes.push({ ref: eventRef(fb, dst).collection(name).doc(d.id), data: data });
      });
    });
  })).then(function () {
    var batches = [];
    for (var i = 0; i < writes.length; i += BATCH_SIZE) batches.push(writes.slice(i, i + BATCH_SIZE));
    // one batch after another: a failure then leaves a known prefix written, and undo removes all of it
    return batches.reduce(function (chain, group) {
      return chain.then(function () {
        var batch = fb.db.batch();
        group.forEach(function (w) { batch.set(w.ref, w.data); });
        return batch.commit();
      });
    }, Promise.resolve());
  }).then(function () { return counts; });
}

/* Removes whatever a failed clone wrote. Best effort and never rejects: the caller is already answering
   with the real error, and a leftover is logged for a person to look at rather than hidden. */
function undoClone(fb, dst, written) {
  var ref = eventRef(fb, dst);
  return Promise.all(CLONED_COLLECTIONS.map(function (name) {
    return ref.collection(name).get().then(function (snap) {
      var docs = snap.docs, chain = Promise.resolve();
      for (var i = 0; i < docs.length; i += BATCH_SIZE) (function (group) {
        chain = chain.then(function () {
          var batch = fb.db.batch();
          group.forEach(function (d) { batch.delete(d.ref); });
          return batch.commit();
        });
      })(docs.slice(i, i + BATCH_SIZE));
      return chain;
    });
  }).concat([
    eachLimit(written, CLONE_CONCURRENCY, function (p) {
      return fb.bucket.file(p).delete().catch(function () { /* never written, or already gone */ });
    })
  ])).then(function () {
    // only the placeholder this request made: if the real document was written, this is not reached
    return fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        if (snap.exists && (snap.data() || {}).cloningFrom) tx.delete(ref);
      });
    });
  }).catch(function (err) {
    console.error('api-events: clone of "' + dst + '" failed and could not be fully undone — ' + ((err && err.message) || err));
  });
}

function handleEventClone(req, res) {
  requireAdmin(req, res, function (fb, decoded) {
    parseJsonBody(req, res, function (body) {
      guard(res, 'clone', function () {
        var src = readEventIdFrom(body.sourceEventId);
        var dst = typeof body.eventId === 'string' ? body.eventId.trim() : '';
        if (!src) return sendJson(res, 400, { error: 'Choose the event to copy (sourceEventId).' });
        if (!dst) return sendJson(res, 400, { error: 'Enter an address for the new event.' });
        if (!isEventId(dst)) {
          return sendJson(res, 400, { error: 'An address can use lowercase letters, numbers and hyphens only, up to 80 characters.' });
        }
        if (body.name != null && typeof body.name !== 'string') return sendJson(res, 400, { error: 'The event name must be text.' });
        if (isReservedEventId(dst)) {
          return suggestFreeSlug(fb, dst).then(function (suggestion) {
            sendJson(res, 400, { error: reservedMessage(suggestion), code: 'slug-reserved', suggestion: suggestion });
          }).catch(function (err) { fail(res, 'clone', err, 'The event could not be copied. Please try again.'); });
        }

        var actor = actorOf(decoded), now = new Date().toISOString();
        var srcRef = eventRef(fb, src), dstRef = eventRef(fb, dst);
        var rewrite = referenceRewriter(src, dst);
        var source = null, reserved = false, written = [], copied = null, counts = null, finalDoc = null;

        function taken() {
          return suggestFreeSlug(fb, dst).then(function (suggestion) {
            throw reject(409, 'That address is already used by another event.' + (suggestion ? ' Try "' + suggestion + '".' : ''),
              { code: 'slug-taken', suggestion: suggestion });
          });
        }

        srcRef.get().then(function (snap) {
          if (!snap.exists || !isTaken(snap)) throw reject(404, 'The event to copy was not found.');
          source = snap.data() || {};
          if (source.deletedAt) throw reject(404, 'The event to copy has been deleted. Restore it first.');
          if (src === dst) return taken();
          return targetLeftovers(fb, dst);
        }).then(function (leftovers) {
          if (leftovers.length) return taken();
          return fb.db.runTransaction(function (tx) {
            return tx.get(dstRef).then(function (snap) {
              if (isTaken(snap)) return false;
              // set, not merge: whatever shell was at this address is replaced, not blended into the copy
              tx.set(dstRef, { cloningFrom: src, createdAt: now, createdBy: actor, updatedAt: now, status: 'draft', published: false });
              return true;
            });
          });
        }).then(function (won) {
          if (!won) return taken();
          reserved = true;
          return copyFiles(fb, src, dst, rewrite, written);
        }).then(function (c) {
          copied = c;
          return copyContent(fb, src, dst, rewrite, actor, now);
        }).then(function (c) {
          counts = c;
          var data = {};
          Object.keys(source).forEach(function (k) {
            if (NOT_CLONED_FIELDS.indexOf(k) === -1) data[k] = mapStrings(source[k], rewrite);
          });
          var sourceName = str(source.name, 200);
          data.name = str(body.name, 200) || (sourceName ? sourceName + ' (Copy)' : dst);
          data.slug = dst;
          data.status = 'draft';
          data.published = false;
          data.counters = { registrations: 0, views: 0 };
          data.createdAt = now; data.updatedAt = now; data.detailsUpdatedAt = now; data.createdBy = actor; data.updatedBy = actor;
          data.clonedFrom = src;
          if (source.templateId === 'gen-' + src) data.templateId = 'gen-' + dst;
          /* The saved site's record is carried over whole — lib/api.js owns its shape (version,
             snapshotVersion, …) and compares a save's baseVersion with it, and the copied files are the
             very content those numbers name. Only who, when and a self-pointing template id are new. */
          var site = source.site;
          if (copied.site && site && typeof site === 'object') {
            data.site = mapStrings(site, rewrite);
            data.site.version = site.version || 1;
            data.site.templateId = site.templateId === 'gen-' + src ? 'gen-' + dst : (site.templateId || data.templateId || null);
            data.site.updatedAt = now; data.site.updatedBy = actor;
          }
          finalDoc = data;
          return dstRef.set(data);
        }).then(function () {
          reserved = false;       // from here on the copy is a real event; a later failure must not undo it
          var label = '"' + (str(source.name, 120) || src) + '" (' + src + ')';
          return Promise.all([
            logActivity(fb, dst, decoded, 'cloned', 'copied from ' + label),
            logActivity(fb, src, decoded, 'cloned', 'copied to "' + str(finalDoc.name, 120) + '" (' + dst + ')')
          ]);
        }).then(function () {
          sendJson(res, 200, {
            eventId: dst, name: finalDoc.name, templateId: finalDoc.templateId || null, createdAt: now,
            copied: Object.assign({}, counts, { files: copied.files, site: !!finalDoc.site })
          });
        }).catch(function (err) {
          if (!reserved) return fail(res, 'clone', err, 'The event could not be copied. Please try again.');
          undoClone(fb, dst, written).then(function () {
            fail(res, 'clone', err, 'The event could not be copied, and nothing was created. Please try again.');
          });
        });
      });
    }, 16 * 1024);
  });
}

module.exports = { handleUpload, handleSlugAvailable, handleEventDelete, handleEventRestore, handleEventClone };

// Exported for tests and for the other backend modules to share ONE definition of each (the address rule,
// "this event exists", what an image is) instead of growing a second copy. Routing uses only the five above.
module.exports._shared = { isTaken, slugify, suggestFreeSlug, reservedMessage, sniffImage, referenceRewriter, UPLOAD_KINDS, CONTENT_COLLECTIONS };
