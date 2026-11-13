/* node functions/lib/picture-cdn.test.js — exits 1 listing every failure.
   Pictures of the bucket from our own address, GET /img/<object path> (lib/picture-cdn.js), for the hosting's CDN:
     1 names: which request paths name a picture of ours, which do not
     2 how long an answer is kept (Cache-Control), the type a picture is sent as
     3 the route, against a stand-in for storage.googleapis.com on this machine: headers, HEAD, Range, 304, gzip,
       streaming, a private object refused, a page refused, what is never passed on, failures — reached the way
       server.js reaches it (the sign-in gate, then handleApi), signed out
     4 the pages: every address of one of our pictures on /img/, the full address in <meta> and the structured data,
       anything else left as it is, the switch, preloads / srcset / image-set still naming the same files
     5 where it is used: delivery (step 7), the speaker and sponsor pages, both servers, the gate, the Developer
       zone's copy for another website
   No network beyond 127.0.0.1, no Firebase. */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var zlib = require('zlib');

delete process.env.PICTURE_CDN;
delete process.env.FIREBASE_STORAGE_BUCKET;
delete process.env.PUBLIC_BASE_URL;

var cdn = require('./picture-cdn');
var pictures = require('./pictures');
var access = require('./access');
var api = require('./api');
var hooks = api._testHooks;
var delivery = require('./delivery');

var ROOT = path.join(__dirname, '..', '..');
var BUCKET = 'revamp-cms.firebasestorage.app';
var STORE = 'https://storage.googleapis.com/' + BUCKET + '/';
var BASE = 'https://revamp-cms--revamp-cms.us-east4.hosted.app';

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 900) : '')); }

/* ======================= 1 names ======================= */
ok(cdn.PREFIX === '/img/', '1.0 the route is /img/');
ok(cdn.objectPathOf('/img/events/e1/generated/20261014094118-overview.png') === 'events/e1/generated/20261014094118-overview.png', '1.1 a picture\'s path');
ok(cdn.objectPathOf('/img/events/e1/speakers/a%20b%2B.jpg?v=3') === 'events/e1/speakers/a b+.jpg', '1.2 parts decoded, the query is not part of the name');
ok(cdn.objectPathOf('/img/events/e1/generated/hero-bg.png.rv-9f223e58.1024x1024.w1024.webp') !== '', '1.3 a WebP copy');
['/img/events/e1/site/page.html', '/img/events/e1/media/film.mp4', '/img/events/e1/x', '/img/', '/img', '/imgx/events/a.png',
  '/img/events/../secret.png', '/img/events/./a.png', '/img/events//a.png', '/img/events/a%2F..%2Fb.png', '/img/events/a%5Cb.png',
  '/img/events/%E0%A4%A.png', '/img/events/a%00.png', '/img/events/a.png%0a', '/e/x/a.png', '/img/' + new Array(1100).join('a') + '.png'
].forEach(function (p) { ok(cdn.objectPathOf(p) === '', '1.4 not one of our pictures: ' + p.slice(0, 60), cdn.objectPathOf(p)); });
ok(cdn.isRoutePath('/img/events/e1/a.svg') && !cdn.isRoutePath('/img/events/e1/a.js'), '1.5 isRoutePath');

/* ======================= 2 caching and types ======================= */
var YEAR_IMM = 'public, max-age=31536000, immutable';
ok(cdn.cacheControlFor('events/e1/generated/hero-bg.png.rv-9f223e58.1024x1024.w1024.webp', 'public, max-age=3600') === YEAR_IMM,
  '2.1 a WebP copy is kept a year, immutable, whatever its object says');
ok(cdn.cacheControlFor('events/e1/generated/20261014094118-overview.png', '') === YEAR_IMM, '2.2 a generated picture named after its run: a year, immutable');
ok(cdn.cacheControlFor('events/e1/speakers/mh1x-abcdefabcdef-a.jpg', 'public, max-age=31536000, immutable') === YEAR_IMM, '2.3 an object that says immutable for a year');
ok(cdn.cacheControlFor('events/import-x/images/a.jpg', 'public, max-age=31536000') === 'public, max-age=31536000', '2.4 a year without immutable stays without it');
ok(cdn.cacheControlFor('events/e1/generated/hero-bg.png', 'public, max-age=3600') === 'public, max-age=3600, stale-while-revalidate=86400',
  '2.5 a name that can be written over: its own hour, then a day of stale-while-revalidate', cdn.cacheControlFor('events/e1/generated/hero-bg.png', 'public, max-age=3600'));
ok(cdn.cacheControlFor('events/e1/x/a.png', '') === 'public, max-age=3600, stale-while-revalidate=86400', '2.6 no Cache-Control of its own: Storage\'s hour');
ok(cdn.cacheControlFor('events/e1/x/a.png', 'public, max-age=604800') === 'public, max-age=86400, stale-while-revalidate=86400', '2.7 never more than a day unless a year');
ok(cdn.cacheControlFor('events/e1/x/a.png', 'private, max-age=31536000') === 'no-store' && cdn.cacheControlFor('events/e1/x/a.png', 'no-store') === 'no-store' &&
  cdn.cacheControlFor('events/e1/generated/hero-bg.png.rv-9f223e58.1x1.w1.webp', 'private') === 'no-store', '2.8 private or no-store: never kept');
ok(cdn.cacheControlFor('events/e1/x/a.png', 'no-cache') === 'public, no-cache', '2.9 no-cache: asked again every time');
ok(cdn.pictureType('a.png', 'image/png') === 'image/png' && cdn.pictureType('a.svg', 'image/svg+xml') === 'image/svg+xml' &&
  cdn.pictureType('a.jpg', 'application/octet-stream') === 'image/jpeg' && cdn.pictureType('a.webp', '') === 'image/webp', '2.10 a picture\'s type');
ok(cdn.pictureType('a.png', 'text/html') === '' && cdn.pictureType('a.png', 'application/javascript') === '' && cdn.pictureType('a.png', 'video/mp4') === '',
  '2.11 anything that is not a picture is not sent');

/* ======================= 3 the route ======================= */
var BIG = Buffer.alloc(300000, 7);
var SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + new Array(400).join('<rect width="1" height="1"/>') + '</svg>');
var SVG_GZ = zlib.gzipSync(SVG);
var seen = [];
var streamGate = null;     // the streaming check: the stand-in waits for the visitor to have the first part
function fakeStorage(req, res) {
  seen.push({ method: req.method, url: req.url, headers: req.headers });
  var prefix = '/' + BUCKET + '/';
  if (req.url.indexOf(prefix) !== 0) { res.writeHead(400); return res.end(); }
  var name = req.url.slice(prefix.length);
  var send = function (status, headers, body) { res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : body); };
  if (name === 'events/e1/generated/20261014094118-overview.png') {
    var etag = '"abc123"';
    if (req.headers['if-none-match'] === etag) return send(304, { ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable' });
    var range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (range) {
      var a = +range[1], b = Math.min(+range[2], BIG.length - 1);
      return send(206, { 'Content-Type': 'image/png', 'Content-Length': b - a + 1, 'Content-Range': 'bytes ' + a + '-' + b + '/' + BIG.length, ETag: etag,
        'Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes' }, BIG.subarray(a, b + 1));
    }
    return send(200, { 'Content-Type': 'image/png', 'Content-Length': BIG.length, ETag: etag, 'Last-Modified': 'Mon, 19 Oct 2026 20:34:09 GMT',
      'Cache-Control': 'public, max-age=31536000, immutable', 'Expires': 'Sat, 13 Nov 2027 12:31:08 GMT', Age: '139', 'Accept-Ranges': 'bytes',
      'x-goog-meta-uploadedby': 'someone@timesinternet.in', 'x-goog-generation': '1792442049081058', 'Set-Cookie': 'a=b', 'Access-Control-Allow-Origin': '*',
      'X-GUploader-UploadID': 'xyz' }, BIG);
  }
  if (name === 'events/e1/generated/hero-bg.png') return send(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600', 'Content-Length': 4 }, Buffer.from('PNG!'));
  if (name === 'events/e1/share-card/still-abc.png' || name === 'events/e1/gone.png') return send(403, { 'Content-Type': 'application/xml' }, '<Error><Code>AccessDenied</Code></Error>');
  if (name === 'events/import-x/images/page.png') return send(200, { 'Content-Type': 'text/html' }, '<script>alert(document.cookie)</script>');
  if (name === 'events/e1/x/raw.jpg') return send(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 3 }, Buffer.from('JPG'));
  if (name === 'events/e1/generated/20261015054729-logo-unit.svg') {
    var gz = /gzip/.test(req.headers['accept-encoding'] || '');
    var h = { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=31536000, immutable', 'x-goog-stored-content-encoding': 'gzip',
      'Content-Disposition': 'attachment', Vary: 'Accept-Encoding' };
    if (gz) { h['Content-Encoding'] = 'gzip'; h['Content-Length'] = SVG_GZ.length; return send(200, h, SVG_GZ); }
    return send(200, h, SVG);
  }
  if (name === 'events/e1/x/boom.png') return send(500, {}, 'oops');
  if (name === 'events/e1/x/slow.png') return;          // never answers
  if (name === 'events/e1/x/stream.webp') {
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.write(Buffer.alloc(64 * 1024, 1));
    streamGate.then(function () { res.end(Buffer.alloc(64 * 1024, 2)); });
    return;
  }
  if (name === 'events/e1/a%20b%2B.png') return send(200, { 'Content-Type': 'image/png', 'Content-Length': 2 }, Buffer.from('ok'));
  send(403, {}, 'AccessDenied');
}

/* our server, as server.js has it: the sign-in gate first (signed out here), then the API's router */
function ourServer(req, res) {
  access.gate(req, res, function () { api.handleApi(req, res); });
}

function listen(handler) {
  return new Promise(function (resolve) {
    var s = http.createServer(handler);
    s.listen(0, '127.0.0.1', function () { resolve(s); });
  });
}
/* onFirst: called when the first part of the body arrives */
function ask(port, method, urlPath, headers, onFirst) {
  return new Promise(function (resolve, reject) {
    var r = http.request({ host: '127.0.0.1', port: port, method: method, path: urlPath, headers: headers || {} }, function (res) {
      var parts = [];
      res.on('data', function (c) { parts.push(c); if (onFirst) { var f = onFirst; onFirst = null; f(); } });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }); });
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end();
  });
}
function lastSeen() { return seen[seen.length - 1] || { headers: {} }; }

function routeChecks(port) {
  var P = '/img/events/e1/generated/20261014094118-overview.png';
  return ask(port, 'GET', P + '?v=9', { Cookie: '__session=secret-token', Authorization: 'Bearer secret', 'Accept-Encoding': 'gzip, br' }).then(function (r) {
    var h = r.headers, up = lastSeen();
    ok(r.status === 200 && r.body.length === BIG.length && r.body.equals(BIG), '3.1 a public picture, signed out, through the gate: 200 with its bytes', { status: r.status, len: r.body.length });
    ok(h['content-type'] === 'image/png' && h['content-length'] === String(BIG.length), '3.2 its type and length', h);
    ok(h['cache-control'] === YEAR_IMM, '3.3 kept a year, immutable', h['cache-control']);
    ok(h.etag === '"abc123"' && h['last-modified'] === 'Mon, 19 Oct 2026 20:34:09 GMT' && h['accept-ranges'] === 'bytes', '3.4 ETag, Last-Modified, Accept-Ranges', h);
    ok(h['x-content-type-options'] === 'nosniff' && /sandbox/.test(h['content-security-policy'] || '') && /default-src 'none'/.test(h['content-security-policy'] || ''),
      '3.5 nosniff and a sandboxing Content-Security-Policy', h);
    ok(!h['set-cookie'] && !h['x-goog-meta-uploadedby'] && !h['x-goog-generation'] && !h.age && !h.expires && !h['access-control-allow-origin'] && !h['x-guploader-uploadid'],
      '3.6 only its own headers: no cookie (the CDN would not keep it), no object metadata, no Age, nothing else of the bucket\'s', h);
    ok(!h.vary, '3.7 no Vary for a picture stored as it is', h.vary);
    ok(up.method === 'GET' && up.url === '/' + BUCKET + '/events/e1/generated/20261014094118-overview.png', '3.8 the bucket is asked for the object, without the query', up.url);
    ok(!up.headers.cookie && !up.headers.authorization, '3.9 the visitor\'s cookie and Authorization are never sent on', up.headers);
    ok(up.headers['accept-encoding'] === 'gzip', '3.10 a browser that takes gzip: the bucket is asked for gzip', up.headers['accept-encoding']);
    return ask(port, 'HEAD', P);
  }).then(function (r) {
    ok(r.status === 200 && r.body.length === 0 && r.headers['content-length'] === String(BIG.length) && r.headers['cache-control'] === YEAR_IMM && lastSeen().method === 'HEAD',
      '3.11 HEAD: the headers, no body, and the bucket is asked with HEAD', { status: r.status, h: r.headers, up: lastSeen().method });
    return ask(port, 'GET', P, { Range: 'bytes=10-19' });
  }).then(function (r) {
    ok(r.status === 206 && r.body.length === 10 && r.headers['content-range'] === 'bytes 10-19/' + BIG.length && lastSeen().headers.range === 'bytes=10-19',
      '3.12 Range: passed on, 206 with its Content-Range', { status: r.status, cr: r.headers['content-range'] });
    return ask(port, 'GET', P, { Range: 'items=0-1;drop table' });
  }).then(function (r) {
    ok(r.status === 200 && !lastSeen().headers.range, '3.13 a range that is not plain bytes is not passed on', lastSeen().headers.range);
    return ask(port, 'GET', P, { 'If-None-Match': '"abc123"' });
  }).then(function (r) {
    ok(r.status === 304 && r.body.length === 0 && r.headers.etag === '"abc123"' && r.headers['cache-control'] === YEAR_IMM,
      '3.14 If-None-Match: 304 with the same Cache-Control (the CDN renews its copy)', { status: r.status, h: r.headers });
    return ask(port, 'GET', '/img/events/e1/generated/hero-bg.png');
  }).then(function (r) {
    ok(r.status === 200 && r.headers['cache-control'] === 'public, max-age=3600, stale-while-revalidate=86400', '3.15 a fixed name: its hour, then stale-while-revalidate', r.headers['cache-control']);
    return ask(port, 'GET', '/img/events/e1/share-card/still-abc.png');
  }).then(function (r) {
    ok(r.status === 404 && r.headers['cache-control'] === 'public, max-age=60' && !/AccessDenied/.test(r.body.toString()),
      '3.16 PRIVATE: not public on storage.googleapis.com (403 there) is a 404 here, saying nothing of the bucket\'s answer', { status: r.status, cc: r.headers['cache-control'], body: r.body.toString() });
    return ask(port, 'GET', '/img/events/import-x/images/page.png');
  }).then(function (r) {
    ok(r.status === 404 && !/script/.test(r.body.toString()), '3.17 an object that is not a picture (text/html) is never sent from our address', { status: r.status, body: r.body.toString() });
    return ask(port, 'GET', '/img/events/e1/site/page.html');
  }).then(function (r) {
    var asked = seen.some(function (s) { return /page\.html/.test(s.url); });
    ok(r.status === 404 && !asked, '3.18 a name that is not a picture\'s: 404 without asking the bucket', { status: r.status, asked: asked });
    return ask(port, 'GET', '/img/events/e1/x/raw.jpg');
  }).then(function (r) {
    ok(r.status === 200 && r.headers['content-type'] === 'image/jpeg' && r.body.toString() === 'JPG', '3.19 stored without a type: sent as its extension\'s', r.headers['content-type']);
    return ask(port, 'GET', '/img/events/e1/generated/20261015054729-logo-unit.svg', { 'Accept-Encoding': 'gzip' });
  }).then(function (r) {
    ok(r.status === 200 && r.headers['content-encoding'] === 'gzip' && r.headers.vary === 'Accept-Encoding' && r.body.equals(SVG_GZ) &&
      r.headers['content-disposition'] === 'attachment' && r.headers['content-type'] === 'image/svg+xml',
      '3.20 an SVG stored gzipped: sent compressed, Vary: Accept-Encoding, its download-only disposition kept', r.headers);
    return ask(port, 'GET', '/img/events/e1/generated/20261015054729-logo-unit.svg', {});
  }).then(function (r) {
    ok(r.status === 200 && !r.headers['content-encoding'] && r.body.equals(SVG) && lastSeen().headers['accept-encoding'] === 'identity',
      '3.21 …and plain to a reader that does not take gzip (the bucket unzips it)', { h: r.headers, up: lastSeen().headers['accept-encoding'] });
    return ask(port, 'POST', '/img/events/e1/generated/hero-bg.png');
  }).then(function (r) {
    ok(r.status === 405 && /GET/.test(r.headers.allow || ''), '3.22 only GET and HEAD', r.status);
    return ask(port, 'GET', '/img/events/e1/x/boom.png');
  }).then(function (r) {
    ok(r.status === 502 && r.headers['cache-control'] === 'no-store', '3.23 the bucket failing: 502, never kept', { status: r.status, cc: r.headers['cache-control'] });
    return ask(port, 'GET', '/img/events/e1/x/slow.png');
  }).then(function (r) {
    ok(r.status === 504 && r.headers['cache-control'] === 'no-store', '3.24 the bucket not answering: 504, never kept', { status: r.status });
    return ask(port, 'GET', '/img/events/e1/a%20b%2B.png');
  }).then(function (r) {
    ok(r.status === 200 && /\/events\/e1\/a%20b%2B\.png$/.test(lastSeen().url), '3.25 a name with a space and a plus is asked for encoded', lastSeen().url);
    /* the stand-in sends the second half only once the visitor has the first: held in memory until the end, the
       picture would arrive only when the timer gives up waiting */
    var release, byTimer = false, gotFirst = false;
    streamGate = new Promise(function (resolve) { release = resolve; });
    var timer = setTimeout(function () { byTimer = true; release(); }, 3000);
    return ask(port, 'GET', '/img/events/e1/x/stream.webp', {}, function () { gotFirst = true; clearTimeout(timer); release(); }).then(function (r2) {
      ok(r2.status === 200 && r2.body.length === 128 * 1024 && gotFirst && !byTimer, '3.26 STREAMED: the visitor has the first part before the bucket has sent the rest',
        { status: r2.status, len: r2.body.length, byTimer: byTimer });
    });
  }).then(function () {
    return ask(port, 'GET', '/img/events/../x.png');
  }).then(function (r) {
    ok(r.status === 404, '3.27 a path that is not in its simplest form: 404', r.status);
  });
}

/* ======================= 4 the pages ======================= */
function pageChecks() {
  var hero = STORE + 'events/e1/generated/hero-bg.png';
  var page = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta property="og:image" content="' + STORE + 'events/e1/share-card/9ad9d44fea0e0029-mwbrzdn9.jpg" data-rv-seo>' +
    '<meta name="twitter:image" content="' + STORE + 'events/e1/share-card/9ad9d44fea0e0029-mwbrzdn9.jpg">' +
    '<script type="application/ld+json" data-rv-seo>{"image":["' + STORE + 'events/e1/share-card/9ad9d44fea0e0029-mwbrzdn9.jpg"]}</script>' +
    '<style data-rv-style="hero">.hero{background-image:url("' + hero + '?v=20261014094118")}</style></head><body>' +
    '<section class="hero" id="hero"><img src="' + STORE + 'events/e1/generated/20261014094118-overview.png" alt=""></section>' +
    '<img loading="lazy" src="' + STORE + 'events/e1/generated/20261014094118-why.png" alt="">' +
    '<div style="background:url(&quot;' + STORE + 'events/e1/gallery/a.jpg&quot;)"></div>' +
    '<video src="' + STORE + 'events/e1/media/film.mp4" poster="' + STORE + 'events/e1/media/film-still.jpg"></video>' +
    '<a href="' + STORE + 'events/e1/briefs/brochure.pdf">Brochure</a>' +
    '<img src="https://storage.googleapis.com/other-bucket/events/e1/a.png" alt=""><img src="https://img.etb2bimg.com/files/a.png" alt="">' +
    '<img src="//storage.googleapis.com/' + BUCKET + '/events/e1/logo/l.svg" alt="">' +
    '<script>var pic = "' + STORE + 'events/e1/x/inline.webp";</script>' +
    '</body></html>';
  /* the WebP copies pictures.js finds for this page */
  function md5Of(hex8) { return Buffer.from(hex8 + '000000000000000000000000', 'hex').toString('base64'); }
  var files = [
    { name: 'events/e1/generated/hero-bg.png', md5Hash: md5Of('9f223e58') },
    { name: 'events/e1/generated/hero-bg.png.rv-9f223e58.1024x1024.w640.webp' }, { name: 'events/e1/generated/hero-bg.png.rv-9f223e58.1024x1024.w1024.webp' },
    { name: 'events/e1/generated/20261014094118-overview.png', md5Hash: md5Of('aaaa0001') },
    { name: 'events/e1/generated/20261014094118-overview.png.rv-aaaa0001.1600x900.w640.webp' }, { name: 'events/e1/generated/20261014094118-overview.png.rv-aaaa0001.1600x900.w1280.webp' },
    { name: 'events/e1/generated/20261014094118-overview.png.rv-aaaa0001.1600x900.w1600.webp' },
    { name: 'events/e1/generated/20261014094118-why.png', md5Hash: md5Of('bbbb0002') },
    { name: 'events/e1/generated/20261014094118-why.png.rv-bbbb0002.1024x1024.w640.webp' }, { name: 'events/e1/generated/20261014094118-why.png.rv-bbbb0002.1024x1024.w1024.webp' }
  ];
  var withCopies = pictures.rewriteHtml(page, pictures.indexFromListing(BUCKET, files));
  ok(withCopies.indexOf('data-rv-pictures-preload') !== -1 && /srcset="https:\/\/storage/.test(withCopies), '4.0 (set-up) pictures.js gave the page its copies, a preload and srcsets');
  var out = cdn.rewriteHtml(withCopies);
  var left = out.match(/(?:https?:)?\/\/storage\.googleapis\.com\/revamp-cms\.firebasestorage\.app\/[^"'\s)&]+/g) || [];
  ok(left.length === 2 && /film\.mp4$/.test(left[0]) && /brochure\.pdf$/.test(left[1]), '4.1 no picture of ours is left on storage.googleapis.com (the film and the PDF are)', left);
  var preload = /<link rel="preload" as="image" type="image\/webp" href="([^"]+)" fetchpriority="high" data-rv-pictures-preload>/.exec(out);
  ok(preload && preload[1] === '/img/events/e1/generated/hero-bg.png.rv-9f223e58.1024x1024.w1024.webp', '4.2 the hero\'s preload names its copy on /img/', preload && preload[1]);
  var imageSet = /image-set\(url\("([^"]+)"\) type\("image\/webp"\), url\("([^"]+)"\)\)/.exec(out);
  ok(imageSet && preload && imageSet[1] === preload[1] && imageSet[2] === '/img/events/e1/generated/hero-bg.png?v=20261014094118',
    '4.3 the background\'s image-set names the very file the preload loads (one download), the original after it with its ?v= kept', imageSet && imageSet.slice(1));
  ok(/url\("\/img\/events\/e1\/generated\/hero-bg\.png\?v=20261014094118"\)/.test(out), '4.4 the plain url() before it too');
  var heroImg = /<img src="([^"]+20261014094118-overview\.png)"[^>]*srcset="([^"]+)"[^>]*fetchpriority="high"/.exec(out);
  ok(heroImg && heroImg[1] === '/img/events/e1/generated/20261014094118-overview.png' && heroImg[2] === '/img/events/e1/generated/20261014094118-overview.png.rv-aaaa0001.1600x900.w1600.webp 1x',
    '4.5 a picture near the top: src and its 1x srcset on /img/, fetchpriority kept', heroImg && heroImg.slice(1));
  var lazy = /<img loading="lazy" src="([^"]+)"[^>]*srcset="([^"]+)" sizes="/.exec(out);
  ok(lazy && lazy[1] === '/img/events/e1/generated/20261014094118-why.png' && lazy[2].split(', ').every(function (c) { return /^\/img\/events\/e1\/generated\/20261014094118-why\.png\.rv-bbbb0002\.1024x1024\.w\d+\.webp \d+w$/.test(c); }) &&
    lazy[2].split(', ').length === 2, '4.6 a lazy picture: every "w" candidate on /img/', lazy && lazy.slice(1));
  ok(out.indexOf('style="background:url(&quot;/img/events/e1/gallery/a.jpg&quot;)') !== -1, '4.7 a style attribute\'s url(&quot;…&quot;)');
  ok(out.indexOf('<meta property="og:image" content="' + BASE + '/img/events/e1/share-card/9ad9d44fea0e0029-mwbrzdn9.jpg" data-rv-seo>') !== -1 &&
    out.indexOf('<meta name="twitter:image" content="' + BASE + '/img/events/e1/share-card/9ad9d44fea0e0029-mwbrzdn9.jpg">') !== -1,
    '4.8 the link preview\'s picture: the full address on our own origin', out.slice(0, 600));
  ok(out.indexOf('{"image":["' + BASE + '/img/events/e1/share-card/9ad9d44fea0e0029-mwbrzdn9.jpg"]}') !== -1, '4.9 the structured data: the full address');
  ok(out.indexOf('poster="/img/events/e1/media/film-still.jpg"') !== -1 && out.indexOf('href="' + STORE + 'events/e1/briefs/brochure.pdf"') !== -1,
    '4.10 a film\'s still is a picture (on /img/); the film and a PDF stay where they are');
  ok(out.indexOf('https://storage.googleapis.com/other-bucket/events/e1/a.png') !== -1 && out.indexOf('https://img.etb2bimg.com/files/a.png') !== -1,
    '4.11 another bucket\'s picture and another host\'s are left as they are');
  ok(out.indexOf('src="/img/events/e1/logo/l.svg"') !== -1 && out.indexOf('var pic = "/img/events/e1/x/inline.webp"') !== -1, '4.12 a protocol-relative address; an address a page script holds');
  ok(cdn.rewriteHtml(out) === out, '4.13 rewriting it again changes nothing');
  var based = cdn.rewriteHtml('<head><base href="https://elsewhere.example/"></head><img src="' + STORE + 'events/e1/a.png">');
  ok(based.indexOf('src="' + BASE + '/img/events/e1/a.png"') !== -1, '4.14 a page with a <base href> of its own: full addresses (a root-relative one would name its host)', based);
  ok(cdn.rewriteHtml('<img src="' + STORE + 'events/e1/a.png">', { base: 'http://localhost:8361' }) === '<img src="/img/events/e1/a.png">' &&
    cdn.rewriteHtml('<meta property="og:image" content="' + STORE + 'events/e1/a.png">', { base: 'http://localhost:8361' }) === '<meta property="og:image" content="http://localhost:8361/img/events/e1/a.png">',
    '4.15 opts.base: the origin for full addresses');
  process.env.PUBLIC_BASE_URL = 'https://events.example.com';
  ok(cdn.rewriteHtml('<meta property="og:image" content="' + STORE + 'events/e1/a.png">') === '<meta property="og:image" content="https://events.example.com/img/events/e1/a.png">',
    '4.16 the full address follows the public base (PUBLIC_BASE_URL)');
  delete process.env.PUBLIC_BASE_URL;
  ok(cdn.routeUrl(STORE + 'events/e1/a%20b.png?x=1') === '/img/events/e1/a%20b.png?x=1' && cdn.routeUrl(STORE + 'events/e1/a.mp4') === STORE + 'events/e1/a.mp4' &&
    cdn.routeUrl(STORE + 'events/e1/a.png', BASE) === BASE + '/img/events/e1/a.png', '4.17 one address');
  ok(cdn.objectPathOf(cdn.routeUrl(STORE + 'events/e1/a%20b.png')) === 'events/e1/a b.png', '4.18 every rewritten address is one the route answers');

  /* the switch */
  process.env.PICTURE_CDN = 'off';
  ok(!cdn.rewriting() && cdn.rewriteHtml(withCopies) === withCopies && cdn.routeUrl(STORE + 'events/e1/a.png') === STORE + 'events/e1/a.png',
    '4.19 PICTURE_CDN=off: every page as it was, on storage.googleapis.com');
  ['0', 'false', 'no', 'OFF'].forEach(function (v) { process.env.PICTURE_CDN = v; ok(!cdn.rewriting(), '4.20 PICTURE_CDN=' + v + ' is off too'); });
  process.env.PICTURE_CDN = 'on';
  ok(cdn.rewriting(), '4.21 PICTURE_CDN=on');
  delete process.env.PICTURE_CDN;
  ok(cdn.rewriting(), '4.22 on by default');
  process.env.FIREBASE_STORAGE_BUCKET = 'another-bucket.appspot.com';
  ok(cdn.rewriteHtml('<img src="' + STORE + 'events/e1/a.png"><img src="https://storage.googleapis.com/another-bucket.appspot.com/events/e1/a.png">') ===
    '<img src="' + STORE + 'events/e1/a.png"><img src="/img/events/e1/a.png">', '4.23 only the bucket this server serves (FIREBASE_STORAGE_BUCKET)');
  delete process.env.FIREBASE_STORAGE_BUCKET;
  return withCopies;
}

/* ======================= 5 where it is used ======================= */
function useChecks(withCopies) {
  /* delivery (/e/, /preview/, /s/): step 7, after everything else */
  var delivered = hooks.deliverPage(withCopies);
  var leftOver = delivered.match(/(?:https?:)?\/\/storage\.googleapis\.com\/revamp-cms\.firebasestorage\.app\/[^"'\s)&]+/g) || [];
  ok(leftOver.length === 2 && /film\.mp4$/.test(leftOver[0]) && /brochure\.pdf$/.test(leftOver[1]) &&
    delivered.indexOf('href="/img/events/e1/generated/hero-bg.png.rv-9f223e58.1024x1024.w1024.webp"') !== -1 &&
    delivered.indexOf('content="' + BASE + '/img/events/e1/share-card/9ad9d44fea0e0029-mwbrzdn9.jpg"') !== -1,
    '5.1 a page delivered (lib/delivery.js, the last step before /e/, /preview/ and /s/ answer) names its pictures on /img/', leftOver);
  ok(delivered.indexOf('poster="/img/events/e1/media/film-still.jpg"') !== -1, '5.2 delivery\'s step 6 does not take a /img/ still for a dead path of this host');
  var again = delivery.deliverPage('<html><head></head><body><video poster="/img/events/e1/media/s.jpg" src="/img/events/e1/media/s.png"></video></body></html>', { tools: hooks.HTML_TOOLS });
  ok(/poster="\/img\/events\/e1\/media\/s\.jpg"/.test(again), '5.3 a /img/ address already in a stored page stays (it is not a dead path)', again);
  process.env.PICTURE_CDN = 'off';
  var off = hooks.deliverPage(withCopies);
  ok(off.indexOf('/img/') === -1 && off.indexOf(STORE + 'events/e1/generated/hero-bg.png.rv-9f223e58') !== -1, '5.4 switched off: the same page delivered again is on storage.googleapis.com (its cache knows the switch)');
  delete process.env.PICTURE_CDN;

  var delSrc = fs.readFileSync(path.join(__dirname, 'delivery.js'), 'utf8');
  var at7 = delSrc.indexOf('pictureCdn.rewriteHtml(result)'), atT = delSrc.indexOf('result = transform(html, opts.tools)');
  ok(at7 > atT && atT > 0, '5.5 delivery rewrites the addresses after its own transform (which reads them)');

  /* nothing stored is rewritten: publishTransform (what publishing stores) leaves the storage addresses */
  var pubSrc = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
  var pt = pubSrc.slice(pubSrc.indexOf('function publishTransform(html, opts) {'), pubSrc.indexOf('function publishTransform(html, opts) {') + 30000);
  ok(pt.indexOf('picture-cdn') === -1 && pt.indexOf('pictureCdn') === -1, '5.6 publishTransform (stored by a publish) never names /img/: rewritten on the way out only');

  /* the speaker and sponsor pages */
  var peopleSrc = fs.readFileSync(path.join(__dirname, 'people.js'), 'utf8');
  ok(/function sendPage\(req, res, status, html, cache\) \{[\s\S]{0,400}html = require\('\.\/picture-cdn'\)\.rewriteHtml\(html\);/.test(peopleSrc),
    '5.7 the speaker and sponsor pages (people.js sendPage) rewrite theirs');
  ok(/img-src 'self'/.test(peopleSrc), '5.8 …and their Content-Security-Policy lets this site\'s own pictures in');

  /* both servers and the gate */
  var serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), serveSrc = fs.readFileSync(path.join(ROOT, 'tools', 'serve.js'), 'utf8');
  var LINE = "if (url.indexOf('/img/') === 0) return handleApi(req, res);";
  ok(serverSrc.indexOf(LINE) !== -1 && serveSrc.indexOf(LINE) !== -1, '5.9 server.js and tools/serve.js hand /img/ to the API');
  ok(serverSrc.indexOf(LINE) < serverSrc.indexOf("if (req.method !== 'GET' && req.method !== 'HEAD'){"), '5.10 …before the static files (it is not one)');
  ok(access.isPublic({ method: 'GET' }, '/img/events/e1/a.png') && access.isPublic({ method: 'HEAD' }, '/img/events/e1/a.svg') &&
    !access.isPublic({ method: 'GET' }, '/img/events/../a.png') && !access.isPublic({ method: 'GET' }, '/imgx/a.png'), '5.11 the gate: /img/ is public; a path not in its simplest form is not');
  ok(!access.isServableFile('img/a.png'), '5.12 /img/ is no directory of this repository the static server sends');
  var apiSrc = pubSrc.slice(pubSrc.indexOf('function routeApi(req, res) {'));
  ok(/^function routeApi\(req, res\) \{\n  var urlPath = [^\n]+\n\n  \/\*[^\n]+\*\/\n  if \(urlPath\.indexOf\('\/img\/'\) === 0\) return pictureRoute\(req, res\);/.test(apiSrc),
    '5.13 the API\'s router takes /img/ first', apiSrc.slice(0, 300));

  /* the Developer zone's "Copy for another website": made from the page as a visitor gets it (a delivered preview), with
     every address made full against that page — so a picture is the full address of our /img/, and no double quote
     is left in a style attribute */
  var win = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'editor-dev-export.js'), 'utf8'), { window: win, URL: URL, JSON: JSON, Math: Math, RegExp: RegExp, String: String,
    Array: Array, Object: Object, Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout });
  var T = win.RevampDevExport && win.RevampDevExport._test;
  var pageAt = BASE + '/preview/e1?draft=1';
  ok(T && T.absolute('/img/events/e1/generated/20261014094118-overview.png', pageAt) === BASE + '/img/events/e1/generated/20261014094118-overview.png',
    '5.14 the copy: a picture\'s src is the full address of our /img/');
  var heroCss = /\.hero\{[^}]*\}/.exec(cdn.rewriteHtml(withCopies))[0];
  var copied = T && T.singleQuoted(T.absoluteUrls(heroCss, pageAt));
  ok(copied && copied.indexOf('"') === -1 && copied.indexOf("url('" + BASE + '/img/events/e1/generated/hero-bg.png?v=20261014094118') !== -1 &&
    copied.indexOf("image-set(url('" + BASE + '/img/events/e1/generated/hero-bg.png.rv-9f223e58.1024x1024.w1024.webp') !== -1 && copied.indexOf('storage.googleapis.com') === -1,
    '5.15 the copy: a background\'s url() and image-set() on our /img/ in full, in single quotes only', copied);
  var uiSrc = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
  ok(/RevampCore\.previewDraft\(eventId, canvas\.serialize\(\)\)[\s\S]{0,600}RevampDevExport\.loadPage\(url\)/.test(uiSrc),
    '5.16 the copy is made from the staged preview (a delivered page), so its pictures come rewritten');
}

listen(fakeStorage).then(function (storage) {
  var restore = cdn._testUpstream({ request: http.request, protocol: 'http:', host: '127.0.0.1', port: storage.address().port, agent: new http.Agent({ keepAlive: true }), timeoutMs: 400 });
  return listen(ourServer).then(function (ours) {
    return routeChecks(ours.address().port).then(function () {
      var withCopies = pageChecks();
      useChecks(withCopies);
    }).then(function () { restore(); ours.close(); storage.close(); }, function (err) { restore(); ours.close(); storage.close(); throw err; });
  });
}).then(function () {
  if (failures.length) { console.error('picture-cdn: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('picture-cdn: all ' + checks + ' checks passed');
  process.exit(0);
}, function (err) {
  console.error('picture-cdn: the checks could not run — ' + (err && err.stack || err));
  process.exit(1);
});
