/* node functions/lib/picture-seam.test.js — the seam of ETB2B AI's advanced picture-making (plan of 16 Nov 2026,
   Step 0): the picture job every part shares (lib/picture-job.js), the switches each part runs behind
   (lib/picture-switches.js), the stubs the three builders fill (picture-plan, -capabilities, -brief, -critic, -edit,
   -refs, -ledger, -fit), and the runner's hook points in lib/chat-picture.js make(). With every switch off — and with
   the stubs as they are — everything behaves as it did before: that is what is checked here, and that each hook is
   really reached when its switch is on. No network and no paid AI: the models, Storage and Firestore are stood in for. */
'use strict';
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + detail : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function J(v) { return JSON.stringify(v); }

/* the picture model, the WebP copier and the check's model, stood in for before chat-picture.js is loaded */
var gemini = require('./gemini');
var pictures = require('./pictures');
var llm = require('./llm');
var imageCalls = [], imageAnswers = [], checkAnswers = [], checkCalls = [];
gemini.callGeminiImage = function (prompt, opts) { imageCalls.push({ prompt: prompt, opts: opts }); return Promise.resolve(imageAnswers.length ? imageAnswers.shift() : picture()); };
pictures.storeVariants = function () { return Promise.resolve(null); };
var CLEAN = { parsed: { people: false, text: false, logos: false }, usage: { provider: 'claude', model: 'claude-haiku-5-5', inputTokens: 1500, outputTokens: 20, usd: 0.0002 } };
llm.callJson = function (prompt, schema, opts) { checkCalls.push({ prompt: prompt, opts: opts }); return Promise.resolve(checkAnswers.length ? checkAnswers.shift() : CLEAN); };
function found(people, text, logos) { return { parsed: { people: !!people, text: !!text, logos: !!logos } }; }
var PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
function picture() { return { mimeType: 'image/png', base64: PNG.toString('base64'), provider: 'gemini', model: 'gemini-2.5-flash-image', usage: { provider: 'gemini', inputTokens: 300, outputTokens: 1290, pictures: 1 } }; }

var cp = require('./chat-picture');
var pictureJob = require('./picture-job');
var switches = require('./picture-switches');
var plan = require('./picture-plan');
var caps = require('./picture-capabilities');
var brief = require('./picture-brief');
var critic = require('./picture-critic');
var edit = require('./picture-edit');
var refs = require('./picture-refs');
var ledger = require('./picture-ledger');
var fit = require('./picture-fit');

/* an in-memory Firestore with transactions (every read before any write, as Firestore requires) */
function fakeFb() {
  var docs = {}, saved = {}, ver = {};
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return fb.failReads ? Promise.reject(new Error('UNAVAILABLE')) : Promise.resolve(snap(p)); },
      set: function (data) { docs[p] = clone(data); ver[p] = (ver[p] || 0) + 1; return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); ver[p] = (ver[p] || 0) + 1; return Promise.resolve(); } };
  }
  function colRef(p) { return { path: p, doc: function (id) { return docRef(p + '/' + id); } }; }
  var fb = { docs: docs, saved: saved, reads: 0, retries: 0, txOrderBroken: false, failReads: false,
    db: { collection: function (n) { fb.reads++; return colRef(n); },
      /* as Firestore does: a transaction whose reads changed before it commits is run again (two pictures of one turn
         made side by side both reserve their own picture and both land on their own job) */
      runTransaction: function (fn) {
        function attempt(left) {
          var writes = [], seen = {};
          var tx = { get: function (ref) { if (writes.length) fb.txOrderBroken = true; seen[ref.path] = ver[ref.path] || 0; return Promise.resolve(snap(ref.path)); },
            set: function (ref, data) { writes.push(function () { docs[ref.path] = clone(data); ver[ref.path] = (ver[ref.path] || 0) + 1; }); return tx; },
            update: function (ref, data) { writes.push(function () { if (!docs[ref.path]) throw new Error('NOT_FOUND'); Object.keys(data).forEach(function (k) { docs[ref.path][k] = clone(data[k]); }); ver[ref.path] = (ver[ref.path] || 0) + 1; }); return tx; } };
          return Promise.resolve(fn(tx)).then(function (v) {
            var stale = Object.keys(seen).some(function (p) { return (ver[p] || 0) !== seen[p]; });
            if (stale) { fb.retries++; if (left <= 0) throw new Error('ABORTED'); return attempt(left - 1); }
            writes.forEach(function (w) { w(); });
            return v;
          });
        }
        return attempt(5);
      } },
    bucket: { name: 'test-bucket', file: function (path) { return { save: function (buf) { saved[path] = buf.length; return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } }; } } };
  return fb;
}

var EV = 'qa-seam', NOW = Date.UTC(2026, 10, 16, 6, 0, 0);
var EVENT = { name: 'QA Seam Summit', description: 'Leaders on the future of work', city: 'Mumbai', designPlan: { owner: { level: '' }, design: { mode: 'light', themeColor: '#c8102e' } } };
function ask(sectionId, extra) {
  return Object.assign({ n: 1, sectionId: sectionId, sectionName: sectionId, contextName: 'this', placement: 'picture', slot: 1, apply: 'swap', kind: 'place', alt: 'a quiet hall',
    subject: 'A quiet conference hall at dawn, rows of empty chairs facing a wide window', heroMode: '', ownerSubject: false, wide: false, aspect: '4:3', closeUp: false, rest: [], restNames: [],
    frame: '4:3', design: { themeColor: '#c8102e', mode: 'light' }, state: 'asked' }, extra || {});
}

(async function () {
  /* ======================= picture-job: the shape ======================= */
  var P1 = pictureJob.phase1Props();
  check(pictureJob.PHASE1_FIELDS.join() === 'mode,basedOn,ownerQuote,entities,editOf,change,changeKind,refs,variants', 'the phase-1 fields are declared once, in the plan\'s order', pictureJob.PHASE1_FIELDS.join());
  check(Object.keys(P1).every(function (k) { return P1[k] && typeof P1[k].type === 'string'; }) && P1.mode.enum.join() === 'new,edit,place' && P1.variants.enum.join() === '0,3' &&
    P1.entities.items.required.join() === 'text,type' && P1.refs.items.required.join() === 'n,use', 'each phase-1 field has a type; the enums and nested required lists are the contract\'s', J(P1.mode));
  check(pictureJob.MAX_JOBS === 4 && pictureJob.MAX_REFS === 3 && pictureJob.REFUSED_ENTITIES.join() === 'person,brand,organisation' && pictureJob.ENTITY_TYPES.indexOf('venue') !== -1 && pictureJob.ENTITY_TYPES.indexOf('landmark') !== -1,
    'up to 4 pictures a message, 3 references; people, brands and organisations refused, venues and landmarks not');
  var e0 = pictureJob.entryOf({ subject: 'x' });
  check(e0.mode === 'new' && e0.basedOn === 'owner-words' && e0.ownerQuote === '' && !e0.entities.length && e0.editOf === '' && e0.changeKind === '' && !e0.refs.length && e0.variants === 0,
    'an entry of an older answer (no new fields) is a new picture from the owner\'s words, nothing else', J(e0));
  var e1 = pictureJob.entryOf({ mode: 'edit', editOf: 'selected', change: 'make the light warmer; change nothing else', changeKind: 'tone', variants: 3, ownerQuote: '  make it\nwarmer ',
    entities: [{ text: 'Davos', type: 'place' }, { text: 'X', type: 'spaceship' }, { text: '' }], refs: [{ n: 2, use: 'subject' }, { n: 2, use: 'style' }, { n: 99 }, { n: 3, use: 'copy' }, { n: 4 }, { n: 5 }] });
  check(e1.mode === 'edit' && e1.editOf === 'selected' && e1.changeKind === 'tone' && e1.variants === 3 && e1.ownerQuote === 'make it warmer' &&
    J(e1.entities) === J([{ text: 'Davos', type: 'place' }, { text: 'X', type: 'other' }]) && J(e1.refs) === J([{ n: 2, use: 'subject' }, { n: 3, use: 'style' }, { n: 4, use: 'style' }]),
    'an entry is cleaned: unknown types to "other", a number once, at most 3 references, an unknown use is style', J(e1));
  check(pictureJob.entryOf({ mode: 'new', editOf: 'selected', change: 'warmer', changeKind: 'tone' }).change === '', 'edit fields only on an edit');

  var legacy = ask('overview');
  var n0 = pictureJob.normalise(legacy);
  check(n0.k === 0 && n0.mode === 'new' && n0.state === 'asked' && n0.brief === null && n0.review === null && n0.editOf === null && n0.focus === null && n0.refs.length === 0 && n0.placed === '' &&
    n0.subject === legacy.subject && n0.frame === '4:3' && n0.closeUp === false && J(n0.design) === J(legacy.design) && legacy.k === undefined,
    'normalise defaults the plan fields and keeps every field of today\'s newPicture as it is (the stored one untouched)', J(n0));
  var nb = pictureJob.normalise(Object.assign({}, legacy, { brief: { scene: 'A deserted promenade before dawn', palette: 'deep blue, warm amber', extra: 'dropped' },
    refs: [{ url: 'https://storage.googleapis.com/b/events/qa-seam/chat-docs/x/1.jpg', kind: 'document', use: 'subject' }, { url: 'https://storage.googleapis.com/b/events/qa-seam/generated/h.png', kind: 'site', use: 'subject' },
      { url: 'https://storage.googleapis.com/b/events/old/x.png', kind: 'previous-edition', use: 'as-is' }, { url: 'http://insecure/x.png', kind: 'site' }, { url: 'https://x/y.png', kind: 'web' }],
    focus: { x: 0.25, y: 1.4 }, review: { verdict: 'repair', flags: ['people', 'people', 'border'], found: { people: { found: true, boxes: [{ x: 0.1, y: 0.7, w: 0.1, h: 0.2 }, { x: 2 }] }, text: false }, scores: { brief: 4, tone: 9 }, repair: 'remove the two figures' },
    variantOf: '1', placed: 'placed', line: 'Placed.' }), 2);
  check(nb.k === 2 && nb.brief && nb.brief.scene === 'A deserted promenade before dawn' && nb.brief.palette === 'deep blue, warm amber' && nb.brief.extra === undefined && nb.brief.notThis === '',
    'a brief keeps its known fields only', J(nb.brief));
  check(nb.refs.length === 3 && nb.refs[0].use === 'subject' && nb.refs[1].use === 'style' && nb.refs[2].use === 'style' && nb.refs.every(function (r) { return /^https:/.test(r.url); }),
    'references: https only, a known kind only; the site\'s own and the previous edition\'s are style only (inspire, never copy)', J(nb.refs));
  check(nb.focus === null && nb.review.verdict === 'repair' && J(nb.review.flags) === J(['people', 'border']) && nb.review.found.people.found === true && nb.review.found.people.boxes === 1 && nb.review.found.text === false &&
    nb.review.scores.brief === 4 && nb.review.scores.tone === undefined && nb.review.repair === 'remove the two figures' && nb.variantOf === 1 && nb.placed === 'placed',
    'a focus outside the picture is none; a review keeps counts of boxes, never the boxes themselves past the job', J(nb.review));

  check(pictureJob.jobsOf(null).length === 0 && pictureJob.jobsOf({}).length === 0 && pictureJob.jobsOf({ newPicture: legacy }).length === 1 && pictureJob.jobsOf({ newPicture: legacy })[0] === legacy,
    'jobsOf: a turn written before jobs is its one newPicture, as stored');
  var multi = { newPicture: ask('a'), pictureJobs: [ask('a'), ask('b'), ask('c'), ask('d'), ask('e')] };
  check(pictureJob.jobsOf(multi).length === 4 && pictureJob.jobOf(multi, 1).sectionId === 'b' && pictureJob.jobOf(multi, 4) === null && pictureJob.jobOf(multi, -1) === null && pictureJob.jobOf({ newPicture: legacy }, 1) === null,
    'jobsOf: pictureJobs, at most 4; jobOf one of them or none');
  check(J(Object.keys(pictureJob.jobPatch({ newPicture: legacy }, 0, { state: 'making' }))) === J(['newPicture']), 'jobPatch: a turn of one picture keeps it in newPicture alone');
  var pp = pictureJob.jobPatch(multi, 2, { sectionId: 'c', state: 'made' }), pp0 = pictureJob.jobPatch(multi, 0, { sectionId: 'a', state: 'made' });
  check(pp.pictureJobs.length === 4 && pp.pictureJobs[2].state === 'made' && pp.newPicture === undefined && pp0.newPicture.state === 'made' && pp0.pictureJobs[0].state === 'made',
    'jobPatch: job k rewritten in pictureJobs; job 0 also in newPicture, for older editors and the history line', J(pp0));
  var threw = 0;
  try { pictureJob.jobPatch({ newPicture: legacy }, 1, {}); } catch (e) { threw++; }
  try { pictureJob.jobPatch(multi, 7, {}); } catch (e) { threw++; }
  check(threw === 2, 'jobPatch refuses a job the turn does not have');
  var wrote = [];
  pictureJob.writeJob({ update: function (ref, data) { wrote.push(data); } }, {}, 1, { state: 'making' }, multi, { updatedAt: 'now' });
  check(wrote.length === 1 && wrote[0].pictureJobs[1].state === 'making' && wrote[0].pictureJobs[1].sectionId === 'b' && wrote[0].updatedAt === 'now', 'writeJob merges the patch onto the job as read', J(wrote[0] && wrote[0].pictureJobs[1]));
  check(pictureJob.phaseOf({ state: 'asked' }) === 'planned' && pictureJob.phaseOf({ state: 'made', held: true }) === 'held' && pictureJob.phaseOf({ state: 'made' }) === 'made' &&
    pictureJob.phaseOf({ state: 'made', placed: 'undone' }) === 'undone' && pictureJob.phaseOf({ state: 'offered' }) === 'offered' && pictureJob.phaseOf(null) === '',
    'phaseOf gives the plan\'s names from the stored state');
  var aj = pictureJob.answerJob(Object.assign(ask('overview'), { k: 1, subject: new Array(60).join('word ') }));
  check(aj.k === 1 && aj.sectionId === 'overview' && aj.mode === 'new' && aj.subject.length <= 140 && aj.design === undefined && aj.variantOf === undefined, 'answerJob: what the editor is sent, never the whole job', J(aj));

  /* ======================= picture-switches ======================= */
  var FBS = fakeFb();
  switches.forget();
  var s0 = await switches.read(FBS);
  check(switches.NAMES.join() === 'plan,brief,critic,repair,edit,refs,variants' && switches.NAMES.every(function (n) { return s0[n] === false; }) && s0.stored === false && s0.exclude.length === 0,
    'no document: every switch is off (today\'s behaviour)', J(s0));
  check(switches.docPath() === 'config/aiPictures', 'the document is config/aiPictures', switches.docPath());
  FBS.docs['config/aiPictures'] = { plan: true, critic: false, repair: true, refs: 'yes', variants: true, exclude: ['ai-hero', 'nobody'] };
  var cached = await switches.read(FBS);
  check(cached.plan === false, 'read at most once a minute: the cached answer stands', J(cached));
  var s1 = await switches.read(FBS, { fresh: true });
  check(s1.stored && s1.plan === true && s1.critic === false && s1.repair === false && s1.refs === false && s1.variants === true && J(s1.exclude) === J(['ai-hero']),
    'stored: only true is on; a repair needs the Critic; unknown callers dropped', J(s1));
  check(switches.on(s1, 'plan') && switches.on(s1, 'plan', 'chat') && !switches.on(s1, 'repair') && !switches.on(s1, 'nothing') && !switches.on(null, 'plan') && !switches.on(switches.OFF, 'plan'),
    'on(): the switch, for the chat by default');
  check(switches.on(switches.normalise({ critic: true, exclude: ['ai-hero'] }), 'critic', 'promo') && !switches.on(switches.normalise({ critic: true, exclude: ['ai-hero'] }), 'critic', 'ai-hero'),
    'on(): a caller left out stays on today\'s path');
  check(Object.isFrozen(switches.OFF) && switches.OFF.variants === false, '"Show 3 options" is off unless the document turns it on (owner, 16 Nov 2026)');
  var FBF = fakeFb(); FBF.failReads = true;
  var realErr = console.error, errs = [];
  console.error = function (l) { errs.push(String(l)); };
  var sf = await switches.read(FBF);
  console.error = realErr;
  check(sf.plan === false && sf.stored === false && errs.length === 1, 'unreadable: every switch off, said once in the log', J(errs));
  process.env.PICTURE_SWITCHES_DOC = 'config/qa-pai0-pictures';
  check(switches.docPath() === 'config/qa-pai0-pictures', 'QA uses its own document (PICTURE_SWITCHES_DOC), never the live one');
  delete process.env.PICTURE_SWITCHES_DOC;

  /* ======================= the stubs: today's behaviour ======================= */
  var ctx = { canMakePictures: true, eventId: EV, sections: [{ id: 'overview', name: 'Overview', role: '', pics: { slots: 1, list: ['a hall'], background: false, heroTarget: '', own: [] } }],
    focus: { sectionId: 'overview' }, instruction: 'make a new picture for the overview section: a quiet conference hall at dawn', attachmentCount: 0, picturesLeft: 10, eventData: EVENT, designPlan: EVENT.designPlan, earlier: [] };
  var entry = { sectionId: 'overview', placement: 'picture', slot: 0, subject: 'A quiet conference hall at dawn, rows of empty chairs', plainSubject: 'A quiet conference hall at dawn', kind: 'place', alt: 'a hall', frame: '', reference: 0 };
  var today = cp.planAsk([entry], clone(ctx)), planned = plan.planPictures([entry], clone(ctx));
  var withoutJobs = Object.assign({}, planned); delete withoutJobs.jobs;
  check(J(withoutJobs) === J(today), 'planPictures is planAsk exactly, while builder A has not filled it', J(withoutJobs).slice(0, 300) + ' vs ' + J(today).slice(0, 300));
  check(today.ask ? planned.jobs.length === 1 && planned.jobs[0].k === 0 && planned.jobs[0].sectionId === today.ask.sectionId && planned.jobs[0].mode === 'new' : planned.jobs.length === 0,
    '… and its one ask is job 0', J(planned.jobs));
  var none = plan.planPictures([], clone(ctx));
  check(none.ask === null && none.jobs.length === 0, 'no entry: no job');
  check((await brief.writeBriefs([n0], {})) === null && brief.promptFromBrief({ scene: 'x' }, n0, {}) === '' && (await brief.writeStyleCard({})) === null, 'the Director writes nothing yet');
  var bs = await brief.briefStep({}, {});
  check(bs.status === 200 && bs.body.briefs === 0, 'the brief step answers that there is nothing to do', J(bs));
  var er = await edit.run(n0, {});
  check(er.code === 'not-supported' && edit.classify('tone') === '' && (await edit.sharpOps(PNG, n0)) === null, 'an edit is not supported yet', J(er));
  check(J(await refs.load(n0, {})) === '[]' && refs.ownOnly('https://x', {}) === '' && (await refs.dHash(PNG)) === null && refs.nearCopy('a', 'a') === false && refs.COPY_DISTANCE === 10, 'no reference is loaded yet');
  /* builder A (16 Nov 2026): the ledger is filled; with no store it reads empty and keeps nothing (picture-ledger.test.js) */
  check(J(await ledger.read(null, EV, 'u')) === '[]' && J(await ledger.record(null, EV, 'u', [])) === '[]' && ledger.promptLines([]) === '' && ledger.LEDGER_MAX === 20, 'the ledger with no store reads empty and keeps nothing');
  var fs0 = await fit.fitStep({}, {});
  check(fs0.status === 501 && fs0.body.code === 'not-supported' && /Nothing on your site changed/.test(fs0.body.error) && !/\bET\b/.test(fs0.body.error), 'the fit step says it is not available, in plain words', J(fs0));
  /* builder A (16 Nov 2026): the manifest is filled; it is read only with `plan` on (picture-capabilities.test.js) */
  check(caps.claimCheck('I can\'t see the pictures inside your PDF', switches.OFF).ok === false && caps.claimCheck('I made the banner warmer.', switches.OFF).ok === true &&
    /WHAT YOU CAN DO WITH PICTURES/.test(caps.promptBlock(switches.OFF)) && !/up to 4/.test(caps.promptBlock(switches.OFF)) && /real or named people/.test(caps.sentence('real-people')) &&
    caps.MANIFEST.can.length >= 5 && caps.MANIFEST.cannot.some(function (c) { return c.code === 'real-people'; }), 'the manifest is listed, and claims only what the switches allow');
  check(caps.MANIFEST.can.concat(caps.MANIFEST.cannot).every(function (c) { return !/\bET\b/.test(c.words); }), 'the manifest\'s words never say a bare "ET"');

  /* the Critic's stub is today's check: its review, and its decide table against the runner as it was */
  checkAnswers.push(found(true, false, true));
  var rv = await critic.review({ bytes: PNG, type: 'image/png' }, n0, { rule: 'none', eventId: EV });
  check(rv.verdict === 'remake' && J(rv.flags) === J(['people', 'logos']) && rv.found.people === true && rv.source === 'check' && checkCalls[checkCalls.length - 1].opts.route === 'picture-check',
    'review(): today\'s Haiku check, what the place forbids as flags', J(rv));
  checkAnswers.push(found(true, false, false));
  var rva = await critic.review({ bytes: PNG, type: 'image/png' }, n0, { rule: 'allowed', eventId: EV });
  check(rva.verdict === 'ok' && rva.flags.length === 0, 'review(): people where people are allowed are no flag', J(rva));
  var T = { maxTries: 3, retryNeedsMs: 50000 };
  check(critic.decide({ flags: [] }, Object.assign({ calls: 1, timeLeftMs: 0 }, T)).action === 'keep', 'decide: nothing found → keep');
  var d1 = critic.decide({ flags: ['people'] }, Object.assign({ calls: 1, made: 1, timeLeftMs: 120000 }, T));
  check(d1.action === 'remake' && d1.line === cp.againLine(['people']), 'decide: found on the first → a remake with the stronger line', J(d1));
  var d2 = critic.decide({ flags: ['text'] }, Object.assign({ calls: 2, made: 2, timeLeftMs: 120000 }, T));
  check(d2.action === 'remake' && d2.line === cp.againLine(['text']) + ' ' + cp.strictLine(['text']), 'decide: found on the second → the strictest third', J(d2));
  check(critic.decide({ flags: ['text'] }, Object.assign({ calls: 3, made: 3, timeLeftMs: 120000 }, T)).why === 'tries', 'decide: found on the third → held (tries)');
  check(critic.decide({ flags: ['logos'] }, Object.assign({ calls: 1, made: 1, timeLeftMs: 49999 }, T)).why === 'time', 'decide: no time for another → held (time)');
  check(critic.decide({ flags: ['logos'] }, { calls: 1, timeLeftMs: 120000 }).action === 'remake', 'decide: chat-picture\'s own limits when none are given');
  check((await critic.trimBorders(PNG)) === null && J(await critic.framePreviews({}, n0)) === '[]', 'no border is trimmed yet');

  /* ======================= the runner's hook points (chat-picture.js make) ======================= */
  var FB = fakeFb(), seq = 0, logged = [];
  function turnOf(data) {
    var id = 'SeamTurn' + String(++seq).padStart(6, '0') + 'ab';
    FB.docs['events/' + EV + '/aiChats/u-asha/turns/' + id] = Object.assign({ question: 'q', kind: 'edit', status: 'applying' }, clone(data));
    return FB.db.collection('events').doc(EV).collection('aiChats').doc('u-asha').collection('turns').doc(id);
  }
  function stored(ref) { return clone(FB.docs[ref.path]); }
  /* the server's own log lines (a stand-in PNG cannot be cut, a failed call) are kept here, not printed; two runs side
     by side share the one stand-in */
  var realError = console.error, running = 0;
  function run(ref, o) {
    if (!running++) console.error = function (l) { logged.push(String(l)); };
    function done() { if (!--running) console.error = realError; }
    return cp.make({ record: function () {}, recordCheck: function () {} }, Object.assign({ fb: FB, eventId: EV, uid: 'u-asha', turnRef: ref, eventData: EVENT, decoded: { email: 'asha@timesinternet.in' }, now: NOW }, o || {}))
      .then(function (v) { done(); return v; }, function (e) { done(); throw e; });
  }

  /* a turn of one picture, every switch off: as before, and no reference shown */
  var r1 = turnOf({ newPicture: ask('overview') });
  var i0 = imageCalls.length;
  var out = await run(r1);
  var t1 = stored(r1);
  check(out.status === 200 && t1.newPicture.state === 'made' && t1.pictureJobs === undefined && t1.newPicture.k === undefined && t1.newPicture.mode === undefined,
    'a turn of one picture: made and kept in newPicture alone, with no field added', J(t1.newPicture).slice(0, 300));
  check(imageCalls.length === i0 + 1 && imageCalls[i0].opts.images === undefined && imageCalls[i0].opts.image === undefined && imageCalls[i0].prompt === cp.promptFor(ask('overview'), EVENT),
    'every switch off: today\'s prompt, and the picture model is shown no picture', J(imageCalls[i0].opts));

  /* a turn of several pictures: each job made on its own, job 0 mirrored to newPicture, the others not */
  var jobs = [ask('overview', { k: 0 }), ask('agenda', { k: 1, n: 2 }), ask('venue', { k: 2, n: 3 })];
  var r2 = turnOf({ newPicture: jobs[0], pictureJobs: jobs });
  var both = await Promise.all([run(r2, { job: 1 }), run(r2, { job: 2 })]);
  var t2 = stored(r2);
  check(both[0].status === 200 && both[1].status === 200 && t2.pictureJobs[1].state === 'made' && t2.pictureJobs[2].state === 'made' && t2.pictureJobs[0].state === 'asked' && t2.newPicture.state === 'asked' &&
    both[0].body.sectionId === 'agenda' && both[1].body.sectionId === 'venue' && t2.pictureJobs[1].url !== t2.pictureJobs[2].url,
    'two jobs made side by side: each recorded on its own job, neither lost, job 0 untouched', J(t2.pictureJobs.map(function (j) { return j.state + ' ' + j.url; })));
  check(Object.keys(FB.saved).length === 3 && /-chat-place-SeamTurn-1\.png$/.test(t2.pictureJobs[1].url) && /-chat-place-SeamTurn-2\.png$/.test(t2.pictureJobs[2].url) && !/-\d\.png$/.test(t1.newPicture.url),
    'each job its own file (job k past the first named in it), a turn of one picture\'s file named as before', J(Object.keys(FB.saved)));
  var q = clone(FB.docs['aiQuota/u-asha']);
  check(q && q.made === 3, 'each job is one of the day\'s pictures (one turn of one picture and two jobs: 3)', J(q));
  out = await run(r2, { job: 0 });
  t2 = stored(r2);
  check(out.status === 200 && t2.pictureJobs[0].state === 'made' && t2.newPicture.state === 'made' && t2.newPicture.url === t2.pictureJobs[0].url, 'job 0 made: newPicture says so too');
  out = await run(r2, { job: 1 });
  check(out.status === 200 && out.body.url === t2.pictureJobs[1].url && clone(FB.docs['aiQuota/u-asha']).made === 4, 'asking for a made job again answers it free');
  check((await run(r2, { job: 3 })).status === 404 && (await run(r2, { job: 9 })).status === 404 && (await run(r1, { job: 1 })).status === 404, 'a job the turn does not have is no picture');
  check(!FB.txOrderBroken, 'every transaction reads before it writes');

  /* a failed job is recorded on that job */
  var r3 = turnOf({ newPicture: jobs[0], pictureJobs: clone(jobs) });
  imageAnswers.push(gemini.failure('ai-unavailable', { provider: 'gemini' }));
  out = await run(r3, { job: 1 });
  var t3 = stored(r3);
  check(out.status >= 500 && t3.pictureJobs[1].state === 'failed' && t3.pictureJobs[0].state === 'asked' && t3.newPicture.state === 'asked', 'a failed job is recorded on that job alone', J(t3.pictureJobs.map(function (j) { return j.state; })));

  /* refs on: the references the registry loads go to the picture model; off, it is never asked */
  var realLoad = refs.load, loads = [];
  refs.load = function (job, c) { loads.push({ job: job.sectionId, eventId: c.eventId }); return Promise.resolve([{ mimeType: 'image/jpeg', data: 'AAAA', label: 'Reference 1, STYLE ONLY', kind: 'site', use: 'style' }]); };
  var r4 = turnOf({ newPicture: ask('overview') });
  i0 = imageCalls.length;
  await run(r4, { switches: switches.normalise({ refs: true }) });
  check(loads.length === 1 && loads[0].eventId === EV && imageCalls[i0].opts.images && imageCalls[i0].opts.images.length === 1 && imageCalls[i0].opts.images[0].label === 'Reference 1, STYLE ONLY',
    '`refs` on: the loaded references go to the picture model as images', J(imageCalls[i0].opts.images));
  await run(turnOf({ newPicture: ask('overview') }), { switches: switches.normalise({ refs: true, exclude: ['chat'] }) });
  await run(turnOf({ newPicture: ask('overview') }));
  check(loads.length === 1, '`refs` off, or the caller left out: the registry is never asked');
  refs.load = realLoad;

  /* brief on: the Director's prompt is used when the job has a brief; off, today's prompt */
  var realPfb = brief.promptFromBrief;
  brief.promptFromBrief = function (b) { return 'BRIEFED: ' + b.scene; };
  i0 = imageCalls.length;
  await run(turnOf({ newPicture: ask('overview', { brief: { scene: 'a deserted promenade before dawn' } }) }), { switches: switches.normalise({ brief: true }) });
  await run(turnOf({ newPicture: ask('overview', { brief: { scene: 'a deserted promenade before dawn' } }) }));
  check(imageCalls[i0].prompt === 'BRIEFED: a deserted promenade before dawn' && imageCalls[i0 + 1].prompt === cp.promptFor(ask('overview', { brief: { scene: 'x' } }), EVENT),
    '`brief` on: the brief\'s prompt; off: today\'s', imageCalls[i0].prompt);
  brief.promptFromBrief = function () { return ''; };
  i0 = imageCalls.length;
  await run(turnOf({ newPicture: ask('overview', { brief: { scene: 'x' } }) }), { switches: switches.normalise({ brief: true }) });
  check(imageCalls[i0].prompt === cp.promptFor(ask('overview'), EVENT), 'a brief that gives no prompt: today\'s prompt');
  brief.promptFromBrief = realPfb;

  /* edit on: the stub's not-supported makes a new picture as today; an edit that answers bytes is stored with no picture call */
  i0 = imageCalls.length;
  out = await run(turnOf({ newPicture: ask('overview', { mode: 'edit', editOf: { url: 'https://storage.googleapis.com/test-bucket/events/qa-seam/generated/a.png' }, change: 'warmer', changeKind: 'tone' }) }), { switches: switches.normalise({ edit: true }) });
  check(out.status === 200 && imageCalls.length === i0 + 1, '`edit` on, not built yet: a new picture is made, as today');
  var realRun = edit.run, runs = [];
  edit.run = function (job, c) { runs.push(job.changeKind); return Promise.resolve({ bytes: PNG, type: 'image/png', width: 4, height: 3, how: 'sharp', line: 'Warmer light on the same picture.' }); };
  i0 = imageCalls.length;
  var r5 = turnOf({ newPicture: ask('overview', { mode: 'edit', change: 'warmer', changeKind: 'tone' }) });
  out = await run(r5, { switches: switches.normalise({ edit: true }) });
  check(out.status === 200 && runs.join() === 'tone' && imageCalls.length === i0 && stored(r5).newPicture.state === 'made', 'an edit that answers its picture: checked and stored, no picture call', J(out));
  edit.run = function () { return Promise.resolve({ code: 'ai-unavailable', status: 502 }); };
  var r6 = turnOf({ newPicture: ask('overview', { mode: 'edit', change: 'remove the people', changeKind: 'remove' }) });
  out = await run(r6, { switches: switches.normalise({ edit: true }) });
  check(out.status === 502 && stored(r6).newPicture.state === 'failed' && imageCalls.length === i0, 'an edit that fails: the job fails in plain words, nothing remade blind', J(out));
  i0 = imageCalls.length;
  await run(turnOf({ newPicture: ask('overview', { mode: 'edit', change: 'warmer', changeKind: 'tone' }) }));
  check(imageCalls.length === i0 + 1, '`edit` off: never asked, a new picture as today');
  edit.run = realRun;

  /* the Critic's hooks: review() after each picture, decide() for what comes next */
  var realReview = critic.review, realDecide = critic.decide, reviews = 0, decisions = [];
  critic.review = function (pic, job, c) { reviews++; return Promise.resolve(reviews === 1 ? { verdict: 'remake', flags: ['people'], found: { people: true, text: false, logos: false } } : { verdict: 'ok', flags: [], found: { people: false, text: false, logos: false } }); };
  critic.decide = function (rev, t) { decisions.push({ flags: rev.flags.join(), calls: t.calls, made: t.made }); return realDecide(rev, t); };
  i0 = imageCalls.length;
  var r7 = turnOf({ newPicture: ask('overview') });
  out = await run(r7);
  var t7 = stored(r7);
  check(reviews === 2 && decisions.length === 2 && decisions[0].flags === 'people' && decisions[0].calls === 1 && decisions[1].calls === 2 && decisions[1].made === 2 &&
    imageCalls.length === i0 + 2 && imageCalls[i0 + 1].prompt === cp.promptFor(ask('overview'), EVENT) + ' ' + cp.againLine(['people']) && t7.newPicture.tries === 2 && J(t7.newPicture.checks[0]) === J({ people: true, text: false, logos: false }),
    'review() after each picture, decide() for the next: a remake with the decided line, the checks kept on the job', J(decisions));
  critic.decide = function () { return { action: 'hold', why: 'tries' }; };
  critic.review = function () { return Promise.resolve({ verdict: 'hold', flags: [], found: null, why: 'It shows a different mountain than Davos.' }); };
  var r8 = turnOf({ newPicture: ask('overview') });
  out = await run(r8);
  check(out.status === 200 && out.body.held === true && out.body.heldWhy === 'It shows a different mountain than Davos.' && stored(r8).newPicture.held === true,
    'a hold the Critic gives with no flag is kept off the page with its own reason', J(out.body));
  critic.review = realReview; critic.decide = realDecide;

  /* ======================= done ======================= */
  if (failures.length) { console.error('picture-seam: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('picture-seam: all ' + checks + ' checks passed');
})().catch(function (e) { console.error('picture-seam: the test itself stopped — ' + (e && e.stack || e)); process.exit(1); });
