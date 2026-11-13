// Who may use ETB2B EventSphere, and what this server hands out at all.
//
// WHO: a Google sign-in the access list lets in (lib/access-control.js, Settings › Access): every company account
// (@timesinternet.in, or ALLOWED_EMAIL_DOMAIN) at the default role, and anyone an admin invited with another Google
// account — never someone an admin blocked. One rule, used in three places so it can't drift:
//   - requireAdmin() in http.js — every admin API call (Authorization: Bearer <ID token>)
//   - gate() in server.js (App Hosting) and tools/serve.js (local dev) — the CMS pages and every other /api/*
//     route, using the __session cookie auth.js keeps in step with the signed-in user's ID token
// and each of them checks the sign-in itself with verifySession() below: a sign-in older than SESSION_MAX_AGE_DAYS,
// or one Firebase Auth revoked, disabled or deleted, signs in again.
// Public (no sign-in): the sign-in page itself (/, /index.html, /auth.js), the app's own scripts, styles,
// images and fonts (code, not data), and what a published event site needs from a visitor's browser:
//   /e/<eventId>        the published site
//   /api/public/*       the data a published site shows (speakers, agenda, …)
//   /api/register       a visitor's registration
//   /api/track          one count per page view
//   /img/<path>         a picture of the storage bucket that is already public there (lib/picture-cdn.js: the
//                       same pictures, from our own address so the hosting's CDN keeps them)
// and what a mailer sent from Promotions needs from a recipient's mail (lib/promo-track.js):
//   /t/o/<id>.gif       a mailer's open pixel
//   /t/c/<id>           a mailer's signed click redirect
// /preview/<eventId> is NOT public: it shows a site that has not been released.
// /s/<token> is: a shareable preview link a team member made for someone without an ET account. The 256-bit
// token is the permission; it stops after 7 days or when stopped (lib/share-preview.js).
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
const PUBLIC_PATHS = new Set(['/', '/index.html', '/auth.js', '/favicon.ico', '/robots.txt', '/sitemap.xml', '/sitemap-people.xml']);

/* a Google sign-in (not email/password) with a verified address on the company domain — the rule before the
   access list, kept for when that list cannot be read at all (no database: a local server without credentials) */
function isAllowedUser(decoded) {
  if (!decoded || typeof decoded.email !== 'string' || decoded.email_verified !== true) return false;
  if (!decoded.firebase || decoded.firebase.sign_in_provider !== 'google.com') return false;
  return decoded.email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN);
}

function deniedMessage(why) {
  return require('./access-control').deniedSentence(why || 'outside');
}

/* -> Promise<access> for a verified token: { email, role, portals } or { denied: 'blocked' | 'outside' | 'signin' } */
function accessFor(decoded) {
  var AC = require('./access-control'), fb;
  try { fb = require('./firebase').getFirebase(); } catch (e) { fb = { error: String(e && e.message) }; }
  if (!fb || fb.error || !fb.db) {
    return Promise.resolve(isAllowedUser(decoded) ? { email: decoded.email.toLowerCase(), role: 'editor', portals: ['*'] } : { denied: AC.accessOf({ members: {} }, decoded).denied });
  }
  return AC.readConfig(fb).then(function (cfg) { return AC.accessOf(cfg, decoded); });
}

/* its own named app, so checking a token needs no service account and doesn't depend on getFirebase()'s
   FIREBASE_STORAGE_BUCKET — verifying an ID token only needs the project ID and Google's public keys */
let verifier = null;
function verifierAuth() {
  if (!verifier) {
    verifier = admin.apps.find(function (a) { return a && a.name === 'revamp-access'; }) ||
      admin.initializeApp({ projectId: PROJECT_ID }, 'revamp-access');
  }
  return verifier.auth();
}
/* the gate's Auth: the app's own (getFirebase(), with the server's credentials, which asking Firebase Auth about an
   account needs) when there is one, else the verifier above */
function sessionAuth() {
  try {
    const fb = require('./firebase').getFirebase();
    if (fb && !fb.error && fb.auth && typeof fb.auth.verifyIdToken === 'function') return fb.auth;
  } catch (e) { /* no database here: the verifier still checks the token */ }
  return verifierAuth();
}

/* ---------- how long a sign-in lasts (BE-058) ----------
   verifyIdToken() alone takes any ID token that has not expired, and the browser's Firebase refresh token keeps
   minting new ones for as long as it is kept — also after the person's Google account was suspended, because
   Firebase never asks Google again. So every check of a sign-in (the gate below; requireAdmin, requireMember and
   adminFromRequest in http.js) also asks:
     - how long ago the person really signed in with Google (the token's auth_time, which a refresh does not move):
       after SESSION_MAX_AGE_DAYS they sign in again, and a suspended Google account cannot;
     - whether Firebase Auth has disabled or deleted the account or revoked its sessions (verifyIdToken's
       checkRevoked). That asks Firebase Auth over the network, so the answer is kept for REVOCATION_CHECK_MS per
       sign-in (uid + auth_time): a revoked session stops working within that time. When Firebase Auth cannot be
       asked (a network fault, a missing permission) the token's own signature, expiry and age still decide, and the
       fault is logged — a fault of that service must not sign the whole team out.
   Every ID token Firebase issues carries auth_time; a token with none is not refused for its age.
   -> Promise<decoded>, or rejects: err.code 'revamp/reauth' (err.why 'too-old' | 'revoked' | 'disabled' | 'deleted')
   when the person must sign in again, else verifyIdToken's own error (expired, malformed, not this project's). */
const SESSION_MAX_AGE_DAYS = (function () { const n = Number(process.env.SESSION_MAX_AGE_DAYS); return n > 0 ? n : 14; })();
const REVOCATION_CHECK_MS = 5 * 60 * 1000;
const REVOCATION_CACHE_MAX = 5000;
const revocationChecked = new Map();
let revocationWarnedAt = 0;
function reauthError(why) {
  const err = new Error('Your sign-in has expired. Please sign in again.');
  err.code = 'revamp/reauth';
  err.why = why;
  return err;
}
function isReauth(err) { return !!err && err.code === 'revamp/reauth'; }
function verifySession(auth, token, now) {
  return auth.verifyIdToken(token).then(function (decoded) {
    const at = now || Date.now();
    const authTime = Number(decoded && decoded.auth_time);
    if (authTime > 0 && at - authTime * 1000 > SESSION_MAX_AGE_DAYS * 86400000) throw reauthError('too-old');
    const key = String((decoded && (decoded.uid || decoded.sub)) || '') + '|' + (authTime > 0 ? authTime : '');
    const checkedAt = revocationChecked.get(key);
    if (checkedAt && at - checkedAt < REVOCATION_CHECK_MS) return decoded;
    return Promise.resolve(auth.verifyIdToken(token, true)).then(function () {
      if (revocationChecked.size >= REVOCATION_CACHE_MAX) revocationChecked.clear();
      revocationChecked.set(key, at);
      return decoded;
    }, function (err) {
      const code = String((err && (err.code || (err.errorInfo && err.errorInfo.code))) || '');
      if (code === 'auth/id-token-revoked') throw reauthError('revoked');
      if (code === 'auth/user-disabled') throw reauthError('disabled');
      if (code === 'auth/user-not-found') throw reauthError('deleted');
      if (at - revocationWarnedAt > 10 * 60 * 1000) {
        revocationWarnedAt = at;
        console.error('access: whether a sign-in was revoked could not be checked (' + (code || (err && err.message) || 'unknown') +
          ') — its signature, expiry and age were; the check is tried again on the next request');
      }
      return decoded;
    });
  });
}
/* for the tests: forget what was checked */
function forgetSessions() { revocationChecked.clear(); revocationWarnedAt = 0; }

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
   Names are compared in lower case: on a case-insensitive filesystem /SERVER.JS is server.js.
   payment/ is not served: it is a prototype of online payment (out of scope for now) that showed another
   event's made-up figures; the rail's Payment item says "not available yet" inside the console instead. */
const SERVED_DIRS = new Set(['assets', 'templates', 'import-figma-design', 'template-previews', 'promo-studio']);
const SERVED_TYPES = new Set(['.html', '.js', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.pdf', '.txt']);
const TOP_LEVEL_TYPES = new Set(['.html', '.js', '.css', '.ico', '.png', '.svg', '.txt']);
const NEVER_SERVED = new Set(['server.js', 'package.json', 'package-lock.json']);
/* top-level pages that are developer tools, not part of the product: preview-draft.html opened the editor on a
   throwaway copy of an AI draft and answered in developer messages ("Missing ?eventId=<id> in the URL."); nothing
   links to it, and the console and the dashboard open an event's site in the editor themselves (UX-115) */
const DEV_ONLY_PAGES = new Set(['preview-draft.html']);

/* rel: the decoded request path relative to the repository root, "/"-separated ("templates/x/y.css") */
function isServableFile(rel) {
  const parts = String(rel).toLowerCase().split('/').filter(Boolean);
  if (!parts.length) return false;
  if (parts.some(function (p) { return p.charAt(0) === '.' || p === 'node_modules'; })) return false;
  const name = parts[parts.length - 1];
  if (NEVER_SERVED.has(name) || /\.(backup|bak|orig|old|tmp)(\.|$)|~$/.test(name)) return false;
  const ext = path.extname(name);
  if (parts.length === 1) return TOP_LEVEL_TYPES.has(ext) && !DEV_ONLY_PAGES.has(name);
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
  /* a speaker's or a sponsor's page across ET (lib/people.js): public, as the event sites that link to it */
  if (p.indexOf('/speakers/') === 0 || p.indexOf('/sponsors/') === 0) return true;
  if (/^\/t\/[oc]\/[^/]+$/.test(p)) return true;                  // a mailer's open pixel and click links
  /* a picture of the bucket: the route itself answers only what storage.googleapis.com already gives anybody */
  if (p.indexOf('/img/') === 0) return true;
  /* a shared preview link: the unguessable link is the permission (lib/share-preview.js) */
  if (p.indexOf('/s/') === 0) return true;
  if (p.indexOf('/api/') === 0 || p.indexOf('/preview/') === 0) return false;
  if (PUBLIC_PATHS.has(p)) return true;
  /* app code: any file this server would actually send, other than a page. Something it would not send
     is not public either — a signed-out request for it is sent to sign-in, not told whether it exists. */
  return path.extname(p).toLowerCase() !== '.html' && isServableFile(p.slice(1));
}

/* why: 'signin' (no or expired sign-in) | 'reauth' (a sign-in too old, or revoked: verifySession) | 'outside' (signed
   in, but not let in) | 'blocked' (an admin blocked it) */
function deny(req, res, urlPath, why) {
  if (urlPath.indexOf('/api/') === 0) {
    const signIn = why === 'signin' || why === 'reauth';
    res.writeHead(signIn ? 401 : 403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(why === 'signin' ? { error: 'Sign in required — please sign in again.' }
      : why === 'reauth' ? { error: 'Your sign-in has expired. Please sign in again.', code: 'reauth' }
      : { error: deniedMessage(why), code: 'no-access' }));
  }
  /* A file that is not a page (a picture, a video, a .json or .xml — "/x/clip.mp4", "/sitemap.xml") is never
     sent to anyone unless isPublic() already let it through, so signing in would not help: it is a plain
     404, the same answer a signed-in user gets. Sending the browser to the sign-in page instead made every
     such reference on a published page download that page as its "picture" or "video". */
  const ext = path.extname(urlPath).toLowerCase();
  if (ext && ext !== '.html' && urlPath.indexOf('/preview/') !== 0) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end('Not found');
  }
  /* ?reauth=1: the sign-in page signs the browser out first, so the person really signs in with Google again — the
     browser's own Firebase sign-in would otherwise send them straight back here with the same old session */
  const back = '/?' + (why === 'blocked' ? 'denied=blocked&' : why === 'reauth' ? 'reauth=1&' : why === 'signin' ? '' : 'denied=1&') +
    'next=' + encodeURIComponent(req.url);
  res.writeHead(302, { Location: back, 'Cache-Control': 'no-store' });
  res.end();
}

/* WHO MAY TAKE THINGS AWAY. Deleting an event and taking a live site offline are for approvers only (the
   owner's rule, 2026-11-03); team members draft, edit and ask for approval. An approver is someone with the
   Approver or Admin role in Settings › Access (lib/api.js approvalsConfig gives the list, which always holds an
   Admin). An empty list — which the access list never gives — would still mean everyone, as it always did.
   -> '' when `email` may, else the sentence that says who can. `what` finishes "Only an approver (…) can …". */
function notAnApprover(approvers, email, what) {
  const list = (Array.isArray(approvers) ? approvers : []).map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean);
  if (!list.length) return '';
  if (list.indexOf(String(email || '').trim().toLowerCase()) !== -1) return '';
  return 'Only an approver (' + list.join(', ') + ') can ' + (what || 'do that') + '.';
}

/* lets the request through to next() only for public paths or a signed-in user the access list lets in
   (req.user, with req.user.access) */
function gate(req, res, next) {
  const urlPath = req.url.split('?')[0];
  if (isPublic(req, urlPath)) return next();
  const token = readToken(req);
  if (!token) return deny(req, res, urlPath, 'signin');
  verifySession(sessionAuth(), token).then(function (decoded) {
    return accessFor(decoded).then(function (access) {
      if (access.denied) return deny(req, res, urlPath, access.denied);
      decoded.access = access;
      req.user = decoded;
      next();
    });
  }, function (err) { deny(req, res, urlPath, isReauth(err) ? 'reauth' : 'signin'); }).catch(function (err) {
    console.error('access: the sign-in check failed for ' + urlPath + ' — ' + (err && err.stack || err));
    if (!res.headersSent) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Please try again in a moment.'); }
  });
}

module.exports = { ALLOWED_DOMAIN, isAllowedUser, deniedMessage, accessFor, gate, isServableFile, isPublic, notAnApprover,
  verifySession, isReauth, SESSION_MAX_AGE_DAYS, REVOCATION_CHECK_MS, forgetSessions };
