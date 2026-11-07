/* node functions/lib/create-drafts.test.js — Create Event's unfinished drafts in the person's account (lib/create-drafts.js,
   UX-048 in batch B08). Before it, a draft lived in one browser only: the dashboard never listed it and a second event
   could not be started without throwing the first away. This checks what each route answers and keeps: a save, a save
   on top of one made elsewhere (409, never overwritten unseen), the dashboard's list (newest first, never the drafts'
   text), Resume's read, Discard (the draft and its pictures), the pictures themselves, and that each person sees only
   their own. Runs against an in-memory Firestore and Storage with the helpers lib/api.js hands over (portalHelpers).
   No network. Exits 1 on any failure. */
'use strict';
const path = require('path');
const fs = require('fs');

var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

var SRC = fs.readFileSync(path.join(__dirname, 'create-drafts.js'), 'utf8');
var requires = (SRC.match(/require\(\s*['"][^'"]+['"]\s*\)/g) || []).map(function (r) { return r.replace(/^require\(\s*['"]|['"]\s*\)$/g, ''); });
check('it requires only lib/working-portal.js (the person\'s key) and lib/api-events.js (what a picture is)', JSON.stringify(requires) === '["./working-portal","./api-events"]', requires);

/* ---------- an in-memory Firestore and Storage: just what the module calls ---------- */
function fakeFb() {
  var f = { docs: {}, objects: {}, fail: null, txRuns: 0 };
  function snapOf(p) { var d = f.docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; } }; }
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      get: function () { if (f.fail) return Promise.reject(f.fail); return Promise.resolve(snapOf(p)); },
      delete: function () { if (f.fail) return Promise.reject(f.fail); delete f.docs[p]; return Promise.resolve(); },
      collection: function (n) { return colRef(p + '/' + n); }
    };
  }
  function colRef(p) {
    var q = { order: null, dir: 'asc', max: Infinity, fields: null };
    var ref = {
      path: p,
      doc: function (id) { if (!id || /\//.test(id)) throw new Error('fake: a bad document id "' + id + '"'); return docRef(p + '/' + id); },
      orderBy: function (field, dir) { q.order = field; q.dir = dir || 'asc'; return ref; },
      limit: function (n) { q.max = n; return ref; },
      select: function () { q.fields = Array.prototype.slice.call(arguments); return ref; },
      get: function () {
        if (f.fail) return Promise.reject(f.fail);
        var prefix = p + '/';
        var rows = Object.keys(f.docs).filter(function (k) { return k.indexOf(prefix) === 0 && k.slice(prefix.length).indexOf('/') === -1; }).map(function (k) {
          var d = clone(f.docs[k]);
          if (q.fields) { var only = {}; q.fields.forEach(function (x) { if (x in d) only[x] = d[x]; }); d = only; }
          return { id: k.slice(prefix.length), data: function () { return d; } };
        });
        if (q.order) rows.sort(function (a, b) { var x = String(a.data()[q.order] || ''), y = String(b.data()[q.order] || ''); return q.dir === 'desc' ? (x < y ? 1 : x > y ? -1 : 0) : (x < y ? -1 : x > y ? 1 : 0); });
        rows = rows.slice(0, q.max);
        f.lastSelect = q.fields;
        return Promise.resolve({ size: rows.length, forEach: function (fn) { rows.forEach(fn); } });
      }
    };
    return ref;
  }
  f.db = {
    collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      f.txRuns++;
      var writes = [];
      var tx = { get: function (ref) { return ref.get(); }, set: function (ref, data) { writes.push([ref.path, clone(data)]); } };
      return Promise.resolve().then(function () { return fn(tx); }).then(function (out) {
        writes.forEach(function (w) { f.docs[w[0]] = w[1]; });
        return out;
      });
    }
  };
  f.bucket = {
    file: function (name) {
      return {
        save: function (buf, opts) { if (f.fail) return Promise.reject(f.fail); f.objects[name] = { buf: Buffer.from(buf), meta: clone(opts && opts.metadata) || {} }; return Promise.resolve(); },
        download: function () { var o = f.objects[name]; return o ? Promise.resolve([o.buf]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
        getMetadata: function () { var o = f.objects[name]; return o ? Promise.resolve([o.meta]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); }
      };
    },
    deleteFiles: function (o) { Object.keys(f.objects).forEach(function (k) { if (k.indexOf(o.prefix) === 0) delete f.objects[k]; }); return Promise.resolve(); }
  };
  return f;
}
var FB = fakeFb();
const http = require('./http');

var failures = [];
function sendFailure(res, what, err, friendly) {
  if (err && err.status && err.body) return http.sendJson(res, err.status, err.body);
  failures.push(what);
  http.sendJson(res, 500, { error: friendly || 'Something went wrong on the server. Please try again.' });
}
/* who signs in: req.who, the decoded token as it is (null: signed out) */
var HELPERS = Object.freeze({
  withAdmin: function (req, res, cb) { if (!req.who) return http.sendJson(res, 401, { error: 'Sign in required.' }); cb(FB, req.who); },
  withAdminBody: function (req, res, maxBytes, cb) {
    HELPERS.withAdmin(req, res, function (fb, d) {
      var raw = req.rawBody || '{}';
      if (Buffer.byteLength(raw) > maxBytes) return http.sendJson(res, 413, { error: 'That request is too large.' });
      var body; try { body = JSON.parse(raw); } catch (e) { return http.sendJson(res, 400, { error: 'Invalid JSON.' }); }
      cb(fb, d, body);
    });
  },
  sendJson: http.sendJson,
  sendFailure: sendFailure
});

function call(handler, method, url, who, body) {
  return new Promise(function (resolve) {
    var res = {
      headersSent: false, status: 0, headers: {}, chunks: [],
      writeHead: function (s, h) { this.status = s; this.headers = h || {}; this.headersSent = true; },
      setHeader: function (k, v) { this.headers[k] = v; },
      end: function (b) {
        var buf = b == null ? Buffer.alloc(0) : Buffer.isBuffer(b) ? b : Buffer.from(String(b));
        var out = { status: this.status, headers: this.headers, buf: buf, body: null };
        try { out.body = JSON.parse(buf.toString('utf8')); } catch (e) { out.body = null; }
        resolve(out);
      }
    };
    var req = { method: method, url: url, headers: {}, who: who, rawBody: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) };
    handler(req, res);
  });
}

var CD = require('./create-drafts');
var ASHA = { uid: 'u-asha', email: 'asha@timesinternet.in' };
var RAVI = { uid: 'u-ravi', email: 'ravi@timesinternet.in' };
var ID1 = 'draft-mh2abc-x1y2z3', ID2 = 'draft-mh2abd-a1b2c3', ID3 = 'draft-mh2abe-q9w8e7';
function state(id, extra) {
  return Object.assign({ draftId: id, savedAt: '2026-11-05T10:00:00.000Z', step: 1, step1Phase: 'details', creationMethod: 'template',
    basics: { category: 'IP', portal: 'retail', name: 'Retail Leadership Summit 2027', client: '' }, brief: {}, sections: [], files: {} }, extra || {});
}
var PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c60000000049454e44ae426082', 'hex');

(async function main() {
  /* ---------- before lib/api.js hands its helpers over ---------- */
  var r = await call(CD.handleList, 'GET', '/api/me/create-drafts', ASHA);
  check('a route reached before wire() answers 503, as a missing module does', r.status === 503 && r.body.code === 'module-unavailable', r);
  CD.wire(HELPERS);

  /* ---------- the summary the dashboard shows, from the draft itself ---------- */
  var T = CD._test;
  var s = T.summaryOf(state(ID1, { createdEventId: 'retail-leadership-summit-2027' }));
  check('summaryOf: the name, type, portal, how it is built, where it stopped and its event', JSON.stringify(s) ===
    JSON.stringify({ name: 'Retail Leadership Summit 2027', category: 'IP', portal: 'retail', client: '', method: 'template', phase: 'details', eventId: 'retail-leadership-summit-2027' }), s);
  s = T.summaryOf({ basics: { name: '  ' + 'N'.repeat(300) + '\u0007 ', category: 'Webinar', portal: 'Not A Portal!' }, step1Phase: 'nowhere', creationMethod: 'magic', createdEventId: '../x' });
  check('summaryOf: only known values, each clipped; nothing unknown is passed on', s.name.length === 160 && s.category === '' && s.portal === '' && s.method === '' && s.phase === 'category' && s.eventId === '', s);
  check('summaryOf: a state with no basics at all', T.summaryOf({}).name === '' && T.summaryOf({}).phase === 'category');
  var fl = T.filesOf({ files: { logo: { name: 'logo.png', savedAt: 5 }, 'img-3': { name: 'p.jpg', savedAt: '7' }, psd: { name: 'x.psd' }, 'img-x': {}, banner: 'oops' } });
  check('filesOf: the known slots only (never the PSD), each with its name and version', JSON.stringify(fl) === JSON.stringify({ logo: { name: 'logo.png', savedAt: 5 }, 'img-3': { name: 'p.jpg', savedAt: 7 } }), fl);
  check('a draft id is create-event.html\'s own shape and nothing else', T.isDraftId(ID1) && !T.isDraftId('draft-..-x') && !T.isDraftId('qa-ux-b08') && !T.isDraftId('draft-a/b-c') && !T.isDraftId(null));

  /* ---------- PUT ---------- */
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', null, { id: ID1, rev: 0, state: state(ID1) });
  check('signed out: 401', r.status === 401);
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', { email: 'x@timesinternet.in' }, { id: ID1, rev: 0, state: state(ID1) });
  check('a sign-in that carries no uid is asked to sign in again (never a shared key)', r.status === 401 && Object.keys(FB.docs).length === 0, r.body);
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: 'draft-x/y-z', rev: 0, state: state('draft-x/y-z') });
  check('PUT: an id that is not a draft is refused', r.status === 400 && r.body.code === 'bad-draft-id');
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: 0, state: state(ID2) });
  check('PUT: a state for another draft is refused', r.status === 400 && r.body.code === 'bad-draft');
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: 0, state: state(ID1, { assembled: true }) });
  check('PUT: a draft already handed to the editor is finished, never saved again', r.status === 400 && r.body.code === 'draft-finished');
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: '0', state: state(ID1) });
  check('PUT: a revision that is not a whole number is refused', r.status === 400 && r.body.code === 'bad-draft');
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: 0, state: state(ID1, { big: 'x'.repeat(T.STATE_MAX_BYTES) }) });
  check('PUT: a draft too large for one document says so plainly (413), and nothing is kept', r.status === 413 && r.body.code === 'draft-too-large' && !FB.docs['createDrafts/u-asha/drafts/' + ID1], r.body);

  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: 0, writer: 'wabc123', state: state(ID1, { files: { logo: { name: 'logo.png', savedAt: 3 } } }) });
  var doc = FB.docs['createDrafts/u-asha/drafts/' + ID1];
  check('PUT: a first save is revision 1', r.status === 200 && r.body.ok === true && r.body.rev === 1 && r.body.id === ID1 && r.body.savedAt === '2026-11-05T10:00:00.000Z' && !!r.body.updatedAt, r.body);
  check('PUT: kept under the person\'s own key, with whose it is, its summary, its pictures and its text', !!doc && doc.uid === 'u-asha' && doc.email === 'asha@timesinternet.in' &&
    doc.writer === 'wabc123' && doc.summary.name === 'Retail Leadership Summit 2027' && doc.files.logo.savedAt === 3 && typeof doc.state === 'string' && JSON.parse(doc.state).draftId === ID1, doc);
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: 1, writer: 'wabc123', state: state(ID1, { savedAt: '2026-11-05T10:05:00.000Z', basics: { name: 'Renamed', category: 'IP', portal: 'retail' } }) });
  check('PUT: saved again on top of revision 1 is revision 2', r.status === 200 && r.body.rev === 2 && FB.docs['createDrafts/u-asha/drafts/' + ID1].summary.name === 'Renamed');
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: 1, writer: 'wother9', state: state(ID1, { basics: { name: 'Stale copy' } }) });
  check('PUT: a copy built on an older revision (saved from another computer since) is refused, with what the account holds',
    r.status === 409 && r.body.code === 'draft-conflict' && r.body.current.rev === 2 && r.body.current.writer === 'wabc123' && r.body.current.savedAt === '2026-11-05T10:05:00.000Z' &&
    FB.docs['createDrafts/u-asha/drafts/' + ID1].summary.name === 'Renamed', r.body);
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: 1, writer: 'wother9', force: true, state: state(ID1, { basics: { name: 'Kept this one' } }) });
  check('PUT: force (the person chose "Keep this one") saves over it as the next revision', r.status === 200 && r.body.rev === 3 && FB.docs['createDrafts/u-asha/drafts/' + ID1].summary.name === 'Kept this one');
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID2, rev: 4, state: state(ID2) });
  check('PUT: a copy that had been saved, of a draft discarded since, is refused with nothing current', r.status === 409 && r.body.code === 'draft-conflict' && r.body.current === null && !FB.docs['createDrafts/u-asha/drafts/' + ID2], r.body);
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: 3, writer: 'not ok!', state: state(ID1) });
  check('PUT: a writer mark that is not one is not kept', r.status === 200 && FB.docs['createDrafts/u-asha/drafts/' + ID1].writer === '');
  FB.fail = new Error('deadline exceeded');
  r = await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID1, rev: 4, state: state(ID1) });
  FB.fail = null;
  check('PUT: a store failure is a plain 500, logged', r.status === 500 && r.body.error === 'Your draft could not be saved to your account. Please try again.' && failures.slice(-1)[0] === 'create draft save');

  /* ---------- several drafts, each person's own ---------- */
  await new Promise(function (r) { setTimeout(r, 5); });          // saved a moment after the first, so it lists first
  await call(CD.handlePut, 'PUT', '/api/me/create-draft', ASHA, { id: ID2, rev: 0, force: true, state: state(ID2, { basics: { name: 'Second event', category: 'Awards', portal: 'hr' } }) });
  await call(CD.handlePut, 'PUT', '/api/me/create-draft', RAVI, { id: ID3, rev: 0, state: state(ID3, { basics: { name: 'Ravi\'s draft' } }) });
  FB.docs['createDrafts/u-asha/drafts/not-a-draft'] = { rev: 1, updatedAt: '2099-01-01T00:00:00.000Z', summary: {} };
  r = await call(CD.handleList, 'GET', '/api/me/create-drafts', ASHA);
  check('LIST: several drafts at once, newest first, only the person\'s own', r.status === 200 && r.body.drafts.length === 2 && r.body.drafts[0].id === ID2 && r.body.drafts[1].id === ID1 &&
    r.body.drafts[0].summary.name === 'Second event' && r.body.drafts[0].summary.category === 'Awards', r.body);
  check('LIST: never the drafts\' text (only what is listed is read)', r.body.drafts.every(function (d) { return !('state' in d) && !('files' in d); }) &&
    JSON.stringify(FB.lastSelect) === '["rev","savedAt","updatedAt","summary"]', FB.lastSelect);
  r = await call(CD.handleList, 'GET', '/api/me/create-drafts', RAVI);
  check('LIST: another person sees only theirs', r.body.drafts.length === 1 && r.body.drafts[0].id === ID3);
  FB.fail = new Error('unavailable');
  r = await call(CD.handleList, 'GET', '/api/me/create-drafts', ASHA);
  FB.fail = null;
  check('LIST: a store failure says the drafts could not be read', r.status === 500 && r.body.error === 'Your drafts could not be read. Please try again.');

  /* ---------- GET (Resume) ---------- */
  r = await call(CD.handleGet, 'GET', '/api/me/create-draft?id=' + ID2, ASHA);
  check('GET: the whole draft, its revision and pictures', r.status === 200 && r.body.draft.id === ID2 && r.body.draft.rev === 1 && r.body.draft.state.basics.name === 'Second event' && typeof r.body.draft.files === 'object', r.body);
  r = await call(CD.handleGet, 'GET', '/api/me/create-draft?id=' + ID3, ASHA);
  check('GET: another person\'s draft is not found (never read across people)', r.status === 404 && r.body.code === 'draft-not-found');
  r = await call(CD.handleGet, 'GET', '/api/me/create-draft?id=bad', ASHA);
  check('GET: a bad id is a 400', r.status === 400 && r.body.code === 'bad-draft-id');
  FB.docs['createDrafts/u-asha/drafts/' + ID3] = { rev: 1, state: '{not json' };
  r = await call(CD.handleGet, 'GET', '/api/me/create-draft?id=' + ID3, ASHA);
  check('GET: a draft whose text cannot be read back says so', r.status === 404 && r.body.code === 'draft-unreadable');
  delete FB.docs['createDrafts/u-asha/drafts/' + ID3];

  /* ---------- pictures ---------- */
  r = await call(CD.handleFilePut, 'POST', '/api/me/create-draft/file', ASHA, { id: ID2, slot: 'img-3', fileName: 'speaker.png', dataBase64: 'data:image/png;base64,' + PNG.toString('base64') });
  var obj = FB.objects['create-drafts/u-asha/' + ID2 + '/img-3'];
  check('FILE: a picture is kept privately under the person\'s key, the draft and its slot', r.status === 200 && r.body.slot === 'img-3' && r.body.contentType === 'image/png' &&
    !!obj && obj.meta.contentType === 'image/png' && obj.meta.cacheControl === 'private, no-store', r.body);
  r = await call(CD.handleFilePut, 'POST', '/api/me/create-draft/file', ASHA, { id: ID2, slot: 'psd', fileName: 'x.psd', dataBase64: PNG.toString('base64') });
  check('FILE: a slot that is not a draft picture (the PSD) is refused', r.status === 400 && r.body.code === 'bad-slot');
  r = await call(CD.handleFilePut, 'POST', '/api/me/create-draft/file', ASHA, { id: ID2, slot: 'logo', fileName: 'a.txt', dataBase64: Buffer.from('hello there').toString('base64') });
  check('FILE: something that is not a picture is refused', r.status === 415);
  r = await call(CD.handleFilePut, 'POST', '/api/me/create-draft/file', ASHA, { id: ID2, slot: 'logo', fileName: 'x.svg', dataBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64') });
  check('FILE: an SVG with a script in it is refused', r.status === 415 && /scripts/.test(r.body.error));
  r = await call(CD.handleFilePut, 'POST', '/api/me/create-draft/file', ASHA, { id: ID2, slot: 'logo', fileName: 'x.png', dataBase64: '###' });
  check('FILE: bytes that did not arrive intact are refused', r.status === 400);
  r = await call(CD.handleFileGet, 'GET', '/api/me/create-draft/file?id=' + ID2 + '&slot=img-3', ASHA);
  check('FILE GET: the picture\'s bytes, its type, never cached', r.status === 200 && r.headers['Content-Type'] === 'image/png' && r.headers['Cache-Control'] === 'private, no-store' && r.buf.equals(PNG), r.headers);
  r = await call(CD.handleFileGet, 'GET', '/api/me/create-draft/file?id=' + ID2 + '&slot=img-3', RAVI);
  check('FILE GET: another person cannot read it', r.status === 404 && r.body.code === 'file-not-found');
  r = await call(CD.handleFileGet, 'GET', '/api/me/create-draft/file?id=' + ID2 + '&slot=logo', ASHA);
  check('FILE GET: a picture the account does not hold is a 404', r.status === 404 && r.body.code === 'file-not-found');

  /* ---------- DELETE (Discard, and a draft that has become its event) ---------- */
  await call(CD.handleFilePut, 'POST', '/api/me/create-draft/file', ASHA, { id: ID1, slot: 'logo', fileName: 'logo.png', dataBase64: PNG.toString('base64') });
  r = await call(CD.handleDelete, 'DELETE', '/api/me/create-draft?id=' + ID2, ASHA);
  check('DELETE: the draft goes, with its pictures; the person\'s other draft and its picture stay', r.status === 200 && r.body.removed === true && !FB.docs['createDrafts/u-asha/drafts/' + ID2] &&
    !FB.objects['create-drafts/u-asha/' + ID2 + '/img-3'] && !!FB.docs['createDrafts/u-asha/drafts/' + ID1] && !!FB.objects['create-drafts/u-asha/' + ID1 + '/logo'], r.body);
  r = await call(CD.handleDelete, 'DELETE', '/api/me/create-draft?id=' + ID2, ASHA);
  check('DELETE: repeating it is harmless', r.status === 200 && r.body.removed === false);
  r = await call(CD.handleDelete, 'DELETE', '/api/me/create-draft?id=' + ID3, ASHA);
  check('DELETE: never reaches another person\'s draft', r.status === 200 && r.body.removed === false && !!FB.docs['createDrafts/u-ravi/drafts/' + ID3]);
  r = await call(CD.handleList, 'GET', '/api/me/create-drafts', ASHA);
  check('LIST after Discard: it is not listed any more', r.body.drafts.length === 1 && r.body.drafts[0].id === ID1);

  /* ---------- the pages' side (create-drafts.js at the root, ES5): calls, removals kept for later, the words shown ---------- */
  var C = require('../../create-drafts.js');
  var mem = {};
  var LS = { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
  var sent = [], answer = null;
  global.window = { localStorage: LS, RevampAuth: { authedFetch: function (url, o) {
    sent.push((o && o.method || 'GET') + ' ' + url + (o && o.body ? ' ' + o.body : ''));
    return answer(url, o);
  } } };
  function reply(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } }); }
  answer = function () { return Promise.reject(new TypeError('Failed to fetch')); };
  var err = await C.remove(ID1).then(function () { return null; }, function (e) { return e; });
  check('client: a Discard the server cannot be reached for fails plainly and is kept for later', !!err && err.status === 0 && /could not be reached/.test(err.message) &&
    JSON.parse(mem['revamp.createEvent.removals.v1']).indexOf(ID1) !== -1, [err && err.message, mem]);
  answer = function (url) { return /create-drafts$/.test(url) ? reply(200, { drafts: [{ id: ID1, summary: {} }, { id: ID2, summary: {} }, { id: 'nope' }] }) : reply(200, { ok: true }); };
  var listed = await C.list();
  check('client: meanwhile it is listed nowhere (nor anything that is not a draft)', listed.length === 1 && listed[0].id === ID2, listed);
  check('client: …and Resume of it finds nothing', (await C.get(ID1)) === null);
  await C.flushRemovals();
  check('client: on the next visit the removal is made and forgotten', sent.some(function (x) { return x === 'DELETE /api/me/create-draft?id=' + ID1; }) && !('revamp.createEvent.removals.v1' in mem), sent.slice(-2));
  answer = function () { return reply(409, { error: 'This draft was changed on another computer since.', code: 'draft-conflict', current: { rev: 7, writer: 'wother9' } }); };
  err = await C.put(ID2, 3, { draftId: ID2 }, { writer: 'wme0001' }).then(function () { return null; }, function (e) { return e; });
  check('client: a conflict comes back with its code and what the account holds', !!err && err.status === 409 && err.code === 'draft-conflict' && err.current.rev === 7 &&
    /"rev":3/.test(sent.slice(-1)[0]) && /"writer":"wme0001"/.test(sent.slice(-1)[0]) && /"force":false/.test(sent.slice(-1)[0]), [err, sent.slice(-1)]);
  answer = function () { return reply(404, { error: 'gone', code: 'draft-not-found' }); };
  check('client: a draft not in the account reads as none', (await C.get(ID2)) === null);
  check('client: slots are the page\'s on one side, the server\'s on the other', C.serverSlot('img:3') === 'img-3' && C.localSlot('img-3') === 'img:3' && C.serverSlot('logo') === 'logo');
  var w = C.describe({ savedAt: '2026-11-05T14:20:00', summary: { name: '', category: 'Awards', portal: 'hr', phase: 'details', method: 'brief', eventId: 'x-2027' } },
    { portalName: function (p) { return p === 'hr' ? 'ETHRWorld' : ''; }, now: new Date('2026-11-06T10:00:00').getTime() });
  check('client: the dashboard\'s words for a draft', w.name === 'Untitled event' && w.type === 'Awards' && w.portal === 'ETHRWorld' && w.where === 'Writing the brief' && w.when === '5 Nov, 2:20 pm' && w.eventId === 'x-2027', w);
  check('client: a draft with no portal yet says so', C.describe({ summary: { phase: 'category' } }).portal === 'No portal yet' && C.describe({ summary: { phase: 'category' } }).where === 'Choosing the portal and type');
  check('client: last year\'s time carries its year', C.whenLabel('2025-03-01T09:05:00', new Date('2026-11-06T10:00:00').getTime()) === '1 Mar 2025, 9:05 am');
  mem[C.LOCAL_PREFIX + ID2] = '{}'; mem[C.CURRENT_KEY] = ID2; mem[C.LOCAL_PREFIX + ID1] = '{}';
  C.forgetLocal(LS, ID2);
  check('client: Discard on the dashboard also forgets this browser\'s copy of that draft, and only that one', !(C.LOCAL_PREFIX + ID2 in mem) && !(C.CURRENT_KEY in mem) && (C.LOCAL_PREFIX + ID1 in mem));
  var wid = C.writerId(LS);
  check('client: this browser\'s writer mark is kept, the same each time', /^[a-z0-9]{6,40}$/.test(wid) && C.writerId(LS) === wid);
  delete global.window;

  console.log('create-drafts: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('FAIL threw: ' + (e && e.stack || e)); process.exit(1); });
