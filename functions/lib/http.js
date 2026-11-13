// Request/response plumbing shared by every backend module (lib/api.js, lib/api-audience.js): JSON
// in/out, body size limits, who is calling, and the two small protections every public route needs.
//
// Nothing in here may throw into the caller's request stream callbacks. An exception nobody catches ends
// a plain Node http server's process, and with it every other request in flight on that instance — so
// each helper answers the request itself (4xx/5xx) or returns a value, never throws.
/* read when a request needs it, not when this file loads: lib/llm.js reads this file's request limit at its own
   load, so this file may load before a test has put its in-memory Firebase in place */
function getFirebase() { return require('./firebase').getFirebase(); }
const AC = require('./access-control');
/* verifySession: how long a sign-in lasts, and whether it was revoked — one rule with the gate (BE-058) */
const session = require('./access');

const DEFAULT_MAX_BODY = 32 * 1024 * 1024;   // App Hosting's own request ceiling; routes pass something tighter

function sendJson(res, status, obj, extraHeaders) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* socket already gone */ } return; }
  var headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

/* Calls cb(rawString) once the whole body has arrived, or answers 413 itself and never calls cb when the
   body is larger than maxBytes. (Firebase Functions v2 pre-buffers the body as req.rawBody; a plain http
   server does not — both are handled.) A route whose limit means something to the person — an image
   size — passes the sentence to answer with as tooLarge. */
function readBody(req, res, cb, maxBytes, tooLarge) {
  var limit = maxBytes || DEFAULT_MAX_BODY;
  tooLarge = tooLarge || 'That request is too large.';
  if (req.rawBody) {
    if (req.rawBody.length > limit) return sendJson(res, 413, { error: tooLarge });
    return cb(req.rawBody.toString('utf8'));
  }
  var chunks = [], size = 0, done = false;
  req.on('data', function (c) {
    if (done) return;
    size += c.length;
    if (size > limit) {
      done = true;
      sendJson(res, 413, { error: tooLarge });
      req.resume();                       // drain what is left so the socket can be reused
      return;
    }
    chunks.push(c);
  });
  req.on('end', function () { if (!done) { done = true; cb(Buffer.concat(chunks).toString('utf8')); } });
  req.on('error', function () { if (!done) { done = true; sendJson(res, 400, { error: 'The request could not be read.' }); } });
}

/* JSON.parse accepts `null`, `[]`, `7` and `"x"`. A handler that then reads body.someField throws inside
   the stream's "end" callback, where nothing catches it. Only a plain object is a valid body here. */
function parseJsonObject(raw) {
  var v = JSON.parse(raw || '{}');
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The JSON body must be an object.');
  return v;
}

/* cb(body) with a plain object, or a 400/413 answered here. */
function parseJsonBody(req, res, cb, maxBytes, tooLarge) {
  readBody(req, res, function (raw) {
    var body;
    try { body = parseJsonObject(raw); } catch (e) { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
    cb(body);
  }, maxBytes, tooLarge);
}

function bearerToken(req) {
  var m = /^Bearer\s+(.+)$/.exec((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  return m ? m[1] : '';
}
function sessionCookieToken(req) {
  var c = /(?:^|;\s*)__session=([^;]+)/.exec((req.headers && req.headers.cookie) || '');
  if (!c) return '';
  try { return decodeURIComponent(c[1]); } catch (e) { return ''; }
}

/* Every admin API route: a verified Firebase ID token in the Authorization header, for an account the access list
   lets in (lib/access-control.js: a company account at the default role, or someone an admin invited, and nobody
   blocked) — with the role the request needs (a Viewer reads, an Editor changes things, an Admin changes who has
   access) and, for someone who works in chosen portals only, an event of one of those portals.
   cb(fb, decoded), with decoded.access = { email, role, portals, member }. */
function requireAdmin(req, res, cb) {
  var token = bearerToken(req);
  if (!token) return sendJson(res, 401, { error: 'Sign in required — missing Authorization: Bearer <token> header.' });
  checkCaller(req, res, token, cb);
}

/* requireAdmin's rules — the access list, the role the request needs, the caller's portals — for a route a page
   also calls with its sign-in cookie alone (Create Event's AI steps, the site loader where auth.js is missing):
   the Bearer header, else the __session cookie the app's sign-in keeps (SameSite=Lax, so another site cannot
   send it with a request of its own). cb(fb, decoded), as requireAdmin. */
function requireMember(req, res, cb) {
  var token = bearerToken(req) || sessionCookieToken(req);
  if (!token) return sendJson(res, 401, { error: 'Sign in required — please sign in again.' });
  checkCaller(req, res, token, cb);
}

function checkCaller(req, res, token, cb) {
  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });
  /* the sign-in's age and whether it was revoked are checked with the token (lib/access.js verifySession, BE-058) */
  session.verifySession(fb.auth, token).then(function (decoded) {
    return AC.readConfig(fb).then(function (cfg) {
      var access = AC.accessOf(cfg, decoded);
      if (access.denied) return sendJson(res, 403, { error: AC.deniedSentence(access.denied), code: 'no-access' });
      decoded.access = access;
      var path = String(req.url || '').split('?')[0], need = AC.needFor(req.method, path);
      if (!AC.can(access, need)) return sendJson(res, 403, { error: AC.refusedSentence(access, need), code: need === 'admin' ? 'not-admin' : 'view-only', role: access.role });
      var go = function () { if (aiRateOk(req, res, path, decoded)) cb(fb, decoded); };
      if (AC.everywhere(access)) return go();
      if (AC.everywhereOnly(path)) return sendJson(res, 403, { error: AC.everywhereSentence(), code: 'not-your-portal' });
      return portalCheck(fb, req, res, access, go);
    });
  }, function (err) {
    if (session.isReauth(err)) return sendJson(res, 401, { error: 'Your sign-in has expired. Please sign in again.', code: 'reauth' });
    sendJson(res, 401, { error: 'Your sign-in has expired or is invalid — please log in again.' });
  }).catch(function (err) {
    console.error('http: ' + req.method + ' ' + String(req.url || '').split('?')[0] + ' failed — ' + (err && err.stack || err));
    sendJson(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  });
}

/* ---------- a person's paid AI steps (BE-018) ----------
   Each of these routes pays for a model call (or the page-rendering service), and none had a limit of its own: at
   most `max` calls per person in `ms`, counted per route once the caller has been let in (rateLimit below: per
   server instance — the service runs at most two). Generous for real work: a Create Event run makes one brief, one
   reading per reference link, one plan and one generation; the editor's Redesign with AI and the chat's reworked
   and new sections one per section. The routes that already count their own calls (the chat, ETB2B AI on the
   dashboard and in Promotions, SEO texts, the posts' copy, speaker photos, people pages, the AI pictures) keep
   theirs. -> true, or false after answering 429 { code: 'rate-limited' } */
var TEN_MINUTES = 10 * 60 * 1000;
var AI_RATE = {
  'POST /api/suggest-design': { max: 60, ms: TEN_MINUTES },
  'POST /api/redesign-section': { max: 60, ms: TEN_MINUTES },
  'POST /api/extract-brief': { max: 20, ms: TEN_MINUTES },
  'POST /api/ingest-source': { max: 30, ms: TEN_MINUTES },
  'POST /api/plan-structure': { max: 20, ms: TEN_MINUTES },
  'POST /api/generate-content': { max: 20, ms: TEN_MINUTES },
  'POST /api/import-lovable': { max: 20, ms: TEN_MINUTES },
  'POST /api/promo/mailer/ai': { max: 60, ms: TEN_MINUTES }
};
function aiRateOk(req, res, path, decoded) {
  var route = String(req.method || '').toUpperCase() + ' ' + path, rule = AI_RATE[route];
  if (!rule) return true;
  var who = String((decoded && (decoded.uid || decoded.email)) || 'anon');
  if (rateLimit('ai|' + route + '|' + who, rule.max, rule.ms)) return true;
  sendJson(res, 429, { error: 'You have asked ETB2B AI for a lot in the last few minutes. Please wait a few minutes and try again.', code: 'rate-limited', retryable: true },
    { 'Retry-After': '60' });
  return false;
}

/* ---------- the portal check, for someone who works in chosen portals ----------
   The events a request names: ?eventId= (and ?portal=), and in a JSON body eventId, sourceEventId (a copy's
   source), slug (a new event's address) and portal (a new or moved event's portal). To read the body before the
   route does, it is taken in here and left as req.rawBody, which every body reader honours. An event that does
   not exist yet is not refused here (its route says so, or creates it — on a portal that must be theirs). */
var EVENT_FACTS_MS = 10000, eventFacts = new Map();
function factsOf(fb, ids) {
  var now = Date.now(), out = {}, want = [];
  ids.forEach(function (id) {
    var hit = eventFacts.get(id);
    if (hit && hit.db === fb.db && now - hit.at < EVENT_FACTS_MS) out[id] = hit.data; else want.push(id);
  });
  if (!want.length) return Promise.resolve(out);
  var refs = want.map(function (id) { return fb.db.collection('events').doc(id); });
  var read = typeof fb.db.getAll === 'function'
    ? fb.db.getAll.apply(fb.db, refs.concat([{ fieldMask: ['portal', 'createdBy', 'createdAt'] }]))
    : Promise.all(refs.map(function (r) { return r.get(); }));
  return read.then(function (snaps) {
    if (eventFacts.size > 2000) eventFacts.clear();
    snaps.forEach(function (snap, i) {
      var d = snap && snap.exists ? (snap.data() || {}) : null;
      var data = d ? { portal: d.portal || '', createdBy: d.createdBy || '', createdAt: d.createdAt || null } : null;
      out[want[i]] = data;
      eventFacts.set(want[i], { at: now, db: fb.db, data: data });
    });
    return out;
  });
}
function wantsBody(req) {
  var m = String(req.method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || req.rawBody || typeof req.on !== 'function') return false;
  return /json/i.test(String((req.headers && req.headers['content-type']) || ''));
}
function bufferBody(req, res, cb) {
  if (!wantsBody(req)) return cb();
  var chunks = [], size = 0, done = false;
  req.on('data', function (c) {
    if (done) return;
    size += c.length;
    if (size > DEFAULT_MAX_BODY) { done = true; sendJson(res, 413, { error: 'That request is too large.' }); req.resume(); return; }
    chunks.push(c);
  });
  req.on('end', function () { if (!done) { done = true; req.rawBody = Buffer.concat(chunks); cb(); } });
  req.on('error', function () { if (!done) { done = true; sendJson(res, 400, { error: 'The request could not be read.' }); } });
}
function portalCheck(fb, req, res, access, next) {
  bufferBody(req, res, function () {
    var q = new URLSearchParams(String(req.url || '').split('?')[1] || ''), body = {};
    if (req.rawBody && req.rawBody.length) { try { body = parseJsonObject(req.rawBody.toString('utf8')); } catch (e) { body = {}; } }
    var portals = [q.get('portal'), typeof body.portal === 'string' ? body.portal : ''].map(function (p) { return String(p || '').trim(); }).filter(Boolean);
    var badPortal = portals.filter(function (p) { return !AC.portalOk(access, p); })[0];
    if (badPortal) return sendJson(res, 403, { error: AC.outsideSentence(access, badPortal), code: 'not-your-portal' });
    var ids = [q.get('eventId'), body.eventId, body.sourceEventId, body.slug].filter(function (v, i, a) { return isEventId(v) && a.indexOf(v) === i; });
    if (!ids.length) return next();
    factsOf(fb, ids).then(function (facts) {
      var off = ids.filter(function (id) { return !AC.eventOk(access, facts[id]); })[0];
      if (off) return sendJson(res, 403, { error: AC.outsideSentence(access, facts[off].portal), code: 'not-your-portal' });
      next();
    }).catch(function (err) {
      console.error('http: the portal check failed — ' + (err && err.message));
      sendJson(res, 503, { error: 'Your access could not be checked just now. Please try again.' });
    });
  });
}

/* For routes that are public but do more for a signed-in admin (site data and the preview page for an
   unpublished event, a test registration from the preview). Resolves the decoded token (with .access) of someone
   the access list lets in, taken from the Bearer header or the __session cookie, or null — it never rejects and
   never answers the request. opts.eventId: the event in question, which must be one of theirs. */
function adminFromRequest(req, opts) {
  var token = bearerToken(req) || sessionCookieToken(req);
  if (!token) return Promise.resolve(null);
  var fb = getFirebase();
  if (fb.error) return Promise.resolve(null);
  var eventId = opts && opts.eventId;
  return session.verifySession(fb.auth, token).then(function (decoded) {
    return AC.readConfig(fb).then(function (cfg) {
      var access = AC.accessOf(cfg, decoded);
      if (access.denied) return null;
      decoded.access = access;
      if (AC.everywhere(access) || !isEventId(eventId)) return decoded;
      return factsOf(fb, [eventId]).then(function (facts) { return AC.eventOk(access, facts[eventId]) ? decoded : null; });
    });
  }).then(null, function () { return null; });
}

/* Public API routes are called from published pages, which may one day sit on another host. */
var CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};
function sendPublicJson(res, status, obj, extraHeaders) {
  var h = {};
  Object.keys(CORS_HEADERS).forEach(function (k) { h[k] = CORS_HEADERS[k]; });
  if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { h[k] = extraHeaders[k]; });
  sendJson(res, status, obj, h);
}
function sendPublicNoContent(res) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* gone */ } return; }
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

/* The caller's address as the platform reports it (App Hosting / Cloud Run put the real client first in
   X-Forwarded-For), for rate limiting only — never stored. */
function clientIp(req) {
  var xff = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/* A small in-memory sliding window: true while `key` has made no more than `max` calls in the last
   `windowMs`. Per instance (the service runs at most two), which is enough to blunt a script hammering a
   public route; it is not an account-level quota. Keys idle for longer than any window in use (the
   longest is five minutes) are swept every minute, and the map has a ceiling: a caller inventing a new
   address for every request must not be able to grow it until the instance runs out of memory. Emptying
   it only forgets counts — it never refuses anyone. */
var buckets = new Map(), lastSweep = Date.now();
var BUCKET_IDLE_MS = 10 * 60 * 1000, MAX_BUCKETS = 100000;
function rateLimit(key, max, windowMs) {
  var now = Date.now();
  if (now - lastSweep > 60000 || buckets.size > MAX_BUCKETS) {
    lastSweep = now;
    buckets.forEach(function (hits, k) { if (!hits.length || now - hits[hits.length - 1] > BUCKET_IDLE_MS) buckets.delete(k); });
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }
  var hits = (buckets.get(key) || []).filter(function (t) { return now - t < windowMs; });
  if (hits.length >= max) { buckets.set(key, hits); return false; }
  hits.push(now); buckets.set(key, hits);
  return true;
}

/* ---------- how long one request may take (BE-061) ----------
   PLATFORM_REQUEST_LIMIT_MS: the longest a request may run before the platform ends it. Firebase App Hosting sends
   every request through Google Cloud Load Balancing with Cloud CDN to the backend's Cloud Run service. Its
   apphosting.yaml has no request timeout to set (runConfig takes cpu, memoryMiB, maxInstances, minInstances,
   concurrency, cpuAlwaysAllocated and vpcAccess, nothing else), so the service keeps Cloud Run's default: 300 s.
   Neither the App Hosting nor the load-balancing documentation names a shorter limit in front of it.
   Past the limit the platform closes the connection and answers 504; the instance keeps running the handler, so a
   model call still in flight is paid for and its answer lost.
   TAKEN FROM DOCUMENTATION, NOT MEASURED (13 Nov 2026): firebase.google.com/docs/app-hosting/configure and
   /about-app-hosting, docs.cloud.google.com/run/docs/configuring/request-timeout. The deployed figure is
   `gcloud run services describe revamp-cms --region us-east4 --project revamp-cms
    --format='value(spec.template.spec.timeoutSeconds)'` (the owner's sign-in); change it here if that says otherwise.
   Derived from it: lib/llm.js LIMITS.budgetMs (one AI call, three quarters of it) and server.js's
   server.requestTimeout (SERVER_REQUEST_TIMEOUT_MS: Node must never be the one to cut a request off first;
   request-limit.test.js keeps every route's own deadline under the limit). */
var PLATFORM_REQUEST_LIMIT_MS = 300000;
var SERVER_REQUEST_TIMEOUT_MS = PLATFORM_REQUEST_LIMIT_MS + 30000;

/* Event ids are Firestore document ids and path segments in Storage and in /e/<id>. */
function isEventId(v) { return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(v); }

/* Addresses no event may take, because something else already means them:
     gen-… / imported-…   template ids the editor and template-loader dispatch on (an event called
                          "gen-x" would be opened as "the AI-designed site of event x")
     all digits           the editor reads a number in ?event= as "no event"
     the words below      path segments of this host, or words pages treat as "nothing chosen yet"
     import-…             the Lovable import pipeline kept its records in the events collection under these ids
                          until 13 Nov 2026 (they are imports/<id> now: lib/import-store.js, which also reads an
                          old one there while this is true). LEGACY_IMPORT_DOCS goes to false once the owner has run
                          functions/lib/ops-migrate-imports.js --write, which moves them out.
     qa-…                 on a deployed instance (K_SERVICE set) only: the QA harness's events. A qa- address means
                          test data to the sitemap, to the team's Mailer performance view (left out), to a local or
                          QA server's mailer tracking (the only events it tracks, with links to itself) and to the
                          harness's clean-up (which deletes them) — so no real event may be given one. The harness
                          creates its events on a local server (and straight in Firestore), where qa- stays open.
   One rule, used by create, clone and the address check, and mirrored by RevampCore.isReservedSlug() — all but
   the qa- part, which depends on where this server runs. */
var LEGACY_IMPORT_DOCS = true;
var RESERVED_EVENT_IDS = ['new', 'api', 'e', 'preview', 'templates', 'assets', 'index', 'import', 'imports'];
function isReservedEventId(id) {
  if (typeof id !== 'string') return false;
  if (/^(gen|imported)-/.test(id) || /^\d+$/.test(id) || RESERVED_EVENT_IDS.indexOf(id) !== -1) return true;
  if (/^qa-/.test(id) && !!process.env.K_SERVICE) return true;
  return LEGACY_IMPORT_DOCS && id.indexOf('import-') === 0;
}

/* The status a speaker or a partner can have in the console. Only "confirmed" ones (and records from
   before the field existed, which have none) are shown on the site: the one rule is
   templates/_shared/rv-records.js isOnSite, which everything that draws a site asks (the server's
   drawing in lib/site-records.js, the site editor, lib/api-audience.js, search, the people pages). */
var CONTENT_STATUSES = ['confirmed', 'invited', 'tentative'];

/* An e-mail address as people write them. One definition for the registration form, the content records
   and the leads. */
var EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;.]{2,}$/;
function isEmail(v) { return typeof v === 'string' && v.length <= 200 && EMAIL_RE.test(v); }

function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 300); }

module.exports = {
  sendJson, readBody, parseJsonObject, parseJsonBody, bearerToken, sessionCookieToken, requireAdmin, requireMember,
  adminFromRequest, CORS_HEADERS, sendPublicJson, sendPublicNoContent, clientIp, rateLimit, isEventId,
  isReservedEventId, CONTENT_STATUSES, EMAIL_RE, isEmail, str, AI_RATE, LEGACY_IMPORT_DOCS
};
/* the request time limit (above): lib/llm.js, server.js, tools/serve.js */
module.exports.PLATFORM_REQUEST_LIMIT_MS = PLATFORM_REQUEST_LIMIT_MS;
module.exports.SERVER_REQUEST_TIMEOUT_MS = SERVER_REQUEST_TIMEOUT_MS;
