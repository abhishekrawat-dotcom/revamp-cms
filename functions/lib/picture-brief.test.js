/* node functions/lib/picture-brief.test.js — ETB2B AI's Director (lib/picture-brief.js, plan of 16 Nov 2026 W2): the brief
   for each new picture of a message, written in one call; the picture model's prompt built from it (the scene and its
   composition first, colour names never codes, a positive "empty", a full-bleed picture, site generation's STRICT
   rules last); the site's style card; the brief step on /api/chat-edit; and the runner using a brief (its own, when
   the job has none). No network and no paid AI: the models and Firestore are stood in for. */
'use strict';
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + detail : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function J(v) { return JSON.stringify(v); }

var gemini = require('./gemini');
var pictures = require('./pictures');
var llm = require('./llm');
var imageCalls = [], llmCalls = [], briefAnswers = [];
var PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
gemini.callGeminiImage = function (prompt, opts) { imageCalls.push({ prompt: prompt, opts: opts }); return Promise.resolve({ mimeType: 'image/png', base64: PNG.toString('base64'), usage: { provider: 'gemini', model: 'gemini-2.5-flash-image', pictures: 1, usd: null } }); };
pictures.storeVariants = function () { return Promise.resolve(null); };
llm.callJson = function (prompt, schema, opts) {
  llmCalls.push({ prompt: prompt, schema: schema, opts: opts });
  if (opts.route === 'picture-brief') {
    var a = briefAnswers.length ? briefAnswers.shift() : { code: 'ai-unavailable', error: 'x', status: 502 };
    if (a.usage && typeof opts.onUsage === 'function') opts.onUsage(a.usage);
    return Promise.resolve(a);
  }
  return Promise.resolve({ parsed: { people: false, text: false, logos: false } });
};

var cp = require('./chat-picture');
var pb = require('./picture-brief');
var switches = require('./picture-switches');
var pictureJob = require('./picture-job');

var EV = 'qa-brief';
var EVENT = { name: 'ET DAVOS 2027', description: 'A curated India week in Davos during the World Economic Forum', city: 'Davos',
  designPlan: { owner: { level: '' }, design: { mode: 'light', themeColor: '#c8102e', accentColor: '#d4af37', imageStyle: 'Alpine editorial photography, crisp winter light', place: { city: 'Davos', cues: 'a snowy valley, chalets, the Promenade' } },
    sections: [{ id: 'what-awaits', name: 'What Awaits You', image: 'an empty studio set with two armchairs' }] } };
var BRIEF_ON = switches.normalise({ brief: true });
function job(extra) {
  return Object.assign({ n: 1, sectionId: 'hero', sectionName: 'Hero', contextName: 'this', placement: 'hero', slot: 0, apply: 'swap', kind: 'place', alt: 'the valley',
    subject: 'The snowy Davos valley at blue hour with the Promenade lights', plainSubject: 'The snowy Davos valley at blue hour', ownerSubject: true, heroMode: '', wide: true,
    aspect: '21:9', closeUp: false, rest: [], restNames: [], frame: '1440:600', design: {}, state: 'asked' }, extra || {});
}
var SCENE = 'A broad high Alpine valley at blue hour, the lake frozen and pale, rounded wooded ridges rising on both sides, chalet roofs under deep snow glowing with warm window light along the Promenade, the sky deepening from violet to navy above white peaks.';
var BRIEF = { scene: SCENE, composition: 'the valley floor low across the frame, ridges at both sides, the centre open sky', palette: 'navy, violet, warm amber, #c8102e accents, snow white',
  light: 'blue hour with warm window glow', medium: 'photo-real editorial photograph', placeCues: 'a broad high valley, a lake, rounded wooded ridges, chalet roofs', notThis: 'the Matterhorn\'s pyramid peak', peopleLine: 'two people on the Promenade' };
function answer(briefs, card) {
  return { parsed: { briefs: briefs, styleCard: card || { palette: 'navy, snow white, crimson accents', light: 'blue hour', medium: 'editorial photograph', finish: 'crisp, quiet' } },
    usage: { provider: 'claude', model: 'claude-sonnet-5-5', inputTokens: 3000, outputTokens: 900, usd: 0.015 } };
}

(async function () {
  var logged = [], realErr = console.error;
  console.error = function (l) { logged.push(String(l)); };

  /* ======================= colours in words ======================= */
  check(pb.colourName('#c8102e') === 'crimson' && pb.colourName('#D4AF37') === 'gold' && pb.colourName('#fff') === 'white' && pb.colourName('#0b1f4d') === 'navy' && pb.colourName('red') === '',
    'a colour code is named in words', [pb.colourName('#c8102e'), pb.colourName('#D4AF37'), pb.colourName('#0b1f4d')].join());

  /* ======================= the prompt from a brief ======================= */
  var hero = job(), p = pb.promptFromBrief(BRIEF, hero, {});
  check(p.indexOf('Create the wide picture for the hero banner') === 0 && p.indexOf('Scene: ' + SCENE) > 0 && p.indexOf('Scene: ') < p.indexOf('Composition: ') && p.indexOf('Composition: ') < p.indexOf('Palette: '),
    'the scene and its composition first, the palette after', p.slice(0, 300));
  check(p.slice(-cp.strictRules(hero).length) === cp.strictRules(hero) && /STRICT: no people in any form/.test(p.slice(-700)), 'site generation\'s STRICT rules, and who may be in it, end the prompt', p.slice(-300));
  check(!/#[0-9a-f]{3,6}\b/i.test(p) && /Palette: navy, violet, warm amber, crimson accents, snow white\./.test(p), 'colours in words only: a code in the brief is named', (/Palette: [^.]*\./.exec(p) || [])[0]);
  check(p.indexOf(cp.EMPTY_PLACE) !== -1 && !/People: /.test(p), 'the banner: an empty place in positive words, and no people line even when the brief gave one');
  check(/The place is recognisably itself, true to its real shape and setting: a broad high valley, a lake, rounded wooded ridges, chalet roofs\./.test(p) && /It is not the Matterhorn's pyramid peak\./.test(p),
    'what makes the place itself, and the look-alike it is not');
  check(/A full-bleed photograph, edge to edge, with no border, frame, mat or picture inside a picture\./.test(p) && /the centre stays calm/.test(p) && /Wide panorama, 21:9\./.test(p),
    'a full-bleed picture (no white mat), the banner\'s calm centre, its shape');
  var band = pb.promptFromBrief(BRIEF, job({ sectionId: 'kdp', sectionName: 'Key Discussion Points', placement: 'background', frame: '1152:340', aspect: '21:9', ownerSubject: false }), {});
  check(/Only a thin band across the middle of the picture is shown/.test(band) && /behind the section's text under a veil/.test(band), 'a frame wider than 21:9: the subject kept in the band it shows', band.slice(0, 200));
  var who = job({ sectionId: 'who', sectionName: 'Who Should Attend', placement: 'picture', kind: 'people', frame: '644:745', aspect: '', ownerSubject: false });
  var pp = pb.promptFromBrief(Object.assign({}, BRIEF, { peopleLine: 'two Indian women and one man in conversation, seen side-on' }), who, {});
  check(/People: two Indian women and one man in conversation, seen side-on — made-up Indian people, with women among them, who look like nobody real or famous\./.test(pp) && pp.indexOf(cp.EMPTY_PLACE) === -1 && !/STRICT: no people in any form/.test(pp),
    'a people section: its people line, Indian with women among them, nobody real', pp.slice(0, 400));
  check(pb.promptFromBrief({ scene: '' }, hero, {}) === '' && pb.promptFromBrief(null, hero, {}) === '', 'no scene, no prompt (today\'s is used)');
  var g = pb.promptFromBrief(BRIEF, job({ kind: 'graphic', placement: 'picture', sectionId: 'agenda', frame: '4:3', aspect: '4:3', ownerSubject: false }), {});
  check(/refined graphic illustration \(not a photograph\)/.test(g) && /The artwork fills the whole canvas, edge to edge, with no border, frame or mat\./.test(g) && g.indexOf(cp.EMPTY_SCENE) === -1, 'an illustration: artwork wording, no empty-place line');

  /* ======================= writeBriefs ======================= */
  llmCalls.length = 0;
  check((await pb.writeBriefs([hero], { eventId: EV, eventData: EVENT })) === null && llmCalls.length === 0, '`brief` off: nothing asked, no brief');
  var long = new Array(200).join('snow ') + 'end.';
  briefAnswers.push(answer([Object.assign({ k: 0 }, BRIEF, { peopleLine: 'two people walking' }), Object.assign({ k: 1 }, BRIEF, { scene: long, palette: '#0b1f4d and #d4af37', peopleLine: 'two Indian women and one man in conversation' })]));
  var two = [hero, Object.assign({}, who, { k: 1 })];
  var out = await pb.writeBriefs(two, { eventId: EV, eventData: EVENT, ownerWords: 'Make a new hero picture of the Davos valley and a people picture for Who Should Attend', switches: BRIEF_ON, record: function () {} });
  var call = llmCalls[0] || { opts: {} };
  check(llmCalls.length === 1 && call.opts.route === 'picture-brief' && call.schema === pb.BRIEF_SCHEMA && typeof call.opts.onUsage === 'function' && call.opts.timeoutMs === 45000,
    'one call for every picture of the message (route picture-brief: Sonnet)', J(call.opts));
  check(out && out.length === 2 && out[0].scene === SCENE && out[0].peopleLine === '' && out[1].peopleLine === 'two Indian women and one man in conversation' &&
    out[1].scene.split(/\s+/).length <= pb.SCENE_WORDS && out[1].palette === 'navy and gold' && out.styleCard && out.styleCard.palette === 'navy, snow white, crimson accents',
    'each brief cleaned: a people line only where people may be, the scene within 120 words, colours named, the style card kept', J(out && out.map(function (b) { return b && { people: b.peopleLine, words: b.scene.split(/\s+/).length, palette: b.palette }; })));
  check(call.prompt.indexOf('ET DAVOS 2027') === -1 && /The owner's message: "Make a new hero picture of the Davos valley/.test(call.prompt) && /Show Davos recognisably/.test(call.prompt) &&
    /The site's colours: crimson and gold, on a light page\./.test(call.prompt) && /Who may be in it: nobody at all/.test(call.prompt) && /Who may be in it: people may be shown: made-up Indian people, with women among them/.test(call.prompt) &&
    /about 2\.4 times as wide as tall \(1440 x 600 px on a computer\); the event's name, date and buttons are set over its middle/.test(call.prompt) && !/#[0-9a-f]{6}/i.test(call.prompt),
    'the Director is told the event (never its name), the owner\'s words, the place, the colours in words, who may be in each, and each frame', call.prompt.slice(0, 600));
  briefAnswers.push(answer([Object.assign({ k: 5 }, BRIEF)]));
  var byIndex = await pb.writeBriefs([hero], { eventId: EV, eventData: EVENT, switches: BRIEF_ON });
  check(byIndex && byIndex[0] && byIndex[0].scene === SCENE, 'one brief for one picture is read as its own, whatever k it says');
  check((await pb.writeBriefs([hero], { eventId: EV, eventData: EVENT, switches: BRIEF_ON })) === null, 'the Director could not answer: no brief (today\'s prompt is used)');
  briefAnswers.push({ parsed: { nothing: true } });
  check((await pb.writeBriefs([hero], { eventId: EV, eventData: EVENT, switches: BRIEF_ON })) === null, 'an answer without briefs: no brief');
  briefAnswers.push(answer([{ k: 0, scene: 'too short' }]));
  check((await pb.writeBriefs([hero], { eventId: EV, eventData: EVENT, switches: BRIEF_ON })) === null, 'a scene of a few words is no brief');

  /* ======================= the style card ======================= */
  var docs = {}, writes = [];
  var FB = { db: { collection: function (c) { return { doc: function (id) { return { update: function (d) { writes.push({ path: c + '/' + id, d: clone(d) }); docs[c + '/' + id] = Object.assign(docs[c + '/' + id] || {}, clone(d)); return Promise.resolve(); } }; } }; } } };
  var card = await pb.writeStyleCard({ fb: FB, eventId: EV, eventData: EVENT, card: { palette: 'navy #0b1f4d, snow white', light: 'blue hour', medium: 'editorial photograph', finish: 'crisp' } });
  check(card && card.palette === 'navy navy, snow white' && writes.length === 1 && writes[0].path === 'events/' + EV && writes[0].d.pictureStyle.light === 'blue hour' && writes[0].d.pictureStyle.at,
    'the style card is kept on the event (events/<id>.pictureStyle), colours in words', J(writes));
  var kept = await pb.writeStyleCard({ fb: FB, eventId: EV, eventData: Object.assign({}, EVENT, { pictureStyle: { palette: 'gold' } }), card: { palette: 'red' } });
  check(kept.palette === 'gold' && writes.length === 1, 'an event that has one keeps it (rewritten only when asked)');
  var seeded = await pb.writeStyleCard({ fb: FB, eventId: EV, eventData: EVENT });
  check(seeded && seeded.palette === 'crimson and gold accents' && seeded.medium === 'Alpine editorial photography, crisp winter light', 'with no card from the Director: seeded from the design\'s own words', J(seeded));
  check((await pb.writeStyleCard({ fb: FB, eventId: EV, eventData: { designPlan: {} } })) === null && (await pb.writeStyleCard({})) === null, 'nothing to seed it from, or no database: none');

  /* ======================= the brief step ======================= */
  var tdocs = {}, txWrites = 0;
  function tSnap(pth) { return { exists: !!tdocs[pth], data: function () { return clone(tdocs[pth]); } }; }
  var TFB = { db: { collection: function (c) { return { doc: function (id) { return { update: function (d) { tdocs[c + '/' + id] = Object.assign(tdocs[c + '/' + id] || {}, clone(d)); return Promise.resolve(); } }; } }; },
    runTransaction: function (fn) { var w = []; var tx = { get: function (r) { return Promise.resolve(tSnap(r.path)); }, update: function (r, d) { w.push(function () { txWrites++; Object.keys(d).forEach(function (k) { tdocs[r.path][k] = clone(d[k]); }); }); return tx; } };
      return Promise.resolve(fn(tx)).then(function (v) { w.forEach(function (f) { f(); }); return v; }); } } };
  function tRef(id, data) { var pth = 'events/' + EV + '/aiChats/u/turns/' + id; tdocs[pth] = clone(data); return { id: id, path: pth, get: function () { return Promise.resolve(tSnap(pth)); } }; }
  var jobs2 = [job({ k: 0 }), Object.assign({}, who, { k: 1, n: 2 }), job({ k: 2, n: 3, mode: 'edit', sectionId: 'kdp' })];
  var r2 = tRef('TurnBrief000000001', { question: 'Give the banner and Who Should Attend new pictures, and make the KDP picture warmer', newPicture: jobs2[0], pictureJobs: jobs2 });
  llmCalls.length = 0;
  var off = await pb.briefStep({}, { fb: TFB, eventId: EV, uid: 'u', turnRef: r2, eventData: EVENT, switches: switches.OFF });
  check(off.status === 200 && off.body.briefs === 0 && llmCalls.length === 0, '`brief` off: nothing to do, nothing asked');
  briefAnswers.push(answer([Object.assign({ k: 0 }, BRIEF), Object.assign({ k: 1 }, BRIEF, { peopleLine: 'two Indian women and one man in conversation' })]));
  var used = [];
  var bs = await pb.briefStep({ record: function (u) { used.push(u); } }, { fb: TFB, eventId: EV, uid: 'u', turnRef: r2, eventData: EVENT, switches: BRIEF_ON });
  var t2 = tdocs[r2.path];
  check(bs.status === 200 && bs.body.briefs === 2 && llmCalls.length === 1 && /Give the banner and Who Should Attend new pictures/.test(llmCalls[0].prompt) && txWrites === 1 &&
    t2.pictureJobs[0].brief.scene === SCENE && t2.pictureJobs[1].brief.peopleLine === 'two Indian women and one man in conversation' && !t2.pictureJobs[2].brief &&
    J(t2.newPicture) === J(t2.pictureJobs[0]) && t2.pictureJobs[0].stage === 'brief' && used.length === 1,
    'the brief step: one call, every new picture of the turn briefed in one write (an edit is not), job 0 mirrored to newPicture, its usage recorded', J(t2.pictureJobs.map(function (j) { return !!j.brief; })));
  check(tdocs['events/' + EV] && tdocs['events/' + EV].pictureStyle && tdocs['events/' + EV].pictureStyle.medium === 'editorial photograph', 'the style card the Director wrote is kept on an event that had none');
  llmCalls.length = 0;
  var bs2 = await pb.briefStep({}, { fb: TFB, eventId: EV, uid: 'u', turnRef: r2, eventData: EVENT, switches: BRIEF_ON });
  check(bs2.body.briefs === 0 && llmCalls.length === 0, 'asked again: every picture has its brief, nothing asked');
  var r1 = tRef('TurnBrief000000002', { question: 'Make a new hero picture', newPicture: job() });
  briefAnswers.push(answer([Object.assign({ k: 0 }, BRIEF)]));
  var bs3 = await pb.briefStep({}, { fb: TFB, eventId: EV, uid: 'u', turnRef: r1, eventData: EVENT, switches: BRIEF_ON });
  check(bs3.body.briefs === 1 && tdocs[r1.path].newPicture.brief.scene === SCENE && tdocs[r1.path].pictureJobs === undefined, 'a turn of one picture: its newPicture briefed, no jobs list added');
  var r3 = tRef('TurnBrief000000003', { question: 'hi' });
  check((await pb.briefStep({}, { fb: TFB, eventId: EV, uid: 'u', turnRef: r3, eventData: EVENT, switches: BRIEF_ON })).status === 404, 'a turn with no picture: 404');
  var r4 = tRef('TurnBrief000000004', { question: 'Make a new hero picture', newPicture: job() });
  var bs4 = await pb.briefStep({}, { fb: TFB, eventId: EV, uid: 'u', turnRef: r4, eventData: EVENT, switches: BRIEF_ON });
  check(bs4.status === 200 && bs4.body.briefs === 0 && !tdocs[r4.path].newPicture.brief, 'the Director could not answer: 200, nothing written (the picture is made from today\'s prompt)');

  /* ======================= the runner with a brief ======================= */
  var store = {}, saved = {};
  function rSnap(pth) { return { id: pth.split('/').pop(), exists: !!store[pth], data: function () { return clone(store[pth]); } }; }
  function rRef(pth) { return { id: pth.split('/').pop(), path: pth, collection: function (n) { return rCol(pth + '/' + n); }, get: function () { return Promise.resolve(rSnap(pth)); },
    update: function (d) { Object.keys(d).forEach(function (k) { store[pth][k] = clone(d[k]); }); return Promise.resolve(); } }; }
  function rCol(pth) { return { doc: function (id) { return rRef(pth + '/' + id); } }; }
  var RFB = { db: { collection: function (n) { return rCol(n); }, runTransaction: function (fn) { var w = []; var tx = { get: function (r) { return Promise.resolve(rSnap(r.path)); },
      set: function (r, d) { w.push(function () { store[r.path] = clone(d); }); return tx; }, update: function (r, d) { w.push(function () { Object.keys(d).forEach(function (k) { store[r.path][k] = clone(d[k]); }); }); return tx; } };
      return Promise.resolve(fn(tx)).then(function (v) { w.forEach(function (f) { f(); }); return v; }); } },
    bucket: { name: 'test-bucket', file: function (pth) { return { save: function (b) { saved[pth] = b; return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } }; } } };
  store['events/' + EV] = clone(EVENT);
  var seq = 0;
  function rTurn(np) { var id = 'RunBrief' + String(++seq).padStart(6, '0') + 'ab', pth = 'events/' + EV + '/aiChats/u/turns/' + id; store[pth] = { question: 'Make a new hero picture of the Davos valley in winter', newPicture: clone(np) }; return rRef(pth); }
  function make(ref, sw) { return cp.make({ record: function () {}, recordCheck: function () {} }, { fb: RFB, eventId: EV, uid: 'u', turnRef: ref, eventData: EVENT, decoded: {}, now: Date.now(), switches: sw }); }
  llmCalls.length = 0; imageCalls.length = 0;
  briefAnswers.push(answer([Object.assign({ k: 0 }, BRIEF)]));
  var ref = rTurn(job());
  var res = await make(ref, BRIEF_ON);
  var np = store[ref.path].newPicture;
  check(res.status === 200 && llmCalls[0].opts.route === 'picture-brief' && /Make a new hero picture of the Davos valley in winter/.test(llmCalls[0].prompt) && imageCalls.length === 1 &&
    imageCalls[0].prompt === pb.promptFromBrief(np.brief, np, {}) && np.brief.scene === SCENE && np.stage === 'store' && /^I checked it before putting it in/.test(np.line),
    'a job with no brief gets its own from the Director, inside its deadline, and is made from it', imageCalls[0] && imageCalls[0].prompt.slice(0, 200));
  check(store['events/' + EV].pictureStyle && store['events/' + EV].pictureStyle.palette === 'navy, snow white, crimson accents', 'and the site\'s style card is kept when it had none');
  var withBrief = rTurn(job({ brief: BRIEF }));
  llmCalls.length = 0; imageCalls.length = 0;
  await make(withBrief, BRIEF_ON);
  check(llmCalls.every(function (c) { return c.opts.route !== 'picture-brief'; }) && imageCalls[0].prompt === pb.promptFromBrief(BRIEF, job(), {}), 'a job briefed by the brief step is not briefed again');
  llmCalls.length = 0; imageCalls.length = 0;
  var failed = rTurn(job());
  await make(failed, BRIEF_ON);
  check(llmCalls[0].opts.route === 'picture-brief' && imageCalls[0].prompt === cp.promptFor(job(), EVENT), 'the Director failed: today\'s prompt, and the picture is still made');
  llmCalls.length = 0; imageCalls.length = 0;
  await make(rTurn(job()), switches.OFF);
  check(llmCalls.every(function (c) { return c.opts.route !== 'picture-brief'; }) && imageCalls[0].prompt === cp.promptFor(job(), EVENT), '`brief` off: no Director, today\'s prompt');

  console.error = realErr;
  if (failures.length) { console.error('picture-brief: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('picture-brief: all ' + checks + ' checks passed');
})().catch(function (e) { console.error('picture-brief: the test itself stopped — ' + (e && e.stack || e)); process.exit(1); });
