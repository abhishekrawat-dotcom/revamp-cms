// node functions/lib/promo-mailer.test.js — Promotions → Mailers (lib/promo-mailer.js): a Oneworld event as the
// promotional platform's engine reads it, the engine's own output on it, and the small helpers around it; then
// what an export hands out (deliverables, pickDownload) and the download / render / catalog routes, with tracking
// on, off, failing and missing. No network: lib/promo-track.js and lib/promo.js are in-memory stand-ins.
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

/* a throwaway key, made here: the engine signs click links with it (never a real key, never a file) */
process.env.TRACK_SECRET = crypto.randomBytes(32).toString('hex');
delete process.env.TRACK_SECRET_PREVIOUS;
delete process.env.K_SERVICE;

/* lib/promo-track.js stands in as a recorder. It is resolved here before the file system is asked, so this works
   whether or not that file exists yet; FAIL_LOAD makes loading it throw, as a broken deployment would. */
var TRACK = { available: true, base: 'https://track.example', record: 'ok', baseThrows: false, calls: [], asked: [] };
var trackStub = {
  wire: function () {},
  availableFor: function (id) { TRACK.asked.push(id); if (TRACK.available === 'throw') throw new Error('stub: availableFor failed'); return TRACK.available; },
  base: function () { if (TRACK.baseThrows) throw new Error('stub: base failed'); return TRACK.base; },
  recordSends: function (fb, metas) {
    TRACK.calls.push({ fb: fb, metas: metas });
    if (TRACK.record === 'reject') return Promise.reject(new Error('stub: the batch could not be committed'));
    if (TRACK.record === 'throw') throw new Error('stub: recordSends threw');
    return Promise.resolve();
  }
};
var FAIL_LOAD = false, STUB = path.join(__dirname, '__stub-promo-track.js'), realResolve = Module._resolveFilename;

/* lib/promo-banner.js (the composed top banner) stands in as a state each check sets: { needed, fresh, url } as
   its stateFor() answers, or a read that fails, or a module that cannot load. Always a stand-in, so these checks
   never depend on its fingerprint or on Storage. */
var BANNER = { state: null, fail: false, calls: [], wired: 0 };
function bannerReset(o) {
  BANNER.state = { needed: false, fresh: false, fingerprint: '', url: null }; BANNER.fail = false; BANNER.calls = [];
  Object.assign(BANNER, o || {});
}
bannerReset();
var bannerStub = {
  wire: function () { BANNER.wired++; },
  /* the rule the plan gives it (§5i): this bucket's events/<id>/promo-banner/<name>.jpg */
  isBannerUrl: function (url, bucket, eventId) {
    BANNER.asked = (BANNER.asked || 0) + 1;
    var prefix = 'https://storage.googleapis.com/' + bucket + '/events/' + eventId + '/promo-banner/';
    return !!bucket && String(url).indexOf(prefix) === 0 && /^[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$/.test(String(url).slice(prefix.length));
  },
  stateFor: function (fb, eventId, kitIn) {
    BANNER.calls.push({ fb: fb, eventId: eventId, kit: kitIn });
    if (BANNER.fail === 'throw') throw new Error('stub: stateFor threw');
    if (BANNER.fail) return Promise.reject(new Error('stub: the banner record could not be read'));
    return Promise.resolve(JSON.parse(JSON.stringify(BANNER.state)));
  }
};
var BANNER_FAIL_LOAD = false, BANNER_STUB = path.join(__dirname, '__stub-promo-banner.js');
/* lib/promo-examples.js stands in with the markers the plan names (§5h): the example library's picture folder in
   any address, the "ex-p…" / "ex-l…" / "ex-s…" ids, and the preview's meta tag */
var exampleStub = {
  EXAMPLE_PATH: '/assets/promo-examples/',
  isExample: function (x) {
    var s = typeof x === 'string' ? x : JSON.stringify(x);
    return typeof s === 'string' && (s.indexOf('/assets/promo-examples/') !== -1 || /"ex-[pls]\d/.test(s) || s.indexOf('<meta name="oneworld-example"') !== -1);
  }
};
var EX_STUB = path.join(__dirname, '__stub-promo-examples.js');

Module._resolveFilename = function (request) {
  if (request === './promo-track') { if (FAIL_LOAD) throw new Error('stub: cannot load lib/promo-track.js'); return STUB; }
  if (request === './promo-banner') { if (BANNER_FAIL_LOAD) throw new Error('stub: cannot load lib/promo-banner.js'); return BANNER_STUB; }
  if (request === './promo-examples') return EX_STUB;
  return realResolve.apply(this, arguments);
};
function trackIn() { require.cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: trackStub, children: [], paths: [] }; }
/* Node remembers which file './promo-track' resolved to, and asks again only once that file is out of its cache */
function trackBroken() { FAIL_LOAD = true; delete require.cache[STUB]; }
function trackFixed() { FAIL_LOAD = false; trackIn(); }
trackIn();
function bannerIn() { require.cache[BANNER_STUB] = { id: BANNER_STUB, filename: BANNER_STUB, loaded: true, exports: bannerStub, children: [], paths: [] }; }
function bannerBroken() { BANNER_FAIL_LOAD = true; delete require.cache[BANNER_STUB]; }
function bannerFixed() { BANNER_FAIL_LOAD = false; bannerIn(); }
bannerIn();
require.cache[EX_STUB] = { id: EX_STUB, filename: EX_STUB, loaded: true, exports: exampleStub, children: [], paths: [] };

/* lib/llm.js: no model is ever asked here — every AI request in these checks must be refused before it */
var LLM_CALLS = 0, LLM_PATH = require.resolve('./llm');
require.cache[LLM_PATH] = { id: LLM_PATH, filename: LLM_PATH, loaded: true, children: [], paths: [], exports: {
  callJson: function () { LLM_CALLS++; return Promise.resolve({ error: 'stub: no model here', code: 'ai-config' }); }
} };

/* lib/promo.js builds the event's kit from its site, its page and the web (fonts, the logo): here it hands back the
   sample kit below, so the routes run with no Firebase and no network */
var PROMO = require.resolve('./promo');
require.cache[PROMO] = { id: PROMO, filename: PROMO, loaded: true, children: [], paths: [], exports: {
  wire: function () {},
  buildKit: function () { return Promise.resolve(JSON.parse(JSON.stringify(kit))); }
} };

const mod = require('./promo-mailer');
const pm = mod._test;
const engine = require('./vendor/promo-engine');
const JSZip = require('jszip');
const { sendJson } = require('./http');
var passed = 0, failed = 0;
var realError = console.error.bind(console);
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; realError('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var BASE = 'https://revamp.example';
var kit = {
  event: { id: 'demo', name: 'Healthcare Leaders Summit 2027', start: '2027-09-10T09:00', end: '2027-09-11T18:00', venue: 'Shangri-La Eros', city: 'New Delhi',
    description: 'Hospital chiefs and clinicians meet on access and quality. 7th edition.', siteUrl: BASE + '/e/demo', registerUrl: BASE + '/e/demo#register',
    hashtag: '#HealthcareLeadersSummit27', edition: '7th Edition', tagline: 'Where hospital leaders shape care' },
  brand: { mode: 'dark', colours: { theme: '#8f6118' }, heroImageUrl: '/templates/x/hero.jpg', eventLogoUrl: 'https://img.etb2bimg.com/files/logo.png', portal: { slug: 'health' } },
  content: {
    speakers: [{ id: 's1', name: 'Asha Rao', designation: 'CEO', company: 'City Hospital', photoUrl: 'https://img.etb2bimg.com/files/a.jpg', group: 'Keynote' },
      { id: 's2', name: 'Vikram Shah', designation: 'CMO', company: 'MedCo', photoUrl: '', group: '' }],
    partners: [{ id: 'p1', name: 'Medtronic', logoUrl: 'https://img.etb2bimg.com/files/m.png', tier: 'Gold Partner', url: 'https://medtronic.com' },
      { id: 'p2', name: 'Equirus', logoUrl: '', tier: 'Supporting Partner', url: 'javascript:alert(1)' }],
    sessions: [{ id: 'x1', title: 'Keynote: universal coverage', start: '10:00', end: '10:45', speakers: ['Asha Rao', 'Nobody Known'] }],
    audience: ['Hospital CEOs', 'CMOs'], topics: ['Access', 'Quality'], stats: [{ value: '2', label: 'Days' }]
  }
};

/* ---- the event, as the engine reads it ---- */
var ev = pm.entityOf('demo', kit, { category: 'ip' }, BASE, null);
check('name, portal, hashtag, tagline carried', ev.name === 'Healthcare Leaders Summit 2027' && ev.portal === 'health' && ev.hashtag === '#HealthcareLeadersSummit27' && ev.tagline === 'Where hospital leaders shape care');
check('dates labelled the platform\'s way, days counted', ev.dateLabel === '10–11 September, 2027' && ev.totalDays === 2, [ev.dateLabel, ev.totalDays]);
check('edition read from the text', ev.edition === 7, ev.edition);
check('the site\'s colour and mode drive "Match the event website"', ev.siteAccent === '#8f6118' && ev.siteTheme === 'dark');
check('a relative picture is made absolute (a mail is read outside the app)', ev.keyVisualUrl === BASE + '/templates/x/hero.jpg');
check('speakers in the site\'s order, ids kept as text', ev.speakers.length === 2 && ev.speakers[0].id === 's1' && ev.speakers[0].weightage === 1 && ev.speakers[1].weightage === 2);
check('a speaker with no photo has none (never an empty address)', ev.speakers[1].photoUrl === undefined);
check('partners grouped by tier', ev.sponsorTiers.length === 2 && ev.sponsorTiers.every(function (t) { return t.sponsors.length === 1; }));
check('a partner link that is not http(s) is dropped', ev.sponsorTiers.filter(function (t) { return t.tier === 'Supporting Partner'; })[0].sponsors[0].url === undefined);
check('session speakers by name; an unknown name is left out', ev.sessions[0].speakers.length === 1 && ev.sessions[0].speakers[0].name === 'Asha Rao');
check('audience and topics carried; why-join empty (nothing invented)', ev.whoShouldAttend.length === 2 && ev.keyPoints.length === 2 && ev.whyJoin.length === 0);
check('an event that is not an award has no award facts', ev.award === undefined && ev.ctaLabel === 'Register Now');

/* ---- an award ---- */
var future = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 16), past = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 16);
var ceremony = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 16);
var rec = { jury: [{ group: 'Grand Jury', people: [{ name: 'J One', title: 'Chair', company: 'A', photo: '/j1.jpg' }, { name: 'J Two', title: '', company: 'B' }] }], categories: [{}, {}, {}] };
var aw = pm.entityOf('demo', Object.assign({}, kit, { content: Object.assign({}, kit.content, { speakers: [] }) }),
  { category: 'awards', start: ceremony, nomination: { open: past, close: future } }, BASE, rec);
check('an award: nominations open now, its deadline labelled, its ceremony dated', aw.award && aw.award.nominationsOpen === true && /\d{4}$/.test(aw.award.nominationsCloseLabel) && aw.award.phase === 'live' && !!aw.award.ceremonyDateLabel, aw.award);
check('an award\'s button is Nominate Now, to the site', aw.ctaLabel === 'Nominate Now' && aw.award.nominateUrl === BASE + '/e/demo');
check('an award with no speakers of its own lists last edition\'s jury', aw.speakers.length === 2 && aw.speakers[0].group === 'Grand Jury' && aw.speakers[0].photoUrl === BASE + '/j1.jpg');
check('categories counted', aw.award.categories === 3);
var closed = pm.awardOf({ category: 'awards', start: ceremony, nomination: { open: past, close: past } }, BASE, null);
check('nominations that closed are not open', closed.nominationsOpen === false && closed.phase === 'upcoming');
var tbd = pm.awardOf({ category: 'awards', start: '', nomination: { open: past, close: future, closeTbd: true } }, BASE, null);
check('a deadline still to be decided is no deadline', tbd.nominationsOpen === false && tbd.nominationsCloseDate === undefined);

/* ---- the engine on it ---- */
var avail = engine.ALL_MAILERS.filter(function (m) { return m.requires(aw).ok; }).map(function (m) { return m.id; });
check('the award\'s own mailers are offered', ['mailer.award-nominations', 'mailer.award-deadline', 'mailer.award-ceremony'].every(function (id) { return avail.indexOf(id) !== -1; }), avail);
check('winners are not offered before there are any', avail.indexOf('mailer.award-winners') === -1);
var doc = engine.buildDoc(engine.getMailer('mailer.announcement'), ev, {});
var html = engine.renderDoc(doc, ev);
check('a mail renders, with no editor hooks and no script', /<\/html>/i.test(html) && !/data-block-id/.test(html) && !/<script/i.test(html));
check('the portal masthead is Oneworld\'s (the red ET square kept)', /\/templates\/_shared\/img\/portals\/health(-light)?\.png/.test(html));
check('no "0+ speakers" for an event with none', !/0\+ speakers/.test(engine.buildDoc(engine.getMailer('mailer.announcement'), Object.assign({}, ev, { speakers: [], tagline: '' }), {}).preheader));
check('on a phone a long word may break (the hashtag)', /max-width:700px\)\{[\s\S]*overflow-wrap:anywhere/.test(html));

/* ---- helpers ---- */
var sch = pm.toLlmSchema({ type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'array', items: { type: 'string', enum: ['x'] } } } });
check('a JSON Schema becomes the AI layer\'s form', sch.type === 'OBJECT' && sch.additionalProperties === undefined && sch.properties.a.type === 'ARRAY' && sch.properties.a.items.type === 'STRING' && sch.properties.a.items.enum[0] === 'x' && sch.required[0] === 'a');
check('a version name no other version has', pm.uniqueName('Launch', ['Launch', 'launch (2)']) === 'Launch (3)' && pm.uniqueName('  ', []) === 'Untitled');
check('absolute(): https kept, a path made absolute, anything else dropped', pm.absolute('https://a/b', BASE) === 'https://a/b' && pm.absolute('/x.png', BASE) === BASE + '/x.png' && pm.absolute('http://a/b', BASE) === '' && pm.absolute('//evil/x', BASE) === '');

/* ---- the studio page can load its own files (the server sends only an allow-list) ---- */
var fs = require('fs'), access = require('./access');
var page = fs.readFileSync(path.join(__dirname, '..', '..', 'promo-mailer-studio.html'), 'utf8');
var local = (page.match(/(?:src|href)="[^"]+"/g) || []).map(function (a) { return a.replace(/^(?:src|href)="|"$/g, ''); })
  .filter(function (u) { return !/^(https?:)?\/\/|^#|^data:/.test(u); });
var unserved = local.filter(function (u) { return !access.isServableFile(u.split('?')[0]); });
check('every file the studio page loads is one the server sends', local.length > 5 && !unserved.length, unserved);

/* ======== tracking: what an export hands out ======== */

var STORED = { createdAt: '2026-10-01T00:00:00.000Z' };
var GOT = { ev: ev, stored: STORED };
var DECODED = { email: 'maker@timesinternet.in' };
var FBX = { tag: 'the request\'s Firebase' };
var ANN = engine.getMailer('mailer.announcement');
var LOGS = [];
console.error = function () { LOGS.push([].slice.call(arguments).join(' ')); };
function logged(re) { return LOGS.some(function (l) { return re.test(l); }); }
function reset(o) {
  TRACK.available = true; TRACK.base = 'https://track.example'; TRACK.record = 'ok'; TRACK.baseThrows = false; TRACK.calls = []; TRACK.asked = [];
  Object.assign(TRACK, o || {});
  LOGS.length = 0;
}
function docOf(id, extra) { return Object.assign(engine.buildDoc(engine.getMailer(id), ev, {}), extra || {}); }
/* the send ids of the open pixels in a mail */
function pixels(h) {
  var re = /<img src="https:\/\/track\.example\/t\/o\/([A-Za-z0-9_-]{12})\.gif"[^>]*>/g, out = [], m;
  while ((m = re.exec(String(h)))) out.push(m[1]);
  return out;
}
function hrefs(h) { return String(h).match(/href="[^"]*"/g) || []; }
/* the signed click links in a mail, read back the way the click route reads them */
function clickLinks(h) {
  return (String(h).match(/href="https:\/\/track\.example\/t\/c\/[^"]*"/g) || []).map(function (a) {
    var u = new URL(a.slice(6, -1).replace(/&amp;/g, '&'));
    return { id: u.pathname.split('/').pop(), target: u.searchParams.get('u'), sig: u.searchParams.get('s') };
  });
}
function unescapeHref(a) { return a.slice(6, -1).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }

/* ---- the routes, on a stand-in Firebase: one event, one saved version of the announcement ---- */
var ROUTE_STORED = { createdAt: '2026-10-01T00:00:00.000Z', category: 'ip' };
var SAVED_DOC = Object.assign(docOf('mailer.announcement'), { subject: 'Saved subject' });
var SAVES = { s1save: { mailerId: 'mailer.announcement', name: 'Launch v2', subject: 'Saved subject', doc: JSON.stringify(SAVED_DOC), savedAt: 1000 } };
function snapOf(rows) { return { size: rows.length, empty: !rows.length, docs: rows.map(function (x) { return { id: x.id, data: function () { return x.row; } }; }) }; }
var FBR = { db: { collection: function () {
  return { doc: function () {
    return {
      get: function () { return Promise.resolve({ exists: true, data: function () { return ROUTE_STORED; } }); },
      collection: function (sub) {
        var rows = sub === 'mailerSaves' ? Object.keys(SAVES).map(function (id) { return { id: id, row: SAVES[id] }; }) : [];
        return {
          get: function () { return Promise.resolve(snapOf(rows)); },
          where: function (f, op, v) { return { get: function () { return Promise.resolve(snapOf(rows.filter(function (x) { return x.row[f] === v; }))); } }; },
          doc: function (id) { return { get: function () { var r = SAVES[id]; return Promise.resolve({ id: id, exists: !!r, data: function () { return r; } }); } }; }
        };
      }
    };
  } };
} }, bucket: { name: 'test-bucket' } };
var FAILS = [];
mod.wire({
  BODY_LIMITS: { ai: 1 << 20, small: 1 << 14 },
  withAdmin: function (req, res, cb) { cb(FBR, DECODED); },
  withAdminBody: function (req, res, limit, cb) { cb(FBR, DECODED, req.body); },
  eventIdOr400: function (res, v) { var s = String(v || ''); if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(s)) { sendJson(res, 400, { error: 'eventId required' }); return null; } return s; },
  publicBaseFor: function () { return BASE; },
  /* as lib/api.js's: an error with a status and a body goes out as written; anything else is a fault */
  sendFailure: function (res, what, err, msg) {
    if (err && err.status && err.body) return sendJson(res, err.status, err.body);
    FAILS.push(what + ': ' + (err && err.stack || err)); sendJson(res, 500, { error: msg });
  },
  aiUsageRecorder: function () { return function () {}; }
});
/* one request through a route: { status, headers, body (Buffer | string), json } */
function call(handler, url, body) {
  return new Promise(function (resolve) {
    var res = { status: 0, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k] = v; },
      writeHead: function (s, h) { res.status = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      end: function (b) {
        var json = null;
        if (typeof b === 'string') { try { json = JSON.parse(b); } catch (e) { /* not JSON */ } }
        resolve({ status: res.status, headers: res.headers, body: b, json: json });
      } };
    handler({ method: body ? 'POST' : 'GET', url: url, headers: {}, body: body }, res);
  });
}
function textOf(r) { return Buffer.isBuffer(r.body) ? r.body.toString('utf8') : String(r.body == null ? '' : r.body); }
/* every mailer's requires() answers only for the ids kept, for as long as fn's promise runs */
function onlyAvailable(keep, fn) {
  var saved = engine.ALL_MAILERS.map(function (m) { return m.requires; });
  engine.ALL_MAILERS.forEach(function (m) { m.requires = function () { return keep.indexOf(m.id) !== -1 ? { ok: true, missing: [] } : { ok: false, missing: ['speakers'] }; }; });
  function restore() { engine.ALL_MAILERS.forEach(function (m, i) { m.requires = saved[i]; }); }
  return Promise.resolve().then(fn).then(function (v) { restore(); return v; }, function (err) { restore(); throw err; });
}
/* one raw upload through a route (the import): the bytes arrive as the request's data events */
var EventEmitter = require('events');
function callRaw(handler, url, bytes) {
  return new Promise(function (resolve) {
    var req = new EventEmitter();
    req.method = 'POST'; req.url = url; req.headers = {}; req.resume = function () {}; req.destroy = function () {};
    var res = { status: 0, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k] = v; },
      writeHead: function (s, h) { res.status = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      end: function (b) {
        var json = null;
        if (typeof b === 'string') { try { json = JSON.parse(b); } catch (e) { /* not JSON */ } }
        resolve({ status: res.status, headers: res.headers, body: b, json: json });
      } };
    handler(req, res);
    setImmediate(function () { req.emit('data', bytes); req.emit('end'); });
  });
}
/* one request after another: each case is [label, handler, url, body] */
function inTurn(cases, each) {
  return cases.reduce(function (p, c) { return p.then(function () { return call(c[1], c[2], c[3]).then(function (r) { each(c, r); }); }); }, Promise.resolve());
}

/* ---- the top banner: the pictures a mail's banner block can hold ---- */
var HERO = BASE + '/templates/x/hero.jpg';                       // the site's bare hero picture (ev.keyVisualUrl)
var HERO_KIT = kit.brand.heroImageUrl;                             // the Kit's own (relative) address of it, put back after a check takes it away
var OWN_BANNERS = 'https://storage.googleapis.com/test-bucket/events/demo/promo-banner/';
var OLD_BANNER = OWN_BANNERS + '0123456789abcdef-lq3x9k-a1b2c3d4e5f60718.jpg';
var NEW_BANNER = OWN_BANNERS + 'fedcba9876543210-lq4a0b-0f1e2d3c4b5a6978.jpg';
var CUSTOM = 'https://img.etb2bimg.com/files/custom-banner.jpg';
var OTHER_EVENT_BANNER = 'https://storage.googleapis.com/test-bucket/events/other/promo-banner/0123-x.jpg';
var OTHER_BUCKET_BANNER = 'https://storage.googleapis.com/other-bucket/events/demo/promo-banner/0123-x.jpg';
var STALE_TEXT = 'The mail\'s top banner is out of date and is being drawn again. Try again in a moment.';
function bannerFresh() { bannerReset({ state: { needed: true, fresh: true, fingerprint: 'f'.repeat(32), url: NEW_BANNER } }); }
function bannerStale() { bannerReset({ state: { needed: true, fresh: false, fingerprint: 'e'.repeat(32), url: OLD_BANNER } }); }
function bannersOf(d) { return ((d && d.blocks) || []).filter(function (b) { return b.type === 'banner'; }).map(function (b) { return b.props.url; }); }
function allAre(list, url) { return list.length > 0 && list.every(function (u) { return u === url; }); }
function withBannerUrl(d, url) { var c = JSON.parse(JSON.stringify(d)); c.blocks.forEach(function (b) { if (b.type === 'banner') b.props.url = url; }); return c; }
/* every banner block showing url, marked as the server's own choice of autoUrl (undefined: no mark, a save from
   before the mark existed) */
function withMark(d, url, autoUrl) {
  var c = withBannerUrl(d, url);
  c.blocks.forEach(function (b) { if (b.type === 'banner') { if (autoUrl === undefined) delete b.props.autoUrl; else b.props.autoUrl = autoUrl; } });
  return c;
}
/* eventFor's answer while the banner is current, as the routes see it */
function GOT_FRESH() { return { ev: Object.assign({}, ev, { oneworldId: 'demo', bannerUrl: NEW_BANNER }), bucket: 'test-bucket' }; }
function marksOf(d) { return ((d && d.blocks) || []).filter(function (b) { return b.type === 'banner'; }).map(function (b) { return b.props.autoUrl; }); }
var SAVED_JSON = SAVES.s1save.doc;
function saveAs(d) { SAVES.s1save.doc = JSON.stringify(d); }
function savedBack() { SAVES.s1save.doc = SAVED_JSON; }
function zipFile(r, name) { return JSZip.loadAsync(r.body).then(function (z) { return z.file(name) ? z.file(name).async('string') : ''; }); }

/* ---- example content: a mail holding one of the example library's people or logos ---- */
var EX_PERSON = BASE + '/assets/promo-examples/people/p01.jpg', EX_LOGO = BASE + '/assets/promo-examples/logos/l01.png';
function exampleDoc(url) { var d = docOf('mailer.announcement'); d.blocks = d.blocks.concat([{ id: 'exb', type: 'banner', props: { url: url, alt: 'x' } }]); return d; }

var steps = [

  /* 1. tracking off here: the plain mail, untouched, and nothing recorded */
  function () {
    reset({ available: false });
    var d = docOf('mailer.announcement', { trackLinks: 'yes' });
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: d, mailerId: 'mailer.announcement', save: null }]).then(function (r) {
      check('tracking off: the file is exactly the plain render', r.html.length === 1 && r.html[0] === engine.renderDoc(d, ev));
      check('tracking off: tracked is false, no send recorded', r.tracked === false && TRACK.calls.length === 0, TRACK.calls.length);
      check('tracking off: availableFor was asked about this event', TRACK.asked.indexOf('demo') !== -1, TRACK.asked);
    });
  },

  /* 2. on: one pixel, one send, its record filled from the event and the version */
  function () {
    reset();
    var d = docOf('mailer.announcement'), plain = engine.renderDoc(d, ev), t0 = Date.now();
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: d, mailerId: 'mailer.announcement', save: { saveId: 's1save', name: 'Launch v2' } }]).then(function (r) {
      var h = r.html[0], ids = pixels(h);
      check('on: tracked', r.tracked === true);
      check('on: exactly one open pixel, on the tracking address', ids.length === 1 && (h.match(/\/t\/o\//g) || []).length === 1, ids);
      check('on: the pixel sits before </body>', h.indexOf('/t/o/' + ids[0]) < h.lastIndexOf('</body>') && h.lastIndexOf('</body>') !== -1);
      check('on: one recordSends call, with one send, given the request\'s Firebase', TRACK.calls.length === 1 && TRACK.calls[0].metas.length === 1 && TRACK.calls[0].fb === FBX);
      var m = (TRACK.calls[0] || { metas: [{}] }).metas[0];
      check('on: the send id is the pixel\'s', m.id === ids[0], [m.id, ids[0]]);
      check('on: the send is the Oneworld event (its address, not the engine\'s entityId)', m.eventId === 'demo' && m.eventCreatedAt === STORED.createdAt, m);
      check('on: portal and event name carried', m.portal === 'health' && m.eventName === 'Healthcare Leaders Summit 2027', m);
      check('on: mailer, its label and the subject', m.mailerId === 'mailer.announcement' && m.mailerLabel === ANN.label && m.subject === d.subject && !!m.subject, m);
      check('on: the version that went out', m.saveId === 's1save' && m.saveName === 'Launch v2', m);
      check('on: who exported it, and when', m.by === DECODED.email && typeof m.createdAt === 'number' && m.createdAt >= t0 && m.createdAt <= Date.now(), m);
      check('on: "Link tracking" off by default: every link is left as it was', JSON.stringify(hrefs(h)) === JSON.stringify(hrefs(plain)) && hrefs(plain).some(function (a) { return /^href="https:/.test(a); }));
    });
  },

  /* 3. "Link tracking" on: each web link goes through the signed click redirect */
  function () {
    reset();
    var d = docOf('mailer.announcement', { trackLinks: 'yes' }), plain = engine.renderDoc(d, ev);
    var webLinks = hrefs(plain).filter(function (a) { return /^href="https?:\/\//.test(a); }).map(unescapeHref);
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: d, mailerId: 'mailer.announcement', save: null }]).then(function (r) {
      var h = r.html[0], links = clickLinks(h), id = pixels(h)[0];
      check('links on: every web link is rewritten', webLinks.length >= 3 && links.length === webLinks.length && !/href="https:\/\/(revamp\.example|medtronic\.com)/.test(h), [webLinks.length, links.length]);
      check('links on: each carries this send\'s id and its own target, in order', links.every(function (l, i) { return l.id === id && l.target === webLinks[i]; }), links);
      check('links on: each signature is one the click route accepts', links.length > 0 && links.every(function (l) { return engine.verifyClick(l.id, l.target, l.sig); }));
      check('links on: "#" and the unsubscribe token are left alone', /href="#"/.test(h) && h.indexOf('href="{$$!!unsubscribelink!!$$}"') !== -1);
      check('links on: still one pixel', pixels(h).length === 1);
    });
  },

  /* 4. three files: three sends, one write */
  function () {
    reset();
    var items = ['mailer.announcement', 'mailer.speakers', 'mailer.agenda'].map(function (id) { return { doc: docOf(id), mailerId: id, save: null }; });
    return pm.deliverables(FBX, DECODED, GOT, 'demo', items).then(function (r) {
      var ids = r.html.map(function (h) { return pixels(h); });
      var metas = TRACK.calls.length === 1 ? TRACK.calls[0].metas : [];
      check('three files: one recordSends call with three sends', TRACK.calls.length === 1 && metas.length === 3, TRACK.calls.length);
      check('three files: each has one pixel, with its own id', ids.every(function (x) { return x.length === 1; }) && ids[0][0] !== ids[1][0] && ids[1][0] !== ids[2][0] && ids[0][0] !== ids[2][0], ids);
      check('three files: each send is its file\'s', metas.length === 3 && metas.every(function (m, i) { return m.id === ids[i][0] && m.mailerId === items[i].mailerId; }));
      check('three files: one export time for all', metas.length === 3 && metas[0].createdAt === metas[1].createdAt && metas[1].createdAt === metas[2].createdAt);
      check('three files: no version gives empty version fields', metas.every(function (m) { return m.saveId === '' && m.saveName === ''; }));
    });
  },

  /* 5. recording fails: the plain file goes out, flagged, and nothing throws */
  function () {
    reset({ record: 'reject' });
    var d = docOf('mailer.announcement', { trackLinks: 'yes' });
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: d, mailerId: 'mailer.announcement', save: null }]).then(function (r) {
      check('recording rejected: the plain render, untracked', r.html[0] === engine.renderDoc(d, ev) && r.tracked === false && TRACK.calls.length === 1);
      check('recording rejected: logged', logged(/promo-mailer: a send could not be recorded — the file went out untracked/), LOGS);
    });
  },
  function () {
    reset({ record: 'throw' });
    var d = docOf('mailer.announcement');
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: d, mailerId: 'mailer.announcement', save: null }]).then(function (r) {
      check('recording threw: the plain render, untracked', r.html[0] === engine.renderDoc(d, ev) && r.tracked === false);
    }, function (err) { check('recording threw: deliverables does not reject', false, String(err)); });
  },
  function () {
    reset({ baseThrows: true });
    var d = docOf('mailer.announcement');
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: d, mailerId: 'mailer.announcement', save: null }]).then(function (r) {
      check('adding tracking failed: the plain render, untracked, nothing recorded', r.html[0] === engine.renderDoc(d, ev) && r.tracked === false && TRACK.calls.length === 0);
      check('adding tracking failed: logged', logged(/promo-mailer: tracking could not be added/), LOGS);
    });
  },
  function () {
    reset({ base: '' });
    var d = docOf('mailer.announcement');
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: d, mailerId: 'mailer.announcement', save: null }]).then(function (r) {
      check('no tracking address: plain, and no send recorded that nothing could count into', r.html[0] === engine.renderDoc(d, ev) && r.tracked === false && TRACK.calls.length === 0);
    });
  },
  function () {
    reset({ available: 'throw' });
    check('availableFor throwing: tracking is off, nothing thrown', pm.trackingOn(trackStub, 'demo', STORED) === false);
  },

  /* 6. the event is not live: plain */
  function () {
    var d = docOf('mailer.announcement');
    var cases = [{ stored: {} }, { stored: { createdAt: STORED.createdAt, deletedAt: '2026-10-20T00:00:00.000Z' } }, { stored: null }];
    return cases.reduce(function (p, c) {
      return p.then(function () {
        reset();
        return pm.deliverables(FBX, DECODED, { ev: ev, stored: c.stored }, 'demo', [{ doc: d, mailerId: 'mailer.announcement', save: null }]).then(function (r) {
          check('event not live (' + JSON.stringify(c.stored) + '): plain, nothing recorded', r.html[0] === engine.renderDoc(d, ev) && r.tracked === false && TRACK.calls.length === 0);
        });
      });
    }, Promise.resolve());
  },

  /* 7. a mailer the registry does not know (an imported mail) keeps its id, with no label */
  function () {
    reset();
    var d = docOf('mailer.announcement', { mailerId: 'mailer.imported' });
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: d, mailerId: 'mailer.imported', save: { saveId: 's2', name: 'Imported' } }]).then(function (r) {
      var m = TRACK.calls.length ? TRACK.calls[0].metas[0] : {};
      check('an imported mail: tracked, its id passed through, label empty', r.tracked === true && m.mailerId === 'mailer.imported' && m.mailerLabel === '', m);
    });
  },
  /* 7b. any other id the document carries is recorded as '' — "constructor" on the dashboards' versions lookup broke
     both of them, for good, and a mailer since removed from the registry has no versions to drill into either */
  function () {
    reset();
    var odd = ['constructor', '__proto__', 'mailer.gone', 'toString'];
    var items = odd.map(function (id) { return { doc: docOf('mailer.announcement', { mailerId: id }), mailerId: id, save: null }; });
    return pm.deliverables(FBX, DECODED, GOT, 'demo', items).then(function (r) {
      var metas = TRACK.calls.length ? TRACK.calls[0].metas : [];
      check('a mailer id the engine does not know is recorded as \'\', with no label, and the files still go out tracked',
        r.tracked === true && metas.length === odd.length && metas.every(function (m) { return m.mailerId === '' && m.mailerLabel === ''; }), metas.map(function (m) { return m.mailerId; }));
    });
  },

  /* a render error still rejects, as before tracking */
  function () {
    reset();
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: null, mailerId: '', save: null }]).then(function () {
      check('a render error rejects', false);
    }, function () { check('a render error rejects (and nothing is recorded)', TRACK.calls.length === 0); });
  },

  /* 8. pickDownload: the platform's three shapes */
  function () {
    var p = pm.pickDownload({ doc: { blocks: [] }, mailerIds: ['mailer.announcement'] }, ev);
    check('pick: a document on screen is that document', p.kind === 'doc', p);
    p = pm.pickDownload({ mailerIds: ['mailer.announcement'] }, ev);
    check('pick: one named mailer is that mailer', p.kind === 'one' && p.mailer === ANN, p.kind);
    p = pm.pickDownload({ mailerIds: ['nope'] }, ev);
    check('pick: one unknown mailer is 404 "unknown or unavailable mailer"', p.kind === 'none' && p.status === 404 && p.error === 'unknown or unavailable mailer', p);
    p = pm.pickDownload({ mailerIds: ['mailer.award-winners'] }, ev);
    check('pick: one mailer this event cannot have is the same 404', p.kind === 'none' && p.status === 404 && p.error === 'unknown or unavailable mailer', p);
    var bulk = engine.ALL_MAILERS.filter(function (m) { return m.bulk !== false && m.requires(ev).ok; });
    p = pm.pickDownload({ mailerIds: [] }, ev);
    check('pick: none named is a ZIP of every mailer this event can have, but Blank', p.kind === 'zip' && p.mailers.length === bulk.length && bulk.length > 3 &&
      p.mailers.every(function (m, i) { return m === bulk[i] && m.id !== 'mailer.blank'; }), p.mailers && p.mailers.map(function (m) { return m.id; }));
    p = pm.pickDownload({}, ev);
    check('pick: no mailerIds at all is the same ZIP', p.kind === 'zip' && p.mailers.length === bulk.length);
    p = pm.pickDownload({ mailerIds: ['mailer.announcement', 'nope', 'mailer.agenda', 'mailer.announcement'] }, ev);
    check('pick: several named: the known, available ones, each once', p.kind === 'zip' && p.mailers.map(function (m) { return m.id; }).join() === 'mailer.announcement,mailer.agenda', p.mailers && p.mailers.map(function (m) { return m.id; }));
    p = pm.pickDownload({ mailerIds: ['nope', 'nada'] }, ev);
    check('pick: several named, none known: 404 "no mailers available for this event"', p.kind === 'none' && p.status === 404 && p.error === 'no mailers available for this event', p);
    return onlyAvailable(['mailer.agenda'], function () {
      var one = pm.pickDownload({ mailerIds: [] }, ev);
      check('pick: an event with only one mailer still gets a ZIP (the studio saves it as mailers.zip)', one.kind === 'zip' && one.mailers.length === 1 && one.mailers[0].id === 'mailer.agenda', one);
    }).then(function () {
      return onlyAvailable([], function () {
        var none = pm.pickDownload({ mailerIds: [] }, ev);
        check('pick: nothing available: 404 "no mailers available for this event"', none.kind === 'none' && none.status === 404 && none.error === 'no mailers available for this event', none);
      });
    });
  },

  /* 9. lib/promo-track.js cannot load: plain exports, nothing thrown, logged once */
  function () {
    reset();
    trackBroken();
    var t = null, threw = null;
    try { t = pm.tracker(); pm.tracker(); } catch (err) { threw = err; }
    check('module missing: tracker() is null and does not throw', t === null && threw === null, String(threw));
    check('module missing: logged once, not per call', LOGS.filter(function (l) { return /promo-mailer: lib\/promo-track\.js could not be loaded/.test(l); }).length === 1, LOGS);
    check('module missing: tracking is off', pm.trackingOn(t, 'demo', STORED) === false);
    var d = docOf('mailer.announcement');
    return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: d, mailerId: 'mailer.announcement', save: null }]).then(function (r) {
      check('module missing: the plain render, untracked', r.html[0] === engine.renderDoc(d, ev) && r.tracked === false && TRACK.calls.length === 0);
    }, function (err) { check('module missing: deliverables does not reject', false, String(err)); })
      .then(function () {
        return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: docOf('mailer.announcement') }).then(function (r) {
          check('module missing: a download still works, flagged untracked', r.status === 200 && r.headers['X-Mailer-Tracked'] === 'no' && pixels(textOf(r)).length === 0, [r.status, r.headers]);
        });
      })
      .then(function () {
        return call(mod.handleCatalog, '/api/promo/mailers?eventId=demo').then(function (r) {
          check('module missing: the catalog still loads, tracking false', r.status === 200 && r.json && r.json.tracking === false && Array.isArray(r.json.mailers), [r.status, r.json && r.json.tracking]);
        });
      })
      .then(trackFixed, function (err) { trackFixed(); throw err; });
  },
  function () {
    reset();
    check('module back: tracker() loads it again', pm.tracker() === trackStub && pm.trackingOn(trackStub, 'demo', STORED) === true);
  },

  /* ---- the routes ---- */

  /* the document on screen, tracked */
  function () {
    reset();
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: docOf('mailer.announcement'), saveId: 's1save', saveName: 'Launch v2' }).then(function (r) {
      var h = textOf(r), m = TRACK.calls.length ? TRACK.calls[0].metas[0] : {};
      check('download doc: 200 html, named for the mailer', r.status === 200 && /^text\/html/.test(r.headers['Content-Type']) && r.headers['Content-Disposition'] === 'attachment; filename="' + engine.mailerFileName(ANN, ev) + '"', r.headers);
      check('download doc: X-Mailer-Tracked yes, never cached', r.headers['X-Mailer-Tracked'] === 'yes' && r.headers['Cache-Control'] === 'no-store', r.headers);
      check('download doc: one pixel, one send', pixels(h).length === 1 && TRACK.calls.length === 1 && m.id === pixels(h)[0]);
      check('download doc: the send is this event\'s, this version\'s, by this admin, on the request\'s Firebase', m.eventId === 'demo' && m.eventCreatedAt === ROUTE_STORED.createdAt &&
        m.saveId === 's1save' && m.saveName === 'Launch v2' && m.by === DECODED.email && TRACK.calls[0].fb === FBR, m);
    });
  },
  /* the studio's document names the mailer, so a caller can send any text: { mailerId: 'constructor', blocks: [] }
     still downloads, but is recorded with no mailer id */
  function () {
    reset();
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: { mailerId: 'constructor', blocks: [] } }).then(function (r) {
      var m = TRACK.calls.length ? TRACK.calls[0].metas[0] : {};
      check('download doc "constructor": 200 tracked html, the send recorded with mailerId \'\'', r.status === 200 && r.headers['X-Mailer-Tracked'] === 'yes' &&
        TRACK.calls.length === 1 && m.mailerId === '' && m.mailerLabel === '', [r.status, m.mailerId]);
    });
  },
  /* test:true: as before tracking — plain, nothing recorded, no flag */
  function () {
    reset();
    var d = docOf('mailer.announcement', { trackLinks: 'yes' });
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: d, test: true }).then(function (r) {
      check('test download: 200, the plain mail, nothing recorded', r.status === 200 && textOf(r) === engine.renderDoc(d, ev) && TRACK.calls.length === 0);
      check('test download: no X-Mailer-Tracked, still never cached', !('X-Mailer-Tracked' in r.headers) && r.headers['Cache-Control'] === 'no-store', r.headers);
    });
  },
  /* one named mailer: its latest saved version, tracked */
  function () {
    reset();
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: ['mailer.announcement'] }).then(function (r) {
      var m = TRACK.calls.length ? TRACK.calls[0].metas[0] : {};
      check('download one: 200 html (not a zip), tracked, never cached', r.status === 200 && /^text\/html/.test(r.headers['Content-Type']) && r.headers['X-Mailer-Tracked'] === 'yes' && r.headers['Cache-Control'] === 'no-store', r.headers);
      check('download one: the latest saved version, attributed to it', m.saveId === 's1save' && m.saveName === 'Launch v2' && m.subject === 'Saved subject' && pixels(textOf(r))[0] === m.id, m);
    });
  },
  function () {
    reset();
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: ['mailer.announcement'], fresh: true }).then(function (r) {
      var m = TRACK.calls.length ? TRACK.calls[0].metas[0] : {};
      check('download one, fresh: a new document, no version', r.status === 200 && m.saveId === '' && m.subject !== 'Saved subject', m);
    });
  },
  function () {
    reset();
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: ['nope'] }).then(function (r) {
      check('download one unknown: 404 "unknown or unavailable mailer", nothing recorded', r.status === 404 && r.json && r.json.error === 'unknown or unavailable mailer' && TRACK.calls.length === 0, [r.status, r.json]);
    });
  },
  /* all: a ZIP, one send per file, one write */
  function () {
    reset();
    var bulk = engine.ALL_MAILERS.filter(function (m) { return m.bulk !== false && m.requires(ev).ok; });
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: [] }).then(function (r) {
      check('download all: 200 zip, tracked, never cached', r.status === 200 && r.headers['Content-Type'] === 'application/zip' && r.headers['X-Mailer-Tracked'] === 'yes' && r.headers['Cache-Control'] === 'no-store' &&
        /-mailers\.zip"$/.test(r.headers['Content-Disposition']), r.headers);
      var metas = TRACK.calls.length === 1 ? TRACK.calls[0].metas : [];
      check('download all: one recordSends call, one send per mailer', TRACK.calls.length === 1 && metas.length === bulk.length, [TRACK.calls.length, metas.length, bulk.length]);
      return JSZip.loadAsync(r.body).then(function (zip) {
        var names = Object.keys(zip.files).filter(function (n) { return /\.html$/.test(n); });
        return Promise.all(names.map(function (n) { return zip.file(n).async('string'); })).then(function (htmls) {
          var ids = htmls.map(function (h) { return pixels(h); });
          check('download all: one file per send, each with one pixel', names.length === metas.length && ids.every(function (x) { return x.length === 1; }), names.length);
          var sendIds = metas.map(function (m) { return m.id; }).sort().join(), fileIds = ids.map(function (x) { return x[0]; }).sort().join();
          check('download all: each file carries a different send, and every send has its file', sendIds === fileIds && new Set(fileIds.split(',')).size === names.length);
          return zip.file('subjects.json').async('string').then(function (s) {
            var meta = JSON.parse(s), ann = meta[engine.mailerFileName(ANN, ev)];
            check('download all: subjects.json lists every file, with its version', Object.keys(meta).length === names.length && ann && ann.subject === 'Saved subject' && ann.version === 'Launch v2', ann);
          });
        });
      });
    });
  },
  function () {
    reset();
    return onlyAvailable(['mailer.agenda'], function () {
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: [] }).then(function (r) {
        return JSZip.loadAsync(r.body).then(function (zip) {
          var names = Object.keys(zip.files);
          check('download all, one mailer available: still a zip (with subjects.json)', r.headers['Content-Type'] === 'application/zip' && names.length === 2 && names.indexOf('subjects.json') !== -1, names);
        });
      }, function (err) { check('download all, one mailer available: a zip', false, String(err)); });
    });
  },
  function () {
    reset({ available: false });
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: [] }).then(function (r) {
      check('download all, tracking off: a zip flagged untracked, nothing recorded', r.status === 200 && r.headers['Content-Type'] === 'application/zip' && r.headers['X-Mailer-Tracked'] === 'no' && TRACK.calls.length === 0, r.headers);
    });
  },
  /* tracking off, recording failing, the event deleted: the plain file, flagged */
  function () {
    reset({ available: false });
    var d = docOf('mailer.announcement');
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: d }).then(function (r) {
      check('download, tracking off: the plain mail, X-Mailer-Tracked no', r.status === 200 && textOf(r) === engine.renderDoc(d, ev) && r.headers['X-Mailer-Tracked'] === 'no' && r.headers['Cache-Control'] === 'no-store' && TRACK.calls.length === 0, r.headers);
    });
  },
  function () {
    reset({ record: 'reject' });
    var d = docOf('mailer.announcement');
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: d }).then(function (r) {
      check('download, recording failed: still 200, the plain mail, X-Mailer-Tracked no', r.status === 200 && textOf(r) === engine.renderDoc(d, ev) && r.headers['X-Mailer-Tracked'] === 'no' && !FAILS.length, [r.status, r.headers, FAILS]);
    });
  },
  function () {
    reset();
    ROUTE_STORED.deletedAt = '2026-10-20T00:00:00.000Z';
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: docOf('mailer.announcement') }).then(function (r) {
      delete ROUTE_STORED.deletedAt;
      check('download, event deleted: untracked, nothing recorded', r.status === 200 && r.headers['X-Mailer-Tracked'] === 'no' && TRACK.calls.length === 0, r.headers);
    });
  },
  function () {
    reset();
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: { subject: 'x' } }).then(function (r) {
      check('download, a document with no blocks: 400 doc required', r.status === 400 && r.json && r.json.error === 'doc required' && TRACK.calls.length === 0, [r.status, r.json]);
    });
  },
  /* render: Copy HTML is tracked; the preview and plain renders are as before */
  function () {
    reset();
    return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: docOf('mailer.announcement'), track: true, saveId: 's1save', saveName: 'Launch v2' }).then(function (r) {
      var j = r.json || {}, m = TRACK.calls.length ? TRACK.calls[0].metas[0] : {};
      check('copy html: tracked true, one pixel, its palette', r.status === 200 && j.tracked === true && pixels(j.html).length === 1 && j.palette && !!j.palette.accent, [r.status, j.tracked]);
      check('copy html: the send is this version\'s', TRACK.calls.length === 1 && m.id === pixels(j.html)[0] && m.saveId === 's1save' && m.mailerId === 'mailer.announcement', m);
    });
  },
  function () {
    reset({ available: false });
    var d = docOf('mailer.announcement');
    return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: d, track: true }).then(function (r) {
      var j = r.json || {};
      check('copy html, tracking off: tracked false, the plain mail', j.tracked === false && j.html === engine.renderDoc(d, ev) && TRACK.calls.length === 0, j.tracked);
    });
  },
  function () {
    reset();
    var d = docOf('mailer.announcement');
    return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: d, track: true, editor: true }).then(function (r) {
      var j = r.json || {};
      check('studio preview (editor, even with track): never tracked, no tracked key', !('tracked' in j) && j.html === engine.renderDoc(d, ev, { editor: true }) && TRACK.calls.length === 0);
    });
  },
  function () {
    reset();
    var d = docOf('mailer.announcement');
    return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: d }).then(function (r) {
      var j = r.json || {};
      check('plain render (PNG/PDF export): unchanged, no tracked key', !('tracked' in j) && j.html === engine.renderDoc(d, ev) && !!j.palette && TRACK.calls.length === 0);
    });
  },
  /* the catalog says whether this event's exports are tracked */
  function () {
    reset();
    return call(mod.handleCatalog, '/api/promo/mailers?eventId=demo').then(function (r) {
      check('catalog: tracking true when tracking runs and the event is live', r.status === 200 && r.json && r.json.tracking === true && Array.isArray(r.json.mailers) && !!r.json.saves, [r.status, r.json && r.json.tracking]);
      reset({ available: false });
      return call(mod.handleCatalog, '/api/promo/mailers?eventId=demo');
    }).then(function (r) {
      check('catalog: tracking false when it does not run here', r.status === 200 && r.json && r.json.tracking === false);
    });
  },

  /* ======== Phase 3: the event every Promotions route reads (eventFor), exported ======== */
  function () {
    reset(); bannerFresh();
    var REQ = { method: 'GET', url: '/x', headers: {} };
    return mod.eventFor(FBR, 'demo', REQ).then(function (got) {
      check('eventFor: exported; resolves { ev, stored, kit, banner }', typeof mod.eventFor === 'function' && got && got.ev && got.ev.name === kit.event.name &&
        got.stored && got.stored.category === 'ip' && got.kit && got.kit.event && got.kit.brand && got.banner && typeof got.banner.fresh === 'boolean', got && Object.keys(got));
      check('eventFor: a current banner is the engine\'s bannerUrl', got.ev.bannerUrl === NEW_BANNER && got.banner.needed === true && got.banner.fresh === true && got.banner.url === NEW_BANNER, got.banner);
      check('eventFor: the banner is judged once, on the request\'s Firebase, against the Kit buildKit made', BANNER.calls.length === 1 && BANNER.calls[0].fb === FBR &&
        BANNER.calls[0].eventId === 'demo' && BANNER.calls[0].kit === got.kit && got.kit.brand.heroImageUrl === kit.brand.heroImageUrl, BANNER.calls.length);
      check('eventFor: the Kit keeps the event\'s own line (tagline), as before', got.kit.event.tagline === '' && got.ev.tagline === undefined, got.kit.event.tagline);
      check('eventFor: the bucket comes along (a saved mail\'s older banners are known by it)', got.bucket === 'test-bucket', got.bucket);
      check('eventFor: the banner module is handed the request\'s helpers (a cold instance)', BANNER.wired > 0);
      bannerStale();
      return mod.eventFor(FBR, 'demo', REQ);
    }).then(function (got) {
      check('eventFor: a banner out of date is never the engine\'s', !('bannerUrl' in got.ev) && got.banner.needed === true && got.banner.fresh === false, got.banner);
      bannerReset({ state: { needed: true, fresh: true, fingerprint: 'x', url: 'http://storage.googleapis.com/test-bucket/events/demo/promo-banner/x.jpg' } });
      return mod.eventFor(FBR, 'demo', REQ);
    }).then(function (got) {
      check('eventFor: a "current" banner at an address that is not https is not current', !('bannerUrl' in got.ev) && got.banner.fresh === false && got.banner.url === null, got.banner);
      bannerReset({ state: { needed: false, fresh: true, fingerprint: 'x', url: NEW_BANNER } });
      return mod.eventFor(FBR, 'demo', REQ);
    }).then(function (got) {
      check('eventFor: no banner needed (no hero picture): none is used, even a stored one', !('bannerUrl' in got.ev) && got.banner.needed === false && got.banner.fresh === false, got.banner);
      LOGS.length = 0; bannerBroken();
      return mod.eventFor(FBR, 'demo', REQ);
    }).then(function (got) {
      bannerFixed();
      /* owner C: a banner that cannot be judged is never taken as current — the sends wait, they do not ship the hero */
      check('eventFor: lib/promo-banner.js cannot load: the event still comes, its banner needed and not current', got.ev.name === kit.event.name &&
        got.banner.needed === true && got.banner.fresh === false && got.banner.url === null && !('bannerUrl' in got.ev), got.banner);
      check('eventFor: that is logged, and says the sends are held', logged(/promo-mailer: lib\/promo-banner\.js could not be loaded — mails that need the banner are held/), LOGS);
      LOGS.length = 0; bannerReset({ fail: true });
      return mod.eventFor(FBR, 'demo', REQ);
    }).then(function (got) {
      check('eventFor: the banner\'s state cannot be read: the event still comes, its banner needed and not current', got.banner.needed === true && got.banner.fresh === false && !('bannerUrl' in got.ev), got.banner);
      check('eventFor: a failing banner is logged at most once in ten minutes, not per request', !logged(/promo-mailer: /), LOGS);
      bannerReset({ fail: 'throw' });
      return mod.eventFor(FBR, 'demo', REQ);
    }).then(function (got) {
      check('eventFor: stateFor throwing is caught the same way', got.banner.needed === true && got.banner.fresh === false && got.ev.name === kit.event.name, got.banner);
      /* a site with no hero picture has no banner to wait for, whether or not the module can tell (its own rule) */
      kit.brand.heroImageUrl = ''; bannerBroken();
      return mod.eventFor(FBR, 'demo', REQ);
    }).then(function (got) {
      bannerFixed();
      check('eventFor: the module cannot load and the site has no hero picture: no banner needed', got.banner.needed === false && got.banner.fresh === false && !('bannerUrl' in got.ev), got.banner);
      bannerReset({ fail: true });
      return mod.eventFor(FBR, 'demo', REQ);
    }).then(function (got) {
      check('eventFor: the record cannot be read and the site has no hero picture: no banner needed', got.banner.needed === false, got.banner);
      kit.brand.heroImageUrl = HERO_KIT; bannerReset();
    }, function (err) { kit.brand.heroImageUrl = HERO_KIT; bannerFixed(); bannerReset(); throw err; });
  },
  /* the banner module failing holds the sends, as a banner out of date does (owner C: a stale or missing banner never
     goes out, so a fault must not ship the bare hero in its place); the studio's live preview still opens; a site
     with no hero picture needs no banner, so its sends go on — and an old banner is still never let out */
  function () {
    reset(); bannerBroken();
    var d = withBannerUrl(docOf('mailer.announcement'), OLD_BANNER);
    function stale(what, r) {
      check('banner module failing: ' + what + ' is 409 banner-stale, never the bare hero in place of the banner', r.status === 409 && r.json && r.json.code === 'banner-stale' && r.json.error === STALE_TEXT, [r.status, r.json]);
    }
    return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: d }).then(function (r) {
      stale('a download (the module cannot load)', r);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: d, track: true });
    }).then(function (r) {
      stale('Copy HTML (the module cannot load)', r);
      return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement', fresh: true });
    }).then(function (r) {
      stale('opening a new mailer (the module cannot load)', r);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: d, editor: true });
    }).then(function (r) {
      var h = String((r.json || {}).html);
      check('banner module failing: the studio\'s live preview still opens, with the hero picture, never the old banner', r.status === 200 && h.indexOf(HERO) !== -1 && h.indexOf(OLD_BANNER) === -1, r.status);
      bannerFixed(); bannerReset({ fail: true });
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: d });
    }).then(function (r) {
      stale('a download (the banner record cannot be read)', r);
      bannerReset({ fail: 'throw' });
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: [] });
    }).then(function (r) {
      stale('download all (stateFor throws)', r);
      check('banner module failing: nothing went out, no send recorded', TRACK.calls.length === 0, TRACK.calls.length);
      kit.brand.heroImageUrl = ''; bannerReset(); bannerBroken();
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: d });
    }).then(function (r) {
      bannerFixed(); kit.brand.heroImageUrl = HERO_KIT;
      var h = textOf(r);
      check('banner module failing, site with no hero picture: no banner to wait for, the download goes out without the old banner', r.status === 200 && h.indexOf(OLD_BANNER) === -1 && /<\/html>/i.test(h), r.status);
    }, function (err) { bannerFixed(); bannerReset(); kit.brand.heroImageUrl = HERO_KIT; throw err; });
  },

  /* ======== Phase 3: a banner out of date never goes out ======== */
  function () {
    reset(); bannerStale();
    var d = docOf('mailer.announcement');
    return inTurn([
      ['open a new mailer (/doc fresh)', mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement', fresh: true }],
      ['open a saved version (/doc)', mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement' }],
      ['download one', mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: ['mailer.announcement'] }],
      ['download all (zip)', mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: [] }],
      ['download the doc on screen', mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: d }],
      ['a test download', mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: d, test: true }],
      ['Copy HTML (render track)', mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: d, track: true }],
      ['the PNG/PDF export (plain render)', mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: d }],
      /* a new layout is built afresh from the event: built now it would carry the spotlight's colour band as well as
         the banner block carried over — two headers, kept as a new draft */
      ['Change layout to a spotlight (/relayout)', mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: 'mailer.speaker-spotlight', doc: withBannerUrl(d, OLD_BANNER) }],
      ['Change layout to another mailer (/relayout)', mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: 'mailer.partner-spotlight', doc: d }]
    ], function (c, r) {
      check('banner out of date: ' + c[0] + ' is 409 banner-stale', r.status === 409 && r.json && r.json.code === 'banner-stale' && r.json.error === STALE_TEXT, [r.status, r.json]);
    }).then(function () {
      check('banner out of date: nothing went out, no send recorded', TRACK.calls.length === 0, TRACK.calls.length);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: withBannerUrl(d, OLD_BANNER), editor: true });
    }).then(function (r) {
      var j = r.json || {};
      check('banner out of date: the studio\'s live preview still renders', r.status === 200 && typeof j.html === 'string', r.status);
      check('banner out of date: the preview shows the site\'s hero picture meanwhile, never the old banner', String(j.html).indexOf(HERO) !== -1 && String(j.html).indexOf(OLD_BANNER) === -1);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: d, editor: true, track: true });
    }).then(function (r) {
      check('banner out of date: an editor render asking to be tracked is still the preview (200, untracked)', r.status === 200 && r.json && !('tracked' in r.json) && TRACK.calls.length === 0, r.status);
      return call(mod.handleBlock, '/api/promo/mailer/block', { eventId: 'demo', type: 'banner' });
    }).then(function (r) {
      /* a block added meanwhile starts on the hero picture, which the sends then point at the current banner */
      check('banner out of date: a Banner block added in the studio starts on the site\'s hero picture, never the old banner', r.status === 200 && r.json && r.json.block &&
        r.json.block.props.url === HERO, r.json && r.json.block);
      bannerReset();
    }, function (err) { bannerReset(); throw err; });
  },

  /* ======== Phase 3: a current banner, and saved mails that follow it ======== */
  function () {
    reset(); bannerFresh();
    var d = docOf('mailer.announcement');
    return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement', fresh: true }).then(function (r) {
      var j = r.json || {};
      check('banner current: a new mailer opens with the banner in its banner block', r.status === 200 && allAre(bannersOf(j.doc), NEW_BANNER) && j.html.indexOf(NEW_BANNER) !== -1, [r.status, bannersOf(j.doc)]);
      return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement' });
    }).then(function (r) {
      var j = r.json || {};
      check('banner current: a version saved with the bare hero (before the banner existed) opens with the banner', r.status === 200 && j.saved === true && allAre(bannersOf(j.doc), NEW_BANNER), bannersOf(j.doc));
      saveAs(withBannerUrl(SAVED_DOC, OLD_BANNER));
      return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement' });
    }).then(function (r) {
      check('banner current: a version saved with an older banner of this event opens with the current one', r.status === 200 && allAre(bannersOf(r.json.doc), NEW_BANNER), bannersOf(r.json && r.json.doc));
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: ['mailer.announcement'] });
    }).then(function (r) {
      var h = textOf(r);
      check('banner current: download one: the saved version goes out with the current banner, not the old', r.status === 200 && h.indexOf(NEW_BANNER) !== -1 && h.indexOf(OLD_BANNER) === -1 && pixels(h).length === 1, r.status);
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: [] });
    }).then(function (r) {
      return JSZip.loadAsync(r.body).then(function (zip) {
        var names = Object.keys(zip.files).filter(function (n) { return /\.html$/.test(n); });
        return Promise.all(names.map(function (n) { return zip.file(n).async('string'); })).then(function (htmls) {
          var ann = htmls[names.indexOf(engine.mailerFileName(ANN, ev))] || '';
          check('banner current: in the ZIP, the saved version carries the current banner, not the old', r.status === 200 && ann.indexOf(NEW_BANNER) !== -1 && ann.indexOf(OLD_BANNER) === -1);
          check('banner current: no file of the ZIP points at an older banner or leads with the bare hero', htmls.length > 3 && htmls.every(function (h) { return h.indexOf(OLD_BANNER) === -1 && h.indexOf('src="' + HERO + '"') === -1; }));
        });
      });
    }).then(function () {
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: withBannerUrl(SAVED_DOC, OLD_BANNER), track: true, saveId: 's1save', saveName: 'Launch v2' });
    }).then(function (r) {
      var h = String((r.json || {}).html);
      check('banner current: Copy HTML carries the current banner, not the old', r.status === 200 && h.indexOf(NEW_BANNER) !== -1 && h.indexOf(OLD_BANNER) === -1 && r.json.tracked === true);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: withBannerUrl(d, HERO) });
    }).then(function (r) {
      var h = String((r.json || {}).html);
      check('banner current: the PNG/PDF export (plain render) of a doc with the bare hero carries the banner', r.status === 200 && h.indexOf(NEW_BANNER) !== -1 && h.indexOf('src="' + HERO + '"') === -1);
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: withBannerUrl(d, OLD_BANNER) });
    }).then(function (r) {
      var h = textOf(r);
      check('banner current: the doc on screen with an older banner downloads with the current one', r.status === 200 && h.indexOf(NEW_BANNER) !== -1 && h.indexOf(OLD_BANNER) === -1);
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: withBannerUrl(d, OLD_BANNER), test: true });
    }).then(function (r) {
      var h = textOf(r);
      check('banner current: a test download too', r.status === 200 && h.indexOf(NEW_BANNER) !== -1 && h.indexOf(OLD_BANNER) === -1 && pixels(h).length === 0);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: withBannerUrl(d, OLD_BANNER), editor: true });
    }).then(function (r) {
      check('banner current: the studio\'s live preview shows the current banner', r.status === 200 && r.json.html.indexOf(NEW_BANNER) !== -1 && r.json.html.indexOf(OLD_BANNER) === -1);
      /* a picture the sender chose is never touched */
      saveAs(withBannerUrl(SAVED_DOC, CUSTOM));
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: ['mailer.announcement'] });
    }).then(function (r) {
      var h = textOf(r);
      check('banner current: a saved custom picture is left alone in a download', r.status === 200 && h.indexOf(CUSTOM) !== -1 && h.indexOf(NEW_BANNER) === -1);
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: [] }).then(function (z) {
        return zipFile(z, engine.mailerFileName(ANN, ev)).then(function (ann) {
          check('banner current: … and in the ZIP', z.status === 200 && ann.indexOf(CUSTOM) !== -1 && ann.indexOf(NEW_BANNER) === -1);
        });
      });
    }).then(function () {
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: withBannerUrl(d, CUSTOM), track: true });
    }).then(function (r) {
      var h = String((r.json || {}).html);
      check('banner current: … and in Copy HTML', r.status === 200 && h.indexOf(CUSTOM) !== -1 && h.indexOf(NEW_BANNER) === -1);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: withBannerUrl(d, OTHER_EVENT_BANNER), track: true });
    }).then(function (r) {
      check('banner current: another event\'s banner is the sender\'s choice, left alone', r.status === 200 && r.json.html.indexOf(OTHER_EVENT_BANNER) !== -1 && r.json.html.indexOf(NEW_BANNER) === -1);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: withBannerUrl(d, OTHER_BUCKET_BANNER), track: true });
    }).then(function (r) {
      check('banner current: a banner path in another bucket is left alone', r.status === 200 && r.json.html.indexOf(OTHER_BUCKET_BANNER) !== -1 && r.json.html.indexOf(NEW_BANNER) === -1);
      return call(mod.handleBlock, '/api/promo/mailer/block', { eventId: 'demo', type: 'banner' });
    }).then(function (r) {
      check('banner current: a Banner block added in the studio starts on the current banner', r.status === 200 && r.json && r.json.block &&
        r.json.block.props.url === NEW_BANNER, r.json && r.json.block);
      /* Change layout: the engine carries the old layout's banner block across as it was, so only withCurrentBanner
         brings an older banner up to date; the spotlights lead with the banner alone, never banner and colour band */
      return call(mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: 'mailer.speaker-spotlight', doc: withBannerUrl(d, OLD_BANNER) });
    }).then(function (r) {
      var j = r.json || {}, types = ((j.doc && j.doc.blocks) || []).map(function (b) { return b.type; });
      check('banner current: Change layout brings a carried-over older banner up to the current one', r.status === 200 && allAre(bannersOf(j.doc), NEW_BANNER) &&
        String(j.html).indexOf(NEW_BANNER) !== -1 && String(j.html).indexOf(OLD_BANNER) === -1, [r.status, bannersOf(j.doc)]);
      check('banner current: the Speaker spotlight it makes has the banner and no colour band (one header)', types.indexOf('banner') !== -1 && types.indexOf('hero') === -1, types);
      return call(mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: 'mailer.partner-spotlight', doc: withBannerUrl(d, HERO) });
    }).then(function (r) {
      var j = r.json || {}, types = ((j.doc && j.doc.blocks) || []).map(function (b) { return b.type; });
      check('banner current: Change layout of a mail holding the bare hero: the Partner spotlight leads with the banner alone', r.status === 200 && allAre(bannersOf(j.doc), NEW_BANNER) &&
        types.indexOf('hero') === -1, [r.status, types, bannersOf(j.doc)]);
      return call(mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: 'mailer.speaker-spotlight', doc: withBannerUrl(d, CUSTOM) });
    }).then(function (r) {
      check('banner current: Change layout leaves a picture the sender chose alone', r.status === 200 && allAre(bannersOf(r.json && r.json.doc), CUSTOM), [r.status, bannersOf(r.json && r.json.doc)]);
      savedBack(); bannerReset();
    }, function (err) { savedBack(); bannerReset(); throw err; });
  },

  /* withCurrentBanner, alone */
  function () {
    var W = pm.withCurrentBanner;
    var got = { ev: { oneworldId: 'demo', keyVisualUrl: HERO, bannerUrl: NEW_BANNER }, bucket: 'test-bucket' };
    var custom = withBannerUrl(docOf('mailer.announcement'), CUSTOM);
    check('withCurrentBanner: nothing to change gives back the same document', W(custom, got) === custom);
    var old = withBannerUrl(docOf('mailer.announcement'), OLD_BANNER), before = JSON.stringify(old), out = W(old, got);
    check('withCurrentBanner: an older banner becomes the current one; the document given is not modified', out !== old && allAre(bannersOf(out), NEW_BANNER) && JSON.stringify(old) === before);
    check('withCurrentBanner: every other block is the very same', out.blocks.filter(function (b) { return b.type !== 'banner'; }).every(function (b) { return old.blocks.indexOf(b) !== -1; }) &&
      out.subject === old.subject && out.mailerId === old.mailerId);
    var two = withBannerUrl(docOf('mailer.announcement'), HERO);
    two.blocks.push({ id: 'b2', type: 'banner', props: { url: OLD_BANNER } }, { id: 'b3', type: 'banner', props: { url: CUSTOM } }, { id: 'b4', type: 'banner', props: { url: '' } });
    var outTwo = W(two, got);
    check('withCurrentBanner: each banner block on its own: hero and older banner follow, custom and empty stay', JSON.stringify(bannersOf(outTwo).slice(-4)) === JSON.stringify([NEW_BANNER, NEW_BANNER, CUSTOM, '']), bannersOf(outTwo));
    check('withCurrentBanner: another event\'s and another bucket\'s banners stay', W(withBannerUrl(custom, OTHER_EVENT_BANNER), got).blocks.every(function (b) { return b.type !== 'banner' || b.props.url === OTHER_EVENT_BANNER; }) &&
      allAre(bannersOf(W(withBannerUrl(custom, OTHER_BUCKET_BANNER), got)), OTHER_BUCKET_BANNER));
    BANNER.asked = 0;
    W(old, got);
    check('withCurrentBanner: lib/promo-banner.js\'s isBannerUrl decides which pictures are this event\'s banners', BANNER.asked > 0, BANNER.asked);
    check('withCurrentBanner: with no bucket known, this event\'s banner folder is still recognised', allAre(bannersOf(W(old, { ev: got.ev })), NEW_BANNER));
    bannerBroken();
    var byFolder = W(old, got), keptOther = W(withBannerUrl(custom, OTHER_EVENT_BANNER), got);
    bannerFixed();
    check('withCurrentBanner: with lib/promo-banner.js unable to load, the folder rule still knows an old banner (and only this event\'s)',
      allAre(bannersOf(byFolder), NEW_BANNER) && allAre(bannersOf(keptOther), OTHER_EVENT_BANNER));
    check('withCurrentBanner: an http promo-banner address is not one of ours (left alone)', allAre(bannersOf(W(withBannerUrl(custom, OLD_BANNER.replace('https:', 'http:')), got)), OLD_BANNER.replace('https:', 'http:')));
    var stale = { ev: { oneworldId: 'demo', keyVisualUrl: HERO }, bucket: 'test-bucket' };
    check('withCurrentBanner: no current banner: an older one becomes the site\'s hero picture', allAre(bannersOf(W(old, stale)), HERO));
    var gone = W(old, { ev: { oneworldId: 'demo' }, bucket: 'test-bucket' });
    check('withCurrentBanner: an event with no hero picture any more: an older banner is dropped, never shipped', allAre(bannersOf(gone), '') && engine.renderDoc(gone, ev).indexOf(OLD_BANNER) === -1 && /<\/html>/i.test(engine.renderDoc(gone, ev)));
    check('withCurrentBanner: no document, or one with no blocks, comes back as it is', W(null, got) === null && W(undefined, got) === undefined && (function () { var x = { subject: 's' }; return W(x, got) === x; })());
    check('withCurrentBanner: no answer from eventFor at all: nothing changes', W(old, null) === old && W(old, {}) === old);
    check('_internal: savesOf, metaOf, withCurrentBanner for the previews', mod._internal && typeof mod._internal.savesOf === 'function' && typeof mod._internal.metaOf === 'function' && mod._internal.withCurrentBanner === W);
    return mod._internal.savesOf(FBR, 'demo').get().then(function (s) {
      var m = mod._internal.metaOf(s.docs[0]);
      check('_internal: savesOf reads the event\'s saved versions, metaOf describes one', s.size === 1 && m.saveId === 's1save' && m.name === 'Launch v2' && m.mailerId === 'mailer.announcement', m);
    });
  },

  /* withCurrentBanner and autoUrl, alone: the hero picture the sender picked is theirs; the server's follows */
  function () {
    var W = pm.withCurrentBanner, d = docOf('mailer.announcement');
    var got = { ev: { oneworldId: 'demo', keyVisualUrl: HERO, bannerUrl: NEW_BANNER }, bucket: 'test-bucket' };
    var stale = { ev: { oneworldId: 'demo', keyVisualUrl: HERO }, bucket: 'test-bucket' };
    var picked = withMark(d, HERO, OLD_BANNER), before = JSON.stringify(picked);
    check('autoUrl: the hero picture picked by the sender (the mark holds an older banner) stays, the same document back',
      W(picked, got) === picked && allAre(bannersOf(picked), HERO) && JSON.stringify(picked) === before);
    var pickedNow = withMark(d, HERO, NEW_BANNER);
    check('autoUrl: … and when the mark is the current banner (picked after /doc stamped it)', W(pickedNow, got) === pickedNow);
    var legacy = W(withMark(d, HERO, undefined), got);
    check('autoUrl: no mark (a save from before it) and the bare hero: follows the current banner, and is marked',
      allAre(bannersOf(legacy), NEW_BANNER) && allAre(marksOf(legacy), NEW_BANNER), [bannersOf(legacy), marksOf(legacy)]);
    var heroMark = W(withMark(d, HERO, HERO), got);
    check('autoUrl: the mark is the hero picture itself (put there while no banner was current): follows',
      allAre(bannersOf(heroMark), NEW_BANNER) && allAre(marksOf(heroMark), NEW_BANNER), [bannersOf(heroMark), marksOf(heroMark)]);
    check('autoUrl: a mark compared trimmed, as the address is', allAre(bannersOf(W(withMark(d, HERO, ' ' + HERO + ' '), got)), NEW_BANNER));
    var atNow = withMark(d, NEW_BANNER, undefined), stamped = W(atNow, got);
    check('autoUrl: a block already on the current banner, unmarked, is marked (a new document, the one given untouched)',
      stamped !== atNow && allAre(bannersOf(stamped), NEW_BANNER) && allAre(marksOf(stamped), NEW_BANNER) && marksOf(atNow).every(function (m) { return m === undefined; }));
    check('autoUrl: … and once marked, the same document comes back', W(stamped, got) === stamped);
    check('autoUrl: an older banner never goes out, whatever its mark says', allAre(bannersOf(W(withMark(d, OLD_BANNER, CUSTOM), got)), NEW_BANNER) &&
      allAre(bannersOf(W(withMark(d, OLD_BANNER, OLD_BANNER), got)), NEW_BANNER));
    var custom = withMark(d, CUSTOM, NEW_BANNER);
    check('autoUrl: a custom picture with a mark is left alone, mark and all', W(custom, got) === custom);
    check('autoUrl: no current banner: the picked hero stays, the same document back', W(picked, stale) === picked);
    var staleOld = W(withMark(d, OLD_BANNER, OLD_BANNER), stale);
    check('autoUrl: no current banner: an older banner becomes the hero picture, marked as the server\'s', allAre(bannersOf(staleOld), HERO) && allAre(marksOf(staleOld), HERO));
    check('autoUrl: then, once a banner is current, that block follows it', allAre(bannersOf(W(staleOld, got)), NEW_BANNER));
    check('autoUrl: the mail is the same bytes with or without the mark (the renderer reads url, href, alt)',
      engine.renderDoc(withMark(d, HERO, NEW_BANNER), ev) === engine.renderDoc(withBannerUrl(d, HERO), ev) &&
      engine.renderDoc(withMark(d, HERO, NEW_BANNER), ev, { editor: true }) === engine.renderDoc(withBannerUrl(d, HERO), ev, { editor: true }));
    var bare = docOf('mailer.announcement');
    bare.blocks = bare.blocks.filter(function (b) { return b.type !== 'banner'; });
    check('autoUrl: a mail with no banner block is the very same document', W(bare, got) === bare && W(bare, stale) === bare);
  },

  /* ======== the browser pass, 16.replaceSitePicture: the sender's hero picture is what every file shows ======== */
  function () {
    reset(); bannerFresh();
    var d = docOf('mailer.announcement'), picked = withMark(d, HERO, OLD_BANNER), sentBody = JSON.stringify(picked);
    var heroSrc = 'src="' + HERO + '"';
    var shows = function (h) { h = String(h); return h.indexOf(heroSrc) !== -1 && h.indexOf(NEW_BANNER) === -1; };
    saveAs(withMark(SAVED_DOC, HERO, OLD_BANNER));
    return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement' }).then(function (r) {
      var j = r.json || {};
      check('picked hero: /doc opens the saved version on the sender\'s hero picture, its mark kept', r.status === 200 && j.saved === true &&
        allAre(bannersOf(j.doc), HERO) && allAre(marksOf(j.doc), OLD_BANNER) && shows(j.html), [r.status, bannersOf(j.doc), marksOf(j.doc)]);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: picked, editor: true });
    }).then(function (r) {
      check('picked hero: the studio\'s live preview shows it', r.status === 200 && shows(r.json && r.json.html), r.status);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: picked });
    }).then(function (r) {
      check('picked hero: the PNG/PDF export shows it', r.status === 200 && shows(r.json && r.json.html), r.status);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: picked, track: true });
    }).then(function (r) {
      check('picked hero: Copy HTML carries it', r.status === 200 && r.json.tracked === true && shows(r.json.html), r.status);
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: picked });
    }).then(function (r) {
      check('picked hero: the download of the doc on screen carries it', r.status === 200 && shows(textOf(r)), r.status);
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: picked, test: true });
    }).then(function (r) {
      check('picked hero: … a test download too', r.status === 200 && shows(textOf(r)), r.status);
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: ['mailer.announcement'] });
    }).then(function (r) {
      check('picked hero: download one (the saved version) carries it', r.status === 200 && shows(textOf(r)), r.status);
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: [] });
    }).then(function (r) {
      return zipFile(r, engine.mailerFileName(ANN, ev)).then(function (ann) {
        check('picked hero: in the ZIP, the saved version carries it', r.status === 200 && shows(ann), r.status);
      });
    }).then(function () {
      check('picked hero: the document the studio sent is not changed', JSON.stringify(picked) === sentBody);
      /* the previews draw a saved version through the same withCurrentBanner (lib/promo-previews.js saveItems) */
      return mod.eventFor(FBR, 'demo', { headers: {} });
    }).then(function (got) {
      var previews = require('./promo-previews')._test;
      var snap = function (doc) { return { exists: true, data: function () { return { doc: JSON.stringify(doc) }; } }; };
      var items = previews.saveItems(['s1save', 's2save', 's3save'], [snap(withMark(SAVED_DOC, HERO, OLD_BANNER)), snap(withMark(SAVED_DOC, HERO, undefined)), snap(withMark(SAVED_DOC, HERO, HERO))], got);
      check('picked hero: the saved version\'s preview card shows it', items[0] && shows(items[0].html), items[0] && items[0].error);
      check('picked hero: a preview of a save from before the mark, on the bare hero, shows the current banner', items[1] && String(items[1].html).indexOf(NEW_BANNER) !== -1 && String(items[1].html).indexOf(heroSrc) === -1);
      check('picked hero: a preview whose mark is the hero picture itself shows the current banner', items[2] && String(items[2].html).indexOf(NEW_BANNER) !== -1 && String(items[2].html).indexOf(heroSrc) === -1);
      /* the studio's own round: open a new mailer, put the site's picture in its banner (the field changes url only,
         every other prop rides along), preview it, save it, open it again */
      return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement', fresh: true });
    }).then(function (r) {
      var j = r.json || {};
      check('picked hero: a new mailer\'s banner blocks are marked with the banner the server put there', r.status === 200 && allAre(bannersOf(j.doc), NEW_BANNER) && allAre(marksOf(j.doc), NEW_BANNER), marksOf(j.doc));
      var edited = JSON.parse(JSON.stringify(j.doc));
      edited.blocks.forEach(function (b) { if (b.type === 'banner') b.props.url = HERO; });
      saveAs(edited);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: edited, editor: true }).then(function (r2) {
        check('picked hero: the studio\'s round — the site\'s picture put in the banner shows in the live preview', r2.status === 200 && shows(r2.json && r2.json.html), r2.status);
        return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement' });
      });
    }).then(function (r) {
      check('picked hero: … and is what the saved version reopens on', r.status === 200 && allAre(bannersOf(r.json.doc), HERO) && shows(r.json.html), bannersOf(r.json && r.json.doc));
      /* a save from before the mark, holding the bare hero, still opens on the banner (the existing rule) */
      saveAs(withMark(SAVED_DOC, HERO, undefined));
      return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement' });
    }).then(function (r) {
      check('picked hero: a save from before the mark, on the bare hero, opens on the current banner, now marked', r.status === 200 &&
        allAre(bannersOf(r.json.doc), NEW_BANNER) && allAre(marksOf(r.json.doc), NEW_BANNER), [bannersOf(r.json && r.json.doc), marksOf(r.json && r.json.doc)]);
      saveAs(withMark(SAVED_DOC, HERO, HERO));
      return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', mailerIds: ['mailer.announcement'] });
    }).then(function (r) {
      var h = textOf(r);
      check('picked hero: a save whose mark is the hero picture itself goes out with the current banner', r.status === 200 && h.indexOf(NEW_BANNER) !== -1 && h.indexOf(heroSrc) === -1);
      return call(mod.handleBlock, '/api/promo/mailer/block', { eventId: 'demo', type: 'banner' });
    }).then(function (r) {
      var p = (r.json && r.json.block && r.json.block.props) || {};
      check('picked hero: a Banner block added in the studio is marked with the picture it starts on', r.status === 200 && p.url === NEW_BANNER && p.autoUrl === NEW_BANNER, p);
      return call(mod.handleBlock, '/api/promo/mailer/block', { eventId: 'demo', type: 'text' });
    }).then(function (r) {
      check('picked hero: any other block carries no mark', r.status === 200 && r.json.block && !('autoUrl' in r.json.block.props), r.json && r.json.block);
      bannerStale();
      return call(mod.handleBlock, '/api/promo/mailer/block', { eventId: 'demo', type: 'banner' });
    }).then(function (r) {
      var b = r.json && r.json.block;
      check('picked hero: a Banner block added while the banner is drawn again is marked with the hero picture it starts on', r.status === 200 && b.props.url === HERO && b.props.autoUrl === HERO, b);
      var later = pm.withCurrentBanner({ blocks: [b] }, { ev: { oneworldId: 'demo', keyVisualUrl: HERO, bannerUrl: NEW_BANNER }, bucket: 'test-bucket' });
      check('picked hero: … so it follows the banner once that is current', allAre(bannersOf(later), NEW_BANNER));
      savedBack(); bannerReset();
    }, function (err) { savedBack(); bannerReset(); throw err; });
  },

  /* ======== Change layout keeps the mark (the engine drops props its schema does not declare) ======== */
  function () {
    reset(); bannerFresh();
    var opened, picked;
    var noMarkWarning = function (rp) { return !((rp && rp.warnings) || []).some(function (w) { return /autoUrl/.test(w); }); };
    return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement', fresh: true }).then(function (r) {
      opened = r.json.doc;
      var before = JSON.stringify(opened);
      return call(mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: 'mailer.speaker-spotlight', doc: opened }).then(function (r2) {
        var j = r2.json || {}, rp = j.report || {};
        check('relayout: no warning about a field the sender never saw', r2.status === 200 && noMarkWarning(rp), rp.warnings);
        check('relayout: an untouched banner is not counted as moved', !(rp.matched || []).some(function (x) { return x.type === 'banner'; }), rp.matched);
        check('relayout: the new layout\'s banner is the current one, marked', allAre(bannersOf(j.doc), NEW_BANNER) && allAre(marksOf(j.doc), NEW_BANNER), [bannersOf(j.doc), marksOf(j.doc)]);
        check('relayout: the document sent is not changed', JSON.stringify(opened) === before);
      });
    }).then(function () {
      picked = withMark(opened, HERO, NEW_BANNER);
      return call(mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: 'mailer.speaker-spotlight', doc: picked });
    }).then(function (r) {
      var j = r.json || {};
      check('relayout: the hero picture the sender picked moves across, mark and all, and shows', r.status === 200 && allAre(bannersOf(j.doc), HERO) && allAre(marksOf(j.doc), NEW_BANNER) &&
        String(j.html).indexOf('src="' + HERO + '"') !== -1 && String(j.html).indexOf(NEW_BANNER) === -1 && noMarkWarning(j.report), [bannersOf(j.doc), marksOf(j.doc), j.report && j.report.warnings]);
      check('relayout: picked as before, so a save of it goes out with the hero picture', allAre(bannersOf(pm.withCurrentBanner(j.doc, GOT_FRESH())), HERO));
      /* a second banner the sender added, with the layout's own banner edited too (its alt text), so the edited one
         takes the new layout's only banner slot and the added one is carried in beside it, its mark with it */
      var two = JSON.parse(JSON.stringify(opened));
      two.blocks.forEach(function (b) { if (b.type === 'banner') b.props.alt = 'The summit, 2027'; });
      two.blocks.splice(2, 0, { id: 'bown', type: 'banner', props: { url: HERO, href: '', alt: 'Our venue', autoUrl: NEW_BANNER } });
      return call(mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: 'mailer.partner-spotlight', doc: two });
    }).then(function (r) {
      var j = r.json || {}, banners = ((j.doc && j.doc.blocks) || []).filter(function (b) { return b.type === 'banner'; });
      var own = banners.filter(function (b) { return b.props.url === HERO; }), auto = banners.filter(function (b) { return b.props.url === NEW_BANNER; });
      check('relayout: a second banner the sender added keeps its picture and its mark; the layout\'s own stays the current banner',
        r.status === 200 && own.length === 1 && own[0].id === 'bown' && own[0].props.autoUrl === NEW_BANNER && auto.length === 1 && auto[0].props.autoUrl === NEW_BANNER &&
        auto[0].props.alt === 'The summit, 2027' && ((j.report && j.report.carried) || []).some(function (c) { return c.id === 'bown'; }) && noMarkWarning(j.report),
        [banners.map(function (b) { return b.props; }), j.report && j.report.carried, j.report && j.report.warnings]);
      /* a save from before the mark still follows across a change of layout (the existing rule) */
      return call(mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: 'mailer.speaker-spotlight', doc: withMark(opened, HERO, undefined) });
    }).then(function (r) {
      check('relayout: no mark and the bare hero: the new layout carries the current banner', r.status === 200 && allAre(bannersOf(r.json.doc), NEW_BANNER) && allAre(marksOf(r.json.doc), NEW_BANNER), bannersOf(r.json && r.json.doc));
      bannerReset();
    }, function (err) { bannerReset(); throw err; });
  },

  /* ======== the browser pass, 17.accentLate: /doc carries the mail's colours ======== */
  function () {
    reset(); bannerFresh();
    var KEYS = ['accent', 'primary', 'ink', 'cardBg', 'pageBg', 'tileBg'];
    var hex = function (v) { return /^#[0-9a-f]{6}$/i.test(String(v)); };
    var fresh;
    return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement', fresh: true }).then(function (r) {
      var j = r.json || {}, pal = j.palette || {};
      fresh = pal;
      check('palette: /doc carries palette.accent', r.status === 200 && hex(pal.accent), j.palette);
      check('palette: /doc carries the six colours /render does, each a colour', JSON.stringify(Object.keys(pal)) === JSON.stringify(KEYS) && KEYS.every(function (k) { return hex(pal[k]); }), pal);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: j.doc, editor: true }).then(function (r2) {
        check('palette: /doc\'s colours are the ones the studio\'s render answers for the same mail', r2.status === 200 && JSON.stringify(r2.json.palette) === JSON.stringify(pal), [pal, r2.json && r2.json.palette]);
      });
    }).then(function () {
      saveAs(Object.assign({}, SAVED_DOC, { accent: '#1f6feb' }));
      return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement' });
    }).then(function (r) {
      var j = r.json || {}, pal = j.palette || {};
      check('palette: a saved version\'s own colour is in /doc\'s palette', r.status === 200 && pal.primary === '#1f6feb' && fresh.primary !== '#1f6feb' && hex(pal.accent) &&
        JSON.stringify(pal) === JSON.stringify(pm.paletteOf(GOT_FRESH().ev, j.doc)), [pal, fresh]);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: j.doc, editor: true }).then(function (r2) {
        check('palette: … the same as the render answers', JSON.stringify(r2.json.palette) === JSON.stringify(pal));
      });
    }).then(function () {
      savedBack(); bannerReset();
      check('palette: paletteOf is the engine\'s palette for the document', JSON.stringify(pm.paletteOf(ev, { accent: '#1f6feb' })) === JSON.stringify((function (p) {
        return { accent: p.accent, primary: p.primary, ink: p.ink, cardBg: p.cardBg, pageBg: p.pageBg, tileBg: p.tileBg };
      })(engine.renderCtx(ev, { accent: '#1f6feb' }).p)));
    }, function (err) { savedBack(); bannerReset(); throw err; });
  },

  /* ======== the mail's bytes: a mail without a banner block is what the engine renders, as before ======== */
  function () {
    reset(); bannerFresh();
    var bare = docOf('mailer.announcement');
    bare.blocks = bare.blocks.filter(function (b) { return b.type !== 'banner'; });
    return mod.eventFor(FBR, 'demo', { headers: {} }).then(function (got) {
      var want = engine.renderDoc(bare, got.ev);
      return call(mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: bare }).then(function (r) {
        check('bytes: a mail with no banner block renders byte for byte as the engine draws it', r.status === 200 && r.json.html === want);
        return call(mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: bare, test: true });
      }).then(function (r) {
        check('bytes: … and downloads so (a test download, untracked)', r.status === 200 && textOf(r) === want);
        bannerReset();
      });
    }, function (err) { bannerReset(); throw err; });
  },

  /* ======== Phase 3: example content never leaves as a real mail ======== */
  function () {
    reset(); bannerReset();
    var EXD = exampleDoc(EX_PERSON), EXL = exampleDoc(EX_LOGO), llm0 = LLM_CALLS, saved0 = SAVES.s1save.doc;
    var ANNID = 'mailer.announcement';
    return inTurn([
      ['save', mod.handleSave, '/api/promo/mailer/save', { eventId: 'demo', mailerId: ANNID, doc: EXD }, 'speakers'],
      ['save as new', mod.handleSave, '/api/promo/mailer/save', { eventId: 'demo', mailerId: ANNID, doc: EXL, name: 'Copy' }, 'partners'],
      ['render (the studio\'s preview)', mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: EXD, editor: true }, 'speakers'],
      ['render (Copy HTML)', mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: EXD, track: true }, 'speakers'],
      ['render (the PNG/PDF export)', mod.handleRender, '/api/promo/mailer/render', { eventId: 'demo', doc: EXL }, 'partners'],
      ['download the doc on screen', mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: EXD }, 'speakers'],
      ['a test download', mod.handleDownload, '/api/promo/mailer/download', { eventId: 'demo', doc: EXD, test: true }, 'speakers'],
      ['relayout', mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: ANNID, doc: EXD }, 'speakers'],
      ['relayout with an example picture as the Custom banner URL', mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: ANNID, doc: docOf(ANNID), params: { bannerUrl: EX_LOGO } }, 'partners'],
      ['open a new mailer with an example picture as the Custom banner URL', mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: ANNID, fresh: true, params: { bannerUrl: EX_PERSON } }, 'speakers'],
      ['AI (subject lines)', mod.handleAi, '/api/promo/mailer/ai', { eventId: 'demo', action: 'subjects', doc: EXD }, 'speakers'],
      ['AI (polish)', mod.handleAi, '/api/promo/mailer/ai', { eventId: 'demo', action: 'polish', doc: EXL }, 'partners'],
      ['AI (rewrite a field holding an example id)', mod.handleAi, '/api/promo/mailer/ai', { eventId: 'demo', action: 'rewrite', text: 'Hear {"id":"ex-s1","title":"x"} speak', doc: docOf(ANNID) }, 'agenda sessions']
    ], function (c, r) {
      check('example: ' + c[0] + ' is 422 code example', r.status === 422 && r.json && r.json.code === 'example', [r.status, r.json]);
      check('example: ' + c[0] + ' says what to add (' + c[4] + ')', r.json && r.json.error === 'Example content cannot be saved, downloaded or sent. Add the event\'s own ' + c[4] + ', then try again.', r.json && r.json.error);
    }).then(function () {
      check('example: nothing saved, nothing sent or recorded, no model asked', SAVES.s1save.doc === saved0 && Object.keys(SAVES).length === 1 && TRACK.calls.length === 0 && LLM_CALLS === llm0, [Object.keys(SAVES), TRACK.calls.length, LLM_CALLS - llm0]);
      /* a card's preview saved as a file and imported: its meta marker gives it away */
      var preview = '<!doctype html><html><head><meta name="oneworld-example" content="speakers"><title>x</title></head><body>' + engine.renderDoc(docOf(ANNID), ev).replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/g, '') + '</body></html>';
      return callRaw(mod.handleImport, '/api/promo/mailer/import?eventId=demo', Buffer.from(preview));
    }).then(function (r) {
      check('example: importing a card\'s preview is 422 code example', r.status === 422 && r.json && r.json.code === 'example' && /Add the event's own details/.test(r.json.error), [r.status, r.json]);
      return callRaw(mod.handleImport, '/api/promo/mailer/import?eventId=demo', Buffer.from(engine.renderDoc(docOf(ANNID), ev)));
    }).then(function (r) {
      check('example: a real mail still imports', r.status === 200 && r.json && Array.isArray(r.json.doc.blocks) && r.json.doc.blocks.length > 2, [r.status, r.json && r.json.error]);
      return callRaw(mod.handleImport, '/api/promo/mailer/import?eventId=demo', Buffer.from('<html><body><img src="' + EX_LOGO + '"></body></html>'));
    }).then(function (r) {
      check('example: importing a mail that shows an example logo is 422', r.status === 422 && r.json && r.json.code === 'example' && /own partners,/.test(r.json.error), [r.status, r.json]);
      /* the address written with entities: the file's text does not show it, the document the import reads does */
      var encoded = '<html><body><img src="' + BASE + '/assets&#47;promo-examples&#47;people&#47;p01.jpg" alt="x"><p>Join us in New Delhi.</p></body></html>';
      check('example: (the entity-written address passes the check on the raw file, so the next one is the document\'s)', !exampleStub.isExample(encoded));
      return callRaw(mod.handleImport, '/api/promo/mailer/import?eventId=demo', Buffer.from(encoded));
    }).then(function (r) {
      check('example: importing a mail whose example picture is written with entities is 422, no document handed back', r.status === 422 && r.json && r.json.code === 'example' &&
        /own speakers,/.test(r.json.error) && !('doc' in r.json) && !('html' in r.json), [r.status, r.json]);
      /* the export choke point itself: one example among real mails refuses the whole export, and records nothing */
      return pm.deliverables(FBX, DECODED, GOT, 'demo', [{ doc: docOf(ANNID), mailerId: ANNID, save: null }, { doc: EXD, mailerId: ANNID, save: null }]).then(function () {
        check('example: deliverables refuses an export holding an example', false);
      }, function (err) {
        check('example: deliverables refuses the whole export with 422 code example', err && err.status === 422 && err.body && err.body.code === 'example' && /own speakers,/.test(err.body.error), err && err.body);
        check('example: … and no send is recorded', TRACK.calls.length === 0);
      });
    }).then(function () {
      check('example: the sentence names every kind found', pm.exampleRefusal([EX_PERSON, EX_LOGO, '"ex-s2"']).error === 'Example content cannot be saved, downloaded or sent. Add the event\'s own speakers, partners and agenda sessions, then try again.' &&
        pm.exampleRefusal('<meta name="oneworld-example">').error.indexOf('own details,') !== -1);
      /* the routes do not mistake a real mail for an example */
      return call(mod.handleRelayout, '/api/promo/mailer/relayout', { eventId: 'demo', mailerId: ANNID, doc: docOf(ANNID), params: { bannerUrl: CUSTOM } });
    }).then(function (r) {
      check('example: a real mail with a real custom picture is not refused', r.status === 200 && r.json && Array.isArray(r.json.doc.blocks), [r.status, r.json && r.json.error]);
    });
  },

  /* ======== Phase 3: a new mailer this event cannot have is not opened; a saved one is ======== */
  function () {
    reset(); bannerReset();
    var real = engine.getMailer('mailer.award-winners').requires(ev);
    return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.award-winners' }).then(function (r) {
      check('open: a new mailer this event cannot have is 409 unavailable, with what is missing', r.status === 409 && r.json && r.json.code === 'unavailable' &&
        real.missing.length > 0 && JSON.stringify(r.json.missing) === JSON.stringify(real.missing) && r.json.error.indexOf(real.missing[0]) !== -1, [r.status, r.json]);
      return onlyAvailable(['mailer.agenda'], function () {
        return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement' }).then(function (r2) {
          check('open: a saved version of a mailer the event can no longer have still opens, on itself', r2.status === 200 && r2.json.saved === true && r2.json.save && r2.json.save.saveId === 's1save' && r2.json.doc.mailerId === 'mailer.announcement', [r2.status, r2.json && r2.json.error]);
          return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement', saveId: 's1save' });
        }).then(function (r3) {
          check('open: … asked for by its id too', r3.status === 200 && r3.json.saved === true);
          return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement', fresh: true });
        }).then(function (r4) {
          check('open: but a new one of it is 409 unavailable', r4.status === 409 && r4.json.code === 'unavailable' && r4.json.missing[0] === 'speakers', [r4.status, r4.json]);
          return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.announcement', saveId: 'nope' });
        }).then(function (r5) {
          check('open: a version that is not there is a new one: 409 unavailable', r5.status === 409 && r5.json.code === 'unavailable');
        });
      });
    }).then(function () {
      return call(mod.handleDoc, '/api/promo/mailer/doc', { eventId: 'demo', mailerId: 'mailer.agenda', fresh: true });
    }).then(function (r) {
      check('open: a new mailer the event can have still opens', r.status === 200 && r.json.saved === false && r.json.doc.mailerId === 'mailer.agenda', r.status);
    });
  },

  /* 10. the source: promo-track is loaded only inside tracker(), and Phase 1's placeholder text is gone */
  function () {
    var src = fs.readFileSync(path.join(__dirname, 'promo-mailer.js'), 'utf8');
    var all = src.match(/require\(\s*['"]\.\/promo-track(\.js)?['"]\s*\)/g) || [];
    var body = (/\nfunction tracker\(\) \{[\s\S]*?\n\}\n/.exec(src) || [''])[0];
    var inside = body.match(/require\(\s*['"]\.\/promo-track(\.js)?['"]\s*\)/g) || [];
    check('source: lib/promo-track.js is required only inside tracker(), never at the top', all.length === 1 && inside.length === 1, all);
    check('source: the Phase 1 "Not here yet (Phase 2)" note is gone', src.indexOf('Not here yet (Phase 2)') === -1 && src.indexOf('tracking comes with Phase 2') === -1);
    /* the banner and the examples are loaded on first use, never at the top: a fault in either holds what needed
       it (the sends wait for the banner; the request that needed the examples answers 500), never the loading of
       this file */
    var bannerReq = src.match(/require\(\s*['"]\.\/promo-banner(\.js)?['"]\s*\)/g) || [];
    var bannerBody = (/\nfunction bannerModule\(\) \{[\s\S]*?\n\}\n/.exec(src) || [''])[0];
    check('source: lib/promo-banner.js is required only inside bannerModule()', bannerReq.length === 1 && (bannerBody.match(/require\(\s*['"]\.\/promo-banner/g) || []).length === 1, bannerReq);
    var exReq = src.match(/require\(\s*['"]\.\/promo-examples(\.js)?['"]\s*\)/g) || [];
    var exBody = (/\nfunction exampleIn\(\) \{[\s\S]*?\n\}\n/.exec(src) || [''])[0];
    check('source: lib/promo-examples.js is required only inside exampleIn()', exReq.length === 1 && (exBody.match(/require\(\s*['"]\.\/promo-examples/g) || []).length === 1, exReq);
    check('source: no route failed unexpectedly', FAILS.length === 0, FAILS);
  }
];

steps.reduce(function (p, step, i) {
  return p.then(function () { return step(); }).then(null, function (err) { check('step ' + (i + 1) + ' ran without throwing', false, String(err && err.stack || err)); });
}, Promise.resolve()).then(function () {
  console.error = realError;
  Module._resolveFilename = realResolve;
  delete require.cache[STUB];
  delete require.cache[BANNER_STUB];
  delete require.cache[EX_STUB];
  delete require.cache[LLM_PATH];
  if (failed) { realError('promo-mailer: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-mailer: all ' + passed + ' checks passed');
});
