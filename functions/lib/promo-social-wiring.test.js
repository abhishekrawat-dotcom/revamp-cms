/* node functions/lib/promo-social-wiring.test.js — how Promotions phase 3's routes reach their modules, and the
   two rules lib/api.js and lib/api-events.js keep for them:
     1. the 14 routes of lib/promo-social.js (Social posts), lib/promo-previews.js (the live previews on the
        Mailers cards) and lib/promo-banner.js (the mailers' top banner) each reach their handler through
        api.handleApi, with the query intact, after the module (and lib/promo.js and lib/promo-mailer.js, which
        they read the event through) has been handed the helpers;
     2. a module that cannot be loaded costs only its own routes a JSON 503, and a fresh instance whose first
        Promotions request is a social route does not answer 500 (with lib/promo-social.js's real wire() too,
        once that file exists);
     3. a new edition copies none of the posts' art, layouts or the mail banner, in Storage or in Firestore;
     4. a saved Site-look post (a promo-templates record: its `body` and every other free field) refuses example
        content and still takes a normal one.
   The three route modules, lib/promo.js and lib/promo-mailer.js are stubs for 1 and 2 (the route modules may
   not exist yet), and so is lib/promo-examples.js while it does not exist; Firebase is in memory throughout.
   No network. Exits 1 on any failure. */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
delete process.env.K_SERVICE;
delete process.env.PUBLIC_BASE_URL;

var ROOT = path.resolve(__dirname, '..', '..');
var passed = 0, failed = 0, notes = [];
var realError = console.error.bind(console), LOGS = [];
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; realError('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
/* a check that needs another unit's file: said once, rerun by the lead's integration step */
function skip(name, why) { notes.push('skipped: ' + name + ' (' + why + ')'); }
console.error = function () { LOGS.push([].slice.call(arguments).join(' ')); };
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function exists(name) { return fs.existsSync(path.join(__dirname, name + '.js')); }

/* ---------- Firestore and Storage in memory: what these routes ask of them ---------- */
var DOCS = {}, FILES = {}, COPIED = [], autoId = 0;
function snapOf(p) {
  var d = DOCS[p];
  return { id: p.split('/').pop(), exists: d !== undefined, ref: docRef(p), data: function () { return clone(d); } };
}
function docRef(p) {
  return {
    id: p.split('/').pop(), path: p,
    get: function () { return Promise.resolve(snapOf(p)); },
    set: function (d, o) { DOCS[p] = o && o.merge ? Object.assign(DOCS[p] || {}, clone(d)) : clone(d); return Promise.resolve(); },
    create: function (d) { if (DOCS[p] !== undefined) return Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })); DOCS[p] = clone(d); return Promise.resolve(); },
    update: function (d) {
      if (DOCS[p] === undefined) return Promise.reject(Object.assign(new Error('NOT_FOUND'), { code: 5 }));
      Object.assign(DOCS[p], clone(d));
      return Promise.resolve();
    },
    delete: function () { delete DOCS[p]; return Promise.resolve(); },
    collection: function (sub) { return colRef(p + '/' + sub, [], null); }
  };
}
function colRef(c, filters, lim) {
  function rows() {
    var depth = c.split('/').length + 1;
    var keys = Object.keys(DOCS).filter(function (k) {
      return k.indexOf(c + '/') === 0 && k.split('/').length === depth && filters.every(function (f) { return DOCS[k][f[0]] === f[1]; });
    }).sort();
    if (lim != null) keys = keys.slice(0, lim);
    return keys.map(snapOf);
  }
  return {
    id: c.split('/').pop(), path: c,
    doc: function (id) { return docRef(c + '/' + (id || 'auto' + (++autoId))); },
    add: function (d) { var r = docRef(c + '/auto' + (++autoId)); DOCS[r.path] = clone(d); return Promise.resolve(r); },
    where: function (f, op, v) { if (op !== '==') throw new Error('fake: only == here'); return colRef(c, filters.concat([[f, v]]), lim); },
    orderBy: function () { return colRef(c, filters, lim); },
    limit: function (n) { return colRef(c, filters, n); },
    select: function () { return colRef(c, filters, lim); },
    get: function () { var l = rows(); return Promise.resolve({ docs: l, size: l.length, empty: !l.length, forEach: function (fn) { l.forEach(fn); } }); }
  };
}
/* writes collected by a transaction or a batch land together when it commits */
function writer() {
  var ops = [], w = {
    set: function (r, d, o) { ops.push(function () { return r.set(d, o); }); return w; },
    create: function (r, d) { ops.push(function () { return r.create(d); }); return w; },
    update: function (r, d) { ops.push(function () { return r.update(d); }); return w; },
    delete: function (r) { ops.push(function () { return r.delete(); }); return w; },
    commit: function () { return ops.reduce(function (p, f) { return p.then(f); }, Promise.resolve()); }
  };
  return w;
}
function fileRef(name) {
  return {
    name: name, metadata: (FILES[name] || {}).metadata || {},
    save: function (buf, o) { FILES[name] = { data: Buffer.from(buf), metadata: clone((o && o.metadata) || {}) }; return Promise.resolve(); },
    makePublic: function () { if (FILES[name]) FILES[name].public = true; return Promise.resolve(); },
    delete: function () { if (!FILES[name]) return Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); delete FILES[name]; return Promise.resolve(); },
    copy: function (target) { FILES[target.name] = { data: FILES[name].data, metadata: clone(FILES[name].metadata) }; COPIED.push(name + ' -> ' + target.name); return Promise.resolve([target]); },
    download: function () { return Promise.resolve([FILES[name].data]); },
    exists: function () { return Promise.resolve([!!FILES[name]]); },
    getMetadata: function () { return FILES[name] ? Promise.resolve([FILES[name].metadata]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); }
  };
}
var FB = {
  db: {
    collection: function (name) { return colRef(name, [], null); },
    getAll: function () { return Promise.all([].slice.call(arguments).filter(function (r) { return r && r.path; }).map(function (r) { return r.get(); })); },
    runTransaction: function (fn) {
      var w = writer();
      var tx = { get: function (r) { return r.get(); }, set: w.set, create: w.create, update: w.update, delete: w.delete };
      return Promise.resolve().then(function () { return fn(tx); }).then(function (v) { return w.commit().then(function () { return v; }); });
    },
    batch: function () { return writer(); }
  },
  bucket: {
    name: 'test-bucket',
    file: fileRef,
    getFiles: function (o) { return Promise.resolve([Object.keys(FILES).filter(function (k) { return k.indexOf(o.prefix) === 0; }).sort().map(fileRef)]); },
    deleteFiles: function (o) { Object.keys(FILES).forEach(function (k) { if (k.indexOf(o.prefix) === 0) delete FILES[k]; }); return Promise.resolve(); }
  },
  /* a token is the account's name: "maker" signs in as maker@timesinternet.in with Google */
  auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };

/* ---------- the Promotions modules: a stub, the real file, or "cannot be loaded", per module ----------
   Resolved in place of ./<name> for requests made from this folder, so it works whether or not the file exists. */
var STUBBABLE = ['promo', 'promo-mailer', 'promo-social', 'promo-previews', 'promo-banner', 'promo-examples'];
var MODE = {}, STUBS = {}, resolved = {};
STUBBABLE.forEach(function (n) { MODE[n] = 'stub'; resolved[n] = 0; });
function stubPath(n) { return path.join(__dirname, '__stub-' + n + '.js'); }
var realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
  var m = /^\.\/(promo|promo-mailer|promo-social|promo-previews|promo-banner|promo-examples)(?:\.js)?$/.exec(request);
  if (m && parent && parent.filename && path.dirname(parent.filename) === __dirname) {
    var n = m[1];
    resolved[n]++;
    if (MODE[n] === 'fail') throw new Error('stub: lib/' + n + '.js cannot be loaded');
    if (MODE[n] === 'stub') return stubPath(n);
  }
  return realResolve.apply(this, arguments);
};
/* Node answers a require of "./x" from this folder straight from its cache once the real file has been loaded
   here, without asking the resolver again; so a module switched to a stub, or to "cannot be loaded", is first
   dropped from the cache. */
function setMode(n, mode) {
  MODE[n] = mode;
  if (mode !== 'real') delete require.cache[path.join(__dirname, n + '.js')];
}
function defaultModes() { STUBBABLE.forEach(function (x) { setMode(x, x === 'promo-examples' && EXAMPLES_REAL ? 'real' : 'stub'); }); }
function setStub(n, exportsObj) {
  STUBS[n] = exportsObj;
  require.cache[stubPath(n)] = { id: stubPath(n), filename: stubPath(n), loaded: true, children: [], paths: [], exports: exportsObj };
}

/* what each stub was asked, in order */
var calls = [];
function wiring(name) {
  return function (h) { STUBS[name].H = h; calls.push({ mod: name, fn: 'wire', helpers: h }); };
}
function routeStub(name, handlers) {
  var s = { H: null, _test: {} };
  setStub(name, s);
  s.wire = wiring(name);
  handlers.forEach(function (fn) {
    s[fn] = function (req, res) {
      calls.push({ mod: name, fn: fn, method: req.method, url: req.url });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Stub': name + '.' + fn });
      res.end(JSON.stringify({ stub: name + '.' + fn }));
    };
  });
  return s;
}

/* The 14 routes: method, path, a query like the browser's, the module, the handler. The social handler names
   are the ones lib/promo-social.js exports (§8a C9 leaves them to Unit C); X's and K's are fixed by the contract. */
var ROUTES14 = [
  ['GET', '/api/promo/social/catalog', '?eventId=demo-ev', 'promo-social', 'handleCatalog'],
  ['GET', '/api/promo/social/art', '?eventId=demo-ev', 'promo-social', 'handleArt'],
  ['POST', '/api/promo/social/art', '?eventId=demo-ev&slot=bg2&from=upload', 'promo-social', 'handleArtUpload'],
  ['POST', '/api/promo/social/art/psd', '', 'promo-social', 'handleArtPsd'],
  ['DELETE', '/api/promo/social/art', '?eventId=demo-ev&slot=logoUnit', 'promo-social', 'handleArtDelete'],
  ['POST', '/api/promo/social/html', '', 'promo-social', 'handleHtml'],
  ['GET', '/api/promo/social/layout', '?eventId=demo-ev&templateId=speaker.individual&format=ig_portrait&theme=light&bg=2', 'promo-social', 'handleLayout'],
  ['POST', '/api/promo/social/layout/base', '?eventId=demo-ev&key=speaker.individual__ig_portrait__light_bg2', 'promo-social', 'handleLayoutBase'],
  ['POST', '/api/promo/social/layout', '', 'promo-social', 'handleLayoutSave'],
  ['POST', '/api/promo/social/layout/reset', '', 'promo-social', 'handleLayoutReset'],
  ['POST', '/api/promo/social/picture', '?eventId=demo-ev', 'promo-social', 'handlePicture'],
  ['POST', '/api/promo/mailer/previews', '', 'promo-previews', 'handlePreviews'],
  ['GET', '/api/promo/mailer/banner', '?eventId=demo-ev', 'promo-banner', 'handleBanner'],
  ['POST', '/api/promo/mailer/banner', '?eventId=demo-ev&fingerprint=0123456789abcdef0123456789abcdef', 'promo-banner', 'handleBannerUpload']
];
function handlersOf(mod) { return ROUTES14.filter(function (r) { return r[3] === mod; }).map(function (r) { return r[4]; }); }
var ROUTE_MODULES = ['promo-social', 'promo-previews', 'promo-banner'];
function freshStubs() {
  calls = [];
  routeStub('promo', ['handleKit', 'handleImage', 'handleWrite']);
  routeStub('promo-mailer', ['handleCatalog']);
  ROUTE_MODULES.forEach(function (m) { routeStub(m, handlersOf(m)); });
}
freshStubs();

/* lib/promo-examples.js: the real one when it is there, else the contract's markers (§5h) */
var EXAMPLES_REAL = exists('promo-examples');
function markerIsExample(x) {
  var s = typeof x === 'string' ? x : JSON.stringify(x);
  if (typeof s !== 'string') return false;
  return s.indexOf('/assets/promo-examples/') !== -1 || /\\?"ex-[pls]\d/.test(s) || /<meta name=\\?"oneworld-example/.test(s);
}
setStub('promo-examples', { EXAMPLE_PATH: '/assets/promo-examples/', isExample: markerIsExample,
  fillFor: function (id, ev, params) { return { ev: ev, params: params, filled: [], state: '' }; },
  markMailHtml: function (h) { return h; }, markPostHtml: function (h) { return h; } });
if (EXAMPLES_REAL) setMode('promo-examples', 'real');
else skip('the real lib/promo-examples.js isExample in checkPromoBody', 'not written yet: the contract\'s markers stand in');

const access = require('./access');
const api = require('./api');

var CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
/* one request through api.handleApi, as server.js hands it over: { status, headers, text, json } */
function call(method, url, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var h = { host: 'cms.example', 'user-agent': CHROME };
    if (o.token) h.authorization = 'Bearer ' + o.token;
    if (o.body) h['content-type'] = 'application/json';
    var req = { method: method, url: url, headers: h, socket: {}, rawBody: Buffer.from(o.body ? JSON.stringify(o.body) : '') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k] = v; }, getHeader: function (k) { return res.headers[k]; },
      writeHead: function (s, hd) { res.statusCode = s; Object.assign(res.headers, hd || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) {
        var text = b === undefined ? '' : Buffer.isBuffer(b) ? b.toString('utf8') : String(b), json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text: text, json: json });
      }
    };
    api.handleApi(req, res);
  });
}
function trail() { return calls.map(function (c) { return c.mod + '.' + c.fn; }).join(','); }
var HELPER_NAMES = ['withAdmin', 'withAdminBody', 'eventIdOr400', 'loadLiveEvent', 'readObject', 'publicBaseFor', 'sendFailure', 'httpError'];
function isHelpers(h) {
  return !!h && HELPER_NAMES.every(function (k) { return typeof h[k] === 'function'; }) && !!h.BODY_LIMITS && typeof h.BODY_LIMITS.ai === 'number';
}

var api_src = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
var events_src = fs.readFileSync(path.join(__dirname, 'api-events.js'), 'utf8');

(async function () {
  ROUTE_MODULES.concat(['promo-examples']).forEach(function (m) {
    check('loading lib/api.js does not load lib/' + m + '.js (it is loaded on use, never at the top)', resolved[m] === 0, resolved[m]);
  });

  /* ---------- 1. each of the 14 routes reaches its handler, the modules wired first ---------- */
  var routed = [], re = /^\s*'((?:GET|POST|PUT|PATCH|DELETE) [^']+)':\s*(promoSocial|promoPreviews|promoBanner)\('([A-Za-z]+)'\),?\s*$/gm, mm;
  while ((mm = re.exec(api_src))) routed.push(mm[1] + ' -> ' + { promoSocial: 'promo-social', promoPreviews: 'promo-previews', promoBanner: 'promo-banner' }[mm[2]] + '.' + mm[3]);
  var want = ROUTES14.map(function (r) { return r[0] + ' ' + r[1] + ' -> ' + r[3] + '.' + r[4]; });
  check('lib/api.js routes exactly 14 Promotions phase 3 routes, each to the module and handler of the plan', routed.length === 14 &&
    routed.slice().sort().join('\n') === want.slice().sort().join('\n'), routed);
  check('the 14 phase 3 routes sit with the other Promotions routes, after DELETE /api/promo/icons and before the analytics',
    api_src.indexOf("'DELETE /api/promo/icons'") < api_src.indexOf("'GET /api/promo/social/catalog'") &&
    api_src.indexOf("'POST /api/promo/mailer/banner'") < api_src.indexOf("'GET /api/promo/analytics'"));

  for (var i = 0; i < ROUTES14.length; i++) {
    var r = ROUTES14[i], url = r[1] + r[2];
    freshStubs();
    var got = await call(r[0], url, { token: 'maker', body: r[0] === 'POST' && !r[2] ? { eventId: 'demo-ev' } : null });
    var label = r[0] + ' ' + r[1];
    check(label + ' reaches ' + r[3] + '.' + r[4] + ' with its query intact', got.status === 200 && got.headers['X-Stub'] === r[3] + '.' + r[4] &&
      calls.length === 4 && calls[3].fn === r[4] && calls[3].mod === r[3] && calls[3].url === url && calls[3].method === r[0], got.status + ' ' + trail());
    check(label + ': lib/promo.js, lib/promo-mailer.js and lib/' + r[3] + '.js are handed the helpers first, in that order',
      trail() === 'promo.wire,promo-mailer.wire,' + r[3] + '.wire,' + r[3] + '.' + r[4] && calls.slice(0, 3).every(function (c) { return isHelpers(c.helpers); }), trail());
    check(label + ': the same helpers object reaches all three', calls[0].helpers === calls[1].helpers && calls[1].helpers === calls[2].helpers);
    check(label + ' is not public: it is behind the sign-in gate', access.isPublic({ method: r[0], headers: {} }, r[1]) === false);
  }

  /* methods and paths that are not routes */
  var not = [['PUT', '/api/promo/social/art'], ['PATCH', '/api/promo/social/layout'], ['GET', '/api/promo/social/html'], ['DELETE', '/api/promo/social/layout'],
    ['GET', '/api/promo/mailer/previews'], ['DELETE', '/api/promo/mailer/banner'], ['GET', '/api/promo/social/picture'], ['GET', '/api/promo/social/catalog/'],
    ['GET', '/api/promo/social'], ['POST', '/api/promo/social/art/psd/x'], ['GET', '/api/promo/social/Catalog']];
  freshStubs();
  for (var n = 0; n < not.length; n++) {
    var nr = await call(not[n][0], not[n][1] + '?eventId=demo-ev', { token: 'maker' });
    check(not[n][0] + ' ' + not[n][1] + ' is no route (404)', nr.status === 404 && /No such endpoint/.test(nr.text), nr.status + ' ' + nr.text);
  }
  check('none of those reached or wired a Promotions module', calls.length === 0, trail());

  /* ---------- 2. a module that cannot be loaded, and a fresh instance ---------- */
  for (var k = 0; k < ROUTE_MODULES.length; k++) {
    var mod = ROUTE_MODULES[k];
    freshStubs(); LOGS = []; setMode(mod, 'fail');
    var own = ROUTES14.filter(function (x) { return x[3] === mod; });
    for (var j = 0; j < own.length; j++) {
      var f = await call(own[j][0], own[j][1] + own[j][2], { token: 'maker' });
      check('lib/' + mod + '.js cannot be loaded: ' + own[j][0] + ' ' + own[j][1] + ' answers the JSON 503 module-unavailable',
        f.status === 503 && f.json && f.json.code === 'module-unavailable' && /not available right now/.test(f.json.error) && f.headers['Cache-Control'] === 'no-store', f.status + ' ' + f.text);
    }
    check('lib/' + mod + '.js cannot be loaded: it is logged, by name, for each request', LOGS.filter(function (l) {
      return l.indexOf('api: could not load lib/' + mod + '.js for ') === 0;
    }).length === own.length, LOGS);
    var other = ROUTES14.filter(function (x) { return x[3] !== mod; })[0];
    var o = await call(other[0], other[1] + other[2], { token: 'maker' });
    check('lib/' + mod + '.js cannot be loaded: ' + other[0] + ' ' + other[1] + ' (another module) still works', o.status === 200 && o.headers['X-Stub'] === other[3] + '.' + other[4], o.status);
    setMode(mod, 'stub');
    freshStubs();
    var back = await call(own[0][0], own[0][1] + own[0][2], { token: 'maker' });
    check('lib/' + mod + '.js loads again: the next request reaches it (a failed require is not cached)', back.status === 200 && back.headers['X-Stub'] === mod + '.' + own[0][4], back.status);
  }

  /* a module that loads but lacks the handler: the same 503, logged */
  freshStubs(); LOGS = [];
  delete STUBS['promo-social'].handleHtml;
  var lack = await call('POST', '/api/promo/social/html', { token: 'maker', body: { eventId: 'demo-ev', items: [] } });
  check('lib/promo-social.js without handleHtml(): POST /api/promo/social/html answers 503 module-unavailable and logs it',
    lack.status === 503 && lack.json.code === 'module-unavailable' && LOGS.some(function (l) { return /lib\/promo-social\.js has no handleHtml\(\)/.test(l); }), lack.status + ' ' + JSON.stringify(LOGS));

  /* lib/promo-mailer.js or lib/promo.js cannot be loaded: wiring them is not this route's failure; the route
     module (which needs them) is what answers. Here the stub route module does not need them, so it answers. */
  ['promo-mailer', 'promo'].forEach(function (dep) { setMode(dep, 'fail'); });
  freshStubs(); LOGS = [];
  var dep = await call('GET', '/api/promo/mailer/banner?eventId=demo-ev', { token: 'maker' });
  check('lib/promo.js and lib/promo-mailer.js cannot be loaded: the banner route still reaches its own module, wired',
    dep.status === 200 && dep.headers['X-Stub'] === 'promo-banner.handleBanner' && trail() === 'promo-banner.wire,promo-banner.handleBanner', dep.status + ' ' + trail());
  ['promo-mailer', 'promo'].forEach(function (dep2) { setMode(dep2, 'stub'); });

  /* A fresh instance: nothing has been wired yet (every module's helpers are null) and the first Promotions
     request is GET /api/promo/social/catalog. The stub handler does what the real one does first: it signs the
     caller in through its own helpers, then reads the event through lib/promo-mailer.js's (eventFor uses
     H.publicBaseFor). Unwired, that throws and withAdmin answers 500, which is the failure this wiring prevents. */
  freshStubs(); LOGS = [];
  function coldCatalog(req, res) {
    var me = STUBS['promo-social'];
    me.H.withAdmin(req, res, function () {
      var base = STUBS['promo-mailer'].H.publicBaseFor(req);
      var kitBase = STUBS.promo.H.publicBaseFor(req);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ base: base, kitBase: kitBase }));
    });
  }
  STUBS['promo-social'].handleCatalog = coldCatalog;
  check('a fresh instance starts with lib/promo.js, lib/promo-mailer.js and lib/promo-social.js unwired', STUBS.promo.H === null && STUBS['promo-mailer'].H === null && STUBS['promo-social'].H === null);
  var cold = await call('GET', '/api/promo/social/catalog?eventId=demo-ev', { token: 'maker' });
  check('a fresh instance: the first request, GET /api/promo/social/catalog, is not a 500 and reads the event through lib/promo-mailer.js',
    cold.status === 200 && cold.json && cold.json.base === 'https://cms.example' && cold.json.kitBase === 'https://cms.example', cold.status + ' ' + cold.text + ' ' + JSON.stringify(LOGS));
  /* the same handler on an unwired lib/promo-mailer.js answers 500: the check above can fail */
  STUBS['promo-mailer'].H = null;
  var unwired = await new Promise(function (resolve) {
    var res = { headersSent: false, writeHead: function (s) { res.status = s; res.headersSent = true; return res; }, setHeader: function () {}, end: function () { resolve(res.status); } };
    coldCatalog({ method: 'GET', url: '/api/promo/social/catalog?eventId=demo-ev', headers: { host: 'cms.example', authorization: 'Bearer maker' }, socket: {} }, res);
  });
  check('(the same handler with lib/promo-mailer.js unwired answers 500, so the check above means something)', unwired === 500, unwired);

  /* ---------- 4. a saved Site-look post refuses example content ---------- */
  freshStubs(); LOGS = [];
  DOCS['events/demo-ev'] = { name: 'Demo Summit 2027', createdAt: '2026-10-01T00:00:00.000Z' };
  function postBody(extra) {
    return JSON.stringify(Object.assign({ kind: 'speaker', network: 'linkedin', texts: { headline: 'Meet our speakers', kicker: 'Demo Summit 2027' },
      speakerIds: ['s1', 's2'], photo: 'https://img.etb2bimg.com/files/a.jpg' }, extra || {}));
  }
  function promoRecords() { return Object.keys(DOCS).filter(function (k) { return k.indexOf('events/demo-ev/promoTemplates/') === 0; }); }
  var good = await call('POST', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', kind: 'post', name: 'Speakers post', body: postBody() } });
  check('a normal post body is saved (200)', good.status === 200 && good.json && typeof good.json.id === 'string', good.status + ' ' + good.text);
  var savedPath = 'events/demo-ev/promoTemplates/' + (good.json && good.json.id);
  check('… with its body as sent', DOCS[savedPath] && DOCS[savedPath].body === postBody(), DOCS[savedPath]);
  var noBody = await call('POST', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', kind: 'email', name: 'No body yet' } });
  check('a record with no body at all is still saved', noBody.status === 200, noBody.status + ' ' + noBody.text);
  var before = promoRecords().length;
  var EXAMPLES = [
    ['an example person\'s picture (/assets/promo-examples/)', postBody({ photo: 'https://cms.example/assets/promo-examples/people/p01.jpg' })],
    ['an example person\'s id ("ex-p01")', postBody({ speakers: [{ id: 'ex-p01', name: 'Meera Kulkarni' }] })],
    ['an example logo\'s id ("ex-l03")', postBody({ partners: [{ id: 'ex-l03', name: 'Tarqen Systems' }] })],
    ['an example logo picture on a path (/assets/promo-examples/logos/)', postBody({ logos: ['/assets/promo-examples/logos/l02.png'] })],
    ['a pasted preview\'s marker (<meta name="oneworld-example">)', postBody({ html: '<meta name="oneworld-example" content="speakers"><p>Meet our speakers</p>' })]
  ];
  for (var e = 0; e < EXAMPLES.length; e++) {
    var bad = await call('POST', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', kind: 'post', name: 'Copied preview', body: EXAMPLES[e][1] } });
    check('a post body holding ' + EXAMPLES[e][0] + ' is refused: 400 with the sentence and the field', bad.status === 400 && bad.json &&
      bad.json.error === '"body" holds example content, which can never be saved.' && bad.json.field === 'body', bad.status + ' ' + bad.text);
  }
  check('… and none of them was written', promoRecords().length === before, promoRecords());
  var upd = await call('PATCH', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', id: good.json.id, body: EXAMPLES[1][1] } });
  check('changing a saved post\'s body to example content is refused too (400), and the stored body is unchanged',
    upd.status === 400 && /holds example content, which can never be saved\./.test(upd.text) && DOCS[savedPath].body === postBody(), upd.status + ' ' + upd.text);
  var upd2 = await call('PATCH', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', id: good.json.id, body: postBody({ texts: { headline: 'Meet the jury' } }) } });
  check('changing it to another normal body is saved', upd2.status === 200 && JSON.parse(DOCS[savedPath].body).texts.headline === 'Meet the jury', upd2.status + ' ' + upd2.text);
  var long = await call('POST', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', kind: 'post', name: 'Long', body: new Array(60002).join('x') } });
  check('the length rule still comes first: a 60,001-character body is "too long"', long.status === 400 && long.json && long.json.error === '"body" is too long (the limit is 60000 characters).', long.status + ' ' + long.text);
  var notText = await call('POST', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', kind: 'post', name: 'Object', body: { photo: '/assets/promo-examples/people/p01.jpg' } } });
  check('a body that is not text is "must be text", as before', notText.status === 400 && notText.json && notText.json.error === '"body" must be text.', notText.status + ' ' + notText.text);

  /* every other free field is checked as the body is: the browser checks the whole record (promo-kit.js save),
     so a direct call with an example picture in imageUrl or an example id in name must not get past the server */
  var FULL = { eventId: 'demo-ev', kind: 'post', name: 'Index-p1 launch', subject: 'Meet our speakers', body: postBody(),
    imageUrl: 'https://img.etb2bimg.com/files/a.jpg', linkUrl: 'https://cms.example/e/demo-ev', placement: 'LinkedIn feed', size: '1200x1200', utmCampaign: 'speakers-2027' };
  var full = await call('POST', '/api/event/promo-templates', { token: 'maker', body: FULL });
  var fullPath = 'events/demo-ev/promoTemplates/' + (full.json && full.json.id);
  check('a normal record with every free field filled is saved (200), a name like "Index-p1 launch" included',
    full.status === 200 && DOCS[fullPath] && ['name', 'subject', 'imageUrl', 'linkUrl', 'placement', 'size', 'utmCampaign'].every(function (f) { return DOCS[fullPath][f] === FULL[f]; }), full.status + ' ' + full.text);
  var FIELD_EXAMPLES = [
    ['imageUrl', 'an example person\'s picture', 'https://cms.example/assets/promo-examples/people/p01.jpg'],
    ['imageUrl', 'an example logo on a path', '/assets/promo-examples/logos/l02.png'],
    ['linkUrl', 'an example picture\'s address', 'https://cms.example/assets/promo-examples/people/p02.jpg'],
    ['name', 'an example person\'s bare id', 'ex-p01'],
    ['name', 'an example logo\'s quoted id', 'Copy of "ex-l03"'],
    ['subject', 'a pasted preview\'s marker', 'Meet our speakers <meta name="oneworld-example">'],
    ['subject', 'an example session\'s bare id', 'ex-s1'],
    ['placement', 'an example picture\'s address', 'Hero /assets/promo-examples/people/p03.jpg'],
    ['size', 'an example id', 'ex-p02'],
    ['utmCampaign', 'an example id', 'ex-l01']
  ];
  var before3 = promoRecords().length;
  for (var fe = 0; fe < FIELD_EXAMPLES.length; fe++) {
    var fx = FIELD_EXAMPLES[fe], sent = Object.assign({}, FULL);
    sent[fx[0]] = fx[2];
    var badField = await call('POST', '/api/event/promo-templates', { token: 'maker', body: sent });
    check('a record whose ' + fx[0] + ' holds ' + fx[1] + ' is refused: 400 with the sentence and the field', badField.status === 400 && badField.json &&
      badField.json.error === '"' + fx[0] + '" holds example content, which can never be saved.' && badField.json.field === fx[0], badField.status + ' ' + badField.text);
  }
  check('… and none of them was written', promoRecords().length === before3, promoRecords());
  var updImage = await call('PATCH', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', id: full.json && full.json.id, imageUrl: FIELD_EXAMPLES[0][2] } });
  check('changing a saved record\'s imageUrl to an example picture is refused (400), and the stored one is unchanged',
    updImage.status === 400 && updImage.json && updImage.json.field === 'imageUrl' && DOCS[fullPath].imageUrl === FULL.imageUrl, updImage.status + ' ' + updImage.text);
  var updName = await call('PATCH', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', id: full.json && full.json.id, name: 'ex-p01' } });
  check('changing its name to an example id is refused (400), and the stored name is unchanged',
    updName.status === 400 && updName.json && updName.json.field === 'name' && DOCS[fullPath].name === FULL.name, updName.status + ' ' + updName.text);
  var badUrl = await call('POST', '/api/event/promo-templates', { token: 'maker', body: Object.assign({}, FULL, { imageUrl: 'javascript:alert(1)' }) });
  check('a field\'s own rule still comes first: a javascript: imageUrl is "not a valid web address"',
    badUrl.status === 400 && badUrl.json && badUrl.json.error === '"imageUrl" is not a valid web address.', badUrl.status + ' ' + badUrl.text);

  /* lib/promo-examples.js cannot be loaded: nothing is saved unchecked */
  setMode('promo-examples', 'fail'); LOGS = [];
  var before2 = promoRecords().length;
  var unchecked = await call('POST', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', kind: 'post', name: 'Unchecked', body: postBody() } });
  check('lib/promo-examples.js cannot be loaded: a new record is refused (400, try again), not saved unchecked',
    unchecked.status === 400 && unchecked.json && / could not be checked just now\. Please try again in a few minutes\.$/.test(unchecked.json.error) && promoRecords().length === before2, unchecked.status + ' ' + unchecked.text);
  check('… and that is logged', LOGS.some(function (l) { return l.indexOf('api: could not load lib/promo-examples.js to check a saved promotion') === 0; }), LOGS);
  var noBodyDown = await call('POST', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', kind: 'email', name: 'Still no body' } });
  check('… a record without a body too, since its name cannot be checked either (400 on "name"), and nothing is written',
    noBodyDown.status === 400 && noBodyDown.json && noBodyDown.json.field === 'name' &&
    noBodyDown.json.error === '"name" could not be checked just now. Please try again in a few minutes.' && promoRecords().length === before2, noBodyDown.status + ' ' + noBodyDown.text);
  var clearDown = await call('PATCH', '/api/event/promo-templates', { token: 'maker', body: { eventId: 'demo-ev', id: full.json && full.json.id, name: FULL.name, imageUrl: '' } });
  check('… while a change that sends the stored name back and clears imageUrl is saved: an empty value holds nothing',
    clearDown.status === 200 && DOCS[fullPath].imageUrl === '' && DOCS[fullPath].name === FULL.name, clearDown.status + ' ' + clearDown.text);
  setMode('promo-examples', EXAMPLES_REAL ? 'real' : 'stub');
  var audience = await call('POST', '/api/event/promo-audiences', { token: 'maker', body: { eventId: 'demo-ev', name: 'Hospital CEOs', note: 'see /assets/promo-examples/' } });
  check('the example rule is the promotion templates\' only: a saved audience\'s note is not touched by it', audience.status === 200, audience.status + ' ' + audience.text);

  /* ---------- 3. a new edition copies none of it ---------- */
  var m1 = /var NOT_CLONED_FOLDERS = (\[[^\]]*\]);/.exec(events_src);
  var folders = m1 ? JSON.parse(m1[1].replace(/'/g, '"')) : null;
  check('NOT_CLONED_FOLDERS holds promo-art, promo-layouts and promo-banner, and still the three it had',
    !!folders && ['published', 'staging', 'briefs', 'promo-art', 'promo-layouts', 'promo-banner'].every(function (x) { return folders.indexOf(x) !== -1; }) && folders.length === 6, folders);
  var m2 = /var CLONED_COLLECTIONS = ([^;]+);/.exec(events_src);
  check('CLONED_COLLECTIONS is still the content lists, the promotion templates and the forms', !!m2 && m2[1] === 'CONTENT_COLLECTIONS.concat([PROMO_TEMPLATES, FORMS])', m2 && m2[1]);
  var shared = require('./api-events')._shared;
  check('none of promoSocial, promoSocialLayouts, promoBanner is a content list that is copied', ['promoSocial', 'promoSocialLayouts', 'promoBanner'].every(function (c) {
    return shared.CONTENT_COLLECTIONS.indexOf(c) === -1 && events_src.indexOf("'" + c + "'") === -1;
  }), shared.CONTENT_COLLECTIONS);

  /* the clone itself, on an event that has all of it */
  var SRC = 'src-ev', DST = 'dst-ev';
  DOCS['events/' + SRC] = { name: 'Source Summit 2026', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'maker@timesinternet.in', status: 'draft' };
  DOCS['events/' + SRC + '/speakers/s1'] = { name: 'Asha Rao', photoUrl: 'https://storage.googleapis.com/test-bucket/events/' + SRC + '/uploads/a.png' };
  DOCS['events/' + SRC + '/promoTemplates/t1'] = { kind: 'post', name: 'Speakers post', body: postBody(), status: 'posted' };
  DOCS['events/' + SRC + '/promoSocial/art'] = { logoUnit: { url: 'https://storage.googleapis.com/test-bucket/events/' + SRC + '/promo-art/logoUnit-x.png', from: 'upload' }, updatedAt: 1 };
  DOCS['events/' + SRC + '/promoSocialLayouts/speaker.individual__ig_portrait__light_bg2'] = { templateId: 'speaker.individual', elements: '[]' };
  DOCS['events/' + SRC + '/promoBanner/current'] = { fingerprint: '0123456789abcdef0123456789abcdef', url: 'https://storage.googleapis.com/test-bucket/events/' + SRC + '/promo-banner/b.jpg' };
  DOCS['events/' + SRC + '/mailerSaves/s1'] = { mailerId: 'announcement', doc: '{}' };
  ['uploads/a.png', 'promo-art/logoUnit-lq-0123456789abcdef.png', 'promo-art/picture-lq-0123456789abcdef.webp',
    'promo-layouts/speaker.individual__ig_portrait__light_bg2/lq-0123456789abcdef.png', 'promo-banner/0123456789abcdef-lq-0123456789abcdef.jpg',
    'briefs/brief.pdf'].forEach(function (p) { FILES['events/' + SRC + '/' + p] = { data: Buffer.from('x'), metadata: { contentType: 'image/png' } }; });
  COPIED = []; LOGS = [];
  var cl = await call('POST', '/api/event/clone', { token: 'maker', body: { sourceEventId: SRC, eventId: DST, name: 'Source Summit 2027' } });
  check('a new edition is made (200)', cl.status === 200 && cl.json && cl.json.eventId === DST, cl.status + ' ' + cl.text + ' ' + JSON.stringify(LOGS));
  var dstFiles = Object.keys(FILES).filter(function (k) { return k.indexOf('events/' + DST + '/') === 0; });
  check('the new edition gets the event\'s own uploads', dstFiles.indexOf('events/' + DST + '/uploads/a.png') !== -1, dstFiles);
  check('… and none of the posts\' art, uploaded pictures, saved layout bases or mail banners (Storage)', !dstFiles.some(function (k) {
    return /\/(promo-art|promo-layouts|promo-banner)\//.test(k);
  }) && dstFiles.length === 1, dstFiles);
  var dstDocs = Object.keys(DOCS).filter(function (k) { return k.indexOf('events/' + DST + '/') === 0; });
  check('the new edition gets its speakers and its promotion templates', dstDocs.indexOf('events/' + DST + '/speakers/s1') !== -1 && dstDocs.indexOf('events/' + DST + '/promoTemplates/t1') !== -1, dstDocs);
  check('… and none of the posts\' art record, saved layouts, banner record or saved mailers (Firestore)', !dstDocs.some(function (k) {
    return /\/(promoSocial|promoSocialLayouts|promoBanner|mailerSaves)\//.test(k);
  }), dstDocs);
  check('the original keeps all of it', ['promoSocial/art', 'promoBanner/current'].every(function (p) { return !!DOCS['events/' + SRC + '/' + p]; }) &&
    Object.keys(FILES).filter(function (k) { return k.indexOf('events/' + SRC + '/promo-') === 0; }).length === 4);

  /* ---------- the real modules, where they are written ---------- */
  /* each routed handler is one the module really exports (the social names are Unit C's to choose) */
  var helpersSeen = null;
  freshStubs();
  await call('GET', '/api/promo/mailer/banner?eventId=demo-ev', { token: 'maker' });
  helpersSeen = calls[0] && calls[0].helpers;
  ROUTE_MODULES.forEach(function (m) {
    if (!exists(m)) return skip('lib/' + m + '.js exports every routed handler', 'not written yet');
    var real = null;
    STUBBABLE.forEach(function (x) { if (exists(x)) setMode(x, 'real'); });
    try { real = require('./' + m); } catch (err) { skip('lib/' + m + '.js exports every routed handler', 'it does not load yet: ' + String(err && err.message).slice(0, 160)); }
    defaultModes();
    if (!real) return;
    var missing = ['wire'].concat(handlersOf(m)).filter(function (fn) { return typeof real[fn] !== 'function'; });
    check('lib/' + m + '.js exports wire() and every handler lib/api.js routes to it', missing.length === 0, missing);
    /* lib/promo-social.js also lists the routes it answers: the same table as lib/api.js's */
    if (real.ROUTES) {
      var theirs = Object.keys(real.ROUTES).map(function (key) { return key + ' -> ' + m + '.' + real.ROUTES[key]; }).sort().join('\n');
      var ours = ROUTES14.filter(function (x) { return x[3] === m; }).map(function (x) { return x[0] + ' ' + x[1] + ' -> ' + m + '.' + x[4]; }).sort().join('\n');
      check('lib/' + m + '.js\'s own ROUTES list is exactly what lib/api.js routes to it', theirs === ours, theirs);
    }
  });

  /* C's own wire(): on a fresh instance, lib/promo-social.js wires lib/promo-mailer.js, so the event can be read
     (correctness 4). lib/promo.js stays a stand-in: the real one reads the site's fonts and logo from the web. */
  var canReal = exists('promo-social') && exists('promo-mailer');
  if (!canReal) skip('GET /api/promo/social/catalog on a fresh instance with lib/promo-social.js\'s real wire()', 'lib/promo-social.js is not written yet');
  else {
    var KIT = {
      event: { id: 'demo-ev', name: 'Demo Summit 2027', start: '2027-09-10T09:00', end: '2027-09-11T18:00', venue: 'Shangri-La Eros', city: 'New Delhi',
        description: 'Hospital chiefs and clinicians meet on access and quality.', siteUrl: 'https://cms.example/e/demo-ev', registerUrl: 'https://cms.example/e/demo-ev#register',
        hashtag: '#DemoSummit27', published: true, dateLabel: '10–11 September 2027', place: 'Shangri-La Eros, New Delhi' },
      brand: { mode: 'light', colours: { theme: '#8f6118' }, portal: { slug: 'health' }, heroImageUrl: '', logoUnit: null },
      content: { speakers: [{ id: 's1', name: 'Asha Rao', designation: 'CEO', company: 'City Hospital', photoUrl: 'https://img.etb2bimg.com/files/a.jpg', group: 'Keynote' }],
        partners: [], sessions: [], audience: ['Hospital CEOs'], topics: ['Access'], stats: [] }
    };
    setStub('promo', { H: null, wire: wiring('promo'), buildKit: function () { return Promise.resolve(clone(KIT)); }, imageUrlProblem: function () { return ''; },
      handleKit: function () {}, handleImage: function () {}, handleWrite: function () {}, _test: {} });
    /* the other phase 3 modules the real ones need: real when written, else stand-ins with the contract's exports */
    if (!exists('promo-banner')) setStub('promo-banner', { H: null, wire: wiring('promo-banner'), BANNER_VERSION: 1,
      inputsOf: function () { return {}; }, fingerprintOf: function () { return ''; }, isBannerUrl: function () { return false; },
      stateFor: function () { return Promise.resolve({ needed: false, fingerprint: '', fresh: false, url: null }); },
      handleBanner: function () {}, handleBannerUpload: function () {} });
    var realPaths = ['promo-mailer', 'promo-social', 'promo-previews', 'promo-banner', 'promo-examples'].filter(exists).map(function (x) { return path.join(__dirname, x + '.js'); });
    function freshInstance() {
      realPaths.forEach(function (p) { delete require.cache[p]; });
      ['promo-mailer', 'promo-social', 'promo-previews', 'promo-banner', 'promo-examples'].forEach(function (x) { setMode(x, exists(x) ? 'real' : 'stub'); });
      setMode('promo', 'stub');
    }
    freshInstance();
    var social = null, mailer = null;
    try { social = require('./promo-social'); mailer = require('./promo-mailer'); }
    catch (err) { skip('lib/promo-social.js\'s real wire() on a fresh instance', 'it does not load yet: ' + String(err && err.message).slice(0, 160)); }
    if (social && typeof social.wire === 'function' && typeof mailer.eventFor === 'function' && isHelpers(helpersSeen)) {
      social.wire(helpersSeen);
      var evr = null, everr = null;
      try { evr = await mailer.eventFor(FB, 'demo-ev', { method: 'GET', url: '/', headers: { host: 'cms.example' }, socket: {} }); } catch (err) { everr = err; }
      check('lib/promo-social.js\'s own wire() wires lib/promo-mailer.js: on a fresh instance its eventFor reads the event',
        !everr && evr && evr.ev && evr.ev.name === 'Demo Summit 2027', String(everr && everr.stack || '').slice(0, 300));
    } else if (social) {
      skip('lib/promo-social.js\'s real wire() wiring lib/promo-mailer.js', 'lib/promo-mailer.js does not export eventFor yet (Unit N)');
    }
    if (social) {
      freshInstance(); LOGS = [];
      var first = await call('GET', '/api/promo/social/catalog?eventId=demo-ev', { token: 'maker' });
      check('a fresh instance with the real modules: the first request, GET /api/promo/social/catalog, is not a 500 (nor a 503): it answers 200 with this event\'s catalog',
        first.status === 200 && first.json && first.json.event && first.json.event.name === 'Demo Summit 2027', first.status + ' ' + first.text.slice(0, 300) + ' ' + JSON.stringify(LOGS).slice(0, 600));
    }
    defaultModes();
  }

  Module._resolveFilename = realResolve;
  console.error = realError;
  notes.forEach(function (s) { console.log('  ' + s); });
  console.log('promo-social-wiring: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) {
  console.error = realError;
  realError('FAIL the test itself threw — ' + (err && err.stack || err));
  process.exit(1);
});
