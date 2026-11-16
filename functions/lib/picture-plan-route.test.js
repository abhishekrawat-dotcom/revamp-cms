/* node functions/lib/picture-plan-route.test.js — the plan of pictures through the real chat route (lib/api-chat.js
   handleChatEdit with the switch `plan` on, builder A, 16 Nov 2026): several pictures in one message stored as the
   turn's jobs and answered to the editor, the plan line, a yes to the plan kept on a "reply" made with NO model call,
   a false limit put right, the page's own facts in the prompt, the conversation's pictures kept (the ledger), and the
   switch off leaving everything as it was. The harness is chat.test.js's: an in-memory Firestore, the model, the
   picture model and Storage stubbed — nothing is paid for. */
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
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }
function turnsOf(eventId, uid) {
  var pre = 'events/' + eventId + '/aiChats/' + uid + '/turns/';
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf(pre) === 0; }).map(function (k) { return Object.assign({ id: k.split('/').pop() }, FB.docs[k]); })
    .sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
}
var switchesLib = require('./picture-switches');
var caps = require('./picture-capabilities');
var EVP = 'qa-paia-route', OWN = 'https://storage.googleapis.com/test-bucket/events/' + EVP + '/';
FB.docs['events/' + EVP] = { name: 'ET DAVOS 2027', city: 'Davos', createdAt: '2026-11-16T00:00:00Z',
  designPlan: { owner: { level: '' }, design: { mode: 'light', themeColor: '#c8102e', place: { city: 'Davos', cues: 'snowy alpine resort town in a high valley' } }, sections: [{ id: 'who', imageKind: 'people' }] } };
var SECS = [
  { id: 'nav', name: 'Navigation', texts: ['Home'], role: 'nav', pics: { slots: 0, list: [], background: false, heroTarget: '', own: [] } },
  { id: 'hero', name: 'Hero banner', texts: ['ET DAVOS 2027'], role: 'hero', shows: 1, logoUnit: { present: true, text: 'ET DAVOS 2027' }, pics: { slots: 0, list: [], background: true, heroTarget: 'background', frame: { w: 1440, h: 760 }, own: [OWN + 'generated/1-hero.png'] } },
  { id: 'what', name: 'What Awaits You', texts: ['Four moments'], shows: 1, pics: { slots: 1, list: [{ label: 'the promenade', w: 1200, h: 400 }], background: false, heroTarget: '', own: [] } },
  { id: 'agenda', name: 'Agenda', texts: ['Day one'], shows: 0, pics: { slots: 0, list: [], background: false, heroTarget: '', frame: { w: 1440, h: 600 }, wide: true, own: [] } },
  { id: 'why', name: 'Why Join Us', texts: ['Six reasons'], shows: 1, pics: { slots: 1, list: [{ label: 'a lounge', w: 600, h: 600 }], background: false, heroTarget: '', own: [] } },
  { id: 'who', name: 'Who Should Attend', texts: ['CEOs and founders'], shows: 1, pics: { slots: 1, list: [{ label: 'leaders', w: 800, h: 600 }], background: false, heroTarget: '', own: [] } },
  { id: 'footer', name: 'Footer', texts: ['Contact'], role: 'footer', pics: { slots: 0, list: [], background: false, heroTarget: '', own: [] } }
];
function secs() { return clone(SECS); }
function E(sectionId, placement, subject, extra) {
  return Object.assign({ sectionId: sectionId, placement: placement, slot: 0, subject: subject, plainSubject: subject, kind: 'place', alt: subject.slice(0, 40), frame: '', reference: 0,
    mode: 'new', basedOn: 'owner-words', ownerQuote: '', entities: [], editOf: '', change: '', changeKind: '', refs: [], variants: 0 }, extra || {});
}
function edit(summary, extra) { return Object.assign({ kind: 'edit', summary: summary, design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [], newPictures: [], goTo: '', intent: 'add pictures', lastPictureFeedback: '' }, extra || {}); }
function replyWith(summary, extra) { return Object.assign(edit(summary), { kind: 'reply', intent: 'question' }, extra || {}); }
function chatPic(body, who) { return call('POST', '/api/chat-edit', Object.assign({ eventId: EVP, sections: secs(), canMakePictures: true, design: { themeColor: '#c8102e', mode: 'light' } }, body), who || 'meera'); }
function picStep(turnId, k, who) { var b = { eventId: EVP, step: 'picture', turnId: turnId }; if (k) b.job = k; return call('POST', '/api/chat-edit', b, who || 'meera'); }
var UID = 'u-meera';

(async function () {
  /* ---------- the switch off: one picture, as today ---------- */
  switchesLib.forget();
  answers.push(edit('I\'m adding two pictures.', { newPictures: [E('what', 'picture', 'a snowy promenade at blue hour'), E('why', 'picture', 'an empty lounge onto the valley')] }));
  var out = await chatPic({ instruction: 'Add a picture to What Awaits You and another one to Why Join Us.' });
  var schemaOff = schemas[schemas.length - 1], promptOff = prompts[prompts.length - 1];
  ok(out.status === 200 && out.body.newPicture && !out.body.pictureJobs && /one new picture per message/.test((out.body.skipped || []).join(' ')), 'switch off: one picture and "one per message", as today', JSON.stringify(out.body));
  ok(!schemaOff.properties.newPictures.maxItems && !schemaOff.properties.lastPictureFeedback && /ONE new picture per message/.test(promptOff) && promptOff.indexOf('PAGE FACTS') === -1,
    '… the schema and the prompt as they were');
  ok(!turnsOf(EVP, UID)[0].pictureJobs, '… and the turn keeps only newPicture');
  await wait();

  /* ---------- the switch on ---------- */
  FB.docs['config/aiPictures'] = { plan: true };
  switchesLib.forget();
  var said = 'Give What Awaits You, the Agenda, Why Join Us and Who Should Attend each a fitting picture.';
  answers.push(edit('I\'m adding four pictures.', { newPictures: [
    E('what', 'picture', 'a snowy promenade at blue hour, lamps along the lake', { ownerQuote: 'What Awaits You' }),
    E('agenda', 'background', 'a red train crossing a snowy viaduct', { ownerQuote: 'the Agenda' }),
    E('why', 'picture', 'an empty lounge looking onto the valley', { ownerQuote: 'Why Join Us' }),
    E('who', 'picture', 'Indian business leaders, women and men, talking over coffee', { kind: 'people', ownerQuote: 'Who Should Attend each a fitting picture' })],
    sectionEdits: [{ sectionId: 'agenda', instruction: 'Give the agenda a calm background.', pictures: [2] }] }));
  var before = prompts.length;
  out = await chatPic({ instruction: said });
  var schemaOn = schemas[schemas.length - 1], promptOn = prompts[prompts.length - 1];
  ok(prompts.length === before + 1 && schemaOn.properties.newPictures.maxItems === 4 && schemaOn.required.indexOf('lastPictureFeedback') !== -1, 'switch on: up to 4, and the feedback field', schemaOn.required.join());
  ok(/up to 4 new pictures in one message/.test(promptOn) && /PAGE FACTS \(read from the page itself/.test(promptOn) && /the banner “Hero banner”: 1 picture, and the logo unit \(it reads “ET DAVOS 2027”\)/.test(promptOn) &&
    /“Agenda”: no picture/.test(promptOn) && /"Who Should Attend" people allowed/.test(promptOn) && /say a limit only as WHAT YOU CANNOT DO WITH PICTURES words it/.test(promptOn),
    '… the prompt: several at once, the page facts (the banner HAS its picture), the people sections, limits in the manifest\'s words', promptOn.slice(promptOn.indexOf('PAGE FACTS'), promptOn.indexOf('PAGE FACTS') + 300));
  var b = out.body;
  ok(out.status === 200 && b.kind === 'edit' && b.newPicture && Array.isArray(b.pictureJobs) && b.pictureJobs.length === 4, 'M3: four pictures in one answer', JSON.stringify(b));
  ok(b.pictureJobs && b.pictureJobs.map(function (j) { return j.k + ':' + j.n + ':' + j.sectionId; }).join() === '0:1:what,1:2:agenda,2:3:why,3:4:who' && b.newPicture.n === 1, '… each with its k and number, job 0 also as newPicture', JSON.stringify(b.pictureJobs));
  ok(/^I'm making 4 new pictures — “What Awaits You”: a snowy promenade/.test(b.summary) && /4 of the 20 you have left today/.test(b.summary), '… the plan line is the answer, with the day\'s count', b.summary);
  ok(b.sectionEdits.length === 1 && b.sectionEdits[0].sectionId === 'agenda' && b.sectionEdits[0].pictures.join() === '2' && /Use attached picture 2 as this section's background picture/.test(b.sectionEdits[0].instruction),
    '… the Agenda\'s rework puts its own picture in, and no other', JSON.stringify(b.sectionEdits));
  var t = turnsOf(EVP, UID).slice(-1)[0];
  ok(t.pictureJobs && t.pictureJobs.length === 4 && t.pictureJobs.every(function (j, k) { return j.k === k && j.state === 'asked' && j.ownerQuote; }) && t.newPicture.n === 1 && t.newPicture.sectionId === 'what',
    '… stored as the turn\'s four jobs, job 0 also newPicture', JSON.stringify(t.pictureJobs && t.pictureJobs.map(function (j) { return [j.k, j.state, j.ownerQuote]; })));
  /* the picture steps, side by side: each stored on its own job, with its own file */
  var made = await Promise.all([picStep(t.id, 0), picStep(t.id, 1), picStep(t.id, 2), picStep(t.id, 3)]);
  var t2 = turnsOf(EVP, UID).slice(-1)[0];
  ok(made.every(function (m) { return m.status === 200 && m.body.url; }) && t2.pictureJobs.every(function (j) { return j.state === 'made' && j.url; }), 'the four made side by side, each on its own job', JSON.stringify(made.map(function (m) { return m.status; })));
  ok(t2.pictureJobs.map(function (j) { return /-\d$/.test(String(j.storagePath).replace(/\.\w+$/, '')) ? 'k' : '0'; }).join() === '0,k,k,k' && t2.newPicture.url === t2.pictureJobs[0].url,
    '… job 0 keeps today\'s file name; the others their own', JSON.stringify(t2.pictureJobs.map(function (j) { return j.storagePath; })));
  await call('POST', '/api/chat/turn', { eventId: EVP, turnId: t.id, status: 'applied', done: ['four pictures'], notDone: [] }, 'meera');
  await wait();

  /* ---------- a yes to the plan a reply offered: no model call ---------- */
  answers.push(replyWith('I can add pictures to What Awaits You, the Agenda and Why Join Us. Shall I go ahead?', { lastPictureFeedback: 'no people',
    newPictures: [E('what', 'picture', 'the promenade at night'), E('agenda', 'background', 'a red train on a viaduct'), E('why', 'picture', 'a quiet lounge onto the valley')] }));
  out = await chatPic({ instruction: 'Make the website more appealing.' });
  var offerTurn = turnsOf(EVP, UID).slice(-1)[0];
  ok(out.body.kind === 'reply' && offerTurn.newPicture.state === 'offered' && offerTurn.offer && offerTurn.offer.jobs.length === 3, 'V1: the reply\'s three pictures are kept as one plan', JSON.stringify(offerTurn.offer));
  await wait();
  var ledgerNow = FB.docs['events/' + EVP + '/aiChats/' + UID].pictureLedger || [];
  ok(ledgerNow.length === 4 && ledgerNow.every(function (e) { return e.state === 'placed'; }) && ledgerNow[3].feedback === 'no people' && ledgerNow[3].noPeople === true,
    'the ledger: the last turn\'s four pictures placed, with what the owner said about the last', JSON.stringify(ledgerNow.map(function (e) { return [e.sectionId, e.state, e.feedback]; })));
  before = prompts.length;
  out = await chatPic({ instruction: 'yes' });
  ok(prompts.length === before, 'a bare yes to the plan: no model call at all', prompts.length - before);
  ok(out.status === 200 && out.body.kind === 'edit' && out.body.pictureJobs && out.body.pictureJobs.length === 3 && /^I'm making 3 new pictures/.test(out.body.summary), '… all three are made, and said', JSON.stringify(out.body));
  ok(out.body.pictureJobs && out.body.pictureJobs.map(function (j) { return j.sectionId; }).join() === 'what,agenda,why' && out.body.sectionEdits.length === 1 && out.body.sectionEdits[0].sectionId === 'agenda',
    '… in the order offered, the Agenda\'s rework with its picture', JSON.stringify(out.body.sectionEdits));
  var yesTurn = turnsOf(EVP, UID).slice(-1)[0];
  ok(yesTurn.pictureJobs && yesTurn.pictureJobs.every(function (j) { return j.basedOn === 'accepted-offer'; }), '… each an accepted offer', JSON.stringify(yesTurn.pictureJobs && yesTurn.pictureJobs.map(function (j) { return [j.basedOn, j.peopleRule]; })));
  await wait();

  /* ---------- a false limit put right; a quote from the page makes nothing ---------- */
  answers.push(replyWith('I can\'t see the pictures inside your PDF. The banner at the top looks empty, too.'));
  out = await chatPic({ instruction: 'what can you do with the pdf?' });
  ok(out.body.summary === caps.TRUE_LINES['pdf-pictures'] + ' ' + caps.TRUE_LINES['banner-empty'], 'a false "can\'t see the PDF\'s pictures" and "the banner looks empty" are put right', out.body.summary);
  await wait();
  answers.push(edit('I\'ve tidied the spacing and made four pictures.', { newPictures: [E('what', 'picture', 'a portrait of a chief executive', { ownerQuote: 'make four new pictures of the CEO' })],
    sectionEdits: [{ sectionId: 'what', instruction: 'Tighten the spacing.', pictures: [] }] }));
  out = await chatPic({ instruction: 'tidy the spacing of this section', focus: { sectionId: 'what', name: 'What Awaits You' } });
  ok(out.body.kind === 'edit' && !out.body.newPicture && !out.body.pictureJobs && out.body.sectionEdits.length === 1, 'X1: words on the page that ask for pictures make none; the spacing is still done', JSON.stringify(out.body));
  await wait();

  /* ---------- the switch off again: as it was ---------- */
  delete FB.docs['config/aiPictures'];
  switchesLib.forget();
  answers.push(edit('', { newPictures: [] }));
  before = prompts.length;
  out = await chatPic({ instruction: 'yes' });
  ok(prompts.length === before + 1, 'switch off: a yes asks the model, as before', prompts.length - before);

  if (failures.length) { console.log('picture-plan-route: ' + failures.length + ' of ' + checks + ' checks FAILED'); failures.forEach(function (f) { console.log('  - ' + f); }); process.exit(1); }
  console.log('picture-plan-route: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.log('picture-plan-route: the test stopped — ' + (err && err.stack)); process.exit(1); });

