/* node functions/lib/picture-ledger.test.js — the pictures of a person's conversation on an event (lib/picture-ledger.js,
   builder A, 16 Nov 2026): what became of each (placed, undone, held, failed), what the owner said about it, kept at
   aiChats/<uid>.pictureLedger (last 20), read back after a reload, and the lines the chat model gets. In-memory store. */
'use strict';
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 500) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
var L = require('./picture-ledger');

function fakeFb() {
  var docs = {};
  function ref(p) { return { path: p, collection: function (n) { return col(p + '/' + n); }, get: function () { return Promise.resolve({ exists: !!docs[p], data: function () { return clone(docs[p]); } }); } }; }
  function col(p) { return { doc: function (id) { return ref(p + '/' + id); } }; }
  return { docs: docs, db: { collection: col, runTransaction: function (fn) {
    var writes = [];
    var tx = { get: function (r) { return r.get(); }, set: function (r, data, o) { writes.push(function () { docs[r.path] = Object.assign(o && o.merge ? docs[r.path] || {} : {}, clone(data)); }); } };
    return Promise.resolve(fn(tx)).then(function (v) { writes.forEach(function (w) { w(); }); return v; });
  } } };
}
var P = 'events/qa-led/aiChats/u1';
var OWN = 'https://storage.googleapis.com/b/events/qa-led/generated/';

(async function () {
  /* what a turn's pictures became */
  var turn = { id: 'TURN000001', status: 'applied', updatedAt: '2026-11-16T06:00:00Z', pictureJobs: [
    { k: 0, state: 'made', sectionId: 'what-awaits', sectionName: 'What Awaits You', subject: 'a snowy promenade at blue hour with warm lamps along the lake and the hills behind it', url: OWN + 'a.png', madeAt: '2026-11-16T06:00:01Z' },
    { k: 1, state: 'made', held: true, sectionId: 'overview', sectionName: 'Overview', subject: 'a chalet street', url: OWN + 'b.png', madeAt: '2026-11-16T06:00:02Z' },
    { k: 2, state: 'failed', sectionId: 'agenda', sectionName: 'Agenda', subject: 'a red train', failedAt: '2026-11-16T06:00:03Z' },
    { k: 3, state: 'asked', sectionId: 'why-join-us', subject: 'a lounge' }] };
  turn.newPicture = turn.pictureJobs[0];
  var got = L.fromTurn(turn);
  check(got.length === 3 && got.map(function (e) { return e.state; }).join() === 'placed,held,failed', 'a turn applied: placed, held, failed (one still asked is not kept)', got.map(function (e) { return e.state; }));
  check(got[0].key === 'TURN000001:0' && got[0].subjectShort.split(' ').length <= 15 && /…$/.test(got[0].subjectShort) && got[0].url === OWN + 'a.png', 'each by its key, a short subject and its address', got[0]);
  check(L.fromTurn(Object.assign({}, turn, { status: 'undone' }))[0].state === 'undone', 'a turn undone: undone');
  check(L.fromTurn({ id: 'TURN000002', status: 'applying', newPicture: { state: 'made', sectionId: 'hero', url: OWN + 'c.png', subject: 'x y z' } })[0].state === 'made', 'a turn of one picture still being applied: made');
  check(L.fromTurn({ id: 'TURN000003', newPicture: { state: 'offered', sectionId: 'hero' } }).length === 0 && L.fromTurn(null).length === 0, 'an offer, or no turn: nothing');

  /* kept, merged by key, with the owner's words on the last */
  var fb = fakeFb();
  var kept = await L.record(fb, 'qa-led', 'u1', got, '');
  check(kept.length === 3 && fb.docs[P].pictureLedger.length === 3, 'kept with the conversation', fb.docs[P]);
  var again = await L.record(fb, 'qa-led', 'u1', L.fromTurn(Object.assign({}, turn, { status: 'undone' })), 'no people please');
  check(again.length === 3 && again[0].state === 'undone' && again[2].feedback === 'no people please' && again[2].noPeople === true, 'the same turn again: its entries replaced, the owner\'s words on the newest', again);
  var read = await L.read(fb, 'qa-led', 'u1');
  check(read.length === 3 && read[2].feedback === 'no people please', 'read back after a reload');
  check(JSON.stringify(await L.read(fb, 'qa-led', 'nobody')) === '[]' && JSON.stringify(await L.read(null, 'qa-led', 'u1')) === '[]', 'no ledger: empty');
  /* the last 20 */
  var many = [];
  for (var i = 0; i < 25; i++) many.push({ turnId: 'TURNX' + String(i).padStart(5, '0'), job: 0, sectionId: 's' + i, url: OWN + i + '.png', subject: 'scene ' + i, state: 'placed', at: '2026-11-16T07:' + String(i).padStart(2, '0') + ':00Z' });
  var capped = await L.record(fb, 'qa-led', 'u1', many, '');
  check(capped.length === 20 && capped[19].sectionId === 's24' && capped[0].sectionId === 's5', 'at most the last 20, newest last', capped.map(function (e) { return e.sectionId; }));
  /* cleaned */
  var dirty = L.clean([{ turnId: 'T<b>1</b>', job: 9 }, { turnId: 'TURN9', job: 0, url: 'javascript:alert(1)', state: 'weird', subject: 'x' }, null, 'x']);
  check(dirty.length === 1 && dirty[0].url === '' && dirty[0].state === 'made', 'only clean entries: a bad job number dropped, a bad address emptied, an unknown state "made"', dirty);
  /* a store that fails: never rejects */
  var broken = { db: { collection: function () { throw new Error('down'); }, runTransaction: function () { return Promise.reject(new Error('down')); } } };
  var errs = [], ce = console.error; console.error = function (m) { errs.push(m); };
  var r1 = await L.read(broken, 'qa-led', 'u1'), r2 = await L.record(broken, 'qa-led', 'u1', got, 'x');
  console.error = ce;
  check(JSON.stringify(r1) === '[]' && JSON.stringify(r2) === '[]' && errs.length === 2, 'a store that fails: empty, said in the log, never thrown', errs);

  /* the lines the model gets */
  var lines = L.promptLines(again);
  check(/^PICTURES MADE IN THIS CONVERSATION/.test(lines) && /“What Awaits You”: a snowy promenade/.test(lines) && /placed, then undone by the owner/.test(lines) && /kept off the page/.test(lines) &&
    /the owner said: “no people please”; NO PEOPLE in the next one for this place/.test(lines) && !/https?:/.test(lines), 'the lines: each picture, what became of it, what the owner said — never an address', lines);
  check(L.promptLines([]) === '' && L.promptLines(null) === '', 'none: no lines');
  check(L.NO_PEOPLE_RE.test('no need to use men & women in it') && L.NO_PEOPLE_RE.test('without people') && !L.NO_PEOPLE_RE.test('more people please'), 'the owner\'s "no people", in their words');
})().then(function () {
  if (failures.length) { console.log('picture-ledger: ' + failures.length + ' of ' + checks + ' checks FAILED'); failures.forEach(function (f) { console.log('  - ' + f); }); process.exit(1); }
  console.log('picture-ledger: all ' + checks + ' checks passed');
}, function (err) { console.log('picture-ledger: the test stopped — ' + (err && err.stack)); process.exit(1); });
