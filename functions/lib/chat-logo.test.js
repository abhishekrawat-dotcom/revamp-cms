/* node functions/lib/chat-logo.test.js — ETB2B AI and the event's logo, and ETB2B's top bar and footer (owner, 19 Nov
   2026, on TechGig Pro: "Create a logo unit by adding a Pro word in this logo and replace it with the current image" with
   a link to the TechGig logo was answered by a rework of the banner that showed the TechGig website's own file with "Pro"
   typed beside it; on a test copy the same message reworked ETB2B's top bar instead).
   Checks: lib/chat-logo.js (which picture, the link only as the owner wrote it, the words drawn into ONE picture kept with
   the event, never under generated/…-logo-unit, an SVG that could run refused, the logo shown on grey); the chat route
   (lib/api-chat.js) with the model stubbed: the top bar and footer never changed, a word changed everywhere still
   changed in the event's own sections, the logo tool offered only to an editor that can put the logo in, the new logo
   made and answered, a link the owner never wrote refused, the logo picture shown to the model, never its alt text; and
   the editor (editor-template-ui.js): the logo put in, every rework of the banner keeping its logo. No network, nothing
   paid for. Exits 1 on any failure. */
'use strict';
var fs = require('fs'), path = require('path');
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
var ROOT = path.join(__dirname, '..', '..');
var LOGO_PNG = fs.readFileSync(path.join(ROOT, 'templates', '_shared', 'img', 'portals', 'techmonk.png'));
var FONT_TTF = fs.readFileSync(path.join(__dirname, 'fixtures', 'logo-unit', 'playfair-display-700-subset.ttf'));

/* ---------- the stubs: Firestore and Storage in memory, the model, the network ---------- */
function fakeFb() {
  var docs = {}, seq = 0, files = {};
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { if (!(o && o.merge) || !docs[p]) docs[p] = docs[p] && o && o.merge ? docs[p] : {}; Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p, order, lim) {
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(12, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(12, '0')); docs[r.path] = clone(data); return Promise.resolve(r); },
      where: function () { return colRef(p, order, lim); },
      orderBy: function (f, dir) { return colRef(p, { f: f, desc: dir === 'desc' }, lim); },
      limit: function (n) { return colRef(p, order, n); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        if (order) list.sort(function (a, b) { var x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (order.desc ? -1 : 1); });
        if (lim) list = list.slice(0, lim);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (fn) { list.forEach(fn); } });
      } };
  }
  var bucket = { name: 'test-bucket', file: function (p) {
    return { name: p,
      save: function (bytes, o) { files[p] = { bytes: bytes, metadata: (o && o.metadata) || {}, public: false }; return Promise.resolve(); },
      makePublic: function () { if (!files[p]) return Promise.reject(new Error('No such object')); files[p].public = true; return Promise.resolve(); } };
  } };
  return { db: { collection: function (n) { return colRef(n); }, runTransaction: function (fn) { return Promise.resolve(fn({ get: function (r) { return r.get(); }, set: function (r, d, o) { r.set(d, o); }, update: function (r, d) { r.update(d); } })); } },
    bucket: bucket, docs: docs, files: files,
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, name: 'Asha Rao', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
}
var FB = fakeFb();
function stub(name, exports) { var id = require.resolve(name); require.cache[id] = { id: id, filename: id, loaded: true, exports: exports }; }
stub('./firebase', { getFirebase: function () { return FB; } });
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var EV = 'qa-chat-logo', OWN = 'https://storage.googleapis.com/test-bucket/events/' + EV + '/';
var CURRENT = OWN + 'generated/20261119072556-logo-unit.jpg';
var LINK = 'https://st.etb2bimg.com/Themes/Release/images/techgig-logo.png';
var fetched = [];
var realSafe = require('./safe-fetch');
stub('./safe-fetch', Object.assign({}, realSafe, { safeFetch: function (url) {
  url = String(url); fetched.push(url);
  if (/^https:\/\/fonts\.googleapis\.com\/css2\?/.test(url)) return Promise.resolve({ status: 200, body: Buffer.from("@font-face{font-family:'Inter';src:url(https://fonts.gstatic.com/s/test/v1/font.ttf) format('truetype')}") });
  if (/^https:\/\/fonts\.gstatic\.com\//.test(url)) return Promise.resolve({ status: 200, body: FONT_TTF });
  if (url === LINK || url === CURRENT) return Promise.resolve({ status: 200, body: LOGO_PNG });
  return Promise.resolve({ status: 404, body: Buffer.from('') });
} }));
var llm = require('./llm');
var prompts = [], schemas = [], answers = [], imagesSent = [];
llm.callJson = function (prompt, schema, opts) { prompts.push(prompt); schemas.push(schema); imagesSent.push((opts && opts.images) || []); return Promise.resolve({ parsed: answers.shift() }); };
var api = require('./api');
var chatLogo = require('./chat-logo');

function call(body) {
  return new Promise(function (resolve) {
    var req = { method: 'POST', url: '/api/chat-edit', headers: { host: 'localhost', authorization: 'Bearer asha' }, socket: {}, rawBody: Buffer.from(JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var j = null; try { j = JSON.parse(String(b || '')); } catch (e) { /* not json */ } resolve({ status: res.statusCode, body: j }); } };
    api.handleApi(req, res);
  });
}
function answer(o) {
  return Object.assign({ kind: 'edit', summary: '', design: {}, textEdits: [], sectionEdits: [], sectionOps: [], newSections: [], newForms: [], ctaLinks: [], formEmbeds: [], goTo: '', intent: 'change logo',
    logoUnit: { picture: 0, link: '', words: '', place: '', style: '' } }, o);
}
FB.docs['events/' + EV] = { name: 'TechGig Pro', designPlan: { design: { mode: 'light', themeColor: '#c8102e' } } };
var SECTIONS = [
  { id: 'nav', name: 'Top bar', texts: ['TechGig Pro 2026', 'Overview', 'Register'], shared: true },
  { id: 'hero', name: 'Hero', texts: ['TechGig Pro 2026', 'Register Now'], shows: 1, logoUnit: { present: true, src: CURRENT, tone: 'light', text: 'TechGig Pro' } },
  { id: 'overview', name: 'Overview', texts: ['A membership for engineers, 2026'] },
  { id: 'footer', name: 'Footer', texts: ['© 2026 ETB2B'], shared: true }
];
function body(o) { return Object.assign({ eventId: EV, instruction: 'x', sections: clone(SECTIONS), design: { themeColor: '#c8102e', headingFont: 'Inter' }, canPlaceLogo: true }, o); }

(async function () {
  /* ---------- lib/chat-logo.js ---------- */
  ok(chatLogo.aboutLogo('Create a logo unit by adding a Pro word') && chatLogo.aboutLogo('make our lock-up bigger') && !chatLogo.aboutLogo('change the banner picture'), 'what is about a logo');
  ok(JSON.stringify(chatLogo.linksIn('use this logo ' + LINK + '. thanks')) === JSON.stringify([LINK]), 'a link as the owner wrote it, without the full stop after it', chatLogo.linksIn('use this logo ' + LINK + '.'));
  var ctx = { instruction: 'add Pro to this logo ' + LINK, earlier: [], attachments: [OWN + 'media/up-1.png', 'https://example.org/x.png'], ownAttached: 2, ownPrefix: OWN, current: CURRENT };
  ok(chatLogo.cleanAsk({ picture: 0, link: '', words: '' }, ctx) === null, 'nothing asked: the tool is not used');
  var a = chatLogo.cleanAsk({ picture: 0, link: LINK, words: '  Pro ', place: 'right', style: 'plain' }, ctx);
  ok(a && a.ask && a.ask.source === LINK && a.ask.from === 'link' && a.ask.words === 'Pro', 'a link the owner wrote is used, the words as given', a);
  var b = chatLogo.cleanAsk({ picture: 0, link: 'https://evil.example/logo.png', words: 'Pro' }, ctx);
  ok(b && b.reply === chatLogo.SAY.notInMessage, 'a link the owner never wrote is not fetched', b);
  ok(chatLogo.cleanAsk({ picture: 1, link: '', words: '' }, ctx).ask.source === OWN + 'media/up-1.png', 'an attached picture of this event\'s');
  ok(chatLogo.cleanAsk({ picture: 2, link: '', words: '' }, ctx).reply === chatLogo.SAY.notAttached, 'an attached picture from anywhere else is not used');
  var c = chatLogo.cleanAsk({ picture: 0, link: '', words: 'Pro' }, ctx);
  ok(c.ask.source === CURRENT && c.ask.from === 'current', 'words alone go into the logo there now', c);
  ok(chatLogo.cleanAsk({ picture: 0, link: '', words: 'Pro' }, Object.assign({}, ctx, { current: '' })).reply === chatLogo.SAY.noPicture, 'a logo set in type: asked for the picture');
  ok(chatLogo.cleanAsk({ picture: 0, link: '', words: '<script>Pro</script> and a very long tail of words' }, ctx).ask.words.indexOf('<') === -1, 'the words are plain, and short');

  /* make(), with the tools stubbed: the svg drawn, the file kept with the event */
  var drawn = [], stored = [];
  chatLogo.wire({
    rasterise: function (svg, o) { drawn.push({ svg: svg, o: o }); return Promise.resolve({ png: Buffer.from('89504e47', 'hex'), width: 1000, height: 240 }); },
    storePublicPicture: function (fb, p, bytes, type) { stored.push({ path: p, type: type }); return Promise.resolve('https://storage.googleapis.com/test-bucket/' + p); },
    fetchUnitFont: function (family) { return Promise.resolve(family === 'Inter' ? { family: 'Inter', ttfBase64: 'AAAA', metrics: { unitsPerEm: 1000, capHeight: 700, advanceOf: function () { return 600; } } } : null); },
    svgCouldRun: function (t) { return /<script/i.test(t); }
  });
  var made = await chatLogo.make(a.ask, { fb: FB, eventId: EV, design: { headingFont: 'Missing Font', themeColor: '#c8102e' }, tone: 'light' });
  ok(made.logo && made.logo.width === 1000 && made.logo.words === 'Pro', 'the logo with Pro is made', made);
  ok(stored.length === 1 && /^events\/qa-chat-logo\/media\/chat-logo-\d{14}\.png$/.test(stored[0].path) && stored[0].type === 'image/png', 'ONE transparent PNG kept with the event, under media/ (never generated/…-logo-unit, which the editor may swap back)', stored);
  var svg = drawn[0] && drawn[0].svg;
  ok(svg && /<image [^>]*href="data:image\/png;base64,/.test(svg) && />Pro<\/text>/.test(svg) && drawn[0].o.clear === true && drawn[0].o.font.family === 'Inter',
    'the picture itself is drawn in (never a link to another site), the words in the site\'s font (else Inter), on a see-through ground', svg && svg.slice(0, 300));
  ok(/fill="#c8102e"/.test(svg), 'the words in the site\'s colour on a light banner');
  drawn.length = 0;
  await chatLogo.make({ source: LINK, from: 'link', words: 'Pro', place: 'below', style: 'badge' }, { fb: FB, eventId: EV, design: { themeColor: '#c8102e' }, tone: 'dark' });
  ok(/<rect [^>]*fill="#c8102e"/.test(drawn[0].svg) && /fill="#ffffff">Pro</.test(drawn[0].svg), 'a badge: the words in white on the site\'s colour', drawn[0].svg.slice(-400));
  stored.length = 0;
  var plain = await chatLogo.make({ source: LINK, from: 'link', words: '' }, { fb: FB, eventId: EV, design: {}, tone: 'light' });
  ok(plain.logo && /media\/chat-logo-\d{14}\.png$/.test(stored[0].path) && plain.logo.width === 560, 'no words: the picture as it is, a copy kept with the event', stored);
  /* an SVG logo that wraps a PNG labelled "data:img/png" (TechGig's own file): the label put right, the SVG drawn to a PNG
     on its own before the words go beside it (inside the lock-up's SVG, the picture it wraps was left blank) */
  ok(chatLogo._plainSvg('<image xlink:href="data:img/png;base64,AAA"/><image href=\'data:img/jpg;base64,BBB\'/>') === '<image xlink:href="data:image/png;base64,AAA"/><image href=\'data:image/jpeg;base64,BBB\'/>', 'a mislabelled picture inside an SVG is labelled right');
  var make = chatLogo.make;
  ok(/var flat = pic\.info\.type !== 'svg' \? Promise\.resolve\(pic\) : T\.rasterise\(pic\.bytes\.toString\('utf8'\), \{ clear: true, width: 1000 \}\)/.test(fs.readFileSync(path.join(__dirname, 'chat-logo.js'), 'utf8')), 'an SVG logo is drawn on its own first');
  var bad = await chatLogo.make({ source: 'https://st.etb2bimg.com/missing.png', from: 'link', words: 'Pro' }, { fb: FB, eventId: EV, design: {} });
  ok(bad.reply === chatLogo.SAY.fetch, 'a link that does not answer: said plainly', bad);

  /* the logo as the model is shown it: on grey, only from this event or ETB2B's picture servers */
  var shown = await chatLogo.readCurrent(CURRENT, { ownPrefix: OWN });
  ok(shown && shown.mimeType === 'image/png' && shown.data.length > 100, 'the logo unit is shown to the model as a picture', shown && shown.mimeType);
  ok((await chatLogo.readCurrent('https://example.org/logo.png', { ownPrefix: OWN })) === null, 'a picture from anywhere else is never fetched for it');

  /* ---------- the chat route ---------- */
  answers.push(answer({ summary: 'I\'ve reworked the top bar with the new logo.', sectionEdits: [{ sectionId: 'nav', instruction: 'replace the logo with TechGig Pro', pictures: [] }],
    textEdits: [{ sectionId: 'footer', find: '© 2026 ETB2B', replace: '© TechGig' }], sectionOps: [{ op: 'hide', sectionId: 'footer', beforeSectionId: '' }] }));
  var r = await call(body({ instruction: 'make the top bar show TechGig Pro' }));
  ok(r.status === 200 && r.body.kind === 'reply' && !r.body.sectionEdits.length && !r.body.textEdits.length && !r.body.sectionOps.length &&
    /ETB2B's top bar and footer are the same on every ETB2B event site/.test(r.body.summary) && /Nothing on the page changed/.test(r.body.summary),
    'the top bar and footer are never reworked, reworded or hidden; the owner is told why, not the model\'s summary', r.body);
  ok(/ETB2B'S TOP BAR AND FOOTER/.test(prompts[0]) && /"etb2bShared": true/.test(prompts[0]), 'the prompt says so, and marks them');

  answers.push(answer({ summary: 'Changed 2026 to 2027.', textEdits: [{ sectionId: 'nav', find: '2026', replace: '2027' }, { sectionId: 'overview', find: '2026', replace: '2027' }, { sectionId: 'hero', find: '2026', replace: '2027' }] }));
  r = await call(body({ instruction: 'change 2026 to 2027 everywhere' }));
  ok(r.body.kind === 'edit' && r.body.textEdits.length === 2 && !r.body.textEdits.some(function (t) { return t.sectionId === 'nav'; }) && !(r.body.skipped || []).some(function (l) { return /top bar/.test(l); }),
    'a word changed everywhere: changed in the event\'s own sections, the top bar left, nothing said about it', r.body);

  /* the logo: the TechGig Pro message */
  var said = 'Create a logo unit by adding a Pro word in this logo ' + LINK + ' and replace it with the current image';
  answers.push(answer({ summary: 'I\'ve made the TechGig logo with Pro and put it in the banner.', logoUnit: { picture: 0, link: LINK, words: 'Pro', place: 'right', style: 'plain' } }));
  var before = Object.keys(FB.files).length;
  r = await call(body({ instruction: said }));
  var schema = schemas[schemas.length - 1], prompt = prompts[prompts.length - 1], imgs = imagesSent[imagesSent.length - 1];
  ok(schema.properties.logoUnit && schema.required.indexOf('logoUnit') !== -1 && /THE LOGO\./.test(prompt) && /so you CAN use a link the owner gives/.test(prompt), 'the logo tool is offered, and links can be used', schema.required);
  ok(imgs.length === 1 && /Just before the screenshots of the page comes one more picture: the banner's logo unit/.test(prompt) && !/TechGig Pro\)/.test(prompt.slice(prompt.indexOf('PAGE FACTS'))),
    'the model is shown the logo itself, never told what its alt text says', imgs.length);
  ok(r.body.kind === 'edit' && r.body.logoUnit && /^https:\/\/storage\.googleapis\.com\/test-bucket\/events\/qa-chat-logo\/media\/chat-logo-\d{14}\.png$/.test(r.body.logoUnit.url) && r.body.logoUnit.words === 'Pro',
    'the new logo is made, kept with the event, and answered for the editor to put in', r.body);
  var newFiles = Object.keys(FB.files).slice(before);
  ok(newFiles.length === 1 && FB.files[newFiles[0]].public && FB.files[newFiles[0]].metadata.contentType === 'image/png' && FB.files[newFiles[0]].bytes.slice(1, 4).toString() === 'PNG',
    'one PNG stored, drawn for real (resvg)', newFiles);
  ok(fetched.indexOf(LINK) !== -1, 'the link was downloaded, never shown from the other site');

  answers.push(answer({ summary: 'Done.', logoUnit: { picture: 0, link: 'https://elsewhere.example/logo.png', words: 'Pro', place: 'right', style: 'plain' } }));
  r = await call(body({ instruction: 'add Pro to the logo' }));
  ok(r.body.kind === 'reply' && r.body.summary === chatLogo.SAY.notInMessage && !r.body.logoUnit, 'a link the owner never wrote: nothing made, said why', r.body);

  answers.push(answer({ summary: 'Done.', logoUnit: { picture: 0, link: '', words: 'Pro', place: 'right', style: 'plain' } }));
  r = await call(body({ instruction: 'add Pro to the logo', canPlaceLogo: false }));
  ok(!schemas[schemas.length - 1].properties.logoUnit && !r.body.logoUnit && /never ETB2B's logo in the top bar/.test(prompts[prompts.length - 1]),
    'an editor that cannot put a logo in is never offered the tool, and still told what "the logo" is', r.body);

  answers.push(answer({ summary: 'Moved the overview.', textEdits: [{ sectionId: 'overview', find: 'A membership', replace: 'One membership' }] }));
  r = await call(body({ instruction: 'shorten the overview' }));
  ok(imagesSent[imagesSent.length - 1].length === 0, 'a message that is not about the logo: the logo picture is not fetched or sent');

  /* ---------- the editor ---------- */
  var ED = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
  ok(/canPlaceLogo: true,/.test(ED) && /if \(pinnedSection\(sec\)\) out\.shared = true;/.test(ED), 'the editor offers to put a logo in, and marks the top bar and footer');
  ok(/logoUnit = \{ present: true, src: im \?/.test(ED) && !/var said = \(im && im\.getAttribute\('alt'\)\)/.test(ED), 'the logo unit is sent as its picture\'s address, never its alt text');
  ok(/if \(logo\) placeChatLogo\(changedEls, done, said\);/.test(ED) && /canvas\.setPicture\(pic, logo\.url\);/.test(ED) && /unit\.removeAttribute\('data-rv-logo-note'\);/.test(ED) && /darkCopyFor\(u\)/.test(ED),
    'the new logo goes into the logo unit, its old note goes, its copy for a dark background is asked for');
  ok(/var unitGuard = guard \|\| !!job\.sec\.querySelector\('\[data-rv-logo-unit\]'\);/.test(ED) && /if \(unitGuard && !sameLogoUnit\(unitBefore, logoUnitsState\(\)\)\) putBack\(/.test(ED),
    'every rework of the banner keeps its logo exactly as it is');
  ok(/var notShared = function \(x\)/.test(ED) && /\.filter\(notShared\)/.test(ED), 'the editor also leaves out anything in the top bar or footer');

  if (failures.length) { process.stderr.write('chat-logo: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ') + '\n'); process.exit(1); }
  process.stdout.write('chat-logo: all ' + checks + ' checks passed\n');
  process.exit(0);
})().catch(function (e) { process.stderr.write('chat-logo: crashed — ' + (e && e.stack || e) + '\n'); process.exit(1); });
