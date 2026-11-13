/* node functions/lib/lovable-import.test.js — a Lovable import that did not work is said so and stored as failed
   (BE-048), and an import's pictures, fonts and films are copied completely, safely and within limits (BE-052):
     - lib/import-check.js: the "is this a site" rule on markup, the capture service's codes and bare statuses worded
       for the person (never its own words, never the secret), every sentence fit for create-event.html to show;
     - processLovableImport: a blank capture or a host's "no project here" page is refused before anything is
       fetched or written; a real one has its media copied under hashed names (two photo.jpg stay two), read where
       they stand (a srcset entry, a poster, a film, a stylesheet's url() against THAT sheet's address, a font in
       @font-face), stored public in one step, fonts named on this host;
     - runImportLovableFromUrl against a stand-in capture service: each failure answered with its sentence and
       recorded as a failed import with why, and nothing else written; GET /api/imported-template says so;
     - lib/import-media.js: what a file is by its bytes, the limits (count, size, type, time), an SVG that runs
       script, a relative address not copied written as the original's full address;
     - lib/picture-cdn.js serves an import's fonts from our address, and nothing else new.
   No network beyond 127.0.0.1, no real project. Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm');
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- an in-memory Firestore + Storage that keeps each save's options ---------- */
function fakeFb() {
  var docs = {}, files = {}, saves = {}, publicCalls = [];
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { if (!(o && o.merge) || !docs[p]) docs[p] = docs[p] && o && o.merge ? docs[p] : {}; Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve(); },
      create: function (data) { if (docs[p]) return Promise.reject(Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 })); docs[p] = clone(data); return Promise.resolve(); } };
  }
  function colRef(p) {
    var q = { path: p, doc: function (id) { return docRef(p + '/' + id); }, add: function (d) { var r = docRef(p + '/a' + Math.random().toString(36).slice(2)); docs[r.path] = clone(d); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; }, where: function () { return q; },
      get: function () { var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap); return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } }); } };
    return q;
  }
  var bucket = { name: 'test-bucket', file: function (p) {
    return { name: p,
      save: function (buf, opts) { files[p] = Buffer.from(buf); saves[p] = opts || {}; return Promise.resolve(); },
      makePublic: function () { publicCalls.push(p); return Promise.resolve(); },
      exists: function () { return Promise.resolve([!!files[p]]); },
      download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      delete: function () { delete files[p]; return Promise.resolve(); } };
  } };
  return { db: { collection: function (n) { return colRef(n); }, runTransaction: function (fn) { return Promise.resolve(fn({ get: function (r) { return r.get(); }, set: function (r, d, o) { r.set(d, o); }, update: function (r, d) { r.update(d); } })); } },
    bucket: bucket, docs: docs, files: files, saves: saves, publicCalls: publicCalls,
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
}
var FB = fakeFb();
function stub(name, exports) { var id = require.resolve(name); require.cache[id] = { id: id, filename: id, loaded: true, exports: exports }; }
stub('./firebase', { getFirebase: function () { return FB; } });
var pictures = require('./pictures');
pictures.storeVariants = function () { return Promise.resolve(null); };      // no sharp work in this test
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
process.env.ACCESS_CONFIG_DOC = 'config/test-import-access';
var api = require('./api');
var H = api._testHooks;
var check = require('./import-check');
var media = require('./import-media');
var cdn = require('./picture-cdn');

function fakeRes() {
  return new Promise(function (resolve) {
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: t }); } };
    resolve.res = res;
    fakeRes.last = res;
  });
}
function run(fn) { var p = fakeRes(); fn(fakeRes.last); return p; }
function call(method, url, token) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (token) headers.authorization = 'Bearer ' + token;
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from('') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; }, write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: t }); } };
    api.handleApi(req, res);
  });
}
function filesUnder(prefix) { return Object.keys(FB.files).filter(function (k) { return k.indexOf(prefix) === 0; }); }

/* ---------- bytes of each kind ---------- */
var PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 1)]);
var JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(64, 2)]);
var WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 3)]);
var WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64, 4)]);
var MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 5)]);
var WEBM = Buffer.concat([Buffer.from([0x1A, 0x45, 0xDF, 0xA3]), Buffer.alloc(32, 6)]);
var SVG = Buffer.from('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>');
var BAD_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
var HTML = Buffer.from('<!doctype html><html><body>Not found</body></html>');

/* ---------- create-event.html's own rule for what it shows of a server sentence ---------- */
var CE = fs.readFileSync(path.join(__dirname, '..', '..', 'create-event.html'), 'utf8');
function fnSource(src, name) {
  var at = src.indexOf('function ' + name + '(');
  if (at === -1) return '';
  var i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1); }
  return '';
}
var sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fnSource(CE, 'serverSentence'), sandbox);
function shown(message) { sandbox.e = { said: message }; return vm.runInContext('serverSentence(e)', sandbox); }

(async function () {
  /* ================= lib/import-check.js ================= */
  ok(typeof sandbox.serverSentence === 'function', 'create-event.html\'s serverSentence was found');
  Object.keys(check.WORDS).forEach(function (code) {
    var m = check.failure(code, code === 'source-http-error' ? { httpStatus: 500 } : null).message;
    ok(shown(m) === m, 'the "' + code + '" sentence is shown to the person as it is', m);
  });
  ok(shown(check.failure('source-http-error', { httpStatus: 404 }).message) !== '', 'and the 404 one');
  ok(check.verdict('<div id="root"></div>') === 'empty-page' && check.verdict('<div class="rv-imported"><div id="root"><p>Loading…</p></div></div>') === 'empty-page', 'an empty shell: empty-page');
  ok(check.verdict('<main><h1>404</h1><p>No Lovable project found at this address.</p></main>') === 'not-a-site', 'Lovable\'s own "no project" page: not-a-site');
  ok(check.verdict('<section><h2>About the summit</h2><img src="a.png"><p>x</p></section><section><h2>Speakers</h2><svg></svg></section>') === '', 'a short page with headings and pictures: a site');
  ok(check.verdict('<style>' + 'p{color:red}'.repeat(100) + '</style><script>' + 'x'.repeat(500) + '</script><div></div>') === 'empty-page', 'styles and scripts are not text');

  var e401 = check.fromScraper(401, { error: 'Missing or incorrect X-Scraper-Secret header.' });
  ok(e401.status === 503 && e401.code === 'not-configured' && !/scraper|secret/i.test(e401.message), 'a mismatched secret: 503 "not set up", never the service\'s words', e401.message);
  ok(check.fromScraper(429, {}).code === 'busy' && check.fromScraper(429, {}).status === 503, 'busy: 503 with its sentence (a 429 would read as the AI being busy)');
  ok(check.fromScraper(422, { code: 'source-http-error', httpStatus: 404 }).status === 422 && /404/.test(check.fromScraper(422, { code: 'source-http-error', httpStatus: 404 }).message), 'an address that answered 404: 422, said so');
  ok(check.fromScraper(400, { error: 'That host isn\'t allowed.' }).code === 'refused' && check.fromScraper(500, { error: 'Failed to launch the browser process! /tmp/chromium' }).code === 'render-failed' &&
    !/chromium/.test(check.fromScraper(500, { error: 'Failed to launch the browser process! /tmp/chromium' }).message), 'an older deployment\'s 400 and 500: plain sentences');
  ok(check.fromNetwork(new Error('connect ECONNREFUSED 10.0.0.1:443')).code === 'importer-down' && !/ECONN/.test(check.fromNetwork(new Error('connect ECONNREFUSED')).message), 'the service unreachable: importer-down, no error code shown');
  ok(check.ownHost('https://revamp-cms--revamp-cms.us-east4.hosted.app/e/x', ['localhost:8413', 'https://revamp-cms--revamp-cms.us-east4.hosted.app']) &&
    check.ownHost('http://localhost:8413/', ['localhost:8413']) && !check.ownHost('https://summit.lovable.app/', ['localhost:8413', 'https://revamp-cms--revamp-cms.us-east4.hosted.app']), 'this product\'s own hosts are recognised');

  /* ================= lib/import-media.js ================= */
  ok(media.sniff(PNG).ext === 'png' && media.sniff(JPG).ext === 'jpg' && media.sniff(WEBP).ext === 'webp' && media.sniff(WOFF2).kind === 'font' && media.sniff(MP4).kind === 'video' &&
    media.sniff(WEBM).ext === 'webm' && media.sniff(SVG).ext === 'svg' && media.sniff(HTML) === null && media.sniff(Buffer.from('GIF89a....')).ext === 'gif', 'files are known by their first bytes, an HTML page is none of them');
  ok(media.unsafeSvg(BAD_SVG) && media.unsafeSvg(Buffer.from('<svg onload="x()"></svg>')) && !media.unsafeSvg(SVG), 'an SVG that runs script is unsafe');
  ok(JSON.stringify(media.parseSrcset('a.jpg 1x, https://img.example.com/w_100,h_100/b.jpg 2x,c.jpg')) === JSON.stringify([{ url: 'a.jpg', desc: '1x' }, { url: 'https://img.example.com/w_100,h_100/b.jpg', desc: '2x' }, { url: 'c.jpg', desc: '' }]),
    'a srcset read as the standard reads it (a comma inside an address kept)', media.parseSrcset('a.jpg 1x, https://img.example.com/w_100,h_100/b.jpg 2x,c.jpg'));

  /* ================= BE-048: a capture that is not a site ================= */
  FB.publicCalls.length = 0;
  var refusal = null;
  try { await H.processLovableImport(FB, 'imp-blank', '<html><head><link rel="stylesheet" href="/a.css"></head><body><div id="root"></div></body></html>',
    function () { refusal = 'css fetched'; return Promise.resolve(''); }, function () { refusal = 'media fetched'; return Promise.resolve(null); }, null, { sourceUrl: 'https://blank.lovable.app/' }); }
  catch (e) { refusal = refusal || e; }
  ok(refusal && refusal.code === 'empty-page' && refusal.status === 422, 'a blank capture is refused (422 empty-page), before its stylesheets or media are fetched', refusal && (refusal.code || refusal));
  ok(!filesUnder('events/import-imp-blank/').length && !FB.docs['imports/imp-blank'], 'and nothing is written for it');

  /* a stand-in capture service */
  var answers = {
    'https://gone.lovable.app/': [422, { error: 'That address answered with an error.', code: 'source-http-error', httpStatus: 404 }],
    'https://old.lovable.app/': [200, { html: '<html><body><div id="root"><main><h1>404</h1><p>No Lovable project found at this address.</p></main></div></body></html>' }],
    'https://busy.lovable.app/': [429, { error: 'A page is being rendered already.', code: 'busy' }],
    'https://secret.lovable.app/': [401, { error: 'Missing or incorrect X-Scraper-Secret header.' }],
    'https://odd.lovable.app/': [200, { nothing: true }]
  };
  var service = http.createServer(function (req, res) {
    var body = '';
    req.on('data', function (d) { body += d; });
    req.on('end', function () {
      var url = ''; try { url = JSON.parse(body).url; } catch (e) { /* bad */ }
      var a = answers[url] || [500, { error: 'boom' }];
      res.writeHead(a[0], { 'Content-Type': 'application/json' }); res.end(JSON.stringify(a[1]));
    });
  });
  await new Promise(function (r) { service.listen(0, '127.0.0.1', r); });
  process.env.LOVABLE_SCRAPER_URL = 'http://127.0.0.1:' + service.address().port;
  process.env.LOVABLE_SCRAPER_SECRET = 'not-the-real-one';

  var gone = await run(function (res) { H.runImportLovableFromUrl(FB, res, 'imp-gone', 'https://gone.lovable.app/'); });
  ok(gone.status === 422 && gone.body.code === 'source-http-error' && /404/.test(gone.body.error) && shown(gone.body.error) === gone.body.error, 'an address with no site: 422, "answered 404 (not found)"', gone);
  var rec = FB.docs['imports/imp-gone'] || {};
  ok(rec.importStatus === 'failed' && rec.importFailure && rec.importFailure.code === 'source-http-error' && rec.importFailure.reason === gone.body.error && rec.sourceUrl === 'https://gone.lovable.app/' &&
    !rec.sectionHtmlPath && !filesUnder('events/import-imp-gone/').length, 'recorded as a failed import, with why — and nothing else written', rec);
  var old = await run(function (res) { H.runImportLovableFromUrl(FB, res, 'imp-old', 'https://old.lovable.app/'); });
  ok(old.status === 422 && old.body.code === 'not-a-site' && (FB.docs['imports/imp-old'] || {}).importStatus === 'failed', 'an older capture service that hands back Lovable\'s "no project" page: refused here too', old);
  var busy = await run(function (res) { H.runImportLovableFromUrl(FB, res, 'imp-busy', 'https://busy.lovable.app/'); });
  var sec = await run(function (res) { H.runImportLovableFromUrl(FB, res, 'imp-sec', 'https://secret.lovable.app/'); });
  var odd = await run(function (res) { H.runImportLovableFromUrl(FB, res, 'imp-odd', 'https://odd.lovable.app/'); });
  ok(busy.status === 503 && busy.body.code === 'busy' && sec.status === 503 && sec.body.code === 'not-configured' && !/X-Scraper|secret/i.test(sec.text) &&
    odd.status === 502 && odd.body.code === 'render-failed', 'busy: 503; a mismatched secret: 503 "not set up" (the header\'s name never shown); a strange answer: 502', [busy, sec, odd]);
  var servicePort = service.address().port;
  await new Promise(function (r) { service.close(r); });
  process.env.LOVABLE_SCRAPER_URL = 'http://127.0.0.1:' + servicePort;
  var down = await run(function (res) { H.runImportLovableFromUrl(FB, res, 'imp-down', 'https://any.lovable.app/'); });
  ok(down.status === 502 && down.body.code === 'importer-down' && !/ECONN|127\.0\.0\.1/.test(down.text), 'the capture service down: 502, a plain sentence', down);
  delete process.env.LOVABLE_SCRAPER_URL;
  var none = await run(function (res) { H.runImportLovableFromUrl(FB, res, 'imp-none', 'https://any.lovable.app/'); });
  ok(none.status === 503 && none.body.code === 'not-configured' && !/LOVABLE_SCRAPER_URL|README/.test(none.text), 'no capture service set up: 503, said plainly', none);

  /* a failed import that is opened anyway (the editor, a stale link) */
  var tpl = await call('GET', '/api/imported-template?eventId=imp-gone', 'owner');
  var sct = await call('GET', '/api/imported-section?eventId=imp-gone', 'owner');
  ok(tpl.status === 422 && tpl.body.code === 'import-failed' && /^This design was not imported: That address answered 404/.test(tpl.body.error) && sct.status === 422,
    'GET /api/imported-template and -section of a failed import: 422, with why', [tpl.status, tpl.body, sct.status]);
  /* a failure never overwrites an import that worked */
  FB.docs['imports/imp-good'] = { importStatus: 'imported', sectionHtmlPath: 'events/import-imp-good/section.html' };
  await H.recordImportFailure(FB, 'imp-good', { url: 'https://x.lovable.app/' }, check.failure('busy'));
  ok(FB.docs['imports/imp-good'].importStatus === 'imported', 'a failure recorded for an id that already worked leaves it as it is');

  /* ================= BE-052: a real page's media ================= */
  var PAGE_URL = 'https://summit.lovable.app/';
  var asked = [], active = 0, most = 0;
  var SERVED = {
    'https://summit.lovable.app/team/a/photo.jpg': JPG, 'https://summit.lovable.app/team/b/photo.jpg': Buffer.concat([JPG, Buffer.from('b')]),
    'https://cdn.example.com/brand/logo.png': PNG, 'https://images.example.com/photo?id=1&w=800': WEBP,
    'https://summit.lovable.app/poster.jpg': JPG, 'https://summit.lovable.app/film.mp4': MP4,
    'https://summit.lovable.app/a-1x.png': PNG, 'https://summit.lovable.app/a-2x.png': Buffer.concat([PNG, Buffer.from('2')]),
    'https://summit.lovable.app/bg.webp': WEBP, 'https://summit.lovable.app/fonts/inter.woff2': WOFF2,
    'https://summit.lovable.app/assets/img/hero.png': Buffer.concat([PNG, Buffer.from('hero')]), 'https://summit.lovable.app/logo.svg': SVG,
    'https://summit.lovable.app/bad.svg': BAD_SVG, 'https://summit.lovable.app/notapic.png': HTML, 'https://summit.lovable.app/huge.jpg': Buffer.concat([JPG, Buffer.alloc(11 * 1024 * 1024)])
  };
  function getAsset(url, kind) {
    asked.push(url + ' ' + kind);
    active++; most = Math.max(most, active);
    return new Promise(function (r) { setTimeout(r, 5); }).then(function () { active--; return SERVED[url] ? { body: SERVED[url] } : null; });
  }
  var CSS = '.hero{background:url("../img/hero.png") center/cover}\n@font-face{font-family:Inter;src:url(/fonts/inter.woff2) format("woff2")}\n' +
    '@font-face{font-family:G;src:url(https://fonts.gstatic.com/s/g/v1/x.woff2) format("woff2")}\n@import url("/more.css");\n.x{background:url(data:image/png;base64,AAAA)}';
  var BODY = '<div id="root"><header><img src="/logo.svg" alt="Summit"></header>' +
    '<section id="team"><h2>The team behind the summit</h2><p>Two photos with one name, in two folders.</p>' +
    '<img src="/team/a/photo.jpg" alt="A"><img src="/team/b/photo.jpg" alt="B"><img src="https://cdn.example.com/brand/logo.png" alt="Brand"><img src="/logo.png" alt="Missing">' +
    '<img src="https://images.example.com/photo?id=1&amp;w=800" alt="CDN"><img srcset="/a-1x.png 1x, /a-2x.png 2x" src="/a-1x.png" alt="Set">' +
    '<p>Our old logo lived at /logo.png and https://cdn.example.com/brand/logo.png once.</p>' +
    '<img src="/bad.svg" alt="Bad"><img src="/notapic.png" alt="Not a picture"><img src="/huge.jpg" alt="Huge"><a href="#team">Team</a></section>' +
    '<section id="film"><h2>The film</h2><video poster="/poster.jpg" controls><source src="/film.mp4" type="video/mp4"></video>' +
    '<div style="background-image:url(\'/bg.webp\')"><p>Join us for two days of talks and workshops on the future of work.</p></div></section>' +
    '<style>.foot{background:url(/bg.webp)}</style><footer><p>© Summit 2027</p></footer></div>';
  var page = '<html><head><link rel="stylesheet" href="/assets/css/site.css"></head><body>' + BODY + '</body></html>';
  var result = await H.processLovableImport(FB, 'imp-media', page, function (href) { return Promise.resolve(href === '/assets/css/site.css' ? CSS : null); }, getAsset, null, { sourceUrl: PAGE_URL });
  var stored = filesUnder('events/import-imp-media/assets/');
  var section = String(FB.files['events/import-imp-media/section.html'] || '');
  var doc = FB.docs['imports/imp-media'] || {};
  function storedFor(url, ext) { return 'events/import-imp-media/assets/' + media.nameFor(url, ext); }
  var A = storedFor('https://summit.lovable.app/team/a/photo.jpg', 'jpg'), B = storedFor('https://summit.lovable.app/team/b/photo.jpg', 'jpg');
  ok(result.templateId === 'imported-imp-media' && doc.importStatus === 'imported', 'the import worked', [result.templateId, doc.importStatus]);
  ok(stored.indexOf(A) !== -1 && stored.indexOf(B) !== -1 && A !== B && FB.files[B].slice(-1).toString() === 'b', 'two photo.jpg in two folders: two copies, each its own', stored);
  var bucketUrl = 'https://storage.googleapis.com/test-bucket/';
  ok(section.indexOf('src="' + bucketUrl + A + '"') !== -1 && section.indexOf('src="' + bucketUrl + B + '"') !== -1, 'each img names its own copy', section.slice(0, 800));
  var brand = storedFor('https://cdn.example.com/brand/logo.png', 'png');
  ok(section.indexOf('src="' + bucketUrl + brand + '"') !== -1 && section.indexOf('src="/logo.png"') !== -1 &&
    section.indexOf('Our old logo lived at /logo.png and https://cdn.example.com/brand/logo.png once.') !== -1,
    'a copied CDN logo — not the end of another address —, a /logo.png the original does not have left as written, and words that mention both left alone', section.slice(section.indexOf('Brand') - 200, section.indexOf('once.') + 10));
  var cdnPhoto = storedFor('https://images.example.com/photo?id=1&w=800', 'webp');
  ok(stored.indexOf(cdnPhoto) !== -1 && section.indexOf(bucketUrl + cdnPhoto) !== -1, 'a CDN picture with no extension: copied, as WebP by its bytes');
  ok(section.indexOf('srcset="' + bucketUrl + storedFor('https://summit.lovable.app/a-1x.png', 'png') + ' 1x, ' + bucketUrl + storedFor('https://summit.lovable.app/a-2x.png', 'png') + ' 2x"') !== -1,
    'a srcset: each entry its own copy, descriptors kept', (/srcset="[^"]*"/.exec(section) || [''])[0]);
  ok(section.indexOf('poster="' + bucketUrl + storedFor('https://summit.lovable.app/poster.jpg', 'jpg') + '"') !== -1 && section.indexOf('src="' + bucketUrl + storedFor('https://summit.lovable.app/film.mp4', 'mp4') + '"') !== -1 &&
    asked.indexOf('https://summit.lovable.app/film.mp4 video') !== -1, 'a film and its poster are copied (the film as a film)');
  ok(section.indexOf(storedFor('https://summit.lovable.app/bg.webp', 'webp')) !== -1 && !/url\(['"]?\/bg\.webp/.test(section), 'a style attribute\'s and a <style>\'s url() are copied');
  ok(section.indexOf(bucketUrl + storedFor('https://summit.lovable.app/assets/img/hero.png', 'png')) !== -1 && asked.indexOf('https://summit.lovable.app/assets/img/hero.png image') !== -1,
    'a stylesheet\'s url() is read against THAT sheet\'s address (../img/hero.png from /assets/css/)');
  var font = storedFor('https://summit.lovable.app/fonts/inter.woff2', 'woff2');
  ok(section.indexOf('url("/img/' + font + '")') !== -1 && asked.indexOf('https://summit.lovable.app/fonts/inter.woff2 font') !== -1, 'a font in @font-face: copied, named on this host (/img/…)', (/@font-face\{font-family:Inter[^}]*\}/.exec(section) || [''])[0]);
  ok(asked.every(function (a) { return a.indexOf('fonts.gstatic.com') === -1 && a.indexOf('/more.css') === -1 && a.indexOf('data:') === -1; }) && section.indexOf('fonts.gstatic.com') !== -1,
    'a public font service\'s font, an @import and a data: address are left as they are, never fetched');
  ok(asked.filter(function (a) { return a.indexOf('/bg.webp') !== -1; }).length === 1, 'an address named three times is fetched once');
  var why = {};
  (doc.importMedia.notCopied || []).forEach(function (n) { why[n.url.replace(PAGE_URL, '/')] = n.why; });
  ok(why['/bad.svg'] === 'unsafe-svg' && why['/notapic.png'] === 'bad-type' && why['/huge.jpg'] === 'too-large' && why['/logo.png'] === 'not-found', 'what is not copied is listed with why', why);
  ok(section.indexOf('src="/bad.svg"') !== -1 && stored.every(function (p) { return FB.files[p].indexOf('<script') === -1; }), 'nothing that runs script is stored');
  ok(section.indexOf('src="https://summit.lovable.app/huge.jpg"') !== -1, 'a picture too large to copy: the original\'s full address, where it still shows');
  ok(stored.every(function (p) { return FB.saves[p].predefinedAcl === 'publicRead' && /max-age=31536000/.test(FB.saves[p].metadata.cacheControl) && FB.saves[p].metadata.contentType; }) &&
    FB.publicCalls.every(function (p) { return p.indexOf('/assets/') === -1; }), 'each copy stored public in one step (no save-then-makePublic), with its type, kept a year', stored.map(function (p) { return FB.saves[p]; }).slice(0, 2));
  function typeOf(p) { return ((FB.saves[p] || {}).metadata || {}).contentType; }
  ok(typeOf(storedFor('https://summit.lovable.app/film.mp4', 'mp4')) === 'video/mp4' && typeOf(font) === 'font/woff2' && typeOf(A) === 'image/jpeg',
    'stored as the type its bytes say', [stored, doc.importMedia]);
  ok(most <= media.POOL && most >= 2, 'a few at a time, never all at once (' + most + ' at most)', most);
  ok(doc.importMedia.copied === stored.length && doc.importMedia.byKind.font === 1 && doc.importMedia.byKind.video === 1, 'the import keeps what was copied, by kind', doc.importMedia);

  /* limits: how many, and in what time */
  var many = '<section><h2>Gallery of the summit</h2><p>Photos from last year, many of them, in one place.</p>' + Array.from({ length: 12 }, function (_, i) { return '<img src="/g' + i + '.png">'; }).join('') + '</section>';
  var tasks = 0;
  var out = await media.copyMedia({ html: many, sheets: [], pageUrl: PAGE_URL, kit: H.TOKEN_KIT, folder: 'f/', limits: { MAX_ASSETS: 5 },
    load: function () { tasks++; return Promise.resolve(PNG); }, store: function (p) { return Promise.resolve('https://s/' + p); } });
  ok(out.summary.copied === 5 && tasks === 5 && out.summary.notCopied.filter(function (n) { return n.why === 'too-many'; }).length === 7 && (out.html.match(/https:\/\/s\//g) || []).length === 5,
    'past the most files an import copies, the rest are listed "too-many" and written as full addresses', out.summary);
  var slow = await media.copyMedia({ html: '<img src="/slow.png"><img src="/next.png">', sheets: [], pageUrl: PAGE_URL, kit: H.TOKEN_KIT, folder: 'f/',
    limits: { POOL: 1, BUDGET_MS: 50, LIMITS: { image: { maxBytes: 1e6, timeoutMs: 20 }, font: media.LIMITS.font, video: media.LIMITS.video } },
    load: function () { return new Promise(function () { /* never answers */ }); }, store: function (p) { return Promise.resolve('https://s/' + p); } });
  ok(slow.summary.copied === 0 && slow.summary.notCopied.some(function (n) { return n.why === 'timeout'; }) && slow.summary.notCopied.some(function (n) { return n.why === 'out-of-time'; }),
    'a file that takes too long is given up; nothing new starts after the time an import has', slow.summary);
  /* a ZIP export (no address of its own): its own files by path, the rest left as written */
  var zipped = await media.copyMedia({ html: '<img src="images/a.png"><img src="images/missing.png">', sheets: [], pageUrl: '', kit: H.TOKEN_KIT, folder: 'f/', limits: { BUDGET_MS: 60000 },
    load: function (u) { return Promise.resolve(u === media.ZIP_BASE + 'images/a.png' ? PNG : null); }, store: function (p) { return Promise.resolve('https://s/' + p); } });
  ok(/src="https:\/\/s\/f\/[0-9a-f]{16}\.png"/.test(zipped.html) && zipped.html.indexOf('src="images/missing.png"') !== -1, 'a ZIP export: its picture copied, a missing one left as written', zipped.html);

  /* ================= lib/picture-cdn.js: an import's fonts from our address ================= */
  ok(cdn.objectPathOf('/img/' + font) === font && cdn.pictureType(font, 'font/woff2') === 'font/woff2' && cdn.pictureType(font, 'application/octet-stream') === 'font/woff2',
    'an import\'s font: served from /img/, as a font');
  ok(cdn.objectPathOf('/img/events/x/site/a.woff2') === '' && cdn.objectPathOf('/img/events/import-x/assets/zz.woff2') === '' && cdn.pictureType(font, 'text/html') === '' &&
    cdn.objectPathOf('/img/events/import-x/assets/0123456789abcdef.js') === '', 'no other font, no other name, no other type');

  if (failures.length) { console.error('lovable-import: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('lovable-import: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.error('lovable-import: the run stopped — ' + (err && err.stack || err)); process.exit(1); });
