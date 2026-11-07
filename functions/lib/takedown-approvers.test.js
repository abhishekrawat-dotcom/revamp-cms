/* node functions/lib/takedown-approvers.test.js — taking a live site offline is for approvers only (the owner's
   rule, 2026-11-03; lib/access.js notAnApprover): POST /api/event/unpublish refuses anybody else with 403
   'not-an-approver' and the site stays live; an approver takes it down at once (the event records who and when,
   and the History says so); while no approvers are named, anyone signed in may. Also: the Dashboard's figures
   say whether page views are counted at all (GET /api/event/dashboard-stats visitsCounted). In-process, against
   an in-memory Firestore and Storage (the harness of logo-note-gate.test.js). No network. Exits 1 listing every
   failure. */
'use strict';

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 400) : '')); }

/* ---------- an in-memory Firestore + Storage ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {}, files = {};
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } }; }
  function write(p, data, merge) {
    if (!merge || !docs[p]) docs[p] = docs[p] && merge ? docs[p] : {};
    Object.keys(data).forEach(function (k) { if (isDelete(data[k])) delete docs[p][k]; else docs[p][k] = clone(data[k]); });
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, data, o && o.merge); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, data, true); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p) {
    var q = { path: p, doc: function (id) { return docRef(p + '/' + (id || 'auto' + Object.keys(docs).length + 'x' + Math.floor(Math.random() * 1e6))); },
      add: function (data) { var r = docRef(p + '/auto' + Object.keys(docs).length); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) {
        var base = q.get;
        return Object.assign({}, q, { get: function () { return base().then(function (r) { var list = r.docs.filter(function (d) { var v = (d.data() || {})[field]; return op === '>' ? v > value : v === value; }); return { docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } }; }); } });
      },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      } };
    return q;
  }
  var db = { collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = { get: function (r) { return r.get(); }, set: function (r, d, o) { write(r.path, d, o && o.merge); return tx; },
        update: function (r, d) { write(r.path, d, true); return tx; }, delete: function (r) { delete docs[r.path]; return tx; } };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, d, o && o.merge); }); }, update: function (r, d) { ops.push(function () { write(r.path, d, true); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); }, commit: function () { ops.forEach(function (f) { f(); }); return Promise.resolve(); } };
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
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
const api = require('./api');
const hooks = api._testHooks;

function call(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    var body = opts.body ? JSON.stringify(opts.body) : '';
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body) };
    if (body) headers['content-type'] = 'application/json';
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, text: t, body: j, headers: res.headers }); } };
    api.handleApi(req, res);
  });
}


var NOW = '2026-02-01T00:00:00.000Z';
function liveEvent(id) {
  FB.docs['events/' + id] = { name: 'Live ' + id, createdAt: NOW, published: true, publishedVersion: 3, publishedAt: NOW, publishedPath: '/e/' + id, site: { version: 3 } };
}
function activity(id, action) {
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + id + '/activity/') === 0 && FB.docs[k].action === action; }).map(function (k) { return FB.docs[k]; });
}

(async function () {
  /* approvers named: a team member is refused, the site stays live */
  FB.docs['config/approvals'] = { approvers: ['Boss@timesinternet.in'], required: true };
  liveEvent('td-one');
  var r = await call('POST', '/api/event/unpublish', { token: 'member', body: { eventId: 'td-one' } });
  ok(r.status === 403 && r.body && r.body.code === 'not-an-approver', 'a team member: 403 not-an-approver', r.status + ' ' + r.text);
  ok(r.body && r.body.error === 'Only an approver (boss@timesinternet.in) can take a live site offline.', 'the refusal names who can', r.text);
  ok(FB.docs['events/td-one'].published === true && FB.docs['events/td-one'].publishedPath === '/e/td-one' && !FB.docs['events/td-one'].unpublishedAt, 'the site stays live', JSON.stringify(FB.docs['events/td-one']));
  ok(!activity('td-one', 'unpublished').length, 'nothing is logged for a refusal');

  /* an approver (whatever the case of the address) takes it down */
  r = await call('POST', '/api/event/unpublish', { token: 'boss', body: { eventId: 'td-one' } });
  ok(r.status === 200 && r.body && r.body.published === false, 'an approver: 200, published false', r.status + ' ' + r.text);
  var d = FB.docs['events/td-one'];
  ok(d.published === false && d.publishedPath === null && d.unpublishedBy === 'boss@timesinternet.in' && /^\d{4}-\d\d-\d\dT/.test(d.unpublishedAt), 'the event records who took it down and when', JSON.stringify(d));
  await new Promise(function (res) { setTimeout(res, 10); });
  ok(activity('td-one', 'unpublished').length === 1, 'the History says it was taken down', JSON.stringify(Object.keys(FB.docs)));
  r = await call('GET', '/e/td-one', {});
  ok(r.status === 404 || r.status === 410 || (r.status === 200 && !/Live td-one/.test(r.text)), 'its address no longer serves the site', r.status);

  /* no approvers named: anyone signed in approves, so may take a site down */
  FB.docs['config/approvals'] = { approvers: [], required: true };
  liveEvent('td-two');
  r = await call('POST', '/api/event/unpublish', { token: 'member', body: { eventId: 'td-two' } });
  ok(r.status === 200 && FB.docs['events/td-two'].published === false, 'no approvers named: a member may', r.status + ' ' + r.text);
  delete FB.docs['config/approvals'];
  liveEvent('td-three');
  r = await call('POST', '/api/event/unpublish', { token: 'member', body: { eventId: 'td-three' } });
  ok(r.status === 200 && FB.docs['events/td-three'].published === false, 'no approval settings at all: a member may', r.status + ' ' + r.text);

  /* signed out: never */
  liveEvent('td-four');
  r = await call('POST', '/api/event/unpublish', { body: { eventId: 'td-four' } });
  ok(r.status === 401 && FB.docs['events/td-four'].published === true, 'signed out: 401, still live', r.status);

  /* the Dashboard's figures say whether page views are counted (they are only where rv-live.js ships) */
  FB.docs['events/td-stats'] = { name: 'Stats', createdAt: NOW, counters: { audienceV: 2, registrations: 2, confirmed: 2, views: 0, uniques: 0 },
    settings: { registration: { capacity: 100, target: 50 } } };
  r = await call('GET', '/api/event/dashboard-stats?eventId=td-stats&days=30', { token: 'member' });
  var counted = require('fs').existsSync(require('path').join(__dirname, '..', '..', 'templates', '_shared', 'rv-live.js'));
  ok(r.status === 200 && r.body && r.body.visitsCounted === counted && r.body.registrations === 2 && r.body.capacity === 100 && r.body.target === 50 && Array.isArray(r.body.byDay) && r.body.byDay.length === 30,
    'dashboard-stats: real totals, the registration settings, and visitsCounted = ' + counted, r.status + ' ' + r.text.slice(0, 300));

  console.log((failures.length ? 'FAILED ' : 'ok ') + (checks - failures.length) + ' passed, ' + failures.length + ' failed');
  failures.forEach(function (f) { console.error('FAIL ' + f); });
  process.exit(failures.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
