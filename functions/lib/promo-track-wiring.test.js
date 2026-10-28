/* node functions/lib/promo-track-wiring.test.js — how a mailer's open pixel and click links (/t/o/<id>.gif,
   /t/c/<id>) and the "Mailer performance" endpoints reach lib/promo-track.js: routing in lib/api.js, the answers
   a recipient still gets when that module cannot be loaded, the sign-in gate letting exactly those two paths
   through, both servers handing /t/ to the API, server.js writing pending counts on SIGTERM, robots.txt keeping
   crawlers out, and apphosting.yaml naming the tracking address while the signing key stays commented out until
   the owner has set it. lib/promo-track.js is a stub here (it may not exist yet), and so is Firebase. No network.
   Exits 1 on any failure. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + detail : '')); }

var ROOT = path.resolve(__dirname, '..', '..');
delete process.env.K_SERVICE;

/* ---------- Firebase: a stub nothing in these routes should reach ---------- */
var FB = { db: {}, bucket: {}, auth: { verifyIdToken: function () { return Promise.reject(new Error('stub: no sign-in in this test')); } } };
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true,
  exports: { getFirebase: function () { return FB; } } };

/* ---------- lib/promo-track.js: a recorder with the contract's exports, resolved in place of the real file ---------- */
var FAIL_LOAD = false, WIRE_THROWS = false, resolves = 0, calls = [];
var stub = {
  wire: function (h) { calls.push({ fn: 'wire', helpers: h }); if (WIRE_THROWS) throw new Error('stub: wire failed'); },
  mode: function () { return 'off'; },
  availableFor: function () { return false; },
  base: function () { return ''; },
  countsFor: function () { return false; },
  recordSends: function () { return Promise.resolve(); },
  flushAll: function () { return Promise.resolve(); },
  handleOpen: function (req, res) {
    calls.push({ fn: 'handleOpen', method: req.method, url: req.url });
    res.writeHead(200, { 'Content-Type': 'image/gif', 'X-Stub': 'open' });
    res.end(req.method === 'HEAD' ? undefined : Buffer.from('stub-open'));
  },
  handleClick: function (req, res) {
    calls.push({ fn: 'handleClick', method: req.method, url: req.url });
    res.writeHead(302, { Location: 'https://sponsor.example/a', 'X-Stub': 'click' });
    res.end();
  },
  handleAnalytics: function (req, res) {
    calls.push({ fn: 'handleAnalytics', method: req.method, url: req.url });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Stub': 'analytics' });
    res.end('{"scope":"event"}');
  },
  handleAnalyticsAll: function (req, res) {
    calls.push({ fn: 'handleAnalyticsAll', method: req.method, url: req.url });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Stub': 'analytics-all' });
    res.end('{"scope":"all"}');
  },
  _test: {}
};
var STUB = path.join(__dirname, '__stub-promo-track.js'), realResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent) {
  if (req === './promo-track') { resolves++; if (FAIL_LOAD) throw new Error('stub: cannot load'); return STUB; }
  return realResolve.apply(this, arguments);
};
require.cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: stub };

const access = require('./access');
const api = require('./api');
const siteSeo = require('./site-seo');

var CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
var ID = 'abcdefghijkl';
var CLICK = '/t/c/' + ID + '?u=' + encodeURIComponent('https://sponsor.example/a?b=1') + '&s=0123456789abcdef';

/* one request through api.handleApi; resolves { status, headers, body (Buffer | string | undefined), text } */
function call(method, url, headers) {
  return new Promise(function (resolve) {
    var req = { method: method, url: url, headers: Object.assign({ host: 'localhost', 'user-agent': CHROME }, headers || {}), socket: {}, rawBody: Buffer.from('') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k] = v; }, getHeader: function (k) { return res.headers[k]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { resolve({ status: res.statusCode, headers: res.headers, body: b, text: b === undefined ? '' : String(b) }); }
    };
    api.handleApi(req, res);
  });
}
function names() { return calls.map(function (c) { return c.fn; }).join(','); }
function wiredWithHelpers() {
  var h = calls[0] && calls[0].fn === 'wire' ? calls[0].helpers : null;
  return !!h && ['withAdmin', 'eventIdOr400', 'loadLiveEvent', 'sendFailure'].every(function (k) { return typeof h[k] === 'function'; });
}

var GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
var PIXEL_HEADERS = { 'Content-Type': 'image/gif', 'Content-Length': 42, 'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options': 'nosniff' };
function samePixelHeaders(h) {
  var want = Object.keys(PIXEL_HEADERS);
  return Object.keys(h).length === want.length && want.every(function (k) { return h[k] === PIXEL_HEADERS[k]; });
}

(async function () {
  ok(resolves === 0 && calls.length === 0, 'loading lib/api.js does not load lib/promo-track.js (it is loaded on use, never at the top)', resolves);

  /* ---------- 1. the pixel and the click link reach the module, wired first ---------- */
  calls = [];
  var o = await call('GET', '/t/o/' + ID + '.gif');
  ok(o.status === 200 && o.headers['X-Stub'] === 'open' && names() === 'wire,handleOpen' && calls[1].url === '/t/o/' + ID + '.gif',
    'GET /t/o/<id>.gif reaches handleOpen, after wire()', o.status + ' ' + names());
  ok(wiredWithHelpers(), 'wire() gets withAdmin, eventIdOr400, loadLiveEvent and sendFailure');

  calls = [];
  var oh = await call('HEAD', '/t/o/' + ID + '.gif');
  ok(oh.status === 200 && oh.body === undefined && names() === 'wire,handleOpen' && calls[1].method === 'HEAD' && wiredWithHelpers(),
    'HEAD /t/o/<id>.gif reaches handleOpen too (the module counts it as automated)', oh.status + ' ' + names());

  calls = [];
  var c = await call('GET', CLICK);
  ok(c.status === 302 && c.headers['X-Stub'] === 'click' && names() === 'wire,handleClick' && calls[1].url === CLICK && wiredWithHelpers(),
    'GET /t/c/<id>?u=…&s=… reaches handleClick with its query intact, after wire()', c.status + ' ' + names() + ' ' + (calls[1] && calls[1].url));

  calls = [];
  var ch = await call('HEAD', CLICK);
  ok(ch.status === 302 && names() === 'wire,handleClick' && calls[1].method === 'HEAD', 'HEAD /t/c/<id> reaches handleClick', ch.status + ' ' + names());

  /* ---------- 2. other methods and other paths under /t/ never reach it ---------- */
  calls = [];
  var p405 = await call('POST', '/t/o/x.gif');
  ok(p405.status === 405 && p405.headers.Allow === 'GET, HEAD' && p405.headers['Cache-Control'] === 'no-store', 'POST /t/o/x.gif: 405, Allow: GET, HEAD', p405.status + ' ' + JSON.stringify(p405.headers));
  var opt = await call('OPTIONS', CLICK);
  ok(opt.status === 405 && opt.headers.Allow === 'GET, HEAD', 'OPTIONS /t/c/<id>: 405', opt.status);
  var del = await call('DELETE', '/t/zzz');
  ok(del.status === 405, 'a method other than GET or HEAD anywhere under /t/: 405', del.status);
  var paths404 = ['/t/zzz', '/t/o/a/b', '/t/', '/t/o/', '/t/x/abc', '/t/c/' + new Array(82).join('a'), '/t/o/a/'];
  for (var i = 0; i < paths404.length; i++) {
    var r = await call('GET', paths404[i]);
    ok(r.status === 404 && r.text === 'Not found' && r.headers['Content-Type'] === 'text/plain; charset=utf-8' && r.headers['Cache-Control'] === 'no-store' &&
      r.headers['X-Content-Type-Options'] === 'nosniff', 'GET ' + paths404[i].slice(0, 30) + ': 404 Not found', r.status + ' ' + r.text);
  }
  ok(calls.length === 0, 'none of those reached lib/promo-track.js', names());
  var tLike = await call('GET', '/tx/o/' + ID + '.gif');
  ok(tLike.status === 404 && tLike.body && /No such endpoint/.test(tLike.text) && calls.length === 0, 'a path that only starts like /t is not a tracking path', tLike.status + ' ' + tLike.text);

  /* ---------- 3. the dashboard endpoints (sign-in is checked inside the module, by withAdmin) ---------- */
  calls = [];
  var an = await call('GET', '/api/promo/analytics?eventId=x');
  ok(an.status === 200 && an.headers['X-Stub'] === 'analytics' && names() === 'wire,handleAnalytics' && calls[1].url === '/api/promo/analytics?eventId=x' && wiredWithHelpers(),
    'GET /api/promo/analytics?eventId=x reaches handleAnalytics, after wire()', an.status + ' ' + names());
  calls = [];
  var all = await call('GET', '/api/promo/analytics/all');
  ok(all.status === 200 && all.headers['X-Stub'] === 'analytics-all' && names() === 'wire,handleAnalyticsAll' && wiredWithHelpers(),
    'GET /api/promo/analytics/all reaches handleAnalyticsAll, after wire()', all.status + ' ' + names());
  calls = [];
  var allFresh = await call('GET', '/api/promo/analytics/all?fresh=1');
  ok(allFresh.status === 200 && names() === 'wire,handleAnalyticsAll' && calls[1].url === '/api/promo/analytics/all?fresh=1', 'GET /api/promo/analytics/all?fresh=1 reaches it with ?fresh=1', names());
  calls = [];
  var anPost = await call('POST', '/api/promo/analytics');
  ok(anPost.status === 404 && calls.length === 0, 'POST /api/promo/analytics is no route', anPost.status);

  /* ---------- 4. the module fails to load: a recipient still gets a picture, a link says so plainly ---------- */
  var logged = [], realError = console.error, realNow = Date.now;
  console.error = function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); };
  function trackLogs() { return logged.filter(function (l) { return /could not load lib\/promo-track\.js for (GET|HEAD) \/t\//.test(l); }); }
  try {
    FAIL_LOAD = true; calls = [];
    var fo = await call('GET', '/t/o/' + ID + '.gif');
    ok(fo.status === 200 && Buffer.isBuffer(fo.body) && fo.body.equals(GIF) && samePixelHeaders(fo.headers),
      'module missing: GET pixel is still the 42-byte GIF with the no-store headers', fo.status + ' ' + JSON.stringify(fo.headers));
    var foh = await call('HEAD', '/t/o/' + ID + '.gif');
    ok(foh.status === 200 && foh.body === undefined && samePixelHeaders(foh.headers), 'module missing: HEAD pixel has the same headers and no body', foh.status + ' ' + JSON.stringify(foh.headers));
    var fc = await call('GET', CLICK);
    ok(fc.status === 503 && fc.headers['Content-Type'] === 'text/plain; charset=utf-8' && fc.headers['Cache-Control'] === 'no-store' &&
      fc.headers['X-Content-Type-Options'] === 'nosniff' && /not available right now/.test(fc.text) && !fc.headers.Location,
      'module missing: a click link answers 503 in plain text, no-store, and redirects nowhere', fc.status + ' ' + JSON.stringify(fc.headers) + ' ' + fc.text);
    ok(calls.length === 0, 'module missing: the stub was never reached', names());
    ok(trackLogs().length === 1, 'module missing: logged once for three hits within a minute', trackLogs().length);
    Date.now = function () { return realNow() + 61000; };
    await call('GET', '/t/o/' + ID + '.gif');
    ok(trackLogs().length === 2, 'module missing: logged again once a minute has passed', trackLogs().length);
    Date.now = realNow;

    var fa = await call('GET', '/api/promo/analytics?eventId=x');
    ok(fa.status === 503 && JSON.parse(fa.text).code === 'module-unavailable', 'module missing: the dashboard endpoint answers the usual JSON 503', fa.status + ' ' + fa.text);
    var faa = await call('GET', '/api/promo/analytics/all');
    ok(faa.status === 503 && JSON.parse(faa.text).code === 'module-unavailable', 'module missing: the team endpoint answers the usual JSON 503', faa.status + ' ' + faa.text);

    FAIL_LOAD = false; WIRE_THROWS = true; calls = [];
    var wo = await call('GET', '/t/o/' + ID + '.gif');
    ok(wo.status === 200 && Buffer.isBuffer(wo.body) && wo.body.equals(GIF) && samePixelHeaders(wo.headers) && names() === 'wire',
      'wire() throwing: the pixel is the plain GIF and the module\'s handler is not used', wo.status + ' ' + names());
    var wc = await call('GET', CLICK);
    ok(wc.status === 503, 'wire() throwing: a click link answers 503', wc.status);
    WIRE_THROWS = false;
  } finally {
    console.error = realError; Date.now = realNow; FAIL_LOAD = false; WIRE_THROWS = false;
  }
  calls = [];
  var back = await call('GET', '/t/o/' + ID + '.gif');
  ok(back.headers['X-Stub'] === 'open' && names() === 'wire,handleOpen', 'once the module loads again, the next hit reaches it (a failed require is not cached)', names());

  /* ---------- 5. the sign-in gate: exactly the pixel and the click link are public ---------- */
  ['/t/o/' + ID + '.gif', '/t/c/' + ID].forEach(function (p) { ok(access.isPublic({ method: 'GET', headers: {} }, p) === true, p + ' is public'); });
  ['/t/o/a/b', '/t/', '/t/o/%2e%2e', '/t/x/abc', '/t/o/', '/t/c/', '/t/o/%2Fx', '//t/o/' + ID + '.gif', '/t/o/../c/' + ID].forEach(function (p) {
    ok(access.isPublic({ method: 'GET', headers: {} }, p) === false, p + ' is not public');
  });
  function gateOf(url) {
    var out = { next: false, status: 0, headers: null };
    var res = { writeHead: function (s, h) { out.status = s; out.headers = h; }, end: function () {} };
    access.gate({ method: 'GET', url: url, headers: {} }, res, function () { out.next = true; });
    return out;
  }
  var g1 = gateOf('/t/o/' + ID + '.gif'), g2 = gateOf(CLICK), g3 = gateOf('/t/x/abc');
  ok(g1.next && g2.next, 'the gate lets a signed-out pixel and click (query and all) through', JSON.stringify([g1, g2]));
  ok(!g3.next && g3.status === 302, 'the gate sends a signed-out request for another /t/ path to sign-in', JSON.stringify(g3));
  /* a path the gate cannot read (a malformed escape) is never public, so a signed-out recipient gets the gate's own
     answer, before promo-track runs: 404 for a path with an extension (a pixel), else sign-in (plan §3b step 1, §3g) */
  var g5 = gateOf('/t/o/%zz.gif'), g6 = gateOf('/t/c/%zz?u=x&s=y'), g7 = gateOf('/t/c/'), g8 = gateOf('/t/x');
  ok(!g5.next && g5.status === 404, 'signed out, /t/o/%zz.gif: the gate\'s 404 (not the GIF)', JSON.stringify(g5));
  ok(!g6.next && g6.status === 302 && !g7.next && g7.status === 302 && !g8.next && g8.status === 302,
    'signed out, /t/c/%zz?u=…, /t/c/ and /t/x: the gate\'s 302 to sign-in (not routeApi\'s 404)', JSON.stringify([g6, g7, g8]));
  var g4 = gateOf('/api/promo/analytics?eventId=x');
  ok(!g4.next && g4.status === 401, 'the dashboard endpoint is not public: 401 signed out', JSON.stringify(g4));

  /* ---------- 6. both servers hand /t/ to the API; server.js flushes counts on SIGTERM ---------- */
  var serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  var serveSrc = fs.readFileSync(path.join(ROOT, 'tools', 'serve.js'), 'utf8');
  var NEW_RE = '/^\\/(api|e|preview|t)\\//', OLD_RE = '/^\\/(api|e|preview)\\//';
  ok(serverSrc.indexOf(NEW_RE) !== -1 && serverSrc.indexOf(OLD_RE) === -1, 'server.js routes /t/ to the API', NEW_RE);
  ok(serveSrc.indexOf(NEW_RE) !== -1 && serveSrc.indexOf(OLD_RE) === -1, 'tools/serve.js routes /t/ to the API');
  ok(new RegExp(NEW_RE.slice(1, -1)).test('/t/o/' + ID + '.gif') && !new RegExp(NEW_RE.slice(1, -1)).test('/tx/'), 'that pattern takes /t/ and not /tx/');

  var sig = /\nprocess\.on\('SIGTERM', function \(\) \{[\s\S]*?\n\}\);\n/.exec(serverSrc);
  ok(!!sig && /flushAll\(8000\)/.test(sig[0]), 'server.js has a SIGTERM handler calling flushAll(8000)');
  if (sig) {
    var TRACK_FILE = path.join(ROOT, 'functions', 'lib', 'promo-track.js');
    /* runs server.js's own handler against a fake process and require.cache; resolves the exit codes seen */
    var runSigterm = function (cached, afterSignal) {
      var handlers = {}, exits = [], cache = {};
      if (cached) cache[TRACK_FILE] = cached;
      vm.runInNewContext(sig[0], { process: { on: function (s, fn) { handlers[s] = fn; }, exit: function (code) { exits.push(code); } },
        require: { cache: cache }, path: path, __dirname: ROOT, Promise: Promise });
      handlers.SIGTERM();
      return Promise.resolve(afterSignal && afterSignal(exits)).then(function () { return new Promise(function (r) { setTimeout(r, 20); }); }).then(function () { return exits; });
    };
    var e1 = await runSigterm(null);
    ok(e1.join() === '0', 'SIGTERM with lib/promo-track.js never loaded: exits 0 at once', e1.join());
    var flushedWith = null, release = null, exitsBeforeFlush = null;
    var e2 = await runSigterm({ exports: { flushAll: function (ms) { flushedWith = ms; return new Promise(function (r) { release = r; }); } } }, function (exits) {
      return new Promise(function (r) { setTimeout(r, 20); }).then(function () { exitsBeforeFlush = exits.join(); release(); });
    });
    ok(flushedWith === 8000 && exitsBeforeFlush === '' && e2.join() === '0', 'SIGTERM with counts pending: flushAll(8000) first, exit 0 only once it settles',
      flushedWith + ' / before: ' + exitsBeforeFlush + ' / after: ' + e2.join());
    var e3 = await runSigterm({ exports: { flushAll: function () { return Promise.reject(new Error('x')); } } });
    ok(e3.join() === '0', 'SIGTERM with a failing flush: still exits 0', e3.join());
    var e4 = await runSigterm({ exports: {} });
    ok(e4.join() === '0', 'SIGTERM with a module that has no flushAll: exits 0', e4.join());
  }

  /* ---------- 7. robots.txt: crawlers stay out of /t/ (the final Disallow: /, and no Allow for it) ---------- */
  var robots = siteSeo.robotsTxt('https://x');
  /* "Allow: /templates/" is not about /t/: only an Allow of /t itself or something under /t/ would be */
  ok(/^Disallow: \/$/m.test(robots) && !/^Allow: \/t(\/|\s*$)/m.test(robots), 'robots.txt disallows / and allows nothing under /t/', robots);

  /* ---------- 8. apphosting.yaml: the tracking address set, the key commented out until the owner sets it ---------- */
  var yaml = fs.readFileSync(path.join(ROOT, 'apphosting.yaml'), 'utf8');
  var lines = yaml.split('\n');
  var at = lines.findIndex(function (l) { return /^ {2}- variable: MAILER_TRACK_BASE\s*$/.test(l); });
  ok(at !== -1 && lines[at + 1] === '    value: "https://revamp-cms--revamp-cms.us-east4.hosted.app"' && lines[at + 2] === '    availability:' && lines[at + 3] === '      - RUNTIME',
    'MAILER_TRACK_BASE is the hosted.app address, at runtime', lines.slice(at, at + 4).join(' | '));
  var base = at !== -1 ? /"([^"]*)"/.exec(lines[at + 1]) : null;
  ok(!!base && /^https:\/\/[a-z0-9.-]+$/.test(base[1]), 'MAILER_TRACK_BASE is a bare https origin (no path, no trailing slash)', base && base[1]);
  var mentions = lines.filter(function (l) { return l.indexOf('TRACK_SECRET') !== -1; });
  ok(mentions.length > 0 && mentions.every(function (l) { return /^\s*#/.test(l); }), 'every line that mentions TRACK_SECRET is commented out',
    mentions.filter(function (l) { return !/^\s*#/.test(l); }).join(' | '));
  ok(!lines.some(function (l) { return /^\s*-?\s*(secret|variable):\s*TRACK_SECRET/.test(l); }), 'no live TRACK_SECRET variable or secret line');
  /* the commented blocks become valid entries, the same shape as the others, by deleting the leading "# " */
  ['TRACK_SECRET', 'TRACK_SECRET_PREVIOUS'].forEach(function (name) {
    var k = lines.indexOf('  # - variable: ' + name);
    var block = k === -1 ? [] : lines.slice(k, k + 4).map(function (l) { return l.replace(/^ {2}# /, '  '); });
    ok(block.join('\n') === '  - variable: ' + name + '\n    secret: ' + name + '\n    availability:\n      - RUNTIME',
      'the commented ' + name + ' entry uncomments to a valid secret entry', block.join(' | '));
  });
  ok(yaml.indexOf('\t') === -1, 'apphosting.yaml has no tabs (YAML indentation)');

  /* ---------- 9. the pixel api.js answers on its own ---------- */
  var P = api._testHooks.TRACK_PIXEL;
  ok(Buffer.isBuffer(P) && P.length === 42 && P.slice(0, 6).toString('latin1') === 'GIF89a' && P[P.length - 1] === 0x3b && P.equals(GIF),
    'api._testHooks.TRACK_PIXEL is the 42-byte GIF89a', P && P.length);

  Module._resolveFilename = realResolve;
  delete require.cache[STUB];
  console.log(checks + ' checks, ' + failures.length + ' failed');
  if (failures.length) { failures.forEach(function (f) { console.log('  FAIL ' + f); }); process.exit(1); }
  process.exit(0);
})().catch(function (err) { Module._resolveFilename = realResolve; console.error(err && err.stack || err); process.exit(1); });
