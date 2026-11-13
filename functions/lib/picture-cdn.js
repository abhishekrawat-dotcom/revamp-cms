/* Pictures of the storage bucket from our own address — GET /img/<object path> — so the hosting's CDN keeps them.

   WHY (measured 13 Nov 2026). On a phone in India the slowest part of an event page was its pictures: they were named
   on storage.googleapis.com, which has no edge cache there (first byte about 2 s, against about 0.1 s from a CDN), and
   on Lighthouse's phone run the banner picture arriving at 0.3 s instead of 3 s moved the page's largest paint from
   about 20 s to about 6 s. Firebase App Hosting puts Cloud CDN in front of this server and keeps what it answers by
   the answer's own Cache-Control. So a page a visitor gets names each of our pictures on our own address instead,
   /img/<the object's path> (rewriteHtml, on the way out: lib/delivery.js, the speaker and sponsor pages), and this
   route answers it from the bucket; the CDN then keeps it at an edge near the visitor. No new domain: it is the
   address the pages themselves come from, on a connection the browser already has open.

   WHAT IS SERVED: exactly what storage.googleapis.com gives anybody today, and only pictures.
     - The object is read from storage.googleapis.com WITHOUT credentials, the way a visitor's browser reads it now.
       An object that is not public there (a saved or published page, a share card's still, a banner video not yet
       checked, a Create Event draft's picture) is refused there (403) and is a 404 here; an object that is public
       there is public here. What this server's own service account may read is never what decides.
     - Only a picture: the object's name must end in a picture's extension (.png .jpg .jpeg .gif .webp .avif .svg
       .ico) and its Content-Type must be image/* (an object stored without one, application/octet-stream, is sent as
       its extension's type). Anything else — a page, a script, a video, a document — is a 404: a page sent from our
       own address would run as this site, with its sign-in.
     - Every answer says nosniff and carries a Content-Security-Policy with sandbox: an SVG opened on its own runs
       nothing and reads nothing of this site. (Shown through <img> or CSS, a picture ignores both.)
     - Its own headers only: Content-Type, Content-Length, Content-Encoding (an SVG stored gzipped, pictures.js
       gzipWorthIt), Content-Range and Accept-Ranges, ETag, Last-Modified, Content-Disposition (a download stays a
       download). Never the object's own metadata (x-goog-meta-*: who uploaded it), never a cookie; the request's
       cookies and Authorization are never sent on, nor its query (?generation= would name an older copy).
     - Streamed as it arrives, never held in memory. GET and HEAD; Range, If-Range, If-None-Match and
       If-Modified-Since are passed on, so a browser or the CDN can ask for a part, or ask "has it changed?" (304).

   HOW LONG IT IS KEPT (cacheControlFor; Cloud CDN needs public and a max-age, and no Set-Cookie):
     - for a year, immutable: a WebP copy (its name holds the original's MD5: pictures.js), a generated picture named
       after its run (events/<id>/generated/<YYYYMMDDhhmmss>-…), and any object whose own Cache-Control already says a
       year (every upload, AI picture, import and copy this product stores with a unique name says so);
     - otherwise what the object's own Cache-Control says (Storage's default for a public object is an hour), never
       more than a day, and the CDN may go on answering with the copy it has for a day more while it asks the bucket
       again in the background (stale-while-revalidate) — for a name that can be written over in place (the old
       fixed-name hero picture, hero-bg.png);
     - an object whose own Cache-Control says private or no-store: not kept anywhere (no-store);
     - a 404 for a minute (a page that names a picture which is gone must not send every visitor to the bucket);
       a failure of the bucket itself: not kept.

   THE SWITCH. Rewriting the pages' addresses is on unless the environment says PICTURE_CDN=off (or 0 / false / no),
   or REWRITE_BY_DEFAULT below is set to false. Nothing stored is ever changed — not a Firestore document, not a saved
   or published page, not an upload's answer: the addresses are rewritten only on the way out, so turning the switch
   off puts every page back on storage.googleapis.com at once. The route itself always answers, whatever the switch
   says: a page the CDN or a browser kept from before still shows its pictures.

   Node 20, CommonJS, no dependencies. */
'use strict';
var https = require('https');
var publicBase = require('./public-base');

var PREFIX = '/img/';
var DEFAULT_BUCKET = 'revamp-cms.firebasestorage.app';
var REWRITE_BY_DEFAULT = true;
var YEAR = 31536000, DAY = 86400, STORAGE_DEFAULT_MAX_AGE = 3600;
var IMMUTABLE = 'public, max-age=' + YEAR + ', immutable';
var NOT_FOUND_CACHE = 'public, max-age=60';
var PICTURE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
var TYPE_OF_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon' };
/* The one exception to "only a picture": an imported site's own font files, as the import stored them
   (lib/import-media.js: events/import-<id>/assets/<16 hex>.woff2 …). A page's CSS may use a font only from the
   page's own address (or with CORS headers the bucket does not send), so the import names them here (/img/…);
   they are sent as font/* only. */
var IMPORT_FONT = /^events\/import-[a-z0-9][a-z0-9-]{0,59}\/assets\/[0-9a-f]{16}\.(woff2|woff|ttf|otf)$/;
var FONT_TYPE_OF_EXT = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
var VARIANT_NAME = /\.rv-[0-9a-f]{8}\.\d{1,5}x\d{1,5}\.w\d{1,5}\.webp$/;
var RUN_STAMPED = /^events\/[^/]+\/generated\/\d{14}-[^/]+$/;
var CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox";
var MAX_PATH = 1024;
var UPSTREAM_TIMEOUT_MS = 20000;
var UA = 'ETB2B-EventSphere-pictures/1';

/* ---------- which bucket, and the switch ---------- */

function bucket() {
  var b = String(process.env.FIREBASE_STORAGE_BUCKET || '').trim();
  return /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(b) ? b : DEFAULT_BUCKET;
}
/* read on every call: a test (or a restart with a new value) sees the value set now */
function rewriting() {
  var v = String(process.env.PICTURE_CDN || '').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false;
  if (v === 'on' || v === '1' || v === 'true' || v === 'yes') return true;
  return REWRITE_BY_DEFAULT;
}
/* what a page rewritten now depends on, for a cache of rewritten pages (lib/delivery.js) */
function signature() { return (rewriting() ? 'on' : 'off') + '|' + bucket() + '|' + publicBase.publicSiteBase(); }

/* ---------- names ---------- */

/* raw: an object path as it is written in an address, each part percent-encoded or not -> the object's name, or ''
   when it cannot be one of our pictures: a part that does not decode, is empty, "." or "..", or holds a slash, a
   backslash or a control character once decoded; not a picture's extension; too long */
function nameOf(raw) {
  raw = String(raw || '');
  if (!raw || raw.length > MAX_PATH) return '';
  var parts = raw.split('/'), out = [];
  for (var i = 0; i < parts.length; i++) {
    var s;
    try { s = decodeURIComponent(parts[i]); } catch (e) { return ''; }
    if (!s || s === '.' || s === '..' || /[\/\\\u0000-\u001f\u007f]/.test(s)) return '';
    out.push(s);
  }
  var name = out.join('/');
  return PICTURE_EXT.test(name) || IMPORT_FONT.test(name) ? name : '';
}
/* "/img/events/x/a.png?v=1" -> "events/x/a.png" ('' when the path is not one this route answers) */
function objectPathOf(urlPath) {
  var p = String(urlPath || '').split(/[?#]/)[0];
  return p.indexOf(PREFIX) === 0 ? nameOf(p.slice(PREFIX.length)) : '';
}
function isRoutePath(urlPath) { return !!objectPathOf(urlPath); }
function storagePath(name) { return '/' + bucket() + '/' + name.split('/').map(encodeURIComponent).join('/'); }

/* ---------- how long an answer is kept ---------- */

function directives(cc) {
  var d = {};
  String(cc || '').toLowerCase().split(',').forEach(function (part) {
    var eq = part.indexOf('='), k = (eq === -1 ? part : part.slice(0, eq)).trim();
    if (k) d[k] = eq === -1 ? true : part.slice(eq + 1).trim().replace(/^"|"$/g, '');
  });
  return d;
}
/* name: the object's name; objectCc: the Cache-Control the bucket answered with (the object's own, or Storage's
   default) -> the Cache-Control this route answers with */
function cacheControlFor(name, objectCc) {
  var d = directives(objectCc);
  if (d['private'] || d['no-store']) return 'no-store';
  if (VARIANT_NAME.test(name) || RUN_STAMPED.test(name)) return IMMUTABLE;
  if (d['no-cache']) return 'public, no-cache';
  var age = parseInt(d['max-age'], 10);
  if (!(age >= 0)) age = STORAGE_DEFAULT_MAX_AGE;
  if (age >= YEAR) return d.immutable ? IMMUTABLE : 'public, max-age=' + YEAR;
  return 'public, max-age=' + Math.min(age, DAY) + ', stale-while-revalidate=' + DAY;
}

/* the type a picture is sent as: the bucket's own when it is an image, its extension's when the object was stored
   without one — '' for anything else (it is not sent) */
function pictureType(name, contentType) {
  var t = String(contentType || '').trim();
  var font = IMPORT_FONT.exec(String(name || ''));
  if (font) return /^font\/[a-z0-9.+-]+(\s*;.*)?$/i.test(t) || !t || /^(application|binary)\/octet-stream\b/i.test(t) ? FONT_TYPE_OF_EXT[font[1]] : '';
  if (/^image\/[a-z0-9.+-]+(\s*;.*)?$/i.test(t)) return t;
  if (!t || /^(application|binary)\/octet-stream\b/i.test(t)) {
    var m = PICTURE_EXT.exec(name);
    return m ? TYPE_OF_EXT[m[1].toLowerCase()] : '';
  }
  return '';
}

/* ---------- the route ---------- */

var upstream = { request: https.request, protocol: 'https:', host: 'storage.googleapis.com', port: 443,
  agent: new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 }) };

var lastLogAt = 0;
function logOnce(text) {
  var now = Date.now();
  if (now - lastLogAt < 60000) return;
  lastLogAt = now;
  console.error('picture-cdn: ' + text);
}

function plain(req, res, status, cacheControl, text, extra) {
  if (res.headersSent) { try { res.end(); } catch (e) { /* socket already gone */ } return; }
  var body = Buffer.from(text + '\n', 'utf8');
  var headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff' };
  Object.keys(extra || {}).forEach(function (k) { headers[k] = extra[k]; });
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
function notFound(req, res) { plain(req, res, 404, NOT_FOUND_CACHE, 'Not found'); }

function acceptsGzip(req) {
  var m = /(?:^|,)\s*gzip\s*(?:;\s*q\s*=\s*([0-9.]+))?\s*(?=,|$)/i.exec(String(req.headers['accept-encoding'] || ''));
  return !!m && !(m[1] != null && +m[1] === 0);
}
/* the request's own conditions and range, passed on only in their plain forms */
function passedOn(req) {
  var h = {}, v;
  v = String(req.headers.range || '');
  if (/^bytes=\d*-\d*(,\s*\d*-\d*){0,4}$/.test(v) && v !== 'bytes=-') h.Range = v;
  ['if-none-match', 'if-modified-since', 'if-range'].forEach(function (k) {
    var x = req.headers[k];
    if (typeof x === 'string' && x && x.length <= 300 && /^[\x20-\x7e]+$/.test(x)) h[k] = x;
  });
  return h;
}

/* GET/HEAD /img/<object path> */
function handle(req, res) {
  var method = req.method;
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'Content-Length': 0 });
    return res.end();
  }
  var name = objectPathOf(String(req.url || '').split('?')[0]);
  if (!name) return notFound(req, res);

  var headers = passedOn(req);
  headers['User-Agent'] = UA;
  headers.Accept = 'image/*,*/*;q=0.8';
  headers['Accept-Encoding'] = acceptsGzip(req) ? 'gzip' : 'identity';
  var finished = false, up;
  function fail(status, why) {
    if (finished) return;
    finished = true;
    logOnce(why + ' — ' + name);
    if (res.headersSent) { try { res.destroy(); } catch (e) { /* already gone */ } return; }
    plain(req, res, status, 'no-store', 'This picture could not be loaded just now. Please try again.');
  }
  try {
    up = upstream.request({ protocol: upstream.protocol, host: upstream.host, port: upstream.port, agent: upstream.agent,
      method: method, path: storagePath(name), headers: headers, timeout: upstream.timeoutMs || UPSTREAM_TIMEOUT_MS }, function (u) {
      onAnswer(req, res, name, u, function (status, why) { fail(status, why); }, function () { finished = true; });
    });
  } catch (err) { return fail(502, 'the bucket could not be asked (' + (err && err.message) + ')'); }
  up.on('timeout', function () { up.destroy(new Error('timed out')); fail(504, 'the bucket took longer than ' + (upstream.timeoutMs || UPSTREAM_TIMEOUT_MS) + ' ms'); });
  up.on('error', function (err) { fail(502, 'the bucket could not be reached (' + (err && err.message) + ')'); });
  /* the visitor went away (or the CDN gave up): the bucket's answer is not read on */
  res.on('close', function () { if (!res.writableFinished) { finished = true; try { up.destroy(); } catch (e) { /* done */ } } });
  up.end();
}

function onAnswer(req, res, name, u, fail, done) {
  var st = u.statusCode, uh = u.headers;
  var cc = cacheControlFor(name, uh['cache-control']);
  function common() {
    var h = { 'Cache-Control': cc, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP };
    if (uh.etag) h.ETag = uh.etag;
    if (uh['last-modified']) h['Last-Modified'] = uh['last-modified'];
    if (String(uh['x-goog-stored-content-encoding'] || '').toLowerCase() === 'gzip' || /accept-encoding/i.test(String(uh.vary || ''))) h.Vary = 'Accept-Encoding';
    return h;
  }
  if (st === 304) {
    u.resume();
    done();
    res.writeHead(304, common());
    return res.end();
  }
  if (st === 200 || st === 206) {
    var type = pictureType(name, uh['content-type']);
    if (!type) { u.resume(); done(); return notFound(req, res); }
    var h = common();
    h['Content-Type'] = type;
    h['Accept-Ranges'] = 'bytes';
    if (uh['content-length'] != null && /^\d+$/.test(String(uh['content-length']))) h['Content-Length'] = uh['content-length'];
    if (uh['content-encoding']) h['Content-Encoding'] = uh['content-encoding'];
    if (st === 206 && uh['content-range']) h['Content-Range'] = uh['content-range'];
    var cd = String(uh['content-disposition'] || '');
    if (/^(inline|attachment)(\s*;[\x20-\x7e]*)?$/i.test(cd)) h['Content-Disposition'] = cd;
    res.writeHead(st, h);
    if (req.method === 'HEAD') { u.resume(); done(); return res.end(); }
    u.on('aborted', function () { fail(502, 'the bucket stopped sending'); });
    u.on('error', function () { fail(502, 'the bucket stopped sending'); });
    u.on('close', function () { if (!u.complete) fail(502, 'the bucket stopped sending'); });
    u.on('end', done);
    return u.pipe(res);
  }
  u.resume();
  /* not public there, or not there: the same answer, which says nothing about which */
  if (st === 400 || st === 403 || st === 404 || st === 410) { done(); return notFound(req, res); }
  if (st === 412 || st === 416) {
    done();
    return plain(req, res, st, 'no-store', st === 416 ? 'That part of the picture does not exist.' : 'The picture has changed.',
      uh['content-range'] ? { 'Content-Range': uh['content-range'] } : null);
  }
  fail(502, 'the bucket answered ' + st);
}

/* ---------- the pages: our pictures named on our own address ---------- */

var reCache = { bucket: '', re: null };
function storageRe() {
  var b = bucket();
  if (reCache.bucket !== b) {
    reCache = { bucket: b, re: new RegExp('(?:https?:)?\\/\\/storage\\.googleapis\\.com\\/' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\/([^\\s"\'<>()\\\\,?#&`]+)', 'g') };
  }
  reCache.re.lastIndex = 0;
  return reCache.re;
}
/* every address of one of our pictures in `text`, on `base` + /img/ (base '' = root-relative). The rest of the
   address (its own encoding, a ?v=…) stays exactly as it was. A video, a page, another bucket's or another host's
   address is left as it is. */
function rewriteText(text, base) {
  return String(text).replace(storageRe(), function (all, rest) {
    return nameOf(rest) ? base + PREFIX + rest : all;
  });
}
/* one address (as rewriteText) — for code that holds a single URL */
function routeUrl(url, base) {
  if (!rewriting()) return url;
  return rewriteText(String(url == null ? '' : url), base == null ? '' : base);
}

/* What a crawler reads out of the page needs the full address: a link preview's picture (<meta property="og:image">,
   twitter:image, any other <meta>) and the structured data (<script type="application/ld+json">). */
var FULL_ADDRESS_PARTS = /<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>|<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;

/* html: a finished page on its way to a visitor -> the same page with each of our pictures named on our own address:
   root-relative (/img/…) in the page itself, so it comes over the connection the page came on; the full address on
   the public base (lib/public-base.js) in its <meta> tags and its structured data — and everywhere in a page that
   sets a <base href> of its own, against which a root-relative address would name another host.
   opts: { base } a full origin to use instead of the public base. Rewriting it again changes nothing. */
function rewriteHtml(html, opts) {
  html = html == null ? '' : String(html);
  if (!rewriting() || html.indexOf('storage.googleapis.com/') === -1) return html;
  var full = publicBase.cleanOrigin((opts && opts.base) || '') || publicBase.publicSiteBase();
  var own = /<base\b[^>]*\shref\s*=/i.test(html) ? full : '';
  html = html.replace(FULL_ADDRESS_PARTS, function (part, scriptAttrs) {
    if (scriptAttrs != null && !/\btype\s*=\s*["']?application\/ld\+json\b/i.test(scriptAttrs)) return part;
    return rewriteText(part, full);
  });
  return rewriteText(html, own);
}

module.exports = {
  PREFIX: PREFIX, handle: handle, rewriteHtml: rewriteHtml, routeUrl: routeUrl, rewriting: rewriting, signature: signature,
  objectPathOf: objectPathOf, isRoutePath: isRoutePath, cacheControlFor: cacheControlFor, pictureType: pictureType, bucket: bucket,
  IMMUTABLE: IMMUTABLE, CSP: CSP
};
/* for picture-cdn.test.js only: ask another server than storage.googleapis.com ({ request, protocol, host, port, agent,
   timeoutMs }) -> a function that puts storage.googleapis.com back */
module.exports._testUpstream = function (cfg) {
  var before = upstream;
  upstream = cfg ? Object.assign({}, upstream, cfg) : upstream;
  return function restore() { upstream = before; };
};
