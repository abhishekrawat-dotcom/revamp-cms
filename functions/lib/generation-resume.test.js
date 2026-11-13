/* node functions/lib/generation-resume.test.js — the AI and generation routes' polish of the launch check (13 Nov 2026),
   through the real router (lib/api.js handleApi), an in-memory Firestore and Storage, and the model scripted (no AI call
   is made, nothing is paid for).
     BE-019  a throw inside a body callback (the stream's "end", or a body that came pre-buffered) is answered 500 with a ref
     BE-024  the AI and generation routes answer an owner's sentence and a code, a fault with a plain sentence and a ref,
             and log the cause; no "run /api/…" and no raw library text
     BE-030  each finished batch is kept with its run; a Retry with the same runId asks only for the sections not kept
     BE-033  GET /api/generate/status and POST /api/generate/cancel over the run's record; a cancelled run is never put on
             the event, and asks for nothing more; a run whose request ended (a reload) is finished from what it kept
     BE-039  the Design panel's buttons are buttons, not every link
     BE-065  a page read for the event under ten minutes ago is answered from that reading (cached: true; refresh: true
             reads it again) */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- an in-memory Firestore and Storage (as generation-runs.test.js) ---------- */
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
process.env.ACCESS_CONFIG_DOC = 'config/test-resume-access';

var gemini = require('./gemini');
gemini.callGeminiImage = function () { return Promise.resolve({ error: 'no pictures in this test' }); };
var FILLER = '<p>' + new Array(12).join('The summit brings together leaders from across the industry for a day of talks. ') + '</p>';
var PAGES = { 'https://ref.example.com/page': '<html><head><title>Ref</title></head><body><h1>REFERENCE PAGE</h1>' + FILLER + '</body></html>' };
var fetched = [];
var SAFE_FETCH = require.resolve('./safe-fetch');
require.cache[SAFE_FETCH] = { id: SAFE_FETCH, filename: SAFE_FETCH, loaded: true, children: [], paths: [],
  exports: Object.assign({}, require('./safe-fetch'), {
    safeFetch: function (url) {
      var u = String(url);
      fetched.push(u);
      if (PAGES[u]) return Promise.resolve({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(PAGES[u]), finalUrl: u });
      return Promise.reject(new Error('no network in this test: ' + u));
    }
  }) };
global.fetch = function (url) { fetched.push(String(url)); return Promise.reject(new Error('no network in this test: ' + url)); };

/* ---------- the model, scripted per route; every prompt kept ---------- */
var llm = require('./llm');
/* Claude's way of writing a site: two sections a call, the calls side by side (sectionCodeBatches) */
llm.activeProvider = function () { return 'claude'; };
var calls = [], prompts = [], scripted = {};
llm.callJson = function (prompt, schema, opts) {
  var route = (opts && opts.route) || '';
  calls.push(route); prompts.push({ route: route, prompt: String(prompt && prompt.text || prompt || '') });
  var next = scripted[route] && scripted[route].length ? scripted[route].shift() : null;
  if (typeof next === 'function') next = next(prompt);
  if (!next) return Promise.resolve({ error: 'No answer scripted for ' + route + '.', code: 'ai-unavailable', status: 502 });
  if (next.fail) return Promise.resolve(Object.assign({ error: 'The AI service could not take this request.' }, next.fail));
  return Promise.resolve({ parsed: clone(next), provider: 'claude', model: 'claude-stub' });
};

var http = require('./http');
var api = require('./api');
var H = api._testHooks;
var gs = require('./generated-site');

/* console.error, kept for the checks that the cause is logged (and still printed when a check fails) */
var logged = [];
var realError = console.error;
console.error = function () { logged.push(Array.prototype.join.call(arguments, ' ')); };

function fakeRes(resolve) {
  var res = { statusCode: 200, headers: {}, headersSent: false, writableEnded: false,
    setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
    writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
    write: function () { return true; },
    end: function (b) { res.writableEnded = true; var t = b === undefined ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: t }); } };
  return res;
}
function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'content-type': 'application/json' };
    if (who !== null) headers.authorization = 'Bearer ' + (who || 'asha');
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body === undefined ? '' : JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    api.handleApi(req, fakeRes(resolve));
  });
}
function under(prefix) { return Object.keys(FB.docs).filter(function (k) { return k.indexOf(prefix) === 0; }); }
function askedIds(p) { var m = /write ONLY these sections[^\[]*(\[[^\]]*\])/.exec(p.prompt); return m ? JSON.parse(m[1]) : null; }

/* ---------- the data ---------- */
var NOW = '2026-11-01T10:00:00.000Z';
FB.docs['config/test-resume-access'] = { defaultRole: 'editor', members: { 'vic@timesinternet.in': { role: 'viewer', portals: ['all'] } } };
['ev-gen', 'ev-plain', 'ev-src'].forEach(function (id) {
  FB.docs['events/' + id] = { name: 'Gen Summit', createdAt: NOW, createdBy: 'asha@timesinternet.in', portal: '', published: false,
    start: '2027-03-10', end: '2027-03-11', venue: 'Hall 1', city: 'Pune', description: '' };
});
var PLAN_IDS = ['agenda', 'venue', 'why-attend', 'faqs'];
function planAnswer(ids) {
  return { sections: ids.map(function (id) { return { id: id, kind: 'custom', purpose: 'The ' + id + ' of the event.', layout: 'a grid of cards', image: '' }; }),
    design: { mood: 'calm', themeColor: '#224466', accentColor: '#ee8833', headingFont: 'Inter', bodyFont: 'Inter', mode: 'light', heroTagline: 'Tagline', heroImage: 'a hall' },
    eventDescription: 'Gen Summit brings CIOs together in Pune.' };
}
function sectionAnswer(ids, tag) {
  return { positioningNotes: '', sections: ids.map(function (id) {
    return { id: id, html: '<section class="s-' + id + '"><h2>Heading of ' + id + '</h2><p>Words about ' + id + ' ' + (tag || '') + '.</p></section>',
      css: '.s-' + id + '{padding:3rem 1.5rem;display:grid;gap:1rem;background:var(--rv-surface)} .s-' + id + ' h2{font-size:2rem;margin:0}' };
  }) };
}
function runName(at, tail) { return 'run-' + Date.parse(at).toString(36) + '-' + tail; }
function plan(runId) {
  scripted['plan-structure'] = [planAnswer(PLAN_IDS)];
  return call('POST', '/api/plan-structure', { eventId: 'ev-gen', runId: runId, siteMode: 'advanced', eventMeta: { name: 'Gen Summit' } });
}
function written(runId) { return under('events/ev-gen/generations/' + runId + '/written/'); }

var steps = [];
function step(fn) { steps.push(fn); }

/* ================= BE-019: a throw inside a body callback is answered ================= */
step(function () {
  function viaRaw(cb) {
    return new Promise(function (resolve) {
      var req = { method: 'POST', url: '/api/x', headers: {}, rawBody: Buffer.from('{"a":1}') };
      http.readBody(req, fakeRes(resolve), cb);
    });
  }
  function viaStream(fn) {
    return new Promise(function (resolve) {
      var EventEmitter = require('events');
      var req = new EventEmitter(); req.method = 'POST'; req.url = '/api/y?secret=1'; req.headers = {}; req.resume = function () {};
      fn(req, fakeRes(resolve));
      req.emit('data', Buffer.from('{"a":'));
      req.emit('data', Buffer.from('1}'));
      req.emit('end');
    });
  }
  var n = logged.length;
  return Promise.all([
    viaRaw(function () { throw new Error('boom in the raw branch'); }),
    viaStream(function (req, res) { http.readBody(req, res, function () { throw new TypeError('boom in the end listener'); }); }),
    viaStream(function (req, res) { http.parseJsonBody(req, res, function (body) { return body.missing.field; }); })
  ]).then(function (r) {
    check('BE-019: a throw in the pre-buffered branch is answered 500 with a ref', r[0].status === 500 && /^[0-9a-f]{8}$/.test(r[0].body.ref) && /Something went wrong/.test(r[0].body.error) && !/boom/.test(r[0].text), r[0]);
    check('BE-019: …and in the stream\'s "end" listener', r[1].status === 500 && /^[0-9a-f]{8}$/.test(r[1].body.ref) && !/boom/.test(r[1].text), r[1]);
    check('BE-019: …and in a parsed body\'s handler', r[2].status === 500 && r[2].body.ref, r[2]);
    var lines = logged.slice(n).join('\n');
    check('BE-019: the cause is logged with the ref (the address without its query)', lines.indexOf(r[1].body.ref) !== -1 && /boom in the end listener/.test(lines) && lines.indexOf('secret=1') === -1, lines.slice(0, 400));
    var before = calls.length;
    return call('POST', '/api/suggest-design', { eventId: 'ev-gen', event: { name: 'Gen Summit' }, currentTemplate: { id: 'tech500' }, sections: [null] });
  }).then(function (r) {
    check('BE-019: POST /api/suggest-design {"sections":[null]} is answered (500 JSON with a ref), not left hanging', r.status === 500 && r.body && r.body.ref, r);
  });
});

/* ================= BE-024: owner sentences, codes, a ref for a fault ================= */
step(function () {
  return Promise.all([
    call('GET', '/api/generated-template?eventId=ev-plain'),
    call('GET', '/api/draft?eventId=ev-plain'),
    call('GET', '/api/imported-template?eventId=nothing-here'),
    call('GET', '/api/imported-section?eventId=nothing-here'),
    call('POST', '/api/generate-content', { eventId: 'ev-plain', templateId: 'gen-ev-plain' }),
    call('GET', '/api/generated-section?eventId=ev-plain&id=agenda')
  ]).then(function (r) {
    check('BE-024: a site not generated yet: 404 not-generated, in an owner\'s words', r[0].status === 404 && r[0].body.code === 'not-generated' && !/\/api\//.test(r[0].body.error), r[0].body);
    check('BE-024: …the draft too', r[1].status === 404 && r[1].body.code === 'not-generated' && !/\/api\//.test(r[1].body.error), r[1].body);
    check('BE-024: an import that is not there: 404 import-not-found (template and section)', r[2].status === 404 && r[2].body.code === 'import-not-found' && r[3].status === 404 && r[3].body.code === 'import-not-found' && !/\/api\//.test(r[2].body.error + r[3].body.error), [r[2].body, r[3].body]);
    check('BE-024: pages asked for before the design: 409 not-planned', r[4].status === 409 && r[4].body.code === 'not-planned' && !/\/api\//.test(r[4].body.error), r[4]);
    check('BE-024: a section that is not on the site: 404 not-generated', r[5].status === 404 && r[5].body.code === 'not-generated', r[5].body);
    /* a fault on our side: the raw text stays in the log */
    var realInputs = gs.inputs, realReadOne = gs.readOne, n = logged.length;
    gs.inputs = function () { return Promise.reject(new Error('9 FAILED_PRECONDITION: The query requires an index. projects/x/databases/(default)')); };
    gs.readOne = function () { return Promise.reject(new Error('14 UNAVAILABLE: firestore.googleapis.com')); };
    FB.docs['events/ev-plain'].designPlan = { design: { themeColor: '#123456' }, sections: [] };
    FB.docs['events/ev-plain'].generatedSite = { runId: 'run-zzzzzzzz-aaaaaa', at: NOW, sections: [{ id: 'agenda', kind: 'custom' }] };
    return Promise.all([
      call('POST', '/api/plan-structure', { eventId: 'ev-plain', siteMode: 'advanced' }),
      call('GET', '/api/generated-section?eventId=ev-plain&id=agenda')
    ]).then(function (f) {
      gs.inputs = realInputs; gs.readOne = realReadOne;
      delete FB.docs['events/ev-plain'].designPlan; delete FB.docs['events/ev-plain'].generatedSite;
      var lines = logged.slice(n).join('\n');
      check('BE-024: an AI step\'s fault: 500, a plain sentence and a ref — never the library\'s text', f[0].status === 500 && f[0].body.error === 'The site could not be designed just now. Please try again.' && /^[0-9a-f]{8}$/.test(f[0].body.ref) && !/FAILED_PRECONDITION|projects\//.test(f[0].text), f[0]);
      check('BE-024: a read\'s fault: the same', f[1].status === 500 && /could not be loaded/.test(f[1].body.error) && f[1].body.ref && !/UNAVAILABLE|googleapis/.test(f[1].text), f[1]);
      check('BE-024: …the cause is logged beside the ref', lines.indexOf(f[0].body.ref) !== -1 && /FAILED_PRECONDITION/.test(lines) && lines.indexOf(f[1].body.ref) !== -1, lines.slice(0, 500));
      var src = require('fs').readFileSync(require.resolve('./api'), 'utf8');
      check('BE-024: no answer names a route to run, or carries "<step> failed: " + the raw message', !/run \/api\//.test(src) && !/failed: ' \+ err\.message/.test(src));
    });
  });
});

/* ================= BE-039: the buttons the Design panel rounds ================= */
step(function () {
  var b = H.buildGeneratedDesign({ themeColor: '#123456' }).buttons;
  check('BE-039: buttons are the register buttons, <button>s and links styled as one — not every link', b === '[data-register-cta], button, a[class*="btn"], a[class*="button"], a[class*="cta"]', b);
  var sel = b.split(',').map(function (s) { return s.trim(); });
  check('BE-039: …no bare "a" (the top bar\'s and the footer\'s links)', sel.indexOf('a') === -1 && sel.every(function (s) { return !/^a$/.test(s); }), sel);
});

/* ================= BE-065: a page read a few minutes ago ================= */
step(function () {
  var R1 = runName('2026-11-13T08:00:00Z', 'src111'), R2 = runName('2026-11-13T08:05:00Z', 'src222');
  var ingest = { sections: [{ heading: 'REFERENCE PAGE', body: 'What it says.' }], design: {} };
  scripted['ingest-source'] = [clone(ingest), clone(ingest)];
  var n = calls.length, f = fetched.length, first = null;
  return call('POST', '/api/ingest-source', { eventId: 'ev-src', runId: R1, url: 'https://ref.example.com/page', type: 'competitor' }).then(function (a) {
    first = a;
    check('BE-065: the first reading reads the page', a.status === 200 && !a.body.cached && calls.length === n + 1 && fetched.length > f, [a.status, a.body]);
    n = calls.length; f = fetched.length;
    return call('POST', '/api/ingest-source', { eventId: 'ev-src', runId: R2, url: 'https://ref.example.com/page', type: 'competitor' });
  }).then(function (b) {
    check('BE-065: the same page again within ten minutes: answered from that reading (cached: true), nothing fetched or paid for', b.status === 200 && b.body.cached === true && calls.length === n && fetched.length === f, [b.status, b.body, calls.length - n, fetched.length - f]);
    check('BE-065: …the same reading, in the same shape', b.body.sourceId === first.body.sourceId && JSON.stringify(b.body.extractedSections) === JSON.stringify(first.body.extractedSections) && b.body.type === 'competitor' && b.body.url === 'https://ref.example.com/page', b.body);
    check('BE-065: …now the newer run\'s: that run\'s steps read it', FB.docs['events/ev-src/sources/' + b.body.sourceId].runId === R2, FB.docs['events/ev-src/sources/' + b.body.sourceId]);
    return call('POST', '/api/ingest-source', { eventId: 'ev-src', runId: R2, url: 'https://ref.example.com/page', type: 'competitor', refresh: true });
  }).then(function (c) {
    check('BE-065: refresh: true reads it again', c.status === 200 && !c.body.cached && calls.length === n + 1 && fetched.length > f, [c.status, c.body]);
    check('BE-065: …and still one reading of it is kept', under('events/ev-src/sources/').length === 1, under('events/ev-src/sources/'));
    var id = c.body.sourceId;
    FB.docs['events/ev-src/sources/' + id].fetchedAt = new Date(Date.now() - H.SOURCE_FRESH_MS - 1000).toISOString();
    scripted['ingest-source'] = [clone(ingest)];
    n = calls.length;
    return call('POST', '/api/ingest-source', { eventId: 'ev-src', runId: R2, url: 'https://ref.example.com/page', type: 'competitor' });
  }).then(function (d) {
    check('BE-065: a reading older than ten minutes is read again', d.status === 200 && !d.body.cached && calls.length === n + 1, [d.status, d.body]);
    n = calls.length;
    return call('POST', '/api/ingest-source', { eventId: 'ev-src', url: 'https://ref.example.com/page', type: 'previousEdition' });
  }).then(function (e) {
    check('BE-065: the same address as another kind of page is not that reading', calls.length >= n && !(e.body && e.body.cached), [e.status, e.body]);
  });
});

/* ================= BE-030: each batch is kept; a Retry asks only for what is missing ================= */
var R1 = runName('2026-11-13T10:00:00Z', 'aaaaaa');
step(function () {
  return plan(R1).then(function (p) {
    check('setup: the run is planned', p.status === 200 && FB.docs['events/ev-gen/generations/' + R1].status === 'planned', [p.status, p.body && p.body.error]);
    check('BE-033: the plan, once kept, replaces the record\'s "planning" mark', !('planningAt' in FB.docs['events/ev-gen/generations/' + R1]), FB.docs['events/ev-gen/generations/' + R1]);
    var before = clone(FB.docs['events/ev-gen']), n = calls.length;
    /* two calls side by side: the first answers, the second fails */
    scripted['generate-content'] = [sectionAnswer(['agenda', 'venue'], 'first try'), { fail: { code: 'ai-timeout', status: 504, retryable: true } }];
    return call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R1, templateId: 'gen-ev-gen' }).then(function (r) {
      check('BE-030: the failed call fails the step (its own status and code)', r.status === 504 && r.body.code === 'ai-timeout' && r.body.retryable === true && calls.length === n + 2, [r.status, r.body, calls.length - n]);
      var kept = written(R1).map(function (k) { return k.split('/').pop(); }).sort();
      check('BE-030: …the batch that answered is kept with the run', JSON.stringify(kept) === '["agenda","venue"]' &&
        /first try/.test(FB.docs['events/ev-gen/generations/' + R1 + '/written/agenda'].html) && FB.docs['events/ev-gen/generations/' + R1 + '/written/agenda'].planKey, kept);
      check('BE-030: …and the event is as it was', JSON.stringify(FB.docs['events/ev-gen']) === JSON.stringify(before), '');
      return call('GET', '/api/generate/status?eventId=ev-gen&runId=' + R1);
    }).then(function (s) {
      check('BE-033: status: failed, 2 of 4 sections written, nothing under way', s.status === 200 && s.body.state === 'failed' && s.body.active === false && s.body.sections.planned === 4 && s.body.sections.written === 2 && s.body.newest === true && s.body.siteReady === false, s.body);
      n = calls.length;
      scripted['generate-content'] = [sectionAnswer(['why-attend', 'faqs'], 'second try')];
      return call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R1, templateId: 'gen-ev-gen' });
    }).then(function (r) {
      var asked = prompts.slice(-1)[0];
      check('BE-030: Retry with the same runId asks once, only for the sections not kept', r.status === 200 && calls.length === n + 1 && JSON.stringify(askedIds(asked)) === '["why-attend","faqs"]', [r.status, r.body && r.body.error, calls.length - n, askedIds(asked)]);
      var ev = FB.docs['events/ev-gen'], ids = ev.generatedSite ? ev.generatedSite.sections.map(function (x) { return x.id; }) : [];
      check('BE-030: …the site has all of them, the kept ones as first written', ev.generatedSite && ev.generatedSite.runId === R1 && PLAN_IDS.every(function (id) { return ids.indexOf(id) !== -1; }) &&
        /first try/.test(FB.docs['events/ev-gen/generations/' + R1 + '/sections/agenda'].html) && /second try/.test(FB.docs['events/ev-gen/generations/' + R1 + '/sections/faqs'].html), ids);
      check('BE-030: …and what was kept while it was written is let go', !written(R1).length, written(R1));
      var rows = under('events/ev-gen/drafts/').map(function (k) { return FB.docs[k]; }).filter(function (d) { return d.runId === R1; });
      check('BE-033: the run\'s draft row (what GET /api/draft opens) is written with the switch: one, named in the answer', rows.length === 1 && FB.docs['events/ev-gen/drafts/' + r.body.draftId] && FB.docs['events/ev-gen/drafts/' + r.body.draftId].runId === R1, [rows.length, r.body.draftId]);
      var facts = logged.filter(function (l) { return /facts check of ev-gen failed/.test(l); });
      check('BE-043 (seen here): the facts check of a generated site runs (it named a list that is not there)', !facts.length, facts);
      return call('GET', '/api/generate/status?eventId=ev-gen&runId=' + R1);
    }).then(function (s) {
      check('BE-033: status: done, the site is the event\'s', s.body.state === 'done' && s.body.siteReady === true && s.body.sections.written === 4, s.body);
      n = calls.length;
      return call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R1, templateId: 'gen-ev-gen' });
    }).then(function (r) {
      check('BE-033: the same run asked again once its site is the event\'s: answered, nothing asked of the model', r.status === 200 && r.body.already === true && calls.length === n, [r.status, r.body, calls.length - n]);
    });
  });
});

/* ================= BE-033: cancel ================= */
step(function () {
  var R2 = runName('2026-11-13T11:00:00Z', 'bbbbbb');
  return plan(R2).then(function () {
    return Promise.all([call('POST', '/api/generate/cancel', { eventId: 'ev-gen', runId: R2 }, 'vic'), call('GET', '/api/generate/status?eventId=ev-gen&runId=' + R2, undefined, 'vic'), call('GET', '/api/generate/status?eventId=ev-gen&runId=' + R2, undefined, null)]);
  }).then(function (r) {
    check('BE-033: a Viewer reads the status but cannot cancel (403)', r[0].status === 403 && r[1].status === 200 && r[1].body.state === 'planned', [r[0].status, r[1].body]);
    check('BE-033: no sign-in, no status (401)', r[2].status === 401, r[2].status);
    var n = calls.length;
    return call('POST', '/api/generate/cancel', { eventId: 'ev-gen', runId: R2 }).then(function (c) {
      check('BE-033: cancel stops the run without asking the model', c.status === 200 && c.body.stopped === true && c.body.done === false && calls.length === n && FB.docs['events/ev-gen/generations/' + R2].status === 'stopped', [c.status, c.body]);
      return Promise.all([call('GET', '/api/generate/status?eventId=ev-gen&runId=' + R2), call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R2, templateId: 'gen-ev-gen' })]);
    }).then(function (x) {
      check('BE-033: …status says stopped', x[0].body.state === 'stopped' && x[0].body.active === false, x[0].body);
      check('BE-033: …its pages are never written onto the event (409 run-stopped)', x[1].status === 409 && x[1].body.code === 'run-stopped' && FB.docs['events/ev-gen'].generatedSite.runId === R1, [x[1].status, x[1].body]);
      return Promise.all([call('POST', '/api/generate/cancel', { eventId: 'ev-gen', runId: R1 }), call('POST', '/api/generate/cancel', { eventId: 'ev-gen', runId: '../x' })]);
    }).then(function (y) {
      check('BE-033: a run whose site is the event\'s already is left as it is (done: true)', y[0].status === 200 && y[0].body.done === true && y[0].body.stopped === false && FB.docs['events/ev-gen'].generatedSite.runId === R1, y[0].body);
      check('BE-033: a run name that is not one: 400', y[1].status === 400, y[1]);
    });
  });
});
step(function () {
  /* cancelled while its pages are being written: the step asks for nothing more and keeps nothing more */
  var R3 = runName('2026-11-13T12:00:00Z', 'cccccc');
  return plan(R3).then(function () {
    var site = FB.docs['events/ev-gen'].generatedSite.runId, n = calls.length;
    scripted['generate-content'] = [
      function () { FB.docs['events/ev-gen/generations/' + R3].status = 'stopped'; return sectionAnswer(['agenda', 'venue']); },
      sectionAnswer(['why-attend', 'faqs']), sectionAnswer(['agenda']), sectionAnswer(['agenda'])];
    return call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R3, templateId: 'gen-ev-gen' }).then(function (r) {
      check('BE-033: a run cancelled while it is written answers 409 run-stopped, after only the calls already under way', r.status === 409 && r.body.code === 'run-stopped' && calls.length === n + 2, [r.status, r.body, calls.length - n]);
      check('BE-033: …keeps nothing once stopped, and the event keeps its site', !written(R3).length && FB.docs['events/ev-gen'].generatedSite.runId === site, written(R3));
    });
  });
});

/* ================= BE-033 / BE-030: a run whose request ended (the page was reloaded) is finished from what it kept ================= */
step(function () {
  var R4 = runName('2026-11-13T13:00:00Z', 'dddddd');
  return plan(R4).then(function () {
    var site = FB.docs['events/ev-gen'].generatedSite.runId;
    return new Promise(function (resolve) {
      var closers = [];
      scripted['generate-content'] = [
        function () { closers.forEach(function (fn) { fn(); }); return sectionAnswer(['agenda', 'venue'], 'before the reload'); },
        sectionAnswer(['why-attend', 'faqs'], 'before the reload')];
      var req = { method: 'POST', url: '/api/generate-content', headers: { host: 'localhost', 'content-type': 'application/json', authorization: 'Bearer asha' }, socket: {},
        rawBody: Buffer.from(JSON.stringify({ eventId: 'ev-gen', runId: R4, templateId: 'gen-ev-gen' })) };
      req.on = function () { return req; }; req.resume = function () {};
      var res = { statusCode: 200, headersSent: false, writableEnded: false, setHeader: function () {}, writeHead: function () { res.headersSent = true; return res; }, write: function () { return true; },
        on: function (ev, fn) { if (ev === 'close') closers.push(fn); return res; }, end: function () { res.writableEnded = true; resolve('answered'); } };
      api.handleApi(req, res);
      (function wait(tries) {
        var w = FB.docs['events/ev-gen/generations/' + R4];
        if ((w && w.writing && w.writing.state === 'left') || tries > 200) return resolve('left');
        setTimeout(function () { wait(tries + 1); }, 10);
      })(0);
    }).then(function () {
      check('WZ-055: the run whose caller left is not put on the event', FB.docs['events/ev-gen'].generatedSite.runId === site, FB.docs['events/ev-gen'].generatedSite.runId);
      check('BE-030: …what it wrote is kept with it', written(R4).length === 4, written(R4));
      return call('GET', '/api/generate/status?eventId=ev-gen&runId=' + R4);
    }).then(function (s) {
      check('BE-033: status after the reload: left, all 4 written, nothing under way', s.body.state === 'left' && s.body.active === false && s.body.sections.written === 4 && s.body.sections.planned === 4, s.body);
      var n = calls.length;
      return call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R4, templateId: 'gen-ev-gen' }).then(function (r) {
        check('BE-033: the wizard picks it up: the site is put on the event without asking the model again', r.status === 200 && calls.length === n && FB.docs['events/ev-gen'].generatedSite.runId === R4 &&
          /before the reload/.test(FB.docs['events/ev-gen/generations/' + R4 + '/sections/faqs'].html), [r.status, r.body && r.body.error, calls.length - n]);
      });
    });
  });
});

/* ================= BE-033: one request writes a run at a time ================= */
step(function () {
  var R6 = runName('2026-11-13T13:40:00Z', 'ffffff');
  return plan(R6).then(function () {
    var rec = FB.docs['events/ev-gen/generations/' + R6], key = gs.planKey(Object.assign({}, rec.designPlan, { sections: require('./section-order').sponsorsFirst(rec.designPlan.sections) }));
    /* another request of this run is writing it right now (a page reloaded a moment ago) */
    rec.writing = { planKey: key, state: 'writing', tryId: 'other111', at: new Date().toISOString(), planned: PLAN_IDS };
    var n = calls.length, site = FB.docs['events/ev-gen'].generatedSite.runId;
    return call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R6, templateId: 'gen-ev-gen' }).then(function (r) {
      check('BE-033: a second request for a run that is being written: 409 run-busy, nothing asked of the model', r.status === 409 && r.body.code === 'run-busy' && calls.length === n, [r.status, r.body, calls.length - n]);
      check('BE-033: …and the request writing it keeps the run\'s record', FB.docs['events/ev-gen/generations/' + R6].writing.tryId === 'other111' && FB.docs['events/ev-gen/generations/' + R6].writing.state === 'writing' && FB.docs['events/ev-gen'].generatedSite.runId === site, FB.docs['events/ev-gen/generations/' + R6].writing);
      return call('GET', '/api/generate/status?eventId=ev-gen&runId=' + R6);
    }).then(function (s) {
      check('BE-033: …status says it is being written', s.body.state === 'writing' && s.body.active === true, s.body);
      /* that request went silent minutes ago (its server instance went away): the next one takes the run over */
      FB.docs['events/ev-gen/generations/' + R6].writing.at = new Date(Date.now() - gs.WRITING_FRESH_MS - 1000).toISOString();
      n = calls.length;
      scripted['generate-content'] = [sectionAnswer(['agenda', 'venue']), function () {
        /* …and meanwhile the silent one finishes after all and puts the run's site on the event */
        FB.docs['events/ev-gen/generations/' + R6].status = 'done';
        return sectionAnswer(['why-attend', 'faqs']);
      }];
      var drafts = under('events/ev-gen/drafts/').length;
      return call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R6, templateId: 'gen-ev-gen' }).then(function (r) {
        check('BE-033: a run silent for minutes is taken over by the next request', calls.length === n + 2, calls.length - n);
        check('BE-033: …which, finding the run put on the event by the other meanwhile, answers as that one did and does not put it there twice',
          r.status === 200 && r.body.already === true && !r.body.error && under('events/ev-gen/drafts/').length === drafts && FB.docs['events/ev-gen'].generatedSite.runId === site, [r.status, r.body, under('events/ev-gen/drafts/').length - drafts]);
      });
    });
  });
});

/* ================= BE-030: what was kept for one plan is never used for another ================= */
step(function () {
  var R5 = runName('2026-11-13T13:30:00Z', 'eeeeee');
  return plan(R5).then(function () {
    scripted['generate-content'] = [sectionAnswer(['agenda', 'venue'], 'old plan'), { fail: { code: 'ai-timeout', status: 504, retryable: true } }];
    return call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R5, templateId: 'gen-ev-gen' });
  }).then(function (r) {
    check('setup: a try that kept two sections', r.status === 504 && written(R5).length === 2, [r.status, written(R5)]);
    /* the same run designed again (its plan row retried): another plan */
    scripted['plan-structure'] = [planAnswer(['agenda', 'venue', 'awards-night', 'faqs'])];
    return call('POST', '/api/plan-structure', { eventId: 'ev-gen', runId: R5, siteMode: 'advanced', eventMeta: { name: 'Gen Summit' } });
  }).then(function () {
    var n = calls.length;
    scripted['generate-content'] = [sectionAnswer(['agenda', 'venue'], 'new plan'), sectionAnswer(['awards-night', 'faqs'], 'new plan')];
    return call('POST', '/api/generate-content', { eventId: 'ev-gen', runId: R5, templateId: 'gen-ev-gen' }).then(function (r) {
      var asked = prompts.slice(-2).map(askedIds).reduce(function (a, b) { return a.concat(b || []); }, []).sort();
      check('BE-030: a new plan in the same run asks for every section again', r.status === 200 && calls.length === n + 2 && JSON.stringify(asked) === '["agenda","awards-night","faqs","venue"]', [r.status, r.body && r.body.error, asked]);
      check('BE-030: …nothing the old plan\'s try wrote is on the site', /new plan/.test(FB.docs['events/ev-gen/generations/' + R5 + '/sections/agenda'].html), FB.docs['events/ev-gen/generations/' + R5 + '/sections/agenda']);
    });
  });
});

/* ================= BE-033: runStatusOf ================= */
step(function () {
  var now = Date.parse('2026-11-13T14:00:00Z'), plan = { sections: PLAN_IDS.map(function (id) { return { id: id, kind: 'custom' }; }), design: {} };
  var ev = { generationRun: { runId: 'run-a' } };
  var writing = function (state, agoMs) { return { status: 'planned', designPlan: plan, writing: { state: state, planKey: 'k', at: new Date(now - agoMs).toISOString() } }; };
  var w2 = [{ id: 'agenda', planKey: 'k' }, { id: 'venue', planKey: 'k' }, { id: 'faqs', planKey: 'old' }];
  var s1 = H.runStatusOf('e', 'run-a', ev, writing('writing', 20000), w2, now);
  check('runStatusOf: writing, recently heard from: active, 2 of 4 (an answer to another plan does not count)', s1.state === 'writing' && s1.active === true && s1.sections.written === 2 && s1.sections.planned === 4, s1);
  var s2 = H.runStatusOf('e', 'run-a', ev, writing('writing', H.RUN_ACTIVE_MS.writing + 1000), w2, now);
  check('runStatusOf: writing, not heard from for minutes: left (the request is gone), not active', s2.state === 'left' && s2.active === false, s2);
  var s3 = H.runStatusOf('e', 'run-a', ev, { runId: 'run-a', planningAt: new Date(now - 30000).toISOString() }, [], now);
  var s4 = H.runStatusOf('e', 'run-a', ev, { runId: 'run-a', planningAt: new Date(now - H.RUN_ACTIVE_MS.planning - 1000).toISOString() }, [], now);
  check('runStatusOf: a plan being made is active for a while, then unknown', s3.state === 'planning' && s3.active === true && s4.state === 'unknown' && s4.active === false, [s3, s4]);
  check('planKey: the same plan whatever order its fields come in; another plan another key',
    gs.planKey({ design: { a: 1, b: 2 }, sections: [{ id: 'x', kind: 'k' }] }) === gs.planKey({ sections: [{ kind: 'k', id: 'x' }], design: { b: 2, a: 1 } }) &&
    gs.planKey({ design: { a: 1 }, sections: [{ id: 'x' }] }) !== gs.planKey({ design: { a: 1 }, sections: [{ id: 'y' }] }));
  var s5 = H.runStatusOf('e', 'run-a', { generationRun: { runId: 'run-b' } }, writing('failed', 0), [], now);
  var s6 = H.runStatusOf('e', 'run-a', {}, null, [], now);
  check('runStatusOf: overtaken by a newer run: superseded; no record: unknown', s5.state === 'superseded' && s6.state === 'unknown', [s5, s6]);
});

/* ================= the wizard's side (create-event.html) ================= */
step(function () {
  var page = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'create-event.html'), 'utf8');
  var gen = page.slice(page.indexOf('function startGenerateFromBrief('), page.indexOf('function renderBriefProgress('));
  check('wizard: Cancel stops the run through POST /api/generate/cancel', /fetch\('\/api\/generate\/cancel'/.test(gen) && !/stop: true/.test(gen), '');
  check('wizard: the writing row reads its progress from GET /api/generate/status', /\/api\/generate\/status\?eventId=/.test(gen) && /sections written/.test(gen), '');
  check('wizard: the run is remembered with the draft (S.genRun) and forgotten when it ends or is cancelled', /S\.genRun = \{ runId: runId, eventId: eventId/.test(gen) && /run\.onCancel = function\(viaNav\)\{[\s\S]*?forget\(\);/.test(gen) && /forget\(\);\s*leaveForEditor\(/.test(gen), '');
  var startFn = page.slice(page.indexOf('function start(d)'), page.indexOf('if (document.readyState'));
  check('wizard: a reloaded page picks the run up, once the form is drawn (start() -> resumeGeneration)', /setTimeout\(resumeGeneration, 0\);\s*\/\*[^*]*\*\/\s*S\.step = 1;\s*goStep\(1\);/.test(startFn) && /startGenerateFromBrief\(!!g\.replace, g\)/.test(page), '');
  check('wizard: a row that was running asks the server before sending anything again', /askFirst\[k\] = true/.test(gen) && /whenServerIdle\('generate'\)/.test(gen) && /whenServerIdle\('plan'\)/.test(gen), '');
  check('wizard: a design or pages request that got no answer (a reload aborts it) is kept as running, and its Retry waits for the server',
    /var unanswered = !\(err && err\.status\) && \(s\.key === 'plan' \|\| s\.key === 'generate'\);/.test(gen) && /if \(unanswered\) askFirst\[s\.key\] = true;/.test(gen) && /remember\(unanswered \? s\.key : ''\)/.test(gen), '');
  check('wizard: a run another request is still writing (409 run-busy) is waited for, then asked again', /err\.code === 'run-busy'[\s\S]{0,80}whenServerIdle\('generate'\)/.test(gen), '');
});

/* ---------- run ---------- */
steps.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve()).then(function () {
  console.error = realError;
  if (failed) console.error(logged.slice(-15).join('\n'));
  console.log('generation-resume: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error = realError;
  console.error('generation-resume: the run stopped — ' + (err && err.stack || err));
  process.exit(1);
});
