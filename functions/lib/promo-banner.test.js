// node functions/lib/promo-banner.test.js — Promotions → Mailers, the mail's top banner on the server
// (lib/promo-banner.js): what the banner is drawn from and its fingerprint, whether the stored one is still the
// event's, which picture addresses are this event's banners, and the two routes — the state (GET) and the
// upload (POST), with its checks, its record and the races between two uploads. No network: lib/promo.js's Kit
// is a stand-in, Firestore and Storage are in-memory fakes (the transaction one can pause between its read and
// its write), and only the 413 check talks to a server of its own on 127.0.0.1.
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const EventEmitter = require('events');
const sharp = require('sharp');

delete process.env.K_SERVICE;

var passed = 0, failed = 0;
var realError = console.error.bind(console);
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; realError('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

/* ---- lib/promo.js stands in: buildKit hands back the Kit below (or fails as told) ---- */
var KIT = null, KIT_FAIL = null, KIT_CALLS = 0;
var PROMO = require.resolve('./promo');
require.cache[PROMO] = { id: PROMO, filename: PROMO, loaded: true, children: [], paths: [], exports: {
  wire: function () {},
  buildKit: function (fb, eventId) {
    KIT_CALLS++;
    if (KIT_FAIL) return Promise.reject(KIT_FAIL);
    var d = FB.docs['events/' + eventId];
    if (!d || !d.data.createdAt || d.data.deletedAt) return Promise.reject(httpError(404, 'No event found for "' + eventId + '".', { code: 'event-not-found' }));
    return Promise.resolve(clone(KIT));
  }
} };

const mod = require('./promo-banner');
const { sendJson } = require('./http');
const T = mod._test;

function httpError(status, message, extra) { var e = new Error(message); e.status = status; e.body = Object.assign({ error: message }, extra || {}); return e; }

/* ---- the fixtures (§7): a rich event with a light-tone logo unit that has a dark-ground copy, and a sparse one ---- */
var BUCKET = 'revamp-qa.appspot.com';
var EV = 'qa-banner-summit';
var RICH = {
  event: { id: EV, name: 'Agentic AI Summit 2027 — 9th Edition', category: 'ip', start: '2027-03-12', end: '2027-03-13', dateLabel: '12–13 March 2027',
    place: 'Jio World Centre, Mumbai', venue: 'Jio World Centre', city: 'Mumbai', description: 'Where India\'s CIOs put agents to work.',
    siteUrl: 'https://revamp.example/e/' + EV, registerUrl: 'https://revamp.example/e/' + EV + '#register', published: true, hashtag: '#AgenticAiSummit27', edition: '9th Edition' },
  brand: { kind: 'generated', mode: 'dark',
    colours: { theme: '#d71920', accent: '#f5a623', background: '#0d1017', surface: '#161a22', text: '#f4f1ea', muted: '#a7a29a', heading: '#ffffff', onTheme: '#ffffff' },
    fonts: { heading: { family: 'Fraunces', stack: "'Fraunces', Georgia, serif", cssUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700' },
      body: { family: 'Manrope', stack: "'Manrope', Arial, sans-serif", cssUrl: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600' } },
    radius: '12px',
    logoUnit: { url: 'https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/generated/logo-unit.png', darkUrl: 'https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/generated/logo-unit-dark.png', width: 1200, height: 420, tone: 'light' },
    eventLogoUrl: 'https://img.etb2bimg.com/files/cp/agentic.png',
    heroImageUrl: 'https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/generated/hero.jpg',
    pictures: ['https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/gallery/1.jpg'],
    logoUnitParts: { before: 'Agentic', keyword: 'AI', after: 'Summit 2027' },
    portal: { slug: 'cio', name: 'ETCIO' } },
  content: {
    speakers: [{ id: 's1', name: 'अनन्या गुप्ता', designation: 'CIO', company: 'Bharat Bank', photoUrl: '', group: 'Keynote' },
      { id: 's2', name: 'O\'Brien "QA" <b>', designation: 'CTO', company: 'X', photoUrl: '', group: '' }],
    partners: [{ id: 'p1', name: 'Medtronic', logoUrl: '', tier: 'Presenting Partner', url: '' }],
    sessions: [], audience: ['CIOs'], topics: ['Agents'], stats: [{ value: '2', label: 'Days' }]
  }
};
var SPARSE = {
  event: { id: EV, name: 'Retail Leaders Forum', category: 'ip', start: '', end: '', dateLabel: '', place: '', venue: '', city: '', published: false, hashtag: '' },
  brand: { kind: 'ported', mode: 'light', colours: { theme: '#186bf9' }, fonts: { heading: { family: 'Inter', stack: "'Inter', Arial, sans-serif", cssUrl: '' }, body: { family: 'Inter', stack: "'Inter', Arial, sans-serif", cssUrl: '' } },
    radius: '12px', logoUnit: null, eventLogoUrl: '', heroImageUrl: '', pictures: [], logoUnitParts: { before: 'Retail', keyword: 'Leaders', after: 'Forum' } },
  content: { speakers: [], partners: [], sessions: [], audience: [], topics: [], stats: [] }
};
function fpOf(kit) { return mod.fingerprintOf(mod.inputsOf(kit)); }

/* ---- an in-memory Firestore and Storage ---- */
var VERSION = 0;
var FB = { docs: {}, files: {}, fail: {}, pause: null, commits: 0, attempts: 0 };
function snapOf(p) { var d = FB.docs[p]; return { id: p.split('/').pop(), exists: !!d, data: function () { return d ? clone(d.data) : undefined; } }; }
function refOf(p) {
  return {
    path: p,
    get: function () { if (FB.fail.read && /promoBanner/.test(p)) return Promise.reject(new Error('stub: unavailable')); return Promise.resolve(snapOf(p)); },
    set: function (data) { FB.docs[p] = { data: clone(data), version: ++VERSION }; return Promise.resolve(); },
    collection: function (name) { return colOf(p + '/' + name); }
  };
}
function colOf(p) { return { doc: function (id) { return refOf(p + '/' + id); } }; }
FB.db = {
  collection: function (name) { return colOf(name); },
  /* optimistic, as Firestore's: a document read in the transaction that changed before its commit makes it run
     again; an error thrown inside it ends it at once. FB.pause (a function returning a promise) holds the next
     attempt between its reads and its commit. */
  runTransaction: function (fn) {
    var attempt = 0;
    function once() {
      attempt++; FB.attempts++;
      var reads = {}, writes = [];
      var tx = {
        get: function (ref) { var d = FB.docs[ref.path]; reads[ref.path] = d ? d.version : 0; return Promise.resolve(snapOf(ref.path)); },
        set: function (ref, data) { writes.push([ref.path, data]); return tx; }
      };
      return Promise.resolve().then(function () { return fn(tx); }).then(function (result) {
        var hold = FB.pause; FB.pause = null;
        return Promise.resolve(hold ? hold() : null).then(function () {
          if (FB.fail.commit) throw new Error('stub: the commit failed');
          var changed = Object.keys(reads).some(function (p) { return (FB.docs[p] ? FB.docs[p].version : 0) !== reads[p]; });
          if (changed) { if (attempt >= 5) throw new Error('stub: too much contention'); return once(); }
          writes.forEach(function (w) { FB.docs[w[0]] = { data: clone(w[1]), version: ++VERSION }; });
          FB.commits++;
          /* the commit landed, but its answer is lost on the way back */
          if (FB.fail.commitLost) throw new Error('stub: deadline exceeded after the commit');
          return result;
        });
      });
    }
    return once();
  }
};
FB.bucket = {
  name: BUCKET,
  file: function (p) {
    return {
      name: p,
      save: function (buf, opts) {
        if (FB.fail.save) return Promise.reject(new Error('stub: storage is down'));
        FB.files[p] = { bytes: Buffer.from(buf), opts: opts, public: false };
        return Promise.resolve();
      },
      makePublic: function () {
        if (FB.fail.makePublic) return Promise.reject(new Error('stub: makePublic failed'));
        if (!FB.files[p]) return Promise.reject(new Error('stub: no such object'));
        FB.files[p].public = true; return Promise.resolve();
      },
      delete: function () { delete FB.files[p]; return Promise.resolve(); }
    };
  }
};
function seedEvent(data) { FB.docs['events/' + EV] = { data: data || { createdAt: '2026-10-01T00:00:00.000Z', name: 'x' }, version: ++VERSION }; }
function recordNow() { var d = FB.docs['events/' + EV + '/promoBanner/current']; return d ? d.data : null; }
function bannerFiles() { return Object.keys(FB.files).filter(function (p) { return p.indexOf('events/' + EV + '/promo-banner/') === 0; }); }
function urlOf(p) { return 'https://storage.googleapis.com/' + BUCKET + '/' + p; }

/* ---- lib/api.js's helpers ---- */
var DECODED = { email: 'maker@timesinternet.in' };
var FAILS = [];
var HELPERS = {
  withAdmin: function (req, res, cb) {
    if (!/^Bearer /.test(String((req.headers && req.headers.authorization) || ''))) return sendJson(res, 401, { error: 'Sign in required.' });
    cb(FB, DECODED);
  },
  eventIdOr400: function (res, value) {
    var id = typeof value === 'string' ? value.trim() : '';
    if (!id) { sendJson(res, 400, { error: 'eventId is required.' }); return ''; }
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) { sendJson(res, 400, { error: 'Invalid eventId.' }); return ''; }
    return id;
  },
  sendFailure: function (res, what, err, friendly) {
    if (err && err.status && err.body) return sendJson(res, err.status, err.body);
    FAILS.push(what + ': ' + (err && err.message));
    sendJson(res, 500, { error: friendly });
  }
};

/* one request through a route. A raw body is sent in 64 KB chunks after the handler has attached its listeners;
   o.noLength leaves Content-Length out (a chunked upload). */
function call(handler, method, url, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var req = new EventEmitter();
    req.method = method; req.url = url; req.headers = { authorization: o.anon ? '' : 'Bearer editor' };
    req.resumed = 0; req.resume = function () { req.resumed++; return req; };
    var body = o.body;
    if (body && !o.noLength) req.headers['content-length'] = String(body.length);
    var res = { status: 0, headers: {}, headersSent: false,
      writeHead: function (s, h) { res.status = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      end: function (b) {
        var json = null;
        try { json = JSON.parse(String(b)); } catch (e) { /* not JSON */ }
        setImmediate(function () { resolve({ status: res.status, headers: res.headers, json: json, req: req }); });
      } };
    handler(req, res);
    if (method === 'POST') {
      setImmediate(function () {
        var buf = body || Buffer.alloc(0);
        for (var i = 0; i < buf.length; i += 65536) req.emit('data', buf.subarray(i, i + 65536));
        req.emit('end');
      });
    }
  });
}
function jpeg(w, h, o) {
  o = o || {};
  var s = sharp({ create: { width: w, height: h, channels: 3, background: o.colour || '#2a3b4c' } });
  if (o.orientation) s = s.withMetadata({ orientation: o.orientation });
  return s.jpeg({ quality: 80 }).toBuffer();
}
function upUrl(fp, eventId) { return '/api/promo/mailer/banner?eventId=' + (eventId || EV) + (fp == null ? '' : '&fingerprint=' + fp); }
function upload(buf, fp, o) { return call(mod.handleBannerUpload, 'POST', upUrl(fp), Object.assign({ body: buf }, o || {})); }
function state() { return call(mod.handleBanner, 'GET', '/api/promo/mailer/banner?eventId=' + EV); }

async function main() {
  /* ======== loading ======== */
  check('the module says what it exports', ['wire', 'inputsOf', 'fingerprintOf', 'stateFor', 'isBannerUrl', 'handleBanner', 'handleBannerUpload'].every(function (k) { return typeof mod[k] === 'function'; }) &&
    typeof mod.BANNER_VERSION === 'number' && mod.BANNER_VERSION >= 1);

  /* ======== K.1 the fingerprint ======== */
  var base = fpOf(RICH);
  check('a fingerprint is 32 hex', /^[0-9a-f]{32}$/.test(base), base);
  check('the same Kit, the same fingerprint', fpOf(clone(RICH)) === base);
  var changes = {
    'the hero picture': function (k) { k.brand.heroImageUrl += '?2'; },
    'the logo unit\'s picture': function (k) { k.brand.logoUnit.url = k.brand.logoUnit.url.replace('logo-unit', 'logo-unit-2'); },
    'the logo unit\'s dark-ground copy': function (k) { k.brand.logoUnit.darkUrl = ''; },
    'the logo unit\'s tone': function (k) { k.brand.logoUnit.tone = 'dark'; },
    'no logo unit any more': function (k) { k.brand.logoUnit = null; },
    'the name\'s small line (logo parts)': function (k) { k.brand.logoUnitParts.before = 'The Agentic'; },
    'the name\'s keyword (logo parts)': function (k) { k.brand.logoUnitParts.keyword = 'Agentic'; },
    'the rest of the name (logo parts)': function (k) { k.brand.logoUnitParts.after = 'Summit'; },
    'the event\'s name': function (k) { k.event.name = 'Agentic AI Summit 2028'; },
    'the date': function (k) { k.event.dateLabel = '14–15 March 2027'; },
    'the venue': function (k) { k.event.place = 'NESCO, Mumbai'; },
    'the mode': function (k) { k.brand.mode = 'light'; },
    'the radius': function (k) { k.brand.radius = '0px'; },
    'the heading font\'s family': function (k) { k.brand.fonts.heading.family = 'Lora'; },
    'the heading font\'s stack': function (k) { k.brand.fonts.heading.stack = "'Fraunces', serif"; },
    'the heading font\'s CSS address (to the template\'s own @font-face rules)': function (k) { k.brand.fonts.heading.cssUrl = 'data:text/css;charset=utf-8,' + encodeURIComponent('@font-face{font-family:Fraunces;src:url(https://st.etb2bimg.com/f/fraunces.woff2)}'); },
    'the body font\'s family': function (k) { k.brand.fonts.body.family = 'Inter'; },
    'the body font\'s stack': function (k) { k.brand.fonts.body.stack = "'Manrope', sans-serif"; },
    'the body font\'s CSS address (to a stylesheet on another host)': function (k) { k.brand.fonts.body.cssUrl = 'https://use.typekit.net/abc1def.css'; }
  };
  ['theme', 'accent', 'background', 'surface', 'text', 'muted', 'heading', 'onTheme'].forEach(function (c) {
    changes['the colour ' + c] = function (k) { k.brand.colours[c] = '#123456'; };
  });
  Object.keys(changes).forEach(function (what) {
    var k = clone(RICH); changes[what](k);
    check('K.1 the fingerprint changes with ' + what, fpOf(k) !== base);
  });
  var bumped = Object.assign(mod.inputsOf(RICH), { v: mod.BANNER_VERSION + 1 });
  check('K.1 the fingerprint changes with BANNER_VERSION', mod.fingerprintOf(bumped) !== base && mod.inputsOf(RICH).v === mod.BANNER_VERSION);
  /* What lib/promo.js buildKit asks the network for, and each server instance keeps for hours (a failed answer
     too), never moves the fingerprint: else two instances could each hold a different one for the same event, and
     the upload or a send answered by the other one would be refused as moved or stale again and again. */
  var sameEverywhere = {
    'the logo unit measured on one instance and not on the other (1200 x 420 against 0 x 0)': function (k) { k.brand.logoUnit.width = 0; k.brand.logoUnit.height = 0; },
    'another measured width and height of the same picture': function (k) { k.brand.logoUnit.width = 1100; k.brand.logoUnit.height = 400; },
    'the heading font\'s Google address checked down to the bare family': function (k) { k.brand.fonts.heading.cssUrl = 'https://fonts.googleapis.com/css2?family=Fraunces'; },
    'the heading font\'s Google address with another option': function (k) { k.brand.fonts.heading.cssUrl += '&display=swap'; },
    'the body font\'s Google address checked down to nothing': function (k) { k.brand.fonts.body.cssUrl = ''; },
    'both at once (a failed measure and a failed font check)': function (k) { k.brand.logoUnit.width = 0; k.brand.logoUnit.height = 0; k.brand.fonts.heading.cssUrl = ''; k.brand.fonts.body.cssUrl = ''; }
  };
  Object.keys(sameEverywhere).forEach(function (what) {
    var k = clone(RICH); sameEverywhere[what](k);
    check('K.1 the fingerprint is the same on every instance: ' + what, fpOf(k) === base);
  });
  var measured = mod.inputsOf(RICH);
  check('K.1 the drawing still gets the unit\'s size and the fonts\' addresses as the Kit has them', measured.brand.logoUnit.width === 1200 && measured.brand.logoUnit.height === 420 &&
    measured.brand.fonts.heading.cssUrl === RICH.brand.fonts.heading.cssUrl && measured.brand.fonts.body.cssUrl === RICH.brand.fonts.body.cssUrl, measured.brand);
  var inputsBefore = JSON.stringify(measured);
  mod.fingerprintOf(measured);
  check('K.1 taking the fingerprint leaves the inputs as they were', JSON.stringify(measured) === inputsBefore);
  check('K.1 the fingerprint of inputs with no brand is still taken', /^[0-9a-f]{32}$/.test(mod.fingerprintOf(null)) && /^[0-9a-f]{32}$/.test(mod.fingerprintOf({ v: 1 })));
  /* the same Kit with every object's keys in reverse order */
  function reversed(v) {
    if (Array.isArray(v)) return v.map(reversed);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).reverse().forEach(function (k) { o[k] = reversed(v[k]); }); return o; }
    return v;
  }
  var rev = reversed(RICH);
  check('K.1 a reordered but equal Kit keeps the fingerprint', JSON.stringify(rev) !== JSON.stringify(RICH) && fpOf(rev) === base);
  var outside = clone(RICH);
  outside.content.speakers.push({ id: 's9', name: 'Meera Kulkarni', designation: 'CDO', company: 'Y', photoUrl: '', group: '' });
  outside.content.partners = [];
  outside.content.stats = [];
  outside.brand.pictures = [];
  outside.brand.eventLogoUrl = 'https://img.etb2bimg.com/files/cp/other.png';
  outside.brand.portal = null;
  outside.brand.kind = 'ported';
  outside.event.hashtag = '#Other27';
  outside.event.description = 'Another line.';
  outside.event.published = false;
  outside.event.siteUrl = 'https://other.example/';
  check('K.1 Kit fields outside the inputs (speakers, partners, counts, other pictures…) keep the fingerprint', fpOf(outside) === base);
  check('K.1 the venue and the city stand in for a Kit without a place (as the drawing reads it)',
    mod.inputsOf({ event: { venue: 'NESCO', city: 'Mumbai' } }).event.place === 'NESCO, Mumbai' && mod.inputsOf({ event: { place: 'P', venue: 'V' } }).event.place === 'P');
  check('canonical JSON sorts keys at every depth', T.canonical({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } }) === '{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}');

  /* ======== K.2 the inputs carry only real data ======== */
  var inR = mod.inputsOf(RICH), inS = mod.inputsOf(SPARSE);
  check('K.2 the inputs are Kit-shaped: event, brand and the version only', Object.keys(inR).sort().join() === 'brand,event,v' &&
    Object.keys(inR.event).sort().join() === 'dateLabel,name,place' &&
    Object.keys(inR.brand).sort().join() === 'colours,fonts,heroImageUrl,logoUnit,logoUnitParts,mode,radius', [Object.keys(inR), Object.keys(inR.event), Object.keys(inR.brand)]);
  check('K.2 a rich event\'s facts as the Kit has them', inR.event.name === RICH.event.name && inR.event.dateLabel === RICH.event.dateLabel && inR.event.place === RICH.event.place &&
    inR.brand.heroImageUrl === RICH.brand.heroImageUrl && inR.brand.mode === 'dark');
  check('K.2 the logo unit with its dark-ground copy, size and tone', JSON.stringify(inR.brand.logoUnit) === JSON.stringify(RICH.brand.logoUnit), inR.brand.logoUnit);
  check('K.2 an event without a venue has place \'\' (never made up)', inS.event.place === '' && inS.event.dateLabel === '', inS.event);
  check('K.2 an event without a logo unit has none', inS.brand.logoUnit === null);
  check('K.2 a logo unit with no dark-ground copy has darkUrl \'\'', mod.inputsOf({ brand: { logoUnit: { url: 'https://img.etb2bimg.com/u.png', width: 3, height: 1, tone: 'light' } } }).brand.logoUnit.darkUrl === '');
  check('K.2 a logo unit with no picture is no logo unit', mod.inputsOf({ brand: { logoUnit: { url: '', darkUrl: 'https://img.etb2bimg.com/d.png' } } }).brand.logoUnit === null);
  check('K.2 a missing Kit gives empty inputs, not an error', mod.inputsOf(null).event.name === '' && mod.inputsOf(undefined).brand.heroImageUrl === '' && mod.inputsOf({}).brand.mode === 'light');
  check('K.2 the inputs never hold an example (no library address, no ex- id)', !/\/assets\/promo-examples\/|"ex-/.test(JSON.stringify([inR, inS])));
  var src = fs.readFileSync(path.join(__dirname, 'promo-banner.js'), 'utf8');
  check('K.2 the module never reads the example library', !/promo-examples/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('an upload is never cut off (no destroy(): a 413 is answered and the rest drained)', !/\.destroy\(/.test(src));
  check('no activity is logged for a banner (a picture made for the team, not an edit)', !/logActivity|require\('\.\/activity'\)/.test(src));
  check('K.2 nothing outside the inputs reaches them (no speaker, partner, hashtag or description)', !/अनन्या|O'Brien|Medtronic|#Agentic|CIOs put agents/.test(JSON.stringify(inR)));

  /* ======== K.3 needed, fresh, stale ======== */
  seedEvent();
  /* stateFor is called by lib/promo-mailer.js, which may not have wired this module: it needs no helpers */
  var s0 = await mod.stateFor(FB, EV, RICH);
  check('K.3 no record: needed, not fresh, no url', s0.needed === true && s0.fresh === false && s0.url === null && s0.fingerprint === base, s0);
  var sNo = await mod.stateFor(FB, EV, SPARSE);
  check('K.3 no hero picture: not needed', sNo.needed === false && sNo.fresh === false, sNo);
  FB.docs['events/' + EV + '/promoBanner/current'] = { data: { fingerprint: base, url: urlOf('events/' + EV + '/promo-banner/a.jpg'), at: 1 }, version: ++VERSION };
  var s1 = await mod.stateFor(FB, EV, RICH);
  check('K.3 a record with this fingerprint: fresh, with its url', s1.needed && s1.fresh === true && s1.url === urlOf('events/' + EV + '/promo-banner/a.jpg'), s1);
  var moved = clone(RICH); moved.event.dateLabel = '20 March 2027';
  var s2 = await mod.stateFor(FB, EV, moved);
  check('K.3 a record of other inputs: stale (the stored url is still told)', s2.needed && s2.fresh === false && s2.url === s1.url && s2.fingerprint !== base, s2);
  FB.docs['events/' + EV + '/promoBanner/current'] = { data: { fingerprint: fpOf(SPARSE), url: urlOf('events/' + EV + '/promo-banner/b.jpg'), at: 2 }, version: ++VERSION };
  var s3 = await mod.stateFor(FB, EV, SPARSE);
  check('K.3 no hero picture: never fresh, whatever is stored (no banner goes in the mail)', s3.needed === false && s3.fresh === false, s3);
  FB.docs['events/' + EV + '/promoBanner/current'] = { data: { fingerprint: base, url: '', at: 3 }, version: ++VERSION };
  check('K.3 a record without a url is not fresh', (await mod.stateFor(FB, EV, RICH)).fresh === false);
  var logs = [];
  console.error = function () { logs.push([].slice.call(arguments).join(' ')); };
  FB.fail.read = true;
  var s4 = await mod.stateFor(FB, EV, RICH).then(function (v) { return v; }, function (e) { return { rejected: String(e) }; });
  FB.fail.read = false;
  console.error = realError;
  check('K.3 a record that cannot be read: stale, never a rejection, and logged', !s4.rejected && s4.needed && s4.fresh === false && s4.url === null && logs.some(function (l) { return /promo-banner: the banner record/.test(l); }), [s4, logs]);
  delete FB.docs['events/' + EV + '/promoBanner/current'];

  /* ======== isBannerUrl ======== */
  var own = urlOf('events/' + EV + '/promo-banner/0123456789abcdef-mgx1y2z3-0123456789abcdef.jpg');
  check('isBannerUrl: this event\'s banner', mod.isBannerUrl(own, BUCKET, EV) === true);
  check('isBannerUrl: any picture in this event\'s banner folder', mod.isBannerUrl(urlOf('events/' + EV + '/promo-banner/old.jpg'), BUCKET, EV) === true);
  [['another event\'s', urlOf('events/qa-other/promo-banner/a.jpg')], ['another bucket\'s', own.replace(BUCKET, 'other-bucket')],
    ['the hero picture', RICH.brand.heroImageUrl], ['another folder', urlOf('events/' + EV + '/promo-art/a.jpg')],
    ['a deeper path', urlOf('events/' + EV + '/promo-banner/x/a.jpg')], ['a climb out', urlOf('events/' + EV + '/promo-banner/..a.jpg')],
    ['one with a query', own + '?v=2'], ['one with an encoded slash', urlOf('events/' + EV + '/promo-banner/a%2fb.jpg')], ['a PNG', own.replace(/\.jpg$/, '.png')],
    ['http', own.replace('https:', 'http:')], ['the folder itself', urlOf('events/' + EV + '/promo-banner/')], ['ET\'s image host', 'https://img.etb2bimg.com/files/cp/banner.jpg']].forEach(function (c) {
    check('isBannerUrl: not ' + c[0], mod.isBannerUrl(c[1], BUCKET, EV) === false, c[1]);
  });
  check('isBannerUrl: nothing without a bucket or a valid event id', !mod.isBannerUrl(own, '', EV) && !mod.isBannerUrl(own, BUCKET, '') && !mod.isBannerUrl(own, BUCKET, 'Bad/Id') && !mod.isBannerUrl(null, BUCKET, EV) && !mod.isBannerUrl({}, BUCKET, EV));
  check('isBannerUrl: surrounding spaces are ignored', mod.isBannerUrl('  ' + own + ' ', BUCKET, EV) === true);

  /* ======== the routes ======== */
  mod.wire(HELPERS);
  KIT = clone(RICH);

  var g0 = await state();
  check('GET: needed, stale, the fingerprint and the inputs', g0.status === 200 && g0.json.needed === true && g0.json.fresh === false && g0.json.url === null &&
    g0.json.fingerprint === base && JSON.stringify(g0.json.inputs) === JSON.stringify(mod.inputsOf(RICH)), g0.json);
  check('GET: never cached', g0.headers['Cache-Control'] === 'no-store');
  check('GET: signed out -> 401', (await call(mod.handleBanner, 'GET', '/api/promo/mailer/banner?eventId=' + EV, { anon: true })).status === 401);
  check('GET: a bad event id -> 400', (await call(mod.handleBanner, 'GET', '/api/promo/mailer/banner?eventId=Bad..id')).status === 400);
  KIT_FAIL = httpError(404, 'This event has been deleted.', { code: 'event-deleted' });
  check('GET: an event that is not live -> its 404', (await state()).status === 404);
  KIT_FAIL = new Error('stub: firestore down');
  var gx = await state();
  check('GET: anything else -> 500 with a plain sentence', gx.status === 500 && /could not be checked/.test(gx.json.error) && FAILS.length === 1, gx.json);
  KIT_FAIL = null; FAILS.length = 0;
  KIT = clone(SPARSE);
  var gs = await state();
  check('GET: no hero picture -> not needed', gs.status === 200 && gs.json.needed === false && gs.json.fresh === false, gs.json);
  KIT = clone(RICH);

  /* ======== K.4 the upload ======== */
  var good = await jpeg(1500, 760);
  var r;
  r = await upload(Buffer.from('this is not a picture at all, just words'), base);
  check('K.4 wrong magic -> 400', r.status === 400 && /JPEG/.test(r.json.error), r.json);
  var png = await sharp({ create: { width: 1500, height: 760, channels: 3, background: '#000' } }).png().toBuffer();
  r = await upload(png, base);
  check('K.4 a PNG -> 400', r.status === 400, r.json);
  r = await upload(await jpeg(1500, 500), base);
  check('K.4 1500 x 500 -> 400', r.status === 400 && /1500 pixels wide/.test(r.json.error), r.json);
  r = await upload(await jpeg(1501, 760), base);
  check('K.4 1501 wide -> 400', r.status === 400, r.json);
  r = await upload(await jpeg(1500, 901), base);
  check('K.4 901 tall -> 400', r.status === 400, r.json);
  r = await upload(await jpeg(1500, 760, { orientation: 6 }), base);
  check('K.4 a picture turned by its EXIF tag -> 400', r.status === 400, r.json);
  var cut = Buffer.concat([good.subarray(0, good.length - 2), Buffer.from([0, 0])]);
  r = await upload(cut, base);
  check('K.4 a cut-off JPEG (no end marker) -> 400', r.status === 400, r.json);
  var fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('garbage in the middle'), Buffer.from([0xff, 0xd9])]);
  r = await upload(fakeJpeg, base);
  check('K.4 JPEG markers around nonsense -> 400', r.status === 400, r.json);
  r = await upload(Buffer.alloc(0), base);
  check('K.4 an empty body -> 400 empty upload', r.status === 400 && r.json.error === 'empty upload', r.json);
  r = await upload(good, null);
  check('K.4 no fingerprint -> 400', r.status === 400 && /fingerprint/.test(r.json.error), r.json);
  r = await upload(good, 'ABC');
  check('K.4 a malformed fingerprint -> 400', r.status === 400, r.json);
  r = await upload(good, base, { anon: true });
  check('K.4 signed out -> 401', r.status === 401);
  check('K.4 nothing stored by any refused upload', bannerFiles().length === 0 && !recordNow(), bannerFiles());

  var big = Buffer.alloc(T.MAX_BYTES + 1, 0xff);
  r = await upload(big, base);
  check('K.4 over 2 MiB (declared) -> 413, drained', r.status === 413 && r.json.error === 'That upload is too large.' && r.req.resumed > 0, r.json);
  r = await upload(big, base, { noLength: true });
  check('K.4 over 2 MiB (chunked) -> 413, drained', r.status === 413 && r.req.resumed > 0, r.json);
  r = await upload(Buffer.alloc(T.MAX_BYTES, 0), base);
  check('K.4 exactly 2 MiB is read (then refused as no picture, not as too large)', r.status === 400, r.json);

  /* over 2 MiB, read by a client that keeps writing: the answer arrives, the connection is never reset */
  var server = http.createServer(function (req, res) {
    req.headers.authorization = 'Bearer editor';
    mod.handleBannerUpload(req, res);
  });
  await new Promise(function (ok) { server.listen(0, '127.0.0.1', ok); });
  var port = server.address().port, agent = new http.Agent({ keepAlive: true });
  function rawPost(total, chunked) {
    return new Promise(function (resolve) {
      var headers = { 'Content-Type': 'image/jpeg' };
      if (!chunked) headers['Content-Length'] = String(total);
      var out = { status: 0, body: '', error: null, wrote: 0 };
      /* kept alive, as a browser's connection is: a client that asks for the connection to be closed has it closed
         once the answer is out (Node's own rule), which is not what is being checked here */
      var req = http.request({ host: '127.0.0.1', port: port, method: 'POST', path: upUrl(base), headers: headers, agent: agent }, function (res) {
        out.status = res.statusCode;
        res.setEncoding('utf8');
        res.on('data', function (d) { out.body += d; });
        res.on('end', function () { out.ended = true; });
      });
      req.on('error', function (e) { out.error = e.code || e.message; });
      var chunk = Buffer.alloc(64 * 1024, 0xab);
      (function write() {
        while (out.wrote < total) {
          var n = Math.min(chunk.length, total - out.wrote);
          out.wrote += n;
          if (!req.write(chunk.subarray(0, n))) return req.once('drain', write);
        }
        req.end();
      })();
      req.on('close', function () { setTimeout(function () { resolve(out); }, 20); });
    });
  }
  var t1 = await rawPost(3 * 1024 * 1024, false);
  check('K.4 413 read by a client that keeps writing (declared length)', t1.status === 413 && /too large/.test(t1.body) && !t1.error, t1);
  var t2 = await rawPost(3 * 1024 * 1024, true);
  check('K.4 413 read by a client that keeps writing (chunked: it was still writing past the limit)', t2.status === 413 && /too large/.test(t2.body) && !t2.error && t2.wrote > T.MAX_BYTES, t2);
  agent.destroy();
  await new Promise(function (ok) { server.close(ok); });

  /* a fingerprint that is no longer the event's */
  var old = clone(RICH); old.event.place = 'NESCO, Mumbai';
  r = await upload(good, fpOf(old));
  check('K.4 a fingerprint that is no longer current -> 409 banner-moved', r.status === 409 && r.json.code === 'banner-moved' && /drawn again/.test(r.json.error), r.json);
  check('K.4 banner-moved stores nothing', bannerFiles().length === 0 && !recordNow());
  KIT = clone(SPARSE);
  r = await upload(good, fpOf(SPARSE));
  check('K.4 an event with no hero picture takes no banner -> 409 banner-moved', r.status === 409 && r.json.code === 'banner-moved', r.json);
  KIT = clone(RICH);

  /* success */
  var t0 = Date.now(), calls0 = KIT_CALLS;
  r = await upload(good, base);
  var rec1 = recordNow(), files1 = bannerFiles();
  check('K.4 success -> { ok, url, fingerprint, width, height }', r.status === 200 && r.json.ok === true && r.json.fingerprint === base && r.json.width === 1500 && r.json.height === 760 && typeof r.json.url === 'string', r.json);
  check('K.4 the Kit is built once per upload', KIT_CALLS - calls0 === 1, KIT_CALLS - calls0);
  check('K.4 one object, under promo-banner/, named <fingerprint 16>-<base36 time>-<16 hex>.jpg', files1.length === 1 &&
    new RegExp('^events/' + EV + '/promo-banner/' + base.slice(0, 16) + '-[0-9a-z]+-[0-9a-f]{16}\\.jpg$').test(files1[0]), files1);
  var f1 = FB.files[files1[0]] || {};
  check('K.4 the object is public, a JPEG, cached for a year', f1.public === true && f1.opts && f1.opts.metadata.contentType === 'image/jpeg' &&
    f1.opts.metadata.cacheControl === 'public, max-age=31536000, immutable' && f1.opts.resumable === false, f1.opts);
  check('K.4 the bytes are stored as the browser drew them', f1.bytes && f1.bytes.equals(good));
  check('K.4 the url is the object\'s public address, and one isBannerUrl knows', r.json.url === urlOf(files1[0]) && mod.isBannerUrl(r.json.url, BUCKET, EV));
  check('K.4 the record: fingerprint, url, path, size, bytes, when, by', rec1 && rec1.fingerprint === base && rec1.url === r.json.url && rec1.path === files1[0] && rec1.width === 1500 &&
    rec1.height === 760 && rec1.bytes === good.length && rec1.at >= t0 && rec1.by === DECODED.email, rec1);
  var g1 = await state();
  check('K.4 GET is fresh now, with the url, and never tells who drew it', g1.json.fresh === true && g1.json.url === r.json.url && JSON.stringify(g1.json).indexOf(DECODED.email) === -1, g1.json);
  check('K.4 stateFor agrees', (await mod.stateFor(FB, EV, RICH)).fresh === true);

  /* the event changes: a new banner, the old object kept */
  KIT = clone(RICH); KIT.event.dateLabel = '19–20 March 2027';
  var fp2 = fpOf(KIT);
  check('K.4 after a change the stored banner is stale', (await state()).json.fresh === false);
  var good2 = await jpeg(1500, 640, { colour: '#7a1f1f' });
  r = await upload(good2, fp2);
  var files2 = bannerFiles();
  check('K.4 the new banner is recorded', r.status === 200 && recordNow().fingerprint === fp2 && recordNow().url === r.json.url && recordNow().height === 640, r.json);
  check('K.4 older banner objects are kept (sent mails point at them)', files2.length === 2 && files2.indexOf(files1[0]) !== -1 && FB.files[files1[0]].public === true, files2);
  check('K.4 GET is fresh with the new url', (await state()).json.url === r.json.url);

  /* two uploads of the same fingerprint, one after the other */
  r = await upload(good2, fp2);
  var later = r.json.url;
  check('K.4 the same fingerprint twice: both objects valid, the record holds the later', r.status === 200 && bannerFiles().length === 3 &&
    recordNow().url === later && bannerFiles().every(function (p) { return FB.files[p].public; }), recordNow());

  /* two uploads of the same fingerprint at once: A checked first, B committed first while A's transaction waited */
  var realNow = Date.now, clock = realNow() + 100000;
  Date.now = function () { return clock; };
  var release, held = new Promise(function (ok) { release = ok; });
  var attempts0 = FB.attempts;
  var reached, atPause = new Promise(function (ok) { reached = ok; });
  FB.pause = function () { reached(); return held; };
  var pA = upload(good2, fp2);
  /* A holds between its transaction's read and its commit */
  await atPause;
  clock += 5000;
  var rB = await upload(good2, fp2);
  release();
  var rA = await pA;
  Date.now = realNow;
  check('K.4 race: B, checked later, is recorded even though A started first', rB.status === 200 && rA.status === 200 && recordNow().url === rB.json.url, [rA.json, rB.json, recordNow()]);
  check('K.4 race: A\'s transaction ran again and kept B (its picture is still answered and kept)', FB.attempts - attempts0 >= 3 && !!FB.files[rA.json.url.replace('https://storage.googleapis.com/' + BUCKET + '/', '')] && rA.json.url !== rB.json.url);

  /* the event changes between A's check and its commit, and B records the new inputs first */
  clock = realNow() + 200000;
  Date.now = function () { return clock; };
  held = new Promise(function (ok) { release = ok; });
  attempts0 = FB.attempts;
  atPause = new Promise(function (ok) { reached = ok; });
  FB.pause = function () { reached(); return held; };
  var count0 = bannerFiles().length;
  pA = upload(good2, fp2);
  await atPause;
  clock += 5000;
  KIT = clone(RICH); KIT.event.dateLabel = '21–22 March 2027';
  var fp3 = fpOf(KIT);
  rB = await upload(good2, fp3);
  release();
  rA = await pA;
  Date.now = realNow;
  check('K.4 race: an upload overtaken by newer inputs -> 409 banner-moved, the newer record kept', rA.status === 409 && rA.json.code === 'banner-moved' && rB.status === 200 &&
    recordNow().fingerprint === fp3 && recordNow().url === rB.json.url, [rA.json, recordNow()]);
  check('K.4 race: the overtaken picture, never recorded, is not left behind', bannerFiles().length === count0 + 1, bannerFiles().length - count0);
  /* the races ran on a clock ahead of the real one: time moves on past them before the next uploads */
  FB.docs['events/' + EV + '/promoBanner/current'].data.at = realNow() - 1;

  /* Storage and Firestore failures */
  KIT = clone(RICH); KIT.event.dateLabel = '23 March 2027';
  var fp4 = fpOf(KIT), before = bannerFiles().length, recBefore = clone(recordNow());
  FB.fail.makePublic = true;
  r = await upload(good2, fp4);
  FB.fail.makePublic = false;
  check('K.4 an object that cannot be made public is removed; 500 with a plain sentence; no record', r.status === 500 && /could not be stored/.test(r.json.error) &&
    bannerFiles().length === before && JSON.stringify(recordNow()) === JSON.stringify(recBefore), [r.json, bannerFiles().length - before]);
  FB.fail.commit = true;
  var filesBefore = bannerFiles();
  r = await upload(good2, fp4);
  FB.fail.commit = false;
  var keptByFailure = bannerFiles().filter(function (p) { return filesBefore.indexOf(p) === -1; });
  /* a failed commit cannot tell whether it landed: the picture is kept (banners are never removed while the event
     lives), and a stray public picture costs nothing */
  check('K.4 a record that cannot be written: 500, the record as it was, the picture kept', r.status === 500 && /could not be stored/.test(r.json.error) &&
    JSON.stringify(recordNow()) === JSON.stringify(recBefore) && keptByFailure.length === 1 && FB.files[keptByFailure[0]].public === true, [r.json, keptByFailure]);
  /* the commit lands but its answer is lost: the record now names this picture, which must still be there */
  FB.fail.commitLost = true;
  filesBefore = bannerFiles();
  r = await upload(good2, fp4);
  FB.fail.commitLost = false;
  var keptByLost = bannerFiles().filter(function (p) { return filesBefore.indexOf(p) === -1; });
  check('K.4 a commit whose answer is lost: 500, and the picture the record now names is kept and public', r.status === 500 && keptByLost.length === 1 &&
    recordNow().path === keptByLost[0] && recordNow().fingerprint === fp4 && !!FB.files[recordNow().path] && FB.files[recordNow().path].public === true, [r.json, keptByLost, recordNow()]);
  check('K.4 then GET says fresh, with a url whose picture is there', (await state()).json.fresh === true && !!FB.files[recordNow().url.replace('https://storage.googleapis.com/' + BUCKET + '/', '')]);
  before = bannerFiles().length; recBefore = clone(recordNow());
  FB.fail.save = true;
  r = await upload(good2, fp4);
  FB.fail.save = false;
  check('K.4 Storage down: 500, nothing recorded', r.status === 500 && JSON.stringify(recordNow()) === JSON.stringify(recBefore));
  /* the event is deleted while its banner is stored */
  var realSave = FB.bucket.file;
  FB.bucket.file = function (p) {
    var f = realSave(p), save = f.save;
    f.save = function (b, o) { FB.docs['events/' + EV].data.deletedAt = '2026-10-29T00:00:00.000Z'; return save(b, o); };
    return f;
  };
  r = await upload(good2, fp4);
  FB.bucket.file = realSave;
  delete FB.docs['events/' + EV].data.deletedAt;
  check('K.4 an event deleted meanwhile: 404, no record, the object removed', r.status === 404 && bannerFiles().length === before && JSON.stringify(recordNow()) === JSON.stringify(recBefore), r.json);
  check('K.4 the failures were logged for us', FAILS.length >= 3, FAILS);
  FAILS.length = 0;

  /* heights at the edges */
  r = await upload(await jpeg(1500, 560), fp4);
  check('K.4 560 tall is a banner', r.status === 200 && r.json.height === 560, r.json);
  KIT.event.dateLabel = '24 March 2027';
  r = await upload(await jpeg(1500, 900), fpOf(KIT));
  check('K.4 900 tall is a banner', r.status === 200 && r.json.height === 900, r.json);

  /* the module loads with no environment and nothing runs at load */
  var out = require('child_process').spawnSync(process.execPath, ['-e', 'require("./promo-banner")'], { cwd: __dirname, env: { PATH: process.env.PATH }, encoding: 'utf8' });
  check('the module loads with no environment and prints nothing', out.status === 0 && !out.stdout && !out.stderr, out.stderr);
}

main().then(function () {
  console.log('promo-banner: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (err) {
  realError('promo-banner test crashed: ' + (err && err.stack || err));
  process.exit(1);
});
