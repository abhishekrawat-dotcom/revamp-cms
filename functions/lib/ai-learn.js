/* ETB2B AI learns from what people ask it (owner decision 11, 8 Nov 2026): the RECORD of every AI turn, the
   approvers' report "What people ask ETB2B AI", and the QA notes taken while people work.

   The owner: "This AI should not act as only helping hand for a user. it should learn the frequent changes request
   to accomodate faster. doing this will help the AI to be a smart Product manager and QA." Learning here means a
   record of requests and outcomes that the product reads; no model is retrained, and nothing in this file asks a
   model anything, changes what a model is asked or answers, or holds up an answer: every write happens after the
   person has their answer, and a failure to write is logged and forgotten.

   THE RECORD (one entry per AI turn of every brain). Written by the SERVER where the turn is answered, never taken
   from a browser: lib/dash-bot.js (the dash brain, on every page), lib/api.js handleChatEdit (the site editor's
   brain), and later the Promotions editors' brain (B18-ai) through the same one function, recordTurn(fb, turn).
   An entry says who asked (uid, name), where (event, page, tab), the request in a normalised form (a short intent
   label from the brain's own structured output, never an extra AI call, and the person's words with e-mails,
   phones, links and every event's name and id stripped), what the AI did (the action's kind and target, never its
   words) and the outcome: answered, done, partly, undone (and how soon), stopped, refused (and which rule), could
   not do, failed, error. The outcome is the server's own when the turn is answered; what became of a change later
   comes from the page through the routes it already reports to (POST /api/dash-bot/turn, POST /api/chat/turn), and
   only for the reporter's own turn (recordOutcome).
   LOCKED TO THE EVENT (owner decision 10): an entry made inside an event names only that event. Every event's name
   and id in the person's words becomes "this event" (that one) or "another event" (any other); on a page with no
   event, "an event". So the record keeps the KIND of request, and nothing read from it inside one event can show
   another event's content.
   BOUNDED AND AGEING OUT. Each person has a ring of CAPS.ring entries per event (and one more ring for pages with
   no event): the newest entry takes the oldest one's place, so a runaway loop cannot grow the record. Every entry
   carries expireAt (CAPS.keepDays after it was made) for a Firestore TTL policy, the report never reads past
   CAPS.keepDays, and an approver's report sweeps older entries away. Never sent anywhere else.
   TESTS LEFT OUT: an entry on a qa- event, or made by the QA agent, is marked `test` and left out of the team's
   numbers (the report can show them on their own, for QA).

   THE REPORT (APPROVERS ONLY: functions/lib/access.js notAnApprover over config/approvals, the rule every
   approver-only action uses). GET /api/ai-report?range=week|month|custom&from=&to=&names=1&tests=1 answers this
   week, this month or a custom range (India days): top requests (by intent and page, with counts and three real
   examples), gaps (refused, could not do, failed: the product backlog), got it wrong (the undo rate by intent) and
   the QA notes, grouped and counted. People are "Person 1", "Person 2" unless names=1; e-mails and phones are
   always masked. Anybody else is refused with 403 { code: 'not-an-approver' }; the dashboard shows the link to
   approvers only (Event_Listing.html renderMoreMenu).

   QA NOTES. A note is kept when an AI change is undone (recordOutcome), when someone tells ETB2B AI something is
   not working (a fixed word match on their message, isComplaint: no AI), or when a page that carries the assistant
   has an error (POST /api/ai-qa/note from etb2b-assistant.js: a window error or an unhandled rejection, signed-in
   team only). Each note has the page, the event, what was asked, what the AI did, what happened, the error text,
   the browser and the window size. Notes are throttled per person and in all (noteGate: the same page error from
   the same person within ten minutes is dropped, and a person or the server that sends too many is told to stop;
   every undo and complaint is its own note, since each one is a real AI turn), grouped by what they are
   about (groupOf), counted in the report, and an approver can mark a group resolved (POST /api/ai-report/resolve);
   a note after that shows the group as back.

   STORAGE (Admin SDK; firestore.rules unchanged; only single-field queries, so no new index is needed):
     aiRecord/<person>~<event or _>~<slot>   an entry (entryOf); turnKey "<brain>:<turnId>" finds it for an outcome
     aiRecordHeads/<person>~<event or _>     { n, at }   how many entries that ring has had, so the next slot is n % ring
     aiQaNotes/<auto id>                     a QA note (noteOf)
     aiQaGroups/<group>                      { resolved, resolvedAt, resolvedBy }   only once an approver marks one

   lib/api.js routes the three report routes here and hands over its helpers (wire()), as for lib/dash-bot.js; the
   record itself needs nothing but Firestore, so another brain calls recordTurn(fb, turn) directly. Loading this
   file reads nothing, writes nothing and needs no environment. Node 20, CommonJS. */
'use strict';
var crypto = require('crypto');

var CAPS = {
  keepDays: 180,              // entries and notes older than this are not read, and are swept away
  ring: 400,                  // entries kept per person per event (and per person off any event)
  wordsChars: 300,            // the person's words, stripped
  intentWords: 5, intentChars: 48,
  ruleChars: 80,
  reportEntries: 5000,        // the most entries one report reads (newest first), so a report's cost is bounded
  reportNotes: 2000,
  examples: 3, groups: 25,
  noteWindowMs: 10 * 60 * 1000, notePerPerson: 12, noteAll: 400, noteDedupeMs: 10 * 60 * 1000,
  errorChars: 300, stackChars: 900, askedChars: 300,
  namesMs: 10 * 60 * 1000,    // how long the list of event names used for stripping is kept in this process
  /* a page's report can come before its turn's entry is written (the site editor applies a change about a second
     after the answer, while the first list of event names may still be read): the entry is looked for again after
     these waits, so "done" is never lost to that race when the report reaches another server process */
  outcomeRetryMs: [1500, 4000],
  sweepEveryMs: 60 * 60 * 1000, sweepBatch: 200
};
var DAY_MS = 86400000, IST_MS = 330 * 60000;
var RECORD = 'aiRecord', HEADS = 'aiRecordHeads', NOTES = 'aiQaNotes', GROUPS = 'aiQaGroups';
var BRAINS = { dash: 1, edit: 1, promo: 1 };
var OUTCOMES = ['answered', 'done', 'partly', 'undone', 'stopped', 'refused', 'could-not', 'failed', 'error', 'pending'];
var GAPS = { refused: 1, 'could-not': 1, failed: 1, error: 1 };
var CHANGES = { done: 1, partly: 1, undone: 1 };
var QA_AGENT_EMAIL = 'qa-agent@timesinternet.in', QA_AGENT_UID = 'qa-agent';
/* the pages that carry the assistant (etb2b-assistant.js PAGE_LABELS): a note names one of these or none */
var PAGES = ['dashboard', 'console', 'create-event', 'editor', 'promotions', 'review', 'activity-log', 'registrations',
  'mailer-performance', 'portal-review', 'ai-report'];
var EVENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
var TURN_ID_RE = /^[A-Za-z0-9]{10,40}$/;
var TAB_RE = /^[a-z][a-z0-9-]{0,30}(?:\/[a-z][a-z0-9-]{0,30})?$/;

var clock = { now: function () { return Date.now(); } };

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function str(v) { return v == null ? '' : String(v); }
function line(v, max) { return str(v).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 160); }
function uniq(list) { var out = []; list.forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); }); return out; }
function iso(ms) { return new Date(ms).toISOString(); }
function hash(s) { return crypto.createHash('sha1').update(str(s)).digest('hex').slice(0, 20); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
/* A write that fails says so in the log once every ten minutes per kind of failure, not on every turn: a store that is
   down, or a test's stand-in without one of its calls, must not flood the log. */
var warned = {};
function warn(key, msg) {
  var now = clock.now();
  if (warned[key] && now - warned[key] < 10 * 60 * 1000) return;
  warned[key] = now;
  console.error('ai-learn: ' + msg);
}

/* ================================================================ stripping the person's words */

var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
var URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'”’)]+/gi;
/* a run of digits with the spaces, dots, dashes and brackets phone numbers are written with */
var PHONE_RE = /\+?\(?\d[\d\s().-]{6,}\d/g;
/* A phone has 8 to 15 digits with at least one group of three or more; a date ("2026-11-08", "08.11.2026") and a row
   of years ("2025 2026") are not phones, so the words keep what the person asked about. */
function phoneLike(m) {
  var s = m.trim(), digits = s.replace(/\D/g, ''), groups = s.split(/\D+/).filter(Boolean);
  if (digits.length < 8 || digits.length > 15) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s)) return false;
  if (groups.every(function (g) { return /^(?:19|20)\d\d$/.test(g); })) return false;
  return groups.some(function (g) { return g.length >= 3; });
}
/* the ways people write an event's name: in full, without its year ("Autotech Summit" for "Autotech Summit 2026")
   and without a leading "ET" or "The". One word is used only when it is long enough not to be an ordinary word: six
   letters for an event whose whole name it is, eight for one left by taking the rest off ("Awards" of "ET Awards
   2026" stays a word people use; "Autotech" of "Autotech 2026" is that event). */
function nameVariants(name) {
  var full = line(name, 200);
  if (!full) return [];
  var noYear = full.replace(/[\s,'’-]*\b(?:19|20)\d{2}\b\s*$/, '').trim();
  var noLead = noYear.replace(/^(?:ET|The)\s+/i, '').trim();
  return uniq([full, noYear, noLead]).filter(function (v) { return v.split(/\s+/).length >= 2 || v.length >= (v === full ? 6 : 8); });
}
/* compiled once per list of names (the list changes when the cache does) */
var compiled = { key: '', items: [] };
function namePatterns(known) {
  var list = arr(known).filter(function (e) { return isObj(e) && typeof e.id === 'string' && EVENT_ID_RE.test(e.id); });
  var key = list.map(function (e) { return e.id + '=' + str(e.name); }).join('|');
  if (key === compiled.key) return compiled.items;
  var items = [];
  list.forEach(function (e) {
    nameVariants(e.name).forEach(function (v) {
      var body = v.split(/\s+/).map(escapeRe).join('\\s+');
      items.push({ id: e.id, len: v.length, first: v.split(/\s+/)[0].toLowerCase(), re: new RegExp('(^|[^\\p{L}\\p{N}])' + body + '(?=$|[^\\p{L}\\p{N}])', 'giu') });
    });
    /* an id is taken out where it is written as one (it has a dash or a digit: "autotech-summit-2026"); a one-word id
       such as "cio" is an ordinary word in a message, and that event is still found by its name */
    if (/[-0-9]/.test(e.id)) items.push({ id: e.id, len: e.id.length, first: e.id, re: new RegExp('(^|[^a-z0-9-])' + escapeRe(e.id) + '(?=$|[^a-z0-9-])', 'gi') });
  });
  /* the longest first, so a full name is taken before the shorter form inside it */
  items.sort(function (a, b) { return b.len - a.len; });
  compiled = { key: key, items: items };
  return items;
}
/* The person's words as the record keeps them (owner decision 11, rule 10): e-mails, phones and links out, and every
   event named by what it is to this entry: "this event" (the page's own), "another event", or "an event" on a page
   with no event. o: { known: [{ id, name }], hereId, max } */
function strip(text, o) {
  o = o || {};
  var s = line(text, 4000);
  if (!s) return '';
  s = s.replace(EMAIL_RE, '[email]').replace(URL_RE, '[link]');
  s = s.replace(PHONE_RE, function (m) { return phoneLike(m) ? '[phone]' : m; });
  var lower = s.toLowerCase(), hereId = str(o.hereId);
  namePatterns(o.known).forEach(function (p) {
    if (lower.indexOf(p.first) === -1) return;
    var say = p.id === hereId ? 'this event' : hereId ? 'another event' : 'an event';
    s = s.replace(p.re, function (m, before) { return before + say; });
    lower = s.toLowerCase();
  });
  return line(s, o.max || CAPS.wordsChars);
}
/* e-mails and phones masked again when a report reads an entry or a note: kept text from before a rule changed, or
   a name that is an address, never shows one */
function maskContact(text) {
  return str(text).replace(EMAIL_RE, function (m) { return m.charAt(0) + '***@' + m.split('@')[1]; })
    .replace(PHONE_RE, function (m) { return phoneLike(m) ? '[phone]' : m; });
}

/* ================================================================ the intent label */

var INTENT_STOP = { the: 1, a: 1, an: 1, of: 1, to: 1, my: 1, our: 1, your: 1, its: 1, their: 1, this: 1, that: 1, these: 1,
  those: 1, please: 1, in: 1, on: 1, at: 1, and: 1, or: 1, for: 1, with: 1, me: 1, us: 1, it: 1, is: 1, be: 1, can: 1, you: 1 };
/* The brain's own short label for the kind of request ("shorten title", "post per speaker", "swap banner"),
   cleaned so it can be counted: lower case, letters only (never a number, a date, an address or an event's name),
   at most five words. '' when nothing is left; the caller then uses what the brain did (factsOf*). */
function cleanIntent(raw, o) {
  var s = strip(raw, { known: o && o.known, hereId: o && o.hereId, max: 200 }).toLowerCase();
  /* what stripping put in is not part of the kind of request ("new event" and "send email" are) */
  s = s.replace(/\b(?:this|another|an)\s+event\b|\[(?:email|phone|link)\]/g, ' ');
  var words = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(function (w) { return w.length > 1 && !INTENT_STOP[w]; });
  return words.slice(0, CAPS.intentWords).join(' ').slice(0, CAPS.intentChars).trim();
}

/* ================================================================ what each brain did, and how it ended */

/* the dash brain's notes that mean it could not do what was asked (lib/dash-bot.js cleanAnswer) */
var DASH_COULD_NOT = ['not-found', 'unknown-event', 'unknown-template', 'unknown-kind', 'totals-unavailable', 'totals-timeout'];
/* -> { did: { kind, target }, outcome, rule, fallback } from an answer of lib/dash-bot.js (cleanAnswer's shape).
   The target is a page, a template id, the list or the filter's fields: never a label, which names events. */
function dashFacts(answer) {
  answer = isObj(answer) ? answer : {};
  var kind = str(answer.kind) || 'reply', a = isObj(answer.action) ? answer.action : null, target = '';
  var notes = arr(answer.notes).map(str);
  if (a && a.type === 'navigate') {
    var hash = /#([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)/.exec(str(a.url));
    var tpl = /[?&](?:template|post|mailer)=([a-z0-9.-]+)/.exec(str(a.url));
    target = str(a.target) + (tpl ? ':' + tpl[1] : hash ? ':' + hash[1] : '');
  } else if (a && a.type === 'filter') target = Object.keys(isObj(a.patch) ? a.patch : {}).sort().join(',');
  else if (a && a.type === 'refuse') target = str(a.what);
  else if (a && a.type) target = a.type === 'create' ? 'create-event' : str(a.type);
  else if (answer.list) target = 'list';
  var outcome = 'answered', rule = '';
  if (kind === 'refuse') { outcome = 'refused'; rule = a ? str(a.what) : 'other'; }
  else if (kind === 'create' || kind === 'open' || kind === 'filter' || kind === 'promo' || kind === 'portal' || kind === 'undo') outcome = 'done';
  else {
    var cannot = notes.filter(function (n) { return DASH_COULD_NOT.indexOf(n) !== -1; })[0];
    if (cannot) { outcome = 'could-not'; rule = cannot; }
  }
  var fallback = kind === 'reply' ? (answer.list ? 'list events' : 'question') : kind === 'open' ? 'open ' + str(a && a.target) :
    kind === 'promo' ? 'open promotions' : kind === 'create' ? 'new event' : kind === 'filter' ? 'filter list' : kind === 'portal' ? 'switch portal' :
    kind === 'refuse' ? 'refused ' + rule.replace(/-/g, ' ') : kind;
  return { did: { kind: kind, target: line(target, 80) }, outcome: outcome, rule: line(rule, CAPS.ruleChars), fallback: fallback };
}
var EDIT_PARTS = [['design', 'design'], ['textEdits', 'text'], ['sectionEdits', 'rework'], ['sectionOps', 'sections'],
  ['newSections', 'new-section'], ['newForms', 'form'], ['ctaLinks', 'button-link'], ['formEmbeds', 'form-embed']];
/* -> the same from an answer of the site editor's brain (lib/api.js handleChatEdit). o.pictureRefused: the answer
   is the server's sentence for a picture it would not make. */
function editFacts(answer, o) {
  answer = isObj(answer) ? answer : {};
  o = o || {};
  var kind = str(answer.kind) || 'reply', parts = [];
  EDIT_PARTS.forEach(function (p) {
    var v = answer[p[0]];
    if ((Array.isArray(v) && v.length) || (isObj(v) && Object.keys(v).length)) parts.push(p[1]);
  });
  if (answer.newPicture) parts.push('new-picture');
  var outcome = kind === 'edit' ? 'pending' : kind === 'undo' ? 'done' : 'answered', rule = '';
  if (kind === 'reply' && o.pictureRefused) { outcome = 'refused'; rule = 'picture'; }
  else if (kind === 'reply' && answer.goTo) { outcome = 'could-not'; rule = 'sent to ' + str(answer.goTo); }
  var fallback = kind === 'edit' ? 'change ' + (parts[0] || 'page').replace(/-/g, ' ') : kind === 'undo' ? 'undo change' : 'question';
  return { did: { kind: kind, target: parts.join(',') || (answer.goTo ? 'go:' + answer.goTo : '') }, outcome: outcome, rule: rule, fallback: fallback };
}
/* What a page's report of a turn means for the record. The dash brain (and any later brain) reports done, undone,
   failed, stopped; the site editor applied, partly, failed, undone, stopped. A dash action that the page itself
   refused because it was for another event (dash-bot-client.js, owner decision 10) is a refusal, not a failure. */
function outcomeOf(brain, status, note) {
  status = str(status);
  if (brain === 'edit') return { applied: 'done', partly: 'partly', failed: 'failed', undone: 'undone', stopped: 'stopped' }[status] || '';
  if (status === 'failed' && /another event/i.test(str(note))) return 'refused';
  return { done: 'done', undone: 'undone', failed: 'failed', stopped: 'stopped' }[status] || '';
}

/* ================================================================ who, where, which browser */

function personKey(uid) {
  var key = str(uid).replace(/[^A-Za-z0-9_@.-]/g, '_').slice(0, 120);
  if (/^\.+$/.test(key) || /^__.*__$/.test(key)) key = 'u' + key;
  return key || 'anon';
}
function uidOf(decoded) { return str((decoded && (decoded.uid || decoded.email)) || 'anon'); }
/* the person's name as the report may show it once an approver asks for names: never an e-mail address */
function nameOf(decoded) {
  var n = line(decoded && (decoded.name || decoded.email), 120) || 'Someone';
  return maskContact(n);
}
function isTestOf(eventId, decoded) {
  var email = str(decoded && decoded.email).toLowerCase();
  return /^qa-/.test(str(eventId)) || email === QA_AGENT_EMAIL || str(decoded && decoded.uid) === QA_AGENT_UID;
}
/* "Chrome 131 · macOS": enough to reproduce a page error, never the full string */
function browserOf(ua) {
  ua = str(ua);
  if (!ua) return '';
  var b = /Edg\/(\d+)/.exec(ua) ? 'Edge ' + /Edg\/(\d+)/.exec(ua)[1] : /OPR\/(\d+)/.exec(ua) ? 'Opera ' + /OPR\/(\d+)/.exec(ua)[1] :
    /Firefox\/(\d+)/.exec(ua) ? 'Firefox ' + /Firefox\/(\d+)/.exec(ua)[1] : /Chrome\/(\d+)/.exec(ua) ? 'Chrome ' + /Chrome\/(\d+)/.exec(ua)[1] :
    /Version\/(\d+)[.\d]* .*Safari\//.exec(ua) ? 'Safari ' + /Version\/(\d+)/.exec(ua)[1] : 'Other browser';
  var os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? b + ' · ' + os : b;
}
/* the window's size as the page sent it, "1440x900"; anything else is left out */
function cleanScreen(v) {
  var m = /^(\d{2,5})x(\d{2,5})$/.exec(str(v).trim());
  return m && +m[1] <= 20000 && +m[2] <= 20000 ? m[1] + 'x' + m[2] : '';
}
function cleanPage(v) { return PAGES.indexOf(str(v)) !== -1 ? str(v) : ''; }
function cleanTab(v) { var t = str(v).trim().toLowerCase(); return TAB_RE.test(t) ? t : ''; }
function cleanEventId(v) { var id = str(v).trim(); return EVENT_ID_RE.test(id) ? id : ''; }

/* ================================================================ the record */

/* "not working", "broken", "error", "bug", "wrong" (the owner's words) and the ways people say them. A fixed match,
   so whether a message is a complaint never depends on a model. It must not catch ordinary requests, or every one
   of them becomes a false "Said it was not working" note:
   - no "break", "breaks" or "breaking": agenda breaks (coffee, lunch, networking) and titles like "Breaking
     barriers" are among the most common requests here; "broken" and "broke" stay.
   - "do not" / "don't" only with work or load ("the buttons don't work"): with show, open or save it is an
     instruction ("Do not show the venue", "Don't open the speakers page").
   - a bare "not" only in the -ing forms ("not working", "not loading", "not showing"), so "please do not show ..."
     is not caught by "not show".
   - a "what happens if ..." / "what if ..." / "in case ..." clause is a question about what the site does
     ("What happens if a payment fails?"), so it is left out before matching; the rest of the message still counts. */
var COMPLAINT_RE = /\b(?:(?:does\s*n[o'’]?t|is\s*n[o'’]?t|are\s*n[o'’]?t|won[’']?t|wont|will\s+not)\s+(?:work|working|load|loading|open|opening|save|saving|show|showing)|do\s*n[o'’]?t\s+(?:work|load)|not\s+(?:working|loading|opening|saving|showing)|broken|broke|errors?|bugs?|buggy|wrong|fail(?:s|ed|ing)?|crash(?:es|ed|ing)?|stuck|glitch(?:es|y)?)\b/i;
var HYPOTHETICAL_RE = /\b(?:what\s+(?:happens|would\s+happen|will\s+happen|should\s+happen)\s+(?:if|when)|what\s+if|in\s+case)\b[^.?!\n]*/gi;
function isComplaint(text) { return COMPLAINT_RE.test(str(text).replace(HYPOTHETICAL_RE, ' ')); }

/* The entry kept for one turn (pure: tested as it is). t: the turn as recordTurn takes it. */
function entryOf(t, nowMs) {
  t = isObj(t) ? t : {};
  var decoded = isObj(t.decoded) ? t.decoded : {};
  var brain = BRAINS[t.brain] ? t.brain : 'dash';
  var eventId = cleanEventId(t.eventId), uid = uidOf(decoded);
  var o = { known: t.known, hereId: eventId };
  var outcome = OUTCOMES.indexOf(t.outcome) !== -1 ? t.outcome : 'answered';
  var did = isObj(t.did) ? t.did : {};
  var intent = cleanIntent(t.intent, o) || cleanIntent(t.fallback, o) || 'other';
  var turnId = TURN_ID_RE.test(str(t.turnId)) ? str(t.turnId) : '';
  var entry = {
    brain: brain, uid: uid, name: nameOf(decoded), test: isTestOf(eventId, decoded),
    eventId: eventId, eventName: eventId ? line(t.eventName, 120) : '', page: cleanPage(t.page), tab: cleanTab(t.tab),
    intent: intent, words: strip(t.words, o),
    did: { kind: line(did.kind, 24), target: line(did.target, 80) },
    outcome: outcome, rule: line(t.rule, CAPS.ruleChars),
    turnKey: turnId ? brain + ':' + turnId : '', handedFrom: BRAINS[t.handedFrom] ? t.handedFrom : '',
    complaint: isComplaint(t.words),
    at: iso(nowMs), updatedAt: iso(nowMs), expireAt: new Date(nowMs + CAPS.keepDays * DAY_MS)
  };
  return entry;
}
function ringKeyOf(entry) { return personKey(entry.uid) + '~' + (entry.eventId || '_'); }
/* The entry takes the next slot of the person's ring for its event: the oldest is replaced once the ring is full. */
function writeEntry(fb, entry) {
  var db = fb.db, key = ringKeyOf(entry), headRef = db.collection(HEADS).doc(key);
  return db.runTransaction(function (tx) {
    return tx.get(headRef).then(function (snap) {
      var n = snap.exists ? Math.max(0, Math.floor(Number((snap.data() || {}).n) || 0)) : 0;
      var ref = db.collection(RECORD).doc(key + '~' + (n % CAPS.ring));
      tx.set(headRef, { n: n + 1, at: entry.at });
      tx.set(ref, entry);
      return ref.id;
    });
  });
}

/* The names and ids of every event, for stripping the words of a brain that has no list of its own (the site
   editor's): one small read, kept for ten minutes in this process, and read only after the answer has gone. */
var namesCache = { at: 0, list: null, pending: null };
function knownEvents(fb) {
  var now = clock.now();
  if (namesCache.list && now - namesCache.at < CAPS.namesMs) return Promise.resolve(namesCache.list);
  if (namesCache.pending) return namesCache.pending;
  var p;
  try {
    p = fb.db.collection('events').select('name').get().then(function (snap) {
      var list = snap.docs.map(function (d) { return { id: d.id, name: str((d.data() || {}).name) }; });
      namesCache = { at: clock.now(), list: list, pending: null };
      return list;
    });
  } catch (e) { p = Promise.reject(e); }
  namesCache.pending = p.then(null, function (err) {
    namesCache.pending = null;
    warn('names', 'the event names could not be read for stripping — ' + (err && err.message));
    return namesCache.list || [];
  });
  return namesCache.pending;
}

/* THE ONE FUNCTION a brain calls for each AI turn it answered (after the answer has been sent):
     recordTurn(fb, { brain: 'dash'|'edit'|'promo', decoded, eventId, eventName, page, tab, intent, fallback, words,
                      did: { kind, target }, outcome, rule, turnId, known?: [{ id, name }], handedFrom?,
                      ua?, screen? })
   known: every event the person can see, when the brain has read them (the dash brain); without it the names are
   read here (knownEvents). A message that says something is not working also becomes a QA note.
   -> Promise<entry|null>, which never rejects. */
/* the entries this process is writing, by turn key, so a report of what became of that turn waits for its entry
   instead of missing it (recordOutcome); each one is let go as soon as its write ends, so this never grows */
var writing = {};
function recordTurn(fb, t) {
  if (!fb || !fb.db || !isObj(t)) return Promise.resolve(null);
  var nowMs = clock.now();
  var key = BRAINS[t.brain] && TURN_ID_RE.test(str(t.turnId)) ? t.brain + ':' + t.turnId : '';
  var known = Array.isArray(t.known) ? Promise.resolve(t.known) : knownEvents(fb);
  var done = known.then(function (list) {
    var entry = entryOf(Object.assign({}, t, { known: list }), nowMs);
    return writeEntry(fb, entry).then(function () {
      if (!entry.complaint) return entry;
      return writeNote(fb, noteOf('complaint', {
        decoded: t.decoded, brain: entry.brain, eventId: entry.eventId, eventName: entry.eventName, page: entry.page, tab: entry.tab,
        intent: entry.intent, asked: entry.words, did: entry.did, happened: entry.outcome + (entry.rule ? ' (' + entry.rule + ')' : ''),
        ua: t.ua, screen: t.screen
      }, nowMs)).then(function () { return entry; });
    });
  }).then(null, function (err) {
    warn('turn', 'a turn was not recorded — ' + (err && err.message));
    return null;
  });
  if (!key) return done;
  writing[key] = done;
  return done.then(function (entry) { if (writing[key] === done) delete writing[key]; return entry; });
}

/* What became of a turn, from the page's own report (the routes have already checked the turn is the reporter's):
     recordOutcome(fb, { brain, turnId, status, decoded, note?, notDone?: [..], ua?, screen? })
   An undone change is kept with how soon it was undone, and becomes a QA note. -> Promise, never rejects. */
function recordOutcome(fb, o) {
  if (!fb || !fb.db || !isObj(o)) return Promise.resolve(null);
  var brain = BRAINS[o.brain] ? o.brain : '', turnId = str(o.turnId);
  var outcome = outcomeOf(brain, o.status, o.note);
  if (!brain || !TURN_ID_RE.test(turnId) || !outcome) return Promise.resolve(null);
  /* nowMs: when the report came, so "how soon" is the person's, never the time spent waiting for the entry */
  var uid = uidOf(o.decoded), key = brain + ':' + turnId, nowMs = clock.now();
  function find(waits) {
    return fb.db.collection(RECORD).where('turnKey', '==', key).limit(1).get().then(function (snap) {
      var doc = snap && snap.docs && snap.docs[0];
      if (doc || !waits.length) return doc || null;
      return new Promise(function (resolve) { setTimeout(resolve, waits[0]); }).then(function () { return find(waits.slice(1)); });
    });
  }
  /* this process's own write of the entry first, when it is still going; then the store, looked at again a little
     later when the entry is not there yet (another process is writing it) */
  return Promise.resolve(writing[key]).then(function () { return find(arr(CAPS.outcomeRetryMs).slice()); }).then(function (doc) {
    if (!doc) return null;
    /* read and changed in one transaction: an "applied" and an "undone" sent a moment apart never leave the entry
       "done" because the earlier one was written last */
    var e = null, patch = null;
    return fb.db.runTransaction(function (tx) {
      return tx.get(doc.ref).then(function (now) {
        e = now.exists ? (now.data() || {}) : null;
        patch = null;
        /* only the person's own entry, and a change once undone is not "done" again by a late report */
        if (!e || e.uid !== uid || (e.outcome === 'undone' && outcome === 'done')) return;
        patch = { outcome: outcome, updatedAt: iso(nowMs) };
        var why = outcome === 'refused' ? 'other-event' : line(o.note || arr(o.notDone)[0], CAPS.ruleChars);
        if ((outcome === 'failed' || outcome === 'refused') && why) patch.rule = strip(why, { hereId: e.eventId, max: CAPS.ruleChars });
        var at = Date.parse(e.at);
        if (outcome === 'undone' && !isNaN(at)) patch.undoneAfterSec = Math.max(0, Math.round((nowMs - at) / 1000));
        tx.update(doc.ref, patch);
      });
    }).then(function () {
      if (!patch || outcome !== 'undone' || e.outcome === 'undone') return null;
      return writeNote(fb, noteOf('undo', {
        decoded: o.decoded, brain: e.brain, eventId: e.eventId, eventName: e.eventName, page: e.page, tab: e.tab, intent: e.intent,
        asked: e.words, did: e.did, happened: 'undone after ' + (patch.undoneAfterSec != null ? patch.undoneAfterSec + ' s' : 'a while'),
        ua: o.ua, screen: o.screen
      }, nowMs));
    });
  }).then(null, function (err) {
    warn('outcome', 'an outcome was not recorded — ' + (err && err.message));
    return null;
  });
}

/* ================================================================ QA notes */

/* an error's words, the same for every occurrence of one fault: links reduced to their path, numbers and long ids to #
   (a line number, a request id, a count), so "Failed to load event 3f9a…" from two people is one group */
function normError(s) {
  return line(str(s).replace(URL_RE, function (u) { try { return new URL(/^www\./i.test(u) ? 'https://' + u : u).pathname; } catch (e) { return '[link]'; } })
    .replace(EMAIL_RE, '[email]').replace(/\b[0-9a-f]{8,}\b/gi, '#').replace(/\d+/g, '#'), 160);
}
/* a script's place in a page, "edit-event.js:120:9": its path only, never the host or the address's query */
function whereOf(source, lineNo, col) {
  var path = '';
  try { path = source ? new URL(str(source), 'https://x.invalid').pathname : ''; } catch (e) { path = ''; }
  path = path.replace(/^\/+/, '').slice(-120);
  if (!path) return '';
  var l = parseInt(lineNo, 10), c = parseInt(col, 10);
  return path + (l > 0 ? ':' + l + (c > 0 ? ':' + c : '') : '');
}
function cleanStack(s) {
  return str(s).split('\n').slice(0, 6).map(function (l) {
    return l.replace(URL_RE, function (u) { try { return new URL(u).pathname; } catch (e) { return '[link]'; } }).replace(EMAIL_RE, '[email]').trim();
  }).filter(Boolean).join('\n').slice(0, CAPS.stackChars);
}
/* which group a note belongs to: one fault on one page (an error), or one kind of request undone or complained
   about on one page */
function groupOf(note) {
  var key = note.kind === 'page-error' ? ['page-error', note.page, normError(note.error), str(note.where).replace(/:\d+(?::\d+)?$/, '')].join('|')
    : [note.kind, note.page, note.intent].join('|');
  return hash(key);
}
function titleOf(note) {
  if (note.kind === 'page-error') return normError(note.error) || 'A page error';
  if (note.kind === 'undo') return 'Undone: “' + (note.intent || 'a change') + '”';
  return 'Said it was not working: “' + (note.intent || 'a request') + '”';
}
/* A note (pure). kind: 'undo' | 'complaint' | 'page-error'. f: { decoded, brain, eventId, eventName, page, tab,
   intent, asked, did, happened, error, where, stack, ua, screen } */
function noteOf(kind, f, nowMs) {
  f = isObj(f) ? f : {};
  var eventId = cleanEventId(f.eventId);
  var did = isObj(f.did) ? f.did : { kind: line(f.did, 24), target: '' };
  var note = {
    kind: kind === 'undo' || kind === 'complaint' ? kind : 'page-error',
    page: cleanPage(f.page), tab: cleanTab(f.tab), eventId: eventId, eventName: eventId ? line(f.eventName, 120) : '',
    brain: BRAINS[f.brain] ? f.brain : '', intent: line(f.intent, CAPS.intentChars),
    asked: strip(f.asked, { hereId: eventId, max: CAPS.askedChars, known: f.known }),
    did: { kind: line(did.kind, 24), target: line(did.target, 80) }, happened: line(f.happened, 120),
    error: kind === 'page-error' ? line(maskContact(str(f.error).replace(URL_RE, '[link]')), CAPS.errorChars) : '',
    where: line(f.where, 160), stack: kind === 'page-error' ? cleanStack(f.stack) : '',
    browser: browserOf(f.ua), screen: cleanScreen(f.screen),
    uid: uidOf(f.decoded), name: nameOf(f.decoded), test: isTestOf(eventId, f.decoded),
    at: iso(nowMs), expireAt: new Date(nowMs + CAPS.keepDays * DAY_MS)
  };
  note.group = groupOf(note);
  note.title = titleOf(note);
  return note;
}
function writeNote(fb, note) {
  /* an undo or a complaint is never a duplicate: each one followed a real AI turn (which has its own limits), and
     the same kind undone twice is two times ETB2B AI got it wrong. Only a page error can repeat in a loop. */
  if (noteGate(note.uid, note.kind === 'page-error' ? note.group : '', Date.parse(note.at))) return Promise.resolve(null);
  return fb.db.collection(NOTES).add(note).then(null, function (err) {
    warn('note', 'a QA note was not kept — ' + (err && err.message));
    return null;
  });
}

/* The throttle every note goes through, in this process: the same note (group) from the same person within ten
   minutes is dropped ('duplicate'; a group of '' is never one), a person may leave CAPS.notePerPerson notes in ten
   minutes ('rate') and everyone together CAPS.noteAll ('busy'). '' lets it through. It never grows without bound. */
var gate = { mine: {}, all: [], seen: {}, seenCount: 0 };
function noteGate(uid, group, nowMs) {
  var now = typeof nowMs === 'number' && !isNaN(nowMs) ? nowMs : clock.now(), w = CAPS.noteWindowMs;
  var key = group ? uid + '|' + group : '';
  if (key && gate.seen[key] && now - gate.seen[key] < CAPS.noteDedupeMs) return 'duplicate';
  var mine = (gate.mine[uid] || []).filter(function (t) { return now - t < w; });
  if (mine.length >= CAPS.notePerPerson) { gate.mine[uid] = mine; return 'rate'; }
  gate.all = gate.all.filter(function (t) { return now - t < w; });
  if (gate.all.length >= CAPS.noteAll) return 'busy';
  mine.push(now);
  gate.mine[uid] = mine;
  gate.all.push(now);
  if (gate.seenCount > 5000) {
    Object.keys(gate.seen).forEach(function (k) { if (now - gate.seen[k] >= CAPS.noteDedupeMs) delete gate.seen[k]; });
    Object.keys(gate.mine).forEach(function (k) { if (!gate.mine[k].some(function (t) { return now - t < w; })) delete gate.mine[k]; });
    gate.seenCount = Object.keys(gate.seen).length;
  }
  if (!key) return '';
  if (!gate.seen[key]) gate.seenCount++;
  gate.seen[key] = now;
  return '';
}
function resetGate() { gate = { mine: {}, all: [], seen: {}, seenCount: 0 }; }

/* ================================================================ the report */

function dayKeyOf(ms) { return new Date(ms + IST_MS).toISOString().slice(0, 10); }
function istStart(day) { return Date.parse(day + 'T00:00:00+05:30'); }
var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/* The days a report covers, in India time: this week (from Monday), this month (from the 1st), or a custom range of
   whole days; never before what the record still keeps (CAPS.keepDays), never after today.
   -> { range, from, to (ISO, to exclusive), fromDay, toDay } or { error } */
function rangeOf(q, nowMs) {
  q = q || {};
  var today = dayKeyOf(nowMs), oldest = dayKeyOf(nowMs - (CAPS.keepDays - 1) * DAY_MS);
  var range = q.range === 'month' || q.range === 'custom' ? q.range : 'week', fromDay, toDay = today;
  if (range === 'week') {
    /* India's date read with the UTC methods: its midnight plus India's offset */
    var wd = new Date(istStart(today) + IST_MS).getUTCDay();
    fromDay = dayKeyOf(istStart(today) - ((wd + 6) % 7) * DAY_MS);
  } else if (range === 'month') fromDay = today.slice(0, 8) + '01';
  else {
    fromDay = str(q.from); toDay = str(q.to) || today;
    if (!DAY_RE.test(fromDay) || !DAY_RE.test(toDay) || isNaN(istStart(fromDay)) || isNaN(istStart(toDay))) return { error: 'Pick a start and an end day.' };
    if (fromDay > toDay) return { error: 'The start day is after the end day.' };
    if (toDay > today) toDay = today;
  }
  if (fromDay < oldest) fromDay = oldest;
  if (fromDay > toDay) fromDay = toDay;
  return { range: range, fromDay: fromDay, toDay: toDay, from: iso(istStart(fromDay)), to: iso(istStart(toDay) + DAY_MS) };
}

var OUTCOME_WORDS = { answered: 'Answered', done: 'Done', partly: 'Partly done', undone: 'Undone', stopped: 'Stopped', refused: 'Refused',
  'could-not': 'Could not do', failed: 'Failed', error: 'Error', pending: 'Result not reported' };
/* the rules a refusal or a gap names, in the words an approver reads */
var RULE_WORDS = {
  delete: 'deleting an event', cancel: 'cancelling an event', publish: 'publishing', unpublish: 'taking a site offline', approve: 'approving',
  restore: 'restoring an event', send: 'sending mail', pay: 'payment', 'edit-site': 'changing the site from outside the editor',
  'set-portal': 'changing an event\'s portal', 'other-event': 'another event (locked to the event)', other: 'something it may not do',
  picture: 'a picture it would not make', 'not-found': 'an event it could not find', 'unknown-event': 'an event it could not find',
  'unknown-template': 'a template it does not have', 'unknown-kind': 'an answer it could not use', 'totals-unavailable': 'numbers it could not read',
  'totals-timeout': 'numbers that took too long', 'ai-unavailable': 'the AI did not answer', 'ai-bad-output': 'the AI\'s answer could not be used',
  'ai-timeout': 'the AI took too long'
};
function ruleWords(rule) {
  var r = str(rule);
  if (RULE_WORDS[r]) return RULE_WORDS[r];
  if (/^sent to /.test(r)) return 'sent to ' + r.slice(8).replace(/^content:/, 'Content › ').replace(/^forms$/, 'the Forms panel');
  return r;
}
var PAGE_WORDS = { dashboard: 'Dashboard', console: 'Console', 'create-event': 'Create Event', editor: 'Site editor', promotions: 'Promotions',
  review: 'Review', 'activity-log': 'Activity log', registrations: 'Registrations', 'mailer-performance': 'Mailer performance',
  'portal-review': 'Portal review', 'ai-report': 'This report', '': 'A page' };

/* who an example shows: "Person 1", "Person 2" in the order they first appear, unless names were asked for */
function whoFor(people, names) {
  return function (uid, name) {
    if (names) return maskContact(name || 'Someone');
    if (!people[uid]) people[uid] = 'Person ' + (Object.keys(people).length + 1);
    return people[uid];
  };
}
function exampleOf(x, who) {
  var out = { words: maskContact(x.words), who: who(x.uid, x.name), at: x.at, page: x.page, outcome: x.outcome };
  if (x.eventId) out.event = { id: x.eventId, name: x.eventName || '' };
  if (x.rule) out.rule = ruleWords(x.rule);
  if (x.undoneAfterSec != null) out.undoneAfterSec = x.undoneAfterSec;
  return out;
}
/* the newest examples first, one per distinct wording */
function examplesOf(list, who) {
  var seen = {}, out = [];
  list.slice().sort(function (a, b) { return str(b.at).localeCompare(str(a.at)); }).forEach(function (x) {
    var k = str(x.words).toLowerCase();
    if (out.length >= CAPS.examples || seen[k]) return;
    seen[k] = true;
    out.push(exampleOf(x, who));
  });
  return out;
}
function groupBy(list, keyOf) {
  var map = {}, order = [];
  list.forEach(function (x) { var k = keyOf(x); if (!map[k]) { map[k] = []; order.push(k); } map[k].push(x); });
  return order.map(function (k) { return { key: k, items: map[k] }; });
}
function countPeople(items) { return uniq(items.map(function (x) { return x.uid; })).length; }

/* The report from the entries and notes of the range (pure: tested as it is).
   o: { names, tests, groups: { <group>: { resolved, resolvedAt, resolvedBy } }, range, capped } */
function buildReport(entries, notes, o) {
  o = o || {};
  var people = {}, who = whoFor(people, !!o.names);
  var all = arr(entries).filter(isObj), tests = all.filter(function (e) { return e.test; });
  var list = o.tests ? all : all.filter(function (e) { return !e.test; });
  var allNotes = arr(notes).filter(isObj), qaList = o.tests ? allNotes : allNotes.filter(function (n) { return !n.test; });

  var top = groupBy(list, function (e) { return e.intent + '|' + e.page; }).map(function (g) {
    var x = g.items[0];
    return { intent: x.intent, page: x.page, pageName: PAGE_WORDS[x.page] || x.page, count: g.items.length, people: countPeople(g.items),
      done: g.items.filter(function (e) { return CHANGES[e.outcome] && e.outcome !== 'undone'; }).length,
      examples: examplesOf(g.items, who) };
  }).sort(function (a, b) { return b.count - a.count || a.intent.localeCompare(b.intent); }).slice(0, CAPS.groups);

  var gaps = groupBy(list.filter(function (e) { return GAPS[e.outcome]; }), function (e) { return e.outcome + '|' + e.rule + '|' + e.intent; }).map(function (g) {
    var x = g.items[0];
    return { outcome: x.outcome, outcomeName: OUTCOME_WORDS[x.outcome], rule: x.rule, ruleName: ruleWords(x.rule), intent: x.intent,
      pages: uniq(g.items.map(function (e) { return PAGE_WORDS[e.page] || e.page; })), count: g.items.length, people: countPeople(g.items),
      examples: examplesOf(g.items, who) };
  }).sort(function (a, b) { return b.count - a.count; }).slice(0, CAPS.groups);

  var wrong = groupBy(list.filter(function (e) { return CHANGES[e.outcome]; }), function (e) { return e.intent; }).map(function (g) {
    var undone = g.items.filter(function (e) { return e.outcome === 'undone'; });
    var secs = undone.map(function (e) { return e.undoneAfterSec; }).filter(function (s) { return typeof s === 'number'; });
    return { intent: g.items[0].intent, changes: g.items.length, undone: undone.length, rate: Math.round(undone.length / g.items.length * 100),
      medianUndoSec: secs.length ? secs.sort(function (a, b) { return a - b; })[Math.floor(secs.length / 2)] : null,
      examples: examplesOf(undone, who) };
  }).filter(function (w) { return w.undone > 0; })
    .sort(function (a, b) { return b.undone - a.undone || b.rate - a.rate; }).slice(0, CAPS.groups);

  var groupsState = isObj(o.groups) ? o.groups : {};
  var qa = groupBy(qaList, function (n) { return n.group; }).map(function (g) {
    var x = g.items[0], st = isObj(groupsState[g.key]) ? groupsState[g.key] : {};
    var sorted = g.items.slice().sort(function (a, b) { return str(b.at).localeCompare(str(a.at)); });
    var resolvedAt = st.resolved ? str(st.resolvedAt) : '';
    var after = resolvedAt ? g.items.filter(function (n) { return str(n.at) > resolvedAt; }).length : 0;
    return { group: g.key, kind: x.kind, title: maskContact(x.title), page: x.page, pageName: PAGE_WORDS[x.page] || x.page, count: g.items.length,
      people: countPeople(g.items), firstAt: sorted[sorted.length - 1].at, lastAt: sorted[0].at,
      status: !resolvedAt ? 'open' : after ? 'back' : 'resolved', resolvedAt: resolvedAt, sinceResolved: after,
      resolvedBy: resolvedAt ? (o.names ? maskContact(st.resolvedBy) : 'an approver') : '',
      examples: sorted.slice(0, CAPS.examples).map(function (n) {
        var ex = { asked: maskContact(n.asked), did: n.did && n.did.kind ? n.did.kind + (n.did.target ? ' · ' + n.did.target : '') : '',
          happened: n.happened, error: maskContact(n.error), where: n.where, browser: n.browser, screen: n.screen, page: n.page, tab: n.tab,
          at: n.at, who: who(n.uid, n.name) };
        if (n.eventId) ex.event = { id: n.eventId, name: n.eventName || '' };
        if (n.stack) ex.stack = maskContact(n.stack);
        return ex;
      }) };
  }).sort(function (a, b) { return (a.status === 'resolved') - (b.status === 'resolved') || b.count - a.count; }).slice(0, CAPS.groups);

  var changes = list.filter(function (e) { return CHANGES[e.outcome]; }).length, undone = list.filter(function (e) { return e.outcome === 'undone'; }).length;
  return {
    range: o.range || null, names: !!o.names, tests: !!o.tests, capped: !!o.capped,
    totals: { turns: list.length, people: countPeople(list), events: uniq(list.map(function (e) { return e.eventId; }).filter(Boolean)).length,
      changes: changes, undone: undone, undoRate: changes ? Math.round(undone / changes * 100) : 0,
      gaps: list.filter(function (e) { return GAPS[e.outcome]; }).length, qaNotes: qaList.length },
    leftOut: o.tests ? 0 : tests.length + (allNotes.length - qaList.length),
    top: top, gaps: gaps, wrong: wrong, qa: qa
  };
}

/* ================================================================ routes (wired by lib/api.js) */

var H = null;
var NEEDS = ['withAdmin', 'withAdminBody', 'sendJson', 'sendFailure', 'approvalsConfig', 'BODY_LIMITS'];
function wire(helpers) {
  var missing = NEEDS.filter(function (k) { return !helpers || helpers[k] == null; });
  if (missing.length) throw new Error('lib/ai-learn.js needs ' + missing.join(', ') + ' from lib/api.js');
  H = helpers;
}
function wired(res) {
  if (H) return true;
  res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'This part of the service is not available right now. Please try again shortly.', code: 'module-unavailable' }));
  return false;
}
/* '' when this person may read the report and mark notes resolved: an approver in config/approvals, by the one rule
   approver-only actions use (lib/access.js notAnApprover) */
function whyNot(cfg, decoded) {
  return require('./access').notAnApprover(cfg && cfg.approvers, decoded && decoded.email, 'see what people ask ETB2B AI');
}
function queryOf(req) { return new URLSearchParams(str(req.url).split('?')[1] || ''); }

/* Entries older than the record keeps are deleted, at most once an hour and a batch at a time, after a report has
   been answered: the record ages out even where no TTL policy is set. */
var lastSweep = 0;
function sweep(fb, nowMs) {
  if (nowMs - lastSweep < CAPS.sweepEveryMs) return Promise.resolve(0);
  lastSweep = nowMs;
  var cutoff = iso(nowMs - CAPS.keepDays * DAY_MS);
  return Promise.all([RECORD, NOTES].map(function (name) {
    return fb.db.collection(name).where('at', '<', cutoff).limit(CAPS.sweepBatch).get().then(function (snap) {
      if (!snap.docs.length) return 0;
      var batch = fb.db.batch();
      snap.docs.forEach(function (d) { batch.delete(d.ref); });
      return batch.commit().then(function () { return snap.docs.length; });
    });
  })).then(function (n) { return n[0] + n[1]; }, function (err) {
    warn('sweep', 'old entries were not swept — ' + (err && err.message));
    return 0;
  });
}
function readRange(fb, name, r, limit) {
  return fb.db.collection(name).where('at', '>=', r.from).where('at', '<', r.to).orderBy('at', 'desc').limit(limit + 1).get()
    .then(function (snap) { return snap.docs.map(function (d) { return d.data() || {}; }); });
}

/* GET /api/ai-report?range=week|month|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&names=1&tests=1 (approvers only) */
function handleReport(req, res) {
  if (!wired(res)) return;
  H.withAdmin(req, res, function (fb, decoded) {
    var q = queryOf(req), nowMs = clock.now();
    H.approvalsConfig(fb).then(function (cfg) {
      var why = whyNot(cfg, decoded);
      if (why) return H.sendJson(res, 403, { code: 'not-an-approver', error: why });
      var r = rangeOf({ range: q.get('range'), from: q.get('from'), to: q.get('to') }, nowMs);
      if (r.error) return H.sendJson(res, 400, { code: 'bad-range', error: r.error });
      return Promise.all([readRange(fb, RECORD, r, CAPS.reportEntries), readRange(fb, NOTES, r, CAPS.reportNotes)]).then(function (got) {
        var capped = got[0].length > CAPS.reportEntries || got[1].length > CAPS.reportNotes;
        var entries = got[0].slice(0, CAPS.reportEntries), notes = got[1].slice(0, CAPS.reportNotes);
        var ids = uniq(notes.map(function (n) { return str(n.group); }).filter(function (g) { return /^[0-9a-f]{20}$/.test(g); }));
        var refs = ids.map(function (id) { return fb.db.collection(GROUPS).doc(id); });
        return (refs.length ? fb.db.getAll.apply(fb.db, refs) : Promise.resolve([])).then(function (snaps) {
          var groups = {};
          snaps.forEach(function (s) { if (s && s.exists) groups[s.id] = s.data() || {}; });
          H.sendJson(res, 200, buildReport(entries, notes, { names: q.get('names') === '1', tests: q.get('tests') === '1', groups: groups, capped: capped,
            range: { range: r.range, from: r.fromDay, to: r.toDay, keepDays: CAPS.keepDays } }));
          sweep(fb, nowMs);
        });
      });
    }).catch(function (err) { H.sendFailure(res, 'ai report', err, 'The report could not be loaded. Please try again.'); });
  });
}

/* POST /api/ai-report/resolve { group, resolved } (approvers only): a QA group marked resolved, or open again */
function handleResolve(req, res) {
  if (!wired(res)) return;
  H.withAdminBody(req, res, H.BODY_LIMITS.tiny || 16 * 1024, function (fb, decoded, body) {
    var group = str(body.group);
    if (!/^[0-9a-f]{20}$/.test(group)) return H.sendJson(res, 400, { error: 'group is required.' });
    H.approvalsConfig(fb).then(function (cfg) {
      var why = whyNot(cfg, decoded);
      if (why) return H.sendJson(res, 403, { code: 'not-an-approver', error: why });
      var on = body.resolved !== false, at = iso(clock.now());
      var doc = on ? { resolved: true, resolvedAt: at, resolvedBy: line(decoded.name || decoded.email, 120) } : { resolved: false, resolvedAt: '', resolvedBy: '', reopenedAt: at };
      return fb.db.collection(GROUPS).doc(group).set(doc, { merge: true }).then(function () {
        H.sendJson(res, 200, { group: group, resolved: on, resolvedAt: on ? at : '' });
      });
    }).catch(function (err) { H.sendFailure(res, 'ai report resolve', err, 'That could not be saved. Please try again.'); });
  });
}

/* POST /api/ai-qa/note { kind: 'page-error', error, where?, source?, line?, col?, stack?, page, eventId?, tab?,
   asked?, did?, screen? } — a page that carries the assistant had an error (etb2b-assistant.js). Signed-in team
   only; answered at once (202), and 429 { code: 'qa-note-rate' } tells the page to send no more. Only page errors
   come from a browser: an undo and a complaint are noted by the server itself. */
function handleNote(req, res) {
  if (!wired(res)) return;
  H.withAdminBody(req, res, H.BODY_LIMITS.tiny || 16 * 1024, function (fb, decoded, body) {
    if (body.kind !== 'page-error' || !line(body.error, 10)) return H.sendJson(res, 400, { error: 'An error text is required.' });
    var nowMs = clock.now();
    /* what the last answer was, as the page says it: "dash:refuse" is the dash brain's refusal (the brain is kept on
       its own, so the report reads "refuse", never the page's shorthand) */
    var didM = /^(dash|edit|promo):([a-z][a-z-]{0,20})$/.exec(line(body.did, 24));
    var note = noteOf('page-error', {
      decoded: decoded, page: body.page, tab: body.tab, eventId: body.eventId, asked: body.asked, brain: didM ? didM[1] : '',
      did: { kind: didM ? didM[2] : '', target: '' }, happened: 'page error', error: body.error,
      where: line(body.where, 160) || whereOf(body.source, body.line, body.col), stack: body.stack,
      ua: req.headers && req.headers['user-agent'], screen: body.screen
    }, nowMs);
    var held = noteGate(note.uid, note.group, nowMs);
    if (held === 'duplicate') return H.sendJson(res, 202, { ok: true, kept: false });
    if (held) return H.sendJson(res, 429, { code: 'qa-note-rate', error: 'Enough notes for now.' });
    H.sendJson(res, 202, { ok: true, kept: true });
    /* once the page has its answer: the event's name for the report (an event that is gone is left out), and what was
       asked stripped of every event's name, as the record's words are (the browser's words are never kept as sent) */
    var named = note.eventId ? fb.db.collection('events').doc(note.eventId).get().then(function (s) {
      if (s.exists && !(s.data() || {}).deletedAt) note.eventName = line((s.data() || {}).name, 120);
      else note.eventId = '';
    }, function () { note.eventId = ''; }) : Promise.resolve();
    named.then(function () { return note.asked ? knownEvents(fb) : null; }).then(function (list) {
      if (list) note.asked = strip(body.asked, { known: list, hereId: note.eventId, max: CAPS.askedChars });
      note.test = isTestOf(note.eventId, decoded);
      return fb.db.collection(NOTES).add(note);
    }).then(null, function (err) {
      warn('page-note', 'a page error note was not kept — ' + (err && err.message));
    });
  });
}

module.exports = {
  wire: wire, recordTurn: recordTurn, recordOutcome: recordOutcome, dashFacts: dashFacts, editFacts: editFacts,
  handleReport: handleReport, handleResolve: handleResolve, handleNote: handleNote, CAPS: CAPS
};
module.exports._test = {
  strip: strip, cleanIntent: cleanIntent, entryOf: entryOf, noteOf: noteOf, groupOf: groupOf, noteGate: noteGate, resetGate: resetGate,
  buildReport: buildReport, rangeOf: rangeOf, outcomeOf: outcomeOf, isComplaint: isComplaint, browserOf: browserOf, cleanScreen: cleanScreen,
  phoneLike: phoneLike, nameVariants: nameVariants, whyNot: whyNot, maskContact: maskContact, whereOf: whereOf, normError: normError,
  writeEntry: writeEntry, ringKeyOf: ringKeyOf, gateSize: function () { return Object.keys(gate.seen).length; }, knownEvents: knownEvents, sweep: sweep, clock: clock, PAGES: PAGES,
  resetCaches: function () { namesCache = { at: 0, list: null, pending: null }; compiled = { key: '', items: [] }; lastSweep = 0; warned = {}; resetGate(); }
};
