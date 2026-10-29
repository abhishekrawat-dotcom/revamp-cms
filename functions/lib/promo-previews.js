/* Promotions → Mailers: what each card shows (owner B, 2026-10-29). Every TEMPLATES card is this event's own mail
   and every RECENTLY UPDATED / saved-version card is that version, drawn by the platform's engine exactly as it is
   sent (the plain render: no editor hooks, no placeholders), in one request:

     POST /api/promo/mailer/previews   { eventId, templates: boolean, saveIds: [≤ 40] }   (≤ 16 KB)
       -> { items: [ { key: 'tpl:<mailerId>' | 'save:<saveId>', html, example, filled, state, missing }
                   | { key, missing, example: false, filled: [], state: null }      still unavailable: no picture
                   | { key, error: 'render failed' | 'too large' | 'not found' } ] }
       gzipped when the browser takes it; never cached.

   One request for every card, because the cost is the event (promo-mailer.js eventFor: the kit, the page, the
   records — and buildKit's live-event check), not the drawing: the 18 mailers render in a few milliseconds
   (map-previews §2). The templates come in the engine's own order (ALL_MAILERS), then the saves as asked.

   A mailer the event lacks data for (requires() fails):
     - a gap that is a fact about the event (it is over, nominations are closed, no date) -> the real mail, with
       `state` for the card's chip and no example in it;
     - a gap in a list or an award's facts -> the real design with only that gap filled from the example library
       (promo-examples.js fillFor), marked inside the HTML (a <meta> and a visible "EXAMPLE PREVIEW" first row)
       and flagged example: true with `filled`, so the card wears an Example badge and can be neither opened nor
       downloaded;
     - anything else -> no picture, only `missing` (the card keeps its "needs …" line).
   A saved version is drawn with the event's current mail banner (promo-mailer.js withCurrentBanner), as a
   download of it would be.

   What this never does: take a document from the browser (ids only in, HTML only out), hand back a document,
   record activity, or track anything. Example content leaves only inside marked HTML, which every send path
   refuses (promo-examples.js isExample). */
'use strict';
const zlib = require('zlib');
const engine = require('./vendor/promo-engine');
const mailer = require('./promo-mailer');
const examples = require('./promo-examples');
const { sendJson } = require('./http');

var H = null;
/* lib/api.js hands over its helpers on each call. promo-mailer.js is wired here too: its eventFor reads them, and
   on a cold instance a previews request can be the first Promotions request it serves. */
function wire(helpers) { H = helpers; mailer.wire(helpers); }

var MAX_SAVES = 40;
var MAX_HTML = 400 * 1024;            // an imported mail can come close to the 900 KB document limit: a card is not the place for it
var SAVE_ID = /^[A-Za-z0-9_-]{1,60}$/; // promo-mailer.js getSave's rule

/* { templates, saveIds } from the body, or { error } */
function askedOf(body) {
  var ids = body.saveIds == null ? [] : body.saveIds;
  if (!Array.isArray(ids)) return { error: 'saveIds must be a list of saved-version ids.' };
  if (ids.some(function (id) { return typeof id !== 'string' || !SAVE_ID.test(id); })) return { error: 'saveIds must be a list of saved-version ids.' };
  ids = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
  if (ids.length > MAX_SAVES) return { error: 'At most ' + MAX_SAVES + ' saved versions can be previewed at a time.' };
  return { templates: body.templates === true, saveIds: ids };
}

function tooLarge(html) { return Buffer.byteLength(html, 'utf8') > MAX_HTML; }
function drawn(key, html, example, filled, state, missing) {
  if (tooLarge(html)) return { key: key, error: 'too large' };
  return { key: key, html: html, example: example, filled: filled, state: state, missing: missing };
}
/* the mail as it is sent: the plain render of a fresh build */
function plainMail(m, ev, params) { return engine.renderDoc(engine.buildDoc(m, ev, params || {}), ev); }

/* one TEMPLATES card. base: the app's public address, for the example pictures */
function templateItem(m, ev, base) {
  var key = 'tpl:' + m.id;
  try {
    var avail = m.requires(ev);
    if (avail.ok) return drawn(key, plainMail(m, ev), false, [], null, []);
    var missing = (avail.missing || []).slice();
    var f = examples.fillFor(m.id, ev, {}, { base: base });
    if (f.state) return drawn(key, plainMail(m, ev), false, [], f.state, missing);
    if (f.filled.length && m.requires(f.ev).ok) {
      return drawn(key, examples.markMailHtml(plainMail(m, f.ev, f.params), f.filled), true, f.filled.slice(), null, missing);
    }
    return { key: key, missing: missing, example: false, filled: [], state: null };
  } catch (err) {
    console.error('promo-previews: ' + m.id + ' could not be drawn — ' + (err && err.stack || err));
    return { key: key, error: 'render failed' };
  }
}

/* the asked saved versions, in the order asked. docs: their documents as read (null for one that is not there);
   got: eventFor's answer */
function saveItems(ids, docs, got) {
  return ids.map(function (id, i) {
    var key = 'save:' + id, d = docs && docs[i];
    if (!d || !d.exists) return { key: key, error: 'not found' };
    try {
      var v = d.data() || {}, doc = JSON.parse(v.doc);
      if (!doc || typeof doc !== 'object' || !Array.isArray(doc.blocks)) throw new Error('not a block document');
      doc = engine.migrateSponsorTiers(doc, got.ev);
      /* the banner a download of this version would carry now, not the one it was saved with */
      doc = mailer._internal.withCurrentBanner(doc, got) || doc;
      return drawn(key, engine.renderDoc(doc, got.ev), false, [], null, []);
    } catch (err) {
      console.error('promo-previews: saved version ' + id + ' could not be drawn — ' + (err && err.stack || err));
      return { key: key, error: 'render failed' };
    }
  });
}
/* Only the asked documents are read (≤ 40, side by side), not the whole collection: after a Save the studio asks
   for that one version again, and an event's other versions (each up to 900 KB) need not be read for it.
   Firestore keeps ids of the form __name__ for itself: .doc() accepts one, but the read then fails (api.js isRecordId).
   That one failure would turn the whole request into a 500, so such an id is never read. It answers "not found",
   as no saved version can carry one, and the other cards still draw. */
var RESERVED_ID = /^__.*__$/;
function readSaves(fb, eventId, ids) {
  var col = mailer._internal.savesOf(fb, eventId);
  return Promise.all(ids.map(function (id) { return RESERVED_ID.test(id) ? null : col.doc(id).get(); }));
}

/* gzip when the browser takes it: named, else under "*"; a q of 0 refuses it (RFC 9110 §12.5.3) */
function acceptsGzip(req) {
  var q = Object.create(null);
  String((req.headers && req.headers['accept-encoding']) || '').toLowerCase().split(',').forEach(function (part) {
    var m = /^\s*([a-z0-9*-]+)\s*(?:;\s*q\s*=\s*([0-9.]+))?\s*$/.exec(part);
    if (m && !(m[1] in q)) q[m[1]] = m[2] == null ? 1 : +m[2];
  });
  var v = 'gzip' in q ? q.gzip : '*' in q ? q['*'] : 0;
  return v > 0;
}
function send(req, res, obj) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* socket already gone */ } return; }
  var raw = Buffer.from(JSON.stringify(obj), 'utf8'), body = raw;
  var headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Accept-Encoding' };
  if (raw.length > 1024 && acceptsGzip(req)) {
    try { body = zlib.gzipSync(raw, { level: 6 }); headers['Content-Encoding'] = 'gzip'; } catch (e) { body = raw; }
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
}
function fail(res, err) {
  H.sendFailure(res, 'promo mailer previews', err, 'The mailer previews could not be drawn. Please try again.');
}

/* POST /api/promo/mailer/previews */
function handlePreviews(req, res) {
  H.withAdminBody(req, res, H.BODY_LIMITS.tiny, function (fb, decoded, body) {
    var eventId = H.eventIdOr400(res, body.eventId);
    if (!eventId) return;
    var asked = askedOf(body);
    if (asked.error) return sendJson(res, 400, { error: asked.error });
    /* nothing to draw: still only for an event that exists */
    if (!asked.templates && !asked.saveIds.length) {
      return H.loadLiveEvent(fb, eventId).then(function () { send(req, res, { items: [] }); }).catch(function (err) { fail(res, err); });
    }
    var savesRead = asked.saveIds.length ? readSaves(fb, eventId, asked.saveIds) : Promise.resolve(null);
    savesRead.catch(function () { /* answered below; nobody waits on it when the event turns out not to be there */ });
    Promise.all([mailer.eventFor(fb, eventId, req), savesRead]).then(function (r) {
      var got = r[0], items = [];
      if (asked.templates) {
        var base = H.publicBaseFor(req);
        engine.ALL_MAILERS.forEach(function (m) { items.push(templateItem(m, got.ev, base)); });
      }
      if (asked.saveIds.length) items = items.concat(saveItems(asked.saveIds, r[1], got));
      send(req, res, { items: items });
    }).catch(function (err) { fail(res, err); });
  });
}

module.exports = { wire: wire, handlePreviews: handlePreviews };
module.exports._test = { askedOf: askedOf, templateItem: templateItem, saveItems: saveItems, acceptsGzip: acceptsGzip, MAX_SAVES: MAX_SAVES, MAX_HTML: MAX_HTML };
