// Request/response plumbing shared by every backend module (lib/api.js, lib/api-audience.js): JSON
// in/out, body size limits, who is calling, and the two small protections every public route needs.
//
// Nothing in here may throw into the caller's request stream callbacks. An exception nobody catches ends
// a plain Node http server's process, and with it every other request in flight on that instance — so
// each helper answers the request itself (4xx/5xx) or returns a value, never throws.
const { getFirebase } = require('./firebase');
const { isAllowedUser, deniedMessage } = require('./access');

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

/* Every admin API route: a verified Firebase ID token for an allowed (company-domain, Google) account in
   the Authorization header. cb(fb, decoded). */
function requireAdmin(req, res, cb) {
  var token = bearerToken(req);
  if (!token) return sendJson(res, 401, { error: 'Sign in required — missing Authorization: Bearer <token> header.' });
  var fb = getFirebase();
  if (fb.error) return sendJson(res, 503, { error: fb.error });
  fb.auth.verifyIdToken(token).then(function (decoded) {
    if (!isAllowedUser(decoded)) return sendJson(res, 403, { error: deniedMessage() });
    cb(fb, decoded);
  }, function () {
    sendJson(res, 401, { error: 'Your sign-in has expired or is invalid — please log in again.' });
  });
}

/* For routes that are public but do more for a signed-in admin (site data and the preview page for an
   unpublished event, a test registration from the preview). Resolves the decoded token of an allowed
   admin taken from the Bearer header or the __session cookie, or null — it never rejects and never
   answers the request. */
function adminFromRequest(req) {
  var token = bearerToken(req) || sessionCookieToken(req);
  if (!token) return Promise.resolve(null);
  var fb = getFirebase();
  if (fb.error) return Promise.resolve(null);
  return fb.auth.verifyIdToken(token).then(function (decoded) {
    return isAllowedUser(decoded) ? decoded : null;
  }, function () { return null; });
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

/* Event ids are Firestore document ids and path segments in Storage and in /e/<id>. */
function isEventId(v) { return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(v); }

/* Addresses no event may take, because something else already means them:
     gen-… / imported-…   template ids the editor and template-loader dispatch on (an event called
                          "gen-x" would be opened as "the AI-designed site of event x")
     all digits           the editor reads a number in ?event= as "no event"
     the words below      path segments of this host, or words pages treat as "nothing chosen yet"
     import-…             the Lovable import pipeline keeps its staging records in the events collection
                          under these ids. LEGACY_IMPORT_DOCS goes to false once they have been moved out.
   One rule, used by create, clone and the address check, and mirrored by RevampCore.isReservedSlug(). */
var LEGACY_IMPORT_DOCS = true;
var RESERVED_EVENT_IDS = ['new', 'api', 'e', 'preview', 'templates', 'assets', 'index', 'import', 'imports'];
function isReservedEventId(id) {
  if (typeof id !== 'string') return false;
  if (/^(gen|imported)-/.test(id) || /^\d+$/.test(id) || RESERVED_EVENT_IDS.indexOf(id) !== -1) return true;
  return LEGACY_IMPORT_DOCS && id.indexOf('import-') === 0;
}

/* The status a speaker or a partner can have in the console. Only "confirmed" ones (and records from
   before the field existed, which have none) are shown on the site — see lib/api-audience.js. */
var CONTENT_STATUSES = ['confirmed', 'invited', 'tentative'];

/* An e-mail address as people write them. One definition for the registration form, the content records
   and the leads. */
var EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;.]{2,}$/;
function isEmail(v) { return typeof v === 'string' && v.length <= 200 && EMAIL_RE.test(v); }

function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 300); }

module.exports = {
  sendJson, readBody, parseJsonObject, parseJsonBody, bearerToken, sessionCookieToken, requireAdmin,
  adminFromRequest, CORS_HEADERS, sendPublicJson, sendPublicNoContent, clientIp, rateLimit, isEventId,
  isReservedEventId, CONTENT_STATUSES, isEmail, str
};
