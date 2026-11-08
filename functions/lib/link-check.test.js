/* node functions/lib/link-check.test.js — exits 1 on the first failure it lists.
   The check before Publish asks other sites whether a link or a picture is there (lib/link-check.js). Here every
   question goes through the REAL safe-fetch.js, to a stub of other sites on 127.0.0.1: a made-up public name that
   the stub resolver answers with a public address, whose connection the test-only _connectTo points at the stub.

   WHY (the browser check of 8 Nov 2026): dead links on ET's own site and on GitHub were reported as working. Their
   "not found" pages are over 64 KB, and "too large" was read as "it answered, so it works"; and every HEAD came back
   "unreachable", because a HEAD answer that names its encoding (Wikipedia, GitHub and ET all do) was passed to
   gunzip with no body. A redirect loop, or one to another port, was "broken" where a link naming that port outright
   was "not checked". And a check asked about 40 links plus 40 pictures, where about 40 in all was asked for. */
'use strict';
const http = require('http');
const LC = require('./link-check');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }

var BIG = Buffer.alloc(200 * 1024, 120);
var asked = [];
var stub = http.createServer(function (req, res) {
  asked.push(req.method + ' ' + req.url);
  var u = req.url, head = req.method === 'HEAD';
  function send(status, headers, body) { res.writeHead(status, headers || {}); res.end(head ? undefined : body); }
  if (u === '/fine') return send(200, { 'Content-Type': 'text/html' }, 'ok');
  /* Wikipedia, GitHub and ET: a HEAD answer naming gzip and the size a GET would get */
  if (u === '/gz-ok') return head ? send(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': 9000 }) : send(200, { 'Content-Type': 'text/html' }, 'ok');
  if (u === '/gz-404') return head ? send(404, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': 90000 }) : send(404, { 'Content-Type': 'text/html' }, BIG);
  /* a large "not found" page, its size declared or not */
  if (u === '/big404-len') return send(404, { 'Content-Type': 'text/html', 'Content-Length': BIG.length }, BIG);
  if (u === '/big404-chunked') return send(404, { 'Content-Type': 'text/html' }, BIG);
  if (u === '/big410') return send(410, { 'Content-Type': 'text/html' }, BIG);
  /* HEAD refused (405), GET decides */
  if (u === '/nohead-big404') return head ? send(405) : send(404, { 'Content-Type': 'text/html' }, BIG);
  if (u === '/nohead-big200') return head ? send(405) : send(200, { 'Content-Type': 'text/html', 'Content-Length': BIG.length }, BIG);
  if (u === '/pic.jpg') return send(200, { 'Content-Type': 'image/jpeg' }, 'jpg');
  if (u === '/pic-is-page.jpg') return head ? send(405) : send(200, { 'Content-Type': 'text/html', 'Content-Length': BIG.length }, BIG);
  if (u === '/forbidden') return send(403, { 'Content-Type': 'text/html' }, 'no');
  if (u === '/error') return send(503, { 'Content-Type': 'text/html' }, 'down');
  if (u === '/loop') { res.writeHead(302, { Location: '/loop' }); return res.end(); }
  var chain = /^\/chain\/(\d+)$/.exec(u);
  if (chain) { res.writeHead(302, { Location: '/chain/' + (+chain[1] + 1) }); return res.end(); }
  if (u === '/to-fine') { res.writeHead(301, { Location: '/fine' }); return res.end(); }
  if (u === '/to-8443') { res.writeHead(301, { Location: 'https://public.example:8443/x' }); return res.end(); }
  if (u === '/to-ftp') { res.writeHead(301, { Location: 'ftp://public.example/file' }); return res.end(); }
  if (u === '/to-metadata') { res.writeHead(302, { Location: 'http://169.254.169.254/computeMetadata/v1/' }); return res.end(); }
  if (u === '/to-loopback') { res.writeHead(302, { Location: 'http://127.0.0.1:' + stub.address().port + '/secret' }); return res.end(); }
  if (u === '/secret') return send(200, { 'Content-Type': 'text/plain' }, 'INTERNAL');
  send(404, { 'Content-Type': 'text/html' }, 'no');
});

function at(p) { return 'http://public.example' + p; }

async function run() {
  await new Promise(function (r) { stub.listen(0, '127.0.0.1', r); });
  var fo = {
    lookup: function (h, o, cb) { cb(null, [{ address: '93.184.216.34', family: 4 }]); },
    _connectTo: function () { return { address: '127.0.0.1', port: stub.address().port }; }
  };
  function probe(p, kind) { return LC.probe(at(p), kind || 'link', null, fo); }

  /* ---- 1. a page that is not there is broken, however large its "not found" page ---- */
  var r = await probe('/big404-len');
  ok(r.state === 'broken' && r.status === 404, 'a 404 whose 200 KB page declares its length is broken (it was "ok 200")', r);
  r = await probe('/big404-chunked');
  ok(r.state === 'broken' && r.status === 404, 'a 404 whose 200 KB page is sent in chunks is broken', r);
  r = await probe('/big410');
  ok(r.state === 'broken' && r.status === 410, 'a 410 with a large page is broken', r);
  asked.length = 0;
  r = await probe('/nohead-big404');
  ok(r.state === 'broken' && r.status === 404 && asked.join() === 'HEAD /nohead-big404,GET /nohead-big404', 'HEAD refused (405), the GET\'s large 404 decides: broken', { r: r, asked: asked });
  r = await probe('/nohead-big200');
  ok(r.state === 'ok' && r.status === 200, 'HEAD refused, a GET answering 200 with a large page: it works', r);

  /* ---- 2. HEAD answers, even naming an encoding: no GET, nothing downloaded ---- */
  asked.length = 0;
  r = await probe('/gz-ok');
  ok(r.state === 'ok' && asked.join() === 'HEAD /gz-ok', 'a HEAD answered 200 with Content-Encoding: gzip works, and no GET is made (HEAD was always "unreachable")', { r: r, asked: asked });
  asked.length = 0;
  r = await probe('/gz-404');
  ok(r.state === 'broken' && r.status === 404 && asked.join() === 'HEAD /gz-404,GET /gz-404', 'a HEAD 404 is asked once more with GET (some sites answer HEAD wrongly), whose large 404 is broken', { r: r, asked: asked });
  r = await probe('/to-fine');
  ok(r.state === 'ok', 'a redirect to a page that is there works', r);

  /* ---- 3. pictures ---- */
  r = await probe('/pic.jpg', 'picture');
  ok(r.state === 'ok', 'a picture answering image/jpeg is there', r);
  r = await probe('/pic-is-page.jpg', 'picture');
  ok(r.state === 'broken' && /web page, not a picture/.test(r.why), 'a picture address answering a large web page shows nothing: broken', r);

  /* ---- 4. what a site will not say is "could not be checked", never "broken" ---- */
  r = await probe('/forbidden');
  ok(r.state === 'unknown' && r.status === 403, 'a 403 is "could not be checked"', r);
  r = await probe('/error');
  ok(r.state === 'unknown' && r.status === 503, 'a server error is "could not be checked"', r);
  r = await probe('/loop');
  ok(r.state === 'unknown' && /circle of redirects/.test(r.why), 'a redirect loop is "not checked" (a browser keeping the site\'s cookie may get through), not "broken"', r);
  r = await probe('/chain/0');
  ok(r.state === 'unknown' && /redirects more than 5 times/.test(r.why), 'a chain of more than 5 redirects is "not checked"', r);
  r = await probe('/to-8443');
  var direct = await LC.probe('https://public.example:8443/x', 'link', null, fo);
  ok(r.state === 'unknown' && /leads on to port 8443/.test(r.why) && direct.state === 'unknown' && /uses port 8443/.test(direct.why),
    'a redirect to another port is "not checked", as a link naming that port is', { redirect: r, direct: direct });
  r = await probe('/to-ftp');
  ok(r.state === 'unknown' && /not a web page \(ftp\)/.test(r.why), 'a redirect to an address that is not a web page is "not checked"', r);

  /* ---- 5. never inside our own network, even after a redirect ---- */
  asked.length = 0;
  r = await probe('/to-metadata');
  ok(r.state === 'broken' && /private or internal/.test(r.why), 'a redirect to the metadata address is broken for a visitor, and refused', r);
  r = await probe('/to-loopback');
  ok(r.state === 'broken' && /private or internal/.test(r.why), 'a redirect to loopback on another port is broken for a visitor, and refused', r);
  ok(!asked.some(function (a) { return /secret/.test(a); }), 'the internal address is never asked', asked);
  r = await LC.probe('http://169.254.169.254/latest/meta-data/', 'link', null, fo);
  ok(r.state === 'broken' && /private or internal/.test(r.why), 'a link naming the metadata address is broken, asked nothing', r);

  /* ---- 6. about 40 addresses a check, links and pictures together ---- */
  function sh(l, p, m) { var x = LC.share(l, p, m); return x.links + '/' + x.pictures; }
  ok(LC.MAX_PER_CHECK === 40, 'at most 40 a check');
  ok(sh(10, 10, 40) === '10/10' && sh(60, 60, 40) === '20/20' && sh(60, 5, 40) === '35/5' && sh(5, 60, 40) === '5/35' && sh(0, 0, 40) === '0/0' && sh(3, 3, 0) === '0/0' && sh(50, 50, 41) === '20/21',
    'share: half each, what one kind leaves goes to the other, never more than the most in all',
    [sh(10, 10, 40), sh(60, 60, 40), sh(60, 5, 40), sh(5, 60, 40), sh(0, 0, 40), sh(3, 3, 0), sh(50, 50, 41)]);
  LC._reset();
  asked.length = 0;
  var none = await LC.check([{ url: at('/fine') }, { url: at('/gz-ok') }], { key: 't0', kind: 'link', max: 0, waitMs: 2000, fetchOptions: fo });
  ok(none.results.length === 0 && none.skipped === 2 && asked.length === 0, 'max 0 asks about none, and counts them as not checked', { none: none, asked: asked });
  var some = await LC.check([{ url: at('/fine') }, { url: at('/big404-len') }, { url: at('/gz-ok') }], { key: 't1', kind: 'link', max: 2, waitMs: 4000, fetchOptions: fo });
  ok(some.results.length === 2 && some.skipped === 1 && some.results[1].state === 'broken', 'max 2 asks about the first two, in order', some);

  stub.closeAllConnections && stub.closeAllConnections();
  stub.close();
  if (failures.length) {
    console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
    failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
    process.exit(1);
  }
  console.log('link-check: all ' + checks + ' checks passed');
  process.exit(0);
}
run().catch(function (e) { console.error('link-check test crashed: ' + (e && e.stack || e)); process.exit(1); });
