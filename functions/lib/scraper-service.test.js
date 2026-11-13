/* node functions/lib/scraper-service.test.js — lovable-scraper-service/server.js kept from being used against us
   (BE-047) and answering only with a page that is one (BE-048), without Chrome:
     - its address rules are the main backend's (an identical copy of public-address.js);
     - the secret in constant time; a 4 KB body; /health; every answer a code;
     - the address of a call: http(s), standard port, no credentials, every answer of the name public;
     - the guard every browser connection goes through: private and internal addresses, another port, a name that
       also resolves privately are refused; a public one is connected to at exactly the address checked; a render
       past its byte budget is cut;
     - one render at a time, a short queue, then "busy";
     - "is this a site": a blank page and a host's "no project here" page are refused.
   A helper server on 127.0.0.1 plays "a public site" through the guard's test-only _connectTo. No network.
   Exits 1 listing every failure. */
'use strict';
var fs = require('fs');
var path = require('path');
var http = require('http');
var net = require('net');
var ROOT = path.join(__dirname, '..', '..');
var S = require(path.join(ROOT, 'lovable-scraper-service', 'server.js'));

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 400) : '')); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------- the address rules are one ---------- */
ok(fs.readFileSync(path.join(ROOT, 'lovable-scraper-service', 'public-address.js'), 'utf8') === fs.readFileSync(path.join(__dirname, 'public-address.js'), 'utf8'),
  'lovable-scraper-service/public-address.js is an identical copy of functions/lib/public-address.js (change both together)');
ok(/COPY server\.js public-address\.js/.test(fs.readFileSync(path.join(ROOT, 'lovable-scraper-service', 'Dockerfile'), 'utf8')), 'the image carries the address rules');
var dockerfile = fs.readFileSync(path.join(ROOT, 'lovable-scraper-service', 'Dockerfile'), 'utf8');
ok(/^USER node\s*$/m.test(dockerfile) && dockerfile.indexOf('USER node') > dockerfile.indexOf('npm install') && /PUPPETEER_CACHE_DIR=\/app\//.test(dockerfile),
  'the container runs as the unprivileged node user, with Chrome installed where that user finds it');

/* ---------- the secret ---------- */
ok(S.secretMatches('s3cret-value', 's3cret-value') === true, 'the right secret matches');
ok(!S.secretMatches('s3cret-valuE', 's3cret-value') && !S.secretMatches('s3cret', 's3cret-value') && !S.secretMatches('', 's3cret-value') && !S.secretMatches(undefined, 's3cret-value') &&
  !S.secretMatches(['s3cret-value'], 's3cret-value') && !S.secretMatches('x', ''), 'a wrong, shorter, empty or missing secret does not; nor anything with no secret set');
ok(/timingSafeEqual/.test(fs.readFileSync(path.join(ROOT, 'lovable-scraper-service', 'server.js'), 'utf8')) &&
  !/provided !== SECRET/.test(fs.readFileSync(path.join(ROOT, 'lovable-scraper-service', 'server.js'), 'utf8')), 'compared in constant time, never with !==');

/* ---------- the "is this a site" rule ---------- */
ok(S.captureVerdict({ text: 0, content: 0, sample: '' }) === 'empty-page', 'an empty shell: empty-page');
ok(S.captureVerdict({ text: 120, content: 2, sample: 'Loading…' }) === 'empty-page', 'a few words and two things: empty-page');
ok(S.captureVerdict({ text: 45, content: 2, sample: 'No Lovable project found at this address.' }) === 'not-a-site', 'Lovable\'s "no project" page: not-a-site');
ok(S.captureVerdict({ text: 3000, content: 40, sample: 'Summit 2027 — Page not found? Never: the agenda…' }) === '', 'a real page that happens to say "page not found": a site');
ok(S.captureVerdict({ text: 150, content: 6, sample: 'Hero' }) === '', 'little text but pictures and headings: a site');

/* ---------- the address of a call ---------- */
var lookups = {};
function lookup(host, opts, cb) {
  lookups[host] = (lookups[host] || 0) + 1;
  var table = { 'public.test': ['93.184.216.34'], 'rebind.test': ['93.184.216.34', '10.0.0.5'], 'six.test': ['::ffff:169.254.169.254'], 'v6.test': ['2606:4700::6810:84e5'] };
  if (!table[host]) return cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  cb(null, table[host].map(function (a) { return { address: a, family: net.isIP(a) }; }));
}

/* ---------- a "public site" on 127.0.0.1 ---------- */
var seen = [];
var site = http.createServer(function (req, res) {
  seen.push(req.headers.host + ' ' + req.url);
  if (req.url === '/hello') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('hello from the site'); }
  if (req.url === '/big') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    var sent = 0, chunk = Buffer.alloc(64 * 1024, 120);
    (function more() { if (sent++ >= 32 || res.destroyed) return res.end(); if (res.write(chunk)) setImmediate(more); else res.once('drain', more); })();
    return;
  }
  res.writeHead(404); res.end();
});

function connectThrough(port, target) {
  return new Promise(function (resolve) {
    var s = net.connect(port, '127.0.0.1'), buf = '';
    s.on('connect', function () { s.write('CONNECT ' + target + ' HTTP/1.1\r\nHost: ' + target + '\r\n\r\n'); });
    s.on('data', function (d) {
      buf += d.toString('latin1');
      if (buf.indexOf('\r\n\r\n') !== -1 && !s._answered) { s._answered = true; resolve({ socket: s, status: +(/^HTTP\/1\.1 (\d{3})/.exec(buf) || [])[1] || 0, head: buf }); }
    });
    s.on('error', function () { resolve({ socket: s, status: 0, head: buf }); });
    s.on('close', function () { if (!s._answered) { s._answered = true; resolve({ socket: s, status: +(/^HTTP\/1\.1 (\d{3})/.exec(buf) || [])[1] || 0, head: buf }); } });
  });
}
function getThrough(port, url) {
  return new Promise(function (resolve) {
    var req = http.request({ host: '127.0.0.1', port: port, method: 'GET', path: url, headers: { Host: new URL(url).host } }, function (res) {
      var body = [];
      res.on('data', function (d) { body.push(d); });
      res.on('end', function () { resolve({ status: res.statusCode, body: Buffer.concat(body) }); });
      res.on('error', function () { resolve({ status: res.statusCode, body: Buffer.concat(body), cut: true }); });
      res.on('aborted', function () { resolve({ status: res.statusCode, body: Buffer.concat(body), cut: true }); });
      res.on('close', function () { resolve({ status: res.statusCode, body: Buffer.concat(body), cut: !res.complete }); });
    });
    req.on('error', function (e) { resolve({ status: 0, error: e.code }); });
    req.end();
  });
}
function postJson(port, pathname, body, headers) {
  return new Promise(function (resolve) {
    var data = typeof body === 'string' ? body : JSON.stringify(body);
    var req = http.request({ host: '127.0.0.1', port: port, method: pathname === '/health' || pathname === '/healthz' ? 'GET' : 'POST', path: pathname,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers || {}) }, function (res) {
      var out = '';
      res.on('data', function (d) { out += d; });
      res.on('end', function () { var j = null; try { j = JSON.parse(out); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', function (e) { resolve({ status: 0, error: e.code }); });
    req.end(pathname === '/health' || pathname === '/healthz' ? undefined : data);
  });
}

/* The page a real Chrome opens through the guard ("site.test", a public address that _connectTo points at the helper):
   it asks, as a hostile page would, for the metadata service, this machine's loopback and a private address, by a
   picture, fetch() and an Image(). Each must be refused by the guard; the helper must never be reached on its own
   address (which only a browser going around the guard could do). Then a 404 page and a blank page are refused. */
var HOSTILE = '<!doctype html><html><head><title>Summit</title></head><body><header><h1>The Summit 2027</h1></header>' +
  '<main><p>' + 'Two days of talks, workshops and awards for the people building what comes next. '.repeat(5) + '</p>' +
  '<img src="/ok.png" alt="ok"><img src="http://169.254.169.254/latest/meta-data/x.png" alt="m"><h2>Agenda</h2><p>Day one.</p></main>' +
  '<script>fetch("http://127.0.0.1:PORT/secret").catch(function(){});fetch("http://10.0.0.5/").catch(function(){});' +
  'new Image().src="http://localhost:PORT/secret";</script></body></html>';
var PNG1 = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
function chromeDriver() {
  var tries = [process.env.RV_PUPPETEER, 'puppeteer-core', path.join(process.env.HOME || '', '.revamp-cms-qa', 'node_modules', 'puppeteer-core')].filter(Boolean);
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]); } catch (e) { /* next */ } }
  return null;
}
async function withChrome(sitePort) {
  var CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .filter(Boolean).filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
  var puppeteer = chromeDriver();
  if (!puppeteer || !CHROME) { console.log('scraper-service: the real-Chrome part skipped — no Chrome / puppeteer-core here'); return; }
  var hosts = [];
  site.removeAllListeners('request');
  site.on('request', function (req, res) {
    hosts.push(req.headers.host + ' ' + req.url);
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(HOSTILE.replace(/PORT/g, String(sitePort))); }
    if (req.url === '/ok.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG1); }
    if (req.url === '/blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><html><body><div id="root"></div></body></html>'); }
    if (req.url === '/missing') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><html><body><h1>404</h1><p>No Lovable project found at this address.</p></body></html>'); }
    res.writeHead(404); res.end();
  });
  var guard = await S.startGuard({ lookup: lookup, _connectTo: function () { return { host: '127.0.0.1', port: sitePort }; } });
  var browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--proxy-server=http://127.0.0.1:' + guard.port, '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--no-first-run'] });
  try {
    var html = await S.capturePage(await browser.newPage(), 'http://public.test/', { deadlineAt: Date.now() + 40000, refused: guard.refusedHost });
    var st = guard.stats();
    ok(/The Summit 2027/.test(html) && /Agenda/.test(html), 'Chrome renders the page through the guard', String(html).slice(0, 200));
    ok(st.refused.indexOf('169.254.169.254') !== -1 && st.refused.indexOf('10.0.0.5') !== -1 && st.refused.some(function (h) { return /^(127\.0\.0\.1|localhost):\d+$/.test(h); }),
      'the page\'s requests for the metadata service, a private address and this machine were refused by the guard', st.refused);
    ok(hosts.every(function (h) { return /^public\.test /.test(h); }) && hosts.indexOf('public.test /ok.png') !== -1, 'Chrome never went around the guard: every request it made reached the site as public.test', hosts);
    var missing = null, blank = null, blocked = null;
    try { await S.capturePage(await browser.newPage(), 'http://public.test/missing', { refused: guard.refusedHost }); } catch (e) { missing = e; }
    try { await S.capturePage(await browser.newPage(), 'http://public.test/blank', { refused: guard.refusedHost }); } catch (e) { blank = e; }
    try { await S.capturePage(await browser.newPage(), 'http://10.0.0.5/', { refused: guard.refusedHost }); } catch (e) { blocked = e; }
    ok(missing && missing.code === 'source-http-error' && missing.httpStatus === 404, 'a page that answers 404 is refused with its status, not captured (BE-048)', missing && [missing.code, missing.httpStatus]);
    ok(blank && blank.code === 'empty-page', 'a blank page is refused (BE-048)', blank && blank.code);
    ok(blocked && blocked.code === 'blocked-address', 'a private address as the page itself: blocked-address', blocked && blocked.code);
  } finally {
    await browser.close();
    await guard.close();
  }
}

(async function main() {
  await new Promise(function (r) { site.listen(0, '127.0.0.1', r); });
  var sitePort = site.address().port;

  /* checkUrl */
  var r = await Promise.all([
    S.checkUrl('http://127.0.0.1/', lookup), S.checkUrl('http://169.254.169.254/latest/meta-data/', lookup), S.checkUrl('http://[::ffff:10.0.0.1]/', lookup),
    S.checkUrl('http://metadata.google.internal/', lookup), S.checkUrl('https://localhost/', lookup), S.checkUrl('https://rebind.test/', lookup),
    S.checkUrl('https://six.test/', lookup), S.checkUrl('https://public.test:8443/', lookup), S.checkUrl('https://user:pw@public.test/', lookup),
    S.checkUrl('file:///etc/passwd', lookup), S.checkUrl('https://nowhere.test/', lookup), S.checkUrl('https://public.test/x', lookup), S.checkUrl('https://v6.test/', lookup),
    S.checkUrl('http://100.64.0.1/', lookup)
  ]);
  ok(['blocked-address', 'blocked-address', 'blocked-address', 'blocked-address', 'blocked-address', 'blocked-address', 'blocked-address'].every(function (c, i) { return r[i] && r[i].code === c; }),
    'loopback, the metadata address, IPv4-mapped private, internal names, localhost, a name with one private answer, a mapped metadata answer: refused', r.slice(0, 7));
  ok(r[7] && r[7].code === 'bad-url' && r[8] && r[8].code === 'bad-url' && r[9] && r[9].code === 'bad-url', 'another port, credentials in the address, another scheme: bad-url', r.slice(7, 10));
  ok(r[10] && r[10].code === 'unreachable' && r[11] === null && r[12] === null && r[13] && r[13].code === 'blocked-address', 'a name that does not resolve: unreachable; public answers: allowed; carrier-grade NAT: refused', r.slice(10));

  /* the guard */
  lookups = {};
  var guard = await S.startGuard({ lookup: lookup, maxBytes: 600 * 1024, _connectTo: function (address, port) { return { host: '127.0.0.1', port: sitePort }; } });
  var refused = await Promise.all(['127.0.0.1:443', '169.254.169.254:80', 'metadata.google.internal:443', 'rebind.test:443', 'public.test:8443', '[::1]:443', 'localhost:443'].map(function (t) { return connectThrough(guard.port, t); }));
  ok(refused.every(function (x) { return x.status === 403; }), 'CONNECT to loopback, metadata, an internal name, a rebinding name, another port, IPv6 loopback, localhost: 403', refused.map(function (x) { return x.status; }));
  refused.forEach(function (x) { x.socket.destroy(); });
  ok(guard.refusedHost('https://rebind.test/page') && guard.refusedHost('http://169.254.169.254/') && !guard.refusedHost('https://public.test/'), 'the guard remembers what it refused (a refused page is "blocked-address")');

  var tunnel = await connectThrough(guard.port, 'public.test:443');
  ok(tunnel.status === 200, 'CONNECT to a public name: 200', tunnel.head);
  var through = await new Promise(function (resolve) {
    var buf = '';
    tunnel.socket.on('data', function (d) { buf += d; });
    tunnel.socket.on('close', function () { resolve(buf); });
    tunnel.socket.write('GET /hello HTTP/1.1\r\nHost: public.test\r\nConnection: close\r\n\r\n');
  });
  ok(/hello from the site/.test(through), 'and the tunnel reaches the address that was checked', through.slice(0, 200));

  var plain = await getThrough(guard.port, 'http://public.test/hello');
  ok(plain.status === 200 && String(plain.body) === 'hello from the site' && seen.indexOf('public.test /hello') !== -1, 'plain http through the guard: the page, its Host kept', [plain.status, String(plain.body || ''), seen]);
  var plainBad = await Promise.all([getThrough(guard.port, 'http://169.254.169.254/computeMetadata/v1/'), getThrough(guard.port, 'http://127.0.0.1:' + sitePort + '/hello'),
    getThrough(guard.port, 'http://rebind.test/hello')]);
  ok(plainBad.every(function (x) { return x.status === 403; }), 'plain http to metadata, to loopback on another port, to a rebinding name: 403', plainBad.map(function (x) { return x.status; }));
  ok(lookups['public.test'] === 1, 'each name is resolved once per render (the connection is pinned to that answer)', lookups);

  var big = await getThrough(guard.port, 'http://public.test/big');
  await sleep(50);
  ok(guard.stats().over === true && (!big.body || big.body.length < 2 * 1024 * 1024), 'a render past its byte budget is cut', [guard.stats(), big.body && big.body.length]);
  var after = await getThrough(guard.port, 'http://public.test/hello');
  ok(after.status === 403 || after.status === 0, 'and nothing more is fetched for it', after.status);
  await guard.close();

  /* one at a time */
  var gate = S.createGate(1, 1);
  var rel1 = await gate.enter(1000);
  var second = gate.enter(1000), thirdErr = null;
  try { await gate.enter(1000); } catch (e) { thirdErr = e; }
  ok(thirdErr && thirdErr.code === 'busy' && thirdErr.status === 429, 'one running, one waiting: a third is told busy (429)', thirdErr && thirdErr.code);
  rel1();
  var rel2 = await second;
  ok(typeof rel2 === 'function' && gate.stats().active === 1, 'the waiting one runs when the first is done');
  var late = null;
  try { await gate.enter(30); } catch (e) { late = e; }
  ok(late && late.code === 'busy' && gate.stats().waiting === 0, 'a wait that runs out is busy, and leaves the queue', late && late.code);
  rel2(); rel2();
  ok(gate.stats().active === 0, 'releasing twice frees one place only');

  /* the service */
  var renders = [];
  var service = S.createService({ secret: 'test-secret', requestBudgetMs: 3000, minRenderMs: 1000, maxWaiting: 1,
    check: function (url) { return S.checkUrl(url, lookup); },
    render: function (url, o) {
      renders.push(url);
      if (/notfound/.test(url)) return Promise.reject(Object.assign(new Error('x'), { code: 'source-http-error', httpStatus: 404 }));
      if (/blank/.test(url)) return Promise.reject(Object.assign(new Error('x'), { code: 'empty-page' }));
      if (/slow/.test(url)) return sleep(600).then(function () { return '<html>slow</html>'; });
      if (/crash/.test(url)) return Promise.reject(new Error('Chrome could not start: /tmp/chromium libnss3.so'));
      return Promise.resolve('<html><body>ok ' + (o && o.deadlineAt > Date.now() ? 'with time' : 'no time') + '</body></html>');
    } });
  await new Promise(function (r2) { service.listen(0, '127.0.0.1', r2); });
  var port = service.address().port, H = { 'X-Scraper-Secret': 'test-secret' };
  var a = await Promise.all([
    postJson(port, '/health', ''), postJson(port, '/healthz', ''), postJson(port, '/scrape', { url: 'https://public.test/' }),
    postJson(port, '/scrape', { url: 'https://public.test/' }, { 'X-Scraper-Secret': 'wrong' }), postJson(port, '/scrape', JSON.stringify({ url: 'https://public.test/', pad: 'x'.repeat(5000) }), H),
    postJson(port, '/scrape', '{not json', H), postJson(port, '/scrape', {}, H), postJson(port, '/scrape', { url: 'http://169.254.169.254/' }, H),
    postJson(port, '/scrape', { url: 'https://public.test/notfound' }, H), postJson(port, '/scrape', { url: 'https://public.test/blank' }, H),
    postJson(port, '/scrape', { url: 'https://public.test/crash' }, H), postJson(port, '/elsewhere', {}, H)
  ]);
  ok(a[0].status === 200 && a[0].body.ok === true && a[1].status === 200, 'GET /health (and /healthz): 200 {ok:true}', [a[0], a[1]]);
  ok(a[2].status === 401 && a[2].body.code === 'unauthorized' && a[3].status === 401, 'no secret, a wrong secret: 401', [a[2], a[3]]);
  ok(a[4].status === 413 && a[4].body.code === 'too-large', 'a body over 4 KB: 413', a[4]);
  ok(a[5].status === 400 && a[5].body.code === 'bad-request' && a[6].status === 400, 'not JSON, no url: 400', [a[5], a[6]]);
  ok(a[7].status === 400 && a[7].body.code === 'blocked-address', 'the metadata address: 400 blocked-address, never rendered', a[7]);
  ok(a[8].status === 422 && a[8].body.code === 'source-http-error' && a[8].body.httpStatus === 404, 'an address that answered 404: 422 with its status', a[8]);
  ok(a[9].status === 422 && a[9].body.code === 'empty-page', 'a blank page: 422 empty-page', a[9]);
  ok(a[10].status === 500 && a[10].body.code === 'render-failed' && !/libnss|chromium|tmp/.test(JSON.stringify(a[10].body)), 'an unexpected failure: 500, its details only in the log', a[10]);
  ok(a[11].status === 404, 'any other path: 404', a[11]);
  ok(renders.indexOf('http://169.254.169.254/') === -1, 'a refused address is never handed to the browser', renders);

  var good = await postJson(port, '/scrape', { url: 'https://public.test/page' }, H);
  ok(good.status === 200 && /ok with time/.test(good.body.html), 'a page: 200 {html}, rendered with a deadline', good);

  /* busy: one rendering, one waiting, the third told so at once */
  var trio = await Promise.all([postJson(port, '/scrape', { url: 'https://public.test/slow1' }, H), postJson(port, '/scrape', { url: 'https://public.test/slow2' }, H),
    sleep(30).then(function () { return postJson(port, '/scrape', { url: 'https://public.test/slow3' }, H); })]);
  var codes = trio.map(function (x) { return x.status; }).sort();
  ok(codes.join() === '200,200,429' && trio.some(function (x) { return x.body && x.body.code === 'busy'; }), 'two calls at once: one renders, one waits its turn; a third: 429 busy', trio.map(function (x) { return [x.status, x.body && x.body.code]; }));
  service.close();

  /* ---------- in a real Chrome, when there is one: the capture goes through the guard ---------- */
  await withChrome(sitePort);
  site.close();

  if (failures.length) { console.error('scraper-service: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('scraper-service: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.error('scraper-service: the run stopped — ' + (err && err.stack || err)); process.exit(1); });
