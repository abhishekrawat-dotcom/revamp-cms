/* Promotions previews: the example content that fills ONLY the gaps in a preview card (owner B, 2026-10-29).

   Every mailer and post card shows this event's own render. When a template needs data the event does not have
   (speakers, partners, an agenda, an award…), the card still draws the real design with the event's own name,
   date, colours and logo, and only the missing part comes from one shared, fictional library:
   assets/promo-examples/library.json (12 people, 12 partners, sessions, lists, stats, quotes, award counts) and its
   pictures people/p01-p12.jpg and logos/l01-l12.png, made once by tools/make-promo-examples.js.

     fillFor(id, ev, params, opts?) -> { ev, params, filled, state }
         id: a mailer id (mailer.*) or a post template id (generic.* / partner.* / speaker.*); ev: the engine's
         EventEntity; params: the template's options; opts: { base } (or the base as a string), the app's public
         address, so example pictures are absolute as the rest of a mail's are (H.publicBaseFor(req)). Without
         it they are same-origin paths ("/assets/promo-examples/…"), which the preview frames resolve too.
         Pure: neither ev nor params is changed; what changes is new.
     isExample(x)                -> true when x (a string, a Buffer, or anything JSON can hold) carries a marker
     markMailHtml(html, filled)  -> the mail with the machine marker and a visible "EXAMPLE PREVIEW" first row
     markPostHtml(html, filled)  -> the post with the machine marker and a visible "EXAMPLE" corner ribbon
     EXAMPLE_PATH                -> '/assets/promo-examples/'

   THE RULES (the owner's decisions, map-previews §12):
   1. A key is filled only when the event's real list fails the template's own gate, and the real items stay
      first: examples only top the list up to the template's default display count. Real people are never
      replaced.
   2. A gap that is a fact about the event (it is over, nominations are closed, it has no date or venue) is a
      STATE, never filled: the card shows the real render with a chip. Only lists and an award's facts are
      ever examples.
   3. An award's facts are examples only on an event that is not an award (those cards sit under "For award
      events"), and their dates agree in the mail: see exampleAward; 4. "Winners announced" is always an example
      here, because Oneworld records no winner count.
   6. One neutral text set for every portal.
   The Testimonial is always available, but a card is drawn with its default options, whose quote is empty: the
   card gets a library quote AND an example voice, so a made-up quote is never put in a real person's mouth. In the
   same way the agenda's example sessions are given example people only, never the event's real speakers.

   WHY THE MARKERS. Example content must never reach a save, a download, an export, a send or the AI. The
   server's guards (promo-mailer.js, promo.js, promo-social.js, api.js checkPromoBody) refuse anything isExample
   finds, so a pasted or imported copy of a preview is caught too. The markers are: the library's address in
   any URL (also URL-encoded), its ids ("ex-p01", "ex-l01", "ex-s1", quoted as JSON and HTML quote them), and
   the <meta name="oneworld-example"> and data-oneworld-example label every marked render carries (the bare word
   alone is not a marker: an event may be called that). The texts
   (key points and so on) carry no marker of their own: they only ever enter a render that is then marked. */
'use strict';
const fs = require('fs');
const path = require('path');

var EXAMPLE_PATH = '/assets/promo-examples/';
var LIBRARY_FILE = path.join(__dirname, '..', '..', 'assets', 'promo-examples', 'library.json');
var DAY = 86400000;

/* the engine is needed only to fill (tiers, date labels, gates); the guards that only call isExample — the
   console's API module among them — never pay for loading it */
var engineModule = null;
function eng() { return engineModule || (engineModule = require('./vendor/promo-engine')); }

/* ---------- the library ---------- */

var LIB = null;
/* read once per process and checked, so a broken file is one clear error instead of a half-filled preview */
function library() {
  if (LIB) return LIB;
  var lib = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
  var problem = libraryProblem(lib);
  if (problem) throw new Error('promo-examples: ' + LIBRARY_FILE + ' — ' + problem);
  LIB = lib;
  return LIB;
}
function libraryProblem(lib) {
  if (!lib || typeof lib !== 'object') return 'not an object';
  var lists = { people: 12, partners: 12, sessions: 5, keyPoints: 6, whoShouldAttend: 6, whyJoin: 5, stats: 4, quotes: 3 };
  for (var k in lists) {
    if (!Array.isArray(lib[k]) || lib[k].length !== lists[k]) return k + ' must hold ' + lists[k];
  }
  function under(v) { return String(v || '').indexOf(EXAMPLE_PATH) === 0; }
  var bad = lib.people.filter(function (p) { return !p || !/^ex-p\d\d$/.test(p.id) || !p.name || !under(p.photo); })[0] ||
    lib.partners.filter(function (p) { return !p || !/^ex-l\d\d$/.test(p.id) || !p.name || !p.tier || !under(p.logo); })[0] ||
    lib.sessions.filter(function (s) { return !s || !/^ex-s\d+$/.test(s.id) || !s.title || !/^\d\d:\d\d$/.test(s.start) || !/^\d\d:\d\d$/.test(s.end); })[0] ||
    lib.quotes.filter(function (q) { return !q || !q.text || !lib.people.some(function (p) { return p && p.id === q.by; }); })[0];
  if (bad) return 'a malformed entry: ' + JSON.stringify(bad).slice(0, 120);
  var a = lib.award;
  if (!a || !(a.nominationsCloseOffsetDays > 0) || !(a.ceremonyOffsetDays > 0) || !(a.editions > 0) || !(a.categories > 0) || !(a.winners > 0)) return 'award facts missing';
  return '';
}

/* ---------- what each template may fill ----------
   The keys are the ones the cards name ("Example speakers — add yours to use this"): points (key points and who
   should attend), why (why join), speakers, sponsors, sessions, award, audience, stats, quote. Counts are the
   template's own default display count (its limit / juryCount / moreCount param), so a top-up looks as the real
   mail would with that many people. min is the template's own gate (requires()). */
var FILLS = {
  'mailer.discussion': { keys: ['points'] },
  'mailer.resilience': { keys: ['why'] },
  'mailer.speakers': { keys: ['speakers'], speakers: { min: 2, count: 6 } },
  'mailer.speaker-spotlight': { keys: ['speakers'], speakers: { min: 1, count: 4 } },   // 1 star + moreCount 3
  'mailer.decrypt': { keys: ['speakers'], speakers: { min: 2, count: 8 } },
  'mailer.partners': { keys: ['sponsors'], sponsors: 8 },
  'mailer.partner-spotlight': { keys: ['sponsors'], sponsors: 8 },
  'mailer.agenda': { keys: ['sessions'], sessions: 5 },
  'mailer.award-nominations': { keys: ['award'] },
  'mailer.award-deadline': { keys: ['award'] },
  'mailer.award-jury': { keys: ['award', 'speakers'], speakers: { min: 3, count: 9 } },
  'mailer.award-ceremony': { keys: ['award'] },
  'mailer.award-winners': { keys: ['award'] },
  'generic.who-should-attend': { keys: ['audience'] },
  'generic.summit-highlights': { keys: ['stats'] },
  'generic.testimonial': { keys: ['quote'] },
  'partner.tier-ladder': { keys: ['sponsors'], sponsors: 10 },                          // maxSponsors 10
  'partner.presenting-spotlight': { keys: ['sponsors'], sponsors: 8 },
  'speaker.individual': { keys: ['speakers'], speakers: { min: 1, count: 1 } },
  'speaker.combined': { keys: ['speakers'], speakers: { min: 2, count: 8 } }               // limit 8
};
var AWARD_IDS = ['mailer.award-nominations', 'mailer.award-deadline', 'mailer.award-jury', 'mailer.award-ceremony', 'mailer.award-winners'];

function len(a) { return Array.isArray(a) ? a.length : 0; }
/* the engine's own filter for its list fields (resilience.ts usable): "NA" is a value ET's data carries, not a reason */
function usable(a) { return (Array.isArray(a) ? a : []).map(function (t) { return String(t || '').trim(); }).filter(function (t) { return t && t.toUpperCase() !== 'NA'; }); }
function sponsorCount(ev) { return (ev.sponsorTiers || []).reduce(function (n, t) { return n + len(t && t.sponsors); }, 0); }
function plainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
/* the engine's reminder.ts rule: the event is over when its end (else its start) is before now */
function isPast(ev) {
  var end = ev.endDate || ev.startDate;
  if (!end) return false;
  var t = new Date(String(end).replace(' ', 'T')).getTime();
  return !isNaN(t) && t < Date.now();
}
function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

/* the template's own gate, when the engine has the template (post templates arrive with the Phase 3 engine) */
function gateOk(id, ev) {
  var E = eng(), t = null;
  if (id.indexOf('mailer.') === 0) t = E.getMailer(id);
  else if (typeof E.getTemplate === 'function') t = E.getTemplate(id);
  if (!t || typeof t.requires !== 'function') return false;
  try { return !!t.requires(ev).ok; } catch (e) { return false; }
}

/* a gap that is a fact about the event: shown as it is, with a chip, never filled (decision 2) */
function stateOf(id, ev) {
  if (id === 'mailer.reminder') return ev.name && isPast(ev) ? 'past' : null;
  if (id === 'generic.announcement') return ev.dateLabel || ev.venue ? null : 'no-date-venue';
  var a = ev.award;
  if (!a || AWARD_IDS.indexOf(id) === -1) return null;
  if (id === 'mailer.award-nominations' || id === 'mailer.award-deadline') {
    if (a.phase === 'past') return 'past';
    /* "closed" here means "not taking entries": closed, or dates still to be decided */
    if (!a.nominationsOpen || (id === 'mailer.award-deadline' && !a.nominationsCloseLabel)) return 'closed';
    return null;
  }
  if (id === 'mailer.award-ceremony') {
    if (a.phase === 'past') return 'past';
    if (!(ev.dateLabel || a.ceremonyDateLabel)) return 'no-date';
  }
  return null;
}

/* the app's public address, or '' (then pictures stay same-origin paths) */
function baseOf(opts) {
  var b = typeof opts === 'string' ? opts : plainObject(opts) ? opts.base : '';
  b = String(b || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\/\s"'<>?#]+$/i.test(b) ? b : '';
}
function picture(base, rel) { return base + rel; }

function examplePerson(p, base, weight, group) {
  return { id: p.id, name: p.name, designation: p.designation || '', company: p.company || '',
    photoUrl: picture(base, p.photo), group: group || undefined, weightage: weight };
}
function maxWeight(list) { return (list || []).reduce(function (m, x) { return Math.max(m, Number(x && x.weightage) || 0); }, 0); }

/* real speakers first, then library people up to count (decision 1) */
function topUpSpeakers(real, count, base, fallbackGroup) {
  real = Array.isArray(real) ? real : [];
  var need = Math.max(0, Math.min(count, 12) - real.length), w = maxWeight(real);
  /* the same group as the real ones beside them, so the grid reads as one list */
  var group = (real[0] && real[0].group) || fallbackGroup;
  return real.concat(library().people.slice(0, need).map(function (p, i) { return examplePerson(p, base, w + i + 1, group); }));
}

function exampleSponsors(ev, count, base) {
  var real = [].concat.apply([], (ev.sponsorTiers || []).map(function (t) { return (t && t.sponsors) || []; }));
  var w = maxWeight(real);
  var add = library().partners.slice(0, Math.max(0, count - real.length)).map(function (p, i) {
    return { id: p.id, title: p.name, logoUrl: picture(base, p.logo), tier: p.tier, url: undefined, weightage: w + i + 1 };
  });
  return eng().groupSponsors(real.concat(add));
}

/* The agenda's example sessions, on the event's own first day when it has one. Made-up sessions are given example
   people only, even on an event with real speakers: a real person is never shown on a session that does not exist
   (the Testimonial's rule: a made-up quote is never put in a real person's mouth). Any library name the event
   already has is skipped, so no session reads as a real speaker's. Those people join the speakers after the real
   ones, so a speaker list the mail shows (the agenda's "On stage" grid) keeps the real people first.
   promo-posts.js exampleKit staffs the agenda post the same way; keep the two in step.
   Returns { sessions, speakers }: the example sessions, and the event's speakers with those people appended. */
function exampleSessions(ev, count, base) {
  var lib = library(), m = /^(\d{4}-\d{2}-\d{2})/.exec(String(ev.startDate || ''));
  var day = m ? m[1] : isoDay(Date.now() + 30 * DAY);
  var real = Array.isArray(ev.speakers) ? ev.speakers : [], taken = {};
  real.forEach(function (p) { if (p && p.name) taken[String(p.name).trim().toLowerCase()] = 1; });
  /* the same group as the real ones beside them and weighted after them, as topUpSpeakers does */
  var w = maxWeight(real), group = (real[0] && real[0].group) || 'Speakers';
  var people = lib.people.filter(function (p) { return !taken[String(p.name).trim().toLowerCase()]; }).slice(0, 5)
    .map(function (p, i) { return examplePerson(p, base, w + i + 1, group); });
  var sessions = lib.sessions.slice(0, count).map(function (s, i) {
    var who = people.length ? [people[i % people.length]] : [];
    /* the two panels have two people on them, as a panel does */
    if (/^(panel|closing panel)/i.test(s.title) && people.length > 1) who.push(people[(i + 1) % people.length]);
    return { id: s.id, title: s.title, start: day + 'T' + s.start, end: day + 'T' + s.end, speakers: who };
  });
  return { sessions: sessions, speakers: real.concat(people) };
}

/* An award's facts for an event that is not one (decision 3), and the counts band's numbers.
   The dates must agree with each other in the mail. Wherever the engine names the ceremony, it reads the event's
   own date first (awards.ts: event.dateLabel || award.ceremonyDateLabel), because an award event's date IS its
   ceremony (normalize.ts normalizeAward). So:
   - for every award card except Winners announced, the award is taking entries. The ceremony is the event's own
     exact date when that is far enough ahead for a closing date before it. Otherwise an example ceremony
     (ceremonyOffsetDays ahead) stands in for the event's date in the example copy, so a past, too-near or inexact
     date is never shown as the ceremony beside a later "Nominations close". Nominations close
     nominationsCloseOffsetDays from today, and never less than a week before the ceremony;
   - for Winners announced, the award has already been held ("winners were announced on …"). The ceremony is the
     event's own date when that is over; otherwise an example ceremony a week ago stands in for it.
   Returns { award, when }. when is the { startDate, endDate, dateLabel } the example copy takes, or null when the
   event's own date is the ceremony. */
var CLOSE_BEFORE_DAYS = 7;     // nominations close at least a week before the ceremony…
var CEREMONY_LEAD_DAYS = 9;    // …and at least two days from today, so the event's own date needs nine days' lead
var HELD_DAYS_AGO = 7;         // Winners announced: how long ago the example ceremony was
function exactStart(ev) {
  if (!ev.startDate) return NaN;
  return new Date(String(ev.startDate).replace(' ', 'T')).getTime();
}
function exampleAward(ev, id) {
  var E = eng(), A = library().award, now = Date.now(), start = exactStart(ev);
  var held = id === 'mailer.award-winners';
  var own = !isNaN(start) && (held ? isPast(ev) : start >= now + CEREMONY_LEAD_DAYS * DAY);
  var ceremonyMs = own ? start : held ? now - HELD_DAYS_AGO * DAY : now + A.ceremonyOffsetDays * DAY;
  var ceremony = own ? ev.startDate : isoDay(ceremonyMs);
  var label = (own && ev.dateLabel) || E.fmtDateLabel(ceremony, own ? ev.endDate : undefined) || undefined;
  /* a held award's entries closed as long before its ceremony as an open one's do */
  var closeMs = held ? ceremonyMs - (A.ceremonyOffsetDays - A.nominationsCloseOffsetDays) * DAY
    : Math.min(now + A.nominationsCloseOffsetDays * DAY, ceremonyMs - CLOSE_BEFORE_DAYS * DAY);
  var close = isoDay(closeMs);
  var link = ev.micrositeUrl || ev.ctaUrl || '#';
  return {
    award: {
      awardId: 0, phase: held ? 'past' : 'live', awardUrl: link,
      ceremonyDate: ceremony, ceremonyDateLabel: label,
      nominationsOpen: !held, nominationsCloseDate: close, nominationsCloseLabel: E.fmtDateLabel(close) || undefined,
      nominateUrl: link, winnersUrl: link,
      editions: A.editions, categories: A.categories, winners: A.winners
    },
    when: own ? null : { startDate: ceremony, endDate: ceremony, dateLabel: label }
  };
}

/* a card is drawn with default options: an empty quote gets a library quote and that quote's own example person
   as the voice (appended to the speakers and picked), with any attribution override cleared */
function quoteFill(ev, p, base) {
  var lib = library(), name = String(ev.name || ''), h = 0;
  for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  var q = lib.quotes[h % lib.quotes.length];
  var person = lib.people.filter(function (x) { return x.id === q.by; })[0];
  var real = Array.isArray(ev.speakers) ? ev.speakers : [];
  var voice = examplePerson(person, base, maxWeight(real) + 1, (real[0] && real[0].group) || 'Speakers');
  var ev2 = Object.assign({}, ev, { speakers: real.concat([voice]) });
  var p2 = Object.assign({}, p, { quote: q.text, speakerId: voice.id, author: '', authorTitle: '' });
  return { ev: ev2, params: p2, filled: ['quote'], state: null };
}

function fillFor(id, ev, params, opts) {
  id = String(id || '');
  var p = plainObject(params) ? params : {};
  var none = { ev: ev, params: p, filled: [], state: null };
  if (!plainObject(ev)) return none;
  var rule = Object.prototype.hasOwnProperty.call(FILLS, id) ? FILLS[id] : null, base = baseOf(opts);

  if (id === 'generic.testimonial') return String(p.quote == null ? '' : p.quote).trim() ? none : quoteFill(ev, p, base);
  if (gateOk(id, ev)) return none;
  var state = stateOf(id, ev);
  if (state) return { ev: ev, params: p, filled: [], state: state };
  if (!rule) return none;

  var lib = library(), ev2 = Object.assign({}, ev), p2 = Object.assign({}, p), filled = [];
  rule.keys.forEach(function (key) {
    switch (key) {
      case 'speakers':
        if (len(ev.speakers) >= rule.speakers.min) return;
        ev2.speakers = topUpSpeakers(ev.speakers, rule.speakers.count, base, AWARD_IDS.indexOf(id) !== -1 || id === 'mailer.decrypt' ? 'Jury' : 'Speakers');
        break;
      case 'sponsors':
        if (sponsorCount(ev) >= 1) return;
        ev2.sponsorTiers = exampleSponsors(ev, rule.sponsors, base);
        break;
      case 'sessions':
        if (len(ev.sessions) >= 1) return;
        var agenda = exampleSessions(ev, rule.sessions, base);
        ev2.sessions = agenda.sessions;
        /* the example people who speak in them, after the real speakers; still only the sessions are named as
           filled, since those people come with the example agenda and the mail is marked either way */
        ev2.speakers = agenda.speakers;
        break;
      case 'points':
        if (len(ev.keyPoints) || len(ev.whoShouldAttend) || len(ev.whyJoin)) return;
        ev2.keyPoints = lib.keyPoints.slice(0, 6);
        ev2.whoShouldAttend = lib.whoShouldAttend.slice(0, 6);
        break;
      case 'why':
        if (usable(ev.whyJoin).length || usable(ev.keyPoints).length || usable(ev.whoShouldAttend).length) return;
        ev2.whyJoin = lib.whyJoin.slice(0, 5);
        break;
      case 'audience':
        if (len(ev.whoShouldAttend)) return;
        ev2.whoShouldAttend = lib.whoShouldAttend.slice(0, 6);
        break;
      case 'stats':
        if (len(ev.stats)) return;
        ev2.stats = lib.stats.map(function (s) { return { label: s.label, value: s.value }; });
        /* an empty stats option would win over the event's (summit-highlights reads params.stats first) */
        if (Array.isArray(p2.stats) && !p2.stats.length) delete p2.stats;
        break;
      case 'award':
        if (!ev.award) {
          var made = exampleAward(ev, id);
          ev2.award = made.award;
          /* the example ceremony in place of the event's date, which the engine would otherwise show as the ceremony */
          if (made.when) Object.assign(ev2, made.when);
          /* the award's own button, as an award event's mail has it: entries while they are open, the winners after */
          ev2.ctaLabel = made.award.nominationsOpen ? 'Nominate Now' : 'View Winners';
        } else if (id === 'mailer.award-winners' && !(ev.award.winners && ev.award.winnersUrl)) {
          /* decision 4: Oneworld records no winner count, so this one card is always an example */
          ev2.award = Object.assign({}, ev.award, { winners: ev.award.winners || lib.award.winners,
            winnersUrl: ev.award.winnersUrl || ev.award.awardUrl || ev.micrositeUrl || '#' });
        } else return;
        break;
      default: return;
    }
    filled.push(key);
  });
  return filled.length ? { ev: ev2, params: p2, filled: filled, state: null } : none;
}

/* ---------- markers ---------- */

/* the library's address in a URL, also URL-encoded or JSON-escaped ("\/") */
var PATH_RE = /assets(?:\\?\/|%2F)promo-examples(?:\\?\/|%2F)/i;
/* a library id as a value: quoted as JSON and HTML write it, and not the start of a longer word */
var ID_RE = /(?:["'`]|&quot;|&#0*3[49];|&#x0*2[27];)ex-[pls]\d+(?![A-Za-z0-9_-])/;
/* The <meta name="oneworld-example"> and the visible label's data-oneworld-example="1". Each is matched as HTML
   writes it and as JSON (\"), HTML (&quot;) or a URL (%22, %3D) quotes it. Only those forms match: a bare
   "oneworld-example" in an event's own address or wording (an event called "oneworld-example-day") is not a
   marker, and treating it as one would refuse that event's every save and send. */
var MARKER_QUOTE = '(?:\\\\?["\']|&quot;|&#0*3[49];|&#x0*2[27];|%2[27])?';
var META_RE = new RegExp('meta(?:\\s|%20|\\+)+name\\s*(?:=|%3D)\\s*' + MARKER_QUOTE + 'oneworld-example(?![A-Za-z0-9_-])' +
  '|data-oneworld-example\\s*(?:=|%3D)', 'i');

function textOf(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  /* an uploaded file (an import) arrives as bytes: JSON of a Buffer is a list of numbers no marker survives */
  if (Buffer.isBuffer(x)) return x.toString('utf8');
  if (x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString('utf8');
  if (typeof x !== 'object') return '';
  try { return JSON.stringify(x) || ''; } catch (e) { return stringsOf(x); }
}
/* every string a structure holds (JSON.stringify refuses a cycle; this does not) */
function stringsOf(x) {
  var out = [], seen = [];
  (function walk(v) {
    if (typeof v === 'string') { out.push(JSON.stringify(v)); return; }
    if (!v || typeof v !== 'object' || seen.indexOf(v) !== -1) return;
    seen.push(v);
    Object.keys(v).forEach(function (k) { out.push(JSON.stringify(k)); walk(v[k]); });
  })(x);
  return out.join(',');
}
function isExample(x) {
  var s = textOf(x);
  return !!s && (PATH_RE.test(s) || ID_RE.test(s) || META_RE.test(s));
}

/* what the filled keys are called in a sentence */
var WORDS = { speakers: 'speakers', sponsors: 'partners', sessions: 'sessions', points: 'discussion points', why: 'reasons to join',
  award: 'award facts', audience: 'audience', stats: 'numbers', quote: 'quote and its speaker' };
function wordsFor(filled) {
  var w = (Array.isArray(filled) ? filled : []).map(function (k) { return WORDS[k]; }).filter(Boolean);
  if (!w.length) return 'parts';
  return w.length === 1 ? w[0] : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1];
}
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function metaTag(filled) {
  var keys = (Array.isArray(filled) ? filled : []).filter(function (k) { return WORDS[k]; }).join(',') || 'example';
  return '<meta name="oneworld-example" content="' + escAttr(keys) + '">';
}
/* last in the <head>, so the page's own <meta charset> stays first */
function withMeta(html, filled) {
  var s = String(html == null ? '' : html), end = s.search(/<\/head\s*>/i);
  if (end !== -1) return s.slice(0, end) + metaTag(filled) + s.slice(end);
  var m = /<head(?:\s[^>]*)?>/i.exec(s);
  return m ? s.slice(0, m.index + m[0].length) + metaTag(filled) + s.slice(m.index + m[0].length) : metaTag(filled) + s;
}

/* The mail: a full-width row above everything, so the top of the mail a card shows says so, and so does any
   screenshot or copy of it. Plain inline styles, as the rest of the mail. */
function markMailHtml(html, filled) {
  var row = '<div data-oneworld-example="1" style="margin:0;padding:11px 16px;background-color:#1a1a1a;color:#ffffff;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;text-align:center;letter-spacing:.02em">' +
    '<strong style="letter-spacing:.08em">EXAMPLE PREVIEW</strong> — the ' + wordsFor(filled) + ' in this mail are examples</div>';
  var s = withMeta(html, filled), m = /<body(?:\s[^>]*)?>/i.exec(s);
  return m ? s.slice(0, m.index + m[0].length) + row + s.slice(m.index + m[0].length) : row + s;
}

/* The post: a diagonal ribbon across the top-right corner, above every layer. Sized in vw, so it keeps its place
   at whatever size the post is drawn (1080 px, a card, the full-size view). */
function markPostHtml(html, filled) {
  var ribbon = '<div data-oneworld-example="1" aria-label="Example" style="position:absolute;top:0;right:0;width:30vw;height:30vw;' +
    'overflow:hidden;z-index:2147483647;pointer-events:none"><div style="position:absolute;top:6.4vw;right:-9vw;width:36vw;' +
    'transform:rotate(45deg);background:#c8102e;color:#ffffff;text-align:center;font:800 2.8vw/1 Arial,Helvetica,sans-serif;' +
    'letter-spacing:.2em;padding:1.3vw 0;box-shadow:0 .4vw 1.4vw rgba(0,0,0,.35)">EXAMPLE</div></div>';
  var s = withMeta(html, filled), i = s.search(/<\/body\s*>/i);
  return i === -1 ? s + ribbon : s.slice(0, i) + ribbon + s.slice(i);
}

module.exports = {
  fillFor: fillFor, isExample: isExample, markMailHtml: markMailHtml, markPostHtml: markPostHtml, EXAMPLE_PATH: EXAMPLE_PATH
};
module.exports._test = { library: library, libraryProblem: libraryProblem, FILLS: FILLS, stateOf: stateOf, wordsFor: wordsFor, baseOf: baseOf, LIBRARY_FILE: LIBRARY_FILE };
