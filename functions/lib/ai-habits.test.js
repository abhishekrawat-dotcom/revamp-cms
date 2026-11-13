/* node functions/lib/ai-habits.test.js — ETB2B AI learns, part 1: faster for users (owner decision 11; lib/ai-habits.js).
     H.1  the suggestions (chipsFor): the person's own most-asked requests on this page; the team's for this kind of
          event when the person has too few; often undone, mostly failed and no-request labels left out; at most four;
          on Promotions the open editor's; LOCKED TO THE EVENT: words only from this very event, a label seen on one
          other event only left out inside an event; qa- events and the QA agent out of the team's numbers
     H.2  the examples for the prompts: words that name nothing (genericWords), kept successes asked twice, the answer's
          shape in the schema's words, the block every brain gets, and a first read never waited on for long
     H.3  shortcuts, pure (applyOp): a new one (its name offered from the request), one more request in one, a name
          taken, full, too many, rename, delete, one that is gone
     H.4  the record: an entry carries the event's kind; a new entry and an outcome reach the suggestions in this process
          (onRecord); nameEvents turns this event's name into "this event" and says when another is named
     H.5  through the real router: GET /api/ai-habits (fail closed: an event page with no event, a deleted event, an
          event outside the person's portals), the person's own shortcuts only, POST /api/ai-habits/shortcuts (add with
          this event's name taken out, another event's name refused, rename, delete, a Viewer keeps their own)
     H.6  every brain's prompt gets the team's examples: the dash brain (on a page of one event and off one), the site
          editor's, and the post and mailer editors' (through the real routes, the model scripted)
   An in-memory Firestore, the model scripted (no AI call), made-up tokens. Exits 1 on any failure. */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 900) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }
['log', 'info', 'warn'].forEach(function (k) { console[k] = function () {}; });
var errors = [];
console.error = (function (orig) { return function () { var s = [].slice.call(arguments).map(String).join(' '); if (/^FAIL /.test(s)) orig.apply(console, arguments); else errors.push(s); }; })(console.error);

/* ---------- an in-memory Firestore (as functions/lib/ai-learn.test.js): where (==, >=, <), orderBy, limit, select,
   add, getAll, transactions that write at the end ---------- */
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
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), get: function (k) { return d ? d[k] : undefined; }, data: function () { return d ? Object.assign({}, clone(d), d.expireAt instanceof Date ? { expireAt: d.expireAt } : {}) : undefined; } }; }
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
  var reads = { aiRecord: 0 };
  function colRef(p, q) {
    q = q || { wh: [], order: null, lim: 0, sel: null };
    function next(change) { return colRef(p, Object.assign({}, q, change)); }
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(16, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(16, '0')); docs[r.path] = {}; write(docs[r.path], data, false); return Promise.resolve(r); },
      where: function (f, op, v) { return next({ wh: q.wh.concat([[f, op, v]]) }); },
      orderBy: function (f, dir) { return next({ order: { f: f, desc: dir === 'desc' } }); },
      limit: function (n) { return next({ lim: n }); },
      select: function () { return next({ sel: [].slice.call(arguments) }); },
      get: function () {
        if (p === 'aiRecord') reads.aiRecord++;
        if (fb.slowRecord && p === 'aiRecord') return new Promise(function () { /* never answers */ });
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
        if (q.sel) {
          var sel = q.sel;
          list = list.map(function (s) { var d = s.data(), out = {}; sel.forEach(function (k) { if (d[k] !== undefined) out[k] = d[k]; }); return { id: s.id, exists: true, ref: s.ref, data: function () { return clone(out); } }; });
        }
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
      } };
  }
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
    getAll: function () { return Promise.all(Array.prototype.slice.call(arguments).filter(function (r) { return r && typeof r.get === 'function'; }).map(function (r) { return r.get(); })); },
    batch: function () { var del = []; return { delete: function (r) { del.push(r); }, commit: function () { return Promise.all(del.map(function (r) { return r.delete(); })); } }; } };
  /* tokens: "asha" is asha@timesinternet.in (uid u-asha), "qa-agent" the QA agent */
  var fb = { db: db, bucket: { name: 'test-bucket' }, docs: docs, reads: reads,
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: t === 'qa-agent' ? 'qa-agent' : 'u-' + t, name: t === 'asha' ? 'Asha Rao' : t === 'ravi' ? 'Ravi Iyer' : t === 'vik' ? 'Vik Shah' : '', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
  return fb;
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
delete process.env.ACCESS_CONFIG_DOC;

/* ---------- the model, scripted per route; every prompt kept ---------- */
var llm = require('./llm');
var calls = [], scripted = { 'dash-bot': [], 'chat-edit': [], 'promo-edit': [] };
llm.callJson = function (prompt, schema, opts) {
  var route = (opts && opts.route) || '';
  calls.push({ route: route, prompt: prompt });
  var next = (scripted[route] || []).shift();
  if (!next) return Promise.resolve({ error: 'The AI service is not answering right now.', code: 'ai-unavailable', status: 502 });
  return Promise.resolve({ parsed: next, provider: 'claude', model: 'claude-stub' });
};

var api = require('./api');
var L = require('./ai-learn');
var HB = require('./ai-habits');
var T = HB._test;

var NOW = Date.parse('2026-11-13T06:30:00Z');
L.clock.now = function () { return NOW; };
function ago(days, mins) { return new Date(NOW - (days || 0) * 86400000 - (mins || 0) * 60000).toISOString(); }

function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var h = { host: 'localhost', 'user-agent': 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36' };
    if (who !== null) h.authorization = 'Bearer ' + (who || 'asha');
    if (body !== undefined) h['content-type'] = 'application/json';
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

/* the events: two IP events, one awards, a deleted one, one on another portal, and a qa- one */
var AUTO = 'autotech-summit-2026', RETAIL = 'retail-leaders-2026', AWARDS = 'cio-awards-2026', GONE = 'gone-event-2026', QAEV = 'qa-habits-test';
FB.docs['events/' + AUTO] = { name: 'Autotech Summit 2026', category: 'ip', portal: 'auto', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z', start: '2099-11-25T09:00', city: 'Pune' };
FB.docs['events/' + RETAIL] = { name: 'Retail Leaders Forum', category: 'ip', portal: 'retail', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z', start: '2099-12-02T09:00', city: 'Mumbai' };
FB.docs['events/' + AWARDS] = { name: 'CIO Awards 2026', category: 'awards', portal: 'cio', createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z' };
FB.docs['events/' + GONE] = { name: 'Gone Event 2026', category: 'ip', portal: 'auto', createdAt: '2026-10-02T00:00:00.000Z', deletedAt: '2026-11-01T00:00:00.000Z' };
FB.docs['events/' + QAEV] = { name: 'QA Habits Test', category: 'ip', portal: 'auto', createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' };
/* Ravi works in the retail portal only (Settings › Access) */
FB.docs['config/access'] = { defaultRole: 'editor', members: { 'ravi@timesinternet.in': { role: 'editor', portals: ['retail'] }, 'vik@timesinternet.in': { role: 'viewer', portals: ['*'] } } };

/* an entry as the record keeps it (only what the suggestions read) */
var seq = 0;
function E(o) {
  return Object.assign({ brain: 'edit', uid: 'u-asha', test: false, eventId: AUTO, eventKind: 'ip', page: 'editor', tab: '', intent: 'shorten title',
    words: 'Shorten the hero title', did: { kind: 'edit', target: 'text' }, outcome: 'done', at: ago(1, ++seq), turnKey: '' }, o || {});
}
function seed(list) {
  Object.keys(FB.docs).forEach(function (k) { if (k.indexOf('aiRecord/') === 0) delete FB.docs[k]; });
  list.forEach(function (e, i) { FB.docs['aiRecord/seed~' + i] = clone(e); });
  T.reset();
}

(async function () {
  /* ======== H.1 the suggestions ======== */
  (function () {
    var me = { uid: 'u-asha', page: 'editor', eventId: AUTO, kind: 'ip' };
    var list = [
      E({ words: 'Shorten the hero title to five words', at: ago(0, 5) }), E({ words: 'Make the title shorter' }), E({ eventId: AUTO, words: 'Shorten the title' }),
      E({ intent: 'swap banner', words: 'Use a darker banner', did: { kind: 'edit', target: 'design' } }), E({ intent: 'swap banner', outcome: 'undone' }),
      E({ intent: 'question', outcome: 'answered', words: 'What can you change?' }), E({ intent: 'question', outcome: 'answered' }), E({ intent: 'question', outcome: 'answered' }),
      E({ intent: 'add faq section', words: 'Add an FAQ section', outcome: 'failed' }), E({ intent: 'add faq section', outcome: 'could-not' }), E({ intent: 'add faq section', outcome: 'done' }),
      E({ intent: 'tighten overview', words: 'Tighten the overview', eventId: RETAIL }), E({ intent: 'tighten overview', words: 'Tighten the overview', eventId: RETAIL })
    ];
    var c = T.chipsFor(list, me);
    check('H.1 the person\'s own most-asked request here, with this event\'s newest wording', c.length >= 1 && c[0].label === 'Shorten title' && c[0].text === 'Shorten the hero title to five words' && c[0].from === 'you' && c[0].count === 3, c);
    check('H.1 often undone (1 of 2), no request ("question") and mostly failed (2 of 3) are left out', !c.some(function (x) { return /swap banner|question|faq/i.test(x.label); }), c);
    check('H.1 LOCKED: a request seen on one other event only is left out inside an event', !c.some(function (x) { return x.label === 'Tighten overview'; }), c);
    /* on the other event, the request asked only there is in, with that event's words; "shorten title" (only on AUTO) is out */
    var c2 = T.chipsFor(list, { uid: 'u-asha', page: 'editor', eventId: RETAIL, kind: 'ip' });
    check('H.1 …on that event it is in, in that event\'s own words', c2.some(function (x) { return x.label === 'Tighten overview' && x.text === 'Tighten the overview'; }), c2);
    check('H.1 …and the one seen only on the first event is out there', !c2.some(function (x) { return x.label === 'Shorten title'; }), c2);
    /* asked on two events: it is in on a third, sending the kind of request itself (never another event's words) */
    var c3 = T.chipsFor(list.concat([E({ eventId: RETAIL, words: 'Shorten the Retail Leaders title' })]), { uid: 'u-asha', page: 'editor', eventId: AWARDS, kind: 'awards' });
    check('H.1 seen on two events: on a third its label is sent, never another event\'s words', c3.length && c3[0].label === 'Shorten title' && c3[0].text === 'Shorten title', c3);

    /* the team: too few of the person's own, so the team's for this kind of event fill the row */
    var team = [
      E({ uid: 'u-ravi', intent: 'add speakers section', words: 'Add a speakers section', eventId: RETAIL }), E({ uid: 'u-vik', intent: 'add speakers section', eventId: RETAIL }),
      E({ uid: 'u-ravi', intent: 'add speakers section', eventId: AUTO, words: 'Add the speakers section after the overview' }),
      E({ uid: 'u-ravi', intent: 'new agenda layout', words: 'Change the agenda layout', eventId: AWARDS, eventKind: 'awards' }), E({ uid: 'u-vik', intent: 'new agenda layout', words: 'Change the agenda layout', eventId: AWARDS, eventKind: 'awards' }),
      E({ uid: 'u-ravi', intent: 'new agenda layout', words: 'Change the agenda layout', eventId: AWARDS, eventKind: 'awards' }),
      E({ uid: 'qa-agent', test: true, intent: 'qa only thing', eventId: QAEV }), E({ uid: 'qa-agent', test: true, intent: 'qa only thing', eventId: QAEV }), E({ uid: 'u-ravi', test: true, intent: 'qa only thing', eventId: QAEV }),
      E({ uid: 'u-ravi', intent: 'one person only', eventId: RETAIL }), E({ uid: 'u-ravi', intent: 'one person only', eventId: AUTO }), E({ uid: 'u-ravi', intent: 'one person only', eventId: AUTO })
    ];
    var t = T.chipsFor(team, { uid: 'u-asha', page: 'editor', eventId: AUTO, kind: 'ip', kindOf: function (id) { return id === AWARDS ? 'awards' : 'ip'; } });
    check('H.1 the team fills the row for this kind of event, in this event\'s own words', t.length === 1 && t[0].label === 'Add speakers section' && t[0].from === 'team' && t[0].text === 'Add the speakers section after the overview', t);
    check('H.1 …not another kind\'s (awards), not qa- events or the QA agent, not one person\'s alone', !t.some(function (x) { return /agenda|qa only|one person/.test(x.label); }), t);
    /* an older entry with no kind is told by the event's own (kindOf) */
    var noKind = team.map(function (e) { var x = clone(e); delete x.eventKind; return x; });
    var t2 = T.chipsFor(noKind, { uid: 'u-asha', page: 'editor', eventId: AWARDS, kind: 'awards', kindOf: function (id) { return id === AWARDS ? 'awards' : 'ip'; } });
    check('H.1 an entry from before entries carried their kind is told by its event (and on that event, its own words)', t2.length === 1 && t2[0].label === 'New agenda layout' && t2[0].text === 'Change the agenda layout', t2);

    /* the team's undo rate on this page leaves a request out for everyone */
    var wide = [E({ intent: 'make it darker' }), E({ intent: 'make it darker' }), E({ intent: 'make it darker' }),
      E({ uid: 'u-ravi', intent: 'make it darker', outcome: 'undone' }), E({ uid: 'u-vik', intent: 'make it darker', outcome: 'undone' }), E({ uid: 'u-ravi', intent: 'make it darker', outcome: 'undone' })];
    var w = T.chipsFor(wide, me);
    check('H.1 a request the team often undoes here is left out of the person\'s own too', !w.some(function (x) { return x.label === 'Make it darker'; }), w);

    /* at most four, own first */
    var many = [];
    ['alpha one', 'bravo two', 'charlie three', 'delta four', 'echo five'].forEach(function (intent, k) { for (var i = 0; i <= 5 - k; i++) many.push(E({ intent: intent, words: 'Do ' + intent })); });
    var m = T.chipsFor(many, me);
    check('H.1 at most four, the most asked first', m.length === 4 && m.map(function (x) { return x.label; }).join('|') === 'Alpha one|Bravo two|Charlie three|Delta four', m);

    /* Promotions: the open editor's requests, or the events side's */
    var promo = [E({ brain: 'promo', page: 'promotions', tab: 'mailers', intent: 'write subject', words: 'Write a better subject line' }), E({ brain: 'promo', page: 'promotions', tab: 'mailers', intent: 'write subject' }),
      E({ brain: 'promo', page: 'promotions', tab: 'posts', intent: 'write caption' }), E({ brain: 'promo', page: 'promotions', tab: 'posts', intent: 'write caption' }),
      E({ brain: 'dash', page: 'promotions', tab: 'mailers', intent: 'open mailers', outcome: 'done', did: { kind: 'open', target: 'promotions:mailers' } }), E({ brain: 'dash', page: 'promotions', tab: 'mailers', intent: 'open mailers', outcome: 'done' })];
    var pm = T.chipsFor(promo, { uid: 'u-asha', page: 'promotions', eventId: AUTO, kind: 'ip', promo: 'mail' });
    var pp = T.chipsFor(promo, { uid: 'u-asha', page: 'promotions', eventId: AUTO, kind: 'ip', promo: 'post' });
    var pd = T.chipsFor(promo, { uid: 'u-asha', page: 'promotions', eventId: AUTO, kind: 'ip', promo: '' });
    check('H.1 Promotions with a mail open in Edit with AI: the mailer editor\'s requests', pm.map(function (x) { return x.label; }).join() === 'Write subject' && pm[0].text === 'Write a better subject line', pm);
    check('H.1 …with a post open: the post editor\'s; with none: the events side\'s', pp.map(function (x) { return x.label; }).join() === 'Write caption' && pd.map(function (x) { return x.label; }).join() === 'Open mailers', [pp, pd]);

    /* off an event: words with an event's name taken out ("an event") are never sent; another event, an address neither */
    var dash = [E({ brain: 'dash', page: 'dashboard', eventId: '', eventKind: '', intent: 'list drafts', words: 'Show drafts from last week', outcome: 'done' }),
      E({ brain: 'dash', page: 'dashboard', eventId: '', eventKind: '', intent: 'list drafts', words: 'Show an event drafts', outcome: 'done', at: ago(0, 1) }),
      E({ brain: 'dash', page: 'dashboard', eventId: '', eventKind: '', intent: 'count registrations', words: 'How many registrations does an event have', outcome: 'answered' }),
      E({ brain: 'dash', page: 'dashboard', eventId: '', eventKind: '', intent: 'count registrations', words: 'Mail [email] the numbers', outcome: 'answered' })];
    var d = T.chipsFor(dash, { uid: 'u-asha', page: 'dashboard', eventId: '', kind: '' });
    check('H.1 off an event: the newest wording that names no event is sent', d.some(function (x) { return x.label === 'List drafts' && x.text === 'Show drafts from last week'; }), d);
    check('H.1 …and with none, the kind of request itself', d.some(function (x) { return x.label === 'Count registrations' && x.text === 'Count registrations'; }), d);
    check('H.1 sendable: never cut words, an address, another event', !T.sendable('x'.repeat(300), {}) && !T.sendable('Write to [email]', {}) && !T.sendable('Open another event', { eventId: AUTO }) && T.sendable('Open this event\'s speakers', { eventId: AUTO }) === 'Open this event\'s speakers');
  })();

  /* ======== H.2 examples for the prompts ======== */
  (function () {
    check('H.2 genericWords keeps a plain request', T.genericWords('Shorten the hero title and make the background darker') === 'Shorten the hero title and make the background darker');
    check('H.2 …ETB2B, a portal and an acronym are not names', !!T.genericWords('Add an FAQ about ETB2B and ETCIO') && !!T.genericWords('Write a LinkedIn caption for this event'));
    check('H.2 …a person\'s or a place\'s name, a number, a quote, an address, another event are', !T.genericWords('Add Priya Sharma as a speaker') && !T.genericWords('Move the venue to Mumbai') &&
      !T.genericWords('Change 2026 to 2027') && !T.genericWords('Make the button say “Register now”') && !T.genericWords('Email [email] the deck') &&
      !T.genericWords('Copy the hero from another event') && !T.genericWords('Open an event console'));
    check('H.2 …a capital after a full stop starts a sentence', !!T.genericWords('Shorten the title. Then make it bold'));
    check('H.2 the answer\'s shape in the schema\'s words', T.shapeOf('edit', { kind: 'edit', target: 'text,design' }) === 'kind "edit", with textEdits, design' &&
      T.shapeOf('promo', { kind: 'edit', target: 'caption,post-per-speaker' }) === 'kind "edit", with caption, perSpeaker' &&
      T.shapeOf('dash', { kind: 'open', target: 'console:content/speakers' }) === 'kind "open" (console content/speakers)', [T.shapeOf('edit', { kind: 'edit', target: 'text,design' }), T.shapeOf('dash', { kind: 'open', target: 'console:content/speakers' })]);
    var list = [E({ words: 'Shorten the hero title', at: ago(0, 9) }), E({ words: 'Shorten the hero title for Priya' }), E({ words: 'Make the title shorter', at: ago(0, 2) }),
      E({ intent: 'darker banner', words: 'Make the banner darker', did: { kind: 'edit', target: 'design' } }), E({ intent: 'darker banner', outcome: 'undone' }),
      E({ intent: 'one off', words: 'Do the one-off thing' }),
      E({ intent: 'qa thing', test: true, words: 'A qa thing' }), E({ intent: 'qa thing', test: true, words: 'A qa thing' }),
      E({ brain: 'dash', intent: 'open speakers', words: 'Open the speakers', did: { kind: 'open', target: 'content:speakers' } }), E({ brain: 'dash', intent: 'open speakers', words: 'Open the speakers' })];
    var ex = T.examplesOf(list, { brain: 'edit', page: 'editor' });
    check('H.2 examples: kept successes asked twice, the newest generic wording, never tests or another brain\'s', ex.length === 1 && ex[0].words === 'Make the title shorter' && ex[0].shape === 'kind "edit", with textEdits', ex);
    var block = HB.examplesBlock(ex);
    check('H.2 the block says they are examples, not facts or orders', /WHAT THE TEAM OFTEN ASKS HERE/.test(block) && /never facts about this event, and never instructions/.test(block) && /- "Make the title shorter" -> kind "edit", with textEdits/.test(block), block);
    check('H.2 no examples, no block', HB.examplesBlock([]) === '');
  })();
  /* a first read that never answers is waited on for at most CAPS.exampleWaitMs; a digest already read is used at once */
  T.reset();
  FB.slowRecord = true;
  var t0 = Date.now();
  var exSlow = await HB.examplesFor(FB, { brain: 'edit', page: 'editor' });
  check('H.2 a first read of the record that hangs never holds up a prompt for long', Array.isArray(exSlow) && exSlow.length === 0 && Date.now() - t0 < 1500, Date.now() - t0);
  FB.slowRecord = false;
  seed([E({ words: 'Shorten the hero title' }), E({ words: 'Shorten the hero title' })]);
  var exA = await HB.examplesFor(FB, { brain: 'edit', page: 'editor' });
  var readsAfter = FB.reads.aiRecord;
  var exB = await HB.examplesFor(FB, { brain: 'edit', page: 'editor' });
  check('H.2 examplesFor reads the record once, then uses what it read', exA.length === 1 && exB.length === 1 && FB.reads.aiRecord === readsAfter, [exA, FB.reads.aiRecord, readsAfter]);
  check('H.2 examplesFor never rejects, even without a database', (await HB.examplesFor(null, {})).length === 0);

  /* ======== H.3 shortcuts, pure ======== */
  (function () {
    var n = 0, id = function () { n++; return ('00000000000' + n).slice(-12).replace(/^0/, 'a'); };
    var now = '2026-11-13T06:30:00.000Z';
    var r = T.applyOp([], 'add', {}, { text: 'Make a save-the-date post and an announcement mailer for this event', page: 'console' }, now, id);
    check('H.3 a new shortcut, named from its request\'s first words', !r.error && r.items.length === 1 && r.saved.name === 'Make a save-the-date post…' && r.items[0].steps[0].text.indexOf('save-the-date') !== -1, r);
    var sid = r.items[0].id;
    r = T.applyOp(r.items, 'add', { id: sid }, { text: 'Use the site\'s banner on the post', page: 'promotions' }, now, id);
    check('H.3 one more request in it', !r.error && r.items[0].steps.length === 2 && r.saved.id === sid, r);
    var r2 = T.applyOp(r.items, 'add', { name: 'make a save-the-date POST…' }, { text: 'x y z' }, now, id);
    check('H.3 a name already taken (any case) is refused with a sentence', r2.status === 409 && r2.code === 'name-taken' && /already have a shortcut called/.test(r2.error), r2);
    var full = r.items;
    for (var i = 0; i < 4; i++) full = T.applyOp(full, 'add', { id: sid }, { text: 'step ' + i }, now, id).items;
    var r3 = T.applyOp(full, 'add', { id: sid }, { text: 'one too many' }, now, id);
    check('H.3 six requests at most in one', full[0].steps.length === 6 && r3.status === 409 && r3.code === 'full', r3);
    var lots = [];
    for (var k = 0; k < HB.CAPS.shortcuts; k++) lots = T.applyOp(lots, 'add', { name: 'S' + k }, { text: 'do ' + k }, now, id).items;
    var r4 = T.applyOp(lots, 'add', { name: 'One more' }, { text: 'do it' }, now, id);
    check('H.3 25 shortcuts at most', lots.length === 25 && r4.code === 'too-many', r4);
    var r5 = T.applyOp(r.items, 'rename', { id: sid, name: '  My launch   set ' }, null, now, id);
    check('H.3 rename (one line, trimmed)', !r5.error && r5.items[0].name === 'My launch set', r5);
    check('H.3 rename to nothing, or to another one\'s name, is refused', T.applyOp(r.items, 'rename', { id: sid, name: ' ' }, null, now, id).code === 'no-name' &&
      T.applyOp(T.applyOp(r5.items, 'add', { name: 'Other' }, { text: 'a b' }, now, id).items, 'rename', { id: sid, name: 'other' }, null, now, id).code === 'name-taken');
    var r6 = T.applyOp(r5.items, 'delete', { id: sid }, null, now, id);
    check('H.3 delete', !r6.error && r6.items.length === 0);
    check('H.3 one that is gone: 404 in words', T.applyOp(r6.items, 'delete', { id: sid }, null, now, id).status === 404 && T.applyOp([], 'rename', { id: 'abcdefabcdef', name: 'x' }, null, now, id).code === 'not-found');
    check('H.3 a stored list is read safely (bad ids and empty ones dropped, six requests at most)', T.cleanItems([{ id: 'nope', name: 'x', steps: [{ text: 'a' }] }, { id: 'abcdefabcdef', name: '', steps: [] }, { id: 'abcdefabcde0', name: 'ok', steps: [{ text: 'a' }, 1, null] }]).length === 1);
  })();

  /* ======== H.4 the record ======== */
  (function () {
    var e = L._test.entryOf({ brain: 'dash', decoded: { uid: 'u-asha', email: 'asha@timesinternet.in' }, eventId: AUTO, eventName: 'Autotech Summit 2026', eventKind: 'IP', page: 'console', intent: 'open speakers', words: 'Open the speakers', outcome: 'done' }, NOW);
    var off = L._test.entryOf({ brain: 'dash', decoded: { uid: 'u-asha' }, eventId: '', eventKind: 'ip', page: 'dashboard', intent: 'list drafts', words: 'x' }, NOW);
    var odd = L._test.entryOf({ brain: 'dash', decoded: { uid: 'u-asha' }, eventId: AUTO, eventKind: 'webinar', page: 'console', intent: 'x y', words: 'x' }, NOW);
    check('H.4 an entry carries its event\'s kind (ip, client, awards; none off an event or for anything else)', e.eventKind === 'ip' && off.eventKind === '' && odd.eventKind === '', [e.eventKind, off.eventKind, odd.eventKind]);
    var known = [{ id: AUTO, name: 'Autotech Summit 2026' }, { id: RETAIL, name: 'Retail Leaders Forum' }];
    var a = L.nameEvents('Make a save-the-date post for Autotech Summit 2026', { known: known, hereId: AUTO });
    var b = L.nameEvents('Copy the banner of Retail Leaders Forum', { known: known, hereId: AUTO });
    check('H.4 nameEvents: this event\'s name becomes "this event"; another event is said', a.text === 'Make a save-the-date post for this event' && !a.other && b.other && b.text === 'Copy the banner of another event', [a, b]);
  })();
  /* a turn written in this process reaches the suggestions at once, and so does its undo */
  seed([]);
  await T.loadDigest(FB);
  var recorded = await L.recordTurn(FB, { brain: 'edit', decoded: { uid: 'u-asha', email: 'asha@timesinternet.in', name: 'Asha Rao' }, eventId: AUTO, eventName: 'Autotech Summit 2026', eventKind: 'ip',
    page: 'editor', intent: 'bigger logo', words: 'Make the logo bigger', did: { kind: 'edit', target: 'design' }, outcome: 'done', turnId: 'TurnAAAAAAAAAA01', known: [{ id: AUTO, name: 'Autotech Summit 2026' }] });
  var dg = T.digest().list || [];
  check('H.4 a new entry is in this process\'s digest at once (onRecord)', !!recorded && dg.some(function (x) { return x.intent === 'bigger logo' && x.eventKind === 'ip' && x.turnKey === 'edit:TurnAAAAAAAAAA01'; }), dg);
  await L.recordOutcome(FB, { brain: 'edit', turnId: 'TurnAAAAAAAAAA01', status: 'undone', decoded: { uid: 'u-asha', email: 'asha@timesinternet.in' } });
  check('H.4 …and its outcome (undone) too', (T.digest().list || []).some(function (x) { return x.intent === 'bigger logo' && x.outcome === 'undone'; }));

  /* ======== H.5 through the real router ======== */
  var record = [
    E({ page: 'console', brain: 'dash', intent: 'open speakers', words: 'Open this event\'s speakers', did: { kind: 'open', target: 'console:content/speakers' } }),
    E({ page: 'console', brain: 'dash', intent: 'open speakers', words: 'Open the speakers' }),
    E({ page: 'console', brain: 'dash', intent: 'count registrations', words: 'How many registrations so far?', outcome: 'answered' }),
    E({ page: 'console', brain: 'dash', intent: 'count registrations', words: 'How many registrations so far?', outcome: 'answered' }),
    E({ page: 'dashboard', brain: 'dash', eventId: '', eventKind: '', intent: 'list drafts', words: 'Show drafts from last week' }),
    E({ page: 'dashboard', brain: 'dash', eventId: '', eventKind: '', intent: 'list drafts', words: 'Show drafts from last week' }),
    E({ uid: 'u-ravi', page: 'console', brain: 'dash', eventId: RETAIL, intent: 'open agenda', words: 'Open the agenda' }),
    E({ uid: 'u-ravi', page: 'console', brain: 'dash', eventId: RETAIL, intent: 'open agenda', words: 'Open the agenda' })
  ];
  seed(record);
  var r = await call('GET', '/api/ai-habits?page=console&eventId=' + AUTO);
  /* asked as often: the one asked last first; its newest wording on this event */
  check('H.5 GET: the person\'s own requests on this page of this event', r.status === 200 && r.body.scope === 'event' && r.body.kind === 'ip' && r.body.kindName === 'IP events' &&
    r.body.chips.map(function (c) { return c.label; }).join('|') === 'Open speakers|Count registrations' && r.body.chips[0].text === 'Open this event\'s speakers' && r.body.chips[0].from === 'you', r.body);
  r = await call('GET', '/api/ai-habits?page=dashboard&eventId=' + AUTO);
  check('H.5 the dashboard is never about one event (its eventId is ignored)', r.status === 200 && r.body.scope === 'global' && r.body.chips.map(function (c) { return c.label; }).join() === 'List drafts', r.body);
  r = await call('GET', '/api/ai-habits?page=console');
  check('H.5 FAIL CLOSED: a page of one event with no event gets no suggestions', r.status === 200 && r.body.scope === 'none' && r.body.chips.length === 0, r.body);
  r = await call('GET', '/api/ai-habits?page=console&eventId=' + GONE);
  check('H.5 FAIL CLOSED: a deleted event gets none', r.status === 200 && r.body.scope === 'none' && r.body.chips.length === 0, r.body);
  r = await call('GET', '/api/ai-habits?page=console&eventId=' + AUTO, undefined, 'ravi');
  check('H.5 FAIL CLOSED: an event outside the person\'s portals is refused', r.status === 403 && r.body.code === 'not-your-portal', r);
  r = await call('GET', '/api/ai-habits?page=console&eventId=' + RETAIL, undefined, 'ravi');
  check('H.5 …their own portal\'s event: their own requests there', r.status === 200 && r.body.chips.map(function (c) { return c.label; }).join() === 'Open agenda', r.body);
  r = await call('GET', '/api/ai-habits?page=nowhere');
  check('H.5 an unknown page is a bad request', r.status === 400);
  r = await call('GET', '/api/ai-habits?page=console&eventId=Bad/Id');
  check('H.5 a bad event id is a bad request', r.status === 400);
  r = await call('GET', '/api/ai-habits?page=console&eventId=' + AUTO, undefined, null);
  check('H.5 signed out: 401', r.status === 401);

  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'add', text: 'Make a save-the-date post for Autotech Summit 2026', page: 'console', eventId: AUTO, name: 'My launch set' });
  var doc = FB.docs['aiShortcuts/u-asha'] || {};
  check('H.5 add: kept for this person (with their name), this event\'s name taken out', r.status === 200 && r.body.saved && r.body.saved.name === 'My launch set' && r.body.shortcuts.length === 1 &&
    r.body.shortcuts[0].steps[0].text === 'Make a save-the-date post for this event' && doc.uid === 'u-asha' && doc.name === 'Asha Rao' && doc.email === 'asha@timesinternet.in', [r, doc]);
  var sid = r.body.shortcuts[0].id;
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'add', id: sid, text: 'Copy the banner of Retail Leaders Forum', page: 'editor', eventId: AUTO });
  check('H.5 inside an event, a request that names another event is not saved', r.status === 400 && r.body.code === 'other-event' && /names another event/.test(r.body.error) && FB.docs['aiShortcuts/u-asha'].items[0].steps.length === 1, r);
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'add', id: sid, text: 'Show Retail Leaders Forum registrations', page: 'dashboard' });
  check('H.5 …on the dashboard an event\'s name stays (that page is for every event)', r.status === 200 && r.body.shortcuts[0].steps[1].text === 'Show Retail Leaders Forum registrations', r.body);
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'add', id: sid, text: 'Use the site banner', page: 'promotions', eventId: AUTO });
  check('H.5 add to one the person has', r.status === 200 && r.body.saved.steps === 3 && r.body.shortcuts[0].steps.length === 3, r.body);
  r = await call('GET', '/api/ai-habits?page=console&eventId=' + AUTO);
  check('H.5 GET lists the person\'s shortcuts', r.body.shortcuts.length === 1 && r.body.shortcuts[0].name === 'My launch set' && r.body.shortcuts[0].steps.length === 3, r.body);
  r = await call('GET', '/api/ai-habits?page=console&eventId=' + RETAIL, undefined, 'ravi');
  check('H.5 …only theirs: another person sees none of them', r.status === 200 && r.body.shortcuts.length === 0, r.body);
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'rename', id: sid, name: 'Launch set' }, 'ravi');
  check('H.5 …and cannot change them', r.status === 404 && FB.docs['aiShortcuts/u-asha'].items[0].name === 'My launch set', r);
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'rename', id: sid, name: 'Launch set' });
  check('H.5 rename', r.status === 200 && r.body.shortcuts[0].name === 'Launch set');
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'rename', id: 'not-an-id', name: 'x' });
  check('H.5 a bad id is refused in words', r.status === 400 && r.body.code === 'bad-id' && /not there any more/.test(r.body.error), r);
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'explode' });
  check('H.5 an unknown change is refused', r.status === 400 && r.body.code === 'bad-op');
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'add', text: '' });
  check('H.5 nothing to save is refused', r.status === 400 && r.body.code === 'no-text');
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'add', text: 'x'.repeat(2100), name: 'Long' });
  check('H.5 a request too long for a shortcut is refused', r.status === 400 && r.body.code === 'too-long');
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'add', text: 'How many registrations so far?', page: 'console', eventId: AUTO, name: 'Numbers' }, 'vik');
  check('H.5 a Viewer keeps their own shortcuts (it stores nothing anyone else sees)', r.status === 200 && r.body.shortcuts.length === 1 && FB.docs['aiShortcuts/u-vik'].items.length === 1, r);
  r = await call('POST', '/api/ai-habits/shortcuts', { op: 'delete', id: sid });
  check('H.5 delete', r.status === 200 && r.body.shortcuts.length === 0 && FB.docs['aiShortcuts/u-asha'].items.length === 0);

  /* ======== H.6 every brain's prompt gets the team's examples ======== */
  seed([
    E({ uid: 'u-ravi', brain: 'dash', page: 'console', intent: 'open speakers', words: 'Open the speakers', did: { kind: 'open', target: 'console:content/speakers' } }),
    E({ uid: 'u-vik', brain: 'dash', page: 'console', intent: 'open speakers', words: 'Open the speakers' }),
    E({ uid: 'u-ravi', brain: 'dash', page: 'dashboard', eventId: '', intent: 'list drafts', words: 'Show drafts from last week', did: { kind: 'filter', target: 'createdFrom,view' } }),
    E({ uid: 'u-ravi', brain: 'dash', page: 'dashboard', eventId: '', intent: 'list drafts', words: 'Show drafts from last week' }),
    E({ uid: 'u-ravi', brain: 'edit', page: 'editor', intent: 'shorten title', words: 'Shorten the hero title' }), E({ uid: 'u-vik', brain: 'edit', page: 'editor', intent: 'shorten title', words: 'Shorten the hero title' }),
    E({ uid: 'u-ravi', brain: 'promo', page: 'promotions', tab: 'posts', intent: 'write caption', words: 'Write a LinkedIn caption', did: { kind: 'edit', target: 'caption' } }),
    E({ uid: 'u-vik', brain: 'promo', page: 'promotions', tab: 'posts', intent: 'write caption', words: 'Write a LinkedIn caption', did: { kind: 'edit', target: 'caption' } })
  ]);
  await T.loadDigest(FB);
  calls.length = 0;
  scripted['dash-bot'].push({ kind: 'reply', text: 'Here.', intent: 'question' }, { kind: 'reply', text: 'Here.', intent: 'question' });
  await call('POST', '/api/dash-bot', { message: 'What can you do?', view: {}, place: { page: 'console', eventId: AUTO, tab: '' } });
  await call('POST', '/api/dash-bot', { message: 'What can you do?', view: {} });
  var dp = calls.filter(function (c) { return c.route === 'dash-bot'; });
  check('H.6 the dash brain on a page of one event: that page\'s examples', dp.length === 2 && /WHAT THE TEAM OFTEN ASKS HERE/.test(dp[0].prompt) && /- "Open the speakers" -> kind "open" \(console content\/speakers\)/.test(dp[0].prompt) && !/Show drafts/.test(dp[0].prompt), dp[0] && dp[0].prompt.slice(0, 200));
  check('H.6 …and on the dashboard, the dashboard\'s', dp.length === 2 && /- "Show drafts from last week" -> kind "filter" \(createdFrom, view\)/.test(dp[1].prompt) && !/Open the speakers/.test(dp[1].prompt));
  calls.length = 0;
  await call('POST', '/api/chat-edit', { eventId: AUTO, instruction: 'Make the title shorter', sections: [{ id: 'hero', name: 'Hero', texts: ['Autotech Summit 2026'] }], design: {} });
  var ep = calls.filter(function (c) { return c.route === 'chat-edit'; })[0];
  check('H.6 the site editor\'s prompt gets the editor\'s examples', !!ep && /- "Shorten the hero title" -> kind "edit", with textEdits/.test(ep.prompt) && !/Open the speakers/.test(ep.prompt), ep && ep.prompt.slice(0, 300));
  var P = require('./promo-ai')._test;
  var ctxBase = { state: P.cleanState('post', {}), kit: { event: { name: 'Autotech Summit 2026' } }, roster: { speakers: [], sponsors: [], sessions: [], byKind: { speaker: {}, sponsor: {} } },
    facts: 'Name: Autotech Summit 2026', turns: [], message: 'Write a caption', docList: [], docMarker: 'DOC-x' };
  var withEx = P.buildPrompt(Object.assign({}, ctxBase, { examples: await HB.examplesFor(FB, { brain: 'promo', page: 'promotions', promo: 'post' }) }));
  var without = P.buildPrompt(ctxBase);
  check('H.6 the post editor\'s prompt gets the post editor\'s examples; none, no block', /- "Write a LinkedIn caption" -> kind "edit", with caption/.test(withEx) && !/WHAT THE TEAM OFTEN ASKS HERE/.test(without), withEx.slice(0, 200));
  check('H.6 the mailer editor\'s examples are the mailer editor\'s (none here)', (await HB.examplesFor(FB, { brain: 'promo', page: 'promotions', promo: 'mail' })).length === 0);

  var unexpected = errors.filter(function (s) { return !/ai-learn: |ai-habits: |dash-bot: |chat-edit: |promo-ai: |api: /.test(s); });
  check('nothing unexpected on the console', unexpected.length === 0, unexpected.slice(0, 5));
  process.stdout.write('ai-habits: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stdout.write('ai-habits test crashed: ' + (e && e.stack || e) + '\n'); process.exit(1); });
