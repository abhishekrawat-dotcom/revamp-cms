// The token of a shareable preview link (/s/<token>, lib/share-preview.js), and the one way its address is
// written into a log line.
//
// A shared link is a bearer link: whoever holds the address sees the unreleased site, with no sign-in. So the
// token is the whole permission and is made to be impossible to guess: 32 random bytes (256 bits) written as
// 43 base64url characters. Only its SHA-256 is ever stored (as the link's document id), so someone who can
// read the database cannot work back to a working link, and there is no server secret to keep or rotate.
//
// Pure: it needs only Node's crypto, so server.js can require it at start-up without touching Firebase.
const crypto = require('crypto');

var TOKEN_BYTES = 32;
/* exactly what newToken() writes: base64url of 32 bytes, no padding */
var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/* /s/<token>, /s/<token>/ and /s/<token>/<slug> (an internal page of a multi-page site: the same slugs as
   templates/_shared/rv-pages.js SLUG_RE). A slug is at most 40 characters from [a-z0-9-], a token is 43 and may
   carry capitals and "_", so neither can be read as the other. */
var SHARE_PATH_RE = /^\/s\/([A-Za-z0-9_-]{43})(?:\/([a-z0-9-]{1,40}))?\/?$/;

function newToken() { return crypto.randomBytes(TOKEN_BYTES).toString('base64url'); }

/* 64 hex characters. A plain hash is enough because the token itself carries 256 bits of chance: there is
   nothing a slow or keyed hash would add against guessing. */
function hashToken(token) { return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex'); }

/* the last four characters, for people to tell their links apart ("…k3Qz"); 24 of 256 bits give nothing away */
function last4(token) { return String(token || '').slice(-4); }

/* urlPath (no query) -> { token, slug } | null */
function parseSharePath(urlPath) {
  var m = SHARE_PATH_RE.exec(String(urlPath || ''));
  return m ? { token: m[1], slug: m[2] || '' } : null;
}

/* A request address safe to write into a log: the segment after /s/ becomes "…" and its last four characters
   (or "…" alone when it is too short to be a token), so a log reader never holds a working link. Every other
   address comes back as it was. Logs are read by more people, for longer, than the 7 days a link works. */
function redactUrl(url) {
  var s = String(url == null ? '' : url);
  /* "//s//<token>" is no route, but a request can still be written that way and logged */
  var m = /^(\/+s\/+)([^\/?#]*)/.exec(s);
  if (!m) return s;
  var seg = m[2];
  return m[1] + (seg.length >= 8 ? '…' + seg.slice(-4) : '…') + s.slice(m[0].length);
}

/* The headers every /s/ answer carries, the error pages included (lib/share-preview.js sendPage, and lib/api.js
   when that module cannot be loaded):
     no-store                   no CDN, shared cache or browser keeps an unreleased site, or a stopped link's page
     X-Robots-Tag               search engines neither index nor follow nor keep a copy
     Referrer-Policy            requests the page makes carry our origin only, never the /s/<token> address
                                (strict-origin-when-cross-origin would send the full address to our own host)
     frame-ancestors / DENY     nobody can show a shared site inside their own page
   A fresh object each time: callers add Content-Type, Content-Length and so on to it. */
function shareHeaders() {
  return {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'strict-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Accept-Encoding'
  };
}

module.exports = { TOKEN_RE, SHARE_PATH_RE, newToken, hashToken, last4, parseSharePath, redactUrl, shareHeaders };
