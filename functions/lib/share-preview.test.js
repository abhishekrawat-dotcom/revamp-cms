/* node functions/lib/share-preview.test.js — shareable preview links (lib/share-preview.js and its hooks in
   lib/api.js, lib/access.js, lib/api-events.js, lib/activity.js, lib/site-seo.js, server.js, tools/serve.js and
   templates/_shared/rv-forms.js), run through the real router (lib/api.js handleApi) against an in-memory Firestore
   and Storage:
     - making, listing and stopping links: who may, the limits, what is stored (never the token), History;
     - the public page /s/<token>: the saved site through the preview transform with no editor tools, its
       headers, the same as /preview/ otherwise, internal pages, every dead link the same 404;
     - deleting, restoring and discarding the event; the sign-in gate; robots.txt; the forms runtime's
       "shared" mode (nothing is sent); no visit counted;
     - and that no token ever reaches a log line, failure paths included.
   No network, no real project, no AI. Exits 1 on any failure. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* every console line of the whole run, to prove no token is ever logged */
var LOGS = [];
['log', 'info', 'warn', 'error', 'debug'].forEach(function (k) {
  var orig = console[k].bind(console);
  console[k] = function () {
    var line = Array.prototype.map.call(arguments, function (a) { return a && a.stack ? a.stack : String(a); }).join(' ');
    LOGS.push(line);
    if (process.env.SHARE_TEST_VERBOSE) orig(line);
  };
});
var realError = function (s) { process.stderr.write(s + '\n'); };

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  realError('FAIL ' + name + (detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600) : ''));
}
function count(text, needle) { return String(text).split(needle).length - 1; }

/* ---------- an in-memory Firestore + Storage, just enough for these routes ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function setPath(obj, dotted, value) {
  var keys = dotted.split('.'), o = obj;
  for (var i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  if (isDelete(value)) delete o[keys[keys.length - 1]]; else o[keys[keys.length - 1]] = clone(value);
}
function fakeFb() {
  var docs = {}, files = {}, updated = {}, seq = 0, tick = 0;
  function snap(p) {
    var d = docs[p];
    return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } };
  }
  function write(p, kind, data, o) {
    if (kind === 'set' && !(o && o.merge)) docs[p] = {};
    if (!docs[p]) docs[p] = {};
    Object.keys(data).forEach(function (k) {
      if (kind === 'update') setPath(docs[p], k, data[k]);
      else if (isDelete(data[k])) delete docs[p][k];
      else docs[p][k] = clone(data[k]);
    });
  }
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p, _doc: true,
      collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, 'set', data, o); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, 'update', data); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); },
      create: function (data) { if (docs[p]) return Promise.reject(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })); docs[p] = clone(data); return Promise.resolve(); }
    };
  }
  function colRef(p, filters) {
    filters = filters || [];
    var q = {
      path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + (++seq)))); },
      add: function (data) { var r = docRef(p + '/auto' + (++seq)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) { return colRef(p, filters.concat([{ field: field, value: value }])); },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; })
          .filter(function (k) { return filters.every(function (f) { return docs[k][f.field] === f.value; }); }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      }
    };
    return q;
  }
  var db = {
    collection: function (n) { return colRef(n); },
    runTransaction: function (fn) {
      var tx = {
        get: function (r) { return r.get(); },
        set: function (r, d, o) { write(r.path, 'set', d, o); return tx; },
        update: function (r, d) { write(r.path, 'update', d); return tx; },
        delete: function (r) { delete docs[r.path]; return tx; }
      };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return {
        set: function (r, d, o) { ops.push(function () { write(r.path, 'set', d, o); }); },
        update: function (r, d) { ops.push(function () { write(r.path, 'update', d); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); },
        commit: function () { ops.forEach(function (f) { f(); }); return Promise.resolve(); }
      };
    },
    recursiveDelete: function (ref) {
      Object.keys(docs).forEach(function (k) { if (k === ref.path || k.indexOf(ref.path + '/') === 0) delete docs[k]; });
      return Promise.resolve();
    }
  };
  var bucket = {
    name: 'test-bucket',
    file: function (p) {
      return {
        name: p,
        save: function (buf) { files[p] = Buffer.from(buf); updated[p] = new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString(); return Promise.resolve(); },
        delete: function () { delete files[p]; return Promise.resolve(); },
        exists: function () { return Promise.resolve([!!files[p]]); },
        download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
        getMetadata: function () { return files[p] ? Promise.resolve([{ size: files[p].length, updated: updated[p] }]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
        setMetadata: function () { return Promise.resolve(); }
      };
    },
    deleteFiles: function (o) {
      Object.keys(files).forEach(function (k) { if (k.indexOf(o.prefix) === 0) delete files[k]; });
      return Promise.resolve();
    }
  };
  var auth = { verifyIdToken: function (t) {
    if (t === 'outsider') return Promise.resolve({ email: 'someone@gmail.com', uid: 'u-out', email_verified: true, firebase: { sign_in_provider: 'google.com' } });
    return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } });
  } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files };
}

/* every require below sees this Firebase */
var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
delete process.env.PUBLIC_BASE_URL;
/* other hosts' stylesheets are never fetched here (lib/delivery.js) */
require('./delivery')._testFetch(function (url, done) { done(null); });

const api = require('./api');
const T = require('./share-token');
const SP = require('./share-preview');
const access = require('./access');
const siteSeo = require('./site-seo');
const activity = require('./activity');
const RP = require('../../templates/_shared/rv-pages.js');
const ROOT = path.join(__dirname, '..', '..');
const SP_PATH = require.resolve('./share-preview');

/* every token this run has seen: none may appear in a log line */
var TOKENS = [];
function remember(t) { if (t && TOKENS.indexOf(t) === -1) TOKENS.push(t); return t; }

var ipSeq = 0;
function call(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'x-forwarded-for': opts.ip || ('10.1.' + ((ipSeq >> 8) & 255) + '.' + ((ipSeq++) & 255)) };
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    if (opts.cookie) headers.cookie = opts.cookie;
    var body = opts.body ? JSON.stringify(opts.body) : '';
    if (body) headers['content-type'] = 'application/json';
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body) };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.keys(h || {}).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, text: t, body: j, headers: res.headers }); }
    };
    api.handleApi(req, res);
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }
function linesOf(eventId, action) {
  var pre = 'events/' + eventId + '/activity/';
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf(pre) === 0; }).map(function (k) { return FB.docs[k]; })
    .filter(function (l) { return !action || l.action === action; }).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
}
function linkDocs(eventId) {
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf('sharePreviews/') === 0 && FB.docs[k].eventId === eventId; })
    .map(function (k) { return Object.assign({ _id: k.split('/')[1] }, FB.docs[k]); });
}
function pathOf(url) { return String(url).replace(/^https?:\/\/[^/]+/, ''); }
function tokenOf(url) { var m = /\/s\/([A-Za-z0-9_-]{43})/.exec(String(url)); return m ? remember(m[1]) : ''; }
function iso(msFromNow) { return new Date(Date.now() + msFromNow).toISOString(); }
var DAY = 86400000;

/* ---------- the events ---------- */
var CREATED = '2026-10-01T09:00:00.000Z';
var DESIGN = { mode: 'light', primary: '#123456', accent: '#ff8800', bg: '#ffffff', text: '#111111', headingFont: 'Inter', bodyFont: 'Inter' };
function onePage(marker, extra) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Site</title>\n</head>\n<body>\n' +
    '<section data-rv-section="hero" id="hero"' + (extra || '') + '><h1>Welcome</h1><p>' + marker + '</p><a href="#register" data-register-cta>Register now</a></section>\n' +
    '<section data-rv-section="about" id="about"><h2>About</h2><p>All about it.</p></section>\n</body>\n</html>\n';
}
var PAGES_JSON = '[{"slug":"agenda","title":"Agenda"}]';
function multiPage(marker) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Multi</title>\n' +
    "<meta name=\"rv-pages\" content='" + PAGES_JSON + "'>\n</head>\n<body>\n" +
    '<header data-rv-section="nav" data-rv-page="*"><nav><a data-rv-page-link="home" href="#">Home</a> <a data-rv-page-link="agenda" href="#">Agenda</a></nav></header>\n' +
    '<section data-rv-section="hero" id="hero"><h1>Home</h1><p>' + marker + '</p></section>\n' +
    '<section data-rv-section="agenda" id="agenda" data-rv-page="agenda"><h2>The agenda</h2></section>\n</body>\n</html>\n';
}
function makeEvent(id, o) {
  o = o || {};
  FB.docs['events/' + id] = Object.assign({
    name: o.name || ('Event ' + id), createdAt: o.createdAt || CREATED, createdBy: 'editor@timesinternet.in', updatedAt: CREATED,
    site: { version: o.version == null ? 3 : o.version, templateId: o.templateId || 'tech500' }, templateId: o.templateId || 'tech500'
  }, o.extra || {});
  if (o.page !== false) return FB.bucket.file('events/' + id + '/site/page.html').save(o.page || onePage('SAVED-' + id));
  return Promise.resolve();
}
function seedLink(eventId, o) {
  o = o || {};
  var tok = T.newToken(), id = T.hashToken(tok);
  FB.docs['sharePreviews/' + id] = Object.assign({
    v: 1, eventId: eventId, eventCreatedAt: CREATED, createdBy: 'seed@timesinternet.in', createdAt: iso(-DAY), expiresAt: iso(6 * DAY),
    revokedAt: null, revokedBy: null, revokeReason: null, last4: T.last4(tok), label: '', madeAtVersion: 3
  }, o);
  return { token: remember(tok), id: id };
}

var EV = 'qa-share-main';            // an AI-designed site: /preview/ has the theme switcher, rv-theme.js and "Edit with AI"
var MP = 'qa-share-multi';           // a site with an internal page

(async function () {
  await makeEvent(EV, { name: 'Shared Summit QA', templateId: 'gen-' + EV, extra: { designPlan: { design: DESIGN, sections: [] } } });
  await makeEvent(MP, { name: 'Multi Page QA', page: multiPage('SAVED-MP') });

  /* ============ 1. make a link ============ */
  var anon = await call('POST', '/api/event/share-preview', { body: { eventId: EV } });
  check('1 make: no sign-in -> 401', anon.status === 401, anon.status);
  var outsider = await call('POST', '/api/event/share-preview', { token: 'outsider', body: { eventId: EV } });
  check('1 make: an account outside the company -> 403', outsider.status === 403, outsider.status);

  var LABEL_IN = '  Infosys team asha.rao@gmail.com\n' + new Array(80).join('x') + '  ';
  var made = await call('POST', '/api/event/share-preview', { token: 'editor', body: { eventId: EV, label: LABEL_IN, origin: 'https://cms.example' } });
  var tok1 = tokenOf(made.body && made.body.url);
  check('1 make: 200 for a team member', made.status === 200 && !!tok1, made.status + ' ' + made.text.slice(0, 300));
  check('1 make: the answer is no-store', made.headers['cache-control'] === 'no-store', made.headers['cache-control']);
  check('1 make: url is the origin asked for + /s/<43-char token>', made.body.url === 'https://cms.example/s/' + tok1, made.body.url);
  var link1 = made.body.link || {};
  var doc1 = FB.docs['sharePreviews/' + T.hashToken(tok1)];
  check('1 make: the document id is hashToken(token), and the answer\'s id is that hash', !!doc1 && link1.id === T.hashToken(tok1), link1.id);
  check('1 make: expires exactly 7 × 24 h after it was made', Date.parse(doc1.expiresAt) - Date.parse(doc1.createdAt) === 7 * 86400000, doc1.createdAt + ' -> ' + doc1.expiresAt);
  check('1 make: the document records the event, who, when, last4, its version and the event\'s createdAt',
    doc1.eventId === EV && doc1.createdBy === 'editor@timesinternet.in' && doc1.last4 === tok1.slice(-4) && doc1.madeAtVersion === 3 &&
    doc1.eventCreatedAt === CREATED && doc1.revokedAt === null && doc1.v === 1, doc1);
  var cleanLabel = ('Infosys team asha.rao@gmail.com ' + new Array(80).join('x')).slice(0, 60);
  check('1 make: the label is one line, trimmed to 60 characters', doc1.label === cleanLabel && link1.label === cleanLabel && doc1.label.length === 60, JSON.stringify(doc1.label));
  check('1 make: the answer\'s link has no token in it', JSON.stringify(link1).indexOf(tok1) === -1 && !('token' in link1), link1);
  check('1 make: the token is stored nowhere (Firestore, Storage)', JSON.stringify(FB.docs).indexOf(tok1) === -1 &&
    Object.keys(FB.files).every(function (k) { return k.indexOf(tok1) === -1 && String(FB.files[k]).indexOf(tok1) === -1; }));
  var shared1 = linesOf(EV, 'preview-link-shared');
  var l1 = shared1[shared1.length - 1] || {};
  check('1 make: one History line, preview-link-shared / publishing, by the person', shared1.length === 1 && l1.area === 'publishing' && l1.by === 'editor@timesinternet.in', shared1);
  check('1 make: the line names the link by …last4 and never by its token', l1.detail.indexOf('…' + tok1.slice(-4)) !== -1 && l1.detail.indexOf(tok1) === -1, l1.detail);
  check('1 make: the line says until when (IST) and which version', l1.detail.indexOf('works until ' + SP._test.istDateTime(doc1.expiresAt)) !== -1 && /IST \(version 3\)$/.test(l1.detail), l1.detail);
  check('1 make: an email address in the label is masked in History', l1.detail.indexOf('a***@gmail.com') !== -1 && l1.detail.indexOf('asha.rao@') === -1, l1.detail);
  check('1 make: no warnings when the logo unit has no note', Array.isArray(made.body.warnings) && made.body.warnings.length === 0, made.body.warnings);
  check('1 the History line reads in IST, en-IN', SP._test.istDateTime('2026-11-10T10:50:00.000Z') === '10 Nov 2026, 4:20 pm IST' && SP._test.istDay('2026-11-03T10:50:00.000Z') === '3 Nov' &&
    SP._test.istDateTime('2026-11-09T19:00:00.000Z') === '10 Nov 2026, 12:30 am IST' && SP._test.istDateTime('2026-11-10T06:30:00.000Z') === '10 Nov 2026, 12:00 pm IST');
  var noOrigin = await call('POST', '/api/event/share-preview', { token: 'editor', body: { eventId: EV } });
  check('1 make: without an origin, the address this server was reached at', noOrigin.status === 200 && /^http:\/\/localhost\/s\/[A-Za-z0-9_-]{43}$/.test(noOrigin.body.url), noOrigin.body && noOrigin.body.url);
  var tok1b = tokenOf(noOrigin.body.url);
  var badOrigin = await call('POST', '/api/event/share-preview', { token: 'editor', body: { eventId: EV, origin: 'javascript:alert(1)' } });
  check('1 make: an origin that is not one is ignored', badOrigin.status === 200 && /^http:\/\/localhost\/s\//.test(badOrigin.body.url), badOrigin.body && badOrigin.body.url);
  tokenOf(badOrigin.body.url);

  /* ============ 2. refusals ============ */
  await makeEvent('qa-share-unsaved', { version: 0, page: false });
  var unsaved = await call('POST', '/api/event/share-preview', { token: 'refuser', body: { eventId: 'qa-share-unsaved' } });
  check('2 a site never saved -> 409 site-not-saved, with the sentence', unsaved.status === 409 && unsaved.body.code === 'site-not-saved' && /Save the site first/.test(unsaved.body.error), unsaved.text);
  await makeEvent('qa-share-deleted', { extra: { deletedAt: iso(-1000) } });
  var del = await call('POST', '/api/event/share-preview', { token: 'refuser', body: { eventId: 'qa-share-deleted' } });
  var missing = await call('POST', '/api/event/share-preview', { token: 'refuser', body: { eventId: 'qa-share-nobody' } });
  FB.docs['events/qa-share-shell'] = { name: 'shell' };
  var shell = await call('POST', '/api/event/share-preview', { token: 'refuser', body: { eventId: 'qa-share-shell' } });
  check('2 a deleted, missing or shell event -> 404 event-not-found', del.status === 404 && missing.status === 404 && shell.status === 404 &&
    del.body.code === 'event-not-found' && missing.body.code === 'event-not-found', [del.text, missing.text, shell.text]);
  check('2 … and no link was stored for them', linkDocs('qa-share-deleted').length + linkDocs('qa-share-nobody').length + linkDocs('qa-share-shell').length + linkDocs('qa-share-unsaved').length === 0);
  var badId1 = await call('POST', '/api/event/share-preview', { token: 'refuser', body: { eventId: '../x' } });
  var badId2 = await call('POST', '/api/event/share-preview', { token: 'refuser', body: {} });
  check('2 a bad or missing eventId -> 400', badId1.status === 400 && badId2.status === 400, badId1.status + ' ' + badId2.status);
  await makeEvent('qa-share-logo', { page: onePage('SAVED-LOGO', ' data-rv-logo-note="The year could not be moved"') });
  var logo = await call('POST', '/api/event/share-preview', { token: 'refuser', body: { eventId: 'qa-share-logo' } });
  check('2 an unanswered logo-unit note only warns: 200 with warnings[0].code logo-note', logo.status === 200 && logo.body.warnings.length === 1 && logo.body.warnings[0].code === 'logo-note' &&
    /logo unit/.test(logo.body.warnings[0].message), logo.text.slice(0, 400));
  var logoTok = tokenOf(logo.body.url);
  var logoPage = await call('GET', '/s/' + logoTok);
  check('2 … and the shared page carries no data-rv-logo-note (an editor-only mark)', logoPage.status === 200 && logoPage.text.indexOf('data-rv-logo-note') === -1, logoPage.status);

  /* ============ 3. limits ============ */
  await makeEvent('qa-share-rl');
  var rl = [];
  for (var i = 0; i < 11; i++) rl.push(await call('POST', '/api/event/share-preview', { token: 'busy', body: { eventId: 'qa-share-rl' } }));
  rl.forEach(function (r) { if (r.body && r.body.url) tokenOf(r.body.url); });
  check('3 ten links by one person in 10 minutes are made', rl.slice(0, 10).every(function (r) { return r.status === 200; }), rl.map(function (r) { return r.status; }).join());
  check('3 the 11th -> 429 rate-limited with Retry-After', rl[10].status === 429 && rl[10].body.code === 'rate-limited' && +rl[10].headers['retry-after'] > 0 && /wait/.test(rl[10].body.error), rl[10].text);
  check('3 … and stores nothing', linkDocs('qa-share-rl').length === 10);
  await makeEvent('qa-share-cap');
  for (i = 0; i < 20; i++) seedLink('qa-share-cap');
  var cap = await call('POST', '/api/event/share-preview', { token: 'capper', body: { eventId: 'qa-share-cap' } });
  check('3 a 21st working link -> 409 too-many-links', cap.status === 409 && cap.body.code === 'too-many-links' && /20 links/.test(cap.body.error), cap.text);
  await makeEvent('qa-share-cap2');
  for (i = 0; i < 19; i++) seedLink('qa-share-cap2');
  for (i = 0; i < 5; i++) seedLink('qa-share-cap2', { expiresAt: iso(-DAY) });
  for (i = 0; i < 5; i++) seedLink('qa-share-cap2', { revokedAt: iso(-DAY), revokedBy: 'x@timesinternet.in', revokeReason: 'stopped' });
  for (i = 0; i < 5; i++) seedLink('qa-share-cap2', { eventCreatedAt: '2025-01-01T00:00:00.000Z' });   // an earlier event at this address
  var cap2 = await call('POST', '/api/event/share-preview', { token: 'capper2', body: { eventId: 'qa-share-cap2' } });
  check('3 expired, stopped and an earlier event\'s links do not count toward the 20', cap2.status === 200, cap2.text);
  tokenOf(cap2.body && cap2.body.url);
  var cap3 = await call('POST', '/api/event/share-preview', { token: 'capper3', body: { eventId: 'qa-share-cap2' } });
  check('3 … the 21st working one is refused', cap3.status === 409 && cap3.body.code === 'too-many-links', cap3.text);

  /* ============ 4. list ============ */
  await makeEvent('qa-share-list');
  var a = seedLink('qa-share-list', { createdAt: iso(-3 * DAY), label: 'first', createdBy: 'a@timesinternet.in' });
  var b = seedLink('qa-share-list', { createdAt: iso(-2 * DAY), label: 'second' });
  var c = seedLink('qa-share-list', { createdAt: iso(-1 * DAY), label: 'third' });
  var expired = seedLink('qa-share-list', { createdAt: iso(-8 * DAY), expiresAt: iso(-DAY) });
  var stopped = seedLink('qa-share-list', { revokedAt: iso(-1000), revokedBy: 'x@timesinternet.in', revokeReason: 'stopped' });
  var old31 = seedLink('qa-share-list', { createdAt: iso(-40 * DAY), expiresAt: iso(-33 * DAY), revokedAt: iso(-31 * DAY), revokeReason: 'stopped' });
  var old29 = seedLink('qa-share-list', { createdAt: iso(-35 * DAY), expiresAt: iso(-28 * DAY), revokedAt: iso(-29 * DAY), revokeReason: 'stopped' });
  var exp40 = seedLink('qa-share-list', { createdAt: iso(-47 * DAY), expiresAt: iso(-40 * DAY) });
  var exp20 = seedLink('qa-share-list', { createdAt: iso(-27 * DAY), expiresAt: iso(-20 * DAY) });
  var earlier = seedLink('qa-share-list', { eventCreatedAt: '2025-01-01T00:00:00.000Z' });
  var otherEv = seedLink('qa-share-cap');
  var listAnon = await call('GET', '/api/event/share-preview?eventId=qa-share-list');
  check('4 list: no sign-in -> 401', listAnon.status === 401, listAnon.status);
  var list = await call('GET', '/api/event/share-preview?eventId=qa-share-list', { token: 'lister' });
  var ids = (list.body && list.body.links || []).map(function (l) { return l.id; });
  check('4 list: 200, the working links only, newest first', list.status === 200 && ids.join() === [c.id, b.id, a.id].join(), list.text.slice(0, 500));
  check('4 list: maxActive 20, days 7', list.body.maxActive === 20 && list.body.days === 7);
  check('4 list: each link has id, last4, label, createdBy, createdAt, expiresAt, madeAtVersion', list.body.links[2].label === 'first' && list.body.links[2].createdBy === 'a@timesinternet.in' &&
    list.body.links[2].last4 === a.token.slice(-4) && list.body.links[2].madeAtVersion === 3 && !!list.body.links[2].expiresAt, list.body.links[2]);
  check('4 list: no token anywhere in the answer, and no "token" key', [a, b, c].every(function (x) { return list.text.indexOf(x.token) === -1; }) && list.text.indexOf('"token"') === -1);
  check('4 list: housekeeping deletes links stopped / expired more than 30 days ago', !FB.docs['sharePreviews/' + old31.id] && !FB.docs['sharePreviews/' + exp40.id]);
  check('4 list: … and keeps those of 29 and 20 days, and every recent one', !!FB.docs['sharePreviews/' + old29.id] && !!FB.docs['sharePreviews/' + exp20.id] &&
    !!FB.docs['sharePreviews/' + expired.id] && !!FB.docs['sharePreviews/' + stopped.id] && !!FB.docs['sharePreviews/' + earlier.id] && !!FB.docs['sharePreviews/' + otherEv.id]);
  var listDel = await call('GET', '/api/event/share-preview?eventId=qa-share-deleted', { token: 'lister' });
  var listMissing = await call('GET', '/api/event/share-preview?eventId=qa-share-nobody', { token: 'lister' });
  var listBad = await call('GET', '/api/event/share-preview?eventId=..', { token: 'lister' });
  check('4 list: a deleted or missing event -> 404; a bad id -> 400', listDel.status === 404 && listMissing.status === 404 && listBad.status === 400, [listDel.status, listMissing.status, listBad.status].join());

  /* ============ 5. stop ============ */
  var stopAnon = await call('POST', '/api/event/share-preview/stop', { body: { eventId: EV, id: link1.id } });
  check('5 stop: no sign-in -> 401', stopAnon.status === 401, stopAnon.status);
  var stopOther = await call('POST', '/api/event/share-preview/stop', { token: 'stopper', body: { eventId: MP, id: link1.id } });
  check('5 stop: the link of another event -> 404, and it keeps working', stopOther.status === 404 && stopOther.body.code === 'link-not-found' && FB.docs['sharePreviews/' + link1.id].revokedAt === null, stopOther.text);
  var stopBad = await call('POST', '/api/event/share-preview/stop', { token: 'stopper', body: { eventId: EV, id: 'nothex' } });
  var stopNone = await call('POST', '/api/event/share-preview/stop', { token: 'stopper', body: { eventId: EV, id: new Array(65).join('a') } });
  check('5 stop: a malformed id -> 400, an unknown one -> 404', stopBad.status === 400 && stopNone.status === 404, stopBad.status + ' ' + stopNone.status);
  var beforeStop = await call('GET', '/s/' + tok1);
  check('5 the link works before it is stopped', beforeStop.status === 200, beforeStop.status);
  var stop1 = await call('POST', '/api/event/share-preview/stop', { token: 'stopper', body: { eventId: EV, id: link1.id } });
  var sdoc = FB.docs['sharePreviews/' + link1.id];
  check('5 stop: 200 changed:true; revokedAt, revokedBy, revokeReason stopped', stop1.status === 200 && stop1.body.ok === true && stop1.body.changed === true && stop1.body.id === link1.id &&
    !!sdoc.revokedAt && sdoc.revokedBy === 'stopper@timesinternet.in' && sdoc.revokeReason === 'stopped', stop1.text + ' ' + JSON.stringify(sdoc));
  var stopLines = linesOf(EV, 'preview-link-stopped');
  check('5 stop: one History line, preview-link-stopped / publishing, naming …last4 and who made it', stopLines.length === 1 && stopLines[0].area === 'publishing' &&
    stopLines[0].by === 'stopper@timesinternet.in' && stopLines[0].detail === 'Shared preview link …' + tok1.slice(-4) + ' switched off (made by editor@timesinternet.in on ' + SP._test.istDay(doc1.createdAt) + ')', stopLines);
  var stop2 = await call('POST', '/api/event/share-preview/stop', { token: 'stopper', body: { eventId: EV, id: link1.id } });
  check('5 stop again: 200 changed:false, and no second line', stop2.status === 200 && stop2.body.changed === false && linesOf(EV, 'preview-link-stopped').length === 1, stop2.text);
  var afterStop = await call('GET', '/s/' + tok1);
  check('5 the stopped link answers the gone page at once', afterStop.status === 404 && afterStop.text.indexOf(SP._test.GONE_TITLE) !== -1, afterStop.status);
  var expiredStop = await call('POST', '/api/event/share-preview/stop', { token: 'stopper', body: { eventId: 'qa-share-list', id: expired.id } });
  check('5 stopping a link that already ran out: changed:false, no line', expiredStop.status === 200 && expiredStop.body.changed === false && linesOf('qa-share-list', 'preview-link-stopped').length === 0, expiredStop.text);

  /* ============ 6. the public page ============ */
  var tok6 = tok1b;
  var pub = await call('GET', '/s/' + tok6);
  var H6 = pub.headers;
  check('6 /s/<t> with no sign-in at all: 200', pub.status === 200, pub.status + ' ' + pub.text.slice(0, 200));
  check('6 headers: no-store', H6['cache-control'] === 'no-store', H6['cache-control']);
  check('6 headers: X-Robots-Tag noindex, nofollow, noarchive', H6['x-robots-tag'] === 'noindex, nofollow, noarchive');
  check('6 headers: Referrer-Policy strict-origin', H6['referrer-policy'] === 'strict-origin', H6['referrer-policy']);
  check('6 headers: no framing', H6['x-frame-options'] === 'DENY' && H6['content-security-policy'] === "frame-ancestors 'none'");
  check('6 headers: nosniff, Vary, html, and no Set-Cookie', H6['x-content-type-options'] === 'nosniff' && H6['vary'] === 'Accept-Encoding' && /^text\/html/.test(H6['content-type']) && !('set-cookie' in H6));
  check('6 the ribbon reads "Preview — not live yet", not "not published"', pub.text.indexOf('Preview — not live yet') !== -1 && pub.text.indexOf('Preview — not published') === -1);
  check('6 the noindex meta', /<meta name="robots" content="noindex, nofollow"/.test(pub.text));
  check('6 #rv-site-config says shared:true, mode preview', /<script id="rv-site-config"[^>]*>[^<]*"mode":"preview"[^<]*"shared":true/.test(pub.text), (pub.text.match(/<script id="rv-site-config"[^>]*>[^<]*/) || [''])[0]);
  check('6 the saved page is what is shown', pub.text.indexOf('SAVED-' + EV) !== -1);
  check('6 no editor tools: no theme switcher, no #rv-themes, no rv-theme.js, no rv-preview-edit.js',
    pub.text.indexOf('rv-theme-switcher.js') === -1 && pub.text.indexOf('id="rv-themes"') === -1 && pub.text.indexOf('rv-theme.js') === -1 && pub.text.indexOf('rv-preview-edit.js') === -1);
  check('6 the forms runtime and the forms are there (they open; the runtime sends nothing)', pub.text.indexOf('rv-forms.js') !== -1);
  var gz = await new Promise(function (resolve) {
    var req = { method: 'GET', url: '/s/' + tok6, headers: { host: 'localhost', 'accept-encoding': 'gzip', 'x-forwarded-for': '10.9.9.9' }, socket: {}, rawBody: Buffer.from('') };
    req.on = function () { return req; };
    var res = { headers: {}, headersSent: false, writeHead: function (s, h) { res.status = s; Object.keys(h).forEach(function (k) { res.headers[k.toLowerCase()] = h[k]; }); res.headersSent = true; },
      end: function (b) { resolve({ status: res.status, headers: res.headers, body: b }); } };
    api.handleApi(req, res);
  });
  check('6 compressed when the browser accepts it, with the same headers', gz.status === 200 && gz.headers['content-encoding'] === 'gzip' && gz.headers['cache-control'] === 'no-store' &&
    require('zlib').gunzipSync(gz.body).toString('utf8') === pub.text, gz.headers);
  /* the console of the team still has its tools on /preview/ */
  var prev = await call('GET', '/preview/' + EV, { token: 'editor' });
  check('6 contrast: /preview/ (signed in) has the switcher, #rv-themes, rv-theme.js and Edit with AI', prev.status === 200 && prev.text.indexOf('rv-theme-switcher.js') !== -1 &&
    prev.text.indexOf('id="rv-themes"') !== -1 && prev.text.indexOf('rv-theme.js') !== -1 && prev.text.indexOf('rv-preview-edit.js') !== -1 && prev.text.indexOf('Preview — not published') !== -1, prev.status);
  check('6 contrast: /preview/ has no "shared"', !/"shared":true/.test(prev.text));
  var prevAnon = await call('GET', '/preview/' + EV);
  check('6 /preview/ itself is still signed-in only (302 to sign-in)', prevAnon.status === 302 && /^\/\?next=/.test(prevAnon.headers.location || ''), prevAnon.status);
  function ribbonOf(t) { var m = /<div data-rv-preview-ribbon[^>]*>([^<]*)<\/div>/.exec(String(t)); return m ? m[1] : null; }
  function siteConfigOf(t) { var m = /<script id="rv-site-config"[^>]*>([^<]*)<\/script>/.exec(String(t)); try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; } }
  var cfg6 = siteConfigOf(pub.text);
  check('6 a site not yet published: the ribbon is exactly "Preview — not live yet"', ribbonOf(pub.text) === 'Preview — not live yet', ribbonOf(pub.text));
  check('6 … and #rv-site-config says nothing about a live site', !!cfg6 && cfg6.shared === true && !('live' in cfg6) && !('livePath' in cfg6), cfg6);

  /* ============ 6b. a site that is already live (the link shows its coming changes) ============ */
  await makeEvent('qa-share-live', { name: 'Live Event QA', extra: { published: true, publishedVersion: 2, publishedAt: CREATED } });     // saved v3, live v2
  await makeEvent('qa-share-same', { name: 'Same Event QA', extra: { published: true, publishedVersion: 3, publishedAt: CREATED } });     // saved v3 = live v3
  await makeEvent('qa-share-legacy', { name: 'Legacy Event QA', extra: { published: true, publishedAt: CREATED } });                     // published by the old CMS
  await makeEvent('qa-share-unpub', { name: 'Unpublished QA', extra: { published: false, publishedVersion: 3, unpublishedAt: CREATED } }); // taken down again
  var LIVE_IDS = ['qa-share-live', 'qa-share-same', 'qa-share-legacy', 'qa-share-unpub'], liveTok = {};
  for (var li = 0; li < LIVE_IDS.length; li++) {
    var lm = await call('POST', '/api/event/share-preview', { token: 'liver', body: { eventId: LIVE_IDS[li] } });
    check('6b make a link for ' + LIVE_IDS[li] + ': 200', lm.status === 200, lm.text.slice(0, 200));
    liveTok[LIVE_IDS[li]] = tokenOf(lm.body && lm.body.url);
  }
  var lvPage = await call('GET', '/s/' + liveTok['qa-share-live']);
  var lvCfg = siteConfigOf(lvPage.text);
  check('6b live with newer saved changes: 200, the ribbon reads "Preview — changes not live yet"', lvPage.status === 200 && ribbonOf(lvPage.text) === 'Preview — changes not live yet', lvPage.status + ' ' + ribbonOf(lvPage.text));
  check('6b … #rv-site-config: shared, live, livePath /e/<id> (its forms point the guest there)', !!lvCfg && lvCfg.mode === 'preview' && lvCfg.shared === true && lvCfg.live === true &&
    lvCfg.livePath === '/e/qa-share-live', lvCfg);
  check('6b … it still shows the saved page, with no editor tools, noindex', lvPage.text.indexOf('SAVED-qa-share-live') !== -1 && lvPage.text.indexOf('rv-theme-switcher.js') === -1 &&
    lvPage.text.indexOf('rv-preview-edit.js') === -1 && /<meta name="robots" content="noindex, nofollow"/.test(lvPage.text) && lvPage.headers['x-robots-tag'] === 'noindex, nofollow, noarchive');
  var samePage = await call('GET', '/s/' + liveTok['qa-share-same']);
  check('6b live and nothing saved since: the ribbon reads "Preview — this version is live", config live', samePage.status === 200 && ribbonOf(samePage.text) === 'Preview — this version is live' &&
    (siteConfigOf(samePage.text) || {}).livePath === '/e/qa-share-same', ribbonOf(samePage.text));
  var legacyPage = await call('GET', '/s/' + liveTok['qa-share-legacy']);
  check('6b published by the old CMS (no publishedVersion): "changes not live yet", never "this version is live"', legacyPage.status === 200 && ribbonOf(legacyPage.text) === 'Preview — changes not live yet' &&
    (siteConfigOf(legacyPage.text) || {}).live === true, ribbonOf(legacyPage.text));
  var unpubPage = await call('GET', '/s/' + liveTok['qa-share-unpub']);
  var unpubCfg = siteConfigOf(unpubPage.text) || {};
  check('6b published once and taken down: back to "Preview — not live yet", no live path', unpubPage.status === 200 && ribbonOf(unpubPage.text) === 'Preview — not live yet' &&
    !('live' in unpubCfg) && !('livePath' in unpubCfg), ribbonOf(unpubPage.text) + ' ' + JSON.stringify(unpubCfg).slice(0, 200));
  var lvPrev = await call('GET', '/preview/qa-share-live', { token: 'editor' });
  var lvPrevCfg = siteConfigOf(lvPrev.text) || {};
  /* the team's ribbon says what is true too (UX-110): a live site with newer saves is not "not published" */
  check('6b contrast: /preview/ of a live event keeps its own ribbon and config (no shared, no live)', lvPrev.status === 200 && ribbonOf(lvPrev.text) === 'Preview — changes not live yet' &&
    !('live' in lvPrevCfg) && !('shared' in lvPrevCfg), ribbonOf(lvPrev.text));
  check('6b liveStateOf: not published -> "", same version -> same, newer save -> changed, no publishedVersion -> changed',
    SP._test.liveStateOf({ site: { version: 3 } }) === '' && SP._test.liveStateOf({ published: 'yes', publishedVersion: 3, site: { version: 3 } }) === '' &&
    SP._test.liveStateOf({ published: true, publishedVersion: 3, site: { version: 3 } }) === 'same' &&
    SP._test.liveStateOf({ published: true, publishedVersion: 2, site: { version: 3 } }) === 'changed' &&
    SP._test.liveStateOf({ published: true, site: { version: 3 } }) === 'changed' && SP._test.liveStateOf(null) === '');

  /* ============ 7. the saved site, never a draft ============ */
  await FB.bucket.file('events/' + EV + '/site/drafts/u-editor.html').save(onePage('DRAFT-MARKER'));
  await FB.bucket.file('events/' + EV + '/staging/index.html').save(onePage('STAGED-MARKER'));
  await FB.bucket.file('events/' + EV + '/site/versions/1/page.html').save(onePage('VERSION1-MARKER'));
  var sv = await Promise.all(['', '?draft=1', '?staged=1', '?version=1', '?draft=1&staged=1&version=1'].map(function (q) { return call('GET', '/s/' + tok6 + q, { token: 'editor' }); }));
  check('7 /s/<t> with ?draft=1, ?staged=1, ?version=1 (even signed in) always shows page.html', sv.every(function (r) {
    return r.status === 200 && r.text.indexOf('SAVED-' + EV) !== -1 && r.text.indexOf('DRAFT-MARKER') === -1 && r.text.indexOf('STAGED-MARKER') === -1 && r.text.indexOf('VERSION1-MARKER') === -1;
  }), sv.map(function (r) { return r.status; }).join());
  var ownDraft = await call('GET', '/preview/' + EV + '?draft=1', { token: 'editor' });
  check('7 contrast: /preview/?draft=1 does show that person\'s newer draft', ownDraft.status === 200 && ownDraft.text.indexOf('DRAFT-MARKER') !== -1, ownDraft.status);

  /* ============ 8. the same page as /preview/, but for the known differences ============ */
  function normalise(t, id, token) {
    return String(t)
      .replace(/Preview — not published/g, 'Preview — not live yet')
      .replace(/Preview — (changes not live yet|this version is live|same as the live site)/g, 'Preview — not live yet')
      .replace(/<script[^>]*rv-theme\.js[^>]*><\/script>\n?/g, '')
      .replace(/<script type="application\/json" id="rv-themes"[^>]*>[^<]*<\/script>\n?/g, '')
      .replace(/<script[^>]*rv-theme-switcher\.js[^>]*><\/script>\n?/g, '')
      .replace(/<script[^>]*rv-preview-edit\.js[^>]*><\/script>\n?/g, '')
      .replace(/,"shared":true/g, '')
      .replace(/,"live":true,"livePath":"\/e\/[a-z0-9-]+"/g, '')
      .split('/s/' + token).join('/preview/' + id);
  }
  var prevPage = await call('GET', '/preview/' + EV, { token: 'editor' });
  var sharePage = await call('GET', '/s/' + tok6);
  check('8 parity: /s/<t> and /preview/<id> are byte-identical once the known differences are set aside', normalise(prevPage.text, EV, tok6) === normalise(sharePage.text, EV, tok6),
    firstDiff(normalise(prevPage.text, EV, tok6), normalise(sharePage.text, EV, tok6)));
  check('8 parity: … and the differences are really there to set aside', prevPage.text !== sharePage.text);
  var lvPrev8 = await call('GET', '/preview/qa-share-live', { token: 'editor' });
  var lvShare8 = await call('GET', '/s/' + liveTok['qa-share-live']);
  check('8 parity of a live event\'s shared link with its /preview/ (only the ribbon, shared and live differ)',
    normalise(lvPrev8.text, 'qa-share-live', liveTok['qa-share-live']) === normalise(lvShare8.text, 'qa-share-live', liveTok['qa-share-live']),
    firstDiff(normalise(lvPrev8.text, 'qa-share-live', liveTok['qa-share-live']), normalise(lvShare8.text, 'qa-share-live', liveTok['qa-share-live'])));

  /* ============ 9. a site with an internal page ============ */
  var mpMade = await call('POST', '/api/event/share-preview', { token: 'multi', body: { eventId: MP } });
  var tokMP = tokenOf(mpMade.body && mpMade.body.url);
  var mpHome = await call('GET', '/s/' + tokMP);
  var mpAgenda = await call('GET', '/s/' + tokMP + '/agenda');
  var mpAgendaSlash = await call('GET', '/s/' + tokMP + '/agenda/');
  var mpNope = await call('GET', '/s/' + tokMP + '/nope');
  check('9 /s/<t> is the home page', mpHome.status === 200 && !/<html[^>]*data-rv-current-page/.test(mpHome.text) && mpHome.text.indexOf('SAVED-MP') !== -1, mpHome.status);
  check('9 /s/<t>/agenda is the Agenda page', mpAgenda.status === 200 && /<html[^>]*data-rv-current-page="agenda"/.test(mpAgenda.text) && /<title>Agenda \| /.test(mpAgenda.text), mpAgenda.status + ' ' + mpAgenda.text.slice(0, 200));
  check('9 … with a trailing slash too', mpAgendaSlash.status === 200 && /data-rv-current-page="agenda"/.test(mpAgendaSlash.text));
  check('9 its page links point to /s/<t> and /s/<t>/agenda', mpAgenda.text.indexOf('data-rv-page-link="agenda" href="/s/' + tokMP + '/agenda"') !== -1 &&
    mpAgenda.text.indexOf('data-rv-page-link="home" href="/s/' + tokMP + '"') !== -1 && mpAgenda.text.indexOf('href="/preview/') === -1, (mpAgenda.text.match(/data-rv-page-link="[^"]*" href="[^"]*"/g) || []).join(' '));
  check('9 an unknown page -> the not-a-page 404, no-store', mpNope.status === 404 && /not part of the site/.test(mpNope.text) && mpNope.headers['cache-control'] === 'no-store' &&
    mpNope.headers['referrer-policy'] === 'strict-origin', mpNope.status);
  var mpPrev = await call('GET', '/preview/' + MP + '/agenda', { token: 'editor' });
  check('9 parity of an internal page with /preview/<id>/agenda', normalise(mpPrev.text, MP, tokMP) === normalise(mpAgenda.text, MP, tokMP), firstDiff(normalise(mpPrev.text, MP, tokMP), normalise(mpAgenda.text, MP, tokMP)));
  var pages = RP.cleanPages(JSON.parse(PAGES_JSON));
  check('9 rv-pages.js: pageFromPath(/s/<t>/agenda) is agenda', RP.pageFromPath('/s/' + tokMP + '/agenda', pages) === 'agenda');
  check('9 rv-pages.js: pageFromPath(/s/<t>) is home', RP.pageFromPath('/s/' + tokMP, pages) === 'home' && RP.pageFromPath('/s/' + tokMP + '/', pages) === 'home');
  check('9 rv-pages.js: baseOf(/s/<t>/agenda) and baseOf(/s/<t>/) are /s/<t>', RP.baseOf('/s/' + tokMP + '/agenda', pages) === '/s/' + tokMP && RP.baseOf('/s/' + tokMP + '/', pages) === '/s/' + tokMP,
    RP.baseOf('/s/' + tokMP + '/agenda', pages) + ' ' + RP.baseOf('/s/' + tokMP + '/', pages));
  check('9 rv-pages.js: hrefFor(home) from /s/<t>/agenda?draft=1 is /s/<t>, no query carried', RP.hrefFor('home', { pathname: '/s/' + tokMP + '/agenda', search: '?draft=1' }, pages) === '/s/' + tokMP);
  check('9 rv-pages.js: hrefFor(agenda) from /s/<t> is /s/<t>/agenda', RP.hrefFor('agenda', { pathname: '/s/' + tokMP, search: '' }, pages) === '/s/' + tokMP + '/agenda');
  check('9 a token can never be read as a page slug', !RP.SLUG_RE.test(tokMP) || tokMP.length > 40);

  /* ============ 10. every dead link: the same 404, naming nothing ============ */
  var dead = {};
  async function makeLink(eventId, who) {
    var r = await call('POST', '/api/event/share-preview', { token: who || 'deadmaker', body: { eventId: eventId } });
    return { token: tokenOf(r.body && r.body.url), id: r.body && r.body.link && r.body.link.id, status: r.status };
  }
  await makeEvent('qa-share-exp', { name: 'Expiring Event' });
  var lExp = await makeLink('qa-share-exp');
  FB.docs['sharePreviews/' + lExp.id].expiresAt = iso(-1000);
  dead.expired = await call('GET', '/s/' + lExp.token);
  dead.stopped = await call('GET', '/s/' + tok1);
  dead.unknown = await call('GET', '/s/' + remember(T.newToken()));
  dead.malformed = await call('GET', '/s/abc');
  dead.malformed2 = await call('GET', '/s/' + tok6 + '/Agenda');
  dead.malformed3 = await call('GET', '/s/' + tok6 + '/a/b');
  dead.bare = await call('GET', '/s/');
  await makeEvent('qa-share-del2', { name: 'Deleted Later' });
  var lDel = await makeLink('qa-share-del2');
  FB.docs['events/qa-share-del2'].deletedAt = iso(-1000);          // deleted behind the routes' back: the hook did not run
  dead.deleted = await call('GET', '/s/' + lDel.token);
  await wait(10);
  check('10 a link of a deleted event is stopped as it is viewed (event-deleted), so a restore cannot revive it',
    !!FB.docs['sharePreviews/' + lDel.id].revokedAt && FB.docs['sharePreviews/' + lDel.id].revokeReason === 'event-deleted', FB.docs['sharePreviews/' + lDel.id]);
  await makeEvent('qa-share-gone', { name: 'Vanished Event' });
  var lGone = await makeLink('qa-share-gone');
  delete FB.docs['events/qa-share-gone'];
  dead.missing = await call('GET', '/s/' + lGone.token);
  await makeEvent('qa-share-recreated', { name: 'Recreated Event' });
  var lRe = await makeLink('qa-share-recreated');
  FB.docs['events/qa-share-recreated'].createdAt = '2026-11-01T00:00:00.000Z';
  dead.recreated = await call('GET', '/s/' + lRe.token);
  await makeEvent('qa-share-nopage', { name: 'Pageless Event' });
  var lNp = await makeLink('qa-share-nopage');
  delete FB.files['events/qa-share-nopage/site/page.html'];
  dead.nopage = await call('GET', '/s/' + lNp.token);
  var deadKeys = Object.keys(dead), gone0 = dead.expired.text;
  check('10 the gone page is the fixed sentence', gone0.indexOf('This preview link has expired or was switched off') !== -1 && gone0.indexOf('Ask the person who sent it for a new link.') !== -1, gone0.slice(0, 300));
  deadKeys.forEach(function (k) {
    var r = dead[k];
    check('10 dead link (' + k + '): 404, no-store, noindex, strict-origin', r.status === 404 && r.headers['cache-control'] === 'no-store' && r.headers['x-robots-tag'] === 'noindex, nofollow, noarchive' &&
      r.headers['referrer-policy'] === 'strict-origin', r.status + ' ' + JSON.stringify(r.headers));
    check('10 dead link (' + k + '): byte-identical to every other', r.text === gone0);
  });
  check('10 the gone page names no event (names or ids)', ['Shared Summit QA', EV, 'Expiring Event', 'qa-share-exp', 'Deleted Later', 'qa-share-del2', 'Vanished Event', 'qa-share-gone',
    'Recreated Event', 'qa-share-recreated', 'Pageless Event', 'qa-share-nopage', 'qa-share'].every(function (s) { return gone0.indexOf(s) === -1; }));

  /* ============ 11. deleting, restoring, discarding the event ============ */
  await makeEvent('qa-share-delx', { name: 'Delete Me' });
  var dx1 = await makeLink('qa-share-delx'), dx2 = await makeLink('qa-share-delx', 'deadmaker2');
  var dxStopped = seedLink('qa-share-delx', { revokedAt: iso(-1000), revokedBy: 'x@timesinternet.in', revokeReason: 'stopped' });
  var delRes = await call('DELETE', '/api/event?eventId=qa-share-delx', { token: 'deleter' });
  check('11 DELETE /api/event: 200', delRes.status === 200, delRes.text);
  check('11 … every working link is stopped with event-deleted', [dx1, dx2].every(function (l) { var d = FB.docs['sharePreviews/' + l.id]; return d.revokeReason === 'event-deleted' && !!d.revokedAt && d.revokedBy === 'deleter@timesinternet.in'; }),
    [FB.docs['sharePreviews/' + dx1.id], FB.docs['sharePreviews/' + dx2.id]]);
  check('11 … a link already stopped keeps its own reason', FB.docs['sharePreviews/' + dxStopped.id].revokeReason === 'stopped');
  var dxLines = linesOf('qa-share-delx', 'preview-link-stopped');
  check('11 … one History line, after the "deleted" one', dxLines.length === 1 && dxLines[0].detail === '2 shared preview links switched off because the event was deleted' &&
    dxLines[0].by === 'deleter@timesinternet.in' && linesOf('qa-share-delx', 'deleted').length === 1, dxLines);
  var restore = await call('POST', '/api/event/restore', { token: 'deleter', body: { eventId: 'qa-share-delx' } });
  var afterRestore = await call('GET', '/s/' + dx1.token);
  check('11 POST /api/event/restore: the event is back, the link stays dead', restore.status === 200 && !FB.docs['events/qa-share-delx'].deletedAt && afterRestore.status === 404 && afterRestore.text === gone0,
    restore.status + ' ' + afterRestore.status);
  var listAfterRestore = await call('GET', '/api/event/share-preview?eventId=qa-share-delx', { token: 'lister' });
  check('11 … and it is not listed as working', listAfterRestore.status === 200 && listAfterRestore.body.links.length === 0, listAfterRestore.text);
  var delAgain = await call('DELETE', '/api/event?eventId=qa-share-delx', { token: 'deleter' });
  check('11 deleting again with no working links writes no second links line', delAgain.status === 200 && linesOf('qa-share-delx', 'preview-link-stopped').length === 1);

  /* a discard: the wizard's own fresh draft, made by this person */
  await makeEvent('qa-share-disc', { name: 'Discard Me', version: 1, createdAt: iso(-60000), extra: { createdBy: 'discarder@timesinternet.in' } });
  var dc = await makeLink('qa-share-disc', 'discarder');
  var discard = await call('DELETE', '/api/event?eventId=qa-share-disc&discard=1', { token: 'discarder' });
  check('11 discard: 200, the event is gone', discard.status === 200 && discard.body.discarded === true && !FB.docs['events/qa-share-disc'], discard.text);
  check('11 discard: its link documents are deleted', linkDocs('qa-share-disc').length === 0 && !FB.docs['sharePreviews/' + dc.id]);
  await makeEvent('qa-share-disc', { name: 'A New Event Here', createdAt: iso(-1000) });
  var reused = await call('GET', '/s/' + dc.token);
  check('11 a new event at the same address is never shown through the old link', reused.status === 404 && reused.text === gone0);

  /* a failure inside revokeAllForEvent never fails the delete; the view then stops the link itself */
  await makeEvent('qa-share-delf', { name: 'Fail Me' });
  var df = await makeLink('qa-share-delf');
  var realCollection = FB.db.collection;
  FB.db.collection = function (n) { if (n === 'sharePreviews') throw new Error('firestore is down'); return realCollection(n); };
  var delF = await call('DELETE', '/api/event?eventId=qa-share-delf', { token: 'deleter' });
  FB.db.collection = realCollection;
  check('11 a forced failure inside revokeAllForEvent: the delete still answers 200', delF.status === 200 && !!FB.docs['events/qa-share-delf'].deletedAt, delF.text);
  check('11 … and it was logged', LOGS.some(function (l) { return l.indexOf('share-preview: the shared links of qa-share-delf could not be stopped') === 0; }));
  var dfView = await call('GET', '/s/' + df.token);
  await wait(10);
  check('11 … the link is still dead, and stopped as it is viewed', dfView.status === 404 && dfView.text === gone0 && FB.docs['sharePreviews/' + df.id].revokeReason === 'event-deleted');
  /* the hook itself survives a module that throws or rejects */
  var realRevoke = SP.revokeAllForEvent;
  await makeEvent('qa-share-delt', { name: 'Throw' });
  SP.revokeAllForEvent = function () { throw new Error('revoke threw'); };
  var delT = await call('DELETE', '/api/event?eventId=qa-share-delt', { token: 'deleter' });
  await makeEvent('qa-share-delr', { name: 'Reject' });
  SP.revokeAllForEvent = function () { return Promise.reject(new Error('revoke rejected')); };
  var delR = await call('DELETE', '/api/event?eventId=qa-share-delr', { token: 'deleter' });
  SP.revokeAllForEvent = realRevoke;
  check('11 the delete hook survives revokeAllForEvent throwing or rejecting (200 both)', delT.status === 200 && delR.status === 200 && !!FB.docs['events/qa-share-delt'].deletedAt, delT.status + ' ' + delR.status);
  check('11 revokeAllForEvent never rejects, whatever it is given', await SP.revokeAllForEvent(null, 'x', 'y', 'event-deleted') === 0 && await SP.revokeAllForEvent(FB, '../x', 'y', 'event-deleted') === 0 &&
    await SP.revokeAllForEvent({ db: { collection: function () { throw new Error('x'); } } }, 'qa-x', 'y', 'event-deleted') === -1);

  /* ============ 12. methods ============ */
  var post = await call('POST', '/s/' + tok6, { body: { x: 1 } });
  var put = await call('PUT', '/s/' + tok6);
  var head = await call('HEAD', '/s/' + tok6);
  check('12 POST /s/<t> -> 405, no-store, Allow: GET, HEAD', post.status === 405 && post.headers['cache-control'] === 'no-store' && post.headers.allow === 'GET, HEAD' && put.status === 405, post.status + ' ' + JSON.stringify(post.headers));
  check('12 HEAD /s/<t> -> 200 with no body', head.status === 200 && head.text === '' && +head.headers['content-length'] > 0 && head.headers['cache-control'] === 'no-store', head.status);

  /* ============ 13. views per address ============ */
  var junk = remember(T.newToken()), views = [];
  for (i = 0; i < 121; i++) views.push(await call('GET', '/s/' + junk, { ip: '203.0.113.9' }));
  check('13 120 views a minute from one address are answered', views.slice(0, 120).every(function (r) { return r.status === 404; }), views.slice(0, 120).map(function (r) { return r.status; }).filter(function (s) { return s !== 404; }).join());
  check('13 the 121st -> 429, no-store, Retry-After 60', views[120].status === 429 && views[120].headers['cache-control'] === 'no-store' && views[120].headers['retry-after'] === '60', views[120].status);
  var otherIp = await call('GET', '/s/' + tok6, { ip: '203.0.113.10' });
  check('13 another address is not held back', otherIp.status === 200);

  /* ============ 14. the sign-in gate ============ */
  check('14 /s/<t> and /s/<t>/agenda are public', access.isPublic({ method: 'GET', headers: {} }, '/s/' + tok6) && access.isPublic({ method: 'GET', headers: {} }, '/s/' + tok6 + '/agenda'));
  check('14 /preview/<id> is still not public', !access.isPublic({ method: 'GET', headers: {} }, '/preview/' + EV) && !access.isPublic({ method: 'GET', headers: {} }, '/preview/' + EV + '/agenda'));
  check('14 /s/../preview/x and /s/%2e%2e/preview/x are not public', !access.isPublic({}, '/s/../preview/x') && !access.isPublic({}, '/s/%2e%2e/preview/x') && !access.isPublic({}, '/s/%2E%2E/preview/x'));
  check('14 /s (no slash) and /sx/… are not made public by this', !access.isPublic({}, '/s') && !access.isPublic({}, '/sx/' + tok6));
  var gateNext = null;
  access.gate({ url: '/s/' + tok6 + '?x=1', headers: {}, method: 'GET' }, { writeHead: function () {}, end: function () {} }, function () { gateNext = true; });
  check('14 the gate lets a signed-out /s/ request through', gateNext === true);

  /* ============ 15. wiring ============ */
  var serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  var serveSrc = fs.readFileSync(path.join(ROOT, 'tools', 'serve.js'), 'utf8');
  function routesS(src) {
    var line = src.split('\n').filter(function (l) { return /return handleApi\(req, res\)/.test(l) && /\(api\|e\|preview\|t/.test(l); })[0] || '';
    var m = /if \((.*)\) return handleApi\(req, res\);/.exec(line);
    if (!m) return false;
    var test = new Function('url', 'return ' + m[1] + ';');
    return test('/s/' + tok6) && test('/s/' + tok6 + '/agenda') && test('/e/x') && test('/preview/x') && test('/t/o/x.gif') && test('/api/x') && !test('/sx/y') && !test('/index.html');
  }
  check('15 server.js hands /s/ to the API (and still /api, /e, /preview, /t)', routesS(serverSrc));
  check('15 tools/serve.js hands /s/ to the API', routesS(serveSrc));
  check('15 server.js logs a failed request\'s address through redactUrl', /console\.error\('request failed: ' \+ req\.method \+ ' ' \+ redactUrl\(req\.url\)/.test(serverSrc) && !/'request failed: ' \+ req\.method \+ ' ' \+ req\.url/.test(serverSrc));
  var robots = siteSeo.robotsTxt('https://cms.example');
  check('15 robots.txt: Disallow: /s/, and still Disallow: /preview/ and /', /^Disallow: \/s\/$/m.test(robots) && /^Disallow: \/preview\/$/m.test(robots) && /^Disallow: \/$/m.test(robots) && !/^Allow: \/s/m.test(robots), robots);
  var robotsRoute = await call('GET', '/robots.txt');
  check('15 GET /robots.txt carries it', robotsRoute.status === 200 && robotsRoute.text.indexOf('Disallow: /s/') !== -1);
  check('15 History knows both actions, both under Publishing', activity.ACTIONS.indexOf('preview-link-shared') !== -1 && activity.ACTIONS.indexOf('preview-link-stopped') !== -1 &&
    activity.AREA_OF['preview-link-shared'] === 'publishing' && activity.AREA_OF['preview-link-stopped'] === 'publishing');
  var apiSrc = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
  check('15 api.js routes the three admin routes', /'POST \/api\/event\/share-preview': shareRoute\('handleCreate'\)/.test(apiSrc) && /'GET \/api\/event\/share-preview': shareRoute\('handleList'\)/.test(apiSrc) &&
    /'POST \/api\/event\/share-preview\/stop': shareRoute\('handleStop'\)/.test(apiSrc));

  /* ============ 16. the forms runtime's shared mode ============ */
  formsRuntimeChecks();

  /* ============ 17. tripwire: no visit counted from a shared page ============ */
  check('17 a shared page loads no visit counter (rv-live.js) and names no /api/track', pub.text.indexOf('rv-live.js') === -1 && pub.text.indexOf('/api/track') === -1 &&
    mpAgenda.text.indexOf('rv-live.js') === -1 && mpAgenda.text.indexOf('/api/track') === -1);
  check('17 none of the scripts a shared page loads posts to /api/track', (pub.text.match(/<script[^>]*src="([^"]+)"/g) || []).every(function (tag) {
    var src = /src="([^"?]+)/.exec(tag)[1];
    var file = path.join(ROOT, src.replace(/^\//, ''));
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8').indexOf('/api/track') === -1;
  }), (pub.text.match(/<script[^>]*src="([^"]+)"/g) || []).join(' '));

  /* ============ 18. logs: failure paths, and no token anywhere ============ */
  /* a Storage failure while reading the saved page */
  await makeEvent('qa-share-sfail', { name: 'Storage Fails' });
  var sf = await makeLink('qa-share-sfail');
  var realFile = FB.bucket.file;
  FB.bucket.file = function (p) {
    var f = realFile(p);
    if (p === 'events/qa-share-sfail/site/page.html') f.download = function () { return Promise.reject(new Error('storage exploded while serving /s/' + sf.token + '/agenda')); };
    return f;
  };
  var sfRes = await call('GET', '/s/' + sf.token);
  FB.bucket.file = realFile;
  check('18 a Storage failure on /s/: 502, no-store, a plain page', sfRes.status === 502 && sfRes.headers['cache-control'] === 'no-store' && /temporarily unavailable/.test(sfRes.text), sfRes.status);
  check('18 … logged with …last4 and the event, not the token', LOGS.some(function (l) { return l.indexOf('share-preview: link …' + sf.token.slice(-4) + ' of qa-share-sfail failed') === 0; }));
  /* a throw inside routing, caught by handleApi */
  var realPage = SP.handleSharedPage;
  SP.handleSharedPage = function () { throw new Error('routing exploded'); };
  var thrown = await call('GET', '/s/' + tok6 + '/agenda?draft=1');
  SP.handleSharedPage = realPage;
  check('18 a throw inside routing: 500, no-store, strict-origin, an HTML page', thrown.status === 500 && thrown.headers['cache-control'] === 'no-store' && thrown.headers['referrer-policy'] === 'strict-origin' &&
    /^text\/html/.test(thrown.headers['content-type']), thrown.status + ' ' + JSON.stringify(thrown.headers));
  check('18 … logged by handleApi with the address redacted', LOGS.some(function (l) { return l.indexOf('api: unhandled error on GET /s/…' + tok6.slice(-4) + '/agenda?draft=1') === 0; }));
  /* the module cannot be loaded */
  var cached = require.cache[SP_PATH];
  require.cache[SP_PATH] = { id: SP_PATH, filename: SP_PATH, loaded: true, children: [], get exports() { throw new Error('module exploded'); } };
  var noMod = await call('GET', '/s/' + tok6);
  var noModApi = await call('POST', '/api/event/share-preview', { token: 'editor', body: { eventId: EV } });
  require.cache[SP_PATH] = cached;
  check('18 a module that cannot be loaded: /s/ gets a 503 HTML page, no-store, strict-origin', noMod.status === 503 && noMod.headers['cache-control'] === 'no-store' && noMod.headers['referrer-policy'] === 'strict-origin' &&
    /^text\/html/.test(noMod.headers['content-type']) && /temporarily unavailable/.test(noMod.text), noMod.status + ' ' + noMod.text.slice(0, 100));
  check('18 … and an admin route a JSON 503 module-unavailable', noModApi.status === 503 && noModApi.body && noModApi.body.code === 'module-unavailable', noModApi.text);
  check('18 … logged with the address redacted', LOGS.some(function (l) { return l.indexOf('api: could not load lib/share-preview.js for GET /s/…' + tok6.slice(-4)) === 0; }));
  var backAgain = await call('GET', '/s/' + tok6);
  check('18 once the module loads again, the link works', backAgain.status === 200);
  /* the 503 when Firebase is not configured */
  var realFb = FB;
  FB = { error: 'Firebase is not configured here.' };
  var noFb = await call('GET', '/s/' + tok6);
  FB = realFb;
  check('18 no Firebase: 503, no-store', noFb.status === 503 && noFb.headers['cache-control'] === 'no-store', noFb.status);

  check('18 the redacted form …last4 does appear in the log', LOGS.some(function (l) { return l.indexOf('…' + tok6.slice(-4)) !== -1; }));
  var leaked = TOKENS.filter(function (t) { return LOGS.some(function (l) { return l.indexOf(t) !== -1; }); });
  check('18 no token appears in any console line of the whole run (' + TOKENS.length + ' tokens, ' + LOGS.length + ' lines)', leaked.length === 0 && TOKENS.length > 30, leaked.length + ' leaked');
  check('18 no token is stored in Firestore or Storage at the end of the run', TOKENS.every(function (t) {
    return JSON.stringify(FB.docs).indexOf(t) === -1 && Object.keys(FB.files).every(function (k) { return String(FB.files[k]).indexOf(t) === -1; });
  }));

  finish();
})().catch(function (err) { realError('share-preview test crashed: ' + (err && err.stack || err)); failed++; finish(); });

function firstDiff(a, b) {
  for (var i = 0; i < Math.max(a.length, b.length); i++) if (a.charAt(i) !== b.charAt(i)) return 'at ' + i + ': «' + a.slice(Math.max(0, i - 80), i + 120) + '» vs «' + b.slice(Math.max(0, i - 80), i + 120) + '»';
  return 'same';
}

/* ---------- 16. templates/_shared/rv-forms.js in a small fake DOM ---------- */
function formsRuntimeChecks() {
  var SRC = fs.readFileSync(path.join(ROOT, 'templates', '_shared', 'rv-forms.js'), 'utf8');
  function fakeDocument() {
    var doc = { nodeType: 9, activeElement: null };
    function El(tag) {
      this.tagName = String(tag).toUpperCase(); this.nodeName = this.tagName; this.nodeType = 1; this.ownerDocument = doc;
      this.childNodes = []; this._attrs = {}; this._listeners = {}; this.parentNode = null; this.hidden = false; this._text = '';
      var self = this;
      var props = {};
      this.style = { setProperty: function (k, v) { props[k] = v; }, getPropertyValue: function (k) { return props[k] || ''; } };
      this.classList = {
        add: function (c) { var l = self.className.split(/\s+/).filter(Boolean); if (l.indexOf(c) === -1) l.push(c); self.className = l.join(' '); },
        remove: function (c) { self.className = self.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(' '); },
        contains: function (c) { return self.className.split(/\s+/).indexOf(c) !== -1; },
        toggle: function (c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; }
      };
    }
    El.prototype = {
      get className() { return this._attrs['class'] || ''; }, set className(v) { this._attrs['class'] = String(v); },
      get id() { return this._attrs.id || ''; }, set id(v) { this._attrs.id = String(v); },
      get children() { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); },
      get firstChild() { return this.childNodes[0] || null; },
      get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; },
      get isConnected() { return false; },
      get textContent() { return this.childNodes.length ? this.childNodes.map(function (n) { return n.textContent; }).join('') : this._text; },
      set textContent(v) { this.childNodes.forEach(function (n) { n.parentNode = null; }); this.childNodes = []; this._text = String(v == null ? '' : v); },
      appendChild: function (n) { if (n.parentNode) n.parentNode.removeChild(n); this.childNodes.push(n); n.parentNode = this; return n; },
      insertBefore: function (n, ref) { if (n.parentNode) n.parentNode.removeChild(n); var i = this.childNodes.indexOf(ref); if (i === -1) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); n.parentNode = this; return n; },
      removeChild: function (n) { var i = this.childNodes.indexOf(n); if (i !== -1) this.childNodes.splice(i, 1); n.parentNode = null; return n; },
      setAttribute: function (k, v) { this._attrs[k] = String(v); }, getAttribute: function (k) { return k in this._attrs ? this._attrs[k] : null; },
      hasAttribute: function (k) { return k in this._attrs; }, removeAttribute: function (k) { delete this._attrs[k]; },
      addEventListener: function (t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
      removeEventListener: function (t, fn) { this._listeners[t] = (this._listeners[t] || []).filter(function (f) { return f !== fn; }); },
      dispatchEvent: function (e) { var self = this; (this._listeners[e.type] || []).forEach(function (f) { f.call(self, e); }); return true; },
      focus: function () { doc.activeElement = this; }, blur: function () {}, scrollIntoView: function () {},
      getBoundingClientRect: function () { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }, getClientRects: function () { return []; },
      contains: function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; },
      matches: function (sel) { return matches(this, sel); },
      closest: function (sel) { for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; },
      querySelector: function (sel) { return find(this, sel)[0] || null; },
      querySelectorAll: function (sel) { return find(this, sel); }
    };
    function matches(n, sel) {
      return String(sel).split(',').some(function (one) {
        var m = /^\s*([a-z0-9]*)((?:\.[A-Za-z0-9_-]+)*)((?:\[[^\]]+\])*)\s*$/i.exec(one);
        if (!m) return false;
        if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
        var classes = m[2] ? m[2].split('.').filter(Boolean) : [];
        if (!classes.every(function (c) { return n.classList.contains(c); })) return false;
        var attrs = m[3] ? m[3].match(/\[[^\]]+\]/g) : [];
        return attrs.every(function (a) {
          var am = /^\[([^=\]]+)(?:="?([^"\]]*)"?)?\]$/.exec(a);
          if (!am) return false;
          var v = am[1] === 'name' ? n.name : n.getAttribute(am[1]);
          return am[2] === undefined ? n.hasAttribute(am[1]) || v != null : String(v) === am[2];
        });
      });
    }
    function find(root, sel) {
      var out = [];
      (function walk(n) { n.childNodes.forEach(function (c) { if (c.nodeType === 1) { if (matches(c, sel)) out.push(c); walk(c); } }); })(root);
      return out;
    }
    doc.createElement = function (t) { return new El(t); };
    doc.createElementNS = function (ns, t) { return new El(t); };
    doc.createTextNode = function (t) { return { nodeType: 3, textContent: String(t), parentNode: null }; };
    doc.createEvent = function () { return { initEvent: function (type) { this.type = type; }, preventDefault: function () {} }; };
    doc.documentElement = new El('html');
    doc.head = new El('head'); doc.body = new El('body');
    doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
    doc.querySelector = function (sel) { return doc.documentElement.querySelector(sel); };
    doc.querySelectorAll = function (sel) { return doc.documentElement.querySelectorAll(sel); };
    doc.getElementById = function (id) { return find(doc.documentElement, '[id="' + id + '"]')[0] || null; };
    doc.getElementsByTagName = function (t) { return find(doc.documentElement, t); };
    return doc;
  }
  function run(mode, extra) {
    var doc = fakeDocument(), fetches = [];
    var win = {
      RV_FORMS_NO_AUTO: true, document: doc, location: { search: '', hash: '', pathname: '/s/x' }, navigator: { language: 'en-IN', languages: ['en-IN'] },
      innerHeight: 800, getComputedStyle: function () { return { getPropertyValue: function () { return ''; }, textAlign: '', overflowY: 'visible', position: 'static' }; },
      matchMedia: function () { return { matches: false }; }, setTimeout: setTimeout, clearTimeout: clearTimeout,
      fetch: function (url, init) { fetches.push({ url: url, init: init }); return new Promise(function () {}); }
    };
    doc.defaultView = win;
    var ctx = vm.createContext({ window: win, console: console, document: doc, setTimeout: setTimeout, clearTimeout: clearTimeout, Intl: Intl });
    vm.runInContext(SRC, ctx, { filename: 'rv-forms.js' });
    var RF = win.RevampForms;
    var host = doc.createElement('div');
    doc.body.appendChild(host);
    var form = { id: 'register', name: 'Register now', fields: [{ id: 'name', type: 'text', label: 'Full name', required: true }, { id: 'company', type: 'text', label: 'Company', required: false }] };
    var ro = { mode: mode, eventId: 'qa-share-main', values: { name: 'Asha Rao', company: 'ET', consent: true } };
    for (var k in (extra || {})) ro[k] = extra[k];
    var f = RF.render(form, host, ro);
    var formEl = host.querySelector('form');
    var submitted = false;
    var times = (extra && extra.submits) || 1;
    for (var s = 0; formEl && s < times; s++) formEl.dispatchEvent({ type: 'submit', preventDefault: function () { submitted = true; } });
    var notice = formEl ? formEl.querySelectorAll('p.rv-form-note').filter(function (p) { return p.getAttribute('role') === 'status'; })[0] : null;
    var errs = formEl ? formEl.querySelectorAll('p.rv-form-err').map(function (p) { return p.textContent; }).filter(Boolean) : ['no form'];
    return { RF: RF, f: f, fetches: fetches, notice: notice, submitted: submitted, errors: errs };
  }
  var shared = run('shared');
  var RF = shared.RF;
  check('16 RevampForms.modeFor({mode:"preview",shared:true}) is "shared"', RF.modeFor({ mode: 'preview', shared: true }) === 'shared');
  check('16 modeFor({mode:"preview"}) is "preview"; {mode:"live"} is "live"', RF.modeFor({ mode: 'preview' }) === 'preview' && RF.modeFor({ mode: 'live' }) === 'live');
  check('16 modeFor: shared only on a preview; the editor wins; nothing without config or event', RF.modeFor({ mode: 'live', shared: true }) === 'live' && RF.modeFor({ mode: 'preview', shared: 'yes' }) === 'preview' &&
    RF.modeFor({ mode: 'preview', shared: true }, 'ai') === 'ai-view' && RF.modeFor({ mode: 'preview', shared: true }, null, true) === null &&
    RF.modeFor(null, null, false, false) === null && RF.modeFor(null, null, false, true) === 'live');
  check('16 a shared-mode submit with valid answers: no errors, the submit was handled', shared.submitted && shared.errors.length === 0, shared.errors);
  check('16 … makes no fetch call at all', shared.fetches.length === 0, shared.fetches.map(function (x) { return x.url; }));
  check('16 … and says nothing was sent, in words that fit any form (MSG.shared: no "Registration")', !!shared.notice && shared.notice.hidden === false &&
    shared.notice.textContent === 'This is a preview, so nothing was sent. This form will work once the site is live.' && !/registr/i.test(shared.notice.textContent), shared.notice && shared.notice.textContent);
  check('16 … with no link while the site is not live', !!shared.notice && shared.notice.querySelectorAll('a').length === 0);

  /* the event is already live: the note points the guest to the live site instead */
  var lv = run('shared', { livePath: '/e/qa-share-main', submits: 2 });
  var lvLinks = lv.notice ? lv.notice.querySelectorAll('a') : [];
  check('16 live: a shared-mode submit still sends nothing', lv.submitted && lv.errors.length === 0 && lv.fetches.length === 0, lv.fetches.map(function (x) { return x.url; }));
  check('16 live: the note says to use the live site, not that the site is not open', !!lv.notice && lv.notice.hidden === false &&
    lv.notice.textContent.indexOf('This is a preview, so nothing was sent. To send your details, use the live site.') === 0 && !/not live|registr/i.test(lv.notice.textContent), lv.notice && lv.notice.textContent);
  check('16 live: one "Open the live site" link to /e/<id>, new tab, noreferrer (also after a second submit)', lvLinks.length === 1 && lvLinks[0].textContent === 'Open the live site' &&
    lvLinks[0].getAttribute('href') === '/e/qa-share-main' && lvLinks[0].getAttribute('target') === '_blank' && /\bnoreferrer\b/.test(lvLinks[0].getAttribute('rel') || '') &&
    lvLinks[0].className === 'rv-form-link', lvLinks.map(function (a) { return a.getAttribute('href'); }));
  var badPaths = ['https://evil.example/e/x', '//evil.example/e/x', 'javascript:alert(1)', '/e/../api/x', '/preview/qa-share-main', '/e/Bad_Id', '/s/abc'];
  var badOut = badPaths.map(function (bp) { var r = run('shared', { livePath: bp }); return r.notice ? r.notice.querySelectorAll('a').length + '|' + r.notice.textContent : 'none'; });
  check('16 live: any livePath but this host\'s /e/<id> is ignored (no link, the not-live note)', badOut.every(function (x) { return x === '0|This is a preview, so nothing was sent. This form will work once the site is live.'; }), badOut);
  var pvLive = run('preview', { livePath: '/e/qa-share-main' });
  check('16 live: livePath means nothing outside shared mode (a /preview/ submit is still sent)', pvLive.fetches.length === 1 && pvLive.fetches[0].url === '/api/register', pvLive.fetches.length);
  check('16 sharedLivePath: only a shared, live preview config with an /e/<id> path', RF.sharedLivePath({ mode: 'preview', shared: true, live: true, livePath: '/e/qa-x' }) === '/e/qa-x' &&
    RF.sharedLivePath({ mode: 'preview', shared: true, livePath: '/e/qa-x' }) === '' && RF.sharedLivePath({ mode: 'preview', live: true, livePath: '/e/qa-x' }) === '' &&
    RF.sharedLivePath({ mode: 'live', shared: true, live: true, livePath: '/e/qa-x' }) === '' && RF.sharedLivePath({ mode: 'preview', shared: true, live: true, livePath: 'https://x.example/e/qa-x' }) === '' &&
    RF.sharedLivePath({ mode: 'preview', shared: true, live: 'yes', livePath: '/e/qa-x' }) === '' && RF.sharedLivePath(null) === '');

  /* the page runtime itself: #rv-site-config's live path reaches a form drawn on the page */
  function pageRun(cfg) {
    var doc = fakeDocument(), fetches = [];
    doc.readyState = 'complete';
    doc.addEventListener = function () {}; doc.removeEventListener = function () {};
    var loc = { search: '', hash: '', pathname: '/s/x' };
    var win = {
      document: doc, location: loc, navigator: { language: 'en-IN', languages: ['en-IN'] }, history: { state: null, replaceState: function () {} },
      innerHeight: 800, getComputedStyle: function () { return { getPropertyValue: function () { return ''; }, textAlign: '', overflowY: 'visible', position: 'static' }; },
      matchMedia: function () { return { matches: false }; }, setTimeout: setTimeout, clearTimeout: clearTimeout, addEventListener: function () {}, removeEventListener: function () {},
      fetch: function (url, init) { fetches.push({ url: url, init: init }); return new Promise(function () {}); }
    };
    doc.defaultView = win;
    var form = { id: 'register', name: 'Register now', rev: 1, open: true, fields: [{ id: 'name', type: 'text', label: 'Full name', required: true }] };
    var cfgEl = doc.createElement('script'); cfgEl.id = 'rv-site-config'; cfgEl.textContent = JSON.stringify(cfg);
    var formsEl = doc.createElement('script'); formsEl.id = 'rv-forms'; formsEl.textContent = JSON.stringify({ forms: [form], defaultFormId: 'register', open: true });
    var embed = doc.createElement('div'); embed.className = 'rv-block-form'; embed.setAttribute('data-rv-form-embed', 'register');
    doc.body.appendChild(embed); doc.body.appendChild(cfgEl); doc.body.appendChild(formsEl);
    var ctx = vm.createContext({ window: win, console: console, document: doc, location: loc, history: win.history, setTimeout: setTimeout, clearTimeout: clearTimeout, Intl: Intl });
    vm.runInContext(SRC, ctx, { filename: 'rv-forms.js' });
    var formEl = embed.querySelector('form');
    if (!formEl) return { error: 'no form drawn', fetches: fetches };
    formEl.querySelectorAll('input').forEach(function (i) { if (i.type === 'checkbox') i.checked = true; else if (i.name !== 'website') i.value = 'Asha Rao'; });
    formEl.dispatchEvent({ type: 'submit', preventDefault: function () {} });
    var note = formEl.querySelectorAll('p.rv-form-note').filter(function (p) { return p.getAttribute('role') === 'status'; })[0];
    var errs = formEl.querySelectorAll('p.rv-form-err').map(function (p) { return p.textContent; }).filter(Boolean);
    return { note: note, errors: errs, fetches: fetches };
  }
  var pLive = pageRun({ eventId: 'qa-share-main', mode: 'preview', shared: true, live: true, livePath: '/e/qa-share-main' });
  var pLiveA = pLive.note ? pLive.note.querySelectorAll('a') : [];
  check('16 page: a shared link of a live site — its drawn form says use the live site, links /e/<id>, sends nothing', !pLive.error && pLive.errors.length === 0 && pLive.fetches.length === 0 &&
    !!pLive.note && pLive.note.hidden === false && pLive.note.textContent.indexOf('To send your details, use the live site.') !== -1 && pLiveA.length === 1 && pLiveA[0].getAttribute('href') === '/e/qa-share-main',
    pLive.error || pLive.errors.concat(pLive.note ? [pLive.note.textContent] : []));
  var pDraft = pageRun({ eventId: 'qa-share-main', mode: 'preview', shared: true });
  check('16 page: a shared link of a site not yet live — the not-live note, no link, sends nothing', !pDraft.error && pDraft.errors.length === 0 && pDraft.fetches.length === 0 && !!pDraft.note &&
    pDraft.note.textContent === 'This is a preview, so nothing was sent. This form will work once the site is live.' && pDraft.note.querySelectorAll('a').length === 0,
    pDraft.error || pDraft.errors.concat(pDraft.note ? [pDraft.note.textContent] : []));
  var prevRun = run('preview');
  check('16 contrast: the same submit in preview mode is sent (POST /api/register, preview:true)', prevRun.fetches.length === 1 && prevRun.fetches[0].url === '/api/register' &&
    JSON.parse(prevRun.fetches[0].init.body).preview === true, prevRun.fetches.map(function (x) { return x.url; }));
  var badRun = (function () {
    var r = run('shared');
    return r;
  })();
  check('16 the shared runtime is not a "live" fallback: MODES knows it', /var MODES = \{[^}]*\bshared: 1/.test(SRC) && badRun.fetches.length === 0);
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* not installed here: the parse check below still runs */ }
  if (esbuild) {
    var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('16 rv-forms.js is still ES5 (esbuild)', es5 === true, es5);
  }
  check('16 rv-forms.js parses', (function () { try { new vm.Script(SRC); return true; } catch (e) { return false; } })());
}

function finish() {
  if (failed) { realError('share-preview: ' + failed + ' of ' + (passed + failed) + ' checks failed'); process.exit(1); }
  process.stdout.write('share-preview: all ' + passed + ' checks passed\n');
  process.exit(0);
}
