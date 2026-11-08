// node functions/lib/promo-ai-client.test.js — ETB2B AI in the post and mailer editors, the browser half (batch B18-ai):
//   C.1  served as it is: ES5, no markup from text, only its own routes; never sends, publishes, deletes or downloads
//   C.2  the shell (etb2b-assistant.js): the promo brain is picked up, answers only on Promotions while an editor is in
//        "Edit with AI", its rule (routePromo, on a corpus), Undo by the newest change, one handoff hop to the events
//        side, and its turns read back where the brain is not (the site editor, the console)
//   C.3  the brain (promo-ai-client.js): the lock (the open editor's event must be the page's), the change done at once
//        with Undo and its outcome reported, a new background in a second step, one post per speaker offered as the
//        person's own Download, "undo that" with no AI call, Stop, and its replay
//   C.4  the page: marketing.html loads it before the assistant; the studios load the toggle last
// No network, no browser, no AI: each file runs in a vm with stand-ins.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SHELL = fs.readFileSync(path.join(ROOT, 'etb2b-assistant.js'), 'utf8');
var BRAIN = fs.readFileSync(path.join(ROOT, 'promo-ai-client.js'), 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function flush() { return new Promise(function (r) { setImmediate(r); }); }
async function settle(n) { for (var i = 0; i < (n || 10); i++) await flush(); }

/* ======== C.1 served as it is ======== */
function es5(src) {
  var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  return !/\blet\s/.test(code) && !/\bconst\s/.test(code) && code.indexOf('=>') === -1 && code.indexOf('`') === -1 && !/\basync\s+function\b|\bawait\s/.test(code);
}
var MODE = fs.readFileSync(path.join(ROOT, 'promo-studio', 'oneworld-ai-mode.js'), 'utf8');
check('C.1 ES5: promo-ai-client.js and oneworld-ai-mode.js', es5(BRAIN) && es5(MODE));
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the regex checks ran */ }
if (esbuild) ['promo-ai-client.js', 'promo-studio/oneworld-ai-mode.js'].forEach(function (f) {
  var r = (function () { try { esbuild.transformSync(fs.readFileSync(path.join(ROOT, f), 'utf8'), { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).slice(0, 200); } })();
  check('C.1 ES5 by esbuild: ' + f, r === true, r);
});
check('C.1 no literal line separator in either file', !/[\u2028\u2029]/.test(BRAIN) && !/[\u2028\u2029]/.test(MODE));
check('C.1 the brain writes no markup', BRAIN.indexOf('innerHTML') === -1 && BRAIN.indexOf('insertAdjacentHTML') === -1);
check('C.1 the brain calls only its own two routes', (BRAIN.match(/'\/api\/[^']*'/g) || []).every(function (u) { return u === '\'/api/promo/ai-edit\'' || u === '\'/api/promo/ai-edit/turn\''; }), BRAIN.match(/'\/api\/[^']*'/g));
check('C.1 neither file publishes, deletes, sends or approves', !/\/publish|unpublish|'DELETE'|\/approve|\/payment|mlDownload|edDownload\b|mlSave\(|edSave\(/.test(BRAIN + MODE));
check('C.1 the toggle\'s markup is fixed text only (its innerHTML is the two icons and the two labels)', (MODE.match(/innerHTML/g) || []).length === 1 && /b\.innerHTML = icon \+ '<span class="mt-long"/.test(MODE));
check('C.1 both pages can load the brain and the toggle', require('./access').isServableFile('promo-ai-client.js') === true &&
  require('./access').isServableFile('promo-studio/oneworld-ai-mode.js') === true && require('./access').isServableFile('promo-studio/oneworld-ai-mode.css') === true);

/* ---------- stand-ins ---------- */
function el(props) {
  var e = { attrs: {}, listeners: {}, children: [], style: {}, hidden: false, classList: { _c: {}, add: function (c) { this._c[c] = 1; }, remove: function (c) { delete this._c[c]; }, contains: function (c) { return !!this._c[c]; }, toggle: function (c, on) { if (on) this._c[c] = 1; else delete this._c[c]; } } };
  Object.keys(props || {}).forEach(function (k) { e[k] = props[k]; });
  e.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; };
  e.setAttribute = function (k, v) { e.attrs[k] = String(v); };
  e.appendChild = function (c) { e.children.push(c); c.parentNode = e; return c; };
  e.addEventListener = function (t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); };
  e.getClientRects = function () { return e.hidden ? [] : [1]; };
  return e;
}
function makeKit() {
  var kit = { chat: null };
  kit.mount = function (host, opts) {
    var chat = { opts: opts, bubbles: [], busy: [], ideas: [], welcomes: [], undone: [],
      open: function () {}, close: function () {}, isOpen: function () { return false; }, focusInput: function () {}, fold: function () {},
      setBusy: function (on, t) { chat.busy.push(on ? t || 'on' : 'off'); }, setScope: function () {}, setContext: function () {}, divider: function () {},
      markUndone: function (fn) { chat.undone.push(fn); }, setQuickIdeas: function (l) { chat.ideas.push(l); }, setWelcome: function (w) { chat.welcomes.push(w); },
      user: function () { return {}; },
      ai: function (c, o) {
        var b = { content: c, o: o || {}, notes: [], buttons: [], undos: [],
          note: function (t) { b.notes.push(t); }, button: function (l, fn) { b.buttons.push({ label: l, fn: fn }); return {}; }, undo: function (fn) { b.undos.push(fn); return {}; } };
        chat.bubbles.push(b);
        return b;
      } };
    kit.chat = chat;
    return chat;
  };
  return kit;
}
function response(status, body) { var text = JSON.stringify(body); return { ok: status >= 200 && status < 300, status: status, text: function () { return Promise.resolve(text); } }; }
/* the open studio frame, as oneworld-ai-mode.js offers it (window.OWAi) */
function fakeStudio(o) {
  o = o || {};
  var ai = { applied: [], undos: [], bgs: [], downloads: [], active_: o.active !== false, ev: o.eventId || 'qa-ux-b18-ai-x',
    kind: function () { return o.kind || 'post'; }, eventId: function () { return ai.ev; }, active: function () { return ai.active_; },
    state: function () { return { words: [{ target: 'e1', name: 'Title', text: 'Meet our speaker' }], people: [] }; },
    apply: function (c, turnId) { ai.applied.push({ c: c, turnId: turnId }); return Promise.resolve(o.applyResult || { changed: true, done: ['Changed “Title”'], notDone: [] }); },
    background: function (url, turnId) { ai.bgs.push({ url: url, turnId: turnId }); return Promise.resolve({ changed: true, done: ['A new background'], notDone: [] }); },
    undo: function (turnId) { ai.undos.push(turnId); return Promise.resolve(o.undoResult || { ok: true }); },
    perSpeaker: function () { return Promise.resolve({ id: 'z1', count: 3, message: '3 speaker posts are ready (Instagram square).' }); },
    download: function (id) { ai.downloads.push(id); return true; }
  };
  var frame = el({ id: o.frameId || 'promo-social-frame', contentWindow: { OWAi: ai } });
  frame.classList.add('is-studio');
  return { frame: frame, ai: ai };
}
/* Promotions with the shell, the real promo brain and (optionally) a stand-in dash brain */
function page(o) {
  o = o || {};
  var kit = makeKit(), calls = [], winListeners = {};
  var mount = el({ id: 'rv-assistant' });
  mount.attrs['data-rv-assistant'] = o.page || 'promotions';
  var els = {};
  (o.studios || []).forEach(function (s) { els[s.frame.id] = s.frame; });
  var doc = { readyState: 'complete', body: el(), head: el(), activeElement: null, addEventListener: function () {},
    querySelector: function (s) { return s === '[data-rv-assistant]' ? mount : null; },
    getElementById: function (id) { return els[id] || null; }, createElement: function (t) { return el({ tagName: String(t).toUpperCase() }); } };
  var timers = [];
  var ctx = {
    document: doc, console: { log: function () {}, warn: function () {}, error: function () {} }, JSON: JSON, Promise: Promise, Date: Date, Object: Object, Array: Array,
    Math: Math, String: String, Number: Number, RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    navigator: { onLine: true }, location: { origin: 'https://x', pathname: '/marketing.html', search: '?event=' + (o.eventId || 'qa-ux-b18-ai-x') + '&tab=posts', hash: '', assign: function () {} },
    sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); if (!ms || ms < 100) setImmediate(fn); return timers.length; }, clearTimeout: function () {},
    addEventListener: function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    RevampChat: kit,
    RevampAuth: {
      whenResolved: function () { return Promise.resolve(); }, currentUser: function () { return { displayName: 'Asha Rao', email: 'asha.rao@timesinternet.in' }; },
      authedFetch: function (url, opts) {
        var body = opts && opts.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url: url, body: body });
        var a = o.answer ? o.answer(url, body) : null;
        if (a) return Promise.resolve(response(a.status || 200, a.body));
        if (/^\/api\/chat\/history/.test(url)) return Promise.resolve(response(200, o.history || { event: { id: 'qa-ux-b18-ai-x', name: 'QA' }, turns: [] }));
        return Promise.resolve(response(200, { ok: true }));
      }
    }
  };
  if (!o.noSize) { ctx.innerWidth = 1440; ctx.innerHeight = 900; }
  ctx.window = ctx; ctx.top = ctx;
  vm.createContext(ctx);
  if (o.dash) ctx.RevampDashBot = { brain: o.dash };
  if (!o.noBrain) vm.runInContext(BRAIN, ctx, { filename: 'promo-ai-client.js' });
  vm.runInContext(SHELL, ctx, { filename: 'etb2b-assistant.js' });
  return settle().then(function () { return { ctx: ctx, A: ctx.RevampAssistant, kit: kit, calls: calls, winListeners: winListeners, studios: o.studios || [] }; });
}
function fakeDash() {
  var b = { sent: [], undos: 0, at: 0 };
  b.send = function (t, opts) { b.sent.push({ text: t, opts: opts }); return Promise.resolve({ kind: 'reply' }); };
  b.welcome = function () { return { text: 'dash', quickIdeas: [{ label: 'dq', text: 'dq' }] }; };
  b.changedAt = function () { return b.at; };
  b.undoLocal = function () { b.undos++; return Promise.resolve({ ok: true }); };
  b.replay = function () { return false; };
  return b;
}
var EDIT_ANSWER = { kind: 'edit', intent: 'shorten title', summary: 'I shortened the title.', turnId: 'TURN1234567890', changes: { words: [{ target: 'e1', text: 'Meet Asha' }], people: [], subject: '', preview: '', caption: '', background: null, perSpeaker: false }, skipped: [] };

(async function main() {
  /* ======== C.2 the shell ======== */
  var A0 = (await page({ studios: [] })).A;
  var R = A0.routePromo;
  var corpus = [
    ['Shorten the title', 'promo'], ['make the subject line punchier', 'promo'], ['Write a LinkedIn caption', 'promo'], ['swap the speaker for Meera Iyer', 'promo'],
    ['make a new background for this post', 'promo'], ['make one post per speaker', 'promo'], ['make this mailer shorter', 'promo'], ['Write the preview text', 'promo'],
    ['send this mail to everyone', 'promo'], ['what does the title say?', 'promo'], ['use a social post tone', 'promo'],
    ['undo that', 'undo'], ['undo', 'undo'], ['go back', 'ask'],
    ['how many registrations do we have?', 'dash'], ['open the console', 'dash'], ['take me to the speakers page', 'dash'], ['start a new event', 'dash'],
    ['switch to ETAuto', 'dash'], ['list my events', 'dash'], ['delete this event', 'dash'], ['publish the site', 'dash'], ['take the site offline', 'dash'], ['approve it', 'dash'],
    ['Change the button to “Publish now”', 'promo'], ['what about other events?', 'dash'],
    /* registrations, visitors, sign-ups, publishing and approving as what the words are to say (verifier of B18-ai.2):
       the events side cannot hand a message back here, so these must reach the post's or mail's ETB2B AI */
    ['Write a subject line saying registrations close on Friday', 'promo'], ['Make the preview text invite visitors to the expo floor', 'promo'],
    ['Add a line to the opening paragraph that registrations are now open', 'promo'], ['Change the title to Registrations open', 'promo'],
    ['Write a LinkedIn caption saying we will publish the full agenda next week', 'promo'], ['Write a caption encouraging early sign-ups', 'promo'],
    ['Make the caption invite visitors to the expo floor', 'promo'], ['Write preview text about the waitlist opening for the masterclass', 'promo'],
    ['Make the subtitle say entries approved by the jury', 'promo'], ['Tell visitors about the expo floor', 'promo'], ['Remind everyone registrations close Friday', 'promo'],
    ['Can you say registrations close on Friday?', 'promo'], ['The subject should say registrations close Friday', 'promo'], ['Subject line: Registrations close Friday', 'promo'],
    ['registrations close on Friday, put that in the subject', 'promo'], ['I want the caption to say registrations are open', 'promo'], ['Make it say the waitlist is open', 'promo'],
    ['Change the subject. Say registrations close Friday.', 'promo'], ['Make a new post for the event', 'promo'], ['Open my draft', 'promo'],
    /* …while asking for the numbers, a page that shows them, or what only a person does, still goes to the events side */
    ['How many registrations so far?', 'dash'], ['registrations?', 'dash'], ['What is the conversion rate?', 'dash'], ['Any registrations today?', 'dash'],
    ['Who registered yesterday?', 'dash'], ['Show me the registrations', 'dash'], ['What are the visitor numbers this week?', 'dash'], ['Give me the number of sign-ups', 'dash'],
    ['Do we have a waitlist?', 'dash'], ['Could you tell me how many visitors the site had?', 'dash'], ['Open the registrations page and write a caption', 'dash'],
    ['Write a caption, then tell me how many registrations we have', 'dash'], ['Write a subject and tell me how many sign-ups we have', 'dash'],
    ['Publish this post on LinkedIn', 'dash'], ['Approve the registrations', 'dash'], ['Change the title, then publish the site', 'dash'], ['Create a new event for retail', 'dash']
  ];
  var wrong = corpus.filter(function (c) { return R(c[0], []) !== c[1]; }).map(function (c) { return [c[0], R(c[0], []), c[1]]; });
  check('C.2 the rule while an editor is in "Edit with AI" (' + corpus.length + ' messages)', !wrong.length, wrong);

  var dash = fakeDash(), st = fakeStudio();
  var p = await page({ studios: [st], dash: dash, answer: function (url) { return url === '/api/promo/ai-edit' ? { body: EDIT_ANSWER } : null; } });
  var chat = p.kit.chat;
  check('C.2 the shell picks up the promo brain that loaded before it', !!p.ctx.RevampPromoAi && chat !== null);
  var PW = p.ctx.RevampPromoAi.WELCOME, PI = p.ctx.RevampPromoAi.IDEAS;
  check('C.2 with a post in "Edit with AI", the panel\'s welcome and suggestions are the post\'s, not the events side\'s', chat.welcomes[chat.welcomes.length - 1] === PW.post &&
    /this post/.test(PW.post.text) && PW.post.suggestions === PI.post && chat.ideas[chat.ideas.length - 1] === PI.post &&
    !/registrations/i.test(JSON.stringify(PW)) && /this mail/.test(PW.mail.text) && PW.mail.suggestions === PI.mail, chat.welcomes);
  st.ai.active_ = false;
  (p.winListeners.message || []).forEach(function (fn) { fn({ origin: 'https://x', data: { rvAiMode: 'off' } }); });
  await settle();
  check('C.2 …and the events side\'s come back when it leaves "Edit with AI"', chat.welcomes[chat.welcomes.length - 1] === null &&
    JSON.stringify(chat.ideas[chat.ideas.length - 1]) === JSON.stringify([{ label: 'dq', text: 'dq' }]), chat.welcomes);
  st.ai.active_ = true;
  (p.winListeners.message || []).forEach(function (fn) { fn({ origin: 'https://x', data: { rvAiMode: 'ai' } }); });
  await settle();
  var r = await p.A.chat().opts.send('Shorten the title', {});
  await settle();
  check('C.2 on Promotions, with a post in "Edit with AI", a message about it goes to the promo brain', p.calls.some(function (c) { return c.url === '/api/promo/ai-edit'; }) && dash.sent.length === 0 &&
    r && r.kind === 'edit' && r.intent === 'shorten title' && r.status === 'applied' && r.turnId === 'TURN1234567890', r);
  await p.A.chat().opts.send('how many registrations do we have?', {});
  check('C.2 …and numbers go to the events side', dash.sent.length === 1);
  var before = st.ai.undos.length;
  await p.A.chat().opts.send('undo that', {});
  await settle();
  check('C.2 "undo that" takes back the promo brain\'s newest change, with no AI call', st.ai.undos.length === before + 1 && st.ai.undos[0] === 'TURN1234567890' &&
    p.calls.filter(function (c) { return c.url === '/api/promo/ai-edit'; }).length === 1 && dash.undos === 0);
  dash.at = Date.now() + 100000;
  await p.A.chat().opts.send('undo that', {});
  check('C.2 …unless the events side\'s change is newer', dash.undos === 1);

  st.ai.active_ = false;
  await p.A.chat().opts.send('Shorten the title', {});
  check('C.2 with no editor in "Edit with AI", the events side answers everything', dash.sent.length === 2 && dash.sent[1].text === 'Shorten the title');
  st.ai.active_ = true;

  var dash2 = fakeDash(), st2 = fakeStudio();
  var p2 = await page({ studios: [st2], dash: dash2, answer: function (url) { return url === '/api/promo/ai-edit' ? { body: { kind: 'handoff', intent: 'open page' } } : null; } });
  await p2.A.chat().opts.send('what is the event about?', {});
  await settle();
  check('C.2 a handoff goes to the events side once, said as handed from the promo brain', dash2.sent.length === 1 && dash2.sent[0].opts.handedFrom === 'promo');

  var p3 = await page({ page: 'console', studios: [st2], dash: fakeDash() });
  var w = { users: [], ais: [], user: function (t) { w.users.push(t); }, ai: function (t) { var b = { notes: [], note: function (n) { b.notes.push(n); } }; w.ais.push({ t: t, b: b }); return b; }, divider: function () {}, custom: function () {} };
  check('C.2 off Promotions the promo brain never answers', (function () { try { return p3.A.place().page === 'console'; } catch (e) { return false; } })());
  var p4 = await page({ studios: [], dash: fakeDash(), history: { event: { id: 'qa-ux-b18-ai-x', name: 'QA' }, turns: [{ brain: 'promo', editor: 'mail', question: 'Write a subject', answer: 'Done: a new subject.', status: 'undone' }] } });
  var hw = { users: [], ais: [], user: function (t) { hw.users.push(t); }, ai: function (t) { var b = { notes: [], note: function (n) { b.notes.push(n); } }; hw.ais.push({ t: t, b: b }); return b; }, divider: function () {}, custom: function () {} };
  await p4.A.chat().opts.loadHistory(hw);
  check('C.2 a promo turn read back: its words and what became of it', hw.users[0] === 'Write a subject' && hw.ais[0].t === 'Done: a new subject.' &&
    hw.ais[0].b.notes.indexOf('Done in the mailer editor, then undone.') !== -1, hw.ais.map(function (a) { return [a.t, a.b.notes]; }));

  var p4b = await page({ page: 'console', noBrain: true, studios: [], dash: fakeDash(), history: { event: { id: 'qa-ux-b18-ai-x', name: 'QA' }, turns: [{ brain: 'promo', editor: 'post', question: 'Shorten the title', answer: 'I shortened it.', status: 'applied' }] } });
  var cw = { users: [], ais: [], user: function (t) { cw.users.push(t); }, ai: function (t) { var b = { notes: [], note: function (n) { cw.ais[cw.ais.length - 1].notes.push(n); } }; cw.ais.push({ t: t, notes: [] }); return b; }, divider: function () {}, custom: function () {} };
  await p4b.A.chat().opts.loadHistory(cw);
  check('C.2 where the promo brain is not (the console), its turn is plain lines, never a change with Undo', cw.users[0] === 'Shorten the title' && cw.ais[0].t === 'I shortened it.' &&
    cw.ais[0].notes.indexOf('Done in the post editor.') !== -1, cw.ais);

  /* ======== C.3 the brain ======== */
  var other = fakeStudio({ eventId: 'autotech' });
  var p5 = await page({ studios: [other], dash: fakeDash(), answer: function () { return { body: EDIT_ANSWER }; } });
  var r5 = await p5.A.chat().opts.send('Shorten the title', {});
  check('C.3 LOCK: an editor on another event than the page\'s is never asked about or changed', r5.kind === 'refuse' && other.ai.applied.length === 0 &&
    !p5.calls.some(function (c) { return c.url === '/api/promo/ai-edit'; }) && /won’t change it/.test(p5.kit.chat.bubbles[p5.kit.chat.bubbles.length - 1].content));

  var sent = p.calls.filter(function (c) { return c.url === '/api/promo/ai-edit'; })[0];
  check('C.3 the request: this event, the editor, the message, the place and the post\'s state', sent && sent.body.eventId === 'qa-ux-b18-ai-x' && sent.body.editor === 'post' &&
    sent.body.place.page === 'promotions' && sent.body.place.eventId === 'qa-ux-b18-ai-x' && sent.body.state.words[0].target === 'e1');
  var bub = chat.bubbles.filter(function (b) { return b.content === 'I shortened the title.'; })[0];
  check('C.3 done at once through the editor, with its notes and an Undo', st.ai.applied.length === 1 && st.ai.applied[0].turnId === 'TURN1234567890' &&
    bub && bub.notes.indexOf('Done: Changed “Title”') !== -1 && bub.undos.length === 1);
  var rep = p.calls.filter(function (c) { return c.url === '/api/promo/ai-edit/turn'; });
  check('C.3 the outcome is reported (applied, then undone)', rep.length >= 2 && rep[0].body.status === 'applied' && same(rep[0].body.done, ['Changed “Title”']) && rep[1].body.status === 'undone', rep.map(function (x) { return x.body; }));
  check('C.3 the window size goes with the message and each report, for a QA note', sent && sent.body.screen === '1440x900' && rep.length >= 2 && rep.every(function (x) { return x.body.screen === '1440x900'; }), [sent && sent.body.screen, rep.map(function (x) { return x.body.screen; })]);
  check('C.3 the panel\'s Undo goes the same way, and the shell\'s marks it Undone', chat.undone.length === 1 && typeof chat.undone[0] === 'function');

  var st6 = fakeStudio();
  var BG = Object.assign({}, EDIT_ANSWER, { turnId: 'TURNBG12345678', changes: Object.assign({}, EDIT_ANSWER.changes, { words: [], background: { scene: 'a hall' } }), newPicture: { pending: true, aspect: '1:1' } });
  var p6 = await page({ studios: [st6], dash: fakeDash(), answer: function (url, body) {
    if (url !== '/api/promo/ai-edit') return null;
    return body.step === 'picture' ? { body: { url: 'https://storage.googleapis.com/b/events/qa-ux-b18-ai-x/generated/bg.png' } } : { body: BG };
  } });
  st6.ai.apply = function () { return Promise.resolve({ changed: false, done: [], notDone: [] }); };
  var r6 = await p6.A.chat().opts.send('make a new background', {});
  await settle();
  var step = p6.calls.filter(function (c) { return c.body && c.body.step === 'picture'; })[0];
  check('C.3 a new background: the second step names only the turn, and the picture goes on the post', step && same(Object.keys(step.body).sort(), ['eventId', 'step', 'turnId']) &&
    st6.ai.bgs.length === 1 && /generated\/bg\.png$/.test(st6.ai.bgs[0].url) && r6.status === 'applied', r6);
  check('C.3 …and it has its Undo once it is there', p6.kit.chat.bubbles.some(function (b) { return b.undos.length === 1; }));

  var st7 = fakeStudio();
  var PS = Object.assign({}, EDIT_ANSWER, { turnId: 'TURNPS12345678', changes: Object.assign({}, EDIT_ANSWER.changes, { words: [], perSpeaker: true }) });
  var p7 = await page({ studios: [st7], dash: fakeDash(), answer: function (url) { return url === '/api/promo/ai-edit' ? { body: PS } : null; } });
  st7.ai.apply = function () { return Promise.resolve({ changed: false, done: [], notDone: [] }); };
  await p7.A.chat().opts.send('one post per speaker', {});
  await settle();
  var pb = p7.kit.chat.bubbles.filter(function (b) { return b.buttons.length; })[0];
  check('C.3 one post per speaker: drawn, and offered as the person\'s own Download (nothing downloads by itself)', pb && pb.buttons[0].label === 'Download 3 speaker posts (ZIP)' && st7.ai.downloads.length === 0);
  pb.buttons[0].fn();
  check('C.3 …which downloads when pressed', same(st7.ai.downloads, ['z1']));

  var st8 = fakeStudio({ undoResult: { ok: false, why: 'You have changed the post since, so I left it as it is. Use Undo in the top bar to step back.' } });
  var p8 = await page({ studios: [st8], dash: fakeDash(), answer: function (url) { return url === '/api/promo/ai-edit' ? { body: EDIT_ANSWER } : null; } });
  await p8.A.chat().opts.send('Shorten the title', {});
  await settle();
  await p8.A.chat().opts.send('undo that', {});
  await settle();
  check('C.3 an Undo that cannot be done says why, and is not reported as undone', /changed the post since/.test(p8.kit.chat.bubbles[p8.kit.chat.bubbles.length - 1].content) &&
    !p8.calls.some(function (c) { return c.url === '/api/promo/ai-edit/turn' && c.body.status === 'undone'; }));

  var st9 = fakeStudio();
  var p9 = await page({ studios: [st9], dash: fakeDash(), answer: function (url) { return url === '/api/promo/ai-edit' ? { body: { kind: 'refuse', summary: 'I can’t confirm this event for you, so I won’t change anything here.' } } : null; } });
  var r9 = await p9.A.chat().opts.send('Shorten the title', {});
  check('C.3 the server\'s fail-closed refusal is said, and nothing changes', r9.kind === 'refuse' && st9.ai.applied.length === 0 && /can’t confirm/.test(p9.kit.chat.bubbles[p9.kit.chat.bubbles.length - 1].content));
  var p10 = await page({ studios: [fakeStudio()], dash: fakeDash(), answer: function (url) { return url === '/api/promo/ai-edit' ? { status: 429, body: { code: 'chat-rate' } } : null; } });
  var e10 = await p10.A.chat().opts.send('Shorten the title', {}).then(function () { return null; }, function (e) { return e; });
  check('C.3 a failed answer is the shell\'s sentence', e10 && /a lot of messages/.test(e10.message), e10 && e10.message);

  var st11 = fakeStudio({ applyResult: { changed: false, done: [], notDone: [] } });
  var p11 = await page({ studios: [st11], dash: fakeDash(), answer: function (url) { return url === '/api/promo/ai-edit' ? { body: EDIT_ANSWER } : null; } });
  var r11 = await p11.A.chat().opts.send('Show all the speakers', {});
  await settle();
  var rep11 = p11.calls.filter(function (c) { return c.url === '/api/promo/ai-edit/turn'; })[0];
  check('C.3 asked for what is already so: said plainly, no Undo, and not counted as a failure', r11.status === 'applied' && rep11 && rep11.body.status === 'applied' &&
    p11.kit.chat.bubbles.some(function (b) { return b.notes.indexOf('It was already like that, so nothing needed changing.') !== -1 && !b.undos.length; }), [r11, rep11 && rep11.body]);

  check('C.3 its replay: the words, and what became of the change', (function () {
    var b = p.ctx.RevampPromoAi.brain, out = { u: [], a: [] };
    var ww = { user: function (t) { out.u.push(t); }, ai: function (t) { var x = { notes: [], note: function (n) { x.notes.push(n); } }; out.a.push(x); x.t = t; return x; } };
    var ok = b.replay({ brain: 'promo', editor: 'post', question: 'q', answer: 'a', status: 'applied', done: ['Changed “Title”'] }, ww);
    return ok === true && out.u[0] === 'q' && out.a[0].t === 'a' && out.a[0].notes.indexOf('Done: Changed “Title”') !== -1 && out.a[0].notes.indexOf('Done in the post editor.') !== -1 &&
      b.replay({ brain: 'dash' }, ww) === false;
  })());

  /* ======== C.4 the pages ======== */
  var MK = fs.readFileSync(path.join(ROOT, 'marketing.html'), 'utf8');
  check('C.4 Promotions loads the brain once, before the assistant', (MK.match(/src="promo-ai-client\.js"/g) || []).length === 1 && MK.indexOf('src="promo-ai-client.js"') < MK.indexOf('src="etb2b-assistant.js"'));
  check('C.4 Promotions hears the studio\'s mode and shows ETB2B AI over it then', MK.indexOf("if (d.rvAiMode != null)") !== -1 && MK.indexOf("classList.toggle('promo-studio-ai', on)") !== -1);
  check('C.4 the site editor replays only its own changes: a promo turn goes to the shell\'s plain lines', fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8').indexOf("if (h.brain !== 'dash' && h.brain !== 'promo') { replayTurn(h); return; }") !== -1 &&
    fs.readFileSync(path.join(ROOT, 'editor-chat-client.js'), 'utf8').indexOf("if (!U || !t || t.brain === 'dash' || t.brain === 'promo') return false;") !== -1);
  ['promo-social-studio.html', 'promo-mailer-studio.html'].forEach(function (f) {
    var s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    check('C.4 ' + f + ' loads the toggle last, and its stylesheet', s.lastIndexOf('<script') === s.indexOf('<script src="promo-studio/oneworld-ai-mode.js"></script>') &&
      s.indexOf('<link rel="stylesheet" href="promo-studio/oneworld-ai-mode.css">') !== -1);
  });

  console.log('promo-ai-client: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
  if (failed) process.exit(1);
})().catch(function (e) { console.error(e); process.exit(1); });
