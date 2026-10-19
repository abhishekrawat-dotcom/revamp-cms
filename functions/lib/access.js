// Who may use the Revamp CMS, and what this server hands out at all.
//
// WHO: Google accounts on the company domain only (@timesinternet.in, or ALLOWED_EMAIL_DOMAIN). One rule,
// used in three places so it can't drift:
//   - requireAdmin() in http.js — every admin API call (Authorization: Bearer <ID token>)
//   - gate() in server.js (App Hosting) and tools/serve.js (local dev) — the CMS pages and every other /api/*
//     route, using the __session cookie auth.js keeps in step with the signed-in user's ID token
// Public (no sign-in): the sign-in page itself (/, /index.html, /auth.js), the app's own scripts, styles,
// images and fonts (code, not data), and what a published event site needs from a visitor's browser:
//   /e/<eventId>        the published site
//   /api/public/*       the data a published site shows (speakers, agenda, …)
//   /api/register       a visitor's registration
//   /api/track          one count per page view
// /preview/<eventId> is NOT public: it shows a site that has not been released.
//
// WHAT: isServableFile() is the one rule for which files of this repository a web server may send, used by
// server.js and tools/serve.js. It is an allow-list, because the repository is also the deployment: a
// directory or file added tomorrow is private until someone lists it here.
const path = require('path');
const admin = require('firebase-admin');

const ALLOWED_DOMAIN = String(process.env.ALLOWED_EMAIL_DOMAIN || 'timesinternet.in').toLowerCase();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'revamp-cms';
const SESSION_COOKIE = '__session';   // the one cookie name every Firebase hosting product passes through
// /robots.txt and /sitemap.xml: for search engines, about the published sites only (lib/site-seo.js)
const PUBLIC_PATHS = new Set(['/', '/index.html', '/auth.js', '/favicon.ico', '/robots.txt', '/sitemap.xml']);

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

/* ---------- which files are served at all ----------
   server.js used to refuse a list of known-private names and serve everything else, so each new thing in
   the repository was public until somebody remembered to add it: the scraper service's source and deploy
   notes, a backup of demo data and the template authors' notes were all downloadable while signed out.
   The rule is now the other way round.
     - Top level: only pages and their own scripts and styles (by extension), never the server itself.
     - Below the top level: only inside the directories the browser loads from, and only web file types.
     - Nowhere: dotfiles, node_modules, package manifests, backup copies, documents (.md, .docx, no
       extension at all — a Dockerfile, a LICENSE).
   Names are compared in lower case: on a case-insensitive filesystem /SERVER.JS is server.js. */
const SERVED_DIRS = new Set(['assets', 'templates', 'payment', 'import-figma-design', 'template-previews']);
const SERVED_TYPES = new Set(['.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.pdf', '.txt']);
const TOP_LEVEL_TYPES = new Set(['.html', '.js', '.css', '.ico', '.png', '.svg', '.txt']);
const NEVER_SERVED = new Set(['server.js', 'package.json', 'package-lock.json']);

/* rel: the decoded request path relative to the repository root, "/"-separated ("templates/x/y.css") */
function isServableFile(rel) {
  const parts = String(rel).toLowerCase().split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.some(function (p) { return p.charAt(0) === '.' || p === 'node_modules'; })) return false;
  const name = parts[parts.length - 1];
  if (NEVER_SERVED.has(name) || /\.(backup|bak|orig|old|tmp)(\.|$)|~$/.test(name)) return false;
  const ext = path.extname(name);
  if (parts.length === 1) return TOP_LEVEL_TYPES.has(ext);
  return SERVED_DIRS.has(parts[0]) && SERVED_TYPES.has(ext);
}

/* The request path as the file system and the router will see it, or null when it cannot be trusted to
   mean one thing: it does not decode, it carries a NUL, or it is not already in its simplest form
   ("/a/../b", "//x"). The gate used to judge the RAW path while server.js opened the DECODED one, so
   "/Event_Listing.htm%6c" was waved through as a public asset and then served as the page. */
function canonicalPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (e) { return null; }
  if (decoded.indexOf('\0') !== -1 || decoded.indexOf('\\') !== -1) return null;
  return path.posix.normalize(decoded) === decoded ? decoded : null;
}

function isPublicApi(p) {
  return p === '/api/register' || p === '/api/track' || p.indexOf('/api/public/') === 0;
}

function isPublic(req, urlPath) {
  const p = canonicalPath(urlPath);
  if (p === null) return false;
  if (p.indexOf('/e/') === 0 || isPublicApi(p)) return true;      // OPTIONS (a browser's preflight) included
  if (p.indexOf('/api/') === 0 || p.indexOf('/preview/') === 0) return false;
  if (PUBLIC_PATHS.has(p)) return true;
  /* app code: any file this server would actually send, other than a page. Something it would not send
     is not public either — a signed-out request for it is sent to sign-in, not told whether it exists. */
  return path.extname(p).toLowerCase() !== '.html' && isServableFile(p.slice(1));
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

module.exports = { ALLOWED_DOMAIN, isAllowedUser, deniedMessage, gate, isServableFile, isPublic };
