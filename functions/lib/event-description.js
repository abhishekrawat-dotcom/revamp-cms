/* The event's description (events/<id>.description): two or three sentences about THIS edition, written for
   the people who might attend. It is shown in the event console's Basics, the published pages' meta
   description and schema.org data, the promotions and the events listing — so it is never the owner's raw
   brief (the "Tagline / theme: …" headings Create Event asks for). The brief stays in events/<id>/briefs and
   steers the AI; the description is written from it, and from the previous edition, at design time
   (plan-structure, field eventDescription), or by tools/repair-description.js for an event made before.

     RULE                              the instruction the model is given for the description
     SCHEMA                            { eventDescription } — the answer format of a description-only call
     isRawBrief(current)               -> true when the stored description is the owner's brief (has its headings)
     replaceable(current, briefText)   -> true when the stored description may be written by the AI: empty,
                                          the owner's brief (it has the brief's headings), or the brief's text
                                          word for word. A description the owner wrote by hand is never replaced.
     clean(text)                       -> the model's description, tidied; '' when it is not usable (too short,
                                          a heading or a list in it)
     storedFacts(eventMeta)            -> the event's facts a brief step may store on the event: everything but
                                          the description
     patch(parsedDescription, stored, briefText) -> { description } | null   what plan-structure writes
     buildPrompt(o)                    -> the prompt of a description-only call (the repair tool):
                                          o = { event, brief, previous, previousSummary }
     ACTIVITY_DETAIL                   the activity log line
   No network, no Firebase: see event-description.test.js. */

var ownerBrief = require('./owner-brief');

var RULE = '2-3 sentences (at most 60 words) describing THIS edition for the people who might attend: what it is, who it is for and why to attend. Polished event-site prose, grounded ONLY in the owner\'s brief and the previous edition\'s real details (its name, theme, format, audience). Never invent numbers, dates, speakers or sponsors. Never list the brief\'s headings or copy its lists word for word — say what they add up to. No headings, no bullet lists, no line breaks.';

var SCHEMA = {
  type: 'OBJECT',
  properties: { eventDescription: { type: 'STRING', description: RULE } },
  required: ['eventDescription']
};

var ACTIVITY_DETAIL = 'Description written by AI from the brief and the previous edition';

function norm(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }

function hasHeadings(text) { return Object.keys(ownerBrief.fromText(text)).length > 0; }

/* a stored description that is the owner's brief: it carries the brief's headings */
function isRawBrief(current) { return !!norm(current) && hasHeadings(current); }

function replaceable(current, briefText) {
  var c = norm(current);
  if (!c) return true;
  if (hasHeadings(current)) return true;
  return !!(briefText && c === norm(briefText));
}

function clean(text) {
  var raw = String(text == null ? '' : text);
  if (hasHeadings(raw)) return '';
  if (/^\s*(?:[-*•]|\d+[.)])\s+/m.test(raw)) return '';          // a list, not prose
  var t = norm(raw);
  var q = /^["'“‘](.*)["'”’]$/.exec(t);
  if (q && !/["“”]/.test(q[1])) t = q[1].trim();
  if (t.length < 40) return '';
  if (t.length > 600) {
    /* cut at the last full stop that fits, never mid-word */
    var cut = t.slice(0, 600), at = cut.lastIndexOf('. ');
    t = at > 200 ? cut.slice(0, at + 1) : cut.replace(/\s+\S*$/, '') + '…';
  }
  return t;
}

function storedFacts(eventMeta) {
  var out = Object.assign({}, eventMeta || {});
  delete out.description;
  return out;
}

function patch(parsedDescription, stored, briefText) {
  var d = clean(parsedDescription);
  if (!d) return null;
  var current = (stored || {}).description;
  if (!replaceable(current, briefText)) return null;
  if (norm(current) === d) return null;
  return { description: d };
}

/* "21–24 May 2027" from the record's ISO start/end, or '' */
function dateText(start, end) {
  var M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function parse(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null; }
  var a = parse(start), b = parse(end);
  if (!a) return '';
  if (!b || (a.y === b.y && a.m === b.m && a.d === b.d)) return a.d + ' ' + M[a.m] + ' ' + a.y;
  if (a.y === b.y && a.m === b.m) return a.d + '–' + b.d + ' ' + M[a.m] + ' ' + a.y;
  return a.d + ' ' + M[a.m] + (a.y === b.y ? '' : ' ' + a.y) + ' – ' + b.d + ' ' + M[b.m] + ' ' + b.y;
}

function buildPrompt(o) {
  o = o || {};
  var ev = o.event || {}, brief = o.brief || {}, owner = brief.owner || {}, prev = o.previous || null;
  var lines = [
    'You write the short description of a business event for its website, its search listing and its promotions (ET Oneworld\'s event builder).',
    '',
    'THE EVENT:',
    'name: ' + norm(ev.name)
  ];
  var when = dateText(ev.start, ev.end);
  if (when) lines.push('dates: ' + when);
  var where = [ev.venue, ev.city].map(norm).filter(function (v, i, l) { return v && l.indexOf(v) === i; }).join(', ');
  if (where) lines.push('venue: ' + where);

  var ownerLines = [];
  [['tagline', 'tagline / theme'], ['usp', 'what sets it apart'], ['audience', 'audience'], ['industry', 'industries'],
    ['levelText', 'level'], ['formatText', 'format'], ['scale', 'expected scale'], ['mustAvoid', 'must avoid']].forEach(function (p) {
    if (norm(owner[p[0]])) ownerLines.push(p[1] + ': ' + norm(owner[p[0]]).slice(0, 500));
  });
  if (ownerLines.length) lines.push('', 'THE OWNER\'S BRIEF (directions — say what it adds up to, never copy its lists or headings):'), lines.push.apply(lines, ownerLines);
  if (norm(brief.theme)) lines.push('', 'The brief\'s theme, as read: ' + norm(brief.theme).slice(0, 500));
  var km = (Array.isArray(brief.keyMessages) ? brief.keyMessages : []).map(norm).filter(Boolean).slice(0, 5);
  if (km.length) lines.push('Its key messages: ' + km.join(' | '));

  if (prev || o.previousSummary) {
    lines.push('', 'THE PREVIOUS EDITION (what this event is, from its own last edition — not this edition\'s facts):');
    if (prev && norm(prev.name)) lines.push('name: ' + norm(prev.name));
    if (prev && norm(prev.venue)) lines.push('venue: ' + norm(prev.venue));
    var pw = prev ? dateText(prev.start, prev.end) : '';
    if (pw) lines.push('dates: ' + pw);
    (o.previousSummary || []).slice(0, 8).forEach(function (s) {
      var h = norm(s && s.heading), b = norm(s && s.body);
      if (h || b) lines.push('- ' + (h ? h + ': ' : '') + b.slice(0, 300));
    });
  }

  lines.push('', 'Task — eventDescription: ' + RULE,
    'Where the previous edition and the brief differ, the brief is right. The dates and venue above may be used; nothing else that is not given.');
  return lines.join('\n');
}

module.exports = { RULE, SCHEMA, ACTIVITY_DETAIL, isRawBrief, replaceable, clean, storedFacts, patch, buildPrompt, dateText };
