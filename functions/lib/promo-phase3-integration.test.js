/* node functions/lib/promo-phase3-integration.test.js — Promotions phase 3 end to end, every real module together,
   each request through lib/api.js's routing (api.handleApi) as server.js hands it over:
     - Social posts (lib/promo-social.js): the catalog, the HTML of every template in every format (and the card
       previews of a sparse event, filled with marked examples), the uploaded art and a PSD's summary, "Upload a
       picture", and a saved layout (the browser's real Testimonial extract, fixtures/promo-social-testimonial-els.json)
       loaded and reset;
     - the mail banner (lib/promo-banner.js with lib/promo-mailer.js's stale refusal): drawn, current, made stale by a
       new date, refused, drawn again, and every download then carries the new banner and never the old one;
     - the Mailers cards' previews (lib/promo-previews.js with lib/promo-examples.js): 18 mailers, the award ones
       filled with examples on an event that is not an award;
     - every example guard of plan §5h, and signed-out requests.
   The engine is the rebuilt one (vendor/promo-engine.js). Stand-ins: Firebase (Firestore with transactions,
   Storage and sign-in, in memory) and lib/promo.js's buildKit only (it reads the saved site and checks fonts and
   the logo over the network; here it answers fixed Kits after the real live-event check). Every AI and network
   call is replaced by a spy that refuses, and the test checks that none was made. No network. Exits 1 on any
   failure.
   `node functions/lib/promo-phase3-integration.test.js --suite` also runs every other functions/lib/*.test.js
   and compares the failures with the base's (plan §8c step 3; the lead keeps that list outside the repo, its
   path in PROMO_SUITE_BASE). */
'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { PassThrough } = require('stream');

/* the environment as it came in, for the other tests that --suite runs (below), less the AI keys: no test may reach
   a model, so none is handed one */
var SUITE_ENV = Object.assign({}, process.env);
delete SUITE_ENV.GEMINI_API_KEY;
delete SUITE_ENV.ANTHROPIC_API_KEY;
/* a local server, no tracking, no public address of its own: what the developer machine is */
delete process.env.K_SERVICE;
delete process.env.TRACK_SECRET;
delete process.env.TRACK_SECRET_PREVIOUS;
delete process.env.PUBLIC_BASE_URL;
delete process.env.GEMINI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

var ROOT = path.resolve(__dirname, '..', '..');
var passed = 0, failed = 0;
var realError = console.error.bind(console), LOGS = [];
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; realError('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 1500) : '')); }
console.error = function () { LOGS.push([].slice.call(arguments).join(' ')); };
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function count(s, sub) { return String(s).split(sub).length - 1; }

/* ---------- no AI, no network: each way out is a spy that refuses ---------- */
var OUTSIDE = [];
function refuseOutside(what) { return function () { OUTSIDE.push(what); return Promise.reject(new Error('integration test: no ' + what)); }; }
var gemini = require('./gemini'), claude = require('./claude'), llm = require('./llm');
gemini.callGeminiJson = refuseOutside('callGeminiJson'); gemini.callGeminiImage = refuseOutside('callGeminiImage');
claude.callClaudeJson = refuseOutside('callClaudeJson'); llm.callJson = refuseOutside('llm.callJson');
global.fetch = refuseOutside('fetch');
['http', 'https'].forEach(function (m) {
  var mod = require(m);
  mod.request = function () { OUTSIDE.push(m + '.request'); throw new Error('integration test: no ' + m + ' request'); };
  mod.get = function () { OUTSIDE.push(m + '.get'); throw new Error('integration test: no ' + m + ' request'); };
});

/* ---------- Firestore in memory: documents by path; transactions read, then commit unless a read went stale ---------- */
var DOCS = {}, VERS = {}, ADDS = 0;
function bump(p) { VERS[p] = (VERS[p] || 0) + 1; }
function snapOf(p) { var d = DOCS[p]; return { id: p.split('/').pop(), exists: d !== undefined, ref: docRef(p), data: function () { return clone(d); } }; }
function applyWrite(w) {
  if (w.op === 'delete') delete DOCS[w.path];
  else if (w.op === 'set' && !(w.opts && w.opts.merge)) DOCS[w.path] = clone(w.data);
  else {
    if (w.op === 'update' && DOCS[w.path] === undefined) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
    DOCS[w.path] = Object.assign({}, DOCS[w.path] || {}, clone(w.data));
  }
  bump(w.path);
}
function docRef(p) {
  return {
    id: p.split('/').pop(), path: p,
    get: function () { return Promise.resolve(snapOf(p)); },
    set: function (data, opts) { applyWrite({ op: 'set', path: p, data: data, opts: opts }); return Promise.resolve(); },
    update: function (data) { try { applyWrite({ op: 'update', path: p, data: data }); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
    delete: function () { applyWrite({ op: 'delete', path: p }); return Promise.resolve(); },
    collection: function (c) { return colRef(p + '/' + c, [], null, 0); }
  };
}
function colRef(p, filters, order, lim) {
  function rows() {
    var depth = p.split('/').length + 1;
    var l = Object.keys(DOCS).filter(function (k) {
      return k.indexOf(p + '/') === 0 && k.split('/').length === depth && filters.every(function (f) { return DOCS[k][f[0]] === f[1]; });
    }).sort();
    if (order) l.sort(function (a, b) { var x = DOCS[a][order[0]], y = DOCS[b][order[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (order[1] === 'desc' ? -1 : 1); });
    if (lim) l = l.slice(0, lim);
    return l.map(snapOf);
  }
  return {
    path: p,
    doc: function (id) { return docRef(p + '/' + id); },
    add: function (data) { var id = 'auto' + (++ADDS); applyWrite({ op: 'set', path: p + '/' + id, data: data }); return Promise.resolve(docRef(p + '/' + id)); },
    where: function (f, op, v) { if (op !== '==') throw new Error('fake: only =='); return colRef(p, filters.concat([[f, v]]), order, lim); },
    orderBy: function (f, dir) { return colRef(p, filters, [f, dir || 'asc'], lim); },
    limit: function (n) { return colRef(p, filters, order, n); },
    select: function () { return colRef(p, filters, order, lim); },
    get: function () { var l = rows(); return Promise.resolve({ docs: l, size: l.length, empty: !l.length, forEach: function (fn) { l.forEach(fn); } }); }
  };
}
var DB = {
  collection: function (c) { return colRef(c, [], null, 0); },
  getAll: function () { var a = [].slice.call(arguments).filter(function (r) { return r && r.path; }); return Promise.resolve(a.map(function (r) { return snapOf(r.path); })); },
  batch: function () {
    var ops = [];
    var b = {
      set: function (r, d, o) { ops.push({ op: 'set', path: r.path, data: d, opts: o }); return b; },
      create: function (r, d) { ops.push({ op: 'set', path: r.path, data: d }); return b; },
      update: function (r, d) { ops.push({ op: 'update', path: r.path, data: d }); return b; },
      delete: function (r) { ops.push({ op: 'delete', path: r.path }); return b; },
      commit: function () { ops.forEach(applyWrite); return Promise.resolve(); }
    };
    return b;
  },
  runTransaction: function (fn) {
    var tries = 0;
    function attempt() {
      tries++;
      var reads = {}, writes = [];
      var t = {
        get: function (ref) { reads[ref.path] = VERS[ref.path] || 0; return Promise.resolve(snapOf(ref.path)); },
        set: function (ref, data, opts) { writes.push({ op: 'set', path: ref.path, data: clone(data), opts: opts }); return t; },
        update: function (ref, data) { writes.push({ op: 'update', path: ref.path, data: clone(data) }); return t; },
        delete: function (ref) { writes.push({ op: 'delete', path: ref.path }); return t; }
      };
      return Promise.resolve().then(function () { return fn(t); }).then(function (result) {
        if (Object.keys(reads).some(function (p) { return (VERS[p] || 0) !== reads[p]; })) {
          if (tries >= 5) throw new Error('fake: too much contention');
          return attempt();
        }
        writes.forEach(applyWrite);
        return result;
      });
    }
    return attempt();
  }
};

/* ---------- Storage in memory ---------- */
var BUCKET = 'bkt', OBJECTS = {};
function notFound() { var e = new Error('No such object'); e.code = 404; return e; }
var BUCKETOBJ = {
  name: BUCKET,
  file: function (name) {
    return {
      name: name,
      save: function (data, opts) { OBJECTS[name] = { data: Buffer.from(data), metadata: (opts && opts.metadata) || {}, public: false }; return Promise.resolve(); },
      makePublic: function () { if (!OBJECTS[name]) return Promise.reject(notFound()); OBJECTS[name].public = true; return Promise.resolve(); },
      getMetadata: function () { return OBJECTS[name] ? Promise.resolve([Object.assign({ name: name }, OBJECTS[name].metadata)]) : Promise.reject(notFound()); },
      exists: function () { return Promise.resolve([!!OBJECTS[name]]); },
      download: function () { return OBJECTS[name] ? Promise.resolve([OBJECTS[name].data]) : Promise.reject(notFound()); },
      delete: function () { if (!OBJECTS[name]) return Promise.reject(notFound()); delete OBJECTS[name]; return Promise.resolve(); }
    };
  },
  getFiles: function (o) {
    var prefix = (o && o.prefix) || '';
    return Promise.resolve([Object.keys(OBJECTS).filter(function (k) { return k.indexOf(prefix) === 0; }).sort().map(function (k) { return BUCKETOBJ.file(k); })]);
  }
};
function objectsUnder(prefix) { return Object.keys(OBJECTS).filter(function (k) { return k.indexOf(prefix) === 0; }); }
function objectOfUrl(url) { var p = 'https://storage.googleapis.com/' + BUCKET + '/'; return String(url || '').indexOf(p) === 0 ? OBJECTS[String(url).slice(p.length)] : undefined; }

/* a token is the account's name: "maker" signs in as maker@timesinternet.in with Google; "expired" is refused */
var FB = {
  db: DB, bucket: BUCKETOBJ,
  auth: { verifyIdToken: function (t) {
    if (t === 'expired') return Promise.reject(new Error('expired'));
    return Promise.resolve({ email: t + '@timesinternet.in', email_verified: true, firebase: { sign_in_provider: 'google.com' } });
  } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };

/* ---------- the events and their Kits ---------- */
var STORE = 'https://storage.googleapis.com/' + BUCKET + '/';
var HOST = 'cms.example', BASE = 'https://' + HOST;
var CREATED = '2026-10-01T00:00:00.000Z';
DOCS['events/rich'] = { name: 'ETCIO Annual Conclave 2027', createdAt: CREATED, category: 'conference', published: true, start: '2027-02-10T09:00', end: '2027-02-11T18:00' };
DOCS['events/sparse'] = { name: 'Sparse Forum 2027', createdAt: CREATED, category: 'conference', published: false, start: '2027-04-02T09:00', end: '2027-04-02T18:00' };
DOCS['events/gone'] = { name: 'Gone Summit', createdAt: CREATED, deletedAt: '2026-10-20T00:00:00.000Z' };

function speaker(i, name, group) {
  return { id: 's' + i, name: name, designation: 'Chief Technology Officer', company: 'Company ' + i, photoUrl: 'https://img.etb2bimg.com/files/speaker-' + i + '.jpg', group: group };
}
var RICH_KIT = {
  event: { id: 'rich', name: 'ETCIO Annual Conclave 2027', category: 'conference', start: '2027-02-10T09:00', end: '2027-02-11T18:00',
    dateLabel: '10–11 February, 2027', place: 'Grand Hyatt, Mumbai', venue: 'Grand Hyatt', city: 'Mumbai',
    description: 'The 9th edition of the ETCIO Annual Conclave brings technology chiefs together on AI, cloud and security.',
    hashtag: '#ETCIO27', edition: '9th Edition' },
  brand: { kind: 'generated', mode: 'light',
    colours: { theme: '#8f6118', accent: '#c8102e', background: '#ffffff', surface: '#f6f3ee', text: '#1a1a1a', muted: '#6b6b6b', heading: '#111111', onTheme: '#ffffff' },
    fonts: { heading: { family: 'Poppins', stack: '\'Poppins\', sans-serif', cssUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@600;700' },
      body: { family: 'Inter', stack: '\'Inter\', sans-serif', cssUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600' } },
    radius: '12px',
    logoUnit: { url: STORE + 'events/rich/site/logo-unit.png', darkUrl: STORE + 'events/rich/site/logo-unit-dark.png', width: 600, height: 200, tone: 'light' },
    eventLogoUrl: STORE + 'events/rich/site/logo.png', heroImageUrl: STORE + 'events/rich/site/hero.jpg', pictures: [],
    logoUnitParts: { before: 'ETCIO', keyword: 'Annual', after: 'Conclave' }, portal: { slug: 'cio' } },
  content: {
    overview: '',
    speakers: [speaker(1, 'Ananya Iyer', 'Keynote Speakers'), speaker(2, 'अनन्या अय्यर', 'Keynote Speakers'), speaker(3, 'O\'Brien "QA" <b>x</b>', 'Speakers'),
      speaker(4, 'Rohan Mehta', 'Speakers'), speaker(5, 'Kavya Nair', 'Speakers'), speaker(6, 'Vikram Rao', 'Speakers'), speaker(7, 'Ishita Sen', 'Speakers'), speaker(8, 'Arjun Das', 'Speakers')],
    partners: [
      { id: 'p1', name: 'Tata Consultancy & Co', logoUrl: 'https://img.etb2bimg.com/files/l1.png', tier: 'Presenting Partner', url: 'https://tcs.example/' },
      { id: 'p2', name: 'Infra Labs', logoUrl: 'https://img.etb2bimg.com/files/l2.png', tier: 'Gold Partners' },
      { id: 'p3', name: 'Cloudline', logoUrl: 'https://img.etb2bimg.com/files/l3.png', tier: 'Gold Partners' },
      { id: 'p4', name: 'Datapath', logoUrl: 'https://img.etb2bimg.com/files/l4.png', tier: 'Associate Partners' },
      { id: 'p5', name: 'Netra', logoUrl: 'https://img.etb2bimg.com/files/l5.png', tier: 'Associate Partners' },
      { id: 'p6', name: 'Quanta', logoUrl: 'https://img.etb2bimg.com/files/l6.png', tier: 'Associate Partners' }],
    sessions: [{ id: 'a1', title: 'Opening keynote', start: '09:30', end: '10:00', day: 1, speakers: ['Ananya Iyer'] },
      { id: 'a2', title: 'Agents in the enterprise', start: '10:00', end: '10:45', day: 1, speakers: ['Rohan Mehta', 'Kavya Nair'] },
      { id: 'a3', title: 'Securing the cloud', start: '11:15', end: '12:00', day: 1, speakers: ['Vikram Rao'] }],
    audience: ['CIOs', 'CTOs', 'CISOs', 'Heads of Data', 'Heads of AI', 'Digital leaders'],
    topics: ['Agentic AI', 'Cloud', 'Security', 'Data', 'Talent'],
    stats: [{ value: '40+', label: 'Speakers' }, { value: '500+', label: 'Delegates' }, { value: '2', label: 'Days' }],
    contacts: [], social: []
  }
};
var SPARSE_KIT = {
  event: { id: 'sparse', name: 'Sparse Forum 2027', category: 'conference', start: '2027-04-02T09:00', end: '2027-04-02T18:00', dateLabel: '2 April, 2027',
    place: '', venue: '', city: '', description: 'A forum.', hashtag: '#SparseForum27', edition: '' },
  brand: { kind: 'unknown', mode: 'dark', colours: { theme: '#224466' }, fonts: { heading: { family: 'Inter', stack: 'Inter, sans-serif', cssUrl: '' }, body: { family: 'Inter', stack: 'Inter, sans-serif', cssUrl: '' } },
    radius: '8px', logoUnit: null, eventLogoUrl: '', heroImageUrl: '', pictures: [], logoUnitParts: { before: '', keyword: '', after: '' }, portal: { slug: 'cio' } },
  content: { overview: '', speakers: [], partners: [], sessions: [], audience: [], topics: [], stats: [], contacts: [], social: [] }
};
var KITS = { rich: RICH_KIT, sparse: SPARSE_KIT };

/* lib/promo.js, real, but for buildKit: the real event check (H.loadLiveEvent, its 404s), then the fixed Kit with the
   site's address and published flag as buildKit makes them */
var promo = require('./promo');
var HELP = null, KIT_CALLS = 0;
var promoWire = promo.wire;
promo.wire = function (h) { HELP = h; return promoWire.apply(this, arguments); };
promo.buildKit = function (fb, eventId, req) {
  KIT_CALLS++;
  return HELP.loadLiveEvent(fb, eventId).then(function (stored) {
    var kit = clone(KITS[eventId]);
    if (!kit) throw HELP.httpError(404, 'No event found for "' + eventId + '".', { code: 'event-not-found' });
    var siteUrl = HELP.publicBaseFor(req) + '/e/' + eventId;
    kit.event.id = eventId; kit.event.siteUrl = siteUrl; kit.event.registerUrl = siteUrl + '#register'; kit.event.published = stored.published === true;
    return kit;
  });
};

var MODULES = ['promo-social', 'promo-banner', 'promo-previews', 'promo-examples', 'promo-mailer'];
var missing = MODULES.filter(function (m) { return !fs.existsSync(path.join(__dirname, m + '.js')); });
if (missing.length) { realError('FAIL the phase 3 modules are all in the tree — missing: ' + missing.join(', ')); process.exit(1); }

const api = require('./api');
const engine = require('./vendor/promo-engine');
const examples = require('./promo-examples');
const social = require('./promo-social');
const sharp = require('sharp');

/* ---------- one request through api.handleApi: { status, headers, body, text, json } ---------- */
function call(method, url, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var raw = o.raw != null ? Buffer.from(o.raw) : Buffer.from(o.body !== undefined ? JSON.stringify(o.body) : '');
    var h = { host: HOST, 'user-agent': 'integration-test' };
    if (o.token) h.authorization = 'Bearer ' + o.token;
    if (o.body !== undefined) h['content-type'] = 'application/json';
    if (o.raw != null) h['content-type'] = o.type || 'application/octet-stream';
    if (raw.length) h['content-length'] = String(raw.length);
    if (o.gzip) h['accept-encoding'] = 'gzip';
    /* a stream (the import route reads one) that also carries the body pre-read, as Firebase hands it over */
    var req = new PassThrough();
    req.method = method; req.url = url; req.headers = h; req.socket = { remoteAddress: '127.0.0.1' }; req.rawBody = raw;
    req.end(raw);
    var res = { statusCode: 200, headers: {}, headersSent: false, chunks: [],
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      removeHeader: function (k) { delete res.headers[k.toLowerCase()]; },
      writeHead: function (s, hh) { res.statusCode = s; Object.keys(hh || {}).forEach(function (k) { res.headers[k.toLowerCase()] = hh[k]; }); res.headersSent = true; return res; },
      write: function (c) { res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; },
      on: function () { return res; }, once: function () { return res; },
      end: function (b) {
        if (b !== undefined) res.chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
        var buf = res.chunks.length ? Buffer.concat(res.chunks) : undefined;
        if (buf && res.headers['content-encoding'] === 'gzip') buf = zlib.gunzipSync(buf);
        var text = buf ? buf.toString('utf8') : '', json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text: text, json: json });
      } };
    api.handleApi(req, res);
  });
}
function as(token) {
  return {
    get: function (url) { return call('GET', url, { token: token }); },
    post: function (url, body, extra) { return call('POST', url, Object.assign({ token: token, body: body }, extra || {})); },
    raw: function (url, bytes, type) { return call('POST', url, { token: token, raw: bytes, type: type }); },
    del: function (url) { return call('DELETE', url, { token: token }); }
  };
}
var A = as('maker');
function urlsIn(s, prefix) { var re = new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^"\'\\s<>)]+', 'g'); return String(s).match(re) || []; }
function exampleMarker(html) { return String(html).indexOf('<meta name="oneworld-example"') !== -1; }
function bannerBlocks(doc) { return ((doc && doc.blocks) || []).filter(function (b) { return b && b.type === 'banner'; }); }
function png(w, h, bg) { return sharp({ create: { width: w, height: h, channels: 3, background: bg || '#336699' } }).png().toBuffer(); }
function jpeg(w, h, bg) { return sharp({ create: { width: w, height: h, channels: 3, background: bg || '#224466' } }).jpeg({ quality: 80 }).toBuffer(); }
/* a logo with a transparent margin all round, so a trim changes its size */
function logoPng() {
  return sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 200, g: 16, b: 46, alpha: 1 } } }).png().toBuffer().then(function (mark) {
    return sharp({ create: { width: 400, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: mark, left: 100, top: 70 }]).png().toBuffer();
  });
}
var TEMPLATE_IDS = engine.ALL_TEMPLATES.map(function (t) { return t.id; });
var FORMAT_IDS = ['ig_square', 'ig_portrait', 'landscape', 'story'];
var AWARD_MAILERS = engine.ALL_MAILERS.filter(function (m) { return /^mailer\.award-/.test(m.id); }).map(function (m) { return m.id; });
var EX_PHOTO = BASE + examples.EXAMPLE_PATH + 'people/p01.jpg';

(async function () {
  /* ======== 0. signed out, and an event that is gone ======== */
  var ROUTE_LIST = [['GET', '/api/promo/social/catalog?eventId=rich'], ['GET', '/api/promo/social/art?eventId=rich'], ['POST', '/api/promo/social/art?eventId=rich&slot=bg1&from=upload'],
    ['POST', '/api/promo/social/art/psd'], ['DELETE', '/api/promo/social/art?eventId=rich&slot=bg1'], ['POST', '/api/promo/social/html'],
    ['GET', '/api/promo/social/layout?eventId=rich&templateId=generic.testimonial&format=ig_square&theme=dark&bg='], ['POST', '/api/promo/social/layout/base?eventId=rich&key=x'],
    ['POST', '/api/promo/social/layout'], ['POST', '/api/promo/social/layout/reset'], ['POST', '/api/promo/social/picture?eventId=rich'],
    ['POST', '/api/promo/mailer/previews'], ['GET', '/api/promo/mailer/banner?eventId=rich'], ['POST', '/api/promo/mailer/banner?eventId=rich&fingerprint=0123456789abcdef0123456789abcdef']];
  for (var i = 0; i < ROUTE_LIST.length; i++) {
    var r0 = await call(ROUTE_LIST[i][0], ROUTE_LIST[i][1], { body: { eventId: 'rich' } });
    var r1 = await call(ROUTE_LIST[i][0], ROUTE_LIST[i][1], { body: { eventId: 'rich' }, token: 'expired' });
    check('0: signed out is 401 on ' + ROUTE_LIST[i].join(' '), r0.status === 401 && r1.status === 401, [r0.status, r1.status]);
  }
  check('0: the 14 routes of plan §5c and §13 are all here', ROUTE_LIST.length === 14);
  var g1 = await A.get('/api/promo/social/catalog?eventId=gone'), g2 = await A.get('/api/promo/mailer/banner?eventId=gone');
  var g3 = await A.post('/api/promo/social/html', { eventId: 'gone', items: [{ templateId: 'generic.announcement', format: 'ig_square' }] });
  var g4 = await A.post('/api/promo/mailer/previews', { eventId: 'gone', templates: true });
  check('0: a deleted event is 404 on the catalog, the html, the banner and the previews', [g1, g2, g3, g4].every(function (x) { return x.status === 404; }), [g1.status, g2.status, g3.status, g4.status]);

  /* ======== 1. the Social posts catalog ======== */
  var cat = await A.get('/api/promo/social/catalog?eventId=rich'), cj = cat.json || {};
  check('1: catalog 200, no-store', cat.status === 200 && /no-store/.test(cat.headers['cache-control'] || ''), [cat.status, cat.text.slice(0, 300)]);
  var ce = cj.event || {};
  check('1: the event header (name, venue, hashtag, counts)', ce.name === 'ETCIO Annual Conclave 2027' && ce.venue === 'Grand Hyatt' && ce.hashtag === '#ETCIO27' &&
    JSON.stringify(ce.counts) === JSON.stringify({ speakers: 8, sponsorTiers: 3, sessions: 3 }), ce);
  check('1: published: the site address and the QR link', ce.published === true && ce.micrositeUrl === BASE + '/e/rich' && ce.link === BASE + '/e/rich#register', ce);
  check('1: four formats', (cj.formats || []).map(function (f) { return f.id; }).join() === FORMAT_IDS.join(), cj.formats);
  var cats = ((cj.catalog || {}).categories || []);
  check('1: 5 generic, 2 partner, 2 speaker templates, all available on the rich event', cats.map(function (c) { return c.templates.length; }).join() === '5,2,2' &&
    cats.every(function (c) { return c.templates.every(function (t) { return t.available === true && t.kind === 'code'; }); }), cats.map(function (c) { return c.templates.map(function (t) { return [t.id, t.available, t.missing]; }); }));
  check('1: every template ends with the two QR options while the site is published', cats.every(function (c) { return c.templates.every(function (t) {
    var p = t.params.slice(-2); return p[0].key === 'qr' && p[0].default === 'on' && p[1].key === 'qrLabel' && p[1].default === 'Scan to register'; }); }));
  var catS = await A.get('/api/promo/social/catalog?eventId=sparse'), csj = catS.json || {};
  check('1: an unpublished site: no QR options, no site address', catS.status === 200 && csj.event.published === false && csj.event.micrositeUrl === undefined && csj.event.link === '' &&
    csj.catalog.categories.every(function (c) { return c.templates.every(function (t) { return !t.params.some(function (p) { return p.key === 'qr' || p.key === 'qrLabel'; }); }); }), csj.event);

  /* ======== 2. the HTML of every template × format ======== */
  var all = [];
  TEMPLATE_IDS.forEach(function (id) { FORMAT_IDS.forEach(function (f) { all.push({ templateId: id, format: f, params: {} }); }); });
  var h36 = await A.post('/api/promo/social/html', { eventId: 'rich', items: all }), items = (h36.json || {}).items || [];
  check('2: 36 items, all HTML, each its format\'s size', h36.status === 200 && items.length === 36 && items.every(function (it, k) {
    var f = engine.FORMATS[FORMAT_IDS[k % 4]]; return typeof it.html === 'string' && it.html.length > 500 && !it.error && it.width === f.width && it.height === f.height; }),
    items.filter(function (it) { return !it.html; }));
  check('2: the published site\'s QR on every post (data: SVG), the Announcement\'s in its button row', items.every(function (it) { return count(it.html, 'class="ow-qr"') === 1 && it.html.indexOf('data:image/svg+xml;base64,') !== -1; }) &&
    items.filter(function (it) { return it.templateId === 'generic.announcement'; }).every(function (it) { return it.html.indexOf('class="an-acts"') !== -1; }),
    items.filter(function (it) { return count(it.html, 'class="ow-qr"') !== 1; }).map(function (it) { return it.templateId + ' ' + it.format; }));
  check('2: names escaped, the Devanagari name intact, nothing undefined', items.every(function (it) { return it.html.indexOf('<b>x</b>') === -1 && !/\bundefined\b|\bNaN\b/.test(it.html); }) &&
    items.some(function (it) { return it.html.indexOf('अनन्या अय्यर') !== -1; }));
  check('2: the Testimonial with no quote: no quote, no voice, caption \'\'', items.filter(function (it) { return it.templateId === 'generic.testimonial'; }).every(function (it) {
    return it.caption === '' && it.html.indexOf('class="tst-quote"') === -1 && it.html.indexOf('Ananya Iyer') === -1; }));
  /* with the QR off the route adds nothing to the engine's own render (source parity, plan §8c step 3, is checked
     outside the repo between the engine and the platform's own registry) */
  var off = all.map(function (x) { return Object.assign({}, x, { params: { qr: 'off' } }); });
  var hOff = await A.post('/api/promo/social/html', { eventId: 'rich', items: off }), offItems = (hOff.json || {}).items || [];
  var sev = await social._test.socialEventFor(FB, 'rich', { headers: { host: HOST } });
  var direct = off.map(function (x) {
    var tpl = engine.getTemplate(x.templateId), fmt = engine.FORMATS[x.format];
    var ctx = { event: sev.ev, brand: engine.getBrand(sev.ev.portal), format: fmt, params: engine.resolveParams(tpl, x.params), assets: {} };
    return { html: tpl.render(ctx), caption: tpl.caption(ctx) };
  });
  check('2: qr:off — no QR, and each post and caption is byte for byte the engine\'s own render of the event', offItems.length === 36 && offItems.every(function (it, k) {
    return it.html.indexOf('ow-qr') === -1 && it.html.indexOf('an-acts') === -1 && it.html === direct[k].html && it.caption === direct[k].caption; }),
    offItems.map(function (it, k) { return it.html === direct[k].html ? null : it.templateId + ' ' + it.format; }).filter(Boolean));
  var cap = await A.post('/api/promo/social/html', { eventId: 'rich', captionOnly: true, items: [{ templateId: 'speaker.individual', format: 'ig_square', params: {} }] });
  check('2: captionOnly: a caption and no HTML', cap.status === 200 && cap.json.items[0].html === undefined && typeof cap.json.items[0].caption === 'string' && cap.json.items[0].caption.length > 0, cap.json);

  /* the sparse event's card previews: the gap filled with marked examples, only with preview:true */
  var prevItems = TEMPLATE_IDS.map(function (id) { return { templateId: id, format: 'ig_portrait', params: {}, preview: true }; });
  var hp = await A.post('/api/promo/social/html', { eventId: 'sparse', items: prevItems }), pv = {};
  ((hp.json || {}).items || []).forEach(function (it) { pv[it.templateId] = it; });
  var FILLED = { 'generic.who-should-attend': 'audience', 'generic.summit-highlights': 'stats', 'partner.tier-ladder': 'sponsors', 'partner.presenting-spotlight': 'sponsors',
    'speaker.individual': 'speakers', 'speaker.combined': 'speakers', 'generic.testimonial': 'quote' };
  check('2: sparse previews: the lists it lacks come back as marked examples', hp.status === 200 && Object.keys(FILLED).every(function (id) {
    var it = pv[id] || {}; return it.example === true && (it.filled || []).indexOf(FILLED[id]) !== -1 && exampleMarker(it.html) && it.caption === ''; }),
    Object.keys(FILLED).map(function (id) { var it = pv[id] || {}; return [id, it.example, it.filled, it.error, exampleMarker(it.html)]; }));
  check('2: sparse previews: what it has is drawn real, unmarked', ['generic.announcement', 'generic.prediction-outcome'].every(function (id) {
    var it = pv[id] || {}; return typeof it.html === 'string' && !it.example && !exampleMarker(it.html); }), [pv['generic.announcement'], pv['generic.prediction-outcome']].map(function (it) { return it && [it.example, it.state, it.error]; }));
  var hn = await A.post('/api/promo/social/html', { eventId: 'sparse', items: prevItems.map(function (x) { return { templateId: x.templateId, format: x.format, params: {} }; }) });
  var nn = {}; ((hn.json || {}).items || []).forEach(function (it) { nn[it.templateId] = it; });
  check('2: the same posts asked for real: "needs …", no HTML, no example', Object.keys(FILLED).filter(function (id) { return id !== 'generic.testimonial'; }).every(function (id) {
    return /^needs /.test(nn[id].error || '') && !nn[id].html && nn[id].example === undefined; }), nn);
  check('2: the Testimonial preview speaks with an example voice, never a real person', exampleMarker((pv['generic.testimonial'] || {}).html) &&
    String((pv['generic.testimonial'] || {}).html).indexOf(examples.EXAMPLE_PATH + 'people/') !== -1);

  /* ======== 3. the uploaded art: a background, the PSD's units and their clearing ======== */
  var bg = await png(1600, 900);
  var up1 = await A.raw('/api/promo/social/art?eventId=rich&slot=bg1&from=upload', bg, 'image/png');
  check('3: Background 1 uploaded: the platform\'s answer', up1.status === 200 && up1.json.ok === true && up1.json.slot === '1' && up1.json.width === 1600 && up1.json.height === 900 && up1.json.bytes > 0, up1.json);
  var art = await A.get('/api/promo/social/art?eventId=rich'), aj = art.json || {};
  var bgUrl = aj.units && aj.units.bg1 && aj.units.bg1.url;
  check('3: the art answer: bg1 set, a public object under the event\'s promo-art folder', aj.bg1 === true && aj.background === false && /^https:\/\/storage\.googleapis\.com\/bkt\/events\/rich\/promo-art\/bg1-[0-9a-z]+-[0-9a-f]{16}\.png$/.test(bgUrl) &&
    objectOfUrl(bgUrl) && objectOfUrl(bgUrl).public === true, aj);
  var hb = await A.post('/api/promo/social/html', { eventId: 'rich', items: [{ templateId: 'speaker.individual', format: 'ig_square', params: { bg: '1' } }, { templateId: 'speaker.individual', format: 'ig_square', params: {} }] });
  check('3: a post with bg:\'1\' is drawn on it; without, it is not', hb.status === 200 && hb.json.items[0].html.indexOf(bgUrl) !== -1 && hb.json.items[1].html.indexOf(bgUrl) === -1, hb.json && hb.json.items.map(function (i) { return i.error; }));
  var lg = await logoPng();
  var psdBg = await A.raw('/api/promo/social/art?eventId=rich&slot=background&from=psd', await png(1200, 1500, '#112233'), 'image/png');
  var psdLogo = await A.raw('/api/promo/social/art?eventId=rich&slot=logoUnit&from=psd', lg, 'image/png');
  check('3: a PSD\'s background and logo stored; the logo trimmed to its mark', psdBg.status === 200 && psdLogo.status === 200 && psdLogo.json.width === 200 && psdLogo.json.height === 100, [psdBg.json, psdLogo.json]);
  var meta1 = await A.post('/api/promo/social/art/psd', { eventId: 'rich', name: 'Conclave.psd', bytes: 123456, canvasWidth: 1200, canvasHeight: 1500, found: { background: true, logoUnit: false } });
  var art2 = (await A.get('/api/promo/social/art?eventId=rich')).json || {};
  check('3: a new PSD with no logo clears the PSD-made logo and keeps its background', meta1.status === 200 && meta1.json.logoUnit === null && meta1.json.background && art2.logoUnit === false &&
    art2.background === true && art2.psd && art2.psd.canvasWidth === 1200 && !('layers' in (DOCS['events/rich/promoSocial/art'].psd || {})), [meta1.json, art2]);
  var upLogo = await A.raw('/api/promo/social/art?eventId=rich&slot=logoUnit&from=upload', lg, 'image/png');
  var meta2 = await A.post('/api/promo/social/art/psd', { eventId: 'rich', name: 'Conclave v2.psd', bytes: 2, canvasWidth: 1200, canvasHeight: 1500, found: { background: false, logoUnit: false } });
  var art3 = (await A.get('/api/promo/social/art?eventId=rich')).json || {};
  check('3: an uploaded logo stays when a PSD has none; the PSD background goes', upLogo.status === 200 && meta2.status === 200 && art3.logoUnit === true && art3.units.logoUnit.from === 'upload' && art3.background === false, art3);
  var hl = await A.post('/api/promo/social/html', { eventId: 'rich', items: [{ templateId: 'generic.announcement', format: 'ig_square', params: {} }] });
  check('3: the logo unit is drawn in the post', hl.status === 200 && hl.json.items[0].html.indexOf(art3.units.logoUnit.url) !== -1);
  var del1 = await A.del('/api/promo/social/art?eventId=rich&slot=bg1'), del2 = await A.del('/api/promo/social/art?eventId=rich&slot=bg1');
  check('3: Remove clears the record, keeps the object, and is idempotent', del1.status === 200 && del1.json.removed === true && del2.status === 200 && del2.json.removed === false && !!objectOfUrl(bgUrl), [del1.json, del2.json]);

  /* ======== 4. "Upload a picture" (owner O2 = c) ======== */
  var pic = await A.raw('/api/promo/social/picture?eventId=rich', await png(800, 600, '#445566'), 'image/png');
  check('4: a picture uploaded: { ok, url, width, height, bytes } under promo-art/picture-…', pic.status === 200 && pic.json.ok === true && pic.json.width === 800 && pic.json.height === 600 &&
    /\/events\/rich\/promo-art\/picture-[0-9a-z]+-[0-9a-f]{16}\.png$/.test(pic.json.url) && objectOfUrl(pic.json.url) && objectOfUrl(pic.json.url).public === true, pic.json);
  check('4: its address passes lib/promo.js imageUrlProblem for this event (and not for another)', promo.imageUrlProblem(pic.json.url, BUCKET, 'rich') === '' && promo.imageUrlProblem(pic.json.url, BUCKET, 'sparse') !== '');

  /* ======== 5. a saved layout: base, save (the browser's real Testimonial extract), load, reset ======== */
  var FIX = path.join(__dirname, 'fixtures', 'promo-social-testimonial-els.json');
  var fixtureEls = fs.existsSync(FIX) ? JSON.parse(fs.readFileSync(FIX, 'utf8')) : null;
  check('5: the Testimonial extract fixture is in the tree (fixtures/promo-social-testimonial-els.json)', Array.isArray(fixtureEls) && fixtureEls.length > 0);
  fixtureEls = fixtureEls || [];
  var els = clone(fixtureEls);
  /* one Image element shows the picture uploaded above, as the editor sets it */
  var imgEl = els.filter(function (e) { return e.type === 'image' || e.type === 'frame'; })[0];
  if (imgEl) imgEl.src = pic.json.url;
  var KEY = 'generic.testimonial__ig_square__dark_bgpsd', FOLDER = 'events/rich/promo-layouts/' + KEY + '/';
  var base1 = await A.raw('/api/promo/social/layout/base?eventId=rich&key=' + KEY, await png(2160, 2160, '#101820'), 'image/png');
  check('5: the base picture (2× the format) stored under the layout\'s folder', base1.status === 200 && base1.json.width === 2160 && base1.json.url.indexOf(STORE + FOLDER) === 0, base1.json);
  var badBase = await A.raw('/api/promo/social/layout/base?eventId=rich&key=' + KEY, await png(1080, 1080), 'image/png');
  check('5: a base of the wrong size is refused', badBase.status === 400, badBase.json);
  var quote = 'Two days here changed how our team plans — "agents" finally made sense.';
  var save = await A.post('/api/promo/social/layout', { eventId: 'rich', templateId: 'generic.testimonial', format: 'ig_square', theme: 'dark', bg: '', width: 1080, height: 1080,
    base: base1.json.url, elements: els, params: { quote: quote, speakerId: 's1', nope: 'dropped' }, caption: { network: 'instagram', text: 'Our delegates said it best.' } });
  check('5: the real extract output is saved', save.status === 200 && save.json.ok === true && save.json.savedAt > 0, save.json);
  var load = await A.get('/api/promo/social/layout?eventId=rich&templateId=generic.testimonial&format=ig_square&theme=dark&bg='), lj = load.json || {};
  check('5: load: saved:true with its base, elements, options and caption', lj.saved === true && lj.base === base1.json.url && Array.isArray(lj.elements) && lj.elements.length === els.length &&
    lj.params && lj.params.quote === quote && lj.params.speakerId === 's1' && !('nope' in lj.params) && lj.caption && lj.caption.network === 'instagram', [lj.saved, lj.params, lj.caption, lj.elements && lj.elements.length]);
  check('5: every element as the browser sent it: texts kept, no double quote in a style, the uploaded picture kept', (lj.elements || []).every(function (e, k) {
    return (e.text || '') === (els[k].text || '') && !/"/.test(e.fontFamily || ''); }) && (lj.elements || []).some(function (e) { return e.src === pic.json.url; }));
  check('5: the folder holds the committed base only', JSON.stringify(objectsUnder(FOLDER)) === JSON.stringify([FOLDER + base1.json.url.split('/').pop()]), objectsUnder(FOLDER));
  var reset = await A.post('/api/promo/social/layout/reset', { eventId: 'rich', templateId: 'generic.testimonial', format: 'ig_square', theme: 'dark', bg: '' });
  var load2 = await A.get('/api/promo/social/layout?eventId=rich&templateId=generic.testimonial&format=ig_square&theme=dark&bg=');
  check('5: reset: removed, then saved:false, the folder empty', reset.status === 200 && reset.json.removed === true && load2.json && load2.json.saved === false && objectsUnder(FOLDER).length === 0 &&
    DOCS['events/rich/promoSocialLayouts/' + KEY] === undefined, [reset.json, load2.json, objectsUnder(FOLDER)]);
  var outside = await A.post('/api/promo/social/layout', { eventId: 'rich', templateId: 'generic.testimonial', format: 'ig_square', theme: 'dark', bg: '', width: 1080, height: 1080,
    base: (await A.raw('/api/promo/social/layout/base?eventId=rich&key=' + KEY, await png(2160, 2160), 'image/png')).json.url,
    elements: [{ id: 'e0', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'https://evil.example/x.png' }], params: {}, caption: null });
  check('5: an outside picture address is refused with the O2 sentence ("…or use Upload a picture.")', outside.status === 400 && /or use Upload a picture\.$/.test(outside.json.error || ''), outside.json);

  /* ======== 6. the mail banner: drawn, current, made stale by a new date, drawn again ======== */
  var b0 = await A.get('/api/promo/mailer/banner?eventId=rich'), bj0 = b0.json || {};
  check('6: banner needed (the site has a hero picture), not drawn yet', b0.status === 200 && bj0.needed === true && bj0.fresh === false && bj0.url === null && /^[0-9a-f]{32}$/.test(bj0.fingerprint), bj0);
  check('6: its inputs are the real ones: date, place, the dark-ground logo copy', bj0.inputs && bj0.inputs.event.dateLabel === '10–11 February, 2027' && bj0.inputs.event.place === 'Grand Hyatt, Mumbai' &&
    bj0.inputs.brand.logoUnit && bj0.inputs.brand.logoUnit.darkUrl === RICH_KIT.brand.logoUnit.darkUrl && JSON.stringify(bj0.inputs).indexOf('promo-examples') === -1, bj0.inputs);
  var bs = await A.get('/api/promo/mailer/banner?eventId=sparse');
  check('6: no hero picture, no banner needed', bs.status === 200 && bs.json.needed === false, bs.json);
  var doc0 = await A.post('/api/promo/mailer/doc', { eventId: 'rich', mailerId: 'mailer.announcement', fresh: true });
  check('6: /doc waits for the banner: 409 banner-stale', doc0.status === 409 && doc0.json.code === 'banner-stale', [doc0.status, doc0.json]);
  var annDoc = engine.buildDoc(engine.getMailer('mailer.announcement'), (await require('./promo-mailer').eventFor(FB, 'rich', { headers: { host: HOST } })).ev, {});
  annDoc.mailerId = 'mailer.announcement';
  var ed0 = await A.post('/api/promo/mailer/render', { eventId: 'rich', doc: annDoc, editor: true });
  var pl0 = await A.post('/api/promo/mailer/render', { eventId: 'rich', doc: annDoc, editor: false });
  check('6: meanwhile the studio\'s own preview opens; Copy HTML waits', ed0.status === 200 && pl0.status === 409 && pl0.json.code === 'banner-stale', [ed0.status, pl0.status]);
  var jpg1 = await jpeg(1500, 700);
  var badShape = await A.raw('/api/promo/mailer/banner?eventId=rich&fingerprint=' + bj0.fingerprint, await png(1500, 700), 'image/png');
  check('6: a PNG is not a banner', badShape.status === 400, badShape.json);
  var upB1 = await A.raw('/api/promo/mailer/banner?eventId=rich&fingerprint=' + bj0.fingerprint, jpg1, 'image/jpeg'), url1 = upB1.json && upB1.json.url;
  check('6: the banner stored public under promo-banner/<fingerprint 16>-…jpg, bytes as drawn', upB1.status === 200 && upB1.json.ok === true && upB1.json.width === 1500 && upB1.json.height === 700 &&
    String(url1).indexOf(STORE + 'events/rich/promo-banner/' + bj0.fingerprint.slice(0, 16) + '-') === 0 && objectOfUrl(url1) && objectOfUrl(url1).public === true && objectOfUrl(url1).data.equals(jpg1), upB1.json);
  var b1 = (await A.get('/api/promo/mailer/banner?eventId=rich')).json || {};
  check('6: now current', b1.fresh === true && b1.url === url1 && b1.fingerprint === bj0.fingerprint, b1);
  var doc1 = await A.post('/api/promo/mailer/doc', { eventId: 'rich', mailerId: 'mailer.announcement', fresh: true });
  check('6: /doc leads with the banner: its banner block holds it, and so does the render', doc1.status === 200 && bannerBlocks(doc1.json.doc).length >= 1 &&
    bannerBlocks(doc1.json.doc)[0].props.url === url1 && doc1.json.html.indexOf(url1) !== -1 && doc1.json.html.indexOf(RICH_KIT.brand.heroImageUrl) === -1, doc1.json && bannerBlocks(doc1.json.doc));
  var spot = await A.post('/api/promo/mailer/doc', { eventId: 'rich', mailerId: 'mailer.speaker-spotlight', fresh: true });
  check('6: O3 = b — the speaker spotlight leads with the banner too', spot.status === 200 && bannerBlocks(spot.json.doc).some(function (b) { return b.props.url === url1; }), spot.json && bannerBlocks(spot.json.doc));
  var sv = await A.post('/api/promo/mailer/save', { eventId: 'rich', mailerId: 'mailer.announcement', doc: doc1.json.doc, name: 'Launch' });
  var saveId = sv.json && sv.json.save && sv.json.save.saveId;
  check('6: the mail saved with this banner', sv.status === 200 && !!saveId && JSON.parse(DOCS['events/rich/mailerSaves/' + saveId].doc).blocks.some(function (b) { return b.type === 'banner' && b.props.url === url1; }), sv.json);
  /* a saved mail whose banner block is the owner's own picture */
  var custom = clone(doc1.json.doc), CUSTOM = 'https://img.etb2bimg.com/files/own-banner.jpg';
  bannerBlocks(custom)[0].props.url = CUSTOM;

  /* the date changes: every send is held until the banner is drawn again */
  RICH_KIT.event.start = '2027-03-05T09:00'; RICH_KIT.event.end = '2027-03-06T18:00'; RICH_KIT.event.dateLabel = '5–6 March, 2027';
  var d409 = await A.post('/api/promo/mailer/download', { eventId: 'rich', mailerIds: ['mailer.announcement'] });
  var d409doc = await A.post('/api/promo/mailer/download', { eventId: 'rich', doc: doc1.json.doc });
  var d409test = await A.post('/api/promo/mailer/download', { eventId: 'rich', doc: doc1.json.doc, test: true });
  var d409zip = await A.post('/api/promo/mailer/download', { eventId: 'rich' });
  var d409doc2 = await A.post('/api/promo/mailer/doc', { eventId: 'rich', mailerId: 'mailer.announcement', saveId: saveId });
  check('6: a new date: download (one, doc, test, ZIP) and /doc of the saved mail answer 409 banner-stale', [d409, d409doc, d409test, d409zip, d409doc2].every(function (x) { return x.status === 409 && x.json && x.json.code === 'banner-stale'; }),
    [d409, d409doc, d409test, d409zip, d409doc2].map(function (x) { return x.status; }));
  var moved = await A.raw('/api/promo/mailer/banner?eventId=rich&fingerprint=' + bj0.fingerprint, await jpeg(1500, 700, '#334455'), 'image/jpeg');
  check('6: a banner drawn from the old inputs is refused: 409 banner-moved', moved.status === 409 && moved.json.code === 'banner-moved', moved.json);
  var b2 = (await A.get('/api/promo/mailer/banner?eventId=rich')).json || {};
  check('6: a new fingerprint, stale, the old banner still named', b2.fresh === false && b2.fingerprint !== bj0.fingerprint && b2.url === url1 && b2.inputs.event.dateLabel === '5–6 March, 2027', b2);
  var upB2 = await A.raw('/api/promo/mailer/banner?eventId=rich&fingerprint=' + b2.fingerprint, await jpeg(1500, 720, '#556677'), 'image/jpeg'), url2 = upB2.json && upB2.json.url;
  check('6: the new banner stored; the old object kept (sent mails still show it)', upB2.status === 200 && url2 && url2 !== url1 && !!objectOfUrl(url1) && !!objectOfUrl(url2), upB2.json);
  var dl = await A.post('/api/promo/mailer/download', { eventId: 'rich', mailerIds: ['mailer.announcement'] });
  check('6: the download of the saved mail now carries the new banner and never the old', dl.status === 200 && dl.text.indexOf(url2) !== -1 && dl.text.indexOf(url1) === -1 &&
    dl.headers['x-mailer-tracked'] === 'no', [dl.status, dl.text.indexOf(url2), dl.text.indexOf(url1)]);
  var dlDoc = await A.post('/api/promo/mailer/download', { eventId: 'rich', doc: doc1.json.doc });
  var dlTest = await A.post('/api/promo/mailer/download', { eventId: 'rich', doc: doc1.json.doc, test: true });
  var cp = await A.post('/api/promo/mailer/render', { eventId: 'rich', doc: doc1.json.doc, editor: false, track: true });
  check('6: so do the doc download, the test download and Copy HTML of a document still holding the old one',
    [dlDoc.text, dlTest.text, cp.json && cp.json.html].every(function (h) { return String(h).indexOf(url2) !== -1 && String(h).indexOf(url1) === -1; }), [dlDoc.status, dlTest.status, cp.status]);
  var zip = await A.post('/api/promo/mailer/download', { eventId: 'rich', mailerIds: ['mailer.announcement', 'mailer.speakers', 'mailer.speaker-spotlight'] });
  var JSZip = require('jszip'), z = zip.status === 200 ? await JSZip.loadAsync(zip.body) : null, zipHtml = '';
  if (z) for (var n of Object.keys(z.files).filter(function (f) { return /\.html$/.test(f); })) zipHtml += await z.file(n).async('string');
  check('6: the ZIP\'s mails carry the new banner, never the old', zip.status === 200 && zipHtml.indexOf(url2) !== -1 && zipHtml.indexOf(url1) === -1 && count(zipHtml, url2) >= 3, [zip.status, count(zipHtml, url2)]);
  var own = await A.post('/api/promo/mailer/download', { eventId: 'rich', doc: custom });
  check('6: a banner picture the owner chose is left as it is', own.status === 200 && own.text.indexOf(CUSTOM) !== -1 && own.text.indexOf(url2) === -1);
  var doc2 = await A.post('/api/promo/mailer/doc', { eventId: 'rich', mailerId: 'mailer.announcement', saveId: saveId });
  check('6: the saved version reopens on the new banner', doc2.status === 200 && doc2.json.saved === true && bannerBlocks(doc2.json.doc)[0].props.url === url2, doc2.json && bannerBlocks(doc2.json.doc));

  /* ======== 7. the Mailers cards' previews ======== */
  var pr = await A.post('/api/promo/mailer/previews', { eventId: 'rich', templates: true, saveIds: [saveId, 'nope'] }, { gzip: true }), pj = pr.json || {};
  var tpl = (pj.items || []).filter(function (it) { return /^tpl:/.test(it.key); });
  check('7: 18 mailer cards and the two asked versions, gzipped, no-store', pr.status === 200 && tpl.length === 18 && (pj.items || []).length === 20 &&
    pr.headers['content-encoding'] === 'gzip' && /no-store/.test(pr.headers['cache-control'] || ''), [pr.status, (pj.items || []).length, pr.headers['content-encoding']]);
  var exKeys = tpl.filter(function (it) { return it.example === true; }).map(function (it) { return it.key.slice(4); }).sort();
  check('7: on an event that is not an award, exactly the five award mailers are examples, marked', JSON.stringify(exKeys) === JSON.stringify(AWARD_MAILERS.slice().sort()) &&
    tpl.filter(function (it) { return it.example; }).every(function (it) { return exampleMarker(it.html) && (it.filled || []).indexOf('award') !== -1; }), exKeys);
  check('7: the other 13 are the real mails as sent: no marker, no editor ids, the current banner', tpl.filter(function (it) { return !it.example; }).every(function (it) {
    return typeof it.html === 'string' && !exampleMarker(it.html) && it.html.indexOf('data-block-id') === -1; }) &&
    tpl.filter(function (it) { return it.key === 'tpl:mailer.announcement'; }).every(function (it) { return it.html.indexOf(url2) !== -1 && it.html.indexOf(url1) === -1; }));
  var savedPrev = (pj.items || []).filter(function (it) { return it.key === 'save:' + saveId; })[0] || {}, nope = (pj.items || []).filter(function (it) { return it.key === 'save:nope'; })[0] || {};
  check('7: a saved version\'s preview shows the current banner; an unknown one says so', savedPrev.html && savedPrev.html.indexOf(url2) !== -1 && savedPrev.html.indexOf(url1) === -1 && nope.error === 'not found', [savedPrev.error, nope]);
  var prS = await A.post('/api/promo/mailer/previews', { eventId: 'sparse', templates: true }), sp = {};
  ((prS.json || {}).items || []).forEach(function (it) { sp[it.key] = it; });
  check('7: the sparse event: the speakers, partners and agenda mailers are marked examples', prS.status === 200 && ['mailer.speakers', 'mailer.partners', 'mailer.agenda'].every(function (id) {
    var it = sp['tpl:' + id] || {}; return it.example === true && exampleMarker(it.html); }), ['mailer.speakers', 'mailer.partners', 'mailer.agenda'].map(function (id) { return sp['tpl:' + id] && [sp['tpl:' + id].example, sp['tpl:' + id].missing]; }));
  var activityBefore = Object.keys(DOCS).filter(function (k) { return /^events\/[^/]+\/activity\//.test(k); }).length;
  await A.post('/api/promo/mailer/previews', { eventId: 'rich', templates: true });
  check('7: previews log no activity', Object.keys(DOCS).filter(function (k) { return /^events\/[^/]+\/activity\//.test(k); }).length === activityBefore);

  /* ======== 8. every example guard of plan §5h ======== */
  var exDoc = clone(doc2.json.doc);
  exDoc.blocks.push({ id: 'bx', type: 'image', props: { url: EX_PHOTO } });
  function is422(r) { return r.status === 422 && r.json && r.json.code === 'example'; }
  var G = {};
  G['mailer relayout'] = await A.post('/api/promo/mailer/relayout', { eventId: 'rich', mailerId: 'mailer.announcement', doc: exDoc });
  G['mailer import (a pasted preview)'] = await call('POST', '/api/promo/mailer/import?eventId=rich', { token: 'maker', raw: Buffer.from(tpl.filter(function (it) { return it.example; })[0].html), type: 'text/html' });
  G['mailer render, editor'] = await A.post('/api/promo/mailer/render', { eventId: 'rich', doc: exDoc, editor: true });
  G['mailer render, plain'] = await A.post('/api/promo/mailer/render', { eventId: 'rich', doc: exDoc, editor: false });
  G['mailer render, track (Copy HTML)'] = await A.post('/api/promo/mailer/render', { eventId: 'rich', doc: exDoc, editor: false, track: true });
  G['mailer save'] = await A.post('/api/promo/mailer/save', { eventId: 'rich', mailerId: 'mailer.announcement', doc: exDoc, name: 'x' });
  G['mailer download, doc'] = await A.post('/api/promo/mailer/download', { eventId: 'rich', doc: exDoc });
  G['mailer download, test'] = await A.post('/api/promo/mailer/download', { eventId: 'rich', doc: exDoc, test: true });
  G['mailer AI'] = await A.post('/api/promo/mailer/ai', { eventId: 'rich', action: 'subjects', doc: exDoc });
  G['mailer /doc options'] = await A.post('/api/promo/mailer/doc', { eventId: 'rich', mailerId: 'mailer.announcement', fresh: true, params: { photo: EX_PHOTO } });
  /* a saved version that somehow holds an example (written straight to the store): deliverables, the export choke point */
  DOCS['events/rich/mailerSaves/sexample'] = { mailerId: 'mailer.speakers', name: 'Sneaked in', subject: 's', doc: JSON.stringify(exDoc), savedAt: Date.now() + 60000 };
  G['export choke point (a saved example, downloaded)'] = await A.post('/api/promo/mailer/download', { eventId: 'rich', mailerIds: ['mailer.speakers'] });
  G['export choke point (in a ZIP)'] = await A.post('/api/promo/mailer/download', { eventId: 'rich', mailerIds: ['mailer.announcement', 'mailer.speakers'] });
  delete DOCS['events/rich/mailerSaves/sexample'];
  G['posts AI (promo write)'] = await A.post('/api/promo/write', { eventId: 'rich', task: 'caption', post: { kind: 'speaker', photo: EX_PHOTO } });
  G['social html (not a preview)'] = await A.post('/api/promo/social/html', { eventId: 'rich', items: [{ templateId: 'speaker.individual', format: 'ig_square', params: { speakerId: 'ex-p01' } }] });
  var exBase = (await A.raw('/api/promo/social/layout/base?eventId=rich&key=' + KEY, await png(2160, 2160), 'image/png')).json.url;
  G['social layout save (elements)'] = await A.post('/api/promo/social/layout', { eventId: 'rich', templateId: 'generic.testimonial', format: 'ig_square', theme: 'dark', bg: '', width: 1080, height: 1080,
    base: exBase, elements: [{ id: 'e0', type: 'frame', x: 0, y: 0, w: 10, h: 10, src: EX_PHOTO }], params: {}, caption: null });
  G['social layout save (options)'] = await A.post('/api/promo/social/layout', { eventId: 'rich', templateId: 'generic.testimonial', format: 'ig_square', theme: 'dark', bg: '', width: 1080, height: 1080,
    base: exBase, elements: [], params: { speakerId: 'ex-p03' }, caption: null });
  var svgEx = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><image href="' + EX_PHOTO + '" width="40" height="40"/></svg>');
  G['social art upload (an SVG naming an example)'] = await A.raw('/api/promo/social/art?eventId=rich&slot=bg2&from=upload', svgEx, 'image/svg+xml');
  G['social picture upload (an SVG naming an example)'] = await A.raw('/api/promo/social/picture?eventId=rich', svgEx, 'image/svg+xml');
  G['social PSD summary'] = await A.post('/api/promo/social/art/psd', { eventId: 'rich', name: 'from ' + examples.EXAMPLE_PATH + 'logos/l02.png', bytes: 1, canvasWidth: 10, canvasHeight: 10, found: { background: false, logoUnit: false } });
  Object.keys(G).forEach(function (k) { check('8: example content refused 422 code example — ' + k, is422(G[k]), [G[k].status, G[k].json]); });
  var site = await A.post('/api/event/promo-templates', { eventId: 'rich', kind: 'post', name: 'Copied preview', body: JSON.stringify({ photo: EX_PHOTO }) });
  check('8: a saved Site-look post holding an example is refused (checkPromoBody, 400 with the sentence)', site.status === 400 && /holds example content, which can never be saved\./.test((site.json || {}).error || ''), [site.status, site.json]);
  var unav = await A.post('/api/promo/mailer/doc', { eventId: 'sparse', mailerId: 'mailer.speakers', fresh: true });
  check('8: a fresh build of a mailer the event cannot have: 409 unavailable with what is missing', unav.status === 409 && unav.json.code === 'unavailable' && Array.isArray(unav.json.missing) && unav.json.missing.length > 0, unav.json);
  check('8: nothing example-filled was ever written', !Object.keys(DOCS).some(function (k) { return k.indexOf('events/rich/mailerSaves/') === 0 && examples.isExample(DOCS[k]); }) &&
    !Object.keys(DOCS).some(function (k) { return k.indexOf('promoSocialLayouts') !== -1 && examples.isExample(DOCS[k]); }) && !Object.keys(DOCS).some(function (k) { return k.indexOf('promoTemplates') !== -1; }));

  /* ======== 9. activity, the Kit reads, and nothing went outside ======== */
  var acts = Object.keys(DOCS).filter(function (k) { return k.indexOf('events/rich/activity/') === 0; }).map(function (k) { return JSON.stringify(DOCS[k]); }).join('\n');
  ['Post art: Background 1 uploaded', 'Post art: Logo from the PSD cleared by a new PSD', 'Post picture uploaded', 'Post layout saved: ', 'Post layout reset: '].forEach(function (s) {
    check('9: activity logged — ' + s, acts.indexOf(s) !== -1);
  });
  check('9: no AI model and no network was called', OUTSIDE.length === 0, OUTSIDE);
  check('9: the Kit was read through buildKit', KIT_CALLS > 0);
  check('9: nothing unexpected was logged', !LOGS.some(function (l) { return /failed —|could not be (loaded|read|drawn|recorded)|TypeError|ReferenceError/.test(l); }), LOGS.slice(0, 8));

  /* ======== optional: the whole suite against the base's failures (plan §8c step 3) ======== */
  if (process.argv.indexOf('--suite') !== -1) {
    var cpm = require('child_process');
    var baseFile = process.env.PROMO_SUITE_BASE || path.join(ROOT, '..', 'suite-base.txt');
    var baseFails = fs.existsSync(baseFile) ? fs.readFileSync(baseFile, 'utf8').split('\n').map(function (l) { return l.replace(/^FAIL\s+/, '').trim(); }).filter(Boolean) : null;
    check('suite: the base\'s list of failures is there (PROMO_SUITE_BASE)', baseFails !== null, baseFile);
    var tests = fs.readdirSync(__dirname).filter(function (f) { return /\.test\.js$/.test(f) && f !== path.basename(__filename); }).sort(), now = [], why = {};
    tests.forEach(function (f) {
      /* each test runs as `node <file>` would from the worktree, with the environment it would have there, not this
         test's (which signs everyone in under one domain and drops the keys); a failure keeps its last lines, so
         the owning unit has something to act on */
      var r = cpm.spawnSync(process.execPath, [path.join(__dirname, f)], { cwd: ROOT, env: SUITE_ENV, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) {
        now.push('functions/lib/' + f);
        why['functions/lib/' + f] = (r.status === null ? 'killed by ' + r.signal + '; ' : 'exit ' + r.status + '; ') +
          String((r.stderr || '') + '\n' + (r.stdout || '')).split('\n').filter(function (l) { return /FAIL|Error|passed|failed/.test(l); }).slice(-6).join(' | ').slice(0, 600);
      }
    });
    var fresh = now.filter(function (f) { return (baseFails || []).indexOf(f) === -1; });
    check('suite: no failure the base did not have (' + tests.length + ' files)', fresh.length === 0, fresh.map(function (f) { return f + ' — ' + why[f]; }));
  }

  /* P3_DEBUG=1: what the modules logged on the way (they log to console.error, held here) */
  if (process.env.P3_DEBUG) LOGS.forEach(function (l) { realError('log: ' + l.slice(0, 300)); });
  console.log('promo-phase3-integration: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { realError(err && err.stack || err); process.exit(1); });
