/* node functions/lib/phone-banner.test.js — the banner's own picture for phones, made by ETB2B AI from the banner the
   site has now (lib/phone-banner.js; the owner, 13 Nov 2026: "A mobile version of hero background banner should be
   there, currently it is blank. (add option to generate mobile banner on the basis of current background banner)"):
     P.1  POST /api/event/phone-banner through lib/api.js (its real sign-in check and helpers): checks, the banner read
          from this event's own files (the bucket) or from the web (safe-fetch), the model asked to lay THAT picture
          out for a tall 9:16 screen under the picture rules (the ET logos' rule included), stored as generated
          pictures are, the History line and the AI usage
     P.2  the person's pictures for the day: the editor's own count (aiQuota), shared with the chat's new pictures
     P.3  the check: what the made picture ADDED that the banner does not have is refused (made once more, then held);
          people, words or a logo the banner itself shows are the owner's own and may stay
     P.4  failures: the model, the storage, an unreadable banner — nothing stored, the count says a failed attempt
     P.5  one at a time per event
   No network, no AI: Firebase is in memory, gemini.js callGeminiImage, llm.js callJson (the check), pictures.js
   storeVariants and the web read are stubbed. */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
delete process.env.K_SERVICE;

/* ---------- Firebase in memory ---------- */
var docs = {}, files = {}, seq = 0, failSave = false;
function write(target, data, merge) {
  Object.keys(data).forEach(function (k) {
    var v = data[k];
    if (merge && v && typeof v === 'object' && !Array.isArray(v)) { if (!target[k] || typeof target[k] !== 'object') target[k] = {}; write(target[k], v, true); }
    else target[k] = clone(v);
  });
}
function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? clone(d) : undefined; } }; }
function docRef(p) {
  return { id: p.split('/').pop(), path: p,
    collection: function (n) { return colRef(p + '/' + n); },
    get: function () { return Promise.resolve(snap(p)); },
    set: function (data, o) { if (!(o && o.merge) || !docs[p]) docs[p] = (o && o.merge && docs[p]) || {}; write(docs[p], data, !!(o && o.merge)); return Promise.resolve(); },
    update: function (data) { if (!docs[p]) return Promise.reject(new Error('5 NOT_FOUND')); write(docs[p], data, false); return Promise.resolve(); } };
}
function colRef(p) {
  return { path: p,
    doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(8, '0')))); },
    add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(8, '0')); return r.set(data).then(function () { return r; }); },
    get: function () { return Promise.resolve({ docs: Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap) }); } };
}
var FB = {
  db: { collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var writes = [];
      var tx = { get: function (ref) { return ref.get(); }, set: function (ref, d, o) { writes.push(function () { return ref.set(d, o); }); }, update: function (ref, d) { writes.push(function () { return ref.update(d); }); } };
      return Promise.resolve(fn(tx)).then(function (out) { return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return out; }); });
    } },
  bucket: { name: 'test-bucket', file: function (path) {
    return { save: function (bytes, o) { if (failSave) return Promise.reject(new Error('fake: storage refused')); files[path] = { bytes: bytes, metadata: o && o.metadata, public: false }; return Promise.resolve(); },
      makePublic: function () { files[path].public = true; return Promise.resolve(); },
      download: function () { return files[path] ? Promise.resolve([files[path].bytes]) : Promise.reject(Object.assign(new Error('No such object: ' + path), { code: 404 })); } };
  } },
  auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, name: 'Asha Rao', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };

/* ---------- the models, the WebP copies and the web, stubbed ---------- */
function pngOf(tag) { return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag || 'a picture')]); }
function jpgOf(tag) { return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]), Buffer.from(tag || 'a photo')]); }
var gemini = require('./gemini');
var imageCalls = [], imageQueue = [], hold = null;
function picAnswer(tag) { return { mimeType: 'image/png', base64: pngOf(tag || 'the phone banner').toString('base64'), provider: 'gemini', usage: { provider: 'gemini', inputTokens: 1600, outputTokens: 1290, pictures: 1 } }; }
gemini.callGeminiImage = function (prompt, opts) {
  imageCalls.push({ prompt: prompt, opts: opts });
  var a = imageQueue.length ? imageQueue.shift() : picAnswer();
  if (hold) return hold.then(function () { return a; });
  return Promise.resolve(a);
};
var llm = require('./llm');
var checkCalls = [], checkQueue = [];
llm.callJson = function (prompt, schema, opts) {
  checkCalls.push({ prompt: prompt, opts: opts });
  var found = checkQueue.length ? checkQueue.shift() : { people: false, text: false, logos: false };
  if (opts && typeof opts.onUsage === 'function') opts.onUsage({ provider: 'claude', inputTokens: 1600, outputTokens: 20, usd: 0.002 });
  return Promise.resolve({ parsed: found, provider: 'claude' });
};
var pictures = require('./pictures');
var variants = [];
pictures.storeVariants = function (fb, path, bytes, opts) { variants.push({ path: path, opts: opts }); return Promise.resolve(null); };

var api = require('./api');
var PB = require('./phone-banner');
var T = PB._test;
var NOW = Date.UTC(2026, 10, 13, 6, 35);   // Fri 13 Nov 2026, 12:05 in India
T.clock.now = function () { return NOW; };
var webCalls = [], webAnswer = null;
T.net.fetch = function (url, opts) { webCalls.push({ url: url, opts: opts }); return webAnswer ? webAnswer() : Promise.resolve({ status: 200, headers: {}, body: jpgOf('a web banner') }); };

function call(body, who) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'content-type': 'application/json' };
    if (who !== null) headers.authorization = 'Bearer ' + (who || 'asha');
    var req = { method: 'POST', url: '/api/event/phone-banner', headers: headers, socket: {}, rawBody: Buffer.from(JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k] = v; }, getHeader: function (k) { return res.headers[k]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b === undefined ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j }); } };
    api.handleApi(req, res);
  });
}
var EV = 'awards-2027';
var OWN = 'https://storage.googleapis.com/test-bucket/events/' + EV + '/media/banner-1350x600.jpg';
function reset() {
  docs = {}; files = {}; imageCalls = []; imageQueue = []; checkCalls = []; checkQueue = []; variants = []; webCalls = []; webAnswer = null; failSave = false; hold = null;
  docs['events/' + EV] = { name: 'Entrepreneur Awards 2027', portal: 'etcio', createdAt: '2026-11-01T00:00:00.000Z', createdBy: 'asha@timesinternet.in', templateId: 'gen-' + EV };
  files['events/' + EV + '/media/banner-1350x600.jpg'] = { bytes: jpgOf('the owner banner'), public: true };
}
function stored() { return Object.keys(files).filter(function (k) { return /-phone-banner\./.test(k); }); }
function history() { return Object.keys(docs).filter(function (k) { return k.indexOf('events/' + EV + '/activity/') === 0; }).map(function (k) { return docs[k]; }); }
function quota() { return docs['aiQuota/u-asha'] || null; }
var realError = console.error, logged = [];
function quiet() { logged = []; console.error = function () { logged.push(Array.prototype.join.call(arguments, ' ')); }; }
function loud() { console.error = realError; }

(async function () {
  /* ===== P.1 the request ===== */
  reset();
  var r = await call({ eventId: EV, source: OWN });
  check('P.1 made: 200 with the stored picture\'s address', r.status === 200 && r.body && r.body.made === true && /^https:\/\/storage\.googleapis\.com\/test-bucket\/events\/awards-2027\/generated\/[0-9a-z]+-phone-banner\.png$/.test(r.body.url), r);
  var s = stored();
  check('P.1 stored with the generated pictures: public, cached a year, its WebP copies made', s.length === 1 && files[s[0]].public === true && files[s[0]].metadata.contentType === 'image/png' &&
    files[s[0]].metadata.cacheControl === pictures.CACHE && variants.length === 1 && variants[0].path === s[0], { s: s, variants: variants });
  check('P.1 one call to the picture model, with the banner itself to work from and a tall 9:16 shape', imageCalls.length === 1 && imageCalls[0].opts.aspectRatio === '9:16' &&
    imageCalls[0].opts.image && imageCalls[0].opts.image.mimeType === 'image/jpeg' && Buffer.from(imageCalls[0].opts.image.data, 'base64').toString('latin1').indexOf('the owner banner') !== -1 &&
    imageCalls[0].opts.route === 'phone-banner' && imageCalls[0].opts.eventId === EV, imageCalls[0] && imageCalls[0].opts);
  check('P.1 this event\'s own banner is read from the bucket, never fetched over the web', webCalls.length === 0);
  var prompt = imageCalls[0].prompt;
  check('P.1 the prompt: the same picture laid out for a tall phone screen, its look and subject kept', /9:16/.test(prompt) && /KEEP ITS LOOK/.test(prompt) && /same scene and subject/.test(prompt) &&
    /Never stretch, squash or distort/.test(prompt) && /IT MUST NOT LOOK EMPTY ON A PHONE/.test(prompt) && /as large against the frame's width as they are in the banner, or larger/.test(prompt) &&
    /LEAVE ROOM FOR THE WORDS, NOT A VOID/.test(prompt) && /never a blank sheet/.test(prompt), prompt);
  check('P.1 the prompt adds nothing: no people, words or logos of its own', /ADD NOTHING/.test(prompt) && /no people, faces, figures, silhouettes, words, letters, numbers or logos that the banner does not already have/.test(prompt), prompt);
  check('P.1 the prompt carries the ET logos\' rule (api.js ET_LOGO_COLOUR_RULE): the red ET square never changes', /The red ET square, with the white "ET" in it, is NEVER changed/.test(prompt), prompt);
  check('P.1 the made picture was checked once, for people, words and logos as strictly as a banner is (rule none)', checkCalls.length === 1 && /however small, distant/.test(checkCalls[0].prompt));
  var h = history();
  check('P.1 the event\'s History says ETB2B AI made a phone banner', h.length === 1 && h[0].action === 'ai-chat' && h[0].area === 'design' && /^ETB2B AI made a phone banner from the site/.test(h[0].detail), h);
  var usage = Object.keys(docs['events/' + EV] || {}).filter(function (k) { return k.indexOf('aiUsage.byRoute.') === 0; });
  check('P.1 what the models used goes into the event\'s AI usage, under its own routes', usage.some(function (k) { return k.indexOf('aiUsage.byRoute.phone-banner.') === 0; }) &&
    usage.some(function (k) { return k.indexOf('aiUsage.byRoute.phone-banner-check.') === 0; }), usage);

  reset();
  r = await call({ eventId: EV, source: 'https://img.etb2bimg.com/files/data_file_1.jpg' });
  check('P.1 a banner elsewhere on the web is read through safe-fetch (a picture, at most 8 MB)', r.status === 200 && webCalls.length === 1 && webCalls[0].url === 'https://img.etb2bimg.com/files/data_file_1.jpg' &&
    webCalls[0].opts.accept === 'image/' && webCalls[0].opts.maxBytes === 8 * 1024 * 1024, { r: r, web: webCalls });
  reset();
  files['events/other-event/media/x.jpg'] = { bytes: jpgOf('someone else'), public: false };
  r = await call({ eventId: EV, source: 'https://storage.googleapis.com/test-bucket/events/other-event/media/x.jpg' });
  check('P.1 another event\'s file is never read from the bucket (only what the web may read, through safe-fetch)', webCalls.length === 1 && imageCalls.length === 1 &&
    Buffer.from(imageCalls[0].opts.image.data, 'base64').toString('latin1').indexOf('someone else') === -1, { web: webCalls.length });

  reset();
  var bad = await Promise.all([
    call({ source: OWN }), call({ eventId: EV }), call({ eventId: EV, source: 'http://example.com/a.jpg' }), call({ eventId: EV, source: 'data:image/png;base64,AAAA' }),
    call({ eventId: EV, source: 'https://x.com/a.jpg")' }), call({ eventId: 'no-such-event', source: OWN }), call({ eventId: EV, source: OWN }, null)
  ]);
  check('P.1 refused before anything is paid for: no event, no source, not https, a data: address, a broken address, an event that is not there, nobody signed in',
    bad[0].status === 400 && bad[0].body.code === 'bad-event' && bad[1].status === 400 && bad[1].body.code === 'bad-source' && bad[2].body.code === 'bad-source' &&
    bad[3].body.code === 'bad-source' && bad[4].body.code === 'bad-source' && bad[5].status === 404 && bad[5].body.code === 'no-event' && bad[6].status === 401 && imageCalls.length === 0,
    bad.map(function (b) { return [b.status, b.body && b.body.code]; }));
  reset();
  docs['events/' + EV].deletedAt = '2026-11-12T00:00:00.000Z';
  r = await call({ eventId: EV, source: OWN });
  check('P.1 a deleted event gets none', r.status === 404 && imageCalls.length === 0, r);

  /* ===== P.2 the day's pictures ===== */
  reset();
  await call({ eventId: EV, source: OWN });
  check('P.2 one of the person\'s new ETB2B AI pictures for the day, on the editor\'s own count', quota() && quota().day === '2026-11-13' && quota().made === 1 && quota().failed === 0, quota());
  reset();
  docs['aiQuota/u-asha'] = { day: '2026-11-13', made: 20, failed: 0 };
  r = await call({ eventId: EV, source: OWN });
  check('P.2 the day\'s pictures used up (the chat\'s and these together): 429, nothing made, plainly said', r.status === 429 && r.body.code === 'phone-banner-daily' && imageCalls.length === 0 &&
    /20 new pictures with ETB2B AI today/.test(r.body.error) && /upload a phone banner of your own/.test(r.body.error), r);
  reset();
  docs['aiQuota/u-asha'] = { day: '2026-11-12', made: 20, failed: 20 };
  r = await call({ eventId: EV, source: OWN });
  check('P.2 a new day is a new count', r.status === 200 && quota().day === '2026-11-13' && quota().made === 1, quota());

  /* ===== P.3 the check against the banner's own ===== */
  reset();
  checkQueue = [{ people: true, text: false, logos: false }, { people: true, text: false, logos: false }];
  r = await call({ eventId: EV, source: OWN });
  check('P.3 small figures the banner itself has stay: the banner is looked at too, and nothing it has is refused', r.status === 200 && imageCalls.length === 1 && checkCalls.length === 2, { r: r, checks: checkCalls.length });
  reset();
  checkQueue = [{ people: false, text: true, logos: false }, { people: false, text: false, logos: false }, { people: false, text: false, logos: false }];
  r = await call({ eventId: EV, source: OWN });
  check('P.3 words the banner does not have: made once more with a stronger line, which passes and is stored', r.status === 200 && imageCalls.length === 2 && /SECOND TRY, STRICT: the first picture made from this banner added words or letters/.test(imageCalls[1].prompt) &&
    stored().length === 1 && quota().made === 2, { r: r, calls: imageCalls.length, q: quota() });
  check('P.3 the banner is looked at once, however many pictures are made', checkCalls.length === 3);
  reset();
  checkQueue = [{ people: false, text: false, logos: true }, { people: false, text: false, logos: false }, { people: false, text: false, logos: true }];
  r = await call({ eventId: EV, source: OWN });
  check('P.3 a logo added twice: nothing stored, 422 phone-banner-held, said plainly, the page untouched', r.status === 422 && r.body.code === 'phone-banner-held' && stored().length === 0 &&
    /No phone banner was made: ETB2B AI made it twice, and the second picture still added a logo that your banner does not have/.test(r.body.error) && r.body.found.join() === 'logos', r);
  check('P.3 its History says no phone banner was made', history().some(function (x) { return /made no phone banner/.test(JSON.stringify(x)); }), history());
  reset();
  docs['aiQuota/u-asha'] = { day: '2026-11-13', made: 19, failed: 0 };
  checkQueue = [{ people: true, text: false, logos: false }, { people: false, text: false, logos: false }];
  r = await call({ eventId: EV, source: OWN });
  check('P.3 no second try past the day\'s pictures: held, said why', r.status === 422 && imageCalls.length === 1 && /a second try would have gone past your new pictures for today/.test(r.body.error), r);
  check('P.3 added(): what the made picture has less what the banner has; a look that could not be made holds nothing back',
    T.added({ people: true, text: true, logos: false }, { people: true, text: false, logos: false }).join() === 'text' && T.added(null, { people: false }).length === 0 && T.added({ people: true, text: false, logos: false }, null).length === 0);

  /* ===== P.4 failures ===== */
  reset();
  imageQueue = [gemini.failure('ai-quota')];
  r = await call({ eventId: EV, source: OWN });
  check('P.4 the model\'s failure is answered in its own words, nothing stored, counted as a failed attempt', r.status === 429 && r.body.code === 'ai-quota' && stored().length === 0 &&
    quota().made === 0 && quota().failed === 1, { r: r, q: quota() });
  reset();
  imageQueue = [{ mimeType: 'image/png', base64: Buffer.from('<svg/>not a picture at all').toString('base64') }];
  quiet();
  r = await call({ eventId: EV, source: OWN });
  loud();
  check('P.4 an answer that is not a PNG, JPEG or WebP is not stored', r.status === 502 && r.body.code === 'ai-bad-output' && stored().length === 0, r);
  reset();
  failSave = true;
  quiet();
  r = await call({ eventId: EV, source: OWN });
  loud();
  check('P.4 made but not stored: 502, said plainly, counted as a failed attempt', r.status === 502 && r.body.code === 'phone-banner-not-stored' && /could not be saved/.test(r.body.error) && quota().failed === 1, r);
  reset();
  quiet();
  r = await call({ eventId: EV, source: 'https://storage.googleapis.com/test-bucket/events/' + EV + '/media/gone.jpg' });
  loud();
  check('P.4 a banner that cannot be read: 422 phone-banner-source, nothing paid for', r.status === 422 && r.body.code === 'phone-banner-source' && /could not be read/.test(r.body.error) && imageCalls.length === 0 && !quota(), r);
  reset();
  files['events/' + EV + '/media/logo.svg'] = { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), public: true };
  r = await call({ eventId: EV, source: 'https://storage.googleapis.com/test-bucket/events/' + EV + '/media/logo.svg' });
  check('P.4 a drawing (SVG) is not laid out again: said, nothing paid for', r.status === 422 && /not a PNG, JPEG or WebP/.test(r.body.error) && imageCalls.length === 0, r);
  reset();
  webAnswer = function () { return Promise.reject(Object.assign(new Error('too large'), { code: 'too-large' })); };
  quiet();
  r = await call({ eventId: EV, source: 'https://img.etb2bimg.com/files/huge.jpg' });
  loud();
  check('P.4 a banner larger than 8 MB: said, nothing paid for', r.status === 422 && /larger than 8 MB/.test(r.body.error) && imageCalls.length === 0, r);

  /* ===== P.5 one at a time ===== */
  reset();
  var release;
  hold = new Promise(function (go) { release = go; });
  var first = call({ eventId: EV, source: OWN });
  await new Promise(function (go) { setTimeout(go, 30); });
  var second = await call({ eventId: EV, source: OWN });
  release();
  var firstDone = await first;
  check('P.5 a second request while one is being made: 409 phone-banner-busy, nothing more paid for', second.status === 409 && second.body.code === 'phone-banner-busy' && firstDone.status === 200 && imageCalls.length === 1, { second: second, first: firstDone.status });
  hold = null;
  r = await call({ eventId: EV, source: OWN });
  check('P.5 once it is done, the next one may start', r.status === 200 && Object.keys(T.making).length === 0, r);
  reset();
  T.making[EV] = NOW - T.CAPS.lockMs - 1;
  r = await call({ eventId: EV, source: OWN });
  check('P.5 a mark left by a request that never finished (older than any request lives) does not block the event for good', r.status === 200 && Object.keys(T.making).length === 0, r);
  T.making[EV] = NOW - 1000;
  r = await call({ eventId: EV, source: OWN });
  delete T.making[EV];
  check('P.5 a recent one still does', r.status === 409, r);

  /* ===== the wiring ===== */
  var src = require('fs').readFileSync(require('path').join(__dirname, 'api.js'), 'utf8');
  check('wiring: api.js routes POST /api/event/phone-banner to lib/phone-banner.js, with its sign-in and the ET logos\' rule',
    /'POST \/api\/event\/phone-banner': phoneBannerRoute\('handle'\)/.test(src) && /function phoneBannerHelpers\(\) \{\s*return \{[^}]*ET_LOGO_COLOUR_RULE/.test(src));
  check('wiring: a module wired with parts missing is refused', (function () { try { PB.wire({ sendJson: function () {} }); return false; } catch (e) { return /needs withAdminBody/.test(e.message); } })());

  console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed — phone-banner');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { loud(); console.error('STOPPED ' + (e && e.stack || e)); process.exit(1); });
