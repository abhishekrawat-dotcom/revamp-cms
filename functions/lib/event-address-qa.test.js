// node functions/lib/event-address-qa.test.js — a qa-… address is the QA harness's (the sitemap, the team's Mailer
// performance view, a local server's mailer tracking and the harness's clean-up all read qa- as test data), so a
// deployed instance (K_SERVICE set) gives one to no event: the address check, create and clone refuse it as reserved
// and suggest the same words with the prefix moved to the end. A local or QA server, where the harness runs, still
// takes qa- addresses. Firestore and sign-in are in-memory stubs; nothing is written. No network. Exits 1 on failure.
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

delete process.env.K_SERVICE;
var DOCS = {}, WRITES = 0;
function snapOf(p) { var d = DOCS[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? JSON.parse(JSON.stringify(d)) : undefined; } }; }
function refOf(p) {
  return { id: p.split('/').pop(), path: p, get: function () { return Promise.resolve(snapOf(p)); },
    set: function () { WRITES++; return Promise.resolve(); }, create: function () { WRITES++; return Promise.resolve(); }, update: function () { WRITES++; return Promise.resolve(); },
    collection: function (n) { return colOf(p + '/' + n); } };
}
function colOf(p) { return { doc: function (id) { return refOf(p + '/' + id); } }; }
var FB = {
  db: {
    collection: function (n) { return colOf(n); },
    getAll: function () { var a = [].slice.call(arguments); if (a.length && !a[a.length - 1].path) a.pop(); return Promise.resolve(a.map(function (r) { return snapOf(r.path); })); },
    runTransaction: function () { WRITES++; return Promise.reject(new Error('stub: no transaction in this test')); },
    batch: function () { return { set: function () {}, create: function () {}, update: function () {}, commit: function () { WRITES++; return Promise.resolve(); } }; }
  },
  bucket: {},
  auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };

var http = require('./http');
var api = require('./api');

function call(method, url, body) {
  return new Promise(function (resolve) {
    var h = { host: 'cms.example', authorization: 'Bearer maker' };
    if (body) h['content-type'] = 'application/json';
    var req = { method: method, url: url, headers: h, socket: {}, rawBody: Buffer.from(body ? JSON.stringify(body) : '') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, hh) { res.statusCode = s; Object.keys(hh || {}).forEach(function (k) { res.headers[k.toLowerCase()] = hh[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b == null ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json: j }); } };
    api.handleApi(req, res);
  });
}

var NAME = 'qa-leaders-summit-2027';
(async function () {
  /* the rule */
  check('a local or QA server: a qa- address is not reserved (the harness creates its events there)', http.isReservedEventId(NAME) === false);
  process.env.K_SERVICE = 'revamp-cms';
  check('a deployed instance: a qa- address is reserved', http.isReservedEventId(NAME) === true && http.isReservedEventId('qa-x') === true);
  check('… and only the prefix: "qaleaders", "leaders-qa" and "aqa-x" are not', !http.isReservedEventId('qaleaders-summit') && !http.isReservedEventId('leaders-qa') &&
    !http.isReservedEventId('aqa-x'));
  check('the other reserved addresses are unchanged', ['new', 'gen-x', 'imported-x', 'import-x', '2027', 'templates'].every(http.isReservedEventId) &&
    !http.isReservedEventId('leaders-summit-2027'));

  /* the address check */
  var r = await call('GET', '/api/event/slug-available?slug=' + NAME);
  check('deployed: the address check says reserved, suggesting the words with the prefix moved to the end', r.status === 200 && r.json && r.json.available === false &&
    r.json.reason === 'reserved' && r.json.suggestion === 'leaders-summit-2027-qa' && /That address is reserved\. Try "leaders-summit-2027-qa"\./.test(r.json.message), r.json);
  DOCS['events/leaders-summit-2027-qa'] = { createdAt: '2026-10-01T00:00:00.000Z' };
  r = await call('GET', '/api/event/slug-available?slug=' + NAME);
  check('… and the next free one when that is taken', r.json && r.json.suggestion === 'leaders-summit-2027-qa-2', r.json);
  delete DOCS['events/leaders-summit-2027-qa'];
  r = await call('GET', '/api/event/slug-available?slug=qa-qa');
  check('… a suggestion never starts with qa- either', r.json && r.json.suggestion && !/^qa-/.test(r.json.suggestion) && !http.isReservedEventId(r.json.suggestion), r.json);
  r = await call('GET', '/api/event/slug-available?slug=qa-gen-x');
  check('… nor with another reserved prefix', r.json && r.json.suggestion === 'x-qa', r.json);

  /* create and clone */
  r = await call('POST', '/api/event', { eventId: NAME, name: 'QA Leaders Summit 2027' });
  check('deployed: creating a qa- event answers 400 slug-reserved with the suggestion, writing nothing', r.status === 400 && r.json && r.json.code === 'slug-reserved' &&
    r.json.suggestion === 'leaders-summit-2027-qa' && WRITES === 0, [r.status, r.json, WRITES]);
  DOCS['events/source-ev'] = { name: 'Source', createdAt: '2026-10-01T00:00:00.000Z' };
  r = await call('POST', '/api/event/clone', { sourceEventId: 'source-ev', eventId: NAME, name: 'QA Leaders Summit 2027' });
  check('deployed: cloning into a qa- address answers 400 slug-reserved with the suggestion, writing nothing', r.status === 400 && r.json && r.json.code === 'slug-reserved' &&
    r.json.suggestion === 'leaders-summit-2027-qa' && WRITES === 0, [r.status, r.json, WRITES]);

  /* local: the harness's own server */
  delete process.env.K_SERVICE;
  r = await call('GET', '/api/event/slug-available?slug=' + NAME);
  check('local: a free qa- address is available (the harness creates and clones its events this way)', r.json && r.json.available === true && r.json.suggestion === NAME, r.json);

  if (failed) { console.error('event-address-qa: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('event-address-qa: all ' + passed + ' checks passed');
})().catch(function (err) { console.error('event-address-qa: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
