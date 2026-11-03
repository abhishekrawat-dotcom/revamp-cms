/* node functions/lib/event-lifecycle.test.js — the one rule for where an event sits (event-lifecycle.js at the repo
   root, window.RevampLifecycle on the events dashboard, require('../../event-lifecycle') on the server for ETB2B AI).
   It must answer exactly what the dashboard's own lifecycleOf() answered before it moved into this file (a copy of
   that function, as it was at dc1a8e1, is below), in three time zones. With opts.tzOffsetMin, whatever zone the
   process runs in, it must answer what that old function answered in the zone of that offset: a date-and-time
   saved with no zone (Create Event's '2026-11-20T19:00') is that clock in the offset, and the day an event starts
   on is the offset's day. The cases include those zone-less values, at the Indian evening and next afternoon, where
   a server that read them as UTC said 'upcoming' or 'active' while the dashboard in India said 'active' or
   'completed'. The file is ES5, loads as a browser global and as a node module, and is one the server sends. No
   network. Exits 1 on any failure. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail) : '')); }

var ROOT = path.resolve(__dirname, '..', '..');
var FILE = path.join(ROOT, 'event-lifecycle.js');
var SRC = fs.readFileSync(FILE, 'utf8');
var L = require('../../event-lifecycle');
var TZ_BEFORE = process.env.TZ;
function inZone(tz, fn) {
  if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  try { return fn(); } finally { if (TZ_BEFORE === undefined) delete process.env.TZ; else process.env.TZ = TZ_BEFORE; }
}

/* Event_Listing.html lines 889-900 at dc1a8e1, pasted unchanged: the dashboard's rule before it moved */
function lifecycleOf(ev, now){
  if (ev.deletedAt || ev.status === 'deleted') return 'deleted';
  if (ev.status === 'cancelled') return 'cancelled';
  if (ev.published !== true) return 'draft';
  var start = ev.start ? new Date(ev.start).getTime() : NaN;
  var end = ev.end ? new Date(ev.end).getTime() : NaN;
  if (isNaN(start) && isNaN(end)) return 'upcoming';
  if (isNaN(end)){ var d = new Date(start); d.setHours(23, 59, 59, 999); end = d.getTime(); }
  if (end < now) return 'completed';
  if (isNaN(start) || start <= now) return 'active';
  return 'upcoming';
}

/* Tue 3 Nov 2026, 12:05 in India */
var NOW = Date.parse('2026-11-03T06:35:00.000Z');
var H = 3600 * 1000;
function iso(ms) { return new Date(ms).toISOString(); }
var CASES = [
  ['deleted (deletedAt), though live and running', { deletedAt: '2026-11-01T00:00:00Z', published: true, start: iso(NOW - H), end: iso(NOW + H) }, 'deleted'],
  ['deleted (status)', { status: 'deleted', published: true }, 'deleted'],
  ['cancelled, though live', { status: 'cancelled', published: true, start: iso(NOW - H), end: iso(NOW + H) }, 'cancelled'],
  ['cancelled and deleted: deleted wins', { status: 'cancelled', deletedAt: '2026-11-01T00:00:00Z', published: true }, 'deleted'],
  ['unpublished, running now: still a draft', { published: false, start: iso(NOW - H), end: iso(NOW + H) }, 'draft'],
  ['published only as the string "true": a draft', { published: 'true', start: iso(NOW - H), end: iso(NOW + H) }, 'draft'],
  ['unpublished with no fields at all', {}, 'draft'],
  ['published with no dates: upcoming', { published: true }, 'upcoming'],
  ['published, start only, two hours ago (today): active', { published: true, start: iso(NOW - 2 * H) }, 'active'],
  ['published, start only, yesterday: completed', { published: true, start: iso(NOW - 30 * H) }, 'completed'],
  ['published, ended an hour ago: completed', { published: true, start: iso(NOW - 26 * H), end: iso(NOW - H) }, 'completed'],
  ['published, start <= now < end: active', { published: true, start: iso(NOW - H), end: iso(NOW + H) }, 'active'],
  ['published, starts this very moment: active', { published: true, start: iso(NOW), end: iso(NOW + H) }, 'active'],
  ['published, ends this very moment: still active', { published: true, start: iso(NOW - H), end: iso(NOW) }, 'active'],
  ['published, in the future: upcoming', { published: true, start: iso(NOW + 17 * 24 * H), end: iso(NOW + 18 * 24 * H) }, 'upcoming'],
  ['published, future start only: upcoming', { published: true, start: iso(NOW + 5 * 24 * H) }, 'upcoming'],
  ['published, end only, in the future: active', { published: true, end: iso(NOW + H) }, 'active'],
  ['published, end only, in the past: completed', { published: true, end: iso(NOW - H) }, 'completed'],
  ['published, both dates invalid: upcoming', { published: true, start: 'not a date', end: 'soon' }, 'upcoming'],
  ['published, invalid start, future end: active', { published: true, start: 'not a date', end: iso(NOW + H) }, 'active'],
  ['published, start an hour ago, invalid end: runs to the end of its day', { published: true, start: iso(NOW - H), end: 'later' }, 'active'],
  ['published, a date-only start of today', { published: true, start: '2026-11-03' }, null],
  ['published, a date-only start of yesterday', { published: true, start: '2026-11-02' }, null],
  ['the record\'s own status is ignored', { status: 'live', published: true, start: iso(NOW - H), end: iso(NOW + H) }, 'active'],
  ['null dates', { published: true, start: null, end: null }, 'upcoming'],
  /* what Create Event really saves: the date picker's wall clock, with no zone (create-event.html, type="datetime-local") */
  ['datetime-local: an evening start only (19:00)', { published: true, start: '2026-11-03T19:00' }, null],
  ['datetime-local: a late start only (23:00)', { published: true, start: '2026-11-03T23:00' }, null],
  ['datetime-local: a start just after midnight (00:30)', { published: true, start: '2026-11-03T00:30' }, null],
  ['datetime-local: a day event, 10:00 to 18:00', { published: true, start: '2026-11-03T10:00', end: '2026-11-03T18:00' }, null],
  ['datetime-local: an evening that ends after midnight, 19:00 to 01:00', { published: true, start: '2026-11-03T19:00', end: '2026-11-04T01:00' }, null],
  ['datetime-local: an end only (21:00)', { published: true, end: '2026-11-03T21:00' }, null],
  ['datetime-local with seconds and milliseconds', { published: true, start: '2026-11-03T19:00:30', end: '2026-11-03T23:59:59.999' }, null],
  ['datetime-local with a single fraction digit and with four', { published: true, start: '2026-11-03T12:00:00.5', end: '2026-11-03T18:00:00.1234' }, null],
  ['datetime-local: midnight written as 24:00', { published: true, start: '2026-11-03T19:00', end: '2026-11-03T24:00' }, null],
  ['datetime-local: a day past the month end rolls on, as the browser has it (30 Feb)', { published: true, start: '2026-02-30T10:00' }, null],
  ['datetime-local that the browser refuses (month 13, 10:60): no date', { published: true, start: '2026-13-01T10:00', end: '2026-11-03T10:60' }, 'upcoming'],
  ['datetime-local start, date-only end', { published: true, start: '2026-11-02T19:00', end: '2026-11-03' }, null],
  ['a zoned start (+05:30) and a datetime-local end', { published: true, start: '2026-11-03T19:00+05:30', end: '2026-11-03T22:00' }, null],
  ['a zoned start in UTC (Z), start only', { published: true, start: '2026-11-03T13:30:00Z' }, null]
];
/* the moments each case is also asked about: around now, either side of the local and Indian midnights, and the
   evening and the next afternoon in India, when an evening event read on the wrong clock would be wrong */
var NOWS = [NOW, NOW - 6 * H, NOW + 6 * H, NOW + 12 * H, NOW + 17.5 * H, NOW + 18 * H, NOW - 24 * H, Date.parse('2026-11-03T18:29:59.999Z'), Date.parse('2026-11-03T18:30:00.000Z'), Date.parse('2026-11-03T23:59:59.999Z'), Date.parse('2026-11-04T00:00:00.000Z'),
  Date.parse('2026-11-03T04:30:00.000Z') /* 10:00 IST */, Date.parse('2026-11-03T12:30:00.000Z') /* 18:00 IST */, Date.parse('2026-11-03T13:29:59.999Z'), Date.parse('2026-11-03T13:30:00.000Z') /* 19:00 IST */,
  Date.parse('2026-11-03T14:30:00.000Z') /* 20:00 IST */, Date.parse('2026-11-03T15:00:00.000Z') /* 20:30 IST */, Date.parse('2026-11-03T17:30:00.000Z') /* 23:00 IST */,
  Date.parse('2026-11-03T19:00:00.000Z') /* 00:30 IST, 4 Nov */, Date.parse('2026-11-03T19:30:00.000Z') /* 01:00 IST, 4 Nov */, Date.parse('2026-11-04T10:00:00.000Z') /* 15:30 IST, 4 Nov */,
  Date.parse('2026-11-02T19:00:00.000Z') /* 00:30 IST, 3 Nov */, Date.parse('2026-11-03T05:00:00.000Z'), Date.parse('2026-11-03T08:00:00.000Z')];

/* ---------- 1. the exports ---------- */
ok(typeof L.of === 'function' && Object.keys(L).sort().join() === 'LABELS,of', 'node: module.exports is { of, LABELS }', Object.keys(L));
ok(JSON.stringify(L.LABELS) === JSON.stringify({ draft: 'Draft', upcoming: 'Upcoming', active: 'Active', completed: 'Completed', cancelled: 'Cancelled', deleted: 'Deleted' }),
  'LABELS are the six words the dashboard shows', L.LABELS);
ok(Object.isFrozen(L.LABELS), 'LABELS cannot be changed by one caller for all the others');

/* ---------- 2. the cases, in three time zones: the expected answer, and the same answer as the old function ---------- */
['Asia/Kolkata', 'UTC', 'America/Los_Angeles'].forEach(function (tz) {
  inZone(tz, function () {
    CASES.forEach(function (c) {
      var got = L.of(c[1], NOW);
      if (c[2]) ok(got === c[2], tz + ': ' + c[0] + ' -> ' + c[2], got);
      NOWS.forEach(function (n) {
        var want = lifecycleOf(c[1], n), mine = L.of(c[1], n);
        ok(mine === want, tz + ': ' + c[0] + ' at ' + iso(n) + ' answers what the dashboard\'s lifecycleOf() answered', { want: want, got: mine });
      });
    });
  });
});
inZone('UTC', function () {
  ok(L.of({ published: true, start: '2026-11-03' }, NOW) === 'active' && L.of({ published: true, start: '2026-11-02' }, NOW) === 'completed',
    'UTC: a date-only start of today is active, of yesterday completed');
});

/* ---------- 3. opts.tzOffsetMin: the day an event starts on is that offset's day ---------- */
var IST = { tzOffsetMin: 330 };
var ELEVEN_PM = { published: true, start: '2026-11-03T17:30:00.000Z' };     // 23:00 IST, Tue 3 Nov
var HALF_PAST_MIDNIGHT = { published: true, start: '2026-11-02T19:00:00.000Z' };   // 00:30 IST, Tue 3 Nov (still Mon 2 Nov in UTC)
['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati'].forEach(function (tz) {
  inZone(tz, function () {
    ok(L.of(ELEVEN_PM, Date.parse('2026-11-03T18:00:00.000Z'), IST) === 'active', tz + ': an event that starts at 23:00 IST is active at 23:30 IST');
    ok(L.of(ELEVEN_PM, Date.parse('2026-11-03T18:29:59.999Z'), IST) === 'active', tz + ': … and at 23:59:59.999 IST');
    ok(L.of(ELEVEN_PM, Date.parse('2026-11-03T18:30:00.000Z'), IST) === 'completed', tz + ': … and completed at midnight IST');
    ok(L.of(ELEVEN_PM, Date.parse('2026-11-03T17:00:00.000Z'), IST) === 'upcoming', tz + ': … and upcoming at 22:30 IST');
    ok(L.of(HALF_PAST_MIDNIGHT, Date.parse('2026-11-03T10:00:00.000Z'), IST) === 'active', tz + ': an event that starts at 00:30 IST is active at 15:30 IST that day');
    ok(L.of(HALF_PAST_MIDNIGHT, Date.parse('2026-11-03T18:30:00.000Z'), IST) === 'completed', tz + ': … and completed at the next midnight IST');
    ok(L.of(ELEVEN_PM, Date.parse('2026-11-03T18:30:00.000Z'), { tzOffsetMin: 0 }) === 'active', tz + ': in UTC the 23:00 IST event runs to 23:59 UTC');
    ok(L.of(HALF_PAST_MIDNIGHT, Date.parse('2026-11-03T10:00:00.000Z'), { tzOffsetMin: 0 }) === 'completed', tz + ': in UTC the 00:30 IST event ended at 23:59 UTC the day before');
    /* a zoned stamp, a missing date, and the statuses do not depend on the offset */
    ok(L.of({ published: true, start: iso(NOW - H), end: iso(NOW + H) }, NOW, IST) === 'active' && L.of({ published: true }, NOW, IST) === 'upcoming' &&
      L.of({ published: false, start: iso(NOW) }, NOW, IST) === 'draft' && L.of({ status: 'cancelled', published: true }, NOW, IST) === 'cancelled' &&
      L.of({ deletedAt: 'x' }, NOW, IST) === 'deleted', tz + ': a zoned stamp, no date, and the statuses are the same with an offset');
  });
});

/* ---------- 3b. what Create Event saves (no zone) is the clock in the offset: the awards night of the report ----------
   An awards night that starts at 7 pm in India, saved as '2026-11-20T19:00'. A server runs in UTC; the dashboard
   in India. With tzOffsetMin 330 the server must answer what the dashboard answers. */
var AWARDS_NIGHT = { published: true, start: '2026-11-20T19:00' };
var DAY_EVENT = { published: true, start: '2026-11-20T10:00', end: '2026-11-20T18:00' };
function istMs(s) { return Date.parse(s + '+05:30'); }
['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati'].forEach(function (tz) {
  inZone(tz, function () {
    ok(L.of(AWARDS_NIGHT, istMs('2026-11-20T18:59:59.999'), IST) === 'upcoming', tz + ': a 7 pm IST awards night is upcoming at 18:59 IST');
    ok(L.of(AWARDS_NIGHT, istMs('2026-11-20T19:00'), IST) === 'active', tz + ': … active from 19:00 IST');
    ok(L.of(AWARDS_NIGHT, istMs('2026-11-20T20:30'), IST) === 'active', tz + ': … active at 20:30 IST (it said upcoming when the clock was read as UTC)');
    ok(L.of(AWARDS_NIGHT, istMs('2026-11-20T23:59:59.999'), IST) === 'active', tz + ': … active at 23:59:59.999 IST');
    ok(L.of(AWARDS_NIGHT, istMs('2026-11-21T00:00'), IST) === 'completed', tz + ': … completed at midnight IST');
    ok(L.of(AWARDS_NIGHT, istMs('2026-11-21T15:30'), IST) === 'completed', tz + ': … completed at 15:30 IST the next day (it said active)');
    ok(L.of(DAY_EVENT, istMs('2026-11-20T09:59'), IST) === 'upcoming' && L.of(DAY_EVENT, istMs('2026-11-20T10:00'), IST) === 'active' &&
      L.of(DAY_EVENT, istMs('2026-11-20T18:00'), IST) === 'active' && L.of(DAY_EVENT, istMs('2026-11-20T18:00:00.001'), IST) === 'completed',
      tz + ': a 10:00-18:00 IST day event is upcoming, active, then completed on the Indian clock');
    ok(L.of(DAY_EVENT, istMs('2026-11-20T20:00'), IST) === 'completed', tz + ': … completed at 20:00 IST (it said active)');
    /* a zoned stamp is read as it says, whatever the offset */
    ok(L.of({ published: true, start: '2026-11-20T19:00+05:30' }, istMs('2026-11-20T20:30'), IST) === 'active' &&
      L.of({ published: true, start: '2026-11-20T13:30:00.000Z' }, istMs('2026-11-20T20:30'), IST) === 'active' &&
      L.of({ published: true, start: '2026-11-20T19:00+05:30', end: '2026-11-20T21:00+05:30' }, istMs('2026-11-20T21:00:00.001'), IST) === 'completed',
      tz + ': a stamp with Z or +05:30 is the instant it names');
    /* the offset is the offset given: at UTC (0) the same string is 19:00 UTC */
    ok(L.of(AWARDS_NIGHT, Date.parse('2026-11-20T18:59:59.999Z'), { tzOffsetMin: 0 }) === 'upcoming' &&
      L.of(AWARDS_NIGHT, Date.parse('2026-11-20T19:00:00.000Z'), { tzOffsetMin: 0 }) === 'active', tz + ': tzOffsetMin 0 reads the clock as UTC');
    /* a date-only start is UTC midnight, as a browser reads it; in India that is 05:30, and the day is India's */
    ok(L.of({ published: true, start: '2026-11-20' }, istMs('2026-11-20T05:29:59.999'), IST) === 'upcoming' &&
      L.of({ published: true, start: '2026-11-20' }, istMs('2026-11-20T05:30'), IST) === 'active' &&
      L.of({ published: true, start: '2026-11-20' }, istMs('2026-11-20T23:59:59.999'), IST) === 'active' &&
      L.of({ published: true, start: '2026-11-20' }, istMs('2026-11-21T00:00'), IST) === 'completed', tz + ': a date-only start is UTC midnight and runs to the end of that day in India');
    /* a non-string date (a number of ms) is not a clock: it is read as it is */
    ok(L.of({ published: true, start: istMs('2026-11-20T19:00') }, istMs('2026-11-20T20:30'), IST) === 'active', tz + ': a start given as milliseconds is that instant');
  });
});
/* without opts nothing moved: the dashboard's own reading of the same strings, in its own zone */
inZone('Asia/Kolkata', function () {
  ok(L.of(AWARDS_NIGHT, istMs('2026-11-20T20:30')) === 'active' && L.of(AWARDS_NIGHT, istMs('2026-11-21T15:30')) === 'completed' &&
    L.of(DAY_EVENT, istMs('2026-11-20T20:00')) === 'completed', 'no opts, in India: the dashboard reads the clock in India, as before');
});
inZone('UTC', function () {
  ok(L.of(AWARDS_NIGHT, istMs('2026-11-20T20:30')) === 'upcoming' && L.of(DAY_EVENT, istMs('2026-11-20T20:00')) === 'active',
    'no opts, in UTC: the clock is read in the process\'s zone, exactly as the dashboard\'s old rule (so a server must pass the offset)');
});
/* the offset gives the same answers as the old rule run in that zone (India has no daylight saving) */
var IST_ANSWERS = inZone('Asia/Kolkata', function () { return CASES.map(function (c) { return NOWS.map(function (n) { return lifecycleOf(c[1], n); }).join(); }); });
var UTC_ANSWERS = inZone('UTC', function () { return CASES.map(function (c) { return NOWS.map(function (n) { return lifecycleOf(c[1], n); }).join(); }); });
['UTC', 'America/Los_Angeles', 'Asia/Kolkata'].forEach(function (tz) {
  inZone(tz, function () {
    CASES.forEach(function (c, i) {
      var ist = NOWS.map(function (n) { return L.of(c[1], n, IST); }).join(), utc = NOWS.map(function (n) { return L.of(c[1], n, { tzOffsetMin: 0 }); }).join();
      ok(ist === IST_ANSWERS[i], 'process in ' + tz + ', tzOffsetMin 330: ' + c[0] + ' answers as the old rule did in India', { want: IST_ANSWERS[i], got: ist });
      ok(utc === UTC_ANSWERS[i], 'process in ' + tz + ', tzOffsetMin 0: ' + c[0] + ' answers as the old rule did in UTC', { want: UTC_ANSWERS[i], got: utc });
    });
  });
});
/* an offset that is not a finite number is no offset: local time, as before */
inZone('America/Los_Angeles', function () {
  [{}, null, undefined, { tzOffsetMin: '330' }, { tzOffsetMin: NaN }, { tzOffsetMin: Infinity }, { tzOffsetMin: null }].forEach(function (o) {
    var same = CASES.every(function (c) { return NOWS.every(function (n) { return L.of(c[1], n, o) === lifecycleOf(c[1], n); }); });
    ok(same, 'opts ' + JSON.stringify(o === undefined ? 'undefined' : o) + ' is local time, as the dashboard has always had it');
  });
});

/* ---------- 4. ES5, a browser global, served ---------- */
var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
ok(!/\blet\s/.test(code), 'ES5: no let');
ok(!/\bconst\s/.test(code), 'ES5: no const');
ok(code.indexOf('=>') === -1, 'ES5: no arrow functions');
ok(!/\basync\b|\bawait\b/.test(code), 'ES5: no async / await');
ok(!/\bclass\s/.test(code), 'ES5: no class');
ok(code.indexOf('`') === -1, 'ES5: no template strings');
ok(code.indexOf('...') === -1, 'ES5: no spread or rest');
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the checks above still run */ }
ok(!!esbuild, 'esbuild is there to check the file (the root node_modules)');
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
  ok(es5 === true, 'ES5 by esbuild', es5);
}

/* in a browser: one global, window.RevampLifecycle, and nothing on module */
var ctx = { Date: Date, isNaN: isNaN, isFinite: isFinite, Object: Object };
ctx.window = ctx;
vm.createContext(ctx);
var own = Object.keys(ctx);
vm.runInContext(SRC, ctx, { filename: 'event-lifecycle.js' });
var added = Object.keys(ctx).filter(function (k) { return own.indexOf(k) === -1; });
ok(added.join() === 'RevampLifecycle', 'browser: the only new global is RevampLifecycle', added);
var W = ctx.RevampLifecycle;
ok(W && typeof W.of === 'function' && W.LABELS && W.LABELS.active === 'Active', 'browser: window.RevampLifecycle has of() and LABELS');
ok(W && CASES.every(function (c) { return W.of(c[1], NOW) === L.of(c[1], NOW) && W.of(c[1], NOW, IST) === L.of(c[1], NOW, IST); }), 'browser: the same answers as in node');
/* a page that has a `module` of its own (an AMD-style loader is not used here) still gets the global when module has no exports */
var ctx2 = { Date: Date, isNaN: isNaN, isFinite: isFinite, Object: Object, module: {} };
ctx2.window = ctx2;
vm.createContext(ctx2);
vm.runInContext(SRC, ctx2);
ok(ctx2.RevampLifecycle && typeof ctx2.RevampLifecycle.of === 'function', 'browser: a stray `module` object without exports does not swallow the global');

ok(require('./access').isServableFile('event-lifecycle.js') === true, 'the server sends event-lifecycle.js to the dashboard (a top-level script)');

/* the test leaves the zone as it found it */
ok(process.env.TZ === TZ_BEFORE, 'TZ restored');

if (failures.length) {
  console.error('event-lifecycle.test.js: ' + failures.length + ' of ' + checks + ' checks FAILED');
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
console.log('event-lifecycle.test.js: all ' + checks + ' checks passed');
