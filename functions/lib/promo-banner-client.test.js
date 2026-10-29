// node functions/lib/promo-banner-client.test.js — Promotions → Mailers, the mail's top banner in the browser
// (promo-banner.js, window.RevampPromoBanner): when it draws and when it does not, what it hands the drawing and
// the PNG maker, what it uploads, the one extra round after 'banner-moved', a failure that resolves instead of
// rejecting, one run per page, and that the file is ES5. Then the whole loop (K.8): a download is refused while
// the banner is stale, the client draws and uploads it, and the download then carries the new banner and not the
// old one — with lib/promo-mailer.js's real stale refusal when it is in the worktree, else with a stand-in of it.
// No network: promo-banner.js runs in a vm over stubs of RevampAuth, RevampPromo and RevampPromoPosts; in K.8 its
// requests reach lib/promo-banner.js's handlers in this process, over in-memory Firestore and Storage.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');
const Module = require('module');
const sharp = require('sharp');

delete process.env.K_SERVICE;
delete process.env.TRACK_SECRET;

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'promo-banner.js'), 'utf8');
var passed = 0, failed = 0;
var realError = console.error.bind(console);
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; realError('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 20); i++) p = p.then(function () { return new Promise(function (ok) { setImmediate(ok); }); }); return p; }

var EV = 'qa-banner-client';
var FP1 = '0123456789abcdef0123456789abcdef', FP2 = 'fedcba9876543210fedcba9876543210';
var INPUTS = { v: 1, event: { name: 'Agentic AI Summit 2027', dateLabel: '12–13 March 2027', place: 'Jio World Centre, Mumbai' },
  brand: { mode: 'dark', heroImageUrl: 'https://img.etb2bimg.com/files/cp/hero.jpg', logoUnit: null } };

/* ---- the browser around promo-banner.js ---- */
function blob(size, tag) { return { size: size, type: 'image/jpeg', tag: tag || '' }; }
function response(status, json) {
  var t = json === undefined ? '' : typeof json === 'string' ? json : JSON.stringify(json);
  return { status: status, ok: status >= 200 && status < 300, text: function () { return Promise.resolve(t); } };
}
/* o.route(method, url, opts) -> Promise<response>; o.sizes: the blob sizes toPng hands back in turn */
function browser(o) {
  o = o || {};
  var log = { fetch: [], banner: [], toPng: [], done: 0, use: [], errors: [] };
  var sizes = (o.sizes || [800 * 1024]).slice();
  var ctx = {
    console: { error: function () { log.errors.push([].slice.call(arguments).map(String).join(' ')); }, log: function () {} },
    setTimeout: o.setTimeout || setTimeout, clearTimeout: o.clearTimeout || clearTimeout,
    RevampAuth: o.noAuth ? undefined : {
      authedFetch: function (url, opts) { log.fetch.push({ url: url, method: (opts && opts.method) || 'GET', body: opts && opts.body, type: opts && opts.headers && opts.headers['Content-Type'] }); return o.route(opts.method, url, opts); }
    },
    RevampPromo: o.noPromo ? undefined : {
      use: function (id) { log.use.push(id); },
      toPng: function (node, w, h, opts) {
        log.toPng.push({ node: node, w: w, h: h, opts: opts });
        if (o.toPngFails) return Promise.reject(new Error('stub: the picture maker failed'));
        var size = sizes.length > 1 ? sizes.shift() : sizes[0];
        return Promise.resolve(o.blobFor ? o.blobFor(h, opts) : blob(size, 'q' + opts.quality));
      }
    },
    RevampPromoPosts: o.noPosts ? undefined : {
      banner: function (inputs) {
        log.banner.push(inputs);
        if (o.bannerThrows) throw new Error('stub: the drawing threw');
        if (o.bannerEmpty) return Promise.resolve(null);
        if (o.bannerFails) return Promise.reject(new Error('stub: the drawing failed'));
        return Promise.resolve({ node: { id: 'banner-node-' + log.banner.length }, width: 750, height: o.height || 380, done: function () { log.done++; } });
      }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'promo-banner.js' });
  return { B: ctx.RevampPromoBanner, log: log, ctx: ctx };
}
/* a server with a script: each GET answers the next state, each POST the next upload answer */
function scripted(states, uploads) {
  states = states.slice(); uploads = (uploads || []).slice();
  return function (method, url) {
    if (method === 'GET') { var s = states.length > 1 ? states.shift() : states[0]; return s instanceof Error ? Promise.reject(s) : Promise.resolve(response(s.status || 200, s.json || s)); }
    var u = uploads.length > 1 ? uploads.shift() : uploads[0];
    return Promise.resolve(response(u.status, u.json));
  };
}
var STALE = { needed: true, fresh: false, fingerprint: FP1, url: null, inputs: INPUTS };

async function main() {
  var b, r, p1, p2;

  /* ======== K.5 ======== */
  b = browser({ route: scripted([{ needed: false, fresh: false, fingerprint: FP1, url: null, inputs: INPUTS }]) });
  r = await b.B.ensure(EV);
  check('K.5 needed:false -> { ok, none }, nothing drawn, nothing uploaded', r.ok === true && r.none === true && b.log.banner.length === 0 && b.log.toPng.length === 0 &&
    b.log.fetch.length === 1 && b.log.fetch[0].url === '/api/promo/mailer/banner?eventId=' + EV && b.log.fetch[0].method === 'GET', [r, b.log.fetch]);

  b = browser({ route: scripted([{ needed: true, fresh: true, fingerprint: FP1, url: 'https://storage.googleapis.com/b/events/x/promo-banner/a.jpg', inputs: INPUTS }]) });
  r = await b.B.ensure(EV);
  check('K.5 fresh -> { ok, url }, nothing drawn, nothing uploaded', r.ok === true && r.url === 'https://storage.googleapis.com/b/events/x/promo-banner/a.jpg' && !r.none &&
    b.log.banner.length === 0 && b.log.fetch.length === 1, r);

  var NEW = 'https://storage.googleapis.com/b/events/' + EV + '/promo-banner/new.jpg';
  b = browser({ route: scripted([STALE], [{ status: 200, json: { ok: true, url: NEW, fingerprint: FP1, width: 1500, height: 760 } }]) });
  r = await b.B.ensure(EV);
  var post = b.log.fetch[1] || {}, shot = b.log.toPng[0] || {};
  check('K.5 stale -> drawn from the server\'s inputs', b.log.banner.length === 1 && JSON.stringify(b.log.banner[0]) === JSON.stringify(INPUTS));
  check('K.5 stale -> made a JPEG at pixelRatio 2, 750 wide, the drawing\'s height, quality 0.86', b.log.toPng.length === 1 && shot.node.id === 'banner-node-1' && shot.w === 750 && shot.h === 380 &&
    shot.opts.pixelRatio === 2 && shot.opts.type === 'image/jpeg' && shot.opts.quality === 0.86, shot);
  check('K.5 stale -> uploaded raw with the fingerprint it was drawn from', b.log.fetch.length === 2 && post.method === 'POST' &&
    post.url === '/api/promo/mailer/banner?eventId=' + EV + '&fingerprint=' + FP1 && post.body && post.body.tag === 'q0.86' && post.type === 'image/jpeg', post);
  check('K.5 stale -> { ok, url } of the new banner', r.ok === true && r.url === NEW, r);
  check('K.5 the drawing\'s off-screen node is removed', b.log.done === 1);
  check('K.5 the drawing\'s pictures are fetched for this event', b.log.use.length === 1 && b.log.use[0] === EV);
  var bb = browser({ route: scripted([{ needed: false }]) });
  await bb.B.ensure('a b&c');
  check('K.5 the event id is sent encoded', bb.log.fetch[0].url === '/api/promo/mailer/banner?eventId=a%20b%26c', bb.log.fetch[0].url);

  /* banner-moved: one more round, from the new inputs */
  var MOVED = { status: 409, json: { error: 'moved', code: 'banner-moved' } };
  var INPUTS2 = clone(INPUTS); INPUTS2.event.place = 'NESCO, Mumbai';
  b = browser({ route: scripted([STALE, { needed: true, fresh: false, fingerprint: FP2, url: null, inputs: INPUTS2 }], [MOVED, { status: 200, json: { ok: true, url: NEW } }]) });
  r = await b.B.ensure(EV);
  var gets = b.log.fetch.filter(function (f) { return f.method === 'GET'; }), posts = b.log.fetch.filter(function (f) { return f.method === 'POST'; });
  check('K.5 banner-moved -> asked again, drawn again from the new inputs, uploaded with the new fingerprint', r.ok === true && r.url === NEW && gets.length === 2 && posts.length === 2 &&
    b.log.banner.length === 2 && b.log.banner[1].event.place === 'NESCO, Mumbai' && /&fingerprint=fedcba9876543210fedcba9876543210$/.test(posts[1].url) && b.log.done === 2, [r, b.log.fetch.length]);
  b = browser({ route: scripted([STALE], [MOVED]) });
  r = await b.B.ensure(EV);
  check('K.5 banner-moved twice -> { ok:false } after exactly one more round', r.ok === false && b.log.fetch.filter(function (f) { return f.method === 'POST'; }).length === 2 && /moved/.test(r.error), r);
  b = browser({ route: scripted([STALE, { needed: true, fresh: true, fingerprint: FP2, url: NEW, inputs: INPUTS2 }], [MOVED]) });
  r = await b.B.ensure(EV);
  check('K.5 banner-moved, then someone else\'s banner is fresh -> { ok, url } with no second drawing', r.ok === true && r.url === NEW && b.log.banner.length === 1, r);

  /* a failure resolves { ok:false } and never rejects */
  var failures = {
    'the state answers 500': { route: scripted([{ status: 500, json: { error: 'Something went wrong.' } }]), want: /Something went wrong/ },
    'the state cannot be reached': { route: scripted([new Error('Failed to fetch')]), want: /Failed to fetch/ },
    'the state is not JSON': { route: function () { return Promise.resolve(response(502, '<html>bad gateway</html>')); }, want: /502/ },
    'the state has no fingerprint': { route: scripted([{ needed: true, fresh: false, fingerprint: 'x', inputs: INPUTS }]), want: /did not say/ },
    'the drawing fails': { route: scripted([STALE]), bannerFails: true, want: /drawing failed/ },
    'the drawing throws': { route: scripted([STALE]), bannerFails: true, bannerThrows: true, want: /drawing threw/ },
    'the drawing gives nothing': { route: scripted([STALE]), bannerFails: true, bannerEmpty: true, want: /could not be drawn/ },
    'the drawing has no height': { route: scripted([STALE]), height: -1, want: /could not be drawn/ },
    'the picture maker fails': { route: scripted([STALE]), toPngFails: true, want: /picture maker failed/ },
    'the drawing is not loaded': { route: scripted([STALE]), noPosts: true, want: /did not load/ },
    'the picture maker is not loaded': { route: scripted([STALE]), noPromo: true, want: /did not load/ },
    'sign-in is not loaded': { route: scripted([STALE]), noAuth: true, want: /./ },
    'the upload is refused': { route: scripted([STALE], [{ status: 400, json: { error: 'The mail banner must be a JPEG picture.' } }]), want: /must be a JPEG/ },
    'the upload answers without a url': { route: scripted([STALE], [{ status: 200, json: { ok: true } }]), want: /200/ },
    'the upload is too large': { route: scripted([STALE], [{ status: 413, json: { error: 'That upload is too large.' } }]), want: /too large/ }
  };
  for (var what in failures) {
    var f = failures[what];
    b = browser(f);
    var settled = await b.B.ensure(EV).then(function (v) { return { v: v }; }, function (e) { return { rejected: String(e) }; });
    check('K.5 ' + what + ' -> { ok:false, error }, never a rejection, the cause logged', !settled.rejected && settled.v.ok === false && f.want.test(settled.v.error) &&
      b.log.errors.some(function (l) { return /promo-banner: the mail banner was not made/.test(l); }), settled);
    if (b.log.banner.length && !f.bannerFails) check('K.5 ' + what + ': the drawing\'s node is still removed', b.log.done === b.log.banner.length, b.log.done);
  }
  b = browser({ route: scripted([STALE]) });
  r = await b.B.ensure('  ');
  check('K.5 no event -> { ok:false }, nothing asked', r.ok === false && b.log.fetch.length === 0, r);

  /* one promise per page, a new one only for fresh */
  b = browser({ route: scripted([{ needed: false }]) });
  p1 = b.B.ensure(EV); p2 = b.B.ensure(EV);
  check('K.5 a second ensure() gets the first one\'s promise', p1 === p2);
  await p1;
  check('K.5 … and the server is asked once', b.log.fetch.length === 1, b.log.fetch.length);
  check('K.5 still the same promise once it has settled', b.B.ensure(EV) === p1);
  var p3 = b.B.ensure(EV, { fresh: true });
  check('K.5 fresh -> a new promise', p3 !== p1);
  await p3;
  check('K.5 fresh -> the server is asked again', b.log.fetch.length === 2, b.log.fetch.length);
  check('K.5 after a fresh one, a plain ensure() gets the fresh one', b.B.ensure(EV) === p3 && b.B.ensure(EV, {}) === p3 && b.B.ensure(EV, { fresh: false }) === p3);
  check('K.5 another event is its own run', b.B.ensure('qa-other') !== p3);
  b = browser({ route: scripted([STALE], [{ status: 500, json: { error: 'down' } }]) });
  r = await b.B.ensure(EV);
  check('K.5 a failed run is kept for plain calls (the studio asks fresh after the server says stale)', r.ok === false && b.B.ensure(EV) === b.B.ensure(EV) && b.log.fetch.length === 2);

  /* a run that hangs answers { ok:false } at its time limit */
  var timers = [];
  b = browser({ route: function () { return new Promise(function () {}); },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }, clearTimeout: function () {} });
  var hung = b.B.ensure(EV), hungResult = null;
  hung.then(function (v) { hungResult = v; });
  await tick();
  check('K.5 a run has a time limit (60 s)', timers.length === 1 && timers[0].ms === 60000 && hungResult === null, timers);
  timers[0].fn();
  await tick();
  check('K.5 a run that hangs answers { ok:false } at its limit', hungResult && hungResult.ok === false && /too long/.test(hungResult.error), hungResult);

  /* ======== K.6 over 2 MiB -> once more at 0.78 ======== */
  var MiB2 = 2 * 1024 * 1024;
  b = browser({ route: scripted([STALE], [{ status: 200, json: { ok: true, url: NEW } }]), sizes: [MiB2 + 1, MiB2 - 10] });
  r = await b.B.ensure(EV);
  post = b.log.fetch.filter(function (x) { return x.method === 'POST'; })[0] || {};
  check('K.6 over 2 MiB -> made again once, at 0.78, and that one is uploaded', r.ok === true && b.log.toPng.length === 2 && b.log.toPng[0].opts.quality === 0.86 &&
    b.log.toPng[1].opts.quality === 0.78 && b.log.toPng[1].opts.pixelRatio === 2 && b.log.toPng[1].opts.type === 'image/jpeg' && post.body && post.body.tag === 'q0.78', [b.log.toPng.map(function (t) { return t.opts; }), post.body]);
  b = browser({ route: scripted([STALE], [{ status: 200, json: { ok: true, url: NEW } }]), sizes: [MiB2] });
  r = await b.B.ensure(EV);
  check('K.6 exactly 2 MiB is not made again', r.ok === true && b.log.toPng.length === 1);
  b = browser({ route: scripted([STALE], [{ status: 200, json: { ok: true, url: NEW } }]), sizes: [MiB2 + 1, MiB2 + 1] });
  r = await b.B.ensure(EV);
  check('K.6 still over 2 MiB at 0.78 -> { ok:false }, nothing uploaded, made only twice', r.ok === false && /larger than 2 MB/.test(r.error) && b.log.toPng.length === 2 &&
    !b.log.fetch.some(function (x) { return x.method === 'POST'; }) && b.log.done === 1, r);

  /* ======== K.7 ES5, and served ======== */
  var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  check('K.7 no let', !/\blet\s/.test(code));
  check('K.7 no const', !/\bconst\s/.test(code));
  check('K.7 no arrow functions', code.indexOf('=>') === -1);
  check('K.7 no async / await', !/\basync\b|\bawait\b/.test(code));
  check('K.7 no class', !/\bclass\s/.test(code));
  check('K.7 no template strings', code.indexOf('`') === -1);
  check('K.7 no spread or rest', code.indexOf('...') === -1);
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the regex checks above still run */ }
  if (esbuild) {
    var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('K.7 ES5 by esbuild (no destructuring, shorthand methods, let/const, classes or async)', es5 === true, es5);
  }
  check('K.7 parses', (function () { try { new vm.Script(SRC); return true; } catch (e) { return false; } })());
  check('K.7 one global, RevampPromoBanner, with ensure()', (function () {
    var bb = browser({ route: scripted([{ needed: false }]) });
    var own = Object.keys(bb.ctx).filter(function (k) { return ['console', 'setTimeout', 'clearTimeout', 'RevampAuth', 'RevampPromo', 'RevampPromoPosts', 'window'].indexOf(k) === -1; });
    return own.join() === 'RevampPromoBanner' && Object.keys(bb.B).join() === 'ensure';
  })());
  check('K.7 the page may load it (the server\'s list of files it sends)', require('./access').isServableFile('promo-banner.js') === true);

  /* ======== K.8 the download never ships a stale banner ======== */
  await k8();
}

/* ---------------------------------------------------------------------------------------------------------------
   K.8: Firestore and Storage in memory; lib/promo.js's Kit a stand-in we change; lib/promo-track.js off. With Unit
   N's promo-mailer.js (eventFor + withCurrentBanner) and Unit A's engine (bannerUrl) in the worktree the real
   POST /api/promo/mailer/download is used; until then a stand-in that follows the contract (§5i: stale -> 409
   'banner-stale', fresh -> the banner in the mail) checks this unit's half, and the lead reruns it at step 3. */
async function k8() {
  function httpError(status, message, extra) { var e = new Error(message); e.status = status; e.body = Object.assign({ error: message }, extra || {}); return e; }
  var BUCKET = 'revamp-qa.appspot.com', BASE = 'https://revamp.example';
  var KIT = {
    event: { id: EV, name: 'Agentic AI Summit 2027', category: 'ip', start: '2027-03-12', end: '2027-03-13', dateLabel: '12–13 March 2027', place: 'Jio World Centre, Mumbai',
      venue: 'Jio World Centre', city: 'Mumbai', description: 'Where CIOs put agents to work. 9th edition.', siteUrl: BASE + '/e/' + EV, registerUrl: BASE + '/e/' + EV + '#register',
      published: true, hashtag: '#AgenticAiSummit27', edition: '9th Edition', tagline: 'Agents at work' },
    brand: { mode: 'dark', colours: { theme: '#d71920', accent: '#f5a623', background: '#0d1017', text: '#f4f1ea' }, radius: '12px',
      fonts: { heading: { family: 'Fraunces', stack: "'Fraunces', serif", cssUrl: '' }, body: { family: 'Manrope', stack: "'Manrope', sans-serif", cssUrl: '' } },
      heroImageUrl: 'https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/generated/hero.jpg',
      logoUnit: { url: 'https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/generated/lu.png', darkUrl: 'https://storage.googleapis.com/' + BUCKET + '/events/' + EV + '/generated/lu-dark.png', width: 1200, height: 420, tone: 'light' },
      logoUnitParts: { before: 'Agentic', keyword: 'AI', after: 'Summit 2027' }, eventLogoUrl: '', pictures: [], portal: { slug: 'cio' } },
    content: { speakers: [{ id: 's1', name: 'Asha Rao', designation: 'CIO', company: 'Bharat Bank', photoUrl: '', group: 'Keynote' }], partners: [], sessions: [], audience: ['CIOs'], topics: ['Agents'], stats: [] }
  };

  /* lib/promo.js and lib/promo-track.js stand in (whatever loads them: this test, promo-banner.js, promo-mailer.js) */
  var PROMO = require.resolve('./promo');
  require.cache[PROMO] = { id: PROMO, filename: PROMO, loaded: true, children: [], paths: [], exports: {
    wire: function () {},
    buildKit: function (fb, eventId) {
      var d = DOCS['events/' + eventId];
      if (!d || !d.createdAt || d.deletedAt) return Promise.reject(httpError(404, 'No event found.'));
      return Promise.resolve(clone(KIT));
    },
    imageUrlProblem: function () { return ''; }
  } };
  var TRACK_STUB = path.join(__dirname, '__stub-promo-track.js'), realResolve = Module._resolveFilename;
  Module._resolveFilename = function (request) { if (request === './promo-track') return TRACK_STUB; return realResolve.apply(this, arguments); };
  require.cache[TRACK_STUB] = { id: TRACK_STUB, filename: TRACK_STUB, loaded: true, children: [], paths: [], exports: {
    wire: function () {}, availableFor: function () { return false; }, base: function () { return ''; }, recordSends: function () { return Promise.resolve(); }
  } };

  /* Firestore: documents by path; a collection lists its direct children; where('f', '==', v); transactions */
  var DOCS = {};
  function snap(p) { var d = DOCS[p]; return { id: p.split('/').pop(), exists: !!d, ref: ref(p), data: function () { return d ? clone(d) : undefined; } }; }
  function ref(p) {
    return { id: p.split('/').pop(), path: p,
      get: function () { return Promise.resolve(snap(p)); },
      set: function (v, o) { DOCS[p] = o && o.merge ? Object.assign(DOCS[p] || {}, clone(v)) : clone(v); return Promise.resolve(); },
      update: function (v) { DOCS[p] = Object.assign(DOCS[p] || {}, clone(v)); return Promise.resolve(); },
      delete: function () { delete DOCS[p]; return Promise.resolve(); },
      collection: function (n) { return col(p + '/' + n); } };
  }
  function col(p, filter) {
    function rows() {
      return Object.keys(DOCS).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; })
        .filter(function (k) { return !filter || DOCS[k][filter[0]] === filter[1]; });
    }
    var c = {
      doc: function (id) { return ref(p + '/' + id); },
      where: function (f, op, v) { return col(p, [f, v]); },
      orderBy: function () { return c; }, limit: function () { return c; },
      get: function () { var r = rows(); return Promise.resolve({ size: r.length, empty: !r.length, docs: r.map(snap) }); }
    };
    return c;
  }
  var FILES = {};
  var FB = {
    db: { collection: function (n) { return col(n); },
      runTransaction: function (fn) {
        var writes = [];
        var tx = { get: function (r) { return Promise.resolve(snap(r.path)); }, set: function (r, v) { writes.push([r.path, v]); return tx; },
          update: function (r, v) { writes.push([r.path, Object.assign({}, DOCS[r.path] || {}, v)]); return tx; } };
        return Promise.resolve(fn(tx)).then(function (out) { writes.forEach(function (w) { DOCS[w[0]] = clone(w[1]); }); return out; });
      } },
    bucket: { name: BUCKET, file: function (p) {
      return { name: p,
        save: function (b) { FILES[p] = { bytes: Buffer.from(b), public: false }; return Promise.resolve(); },
        makePublic: function () { FILES[p].public = true; return Promise.resolve(); },
        delete: function () { delete FILES[p]; return Promise.resolve(); } };
    } }
  };
  DOCS['events/' + EV] = { createdAt: '2026-10-01T00:00:00.000Z', name: KIT.event.name, category: 'ip' };

  var { sendJson } = require('./http');
  var DECODED = { email: 'maker@timesinternet.in', email_verified: true };
  var HELPERS = {
    BODY_LIMITS: { ai: 2 << 20, small: 256 << 10, tiny: 16 << 10 },
    withAdmin: function (req, res, cb) { cb(FB, DECODED); },
    withAdminBody: function (req, res, limit, cb) { cb(FB, DECODED, req.body); },
    eventIdOr400: function (res, v) { var s = typeof v === 'string' ? v.trim() : ''; if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(s)) { sendJson(res, 400, { error: 'Invalid eventId.' }); return ''; } return s; },
    loadLiveEvent: function (fb, id) { var d = DOCS['events/' + id]; return d && d.createdAt && !d.deletedAt ? Promise.resolve(clone(d)) : Promise.reject(httpError(404, 'No event found.')); },
    publicBaseFor: function () { return BASE; },
    sendFailure: function (res, what, err, friendly) { if (err && err.status && err.body) return sendJson(res, err.status, err.body); realError('k8 failure ' + what + ': ' + (err && err.stack || err)); sendJson(res, 500, { error: friendly }); },
    httpError: httpError,
    aiUsageRecorder: function () { return function () {}; },
    sendAiFailure: function (res) { sendJson(res, 500, { error: 'ai' }); },
    readObject: function () { return Promise.resolve(null); }, sitePath: function () { return ''; }, siteVersionOf: function () { return 0; }, googleFontUrl: function () { return ''; }
  };

  delete require.cache[require.resolve('./promo-banner')];
  var banner = require('./promo-banner');
  banner.wire(HELPERS);

  /* one request through a handler: a JSON body as req.body (withAdminBody), raw bytes as a stream */
  function call(handler, method, url, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var req = new EventEmitter();
      req.method = method; req.url = url; req.headers = { authorization: 'Bearer editor' }; req.body = o.json; req.resume = function () {};
      if (o.raw) req.headers['content-length'] = String(o.raw.length);
      var res = { status: 0, headers: {}, headersSent: false,
        setHeader: function (k, v) { res.headers[k] = v; },
        writeHead: function (s, h) { res.status = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
        end: function (b) {
          var text = Buffer.isBuffer(b) ? b.toString('utf8') : String(b == null ? '' : b), json = null;
          try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
          resolve({ status: res.status, headers: res.headers, text: text, json: json });
        } };
      handler(req, res);
      if (o.raw) setImmediate(function () { req.emit('data', o.raw); req.emit('end'); });
    });
  }

  /* the browser: the real client, its requests answered by the handlers above; the drawing a real JPEG */
  var drawn = 0;
  var client = browser({
    route: function (method, url, opts) {
      if (method === 'GET') return call(banner.handleBanner, 'GET', url).then(function (r) { return response(r.status, r.text); });
      return call(banner.handleBannerUpload, 'POST', url, { raw: opts.body.bytes }).then(function (r) { return response(r.status, r.text); });
    },
    blobFor: function (h, opts) { return { size: BYTES[drawn].length, type: opts.type, bytes: BYTES[drawn++] }; }
  });
  var BYTES = await Promise.all(['#203040', '#402030', '#304020'].map(function (c) {
    return sharp({ create: { width: 1500, height: 760, channels: 3, background: c } }).jpeg({ quality: 80 }).toBuffer();
  }));

  /* the mailer side: the real one when Units N and A are in, else the contract's stand-in */
  var mailer = null, why = '';
  try { mailer = require('./promo-mailer'); } catch (e) { why = 'lib/promo-mailer.js did not load here (' + String(e.message).split('\n')[0] + ')'; }
  var engine = require('./vendor/promo-engine');
  var hasN = !!(mailer && typeof mailer.eventFor === 'function' && mailer._internal && typeof mailer._internal.withCurrentBanner === 'function');
  var hasA = (function () {
    try {
      var ev = { name: 'x', keyVisualUrl: 'https://a.example/hero.jpg', bannerUrl: 'https://a.example/banner-probe.jpg', speakers: [], sponsorTiers: [], sessions: [], stats: [], whoShouldAttend: [], keyPoints: [], whyJoin: [] };
      return engine.renderDoc(engine.buildDoc(engine.getMailer('mailer.announcement'), ev, {}), ev).indexOf('banner-probe.jpg') !== -1;
    } catch (e) { return false; }
  })();
  if (!hasN) why = why || 'lib/promo-mailer.js has no eventFor / _internal.withCurrentBanner yet (Unit N)';
  else if (!hasA) why = 'the engine does not put bannerUrl in the mail yet (Unit A\'s rebuild)';
  var real = hasN && hasA;

  function download(body) {
    if (real) return call(mailer.handleDownload, 'POST', '/api/promo/mailer/download', { json: Object.assign({ eventId: EV }, body) });
    /* the stand-in: §5i's rule for /download, on this module's stateFor */
    return require('./promo').buildKit(FB, EV).then(function (kit) {
      return banner.stateFor(FB, EV, kit).then(function (st) {
        if (st.needed && !st.fresh) return { status: 409, json: { error: 'The mail\'s top banner is out of date and is being drawn again. Try again in a moment.', code: 'banner-stale' }, text: '' };
        return { status: 200, json: null, text: '<html><body><img src="' + (st.fresh ? st.url : kit.brand.heroImageUrl) + '" alt=""></body></html>' };
      });
    });
  }
  if (real) mailer.wire(HELPERS);

  var ONE = { mailerIds: ['mailer.announcement'] };
  var d0 = await download(ONE);
  check('K.8 no banner yet: the download is refused, 409 banner-stale', d0.status === 409 && d0.json && d0.json.code === 'banner-stale', [d0.status, d0.json]);
  var e1 = await client.B.ensure(EV);
  var U1 = e1.url;
  check('K.8 the client draws and uploads the banner', e1.ok === true && typeof U1 === 'string' && banner.isBannerUrl(U1, BUCKET, EV) && drawn === 1, e1);
  var d1 = await download(ONE);
  check('K.8 then the download goes out, with the banner in it', d1.status === 200 && d1.text.indexOf(U1) !== -1, [d1.status, d1.json]);

  /* a version saved now holds this banner */
  var SAVED_ID = 'sk8save1';
  if (real) {
    var savedDoc = engine.buildDoc(engine.getMailer('mailer.announcement'), (await mailer.eventFor(FB, EV, { headers: {} })).ev, {});
    DOCS['events/' + EV + '/mailerSaves/' + SAVED_ID] = { mailerId: 'mailer.announcement', name: 'Launch', subject: savedDoc.subject || 's', doc: JSON.stringify(savedDoc), savedAt: Date.now(), createdAt: new Date().toISOString() };
    check('K.8 the saved version holds the first banner', DOCS['events/' + EV + '/mailerSaves/' + SAVED_ID].doc.indexOf(U1) !== -1);
  }

  /* the date changes */
  KIT.event.dateLabel = '19–20 March 2027'; KIT.event.start = '2027-03-19'; KIT.event.end = '2027-03-20';
  var d2 = await download(ONE);
  check('K.8 the date changed: the download is refused, 409 banner-stale', d2.status === 409 && d2.json && d2.json.code === 'banner-stale', [d2.status, d2.json]);
  var plain = await client.B.ensure(EV);
  check('K.8 a plain ensure() is the page\'s first run (no second drawing)', plain === e1 && drawn === 1);
  var e2 = await client.B.ensure(EV, { fresh: true });
  var U2 = e2.url;
  check('K.8 asked fresh, the client draws and uploads the new banner', e2.ok === true && drawn === 2 && typeof U2 === 'string' && U2 !== U1 && banner.isBannerUrl(U2, BUCKET, EV), e2);
  var d3 = await download(ONE);
  check('K.8 the download goes out with the new banner, and not the old', d3.status === 200 && d3.text.indexOf(U2) !== -1 && d3.text.indexOf(U1) === -1, [d3.status, d3.json]);
  check('K.8 the old banner object is kept (a sent mail points at it)', !!FILES[U1.replace('https://storage.googleapis.com/' + BUCKET + '/', '')]);
  if (real) {
    var dz = await download({ mailerIds: [] });
    /* JSZip stores the mails uncompressed by default, so their HTML reads as plain text inside the ZIP */
    check('K.8 the ZIP of every mailer carries the new banner and no stale one', dz.status === 200 && dz.text.indexOf(U2) !== -1 && dz.text.indexOf(U1) === -1, dz.status);
    var dd = await download({ doc: JSON.parse(DOCS['events/' + EV + '/mailerSaves/' + SAVED_ID].doc), saveId: SAVED_ID, saveName: 'Launch' });
    check('K.8 the saved version, downloaded, carries the new banner and not the old', dd.status === 200 && dd.text.indexOf(U2) !== -1 && dd.text.indexOf(U1) === -1, dd.status);
  }
  console.log('promo-banner-client: K.8 ran ' + (real ? 'on lib/promo-mailer.js (Unit N) and the rebuilt engine (Unit A)' : 'on a stand-in of lib/promo-mailer.js — ' + why + '; the lead reruns it at step 3'));
  Module._resolveFilename = realResolve;
}

main().then(function () {
  console.log('promo-banner-client: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (err) {
  realError('promo-banner-client test crashed: ' + (err && err.stack || err));
  process.exit(1);
});
