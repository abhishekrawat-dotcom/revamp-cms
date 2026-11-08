/* node functions/lib/safe-fetch.test.js — exits 1 on the first failure it lists.
   A helper server on 127.0.0.1 plays "the internal service that must never be reached" and, through the
   test-only _connectTo option, also "a public site" (a made-up name the stub resolver answers with a public
   address, whose connection is then pointed at the helper). */

const http = require('http');
const { safeFetch, checkPublicUrl, isPublicAddress } = require('./safe-fetch');
const { isInternalHostname } = require('./public-address');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

var hits = [];
var helper = http.createServer(function (req, res) {
  hits.push(req.headers.host + ' ' + req.url);
  if (req.url === '/hello') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<p>hello</p>'); }
  if (req.url === '/to-loopback') { res.writeHead(302, { Location: 'http://127.0.0.1:' + helper.address().port + '/secret' }); return res.end(); }
  if (req.url === '/to-metadata') { res.writeHead(307, { Location: 'http://169.254.169.254/computeMetadata/v1/' }); return res.end(); }
  if (req.url === '/to-internal-name') { res.writeHead(301, { Location: 'http://metadata.google.internal/' }); return res.end(); }
  if (req.url === '/to-hello') { res.writeHead(302, { Location: '/hello' }); return res.end(); }
  if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); return res.end(); }
  if (req.url === '/big') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    var sent = 0, chunk = Buffer.alloc(1024 * 1024, 97);
    (function more() {
      if (sent >= 50 || res.destroyed) return res.end();
      sent++;
      if (res.write(chunk)) setImmediate(more); else res.once('drain', more);
    })();
    return;
  }
  if (req.url === '/big-declared') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 50 * 1024 * 1024 }); return res.write('x'); }
  if (req.url === '/gzip-bomb') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });
    return res.end(require('zlib').gzipSync(Buffer.alloc(30 * 1024 * 1024, 0)));
  }
  if (req.url === '/hang') return;                                    // never answers
  if (req.url === '/slow-body') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.write('start'); return; }   // never ends
  if (req.url === '/pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF'); }
  if (req.url === '/echo-headers') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(req.headers)); }
  if (req.url === '/big-head') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 50 * 1024 * 1024 }); return res.end(); }
  if (req.url === '/method') { res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Method': req.method }); return res.end(req.method === 'HEAD' ? undefined : 'body'); }
  /* what Wikipedia, GitHub and ET do: a HEAD answer that names the encoding and size a GET would get, and no body */
  if (req.url === '/gz-head') {
    var gzBody = require('zlib').gzipSync('<p>hi</p>');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': req.method === 'HEAD' ? 5000 : gzBody.length });
    return res.end(req.method === 'HEAD' ? undefined : gzBody);
  }
  /* a "not found" page bigger than anything read (ET's and GitHub's are over 64 KB) */
  if (req.url === '/big404') { res.writeHead(404, { 'Content-Type': 'text/html', 'Content-Length': 50 * 1024 * 1024 }); return res.write('x'); }
  if (req.url === '/big404-chunked') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end(Buffer.alloc(300 * 1024, 120)); }
  var chain = /^\/chain\/(\d+)$/.exec(req.url);
  if (chain) { res.writeHead(302, { Location: '/chain/' + (+chain[1] + 1) }); return res.end(); }
  if (req.url === '/to-8443') { res.writeHead(301, { Location: 'https://public.test:8443/' }); return res.end(); }
  if (req.url === '/secret') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('INTERNAL SECRET'); }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('no');
});

function publicLookup(answers) {
  return function (hostname, options, cb) { cb(null, answers.map(function (a) { return { address: a, family: a.indexOf(':') === -1 ? 4 : 6 }; })); };
}
var connects = [];
function toHelper(target) { connects.push(target.address); return { address: '127.0.0.1', port: helper.address().port }; }
function viaHelper(path, extra) {
  return safeFetch('http://public.test' + path, Object.assign({ lookup: publicLookup(['93.184.216.34']), _connectTo: toHelper, timeoutMs: 4000 }, extra || {}));
}
function codeOf(promise) { return promise.then(function (r) { return 'resolved:' + r.status; }, function (e) { return e.code || ('threw:' + e.message); }); }

async function run() {
  await new Promise(function (r) { helper.listen(0, '127.0.0.1', r); });
  var port = helper.address().port;

  /* --- the address test --- */
  ['127.0.0.1', '127.255.255.254', '10.255.255.1', '100.64.0.1', '0.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1',
    '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:10.0.0.1',
    '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '2002:7f00:1::', '2002:a00:1::1', '::127.0.0.1', 'fc00::1', 'fd12:3456::1',
    'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1', '2001::1', 'not-an-ip', '', '1.2.3', '[::1]'
  ].forEach(function (ip) { ok(isPublicAddress(ip) === false, 'isPublicAddress refuses ' + ip); });
  ['8.8.8.8', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.0.1', '198.17.0.1',
    '198.20.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '64:ff9b::808:808'
  ].forEach(function (ip) { ok(isPublicAddress(ip) === true, 'isPublicAddress accepts ' + ip); });
  ['localhost', 'a.localhost', 'printer.local', 'metadata', 'metadata.google.internal', 'db.internal', 'LOCALHOST.', ''].forEach(function (h) {
    ok(isInternalHostname(h) === true, 'isInternalHostname refuses "' + h + '"');
  });
  ok(isInternalHostname('example.com') === false && isInternalHostname('internal.example.com') === false, 'isInternalHostname accepts public names');

  /* --- checkPublicUrl --- */
  var refused = ['http://127.0.0.1:' + port + '/', 'http://localhost/', 'http://10.255.255.1/', 'http://100.64.0.1/', 'http://0.0.0.1/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/', 'http://2130706433/', 'http://0x7f000001/', 'http://017700000001/',
    'http://127.1/', 'http://169.254.169.254/computeMetadata/v1/', 'http://metadata.google.internal/', 'http://example.com:8080/',
    'https://example.com:8443/', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pw@example.com/',
    'http://[::1]/', 'http://[fe80::1]/', 'http://printer.local/', 'not a url', '', '//example.com/'];
  for (var i = 0; i < refused.length; i++) {
    var r = await checkPublicUrl(refused[i], { lookup: publicLookup(['93.184.216.34']) });
    ok(r.ok === false && !!r.reason && /^(bad-url|blocked-address)$/.test(r.code), 'checkPublicUrl refuses ' + refused[i], JSON.stringify(r));
  }
  var good = await checkPublicUrl('https://example.com/a?b=c', { lookup: publicLookup(['93.184.216.34']) });
  ok(good.ok === true, 'checkPublicUrl accepts a public https address', JSON.stringify(good));
  ok((await checkPublicUrl('http://example.com:80/', { lookup: publicLookup(['93.184.216.34']) })).ok === true, 'checkPublicUrl accepts an explicit standard port');
  var mapped = await checkPublicUrl('http://rebind.test/', { lookup: publicLookup(['::ffff:10.0.0.1']) });
  ok(mapped.ok === false && mapped.code === 'blocked-address', 'a name that resolves to ::ffff:10.0.0.1 is refused', JSON.stringify(mapped));
  var mixed = await checkPublicUrl('http://rebind.test/', { lookup: publicLookup(['93.184.216.34', '127.0.0.1']) });
  ok(mixed.ok === false && mixed.code === 'blocked-address', 'a name with one private answer among public ones is refused', JSON.stringify(mixed));
  var nx = await checkPublicUrl('http://nowhere.test/', { lookup: function (h, o, cb) { cb(new Error('ENOTFOUND')); } });
  ok(nx.ok === false && nx.code === 'unreachable', 'a name that does not resolve is "unreachable"', JSON.stringify(nx));

  /* --- safeFetch --- */
  hits.length = 0;
  ok(await codeOf(safeFetch('http://127.0.0.1/secret')) === 'blocked-address', 'safeFetch refuses loopback');
  ok(await codeOf(safeFetch('http://localhost:' + port + '/secret')) === 'bad-url', 'safeFetch refuses a non-standard port before anything else');
  ok(hits.length === 0, 'none of the refused requests reached the helper', hits.join(' | '));

  var hello = await viaHelper('/hello');
  ok(hello.status === 200 && hello.body.toString() === '<p>hello</p>' && hello.finalUrl === 'http://public.test/hello', 'a public page is fetched', JSON.stringify({ s: hello.status, u: hello.finalUrl }));
  ok(hits[hits.length - 1] === 'public.test /hello', 'the Host header is the host name, not the pinned address', hits[hits.length - 1]);
  ok(connects[connects.length - 1] === '93.184.216.34', 'the connection is made to the address that was checked', connects.join(','));

  var followed = await viaHelper('/to-hello');
  ok(followed.status === 200 && followed.finalUrl === 'http://public.test/hello', 'a redirect to another public page is followed and reported', followed.finalUrl);

  hits.length = 0;
  ok(await codeOf(viaHelper('/to-loopback')) === 'bad-url', 'a redirect to http://127.0.0.1:<port>/secret is refused at the hop');
  ok(hits.join('|').indexOf('/secret') === -1, 'the helper saw no request for /secret', hits.join(' | '));
  ok(await codeOf(viaHelper('/to-metadata')) === 'blocked-address', 'a redirect to the metadata address is refused');
  ok(await codeOf(viaHelper('/to-internal-name')) === 'blocked-address', 'a redirect to an internal name is refused');
  ok(await codeOf(viaHelper('/loop')) === 'unreachable', 'a redirect loop ends after maxRedirects');
  ok(hits.filter(function (h) { return /\/loop$/.test(h); }).length === 4, 'the loop was requested 1 + 3 times', hits.join(' | '));

  connects.length = 0; hits.length = 0;
  var rebind = await codeOf(safeFetch('http://rebind.test/secret', { lookup: publicLookup(['93.184.216.34', '10.0.0.5']), _connectTo: toHelper, timeoutMs: 3000 }));
  ok(rebind === 'blocked-address' && connects.length === 0 && hits.length === 0, 'public-then-private answers: refused, no connection at all', rebind + ' connects=' + connects.length);

  var t0 = Date.now();
  ok(await codeOf(viaHelper('/big', { maxBytes: 2 * 1024 * 1024 })) === 'too-large', 'a 50 MB body is cut at maxBytes');
  ok(Date.now() - t0 < 3000, 'and promptly (' + (Date.now() - t0) + ' ms)');
  ok(await codeOf(viaHelper('/big-declared', { maxBytes: 1024 * 1024 })) === 'too-large', 'a declared 50 MB body is refused from its Content-Length');
  ok(await codeOf(viaHelper('/gzip-bomb', { maxBytes: 1024 * 1024 })) === 'too-large', 'a small gzip body that inflates past maxBytes is cut');

  t0 = Date.now();
  ok(await codeOf(viaHelper('/hang', { timeoutMs: 700 })) === 'timeout', 'a server that never answers ends at timeoutMs');
  ok(Date.now() - t0 >= 650 && Date.now() - t0 < 1500, 'after about timeoutMs (' + (Date.now() - t0) + ' ms)');
  t0 = Date.now();
  ok(await codeOf(viaHelper('/slow-body', { timeoutMs: 700 })) === 'timeout', 'a body that never finishes also ends at timeoutMs');
  ok(Date.now() - t0 < 1500, 'within the one overall timer (' + (Date.now() - t0) + ' ms)');

  ok(await codeOf(viaHelper('/pdf', { accept: ['text/html', 'text/plain'] })) === 'bad-type', 'an unexpected content type is refused');
  ok(await codeOf(viaHelper('/pdf', { accept: 'application/pdf' })) === 'resolved:200', 'the expected content type is accepted');
  ok(await codeOf(viaHelper('/hello', { accept: 'text/' })) === 'resolved:200', 'a type prefix is accepted');
  ok(await codeOf(viaHelper('/nope')) === 'resolved:404', 'an error status is returned, not thrown');

  var echoed = JSON.parse((await viaHelper('/echo-headers', { headers: { Cookie: 'a=b', Authorization: 'Bearer x', 'X-Extra': '1' } })).body.toString());
  ok(!echoed.cookie && !echoed.authorization && echoed['x-extra'] === '1' && /^RevampCMS-Fetcher/.test(echoed['user-agent']), 'no cookie or credential is sent; the User-Agent is fixed', JSON.stringify(echoed));

  /* --- HEAD (the site check's outside links, link-check.js): asked without the body, under the same rules --- */
  var head = await viaHelper('/method', { method: 'HEAD' });
  ok(head.status === 200 && head.headers['x-method'] === 'HEAD' && head.body.length === 0, 'method HEAD is sent as HEAD and answers with no body', head.headers['x-method']);
  ok((await viaHelper('/method')).headers['x-method'] === 'GET', 'GET stays the default');
  ok(await codeOf(viaHelper('/big-head', { method: 'HEAD', maxBytes: 1024 })) === 'resolved:200', 'a HEAD answer naming a large size is not "too large": nothing is sent');
  hits.length = 0;
  ok(await codeOf(viaHelper('/to-metadata', { method: 'HEAD' })) === 'blocked-address' && await codeOf(viaHelper('/to-loopback', { method: 'HEAD' })) === 'bad-url',
    'a HEAD redirected to the metadata service or loopback is refused like a GET');
  ok(!hits.some(function (h) { return /\/secret/.test(h); }), 'and the internal address is never reached', hits.join(', '));

  /* a HEAD answer that names an encoding has no body to decode: it answers (it was "unreachable" for every HEAD to
     Wikipedia, GitHub and ET, found 8 Nov 2026) */
  var gz = await viaHelper('/gz-head', { method: 'HEAD' }).catch(function (e) { return e; });
  ok(gz && gz.status === 200 && gz.body.length === 0, 'a HEAD answered with Content-Encoding: gzip and no body resolves 200, not "unreachable"', gz && (gz.code || gz.status));
  var gzGet = await viaHelper('/gz-head').catch(function (e) { return e; });
  ok(gzGet && gzGet.status === 200 && gzGet.body.toString() === '<p>hi</p>', 'and its GET is still decoded', gzGet && (gzGet.code || gzGet.body.toString()));

  /* headersOnly: the status and headers, nothing of the body read — a large "not found" page is a 404 */
  t0 = Date.now();
  ok(await codeOf(viaHelper('/big404', { headersOnly: true, maxBytes: 1024 })) === 'resolved:404', 'headersOnly: a 404 whose body is declared 50 MB answers 404');
  ok(await codeOf(viaHelper('/big404-chunked', { headersOnly: true, maxBytes: 1024 })) === 'resolved:404', 'headersOnly: a 404 with a 300 KB body sent in chunks answers 404');
  ok(Date.now() - t0 < 2000, 'both promptly, the body never read (' + (Date.now() - t0) + ' ms)');
  var big = await viaHelper('/big404', { maxBytes: 1024 }).catch(function (e) { return e; });
  ok(big instanceof Error && big.code === 'too-large' && big.status === 404, 'without headersOnly, "too large" says the status it came with (404), so a caller never takes it for a working page', big && big.code + ' ' + big.status);
  var bigc = await viaHelper('/big404-chunked', { maxBytes: 1024 }).catch(function (e) { return e; });
  ok(bigc instanceof Error && bigc.code === 'too-large' && bigc.status === 404, 'and so when the body grows past maxBytes as it streams', bigc && bigc.code + ' ' + bigc.status);

  /* redirects: a loop is told from a long chain, and a refused hop says where it led (link-check.js words them) */
  var loop = await viaHelper('/loop').catch(function (e) { return e; });
  ok(loop.code === 'unreachable' && loop.redirects === 'loop', 'a redirect loop says so (redirects: "loop")', loop.redirects);
  var long = await viaHelper('/chain/0').catch(function (e) { return e; });
  ok(long.code === 'unreachable' && long.redirects === 'too-many', 'a chain longer than maxRedirects says "too-many"', long.redirects);
  var hopped = await viaHelper('/to-loopback').catch(function (e) { return e; });
  ok(hopped.code === 'bad-url' && hopped.hops === 1 && hopped.url === 'http://127.0.0.1:' + port + '/secret', 'a refused hop names the address it led to and how many redirects led there', JSON.stringify({ hops: hopped.hops, url: hopped.url }));
  var port8443 = await viaHelper('/to-8443').catch(function (e) { return e; });
  ok(port8443.code === 'bad-url' && port8443.hops === 1 && /:8443\//.test(port8443.url), 'a redirect to another port is refused at the hop, and says where', JSON.stringify({ code: port8443.code, url: port8443.url }));
  var first = await safeFetch('http://127.0.0.1/').catch(function (e) { return e; });
  ok(first.hops === 0, 'the address asked for itself has hops 0', first.hops);

  var err = await safeFetch('http://10.0.0.1/').catch(function (e) { return e; });
  ok(err instanceof Error && err.code === 'blocked-address' && /private or internal/.test(err.message), 'the error says why in words fit to show', err && err.message);

  /* --- the real network: a CDN-hosted https site, connection pinned to the vetted address --- */
  if (process.env.SAFE_FETCH_OFFLINE === '1') {
    console.log('  (skipped the real-network check: SAFE_FETCH_OFFLINE=1)');
  } else {
    var live = await safeFetch('https://cioawards.lovable.app/', { timeoutMs: 20000, accept: 'text/html' }).catch(function (e) { return e; });
    ok(live && live.status === 200 && /<html/i.test(live.body.toString('utf8', 0, 4000)), 'a real https site behind a CDN answers 200 through the pinned connection (certificate and SNI correct)', live && (live.code || live.status) + ' ' + (live.message || ''));
    var wrongHost = await safeFetch('https://expired.badssl.com/', { timeoutMs: 20000 }).catch(function (e) { return e; });
    ok(wrongHost instanceof Error && wrongHost.code === 'unreachable', 'a bad certificate is still refused', wrongHost && (wrongHost.code || wrongHost.status));
  }

  helper.closeAllConnections && helper.closeAllConnections();
  helper.close();
  if (failures.length) {
    console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
    failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
    process.exit(1);
  }
  console.log('safe-fetch: all ' + checks + ' checks passed');
  process.exit(0);
}
run().catch(function (e) { console.error('safe-fetch test crashed: ' + (e && e.stack || e)); process.exit(1); });
