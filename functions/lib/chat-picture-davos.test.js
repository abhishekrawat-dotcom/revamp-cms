/* node functions/lib/chat-picture-davos.test.js — the picture conversation, replayed from the owner's ET DAVOS 2027
   history of 16 Nov 2026 (events/et-davos-2027, read only), through the real router (lib/api.js handleApi, which wires
   lib/api-chat.js and lib/chat-picture.js) against an in-memory Firestore, with the chat model, the picture model and
   the picture check scripted: no AI call is made, nothing is paid for, production is never touched.
     (e) turns 1-2: a reply offering three pictures, then a bare "yes" the model answered "Which section would you like
         to start with?" — the first offer is made, never asked again, and the next is offered after it;
     (b) turns 3 and 5: "go ahead with this section" after an offer, and the scene given after a yes, are made — one
         confirmation is enough, and the server's own offer is made once, with its scene;
     (a) turn 4: "yes" answered "I keep names out of the pictures I make… for example a seafront at dusk" — the event's
         own place (Davos, the Swiss Alps, Zurich…) is a place, a yes never gets the names refusal, and a real person's
         name is left out by ETB2B AI itself, proposed without it and made on yes;
     (c) the examples a sentence or the prompt gives come from this event: its place, its sections, never a seafront;
     (d) turn 6: a place picture with people in it twice and nothing left — nobody asked for from the first try, a third
         try with the strictest words, then a close-up (or the owner's own picture) offered, and a yes makes it. */
'use strict';
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- an in-memory Firestore and Storage (as functions/lib/chat.test.js has them) ---------- */
function fakeFb() {
  var docs = {}, seq = 0, files = {};
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
      set: function (data, o) { if (!(o && o.merge) || !docs[p]) docs[p] = docs[p] && o && o.merge ? docs[p] : {}; Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); Object.keys(data).forEach(function (k) { put(docs[p], k, data[k]); }); return Promise.resolve(); },
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
    return Promise.resolve(fn(tx)).then(function (v) { return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return v; }); });
  }
  function colRef(p, order, lim) {
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(12, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(12, '0')); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function (f, dir) { return colRef(p, { f: f, desc: dir === 'desc' }, lim); },
      limit: function (n) { return colRef(p, order, n); },
      where: function () { return colRef(p, order, lim); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        if (order) list.sort(function (a, b) { var x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (order.desc ? -1 : 1); });
        if (lim) list = list.slice(0, lim);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
      } };
  }
  var bucket = { name: 'test-bucket', file: function (path) {
    return { name: path,
      save: function (bytes, o) { files[path] = { bytes: bytes, metadata: (o && o.metadata) || {}, public: false }; return Promise.resolve(); },
      makePublic: function () { if (!files[path]) return Promise.reject(new Error('No such object')); files[path].public = true; return Promise.resolve(); } };
  } };
  return { db: { collection: function (n) { return colRef(n); }, runTransaction: runTransaction }, bucket: bucket, docs: docs, files: files,
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, name: t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

/* ---------- the models, scripted ---------- */
var llm = require('./llm');
var prompts = [], answers = [], checkAnswers = [], checkCalls = [];
var CLEAN = { people: false, text: false, logos: false };
llm.callJson = function (prompt, schema, opts) {
  if (opts && opts.route === 'picture-check') {
    checkCalls.push({ prompt: prompt });
    return Promise.resolve({ parsed: checkAnswers.length ? checkAnswers.shift() : CLEAN, provider: 'claude', usage: { provider: 'claude', inputTokens: 1500, outputTokens: 20, usd: 0.0002 } });
  }
  prompts.push(prompt);
  var next = answers.shift();
  if (!next) return Promise.resolve({ error: 'This test scripted no answer.', code: 'ai-unavailable', status: 502 });
  return Promise.resolve({ parsed: next, provider: 'claude', model: 'claude-stub' });
};
var gemini = require('./gemini');
var imageCalls = [];
var PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]).toString('base64');
gemini.callGeminiImage = function (prompt, opts) {
  imageCalls.push({ prompt: prompt, opts: opts || {} });
  return Promise.resolve({ mimeType: 'image/png', base64: PNG, provider: 'gemini', model: 'stub', usage: { provider: 'gemini', inputTokens: 300, outputTokens: 1290, pictures: 1 } });
};
require('./pictures').storeVariants = function () { return Promise.resolve(null); };
var api = require('./api');
var cp = require('./chat-picture');

function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', authorization: 'Bearer ' + (who || 'sachi') };
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body ? JSON.stringify(body) : '') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : '', j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j }); } };
    api.handleApi(req, res);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }
function reply(summary, extra) { return Object.assign({ kind: 'reply', summary: summary, design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [], goTo: '', intent: 'ask', newPictures: [] }, extra || {}); }
function edit(summary, extra) { return reply(summary, Object.assign({ kind: 'edit', intent: 'new picture' }, extra || {})); }

/* ---------- the event: ET DAVOS 2027 as it is (its design plan's own words), on a qa- id ---------- */
var EV = 'qa-davos-flow', CONV = 'events/' + EV + '/aiChats/u-sachi';
FB.docs['events/' + EV] = {
  name: 'ET DAVOS 2027', category: 'ip', status: 'draft', venue: 'Zurich', city: '', portal: 'b2b', templateId: 'gen-' + EV,
  description: 'A curated week in Davos during the World Economic Forum for CEOs, promoters and founders, with ET Studio conversations and seamless Swiss hospitality.',
  designPlan: {
    owner: { formatText: 'Switzerland: Davos, Interlaken and Zurich, 16-21 January 2027.', lookText: 'Premium, editorial and bold; photographs of Davos and Swiss Alps with red graphic typography.' },
    design: { mode: 'light', themeColor: '#d62d20', accentColor: '#1f2a44',
      imageStyle: 'Premium editorial Alpine photography: crisp snow-white highlights and deep blue-hour shadows, warm window-light glow, wide and cinematic.',
      heroImage: 'A photo-real 3-D composition at blue hour: the snow-covered Davos valley with its glowing Promenade, chalet rooftops and the Congress Centre lit warm, red Swiss flags fluttering on poles in the foreground.' },
    sections: [{ id: 'overview', imageKind: 'subject', imageUrl: '' }, { id: 'by-the-numbers', image: '', imageKind: '' },
      { id: 'what-awaits', image: 'The snowy Davos Promenade at dusk lined with lit pavilions and warm shop windows', imageKind: 'place' }, { id: 'agenda', image: '' }]
  }
};
/* the page as the editor describes it for pictures (editor-ai-picture.js describe) */
var SECTIONS = [
  { id: 'nav', name: 'Navigation', role: 'nav', texts: [], pics: { slots: 0 } },
  { id: 'hero', name: 'Hero', role: 'hero', texts: ['ET @ DAVOS 2027'], pics: { slots: 0, heroTarget: 'background', background: true, wide: true } },
  { id: 'overview', name: 'Overview', texts: ['Global Experiential Learning for Leaders'], pics: { slots: 1, list: [{ label: 'Davos at night', w: 640, h: 480 }] } },
  { id: 'by-the-numbers', name: 'By the Numbers', texts: ['5 days', '4 nights', '3 Swiss destinations'], pics: { slots: 0 } },
  { id: 'what-awaits', name: 'What Awaits You', texts: ['The Davos Experience', 'ET Studio'], pics: { slots: 1, list: [{ label: 'the Promenade', w: 1200, h: 520 }] } },
  { id: 'agenda', name: 'The Swiss Arc', texts: ['18 January: arrival at Zurich'], pics: { slots: 0 } },
  { id: 'key-discussion-points', name: 'Key Discussion Points', texts: ['See India Through a Global Lens'], pics: { slots: 0 } },
  { id: 'who-should-attend', name: 'Who Should Attend', texts: ['Business leaders'], pics: { slots: 0 } },
  { id: 'footer', name: 'Footer', role: 'footer', texts: [], pics: { slots: 0 } }
];
function say(instruction, extra) {
  return call('POST', '/api/chat-edit', Object.assign({ eventId: EV, instruction: instruction, sections: clone(SECTIONS), canMakePictures: true, design: { themeColor: '#d62d20' } }, extra || {}));
}
function turn(id) { return FB.docs[CONV + '/turns/' + id]; }
function lastPrompt() { return prompts[prompts.length - 1] || ''; }
function make(turnId) { return call('POST', '/api/chat-edit', { eventId: EV, step: 'picture', turnId: turnId }); }
function resetChat() { Object.keys(FB.docs).forEach(function (k) { if (k.indexOf(CONV + '/') === 0) delete FB.docs[k]; }); }
var FOCUS_NUMBERS = { sectionId: 'by-the-numbers', name: 'By the Numbers' };
var WAITS_PIC = { sectionId: 'what-awaits', placement: 'picture', slot: 1, subject: 'the snowy Davos Promenade at dusk, lit pavilions and warm shop windows along an empty street',
  plainSubject: 'a snowy Alpine resort street at dusk with lit pavilions and warm shop windows', kind: 'place', alt: 'A snowy promenade at dusk' };
/* turn 4's subject (the model wrote one like it; the server answered "say it in plain words"): the event's own place */
var NUMBERS_PIC = { sectionId: 'by-the-numbers', placement: 'picture', slot: 0, subject: 'A panoramic view of Davos in winter: snow-covered chalets beneath the Swiss Alps under a clear blue sky, the Landwasser Viaduct in the distance',
  plainSubject: 'a snowy Alpine resort town in a high valley, chalet roofs and pine slopes under a clear blue sky', kind: 'place', alt: 'Davos in winter' };

(async function () {
  /* ===== (c) the prompt: the event's own place is a place, described by the AI; examples from this event ===== */
  answers.push(reply('The page has eight sections.'));
  var c = await say('what sections does this page have?');
  var p0 = lastPrompt();
  ok(c.status === 200 && /THIS EVENT'S OWN PLACE: Davos, Zurich, Switzerland, Interlaken\. It is a place, never a person/.test(p0) && /for example: a snowy Alpine resort town in a high valley/.test(p0) &&
    /never ask the owner to describe it/.test(p0), '(a) the prompt names the event\'s own place as a place and gives its look in plain words', p0.slice(p0.indexOf('THIS EVENT'), p0.indexOf('THIS EVENT') + 400));
  ok(/EXAMPLES you give the owner[^\n]*come from THIS event[^\n]*"By the Numbers"[^\n]*"What Awaits You"[^\n]*no seafronts/.test(p0), '(c) examples in replies come from this event\'s place and sections, never a seafront', p0.slice(p0.indexOf('EXAMPLES'), p0.indexOf('EXAMPLES') + 500));
  ok(/ONE YES IS ENOUGH/.test(p0) && /OFFERING A PICTURE: when you offer to make a picture instead of making it/.test(p0) && /`plainSubject`: the same scene again in plain visual words/.test(p0),
    '(b, e) the prompt: one yes is enough, an offer carries its picture, the model writes the nameless scene itself', '');
  ok(p0.indexOf('seafront at dusk') === -1, '(c) nothing in the prompt offers "a seafront at dusk" as an example');

  /* ===== (e) turn 1: a reply offering three pictures, kept on the turn ===== */
  resetChat();
  var T1 = 'Images inside an attached PDF cannot be directly extracted and placed onto the page. Alternatively, I can generate bespoke photography for your sections one at a time. ' +
    'Would you like me to create an image for What Awaits You, add a visual to Overview, or set an Alpine scene for The Swiss Arc agenda?';
  answers.push(reply(T1, { newPictures: [WAITS_PIC] }));
  c = await say('use the images from this pdf and try to well accomodate them in this website. currently the website have very less images.');
  var t1 = turn(c.body.turnId);
  ok(c.status === 200 && c.body.kind === 'reply' && c.body.summary === T1 && !c.body.newPicture, '(e) turn 1: the reply is the model\'s own offer, nothing made', c.body);
  ok(t1 && t1.newPicture && t1.newPicture.state === 'offered' && t1.newPicture.sectionId === 'what-awaits' && t1.newPicture.subject === WAITS_PIC.subject &&
    JSON.stringify(t1.newPicture.options) === JSON.stringify(['what-awaits', 'overview', 'agenda']), '(e) …kept on the turn: the first picture with its scene, and the three places in the order offered', t1 && t1.newPicture);
  await wait();
  /* turn 2: a bare yes, which the model answered with another question, as on 16 Nov */
  answers.push(reply('Which section would you like to start with? I can create a bespoke visual for What Awaits You, add a visual to Overview, or set an Alpine scene for The Swiss Arc agenda.'));
  c = await say('yes');
  var p2 = lastPrompt(), t2 = turn(c.body.turnId);
  ok(/\[You offered new pictures for “What Awaits You”, “Overview” and “The Swiss Arc”; a plain yes makes the first, for “What Awaits You” — the snowy Davos Promenade/.test(p2),
    '(e) the model is reminded that a plain yes makes the first one', p2.slice(p2.indexOf('[You offered'), p2.indexOf('[You offered') + 300));
  ok(c.status === 200 && c.body.kind === 'edit' && c.body.newPicture && c.body.newPicture.sectionId === 'what-awaits' && c.body.newPicture.apply === 'swap' && !/which section/i.test(c.body.summary),
    '(e) turn 2: a bare yes makes the first picture offered — no "which section?" loop', c.body);
  ok(c.body.summary === 'I\'m making the new picture for “What Awaits You”: ' + WAITS_PIC.subject + '. It takes about half a minute. After it, I can make the next one for “Overview” or “The Swiss Arc” — say which.',
    '(e) …and says what it makes, and what it can make next', c.body.summary);
  ok(t2.newPicture.state === 'asked' && t2.newPicture.ownerSubject === true && JSON.stringify(t2.newPicture.rest) === JSON.stringify(['overview', 'agenda']), '(e) the turn keeps the rest, offered next', t2.newPicture);
  var mk = await make(c.body.turnId);
  ok(mk.status === 200 && mk.body.url && !mk.body.held && imageCalls.length === 1, '(e) the picture is made', mk.body);
  await call('POST', '/api/chat/turn', { eventId: EV, turnId: c.body.turnId, status: 'applied', done: ['New picture made and put in “What Awaits You” (picture)'] });
  await wait();
  /* "next": the next one offered */
  answers.push(reply('Shall I go on with the Overview?'));
  c = await say('next');
  ok(c.body.kind === 'edit' && c.body.newPicture && c.body.newPicture.sectionId === 'overview', '(e) "next" after the first makes the next one offered, never another question', c.body);
  await wait();

  /* ===== (e) the same reply, offered in words only (no `newPictures`): its places are read from its words ===== */
  resetChat();
  answers.push(reply(T1));
  c = await say('use the images from this pdf and try to well accomodate them in this website.');
  var w1 = turn(c.body.turnId);
  ok(w1.newPicture && w1.newPicture.state === 'offered' && w1.newPicture.sectionId === 'what-awaits' && JSON.stringify(w1.newPicture.options) === JSON.stringify(['what-awaits', 'overview', 'agenda']) && w1.newPicture.subject === '',
    '(e) an offer in words only is kept too, its places in the order it names them', w1.newPicture);
  await wait();
  answers.push(reply('Which section would you like to start with?'));
  c = await say('yes');
  ok(c.body.kind === 'edit' && c.body.newPicture && c.body.newPicture.sectionId === 'what-awaits' && /snowy Davos Promenade at dusk lined with lit pavilions/.test(turn(c.body.turnId).newPicture.subject),
    '(e) …and a bare yes makes the first, with the scene the site\'s own design gave that section', c.body);
  await wait();

  /* ===== (b) turn 3: "go ahead with this section" after the AI's offer — made, not offered again ===== */
  resetChat();
  answers.push(reply(T1));
  c = await say('use the images from this pdf and try to well accomodate them in this website.');
  await wait();
  answers.push(edit('I\'m making a picture for By the Numbers.', { newPictures: [NUMBERS_PIC] }));
  c = await say('go ahead with this section', { focus: FOCUS_NUMBERS });
  var t3 = turn(c.body.turnId);
  ok(c.body.kind === 'edit' && c.body.newPicture && c.body.newPicture.sectionId === 'by-the-numbers' && c.body.newPicture.apply === 'rework' && !/Say yes|Say “yes/.test(c.body.summary),
    '(b) turn 3: "go ahead with this section" after the AI\'s offer makes the picture — no second "Do you want me to…?"', c.body);
  ok(t3.newPicture.subject === NUMBERS_PIC.subject && c.body.sectionEdits.length === 1 && c.body.sectionEdits[0].sectionId === 'by-the-numbers',
    '(a) …with the event\'s own place named as it is ("Davos", "the Swiss Alps", "the Landwasser Viaduct"), and the section reworked to show it', t3.newPicture);
  await wait();

  /* ===== (a, b) turns 3-5 as the server answered them: its own offer, then "yes" — made at once, never the names refusal ===== */
  resetChat();
  answers.push(edit('I\'m making a picture for By the Numbers.', { newPictures: [NUMBERS_PIC] }));
  c = await say('go ahead with this section', { focus: FOCUS_NUMBERS });
  var o3 = turn(c.body.turnId);
  ok(c.body.kind === 'reply' && c.body.summary === 'Do you want me to make a new picture for “By the Numbers”: ' + NUMBERS_PIC.subject + '? Say yes and I\'ll make it — or tell me what it should show instead.' &&
    o3.newPicture.state === 'offered' && o3.newPicture.subject === NUMBERS_PIC.subject, '(b) with nothing offered before, the server offers once, saying what it would make', c.body.summary);
  await wait();
  answers.push(edit('Making the By the Numbers picture now.', { newPictures: [NUMBERS_PIC] }));
  c = await say('yes', { focus: FOCUS_NUMBERS });
  ok(c.body.kind === 'edit' && c.body.newPicture && c.body.newPicture.sectionId === 'by-the-numbers' && !/names out|plain words|seafront/.test(JSON.stringify(c.body)),
    '(a) turn 4: "yes" makes the picture of Davos and the Swiss Alps — never "I keep names out… for example a seafront at dusk"', c.body);
  ok(turn(c.body.turnId).newPicture.ownerSubject === true, '(a) …and the scene the owner said yes to leads the picture', turn(c.body.turnId).newPicture);
  await wait();
  /* the same "yes" with a real person's name in the model's scene: made without the name, never refused */
  resetChat();
  answers.push(edit('I\'m making a picture for By the Numbers.', { newPictures: [NUMBERS_PIC] }));
  await say('go ahead with this section', { focus: FOCUS_NUMBERS });
  await wait();
  answers.push(edit('Making it now.', { newPictures: [Object.assign({}, NUMBERS_PIC, { subject: 'Klaus Schwab welcoming delegates on the steps of the Congress Centre', plainSubject: 'the empty stone steps of a modern congress hall in snow at dusk, warm light in its glass front' })] }));
  c = await say('yes, make it', { focus: FOCUS_NUMBERS });
  var named = turn(c.body.turnId);
  ok(c.body.kind === 'edit' && c.body.newPicture && named.newPicture.subject === NUMBERS_PIC.subject && !/klaus|schwab/i.test(JSON.stringify(named.newPicture)) && c.body.skipped.indexOf(cp.sentence('plainNote')) === -1,
    '(a) a bare yes makes the scene offered, exactly — the model\'s new scene with a real person\'s name never reaches the picture', named.newPicture);
  await wait();
  resetChat();
  var imagesBefore = imageCalls.length;
  answers.push(edit('Making it now.', { newPictures: [Object.assign({}, NUMBERS_PIC, { subject: 'Klaus Schwab welcoming delegates on the steps of the Congress Centre', plainSubject: 'the empty stone steps of a modern congress hall in snow at dusk, warm light in its glass front' })] }));
  c = await say('go ahead and make a new picture for this section', { focus: FOCUS_NUMBERS });
  var prop = turn(c.body.turnId);
  ok(c.body.kind === 'reply' && c.body.summary === cp.sentence('name', { scene: 'the empty stone steps of a modern congress hall in snow at dusk, warm light in its glass front' }) &&
    prop.newPicture.state === 'offered' && prop.newPicture.subject === 'the empty stone steps of a modern congress hall in snow at dusk, warm light in its glass front' && imageCalls.length === imagesBefore,
    '(a) a real person\'s name, not on a yes: ETB2B AI proposes the scene without the name itself, and keeps it', c.body);
  await wait();
  answers.push(reply('Great — shall I go ahead?'));
  c = await say('yes');
  ok(c.body.kind === 'edit' && c.body.newPicture && turn(c.body.turnId).newPicture.subject === 'the empty stone steps of a modern congress hall in snow at dusk, warm light in its glass front',
    '(a) …and the owner\'s yes makes it, even when the model asked once more', c.body);
  await wait();
  /* turn 5: the scene given after a yes is made, never offered again */
  resetChat();
  answers.push(edit('I\'m making a picture for By the Numbers.', { newPictures: [NUMBERS_PIC] }));
  await say('go ahead with this section', { focus: FOCUS_NUMBERS });
  await wait();
  var SEAFRONT = { sectionId: 'by-the-numbers', placement: 'picture', slot: 0, subject: 'A seafront at dusk: a curving waterfront promenade with a gentle string of warm lights and calm water',
    plainSubject: 'a curving waterfront promenade at dusk with warm lights and calm water', kind: 'place', alt: 'A seafront at dusk' };
  answers.push(edit('I\'m making a seafront at dusk for By the Numbers.', { newPictures: [SEAFRONT] }));
  c = await say('a seafront at dusk”', { focus: FOCUS_NUMBERS });
  var t5 = turn(c.body.turnId);
  ok(c.body.kind === 'edit' && c.body.newPicture && t5.newPicture.subject === SEAFRONT.subject && t5.newPicture.ownerSubject === true && !/Do you want me to make/.test(c.body.summary),
    '(b) turn 5: the scene the owner gives after an offer is made at once, led by the owner\'s words — never "Do you want me to…?" again', c.body);
  var seaTurn = c.body.turnId;
  await wait();

  /* ===== (d) turn 6: the place picture — nobody asked for from the first try; three tries; then a close-up offered ===== */
  checkAnswers.push({ people: true, text: false, logos: false }, { people: true, text: false, logos: false }, { people: true, text: false, logos: false });
  var callsAt = imageCalls.length;
  mk = await make(seaTurn);
  var first = imageCalls[callsAt] || {}, third = imageCalls[callsAt + 2] || {};
  ok(first.prompt && first.prompt.indexOf(cp.EMPTY_PLACE) !== -1 && /^[^]*Scene: A seafront at dusk[^]*Nobody is in it: show the place empty and quiet in a wide view, at an early hour/.test(first.prompt),
    '(d) the first try already asks for the place empty, in a wide view, at an early hour', first.prompt);
  ok(imageCalls.length === callsAt + 3 && /LAST TRY, STRICTEST: change the view so that no one can be in it/.test(third.prompt || ''), '(d) people found twice: a third try, with the strictest words', third.prompt && third.prompt.slice(-400));
  var held = FB.docs[CONV + '/turns/' + seaTurn].newPicture;
  ok(mk.status === 200 && mk.body.held === true && mk.body.heldWhy === 'I made the new picture three times, and the last one still had people in it, but this place shows no people, so I did not put it on the page. ' +
    'I can make it instead as a close-up of one object in the same scene, with nobody in it — say yes and I\'ll make it — or attach a picture of your own and I\'ll put it in.' &&
    held.alternative === 'close-up' && held.tries === 3, '(d) still people: said plainly, and a concrete alternative offered — never only a failure', mk.body);
  await call('POST', '/api/chat/turn', { eventId: EV, turnId: seaTurn, status: 'failed', notDone: [mk.body.heldWhy] });
  await wait();
  answers.push(reply('Shall I make the close-up?'));
  c = await say('yes', { focus: FOCUS_NUMBERS });
  var cu = turn(c.body.turnId);
  ok(/You offered to make the same scene as a close-up of one object in it/.test(lastPrompt()), '(d) the model is reminded of the close-up it offered', '');
  ok(c.body.kind === 'edit' && c.body.newPicture && cu.newPicture.closeUp === true && cu.newPicture.subject === SEAFRONT.subject, '(d) the owner\'s yes makes the close-up, even when the model asked again', cu.newPicture);
  callsAt = imageCalls.length;
  mk = await make(c.body.turnId);
  var closePrompt = (imageCalls[callsAt] || {}).prompt || '';
  /* QA in the browser, 16 Nov 2026: told only "show it as a close-up" after the whole scene and "a wide view", the model
     drew the wide valley again; a close-up is now asked for as one object, and nothing in its words asks for the view */
  ok(mk.status === 200 && !mk.body.held && closePrompt.indexOf('Create one editorial close-up photograph for a section of a professional event website: ONE object or detail taken from the scene below') === 0 &&
    closePrompt.indexOf('The scene it comes from: ' + SEAFRONT.subject + '.') !== -1 && closePrompt.indexOf(cp.CLOSE_UP) !== -1 && closePrompt.indexOf(cp.EMPTY_PLACE) === -1 &&
    closePrompt.indexOf(cp.EMPTY_SCENE) !== -1 && !/in a wide view|drawn true to its real shape|This scene leads the picture/.test(closePrompt),
    '(d) …made as a close-up of ONE object of the scene: no wide view, no landmark to draw, nobody in it', closePrompt);
  await wait();
  /* the model's own words for the close-up come first on a yes: they name the one object to show */
  resetChat();
  answers.push(edit('I\'m making a seafront at dusk for By the Numbers.', { newPictures: [SEAFRONT] }));
  c = await say('make a picture of a seafront at dusk for this section', { focus: FOCUS_NUMBERS });
  var sea2 = c.body.turnId;
  checkAnswers.push({ people: true, text: false, logos: false }, { people: true, text: false, logos: false }, { people: true, text: false, logos: false });
  mk = await make(sea2);
  await call('POST', '/api/chat/turn', { eventId: EV, turnId: sea2, status: 'failed', notDone: [mk.body.heldWhy] });
  await wait();
  var LAMP = 'a close-up of one brass lantern on a wet stone railing at dusk, warm light on the water blurred behind it';
  answers.push(edit('I\'m making the close-up: a lantern on the railing.', { newPictures: [Object.assign({}, SEAFRONT, { subject: LAMP, plainSubject: LAMP, alt: 'A brass lantern on a railing at dusk' })] }));
  c = await say('yes', { focus: FOCUS_NUMBERS });
  ok(mk.body.held === true && c.body.kind === 'edit' && turn(c.body.turnId).newPicture.closeUp === true && turn(c.body.turnId).newPicture.subject === LAMP,
    '(d) a yes to the close-up takes the model\'s own words for it (the one object), not the wide scene again', turn(c.body.turnId).newPicture);
  await wait();
  /* the second try passes: no third */
  resetChat();
  answers.push(edit('Making a picture of Davos for By the Numbers.', { newPictures: [NUMBERS_PIC] }));
  c = await say('make a new picture of the Swiss Alps above Davos for this section', { focus: FOCUS_NUMBERS });
  checkAnswers.push({ people: true, text: false, logos: false }, CLEAN);
  callsAt = imageCalls.length;
  mk = await make(c.body.turnId);
  ok(mk.status === 200 && !mk.body.held && imageCalls.length === callsAt + 2 && turn(c.body.turnId).newPicture.tries === 2, '(d) a second try that passes is the one placed; no third is made', mk.body);

  /* ===== (c) the sentences give examples from this event, never a seafront ===== */
  var ctx = { canMakePictures: true, eventId: EV, sections: SECTIONS.map(function (s) { return cp.cleanSectionFields(s, ''); }), eventData: FB.docs['events/' + EV], designPlan: FB.docs['events/' + EV].designPlan, picturesLeft: 20 };
  var notAsked = cp.planAsk([{ sectionId: 'by-the-numbers', placement: 'picture', slot: 0, subject: 'snowy peaks', plainSubject: '', kind: 'place', alt: '' }], Object.assign({}, ctx, { instruction: 'make the numbers bigger' }));
  ok(notAsked.code === 'notAsked' && notAsked.reply === 'No new picture was made, because your message did not ask for one. Say what it should show and where (for example “give the Overview section a new picture of a snowy Alpine resort town in a high valley”), and I will make it.',
    '(c) "did not ask for one" gives an example from this event: its own section and its place in plain words', notAsked.reply);
  var where = cp.planAsk([{ sectionId: 'no-such', placement: 'picture', slot: 0, subject: 'snowy peaks', plainSubject: '', kind: 'place', alt: '' }], Object.assign({}, ctx, { instruction: 'make a new picture' }));
  ok(where.code === 'unclear' && /\(for example “Overview” or “By the Numbers”\)\?$/.test(where.reply) && where.pending && where.pending.state === 'offered' && where.pending.confirmed === true,
    '(c) "where should it go?" names this page\'s own sections, and is kept so the answer makes the picture', where);
  var what = cp.planAsk([{ sectionId: 'by-the-numbers', placement: 'picture', slot: 0, subject: '', plainSubject: '', kind: 'place', alt: '' }], Object.assign({}, ctx, { instruction: 'make a new picture for this section', focus: FOCUS_NUMBERS }));
  ok(what.code === 'what' && /for example “a snowy Alpine resort town in a high valley”/.test(what.reply) && what.pending && what.pending.sectionId === 'by-the-numbers',
    '(c) "what should it show?" gives this event\'s own scene as its example', what.reply);
  /* a place word of a section's name ("The Swiss Arc") in the scene ("the Swiss Alps") is the scene, not that section;
     the section's whole name, or its place word with no such scene, still names it */
  var arcCtx = Object.assign({}, ctx, { sections: ctx.sections.map(function (s) { return s.id === 'agenda' ? Object.assign({}, s, { name: 'The Swiss Arc' }) : s; }) });
  var alps = cp.planAsk([Object.assign({}, NUMBERS_PIC, { subject: 'the Swiss Alps above Davos at dawn' })], Object.assign({}, arcCtx, { instruction: 'make a new picture of the Swiss Alps for this section', focus: FOCUS_NUMBERS }));
  ok(alps.ask && alps.ask.sectionId === 'by-the-numbers', '"a picture of the Swiss Alps for this section" goes in the section selected, not in "The Swiss Arc"', alps);
  var arc = cp.planAsk([{ sectionId: 'agenda', placement: 'picture', slot: 0, subject: 'a red mountain train crossing a snowy viaduct', plainSubject: '', kind: 'place', alt: '' }], Object.assign({}, arcCtx, { instruction: 'give the Swiss Arc a new picture' }));
  ok(arc.ask && arc.ask.sectionId === 'agenda', '"give the Swiss Arc a new picture" still names that section', arc);
  var jaipurCtx = Object.assign({}, ctx, { sections: ctx.sections.concat([cp.cleanSectionFields({ id: 'jaipur', name: 'Jaipur', texts: ['The Pink City'], pics: { slots: 0 } }, '')]) });
  var jaipur = cp.planAsk([{ sectionId: 'jaipur', placement: 'picture', slot: 0, subject: 'pink sandstone palace windows at dawn', plainSubject: '', kind: 'place', alt: '' }], Object.assign({}, jaipurCtx, { instruction: 'make a new picture for jaipur' }));
  ok(jaipur.ask && jaipur.ask.sectionId === 'jaipur', 'a section named by a place ("Jaipur") is still named by it when the scene is another', jaipur);
  ['Swiss Alps at dawn', 'Lake Zurich', 'the Landwasser Viaduct in snow', 'Interlaken between its two lakes', 'St Moritz in winter', 'the Jungfrau above Interlaken', 'Zurich Old Town at dusk', 'the Davos Congress Centre lit at dusk'].forEach(function (t) {
    var r = cp.cleanSubject(t, { sections: ctx.sections, event: ctx.eventData, designPlan: ctx.designPlan });
    ok(r.ok, '(a) the event\'s own place and its region are places, never names: "' + t + '"', r);
  });
  ['Klaus Schwab at the Congress Centre', 'Sundar Pichai giving the keynote', 'Whitney Houston singing'].forEach(function (t) {
    ok(!cp.cleanSubject(t, { sections: ctx.sections, event: ctx.eventData, designPlan: ctx.designPlan }).ok, '(a) a real person\'s name is still kept out: "' + t + '"');
  });
  Object.keys(cp.SENTENCES).forEach(function (k) { ok(!/seafront/i.test(cp.SENTENCES[k]), '(c) no sentence gives a seafront as its example: ' + k); });

  /* ===== merged with the frame-shape work: an offer keeps the shape of the frame its rework would add, and the owner's
     yes makes the picture in that shape (owner, 16 Nov 2026: "AI has created a square image for a rectangular placeholder") ===== */
  var KDP_OFFER = { sectionId: 'key-discussion-points', placement: 'picture', slot: 0, subject: 'an empty interview set with two armchairs facing each other under soft studio lights',
    plainSubject: 'an empty interview set with two armchairs under soft studio lights', kind: 'subject', alt: 'An empty interview set', frame: '21:9' };
  var kept = cp.offerInReply([KDP_OFFER], 'I can create an image for Key Discussion Points. Would you like that?', ctx);
  ok(kept && kept.state === 'offered' && kept.sectionId === 'key-discussion-points' && kept.frame === '21:9', 'an offer a reply makes keeps the frame shape its rework would add', kept);
  var heldNo = cp.offerInReply([Object.assign({}, KDP_OFFER, { frame: '9:16' })], 'I can create an image for Key Discussion Points. Would you like that?', ctx);
  ok(heldNo && heldNo.frame === '16:9', '...a shape no added frame takes is kept as the usual 16:9 one', heldNo);
  var took = cp.takeOffer(kept, Object.assign({}, ctx, { instruction: 'yes', lastTurnPicture: kept }));
  ok(took && took.ask && took.ask.apply === 'rework' && took.ask.aspect === '21:9' && /ONE frame of exactly 21:9[^]*aspect-ratio: 21 \/ 9 /.test(took.edits[0].instruction),
    'a bare yes the model answered with a question makes the offer in the shape it was offered, and the rework gives the frame that shape', took && { ask: took.ask, edits: took.edits });
  var yesNoShape = cp.planAsk([Object.assign({}, KDP_OFFER, { frame: '' })], Object.assign({}, ctx, { instruction: 'yes', lastTurnPicture: kept }));
  ok(yesNoShape.ask && yesNoShape.ask.aspect === '21:9', 'a yes the model answers with no shape takes the offered one', yesNoShape.ask);
  var yesOwnShape = cp.planAsk([Object.assign({}, KDP_OFFER, { frame: '4:3' })], Object.assign({}, ctx, { instruction: 'yes', lastTurnPicture: kept }));
  ok(yesOwnShape.ask && yesOwnShape.ask.aspect === '4:3', '...and the model\'s own shape for it, when it gives one, comes first', yesOwnShape.ask);
  var off = cp.offerOf(KDP_OFFER, ctx.sections, ctx);
  ok(off && off.record.frame === '21:9', 'the server\'s own offer keeps the shape the model chose', off && off.record);

  /* ===== QA, 16 Nov 2026: the Agenda with no sessions is not seen by visitors; frames off their picture's shape; the PDF
     attached before the editor took pictures out ===== */
  var hidCtx = Object.assign({}, arcCtx, { sections: arcCtx.sections.map(function (s) { return s.id === 'agenda' ? cp.cleanSectionFields(Object.assign({}, s, { hidden: true, showsWhen: 'sessions' }), '') : s; }) });
  var hidAsk = cp.planAsk([{ sectionId: 'agenda', placement: 'picture', slot: 0, subject: 'a snowy Alpine resort street at twilight', plainSubject: '', kind: 'place', alt: '', frame: '4:5', reference: 0 }],
    Object.assign({}, hidCtx, { instruction: 're-create the pictures from the pdf for the relevant sections' }));
  ok(!hidAsk.ask && hidAsk.code === 'hidden' && hidAsk.reply === 'Visitors do not see “The Swiss Arc” yet — it shows once its sessions are added in Content › Agenda, so I did not make a picture for it. Choose a section visitors see, or name “The Swiss Arc” if you want the picture there for later.',
    'a new picture is not made for a section visitors do not see unless it is named, and nothing is paid for', hidAsk);
  var hidNamed = cp.planAsk([{ sectionId: 'agenda', placement: 'picture', slot: 0, subject: 'a red mountain train crossing a snowy viaduct', plainSubject: '', kind: 'place', alt: '', frame: '16:9', reference: 0 }],
    Object.assign({}, hidCtx, { instruction: 'give the Swiss Arc a new picture' }));
  ok(hidNamed.ask && hidNamed.ask.sectionId === 'agenda' && /Visitors do not see “The Swiss Arc” yet — it shows once its sessions are added in Content › Agenda; the new picture is there for then\./.test(hidNamed.note),
    '...named, it is made, and the owner is told when visitors will see it', hidNamed.note);
  resetChat();
  var frameSecs = clone(SECTIONS).map(function (s) { return s.id === 'what-awaits' ? Object.assign({}, s, { pics: { slots: 1, list: [{ label: 'A snowy Alpine promenade at dusk', w: 1152, h: 240, nw: 1184, nh: 864 }] } }) : s; });
  answers.push(edit('Giving What Awaits You\'s picture a frame of its own shape.', { sectionEdits: [{ sectionId: 'what-awaits', instruction: 'give the picture a frame of its own shape, 4:3', pictures: [] }] }));
  c = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'the image dimension issue is still not fixed. AI has created a square image for a rectangular placeholder.', sections: frameSecs, canMakePictures: true, canPlaceDocPictures: true, design: { themeColor: '#d62d20' } });
  var fp = lastPrompt();
  ok(c.status === 200 && /"A snowy Alpine promenade at dusk \(1152×240\) — FRAME OFF ITS PICTURE'S SHAPE: the picture itself is 1184×864 \(4:3\), so this frame shows only 29% of it"/.test(fp) &&
    /fix each such picture the message is about — every one of them when it names none — with `sectionEdits` for its section/.test(fp),
    'the owner\'s words: the model sees which frame is off its picture\'s shape, and is told to rework it, not to make a picture', fp.slice(fp.indexOf('"what-awaits"'), fp.indexOf('"what-awaits"') + 400));
  ok(/PICTURES IN A PDF OR DECK: the editor takes the photographs out of a PDF or PowerPoint deck attached to a message/.test(fp) && /ask them in a "reply" to attach that document again/.test(fp) && /earlier answers here that said so are out of date/.test(fp),
    'with no PDF pictures kept (the owner\'s PDF was attached under the old code), the model asks for the PDF again instead of repeating that its pictures cannot be used');
  ok(c.body.sectionEdits.length === 1 && !c.body.newPicture, '...and the rework is sent, with no new picture');

  if (failures.length) { console.error('chat-picture-davos: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('chat-picture-davos: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
