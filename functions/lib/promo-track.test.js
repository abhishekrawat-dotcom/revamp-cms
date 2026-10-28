/* node functions/lib/promo-track.test.js — mailer tracking (lib/promo-track.js): when tracking runs, the machine
   filter and the redirect's encoding, the dashboard's numbers (the platform's own summary rules), recording a send,
   counting hits (one check per new id, coalesced and spaced writes, the budgets), and the four routes — against an
   in-memory Firestore. No network, no real project. Exits 1 on any failure. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

['K_SERVICE', 'TRACK_SECRET', 'TRACK_SECRET_PREVIOUS', 'MAILER_TRACK_BASE'].forEach(function (k) { delete process.env[k]; });

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

/* ---------- an in-memory Firestore, just what lib/promo-track.js calls ---------- */
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function segsOf(f) { return typeof f === 'string' ? f.split('.') : f.segments; }
/* a document as Firestore hands it back for a select() / fieldMask: only the asked-for fields */
function project(d, fields) {
  var out = {};
  fields.forEach(function (f) {
    var segs = segsOf(f), v = d;
    for (var i = 0; i < segs.length; i++) { if (v == null || typeof v !== 'object' || !(segs[i] in v)) return; v = v[segs[i]]; }
    var o = out;
    for (var j = 0; j < segs.length - 1; j++) { o[segs[j]] = o[segs[j]] || {}; o = o[segs[j]]; }
    o[segs[segs.length - 1]] = clone(v);
  });
  return out;
}
function fakeFb() {
  var f = { docs: {}, reads: 0, readCalls: [], updates: [], queries: [], batches: 0, creates: 0, commits: 0,
    readFail: null, holdReads: false, heldReads: [], updateFail: null, holdUpdates: false, held: [], commitFail: null, queryFail: null };
  var docs = f.docs;
  function snapOf(p, mask) {
    var d = docs[p];
    return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? (mask ? project(d, mask) : clone(d)) : undefined; } };
  }
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      /* update(FieldPath, increment, …): the SDK's own objects — FieldPath.segments, NumericIncrementTransform.operand */
      update: function () {
        var args = [].slice.call(arguments), rec = { path: p, args: args };
        f.updates.push(rec);
        function run() {
          if (f.updateFail) throw f.updateFail;
          if (!docs[p]) throw Object.assign(new Error('no document to update'), { code: 5 });
          for (var i = 0; i < args.length; i += 2) {
            var segs = args[i] && args[i].segments, v = args[i + 1], o = docs[p];
            if (!segs || !v || typeof v.operand !== 'number') throw new Error('fake: update() expects FieldPath, increment pairs');
            for (var j = 0; j < segs.length - 1; j++) { if (!o[segs[j]] || typeof o[segs[j]] !== 'object') o[segs[j]] = {}; o = o[segs[j]]; }
            o[segs[segs.length - 1]] = (o[segs[segs.length - 1]] || 0) + v.operand;
          }
        }
        if (f.holdUpdates) {
          return new Promise(function (resolve, reject) { f.held.push({ rec: rec, go: function () { try { run(); resolve(); } catch (e) { reject(e); } } }); });
        }
        try { run(); return Promise.resolve(); } catch (e) { return Promise.reject(e); }
      }
    };
  }
  function query(p, filters) {
    function run(fields) {
      f.queries.push({ path: p, filters: filters, fields: fields });
      if (f.queryFail) return Promise.reject(f.queryFail);
      var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; })
        .filter(function (k) { return filters.every(function (fl) { return docs[k][fl[0]] === fl[2]; }); })
        .map(function (k) { return snapOf(k, fields); });
      return Promise.resolve({ docs: list, size: list.length });
    }
    return {
      where: function (field, op, value) { return query(p, filters.concat([[field, op, value]])); },
      select: function () { var fields = [].slice.call(arguments); return { get: function () { return run(fields); } }; },
      get: function () { return run(null); },
      doc: function (id) { return docRef(p + '/' + id); }
    };
  }
  f.db = {
    collection: function (n) { return query(n, []); },
    getAll: function () {
      var args = [].slice.call(arguments), opts = null;
      if (args.length && !args[args.length - 1].path) opts = args.pop();
      f.reads += args.length;
      f.readCalls.push({ paths: args.map(function (r) { return r.path; }), opts: opts });
      function run() { if (f.readFail) throw f.readFail; return args.map(function (r) { return snapOf(r.path, opts && opts.fieldMask); }); }
      if (f.holdReads) return new Promise(function (resolve, reject) { f.heldReads.push(function () { try { resolve(run()); } catch (e) { reject(e); } }); });
      try { return Promise.resolve(run()); } catch (e) { return Promise.reject(e); }
    },
    batch: function () {
      var ops = [];
      f.batches++;
      return {
        create: function (ref, data) { f.creates++; ops.push([ref.path, data]); },
        commit: function () {
          f.commits++;
          if (f.commitFail) return Promise.reject(f.commitFail);
          for (var i = 0; i < ops.length; i++) if (docs[ops[i][0]]) return Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }));
          ops.forEach(function (o) { docs[o[0]] = clone(o[1]); });
          return Promise.resolve();
        }
      };
    }
  };
  return f;
}

/* every require below sees this Firebase; FB is swapped per check */
var FB = fakeFb(), FB_ERROR = null;
var fbPath = require.resolve('./firebase');
require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { getFirebase: function () { return FB_ERROR ? { error: FB_ERROR } : FB; } } };

/* loading the module starts nothing: no timer, no signal handler */
var timersBefore = process.getActiveResourcesInfo().filter(function (r) { return r === 'Timeout'; }).length;
var sigtermBefore = process.listenerCount('SIGTERM');
const track = require('./promo-track');
const T = track._test;
const engine = require('./vendor/promo-engine');
const { sendJson } = require('./http');
check('loading the module starts no timer', process.getActiveResourcesInfo().filter(function (r) { return r === 'Timeout'; }).length === timersBefore);
check('loading the module adds no SIGTERM handler', process.listenerCount('SIGTERM') === sigtermBefore);
check('the contract\'s exports are there', ['wire', 'mode', 'availableFor', 'base', 'countsFor', 'recordSends', 'handleOpen', 'handleClick',
  'handleAnalytics', 'handleAnalyticsAll', 'flushAll'].every(function (k) { return typeof track[k] === 'function'; }) &&
  ['AUTOMATED', 'isAutomated', 'PIXEL', 'SEND_ID_RE', 'MAILER_ID_RE', 'SAVE_ID_RE', 'encodeUrl', 'dayKey', 'buildSummary', 'sendDoc',
    'updateArgs', 'countHit', 'NUMBERS', 'resetState'].every(function (k) { return T[k] !== undefined; }));

var DEFAULTS = JSON.parse(JSON.stringify(T.NUMBERS));
check('NUMBERS as the contract gives them', JSON.stringify(DEFAULTS) === JSON.stringify({ WRITE_GAP_MS: 1000, HIT_WAIT_MS: 3000, PROBES_PER_SEC: 20,
  MAX_PENDING: 10000, MAX_KNOWN: 20000, MAX_UNKNOWN: 10000, UNKNOWN_TTL_MS: 600000, MAX_WAITING: 16, TEAM_CACHE_MS: 30000, LOG_EVERY_MS: 600000 }), DEFAULTS);

function env(o) {
  ['K_SERVICE', 'TRACK_SECRET', 'TRACK_SECRET_PREVIOUS', 'MAILER_TRACK_BASE'].forEach(function (k) {
    if (o[k] === undefined) delete process.env[k]; else process.env[k] = o[k];
  });
}
var KEY = crypto.randomBytes(32).toString('hex'), KEY2 = crypto.randomBytes(32).toString('hex');
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function ticks(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 5); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }
/* a promise's state without waiting for it */
function tracked(p) { var t = { done: false }; p.then(function () { t.done = true; }); return t; }
/* console.error captured for a check */
function quietly(fn) {
  var lines = [], orig = console.error;
  console.error = function () { lines.push([].slice.call(arguments).join(' ')); };
  return Promise.resolve().then(fn).then(function (v) { console.error = orig; return { lines: lines, value: v }; },
    function (e) { console.error = orig; throw e; });
}
function fresh(overrides) {
  T.resetState();
  Object.keys(DEFAULTS).forEach(function (k) { T.NUMBERS[k] = DEFAULTS[k]; });
  Object.keys(overrides || {}).forEach(function (k) { T.NUMBERS[k] = overrides[k]; });
  FB = fakeFb(); FB_ERROR = null;
  return FB;
}
var n = 0;
function sid() { n++; var s = 'id' + String(n); while (s.length < 12) s += '_'; return s; }   // 12 characters, a send id's shape
var EV_AT = '2026-10-01T00:00:00.000Z';
function seed(id, eventId, extra) {
  FB.docs['promoSends/' + id] = Object.assign(T.sendDoc({ id: id, eventId: eventId || 'demo-ev', eventCreatedAt: EV_AT, portal: 'health',
    eventName: 'Demo', mailerId: 'mailer.announcement', mailerLabel: 'Announcement', subject: 'Hello', createdAt: 1, by: 'a@timesinternet.in' }), extra || {});
  return FB.docs['promoSends/' + id];
}
var NOW = Date.parse('2026-10-28T06:00:00.000Z');   // 11:30 in India
var TODAY = '2026-10-28';

var CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
function call(handler, method, url, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var headers = Object.assign({ 'user-agent': o.ua == null ? CHROME : o.ua, host: 'track.example' }, o.headers || {});
    if (o.auth) headers.authorization = 'Bearer editor';
    var req = { method: method, url: url, headers: headers };
    var res = { statusCode: 0, headers: {}, names: [], headersSent: false,
      writeHead: function (s, h) { res.statusCode = s; res.names = Object.keys(h || {}); res.names.forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      end: function (b) {
        var body = b == null ? null : Buffer.isBuffer(b) ? b : Buffer.from(String(b));
        var json = null; try { json = JSON.parse(body ? body.toString() : ''); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, names: res.names, body: body, text: body ? body.toString() : '', json: json });
      } };
    handler(req, res);
  });
}

/* the helpers lib/api.js hands over (promoHelpers), over the fake Firestore */
function httpError(status, message, extra) { var e = new Error(message); e.status = status; e.body = Object.assign({ error: message }, extra || {}); return e; }
var failures = [];
track.wire({
  withAdmin: function (req, res, cb) {
    if (!/^Bearer /.test(String(req.headers.authorization || ''))) return sendJson(res, 401, { error: 'Sign in required.' });
    cb(FB, { email: 'editor@timesinternet.in' });
  },
  eventIdOr400: function (res, value) {
    var id = typeof value === 'string' ? value.trim() : '';
    if (!id) { sendJson(res, 400, { error: 'eventId is required.' }); return ''; }
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) { sendJson(res, 400, { error: 'Invalid eventId.' }); return ''; }
    return id;
  },
  loadLiveEvent: function (fb, id) {
    return fb.db.getAll(fb.db.collection('events').doc(id)).then(function (s) {
      var d = s[0].exists ? s[0].data() : null;
      if (d && d.deletedAt) throw httpError(404, 'This event has been deleted.', { code: 'event-deleted' });
      if (!d || !d.createdAt) throw httpError(404, 'No event found for "' + id + '".', { code: 'event-not-found' });
      return d;
    });
  },
  sendFailure: function (res, what, err, friendly) {
    if (err && err.status && err.body) return sendJson(res, err.status, err.body);
    failures.push(what);
    sendJson(res, 500, { error: friendly });
  }
});

/* ======================================================================================== */
async function main() {

  /* ---------- 1. when tracking runs (§3d) ---------- */
  env({ K_SERVICE: 'svc', MAILER_TRACK_BASE: 'https://mail.example' });
  check('no key: off', track.mode() === 'off' && track.base() === '' && !track.availableFor('any-event'));
  env({ K_SERVICE: 'svc', MAILER_TRACK_BASE: 'https://mail.example', TRACK_SECRET: 'x'.repeat(31) });
  check('a 31-character key: off', track.mode() === 'off');
  env({ K_SERVICE: 'svc', MAILER_TRACK_BASE: 'https://mail.example', TRACK_SECRET: '  ' + 'x'.repeat(31) + '   ' });
  check('a key is trimmed before it is measured', track.mode() === 'off');
  env({ K_SERVICE: 'svc', MAILER_TRACK_BASE: 'https://mail.example/', TRACK_SECRET: KEY });
  check('deployed, https base: on, base without the trailing slash', track.mode() === 'on' && track.base() === 'https://mail.example', [track.mode(), track.base()]);
  check('deployed: every event is tracked', track.availableFor('agentic-summit-2027') && track.availableFor('qa-x'));
  ['https://mail.example/sub', 'https://u:p@mail.example', 'https://mail.example/?x=1', 'https://mail.example/#h', 'https://mail.example/?',
    'ftp://x', 'not a url', 'http://mail.example', 'http://localhost:8161', ''].forEach(function (b) {
    env({ K_SERVICE: 'svc', MAILER_TRACK_BASE: b, TRACK_SECRET: KEY });
    check('deployed, base ' + JSON.stringify(b) + ': off', track.mode() === 'off' && track.base() === '' && !track.availableFor('x'), track.mode());
  });
  ['http://localhost:8161', 'http://127.0.0.1:8161', 'https://mail.example'].forEach(function (b) {
    env({ MAILER_TRACK_BASE: b, TRACK_SECRET: KEY });
    check('local, base ' + b + ': qa', track.mode() === 'qa' && track.base() === b, [track.mode(), track.base()]);
  });
  env({ MAILER_TRACK_BASE: 'http://localhost:8161', TRACK_SECRET: KEY });
  check('local: a qa- event is tracked, a real one is not', track.availableFor('qa-x') && !track.availableFor('agentic-summit-2027'));
  env({ MAILER_TRACK_BASE: 'http://mail.example', TRACK_SECRET: KEY });
  check('local, http base that is not localhost: off', track.mode() === 'off' && !track.availableFor('qa-x'));
  env({ K_SERVICE: 'svc' });
  check('countsFor, deployed: every event', track.countsFor('agentic-summit-2027') && track.countsFor('qa-x'));
  env({});
  check('countsFor, local: qa- only', !track.countsFor('agentic-summit-2027') && track.countsFor('qa-x'));

  /* ---------- 2. machines and the redirect's encoding (§3c, §3e) ---------- */
  var SOURCE_AUTOMATED = 'bot\\b|crawler|spider|slurp|proofpoint|mimecast|barracuda|symantec|forcepoint|messagelabs|trendmicro|fireeye|cloudmark|urldefense|safelinks|linkcheck|uptime|monitor|pingdom|curl\\/|wget|python-requests|go-http|axios|node-fetch|okhttp|java\\/|libwww|headlesschrome|phantomjs|puppeteer|playwright|scrapy|postman';
  check('AUTOMATED is the source\'s, verbatim', T.AUTOMATED.source === SOURCE_AUTOMATED && T.AUTOMATED.flags === 'i');
  var src = fs.readFileSync(path.join(__dirname, 'promo-track.js'), 'utf8');
  check('the source\'s comment on AUTOMATED is kept', src.indexOf('Deliberately NOT here: GoogleImageProxy, YahooMailProxy and Apple\'s fetcher.') !== -1);
  function ua(s, method) { return T.isAutomated({ method: method || 'GET', headers: { 'user-agent': s } }); }
  ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'curl/8.4.0', 'Wget/1.21', 'python-requests/2.31', 'Go-http-client/1.1',
    'axios/1.6', 'node-fetch/1.0', 'okhttp/4.9', 'Java/17', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
    'Proofpoint', 'Mimecast', 'Barracuda', 'SafeLinks', 'urldefense', 'PostmanRuntime/7.36', 'Scrapy/2.11', 'UptimeRobot/2.0'].forEach(function (s) {
    check('a machine: ' + s, ua(s));
  });
  [CHROME, 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)',
    'YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)', ''].forEach(function (s) {
    check('a mail client: ' + JSON.stringify(s), !ua(s));
  });
  check('no user agent at all: a mail client (the rule is verbatim)', !T.isAutomated({ method: 'GET', headers: {} }));
  check('HEAD with a browser\'s user agent: a machine', ua(CHROME, 'HEAD'));

  check('encodeUrl leaves a plain link alone', T.encodeUrl('https://sponsor.com') === 'https://sponsor.com');
  check('encodeUrl leaves a query and its escapes alone', T.encodeUrl('https://x.com/a?b=1&c=%20') === 'https://x.com/a?b=1&c=%20');
  check('encodeUrl encodes a space and é', T.encodeUrl('https://x.com/a b/é') === 'https://x.com/a%20b/%C3%A9', T.encodeUrl('https://x.com/a b/é'));
  check('encodeUrl replaces a lone surrogate', T.encodeUrl('https://x.com/\uD800') === 'https://x.com/%EF%BF%BD' && T.encodeUrl('https://x.com/\uDC00x') === 'https://x.com/%EF%BF%BDx');
  check('encodeUrl escapes a stray %', T.encodeUrl('https://x.com/100%') === 'https://x.com/100%25');
  check('encodeUrl output is always ASCII', ['https://x.com/a b/é', 'https://x.com/\uD800', 'https://例え.jp/パス?q=値', 'https://x.com/\u0001"<>`{}']
    .every(function (u) { return /^[\x20-\x7e]*$/.test(T.encodeUrl(u)); }));

  check('dayKey is the India day', T.dayKey(Date.parse('2026-10-27T18:29:59Z')) === '2026-10-27' && T.dayKey(Date.parse('2026-10-27T18:30:01Z')) === '2026-10-28');
  check('PIXEL is the source\'s 42-byte GIF89a', T.PIXEL.length === 42 && T.PIXEL.slice(0, 6).toString() === 'GIF89a');

  /* ---------- 3. the dashboard's numbers (§3h; store.ts buildSummary) ---------- */
  function row(o) {
    return Object.assign({ id: sid(), eventId: 'demo-ev', eventCreatedAt: EV_AT, portal: 'health', eventName: 'Demo', mailerId: 'mailer.a',
      mailerLabel: 'A', subject: 'Subject', saveId: '', saveName: '', createdAt: 1, opens: 0, clicks: 0, botOpens: 0, botClicks: 0, days: {} }, o);
  }
  var S = T.buildSummary([row({ opens: 3, clicks: 1, botOpens: 4, botClicks: 2 }), row({ opens: 2, clicks: 2, botOpens: 1 })], NOW, 'firestore');
  check('totals count human hits only', S.totals.sends === 2 && S.totals.opens === 5 && S.totals.clicks === 3, S.totals);
  check('filtered sums the machines', S.filtered.opens === 5 && S.filtered.clicks === 2, S.filtered);
  check('the shape is the source\'s Summary, in its order', JSON.stringify(Object.keys(S)) === JSON.stringify(['available', 'backend', 'series', 'totals', 'filtered', 'sends',
    'topOpenedTemplates', 'topOpenedSubjects', 'topClickedTemplates', 'topClickedSubjects', 'versions']), Object.keys(S));
  check('backend firestore: available', S.available === true && S.backend === 'firestore');
  var S0 = T.buildSummary([], NOW, 'none');
  check('backend none: not available; empty numbers', S0.available === false && S0.backend === 'none' && S0.totals.sends === 0 && S0.sends.length === 0 &&
    S0.series.length === 30 && JSON.stringify(S0.versions) === '{}');

  var many = [];
  for (var i = 0; i < 205; i++) many.push(row({ createdAt: 1000 + ((i * 37) % 205) }));
  var SM = T.buildSummary(many, NOW, 'firestore');
  check('205 sends: 200 listed, newest first', SM.sends.length === 200 && SM.totals.sends === 205 && SM.sends[0].createdAt === 1204 &&
    SM.sends.every(function (s, j) { return !j || SM.sends[j - 1].createdAt >= s.createdAt; }));

  var days = {};
  days['2026-09-28'] = { o: 50, c: 50 };      // a day before the window
  days['2026-09-29'] = { o: 1, c: 0 };        // the first day in it
  days[TODAY] = { o: 2, c: 1 };
  days['2026-10-29'] = { o: 70, c: 70 };      // after it
  var SS = T.buildSummary([row({ days: days }), row({ days: (function () { var d = {}; d[TODAY] = { o: 3 }; return d; })() })], NOW, 'firestore');
  check('series: 30 days, oldest first, ending today in India', SS.series.length === 30 && SS.series[0].date === '2026-09-29' && SS.series[29].date === TODAY &&
    SS.series.every(function (d, j) { return !j || SS.series[j - 1].date < d.date; }), [SS.series[0], SS.series[29]]);
  check('series sums the rows\' days; days outside the window are ignored', SS.series[29].opens === 5 && SS.series[29].clicks === 1 && SS.series[0].opens === 1 &&
    SS.series.reduce(function (t, d) { return t + d.opens + d.clicks; }, 0) === 7, SS.series[29]);
  var late = Date.parse('2026-10-27T19:00:00Z');   // 00:30 on the 28th in India
  check('the window ends on the India day even when UTC is still on the day before', T.buildSummary([], late, 'none').series[29].date === TODAY);

  var rk = [
    row({ mailerId: 'm.big', mailerLabel: 'Big', opens: 10, clicks: 0, createdAt: 5, subject: 'S1' }),
    row({ mailerId: 'm.two', mailerLabel: '', opens: 2, clicks: 3, createdAt: 4, subject: 'S2' }),
    row({ mailerId: 'm.two', mailerLabel: '', opens: 3, clicks: 0, createdAt: 3, subject: 'S2' }),
    row({ mailerId: 'm.one', mailerLabel: 'One', opens: 5, clicks: 3, createdAt: 2, subject: '' }),
    row({ mailerId: '', opens: 100, createdAt: 1, subject: 'S3' })
  ];
  for (var k = 0; k < 12; k++) rk.push(row({ mailerId: 'm.z' + k, mailerLabel: 'Z' + k, opens: 0, createdAt: 0, subject: 'Z' + k }));
  var SR = T.buildSummary(rk, NOW, 'firestore');
  var ot = SR.topOpenedTemplates;
  check('templates by opens; a tie goes to more sends; limit 10', ot.length === 10 && ot[0].key === 'm.big' && ot[1].key === 'm.two' && ot[2].key === 'm.one',
    ot.slice(0, 3));
  check('a template\'s numbers add up over its sends', ot[1].sends === 2 && ot[1].opens === 5 && ot[1].clicks === 3);
  check('a template with no label is labelled by its id', ot[1].label === 'm.two' && ot[0].label === 'Big');
  check('a send with no mailer id is not ranked', !ot.some(function (r) { return r.key === ''; }));
  check('ranked rows carry key, label, sends, opens, clicks', JSON.stringify(Object.keys(ot[0])) === JSON.stringify(['key', 'label', 'sends', 'opens', 'clicks']));
  var ct = SR.topClickedTemplates;
  check('templates by clicks; a tie goes to more sends', ct[0].key === 'm.two' && ct[1].key === 'm.one', ct.slice(0, 2));
  check('subjects keyed and labelled by the subject; an empty one skipped', SR.topOpenedSubjects[0].key === 'S3' && SR.topOpenedSubjects[0].label === 'S3' &&
    !SR.topOpenedSubjects.some(function (r) { return r.key === ''; }) && SR.topClickedSubjects[0].key === 'S2');

  var vr = [
    row({ mailerId: 'm.v', saveId: 'v1', saveName: 'Draft one', opens: 1, createdAt: 9 }),
    row({ mailerId: 'm.v', saveId: 'v1', saveName: 'Draft one', opens: 1, createdAt: 8 }),
    row({ mailerId: 'm.v', saveId: 'v2', saveName: '', opens: 5, createdAt: 7 }),
    row({ mailerId: 'm.v', saveId: '', opens: 3, createdAt: 6 }),
    row({ mailerId: 'm.single', saveId: 'only', saveName: 'Only', opens: 4 }),
    row({ mailerId: 'm.single', saveId: 'only', saveName: 'Only', opens: 4 })
  ];
  for (var q = 0; q < 25; q++) vr.push(row({ mailerId: 'm.many', saveId: 'v' + q, saveName: 'V' + q, opens: q }));
  var SV = T.buildSummary(vr, NOW, 'firestore');
  var vv = SV.versions['m.v'];
  check('versions: by opens, the unsaved sends as one honest row', vv && vv.length === 3 && vv[0].key === 'v2' && vv[0].label === 'v2' &&
    vv[1].key === '-' && vv[1].label === 'Not saved — sent from the studio' && vv[2].key === 'v1' && vv[2].label === 'Draft one' && vv[2].sends === 2, vv);
  check('versions: a mailer with one version has nothing to drill into', !('m.single' in SV.versions));
  check('versions: at most 20', SV.versions['m.many'].length === 20 && SV.versions['m.many'][0].key === 'v24');
  /* a mailer id every object already has (rows written by hand, or before the id rule): an ordinary key, never the
     object's prototype — and a name that is not a key is not there */
  var pr = [];
  ['__proto__', 'constructor'].forEach(function (k) { pr.push(row({ mailerId: k, saveId: 'a', opens: 1 }), row({ mailerId: k, saveId: 'b', opens: 2 })); });
  var SP = T.buildSummary(pr, NOW, 'firestore');
  check('versions: "__proto__" and "constructor" are ordinary keys; the object\'s prototype is untouched',
    Object.getPrototypeOf(SP.versions) === null && Object.prototype.hasOwnProperty.call(SP.versions, '__proto__') &&
    Array.isArray(SP.versions['__proto__']) && SP.versions['__proto__'].length === 2 && Array.isArray(SP.versions.constructor) &&
    JSON.parse(JSON.stringify(SP)).versions.constructor.length === 2, Object.keys(SP.versions));
  check('versions: a name no row has is not there (no prototype to find it on)', SV.versions.toString === undefined && SV.versions.hasOwnProperty === undefined);

  var r0 = T.buildSummary([row({ id: 'abcdefghijkl', eventId: 'ev-x', by: 'someone@x', days: { x: 1 } })], NOW, 'firestore').sends[0];
  check('a listed send: event = eventId, sends: 1, never by, eventCreatedAt or days', r0.event === 'ev-x' && r0.sends === 1 &&
    JSON.stringify(Object.keys(r0)) === JSON.stringify(['id', 'portal', 'event', 'eventName', 'mailerId', 'mailerLabel', 'subject', 'saveId', 'saveName',
      'createdAt', 'opens', 'clicks', 'sends', 'botOpens', 'botClicks']), Object.keys(r0));
  var frozen = [row({ createdAt: 1 }), row({ createdAt: 2 })], before = frozen.map(function (r) { return r.id; }).join();
  T.buildSummary(frozen, NOW, 'none');
  check('buildSummary leaves its rows as they were (the team cache shares them)', frozen.map(function (r) { return r.id; }).join() === before);

  /* ---------- 4. recording sends (§2a) ---------- */
  fresh();
  var m1 = { id: 'aaaaaaaaaaa1', eventId: 'demo-ev', eventCreatedAt: EV_AT, portal: 'health', eventName: 'Demo', mailerId: 'mailer.announcement',
    mailerLabel: 'Announcement', subject: 'Hello', saveId: 'Ab_9-x', saveName: 'Version 2', createdAt: 1761600000000, by: 'editor@timesinternet.in' };
  var m2 = Object.assign({}, m1, { id: 'aaaaaaaaaaa2', saveId: null, saveName: 'ignored' });
  await track.recordSends(FB, [m1, m2]);
  var d1 = FB.docs['promoSends/aaaaaaaaaaa1'], d2 = FB.docs['promoSends/aaaaaaaaaaa2'];
  check('one batch of create(), one commit, for every file', FB.batches === 1 && FB.creates === 2 && FB.commits === 1 && d1 && d2);
  check('a send starts at zero with no days', d1.opens === 0 && d1.clicks === 0 && d1.botOpens === 0 && d1.botClicks === 0 && JSON.stringify(d1.days) === '{}');
  check('a send keeps its meta', d1.eventId === 'demo-ev' && d1.eventCreatedAt === EV_AT && d1.portal === 'health' && d1.mailerId === 'mailer.announcement' &&
    d1.mailerLabel === 'Announcement' && d1.subject === 'Hello' && d1.saveId === 'Ab_9-x' && d1.saveName === 'Version 2' && d1.createdAt === 1761600000000 &&
    d1.by === 'editor@timesinternet.in', d1);
  check('the stored fields are exactly §2a\'s', JSON.stringify(Object.keys(d1).sort()) === JSON.stringify(['botClicks', 'botOpens', 'by', 'clicks', 'createdAt', 'days',
    'eventCreatedAt', 'eventId', 'eventName', 'mailerId', 'mailerLabel', 'opens', 'portal', 'saveId', 'saveName', 'subject']), Object.keys(d1));
  check('no save id: no save name', d2.saveId === '' && d2.saveName === '');
  check('a mailer id with a quote is stored as \'\'', T.sendDoc({ mailerId: 'x\'y' }).mailerId === '' && T.sendDoc({ mailerId: 'x"y' }).mailerId === '' &&
    T.sendDoc({ mailerId: 'Mailer.X' }).mailerId === '' && T.sendDoc({ mailerId: 'm'.repeat(65) }).mailerId === '');
  check('a mailer id every object already has is stored as \'\' ("constructor", "__proto__")',
    T.sendDoc({ mailerId: 'constructor' }).mailerId === '' && T.sendDoc({ mailerId: '__proto__' }).mailerId === '' &&
    T.sendDoc({ mailerId: 'mailer.constructor' }).mailerId === 'mailer.constructor' && T.sendDoc({ mailerId: 'tostring' }).mailerId === 'tostring');
  check('mailer.imported and registry ids are kept', T.sendDoc({ mailerId: 'mailer.imported' }).mailerId === 'mailer.imported' &&
    T.sendDoc({ mailerId: 'mailer.speaker-spotlight_2' }).mailerId === 'mailer.speaker-spotlight_2');
  check('a bad save id is \'\' and takes its name with it', T.sendDoc({ saveId: 'a/b', saveName: 'N' }).saveId === '' && T.sendDoc({ saveId: 'a/b', saveName: 'N' }).saveName === '' &&
    T.sendDoc({ saveId: 'x'.repeat(61), saveName: 'N' }).saveId === '');
  var big = T.sendDoc({ subject: 's'.repeat(1500), eventName: 'e'.repeat(400), saveId: 'ok', saveName: 'n'.repeat(200), mailerLabel: 'l'.repeat(300),
    portal: 'p'.repeat(150), by: 'b'.repeat(300) });
  check('caps: subject 1000, eventName 300, saveName 120, mailerLabel 200, portal 100, by 200', big.subject.length === 1000 && big.eventName.length === 300 &&
    big.saveName.length === 120 && big.mailerLabel.length === 200 && big.portal.length === 100 && big.by.length === 200);
  check('a cap never leaves half a character', T.sendDoc({ subject: 's'.repeat(999) + '😀' }).subject === 's'.repeat(999));
  check('missing fields are empty text, never "undefined"', T.sendDoc({ eventId: 'x' }).subject === '' && T.sendDoc({ eventId: 'x' }).portal === '');
  var commitsBefore = FB.commits, docsBefore = Object.keys(FB.docs).length;
  var bad = await track.recordSends(FB, [Object.assign({}, m1, { id: 'aaaaaaaaaaa3' }), Object.assign({}, m1, { id: 'aaaaaaaaaaa4', eventId: 'Bad Id' })])
    .then(function () { return null; }, function (e) { return e; });
  check('an invalid eventId rejects the batch and writes nothing', bad && FB.commits === commitsBefore && Object.keys(FB.docs).length === docsBefore);
  bad = await track.recordSends(FB, [Object.assign({}, m1, { id: 'a/b' })]).then(function () { return null; }, function (e) { return e; });
  check('an invalid send id rejects the batch', bad && Object.keys(FB.docs).length === docsBefore);
  FB.commitFail = Object.assign(new Error('unavailable'), { code: 14 });
  bad = await track.recordSends(FB, [Object.assign({}, m1, { id: 'aaaaaaaaaaa5' })]).then(function () { return null; }, function (e) { return e; });
  check('a commit failure rejects', bad && bad.code === 14);
  FB.commitFail = null;
  bad = await track.recordSends({ error: 'no bucket' }, [m1]).then(function () { return null; }, function (e) { return e; });
  check('no Firestore: rejects', !!bad);

  /* ---------- 5. counting hits (§3f) ---------- */
  env({ K_SERVICE: 'svc' });

  /* 5.1 ten at once on an id not confirmed yet: one read, one write */
  fresh({ WRITE_GAP_MS: 50 });
  var a = sid(); seed(a);
  var ten = [];
  for (var t = 0; t < 10; t++) ten.push(T.countHit(FB, a, 'open', false, NOW));
  await Promise.all(ten);
  check('ten concurrent opens on an unconfirmed send: one read, one write', FB.reads === 1 && FB.updates.length === 1, [FB.reads, FB.updates.length]);
  check('… all ten counted, on today\'s India day', FB.docs['promoSends/' + a].opens === 10 && FB.docs['promoSends/' + a].days[TODAY].o === 10, FB.docs['promoSends/' + a]);
  check('the check reads only eventId', FB.readCalls[0].opts && JSON.stringify(FB.readCalls[0].opts.fieldMask) === '["eventId"]');
  check('update() gets FieldPath / increment pairs, non-zero only', FB.updates[0].args.length === 4 &&
    JSON.stringify(FB.updates[0].args[0].segments) === '["opens"]' && FB.updates[0].args[1].operand === 10 &&
    JSON.stringify(FB.updates[0].args[2].segments) === JSON.stringify(['days', TODAY, 'o']));
  var ua2 = T.updateArgs({ opens: 0, clicks: 2, botOpens: 1, botClicks: 0, days: { '2026-10-27': { o: 0, c: 2 } } });
  check('updateArgs: clicks, botOpens and one day\'s clicks', ua2.length === 6 && ua2[0].segments.join() === 'clicks' && ua2[2].segments.join() === 'botOpens' &&
    ua2[4].segments.join('/') === 'days/2026-10-27/c' && ua2[5].operand === 2);

  /* 5.2 a thousand opens on a known send: all counted, writes bounded by the spacing */
  fresh({ WRITE_GAP_MS: 50 });
  var b = sid(); seed(b);
  await T.countHit(FB, b, 'open', false, NOW);   // confirms it
  var started = Date.now(), all = [], writesBefore = FB.updates.length;
  for (var burst = 0; burst < 10; burst++) {
    for (var h = 0; h < 100; h++) all.push(T.countHit(FB, b, 'open', false, NOW));
    await wait(15);
  }
  await Promise.all(all);
  await wait(120);
  var elapsed = Date.now() - started, writes = FB.updates.length - writesBefore;
  check('1,000 opens on a known send: every one counted', FB.docs['promoSends/' + b].opens === 1001, FB.docs['promoSends/' + b].opens);
  check('… in at most elapsed / gap + 2 writes', writes <= Math.floor(elapsed / 50) + 2 && writes >= 2, [writes, elapsed]);
  check('… with no further read', FB.reads === 1);

  /* 5.3 spacing and waiting */
  fresh({ WRITE_GAP_MS: 40, HIT_WAIT_MS: 3000 });
  var c = sid(); seed(c);
  await T.countHit(FB, c, 'open', false, NOW);
  await wait(50);
  FB.holdUpdates = true;
  var h1 = tracked(T.countHit(FB, c, 'open', false, NOW));    // starts a write (held)
  var h2 = tracked(T.countHit(FB, c, 'open', false, NOW));    // asks for the next one, and carries it
  var h3 = tracked(T.countHit(FB, c, 'open', false, NOW));    // its counts go with h2's write
  await ticks();
  check('with one write in flight and one asked for, a third hit is answered before either is written', h3.done && !h1.done && !h2.done && FB.held.length === 1,
    [h1.done, h2.done, h3.done, FB.held.length]);
  var maxWaiting = T.state().waiting, burstHits = [];
  for (var w = 0; w < 50; w++) { burstHits.push(tracked(T.countHit(FB, c, 'open', false, NOW))); maxWaiting = Math.max(maxWaiting, T.state().waiting); }
  await ticks();
  check('at most 2 hits of a send are waiting at any time', maxWaiting === 2 && burstHits.every(function (x) { return x.done; }), maxWaiting);
  FB.held.shift().go();
  await ticks();
  check('the first write settles: its carrier is answered; the next one waits for the spacing', h1.done && !h2.done && FB.held.length === 0);
  await wait(60);
  check('the next write starts after the spacing', FB.held.length === 1 && !h2.done);
  FB.held.shift().go();
  await ticks();
  check('… and its carrier is answered when it lands', h2.done && FB.docs['promoSends/' + c].opens === 54, FB.docs['promoSends/' + c].opens);
  FB.holdUpdates = false;

  fresh({ WRITE_GAP_MS: 10, MAX_WAITING: 1 });
  var d = sid(), e = sid(); seed(d); seed(e);
  await Promise.all([T.countHit(FB, d, 'open', false, NOW), T.countHit(FB, e, 'open', false, NOW)]);
  await wait(20);
  FB.holdUpdates = true;
  var hd = tracked(T.countHit(FB, d, 'open', false, NOW));
  var he = tracked(T.countHit(FB, e, 'open', false, NOW));
  await ticks();
  check('MAX_WAITING 1: a second carrier is answered at once', !hd.done && he.done && FB.held.length === 2);
  FB.held.splice(0).forEach(function (x) { x.go(); });
  await ticks();
  check('… and its write still lands', FB.docs['promoSends/' + e].opens === 2 && FB.docs['promoSends/' + d].opens === 2 && hd.done);
  FB.holdUpdates = false;

  /* 5.3b a carrier gives up after HIT_WAIT_MS; its write still happens */
  fresh({ WRITE_GAP_MS: 10, HIT_WAIT_MS: 30 });
  var g = sid(); seed(g);
  await T.countHit(FB, g, 'open', false, NOW);
  await wait(20);
  FB.holdUpdates = true;
  var hg = tracked(T.countHit(FB, g, 'open', false, NOW));
  await wait(50);
  check('a carrier is answered after HIT_WAIT_MS even while its write is held', hg.done && T.state().waiting === 0);
  FB.held.splice(0).forEach(function (x) { x.go(); });
  await ticks();
  check('… and the write lands later', FB.docs['promoSends/' + g].opens === 2);
  FB.holdUpdates = false;

  /* 5.4 machines */
  fresh({ WRITE_GAP_MS: 10 });
  var bo = sid(); seed(bo);
  await T.countHit(FB, bo, 'open', true, NOW);
  await wait(20);
  await T.countHit(FB, bo, 'click', true, NOW);
  var bd = FB.docs['promoSends/' + bo];
  check('a machine\'s open and click go to botOpens / botClicks, never opens, clicks or days', bd.botOpens === 1 && bd.botClicks === 1 && bd.opens === 0 &&
    bd.clicks === 0 && JSON.stringify(bd.days) === '{}', bd);

  /* 5.5 India days, per hit */
  fresh();
  var dy = sid(); seed(dy);
  await Promise.all([T.countHit(FB, dy, 'open', false, Date.parse('2026-10-27T18:29:59Z')), T.countHit(FB, dy, 'click', false, Date.parse('2026-10-27T18:30:01Z'))]);
  var dd = FB.docs['promoSends/' + dy].days;
  check('two hits in one write, either side of midnight in India, land on their own days', FB.updates.length === 1 && dd['2026-10-27'] && dd['2026-10-27'].o === 1 &&
    !dd['2026-10-27'].c && dd['2026-10-28'] && dd['2026-10-28'].c === 1 && !dd['2026-10-28'].o, dd);

  /* 5.6 an unknown id */
  fresh();
  var un = sid();
  await T.countHit(FB, un, 'open', false, NOW);
  check('an unknown id: one read, no document created, nothing written', FB.reads === 1 && !FB.docs['promoSends/' + un] && FB.updates.length === 0);
  await T.countHit(FB, un, 'open', false, NOW);
  check('… and a second hit within 10 minutes makes no read', FB.reads === 1 && T.state().unknown.has(un));
  var sh = await quietly(function () { return T.countHit(FB, 'short', 'open', false, NOW); });
  check('an id that is not shaped like a send id: no read', FB.reads === 1 && !sh.lines.length);
  fresh();
  var rf = sid(); seed(rf);
  FB.readFail = Object.assign(new Error('unavailable'), { code: 14 });
  var logged = await quietly(function () { return T.countHit(FB, rf, 'open', false, NOW); });
  check('a read failing with code 14: nothing counted, the id not remembered', FB.reads === 1 && FB.updates.length === 0 && !T.state().unknown.has(rf) &&
    !T.state().known.has(rf) && !T.state().pending.has(rf));
  check('… and logged once, with its code', logged.lines.length === 1 && /promo-track: .*\(14\)/.test(logged.lines[0]), logged.lines);
  var again = await quietly(function () { return T.countHit(FB, rf, 'open', false, NOW); });
  check('… a second failure within 10 minutes is not logged again', again.lines.length === 0 && FB.reads === 2);
  FB.readFail = null;
  await T.countHit(FB, rf, 'open', false, NOW);
  check('… so the next hit reads again and counts', FB.reads === 3 && FB.docs['promoSends/' + rf].opens === 1);
  fresh();
  var nf = sid(); seed(nf);
  FB.readFail = Object.assign(new Error('gone'), { code: 5 });
  var nfl = await quietly(function () { return T.countHit(FB, nf, 'open', false, NOW); });
  check('a read failing with code 5 is not logged', nfl.lines.length === 0);
  FB.readFail = null;

  /* 5.7 the check budget */
  fresh({ PROBES_PER_SEC: 5 });
  var six = [];
  for (var s6 = 0; s6 < 6; s6++) { var id6 = sid(); seed(id6); six.push(id6); }
  await Promise.all(six.map(function (id) { return T.countHit(FB, id, 'open', false, NOW); }));
  check('5 checks a second: the 6th new id makes no read and counts nothing', FB.reads === 5 && FB.docs['promoSends/' + six[5]].opens === 0 &&
    FB.docs['promoSends/' + six[4]].opens === 1 && !T.state().pending.has(six[5]), FB.reads);
  await T.countHit(FB, six[0], 'open', false, NOW);
  check('… while a known send is never held back by it', FB.docs['promoSends/' + six[0]].opens >= 1 && FB.reads === 5);

  /* 5.8 a local server counts only qa- sends */
  env({});
  fresh();
  var real = sid(), qa = sid(); seed(real, 'agentic-summit-2027'); seed(qa, 'qa-promo-track-1');
  await Promise.all([T.countHit(FB, real, 'open', false, NOW), T.countHit(FB, qa, 'open', false, NOW)]);
  check('K_SERVICE unset: a real event\'s send is not counted, and is remembered as such', FB.docs['promoSends/' + real].opens === 0 && T.state().unknown.has(real));
  check('K_SERVICE unset: a qa- send is counted', FB.docs['promoSends/' + qa].opens === 1);
  env({ K_SERVICE: 'svc' });

  /* 5.9 a write that fails */
  fresh({ WRITE_GAP_MS: 10 });
  var gone = sid(); seed(gone);
  await T.countHit(FB, gone, 'open', false, NOW);
  delete FB.docs['promoSends/' + gone];             // QA cleanup removed it
  await wait(20);
  var gl = await quietly(function () { return T.countHit(FB, gone, 'open', false, NOW); });
  check('an update failing with code 5 moves the id to unknown, quietly', T.state().unknown.has(gone) && !T.state().known.has(gone) && !T.state().pending.has(gone) &&
    gl.lines.length === 0 && !FB.docs['promoSends/' + gone]);
  var readsNow = FB.reads;
  await T.countHit(FB, gone, 'open', false, NOW);
  check('… and its next hit costs nothing', FB.reads === readsNow && !FB.docs['promoSends/' + gone]);
  fresh({ WRITE_GAP_MS: 10 });
  var flaky = sid(); seed(flaky);
  await T.countHit(FB, flaky, 'open', false, NOW);
  await wait(20);
  FB.updateFail = Object.assign(new Error('unavailable'), { code: 14 });
  var fl = await quietly(function () { return T.countHit(FB, flaky, 'open', false, NOW); });
  check('an update failing with code 14: its counts are dropped, the id stays known', FB.docs['promoSends/' + flaky].opens === 1 && T.state().known.has(flaky) &&
    fl.lines.length === 1 && /counts could not be saved \(14\)/.test(fl.lines[0]), fl.lines);
  FB.updateFail = null;
  await wait(20);
  await T.countHit(FB, flaky, 'open', false, NOW);
  check('… and the next hit is written without another check', FB.docs['promoSends/' + flaky].opens === 2 && FB.reads === 1);

  /* 5.10 too many sends counting at once */
  fresh({ MAX_PENDING: 1 });
  var p1 = sid(), p2 = sid(); seed(p1); seed(p2);
  FB.holdReads = true;
  var hp1 = T.countHit(FB, p1, 'open', false, NOW);
  var full = await quietly(function () { return T.countHit(FB, p2, 'open', false, NOW); });
  check('a new send arriving at MAX_PENDING is dropped, with no read', FB.reads === 1 && !T.state().pending.has(p2) &&
    full.lines.length === 1 && /too many mailers counting at once — a hit was dropped/.test(full.lines[0]), full.lines);
  FB.heldReads.splice(0).forEach(function (go) { go(); });
  FB.holdReads = false;
  await hp1;
  check('… while the one already counting is written', FB.docs['promoSends/' + p1].opens === 1 && FB.docs['promoSends/' + p2].opens === 0);

  /* 5.11 flushAll */
  fresh({ WRITE_GAP_MS: 60000, HIT_WAIT_MS: 5000 });
  var fx = sid(); seed(fx);
  await T.countHit(FB, fx, 'open', false, NOW);
  var waiter = tracked(T.countHit(FB, fx, 'open', false, NOW));   // a minute away by the spacing
  await ticks();
  check('a write a minute away is scheduled, not written', FB.docs['promoSends/' + fx].opens === 1 && !waiter.done);
  var t0 = Date.now();
  await track.flushAll(1000);
  await ticks();
  check('flushAll writes it at once and resolves', FB.docs['promoSends/' + fx].opens === 2 && Date.now() - t0 < 500 && waiter.done, Date.now() - t0);
  check('… and holds nothing afterwards', T.state().pending.size === 0);
  fresh();
  FB.holdUpdates = true;
  var fy = sid(); seed(fy);
  var fyHit = T.countHit(FB, fy, 'open', false, NOW);
  await ticks();
  var t1 = Date.now();
  await track.flushAll(80);
  check('flushAll gives up after its time limit when a write hangs, and never rejects', Date.now() - t1 >= 70 && Date.now() - t1 < 1000);
  FB.held.splice(0).forEach(function (x) { x.go(); });
  FB.holdUpdates = false;
  await fyHit;
  check('flushAll with nothing pending resolves at once', await Promise.race([track.flushAll(5000).then(function () { return true; }), wait(200).then(function () { return false; })]));

  /* 5.11b SIGTERM while a send is still being checked: server.js exits the moment flushAll resolves, so it must wait
     for the check and the write it starts — and for hits counted after it began */
  fresh({ WRITE_GAP_MS: 60000, HIT_WAIT_MS: 5000 });
  var fc = sid(), fl2 = sid(); seed(fc); seed(fl2);
  FB.holdReads = true;
  T.countHit(FB, fc, 'open', false, NOW); T.countHit(FB, fc, 'open', false, NOW);
  await ticks();
  check('two hits on a send this instance has not checked: one read held, nothing written', FB.reads === 1 && FB.updates.length === 0 && T.state().probing.has(fc));
  var flushed = tracked(track.flushAll(3000));
  await ticks();
  check('flushAll does not resolve while that check is running', !flushed.done);
  T.countHit(FB, fl2, 'click', false, NOW);       // a new send, counted after flushAll began: its check is held too
  await ticks();
  check('… a send first hit after flushAll began starts its own check', FB.reads === 2 && !flushed.done);
  FB.holdReads = false;
  FB.heldReads.shift()();                         // the first send's check answers; the later one's is still held
  await ticks(10);
  check('… the first send is written as soon as its check confirms it, and flushAll still waits for the later one',
    FB.docs['promoSends/' + fc].opens === 2 && FB.docs['promoSends/' + fl2].clicks === 0 && !flushed.done, [FB.docs['promoSends/' + fc].opens, flushed.done]);
  FB.heldReads.splice(0).forEach(function (go) { go(); });
  var tf = Date.now();
  while (!flushed.done && Date.now() - tf < 1500) await ticks(1);
  check('… once that check answers too, it is written and flushAll resolves', flushed.done && FB.docs['promoSends/' + fl2].clicks === 1 && Date.now() - tf < 500,
    [FB.docs['promoSends/' + fl2].clicks, Date.now() - tf]);
  check('… and holds nothing afterwards', T.state().pending.size === 0 && T.state().probing.size === 0);
  fresh({ WRITE_GAP_MS: 60000, HIT_WAIT_MS: 5000 });
  var fk = sid(), fm = sid(); seed(fk);
  await T.countHit(FB, fk, 'open', false, NOW);       // known and written; the next write is a minute away
  FB.holdUpdates = true;
  T.countHit(FB, fk, 'open', false, NOW);
  var flushed2 = tracked(track.flushAll(3000));
  await ticks();
  check('flushAll waits for the write it started', !flushed2.done && FB.held.length === 1);
  T.countHit(FB, fk, 'open', false, NOW);             // counted while that write runs
  T.countHit(FB, fm, 'open', false, NOW);             // an id that does not exist, checked while flushing
  FB.held.splice(0).forEach(function (x) { x.go(); });
  await ticks();
  FB.held.splice(0).forEach(function (x) { x.go(); });
  FB.holdUpdates = false;
  var tf2 = Date.now();
  while (!flushed2.done && Date.now() - tf2 < 1500) await ticks(1);
  check('… and the hit counted meanwhile is written before it resolves', flushed2.done && FB.docs['promoSends/' + fk].opens === 3 && !FB.docs['promoSends/' + fm] &&
    T.state().pending.size === 0, [FB.docs['promoSends/' + fk].opens, T.state().pending.size]);
  fresh({ WRITE_GAP_MS: 10 });
  var fh = sid(); seed(fh);
  FB.holdReads = true;
  T.countHit(FB, fh, 'open', false, NOW);
  var t2 = Date.now(), sweeps = 0, realSetImmediate = global.setImmediate;
  global.setImmediate = function (f) { sweeps++; return realSetImmediate(f); };
  try { await track.flushAll(60); } finally { global.setImmediate = realSetImmediate; }
  check('a check that never answers still lets flushAll give up at its time limit', Date.now() - t2 >= 50 && Date.now() - t2 < 1000, Date.now() - t2);
  check('… having waited on the check, not gone round and round meanwhile', sweeps === 0, sweeps);
  FB.heldReads.splice(0).forEach(function (go) { go(); });
  FB.holdReads = false;
  await ticks();

  /* 5.12 nothing here looks at the caller's address */
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('no per-address limit: the source never reads x-forwarded-for, the socket address or http.js rateLimit',
    !/x-forwarded-for|rateLimit|clientIp|remoteAddress/i.test(src));
  check('the only requires are the engine, firebase, http and firebase-admin', (code.match(/require\('[^']+'\)/g) || []).sort().join() ===
    ["require('./firebase')", "require('./http')", "require('./vendor/promo-engine')", "require('firebase-admin')"].join(), code.match(/require\('[^']+'\)/g));
  check('no log line mentions NOT_FOUND', !/NOT_FOUND/.test(src));

  /* ---------- 6. the routes ---------- */
  env({ K_SERVICE: 'svc', TRACK_SECRET: KEY, MAILER_TRACK_BASE: 'https://track.example' });

  /* 6.1 the pixel */
  fresh({ WRITE_GAP_MS: 10 });
  var px = sid(); seed(px);
  var r = await call(track.handleOpen, 'GET', '/t/o/' + px + '.gif');
  check('pixel: 200, the 42-byte GIF', r.status === 200 && r.body && r.body.equals(T.PIXEL) && r.body.length === 42);
  check('pixel: exactly the §3b headers', JSON.stringify(r.names) === JSON.stringify(['Content-Type', 'Content-Length', 'Cache-Control', 'Pragma', 'Expires', 'X-Content-Type-Options']) &&
    r.headers['content-type'] === 'image/gif' && r.headers['content-length'] === 42 && r.headers['cache-control'] === 'no-store, no-cache, must-revalidate, private' &&
    r.headers.pragma === 'no-cache' && r.headers.expires === '0' && r.headers['x-content-type-options'] === 'nosniff', r.headers);
  check('pixel: the open is counted', FB.docs['promoSends/' + px].opens === 1);
  await wait(20);
  r = await call(track.handleOpen, 'HEAD', '/t/o/' + px + '.gif');
  check('pixel HEAD: the headers, no body, counted as a machine', r.status === 200 && r.body === null && r.headers['content-length'] === 42 &&
    FB.docs['promoSends/' + px].botOpens === 1 && FB.docs['promoSends/' + px].opens === 1);
  await wait(20);
  r = await call(track.handleOpen, 'GET', '/t/o/' + px + '.GIF?utm=x');
  check('pixel: .GIF in capitals and a query are fine', r.status === 200 && FB.docs['promoSends/' + px].opens === 2);
  await wait(20);
  r = await call(track.handleOpen, 'GET', '/t/o/' + px);
  check('pixel: the id is also taken without .gif (as the source)', r.status === 200 && FB.docs['promoSends/' + px].opens === 3);
  var readsPx = FB.reads;
  r = await call(track.handleOpen, 'GET', '/t/o/abc.gif');
  check('pixel: an invalid id still gets the GIF, with no read', r.status === 200 && r.body.equals(T.PIXEL) && FB.reads === readsPx);
  r = await call(track.handleOpen, 'GET', '/t/o/%E0%A4%A.gif');
  check('pixel: an id that cannot be decoded still gets the GIF', r.status === 200 && r.body.equals(T.PIXEL) && FB.reads === readsPx);
  FB_ERROR = 'FIREBASE_STORAGE_BUCKET is not set';
  r = await call(track.handleOpen, 'GET', '/t/o/' + sid() + '.gif');
  check('pixel: Firestore not configured — the GIF anyway', r.status === 200 && r.body.equals(T.PIXEL));
  FB_ERROR = null;
  fresh({ WRITE_GAP_MS: 5 });
  var one = sid(); seed(one);
  var pxAll = [];
  for (var pp = 0; pp < 200; pp++) pxAll.push(call(track.handleOpen, 'GET', '/t/o/' + one + '.gif', { headers: { 'x-forwarded-for': '203.0.113.7' } }));
  await Promise.all(pxAll);
  await wait(30);
  check('200 opens from one address (a mail provider\'s image proxy): every one counted', FB.docs['promoSends/' + one].opens === 200, FB.docs['promoSends/' + one].opens);

  /* 6.2 clicks */
  fresh({ WRITE_GAP_MS: 5 });
  var ck = sid(); seed(ck);
  function link(id, target, sig) { return '/t/c/' + id + '?u=' + encodeURIComponent(target) + '&s=' + (sig === undefined ? engine.signClick(id, target) : sig); }
  var TARGET = 'https://sponsor.example/path?a=1&b=two#frag';
  r = await call(track.handleClick, 'GET', link(ck, TARGET));
  check('a signed click: 302 to the target', r.status === 302 && r.headers.location === T.encodeUrl(TARGET) && r.headers.location === TARGET, r);
  check('… with no-store and an empty body', r.headers['cache-control'] === 'no-store' && r.headers['content-length'] === 0 && r.body === null);
  check('… and counted', FB.docs['promoSends/' + ck].clicks === 1 && FB.docs['promoSends/' + ck].days[T.dayKey(Date.now())].c === 1);
  var UNI = 'https://x.example/é?q=a b';
  r = await call(track.handleClick, 'GET', link(ck, UNI));
  check('Location is encodeurl\'s, as Express sent it', r.status === 302 && r.headers.location === T.encodeUrl(UNI) && r.headers.location === 'https://x.example/%C3%A9?q=a%20b', r.headers.location);
  await wait(10);
  r = await call(track.handleClick, 'GET', link(ck, TARGET), { ua: 'Mimecast Safe Links' });
  check('a gateway following the link: 302, counted as a machine', r.status === 302 && FB.docs['promoSends/' + ck].botClicks === 1);
  async function isBad(url, label) {
    var x = await call(track.handleClick, 'GET', url);
    check(label + ': 400 bad link', x.status === 400 && x.text === 'bad link' && x.headers['content-type'] === 'text/plain; charset=utf-8' &&
      x.headers['cache-control'] === 'no-store' && x.headers['x-content-type-options'] === 'nosniff', [x.status, x.text]);
  }
  var clicksBefore = FB.docs['promoSends/' + ck].clicks;
  await isBad('/t/c/' + ck + '?u=' + encodeURIComponent(TARGET), 'unsigned');
  await isBad(link(ck, TARGET, 'AAAAAAAAAAAAAAAA'), 'a wrong signature');
  await isBad(link(ck, TARGET + 'x', engine.signClick(ck, TARGET)), 'one character of u changed');
  await isBad(link(ck, 'javascript:alert(1)'), 'u=javascript:alert(1), even signed');
  await isBad(link(ck, TARGET) + '&u=' + encodeURIComponent(TARGET), 'a duplicated u');
  await isBad('/t/c/' + ck + '?s=' + engine.signClick(ck, TARGET), 'no u');
  await isBad(link(ck, 'https://x.example/\u0001a'), 'a control character');
  await isBad(link(ck, '/relative/path'), 'a relative target');
  await isBad(link('short', TARGET), 'an id that is not a send id');
  check('nothing refused was counted', FB.docs['promoSends/' + ck].clicks === clicksBefore);
  var good = link(ck, TARGET);
  env({ K_SERVICE: 'svc', MAILER_TRACK_BASE: 'https://track.example' });
  var noKey = await quietly(function () { return call(track.handleClick, 'GET', good); });
  check('TRACK_SECRET unset: 400 bad link, and said so in the log', noKey.value.status === 400 && noKey.value.text === 'bad link' &&
    noKey.lines.length === 1 && noKey.lines[0] === 'promo-track: TRACK_SECRET is not set — tracked links cannot be checked', noKey.lines);
  var noKey2 = await quietly(function () { return call(track.handleClick, 'GET', good); });
  check('… logged at most once per 10 minutes', noKey2.value.status === 400 && noKey2.lines.length === 0);
  env({ K_SERVICE: 'svc', TRACK_SECRET: KEY });
  r = await call(track.handleClick, 'GET', good);
  check('MAILER_TRACK_BASE unset: links already sent still redirect', r.status === 302);
  env({ TRACK_SECRET: KEY });
  r = await call(track.handleClick, 'GET', good);
  check('a local server (tracking for qa- only): links still redirect', r.status === 302);
  env({ K_SERVICE: 'svc', TRACK_SECRET: KEY2, TRACK_SECRET_PREVIOUS: KEY, MAILER_TRACK_BASE: 'https://track.example' });
  r = await call(track.handleClick, 'GET', good);
  check('signed with the previous key, during a rotation: 302', r.status === 302);
  env({ K_SERVICE: 'svc', TRACK_SECRET: KEY2, MAILER_TRACK_BASE: 'https://track.example' });
  await isBad(good, 'signed with a key that was dropped');
  env({ K_SERVICE: 'svc', TRACK_SECRET: KEY, MAILER_TRACK_BASE: 'https://track.example' });
  fresh();
  var down = sid(); seed(down);
  FB.readFail = Object.assign(new Error('unavailable'), { code: 14 });
  var dn = await quietly(function () { return call(track.handleClick, 'GET', link(down, TARGET)); });
  check('signed, with Firestore failing: still 302', dn.value.status === 302 && dn.value.headers.location === TARGET);
  FB.readFail = null;
  FB_ERROR = 'not configured';
  r = await call(track.handleClick, 'GET', link(down, TARGET));
  check('signed, with Firestore not configured: still 302', r.status === 302);
  FB_ERROR = null;
  r = await call(track.handleClick, 'HEAD', link(down, TARGET));
  check('HEAD on a signed link: 302, counted as a machine', r.status === 302 && FB.docs['promoSends/' + down].botClicks === 1 && FB.docs['promoSends/' + down].clicks === 0);

  /* 6.3 one event's dashboard */
  fresh();
  var C1 = '2026-10-01T10:00:00.000Z', C0 = '2026-08-01T10:00:00.000Z';
  FB.docs['events/demo-ev'] = { name: 'Demo', createdAt: C1 };
  FB.docs['events/gone-ev'] = { name: 'Gone', createdAt: C1, deletedAt: '2026-10-20T00:00:00.000Z' };
  FB.docs['events/qa-ev'] = { name: 'QA', createdAt: C1 };
  var today = T.dayKey(Date.now()), tdays = {}; tdays[today] = { o: 2, c: 1 };
  var e1 = sid(), e2 = sid(), e3 = sid(), e4 = sid();
  seed(e1, 'demo-ev', { eventCreatedAt: C1, opens: 2, clicks: 1, botOpens: 3, createdAt: 200, days: tdays });
  seed(e2, 'demo-ev', { eventCreatedAt: C1, opens: 1, createdAt: 100, mailerId: 'mailer.reminder', mailerLabel: 'Reminder' });
  seed(e3, 'demo-ev', { eventCreatedAt: C0, opens: 50, createdAt: 300 });     // the address's earlier event
  seed(e4, 'other-ev', { eventCreatedAt: C1, opens: 70, createdAt: 400 });
  r = await call(track.handleAnalytics, 'GET', '/api/promo/analytics?eventId=demo-ev', { auth: true });
  var A = r.json;
  check('per event: 200, only this event\'s sends made while it existed', r.status === 200 && A.totals.sends === 2 && A.totals.opens === 3 && A.totals.clicks === 1 &&
    A.sends.map(function (s) { return s.id; }).join() === [e1, e2].join(), A && A.totals);
  check('… machines in filtered, today in the series', A.filtered.opens === 3 && A.series[29].date === today && A.series[29].opens === 2 && A.series[29].clicks === 1);
  check('… the C7 shape, firestore while tracking runs here', A.available === true && A.backend === 'firestore' && A.sends[0].event === 'demo-ev' &&
    !('by' in A.sends[0]) && !('days' in A.sends[0]) && A.topOpenedTemplates[0].key === 'mailer.announcement' && Array.isArray(A.topClickedSubjects) &&
    typeof A.versions === 'object');
  check('… no-store', r.headers['cache-control'] === 'no-store');
  check('… one indexed query on eventId', FB.queries.length === 1 && FB.queries[0].path === 'promoSends' && JSON.stringify(FB.queries[0].filters) === '[["eventId","==","demo-ev"]]');
  var fields = FB.queries[0].fields;
  check('select(): the §3h fields, then the window\'s 30 days, never by', fields.length === 44 &&
    JSON.stringify(fields.slice(0, 14)) === JSON.stringify(['eventId', 'eventCreatedAt', 'portal', 'eventName', 'mailerId', 'mailerLabel', 'subject', 'saveId', 'saveName',
      'createdAt', 'opens', 'clicks', 'botOpens', 'botClicks']) &&
    fields.slice(14).every(function (f, j) { return f.segments && f.segments.length === 2 && f.segments[0] === 'days' && f.segments[1] === T.windowDays(Date.now())[j]; }) &&
    !fields.some(function (f) { return f === 'by' || (f.segments && f.segments[0] === 'by'); }));
  await call(track.handleAnalytics, 'GET', '/api/promo/analytics?eventId=demo-ev', { auth: true });
  check('per event: not cached — two loads, two queries', FB.queries.length === 2);
  r = await call(track.handleAnalytics, 'GET', '/api/promo/analytics?eventId=Bad%20Id', { auth: true });
  check('per event: a bad eventId is 400', r.status === 400);
  r = await call(track.handleAnalytics, 'GET', '/api/promo/analytics', { auth: true });
  check('per event: no eventId is 400', r.status === 400);
  r = await call(track.handleAnalytics, 'GET', '/api/promo/analytics?eventId=gone-ev', { auth: true });
  check('per event: a deleted event is 404 event-deleted', r.status === 404 && r.json.code === 'event-deleted');
  r = await call(track.handleAnalytics, 'GET', '/api/promo/analytics?eventId=never-was', { auth: true });
  check('per event: a missing event is 404 event-not-found', r.status === 404 && r.json.code === 'event-not-found');
  r = await call(track.handleAnalytics, 'GET', '/api/promo/analytics?eventId=demo-ev');
  check('per event: signed out is 401 (withAdmin)', r.status === 401);
  env({ TRACK_SECRET: KEY, MAILER_TRACK_BASE: 'http://localhost:8161' });
  r = await call(track.handleAnalytics, 'GET', '/api/promo/analytics?eventId=demo-ev', { auth: true });
  check('per event, local server, a real event: backend none (not tracked here)', r.json.backend === 'none' && r.json.available === false && r.json.totals.sends === 2);
  r = await call(track.handleAnalytics, 'GET', '/api/promo/analytics?eventId=qa-ev', { auth: true });
  check('per event, local server, a qa- event: backend firestore', r.json.backend === 'firestore' && r.json.available === true);
  env({ K_SERVICE: 'svc', TRACK_SECRET: KEY, MAILER_TRACK_BASE: 'https://track.example' });
  FB.queryFail = new Error('boom');
  var qf = await quietly(function () { return call(track.handleAnalytics, 'GET', '/api/promo/analytics?eventId=demo-ev', { auth: true }); });
  check('per event: a failed read is the plain sentence, 500', qf.value.status === 500 && qf.value.json.error === 'Mailer performance could not be loaded. Please try again.' &&
    failures.pop() === 'mailer performance');
  FB.queryFail = null;

  /* 6.4 the team view */
  fresh();
  var CA = '2026-09-01T00:00:00.000Z', CD1 = '2026-07-01T00:00:00.000Z', CD2 = '2026-10-10T00:00:00.000Z';
  FB.docs['events/live-a'] = { createdAt: CA };
  FB.docs['events/dead-b'] = { createdAt: CA, deletedAt: '2026-10-20T00:00:00.000Z' };
  FB.docs['events/qa-c'] = { createdAt: CA };
  FB.docs['events/reuse-d'] = { createdAt: CD2 };
  var ta = sid(), tb = sid(), tc = sid(), td1 = sid(), td2 = sid(), te = sid();
  seed(ta, 'live-a', { eventCreatedAt: CA, opens: 1, createdAt: 10 });
  seed(tb, 'dead-b', { eventCreatedAt: CA, opens: 2, createdAt: 20 });
  seed(tc, 'qa-c', { eventCreatedAt: CA, opens: 4, createdAt: 30 });
  seed(td1, 'reuse-d', { eventCreatedAt: CD1, opens: 8, createdAt: 40 });
  seed(td2, 'reuse-d', { eventCreatedAt: CD2, opens: 16, createdAt: 50 });
  seed(te, 'no-such-event', { eventCreatedAt: CA, opens: 32, createdAt: 60 });
  r = await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all', { auth: true });
  check('team: live events\' current sends only — no qa-, deleted, missing or earlier-event rows', r.status === 200 &&
    r.json.sends.map(function (s) { return s.id; }).join() === [td2, ta].join() && r.json.totals.opens === 17, r.json && r.json.sends.map(function (s) { return s.event; }));
  check('team: deployed with tracking on is firestore', r.json.backend === 'firestore' && r.json.available === true);
  check('team: one collection read, events read with their createdAt and deletedAt only', FB.queries.length === 1 && FB.queries[0].filters.length === 0 &&
    FB.queries[0].fields.length === 44 && FB.readCalls.length === 1 && JSON.stringify(FB.readCalls[0].opts.fieldMask) === '["createdAt","deletedAt"]' &&
    FB.readCalls[0].paths.indexOf('events/qa-c') === -1, FB.readCalls);
  var reads1 = FB.reads;
  r = await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all', { auth: true });
  check('team: a repeat within 30 s reads nothing', r.status === 200 && FB.queries.length === 1 && FB.reads === reads1 && r.json.totals.sends === 2);
  r = await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all?fresh=1', { auth: true });
  check('team: fresh=1 reads again', FB.queries.length === 2 && r.json.totals.sends === 2);
  await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all', { auth: true });
  check('team: … and its result is the new cache', FB.queries.length === 2);
  await track.recordSends(FB, [Object.assign({}, m1, { id: 'bbbbbbbbbbb1', eventId: 'live-a', eventCreatedAt: CA, createdAt: 99 })]);
  check('team: recording a send clears the cache', T.state().team.rows === null);
  r = await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all', { auth: true });
  check('team: … so the next load reads, and shows it', FB.queries.length === 3 && r.json.totals.sends === 3 && r.json.sends[0].id === 'bbbbbbbbbbb1');
  T.NUMBERS.TEAM_CACHE_MS = 0;
  await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all', { auth: true });
  check('team: an expired cache reads again', FB.queries.length === 4);
  T.NUMBERS.TEAM_CACHE_MS = DEFAULTS.TEAM_CACHE_MS;
  env({ TRACK_SECRET: KEY, MAILER_TRACK_BASE: 'http://localhost:8161' });
  r = await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all?fresh=1', { auth: true });
  check('team: a local server is none (it tracks qa- only, which this view leaves out)', r.json.backend === 'none' && r.json.available === false);
  env({ K_SERVICE: 'svc', TRACK_SECRET: KEY, MAILER_TRACK_BASE: 'https://track.example' });
  r = await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all');
  check('team: signed out is 401', r.status === 401);

  fresh();
  for (var ev = 0; ev < 301; ev++) {
    var eid = 'ev-' + ev;
    FB.docs['events/' + eid] = { createdAt: CA };
    seed(sid(), eid, { eventCreatedAt: CA, opens: 1 });
  }
  r = await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all', { auth: true });
  check('team: events read in chunks of 300', FB.readCalls.length === 2 && FB.readCalls[0].paths.length === 300 && FB.readCalls[1].paths.length === 1 &&
    r.json.totals.sends === 301 && r.json.sends.length === 200, FB.readCalls.map(function (c) { return c.paths.length; }));
  fresh();
  r = await call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all', { auth: true });
  check('team: no sends at all — the empty summary, no event read', r.status === 200 && r.json.totals.sends === 0 && FB.readCalls.length === 0);
  FB.queryFail = new Error('boom');
  var tf = await quietly(function () { return call(track.handleAnalyticsAll, 'GET', '/api/promo/analytics/all?fresh=1', { auth: true }); });
  check('team: a failed read is the plain sentence, 500', tf.value.status === 500 && tf.value.json.error === 'Mailer performance could not be loaded. Please try again.');
  FB.queryFail = null;

  T.resetState();
}

main().then(function () {
  console.log('promo-track: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error('promo-track: the test itself failed — ' + (err && err.stack || err));
  process.exit(1);
});
