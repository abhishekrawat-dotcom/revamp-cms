/* node functions/lib/reg-reporting.test.js — Reporting in the event console (launch check REG-003, 016, 019, 024, 025, 027):
     - POST /api/event/registrations/status (REG-019), through the real router against an in-memory Firestore: one
       status for several responses at once, the totals moving with them exactly as one at a time, approving and
       declining recorded, a waitlist refused for a form that does not count, one Activity line, batches past 100;
     - GET /api/event/dashboard-stats (REG-024): from which day page views are counted, and every day before it is
       "not counted" (null), never a zero;
     - the "Who registered" filter of Reporting › Registrations (REG-025) matches a registration exactly when the
       server counts it under that value (functions/lib/api-audience.js aggValues / aggKeyOf);
     - the console Dashboard (edit-event-dashboard.js in a vm over the real core): the Over time chart with its
       7 / 30 / 90-day switch and no unique visitors, and the Who registered cards linking to the filtered list;
     - audience-registrations.html as a file: the empty state, Refresh, the bulk bar, the sentence "This changes the
       status only. Nobody is notified." beside every status control, and the confirmation that focuses Cancel and
       keeps Tab inside it.
   No network, no real project. Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

/* ---------- an in-memory Firestore, with increments and FieldPath updates that add up ---------- */
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function isInc(v) { return !!v && typeof v === 'object' && typeof v.operand === 'number' && /Increment/i.test((v.constructor && v.constructor.name) || ''); }
function put(obj, keys, v) {
  var o = obj;
  for (var i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  var last = keys[keys.length - 1];
  if (isInc(v)) o[last] = (+o[last] || 0) + v.operand;
  else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some(function (k) { return isInc(v[k]) || (v[k] && typeof v[k] === 'object'); })) {
    if (!o[last] || typeof o[last] !== 'object') o[last] = {};
    Object.keys(v).forEach(function (k) { put(o[last], [k], v[k]); });
  } else o[last] = clone(v);
}
function fakeFb() {
  var docs = {}, autoN = 1000, txRuns = 0;
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  /* set / merge(data) / update(data) / update(FieldPath, value, FieldPath, value, …) as the SDK takes them */
  function write(p, args, mode) {
    if (mode === 'set') docs[p] = {};
    if (mode === 'update' && !docs[p]) throw new Error('NOT_FOUND ' + p);
    if (!docs[p]) docs[p] = {};
    if (args[0] && args[0].segments) {
      for (var i = 0; i < args.length; i += 2) put(docs[p], args[i].segments, args[i + 1]);
      return;
    }
    var data = args[0];
    Object.keys(data).forEach(function (k) { put(docs[p], mode === 'update' ? k.split('.') : [k], data[k]); });
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, [data], o && o.merge ? 'merge' : 'set'); return Promise.resolve(); },
      update: function () { try { write(p, [].slice.call(arguments), 'update'); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p) {
    var q = { path: p, doc: function (id) { return docRef(p + '/' + (id || 'auto' + (++autoN))); },
      add: function (data) { var r = docRef(p + '/auto' + (++autoN)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; }, where: function () { return q; },
      startAfter: function () { return q; },
      count: function () { return { get: function () { return q.get().then(function (s) { return { data: function () { return { count: s.size }; } }; }); } }; },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).sort().map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      } };
    return q;
  }
  var db = { collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      txRuns++;
      var tx = { get: function (r) { return r.get(); },
        set: function (r, d, o) { write(r.path, [d], o && o.merge ? 'merge' : 'set'); return tx; },
        update: function (r) { write(r.path, [].slice.call(arguments, 1), 'update'); return tx; },
        delete: function (r) { delete docs[r.path]; return tx; } };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, [d], o && o.merge ? 'merge' : 'set'); }); },
        update: function (r) { var a = [].slice.call(arguments, 1); ops.push(function () { write(r.path, a, 'update'); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); },
        commit: function () { try { ops.forEach(function (f) { f(); }); return Promise.resolve(); } catch (e) { return Promise.reject(e); } } };
    } };
  var auth = { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' }, auth_time: Math.floor(Date.now() / 1000) }); } };
  return { db: db, bucket: { name: 'b', file: function () { return {}; } }, auth: auth, docs: docs, txRuns: function () { return txRuns; } };
}
var FB = fakeFb();
function stub(name, exports) { var id = require.resolve(name); require.cache[id] = { id: id, filename: id, loaded: true, exports: exports }; }
stub('./firebase', { getFirebase: function () { return FB; } });
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
process.env.ACCESS_CONFIG_DOC = 'config/test-reg-reporting-access';
var api = require('./api');
var A = require('./api-audience');
var AC = require('./access-control');

var ipN = 0;
function call(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = Object.assign({ host: 'localhost', 'user-agent': 'Mozilla/5.0 Chrome/126.0', 'x-forwarded-for': '198.51.100.' + ((ipN++ % 200) + 1) }, opts.headers || {});
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    var body = opts.body ? JSON.stringify(opts.body) : '';
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* not json */ } resolve({ status: res.statusCode, text: t, body: j }); } };
    api.handleApi(req, res);
  });
}

var NOW = '2026-11-01T09:00:00.000Z';
function seedEvent(id, regs) {
  var c = { audienceV: 2, registrations: 0, confirmed: 0, waitlist: 0, pending: 0, rejected: 0, cancelled: 0, checkedIn: 0, submissions: 0, forms: {} };
  Object.keys(FB.docs).forEach(function (k) { if (k.indexOf('events/' + id + '/') === 0) delete FB.docs[k]; });
  regs.forEach(function (r, i) {
    var doc = Object.assign({ name: 'Person ' + i, email: 'p' + i + '@example.com', formId: 'register', counts: true, status: 'confirmed', createdAt: NOW }, r.doc);
    FB.docs['events/' + id + '/registrations/' + r.id] = doc;
    c.submissions++;
    var f = c.forms[doc.formId] || (c.forms[doc.formId] = { n: 0, pending: 0 });
    f.n++; if (doc.status === 'pending') f.pending++;
    if (doc.counts !== false) { c.registrations++; c[doc.status]++; }
  });
  FB.docs['events/' + id] = { name: 'QA Bulk', createdAt: NOW, counters: c };
}
function counters(id) { return FB.docs['events/' + id].counters; }
function activity(id) { return Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + id + '/activity/') === 0; }).map(function (k) { return FB.docs[k]; }); }

(async function () {
  /* ================= POST /api/event/registrations/status (REG-019) ================= */
  ok(AC.needFor('POST', '/api/event/registrations/status') === 'editor', 'a bulk status change needs Editor, as every change does (a Viewer is refused)');

  seedEvent('qa-bulk', [
    { id: 'r1', doc: { status: 'pending' } }, { id: 'r2', doc: { status: 'pending' } }, { id: 'r3', doc: { status: 'pending' } },
    { id: 'r4', doc: { status: 'confirmed' } },
    { id: 'p1', doc: { formId: 'partner', counts: false, status: 'confirmed', enquiry: 'partner' } }
  ]);
  var r = await call('POST', '/api/event/registrations/status', { token: 'owner', body: { eventId: 'qa-bulk', ids: ['r1', 'r2', 'r4', 'gone1', 'r1'], status: 'confirmed' } });
  var c = counters('qa-bulk');
  ok(r.status === 200 && r.body.ok === true && r.body.updated.length === 2 && JSON.stringify(r.body.unchanged) === '["r4"]' && JSON.stringify(r.body.missing) === '["gone1"]',
    'approve two awaiting approval: two changed, one already confirmed left alone, one id that is not there said so, the repeat sent once', r.status + ' ' + r.text.slice(0, 400));
  ok(c.confirmed === 3 && c.pending === 1 && c.registrations === 4 && c.forms.register.pending === 1 && c.forms.register.n === 4 && c.submissions === 5,
    'the totals move with the responses: confirmed +2, awaiting approval -2 (the form\'s own count too), nothing else', c);
  var r1 = FB.docs['events/qa-bulk/registrations/r1'];
  ok(r1.status === 'confirmed' && r1.decidedBy === 'owner@timesinternet.in' && typeof r1.decidedAt === 'string' && r1.updatedBy === 'owner@timesinternet.in',
    'approving records who decided and when, as one at a time does', r1);
  ok(r.body.updated[0].id === 'r1' && r.body.updated[0].status === 'confirmed' && r.body.updated[0].decidedBy === 'owner@timesinternet.in' && r.body.updated[0].email === 'p0@example.com',
    'the answer carries each changed response as the list shows it', r.body.updated[0]);
  var log = activity('qa-bulk');
  ok(log.length === 1 && log[0].action === 'registration-updated' && log[0].detail === '2 registrations at once — 2 approved' && log[0].area === 'registrations',
    'one Activity line for the request, in words', log);

  r = await call('POST', '/api/event/registrations/status', { token: 'owner', body: { eventId: 'qa-bulk', ids: ['r3', 'p1', 'r4'], status: 'waitlist' } });
  c = counters('qa-bulk');
  ok(r.status === 200 && r.body.updated.length === 2 && r.body.skipped.length === 1 && r.body.skipped[0].id === 'p1' && /Only forms that count as registrations have a waitlist/.test(r.body.skipped[0].reason) &&
    FB.docs['events/qa-bulk/registrations/p1'].status === 'confirmed', 'a response to a form that does not count is not put on a waitlist, and the answer says why', r.text.slice(0, 400));
  ok(c.waitlist === 2 && c.pending === 0 && c.confirmed === 2 && c.forms.register.pending === 0 && c.registrations === 4,
    'waitlisting moves the totals: waitlist +2, the one still awaiting approval and one confirmed out', c);
  ok(activity('qa-bulk').some(function (a) { return a.detail === '2 registrations at once — 1 marked waitlist, 1 marked waitlist' || a.detail === '2 registrations at once — 2 marked waitlist'; }),
    'the Activity line counts each kind of change once', activity('qa-bulk').map(function (a) { return a.detail; }));

  r = await call('POST', '/api/event/registrations/status', { token: 'owner', body: { eventId: 'qa-bulk', ids: ['p1'], status: 'rejected' } });
  c = counters('qa-bulk');
  ok(r.status === 200 && r.body.updated.length === 1 && c.registrations === 4 && c.rejected === 0 && c.submissions === 5 && FB.docs['events/qa-bulk/registrations/p1'].status === 'rejected',
    'declining a response that is not a registration changes no registration total', c);

  /* refused before anything is read */
  var bad = [
    [{ eventId: 'qa-bulk', ids: ['r1'], status: 'approved' }, /Status must be one of/],
    [{ eventId: 'qa-bulk', ids: [], status: 'confirmed' }, /Choose at least one/],
    [{ eventId: 'qa-bulk', ids: 'r1', status: 'confirmed' }, /Choose at least one/],
    [{ eventId: 'qa-bulk', ids: ['../x'], status: 'confirmed' }, /valid registration id/],
    [{ eventId: 'qa-bulk', ids: [12], status: 'confirmed' }, /valid registration id/],
    [{ eventId: 'Not An Id', ids: ['r1'], status: 'confirmed' }, /valid eventId/],
    [{ eventId: 'qa-bulk', ids: new Array(501).fill('r1'), status: 'confirmed' }, /At most 500/]
  ];
  for (var i = 0; i < bad.length; i++) {
    r = await call('POST', '/api/event/registrations/status', { token: 'owner', body: bad[i][0] });
    ok(r.status === 400 && bad[i][1].test(r.body && r.body.error), 'refused with 400: ' + bad[i][1], r.status + ' ' + r.text);
  }
  r = await call('POST', '/api/event/registrations/status', { body: { eventId: 'qa-bulk', ids: ['r1'], status: 'cancelled' } });
  ok(r.status === 401 && FB.docs['events/qa-bulk/registrations/r1'].status === 'confirmed', 'signed out: 401, nothing changed', r.status);
  r = await call('POST', '/api/event/registrations/status', { token: 'owner', body: { eventId: 'qa-nothing-here', ids: ['r1'], status: 'cancelled' } });
  ok(r.status === 404, 'an event that is not there: 404', r.status + ' ' + r.text);

  /* more than one transaction's worth: 230 awaiting approval, approved in one request, in batches of 100 */
  var many = [];
  for (i = 0; i < 230; i++) many.push({ id: 'm' + (1000 + i), doc: { status: 'pending' } });
  seedEvent('qa-bulk-many', many);
  var runsBefore = FB.txRuns();
  r = await call('POST', '/api/event/registrations/status', { token: 'owner', body: { eventId: 'qa-bulk-many', ids: many.map(function (m) { return m.id; }), status: 'confirmed' } });
  c = counters('qa-bulk-many');
  ok(r.status === 200 && r.body.updated.length === 230 && c.confirmed === 230 && c.pending === 0 && c.forms.register.pending === 0 && FB.txRuns() - runsBefore === 3,
    '230 approved at once, in three transactions of at most 100, and the totals add up', [r.status, r.body && r.body.updated && r.body.updated.length, c, FB.txRuns() - runsBefore]);
  ok(activity('qa-bulk-many').length === 1 && activity('qa-bulk-many')[0].detail === '230 registrations at once — 230 approved', 'still one Activity line', activity('qa-bulk-many'));

  /* a later batch failing after an earlier one was saved: what was done is said, and what was not */
  seedEvent('qa-bulk-half', many.slice(0, 150));
  var realTx = FB.db.runTransaction, n = 0;
  FB.db.runTransaction = function (fn) { n++; return n === 2 ? Promise.reject(new Error('ABORTED: too much contention')) : realTx(fn); };
  r = await call('POST', '/api/event/registrations/status', { token: 'owner', body: { eventId: 'qa-bulk-half', ids: many.slice(0, 150).map(function (m) { return m.id; }), status: 'rejected' } });
  FB.db.runTransaction = realTx;
  c = counters('qa-bulk-half');
  ok(r.status === 500 && r.body.updated.length === 100 && r.body.notDone.length === 50 && r.body.notDone[0] === 'm1100' && /could not change all of them/.test(r.body.error) &&
    c.rejected === 100 && c.pending === 50 && !/ABORTED/.test(r.text),
    'a failure part-way: the 100 saved are listed, the 50 not done are named, the database\'s own words are not shown', [r.status, r.text.slice(0, 300), c]);
  ok(activity('qa-bulk-half').length === 1 && /^100 registrations at once — 100 declined$/.test(activity('qa-bulk-half')[0].detail), 'and the 100 that were changed are in the Activity log', activity('qa-bulk-half'));

  /* ================= GET /api/event/dashboard-stats: when page views began to be counted (REG-024) ================= */
  FB.docs['events/qa-dash'] = { name: 'QA Dash', createdAt: NOW, counters: { audienceV: 2, registrations: 3, confirmed: 3, views: 40 } };
  FB.docs['events/qa-dash/stats/2026-11-12'] = { date: '2026-11-12', views: 9, registrations: 1 };
  FB.docs['events/qa-dash/stats/2026-11-13'] = { date: '2026-11-13', views: 31, registrations: 2 };
  r = await call('GET', '/api/event/dashboard-stats?eventId=qa-dash&days=90', { token: 'owner' });
  var days = (r.body && r.body.byDay) || [];
  var day12 = days.filter(function (d) { return d.date === '2026-11-12'; })[0], day13 = days.filter(function (d) { return d.date === '2026-11-13'; })[0];
  ok(r.status === 200 && days.length === 90 && A.VISITS_SINCE === '2026-11-13', 'dashboard-stats: 90 days asked, 90 days given', r.status + ' ' + days.length);
  if (A.VISITS_COUNTED) {
    ok(r.body.visitsSince === '2026-11-13', 'it says from which India day page views are counted', r.body.visitsSince);
    ok(days.every(function (d) { return d.date < '2026-11-13' ? d.views === null : typeof d.views === 'number'; }),
      'a day before that is "not counted" (null), never a zero; from that day on a number', days.slice(-3));
    ok(day12 && day12.views === null && day12.registrations === 1 && day13 && day13.views === 31 && day13.registrations === 2,
      'registrations are counted every day; page views only from the day counting began', [day12, day13]);
  } else {
    ok(r.body.visitsSince === null && days.every(function (d) { return d.views === null; }), 'without the visit counter no day has page views', r.body.visitsSince);
  }

  /* ================= the "Who registered" filter matches what the server counts (REG-025) ================= */
  var page = read('audience-registrations.html');
  var helpers = ['aggText', 'byValueOf'].map(function (name) {
    var m = new RegExp('  function ' + name + '\\(([^)]*)\\)\\{[\\s\\S]*?\\n  \\}').exec(page);
    return m ? m[0] : '';
  }).join('\n');
  var box = {};
  vm.createContext(box);
  vm.runInContext(helpers + '\nthis.aggText = aggText; this.byValueOf = byValueOf;', box);
  var REGS = [
    { company: 'Tata Motors' }, { company: '  tata   MOTORS ' }, { company: 'Tata Motors Ltd' }, { company: 'Tata\tMotors' },
    { designation: 'Chief Information Officer' }, { designation: 'chief information officer ' },
    { city: 'Noida' }, { city: '', locationParts: { city: 'Noida' } }, { locationParts: { city: 'NOIDA' } }, { city: 'Gurugram', locationParts: { city: 'Noida' } },
    { source: 'LinkedIn' }, { source: 'mailer', utm: { source: 'LinkedIn' } }, { utm: { source: 'linkedin ' } }, {}, { source: 'website' }, { source: '' , utm: {} },
    { device: 'Mobile' }, { device: 'mobile' }, { device: 'desktop' }, { device: '' },
    { company: 'A'.repeat(70) }, { company: 'a'.repeat(60) + 'zzz' }
  ];
  var dims = ['company', 'designation', 'city', 'source', 'device'], agree = 0, disagree = [];
  dims.forEach(function (dim) {
    REGS.forEach(function (a) {
      var label = A.aggValues(a)[dim];
      if (!label) return;                       // a value the server does not list
      var wanted = box.aggText(label, dim === 'device' ? 20 : 60);
      REGS.forEach(function (b) {
        var server = !!A.aggValues(b)[dim] && A.aggKeyOf(A.aggValues(b)[dim]) === A.aggKeyOf(label);
        var client = box.byValueOf(b, dim) === wanted;
        if (server === client) agree++; else disagree.push([dim, label, b]);
      });
    });
  });
  ok(!disagree.length && agree > 200, 'Reporting shows a registration under a value exactly when the Dashboard counts it there (' + agree + ' pairs)', disagree.slice(0, 5));
  ok(/if \(S\.filter\.by && !\(counts\(r\) && byValueOf\(r, S\.filter\.by\) === byWanted\(\)\)\) return false;/.test(page),
    'the filter keeps registrations only (a form that counts), as the breakdowns do');
  ok(/by: String\(qs\.get\('by'\) \|\| ''\), value: String\(qs\.get\('value'\) \|\| ''\)/.test(page) && /if \(!BY\.hasOwnProperty\(S\.filter\.by\)/.test(page) &&
    /u\.searchParams\.set\('by', S\.filter\.by\); u\.searchParams\.set\('value', S\.filter\.value\);/.test(page) && /id="rep-by-x">Show all responses</.test(page),
    'read from the address, only for the five lists, kept in the address, and said above the list with the way back to every response');

  /* ================= audience-registrations.html as a file ================= */
  ok(page.indexOf('No responses yet</b>No responses yet') === -1, 'REG-003: the empty state says "No responses yet" once');
  ok(/function emptyHTML\(\)\{[\s\S]{0,400}C\.siteState\(S\.ev \|\| \{\}\)/.test(page) && /Open the live site<\/a>/.test(page) && /The site is not published yet, so nobody can register on it\./.test(page) &&
    /The site has been taken offline/.test(page) && /Go to the event<\/a>/.test(page) && /RevampRail\.href\('dashboard', eventId\)/.test(page),
    'REG-003: live -> a link to the live site; not live (or offline) -> says so, with a link to the event');
  ok(/id="btn-refresh"/.test(page) && /'Updated ' \+ C\.fmtTime\(new Date\(S\.loadedAt\)\)/.test(page) && /'Refreshing…'/.test(page) && /'Not refreshed: '/.test(page),
    'REG-016: Refresh, with "Updated <time>", "Refreshing…" and why it did not work');
  ok(/document\.addEventListener\('visibilitychange'/.test(page) && /var AWAY_MS = 60000;/.test(page) && /Date\.now\(\) - hiddenAt >= AWAY_MS\) refresh\(true\)/.test(page),
    'REG-016: back on the tab after a minute away, the list is read again quietly');
  var refreshSrc = (/  function refresh\(quiet\)\{[\s\S]*?\n  \}/.exec(page) || [''])[0];
  ok(/S\.touched\[r\.id\] >= began && mine\[r\.id\] \? mine\[r\.id\] : r/.test(refreshSrc) && /S\.gone\[r\.id\] >= began/.test(refreshSrc) && /drawResults\(\)/.test(refreshSrc) &&
    !/(S\.filter = |S\.sel = |S\.shown = |S\.openId = |closeDrawer\(\)|layer\.innerHTML|render\(\))/.test(refreshSrc),
    'REG-016: a refresh keeps the filters, the choice and an open response, and never undoes a change made meanwhile');
  var QUIET = 'This changes the status only. Nobody is notified.';
  ok(page.indexOf("var QUIET = '" + QUIET + "';") !== -1 && /id="dr-approve" aria-describedby="dr-quiet-1"/.test(page) && /<p class="dnote dquiet" id="dr-quiet-1">' \+ QUIET/.test(page) &&
    /<select id="dr-status" aria-describedby="dr-quiet-2">/.test(page) && /<p class="dnote dquiet" id="dr-quiet-2">' \+ QUIET/.test(page),
    'REG-019: "' + QUIET + '" beside Approve / Decline and beside Status in the drawer');
  ok(/'<p class="bnote" id="bulk-note">' \+ QUIET/.test(page) && /notes\.push\(QUIET\);/.test(page), 'REG-019: and in the bulk bar and its question');
  ok(/<th scope="col" class="sel"><input type="checkbox" id="sel-all" aria-label="Choose every response shown">/.test(page) && /data-sel="' \+ esc\(r\.id\) \+ '"/.test(page) &&
    /id="bulk-status"/.test(page) && /id="bulk-approve"/.test(page) && /id="bulk-decline"/.test(page) && /Choose all ' \+ comma\(matching\.length\) \+ ' that match/.test(page),
    'REG-019: rows can be chosen (one, every one shown, every one that matches) and given one status, or approved / declined');
  ok(/C\.setRegistrationsStatus\(eventId, chunk, status\)/.test(page) && /var BULK_CHUNK = 200;/.test(page) && /return Object\.keys\(S\.sel\)\.filter\(function\(id\)\{ return S\.sel\[id\] && byId\[id\] && matches\(byId\[id\]\); \}\);/.test(page),
    'REG-019: sent through the server in requests of 200, never to a response the filters hide');
  var core = read('edit-event-core.js');
  ok(/function setRegistrationsStatus\(eventId, ids, status\)\{[\s\S]{0,200}api\('POST', '\/api\/event\/registrations\/status'/.test(core) && /setRegistrationsStatus: setRegistrationsStatus/.test(core),
    'RevampCore.setRegistrationsStatus calls the bulk route');
  var askSrc = (/  function ask\(title, text, okLabel, danger\)\{[\s\S]*?\n  \}/.exec(page) || [''])[0];
  ok(/box\.querySelector\('button\[data-v="0"\]'\)\.focus\(\);/.test(askSrc) && !/button\[data-v="1"\]'\)\.focus/.test(askSrc), 'REG-027: the confirmation gives Cancel the focus, never Delete', askSrc.slice(-300));
  ok(/if \(e\.key !== 'Tab'\) return;\s*e\.preventDefault\(\); e\.stopPropagation\(\);/.test(askSrc) && /stops\[at === -1 \? 0 : \(at \+ \(e\.shiftKey \? stops\.length - 1 : 1\)\) % stops\.length\]\.focus\(\);/.test(askSrc),
    'REG-027: Tab and Shift+Tab stay on the confirmation\'s buttons');
  /* the trap itself, run: Tab and Shift+Tab go round the two buttons */
  (function () {
    var cancel = { n: 'cancel', focus: function () { at = cancel; } }, okBtn = { n: 'ok', focus: function () { at = okBtn; } }, at = null, handler = null;
    var fakeDoc = { get activeElement() { return at; }, addEventListener: function (t, f) { handler = f; }, removeEventListener: function () {}, contains: function () { return true; },
      createElement: function () { return { set innerHTML(v) {}, remove: function () {}, querySelectorAll: function () { return [cancel, okBtn]; }, querySelector: function (s) { return /"0"/.test(s) ? cancel : okBtn; } }; },
      body: { appendChild: function () {} } };
    var ctx = { document: fakeDoc, Promise: Promise, esc: function (s) { return s; } };
    vm.createContext(ctx);
    vm.runInContext(askSrc + '\nthis.ask = ask;', ctx);
    ctx.ask('Delete this response?', 'x', 'Delete', true);
    var first = at && at.n;
    function key(k, shift) { var stopped = false; handler({ key: k, shiftKey: !!shift, preventDefault: function () {}, stopPropagation: function () { stopped = true; } }); return stopped; }
    key('Tab'); var a1 = at.n; key('Tab'); var a2 = at.n; key('Tab', true); var a3 = at.n; key('Tab', true); var a4 = at.n;
    ok(first === 'cancel' && a1 === 'ok' && a2 === 'cancel' && a3 === 'ok' && a4 === 'cancel', 'REG-027 (run): Cancel first; Tab and Shift+Tab go round the two buttons', [first, a1, a2, a3, a4]);
  })();
  var main = (page.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); })
    .filter(function (s) { return s.indexOf('Reporting › Registrations') !== -1; })[0] || '';
  var code = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  ok((function () { try { new vm.Script(main); return true; } catch (e) { return false; } })() && !/\blet\s|\bconst\s/.test(code) && code.indexOf('=>') === -1, 'the Registrations script parses and is ES5');
  ok(!/\bET\b(?! ?B2B)/.test(main.replace(/ETB2B|ETCIO/g, '')) && main.indexOf('Oneworld') === -1 && main.indexOf('Revamp CMS') === -1, 'no bare "ET", old product names in its words');

  /* ================= the console Dashboard (REG-024, REG-025) ================= */
  var dashSrc = read('edit-event-dashboard.js');
  function loadCore() {
    var win = { location: { origin: 'https://revamp.example' } };
    var ctx = { window: win, location: win.location, console: console, Promise: Promise, URLSearchParams: URLSearchParams, setTimeout: setTimeout,
      document: { getElementById: function () { return null; } } };
    vm.createContext(ctx);
    vm.runInContext(read('edit-event-core.js'), ctx);
    return { C: win.RevampCore, ctx: ctx, win: win };
  }
  function makeDash(ev, stats) {
    var env = loadCore(), DC = env.C, asked = [];
    DC.fetchStats = function (id, n) { asked.push(n); return Promise.resolve(stats); };
    DC.fetchActivityLog = function () { return Promise.resolve({ items: [] }); };
    DC.fetchForms = function () { return Promise.resolve({ forms: [{ id: 'register' }], registration: { open: true } }); };
    vm.runInContext(dashSrc, env.ctx);
    var D = env.win.EditEventDashboard;
    var ctx = DC.makeCtx({ EV: ev, S: {}, render: function () {} });
    ctx.$ = function (id) { return id === 'dash-root' ? {} : null; };
    ctx.contentCounts = function () { return Promise.resolve({ speakers: 0, agenda: 0, sponsors: 0 }); };
    return { D: D, ctx: ctx, asked: asked };
  }
  function settle() { return new Promise(function (res) { setTimeout(res, 20); }); }
  function text(html) { return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' '); }
  function series(n, since, regsAt) {
    var out = [], t = Date.parse('2026-11-20T00:00:00Z');
    for (var k = n - 1; k >= 0; k--) {
      var date = new Date(t - k * 86400000).toISOString().slice(0, 10);
      out.push({ date: date, views: date >= since ? 10 + (k % 3) : null, uniques: 0, registrations: regsAt[date] || 0 });
    }
    return out;
  }
  var EV = { id: 'qa-dash', eventId: 'qa-dash', name: 'QA Dash', published: true, publishedVersion: 2, publishedAt: '2026-11-01T06:30:00.000Z', site: { version: 2 } };
  var STATS = { registrations: 47, confirmed: 40, pending: 0, waitlist: 0, cancelled: 0, checkedIn: 0, visitors: 77, uniques: 55, visitsCounted: true, visitsSince: '2026-11-13', qrScans: 0,
    conversion: 61, byDay: series(90, '2026-11-13', { '2026-11-19': 7, '2026-11-20': 3, '2026-10-01': 5 }),
    byCompany: [{ label: 'Tata Motors', count: 12 }, { label: 'Infosys & Co', count: 3 }], byDesignation: [], byCity: [{ label: 'Noida', count: 6 }],
    bySource: [{ label: 'website', count: 40 }, { label: 'linkedin', count: 7 }], byDevice: [{ label: 'Desktop', count: 70 }],
    byRegistrationDevice: [{ label: 'Mobile', count: 30 }, { label: 'Desktop', count: 17 }] };
  var t = makeDash(EV, STATS);
  t.D._test.range(30);
  t.D.view(t.ctx); t.D.wire(t.ctx); await settle();
  var v = t.D.view(t.ctx), tv = text(v);
  ok(t.asked[0] === 90, 'the Dashboard fetches 90 days, so 7 / 30 / 90 need no second fetch', t.asked);
  ok(/Over time Per day, India time/.test(tv) && /data-range="7" aria-pressed="false"/.test(v) && /data-range="30" aria-pressed="true"/.test(v) && /data-range="90" aria-pressed="false"/.test(v),
    'REG-024: "Over time", with a 7 / 30 / 90-day switch, 30 chosen', tv.slice(0, 300));
  var regFig = (/<figure class="dc" id="dc-reg">[\s\S]*?<\/figure>/.exec(v) || [''])[0], viewFig = (/<figure class="dc" id="dc-views">[\s\S]*?<\/figure>/.exec(v) || [''])[0];
  ok((regFig.match(/class="dc-day/g) || []).length === 30 && (viewFig.match(/class="dc-day/g) || []).length === 30, 'REG-024: 30 days of registrations and 30 of page views, side by side on the same days');
  ok(/Registrations 10 in the last 30 days/.test(text(regFig)) && /data-v="7"/.test(regFig), 'REG-024: registrations by day, from byDay', text(regFig).slice(0, 200));
  function viewsIn(n) { return STATS.byDay.slice(-n).reduce(function (s, d) { return s + (d.views || 0); }, 0); }
  ok(new RegExp('Page views ' + viewsIn(30) + ' since 13 Nov \\(counted from then\\)').test(text(viewFig)) && /<span class="dc-gap" style="width:73\.33/.test(viewFig) && /Not counted before 13 Nov/.test(viewFig) &&
    (viewFig.match(/data-v=""/g) || []).length === 22, 'REG-024: page views only from 13 Nov; the 22 days before are "not counted", not zeros', text(viewFig).slice(0, 300));
  ok(!/unique/i.test(v), 'REG-024: no unique visitors anywhere, even with a stored number', (v.match(/.{40}unique.{40}/i) || [])[0]);
  ok(/<details class="dc-table"><summary>Show the numbers<\/summary>/.test(v) && (v.match(/<tr><th scope="row">/g) || []).length === 30 && /Not counted<\/span><\/td><\/tr><\/tbody>/.test(v),
    'REG-024: every value is also in a table (the oldest days: page views not counted)');
  ok(/class="dc-plot" tabindex="0" role="group" aria-labelledby="dc-reg-t" aria-describedby="dc-reg-k"/.test(v) && /aria-live="polite">Use the left and right arrow keys/.test(v),
    'REG-024: each chart is reached with Tab and read a day at a time with the arrow keys');
  t.D._test.range(7);
  v = t.D.view(t.ctx);
  regFig = (/<figure class="dc" id="dc-reg">[\s\S]*?<\/figure>/.exec(v) || [''])[0];
  ok((regFig.match(/class="dc-day/g) || []).length === 7 && /Registrations 10 in the last 7 days/.test(text(regFig)) && /data-range="7" aria-pressed="true"/.test(v) &&
    new RegExp('Page views ' + viewsIn(7) + ' in the last 7 days').test(text(v)), 'REG-024: 7 days drawn from the same answer', text(regFig).slice(0, 200));
  t.D._test.range(90);
  v = t.D.view(t.ctx);
  ok((v.match(/class="dc-day/g) || []).length === 180 && /Registrations 15 in the last 90 days/.test(text(v)), 'REG-024: 90 days', text(v).slice(0, 200));
  ok(t.D._test.niceStep(0) === 1 && t.D._test.niceStep(1.5) === 2 && t.D._test.niceStep(3.5) === 5 && t.D._test.niceStep(75) === 100, 'round ticks');
  t.D._test.range(30);

  /* Who registered */
  ok(/Who registered The top 10 of each, from every registration so far/.test(text(t.D.view(t.ctx))), 'REG-025: "Who registered", all registrations so far');
  v = t.D.view(t.ctx);
  ok(/href="\/audience-registrations\.html\?event=qa-dash&amp;by=company&amp;value=Tata%20Motors"/.test(v) && /href="\/audience-registrations\.html\?event=qa-dash&amp;by=company&amp;value=Infosys%20%26%20Co"/.test(v) &&
    /by=city&amp;value=Noida/.test(v) && /by=source&amp;value=website/.test(v) && /by=device&amp;value=Mobile/.test(v),
    'REG-025: each row leads to the Registrations list filtered to it (company, city, source, device)');
  ok(/aria-label="Tata Motors: 12 registrations\. Show them"/.test(v) && /<span class="dw-bar" aria-hidden="true"><i style="width:100%"><\/i><\/span>/.test(v) && /width:25%/.test(v),
    'REG-025: each row says its number in words and draws it as a bar of the top one');
  ok(/Designation<\/h4><p class="dash-muted">No answers yet: the forms may not ask for it\./.test(v), 'REG-025: an empty list says so');
  ok(/by=device&amp;value=Desktop/.test(v) && /<span class="dw-l">Desktop<\/span><span class="dw-n">17<\/span>/.test(v) && !/<span class="dw-n">70<\/span>/.test(v),
    'REG-025: Device is the registrations\' devices, not page views by device');
  t = makeDash(EV, Object.assign({}, STATS, { registrations: 0 }));
  t.D.view(t.ctx); t.D.wire(t.ctx); await settle();
  ok(/Who registered No registrations yet\./.test(text(t.D.view(t.ctx))), 'REG-025: no registrations: one line, no empty cards');

  /* page views not counted at all */
  t = makeDash(EV, Object.assign({}, STATS, { visitsCounted: false, visitsSince: null, byDay: series(90, '9999-12-31', {}) }));
  t.D.view(t.ctx); t.D.wire(t.ctx); await settle();
  v = t.D.view(t.ctx);
  ok(/Page views Visits to the site are not counted yet, so there is nothing to draw\./.test(text(v)) && !/id="dc-views"/.test(v), 'REG-024: visits not counted: said, no chart of zeros');
  ok(/Page views Not counted Visits to the site are not counted yet/.test(text(v)), 'and the tile still says so');

  /* the CSS the charts need, in the console's stylesheet, for both themes */
  var css = read('edit-event.css');
  ok(/#dash-over, \.dw-grid\{ --chart-bar:#285F98; \}/.test(css) && /:root\[data-theme="dark"\] #dash-over, :root\[data-theme="dark"\] \.dw-grid\{ --chart-bar:#4F8FDB; \}/.test(css) &&
    /prefers-color-scheme: dark\)\{ :root:not\(\[data-theme="light"\]\) #dash-over/.test(css) && /\.dc-day i\{[^}]*max-width:24px/.test(css),
    'the chart colour is set for light and dark, and columns are never wider than 24px');

  console.log((failures.length ? 'FAILED ' : 'ok ') + (checks - failures.length) + ' passed, ' + failures.length + ' failed');
  failures.forEach(function (f) { console.error('FAIL ' + f); });
  process.exit(failures.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
