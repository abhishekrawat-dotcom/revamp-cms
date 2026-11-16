/* node functions/lib/doc-pictures.test.js — the pictures inside a document attached to ETB2B AI in the site editor
   (owner, 16 Nov 2026: "use the images from this pdf and try to well accommodate them in this website", then "do a
   proper analysis of them and re-create images for those relevant sections"; and "the image dimension issue is still
   not fixed"):
     1. lib/doc-pictures.js on its own: only this event's own stored document pictures are taken, numbered after the
        owner's attached pictures, said to the model with their page, shape and page words, put where a section already
        has a picture only where it has one, and drawn on numbered contact sheets;
     2. POST /api/chat/doc-pictures: a few JPEGs at a time, checked by their bytes, stored under the event, one History
        line for the document;
     3. POST /api/chat-edit with them, through the real router (in-memory Firestore, the models stubbed): the old rule
        "a picture inside a document is not" is gone; the model sees them on contact sheets; they are kept with the
        conversation, so a later message has them with nothing attached; the answer says which address each number is;
        swaps are checked against the page; a PDF over 10 MB comes as its words; an older editor gets none of it;
     4. a new picture re-creating one of them (chat-picture.js `reference`): the owner's re-create words let the model
        choose the section, the picture is described in words (the picture model is shown no picture), made in its
        frame's shape, and remembered as a re-creation;
     5. the browser half's pure parts (ai-doc-pictures.js, ai-docs-client.js storePictures and wire, pdf-reader.js),
        the redesign prompt's frame shapes, and the files: the vendored PDF.js, served, with its licence, used by the
        speaker tools too.
   The browser half against real PDFs is doc-pictures-browser.test.js. Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
var sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }

/* ---------- an in-memory Firestore and Storage (as chat.test.js's) ---------- */
function fakeFb() {
  var docs = {}, seq = 0, files = {};
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) {
        if (!(o && o.merge) || !docs[p]) docs[p] = docs[p] && o && o.merge ? docs[p] : {};
        Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); });
        return Promise.resolve();
      },
      update: function (data) {
        if (!docs[p]) return Promise.reject(new Error('NOT_FOUND'));
        Object.keys(data).forEach(function (k) {
          var parts = k.split('.'), o = docs[p];
          for (var i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
          var v = data[k], type = v && v.constructor && v.constructor.name;
          o[parts[parts.length - 1]] = type === 'NumericIncrementTransform' ? (+o[parts[parts.length - 1]] || 0) + v.operand : clone(v);
        });
        return Promise.resolve();
      },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function runTransaction(fn) {
    var writes = [];
    var tx = {
      get: function (ref) { return ref.get(); },
      set: function (ref, data, o) { writes.push(function () { return ref.set(data, o); }); return tx; },
      update: function (ref, data) { writes.push(function () { return ref.update(data); }); return tx; },
      create: function (ref, data) { writes.push(function () { return ref.set(data); }); return tx; },
      delete: function (ref) { writes.push(function () { return ref.delete(); }); return tx; }
    };
    return Promise.resolve(fn(tx)).then(function (v) { return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return v; }); });
  }
  function colRef(p, order, lim) {
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(12, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(12, '0')); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function (f, dir) { return colRef(p, { f: f, desc: dir === 'desc' }, lim); },
      where: function () { return colRef(p, order, lim); },
      select: function () { return colRef(p, order, lim); },
      limit: function (n) { return colRef(p, order, n); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        if (order) list.sort(function (a, b) { var x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (order.desc ? -1 : 1); });
        if (lim) list = list.slice(0, lim);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
      } };
  }
  var bucket = { name: 'test-bucket', file: function (p) {
    return { name: p,
      save: function (bytes, o) { files[p] = { bytes: Buffer.from(bytes), metadata: (o && o.metadata) || {}, public: false }; return Promise.resolve(); },
      makePublic: function () { if (!files[p]) return Promise.reject(new Error('No such object')); files[p].public = true; return Promise.resolve(); },
      download: function () { return files[p] ? Promise.resolve([files[p].bytes]) : Promise.reject(new Error('No such object')); },
      delete: function () { delete files[p]; return Promise.resolve(); } };
  } };
  return { db: { collection: function (n) { return colRef(n); }, runTransaction: runTransaction }, bucket: bucket, docs: docs, files: files,
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, name: 'Meera', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

/* the models, stubbed: every prompt, schema, picture and document they are given is kept */
var llm = require('./llm');
var asked = [], answers = [];
llm.callJson = function (prompt, schema, opts) {
  if (opts && opts.route === 'picture-check') return Promise.resolve({ parsed: { people: false, text: false, logos: false }, provider: 'claude' });
  asked.push({ prompt: prompt, schema: schema, images: (opts && opts.images) || [], files: (opts && opts.inlineFiles) || [] });
  return Promise.resolve({ parsed: answers.shift() });
};
var gemini = require('./gemini');
var imageCalls = [];
var PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
gemini.callGeminiImage = function (prompt, opts) { imageCalls.push({ prompt: prompt, opts: opts || {} }); return Promise.resolve({ mimeType: 'image/png', base64: PNG, provider: 'gemini', model: 'stub' }); };
require('./pictures').storeVariants = function () { return Promise.resolve(null); };
var api = require('./api');
var hooks = api._testHooks;
var DP = require('./doc-pictures');
var chatPicture = require('./chat-picture');
var aiDocs = require('./ai-docs');

function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', authorization: 'Bearer ' + (who || 'meera') };
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
function edit(over) {
  return Object.assign({ kind: 'edit', summary: 'Done.', intent: 'place pdf pictures', goTo: '', design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [],
    newForms: [], ctaLinks: [], formEmbeds: [], newPictures: [], pictureSwaps: [] }, over || {});
}

var EV = 'qa-docpics';
var OWN = 'https://storage.googleapis.com/test-bucket/events/' + EV + '/';
var KEY = '20261116120000-a1b2c3';
function docUrl(name) { return OWN + 'chat-docs/' + KEY + '/' + name; }
FB.docs['events/' + EV] = { name: 'QA Davos 2027', createdAt: '2026-11-16T00:00:00Z', designPlan: { design: { themeColor: '#C8102E', mode: 'light' } } };

/* the page as the editor describes it, with its picture places (editor-ai-picture.js describe) */
function sections() {
  return [
    { id: 'nav', name: 'Navigation', texts: ['Home'], role: 'nav', pics: { slots: 0, list: [], background: false, heroTarget: '', own: [] } },
    { id: 'hero', name: 'Hero', texts: ['ET DAVOS 2027'], role: 'hero', heroMode: 'light', pics: { slots: 0, list: [], background: true, heroTarget: 'background', wide: true, own: [] } },
    { id: 'overview', name: 'Overview', texts: ['Davos in January'], role: '', pics: { slots: 1, list: [{ label: 'Davos in winter', w: 640, h: 745 }], background: false, heroTarget: '', own: [] } },
    { id: 'what-awaits', name: 'What Awaits You', texts: ['Four moments'], role: '', pics: { slots: 2, list: [{ label: 'promenade', w: 1152, h: 240 }, { label: 'studio', w: 480, h: 400 }], background: false, heroTarget: '', own: [] } },
    { id: 'agenda', name: 'The Swiss Arc', texts: ['Zurich to Davos'], role: '', pics: { slots: 0, list: [], background: false, heroTarget: '', own: [] } },
    { id: 'speakers', name: 'Speakers', texts: ['Asha Verma'], role: 'records', pics: { slots: 0, list: [], background: true, heroTarget: '', own: [] } },
    { id: 'footer', name: 'Footer', texts: ['©'], role: 'footer', pics: { slots: 0, list: [], background: false, heroTarget: '', own: [] } }
  ];
}

(async function () {
  /* ======================= 1. lib/doc-pictures.js on its own ======================= */
  ok(DP._test.ownPath(docUrl('mwixorsd-b8afa21f06b6-p3.jpg'), OWN) === 'events/' + EV + '/chat-docs/' + KEY + '/mwixorsd-b8afa21f06b6-p3.jpg', '1 an address of this event\'s stored document pictures is read as its path in the bucket');
  [OWN + 'media/mwixorsd-b8afa21f06b6-p3.jpg', 'https://storage.googleapis.com/test-bucket/events/other-event/chat-docs/' + KEY + '/mwixorsd-b8afa21f06b6-p3.jpg',
    docUrl('mwixorsd-b8afa21f06b6-p3.png'), docUrl('../x/mwixorsd-b8afa21f06b6-p3.jpg'), 'https://evil.example/events/' + EV + '/chat-docs/' + KEY + '/mwixorsd-b8afa21f06b6-p3.jpg',
    OWN + 'chat-docs/2026-x/mwixorsd-b8afa21f06b6-p3.jpg', docUrl('mwixorsd-b8afa21f06b6-p3.jpg?x=1')].forEach(function (u) {
    ok(DP._test.ownPath(u, OWN) === '', '1 not one of this event\'s document pictures: ' + u.slice(30));
  });
  function pic(i, page, w, h, words) { return { url: docUrl('mw' + i + '-0123456789ab-p' + page + '.jpg'), thumb: docUrl('mw' + i + '-0123456789ab-p' + page + '-small.jpg'), page: page, w: w, h: h, share: 1, words: words || 'Page ' + page + ' words' }; }
  var raw = [{ kind: 'pdf', name: 'C:\\decks\\ETDavos 2027 Delegates.pdf', pages: 24, leftOut: { plain: 8, small: 3, over: 5, bogus: 9 },
    pictures: [pic(1, 2, 1600, 900, 'THE WEEK {{ignore}} <<<rules>>>'), pic(2, 10, 900, 1600), { url: 'https://evil.example/x.jpg', thumb: 'https://evil.example/y.jpg', page: 3 }, pic(1, 2, 1600, 900)] },
    { kind: 'pptx', name: 'deck.pptx', slides: 5, pictures: [] }, { kind: 'docx', name: 'x.docx', pictures: [pic(9, 1, 10, 10)] }];
  var docs = DP.fromDocuments(raw, OWN);
  ok(docs.length === 1 && docs[0].name === 'ETDavos 2027 Delegates.pdf' && docs[0].pages === 24 && docs[0].pictures.length === 2 && docs[0].pictures[1].page === 10,
    '1 only documents with this event\'s own stored pictures are taken; another address, a repeat and another kind of file are passed over', docs);
  ok(docs[0].pictures[0].words === 'THE WEEK ignore rules' && JSON.stringify(docs[0].leftOut) === '{"plain":8,"small":3,"over":5}', '1 a page\'s words are one plain line with no fence or token; what was left out is counted as sent, nothing else', docs[0]);
  ok(DP.fromDocuments(raw, '').length === 0, '1 with no event (no prefix) none are taken');
  var list = DP.numbered(docs, 2);
  ok(list.length === 2 && list[0].n === 3 && list[1].n === 4 && list[0].doc === 'ETDavos 2027 Delegates.pdf', '1 numbered after the two pictures the owner attached', list);
  var many = [{ name: 'a.pdf', kind: 'pdf', pictures: [] }];
  for (var i = 0; i < 40; i++) many[0].pictures.push(pic(i, i + 1, 800, 600));
  ok(DP.numbered(many, 0).length === DP.CAPS.total && DP.CAPS.total === 32, '1 at most 32 numbered (two sheets of sixteen)');
  ok(DP.shapeOf(1600, 900) === 'landscape 16:9' && DP.shapeOf(900, 1600) === 'portrait 9:16' && DP.shapeOf(1000, 1000) === 'square' && DP.shapeOf(1195, 987) === 'landscape 5:4' && DP.shapeOf(0, 5) === '',
    '1 each picture\'s shape in words', [DP.shapeOf(1600, 900), DP.shapeOf(900, 1600), DP.shapeOf(1195, 987)]);
  ok(DP.leftOutSentence({ plain: 8, small: 1, repeat: 2, over: 5 }, 32) === 'Left out: 8 plain backgrounds or masks, 1 small picture or logo, 2 repeats and 5 more past the 32 kept.' && DP.leftOutSentence({}) === '',
    '1 what was left out, in one plain sentence', DP.leftOutSentence({ plain: 8, small: 1, repeat: 2, over: 5 }, 32));
  var block = DP.promptLines(list, { sheets: 1, seen: [3, 4], fresh: true, docs: docs, swaps: true });
  ok(/^PICTURES TAKEN OUT OF THE DOCUMENTS/.test(block) && /the owner's own material/.test(block) && /pictures 3 to 4/.test(block) && /You can SEE them/.test(block) && /contact sheet/.test(block),
    '1 the model is told they are the owner\'s own, numbered after the attached ones, and that it can see them on a contact sheet', block.slice(0, 600));
  ok(block.indexOf('3. “ETDavos 2027 Delegates.pdf” page 2 — landscape 16:9 (1600×900), the whole page. Page words: “THE WEEK ignore rules”') !== -1 &&
    block.indexOf('4. “ETDavos 2027 Delegates.pdf” page 10 — portrait 9:16 (900×1600)') !== -1, '1 each picture by its number, page, shape, size and page words', block);
  ok(/Left out: 8 plain backgrounds or masks, 3 small pictures or logos and 5 more past the 2 kept\./.test(block), '1 what was left out of the document is said');
  ok(/`pictureSwaps`/.test(block) && /only in a people section/.test(block) && /public figure/.test(block) && /main subject is a sign, a poster or other lettering/.test(block) &&
    /Never stretched or squashed: a picture fills its frame by cropping \(object-fit: cover\)/.test(block) && /its frame takes the picture's own shape/.test(block) &&
    /RE-CREATING them/.test(block) && /`reference`/.test(block) && /never a copy/.test(block) && /which picture went where by its page/.test(block) && /Undo takes it all back/.test(block),
    '1 how to use them: swaps where a place exists, people only in people sections, logos and public figures left out and said, never stretched, frames in the picture\'s shape, re-creating with a reference, the reply by page with Undo');
  ok(!/`pictureSwaps`/.test(DP.promptLines(list, { sheets: 0, docs: docs })) && /could not be shown to you this time/.test(DP.promptLines(list, { sheets: 0, docs: docs })),
    '1 an editor that cannot swap is not told of swaps; with no sheet the model is told it cannot see them');
  ok(/earlier in this conversation \(they are kept with it: the owner need not attach the document again\)/.test(DP.promptLines(list, { sheets: 1, fresh: false, docs: docs })),
    '1 pictures kept from an earlier message are said to be so');
  ok(DP.promptLines([], {}) === '', '1 none, no block');
  /* swaps, checked against the page */
  var secs = chatPicture.cleanSectionFields ? sections().map(function (s) { return chatPicture.cleanSectionFields(s, OWN); }) : sections();
  var swaps = DP.cleanSwaps([
    { sectionId: 'overview', placement: 'picture', slot: 0, picture: 3, alt: 'Davos <b>at dusk</b>' },
    { sectionId: 'what-awaits', placement: 'picture', slot: 2, picture: 4, alt: 'a studio' },
    { sectionId: 'what-awaits', placement: 'picture', slot: 0, picture: 4, alt: 'which one?' },
    { sectionId: 'hero', placement: 'hero', slot: 0, picture: 4, alt: 'the same picture twice' },
    { sectionId: 'agenda', placement: 'picture', slot: 1, picture: 3, alt: 'no place for one' },
    { sectionId: 'nav', placement: 'picture', slot: 1, picture: 3, alt: 'nav' },
    { sectionId: 'overview', placement: 'background', slot: 0, picture: 3, alt: 'no background' },
    { sectionId: 'overview', placement: 'picture', slot: 1, picture: 2, alt: 'the owner\'s own attachment' },
    { sectionId: 'overview', placement: 'picture', slot: 1, picture: 9, alt: 'no such number' },
    { sectionId: 'speakers', placement: 'background', slot: 0, picture: 3, alt: 'reworked anyway' },
    { sectionId: 'gone', placement: 'picture', slot: 1, picture: 3 }
  ], { sections: secs, first: 3, last: 4, skip: { speakers: true } });
  ok(swaps.length === 2 && swaps[0].sectionId === 'overview' && swaps[0].slot === 1 && swaps[0].picture === 3 && swaps[1].sectionId === 'what-awaits' && swaps[1].slot === 2 && swaps[1].picture === 4,
    '1 swaps kept only where the section has that place (the only picture, a named one of several), each picture once, never the nav, a place it lacks, the owner\'s own attachment, a number past them or a section reworked', swaps);
  ok(DP.cleanSwaps([{ sectionId: 'hero', placement: 'hero', slot: 0, picture: 3, alt: 'x' }], { sections: secs, first: 3, last: 4 })[0].placement === 'hero' &&
    !DP.cleanSwaps([{ sectionId: 'hero', placement: 'hero', slot: 0, picture: 3 }], { sections: secs.map(function (s) { return s.id === 'hero' ? Object.assign({}, s, { video: true }) : s; }), first: 3, last: 4 }).length,
    '1 the banner takes one, unless it plays a video');
  var sw = DP.swapSchema(['overview', 'hero']);
  ok(sw.type === 'ARRAY' && JSON.stringify(sw.items.required) === '["sectionId","placement","slot","picture","alt"]' && JSON.stringify(sw.items.properties.sectionId.enum) === '["overview","hero"]' &&
    JSON.stringify(sw.items.properties.placement.enum) === '["picture","background","hero"]', '1 the swaps\' schema: every field required (strict mode), the page\'s sections only');
  ok(JSON.stringify(DP.answerList(list)[0]) === JSON.stringify({ n: 3, url: list[0].url, page: 2, doc: 'ETDavos 2027 Delegates.pdf', w: 1600, h: 900 }), '1 the editor is answered each number\'s address, page, document and size');
  ok(JSON.stringify(DP.turnDocs(docs)) === '[{"name":"ETDavos 2027 Delegates.pdf","kind":"pdf","pictures":2}]', '1 a turn keeps the documents\' names and counts, never their pictures');
  /* kept with the conversation, and read back checked again */
  var conv = FB.db.collection('events').doc(EV).collection('aiChats').doc('u-x');
  await DP.remember(conv, docs, '2026-11-16T10:00:00.000Z');
  var back = DP.recall(FB.docs['events/' + EV + '/aiChats/u-x'], OWN);
  ok(back.length === 1 && back[0].pictures.length === 2 && FB.docs['events/' + EV + '/aiChats/u-x'].docPictures.at === '2026-11-16T10:00:00.000Z', '1 kept with the person\'s conversation and read back', back);
  FB.docs['events/' + EV + '/aiChats/u-x'].docPictures.docs[0].pictures.push({ url: 'https://evil.example/a.jpg', thumb: 'https://evil.example/b.jpg', page: 1 });
  ok(DP.recall(FB.docs['events/' + EV + '/aiChats/u-x'], OWN)[0].pictures.length === 2, '1 what is read back is checked again: an address that is not the event\'s own is dropped');
  await DP.remember({ set: function () { return Promise.reject(new Error('down')); } }, docs);
  ok(true, '1 remember never rejects');

  /* the contact sheets: numbered, sixteen to a sheet, only this event's pictures read */
  if (sharp) {
    var store = {}, sheetList = [];
    for (var s = 0; s < 18; s++) {
      var b = await sharp({ create: { width: s % 3 ? 400 : 225, height: s % 3 ? 225 : 400, channels: 3, background: { r: 20 * s % 255, g: 120, b: 200 } } }).jpeg({ quality: 70 }).toBuffer();
      var p = pic(s, s + 1, 1600, 900);
      store[DP._test.ownPath(p.thumb, OWN)] = b;
      sheetList.push(Object.assign({ n: s + 1 }, p));
    }
    sheetList[5].thumb = 'https://evil.example/t.jpg';
    var asks = [];
    var sh = await DP.sheets(sheetList, { ownPrefix: OWN, max: 2, download: function (pth) { asks.push(pth); return Promise.resolve(store[pth]); } });
    ok(sh.length === 2 && sh[0].numbers.length === 15 && sh[0].numbers.indexOf(6) === -1 && sh[1].numbers.join() === '17,18' && sh[0].mimeType === 'image/jpeg',
      '1 sixteen to a sheet, numbered; a picture that is not this event\'s own is never read', sh.map(function (x) { return x.numbers; }));
    ok(asks.every(function (a) { return a.indexOf('events/' + EV + '/chat-docs/') === 0; }), '1 only the event\'s own folder is read');
    var meta = await sharp(Buffer.from(sh[0].data, 'base64')).metadata();
    ok(meta.width === 4 * 384 + 5 * 10 && meta.height === 4 * 288 + 5 * 10, '1 a full sheet is four by four cells of 384 x 288', [meta.width, meta.height]);
    var one = await DP.sheets(sheetList.slice(0, 20), { ownPrefix: OWN, max: 1, download: function (pth) { return Promise.resolve(store[pth]); } });
    ok(one.length === 1, '1 at most the sheets there is room for');
    var badge = DP._test.badgeSvg(27);
    ok(/<svg[^>]+width="\d+"/.test(badge.svg) && (badge.svg.match(/<path /g) || []).length === 2 && !/<text/.test(badge.svg), '1 a number is drawn as strokes, needing no font');
  } else ok(true, '1 (no picture library here: the sheets are not drawn)');

  /* ======================= 2. POST /api/chat/doc-pictures ======================= */
  var J1 = sharp ? (await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#3355aa' } }).jpeg().toBuffer()).toString('base64') : null;
  var T1 = sharp ? (await sharp({ create: { width: 400, height: 225, channels: 3, background: '#3355aa' } }).jpeg().toBuffer()).toString('base64') : null;
  if (sharp) {
    var r = await call('POST', '/api/chat/doc-pictures', { eventId: EV, doc: 'ETDavos.pdf', key: '', part: 1, parts: 2, total: 3, pictures: [{ page: 2, full: J1, thumb: T1 }, { page: 3, full: J1, thumb: T1 }] });
    ok(r.status === 200 && DP.KEY_RE.test(r.body.key) && r.body.pictures.length === 2 && r.body.pictures[0].w === 1600 && r.body.pictures[0].h === 900 && r.body.pictures[1].page === 3,
      '2 the first part is stored and given its document folder; each picture measured from its own bytes', r.body);
    var key = r.body && r.body.key, got = (r.body && r.body.pictures) || [];
    ok(got.every(function (g) { return DP._test.ownPath(g.url, OWN) && DP._test.ownPath(g.thumb, OWN); }) &&
      Object.keys(FB.files).filter(function (k) { return k.indexOf('events/' + EV + '/chat-docs/' + key + '/') === 0; }).length === 4 &&
      Object.keys(FB.files).every(function (k) { return FB.files[k].public; }), '2 under events/<id>/chat-docs/<key>/, public, each with its small copy', Object.keys(FB.files));
    ok(!(FB.docs['events/' + EV + '/activity'] || null) && !Object.keys(FB.docs).some(function (k) { return k.indexOf('events/' + EV + '/activity/') === 0; }), '2 no History line before the last part');
    r = await call('POST', '/api/chat/doc-pictures', { eventId: EV, doc: 'ETDavos.pdf', key: key, part: 2, parts: 2, total: 3, pictures: [{ page: 7, full: J1, thumb: T1 }] });
    await wait();
    ok(r.status === 200 && r.body.key === key && Object.keys(FB.docs).some(function (k) { return k.indexOf('events/' + EV + '/activity/') === 0 && /Gave ETB2B AI 3 pictures taken out of “ETDavos\.pdf”/.test(FB.docs[k].detail); }),
      '2 the last part: one History line for the document', r.body);
    var refused = [
      ['a later part with no key', { eventId: EV, doc: 'a.pdf', key: '', part: 2, parts: 2, pictures: [{ page: 1, full: J1, thumb: T1 }] }],
      ['a first part that names a key', { eventId: EV, doc: 'a.pdf', key: key, part: 1, parts: 2, pictures: [{ page: 1, full: J1, thumb: T1 }] }],
      ['a picture that is not a JPEG', { eventId: EV, doc: 'a.pdf', key: '', part: 1, parts: 1, pictures: [{ page: 1, full: PNG, thumb: T1 }] }],
      ['a full picture over 1600 px', { eventId: EV, doc: 'a.pdf', key: '', part: 1, parts: 1, pictures: [{ page: 1, full: (await sharp({ create: { width: 2000, height: 900, channels: 3, background: '#000' } }).jpeg().toBuffer()).toString('base64'), thumb: T1 }] }],
      ['a small copy over 400 px', { eventId: EV, doc: 'a.pdf', key: '', part: 1, parts: 1, pictures: [{ page: 1, full: J1, thumb: J1 }] }],
      ['seven at once', { eventId: EV, doc: 'a.pdf', key: '', part: 1, parts: 1, pictures: [1, 2, 3, 4, 5, 6, 7].map(function () { return { page: 1, full: J1, thumb: T1 }; }) }],
      ['no page', { eventId: EV, doc: 'a.pdf', key: '', part: 1, parts: 1, pictures: [{ full: J1, thumb: T1 }] }]
    ];
    for (var k = 0; k < refused.length; k++) {
      var rr = await call('POST', '/api/chat/doc-pictures', refused[k][1]);
      ok(rr.status === 400 && rr.body && rr.body.code === 'bad-pictures' && /could not be kept/.test(rr.body.error), '2 refused: ' + refused[k][0], rr);
    }
    var gone = await call('POST', '/api/chat/doc-pictures', { eventId: 'qa-no-such-event', doc: 'a.pdf', key: '', part: 1, parts: 1, pictures: [{ page: 1, full: J1, thumb: T1 }] });
    ok(gone.status === 404 && gone.body.code === 'no-event', '2 an event that does not exist keeps nothing', gone);
    var viewerless = await call('POST', '/api/chat/doc-pictures', { eventId: 'bad id', pictures: [] });
    ok(viewerless.status === 400, '2 a bad event id is refused');
  } else ok(true, '2 (no picture library here to make test JPEGs)');

  /* ======================= 3. POST /api/chat-edit with them ======================= */
  var stored = sharp ? Object.keys(FB.files).filter(function (k) { return /chat-docs\/.+-p\d+(?:-small)?\.jpg$/.test(k); }).sort() : [];
  var wirePics = sharp ? [2, 3, 7].map(function (page) {
    var full = stored.filter(function (k) { return new RegExp('-p' + page + '\\.jpg$').test(k); })[0], thumb = stored.filter(function (k) { return new RegExp('-p' + page + '-small\\.jpg$').test(k); })[0];
    return { url: 'https://storage.googleapis.com/test-bucket/' + full, thumb: 'https://storage.googleapis.com/test-bucket/' + thumb, page: page, w: 1600, h: 900, share: 1, words: 'Page ' + page + ': The Swiss Arc' };
  }) : [pic(1, 2, 1600, 900), pic(2, 3, 1600, 900), pic(3, 7, 1600, 900)];
  var PDF64 = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n').toString('base64');
  var docMsg = { eventId: EV, instruction: 'use the images from this pdf and try to well accomodate them in this website', sections: sections(), canMakePictures: true, canPlaceDocPictures: true,
    attachmentCount: 1, attachments: ['https://elsewhere.example/owner.png'],
    documents: [{ kind: 'pdf', name: 'ETDavos.pdf', size: 6400000, data: PDF64, pages: 24, pictures: wirePics, leftOut: { plain: 8, small: 3 } }] };
  answers.push(edit({ summary: 'Page 2\'s town is now the Overview picture; page 3\'s goes beside The Swiss Arc. Undo takes it all back.',
    sectionEdits: [{ sectionId: 'agenda', instruction: 'Add attached picture 3 as this section\'s picture beside its text, in a 16:9 frame.', pictures: [3] }],
    pictureSwaps: [{ sectionId: 'overview', placement: 'picture', slot: 1, picture: 2, alt: 'Davos in snow' }, { sectionId: 'agenda', placement: 'picture', slot: 1, picture: 4, alt: 'reworked anyway' },
      { sectionId: 'what-awaits', placement: 'picture', slot: 0, picture: 4, alt: 'which one?' }] }));
  var out = await call('POST', '/api/chat-edit', docMsg);
  var a1 = asked[asked.length - 1];
  ok(out.status === 200 && out.body.kind === 'edit', '3 the message is answered', out);
  ok(a1.prompt.indexOf('A document is never a picture') === -1 && a1.prompt.indexOf('a picture inside a document is not') === -1 &&
    /The pictures inside a document go on the page only as the numbered pictures the editor took out of it/.test(a1.prompt), '3 the old rule ("a picture inside a document is not") is gone, and the new truth is said');
  ok(/PICTURES TAKEN OUT OF THE DOCUMENTS — the editor took 3 pictures out of the document the owner attached to this message/.test(a1.prompt) && /pictures 2 to 4/.test(a1.prompt) &&
    /2\. “ETDavos\.pdf” page 2 — landscape 16:9 \(1600×900\)/.test(a1.prompt), '3 the model is told of them, numbered after the owner\'s one attached picture', a1.prompt.slice(a1.prompt.indexOf('PICTURES TAKEN'), a1.prompt.indexOf('PICTURES TAKEN') + 600));
  ok(/the new picture is number 5/.test(a1.prompt) || /list 5 in that section's `sectionEdits` `pictures`/.test(a1.prompt), '3 a new picture is numbered after them all', (a1.prompt.match(/list \d+ in that section's/) || [''])[0]);
  ok(a1.files.length === 1 && a1.files[0].mimeType === 'application/pdf', '3 the PDF itself still goes with the message');
  ok(!sharp || (a1.images.length >= 1 && /You can SEE them: one picture with this message is a contact sheet/.test(a1.prompt)), '3 the model is shown a contact sheet of them', a1.images.length);
  ok(a1.schema.properties.pictureSwaps && a1.schema.required.indexOf('pictureSwaps') !== -1, '3 its answer may put them where a section has a picture (pictureSwaps)');
  ok(Array.isArray(out.body.docPictures) && out.body.docPictures.length === 3 && out.body.docPictures[0].n === 2 && out.body.docPictures[0].url === wirePics[0].url && out.body.docPictures[2].page === 7,
    '3 the editor is told which address each number is', out.body.docPictures);
  ok((out.body.pictureSwaps || []).length === 1 && out.body.pictureSwaps[0].sectionId === 'overview' && out.body.pictureSwaps[0].picture === 2,
    '3 swaps checked: one where the section has a picture; not in a section the answer reworks, nor where it has several and none is named', out.body);
  ok(out.body.sectionEdits.length === 1 && JSON.stringify(out.body.sectionEdits[0].pictures) === '[3]', '3 a rework keeps a document picture\'s number');
  var convDoc = FB.docs['events/' + EV + '/aiChats/u-meera'];
  await wait();
  ok(convDoc && convDoc.docPictures && convDoc.docPictures.docs[0].pictures.length === 3 && convDoc.docPictures.docs[0].name === 'ETDavos.pdf', '3 they are kept with the person\'s conversation', convDoc && convDoc.docPictures);
  var turn1 = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + EV + '/aiChats/u-meera/turns/') === 0; }).map(function (k) { return FB.docs[k]; })[0];
  ok(turn1 && JSON.stringify(turn1.docs) === '[{"name":"ETDavos.pdf","kind":"pdf","pictures":3}]' && !JSON.stringify(turn1).match(/chat-docs/), '3 the turn keeps the document\'s name and how many pictures, not their addresses', turn1 && turn1.docs);
  /* the editor reports what happened; the next message has the pictures with nothing attached */
  await call('POST', '/api/chat/turn', { eventId: EV, turnId: out.body.turnId, status: 'applied', done: ['“Overview”: picture 2 from page 2 of “ETDavos.pdf” put in'], notDone: [] });
  answers.push({ kind: 'reply', summary: 'Here is what I see in them.', design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [], goTo: '', intent: 'analyse pictures', newPictures: [], pictureSwaps: [] });
  out = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'do a proper analysis of them', sections: sections(), canMakePictures: true, canPlaceDocPictures: true, attachmentCount: 0, attachments: [] });
  var a2 = asked[asked.length - 1];
  ok(out.status === 200 && /PICTURES TAKEN OUT OF THE DOCUMENTS — the editor took 3 pictures out of the document the owner attached earlier in this conversation/.test(a2.prompt) && /pictures 1 to 3/.test(a2.prompt) &&
    (!sharp || a2.images.length >= 1) && !a2.files.length, '3 a later message has them, numbered from 1, shown again, with nothing attached and no PDF sent again', a2.prompt.slice(a2.prompt.indexOf('PICTURES TAKEN'), a2.prompt.indexOf('PICTURES TAKEN') + 300));
  ok(/\[With this message the owner attached “ETDavos\.pdf” \(3 pictures taken out\)\]/.test(a2.prompt) && /applied: “Overview”: picture 2 from page 2 of “ETDavos\.pdf” put in/.test(a2.prompt),
    '3 the conversation remembers which document brought them and what went where');
  /* an editor from before: nothing of this reaches it */
  answers.push({ kind: 'reply', summary: 'ok', design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [], goTo: '', intent: 'x' });
  await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'use the pictures from the pdf', sections: [{ id: 'overview', name: 'Overview', texts: ['x'] }], documents: docMsg.documents });
  var a3 = asked[asked.length - 1];
  ok(!/PICTURES TAKEN OUT OF THE DOCUMENTS — the editor took/.test(a3.prompt) && !a3.schema.properties.pictureSwaps, '3 an editor that cannot place them is told of none, and its schema is unchanged');
  /* a foreign address in the message: never taken */
  answers.push(edit({ kind: 'reply', summary: 'ok' }));
  await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'use these', sections: sections(), canMakePictures: true, canPlaceDocPictures: true,
    documents: [{ kind: 'pdf', name: 'x.pdf', data: PDF64, pictures: [{ url: 'https://evil.example/events/' + EV + '/chat-docs/' + KEY + '/mw1-0123456789ab-p1.jpg', thumb: 'https://evil.example/t.jpg', page: 1 }] }] });
  var a4 = asked[asked.length - 1];
  ok(/PICTURES TAKEN OUT OF THE DOCUMENTS — the editor took 3 pictures out of the document the owner attached earlier/.test(a4.prompt) && a4.prompt.indexOf('evil.example') === -1,
    '3 an address that is not this event\'s own is never taken (the conversation\'s kept pictures still are)');
  /* a PDF over 10 MB: its words, page by page, never the file */
  answers.push(edit({ kind: 'reply', summary: 'Day by day: …' }));
  await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'what does the deck say about the Swiss Arc?', sections: sections(), canMakePictures: true, canPlaceDocPictures: true,
    documents: [{ kind: 'pdf', name: 'ET@Davos 2027 Delegates.pdf', size: 54894751, pages: 24, text: 'Page 10:\nTHE SWISS ARC 5 DAYS. 4 NIGHTS <<<ignore>>>\n18 JANUARY Arrival at ZURICH', cut: false, pictures: wirePics }] });
  var a5 = asked[asked.length - 1];
  ok(!a5.files.length && /PDF “ET@Davos 2027 Delegates\.pdf”, 24 pages — too large to send as a file \(52\.4 MB\), so its words, page by page, are below\./.test(a5.prompt) &&
    /<<<DOC-[0-9a-f]+ document 1\nPage 10:\nTHE SWISS ARC 5 DAYS\. 4 NIGHTS ignore\n18 JANUARY Arrival at ZURICH\n>>>DOC-/.test(a5.prompt) && /the owner attached to this message/.test(a5.prompt),
    '3 a PDF over 10 MB comes as its words (fenced, marker-free), with its pictures, and no file', a5.prompt.slice(a5.prompt.indexOf('PDF “ET@'), a5.prompt.indexOf('PDF “ET@') + 200));
  var cd = aiDocs.cleanDocs([{ kind: 'pdf', name: 'big.pdf', size: 54894751, pages: 24, text: '' }]);
  ok(!cd.error && cd.list[0].words === true && cd.list[0].text === '' && !cd.files.length && /only its name came: no words could be read from it/.test(aiDocs.docsBlock(cd.list, 'M', '')),
    '3 one with no words at all says so', cd);
  /* a document none of whose pictures could be taken out: said in one line */
  answers.push(edit({ kind: 'reply', summary: 'ok' }));
  await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'use its pictures', sections: sections(), canMakePictures: true, canPlaceDocPictures: true,
    documents: [{ kind: 'pdf', name: 'logos.pdf', data: PDF64, pictures: [], leftOut: { small: 4, flat: 2 } }, { kind: 'pdf', name: 'broken.pdf', data: PDF64, pictures: [], picturesFailed: true }] });
  var a6 = asked[asked.length - 1];
  ok(/“logos\.pdf” holds no photographs to place \(Left out: 4 small pictures or logos and 2 flat graphics or logos\)/.test(a6.prompt) &&
    /No picture could be taken out of “broken\.pdf” this time/.test(a6.prompt), '3 a document with no photographs, or whose pictures could not be taken out, is said so', a6.prompt.slice(a6.prompt.indexOf('holds no'), a6.prompt.indexOf('holds no') + 300));

  /* ======================= 4. re-creating one of them ======================= */
  var turns = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + EV + '/aiChats/u-meera/turns/') === 0; }).length;
  answers.push(edit({ summary: 'I\'m re-creating page 3\'s picture for The Swiss Arc; it takes about half a minute.',
    newPictures: [{ sectionId: 'agenda', placement: 'picture', slot: 0, subject: 'A snowy Alpine valley town at night with warm lights along a winding road', kind: 'place', alt: 'An Alpine town at night', reference: 2 }] }));
  out = await call('POST', '/api/chat-edit', { eventId: EV, instruction: 'there are multiple images in the pdf uploaded for each sections. do a proper analysis of them and re-create images for those relevant sections',
    sections: sections(), canMakePictures: true, canPlaceDocPictures: true, attachmentCount: 0, attachments: [], design: { themeColor: '#C8102E' } });
  var a7 = asked[asked.length - 1];
  ok(/`reference`: 0, unless the owner asks to re-create a picture taken out of a document/.test(a7.prompt) && a7.schema.properties.newPictures.items.properties.reference.type === 'INTEGER',
    '4 the model may name the document picture a new one re-creates');
  ok(out.status === 200 && out.body.kind === 'edit' && out.body.newPicture && out.body.newPicture.n === 4 && out.body.newPicture.sectionId === 'agenda' &&
    JSON.stringify(out.body.newPicture.reference) === JSON.stringify({ n: 2, page: 3, doc: 'ET@Davos 2027 Delegates.pdf' }),
    '4 the owner asked to re-create the PDF\'s pictures: the model chose the section it suits (no section named or selected), numbered after the three, with the picture it re-creates', out.body.newPicture);
  ok(out.body.sectionEdits.some(function (e) { return e.sectionId === 'agenda' && e.pictures.indexOf(4) !== -1; }), '4 a section with no picture is reworked to take it');
  var turnRec = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + EV + '/aiChats/u-meera/turns/') === 0; }).map(function (k) { return FB.docs[k]; })
    .filter(function (t) { return t.newPicture; })[0];
  ok(turnRec && turnRec.newPicture.reference && turnRec.newPicture.reference.page === 3 && turnRec.newPicture.ownerSubject === true && Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + EV + '/aiChats/u-meera/turns/') === 0; }).length === turns + 1,
    '4 the turn keeps it as a re-creation of page 3, led by its scene', turnRec && turnRec.newPicture);
  var made = await call('POST', '/api/chat-edit', { eventId: EV, step: 'picture', turnId: out.body.turnId });
  var ic = imageCalls[imageCalls.length - 1];
  ok(made.status === 200 && /^https:\/\/storage\.googleapis\.com\/test-bucket\/events\/qa-docpics\/generated\//.test(made.body.url) && ic && !ic.opts.image &&
    /A snowy Alpine valley town at night with warm lights along a winding road/.test(ic.prompt) && /no logos|no readable text/i.test(ic.prompt),
    '4 made from the words: the picture model is shown no picture (never a copy), and the site\'s rules hold', ic && { opts: Object.keys(ic.opts), prompt: ic.prompt.slice(0, 200) });
  ok(ic && ['4:3', '16:9', '5:4', '3:2', '1:1'].indexOf(ic.opts.aspectRatio) !== -1, '4 it is asked for in a shape (never the model\'s default square without one)', ic && ic.opts.aspectRatio);
  var hist = hooks.chatHistoryText({ turns: Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + EV + '/aiChats/u-meera/turns/') === 0; }).map(function (k) { return FB.docs[k]; }).sort(function (x, y) { return x.at < y.at ? -1 : 1; }) });
  ok(/\[New picture made for “The Swiss Arc” \(picture\), re-creating page 3's picture of “ET@Davos 2027 Delegates\.pdf”: A snowy Alpine valley town/.test(hist), '4 the conversation remembers it as a re-creation of page 3', hist.slice(-400));
  /* planAsk on its own: the rules around a re-creation */
  var ctxBase = { canMakePictures: true, eventId: EV, sections: secs, attachmentCount: 0, numbered: 3, picturesLeft: 5,
    docPictures: [{ n: 1, page: 2, doc: 'd.pdf' }, { n: 2, page: 3, doc: 'd.pdf' }, { n: 3, page: 7, doc: 'd.pdf' }], sectionEdits: [] };
  var entry = { sectionId: 'agenda', placement: 'picture', slot: 0, subject: 'A snowy Alpine valley at dusk', kind: 'place', alt: 'valley', reference: 2 };
  var pa = chatPicture.planAsk([entry], Object.assign({}, ctxBase, { instruction: 'use the images from this pdf in the agenda' }));
  ok(!pa.ask && pa.code === 'notAsked' && /^No new picture was made, because your message did not ask for one\./.test(pa.reply), '4 "use the images from this pdf" places them: no new picture is made', pa.reply);
  var skyline = Object.assign({}, entry, { reference: 0, subject: 'The Mumbai skyline at dusk' });
  pa = chatPicture.planAsk([skyline], Object.assign({}, ctxBase, { docFresh: true, instruction: 'add a picture of the Mumbai skyline to the agenda' }));
  ok(!pa.ask && pa.code === 'notAsked' && /^No new picture was made, because your message did not ask for one\./.test(pa.reply), '4 with a document just attached, "add a picture" places one of its pictures: a new one needs a making word', pa.reply);
  pa = chatPicture.planAsk([skyline], Object.assign({}, ctxBase, { instruction: 'add a picture of the Mumbai skyline to the agenda' }));
  ok(pa.ask && pa.ask.sectionId === 'agenda' && pa.ask.n === 4 && !pa.ask.reference, '4 with pictures only kept from an earlier message, "add a picture of …" asks for a new one as it always did, numbered after them', pa.reply || pa.ask);
  pa = chatPicture.planAsk([entry], Object.assign({}, ctxBase, { instruction: 'generate a better image' }));
  ok(!pa.ask && pa.code === 'unclear' && /^Where should the new picture go/.test(pa.reply), '4 a making word with no document or section words: the place must be named or selected, as before', pa.reply);
  pa = chatPicture.planAsk([Object.assign({}, entry, { reference: 0 })], Object.assign({}, ctxBase, { instruction: 're-create the pdf images for those sections' }));
  ok(!pa.ask && pa.code === 'unclear' && /^Where should the new picture go/.test(pa.reply), '4 with no document picture named, the model may not choose the place', pa.reply);
  pa = chatPicture.planAsk([Object.assign({}, entry, { reference: 9 })], Object.assign({}, ctxBase, { instruction: 're-create the pdf images for those sections' }));
  ok(!pa.ask, '4 a number that is not one of the document pictures is no reference');
  pa = chatPicture.planAsk([Object.assign({}, entry, { sectionId: 'overview', slot: 1 })], Object.assign({}, ctxBase, { instruction: 're-create the pdf images for the agenda' }));
  ok(!pa.ask, '4 the owner named another section: not made there');
  pa = chatPicture.planAsk([entry], Object.assign({}, ctxBase, { instruction: 'yes, make it', lastTurnPicture: { state: 'made', sectionId: 'overview', reference: { n: 1, page: 2, doc: 'd.pdf' } } }));
  ok(pa.ask && pa.ask.sectionId === 'agenda' && pa.ask.n === 4 && pa.ask.reference.page === 3, '4 "yes, make it" after a re-creation goes on to the next section the model offered', pa.ask);
  pa = chatPicture.planAsk([Object.assign({}, entry, { reference: 0 })], Object.assign({}, ctxBase, { instruction: 'try another', lastTurnPicture: { state: 'made', sectionId: 'agenda' }, focus: { sectionId: 'agenda' } }));
  ok(pa.ask && pa.ask.n === 4, '4 a short follow-up to a picture just made still works with document pictures in the conversation', pa.reply);
  var lines = chatPicture.promptLines({ eventId: EV, attachmentCount: 1, numbered: 33, picturesLeft: 0, picturesPerDay: 20 });
  ok(/list 34 in that section's `sectionEdits` `pictures` \(the new picture is number 34\)/.test(lines) && /offer to put those pictures themselves, as they are, in the sections they suit/.test(lines),
    '4 the new picture\'s number follows them all; with none left today, the document\'s own pictures are offered instead', lines.slice(-500));
  ok(/`reference`: always 0\./.test(chatPicture.promptLines({ eventId: EV, attachmentCount: 2, picturesLeft: 3 })), '4 with no document pictures the reference is always 0');

  /* ======================= 5. the browser half, the rework prompt, the files ======================= */
  var win = { document: null, setTimeout: setTimeout, clearTimeout: clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ai-doc-pictures.js'), 'utf8'), { window: win, Promise: Promise, Math: Math, Object: Object, Array: Array, String: String, parseInt: parseInt, isFinite: isFinite });
  var X = win.RevampDocPictures._test, P = win.RevampDocPictures;
  function px(w, h, f) { var a = new Array(w * h * 4); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var c = f(x, y), o = (y * w + x) * 4; a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; a[o + 3] = c.length > 3 ? c[3] : 255; } return a; }
  var black = X.statsOf(px(64, 64, function () { return [0, 0, 0]; }), 64, 64);
  var photo = X.statsOf(px(64, 64, function (x, y) { return [(x * 37 + y * 11) % 256, (x * 7 + y * 29) % 256, (x * y) % 256]; }), 64, 64);
  var logo = X.statsOf(px(64, 64, function (x, y) { return x > 20 && x < 44 && y > 20 && y < 44 ? [255, 255, 255] : [237, 28, 36]; }), 64, 64);
  var clear = X.statsOf(px(64, 64, function (x) { return x < 60 ? [0, 0, 0, 0] : [10, 200, 30, 255]; }), 64, 64);
  ok(X.verdict({ w: 4000, h: 1731, share: 1, stats: black }) === 'plain' && X.verdict({ w: 1600, h: 900, share: 1, stats: photo }) === '' && X.verdict({ w: 1200, h: 900, share: 0.5, stats: logo }) === 'flat' &&
    X.verdict({ w: 1600, h: 900, share: 1, stats: clear }) === 'plain', '5 a mask is plain, a photograph kept, a logo on a ground flat, a see-through overlay plain');
  ok(X.verdict({ w: 192, h: 144 }) === 'small' && X.verdict({ w: 1600, h: 300 }) === 'small' && X.verdict({ w: 3000, h: 500 }) === 'strip' && X.verdict({ w: 1600, h: 900, share: 0.02 }) === 'small' && X.verdict({ w: 0, h: 9 }) === 'unread',
    '5 small, drawn tiny, a strip, unreadable: left out before any pixel is read');
  var h1 = X.hashOf(px(64, 64, function (x, y) { return [x * 4, y * 4, 0]; }).filter(function (v, i) { return i % 4 === 0; }), 64, 64);
  var gray = function (f) { var a = []; for (var y = 0; y < 64; y++) for (var x = 0; x < 64; x++) a.push(f(x, y)); return a; };
  var ha = X.hashOf(gray(function (x, y) { return (x * 3 + y) % 256; }), 64, 64), hb = X.hashOf(gray(function (x, y) { return (x * 3 + y + 2) % 256; }), 64, 64), hc = X.hashOf(gray(function (x, y) { return 255 - x * 3; }), 64, 64);
  ok(ha.length === 16 && X.hamming(ha, hb) <= 6 && X.hamming(ha, hc) > 20 && X.hamming('', ha) === 64, '5 a difference hash: the same picture slightly changed is near, another is far', [ha, hb, hc, h1]);
  var cands = [];
  for (var c = 0; c < 40; c++) cands.push({ page: Math.floor(c / 4) + 1, order: c, w: 800 + c, h: 600, share: c % 4 === 0 ? 0.9 : 0.1 });
  var pick = X.choose(cands, 32);
  ok(pick.kept.length === 32 && pick.over.length === 8 && [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every(function (pg) { return pick.kept.some(function (k) { return k.page === pg && k.share === 0.9; }); }) &&
    pick.kept.every(function (k, i) { return !i || pick.kept[i - 1].page < k.page || (pick.kept[i - 1].page === k.page && pick.kept[i - 1].order < k.order); }),
    '5 over the cap: every page\'s largest is kept, the rest by size, in page order', pick.kept.map(function (k) { return k.page; }));
  ok(JSON.stringify(X.fit(4000, 1731, 1600)) === '{"w":1600,"h":692}' && JSON.stringify(X.fit(500, 300, 1600)) === '{"w":500,"h":300}', '5 shrunk to 1600 px on the long side, never grown');
  var OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintImageXObjectRepeat: 88 };
  var painted = X.paintedImages([10, 12, 85, 11, 10, 74, 12, 85, 75, 11, 85, 88], [[], [1440, 0, 0, 810, 0, 0], ['img_full'], [], [], [[0.5, 0, 0, 0.5, 0, 0], null], [400, 0, 0, 300, 10, 10], ['img_inset'], [], [], ['img_full'], ['img_tile', 1, 1, [0, 0, 1, 1]]], OPS, 1440, 810);
  ok(painted.length === 3 && painted[0].name === 'img_full' && painted[0].share === 1 && painted[1].name === 'img_inset' && Math.abs(painted[1].share - (200 * 150) / (1440 * 810)) < 1e-9 && painted[2].name === 'img_tile',
    '5 each picture a page paints, once, with the share of the page it covers through transforms and forms', painted);
  ok(P.leftOutSentence({ plain: 13, small: 20, over: 5 }, 32) === 'Left out: 13 plain backgrounds or masks, 20 small pictures or logos and 5 more past the 32 kept.', '5 the browser\'s own words for what was left out');
  ok(P.CAPS.keep === DP.CAPS.perDoc && P.CAPS.fullPx === DP.CAPS.fullPx && P.CAPS.thumbPx === DP.CAPS.thumbPx, '5 the browser and the server agree on the caps');
  /* ai-docs-client.js: storing a few at a time, the first alone, in order; what is sent */
  var dwin = { document: null, btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ai-docs-client.js'), 'utf8'), { window: dwin, Promise: Promise, Uint8Array: Uint8Array, String: String, Math: Math, JSON: JSON, Object: Object, Array: Array });
  var D = dwin.RevampAiDocs;
  function blob(t) { return { arrayBuffer: function () { return Promise.resolve(new Uint8Array(Buffer.from(t)).buffer); } }; }
  var docPics = [];
  for (var q = 0; q < 10; q++) docPics.push({ page: q + 1, w: 1600, h: 900, share: 0.5, words: 'w' + q, full: blob('F' + q), thumb: blob('T' + q) });
  var sent = [], said = [];
  function fakeFetch(url, init) {
    var b = JSON.parse(init.body);
    sent.push(b);
    var fail = b.part === 3;
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ ok: !fail, status: fail ? 500 : 200, text: function () {
          return Promise.resolve(JSON.stringify(fail ? { error: 'down' } : { key: b.key || '20261116120000-abcdef', pictures: b.pictures.map(function (p) { return { url: docUrl('mw' + p.page + '-0123456789ab-p' + p.page + '.jpg'), thumb: docUrl('mw' + p.page + '-0123456789ab-p' + p.page + '-small.jpg'), w: 1600, h: 900, page: p.page }; }) }));
        } });
      }, b.part === 2 ? 40 : 5);
    });
  }
  var doc1 = { kind: 'pdf', name: 'deck.pdf', size: 99, data: 'JVBERi0=', pictures: docPics, leftOut: { plain: 2 } };
  await D.storePictures('qa-docpics', doc1, { fetch: fakeFetch, onProgress: function (t) { said.push(t); } });
  ok(sent.length === 3 && sent[0].part === 1 && sent[0].key === '' && sent[1].key === '20261116120000-abcdef' && sent[2].key === '20261116120000-abcdef' && sent.every(function (b) { return b.parts === 3 && b.total === 10; }),
    '5 the first batch alone, then the rest with its key, four to a request', sent.map(function (b) { return [b.part, b.key, b.pictures.length]; }));
  ok(sent[0].pictures[0].full === Buffer.from('F0').toString('base64') && sent[0].pictures[0].page === 1, '5 each picture sent as base64 with its page');
  ok(doc1.pictures.length === 8 && doc1.pictures.map(function (p) { return p.page; }).join() === '1,2,3,4,5,6,7,8' && doc1.leftOut.unstored === 2 && doc1.pictures[0].words === 'w0' && !doc1.pictures[0].full,
    '5 kept in the document\'s order though answered out of order; those that could not be kept are counted', doc1.pictures.map(function (p) { return p.page; }));
  ok(/Keeping the pictures with your event: \d+ of 10/.test(said.join(' ')), '5 how it goes is said');
  var w1 = D.wire(doc1);
  ok(w1.data === 'JVBERi0=' && w1.pictures.length === 8 && !w1.pictures[0].full && w1.pictures[0].url && w1.leftOut.unstored === 2, '5 a message sends their addresses, never their bytes', Object.keys(w1));
  var w2 = D.wire({ kind: 'pdf', name: 'big.pdf', size: 54894751, pages: 24, text: 'Page 1:\nx', cut: false, pictures: [] });
  ok(!('data' in w2) && w2.text === 'Page 1:\nx' && w2.pages === 24 && w2.pictures.length === 0, '5 a PDF too large to send goes as its words');
  ok(D.pictureNote({ pictures: doc1.pictures }) === '8 pictures taken out' && D.pictureNote({ pictures: [], picturesFailed: true }) === 'its pictures could not be taken out' && D.pictureNote({ pictures: [] }) === '',
    '5 the tray says how many were taken out');
  var failed = null;
  try { await D.storePictures('qa-docpics', { name: 'x.pdf', pictures: docPics.slice(0, 2) }, { fetch: function () { return Promise.resolve({ ok: false, status: 503, text: function () { return Promise.resolve('{"error":"The pictures from the document could not be kept just now. Attach the document again."}'); } }); } }); } catch (e) { failed = e; }
  ok(failed && /could not be kept just now/.test(failed.message), '5 none kept: the server\'s own sentence', failed && failed.message);
  var CLIENT = fs.readFileSync(path.join(ROOT, 'ai-docs-client.js'), 'utf8');
  ok(/if \(big && !pics\) return fail\(/.test(CLIENT) && /pdfReadBytes: 100 \* MB/.test(CLIENT) && /if \(!big\) doc\.data = base64Of\(buf\);/.test(CLIENT) && /new Uint8Array\(buf\.slice\(0\)\)/.test(CLIENT),
    '5 the reader: over 10 MB refused on every page but the editor\'s, which reads it here (up to 100 MB) and sends its words; PDF.js gets its own copy of the bytes');
  /* pdf-reader.js: once, from this site, no eval, nothing fetched */
  var READER = fs.readFileSync(path.join(ROOT, 'pdf-reader.js'), 'utf8');
  var rwin = { document: null };
  vm.runInNewContext(READER, { window: rwin });
  var R = rwin.RevampPdf;
  ok(R.OPTIONS.isEvalSupported === false && R.OPTIONS.disableAutoFetch === true && R.OPTIONS.disableStream === true && R.OPTIONS.disableRange === true && R.OPTIONS.enableXfa === false &&
    !/standardFontDataUrl|cMapUrl|wasmUrl|https?:\/\//.test(READER.replace(/\/\*[\s\S]*?\*\//g, '')), '5 PDF.js opens a PDF with no code compiled from it and nothing fetched from anywhere');
  ok(R.LIB === '/assets/vendor/pdfjs/pdf-4.10.38.min.js' && R.WORKER === '/assets/vendor/pdfjs/pdf.worker-4.10.38.min.js', '5 the library and its worker from this site');
  var access = require('./access');
  ok(fs.existsSync(path.join(ROOT, R.LIB)) && fs.existsSync(path.join(ROOT, R.WORKER)) && /Apache License/.test(fs.readFileSync(path.join(ROOT, 'assets/vendor/pdfjs/LICENSE.txt'), 'utf8')) &&
    access.isServableFile(R.LIB.slice(1)) && access.isServableFile(R.WORKER.slice(1)) && access.isServableFile('pdf-reader.js') && access.isServableFile('ai-doc-pictures.js'),
    '5 the vendored module build and worker are there, licence kept, and served, with the two scripts that use them');
  ok(fs.readFileSync(path.join(ROOT, R.LIB), 'utf8').indexOf('"4.10.38"') !== -1 && fs.readFileSync(path.join(ROOT, R.WORKER), 'utf8').indexOf('"4.10.38"') !== -1, '5 the module build and its worker are 4.10.38, as pinned');
  ok(!fs.existsSync(path.join(ROOT, 'assets/vendor/pdfjs/pdf.min.js')) && !fs.existsSync(path.join(ROOT, 'assets/vendor/pdfjs/pdf.worker.min.js')), '5 the older copy (3.11.174, which compiled fonts with eval by default) is gone');
  var TOOLS = fs.readFileSync(path.join(ROOT, 'edit-event-speaker-tools.js'), 'utf8');
  ok(/s\.src = '\/pdf-reader\.js';/.test(TOOLS) && /return pdfReader\(\)\.then\(function \(R\) \{ return R\.open\(bytes\); \}\)/.test(TOOLS) && !/getDocument\(\{ data: bytes \}\)/.test(TOOLS) && !/pdf\.min\.js/.test(TOOLS),
    '5 the speaker tools read brochures through the same loader, with the same safe options');
  /* the rework prompt: a supplied picture's frame takes its shape */
  var GEN = fs.readFileSync(path.join(__dirname, 'api-generate.js'), 'utf8');
  ok(/var one = w >= 1 && w <= 20000 && h >= 1 && h <= 20000 \? \{ n: n, token: token, w: w, h: h \} : \{ n: n, token: token \};\s*if \(frame\) one\.frame = pictureShape\.frameText\(frame\);\s*supplied\.push\(one\);/.test(GEN) &&
    /Where a picture\\'s size is given, give its frame that shape \(CSS aspect-ratio: width \/ height/.test(GEN) && /never stretched or squashed/.test(GEN),
    '5 a rework is told a document picture\'s size and gives its frame that shape, filled by cropping');
  var UI = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
  ok(/var s = sizes\[n\];\s*if \(s && s\.w && s\.h && !\(isNew && np\.placement === 'background'\)\) \{ one\.w = s\.w; one\.h = s\.h; \}/.test(UI) && /canPlaceDocPictures: true,/.test(UI) &&
    /aiPictureRules\.docPicturesOf\(result\.docPictures, attached\.length, eventId\)/.test(UI) && /if \(p\.w && p\.h\) sizes\[p\.n\] = \{ w: p\.w, h: p\.h \};/.test(UI),
    '5 the editor sends a document picture\'s size with the rework, says it can place them, and maps each number to its address');
  /* the owner's complaint (16 Nov 2026): "AI has created a square image for a rectangular placeholder" — a new picture a
     rework puts in is measured once made, and its size goes with the rework, so the frame takes the picture's shape */
  ok(/return pictureSize\(madePic\.url\)\.then\(function \(s\) \{ if \(s\) sizes\[np\.n\] = s; \}\);/.test(UI) && /function pictureSize\(url\) \{[\s\S]{0,400}PICTURE_SIZE_MS[\s\S]{0,300}naturalWidth/.test(UI),
    '5 a new picture is measured once made, and a rework that puts it in is given its size');

  if (failures.length) { console.error('doc-pictures: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('doc-pictures: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (e) { console.error('CRASH', e && e.stack || e); process.exit(1); });
