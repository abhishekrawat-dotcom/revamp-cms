// node functions/lib/promo-social.test.js — Promotions → Social posts (lib/promo-social.js): the platform's nine post
// templates on a Oneworld event, through every route of the file — the catalog, the template HTML (with card
// previews, the QR code and the uploaded art), the art uploads and the PSD summary, Remove, saved layouts (their
// checks, races and tidy-up), "Upload a picture", sign-in and event checks, and the example-content guards.
// The engine is the real one (vendor/promo-engine.js); so are sharp and lib/promo.js's picture-address rule.
// lib/promo-examples.js (the example fill and its markers) is the real one when it is there, seen through a spy
// that can make one fill fail; only when the file is missing does a stand-in answer as the contract (plan §8a
// C14) says it does. lib/promo-mailer.js (the event) stands in with the fixtures below. Firestore and Storage
// are in memory, with transactions that can be paused between read and write. No network beyond a local server
// on 127.0.0.1 for the "413 while the browser keeps sending" check. Exits 1 on any failure.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const { PassThrough } = require('stream');
delete process.env.K_SERVICE;

var passed = 0, failed = 0;
var realError = console.error.bind(console), LOGS = [];
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; realError('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
console.error = function () { LOGS.push([].slice.call(arguments).join(' ')); };
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var KB = 1024, MB = 1024 * 1024;
var BASE = 'https://revamp.example', BUCKET = 'bkt';

const engine = require('./vendor/promo-engine');
const promo = require('./promo');
const { sendJson } = require('./http');
const sharp = require('sharp');

/* ---------- lib/promo-mailer.js's stand-in and lib/promo-examples.js's spy, resolved before the file system ---------- */

var EVENTS = {};
var MAILER = {
  wired: [],
  wire: function (h) { MAILER.wired.push(h); },
  /* eventFor -> { ev, stored, kit, banner } (plan §8a C9); here from the fixtures below */
  eventFor: function (fb, eventId) {
    var e = EVENTS[eventId];
    if (!e || e.deleted) return Promise.reject(httpError(404, 'No event found for "' + eventId + '".', { code: 'event-not-found' }));
    return Promise.resolve({ ev: clone(e.ev), stored: clone(e.stored), kit: clone(e.kit), banner: { needed: false, fresh: false } });
  }
};
var EX_PATH = '/assets/promo-examples/';
var EXAMPLE_PERSON = { id: 'ex-p01', name: 'Meera Kulkarni', designation: 'Chief Executive Officer', company: 'Tarqen Systems', photoUrl: BASE + EX_PATH + 'people/p01.jpg', group: undefined, weightage: 99 };
var EXAMPLE_PARTNER = { id: 'ex-l01', title: 'Tarqen Systems', logoUrl: BASE + EX_PATH + 'logos/l01.png', tier: 'Gold Partner', weightage: 1 };
/* The stand-in, used only while lib/promo-examples.js is not in the tree. It answers as the contract says, with
   the real module's marks (the meta tag and a data-oneworld-example ribbon), so the checks below hold for both. */
var STAND_IN = {
  EXAMPLE_PATH: EX_PATH,
  /* the three markers of plan §5h: the library's folder in an address, an ex- id, the meta tag */
  isExample: function (x) {
    var s = typeof x === 'string' ? x : JSON.stringify(x === undefined ? null : x);
    return s.indexOf(EX_PATH) !== -1 || /"ex-[pls][0-9a-z]/i.test(s) || s.indexOf('<meta name="oneworld-example"') !== -1;
  },
  /* only the gap: a list the real event fails the gate on, topped up; a state gap never filled */
  fillFor: function (id, ev, params) {
    var ev2 = clone(ev), p2 = Object.assign({}, params), filled = [];
    if (id === 'generic.announcement' && !ev.dateLabel && !ev.venue && !ev.city) return { ev: ev2, params: p2, filled: [], state: 'no-date-venue' };
    if (id === 'generic.who-should-attend' && !ev.whoShouldAttend.length) { ev2.whoShouldAttend = ['Chief Information Officers', 'Heads of Data']; filled.push('audience'); }
    if (id === 'generic.summit-highlights' && !ev.stats.length) { ev2.stats = [{ value: '40+', label: 'Speakers' }]; filled.push('stats'); }
    if (/^partner\./.test(id) && !ev.sponsorTiers.length) { ev2.sponsorTiers = [{ tier: 'Gold Partner', sponsors: [EXAMPLE_PARTNER] }]; filled.push('sponsors'); }
    if (/^speaker\./.test(id) && ev.speakers.length < 2) {
      ev2.speakers = ev.speakers.concat([EXAMPLE_PERSON, Object.assign({}, EXAMPLE_PERSON, { id: 'ex-p02', name: 'Pranav Kamath' })]);
      filled.push('speakers');
    }
    if (id === 'generic.testimonial' && !String(params.quote || '').trim()) {
      p2.quote = 'An example of what a delegate might say.';
      ev2.speakers = ev.speakers.concat([EXAMPLE_PERSON]);
      p2.speakerId = EXAMPLE_PERSON.id;
      filled.push('quote');
    }
    return { ev: ev2, params: p2, filled: filled, state: '' };
  },
  markPostHtml: function (html, filled) {
    return html.replace('<head>', '<head><meta name="oneworld-example" content="' + filled.join(',') + '">')
      .replace('</body>', '<div data-oneworld-example="1" aria-label="Example">EXAMPLE</div></body>');
  },
  markMailHtml: function (html) { return html; }
};
/* by its full path: Node remembers what "./promo-examples" named for this folder, and promo-social.js must get the spy */
var REAL_EXAMPLES_FILE = path.join(__dirname, 'promo-examples.js');
var EX_IMPL = fs.existsSync(REAL_EXAMPLES_FILE) ? require(REAL_EXAMPLES_FILE) : STAND_IN;
/* What promo-social.js gets: the module above, with every fill noted (what it was asked, what it answered) and one
   switch, EX.unfixable, that makes a fill come back without filling the gap (the "could not complete" case, which
   the real library never meets on these fixtures). */
var EX = { calls: [], unfixable: false };
var EXAMPLES = {
  EXAMPLE_PATH: EX_IMPL.EXAMPLE_PATH,
  isExample: function (x) { return EX_IMPL.isExample(x); },
  fillFor: function (id, ev, params, opts) {
    var call = { id: id, opts: opts, out: null };
    EX.calls.push(call);
    if (EX.unfixable) call.out = { ev: clone(ev), params: Object.assign({}, params), filled: ['speakers'], state: '' };
    else call.out = EX_IMPL.fillFor(id, ev, params, opts);
    return call.out;
  },
  markPostHtml: function (html, filled) { return EX_IMPL.markPostHtml(html, filled); },
  markMailHtml: function (html, filled) { return EX_IMPL.markMailHtml(html, filled); }
};
var STUBS = {
  './promo-mailer': { file: path.join(__dirname, '__stub-promo-mailer.js'), exports: MAILER },
  './promo-examples': { file: path.join(__dirname, '__stub-promo-examples.js'), exports: EXAMPLES }
};
var realResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (own(STUBS, request)) return STUBS[request].file;
  return realResolve.apply(this, arguments);
};
Object.keys(STUBS).forEach(function (k) { var s = STUBS[k]; require.cache[s.file] = { id: s.file, filename: s.file, loaded: true, exports: s.exports, children: [], paths: [] }; });

const mod = require('./promo-social');
const T = mod._test;
const NUM = T.NUMBERS, DEFAULT_NUMBERS = clone(NUM);

/* ---------- Firestore in memory, transactions that retry on a stale read (as Firestore's do) and can be paused ---------- */

var DOCS = {}, VERS = {}, ADDS = 0;
function snapOf(p) { var d = DOCS[p]; return { id: p.split('/').pop(), exists: d !== undefined, data: function () { return clone(d); } }; }
function bump(p) { VERS[p] = (VERS[p] || 0) + 1; }
function applyWrite(w) {
  var p = w.path;
  if (w.op === 'delete') { delete DOCS[p]; bump(p); return; }
  if (w.op === 'set' && !(w.opts && w.opts.merge)) DOCS[p] = clone(w.data);
  else DOCS[p] = Object.assign({}, DOCS[p] || {}, clone(w.data));
  bump(p);
}
function docRef(p) {
  return {
    path: p, id: p.split('/').pop(),
    collection: function (c) { return colRef(p + '/' + c); },
    get: function () { return Promise.resolve(snapOf(p)); },
    set: function (data, opts) { applyWrite({ op: 'set', path: p, data: data, opts: opts }); return Promise.resolve(); },
    delete: function () { applyWrite({ op: 'delete', path: p }); return Promise.resolve(); }
  };
}
function colRef(p) {
  return {
    doc: function (id) { return docRef(p + '/' + id); },
    add: function (data) { var id = 'a' + (++ADDS); applyWrite({ op: 'set', path: p + '/' + id, data: data }); return Promise.resolve(docRef(p + '/' + id)); }
  };
}
/* TX.pause(pathPart): the next transaction that read a document whose path holds pathPart stops just before it
   commits; TX.paused resolves when it has, TX.go() lets it commit (or find its read stale, and run again) */
var TX = { want: '', go: null, paused: null, onPause: null, attempts: [] };
TX.pause = function (part) { TX.want = part; TX.paused = new Promise(function (r) { TX.onPause = r; }); };
var DB = {
  collection: function (c) { return colRef(c); },
  runTransaction: function (fn) {
    var tries = 0;
    function attempt() {
      tries++;
      var reads = {}, writes = [];
      var t = {
        get: function (ref) { reads[ref.path] = VERS[ref.path] || 0; return Promise.resolve(snapOf(ref.path)); },
        set: function (ref, data, opts) { writes.push({ op: 'set', path: ref.path, data: clone(data), opts: opts }); return t; },
        update: function (ref, data) { writes.push({ op: 'set', path: ref.path, data: clone(data), opts: { merge: true } }); return t; },
        delete: function (ref) { writes.push({ op: 'delete', path: ref.path }); return t; }
      };
      return Promise.resolve().then(function () { return fn(t); }).then(function (result) {
        var hold = Promise.resolve();
        if (TX.want && Object.keys(reads).some(function (p) { return p.indexOf(TX.want) !== -1; })) {
          TX.want = '';
          hold = new Promise(function (go) { TX.go = go; TX.onPause(); });
        }
        return hold.then(function () {
          var stale = Object.keys(reads).some(function (p) { return (VERS[p] || 0) !== reads[p]; });
          if (stale) {
            if (tries >= 5) throw new Error('fake: too much contention');
            TX.attempts.push('retry');
            return attempt();
          }
          writes.forEach(applyWrite);
          return result;
        });
      });
    }
    return attempt();
  }
};

/* Storage in memory */
var OBJECTS = {};
function nf() { var e = new Error('No such object'); e.code = 404; return e; }
var BUCKETOBJ = {
  name: BUCKET,
  file: function (name) {
    return {
      name: name,
      save: function (data, opts) { OBJECTS[name] = { data: Buffer.from(data), metadata: (opts && opts.metadata) || {}, public: false }; return Promise.resolve(); },
      makePublic: function () { if (!OBJECTS[name]) return Promise.reject(nf()); OBJECTS[name].public = true; return Promise.resolve(); },
      getMetadata: function () { return OBJECTS[name] ? Promise.resolve([{ name: name, contentType: OBJECTS[name].metadata.contentType }]) : Promise.reject(nf()); },
      delete: function () { if (!OBJECTS[name]) return Promise.reject(nf()); delete OBJECTS[name]; return Promise.resolve(); }
    };
  },
  getFiles: function (o) {
    var p = (o && o.prefix) || '';
    return Promise.resolve([Object.keys(OBJECTS).filter(function (n) { return n.indexOf(p) === 0; }).sort().map(function (n) { return BUCKETOBJ.file(n); })]);
  }
};
var FB = { db: DB, bucket: BUCKETOBJ };
function objectsUnder(prefix) { return Object.keys(OBJECTS).filter(function (n) { return n.indexOf(prefix) === 0; }); }
function activity(eventId) {
  return Object.keys(DOCS).filter(function (p) { return p.indexOf('events/' + eventId + '/activity/') === 0; }).map(function (p) { return DOCS[p].detail; });
}

/* ---------- lib/api.js's helpers, as it hands them over (promoHelpers), with spies ---------- */

function httpError(status, message, extra) { var e = new Error(message); e.status = status; e.body = Object.assign({ error: message }, extra || {}); return e; }
var DECODED = { email: 'maker@timesinternet.in' };
var SPY = { admin: 0, ids: 0, live: [], limits: [] };
var FAILS = [];
var H = {
  BODY_LIMITS: { ai: 2 * MB, small: 256 * KB, tiny: 16 * KB },
  withAdmin: function (req, res, cb) {
    SPY.admin++;
    if ((req.headers || {}).authorization !== 'Bearer ok') return sendJson(res, 401, { error: 'Sign in required.' });
    cb(FB, DECODED);
  },
  withAdminBody: function (req, res, limit, cb) {
    SPY.limits.push(limit);
    H.withAdmin(req, res, function (fb, decoded) {
      var raw = JSON.stringify(req.body || {});
      if (Buffer.byteLength(raw, 'utf8') > limit) return sendJson(res, 413, { error: 'That request is too large.' });
      cb(fb, decoded, JSON.parse(raw));
    });
  },
  eventIdOr400: function (res, v) {
    SPY.ids++;
    var id = typeof v === 'string' ? v.trim() : '';
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) { sendJson(res, 400, { error: 'eventId is required.' }); return ''; }
    return id;
  },
  loadLiveEvent: function (fb, id) {
    SPY.live.push(id);
    var e = EVENTS[id];
    if (!e) return Promise.reject(httpError(404, 'No event found for "' + id + '".', { code: 'event-not-found' }));
    if (e.deleted) return Promise.reject(httpError(404, 'This event has been deleted.', { code: 'event-deleted' }));
    return Promise.resolve(clone(e.stored));
  },
  publicBaseFor: function () { return BASE; },
  sendFailure: function (res, what, err, friendly) {
    if (err && err.status && err.body) return sendJson(res, err.status, err.body);
    FAILS.push(what + ': ' + (err && err.stack || err));
    sendJson(res, 500, { error: friendly });
  },
  httpError: httpError
};
mod.wire(H);

/* ---------- the events ---------- */

var person = function (id, name, designation, company, group, photo) {
  return { id: id, name: name, designation: designation, company: company, photoUrl: photo || undefined, group: group, weightage: +id.slice(1) };
};
var richSponsors = [
  { id: 'p1', title: 'Kyndryl', tier: 'Presenting Partner', logoUrl: 'https://img.etb2bimg.com/files/kyndryl.png' },
  { id: 'p2', title: 'Infosys', tier: 'Gold Partner', logoUrl: 'https://img.etb2bimg.com/files/infosys.png' },
  { id: 'p3', title: 'Wipro', tier: 'Gold Partner', logoUrl: 'https://img.etb2bimg.com/files/wipro.png' },
  { id: 'p4', title: 'Zoho', tier: 'Associate Partner', logoUrl: 'https://img.etb2bimg.com/files/zoho.png' },
  { id: 'p5', title: 'Freshworks', tier: 'Associate Partner' },
  { id: 'p6', title: 'Razorpay', tier: 'Associate Partner', logoUrl: 'https://img.etb2bimg.com/files/razorpay.png' }
];
var richEv = {
  portal: 'cio', entityId: 0, oneworldId: 'rich', name: 'Agentic AI Summit 2027', edition: 9, tagline: 'Where AI goes to work',
  description: 'Chief information officers on putting AI agents to work.', hashtag: '#AgenticAiSummit27',
  startDate: '2027-03-10', endDate: '2027-03-11', dateLabel: '10–11 March, 2027', totalDays: 2,
  venue: 'Jio World Centre', city: 'Mumbai', ctaLabel: 'Register Now', ctaUrl: BASE + '/e/rich#register',
  logoUrl: 'https://img.etb2bimg.com/files/aas-logo.png', keyVisualUrl: BASE + '/templates/x/hero.jpg', keyVisualMode: 'hero',
  micrositeUrl: BASE + '/e/rich', siteAccent: '#c8102e', siteTheme: 'dark',
  whoShouldAttend: ['Chief Information Officers', 'Chief Technology Officers', 'Heads of AI'], keyPoints: ['Agents at work', 'Governance'], whyJoin: [],
  stats: [{ value: '60+', label: 'Speakers' }, { value: '2', label: 'Days' }],
  speakers: [
    person('s1', 'Asha Rao', 'CIO', 'Tata Steel', 'Keynote', 'https://img.etb2bimg.com/files/asha.jpg'),
    person('s2', 'अनन्या शर्मा', 'CTO', 'Bharat Bank', 'Keynote', 'https://img.etb2bimg.com/files/ananya.jpg'),
    person('s3', 'O\'Brien "QA" <b>x</b>', 'Head of Data', 'Acme & Sons', 'Keynote'),
    person('s4', 'Vikram Shah', 'CDO', 'MedCo', 'Panel', 'https://img.etb2bimg.com/files/vikram.jpg'),
    person('s5', 'Neha Iyer', 'CISO', 'Airtel', 'Panel'),
    person('s6', 'Rahul Gupta', 'VP Engineering', 'Swiggy', 'Panel'),
    person('s7', 'Priya Nair', 'CIO', 'Apollo', 'Panel'),
    person('s8', 'Arjun Mehta', 'CTO', 'Zerodha', 'Panel')
  ],
  sponsorTiers: engine.groupSponsors(richSponsors.map(function (s, i) { return Object.assign({ weightage: i + 1 }, s); })),
  sessions: [{ id: 'x1', title: 'Keynote: agents at work', start: '10:00', end: '10:45', speakers: [] }],
  award: undefined
};
var sparseEv = {
  portal: '', entityId: 0, oneworldId: 'sparse', name: 'Retail Leaders Forum', hashtag: '', dateLabel: '5 June, 2027', startDate: '2027-06-05',
  city: 'Pune', ctaLabel: 'Register Now', micrositeUrl: BASE + '/e/sparse', siteTheme: 'light', keyVisualMode: 'hero',
  whoShouldAttend: [], keyPoints: [], whyJoin: [], stats: [], speakers: [], sponsorTiers: [], sessions: []
};
var bareEv = Object.assign({}, sparseEv, { oneworldId: 'bare', name: 'Untitled Roundtable', dateLabel: undefined, startDate: undefined, city: undefined, micrositeUrl: undefined });
EVENTS.rich = { ev: richEv, stored: { createdAt: '2026-10-01T00:00:00.000Z', published: true, templateId: 'imported-imp1' },
  kit: { event: { published: true, siteUrl: BASE + '/e/rich', registerUrl: BASE + '/e/rich#register' } } };
EVENTS.sparse = { ev: sparseEv, stored: { createdAt: '2026-10-02T00:00:00.000Z' }, kit: { event: { published: false, siteUrl: BASE + '/e/sparse', registerUrl: BASE + '/e/sparse' } } };
EVENTS.bare = { ev: bareEv, stored: { createdAt: '2026-10-03T00:00:00.000Z' }, kit: { event: { published: false, siteUrl: BASE + '/e/bare', registerUrl: BASE + '/e/bare' } } };
EVENTS.gone = { ev: sparseEv, stored: {}, kit: { event: {} }, deleted: true };

/* ---------- one request through a route ---------- */

/* o: { url, body (JSON routes), raw (Buffer, raw routes), method, auth (default true), length (Content-Length; false = none) }
   -> { status, json, body } */
function call(handler, o) {
  return new Promise(function (resolve) {
    var res = { status: 0, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k] = v; },
      writeHead: function (s, h) { res.status = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      end: function (b) {
        var json = null;
        if (typeof b === 'string') { try { json = JSON.parse(b); } catch (e) { /* not JSON */ } }
        resolve({ status: res.status, headers: res.headers, body: b, json: json || {} });
      } };
    var headers = o.auth === false ? {} : { authorization: 'Bearer ok' };
    var req;
    if (o.raw) {
      req = new PassThrough();
      if (o.length !== false) headers['content-length'] = String(o.length != null ? o.length : o.raw.length);
      req.end(o.raw);
    } else req = { body: o.body };
    req.method = o.method || (o.body || o.raw ? 'POST' : 'GET');
    req.url = o.url;
    req.headers = headers;
    handler(req, res);
  });
}
function post(handler, url, body) { return call(handler, { url: url, body: body }); }
function upload(handler, url, raw, extra) { return call(handler, Object.assign({ url: url, raw: raw }, extra || {})); }

/* pictures made here with sharp */
function png(w, h, colour) { return sharp({ create: { width: w, height: h, channels: 4, background: colour || { r: 30, g: 60, b: 120, alpha: 1 } } }).png().toBuffer(); }
function noisePng(w, h) {
  var px = Buffer.alloc(w * h * 3);
  for (var i = 0; i < px.length; i++) px[i] = (i * 2654435761 >>> 13) & 255;
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
function fringed() {
  /* a dark box on white, with a faint near-white smudge further out: trim({ threshold: 1 }) keeps the smudge
     (160 × 90), the default trim drops it (100 × 50) */
  var W = 300, Hh = 200, px = Buffer.alloc(W * Hh * 4, 255);
  var set = function (x, y, v) { var i = (y * W + x) * 4; px[i] = v[0]; px[i + 1] = v[1]; px[i + 2] = v[2]; px[i + 3] = 255; };
  for (var y = 60; y < 110; y++) for (var x = 80; x < 180; x++) set(x, y, [20, 30, 200]);
  for (var y2 = 20; y2 < 24; y2++) for (var x2 = 20; x2 < 24; x2++) set(x2, y2, [250, 250, 250]);
  return sharp(px, { raw: { width: W, height: Hh, channels: 4 } }).png().toBuffer();
}
function artDoc(eventId) { return DOCS['events/' + eventId + '/promoSocial/art'] || {}; }
function layoutDoc(eventId, key) { return DOCS['events/' + eventId + '/promoSocialLayouts/' + key]; }
var ART = '/api/promo/social/art?eventId=';

/* a layout's elements as the browser's flattener writes them (the platform's renderer.ts walk) */
function sampleEls() {
  return [
    { id: 'e0', type: 'shape', x: 64.8, y: 900, w: 950.4, h: 300, rotate: 0, background: 'rgba(8, 10, 22, 0.34)', backdropFilter: 'blur(16px) saturate(1.15)',
      border: '1px solid rgba(255, 255, 255, 0.16)', radius: '32.4px', boxShadow: 'rgba(0, 0, 0, 0.28) 0px 16.2px 43.2px 0px' },
    { id: 'e1', type: 'text', x: 64.8, y: 120, w: 700, h: 80, rotate: 0, text: 'Agentic AI Summit 2027', fontFamily: '"Inter", system-ui, sans-serif', fontSize: 71.28,
      fontWeight: '700', fontStyle: 'normal', color: 'rgb(255, 255, 255)', textAlign: 'start', lineHeight: '72.7056px', letterSpacing: '-0.7128px',
      textTransform: 'none', textShadow: 'rgba(0, 0, 0, 0.22) 0px 4.32px 21.6px', whiteSpace: 'nowrap', background: 'rgba(0, 0, 0, 0)',
      backdropFilter: 'none', padding: '0px', radius: '0px', boxShadow: 'none' },
    { id: 'e2', type: 'image', x: 64.8, y: 40, w: 300, h: 100, rotate: 0, src: 'https://img.etb2bimg.com/files/aas-logo.png', objectFit: 'contain',
      objectPosition: '0% 50%', radius: '0px', background: 'rgba(0, 0, 0, 0)', padding: '0px' },
    { id: 'e3', type: 'frame', x: 600, y: 300, w: 300, h: 300, rotate: 0, radius: '150px', border: 'none', boxShadow: 'none', background: 'rgba(255, 255, 255, 0.1)',
      src: 'https://img.etb2bimg.com/files/asha.jpg', objectFit: 'cover', objectPosition: '50% 0%', imgScale: 1, imgX: 0, imgY: 0, imgRotate: 0,
      scrim: 'linear-gradient(rgba(0, 0, 0, 0) 40%, rgba(0, 0, 0, 0.6) 100%)' }
  ];
}
var LAYOUT_URL = '/api/promo/social/layout';
function baseUrlFor(handlerAnswer) { return handlerAnswer.json.url; }
function uploadBase(eventId, key, raw) { return upload(mod.handleLayoutBase, LAYOUT_URL + '/base?eventId=' + eventId + '&key=' + encodeURIComponent(key), raw); }
function saveBody(eventId, o) {
  return Object.assign({ eventId: eventId, templateId: 'speaker.individual', format: 'ig_portrait', theme: 'light', bg: '2', width: 1080, height: 1350,
    elements: sampleEls(), params: { speakerId: 's1', roleLabel: 'Keynote speaker' }, caption: { network: 'linkedin', text: null } }, o || {});
}
var KEY = 'speaker.individual__ig_portrait__light_bg2';
var portraitBase = null;   // a 2160 × 2700 PNG, made once
function basePng() { return portraitBase ? Promise.resolve(portraitBase) : png(2160, 2700).then(function (b) { portraitBase = b; return b; }); }

var steps = [

  /* ===== C.9 cold wiring ===== */
  function () {
    check('C.9 wire() wires lib/promo-mailer.js with the same helpers (a cold instance\'s first social request works)', MAILER.wired.length === 1 && MAILER.wired[0] === H);
    check('module: every route of ROUTES is an exported handler', Object.keys(mod.ROUTES).length === 11 &&
      Object.keys(mod.ROUTES).every(function (r) { return typeof mod[mod.ROUTES[r]] === 'function'; }));
    /* lib/api.js (Unit D) routes to these names: when its lines are there, they must match */
    var api = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
    var wired = {};
    (api.match(/'(GET|POST|DELETE|PUT|PATCH) \/api\/promo\/social\/[^']*': promoSocial\('[A-Za-z]+'\)/g) || []).forEach(function (l) {
      var m = /'([^']+)': promoSocial\('([A-Za-z]+)'\)/.exec(l); wired[m[1]] = m[2];
    });
    if (Object.keys(wired).length) check('module: lib/api.js routes each social path to this file\'s handler of that name', JSON.stringify(wired) === JSON.stringify(mod.ROUTES), wired);
  },

  /* ===== C.1 catalog ===== */
  function () {
    return Promise.all([call(mod.handleCatalog, { url: '/api/promo/social/catalog?eventId=rich' }), call(mod.handleCatalog, { url: '/api/promo/social/catalog?eventId=sparse' })]).then(function (r) {
      var a = r[0].json, b = r[1].json;
      check('C.1 catalog answers 200 for both events', r[0].status === 200 && r[1].status === 200, [r[0].status, r[1].status, r[0].json, r[1].json]);
      check('C.1 the platform\'s shape: event, formats, catalog', a.event && Array.isArray(a.formats) && a.catalog && Array.isArray(a.catalog.categories));
      check('C.1 the event\'s header facts', a.event.name === richEv.name && a.event.hashtag === '#AgenticAiSummit27' && a.event.edition === 9 && a.event.dateLabel === richEv.dateLabel, a.event);
      check('C.1 venue, else the city', a.event.venue === 'Jio World Centre' && b.event.venue === 'Pune', [a.event.venue, b.event.venue]);
      check('C.1 counts of speakers, partner tiers, sessions', a.event.counts.speakers === 8 && a.event.counts.sponsorTiers === 3 && a.event.counts.sessions === 1 && b.event.counts.speakers === 0, a.event.counts);
      check('C.1 the site\'s address only while it is published', a.event.micrositeUrl === BASE + '/e/rich' && !own(b.event, 'micrositeUrl'), [a.event.micrositeUrl, b.event]);
      check('C.1 link and published', a.event.link === BASE + '/e/rich#register' && a.event.published === true && b.event.link === '' && b.event.published === false, [a.event.link, b.event.link]);
      check('C.1 the four formats, each with its id', a.formats.map(function (f) { return f.id + ':' + f.width + 'x' + f.height; }).join() === 'ig_square:1080x1080,ig_portrait:1080x1350,landscape:1200x675,story:1080x1920', a.formats);
      var tpls = [].concat.apply([], a.catalog.categories.map(function (c) { return c.templates; }));
      check('C.1 the nine templates, 5/2/2', tpls.length === 9 && a.catalog.categories.map(function (c) { return c.templates.length; }).join() === '5,2,2');
      var qrLast = tpls.every(function (t) {
        var n = t.params.length, own2 = engine.getTemplate(t.id).params.map(function (p) { return p.key; });
        return n >= 3 && t.params[n - 2].key === 'qr' && t.params[n - 1].key === 'qrLabel' && t.params[0].key === 'theme' &&
          t.params.slice(1, n - 2).map(function (p) { return p.key; }).join() === own2.join();
      });
      check('C.1 published: the two QR options come after each template\'s own options', qrLast);
      var qr = tpls[0].params[tpls[0].params.length - 2], ql = tpls[0].params[tpls[0].params.length - 1];
      check('C.1 QR code option: label, select, default on, two choices, hint naming the address', qr.label === 'QR code' && qr.type === 'select' && qr.default === 'on' &&
        JSON.stringify(qr.options) === JSON.stringify([{ value: 'on', label: 'Show the QR code' }, { value: 'off', label: 'No QR code' }]) &&
        qr.hint === 'Points to ' + BASE + '/e/rich#register. Shown only while the site is published.', qr);
      check('C.1 QR caption option: label, text, default, hint', ql.label === 'QR code caption' && ql.type === 'text' && ql.default === 'Scan to register' &&
        ql.hint === 'Leave it empty for “Scan to register”. To leave the QR code out, choose No QR code.', ql);
      var sTpls = [].concat.apply([], b.catalog.categories.map(function (c) { return c.templates; }));
      check('C.1 not published: no QR option anywhere', sTpls.every(function (t) { return t.params.every(function (p) { return p.key !== 'qr' && p.key !== 'qrLabel'; }); }));
      check('C.1 availability is the engine\'s (the sparse event lacks speakers)', sTpls.filter(function (t) { return t.id === 'speaker.individual'; })[0].available === false);
    });
  },

  /* the presenter rule, straight */
  function () {
    return Promise.all([T.socialEventFor(FB, 'rich', {}), T.socialEventFor(FB, 'sparse', {})]).then(function (r) {
      check('presenter: the first partner of the presenting tier', r[0].ev.presenter === 'Kyndryl', r[0].ev.presenter);
      check('presenter: else the portal\'s own name (the platform\'s brand presenter)', r[1].ev.presenter === engine.getBrand('').presenter, r[1].ev.presenter);
      check('qrUrl: the registration address while published, else none', r[0].ev.qrUrl === BASE + '/e/rich#register' && r[1].ev.qrUrl === '');
      var titled = clone(richEv);
      titled.sponsorTiers = [{ tier: 'Title Sponsor', sponsors: [{ id: 'q', title: 'HCL' }] }].concat(titled.sponsorTiers.slice(1));
      EVENTS.titled = { ev: titled, stored: EVENTS.rich.stored, kit: EVENTS.rich.kit };
      return T.socialEventFor(FB, 'titled', {}).then(function (t) { check('presenter: a "title" tier counts too', t.ev.presenter === 'HCL', t.ev.presenter); delete EVENTS.titled; });
    });
  },

  /* ===== C.2a the html route ===== */
  function () {
    var all = [];
    engine.ALL_TEMPLATES.forEach(function (t) { engine.DEFAULT_FORMATS.forEach(function (f) { all.push({ templateId: t.id, format: f, params: {} }); }); });
    var H1 = '/api/promo/social/html';
    return Promise.all([
      post(mod.handleHtml, H1, { eventId: 'rich', items: all.slice(0, 1) }),
      post(mod.handleHtml, H1, { eventId: 'rich', items: all }),
      post(mod.handleHtml, H1, { eventId: 'rich', items: all.concat([all[0]]) }),
      post(mod.handleHtml, H1, { eventId: 'rich', items: [] }),
      post(mod.handleHtml, H1, { eventId: 'rich', items: 'x' }),
      post(mod.handleHtml, H1, { eventId: 'rich', items: [{ templateId: 'generic.announcement', format: 'constructor', params: 'x' }, { templateId: 'nope', format: 'ig_square' }, { templateId: 'toString' }] })
    ]).then(function (r) {
      check('C.2a one item', r[0].status === 200 && r[0].json.items.length === 1 && /<\/html>/.test(r[0].json.items[0].html), r[0].json);
      check('C.2a 36 items: every template in every format, all HTML', r[1].status === 200 && r[1].json.items.length === 36 && r[1].json.items.every(function (i) { return typeof i.html === 'string' && !i.error; }),
        (r[1].json.items || []).filter(function (i) { return i.error; }));
      check('C.2a each item: its template, format and size', r[1].json.items.every(function (it, n) {
        var f = engine.FORMATS[all[n].format]; return it.templateId === all[n].templateId && it.format === f.id && it.width === f.width && it.height === f.height && new RegExp('data-ratio="' + f.ratio + '"').test(it.html);
      }));
      check('C.2a no undefined / NaN in any post, names escaped, Devanagari intact', r[1].json.items.every(function (it) { return !/undefined|NaN/.test(it.html); }) &&
        r[1].json.items.some(function (it) { return it.html.indexOf('O&#39;Brien') !== -1 || it.html.indexOf('O\'Brien &quot;QA&quot; &lt;b&gt;') !== -1; }) &&
        r[1].json.items.every(function (it) { return it.html.indexOf('<b>x</b>') === -1; }) && r[1].json.items.some(function (it) { return it.html.indexOf('अनन्या शर्मा') !== -1; }));
      check('C.2a 37 items: 400', r[2].status === 400, r[2].json);
      check('C.2a no items, or not a list: 400', r[3].status === 400 && r[4].status === 400);
      var w = r[5].json.items || [];
      check('C.2a format "constructor" is not a format: the portrait size', w[0] && w[0].format === 'ig_portrait' && w[0].width === 1080 && w[0].height === 1350 && /data-ratio="4:5"/.test(w[0].html), w[0]);
      check('C.2a params that are not an object are treated as none', w[0] && typeof w[0].html === 'string' && !w[0].error);
      check('C.2a an unknown template answers on its own item', w[1] && w[1].error === 'unknown template' && w[2] && w[2].error === 'unknown template', [w[1], w[2]]);
    });
  },
  function () {
    /* one template that throws costs its own item only */
    var tpl = engine.getTemplate('generic.prediction-outcome'), real = tpl.render;
    tpl.render = function () { throw new Error('stub: this template is broken'); };
    var before = LOGS.length;
    return post(mod.handleHtml, '/api/promo/social/html', { eventId: 'rich', items: [{ templateId: 'generic.announcement', format: 'ig_square' }, { templateId: tpl.id, format: 'ig_square' }, { templateId: 'speaker.combined', format: 'story' }] }).then(function (r) {
      tpl.render = real;
      var it = r.json.items || [];
      check('C.2a a template that throws: that item says "render failed", the others are drawn', r.status === 200 && it[1].error === 'render failed' && it[1].templateId === tpl.id &&
        typeof it[0].html === 'string' && typeof it[2].html === 'string', it.map(function (x) { return x.error || 'ok'; }));
      check('C.2a … and the fault is logged for us', LOGS.slice(before).some(function (l) { return /a post could not be made \(generic\.prediction-outcome\)/.test(l); }));
    }, function (err) { tpl.render = real; throw err; });
  },

  /* ===== C.2b previews ===== */
  function () {
    var ids = ['generic.who-should-attend', 'generic.summit-highlights', 'partner.tier-ladder', 'partner.presenting-spotlight', 'speaker.individual', 'speaker.combined'];
    var want = { 'generic.who-should-attend': 'audience', 'generic.summit-highlights': 'stats', 'partner.tier-ladder': 'sponsors', 'partner.presenting-spotlight': 'sponsors', 'speaker.individual': 'speakers', 'speaker.combined': 'speakers' };
    EX.calls = [];
    return Promise.all([
      post(mod.handleHtml, '/api/promo/social/html', { eventId: 'sparse', items: ids.map(function (id) { return { templateId: id, format: 'ig_square', params: {}, preview: true }; }) }),
      post(mod.handleHtml, '/api/promo/social/html', { eventId: 'sparse', items: ids.map(function (id) { return { templateId: id, format: 'ig_square', params: {} }; }) }),
      post(mod.handleHtml, '/api/promo/social/html', { eventId: 'bare', items: [{ templateId: 'generic.announcement', format: 'ig_portrait', params: {}, preview: true }, { templateId: 'generic.announcement', format: 'ig_portrait', params: {} }] }),
      post(mod.handleHtml, '/api/promo/social/html', { eventId: 'rich', items: [{ templateId: 'generic.testimonial', format: 'ig_square', params: {}, preview: true }] })
    ]).then(function (r) {
      var pv = r[0].json.items || [];
      check('C.2b preview: each list template comes back drawn, marked as an example', pv.length === 6 && pv.every(function (it) { return it.example === true && typeof it.html === 'string'; }), pv.map(function (x) { return x.error || x.example; }));
      check('C.2b preview: filled names what was filled', pv.every(function (it) { return JSON.stringify(it.filled) === JSON.stringify([want[it.templateId]]); }), pv.map(function (x) { return x.filled; }));
      check('C.2b preview: the meta marker and the visible ribbon are in the HTML', pv.every(function (it) {
        return /<meta name="oneworld-example"/.test(it.html) && /<div data-oneworld-example="1"[^>]*>[\s\S]*EXAMPLE/.test(it.html);
      }), pv.map(function (x) { return x.html && x.html.slice(-400); }));
      check('C.2b preview: every one of them is found by the guards (isExample)', pv.every(function (it) { return EXAMPLES.isExample(it.html); }));
      check('C.2b preview: example people and partners are the library\'s, addressed under the app\'s public address', pv.filter(function (it) { return /speakers|sponsors/.test(it.filled.join()); }).every(function (it) {
        return it.html.indexOf(BASE + EXAMPLES.EXAMPLE_PATH) !== -1;
      }), pv.map(function (x) { return x.templateId; }));
      check('C.2b preview: the example fill was asked with the event as the posts read it and the public address', EX.calls.length >= 6 && EX.calls.every(function (c) { return c.opts && c.opts.base === BASE; }));
      check('C.2b preview: a card with examples in it has no caption (its words would name the examples, unmarked)', pv.every(function (it) { return it.caption === ''; }), pv.map(function (x) { return x.caption; }));
      var np = r[1].json.items || [];
      check('C.2b the same items without preview: "needs …" and what is missing, no HTML', np.length === 6 && np.every(function (it) { return /^needs /.test(it.error) && Array.isArray(it.missing) && it.missing.length && !it.html; }), np.map(function (x) { return x.error; }));
      var an = r[2].json.items || [];
      check('C.2b Announcement with no date or venue: the real render with its state, not an example', an[0] && an[0].state === 'no-date-venue' && an[0].example === false && typeof an[0].html === 'string' &&
        an[0].html.indexOf('oneworld-example') === -1, an[0] && { state: an[0].state, example: an[0].example, error: an[0].error });
      check('C.2b … and without preview it still needs the date or venue', an[1] && /^needs /.test(an[1].error), an[1]);
      check('C.2b … a preview with nothing filled keeps its caption', an[0] && typeof an[0].caption === 'string' && an[0].caption.indexOf('Untitled Roundtable') !== -1, an[0] && an[0].caption);
      var ts = (r[3].json.items || [])[0] || {};
      /* what the fill answered for this card: its quote, and the voice it picked */
      var fill = (EX.calls.filter(function (c) { return c.id === 'generic.testimonial'; }).pop() || {}).out || { ev: {}, params: {} };
      var quote = String(fill.params.quote || '');
      var voice = (fill.ev.speakers || []).filter(function (s) { return s && s.id === fill.params.speakerId; })[0] || {};
      /* a text in the HTML as written, or as the engine escapes it (vendor/promo-engine.js esc) */
      var holds = function (html, text) {
        text = String(text || '');
        return !!text && (html.indexOf(text) !== -1 || html.indexOf(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')) !== -1);
      };
      check('C.2b Testimonial preview with no quote: an example quote in an example voice, marked', ts.example === true && JSON.stringify(ts.filled) === '["quote"]' &&
        typeof ts.html === 'string' && /<meta name="oneworld-example"/.test(ts.html) && EXAMPLES.isExample(ts.html), ts.error || ts.filled);
      check('C.2b … the quote and the voice drawn are the ones the fill gave: a library voice, with a library photo', quote.length > 10 && holds(ts.html || '', quote) &&
        /^ex-p\d+$/.test(String(voice.id)) && holds(ts.html || '', voice.name) && String(voice.photoUrl).indexOf(BASE + EXAMPLES.EXAMPLE_PATH) === 0 &&
        (ts.html || '').indexOf(voice.photoUrl) !== -1, { quote: quote, voice: voice });
      check('C.2b … and no real speaker\'s name beside it', ts.html && EVENTS.rich.ev.speakers.every(function (s) { return !holds(ts.html, s.name); }),
        EVENTS.rich.ev.speakers.filter(function (s) { return holds(ts.html || '', s.name); }).map(function (s) { return s.name; }));
      check('C.2b … and no caption', ts.caption === '', ts.caption);
      EX.unfixable = true;
      return post(mod.handleHtml, '/api/promo/social/html', { eventId: 'sparse', items: [{ templateId: 'speaker.individual', format: 'ig_square', preview: true }] }).then(function (r2) {
        EX.unfixable = false;
        var it = (r2.json.items || [])[0] || {};
        check('C.2b a preview the fill could not complete: the old "needs …" card', /^needs /.test(it.error) && !it.html, it);
      });
    });
  },

  /* ===== C.2c the art a post uses, captionOnly, the caption ===== */
  function () {
    var u = function (s) { return 'https://storage.googleapis.com/' + BUCKET + '/events/rich/promo-art/' + s + '.png'; };
    DOCS['events/rich/promoSocial/art'] = { background: { url: u('background-a'), from: 'psd' }, bg2: { url: u('bg2-a'), from: 'upload' }, logoUnit: { url: u('logoUnit-a'), from: 'upload' } };
    var item = function (bg) { return { templateId: 'generic.announcement', format: 'ig_square', params: bg == null ? {} : { bg: bg } }; };
    return post(mod.handleHtml, '/api/promo/social/html', { eventId: 'rich', items: [item('2'), item('3'), item(null)] }).then(function (r) {
      var it = r.json.items || [];
      check('C.2c bg "2" with a background 2: that picture', it[0].html.indexOf(u('bg2-a')) !== -1 && it[0].html.indexOf(u('background-a')) === -1);
      check('C.2c bg "3" with none there: the PSD background', it[1].html.indexOf(u('background-a')) !== -1);
      check('C.2c no choice: the PSD background', it[2].html.indexOf(u('background-a')) !== -1 && /class="bg"/.test(it[2].html));
      check('C.2c the logo unit goes into the lock-up', /class="lockup-img" src="[^"]*logoUnit-a\.png"/.test(it[0].html));
      DOCS['events/rich/promoSocial/art'] = {};
      return post(mod.handleHtml, '/api/promo/social/html', { eventId: 'rich', items: [item('2')], captionOnly: true });
    }).then(function (r) {
      var it = (r.json.items || [])[0] || {};
      check('C.2c captionOnly: the caption, no HTML', typeof it.caption === 'string' && it.caption.length > 10 && !own(it, 'html'), it);
      return post(mod.handleHtml, '/api/promo/social/html', { eventId: 'rich', items: [item(null)] });
    }).then(function (r) {
      var it = (r.json.items || [])[0] || {};
      check('C.2c no art: no background layer', it.html && !/class="bg"/.test(it.html) && !/class="lockup-img"/.test(it.html));
      return post(mod.handleHtml, '/api/promo/social/html', { eventId: 'sparse', items: [{ templateId: 'generic.announcement', format: 'ig_square' }] });
    }).then(function (r) {
      var it = (r.json.items || [])[0] || {};
      return T.socialEventFor(FB, 'sparse', {}).then(function (got) {
        var tpl = engine.getTemplate('generic.announcement');
        var expected = tpl.caption({ event: got.ev, brand: engine.getBrand(''), format: engine.FORMATS.ig_square, params: engine.resolveParams(tpl, {}), assets: {} });
        check('C.2c the caption exactly as the template writes it, not trimmed', it.caption === expected && /\s$/.test(it.caption), [it.caption, expected]);
      });
    });
  },

  /* ===== C.2d the QR code ===== */
  function () {
    var it = function (p, f) { return { templateId: 'speaker.individual', format: f || 'ig_square', params: p || {} }; };
    return Promise.all([
      post(mod.handleHtml, '/api/promo/social/html', { eventId: 'rich', items: [it(), it({ qr: 'off' }), it({ qrLabel: '<b>Scan me</b>' }), it({ qrLabel: '   ' }), { templateId: 'generic.announcement', format: 'story' }] }),
      post(mod.handleHtml, '/api/promo/social/html', { eventId: 'sparse', items: [{ templateId: 'generic.announcement', format: 'ig_square' }, { templateId: 'generic.testimonial', format: 'ig_square' }] })
    ]).then(function (r) {
      var a = r[0].json.items || [], b = r[1].json.items || [];
      var m = /class="ow-qr-code" src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/.exec(a[0].html || '');
      var svg = m ? Buffer.from(m[1], 'base64').toString('utf8') : '';
      check('C.2d published, default: the QR tile with a data: SVG code', !!m, (a[0].html || '').slice(0, 200));
      check('C.2d the code is Oneworld\'s drawing: dark #111111 path on a #ffffff square, crisp edges, labelled with the address',
        /<rect width="(\d+)" height="\1" fill="#ffffff"\/><path d="M[\d hvz.M-]+" fill="#111111"\/><\/svg>$/.test(svg) && /shape-rendering="crispEdges"/.test(svg) &&
        svg.indexOf('aria-label="QR code: ' + BASE + '/e/rich#register"') !== -1, svg.slice(0, 300));
      check('C.2d … with its caption "Scan to register"', /<div class="ow-qr-t">Scan to register<\/div>/.test(a[0].html));
      check('C.2d qr "off": no tile', a[1].html.indexOf('ow-qr') === -1);
      check('C.2d a caption of the user\'s is escaped', a[2].html.indexOf('&lt;b&gt;Scan me&lt;/b&gt;') !== -1 && a[2].html.indexOf('<b>Scan me') === -1);
      check('C.2d a caption of spaces only is the default one', /<div class="ow-qr-t">Scan to register<\/div>/.test(a[3].html));
      check('C.2d Announcement: the code beside the button', /class="an-acts"/.test(a[4].html) && /ow-qr-code/.test(a[4].html));
      check('C.2d not published: no tile in any post', b.every(function (x) { return x.html.indexOf('ow-qr') === -1 && x.html.indexOf('an-acts') === -1; }));
      check('C.2d the presenter rule in the lock-up', /<span>Kyndryl<\/span> presents/.test(a[0].html) && /<span>The Economic Times<\/span> presents/.test(b[0].html),
        [/lockup-presenter[^<]*<span>[^<]*/.exec(a[0].html), /lockup-presenter[^<]*<span>[^<]*/.exec(b[0].html)]);
      check('C.2d the same address draws the same code (cached), a long one none', T.qrDataUri('https://a.example/x') === T.qrDataUri('https://a.example/x') && T.qrDataUri('https://a.example/' + 'x'.repeat(4000)) === '');
    });
  },

  /* ===== C.2e example options refused ===== */
  function () {
    return Promise.all([
      post(mod.handleHtml, '/api/promo/social/html', { eventId: 'rich', items: [{ templateId: 'speaker.individual', format: 'ig_square', params: { speakerId: 'ex-p01' } }] }),
      post(mod.handleHtml, '/api/promo/social/html', { eventId: 'rich', items: [{ templateId: 'generic.testimonial', format: 'ig_square', params: { quote: 'x' } }, { templateId: 'speaker.individual', format: 'ig_square', params: { photo: BASE + EX_PATH + 'people/p02.jpg' } }] })
    ]).then(function (r) {
      check('C.2e an example id in the options: 422 code example', r[0].status === 422 && r[0].json.code === 'example' && /Example content cannot be saved/.test(r[0].json.error), r[0].json);
      check('C.2e an example picture address in any item: 422', r[1].status === 422 && r[1].json.code === 'example');
    });
  },

  /* ===== C.3 art uploads ===== */
  function () {
    var cases = [['background', 'upload', 400], ['bg1', 'psd', 400], ['bg4', 'upload', 400], ['constructor', 'upload', 400], ['logoUnit', 'url', 400], ['background', 'psd', 200], ['logoUnit', 'psd', 200], ['logoUnit', 'upload', 200], ['bg3', 'upload', 200]];
    return png(64, 48).then(function (pic) {
      return cases.reduce(function (p, c) {
        return p.then(function (acc) {
          return upload(mod.handleArtUpload, ART + 'rich&slot=' + c[0] + '&from=' + c[1], pic).then(function (r) { acc.push([c, r]); return acc; });
        });
      }, Promise.resolve([]));
    }).then(function (out) {
      check('C.3 each slot takes only its own source', out.every(function (x) { return x[1].status === x[0][2] && (x[0][2] !== 400 || x[1].json.error === 'unknown slot'); }), out.map(function (x) { return [x[0].join('/'), x[1].status, x[1].json.error]; }));
      var bg = out[8][1].json, logo = out[7][1].json;
      check('C.3 a numbered background\'s answer is the platform\'s: ok, slot, size, bytes', bg.ok === true && bg.slot === '3' && bg.width === 64 && bg.height === 48 && bg.bytes > 0, bg);
      check('C.3 the logo\'s answer has no slot', logo.ok === true && !own(logo, 'slot') && logo.width > 0 && logo.bytes > 0, logo);
      var d = artDoc('rich');
      check('C.3 the slot is recorded: public address, path, size, kind, source, who', d.bg3 && d.bg3.url === 'https://storage.googleapis.com/' + BUCKET + '/' + d.bg3.path &&
        /^events\/rich\/promo-art\/bg3-[0-9a-z]+-[0-9a-f]{16}\.png$/.test(d.bg3.path) && d.bg3.type === 'image/png' && d.bg3.from === 'upload' && d.bg3.by === DECODED.email && OBJECTS[d.bg3.path].public === true &&
        OBJECTS[d.bg3.path].metadata.cacheControl === 'public, max-age=31536000, immutable', d.bg3);
      check('C.3 activity: "Post art: Background 3 uploaded", "Logo from the PSD uploaded"', activity('rich').indexOf('Post art: Background 3 uploaded') !== -1 && activity('rich').indexOf('Post art: Logo from the PSD uploaded') !== -1, activity('rich'));
      return call(mod.handleArt, { url: ART + 'rich' });
    }).then(function (r) {
      var a = r.json;
      check('C.3 GET art: the platform\'s booleans', a.background === true && a.logoUnit === true && a.bg1 === false && a.bg2 === false && a.bg3 === true, a);
      check('C.3 GET art: each picture\'s address, size, source and time, never who', a.units.bg3 && a.units.bg3.url && a.units.bg3.width === 64 && a.units.bg3.from === 'upload' && a.units.bg3.at > 0 &&
        !JSON.stringify(a).includes(DECODED.email) && a.psd === null, a);
    });
  },
  function () {
    /* the 413 must reach a browser that is still sending: a real server, and a client that keeps writing */
    var server = http.createServer(function (req, res) { mod.handleArtUpload(req, res); });
    return new Promise(function (ok) { server.listen(0, '127.0.0.1', ok); }).then(function () {
      var port = server.address().port;
      /* the answer usually arrives while the client is still sending: it goes on sending to the end, and the
         check is that it could (no reset, no broken pipe) and still read the 413 */
      var send = function (chunked) {
        return new Promise(function (resolve) {
          var total = 9 * MB, sent = 0, chunk = Buffer.alloc(64 * KB, 7), errors = [], answer = null, written = false, settled = false;
          var finish = function () { if (!settled && answer && written) { settled = true; setTimeout(function () { resolve(Object.assign({ errors: errors, sent: sent }, answer)); }, 30); } };
          var headers = { authorization: 'Bearer ok', 'content-type': 'application/octet-stream' };
          if (!chunked) headers['content-length'] = String(total);
          var req = http.request({ host: '127.0.0.1', port: port, method: 'POST', path: ART + 'rich&slot=bg1&from=upload', headers: headers }, function (res) {
            var body = '';
            res.setEncoding('utf8');
            res.on('data', function (c) { body += c; });
            res.on('end', function () { answer = { status: res.statusCode, body: body }; finish(); });
          });
          req.on('error', function (e) { errors.push(e.code || e.message); if (!settled) { settled = true; resolve({ status: answer ? answer.status : 0, body: answer ? answer.body : '', errors: errors, sent: sent }); } });
          (function write() {
            while (sent < total) {
              sent += chunk.length;
              if (!req.write(chunk)) { req.once('drain', write); return; }
            }
            req.end(function () { written = true; finish(); });
          })();
        });
      };
      return send(false).then(function (a) {
        return send(true).then(function (b) { return [a, b]; });
      });
    }).then(function (r) {
      server.close();
      [['announced length', r[0]], ['no length announced', r[1]]].forEach(function (x) {
        var j = {}; try { j = JSON.parse(x[1].body); } catch (e) { /* not JSON */ }
        check('C.3 over 8 MiB (' + x[0] + '): 413 "That upload is too large.", read by a client that kept writing — no reset', x[1].status === 413 && j.error === 'That upload is too large.' && !x[1].errors.length && x[1].sent >= 9 * MB, x[1]);
      });
    }, function (err) { server.close(); throw err; });
  },
  function () {
    return Promise.all([
      upload(mod.handleArtUpload, ART + 'rich&slot=bg1&from=upload', Buffer.alloc(0)),
      upload(mod.handleArtUpload, ART + 'rich&slot=bg1&from=upload', Buffer.from('These are the minutes of the meeting, not a picture.')),
      png(5000, 5000).then(function (b) { return upload(mod.handleArtUpload, ART + 'rich&slot=bg1&from=upload', b); }),
      sharp({ create: { width: 200, height: 100, channels: 3, background: '#d04040' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer().then(function (b) { return upload(mod.handleArtUpload, ART + 'rich&slot=bg2&from=upload', b); })
    ]).then(function (r) {
      check('C.3 an empty body: "empty upload"', r[0].status === 400 && r[0].json.error === 'empty upload', r[0].json);
      check('C.3 a text file: the picture sentence', r[1].status === 400 && r[1].json.error === 'That file is not a picture Oneworld can read. Upload a PNG, JPG, WebP, GIF, AVIF, TIFF or SVG.', r[1].json);
      check('C.3 a 5000 × 5000 picture: the 16 million pixel sentence', r[2].status === 400 && r[2].json.error === 'That picture is too large to use (more than 16 million pixels). Make it smaller and upload it again.', r[2].json);
      check('C.3 an EXIF-rotated photo is stored upright', r[3].status === 200 && r[3].json.width === 100 && r[3].json.height === 200, r[3].json);
      return png(5000, 2000);
    }).then(function (wide) {
      return upload(mod.handleArtUpload, ART + 'rich&slot=bg1&from=upload', wide).then(function (r) {
        check('C.3 a wide picture is kept at 3840 on its long edge', r.status === 200 && r.json.width === 3840 && r.json.height === 1536, r.json);
      });
    });
  },
  function () {
    var pic;
    return fringed().then(function (b) {
      pic = b;
      return Promise.all([sharp(b).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true }), sharp(b).trim().png().toBuffer({ resolveWithObject: true })]);
    }).then(function (ref) {
      return upload(mod.handleArtUpload, ART + 'rich&slot=logoUnit&from=psd', pic).then(function (a) {
        var psdPath = artDoc('rich').logoUnit.path;
        return upload(mod.handleArtUpload, ART + 'rich&slot=logoUnit&from=upload', pic).then(function (b) { return [ref, a, b, psdPath]; });
      });
    }).then(function (r) {
      var t1 = r[0][0].info, td = r[0][1].info;
      check('C.3 a PSD\'s logo is trimmed as the platform\'s PSD step does: trim({ threshold: 1 })', r[1].json.width === t1.width && r[1].json.height === t1.height && t1.width === 160, [r[1].json, t1]);
      check('C.3 … the stored picture equals sharp().trim({ threshold: 1 }) on the same file, byte for byte', !!OBJECTS[r[3]] && Buffer.compare(OBJECTS[r[3]].data, r[0][0].data) === 0);
      check('C.3 an uploaded logo gets the platform\'s default trim', r[2].json.width === td.width && r[2].json.height === td.height && td.width === 100, [r[2].json, td]);
      var objs = objectsUnder('events/rich/promo-art/logoUnit-');
      check('C.3 replacing the logo keeps the earlier picture in Storage (a saved layout may show it)', objs.length >= 3 && !!OBJECTS[r[3]] && artDoc('rich').logoUnit.path !== r[3], objs);
    });
  },
  function () {
    /* a PNG over the stored limit becomes WebP; one that will not fit even then is refused */
    return noisePng(256, 256).then(function (b) {
      NUM.storeMax = 1000;
      return upload(mod.handleArtUpload, ART + 'rich&slot=bg1&from=upload', b).then(function (r) {
        var d = artDoc('rich').bg1;
        check('C.3 over the PNG limit: kept as WebP', r.status === 200 && d.type === 'image/webp' && /\.webp$/.test(d.path) && OBJECTS[d.path].data.slice(8, 12).toString() === 'WEBP', [r.json, d && d.path]);
        NUM.webpMax = 100;
        return upload(mod.handleArtUpload, ART + 'rich&slot=bg1&from=upload', b);
      }).then(function (r) {
        check('C.3 too large even as WebP at 75: refused with its sentence', r.status === 400 && r.json.error === 'That picture is too large to keep, even compressed. Make it smaller and upload it again.', r.json);
        NUM.storeMax = DEFAULT_NUMBERS.storeMax; NUM.webpMax = DEFAULT_NUMBERS.webpMax;
      });
    });
  },
  function () {
    /* two uploads at once: one picture decoded at a time */
    var ORDER = [];
    var fake = function (input) {
      var tag = Buffer.isBuffer(input) ? input.toString('latin1', 0, 1) : '?';
      var api = {
        metadata: function () { ORDER.push('meta ' + tag); return delay(5).then(function () { return { width: 10, height: 10 }; }); },
        rotate: function () { return api; }, trim: function () { return api; }, resize: function () { return api; }, png: function () { return api; }, webp: function () { return api; },
        toBuffer: function () { ORDER.push('start ' + tag); return delay(25).then(function () { ORDER.push('end ' + tag); return { data: Buffer.from('PNG' + tag), info: { width: 10, height: 10 } }; }); }
      };
      return api;
    };
    T.setSharp(fake);
    return Promise.all([
      upload(mod.handleArtUpload, ART + 'rich&slot=bg1&from=upload', Buffer.from('A-picture')),
      upload(mod.handleArtUpload, ART + 'rich&slot=bg2&from=upload', Buffer.from('B-picture'))
    ]).then(function (r) {
      T.setSharp(null);
      check('C.3 two uploads at once run one after the other', r[0].status === 200 && r[1].status === 200 && ORDER.join() === 'meta A,start A,end A,meta B,start B,end B', ORDER);
    }, function (err) { T.setSharp(null); throw err; });
  },

  /* ===== C.4 the PSD's summary ===== */
  function () {
    var P = '/api/promo/social/art/psd', u = function (s, from) { return { url: 'https://storage.googleapis.com/' + BUCKET + '/events/sparse/promo-art/' + s + '.png', path: 'events/sparse/promo-art/' + s + '.png', width: 900, height: 300, from: from }; };
    var meta = function (found, extra) { return Object.assign({ eventId: 'sparse', name: 'NDS2 Save the date.psd', bytes: 48123456, canvasWidth: 7932, canvasHeight: 4818, found: found }, extra || {}); };
    DOCS['events/sparse/promoSocial/art'] = { background: u('background-1', 'psd'), logoUnit: u('logoUnit-1', 'psd') };
    return post(mod.handleArtPsd, P, meta({ background: true, logoUnit: false }, { layers: [{ name: 'x' }] })).then(function (r) {
      var d = artDoc('sparse');
      check('C.4 a PSD-made logo this PSD did not produce is cleared', r.status === 200 && d.logoUnit === null && d.background && d.background.from === 'psd', [r.json, d]);
      check('C.4 the answer: the PSD background\'s size, no logo', r.json.ok === true && JSON.stringify(r.json.background) === '{"width":900,"height":300}' && r.json.logoUnit === null, r.json);
      check('C.4 only the PSD\'s name, size and canvas are kept — no layer table', d.psd && d.psd.name === 'NDS2 Save the date.psd' && d.psd.bytes === 48123456 && d.psd.canvasWidth === 7932 && d.psd.canvasHeight === 4818 &&
        !own(d.psd, 'layers') && !own(d, 'layers') && d.psd.by === DECODED.email, d.psd);
      check('C.4 activity: the cleared logo', activity('sparse').indexOf('Post art: Logo from the PSD cleared by a new PSD') !== -1, activity('sparse'));
      DOCS['events/sparse/promoSocial/art'].logoUnit = u('logoUnit-2', 'upload');
      return post(mod.handleArtPsd, P, meta({ background: false, logoUnit: false }));
    }).then(function (r) {
      var d = artDoc('sparse');
      check('C.4 an uploaded logo stays; the PSD background goes when this PSD has none', r.status === 200 && d.logoUnit && d.logoUnit.from === 'upload' && d.background === null, d);
      /* an upload committed between the summary's read and its write is kept */
      DOCS['events/sparse/promoSocial/art'].logoUnit = u('logoUnit-3', 'psd');
      TX.pause('promoSocial/art');
      var metaCall = post(mod.handleArtPsd, P, meta({ background: false, logoUnit: false }));
      return TX.paused.then(function () {
        return png(400, 200).then(function (b) { return upload(mod.handleArtUpload, ART + 'sparse&slot=logoUnit&from=upload', b); });
      }).then(function (up) {
        TX.go();
        return metaCall.then(function (m) { return [up, m]; });
      });
    }).then(function (r) {
      var d = artDoc('sparse');
      check('C.4 an upload committed while the summary was between read and write is kept (the summary read again)', r[0].status === 200 && r[1].status === 200 && d.logoUnit && d.logoUnit.from === 'upload' &&
        TX.attempts.indexOf('retry') !== -1, [r[0].status, r[1].status, d.logoUnit]);
      var big = meta({ background: true, logoUnit: true }, { name: 'x'.repeat(17 * KB) });
      return Promise.all([post(mod.handleArtPsd, P, big), post(mod.handleArtPsd, P, meta('yes')), post(mod.handleArtPsd, P, meta({ background: true, logoUnit: true }, { canvasWidth: -3 }))]);
    }).then(function (r) {
      check('C.4 a summary over 16 KB: 413', r[0].status === 413 && SPY.limits.indexOf(16 * KB) !== -1, r[0].status);
      check('C.4 a summary that cannot be read: 400', r[1].status === 400 && r[2].status === 400, [r[1].json, r[2].json]);
    });
  },

  /* ===== C.5 Remove ===== */
  function () {
    var d = artDoc('rich'), p = d.bg3 && d.bg3.path;
    return call(mod.handleArtDelete, { url: ART + 'rich&slot=bg3', method: 'DELETE' }).then(function (r) {
      check('C.5 Remove clears the slot', r.status === 200 && r.json.ok === true && r.json.removed === true && artDoc('rich').bg3 === null, r.json);
      check('C.5 … and keeps the picture in Storage', !!p && !!OBJECTS[p], p);
      check('C.5 activity: "Post art: Background 3 removed"', activity('rich').indexOf('Post art: Background 3 removed') !== -1);
      return Promise.all([call(mod.handleArtDelete, { url: ART + 'rich&slot=bg3', method: 'DELETE' }), call(mod.handleArtDelete, { url: ART + 'rich&slot=psd', method: 'DELETE' })]);
    }).then(function (r) {
      check('C.5 Remove again: ok, nothing removed', r[0].status === 200 && r[0].json.removed === false, r[0].json);
      check('C.5 an unknown slot: 400', r[1].status === 400 && r[1].json.error === 'unknown slot');
    });
  },

  /* ===== §13 Upload a picture ===== */
  function () {
    var before = clone(artDoc('rich'));
    return png(800, 600).then(function (b) { return upload(mod.handlePicture, '/api/promo/social/picture?eventId=rich', b); }).then(function (r) {
      var j = r.json, objectPath = String(j.url || '').replace('https://storage.googleapis.com/' + BUCKET + '/', '');
      var problem = (promo.imageUrlProblem || promo._test.imageUrlProblem)(j.url, BUCKET, 'rich');
      check('§13 picture: { ok, url, width, height, bytes }', r.status === 200 && j.ok === true && j.width === 800 && j.height === 600 && j.bytes > 0, j);
      check('§13 picture: stored public under the event\'s promo-art folder', /^events\/rich\/promo-art\/picture-[0-9a-z]+-[0-9a-f]{16}\.png$/.test(objectPath) && OBJECTS[objectPath] && OBJECTS[objectPath].public === true, objectPath);
      check('§13 picture: its address passes the image proxy\'s rule for this event', problem === '', problem);
      check('§13 picture: not one of the posts\' art slots', JSON.stringify(artDoc('rich')) === JSON.stringify(before));
      check('§13 picture: activity "Post picture uploaded"', activity('rich').indexOf('Post picture uploaded') !== -1);
      return Promise.all([
        upload(mod.handlePicture, '/api/promo/social/picture?eventId=rich', Buffer.alloc(0)),
        upload(mod.handlePicture, '/api/promo/social/picture?eventId=rich', Buffer.from('not a picture at all')),
        png(5000, 5000).then(function (b) { return upload(mod.handlePicture, '/api/promo/social/picture?eventId=rich', b); }),
        upload(mod.handlePicture, '/api/promo/social/picture?eventId=rich', Buffer.alloc(8 * MB + 1, 1))
      ]);
    }).then(function (r) {
      check('§13 picture: empty, not a picture, too many pixels, too large', r[0].json.error === 'empty upload' && /not a picture Oneworld can read/.test(r[1].json.error) &&
        /more than 16 million pixels/.test(r[2].json.error) && r[3].status === 413 && r[3].json.error === 'That upload is too large.', r.map(function (x) { return [x.status, x.json.error]; }));
    });
  },

  /* ===== C.6 layouts ===== */
  function () {
    var src = function (tid, f, theme, bg) { return tid + '__' + f + '__' + (theme || 'dark') + '_bg' + (bg || 'psd'); };
    var cases = [['speaker.individual', 'ig_portrait', 'light', '2'], ['generic.testimonial', 'ig_square', 'dark', ''], ['partner.tier-ladder', 'story', '', '1'], ['generic.announcement', 'landscape', 'dark', '3']];
    check('C.6a the layout key is the platform\'s for four cases', cases.every(function (c) { return T.layoutKey(c[0], c[1], c[2], c[3]) === src(c[0], c[1], c[2], c[3]); }) && T.layoutKey.apply(null, cases[0]) === KEY);
    check('C.6a a key is parsed back and checked part by part', typeof T.parseKey(KEY) === 'object' && T.parseKey('speaker.individual__constructor__dark_bgpsd') === 'unknown layout' &&
      T.parseKey('../x__ig_square__dark_bgpsd') === 'unknown layout' && T.parseKey('speaker.individual__ig_square__dim_bgpsd') === 'unknown layout');
    return basePng().then(function (b) {
      return Promise.all([
        uploadBase('rich', KEY, b),
        sharp(b).webp({ quality: 80 }).toBuffer().then(function (w) { return uploadBase('rich', KEY, w); }),
        png(1080, 1350).then(function (s) { return uploadBase('rich', KEY, s); }),
        sharp(b).jpeg().toBuffer().then(function (j) { return uploadBase('rich', KEY, j); }),
        uploadBase('rich', 'speaker.individual__nope__light_bg2', b)
      ]);
    }).then(function (r) {
      check('C.6b a PNG base at twice the size: stored under the key\'s folder', r[0].status === 200 && r[0].json.width === 2160 && r[0].json.height === 2700 &&
        new RegExp('^https://storage.googleapis.com/' + BUCKET + '/events/rich/promo-layouts/' + KEY.replace(/\./g, '\\.') + '/[0-9a-z]+-[0-9a-f]{16}\\.png$').test(r[0].json.url), r[0].json);
      check('C.6b a WebP base too', r[1].status === 200 && /\.webp$/.test(r[1].json.url), r[1].json);
      check('C.6b the wrong size, a JPEG, an unknown key: 400', r[2].status === 400 && /2160 × 2700/.test(r[2].json.error) && r[3].status === 400 && /PNG or a WebP/.test(r[3].json.error) && r[4].status === 400, [r[2].json, r[3].json, r[4].json]);
    });
  },
  function () {
    /* Save: what the checks accept and refuse */
    var good;
    return basePng().then(function (b) { return uploadBase('rich', KEY, b); }).then(function (r) {
      good = r.json.url;
      var els = sampleEls();
      els.push({ id: 'n1', type: 'image', x: 10, y: 10, w: 260, h: 260, src: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260"><rect width="100%" height="100%" fill="#d7dbe8"/><text x="50%" y="50%" font-family="Inter,Arial" font-size="18" fill="#8a90a6" text-anchor="middle" dy=".35em">paste image URL</text></svg>'), objectFit: 'contain', objectPosition: 'center', background: 'rgba(0, 0, 0, 0)', padding: '0', radius: '12px', boxShadow: 'none', rotate: 0 });
      els.push({ id: 'q1', type: 'text', x: 100, y: 200, w: 100, h: 140, text: '“', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 140, fontWeight: '700', color: 'rgb(245, 166, 35)', textShadow: 'rgba(0, 0, 0, 0.25) 0px 4px 12px' });
      els.push({ id: 'qr', type: 'image', x: 900, y: 1200, w: 150, h: 150, src: T.qrDataUri(BASE + '/e/rich#register'), owQr: true, unknownField: 'dropped', onclick: 'alert(1)' });
      els.push({ id: 'own', type: 'image', x: 1, y: 1, w: 50, h: 50, src: 'http://localhost:8162/templates/a.png' });
      els.push({ id: 'imp', type: 'image', x: 1, y: 1, w: 50, h: 50, src: 'https://storage.googleapis.com/' + BUCKET + '/events/import-imp1/images/hero.webp' });
      return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: good, elements: els, params: { speakerId: 's1', roleLabel: 'Keynote speaker', qr: 'on', nonsense: 'x', theme: 'dark', bg: '3' } }));
    }).then(function (r) {
      var d = layoutDoc('rich', KEY) || {}, els = JSON.parse(d.elements || '[]');
      var by = function (id) { return els.filter(function (e) { return e.id === id; })[0] || {}; };
      check('C.6c a good layout is saved', r.status === 200 && r.json.ok === true && r.json.savedAt > 0, r.json);
      check('C.6c the platform\'s placeholder (data:image/svg+xml;utf8,…) is accepted', /^data:image\/svg\+xml;utf8,/.test(by('n1').src));
      check('C.6c a font family with double quotes is accepted and kept with single ones', by('q1').fontFamily === 'Georgia, \'Times New Roman\', serif' && by('e1').fontFamily === '\'Inter\', system-ui, sans-serif', [by('q1').fontFamily, by('e1').fontFamily]);
      check('C.6c the QR picture keeps its mark; unknown fields are dropped', by('qr').owQr === true && !own(by('qr'), 'unknownField') && !own(by('qr'), 'onclick'), by('qr'));
      check('C.6d this app\'s own file is kept as its path', by('own').src === '/templates/a.png', by('own').src);
      check('C.6d an imported site\'s own pictures are allowed for it', /events\/import-imp1\/images\/hero\.webp$/.test(by('imp').src));
      check('C.6c the saved record: base, size, key parts, who', d.baseUrl === good && d.basePath === good.replace('https://storage.googleapis.com/' + BUCKET + '/', '') && d.width === 1080 && d.height === 1350 &&
        d.templateId === 'speaker.individual' && d.format === 'ig_portrait' && d.theme === 'light' && d.bg === '2' && d.by === DECODED.email, d);
      check('C.6f options: the template\'s own, plus QR; unknown dropped; theme and background are the key\'s', JSON.stringify(d.params) === JSON.stringify({ speakerId: 's1', roleLabel: 'Keynote speaker', qr: 'on', theme: 'light', bg: '2' }), d.params);
      check('C.6h activity: "Post layout saved: …"', activity('rich').some(function (l) { return /^Post layout saved: .+ · 4:5$/.test(l); }), activity('rich'));
      return call(mod.handleLayout, { url: LAYOUT_URL + '?eventId=rich&templateId=speaker.individual&format=ig_portrait&theme=light&bg=2' });
    }).then(function (r) {
      var j = r.json;
      check('C.6f load: saved, with its elements and options parsed', r.status === 200 && j.saved === true && j.base === good && Array.isArray(j.elements) && j.elements.length === 9 &&
        j.params.roleLabel === 'Keynote speaker' && JSON.stringify(j.caption) === '{"network":"linkedin","text":null}' && j.width === 1080 && j.savedAt > 0 && !own(j, 'by') && !own(j, 'sweeping'), j);
      return call(mod.handleLayout, { url: LAYOUT_URL + '?eventId=rich&templateId=speaker.individual&format=ig_portrait&theme=dark&bg=' });
    }).then(function (r) {
      check('C.6f load: another theme has no saved layout', r.json.saved === false && Object.keys(r.json).length === 1, r.json);
      /* the refusals, each on its own */
      var bad = [
        ['an unknown type', { type: 'script' }],
        ['a position that is not a number', { x: 'left' }],
        ['a huge number', { w: 1e9 }],
        ['a font family with a bracket', { fontFamily: 'Inter<style>' }],
        ['a style with url(', { background: 'url(https://evil.example/x.png)' }],
        ['a style with a double quote', { color: 'red" onload="x' }],
        ['a style with a single quote (a CSS string can name a picture)', { background: 'image-set(\'https://evil.example/x.png\' 1x)' }],
        ['a style with an escape', { background: 'u\\72l(x)' }],
        ['a style with expression(', { color: 'expression(alert(1))' }],
        ['a style with javascript:', { boxShadow: 'javascript:alert(1)' }],
        ['a style that is too long', { textShadow: 'rgba(0, 0, 0, 0.1) 0px 0px 1px, '.repeat(20) }],
        ['text over 2,000 characters', { text: 'x'.repeat(2001) }],
        ['an id that is not one', { id: '<x>' }],
        ['an element that is not an object', 'x']
      ];
      return basePng().then(function (b) { return uploadBase('rich', KEY, b); }).then(function (up) {
        return Promise.all(bad.map(function (c) {
          var els = sampleEls();
          els[1] = typeof c[1] === 'string' ? c[1] : Object.assign({}, els[1], c[1]);
          return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, elements: els })).then(function (r2) { return [c[0], r2.status, r2.json.error]; });
        })).then(function (out) {
          check('C.6c each bad element is refused with 400 and says which element', out.every(function (x) { return x[1] === 400 && /^Element 2 of this layout cannot be saved/.test(x[2]); }), out);
          var many = []; for (var i = 0; i < 401; i++) many.push({ id: 'e' + i, type: 'shape', x: 0, y: 0, w: 1, h: 1 });
          return Promise.all([
            post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, elements: many })),
            post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, width: 1080, height: 1080 })),
            post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, caption: { network: 'myspace', text: 'x' } })),
            post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, caption: { network: 'x', text: 'y'.repeat(3001) } })),
            post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, params: { speakerId: { $gt: '' } } })),
            post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, templateId: 'nope' })),
            post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, theme: 'dim' })),
            post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, bg: '4' }))
          ]);
        });
      });
    }).then(function (r) {
      check('C.6c more than 400 elements, the wrong size, an unknown caption network or a long caption, an option of the wrong kind, an unknown template / theme / background: 400',
        r.every(function (x) { return x.status === 400; }), r.map(function (x) { return [x.status, x.json.error]; }));
    });
  },
  function () {
    /* picture addresses (C.6d) and sizes (C.6e) */
    return basePng().then(function (b) { return uploadBase('rich', KEY, b); }).then(function (up) {
      var withSrc = function (s) { var els = sampleEls(); els[2] = Object.assign({}, els[2], { src: s }); return saveBody('rich', { base: up.json.url, elements: els }); };
      var dev = []; for (var i = 0; i < 200; i++) dev.push({ id: 't' + i, type: 'text', x: 0, y: 0, w: 10, text: 'अ'.repeat(2000) });
      var big = 'data:image/png;base64,' + 'A'.repeat(250 * KB), bigEls = sampleEls().concat([0, 1, 2].map(function (n) { return { id: 'd' + n, type: 'image', x: 0, y: 0, w: 5, h: 5, src: big }; }));
      return Promise.all([
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('https://evil.example/x.png')),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('https://storage.googleapis.com/' + BUCKET + '/events/sparse/promo-art/bg1-x.png')),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('http://img.etb2bimg.com/files/x.png')),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('javascript:alert(1)')),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('blob:https://revamp.example/1234')),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('/templates/../functions/lib/api.js')),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('data:image/png;base64,' + 'A'.repeat(301 * KB))),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('data:text/html;base64,PHNjcmlwdD4=')),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('/assets/promo-examples/people/p01.jpg')),
        post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, elements: dev })),
        post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, elements: bigEls })),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('https://img.etb2bimg.com/files/ok.png'))
      ]);
    }).then(function (r) {
      var refused = r.slice(0, 8);
      check('C.6d an outside address, another event\'s file, http:, javascript:, blob:, a path that climbs, a data: picture over 300 KB, data: that is not a picture: 400 with the O2 sentence',
        refused.every(function (x) { return x.status === 400 && x.json.error === T.PICTURE_REFUSED && x.json.code === 'picture-not-allowed'; }), refused.map(function (x) { return [x.status, x.json.error]; }));
      check('C.6d the O2 sentence ends "…or use Upload a picture."', /or use Upload a picture\.$/.test(T.PICTURE_REFUSED));
      check('C.6d an example picture: 422', r[8].status === 422 && r[8].json.code === 'example', r[8].json);
      check('C.6e 400,000 Devanagari characters: 413 with its sentence, not 500', r[9].status === 413 && r[9].json.error === 'This layout is too large to save. Remove some pictures or text and save again.', [r[9].status, r[9].json]);
      check('C.6e data: pictures over 600 KB together: 413', r[10].status === 413, [r[10].status, r[10].json]);
      check('C.6d an ET image address is kept', r[11].status === 200, r[11].json);
    });
  },
  function () {
    /* C.6d an own path is kept only in the form the server reads it: written any other way it would name another
       file than the one checked (the browser drops "/./", server.js decodes "%70"), and the example library loads */
    return basePng().then(function (b) { return uploadBase('rich', KEY, b); }).then(function (up) {
      var withSrc = function (s) { var els = sampleEls(); els[2] = Object.assign({}, els[2], { src: s }); return saveBody('rich', { base: up.json.url, elements: els }); };
      var odd = ['/assets/./promo-examples/people/p01.jpg', 'http://localhost:8162/assets/./promo-examples/people/p01.jpg',
        'https://revamp.example/assets/./promo-examples/logos/l01.png', '/assets/%70romo-examples/people/p01.jpg', '/assets/promo%2Dexamples/people/p01.jpg',
        '/templates/x/../../assets/hero.png', '/templates//x.png', '/templates/x/./hero.jpg', '/templates/x/hero.jpg/.', '/templates/x/%20hero.jpg'];
      return Promise.all(odd.map(function (s) { return post(mod.handleLayoutSave, LAYOUT_URL, withSrc(s)); }).concat([
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('/assets/Promo-Examples/people/p01.jpg')),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('http://localhost:8162/ASSETS/promo-examples/people/p01.jpg')),
        post(mod.handleLayoutSave, LAYOUT_URL, withSrc('/templates/x/hero.jpg?v=2'))
      ])).then(function (r) {
        var bad = r.slice(0, odd.length);
        check('C.6d an own path with a . segment, a % escape, a climb or a doubled slash: 400 picture-not-allowed, nothing kept',
          bad.every(function (x) { return x.status === 400 && x.json.code === 'picture-not-allowed'; }), bad.map(function (x, i) { return [odd[i], x.status, x.json.code]; }));
        var tail = r.slice(odd.length);
        check('C.6d the example library in another letter case: 422 code example', tail[0].status === 422 && tail[0].json.code === 'example', tail[0].json);
        check('C.6d … and with the folder named in capitals (a path this server does not serve): refused', tail[1].status === 400 || tail[1].status === 422, [tail[1].status, tail[1].json]);
        check('C.6d a plain own path with a query is kept', tail[2].status === 200, tail[2].json);
        var where = { bucket: BUCKET, eventId: 'rich', importId: '' };
        check('C.6d cleanSrc: the canonical own path kept as it is, the others refused',
          T.cleanSrc('/templates/x/hero.jpg', where) === '/templates/x/hero.jpg' && T.cleanSrc('http://localhost:8162/assets/a.png', where) === '/assets/a.png' &&
          odd.every(function (s) { return T.cleanSrc(s, where) === ''; }), odd.map(function (s) { return [s, T.cleanSrc(s, where)]; }));
      });
    });
  },
  function () {
    /* C.6g races and the folder: two saves at once, another key's base, a failed save then a good one */
    var folder = 'events/rich/promo-layouts/' + KEY + '/', b1, c1;
    return basePng().then(function (b) {
      return Promise.all([uploadBase('rich', KEY, b), uploadBase('rich', KEY, b)]);
    }).then(function (r) {
      b1 = r[0].json.url; c1 = r[1].json.url;
      TX.pause('promoSocialLayouts/' + KEY);
      var a = post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: b1 }));
      return TX.paused.then(function () {
        return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: c1 }));
      }).then(function (bRes) {
        TX.go();
        return a.then(function (aRes) { return [aRes, bRes]; });
      });
    }).then(function (r) {
      var d = layoutDoc('rich', KEY), objs = objectsUnder(folder);
      check('C.6g two saves at once: the second commits, the first (its base swept meanwhile) is told to reload', r[1].status === 200 && r[0].status === 409 && r[0].json.error === 'This layout was changed by someone else meanwhile. Reload it, then save again.', [r[0].status, r[0].json, r[1].status]);
      check('C.6g the committed base exists, and is the only picture in the folder', d.baseUrl === c1 && !!OBJECTS[d.basePath] && objs.length === 1 && objs[0] === d.basePath, [d.baseUrl, objs]);
      return basePng().then(function (b) { return uploadBase('rich', 'generic.testimonial__ig_portrait__dark_bgpsd', b); });
    }).then(function (other) {
      return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: other.json.url })).then(function (r) {
        check('C.6g a base of another layout: 400 "That picture is not this layout\'s."', r.status === 400 && r.json.error === 'That picture is not this layout\'s.', r.json);
        return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: 'data:image/png;base64,AAAA' }));
      });
    }).then(function (r) {
      check('C.6g a base that is not a stored picture: 400', r.status === 400 && r.json.error === 'That picture is not this layout\'s.', r.json);
      return basePng().then(function (b) { return uploadBase('rich', KEY, b); });
    }).then(function (up) {
      var els = sampleEls(); els[0].type = 'blob';
      return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, elements: els })).then(function (failedSave) {
        return basePng().then(function (b) { return uploadBase('rich', KEY, b); }).then(function (up2) {
          return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up2.json.url })).then(function (ok) { return [failedSave, ok, up2.json.url]; });
        });
      });
    }).then(function (r) {
      var objs = objectsUnder(folder), d = layoutDoc('rich', KEY);
      check('C.6g after a failed save and a good one, the folder holds exactly one picture: the committed base', r[0].status === 400 && r[1].status === 200 && objs.length === 1 && d.baseUrl === r[2] && objs[0] === d.basePath, [r[0].status, r[1].status, objs]);
      /* the same base again (only the elements changed): no new picture needed */
      return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: r[2], params: { roleLabel: 'Panelist' } }));
    }).then(function (r) {
      check('C.6g saving again over the stored base', r.status === 200 && layoutDoc('rich', KEY).params.roleLabel === 'Panelist' && objectsUnder(folder).length === 1, r.json);
      /* a base deleted after it was uploaded (another save's tidy-up) answers 409, not 500 */
      return basePng().then(function (b) { return uploadBase('rich', KEY, b); }).then(function (up) {
        delete OBJECTS[up.json.url.replace('https://storage.googleapis.com/' + BUCKET + '/', '')];
        return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url }));
      });
    }).then(function (r) {
      check('C.6g a base that is gone: 409 with its reason', r.status === 409 && /changed by someone else/.test(r.json.error), r.json);
    });
  },
  function () {
    /* C.6h Reset */
    var folder = 'events/rich/promo-layouts/' + KEY + '/';
    return basePng().then(function (b) { return uploadBase('rich', KEY, b); }).then(function () {
      check('C.6h before Reset: a saved layout and two pictures in its folder', !!layoutDoc('rich', KEY) && objectsUnder(folder).length === 2);
      return post(mod.handleLayoutReset, LAYOUT_URL + '/reset', { eventId: 'rich', templateId: 'speaker.individual', format: 'ig_portrait', theme: 'light', bg: '2' });
    }).then(function (r) {
      check('C.6h Reset removes the document and every picture of the folder', r.status === 200 && r.json.ok === true && r.json.removed === true && layoutDoc('rich', KEY) === undefined && objectsUnder(folder).length === 0, [r.json, objectsUnder(folder)]);
      check('C.6h activity: "Post layout reset: …"', activity('rich').some(function (l) { return /^Post layout reset: .+ · 4:5$/.test(l); }));
      return Promise.all([
        post(mod.handleLayoutReset, LAYOUT_URL + '/reset', { eventId: 'rich', templateId: 'speaker.individual', format: 'ig_portrait', theme: 'light', bg: '2' }),
        call(mod.handleLayout, { url: LAYOUT_URL + '?eventId=rich&templateId=speaker.individual&format=ig_portrait&theme=light&bg=2' }),
        post(mod.handleLayoutReset, LAYOUT_URL + '/reset', { eventId: 'rich', templateId: 'speaker.individual', format: 'square', theme: 'light', bg: '2' })
      ]);
    }).then(function (r) {
      check('C.6h Reset again: ok, nothing removed; the layout loads as unsaved', r[0].status === 200 && r[0].json.removed === false && r[1].json.saved === false, [r[0].json, r[1].json]);
      check('C.6h Reset of an unknown format: 400', r[2].status === 400);
    });
  },
  function () {
    /* a save that names a base which another save's tidy-up has marked: refused, never committed */
    var folder = 'events/rich/promo-layouts/' + KEY + '/';
    return basePng().then(function (b) { return Promise.all([uploadBase('rich', KEY, b), uploadBase('rich', KEY, b)]); }).then(function (r) {
      var x = r[0].json.url, y = r[1].json.url;
      return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: y })).then(function () {
        /* x has been deleted by y's tidy-up; put a mark back by hand as an unfinished tidy-up would leave it */
        var xp = x.replace('https://storage.googleapis.com/' + BUCKET + '/', '');
        OBJECTS[xp] = { data: Buffer.from('x'), metadata: {}, public: true };
        DOCS['events/rich/promoSocialLayouts/' + KEY].sweeping = [xp];
        return post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: x }));
      }).then(function (r2) {
        check('C.6g a base marked for deletion: 409, and the layout keeps its own base', r2.status === 409 && layoutDoc('rich', KEY).baseUrl === y, [r2.json, layoutDoc('rich', KEY).baseUrl]);
        return post(mod.handleLayoutReset, LAYOUT_URL + '/reset', { eventId: 'rich', templateId: 'speaker.individual', format: 'ig_portrait', theme: 'light', bg: '2' });
      }).then(function () {
        check('C.6h Reset clears the folder and its marks', objectsUnder(folder).length === 0 && layoutDoc('rich', KEY) === undefined);
      });
    });
  },

  /* ===== C.7 the browser's real extract output on save ===== */
  function () {
    var fixture = path.join(__dirname, 'fixtures', 'promo-social-testimonial-els.json'), els, from;
    if (fs.existsSync(fixture)) { els = JSON.parse(fs.readFileSync(fixture, 'utf8')); from = 'the lead\'s fixture from the browser'; }
    else {
      /* until the lead checks in the browser's own output (plan §9a P2), a Testimonial as that walk writes it */
      from = 'a hand-made Testimonial extract (no fixture yet)';
      els = [
        { id: 'e0', type: 'text', x: 0, y: 0, w: 260, h: 44, rotate: 0, text: '9th Edition', fontFamily: '"Inter", system-ui, sans-serif', fontSize: 25.92, fontWeight: '700', fontStyle: 'normal', color: 'rgb(26, 19, 51)', textAlign: 'start', lineHeight: 'normal', letterSpacing: '0.5184px', textTransform: 'none', textShadow: 'none', whiteSpace: 'nowrap', background: 'rgb(245, 166, 35)', backdropFilter: 'none', padding: '15.12px 36.72px 15.12px 23.76px', radius: '0px', boxShadow: 'none' },
        { id: 'e1', type: 'shape', x: 64.8, y: 400, w: 950, h: 500, rotate: 0, background: 'rgba(255, 255, 255, 0.74)', backdropFilter: 'blur(16px) saturate(1.15)', border: '1px solid rgba(0, 0, 0, 0.08)', radius: '32.4px', boxShadow: 'rgba(0, 0, 0, 0.28) 0px 16.2px 43.2px 0px' },
        { id: 'e2', type: 'text', x: 100, y: 420, w: 120, h: 160, rotate: 0, text: '“', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 172.8, fontWeight: '700', fontStyle: 'normal', color: 'rgb(245, 166, 35)', textAlign: 'start', lineHeight: '138.24px', letterSpacing: 'normal', textTransform: 'none', textShadow: 'rgba(0, 0, 0, 0.25) 0px 4.32px 17.28px', whiteSpace: 'nowrap', background: 'rgba(0, 0, 0, 0)', backdropFilter: 'none', padding: '0px', radius: '0px', boxShadow: 'none' },
        { id: 'e3', type: 'text', x: 100, y: 580, w: 880, h: 200, rotate: 0, text: 'The sharpest room of the year — "agents" finally made sense.', fontFamily: '"Inter", system-ui, sans-serif', fontSize: 41.04, fontWeight: '600', fontStyle: 'normal', color: 'rgb(17, 24, 39)', textAlign: 'start', lineHeight: '53.352px', letterSpacing: 'normal', textTransform: 'none', textShadow: 'none', whiteSpace: 'normal', background: 'rgba(0, 0, 0, 0)', backdropFilter: 'none', padding: '0px', radius: '0px', boxShadow: 'none' },
        { id: 'e4', type: 'frame', x: 700, y: 820, w: 300, h: 380, rotate: 0, radius: '25.92px', border: 'none', boxShadow: 'rgba(0, 0, 0, 0.22) 0px 21.6px 64.8px 0px', background: 'rgba(255, 255, 255, 0.1)', src: 'https://img.etb2bimg.com/files/asha.jpg', objectFit: 'cover', objectPosition: '50% 0%', imgScale: 1, imgX: 0, imgY: 0, imgRotate: 0, scrim: '' },
        { id: 'e5', type: 'image', x: 900, y: 1180, w: 150, h: 150, rotate: 0, src: T.qrDataUri(BASE + '/e/rich#register'), objectFit: 'fill', objectPosition: '50% 50%', radius: '12px', background: 'rgb(255, 255, 255)', padding: '8px', owQr: true }
      ];
    }
    /* the quote is the text that follows the big quote mark, in the fixture and in the hand-made list alike; it is read
       from els so the check follows whatever the browser's walk wrote, not a quote typed into this test */
    var markAt = -1;
    els.forEach(function (e, i) { if (markAt < 0 && e.type === 'text' && e.text === '“') markAt = i; });
    var quote = markAt >= 0 && els[markAt + 1] ? String(els[markAt + 1].text || '') : '';
    var key = 'generic.testimonial__ig_portrait__dark_bgpsd';
    return basePng().then(function (b) { return uploadBase('rich', key, b); }).then(function (up) {
      return post(mod.handleLayoutSave, LAYOUT_URL, { eventId: 'rich', templateId: 'generic.testimonial', format: 'ig_portrait', theme: 'dark', bg: '', width: 1080, height: 1350,
        base: up.json.url, elements: els, params: { quote: quote, speakerId: 's1' }, caption: { network: 'instagram', text: 'Our delegates said it best.' } });
    }).then(function (r) {
      var d = layoutDoc('rich', key) || {}, saved = JSON.parse(d.elements || '[]');
      /* every element comes back in its place: its text exactly as the browser wrote it, its font with single quotes */
      var mismatch = els.map(function (e, i) {
        var s = saved[i] || {};
        if (s.id !== e.id) return i + ': id ' + s.id + ' in place of ' + e.id;
        if (e.text != null && s.text !== String(e.text)) return i + ': text ' + JSON.stringify(s.text);
        if (e.fontFamily && s.fontFamily !== String(e.fontFamily).replace(/"/g, '\'')) return i + ': font ' + JSON.stringify(s.fontFamily);
        return '';
      }).filter(Boolean);
      if (quote === '') mismatch.push('no text follows the quote mark in ' + from);
      check('C.7 the Testimonial as the browser flattens it is accepted (' + from + ')', r.status === 200, r.json);
      check('C.7 … no double quote is left in any style, and every text (the quote\'s among them) is kept as typed', saved.length === els.length && mismatch.length === 0 &&
        saved.every(function (e) { return !/"/.test(e.fontFamily || ''); }) && saved.some(function (e) { return e.text === quote; }), mismatch);
      check('C.7 … with its options and caption', d.params && d.params.quote === quote && d.caption.network === 'instagram' && d.caption.text === 'Our delegates said it best.', [d.params, d.caption]);
    });
  },

  /* ===== C.10 example content refused on layout, base, art and the PSD summary ===== */
  function () {
    var svgEx = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><image href="' + BASE + EX_PATH + 'logos/l01.png" width="40" height="40"/></svg>');
    return basePng().then(function (b) { return uploadBase('rich', KEY, b); }).then(function (up) {
      var els = sampleEls(); els[1].text = 'ex-p01';
      return Promise.all([
        post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, params: { speakerId: 'ex-p03' } })),
        post(mod.handleLayoutSave, LAYOUT_URL, saveBody('rich', { base: up.json.url, elements: sampleEls().concat([{ id: 'x', type: 'frame', x: 0, y: 0, w: 9, h: 9, src: BASE + EX_PATH + 'people/p04.jpg' }]) })),
        upload(mod.handleArtUpload, ART + 'rich&slot=bg1&from=upload', svgEx),
        upload(mod.handlePicture, '/api/promo/social/picture?eventId=rich', svgEx),
        post(mod.handleArtPsd, '/api/promo/social/art/psd', { eventId: 'rich', name: 'from ' + EX_PATH + 'logos/l02.png', bytes: 1, canvasWidth: 10, canvasHeight: 10, found: { background: false, logoUnit: false } }),
        /* pixels are never example content: a raster file is not searched (its bytes would only match by chance) */
        uploadBase('rich', KEY, Buffer.concat([portraitBase, Buffer.from('<meta name="oneworld-example" content="speakers">')]))
      ]);
    }).then(function (r) {
      var names = ['layout options', 'layout elements', 'an SVG art upload', 'an SVG picture upload', 'PSD summary'];
      check('C.10 example content is refused with 422 code example on: ' + names.join(', '), r.slice(0, 5).every(function (x) { return x.status === 422 && x.json.code === 'example'; }), r.map(function (x, i) { return [names[i], x.status, x.json.code]; }));
      check('C.10 a layout base (PNG / WebP pixels) is not searched for markers', r[5].status === 200, r[5].json);
    });
  },

  /* ===== C.8 sign-in, the event id, a live event — every route ===== */
  function () {
    var routes = [
      ['handleCatalog', 'GET', '/api/promo/social/catalog?eventId=E'],
      ['handleArt', 'GET', ART + 'E'],
      ['handleArtUpload', 'RAW', ART + 'E&slot=bg1&from=upload'],
      ['handleArtPsd', 'JSON', '/api/promo/social/art/psd', { name: 'x', bytes: 1, canvasWidth: 10, canvasHeight: 10, found: { background: true, logoUnit: false } }],
      ['handleArtDelete', 'DELETE', ART + 'E&slot=bg1'],
      ['handleHtml', 'JSON', '/api/promo/social/html', { items: [{ templateId: 'generic.testimonial', format: 'ig_square' }] }],
      ['handleLayout', 'GET', LAYOUT_URL + '?eventId=E&templateId=speaker.individual&format=ig_portrait&theme=light&bg=2'],
      ['handleLayoutBase', 'RAW', LAYOUT_URL + '/base?eventId=E&key=' + KEY],
      ['handleLayoutSave', 'JSON', LAYOUT_URL, saveBody('E', { base: 'https://storage.googleapis.com/' + BUCKET + '/events/E/promo-layouts/' + KEY + '/k-0123456789abcdef.png' })],
      ['handleLayoutReset', 'JSON', LAYOUT_URL + '/reset', { templateId: 'speaker.individual', format: 'ig_portrait', theme: 'light', bg: '2' }],
      ['handlePicture', 'RAW', '/api/promo/social/picture?eventId=E']
    ];
    check('C.8 the list covers every route', routes.length === Object.keys(mod.ROUTES).length);
    return basePng().then(function (b) {
      var go = function (rt, id, auth) {
        var url = rt[2].replace('eventId=E', 'eventId=' + encodeURIComponent(id)), body = rt[3] ? Object.assign({}, rt[3], { eventId: id }) : null;
        if (rt[1] === 'RAW') return call(mod[rt[0]], { url: url, raw: b, auth: auth });
        if (rt[1] === 'JSON') return call(mod[rt[0]], { url: url, body: body, auth: auth });
        return call(mod[rt[0]], { url: url, method: rt[1], auth: auth });
      };
      return routes.reduce(function (p, rt) {
        return p.then(function (acc) {
          var live0 = SPY.live.length;
          return Promise.all([go(rt, 'gone', false), go(rt, 'Not An Id', true), go(rt, 'gone', true)]).then(function (r) {
            acc.push({ name: rt[0], signedOut: r[0].status, badId: r[1].status, gone: r[2].status, goneCode: r[2].json.code, liveAsked: SPY.live.slice(live0).indexOf('gone') !== -1 });
            return acc;
          });
        });
      }, Promise.resolve([]));
    }).then(function (out) {
      check('C.8 signed out: 401 on every route', out.every(function (x) { return x.signedOut === 401; }), out);
      check('C.8 a bad event id: 400 on every route', out.every(function (x) { return x.badId === 400; }), out);
      check('C.8 a deleted event: its 404 on every route, after asking whether the event is live', out.every(function (x) { return x.gone === 404 && x.liveAsked; }), out);
    });
  },

  /* ===== the body limits of plan §5c ===== */
  function () {
    /* the limit is handed over as the request starts, so it is read there, before the next request starts */
    var limitOf = function (handler, body) {
      SPY.limits.length = 0;
      var done = post(handler, '/x', Object.assign({ eventId: 'rich' }, body)), limit = SPY.limits[0];
      return done.then(function () { return limit; });
    };
    return Promise.all([limitOf(mod.handleHtml, { items: [] }), limitOf(mod.handleArtPsd, {}), limitOf(mod.handleLayoutSave, {}), limitOf(mod.handleLayoutReset, {})]).then(function (l) {
      check('§5c body limits: html 256 KB, PSD summary 16 KB, layout save 2 MiB (BODY_LIMITS.ai), reset 16 KB', l[0] === 256 * KB && l[1] === 16 * KB && l[2] === 2 * MB && l[3] === 16 * KB, l);
    });
  },

  /* ===== the module itself ===== */
  function () {
    var src = fs.readFileSync(path.join(__dirname, 'promo-social.js'), 'utf8');
    var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    check('source: never destroys a request (a 413 must reach the browser)', !/\.destroy\(/.test(code));
    check('source: no Chrome, no network fetch of its own', !/puppeteer|chromium|safeFetch|require\(['"]https?['"]\)/.test(src));
    check('source: every sharp job goes through the one queue', (src.match(/serially\(/g) || []).length === 2 && /function normalise[\s\S]*?return serially\(/.test(src));
    check('source: no route failed unexpectedly', FAILS.length === 0, FAILS);
  }
];

/* a step that never settles (a request left without an answer) is a failure, named, not a hang */
var STEP = 0;
var watchdog = setTimeout(function () { realError('FAIL step ' + STEP + ' did not finish within 120 s'); process.exit(1); }, 120000);
steps.reduce(function (p, step, i) {
  return p.then(function () { STEP = i + 1; return step(); }).then(null, function (err) { check('step ' + (i + 1) + ' ran without throwing', false, String(err && err.stack || err)); });
}, Promise.resolve()).then(function () {
  clearTimeout(watchdog);
  console.error = realError;
  Module._resolveFilename = realResolve;
  Object.keys(STUBS).forEach(function (k) { delete require.cache[STUBS[k].file]; });
  if (failed) { realError('promo-social: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-social: all ' + passed + ' checks passed');
});
