/* node functions/lib/logo-note-gate.test.js — nothing goes live while the hero's logo unit still carries its notice
   (api.js unansweredLogoNote / logoNoteError): direct publishing, asking for approval and approving all refuse with
   409 'logo-unit-unanswered' and say what to do; the approval page offers Reject only; a version already live may
   go out again as it is (tools/republish-current.js). In-process, against an in-memory Firestore and Storage (the
   harness of site-pages.test.js). No network. Exits 1 listing every failure. */
'use strict';

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 400) : '')); }

/* ---------- an in-memory Firestore + Storage ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {}, files = {};
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } }; }
  function write(p, data, merge) {
    if (!merge || !docs[p]) docs[p] = docs[p] && merge ? docs[p] : {};
    Object.keys(data).forEach(function (k) { if (isDelete(data[k])) delete docs[p][k]; else docs[p][k] = clone(data[k]); });
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, data, o && o.merge); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, data, true); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p) {
    var q = { path: p, doc: function (id) { return docRef(p + '/' + (id || 'auto' + Object.keys(docs).length + 'x' + Math.floor(Math.random() * 1e6))); },
      add: function (data) { var r = docRef(p + '/auto' + Object.keys(docs).length); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) {
        var base = q.get;
        return Object.assign({}, q, { get: function () { return base().then(function (r) { var list = r.docs.filter(function (d) { var v = (d.data() || {})[field]; return op === '>' ? v > value : v === value; }); return { docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } }; }); } });
      },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      } };
    return q;
  }
  var db = { collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = { get: function (r) { return r.get(); }, set: function (r, d, o) { write(r.path, d, o && o.merge); return tx; },
        update: function (r, d) { write(r.path, d, true); return tx; }, delete: function (r) { delete docs[r.path]; return tx; } };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, d, o && o.merge); }); }, update: function (r, d) { ops.push(function () { write(r.path, d, true); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); }, commit: function () { ops.forEach(function (f) { f(); }); return Promise.resolve(); } };
    } };
  var bucket = { name: 'test-bucket', file: function (p) {
    return { name: p,
      save: function (buf) { files[p] = Buffer.from(buf); return Promise.resolve(); }, delete: function () { delete files[p]; return Promise.resolve(); },
      exists: function () { return Promise.resolve([!!files[p]]); },
      download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      getMetadata: function () { return files[p] ? Promise.resolve([{ size: files[p].length, updated: '2026-01-01T00:00:00.000Z' }]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      setMetadata: function () { return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } };
  } };
  var auth = { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files };
}
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
const api = require('./api');
const hooks = api._testHooks;

function call(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = { host: 'localhost' };
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    var body = opts.body ? JSON.stringify(opts.body) : '';
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body) };
    if (body) headers['content-type'] = 'application/json';
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, text: t, body: j, headers: res.headers }); } };
    api.handleApi(req, res);
  });
}

/* ---------- the page ---------- */
var NOTE = 'The previous edition\'s logo shows \'26 and could not be updated to \'27, so the event\'s name is shown here instead.';
function page(note, extra) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body>' +
    '<section data-rv-section="hero" class="hero-root hero-on-light"><div class="rv-lu rv-lu-pic rv-lu-on-light" data-rv-logo-unit' +
    (note != null ? ' data-rv-logo-note="' + note.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"' : '') + '><img class="rv-lu-img" src="https://x/l.png" alt="T"></div></section>' +
    (extra || '') + '</body></html>';
}
var CLEAN = page(null), NOTED = page(NOTE);

/* ---------- 1. reading the note ---------- */
ok(hooks.unansweredLogoNote(NOTED) === NOTE, 'the note on the unit, as written (entities read)', hooks.unansweredLogoNote(NOTED));
ok(hooks.unansweredLogoNote(CLEAN) === null, 'no note: nothing to answer');
ok(hooks.unansweredLogoNote(page(null, '<script>var a = "data-rv-logo-note=x";</script><!-- data-rv-logo-note="y" -->')) === null, 'the name in a script or a comment is not a note');
ok(hooks.unansweredLogoNote(page('')) === ' ', 'an empty note is still a notice left open');
ok(hooks.unansweredLogoNote(null) === null && hooks.unansweredLogoNote('') === null, 'no page: nothing');
var ownerErr = hooks.logoNoteError(NOTE, 'owner'), approverErr = hooks.logoNoteError(NOTE + ' ' + 'x'.repeat(400), 'approver');
ok(ownerErr.status === 409 && ownerErr.body && ownerErr.body.code === 'logo-unit-unanswered' && /Looks right/.test(ownerErr.message) && /save/.test(ownerErr.message) && ownerErr.message.indexOf(NOTE) !== -1,
  'the owner is told what is open and what to do', JSON.stringify({ status: ownerErr.status, body: ownerErr.body, message: ownerErr.message }));
ok(/Reject this request/.test(approverErr.message) && approverErr.message.length < 600 && /…”\)/.test(approverErr.message), 'the approver is told to reject it, the note cut short', approverErr.message);

/* ---------- 2. the routes ---------- */
var NOW = '2026-02-01T00:00:00.000Z';
function save(path, text) { return FB.bucket.file(path).save(text); }
function live(id) { return FB.files['events/' + id + '/published/index.html'] ? String(FB.files['events/' + id + '/published/index.html']) : null; }

(async function () {
  /* direct publishing (approval switched off) */
  FB.docs['config/approvals'] = { required: false };
  FB.docs['events/lu-direct'] = { name: 'Direct', createdAt: NOW, site: { version: 1, templateId: 'gen-lu-direct' } };
  await save('events/lu-direct/site/page.html', NOTED);
  var r = await call('POST', '/api/event/publish', { token: 'owner', body: { eventId: 'lu-direct' } });
  ok(r.status === 409 && r.body && r.body.code === 'logo-unit-unanswered' && /Looks right/.test(r.body.error), 'publish: refused while the notice is open, with what to do', r.status + ' ' + r.text);
  ok(live('lu-direct') === null && !FB.docs['events/lu-direct'].published, 'publish: nothing went live');
  await save('events/lu-direct/site/page.html', CLEAN);
  r = await call('POST', '/api/event/publish', { token: 'owner', body: { eventId: 'lu-direct' } });
  ok(r.status === 200 && FB.docs['events/lu-direct'].published === true && live('lu-direct') && live('lu-direct').indexOf('data-rv-logo-note') === -1, 'publish: answered and saved, it goes live (the lock was let go)', r.status + ' ' + r.text.slice(0, 200));

  /* an editor of before sends the page along: refused before it is saved over the site */
  FB.docs['events/lu-legacy'] = { name: 'Legacy', createdAt: NOW, site: { version: 1, templateId: 'gen-lu-legacy' } };
  await save('events/lu-legacy/site/page.html', CLEAN);
  r = await call('POST', '/api/event/publish', { token: 'owner', body: { eventId: 'lu-legacy', html: NOTED } });
  ok(r.status === 409 && r.body && r.body.code === 'logo-unit-unanswered', 'publish (page sent along): refused', r.status + ' ' + r.text);
  ok(String(FB.files['events/lu-legacy/site/page.html']) === CLEAN && live('lu-legacy') === null, 'publish (page sent along): the saved site is not overwritten, nothing went live');

  /* asking for approval */
  FB.docs['config/approvals'] = { required: true, allowSelf: false };
  FB.docs['events/lu-apv'] = { name: 'Approval', createdAt: NOW, site: { version: 2, templateId: 'gen-lu-apv' } };
  await save('events/lu-apv/site/versions/2/page.html', NOTED);
  await save('events/lu-apv/site/page.html', CLEAN);           // the version kept is what is read, not page.html
  r = await call('POST', '/api/event/approval/request', { token: 'owner', body: { eventId: 'lu-apv' } });
  ok(r.status === 409 && r.body && r.body.code === 'logo-unit-unanswered', 'request: refused for the version kept with the notice open', r.status + ' ' + r.text);
  ok(!FB.docs['events/lu-apv'].approval && !Object.keys(FB.docs).some(function (k) { return k.indexOf('events/lu-apv/approvals/') === 0; }), 'request: no request was made');

  /* approving a request made before the notice was enforced */
  FB.docs['events/lu-apv'].approval = { id: 'req0001', toVersion: 2, requestedBy: 'owner@timesinternet.in' };
  FB.docs['events/lu-apv/approvals/req0001'] = { status: 'pending', eventId: 'lu-apv', toVersion: 2, fromVersion: 0, requestedBy: 'owner@timesinternet.in', requestedAt: NOW, items: [], saves: [] };
  r = await call('GET', '/api/event/approval?eventId=lu-apv', { token: 'approver' });
  ok(r.status === 200 && r.body.canDecide === true && r.body.canApprove === false && r.body.logoNote === true && /Reject this request/.test(r.body.whyNot), 'approval page: Reject only, and why', r.status + ' ' + r.text.slice(0, 400));
  r = await call('POST', '/api/event/approval/decide', { token: 'approver', body: { eventId: 'lu-apv', id: 'req0001', decision: 'approve' } });
  ok(r.status === 409 && r.body && r.body.code === 'logo-unit-unanswered' && /Reject this request/.test(r.body.error), 'decide: approval refused, worded for the approver', r.status + ' ' + r.text);
  ok(FB.docs['events/lu-apv/approvals/req0001'].status === 'pending' && live('lu-apv') === null && !FB.docs['events/lu-apv'].published, 'decide: the request stays open, nothing went live');
  r = await call('POST', '/api/event/approval/decide', { token: 'approver', body: { eventId: 'lu-apv', id: 'req0001', decision: 'reject', note: 'Answer the logo notice' } });
  ok(r.status === 200 && FB.docs['events/lu-apv/approvals/req0001'].status === 'rejected', 'decide: it can be rejected with the reason', r.status + ' ' + r.text);

  /* an answered version is approvable; the approval page says nothing of a notice */
  FB.docs['events/lu-ok'] = { name: 'Fine', createdAt: NOW, site: { version: 3, templateId: 'gen-lu-ok' }, approval: { id: 'req0002', toVersion: 3, requestedBy: 'owner@timesinternet.in' } };
  await save('events/lu-ok/site/versions/3/page.html', CLEAN);
  FB.docs['events/lu-ok/approvals/req0002'] = { status: 'pending', eventId: 'lu-ok', toVersion: 3, fromVersion: 0, requestedBy: 'owner@timesinternet.in', requestedAt: NOW, items: [], saves: [] };
  r = await call('GET', '/api/event/approval?eventId=lu-ok', { token: 'approver' });
  ok(r.status === 200 && r.body.canApprove === true && r.body.logoNote === false && !r.body.whyNot, 'approval page: an answered version can be approved', r.text.slice(0, 300));
  r = await call('POST', '/api/event/approval/decide', { token: 'approver', body: { eventId: 'lu-ok', id: 'req0002', decision: 'approve' } });
  ok(r.status === 200 && FB.docs['events/lu-ok'].published === true, 'decide: an answered version goes live', r.status + ' ' + r.text.slice(0, 200));

  /* a version already live goes out again as it is, notice or not (tools/republish-current.js) */
  FB.docs['events/lu-live'] = { name: 'Live', createdAt: NOW, site: { version: 4, templateId: 'gen-lu-live' }, published: true, publishedVersion: 4 };
  await save('events/lu-live/site/versions/4/page.html', NOTED);
  var again = await hooks.publishVersion(FB, { headers: { host: 'localhost' } }, 'lu-live', 4, 'platform', '').then(function (o) { return o; }, function (e) { return e; });
  ok(again && again.publishedVersion === 4 && live('lu-live') && live('lu-live').indexOf('data-rv-logo-note') === -1, 'republish of the live version: it goes out again, the note taken off', again && (again.message || JSON.stringify(again)));
  var gated = await hooks.publishVersion(FB, { headers: { host: 'localhost' } }, 'lu-live', 4, 'platform', '', null, { logoGate: true }).then(function (o) { return o; }, function (e) { return e; });
  ok(gated && gated.publishedVersion === 4, 'an approval of the version already live is not refused for it either', gated && gated.message);

  if (failures.length) { console.error('logo-note-gate: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('logo-note-gate: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (e) { console.error('logo-note-gate: the checks did not run — ' + (e && e.stack)); process.exit(1); });
