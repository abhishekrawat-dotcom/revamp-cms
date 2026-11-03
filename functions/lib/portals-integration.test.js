/* node functions/lib/portals-integration.test.js — every Oneworld 2.0 event belongs to one ET portal, end to end:
   the real router (lib/api.js handleApi) with the real lib/event-portal.js, lib/working-portal.js, lib/api-forms.js
   and lib/promo.js behind it, against an in-memory Firestore, and the browser's own portal-picker.js talking to that
   router as a signed-in page would. Each unit has its own test with stand-ins for its neighbours; this one checks
   that the pieces fit: a portal chosen in Create Event is listed, changed, read back, filled in from certain evidence
   only, remembered for the person, and is the one the consent links and the Promotions kit show; another portal's
   edition is refused before anything is fetched or asked of a model; and the four new routes need a sign-in.
   The model, every fetch and ET's lists are stubs that count calls. No network. Exits 1 on failure.
   Written for the owner's decisions of 3 Nov 2026 (portals). */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

delete process.env.K_SERVICE;
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

/* ---------- an in-memory Firestore: documents by path; queries keep where (==), select, orderBy and limit;
   transactions apply their writes only when the function resolves; every write is logged ---------- */
var DOCS = {}, WRITES = [], seq = 0;
function setPath(obj, key, value) {
  var parts = key.split('.'), o = obj;
  for (var i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = clone(value);
}
function pick(data, fields) {
  var only = {};
  fields.forEach(function (f) {
    var parts = f.split('.'), v = data;
    for (var i = 0; i < parts.length && v != null; i++) v = v[parts[i]];
    if (v !== undefined) setPath(only, f, v);
  });
  return only;
}
function snapOf(p, fields) {
  var d = DOCS[p];
  var data = d ? clone(d) : undefined;
  if (data && fields) data = pick(data, fields);
  return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return data === undefined ? undefined : clone(data); } };
}
function write(p, op, data, opts) {
  WRITES.push({ path: p, op: op, data: clone(data) });
  if (op === 'delete') { delete DOCS[p]; return; }
  if (op === 'update' && !DOCS[p]) throw new Error('NOT_FOUND: ' + p);
  if (op === 'set' && !(opts && opts.merge)) DOCS[p] = {};
  if (!DOCS[p]) DOCS[p] = {};
  Object.keys(data || {}).forEach(function (k) { setPath(DOCS[p], k, data[k]); });
}
function docRef(p) {
  return { id: p.split('/').pop(), path: p,
    collection: function (n) { return colRef(p + '/' + n); },
    get: function () { return Promise.resolve(snapOf(p)); },
    set: function (data, o) { write(p, 'set', data, o); return Promise.resolve(); },
    update: function (data) { try { write(p, 'update', data); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
    delete: function () { write(p, 'delete'); return Promise.resolve(); } };
}
function colRef(p, q) {
  q = q || { filters: [], fields: null, lim: 0, order: null };
  function next(change) { return colRef(p, Object.assign({}, q, change)); }
  return { path: p,
    doc: function (id) { return docRef(p + '/' + (id || ('auto' + String(++seq).padStart(12, '0')))); },
    add: function (data) { var r = docRef(p + '/auto' + String(++seq).padStart(12, '0')); write(r.path, 'set', data); return Promise.resolve(r); },
    where: function (f, op, v) { return next({ filters: q.filters.concat([[f, op, v]]) }); },
    select: function () { return next({ fields: [].slice.call(arguments) }); },
    orderBy: function (f, dir) { return next({ order: { f: f, desc: dir === 'desc' } }); },
    limit: function (n) { return next({ lim: n }); },
    get: function () {
      var list = Object.keys(DOCS).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).sort()
        .filter(function (k) { return q.filters.every(function (w) { return w[1] === '==' && DOCS[k][w[0]] === w[2]; }); })
        .map(function (k) { return snapOf(k, q.fields); });
      if (q.order) list.sort(function (a, b) { var x = a.data()[q.order.f], y = b.data()[q.order.f]; return (x < y ? -1 : x > y ? 1 : 0) * (q.order.desc ? -1 : 1); });
      if (q.lim) list = list.slice(0, q.lim);
      return Promise.resolve({ docs: list, size: list.length, empty: !list.length });
    } };
}
var FB = {
  db: {
    collection: function (n) { return colRef(n); },
    getAll: function () {
      var a = [].slice.call(arguments), mask = null;
      if (a.length && a[a.length - 1] && a[a.length - 1].fieldMask) mask = a.pop().fieldMask;
      return Promise.resolve(a.map(function (r) { return snapOf(r.path, mask); }));
    },
    runTransaction: function (fn) {
      var queued = [];
      var tx = {
        get: function (x) { return x.get(); },
        set: function (ref, data, o) { queued.push([ref.path, 'set', data, o]); return tx; },
        update: function (ref, data) { queued.push([ref.path, 'update', data]); return tx; },
        create: function (ref, data) { queued.push([ref.path, 'set', data]); return tx; },
        delete: function (ref) { queued.push([ref.path, 'delete']); return tx; }
      };
      return Promise.resolve().then(function () { return fn(tx); }).then(function (out) {
        queued.forEach(function (w) { write(w[0], w[1], w[2], w[3]); });
        return out;
      });
    },
    batch: function () {
      var queued = [];
      return { set: function (ref, data, o) { queued.push([ref.path, 'set', data, o]); }, update: function (ref, data) { queued.push([ref.path, 'update', data]); },
        delete: function (ref) { queued.push([ref.path, 'delete']); }, create: function (ref, data) { queued.push([ref.path, 'set', data]); },
        commit: function () { queued.forEach(function (w) { write(w[0], w[1], w[2], w[3]); }); return Promise.resolve(); } };
    }
  },
  bucket: {
    name: 'test-bucket',
    getFiles: function () { return Promise.resolve([[]]); },
    file: function (name) {
      return { name: name, save: function () { return Promise.resolve(); }, delete: function () { return Promise.resolve(); },
        exists: function () { return Promise.resolve([false]); },
        download: function () { var e = new Error('No such object: ' + name); e.code = 404; return Promise.reject(e); } };
    }
  },
  auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };

/* the network and the model, stubbed and counted, before any module that holds them is loaded */
var SAFE_FETCHES = [];
var SAFE_FETCH = require.resolve('./safe-fetch');
require.cache[SAFE_FETCH] = { id: SAFE_FETCH, filename: SAFE_FETCH, loaded: true, children: [], paths: [],
  exports: Object.assign({}, require('./safe-fetch'), {
    safeFetch: function (url) { SAFE_FETCHES.push(String(url)); return Promise.reject(new Error('stand-in: no network here')); }
  }) };
delete require.cache[SAFE_FETCH].exports.__esModule;
var llm = require('./llm');
var MODEL_CALLS = 0, FETCHES = [];
llm.callJson = function () { MODEL_CALLS++; return Promise.resolve({ error: 'stub: no model in this test', code: 'ai-unavailable' }); };
global.fetch = function (url) { FETCHES.push(String(url)); return Promise.resolve({ ok: false, status: 404, text: function () { return Promise.resolve(''); } }); };
var etEvents = require('./et-events');
var ET_LISTS = [];
etEvents.listIpEvents = function (portal) { ET_LISTS.push('event:' + portal); return Promise.resolve([]); };
etEvents.listAwards = function (portal) { ET_LISTS.push('award:' + portal); return Promise.resolve([]); };

var forms = require('./forms');
var api = require('./api');

/* one request through the router, as the person `who` ('maker' when left out; null: signed out) */
function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var h = { host: 'cms.example' };
    if (who !== null) h.authorization = 'Bearer ' + (who || 'maker');
    if (body !== undefined) h['content-type'] = 'application/json';
    var raw = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    var req = { method: method, url: url, headers: h, socket: { remoteAddress: '127.0.0.1' }, rawBody: Buffer.from(raw) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, hh) { res.statusCode = s; Object.keys(hh || {}).forEach(function (k) { res.headers[k.toLowerCase()] = hh[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b == null ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json: j, text: t }); } };
    api.handleApi(req, res);
  });
}
var T0 = '2026-10-01T00:00:00.000Z';
function seed(id, data, sources) {
  DOCS['events/' + id] = Object.assign({ name: id, createdAt: T0, updatedAt: T0, detailsUpdatedAt: T0, status: 'draft' }, data || {});
  (sources || []).forEach(function (s, i) { DOCS['events/' + id + '/sources/s' + i] = clone(s); });
}
function linesOf(id, action) {
  var pre = 'events/' + id + '/activity/';
  return Object.keys(DOCS).filter(function (k) { return k.indexOf(pre) === 0; }).sort().map(function (k) { return DOCS[k]; })
    .filter(function (l) { return !action || l.action === action; });
}

/* portal-picker.js, the browser's one roster and working-portal client, run as a signed-in page runs it: its
   RevampAuth.authedFetch goes through the same router, as `maker` */
function pickerPage(who) {
  var store = {};
  var win = {
    RevampAuth: {
      currentUser: function () { return { uid: 'u-' + who }; },
      authedFetch: function (url, opts) {
        opts = opts || {};
        return call(opts.method || 'GET', url, opts.body === undefined ? undefined : opts.body, who).then(function (r) {
          return { status: r.status, ok: r.status >= 200 && r.status < 300, text: function () { return Promise.resolve(r.text); } };
        });
      }
    },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    }
  };
  win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'portal-picker.js'), 'utf8'), win);
  return { RP: win.RevampPortals, store: store };
}

(async function () {
  var r;

  /* ---------- 1. Create Event (hr) → the list → Set portal (cio) → the console's read ---------- */
  r = await call('POST', '/api/event', { eventId: 'pi-hr', slug: 'pi-hr', status: 'draft', name: 'People Leaders Summit 2027', category: 'ip', portal: 'hr' });
  check('1 create on ETHRWorld: 200', r.status === 200 && r.json && r.json.ok === true, r.json);
  check('1 … stored portal "hr", portalFrom "create"', DOCS['events/pi-hr'] && DOCS['events/pi-hr'].portal === 'hr' && DOCS['events/pi-hr'].portalFrom === 'create', DOCS['events/pi-hr']);
  r = await call('POST', '/api/event', { eventId: 'pi-old-page', slug: 'pi-old-page', name: 'From a page opened before the deploy' });
  check('1 a create with no portal (a page opened before the deploy): 400 portal-required, nothing written',
    r.status === 400 && r.json.code === 'portal-required' && !DOCS['events/pi-old-page'], r.json);
  await wait();
  r = await call('GET', '/api/events');
  var row = ((r.json && r.json.items) || []).filter(function (i) { return i.id === 'pi-hr'; })[0] || {};
  check('1 the dashboard\'s list: portal "hr", portalName "ETHRWorld", and the two facts Set portal needs',
    r.status === 200 && row.portal === 'hr' && row.portalName === 'ETHRWorld' && typeof row.hasGeneratedSite === 'boolean' && typeof row.published === 'boolean', row);
  r = await call('PATCH', '/api/event', { eventId: 'pi-hr', portal: 'cio', ifPortal: 'hr' });
  check('1 Set portal to ETCIO with ifPortal "hr": 200', r.status === 200 && r.json.ok === true, r.json);
  r = await call('PATCH', '/api/event', { eventId: 'pi-hr', portal: 'auto', ifPortal: 'hr' });
  check('1 a second page that still shows ETHRWorld: 409 portal-changed naming ETCIO', r.status === 409 && r.json.code === 'portal-changed' && r.json.current === 'cio' && r.json.currentName === 'ETCIO', r.json);
  r = await call('GET', '/api/event?eventId=pi-hr');
  check('1 the console\'s read: portal "cio", portalFrom "set", portalName "ETCIO"', r.status === 200 && r.json.portal === 'cio' && r.json.portalFrom === 'set' && r.json.portalName === 'ETCIO', r.json);
  await wait();
  var sets = linesOf('pi-hr', 'portal-set');
  check('1 the History: "created", then "ETHRWorld (chosen in Create Event)", then "ETHRWorld → ETCIO"',
    linesOf('pi-hr')[0] && linesOf('pi-hr')[0].action === 'created' && sets.length === 2 &&
    sets[0].detail === 'ETHRWorld (chosen in Create Event)' && sets[1].detail === 'ETHRWorld → ETCIO', linesOf('pi-hr').map(function (l) { return l.action + ': ' + l.detail; }));

  /* ---------- 2. existing events: the evidence report, the owner's ticks, the backfill, the report again ---------- */
  var HR_RECORD = { type: 'previousEdition', url: 'https://hr.economictimes.indiatimes.com/people-summit-2025', previous: { portal: 'hr', url: 'https://hr.economictimes.indiatimes.com/people-summit-2025' } };
  seed('pi-cert-record', { name: 'People Summit 2026' }, [HR_RECORD]);
  seed('pi-cert-link', { name: 'Annual Tech Conclave' }, [{ type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/annual-conclave-2025' }]);
  seed('pi-cert-design', { name: 'Store Leaders Meet', designPlan: { reference: { type: 'previousEdition', url: 'https://retail.economictimes.indiatimes.com/store-leaders-2025' } } });
  seed('pi-name-blocked', { name: 'ETCIO People Forum' }, [HR_RECORD]);
  seed('pi-site-only', { name: 'Mobility Meet', generatedSections: [{ id: 'nav', html: '<img src="/templates/_shared/img/portals/auto.png">' }] });
  seed('pi-conflict', { name: 'Leaders Week', designPlan: { reference: { type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/x' } } }, [HR_RECORD]);
  seed('pi-none', { name: 'Plain Event' }, [{ type: 'competitor', url: 'https://cio.economictimes.indiatimes.com/y' }]);
  seed('pi-has', { name: 'Banking Forum', portal: 'bfsi', portalFrom: 'set' }, [HR_RECORD]);
  seed('pi-deleted', { name: 'Gone', deletedAt: '2026-10-02T00:00:00.000Z' }, [HR_RECORD]);

  r = await call('GET', '/api/events/portal-evidence');
  var rep = r.json || {};
  function itemOf(report, id) { return ((report && report.items) || []).filter(function (i) { return i.eventId === id; })[0] || null; }
  check('2 the evidence report: 200, canFill (no approvers named), every live named event', r.status === 200 && rep.canFill === true && Array.isArray(rep.items) &&
    !itemOf(rep, 'pi-deleted') && !!itemOf(rep, 'pi-none') && !!itemOf(rep, 'pi-hr'), [r.status, rep.counts]);
  check('2 certain from the previous edition\'s ET record', (itemOf(rep, 'pi-cert-record') || {}).certain === 'hr' && itemOf(rep, 'pi-cert-record').from === 'et-record' &&
    itemOf(rep, 'pi-cert-record').certainName === 'ETHRWorld', itemOf(rep, 'pi-cert-record'));
  check('2 certain from a typed ET link, hinted link-only', (itemOf(rep, 'pi-cert-link') || {}).certain === 'cio' && itemOf(rep, 'pi-cert-link').hints.indexOf('link-only') !== -1, itemOf(rep, 'pi-cert-link'));
  check('2 certain from the design\'s reference, hinted design-only', (itemOf(rep, 'pi-cert-design') || {}).certain === 'retail' && itemOf(rep, 'pi-cert-design').hints.indexOf('design-only') !== -1, itemOf(rep, 'pi-cert-design'));
  check('2 a name that names another portal blocks it', (itemOf(rep, 'pi-name-blocked') || {}).certain === '' && itemOf(rep, 'pi-name-blocked').blockers.indexOf('name-mentions:cio') !== -1, itemOf(rep, 'pi-name-blocked'));
  check('2 the generated bar alone is never enough (site-only)', (itemOf(rep, 'pi-site-only') || {}).certain === '' && itemOf(rep, 'pi-site-only').blockers.indexOf('site-only') !== -1, itemOf(rep, 'pi-site-only'));
  check('2 two portals are a conflict', (itemOf(rep, 'pi-conflict') || {}).certain === '' && JSON.stringify(itemOf(rep, 'pi-conflict').conflict) === JSON.stringify(['cio', 'hr']), itemOf(rep, 'pi-conflict'));
  check('2 a competitor\'s page is no evidence', (itemOf(rep, 'pi-none') || {}).certain === '' && itemOf(rep, 'pi-none').evidence.length === 0, itemOf(rep, 'pi-none'));
  check('2 an event with a portal keeps it, and its other evidence only "disagrees"', (itemOf(rep, 'pi-has') || {}).portal === 'bfsi' && itemOf(rep, 'pi-has').certain === '' &&
    JSON.stringify(itemOf(rep, 'pi-has').disagrees) === JSON.stringify(['hr']), itemOf(rep, 'pi-has'));
  check('2 the counts', rep.counts && rep.counts.certain === 3 && rep.counts.blocked === 2 && rep.counts.conflict === 1 && rep.counts.withPortal >= 2, rep.counts);
  check('2 the report wrote nothing', WRITES.filter(function (w) { return /^events\/pi-(cert|name|site|conflict|none|has)/.test(w.path); }).length === 0);

  /* what the review page sends: the ticked (event, portal) pairs as it showed them; here also three it would not */
  var before = clone(DOCS['events/pi-cert-record']);
  r = await call('POST', '/api/events/portal-backfill', { items: [
    { eventId: 'pi-cert-record', portal: 'hr' }, { eventId: 'pi-cert-link', portal: 'cio' }, { eventId: 'pi-cert-design', portal: 'retail' },
    { eventId: 'pi-name-blocked', portal: 'hr' }, { eventId: 'pi-has', portal: 'hr' }, { eventId: 'pi-site-only', portal: 'cio' }, { eventId: 'pi-nowhere', portal: 'hr' }
  ] });
  var results = {};
  ((r.json && r.json.results) || []).forEach(function (x) { results[x.eventId] = x; });
  check('2 the backfill: 200, one answer per pair', r.status === 200 && Object.keys(results).length === 7, r.json);
  check('2 … the three certain ones are set', ['pi-cert-record', 'pi-cert-link', 'pi-cert-design'].every(function (id) { return results[id] && results[id].status === 'set'; }) &&
    DOCS['events/pi-cert-record'].portal === 'hr' && DOCS['events/pi-cert-link'].portal === 'cio' && DOCS['events/pi-cert-design'].portal === 'retail', results);
  check('2 … with portalFrom "backfill", and updatedAt / detailsUpdatedAt left as they were', DOCS['events/pi-cert-record'].portalFrom === 'backfill' &&
    DOCS['events/pi-cert-record'].updatedAt === before.updatedAt && DOCS['events/pi-cert-record'].detailsUpdatedAt === before.detailsUpdatedAt, DOCS['events/pi-cert-record']);
  check('2 … the rest are skipped for their reasons, and nothing of theirs is written',
    (results['pi-name-blocked'] || {}).reason === 'blocked' && (results['pi-has'] || {}).reason === 'has-portal' && (results['pi-site-only'] || {}).reason === 'blocked' &&
    (results['pi-nowhere'] || {}).reason === 'not-found' && !DOCS['events/pi-name-blocked'].portal && DOCS['events/pi-has'].portal === 'bfsi' && !DOCS['events/pi-site-only'].portal && !DOCS['events/pi-nowhere'], results);
  await wait();
  var filled = linesOf('pi-cert-record', 'portal-set')[0] || {};
  check('2 … each fill-in is one "portal-set" line in its History, in words', filled.area === 'event' && filled.detail === 'No portal → ETHRWorld (filled in from its previous edition\'s ET record)' &&
    JSON.stringify(filled.fields) === JSON.stringify([{ field: 'portal', before: 'No portal', after: 'ETHRWorld' }]), filled);
  r = await call('POST', '/api/events/portal-backfill', { items: [{ eventId: 'pi-cert-record', portal: 'hr' }] });
  check('2 pressing again sets nothing twice', r.status === 200 && r.json.results[0].status === 'skipped' && r.json.results[0].reason === 'has-portal' && linesOf('pi-cert-record', 'portal-set').length === 1, r.json);
  r = await call('GET', '/api/events/portal-evidence');
  var again = r.json || {};
  check('2 the report again: nothing certain is left, and the three are listed with their portals', again.counts && again.counts.certain === 0 &&
    (itemOf(again, 'pi-cert-record') || {}).portal === 'hr' && (itemOf(again, 'pi-cert-record') || {}).portalFrom === 'backfill', again.counts);
  r = await call('GET', '/api/events');
  var listed = {};
  ((r.json && r.json.items) || []).forEach(function (i) { listed[i.id] = i; });
  check('2 the dashboard lists them on their portals now, and the rest still with none', (listed['pi-cert-link'] || {}).portalName === 'ETCIO' && (listed['pi-cert-design'] || {}).portalName === 'ETRetail' &&
    (listed['pi-none'] || {}).portal === '' && (listed['pi-name-blocked'] || {}).portal === '', [listed['pi-cert-link'], listed['pi-none']]);
  DOCS['config/approvals'] = { approvers: ['owner@timesinternet.in'] };
  seed('pi-cert-late', { name: 'People Summit 2025' }, [HR_RECORD]);
  r = await call('GET', '/api/events/portal-evidence');
  check('2 with approvers named, the report says this person cannot fill in', r.status === 200 && r.json.canFill === false && JSON.stringify(r.json.approvers) === JSON.stringify(['owner@timesinternet.in']), r.json && r.json.canFill);
  r = await call('POST', '/api/events/portal-backfill', { items: [{ eventId: 'pi-cert-late', portal: 'hr' }] });
  check('2 … and the backfill answers 403 not-an-approver, writing nothing', r.status === 403 && r.json.code === 'not-an-approver' && !DOCS['events/pi-cert-late'].portal, r.json);
  r = await call('POST', '/api/events/portal-backfill', { items: [{ eventId: 'pi-cert-late', portal: 'hr' }] }, 'owner');
  check('2 … the approver can', r.status === 200 && r.json.results[0].status === 'set' && DOCS['events/pi-cert-late'].portal === 'hr', r.json);
  delete DOCS['config/approvals'];

  /* ---------- 3. the working portal: the server's routes, and the page's own client against them ---------- */
  r = await call('GET', '/api/me/working-portal');
  check('3 GET before any choice: null', r.status === 200 && r.json.workingPortal === null, r.json);
  r = await call('PUT', '/api/me/working-portal', { workingPortal: 'hrworld' });
  check('3 PUT a slug off the roster: 400 unknown-portal', r.status === 400 && r.json.code === 'unknown-portal', r.json);
  r = await call('PUT', '/api/me/working-portal', { workingPortal: 'hr' });
  check('3 PUT "hr": 200', r.status === 200 && r.json.ok === true && r.json.workingPortal === 'hr', r.json);
  r = await call('GET', '/api/me/working-portal');
  check('3 GET: "hr", kept for this person', r.status === 200 && r.json.workingPortal === 'hr' && DOCS['userPrefs/u-maker'] && DOCS['userPrefs/u-maker'].email === 'maker@timesinternet.in', r.json);
  r = await call('GET', '/api/me/working-portal', undefined, 'owner');
  check('3 another person has their own (none yet)', r.status === 200 && r.json.workingPortal === null, r.json);

  var page = pickerPage('maker');
  var roster = await page.RP.list();
  check('3 portal-picker.js reads the real roster through GET /api/et/portals', roster.length === etEvents.portalList().length &&
    JSON.stringify(roster) === JSON.stringify(etEvents.portalList()), roster.length);
  check('3 … and names a portal from it', page.RP.nameOf('hr') === 'ETHRWorld' && page.RP.nameOf('techmonk') === 'TechMonk' && page.RP.nameOf('hrworld') === '');
  check('3 … its options mark the current portal', /<option value="hr" selected>ETHRWorld<\/option>/.test(page.RP.optionsHtml('hr', 'Choose a portal')));
  var w = await page.RP.working();
  check('3 working(): the server\'s choice ("hr"), now cached in this browser for the first paint', w === 'hr' && page.RP.cachedWorking() === 'hr' && /"portal":"hr"/.test(page.store['rv.workingPortal.u-maker'] || ''), [w, page.store]);
  await page.RP.setWorking('all');
  r = await call('GET', '/api/me/working-portal');
  check('3 setWorking("all") is saved for the person (All portals is a choice too)', r.json.workingPortal === 'all' && page.RP.cachedWorking() === 'all', r.json);
  var refused = await page.RP.setWorking('hrworld').then(function () { return null; }, function (e) { return e; });
  check('3 setWorking of a slug off the roster is refused before anything is sent', refused && /Unknown portal/.test(refused.message) && DOCS['userPrefs/u-maker'].workingPortal === 'all', refused && refused.message);
  var fresh = pickerPage('maker');
  check('3 another browser of the same person: nothing cached, the server\'s choice arrives', fresh.RP.cachedWorking() === null && (await fresh.RP.working()) === 'all');

  /* ---------- 4. the consent links of a registration form follow the stored portal ---------- */
  var CIO_SOURCE = { type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/annual-conclave-2025', previous: { portal: 'cio' } };
  seed('pi-forms-hr', { name: 'People Forum', portal: 'hr', published: true }, [CIO_SOURCE]);
  seed('pi-forms-none', { name: 'Older Forum', published: true }, [CIO_SOURCE]);
  seed('pi-forms-retail-none', { name: 'Store Forum', published: true }, [{ type: 'previousEdition', url: 'https://retail.economictimes.indiatimes.com/x' }]);
  r = await call('GET', '/api/public/forms?eventId=pi-forms-hr', undefined, null);
  var c = r.json && r.json.consent;
  check('4 GET /api/public/forms (signed out, a published event on ETHRWorld whose sources say ETCIO): ETHRWorld\'s links',
    r.status === 200 && c && c.version === forms.consentFor('hr').version && JSON.stringify(c).indexOf('https://hr.economictimes.indiatimes.com/') !== -1 &&
    JSON.stringify(c).indexOf('cio.economictimes') === -1, [r.status, c]);
  r = await call('GET', '/api/public/forms?eventId=pi-forms-none', undefined, null);
  check('4 an event with no portal yet keeps the links it was published with (its sources: ETCIO)', r.status === 200 && r.json.consent && r.json.consent.version === forms.consentFor('cio').version, r.json && r.json.consent);
  r = await call('GET', '/api/public/forms?eventId=pi-forms-retail-none', undefined, null);
  check('4 … and so does one whose sources say ETRetail', r.status === 200 && r.json.consent && r.json.consent.version === forms.consentFor('retail').version, r.json && r.json.consent);
  r = await call('PATCH', '/api/event', { eventId: 'pi-forms-none', portal: 'auto', ifPortal: '' });
  r = await call('GET', '/api/public/forms?eventId=pi-forms-none', undefined, null);
  check('4 once a portal is set, its links show at once (nothing kept from before is given)', r.status === 200 && r.json.consent && r.json.consent.version === forms.consentFor('auto').version, r.json && r.json.consent);

  /* ---------- 5. the Promotions kit carries the stored portal, never one worked out from the design ---------- */
  var GUESSABLE = { category: 'ip', start: '2027-02-10T09:00',
    designPlan: { design: { mode: 'light', themeColor: '#123456', headingFont: 'Inter', bodyFont: 'Inter', logoUnitFrom: 'https://brandequity.economictimes.indiatimes.com/y' },
      reference: { type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/x' }, sections: [] } };
  seed('pi-kit-hr', Object.assign({ name: 'People Kit Summit', portal: 'hr' }, clone(GUESSABLE)));
  seed('pi-kit-none', Object.assign({ name: 'No Portal Kit Summit' }, clone(GUESSABLE)));
  MODEL_CALLS = 0;
  r = await call('GET', '/api/promo/kit?eventId=pi-kit-hr');
  var bp = r.json && r.json.brand && r.json.brand.portal;
  check('5 GET /api/promo/kit: brand.portal is ETHRWorld with its wordmarks (the design from an ETCIO page, the logo unit from ET BrandEquity\'s)',
    r.status === 200 && bp && bp.slug === 'hr' && bp.name === 'ETHRWorld' && bp.logo === '/templates/_shared/img/portals/hr.png', [r.status, bp, r.json && r.json.error]);
  r = await call('GET', '/api/promo/kit?eventId=pi-kit-none');
  check('5 an event with no portal yet: brand.portal null', r.status === 200 && r.json.brand && r.json.brand.portal === null, [r.status, r.json && r.json.brand && r.json.brand.portal]);
  check('5 the kit asked no model', MODEL_CALLS === 0, MODEL_CALLS);

  /* ---------- 6. Ingest refuses another portal's edition before anything is fetched or asked ---------- */
  seed('pi-ing', { name: 'People Ingest Summit', portal: 'hr' });
  MODEL_CALLS = 0; FETCHES = []; SAFE_FETCHES = []; ET_LISTS = [];
  var ingWrites = WRITES.length;
  r = await call('POST', '/api/ingest-source', { eventId: 'pi-ing', type: 'previousEdition', url: 'https://cio.economictimes.indiatimes.com/annual-conclave-2025', etEvent: { portal: 'cio', id: '123' } });
  check('6 an ETCIO pick for an ETHRWorld event: 400 other-portal', r.status === 400 && r.json.code === 'other-portal' && r.json.eventPortal === 'hr' && r.json.pagePortal === 'cio', r.json);
  r = await call('POST', '/api/ingest-source', { eventId: 'pi-ing', type: 'currentEdition', url: 'https://cio.economictimes.indiatimes.com/annual-conclave-2026' });
  check('6 an ETCIO link for it: 400 other-portal', r.status === 400 && r.json.code === 'other-portal', r.json);
  check('6 … with 0 fetches, 0 model calls, no ET list read and nothing written', FETCHES.length === 0 && SAFE_FETCHES.length === 0 && MODEL_CALLS === 0 && ET_LISTS.length === 0 &&
    WRITES.slice(ingWrites).filter(function (x) { return x.path.indexOf('events/pi-ing') === 0; }).length === 0, [FETCHES, SAFE_FETCHES, MODEL_CALLS, ET_LISTS]);

  /* ---------- 7. the four new routes need a sign-in ---------- */
  var routes = [['GET', '/api/events/portal-evidence'], ['POST', '/api/events/portal-backfill', { items: [{ eventId: 'pi-none', portal: 'hr' }] }],
    ['GET', '/api/me/working-portal'], ['PUT', '/api/me/working-portal', { workingPortal: 'hr' }]];
  var outs = [];
  for (var i = 0; i < routes.length; i++) { r = await call(routes[i][0], routes[i][1], routes[i][2], null); outs.push(routes[i][0] + ' ' + routes[i][1] + ' ' + r.status); }
  check('7 signed out: 401 on all four', outs.every(function (o) { return / 401$/.test(o); }), outs);
  check('7 … and nothing was written', !DOCS['events/pi-none'].portal && !DOCS['userPrefs/u-null']);
})().then(null, function (err) { check('the checks ran without throwing', false, String(err && err.stack || err)); }).then(function () {
  if (failed) { console.error('portals-integration: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('portals-integration: all ' + passed + ' checks passed');
  process.exit(0);
});
