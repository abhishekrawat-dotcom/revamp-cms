/* node functions/lib/picture-critic.test.js — ETB2B AI's Critic (lib/picture-critic.js, plan of 16 Nov 2026 W2) and the
   runner's paths it decides (lib/chat-picture.js make): the look with Sonnet vision and its fall back to today's check,
   the decide table row by row, the border trimmer on the real #53 picture of ET DAVOS 2027 (its white mat drawn in,
   63/48/58/80 px; fixtures/picture-critic/davos-53-white-mat.jpg, the public picture saved as a JPEG), the focus cut,
   the frame previews, the variants' rank, and the runner with stubbed models: a trim costs no call, a repair reserves
   one try (not one of the day's pictures) and is looked at again, at most one remake, a held picture stays off the
   page with the Critic's reason, a late repair is skipped, a repair that changes the scene is dropped. No network and
   no paid AI: the models, Storage and Firestore are stood in for. */
'use strict';
var fs = require('fs');
var path = require('path');
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + detail : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function J(v) { return JSON.stringify(v); }

var sharp = require('sharp');
var gemini = require('./gemini');
var pictures = require('./pictures');
var llm = require('./llm');
/* the models stood in for before chat-picture.js is loaded: each route answers from its own queue */
var imageCalls = [], imageAnswers = [], llmCalls = [], answers = { 'picture-critic': [], 'picture-check': [], 'picture-brief': [] };
var CLEAN_CHECK = { parsed: { people: false, text: false, logos: false }, usage: { provider: 'claude', model: 'claude-haiku-5-5', inputTokens: 1500, outputTokens: 20, usd: 0.0002 } };
gemini.callGeminiImage = function (prompt, opts) { imageCalls.push({ prompt: prompt, opts: opts }); return Promise.resolve(imageAnswers.length ? imageAnswers.shift() : made(NOISE)); };
pictures.storeVariants = function () { return Promise.resolve(null); };
llm.callJson = function (prompt, schema, opts) {
  llmCalls.push({ prompt: prompt, schema: schema, opts: opts });
  var q = answers[opts.route] || [];
  var a = q.length ? q.shift() : opts.route === 'picture-critic' ? crit() : opts.route === 'picture-check' ? CLEAN_CHECK : { code: 'ai-unavailable', error: 'x', status: 502 };
  if (a.usage && typeof opts.onUsage === 'function') opts.onUsage(a.usage);
  return Promise.resolve(a);
};
function made(bytes) { return { mimeType: 'image/png', base64: bytes.toString('base64'), provider: 'gemini', model: 'gemini-2.5-flash-image', usage: { provider: 'gemini', model: 'gemini-2.5-flash-image', inputTokens: 300, outputTokens: 1290, pictures: 1, usd: null } }; }
function none() { return { found: false, what: '', boxes: [] }; }
/* a Critic's answer: all clear unless told */
function crit(o) {
  return { parsed: Object.assign({ people: none(), text: none(), logos: none(), artefacts: none(), border: { found: false, kind: 'none', top: 0, right: 0, bottom: 0, left: 0 },
    placeMatch: 'n/a', placeWhy: '', likeness: false, indianWomen: 'n/a', faceChanged: 'n/a', sameScene: 'n/a', brief: 4, missing: [], tone: 4,
    focus: { x: 0.1, y: 0.3, w: 0.2, h: 0.4 }, survivesCrop: true, repair: '', why: '' }, o || {}), usage: { provider: 'claude', model: 'claude-sonnet-5-5', inputTokens: 4000, outputTokens: 600, usd: 0.014 } };
}
function people(what) { return { found: true, what: what || 'two small figures at lower left', boxes: [{ x: 0.05, y: 0.7, w: 0.1, h: 0.2 }] }; }

var cp = require('./chat-picture');
var critic = require('./picture-critic');
var shape = require('./picture-shape');
var switches = require('./picture-switches');

/* ---------- pictures to test with ---------- */
function raw(w, h, fn) {
  var buf = Buffer.alloc(w * h * 3);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var c = fn(x, y), i = (y * w + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
/* a busy scene: no flat edge anywhere */
function scene(x, y) { var v = (x * 37 + y * 91 + ((x * y) % 61)) % 200 + 20; return [v, (v * 3) % 220 + 10, (v * 7) % 230 + 10]; }
/* the eval's own measure (picture-ai/eval checks.js no-blank-bands): a flat white or black strip of 2% or more on an edge */
function bands(bytes) {
  return sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true }).then(function (g) {
    var W = g.info.width, H = g.info.height, C = g.info.channels, d = g.data;
    function flat(i) { var w = d[i] >= 232 && d[i + 1] >= 232 && d[i + 2] >= 232, b = d[i] <= 24 && d[i + 1] <= 24 && d[i + 2] <= 24; return w || b; }
    function row(y) { var n = 0; for (var x = 0; x < W; x++) if (flat((y * W + x) * C)) n++; return n / W; }
    function col(x) { var n = 0; for (var y = 0; y < H; y++) if (flat((y * W + x) * C)) n++; return n / H; }
    function run(f, len) { var k = 0; while (k < len && f(k) >= 0.96) k++; return k; }
    return { w: W, h: H, top: run(row, H) / H, bottom: run(function (k) { return row(H - 1 - k); }, H) / H, left: run(col, W) / W, right: run(function (k) { return col(W - 1 - k); }, W) / W };
  });
}
function worst(b) { return Math.max(b.top, b.bottom, b.left, b.right); }

var EV = 'qa-critic', NOW = Date.UTC(2026, 10, 16, 6, 0, 0);
var EVENT = { name: 'QA Critic Summit', description: 'Leaders on the future of work', city: 'Davos', designPlan: { owner: { level: '' }, design: { mode: 'light', themeColor: '#c8102e', imageStyle: 'Alpine editorial photography' } } };
var ON = switches.normalise({ critic: true, repair: true });
function job(extra) {
  return Object.assign({ n: 1, sectionId: 'overview', sectionName: 'Overview', contextName: 'this', placement: 'picture', slot: 1, apply: 'swap', kind: 'place', alt: 'a quiet street',
    subject: 'A snowy chalet street at blue hour, every window warm', plainSubject: 'A snowy chalet street at blue hour', heroMode: '', ownerSubject: true, wide: false,
    aspect: '4:3', closeUp: false, rest: [], restNames: [], frame: '800:600', design: { themeColor: '#c8102e', mode: 'light' }, state: 'asked' }, extra || {});
}

/* an in-memory Firestore with transactions (every read before any write, as Firestore requires) */
function fakeFb() {
  var docs = {}, saved = {}, ver = {};
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data) { docs[p] = clone(data); ver[p] = (ver[p] || 0) + 1; return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); ver[p] = (ver[p] || 0) + 1; return Promise.resolve(); } };
  }
  function colRef(p) { return { path: p, doc: function (id) { return docRef(p + '/' + id); } }; }
  var fb = { docs: docs, saved: saved, txOrderBroken: false,
    db: { collection: function (n) { return colRef(n); },
      runTransaction: function (fn) {
        var writes = [];
        var tx = { get: function (ref) { if (writes.length) fb.txOrderBroken = true; return Promise.resolve(snap(ref.path)); },
          set: function (ref, data) { writes.push(function () { docs[ref.path] = clone(data); }); return tx; },
          update: function (ref, data) { writes.push(function () { if (!docs[ref.path]) throw new Error('NOT_FOUND'); Object.keys(data).forEach(function (k) { docs[ref.path][k] = clone(data[k]); }); }); return tx; } };
        return Promise.resolve(fn(tx)).then(function (v) { writes.forEach(function (w) { w(); }); return v; });
      } },
    bucket: { name: 'test-bucket', file: function (p) { return { save: function (buf) { saved[p] = buf; return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } }; } } };
  return fb;
}
var QPATH = 'aiQuota/u-asha', TODAY = cp.istDay(Date.now());

(async function () {
  var NOISE = await raw(1184, 888, scene);
  global.NOISE = NOISE;
  var logged = [], realErr = console.error;
  console.error = function (l) { logged.push(String(l)); };

  /* ======================= the border trimmer ======================= */
  var MAT = fs.readFileSync(path.join(__dirname, 'fixtures', 'picture-critic', 'davos-53-white-mat.jpg'));
  var b0 = await bands(MAT);
  check(b0.w === 1536 && b0.h === 672 && b0.top > 0.08 && b0.bottom > 0.1 && b0.left > 0.04 && b0.right > 0.03, 'the #53 picture as it was made: a white mat on its four sides', J(b0));
  var t53 = await critic.trimBorders(MAT);
  var b1 = t53 && await bands(t53.bytes);
  check(t53 && b1 && worst(b1) < 0.02 && Math.abs(t53.trimmed.top - 60) <= 4 && Math.abs(t53.trimmed.bottom - 82) <= 4 && Math.abs(t53.trimmed.left - 65) <= 4 && Math.abs(t53.trimmed.right - 50) <= 4,
    'golden: the #53 picture is trimmed to no band of 2% or more (its 58/80 px top and bottom and 63/48 px sides, and the soft line where the mat meets the picture)', J(t53 && t53.trimmed) + ' ' + J(b1));
  check(t53 && (await critic.trimBorders(t53.bytes, { force: true })) === null, '… and a picture already trimmed has nothing more to cut');
  var matPng = await raw(1200, 800, function (x, y) { return x < 60 || x >= 1140 || y < 40 || y >= 760 ? [255, 255, 255] : scene(x, y); });
  var tp = await critic.trimBorders(matPng);
  check(tp && tp.width === 1200 - 124 && tp.height === 800 - 84 && J(tp.trimmed) === J({ top: 42, right: 62, bottom: 42, left: 62 }) && shape.focusOf({ x: 0.5, y: 0.5 }),
    'a flat white mat on a PNG: cut exactly, with the 2 px seam', J(tp && tp.trimmed));
  var letterbox = await raw(1200, 800, function (x, y) { return y < 60 || y >= 740 ? [8, 8, 8] : scene(x, y); });
  var tl = await critic.trimBorders(letterbox);
  check(tl && tl.trimmed.top === 62 && tl.trimmed.bottom === 62 && tl.trimmed.left === 0 && tl.trimmed.right === 0, 'a black letterbox (top and bottom): cut', J(tl && tl.trimmed));
  var sky = await raw(1200, 800, function (x, y) { return y < 100 ? [250, 250, 250] : scene(x, y); });
  check((await critic.trimBorders(sky)) === null, 'a white band along one edge only (a white sky) is never taken for a mat');
  var forced = await critic.trimBorders(sky, { force: true });
  check(forced && forced.trimmed.top === 102 && forced.height === 698, '… unless the Critic saw a border there', J(forced && forced.trimmed));
  var snow = await raw(1200, 800, function (x, y) { var v = Math.max(0, 255 - Math.round(y / 3)) - ((x * 13 + y * 7) % 11); return [v, v, Math.min(255, v + 3)]; });
  check((await critic.trimBorders(snow)) === null && (await critic.trimBorders(snow, { force: true })) === null, 'a snowy scene that fades to white is not a border, even when forced');
  check((await critic.trimBorders(Buffer.from('not a picture'))) === null && (await critic.trimBorders(null)) === null, 'bytes that are not a picture: nothing trimmed, never an error');
  var deep = await raw(1000, 800, function (x, y) { return y < 300 || y >= 700 ? [255, 255, 255] : scene(x, y); });
  check((await critic.trimBorders(deep)) === null || (await critic.trimBorders(deep)).height >= 400, 'a band deeper than the picture itself is never cut down to a sliver');

  /* ======================= the focus cut ======================= */
  var wide = await raw(1600, 800, scene);
  var c0 = await shape.crop(wide, 1, {});
  var c1 = await shape.crop(wide, 1, { focus: { x: 0.1, y: 0.5 } });
  var c2 = await shape.crop(wide, 1, { focus: { x: 0.95, y: 0.5 } });
  check(c0.left === 400 && c1.left === 0 && c2.left === 800 && c1.width === 800 && c1.height === 800, 'crop: centred by default; around the focus, held inside the picture', J([c0.left, c1.left, c2.left]));
  var c3 = await shape.crop(wide, 1, { focus: { x: 0.3, y: 0.5 } });
  check(c3.left === 80 && J(shape.focusIn({ x: 0.3, y: 0.5 }, c3)) === J({ x: 0.5, y: 0.5 }) && J(shape.focusIn({ x: 0.1, y: 0.5 }, c1)) === J({ x: 0.2, y: 0.5 }) && shape.focusIn({ x: 2 }, c1) === null,
    'the focus as it falls in the cut picture: object-position\'s percentages', J(shape.focusIn({ x: 0.3, y: 0.5 }, c3)));

  /* ======================= frame previews ======================= */
  var pv = await critic.framePreviews({ bytes: wide, type: 'image/png' }, { placement: 'hero', frame: '1440:600' });
  var pvDims = await Promise.all(pv.map(function (p) { return sharp(Buffer.from(p.data, 'base64')).metadata(); }));
  check(pv.length === 2 && pv[0].label === 'desktop' && pv[1].label === 'phone' && pv.every(function (p) { return p.mimeType === 'image/jpeg'; }) &&
    Math.abs(pvDims[0].width / pvDims[0].height - 2.4) < 0.02 && Math.abs(pvDims[1].width / pvDims[1].height - critic.PHONE_RATIO.hero) < 0.02 && Math.max(pvDims[0].width, pvDims[1].height) <= 512,
    'the banner is shown to the Critic cut to its desktop frame and to a phone\'s tall frame, small', J(pvDims.map(function (d) { return d.width + 'x' + d.height; })));
  var pv2 = await critic.framePreviews({ bytes: wide, type: 'image/png' }, { placement: 'picture', frame: '644:745' });
  check(pv2.length === 1 && pv2[0].label === 'desktop' && J(await critic.framePreviews({}, {})) === '[]', 'a section\'s picture keeps its frame on a phone: one preview; nothing to cut, none');

  /* ======================= review: today's check while the switch is off ======================= */
  var PIC = { bytes: NOISE, type: 'image/png', width: 1184, height: 888 };
  llmCalls.length = 0;
  answers['picture-check'].push({ parsed: { people: true, text: false, logos: false } });
  var r0 = await critic.review(PIC, job(), { rule: 'none', eventId: EV });
  check(r0.source === 'check' && J(r0.flags) === J(['people']) && llmCalls.length === 1 && llmCalls[0].opts.route === 'picture-check', '`critic` off: today\'s Haiku check, as before', J(r0));

  /* ======================= review: the Critic ======================= */
  llmCalls.length = 0;
  answers['picture-critic'].push(crit({ people: people(), why: 'Two people walk down the street, and this place takes nobody.', repair: 'Remove the two small figures at lower left.' }));
  var styleRef = { mimeType: 'image/jpeg', data: 'AAAA', use: 'style', kind: 'site' };
  var before = { bytes: NOISE, type: 'image/png' };
  var r1 = await critic.review(Object.assign({}, PIC, { original: { bytes: wide, type: 'image/png' } }), job({ placement: 'hero', frame: '1440:600', brief: { scene: 'a deserted promenade before dawn' } }),
    { rule: 'none', eventId: EV, switches: ON, refs: [styleRef], before: before, place: 'Davos: a broad high valley' });
  var call = llmCalls[0] || { opts: {} };
  check(call.opts.route === 'picture-critic' && call.schema === critic.CRITIC_SCHEMA && call.opts.images.length === 5 && call.opts.images.every(function (i) { return i.mimeType && i.data; }),
    'the Critic (route picture-critic: Sonnet) is shown the uncut picture, its desktop and phone cuts, the picture before and one of the site\'s own', J(call.opts.images && call.opts.images.map(function (i) { return i.mimeType; })));
  check(/NOBODY may be in it/.test(call.prompt) && /Picture 2 is it cut to the frame it fills on a computer\. Picture 3 is it cut to the taller frame a phone shows\. Picture 4 is the picture before this change\. Picture 5 is one of the site's own pictures/.test(call.prompt) &&
    /The brief it was made from: a deserted promenade before dawn/.test(call.prompt) && /The place it names: Davos/.test(call.prompt) && /never the abbreviation ET on its own/.test(call.prompt),
    'its prompt: the people rule of the place, each picture named, the brief, the place, plain words for the owner', call.prompt.slice(0, 400));
  check(r1.source === 'critic' && J(r1.flags) === J(['people']) && r1.verdict === 'repair' && r1.found.people === true && r1.found.text === false && r1.repair === 'Remove the two small figures at lower left.' &&
    J(r1.focus) === J({ x: 0.2, y: 0.5 }) && r1.boxes.people.length === 1 && r1.what.people === 'two small figures at lower left',
    'its answer: what the place does not take as flags, the three answers today\'s check keeps, a repair, the focus point', J(r1));
  var json = require('./claude').toJsonSchema(critic.CRITIC_SCHEMA);
  check(json.additionalProperties === false && json.required.length === Object.keys(json.properties).length && json.properties.people.required.join() === 'found,what,boxes' &&
    json.properties.border.required.length === 6 && json.properties.brief.type === 'integer', 'every field of the Critic\'s answer is required (strict mode, nothing optional)', J(json.required));

  async function rev(o, rule, jb) { answers['picture-critic'].push(crit(o)); return critic.review(PIC, jb || job(), { rule: rule || 'none', eventId: EV, switches: ON }); }
  check(J((await rev({ people: people() }, 'allowed')).flags) === '[]', 'people in a people section are no flag');
  check(J((await rev({ people: people(), indianWomen: 'missing' }, 'allowed')).flags) === J(['women']), 'people who are not Indian, or no women among them, where people may be: flagged');
  check(J((await rev({ people: people(), likeness: true }, 'allowed')).flags) === J(['likeness']), 'a famous likeness: flagged');
  var rb = await rev({ border: { found: true, kind: 'mat', top: 0.09, right: 0.03, bottom: 0.12, left: 0.04 } });
  check(J(rb.flags) === J(['border']) && rb.verdict === 'trim' && rb.border.kind === 'mat' && rb.border.bottom === 0.12, 'a mat drawn inside: border, to trim', J(rb));
  check(J((await rev({ placeMatch: 'wrong-landmark', placeWhy: 'shows the Matterhorn' })).flags) === J(['place']), 'the wrong landmark: flagged');
  var rbr = await rev({ brief: 2, missing: ['the Promenade lights'], survivesCrop: false });
  check(J(rbr.flags) === J(['brief', 'crop']) && rbr.verdict === 'remake' && J(rbr.missing) === J(['the Promenade lights']), 'the brief missed (2 of 5) and the subject lost in the cut: a remake', J(rbr));
  check(J((await rev({ sameScene: 'no', faceChanged: 'yes' })).flags) === J(['face', 'scene']), 'an edit that changed the scene or a face: flagged');
  check(J((await rev({ text: { found: true, what: 'a sign', boxes: [] }, logos: { found: true, what: 'a crest', boxes: [] }, artefacts: { found: true, what: 'a melted lamp', boxes: [] } })).flags) === J(['text', 'logos', 'artefacts']), 'words, logos and artefacts: flagged in a fixed order');
  check((await rev({ why: 'The ET logo is drawn in the corner.' })).why === 'The ETB2B logo is drawn in the corner.', 'the owner never reads a bare "ET"');
  /* the Critic could not answer: today's check looks instead */
  llmCalls.length = 0;
  answers['picture-critic'].push({ code: 'ai-timeout', error: 'x', status: 504 });
  answers['picture-check'].push({ parsed: { people: false, text: true, logos: false } });
  var rf = await critic.review(PIC, job(), { rule: 'none', eventId: EV, switches: ON });
  check(rf.source === 'check' && J(rf.flags) === J(['text']) && llmCalls.map(function (c) { return c.opts.route; }).join() === 'picture-critic,picture-check', 'the Critic failed: today\'s check looks, and its answer stands', J(rf));
  answers['picture-critic'].push({ parsed: { people: 'maybe' } });
  check((await critic.review(PIC, job(), { rule: 'none', eventId: EV, switches: ON })).source === 'check', 'an answer without the three answers: today\'s check looks');
  /* Create Event (CREATE-FROM-DECK F7) uses the same look, as caller 'create' */
  llmCalls.length = 0;
  answers['picture-critic'].push(crit({ people: people() }));
  var rc = await critic.review(PIC, { placement: 'picture', kind: 'place', subject: 'a lake at dawn', frame: '16:9' }, { rule: 'none', eventId: EV, switches: ON, caller: 'create' });
  await critic.review(PIC, job(), { rule: 'none', eventId: EV, switches: switches.normalise({ critic: true, exclude: ['create'] }), caller: 'create' });
  check(rc.source === 'critic' && J(rc.flags) === J(['people']) && llmCalls[0].opts.route === 'picture-critic' && llmCalls[1].opts.route === 'picture-check',
    'Create Event\'s pictures (caller create) get the Critic too, and today\'s check when create is left out', J(llmCalls.map(function (c) { return c.opts.route; })));

  /* ======================= decide: the table, row by row ======================= */
  var T = { calls: 1, made: 1, maxTries: 3, timeLeftMs: 200000, retryNeedsMs: 50000, switches: ON };
  function D(r, t) { return critic.decide(Object.assign({ source: 'critic', flags: [] }, r), Object.assign({}, T, t || {})); }
  check(D({}).action === 'keep', 'nothing found: keep');
  var dt = D({ flags: ['border'], border: { kind: 'mat', top: 0.1 } });
  check(dt.action === 'trim' && dt.edges.top === 0.1, 'a border: trim (sharp, no AI)', J(dt));
  check(D({ flags: ['border', 'people'], repair: 'remove the figure' }).action === 'trim', 'a border with more: trimmed first');
  var dbr = D({ flags: ['border'] }, { trimmed: true });
  check(dbr.action === 'repair' && /Remove the plain border, mat or frame around the picture and continue the scene out to every edge; change nothing else\./.test(dbr.change), 'a border the trim could not cut: one repair, to fill the edges', J(dbr));
  var dr = D({ flags: ['people'], repair: 'Remove the two small figures at lower left.' });
  check(dr.action === 'repair' && dr.change === 'Remove the two small figures at lower left; change nothing else.', 'people, words, logos, artefacts or the wrong landmark with a repair: one repair, changing nothing else', J(dr));
  check(D({ flags: ['place'], repair: 'replace the pyramid peak with rounded wooded ridges; change nothing else' }).change === 'replace the pyramid peak with rounded wooded ridges; change nothing else', '… said once');
  var dnr = D({ flags: ['people'], repair: 'remove them', what: { people: 'two figures' } }, { switches: switches.normalise({ critic: true }) });
  check(dnr.action === 'remake' && /SECOND TRY, STRICT[^]*LAST TRY, STRICTEST: change the view so that no one can be in it/.test(dnr.line), 'the `repair` switch off: one remake, with today\'s strictest words', J(dnr));
  check(D({ flags: ['people'], repair: 'remove them' }, { repairs: 1 }).action === 'remake', 'a repair already made: a remake');
  check(D({ flags: ['people'], repair: '' }).action === 'remake', 'no repair the Critic could say: a remake');
  var dm = D({ flags: ['brief', 'crop'], missing: ['the Promenade lights', 'the lake'] });
  check(dm.action === 'remake' && /ANOTHER TRY: this one must have what the first left out: the Promenade lights and the lake; the main subject whole and near the middle/.test(dm.line), 'the brief missed, the subject lost in the cut: a remake with what was missing', dm.line);
  check(D({ flags: ['women'] }).line.indexOf('made-up Indian people, with women among them') !== -1 && D({ flags: ['people', 'women'], repair: 'x' }).action === 'remake', 'no Indian women where people are: a remake, never a repair');
  var dh = D({ flags: ['brief'] }, { remakes: 1 });
  check(dh.action === 'hold' && dh.why === 'tries', 'still wanting after the one remake: held', J(dh));
  check(D({ flags: ['people'], repair: 'x' }, { calls: 3 }).why === 'tries', 'three paid calls made: held');
  var late = D({ flags: ['people'], repair: 'x' }, { timeLeftMs: critic.REPAIR_NEEDS_MS - 1 });
  check(late.action === 'remake' && D({ flags: ['people'], repair: 'x' }, { timeLeftMs: 49999 }).why === 'time', 'too late for a repair: a remake if there is time for one, else held (time)', J(late));
  /* today's table, whenever the switch is off or today's check looked */
  var today = critic.decide({ source: 'check', flags: ['people'] }, Object.assign({}, T));
  var off = critic.decide({ source: 'critic', flags: ['people'], repair: 'x' }, Object.assign({}, T, { switches: switches.OFF }));
  check(today.action === 'remake' && today.line === cp.againLine(['people']) && off.action === 'remake' && off.line === cp.againLine(['people']) &&
    critic.decide({ source: 'check', flags: ['text'] }, Object.assign({}, T, { calls: 2 })).line === cp.againLine(['text']) + ' ' + cp.strictLine(['text']),
    'today\'s check, or the switch off: today\'s table (a stronger remake, then the strictest)', J([today, off]));

  /* ======================= rank (Show 3 options) ======================= */
  check(J(critic.rank([{ flags: ['people'], scores: { brief: 5, tone: 5 } }, { flags: [], scores: { brief: 3, tone: 3 } }, { flags: [], scores: { brief: 5, tone: 4 } }])) === J([2, 1, 0]) && J(critic.rank([])) === '[]',
    'the best first: nothing wrong before anything found, then the brief and the tone');

  /* ======================= the runner, with the Critic on ======================= */
  var FB = fakeFb(), seq = 0, recorded = [], checked = [];
  function turnOf(np, extra) {
    var id = 'CritTurn' + String(++seq).padStart(6, '0') + 'ab';
    FB.docs['events/' + EV + '/aiChats/u-asha/turns/' + id] = Object.assign({ question: 'Replace the Overview picture with a snowy chalet street at blue hour', kind: 'edit', status: 'applying', newPicture: clone(np) }, extra || {});
    return FB.db.collection('events').doc(EV).collection('aiChats').doc('u-asha').collection('turns').doc(id);
  }
  function stored(ref) { return clone(FB.docs[ref.path]).newPicture; }
  function run(ref, o) {
    return cp.make({ record: function (u) { recorded.push(u); }, recordCheck: function (u) { checked.push(u); } },
      Object.assign({ fb: FB, eventId: EV, uid: 'u-asha', turnRef: ref, eventData: EVENT, decoded: { email: 'asha@timesinternet.in' }, now: NOW, switches: ON }, o || {}));
  }
  function quota(q) { FB.docs[QPATH] = Object.assign({ day: TODAY, made: 0, failed: 0 }, q || {}); }
  function q() { var d = FB.docs[QPATH] || {}; return { made: d.made, failed: d.failed }; }

  /* 1. a clean picture: one paid call, kept, cut around the focus, its uncut picture kept, its line and stages */
  quota();
  var ref = turnOf(job()), i0 = imageCalls.length;
  answers['picture-critic'].push(crit({ focus: { x: 0.0, y: 0.25, w: 0.2, h: 0.5 } }));
  imageAnswers.push(made(await raw(1184, 864, scene)));
  var out = await run(ref), np = stored(ref);
  var keptBytes = FB.saved[np.storagePath], keptMeta = await sharp(keptBytes).metadata();
  check(out.status === 200 && !out.body.held && imageCalls.length === i0 + 1 && J(q()) === J({ made: 1, failed: 0 }), 'a clean picture: one paid call, one of the day\'s pictures', J(out.body) + ' ' + J(q()));
  check(keptMeta.width === 1152 && keptMeta.height === 864 && np.original && FB.saved[np.original.replace('https://storage.googleapis.com/test-bucket/', '')] && /-orig\.png$/.test(np.original),
    'stored cut to the frame (4:3), and its uncut picture kept beside it for a later re-fit', np.original + ' ' + keptMeta.width + 'x' + keptMeta.height);
  check(np.focus && np.focus.x === 0.103 && np.focus.y === 0.5 && J(out.body.focus) === J(np.focus), 'cut around the Critic\'s focus (held inside the picture), and the point is answered for the page\'s object-position', J(np.focus));
  check(np.stage === 'store' && np.line === 'I checked it before putting it in: no one close up, and no words or logos.' && out.body.line === np.line && np.review && np.review.source === 'critic' && np.review.verdict === 'ok' && J(np.repairs) === '[]',
    'its stage, its one true line, the Critic\'s review kept (no boxes, no pictures)', J({ stage: np.stage, line: np.line, review: np.review }));
  check(recorded.length >= 1 && recorded[recorded.length - 1].usd === 0.039 && checked.some(function (u) { return u.model === 'claude-sonnet-5-5'; }), 'the picture\'s price on its usage row; the Critic\'s usage recorded too', J(recorded[recorded.length - 1]));

  /* 2. a white mat the model drew: trimmed with sharp before anyone looks, no call for it */
  quota();
  ref = turnOf(job({ frame: '1200:800', aspect: '3:2' })); i0 = imageCalls.length;
  imageAnswers.push(made(matPng));
  out = await run(ref); np = stored(ref);
  var nb = await bands(FB.saved[np.storagePath]);
  check(out.status === 200 && !out.body.held && imageCalls.length === i0 + 1 && worst(nb) < 0.02 && /plain border drawn around it; I trimmed it off/.test(np.line) && J(q()) === J({ made: 1, failed: 0 }),
    'a mat drawn into the picture: trimmed, no band left, no second call, and the line says so', np.line + ' ' + J(nb));

  /* 3. a border the Critic sees on one edge only: trimmed on its word, no call (trim-only costs no call) */
  quota();
  ref = turnOf(job({ frame: '1200:800', aspect: '3:2' })); i0 = imageCalls.length;
  imageAnswers.push(made(sky));
  answers['picture-critic'].push(crit({ border: { found: true, kind: 'mat', top: 0.12, right: 0, bottom: 0, left: 0 } }));
  var critAt = llmCalls.length;
  out = await run(ref); np = stored(ref);
  check(out.status === 200 && !out.body.held && imageCalls.length === i0 + 1 && llmCalls.length === critAt + 1 && /I trimmed it off/.test(np.line) && J(q()) === J({ made: 1, failed: 0 }),
    'trim only: no picture call and no second look', np.line);

  /* 4. a repair: one try reserved (not one of the day's pictures), the picture itself edited, looked at again beside it */
  quota({ made: 5 });
  ref = turnOf(job()); i0 = imageCalls.length; critAt = llmCalls.length;
  answers['picture-critic'].push(crit({ people: people(), repair: 'Remove the two small figures at lower left.', why: 'Two people walk down the street, and this place takes nobody.' }), crit({ sameScene: 'yes' }));
  out = await run(ref); np = stored(ref);
  var rep = imageCalls[i0 + 1] || { opts: {} }, look2 = llmCalls[critAt + 1] || { opts: { images: [] } };
  check(out.status === 200 && !out.body.held && imageCalls.length === i0 + 2 && J(q()) === J({ made: 6, failed: 1 }), 'a repair: one more paid call, counted as a try, not as one of the day\'s pictures (owner, 16 Nov 2026)', J(q()));
  check(rep.opts.image && rep.opts.image.mimeType === 'image/png' && rep.opts.image.data.length > 1000 && rep.prompt.indexOf('Edit this picture. Remove the two small figures at lower left; change nothing else. Keep everything else exactly as it is') === 0 && /STRICT: /.test(rep.prompt) && rep.opts.images === undefined,
    'the repair edits that picture (it is given to the model), changing nothing else, the rules last', rep.prompt.slice(0, 200));
  check(look2.opts.route === 'picture-critic' && /Picture \d is the picture before this change/.test(look2.prompt), 'the repaired picture is looked at again, beside the picture before');
  check(np.line === 'The first try had two small figures at lower left in it; I fixed it.' && np.repairs.length === 1 && /Remove the two small figures/.test(np.repairs[0].what) && np.tries === 2,
    'the line names the fix; the repair is kept on the job', J({ line: np.line, repairs: np.repairs }));

  /* 5. a repair that changed the scene is dropped; one remake follows; at most one remake, then held with the Critic's reason */
  quota();
  ref = turnOf(job()); i0 = imageCalls.length;
  answers['picture-critic'].push(crit({ people: people(), repair: 'Remove the figures.', why: 'Two people walk down the street, and this place takes nobody.' }),
    crit({ sameScene: 'no' }), crit({ people: people(), why: 'Two people walk down the street, and this place takes nobody.' }));
  out = await run(ref); np = stored(ref);
  check(out.status === 200 && out.body.held === true && imageCalls.length === i0 + 3 && J(q()) === J({ made: 1, failed: 2 }),
    'a repair that changed the scene is not used; the one remake still has people: held, three paid calls in all', J(out.body) + ' ' + J(q()));
  check(out.body.heldWhy === 'Two people walk down the street, and this place takes nobody, so I did not put it on the page. ' + cp.alternativeLine(['people'], 'tries') &&
    /did not put it on the page/.test(np.line) && np.held === true && np.alternative === 'close-up',
    'held, in the Critic\'s own words, with the close-up offered', out.body.heldWhy);
  check(/SECOND TRY, STRICT[^]*LAST TRY, STRICTEST/.test(imageCalls[i0 + 2].prompt) && !imageCalls[i0 + 2].opts.image, 'the remake is a new picture with the strictest words');
  var again = await run(ref);
  check(J(again) === J(out) && imageCalls.length === i0 + 3, 'asked again: the same held answer, nothing made again');

  /* 6. a held picture carries what "Fix it" asks for */
  quota();
  ref = turnOf(job()); i0 = imageCalls.length;
  answers['picture-critic'].push(crit({ brief: 1, missing: ['the chalets'], repair: 'Add a row of snowy chalets along the street; change nothing else.', why: 'It shows an empty field, not a chalet street.' }),
    crit({ brief: 2, missing: ['the chalets'], repair: 'Add a row of snowy chalets along the street; change nothing else.', why: 'It still shows no chalets.' }));
  out = await run(ref); np = stored(ref);
  check(out.body.held === true && imageCalls.length === i0 + 2 && out.body.fix === 'Add a row of snowy chalets along the street; change nothing else.' && np.fix === out.body.fix &&
    /ANOTHER TRY: this one must have what the first left out: the chalets/.test(imageCalls[i0 + 1].prompt), 'the brief missed twice: one remake with what was missing, then held, with the Critic\'s fix kept for "Fix it"', J(out.body));

  /* 7. a late repair is skipped: with less than a repair's time left, a remake if there is time for one; else held */
  var realNow = Date.now, shift = 0, stub = gemini.callGeminiImage, step = 0;
  Date.now = function () { return realNow() + shift; };
  gemini.callGeminiImage = function (p, o) { if (!shift) shift = step; return stub(p, o); };
  quota();
  step = cp.ADVANCED_DEADLINE_MS - critic.REPAIR_NEEDS_MS + 1000;
  ref = turnOf(job()); i0 = imageCalls.length;
  answers['picture-critic'].push(crit({ people: people(), repair: 'Remove the figures.', why: 'A person stands in the doorway.' }));
  out = await run(ref);
  check(!out.body.held && imageCalls.length === i0 + 2 && !imageCalls[i0 + 1].opts.image && /SECOND TRY/.test(imageCalls[i0 + 1].prompt) &&
    stored(ref).line === 'The first try was not right (a person stands in the doorway), so I made it again.',
    'too late for a repair, in time for a remake: the remake is made, no repair', J(out.body));
  quota(); shift = 0;
  step = cp.ADVANCED_DEADLINE_MS - cp.RETRY_NEEDS_MS + 1000;
  ref = turnOf(job()); i0 = imageCalls.length;
  answers['picture-critic'].push(crit({ people: people(), repair: 'Remove the figures.', why: 'A person stands in the doorway.' }));
  out = await run(ref);
  Date.now = realNow; gemini.callGeminiImage = stub;
  check(out.body.held === true && imageCalls.length === i0 + 1 && /there was no time left for another try/.test(out.body.heldWhy) && J(q()) === J({ made: 1, failed: 0 }),
    'no time left for a repair or a remake: held, nothing more paid for', out.body.heldWhy);

  /* 8. the day's ceiling of tries reached: no repair, held */
  quota({ failed: 20 - 1, made: 0 });
  ref = turnOf(job()); i0 = imageCalls.length;
  answers['picture-critic'].push(crit({ people: people(), repair: 'Remove the figures.', why: 'A person stands in the doorway.' }), crit({ people: people(), why: 'A person still stands in the doorway.' }));
  out = await run(ref);
  check(out.body.held === true && imageCalls.length === i0 + 2 && /today's tries for pictures that did not pass their check are used up/.test(out.body.heldWhy) && J(q()) === J({ made: 1, failed: 20 }),
    'the repair takes the last try of the day; the remake after it is refused, and why is said', out.body.heldWhy + ' ' + J(q()));

  /* 9. the Critic could not look: today's check looks, today's table decides */
  quota();
  ref = turnOf(job()); i0 = imageCalls.length;
  answers['picture-critic'].push({ code: 'ai-unavailable', error: 'x', status: 502 });
  answers['picture-check'].push({ parsed: { people: false, text: false, logos: false } });
  out = await run(ref); np = stored(ref);
  check(out.status === 200 && !out.body.held && imageCalls.length === i0 + 1 && np.review.source === 'check' && J(np.checks) === J([{ people: false, text: false, logos: false }]),
    'the Critic failed: today\'s check looked, and the picture went on', J(np.review));

  /* 10. the switch off: today's runner exactly (no stage, no line, no uncut picture, today's deadline) */
  quota();
  ref = turnOf(job()); i0 = imageCalls.length;
  out = await run(ref, { switches: switches.OFF }); np = stored(ref);
  check(out.status === 200 && np.stage === undefined && np.line === undefined && np.original === undefined && np.review === undefined && out.body.line === undefined && out.body.focus === undefined &&
    imageCalls[i0].opts.deadlineAt <= Date.now() + cp.DEADLINE_MS && cp.DEADLINE_MS === 180000 && cp.ADVANCED_DEADLINE_MS === 240000,
    'every switch off: today\'s runner and today\'s 180 s, with nothing added to the job', J(Object.keys(np)));
  check(!FB.txOrderBroken, 'every transaction reads before it writes');

  console.error = realErr;
  if (failures.length) { console.error('picture-critic: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('picture-critic: all ' + checks + ' checks passed');
})().catch(function (e) { console.error('picture-critic: the test itself stopped — ' + (e && e.stack || e)); process.exit(1); });
