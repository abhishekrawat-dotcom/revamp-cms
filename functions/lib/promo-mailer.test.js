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
Module._resolveFilename = function (request) {
  if (request === './promo-track') { if (FAIL_LOAD) throw new Error('stub: cannot load lib/promo-track.js'); return STUB; }
  return realResolve.apply(this, arguments);
};
function trackIn() { require.cache[STUB] = { id: STUB, filename: STUB, loaded: true, exports: trackStub, children: [], paths: [] }; }
/* Node remembers which file './promo-track' resolved to, and asks again only once that file is out of its cache */
function trackBroken() { FAIL_LOAD = true; delete require.cache[STUB]; }
function trackFixed() { FAIL_LOAD = false; trackIn(); }
trackIn();

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
} } };
var FAILS = [];
mod.wire({
  BODY_LIMITS: { ai: 1 << 20, small: 1 << 14 },
  withAdmin: function (req, res, cb) { cb(FBR, DECODED); },
  withAdminBody: function (req, res, limit, cb) { cb(FBR, DECODED, req.body); },
  eventIdOr400: function (res, v) { var s = String(v || ''); if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(s)) { sendJson(res, 400, { error: 'eventId required' }); return null; } return s; },
  publicBaseFor: function () { return BASE; },
  sendFailure: function (res, what, err, msg) { FAILS.push(what + ': ' + (err && err.stack || err)); sendJson(res, 500, { error: msg }); },
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

  /* 10. the source: promo-track is loaded only inside tracker(), and Phase 1's placeholder text is gone */
  function () {
    var src = fs.readFileSync(path.join(__dirname, 'promo-mailer.js'), 'utf8');
    var all = src.match(/require\(\s*['"]\.\/promo-track(\.js)?['"]\s*\)/g) || [];
    var body = (/\nfunction tracker\(\) \{[\s\S]*?\n\}\n/.exec(src) || [''])[0];
    var inside = body.match(/require\(\s*['"]\.\/promo-track(\.js)?['"]\s*\)/g) || [];
    check('source: lib/promo-track.js is required only inside tracker(), never at the top', all.length === 1 && inside.length === 1, all);
    check('source: the Phase 1 "Not here yet (Phase 2)" note is gone', src.indexOf('Not here yet (Phase 2)') === -1 && src.indexOf('tracking comes with Phase 2') === -1);
    check('source: no route failed unexpectedly', FAILS.length === 0, FAILS);
  }
];

steps.reduce(function (p, step, i) {
  return p.then(function () { return step(); }).then(null, function (err) { check('step ' + (i + 1) + ' ran without throwing', false, String(err && err.stack || err)); });
}, Promise.resolve()).then(function () {
  console.error = realError;
  Module._resolveFilename = realResolve;
  delete require.cache[STUB];
  if (failed) { realError('promo-mailer: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-mailer: all ' + passed + ' checks passed');
});
