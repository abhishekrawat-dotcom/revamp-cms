/* node functions/lib/ai-hero.test.js — ETB2B AI's first hero picture for an event started from the events dashboard
   (plan §18, the owner's request of 3 Nov 2026):
     H.1  the request in the bot's Create Event prefill (lib/dash-bot.js cleanCreate): the person's own words for the
          picture or nothing (the event's name and place); none when they say so, none for "Generate from a brief"
     H.2  POST /api/event/ai-hero through lib/api.js (its real sign-in check and helpers): checks, one picture per
          event, the daily allowance, the site pipeline's picture rules in the prompt, stored as generated pictures
          are, the event's record, its History line and its AI usage
     H.3  failures: the model, the storage and an event removed meanwhile never leave a claim that blocks a retry
   No network, no AI: Firebase is in memory, gemini.js callGeminiImage and pictures.js storeVariants are stubbed. */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
delete process.env.K_SERVICE;

/* ---------- Firebase in memory: documents, transactions, a bucket that records its files, and sign-in ---------- */
var docs = {}, files = {}, seq = 0, failSave = false;
function isInc(v) { return !!v && typeof v === 'object' && typeof v.operand === 'number'; }
function write(target, data, merge) {
  Object.keys(data).forEach(function (k) {
    var v = data[k];
    if (isInc(v)) target[k] = (typeof target[k] === 'number' ? target[k] : 0) + v.operand;
    else if (merge && v && typeof v === 'object' && !Array.isArray(v)) { if (!target[k] || typeof target[k] !== 'object') target[k] = {}; write(target[k], v, true); }
    else target[k] = clone(v);
  });
}
function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? clone(d) : undefined; } }; }
function docRef(p) {
  return { id: p.split('/').pop(), path: p,
    collection: function (n) { return colRef(p + '/' + n); },
    get: function () { return Promise.resolve(snap(p)); },
    set: function (data, o) { if (!(o && o.merge) || !docs[p]) docs[p] = (o && o.merge && docs[p]) || {}; write(docs[p], data, !!(o && o.merge)); return Promise.resolve(); },
    update: function (data) { if (!docs[p]) return Promise.reject(new Error('5 NOT_FOUND: No document to update')); write(docs[p], data, false); return Promise.resolve(); } };
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
      makePublic: function () { files[path].public = true; return Promise.resolve(); } };
  } },
  auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, name: t === 'asha' ? 'Asha Rao' : '', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };

/* ---------- the model and the WebP copies, stubbed ---------- */
var gemini = require('./gemini');
var imageCalls = [], imageAnswer = null, beforeAnswer = null;
var PNG = Buffer.from('a picture').toString('base64');
gemini.callGeminiImage = function (prompt, opts) {
  imageCalls.push({ prompt: prompt, opts: opts });
  if (beforeAnswer) { var f = beforeAnswer; beforeAnswer = null; f(); }
  var a = imageAnswer || { mimeType: 'image/png', base64: PNG, provider: 'gemini', model: 'gemini-2.5-flash-image', usage: { provider: 'gemini', inputTokens: 300, outputTokens: 1290, usd: null, pictures: 1 } };
  imageAnswer = null;
  return Promise.resolve(a);
};
var pictures = require('./pictures');
var variants = [];
pictures.storeVariants = function (fb, path, bytes, opts) { variants.push({ path: path, opts: opts }); return Promise.resolve(null); };

var api = require('./api');
var hero = require('./ai-hero');
var HT = hero._test;
var dashBot = require('./dash-bot');
var NOW = Date.UTC(2026, 10, 3, 6, 35);   // Tue 3 Nov 2026, 12:05 in India
HT.clock.now = function () { return NOW; };
dashBot._test.clock.now = function () { return NOW; };

function call(body, who, raw) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (who !== null) headers.authorization = 'Bearer ' + (who || 'asha');
    var req = { method: 'POST', url: '/api/event/ai-hero', headers: headers, socket: {}, rawBody: Buffer.from(raw !== undefined ? raw : JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k] = v; }, getHeader: function (k) { return res.headers[k]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b === undefined ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j }); } };
    api.handleApi(req, res);
  });
}
function put(p, d) { docs[p] = clone(d); }
function event(id, extra) {
  put('events/' + id, Object.assign({ name: 'Retail Leadership Summit', category: 'ip', venue: 'Jio World Centre, Mumbai', city: '', portal: 'retail', portalName: 'ETRetail',
    templateId: 'tech500', createdAt: '2026-11-03T06:30:00.000Z', createdBy: 'asha@timesinternet.in' }, extra || {}));
}
var DAY = 'dashChats/u-asha/days/2026-11-03';
function activityOf(id) { return Object.keys(docs).filter(function (k) { return k.indexOf('events/' + id + '/activity/') === 0; }).map(function (k) { return docs[k]; }); }
var realError = console.error, logged = [];
function quiet() { logged = []; console.error = function () { logged.push(Array.prototype.join.call(arguments, ' ')); }; }
function loud() { console.error = realError; }

(async function () {
  /* ===== H.1 the request in the bot's prefill ===== */
  var T = dashBot._test;
  function ctxFor(message, view) { return T.contextFor({ decoded: { email: 'asha@timesinternet.in' }, name: 'Asha', message: message, view: view || {}, docs: [], now: NOW }); }
  var c = T.cleanCreate({ category: 'IP', name: 'Retail Leadership Summit' }, ctxFor('Create an IP event called Retail Leadership Summit'));
  check('H.1 every create asks for a first hero picture: from the event\'s name and place when the person said nothing about it', same(c.prefill.hero, { subject: '' }), c.prefill.hero);
  c = T.cleanCreate({ category: 'IP', name: 'Retail Leadership Summit', heroSubject: 'a modern retail store at night' },
    ctxFor('Create an IP event called Retail Leadership Summit, with a hero picture of a modern retail store at night'));
  check('H.1 the person\'s own words for the picture are kept', same(c.prefill.hero, { subject: 'a modern retail store at night' }) && c.dropped.indexOf('heroSubject') === -1, c);
  c = T.cleanCreate({ category: 'IP', name: 'Retail Leadership Summit', heroSubject: 'a futuristic city skyline with drones' }, ctxFor('Create an IP event called Retail Leadership Summit'));
  check('H.1 a subject the person did not say is left out (and the card says so): the name and place then', same(c.prefill.hero, { subject: '' }) && c.dropped.indexOf('heroSubject') !== -1, c);
  c = T.cleanCreate({ category: 'IP', name: 'Retail Leadership Summit', noHeroPicture: true }, ctxFor('Create an IP event called Retail Leadership Summit, no picture please'));
  check('H.1 "no picture": none asked for', c.prefill.hero === null);
  c = T.cleanCreate({ category: 'IP', method: 'brief', briefFromMessage: true }, ctxFor('Generate a site from this brief: a one-day forum for retail CXOs in Bengaluru, with a keynote and two panels.'));
  check('H.1 "Generate from a brief" makes its own pictures: none asked for', c.prefill.method === 'brief' && c.prefill.hero === null, c.prefill);
  var long = 'a modern retail store at night ' + 'with glowing shelves '.repeat(12);
  c = T.cleanCreate({ category: 'IP', name: 'X', heroSubject: long }, ctxFor('Create X with a picture of ' + long));
  check('H.1 a long subject is cut at a word, within 200 characters', c.prefill.hero.subject.length <= 200 && /shelves$|glowing$|with$/.test(c.prefill.hero.subject), c.prefill.hero.subject);
  var a = await T.cleanAnswer({ kind: 'create', create: { category: 'IP', name: 'Retail Leadership Summit', heroSubject: 'drones over a stadium' }, text: '' },
    ctxFor('Create an IP event called Retail Leadership Summit'));
  check('H.1 the answer says what was left out of the picture request', /I left out what the hero picture should show/.test(a.parts.map(function (p) { return p.v || ''; }).join('')), a.parts);
  var prompt = T.buildPrompt(ctxFor('hi'));
  check('H.1 the prompt says the picture is made only once the event is created, and how to fill the two fields',
    prompt.indexOf('The product also makes the new event a first hero picture, but only once the event is created.') !== -1 && prompt.indexOf('noHeroPicture: true only when') !== -1);
  check('H.1 the schema carries heroSubject and noHeroPicture in the create block', T.SCHEMA.properties.create.properties.heroSubject.type === 'STRING' && T.SCHEMA.properties.create.properties.noHeroPicture.type === 'BOOLEAN');

  /* ===== H.2 the route ===== */
  var out = await call({ eventId: 'retail-2027' }, null);
  check('H.2 signed out: 401, and nothing is made', out.status === 401 && imageCalls.length === 0, out);
  out = await call({ eventId: 'Not An Id' });
  check('H.2 a bad event id: 400', out.status === 400 && out.body.code === 'bad-event', out.body);
  out = await call({ eventId: 'retail-2027', subject: 7 });
  check('H.2 a subject that is not words: 400', out.status === 400 && out.body.code === 'bad-subject', out.body);
  out = await call({ eventId: 'retail-2027', subject: 'x'.repeat(201) });
  check('H.2 a subject over 200 characters: 400', out.status === 400 && out.body.code === 'too-long', out.body);
  out = await call({ eventId: 'retail-2027' });
  check('H.2 an event that does not exist: 404, nothing made, nothing taken from the day', out.status === 404 && out.body.code === 'no-event' && imageCalls.length === 0 && !docs[DAY], out.body);
  event('gone-2027', { deletedAt: '2026-11-03T06:00:00.000Z' });
  event('discard-2027', { discardingAt: '2026-11-03T06:00:00.000Z' });
  put('events/shell-2027', { name: 'Shell' });
  out = await call({ eventId: 'gone-2027' });
  var out2 = await call({ eventId: 'discard-2027' }), out3 = await call({ eventId: 'shell-2027' });
  check('H.2 a deleted event, one being discarded, and a shell: 404 each', out.status === 404 && out2.status === 404 && out3.status === 404 && imageCalls.length === 0);
  event('gen-site', { templateId: 'gen-gen-site' });
  out = await call({ eventId: 'gen-site' });
  check('H.2 a site generated from a brief made its own pictures: 409, no second hero', out.status === 409 && out.body.code === 'hero-generated' && imageCalls.length === 0 && !(docs['events/gen-site'].aiHero), out.body);

  event('retail-2027');
  out = await call({ eventId: 'retail-2027', subject: '', turnId: 'TurnHero0000000001' });
  var url = 'https://storage.googleapis.com/test-bucket/events/retail-2027/generated/' + NOW.toString(36) + '-ai-hero.png';
  check('H.2 made: 200 with the picture\'s address and its subject', out.status === 200 && same(out.body, { url: url, subject: 'Retail Leadership Summit, Jio World Centre, Mumbai', made: true }), out.body);
  check('H.2 one model call, on route ai-hero, for this event, within the request\'s deadline', imageCalls.length === 1 && imageCalls[0].opts.route === 'ai-hero' && imageCalls[0].opts.eventId === 'retail-2027' &&
    imageCalls[0].opts.timeoutMs === 60000 && imageCalls[0].opts.deadlineAt === NOW + 80000 && imageCalls[0].opts.user === 'asha@timesinternet.in', imageCalls[0] && imageCalls[0].opts);
  var p = imageCalls[0].prompt;
  check('H.2 the prompt is the site pipeline\'s hero key visual (gen-design.js imagePrompt)', p.indexOf('Create the wide KEY VISUAL for the hero banner') === 0, p.slice(0, 80));
  check('H.2 …no people, no faces, no readable text, no logos or brand names', p.indexOf('STRICT: no people and no faces; no readable text, letters or numbers anywhere') !== -1 && p.indexOf('no logos, no brand names') !== -1 &&
    p.indexOf('The picture itself carries no words at all') !== -1);
  check('H.2 …what it is of: the event\'s name and place, its field and portal, its city', p.indexOf('Scene: Retail Leadership Summit, Jio World Centre, Mumbai.') !== -1 &&
    p.indexOf('The event: Retail Leadership Summit, an industry conference of ETRetail') !== -1 && p.indexOf('Place: the event is in Mumbai') !== -1, p);
  check('H.2 …in one tone, the design\'s own colour (tech500\'s theme colour)', p.indexOf('Palette: bright and airy, with #d8151e') !== -1 && p.indexOf('Every picture on this site shares this one style') !== -1);
  var f = files['events/retail-2027/generated/' + NOW.toString(36) + '-ai-hero.png'];
  check('H.2 stored as generated pictures are: under the event, public, cached a year, with WebP copies asked for', !!f && f.public === true && f.metadata.contentType === 'image/png' &&
    f.metadata.cacheControl === pictures.CACHE && variants.length === 1 && variants[0].path === 'events/retail-2027/generated/' + NOW.toString(36) + '-ai-hero.png', [f && f.metadata, variants]);
  var rec = docs['events/retail-2027'].aiHero;
  check('H.2 the event records it: made, where, what of, when, by whom, from the dashboard, for which turn', !!rec && rec.status === 'made' && rec.url === url && rec.subject === 'Retail Leadership Summit, Jio World Centre, Mumbai' &&
    rec.by === 'asha@timesinternet.in' && rec.from === 'dashboard' && rec.turnId === 'TurnHero0000000001' && rec.storagePath === 'events/retail-2027/generated/' + NOW.toString(36) + '-ai-hero.png', rec);
  var acts = activityOf('retail-2027');
  check('H.2 the History says ETB2B AI made it', acts.length === 1 && acts[0].action === 'ai-chat' && acts[0].area === 'design' && acts[0].by === 'asha@timesinternet.in' &&
    acts[0].detail === 'ETB2B AI made a hero picture for the site: “Retail Leadership Summit, Jio World Centre, Mumbai”', acts);
  check('H.2 one of the person\'s pictures for today is counted, on the bot\'s own day document', docs[DAY] && docs[DAY].pictures === 1 && HT.dayKey(NOW) === dashBot._test.dayKey(NOW), docs[DAY]);
  var usage = docs['events/retail-2027'];
  check('H.2 what the model used is in the event\'s AI usage (one picture, route ai-hero)', usage['aiUsage.pictures'] === 1 && usage['aiUsage.byRoute.ai-hero.pictures'] === 1 && usage['aiUsage.byRoute.ai-hero.geminiCalls'] === 1,
    Object.keys(usage).filter(function (k) { return /^aiUsage/.test(k); }));

  out = await call({ eventId: 'retail-2027', subject: 'something else' });
  check('H.2 one picture per event: asked again, the same picture, no second call, nothing more taken from the day', out.status === 200 && same(out.body, { url: url, subject: 'Retail Leadership Summit, Jio World Centre, Mumbai', made: false }) &&
    imageCalls.length === 1 && docs[DAY].pictures === 1 && activityOf('retail-2027').length === 1, out.body);

  event('own-words');
  out = await call({ eventId: 'own-words', subject: '  a modern retail\nstore at night ' });
  check('H.2 the person\'s own words are the scene, as one line', out.status === 200 && out.body.subject === 'a modern retail store at night' && imageCalls[1].prompt.indexOf('Scene: a modern retail store at night.') !== -1, out.body);

  event('busy-one', { aiHero: { status: 'making', at: new Date(NOW - 60000).toISOString(), by: 'bob@timesinternet.in' } });
  out = await call({ eventId: 'busy-one' });
  check('H.2 being made right now (a minute ago): 409 hero-busy, retryable, nothing more made', out.status === 409 && out.body.code === 'hero-busy' && out.body.retryable === true && imageCalls.length === 2, out.body);
  event('stale-one', { aiHero: { status: 'making', at: new Date(NOW - 5 * 60000).toISOString(), by: 'bob@timesinternet.in' } });
  out = await call({ eventId: 'stale-one' });
  check('H.2 a claim older than three minutes died with its request: made now', out.status === 200 && out.body.made === true && imageCalls.length === 3, out.body);

  /* the daily allowance */
  put(DAY, { turns: 4, pictures: HT.CAPS.dayPictures });
  event('capped-one');
  out = await call({ eventId: 'capped-one' });
  check('H.2 today\'s pictures used up: 429 ai-hero-daily with its sentence, no call, the event not claimed', out.status === 429 && out.body.code === 'ai-hero-daily' &&
    /reset at midnight \(India time\)/.test(out.body.error) && imageCalls.length === 3 && !docs['events/capped-one'].aiHero && docs[DAY].turns === 4, out.body);
  check('H.2 the allowance is a small daily cap (main has no per-person picture allowance)', HT.CAPS.dayPictures === 5);
  out = await call({ eventId: 'capped-one' }, 'bob');
  check('H.2 …it is per person: someone else may', out.status === 200 && docs['dashChats/u-bob/days/2026-11-03'].pictures === 1, out.body);

  /* ===== H.3 failures ===== */
  put(DAY, { pictures: 0 });
  event('fails-ai');
  imageAnswer = Object.assign(gemini.failure('ai-quota'), { provider: 'gemini', usage: { provider: 'gemini', inputTokens: 300, outputTokens: 0, usd: null, pictures: 0 } });
  out = await call({ eventId: 'fails-ai' });
  check('H.3 the model failed: its own answer (429 ai-quota, retryable), in gemini.js\'s words', out.status === 429 && out.body.code === 'ai-quota' && out.body.retryable === true && out.body.error === gemini.FAILURES['ai-quota'].error, out.body);
  check('H.3 …the claim is given up (failed, with why), so a later request may try again', docs['events/fails-ai'].aiHero.status === 'failed' && docs['events/fails-ai'].aiHero.error === 'ai-quota' && activityOf('fails-ai').length === 0, docs['events/fails-ai'].aiHero);
  out = await call({ eventId: 'fails-ai' });
  check('H.3 …and it does', out.status === 200 && out.body.made === true && docs['events/fails-ai'].aiHero.status === 'made', out.body);
  event('no-picture');
  imageAnswer = { mimeType: 'image/png', base64: '', provider: 'gemini' };
  out = await call({ eventId: 'no-picture' });
  check('H.3 an answer with no picture: 502 ai-bad-output, given up', out.status === 502 && out.body.code === 'ai-bad-output' && docs['events/no-picture'].aiHero.status === 'failed', out.body);
  event('not-stored');
  failSave = true; quiet();
  out = await call({ eventId: 'not-stored' });
  failSave = false; loud();
  check('H.3 made but not stored: 502 hero-not-stored, retryable, given up, no History line', out.status === 502 && out.body.code === 'hero-not-stored' && out.body.retryable === true &&
    docs['events/not-stored'].aiHero.status === 'failed' && activityOf('not-stored').length === 0, out.body);
  event('removed-meanwhile');
  beforeAnswer = function () { docs['events/removed-meanwhile'].deletedAt = '2026-11-03T06:35:30.000Z'; };
  out = await call({ eventId: 'removed-meanwhile' });
  check('H.3 an event deleted while its picture was made: 404, the picture not recorded on it, no History line', out.status === 404 &&
    docs['events/removed-meanwhile'].aiHero.status !== 'made' && activityOf('removed-meanwhile').length === 0, [out.body, docs['events/removed-meanwhile'].aiHero]);

  /* ===== the module ===== */
  check('H.x subjectOf: the name and "Venue & city" as one place, never the city twice', HT.subjectOf({ name: 'A', venue: 'Taj, Pune', city: 'Pune' }) === 'A, Taj, Pune' &&
    HT.subjectOf({ name: 'A', venue: 'Taj', city: 'Pune' }) === 'A, Taj, Pune' && HT.subjectOf({ name: 'A' }) === 'A');
  check('H.x cityOf: its own, else the last part of "Venue & city"', HT.cityOf({ city: 'Pune' }) === 'Pune' && HT.cityOf({ venue: 'Jio World Centre, Mumbai' }) === 'Mumbai' && HT.cityOf({ venue: 'Jio World Centre' }) === '');
  check('H.x the design colour is read only from a template id, never a path', HT.templateColour('../../etc') === '' && HT.templateColour('nope-template') === '' && HT.templateColour('tech500') === '#d8151e');
  var loaded = require('child_process').execFileSync(process.execPath, ['-e', "var m = require('./ai-hero.js'); process.stdout.write(Object.keys(m).join(','));"], { cwd: __dirname, env: { PATH: process.env.PATH }, timeout: 20000 }).toString();
  check('H.x loads with no environment and no side effects', loaded === 'wire,handleHero,_test', loaded);
  var refused = false;
  try { hero.wire({ withAdminBody: function () {} }); } catch (e) { refused = /needs/.test(e.message); }
  check('H.x wire() refuses helpers with parts missing', refused);
  var src = require('fs').readFileSync(require('path').join(__dirname, 'api.js'), 'utf8');
  check('H.x lib/api.js routes POST /api/event/ai-hero to it', src.indexOf("'POST /api/event/ai-hero': aiHeroRoute('handleHero')") !== -1);

  console.log('ai-hero: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { loud(); console.error(err && err.stack || err); process.exit(1); });
