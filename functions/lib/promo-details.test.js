// node functions/lib/promo-details.test.js — Content › Basics' three details for posts and mailers (UX-130): who should
// attend, key topics and headline numbers. The rules of lib/promo-details.js (what may be saved, what a number may not
// count, the exact numbers of the owner's "Expected scale"), and PATCH /api/event's reading of them (lib/api.js
// cleanEventBody). No network, no Firebase.
'use strict';
var D = require('./promo-details');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

/* ---------- the lists ---------- */
check('a list never saved (null) is accepted', D.check.whoShouldAttend(null) === '' && D.check.keyTopics(undefined) === '');
check('a list of lines is accepted, empty too (the owner\'s "none")', D.check.whoShouldAttend(['CIOs', 'CTOs']) === '' && D.check.keyTopics([]) === '');
check('not a list is refused in words', D.check.whoShouldAttend('CIOs') === 'Who should attend must be a list.' && D.check.keyTopics({}) === 'Key topics must be a list.');
check('a list of anything but text is refused', D.check.keyTopics(['AI', 3]) === 'Key topics must be a list of text.');
var thirteen = []; for (var i = 0; i < 13; i++) thirteen.push('Line ' + i);
check('at most 12 lines', D.check.whoShouldAttend(thirteen.slice(0, 12)) === '' && D.check.whoShouldAttend(thirteen) === 'Who should attend can have up to 12 lines.');
check('a line too long says which and the limit', D.check.whoShouldAttend(['ok', new Array(162).join('x')]) === 'Line 2 of who should attend is too long (the limit is 160 characters).' &&
  D.check.keyTopics([new Array(221).join('x')]) === '' && D.check.keyTopics([new Array(222).join('x')]) !== '', D.check.whoShouldAttend(['ok', new Array(162).join('x')]));

/* ---------- the numbers ---------- */
check('label + number pairs are accepted', D.check.headlineNumbers([{ value: '500+', label: 'Attendees' }, { value: '12', label: 'Years' }, { value: '2,000', label: 'Countries reached' }]) === '');
check('none saved, or saved empty, is accepted', D.check.headlineNumbers(null) === '' && D.check.headlineNumbers([]) === '');
check('at most 6', D.check.headlineNumbers([1, 2, 3, 4, 5, 6, 7].map(function (n) { return { value: String(n), label: 'Thing ' + n }; })) === 'Headline numbers can have up to 6 numbers.');
check('a pair must have both halves', D.check.headlineNumbers([{ value: '500', label: ' ' }]) === 'Headline number 1 needs both a number and what it counts.' &&
  D.check.headlineNumbers([{ value: '500' }]) === 'Headline number 1 needs a number and what it counts.' && D.check.headlineNumbers(['500']) !== '');
check('the number must have a digit in it', D.check.headlineNumbers([{ value: 'many', label: 'Attendees' }]) === 'Headline number 1: “many” is not a number.');
check('no other field in a pair', /"url" is not accepted/.test(D.check.headlineNumbers([{ value: '5', label: 'Years', url: 'x' }])));
check('limits on both halves', /the number is too long/.test(D.check.headlineNumbers([{ value: '12345678901234567', label: 'X' }])) &&
  /what it counts is too long/.test(D.check.headlineNumbers([{ value: '5', label: new Array(42).join('x') }])));
/* what the event's own records count is never typed: the real count is the one shown */
[['Speakers', 'speakers', 'Content → Speakers'], ['Expert speakers', 'speakers', 'Content → Speakers'], ['Session', 'sessions', 'Content → Agenda'],
  ['Industry partners', 'partners', 'Content → Sponsors'], ['Sponsors', 'partners', 'Content → Sponsors'], ['Days', 'days', 'dates']].forEach(function (c) {
  var why = D.check.headlineNumbers([{ value: '12', label: 'Attendees' }, { value: '40', label: c[0] }]);
  check('“' + c[0] + '” is counted from the records, so it is refused (number 2), saying where', D.countedKind(c[0]) === c[1] && why.indexOf('Headline number 2 (“' + c[0] + '”)') === 0 && why.indexOf(c[2]) !== -1, why);
});
check('what the records do not count is the event\'s own', ['Attendees', 'Years', 'Countries', 'CXOs', 'Speaker hours of content', 'Daysmart users'].every(function (l) { return D.countedKind(l) === ''; }));
check('ownNumbers: usable pairs only, trimmed, counted kinds and half pairs left out, at most 6',
  JSON.stringify(D.ownNumbers([{ value: ' 500+ ', label: ' Attendees ' }, { value: '9', label: 'Speakers' }, { value: '', label: 'X' }, null, 'x', { value: 'lots', label: 'Y' }, { value: '3', label: 'Editions' }])) ===
  JSON.stringify([{ value: '500+', label: 'Attendees' }, { value: '3', label: 'Editions' }]) && D.ownNumbers(null).length === 0);

/* ---------- the owner's "Expected scale" ---------- */
function scale(t) { return JSON.stringify(D.numbersFromScale(t)); }
check('scale: each number and what it counts, as written; days and speakers left out (counted from the records)',
  scale('500+ CXOs, 20 countries, 3 days, 40 speakers') === JSON.stringify([{ value: '500+', label: 'CXOs' }, { value: '20', label: 'Countries' }]), scale('500+ CXOs, 20 countries, 3 days, 40 speakers'));
check('scale: "over 500" is 500+; a guess ("around", "up to") is left out', scale('Over 500 delegates; around 300 online; up to 40 partners') === JSON.stringify([{ value: '500+', label: 'Delegates' }]));
check('scale: a comma inside a number is the number\'s', scale('2,000 attendees and 15 years') === JSON.stringify([{ value: '2,000', label: 'Attendees' }, { value: '15', label: 'Years' }]));
check('scale: "and" divides only before a number', scale('500 CIOs and CTOs') === JSON.stringify([{ value: '500', label: 'CIOs and CTOs' }]));
check('scale: a range and a short form', scale('300 to 400 senior leaders | 1.5k viewers') === JSON.stringify([{ value: '300–400', label: 'Senior leaders' }, { value: '1.5k', label: 'Viewers' }]));
check('scale: words without numbers, or nothing, give nothing', scale('Delegates from across India') === '[]' && scale('') === '[]' && scale(null) === '[]');
check('scale: what it gives always passes the save check', D.check.headlineNumbers(D.numbersFromScale('500+ CXOs, 20 countries, 2,000 viewers, 12 years, 5 cities, 3 continents, 9 awards')) === '' &&
  D.numbersFromScale('500+ CXOs, 20 countries, 2,000 viewers, 12 years, 5 cities, 3 continents, 9 awards').length === 6);

/* ---------- PATCH /api/event reads them as event fields ---------- */
var api = require('./api')._testHooks;
var ok = api.cleanEventBody({ whoShouldAttend: ['CIOs'], keyTopics: [], headlineNumbers: [{ value: '500+', label: 'Attendees' }] }, 'qa-x', false);
check('the three are event fields a PATCH stores as they are sent', !ok.error && JSON.stringify(ok.data) === JSON.stringify({ whoShouldAttend: ['CIOs'], keyTopics: [], headlineNumbers: [{ value: '500+', label: 'Attendees' }] }), ok);
var bad = api.cleanEventBody({ name: 'X', headlineNumbers: [{ value: '50', label: 'Speakers' }] }, 'qa-x', false);
check('… and refused with the rule\'s own words, nothing stored', bad.error === 'Headline number 1 (“Speakers”): speakers are counted from Content → Speakers, so it is not typed here.' && !bad.data, bad);
check('a list that is not one is refused too', api.cleanEventBody({ keyTopics: 'AI' }, 'qa-x', false).error === 'Key topics must be a list.');

console.log(failed ? 'promo-details: ' + failed + ' of ' + (passed + failed) + ' checks FAILED' : 'promo-details: all ' + passed + ' checks passed');
process.exit(failed ? 1 : 0);
