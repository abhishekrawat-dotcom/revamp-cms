/* node functions/lib/chat.test.js — ETB2B AI, the editor's chat (lib/api.js handleChatEdit, handleChatTurn,
   handleChatHistory), run through the real router against an in-memory Firestore with the model stubbed: every
   exchange is kept under the person who had it, the model's memory is that stored conversation with what really
   happened after each answer, answers are never cut short, "undo" is an answer of its own, a person reads only
   their own conversation (the event's approvers read all), and each exchange is a line in the event's History.
   Written for the owner's request of 28 Oct 2026 ("store the history of all chats by the name of the user").
   And a new picture (the owner, 3 Nov 2026: ETB2B AI may make ONE picture when asked, placed at once, with Undo):
   offered only to an editor that says it can place one (an older editor's prompt and schema are unchanged), asked
   for in the chat's answer and kept with the turn, then made by a second call that takes only the turn's id —
   the picture model and Storage stubbed, so nothing is paid for. */
'use strict';
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* an in-memory Firestore: documents by path; a query keeps orderBy (one field) and limit; update() takes dotted
   field paths and FieldValue.increment as Firestore does; a transaction reads at once and writes at the end.
   failSet(path) makes a write to a matching path fail (a turn that could not be kept). */
function fakeFb() {
  var docs = {}, seq = 0, updates = [], files = {}, failSets = [];
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  function put(doc, key, v) {
    var parts = key.split('.'), o = doc;
    for (var i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
    var last = parts[parts.length - 1], type = v && v.constructor && v.constructor.name;
    if (type === 'NumericIncrementTransform') o[last] = (+o[last] || 0) + v.operand;
    else if (type === 'ServerTimestampTransform') o[last] = new Date().toISOString();
    else o[last] = clone(v);
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) {
        if (failSets.some(function (re) { return re.test(p); })) return Promise.reject(new Error('UNAVAILABLE'));
        if (!(o && o.merge) || !docs[p]) docs[p] = docs[p] && o && o.merge ? docs[p] : {}; Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve();
      },
      update: function (data) {
        if (!docs[p]) return Promise.reject(new Error('NOT_FOUND'));
        updates.push({ path: p, keys: Object.keys(data) });
        Object.keys(data).forEach(function (k) { put(docs[p], k, data[k]); });
        return Promise.resolve();
      },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function runTransaction(fn) {
    var writes = [];
    var tx = {
      get: function (ref) { return ref.get(); },
      set: function (ref, data, o) { writes.push(function () { return ref.set(data, o); }); return tx; },
      create: function (ref, data) { writes.push(function () { return docs[ref.path] ? Promise.reject(new Error('ALREADY_EXISTS')) : ref.set(data); }); return tx; },
      update: function (ref, data) { writes.push(function () { return ref.update(data); }); return tx; },
      delete: function (ref) { writes.push(function () { return ref.delete(); }); return tx; }
    };
    return Promise.resolve(fn(tx)).then(function (v) {
      return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return v; });
    });
  }
  function colRef(p, order, lim) {
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(12, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(12, '0')); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function (f, dir) { return colRef(p, { f: f, desc: dir === 'desc' }, lim); },
      limit: function (n) { return colRef(p, order, n); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        if (order) list.sort(function (a, b) { var x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (order.desc ? -1 : 1); });
        if (lim) list = list.slice(0, lim);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
      } };
  }
  /* Storage: a saved file is kept with its metadata and whether it was made public; failSave makes a save fail */
  var bucket = { name: 'test-bucket', failSave: false, file: function (path) {
    return { name: path,
      save: function (bytes, o) { if (bucket.failSave) return Promise.reject(new Error('storage down')); files[path] = { bytes: bytes, metadata: (o && o.metadata) || {}, public: false }; return Promise.resolve(); },
      makePublic: function () { if (!files[path]) return Promise.reject(new Error('No such object')); files[path].public = true; return Promise.resolve(); } };
  } };
  return { db: { collection: function (n) { return colRef(n); }, runTransaction: runTransaction }, bucket: bucket, docs: docs, updates: updates, files: files,
    failSet: function (re) { failSets.push(re); }, clearFailSets: function () { failSets.length = 0; },
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, name: t === 'asha' ? 'Asha Rao' : '', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

/* the model, stubbed: it answers what the test says, and every prompt and schema it is given is kept */
const llm = require('./llm');
var prompts = [], schemas = [], answers = [], imagesSent = [], pictureChecks = [];
llm.callJson = function (prompt, schema, opts) {
  /* the look at a made picture (lib/chat-picture.js checkPicture): a clean picture, kept apart from the chat's answers */
  if (opts && opts.route === 'picture-check') {
    pictureChecks.push({ opts: opts });
    var usage = { provider: 'claude', model: 'claude-haiku-5-5', inputTokens: 1500, outputTokens: 20, usd: 0.0002 };
    if (typeof opts.onUsage === 'function') opts.onUsage(usage);
    return Promise.resolve({ parsed: { people: false, text: false, logos: false }, provider: 'claude', usage: usage });
  }
  prompts.push(prompt); schemas.push(schema); imagesSent.push((opts && opts.images) || []); return Promise.resolve({ parsed: answers.shift() });
};
/* the picture model and the WebP copies, stubbed: a picture answers what the test says (a small PNG by default),
   and every prompt and option it is given is kept */
const gemini = require('./gemini');
var imageCalls = [], imageAnswers = [];
var PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
gemini.callGeminiImage = function (prompt, opts) {
  imageCalls.push({ prompt: prompt, opts: opts || {} });
  return Promise.resolve(imageAnswers.length ? imageAnswers.shift() : { mimeType: 'image/png', base64: PNG, provider: 'gemini', model: 'stub', usage: { provider: 'gemini', inputTokens: 300, outputTokens: 1290, pictures: 1 } });
};
const picturesLib = require('./pictures');
var variantsMade = [];
picturesLib.storeVariants = function (fb, path, bytes, opts) { variantsMade.push({ path: path, opts: opts || {} }); return Promise.resolve(null); };
const api = require('./api');
const hooks = api._testHooks;
const chatPicture = require('./chat-picture');

function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (who !== null) headers.authorization = 'Bearer ' + (who || 'asha');
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body ? JSON.stringify(body) : '') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* not json */ } resolve({ status: res.statusCode, body: j }); } };
    api.handleApi(req, res);
  });
}
function wait() { return new Promise(function (r) { setTimeout(r, 30); }); }
function turnsOf(eventId, uid) {
  var pre = 'events/' + eventId + '/aiChats/' + uid + '/turns/';
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf(pre) === 0; }).map(function (k) { return Object.assign({ id: k.split('/').pop() }, FB.docs[k]); })
    .sort(function (a, b) { return a.at < b.at ? -1 : 1; });
}
function activityOf(eventId) {
  var pre = 'events/' + eventId + '/activity/';
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf(pre) === 0; }).map(function (k) { return FB.docs[k]; });
}
function reply(summary) { return { kind: 'reply', summary: summary, design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [] }; }
var EV = 'qa-chat', SECTIONS = [{ id: 'overview', name: 'Overview', texts: ['Where India meets'] }, { id: 'agenda', name: 'Agenda', texts: ['Day one'] }];
FB.docs['events/' + EV] = { name: 'QA Chat', createdAt: '2026-10-28T00:00:00Z' };

(async function () {
  /* signed out: no answer, nothing spent */
  var out = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'hi', sections: SECTIONS }, null);
  ok(out.status === 401 && !prompts.length, 'a request with no sign-in is refused before the model is asked', out.status);

  /* a question: answered in full (never cut at 400 characters), kept under the person who asked, a line in the History */
  var LONG = 'Your site has these sections: ' + Array(40).join('Overview, Agenda, Speakers, ') + 'and the footer. None of them are hidden.';
  answers.push(reply(LONG));
  out = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'what sections does my site have?', sections: SECTIONS, focus: { sectionId: 'overview', name: 'Overview' } });
  ok(out.status === 200 && out.body.kind === 'reply' && out.body.summary === LONG && LONG.length > 1000, 'a long answer comes back whole', out.body && out.body.summary && out.body.summary.length);
  var mine = turnsOf(EV, 'u-asha');
  ok(mine.length === 1 && mine[0].question === 'what sections does my site have?' && mine[0].answer === LONG && mine[0].status === 'answered' && mine[0].focus === 'Overview' && out.body.turnId === mine[0].id,
    'the exchange is kept under the person who had it, with the question, the full answer and its turn id', JSON.stringify(mine[0] && { q: mine[0].question, s: mine[0].status, f: mine[0].focus }));
  ok(FB.docs['events/' + EV + '/aiChats/u-asha'].name === 'Asha Rao' && FB.docs['events/' + EV + '/aiChats/u-asha'].email === 'asha@timesinternet.in', 'the person is kept by name and e-mail');
  await wait();
  ok(activityOf(EV).some(function (l) { return l.action === 'ai-chat' && l.by === 'asha@timesinternet.in' && /Asked ETB2B AI: “what sections does my site have\?” — answered/.test(l.detail) && l.area === 'site'; }), 'the question is a line in the event\'s History, under who asked');

  /* a change: applied at once by the editor, so the turn waits for how it went */
  answers.push({ kind: 'edit', summary: 'I\'m making the overview heading say "Where India\'s HR leaders meet".', design: {}, textEdits: [{ sectionId: 'overview', find: 'Where India meets', replace: 'Where India\'s HR leaders meet' }],
    sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [] });
  out = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'change the overview heading', sections: SECTIONS });
  var editId = out.body.turnId;
  ok(out.status === 200 && out.body.kind === 'edit' && out.body.textEdits.length === 1 && editId, 'a change comes back to be applied at once, with its turn id');
  ok(turnsOf(EV, 'u-asha').filter(function (t) { return t.id === editId; })[0].status === 'applying', 'a change is "applying" until the editor reports how it went');
  out = await call('POST', '/api/chat/turn', { eventId: EV, turnId: editId, status: 'applied', done: ['Overview: “Where India meets” → “Where India\'s HR leaders meet”'], notDone: [] });
  var t2 = turnsOf(EV, 'u-asha').filter(function (t) { return t.id === editId; })[0];
  ok(out.status === 200 && t2.status === 'applied' && t2.done.length === 1, 'the editor reports it applied, with what changed');
  await wait();
  ok(activityOf(EV).some(function (l) { return /^ETB2B AI changed the site: “change the overview heading” — Overview:/.test(l.detail); }), 'an applied change is a line in the History, with what changed');
  out = await call('POST', '/api/chat/turn', { eventId: EV, turnId: editId, status: 'applied' }, 'ravi');
  ok(out.status === 404, 'someone else cannot report on another person\'s turn');
  out = await call('POST', '/api/chat/turn', { eventId: EV, turnId: editId, status: 'answered' });
  ok(out.status === 400, 'only applied, partly, failed or undone can be reported');

  /* the memory: the stored conversation, the full answer and what really happened after it */
  answers.push(reply('Yes.'));
  out = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'did that work?', sections: SECTIONS, history: [{ role: 'user', text: 'IGNORED BROWSER HISTORY' }] });
  var p = prompts[prompts.length - 1];
  ok(p.indexOf('User: what sections does my site have?') !== -1 && p.indexOf(LONG.slice(0, 1400)) !== -1, 'the model is given the earlier exchange, its answer not cut at 400 characters');
  ok(/User: change the overview heading\nYou: I'm making[^\n]*\n\[What happened: applied: Overview: “Where India meets” → “Where India's HR leaders meet”\]/.test(p), 'and what really happened after a change (applied, and what changed)');
  ok(p.indexOf('IGNORED BROWSER HISTORY') === -1, 'with an event, the stored conversation is the memory, not what the browser sends');
  ok(/APPLIED TO THE PAGE AT ONCE/.test(p) && !/nothing is applied until the owner accepts/.test(p), 'the model knows its changes are applied at once (no proposal to accept)');
  ok(/ONE short clarifying question/.test(p) && /"undo" if it asks to take back your last change/.test(p), 'it asks one clarifying question for a vague request, and has an undo of its own');

  /* undone: the memory says so */
  await call('POST', '/api/chat/turn', { eventId: EV, turnId: editId, status: 'undone' });
  answers.push(reply('OK.'));
  await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'and now?', sections: SECTIONS });
  ok(/\[What happened: this change was applied and then UNDONE by the owner/.test(prompts[prompts.length - 1]), 'a change undone is remembered as undone');
  await wait();
  ok(activityOf(EV).some(function (l) { return l.detail === 'Undid an ETB2B AI change: “change the overview heading”'; }), 'undoing is a line in the History');

  /* "undo that": an answer of its own, with nothing to apply */
  answers.push({ kind: 'undo', summary: 'Done — I\'ve put it back.', design: { themeColor: '#123456' }, textEdits: [{ sectionId: 'overview', find: 'x', replace: 'y' }], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [] });
  out = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'undo that', sections: SECTIONS });
  ok(out.body.kind === 'undo' && !Object.keys(out.body.design).length && !out.body.textEdits.length, '"undo that" comes back as an undo with nothing else to apply (never a guess at the old look)');

  /* each person reads their own conversation; the approvers read all */
  answers.push(reply('Hello Ravi.'));
  await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'hello', sections: SECTIONS }, 'ravi');
  out = await call('GET', '/api/chat/history?eventId=' + EV);
  ok(out.status === 200 && out.body.turns.length === 5 && out.body.turns[0].question === 'what sections does my site have?' && out.body.turns.every(function (t) { return t.question !== 'hello'; }),
    'a person reads their own conversation, oldest first — never another person\'s', JSON.stringify(out.body.turns.map(function (t) { return t.question; })));
  out = await call('GET', '/api/chat/history?eventId=' + EV, null, 'ravi');
  ok(out.body.turns.length === 1 && out.body.turns[0].answer === 'Hello Ravi.', 'and the other person reads theirs');
  out = await call('GET', '/api/chat/history?eventId=' + EV + '&all=1');
  ok(out.status === 403, 'everyone\'s conversations: refused while no approvers are named');
  FB.docs['config/approvals'] = { approvers: ['asha@timesinternet.in'] };
  out = await call('GET', '/api/chat/history?eventId=' + EV + '&all=1');
  ok(out.status === 200 && out.body.people.length === 2 && out.body.people.some(function (x) { return x.name === 'Asha Rao' && x.turns.length === 5; }) && out.body.people.some(function (x) { return x.email === 'ravi@timesinternet.in' && x.turns.length === 1; }),
    'an approver reads every conversation, each under the person\'s name', JSON.stringify(out.body));
  out = await call('GET', '/api/chat/history?eventId=' + EV + '&all=1', null, 'ravi');
  ok(out.status === 403, 'someone who is not an approver cannot');

  /* an event that does not exist: no answer, nothing spent */
  var before = prompts.length;
  out = await call('POST', '/api/chat-edit', { eventId: 'qa-no-such-event', instruction: 'hi', sections: SECTIONS });
  ok(out.status === 404 && prompts.length === before, 'a chat for an event that does not exist is refused before the model is asked', out.status);

  /* it sees the page: the editor's pictures of it go to the model, and the model is told what they show */
  var JPEG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');
  answers.push(reply('The hero is crowded.'));
  await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'check my design', sections: SECTIONS, view: [JPEG, JPEG, JPEG], viewWhat: 'page' });
  var lastImgs = imagesSent[imagesSent.length - 1];
  ok(lastImgs.length === 3 && lastImgs[0].mimeType === 'image/jpeg' && lastImgs[0].data === Buffer.from('fake-jpeg-bytes').toString('base64'), 'the pictures of the page go to the model', JSON.stringify(lastImgs.map(function (i) { return i.mimeType; })));
  ok(/You can SEE the page: the last 3 pictures with this message are screenshots of the site as it looks in the editor right now — the WHOLE page, top to bottom/.test(prompts[prompts.length - 1]) && /Never say you cannot see the page/.test(prompts[prompts.length - 1]),
    'the model is told what it sees (the whole page) and never to say it cannot see it');
  answers.push(reply('OK.'));
  await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'check it', sections: SECTIONS, view: [JPEG], viewWhat: 'page', viewLeftOut: 12, viewUndrawn: ['Sponsors'] });
  ok(/LIMITS OF THE SCREENSHOTS, NOT OF THE PAGE: 12 pictures are left out of the screenshots and shown as hatched grey boxes marked "picture"[^;]*; the section "Sponsors" is not in the screenshots \(or shown as a grey block marked "could not be drawn"\)\. Never report these as problems on the page/.test(prompts[prompts.length - 1]),
    'what the screenshots leave out is said, and never to be reported as a problem on the page');
  answers.push(reply('OK.'));
  await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'hi', sections: SECTIONS });
  ok(imagesSent[imagesSent.length - 1].length === 0 && /No screenshot of the page came with this message/.test(prompts[prompts.length - 1]) && /never say "I can't see the page"/.test(prompts[prompts.length - 1]), 'with no picture, the model answers from the text and never says it cannot see the page');
  ok(hooks.chatView({ view: [JPEG, JPEG, JPEG, JPEG, JPEG] }, 2).length === 2, 'never more pictures than the call has room for (six with the owner\'s own)');
  ok(hooks.chatView({ view: ['data:image/svg+xml;base64,PHN2Zz4=', 'https://evil.example/x.jpg', 'data:image/jpeg;base64,' + 'A'.repeat(1300000)] }, 6).length === 0, 'only a JPEG or PNG drawing of the page, and not a huge one');

  /* a person's turns in a window: a runaway loop cannot spend without bound */
  var t0 = 1e12, allowed = 0;
  for (var i = 0; i < hooks.CHAT_RATE.max + 5; i++) if (hooks.chatRateOk('loop-user', t0 + i)) allowed++;
  ok(allowed === hooks.CHAT_RATE.max && hooks.chatRateOk('loop-user', t0 + hooks.CHAT_RATE.windowMs + 10), 'at most ' + hooks.CHAT_RATE.max + ' turns in ' + (hooks.CHAT_RATE.windowMs / 60000) + ' minutes, then again');

  /* ---------- a new picture (the owner, 3 Nov 2026) ---------- */
  var EVP = 'qa-chat-pic', OWN = 'https://storage.googleapis.com/test-bucket/events/' + EVP + '/';
  FB.docs['events/' + EVP] = { name: 'QA Picture Summit', createdAt: '2026-11-03T00:00:00Z' };
  /* the page as a picture-making editor describes it: role, banner slot, pictures and this event's own picture addresses */
  var PIC_SECTIONS = [
    { id: 'nav', name: 'Navigation', texts: ['Home'], role: 'nav', pics: { slots: 0, list: [], background: false, heroTarget: '', own: [] } },
    { id: 'hero', name: 'Hero banner', texts: ['QA Picture Summit'], role: 'hero', heroMode: 'dark', pics: { slots: 0, list: [], background: true, heroTarget: 'background', own: [OWN + 'generated/1-hero.png'] } },
    { id: 'overview', name: 'Overview', texts: ['Where leaders meet'], role: '', pics: { slots: 1, list: ['a hall'], background: false, heroTarget: '', own: [OWN + 'generated/1-overview.png', 'https://evil.example/secret-own.png'] } },
    { id: 'agenda', name: 'Agenda', texts: ['Day one'], role: '', pics: { slots: 0, list: [], background: false, heroTarget: '', own: [] } },
    { id: 'speakers', name: 'Speakers', texts: ['Asha Verma', 'Chief People Officer'], role: 'records', pics: { slots: 0, list: [], background: false, heroTarget: '', own: [] } },
    { id: 'footer', name: 'Footer', texts: ['Contact us'], role: 'footer', pics: { slots: 0, list: [], background: false, heroTarget: '', own: [] } }
  ];
  function picSections() { return clone(PIC_SECTIONS); }
  function edit(summary, extra) { return Object.assign({ kind: 'edit', summary: summary, design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [], newPictures: [] }, extra || {}); }
  function chatPic(body, who) { return call('POST', '/api/chat-edit', Object.assign({ eventId: EVP, sections: picSections(), canMakePictures: true, design: { themeColor: '#AA3300' } }, body), who || 'meera'); }
  function picStep(turnId, who, eventId) { return call('POST', '/api/chat-edit', { eventId: eventId || EVP, step: 'picture', turnId: turnId }, who || 'meera'); }
  function turnById(eventId, uid, id) { return turnsOf(eventId, uid).filter(function (t) { return t.id === id; })[0]; }

  /* an older editor (no canMakePictures): its prompt and schema are exactly what they were, whatever else it sends */
  var OLD = { instruction: 'make it green', attachmentCount: 1, seenPictures: 1, seenNumbers: [1], viewCount: 1, viewWhat: 'page', focus: { sectionId: 'overview', name: 'Overview' }, design: { themeColor: '#123456' },
    sections: [{ id: 'hero', name: 'Hero', texts: ['Big Event'], buttons: ['Register'] }, { id: 'overview', name: 'Overview', texts: ['Day one'], hidden: true }] };
  var WITH_FIELDS = clone(OLD);
  WITH_FIELDS.sections.forEach(function (s) { s.role = 'hero'; s.video = true; s.heroMode = 'dark'; s.pics = { slots: 2, list: ['the hall'], background: true, heroTarget: 'background', own: [OWN + 'x.png'] }; });
  WITH_FIELDS.picturesLeft = 3; WITH_FIELDS.picturesPerDay = 20; WITH_FIELDS.ownerGraphics = true;
  var oldPrompt = hooks.buildChatPrompt(clone(OLD)), oldSchema = hooks.chatResponseSchema(clone(OLD));
  ok(hooks.buildChatPrompt(clone(WITH_FIELDS)) === oldPrompt && JSON.stringify(hooks.chatResponseSchema(clone(WITH_FIELDS))) === JSON.stringify(oldSchema),
    'without canMakePictures the prompt and the schema are byte for byte the same, whatever picture fields an editor sends');
  ok(oldPrompt.indexOf('What you still cannot do: make a new picture yourself (a section keeps the pictures it has; a picture the owner attaches to a message can be placed as described above); add or edit') !== -1 &&
    oldPrompt.indexOf('newPictures') === -1 && !/"role"|"banner"/.test(oldPrompt), 'an older editor\'s prompt still says the AI cannot make a picture, and offers nothing new');
  ok(!oldSchema.properties.newPictures && oldSchema.required.join() === 'kind,summary,design,textEdits,sectionEdits,sectionOps,newSections,newForms,ctaLinks,formEmbeds', 'and its schema has no newPictures', oldSchema.required.join());
  /* through the route: a model that answers a picture anyway to an older editor is not heard */
  answers.push(edit('I\'m making a new banner picture.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'the Mumbai skyline at dusk', kind: 'place', alt: 'Mumbai at dusk' }] }));
  out = await call('POST', '/api/chat-edit', { eventId: EVP, instruction: 'make a new hero picture of the Mumbai skyline at dusk', sections: picSections() }, 'meera');
  var oldTurn = turnById(EVP, 'u-meera', out.body.turnId);
  ok(out.status === 200 && !out.body.newPicture && !oldTurn.newPicture && schemas[schemas.length - 1].properties.newPictures === undefined, 'an older editor is never answered with a picture it cannot place', JSON.stringify(out.body));

  /* a picture-making editor: the schema asks for newPictures, with the page's section ids */
  var picPayload = { instruction: 'make a new hero picture', sections: picSections(), canMakePictures: true, hasEvent: true, eventId: EVP, picturesLeft: 20, picturesPerDay: 20 };
  var picSchema = hooks.chatResponseSchema(clone(picPayload));
  var npItem = picSchema.properties.newPictures && picSchema.properties.newPictures.items;
  ok(picSchema.properties.newPictures && picSchema.properties.newPictures.type === 'ARRAY' && picSchema.required.indexOf('newPictures') !== -1 &&
    npItem && npItem.properties.sectionId.enum.join() === PIC_SECTIONS.map(function (s) { return s.id; }).join(), 'with canMakePictures, newPictures is required and its sectionId is one of the page\'s sections', JSON.stringify(picSchema.properties.newPictures));
  ok(hooks.chatResponseSchema({ sections: [], canMakePictures: true }).properties.newPictures.items.properties.sectionId.enum === undefined || hooks.chatResponseSchema({ sections: [], canMakePictures: true }).properties.newPictures.items.properties.sectionId.enum.length > 0,
    'a schema enum is never empty (a model rejects one)');

  /* phase 1 through the route: the banner, asked for in words that name it */
  var SUBJECT = 'the Mumbai skyline at dusk seen from across the bay, warm lights along the sea front, a calm sky in deep blue and amber, gentle reflections on the water and soft haze over the towers';
  answers.push(edit('I\'m making a new banner picture of Mumbai\'s skyline at dusk; it takes about half a minute.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: SUBJECT, kind: 'place', alt: 'The Mumbai skyline at dusk' }] }));
  out = await chatPic({ instruction: 'make a new hero picture of the Mumbai skyline at dusk' });
  var p1 = prompts[prompts.length - 1], np = out.body.newPicture, heroTurnId = out.body.turnId;
  ok(out.status === 200 && out.body.kind === 'edit' && np && np.n === 1 && np.sectionId === 'hero' && np.placement === 'hero' && np.apply === 'swap' && np.kind === 'place' && np.alt === 'The Mumbai skyline at dusk',
    'the answer carries newPicture: the banner, number 1, swapped in place', JSON.stringify(out.body));
  ok(np && np.subject.length <= 140 && SUBJECT.indexOf(np.subject.replace(/…$/, '')) === 0, 'the answer\'s subject is shortened for display', np && np.subject);
  var heroTurn = turnById(EVP, 'u-meera', heroTurnId);
  ok(heroTurn && heroTurn.status === 'applying' && heroTurn.newPicture && heroTurn.newPicture.state === 'asked' && heroTurn.newPicture.subject === SUBJECT &&
    heroTurn.newPicture.sectionName === 'Hero banner' && heroTurn.newPicture.heroMode === 'dark' && heroTurn.newPicture.design.themeColor === '#aa3300' && heroTurn.newPicture.n === 1,
    'the turn keeps the picture asked for: the full cleaned subject, the section\'s name, the hero\'s tone and the site\'s colour', JSON.stringify(heroTurn && heroTurn.newPicture));
  ok(Object.keys(heroTurn.newPicture).every(function (k) { return heroTurn.newPicture[k] !== undefined; }), 'and nothing in it is undefined (Firestore refuses that)');
  ok(heroTurn.newPicture.ownerSubject === true, 'the owner named the scene ("the Mumbai skyline at dusk"): the turn says so, for a subject-led picture', JSON.stringify(heroTurn.newPicture));
  ok(p1.indexOf('What you still cannot do: put words, logos or a real person into a picture you make; add or edit') !== -1 && p1.indexOf('make a new picture yourself') === -1,
    'the prompt no longer says the AI cannot make a picture, and says what it still cannot put in one');
  var lines = chatPicture.promptLines({ canMakePictures: true, hasEvent: true, eventId: EVP, picturesLeft: 20, picturesPerDay: 20, ownerGraphics: false, attachmentCount: 0, sections: picSections() });
  lines = (Array.isArray(lines) ? lines.join('\n') : String(lines)).trim();
  ok(lines && p1.indexOf(lines) !== -1 && p1.indexOf(lines) < p1.indexOf('The site\'s current design settings:'), 'the picture lines are in the prompt, before the design settings');
  ok(/New pictures left for this person today: 20 of 20/.test(p1), 'the prompt says how many new pictures this person has left today');
  ok(/"role": "hero"/.test(p1) && /"banner": "background"/.test(p1) && /"pictures": \[\s*"a hall"/.test(p1) && p1.indexOf(OWN + 'generated/1-overview.png') === -1 && p1.indexOf('secret-own') === -1 && !/"own"/.test(p1),
    'the section list shows each section\'s role, banner slot and pictures, never its own picture addresses');

  /* phase 2: the picture is made from the stored turn, stored, recorded and answered */
  var usageBefore = FB.updates.length;
  out = await picStep(heroTurnId);
  var made = out.body;
  ok(out.status === 200 && made.url && made.url.indexOf(OWN + 'generated/') === 0 && made.n === 1 && made.sectionId === 'hero' && made.placement === 'hero' && made.apply === 'swap',
    'the second step answers the new picture\'s address under this event\'s generated pictures', JSON.stringify(out.body));
  var path = made.url ? made.url.slice('https://storage.googleapis.com/test-bucket/'.length) : '';
  ok(imageCalls.length === 1 && FB.files[path] && FB.files[path].public && FB.files[path].metadata.cacheControl === picturesLib.CACHE && /-chat-place-/.test(path) && /\.png$/.test(path),
    'one picture is made, saved public with the long cache, its name saying what kind it is', path);
  ok(variantsMade.some(function (v) { return v.path === path; }), 'and its WebP copies are made');
  ok(!imageCalls[0].opts.image && imageCalls[0].opts.route === 'chat-picture' && imageCalls[0].opts.eventId === EVP && imageCalls[0].opts.timeoutMs > 0 && imageCalls[0].opts.timeoutMs <= chatPicture.TIMEOUT_MS && imageCalls[0].opts.deadlineAt > 0,
    'the picture model is given no picture to copy, the route, a timeout and a deadline', JSON.stringify(imageCalls[0].opts));
  ok(imageCalls[0].opts.aspectRatio === '16:9', 'the banner, a wide place, is asked for a wide picture', JSON.stringify(imageCalls[0].opts));
  ok(imageCalls[0].prompt.indexOf('Mumbai skyline at dusk') !== -1 && /no readable text/i.test(imageCalls[0].prompt) && imageCalls[0].prompt.indexOf('Where leaders meet') === -1,
    'its prompt is the subject under the site\'s picture rules, with no page text');
  ok(/^Create the wide picture for the hero banner/.test(imageCalls[0].prompt) && /This scene leads the picture/.test(imageCalls[0].prompt) && /Marine Drive/.test(imageCalls[0].prompt) &&
    imageCalls[0].prompt.indexOf('symbols of THIS event') === -1 && imageCalls[0].prompt.indexOf(chatPicture.NO_FIGURES) !== -1,
    'and the owner\'s scene leads it: Mumbai drawn recognisably, no symbols of the field, no people in any form', imageCalls[0].prompt.slice(0, 600));
  ok(FB.updates.slice(usageBefore).some(function (u) { return u.path === 'events/' + EVP && u.keys.indexOf('aiUsage.byRoute.chat-picture.pictures') !== -1; }) &&
    FB.docs['events/' + EVP].aiUsage.byRoute['chat-picture'].pictures === 1, 'what it cost is recorded with the event, as a picture of the chat-picture route', JSON.stringify(FB.docs['events/' + EVP].aiUsage));
  ok(pictureChecks.length === 1 && pictureChecks[0].opts.images.length === 1 && pictureChecks[0].opts.images[0].data === PNG && pictureChecks[0].opts.eventId === EVP &&
    FB.docs['events/' + EVP].aiUsage.byRoute['chat-picture-check'] && FB.docs['events/' + EVP].aiUsage.byRoute['chat-picture-check'].calls === 1 && FB.docs['events/' + EVP].aiUsage.byRoute['chat-picture-check'].claudeCalls === 1,
    'the picture is looked at once before it is used (route picture-check), and that look is recorded with the event under its own route', JSON.stringify(FB.docs['events/' + EVP].aiUsage.byRoute));
  heroTurn = turnById(EVP, 'u-meera', heroTurnId);
  ok(heroTurn.newPicture.state === 'made' && heroTurn.newPicture.url === made.url, 'the turn says the picture was made, and where it is');
  await wait();
  ok(activityOf(EVP).some(function (l) { return l.action === 'ai-chat' && /^ETB2B AI made a new picture for “Hero banner”: /.test(l.detail) && l.by === 'meera@timesinternet.in'; }), 'making it is a line in the event\'s History');
  out = await picStep(heroTurnId);
  ok(out.status === 200 && out.body.url === made.url && imageCalls.length === 1, 'asking again (a retry, a reload) answers the same picture and makes no second one');
  out = await picStep(heroTurnId, 'ravi');
  ok(out.status === 404 && imageCalls.length === 1, 'another person cannot have this person\'s picture made', out.status);
  out = await picStep('bad');
  ok(out.status === 400 && imageCalls.length === 1, 'a turn id that is not one is refused', out.status);
  out = await picStep(heroTurnId, 'meera', 'qa-no-such-event');
  ok(out.status === 404 && imageCalls.length === 1, 'so is an event that does not exist', out.status);

  /* the history and the model's memory carry the picture made */
  await call('POST', '/api/chat/turn', { eventId: EVP, turnId: heroTurnId, status: 'applied', done: ['New picture made and put in “Hero banner” (banner picture)'] }, 'meera');
  out = await call('GET', '/api/chat/history?eventId=' + EVP, null, 'meera');
  var hp = out.body.turns.filter(function (t) { return t.id === heroTurnId; })[0];
  ok(hp && hp.newPicture && hp.newPicture.url === made.url && hp.newPicture.state === 'made' && hp.newPicture.sectionId === 'hero' && hp.newPicture.sectionName === 'Hero banner' && hp.newPicture.placement === 'hero' && hp.newPicture.subject === SUBJECT,
    'the conversation read back carries the picture made', JSON.stringify(hp && hp.newPicture));
  /* a short follow-up to the picture just made is a new picture for the same place, without naming it again */
  answers.push(edit('I\'m making a brighter banner picture to replace mine.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'the Mumbai skyline at dusk, brighter, with more warm light', kind: 'place', alt: 'The Mumbai skyline at dusk' }] }));
  out = await chatPic({ instruction: 'try a brighter one' });
  var madeLine = chatPicture.historyLine(heroTurn.newPicture);
  ok(madeLine && /^\[New picture made for “Hero banner”/.test(madeLine) && prompts[prompts.length - 1].indexOf(madeLine) !== -1, 'the model remembers what it made and where', madeLine);
  ok(/New pictures left for this person today: 19 of 20/.test(prompts[prompts.length - 1]), 'and the count goes down by the picture made');
  ok(out.body.newPicture && out.body.newPicture.sectionId === 'hero' && out.body.newPicture.placement === 'hero', '"try a brighter one" right after a picture is a new picture for the same place', JSON.stringify(out.body));

  /* a refusal that was the only change: the answer is the server's sentence, nothing to apply, nothing spent */
  var RECORDS_SUMMARY = 'I\'m giving the speakers a more modern photo.';
  answers.push(edit(RECORDS_SUMMARY, { newPictures: [{ sectionId: 'speakers', placement: 'picture', slot: 0, subject: 'a modern portrait studio', kind: 'people', alt: '' }] }));
  out = await chatPic({ instruction: 'replace the speakers\' photos with something more modern' });
  var recTurn = turnById(EVP, 'u-meera', out.body.turnId);
  ok(out.status === 200 && out.body.kind === 'reply' && out.body.summary !== RECORDS_SUMMARY && out.body.summary.length > 20 && !out.body.newPicture && recTurn.status === 'answered' && !recTurn.newPicture && imageCalls.length === 1,
    'a picture refused (the speakers\' own photos) with nothing else to do is answered as a reply in the server\'s words, and the turn is answered', JSON.stringify(out.body));
  /* a refusal beside another change: the rest is applied, the sentence is one of the things not done */
  answers.push(edit('I\'m changing the overview heading and giving the speakers a new photo.', { textEdits: [{ sectionId: 'overview', find: 'Where leaders meet', replace: 'Where HR leaders meet' }], newPictures: [{ sectionId: 'speakers', placement: 'picture', slot: 0, subject: 'a modern portrait studio', kind: 'people', alt: '' }] }));
  out = await chatPic({ instruction: 'change the overview heading to Where HR leaders meet and replace the speakers\' photos' });
  ok(out.body.kind === 'edit' && out.body.textEdits.length === 1 && !out.body.newPicture && out.body.skipped.length === 1 && out.body.skipped[0].length > 20, 'beside another change, a refused picture is a thing not done and the rest is applied', JSON.stringify(out.body.skipped));
  /* never asked for: a picture the model wanted for "make the buttons green" is dropped without a word */
  answers.push(edit('I\'m making the buttons green.', { design: { themeColor: '#118833' }, newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'a green field', kind: 'place', alt: '' }] }));
  out = await chatPic({ instruction: 'make the buttons green', focus: { sectionId: 'hero', name: 'Hero banner', element: { kind: 'image' }, slot: 1 } });
  ok(out.body.kind === 'edit' && out.body.design.themeColor === '#118833' && !out.body.newPicture && !out.body.skipped.length && !turnById(EVP, 'u-meera', out.body.turnId).newPicture,
    'a picture the owner did not ask for is never made, even with the banner selected — the rest is applied', JSON.stringify(out.body));
  answers.push(edit('I\'m making a new picture for the banner.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'a green field', kind: 'place', alt: '' }] }));
  out = await chatPic({ instruction: 'make it pop', focus: { sectionId: 'hero', name: 'Hero banner' } });
  ok(out.body.kind === 'reply' && !out.body.newPicture && out.body.summary !== 'I\'m making a new picture for the banner.', 'and when it was the only change, the answer never promises a picture that is not coming', out.body.summary);

  /* a rework places it: a section with no background picture gets one through its rework, numbered after the
     owner's own attachments, and that number is used by nothing else */
  answers.push(edit('I\'m giving the agenda a background picture of a calm conference hall.', {
    sectionEdits: [{ sectionId: 'overview', instruction: 'Tighten the spacing.', pictures: [1, 3] }],
    newPictures: [{ sectionId: 'agenda', placement: 'background', slot: 0, subject: 'a calm conference hall with soft light', kind: 'place', alt: 'A calm conference hall' }] }));
  out = await chatPic({ instruction: 'give the agenda section a new background picture', attachmentCount: 2, attachments: ['https://elsewhere.example/a.jpg', 'https://elsewhere.example/b.jpg'], focus: { sectionId: 'agenda', name: 'Agenda' } });
  var rw = out.body.sectionEdits.filter(function (e) { return e.sectionId === 'agenda'; })[0], ov = out.body.sectionEdits.filter(function (e) { return e.sectionId === 'overview'; })[0];
  ok(out.body.newPicture && out.body.newPicture.n === 3 && out.body.newPicture.apply === 'rework' && out.body.newPicture.placement === 'background' && rw && rw.pictures.join() === '3' && rw.instruction.indexOf('3') !== -1,
    'a section with no background picture gets the new one through its rework, as number 3 after two attachments', JSON.stringify(out.body.sectionEdits));
  ok(ov && ov.pictures.join() === '1', 'the new picture\'s number is taken out of every other rework', ov && JSON.stringify(ov.pictures));
  ok(turnById(EVP, 'u-meera', out.body.turnId).newPicture.apply === 'rework', 'and the turn keeps that it is placed by a rework');
  /* the picture the owner selected on the page is the one replaced, among several (focus.slot, cleaned) */
  var twoPics = picSections();
  twoPics[2].pics = { slots: 2, list: ['a hall', 'a stage'], background: false, heroTarget: '', own: [] };
  answers.push(edit('I\'m replacing this picture with one of a garden terrace.', { newPictures: [{ sectionId: 'overview', placement: 'picture', slot: 0, subject: 'a garden terrace set for an evening reception', kind: 'place', alt: 'A garden terrace' }] }));
  out = await chatPic({ instruction: 'replace this picture with a new one of a garden terrace', sections: twoPics, focus: { sectionId: 'overview', name: 'Overview', element: { kind: 'image' }, slot: '2' } });
  ok(out.body.newPicture && out.body.newPicture.sectionId === 'overview' && out.body.newPicture.slot === 2 && out.body.newPicture.apply === 'swap', 'the selected picture (the second of two) is the one replaced', JSON.stringify(out.body.newPicture));
  /* one picture per message: the first is made, and the owner is told to ask for the next */
  answers.push(edit('I\'m making a new banner picture.', { newPictures: [
    { sectionId: 'hero', placement: 'hero', slot: 0, subject: 'a quiet hall at dawn', kind: 'place', alt: '' },
    { sectionId: 'agenda', placement: 'background', slot: 0, subject: 'a garden terrace', kind: 'place', alt: '' }] }));
  out = await chatPic({ instruction: 'make a new hero picture of a quiet hall at dawn' });
  ok(out.body.newPicture && out.body.newPicture.sectionId === 'hero' && out.body.skipped.indexOf(chatPicture.sentence('one')) !== -1, 'at most one picture per message: the first is made and the owner is told so', JSON.stringify(out.body.skipped));
  /* a rework that was planned around a picture that is refused is not done as briefed */
  answers.push(edit('I\'m giving the speakers a background of a stage.', {
    sectionEdits: [{ sectionId: 'speakers', instruction: 'Use attached picture 1 as the background.', pictures: [1] }],
    newPictures: [{ sectionId: 'speakers', placement: 'picture', slot: 0, subject: 'a stage', kind: 'subject', alt: '' }] }));
  out = await chatPic({ instruction: 'replace the speakers\' photos with a picture of a stage' });
  ok(out.body.kind === 'reply' && !out.body.sectionEdits.length && !out.body.newPicture, 'a rework that needed the refused picture is not sent on without it', JSON.stringify(out.body));

  /* the day's limit: none left is said before anything is made */
  var today = chatPicture.istDay(Date.now());
  FB.docs['aiQuota/u-meera'] = { day: today, made: chatPicture.PER_DAY, failed: 0, updatedAt: new Date().toISOString() };
  answers.push(edit('I\'m making a new banner picture.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'a quiet hall at dawn', kind: 'place', alt: '' }] }));
  out = await chatPic({ instruction: 'make a new hero picture of a quiet hall at dawn' });
  ok(/New pictures left for this person today: 0 of 20/.test(prompts[prompts.length - 1]), 'with none left today, the prompt says so');
  ok(out.body.kind === 'reply' && !out.body.newPicture && imageCalls.length === 1, 'and a picture asked for is answered with the limit, nothing made', out.body.summary);
  /* the limit holds in the second step too, read in its transaction */
  delete FB.docs['aiQuota/u-meera'];
  answers.push(edit('I\'m making a new banner picture.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'a quiet hall at dawn', kind: 'place', alt: '' }] }));
  out = await chatPic({ instruction: 'make a new hero picture of a quiet hall at dawn' });
  var lateId = out.body.turnId;
  ok(out.body.newPicture, 'a picture asked for while some are left', JSON.stringify(out.body));
  FB.docs['aiQuota/u-meera'] = { day: today, made: chatPicture.PER_DAY, failed: 0, updatedAt: new Date().toISOString() };
  out = await picStep(lateId);
  ok(out.status === 429 && out.body.code === 'chat-picture-limit' && out.body.error && imageCalls.length === 1, 'is refused at the second step once the day\'s limit is reached meanwhile, nothing made', JSON.stringify(out.body));
  delete FB.docs['aiQuota/u-meera'];

  /* the picture model refuses: plain words, nothing saved, the turn failed, a retry is not paid twice */
  answers.push(edit('I\'m making a new banner picture.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'a lit stage in a quiet hall', kind: 'place', alt: '' }] }));
  out = await chatPic({ instruction: 'make a new hero picture of a lit stage' });
  var blockedId = out.body.turnId, filesBefore = Object.keys(FB.files).length;
  imageAnswers.push(Object.assign(gemini.failure('ai-blocked'), { provider: 'gemini', usage: { provider: 'gemini', inputTokens: 300, outputTokens: 0, pictures: 0 } }));
  out = await picStep(blockedId);
  ok(out.status === 422 && out.body.code === 'ai-blocked' && /Nothing on your site changed/.test(out.body.error) && Object.keys(FB.files).length === filesBefore && turnById(EVP, 'u-meera', blockedId).newPicture.state === 'failed',
    'a refusal by the picture model is said in plain words, with nothing saved and the turn failed', JSON.stringify(out.body));
  var callsNow = imageCalls.length;
  out = await picStep(blockedId);
  ok(out.status === 422 && imageCalls.length === callsNow, 'asking that turn again answers the same failure without a new call');

  /* the turn could not be kept: the picture cannot be made from it, so it is not offered */
  FB.failSet(new RegExp('^events/' + EVP + '/aiChats/u-meera/turns/'));
  answers.push(edit('I\'m making a new banner picture.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'a quiet hall at dawn', kind: 'place', alt: '' }] }));
  out = await chatPic({ instruction: 'make a new hero picture of a quiet hall at dawn' });
  FB.clearFailSets();
  ok(out.status === 200 && out.body.notKept && !out.body.newPicture && out.body.kind === 'reply' && /could not be started/.test(out.body.summary), 'a picture whose turn was not kept is not offered, and the owner is told to ask again', JSON.stringify(out.body));

  /* no event: no picture can be made (there is no turn to make it from) */
  answers.push(edit('I\'m making a new banner picture.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'a quiet hall', kind: 'place', alt: '' }] }));
  out = await call('POST', '/api/chat-edit', { instruction: 'make a new hero picture of a quiet hall', sections: picSections(), canMakePictures: true }, 'meera');
  ok(/You cannot make new pictures here: this site does not belong to an event yet/.test(prompts[prompts.length - 1]), 'with no event, the prompt says no picture can be made here');
  ok(out.status === 200 && !out.body.newPicture && out.body.kind === 'reply', 'and a picture asked for is answered in words, nothing made', JSON.stringify(out.body));

  /* ---------- the second review of 3 Nov 2026, through the route ---------- */
  var callsAtReview = imageCalls.length;
  /* a real person the model put in the subject never reaches the picture model */
  answers.push(edit('I\'m making a new banner picture of Mukesh Ambani welcoming delegates.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'Mukesh Ambani welcoming delegates at the entrance', kind: 'people', alt: 'Mukesh Ambani' }] }));
  out = await chatPic({ instruction: 'make a new hero picture of Mukesh Ambani welcoming delegates' });
  var ambaniTurn = turnById(EVP, 'u-meera', out.body.turnId);
  ok(out.status === 200 && out.body.kind === 'reply' && !out.body.newPicture && out.body.summary === chatPicture.sentence('name') && ambaniTurn && !ambaniTurn.newPicture && ambaniTurn.status === 'answered' && imageCalls.length === callsAtReview,
    '"Mukesh Ambani welcoming delegates" is refused in plain words: no picture is asked for, nothing is made', JSON.stringify(out.body));
  /* a name written on a section that is not Content's records, or in the event's own fields, is a real person too */
  var namedSecs = picSections();
  namedSecs[2].texts = ['Inaugural address by Nitin Gadkari, Union Minister'];
  FB.docs['events/' + EVP].description = 'Chief guest: Kavita Menon, on the future of work.';
  var NAMED_SUBJECTS = [['Nitin Gadkari delivering the inaugural address to a packed hall', 'name'], ['nitin gadkari delivering the inaugural address to a packed hall', 'person'],
    ['Gadkari delivering the inaugural address to a packed hall', 'person'], ['kavita menon cutting the ribbon in the hall', 'person']];
  for (var ns = 0; ns < NAMED_SUBJECTS.length; ns++) {
    answers.push(edit('I\'m making a new picture for the overview.', { newPictures: [{ sectionId: 'overview', placement: 'picture', slot: 0, subject: NAMED_SUBJECTS[ns][0], kind: 'people', alt: '' }] }));
    out = await chatPic({ instruction: 'make a new picture for the overview', sections: namedSecs });
    ok(out.body.kind === 'reply' && !out.body.newPicture && out.body.summary === chatPicture.sentence(NAMED_SUBJECTS[ns][1]) && imageCalls.length === callsAtReview,
      'a name taken from the page\'s Overview or the event\'s description is refused: "' + NAMED_SUBJECTS[ns][0] + '"', JSON.stringify(out.body));
  }
  delete FB.docs['events/' + EVP].description;
  /* a rework briefed around a new picture the model never asked for is not sent, and the summary that promised
     one is not shown: the owner is told no picture was made */
  answers.push(edit('I\'m giving the agenda a new background picture.', { sectionEdits: [{ sectionId: 'agenda', instruction: 'Use attached picture 1 as this section\'s background picture.', pictures: [1] }], newPictures: [] }));
  out = await chatPic({ instruction: 'give the agenda a new background picture' });
  var lostTurn = turnById(EVP, 'u-meera', out.body.turnId);
  ok(out.body.kind === 'reply' && !out.body.sectionEdits.length && !out.body.newPicture && out.body.summary === chatPicture.sentence('notMade') && lostTurn && lostTurn.status === 'answered' && !lostTurn.newPicture && imageCalls.length === callsAtReview,
    'a rework listing the new picture\'s number while no picture is asked for is not sent: no redesign, no picture, and the owner is told', JSON.stringify(out.body));
  answers.push(edit('I\'m making the buttons green and giving the agenda a new background picture.', { design: { themeColor: '#118833' }, sectionEdits: [{ sectionId: 'agenda', instruction: 'Use attached picture 1 as this section\'s background picture.', pictures: [1] }], newPictures: [] }));
  out = await chatPic({ instruction: 'make the buttons green and give the agenda a new background picture' });
  ok(out.body.kind === 'edit' && out.body.design.themeColor === '#118833' && !out.body.sectionEdits.length && !out.body.newPicture && out.body.skipped.indexOf(chatPicture.sentence('notMadePart', { name: '“Agenda”' })) !== -1,
    'beside another change, that rework is a thing not done and the rest is applied', JSON.stringify(out.body));
  /* a colour or a text change worded with "background" or "banner" makes no picture, whatever the model returned */
  answers.push(edit('I\'m changing the agenda background to navy.', { sectionEdits: [{ sectionId: 'agenda', instruction: 'Make the background colour navy (#1b2a4a).', pictures: [] }],
    newPictures: [{ sectionId: 'agenda', placement: 'background', slot: 0, subject: 'a deep navy abstract texture', kind: 'graphic', alt: '' }] }));
  out = await chatPic({ instruction: 'change the agenda background colour to navy' });
  ok(out.body.kind === 'edit' && out.body.sectionEdits.length === 1 && out.body.sectionEdits[0].sectionId === 'agenda' && !out.body.newPicture && !turnById(EVP, 'u-meera', out.body.turnId).newPicture && imageCalls.length === callsAtReview,
    '"change the agenda background colour to navy" changes the colour and makes no picture', JSON.stringify(out.body));
  answers.push(edit('I\'m making the banner text bigger.', { sectionEdits: [{ sectionId: 'hero', instruction: 'Make the heading text larger.', pictures: [] }],
    newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'a bold stage under bright light', kind: 'subject', alt: '' }] }));
  out = await chatPic({ instruction: 'make the banner text bigger' });
  ok(out.body.kind === 'edit' && out.body.sectionEdits.length === 1 && !out.body.newPicture && !turnById(EVP, 'u-meera', out.body.turnId).newPicture && imageCalls.length === callsAtReview,
    '"make the banner text bigger" makes no picture', JSON.stringify(out.body));

  /* a records section with a free place (a picture ETB2B AI made beside the speakers): through the route, the owner's
     selection reaches the server, so a headshot selected is refused in the records sentence and the free picture
     selected is the one asked for */
  var freeSpeakers = picSections().map(function (s) { return s.id === 'speakers' ? Object.assign(s, { pics: { slots: 1, list: [{ label: 'A calm hall', w: 600, h: 400 }], background: false, heroTarget: '', own: [OWN + 'generated/2-chat-place-abcdefgh.png'] } }) : s; });
  answers.push(edit('I\'m making a new picture for the speakers section.', { newPictures: [{ sectionId: 'speakers', placement: 'picture', slot: 1, subject: 'a calm, softly lit conference hall', kind: 'subject', alt: 'A calm hall' }] }));
  out = await chatPic({ sections: freeSpeakers, instruction: 'replace this photo with a new picture', focus: { sectionId: 'speakers', name: 'Speakers', element: { kind: 'image', text: '' } } });
  ok(out.body.kind === 'reply' && !out.body.newPicture && out.body.summary === chatPicture.sentence('records', { name: '“Speakers”' }) && !turnById(EVP, 'u-meera', out.body.turnId).newPicture && imageCalls.length === callsAtReview,
    'a speaker\'s headshot selected: refused in the records sentence, though the section has a free picture', JSON.stringify(out.body));
  answers.push(edit('I\'m making a new picture for the speakers section.', { newPictures: [{ sectionId: 'speakers', placement: 'picture', slot: 1, subject: 'a calm, softly lit conference hall', kind: 'subject', alt: 'A calm hall' }] }));
  out = await chatPic({ sections: freeSpeakers, instruction: 'replace this picture with a new one', focus: { sectionId: 'speakers', name: 'Speakers', element: { kind: 'image', text: '' }, slot: 1 } });
  ok(out.body.newPicture && out.body.newPicture.sectionId === 'speakers' && out.body.newPicture.placement === 'picture' && out.body.newPicture.slot === 1 && out.body.newPicture.apply === 'swap' && imageCalls.length === callsAtReview,
    'the free picture selected: a new picture is asked for there (phase 1 only, nothing made yet)', JSON.stringify(out.body));
  ok(/Content's own photos and logos \(speaker headshots/.test(prompts[prompts.length - 1]) && /"pictures": \[\s*"A calm hall/.test(prompts[prompts.length - 1]),
    'the prompt tells the model the records\' own pictures are never replaced and shows the section\'s free picture');

  /* a scene named in one message ("where should it go?") and placed in the next: the server reads the owner's own
     earlier words from the stored turns, so the picture is still led by the owner's scene */
  answers.push(reply('Where should the new picture go — the banner at the top, or the background or picture of a section (which one)?'));
  out = await chatPic({ instruction: 'make a picture of the Gateway of India at sunrise' });
  answers.push(edit('I\'m making a new banner picture of the Gateway of India at sunrise.', { newPictures: [{ sectionId: 'hero', placement: 'hero', slot: 0, subject: 'The Gateway of India at sunrise over a calm harbour', kind: 'place', alt: 'The Gateway of India at sunrise' }] }));
  out = await chatPic({ instruction: 'put it in the banner as a new picture' });
  ok(out.body.newPicture && out.body.newPicture.sectionId === 'hero' && turnById(EVP, 'u-meera', out.body.turnId).newPicture.ownerSubject === true && imageCalls.length === callsAtReview,
    'a scene named in the message before and placed in this one is the owner\'s: the turn is subject-led', JSON.stringify(out.body));
  /* finding A through the route: a real speaker's photo answered as the section's background is refused in the plain sentence */
  answers.push(edit('I\'m giving the speakers section a new background picture.', { newPictures: [{ sectionId: 'speakers', placement: 'background', slot: 0, subject: 'a calm, softly lit conference hall', kind: 'subject', alt: 'A calm hall' }] }));
  out = await chatPic({ sections: freeSpeakers.map(function (s) { return s.id === 'speakers' ? Object.assign({}, s, { texts: ['Speakers', 'Rohan Mehta', 'Chief People Officer'] }) : s; }), instruction: 'replace Rohan Mehta\'s photo with an AI picture' });
  ok(out.body.kind === 'reply' && !out.body.newPicture && out.body.summary === chatPicture.sentence('records', { name: '“Speakers”' }) && imageCalls.length === callsAtReview,
    'a speaker\'s photo by name, answered by the model as the section\'s background: refused in the records sentence', JSON.stringify(out.body));

  /* ---------- Claude's strict mode: at most 24 optional parameters (QA follow-up 2 of 3 Nov 2026) ----------
     Every chat-edit was refused once in strict mode ("too many optional parameters (32) … limit 24") and asked again
     in plain mode. Counted on what claude.js really sends (toJsonSchema), for an older editor and a picture-making
     one, so a field added later that would tip it over fails here, not as a refused request on every message. */
  var claudeLib = require('./claude');
  function optionalParams(s, path, out) {
    if (!s || typeof s !== 'object') return 0;
    if (Array.isArray(s)) return s.reduce(function (n, x) { return n + optionalParams(x, path, out); }, 0);
    var n = 0, req = Array.isArray(s.required) ? s.required : [];
    if (s.properties) Object.keys(s.properties).forEach(function (k) { if (req.indexOf(k) === -1) { n++; if (out) out.push(path + k); } n += optionalParams(s.properties[k], path + k + '.', out); });
    if (s.items) n += optionalParams(s.items, path, out);
    if (s.anyOf) n += optionalParams(s.anyOf, path, out);
    return n;
  }
  function unionParams(s) {
    if (!s || typeof s !== 'object') return 0;
    if (Array.isArray(s)) return s.reduce(function (n, x) { return n + unionParams(x); }, 0);
    var n = (Array.isArray(s.type) || Array.isArray(s.anyOf)) ? 1 : 0;
    Object.keys(s).forEach(function (k) { if (k !== 'enum' && k !== 'required') n += unionParams(s[k]); });
    return n;
  }
  [['an older editor', OLD], ['a picture-making editor', Object.assign(clone(OLD), { canMakePictures: true, eventId: EVP })]].forEach(function (c) {
    var sent = claudeLib.toJsonSchema(hooks.chatResponseSchema(clone(c[1]))), names = [];
    var optional = optionalParams(sent, '', names);
    ok(optional <= 24, 'strict mode: at most 24 optional parameters in what claude.js sends for ' + c[0] + ' (it was 32)', optional + ': ' + names.join(', '));
    ok(names.every(function (k) { return /^design\./.test(k) || k === 'newForms.countsAsRegistration' || k === 'newForms.needsApproval'; }),
      'only the design patch and the two form switches are optional for ' + c[0] + ' (a list entry gives every field, "" / [] / false where it does not apply)', names.join(', '));
    ok(unionParams(sent) === 0, 'strict mode: no union types for ' + c[0]);
  });
  /* the strict shape (every field given, the unused ones empty) is read exactly as the sparse one was */
  var FORM_SECTIONS = [{ id: 'overview', name: 'Overview', texts: ['Where India meets'], buttons: ['Register now'] }, { id: 'agenda', name: 'Agenda', texts: ['Day one'] }, { id: 'footer', name: 'Footer', texts: ['Contact'] }];
  function strictCase(full) {
    function f(sparse, extra) { return full ? Object.assign({}, sparse, extra) : sparse; }
    return edit('I\'m adding a VIP form with a button in the overview, placing it before the footer, moving the agenda to the end, hiding the overview\'s old text and adding a venue section.', {
      newForms: [f({ ref: 'new-1', template: 'vip', name: 'VIP delegates', fields: [
        f({ label: 'Official email', type: 'email', required: true }, { options: [], placeholder: '', help: '' }),
        f({ label: 'First name', type: 'text', required: true }, { options: [], placeholder: '', help: '' }),
        f({ label: 'Dietary needs', type: 'select' , options: ['None', 'Vegetarian', 'Vegan'] }, { required: false, placeholder: '', help: '' })] },
        { title: '', intro: '', submitLabel: '', successMessage: '' })],
      ctaLinks: [f({ sectionId: 'overview', newButtonLabel: 'VIP access', form: 'new-1' }, { buttonText: '' }), f({ sectionId: 'overview', buttonText: 'Register now', form: 'new-1' }, { newButtonLabel: '' })],
      formEmbeds: [f({ form: 'new-1' }, { sectionId: '', afterSectionId: '', heading: '', intro: '' })],
      sectionOps: [f({ op: 'move', sectionId: 'agenda' }, { beforeSectionId: '' }), f({ op: 'hide', sectionId: 'overview' }, { beforeSectionId: '' })],
      sectionEdits: [f({ sectionId: 'agenda', instruction: 'Tighten the spacing.' }, { pictures: [] })],
      newSections: [f({ afterSectionId: 'agenda', name: 'Venue & Travel', instruction: 'Say the venue is announced soon.' }, { pictures: [] })]
    });
  }
  function shape(body) { var b = clone(body); delete b.turnId; return JSON.stringify(b); }
  answers.push(strictCase(false));
  var sparseOut = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'add a VIP delegates form with a VIP access button in the overview, put it on the page, move the agenda to the end, hide the overview and add a venue section', sections: clone(FORM_SECTIONS) });
  answers.push(strictCase(true));
  var strictOut = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'add a VIP delegates form with a VIP access button in the overview, put it on the page, move the agenda to the end, hide the overview and add a venue section', sections: clone(FORM_SECTIONS) });
  ok(sparseOut.status === 200 && strictOut.status === 200 && shape(sparseOut.body) === shape(strictOut.body), 'the strict shape ("" / [] / false where nothing is said) gives the very same answer as the sparse one', shape(sparseOut.body) + '\n      ' + shape(strictOut.body));
  var sb = strictOut.body, vip = sb.newForms[0] && sb.newForms[0].form;
  ok(vip && vip.title === 'VIP delegates' && vip.needsApproval === true && vip.countsAsRegistration === true && vip.submitLabel && vip.successMessage &&
    vip.fields.filter(function (x) { return x.label === 'Dietary needs'; })[0].required === false && vip.fields.filter(function (x) { return x.label === 'Dietary needs'; })[0].options.length === 3,
    'an empty title, button label and message are the template\'s own; the VIP template still needs approval and counts as a registration (its switches were left out)', JSON.stringify(vip));
  ok(sb.ctaLinks.length === 2 && sb.ctaLinks[0].newButtonLabel === 'VIP access' && sb.ctaLinks[0].buttonText === '' && sb.ctaLinks[1].buttonText === 'Register now' && sb.ctaLinks[1].newButtonLabel === '' &&
    sb.formEmbeds.length === 1 && sb.formEmbeds[0].sectionId === '' && sb.formEmbeds[0].heading === 'VIP delegates' && sb.formEmbeds[0].intro === 'Fill in your details below.' &&
    JSON.stringify(sb.sectionOps) === JSON.stringify([{ op: 'move', sectionId: 'agenda', beforeSectionId: '' }, { op: 'hide', sectionId: 'overview' }]) &&
    sb.sectionEdits[0].pictures.length === 0 && sb.newSections[0].pictures.length === 0 && !sb.skipped.length,
    'each "" is read as not said: a new button, an existing one, a new section for the form with its usual words, the end of the page, no pictures', JSON.stringify(sb));

  ok(chatPicture.MAX_PEOPLE_PICTURES === hooks.MAX_PEOPLE_PICTURES, 'the chat keeps the same cap on pictures of people as site generation');

  /* QA, UX-091: all five section rewrites of "make the buttons rounder" failed, the editor (an older one) reported
     "partly" with nothing done, and the History said ETB2B AI changed the site. Nothing done is "not applied". */
  answers.push(edit('I\'m turning the square-cornered buttons into fully rounded pills.', { sectionEdits: [{ sectionId: 'overview', instruction: 'Round the buttons into pills.' }, { sectionId: 'agenda', instruction: 'Round the buttons into pills.' }] }));
  out = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'make the buttons rounder', sections: SECTIONS });
  var noneId = out.body.turnId;
  out = await call('POST', '/api/chat/turn', { eventId: EV, turnId: noneId, status: 'partly', done: [], notDone: ['“Overview” was not changed: the AI could not answer (error 504).', '“Agenda” was not changed: the AI could not answer (error 504).'] });
  var none = turnsOf(EV, 'u-asha').filter(function (t) { return t.id === noneId; })[0];
  ok(out.status === 200 && out.body.status === 'failed' && none && none.status === 'failed' && none.notDone.length === 2 && !none.done.length,
    'UX-091: a change reported "partly" with nothing done is kept as not applied, with what could not be done', JSON.stringify(none && { s: none.status, d: none.done, n: none.notDone }));
  await wait();
  ok(activityOf(EV).some(function (l) { return l.detail === 'ETB2B AI could not apply: “make the buttons rounder”'; }) &&
    !activityOf(EV).some(function (l) { return /changed the site: “make the buttons rounder”/.test(l.detail); }),
    'UX-091: the History says ETB2B AI could not apply it, not that it changed the site', JSON.stringify(activityOf(EV).map(function (l) { return l.detail; }).slice(-3)));
  answers.push(edit('I\'m making the overview heading shorter.', { textEdits: [{ sectionId: 'overview', find: 'Where India meets', replace: 'India meets' }] }));
  out = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'shorten the overview heading', sections: SECTIONS });
  var partId = out.body.turnId;
  out = await call('POST', '/api/chat/turn', { eventId: EV, turnId: partId, status: 'partly', done: ['Overview: “Where India meets” → “India meets”'], notDone: ['“Agenda” was not changed.'] });
  ok(out.status === 200 && out.body.status === 'partly' && turnsOf(EV, 'u-asha').filter(function (t) { return t.id === partId; })[0].status === 'partly', 'UX-091: "partly" stays when something really changed');
  await wait();
  ok(activityOf(EV).some(function (l) { return /^ETB2B AI changed the site: “shorten the overview heading” — Overview:/.test(l.detail); }), 'UX-091: … and the History says what changed');

  if (failures.length) { console.error('chat: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('chat: all ' + checks + ' checks passed');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
