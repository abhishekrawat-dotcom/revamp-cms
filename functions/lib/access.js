// Who may use the Revamp CMS: Google accounts on the company domain only (@timesinternet.in, or
// ALLOWED_EMAIL_DOMAIN). One rule, used in three places so it can't drift:
//   - requireAdmin() in api.js — every admin API call (Authorization: Bearer <ID token>)
//   - gate() in server.js (App Hosting) and tools/serve.js (local dev) — the CMS pages and every other /api/*
//     route, using the __session cookie auth.js keeps in step with the signed-in user's ID token
// Public (no sign-in): the sign-in page itself (/, /index.html, /auth.js), scripts/styles/images/fonts (app code,
// not data), and POST /api/register, which published microsites post sign-ups to.
const path = require('path');
const admin = require('firebase-admin');

const ALLOWED_DOMAIN = String(process.env.ALLOWED_EMAIL_DOMAIN || 'timesinternet.in').toLowerCase();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'revamp-cms';
const SESSION_COOKIE = '__session';   // the one cookie name every Firebase hosting product passes through
const PUBLIC_PATHS = new Set(['/', '/index.html', '/auth.js', '/favicon.ico']);

/* a Google sign-in (not email/password) with a verified address on the company domain */
function isAllowedUser(decoded) {
  if (!decoded || typeof decoded.email !== 'string' || decoded.email_verified !== true) return false;
  if (!decoded.firebase || decoded.firebase.sign_in_provider !== 'google.com') return false;
  return decoded.email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN);
}

function deniedMessage() {
  return 'Only @' + ALLOWED_DOMAIN + ' Google accounts can use Revamp.';
}

/* its own named app, so checking a token needs no service account and doesn't depend on getFirebase()'s
   FIREBASE_STORAGE_BUCKET — verifying an ID token only needs the project ID and Google's public keys */
let verifier = null;
function verifyIdToken(token) {
  if (!verifier) {
    verifier = admin.apps.find(function (a) { return a && a.name === 'revamp-access'; }) ||
      admin.initializeApp({ projectId: PROJECT_ID }, 'revamp-access');
  }
  return verifier.auth().verifyIdToken(token);
}

function readToken(req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
  if (m) return m[1];
  const c = new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=([^;]+)').exec(req.headers.cookie || '');
  if (!c) return '';
  // decodeURIComponent throws URIError on a malformed escape ("__session=%E0%A4%A", or just "%"). This runs
  // synchronously inside the request listener for every gated page and API route, so that one throw used to
  // be an uncaught exception: any signed-out visitor could end the server process with a single request.
  // A cookie that cannot be decoded is simply not a session.
  try { return decodeURIComponent(c[1]); } catch (e) { return ''; }
}

function isPublic(req, urlPath) {
  if (req.method === 'OPTIONS') return true;
  if (urlPath === '/api/register') return true;
  if (PUBLIC_PATHS.has(urlPath)) return true;
  if (urlPath.indexOf('/api/') === 0) return false;
  const ext = path.extname(urlPath).toLowerCase();
  return ext !== '' && ext !== '.html';
}

/* why: 'signin' (no or expired sign-in) | 'domain' (signed in, but not an allowed account) */
function deny(req, res, urlPath, why) {
  if (urlPath.indexOf('/api/') === 0) {
    res.writeHead(why === 'domain' ? 403 : 401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: why === 'domain' ? deniedMessage() : 'Sign in required — please sign in again.' }));
  }
  const back = '/?' + (why === 'domain' ? 'denied=1&' : '') + 'next=' + encodeURIComponent(req.url);
  res.writeHead(302, { Location: back, 'Cache-Control': 'no-store' });
  res.end();
}

/* lets the request through to next() only for public paths or an allowed, signed-in user (req.user) */
function gate(req, res, next) {
  const urlPath = req.url.split('?')[0];
  if (isPublic(req, urlPath)) return next();
  const token = readToken(req);
  if (!token) return deny(req, res, urlPath, 'signin');
  verifyIdToken(token).then(function (decoded) {
    if (!isAllowedUser(decoded)) return deny(req, res, urlPath, 'domain');
    req.user = decoded;
    next();
  }, function () { deny(req, res, urlPath, 'signin'); });
}

module.exports = { ALLOWED_DOMAIN, isAllowedUser, deniedMessage, gate };
