/* node functions/lib/event-portal-api.test.js — an event's ET portal on its own record (lib/api.js), through the real
   router against an in-memory Firestore: a portal is required on create and is a slug on et-events.js's roster and
   nothing else; a PATCH changes it (with `ifPortal`, so a portal set meanwhile is never put back) and never removes
   it; an unchanged portal writes nothing; each change is one "portal-set" line in the History; the list and the
   console read `portal` / `portalName`; Ingest refuses another portal's edition before anything is fetched or asked
   of a model; the site's ET bar and footer are the event's own portal (sitePortalOf); clone keeps the portal; and
   the four new routes reach lib/event-portal.js and lib/working-portal.js with this file's helpers, or answer 503
   when those are missing. The model and every fetch are stubs that count calls (both must stay at 0 where a page
   is refused). No network. Exits 1 on failure. Written for the owner's decisions of 3 Nov 2026 (portals). */
'use strict';
var fs = require('fs');
var path = require('path');
var Module = require('module');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); }

delete process.env.K_SERVICE;
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';

/* ---------- an in-memory Firestore: documents by path; queries keep where (==), select, orderBy and limit;
   transactions apply their writes only when the function resolves; every write is logged ---------- */
var DOCS = {}, WRITES = [], SELECTS = [], seq = 0;
function setPath(obj, key, value) {
  var parts = key.split('.'), o = obj;
  for (var i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = clone(value);
}
function snapOf(p, fields) {
  var d = DOCS[p];
  var data = d ? clone(d) : undefined;
  if (data && fields) { var only = {}; fields.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(data, f)) only[f] = data[f]; }); data = only; }
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
    select: function () { var fields = [].slice.call(arguments); SELECTS.push({ path: p, fields: fields }); return next({ fields: fields }); },
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
    getAll: function () { var a = [].slice.call(arguments); return Promise.resolve(a.filter(function (r) { return r && r.path; }).map(function (r) { return snapOf(r.path); })); },
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
    file: function (name) { return { name: name, save: function () { return Promise.resolve(); }, delete: function () { return Promise.resolve(); }, exists: function () { return Promise.resolve([false]); } }; }
  },
  auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };

/* the model and the network, stubbed and counted: a refused page must reach neither */
var llm = require('./llm');
var MODEL_CALLS = 0, FETCHES = [];
llm.callJson = function () { MODEL_CALLS++; return Promise.resolve({ error: 'stub: no model in this test', code: 'ai-unavailable' }); };
global.fetch = function (url) { FETCHES.push(String(url)); return Promise.resolve({ ok: false, status: 404, text: function () { return Promise.resolve(''); } }); };
/* Ingest reads the page through safeFetch (BE-026, 13 Nov 2026): the same count, the same 404, no network */
var SAFE_FETCH = require.resolve('./safe-fetch');
require.cache[SAFE_FETCH] = { id: SAFE_FETCH, filename: SAFE_FETCH, loaded: true, children: [], paths: [],
  exports: Object.assign({}, require('./safe-fetch'), {
    safeFetch: function (url) { FETCHES.push(String(url)); return Promise.resolve({ status: 404, headers: {}, body: Buffer.alloc(0), finalUrl: String(url) }); }
  }) };

/* lib/event-portal.js and lib/working-portal.js are another unit's: here they are stubbed (or made missing) for
   api.js's own require, so the wiring is checked the same way whether or not those files exist yet */
var STUBS = {};
var realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
  var key = String(request).replace(/^\.\//, '');
  if ((key === 'event-portal' || key === 'working-portal') && parent && /[\/\\]functions[\/\\]lib[\/\\]api\.js$/.test(parent.filename || '')) {
    if (!STUBS[key]) { var e = new Error('Cannot find module \'./' + key + '\''); e.code = 'MODULE_NOT_FOUND'; throw e; }
    var id = path.join(__dirname, '__stub__' + key + '.js');
    require.cache[id] = { id: id, filename: id, loaded: true, children: [], paths: [], exports: STUBS[key] };
    return id;
  }
  return realResolve.apply(this, arguments);
};

var activity = require('./activity');
var etEvents = require('./et-events');
/* ET's lists of a portal's editions (et-events.js), stubbed and counted: Ingest's portal check reads one only for a
   pick of the event's own portal whose address is another portal's (confirmEtPick). ET_LIST.event.hr = [{ id, link }];
   ET_DOWN makes every read fail, as ET's API not answering does. */
var ET_LISTS = [], ET_LIST = { event: {}, award: {} }, ET_DOWN = false;
function etListStub(kind) {
  return function (portal) {
    ET_LISTS.push(kind + ':' + portal);
    if (ET_DOWN) { var e = new Error('stub: ET down'); e.code = 'et-down'; return Promise.reject(e); }
    return Promise.resolve(clone(ET_LIST[kind][portal] || []));
  };
}
etEvents.listIpEvents = etListStub('event');
etEvents.listAwards = etListStub('award');
var api = require('./api');
var hooks = api._testHooks;

function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var h = { host: 'cms.example' };
    if (who !== null) h.authorization = 'Bearer ' + (who || 'maker');
    if (body) h['content-type'] = 'application/json';
    var req = { method: method, url: url, headers: h, socket: {}, rawBody: Buffer.from(body ? JSON.stringify(body) : '') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, hh) { res.statusCode = s; Object.keys(hh || {}).forEach(function (k) { res.headers[k.toLowerCase()] = hh[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b == null ? '' : String(b), j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json: j }); } };
    api.handleApi(req, res);
  });
}
function writesTo(p) { return WRITES.filter(function (w) { return w.path === p; }).length; }
function activityOf(id) {
  var pre = 'events/' + id + '/activity/';
  return Object.keys(DOCS).filter(function (k) { return k.indexOf(pre) === 0; }).sort().map(function (k) { return DOCS[k]; });
}
function linesOf(id, action) { return activityOf(id).filter(function (l) { return l.action === action; }); }
var T0 = '2026-10-01T00:00:00.000Z';
function seed(id, data) { DOCS['events/' + id] = Object.assign({ name: id, createdAt: T0, updatedAt: T0, detailsUpdatedAt: T0, status: 'draft' }, data || {}); }

(async function () {
  var r, ev;

  /* ---------- 1. create ---------- */
  r = await call('POST', '/api/event', { eventId: 'pa-none', name: 'No Portal Summit' });
  check('create with no portal: 400 portal-required on the portal field, with a sentence that says to reload an old page', r.status === 400 && r.json && r.json.code === 'portal-required' &&
    r.json.field === 'portal' && /^Choose the portal this event belongs to\. If this page has no Portal box, reload it\.$/.test(r.json.error), r.json);
  check('… and nothing is written', writesTo('events/pa-none') === 0 && !DOCS['events/pa-none']);
  r = await call('POST', '/api/event', { eventId: 'pa-none', name: 'No Portal Summit', portal: '' });
  check('create with an empty portal: the same portal-required', r.status === 400 && r.json.code === 'portal-required' && r.json.field === 'portal' && /^Choose the portal/.test(r.json.error), r.json);
  r = await call('POST', '/api/event', { eventId: 'pa-none', name: 'No Portal Summit', portal: null });
  check('create with portal null: the same portal-required', r.status === 400 && r.json.code === 'portal-required', r.json);
  var bads = ['hrworld', '__proto__', 'toString', 7, 'HR', ' hr', 'gov', {}];
  for (var b = 0; b < bads.length; b++) {
    r = await call('POST', '/api/event', { eventId: 'pa-none', name: 'No Portal Summit', portal: bads[b] });
    check('create with portal ' + JSON.stringify(bads[b]) + ': 400 unknown-portal on the portal field', r.status === 400 && r.json && r.json.code === 'unknown-portal' && r.json.field === 'portal' &&
      /^Unknown portal ".*"\.$/.test(r.json.error), r.json);
  }
  r = await call('POST', '/api/event', { eventId: 'pa-none', name: 'x', portal: 'a-very-long-portal-name-that-goes-on-and-on-and-on-for-ever' });
  check('the unknown value is quoted to 40 characters', r.json && r.json.error === 'Unknown portal "' + 'a-very-long-portal-name-that-goes-on-and-on-and-on-for-ever'.slice(0, 40) + '".', r.json);
  check('… none of those wrote anything', writesTo('events/pa-none') === 0);

  /* the address is decided first: a taken address still answers slug-taken, a bad one its own 400 */
  seed('pa-taken', { portal: 'cio' });
  r = await call('POST', '/api/event', { eventId: 'pa-taken', name: 'Taken' });
  check('no portal on a taken address: 409 slug-taken with a suggestion, as before (the address comes first)', r.status === 409 && r.json.code === 'slug-taken' && r.json.suggestion === 'pa-taken-2', r.json);
  r = await call('POST', '/api/event', { eventId: 'pa-taken', name: 'Taken', portal: '' });
  check('… an empty portal there too', r.status === 409 && r.json.code === 'slug-taken', r.json);
  r = await call('POST', '/api/event', { eventId: 'Bad Id!', name: 'Bad' });
  check('no portal on an invalid address: the address\'s own 400', r.status === 400 && /Invalid eventId/.test(r.json.error), r.json);

  r = await call('POST', '/api/event', { eventId: 'pa-hr', name: 'People Summit 2027', portal: 'hr' });
  ev = DOCS['events/pa-hr'];
  check('create with "hr": 200', r.status === 200 && r.json.ok === true && r.json.eventId === 'pa-hr', r.json);
  check('… stored as portal "hr", portalFrom "create"', ev && ev.portal === 'hr' && ev.portalFrom === 'create', ev);
  await wait();
  var acts = activityOf('pa-hr');
  check('… the History has "created" then "portal-set"', acts.length === 2 && acts[0].action === 'created' && acts[1].action === 'portal-set', acts.map(function (a) { return a.action; }));
  var ps = acts[1] || {};
  check('… "portal-set": "ETHRWorld (chosen in Create Event)", area event, by the person, with the before and after', ps.detail === 'ETHRWorld (chosen in Create Event)' && ps.area === 'event' &&
    ps.by === 'maker@timesinternet.in' && JSON.stringify(ps.fields) === JSON.stringify([{ field: 'portal', before: 'No portal', after: 'ETHRWorld' }]), ps);
  check('… the portal-set line is not earlier than created', String(ps.at) >= String(acts[0].at), [acts[0].at, ps.at]);
  r = await call('POST', '/api/event', { eventId: 'pa-hr2', name: 'Another', portal: 'hr', portalFrom: 'backfill' });
  check('portalFrom is the server\'s: a body cannot set it', r.status === 200 && DOCS['events/pa-hr2'].portalFrom === 'create', DOCS['events/pa-hr2']);

  /* ---------- 2. PATCH ---------- */
  var before = clone(DOCS['events/pa-hr']);
  await wait(5);
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: 'cio' });
  ev = DOCS['events/pa-hr'];
  check('PATCH { portal: "cio" } with no ifUpdatedAt: 200', r.status === 200 && r.json.ok === true && typeof r.json.updatedAt === 'string', r.json);
  check('… stored "cio", portalFrom "set", and both dates moved (a Set portal is an edit)', ev.portal === 'cio' && ev.portalFrom === 'set' &&
    ev.updatedAt === r.json.updatedAt && ev.detailsUpdatedAt === r.json.updatedAt && ev.detailsUpdatedAt > before.detailsUpdatedAt, ev);
  await wait();
  var sets = linesOf('pa-hr', 'portal-set');
  check('… one more "portal-set": "ETHRWorld → ETCIO" with its before and after', sets.length === 2 && sets[1].detail === 'ETHRWorld → ETCIO' && sets[1].area === 'event' &&
    JSON.stringify(sets[1].fields) === JSON.stringify([{ field: 'portal', before: 'ETHRWorld', after: 'ETCIO' }]), sets);
  check('… and no "updated" line names the portal', linesOf('pa-hr', 'updated').every(function (l) { return !/portal/.test(l.detail) && !(l.fields || []).some(function (f) { return f.field === 'portal' || f.field === 'portalFrom'; }); }), linesOf('pa-hr', 'updated'));

  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: 'cio', name: 'People Summit 2027 (renamed)' });
  await wait();
  check('the same portal again with a name: 200, the name is saved', r.status === 200 && DOCS['events/pa-hr'].name === 'People Summit 2027 (renamed)' && DOCS['events/pa-hr'].portal === 'cio');
  check('… no new portal-set line, and "updated" names only the name', linesOf('pa-hr', 'portal-set').length === 2 && linesOf('pa-hr', 'updated').length === 1 &&
    linesOf('pa-hr', 'updated')[0].detail === 'name', linesOf('pa-hr', 'updated'));
  check('… portalFrom is untouched', DOCS['events/pa-hr'].portalFrom === 'set');

  var stored = clone(DOCS['events/pa-hr']), n = writesTo('events/pa-hr');
  await wait(5);
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: 'cio' });
  await wait();
  check('the same portal as the only field: 200 with the stored updatedAt', r.status === 200 && r.json.ok === true && r.json.updatedAt === stored.updatedAt, [r.json, stored.updatedAt]);
  check('… nothing is written (detailsUpdatedAt unchanged) and nothing is logged', writesTo('events/pa-hr') === n && DOCS['events/pa-hr'].detailsUpdatedAt === stored.detailsUpdatedAt &&
    JSON.stringify(DOCS['events/pa-hr']) === JSON.stringify(stored) && linesOf('pa-hr', 'portal-set').length === 2 && linesOf('pa-hr', 'updated').length === 1);

  n = writesTo('events/pa-hr');
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: 'auto', ifPortal: '' });
  check('{ portal: "auto", ifPortal: "" } on an event now on cio: 409 portal-changed with the current portal and its name', r.status === 409 && r.json.code === 'portal-changed' &&
    r.json.current === 'cio' && r.json.currentName === 'ETCIO' && r.json.error === 'This event\'s portal was changed to ETCIO meanwhile. Reload to see it.', r.json);
  check('… and nothing is written', writesTo('events/pa-hr') === n && DOCS['events/pa-hr'].portal === 'cio');
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: 'auto', name: 'Lost?', ifPortal: 'hr' });
  check('a stale ifPortal refuses the whole PATCH, its other fields too', r.status === 409 && r.json.code === 'portal-changed' && DOCS['events/pa-hr'].name === 'People Summit 2027 (renamed)', r.json);
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: 'auto', ifPortal: 'cio' });
  await wait();
  check('{ portal: "auto", ifPortal: "cio" }: 200, stored "auto", one more line "ETCIO → ETAuto"', r.status === 200 && DOCS['events/pa-hr'].portal === 'auto' &&
    linesOf('pa-hr', 'portal-set').length === 3 && linesOf('pa-hr', 'portal-set')[2].detail === 'ETCIO → ETAuto', [r.json, linesOf('pa-hr', 'portal-set')]);
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: 'hr', ifPortal: 7 });
  check('an ifPortal that is not text: 400, nothing written', r.status === 400 && /ifPortal/.test(r.json.error) && DOCS['events/pa-hr'].portal === 'auto', r.json);

  n = writesTo('events/pa-hr');
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: '' });
  check('PATCH portal "": 400 portal-required, "can be changed, not removed"', r.status === 400 && r.json.code === 'portal-required' && r.json.field === 'portal' &&
    r.json.error === 'An event\'s portal can be changed, not removed. Choose another portal.', r.json);
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: null });
  check('PATCH portal null: 400 portal-required', r.status === 400 && r.json.code === 'portal-required', r.json);
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: 'hrworld' });
  check('PATCH portal "hrworld": 400 unknown-portal', r.status === 400 && r.json.code === 'unknown-portal' && r.json.field === 'portal', r.json);
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', portal: '__proto__' });
  check('PATCH portal "__proto__": 400 unknown-portal', r.status === 400 && r.json.code === 'unknown-portal', r.json);
  check('… none of those wrote anything', writesTo('events/pa-hr') === n && DOCS['events/pa-hr'].portal === 'auto');

  var setsBefore = linesOf('pa-hr', 'portal-set').length;
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr', name: 'X' });
  await wait();
  var lastUpdated = linesOf('pa-hr', 'updated').slice(-1)[0] || {};
  check('{ name: "X" }: the portal is unchanged and "updated" names only the name', r.status === 200 && DOCS['events/pa-hr'].portal === 'auto' && DOCS['events/pa-hr'].name === 'X' &&
    lastUpdated.detail === 'name' && linesOf('pa-hr', 'portal-set').length === setsBefore, lastUpdated);
  r = await call('PATCH', '/api/event', { eventId: 'pa-hr' });
  check('a PATCH with nothing in it is still "Nothing to update."', r.status === 400 && r.json.error === 'Nothing to update.', r.json);

  /* a stored value that is not on the roster is no portal: set from "none" */
  seed('pa-bad', { portal: 'hrworld' });
  r = await call('PATCH', '/api/event', { eventId: 'pa-bad', portal: 'hr', ifPortal: '' });
  await wait();
  check('an off-roster stored portal counts as none: ifPortal "" passes, and the line reads "No portal → ETHRWorld"', r.status === 200 && DOCS['events/pa-bad'].portal === 'hr' &&
    DOCS['events/pa-bad'].portalFrom === 'set' && (linesOf('pa-bad', 'portal-set')[0] || {}).detail === 'No portal → ETHRWorld', [r.json, linesOf('pa-bad', 'portal-set')]);
  seed('pa-bad2', { portal: 'hrworld' });
  r = await call('PATCH', '/api/event', { eventId: 'pa-bad2', portal: 'hr', ifPortal: 'hrworld' });
  check('… and so is an off-roster ifPortal (the page may show what GET gave it)', r.status === 200 && DOCS['events/pa-bad2'].portal === 'hr', r.json);

  /* Set portal from the dashboard: an event with no portal yet */
  seed('pa-old', { name: 'Old Event' });
  r = await call('PATCH', '/api/event', { eventId: 'pa-old', portal: 'retail', ifPortal: '' });
  await wait();
  check('Set portal on an event with none: 200, "No portal → ETRetail"', r.status === 200 && DOCS['events/pa-old'].portal === 'retail' && DOCS['events/pa-old'].portalFrom === 'set' &&
    (linesOf('pa-old', 'portal-set')[0] || {}).detail === 'No portal → ETRetail' && JSON.stringify(linesOf('pa-old', 'portal-set')[0].fields) === JSON.stringify([{ field: 'portal', before: 'No portal', after: 'ETRetail' }]), linesOf('pa-old', 'portal-set'));
  check('… with only the portal-set line (no "updated")', linesOf('pa-old', 'updated').length === 0);
  r = await call('PATCH', '/api/event', { eventId: 'pa-old', portal: 'cio', ifPortal: '' });
  check('a second Set portal from a page that still shows none: 409 "changed to ETRetail"', r.status === 409 && r.json.code === 'portal-changed' && r.json.current === 'retail' && r.json.currentName === 'ETRetail', r.json);

  /* refused as today on an event that is not live */
  seed('pa-del', { portal: 'hr', deletedAt: '2026-10-02T00:00:00.000Z' });
  n = writesTo('events/pa-del');
  r = await call('PATCH', '/api/event', { eventId: 'pa-del', portal: 'cio' });
  check('PATCH on a deleted event: 404 event-deleted, nothing written', r.status === 404 && r.json.code === 'event-deleted' && writesTo('events/pa-del') === n && DOCS['events/pa-del'].portal === 'hr', r.json);
  r = await call('PATCH', '/api/event', { eventId: 'pa-nowhere', portal: 'cio' });
  check('PATCH on no event: 404 event-not-found', r.status === 404 && r.json.code === 'event-not-found' && !DOCS['events/pa-nowhere'], r.json);
  r = await call('PATCH', '/api/event', { eventId: 'pa-old', portal: 'cio' }, null);
  check('PATCH signed out: 401', r.status === 401);

  /* ---------- 3. the list ---------- */
  seed('pa-list-bad', { name: 'Bad Portal', portal: 'hrworld' });
  r = await call('GET', '/api/events');
  var items = (r.json && r.json.items) || [];
  function item(id) { return items.filter(function (i) { return i.id === id; })[0] || {}; }
  check('GET /api/events: 200 with items', r.status === 200 && items.length > 3, r.status);
  check('… an item has portal and portalName', item('pa-hr').portal === 'auto' && item('pa-hr').portalName === 'ETAuto' && item('pa-old').portal === 'retail' && item('pa-old').portalName === 'ETRetail', [item('pa-hr'), item('pa-old')]);
  check('… a stored "hrworld" lists as "" / ""', item('pa-list-bad').portal === '' && item('pa-list-bad').portalName === '', item('pa-list-bad'));
  check('… an event with no portal lists as "" / ""', (function () { seed('pa-list-none', { name: 'None' }); return true; })());
  r = await call('GET', '/api/events');
  items = r.json.items;
  check('… (no portal) "" / ""', item('pa-list-none').portal === '' && item('pa-list-none').portalName === '' && Object.prototype.hasOwnProperty.call(item('pa-list-none'), 'portal'), item('pa-list-none'));
  check('… a deleted event is still left out', !items.some(function (i) { return i.id === 'pa-del'; }));
  var sel = SELECTS.filter(function (s) { return s.path === 'events'; }).slice(-1)[0];
  check('… the list\'s select includes portal (and not portalFrom: the list does not need it)', sel && sel.fields.indexOf('portal') !== -1 && sel.fields.indexOf('portalFrom') === -1, sel);
  r = await call('GET', '/api/events?deleted=1');
  check('the deleted list carries the portal too', r.status === 200 && (r.json.items.filter(function (i) { return i.id === 'pa-del'; })[0] || {}).portalName === 'ETHRWorld', r.json);

  /* ---------- 4. one event ---------- */
  r = await call('GET', '/api/event?eventId=pa-hr');
  check('GET /api/event: portal, portalFrom and portalName', r.status === 200 && r.json.portal === 'auto' && r.json.portalFrom === 'set' && r.json.portalName === 'ETAuto', r.json);
  r = await call('GET', '/api/event?eventId=pa-list-none');
  check('… with no portal: portalName ""', r.status === 200 && r.json.portalName === '' && !r.json.portal, r.json);
  r = await call('GET', '/api/event?eventId=pa-list-bad');
  check('… an off-roster stored value is never named', r.status === 200 && r.json.portalName === '', r.json);

  /* ---------- 5. Ingest refuses another portal's edition ---------- */
  seed('pa-ing', { name: 'People Summit', portal: 'hr' });
  seed('pa-ing-none', { name: 'Free Summit' });
  function ingest(body) { return call('POST', '/api/ingest-source', body); }
  MODEL_CALLS = 0; FETCHES = [];
  var ingN = writesTo('events/pa-ing');
  r = await ingest({ eventId: 'pa-ing', url: 'https://hr.economictimes.indiatimes.com/people-summit-2025', type: 'previousEdition', etEvent: { portal: 'cio', id: '123' } });
  check('an ET pick from another portal: 400 other-portal, with both portals', r.status === 400 && r.json && r.json.code === 'other-portal' && r.json.eventPortal === 'hr' && r.json.pagePortal === 'cio', r.json);
  check('… in words', r.json && r.json.error === 'This event is on ETHRWorld, and that page is ETCIO\'s. Pick one of ETHRWorld\'s editions, or change the event\'s portal first.', r.json && r.json.error);
  check('… with 0 fetches and 0 model calls', FETCHES.length === 0 && MODEL_CALLS === 0, [FETCHES, MODEL_CALLS]);
  r = await ingest({ eventId: 'pa-ing', url: 'https://cio.economictimes.indiatimes.com/x', type: 'currentEdition' });
  check('a currentEdition on cio for an hr event: 400 other-portal, 0 fetches, 0 model calls', r.status === 400 && r.json.code === 'other-portal' && r.json.pagePortal === 'cio' && FETCHES.length === 0 && MODEL_CALLS === 0, [r.json, FETCHES]);
  r = await ingest({ eventId: 'pa-ing', url: 'https://cio.economictimes.indiatimes.com/annual-conclave-2025', type: 'previousEdition' });
  check('a previousEdition link on cio: 400 other-portal', r.status === 400 && r.json.code === 'other-portal' && FETCHES.length === 0, r.json);
  check('… none of those read ET\'s lists (no pick of the event\'s own portal)', ET_LISTS.length === 0, ET_LISTS);
  r = await ingest({ eventId: 'pa-ing', url: 'https://cio.economictimes.indiatimes.com/annual-conclave-2025', type: 'previousEdition', etEvent: { portal: 'hr', id: '9' } });
  check('an hr pick whose address is cio\'s, not in ET\'s hr list: still refused (the address is checked too)', r.status === 400 && r.json.code === 'other-portal' && r.json.pagePortal === 'cio' && FETCHES.length === 0, r.json);
  check('… after asking ET\'s hr list once, and only that', JSON.stringify(ET_LISTS) === JSON.stringify(['event:hr']), ET_LISTS);
  check('… and the event was never stamped or written', writesTo('events/pa-ing') === ingN && DOCS['events/pa-ing'].portal === 'hr');
  r = await ingest({ eventId: 'pa-ing', url: 'https://cio.economictimes.indiatimes.com/x', type: 'competitor' });
  check('a competitor on cio passes (it reaches the fetch stub)', r.status !== 400 && FETCHES.length === 1 && FETCHES[0] === 'https://cio.economictimes.indiatimes.com/x', [r.status, r.json, FETCHES]);
  r = await ingest({ eventId: 'pa-ing', url: 'https://hr.economictimes.indiatimes.com/people-summit-2025', type: 'previousEdition', etEvent: { portal: 'hr', id: '42' } });
  check('its own portal\'s pick and page pass', r.status !== 400 && FETCHES.length === 2, [r.status, r.json]);
  r = await ingest({ eventId: 'pa-ing', url: 'https://economictimes.indiatimes.com/news/x', type: 'currentEdition' });
  check('https://economictimes… (not a portal) passes', r.status !== 400 && FETCHES.length === 3, [r.status, r.json]);
  r = await ingest({ eventId: 'pa-ing', url: 'https://www.economictimes.indiatimes.com/x', type: 'previousEdition' });
  check('https://www.economictimes… passes', r.status !== 400 && FETCHES.length === 4, [r.status, r.json]);
  r = await ingest({ eventId: 'pa-ing', url: 'https://www.techgig.com/x', type: 'previousEdition' });
  check('a page on another host passes', r.status !== 400 && FETCHES.length === 5, [r.status, r.json]);
  var noneN = writesTo('events/pa-ing-none');
  r = await ingest({ eventId: 'pa-ing-none', url: 'https://cio.economictimes.indiatimes.com/x', type: 'previousEdition', etEvent: { portal: 'cio', id: '5' } });
  check('an event with no portal yet: passes', r.status !== 400 && FETCHES.length === 6, [r.status, r.json]);
  check('… and reading it never sets the event\'s portal', !DOCS['events/pa-ing-none'].portal && writesTo('events/pa-ing-none') === noneN, DOCS['events/pa-ing-none']);
  r = await ingest({ eventId: 'pa-not-yet', url: 'https://cio.economictimes.indiatimes.com/x', type: 'currentEdition' });
  /* BE-021 (13 Nov 2026): a step works only on an event that exists (Create Event makes it first) — refused before
     anything is fetched, and no document is made */
  check('an event that does not exist yet: 404, nothing fetched, nothing made', r.status === 404 && r.json.code === 'event-not-found' && FETCHES.length === 6 && !DOCS['events/pa-not-yet'], [r.status, r.json]);
  check('the model was never asked (every fetch here answers 404)', MODEL_CALLS === 0, MODEL_CALLS);
  r = await ingest({ eventId: 'pa-ing', url: 'https://cio.economictimes.indiatimes.com/x', type: 'previousEdition', etEvent: { portal: 'nowhere', id: '1' } });
  check('a pick off the roster is still refused as before (not a real pick)', r.status === 400 && /etEvent must name a known portal/.test(r.json.error), r.json);

  /* ---------- 5b. one site under two names, and ET's own record of where an edition is served ----------
     startup.economictimes.indiatimes.com is ET Entrepreneur's site under another name (et-footer.js), yet 'startup'
     and 'entrepreneur' are both on the roster: an address on either host is the same site to both portals. */
  check('siteOfPortal: startup is served as entrepreneur; every other roster portal is its own', hooks.siteOfPortal('startup') === 'entrepreneur' && hooks.siteOfPortal('entrepreneur') === 'entrepreneur' &&
    Object.keys(etEvents.PORTALS).filter(function (s) { return hooks.siteOfPortal(s) !== s; }).join() === 'startup', Object.keys(etEvents.PORTALS).filter(function (s) { return hooks.siteOfPortal(s) !== s; }));
  check('… techmonk (techgig.com) and a portal et-footer.js does not know (shipping) are their own', hooks.siteOfPortal('techmonk') === 'techmonk' && hooks.siteOfPortal('shipping') === 'shipping');
  seed('pa-ent', { name: 'Founders Summit', portal: 'entrepreneur' });
  seed('pa-sup', { name: 'Startup Summit', portal: 'startup' });
  MODEL_CALLS = 0; FETCHES = []; ET_LISTS = [];
  var STARTUP_PAGE = 'https://startup.economictimes.indiatimes.com/founders-summit-2025', ENT_PAGE = 'https://entrepreneur.economictimes.indiatimes.com/founders-summit-2025';
  r = await ingest({ eventId: 'pa-ent', url: STARTUP_PAGE, type: 'previousEdition', etEvent: { portal: 'entrepreneur', id: '77' } });
  check('an entrepreneur event, its own pick served on startup.*: passes (reaches the fetch stub)', r.status !== 400 && FETCHES.length === 1 && FETCHES[0] === STARTUP_PAGE, [r.status, r.json, FETCHES]);
  check('… with no ET list read (the address is the event\'s own site)', ET_LISTS.length === 0, ET_LISTS);
  r = await ingest({ eventId: 'pa-ent', url: STARTUP_PAGE, type: 'previousEdition' });
  check('an entrepreneur event, a pasted startup.* link: passes', r.status !== 400 && FETCHES.length === 2, [r.status, r.json]);
  r = await ingest({ eventId: 'pa-ent', url: ENT_PAGE, type: 'currentEdition' });
  check('an entrepreneur event, its own entrepreneur.* page: passes', r.status !== 400 && FETCHES.length === 3, [r.status, r.json]);
  r = await ingest({ eventId: 'pa-sup', url: ENT_PAGE, type: 'currentEdition' });
  check('a startup event, an entrepreneur.* current-edition link: passes', r.status !== 400 && FETCHES.length === 4 && FETCHES[3] === ENT_PAGE, [r.status, r.json, FETCHES]);
  r = await ingest({ eventId: 'pa-sup', url: ENT_PAGE, type: 'previousEdition', etEvent: { portal: 'startup', id: '78' } });
  check('a startup event, its own pick served on entrepreneur.*: passes', r.status !== 400 && FETCHES.length === 5, [r.status, r.json]);
  check('… none of those read an ET list or asked the model', ET_LISTS.length === 0 && MODEL_CALLS === 0, [ET_LISTS, MODEL_CALLS]);
  r = await ingest({ eventId: 'pa-sup', url: ENT_PAGE, type: 'previousEdition', etEvent: { portal: 'entrepreneur', id: '77' } });
  check('a startup event, a pick from entrepreneur\'s list: refused (a pick must come from the event\'s own portal\'s list)', r.status === 400 && r.json.code === 'other-portal' && r.json.eventPortal === 'startup' && r.json.pagePortal === 'entrepreneur' && FETCHES.length === 5, r.json);
  r = await ingest({ eventId: 'pa-ent', url: 'https://cio.economictimes.indiatimes.com/annual-conclave-2025', type: 'previousEdition' });
  check('an entrepreneur event, a cio link: still refused, naming ETCIO', r.status === 400 && r.json.code === 'other-portal' && r.json.pagePortal === 'cio' && FETCHES.length === 5 &&
    r.json.error === 'This event is on ET Entrepreneur, and that page is ETCIO\'s. Pick one of ET Entrepreneur\'s editions, or change the event\'s portal first.', r.json);
  r = await ingest({ eventId: 'pa-sup', url: 'https://hr.economictimes.indiatimes.com/x', type: 'currentEdition' });
  check('a startup event, an hr link: still refused, naming ETHRWorld', r.status === 400 && r.json.code === 'other-portal' && r.json.pagePortal === 'hr' && FETCHES.length === 5, r.json);

  /* a pick of the event's own portal whose address ET's own list gives as that edition's page is the event's own,
     wherever it is served; unconfirmed (not listed, listed at another address, ET not answering) it is refused */
  var CIO_PAGE = 'https://cio.economictimes.indiatimes.com/annual-conclave-2025';
  ET_LIST.event.hr = [{ id: '9', link: CIO_PAGE + '/' }, { id: '10', link: 'https://hr.economictimes.indiatimes.com/people-summit-2025' }];
  ET_LIST.award.hr = [{ id: '31', link: 'https://cio.economictimes.indiatimes.com/awards-2025' }];
  ET_LISTS = [];
  r = await ingest({ eventId: 'pa-ing', url: CIO_PAGE, type: 'previousEdition', etEvent: { portal: 'hr', id: '9' } });
  check('an hr pick ET\'s hr list serves at that cio address: passes (reaches the fetch stub)', r.status !== 400 && FETCHES.length === 6 && FETCHES[5] === CIO_PAGE, [r.status, r.json, FETCHES]);
  check('… after reading ET\'s hr list (ET\'s record decides, not the host)', ET_LISTS[0] === 'event:hr', ET_LISTS);
  r = await ingest({ eventId: 'pa-ing', url: CIO_PAGE, type: 'previousEdition', etEvent: { portal: 'hr', id: '10' } });
  check('an hr pick ET lists at another address: refused, 0 fetches', r.status === 400 && r.json.code === 'other-portal' && r.json.pagePortal === 'cio' && FETCHES.length === 6, r.json);
  r = await ingest({ eventId: 'pa-ing', url: 'https://cio.economictimes.indiatimes.com/awards-2025', type: 'previousEdition', etEvent: { portal: 'hr', id: '31', kind: 'award' } });
  check('an hr award pick ET\'s hr award list serves on cio: passes', r.status !== 400 && FETCHES.length === 7, [r.status, r.json]);
  r = await ingest({ eventId: 'pa-ing', url: 'https://cio.economictimes.indiatimes.com/awards-2025', type: 'previousEdition', etEvent: { portal: 'hr', id: '9', kind: 'award' } });
  check('… an award pick that is not in the award list: refused', r.status === 400 && r.json.code === 'other-portal' && FETCHES.length === 7, r.json);
  ET_DOWN = true;
  r = await ingest({ eventId: 'pa-ing', url: CIO_PAGE, type: 'previousEdition', etEvent: { portal: 'hr', id: '9' } });
  check('ET\'s list not answering: refused (an unconfirmed pick never lets another portal\'s address through), 0 fetches', r.status === 400 && r.json.code === 'other-portal' && r.json.pagePortal === 'cio' && FETCHES.length === 7, r.json);
  ET_DOWN = false;
  check('… and the model was never asked', MODEL_CALLS === 0, MODEL_CALLS);
  var apiSrc = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8'), ingAt = apiSrc.indexOf('function handleIngestSource(');
  var ingSrc = apiSrc.slice(ingAt, apiSrc.indexOf('\nfunction ', ingAt + 10));
  /* BE-026 (13 Nov 2026): the page is read by readSourcePage, whose safeFetch carries the 20 s */
  check('the page\'s 20s timer starts after the portal check (a slow ET list read never eats it)', ingSrc.indexOf('return otherPortalOf(') !== -1 && ingSrc.indexOf('return readSourcePage(') > ingSrc.indexOf('return otherPortalOf(') &&
    /var SOURCE_PAGE_TIMEOUT_MS = 20000;/.test(apiSrc) && /safeFetch\(url, \{ timeoutMs: SOURCE_PAGE_TIMEOUT_MS/.test(apiSrc), ingSrc.length);

  /* ---------- 6. the site's ET bar and footer ---------- */
  var SOUTH = [{ type: 'previousEdition', url: 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025', previous: { portal: 'brandequity', url: 'https://brandequity.economictimes.indiatimes.com/brand-world-summit-south2025' } }];
  check('sitePortalOf is a test hook', typeof hooks.sitePortalOf === 'function');
  check('sitePortalOf({ portal: "hr" }, brandequity sources): the event\'s portal, the sources\' series', JSON.stringify(hooks.sitePortalOf({ portal: 'hr' }, SOUTH)) === JSON.stringify({ portal: 'hr', series: 'brand-world-summit-south' }), hooks.sitePortalOf({ portal: 'hr' }, SOUTH));
  check('sitePortalOf({}, the same): no portal — never worked out from the sources', JSON.stringify(hooks.sitePortalOf({}, SOUTH)) === JSON.stringify({ portal: '', series: 'brand-world-summit-south' }), hooks.sitePortalOf({}, SOUTH));
  check('sitePortalOf: an off-roster or inherited name gives none', hooks.sitePortalOf({ portal: 'hrworld' }, []).portal === '' && hooks.sitePortalOf({ portal: '__proto__' }, []).portal === '' &&
    hooks.sitePortalOf({ portal: 'toString' }, null).portal === '' && JSON.stringify(hooks.sitePortalOf(null, null)) === JSON.stringify({ portal: '', series: '' }));
  check('sitePortal itself is unchanged (it still reads the sources)', hooks.sitePortal(SOUTH).portal === 'brandequity');
  var SRC = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
  var gen = SRC.slice(SRC.indexOf('function runGenerateDesignedContent('), SRC.indexOf('\nfunction ', SRC.indexOf('function runGenerateDesignedContent(') + 10));
  check('generate-content\'s footer is sitePortalOf the event being generated (its own document, through watchEvent)', /var footerOf = sitePortalOf\(\{ portal: watch\.portal \}/.test(gen) && !/[^O]sitePortal\(/.test(gen.replace(/sitePortalOf\(/g, 'SPO(')), gen.length);
  check('… the nav is given that portal (navFor.portal = footerOf.portal)', /navFor\.portal = footerOf\.portal;/.test(gen));
  var calls = gen.match(/etNav\.sectionFor\([^;]*\);/g) || [];
  check('… and both sectionFor calls pass it (the main one and the fallback)', calls.length === 2 && /, navFor\);$/.test(calls[0]) && /portal: navFor\.portal \}\);$/.test(calls[1]), calls);
  check('… the footer is built with that portal', /siteFooter\(\{ portal: footerOf\.portal, series: footerOf\.series/.test(gen));
  check('watchEvent gives the stored roster portal, or ""', /portal: etEvents\.isPortal\(stored\.portal\) \? stored\.portal : ''/.test(SRC.slice(SRC.indexOf('function watchEvent('), SRC.indexOf('function sendStepFailure('))));

  /* ---------- 7. the activity action ---------- */
  check('activity.ACTIONS has portal-set', activity.ACTIONS.indexOf('portal-set') !== -1);
  check('… with area event', activity.AREA_OF['portal-set'] === 'event' && activity.areaOf({ action: 'portal-set' }) === 'event' && activity.AREAS.indexOf('event') !== -1);
  check('… and the reader places an old line of it the same way', require('./activity-query').areaOf({ action: 'portal-set' }) === 'event');

  /* ---------- 8. clone keeps the portal ---------- */
  seed('hr', { name: 'HR Event', portal: 'hr', portalFrom: 'create', templateId: 'tech500' });
  r = await call('POST', '/api/event/clone', { sourceEventId: 'hr', eventId: 'hr-copy', name: 'HR Event Copy' });
  check('clone of event "hr" (whose id is its portal\'s slug): 200', r.status === 200 && r.json && r.json.eventId === 'hr-copy', r.json);
  check('… the copy keeps portal "hr" (a bare slug equal to the source id is not rewritten) and its portalFrom', DOCS['events/hr-copy'] && DOCS['events/hr-copy'].portal === 'hr' && DOCS['events/hr-copy'].portalFrom === 'create', DOCS['events/hr-copy']);
  r = await call('GET', '/api/event?eventId=hr-copy');
  check('… and reads as ETHRWorld', r.json && r.json.portalName === 'ETHRWorld', r.json);

  /* ---------- 9. the four new routes ---------- */
  var NEW = [['GET', '/api/events/portal-evidence', 'event-portal', 'handleEvidence'], ['POST', '/api/events/portal-backfill', 'event-portal', 'handleBackfill'],
    ['GET', '/api/me/working-portal', 'working-portal', 'handleGet'], ['PUT', '/api/me/working-portal', 'working-portal', 'handlePut']];
  /* the server's own log of a module it could not load is expected here: it is kept, not printed */
  var logged = [], consoleError = console.error;
  console.error = function () { logged.push([].slice.call(arguments).join(' ')); };
  for (var k = 0; k < NEW.length; k++) {
    r = await call(NEW[k][0], NEW[k][1], NEW[k][0] === 'GET' ? null : { items: [] });
    check(NEW[k][0] + ' ' + NEW[k][1] + ' with its module missing: 503 module-unavailable (the server still runs)', r.status === 503 && r.json && r.json.code === 'module-unavailable', [r.status, r.json]);
  }
  console.error = consoleError;
  check('… and each is logged for us, naming the module', logged.length === 4 && /lib\/event-portal\.js/.test(logged[0]) && /lib\/working-portal\.js/.test(logged[3]), logged.length);
  var WIRED = {}, HANDLED = [];
  function stubModule(name, handlers) {
    var m = { wire: function (h) { WIRED[name] = h; } };
    handlers.forEach(function (hn) {
      m[hn] = function (req, res) {
        HANDLED.push(name + '.' + hn);
        var h = WIRED[name];
        (hn === 'handleBackfill' || hn === 'handlePut' ? function (cb) { h.withAdminBody(req, res, h.BODY_LIMITS.tiny, cb); } : function (cb) { h.withAdmin(req, res, cb); })(function (fb, decoded, body) {
          h.sendJson(res, 200, { module: name, handler: hn, by: h.actorOf(decoded), body: body || null });
        });
      };
    });
    return m;
  }
  STUBS['event-portal'] = stubModule('event-portal', ['handleEvidence', 'handleBackfill']);
  STUBS['working-portal'] = stubModule('working-portal', ['handleGet', 'handlePut']);
  for (k = 0; k < NEW.length; k++) {
    r = await call(NEW[k][0], NEW[k][1], NEW[k][0] === 'GET' ? null : { items: [{ eventId: 'pa-old', portal: 'hr' }] });
    check(NEW[k][0] + ' ' + NEW[k][1] + ' reaches ' + NEW[k][2] + '.' + NEW[k][3], r.status === 200 && r.json.module === NEW[k][2] && r.json.handler === NEW[k][3] && r.json.by === 'maker@timesinternet.in', r.json);
    r = await call(NEW[k][0], NEW[k][1], NEW[k][0] === 'GET' ? null : { items: [] }, null);
    check('… signed out: 401', r.status === 401, r.status);
  }
  var HELPERS = ['withAdmin', 'withAdminBody', 'eventDocRef', 'eventStateOf', 'approvalsConfig', 'actorOf', 'logActivity', 'sendJson', 'sendFailure', 'httpError', 'BODY_LIMITS', 'isEventId'];
  ['event-portal', 'working-portal'].forEach(function (name) {
    var h = WIRED[name] || {};
    check(name + ' is wired with this file\'s helpers', HELPERS.every(function (x) { return h[x] != null; }) && typeof h.BODY_LIMITS.tiny === 'number', Object.keys(h));
  });
  var h = WIRED['event-portal'];
  check('… which work: eventStateOf, eventDocRef, httpError, isEventId', h.eventStateOf(await h.eventDocRef(FB, 'pa-old').get()) === 'live' && h.eventStateOf(await h.eventDocRef(FB, 'pa-del').get()) === 'deleted' &&
    h.httpError(403, 'x', { code: 'not-an-approver' }).body.code === 'not-an-approver' && h.isEventId('pa-old') && !h.isEventId('a/b'));
  DOCS['config/approvals'] = { approvers: ['Owner@TimesInternet.in', 'not an address'] };
  var cfg = await h.approvalsConfig(FB);
  check('… approvalsConfig reads config/approvals (addresses, lower-cased), with the first admin (Settings › Access)', JSON.stringify(cfg.approvers) === JSON.stringify(['owner@timesinternet.in', 'sachitanand.rai@timesinternet.in']), cfg);

  /* ---------- the routes that were there keep their shape ---------- */
  check('the existing routes are all still there', ['POST /api/event', 'GET /api/event', 'PATCH /api/event', 'GET /api/events', 'GET /api/et/portals', 'GET /api/et/events', 'POST /api/ingest-source'].every(function (rt) {
    return new RegExp('\'' + rt.replace(/[\/]/g, '\\/') + '\': ').test(SRC);
  }));
  r = await call('GET', '/api/et/portals');
  check('GET /api/et/portals still lists the roster, and every listed slug is a portal an event can take', r.status === 200 && r.json.portals.length === Object.keys(etEvents.PORTALS).length &&
    r.json.portals.every(function (p) { return etEvents.isPortal(p.slug); }), r.status);

  if (failed) { console.error('event-portal-api: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('event-portal-api: all ' + passed + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.error('event-portal-api: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
