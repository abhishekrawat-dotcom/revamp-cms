/* node functions/lib/share-still.test.js — exits 1 when a check fails, listing every failure.
   The banner picture behind the share card of a site whose banner plays a video with no still (lib/share-still.js;
   the owner, 7 Nov 2026: "For video headers you have to generate a banner at your own"):
     1. what is asked for: the hero picture's own rules (the event's field and place, never its name; no people, no
        words, no logos; 16:9), light or dark as the logo unit stands, in the site's own colours
     2. made once: stored privately, recorded on the event, never made again once there; two at once make one
     3. the picture check: a picture with people, words or a logo is made once more with the stronger line; found
        wanting again, or not checkable, nothing is used and the record says why
     4. how often it is tried again: a model failure after ten minutes, a refused picture after a day, and never more
        than MAX_ROUNDS refused or abandoned makings, and MAX_CLAIMS makings in all, for one event, ever; the caller's
        record is enough to skip the database while it waits
     5. nothing for an event that is gone, and nothing for a real event under the QA guard
   No network, no AI: Firestore and Storage are in memory; the picture model and the check are stubbed. */
'use strict';
delete process.env.K_SERVICE;
delete process.env.QA_SHARE_ONLY_QA;

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
var realError = console.error;
function quietly(fn) { console.error = function () {}; return Promise.resolve().then(fn).then(function (v) { console.error = realError; return v; }, function (e) { console.error = realError; throw e; }); }

/* ---------- a Firestore and Storage in memory ---------- */
var FB = (function () {
  var docs = {}, files = {}, meta = {}, publics = {}, txCalls = { n: 0 };
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function apply(p, patch) {
    var d = docs[p];
    if (!d) { var e = new Error('NOT_FOUND: ' + p); e.code = 5; throw e; }
    Object.keys(patch).forEach(function (k) {
      var parts = k.split('.'), o = d;
      for (var i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
      o[parts[parts.length - 1]] = clone(patch[k]);
    });
  }
  function snap(p) { var d = docs[p]; return { exists: !!d, data: function () { return clone(d); } }; }
  function ref(p) { return { path: p, get: function () { return Promise.resolve(snap(p)); }, update: function (patch) { return Promise.resolve().then(function () { apply(p, patch); }); } }; }
  return {
    docs: docs, files: files, meta: meta, publics: publics, txCalls: txCalls,
    db: {
      collection: function (n) { return { doc: function (id) { return ref(n + '/' + id); } }; },
      runTransaction: function (fn) {
        txCalls.n++;
        var writes = [];
        var tx = { get: function (r) { return Promise.resolve(snap(r.path)); }, update: function (r, patch) { writes.push([r.path, patch]); } };
        return Promise.resolve(fn(tx)).then(function (v) { writes.forEach(function (w) { apply(w[0], w[1]); }); return v; });
      }
    },
    bucket: {
      name: 'test-bucket',
      file: function (p) {
        return {
          save: function (buf, opts) { files[p] = Buffer.from(buf); meta[p] = (opts && opts.metadata) || {}; return Promise.resolve(); },
          makePublic: function () { publics[p] = true; return Promise.resolve(); },
          delete: function () { delete files[p]; return Promise.resolve(); }
        };
      }
    }
  };
})();

var still = require('./share-still');
var T = still._test;
var usage = [];
still.wire({ aiUsageRecorder: function (fb, eventId, route) { return function (u) { usage.push({ eventId: eventId, route: route, u: u }); }; } });

/* the picture model: answers a 1 × 1 PNG (or what a test asks), and records what it was asked */
var PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
var asked = [], answers = [], looks = [];
T.setModels({
  image: function (prompt, opts) {
    asked.push({ prompt: prompt, opts: opts });
    var a = answers.length ? answers.shift() : 'png';
    if (a === 'fail') return Promise.resolve({ code: 'ai-unavailable', error: 'down', retryable: true });
    if (a === 'throw') return Promise.reject(new Error('socket hang up'));
    return new Promise(function (r) { setTimeout(function () { r({ base64: PNG.toString('base64'), mimeType: 'image/png', usage: { pictures: 1, provider: 'gemini' } }); }, 5); });
  },
  check: function () { var f = looks.length ? looks.shift() : { people: false, text: false, logos: false }; return Promise.resolve(f); }
});
var EVENT = { name: 'Brand World Summit 2026', portal: 'brandequity', venue: 'Taj Wellington Mews', city: 'Chennai', category: 'ip', createdAt: '2026-10-01T00:00:00.000Z' };
var WANT = { tone: 'light', colours: { theme: '#f42a58', accent: '#f13411' } };
function seed(id, extra) { FB.docs['events/' + id] = Object.assign(JSON.parse(JSON.stringify(EVENT)), extra || {}); return FB.docs['events/' + id]; }
function rec(id) { return FB.docs['events/' + id].shareStill; }
function stillFiles(id) { return Object.keys(FB.files).filter(function (p) { return p.indexOf('events/' + id + '/share-card/still-') === 0; }); }

(async function () {
  /* ===================== 1. what is asked for ===================== */
  var prompt = still.promptFor(EVENT, WANT);
  ok(/KEY VISUAL for the hero banner/.test(prompt) && /marketing and advertising|creative studios/.test(prompt) && /Taj Wellington Mews, Chennai/.test(prompt) && /Chennai/.test(prompt),
    'the hero picture\'s key visual, of the event\'s field (its portal\'s) at its place', prompt.slice(0, 600));
  ok(prompt.indexOf('Brand World Summit') === -1, 'never the event\'s name (an image model letters it onto the picture)');
  ok(/carries no words at all/.test(prompt) && /no people in any form/i.test(prompt) && /logo/i.test(prompt) && /16:9/.test(prompt), 'no people, no words, no logos; 16:9');
  ok(/bright and airy/.test(prompt) && /#f42a58/i.test(prompt) && /#f13411/i.test(prompt), 'light, as the logo unit on it stands, in the site\'s own colours', prompt.slice(-900));
  ok(/dark and moody/.test(still.promptFor(EVENT, { tone: 'dark' })), 'dark for a unit drawn for a dark ground');
  ok(/no mannequins, dress forms, dolls, statues, idols, busts, or sculpted or painted figures of any kind/.test(prompt) && /not on a temple/.test(prompt),
    'no mannequins and no statues, not even on a temple (the check counts them as people: QA, 11 Nov)');
  ok(/no hands, arms or gloves, not even one holding a camera, a light or a microphone/.test(prompt) && /every camera and light stands on its own or on a stand/.test(prompt),
    'no hands working the cameras (production Brand World Summit: "people", and a small hand on the one that passed)');
  ok(/No posters, banners, signboards, framed pictures, or lettering on cameras, lights or packaging/.test(prompt) && /plain, with no label/.test(prompt),
    'no posters, signboards, framed pictures or lettered packaging (production Brand World Summit: "text", then "people" and "text")');
  ok(prompt.indexOf(' STRICT, for this picture: ') !== -1 && prompt.lastIndexOf('STRICT, for this picture:') > prompt.indexOf('Landscape, 16:9'),
    'the forms this picture may not have come after the hero picture\'s own rules');

  /* ===================== 2. made once ===================== */
  var ID = 'qa-still-1';
  seed(ID);
  var r1 = await still.ensure(FB, ID, FB.docs['events/' + ID], WANT, {});
  ok(r1 && r1.state === 'ready' && /^https:\/\/storage\.googleapis\.com\/test-bucket\/events\/qa-still-1\/share-card\/still-[a-z0-9]+\.png$/.test(r1.url) && FB.files[r1.path] && !FB.publics[r1.path],
    'made, stored under the event\'s share-card folder, and kept private (only the server draws from it)', r1);
  ok(rec(ID).state === 'ready' && rec(ID).url === r1.url && rec(ID).tries === 1 && rec(ID).rounds === 0 && rec(ID).checks.length === 1 && /marketing/.test(rec(ID).subject),
    'recorded on the event: the picture, what it is of, its check', rec(ID));
  ok(asked.length === 1 && asked[0].opts.aspectRatio === '16:9' && asked[0].opts.route === 'share-still' && asked[0].opts.eventId === ID, 'one wide 16:9 picture, asked for under its own route');
  ok(usage.some(function (x) { return x.eventId === ID && x.route === 'share-still' && x.u.pictures === 1; }), 'what the model used goes into the event\'s AI usage');
  ok(/max-age=31536000/.test(FB.meta[r1.path].cacheControl) && FB.meta[r1.path].contentType === 'image/png', 'stored as what it is, cached a year (a name is never reused)');
  var n0 = asked.length;
  var r2 = await still.ensure(FB, ID, FB.docs['events/' + ID], WANT, { known: rec(ID) });
  var r3 = await still.ensure(FB, ID, FB.docs['events/' + ID], WANT, {});
  ok(r2 && r2.url === r1.url && r3 && r3.url === r1.url && asked.length === n0 && stillFiles(ID).length === 1, 'never made again once it is there (a publish or a visit later)');
  ok(still.readyUrl(FB.docs['events/' + ID]) === r1.url && still.readyUrl({}) === '' && still.readyUrl({ shareStill: { state: 'ready', url: 'http://x/y.png' } }) === '', 'readyUrl: the picture when there is one, an https address only');
  var ID2 = 'qa-still-2';
  seed(ID2);
  var both = await Promise.all([still.ensure(FB, ID2, FB.docs['events/' + ID2], WANT, {}), still.ensure(FB, ID2, FB.docs['events/' + ID2], WANT, {})]);
  ok(both[0] && both[1] && both[0].url === both[1].url && stillFiles(ID2).length === 1 && asked.length === n0 + 1, 'two asks at once on one server: one picture');
  /* another server is making it: this one leaves it */
  var ID3 = 'qa-still-3';
  seed(ID3, { shareStill: { state: 'making', at: new Date().toISOString(), rounds: 0 } });
  var tx0 = FB.txCalls.n;
  ok(await still.ensure(FB, ID3, FB.docs['events/' + ID3], WANT, { known: rec(ID3) }) === null && FB.txCalls.n === tx0 && asked.length === n0 + 1, 'another server is making it: nothing asked, not even of the database');
  ok(await still.ensure(FB, ID3, FB.docs['events/' + ID3], WANT, {}) === null && asked.length === n0 + 1, '… and its claim is respected');
  FB.docs['events/' + ID3].shareStill.at = new Date(Date.now() - T.MAKING_TTL_MS - 1000).toISOString();
  var taken = await still.ensure(FB, ID3, FB.docs['events/' + ID3], WANT, {});
  ok(taken && taken.state === 'ready', 'a making mark older than its time is somebody\'s that died: taken over');

  /* ===================== 3. the picture check ===================== */
  var ID4 = 'qa-still-4';
  seed(ID4);
  var n4 = asked.length;
  looks = [{ people: true, text: false, logos: false }, { people: false, text: false, logos: false }];
  var r4 = await still.ensure(FB, ID4, FB.docs['events/' + ID4], WANT, {});
  ok(r4 && r4.state === 'ready' && rec(ID4).tries === 2 && rec(ID4).checks.length === 2 && rec(ID4).checks[0].people === true, 'a picture with a person in it: made once more, and the second one used', rec(ID4));
  ok(asked.length === n4 + 2 && /SECOND TRY, STRICT/.test(asked[n4 + 1].prompt) && /people/.test(asked[n4 + 1].prompt.slice(-400)), 'the second is asked with the check\'s stronger line');
  var ID5 = 'qa-still-5';
  seed(ID5);
  looks = [{ people: false, text: true, logos: false }, { people: false, text: true, logos: true }];
  process.env.QA_SHARE_KEEP_HELD = '1';
  var r5 = await still.ensure(FB, ID5, FB.docs['events/' + ID5], WANT, {});
  delete process.env.QA_SHARE_KEEP_HELD;
  ok(rec(ID5).kept && rec(ID5).kept.length === 2 && rec(ID5).kept.every(function (k) { return FB.files[k] && !FB.publics[k] && /\/share-card\/held-/.test(k); }),
    'QA_SHARE_KEEP_HELD=1 (the harness only): the refused pictures are kept privately, to be looked at', rec(ID5).kept);
  ok(r5 === null && rec(ID5).state === 'held' && rec(ID5).why === 'twice' && rec(ID5).found.join() === 'text,logos' && rec(ID5).rounds === 1 && stillFiles(ID5).length === 0,
    'found wanting twice (words, then words and a logo): nothing stored, nothing used, and why', rec(ID5));
  var ID6 = 'qa-still-6';
  seed(ID6);
  looks = [null, null];
  var r6 = await quietly(function () { return still.ensure(FB, ID6, FB.docs['events/' + ID6], WANT, {}); });
  ok(r6 === null && rec(ID6).state === 'held' && rec(ID6).why === 'unchecked' && stillFiles(ID6).length === 0, 'a picture that cannot be checked is not used (it must pass the check)', rec(ID6));
  var ID7 = 'qa-still-7';
  seed(ID7);
  looks = [{ people: true, text: false, logos: false }];
  answers = ['png', 'fail'];
  var r7 = await quietly(function () { return still.ensure(FB, ID7, FB.docs['events/' + ID7], WANT, {}); });
  ok(r7 === null && rec(ID7).state === 'held' && rec(ID7).why === 'failed' && rec(ID7).rounds === 1, 'the second picture could not be made: held, with why');
  ok(!rec(ID7).kept && !Object.keys(FB.files).some(function (k) { return k.indexOf('events/' + ID7 + '/share-card/held-') === 0; }), 'otherwise a refused picture is never stored');

  /* ===================== 4. how often it is tried again ===================== */
  var ID8 = 'qa-still-8';
  seed(ID8);
  answers = ['fail'];
  var n8 = asked.length;
  var r8 = await quietly(function () { return still.ensure(FB, ID8, FB.docs['events/' + ID8], WANT, {}); });
  ok(r8 === null && rec(ID8).state === 'failed' && rec(ID8).reason === 'ai-unavailable' && rec(ID8).rounds === 0, 'the model made nothing: recorded as failed, no round spent', rec(ID8));
  tx0 = FB.txCalls.n;
  ok(await still.ensure(FB, ID8, FB.docs['events/' + ID8], WANT, { known: rec(ID8) }) === null && FB.txCalls.n === tx0 && asked.length === n8 + 1, 'not tried again on the next visit (the record is enough: no database call)');
  FB.docs['events/' + ID8].shareStill.at = new Date(Date.now() - T.RETRY_MS.failed - 1000).toISOString();
  var r8b = await still.ensure(FB, ID8, FB.docs['events/' + ID8], WANT, { known: rec(ID8) });
  ok(r8b && r8b.state === 'ready', 'tried again ten minutes later, and made');
  answers = ['throw'];
  var ID9 = 'qa-still-9';
  seed(ID9);
  var r9 = await quietly(function () { return still.ensure(FB, ID9, FB.docs['events/' + ID9], WANT, {}); });
  ok(r9 === null && rec(ID9).state === 'failed', 'a call that throws is a failure like any other (never a rejection)');
  /* refused pictures: a day later, and at most MAX_ROUNDS times */
  ok(!still.mayMake(rec(ID5), Date.now()) && still.mayMake(rec(ID5), Date.now() + T.RETRY_MS.held + 1000), 'a refused picture: tried again a day later');
  FB.docs['events/' + ID5].shareStill.at = new Date(Date.now() - T.RETRY_MS.held - 1000).toISOString();
  looks = [{ people: true, text: false, logos: false }, { people: true, text: false, logos: false }];
  var n5 = asked.length;
  await still.ensure(FB, ID5, FB.docs['events/' + ID5], WANT, {});
  ok(rec(ID5).state === 'held' && rec(ID5).rounds === 2 && asked.length === n5 + 2, 'the second round, refused too', rec(ID5));
  FB.docs['events/' + ID5].shareStill.at = new Date(Date.now() - 30 * T.RETRY_MS.held).toISOString();
  ok(await still.ensure(FB, ID5, FB.docs['events/' + ID5], WANT, {}) === null && asked.length === n5 + 2 && still.MAX_ROUNDS === 2,
    'and after ' + still.MAX_ROUNDS + ' refused rounds never again (at most 4 pictures for one event, ever)');

  /* abandoned makings and a model that keeps failing: bounded for good */
  var ID10 = 'qa-still-10';
  seed(ID10, { shareStill: { state: 'making', at: new Date(Date.now() - T.MAKING_TTL_MS - 1000).toISOString(), rounds: 0, claims: 1 } });
  var r10 = await still.ensure(FB, ID10, FB.docs['events/' + ID10], WANT, {});
  ok(r10 && r10.state === 'ready' && rec(ID10).rounds === 1 && rec(ID10).claims === 2, 'a making left half way by another server counts as a round (its picture may have been paid for)', rec(ID10));
  var ID11 = 'qa-still-11';
  seed(ID11, { shareStill: { state: 'making', at: new Date(Date.now() - T.MAKING_TTL_MS - 1000).toISOString(), rounds: 1, claims: 3 } });
  var n11 = asked.length;
  ok(await still.ensure(FB, ID11, FB.docs['events/' + ID11], WANT, {}) === null && asked.length === n11 && rec(ID11).state === 'held' && rec(ID11).why === 'stopped' && rec(ID11).last === true,
    'one abandoned making too many: held for good, no picture asked', rec(ID11));
  ok(rec(ID5).last === true && rec(ID9).last === false, 'a record says when nothing will be tried again (the console says so)', [rec(ID5).last, rec(ID9).last]);
  ok(!still.mayMake({ state: 'failed', at: '2020-01-01T00:00:00.000Z', rounds: 0, claims: still.MAX_CLAIMS }, Date.now()) && still.mayMake({ state: 'failed', at: '2020-01-01T00:00:00.000Z', rounds: 0, claims: still.MAX_CLAIMS - 1 }, Date.now()),
    'a model that keeps failing: at most ' + still.MAX_CLAIMS + ' makings for one event, ever');

  /* ===================== 5. gone, and the QA guard ===================== */
  var GONE = 'qa-still-gone';
  seed(GONE, { deletedAt: '2026-11-02T00:00:00.000Z' });
  var nG = asked.length;
  ok(await still.ensure(FB, GONE, FB.docs['events/' + GONE], WANT, {}) === null && asked.length === nG && !rec(GONE), 'a deleted event: nothing made, nothing written');
  /* removed while the picture was being made: not written back, and its file not left behind */
  var GONE2 = 'qa-still-gone2';
  seed(GONE2);
  T.setModels({ image: function () { FB.docs['events/' + GONE2].deletedAt = '2026-11-02T00:00:00.000Z'; return Promise.resolve({ base64: PNG.toString('base64'), mimeType: 'image/png' }); } });
  ok(await still.ensure(FB, GONE2, FB.docs['events/' + GONE2], WANT, {}) === null && stillFiles(GONE2).length === 0 && !(rec(GONE2) && rec(GONE2).state === 'ready'), 'removed meanwhile: nothing recorded as ready, no file left');
  process.env.QA_SHARE_ONLY_QA = '1';
  var REAL = 'brand-world-summit-2026';
  seed(REAL);
  var nR = asked.length;
  ok(await still.ensure(FB, REAL, FB.docs['events/' + REAL], WANT, {}) === null && asked.length === nR && !rec(REAL) && stillFiles(REAL).length === 0, 'QA_SHARE_ONLY_QA=1: nothing made or written for a real event');
  delete process.env.QA_SHARE_ONLY_QA;

  if (failures.length) {
    console.error('share-still: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('share-still: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
