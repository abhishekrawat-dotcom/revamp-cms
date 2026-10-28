/* node functions/lib/promo-phase2-integration.test.js — Promotions phase 2 end to end, every real module together:
   a mailer exported through lib/promo-mailer.js gets its pixel and signed links from the engine
   (vendor/promo-engine.js) and its send recorded by lib/promo-track.js; the recipient's pixel and click reach
   promo-track through lib/api.js's routing, and the counts come back on both dashboards in the shape the studio's
   copied dashboard code reads. Only Firebase (an in-memory Firestore and sign-in) and lib/promo.js (an event's kit,
   which reads the web) are stand-ins. No network. Exits 1 on any failure. */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/* a deployed instance (K_SERVICE) with a throwaway key and an https tracking address: every event is tracked */
process.env.TRACK_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.TRACK_SECRET_PREVIOUS;
process.env.MAILER_TRACK_BASE = 'https://track.example';
process.env.K_SERVICE = 'test';
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

var ROOT = path.resolve(__dirname, '..', '..');
var passed = 0, failed = 0;
var realError = console.error.bind(console), LOGS = [];
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; realError('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
console.error = function () { LOGS.push([].slice.call(arguments).join(' ')); };

/* ---------- Firestore in memory: documents by path, with what these modules ask of it ---------- */
var DOCS = {};
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function segmentsOf(f) { return typeof f === 'string' ? f.split('.') : f.segments; }
/* select() / fieldMask: only the fields asked for, a FieldPath('days', d) reaching into the map */
function project(d, fields) {
  var out = {};
  fields.forEach(function (f) {
    var s = segmentsOf(f), v = d;
    for (var i = 0; i < s.length; i++) { if (v == null || typeof v !== 'object' || !(s[i] in v)) return; v = v[s[i]]; }
    var o = out;
    for (var j = 0; j < s.length - 1; j++) o = o[s[j]] = o[s[j]] || {};
    o[s[s.length - 1]] = clone(v);
  });
  return out;
}
function snapOf(p, fields) {
  var d = DOCS[p];
  return { id: p.split('/').pop(), exists: !!d, ref: refOf(p), data: function () { return d ? (fields ? project(d, fields) : clone(d)) : undefined; } };
}
function refOf(p) {
  return {
    id: p.split('/').pop(), path: p,
    get: function () { return Promise.resolve(snapOf(p)); },
    collection: function (sub) { return queryOf(p + '/' + sub, []); },
    /* update(FieldPath, FieldValue.increment(n), …): a missing document is NOT_FOUND (gRPC 5), as Firestore says */
    update: function () {
      var a = [].slice.call(arguments);
      if (!DOCS[p]) return Promise.reject(Object.assign(new Error('NOT_FOUND'), { code: 5 }));
      for (var i = 0; i < a.length; i += 2) {
        var s = segmentsOf(a[i]), o = DOCS[p];
        for (var j = 0; j < s.length - 1; j++) o = o[s[j]] = o[s[j]] || {};
        o[s[s.length - 1]] = (o[s[s.length - 1]] || 0) + a[i + 1].operand;
      }
      return Promise.resolve();
    }
  };
}
function queryOf(col, filters, fields) {
  function rows() {
    return Object.keys(DOCS).filter(function (k) {
      return k.indexOf(col + '/') === 0 && k.split('/').length === col.split('/').length + 1 &&
        filters.every(function (f) { return DOCS[k][f[0]] === f[1]; });
    }).sort().map(function (k) { return snapOf(k, fields); });
  }
  return {
    doc: function (id) { return refOf(col + '/' + id); },
    where: function (f, op, v) { if (op !== '==') throw new Error('fake: only == here'); return queryOf(col, filters.concat([[f, v]]), fields); },
    select: function () { return queryOf(col, filters, [].slice.call(arguments)); },
    get: function () { var l = rows(); return Promise.resolve({ docs: l, size: l.length, empty: !l.length }); }
  };
}
var COMMITS = 0;
var FB = {
  db: {
    collection: function (name) { return queryOf(name, []); },
    getAll: function () {
      var a = [].slice.call(arguments), o = a.length && !a[a.length - 1].path ? a.pop() : null;
      return Promise.resolve(a.map(function (r) { return snapOf(r.path, o && o.fieldMask); }));
    },
    batch: function () {
      var ops = [];
      return {
        create: function (r, d) { ops.push([r.path, d]); },
        commit: function () {
          if (ops.some(function (x) { return DOCS[x[0]]; })) return Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }));
          ops.forEach(function (x) { DOCS[x[0]] = clone(x[1]); });
          COMMITS++;
          return Promise.resolve();
        }
      };
    }
  },
  /* a token is the account's name: "maker" signs in as maker@timesinternet.in with Google */
  auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };

/* lib/promo.js builds an event's kit from its site and the web (fonts, the logo): here, a fixed kit */
var KIT = {
  event: { id: 'demo-ev', name: 'Demo Summit 2027', start: '2027-09-10T09:00', end: '2027-09-11T18:00', venue: 'Shangri-La Eros', city: 'New Delhi',
    description: 'Hospital chiefs and clinicians meet on access and quality.', siteUrl: 'https://cms.example/e/demo-ev', registerUrl: 'https://cms.example/e/demo-ev#register',
    hashtag: '#DemoSummit27' },
  brand: { mode: 'light', colours: { theme: '#8f6118' }, portal: { slug: 'health' } },
  content: {
    speakers: [{ id: 's1', name: 'Asha Rao', designation: 'CEO', company: 'City Hospital', photoUrl: 'https://img.etb2bimg.com/files/a.jpg', group: 'Keynote' }],
    partners: [{ id: 'p1', name: 'Medtronic', logoUrl: 'https://img.etb2bimg.com/files/m.png', tier: 'Gold Partner', url: 'https://medtronic.com/?a=1&b=2' }],
    sessions: [], audience: ['Hospital CEOs'], topics: ['Access'], stats: []
  }
};
var PROMO = require.resolve('./promo');
require.cache[PROMO] = { id: PROMO, filename: PROMO, loaded: true, children: [], paths: [], exports: {
  wire: function () {},
  buildKit: function () { return Promise.resolve(clone(KIT)); }
} };

const api = require('./api');
const access = require('./access');
const engine = require('./vendor/promo-engine');
const track = require('./promo-track');
const pm = require('./promo-mailer')._test;

var CREATED = '2026-10-01T00:00:00.000Z';
DOCS['events/demo-ev'] = { name: 'Demo Summit 2027', createdAt: CREATED, category: 'ip' };
var CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/* one request through api.handleApi, as server.js hands it over: { status, headers, body (Buffer | undefined), text, json } */
function call(method, url, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var h = { host: 'cms.example', 'user-agent': o.ua || CHROME };
    if (o.token) h.authorization = 'Bearer ' + o.token;
    if (o.body) h['content-type'] = 'application/json';
    var req = { method: method, url: url, headers: h, socket: {}, rawBody: Buffer.from(o.body ? JSON.stringify(o.body) : '') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, hh) { res.statusCode = s; Object.keys(hh || {}).forEach(function (k) { res.headers[k.toLowerCase()] = hh[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) {
        var buf = b === undefined ? undefined : Buffer.isBuffer(b) ? b : Buffer.from(String(b)), text = buf ? buf.toString('utf8') : '', json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text: text, json: json });
      } };
    api.handleApi(req, res);
  });
}
function sendIds() { return Object.keys(DOCS).filter(function (k) { return k.indexOf('promoSends/') === 0; }).map(function (k) { return k.split('/')[1]; }); }
function pixelIds(h) { var re = /<img src="https:\/\/track\.example\/t\/o\/([A-Za-z0-9_-]{12})\.gif"/g, out = [], m; while ((m = re.exec(String(h)))) out.push(m[1]); return out; }
/* each href as written in the mail, entities left as they are */
function rawHrefs(h) { return (String(h).match(/href="[^"]*"/g) || []).map(function (a) { return a.slice(6, -1); }); }
/* a link as the recipient's mail client asks for it: the attribute's &amp; read back */
function pathOf(href) { var u = new URL(href.replace(/&amp;/g, '&')); return u.pathname + u.search; }

var HUMAN_DAY = track._test.dayKey(Date.now());

(async function () {
  /* ======== 1. an export: real deliverables(), real engine, real recordSends ======== */
  var ev = pm.entityOf('demo-ev', clone(KIT), DOCS['events/demo-ev'], 'https://cms.example', null);
  var doc = engine.buildDoc(engine.getMailer('mailer.announcement'), ev, {});
  doc.trackLinks = 'yes'; doc.mailerId = "x'y";
  var plain = engine.renderDoc(doc, ev);
  var got = { ev: ev, stored: DOCS['events/demo-ev'] };
  var r = await pm.deliverables(FB, { email: 'maker@timesinternet.in' }, got, 'demo-ev', [{ doc: doc, mailerId: "x'y", save: null }]);
  var html = r.html[0], ids = sendIds(), px = pixelIds(html);
  check('1: the export went out tracked', r.tracked === true && r.html.length === 1);
  check('1: exactly one open pixel, on the tracking address', px.length === 1 && (html.match(/\/t\/o\//g) || []).length === 1, px);
  check('1: one promoSends doc, the pixel\'s id', ids.length === 1 && ids[0] === px[0], ids);
  var ID = ids[0], row = DOCS['promoSends/' + ID] || {};
  check('1: the junk mailer id x\'y is stored as \'\'', row.mailerId === '', row.mailerId);
  check('1: the send is stamped with the event and its createdAt, counters at zero', row.eventId === 'demo-ev' && row.eventCreatedAt === CREATED &&
    row.opens === 0 && row.clicks === 0 && row.botOpens === 0 && row.botClicks === 0 && JSON.stringify(row.days) === '{}', row);
  check('1: who exported is kept for audit', row.by === 'maker@timesinternet.in', row.by);
  var clicks = rawHrefs(html).filter(function (h) { return h.indexOf('https://track.example/t/c/') === 0; });
  check('1: links rewritten through the click route', clicks.length >= 1, clicks.length);
  /* engine (Unit A) and export (Unit D) agree: every http(s) link left as written is one trackTarget refuses */
  var leftAlone = rawHrefs(html).filter(function (h) { return /^\s*https?:/i.test(h) && h.indexOf('https://track.example/t/') !== 0; });
  check('1: every http(s) link not rewritten is one the engine leaves alone on purpose', leftAlone.every(function (h) { return engine.trackTarget(h) === ''; }), leftAlone);
  check('1: the plain mail had those links (the rewrite really happened)', rawHrefs(plain).filter(function (h) { return engine.trackTarget(h) !== ''; }).length === clicks.length,
    [rawHrefs(plain).filter(function (h) { return engine.trackTarget(h) !== ''; }).length, clicks.length]);

  /* the addresses the engine writes are the ones the sign-in gate lets through and api.js routes (Units A and C) */
  var pixelPath = '/t/o/' + ID + '.gif', clickPath = pathOf(clicks[0]);
  check('1: the pixel and click paths are public at the gate', access.isPublic({ method: 'GET', headers: {} }, pixelPath) && access.isPublic({ method: 'GET', headers: {} }, clickPath.split('?')[0]));
  check('1: the click link carries one u and an s', new URLSearchParams(clickPath.split('?')[1]).getAll('u').length === 1 && /^[A-Za-z0-9_-]{16}$/.test(new URLSearchParams(clickPath.split('?')[1]).get('s') || ''));

  /* ======== 2. the recipient: pixels and a click through api.handleApi ======== */
  var o1 = await call('GET', pixelPath);
  check('2: a Chrome pixel is the 42-byte GIF, never cached', o1.status === 200 && o1.headers['content-type'] === 'image/gif' && o1.body && o1.body.length === 42 &&
    /no-store/.test(o1.headers['cache-control'] || ''), [o1.status, o1.headers]);
  check('2: the first hit confirmed the send and wrote its open', DOCS['promoSends/' + ID].opens === 1, DOCS['promoSends/' + ID].opens);
  /* the next hits fall inside the 1 s write spacing: curl carries the next write, HEAD and the click join it and
     are answered at once; flushAll then writes them without waiting (what server.js does on SIGTERM) */
  var o2p = call('GET', pixelPath, { ua: 'curl/8.4.0' });
  var o3 = await call('HEAD', pixelPath);
  check('2: a HEAD pixel is 200 with no body', o3.status === 200 && o3.body === undefined && o3.headers['content-type'] === 'image/gif', [o3.status, o3.body && o3.body.length]);
  var c1 = await call('GET', clickPath);
  var target = new URLSearchParams(clickPath.split('?')[1]).get('u');
  check('2: a Chrome click redirects 302 to its own target', c1.status === 302 && c1.headers.location === track._test.encodeUrl(target) && !!target, [c1.status, c1.headers.location, target]);
  check('2: the target is the link as the mail had it, entities read', target === engine.trackTarget(rawHrefs(plain).filter(function (h) { return engine.trackTarget(h) !== ''; })[0]), target);
  var q = new URLSearchParams(clickPath.split('?')[1]);
  var u = q.get('u'), at = u.length - 1, changed = u.slice(0, at) + (u[at] === 'x' ? 'y' : 'x');
  var c2 = await call('GET', clickPath.split('?')[0] + '?u=' + encodeURIComponent(changed) + '&s=' + q.get('s'));
  check('2: one character of u changed is 400 bad link', c2.status === 400 && c2.text === 'bad link', [c2.status, c2.text]);
  var c3 = await call('GET', clickPath.split('?')[0] + '?u=' + encodeURIComponent('javascript:alert(1)') + '&s=' + q.get('s'));
  check('2: a javascript: target is 400', c3.status === 400, c3.status);

  /* ======== 3. flushAll ======== */
  await track.flushAll(1000);
  var o2 = await o2p;
  check('2: a curl pixel is still the GIF', o2.status === 200 && o2.body && o2.body.length === 42, o2.status);
  var after = DOCS['promoSends/' + ID];
  check('3: the counts are written: 1 open, 1 click, 2 automated opens, 0 automated clicks',
    after.opens === 1 && after.clicks === 1 && after.botOpens === 2 && after.botClicks === 0, after);
  check('3: today (India time) holds the human open and click', after.days[HUMAN_DAY] && after.days[HUMAN_DAY].o === 1 && after.days[HUMAN_DAY].c === 1, after.days);

  /* a send id nobody made: the GIF, and no document appears */
  var rnd = await call('GET', '/t/o/ZZZZZZZZZZZZ.gif');
  await track.flushAll(1000);
  check('2: an unknown id still gets the GIF and creates nothing', rnd.status === 200 && rnd.body.length === 42 && !DOCS['promoSends/ZZZZZZZZZZZZ']);

  /* ======== 4. the event's dashboard ======== */
  var a = await call('GET', '/api/promo/analytics?eventId=demo-ev', { token: 'maker' });
  var j = a.json || {};
  check('4: 200 from the real route', a.status === 200, [a.status, a.text.slice(0, 200)]);
  check('4: backend firestore, available', j.backend === 'firestore' && j.available === true, [j.backend, j.available]);
  check('4: totals {sends:1, opens:1, clicks:1}', JSON.stringify(j.totals) === JSON.stringify({ sends: 1, opens: 1, clicks: 1 }), j.totals);
  check('4: filtered {opens:2, clicks:0}', JSON.stringify(j.filtered) === JSON.stringify({ opens: 2, clicks: 0 }), j.filtered);
  var last = (j.series || [])[(j.series || []).length - 1] || {};
  check('4: the last series entry is today {opens:1, clicks:1}', last.date === HUMAN_DAY && last.opens === 1 && last.clicks === 1, last);
  check('4: sends[0] is this send', j.sends && j.sends[0] && j.sends[0].id === ID && j.sends[0].event === 'demo-ev', j.sends && j.sends[0]);
  check('4: Cache-Control no-store', /no-store/.test(a.headers['cache-control'] || ''));

  /* the shape the copied dashboard (paintAnalytics) reads — contract C7, field for field */
  var TOP = ['available', 'backend', 'series', 'totals', 'filtered', 'sends', 'topOpenedTemplates', 'topOpenedSubjects', 'topClickedTemplates', 'topClickedSubjects', 'versions'];
  var SEND = ['id', 'portal', 'event', 'eventName', 'mailerId', 'mailerLabel', 'subject', 'saveId', 'saveName', 'createdAt', 'opens', 'clicks', 'sends', 'botOpens', 'botClicks'];
  function sameKeys(o, want) { return !!o && Object.keys(o).sort().join() === want.slice().sort().join(); }
  check('C7: the top-level keys', sameKeys(j, TOP), Object.keys(j));
  check('C7: a send row\'s keys (never `by`)', sameKeys(j.sends && j.sends[0], SEND), j.sends && j.sends[0] && Object.keys(j.sends[0]));
  check('C7: 30 days, oldest first, each {date, opens, clicks}', Array.isArray(j.series) && j.series.length === 30 &&
    j.series.every(function (d, i) { return sameKeys(d, ['date', 'opens', 'clicks']) && (i === 0 || d.date > j.series[i - 1].date); }));
  ['topOpenedTemplates', 'topOpenedSubjects', 'topClickedTemplates', 'topClickedSubjects'].forEach(function (k) {
    check('C7: ' + k + ' is a list of {key, label, sends, opens, clicks}', Array.isArray(j[k]) && j[k].every(function (x) { return sameKeys(x, ['key', 'label', 'sends', 'opens', 'clicks']); }), j[k]);
  });
  check('C7: versions is an object', j.versions && typeof j.versions === 'object' && !Array.isArray(j.versions));
  check('C7: a send with mailer id \'\' is in no template ranking', j.topOpenedTemplates.length === 0 && j.topOpenedSubjects.length === 1, [j.topOpenedTemplates, j.topOpenedSubjects]);

  /* ======== 5. signed out ======== */
  var na = await call('GET', '/api/promo/analytics?eventId=demo-ev');
  check('5: no token is 401', na.status === 401, na.status);
  var naAll = await call('GET', '/api/promo/analytics/all');
  check('5: the team view without a token is 401', naAll.status === 401, naAll.status);

  /* ======== 6. the pixel api.js keeps is promo-track's ======== */
  check('6: api._testHooks.TRACK_PIXEL equals promo-track _test.PIXEL', Buffer.isBuffer(api._testHooks.TRACK_PIXEL) && api._testHooks.TRACK_PIXEL.equals(track._test.PIXEL));

  /* ======== more: the routes the studio uses, with the real modules behind them ======== */
  /* the catalog says tracking is on for this event, so the studio shows "Link tracking" */
  var cat = await call('GET', '/api/promo/mailers?eventId=demo-ev', { token: 'maker' });
  check('catalog: tracking true on a deployed instance', cat.status === 200 && cat.json && cat.json.tracking === true, [cat.status, cat.json && cat.json.tracking, LOGS.slice(-2)]);
  delete process.env.K_SERVICE;
  var catQa = await call('GET', '/api/promo/mailers?eventId=demo-ev', { token: 'maker' });
  check('catalog: tracking false for a real event on a local server', catQa.status === 200 && catQa.json && catQa.json.tracking === false, catQa.json && catQa.json.tracking);
  var dlLocal = await call('POST', '/api/promo/mailer/download', { token: 'maker', body: { eventId: 'demo-ev', doc: doc } });
  check('download on a local server: a real event goes out plain and says so', dlLocal.status === 200 && dlLocal.headers['x-mailer-tracked'] === 'no' &&
    dlLocal.text.indexOf('/t/o/') === -1 && sendIds().length === 1, [dlLocal.status, dlLocal.headers['x-mailer-tracked'], sendIds().length]);
  process.env.K_SERVICE = 'test';

  var before = sendIds().length;
  var dl = await call('POST', '/api/promo/mailer/download', { token: 'maker', body: { eventId: 'demo-ev', doc: doc, saveId: 'sv1', saveName: 'Launch v2' } });
  var dlIds = pixelIds(dl.text);
  check('download: X-Mailer-Tracked yes, no-store, one pixel', dl.status === 200 && dl.headers['x-mailer-tracked'] === 'yes' && dl.headers['cache-control'] === 'no-store' && dlIds.length === 1,
    [dl.status, dl.headers['x-mailer-tracked'], dlIds.length]);
  check('download: its send recorded with the version', sendIds().length === before + 1 && DOCS['promoSends/' + dlIds[0]] && DOCS['promoSends/' + dlIds[0]].saveId === 'sv1' &&
    DOCS['promoSends/' + dlIds[0]].saveName === 'Launch v2');
  var tst = await call('POST', '/api/promo/mailer/download', { token: 'maker', body: { eventId: 'demo-ev', doc: doc, test: true } });
  check('download test:true: no pixel, no header, nothing recorded', tst.status === 200 && tst.text.indexOf('/t/o/') === -1 && tst.headers['x-mailer-tracked'] === undefined &&
    sendIds().length === before + 1);
  var cp = await call('POST', '/api/promo/mailer/render', { token: 'maker', body: { eventId: 'demo-ev', doc: doc, editor: false, track: true } });
  check('render track:true (Copy HTML): tracked, one pixel, one more send', cp.status === 200 && cp.json && cp.json.tracked === true && pixelIds(cp.json.html).length === 1 &&
    sendIds().length === before + 2, [cp.status, cp.json && cp.json.tracked, sendIds().length]);
  var pv = await call('POST', '/api/promo/mailer/render', { token: 'maker', body: { eventId: 'demo-ev', doc: doc, editor: true } });
  check('render editor:true: untracked, no tracked key', pv.status === 200 && pv.json && !('tracked' in pv.json) && pv.json.html.indexOf('/t/o/') === -1 && sendIds().length === before + 2);
  var commitsBefore = COMMITS;
  var zip = await call('POST', '/api/promo/mailer/download', { token: 'maker', body: { eventId: 'demo-ev', mailerIds: [] } });
  var JSZip = require('jszip'), z = zip.status === 200 ? await JSZip.loadAsync(zip.body) : null;
  var files = z ? Object.keys(z.files).filter(function (n) { return /\.html$/.test(n); }) : [];
  var zipPixels = 0;
  for (var i = 0; i < files.length; i++) zipPixels += pixelIds(await z.file(files[i]).async('string')).length;
  check('download all: a zip, tracked, one pixel per file', zip.status === 200 && zip.headers['content-type'] === 'application/zip' && zip.headers['x-mailer-tracked'] === 'yes' &&
    files.length >= 1 && zipPixels === files.length, [zip.status, zip.headers['content-type'], files.length, zipPixels]);
  check('download all: one send per file, in one write', sendIds().length === before + 2 + files.length && COMMITS === commitsBefore + 1, [sendIds().length, COMMITS - commitsBefore]);
  var a2 = await call('GET', '/api/promo/analytics?eventId=demo-ev', { token: 'maker' });
  check('the event\'s dashboard counts every export since', a2.json && a2.json.totals.sends === before + 2 + files.length, a2.json && a2.json.totals);

  /* ======== the team view: every live event's sends, qa- events and stale rows left out ======== */
  DOCS['events/qa-promo-x'] = { name: 'QA', createdAt: CREATED };
  DOCS['promoSends/qaqaqaqaqaqa'] = track._test.sendDoc({ id: 'qaqaqaqaqaqa', eventId: 'qa-promo-x', eventCreatedAt: CREATED, createdAt: 1 });
  DOCS['promoSends/oldoldoldold'] = track._test.sendDoc({ id: 'oldoldoldold', eventId: 'demo-ev', eventCreatedAt: '2020-01-01T00:00:00.000Z', createdAt: 1 });
  var all = await call('GET', '/api/promo/analytics/all?fresh=1', { token: 'maker' });
  var aj = all.json || {};
  check('team: 200, backend firestore on a deployed instance', all.status === 200 && aj.backend === 'firestore', [all.status, aj.backend]);
  check('team: the same totals as the event (only demo-ev is real)', aj.totals && aj.totals.sends === a2.json.totals.sends && aj.totals.opens === 1 && aj.totals.clicks === 1, aj.totals);
  check('team: no qa- event, no send of an earlier event at the same address', (aj.sends || []).every(function (s) { return s.event === 'demo-ev' && s.id !== 'oldoldoldold'; }));
  check('team: the same shape', sameKeys(aj, TOP));

  /* ======== the pieces agree on names (studio, team page, servers) ======== */
  var studio = fs.readFileSync(path.join(ROOT, 'promo-studio/mailer-studio.js'), 'utf8');
  var ow = fs.readFileSync(path.join(ROOT, 'promo-studio/oneworld.js'), 'utf8');
  var team = fs.readFileSync(path.join(ROOT, 'mailer-performance.html'), 'utf8');
  check('the studio reads the header the server sends', studio.indexOf('r.headers.get("X-Mailer-Tracked")') !== -1 && dl.headers['x-mailer-tracked'] !== undefined);
  check('the studio reads render\'s tracked', studio.indexOf('j.tracked') !== -1 && 'tracked' in cp.json);
  check('the studio asks the two analytics routes this server answers', ow.indexOf("'/api/promo/analytics/all'") !== -1 && ow.indexOf("'/api/promo/analytics?eventId='") !== -1);
  check('the studio hides Link tracking from catalog.tracking', ow.indexOf('j.tracking === false') !== -1 && 'tracking' in cat.json);
  check('the team page frames the studio in the scope the studio knows', /<iframe[^>]+src="promo-mailer-studio\.html\?scope=all"/.test(team) && ow.indexOf("get('scope') === 'all'") !== -1);
  check('server.js finds promo-track in require.cache under the path Node gives it', require.resolve('./promo-track') === path.join(ROOT, 'functions', 'lib', 'promo-track.js'));
  check('nothing unexpected was logged', !LOGS.some(function (l) { return /could not be recorded|could not be added|could not be loaded|failed/.test(l); }), LOGS);

  console.log('promo-phase2-integration: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { realError(err && err.stack || err); process.exit(1); });
