/* node functions/lib/generation-runs.test.js — Create Event's "Generate my site" as runs kept apart until complete, and
   where an AI-designed site's sections are kept (launch check 13 Nov 2026), through the real router (lib/api.js
   handleApi), an in-memory Firestore and Storage, and the model scripted (no AI call is made, nothing is paid for).
     WZ-034 / BE-029  a run reads only the brief and the pages read for it; its plan waits with the run; only the
                      event's newest run puts its site on the event; what earlier runs read is let go after
     BE-031           a planned section the model did not write fails the step (502, the sections named), nothing saved
     BE-032           the sections live in documents of the run's own, the event switches to them in one write; GET
                      /api/event carries no markup; a site generated before keeps working where it is (read, logo,
                      site repair, clone)
     BE-035           a site the first pipeline made answers 409 earlier-ai-design, and is not changed by asking
     ED-046           generated-template names the sections ETB2B AI did not write (ai: false) */
'use strict';
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '')); }
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
process.env.ACCESS_CONFIG_DOC = 'config/test-generation-access';

/* no picture is made here: every picture step degrades as it does when the picture model is down */
var gemini = require('./gemini');
gemini.callGeminiImage = function () { return Promise.resolve({ error: 'no pictures in this test' }); };
/* the pages "read" (ingest-source): a plain page, never the network */
var PAGES = {
  'https://new.example.com/': '<html><head><title>New page</title></head><body><h1>NEW LINK PAGE</h1><p>What the new link says.</p></body></html>',
  'https://old.example.com/': '<html><head><title>Old page</title></head><body><h1>OLD LINK PAGE</h1></body></html>'
};
global.fetch = function (url) {
  var u = String(url);
  if (PAGES[u]) return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(PAGES[u]); }, headers: { get: function () { return 'text/html'; } } });
  return Promise.reject(new Error('no network in this test: ' + u));
};

/* ---------- the model, scripted per route; every prompt kept ---------- */
var llm = require('./llm');
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

var api = require('./api');
var H = api._testHooks;
var gs = require('./generated-site');
var genDesign = require('./gen-design');

function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'content-type': 'application/json', authorization: 'Bearer ' + (who || 'asha') };
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body === undefined ? '' : JSON.stringify(body)) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b === undefined ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: t }); } };
    api.handleApi(req, res);
  });
}
function under(prefix) { return Object.keys(FB.docs).filter(function (k) { return k.indexOf(prefix) === 0; }); }
function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

/* ---------- the data ---------- */
var NOW = '2026-11-01T10:00:00.000Z';
var DESIGN = { themeColor: '#123456', accentColor: '#c0ffee', headingFont: 'Inter', bodyFont: 'Inter', mode: 'light', cornerRadius: 8 };
FB.docs['config/test-generation-access'] = { defaultRole: 'editor', members: { 'vic@timesinternet.in': { role: 'viewer', portals: ['all'] } } };
/* an event generated before 13 Nov 2026: its sections on its document, an earlier brief and page on record */
var OLD_SECTIONS = [
  { id: 'nav', kind: 'nav', html: '<nav class="n" data-rv-section="nav"><a href="#agenda">Agenda</a></nav>', css: '.n{display:flex}' },
  { id: 'hero', kind: 'hero', html: '<section class="h" data-rv-section="hero"><h1>Old hero</h1></section>', css: '.h{padding:1rem}' },
  { id: 'agenda', kind: 'custom', html: '<section class="a"><h2>Old agenda</h2></section>', css: '.a{padding:1rem}' },
  { id: 'footer', kind: 'footer', html: '<footer class="f">Old footer</footer>', css: '.f{padding:1rem}' }
];
FB.docs['events/ev-run'] = { name: 'Run Summit', createdAt: NOW, createdBy: 'asha@timesinternet.in', portal: '', published: false, templateId: 'gen-ev-run',
  start: '2027-03-10', end: '2027-03-11', venue: 'Hall 1', city: 'Pune', description: '',
  designPlan: { design: DESIGN, sections: [{ id: 'agenda', kind: 'custom', name: 'Agenda', purpose: 'old' }] }, generatedSections: clone(OLD_SECTIONS), generatedAt: NOW };
FB.docs['events/ev-run/briefs/old1'] = { extracted: { theme: 'OLD THEME FROM AN EARLIER RUN', audience: 'x', tone: 'x', tracks: [], speakerHints: [], sponsorHints: [], keyMessages: [] }, createdAt: '2026-10-01T00:00:00.000Z', storagePath: 'events/ev-run/briefs/old1.txt' };
FB.files['events/ev-run/briefs/old1.txt'] = Buffer.from('old');
FB.docs['events/ev-run/sources/oldsrc'] = { type: 'competitor', url: 'https://old.example.com/', extractedSections: [{ heading: 'OLD LINK PAGE', body: 'removed by the owner' }], fetchedAt: '2026-10-01T00:00:00.000Z' };
/* the first pipeline's site (BE-035) */
FB.docs['events/ev-first'] = { name: 'First', createdAt: NOW, portal: '', published: true, templateId: 'gen-ev-first',
  structurePlan: { generatedAt: NOW, sections: ['nav', 'hero', 'overview', 'footer'] }, theme: { themeColor: '#186bf9' } };

var BRIEF_ANSWER = { theme: 'NEW THEME OF THIS RUN', audience: 'CIOs', tone: 'calm', tracks: ['Data'], speakerHints: [], sponsorHints: [], keyMessages: ['One'], inferredCategory: 'technology',
  ownerPoints: {}, visualIdentity: { designed: 'no' }, deckSections: [] };
var INGEST_ANSWER = { sections: [{ heading: 'NEW LINK PAGE', body: 'What the new link says.' }], design: {} };
function planAnswer(ids) {
  return { sections: ids.map(function (id) { return { id: id, kind: 'custom', purpose: 'The ' + id + ' of the event.', layout: 'a grid of cards', image: '' }; }),
    design: { mood: 'calm', themeColor: '#224466', accentColor: '#ee8833', headingFont: 'Inter', bodyFont: 'Inter', mode: 'light', heroTagline: 'Run tagline', heroImage: 'a hall' },
    eventDescription: 'Run Summit brings CIOs together in Pune to compare what works with data.' };
}
function sectionAnswer(ids) {
  return { positioningNotes: '', sections: ids.map(function (id) {
    return { id: id, html: '<section class="s-' + id + '"><h2>Heading of ' + id + '</h2><p>Words about ' + id + ' written for this run.</p></section>',
      css: '.s-' + id + '{padding:3rem 1.5rem;display:grid;gap:1rem;background:var(--rv-surface)} .s-' + id + ' h2{font-size:2rem;margin:0}' };
  }) };
}
/* every call of a run's writing step gets the whole answer: the step keeps one copy of each section */
function scriptWriting(ids, times) { scripted['generate-content'] = []; for (var i = 0; i < times; i++) scripted['generate-content'].push(sectionAnswer(ids)); }

var steps = [];
function step(fn) { steps.push(fn); }
var R1 = 'run-' + (Date.parse('2026-11-13T10:00:00Z')).toString(36) + '-aaaaaa';
var R2 = 'run-' + (Date.parse('2026-11-13T11:00:00Z')).toString(36) + '-bbbbbb';
var R3 = 'run-' + (Date.parse('2026-11-13T12:00:00Z')).toString(36) + '-cccccc';
var R0 = 'run-' + (Date.parse('2026-11-13T09:00:00Z')).toString(36) + '-zzzzzz';

/* ================= WZ-034 / BE-029: a run reads its own inputs ================= */
step(function () {
  check('runIdOf: none, a name, not one', H.runIdOf({}) === '' && H.runIdOf({ runId: R1 }) === R1 && H.runIdOf({ runId: '../x' }) === null);
  check('runStart: read from the name', gs.runStart(R2) > gs.runStart(R1) && gs.runStart('nonsense') === 0);
  scripted['extract-brief'] = [clone(BRIEF_ANSWER)];
  scripted['ingest-source'] = [clone(INGEST_ANSWER)];
  return Promise.all([
    call('POST', '/api/extract-brief', { eventId: 'ev-run', runId: R1, fileName: 'd.txt', mimeType: 'text/plain', docBase64: b64('Tagline / theme: new') }),
    call('POST', '/api/ingest-source', { eventId: 'ev-run', runId: R1, url: 'https://new.example.com/', type: 'competitor' }),
    call('POST', '/api/extract-brief', { eventId: 'ev-run', runId: 'bad id!', fileName: 'd.txt', mimeType: 'text/plain', docBase64: b64('x') })
  ]).then(function (r) {
    check('WZ-034: the brief is read for its run', r[0].status === 200 && FB.docs['events/ev-run/briefs/' + r[0].body.briefId].runId === R1, [r[0].status, r[0].body]);
    check('WZ-034: the page is read for its run', r[1].status === 200 && FB.docs['events/ev-run/sources/' + r[1].body.sourceId].runId === R1, [r[1].status, r[1].body]);
    check('WZ-034: a run name that is not one is refused before anything is paid for (400)', r[2].status === 400, r[2]);
    var n = prompts.length;
    scripted['plan-structure'] = [planAnswer(['agenda', 'venue'])];
    return call('POST', '/api/plan-structure', { eventId: 'ev-run', runId: R1, siteMode: 'advanced', eventMeta: { name: 'Run Summit' } }).then(function (p) {
      var asked = prompts.slice(n).filter(function (x) { return x.route === 'plan-structure'; })[0] || { prompt: '' };
      check('BE-029: plan-structure answers for the run', p.status === 200 && p.body.runId === R1 && p.body.designPlan, [p.status, p.body && p.body.error]);
      check('WZ-034: the plan is told this run\'s brief and page', asked.prompt.indexOf('NEW THEME OF THIS RUN') !== -1 && asked.prompt.indexOf('NEW LINK PAGE') !== -1, asked.prompt.slice(0, 400));
      check('WZ-034: …and nothing an earlier run read (a brief, a link the owner removed)', asked.prompt.indexOf('OLD THEME') === -1 && asked.prompt.indexOf('OLD LINK PAGE') === -1 && asked.prompt.indexOf('old.example.com') === -1, '');
      var ev = FB.docs['events/ev-run'], run = FB.docs['events/ev-run/generations/' + R1];
      check('BE-029: the plan waits with the run: the event keeps its design and site', ev.designPlan.sections[0].purpose === 'old' && Array.isArray(ev.generatedSections) && ev.generatedSections.length === 4, ev.designPlan);
      check('BE-029: …kept as the run\'s own, and the run is the event\'s newest', run && run.status === 'planned' && run.designPlan && run.designPlan.sections.length >= 2 && ev.generationRun && ev.generationRun.runId === R1, run);
      check('BE-029: the description written with the plan waits too', !ev.description && run.described && /Run Summit brings/.test(run.described.description), run.described);
    });
  });
});

/* ================= BE-031: a planned section the model did not write ================= */
step(function () {
  var before = clone(FB.docs['events/ev-run']);
  /* "venue" is left out, every time it is asked for */
  scripted['generate-content'] = [sectionAnswer(['agenda']), sectionAnswer(['agenda']), sectionAnswer(['agenda']), sectionAnswer(['agenda']), sectionAnswer(['agenda'])];
  return call('POST', '/api/generate-content', { eventId: 'ev-run', runId: R1, templateId: 'gen-ev-run' }).then(function (r) {
    check('BE-031: a section still missing after it was asked for again fails the step (502 ai-bad-output)', r.status === 502 && r.body.code === 'ai-bad-output' && r.body.retryable === true, [r.status, r.body]);
    check('BE-031: …naming it', JSON.stringify(r.body.missing) === '["venue"]' && /venue/i.test(r.body.error) && /nothing was saved/i.test(r.body.error), r.body);
    check('BE-031: …and nothing is saved: the event and the run\'s sections as they were', JSON.stringify(FB.docs['events/ev-run']) === JSON.stringify(before) && !under('events/ev-run/generations/' + R1 + '/sections/').length, under('events/ev-run/generations/'));
    check('BE-031: missingSectionIds: built sections are not the model\'s to write', JSON.stringify(H.missingSectionIds([{ id: 'hero', html: '<x>' }, { id: 'a', html: '' }], { sections: [{ id: 'a' }, { id: 'b' }, { id: 'p', prebuilt: 'speakers' }] })) === '["a","b"]');
  });
});

/* ================= BE-032: the run's site is written apart, the event switches in one write ================= */
step(function () {
  scriptWriting(['agenda', 'venue'], 6);
  return call('POST', '/api/generate-content', { eventId: 'ev-run', runId: R1, templateId: 'gen-ev-run' }).then(function (r) {
    var ev = FB.docs['events/ev-run'];
    check('BE-032: generate-content answers for the run', r.status === 200 && r.body.runId === R1 && r.body.draftId, [r.status, r.body]);
    check('BE-032: the event points at the run\'s sections, in the page\'s order, without their markup', ev.generatedSite && ev.generatedSite.runId === R1 &&
      ev.generatedSite.sections.map(function (s) { return s.id; }).join(',') === 'nav,hero,agenda,venue,footer' && !ev.generatedSite.sections.some(function (s) { return 'html' in s || 'css' in s; }), ev.generatedSite);
    check('BE-032: no markup is left on the event document (the old field is removed by the same write)', !('generatedSections' in ev), Object.keys(ev));
    var docs = under('events/ev-run/generations/' + R1 + '/sections/');
    check('BE-032: one document per section under the run', docs.length === 5 && /Words about agenda written for this run/.test(FB.docs['events/ev-run/generations/' + R1 + '/sections/agenda'].html), docs);
    check('BE-029: the run\'s plan and description are the event\'s now', ev.designPlan.sections.some(function (s) { return s.id === 'venue'; }) && /Run Summit brings/.test(ev.description) &&
      ev.generationRun.runId === R1 && ev.generationRun.done === true && FB.docs['events/ev-run/generations/' + R1].status === 'done', ev.generationRun);
    check('BE-029: what earlier runs read is let go: the old brief (and its file), the removed link', !FB.docs['events/ev-run/briefs/old1'] && !FB.files['events/ev-run/briefs/old1.txt'] && !FB.docs['events/ev-run/sources/oldsrc'], under('events/ev-run/'));
    check('BE-029: …this run\'s own brief and page stay', under('events/ev-run/briefs/').length === 1 && under('events/ev-run/sources/').length === 1, under('events/ev-run/'));
    return Promise.all([call('GET', '/api/generated-template?eventId=ev-run'), call('GET', '/api/generated-section?eventId=ev-run&id=agenda'), call('GET', '/api/event?eventId=ev-run')]);
  }).then(function (r) {
    var t = r[0].body || {}, ids = (t.sections || []).map(function (s) { return s.id; });
    check('BE-032: generated-template lists the run\'s sections', r[0].status === 200 && ids.join(',') === 'nav,hero,agenda,venue,footer', [r[0].status, ids]);
    var ai = {}; (t.sections || []).forEach(function (s) { ai[s.id] = s.ai; });
    check('ED-046: the top bar and the footer are not asked about; the sections ETB2B AI wrote are', ai.nav === false && ai.footer === false && ai.hero !== false && ai.agenda !== false, ai);
    check('BE-032: generated-section serves the run\'s own document', r[1].status === 200 && /Words about agenda written for this run/.test(r[1].body.html) && /padding/.test(r[1].body.css), r[1]);
    check('BE-032: GET /api/event carries no section markup, only which sections the site has', r[2].status === 200 && !('generatedSections' in r[2].body) && r[2].body.generatedSite && r[2].body.generatedSite.runId === R1, Object.keys(r[2].body || {}));
  });
});

/* ================= BE-029: only the event's newest run puts its site on it ================= */
step(function () {
  scripted['plan-structure'] = [planAnswer(['agenda']), planAnswer(['agenda', 'speakers-panel'])];
  return call('POST', '/api/plan-structure', { eventId: 'ev-run', runId: R2, siteMode: 'advanced' }).then(function (a) {
    return call('POST', '/api/plan-structure', { eventId: 'ev-run', runId: R3, siteMode: 'advanced' }).then(function (b) { return [a, b]; });
  }).then(function (p) {
    check('BE-029: two runs planned (another tab)', p[0].status === 200 && p[1].status === 200 && FB.docs['events/ev-run'].generationRun.runId === R3, [p[0].status, p[1].status]);
    scriptWriting(['agenda'], 6);
    var before = clone(FB.docs['events/ev-run']);
    return call('POST', '/api/generate-content', { eventId: 'ev-run', runId: R2, templateId: 'gen-ev-run' }).then(function (r) {
      check('BE-029: the run overtaken by a newer one is not put on the event (409 run-superseded)', r.status === 409 && r.body.code === 'run-superseded', [r.status, r.body]);
      check('BE-029: …the event is exactly as it was', JSON.stringify(FB.docs['events/ev-run']) === JSON.stringify(before), '');
      scriptWriting(['agenda', 'speakers-panel'], 6);
      return call('POST', '/api/generate-content', { eventId: 'ev-run', runId: R3, templateId: 'gen-ev-run' });
    }).then(function (r) {
      var ev = FB.docs['events/ev-run'];
      check('BE-029: the newest run is', r.status === 200 && ev.generatedSite.runId === R3, [r.status, r.body]);
      check('BE-029: earlier runs\' generations are let go, a later one\'s would not be', !under('events/ev-run/generations/' + R1).length && !under('events/ev-run/generations/' + R2).length && under('events/ev-run/generations/' + R3 + '/sections/').length === 5, under('events/ev-run/generations/'));
    });
  });
});

/* ================= the step whose caller has gone writes nothing ================= */
step(function () {
  scripted['plan-structure'] = [planAnswer(['agenda'])];
  var R4 = 'run-' + (Date.parse('2026-11-13T13:00:00Z')).toString(36) + '-dddddd';
  return call('POST', '/api/plan-structure', { eventId: 'ev-run', runId: R4, siteMode: 'advanced' }).then(function () {
    var before = clone(FB.docs['events/ev-run']);
    return new Promise(function (resolve) {
      var closers = [];
      /* the wizard's Cancel aborts the request while the model is writing */
      scripted['generate-content'] = [0, 1, 2, 3, 4, 5].map(function () { return function () { closers.forEach(function (fn) { fn(); }); return sectionAnswer(['agenda']); }; });
      var req = { method: 'POST', url: '/api/generate-content', headers: { host: 'localhost', 'content-type': 'application/json', authorization: 'Bearer asha' }, socket: {},
        rawBody: Buffer.from(JSON.stringify({ eventId: 'ev-run', runId: R4, templateId: 'gen-ev-run' })) };
      req.on = function () { return req; }; req.resume = function () {};
      var res = { statusCode: 200, headersSent: false, writableEnded: false, setHeader: function () {}, writeHead: function () { res.headersSent = true; return res; }, write: function () { return true; },
        on: function (ev, fn) { if (ev === 'close') closers.push(fn); return res; }, end: function () { res.writableEnded = true; resolve('answered'); } };
      api.handleApi(req, res);
      setTimeout(function () { resolve(closers.length ? 'no answer' : 'never listened'); }, 1500);
    }).then(function (how) {
      check('WZ-055: a site whose caller stopped waiting is not put on the event', JSON.stringify(FB.docs['events/ev-run']) === JSON.stringify(before) && !under('events/ev-run/generations/' + R4 + '/sections/').length, how);
    });
  });
});

/* ================= WZ-055: a run the person stopped changes nothing (POST /api/generate-content { stop: true }) ================= */
step(function () {
  var R6 = 'run-' + (Date.parse('2026-11-13T15:00:00Z')).toString(36) + '-ffffff', R7 = 'run-' + (Date.parse('2026-11-13T16:00:00Z')).toString(36) + '-gggggg';
  scripted['plan-structure'] = [planAnswer(['agenda']), planAnswer(['agenda'])];
  var before = null, n = 0;
  return call('POST', '/api/plan-structure', { eventId: 'ev-run', runId: R6, siteMode: 'advanced' }).then(function (p) {
    before = clone(FB.docs['events/ev-run']); n = calls.length;
    return call('POST', '/api/generate-content', { eventId: 'ev-run', runId: R6, templateId: 'gen-ev-run', stop: true });
  }).then(function (s) {
    check('WZ-055: Stop is taken without asking the model', s.status === 200 && s.body.stopped === true && calls.length === n, [s.status, s.body]);
    check('WZ-055: …the run is marked stopped', FB.docs['events/ev-run/generations/' + R6].status === 'stopped' && FB.docs['events/ev-run'].generationRun.stopped === true, FB.docs['events/ev-run'].generationRun);
    scriptWriting(['agenda'], 6);
    return call('POST', '/api/generate-content', { eventId: 'ev-run', runId: R6, templateId: 'gen-ev-run' });
  }).then(function (g) {
    check('WZ-055: its pages are not written onto the event (409 run-stopped)', g.status === 409 && g.body.code === 'run-stopped', [g.status, g.body]);
    check('WZ-055: …the event keeps the site it had', FB.docs['events/ev-run'].generatedSite.runId === before.generatedSite.runId && JSON.stringify(FB.docs['events/ev-run'].designPlan) === JSON.stringify(before.designPlan), '');
    /* stopped before its plan came back: the plan does not take the event either */
    return call('POST', '/api/generate-content', { eventId: 'ev-run', runId: R7, templateId: 'gen-ev-run', stop: true });
  }).then(function () {
    return call('POST', '/api/plan-structure', { eventId: 'ev-run', runId: R7, siteMode: 'advanced' });
  }).then(function (p) {
    check('WZ-055: a plan that comes back after Stop is not kept (409 run-stopped)', p.status === 409 && p.body.code === 'run-stopped' && FB.docs['events/ev-run'].generationRun.runId === R6, [p.status, p.body]);
    return call('POST', '/api/generate-content', { eventId: 'ev-run', templateId: 'gen-ev-run', stop: true });
  }).then(function (r) {
    check('WZ-055: Stop names its run (400)', r.status === 400, r);
  });
});

/* ================= a site generated before 13 Nov 2026 keeps working where it is ================= */
step(function () {
  FB.docs['events/ev-legacy'] = { name: 'Legacy', createdAt: NOW, createdBy: 'asha@timesinternet.in', portal: '', templateId: 'gen-ev-legacy',
    designPlan: { design: DESIGN, sections: [{ id: 'agenda', kind: 'custom', name: 'Agenda' }, { id: 'previous-edition-speakers', kind: 'custom', prebuilt: 'speakers' }] },
    generatedSections: clone(OLD_SECTIONS).concat([{ id: 'previous-edition-speakers', kind: 'custom', html: '<section class="p"><h2>Speakers</h2></section>', css: '.p{padding:1rem}' }]) };
  var before = JSON.stringify(FB.docs['events/ev-legacy']);
  return Promise.all([call('GET', '/api/generated-template?eventId=ev-legacy'), call('GET', '/api/generated-section?eventId=ev-legacy&id=agenda'), call('GET', '/api/event?eventId=ev-legacy')]).then(function (r) {
    var ids = ((r[0].body || {}).sections || []).map(function (s) { return s.id; });
    check('BE-032: an older site\'s template is built from its own field', r[0].status === 200 && ids.indexOf('agenda') !== -1 && ids.indexOf('footer') !== -1, [r[0].status, ids]);
    var prev = ((r[0].body || {}).sections || []).filter(function (s) { return s.id === 'previous-edition-speakers'; })[0];
    check('ED-046: a section built from the previous edition\'s records is not asked about', prev && prev.ai === false, prev);
    check('BE-032: …its sections served from there', r[1].status === 200 && /Old agenda/.test(r[1].body.html), r[1]);
    check('BE-032: GET /api/event leaves the older field\'s markup out too', r[2].status === 200 && !('generatedSections' in r[2].body), Object.keys(r[2].body || {}));
    check('BE-032: reading never moves an older site', JSON.stringify(FB.docs['events/ev-legacy']) === before, '');
  });
});

/* ================= the owner's logo, on either kind of site (saveOwnerUnit) ================= */
step(function () {
  var unitOld = genDesign.logoUnitImageHtml({ url: 'https://storage.googleapis.com/test-bucket/events/x/old-unit.png', alt: 'X', width: 400, height: 120, mode: 'light' });
  var hero = genDesign.heroHtml({ unit: unitOld, tagline: 'T', date: '1 Jan', place: 'Pune', mode: 'light', themeColor: '#123456', image: '', primary: null, secondary: null });
  var heroCss = genDesign.heroCss({ mode: 'light', themeColor: '#123456', image: '' });
  /* a site generated now: its hero in its run's document */
  FB.docs['events/ev-unit'] = { name: 'Unit', createdAt: NOW, portal: '', designPlan: { design: Object.assign({}, DESIGN, { logoUnitUrl: 'https://storage.googleapis.com/test-bucket/events/x/old-unit.png' }), sections: [] },
    generatedSite: { runId: R1, at: NOW, sections: [{ id: 'hero', kind: 'hero' }] } };
  FB.docs['events/ev-unit/generations/' + R1 + '/sections/hero'] = { id: 'hero', kind: 'hero', html: hero, css: heroCss, order: 0 };
  /* a site generated before: its hero on its document */
  FB.docs['events/ev-unit-old'] = { name: 'Unit old', createdAt: NOW, portal: '', designPlan: { design: Object.assign({}, DESIGN, { logoUnitUrl: 'https://storage.googleapis.com/test-bucket/events/x/old-unit.png' }), sections: [] },
    generatedSections: [{ id: 'hero', kind: 'hero', html: hero, css: heroCss }] };
  var unit = { url: 'https://storage.googleapis.com/test-bucket/events/x/new-unit.png', width: 400, height: 120, source: 'owner', plate: true, note: '' };
  return Promise.all([H.saveOwnerUnit(FB, 'ev-unit', unit), H.saveOwnerUnit(FB, 'ev-unit-old', unit)]).then(function (out) {
    var runHero = FB.docs['events/ev-unit/generations/' + R1 + '/sections/hero'].html, oldHero = FB.docs['events/ev-unit-old'].generatedSections[0].html;
    check('BE-032: the owner\'s logo goes into the hero kept in the run\'s document', out[0].heroUpdated === true && runHero.indexOf('new-unit.png') !== -1 && !('generatedSections' in FB.docs['events/ev-unit']), [out[0], runHero.slice(0, 200)]);
    check('BE-032: …and into the hero kept on an older site\'s document', out[1].heroUpdated === true && oldHero.indexOf('new-unit.png') !== -1, out[1]);
  });
});

/* ================= a copied event takes its site's sections with it (clone) ================= */
step(function () {
  FB.files['events/ev-run/generated/hero-bg.png'] = Buffer.from('png');
  return call('POST', '/api/event/clone', { sourceEventId: 'ev-run', eventId: 'ev-run-copy', name: 'Run Summit copy' }).then(function (r) {
    var copy = FB.docs['events/ev-run-copy'] || {}, runId = copy.generatedSite && copy.generatedSite.runId;
    check('BE-032: the copy is made', r.status === 200 && runId === R3 && copy.templateId === 'gen-ev-run-copy', [r.status, r.body, copy.generatedSite]);
    var docs = under('events/ev-run-copy/generations/' + runId + '/sections/');
    check('BE-032: …with its site\'s sections under the same run', docs.length === 5 && docs.length === under('events/ev-run/generations/' + runId + '/sections/').length, docs);
    return call('GET', '/api/generated-section?eventId=ev-run-copy&id=agenda');
  }).then(function (r) {
    check('BE-032: …and the copy opens: its sections are served', r.status === 200 && /Words about agenda/.test(r.body.html), [r.status, r.body && r.body.error]);
  });
});

/* ================= BE-035: a site the first pipeline made ================= */
step(function () {
  var before = JSON.stringify(FB.docs['events/ev-first']);
  return call('GET', '/api/generated-template?eventId=ev-first').then(function (r) {
    check('BE-035: answered as what it is (409 earlier-ai-design), with a sentence to show', r.status === 409 && r.body.code === 'earlier-ai-design' && /earlier version of ETB2B AI/.test(r.body.error) && r.body.published === true, [r.status, r.body]);
    check('BE-035: …and not changed by asking', JSON.stringify(FB.docs['events/ev-first']) === before);
    check('BE-035: earlierPipelineSite: only a structure plan with no design and no sections', H.earlierPipelineSite(FB.docs['events/ev-first']) && !H.earlierPipelineSite(FB.docs['events/ev-run']) && !H.earlierPipelineSite({ structurePlan: { sections: [] }, designPlan: { design: {} } }));
    /* "Make the site again" from what the event has on record: a run that reads the event's brief and pages */
    FB.docs['events/ev-first/briefs/b0'] = { extracted: { theme: 'FIRST EVENT BRIEF ON RECORD' }, createdAt: '2026-10-08T00:00:00.000Z' };
    scripted['plan-structure'] = [planAnswer(['agenda'])];
    var R5 = 'run-' + (Date.parse('2026-11-13T14:00:00Z')).toString(36) + '-eeeeee', n = prompts.length;
    return call('POST', '/api/plan-structure', { eventId: 'ev-first', runId: R5, useEventInputs: true, siteMode: 'advanced' }).then(function (p) {
      var asked = prompts.slice(n).filter(function (x) { return x.route === 'plan-structure'; })[0] || { prompt: '' };
      check('BE-035: making it again reads the brief the event has on record', p.status === 200 && asked.prompt.indexOf('FIRST EVENT BRIEF ON RECORD') !== -1, [p.status, asked.prompt.slice(0, 200)]);
      check('BE-035: …and the plan waits with the run: the event is unchanged until the pages are written', !FB.docs['events/ev-first'].designPlan && FB.docs['events/ev-first'].structurePlan, '');
      scriptWriting(['agenda'], 6);
      return call('POST', '/api/generate-content', { eventId: 'ev-first', runId: R5, useEventInputs: true, templateId: 'gen-ev-first' });
    }).then(function (g) {
      var ev = FB.docs['events/ev-first'];
      check('BE-035: once written, the event has a site the editor opens', g.status === 200 && ev.designPlan && ev.generatedSite && ev.structurePlan === null && !H.earlierPipelineSite(ev), [g.status, g.body]);
      check('BE-035: the brief it was made from stays (made from what the event had)', !!FB.docs['events/ev-first/briefs/b0'], '');
    });
  });
});

/* ================= a Viewer never starts a paid step, a run included ================= */
step(function () {
  var n = calls.length;
  return call('POST', '/api/plan-structure', { eventId: 'ev-run', runId: R3 }, 'vic').then(function (r) {
    check('a Viewer cannot start a run (403)', r.status === 403 && calls.length === n, [r.status, r.body]);
  });
});

/* ---------- run ---------- */
steps.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve()).then(function () {
  console.log('generation-runs: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error('generation-runs: the run stopped — ' + (err && err.stack || err));
  process.exit(1);
});
