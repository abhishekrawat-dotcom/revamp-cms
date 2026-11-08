// node functions/lib/promo-ai.test.js — ETB2B AI in the social post and mailer editors, the server half
// (functions/lib/promo-ai.js, batch B18-ai; owner-decisions.md #9 and #10, promo-easy-edit/DESIGN.md section 3):
//   P.1  the post's or mail's state is cleaned to known shapes only
//   P.2  grounding: numbers only from the event's details, the post's words or the person's message; never another
//        event's name; the post's picture shape
//   P.3  the prompt: this event's facts and people only, the lock, the ET logo rule, never send / publish / download;
//        the answer's schema has no optional field (Claude's strict mode)
//   P.4  the answer, checked against the allow-list and this event's roster: words of a listed text, people by id of
//        the same kind, subject and preview cut, a caption for posts only, one post per speaker only where it can be,
//        a background through the picture rules; handoff; an edit with nothing left is a reply that says why
//   P.5  the route: fail closed (another page, another event, an event not in the person's list: no model call,
//        nothing kept), the turn kept with brain 'promo' and its intent, a handoff not kept, the picture step only for
//        a promo turn of this person, the outcome route only for promo turns, with a History line in Promotions
//   P.6  the other brains read a promo turn as one neutral line (lib/api.js chatHistoryText, lib/dash-bot.js)
// No network, no AI: the model, the event's facts and Firestore are stand-ins.
'use strict';
var path = require('path');
var promoAi = require('./promo-ai');
var promo = require('./promo');
var llm = require('./llm');
var chatPicture = require('./chat-picture');
var T = promoAi._test;

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function flush() { return new Promise(function (r) { setImmediate(r); }); }
async function settle(n) { for (var i = 0; i < (n || 8); i++) await flush(); }

/* ---------- an event, as lib/promo.js buildKit gives it ---------- */
var KIT = {
  event: { id: 'qa-ux-b18-ai-x', name: 'QA Retail Leaders Forum 2026', dateLabel: '12–13 March 2026', place: 'Mumbai', hashtag: '#RLF2026', siteUrl: 'https://x/e/qa-ux-b18-ai-x', published: false },
  content: {
    overview: 'Retail leaders meet in Mumbai.', audience: ['CIOs', 'Heads of retail'], topics: ['Omnichannel', 'AI in stores'],
    stats: [{ value: '300', label: 'delegates' }],
    speakers: [{ id: 'sp1', name: 'Asha Rao', designation: 'CIO', company: 'Shop Co' }, { id: 'sp2', name: 'Meera Iyer', designation: 'CTO', company: 'Mart Ltd' }],
    partners: [{ id: 'pa1', name: 'Acme Retail', tier: 'Gold' }],
    sessions: [{ id: 'se1', title: 'The future of stores', day: 'Day 1', start: '10:00', speakers: ['Asha Rao'] }]
  }
};
var ROSTER = T.rosterOf(KIT);
var FACTS = promo.factSheet(KIT);

/* ======== P.1 the state ======== */
var post = T.cleanState('post', {
  design: 'Speaker card', size: 'Instagram square 1080×1080', theme: 'light', width: 1080, height: 1350,
  words: [{ target: 'e1', name: 'Title', text: 'Meet our speaker' }, { target: 'e1', name: 'Dup', text: 'x' }, { target: 'bad target!', text: 'x' }, { target: 'e2', name: 'Date', text: '12 March 2026' }],
  people: [{ kind: 'speaker', id: 'sp1' }, { kind: 'alien', id: 'z' }],
  caption: { network: 'linkedin', text: 'Join us #RLF2026' }, perSpeaker: true, extra: 'dropped'
});
check('P.1 a post keeps its words (a repeated or odd target dropped), people of known kinds, caption, size and theme',
  same(post.words.map(function (w) { return w.target; }), ['e1', 'e2']) && post.people.length === 1 && post.people[0].target === '0' &&
  post.caption.network === 'linkedin' && post.width === 1080 && post.height === 1350 && post.theme === 'light' && post.perSpeaker === true && post.extra === undefined, post);
check('P.1 a caption for an unknown network is no caption', T.cleanState('post', { caption: { network: 'myspace', text: 'x' } }).caption === null);
var mail = T.cleanState('mail', {
  design: 'Save the date', subject: 'Join us', preview: 'In Mumbai',
  words: [{ target: 'b1|title', name: 'Heading · Title', text: '**Welcome**' }],
  people: [{ target: 'b2', kind: 'speakers', name: 'Speakers', max: 3, now: ['Asha Rao'] }, { target: 'b3', kind: 'focus', name: 'One speaker, large', now: [] }, { target: 'b4', kind: 'robots' }]
});
check('P.1 a mail keeps subject, preview, words and its people sections (focus holds one)', mail.subject === 'Join us' && mail.words.length === 1 &&
  mail.people.length === 2 && mail.people[1].max === 1 && mail.people[0].max === 3, mail);

/* ======== P.2 grounding ======== */
check('P.2 numbers are read as digit runs (1,500 is 1500)', same(T.numbersIn('12–13 March 2026, 1,500 seats'), ['12', '13', '2026', '1500']));
check('P.2 a number in the event\'s details is grounded', T.grounded('300 delegates on 12 March', FACTS));
check('P.2 a number nobody gave is not (no "500+ leaders")', !T.grounded('500+ leaders', FACTS + '\nMeet our speaker'));
check('P.2 words with no number are grounded', T.grounded('Meet the leaders of retail', ''));
var DOCS = [
  { id: 'qa-ux-b18-ai-x', data: { name: 'QA Retail Leaders Forum 2026' } },
  { id: 'autotech', data: { name: 'Autotech Summit 2026' } },
  { id: 'short', data: { name: 'Expo' } },
  { id: 'inside', data: { name: 'Retail Leaders' } }
];
var OTHER = T.otherNamesOf(DOCS, 'qa-ux-b18-ai-x');
check('P.2 another event\'s name is caught; a one-word name or one inside this event\'s own name is not', T.namesOther('See you at the Autotech Summit 2026!', OTHER) &&
  !T.namesOther('Expo hall', OTHER) && !T.namesOther('Retail Leaders meet here', OTHER), OTHER);
check('P.2 the picture shape follows the post', T.aspectOf(1080, 1080) === '1:1' && T.aspectOf(1080, 1350) === '4:5' && T.aspectOf(1080, 1920) === '9:16' &&
  T.aspectOf(1200, 675) === '16:9' && T.aspectOf(0, 0) === '1:1');

/* ======== P.3 the prompt and the schema ======== */
var CTX = { state: post, kit: KIT, roster: ROSTER, facts: FACTS, turns: [], message: 'Shorten the title', logoRule: 'ET LOGOS: only the black lettering may change.', otherNames: OTHER,
  sources: [FACTS, 'Meet our speaker', '12 March 2026', 'Shorten the title'].join('\n'), eventData: {} };
var prompt = T.buildPrompt(CTX);
check('P.3 the prompt names this event, its facts, its people with ids and the post\'s words by target',
  prompt.indexOf('QA Retail Leaders Forum 2026') !== -1 && prompt.indexOf('sp2 -> Meera Iyer') !== -1 && prompt.indexOf('pa1 -> Acme Retail') !== -1 && prompt.indexOf('[e1] Title: "Meet our speaker"') !== -1);
check('P.3 it is locked to this event, carries the ET logo rule, and never sends, publishes or downloads',
  /this event only/i.test(prompt) && prompt.indexOf('ET LOGOS') !== -1 && /never send, schedule, publish, delete or download/.test(prompt));
check('P.3 it says the event\'s Content is where people and Basics are changed', /Content in the event's console/.test(prompt));
check('P.3 no other event reaches the prompt', prompt.indexOf('Autotech') === -1);
check('P.3 per speaker is offered only when the post can have it', prompt.indexOf('One post per speaker: AVAILABLE') !== -1 &&
  T.buildPrompt(Object.assign({}, CTX, { state: Object.assign({}, post, { perSpeaker: false }) })).indexOf('NOT available') !== -1);
var schema = T.schemaFor(CTX);
function optionals(s) {
  var n = 0;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.type === 'OBJECT' && o.properties) { Object.keys(o.properties).forEach(function (k) { if ((o.required || []).indexOf(k) === -1) n++; walk(o.properties[k]); }); }
    if (o.type === 'ARRAY') walk(o.items);
  })(s);
  return n;
}
check('P.3 the schema has no optional field (strict mode)', optionals(schema) === 0, optionals(schema));
check('P.3 the schema limits targets to the post\'s own', same(schema.properties.words.items.properties.target.enum, ['e1', 'e2']) && same(schema.properties.people.items.properties.target.enum, ['0']));
var mailPrompt = T.buildPrompt(Object.assign({}, CTX, { state: mail }));
check('P.3 a mail\'s prompt has its subject, preview and people sections, and no caption', mailPrompt.indexOf('Subject: "Join us"') !== -1 && mailPrompt.indexOf('[b2] Speakers') !== -1 &&
  /caption: always ""/.test(mailPrompt));
check('P.3 the memory: this brain\'s turns in full, the others as one neutral line', (function () {
  var m = T.memoryText([{ brain: 'dash', question: 'how many registrations?', answer: 'SECRET 42' }, { brain: 'promo', question: 'Shorten it', answer: 'Done', status: 'undone', done: ['changed “Title”'] }]);
  return m.indexOf('SECRET') === -1 && m.indexOf('Elsewhere in this event they asked ETB2B AI: “how many registrations?”') !== -1 && /UNDONE/.test(m) && m.indexOf('User: Shorten it') !== -1;
})());

/* ======== P.4 the answer ======== */
function answer(parsed, ctx) { return T.cleanAnswer(parsed, ctx || CTX); }
function edit(o) {
  return Object.assign({ kind: 'edit', intent: 'shorten title', summary: 'Done.', words: [], people: [], subject: '', preview: '', caption: '', background: { make: false, scene: '', style: 'photo' }, perSpeaker: false }, o);
}
var a1 = answer(edit({ words: [{ target: 'e1', text: 'Meet Asha' }, { target: 'nope', text: 'x' }] }));
check('P.4 words for a listed text are kept; one for a text not on the post is left out and said', a1.kind === 'edit' && same(a1.changes.words, [{ target: 'e1', text: 'Meet Asha' }]) &&
  a1.skipped.length === 1 && /not on this social post/.test(a1.skipped[0]), a1);
var a2 = answer(edit({ words: [{ target: 'e1', text: '500+ leaders' }] }));
check('P.4 a number nobody gave is not written, and the answer says so instead of claiming it', a2.kind === 'reply' && a2.changes.words.length === 0 && /number that is not in the event/.test(a2.summary), a2);
var a3 = answer(edit({ words: [{ target: 'e1', text: 'As seen at Autotech Summit 2026' }] }));
check('P.4 words naming another event are not written', a3.kind === 'reply' && /another event/.test(a3.summary), a3);
var a4 = answer(edit({ people: [{ target: '0', ids: ['sp2'] }] }));
check('P.4 a speaker of this event goes in a speaker\'s place, by id', same(a4.changes.people, [{ target: '0', ids: ['sp2'] }]), a4.changes);
var a5 = answer(edit({ people: [{ target: '0', ids: ['pa1'] }, { target: '7', ids: ['sp2'] }] }));
check('P.4 a partner in a speaker\'s place, a place not on the post, or someone not in Content is left out', a5.kind === 'reply' && a5.changes.people.length === 0, a5);
var a6 = answer(edit({ people: [{ target: '0', ids: ['sp1'] }] }));
check('P.4 the person already there is no change', a6.kind === 'reply' && a6.changes.people.length === 0);
var a7 = answer(edit({ caption: 'Join us in Mumbai on 12 March #RLF2026', subject: 'nope' }));
check('P.4 a post gets a caption, never a subject', a7.changes.caption === 'Join us in Mumbai on 12 March #RLF2026' && a7.changes.subject === '' && a7.skipped.some(function (s) { return /subject or preview/.test(s); }), a7);
var a8 = answer(edit({ perSpeaker: true }));
check('P.4 one post per speaker where the post can have it', a8.changes.perSpeaker === true && a8.kind === 'edit');
var a9 = answer(edit({ perSpeaker: true }), Object.assign({}, CTX, { state: Object.assign({}, post, { perSpeaker: false }) }));
check('P.4 …and not where it cannot (said plainly)', a9.kind === 'reply' && /at least 2 speakers/.test(a9.summary), a9);
var a10 = answer(edit({ background: { make: true, scene: 'a calm conference hall at dusk', style: 'photo' } }));
check('P.4 a new background with a plain scene', a10.kind === 'edit' && a10.changes.background && a10.changes.background.scene === 'a calm conference hall at dusk', a10);
var a11 = answer(edit({ background: { make: true, scene: 'a poster that says Welcome', style: 'photo' } }));
check('P.4 a background with words in it is refused in the picture rules\' own sentence, said for the post', a11.kind === 'reply' && /never carry words/.test(a11.summary) && !/your site/.test(a11.summary), a11);
var m1 = answer(edit({ subject: 'Retail leaders meet in Mumbai on 12 March for two days of talks on the future of stores and AI', preview: 'Hear Asha Rao', people: [{ target: 'b2', ids: ['sp1', 'sp2', 'zz'] }, { target: 'b3', ids: ['sp2', 'sp1'] }] }),
  Object.assign({}, CTX, { state: mail }));
check('P.4 a mail\'s subject is cut at a word to 70, its preview kept, its people by id (unknown left out, focus one)',
  m1.changes.subject.length <= 70 && !/\s$/.test(m1.changes.subject) && m1.changes.preview === 'Hear Asha Rao' &&
  same(m1.changes.people, [{ target: 'b2', ids: ['sp1', 'sp2'] }, { target: 'b3', ids: ['sp2'] }]) && m1.skipped.some(function (s) { return /not in this event/.test(s); }), m1);
var m2 = answer(edit({ people: [{ target: 'b2', ids: ['sp1', 'sp2', 'sp1'] }] }), Object.assign({}, CTX, { state: Object.assign({}, mail, { people: [Object.assign({}, mail.people[0], { max: 1 })] }) }));
check('P.4 a section shows at most its limit', same(m2.changes.people, [{ target: 'b2', ids: ['sp1'] }]) && m2.skipped.some(function (s) { return /more people than/.test(s); }), m2);
var m3 = answer(edit({ caption: 'x', background: { make: true, scene: 'a hall', style: 'photo' }, perSpeaker: true }), Object.assign({}, CTX, { state: mail }));
check('P.4 a mail gets no caption, no new picture and no per-speaker posts', m3.kind === 'reply' && !m3.changes.caption && !m3.changes.background && !m3.changes.perSpeaker);
check('P.4 handoff passes nothing on', (function () { var h = answer({ kind: 'handoff', intent: 'open page', summary: 'x', words: [{ target: 'e1', text: 'y' }] }); return h.kind === 'handoff' && h.changes.words.length === 0 && h.summary === ''; })());
check('P.4 a reply keeps its words and changes nothing', (function () { var r = answer({ kind: 'reply', intent: 'question', summary: 'The title says Meet our speaker.', words: [{ target: 'e1', text: 'y' }] }); return r.kind === 'reply' && !T.hasChanges(r.changes) && /Meet our speaker/.test(r.summary); })());
check('P.4 an unknown kind is a reply', answer({ kind: 'delete', summary: 'ok' }).kind === 'reply');
check('P.4 intent: a short plain label, never a number', T.cleanIntent('Swap Speaker 2 to Asha!!') === 'swap speaker to asha' && T.cleanIntent('') === 'other' && T.cleanIntent('a b c d e f g') === 'a b c d e');
check('P.4 the picture side\'s sentences are said for the post, with the product\'s name', T.postWords('Nothing on your site changed. Tell the Revamp team.') === 'Nothing on your post changed. Tell the ETB2B EventSphere support team.');

/* ======== P.5 the route ======== */
function fakeFirestore() {
  var turns = {}, people = {}, seq = 0;
  function turnRef(uid, id) {
    return {
      id: id,
      set: function (v) { turns[uid + '/' + id] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); },
      get: function () { var v = turns[uid + '/' + id]; return Promise.resolve({ exists: !!v, data: function () { return v; } }); },
      update: function (p) { turns[uid + '/' + id] = Object.assign({}, turns[uid + '/' + id], JSON.parse(JSON.stringify(p))); return Promise.resolve(); }
    };
  }
  return {
    turns: turns, people: people,
    userRef: function (eventId, uid) {
      return {
        set: function (v) { people[eventId + '/' + uid] = v; return Promise.resolve(); },
        collection: function () {
          return {
            doc: function (id) { return turnRef(uid, id || ('T' + (++seq) + 'abcdefghijk')); },
            orderBy: function () { return { limit: function () { return { get: function () {
              var docs = Object.keys(turns).filter(function (k) { return k.indexOf(uid + '/') === 0; }).map(function (k) { return { id: k.split('/')[1], data: function () { return turns[k]; } }; });
              return Promise.resolve({ docs: docs.reverse() });
            } }; } }; }
          };
        }
      };
    }
  };
}
function harness(o) {
  o = o || {};
  var store = fakeFirestore(), sent = [], logs = [], rate = { ok: true };
  var H = {
    withAdminBody: function (req, res, max, cb) { cb({ db: {}, bucket: { name: 'b' } }, { uid: 'u1', email: 'asha.rao@timesinternet.in', name: 'Asha' }, req.body); },
    sendJson: function (res, status, body) { sent.push({ status: status, body: body }); },
    sendAiFailure: function (res, r) { sent.push({ status: r.status || 502, body: { error: r.error, code: r.code } }); },
    sendFailure: function (res, where, err) { sent.push({ status: 500, body: { error: String(err && err.message) } }); },
    BODY_LIMITS: { ai: 1, small: 1 },
    chatRateOk: function () { return rate.ok; },
    chatUid: function (d) { return d.uid; }, chatName: function (d) { return d.name; },
    chatUserRef: function (fb, eventId, uid) { return store.userRef(eventId, uid); },
    liveEventDocs: function () { return Promise.resolve(o.docs || DOCS); },
    logActivity: function (fb, eventId, d, action, detail, meta) { logs.push({ eventId: eventId, action: action, detail: detail, area: meta && meta.area }); },
    eventDocRef: function () { return {}; }, aiUsageRecorder: function () { return function () {}; }, isEventId: function (id) { return /^[a-z0-9-]+$/.test(id); },
    ET_LOGO_COLOUR_RULE: 'ET LOGOS: the red square never changes.'
  };
  promoAi.wire(H);
  return { store: store, sent: sent, logs: logs, rate: rate, H: H };
}
var calls = [];
var realKit = promo.buildKit, realCall = llm.callJson, realLeft = chatPicture.readLeft, realMake = chatPicture.make;
promo.buildKit = function () { return Promise.resolve(KIT); };
chatPicture.readLeft = function () { return Promise.resolve({ left: 5, perDay: 20, failedOut: false }); };
var nextParsed = null;
llm.callJson = function (p, s, opts) { calls.push({ prompt: p, schema: s, opts: opts }); return Promise.resolve({ parsed: nextParsed }); };
function req(body) { return { body: body }; }
var PLACE = { page: 'promotions', eventId: 'qa-ux-b18-ai-x', tab: 'posts' };
var STATE = { design: 'Speaker card', width: 1080, height: 1080, words: [{ target: 'e1', name: 'Title', text: 'Meet our speaker' }], people: [{ kind: 'speaker', id: 'sp1' }], perSpeaker: true };

(async function main() {
  var h = harness();
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'post', message: 'Shorten the title', place: { page: 'console', eventId: 'qa-ux-b18-ai-x' }, state: STATE }), {});
  await settle();
  check('P.5 FAIL CLOSED: not Promotions of this event — one fixed refusal, no model call, nothing kept',
    h.sent[0] && h.sent[0].body.kind === 'refuse' && h.sent[0].body.summary === promoAi.MSG.unconfirmed && calls.length === 0 && !Object.keys(h.store.turns).length, h.sent);
  h = harness();
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'post', message: 'Shorten the title', place: { page: 'promotions', eventId: 'autotech' }, state: STATE }), {});
  await settle();
  check('P.5 FAIL CLOSED: the page names another event', h.sent[0] && h.sent[0].body.kind === 'refuse' && calls.length === 0);
  h = harness({ docs: DOCS.slice(1) });
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'post', message: 'Shorten the title', place: PLACE, state: STATE }), {});
  await settle();
  check('P.5 FAIL CLOSED: an event not in the person\'s own live list', h.sent[0] && h.sent[0].body.kind === 'refuse' && calls.length === 0 && !Object.keys(h.store.turns).length);
  h = harness();
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'site', message: 'x', place: PLACE }), {});
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'post', message: '   ', place: PLACE }), {});
  promoAi.handleEdit(req({ eventId: 'Bad Id', editor: 'post', message: 'x', place: PLACE }), {});
  await settle();
  check('P.5 a bad request is refused before anything is spent', h.sent.length === 3 && h.sent.every(function (s) { return s.status === 400; }) && calls.length === 0, h.sent);
  h = harness(); h.rate.ok = false;
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'post', message: 'x', place: PLACE, state: STATE }), {});
  await settle();
  check('P.5 the shared rate bucket', h.sent[0] && h.sent[0].status === 429 && calls.length === 0);

  h = harness();
  nextParsed = edit({ intent: 'Shorten Title', summary: 'I shortened the title.', words: [{ target: 'e1', text: 'Meet Asha' }] });
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'post', message: 'Shorten the title', place: PLACE, state: STATE }), {});
  await settle();
  var out = h.sent[0] && h.sent[0].body, kept = h.store.turns[Object.keys(h.store.turns)[0]];
  check('P.5 one model call on route promo-edit, for this event', calls.length === 1 && calls[0].opts.route === 'promo-edit' && calls[0].opts.eventId === 'qa-ux-b18-ai-x');
  check('P.5 the answer: the change, its intent and turn', out && out.kind === 'edit' && out.intent === 'shorten title' && same(out.changes.words, [{ target: 'e1', text: 'Meet Asha' }]) && /^[A-Za-z0-9]{10,40}$/.test(out.turnId), out);
  check('P.5 the turn is kept in the event\'s conversation with brain promo, its intent and "applying"', kept && kept.brain === 'promo' && kept.editor === 'post' && kept.intent === 'shorten title' &&
    kept.status === 'applying' && kept.place.page === 'promotions' && kept.question === 'Shorten the title', kept);
  check('P.5 no History line until the browser says how it went', h.logs.length === 0);

  h = harness(); calls.length = 0;
  nextParsed = { kind: 'handoff', intent: 'open page', summary: '', words: [], people: [], subject: '', preview: '', caption: '', background: { make: false, scene: '', style: 'photo' }, perSpeaker: false };
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'post', message: 'how many registrations?', place: PLACE, state: STATE }), {});
  await settle();
  check('P.5 a handoff is answered and not kept (the events side keeps its own turn)', h.sent[0].body.kind === 'handoff' && !Object.keys(h.store.turns).length && h.logs.length === 0);

  h = harness();
  nextParsed = { kind: 'reply', intent: 'question', summary: 'The title says Meet our speaker.', words: [], people: [], subject: '', preview: '', caption: '', background: { make: false, scene: '', style: 'photo' }, perSpeaker: false };
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'post', message: 'what does the title say?', place: PLACE, state: STATE }), {});
  await settle();
  kept = h.store.turns[Object.keys(h.store.turns)[0]];
  check('P.5 a reply is kept "answered", with a History line in Promotions', kept && kept.status === 'answered' && h.logs.length === 1 && h.logs[0].area === 'promotions' &&
    /Asked ETB2B AI in the social post editor/.test(h.logs[0].detail), h.logs);

  h = harness();
  nextParsed = edit({ intent: 'new background', summary: 'Making a new background.', background: { make: true, scene: 'a calm conference hall at dusk', style: 'photo' } });
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', editor: 'post', message: 'new background: a calm conference hall at dusk', place: PLACE, state: Object.assign({}, STATE, { width: 1080, height: 1350 }) }), {});
  await settle();
  out = h.sent[0].body; kept = h.store.turns[Object.keys(h.store.turns)[0]];
  check('P.5 a background is asked for in the turn (the picture rules\' record), in the post\'s shape, for Promotions', out.newPicture && out.newPicture.pending === true &&
    kept.newPicture && kept.newPicture.placement === 'background' && kept.newPicture.aspect === '4:5' && kept.newPicture.area === 'promotions' &&
    kept.newPicture.ownerSubject === true && kept.newPicture.state === 'asked', kept && kept.newPicture);
  var made = [];
  chatPicture.make = function (deps, o) { made.push(o); return Promise.resolve({ status: 200, body: { url: 'https://storage.googleapis.com/b/events/qa-ux-b18-ai-x/generated/x.png' } }); };
  h.sent.length = 0;
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', step: 'picture', turnId: out.turnId }), {});
  await settle();
  check('P.5 the picture step makes the stored ask, for this person\'s own turn', made.length === 1 && made[0].turnRef.id === out.turnId && h.sent[0].status === 200 && /generated/.test(h.sent[0].body.url), h.sent);
  h.sent.length = 0;
  h.store.turns['u1/OTHERTURN12345'] = { brain: 'edit', newPicture: { subject: 'x', sectionId: 's' } };
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', step: 'picture', turnId: 'OTHERTURN12345' }), {});
  await settle();
  check('P.5 …never for the site editor\'s turn', h.sent[0].status === 404 && made.length === 1);
  chatPicture.make = function () { return Promise.resolve({ status: 502, body: { error: 'Nothing on your site changed — ask again.', code: 'ai-unavailable' } }); };
  h.sent.length = 0;
  promoAi.handleEdit(req({ eventId: 'qa-ux-b18-ai-x', step: 'picture', turnId: out.turnId }), {});
  await settle();
  check('P.5 a picture that failed is said for the post', h.sent[0].status === 502 && /your post/.test(h.sent[0].body.error), h.sent);

  /* the outcome */
  h = harness();
  h.store.turns['u1/PROMOTURN1234'] = { brain: 'promo', editor: 'mail', question: 'Write a subject', status: 'applying', done: [] };
  h.store.turns['u1/EDITTURN12345'] = { question: 'site', status: 'applying' };
  promoAi.handleTurn(req({ eventId: 'qa-ux-b18-ai-x', turnId: 'PROMOTURN1234', status: 'applied', done: ['Wrote the subject line'] }), {});
  promoAi.handleTurn(req({ eventId: 'qa-ux-b18-ai-x', turnId: 'EDITTURN12345', status: 'applied' }), {});
  promoAi.handleTurn(req({ eventId: 'qa-ux-b18-ai-x', turnId: 'PROMOTURN1234', status: 'answered' }), {});
  await settle();
  check('P.5 the outcome is kept on a promo turn, with a History line in Promotions', h.store.turns['u1/PROMOTURN1234'].status === 'applied' &&
    h.logs.length === 1 && h.logs[0].area === 'promotions' && /ETB2B AI changed a mail: “Write a subject” — Wrote the subject line/.test(h.logs[0].detail), h.logs);
  check('P.5 …never on another brain\'s turn, and only a known status', h.sent.some(function (s) { return s.status === 404; }) && h.sent.some(function (s) { return s.status === 400; }) &&
    h.store.turns['u1/EDITTURN12345'].status === 'applying');
  h.logs.length = 0;
  promoAi.handleTurn(req({ eventId: 'qa-ux-b18-ai-x', turnId: 'PROMOTURN1234', status: 'undone' }), {});
  await settle();
  check('P.5 an Undo keeps what had been done, and says so in the History', h.store.turns['u1/PROMOTURN1234'].status === 'undone' && same(h.store.turns['u1/PROMOTURN1234'].done, ['Wrote the subject line']) &&
    /Undid an ETB2B AI change to a mail/.test(h.logs[0].detail));

  /* ======== P.6 the other brains ======== */
  var api = require('./api');
  var hooks = api._testHooks || {};
  if (typeof hooks.chatHistoryText === 'function') {
    var line = hooks.chatHistoryText({ turns: [{ brain: 'promo', question: 'Write a subject', answer: 'SECRET' }] });
    check('P.6 the site editor reads a promo turn as one neutral line', /post or mailer editor: “Write a subject”/.test(line) && line.indexOf('SECRET') === -1, line);
  } else check('P.6 lib/api.js has its chat test hooks', false);
  if (typeof hooks.chatLastPicture === 'function') {
    check('P.6 a post\'s background is never the site editor\'s "last picture"', hooks.chatLastPicture([{ brain: 'promo', newPicture: { subject: 'x' } }]) === null);
  }

  /* the picture rules make a post's background in the post's own shape (lib/chat-picture.js POST_ASPECTS) */
  var np = { placement: 'background', subject: 'a calm conference hall at dusk', sectionName: 'Social post background', kind: 'subject', ownerSubject: true, aspect: '4:5', design: { mode: 'dark' } };
  var pp = chatPicture.promptFor(np, {});
  check('P.6 a post\'s background is asked for in its shape, never the section\'s 4:3', pp.indexOf('Portrait, 4:5.') !== -1 && pp.indexOf('Landscape, 4:3.') === -1, pp.slice(-300));
  check('P.6 …and a square or a story post too', chatPicture.promptFor(Object.assign({}, np, { aspect: '1:1' }), {}).indexOf('Square, 1:1.') !== -1 &&
    chatPicture.promptFor(Object.assign({}, np, { aspect: '9:16' }), {}).indexOf('Tall portrait, 9:16.') !== -1);
  check('P.6 a site section\'s picture is unchanged', chatPicture.promptFor(Object.assign({}, np, { aspect: undefined }), {}).indexOf('Landscape, 4:3.') !== -1);

  promo.buildKit = realKit; llm.callJson = realCall; chatPicture.readLeft = realLeft; chatPicture.make = realMake;
  console.log('promo-ai: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
  if (failed) process.exit(1);
})().catch(function (e) { console.error(e); process.exit(1); });
