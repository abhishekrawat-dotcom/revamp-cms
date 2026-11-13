/* node functions/lib/session-ai-limits.test.js — the launch-check items closed after the 13 Nov security blockers, through
   the real router (lib/api.js handleApi), the real sign-in gate (lib/access.js gate) and the real server.js, with an
   in-memory Firestore and Storage, the model scripted (no AI call is made, nothing is paid for) and a stand-in web site
   on 127.0.0.1 that the page reader reaches only through safeFetch's test hooks (a made-up public name). Production is
   never touched: the database is a stand-in and the tokens are made up.
     BE-058  a sign-in older than SESSION_MAX_AGE_DAYS, or one Firebase Auth revoked, disabled or deleted, signs in
             again (401 reauth; a page goes to /?reauth=1); the revocation answer is kept for a few minutes; a fault of
             Firebase Auth does not sign anyone out; the AI steps' writes name who made them
     BE-018  a person's paid AI steps are limited per route (429 rate-limited)
     BE-021  suggest-design needs the event's name and its template (400 need-event-details), plan-structure something
             to work from (400 need-input) — both before any model call
     BE-020 / BE-026  ingest-source reads a public web page only (400 bad-url for a private, loopback, link-local or
             metadata address, also behind a redirect), only a page (415), not too large (413), and refuses a page with
             too little text before the model is asked (422 unreadable) unless the rendering service can read it
     BE-057  the app's pages and /preview/ cannot be framed by another site; the published site's headers are unchanged */
'use strict';
var passed = 0, failed = 0;
function reportError(s) { process.stderr.write(s + '\n'); }
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  reportError('FAIL ' + name + (detail !== undefined ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : ''));
}
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
/* what the server logs is kept (a fault of Firebase Auth is logged once), not printed */
var logged = [];
console.error = function () { logged.push(Array.prototype.join.call(arguments, ' ')); };

var path = require('path');
var NOW_S = Math.floor(Date.now() / 1000), DAY_S = 86400;

/* ---------- an in-memory Firestore and Storage, and the sign-in tokens ----------
   "<name>" is <name>@timesinternet.in, signed in an hour ago; "old" signed in 15 days ago, "thirteen" 13 days ago;
   "revoked" / "disabled" / "deleted": Firebase Auth says so when asked (checkRevoked); "flaky": Firebase Auth cannot be
   asked; "noauthtime": a token with no auth_time; "expired": does not verify. */
var revocationAsked = {};
var AUTH_TIME = { old: NOW_S - 15 * DAY_S, thirteen: NOW_S - 13 * DAY_S };
function decodedFor(t) {
  var d = { email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } };
  if (t !== 'noauthtime') d.auth_time = AUTH_TIME[t] || NOW_S - 3600;
  return d;
}
var AUTH = {
  verifyIdToken: function (t, checkRevoked) {
    if (t === 'expired') return Promise.reject(Object.assign(new Error('expired'), { code: 'auth/id-token-expired' }));
    if (checkRevoked) {
      revocationAsked[t] = (revocationAsked[t] || 0) + 1;
      if (t === 'revoked') return Promise.reject(Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' }));
      if (t === 'disabled') return Promise.reject({ errorInfo: { code: 'auth/user-disabled' }, message: 'disabled' });
      if (t === 'deleted') return Promise.reject(Object.assign(new Error('gone'), { code: 'auth/user-not-found' }));
      if (t === 'flaky') return Promise.reject(Object.assign(new Error('socket hang up'), { code: 'app/network-error' }));
    }
    return Promise.resolve(decodedFor(t));
  }
};
function fakeFb() {
  var docs = {}, files = {}, seq = 0;
  function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function write(target, data, merge) {
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      if (merge && isPlain(v)) { if (!isPlain(target[k])) target[k] = {}; write(target[k], v, true); }
      else target[k] = clone(v);
    });
  }
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { var merge = !!(o && o.merge); if (!merge || !docs[p]) docs[p] = merge && docs[p] ? docs[p] : {}; write(docs[p], data, merge); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); write(docs[p], data, false); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p, order, lim) {
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(16, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(16, '0')); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function (f, dir) { return colRef(p, { f: f, desc: dir === 'desc' }, lim); },
      limit: function (n) { return colRef(p, order, n); },
      where: function () { return colRef(p, order, lim); },
      select: function () { return colRef(p, order, lim); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        if (order) list = list.filter(function (s) { return s.data()[order.f] !== undefined; }).sort(function (a, b) { var x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (order.desc ? -1 : 1); });
        if (lim) list = list.slice(0, lim);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
      } };
  }
  function runTransaction(fn) {
    var writes = [];
    var tx = {
      get: function (ref) { return ref.get(); },
      set: function (ref, data, o) { writes.push(function () { return ref.set(data, o); }); return tx; },
      update: function (ref, data) { writes.push(function () { return ref.update(data); }); return tx; }
    };
    return Promise.resolve(fn(tx)).then(function (out) { return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return out; }); });
  }
  var bucket = { name: 'test-bucket',
    file: function (p) {
      return {
        save: function (buf) { files[p] = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)); return Promise.resolve(); },
        makePublic: function () { return Promise.resolve(); },
        download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(new Error('No such object: ' + p)); },
        delete: function () { delete files[p]; return Promise.resolve(); }
      };
    } };
  return { db: { collection: function (n) { return colRef(n); }, runTransaction: runTransaction }, bucket: bucket, docs: docs, files: files, auth: AUTH };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
process.env.ACCESS_CONFIG_DOC = 'config/test-session-access';
delete process.env.LOVABLE_SCRAPER_URL;
delete process.env.SESSION_MAX_AGE_DAYS;

/* ---------- the web, as the page reader sees it: every name is "public" (93.184.216.34), except internal.test, and
   every connection goes to the stand-in site below. IP literals, localhost and redirects are checked for real. ---------- */
var realSafe = require('./safe-fetch');
var helperPort = 0, hits = {}, agents = {};
function lookup(host, opts, cb) {
  if (typeof opts === 'function') cb = opts;
  cb(null, [{ address: host === 'internal.test' ? '10.0.0.5' : '93.184.216.34', family: 4 }]);
}
function toHelper() { return { address: '127.0.0.1', port: helperPort }; }
require.cache[require.resolve('./safe-fetch')] = { id: require.resolve('./safe-fetch'), filename: require.resolve('./safe-fetch'), loaded: true, exports: {
  safeFetch: function (raw, o) { return realSafe.safeFetch(raw, Object.assign({}, o, { lookup: lookup, _connectTo: toHelper })); },
  checkPublicUrl: function (raw, o) { return realSafe.checkPublicUrl(raw, Object.assign({ lookup: lookup }, o)); },
  isPublicAddress: realSafe.isPublicAddress
} };

var WORDS = 'The Summit brings together two hundred technology leaders from across India for a day of keynotes, panels and roundtables on data, cloud and security. ';
var PAGE = '<!doctype html><html><head><title>Summit</title></head><body><header><h1>The Summit 2027</h1></header><main>' +
  '<section><h2>About</h2><p>' + WORDS + WORDS + '</p></section><section><h2>Agenda</h2><p>' + WORDS + WORDS + '</p></section></main></body></html>';
var SHELL = '<!doctype html><html><head><title>App</title><script type="module" src="/assets/index.js"></script></head><body><div id="root"></div></body></html>';
var helper = require('http').createServer(function (req, res) {
  var p = req.url.split('?')[0];
  hits[p] = (hits[p] || 0) + 1;
  agents[p] = req.headers['user-agent'];
  if (p === '/scrape') {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      var asked = {};
      try { asked = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* none */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      /* the page as a browser shows it: a shell that renders, and one that stays empty */
      res.end(JSON.stringify({ html: /shell-empty/.test(asked.url || '') ? SHELL : PAGE.replace('The Summit 2027', 'The Summit 2027 (rendered)') }));
    });
    return;
  }
  if (p === '/page' || p === '/shell-renders' || p === '/shell-empty' || p === '/shell') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(p === '/page' ? PAGE : SHELL);
  }
  if (p === '/redirect-local') { res.writeHead(302, { Location: 'http://127.0.0.1/' }); return res.end(); }
  if (p === '/redirect-metadata') { res.writeHead(301, { Location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
  if (p === '/doc.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF-1.4 ' + WORDS); }
  if (p === '/huge') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<p>' + 'x'.repeat(3 * 1024 * 1024) + '</p>'); }
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end('<h1>Not found</h1>');
});

/* ---------- the model, scripted per route; every call kept ---------- */
var llm = require('./llm');
var calls = [], scripted = {};
llm.callJson = function (prompt, schema, opts) {
  var route = (opts && opts.route) || '';
  calls.push(route);
  var next = (scripted[route] || []).shift();
  if (!next) return Promise.resolve({ error: 'No answer scripted for ' + route + '.', code: 'ai-unavailable', status: 502 });
  return Promise.resolve({ parsed: next, provider: 'claude', model: 'claude-stub' });
};

var access = require('./access');
var http = require('./http');
var api = require('./api');

/* ---------- one request through the real router ---------- */
function fakeRes(resolve) {
  var res = { statusCode: 200, headers: {}, headersSent: false,
    setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
    writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
    write: function () { return true; },
    end: function (b) { var t = b === undefined ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: t, headers: res.headers }); } };
  return res;
}
function call(method, url, body, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'content-type': 'application/json' };
    if (opts.cookie) headers.cookie = '__session=' + opts.cookie;
    else if (opts.who !== null) headers.authorization = 'Bearer ' + (opts.who || 'asha');
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body === undefined ? '' : JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    api.handleApi(req, fakeRes(resolve));
  });
}
function gate(url, token, bearer) {
  return new Promise(function (resolve) {
    var headers = {};
    if (token && bearer) headers.authorization = 'Bearer ' + token; else if (token) headers.cookie = '__session=' + token;
    var req = { url: url, method: 'GET', headers: headers };
    access.gate(req, fakeRes(resolve), function () { resolve({ next: true, req: req }); });
  });
}

var NOW = new Date().toISOString();
function seed() {
  FB.docs['config/test-session-access'] = { defaultRole: 'editor', members: {} };
  FB.docs['events/ev-a'] = { name: 'Event A', createdAt: NOW, createdBy: 'asha@timesinternet.in', portal: 'cio', published: false, start: '2027-01-10', end: '2027-01-11', venue: 'Hall', city: 'Delhi' };
  FB.docs['events/ev-src'] = { name: 'Source A', createdAt: NOW, portal: 'cio' };
  FB.docs['events/ev-src2'] = { name: 'Source B', createdAt: NOW, portal: 'cio' };
  FB.docs['events/ev-empty'] = { createdAt: NOW, portal: 'cio' };            // a real event with nothing to design from
  FB.docs['events/ev-named'] = { name: 'Named only', createdAt: NOW, portal: 'cio' };
}
seed();

var steps = [];
function step(fn) { steps.push(fn); }

/* ================= BE-058: how long a sign-in lasts ================= */
step(function () {
  access.forgetSessions();
  revocationAsked = {};
  var t0 = Date.now();
  return access.verifySession(AUTH, 'asha', t0).then(function (d) {
    check('BE-058: a fresh sign-in is let in', d && d.email === 'asha@timesinternet.in');
    check('BE-058: Firebase Auth is asked whether it was revoked', revocationAsked.asha === 1, revocationAsked);
    return access.verifySession(AUTH, 'asha', t0 + 60 * 1000);
  }).then(function () {
    check('BE-058: the answer is kept for a few minutes (not asked again a minute later)', revocationAsked.asha === 1, revocationAsked);
    return access.verifySession(AUTH, 'asha', t0 + access.REVOCATION_CHECK_MS + 1000);
  }).then(function () {
    check('BE-058: ...and asked again once that time is up', revocationAsked.asha === 2, revocationAsked);
    check('BE-058: sessions last 14 days unless SESSION_MAX_AGE_DAYS says otherwise', access.SESSION_MAX_AGE_DAYS === 14, access.SESSION_MAX_AGE_DAYS);
    return Promise.all(['old', 'revoked', 'disabled', 'deleted', 'expired'].map(function (t) {
      return access.verifySession(AUTH, t).then(function () { return { ok: true }; }, function (e) { return { code: e.code, why: e.why, reauth: access.isReauth(e) }; });
    }));
  }).then(function (r) {
    check('BE-058: a sign-in 15 days old must sign in again (too-old)', r[0].reauth && r[0].why === 'too-old', r[0]);
    check('BE-058: ...without Firebase Auth even being asked', !revocationAsked.old, revocationAsked);
    check('BE-058: a revoked sign-in must sign in again', r[1].reauth && r[1].why === 'revoked', r[1]);
    check('BE-058: a disabled account must sign in again (its error in errorInfo)', r[2].reauth && r[2].why === 'disabled', r[2]);
    check('BE-058: a deleted account must sign in again', r[3].reauth && r[3].why === 'deleted', r[3]);
    check('BE-058: a token that does not verify is not a reauth: its own error', !r[4].reauth && r[4].code === 'auth/id-token-expired', r[4]);
    logged = [];
    return Promise.all(['thirteen', 'flaky', 'flaky', 'noauthtime'].map(function (t) { return access.verifySession(AUTH, t).then(function (d) { return !!d; }, function () { return false; }); }));
  }).then(function (r) {
    check('BE-058: 13 days old is still let in', r[0] === true);
    check('BE-058: Firebase Auth unreachable: the token\'s own checks decide, nobody is signed out', r[1] === true && r[2] === true);
    check('BE-058: ...and the fault is logged, once', logged.filter(function (l) { return /could not be checked/.test(l); }).length === 1, logged);
    check('BE-058: ...and asked again on the next request (a fault is not remembered as "fine")', revocationAsked.flaky === 2, revocationAsked);
    check('BE-058: a token with no auth_time is not refused for its age', r[3] === true);
  });
});
step(function () {
  return Promise.all([
    call('GET', '/api/event?eventId=ev-a', undefined, { who: 'old' }),
    call('GET', '/api/event?eventId=ev-a', undefined, { who: 'revoked' }),
    call('GET', '/api/event?eventId=ev-a', undefined, { who: 'asha' }),
    call('GET', '/api/generated-section?eventId=ev-a&id=overview', undefined, { cookie: 'old' }),
    call('GET', '/api/event?eventId=ev-a', undefined, { who: 'expired' })
  ]).then(function (r) {
    check('BE-058: requireAdmin: a 15-day-old sign-in answers 401 reauth', r[0].status === 401 && r[0].body && r[0].body.code === 'reauth', [r[0].status, r[0].body]);
    check('BE-058: requireAdmin: a revoked sign-in answers 401 reauth', r[1].status === 401 && r[1].body && r[1].body.code === 'reauth', [r[1].status, r[1].body]);
    check('BE-058: requireAdmin: a fresh one is let in', r[2].status === 200, r[2].status);
    check('BE-058: requireMember (the sign-in cookie): a 15-day-old sign-in answers 401 reauth', r[3].status === 401 && r[3].body && r[3].body.code === 'reauth', [r[3].status, r[3].body]);
    check('BE-058: an expired token is still a plain 401', r[4].status === 401 && r[4].body && r[4].body.code !== 'reauth', [r[4].status, r[4].body]);
    return Promise.all([gate('/Event_Listing.html?x=1', 'old'), gate('/api/events', 'old'), gate('/Event_Listing.html', 'asha'), gate('/Event_Listing.html', 'disabled', true), gate('/Event_Listing.html', 'expired')]);
  }).then(function (g) {
    check('BE-058: the gate sends a too-old sign-in to sign in again, signed out first (?reauth=1), and back', g[0].status === 302 && g[0].headers.location === '/?reauth=1&next=' + encodeURIComponent('/Event_Listing.html?x=1'), g[0]);
    check('BE-058: the gate answers an API call 401 { code: reauth }', g[1].status === 401 && JSON.parse(g[1].text).code === 'reauth', g[1]);
    check('BE-058: the gate lets a fresh sign-in through', g[2].next === true && g[2].req.user && g[2].req.user.email === 'asha@timesinternet.in', g[2]);
    check('BE-058: the gate refuses a disabled account (Bearer) with ?reauth=1', g[3].status === 302 && /^\/\?reauth=1&next=/.test(g[3].headers.location), g[3]);
    check('BE-058: the gate sends an expired token to sign in as before (no reauth)', g[4].status === 302 && g[4].headers.location === '/?next=' + encodeURIComponent('/Event_Listing.html'), g[4]);
    var p = http.adminFromRequest({ headers: { authorization: 'Bearer old' } });
    return p;
  }).then(function (user) {
    check('BE-058: adminFromRequest (/preview/, the public routes\' signed-in extras): a too-old sign-in is nobody', user === null, user);
  });
});

/* ================= BE-021: nothing to work from, nothing paid for ================= */
step(function () {
  var n = calls.length;
  return Promise.all([
    call('POST', '/api/suggest-design', {}),
    call('POST', '/api/suggest-design', { event: { name: '   ' }, currentTemplate: { id: 'tech500' } }),
    call('POST', '/api/suggest-design', { event: { name: 'The Summit' } })
  ]).then(function (r) {
    check('BE-021: suggest-design {} -> 400 need-event-details', r[0].status === 400 && r[0].body.code === 'need-event-details', [r[0].status, r[0].body]);
    check('BE-021: suggest-design with a blank name -> 400 need-event-details', r[1].status === 400 && r[1].body.code === 'need-event-details', [r[1].status, r[1].body]);
    check('BE-021: suggest-design with no template -> 400 need-event-details', r[2].status === 400 && r[2].body.code === 'need-event-details' && /template/i.test(r[2].body.error), [r[2].status, r[2].body]);
    check('BE-021: nothing asked of the model', calls.length === n, calls.slice(n));
    return call('POST', '/api/suggest-design', { event: { name: 'The Summit', category: 'Technology' }, currentTemplate: { id: 'tech500', name: 'Tech 500' }, sections: [] });
  }).then(function (r) {
    check('BE-021: with the name and the template, the model is asked', calls.length === n + 1 && calls[n] === 'suggest-design', [r.status, calls.slice(n)]);
  });
});
step(function () {
  var n = calls.length, before = JSON.stringify(FB.docs['events/ev-empty']);
  return call('POST', '/api/plan-structure', { eventId: 'ev-empty', themeMode: 'auto', designNotes: '  ', siteMode: 'standard' }).then(function (r) {
    check('BE-021: plan-structure with no name, description, brief, source or notes -> 400 need-input', r.status === 400 && r.body && r.body.code === 'need-input', [r.status, r.body]);
    check('BE-021: ...before any model call (the plan, the logo unit, the photos)', calls.length === n, calls.slice(n));
    check('BE-021: ...and nothing written', JSON.stringify(FB.docs['events/ev-empty']) === before, FB.docs['events/ev-empty']);
    return call('POST', '/api/plan-structure', { eventId: 'ev-empty', designNotes: 'A calm, editorial look for a CIO round table.' });
  }).then(function (r) {
    check('BE-021: the owner\'s notes are something to work from', r.status !== 400 && calls.indexOf('plan-structure', n) !== -1, [r.status, r.body, calls.slice(n)]);
    var m = calls.length;
    return call('POST', '/api/plan-structure', { eventId: 'ev-named' }).then(function (r2) {
      check('BE-021: an event with a name alone is designed (a thin run), as before', r2.status !== 400 && calls.indexOf('plan-structure', m) !== -1, [r2.status, r2.body, calls.slice(m)]);
    });
  });
});

/* ================= BE-020 / BE-026: reading a link ================= */
var SOURCE_ANSWER = { sections: [{ heading: 'About', body: 'A one-day summit for technology leaders.' }],
  design: { layoutStyle: 'Full-width bands.', heroStyle: 'Text on colour.', sectionPattern: ['About — one column'], imageryStyle: 'Almost none.', typography: 'Sans.', density: 'airy' } };
function sourcesOf(eventId) { return Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + eventId + '/sources/') === 0; }); }
step(function () {
  var n = calls.length, h = JSON.stringify(hits);
  var refused = ['http://localhost:8401/__qa', 'http://169.254.169.254/latest/meta-data/', 'http://10.255.255.1/', 'http://100.64.0.1/', 'http://[::ffff:127.0.0.1]/',
    'http://2130706433/', 'http://internal.test/', 'http://127.0.0.1:8080/', 'http://public.test:8080/', 'http://user:pw@public.test/', 'http://[::1]/', 'http://0.0.0.0/', 'http://metadata.google.internal/'];
  return Promise.all(refused.map(function (u) { return call('POST', '/api/ingest-source', { eventId: 'ev-src', url: u, type: 'competitor' }); })).then(function (r) {
    r.forEach(function (x, i) { check('BE-026: ' + refused[i] + ' -> 400 bad-url', x.status === 400 && x.body && x.body.code === 'bad-url', [x.status, x.body]); });
    return Promise.all([
      call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'ftp://public.test/x', type: 'competitor' }),
      call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'javascript:alert(1)', type: 'competitor' }),
      call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'http://public.test/redirect-local', type: 'competitor' }),
      call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'http://public.test/redirect-metadata', type: 'previousEdition' })
    ]);
  }).then(function (r) {
    check('BE-026: another scheme -> 400 bad-url', r[0].status === 400 && r[0].body.code === 'bad-url' && r[1].status === 400 && r[1].body.code === 'bad-url', [r[0], r[1]]);
    check('BE-026: a public page that redirects to loopback -> 400 bad-url', r[2].status === 400 && r[2].body.code === 'bad-url', [r[2].status, r[2].body]);
    check('BE-026: a public page that redirects to the metadata service -> 400 bad-url', r[3].status === 400 && r[3].body.code === 'bad-url', [r[3].status, r[3].body]);
    check('BE-026: no model call for any of them', calls.length === n, calls.slice(n));
    check('BE-026: nothing stored', sourcesOf('ev-src').length === 0, sourcesOf('ev-src'));
    check('BE-026: the stand-in site was asked only for the two redirects', hits['/redirect-local'] === 1 && hits['/redirect-metadata'] === 1 && Object.keys(hits).length === 2, [h, hits]);
    return Promise.all([
      call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'http://public.test/doc.pdf', type: 'competitor' }),
      call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'http://public.test/huge', type: 'competitor' }),
      call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'http://public.test/shell', type: 'competitor' }),
      call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'http://public.test/missing', type: 'competitor' }),
      call('POST', '/api/ingest-source', { eventId: 'ev-nobody', url: 'http://public.test/page', type: 'competitor' })
    ]);
  }).then(function (r) {
    check('BE-026: a PDF -> 415 not-a-page', r[0].status === 415 && r[0].body.code === 'not-a-page', [r[0].status, r[0].body]);
    check('BE-026: a 3 MB page -> 413 too-large', r[1].status === 413 && r[1].body.code === 'too-large', [r[1].status, r[1].body]);
    check('BE-026: an empty shell, no rendering service -> 422 unreadable', r[2].status === 422 && r[2].body.code === 'unreadable', [r[2].status, r[2].body]);
    check('BE-026: a 404 page -> 502 unreachable-url, in a fixed sentence (no address echoed)', r[3].status === 502 && r[3].body.code === 'unreachable-url' && !/public\.test|https?:/.test(r[3].body.error), [r[3].status, r[3].body]);
    check('BE-026: an event that does not exist -> 404, the page not fetched', r[4].status === 404 && !hits['/page'], [r[4].status, r[4].body, hits]);
    check('BE-026: still no model call, nothing stored', calls.length === n && sourcesOf('ev-src').length === 0, [calls.slice(n), sourcesOf('ev-src')]);
    scripted['ingest-source'] = [clone(SOURCE_ANSWER)];
    return call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'http://public.test/page', type: 'competitor' });
  }).then(function (r) {
    check('BE-026: a real page is read: 200, one model call', r.status === 200 && calls.length === n + 1 && calls[n] === 'ingest-source', [r.status, r.body, calls.slice(n)]);
    var stored = sourcesOf('ev-src').map(function (k) { return FB.docs[k]; });
    check('BE-026: its reading is stored once', stored.length === 1 && stored[0].url === 'http://public.test/page' && stored[0].extractedSections.length === 1, stored);
    check('BE-058: the reading names who had it read (createdBy)', stored[0] && stored[0].createdBy === 'asha@timesinternet.in', stored[0] && stored[0].createdBy);
    check('BE-026: the page is asked for with the User-Agent this step always sent', agents['/page'] === 'Mozilla/5.0 (compatible; RevampCMS-Pilot/1.0)', agents['/page']);
    /* the rendering service: a shell it can render is read from what it renders; one it cannot is refused */
    process.env.LOVABLE_SCRAPER_URL = 'http://127.0.0.1:' + helperPort;
    scripted['ingest-source'] = [clone(SOURCE_ANSWER)];
    return Promise.all([
      call('POST', '/api/ingest-source', { eventId: 'ev-src2', url: 'http://public.test/shell-renders', type: 'competitor' }),
      call('POST', '/api/ingest-source', { eventId: 'ev-src2', url: 'http://public.test/shell-empty', type: 'competitor' })
    ]);
  }).then(function (r) {
    delete process.env.LOVABLE_SCRAPER_URL;
    check('BE-026: an empty shell the rendering service renders is read from the rendered page', r[0].status === 200, [r[0].status, r[0].body]);
    check('BE-026: an empty shell it cannot render either -> 422 unreadable', r[1].status === 422 && r[1].body.code === 'unreadable', [r[1].status, r[1].body]);
    check('BE-026: one model call for the two (the rendered page only)', calls.length === n + 2, calls.slice(n));
    check('BE-026: the rendering service was asked for both', hits['/scrape'] === 2, hits);
  });
});

/* ================= BE-058: the brief names who read it ================= */
step(function () {
  scripted['extract-brief'] = [{ theme: 'AI at work', audience: 'CIOs', tone: 'calm', tracks: ['Data'], speakerHints: [], sponsorHints: [], keyMessages: ['One'], inferredCategory: 'technology',
    ownerPoints: {}, visualIdentity: { designed: 'no' }, deckSections: [] }];
  return call('POST', '/api/extract-brief', { eventId: 'ev-a', fileName: 'b.txt', mimeType: 'text/plain', docBase64: Buffer.from('A summit for CIOs.').toString('base64'),
    eventMeta: { name: 'Event A', city: 'Delhi' } }, { who: 'ravi' }).then(function (r) {
    var brief = FB.docs['events/ev-a/briefs/' + (r.body && r.body.briefId)] || {};
    check('BE-058: extract-brief: the brief names who read it (createdBy)', r.status === 200 && brief.createdBy === 'ravi@timesinternet.in', [r.status, r.body, brief.createdBy]);
    check('BE-058: extract-brief: the event\'s facts name who wrote them (updatedBy)', FB.docs['events/ev-a'].updatedBy === 'ravi@timesinternet.in', FB.docs['events/ev-a'].updatedBy);
  });
});

/* ================= BE-018: a person's paid AI steps, per route ================= */
step(function () {
  check('BE-018: every paid step that had no limit of its own has one', ['POST /api/suggest-design', 'POST /api/redesign-section', 'POST /api/extract-brief', 'POST /api/ingest-source',
    'POST /api/plan-structure', 'POST /api/generate-content', 'POST /api/import-lovable', 'POST /api/promo/mailer/ai'].every(function (k) { return http.AI_RATE[k] && http.AI_RATE[k].max > 0; }), Object.keys(http.AI_RATE));
  var max = http.AI_RATE['POST /api/plan-structure'].max, seq = Promise.resolve(), statuses = [];
  for (var i = 0; i < max + 1; i++) {
    seq = seq.then(function () { return call('POST', '/api/plan-structure', { eventId: 'ev-nobody' }, { who: 'rita' }).then(function (r) { statuses.push(r.status); }); });
  }
  return seq.then(function () {
    check('BE-018: the first ' + max + ' plan-structure calls by one person in ten minutes go through', statuses.slice(0, max).every(function (s) { return s === 404; }), statuses);
    var last = statuses[max];
    check('BE-018: the ' + (max + 1) + 'st answers 429', last === 429, statuses.slice(-3));
    return Promise.all([
      call('POST', '/api/plan-structure', { eventId: 'ev-nobody' }, { who: 'rita' }),
      call('POST', '/api/plan-structure', { eventId: 'ev-nobody' }, { who: 'sam' }),
      call('POST', '/api/generate-content', { eventId: 'ev-nobody', templateId: 'gen-ev-nobody' }, { who: 'rita' }),
      call('GET', '/api/generated-section?eventId=ev-a&id=overview', undefined, { who: 'rita' })
    ]);
  }).then(function (r) {
    check('BE-018: 429 { code: rate-limited }, in words, with Retry-After', r[0].status === 429 && r[0].body.code === 'rate-limited' && /ETB2B AI/.test(r[0].body.error) && r[0].headers['retry-after'], [r[0].status, r[0].body, r[0].headers]);
    check('BE-018: another person is not limited by it', r[1].status === 404, r[1].status);
    check('BE-018: another route is counted on its own', r[2].status !== 429 && r[2].status >= 400 && r[2].status < 500, [r[2].status, r[2].body]);
    check('BE-018: reading is never limited', r[3].status !== 429, r[3].status);
  });
});

/* ================= BE-057: who may frame the app's pages ================= */
step(function () {
  return Promise.all([
    call('GET', '/preview/ev-a', undefined, { who: 'asha' }),
    call('GET', '/e/ev-a', undefined, { who: null })
  ]).then(function (r) {
    check('BE-057: /preview/ may be framed by the app only (frame-ancestors \'self\')', r[0].headers['content-security-policy'] === "frame-ancestors 'self'" && r[0].headers['x-frame-options'] === 'SAMEORIGIN', [r[0].status, r[0].headers]);
    check('BE-057: /preview/ keeps its Referrer-Policy', r[0].headers['referrer-policy'] === 'strict-origin-when-cross-origin', r[0].headers);
    check('BE-057: the published site\'s headers are unchanged (no CSP, no X-Frame-Options: the owner decides)', !r[1].headers['content-security-policy'] && !r[1].headers['x-frame-options'], [r[1].status, r[1].headers]);
  });
});
step(function () {
  /* server.js, as App Hosting runs it: its request listener, without listening on a port */
  var nodeHttp = require('http'), realCreate = nodeHttp.createServer, listener = null;
  nodeHttp.createServer = function (fn) { listener = fn; return { listen: function () { return this; } }; };
  try { require(path.join(__dirname, '..', '..', 'server.js')); } finally { nodeHttp.createServer = realCreate; }
  function get(url, cookie) {
    return new Promise(function (resolve) {
      var req = { url: url, method: 'GET', headers: cookie ? { cookie: '__session=' + cookie } : {} };
      listener(req, fakeRes(resolve));
    });
  }
  return Promise.all([get('/'), get('/Event_Listing.html', 'asha'), get('/auth.js'), get('/Event_Listing.html', 'old')]).then(function (r) {
    function framed(x) { return x.headers['content-security-policy'] === "frame-ancestors 'self'" && x.headers['x-frame-options'] === 'SAMEORIGIN' && x.headers['referrer-policy'] === 'strict-origin-when-cross-origin'; }
    check('BE-057: server.js: the sign-in page cannot be framed by another site', r[0].status === 200 && framed(r[0]), [r[0].status, r[0].headers]);
    check('BE-057: server.js: a signed-in page cannot be framed by another site, and is not cached', r[1].status === 200 && framed(r[1]) && r[1].headers['cache-control'] === 'no-store', [r[1].status, r[1].headers]);
    check('BE-057: server.js: a script is not given page headers', r[2].status === 200 && !r[2].headers['content-security-policy'], [r[2].status, r[2].headers]);
    check('BE-058: server.js: a page with a too-old sign-in goes to sign in again', r[3].status === 302 && /^\/\?reauth=1&next=/.test(r[3].headers.location), [r[3].status, r[3].headers]);
    var serve = require('fs').readFileSync(path.join(__dirname, '..', '..', 'tools', 'serve.js'), 'utf8');
    check('BE-057: tools/serve.js sends its pages with the same headers', /'Content-Security-Policy': "frame-ancestors 'self'"/.test(serve) && /'X-Frame-Options': 'SAMEORIGIN'/.test(serve) && /extname\(file\)\.toLowerCase\(\) === '\.html'\) Object\.assign\(headers, APP_PAGE_HEADERS\)/.test(serve));
    var signIn = require('fs').readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
    check('BE-058: the sign-in page signs the browser out on ?reauth=1 and says why', /params\.get\('reauth'\) === '1'/.test(signIn) && /Your sign-in has expired\. Please sign in again\./.test(signIn));
  });
});

/* ---------- run ---------- */
helper.listen(0, '127.0.0.1', function () {
  helperPort = helper.address().port;
  steps.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve()).then(function () {
    helper.close();
    console.log('session-ai-limits: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
    process.exit(failed ? 1 : 0);
  }, function (err) {
    helper.close();
    reportError('session-ai-limits: the run stopped — ' + (err && err.stack || err));
    process.exit(1);
  });
});
