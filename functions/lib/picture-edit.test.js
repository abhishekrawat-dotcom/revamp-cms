/* node functions/lib/picture-edit.test.js — ETB2B AI changes the picture you point at (lib/picture-edit.js, builder C,
   plan of 16 Nov 2026 §6): the words of a change read as the right kind (the probes' phrasings), the exact edits done
   with sharp (golden checks on the pixels: warmer is redder and less blue, brighter is lighter, the shape and the
   format kept), the wider canvas's geometry, the picture model given the picture itself for every other change, the
   owner's own photos changed only in light, colour, crop and background (faces never), and the sources refused: another
   event's picture, a logo, Content's photos. No network and no paid AI: Storage and the picture model are stood in
   for; the pictures are drawn here with sharp. */
'use strict';
var failures = [], checks = 0;
function check(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }

var sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }
var gemini = require('./gemini');
var calls = [], answers = [];
gemini.callGeminiImage = function (prompt, opts) { calls.push({ prompt: prompt, opts: opts }); return Promise.resolve(answers.length ? answers.shift() : { error: 'x', code: 'ai-unavailable', status: 502 }); };
var edit = require('./picture-edit');

var BUCKET = 'test-bucket', EV = 'qa-paic-edit', OWN = 'https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/';
function scene(seed, w, h) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#' + (seed ? '203050' : '87a8d0') + '"/><stop offset="1" stop-color="#' + (seed ? 'e0c090' : 'f0e0c0') + '"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/>' +
    '<polygon points="0,600 300,250 600,600" fill="#556677"/><rect x="100" y="480" width="600" height="60" fill="#222"/></svg>';
  return sharp(Buffer.from(svg)).resize(w || 800, h || 600, { fit: 'fill' }).png().toBuffer();
}
function mean(stats, i) { return stats.channels[i].mean; }

(async function () {
  /* ======================= the kind of a change ======================= */
  check(edit.classify('tone') === 'sharp' && edit.classify('light') === 'sharp' && edit.classify('crop') === 'sharp' && edit.classify('focus') === 'sharp' &&
    ['remove', 'replace', 'extend', 'style', 'season', 'fill'].every(function (k) { return edit.classify(k) === 'model'; }) && edit.classify('') === '' && edit.classify('nonsense') === '',
    'classify: light and colour, crop and focus are exact (sharp); the rest goes to the picture model');
  /* the edit phrasings of the probes (probe2, probe4) and the owner's real asks */
  var PHRASES = [
    ['make it warmer', 'tone'], ['warmer tones please', 'tone'], ['make it cooler', 'tone'], ['black and white please', 'tone'], ['more vivid colours', 'tone'],
    ['make it brighter', 'light'], ['a little darker', 'light'], ['it is too bright', 'light'], ['more contrast', 'light'],
    ['crop it tighter', 'crop'], ['zoom in a bit', 'crop'], ['flip it', 'crop'],
    ['make it wider', 'extend'], ['make the picture wider so it fills the frame', 'extend'],
    ['remove the person from the picture', 'remove'], ['remove the people from it', 'remove'], ['less busy', 'remove'],
    ['fill the blank part of this image', 'fill'], ['make it a night scene', 'season'], ['show it in winter, with snow', 'season'],
    ['use the same style as the hero', 'style'], ['show the Davos valley through the window instead of the Matterhorn and make it a little brighter', 'replace']
  ];
  var wrong = PHRASES.filter(function (p) { return edit.kindOf(p[0]) !== p[1]; }).map(function (p) { return p[0] + ' → ' + edit.kindOf(p[0]) + ' (not ' + p[1] + ')'; });
  check(!wrong.length, 'kindOf: each of the ' + PHRASES.length + ' phrasings reads as its kind', wrong);
  check(JSON.stringify(edit.opsOf('make it warmer')) === '{"warmth":1}' && JSON.stringify(edit.opsOf('Make the last picture you made a little brighter; change nothing else.')) === '{"brightness":0.5}' &&
    JSON.stringify(edit.opsOf('much darker')) === '{"brightness":-1.6}' && edit.opsOf('too bright').brightness < 0 && edit.opsOf('too dark').brightness > 0 &&
    edit.opsOf('make it warmer and remove the sign') === null && edit.opsOf('warmer but cooler') === null && edit.opsOf('') === null,
    'opsOf: the exact edits and how much; anything more goes to the model', [edit.opsOf('too bright'), edit.opsOf('too dark')]);

  if (!sharp) { check(true, '(no picture library here: the picture checks are skipped)'); return done(); }

  /* ======================= exact edits (sharp), golden ======================= */
  var A = await scene(0), J = await sharp(A).jpeg({ quality: 90 }).toBuffer();
  var s0 = await sharp(A).stats();
  var warm = await edit.sharpOps(A, { change: 'make it warmer' }), sw = await sharp(warm.bytes).stats();
  check(warm.how === 'sharp' && warm.type === 'image/png' && warm.width === 800 && warm.height === 600 && mean(sw, 0) > mean(s0, 0) + 4 && mean(sw, 2) < mean(s0, 2) - 6,
    'warmer: redder and less blue, the same size and format', [mean(s0, 0), mean(sw, 0), mean(s0, 2), mean(sw, 2)]);
  check(warm.line === 'Warmer light — the same picture, nothing else changed.' && !/\bET\b/.test(warm.line), 'warmer: one true sentence', warm.line);
  var lum = function (st) { return 0.2126 * mean(st, 0) + 0.7152 * mean(st, 1) + 0.0722 * mean(st, 2); };
  var br = await edit.sharpOps(J, { change: 'make it brighter' }), sb = await sharp(br.bytes).stats();
  var dk = await edit.sharpOps(J, { change: 'a little darker' }), sd = await sharp(dk.bytes).stats(), sj = await sharp(J).stats();
  check(br.type === 'image/jpeg' && lum(sb) > lum(sj) + 5 && dk.type === 'image/jpeg' && lum(sd) < lum(sj) - 2 && lum(sd) > lum(sj) - 20, 'brighter is lighter, a little darker a little darker; a JPEG stays a JPEG',
    [lum(sj), lum(sb), lum(sd)]);
  var gr = await edit.sharpOps(A, { change: 'make it black and white' }), sg = await sharp(gr.bytes).stats();
  check(Math.abs(mean(sg, 0) - mean(sg, 2)) < 1 && Math.abs(mean(sg, 0) - mean(sg, 1)) < 1 && gr.line === 'Black and white — the same picture, nothing else changed.', 'black and white: no colour left', [mean(sg, 0), mean(sg, 1), mean(sg, 2)]);
  var ct = await edit.sharpOps(A, { change: 'more contrast' }), sc = await sharp(ct.bytes).stats();
  check(sc.channels[1].stdev > s0.channels[1].stdev + 3, 'more contrast: a wider spread of tones', [s0.channels[1].stdev, sc.channels[1].stdev]);
  var zm = await edit.sharpOps(A, { change: 'crop it tighter' });
  var refs = require('./picture-refs'), n = 0;
  var dz = refs.distance(await refs.dHash(A), await refs.dHash(zm.bytes));
  check(zm.width === 800 && zm.height === 600 && dz > 0 && zm.line === 'A closer crop — the same picture, nothing else changed.', 'a closer crop: the same size, a closer view', [zm.width, zm.height, dz]);
  var fl = await edit.sharpOps(A, { change: 'flip it' });
  var px0 = await sharp(A).extract({ left: 0, top: 590, width: 1, height: 1 }).raw().toBuffer(), px1 = await sharp(fl.bytes).extract({ left: 799, top: 590, width: 1, height: 1 }).raw().toBuffer();
  check(px0.equals(px1), 'mirror: the left edge is now the right');
  check((await edit.sharpOps(A, { change: 'remove the people' })) === null && (await edit.sharpOps(Buffer.from('not a picture'), { change: 'warmer' })) === null, 'not an exact edit, or not a picture: none');

  /* ======================= a wider (or taller) canvas ======================= */
  var ex = await edit.extendCanvas(A, 1152 / 340);
  check(ex && ex.width === 1400 && ex.height === 600 && ex.aspect === '21:9' && ex.box.left === 300 && ex.box.top === 0 && ex.box.width === 800 && ex.type === 'image/png',
    'wider: a 4:3 picture for a 3.4:1 strip goes on a 21:9 canvas (the widest the model makes), centred', ex && { w: ex.width, h: ex.height, a: ex.aspect, box: ex.box });
  var mid = await sharp(ex.bytes).extract({ left: 300, top: 0, width: 800, height: 600 }).png().toBuffer();
  check(refs.distance(await refs.dHash(A), await refs.dHash(mid)) === 0, 'wider: the middle is the picture itself');
  var ex2 = await edit.extendCanvas(A, 16 / 9);
  check(ex2 && ex2.aspect === '16:9' && ex2.width === 1067 && ex2.height === 600, 'wider: to 16:9, the model\'s own 16:9', ex2 && [ex2.width, ex2.height, ex2.aspect]);
  var ex3 = await edit.extendCanvas(A, 9 / 16);
  check(ex3 && ex3.aspect === '9:16' && ex3.width === 800 && ex3.height === 1422 && ex3.box.top === 411, 'taller: to 9:16, centred top to bottom', ex3 && [ex3.width, ex3.height, ex3.box]);
  check((await edit.extendCanvas(A, 4 / 3)) === null && (await edit.extendCanvas(A, 0)) === null && (await edit.extendCanvas(await scene(0, 1536, 672), 1152 / 340)) === null,
    'already that shape, or already as wide as the model makes them (21:9): nothing to extend');

  /* ======================= run ======================= */
  var files = {};
  files['events/' + EV + '/generated/1-hall.png'] = A;
  files['events/' + EV + '/generated/1-hall-original.png'] = await scene(0, 1184, 864);
  files['events/' + EV + '/media/owner.jpg'] = J;
  files['events/' + EV + '/chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p3.jpg'] = J;
  files['events/qa-other/generated/a.png'] = A;
  var downloads = [];
  var FB = { bucket: { name: BUCKET, file: function (p) { return { download: function () { downloads.push(p); return files[p] ? Promise.resolve([files[p]]) : Promise.reject(new Error('No such object')); } }; } } };
  var usage = [];
  var CTX = { fb: FB, eventId: EV, deadlineAt: Date.now() + 200000, record: function (u) { usage.push(u); } };
  function job(extra) { return Object.assign({ mode: 'edit', sectionId: 'kdp', editOf: { url: OWN + 'generated/1-hall.png' }, change: '', changeKind: '', frame: '', aspect: '4:3', peopleRule: 'none' }, extra || {}); }
  function madeAnswer(bytes) { return { mimeType: 'image/png', base64: bytes.toString('base64'), provider: 'gemini', model: 'gemini-2.5-flash-image', usage: { provider: 'gemini', pictures: 1 } }; }

  var r = await edit.run(job({ mode: 'new' }), CTX);
  check(r.code === 'not-supported' && calls.length === 0, 'a new picture is not an edit: the runner makes it as before');
  r = await edit.run(job({ editOf: null, change: 'make it warmer', changeKind: 'tone' }), CTX);
  check(r.code === 'not-supported', 'an edit with no picture to change: the runner makes a new one, as before');
  r = await edit.run(job({ change: 'make it warmer', changeKind: 'tone' }), CTX);
  check(r.how === 'sharp' && r.bytes && r.width === 800 && calls.length === 0 && /^Warmer light/.test(r.line), '"make it warmer": the same picture warmed with sharp, free, no picture call', { how: r.how, code: r.code, line: r.line });
  for (var bad of [[OWN.replace(EV, 'qa-other') + 'generated/a.png', 'another event\'s picture'], [OWN + 'generated/7-logo-unit.png', 'the logo unit'], [OWN + 'speakers/s1.jpg', 'a speaker\'s photo'],
    [OWN + 'gallery/2025-1.jpg', 'a past edition\'s gallery photo'], ['https://img.etb2bimg.com/files/a.jpg', 'another host']]) {
    var before = downloads.length;
    r = await edit.run(job({ editOf: { url: bad[0] }, change: 'make it warmer', changeKind: 'tone' }), CTX);
    check(r.code === 'edit-source' && r.status === 403 && /only change pictures stored with this event/.test(r.error) && downloads.length === before && calls.length === 0,
      'refused, nothing read, nothing paid: ' + bad[1], r);
  }

  /* the picture model, given the picture itself */
  var made = await scene(0);
  answers.push(madeAnswer(made));
  r = await edit.run(job({ change: 'remove the two people on the left; change nothing else', changeKind: 'remove' }), CTX);
  var c0 = calls[calls.length - 1];
  check(r.how === 'model' && r.type === 'image/png' && calls.length === 1 && c0.opts.image && c0.opts.image.mimeType === 'image/png' && c0.opts.image.data === A.toString('base64') &&
    c0.opts.aspectRatio === '4:3' && c0.opts.route === 'picture-edit' && c0.opts.eventId === EV && !c0.opts.images && usage.length === 1,
    '"remove the people": the picture model is given the picture itself, in its own shape; its use is recorded', { how: r.how, opts: c0 && Object.assign({}, c0.opts, { image: c0.opts.image && c0.opts.image.mimeType }) });
  check(/^Edit this photograph\. The change: remove the two people on the left; change nothing else\./.test(c0.prompt) && /Keep everything else exactly as it is/.test(c0.prompt) &&
    /fill its place with what would naturally be behind it/.test(c0.prompt) && /Add no people in any form/.test(c0.prompt) && /no border, frame, mat/.test(c0.prompt) &&
    /no words, letters, numbers, signs/.test(c0.prompt) && c0.prompt.lastIndexOf('STRICT') > c0.prompt.indexOf('Keep everything else'), 'the edit\'s words: the change, keep the rest, the site\'s rules last', c0.prompt);
  check(r.line === 'Changed on the same picture: remove the two people on the left; change nothing else.', 'the line says it is the same picture, changed', r.line);
  answers.push(madeAnswer(made));
  r = await edit.run(job({ change: 'replace the empty chairs with two delegates in discussion', changeKind: 'replace', peopleRule: 'allowed' }), CTX);
  check(/Any person added is Indian, and the people include women/.test(calls[calls.length - 1].prompt) && !/Add no people/.test(calls[calls.length - 1].prompt), 'where people are allowed: Indian, women among them, nobody real');

  /* wider: the canvas, then the model fills its margins */
  answers.push(madeAnswer(await scene(0, 1536, 672)));
  r = await edit.run(job({ change: 'make the picture wider so it fills the frame', changeKind: 'extend', frame: '1152:340' }), CTX);
  var c2 = calls[calls.length - 1];
  var inMeta = await sharp(Buffer.from(c2.opts.image.data, 'base64')).metadata();
  check(r.how === 'model' && c2.opts.aspectRatio === '21:9' && inMeta.width === 1400 && inMeta.height === 600 && /placed in the middle of a wider canvas/.test(c2.prompt) && /Keep the middle part exactly as it is/.test(c2.prompt) &&
    r.line === 'The same picture, made wider to fill its frame; the middle is as it was.', '"make it wider": a 21:9 canvas, its margins filled by the model, the middle kept', { aspect: c2.opts.aspectRatio, w: inMeta.width, line: r.line });
  /* already 21:9 (QA, 16 Nov 2026: the #53 picture in a 3.4:1 strip): no paid call for a few per cent; ETB2B AI's own picture
     is made again in its frame's shape, the owner's photo left as it is and said */
  files['events/' + EV + '/generated/wide.png'] = await scene(0, 1536, 672);
  files['events/' + EV + '/media/wide.jpg'] = await sharp(await scene(0, 1536, 672)).jpeg().toBuffer();
  n = calls.length;
  r = await edit.run(job({ editOf: { url: OWN + 'generated/wide.png' }, change: 'make it wider', changeKind: 'extend', frame: '1152:340' }), CTX);
  var r2 = await edit.run(job({ editOf: { url: OWN + 'media/wide.jpg' }, change: 'make it wider', changeKind: 'extend', frame: '1152:340' }), CTX);
  check(r.code === 'not-supported' && r2.code === 'edit-wide' && /already as wide/.test(r2.error) && calls.length === n, 'wider, already 21:9: made again in its frame\'s shape, or (the owner\'s photo) said; nothing paid', [r.code, r2.code]);
  answers.push(madeAnswer(made));
  r = await edit.run(job({ change: 'make it wider', changeKind: 'extend', frame: '' }), CTX);
  check(r.how === 'model' && calls[calls.length - 1].opts.aspectRatio === '16:9', 'wider with no frame known: the next shape a quarter wider (4:3 to 16:9)', calls[calls.length - 1].opts.aspectRatio);
  /* a re-fit starts from the picture as it was made (job.original), before its frame cut it */
  downloads = [];
  r = await edit.run(job({ change: 'crop it tighter', changeKind: 'crop', original: OWN + 'generated/1-hall-original.png' }), CTX);
  check(r.how === 'sharp' && downloads[0] === 'events/' + EV + '/generated/1-hall-original.png' && r.width === 1184, 'a closer crop starts from the picture as it was made', { d: downloads, w: r.width });

  /* the owner's own photos: light, colour, crop and background; faces never */
  n = calls.length;
  r = await edit.run(job({ editOf: { url: OWN + 'media/owner.jpg' }, change: 'remove the people', changeKind: 'remove' }), CTX);
  check(r.code === 'edit-own-photo' && r.status === 422 && /your own photo/.test(r.error) && /never the people in it/.test(r.error) && !/\bET\b/.test(r.error) && calls.length === n,
    'the owner\'s own photo: removing people is refused in plain words, before anything is paid for', r);
  r = await edit.run(job({ editOf: { url: OWN + 'chat-docs/20261116120000-a1b2c3/mw1-0123456789ab-p3.jpg' }, change: 'make her smile', changeKind: 'replace' }), CTX);
  check(r.code === 'edit-own-photo' && calls.length === n, 'a photo from the owner\'s document: a face is never changed');
  r = await edit.run(job({ editOf: { url: OWN + 'media/owner.jpg' }, change: 'make it a little brighter', changeKind: 'light' }), CTX);
  check(r.how === 'sharp' && calls.length === n, 'the owner\'s own photo made brighter: exact, free');
  answers.push(madeAnswer(made));
  r = await edit.run(job({ editOf: { url: OWN + 'media/owner.jpg' }, change: 'replace the background with a plain light grey wall', changeKind: 'replace' }), CTX);
  check(r.how === 'model' && /the event owner's own photograph: change only its light, colour, framing or background/.test(calls[calls.length - 1].prompt) &&
    /Keep every person in it exactly as they are/.test(calls[calls.length - 1].prompt), 'the owner\'s own photo, a new background: the model is told to keep every person exactly as they are', calls[calls.length - 1].prompt);
  check(edit.check(job({ editOf: { url: OWN + 'media/owner.jpg' }, change: 'replace the background and remove the man', changeKind: 'replace' }), CTX).ok === false &&
    edit.check(job({ editOf: { url: OWN + 'media/owner.jpg' }, change: 'make it wider', changeKind: 'extend' }), CTX).ok === true &&
    edit.check(job({ change: 'remove the people', changeKind: 'remove' }), CTX).ok === true, 'check(): what builder A asks before planning (no network)');

  /* a repair (builder B): the Critic's one instruction on the picture in hand */
  downloads = [];
  answers.push(madeAnswer(made));
  r = await edit.run({ mode: 'new', peopleRule: 'none', aspect: '16:9' }, Object.assign({}, CTX, { base: { bytes: J, type: 'image/jpeg' }, change: 'remove the two small figures at lower left; change nothing else' }));
  check(r.how === 'model' && downloads.length === 0 && calls[calls.length - 1].opts.image.mimeType === 'image/jpeg' && /remove the two small figures/.test(calls[calls.length - 1].prompt),
    'a repair edits the picture it is given, reading nothing', { how: r.how, d: downloads });

  /* style: the site's style references go with it; never the picture changed */
  answers.push(madeAnswer(made));
  r = await edit.run(job({ change: 'match the site\'s style', changeKind: 'style' }), Object.assign({}, CTX, { refs: [
    { mimeType: 'image/jpeg', data: 'AAAA', label: 'Reference 1, STYLE ONLY: x', kind: 'site', use: 'style' }, { mimeType: 'image/jpeg', data: 'BBBB', label: 'Reference 2, x', kind: 'current', use: 'style' }] }));
  var c3 = calls[calls.length - 1];
  check(c3.opts.images && c3.opts.images.length === 1 && c3.opts.images[0].data === 'AAAA' && c3.opts.images[0].label === 'Reference 1, STYLE ONLY: x' && /for style only/.test(c3.prompt),
    'a change of style: shown the site\'s style references, never the picture being changed', c3.opts.images);

  /* failures, in plain words; never a blind remake */
  answers.push(gemini.failure('ai-quota', { provider: 'gemini' }));
  r = await edit.run(job({ change: 'remove the people', changeKind: 'remove' }), CTX);
  check(r.code === 'ai-quota' && r.status === 429, 'the picture model\'s own failure is passed on', r);
  answers.push({ mimeType: 'image/png', base64: Buffer.from('nope').toString('base64') });
  r = await edit.run(job({ change: 'remove the people', changeKind: 'remove' }), CTX);
  check(r.code === 'ai-bad-output', 'an answer that is not a picture: ai-bad-output', r);
  n = calls.length;
  r = await edit.run(job({ change: 'remove the people', changeKind: 'remove' }), Object.assign({}, CTX, { deadlineAt: Date.now() + 30000 }));
  check(r.code === 'edit-time' && calls.length === n && /not enough time/.test(r.error), 'no time left for the model: said, nothing paid', r);
  r = await edit.run(job({ change: 'make it warmer', changeKind: 'tone' }), Object.assign({}, CTX, { deadlineAt: Date.now() + 30000 }));
  check(r.how === 'sharp', '… an exact edit still is done');
  r = await edit.run(job({ editOf: { url: OWN + 'generated/gone.png' }, change: 'make it warmer', changeKind: 'tone' }), CTX);
  check(r.code === 'edit-unreadable' && /could not open that picture/.test(r.error), 'a picture no longer in Storage: said', r);
  r = await edit.run(job({ change: '' }), CTX);
  check(r.code === 'not-supported', 'no words of a change: the runner makes the picture as before');
  check(Object.keys(edit.WORDS).every(function (k) { return !/\bET\b/.test(edit.WORDS[k]) && /Nothing on your site changed/.test(edit.WORDS[k]); }), 'every refusal says nothing changed, and never a bare "ET"');
  done();
})().catch(function (e) { console.error('picture-edit: the test itself stopped — ' + (e && e.stack || e)); process.exit(1); });

function done() {
  if (failures.length) { console.error('picture-edit: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('picture-edit: all ' + checks + ' checks passed');
}
