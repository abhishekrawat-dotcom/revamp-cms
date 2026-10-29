// node functions/lib/promo-examples.test.js — Promotions previews' example library (lib/promo-examples.js, owner B):
// the library file (X.1), its pictures (X.2: made by tools/make-promo-examples.js, the lead's run R1 — until then
// this group fails by design, and says so), what fillFor fills and never fills for the 18 mailers and the 9 post
// templates (X.3), the markers and isExample (X.4), and the picture script's dry run, finishing and failure handling
// (no request). No network: the engine is the vendored one; the script is only run with --dry-run, and its run() only
// with a stand-in image call writing to a temporary folder.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ex = require('./promo-examples');
const engine = require('./vendor/promo-engine');

var passed = 0, failed = 0, r1 = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

var ROOT = path.join(__dirname, '..', '..');
var LIB_DIR = path.join(ROOT, 'assets', 'promo-examples');
var lib = JSON.parse(fs.readFileSync(path.join(LIB_DIR, 'library.json'), 'utf8'));
var BASE = 'https://revamp.example';

/* ---------- X.1 the library ---------- */
check('X.1 the module reads the same file and finds nothing wrong with it', ex._test.libraryProblem(lib) === '' && ex._test.library().people.length === 12);
check('X.1 12 people: 6 women, 6 men', lib.people.length === 12 && lib.people.filter(function (p) { return p.gender === 'woman'; }).length === 6 &&
  lib.people.filter(function (p) { return p.gender === 'man'; }).length === 6);
check('X.1 the first person is a woman, and women and men alternate (any top-up is mixed)', lib.people.every(function (p, i) { return p.gender === (i % 2 ? 'man' : 'woman'); }));
check('X.1 12 partners in 3 tiers: 2 Presenting, 4 Gold, 6 Partners', lib.partners.length === 12 &&
  JSON.stringify(['Presenting Partners', 'Gold Partners', 'Partners'].map(function (t) { return lib.partners.filter(function (p) { return p.tier === t; }).length; })) === '[2,4,6]');
check('X.1 5 sessions, 6 key points, 6 who-should-attend, 5 why-join, 4 stats, 3 quotes',
  lib.sessions.length === 5 && lib.keyPoints.length === 6 && lib.whoShouldAttend.length === 6 && lib.whyJoin.length === 5 && lib.stats.length === 4 && lib.quotes.length === 3);
var ids = [].concat(lib.people, lib.partners, lib.sessions, lib.quotes).map(function (x) { return x.id; });
check('X.1 every id is an ex- id, and none repeats', ids.every(function (id) { return /^ex-[plsq]\d+$/.test(id); }) && ids.length === new Set(ids).size, ids);
check('X.1 people are p01-p12 with their photo at people/pNN.jpg', lib.people.every(function (p, i) { var n = String(i + 1).padStart(2, '0'); return p.id === 'ex-p' + n && p.photo === '/assets/promo-examples/people/p' + n + '.jpg'; }));
check('X.1 partners are l01-l12 with their logo at logos/lNN.png', lib.partners.every(function (p, i) { var n = String(i + 1).padStart(2, '0'); return p.id === 'ex-l' + n && p.logo === '/assets/promo-examples/logos/l' + n + '.png'; }));
check('X.1 each person works at one of the library\'s own partners (nothing real named)', lib.people.every(function (p) { return lib.partners.some(function (l) { return l.name === p.company; }); }));
check('X.1 each quote is in an example person\'s voice', lib.quotes.every(function (q) { return lib.people.some(function (p) { return p.id === q.by; }); }));
check('X.1 sessions have HH:MM times', lib.sessions.every(function (s) { return /^\d\d:\d\d$/.test(s.start) && /^\d\d:\d\d$/.test(s.end) && s.start < s.end; }));
check('X.1 the award counts are set', lib.award.nominationsCloseOffsetDays > 0 && lib.award.ceremonyOffsetDays > lib.award.nominationsCloseOffsetDays && lib.award.editions > 0 && lib.award.categories > 0 && lib.award.winners > 0);
/* well-known people and brands no example name may carry (owner B: never resembling a real person or company) */
var DENY = ['Mukesh Ambani', 'Anil Ambani', 'Ratan Tata', 'Gautam Adani', 'Nandan Nilekani', 'Azim Premji', 'Kumar Mangalam Birla', 'Anand Mahindra',
  'Uday Kotak', 'Indra Nooyi', 'Sundar Pichai', 'Satya Nadella', 'Narendra Modi', 'Rahul Gandhi', 'Sachin Tendulkar', 'Virat Kohli', 'Dhoni',
  'Amitabh Bachchan', 'Shah Rukh Khan', 'Salman Khan', 'Aamir Khan', 'Deepika Padukone', 'Priyanka Chopra', 'Narayana Murthy', 'Falguni Nayar',
  'Kiran Mazumdar', 'Arjun Nair', 'Lakshmi Iyer', 'Sudha Raghunathan','Vijay Shekhar Sharma', 'Byju Raveendran', 'Kunal Shah', 'Deepinder Goyal', 'Ritesh Agarwal', 'Nirmala Sitharaman',
  'Raghuram Rajan', 'Shiv Nadar', 'Roshni Nadar', 'Sudha Murty', 'Nita Ambani', 'Isha Ambani',
  'Tata', 'Reliance', 'Infosys', 'Wipro', 'HCL', 'Adani', 'Mahindra', 'Bajaj', 'Birla', 'Godrej', 'Airtel', 'Jio', 'Flipkart', 'Paytm', 'Zomato',
  'Swiggy', 'Nykaa', 'Byju', 'Ola', 'Microsoft', 'Google', 'Amazon', 'Apple', 'Meta', 'IBM', 'Oracle', 'Accenture', 'Deloitte', 'Northwind',
  'Contoso', 'Fabrikam', 'Acme', 'Tesla', 'Samsung', 'Sony', 'Siemens', 'Philips', 'Medtronic', 'Ambrey', 'Cognizant', 'Capgemini', 'Larsen'];
var names = [].concat(lib.people.map(function (p) { return p.name; }), lib.people.map(function (p) { return p.company; }), lib.partners.map(function (p) { return p.name; }));
var hits = [];
names.forEach(function (n) { DENY.forEach(function (d) { if (new RegExp('\\b' + d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(n)) hits.push(n + ' ~ ' + d); }); });
check('X.1 no name is a well-known person or brand', !hits.length, hits);
check('X.1 one neutral text set: no portal-specific lists', !Object.keys(lib).some(function (k) { return /^(health|retail|auto|cio|hr|bfsi|portal)/i.test(k); }));
check('X.1 the library itself is example content (its ids and addresses are markers)', ex.isExample(lib));

/* ---------- fixtures (the engine's EventEntity) ---------- */
var future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 16), future2 = new Date(Date.now() + 31 * 864e5).toISOString().slice(0, 16);
var pastStart = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 16), pastEnd = new Date(Date.now() - 19 * 864e5).toISOString().slice(0, 16);
function person(i, name, group) { return { id: 's' + i, name: name, designation: 'Director', company: 'Real Co ' + i, photoUrl: 'https://img.etb2bimg.com/files/s' + i + '.jpg', group: group, weightage: i }; }
function rich() {
  var names = ['Asha Rao', 'Vikram Shah', 'अनन्या शर्मा', 'O\'Brien "QA" <b>', 'Divya Pillai', 'Manoj Gupta', 'Sana Kapoor', 'Ravi Teja'];
  var sp = names.map(function (n, i) { return person(i + 1, n, i < 2 ? 'Keynote Speakers' : 'Speakers'); });
  var sponsors = [['Medisys', 'Presenting Partner'], ['Orbit Pharma', 'Gold Partners'], ['Carelink', 'Gold Partners'], ['Nova Labs', 'Associate Partners'], ['Healix', 'Associate Partners'], ['Pulse AI', 'Associate Partners']]
    .map(function (s, i) { return { id: 'sp' + i, title: s[0], logoUrl: 'https://img.etb2bimg.com/files/l' + i + '.png', tier: s[1], weightage: i + 1 }; });
  return {
    portal: 'health', entityId: 0, oneworldId: 'qa-rich', name: 'Healthcare Leaders Summit 2027', edition: 9, tagline: 'Where hospital leaders shape care',
    hashtag: '#HealthcareLeadersSummit27', startDate: future, endDate: future2, dateLabel: engine.fmtDateLabel(future, future2), totalDays: 2,
    venue: 'Shangri-La Eros', city: 'New Delhi', ctaLabel: 'Register Now', ctaUrl: BASE + '/e/qa-rich#register', logoUrl: BASE + '/assets/x/logo.png',
    keyVisualUrl: BASE + '/templates/x/hero.jpg', keyVisualMode: 'hero', micrositeUrl: BASE + '/e/qa-rich', siteAccent: '#8f6118', siteTheme: 'dark',
    whoShouldAttend: ['Hospital CEOs', 'CMOs', 'CIOs', 'Nursing heads'], keyPoints: ['Access', 'Quality', 'AI in diagnostics'], whyJoin: [],
    stats: [{ label: 'Speakers', value: '8' }, { label: 'Partners', value: '6' }, { label: 'Days', value: '2' }],
    speakers: sp, sponsorTiers: engine.groupSponsors(sponsors),
    sessions: [0, 1, 2, 3].map(function (i) { return { id: 'x' + i, title: 'Session ' + (i + 1), start: future.slice(0, 11) + '1' + i + ':00', end: future.slice(0, 11) + '1' + i + ':45', speakers: [sp[i]] }; })
  };
}
function sparse() {
  return Object.assign(rich(), { oneworldId: 'qa-sparse', speakers: [], sponsorTiers: [], sessions: [], keyPoints: [], whoShouldAttend: [], whyJoin: [], stats: [], venue: undefined, city: undefined, edition: undefined });
}
function award(ev, over) {
  return Object.assign(ev, { ctaLabel: 'Nominate Now', award: Object.assign({ awardId: 0, phase: 'live', awardUrl: ev.micrositeUrl, ceremonyDate: ev.startDate,
    ceremonyDateLabel: ev.dateLabel, nominationsOpen: true, nominationsCloseLabel: '30 November, 2026', nominateUrl: ev.micrositeUrl, categories: 12 }, over || {}) });
}
function speakerIds(ev) { return ev.speakers.map(function (s) { return s.id; }); }

/* the 9 post templates: the engine's own once it carries them (the Phase 3 engine), else their gates as the platform
   wrote them (SRC:src/templates/*: requires), so this file runs before and after that engine is built */
var POST_IDS = ['generic.announcement', 'generic.who-should-attend', 'generic.summit-highlights', 'generic.prediction-outcome', 'generic.testimonial',
  'partner.tier-ladder', 'partner.presenting-spotlight', 'speaker.individual', 'speaker.combined'];
var STAND_IN = {
  'generic.announcement': function (e) { return !!(e.dateLabel || e.venue); },
  'generic.who-should-attend': function (e) { return e.whoShouldAttend.length > 0; },
  'generic.summit-highlights': function (e) { return (e.stats || []).length > 0; },
  'generic.prediction-outcome': function () { return true; },
  'generic.testimonial': function () { return true; },
  'partner.tier-ladder': function (e) { return e.sponsorTiers.length > 0; },
  'partner.presenting-spotlight': function (e) { return e.sponsorTiers.length > 0; },
  'speaker.individual': function (e) { return e.speakers.length > 0; },
  'speaker.combined': function (e) { return e.speakers.length >= 2; }
};
var REAL_POSTS = typeof engine.getTemplate === 'function' && POST_IDS.every(function (id) { return !!engine.getTemplate(id); });
function postOk(id, ev) { return REAL_POSTS ? engine.getTemplate(id).requires(ev).ok : STAND_IN[id](ev); }
function renderPost(id, ev, params) {
  var tpl = engine.getTemplate(id);
  return tpl.render({ event: ev, brand: engine.getBrand(ev.portal), format: engine.FORMATS.ig_portrait, params: engine.resolveParams(tpl, params), assets: {} });
}

/* ---------- X.3 fillFor ---------- */
var S = sparse(), R = rich(), sBefore = clone(S), rBefore = clone(R), P0 = { title: 'x' }, pBefore = clone(P0);

/* every mailer on the sparse event: available as it is, a state, or filled until its own gate passes */
var EXPECT = { 'mailer.discussion': ['points'], 'mailer.resilience': ['why'], 'mailer.speakers': ['speakers'], 'mailer.speaker-spotlight': ['speakers'],
  'mailer.decrypt': ['speakers'], 'mailer.partners': ['sponsors'], 'mailer.partner-spotlight': ['sponsors'], 'mailer.agenda': ['sessions'],
  'mailer.award-nominations': ['award'], 'mailer.award-deadline': ['award'], 'mailer.award-jury': ['award', 'speakers'], 'mailer.award-ceremony': ['award'], 'mailer.award-winners': ['award'] };
check('X.3 the engine has the 18 mailers this file expects', engine.ALL_MAILERS.length === 18);
engine.ALL_MAILERS.forEach(function (m) {
  var f = ex.fillFor(m.id, S, P0, { base: BASE }), want = EXPECT[m.id] || [];
  if (m.requires(S).ok) { check('X.3 ' + m.id + ': available on the sparse event, nothing filled', !f.filled.length && f.ev === S && !f.state, f.filled); return; }
  check('X.3 ' + m.id + ': fills ' + want.join('+'), JSON.stringify(f.filled) === JSON.stringify(want), f.filled);
  check('X.3 ' + m.id + ': its own gate passes after the fill', m.requires(f.ev).ok, m.requires(f.ev).missing);
  var html = ex.markMailHtml(engine.renderDoc(engine.buildDoc(m, f.ev, f.params), f.ev), f.filled);
  check('X.3 ' + m.id + ': the marked mail carries the machine marker and the visible row', ex.isExample(html) && /<meta name="oneworld-example" content="[a-z,]+">/.test(html) && /EXAMPLE PREVIEW/.test(html));
});
POST_IDS.forEach(function (id) {
  var f = ex.fillFor(id, S, {}, { base: BASE });
  var ok = postOk(id, f.ev);
  check('X.3 ' + id + ': passes its gate after the fill' + (REAL_POSTS ? '' : ' (stand-in gate)'), ok, f.filled);
  if (REAL_POSTS && f.filled.length) {
    var html = ex.markPostHtml(renderPost(id, f.ev, f.params), f.filled);
    check('X.3 ' + id + ': the marked post carries the marker and the EXAMPLE ribbon', ex.isExample(html) && /data-oneworld-example="1"[^>]*>[\s\S]*EXAMPLE<\/div><\/div>\s*<\/body>/.test(html));
  }
});
check('X.3 the post templates\' fills: audience, stats, quote, sponsors, speakers',
  JSON.stringify(POST_IDS.map(function (id) { return ex.fillFor(id, S, {}).filled.join('+'); })) ===
  JSON.stringify(['', 'audience', 'stats', '', 'quote', 'sponsors', 'sponsors', 'speakers', 'speakers']));
if (!REAL_POSTS) console.log('note: the post templates are checked against their gates as the platform wrote them; the Phase 3 engine (Unit A) is not built yet — run again once it is.');

/* nothing is filled when the real list passes */
var nothing = engine.ALL_MAILERS.map(function (m) { return m.id; }).concat(POST_IDS).filter(function (id) {
  if (/award/.test(id)) return false;                       // R is not an award: its award facts are examples by design
  return ex.fillFor(id, R, {}).filled.length !== 0 && id !== 'generic.testimonial';
});
check('X.3 the rich event: nothing filled outside the award mailers (and the Testimonial\'s empty quote)', !nothing.length, nothing);
check('X.3 the rich event: a Testimonial with a quote of its own is left alone', ex.fillFor('generic.testimonial', R, { quote: 'A real quote.' }).filled.length === 0);

/* real items first, examples top up to the default count (decision 1) */
var one = Object.assign(sparse(), { speakers: [person(1, 'Asha Rao', 'Keynote')] });
var f1 = ex.fillFor('mailer.speakers', one, {}, BASE);
check('X.3 one real speaker + Speakers (2+): the real one first, then 5 examples (6 in all)', f1.ev.speakers.length === 6 && f1.ev.speakers[0].name === 'Asha Rao' &&
  f1.ev.speakers.slice(1).every(function (s) { return /^ex-p\d\d$/.test(s.id); }), speakerIds(f1.ev));
check('X.3 the examples join the real speakers\' group and come after them', f1.ev.speakers.slice(1).every(function (s, i) { return s.group === 'Keynote' && s.weightage === 2 + i; }));
var fc = ex.fillFor('speaker.combined', one, {}, BASE);
check('X.3 one real speaker + Combined (2+): 1 real + 7 examples, never fewer real', fc.ev.speakers.length === 8 && fc.ev.speakers[0].id === 's1' && fc.ev.speakers.filter(function (s) { return /^ex-/.test(s.id); }).length === 7);
var two = Object.assign(sparse(), { speakers: [person(1, 'A', ''), person(2, 'B', '')] });
check('X.3 two real speakers: Speakers and Decrypt are available, nothing filled', ex.fillFor('mailer.speakers', two, {}).filled.length === 0 && ex.fillFor('mailer.decrypt', two, {}).filled.length === 0);
var awTwo = award(Object.assign(sparse(), { speakers: [person(1, 'A', 'Jury'), person(2, 'B', 'Jury')] }));
var fj = ex.fillFor('mailer.award-jury', awTwo, {}, BASE);
check('X.3 an award with 2 jury members: Meet the jury tops up to 9, the award\'s facts untouched', JSON.stringify(fj.filled) === '["speakers"]' &&
  fj.ev.speakers.length === 9 && fj.ev.speakers[0].id === 's1' && fj.ev.speakers[1].id === 's2' && fj.ev.award === awTwo.award, fj.filled);
var spot = ex.fillFor('mailer.speaker-spotlight', S, {}, BASE);
check('X.3 Speaker spotlight: a star and 3 more', spot.ev.speakers.length === 4);
check('X.3 Decrypt and Meet the jury on an event with no speakers: 8 and 9 example people, grouped as a jury',
  ex.fillFor('mailer.decrypt', S, {}).ev.speakers.length === 8 && ex.fillFor('mailer.award-jury', S, {}).ev.speakers.length === 9 &&
  ex.fillFor('mailer.award-jury', S, {}).ev.speakers.every(function (s) { return s.group === 'Jury'; }));

/* example pictures: absolute on the app's address when given, same-origin paths when not, never anything else */
check('X.3 example photos are absolute on the given address', f1.ev.speakers.slice(1).every(function (s) { return s.photoUrl.indexOf(BASE + '/assets/promo-examples/people/') === 0; }));
var noBase = ex.fillFor('mailer.partners', S, {});
var logos = [].concat.apply([], noBase.ev.sponsorTiers.map(function (t) { return t.sponsors; }));
check('X.3 without an address: same-origin /assets/promo-examples/ paths', logos.every(function (s) { return s.logoUrl.indexOf('/assets/promo-examples/logos/') === 0; }));
check('X.3 an address that is not a plain origin is not used', ex.fillFor('mailer.partners', S, {}, { base: 'javascript:alert(1)//' }).ev.sponsorTiers[0].sponsors[0].logoUrl.indexOf('/assets/') === 0 &&
  ex.fillFor('mailer.partners', S, {}, 'https://x.example/"><b>').ev.sponsorTiers[0].sponsors[0].logoUrl.indexOf('/assets/') === 0);
check('X.3 partners: 8 logos in 3 tiers, presenting first', logos.length === 8 && noBase.ev.sponsorTiers.length === 3 && /presenting/i.test(noBase.ev.sponsorTiers[0].tier));
check('X.3 Tier ladder: 10 logos (its auto-pick count)', [].concat.apply([], ex.fillFor('partner.tier-ladder', S, {}).ev.sponsorTiers.map(function (t) { return t.sponsors; })).length === 10);
var ag = ex.fillFor('mailer.agenda', S, {}, BASE);
check('X.3 agenda: 5 example sessions on the event\'s own first day, timed', ag.ev.sessions.length === 5 && ag.ev.sessions.every(function (s) { return s.start.indexOf(future.slice(0, 10) + 'T') === 0 && /^ex-s\d$/.test(s.id); }));
check('X.3 agenda: example people on the sessions when the event has no speakers', ag.ev.sessions.every(function (s) { return s.speakers.length && s.speakers.every(function (p) { return /^ex-p/.test(p.id); }); }));
check('X.3 agenda: on an event with no speakers, the sessions\' example people are its speakers too', ag.ev.speakers.length === 5 &&
  ag.ev.sessions.every(function (s) { return s.speakers.every(function (p) { return ag.ev.speakers.indexOf(p) !== -1; }); }));
/* a made-up session never carries a real person (the Testimonial's rule), even when the event has speakers; a library
   name the event already has is skipped, so no session reads as that real speaker's (promo-posts.js exampleKit too) */
var agEv = Object.assign(sparse(), { speakers: [person(1, 'Asha Rao', 'Keynote'), person(2, '  ' + lib.people[0].name.toUpperCase() + ' ', 'Keynote')] });
var agEvBefore = clone(agEv), agReal = ex.fillFor('mailer.agenda', agEv, {}, BASE);
var agWho = [].concat.apply([], agReal.ev.sessions.map(function (s) { return s.speakers; }));
check('X.3 agenda: only example people on the made-up sessions when the event has real speakers', agReal.ev.sessions.length === 5 &&
  agWho.length && agWho.every(function (p) { return /^ex-p\d\d$/.test(p.id); }), agWho.map(function (p) { return p.id; }));
check('X.3 agenda: a library person whose name the event already has is skipped', agWho.every(function (p) { return p.id !== lib.people[0].id; }) &&
  agReal.ev.speakers.every(function (p) { return p.id !== lib.people[0].id; }));
check('X.3 agenda: the example people are appended after the real speakers, in their group and weighted after them',
  JSON.stringify(speakerIds(agReal.ev).slice(0, 2)) === '["s1","s2"]' && agReal.ev.speakers.length === 7 &&
  agReal.ev.speakers.slice(2).every(function (p) { return /^ex-p\d\d$/.test(p.id) && p.group === 'Keynote' && p.weightage > 2; }) &&
  agWho.every(function (p) { return agReal.ev.speakers.indexOf(p) >= 2; }), speakerIds(agReal.ev));
check('X.3 agenda: still only the sessions are named filled, and the event itself is untouched',
  JSON.stringify(agReal.filled) === '["sessions"]' && JSON.stringify(agEv) === JSON.stringify(agEvBefore));
var agHtml = engine.renderDoc(engine.buildDoc(engine.getMailer('mailer.agenda'), agReal.ev, agReal.params), agReal.ev);
var agGrid = engine.renderDoc(engine.buildDoc(engine.getMailer('mailer.agenda'), agReal.ev, Object.assign({}, agReal.params, { speakerCount: 4 })), agReal.ev);
check('X.3 agenda: the drawn mail names no real speaker beside the example sessions', agHtml.indexOf('Asha Rao') === -1 && agHtml.indexOf('Real Co 1') === -1);
/* the grid alone (from its "On stage" heading): the sessions above it name the example people too */
var agStage = agGrid.slice(agGrid.indexOf('On stage'));
check('X.3 agenda: with the "On stage" grid shown, the real speakers lead it', agGrid.indexOf('On stage') !== -1 && agStage.indexOf('Asha Rao') !== -1 &&
  agStage.indexOf(agReal.ev.speakers[2].name) !== -1 && agStage.indexOf('Asha Rao') < agStage.indexOf(agReal.ev.speakers[2].name));
var disc = ex.fillFor('mailer.discussion', S, {});
check('X.3 discussion: key points and who-should-attend from the library', disc.ev.keyPoints.length === 6 && disc.ev.whoShouldAttend.length === 6 && disc.ev.whyJoin.length === 0);
check('X.3 resilience: 5 why-join reasons', ex.fillFor('mailer.resilience', S, {}).ev.whyJoin.length === 5);
var naOnly = Object.assign(sparse(), { whoShouldAttend: ['NA'] });
check('X.3 resilience counts "NA" as nothing (the engine\'s own rule) and fills; discussion does not', ex.fillFor('mailer.resilience', naOnly, {}).filled[0] === 'why' && ex.fillFor('mailer.discussion', naOnly, {}).filled.length === 0);
var hi = ex.fillFor('generic.summit-highlights', S, { stats: [] });
check('X.3 summit highlights: 4 example stats, and an empty stats option no longer hides them', hi.ev.stats.length === 4 && !('stats' in hi.params));

/* state gaps are never filled (decision 2) */
var past = Object.assign(rich(), { startDate: pastStart, endDate: pastEnd, dateLabel: engine.fmtDateLabel(pastStart, pastEnd) });
var rem = ex.fillFor('mailer.reminder', past, {});
check('X.3 a past event\'s Reminder: state past, nothing filled, the real event', rem.state === 'past' && !rem.filled.length && rem.ev === past);
var noWhen = Object.assign(sparse(), { dateLabel: undefined, startDate: undefined, endDate: undefined, venue: undefined });
var ann = ex.fillFor('generic.announcement', noWhen, {});
check('X.3 the Announcement post with no date or venue: state no-date-venue, nothing invented', ann.state === 'no-date-venue' && !ann.filled.length && ann.ev === noWhen);
check('X.3 the Announcement post with a date: nothing to do', ex.fillFor('generic.announcement', S, {}).state === null);
var closed = award(rich(), { nominationsOpen: false });
check('X.3 an award with nominations closed: Call for nominations and Deadline are state closed, not examples',
  ex.fillFor('mailer.award-nominations', closed, {}).state === 'closed' && ex.fillFor('mailer.award-deadline', closed, {}).state === 'closed' &&
  !ex.fillFor('mailer.award-nominations', closed, {}).filled.length);
var held = award(Object.assign(rich(), { startDate: pastStart, endDate: pastEnd }), { phase: 'past', nominationsOpen: false });
check('X.3 an award already held: nominations, deadline and ceremony are state past', ['mailer.award-nominations', 'mailer.award-deadline', 'mailer.award-ceremony'].every(function (id) { return ex.fillFor(id, held, {}).state === 'past'; }));
var undated = award(Object.assign(rich(), { dateLabel: undefined }), { ceremonyDateLabel: undefined });
check('X.3 an award with no ceremony date: the ceremony is state no-date', ex.fillFor('mailer.award-ceremony', undated, {}).state === 'no-date');

/* award facts only on an event that is not an award (decision 3); winners always (decision 4) */
var live = award(rich());
check('X.3 an award taking entries: its nominations, deadline, jury and ceremony mailers are its own (nothing filled)',
  ['mailer.award-nominations', 'mailer.award-deadline', 'mailer.award-jury', 'mailer.award-ceremony'].every(function (id) { var f = ex.fillFor(id, live, {}); return !f.filled.length && !f.state; }));
var win = ex.fillFor('mailer.award-winners', live, {});
check('X.3 Winners announced on an award: an example (winners and their page added), the award\'s own facts kept', JSON.stringify(win.filled) === '["award"]' &&
  win.ev.award.winners === lib.award.winners && !!win.ev.award.winnersUrl && win.ev.award.nominationsCloseLabel === live.award.nominationsCloseLabel && live.award.winners === undefined);
var winR = ex.fillFor('mailer.award-winners', R, {});
check('X.3 Winners announced on an ordinary event: an example award with winners', JSON.stringify(winR.filled) === '["award"]' && winR.ev.award.winners > 0 && engine.getMailer('mailer.award-winners').requires(winR.ev).ok);
var nomR = ex.fillFor('mailer.award-nominations', R, {});
check('X.3 an ordinary event\'s award example: nominations open, a deadline ahead, the award\'s button', nomR.ev.award.nominationsOpen === true && nomR.ev.award.phase === 'live' &&
  Date.parse(nomR.ev.award.nominationsCloseDate) > Date.now() && /\d{4}$/.test(nomR.ev.award.nominationsCloseLabel) && nomR.ev.ctaLabel === 'Nominate Now' && R.ctaLabel === 'Register Now');
check('X.3 the example ceremony is the event\'s own date when it has one ahead', nomR.ev.award.ceremonyDateLabel === R.dateLabel);
var cerPast = ex.fillFor('mailer.award-ceremony', past, {});
check('X.3 …and a date ahead when the event\'s own is over', cerPast.ev.award.ceremonyDateLabel !== past.dateLabel && Date.parse(cerPast.ev.award.ceremonyDate) > Date.now() && engine.getMailer('mailer.award-ceremony').requires(cerPast.ev).ok);

/* The example award's dates as the rendered mail shows them. The engine names the event's own date as the ceremony
   (awards.ts: event.dateLabel || ceremonyDateLabel), so these read the HTML, not only the example award. */
function shifted(days, over) {
  var s = new Date(Date.now() + days * 864e5).toISOString().slice(0, 16), e = new Date(Date.now() + (days + 1) * 864e5).toISOString().slice(0, 16);
  return Object.assign(rich(), { startDate: s, endDate: e, dateLabel: engine.fmtDateLabel(s, e) }, over || {});
}
function mailText(html) { return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '); }
function drawAward(id, ev) {
  var f = ex.fillFor(id, ev, {}), m = engine.getMailer(id), doc = engine.buildDoc(m, f.ev, f.params);
  var html = engine.renderDoc(doc, f.ev);
  return { f: f, a: f.ev.award, ok: m.requires(f.ev).ok, subject: String(doc.subject || ''), html: html, text: mailText(html) };
}
var DATED = [
  /* [name, event, is its own date the ceremony of an award taking entries] */
  ['an event 20 days past', shifted(-20), false],
  ['an event 10 days ahead', shifted(10), true],
  ['an event 5 days ahead (no room for a closing date before it)', shifted(5), false],
  ['an event with only an inexact date ("November 2026")', shifted(10, { startDate: undefined, endDate: undefined, dateLabel: 'November 2026' }), false],
  ['an event with no date at all', shifted(10, { startDate: undefined, endDate: undefined, dateLabel: undefined }), false],
  ['an event 30 days ahead', rich(), true]
];
var OPEN_AWARD = ['mailer.award-nominations', 'mailer.award-deadline', 'mailer.award-jury', 'mailer.award-ceremony'];
DATED.forEach(function (c) {
  var name = c[0], ev = c[1], ownCeremony = c[2], before = clone(ev);
  OPEN_AWARD.forEach(function (id) {
    var d = drawAward(id, ev), a = d.a, close = Date.parse(a.nominationsCloseDate), when = Date.parse(a.ceremonyDate);
    check('X.3 ' + id + ' on ' + name + ': drawn, taking entries, the button to enter', d.ok && a.phase === 'live' && a.nominationsOpen === true && d.f.ev.ctaLabel === 'Nominate Now');
    check('X.3 ' + id + ' on ' + name + ': nominations close in the future, at least a week before a ceremony that is ahead',
      close > Date.now() && when > Date.now() && close <= when - 6 * 864e5, [a.nominationsCloseDate, a.ceremonyDate]);
    check('X.3 ' + id + ' on ' + name + ': the date the mail names as the ceremony is the example award\'s', d.f.ev.dateLabel === a.ceremonyDateLabel &&
      d.html.indexOf(a.ceremonyDateLabel) !== -1, [d.f.ev.dateLabel, a.ceremonyDateLabel]);
    if (id !== 'mailer.award-jury') {
      check('X.3 ' + id + ' on ' + name + ': the mail shows "Nominations close" with the example closing date', d.text.indexOf('Nominations close ' + a.nominationsCloseLabel) !== -1);
    }
    if (id === 'mailer.award-ceremony') {
      check('X.3 ' + id + ' on ' + name + ': the subject and the ceremony tile carry the same date', d.subject.indexOf(a.ceremonyDateLabel) !== -1 && d.text.indexOf('Ceremony ' + a.ceremonyDateLabel) !== -1, d.subject);
    }
    if (ownCeremony) {
      check('X.3 ' + id + ' on ' + name + ': the ceremony is the event\'s own date', a.ceremonyDateLabel === ev.dateLabel && d.f.ev.startDate === ev.startDate);
    } else if (ev.dateLabel) {
      check('X.3 ' + id + ' on ' + name + ': the event\'s own date appears nowhere in the mail (it would read as the ceremony)', d.html.indexOf(ev.dateLabel) === -1 && d.subject.indexOf(ev.dateLabel) === -1);
    }
  });
  var w = drawAward('mailer.award-winners', ev), wa = w.a;
  check('X.3 Winners announced on ' + name + ': an award already held, its ceremony before today, entries closed before it',
    w.ok && wa.phase === 'past' && wa.nominationsOpen === false && Date.parse(wa.ceremonyDate) < Date.now() && Date.parse(wa.nominationsCloseDate) < Date.parse(wa.ceremonyDate), [wa.ceremonyDate, wa.nominationsCloseDate]);
  check('X.3 Winners announced on ' + name + ': "were announced … on" names that past date, and the button is View Winners, never Nominate Now',
    w.text.indexOf('were announced at ' + ev.name + ' on ' + wa.ceremonyDateLabel) !== -1 && w.f.ev.dateLabel === wa.ceremonyDateLabel &&
    w.f.ev.ctaLabel === 'View Winners' && /View Winners/.test(w.text) && !/Nominate Now/.test(w.text), [wa.ceremonyDateLabel, w.f.ev.ctaLabel]);
  if (Date.parse(ev.startDate) < Date.now()) {
    check('X.3 Winners announced on ' + name + ': the ceremony is the event\'s own past date', wa.ceremonyDateLabel === ev.dateLabel && w.f.ev.startDate === ev.startDate);
  } else if (ev.dateLabel) {
    check('X.3 Winners announced on ' + name + ': the event\'s own date (not yet held) appears nowhere in the mail', w.html.indexOf(ev.dateLabel) === -1);
  }
  check('X.3 the award examples on ' + name + ' leave the event as it was', JSON.stringify(ev) === JSON.stringify(before));
});

/* the Testimonial: an example quote in an example voice, never a real person's */
var tq = ex.fillFor('generic.testimonial', R, { quote: '   ', author: 'Asha Rao', authorTitle: 'CEO' }, BASE);
var voice = tq.ev.speakers.filter(function (s) { return s.id === tq.params.speakerId; })[0];
check('X.3 Testimonial with an empty quote: a library quote, filled ["quote"]', JSON.stringify(tq.filled) === '["quote"]' && lib.quotes.some(function (q) { return q.text === tq.params.quote; }));
check('X.3 Testimonial: the voice is the quote\'s own example person, picked and with a photo; the attribution override cleared',
  !!voice && /^ex-p\d\d$/.test(voice.id) && voice.id === lib.quotes.filter(function (q) { return q.text === tq.params.quote; })[0].by && voice.photoUrl.indexOf(BASE + '/assets/promo-examples/') === 0 &&
  tq.params.author === '' && tq.params.authorTitle === '');
check('X.3 Testimonial: the real speakers are kept, the voice appended after them', tq.ev.speakers.length === R.speakers.length + 1 && tq.ev.speakers[0].id === 's1');
check('X.3 Testimonial on an event with no speakers: still an example voice', /^ex-p/.test(ex.fillFor('generic.testimonial', S, {}).params.speakerId));
if (REAL_POSTS) {
  var th = renderPost('generic.testimonial', tq.ev, tq.params);
  check('X.3 the Testimonial card names the example voice and no real speaker', th.indexOf(voice.name.replace(/"/g, '&quot;')) !== -1 && !R.speakers.some(function (s) { return th.indexOf(s.name) !== -1; }));
}

/* pure */
check('X.3 fillFor never changes the event or the options it is given', JSON.stringify(S) === JSON.stringify(sBefore) && JSON.stringify(R) === JSON.stringify(rBefore) && JSON.stringify(P0) === JSON.stringify(pBefore));
check('X.3 an unknown id, or no event: nothing filled', ex.fillFor('mailer.nope', S, {}).filled.length === 0 && ex.fillFor('mailer.speakers', null, {}).filled.length === 0 &&
  ex.fillFor('constructor', S, {}).filled.length === 0 && ex.fillFor('mailer.speakers', S, 'x').params !== 'x');

/* ---------- markers ---------- */
var mail = engine.renderDoc(engine.buildDoc(engine.getMailer('mailer.announcement'), R, {}), R);
var marked = ex.markMailHtml(mail, ['speakers', 'sponsors']);
var metaAt = marked.indexOf('<meta name="oneworld-example" content="speakers,sponsors">');
check('X.3 markMailHtml: the <meta> inside the <head>, after its charset, naming what was filled', metaAt > marked.indexOf('<meta charset') && metaAt < marked.indexOf('</head>') && marked.indexOf('<meta charset') > marked.indexOf('<head'));
check('X.3 markMailHtml: the visible row first in the <body>, in words', /<body[^>]*><div data-oneworld-example="1"[^>]*><strong[^>]*>EXAMPLE PREVIEW<\/strong> — the speakers and partners in this mail are examples<\/div>/.test(marked));
check('X.3 markMailHtml leaves the rest of the mail as it was', marked.replace(/<meta name="oneworld-example"[^>]*>/, '').replace(/<div data-oneworld-example="1"[\s\S]*?<\/div>/, '') === mail);
var post = '<!doctype html>\n<html><head><meta charset="utf-8">\n<style>x{}</style>\n</head>\n<body data-ratio="4:5">\n  <div class="canvas"></div>\n</body></html>';
var mp = ex.markPostHtml(post, ['speakers']);
check('X.3 markPostHtml: the <meta> at the end of the <head> and the corner ribbon, above every layer, last in the <body>',
  /<meta charset="utf-8">\n<style>x\{\}<\/style>\n<meta name="oneworld-example" content="speakers"><\/head>/.test(mp) &&
  /<div data-oneworld-example="1"[^>]*z-index:2147483647[^>]*>[\s\S]*>EXAMPLE<\/div><\/div><\/body><\/html>$/.test(mp) && mp.indexOf('<div class="canvas"></div>') < mp.indexOf('data-oneworld-example'));
check('X.3 the words for each kind of fill', ex._test.wordsFor(['speakers']) === 'speakers' && ex._test.wordsFor(['award']) === 'award facts' &&
  ex._test.wordsFor(['points', 'speakers', 'sponsors']) === 'discussion points, speakers and partners' && ex._test.wordsFor([]) === 'parts');
check('X.3 a document with no <head> or <body> is still marked', ex.isExample(ex.markMailHtml('<p>x</p>', ['speakers'])) && ex.isExample(ex.markPostHtml('<p>x</p>', ['quote'])));

/* ---------- X.4 isExample ---------- */
check('X.4 a picture address in the library', ex.isExample(BASE + '/assets/promo-examples/people/p01.jpg') && ex.isExample('/assets/promo-examples/logos/l03.png'));
check('X.4 …also URL-encoded (through the image proxy) or JSON-escaped', ex.isExample('/api/promo/image?url=https%3A%2F%2Fx%2Fassets%2Fpromo-examples%2Fpeople%2Fp01.jpg') &&
  ex.isExample('{"u":"https:\\/\\/x\\/assets\\/promo-examples\\/people\\/p01.jpg"}'));
check('X.4 an ex- id as a value, in JSON and in HTML', ex.isExample({ speakerIds: ['ex-p01'] }) && ex.isExample('{"id":"ex-l12"}') && ex.isExample('<div data-id="ex-s3">') &&
  ex.isExample("<div data-id='ex-p05'>") && ex.isExample('data-x=&quot;ex-p01&quot;') && ex.isExample('&#34;ex-l02&#34;'));
check('X.4 the meta marker and the visible label', ex.isExample('<meta name="oneworld-example" content="speakers">') && ex.isExample('<div data-oneworld-example="1">'));
check('X.4 …also quoted as JSON, HTML or a URL quote them, in any case, and a copy of only the body (the label)',
  ex.isExample({ html: '<meta name="oneworld-example" content="award">' }) && ex.isExample('{"h":"<meta name=\\"oneworld-example\\">"}') &&
  ex.isExample('&lt;meta name=&quot;oneworld-example&quot;&gt;') && ex.isExample("<META NAME='oneworld-example'>") && ex.isExample('<meta name=oneworld-example>') &&
  ex.isExample('%3Cmeta%20name%3D%22oneworld-example%22%3E') && ex.isExample({ html: '<div data-oneworld-example="1">x</div>' }) &&
  ex.isExample('<div data-oneworld-example = "1">'));
check('X.4 the bare word is not a marker: an event, a link or wording that happens to say "oneworld-example"',
  !ex.isExample({ blocks: [{ type: 'button', props: { href: 'https://revamp-cms--revamp-cms.us-east4.hosted.app/e/oneworld-example-day' } }] }) &&
  !ex.isExample({ blocks: [{ type: 'text', props: { html: 'Visit oneworld-example.com' } }] }) && !ex.isExample({ eventId: 'oneworld-example' }) &&
  !ex.isExample('<meta name="oneworld-example-day">') && !ex.isExample('<p class="oneworld-example">x</p>'));
check('X.4 a doc holding a marked preview\'s HTML in a raw block', ex.isExample({ blocks: [{ type: 'html', props: { html: marked } }] }));
check('X.4 an uploaded file (bytes) is read as text', ex.isExample(Buffer.from(marked, 'utf8')) && ex.isExample(new Uint8Array(Buffer.from('x "ex-p01" y'))) && !ex.isExample(Buffer.from(mail, 'utf8')));
var cyc = { a: { url: '/assets/promo-examples/people/p02.jpg' } }; cyc.self = cyc;
var cycOk = { a: 'nothing here' }; cycOk.self = cycOk;
check('X.4 a structure with a cycle is still searched', ex.isExample(cyc) && !ex.isExample(cycOk));
check('X.4 false on a real mail, a real doc and ordinary words', !ex.isExample(mail) && !ex.isExample(engine.buildDoc(engine.getMailer('mailer.speakers'), R, {})) &&
  !ex.isExample(R) && !ex.isExample('our ex-president spoke') && !ex.isExample('"ex-p1x"') && !ex.isExample('"ex-pert"') && !ex.isExample('Rex-p01') &&
  !ex.isExample('/assets/promo-example/x.png') && !ex.isExample('') && !ex.isExample(null) && !ex.isExample(42) && !ex.isExample(true));
check('X.4 EXAMPLE_PATH is the library\'s address', ex.EXAMPLE_PATH === '/assets/promo-examples/');

/* ---------- the picture script (tools/make-promo-examples.js): dry run only; its finishing on a made-up picture ---------- */
var SCRIPT = path.join(ROOT, 'tools', 'make-promo-examples.js');
var make = require(SCRIPT);
var env = Object.assign({}, process.env); delete env.GEMINI_API_KEY;
/* a hook that turns any network call into a loud failure, so "no request" is checked, not assumed */
var NO_NET = 'data:text/javascript,' + encodeURIComponent("import http from 'node:http'; import https from 'node:https'; import net from 'node:net';" +
  "const no = () => { process.stderr.write('NETWORK CALL\\n'); throw new Error('network'); };" +
  "http.request = http.get = https.request = https.get = net.connect = net.createConnection = no; globalThis.fetch = async () => no();");
var dry = spawnSync(process.execPath, ['--import', NO_NET, SCRIPT, '--dry-run'], { cwd: ROOT, env: env, encoding: 'utf8', timeout: 30000 });
var out = String(dry.stdout || '');
check('R1 script: --dry-run exits 0 with no key in the environment', dry.status === 0, [dry.status, String(dry.stderr || '').slice(0, 300)]);
check('R1 script: --dry-run prints the 24 prompts and their targets', (out.match(/^ {2}prompt: /mg) || []).length === 24 &&
  lib.people.concat(lib.partners).every(function (x) { return out.indexOf('  target: ' + (x.photo || x.logo).slice(1)) !== -1; }));
check('R1 script: --dry-run makes no request and writes nothing', !/NETWORK CALL/.test(String(dry.stderr)) && /no request was made and nothing was written/.test(out));
check('R1 script: without a key a run stops with a plain message (checked through its own function; never run here)',
  /GEMINI_API_KEY is not set/.test(make.keyProblem({})) && make.keyProblem({ GEMINI_API_KEY: '  ' }) !== '' && make.keyProblem({ GEMINI_API_KEY: 'k' }) === '' && !/env\.local/.test(make.keyProblem({})));
var code = fs.readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
check('R1 script: its code never looks for tools/.env.local or any env file', !/env\.local|\.env['"]|dotenv/.test(code));
check('R1 script: the image model and sharp are loaded only for a real run', !/^const (gemini|sharp) = require/m.test(code));
var jobs = make.jobs(lib);
check('R1 script: 24 jobs; p02-p12 use p01 as the reference (one tone), p01 none', jobs.length === 24 && jobs[0].id === 'p01' && jobs[0].reference === null &&
  jobs.filter(function (j) { return j.kind === 'person'; }).slice(1).every(function (j) { return j.reference === 'p01' && /matches the reference picture exactly/.test(j.prompt); }));
check('R1 script: portraits ask for one made-up Indian professional on a plain warm-grey ground, with the site pictures\' closing rule',
  jobs.filter(function (j) { return j.kind === 'person'; }).every(function (j) { return /ONE fictional Indian/.test(j.prompt) && /never a real, famous or named person/.test(j.prompt) && j.prompt.indexOf(make.imageTail()) !== -1; }) &&
  /warm-grey/.test(jobs[0].prompt));
check('R1 script: symbols are asked for with no letters and never a real brand; the name is not in the prompt',
  jobs.filter(function (j) { return j.kind === 'logo'; }).every(function (j) { return /no letters/.test(j.prompt) && /must not resemble any existing/.test(j.prompt) && j.prompt.indexOf(j.name) === -1 && j.prompt.indexOf(j.name.split(' ')[0]) === -1; }));
check('R1 script: 8 wide and 4 square logos', jobs.filter(function (j) { return j.shape === 'wide'; }).length === 8 && jobs.filter(function (j) { return j.shape === 'square'; }).length === 4);
check('R1 script: genders agree with the library', lib.people.every(function (p) { return make.PEOPLE_LOOKS[p.id.slice(3)].gender === p.gender; }));
var bad = false; try { make.select(jobs, ['p13']); } catch (e) { bad = true; }
check('R1 script: --only takes ids and groups, and refuses an unknown id', make.select(jobs, ['people']).length === 12 && make.select(jobs, ['l03', 'p01']).length === 2 && bad &&
  make.parseArgs(['--bogus']).error && make.parseArgs(['--only', 'p01', '--force']).force === true);

/* ---------- async: the script's picture finishing (sharp, a made-up mark) and X.2 the library's pictures ---------- */
var sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }
function edgesInked(raw, w, h) {
  /* trimmed: each outer row and column holds at least one pixel that is not fully transparent */
  function a(x, y) { return raw[(y * w + x) * 4 + 3]; }
  var top = false, bottom = false, left = false, right = false;
  for (var x = 0; x < w; x++) { if (a(x, 0)) top = true; if (a(x, h - 1)) bottom = true; }
  for (var y = 0; y < h; y++) { if (a(0, y)) left = true; if (a(w - 1, y)) right = true; }
  return top && bottom && left && right;
}
var asyncChecks = Promise.resolve();
if (!sharp) {
  check('sharp is available to check the pictures', false);
} else {
  var T = make.tools(sharp);
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#ffffff"/>' +
    '<circle cx="512" cy="512" r="200" fill="#2b2d8f"/><rect x="450" y="300" width="300" height="120" fill="#13b3a6"/></svg>';
  asyncChecks = sharp(Buffer.from(svg)).png().toBuffer().then(T.cutOut).then(function (mark) {
    return sharp(mark).raw().toBuffer({ resolveWithObject: true }).then(function (o) {
      check('R1 finishing: the white ground becomes transparent and the symbol is trimmed to its ink', o.info.channels === 4 && o.info.width < 500 && o.info.height < 500 &&
        edgesInked(o.data, o.info.width, o.info.height) && o.data[3] === 0, [o.info.width, o.info.height]);
      return Promise.all([T.lockup({ name: 'Quillora Analytics', shape: 'wide' }, mark), T.lockup({ name: 'Zorvic Networks', shape: 'square' }, mark)]);
    }).then(function (pair) {
      return Promise.all(pair.map(function (b) { return sharp(b).metadata(); }));
    }).then(function (m) {
      check('R1 finishing: a wide lock-up fits 900 × 300, a square one 600 × 600, both transparent PNG', m[0].format === 'png' && m[0].hasAlpha && m[0].width <= 900 && m[0].height <= 300 && m[0].width > m[0].height &&
        m[1].format === 'png' && m[1].hasAlpha && m[1].width <= 600 && m[1].height <= 600 && m[1].height > m[1].width, m.map(function (x) { return [x.width, x.height]; }));
      return sharp({ create: { width: 1024, height: 1100, channels: 3, background: '#cccccc' } }).png().toBuffer().then(T.portrait).then(function (b) { return sharp(b).metadata(); });
    }).then(function (pm) {
      check('R1 finishing: a portrait is kept as a 640 × 640 JPEG (mail cannot crop)', pm.format === 'jpeg' && pm.width === 640 && pm.height === 640);
    });
  }).then(function () {
    /* run() when p01 cannot be made: p02 fails alone ("no reference"), and the logo and the contact sheet are still
       made. The image call is a stand-in (no request, no key), and every picture goes to a temporary folder, never
       the library's. */
    var GEMINI = require.resolve(path.join(ROOT, 'functions', 'lib', 'gemini.js')), hadGemini = require.cache[GEMINI];
    var hadKey = process.env.GEMINI_API_KEY, asked = [], tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'promo-examples-run-'));
    var picked = jobs.filter(function (j) { return j.id === 'p01' || j.id === 'p02' || j.id === 'l01'; })
      .map(function (j) { return Object.assign({}, j, { target: path.join(tmp, path.basename(j.target)) }); });
    var p01Prompt = picked[0].prompt;
    function restore() {
      if (hadGemini) require.cache[GEMINI] = hadGemini; else delete require.cache[GEMINI];
      if (hadKey !== undefined) process.env.GEMINI_API_KEY = hadKey;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    return sharp(Buffer.from(svg)).png().toBuffer().then(function (symbol) {
      var stand = { callGeminiImage: function (prompt, opts) {
        asked.push(prompt === p01Prompt ? 'p01' : opts && opts.image ? 'with reference' : 'symbol');
        /* p01 is refused (a code that does not stop the run); a symbol is drawn */
        return Promise.resolve(prompt === p01Prompt ? { code: 'ai-blocked', error: 'refused (stand-in)' } : { base64: symbol.toString('base64') });
      } };
      require.cache[GEMINI] = { id: GEMINI, filename: GEMINI, loaded: true, children: [], paths: [], exports: stand };
      delete process.env.GEMINI_API_KEY;
      if (require(GEMINI) !== stand) { restore(); return check('R1 run: the image call is the stand-in', false); }
      var log = console.log, err = console.error, lines = [];
      console.log = console.error = function (s) { lines.push(String(s)); };
      return make._test.run(picked, { force: false, only: null, sheet: path.join(tmp, 'sheet.png') }, picked).then(function (code) {
        console.log = log; console.error = err;
        check('R1 run: p01 refused -> p02 fails alone ("no reference"), the logo and the contact sheet are still made, exit 1', code === 1 &&
          lines.some(function (l) { return l === 'Made 1, kept 0 already there, failed 2: p01, p02 (no reference).'; }) &&
          fs.existsSync(path.join(tmp, 'l01.png')) && fs.existsSync(path.join(tmp, 'sheet.png')) && !fs.existsSync(path.join(tmp, 'p02.jpg')) &&
          JSON.stringify(asked) === '["p01","symbol"]', [code, asked, lines.slice(-2)]);
      }, function (e) {
        console.log = log; console.error = err;
        check('R1 run: p01 refused does not end the run', false, String(e && e.message));
      }).then(restore, function (e) { restore(); throw e; });
    });
  }).then(function () {
    /* X.2 — the pictures R1 makes. Until R1 has run, these fail by design. */
    function r1check(name, ok, detail) { if (!ok) r1++; check('X.2 ' + name + (ok ? '' : ' (made by R1: node tools/make-promo-examples.js)'), ok, detail); }
    return lib.people.reduce(function (p, x) {
      return p.then(function () {
        var file = path.join(ROOT, x.photo);
        if (!fs.existsSync(file)) return r1check(x.photo + ' is there', false);
        return sharp(file).metadata().then(function (m) { r1check(x.photo + ' is a 640 × 640 JPEG', m.format === 'jpeg' && m.width === 640 && m.height === 640, [m.format, m.width, m.height]); });
      });
    }, Promise.resolve()).then(function () {
      return lib.partners.reduce(function (p, x) {
        return p.then(function () {
          var file = path.join(ROOT, x.logo);
          if (!fs.existsSync(file)) return r1check(x.logo + ' is there', false);
          return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(function (o) {
            return sharp(file).metadata().then(function (m) {
              r1check(x.logo + ' is a PNG with transparency, trimmed', m.format === 'png' && m.hasAlpha && edgesInked(o.data, o.info.width, o.info.height), [m.format, m.hasAlpha]);
            });
          });
        });
      }, Promise.resolve());
    });
  });
}

asyncChecks.then(function () {
  if (r1) console.log(r1 + ' of the failures are group X.2, the library\'s pictures: they pass once R1 (tools/make-promo-examples.js) has made them.');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error('FAIL the asynchronous checks threw — ' + (err && err.stack || err));
  process.exit(1);
});
