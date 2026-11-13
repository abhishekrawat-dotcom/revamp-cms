/* node functions/lib/web-server.test.js — the one serving code both servers run (BE-063).
   functions/lib/web-server.js is what server.js (App Hosting) and tools/serve.js (local) answer with, so the local
   server sends what production sends: the same files, the same caching, compression, ?v= stamping and page headers,
   the same routes to the API. Part 1 drives the handler in-process with a stand-in API; part 2 starts tools/serve.js
   itself on a free loopback port (no credentials needed: only files and the sign-in refusals are asked for). */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http'), zlib = require('zlib');
var spawn = require('child_process').spawn;
var web = require('./web-server');
var delivery = require('./delivery');
var ROOT = path.join(__dirname, '..', '..');

var fails = 0, n = 0;
function check(label, cond, detail) {
  n++;
  if (cond) return;
  fails++;
  console.log('FAIL ' + label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 500) : ''));
}

/* ---------- part 1: the handler ---------- */
var apiCalls = [];
function fakeApi(req, res) { apiCalls.push(req.url); res.writeHead(299, { 'Content-Type': 'text/plain' }); res.end('api'); }
function call(listener, method, url, headers) {
  return new Promise(function (resolve) {
    var out = { status: 0, headers: {}, body: null };
    var res = {
      headersSent: false,
      setHeader: function (k, v) { out.headers[String(k).toLowerCase()] = v; },
      writeHead: function (s, h) { out.status = s; Object.keys(h || {}).forEach(function (k) { out.headers[k.toLowerCase()] = h[k]; }); this.headersSent = true; },
      end: function (b) { out.body = b == null ? null : Buffer.isBuffer(b) ? b : Buffer.from(String(b)); resolve(out); }
    };
    listener({ url: url, method: method, headers: headers || {}, on: function () {}, socket: {} }, res);
  });
}
var open = web.handler({ guard: function (req, res, next) { next(); }, handleApi: fakeApi });

var steps = [];
function step(fn) { steps.push(fn); }

step(function () {
  return Promise.all([
    call(open, 'GET', '/index.html'),
    call(open, 'GET', '/index.html', { 'accept-encoding': 'gzip, br' }),
    call(open, 'HEAD', '/index.html'),
    call(open, 'GET', '/auth.js'),
    call(open, 'GET', '/auth.js?v=' + delivery.assetVersion('/auth.js')),
    call(open, 'GET', '/auth.js?v=not-the-hash'),
    call(open, 'GET', '/favicon.ico')
  ]).then(function (r) {
    var page = r[0], packed = r[1], head = r[2], js = r[3], vjs = r[4], wrong = r[5], icon = r[6];
    check('1.1 a page: 200, html, never cached', page.status === 200 && /^text\/html/.test(page.headers['content-type']) && page.headers['cache-control'] === 'no-store', page.headers);
    check('1.2 a page carries the app pages\' headers (BE-057) and nosniff', page.headers['content-security-policy'] === "frame-ancestors 'self'" && page.headers['x-frame-options'] === 'SAMEORIGIN' &&
      page.headers['referrer-policy'] === 'strict-origin-when-cross-origin' && page.headers['x-content-type-options'] === 'nosniff', page.headers);
    check('1.3 a page names its own scripts by content hash (?v=)', /auth\.js\?v=[A-Za-z0-9._-]+/.test(page.body.toString('utf8')));
    check('1.4 compressed when the browser takes brotli, and said so', packed.headers['content-encoding'] === 'br' && zlib.brotliDecompressSync(packed.body).toString('utf8') === page.body.toString('utf8') && packed.headers.vary === 'Accept-Encoding', packed.headers);
    check('1.5 HEAD: the same headers, no body', head.status === 200 && head.body === null && head.headers['content-length'] === page.body.length, head.headers);
    check('1.6 a script by its plain name: 5 minutes, no page headers', js.status === 200 && js.headers['cache-control'] === 'public, max-age=300' && !js.headers['content-security-policy'], js.headers);
    check('1.7 a script by its current hash: a year', vjs.headers['cache-control'] === 'public, max-age=31536000, immutable', vjs.headers);
    check('1.8 a script by a hash that is not current: 5 minutes', wrong.headers['cache-control'] === 'public, max-age=300', wrong.headers);
    check('1.9 /favicon.ico is the ETB2B square (assets/favicon.svg)', icon.status === 200 && icon.headers['content-type'] === 'image/svg+xml' &&
      icon.body.equals(fs.readFileSync(path.join(ROOT, 'assets', 'favicon.svg'))));
  });
});

step(function () {
  var hidden = ['/tools/.env.local', '/tools/serve.js', '/server.js', '/functions/lib/api.js', '/lovable-scraper-service/server.js', '/package.json',
    '/preview-draft.html', '/PRD.md', '/x%00.js', '/%E0%A4%A', '/no-such-page.html'];
  return Promise.all(hidden.map(function (u) { return call(open, 'GET', u); })).then(function (r) {
    var shown = hidden.filter(function (u, i) { return r[i].status !== 404; });
    check('2.1 what production does not serve answers 404 here too (secrets, backend source, tooling, documents, bad paths)', shown.length === 0, shown);
  });
});

step(function () {
  var routed = ['/api/events', '/e/some-event', '/preview/some-event', '/t/o/x.gif', '/s/token/agenda', '/img/events/e/a.png',
    '/robots.txt', '/sitemap.xml', '/sitemap-people.xml', '/speakers/asha-rao', '/sponsors/acme'];
  apiCalls = [];
  return Promise.all(routed.map(function (u) { return call(open, 'GET', u); })).then(function (r) {
    check('3.1 the API\'s addresses go to the API, as in production', r.every(function (x) { return x.status === 299; }) && apiCalls.length === routed.length, apiCalls);
    return Promise.all([call(open, 'POST', '/index.html'), call(open, 'POST', '/api/register')]);
  }).then(function (r) {
    check('3.2 a file takes GET and HEAD only (405); an API route decides for itself', r[0].status === 405 && r[0].headers.allow === 'GET, HEAD' && r[1].status === 299, [r[0].status, r[1].status]);
  });
});

step(function () {
  var throwing = web.handler({ guard: function (req, res, next) { next(); }, handleApi: function () { throw new Error('boom'); } });
  var guardThrows = web.handler({ guard: function () { throw new Error('gate broke'); }, handleApi: fakeApi });
  var refused = web.handler({ guard: function (req, res) { res.writeHead(302, { Location: '/?next=x' }); res.end(); }, handleApi: fakeApi });
  var quiet = console.error; console.error = function () {};
  return Promise.all([call(throwing, 'GET', '/api/x'), call(guardThrows, 'GET', '/index.html'), call(refused, 'GET', '/Event_Listing.html')]).then(function (r) {
    console.error = quiet;
    check('4.1 a route that throws costs that request only: 500 with a sentence (JSON for /api/)', r[0].status === 500 && JSON.parse(r[0].body.toString('utf8')).error === 'Something went wrong on the server. Please try again.', r[0].status);
    check('4.2 a gate that throws: 500, the server keeps serving', r[1].status === 500, r[1].status);
    check('4.3 the gate decides first: what it refuses is never served', r[2].status === 302 && r[2].headers.location === '/?next=x', r[2]);
  }, function (err) { console.error = quiet; throw err; });
});

step(function () {
  check('5.1 handler() refuses to run without a gate', (function () { try { web.handler({ handleApi: fakeApi }); return false; } catch (e) { return true; } })());
  var server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), serve = fs.readFileSync(path.join(ROOT, 'tools', 'serve.js'), 'utf8');
  check('5.2 server.js serves through web-server.js with the sign-in gate', /web\.handler\(\{ root: __dirname, guard: gate, handleApi: handleApi \}\)/.test(server));
  check('5.3 tools/serve.js serves through the same code, on 127.0.0.1 only', /web\.handler\(\{ root: root, guard: guard, handleApi: handleApi \}\)/.test(serve) && /\.listen\(port, '127\.0\.0\.1'/.test(serve));
  check('5.4 neither keeps a copy of its own (no second file list, cache rule or header table)', [server, serve].every(function (s) { return !/function cacheFor|APP_PAGE_HEADERS = \{|'\.woff2': 'font\/woff2'/.test(s); }));
});

/* ---------- part 2: tools/serve.js itself ---------- */
function freePort() {
  return new Promise(function (resolve, reject) {
    var s = http.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', function () { var p = s.address().port; s.close(function () { resolve(p); }); });
  });
}
function get(port, url, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ host: '127.0.0.1', port: port, path: url, method: 'GET', headers: headers || {} }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); });
    });
    req.on('error', reject);
    req.setTimeout(20000, function () { req.destroy(new Error('timed out')); });
    req.end();
  });
}
function startDevServer(authDisabled) {
  return freePort().then(function (port) {
    return new Promise(function (resolve, reject) {
      var env = Object.assign({}, process.env, { REVAMP_AUTH_DISABLED: authDisabled ? '1' : '0' });
      delete env.K_SERVICE;
      var child = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js'), String(port)], { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
      var out = '', done = false;
      var timer = setTimeout(function () { if (!done) { done = true; child.kill(); reject(new Error('tools/serve.js did not start: ' + out)); } }, 60000);
      child.stdout.on('data', function (c) {
        out += c;
        if (!done && /\n.*sign-in/i.test(out)) { done = true; clearTimeout(timer); resolve({ child: child, port: port, out: out }); }
      });
      child.stderr.on('data', function (c) { out += c; });
      child.on('exit', function (code) { if (!done) { done = true; clearTimeout(timer); reject(new Error('tools/serve.js exited ' + code + ': ' + out)); } });
    });
  });
}

step(function () {
  return startDevServer(true).then(function (dev) {
    return Promise.all([get(dev.port, '/index.html', { 'accept-encoding': 'br' }), get(dev.port, '/tools/.env.local'), get(dev.port, '/api/events'), call(open, 'GET', '/index.html', { 'accept-encoding': 'br' })]).then(function (r) {
      var lines = dev.out.split('\n').filter(function (l) { return /REVAMP_AUTH_DISABLED/.test(l); });
      check('6.1 with REVAMP_AUTH_DISABLED=1 it says, in one line, that the pages are open and the API is not', lines.length === 1 && /pages open here without a sign-in/.test(lines[0]) && /API route that is not public still checks the caller/.test(lines[0]), dev.out);
      var same = ['content-type', 'cache-control', 'content-security-policy', 'x-frame-options', 'referrer-policy', 'x-content-type-options', 'content-encoding', 'vary']
        .filter(function (h) { return String(r[0].headers[h]) !== String(r[3].headers[h]); });
      check('6.2 a page from the dev server has production\'s headers, compression included', r[0].status === 200 && same.length === 0, same);
      check('6.3 tools/.env.local is never served', r[1].status === 404, r[1].status);
      check('6.4 the API still asks for a sign-in with the page gate off', r[2].status === 401, [r[2].status, r[2].body.toString('utf8').slice(0, 120)]);
      dev.child.kill();
    }, function (err) { dev.child.kill(); throw err; });
  });
});

step(function () {
  return startDevServer(false).then(function (dev) {
    return get(dev.port, '/Event_Listing.html').then(function (r) {
      check('7.1 without it, start-up says sign-in is required, as in production', /Sign-in required, as in production/.test(dev.out), dev.out);
      check('7.2 …and a signed-out page goes to the sign-in page', r.status === 302 && /^\/\?/.test(String(r.headers.location || '')), [r.status, r.headers.location]);
      dev.child.kill();
    }, function (err) { dev.child.kill(); throw err; });
  });
});

steps.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve()).then(function () {
  console.log(fails ? 'web-server: ' + fails + ' of ' + n + ' checks FAILED' : 'web-server: all ' + n + ' checks passed');
  process.exit(fails ? 1 : 0);
}, function (err) {
  console.log('web-server: the run stopped — ' + (err && err.stack || err));
  process.exit(1);
});
