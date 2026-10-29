// node functions/lib/promo-previews.test.js — POST /api/promo/mailer/previews (lib/promo-previews.js, owner B): one
// request draws every mailer card of an event (its own mail, examples only in its gaps, states as they are) and the
// asked saved versions with the current banner, gzipped, never cached, never recorded. lib/promo-mailer.js stands in
// (its eventFor, savesOf and withCurrentBanner, plan §8a C9), resolved before the file system is asked, so this runs
// whether or not that unit's version is there yet. No network, no Firebase.
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const Module = require('module');
const engine = require('./vendor/promo-engine');
const ex = require('./promo-examples');
const { sendJson } = require('./http');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var BASE = 'https://revamp.example', BANNER = 'https://storage.googleapis.com/qa-bucket/events/qa-rich/promo-banner/abcdef0123456789-x-0011223344556677.jpg';

/* ---- lib/promo-mailer.js and lib/activity.js stand in ---- */
var M = { eventForCalls: 0, wired: [], savesReads: 0, wholeReads: 0, readIds: [], bannerCalls: [], got: null, eventErr: null, saves: {} };
var mailerStub = {
  wire: function (h) { M.wired.push(h); },
  eventFor: function (fb, eventId, req) {
    M.eventForCalls++;
    if (M.eventErr) return Promise.reject(M.eventErr);
    return Promise.resolve(M.got);
  },
  _internal: {
    savesOf: function (fb, eventId) {
      return {
        /* the whole collection: never wanted here (only the asked versions are read) */
        get: function () { M.wholeReads++; return Promise.resolve({ docs: [] }); },
        doc: function (id) { return { get: function () {
          M.savesReads++; M.readIds.push(id);
          var row = Object.prototype.hasOwnProperty.call(M.saves, id) ? M.saves[id] : null;
          return Promise.resolve({ id: id, exists: !!row, data: function () { return row || undefined; } });
        } }; }
      };
    },
    /* what the real one does for a doc saved before the banner: its bare hero picture becomes the current banner */
    withCurrentBanner: function (doc, got) {
      M.bannerCalls.push(got);
      var now = got.ev.bannerUrl || got.ev.keyVisualUrl;
      return Object.assign({}, doc, { blocks: doc.blocks.map(function (b) {
        return b.type === 'banner' && b.props && b.props.url === got.ev.keyVisualUrl ? Object.assign({}, b, { props: Object.assign({}, b.props, { url: now }) }) : b;
      }) });
    }
  }
};
var activityCalls = 0;
var STUBS = { './promo-mailer': path.join(__dirname, '__stub-promo-mailer.js'), './activity': path.join(__dirname, '__stub-activity.js') };
var realResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return realResolve.apply(this, arguments);
};
require.cache[STUBS['./promo-mailer']] = { id: STUBS['./promo-mailer'], filename: STUBS['./promo-mailer'], loaded: true, exports: mailerStub, children: [], paths: [] };
require.cache[STUBS['./activity']] = { id: STUBS['./activity'], filename: STUBS['./activity'], loaded: true, children: [], paths: [],
  exports: { logActivity: function () { activityCalls++; return Promise.resolve(); } } };

const pv = require('./promo-previews');

/* ---- fixtures (the engine's EventEntity) ---- */
var future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 16), future2 = new Date(Date.now() + 31 * 864e5).toISOString().slice(0, 16);
var pastStart = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 16), pastEnd = new Date(Date.now() - 19 * 864e5).toISOString().slice(0, 16);
function person(i, name, group) { return { id: 's' + i, name: name, designation: 'Director', company: 'Real Co ' + i, photoUrl: 'https://img.etb2bimg.com/files/s' + i + '.jpg', group: group, weightage: i }; }
function rich() {
  var names = ['Asha Rao', 'Vikram Shah', 'अनन्या शर्मा', 'O\'Brien "QA" <b>', 'Divya Pillai', 'Manoj Gupta', 'Sana Kapoor', 'Ravi Teja'];
  var sp = names.map(function (n, i) { return person(i + 1, n, i < 2 ? 'Keynote Speakers' : 'Speakers'); });
  var sponsors = [['Medisys', 'Presenting Partner'], ['Orbit Pharma', 'Gold Partners'], ['Carelink', 'Gold Partners'], ['Nova Labs', 'Associate Partners'], ['Healix', 'Associate Partners'], ['Pulse AI', 'Associate Partners']]
    .map(function (s, i) { return { id: 'sp' + i, title: s[0], logoUrl: 'https://img.etb2bimg.com/files/l' + i + '.png', tier: s[1], weightage: i + 1 }; });
  return {
    portal: 'health', entityId: 0, oneworldId: 'qa-rich', name: 'Healthcare Leaders Summit 2027', edition: 9, tagline: 'Where hospital leaders shape care',
    hashtag: '#HealthcareLeadersSummit27', startDate: future, endDate: future2, dateLabel: engine.fmtDateLabel(future, future2), totalDays: 2,
    venue: 'Shangri-La Eros', city: 'New Delhi', ctaLabel: 'Register Now', ctaUrl: BASE + '/e/qa-rich#register', logoUrl: BASE + '/assets/x/logo.png',
    keyVisualUrl: BASE + '/templates/x/hero.jpg', keyVisualMode: 'hero', micrositeUrl: BASE + '/e/qa-rich', siteAccent: '#8f6118', siteTheme: 'dark',
    whoShouldAttend: ['Hospital CEOs', 'CMOs', 'CIOs', 'Nursing heads'], keyPoints: ['Access', 'Quality', 'AI in diagnostics'], whyJoin: [],
    stats: [{ label: 'Speakers', value: '8' }, { label: 'Partners', value: '6' }, { label: 'Days', value: '2' }],
    speakers: sp, sponsorTiers: engine.groupSponsors(sponsors),
    sessions: [0, 1, 2, 3].map(function (i) { return { id: 'x' + i, title: 'Session ' + (i + 1), start: future.slice(0, 11) + '1' + i + ':00', end: future.slice(0, 11) + '1' + i + ':45', speakers: [sp[i]] }; })
  };
}
function sparse() {
  return Object.assign(rich(), { oneworldId: 'qa-sparse', speakers: [], sponsorTiers: [], sessions: [], keyPoints: [], whoShouldAttend: [], whyJoin: [], stats: [], venue: undefined, city: undefined });
}
function gotOf(ev, bannerUrl) {
  if (bannerUrl) ev.bannerUrl = bannerUrl;
  return { ev: ev, stored: { createdAt: '2026-10-01T00:00:00.000Z' }, kit: {}, banner: { needed: true, fresh: !!bannerUrl, fingerprint: 'f'.repeat(32), url: bannerUrl || null }, bucket: 'qa-bucket' };
}

/* ---- helpers, as lib/api.js hands them over ---- */
var FB = { db: {}, bucket: { name: 'qa-bucket' } }, DECODED = { email: 'admin@ethrworld.com' };
var H = { limits: [], live: 0, liveErr: null, failures: [],
  BODY_LIMITS: { ai: 2 << 20, small: 256 << 10, tiny: 16 << 10 },
  withAdmin: function (req, res, cb) { cb(FB, DECODED); },
  withAdminBody: function (req, res, limit, cb) { H.limits.push(limit); cb(FB, DECODED, req.body); },
  eventIdOr400: function (res, v) { var s = typeof v === 'string' ? v.trim() : ''; if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(s)) { sendJson(res, 400, { error: 'eventId is required.' }); return ''; } return s; },
  loadLiveEvent: function () { H.live++; return H.liveErr ? Promise.reject(H.liveErr) : Promise.resolve({ createdAt: 'x' }); },
  publicBaseFor: function () { return BASE; },
  sendFailure: function (res, what, err, msg) { if (err && err.status && err.body) return sendJson(res, err.status, err.body); H.failures.push(what + ': ' + (err && err.stack || err)); sendJson(res, 500, { error: msg }); }
};
function httpError(status, message) { var e = new Error(message); e.status = status; e.body = { error: message }; return e; }

pv.wire(H);
check('wire: hands the helpers to lib/promo-mailer.js too (a cold instance\'s first Promotions request can be this one)', M.wired.length === 1 && M.wired[0] === H);

/* one request: { status, headers, raw (Buffer|string), json } */
function call(body, headers) {
  return new Promise(function (resolve) {
    var res = { headers: {}, headersSent: false,
      writeHead: function (s, h) { res.status = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      end: function (b) {
        var raw = b == null ? '' : b, text = Buffer.isBuffer(raw) ? (res.headers['Content-Encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw).toString('utf8') : String(raw), json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        resolve({ status: res.status, headers: res.headers, raw: raw, json: json });
      } };
    pv.handlePreviews({ method: 'POST', url: '/api/promo/mailer/previews', headers: headers || {}, body: body }, res);
  });
}
function byKey(items) { var o = {}; (items || []).forEach(function (i) { o[i.key] = i; }); return o; }
function reset(got) { M.got = got; M.eventErr = null; M.eventForCalls = 0; M.savesReads = 0; M.wholeReads = 0; M.readIds = []; M.bannerCalls = []; M.saves = {}; H.live = 0; H.liveErr = null; H.failures = []; H.limits = []; }
var AWARD = ['mailer.award-nominations', 'mailer.award-deadline', 'mailer.award-jury', 'mailer.award-ceremony', 'mailer.award-winners'];
var ORDER = engine.ALL_MAILERS.map(function (m) { return 'tpl:' + m.id; });

/* a saved Announcement made before Phase 3: its banner block holds the site's bare hero picture */
function savedDoc(ev) {
  var d = engine.buildDoc(engine.getMailer('mailer.announcement'), ev, {});
  var hasBanner = d.blocks.some(function (b) { return b.type === 'banner'; });
  if (!hasBanner) d.blocks.unshift({ id: 'bn1', type: 'banner', props: { url: ev.keyVisualUrl, alt: ev.name, href: '' } });
  d.blocks.forEach(function (b) { if (b.type === 'banner') b.props = Object.assign({}, b.props, { url: ev.keyVisualUrl }); });
  return d;
}

var steps = [

  /* X.5 a rich event that is not an award: 18 cards, only the award ones are examples; one eventFor, nothing recorded */
  function () {
    reset(gotOf(rich(), BANNER));
    return call({ eventId: 'qa-rich', templates: true }, { 'accept-encoding': 'gzip, deflate, br' }).then(function (r) {
      var items = (r.json && r.json.items) || [], k = byKey(items);
      check('X.5 200 with 18 template cards, in the engine\'s order', r.status === 200 && items.length === 18 && JSON.stringify(items.map(function (i) { return i.key; })) === JSON.stringify(ORDER), items.map(function (i) { return i.key; }));
      check('X.5 one eventFor for the whole request; the saves are not read when none are asked', M.eventForCalls === 1 && M.savesReads === 0 && M.wholeReads === 0);
      check('X.5 the body limit is the 16 KB one', H.limits[0] === H.BODY_LIMITS.tiny);
      var examples = items.filter(function (i) { return i.example; }).map(function (i) { return i.key.slice(4); });
      check('X.5 only the five award mailers are examples on an event that is not an award', JSON.stringify(examples) === JSON.stringify(AWARD), examples);
      check('X.5 each award card filled only its award facts (the event has its own jury)', AWARD.every(function (id) { return JSON.stringify(k['tpl:' + id].filled) === '["award"]'; }));
      check('X.5 every other card is the real mail: html, example false, nothing filled, no state, nothing missing', items.filter(function (i) { return !i.example; })
        .every(function (i) { return typeof i.html === 'string' && /<\/html>/i.test(i.html) && i.example === false && !i.filled.length && i.state === null && !i.missing.length; }));
      check('X.5 an example card names what its event lacks', AWARD.every(function (id) { return k['tpl:' + id].missing.length > 0 && k['tpl:' + id].state === null; }));
      check('X.5 example HTML is marked (meta and visible row), real HTML never is', items.every(function (i) { return ex.isExample(i.html) === !!i.example; }) &&
        AWARD.every(function (id) { var h = k['tpl:' + id].html; return /<meta name="oneworld-example" content="award">/.test(h) && /EXAMPLE PREVIEW<\/strong> — the award facts in this mail are examples/.test(h); }));
      check('X.7 the plain render: no data-block-id, no editor placeholders, no script', items.every(function (i) { return !/data-block-id|data-ed=/.test(i.html) && !/<script/i.test(i.html); }));
      check('X.5 the real mail is exactly what a send would render', k['tpl:mailer.announcement'].html === engine.renderDoc(engine.buildDoc(engine.getMailer('mailer.announcement'), M.got.ev, {}), M.got.ev));
      /* the engine puts the composed banner in a mail's top banner once it knows bannerUrl (Unit A's Phase 3 engine) */
      if (/bannerUrl/.test(fs.readFileSync(require.resolve('./vendor/promo-engine'), 'utf8'))) {
        check('X.5 cards carry the event\'s current banner', k['tpl:mailer.announcement'].html.indexOf(BANNER) !== -1);
      } else console.log('note: the engine does not read bannerUrl yet (Unit A); the cards\' banner is checked once it does.');
      check('X.5 gzipped when the browser takes it; never cached', r.headers['Content-Encoding'] === 'gzip' && Buffer.isBuffer(r.raw) && r.raw.length < Buffer.byteLength(JSON.stringify(r.json)) &&
        r.headers['Cache-Control'] === 'no-store' && /application\/json/.test(r.headers['Content-Type']) && r.headers['Vary'] === 'Accept-Encoding' && r.headers['Content-Length'] === r.raw.length);
      check('X.5 nothing recorded: no activity line', activityCalls === 0);
      check('X.5 no failure logged', !H.failures.length, H.failures);
    });
  },

  /* the sparse event: every list mailer is an example of just its gap, with pictures on the app's address */
  function () {
    reset(gotOf(sparse()));
    return call({ eventId: 'qa-sparse', templates: true, saveIds: [] }).then(function (r) {
      var k = byKey(r.json.items);
      var want = { 'mailer.discussion': 'points', 'mailer.resilience': 'why', 'mailer.speakers': 'speakers', 'mailer.speaker-spotlight': 'speakers', 'mailer.decrypt': 'speakers',
        'mailer.partners': 'sponsors', 'mailer.partner-spotlight': 'sponsors', 'mailer.agenda': 'sessions', 'mailer.award-jury': 'award,speakers' };
      var wrong = Object.keys(want).filter(function (id) { var i = k['tpl:' + id]; return !i.example || i.filled.join(',') !== want[id] || !ex.isExample(i.html); });
      check('X.5 sparse: each list mailer fills only its own gap, marked', !wrong.length, wrong);
      check('X.5 sparse: the always-available mailers are the real mail', ['mailer.announcement', 'mailer.conference', 'mailer.all-in-one', 'mailer.blank', 'mailer.reminder']
        .every(function (id) { var i = k['tpl:' + id]; return i.example === false && !ex.isExample(i.html); }));
      check('X.5 sparse: example pictures are absolute on the app\'s address', k['tpl:mailer.speakers'].html.indexOf(BASE + '/assets/promo-examples/people/p01.jpg') !== -1 &&
        k['tpl:mailer.partners'].html.indexOf(BASE + '/assets/promo-examples/logos/l01.png') !== -1);
      check('X.5 sparse: not gzipped when the browser did not ask', !r.headers['Content-Encoding']);
    });
  },

  /* X.6 a past event's Reminder: the real mail with its state, no example */
  function () {
    var ev = Object.assign(rich(), { startDate: pastStart, endDate: pastEnd, dateLabel: engine.fmtDateLabel(pastStart, pastEnd) });
    reset(gotOf(ev));
    return call({ eventId: 'qa-rich', templates: true }).then(function (r) {
      var i = byKey(r.json.items)['tpl:mailer.reminder'];
      check('X.6 a past event\'s Reminder: state past, the real HTML, no marker', i.state === 'past' && i.example === false && !i.filled.length && typeof i.html === 'string' && !ex.isExample(i.html) && i.missing.length === 1, i);
      check('X.6 …drawn from the event as it is', i.html === engine.renderDoc(engine.buildDoc(engine.getMailer('mailer.reminder'), ev, {}), ev));
    });
  },

  /* an award with nominations closed: those cards are states; Winners announced is still an example */
  function () {
    var ev = Object.assign(rich(), { ctaLabel: 'Nominate Now', award: { awardId: 0, phase: 'upcoming', awardUrl: BASE + '/e/qa-rich', ceremonyDate: future, ceremonyDateLabel: engine.fmtDateLabel(future),
      nominationsOpen: false, nominateUrl: BASE + '/e/qa-rich', categories: 9 } });
    reset(gotOf(ev));
    return call({ eventId: 'qa-rich', templates: true }).then(function (r) {
      var k = byKey(r.json.items);
      check('award, nominations closed: Call for nominations and Deadline are state closed, real mail', ['mailer.award-nominations', 'mailer.award-deadline']
        .every(function (id) { var i = k['tpl:' + id]; return i.state === 'closed' && !i.example && typeof i.html === 'string' && !ex.isExample(i.html); }));
      check('award: its jury and ceremony mailers are its own', !k['tpl:mailer.award-jury'].example && !k['tpl:mailer.award-ceremony'].example && k['tpl:mailer.award-ceremony'].state === null);
      check('award: Winners announced stays an example (decision 4)', k['tpl:mailer.award-winners'].example === true && ex.isExample(k['tpl:mailer.award-winners'].html));
    });
  },

  /* a mailer that cannot be filled keeps its "needs …" line and no picture; one that throws fails alone */
  function () {
    var ev = Object.assign(sparse(), { name: '' });
    reset(gotOf(ev));
    var ann = engine.getMailer('mailer.agenda'), real = ann.requires;
    ann.requires = function () { throw new Error('stub: this mailer broke'); };
    var errLog = console.error; console.error = function () {};
    return call({ eventId: 'qa-sparse', templates: true }).then(function (r) {
      ann.requires = real; console.error = errLog;
      var k = byKey(r.json.items), a = k['tpl:mailer.announcement'];
      check('still unavailable: no html, the old "needs …" line\'s reasons, not an example', r.status === 200 && a && !('html' in a) && a.example === false && a.missing.length > 0 && !a.error, a);
      check('a mailer that throws: that card alone answers render failed', JSON.stringify(k['tpl:mailer.agenda']) === JSON.stringify({ key: 'tpl:mailer.agenda', error: 'render failed' }) &&
        r.json.items.length === 18 && typeof k['tpl:mailer.speakers'].html === 'string');
    }, function (err) { ann.requires = real; console.error = errLog; throw err; });
  },

  /* saved versions: drawn with the current banner, in the order asked; too large, missing and broken ones alone */
  function () {
    var ev = rich(), got = gotOf(ev, BANNER), d = savedDoc(ev);
    reset(got);
    var big = engine.buildDoc(engine.getMailer('mailer.blank'), ev, {});
    big.blocks.push({ id: 'huge', type: 'html', props: { html: '<p>' + 'x'.repeat(420 * 1024) + '</p>' } });
    M.saves = {
      s1: { mailerId: 'mailer.announcement', doc: JSON.stringify(d), savedAt: 2000 },
      sBig: { mailerId: 'mailer.blank', doc: JSON.stringify(big), savedAt: 1500 },
      sBad: { mailerId: 'mailer.blank', doc: '{not json', savedAt: 1200 },
      sOther: { mailerId: 'mailer.blank', doc: JSON.stringify(big), savedAt: 1000 }
    };
    var errLog = console.error; console.error = function () {};
    return call({ eventId: 'qa-rich', templates: false, saveIds: ['sBig', 's1', 'gone', 'sBad', 's1'] }, { 'accept-encoding': 'gzip' }).then(function (r) {
      console.error = errLog;
      var items = r.json.items, k = byKey(items);
      check('saves: only the asked ones, once each, in the order asked; no template cards', JSON.stringify(items.map(function (i) { return i.key; })) === JSON.stringify(['save:sBig', 'save:s1', 'save:gone', 'save:sBad']));
      check('saves: only the asked versions are read, once each (never the whole collection); one eventFor',
        JSON.stringify(M.readIds) === JSON.stringify(['sBig', 's1', 'gone', 'sBad']) && M.wholeReads === 0 && M.eventForCalls === 1, M.readIds);
      check('saves: drawn with the current banner (the bare hero of a save before Phase 3 replaced)', typeof k['save:s1'].html === 'string' && k['save:s1'].html.indexOf(BANNER) !== -1 &&
        k['save:s1'].html.indexOf(ev.keyVisualUrl) === -1 && M.bannerCalls.length >= 1 && M.bannerCalls[0] === got, k['save:s1'].error);
      check('saves: the plain render, not an example, nothing filled', k['save:s1'].example === false && !k['save:s1'].filled.length && k['save:s1'].state === null && !/data-block-id/.test(k['save:s1'].html));
      check('saves: over 400 KB of HTML -> too large', JSON.stringify(k['save:sBig']) === JSON.stringify({ key: 'save:sBig', error: 'too large' }));
      check('saves: a version that no longer exists -> not found', JSON.stringify(k['save:gone']) === JSON.stringify({ key: 'save:gone', error: 'not found' }));
      check('saves: a broken document -> render failed, the others fine', JSON.stringify(k['save:sBad']) === JSON.stringify({ key: 'save:sBad', error: 'render failed' }));
    }, function (err) { console.error = errLog; throw err; });
  },

  /* an id Firestore keeps for itself (__name__): .doc() takes it and the read then fails, so it is never read */
  function () {
    var ev = rich(), got = gotOf(ev, BANNER);
    reset(got);
    M.saves = { s1: { mailerId: 'mailer.announcement', doc: JSON.stringify(savedDoc(ev)), savedAt: 2000 } };
    var realSavesOf = mailerStub._internal.savesOf;
    /* as Firestore does: a reserved id's read fails */
    mailerStub._internal.savesOf = function (fb, eventId) {
      var col = realSavesOf(fb, eventId), doc = col.doc;
      col.doc = function (id) { return /^__.*__$/.test(id) ? { get: function () { M.readIds.push(id); return Promise.reject(new Error('reserved id')); } } : doc(id); };
      return col;
    };
    return call({ eventId: 'qa-rich', templates: true, saveIds: ['__x__', 's1', '__name__'] }).then(function (r) {
      mailerStub._internal.savesOf = realSavesOf;
      var k = byKey(r.json && r.json.items);
      check('saves: a reserved id (__x__) -> not found, never read; the other version and the 18 template cards still draw',
        r.status === 200 && JSON.stringify(k['save:__x__']) === JSON.stringify({ key: 'save:__x__', error: 'not found' }) &&
        JSON.stringify(k['save:__name__']) === JSON.stringify({ key: 'save:__name__', error: 'not found' }) &&
        typeof k['save:s1'].html === 'string' && ORDER.every(function (key) { return !!k[key]; }) && JSON.stringify(M.readIds) === '["s1"]' && !H.failures.length,
        [r.status, M.readIds, H.failures]);
    }, function (err) { mailerStub._internal.savesOf = realSavesOf; throw err; });
  },

  /* the body: ids only, at most 40; nothing asked still checks the event */
  function () {
    reset(gotOf(rich()));
    var many = []; for (var i = 0; i < 41; i++) many.push('s' + i);
    return Promise.all([
      call({ eventId: 'qa-rich', templates: true, saveIds: many }),
      call({ eventId: 'qa-rich', templates: true, saveIds: 's1' }),
      call({ eventId: 'qa-rich', saveIds: ['../x'] }),
      call({ eventId: 'qa-rich', saveIds: [7] }),
      call({ eventId: 'Bad Id', templates: true }),
      call({ eventId: 'qa-rich', templates: 'yes' })
    ]).then(function (r) {
      check('41 saved versions -> 400', r[0].status === 400 && /40/.test(r[0].json.error));
      check('saveIds that is not a list -> 400', r[1].status === 400);
      check('an id that is not a saved-version id -> 400', r[2].status === 400 && r[3].status === 400);
      check('a bad eventId -> 400', r[4].status === 400);
      check('templates must be true to draw templates; nothing asked -> an empty list, after the live-event check', r[5].status === 200 && JSON.stringify(r[5].json) === '{"items":[]}' && H.live === 1 && M.eventForCalls === 0);
      check('nothing drawn for a refused body', M.eventForCalls === 0 && M.savesReads === 0 && M.wholeReads === 0);
    });
  },

  /* a document in the body is never read: ids in, HTML out */
  function () {
    reset(gotOf(rich()));
    return call({ eventId: 'qa-rich', templates: false, saveIds: [], doc: { blocks: [{ type: 'html', props: { html: '<p>INJECTED</p>' } }] } }).then(function (r) {
      check('a doc sent in the body is ignored', r.status === 200 && JSON.stringify(r.json) === '{"items":[]}');
    });
  },

  /* a deleted event: its 404, as every route answers it; nothing asked: the same */
  function () {
    reset(gotOf(rich()));
    M.eventErr = httpError(404, 'This event has been deleted.');
    H.liveErr = httpError(404, 'This event has been deleted.');
    return Promise.all([call({ eventId: 'qa-rich', templates: true }), call({ eventId: 'qa-rich' })]).then(function (r) {
      check('a deleted event -> 404 (buildKit\'s live check, through eventFor)', r[0].status === 404 && r[0].json.error === 'This event has been deleted.');
      check('a deleted event with nothing asked -> 404 too', r[1].status === 404);
    });
  },

  /* anything else that fails: one plain sentence, the cause logged */
  function () {
    reset(gotOf(rich()));
    M.eventErr = new Error('stub: Firestore unavailable');
    return call({ eventId: 'qa-rich', templates: true }).then(function (r) {
      check('an unexpected failure -> 500 with a plain sentence, the cause logged', r.status === 500 && /could not be drawn/.test(r.json.error) && !/Firestore/.test(r.json.error) && /Firestore unavailable/.test(H.failures[0] || ''));
    });
  }
];

/* the Accept-Encoding rules */
var ag = pv._test.acceptsGzip;
function hd(v) { return { headers: { 'accept-encoding': v } }; }
check('gzip: named, under *, refused at q=0, absent', ag(hd('gzip')) && ag(hd('br, gzip;q=0.5')) && ag(hd('*')) && !ag(hd('gzip;q=0')) && !ag(hd('br')) && !ag({ headers: {} }) && !ag(hd('identity')) && !ag(hd('*;q=0')) && ag(hd('gzip;q=1, *;q=0')));

/* nothing recorded, nothing tracked: by construction */
var src = fs.readFileSync(path.join(__dirname, 'promo-previews.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
check('the module never records activity or tracks a send', !/logActivity|require\('\.\/activity'\)|promo-track|injectTracking|recordSends/.test(src));
check('the module never hands back a document', !/doc:\s/.test(src.replace(/^.*\/\/.*$/mg, '')));

steps.reduce(function (p, s) { return p.then(s); }, Promise.resolve()).then(function () {
  Module._resolveFilename = realResolve;
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (err) {
  Module._resolveFilename = realResolve;
  console.error('FAIL a step threw — ' + (err && err.stack || err));
  process.exit(1);
});
