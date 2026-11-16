/* node functions/lib/picture-learn.test.js — the team's record learns when a picture went wrong (lib/ai-learn.js, the
   advanced picture assistant W4, builder A, 16 Nov 2026): a message right after a change that says it is not right is a
   correction (the owner's 10 real complaints of 16 Nov caught, ordinary follow-ups not), the earlier turn is marked
   corrected, a limit claimed and put right is a rule of its own, and the approvers' report counts the pictures. */
'use strict';
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 500) : '')); }
var L = require('./ai-learn'), T = L._test;

/* the owner's own words (failures.md: none of them was caught by the complaint words) */
var COMPLAINTS = [
  'still not fixed',
  'still it is not fixed',
  'the response is not acceptable. use the hotel images',
  'you have created a square image and placeholder is rectangular',
  'this image not seems relevant to the section',
  'hero section background is completely blank now',
  'the picture in what awaits is not appropriate',
  'the logos and headshots are distorted',
  'navigation got distorted after the change',
  'there are white spaces in the side of images'
];
var caught = COMPLAINTS.filter(function (c) { return !!T.correctionOf(c, { afterChange: true }); });
check(caught.length >= 9, 'at least 9 of the owner\'s 10 real complaints are caught (' + caught.length + ')', COMPLAINTS.filter(function (c) { return !T.correctionOf(c, { afterChange: true }); }));
check(COMPLAINTS.every(function (c) { return !T.correctionOf(c, { afterChange: false }); }), 'never for a message that does not follow a change');

var NEUTRAL = [
  'make it warmer', 'another one', 'yes', 'go ahead', 'add a picture to the agenda', 'make the hero picture brighter', 'thanks', 'looks good',
  'perfect, now the overview', 'change the heading to Welcome', 'use this photo as the background', 'remove the people from it', 'make it wider so it fills the frame',
  'shorten the overview to two sentences', 'what can you do with the pdf?', 'add pictures across the site', 'make the agenda background navy',
  'move the FAQ above the footer', 'fix the typo in the overview', 'the text is still too small', 'show me a few options', 'try a different scene',
  'not now', 'can you add a speakers section?', 'great, publish-ready?', 'make the buttons rounder', 'I still want a picture of the lake',
  'give Why Join Us a square picture of a red train', 'no people please', 'now make the banner darker'
];
var alarms = NEUTRAL.filter(function (n) { return !!T.correctionOf(n, { afterChange: true, prevQuestion: 'make a new hero picture of the Davos valley' }); });
check(NEUTRAL.length === 30 && alarms.length <= 1, 'at most 1 false alarm in 30 ordinary follow-ups (' + alarms.length + ')', alarms);
check(T.correctionOf('make a new hero picture of the Davos valley', { afterChange: true, prevQuestion: 'Make a new hero picture of the Davos valley!' }) === 'repeat' &&
  T.correctionOf('yes', { afterChange: true, prevQuestion: 'yes' }) === '', 'the same ask again is a correction ("yes" twice is not)');
check(T.correctionOf('still not fixed', { afterChange: true }) === 'still-wrong' && T.correctionOf('there are white spaces in the side of images', { afterChange: true }) === 'white-space' &&
  T.correctionOf('you have created a square image and placeholder is rectangular', { afterChange: true }) === 'shape', 'each kind by its words');

/* the entry */
var e = T.entryOf({ brain: 'edit', decoded: { uid: 'u1', email: 'a@timesinternet.in' }, eventId: 'qa-paia-learn', words: 'still not fixed', did: { kind: 'edit', target: 'rework' },
  outcome: 'pending', turnId: 'TURNLEARN02', afterChange: true, prevQuestion: 'there are white spaces in the side of images', known: [],
  pictures: { planned: 2, signalRegex: false, signalNameRun: true, shortcut: false, junk: 'x' }, pictureOutcome: 'held' }, Date.UTC(2026, 10, 16));
check(e.correction === 'still-wrong' && e.complaint === true && JSON.stringify(e.pictures) === JSON.stringify({ planned: 2, signalRegex: false, signalNameRun: true, shortcut: false }) && e.pictureOutcome === 'held',
  'the entry keeps the correction (a complaint note too), the plan\'s counts and what became of its pictures', e);
var plain = T.entryOf({ brain: 'edit', decoded: { uid: 'u1' }, eventId: 'qa-paia-learn', words: 'make it warmer', outcome: 'pending', afterChange: true, known: [] }, Date.UTC(2026, 10, 16));
check(!plain.correction && !plain.pictures && !plain.pictureOutcome && plain.complaint === false, 'an ordinary follow-up: none of it', plain);
check(L.editFacts({ kind: 'edit', summary: 'x', newPicture: {} }, { falseClaim: 'pdf-pictures' }).rule === 'false-claim' && L.editFacts({ kind: 'reply', summary: 'x' }, { pictureRefused: true, falseClaim: 'x' }).rule === 'picture',
  'a limit claimed and put right is its own rule; a refusal keeps its own');

/* the earlier turn marked corrected */
(async function () {
  var updated = [];
  var stored = { uid: 'u1', did: { kind: 'edit', target: 'new-picture' }, pictures: { planned: 1 } };
  var fb = { db: { collection: function () { return { where: function () { return { limit: function () { return { get: function () {
    return Promise.resolve({ docs: [{ id: 'r1', data: function () { return stored; }, ref: { update: function (p) { updated.push(p); return Promise.resolve(); } } }] }); } }; } }; } }; } } };
  var p = await T.markCorrected(fb, 'edit', 'TURNLEARN01', 'u1', { turnId: 'TURNLEARN02', kind: 'still-wrong' });
  check(p && updated.length === 1 && updated[0].correctedBy.turnId === 'TURNLEARN02' && updated[0].correctedBy.kind === 'still-wrong' && updated[0].pictureOutcome === 'corrected', 'the turn before is marked corrected, with the kind', updated);
  updated.length = 0; stored.uid = 'someone-else';
  check((await T.markCorrected(fb, 'edit', 'TURNLEARN01', 'u1', { turnId: 'TURNLEARN02', kind: 'x' })) === null && !updated.length, 'only the person\'s own turn');

  /* the report */
  var now = '2026-11-16T06:00:00.000Z';
  var entries = [
    { uid: 'u1', intent: 'add picture', page: 'editor', outcome: 'done', did: { kind: 'edit', target: 'new-picture' }, pictures: { planned: 3, shortcut: false }, at: now, correctedBy: { turnId: 'X', kind: 'still-wrong' }, pictureOutcome: 'corrected' },
    { uid: 'u1', intent: 'fix picture', page: 'editor', outcome: 'pending', did: { kind: 'edit', target: 'rework' }, correction: 'still-wrong', words: 'still not fixed', at: now },
    { uid: 'u1', intent: 'add picture', page: 'editor', outcome: 'refused', rule: 'picture', did: { kind: 'reply', target: '' }, at: now },
    { uid: 'u1', intent: 'question', page: 'editor', outcome: 'answered', rule: 'false-claim', did: { kind: 'reply', target: '' }, at: now },
    { uid: 'u1', intent: 'add picture', page: 'editor', outcome: 'undone', did: { kind: 'edit', target: 'new-picture' }, pictures: { planned: 1, shortcut: true }, at: now }
  ];
  var r = T.buildReport(entries, [], {});
  check(r.pictures && r.pictures.turns === 3 && r.pictures.planned === 4 && r.pictures.refused === 1 && r.pictures.falseClaims === 1 && r.pictures.corrected === 1 && r.pictures.undone === 1 && r.pictures.yesWithoutModel === 1,
    'the report counts the pictures: turns, planned, refused, false limits, corrected, undone, yeses made with no model call', r.pictures);
  check(r.pictures.corrections.length === 1 && r.pictures.corrections[0].kind === 'still-wrong' && r.pictures.corrections[0].examples[0].words === 'still not fixed', '… and the corrections by kind, with examples', r.pictures.corrections);
})().then(function () {
  if (failures.length) { console.log('picture-learn: ' + failures.length + ' of ' + checks + ' checks FAILED'); failures.forEach(function (f) { console.log('  - ' + f); }); process.exit(1); }
  console.log('picture-learn: all ' + checks + ' checks passed');
}, function (err) { console.log('picture-learn: the test stopped — ' + (err && err.stack)); process.exit(1); });
