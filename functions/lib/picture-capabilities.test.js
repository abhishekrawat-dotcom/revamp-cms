/* node functions/lib/picture-capabilities.test.js — what ETB2B AI may say it can and cannot do with pictures
   (lib/picture-capabilities.js, builder A, 16 Nov 2026): the manifest, the prompt block from it, the help text that
   agrees with it, and the claim check on the false answers production and the baseline gave (all caught) and on true
   answers (no false alarms). No network. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 500) : '')); }

var caps = require('./picture-capabilities');
var switches = require('./picture-switches');
var ON = switches.normalise({ plan: true });
var ALL = switches.normalise({ plan: true, edit: true, refs: true, variants: true, critic: true });
var FACTS = { bannerPicture: true };

/* ---------- the manifest and the prompt ---------- */
check(caps.MANIFEST.can.concat(caps.MANIFEST.cannot).every(function (c) { return c.code && c.words && !/\bET\b/.test(c.words); }), 'every entry has a code and words, never a bare "ET"');
check(Object.keys(caps.TRUE_LINES).concat(Object.keys(caps.LIMIT_LINES)).every(function (k) { var s = caps.sentence(k); return s && !/\bET\b/.test(s) && /[.]$/.test(s); }), 'every line the owner reads is a sentence, never a bare "ET"');
var bOff = caps.promptBlock(switches.OFF), bOn = caps.promptBlock(ON), bAll = caps.promptBlock(ALL);
check(!/up to 4/.test(bOff) && /up to 4/.test(bOn) && !/warmer, brighter/.test(bOn) && /warmer, brighter/.test(bAll) && /show 3 options/.test(bAll) && !/show 3 options/.test(bOn),
  'the prompt claims only what the switches allow', [bOff, bOn]);
check(caps.MANIFEST.cannot.every(function (c) { return bOn.indexOf(c.words) !== -1; }), 'every limit is in the prompt, in its own words');
check(caps.MANIFEST.can.every(function (c) { return (bAll.indexOf(c.words) !== -1) === true; }), 'every capability is in the prompt when its switch is on');
check(/a change to a picture already there is made as a new picture/.test(bOn) && !/made as a new picture/.test(bAll), 'with edits off, the prompt says a change is a new picture');

/* the editor's help text (editor-chat-client.js TEXT.welcome) says only what needs no switch */
(function () {
  var src = fs.readFileSync(path.join(__dirname, '..', '..', 'editor-chat-client.js'), 'utf8');
  var at = src.indexOf('welcome: function (eventName) {'), to = src.indexOf('},', at);
  var fn = new vm.Script('(function (eventName) {' + src.slice(src.indexOf('{', at) + 1, to) + '})').runInNewContext({});
  var w = fn('QA Event');
  check(/make new pictures for it \(each in the shape of its frame\)/.test(w) && /use the photos inside a PDF or deck you attach/.test(w), 'the welcome says the always-on capabilities', w);
  check(!/several|up to 4|edit|warmer|options/i.test(w) && !/\bET\b/.test(w), '… and nothing a switch may keep off, nor a bare "ET"', w);
  check(caps.can('make', switches.OFF) && caps.can('pdf-pictures', switches.OFF) && caps.can('fit-frame', switches.OFF), '… which the manifest says are always on');
})();

/* ---------- the claim check: the false answers (production #45, #51; baseline R1, R3, M1, V1; the old "one" sentence) ---------- */
var FALSE = [
  ['Images inside an attached PDF cannot be directly extracted and placed onto the page. You can save them and attach them as pictures.', 'pdf-pictures'],
  ['I can\'t see the pictures inside your PDF, so I can\'t analyse them directly. Tell me what each should show in plain words.', 'pdf-pictures'],
  ['I can\'t pull the pictures out of the PDF, but I can make new ones like them.', 'pdf-pictures'],
  ['I can make one picture per message, so let\'s start with the banner.', 'several'],
  ['I\'ll do one new image at a time — which section first?', 'several'],
  ['I make one new picture per message — ask for the next one when this one is done.', 'several'],
  ['The banner at the top looks empty, so a picture there would help.', 'banner-empty'],
  ['Right now the top of the page is very bare.', 'banner-empty'],
  ['The banner looks plain right now: a pale, empty background.', 'banner-empty'],
  ['I\'m unable to generate images for this page.', 'make']
];
FALSE.forEach(function (f) {
  var r = caps.claimCheck(f[0], ON, FACTS);
  check(!r.ok && r.codes.indexOf(f[1]) !== -1, 'caught (' + f[1] + '): ' + f[0], r);
});
var caught = FALSE.filter(function (f) { return !caps.claimCheck(f[0], ON, FACTS).ok; }).length;
check(caught === FALSE.length, 'every false answer is caught (' + caught + ' of ' + FALSE.length + ')');
(function () {
  var r = caps.claimCheck('I can\'t see the pictures inside your PDF. I can still make a new hero picture for you. I can\'t see the pictures inside the deck either.', ON, FACTS);
  check(!r.ok && r.summary === caps.TRUE_LINES['pdf-pictures'] + ' I can still make a new hero picture for you.', 'the false sentence is replaced by the true line, once; the rest kept', r.summary);
  var e = caps.claimCheck('I can\'t edit an existing image, so I made a new one.', ALL, FACTS);
  check(!e.ok && e.codes[0] === 'edit', 'with edits on, "can\'t edit an image" is false', e);
  check(caps.claimCheck('I can\'t edit an existing image, so I made a new one.', ON, FACTS).ok, '… with edits off, it is true and kept');
  check(caps.claimCheck('I can make one picture per message.', switches.OFF, FACTS).ok, 'with the plan off, "one per message" is true');
  check(caps.claimCheck('The banner looks plain right now.', ON, { bannerPicture: false }).ok && caps.claimCheck('The banner looks plain right now.', ON, {}).ok,
    'a banner with no picture (or not known) may be called plain');
})();

/* ---------- … and true answers: no false alarm ---------- */
var TRUE = [
  'I\'m making a new picture for What Awaits You: a snowy promenade at blue hour.',
  'I can\'t make a picture of a real person, so I\'ll make the congress hall at night instead.',
  'Pictures I make never carry words or logos — the site sets every word itself.',
  'The banner keeps its picture; I\'ve warmed the headline colour.',
  'The banner has a bright Davos picture, so I\'ll leave it as it is.',
  'I made the hero picture and put it in place.',
  'I can\'t open other websites to find the hotel\'s photos.',
  'The new picture did not pass its check, so I did not put it on the page.',
  'I\'m making 3 new pictures at once — one for each section you named.',
  'Your banner plays a video, so a new picture there would not be seen.',
  'The empty space under the cards is gone now.',
  'The Agenda has no sessions yet, so visitors do not see it.',
  'I removed the empty white band at the top of the hero picture.',
  'I can\'t change the speakers\' photos — they come from Content.',
  'I can\'t add the World Economic Forum logo to the picture.',
  'You have no new pictures left today. You can still attach one of your own.',
  'I can see the PDF\'s photos: the promenade, the cable car and the ET Studio set.',
  'I put the promenade photo from your deck into What Awaits You.',
  'The top of the page now has a warmer picture of the valley.',
  'I can\'t make pictures with words in them, so the snow carries no letters.',
  'Tell me which of the two layouts you prefer.',
  'I\'ve made the hero picture brighter and kept the logo unit as it is.'
];
var alarms = TRUE.filter(function (t) { return !caps.claimCheck(t, ALL, FACTS).ok; });
check(alarms.length === 0, 'no true answer is flagged (' + alarms.length + ' of ' + TRUE.length + ')', alarms);
check(caps.claimCheck('', ON, FACTS).ok && caps.claimCheck(null, ON, FACTS).summary === '', 'nothing to check: ok');

if (failures.length) { console.log('picture-capabilities: ' + failures.length + ' of ' + checks + ' checks FAILED'); failures.forEach(function (f) { console.log('  - ' + f); }); process.exit(1); }
console.log('picture-capabilities: all ' + checks + ' checks passed');
