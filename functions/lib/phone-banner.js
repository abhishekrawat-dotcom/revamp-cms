/* The banner's own picture for phones, made by ETB2B AI from the banner the site has now (the owner, 13 Nov 2026,
   about the hero copied to ETB2B's own CMS: "A mobile version of hero background banner should be there, currently it
   is blank. (add option to generate mobile banner on the basis of current background banner)").

   WHY. A banner is drawn wide: its subject often stands at its two edges with open space in the middle, where the
   site's logo and words go. A phone shows that picture in a tall frame (background-size: cover), which keeps only the
   middle quarter of its width — the open space — so on a phone the banner looked blank. A phone banner is the same
   picture laid out again for the tall frame (editor-phone-banner.js puts it on the page, for screens up to 767px).

     POST /api/event/phone-banner   { eventId, source }    source: the address of the banner's picture now
       200 { url, made: true }                the phone banner, stored with the event's generated pictures
       400 bad-event | bad-source             no event id; a source that is not an https address of a picture
       404 no-event                           not an event that is live
       409 phone-banner-busy                  one is being made for this event right now (on this server)
       422 phone-banner-source { error }      the banner's picture could not be read: unreachable, too large, or not
                                              a PNG, JPEG or WebP (a drawing, an SVG, cannot be laid out again)
       422 phone-banner-held { error, found } made twice, and the second still had people, words or a logo that the
                                              banner itself does not have: nothing is stored, the page is untouched
       429 phone-banner-daily                 the person's new ETB2B AI pictures for today are used up
       the picture model's own failures in gemini.js's shape ({ error, code, retryable }), 502 phone-banner-not-stored

   WHAT. One call to the picture model (gemini.js callGeminiImage) with the banner itself as the picture to work from
   (opts.image) and a tall 9:16 shape (opts.aspectRatio), told to keep the picture's look and subject and to lay it
   out again for the tall frame — its subject as large as in the banner, never stretched, cropped off or left small in
   the corners, the middle softer for the logo and words but never empty (QA, 13 Nov 2026: the first wording, "keep the
   middle open", gave the owner's banner back with its subject shrunk into the four corners), nothing added — under the rules every picture ETB2B AI makes carries: no people, words or logos of its own, and the ET
   logos' rule (api.js ET_LOGO_COLOUR_RULE: the red ET square is never changed). Stored as the editor's other new
   pictures are (events/<id>/generated/, public, cached a year, WebP copies by pictures.js).

   CHECKED. The made picture is looked at by the editor's own picture check (chat-picture.js checkPicture: people,
   words, logos). What it found is held against what the banner already has (the banner is looked at too, only then):
   people, words or a logo the banner itself shows are the owner's own and may stay; any the model ADDED are not. A
   picture that added some is made ONCE more with a stronger line; found wanting again, nothing is stored (422). A
   check that cannot be made does not hold a picture back (the rule of every other picture ETB2B AI makes).

   LIMITS. One of the person's new ETB2B AI pictures for the day: the editor's own count (aiQuota/<person>, the one
   the chat's new pictures use, chat-picture.js PER_DAY), taken in a transaction before the model is asked; a second
   try takes another; a picture that could not be made is counted as a failed attempt instead, as the chat's are. One
   at a time per event on a server. What the models used goes into the event's aiUsage ('phone-banner',
   'phone-banner-check'); the event's History says ETB2B AI made it.

   The page is not changed here: the editor puts the picture in (one step that Undo takes back) and saves it with the
   site, as it does every picture. lib/api.js routes the request here and hands over its helpers on every call
   (wire()), as it does for lib/ai-hero.js. Loading this file reads nothing, writes nothing and needs no environment. */
'use strict';
const gemini = require('./gemini');
const pictures = require('./pictures');
const safeFetch = require('./safe-fetch');
const chatPicture = require('./chat-picture');

var H = null;
var NEEDS = ['withAdminBody', 'sendJson', 'sendFailure', 'sendAiFailure', 'BODY_LIMITS', 'chatUid', 'isEventId', 'aiUsageRecorder', 'logActivity', 'ET_LOGO_COLOUR_RULE'];
/* run without its sign-in check it would make pictures for anyone, so a wiring with parts missing is refused */
function wire(helpers) {
  var missing = NEEDS.filter(function (k) { return !helpers || helpers[k] == null; });
  if (missing.length) throw new Error('lib/phone-banner.js needs ' + missing.join(', ') + ' from lib/api.js');
  H = helpers;
}
function wired(res) {
  if (H) return true;
  res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' }));
  return false;
}

/* every clock reading goes through here, so a test can stop time; the source is read through here, so a test can
   stand in for the network */
var clock = { now: function () { return Date.now(); } };
var net = { fetch: function (url, opts) { return safeFetch.safeFetch(url, opts); } };

var ASPECT = '9:16';                       // a phone's screen, upright (gemini.js IMAGE_ASPECTS)
var CAPS = {
  perDay: chatPicture.PER_DAY,             // the editor's new pictures, one count for the chat's and these
  sourceBytes: 8 * 1024 * 1024,            // a banner larger than this is not sent to the model (as an upload's limit)
  sourceTimeoutMs: 20000,
  timeoutMs: 90000,                        // one picture call (chat-picture.js TIMEOUT_MS)
  deadlineMs: chatPicture.DEADLINE_MS,     // two pictures and their checks, inside the function's time
  variantsBudgetMs: 15000,
  lockMs: 5 * 60 * 1000                    // longer than a request can live: one older than this never finished
};
var TYPES = ['image/png', 'image/jpeg', 'image/webp'];
var EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

var MSG = {
  badEvent: 'eventId is required.',
  badSource: 'The banner’s picture has no web address this can read. Set the banner’s picture first, then try again.',
  noEvent: 'This event was not found. It may have been removed.',
  busy: 'A phone banner is already being made for this event. Wait for it, then try again.',
  daily: 'You’ve made {n} new pictures with ETB2B AI today — the most one person can make in a day. Nothing on your site changed. You can still upload a phone banner of your own, or try again tomorrow.',
  failDaily: 'ETB2B AI has tried {n} new pictures for you today that could not be made — the most it tries for one person in a day. Nothing on your site changed. You can still upload a phone banner of your own, or try again tomorrow.',
  unreadable: 'The banner’s picture could not be read, so no phone banner was made. Nothing on your site changed — check that the banner shows on the site, then try again.',
  tooLarge: 'The banner’s picture is larger than 8 MB, so it cannot be laid out again here. Nothing on your site changed — upload a phone banner of your own instead.',
  notRaster: 'The banner’s picture is not a PNG, JPEG or WebP photo or illustration, so it cannot be laid out again here. Nothing on your site changed — upload a phone banner of your own instead.',
  notStored: 'The phone banner was made but could not be saved. Nothing on your site changed — try again.',
  failed: 'The phone banner could not be made just now. Nothing on your site changed — try again.'
};

/* ---------- the picture model's words ---------- */

/* What the picture model is told. The banner itself goes with it (opts.image). ET_LOGO_COLOUR_RULE: api.js's rule for
   the ET logos, which every prompt that may meet one carries. */
function promptFor(logoRule) {
  return [
    'Lay this event website\'s banner picture out again as a tall, upright picture for a phone\'s screen (9:16): the same banner, made for a phone.',
    'KEEP ITS LOOK: it must read at once as the same picture — the same scene and subject, the same objects, materials, colours, light, finish, style and mood. Do not change its palette, add a filter, or turn a photograph into an illustration or an illustration into a photograph.',
    'LAY IT OUT FOR THE TALL FRAME — IT MUST NOT LOOK EMPTY ON A PHONE: bring its main subject and its most telling parts into the tall frame at a size a phone shows clearly — as large against the frame\'s width as they are in the banner, or larger — moving, regrouping or stacking them rather than leaving them small in the corners or cutting them off at the sides, and continue its background (sky, floor, walls, open space) naturally above and below. Never stretch, squash or distort anything, and leave no blank or mirrored bands.',
    'LEAVE ROOM FOR THE WORDS, NOT A VOID: on the website the event\'s logo, its title and its buttons sit over the middle of the picture, so the subject sits mainly in its upper and lower parts and at its sides, and the middle is softer and less busy — but still part of the scene (its light, floor, sky or space), never a blank sheet.',
    'ADD NOTHING: no new objects, and no people, faces, figures, silhouettes, words, letters, numbers or logos that the banner does not already have. Anything of that kind already in it is kept exactly as it is — never redrawn, respelled, recoloured or reshaped.',
    String(logoRule || '').trim()
  ].filter(Boolean).join('\n');
}
/* the line a second picture ends with: what the first one added that the banner does not have */
function againLine(flags) {
  return 'SECOND TRY, STRICT: the first picture made from this banner added ' + chatPicture.foundText(flags) +
    ', which the banner itself does not have. This one adds none: every person, word, letter, number and logo in it is one the banner already shows, and nothing else.';
}
/* what a made picture has that the banner does not: found (the made picture's look) less what the banner's own look
   found; either look missing (it could not be made) holds nothing back */
function added(found, own) {
  if (!found || !own) return [];
  return chatPicture.refusedFor(found, 'none').filter(function (f) { return chatPicture.refusedFor(own, 'none').indexOf(f) === -1; });
}
/* why no phone banner was made, plainly. flags: what the last picture added; why: 'twice' | 'limit' | 'time' | 'failed' */
function heldSentence(flags, why) {
  var found = chatPicture.foundText(flags);
  var lead = why === 'twice' ? 'ETB2B AI made it twice, and the second picture still added ' + found + ' that your banner does not have'
    : 'the picture ETB2B AI made added ' + found + ' that your banner does not have, and ' + (why === 'limit' ? 'a second try would have gone past your new pictures for today'
      : why === 'time' ? 'there was no time left for a second try' : 'a second try could not be made');
  return 'No phone banner was made: ' + lead + '. Nothing on your site changed — try again, or upload a phone banner of your own.';
}

/* ---------- the banner's picture ---------- */

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function line(v, max) { return (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, max); }
/* an address this can read: https, nothing that could end a url() or start markup */
function usableSource(url) { return /^https:\/\/[^\s"'()<>\\]{1,2000}$/.test(String(url || '')); }

/* The banner's picture as bytes. One of this event's own files is read from the bucket (it may not be public, and
   nothing goes over the network); any other address through safe-fetch.js, which never reaches our own network.
   -> Promise<{ bytes, type } | { stop: 'unreadable' | 'tooLarge' | 'notRaster' }> (never rejects) */
function readSource(fb, eventId, url) {
  var path = pictures.pathOfUrl(url, fb.bucket && fb.bucket.name);
  var own = !!path && path.indexOf('events/' + eventId + '/') === 0;
  var got = own
    ? Promise.resolve().then(function () { return fb.bucket.file(path).download(); }).then(function (r) { return Buffer.isBuffer(r && r[0]) ? r[0] : Buffer.from(r && r[0] || ''); })
    : Promise.resolve().then(function () { return net.fetch(url, { accept: 'image/', maxBytes: CAPS.sourceBytes, timeoutMs: CAPS.sourceTimeoutMs }); })
      .then(function (r) { return r && r.status >= 200 && r.status < 300 ? r.body : Promise.reject(Object.assign(new Error('the banner answered ' + (r && r.status)), { code: 'unreachable' })); });
  return got.then(function (bytes) {
    if (!bytes || !bytes.length) return { stop: 'unreadable' };
    if (bytes.length > CAPS.sourceBytes) return { stop: 'tooLarge' };
    var type = chatPicture.sniff(bytes);
    if (TYPES.indexOf(type) === -1) return { stop: 'notRaster' };
    return { bytes: bytes, type: type };
  }, function (err) {
    console.error('phone-banner: the banner of ' + eventId + ' could not be read (' + (own ? 'bucket' : 'web') + ') — ' + (err && (err.code || err.message)));
    return { stop: err && err.code === 'too-large' ? 'tooLarge' : err && err.code === 'bad-type' ? 'notRaster' : 'unreadable' };
  });
}

/* ---------- the person's pictures for the day (the editor's count: chat-picture.js aiQuota) ---------- */

function quotaRef(fb, decoded) { return fb.db.collection('aiQuota').doc(chatPicture.quotaId(H.chatUid(decoded))); }
function int(v) { v = parseInt(v, 10); return v >= 0 ? Math.min(v, 100000) : 0; }
function quotaOf(raw, day) {
  var d = isObj(raw) ? raw : {};
  return d.day === day ? { day: day, made: int(d.made), failed: int(d.failed) } : { day: day, made: 0, failed: 0 };
}
/* one more picture taken from today's -> Promise<{ day } | { stop: 'daily' | 'failDaily' }> */
function reserve(fb, decoded) {
  var ref = quotaRef(fb, decoded), now = clock.now(), day = chatPicture.istDay(now);
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var q = quotaOf(snap && snap.exists ? snap.data() : null, day);
      if (q.made >= CAPS.perDay) return { stop: 'daily' };
      if (q.failed >= CAPS.perDay) return { stop: 'failDaily' };
      tx.set(ref, { day: day, made: q.made + 1, failed: q.failed, updatedAt: new Date(now).toISOString() });
      return { day: day };
    });
  });
}
/* a picture that was taken but could not be made: counted as a failed attempt instead (not for a server's own
   set-up fault, as the chat's) — never rejects */
function giveBack(fb, decoded, held, code) {
  var ref = quotaRef(fb, decoded), now = clock.now();
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var raw = snap && snap.exists ? snap.data() : null;
      if (!held || !raw || raw.day !== held.day) return;
      tx.set(ref, { day: raw.day, made: Math.max(0, int(raw.made) - 1), failed: int(raw.failed) + (code === 'ai-config' ? 0 : 1), updatedAt: new Date(now).toISOString() });
    });
  }).catch(function (err) { console.error('phone-banner: a failed picture could not be counted — ' + (err && err.message)); });
}

/* ---------- the route ---------- */

var making = {};            // eventId -> when a phone banner began to be made for it on this server (ms)

function live(ev) { return !!ev && !!ev.createdAt && !ev.deletedAt && !ev.discardingAt; }
function safe(record) {
  return function (usage) {
    if (!record || !usage) return;
    try { record(usage); } catch (e) { console.error('phone-banner: usage not recorded — ' + (e && e.message)); }
  };
}

function handle(req, res) {
  if (!wired(res)) return;
  H.withAdminBody(req, res, H.BODY_LIMITS.tiny || 16 * 1024, function (fb, decoded, body) {
    var eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
    if (!H.isEventId(eventId)) return H.sendJson(res, 400, { error: MSG.badEvent, code: 'bad-event' });
    var source = line(body.source, 2100);
    if (!usableSource(source)) return H.sendJson(res, 400, { error: MSG.badSource, code: 'bad-source' });
    /* one older than a request can live (its deadline, then storing) was left by one that never finished */
    if (making[eventId] && clock.now() - making[eventId] < CAPS.lockMs) return H.sendJson(res, 409, { error: MSG.busy, code: 'phone-banner-busy', retryable: true });
    making[eventId] = clock.now();
    /* the event is free again before the answer goes, so a request that follows it at once is never told it is busy */
    var done = function () { delete making[eventId]; };
    function send(status, body) { done(); H.sendJson(res, status, body); }
    var started = clock.now();
    Promise.resolve().then(function () { return fb.db.collection('events').doc(eventId).get(); }).then(function (snap) {
      if (!snap.exists || !live(snap.data())) return send(404, { error: MSG.noEvent, code: 'no-event' });
      return readSource(fb, eventId, source).then(function (src) {
        if (src.stop) return send(422, { error: MSG[src.stop], code: 'phone-banner-source' });
        return reserve(fb, decoded).then(function (held) {
          if (held.stop) return send(429, { error: MSG[held.stop].replace('{n}', CAPS.perDay), code: 'phone-banner-daily' });
          return make(fb, decoded, eventId, src, held, started).then(function (out) {
            if (out.ai) { done(); return H.sendAiFailure(res, out.ai); }
            send(out.status, out.body);
          });
        });
      });
    }).catch(function (err) { done(); H.sendFailure(res, 'phone-banner', err, MSG.failed); });
  });
}

/* The picture, its check against the banner's own, once more when it added what the banner does not have, and then
   stored — or held back with why. -> Promise<{ status, body } | { ai: failure }> */
function make(fb, decoded, eventId, src, held, started) {
  var by = String(decoded.email || decoded.uid || '');
  var record = safe(H.aiUsageRecorder(fb, eventId, 'phone-banner'));
  var recordCheck = safe(H.aiUsageRecorder(fb, eventId, 'phone-banner-check'));
  var deadlineAt = started + CAPS.deadlineMs, prompt = promptFor(H.ET_LOGO_COLOUR_RULE);
  var image = { mimeType: src.type, data: src.bytes.toString('base64') };
  var looks = [], ownLook;

  /* -> Promise<{ bytes, type } | { ai }>, never rejects */
  function picture(text, until) {
    var call;
    try {
      call = Promise.resolve(gemini.callGeminiImage(text, { image: image, aspectRatio: ASPECT, route: 'phone-banner', eventId: eventId, user: by, timeoutMs: CAPS.timeoutMs, deadlineAt: until }));
    } catch (err) { call = Promise.reject(err); }
    return call.then(function (r) {
      if (r) record(r.usage);
      if (!r || r.error || !r.base64) return { ai: r && r.error ? r : Object.assign(gemini.failure('ai-bad-output'), { provider: 'gemini' }) };
      var bytes = Buffer.from(String(r.base64), 'base64'), type = chatPicture.sniff(bytes);
      if (!type) {
        console.error('phone-banner: the picture model answered ' + bytes.length + ' bytes that are not a PNG, JPEG or WebP');
        return { ai: Object.assign(gemini.failure('ai-bad-output'), { provider: 'gemini' }) };
      }
      return { bytes: bytes, type: type };
    }, function (err) {
      console.error('phone-banner: the picture call for ' + eventId + ' failed — ' + (err && err.message));
      return { ai: Object.assign(gemini.failure('ai-unavailable'), { provider: 'gemini' }) };
    });
  }
  function checkOf(bytes, type) { return chatPicture.checkPicture(bytes, type, 'none', { eventId: eventId, deadlineAt: deadlineAt, record: recordCheck }); }
  /* what the made picture added: the banner is looked at once, and only when the made picture has something */
  function look(pic) {
    return checkOf(pic.bytes, pic.type).then(function (found) {
      looks.push(found);
      if (!chatPicture.refusedFor(found, 'none').length) return [];
      var own = ownLook !== undefined ? Promise.resolve(ownLook) : checkOf(src.bytes, src.type).then(function (o) { ownLook = o; return o; });
      return own.then(function (o) { return added(found, o); });
    });
  }

  return picture(prompt, deadlineAt).then(function (first) {
    if (first.ai) return giveBack(fb, decoded, held, first.ai.code).then(function () { return { ai: first.ai }; });
    return look(first).then(function (flags) {
      if (!flags.length) return store(first, 1);
      if (deadlineAt - clock.now() < chatPicture.RETRY_NEEDS_MS) return hold(flags, 'time');
      return reserve(fb, decoded).catch(function () { return { stop: 'daily' }; }).then(function (again) {
        if (again.stop) return hold(flags, 'limit');
        return picture(prompt + '\n' + againLine(flags), deadlineAt - chatPicture.CHECK_RESERVE_MS).then(function (second) {
          if (second.ai) return giveBack(fb, decoded, again, second.ai.code).then(function () { return hold(flags, 'failed'); });
          return look(second).then(function (left) { return left.length ? hold(left, 'twice') : store(second, 2); });
        });
      });
    });
  });

  function hold(flags, why) {
    var said = heldSentence(flags, why);
    try {
      H.logActivity(fb, eventId, decoded, 'ai-chat', 'ETB2B AI made no phone banner for the site: the picture added ' + chatPicture.foundText(flags) + ' that the banner does not have' +
        (why === 'twice' ? ', on a second try too' : ''), { area: 'design' });
    } catch (e) { console.error('phone-banner: the History line was not written — ' + (e && e.message)); }
    return { status: 422, body: { error: said, code: 'phone-banner-held', found: flags.slice(0, 3) } };
  }
  function store(pic, tries) {
    /* named after the moment it was asked for, like every generated picture: what one name holds never changes */
    var storagePath = 'events/' + eventId + '/generated/' + started.toString(36) + '-phone-banner.' + EXT[pic.type];
    var file = fb.bucket.file(storagePath);
    return Promise.resolve().then(function () { return file.save(pic.bytes, { metadata: { contentType: pic.type, cacheControl: pictures.CACHE } }); })
      .then(function () { return file.makePublic(); })
      .then(function () {
        return Promise.resolve().then(function () { return pictures.storeVariants(fb, storagePath, pic.bytes, { budgetMs: CAPS.variantsBudgetMs }); })
          .catch(function (err) { console.error('phone-banner: the WebP copies of ' + storagePath + ' were not made — ' + (err && err.message)); });
      })
      .then(function () {
        var url = 'https://storage.googleapis.com/' + fb.bucket.name + '/' + storagePath;
        try {
          H.logActivity(fb, eventId, decoded, 'ai-chat', 'ETB2B AI made a phone banner from the site’s banner' + (tries > 1 ? ' (on a second try)' : '') +
            (looks.some(function (l) { return !l; }) ? ' — it could not be checked' : ''), { area: 'design' });
        } catch (e) { console.error('phone-banner: the History line was not written — ' + (e && e.message)); }
        return { status: 200, body: { url: url, made: true } };
      }, function (err) {
        console.error('phone-banner: the picture for ' + eventId + ' was made but not stored — ' + (err && err.message));
        return giveBack(fb, decoded, held, 'phone-banner-not-stored').then(function () {
          return { status: 502, body: { error: MSG.notStored, code: 'phone-banner-not-stored', retryable: true } };
        });
      });
  }
}

module.exports = { wire: wire, handle: handle, ASPECT: ASPECT };
module.exports._test = { CAPS: CAPS, MSG: MSG, clock: clock, net: net, making: making, promptFor: promptFor, againLine: againLine, added: added,
  heldSentence: heldSentence, usableSource: usableSource, readSource: readSource, quotaOf: quotaOf };
