/* node functions/lib/register.test.js — exits 1 on the first failure it lists. No network, no Firebase calls.
   The pure decisions behind POST /api/register and the registrations admin routes: the status a new
   response gets (approval, capacity, counted forms only) and how every total moves when a response is
   made, changed or deleted (lib/api-audience.js counterDelta, version 2 of the totals). */
'use strict';
const F = require('./forms');
const A = require('./api-audience');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ---------- planStatus ---------- */
var matrix = [
  // counts, needsApproval, capacity, confirmed -> status
  [true, false, null, 0, 'confirmed'],
  [true, false, 10, 9, 'confirmed'],
  [true, false, 10, 10, 'waitlist'],
  [true, false, 10, 25, 'waitlist'],
  [true, true, 10, 10, 'pending'],
  [true, true, null, 0, 'pending'],
  [false, false, 10, 10, 'confirmed'],          // a form that does not count never waitlists
  [false, false, null, 0, 'confirmed'],
  [false, true, 10, 10, 'pending'],
  [true, false, 0, 0, 'waitlist']               // (a capacity of 0 is stored as none; were it 0, nobody gets in)
];
matrix.forEach(function (m) {
  var got = F.planStatus({ counts: m[0], needsApproval: m[1], capacity: m[2], confirmed: m[3] });
  ok(got === m[4], 'planStatus counts=' + m[0] + ' approval=' + m[1] + ' capacity=' + m[2] + ' confirmed=' + m[3] + ' -> ' + m[4], got);
});

/* ---------- counterDelta ---------- */
var d = A.counterDelta;
ok(A.AUDIENCE_V === 2, 'the totals are version 2');
ok(eq(A.REG_STATUSES, ['confirmed', 'waitlist', 'pending', 'rejected', 'cancelled']), 'the five statuses');

var counted = { formId: 'register', counts: true, status: 'confirmed', checkedInAt: null };
ok(eq(d(null, counted), { forms: { register: { n: 1 } }, submissions: 1, registrations: 1, confirmed: 1 }), 'create, counted and confirmed', JSON.stringify(d(null, counted)));
ok(eq(d(counted, null), { forms: { register: { n: -1 } }, submissions: -1, registrations: -1, confirmed: -1 }), 'delete gives every total back', JSON.stringify(d(counted, null)));

var interest = { formId: 'express-interest', counts: false, status: 'confirmed' };
ok(eq(d(null, interest), { forms: { 'express-interest': { n: 1 } }, submissions: 1 }), 'create, not counted: a submission and its form only', JSON.stringify(d(null, interest)));
ok(eq(d(interest, null), { forms: { 'express-interest': { n: -1 } }, submissions: -1 }), 'delete, not counted');

var vipPending = { formId: 'vip-delegates', counts: true, status: 'pending' };
ok(eq(d(null, vipPending), { forms: { 'vip-delegates': { n: 1, pending: 1 } }, submissions: 1, registrations: 1, pending: 1 }), 'create, counted and pending', JSON.stringify(d(null, vipPending)));
var approved = Object.assign({}, vipPending, { status: 'confirmed', decidedAt: 'x' });
ok(eq(d(vipPending, approved), { forms: { 'vip-delegates': { pending: -1 } }, pending: -1, confirmed: 1 }), 'pending -> confirmed: approval moves pending to confirmed', JSON.stringify(d(vipPending, approved)));
var declined = Object.assign({}, vipPending, { status: 'rejected' });
ok(eq(d(vipPending, declined), { forms: { 'vip-delegates': { pending: -1 } }, pending: -1, rejected: 1 }), 'pending -> rejected', JSON.stringify(d(vipPending, declined)));

var speakerPending = { formId: 'speaker-application', counts: false, status: 'pending' };
ok(eq(d(null, speakerPending), { forms: { 'speaker-application': { n: 1, pending: 1 } }, submissions: 1 }), 'an uncounted form\'s pending response: its form\'s pending only', JSON.stringify(d(null, speakerPending)));
ok(eq(d(speakerPending, Object.assign({}, speakerPending, { status: 'confirmed' })), { forms: { 'speaker-application': { pending: -1 } } }), 'approving it moves only its form\'s pending');

ok(eq(d(counted, Object.assign({}, counted, { status: 'waitlist' })), { forms: {}, confirmed: -1, waitlist: 1 }), 'confirmed -> waitlist', JSON.stringify(d(counted, Object.assign({}, counted, { status: 'waitlist' }))));
ok(eq(d(counted, Object.assign({}, counted, { checkedInAt: '2026-10-19T10:00:00.000Z' })), { forms: {}, checkedIn: 1 }), 'checked in');
var inAndCancelled = Object.assign({}, counted, { checkedInAt: 'x' });
ok(eq(d(inAndCancelled, Object.assign({}, counted, { status: 'cancelled', checkedInAt: null })), { forms: {}, confirmed: -1, checkedIn: -1, cancelled: 1 }), 'check-in undone and cancelled at once');
ok(eq(d(Object.assign({}, interest, { checkedInAt: 'x' }), null), { forms: { 'express-interest': { n: -1 } }, submissions: -1 }), 'an uncounted response never moved checkedIn');
ok(eq(d(counted, counted), { forms: {} }), 'no change: nothing moves');

var legacy = { status: 'waitlist' };   // a registration from before forms: no formId, no counts
ok(eq(d(null, legacy), { forms: { register: { n: 1 } }, submissions: 1, registrations: 1, waitlist: 1 }), 'a registration from before forms counts, under "register"', JSON.stringify(d(null, legacy)));
ok(eq(d({ status: 'something-old' }, null), { forms: { register: { n: -1 } }, submissions: -1, registrations: -1, confirmed: -1 }), 'an unknown stored status is read as confirmed');

/* a batch of creates adds up to the sum of its parts (the transaction sums contributions) */
var total = { forms: {} };
[counted, interest, vipPending, legacy].forEach(function (doc) {
  var x = d(null, doc);
  Object.keys(x).forEach(function (k) {
    if (k === 'forms') Object.keys(x.forms).forEach(function (id) { var f = total.forms[id] || (total.forms[id] = { n: 0, pending: 0 }); f.n += x.forms[id].n || 0; f.pending += x.forms[id].pending || 0; });
    else total[k] = (total[k] || 0) + x[k];
  });
});
ok(total.submissions === 4 && total.registrations === 3 && total.confirmed === 1 && total.pending === 1 && total.waitlist === 1 && total.forms.register.n === 2, 'four responses: four submissions, three registrations', JSON.stringify(total));

if (failures.length) {
  console.error(failures.length + ' of ' + checks + ' checks FAILED:\n');
  failures.forEach(function (f) { console.error('  - ' + f + '\n'); });
  process.exit(1);
}
console.log('register: all ' + checks + ' checks passed');
