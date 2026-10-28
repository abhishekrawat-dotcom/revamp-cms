/* node functions/lib/chat.test.js — ETB2B AI, the editor's chat (lib/api.js handleChatEdit, handleChatTurn,
   handleChatHistory), run through the real router against an in-memory Firestore with the model stubbed: every
   exchange is kept under the person who had it, the model's memory is that stored conversation with what really
   happened after each answer, answers are never cut short, "undo" is an answer of its own, a person reads only
   their own conversation (the event's approvers read all), and each exchange is a line in the event's History.
   Written for the owner's request of 28 Oct 2026 ("store the history of all chats by the name of the user"). */
'use strict';
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* an in-memory Firestore: documents by path; a query keeps orderBy (one field) and limit */
function fakeFb() {
  var docs = {}, seq = 0;
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { if (!(o && o.merge) || !docs[p]) docs[p] = docs[p] && o && o.merge ? docs[p] : {}; Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve(); } };
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
  return { db: { collection: function (n) { return colRef(n); } }, bucket: { name: 'test-bucket' }, docs: docs,
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, name: t === 'asha' ? 'Asha Rao' : '', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

/* the model, stubbed: it answers what the test says, and every prompt it is given is kept */
const llm = require('./llm');
var prompts = [], answers = [], imagesSent = [];
llm.callJson = function (prompt, schema, opts) { prompts.push(prompt); imagesSent.push((opts && opts.images) || []); return Promise.resolve({ parsed: answers.shift() }); };
const api = require('./api');
const hooks = api._testHooks;

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

  if (failures.length) { console.error('chat: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('chat: all ' + checks + ' checks passed');
})().catch(function (e) { console.error(e.stack); process.exit(1); });
