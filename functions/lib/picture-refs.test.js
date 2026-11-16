/* node functions/lib/picture-refs.test.js — the pictures ETB2B AI's picture model is shown beside a job's words
   (lib/picture-refs.js, builder C, plan of 16 Nov 2026 §6): this event's own pictures only, never a logo or Content's
   photos, at most three, each labelled for what it is for (the subject, or style only), the previous edition style
   only, none with people for a picture that may show people, and the copy guard (dHash) on identical, re-encoded,
   cropped and different pictures. No network and no paid AI: Storage, Firestore, the fetcher and the check's model
   are stood in for; the pictures are drawn here with sharp. */
'use strict';
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }

var sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }
var llm = require('./llm');
var looks = [], lookAnswers = [];
llm.callJson = function (prompt, schema, opts) { looks.push(opts); return Promise.resolve(lookAnswers.length ? lookAnswers.shift() : { parsed: { people: false, text: false, logos: false } }); };
var safeFetch = require('./safe-fetch');
var fetched = [];
var refs = require('./picture-refs');
var pictureJob = require('./picture-job');

var BUCKET = 'test-bucket', EV = 'qa-paic-refs', OWN = 'https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/';
var OTHER = 'https://storage.googleapis.com/' + BUCKET + '/events/qa-other/';

/* a scene drawn from shapes: a sky, two hills and a road (seed 0), or a sun, a tower and a field (seed 1) */
function scene(seed, w, h) {
  w = w || 800; h = h || 600;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#' + (seed ? '203050' : '87a8d0') + '"/><stop offset="1" stop-color="#' + (seed ? 'e0c090' : 'f0e0c0') + '"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/>' +
    (seed ? '<circle cx="200" cy="420" r="150" fill="#335522"/><rect x="450" y="80" width="200" height="380" fill="#aa4422"/>'
      : '<polygon points="0,600 300,250 600,600" fill="#556677"/><polygon points="350,600 600,200 800,600" fill="#778899"/><rect x="100" y="480" width="600" height="60" fill="#222"/>') + '</svg>';
  return sharp(Buffer.from(svg)).resize(w, h, { fit: 'fill' }).png().toBuffer();
}

function fakeFb(files, events) {
  return { bucket: { name: BUCKET, file: function (p) { return { download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(new Error('No such object')); } }; } },
    db: { reads: 0, collection: function (c) { var db = this; return { doc: function (id) { return { get: function () { db.reads++; var d = events[c + '/' + id]; return Promise.resolve({ exists: !!d, data: function () { return d; } }); } }; } }; } } };
}

(async function () {
  /* ======================= which pictures ======================= */
  var CTX = { bucket: BUCKET, eventId: EV };
  check(refs.ownOnly(OWN + 'generated/20261116-chat-place-abc.png', CTX) === 'events/' + EV + '/generated/20261116-chat-place-abc.png' &&
    refs.ownOnly(OWN + 'chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p3.jpg?v=12', CTX) === 'events/' + EV + '/chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p3.jpg' &&
    refs.ownOnly(OWN + 'media/x.webp', { fb: { bucket: { name: BUCKET } }, eventId: EV }) === 'events/' + EV + '/media/x.webp', 'own: this event\'s own pictures, by their path in the bucket');
  [[OTHER + 'generated/a.png', 'another event\'s picture'], ['https://storage.googleapis.com/other-bucket/events/' + EV + '/generated/a.png', 'another bucket'],
    [OWN + 'generated/7-logo-unit.svg', 'the logo unit'], [OWN + 'generated/7-logo-unit-on-dark.png', 'its dark copy'], [OWN + 'logo/etb2b.png', 'a logo folder'],
    [OWN + 'speakers/s1.jpg', 'a speaker\'s photo'], [OWN + 'partners/p.png', 'a partner\'s logo'], [OWN + 'brief/a.pdf', 'a brief document'],
    [OWN + 'generated/../../qa-other/generated/a.png', 'a dot segment'], [OWN + 'generated/a%2f..%2fb.png', 'an escape'], [OWN + 'generated/a.png?x=1', 'a query other than ?v='],
    [OWN + 'generated/a.png#x', 'a fragment'], ['http://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/generated/a.png', 'http'], [OWN + 'generated/a.svg', 'a drawing'],
    [OWN + 'generated//a.png', 'an empty segment'], ['', 'nothing']].forEach(function (c) {
    check(refs.ownOnly(c[0], CTX) === '', 'own: refused — ' + c[1], c[0]);
  });
  check(refs.ownOnly(OWN + 'generated/a.png', { bucket: BUCKET }) === '' && refs.ownOnly(OWN + 'generated/a.png', { bucket: BUCKET, eventId: '../x' }) === '', 'own: no event, or a bad event id: nothing is own');
  check(refs.contentPhoto('events/' + EV + '/gallery/a.jpg') && !refs.contentPhoto('events/' + EV + '/generated/a.jpg'), 'a past edition\'s gallery photo is Content\'s');
  check(refs.ownersPhoto('events/' + EV + '/chat-docs/k/a.jpg') && refs.ownersPhoto('events/' + EV + '/media/a.jpg') && !refs.ownersPhoto('events/' + EV + '/generated/a.png') && !refs.ownersPhoto(''),
    'the owner\'s photos: everything of theirs but what ETB2B AI made (generated/)');

  if (!sharp) { check(true, '(no picture library here: the picture checks are skipped)'); return done(); }

  /* ======================= the copy guard ======================= */
  var A = await scene(0), B = await scene(1);
  var hA = await refs.dHash(A), hB = await refs.dHash(B);
  var reJpeg = await sharp(A).jpeg({ quality: 55 }).toBuffer();
  var crop5 = await sharp(A).extract({ left: 20, top: 15, width: 760, height: 570 }).toBuffer();
  var cropCorner = await sharp(A).extract({ left: 0, top: 0, width: 760, height: 570 }).toBuffer();
  var smaller = await sharp(A).resize(300).webp().toBuffer();
  check(/^[0-9a-f]{16}$/.test(hA) && /^[0-9a-f]{16}$/.test(hB), 'dHash: 64 bits as 16 hex digits', [hA, hB]);
  check(refs.distance(hA, hA) === 0 && refs.nearCopy(hA, hA), 'the same picture is a copy (0 bits apart)');
  var dJ = refs.distance(hA, await refs.dHash(reJpeg)), dC = refs.distance(hA, await refs.dHash(crop5)), dK = refs.distance(hA, await refs.dHash(cropCorner)), dS = refs.distance(hA, await refs.dHash(smaller));
  check(dJ >= 0 && dJ <= refs.COPY_DISTANCE && dS >= 0 && dS <= refs.COPY_DISTANCE, 're-encoded (JPEG 55) or made smaller as WebP: still a copy', [dJ, dS]);
  check(dC >= 0 && dC <= refs.COPY_DISTANCE && dK >= 0 && dK <= refs.COPY_DISTANCE, 'cropped by 5% (centred, or from a corner): still a copy', [dC, dK]);
  check(refs.distance(hA, hB) > refs.COPY_DISTANCE && !refs.nearCopy(hA, hB), 'a different picture is not a copy', refs.distance(hA, hB));
  check(refs.distance('zz', hA) === -1 && !refs.nearCopy(null, hA) && !refs.nearCopy('a', 'a') && (await refs.dHash(Buffer.from('not a picture'))) === null, 'no hash, no copy');
  var cc = await refs.copyCheck(reJpeg, [{ id: 'd3', kind: 'document', hash: hB }, { id: 'd1', kind: 'document', hash: hA }]);
  check(cc.copy === true && cc.id === 'd1' && cc.kind === 'document' && cc.distance <= refs.COPY_DISTANCE, 'copyCheck: the made picture is found to be a copy of the reference it repeats', cc);
  var cn = await refs.copyCheck(B, [{ id: 'd1', kind: 'document', hash: hA }]);
  check(cn.copy === false && cn.distance > refs.COPY_DISTANCE, 'copyCheck: a new picture is not', cn);
  var ce = await refs.copyCheck(A, [{ id: 'c', kind: 'current', hash: hA, guard: false }, { id: 'x', kind: 'site' }]);
  check(ce.copy === false, 'copyCheck: never against the picture an edit changes, nor a reference with no hash', ce);

  /* ======================= load ======================= */
  var big = await sharp(await scene(1, 2400, 1600)).jpeg({ quality: 90 }).toBuffer();
  var files = {};
  files['events/' + EV + '/chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p3.jpg'] = big;
  files['events/' + EV + '/media/owner.png'] = A;
  files['events/' + EV + '/generated/hero.png'] = B;
  files['events/' + EV + '/generated/section.png'] = A;
  files['events/' + EV + '/gallery/2025-1.jpg'] = await sharp(B).jpeg().toBuffer();
  files['events/qa-other/generated/a.png'] = A;
  var events = {};
  events['events/' + EV] = { pictureStyle: { refs: [OWN + 'generated/hero.png', { url: OWN + 'generated/section.png' }, OWN + 'generated/third.png'] } };
  var FB = fakeFb(files, events);
  function job(extra) { return pictureJob.normalise(Object.assign({ sectionId: 'what-awaits', subject: 'a promenade', mode: 'new', peopleRule: 'none' }, extra || {}), 0); }
  var ctx = { fb: FB, eventId: EV, deadlineAt: Date.now() + 200000 };

  var got = await refs.load(job({ refs: [
    { id: 'n2', kind: 'attachment', url: OWN + 'media/owner.png', use: 'style' },
    { id: 'n3', kind: 'document', url: OWN + 'chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p3.jpg', use: 'subject' },
    { id: 'n4', kind: 'attachment', url: OWN + 'media/owner.png', use: 'as-is' },
    { id: 'x', kind: 'document', url: OTHER + 'generated/a.png', use: 'subject' }] }), ctx);
  check(got.length === 2 && got[0].id === 'n3' && got[0].use === 'subject' && /^Reference 1, SUBJECT: /.test(got[0].label) && got[1].id === 'n2' && /^Reference 2, STYLE ONLY: /.test(got[1].label),
    'load: the subject first, then the style; each labelled for what it is for; one placed as it is is never shown; another event\'s is refused', got.map(function (r) { return [r.id, r.label.slice(0, 30)]; }));
  check(got.every(function (r) { return r.mimeType === 'image/jpeg' && typeof r.data === 'string' && /^[0-9a-f]{16}$/.test(r.hash) && r.guard === true && /^https:/.test(r.url); }),
    'load: each a JPEG with its hash, guarded against copying', got.map(function (r) { return [r.mimeType, r.hash, r.guard]; }));
  var m0 = await sharp(Buffer.from(got[0].data, 'base64')).metadata();
  check(Math.max(m0.width, m0.height) <= refs.REF_SIDE && m0.width === 1024, 'load: a large picture is shown at most ' + refs.REF_SIDE + ' px on its longest side', [m0.width, m0.height]);
  check(FB.db.reads === 0, 'load: a job with a style of its own does not read the site\'s style card');
  check(/never copy it/.test(got[0].label) && /take none of its content/.test(got[1].label) && !/\bET\b/.test(got.map(function (r) { return r.label; }).join(' ')), 'the labels: inspire, never copy; never a bare "ET"');

  /* a new picture with no style of its own takes the site's style card (one tone across the site), style only */
  got = await refs.load(job({ refs: [{ id: 'n3', kind: 'document', url: OWN + 'chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p3.jpg', use: 'subject' }] }), ctx);
  check(got.length === 3 && got[0].use === 'subject' && got[1].kind === 'site' && got[1].use === 'style' && got[2].kind === 'site' && got[2].use === 'style' && FB.db.reads === 1,
    'load: the site\'s own pictures from its style card, style only, after the subject; at most 3 in all', got.map(function (r) { return [r.kind, r.use]; }));
  got = await refs.load(job({ refs: [{ id: 's', kind: 'site', url: OWN + 'generated/hero.png', use: 'subject' }, { id: 'g', kind: 'attachment', url: OWN + 'gallery/2025-1.jpg', use: 'subject' }] }),
    Object.assign({}, ctx, { eventData: {} }));
  check(got.length === 2 && got.every(function (r) { return r.use === 'style' && /STYLE ONLY/.test(r.label); }), 'load: the site\'s own and a past edition\'s gallery photo are style only, whatever was asked', got.map(function (r) { return r.use; }));

  /* an edit: never the picture it changes (that is the edit's own input), never the site's style card */
  var reads = FB.db.reads;
  got = await refs.load(job({ mode: 'edit', refs: [{ id: 'c', kind: 'current', url: OWN + 'generated/section.png', use: 'style' }] }), ctx);
  check(got.length === 0 && FB.db.reads === reads, 'load: an edit is shown neither its own picture nor the style card', got.length);

  /* the previous edition: from ETB2B's own image servers, style only, through the safe fetcher */
  var realFetch = safeFetch.safeFetch;
  safeFetch.safeFetch = function (url, o) { fetched.push({ url: url, o: o }); return Promise.resolve({ status: 200, body: B }); };
  got = await refs.load(job({ refs: [{ id: 'p', kind: 'previous-edition', url: 'https://img.etb2bimg.com/files/2025/promenade.jpg', use: 'subject' },
    { id: 'q', kind: 'previous-edition', url: 'https://img.etb2bimg.com/files/2025/etcio-logo.png', use: 'style' }, { id: 'w', kind: 'previous-edition', url: 'https://example.com/a.jpg', use: 'style' }] }), Object.assign({}, ctx, { eventData: {} }));
  check(got.length === 1 && got[0].kind === 'previous-edition' && got[0].use === 'style' && /past edition of this event, for inspiration/.test(got[0].label) && fetched.length === 1 &&
    fetched[0].o.maxRedirects === 0 && fetched[0].o.maxBytes > 0, 'load: a previous edition\'s picture is style only, read from ETB2B\'s image servers only, never a logo there', { got: got.map(function (r) { return r.label; }), fetched: fetched });
  safeFetch.safeFetch = realFetch;

  /* people: a picture that may show people is never made from a reference with people in it */
  looks = [];
  lookAnswers = [{ parsed: { people: true, text: false, logos: false } }, { parsed: { people: false, text: false, logos: false } }];
  var two = [{ id: 'a', kind: 'attachment', url: OWN + 'media/owner.png', use: 'style' }, { id: 'b', kind: 'document', url: OWN + 'chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p3.jpg', use: 'subject' }];
  got = await refs.load(job({ peopleRule: 'allowed', refs: two }), Object.assign({}, ctx, { eventData: {} }));
  check(looks.length === 2 && got.length === 1 && looks.every(function (o) { return o.route === 'picture-check' && o.images[0].mimeType === 'image/jpeg'; }),
    'load: for a picture that may show people, each reference is looked at first (as the model would see it), and one with people is left out', { looks: looks.length, got: got.map(function (r) { return r.id; }) });
  looks = [];
  lookAnswers = [{ code: 'ai-unavailable' }, { code: 'ai-unavailable' }];
  got = await refs.load(job({ peopleRule: 'allowed', refs: two }), Object.assign({}, ctx, { eventData: {} }));
  check(got.length === 0, 'load: … and one that could not be looked at is left out too (it may have people)');
  looks = [];
  got = await refs.load(job({ peopleRule: 'none', refs: two }), Object.assign({}, ctx, { eventData: {} }));
  check(got.length === 2 && looks.length === 0, 'load: a picture with no people is not looked at for them (its own check finds any it draws)');

  /* time, and what is missing */
  check((await refs.load(job({ refs: two }), Object.assign({}, ctx, { deadlineAt: Date.now() + 20000 }))).length === 0, 'load: with less than a minute left, none (the picture itself needs the time)');
  check((await refs.load(job({ refs: two }), { eventId: EV })).length === 0 && (await refs.load(null, ctx)).length >= 0 && (await refs.load(job(), { fb: FB, eventId: '../x' })).length === 0, 'load: no Storage or no event: none, and it never throws');
  var gone = await refs.load(job({ refs: [{ id: 'z', kind: 'document', url: OWN + 'chat-docs/20261116120000-a1b2c3/zz-0123456789ab-p9.jpg', use: 'subject' }] }), Object.assign({}, ctx, { eventData: {} }));
  check(gone.length === 0, 'load: a picture no longer in Storage is left out');
  done();
})().catch(function (e) { console.error('picture-refs: the test itself stopped — ' + (e && e.stack || e)); process.exit(1); });

function done() {
  if (failures.length) { console.error('picture-refs: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('picture-refs: all ' + checks + ' checks passed');
}
