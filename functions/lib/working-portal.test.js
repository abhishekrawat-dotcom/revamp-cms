/* node functions/lib/working-portal.test.js — the portal a person works on (lib/working-portal.js), for the owner's
   decision of 3 Nov 2026 that the dashboard works one portal at a time, "remembered for the person": what GET
   answers (nothing chosen, a portal, All portals, a value no longer on the roster), what PUT keeps and where
   (userPrefs/<uid made safe>), what it refuses, signed out, and a failed read or write. Runs against an in-memory
   Firestore with the helpers lib/api.js hands over (portalHelpers). No network. Exits 1 on any failure. */
'use strict';
const path = require('path');
const childProcess = require('child_process');
const fs = require('fs');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- loading: no environment, no side effects ---------- */
var MOD = path.join(__dirname, 'working-portal.js');
var loaded = childProcess.spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(MOD) + ')'], { env: {}, encoding: 'utf8' });
check('the module loads with no environment at all, and says nothing', loaded.status === 0 && !loaded.stdout && !loaded.stderr, { status: loaded.status, out: loaded.stdout, err: loaded.stderr });
var requires = (fs.readFileSync(MOD, 'utf8').match(/require\(\s*['"][^'"]+['"]\s*\)/g) || []).map(function (r) { return r.replace(/^require\(\s*['"]|['"]\s*\)$/g, ''); });
check('it requires only lib/et-events.js and the access rule (lib/access-control.js: a person\'s portals)', same(requires, ['./et-events', './access-control']), requires);
var timersBefore = process.getActiveResourcesInfo().filter(function (r) { return r === 'Timeout'; }).length;
const wp = require('./working-portal');
check('loading it starts no timer', process.getActiveResourcesInfo().filter(function (r) { return r === 'Timeout'; }).length === timersBefore);
check('it exports the contract (K5)', ['wire', 'handleGet', 'handlePut', 'PREFS', 'keyOf'].every(function (k) { return k in wp; }));
check('the store is userPrefs', wp.PREFS === 'userPrefs');

/* keyOf: lib/api.js chatUserRef's rule */
check('keyOf: a Firebase uid is kept as it is', wp.keyOf('Xy3kPq9ZaB1cD2eF3gH4iJ5kL6m7') === 'Xy3kPq9ZaB1cD2eF3gH4iJ5kL6m7');
check('keyOf: "/" and other characters become _', wp.keyOf('team/asha') === 'team_asha' && wp.keyOf('a b#c?d') === 'a_b_c_d' && wp.keyOf('a@b.c-d_e') === 'a@b.c-d_e');
check('keyOf: at most 120 characters', wp.keyOf('x'.repeat(300)) === 'x'.repeat(120));
check('keyOf: nothing for no uid', wp.keyOf('') === '' && wp.keyOf(null) === '' && wp.keyOf(undefined) === '');
check('keyOf: never a name Firestore keeps for itself', wp.keyOf('.') === 'u.' && wp.keyOf('..') === 'u..' && wp.keyOf('__name__') === 'u__name__' && wp.keyOf('__x__') !== '__x__');

/* ---------- an in-memory Firestore, just what the module calls ---------- */
function fakeFb() {
  var f = { docs: {}, reads: [], writes: [], readFail: null, writeFail: null };
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      get: function () {
        f.reads.push(p);
        if (f.readFail) return Promise.reject(f.readFail);
        var d = f.docs[p];
        return Promise.resolve({ id: p.split('/').pop(), exists: !!d, data: function () { return d ? clone(d) : undefined; } });
      },
      set: function (data, o) {
        f.writes.push({ path: p, data: clone(data), merge: !!(o && o.merge) });
        if (f.writeFail) return Promise.reject(f.writeFail);
        f.docs[p] = Object.assign(o && o.merge && f.docs[p] ? f.docs[p] : {}, clone(data));
        return Promise.resolve();
      } };
  }
  f.db = { collection: function (n) { return { doc: function (id) { if (!id || /\//.test(id)) throw new Error('fake: a bad document id "' + id + '"'); return docRef(n + '/' + id); } }; } };
  return f;
}
var FB = fakeFb();
var fbPath = require.resolve('./firebase');
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { getFirebase: function () { return FB; } } };
const http = require('./http');

var failures = [], limitsSeen = [];
function sendFailure(res, what, err, friendly) {
  if (err && err.status && err.body) return http.sendJson(res, err.status, err.body);
  failures.push(what);
  http.sendJson(res, 500, { error: friendly || 'Something went wrong on the server. Please try again.' });
}
/* who signs in: 'Bearer asha' -> asha@…, uid u-asha; an object is the decoded token as it is */
function decodedOf(req) {
  if (req.who && typeof req.who === 'object') return req.who;
  var m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
  return m ? { email: m[1] + '@timesinternet.in', uid: 'u-' + m[1] } : null;
}
var HELPERS = Object.freeze({
  withAdmin: function (req, res, cb) { var d = decodedOf(req); if (!d) return http.sendJson(res, 401, { error: 'Sign in required.' }); cb(FB, d); },
  withAdminBody: function (req, res, maxBytes, cb) {
    limitsSeen.push(maxBytes);
    HELPERS.withAdmin(req, res, function (fb, d) {
      var raw = req.rawBody || '{}';
      if (raw.length > maxBytes) return http.sendJson(res, 413, { error: 'That request is too large.' });
      var body;
      try { body = JSON.parse(raw); } catch (e) { return http.sendJson(res, 400, { error: 'Invalid JSON body' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return http.sendJson(res, 400, { error: 'Invalid JSON body' });
      cb(fb, d, body);
    });
  },
  eventDocRef: function () { throw new Error('the working portal reads no event'); },
  eventStateOf: function () { throw new Error('the working portal reads no event'); },
  approvalsConfig: function () { throw new Error('the working portal needs no approver'); },
  actorOf: function (d) { return (d && (d.email || d.uid)) || 'system'; },
  logActivity: function () { throw new Error('the working portal is no event\'s history'); },
  sendJson: http.sendJson, sendFailure: sendFailure,
  httpError: function (s, m, x) { var e = new Error(m); e.status = s; e.body = Object.assign({ error: m }, x || {}); return e; },
  BODY_LIMITS: Object.freeze({ tiny: 16 * 1024, small: 256 * 1024 }), isEventId: http.isEventId
});

function call(handler, method, body, who) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (typeof who === 'string') headers.authorization = 'Bearer ' + who;
    var req = { method: method, url: '/api/me/working-portal', headers: headers, who: who, rawBody: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) };
    var res = { statusCode: 200, headersSent: false,
      writeHead: function (s) { res.statusCode = s; res.headersSent = true; return res; },
      setHeader: function () {}, end: function (b) { var j = null; try { j = JSON.parse(String(b || '')); } catch (e) { /* not json */ } resolve({ status: res.statusCode, body: j }); } };
    handler(req, res);
  });
}
function GET(who) { return call(wp.handleGet, 'GET', undefined, who); }
function PUT(body, who) { return call(wp.handlePut, 'PUT', body, who); }
function quietly(fn) {
  var err = console.error;
  console.error = function () {};
  return fn().then(function (v) { console.error = err; return v; }, function (e) { console.error = err; throw e; });
}

async function main() {
  var out = await GET('asha');
  check('unwired: 503 module-unavailable, nothing read', out.status === 503 && out.body.code === 'module-unavailable' && !FB.reads.length);
  wp.wire(HELPERS);

  /* GET */
  out = await GET(null);
  check('GET signed out: 401, nothing read', out.status === 401 && !FB.reads.length);
  out = await GET('asha');
  check('GET with nothing stored: null (never chosen)', out.status === 200 && same(out.body, { workingPortal: null }) && same(FB.reads, ['userPrefs/u-asha']), { out: out, reads: FB.reads });
  FB.docs['userPrefs/u-asha'] = { uid: 'u-asha', email: 'asha@timesinternet.in', workingPortal: 'hr', updatedAt: '2026-11-01T00:00:00Z' };
  out = await GET('asha');
  check('GET with hr stored: hr', out.status === 200 && same(out.body, { workingPortal: 'hr' }), out);
  FB.docs['userPrefs/u-asha'].workingPortal = 'all';
  out = await GET('asha');
  check('GET with All portals stored: all', same(out.body, { workingPortal: 'all' }), out);
  for (var bad of ['hrworld', '__proto__', 'toString', '', 7, null, { slug: 'hr' }, 'ALL', 'HR']) {
    FB.docs['userPrefs/u-ravi'] = { workingPortal: bad };
    out = await GET('ravi');
    check('GET with ' + JSON.stringify(bad) + ' stored (off the roster): null', out.status === 200 && same(out.body, { workingPortal: null }), out);
  }
  FB.docs['userPrefs/u-ravi'] = {};
  out = await GET('ravi');
  check('GET with a document but no choice in it: null', same(out.body, { workingPortal: null }));
  check('GET reads only the person\'s own document', FB.reads.every(function (p) { return p === 'userPrefs/u-asha' || p === 'userPrefs/u-ravi'; }), FB.reads);
  out = await GET({ email: 'team@timesinternet.in', uid: 'team/x' });
  check('GET for a uid with "/" reads its safe key', out.status === 200 && FB.reads[FB.reads.length - 1] === 'userPrefs/team_x', FB.reads);
  out = await GET({ email: 'nouid@timesinternet.in' });
  check('GET for a sign-in with no uid: 401, nothing read', out.status === 401 && FB.reads[FB.reads.length - 1] === 'userPrefs/team_x');

  /* PUT */
  limitsSeen = [];
  out = await PUT({ workingPortal: 'hr' }, null);
  check('PUT signed out: 401, nothing written', out.status === 401 && !FB.writes.length);
  out = await PUT({ workingPortal: 'hr' }, 'meera');
  var d = FB.docs['userPrefs/u-meera'];
  check('PUT hr: { ok, workingPortal }', out.status === 200 && same(out.body, { ok: true, workingPortal: 'hr' }), out);
  check('PUT hr: kept under the person\'s key, with who and when', d && d.uid === 'u-meera' && d.email === 'meera@timesinternet.in' && d.workingPortal === 'hr' && !isNaN(Date.parse(d.updatedAt)), d);
  check('PUT merges into the person\'s document', FB.writes.length === 1 && FB.writes[0].merge === true && same(Object.keys(FB.writes[0].data).sort(), ['email', 'uid', 'updatedAt', 'workingPortal']), FB.writes);
  out = await GET('meera');
  check('and GET answers it back', same(out.body, { workingPortal: 'hr' }));
  FB.docs['userPrefs/u-meera'].other = 'kept';
  out = await PUT({ workingPortal: 'all' }, 'meera');
  check('PUT all: All portals is a choice too, and it is kept', out.status === 200 && same(out.body, { ok: true, workingPortal: 'all' }) && FB.docs['userPrefs/u-meera'].workingPortal === 'all', out);
  check('PUT leaves the rest of the document as it was', FB.docs['userPrefs/u-meera'].other === 'kept');
  out = await GET('meera');
  check('GET after PUT all: all', same(out.body, { workingPortal: 'all' }));
  out = await PUT({ workingPortal: 'cio' }, { email: 'Team@timesinternet.in', uid: 'team/lead' });
  check('PUT for a uid with "/": stored under its safe key', out.status === 200 && FB.docs['userPrefs/team_lead'] && FB.docs['userPrefs/team_lead'].workingPortal === 'cio' && FB.docs['userPrefs/team_lead'].uid === 'team/lead', Object.keys(FB.docs));
  var writes = FB.writes.length;
  var refusals = [
    [{ workingPortal: 'hrworld' }, 'Unknown portal "hrworld".'], [{ workingPortal: '__proto__' }, 'Unknown portal "__proto__".'], [{ workingPortal: 'toString' }, 'Unknown portal "toString".'],
    [{ workingPortal: 'HR' }, 'Unknown portal "HR".'], [{ workingPortal: 'All' }, 'Unknown portal "All".'], [{ workingPortal: 7 }, 'Unknown portal "7".'], [{ workingPortal: ['hr'] }, 'Unknown portal "hr".'],
    [{ workingPortal: '' }, 'Choose a portal, or All portals.'], [{ workingPortal: null }, 'Choose a portal, or All portals.'], [{}, 'Choose a portal, or All portals.'],
    [{ workingPortal: 'y'.repeat(90) }, 'Unknown portal "' + 'y'.repeat(40) + '".']
  ];
  for (var i = 0; i < refusals.length; i++) {
    out = await PUT(refusals[i][0], 'meera');
    check('PUT ' + JSON.stringify(refusals[i][0]).slice(0, 60) + ': 400 unknown-portal, in words', out.status === 400 && out.body.code === 'unknown-portal' && out.body.field === 'workingPortal' && out.body.error === refusals[i][1], out);
  }
  check('a refused PUT writes nothing', FB.writes.length === writes && FB.docs['userPrefs/u-meera'].workingPortal === 'all');
  out = await PUT('[1]', 'meera');
  check('a body that is not an object: 400, nothing written', out.status === 400 && FB.writes.length === writes);
  out = await PUT({ workingPortal: 'hr', pad: 'z'.repeat(20000) }, 'meera');
  check('a body over the tiny limit: 413', out.status === 413 && FB.writes.length === writes, out.status);
  check('the body is read with the tiny limit', limitsSeen.length && limitsSeen.every(function (l) { return l === 16 * 1024; }), limitsSeen);
  out = await PUT({ workingPortal: 'hr' }, { email: 'nouid@timesinternet.in' });
  check('PUT for a sign-in with no uid: 401, nothing written', out.status === 401 && FB.writes.length === writes);

  /* failures: a plain sentence, never Firestore's text */
  FB.readFail = new Error('UNAVAILABLE: projects/revamp-cms/databases/(default)');
  out = await quietly(function () { return GET('asha'); });
  check('a failed read: 500 with a plain sentence', out.status === 500 && out.body.error === 'Your portal could not be read. Please try again.' && failures.indexOf('working portal') !== -1, out);
  FB.readFail = null;
  FB.writeFail = new Error('DEADLINE_EXCEEDED');
  out = await quietly(function () { return PUT({ workingPortal: 'cfo' }, 'asha'); });
  check('a failed write: 500 with a plain sentence', out.status === 500 && out.body.error === 'Your portal could not be saved. Please try again.', out);
  FB.writeFail = null;
}

main().then(function () {
  console.log('working-portal: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error('working-portal: the test itself failed — ' + (err && err.stack || err));
  process.exit(1);
});
