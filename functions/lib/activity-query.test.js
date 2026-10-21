/* node functions/lib/activity-query.test.js — exits 1 on the first failure it lists. No network, no Firebase.
   The Activity log's reading (lib/activity-query.js): the area of old and new entries, the query string,
   paging with an exact cursor (also across entries that share a time), the server-side filters, the people
   list, and registrants' addresses never shown in full. Firestore is a small in-memory stand-in that does
   what the real one does for orderBy('at','desc') + where('at', …) + startAfter(snapshot) + limit. */
'use strict';
const AQ = require('./activity-query');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function qs(o) { return new URLSearchParams(o || {}); }

/* ---------- a stand-in for one Firestore collection ---------- */
function fakeCollection(rows) {
  var reads = { get: 0, docs: 0 };
  function snapOf(r) { return { id: r.id, exists: true, data: function () { return Object.assign({}, r.data); }, _row: r }; }
  function sorted(dir) {
    /* Firestore orders ties by document id in the direction of the last orderBy */
    return rows.slice().sort(function (a, b) {
      var x = String(a.data.at || ''), y = String(b.data.at || '');
      var c = x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return dir === 'desc' ? -c : c;
    });
  }
  function query(state) {
    return {
      where: function (f, op, v) { return query(Object.assign({}, state, { wh: state.wh.concat([[f, op, v]]) })); },
      orderBy: function (f, dir) { return query(Object.assign({}, state, { dir: dir || 'asc' })); },
      startAfter: function (snap) { return query(Object.assign({}, state, { after: snap._row })); },
      limit: function (n) { return query(Object.assign({}, state, { lim: n })); },
      select: function () { return query(state); },
      get: function () {
        reads.get++;
        var list = sorted(state.dir).filter(function (r) {
          return state.wh.every(function (w) {
            var v = r.data[w[0]];
            if (v == null) return false;
            return w[1] === '<' ? v < w[2] : w[1] === '<=' ? v <= w[2] : w[1] === '>=' ? v >= w[2] : w[1] === '>' ? v > w[2] : v === w[2];
          });
        });
        if (state.after) { var i = list.indexOf(state.after); list = i === -1 ? list : list.slice(i + 1); }
        if (state.lim) list = list.slice(0, state.lim);
        reads.docs += list.length;
        return Promise.resolve({ docs: list.map(snapOf) });
      }
    };
  }
  var col = query({ wh: [], dir: 'asc', after: null, lim: 0 });
  col.doc = function (id) {
    return { get: function () {
      var r = rows.filter(function (x) { return x.id === id; })[0];
      return Promise.resolve(r ? snapOf(r) : { id: id, exists: false, data: function () { return undefined; } });
    } };
  };
  col.reads = reads;
  return col;
}

/* 70 entries a minute apart, newest = index 0, of varied kinds; two pairs share a time */
var KINDS = [
  ['site-saved', 'a@etb2b.com', 'version 4 — Hero text changed', null],
  ['content-changed', 'b@etb2b.com', 'Speaker: Priya Raman', null],
  ['form-updated', 'a@etb2b.com', 'Registration form', 'forms'],
  ['registration-updated', 'b@etb2b.com', 'Asha Verma — status confirmed (asha.verma@example.com)', null],
  ['settings-changed', 'platform', 'Logo picture repaired', 'design'],
  ['published', 'c@etb2b.com', 'version 4 is live', null],
  ['theme-changed', 'a@etb2b.com', 'Accent colour', null]
];
var T0 = Date.parse('2026-10-21T06:00:00.000Z');
var rows = [];
for (var i = 0; i < 70; i++) {
  var k = KINDS[i % KINDS.length], at = new Date(T0 - i * 60000).toISOString();
  if (i === 11 || i === 41) at = new Date(T0 - (i - 1) * 60000).toISOString(); // shares a time with the one before
  var d = { at: at, by: k[1], action: k[0], detail: k[2] + ' #' + i };
  if (k[3]) d.area = k[3];
  if (k[0] === 'registration-updated') d.fields = [{ field: 'email', before: 'old.addr@example.com', after: 'new.addr@example.com' }];
  rows.push({ id: 'e' + String(1000 + i), data: d });
}

function allPages(opts) {
  var col = fakeCollection(rows), got = [], pages = 0, people;
  function next(cursor) {
    var o = Object.assign({}, opts, { before: cursor, firstPage: !cursor });
    return AQ.queryPage(col, o).then(function (p) {
      pages++;
      got = got.concat(p.items);
      if (pages === 1) people = p.people;
      if (p.next && pages < 50) {
        var c = AQ.parseQuery(qs({ before: p.next })).before;
        return next(c);
      }
      return { items: got, pages: pages, people: people, reads: col.reads };
    });
  }
  return next(null);
}

function expected(filter) {
  return rows.map(function (r) { return AQ.entryOf(r.id, r.data); })
    .filter(filter || function () { return true; })
    .sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : (a.id < b.id ? 1 : -1); })
    .map(function (e) { return e.id; });
}

/* ---------- areas ---------- */
ok(AQ.areaOf({ action: 'site-saved' }) === 'site', 'a save is Site');
ok(AQ.areaOf({ action: 'published' }) === 'publishing' && AQ.areaOf({ action: 'approved' }) === 'publishing', 'publishing and approvals are Publishing');
ok(AQ.areaOf({ action: 'form-default' }) === 'forms', 'a form action is Forms');
ok(AQ.areaOf({ action: 'leads-imported' }) === 'registrations', 'leads are Registrations');
ok(AQ.areaOf({ action: 'created' }) === 'event', 'creating the event is Event');
ok(AQ.areaOf({ action: 'settings-changed', area: 'design' }) === 'design', 'a stored area wins over the action');
ok(AQ.areaOf({ action: 'settings-changed', area: 'nonsense' }) === 'settings', 'an unknown stored area falls back to the action');
ok(AQ.areaOf({ action: 'theme-changed' }) === 'design' && AQ.areaOf({ action: 'promo-created' }) === 'promotions', 'actions added later get a sensible area');
ok(AQ.areaOf({}) === 'event', 'an entry without an action is Event');
ok(Object.keys(AQ.ACTION_AREA).every(function (a) { return AQ.AREAS.indexOf(AQ.ACTION_AREA[a]) !== -1; }), 'every mapped area is one of the nine');
var ACT = require('./activity').ACTIONS;
ok(ACT.every(function (a) { return !!AQ.ACTION_AREA[a] || AQ.areaOf({ action: a }) !== 'event' || /^(created|updated|deleted|restored|cloned|status-changed)$/.test(a); }), 'every recorded action has an area', ACT.filter(function (a) { return !AQ.ACTION_AREA[a]; }).join());

/* ---------- the query string ---------- */
var p0 = AQ.parseQuery(qs({}), 300);
ok(p0.limit === 300 && p0.firstPage && !p0.before, 'no parameters: the old single page of 300', JSON.stringify(p0));
var p1 = AQ.parseQuery(qs({ limit: '50' }), 300);
ok(p1.limit === 50, 'limit=50');
ok(AQ.parseQuery(qs({ limit: '9999' }), 300).limit === AQ.PAGE_MAX, 'a page is at most PAGE_MAX');
ok(AQ.parseQuery(qs({ area: 'Forms' })).area === 'forms' && AQ.parseQuery(qs({ area: 'bogus' })).area === '', 'area: known ones only, any case');
ok(AQ.parseQuery(qs({ from: 'not a date' })).from === null, 'a date that is not one is ignored');
ok(AQ.parseQuery(qs({ from: '2026-10-21T00:00:00+05:30' })).from === '2026-10-20T18:30:00.000Z', 'from is turned into an ISO time');
var pc = AQ.parseQuery(qs({ before: '2026-10-21T05:00:00.000Z|e1002' }));
ok(pc.before && pc.before.at === '2026-10-21T05:00:00.000Z' && pc.before.id === 'e1002' && !pc.firstPage, 'the cursor is "<at>|<id>"');
ok(AQ.parseQuery(qs({ before: '2026-10-21T05:00:00.000Z' })).before.id === '', 'a cursor of just a time works');
ok(AQ.parseQuery(qs({ before: '2026-10-21T05:00:00.000Z|a/../b' })).before.id === 'ab', 'a cursor id is reduced to id characters');
ok(AQ.parseQuery(qs({ by: ' A@ETB2B.com ' })).by === 'a@etb2b.com', 'by is compared without case');

/* ---------- privacy ---------- */
ok(AQ.maskEmails('Asha (asha.verma@example.com)') === 'Asha (a…@example.com)', 'an address is shortened to its first letter and domain');
var reg = AQ.entryOf('x', { at: 'x', by: 'b@etb2b.com', action: 'registration-updated', detail: 'to asha@example.com', fields: [{ field: 'email', before: 'old@ex.com', after: 'new@ex.com' }] });
ok(reg.by === 'b@etb2b.com' && reg.detail === 'to a…@example.com' && reg.fields[0].before === 'o…@ex.com' && reg.fields[0].after === 'n…@ex.com', 'registrants\' addresses are masked, the staff member is not', JSON.stringify(reg));
var st = AQ.entryOf('y', { at: 'x', by: 'a@etb2b.com', action: 'settings-changed', detail: 'approvers: boss@etb2b.com' });
ok(st.detail === 'approvers: boss@etb2b.com', 'a staff address in a setting is shown');

/* ---------- paging and filters ---------- */
Promise.resolve().then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '50' }))).then(function (r) {
    ok(r.pages === 2, 'unfiltered 70 entries: two pages of 50', r.pages);
    ok(eq(r.items.map(function (e) { return e.id; }), expected()), 'every entry once, newest first, ties included', r.items.map(function (e) { return e.id; }).join());
    ok(eq(r.people, ['a@etb2b.com', 'b@etb2b.com', 'c@etb2b.com', 'platform']), 'the people list, platform last', JSON.stringify(r.people));
    ok(r.items.every(function (e) { return AQ.AREAS.indexOf(e.area) !== -1; }), 'every entry carries its area');
  });
}).then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '7' }))).then(function (r) {
    ok(eq(r.items.map(function (e) { return e.id; }), expected()), 'small pages (7): every entry once, in order, across the tied times');
    ok(r.pages === 10, 'small pages: ten pages for seventy', r.pages);
  });
}).then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '5', by: 'A@etb2b.com' }))).then(function (r) {
    ok(eq(r.items.map(function (e) { return e.id; }), expected(function (e) { return e.by === 'a@etb2b.com'; })), 'by: only that person');
  });
}).then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '4', by: 'platform' }))).then(function (r) {
    ok(r.items.length === 10 && r.items.every(function (e) { return e.by === 'platform'; }), 'by=platform: the platform\'s entries', r.items.length);
  });
}).then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '50', area: 'design' }))).then(function (r) {
    var want = expected(function (e) { return e.area === 'design'; });
    ok(want.length === 20 && eq(r.items.map(function (e) { return e.id; }), want), 'area=design: the stored area and the theme action', r.items.length);
  });
}).then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '50', area: 'forms' }))).then(function (r) {
    ok(r.items.length === 10 && r.pages === 1, 'area=forms: ten, one page');
  });
}).then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '50', action: 'published' }))).then(function (r) {
    ok(r.items.length === 10 && r.items.every(function (e) { return e.action === 'published'; }), 'action=published');
  });
}).then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '50', q: 'PRIYA' }))).then(function (r) {
    ok(r.items.length === 10 && r.items.every(function (e) { return /Priya/.test(e.detail); }), 'q: free text, any case');
  });
}).then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '50', q: 'new.addr' }))).then(function (r) {
    ok(r.items.length === 0, 'q cannot find a registrant by the hidden part of an address', r.items.length);
  });
}).then(function () {
  var from = new Date(T0 - 9 * 60000).toISOString(), to = new Date(T0 - 2 * 60000).toISOString();
  return allPages(AQ.parseQuery(qs({ limit: '3', from: from, to: to }))).then(function (r) {
    ok(eq(r.items.map(function (e) { return e.id; }), expected(function (e) { return e.at >= from && e.at <= to; })) && r.items.length === 8, 'from/to: inclusive range, paged', r.items.length);
  });
}).then(function () {
  return allPages(AQ.parseQuery(qs({ limit: '50', by: 'nobody@x.com' }))).then(function (r) {
    ok(r.items.length === 0 && r.pages === 1, 'no match: an empty page and no next');
  });
}).then(function () {
  /* an old cursor of just a time still pages, strictly older */
  var col = fakeCollection(rows), at = rows[5].data.at;
  return AQ.queryPage(col, AQ.parseQuery(qs({ limit: '50', before: at }))).then(function (p) {
    ok(p.items.length && p.items.every(function (e) { return e.at < at; }), 'a time-only cursor gives older entries');
    ok(p.people === undefined, 'the people list comes with the first page only');
  });
}).then(function () {
  /* a cursor whose document has gone falls back to its time */
  var col = fakeCollection(rows), at = rows[5].data.at;
  return AQ.queryPage(col, AQ.parseQuery(qs({ limit: '50', before: at + '|gone' }))).then(function (p) {
    ok(p.items.length && p.items[0].at < at, 'a cursor whose entry has gone still pages by time');
  });
}).then(function () {
  /* a long log with a rare filter: one request reads at most SCAN_CAP, then hands on a cursor */
  var big = [];
  for (var j = 0; j < AQ.SCAN_CAP + 500; j++) big.push({ id: 'b' + String(100000 + j), data: { at: new Date(T0 - j * 1000).toISOString(), by: j === AQ.SCAN_CAP + 400 ? 'rare@etb2b.com' : 'x@etb2b.com', action: 'site-saved', detail: 'v' } });
  var col = fakeCollection(big);
  return AQ.queryPage(col, AQ.parseQuery(qs({ limit: '50', by: 'rare@etb2b.com' }))).then(function (p) {
    ok(p.items.length === 0 && !!p.next && p.scanned <= AQ.SCAN_CAP + 200, 'a rare filter stops after SCAN_CAP with a cursor', p.scanned + ' ' + p.next);
    return AQ.queryPage(col, AQ.parseQuery(qs({ limit: '50', by: 'rare@etb2b.com', before: p.next })));
  }).then(function (p2) {
    ok(p2.items.length === 1 && p2.next === null, 'the next request finds it and ends', JSON.stringify(p2.items.length) + ' ' + p2.next);
  });
}).then(function () {
  if (failures.length) {
    console.error('activity-query: ' + failures.length + ' of ' + checks + ' checks failed');
    failures.forEach(function (f) { console.error('  FAIL ' + f); });
    process.exit(1);
  }
  console.log('activity-query: all ' + checks + ' checks passed');
}).catch(function (err) { console.error(err); process.exit(1); });
