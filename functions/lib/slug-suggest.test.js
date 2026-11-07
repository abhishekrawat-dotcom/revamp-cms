// node functions/lib/slug-suggest.test.js — the free address the server offers for a taken one (UX-046): a trailing year is
// part of the event's name, never a counter, so a taken "brand-world-summit-2026" is offered as "brand-world-summit-2026-2"
// and never as "…-2027" (another edition's address); a real counter is still counted on ("summit-2" -> "summit-3"); a long
// name is cut before its year, so the year is never the part lost; and GET /api/event/slug-available says the same.
// Firestore is an in-memory stub; nothing is written. No network. Exits 1 on failure.
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

delete process.env.K_SERVICE;
var DOCS = {};
function snapOf(p) { var d = DOCS[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? JSON.parse(JSON.stringify(d)) : undefined; } }; }
function refOf(p) { return { id: p.split('/').pop(), path: p, get: function () { return Promise.resolve(snapOf(p)); }, collection: function (n) { return colOf(p + '/' + n); } }; }
function colOf(p) { return { doc: function (id) { return refOf(p + '/' + id); } }; }
var FB = {
  db: {
    collection: function (n) { return colOf(n); },
    getAll: function () { var a = [].slice.call(arguments); return Promise.resolve(a.map(function (r) { return snapOf(r.path); })); }
  },
  bucket: {},
  auth: { verifyIdToken: function (t) { return Promise.resolve({ uid: t, email: t + '@timesinternet.in', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };

var events = require('./api-events');
var suggest = events._shared.suggestFreeSlug;
var api = require('./api');
function taken(id) { DOCS['events/' + id] = { name: id, createdAt: '2026-10-01T00:00:00.000Z' }; }
function call(url) {
  return new Promise(function (resolve) {
    var req = { method: 'GET', url: url, headers: { host: 'cms.example', authorization: 'Bearer maker' }, socket: {}, rawBody: Buffer.from('') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s) { res.statusCode = s; res.headersSent = true; return res; }, write: function () { return true; },
      end: function (b) { var j = null; try { j = JSON.parse(String(b)); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json: j }); } };
    api.handleApi(req, res);
  });
}

(async function () {
  taken('brand-world-summit-2026');
  check('a taken year-ended address gets a counter after the year, not next year', await suggest(FB, 'brand-world-summit-2026') === 'brand-world-summit-2026-2');
  taken('brand-world-summit-2026-2');
  check('… and the next counter when that is taken too', await suggest(FB, 'brand-world-summit-2026') === 'brand-world-summit-2026-3');
  check('… never another year', !/2027/.test(await suggest(FB, 'brand-world-summit-2026')));
  check('a counter after the year is counted on from', await suggest(FB, 'brand-world-summit-2026-2') === 'brand-world-summit-2026-3');
  taken('summit-2');
  check('a plain counter is still counted on ("summit-2" -> "summit-3")', await suggest(FB, 'summit-2') === 'summit-3');
  check('no number: "-2"', await suggest(FB, 'cio-conclave') === 'cio-conclave-2');
  check('1999 is a year too', await suggest(FB, 'retro-awards-1999') === 'retro-awards-1999-2');
  var long = 'the-economic-times-annual-leadership-and-innovation-summit-india-west-zone-2026';   // 79 characters: no room for "-2"
  var got = await suggest(FB, long);
  check('a long name is cut before its year: the year and the counter stay, within 80 characters', got.length <= 80 && /-2026-2$/.test(got), got);

  var r = await call('/api/event/slug-available?slug=brand-world-summit-2026');
  check('GET /api/event/slug-available offers the counter after the year', r.status === 200 && r.json && r.json.available === false && r.json.reason === 'taken' &&
    r.json.suggestion === 'brand-world-summit-2026-3', r.json);

  console.log('slug-suggest: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch(function (e) { console.error(e); process.exit(1); });
