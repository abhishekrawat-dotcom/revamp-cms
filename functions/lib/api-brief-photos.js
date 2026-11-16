/* POST /api/brief-photos — the photos of the owner's own presentation, kept with the brief Create Event read from it
   (CREATE-FROM-DECK.md §5.2; owner, 16 Nov 2026: "design it according to the uploaded presentation").

   Create Event, with "Follow this presentation's look and photos" ticked, takes the deck's photos out in the browser
   (create-deck.js → ai-doc-pictures.js, the editor's own reader), stores them a few at a time through POST
   /api/chat/doc-pictures with purpose 'brief' (doc-pictures.js: events/<id>/brief-photos/<key>/), and then calls this
   with their addresses and a render of each key slide:

     body: { eventId, runId, briefId, key, doc, pictures: [{ url, thumb, page, w, h, share, words }], leftOut,
             slides: [{ page, data (base64 JPEG, at most 200 KB) }] }

   Checked: every address is one of this event's own brief-photos/<key>/ files (one key); the brief exists and is this
   run's; at most 32 photos and 24 slides; a slide is a JPEG by its own bytes. The slides are stored PRIVATE beside the
   brief's PDF (events/<id>/briefs/<briefId>/slides/p<n>.jpg): they hold the deck's words and are for the models only.
   Each photo is looked at once (deck-photos.js classify: Claude Haiku, six to a call, side by side; a photo that could
   not be checked is held). The list is written to briefs/<briefId>.deck — BESIDE `extracted`, never inside it (the
   prompts show `extracted` as JSON and must never see an address). One History line says what was kept and held.
   -> { kept, held: [{ page, why }], leftOut, line } */
'use strict';

var docPictures = require('./doc-pictures');
var deckPhotos = require('./deck-photos');
var llm = require('./llm');

var H = null;
function wire(helpers) { H = helpers; }

var MSG = {
  bad: 'The photos from your presentation could not be kept. Choose the file again and retry.',
  brief: 'The presentation this run read is not on record. Retry the step that reads it first.',
  failed: 'The photos from your presentation could not be checked just now. Retry.'
};
var B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function slideJpeg(v) {
  var s = typeof v === 'string' ? v.replace(/^data:image\/jpeg;base64,/, '').replace(/\s+/g, '') : '';
  if (!s || !B64_RE.test(s) || s.length * 0.75 > deckPhotos.CAPS.slideBytes + 3) return null;
  var buf = Buffer.from(s, 'base64');
  if (buf.length < 100 || buf.length > deckPhotos.CAPS.slideBytes || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return null;
  return buf;
}
var RUN_RE = /^[A-Za-z0-9_-]{1,64}$/, BRIEF_RE = /^[A-Za-z0-9]{10,40}$/;

/* the request checked: -> { error } | { pictures, slides, leftOut, key, runId, briefId } */
function checkBody(body, eventId, ownPrefix) {
  body = body && typeof body === 'object' ? body : {};
  var runId = typeof body.runId === 'string' ? body.runId : '', briefId = typeof body.briefId === 'string' ? body.briefId : '';
  var key = typeof body.key === 'string' ? body.key : '';
  if (!RUN_RE.test(runId) || !BRIEF_RE.test(briefId) || !docPictures.KEY_RE.test(key)) return { error: 'bad' };
  var raw = Array.isArray(body.pictures) ? body.pictures : null, slidesIn = Array.isArray(body.slides) ? body.slides : [];
  if (!raw || !raw.length || raw.length > deckPhotos.CAPS.photos || slidesIn.length > deckPhotos.CAPS.slides) return { error: 'bad' };
  /* every address this event's own, in this one folder */
  var mine = raw.every(function (p) {
    return p && docPictures.ownPath(p.url, ownPrefix, ['brief-photos']) && docPictures.ownPath(p.thumb, ownPrefix, ['brief-photos']) &&
      String(p.url).indexOf(ownPrefix + 'brief-photos/' + key + '/') === 0 && String(p.thumb).indexOf(ownPrefix + 'brief-photos/' + key + '/') === 0;
  });
  if (!mine) return { error: 'bad' };
  var pictures = docPictures.cleanPictures(raw, ownPrefix, ['brief-photos']);
  if (pictures.length !== raw.length) return { error: 'bad' };
  var slides = [], pages = {};
  for (var i = 0; i < slidesIn.length; i++) {
    var s = slidesIn[i] || {}, page = Number(s.page), buf = slideJpeg(s.data);
    if (!Number.isInteger(page) || page < 1 || page > 1000 || !buf || pages[page]) return { error: 'bad' };
    pages[page] = 1;
    slides.push({ page: page, bytes: buf });
  }
  var lo = body.leftOut && typeof body.leftOut === 'object' ? body.leftOut : {}, leftOut = {};
  ['plain', 'small', 'flat', 'strip', 'repeat', 'unread', 'over', 'unstored'].forEach(function (k) { var n = Number(lo[k]); if (Number.isInteger(n) && n > 0 && n < 100000) leftOut[k] = n; });
  return { pictures: pictures, slides: slides, leftOut: leftOut, key: key, runId: runId, briefId: briefId };
}

function handleBriefPhotos(req, res) {
  H.withAdminBody(req, res, H.BODY_LIMITS.briefPhotos, function (fb, decoded, body) {
    var eventId = String((body && body.eventId) || '').trim();
    if (!H.isEventId(eventId)) return H.sendJson(res, 400, { error: 'eventId is required.', code: 'bad-request' });
    var ownPrefix = 'https://storage.googleapis.com/' + fb.bucket.name + '/events/' + eventId + '/';
    var got = checkBody(body, eventId, ownPrefix);
    if (got.error) return H.sendJson(res, 400, { error: MSG.bad, code: 'bad-photos' });
    var eventRef = fb.db.collection('events').doc(eventId), briefRef = eventRef.collection('briefs').doc(got.briefId);
    var by = (decoded && (decoded.email || decoded.uid)) || '';
    Promise.all([eventRef.get(), briefRef.get()]).then(function (snaps) {
      var ev = snaps[0], brief = snaps[1];
      if (!ev.exists || (ev.data() || {}).deletedAt) return H.sendJson(res, 404, { error: 'This event does not exist.', code: 'no-event' });
      var b = brief.exists ? brief.data() || {} : null;
      if (!b || b.runId !== got.runId) return H.sendJson(res, 409, { error: MSG.brief, code: 'no-brief' });
      var base = 'events/' + eventId + '/briefs/' + got.briefId + '/slides/';
      /* the slides, private (never makePublic): for the models only */
      var keptSlides = Promise.all(got.slides.map(function (s) {
        var path = base + 'p' + s.page + '.jpg';
        return fb.bucket.file(path).save(s.bytes, { metadata: { contentType: 'image/jpeg', cacheControl: 'private, max-age=0' } }).then(function () { return { page: s.page, path: path }; }, function (err) {
          console.error('brief-photos: slide ' + s.page + ' of ' + eventId + ' was not kept — ' + (err && err.message));
          return null;
        });
      }));
      var checked = deckPhotos.classify(got.pictures, {
        eventId: eventId, callJson: llm.callJson, onUsage: H.aiUsageRecorder(fb, eventId, 'deck-photos'),
        ownPath: function (u) { return docPictures.ownPath(u, ownPrefix, ['brief-photos']); },
        download: function (path) { return fb.bucket.file(path).download().then(function (r) { return r[0]; }); },
        deadlineAt: Date.now() + 100000
      });
      return Promise.all([keptSlides, checked]).then(function (both) {
        var slides = both[0].filter(Boolean).sort(function (x, y) { return x.page - y.page; }), photos = both[1];
        var deck = { key: got.key, at: new Date().toISOString(), by: by, runId: got.runId, photos: photos, leftOut: got.leftOut, slides: slides,
          checked: photos.every(function (p) { return p.checked === true; }) };
        return briefRef.update({ deck: deck }).then(function () {
          var sum = deckPhotos.summary(deck);
          var line = deckPhotos.historyLine(deck, b.sourceFileName || (body && body.doc) || 'your presentation');
          H.sendJson(res, 200, { kept: sum.kept, held: sum.held, leftOut: got.leftOut, line: line });
          try { H.logActivity(fb, eventId, decoded, 'brief-updated', line, { area: 'content' }); } catch (e) { console.error('brief-photos: the History line was not written — ' + (e && e.message)); }
        });
      });
    }).catch(function (err) {
      console.error('brief-photos: ' + eventId + ' — ' + (err && (err.stack || err.message)));
      H.sendJson(res, 500, { error: MSG.failed, code: 'brief-photos-failed', retryable: true });
    });
  });
}

module.exports = { wire: wire, handleBriefPhotos: handleBriefPhotos, _test: { checkBody: checkBody, slideJpeg: slideJpeg } };
