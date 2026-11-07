/* node functions/lib/dash-bot-scope.test.js — ETB2B AI LOCKED TO THE EVENT the person is in (owner decision 10,
   8 Nov 2026, mandatory: "Once the user click edit icon from the dashboard, the AI will only refer to that event,
   reply for that event, will make changes in that event only").

   These checks try to break the lock through the real route (POST /api/dash-bot, lib/dash-bot.js handleChat),
   against an in-memory Firestore, with the model stubbed: every answer below is one a model could return, and the
   point of each check is that nothing about another event is shown, opened, listed, started or kept, whatever the
   model says. No AI call is made. They cover: another event's name or id in the message; "it" right after a
   question about another event; a model output that names another event in a token, its words, a list, an id or
   an action; a forged place; a page whose event the person cannot see (fail closed); attachments inside an event;
   and that the pages with no event keep the assistant for every event, as before. */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

/* ---------- an in-memory Firestore: documents by path, enough for the route ---------- */
var docs = {}, seq = 0;
function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
function docRef(p) {
  return { id: p.split('/').pop(), path: p,
    collection: function (n) { return colRef(p + '/' + n); },
    get: function () { return Promise.resolve(snap(p)); },
    set: function (data, o) {
      if (!(o && o.merge) || !docs[p]) docs[p] = (o && o.merge && docs[p]) || {};
      Object.keys(data).forEach(function (k) {
        var v = data[k];
        if (v && typeof v === 'object' && typeof v.operand === 'number') docs[p][k] = (+docs[p][k] || 0) + v.operand;
        else docs[p][k] = clone(v);
      });
      return Promise.resolve();
    },
    update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); Object.assign(docs[p], clone(data)); return Promise.resolve(); } };
}
function colRef(p, order, lim) {
  return { path: p,
    doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(16, '0')))); },
    orderBy: function (f, dir) { return colRef(p, { f: f, desc: dir === 'desc' }, lim); },
    limit: function (n) { return colRef(p, order, n); },
    get: function () {
      var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
      if (order) {
        list = list.filter(function (s) { return s.data()[order.f] !== undefined; });
        list.sort(function (a, b) { var x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (order.desc ? -1 : 1); });
      }
      if (lim) list = list.slice(0, lim);
      return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
    } };
}
var FB = { db: { collection: function (n) { return colRef(n); }, runTransaction: function (fn) {
  var writes = [];
  var tx = { get: function (ref) { return ref.get(); }, set: function (ref, d, o) { writes.push(function () { return ref.set(d, o); }); }, update: function (ref, d) { writes.push(function () { return ref.update(d); }); } };
  return Promise.resolve(fn(tx)).then(function (out) { return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return out; }); });
} } };
delete process.env.TRACK_SECRET; delete process.env.MAILER_TRACK_BASE; delete process.env.K_SERVICE;

/* the numbers, from the fixtures' own counters (as api-audience.js reads them when they are kept) */
var aud = require('./api-audience');
aud.insightTotals = function (fb, id, ev) {
  var c = ev && ev.counters || {};
  return Promise.resolve({ totals: { registrations: +c.registrations || 0, confirmed: +c.registrations || 0, waitlist: 0, pending: 0, cancelled: 0, checkedIn: 0 }, visits: { visitors: +c.views || 0, uniques: 0 } });
};

/* ---------- the model, stubbed: each check scripts the answer ---------- */
var llm = require('./llm');
var calls = [], answers = [];
llm.callJson = function (prompt, schema, opts) {
  calls.push({ prompt: prompt, opts: opts });
  return Promise.resolve({ parsed: answers.length ? answers.shift() : { kind: 'reply', text: 'Hello.' }, provider: 'claude', model: 'stub' });
};

/* ---------- lib/api.js's helpers, as it hands them over ---------- */
function sendJson(res, status, obj) { res.writeHead(status, {}); res.end(JSON.stringify(obj)); }
var activity = [];
var helpers = {
  withAdmin: function (req, res, cb) { cb(FB, { uid: 'u-pia', email: 'pia@timesinternet.in', name: 'Pia Sen' }); },
  withAdminBody: function (req, res, max, cb) { helpers.withAdmin(req, res, function (fb, d) { cb(fb, d, JSON.parse(req.rawBody || '{}')); }); },
  sendJson: sendJson,
  sendFailure: function (res, what, err) { console.error(what + ': ' + (err && err.stack || err)); sendJson(res, 500, { error: 'x' }); },
  sendAiFailure: function (res, r) { sendJson(res, r.status || 502, { error: r.error }); },
  BODY_LIMITS: { small: 256 * 1024, tiny: 16 * 1024, assist: 1024 * 1024 },
  chatRateOk: function () { return true; },
  chatUid: function (d) { return String(d.uid); },
  chatName: function (d) { return d.name; },
  approvalsConfig: function () { return Promise.resolve({ approvers: [], allowSelf: false, required: true }); },
  /* the events GET /api/events lists: live, named, not being discarded (what the person can see) */
  liveEventDocs: function () {
    return Promise.resolve(Object.keys(docs).filter(function (k) { return /^events\/[^/]+$/.test(k); }).map(function (k) { return { id: k.slice(7), data: clone(docs[k]) }; })
      .filter(function (d) { return !d.data.deletedAt && !d.data.discardingAt && typeof d.data.name === 'string' && d.data.name.trim() !== ''; }));
  },
  chatUserRef: function (fb, eventId, uid) { return fb.db.collection('events').doc(eventId).collection('aiChats').doc(uid); },
  logActivity: function (fb, eventId, by, action, detail) { activity.push({ eventId: eventId, detail: detail }); return Promise.resolve(true); }
};
var bot = require('./dash-bot');
bot.wire(helpers);
var T = bot._test;
var NOW = Date.UTC(2026, 10, 8, 6, 30);
T.clock.now = function () { return NOW; };

/* this event, another the person can see, and three they cannot (deleted, being discarded, no name) */
var MAIN = 'qa-ux-ai-scope-main', OTHER = 'qa-ux-ai-scope-other';
docs['events/' + MAIN] = { name: 'Retail Leadership Summit 2026', category: 'ip', portal: 'etretail', published: true, start: '2026-12-02T10:00', end: '2026-12-03T18:00', venue: 'Jio World Centre', city: 'Mumbai',
  createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', counters: { registrations: 42, views: 900, audienceV: 2 } };
docs['events/' + OTHER] = { name: 'CIO Awards Night 2026', category: 'awards', portal: 'etcio', published: true, start: '2026-11-20T18:00', venue: 'Taj Lands End', city: 'Mumbai',
  createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z', counters: { registrations: 977, views: 5100, audienceV: 2 } };
docs['events/qa-ux-ai-scope-gone'] = { name: 'Deleted Expo 2026', deletedAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z' };
docs['events/qa-ux-ai-scope-discarding'] = { name: 'Discarded Draft 2026', discardingAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-08-01T00:00:00.000Z' };
docs['events/qa-ux-ai-scope-noname'] = { name: '  ', createdAt: '2026-08-01T00:00:00.000Z' };

/* each message a second after the one before, so the conversation's order is the order asked */
function ask(message, place, extra) {
  NOW += 1000;
  return new Promise(function (resolve) {
    var body = Object.assign({ message: message, view: { working: 'etretail' } }, place === undefined ? {} : { place: place }, extra || {});
    var res = { writeHead: function (s) { res.status = s; }, end: function (b) { resolve({ status: res.status, body: JSON.parse(b) }); } };
    bot.handleChat({ method: 'POST', url: '/api/dash-bot', headers: {}, rawBody: JSON.stringify(body) }, res);
  });
}
function turnReport(body) {
  return new Promise(function (resolve) {
    var res = { writeHead: function (s) { res.status = s; }, end: function (b) { resolve({ status: res.status, body: JSON.parse(b) }); } };
    bot.handleTurn({ method: 'POST', url: '/api/dash-bot/turn', headers: {}, rawBody: JSON.stringify(body) }, res);
  });
}
function text(parts) { return (parts || []).map(function (p) { return p.t === 'event' ? p.name : p.v; }).join(''); }
function convOf(eventId) {
  var pre = 'events/' + eventId + '/aiChats/u-pia/turns/';
  return Object.keys(docs).filter(function (k) { return k.indexOf(pre) === 0; }).map(function (k) { return Object.assign({ id: k.split('/').pop() }, docs[k]); })
    .sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id < b.id ? -1 : 1); });
}
function written(prefix) { return Object.keys(docs).filter(function (k) { return k.indexOf(prefix) === 0; }); }
var SCOPED = 'I work on Retail Leadership Summit 2026 here only: use the events dashboard for other events, a new event or another portal.';
var CONSOLE = { page: 'console', eventId: MAIN, tab: 'content/speakers' };
var EDITOR = { page: 'editor', eventId: MAIN, tab: '' };
var PROMOS = { page: 'promotions', eventId: MAIN, tab: 'posts' };
/* nothing in an answer may name, link to or count the other event */
function leaks(body) { var s = JSON.stringify(body); return s.indexOf(OTHER) !== -1 || /CIO Awards/.test(s) || /977|5,100|5100/.test(s); }
function scoped(out) {
  var b = out.body || {};
  return out.status === 200 && b.kind === 'refuse' && text(b.parts) === SCOPED && !!b.action && b.action.type === 'refuse' && b.action.what === 'other-event' &&
    b.action.pointer && b.action.pointer.href === '/Event_Listing.html' && b.action.pointer.hrefLabel === 'Open the dashboard' && !b.list && !b.choices && !leaks(b);
}
var tk = function (f) { return '{{' + OTHER + (f ? '.' + f : '') + '}}'; };

(async function () {
  /* ===== S.1 what the model sees inside an event: this event alone ===== */
  answers.push({ kind: 'reply', events: [MAIN], text: '{{' + MAIN + '}} has {{' + MAIN + '.registrations}} registrations so far.' });
  var out = await ask('How many registrations does CIO Awards Night 2026 have, and ' + OTHER + '?', CONSOLE);
  var prompt = calls[calls.length - 1].prompt;
  var table = prompt.slice(prompt.indexOf('<<<EVENTS'), prompt.indexOf('>>>', prompt.indexOf('<<<EVENTS')));
  check('S.1 another event named in the message (its name and its id): the EVENTS table holds this event alone',
    table.split('\n').filter(function (l) { return /\|/.test(l); }).length === 1 && table.indexOf(MAIN + ' | Retail Leadership Summit 2026') !== -1 && table.indexOf(OTHER) === -1 && table.indexOf('CIO Awards') === -1, table);
  check('S.1 …the other event appears in the prompt only inside the person\'s own message, never as data', prompt.split(OTHER).length === 2 && prompt.split('CIO Awards').length === 2 &&
    prompt.indexOf('Taj Lands End') === -1 && prompt.indexOf('etcio') === -1, prompt.length);
  check('S.1 …the prompt says it works on this event only, and offers no list, new event, filter or portal', prompt.indexOf('Here you work on ONE event only, {{' + MAIN + '}}') !== -1 &&
    prompt.indexOf('- "create"') === -1 && prompt.indexOf('- "filter"') === -1 && prompt.indexOf('- "portal"') === -1 && prompt.indexOf('{{#count}}') === -1 && prompt.indexOf('ET PORTALS') === -1);
  check('S.1 …and the answer about this event is its own real number', out.status === 200 && out.body.kind === 'reply' && text(out.body.parts) === 'Retail Leadership Summit 2026 has 42 registrations so far.' && !leaks(out.body), out.body);

  /* ===== S.2 a model output that reaches another event, in every way: the scoped line, nothing else ===== */
  var BREAKS = [
    ['an id of another event in `events`', { kind: 'reply', events: [OTHER], text: 'It has registrations.' }, 'scope-other-id'],
    ['its name token', { kind: 'reply', events: [], text: tk() + ' is a good event.' }, 'scope-other-token'],
    ['its number token', { kind: 'reply', events: [MAIN], text: '{{' + MAIN + '}} has fewer registrations than ' + tk('registrations') + '.' }, 'scope-other-token'],
    ['its live-site token', { kind: 'reply', events: [MAIN], text: 'See ' + tk('site') + '.' }, 'scope-other-token'],
    ['its name in the model\'s own words', { kind: 'reply', events: [MAIN], text: 'CIO Awards Night 2026 is on another portal.' }, 'scope-named-other'],
    ['its name in another case and order of spaces', { kind: 'reply', events: [], text: 'cio  awards   NIGHT 2026 looks busy.' }, 'scope-named-other'],
    ['an id of a deleted event', { kind: 'reply', events: ['qa-ux-ai-scope-gone'], text: 'It was deleted.' }, 'scope-other-id'],
    ['a made-up id', { kind: 'reply', events: ['retail-leadership-summit'], text: 'Here.' }, 'scope-other-id'],
    ['open another event\'s editor', { kind: 'open', events: [OTHER], open: { target: 'editor', tab: '', carry: false }, text: 'Opening it.' }, 'scope-other-id'],
    ['open another event\'s live site', { kind: 'open', events: [OTHER], open: { target: 'live', tab: '', carry: false }, text: 'Opening it.' }, 'scope-other-id'],
    ['open Create Event', { kind: 'open', events: [], open: { target: 'create-event', tab: '', carry: false }, text: 'Opening it.' }, 'scope-all-events-page'],
    ['open Mailer performance (every event\'s mailers)', { kind: 'open', events: [], open: { target: 'mailer-performance', tab: '', carry: false }, text: 'Opening it.' }, 'scope-all-events-page'],
    ['promotions of another event', { kind: 'promo', events: [OTHER], promo: { post: 'generic.announcement', sitePost: '', mailer: '' }, text: 'Opening it.' }, 'scope-other-id'],
    ['a choice between this event and another', { kind: 'open', events: [MAIN, OTHER], open: { target: 'console', tab: '', carry: false }, text: 'Which one?' }, 'scope-other-id'],
    ['a list of events', { kind: 'reply', list: { title: '', statuses: [], site: '', when: 'starts', types: [], mine: false, portal: 'all', createdFrom: '', createdTo: '', startFrom: '2026-11-01', startTo: '2026-11-30', search: '', sort: '', dir: '', limit: 0 }, text: 'Here they are.' }, 'scope-list'],
    ['a count of events', { kind: 'reply', text: 'You have {{#count}} events.' }, 'scope-list'],
    ['a total over events', { kind: 'reply', text: 'Together they have {{#total.registrations}} registrations.' }, 'scope-list'],
    ['a new event', { kind: 'create', text: 'Starting Create Event.', create: { category: 'IP', method: '', name: 'Retail Next', client: '', dateMode: '', start: '', end: '', month: '', quarter: '', year: '', venue: '', city: 'Mumbai', portal: '', briefFromMessage: false, currentUrl: '', previousUrl: '', heroSubject: '', noHeroPicture: false, files: [] } }, 'scope-create'],
    ['a portal switch', { kind: 'portal', switchTo: { portal: 'etcio' }, text: 'Switching.' }, 'scope-portal'],
    ['a filter of the dashboard\'s list', { kind: 'filter', filter: { view: 'draft', search: '', types: [], mine: false, createdFrom: '', createdTo: '', startFrom: '', startTo: '', sort: '', dir: '', portal: '' }, text: 'Showing drafts.' }, 'scope-filter'],
    ['the model\'s own "other-event" refusal', { kind: 'refuse', refuse: { action: 'other-event' }, text: 'I cannot.' }, 'scope-other-event'],
    ['a name the model could not find', { kind: 'reply', notFound: 'CIO Awards', text: 'I could not find it.' }, 'scope-not-found'],
    ['a destructive kind naming another event', { kind: 'delete', events: [OTHER], text: 'Deleting it now.' }, 'scope-other-id'],
    ['a refusal pointing at another event', { kind: 'refuse', refuse: { action: 'publish' }, events: [OTHER], text: 'No.' }, 'scope-other-id']
  ];
  for (var br of BREAKS) {
    var beforeCalls = calls.length, beforeTurns = convOf(MAIN).length;
    answers.push(br[1]);
    out = await ask('Tell me about the CIO Awards Night 2026', CONSOLE);
    await tick();
    var kept = convOf(MAIN), last = kept[kept.length - 1];
    check('S.2 ' + br[0] + ': the scoped line with Open the dashboard, nothing of the other event shown', scoped(out) && out.body.notes.indexOf(br[2]) !== -1 && calls.length === beforeCalls + 1, out.body);
    check('S.2 ' + br[0] + ': kept in this event\'s conversation, as a refusal that names no event', kept.length === beforeTurns + 1 && last.dashKind === 'refuse' && last.status === 'refused' &&
      JSON.stringify(last.events) === '[]' && last.notes.indexOf('scope-locked') !== -1 && last.answerRaw.indexOf('{{' + MAIN + '}}') !== -1 && !leaks({ a: last.answer, r: last.answerRaw, p: last.parts, x: last.action }), last);
  }
  check('S.2 nothing at all was written under the other event (no conversation, no History line)', written('events/' + OTHER + '/').length === 0 && !activity.some(function (l) { return l.eventId !== MAIN; }), written('events/' + OTHER + '/'));

  /* ===== S.3 what stays possible: this event's numbers, pages, promotions, the dashboard, Undo, refusals ===== */
  answers.push({ kind: 'open', events: [MAIN], open: { target: 'content', tab: 'speakers', carry: false }, text: 'Opening speakers.' });
  out = await ask('Open the speakers', CONSOLE);
  check('S.3 this event\'s own page opens', out.body.kind === 'open' && out.body.action.type === 'navigate' && out.body.action.url === '/edit-event.html?event=' + MAIN + '#content/speakers' && out.body.action.eventId === MAIN, out.body.action);
  answers.push({ kind: 'open', events: [], open: { target: 'editor', tab: '', carry: false }, text: 'Opening it.' });
  out = await ask('Open the editor', PROMOS);
  check('S.3 …naming no event: this event (Promotions)', out.body.action && out.body.action.url === '/edit-event.html?event=' + MAIN + '#design/editor', out.body.action);
  answers.push({ kind: 'open', events: [], open: { target: 'activity-log', tab: '', carry: false }, text: 'Opening it.' });
  out = await ask('Open the activity log', CONSOLE);
  check('S.3 the Activity log is this event\'s, never every event\'s', out.body.action && out.body.action.url === '/activity-log.html?event=' + MAIN, out.body.action);
  answers.push({ kind: 'open', events: [], open: { target: 'dashboard', tab: '', carry: false }, text: 'Opening it.' });
  out = await ask('Take me back to the dashboard', CONSOLE);
  check('S.3 the dashboard, to leave this event', out.body.action && out.body.action.type === 'navigate' && out.body.action.url === '/Event_Listing.html' && out.body.action.label === 'the events dashboard', out.body.action);
  answers.push({ kind: 'promo', events: [MAIN], promo: { post: 'generic.announcement', sitePost: '', mailer: 'mailer.reminder' }, text: 'Opening them.' });
  out = await ask('Make a save-the-date post and a reminder mailer', CONSOLE);
  check('S.3 this event\'s promotions', out.body.action && out.body.action.url.indexOf('/marketing.html?event=' + MAIN + '&tab=posts') === 0, out.body.action);
  answers.push({ kind: 'refuse', refuse: { action: 'publish' }, events: [], text: 'No.' });
  out = await ask('Publish the site', CONSOLE);
  check('S.3 a refusal points at this event', out.body.kind === 'refuse' && out.body.action.what === 'publish' && out.body.action.pointer.href === '/edit-event.html?event=' + MAIN, out.body.action);
  answers.push({ kind: 'undo', text: '' });
  out = await ask('undo that', CONSOLE);
  check('S.3 Undo', out.body.kind === 'undo' && out.body.action.type === 'undo', out.body);
  answers.push({ kind: 'handoff', text: '' });
  out = await ask('make the hero darker', EDITOR);
  check('S.3 in the editor a change to the page still goes to the editor\'s own ETB2B AI (this site only)', out.body.kind === 'handoff', out.body);

  /* ===== S.4 "it" after talking about another event, through the stored conversation ===== */
  var Q = { page: 'registrations', eventId: MAIN, tab: '' };
  answers.push({ kind: 'reply', events: [OTHER], text: tk() + ' has ' + tk('registrations') + ' registrations so far.' });
  out = await ask('How many registrations does CIO Awards Night 2026 have?', Q);
  check('S.4 a question about another event: the scoped line', scoped(out), out.body);
  answers.push({ kind: 'reply', events: [MAIN], text: '{{' + MAIN + '}} has {{' + MAIN + '.visitors}} visitors so far.' });
  out = await ask('and its visitors?', Q);
  prompt = calls[calls.length - 1].prompt;
  check('S.4 "and its visitors?" right after it, answered about this event: the scoped line (its meant the other one)', scoped(out) && out.body.notes.indexOf('scope-follow-up') !== -1, out.body);
  /* the person's own words are theirs (they typed the other event's id in S.1); ETB2B AI's side never holds it */
  function aiSide(pr) { return pr.slice(pr.indexOf('THE CONVERSATION'), pr.indexOf('THE EVENT ')).split('\n').filter(function (l) { return !/^User: /.test(l); }).join('\n'); }
  check('S.4 …and the memory the model read held no other event\'s id on ETB2B AI\'s side', aiSide(prompt).indexOf(OTHER) === -1 && aiSide(prompt).indexOf('CIO Awards') === -1, aiSide(prompt).slice(0, 600));
  answers.push({ kind: 'reply', events: [OTHER], text: tk('visitors') + ' visitors.' });
  out = await ask('and when does it start?', Q);
  check('S.4 …a second follow-up answered about the other event: the scoped line', scoped(out), out.body);
  answers.push({ kind: 'reply', events: [MAIN], text: '{{' + MAIN + '}} has {{' + MAIN + '.visitors}} visitors so far.' });
  out = await ask('OK. How many visitors does this event have?', Q);
  check('S.4 …until the person names this event: its own real number', out.body.kind === 'reply' && text(out.body.parts) === 'Retail Leadership Summit 2026 has 900 visitors so far.', out.body);
  /* a turn kept before the lock, about the other event, in this event's own conversation */
  docs['events/' + MAIN + '/aiChats/u-pia/turns/preLock000000000001'] = { question: 'How is the CIO night doing?', answer: 'CIO Awards Night 2026 has 977 registrations so far.',
    answerRaw: tk() + ' has ' + tk('registrations') + ' registrations so far.', kind: 'reply', dashKind: 'open', status: 'done', events: [OTHER], brain: 'dash',
    action: { type: 'navigate', label: 'the editor of CIO Awards Night 2026', memo: 'the editor of ' + tk(), url: '/edit-event.html?event=' + OTHER + '#design/editor', eventId: OTHER },
    at: new Date(NOW + 500).toISOString(), updatedAt: new Date(NOW + 500).toISOString() };
  answers.push({ kind: 'open', events: [MAIN], open: { target: 'editor', tab: '', carry: false }, text: 'Opening it.' });
  out = await ask('open its editor', Q);
  prompt = calls[calls.length - 1].prompt;
  check('S.4 a turn from before the lock about another event: its id never reaches the model, its figure is withheld', aiSide(prompt).indexOf(OTHER) === -1 && aiSide(prompt).indexOf('977') === -1 && prompt.indexOf('another event has (withheld) registrations so far.') !== -1 && prompt.indexOf('the editor of another event') !== -1,
    prompt.slice(prompt.indexOf('THE CONVERSATION'), prompt.indexOf('THE CONVERSATION') + 900));
  check('S.4 …and "open its editor" right after it opens nothing: the scoped line', scoped(out) && out.body.notes.indexOf('scope-follow-up') !== -1, out.body);

  /* ===== S.5 a forged place, and FAIL CLOSED for an event the person cannot see ===== */
  var FAIL_CLOSED = [
    ['a deleted event', { page: 'console', eventId: 'qa-ux-ai-scope-gone' }],
    ['an event being discarded', { page: 'editor', eventId: 'qa-ux-ai-scope-discarding' }],
    ['an event with no name', { page: 'promotions', eventId: 'qa-ux-ai-scope-noname' }],
    ['an event that does not exist', { page: 'review', eventId: 'qa-ux-ai-scope-nowhere' }],
    ['an id in capitals', { page: 'console', eventId: MAIN.toUpperCase() }],
    ['an id with a path in it', { page: 'console', eventId: MAIN + '/../' + OTHER }],
    ['an id that is a list', { page: 'console', eventId: [MAIN] }],
    ['an id that is an object', { page: 'registrations', eventId: { id: MAIN } }],
    ['a page of one event with no event at all', { page: 'console' }],
    ['the editor with an empty event', { page: 'editor', eventId: '' }],
    ['the Activity log of a deleted event', { page: 'activity-log', eventId: 'qa-ux-ai-scope-gone' }]
  ];
  await tick();
  for (var fc of FAIL_CLOSED) {
    var c0 = calls.length, keys0 = Object.keys(docs).length, lines0 = activity.length;
    answers.push({ kind: 'reply', list: { title: '', statuses: [], site: '', when: '', types: [], mine: false, portal: 'all', createdFrom: '', createdTo: '', startFrom: '', startTo: '', search: 'CIO', sort: '', dir: '', limit: 0 }, text: 'Here are all your events.' });
    out = await ask('Which events are there? Show the CIO Awards', fc[1]);
    await tick();
    check('S.5 fail closed, ' + fc[0] + ': the fixed refusal, the model not asked, nothing kept, nothing about any event',
      out.status === 200 && out.body.kind === 'refuse' && text(out.body.parts) === T.MSG.unconfirmed && out.body.action.pointer.href === '/Event_Listing.html' && out.body.scope === 'none' &&
      !out.body.turnId && calls.length === c0 && Object.keys(docs).length === keys0 && activity.length === lines0 && !leaks(out.body) && out.body.parts.length === 1, [out.body, calls.length - c0]);
    answers.length = 0;
  }
  /* a forged place for an event the person can see is still locked to that one event, whatever else it carries */
  answers.push({ kind: 'reply', list: { title: '', statuses: [], site: '', when: '', types: [], mine: false, portal: 'all', createdFrom: '', createdTo: '', startFrom: '', startTo: '', search: '', sort: '', dir: '', limit: 0 }, text: 'Here they are.' });
  out = await ask('List all my events', { page: 'console', eventId: MAIN, tab: '', scope: 'all', locked: false, allEvents: true }, { eventId: OTHER, slug: OTHER, scope: 'global' });
  check('S.5 a place with extra fields (scope "all", locked false) and a top-level event id: still this event only', scoped(out) && calls[calls.length - 1].prompt.indexOf('Here you work on ONE event only, {{' + MAIN + '}}') !== -1 &&
    calls[calls.length - 1].prompt.indexOf(OTHER + ' |') === -1, out.body);
  /* "the dashboard" with an event in it keeps none: the dashboard is unchanged */
  answers.push({ kind: 'reply', list: { title: '', statuses: [], site: 'live', when: '', types: [], mine: false, portal: 'all', createdFrom: '', createdTo: '', startFrom: '', startTo: '', search: '', sort: '', dir: '', limit: 0 }, text: 'Here are your live sites.' });
  out = await ask('Which sites are live?', { page: 'dashboard', eventId: MAIN });
  var ids = (out.body.list && out.body.list.items || []).map(function (i) { return i.id; }).sort();
  check('S.5 the dashboard (even with an event in its place) keeps every event: the list has both', out.body.kind === 'reply' && JSON.stringify(ids) === JSON.stringify([OTHER, MAIN].sort()) && out.body.scope === 'global', [ids, out.body.scope]);
  answers.push({ kind: 'open', events: [OTHER], open: { target: 'editor', tab: '', carry: false }, text: 'Opening it.' });
  out = await ask('Open the CIO Awards Night editor', undefined);
  check('S.5 no place at all (a page from before the change) is the dashboard: any event opens, as before', out.body.action && out.body.action.url === '/edit-event.html?event=' + OTHER + '#design/editor', out.body.action);
  answers.push({ kind: 'reply', list: { title: '', statuses: [], site: 'live', when: '', types: [], mine: false, portal: 'all', createdFrom: '', createdTo: '', startFrom: '', startTo: '', search: '', sort: '', dir: '', limit: 0 }, text: 'Here are your live sites.' });
  out = await ask('Which sites are live?', { page: 'activity-log', eventId: '' });
  check('S.5 the all-events Activity log keeps every event too', out.body.kind === 'reply' && (out.body.list && out.body.list.count) === 2, out.body.list);
  answers.push({ kind: 'reply', text: 'Hello.' });
  out = await ask('Hello', { page: 'mailer-performance', eventId: MAIN });
  check('S.5 a page with no event (Mailer performance) never locks to an event in its place, nor fails closed', out.body.kind === 'reply' && out.body.scope === 'global' && calls[calls.length - 1].prompt.indexOf('ONE event only') === -1, out.body);

  /* ===== S.6 attachments inside an event never start a new event ===== */
  var PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  var logo = { n: 1, kind: 'image', name: 'logo.png', type: 'image/png', size: 2048, w: 300, h: 100, thumb: 'data:image/png;base64,' + PNG.toString('base64') };
  var brief = { n: 2, kind: 'text', name: 'brief.txt', type: 'text/plain', size: 60, text: 'Retail Next is a summit in Mumbai for retail leaders.' };
  answers.push({ kind: 'create', text: 'Starting Create Event.', create: { category: 'IP', method: 'brief', name: 'Retail Next', client: '', dateMode: '', start: '', end: '', month: '', quarter: '', year: '', venue: '', city: 'Mumbai', portal: '', briefFromMessage: false, currentUrl: '', previousUrl: '', heroSubject: '', noHeroPicture: false, files: [{ n: 1, role: 'logo' }, { n: 2, role: 'brief' }] } });
  out = await ask('Start a new event called Retail Next in Mumbai with this logo and brief', CONSOLE, { attachments: [logo, brief] });
  prompt = calls[calls.length - 1].prompt;
  var keptT = convOf(MAIN).filter(function (t) { return t.id === out.body.turnId; })[0];
  check('S.6 a new event with a logo and a brief inside an event: the scoped line, nothing for Create Event', scoped(out) && !out.body.action.files && !out.body.action.prefill && JSON.stringify(out.body).indexOf('create-event') === -1, out.body);
  check('S.6 …the brief was never shown to the model (only pictures are, inside an event), and no file roles were offered', prompt.indexOf('Retail Next is a summit') === -1 && prompt.indexOf('- files: one entry') === -1 && prompt.indexOf('never used for another event or a new one') !== -1);
  check('S.6 …and the turn keeps the files as used for nothing', keptT && keptT.attachments.every(function (a) { return a.role === 'none'; }), keptT && keptT.attachments);

  /* ===== S.7 the turn route stays in the conversation that kept the turn ===== */
  var r = await turnReport({ turnId: out.body.turnId, status: 'done', eventId: OTHER });
  check('S.7 a report of this event\'s turn sent with another event\'s id is not found there, and writes nothing there', r.status === 404 && written('events/' + OTHER + '/').length === 0, r);
  check('S.7 the History lines were all this event\'s', activity.length > 0 && activity.every(function (l) { return l.eventId === MAIN; }), activity.map(function (l) { return l.eventId; }));

  /* ===== S.8 the pure parts ===== */
  check('S.8 onlyThisEvent: other tokens are "another event" and "(withheld)", this event\'s stay', T.onlyThisEvent('{{a-1}} and {{b-2}} has {{b-2.registrations}}; {{a-1.visitors}} {{#count}}', 'a-1') === '{{a-1}} and another event has (withheld); {{a-1.visitors}} {{#count}}');
  check('S.8 followsElsewhere: after a turn naming another event, or the scoped line; never after an editor turn or this event\'s own',
    T.followsElsewhere([{ brain: 'dash', events: ['b'] }], 'a') && T.followsElsewhere([{ brain: 'dash', events: [], notes: ['scope-locked'] }], 'a') &&
    !T.followsElsewhere([{ brain: 'dash', events: ['a'] }], 'a') && !T.followsElsewhere([{ kind: 'edit', brain: 'edit', events: ['b'] }], 'a') && !T.followsElsewhere([], 'a'));
  check('S.8 "other-event" is in the schema\'s refusals and "dashboard" in its targets', T.SCHEMA.properties.refuse.properties.action.enum.indexOf('other-event') !== -1 && T.SCHEMA.properties.open.properties.target.enum.indexOf('dashboard') !== -1);
  check('S.8 the product\'s own lines never name the old product', !/Oneworld|Revamp CMS/.test(T.MSG.scopedBefore + T.MSG.scopedAfter + T.MSG.unconfirmed));

  out = await ask(new Array(4100).join('x'), CONSOLE);
  var outD = await ask(new Array(4100).join('x'), { page: 'dashboard' });
  check('S.8 a message too long inside an event: the sentence offers no new event; on the dashboard it still does', out.status === 400 && out.body.code === 'too-long' &&
    out.body.error === 'Keep the message under 4,000 characters.' && outD.status === 400 && /start a new event from a brief/.test(outD.body.error), [out.body, outD.body]);

  console.log('dash-bot-scope: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
