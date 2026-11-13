/* node functions/lib/visit-count.test.js — page views of the live sites (TPL-039) and the events list's QR codes
   (LST-038), through the real router (lib/api.js handleApi) against an in-memory Firestore and Storage:
     - GET /e/<id> carries the visit counter (templates/_shared/rv-visit.js) once, for that event; the team preview
       never does;
     - POST /api/track counts a person's page view per event per day and in all, never a robot's, never for an event
       that is not live; the Dashboard then shows the numbers instead of "Not counted";
     - GET /e/<id>?qr=<tag> counts the scan and sends the visitor on to the page tagged utm_source=<tag>,
       utm_medium=qr, never cached; HEAD, a robot, a prefetch are sent on but not counted; the old ?ag= codes too;
     - the counter in the visitor's browser (rv-visit.js in a sandbox): live pages only, once per page, never in a
       frame, an automated browser or a prerender that is never shown; each internal page shown counts once.
   No network, no real project. Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : '')); }

/* ---------- an in-memory Firestore + Storage, with increments that add up ---------- */
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function isInc(v) { return !!v && typeof v === 'object' && /Increment/i.test((v.constructor && v.constructor.name) || ''); }
function put(obj, key, v, dotted) {
  var keys = dotted ? key.split('.') : [key], o = obj;
  for (var i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  var last = keys[keys.length - 1];
  if (isInc(v)) o[last] = (+o[last] || 0) + v.operand;
  else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some(function (k) { return isInc(v[k]) || (v[k] && typeof v[k] === 'object'); })) {
    if (!o[last] || typeof o[last] !== 'object') o[last] = {};
    Object.keys(v).forEach(function (k) { put(o[last], k, v[k], false); });
  } else o[last] = clone(v);
}
function fakeFb() {
  var docs = {}, files = {}, autoN = 1000;
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } }; }
  function write(p, data, mode) {
    if (mode === 'set') docs[p] = {};
    if (!docs[p]) docs[p] = {};
    Object.keys(data).forEach(function (k) { put(docs[p], k, data[k], mode === 'update'); });
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, data, o && o.merge ? 'merge' : 'set'); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, data, 'update'); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p) {
    var q = { path: p, doc: function (id) { return docRef(p + '/' + (id || 'auto' + (++autoN))); },
      add: function (data) { var r = docRef(p + '/auto' + (++autoN)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; }, where: function () { return q; },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      } };
    return q;
  }
  var db = { collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = { get: function (r) { return r.get(); }, set: function (r, d, o) { write(r.path, d, o && o.merge ? 'merge' : 'set'); return tx; },
        update: function (r, d) { write(r.path, d, 'update'); return tx; }, delete: function (r) { delete docs[r.path]; return tx; } };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, d, o && o.merge ? 'merge' : 'set'); }); },
        update: function (r, d) { ops.push(function () { if (!docs[r.path]) throw new Error('NOT_FOUND'); write(r.path, d, 'update'); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); },
        commit: function () { try { ops.forEach(function (f) { f(); }); return Promise.resolve(); } catch (e) { return Promise.reject(e); } } };
    } };
  var bucket = { name: 'test-bucket', file: function (p) {
    return { name: p,
      save: function (buf) { files[p] = Buffer.from(buf); return Promise.resolve(); }, delete: function () { delete files[p]; return Promise.resolve(); },
      exists: function () { return Promise.resolve([!!files[p]]); },
      download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      getMetadata: function () { return files[p] ? Promise.resolve([{ size: files[p].length, updated: '2026-01-01T00:00:00.000Z' }]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      setMetadata: function () { return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } };
  } };
  var auth = { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files };
}
var FB = fakeFb();
function stub(name, exports) { var id = require.resolve(name); require.cache[id] = { id: id, filename: id, loaded: true, exports: exports }; }
stub('./firebase', { getFirebase: function () { return FB; } });
require('./delivery')._testFetch(function (url, done) { done(null); });
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
process.env.ACCESS_CONFIG_DOC = 'config/test-visit-access';
var api = require('./api');
var hooks = api._testHooks;
var audience = require('./api-audience');
var CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

var ipN = 0;
function call(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = Object.assign({ host: 'localhost', 'user-agent': CHROME, 'x-forwarded-for': '203.0.113.' + ((ipN++ % 200) + 1) }, opts.headers || {});
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    var body = opts.raw != null ? opts.raw : opts.body ? JSON.stringify(opts.body) : '';
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? (Buffer.isBuffer(b) ? b.toString('utf8') : String(b)) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, text: t, body: j, headers: res.headers }); } };
    api.handleApi(req, res);
  });
}
function count(text, needle) { return String(text).split(needle).length - 1; }
function today() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }

var NOW = '2026-11-01T09:00:00.000Z';
var PAGE = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Visits Summit</title>\n</head>\n<body>\n' +
  '<section data-rv-section="hero" id="hero"><h1>Visits Summit</h1><p>Two days.</p></section>\n' +
  '<section data-rv-section="agenda" id="agenda"><h2>Agenda</h2></section>\n' +
  '<script id="rv-site-config" type="application/json" data-rv-runtime>{"eventId":"qa-visits","mode":"live","templateId":"gen-qa-visits","contentMap":[]}</script>\n</body>\n</html>\n';
FB.docs['events/qa-visits'] = { name: 'Visits Summit', createdAt: NOW, published: true, publishedVersion: 1, publishedAt: NOW, templateId: 'gen-qa-visits',
  site: { version: 1, templateId: 'gen-qa-visits' }, counters: { audienceV: 2, registrations: 0, views: 0 } };
FB.files['events/qa-visits/published/index.html'] = Buffer.from(PAGE);
FB.files['events/qa-visits/site/page.html'] = Buffer.from(PAGE);
FB.docs['events/qa-hidden'] = { name: 'Hidden', createdAt: NOW, published: false, templateId: 'gen-qa-hidden', counters: {} };

(async function () {
  var r;
  /* ---------- the counter goes on the live page, and only there ---------- */
  ok(hooks.withVisitCounter('<html><body><p>x</p></body></html>', 'ev-1') === '<html><body><p>x</p><script src="/templates/_shared/rv-visit.js" data-rv-visit="ev-1" defer data-rv-runtime></script>\n</body></html>',
    'withVisitCounter: before </body>, for that event', hooks.withVisitCounter('<html><body><p>x</p></body></html>', 'ev-1'));
  var twice = hooks.withVisitCounter(hooks.withVisitCounter('<body></body>', 'ev-1'), 'ev-1');
  ok(count(twice, 'rv-visit.js') === 1 && hooks.withVisitCounter('<body></body>', 'a"b').indexOf('data-rv-visit="a&quot;b"') !== -1, 'once only; the id written safely');
  ok(audience.VISITS_COUNTED === true, 'visits are counted where rv-visit.js ships');

  r = await call('GET', '/e/qa-visits');
  ok(r.status === 200 && count(r.text, '/templates/_shared/rv-visit.js') === 1 && /rv-visit\.js[^"]*" data-rv-visit="qa-visits"/.test(r.text), 'GET /e/<id>: the live page carries the counter once, for its event', r.status + ' ' + r.text.slice(-400));
  r = await call('GET', '/e/qa-visits');
  ok(r.status === 200 && count(r.text, '/templates/_shared/rv-visit.js') === 1, 'and still once when served from the page cache');
  ok(String(FB.files['events/qa-visits/published/index.html']).indexOf('rv-visit') === -1, 'the stored page is not changed: the counter is put in as the page is served');
  r = await call('GET', '/preview/qa-visits', { token: 'owner' });
  ok(r.text.indexOf('rv-visit.js') === -1 && r.text.indexOf('data-rv-visit') === -1, 'the team preview never carries it', r.status);

  /* ---------- POST /api/track ---------- */
  var beacon = JSON.stringify({ eventId: 'qa-visits', device: 'mobile', ref: 'https://www.google.com/search?q=x' });
  r = await call('POST', '/api/track', { raw: beacon, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
  var day = FB.docs['events/qa-visits/stats/' + today()] || {};
  ok(r.status === 204 && day.views === 1 && day.mobile === 1 && day.ref && day.ref.search === 1 && FB.docs['events/qa-visits'].counters.views === 1,
    'a person\'s page view: 204, counted for the day (by device and kind of source) and in all', [r.status, day, FB.docs['events/qa-visits'].counters]);
  ok(!JSON.stringify(day).match(/google|203\.0\.113|Pixel/i), 'nothing personal kept: no address, no referring page, no browser', day);
  await call('POST', '/api/track', { raw: beacon, headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } });
  await call('POST', '/api/track', { raw: beacon, headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0 Safari/537.36' } });
  await call('POST', '/api/track', { raw: beacon, headers: { 'user-agent': '' } });
  await call('POST', '/api/track', { raw: JSON.stringify({ eventId: 'qa-hidden' }) });
  await call('POST', '/api/track', { raw: JSON.stringify({ eventId: 'import-qa' }) });
  ok(FB.docs['events/qa-visits'].counters.views === 1 && !FB.docs['events/qa-hidden/stats/' + today()], 'a crawler, a headless browser, no browser at all, an event not live: not counted', FB.docs['events/qa-visits'].counters);
  ok(audience.isRobot({ headers: { 'user-agent': 'WhatsApp/2.23.20.0 A' } }) && audience.isRobot({ headers: { 'user-agent': 'facebookexternalhit/1.1' } }) &&
    !audience.isRobot({ headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13; CUBOT X30) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' } }) &&
    !audience.isRobot({ headers: { 'user-agent': CHROME } }), 'link previews are robots; a phone named Cubot and a browser are not');

  /* ---------- the QR codes ---------- */
  r = await call('GET', '/e/qa-visits?qr=Mailer%20Nov');
  ok(r.status === 302 && r.headers.location === '/e/qa-visits?utm_source=mailer-nov&utm_medium=qr' && /no-store/.test(r.headers['cache-control'] || ''),
    'a scan: sent on to the page, tagged as a registration there records it, never cached', [r.status, r.headers]);
  ok(FB.docs['events/qa-visits'].counters.qrScans === 1 && (FB.docs['events/qa-visits/stats/' + today()] || {}).qrScans === 1, 'and counted, for the day and in all', FB.docs['events/qa-visits'].counters);
  r = await call('HEAD', '/e/qa-visits?qr=mailer');
  var r2 = await call('GET', '/e/qa-visits?qr=mailer', { headers: { 'user-agent': 'WhatsApp/2.23.20.0 A' } });
  var r3 = await call('GET', '/e/qa-visits?qr=mailer', { headers: { 'sec-purpose': 'prefetch;prerender' } });
  ok(r.status === 302 && r2.status === 302 && r3.status === 302 && FB.docs['events/qa-visits'].counters.qrScans === 1, 'HEAD, a link preview, a prefetch: sent on, not counted', [r.status, r2.status, r3.status, FB.docs['events/qa-visits'].counters.qrScans]);
  r = await call('GET', '/e/qa-visits?ag=Standee');
  r2 = await call('GET', '/e/qa-visits?qr=1');
  r3 = await call('GET', '/e/qa-visits/agenda?qr=badge&x=1');
  ok(r.headers.location === '/e/qa-visits?utm_source=standee&utm_medium=qr' && r2.headers.location === '/e/qa-visits?utm_source=qr-code&utm_medium=qr' &&
    r3.headers.location === '/e/qa-visits/agenda?x=1&utm_source=badge&utm_medium=qr', 'a code made before (?ag=), a code with no tag, the agenda code with another parameter', [r.headers.location, r2.headers.location, r3.headers.location]);
  ok(FB.docs['events/qa-visits'].counters.qrScans === 4, 'each of those scans counted', FB.docs['events/qa-visits'].counters.qrScans);
  r = await call('GET', '/e/qa-visits?utm_source=mail&qr=x');
  ok(r.headers.location === '/e/qa-visits?utm_source=mail&utm_medium=qr', 'a tag the address already has is kept', r.headers.location);
  r = await call('GET', '/e/qa-hidden?qr=x');
  ok(r.status === 404 && !(FB.docs['events/qa-hidden'].counters || {}).qrScans, 'an event that is not live: 404, nothing counted', r.status);
  r = await call('GET', '/e/qa-visits/agenda');
  ok(r.status === 302 && r.headers.location === '/e/qa-visits#agenda', 'the plain agenda address still opens the agenda (no counting without ?qr=)', [r.status, r.headers.location]);

  /* ---------- what the console reads ---------- */
  r = await call('GET', '/api/event/dashboard-stats?eventId=qa-visits&days=7', { token: 'owner' });
  ok(r.status === 200 && r.body.visitsCounted === true && r.body.visitors === 1 && r.body.qrScans === 5, 'the Dashboard\'s figures: page views counted, and the QR scans', r.status + ' ' + r.text.slice(0, 300));
  var dash = fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event-dashboard.js'), 'utf8');
  ok(/QR code scans/.test(dash) && /visitsCounted === true/.test(dash), 'the Dashboard shows them where it said visits were not counted');

  /* ---------- rv-visit.js in a visitor's browser ---------- */
  var SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', '_shared', 'rv-visit.js'), 'utf8');
  function browser(o) {
    o = o || {};
    var sent = [], listeners = {};
    var cfgText = o.cfg === null ? null : JSON.stringify(Object.assign({ eventId: 'qa-visits', mode: 'live' }, o.cfg || {}));
    var doc = {
      currentScript: { getAttribute: function (k) { return k === 'data-rv-visit' ? (o.id || 'qa-visits') : null; } },
      getElementById: function (id) { return id === 'rv-site-config' && cfgText != null ? { textContent: cfgText } : null; },
      documentElement: { getAttribute: function (k) { return k === 'data-rv-current-page' ? (o.page || null) : null; } },
      visibilityState: o.visibility || 'visible', referrer: 'https://www.linkedin.com/feed/',
      addEventListener: function (t, f) { (listeners[t] = listeners[t] || []).push(f); },
      removeEventListener: function (t, f) { listeners[t] = (listeners[t] || []).filter(function (g) { return g !== f; }); }
    };
    var win = { document: doc, screen: { width: 390 }, innerWidth: 390, location: { pathname: '/e/qa-visits' },
      navigator: { userAgent: o.ua || CHROME, webdriver: !!o.webdriver, sendBeacon: function (url, blob) { sent.push({ url: url, blob: blob }); return true; } },
      Blob: function (parts, opts) { this.text = parts.join(''); this.type = opts.type; }, JSON: JSON };
    win.top = o.framed ? {} : win; win.self = win; win.window = win;
    vm.createContext(win);
    vm.runInContext(SRC, win);
    return { sent: sent, fire: function (t, e) { (listeners[t] || []).slice().forEach(function (f) { f(e || {}); }); }, doc: doc };
  }
  var b = browser();
  var payload = b.sent[0] ? JSON.parse(b.sent[0].blob.text) : {};
  ok(b.sent.length === 1 && b.sent[0].url === '/api/track' && payload.eventId === 'qa-visits' && payload.device === 'mobile' && /text\/plain/.test(b.sent[0].blob.type) &&
    Object.keys(payload).sort().join() === 'device,eventId,ref', 'a live page: one beacon, the event, the kind of screen and the referrer only', [b.sent.length, payload]);
  ok(browser({ cfg: { mode: 'preview' } }).sent.length === 0 && browser({ cfg: { shared: true } }).sent.length === 0 && browser({ cfg: { eventId: 'other' } }).sent.length === 0,
    'a preview, a shared link, another event\'s settings: nothing sent');
  ok(browser({ framed: true }).sent.length === 0 && browser({ webdriver: true }).sent.length === 0 && browser({ ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }).sent.length === 0 &&
    browser({ id: 'Bad Id' }).sent.length === 0, 'in a frame, an automated browser, a crawler, a bad id: nothing sent');
  var pre = browser({ visibility: 'prerender' });
  ok(pre.sent.length === 0, 'prerendered: nothing yet');
  pre.doc.visibilityState = 'visible'; pre.fire('visibilitychange');
  ok(pre.sent.length === 1, 'counted once it is shown');
  var multi = browser({ page: 'home' });
  multi.fire('rv:pagechange', { detail: { page: 'agenda' } });
  multi.fire('rv:pagechange', { detail: { page: 'agenda' } });
  multi.fire('rv:pagechange', { detail: { page: 'home' } });
  ok(multi.sent.length === 2, 'internal pages: each page shown counts once', multi.sent.length);

  if (failures.length) { console.error('visit-count: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('visit-count: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.error('visit-count: the run stopped — ' + (err && err.stack || err)); process.exit(1); });
