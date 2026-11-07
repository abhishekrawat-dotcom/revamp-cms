/* node functions/lib/event-remove-approvers.test.js — deleting and restoring an event are for approvers only
   (owner decision #4, 2026-11-03; batch B07, UX-016), run through the real router (lib/api.js handleApi) against
   an in-memory Firestore and Storage:
     - lib/access.js notAnApprover, the one reading of the rule (the same function the console's take-offline uses);
     - DELETE /api/event and POST /api/event/restore: a team member who is not an approver is refused with 403
       { code: 'not-an-approver' } and the sentence naming who can, and nothing is written; an approver (any case)
       can; with no approvers named every member can (the approval rule's own reading); a config holding only
       things that are not e-mail addresses names nobody;
     - the wizard's discard of a creator's own fresh draft is not covered by the rule (it cancels Create Event);
     - a deleted event leaves GET /api/events and is listed by GET /api/events?deleted=1 (the dashboard's Deleted
       Events view), with who deleted it and when.
   No network, no real project, no AI. Exits 1 on any failure. */
'use strict';

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : '') + '\n');
}
['log', 'info', 'warn', 'error'].forEach(function (k) { console[k] = function () {}; });

/* ---------- an in-memory Firestore + Storage, just enough for these routes ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {}, files = {}, seq = 0;
  function snap(p) {
    var d = docs[p];
    return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } };
  }
  function write(p, kind, data, o) {
    if (kind === 'set' && !(o && o.merge)) docs[p] = {};
    if (!docs[p]) docs[p] = {};
    Object.keys(data).forEach(function (k) { if (isDelete(data[k])) delete docs[p][k]; else docs[p][k] = clone(data[k]); });
  }
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, 'set', data, o); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, 'update', data); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); }
    };
  }
  function colRef(p, filters) {
    filters = filters || [];
    var q = {
      path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + (++seq)))); },
      add: function (data) { var r = docRef(p + '/auto' + (++seq)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) { return colRef(p, filters.concat([{ field: field, value: value }])); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; })
          .filter(function (k) { return filters.every(function (f) { return docs[k][f.field] === f.value; }); }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      }
    };
    return q;
  }
  var db = {
    collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = {
        get: function (r) { return r.get(); },
        set: function (r, d, o) { write(r.path, 'set', d, o); return tx; },
        update: function (r, d) { write(r.path, 'update', d); return tx; },
        delete: function (r) { delete docs[r.path]; return tx; }
      };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, 'set', d, o); }); }, update: function (r, d) { ops.push(function () { write(r.path, 'update', d); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); }, commit: function () { ops.forEach(function (f) { f(); }); return Promise.resolve(); } };
    },
    recursiveDelete: function (ref) {
      Object.keys(docs).forEach(function (k) { if (k === ref.path || k.indexOf(ref.path + '/') === 0) delete docs[k]; });
      return Promise.resolve();
    }
  };
  var bucket = {
    name: 'test-bucket',
    file: function (p) {
      return { name: p, save: function (buf) { files[p] = Buffer.from(buf); return Promise.resolve(); }, delete: function () { delete files[p]; return Promise.resolve(); },
        download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); } };
    },
    deleteFiles: function (o) { Object.keys(files).forEach(function (k) { if (k.indexOf(o.prefix) === 0) delete files[k]; }); return Promise.resolve(); }
  };
  /* "Bearer <name>" signs in as <name>@timesinternet.in */
  var auth = { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files };
}

var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var api = require('./api');
var access = require('./access');

function call(method, url, token, body) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'x-forwarded-for': '10.9.0.' + Math.floor(Math.random() * 250) };
    if (token) headers.authorization = 'Bearer ' + token;
    var text = body ? JSON.stringify(body) : '';
    if (text) headers['content-type'] = 'application/json';
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(text) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: t }); }
    };
    api.handleApi(req, res);
  });
}
var CREATED = '2026-10-01T09:00:00.000Z';
function makeEvent(id, extra) {
  FB.docs['events/' + id] = Object.assign({ name: 'Event ' + id, createdAt: CREATED, createdBy: 'editor@timesinternet.in', updatedAt: CREATED, status: 'draft' }, extra || {});
}
function approvers(list) { if (list === null) delete FB.docs['config/approvals']; else FB.docs['config/approvals'] = { approvers: list, allowSelf: false, required: true }; }
function lines(id, action) {
  var pre = 'events/' + id + '/activity/';
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf(pre) === 0 && (!action || FB.docs[k].action === action); });
}
function listed(items, id) { return (items || []).filter(function (e) { return e.id === id; })[0] || null; }

(async function () {
  /* ---- 1. the rule itself (lib/access.js) ---- */
  check('notAnApprover: no approvers named: anyone may', access.notAnApprover([], 'x@timesinternet.in', 'delete an event') === '' && access.notAnApprover(null, 'x@timesinternet.in') === '');
  check('notAnApprover: an approver may, in any case', access.notAnApprover(['Boss@timesinternet.in'], ' boss@TIMESINTERNET.in ', 'delete an event') === '');
  check('notAnApprover: anybody else is told who can', access.notAnApprover(['boss@timesinternet.in', 'two@timesinternet.in'], 'member@timesinternet.in', 'delete an event') ===
    'Only an approver (boss@timesinternet.in, two@timesinternet.in) can delete an event.');

  /* ---- 2. no approvers named: every signed-in member approves, so may delete and restore ---- */
  approvers(null);
  makeEvent('qa-open-1');
  var r = await call('DELETE', '/api/event?eventId=qa-open-1', 'member');
  check('no approvers named: a member deletes (200, deletedAt and deletedBy set)', r.status === 200 && !!FB.docs['events/qa-open-1'].deletedAt && FB.docs['events/qa-open-1'].deletedBy === 'member@timesinternet.in', r.text);
  r = await call('POST', '/api/event/restore', 'member', { eventId: 'qa-open-1' });
  check('no approvers named: a member restores (200, back)', r.status === 200 && !FB.docs['events/qa-open-1'].deletedAt, r.text);

  /* ---- 3. approvers named: a member is refused, and nothing is written ---- */
  approvers(['boss@timesinternet.in', 'two@timesinternet.in']);
  makeEvent('qa-live-1', { name: 'Live Summit', published: true, publishedAt: CREATED, counters: { registrations: 12, views: 40 } });
  var before = JSON.stringify(FB.docs['events/qa-live-1']);
  r = await call('DELETE', '/api/event?eventId=qa-live-1', 'member');
  check('a member who is not an approver cannot delete: 403 not-an-approver, with who can', r.status === 403 && r.body && r.body.code === 'not-an-approver' &&
    r.body.error === 'Only an approver (boss@timesinternet.in, two@timesinternet.in) can delete an event.' &&
    JSON.stringify(r.body.approvers) === JSON.stringify(['boss@timesinternet.in', 'two@timesinternet.in']), r.text);
  check('…and the event is untouched: still live, no deletedAt, nothing in its History', JSON.stringify(FB.docs['events/qa-live-1']) === before && lines('qa-live-1').length === 0);
  var list = await call('GET', '/api/events', 'member');
  check('…and it is still in the events list', list.status === 200 && !!listed(list.body.items, 'qa-live-1'));

  /* ---- 4. an approver (any case) deletes ---- */
  r = await call('DELETE', '/api/event?eventId=qa-live-1', 'Boss');
  var doc = FB.docs['events/qa-live-1'];
  check('an approver deletes, whatever the case of their address (200)', r.status === 200 && r.body.ok === true && !!doc.deletedAt && doc.deletedBy === 'Boss@timesinternet.in', r.text);
  check('…its History says so once', lines('qa-live-1', 'deleted').length === 1);
  check('…"published" is kept, so Restore brings the live site back', doc.published === true);
  list = await call('GET', '/api/events', 'member');
  var gone = await call('GET', '/api/events?deleted=1', 'member');
  var item = listed(gone.body && gone.body.items, 'qa-live-1');
  check('the deleted event leaves GET /api/events', list.status === 200 && !listed(list.body.items, 'qa-live-1'));
  check('GET /api/events?deleted=1 (the Deleted Events view) lists it, with when, who, and that its site comes back on restore',
    gone.status === 200 && !!item && item.deletedAt === doc.deletedAt && item.deletedBy === 'Boss@timesinternet.in' && item.published === true && item.publishedPath === null, item);
  r = await call('DELETE', '/api/event?eventId=qa-live-1', 'boss');
  check('deleting it again answers 200 and records nothing more', r.status === 200 && lines('qa-live-1', 'deleted').length === 1, r.text);

  /* ---- 5. restore: approvers only ---- */
  r = await call('POST', '/api/event/restore', 'member', { eventId: 'qa-live-1' });
  check('a member who is not an approver cannot restore: 403 not-an-approver, with who can', r.status === 403 && r.body.code === 'not-an-approver' &&
    r.body.error === 'Only an approver (boss@timesinternet.in, two@timesinternet.in) can restore a deleted event.', r.text);
  check('…and it stays deleted, with nothing in its History', !!FB.docs['events/qa-live-1'].deletedAt && lines('qa-live-1', 'restored').length === 0);
  r = await call('POST', '/api/event/restore', 'two', { eventId: 'qa-live-1' });
  check('an approver restores it (200, published: true: its site is live again)', r.status === 200 && r.body.published === true && !FB.docs['events/qa-live-1'].deletedAt && !FB.docs['events/qa-live-1'].deletedBy, r.text);
  check('…its History says its public page is live again', lines('qa-live-1', 'restored').length === 1);
  gone = await call('GET', '/api/events?deleted=1', 'member');
  list = await call('GET', '/api/events', 'member');
  check('…and it is back in the events list, out of Deleted Events', !listed(gone.body.items, 'qa-live-1') && !!listed(list.body.items, 'qa-live-1'));

  /* ---- 6. what is not covered, and what is refused first ---- */
  FB.docs['events/qa-fresh-1'] = { name: 'Abandoned', createdAt: new Date(Date.now() - 3600000).toISOString(), createdBy: 'member@timesinternet.in', updatedAt: CREATED, site: { version: 1 } };
  r = await call('DELETE', '/api/event?eventId=qa-fresh-1&discard=1', 'member');
  check('the wizard\'s discard of a member\'s own fresh draft still works with approvers named (it cancels Create Event)', r.status === 200 && r.body.discarded === true && !FB.docs['events/qa-fresh-1'], r.text);
  r = await call('DELETE', '/api/event?eventId=Not%20An%20Id', 'member');
  check('a bad event id is still a 400 before anything else', r.status === 400, r.text);
  r = await call('DELETE', '/api/event?eventId=qa-nothing-here', 'boss');
  check('an approver deleting an event that does not exist: 404', r.status === 404, r.text);
  approvers(['not an address', '']);
  makeEvent('qa-open-2');
  r = await call('DELETE', '/api/event?eventId=qa-open-2', 'member');
  check('a config naming only things that are not e-mail addresses names nobody (read as lib/api.js approvalsConfig reads it)', r.status === 200, r.text);
  var settings = await call('GET', '/api/settings/approvals', 'member');
  check('…the same reading GET /api/settings/approvals gives the dashboard', settings.status === 200 && JSON.stringify(settings.body.approvers) === '[]', settings.text);

  process.stdout.write('event-remove-approvers: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stderr.write('CRASH ' + (e && e.stack || e) + '\n'); process.exit(1); });
