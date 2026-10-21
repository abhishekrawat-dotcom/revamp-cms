/* node functions/lib/api-activity.test.js — the all-events Activity log (lib/api-activity.js, GET /api/activity/all)
   against an in-memory Firestore: which events' entries are shown, paging with a cursor, the filters, the area
   of old and new entries, and that registrants' addresses and secrets never leave. No network. Exits 1 on any
   failure. */
'use strict';
const A = require('./api-activity');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

/* ---------- a small in-memory Firestore: just what lib/api-activity.js uses ---------- */
function makeDb(eventDocs, activity) {
  var reads = { activity: 0 };
  function ref(path) {
    var parts = path.split('/');
    function build(n) {
      if (n <= 0) return null;
      return { id: parts[n - 1], path: parts.slice(0, n).join('/'), parent: build(n - 1) };
    }
    return build(parts.length);
  }
  function snapOf(path, data) {
    return { id: path.split('/').pop(), ref: ref(path), exists: !!data, data: function () { return data; } };
  }
  function Query(paths) { this.paths = paths; this.filters = []; this.after = null; this.n = Infinity; }
  Query.prototype.where = function (f, op, v) { var q = this.clone(); q.filters.push([f, op, v]); return q; };
  Query.prototype.orderBy = function () { return this.clone(); };
  Query.prototype.startAfter = function (snap) { var q = this.clone(); q.after = snap; return q; };
  Query.prototype.limit = function (n) { var q = this.clone(); q.n = n; return q; };
  Query.prototype.clone = function () { var q = new Query(this.paths); q.filters = this.filters.slice(); q.after = this.after; q.n = this.n; return q; };
  Query.prototype.get = function () {
    var self = this;
    var rows = self.paths().filter(function (p) {
      var d = activity[p];
      return self.filters.every(function (f) {
        var v = d[f[0]];
        return f[1] === '==' ? v === f[2] : f[1] === '>=' ? v >= f[2] : f[1] === '<' ? v < f[2] : false;
      });
    });
    rows.sort(function (x, y) {   // at desc, then the path desc (Firestore's implicit order for a desc query)
      var a = activity[x].at, b = activity[y].at;
      return a === b ? (x < y ? 1 : -1) : (a < b ? 1 : -1);
    });
    if (self.after) {
      var ap = self.after.ref.path, aa = activity[ap].at;
      rows = rows.filter(function (p) { var at = activity[p].at; return at < aa || (at === aa && p < ap); });
    }
    rows = rows.slice(0, self.n);
    reads.activity += rows.length;
    return Promise.resolve({ docs: rows.map(function (p) { return snapOf(p, activity[p]); }) });
  };
  var db = {
    collectionGroup: function (name) {
      return new Query(function () { return Object.keys(activity).filter(function (p) { var s = p.split('/'); return s[s.length - 2] === name; }); });
    },
    collection: function (name) {
      return {
        select: function () { return { limit: function () { return { get: function () {
          return Promise.resolve({ docs: Object.keys(eventDocs).map(function (id) { return snapOf(name + '/' + id, eventDocs[id]); }) });
        } }; } }; },
        doc: function (id) {
          return { collection: function (sub) {
            var prefix = name + '/' + id + '/' + sub + '/';
            return new Query(function () { return Object.keys(activity).filter(function (p) { return p.indexOf(prefix) === 0 && p.split('/').length === 4; }); });
          } };
        }
      };
    },
    doc: function (path) { return { get: function () { return Promise.resolve(snapOf(path, activity[path] || null)); } }; }
  };
  return { db: db, reads: reads };
}

var EVENTS = {
  'alpha': { name: 'Alpha Summit', createdAt: '2026-01-01' },
  'beta': { name: 'Beta Forum', createdAt: '2026-01-01', deletedAt: '2026-09-01' },
  'half': { name: 'Half made' },                                            // no createdAt: a shell
  'gone': { name: 'Being removed', createdAt: '2026-01-01', discardingAt: 'x' },
  'noname': { name: '  ', createdAt: '2026-01-01' },
  'import-abc': { name: 'Import', createdAt: '2026-01-01' }
};
function at(i) { return new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + i * 60000).toISOString(); }
var ACT = {};
var n = 0;
for (var i = 0; i < 130; i++) {
  ACT['events/alpha/activity/a' + (1000 + i)] = { at: at(n++), by: i % 3 ? 'editor@timesinternet.in' : 'platform', action: i % 2 ? 'site-saved' : 'form-updated', detail: 'change ' + i };
}
for (var j = 0; j < 20; j++) ACT['events/beta/activity/b' + (1000 + j)] = { at: at(n++), by: 'owner@timesinternet.in', action: 'published', detail: 'version ' + j, version: j };
['half', 'gone', 'noname', 'import-abc', 'orphan'].forEach(function (id, k) {
  ACT['events/' + id + '/activity/x' + k] = { at: at(500 + k), by: 'x@timesinternet.in', action: 'updated', detail: 'hidden ' + id };
});
ACT['users/u1/activity/z1'] = { at: at(600), by: 'x@timesinternet.in', action: 'updated', detail: 'not an event' };
ACT['events/alpha/activity/new1'] = { at: at(700), by: 'editor@timesinternet.in', action: 'theme-changed', area: 'design', detail: 'Theme colour',
  fields: [{ field: 'Primary colour', before: '#111', after: '#222' }, { field: 'API key', before: 'sk-old', after: 'sk-new' }] };
ACT['events/alpha/activity/reg1'] = { at: at(701), by: 'editor@timesinternet.in', action: 'registration-updated', detail: 'priya.sharma@gmail.com: status confirmed',
  fields: [{ field: 'Email', before: 'priya.sharma@gmail.com', after: 'p.sharma@yahoo.co.in' }] };

var USER = { email: 'viewer@timesinternet.in' };
function qs(o) { return new URLSearchParams(o || {}); }

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('first page: newest first, 50, only events in the events listing', function () {
  A.resetEventsCache();
  var f = makeDb(EVENTS, ACT);
  return A.listAll(f, USER, A.parseParams(qs())).then(function (out) {
    ok(out.items.length === 50, 'a page is 50 rows', out.items.length);
    ok(out.items[0].id === 'reg1' && out.items[1].id === 'new1', 'newest first', out.items.slice(0, 2).map(function (x) { return x.id; }).join(','));
    var ids = {};
    out.items.forEach(function (x) { ids[x.eventId] = 1; });
    ok(!ids.half && !ids.gone && !ids.noname && !ids['import-abc'] && !ids.orphan && !ids.u1, 'no shell, removing, unnamed, import, orphan or non-event entries', Object.keys(ids).join(','));
    ok(ids.beta && out.items.some(function (x) { return x.eventId === 'beta' && x.eventDeleted === true && x.eventName === 'Beta Forum'; }), 'a deleted event shows, marked deleted');
    ok(!!out.next, 'there is a next page');
  });
});

test('paging walks every visible entry exactly once', function () {
  A.resetEventsCache();
  var f = makeDb(EVENTS, ACT), seen = {}, pages = 0;
  function page(cursor) {
    var o = cursor ? { cursor: cursor } : {};
    return A.listAll(f, USER, A.parseParams(qs(o))).then(function (out) {
      pages++;
      out.items.forEach(function (x) { ok(!seen[x.eventId + '/' + x.id], 'no repeat ' + x.id); seen[x.eventId + '/' + x.id] = 1; });
      if (out.next && pages < 20) return page(out.next);
    });
  }
  return page(null).then(function () {
    ok(Object.keys(seen).length === 130 + 20 + 2, 'all 152 visible entries, once', Object.keys(seen).length);
    ok(pages === 4, '4 pages of 50', pages);
  });
});

test('one event, one person, one area, a date range', function () {
  A.resetEventsCache();
  var f = makeDb(EVENTS, ACT);
  return A.listAll(f, USER, A.parseParams(qs({ event: 'beta' }))).then(function (out) {
    ok(out.items.length === 20 && out.items.every(function (x) { return x.eventId === 'beta' && x.area === 'publishing'; }), 'event filter', out.items.length);
    ok(out.next === null, 'one page only');
    ok(out.items[0].version === 19, 'version comes through');
    return A.listAll(f, USER, A.parseParams(qs({ user: 'platform' })));
  }).then(function (out) {
    ok(out.items.length === 44 && out.items.every(function (x) { return x.by === 'platform' && x.byLabel === 'Platform (automated)'; }), 'platform filter: 44 entries', out.items.length);
    return A.listAll(f, USER, A.parseParams(qs({ area: 'forms', limit: '100' })));
  }).then(function (out) {
    ok(out.items.length === 65 && out.items.every(function (x) { return x.action === 'form-updated'; }), 'area from the action of an old entry', out.items.length);
    return A.listAll(f, USER, A.parseParams(qs({ area: 'design' })));
  }).then(function (out) {
    ok(out.items.length === 1 && out.items[0].id === 'new1', 'area from the entry itself', out.items.length);
    return A.listAll(f, USER, A.parseParams(qs({ from: at(10), to: at(20) })));
  }).then(function (out) {
    ok(out.items.length === 10 && out.items[0].at === at(19) && out.items[9].at === at(10), 'from inclusive, to exclusive', out.items.length);
  });
});

test('an event nobody may see is a 404, a cursor from another event is refused', function () {
  A.resetEventsCache();
  var f = makeDb(EVENTS, ACT);
  return A.listAll(f, USER, A.parseParams(qs({ event: 'half' }))).then(function () { ok(false, 'shell event refused'); }, function (err) {
    ok(err.status === 404 && err.expose, 'shell event: 404', err.message);
    return A.listAll(f, USER, A.parseParams(qs({ event: 'beta', cursor: 'events/alpha/activity/a1000' })));
  }).then(function () { ok(false, 'cross-event cursor refused'); }, function (err) {
    ok(err.status === 400, 'cross-event cursor: 400', err.message);
  });
});

test('a filter that matches rarely stops after a bounded scan and offers more', function () {
  A.resetEventsCache();
  var many = {};
  for (var k = 0; k < 900; k++) many['events/alpha/activity/m' + (10000 + k)] = { at: at(k), by: 'e@timesinternet.in', action: 'site-saved', detail: '' };
  many['events/alpha/activity/old'] = { at: at(-5), by: 'e@timesinternet.in', action: 'promo-written', detail: 'Mailer' };
  var f = makeDb(EVENTS, many);
  return A.listAll(f, USER, A.parseParams(qs({ area: 'promotions' }))).then(function (out) {
    ok(out.items.length === 0 && out.scanned === 600 && !!out.next, 'stops at 600 read, with a next', JSON.stringify({ n: out.items.length, s: out.scanned }));
    return A.listAll(f, USER, A.parseParams(qs({ area: 'promotions', cursor: out.next })));
  }).then(function (out) {
    ok(out.items.length === 1 && out.items[0].area === 'promotions' && out.next === null, 'the next page finds it', out.items.length);
  });
});

test('privacy: registrant addresses masked, staff kept, secret fields dropped', function () {
  A.resetEventsCache();
  var f = makeDb(EVENTS, ACT);
  return A.listAll(f, USER, A.parseParams(qs({ limit: '2' }))).then(function (out) {
    var reg = out.items[0], th = out.items[1];
    ok(reg.detail === 'p***@gmail.com: status confirmed', 'detail masked', reg.detail);
    ok(reg.fields[0].before === 'p***@gmail.com' && reg.fields[0].after === 'p***@yahoo.co.in', 'before/after masked', JSON.stringify(reg.fields));
    ok(reg.by === 'editor@timesinternet.in', 'the staff member is shown in full');
    ok(th.fields.length === 1 && th.fields[0].field === 'Primary colour', 'a secret-looking field is never sent', JSON.stringify(th.fields));
    ok(JSON.stringify(out).indexOf('sk-') === -1 && JSON.stringify(out).indexOf('priya') === -1, 'nothing leaks anywhere');
  });
});

/* ---------- pure parts ---------- */
test('pure helpers', function () {
  ok(A.areaOf({ action: 'published' }) === 'publishing' && A.areaOf({ action: 'content-added' }) === 'content', 'old actions map');
  ok(A.areaOf({ action: 'whatever', area: 'promotions' }) === 'promotions', 'own area wins');
  ok(A.areaOf({ action: 'logo-unit-saved' }) === 'design' && A.areaOf({ action: 'hero-video-changed' }) === 'design', 'new design actions');
  ok(A.areaOf({ action: 'mystery' }) === 'event' && A.areaOf({ action: 'x', area: 'nonsense' }) === 'event', 'unknown falls back to event');
  ok(A.byLabel('platform') === 'Platform (automated)' && A.byLabel('system') === 'Platform (automated)' && A.byLabel('a@b.c') === 'a@b.c', 'byLabel');
  ok(A.maskEmails('to a.b@timesinternet.in and z@x.org') === 'to a.b@timesinternet.in and z***@x.org', 'maskEmails', A.maskEmails('to a.b@timesinternet.in and z@x.org'));
  function threw(o) { try { A.parseParams(qs(o)); return false; } catch (e) { return e.status === 400; } }
  ok(threw({ area: 'nope' }) && threw({ event: '../x' }) && threw({ from: 'yesterday' }) && threw({ cursor: 'users/x/activity/y' }) && threw({ user: 'not an email' }), 'bad params are 400s');
  ok(threw({ from: at(5), to: at(1) }), 'a backwards range is a 400');
  ok(A.parseParams(qs({ limit: '9999' })).limit === 100 && A.parseParams(qs()).limit === 50, 'limit bounds');
  var ix = A.indexProblem({ code: 9, message: '9 FAILED_PRECONDITION: The query requires an index. That index is currently building and cannot be used yet.' });
  ok(ix && ix.code === 'index-building', 'index building recognised');
  ix = A.indexProblem({ code: 9, message: '9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_DESC index for collection activity and field at.' });
  ok(ix && ix.code === 'index-missing', 'index missing recognised');
  ok(A.indexProblem({ code: 14, message: 'unavailable' }) === null, 'other errors are not index problems');
});

(function run(k) {
  if (k >= tests.length) {
    if (failures.length) { console.error('api-activity: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
    console.log('api-activity: all ' + checks + ' checks pass');
    return;
  }
  Promise.resolve().then(tests[k][1]).then(function () { run(k + 1); }, function (err) {
    failures.push(tests[k][0] + ' threw: ' + ((err && err.stack) || err)); run(k + 1);
  });
})(0);
