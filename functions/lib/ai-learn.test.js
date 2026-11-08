/* node functions/lib/ai-learn.test.js — ETB2B AI learns from what people ask it (owner decision 11): the record, the
   approvers' report and the QA notes (lib/ai-learn.js), and how both brains and the pages feed them.
     L.1  stripping: e-mails, phones, links, every event's name and id ("this event" / "another event" / "an event");
          dates and years are not phones (owner rule 10: an entry inside an event never names another event)
     L.2  the intent label: the brain's own words, cleaned (no number, name or address), or what it did
     L.3  what each brain did and how it ended (dashFacts, editFacts, outcomeOf)
     L.4  an entry: who, where, the test flag (qa- events and the QA agent), ageing out, the ring that bounds it
     L.5  through the real router, the dash brain: one entry per AI turn with the model's intent and stripped words;
          the answer is the same as without the record; a handoff, a fail-closed refusal and the daily limit are no
          entries; an AI failure is an "error"; /turn done and undone (how soon, and a QA note)
     L.6  through the real router, the site editor's brain: pending, then applied / undone from /api/chat/turn, and only
          the reporter's own turn
     L.7  a message saying something is not working is a QA note (a fixed word match)
     L.8  POST /api/ai-qa/note: signed-in only, page errors only, deduplicated, rate-limited, size-capped, the asked
          words stripped, an event that is gone left out
     L.9  the throttle (noteGate) and the grouping (groupOf)
     L.10 the report: approvers only (403 for anybody else, by lib/access.js's rule), the range, top requests, gaps,
          got it wrong, QA groups; names masked by default and e-mails always; test entries left out and counted;
          marking a group resolved, and a later note showing it back
     L.11 the assistant's page-error reporter (etb2b-assistant.js) in a vm: once per fault, at most five, never after
          a refusal or a failure, nothing signed out, never a loop
   An in-memory Firestore, the model scripted (no AI call), made-up tokens. Exits 1 on any failure. */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 900) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }

/* ---------- an in-memory Firestore: paths, merge, increments, where (==, >=, <), orderBy, limit, select, add,
   getAll, batch deletes and transactions that write at the end ---------- */
function fakeFb() {
  var docs = {}, seq = 0;
  function isInc(v) { return !!v && typeof v === 'object' && typeof v.operand === 'number'; }
  function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && !isInc(v) && !(v instanceof Date); }
  function write(target, data, merge) {
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      if (isInc(v)) target[k] = (typeof target[k] === 'number' ? target[k] : 0) + v.operand;
      else if (merge && isPlain(v)) { if (!isPlain(target[k])) target[k] = {}; write(target[k], v, true); }
      else target[k] = v instanceof Date ? new Date(v.getTime()) : clone(v);
    });
  }
  function putPath(doc, key, v) {
    var parts = key.split('.'), o = doc;
    for (var i = 0; i < parts.length - 1; i++) { if (!isPlain(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
    var last = parts[parts.length - 1];
    if (isInc(v)) o[last] = (typeof o[last] === 'number' ? o[last] : 0) + v.operand; else o[last] = clone(v);
  }
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? Object.assign({}, clone(d), d.expireAt instanceof Date ? { expireAt: d.expireAt } : {}) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) {
        var merge = !!(o && o.merge);
        if (!merge || !docs[p]) docs[p] = merge && docs[p] ? docs[p] : {};
        write(docs[p], data, merge);
        return Promise.resolve();
      },
      update: function (data) {
        if (!docs[p]) return Promise.reject(new Error('NOT_FOUND'));
        Object.keys(data).forEach(function (k) { putPath(docs[p], k, data[k]); });
        return Promise.resolve();
      },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p, q) {
    q = q || { wh: [], order: null, lim: 0 };
    function next(change) { return colRef(p, Object.assign({}, q, change)); }
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(16, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(16, '0')); docs[r.path] = {}; write(docs[r.path], data, false); return Promise.resolve(r); },
      where: function (f, op, v) { return next({ wh: q.wh.concat([[f, op, v]]) }); },
      orderBy: function (f, dir) { return next({ order: { f: f, desc: dir === 'desc' } }); },
      limit: function (n) { return next({ lim: n }); },
      select: function () { return next({}); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        list = list.filter(function (s) {
          var d = s.data();
          return q.wh.every(function (w) { var x = d[w[0]]; return w[1] === '==' ? x === w[2] : w[1] === '>=' ? x !== undefined && x >= w[2] : w[1] === '<' ? x !== undefined && x < w[2] : false; });
        });
        if (q.order) {
          var o = q.order;
          list = list.filter(function (s) { return s.data()[o.f] !== undefined; });
          list.sort(function (a, b) { var x = a.data()[o.f], y = b.data()[o.f]; return (x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) * (o.desc ? -1 : 1); });
        }
        if (q.lim) list = list.slice(0, q.lim);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
      } };
  }
  /* transactions one after another, as Firestore's serializable transactions behave for one document */
  var txQueue = Promise.resolve();
  function runTransaction(fn) {
    var run = txQueue.then(function () { return runOne(fn); });
    txQueue = run.then(null, function () {});
    return run;
  }
  function runOne(fn) {
    var writes = [];
    var tx = {
      get: function (ref) { return ref.get(); },
      set: function (ref, data, o) { writes.push(function () { return ref.set(data, o); }); return tx; },
      update: function (ref, data) { writes.push(function () { return ref.update(data); }); return tx; }
    };
    return Promise.resolve(fn(tx)).then(function (out) {
      return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return out; });
    });
  }
  var db = { collection: function (n) { return colRef(n); }, runTransaction: runTransaction,
    getAll: function () { return Promise.all(Array.prototype.slice.call(arguments).map(function (r) { return r.get(); })); },
    batch: function () { var del = []; return { delete: function (r) { del.push(r); }, commit: function () { return Promise.all(del.map(function (r) { return r.delete(); })); } }; } };
  /* tokens: "asha" is asha@timesinternet.in (uid u-asha, named Asha Rao), "qa-agent" is the QA agent */
  return { db: db, bucket: { name: 'test-bucket' }, docs: docs,
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: t === 'qa-agent' ? 'qa-agent' : 'u-' + t, name: t === 'asha' ? 'Asha Rao' : t === 'ravi' ? 'Ravi Iyer' : '', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
delete process.env.TRACK_SECRET; delete process.env.MAILER_TRACK_BASE;

/* ---------- the model, scripted per route; every prompt kept ---------- */
var llm = require('./llm');
var calls = [], scripted = { 'dash-bot': [], 'chat-edit': [] };
llm.callJson = function (prompt, schema, opts) {
  var route = (opts && opts.route) || '';
  calls.push({ route: route, prompt: prompt, schema: schema });
  var next = (scripted[route] || []).shift();
  if (!next) return Promise.resolve({ error: 'The AI service is not answering right now.', code: 'ai-unavailable', status: 502 });
  return Promise.resolve({ parsed: next, provider: 'claude', model: 'claude-stub' });
};
function editAnswer(o) { return Object.assign({ kind: 'reply', summary: '', design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [], goTo: '', intent: '' }, o || {}); }

var api = require('./api');
var L = require('./ai-learn');
var T = L._test;

function call(method, url, body, who, headers) {
  return new Promise(function (resolve) {
    var h = Object.assign({ host: 'localhost', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }, headers || {});
    if (who !== null) h.authorization = 'Bearer ' + (who || 'asha');
    var req = { method: method, url: url, headers: h, socket: {}, rawBody: Buffer.from(body === undefined ? '' : JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, hh) { res.statusCode = s; Object.assign(res.headers, hh || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b === undefined ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j }); } };
    api.handleApi(req, res);
  });
}
function under(prefix) {
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf('/') === -1; })
    .map(function (k) { return Object.assign({ id: k.split('/').pop(), path: k }, FB.docs[k]); })
    .sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
}
function entries() { return under('aiRecord/'); }
function notes() { return under('aiQaNotes/'); }
function entryOfTurn(brain, id) { return entries().filter(function (e) { return e.turnKey === brain + ':' + id; })[0]; }

/* the events: two real-looking ones (the team's numbers) and a qa- one (left out of them) */
var AUTO = 'autotech-summit-2026', RETAIL = 'retail-leaders-2026', QAEV = 'qa-learn-test';
FB.docs['events/' + AUTO] = { name: 'Autotech Summit 2026', category: 'ip', published: true, start: '2099-11-25T09:00', city: 'Pune', portal: 'auto',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z', counters: { registrations: 42, views: 900, audienceV: 2 } };
FB.docs['events/' + RETAIL] = { name: 'Retail Leaders Forum', category: 'ip', published: false, start: '2099-12-02T09:00', city: 'Mumbai', portal: 'retail',
  createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z', counters: { registrations: 7, audienceV: 2 } };
FB.docs['events/' + QAEV] = { name: 'QA Learn Test', category: 'ip', published: false, createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' };
var KNOWN = [{ id: AUTO, name: 'Autotech Summit 2026' }, { id: RETAIL, name: 'Retail Leaders Forum' }, { id: QAEV, name: 'QA Learn Test' }];
var SECTIONS = [{ id: 'hero', name: 'Hero', texts: ['Autotech Summit 2026'] }, { id: 'overview', name: 'Overview', texts: ['Where mobility meets'] }];

(async function () {
  /* ===== L.1 stripping ===== */
  var s1 = T.strip('Open the Retail Leaders Forum speakers, mail priya.sharma@timesinternet.in or call +91 98765 43210, see https://x.example/e/retail-leaders-2026?token=abc', { known: KNOWN, hereId: AUTO });
  check('L.1 inside an event: e-mails, phones and links out, another event\'s name is "another event"', s1 === 'Open the another event speakers, mail [email] or call [phone], see [link]', s1);
  check('L.1 …its id too, and this event\'s own name and id are "this event"',
    T.strip('compare retail-leaders-2026 with Autotech Summit 2026 and autotech-summit-2026', { known: KNOWN, hereId: AUTO }) === 'compare another event with this event and this event');
  check('L.1 …a name without its year is still that event ("Autotech Summit")', T.strip('make the Autotech Summit banner red', { known: KNOWN, hereId: RETAIL }) === 'make the another event banner red');
  check('L.1 on a page with no event every event is "an event"', T.strip('open Retail Leaders Forum and Autotech Summit 2026', { known: KNOWN }) === 'open an event and an event');
  check('L.1 dates, years and small numbers are not phones', T.strip('move it to 2026-11-08, or 12.11.2026; the 2025 2026 editions; 120 seats at 10 30', {}) === 'move it to 2026-11-08, or 12.11.2026; the 2025 2026 editions; 120 seats at 10 30');
  check('L.1 phones written other ways are', ['022-2345-6789', '(022) 23456789', '9876543210', '+44 20 7946 0958'].every(function (p) { return T.strip('call ' + p, {}) === 'call [phone]'; }));
  var WORDS = [{ id: 'cio', name: 'ET CIO Annual 2026' }, { id: 'x-y', name: 'Forum' }, { id: 'awards-2026', name: 'ET Awards 2026' }, { id: 'auto-1', name: 'Autotech 2026' }];
  check('L.1 an ordinary word is never taken for an event: a one-word id ("cio"), a short one-word name, "Awards" of "ET Awards 2026"',
    T.strip('add the awards section and the cio panel to the forum page', { known: WORDS }) === 'add the awards section and the cio panel to the forum page' && T.nameVariants('Forum').length === 0);
  check('L.1 …while a long one ("Autotech" of "Autotech 2026") is that event', T.strip('open autotech speakers', { known: WORDS }) === 'open an event speakers');
  check('L.1 at most 300 characters are kept', T.strip(new Array(400).join('ab '), {}).length === 300);

  /* ===== L.2 the intent ===== */
  check('L.2 the brain\'s label, cleaned: lower case, no numbers, no event name', T.cleanIntent('Shorten the Autotech Summit 2026 title to 3 words', { known: KNOWN }) === 'shorten title words');
  check('L.2 …at most five words', T.cleanIntent('add swap move shorten rewrite translate fix', {}).split(' ').length === 5);
  check('L.2 "new event" and "send email" are kinds of request, kept', T.cleanIntent('create new event', {}) === 'create new event' && T.cleanIntent('send email', {}) === 'send email');
  check('L.2 nothing left: the entry uses what the brain did', T.entryOf({ intent: '{{x}} 42 !!', fallback: 'open promotions', words: 'x' }, Date.now()).intent === 'open promotions');

  /* ===== L.3 what each brain did and how it ended ===== */
  var f = L.dashFacts({ kind: 'open', action: { type: 'navigate', url: '/edit-event.html?event=' + AUTO + '#content/speakers', target: 'content', label: 'Autotech Summit 2026: Speakers' }, notes: [] });
  check('L.3 dash open: done, the page and tab as target, never the label (it names the event)', f.outcome === 'done' && f.did.kind === 'open' && f.did.target === 'content:content/speakers' && JSON.stringify(f).indexOf('Autotech') === -1, f);
  f = L.dashFacts({ kind: 'promo', action: { type: 'navigate', url: '/marketing.html?event=x&tab=posts&template=social.save-date', target: 'promotions' } });
  check('L.3 dash promotions: the template as target', f.did.target === 'promotions:social.save-date' && f.outcome === 'done', f);
  f = L.dashFacts({ kind: 'refuse', action: { type: 'refuse', what: 'delete' } });
  check('L.3 dash refusal: refused, and which rule', f.outcome === 'refused' && f.rule === 'delete', f);
  f = L.dashFacts({ kind: 'refuse', action: { type: 'refuse', what: 'other-event' }, notes: ['scope-locked', 'scope-named-other'] });
  check('L.3 …the event lock (owner decision 10) is the rule "other-event"', f.outcome === 'refused' && f.rule === 'other-event');
  check('L.3 dash reply that found no event: could not do', L.dashFacts({ kind: 'reply', notes: ['not-found'] }).outcome === 'could-not' && L.dashFacts({ kind: 'reply', notes: [] }).outcome === 'answered');
  f = L.editFacts({ kind: 'edit', design: { primary: '#000000' }, textEdits: [{ sectionId: 'hero' }], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [] });
  check('L.3 editor change: pending until the editor reports it, and the parts it changes', f.outcome === 'pending' && f.did.target === 'design,text', f);
  check('L.3 editor reply sending the person to Content: could not do', L.editFacts({ kind: 'reply', goTo: 'content:speakers' }).outcome === 'could-not' && L.editFacts({ kind: 'reply', goTo: 'content:speakers' }).rule === 'sent to content:speakers');
  check('L.3 editor picture it would not make: refused (picture)', L.editFacts({ kind: 'reply' }, { pictureRefused: true }).rule === 'picture');
  check('L.3 reports: the editor\'s applied/partly/failed/undone/stopped, the dash brain\'s done/undone/failed/stopped',
    same(['applied', 'partly', 'failed', 'undone', 'stopped', 'answered'].map(function (x) { return T.outcomeOf('edit', x); }), ['done', 'partly', 'failed', 'undone', 'stopped', '']) &&
    same(['done', 'undone', 'failed', 'stopped', 'applied'].map(function (x) { return T.outcomeOf('dash', x); }), ['done', 'undone', 'failed', 'stopped', '']));
  check('L.3 …a dash action the page refused for being about another event is a refusal', T.outcomeOf('dash', 'failed', 'about another event') === 'refused');

  /* ===== L.4 an entry ===== */
  var now0 = Date.parse('2026-11-08T10:00:00.000Z');
  var e0 = T.entryOf({ brain: 'edit', decoded: { uid: 'u-ravi', email: 'ravi@timesinternet.in', name: '' }, eventId: AUTO, eventName: 'Autotech Summit 2026', page: 'editor',
    intent: 'swap banner', words: 'swap the banner, it is broken; ask ravi@timesinternet.in', did: { kind: 'edit', target: 'design' }, outcome: 'pending', turnId: 'Abcdefghij12', known: KNOWN }, now0);
  check('L.4 the entry: brain, person (a name that is an address is masked), event, page, intent, words, outcome, turn key',
    e0.brain === 'edit' && e0.uid === 'u-ravi' && e0.name === 'r***@timesinternet.in' && e0.eventId === AUTO && e0.page === 'editor' && e0.intent === 'swap banner' &&
    e0.words === 'swap the banner, it is broken; ask [email]' && e0.outcome === 'pending' && e0.turnKey === 'edit:Abcdefghij12' && e0.test === false && e0.complaint === true, e0);
  check('L.4 it ages out: expireAt is 180 days on', e0.expireAt instanceof Date && e0.expireAt.getTime() - now0 === 180 * 86400000);
  check('L.4 a qa- event, or the QA agent, is a test entry', T.entryOf({ eventId: QAEV, decoded: { uid: 'u-asha', email: 'asha@timesinternet.in' } }, now0).test === true &&
    T.entryOf({ decoded: { uid: 'qa-agent', email: 'qa-agent@timesinternet.in' } }, now0).test === true);
  check('L.4 an unknown page, tab, outcome or brain is not kept as sent', (function () { var x = T.entryOf({ brain: 'x', page: 'admin', tab: '../x', outcome: 'hacked', eventId: 'A/B' }, now0); return x.brain === 'dash' && x.page === '' && x.tab === '' && x.outcome === 'answered' && x.eventId === ''; })());
  /* the ring: a person's entries for one event never grow past CAPS.ring */
  var ring0 = L.CAPS.ring;
  L.CAPS.ring = 3;
  for (var i = 0; i < 5; i++) await T.writeEntry(FB, T.entryOf({ decoded: { uid: 'u-ring' }, eventId: AUTO, words: 'ask ' + i, turnId: 'RingTurn000' + i }, now0 + i));
  var ring = entries().filter(function (e) { return e.uid === 'u-ring'; });
  check('L.4 the ring keeps the newest CAPS.ring entries per person and event', ring.length === 3 && same(ring.map(function (e) { return e.words; }).sort(), ['ask 2', 'ask 3', 'ask 4']) &&
    FB.docs['aiRecordHeads/u-ring~' + AUTO].n === 5, ring.map(function (e) { return e.words; }));
  L.CAPS.ring = ring0;
  Object.keys(FB.docs).forEach(function (k) { if (/^aiRecord(?:Heads)?\/u-ring~/.test(k)) delete FB.docs[k]; });

  /* ===== L.5 the dash brain, through the router ===== */
  var c0 = entries().length;
  scripted['dash-bot'].push({ kind: 'open', events: [AUTO], open: { target: 'content', tab: 'speakers', carry: false }, text: 'Opening its speakers.', intent: 'open speakers' });
  var r = await call('POST', '/api/dash-bot', { message: 'open the speakers here, not the Retail Leaders Forum ones', view: { working: 'auto' }, place: { page: 'console', eventId: AUTO, tab: 'dashboard' }, screen: '1440x900' });
  await wait();
  var openId = r.body && r.body.turnId, eo = entryOfTurn('dash', openId);
  check('L.5 the answer is what it was: no field of the record reaches the page', r.status === 200 && same(Object.keys(r.body).sort(), ['action', 'asOf', 'choices', 'eventId', 'kind', 'list', 'notes', 'parts', 'scope', 'turnId']) && r.body.intent === undefined, r.body);
  check('L.5 one entry, written by the server: the model\'s intent, the words with the other event stripped, page and tab, done',
    entries().length === c0 + 1 && eo && eo.brain === 'dash' && eo.intent === 'open speakers' && eo.words === 'open the speakers here, not the another event ones' &&
    eo.page === 'console' && eo.tab === 'dashboard' && eo.eventId === AUTO && eo.eventName === 'Autotech Summit 2026' && eo.outcome === 'done' && eo.did.kind === 'open' && eo.name === 'Asha Rao', eo);
  check('L.5 owner rule 10: the entry names no other event, by name or id', JSON.stringify(eo).indexOf('Retail') === -1 && JSON.stringify(eo).indexOf(RETAIL) === -1);
  check('L.5 the schema asks the model for the intent in the same one answer (no extra AI call)', calls.length === 1 && calls[0].schema.required.indexOf('intent') !== -1 && /`intent`/.test(calls[0].prompt));
  r = await call('POST', '/api/dash-bot/turn', { turnId: openId, status: 'undone', note: 'stayed', eventId: AUTO, screen: '390x844' });
  await wait();
  eo = entryOfTurn('dash', openId);
  var undoNote = notes().filter(function (n) { return n.kind === 'undo'; })[0];
  check('L.5 /turn undone: the entry is undone, with how soon', r.status === 200 && eo.outcome === 'undone' && typeof eo.undoneAfterSec === 'number' && eo.undoneAfterSec >= 0, eo);
  check('L.5 …and a QA note: page, event, what was asked, what was done, what happened, browser and window size',
    !!undoNote && undoNote.page === 'console' && undoNote.eventId === AUTO && undoNote.asked === eo.words && undoNote.did.kind === 'open' && /^undone after \d+ s$/.test(undoNote.happened) &&
    undoNote.browser === 'Chrome 131 · macOS' && undoNote.screen === '390x844' && undoNote.title === 'Undone: “open speakers”', undoNote);
  r = await call('POST', '/api/dash-bot/turn', { turnId: openId, status: 'done', note: 'opened after staying', eventId: AUTO });
  await wait();
  check('L.5 a later "done" does not hide the undo (the change was undone)', entryOfTurn('dash', openId).outcome === 'undone');
  /* a handoff is the other brain's turn; a fail-closed refusal and the daily limit asked no model */
  c0 = entries().length;
  scripted['dash-bot'].push({ kind: 'handoff', text: '', intent: 'edit hero' });
  r = await call('POST', '/api/dash-bot', { message: 'make the hero darker', place: { page: 'editor', eventId: AUTO } });
  r = await call('POST', '/api/dash-bot', { message: 'how many registrations?', place: { page: 'console', eventId: 'no-such-event' } });
  await wait();
  check('L.5 a handoff and a fail-closed refusal are no entries', entries().length === c0 && r.body.kind === 'refuse');
  r = await call('POST', '/api/dash-bot', { message: 'how many registrations here?', place: { page: 'console', eventId: AUTO } });
  await wait();
  var err = entries().filter(function (e) { return e.outcome === 'error'; })[0];
  check('L.5 an AI that did not answer: an "error" entry, with the code', r.status === 502 && !!err && err.rule === 'ai-unavailable' && err.did.kind === 'error' && err.intent === 'question', err);
  scripted['dash-bot'].push({ kind: 'refuse', refuse: { action: 'delete' }, text: 'x', intent: 'delete event' });
  r = await call('POST', '/api/dash-bot', { message: 'delete Retail Leaders Forum', view: { working: 'all' }, place: { page: 'dashboard', eventId: '' } }, 'ravi');
  await wait();
  var del = entries().filter(function (e) { return e.uid === 'u-ravi' && e.outcome === 'refused'; })[0];
  check('L.5 on the dashboard: a refusal names its rule, and every event in the words is "an event"', !!del && del.rule === 'delete' && del.words === 'delete an event' && del.page === 'dashboard' && del.intent === 'delete event', del);

  /* ===== L.6 the site editor's brain ===== */
  scripted['chat-edit'].push(editAnswer({ kind: 'edit', summary: 'Made the hero title shorter.', textEdits: [{ sectionId: 'hero', find: 'Autotech Summit 2026', replace: 'Autotech' }], intent: 'shorten title' }));
  r = await call('POST', '/api/chat-edit', { eventId: AUTO, instruction: 'shorten the hero title like Retail Leaders Forum did', sections: SECTIONS, screen: '1280x720' });
  await wait();
  var editId = r.body.turnId, ee = entryOfTurn('edit', editId);
  check('L.6 the editor\'s answer is unchanged by the record', r.status === 200 && r.body.kind === 'edit' && r.body.intent === undefined && r.body.textEdits.length === 1, r.body);
  check('L.6 one entry: brain edit, pending, the model\'s intent, the words stripped of the other event (names read for it)',
    !!ee && ee.brain === 'edit' && ee.page === 'editor' && ee.outcome === 'pending' && ee.intent === 'shorten title' && ee.words === 'shorten the hero title like another event did' && ee.did.target === 'text', ee);
  r = await call('POST', '/api/chat/turn', { eventId: AUTO, turnId: editId, status: 'applied', done: ['Hero title'], notDone: [] });
  await wait();
  check('L.6 /api/chat/turn applied: done', entryOfTurn('edit', editId).outcome === 'done');
  r = await call('POST', '/api/chat/turn', { eventId: AUTO, turnId: editId, status: 'undone' }, 'ravi');
  await wait();
  check('L.6 another person cannot report someone else\'s turn (404), and the entry stays', r.status === 404 && entryOfTurn('edit', editId).outcome === 'done');
  r = await call('POST', '/api/chat/turn', { eventId: AUTO, turnId: editId, status: 'undone', screen: '1280x720' });
  await wait();
  check('L.6 the owner\'s undo: undone, and a QA note', entryOfTurn('edit', editId).outcome === 'undone' && notes().some(function (n) { return n.kind === 'undo' && n.brain === 'edit' && n.title === 'Undone: “shorten title”' && n.screen === '1280x720'; }));
  scripted['chat-edit'].push(editAnswer({ kind: 'reply', summary: 'Speakers are added in Content.', goTo: 'content:speakers', intent: 'add speaker' }));
  r = await call('POST', '/api/chat-edit', { eventId: AUTO, instruction: 'add Priya as a speaker', sections: SECTIONS });
  await wait();
  check('L.6 what the editor cannot do here (sent to Content): could not do', entries().some(function (e) { return e.brain === 'edit' && e.outcome === 'could-not' && e.rule === 'sent to content:speakers' && e.intent === 'add speaker'; }));

  /* The race the browser check found: the editor applies a change about a second after the answer, while its entry
     waits for the first list of event names. The report waits for this process's own write, and looks again a
     little later for one another process is writing; "applied" then "undone" a moment apart end undone. */
  var realCol = FB.db.collection, savedRetry = L.CAPS.outcomeRetryMs;
  T.resetCaches();
  FB.db.collection = function (n) {
    var c = realCol(n);
    if (n !== 'events') return c;
    var sel = c.select;
    c.select = function () { var q = sel.apply(c, arguments), get = q.get; q.get = function () { return wait(60).then(get); }; return q; };
    return c;
  };
  var slowId = 'RaceTurn0000000001';
  var slow = L.recordTurn(FB, { brain: 'edit', decoded: { uid: 'u-race', email: 'race@timesinternet.in', name: 'Race Test' }, eventId: AUTO, eventName: 'Autotech Summit 2026',
    page: 'editor', intent: 'swap banner', words: 'swap the banner', did: { kind: 'edit', target: 'design' }, outcome: 'pending', turnId: slowId });
  var applied = L.recordOutcome(FB, { brain: 'edit', turnId: slowId, status: 'applied', decoded: { uid: 'u-race', email: 'race@timesinternet.in' } });
  check('L.6 race: the report came before the entry was written', !entryOfTurn('edit', slowId));
  await Promise.all([slow, applied]);
  FB.db.collection = realCol;
  check('L.6 race: …it waited for this process\'s own write, and the entry is done', !!entryOfTurn('edit', slowId) && entryOfTurn('edit', slowId).outcome === 'done', entryOfTurn('edit', slowId));
  L.CAPS.outcomeRetryMs = [30, 60];
  var farId = 'RaceTurn0000000002';
  var far = L.recordOutcome(FB, { brain: 'dash', turnId: farId, status: 'undone', decoded: { uid: 'u-race', email: 'race@timesinternet.in' } });
  await wait(10);
  await T.writeEntry(FB, T.entryOf({ brain: 'dash', decoded: { uid: 'u-race', email: 'race@timesinternet.in', name: 'Race Test' }, eventId: AUTO, page: 'console',
    intent: 'open speakers', words: 'open the speakers', outcome: 'done', turnId: farId, known: [] }, Date.now() - 5000));
  await far;
  check('L.6 race: an entry another process writes a moment later is found on the next look, undone with how soon',
    entryOfTurn('dash', farId).outcome === 'undone' && entryOfTurn('dash', farId).undoneAfterSec >= 4, entryOfTurn('dash', farId));
  var never = Date.now();
  await L.recordOutcome(FB, { brain: 'dash', turnId: 'RaceTurn0000000003', status: 'done', decoded: { uid: 'u-race', email: 'race@timesinternet.in' } });
  check('L.6 race: a turn with no entry is looked for a bounded number of times, then let go', Date.now() - never < 1000 && !entryOfTurn('dash', 'RaceTurn0000000003'));
  var both = 'RaceTurn0000000004';
  await T.writeEntry(FB, T.entryOf({ brain: 'edit', decoded: { uid: 'u-race', email: 'race@timesinternet.in', name: 'Race Test' }, eventId: AUTO, page: 'editor',
    intent: 'swap banner', words: 'swap the banner', outcome: 'pending', turnId: both, known: [] }, Date.now()));
  await Promise.all([L.recordOutcome(FB, { brain: 'edit', turnId: both, status: 'undone', decoded: { uid: 'u-race' } }),
    L.recordOutcome(FB, { brain: 'edit', turnId: both, status: 'applied', decoded: { uid: 'u-race' } })]);
  check('L.6 race: "undone" and a late "applied" together leave it undone (read and changed in one transaction)', entryOfTurn('edit', both).outcome === 'undone', entryOfTurn('edit', both));
  L.CAPS.outcomeRetryMs = savedRetry;
  /* this race's person and notes are taken out again, so the report's counts below are the ones they were written for */
  Object.keys(FB.docs).forEach(function (k) { var d = FB.docs[k]; if (/~?u-race~/.test(k) || (d && d.uid === 'u-race')) delete FB.docs[k]; });
  T.resetGate();

  /* ===== L.7 a complaint ===== */
  scripted['dash-bot'].push({ kind: 'reply', events: [AUTO], text: 'Sorry about that.', intent: 'report broken form' });
  r = await call('POST', '/api/dash-bot', { message: 'the registration form is not working, call me on 98765 43210', place: { page: 'registrations', eventId: AUTO }, screen: '390x844' });
  await wait();
  var comp = notes().filter(function (n) { return n.kind === 'complaint'; })[0];
  check('L.7 "not working" in the message: a QA note with what was asked (phone out), what ETB2B AI did and the window',
    !!comp && comp.page === 'registrations' && comp.asked === 'the registration form is not working, call me on [phone]' && comp.did.kind === 'reply' && comp.screen === '390x844' &&
    comp.title === 'Said it was not working: “report broken form”', comp);
  check('L.7 the match is fixed words, no AI', T.isComplaint('this is broken') && T.isComplaint('there is a bug') && T.isComplaint('wrong date shown') && T.isComplaint('it does not load') &&
    T.isComplaint('I get an error') && !T.isComplaint('make the title bigger') && !T.isComplaint('open the speakers'));

  /* ===== L.8 POST /api/ai-qa/note ===== */
  T.resetGate();
  var NOTE = { kind: 'page-error', error: 'TypeError: Cannot read properties of undefined (reading \'name\') at https://revamp.example/edit-event.js?v=9', source: 'https://revamp.example/edit-event.js?v=9', line: 120, col: 9,
    stack: 'TypeError: x\n    at draw (https://revamp.example/edit-event.js?v=9:120:9)', page: 'console', eventId: AUTO, tab: 'content/speakers', asked: 'compare with Retail Leaders Forum, mail a@b.co', did: 'dash:reply', screen: '1440x900' };
  r = await call('POST', '/api/ai-qa/note', NOTE, null);
  check('L.8 signed out: refused (401), nothing kept', r.status === 401 && notes().filter(function (n) { return n.kind === 'page-error'; }).length === 0);
  r = await call('POST', '/api/ai-qa/note', Object.assign({}, NOTE, { kind: 'undo' }));
  check('L.8 only page errors come from a page (an undo is the server\'s own note)', r.status === 400);
  r = await call('POST', '/api/ai-qa/note', NOTE);
  await wait();
  var pe = notes().filter(function (n) { return n.kind === 'page-error'; })[0];
  check('L.8 a page error: 202 at once, kept with the event\'s name, the page and tab, where, the browser and window', r.status === 202 && r.body.kept === true && !!pe &&
    pe.eventName === 'Autotech Summit 2026' && pe.tab === 'content/speakers' && pe.where === 'edit-event.js:120:9' && pe.browser === 'Chrome 131 · macOS' && pe.screen === '1440x900', pe);
  check('L.8 …links reduced, no query, no host; the asked words stripped of the other event and the e-mail',
    pe.error.indexOf('revamp.example') === -1 && pe.error.indexOf('?v=') === -1 && pe.stack.indexOf('revamp.example') === -1 && pe.stack.indexOf('/edit-event.js') !== -1 &&
    pe.asked === 'compare with another event, mail [email]', pe);
  r = await call('POST', '/api/ai-qa/note', NOTE);
  check('L.8 the same fault from the same person again: accepted, not kept again', r.status === 202 && r.body.kept === false && notes().filter(function (n) { return n.kind === 'page-error'; }).length === 1);
  r = await call('POST', '/api/ai-qa/note', Object.assign({}, NOTE, { eventId: 'gone-event-x', error: 'Another fault 1' }));
  await wait();
  check('L.8 an event that does not exist is left out of the note', notes().filter(function (n) { return n.error === 'Another fault 1'; })[0].eventId === '');
  var codes = [];
  for (i = 0; i < 14; i++) { r = await call('POST', '/api/ai-qa/note', Object.assign({}, NOTE, { error: 'Fault number ' + 'abcdefghijklmn'.charAt(i) })); codes.push(r.status); }
  check('L.8 a person who sends too many is told to stop (429), after CAPS.notePerPerson', codes.indexOf(429) !== -1 && codes.filter(function (x) { return x === 202; }).length === L.CAPS.notePerPerson - 2, codes);
  r = await call('POST', '/api/ai-qa/note', Object.assign({}, NOTE, { error: 'x'.repeat(20 * 1024) }));
  check('L.8 a body over 16 KB is refused before anything is kept', r.status === 413, r.status);

  /* ===== L.9 the throttle and the grouping ===== */
  T.resetGate();
  var t0 = 1000000;
  check('L.9 the gate: through, then the same note is a duplicate for ten minutes', T.noteGate('u1', 'g1', t0) === '' && T.noteGate('u1', 'g1', t0 + 1000) === 'duplicate' && T.noteGate('u1', 'g1', t0 + 10 * 60000) === '');
  T.resetGate();
  var got = []; for (i = 0; i < L.CAPS.notePerPerson + 2; i++) got.push(T.noteGate('u2', 'g' + i, t0 + i));
  check('L.9 a person: CAPS.notePerPerson in ten minutes, then "rate"', got.filter(function (x) { return x === ''; }).length === L.CAPS.notePerPerson && got[got.length - 1] === 'rate');
  T.resetGate();
  for (i = 0; i < L.CAPS.noteAll; i++) T.noteGate('p' + i, 'g', t0);
  check('L.9 everyone together: CAPS.noteAll, then "busy"', T.noteGate('late', 'g', t0 + 1) === 'busy' && T.noteGate('late', 'g', t0 + 10 * 60000 + 1) === '');
  T.resetGate();
  for (i = 0; i < 6000; i++) T.noteGate('m' + (i % 50), 'g' + i, t0 + i * 200000);
  check('L.9 it never grows without bound: old keys are let go', T.gateSize() <= 5001, T.gateSize());
  var a = T.noteOf('page-error', { page: 'console', error: 'Failed to load event 3f9a2b1c77 after 3 tries', where: 'edit-event.js:120:9', decoded: { uid: 'u1' } }, t0);
  var b = T.noteOf('page-error', { page: 'console', error: 'Failed to load event 77aa00bb11 after 5 tries', where: 'edit-event.js:131:2', decoded: { uid: 'u2' } }, t0);
  var cdiff = T.noteOf('page-error', { page: 'editor', error: 'Failed to load event 77aa00bb11 after 5 tries', where: 'edit-event.js:131:2', decoded: { uid: 'u2' } }, t0);
  check('L.9 one fault from two people (other ids, counts and lines) is one group; another page is another', a.group === b.group && a.group !== cdiff.group && a.title === 'Failed to load event # after # tries');
  check('L.9 an undo groups by page and intent', T.noteOf('undo', { page: 'editor', intent: 'swap banner' }, t0).group === T.noteOf('undo', { page: 'editor', intent: 'swap banner' }, t0 + 5).group &&
    T.noteOf('undo', { page: 'editor', intent: 'swap banner' }, t0).group !== T.noteOf('undo', { page: 'editor', intent: 'shorten title' }, t0).group);

  /* ===== L.10 the report ===== */
  FB.docs['config/approvals'] = { approvers: ['boss@timesinternet.in'], required: true };
  r = await call('GET', '/api/ai-report?range=month', undefined, 'asha');
  check('L.10 a team member who is not an approver: 403 not-an-approver, nothing of the report', r.status === 403 && r.body.code === 'not-an-approver' && !r.body.top && /Only an approver \(boss@timesinternet\.in\)/.test(r.body.error), r.body);
  r = await call('POST', '/api/ai-report/resolve', { group: a.group, resolved: true }, 'asha');
  check('L.10 …and cannot mark a QA group resolved', r.status === 403 && !FB.docs['aiQaGroups/' + a.group]);
  r = await call('GET', '/api/ai-report?range=month', undefined, null);
  check('L.10 signed out: 401', r.status === 401);
  /* the report reads the record of today, whatever this machine's clock says the date is */
  T.clock.now = function () { return Date.now(); };
  r = await call('GET', '/api/ai-report?range=month', undefined, 'boss');
  var R = r.body;
  check('L.10 an approver: 200 with the range (India days), totals and the four parts', r.status === 200 && R.range && R.range.range === 'month' && /^\d{4}-\d{2}-01$/.test(R.range.from) &&
    R.totals && Array.isArray(R.top) && Array.isArray(R.gaps) && Array.isArray(R.wrong) && Array.isArray(R.qa), R && R.range);
  var topOpen = R.top.filter(function (g) { return g.intent === 'open speakers'; })[0];
  check('L.10 top requests by intent and page, with counts and real examples', !!topOpen && topOpen.page === 'console' && topOpen.pageName === 'Console' && topOpen.count === 1 && topOpen.examples.length === 1 &&
    topOpen.examples[0].words === 'open the speakers here, not the another event ones', topOpen);
  check('L.10 names are masked by default: "Person 1"', topOpen.examples[0].who === 'Person 1' && JSON.stringify(R).indexOf('Asha') === -1 && JSON.stringify(R).indexOf('Ravi') === -1);
  var gapDel = R.gaps.filter(function (g) { return g.rule === 'delete'; })[0];
  check('L.10 gaps: refused, could not do, failed, error, each with its rule in words', !!gapDel && gapDel.outcomeName === 'Refused' && gapDel.ruleName === 'deleting an event' &&
    R.gaps.some(function (g) { return g.outcome === 'could-not' && g.ruleName === 'sent to Content › speakers'; }) && R.gaps.some(function (g) { return g.outcome === 'error' && g.ruleName === 'the AI did not answer'; }), R.gaps);
  var wr = R.wrong.filter(function (w) { return w.intent === 'shorten title'; })[0];
  check('L.10 got it wrong: the undo rate by intent, with how soon and examples', !!wr && wr.changes === 1 && wr.undone === 1 && wr.rate === 100 && typeof wr.medianUndoSec === 'number' && wr.examples.length === 1, wr);
  var qaUndo = R.qa.filter(function (g) { return g.kind === 'undo' && g.title === 'Undone: “open speakers”'; })[0];
  var qaErr = R.qa.filter(function (g) { return g.kind === 'page-error' && g.group === T.noteOf('page-error', { page: 'console', error: NOTE.error, where: 'edit-event.js:120:9' }, t0).group; })[0];
  check('L.10 QA notes grouped and counted, open, with the details of the latest', !!qaUndo && qaUndo.status === 'open' && qaUndo.count === 1 && !!qaErr && qaErr.count === 1 &&
    qaErr.examples[0].where === 'edit-event.js:120:9' && qaErr.examples[0].browser === 'Chrome 131 · macOS' && qaErr.examples[0].event.id === AUTO, [qaUndo, qaErr]);
  check('L.10 e-mails and phones never appear in the report', !/@timesinternet\.in|98765/.test(JSON.stringify(R).replace(/r\*\*\*@timesinternet\.in/g, '')), JSON.stringify(R).match(/[^"]*@[^"]*/g));
  r = await call('GET', '/api/ai-report?range=month&names=1', undefined, 'boss');
  check('L.10 names on request: the person\'s name (never an address)', r.body.top.filter(function (g) { return g.intent === 'open speakers'; })[0].examples[0].who === 'Asha Rao' &&
    r.body.gaps.filter(function (g) { return g.rule === 'delete'; })[0].examples[0].who === 'Ravi Iyer');
  /* test entries: the QA agent on a qa- event */
  scripted['dash-bot'].push({ kind: 'reply', events: [QAEV], text: 'Here.', intent: 'test question' });
  await call('POST', '/api/dash-bot', { message: 'qa check', place: { page: 'console', eventId: QAEV } }, 'qa-agent');
  await wait();
  r = await call('GET', '/api/ai-report?range=month', undefined, 'boss');
  check('L.10 the QA agent and qa- events are left out of the team\'s numbers, and counted as left out', !r.body.top.some(function (g) { return g.intent === 'test question'; }) && r.body.leftOut >= 1, r.body.leftOut);
  r = await call('GET', '/api/ai-report?range=month&tests=1', undefined, 'boss');
  check('L.10 …and shown with tests=1', r.body.top.some(function (g) { return g.intent === 'test question'; }) && r.body.leftOut === 0);
  r = await call('GET', '/api/ai-report?range=custom&from=2026-11-09&to=2026-11-01', undefined, 'boss');
  check('L.10 a custom range that ends before it starts: 400 in words', r.status === 400 && r.body.code === 'bad-range');
  /* resolve, then a new note: back */
  r = await call('POST', '/api/ai-report/resolve', { group: qaErr.group, resolved: true }, 'boss');
  check('L.10 an approver marks a group resolved', r.status === 200 && r.body.resolved === true && FB.docs['aiQaGroups/' + qaErr.group].resolved === true && FB.docs['aiQaGroups/' + qaErr.group].resolvedBy === 'boss@timesinternet.in');
  r = await call('GET', '/api/ai-report?range=month', undefined, 'boss');
  var after = r.body.qa.filter(function (g) { return g.group === qaErr.group; })[0];
  check('L.10 …the report says resolved (by "an approver" while names are hidden)', after.status === 'resolved' && after.resolvedBy === 'an approver', after);
  await wait(5);
  T.resetGate();
  await call('POST', '/api/ai-qa/note', NOTE, 'ravi');
  await wait();
  r = await call('GET', '/api/ai-report?range=month', undefined, 'boss');
  after = r.body.qa.filter(function (g) { return g.group === qaErr.group; })[0];
  check('L.10 a note after it was resolved shows the group back, with how many since', after.status === 'back' && after.sinceResolved === 1 && after.count === 2 && after.people === 2, after);
  r = await call('POST', '/api/ai-report/resolve', { group: qaErr.group, resolved: false }, 'boss');
  check('L.10 …and it can be opened again', r.status === 200 && FB.docs['aiQaGroups/' + qaErr.group].resolved === false);
  r = await call('POST', '/api/ai-report/resolve', { group: '../x' }, 'boss');
  check('L.10 a group that is not one: 400', r.status === 400);
  FB.docs['config/approvals'] = { approvers: [], required: true };
  r = await call('GET', '/api/ai-report', undefined, 'asha');
  check('L.10 while config/approvals names nobody, everyone signed in approves (lib/access.js), as for every approver-only action', r.status === 200 && r.body.range.range === 'week');
  check('L.10 the approver rule is lib/access.js notAnApprover', T.whyNot({ approvers: ['boss@timesinternet.in'] }, { email: 'Boss@timesinternet.in' }) === '' &&
    T.whyNot({ approvers: ['boss@timesinternet.in'] }, { email: 'asha@timesinternet.in' }) !== '');
  /* the range */
  var nov8 = Date.parse('2026-11-08T10:00:00Z');   // a Sunday in India
  check('L.10 this week is from Monday, this month from the 1st (India days)', T.rangeOf({}, nov8).fromDay === '2026-11-02' && T.rangeOf({ range: 'month' }, nov8).fromDay === '2026-11-01' &&
    T.rangeOf({}, nov8).from === '2026-11-01T18:30:00.000Z' && T.rangeOf({}, nov8).to === '2026-11-08T18:30:00.000Z');
  check('L.10 India\'s Monday early morning is still this Monday', T.rangeOf({}, Date.parse('2026-11-08T19:00:00Z')).fromDay === '2026-11-09');
  check('L.10 a custom range never reaches past what the record keeps, or after today', T.rangeOf({ range: 'custom', from: '2025-01-01', to: '2027-01-01' }, nov8).fromDay === '2026-05-13' &&
    T.rangeOf({ range: 'custom', from: '2025-01-01', to: '2027-01-01' }, nov8).toDay === '2026-11-08' && !!T.rangeOf({ range: 'custom', from: 'x' }, nov8).error);
  /* the sweep: entries older than the record keeps go after a report */
  FB.docs['aiRecord/old~_~0'] = { at: '2025-01-01T00:00:00.000Z', uid: 'old' };
  FB.docs['aiQaNotes/oldnote'] = { at: '2025-01-01T00:00:00.000Z', uid: 'old' };
  T.resetCaches();
  FB.docs['config/approvals'] = { approvers: ['boss@timesinternet.in'], required: true };
  await call('GET', '/api/ai-report', undefined, 'boss');
  await wait();
  check('L.10 entries and notes older than 180 days are swept away after a report', !FB.docs['aiRecord/old~_~0'] && !FB.docs['aiQaNotes/oldnote']);
  /* the pure report: masking and the bounds */
  var rep = T.buildReport([
    { intent: 'swap banner', page: 'editor', uid: 'a', name: 'A', words: 'mail x.y@z.com now', at: '2026-11-08T01:00:00Z', outcome: 'undone', undoneAfterSec: 30 },
    { intent: 'swap banner', page: 'editor', uid: 'b', name: 'B', words: 'swap it', at: '2026-11-08T02:00:00Z', outcome: 'done' },
    { intent: 'swap banner', page: 'editor', uid: 'a', name: 'A', words: 'swap it', at: '2026-11-08T03:00:00Z', outcome: 'done' }
  ], [], {});
  check('L.10 buildReport: one example per wording, e-mails masked, the undo rate', rep.top[0].count === 3 && rep.top[0].examples.length === 2 && rep.top[0].people === 2 &&
    rep.wrong[0].rate === 33 && rep.wrong[0].medianUndoSec === 30 && rep.wrong[0].examples[0].words === 'mail x***@z.com now', rep);

  /* ===== L.11 the assistant's page-error reporter ===== */
  var SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'etb2b-assistant.js'), 'utf8');
  function shell(o) {
    o = o || {};
    var listeners = {}, posts = [], timers = [];
    var ctx = { console: { log: function () {}, warn: function () {}, error: function () {} }, innerWidth: 390, innerHeight: 844,
      setTimeout: function (fn) { timers.push(fn); return timers.length; }, clearTimeout: function () {},
      location: { pathname: '/edit-event.html', search: '?event=' + AUTO, hash: '#content/speakers' },
      addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      document: { readyState: 'complete', querySelector: function (sel) { return sel === '[data-rv-assistant]' ? { getAttribute: function () { return 'console'; } } : null; }, addEventListener: function () {} },
      RevampAuth: { whenResolved: function () { return { then: function (f) { if (!o.pending) f(); } }; }, currentUser: function () { return o.signedOut ? null : { email: 'asha@timesinternet.in' }; },
        authedFetch: function (url, opts) { if (o.throws) throw new Error('boom'); posts.push({ url: url, body: JSON.parse(opts.body), keepalive: opts.keepalive }); return Promise.resolve({ ok: !o.refuse, status: o.refuse ? 429 : 202 }); } }
    };
    ctx.window = ctx; ctx.top = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: 'etb2b-assistant.js' });
    return { ctx: ctx, posts: posts, fire: function (t, e) { (listeners[t] || []).forEach(function (fn) { fn(e); }); },
      run: function () { var t = timers.slice(); timers.length = 0; t.forEach(function (fn) { fn(); }); return wait(5); }, has: function (t) { return !!(listeners[t] && listeners[t].length); } };
  }
  var P = shell();
  check('L.11 on a page that carries the assistant it listens for errors and unhandled rejections', P.has('error') && P.has('unhandledrejection'));
  P.fire('error', { message: 'TypeError: x is undefined', filename: 'https://h.example/edit-event.js?v=3', lineno: 10, colno: 4, error: { stack: 'TypeError: x\n at f' } });
  P.fire('error', { message: 'TypeError: x is undefined', filename: 'https://h.example/edit-event.js?v=3', lineno: 10, colno: 4 });
  await P.run();
  check('L.11 one fault: one note, with the page, event, tab and window size, sent with keepalive', P.posts.length === 1 && P.posts[0].url === '/api/ai-qa/note' && P.posts[0].keepalive === true &&
    P.posts[0].body.kind === 'page-error' && P.posts[0].body.page === 'console' && P.posts[0].body.eventId === AUTO && P.posts[0].body.tab === 'content/speakers' &&
    P.posts[0].body.screen === '390x844' && P.posts[0].body.source === 'https://h.example/edit-event.js', P.posts);
  P.fire('unhandledrejection', { reason: { message: 'Failed to fetch' } });
  P.fire('error', { message: 'Script error.' });
  P.fire('error', { message: 'ResizeObserver loop completed with undelivered notifications.' });
  P.fire('error', { message: 'x', filename: 'chrome-extension://abc/content.js' });
  await P.run();
  check('L.11 a rejection is a note; another site\'s "Script error.", ResizeObserver and add-ons are not', P.posts.length === 2 && /^Unhandled rejection: Failed to fetch$/.test(P.posts[1].body.error), P.posts.map(function (p) { return p.body.error; }));
  for (i = 0; i < 10; i++) P.fire('error', { message: 'fault ' + i, filename: '/a.js', lineno: i });
  await P.run();
  check('L.11 at most five notes a page', P.posts.length === 5, P.posts.length);
  P = shell({ refuse: true });
  P.fire('error', { message: 'one', filename: '/a.js' }); await P.run();
  P.fire('error', { message: 'two', filename: '/a.js' }); await P.run();
  check('L.11 once the server says no, nothing more is sent', P.posts.length === 1);
  P = shell({ signedOut: true });
  P.fire('error', { message: 'one', filename: '/a.js' }); await P.run();
  check('L.11 signed out: nothing is sent', P.posts.length === 0);
  P = shell({ pending: true });
  P.fire('error', { message: 'early', filename: '/a.js' }); await P.run();
  check('L.11 before the sign-in is known, a fault waits (and is sent once signed in)', P.posts.length === 0);
  P.ctx.RevampAssistant._test.qaSignedIn(true); await P.run();
  check('L.11 …sent once signed in', P.posts.length === 1 && P.posts[0].body.error === 'early');
  P = shell({ throws: true });
  var threw = false;
  try { P.fire('error', { message: 'one', filename: '/a.js' }); await P.run(); P.fire('error', { message: 'two', filename: '/a.js' }); await P.run(); } catch (e) { threw = true; }
  check('L.11 a reporter that cannot send never throws, and stops (never a loop)', !threw && P.ctx.RevampAssistant._test.qa().off === true && P.ctx.RevampAssistant._test.qa().sent === 1);
  check('L.11 ES5 (every page serves it as it is)', !/\blet\s|\bconst\s|=>|`/.test(SRC.slice(SRC.indexOf('/* ---------- QA notes: page errors'), SRC.indexOf('/* ---------- start: after the sign-in check'))));
  check('L.11 the shell itself keeps no literal line separator', !/[\u2028\u2029]/.test(SRC) && !/[\u2028\u2029]/.test(fs.readFileSync(path.join(__dirname, 'ai-learn.js'), 'utf8')));

  if (failed) { console.error('ai-learn: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('ai-learn: all ' + passed + ' checks passed');
  process.exit(0);
})().catch(function (e) { console.error('ai-learn: crashed — ' + (e && e.stack || e)); process.exit(1); });
