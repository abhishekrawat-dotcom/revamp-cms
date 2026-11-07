/* The three details posts and mailers need that a site does not hold as records (UX-130, the owner's choice of
   2026-11-08, promo-easy-edit/DESIGN.md section 4): "Who should attend", "Key topics" and "Headline numbers".
   They are typed in the console's Content › Basics and saved on the event, as Basics saves its other fields
   (PATCH /api/event):

     events/<id>.whoShouldAttend   [text]              the groups of people the event is for
     events/<id>.keyTopics         [text]              what it discusses
     events/<id>.headlineNumbers   [{ value, label }]  its own numbers ("500+" "Attendees", "12" "Years")

   A field that was never saved is absent, and posts and mailers then use what the AI brief already says
   (lib/promo.js detailsOf); one saved empty is the owner's "none". Speakers, sessions, partners and days are
   never typed here: they are counted from the event's own records and dates (lib/promo.js statsOf), so a
   headline number that names one of them is refused rather than shown beside, or instead of, the real count.

     check.whoShouldAttend(v) / check.keyTopics(v) / check.headlineNumbers(v) -> '' | the sentence that says
                                    what is wrong (lib/api.js EVENT_FIELD_CHECKS uses them)
     countedKind(label)          -> 'speakers' | 'sessions' | 'partners' | 'days' | ''  what a label would count
     ownNumbers(list)            -> [{ value, label }]  the usable pairs of a stored list, counted kinds left out
     numbersFromScale(text)      -> [{ value, label }]  the exact numbers in the owner's "Expected scale" line
     LIMITS                      -> the most each field holds (the console shows the same)
   No network, no Firebase: promo-details.test.js. */
'use strict';

var LIMITS = { listItems: 12, audienceChars: 160, topicChars: 220, numbers: 6, valueChars: 16, labelChars: 40 };

/* what a number's label counts, when it is something the event's own records already count: the real count is
   the one shown, so "50 speakers" typed here would only contradict it */
var COUNTED = [
  { kind: 'speakers', re: /\bspeakers?$/i },
  { kind: 'sessions', re: /\bsessions?$/i },
  { kind: 'partners', re: /\b(partners?|sponsors?)$/i },
  { kind: 'days', re: /\bdays?$/i }
];
var COUNTED_FROM = {
  speakers: 'speakers are counted from Content → Speakers',
  sessions: 'sessions are counted from Content → Agenda',
  partners: 'partners are counted from Content → Sponsors',
  days: 'days are counted from the event’s dates'
};
function countedKind(label) {
  var s = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
  for (var i = 0; i < COUNTED.length; i++) if (COUNTED[i].re.test(s)) return COUNTED[i].kind;
  return '';
}

function isText(v) { return typeof v === 'string'; }
function plain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/* a list of short lines: null (never saved) or an array of text */
function checkList(name, v, chars) {
  if (v == null) return '';
  if (!Array.isArray(v)) return name + ' must be a list.';
  if (v.length > LIMITS.listItems) return name + ' can have up to ' + LIMITS.listItems + ' lines.';
  for (var i = 0; i < v.length; i++) {
    if (!isText(v[i])) return name + ' must be a list of text.';
    if (v[i].length > chars) return 'Line ' + (i + 1) + ' of ' + name.toLowerCase() + ' is too long (the limit is ' + chars + ' characters).';
  }
  return '';
}

function checkNumbers(v) {
  if (v == null) return '';
  if (!Array.isArray(v)) return 'Headline numbers must be a list.';
  if (v.length > LIMITS.numbers) return 'Headline numbers can have up to ' + LIMITS.numbers + ' numbers.';
  for (var i = 0; i < v.length; i++) {
    var n = v[i], at = 'Headline number ' + (i + 1);
    if (!plain(n) || !isText(n.value) || !isText(n.label)) return at + ' needs a number and what it counts.';
    var extra = Object.keys(n).filter(function (k) { return k !== 'value' && k !== 'label'; })[0];
    if (extra) return at + ': "' + extra.slice(0, 30) + '" is not accepted — it takes value and label.';
    var value = n.value.trim(), label = n.label.trim();
    if (!value || !label) return at + ' needs both a number and what it counts.';
    if (!/\d/.test(value)) return at + ': “' + value.slice(0, 20) + '” is not a number.';
    if (value.length > LIMITS.valueChars) return at + ': the number is too long (the limit is ' + LIMITS.valueChars + ' characters).';
    if (label.length > LIMITS.labelChars) return at + ': what it counts is too long (the limit is ' + LIMITS.labelChars + ' characters).';
    var kind = countedKind(label);
    if (kind) return at + ' (“' + label.slice(0, 40) + '”): ' + COUNTED_FROM[kind] + ', so it is not typed here.';
  }
  return '';
}

var check = {
  whoShouldAttend: function (v) { return checkList('Who should attend', v, LIMITS.audienceChars); },
  keyTopics: function (v) { return checkList('Key topics', v, LIMITS.topicChars); },
  headlineNumbers: checkNumbers
};

function oneLine(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

/* the stored pairs a post can show: both halves given, and never a counted kind (a value stored before the rule,
   or written some other way, still never stands beside the real count) */
function ownNumbers(list) {
  return (Array.isArray(list) ? list : []).map(function (n) {
    return plain(n) ? { value: oneLine(n.value, LIMITS.valueChars), label: oneLine(n.label, LIMITS.labelChars) } : null;
  }).filter(function (n) { return n && n.value && n.label && /\d/.test(n.value) && !countedKind(n.label); }).slice(0, LIMITS.numbers);
}

/* The exact numbers in the owner's "Expected scale" (owner-brief.js, "500+ CXOs, 20 countries, 3 days"): each
   part that is a number and what it counts, as the owner wrote it. "Over 500 delegates" is "500+"; a number the
   owner only guessed at ("around 500", "up to 40") is left out, as is anything the event's records count. */
var SCALE_PART = /^(?:(over|more than|above|at least)\s+)?(\d[\d,.]*(?:\s*(?:-|–|to)\s*\d[\d,.]*)?\s*(?:\+|k\+?|lakh\+?|crore\+?|cr\+?)?)\s+(?:of\s+)?([A-Za-z][A-Za-z0-9&'’\-\/ ]*[A-Za-z0-9])\.?$/i;
function numbersFromScale(text) {
  var out = [];
  /* parts are divided by ; | • a line, a comma that is not inside a number ("2,000"), and an "and" that starts the
     next number ("500 CIOs and 20 countries", never "500 CIOs and CTOs") */
  String(text == null ? '' : text).split(/\s*(?:[;\n•|]|,(?!\d)|\band\b(?=\s+(?:(?:over|more than|above|at least)\s+)?\d))\s*/i).forEach(function (part) {
    var m = SCALE_PART.exec(oneLine(part, 120));
    if (!m) return;
    var value = m[2].replace(/\s*(?:-|–|to)\s*(?=\d)/i, '–').replace(/\s+/g, ' ').trim();
    if (m[1] && !/\+$/.test(value)) value += '+';
    var label = m[3].trim();
    label = label.charAt(0).toUpperCase() + label.slice(1);
    if (value.length > LIMITS.valueChars || label.length > LIMITS.labelChars || countedKind(label)) return;
    out.push({ value: value, label: label });
  });
  return out.slice(0, LIMITS.numbers);
}

module.exports = { LIMITS: LIMITS, check: check, countedKind: countedKind, ownNumbers: ownNumbers, numbersFromScale: numbersFromScale };
