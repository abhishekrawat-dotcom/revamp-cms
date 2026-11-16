/* node functions/lib/deck-follow.test.js — Create Event follows the owner's own presentation (CREATE-FROM-DECK.md;
   owner, 16 Nov 2026, ET DAVOS 2027: "design it according to the uploaded presentation"), and the fixes every Create
   Event run gets, through the real router (lib/api.js handleApi), an in-memory Firestore and Storage, and the models
   scripted (no AI call is made, nothing is paid for):
     1. the owner's words and the switch: the matcher on the plan's table, the browser's copy agreeing; only a tick
        follows the deck; the deck's abstract motifs only; its sans heading type; the record (F5);
     2. Create Event's page: the switch starts unticked, the photo-rights line, the hint that points to the switch, the
        requests carry the switch and the instructions, the photos row, no bare "ET", the key slides, one slide renderer;
     3. extract-brief: the model that sees the slides is told the instructions and that the deck is followed, and reads
        it as a design (its design, fonts and pages kept);
     4. the photos: stored under brief-photos/, one History line; POST /api/brief-photos refuses another event's or
        folder's address, too many, a slide that is not a JPEG and another run's brief before anything is paid for;
        checks six to a call; keeps the list beside the brief (never inside what the prompts show), the slides private;
     5. plan-structure with the switch on: the deck is the reference it is modelled on, its photos and slides go with the
        plan, the photo lines replace ETB2B's picture rules, no serif rule; the banner is the deck's dusk photo cut 16:9,
        the deck's sans and white page kept, each section its own page's photo in its frame's shape, held photos never
        placed, one gap made, checked and made again (F7), its flags taken out (F3), its kind agreeing (F2); the writer
        is told the owner's photos, words and motifs, and the previous-edition note's opt-out (F1);
     6. the switch off: today's prompt, schema and serif, and the record "deck";
     7. every run: F2 settleKind and newStandardPictures, F3 scrubScene, F6 the run-on colour of a JPEG and a WebP, F4.
   Needs sharp (it says so and passes without it). Exits 1 listing every failure. */
'use strict';
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- an in-memory Firestore and Storage: equality where(), batches, transactions, deletes, FieldValue.delete ---------- */
var DEL = require('firebase-admin').firestore.FieldValue.delete();
function isDel(v) { return !!v && typeof v === 'object' && typeof v.isEqual === 'function' && v.isEqual(DEL); }
function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function fakeFb() {
  var docs = {}, files = {}, seq = 0;
  function write(target, data, merge) {
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      if (isDel(v)) { delete target[k]; return; }
      if (merge && isPlain(v)) { if (!isPlain(target[k])) target[k] = {}; write(target[k], v, true); }
      else target[k] = isPlain(v) || Array.isArray(v) ? clone(v) : v;
    });
  }
  function setPath(target, key, v) {
    var parts = key.split('.'), t = target;
    for (var i = 0; i < parts.length - 1; i++) { if (!isPlain(t[parts[i]])) t[parts[i]] = {}; t = t[parts[i]]; }
    if (isDel(v)) delete t[parts[parts.length - 1]]; else t[parts[parts.length - 1]] = isPlain(v) || Array.isArray(v) ? clone(v) : v;
  }
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { var merge = !!(o && o.merge); if (!merge || !docs[p]) docs[p] = merge && docs[p] ? docs[p] : {}; write(docs[p], data, merge); return Promise.resolve(); },
      update: function (data) {
        if (!docs[p]) return Promise.reject(new Error('NOT_FOUND: ' + p));
        Object.keys(data).forEach(function (k) { setPath(docs[p], k, data[k]); });
        return Promise.resolve();
      },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p, order, lim, filters) {
    filters = filters || [];
    return { path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(16, '0')))); },
      add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(16, '0')); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function (f, dir) { return colRef(p, { f: f, desc: dir === 'desc' }, lim, filters); },
      limit: function (n) { return colRef(p, order, n, filters); },
      where: function (f, op, v) { if (op !== '==') throw new Error('only == here'); return colRef(p, order, lim, filters.concat([[f, v]])); },
      select: function () { return colRef(p, order, lim, filters); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        list = list.filter(function (s) { return filters.every(function (f) { return s.data()[f[0]] === f[1]; }); });
        if (order) list = list.filter(function (s) { return s.data()[order.f] !== undefined; }).sort(function (a, b) { var x = a.data()[order.f], y = b.data()[order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (order.desc ? -1 : 1); });
        if (lim) list = list.slice(0, lim);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
      } };
  }
  function runTransaction(fn) {
    var writes = [];
    var tx = {
      get: function (ref) { return ref.get(); },
      set: function (ref, data, o) { writes.push(function () { return ref.set(data, o); }); return tx; },
      update: function (ref, data) { writes.push(function () { return ref.update(data); }); return tx; },
      delete: function (ref) { writes.push(function () { return ref.delete(); }); return tx; }
    };
    return Promise.resolve(fn(tx)).then(function (out) { return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()).then(function () { return out; }); });
  }
  function batch() {
    var writes = [];
    var b = {
      set: function (ref, data, o) { writes.push(function () { return ref.set(data, o); }); return b; },
      update: function (ref, data) { writes.push(function () { return ref.update(data); }); return b; },
      delete: function (ref) { writes.push(function () { return ref.delete(); }); return b; },
      commit: function () { return writes.reduce(function (pr, w) { return pr.then(w); }, Promise.resolve()); }
    };
    return b;
  }
  function fileObj(path) {
    return { name: path, metadata: { contentType: 'application/octet-stream' },
      save: function (buf) { files[path] = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)); return Promise.resolve(); },
      makePublic: function () { return Promise.resolve(); },
      download: function () { return files[path] ? Promise.resolve([files[path]]) : Promise.reject(Object.assign(new Error('No such object: ' + path), { code: 404 })); },
      delete: function () { delete files[path]; return Promise.resolve(); },
      copy: function (target) { files[target.name] = files[path]; return Promise.resolve(); },
      getMetadata: function () { return files[path] ? Promise.resolve([{ updated: new Date().toISOString() }]) : Promise.reject(Object.assign(new Error('nf'), { code: 404 })); },
      exists: function () { return Promise.resolve([!!files[path]]); } };
  }
  var bucket = { name: 'test-bucket', file: fileObj,
    getFiles: function (o) { var pre = (o && o.prefix) || ''; return Promise.resolve([Object.keys(files).filter(function (k) { return k.indexOf(pre) === 0; }).map(fileObj)]); },
    deleteFiles: function (o) { var pre = (o && o.prefix) || ''; Object.keys(files).forEach(function (k) { if (k.indexOf(pre) === 0) delete files[k]; }); return Promise.resolve(); } };
  return { db: { collection: function (n) { return colRef(n); }, runTransaction: runTransaction, batch: batch,
    recursiveDelete: function (ref) { Object.keys(docs).forEach(function (k) { if (k === ref.path || k.indexOf(ref.path + '/') === 0) delete docs[k]; }); return Promise.resolve(); } },
    bucket: bucket, docs: docs, files: files,
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
process.env.ACCESS_CONFIG_DOC = 'config/test-deck-access';
FB.docs['config/test-deck-access'] = { defaultRole: 'editor', members: {} };
var SAFE_FETCH = require.resolve('./safe-fetch');
require.cache[SAFE_FETCH] = { id: SAFE_FETCH, filename: SAFE_FETCH, loaded: true, children: [], paths: [],
  exports: Object.assign({}, require('./safe-fetch'), { safeFetch: function (url) { return Promise.reject(new Error('no network in this test: ' + url)); } }) };
global.fetch = function (url) { return Promise.reject(new Error('no network in this test: ' + url)); };
require('./pictures').storeVariants = function () { return Promise.resolve(null); };

var sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 700) : '')); }
function finish() {
  if (failures.length) { console.error('deck-follow: ' + failures.length + ' of ' + checks + ' checks FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('deck-follow: all ' + checks + ' checks passed');
  process.exit(0);
}
if (!sharp) { console.log('deck-follow: skipped — no picture library (sharp) here'); process.exit(0); }

/* ---------- the models, scripted per route; every prompt, schema and picture kept ---------- */
var llm = require('./llm');
var asked = [], scripted = {};
llm.callJson = function (prompt, schema, opts) {
  var route = (opts && opts.route) || '';
  asked.push({ route: route, prompt: String(prompt || ''), schema: schema, images: (opts && opts.images) || [] });
  var next = scripted[route] && scripted[route].length ? scripted[route].shift() : null;
  if (typeof next === 'function') next = next(String(prompt || ''));
  if (!next) return Promise.resolve({ error: 'No answer scripted for ' + route + '.', code: 'ai-unavailable', status: 502 });
  return Promise.resolve({ parsed: clone(next), provider: 'claude', model: 'claude-stub', usage: { inputTokens: 10, outputTokens: 10, usd: 0.001, provider: 'claude' } });
};
var gemini = require('./gemini');
var imageCalls = [], PIC = null;
gemini.callGeminiImage = function (prompt, o) { imageCalls.push({ prompt: String(prompt), opts: o || {} }); return Promise.resolve({ mimeType: 'image/png', base64: PIC, usage: { pictures: 1, provider: 'gemini' } }); };

var api = require('./api');
var H = api._testHooks;
H.buildDesignPlanPrompt;                     // wires lib/api-generate.js
var G = require('./api-generate')._testHooks;
var DF = require('./deck-follow');
var genDesign = require('./gen-design');
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');

function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'content-type': 'application/json', authorization: 'Bearer ' + (who || 'asha') };
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body === undefined ? '' : JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b === undefined ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j }); } };
    api.handleApi(req, res);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }
var made = {};
var fileOf = FB.bucket.file;
FB.bucket.file = function (p) { var f = fileOf(p), mp = f.makePublic; f.makePublic = function () { made[p] = 1; return mp.apply(f, arguments); }; return f; };

var EV = 'qa-pdeck-run', RUN = 'run-deck-1';
var OWN = 'https://storage.googleapis.com/test-bucket/events/' + EV + '/';
FB.docs['events/' + EV] = { name: 'ET DAVOS 2027 QA', category: 'conference', createdAt: '2026-11-16T00:00:00Z', start: '2027-01-16', end: '2027-01-21', venue: 'Zurich' };

/* the brief Haiku reads from the Davos deck (its look as a design, its pages) */
var LOOK = { designed: 'yes', colours: [{ hex: '#d62d20', role: 'primary' }, { hex: '#ffffff', role: 'background' }, { hex: '#1a1a1a', role: 'background' }, { hex: '#1f2a44', role: 'accent' }],
  mode: 'mixed', headingStyle: 'Bold condensed italic sans in red, all-caps', bodyStyle: 'Clean geometric sans', imagery: 'Alpine Davos and Swiss landscapes, lit town at dusk',
  motifs: 'Red dot grid in top-left corner, ET red logo box, red Swiss cross badge bottom-right, concentric arc rings', ipName: 'ET Immersions', ipTagline: 'Global Experiential Learning for Leaders',
  design: { layoutStyle: 'Full-bleed photographs under dark veils, big condensed italic titles', heroStyle: 'A full-bleed photo with the lock-up', sectionPattern: ['The Week — photo left, title right', 'The Davos Experience — full-bleed dusk photo', 'ET Studio — lounge photo beside the words'], imageryStyle: 'Large Alpine photographs', typography: 'Bold condensed italic sans', density: 'airy' },
  headingFont: 'Barlow Condensed', bodyFont: 'Inter' };
var BRIEF = { theme: 'A curated week in Davos.', audience: 'Business leaders', tone: 'Premium', tracks: [], speakerHints: [], sponsorHints: [], keyMessages: [], inferredCategory: 'business leadership',
  visualIdentity: LOOK, deckSections: [{ title: 'The Week', items: ['For a few days, business, capital, technology and ideas occupy the same small Alpine town.'] }, { title: 'What You Take Back', items: ['Not Just Photographs'] }],
  deckPages: [{ page: 1, kind: 'cover', title: 'ET @Davos 2027', layout: 'full-bleed photo with the lock-up', photo: 'full-bleed' }, { page: 2, kind: 'content', title: 'The Week', layout: 'valley photo, red title', photo: 'full-bleed' },
    { page: 3, kind: 'content', title: 'The Davos Experience', layout: 'dusk town photo', photo: 'full-bleed' }, { page: 5, kind: 'content', title: 'ET Studio', layout: 'lounge photo left, red title right', photo: 'split' },
    { page: 13, kind: 'content', title: 'The Invitation', layout: 'lake at sunset', photo: 'full-bleed' }, { page: 14, kind: 'appendix', title: 'Switzerland at a Glance', layout: 'peaks', photo: 'full-bleed' }],
  ownerPoints: { tagline: '', usp: '', audience: '', industry: '', level: '', format: '', mainAction: '', scale: '', look: '', mustAvoid: '' } };
/* the photos the reader keeps (a part of the deck) and what a look at each shows */
var PHOTOS = [[2, 1600, 900, 'landscape', 'none', 0, 0, 'none', 0], [3, 1600, 900, 'townscape', 'none', 0, 0, 'none', 1], [5, 1600, 900, 'venue', 'none', 0, 0, 'none', 0], [6, 1600, 901, 'townscape', 'none', 0, 0, 'none', 0],
  [7, 949, 782, 'sign-or-poster', 'none', 1, 1, 'prominent', 0], [9, 1600, 900, 'landscape', 'none', 0, 0, 'none', 0], [11, 1600, 903, 'people', 'few', 0, 0, 'none', 0], [13, 1600, 899, 'landscape', 'none', 0, 0, 'none', 1],
  [14, 1600, 900, 'landscape', 'none', 0, 0, 'none', 0], [23, 1600, 903, 'sign-or-poster', 'none', 0, 0, 'prominent', 0]];
function classifyAnswer(prompt) {
  var lines = prompt.split('\n').filter(function (l) { return /^\d+\. page \d+, /.test(l); });
  return { photos: lines.map(function (l, k) {
    var m = /^\d+\. page (\d+), (\d+)x(\d+)/.exec(l), page = +m[1];
    var r = PHOTOS.filter(function (x) { return x[0] === page && x[1] === +m[2]; })[0];
    return { n: k + 1, kind: r[3], people: r[4], publicFigure: !!r[5], brand: !!r[6], lettering: r[7], flag: false, calmCentre: !!r[8], about: 'photo of page ' + page };
  }) };
}
function planAnswer() {
  var notes = 'The snowy Davos Promenade at dusk lined with lit pavilion fronts and chalet shopfronts, flags along the street and mountains glowing behind, no people.';
  return { evidence: 'From the deck.', eventDescription: 'A curated week in Davos for business leaders.',
    design: { mood: 'Bold and Alpine.', mode: 'light', themeColor: '#d62d20', accentColor: '#1f2a44', backgroundColor: '#f4f4f4', surfaceColor: '#ffffff', textColor: '#111111', mutedColor: '#444444',
      headingFont: 'Playfair Display', bodyFont: 'Inter', layout: 'Full-bleed photos; headings in bold condensed italic capitals.', cornerRadius: '0', imageStyle: 'Alpine photography at dusk', logoUnit: { before: 'ET', keyword: 'DAVOS', after: '2027', style: 'stacked' },
      heroTagline: 'Global Experiential Learning for Leaders', placeCity: '', placeCues: '', placeMotif: '', heroImage: 'A Swiss valley at dusk with red Swiss flags', heroPhoto: 2 },
    sections: [
      { id: 'overview', kind: 'custom', purpose: 'The week in Davos.', layout: 'photo left, text right', image: '', imageKind: 'place', photo: 1, photos: [], fromPages: [2] },
      { id: 'by-the-numbers', kind: 'custom', purpose: '5 days, 4 nights.', layout: 'one band of four large numbers', image: '', imageKind: 'graphic', photo: 0, photos: [], fromPages: [10] },
      { id: 'what-awaits', kind: 'custom', purpose: 'Four moments: the Davos Experience, ET Studio, 1560 by ET, India @ Davos.', layout: 'a row of four tall photo cards', image: '', imageKind: 'people', photo: 0, photos: [3, 4, 9, 5], fromPages: [3, 5, 6, 7] },
      { id: 'key-discussion-points', kind: 'custom', purpose: 'India @ Davos and its four pillars.', layout: 'a wide picture across the section above a grid of cards', image: notes, imageKind: 'people', photo: 0, photos: [], fromPages: [7] },
      { id: 'agenda', kind: 'sessions', purpose: 'The Swiss Arc.', layout: 'a timeline', image: '', imageKind: 'place', photo: 6, photos: [], fromPages: [10] },
      { id: 'why-join-us', kind: 'custom', purpose: 'Your time fully protected.', layout: 'photo left, text right', image: '', imageKind: 'place', photo: 6, photos: [], fromPages: [8, 9] },
      { id: 'who-should-attend', kind: 'custom', purpose: 'Business leaders, family businesses.', layout: 'icon tiles beside a photo', image: '', imageKind: 'people', photo: 7, photos: [], fromPages: [11] },
      { id: 'closing-cta', kind: 'custom', purpose: 'The invitation: premium Swiss hospitality.', layout: 'a full-width photo band with the buttons over it', image: '', imageKind: 'place', photo: 8, photos: [], fromPages: [13] }
    ] };
}
function byId(list, id) { return (list || []).filter(function (s) { return s.id === id; })[0] || {}; }

(async function main() {
  PIC = (await sharp({ create: { width: 1184, height: 864, channels: 3, background: '#5577aa' } }).png().toBuffer()).toString('base64');

  /* ======================= 1. the owner's words and the switch (pure) ======================= */
  var TABLE = [['design it according to the uploaded presentation', 'on'], ['make it like the PDF', 'on'], ['same look as the deck', 'on'], ['use the photos from the presentation', 'on'],
    ['as per attached ppt', 'on'], ['do not follow the deck\'s design', 'off'], ['don’t use the brochure', 'off'], ['premium and minimal', ''], ['lead with the awards night', ''], ['', '']];
  var CD = {}; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'create-deck.js'), 'utf8'), { window: CD, Promise: Promise });
  TABLE.forEach(function (t) {
    ok(DF.wantsDeck(t[0]) === t[1], '1 wantsDeck "' + t[0] + '"', DF.wantsDeck(t[0]));
    ok(CD.CreateDeck.wantsDeck(t[0]) === DF.wantsDeck(t[0]), '1 the browser\'s copy agrees: "' + t[0] + '"');
  });
  ok(DF.followDeckFor({ followDeck: true }, null) === true && DF.followDeckFor({ followDeck: false }, { followDeck: true }) === false && DF.followDeckFor({}, { followDeck: true }) === true &&
    DF.followDeckFor({ designNotes: 'design it according to the uploaded presentation' }, { followDeck: false }) === false && DF.followDeckFor({}, null) === false,
    '1 only a tick follows the deck: the switch wins, then what the brief recorded; the instructions never do');
  ok(DF.drawableMotifs(LOOK.motifs).join('|') === 'Red dot grid in top-left corner|concentric arc rings', '1 motifs: the dot grid and the arcs, never the ET logo box or the cross badge', DF.drawableMotifs(LOOK.motifs));
  var gf = require('./google-fonts');
  ok(DF.headingFontFor({ model: 'Playfair Display', reader: 'Barlow Condensed', style: LOOK.headingStyle, categoryOf: gf.categoryOf }) === 'Barlow Condensed' &&
    DF.headingFontFor({ model: 'Oswald', reader: 'Barlow Condensed', style: LOOK.headingStyle, categoryOf: gf.categoryOf }) === 'Oswald', '1 a sans deck keeps a sans heading: never Playfair Display');
  ok(JSON.stringify(DF.referenceRecord({ follow: true, deckRef: { briefId: 'b1', fileName: 'd.pdf', design: { a: 1 } }, artDirection: { id: 'x' } })) === JSON.stringify({ type: 'ownDeck', briefId: 'b1', fileName: 'd.pdf', design: { a: 1 }, artDirection: null }) &&
    JSON.stringify(DF.referenceRecord({ follow: false, deckRef: { briefId: 'b1' }, artDirection: { id: 'x' } })) === JSON.stringify({ type: 'deck', briefId: 'b1', artDirection: null }) &&
    DF.referenceRecord({ artDirection: { id: 'premium-serif' }, artUsed: true }).artDirection === 'premium-serif' && DF.referenceRecord({ artDirection: { id: 'x' }, artUsed: false }).artDirection === null,
    '1 F5: the record says what the site was modelled on, the art direction only when it was in the prompt');

  /* ======================= 2. Create Event's page ======================= */
  var CE = fs.readFileSync(path.join(ROOT, 'create-event.html'), 'utf8');
  ok(/<input type="checkbox" id="gb-deck-follow">/.test(CE) && /followDeck: false \}/.test(CE) && !/gb-deck-follow"[^>]*checked/.test(CE), '2 the switch starts unticked (owner decision)');
  ok(CE.indexOf('Photos from your presentation can appear on the public site. Use only photos you may publish.') !== -1, '2 the photo-rights line beside the upload');
  ok(CE.indexOf('Follow this presentation’s look and photos') !== -1 && CE.indexOf('Your instructions ask to follow the presentation. Turn this on to use its look and photos.') !== -1, '2 the label and the hint that points to the switch');
  ok(/body\.followDeck = !!inputs\.followDeck/.test(CE) && /body\.designNotes = notes/.test(CE) && /followDeck: !!inputs\.followDeck \}\); \}/.test(CE), '2 the brief and plan requests carry the switch and the instructions');
  ok(/steps\.push\(\{ key: 'photos', label: 'Taking the photos out of your presentation' \}\)/.test(CE) && /<script src="create-deck\.js"><\/script>/.test(CE), '2 the photos row, and create-deck.js loaded');
  var NEW_STRINGS = (CE.match(/Follow this presentation[^'"<]*|Looking for photos in[^'"]*|The site takes its colours[^'"]*|ETB2B AI designs the site[^'"]*|Its photos were not taken out[^'"]*|Keeping your presentation[^'"]*|Make the site without them|Following its look and photos\./g) || []).join(' | ');
  ok(NEW_STRINGS && !/\bET\b/.test(NEW_STRINGS), '2 no bare "ET" in the words a user sees', NEW_STRINGS);
  ok(CD.CreateDeck.keyPages({ pages: 24 }, BRIEF.deckPages).join() === '1,2,3,5,13' && CD.CreateDeck.keyPages({ pages: 24 }, null).length === 12, '2 key slides: cover and content pages (no appendix), else the first twelve');
  ok(CD.CreateDeck.looksLikeDeck({ pages: 24, pageW: 1440, pageH: 810, pictures: [1, 2, 3] }) && !CD.CreateDeck.looksLikeDeck({ pages: 2, pageW: 1440, pageH: 810, pictures: [1, 2, 3] }) && !CD.CreateDeck.looksLikeDeck({ pages: 24, pageW: 595, pageH: 842, pictures: [1, 2, 3] }), '2 a designed deck: pages, landscape, photos');
  var SPK = fs.readFileSync(path.join(ROOT, 'edit-event-speaker-tools.js'), 'utf8'), RD = fs.readFileSync(path.join(ROOT, 'pdf-reader.js'), 'utf8');
  ok(/root\.RevampPdf\.renderPage\(page, 1800\)/.test(SPK) && /renderPage: renderPage/.test(RD), '2 one slide renderer: pdf-reader.js renderPage, used by the speaker tools too');

  /* ======================= 3. extract-brief reads the deck as a design ======================= */
  var PDF64 = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n').toString('base64');
  scripted['extract-brief'] = [BRIEF];
  var br = await call('POST', '/api/extract-brief', { eventId: EV, runId: RUN, fileName: 'ETDavos 2027 Delegates.pdf', mimeType: 'application/pdf', docBase64: PDF64, eventMeta: { name: 'ET DAVOS 2027 QA' },
    designNotes: 'design it according to the uploaded presentation', followDeck: true });
  var bp = asked.filter(function (a) { return a.route === 'extract-brief'; })[0] || { prompt: '' };
  ok(br.status === 200 && br.body.briefId, '3 the brief is read', br);
  var BRIEF_ID = br.body && br.body.briefId;
  ok(/THE OWNER'S INSTRUCTIONS FOR THE SITE: “design it according to the uploaded presentation”/.test(bp.prompt) && /follow THIS presentation's look, structure and photos/.test(bp.prompt),
    '3 the model that sees the slides is told the owner\'s instructions and that the deck is followed');
  ok(bp.schema && bp.schema.properties.deckPages && bp.schema.properties.visualIdentity.properties.design && bp.schema.properties.visualIdentity.properties.headingFont, '3 the schema asks for the deck\'s design, fonts and pages');
  var rec = FB.docs['events/' + EV + '/briefs/' + BRIEF_ID] || {};
  ok(rec.followDeck === true && rec.extracted && rec.extracted.deckPages.length === 6 && rec.extracted.visualIdentity.design.sectionPattern.length === 3 && rec.extracted.visualIdentity.headingFont === 'Barlow Condensed',
    '3 kept: the switch beside the brief, its pages, its design, its heading font', rec);

  /* ======================= 4. the photos, kept and checked ======================= */
  var pics = [];
  for (var i = 0; i < PHOTOS.length; i++) {
    var p = PHOTOS[i];
    pics.push({ page: p[0], w: p[1], h: p[2],
      full: (await sharp({ create: { width: p[1], height: p[2], channels: 3, background: { r: 20 * i, g: 90, b: 160 } } }).jpeg({ quality: 70 }).toBuffer()).toString('base64'),
      thumb: (await sharp({ create: { width: 400, height: Math.round(400 * p[2] / p[1]), channels: 3, background: { r: 20 * i, g: 90, b: 160 } } }).jpeg({ quality: 70 }).toBuffer()).toString('base64') });
  }
  var key = '', stored = [];
  for (var b = 0; b < 3; b++) {
    var part = pics.slice(b * 4, b * 4 + 4);
    var r = await call('POST', '/api/chat/doc-pictures', { eventId: EV, doc: 'ETDavos 2027 Delegates.pdf', key: key, part: b + 1, parts: 3, total: pics.length, purpose: 'brief', briefId: BRIEF_ID, runId: RUN,
      pictures: part.map(function (x) { return { page: x.page, full: x.full, thumb: x.thumb }; }) });
    ok(r.status === 200, '4 part ' + (b + 1) + ' stored', r);
    if (!key) key = r.body.key;
    (r.body.pictures || []).forEach(function (s, k) { stored.push({ url: s.url, thumb: s.thumb, page: s.page, w: s.w, h: s.h, share: 1, words: 'Page ' + s.page + ' words' }); });
  }
  await wait();
  ok(stored.length === 10 && stored.every(function (s) { return s.url.indexOf(OWN + 'brief-photos/' + key + '/') === 0; }), '4 under the event\'s brief-photos/ folder, not chat-docs/', stored.map(function (s) { return s.url; }));
  ok(Object.keys(FB.docs).some(function (k) { return k.indexOf('events/' + EV + '/activity/') === 0 && /Took 10 photos out of “ETDavos 2027 Delegates\.pdf” for the site/.test(FB.docs[k].detail); }), '4 one History line for the photos taken out');
  var slide = (await sharp({ create: { width: 640, height: 360, channels: 3, background: '#d62d20' } }).jpeg({ quality: 70 }).toBuffer()).toString('base64');
  var BODY = { eventId: EV, runId: RUN, briefId: BRIEF_ID, key: key, doc: 'ETDavos 2027 Delegates.pdf', pictures: stored, leftOut: { plain: 8, small: 1 }, slides: [1, 2, 3].map(function (n) { return { page: n, data: slide }; }) };
  var refused = [
    ['another event\'s photo', Object.assign({}, BODY, { pictures: [Object.assign({}, stored[0], { url: stored[0].url.replace(EV, 'qa-other') })] }), 400],
    ['a photo from the chat folder', Object.assign({}, BODY, { pictures: [Object.assign({}, stored[0], { url: stored[0].url.replace('brief-photos', 'chat-docs') })] }), 400],
    ['33 photos', Object.assign({}, BODY, { pictures: new Array(33).fill(stored[0]) }), 400],
    ['a slide that is not a JPEG', Object.assign({}, BODY, { slides: [{ page: 1, data: PIC }] }), 400],
    ['the brief of another run', Object.assign({}, BODY, { runId: 'run-other' }), 409]
  ];
  for (var k = 0; k < refused.length; k++) {
    var rr = await call('POST', '/api/brief-photos', refused[k][1]);
    ok(rr.status === refused[k][2], '4 refused: ' + refused[k][0], rr);
  }
  ok(!asked.some(function (a) { return a.route === 'deck-photos'; }), '4 nothing refused is paid for');
  scripted['deck-photos'] = [classifyAnswer, classifyAnswer];
  var made0 = Object.keys(made).length;
  var bphoto = await call('POST', '/api/brief-photos', BODY);
  await wait();
  ok(bphoto.status === 200 && bphoto.body.kept === 7 && bphoto.body.held.length === 3, '4 checked once: 7 can go on the site, 3 held', bphoto.body);
  var dp = asked.filter(function (a) { return a.route === 'deck-photos'; });
  ok(dp.length === 2 && dp[0].images.length === 6 && dp[1].images.length === 4, '4 six to a call, side by side', dp.map(function (a) { return a.images.length; }));
  rec = FB.docs['events/' + EV + '/briefs/' + BRIEF_ID] || {};
  ok(rec.deck && rec.deck.photos.length === 10 && rec.deck.slides.length === 3 && rec.deck.checked === true && !/storage\.googleapis/.test(JSON.stringify(rec.extracted)),
    '4 the list is kept beside the brief, never inside `extracted` (the prompts show that)', rec.deck && Object.keys(rec.deck));
  ok(rec.deck.slides.every(function (s) { return /^events\/qa-pdeck-run\/briefs\/[A-Za-z0-9]+\/slides\/p\d+\.jpg$/.test(s.path) && !made[s.path]; }) && Object.keys(made).length === made0, '4 the slides are private (never made public)', rec.deck.slides);
  ok(Object.keys(FB.docs).some(function (k) { return k.indexOf('events/' + EV + '/activity/') === 0 && /Checked 10 photos from “ETDavos 2027 Delegates\.pdf”: 7 can go on the site, 3 are left out/.test(FB.docs[k].detail); }), '4 the History line says what was held');

  /* ======================= 5. plan-structure follows the deck ======================= */
  scripted['plan-structure'] = [planAnswer()];
  scripted['picture-check'] = [{ people: false, text: true, logos: false }, { people: false, text: false, logos: false }, { people: false, text: false, logos: false }];
  var nAsk = asked.length;
  var pl = await call('POST', '/api/plan-structure', { eventId: EV, runId: RUN, themeMode: 'auto', siteMode: 'standard', designNotes: 'design it according to the uploaded presentation', followDeck: true, eventMeta: { name: 'ET DAVOS 2027 QA' } });
  var pa = asked.slice(nAsk).filter(function (a) { return a.route === 'plan-structure'; })[0] || { prompt: '', images: [] };
  ok(pl.status === 200, '5 the plan is made', pl.body && (pl.body.error || pl.status));
  ok(/THE REFERENCE THIS SITE IS MODELLED ON — the owner's own presentation \(“ETDavos 2027 Delegates\.pdf”\)/.test(pa.prompt) && /Its words and photographs are the owner's own: keep them\./.test(pa.prompt) && !/INSPIRED BY — the owner/.test(pa.prompt),
    '5 the deck is the reference it is MODELLED ON (not "inspired by")');
  ok(/THE DECK'S OWN PHOTOGRAPHS — 7 photos/.test(pa.prompt) && /3 more were left out/.test(pa.prompt) && /ONE BACKGROUND/.test(pa.prompt) && !/SERIF DISPLAY/.test(pa.prompt) && !/PICTURES, AS ON ET'S OWN SITES/.test(pa.prompt),
    '5 the photo lines and ONE BACKGROUND; no serif rule, no ETB2B picture rule', pa.prompt.length);
  ok(/Red dot grid in top-left corner; concentric arc rings/.test(pa.prompt) && /order the sections as the deck's pages run/.test(pa.prompt) && /p5 ET Studio — lounge photo left, red title right; photo: split/.test(pa.prompt), '5 the motifs, the order, the pages');
  ok(pa.images.length === 2 && pa.schema.properties.design.properties.heroPhoto && pa.schema.properties.sections.items.properties.fromPages, '5 a contact sheet of the photos and a sheet of the slides go with the plan; it picks by number', pa.images.length);
  ok(!/photo of page 7|photo of page 11|photo of page 23/.test(pa.prompt), '5 a held photo is never listed to the model');
  var plan = pl.body && pl.body.designPlan || {}, d = plan.design || {}, S = plan.sections || [];
  ok(plan.reference && plan.reference.type === 'ownDeck' && plan.reference.briefId === BRIEF_ID && plan.followDeck === true, '5 F5: the record is honest — ownDeck, followDeck', plan.reference);
  ok(d.heroImageSource === 'owner-deck' && d.heroImagePage === 3 && /\/generated\/\d+-hero-bg\.jpg$/.test(d.heroImageUrl || ''), '5 the banner is the deck\'s own Davos at dusk, cut 16:9', d.heroImageUrl);
  ok(d.headingFont === 'Barlow Condensed', '5 the heading font is the deck\'s sans, never Playfair Display', d.headingFont);
  ok(d.backgroundColor === '#ffffff' && !d.pageFromHero, '5 the page keeps the deck\'s white: no run-on colour from the banner', [d.backgroundColor, d.pageFromHero]);
  var ov = byId(S, 'overview'), wa = byId(S, 'what-awaits'), why = byId(S, 'why-join-us'), cta = byId(S, 'closing-cta'), who = byId(S, 'who-should-attend'), kdp = byId(S, 'key-discussion-points');
  ok(ov.imageSource === 'owner-deck' && ov.imagePage === 2 && ov.imageShape === '4:3' && why.imagePage === 9 && cta.imagePage === 13 && cta.imageShape === '21:9', '5 the sections carry their own pages\' photos, in their frames\' shapes', [ov.imagePage, why.imagePage, cta.imagePage]);
  ok(wa.photos && wa.photos.length === 3 && wa.photoPages.join() === '5,6,14' && wa.imageShape === '4:3', '5 the cards: three deck photos (the India card held)', wa.photoPages);
  ok(!who.imageUrl && !who.imageSource, '5 who-should-attend: the stock people photo is held, never placed');
  ok(S.filter(function (s) { return s.imageSource === 'owner-deck'; }).length >= 4, '5 at least four sections carry a deck photo');
  ok(plan.deckPhotos && plan.deckPhotos.held.length === 3 && plan.deckPhotos.used.length === 7 && plan.deckPhotos.generated.length === 1 && plan.deckPhotos.generated[0].sectionId === 'key-discussion-points',
    '5 the record of which photo went where, which were held, which gap was made', plan.deckPhotos);
  var kdpCalls = imageCalls.filter(function (c) { return /India @ Davos and its four pillars/.test(c.prompt); });
  ok(kdpCalls.length === 2 && /SECOND TRY, STRICT: the picture first made from these words had words or letters in it/.test(kdpCalls[1].prompt) && kdp.imageUrl,
    '5 F7: the made picture is checked, made once more when it had words, and kept when the second is clean', kdpCalls.length);
  ok(kdpCalls.length && !/flags along the street/.test(kdpCalls[0].prompt) && /Scene: The snowy Davos Promenade/.test(kdpCalls[0].prompt), '5 F3: the scene loses "flags along the street"');
  ok(kdp.imageKind === 'subject' && /NO PEOPLE/.test(kdpCalls[0].prompt), '5 F2: kind and scene agree — no people asked for where the scene says none', kdp.imageKind);
  ok(imageCalls.length === 2, '5 only the gap is made: the banner and the other sections are the deck\'s own', imageCalls.length);

  /* the writer: the owner's photos and words, the motifs, F1 */
  var wp = G.buildSectionCodePrompt({ designPlan: plan, brief: rec.extracted, sources: [], eventMeta: { name: 'ET DAVOS 2027 QA' } });
  ok(/Section "closing-cta" has a REAL photo from the owner's presentation \(page 13, made 21:9\): rvimg:\/\/closing-cta/.test(wp) && /aspect-ratio: 21 \/ 9/.test(wp), '5 the writer: the owner\'s photo, its page and its frame\'s shape');
  ok(/Section "what-awaits" has 3 REAL photos from the owner's presentation, one per card \(pages 5, 6, 14/.test(wp) && !/REAL photos from the previous edition/.test(wp), '5 the card row: the owner\'s photos, never "from the previous edition"');
  ok(/keep its words: its headlines and every point of its pages as written/.test(wp) && /Never call it a previous edition/.test(wp), '5 the writer keeps the deck\'s words and never calls it a previous edition');
  ok(/except the presentation's own abstract motifs: Red dot grid in top-left corner; concentric arc rings/.test(wp) && /never a logo, a monogram, a flag, a cross badge/.test(wp), '5 the motif exception, and never a logo, a flag or a cross badge');
  ok(/for the previous edition write exactly "no previous edition was given"/.test(wp) && /The owner's own documents and instructions are never a previous edition/.test(wp), '5 F1: with no previous edition, the note says so');
  var wp2 = G.buildSectionCodePrompt({ designPlan: plan, brief: rec.extracted, sources: [{ type: 'previousEdition', url: 'https://example.com/2026', extractedSections: [] }] });
  ok(/the ONE specific thing you deliberately did NOT just carry over from this event's previous-edition WEBSITE/.test(wp2) && !/write exactly "no previous edition was given"/.test(wp2), '5 F1: with one, it names what was not carried over');
  ok(/or "no previous edition was given"\)\. The owner's own documents and instructions are never a previous edition\./.test(JSON.stringify(H.SECTION_CODE_SCHEMA.properties.positioningNotes.description).replace(/\\"/g, '"')), '5 F1: the schema has the opt-out too');

  /* ======================= 6. the switch off: today's behaviour ======================= */
  scripted['plan-structure'] = [planAnswer()];
  nAsk = asked.length; imageCalls.length = 0;
  var off = await call('POST', '/api/plan-structure', { eventId: EV, runId: RUN, themeMode: 'auto', siteMode: 'standard', followDeck: false, eventMeta: { name: 'ET DAVOS 2027 QA' } });
  var po = asked.slice(nAsk).filter(function (a) { return a.route === 'plan-structure'; })[0] || { prompt: '', images: [] };
  var dpOff = off.body && off.body.designPlan || {};
  ok(off.status === 200 && dpOff.reference && dpOff.reference.type === 'deck' && dpOff.reference.briefId === BRIEF_ID && dpOff.followDeck === false && !dpOff.deckPhotos, '6 F5: switched off, the record says "deck" (its colours only)', dpOff.reference);
  ok(!/THE DECK'S OWN PHOTOGRAPHS|MODELLED ON — the owner/.test(po.prompt) && /SERIF DISPLAY/.test(po.prompt) && /THE BRIEF IS A DESIGNED PRESENTATION WITH ITS OWN VISUAL IDENTITY/.test(po.prompt) && !po.images.length && !po.schema.properties.design.properties.heroPhoto,
    '6 the plan prompt and schema are today\'s: no deck photos, no pictures sent');
  ok(dpOff.design && dpOff.design.headingFont === 'Playfair Display' && !(dpOff.sections || []).some(function (s) { return s.imageSource === 'owner-deck'; }), '6 today\'s serif and no deck photo on the page');

  /* ======================= 7. every run: F2, F3, F6 ======================= */
  var s1 = { id: 'what-awaits', image: 'The snowy promenade at dusk, flags along the street, no people.', imageKind: 'people', purpose: 'Moments of the week.' };
  G.settleKind(s1, 'people', ['people', 'place', 'subject']);
  ok(s1.imageKind === 'place', '7 F2: kind people with a scene of "no people" becomes a place', s1.imageKind);
  var s2 = { id: 'overview', image: 'Delegates networking in a hall', imageKind: 'subject', purpose: 'The theme of the summit.' };
  G.settleKind(s2, 'subject', ['subject', 'place', 'graphic']);
  ok(s2.imageKind === 'subject' && /with no people: The theme of the summit\./.test(s2.image), '7 F2: people named under a kind without them: the scene is said again from the purpose', s2.image);
  var s3 = { id: 'what-awaits', image: 'Delegates networking in a hall', imageKind: 'subject', purpose: 'x' };
  G.settleKind(s3, 'subject', ['people', 'place', 'subject']);
  ok(s3.imageKind === 'people', '7 F2: where people are allowed, the kind follows the scene');
  var ns = H.newStandardPictures([{ id: 'what-awaits', name: '', purpose: 'Moments.', layout: 'cards', image: 'A deserted promenade at dusk, no people.', imageKind: 'people' }], [], {});
  ok(ns[0].imageKind === 'place', '7 F2: newStandardPictures no longer forces what-awaits to people', ns[0].imageKind);
  var hero = genDesign.imagePrompt('Davos at dusk with red Swiss flags and snowy peaks', { themeColor: '#d62d20' }, { hero: true, about: 'ET DAVOS' });
  ok(!/red Swiss flags/.test(hero) && /Scene: Davos at dusk and snowy peaks/.test(hero), '7 F3: the key visual\'s scene loses its flags', hero.slice(0, 900));
  var listScene = genDesign.scrubScene('A store, and no screens, signs, boards or panels anywhere', { lettering: true, people: true, flags: true, logos: true });
  ok(listScene.scene === 'A store, and no screens, signs, boards or panels anywhere' && !listScene.removed.length, '7 F3: a list that says what is absent is kept whole', listScene);
  var jpg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ffffff' } }).composite([{ input: await sharp({ create: { width: 200, height: 10, channels: 3, background: '#285a32' } }).png().toBuffer(), left: 0, top: 90 }]).jpeg({ quality: 95 }).toBuffer();
  var webp = await sharp(jpg).webp({ quality: 95 }).toBuffer();
  var cj = await G.bottomColourOf(jpg, 'image/jpeg'), cw = await G.bottomColourOf(webp, 'image/webp');
  function near(c) { return c && Math.abs(c[0] - 40) < 12 && Math.abs(c[1] - 90) < 12 && Math.abs(c[2] - 50) < 12; }
  ok(near(cj) && near(cw), '7 F6: the run-on colour is read from a JPEG and a WebP banner too', [cj, cw]);
  ok(G.dropPicture && /NO PICTURE/.test((function () { var s = { image: 'x', layout: 'photo left, text right' }; G.dropPicture(s); return s.layout; })()), '7 F4: a dropped picture tells its layout');
  var API = fs.readFileSync(path.join(__dirname, 'api-generate.js'), 'utf8');
  ok(/if \(planned && !img\) \{[^}]*dropPicture\(s\); \}/.test(API), '7 F4: a planned picture that did not come back is dropped from its layout');
  finish();
})().catch(function (err) { console.error('deck-follow: crashed — ' + (err && err.stack || err)); process.exit(1); });
