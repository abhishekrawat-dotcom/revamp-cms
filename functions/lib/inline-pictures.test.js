/* node functions/lib/inline-pictures.test.js — speaker photos, company logos, sponsor logos and gallery pictures are
   stored as files, never inside their records (launch check CON-052/054/055, 13 Nov 2026): lib/inline-pictures.js;
   the records' routes through the real router (lib/api.js handleApi) against an in-memory Firestore and Storage;
   POST /api/event/upload after its storing moved into storeImageFile (lib/api-events.js); the speaker and sponsor
   pages' own picture (lib/people.js handleOne); the console's RevampCore.storePicture (edit-event-core.js); and the
   migration tool's dry run and --apply (tools/migrate-inline-pictures.js). No network, no real project.
   Exits 1 on any failure. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 600) : '')); }
var realError = console.error;
console.error = function () {};       // the routes' own logging of expected refusals

/* ---------- an in-memory Firestore + Storage, just enough for these routes ---------- */
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function isDelete(v) { return v && typeof v === 'object' && /Delete/i.test((v.constructor && v.constructor.name) || ''); }
function setPath(obj, dotted, value) {
  var keys = dotted.split('.'), o = obj;
  for (var i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  if (isDelete(value)) delete o[keys[keys.length - 1]]; else o[keys[keys.length - 1]] = clone(value);
}
function fakeFb() {
  var docs = {}, files = {}, meta = {}, seq = 0;
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
      delete: function () { delete docs[p]; return Promise.resolve(); }
    };
  }
  function colRef(p, order, lim) {
    var q = {
      path: p,
      doc: function (id) { return docRef(p + '/' + (id || ('auto' + (++seq)))); },
      add: function (data) { var r = docRef(p + '/auto' + (++seq)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function (f, dir) { return colRef(p, [f, dir], lim); }, limit: function (n) { return colRef(p, order, n); },
      where: function () { return q; }, select: function () { return q; },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        if (order) list.sort(function (a, b) { var x = a.data()[order[0]], y = b.data()[order[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (order[1] === 'desc' ? -1 : 1); });
        if (lim) list = list.slice(0, lim);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      }
    };
    return q;
  }
  var db = {
    collection: function (n) { return colRef(n); },
    collectionGroup: function (n) {
      return { get: function () {
        var list = Object.keys(docs).filter(function (k) { var parts = k.split('/'); return parts.length % 2 === 0 && parts[parts.length - 2] === n; }).map(snap);
        return Promise.resolve({ docs: list });
      } };
    },
    runTransaction: function (fn) {
      var tx = {
        get: function (r) { return r.get(); },
        getAll: function () { return Promise.all([].slice.call(arguments).map(function (r) { return r.get(); })); },
        set: function (r, d, o) { write(r.path, 'set', d, o); return tx; },
        update: function (r, d) { write(r.path, 'update', d); return tx; },
        delete: function (r) { delete docs[r.path]; return tx; }
      };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    getAll: function () { return Promise.all([].slice.call(arguments).map(function (r) { return r.get(); })); },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, 'set', d, o); }); }, update: function (r, d) { ops.push(function () { write(r.path, 'update', d); }); },
        delete: function (r) { ops.push(function () { delete docs[r.path]; }); }, commit: function () { ops.forEach(function (f) { f(); }); return Promise.resolve(); } };
    }
  };
  var bucket = {
    name: 'test-bucket',
    file: function (p) {
      return {
        name: p,
        save: function (buf, o) { files[p] = buf; meta[p] = o || {}; return Promise.resolve(); },
        makePublic: function () { return Promise.resolve(); },
        delete: function () { delete files[p]; return Promise.resolve(); },
        exists: function () { return Promise.resolve([!!files[p]]); },
        download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
        getMetadata: function () { return Promise.resolve([{ size: files[p] ? files[p].length : 0 }]); },
        setMetadata: function () { return Promise.resolve(); }
      };
    },
    getFiles: function (o) { var pre = (o && o.prefix) || ''; return Promise.resolve([Object.keys(files).filter(function (k) { return k.indexOf(pre) === 0; }).map(function (k) { return { name: k, metadata: { md5Hash: '' } }; })]); }
  };
  var auth = { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } };
  return { db: db, bucket: bucket, auth: auth, docs: docs, files: files, meta: meta };
}

var FB = fakeFb();
require.cache[require.resolve('./firebase')] = { id: require.resolve('./firebase'), filename: require.resolve('./firebase'), loaded: true, exports: { getFirebase: function () { return FB; } } };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
process.env.PEOPLE_COL_PREFIX = 'qa';

var IP = require('./inline-pictures');
var api = require('./api');
var TOOL = require('../../tools/migrate-inline-pictures.js');

function call(method, url, body, who) {
  return new Promise(function (resolve) {
    var req = { method: method, url: url, headers: { authorization: 'Bearer ' + (who || 'editor'), host: 'localhost' }, socket: {}, rawBody: Buffer.from(body ? JSON.stringify(body) : '') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; },
      write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* not json */ } resolve({ status: res.statusCode, body: j, text: t }); }
    };
    api.handleApi(req, res);
  });
}

/* a 1x1 PNG, a JPEG and a few things that are not pictures */
var PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
var PNG_URL = 'data:image/png;base64,' + PNG;
var JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xD9]).toString('base64');
var JPEG_URL = 'data:image/jpeg;base64,' + JPEG;
var HTML_URL = 'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64');
var SVG_BAD = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
var STORE = 'https://storage.googleapis.com/test-bucket/';
function filesUnder(prefix) { return Object.keys(FB.files).filter(function (k) { return k.indexOf(prefix) === 0 && !/\.rv-[0-9a-f]{8}\./.test(k); }); }
function pathOf(url) { return decodeURIComponent(String(url).slice(STORE.length)); }

(async function () {
  /* ---------- 1. lib/inline-pictures.js on its own ---------- */
  var d = IP.decode(PNG_URL, 'The photo');
  ok(d.buffer && d.contentType === 'image/png', '1 a PNG data: URL decodes to its bytes, typed by its bytes', d.error);
  d = IP.decode('data:image/png;base64,' + JPEG, 'The photo');
  ok(d.contentType === 'image/jpeg', '1 …the type comes from the bytes, never the label it was sent under', d);
  ok(IP.decode(HTML_URL, 'The photo').status === 415 && /The photo is not an image we can use/.test(IP.decode(HTML_URL, 'The photo').error), '1 a page sent as a picture: refused (415), and said so');
  ok(IP.decode(SVG_BAD, 'The logo').status === 415 && /scripts/.test(IP.decode(SVG_BAD, 'The logo').error), '1 an SVG with a script: refused');
  ok(IP.decode('data:image/png,abc', 'The logo').status === 415, '1 a data: URL that is not base64: refused');
  ok(IP.decode('data:image/png;base64,@@@', 'The logo').status === 400, '1 base64 that is broken: refused');
  ok(IP.decode('data:image/png;base64,', 'The logo').status === 400, '1 an empty picture: refused');
  var big = 'data:image/png;base64,' + Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(8 * 1024 * 1024 + 10)]).toString('base64');
  ok(IP.decode(big, 'The photo').status === 413, '1 over 8 MB: refused (413), as an upload is');
  ok(IP.isInline(' data:image/png;base64,x') && !IP.isInline('https://x/y.png') && !IP.isInline(null), '1 isInline: data: text only');
  ok(IP.changedInline({ photoUrl: PNG_URL, logoUrl: PNG_URL, name: 'x' }, { photoUrl: 'a', logoUrl: 'b' }, { photoUrl: PNG_URL }).join() === 'logoUrl',
    '1 changedInline: a picture sent back as it is stored is not new');

  /* ---------- 2. a speaker's photo and company logo ---------- */
  var EV = 'qa-inline-pictures', now = new Date().toISOString();
  FB.docs['events/' + EV] = { name: 'QA inline pictures', createdAt: now, updatedAt: now, status: 'draft' };
  var r = await call('POST', '/api/event/speakers', { eventId: EV, name: 'Naven Singh', comp: 'Acme Bank', photoUrl: JPEG_URL, logoUrl: PNG_URL, status: 'confirmed' });
  var rec = r.body && FB.docs['events/' + EV + '/speakers/' + r.body.id];
  ok(r.status === 200 && rec, '2 a speaker sent with an inline photo and logo is saved', r.body);
  ok(rec && rec.photoUrl.indexOf(STORE + 'events/' + EV + '/speakers/') === 0 && rec.logoUrl.indexOf(STORE + 'events/' + EV + '/speakers/') === 0,
    '2 …the record holds the files\' addresses, in the event\'s speakers folder (as an upload is stored)', rec);
  ok(rec && !/data:/.test(JSON.stringify(rec)), '2 …and no image text anywhere in it');
  var photoPath = rec && pathOf(rec.photoUrl), logoPath = rec && pathOf(rec.logoUrl);
  ok(photoPath && FB.files[photoPath] && FB.files[photoPath].equals(Buffer.from(JPEG, 'base64')), '2 the photo\'s file is the picture that was sent, byte for byte');
  ok(/\/[a-z0-9]+-[0-9a-f]{12}-naven-singh-photo\.jpg$/.test(photoPath || '') && /\/[a-z0-9]+-[0-9a-f]{12}-acme-bank-logo\.png$/.test(logoPath || ''),
    '2 the files are named as uploads are (unique, then who it is): the photo after the speaker, the logo after the company', [photoPath, logoPath]);
  ok(FB.meta[photoPath] && FB.meta[photoPath].metadata.cacheControl === 'public, max-age=31536000, immutable' && FB.meta[photoPath].metadata.contentType === 'image/jpeg',
    '2 …stored public, kept for a year, under the type its bytes are', FB.meta[photoPath]);

  var before = Object.keys(FB.files).length, count = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + EV + '/speakers/') === 0; }).length;
  r = await call('POST', '/api/event/speakers', { eventId: EV, name: 'Asha Rao', photoUrl: HTML_URL });
  ok(r.status === 415 && r.body.code === 'picture-not-usable' && r.body.field === 'photoUrl' && /The photo is not an image we can use/.test(r.body.error),
    '2 a "photo" that is not a picture: refused, saying which and why', r.body);
  r = await call('POST', '/api/event/speakers', { eventId: EV, photoUrl: PNG_URL });
  ok(r.status === 400 && /needs a "name"/.test(r.body.error), '2 a record refused for something else (no name) …', r.body);
  ok(Object.keys(FB.files).length === before && Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + EV + '/speakers/') === 0; }).length === count,
    '2 …and neither refusal stored a file or a record');
  r = await call('POST', '/api/event/speakers', { eventId: 'qa-no-such-event', name: 'X', photoUrl: PNG_URL });
  ok(r.status === 404 && Object.keys(FB.files).length === before, '2 an event that does not exist: refused before any file is stored', r.body);

  /* an older record, saved inline before this */
  FB.docs['events/' + EV + '/speakers/old1'] = { name: 'Old Speaker', photoUrl: PNG_URL, status: 'confirmed', createdAt: now, updatedAt: now };
  before = Object.keys(FB.files).length;
  r = await call('PATCH', '/api/event/speakers', { eventId: EV, id: 'old1', name: 'Old Speaker Jr', photoUrl: PNG_URL, ifUpdatedAt: now });
  var old1 = FB.docs['events/' + EV + '/speakers/old1'];
  ok(r.status === 200 && old1.name === 'Old Speaker Jr' && old1.photoUrl === PNG_URL && Object.keys(FB.files).length === before,
    '2 a record saved inline before: a typo fixed with its photo sent back as it is — saved, its photo left where it is (the owner decides)', [r.status, r.body]);
  r = await call('PATCH', '/api/event/speakers', { eventId: EV, id: 'old1', logoUrl: JPEG_URL, ifUpdatedAt: 'not-the-latest' });
  ok(r.status === 409 && Object.keys(FB.files).length === before, '2 a new picture on a save that is stale: refused (409), nothing stored', r.body);
  r = await call('PATCH', '/api/event/speakers', { eventId: EV, id: 'old1', photoUrl: JPEG_URL, ifUpdatedAt: old1.updatedAt });
  old1 = FB.docs['events/' + EV + '/speakers/old1'];
  ok(r.status === 200 && old1.photoUrl.indexOf(STORE + 'events/' + EV + '/speakers/') === 0, '2 a new photo for it: stored as a file, the record keeps the address', old1);
  r = await call('PATCH', '/api/event/speakers', { eventId: EV, id: 'old1', logoUrl: SVG_BAD });
  ok(r.status === 415 && r.body.field === 'logoUrl' && !/data:/.test(FB.docs['events/' + EV + '/speakers/old1'].logoUrl || ''), '2 an unsafe SVG as a logo: refused', r.body);
  r = await call('PATCH', '/api/event/speakers', { eventId: EV, id: 'gone', photoUrl: PNG_URL });
  ok(r.status === 404, '2 a new picture for a record that is gone: 404', r.body);
  r = await call('PATCH', '/api/event/speakers', { eventId: EV, id: 'old1', photoUrl: 'https://cdn.example.com/a.jpg' });
  ok(r.status === 200 && FB.docs['events/' + EV + '/speakers/old1'].photoUrl === 'https://cdn.example.com/a.jpg', '2 an address is saved as it is (the library\'s ET pictures)');

  /* ---------- 3. a sponsor's logo, a gallery picture ---------- */
  r = await call('POST', '/api/event/partners', { eventId: EV, name: 'Globex', logoUrl: PNG_URL, status: 'confirmed' });
  var pt = r.body && FB.docs['events/' + EV + '/partners/' + r.body.id];
  ok(r.status === 200 && pt && pathOf(pt.logoUrl).indexOf('events/' + EV + '/partners/') === 0 && /globex-logo\.png$/.test(pt.logoUrl), '3 a sponsor\'s inline logo: a file in the partners folder', pt);
  r = await call('POST', '/api/event/gallery', { eventId: EV, imageUrl: JPEG_URL, caption: 'Day one' });
  var gl = r.body && FB.docs['events/' + EV + '/gallery/' + r.body.id];
  ok(r.status === 200 && gl && pathOf(gl.imageUrl).indexOf('events/' + EV + '/gallery/') === 0, '3 a gallery picture sent inline: a file in the gallery folder', gl);

  /* ---------- 4. POST /api/event/upload, now through storeImageFile ---------- */
  r = await call('POST', '/api/event/upload', { eventId: EV, kind: 'partners', fileName: 'Acme Logo.PNG', mimeType: 'image/png', dataBase64: PNG });
  ok(r.status === 200 && r.body.url === STORE + r.body.path && /^events\/qa-inline-pictures\/partners\/[a-z0-9]+-[0-9a-f]{12}-acme-logo\.png$/.test(r.body.path) &&
    r.body.contentType === 'image/png' && r.body.size === Buffer.from(PNG, 'base64').length && FB.files[r.body.path], '4 an upload answers as before: url, path, type, size; the file stored', r.body);
  r = await call('POST', '/api/event/upload', { eventId: EV, kind: 'speakers', fileName: 'x.png', mimeType: 'image/png', dataBase64: Buffer.from('<html></html>').toString('base64') });
  ok(r.status === 415 && /"x\.png" is not an image we can use/.test(r.body.error), '4 …and refuses what is not a picture, as before', r.body);
  r = await call('POST', '/api/event/upload', { eventId: EV, kind: 'speakers', fileName: 'e.png', mimeType: 'image/png', dataBase64: '' });
  ok(r.status === 400 && /empty/.test(r.body.error), '4 …and an empty file', r.body);

  /* ---------- 5. the speaker and sponsor pages' own picture (lib/people.js) ---------- */
  var P = require('./people'), T = P._test;
  var slug = 'qa-asha-rao';
  FB.docs['qaPeopleIndex/speakers-' + T.shardOf('speakers', slug)] = { kind: 'speakers', at: now, data: JSON.stringify({ people: (function () { var o = {}; o[slug] = { n: 'Asha Rao', k: [], p: ['ciso'] }; return o; })(), alias: {} }) };
  var H = {
    firebase: function () { return FB; }, isEventId: function (v) { return /^[a-z0-9][a-z0-9-]{0,99}$/.test(String(v || '')); },
    sendJson: function (res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); },
    requireAdmin: function (req, res, cb) { cb(FB, { email: 'admin@timesinternet.in', access: { email: 'admin@timesinternet.in', role: 'admin', portals: ['*'] } }); },
    withAdminBody: function (req, res, max, cb) { cb(FB, { email: 'admin@timesinternet.in', access: { email: 'admin@timesinternet.in', role: 'admin', portals: ['*'] } }, req.body || {}); },
    publicBaseFor: function () { return 'https://sites.test'; }, looksLikeTest: function () { return false; }
  };
  function put(body) {
    P.wire(H);       // lib/api.js wires the real helpers again on every speaker write
    return new Promise(function (resolve) {
      var res = { headersSent: false, s: 0, setHeader: function () {}, writeHead: function (s) { res.s = s; res.headersSent = true; }, end: function (b) { var j = null; try { j = JSON.parse(String(b)); } catch (e) { /* */ } resolve({ status: res.s, body: j }); } };
      P.handleOne({ method: 'PUT', url: '/api/people/speakers/one', headers: {}, body: body }, res);
    });
  }
  r = await put({ slug: slug, base: 0, page: { set: { photo: JPEG_URL } } });
  var pg = FB.docs['qaSpeakerPages/' + slug];
  ok(r.status === 200 && pg && pg.set.photo.indexOf(STORE + 'qa-people/speakers/' + slug + '/') === 0 && /asha-rao-photo|photo\.jpg$/.test(pg.set.photo),
    '5 a photo the team adds to a speaker page: a file (a test server\'s in qa-people/), the page keeps its address', [r.status, r.body && r.body.error, pg]);
  ok(r.body && r.body.person && r.body.person.photo === (pg && pg.set.photo), '5 …and the console is shown that address', r.body && r.body.person && r.body.person.photo);
  FB.docs['qaSpeakerPages/' + slug].set.photo = PNG_URL;           // a page saved inline before this
  before = Object.keys(FB.files).length;
  r = await put({ slug: slug, base: FB.docs['qaSpeakerPages/' + slug].version, page: { set: { photo: PNG_URL, designation: 'CISO' } } });
  ok(r.status === 200 && FB.docs['qaSpeakerPages/' + slug].set.photo === PNG_URL && FB.docs['qaSpeakerPages/' + slug].set.designation === 'CISO' && Object.keys(FB.files).length === before,
    '5 a page that held its photo inline: saved with it sent back as it is — left where it is', [r.status, r.body && r.body.error]);
  r = await put({ slug: slug, base: 0, page: { set: { photo: JPEG_URL } } });
  ok(r.status === 409 && Object.keys(FB.files).length === before, '5 a new photo on an old copy of the page: refused (409), nothing stored', r.body);
  r = await put({ slug: slug, base: FB.docs['qaSpeakerPages/' + slug].version, page: { set: { photo: 'data:image/jpeg;base64,' + Buffer.from('<html>').toString('base64') } } });
  ok(r.status === 415 && /The photo is not an image we can use/.test(r.body.error) && Object.keys(FB.files).length === before, '5 a "photo" that is not a picture: refused, said', r.body);

  /* ---------- 6. the console: RevampCore.storePicture (edit-event-core.js) ---------- */
  var sent = [];
  var win = { location: { origin: 'https://cms.test', href: 'https://cms.test/edit-event.html', search: '', hash: '' }, document: { addEventListener: function () {}, querySelector: function () { return null; } },
    localStorage: { getItem: function () { return null; }, setItem: function () {} }, sessionStorage: { getItem: function () { return null; }, setItem: function () {} },
    addEventListener: function () {}, navigator: {} };
  var ctx = { window: win, document: win.document, location: win.location, localStorage: win.localStorage, sessionStorage: win.sessionStorage, navigator: win.navigator,
    console: { log: function () {}, warn: function () {}, error: function () {} }, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
    URLSearchParams: URLSearchParams, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); }, Uint8Array: Uint8Array,
    Blob: function (parts, o) { this.parts = parts; this.type = o && o.type; this.size = parts.reduce(function (n, p) { return n + p.length; }, 0); },
    FileReader: function () { var self = this; this.readAsDataURL = function (f) { self.result = 'data:' + f.type + ';base64,' + Buffer.from(f.parts[0]).toString('base64'); setTimeout(function () { self.onload(); }, 0); }; },
    fetch: function (url, o) { sent.push({ url: url, body: JSON.parse(o.body) }); return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return null; } }, json: function () { return Promise.resolve({ url: STORE + 'events/x/speakers/1.jpg', path: 'events/x/speakers/1.jpg' }); }, text: function () { return Promise.resolve('{"url":"' + STORE + 'events/x/speakers/1.jpg"}'); } }); } };
  ctx.File = function (parts, name, o) { ctx.Blob.call(this, parts, o); this.name = name; };
  ctx.File.prototype = Object.create(ctx.Blob.prototype);
  ctx.self = win; ctx.globalThis = ctx;
  win.fetch = ctx.fetch;
  win.RevampAuth = { authedFetch: function (url, o) { return ctx.fetch(url, o); }, currentUser: function () { return { email: 'qa@timesinternet.in' }; } };
  ctx.RevampAuth = win.RevampAuth;
  var coreLoaded = true;
  try { vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event-core.js'), 'utf8'), ctx); } catch (e) { coreLoaded = false; realError('core did not load: ' + e.message); }
  var C = win.RevampCore || ctx.RevampCore;
  ok(coreLoaded && C && typeof C.storePicture === 'function', '6 RevampCore.storePicture exists');
  if (C && C.storePicture) {
    var same = await C.storePicture('qa-x', 'speakers', 'https://cdn.example.com/p.jpg', 'A');
    var none = await C.storePicture('qa-x', 'speakers', null, 'A');
    ok(same === 'https://cdn.example.com/p.jpg' && none === null && !sent.length, '6 an address (or nothing) is passed through, nothing uploaded');
    var url = null, err = null;
    try { url = await C.storePicture('qa-x', 'speakers', JPEG_URL, 'Naven Singh photo'); } catch (e) { err = e; }
    var up = sent[0];
    ok(url === STORE + 'events/x/speakers/1.jpg' && up && /\/api\/event\/upload$/.test(up.url) && up.body.kind === 'speakers' && up.body.fileName === 'naven-singh-photo.jpg' &&
      up.body.mimeType === 'image/jpeg' && up.body.dataBase64 === JPEG && up.body.eventId === 'qa-x', '6 image text is uploaded as a file (kind, name, type, bytes) and its address resolved', [url, err && err.message, up && { url: up.url, kind: up.body.kind, fileName: up.body.fileName, mimeType: up.body.mimeType }]);
    err = null;
    try { await C.storePicture('qa-x', 'speakers', 'data:text/html;base64,PGh0bWw+', 'x'); } catch (e) { err = e; }
    ok(err && /could not be read/.test(err.message) && sent.length === 1, '6 image text that is not a picture is refused before anything is sent', err && err.message);
  }

  /* ---------- 7. the console's pages: no record write carries image text ---------- */
  var HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event.html'), 'utf8');
  var TOOLS = fs.readFileSync(path.join(__dirname, '..', '..', 'edit-event-speaker-tools.js'), 'utf8');
  ok(/return storeRecordPictures\(G, Q\[0\], rec, cfg\.editing\)\.then\(function\(\)\{\s*return updateSub\(G\.itemRes, cfg\.editing\.id, cfg\.body\(rec\)\);/.test(HTML) &&
    /return storeRecordPictures\(G, e, rec, null\)\.then\(function\(\)\{\s*body = cfg\.body\(rec\);[\s\S]{0,80}return C\.createSub\(G\.itemRes, EV\.id, body\);/.test(HTML),
    '7 the Speakers and Sponsors dialogs upload a new photo or logo before the record is written (edit and add)');
  ok(/C\.storePicture\(EV\.id, G\.itemRes, rec\[k\], name\)/.test(HTML) && /!\(was && was\[k\] === rec\[k\]\)/.test(HTML), '7 …as a file of that kind; a picture the record already had is sent back as it is');
  ok(/X\.C\.storePicture\(ev, 'speakers', c\.data, [\s\S]{0,60}?\)\.then\(function \(url\) \{\s*c\.data = url;\s*return X\.C\.updateSub\('speakers', ev, c\.speakerId, \{ photoUrl: url \}\);/.test(TOOLS),
    '7 Add photos (files, a folder, a brochure) uploads each photo, then saves its address');
  ok(/X\.C\.storePicture\(ev, 'speakers', r\.photo \|\| '', [^)]*\)\.then\(function \(url\) \{\s*if \(url\) \{ body\.photoUrl = url;/.test(TOOLS) && !/body\.photoUrl = r\.photo/.test(TOOLS),
    '7 Paste a list: a library photo held inline is uploaded first');
  ok(!/updateSub\('speakers', X\.ev\(\)\.id, c\.speakerId, \{ photoUrl: c\.data \}\)/.test(TOOLS), '7 …the old inline write is gone');

  /* ---------- 8. tools/migrate-inline-pictures.js ---------- */
  FB.docs['events/real-event-2026'] = { name: 'Real Event 2026', createdAt: now, published: true };
  FB.docs['events/real-event-2026/speakers/s1'] = { name: 'Meera Iyer', photoUrl: JPEG_URL, logoUrl: 'https://x.test/l.png' };
  FB.docs['events/real-event-2026/speakers/s2'] = { name: 'Ravi K', photoUrl: 'https://x.test/p.jpg' };
  FB.docs['events/real-event-2026/partners/p1'] = { name: 'Initech', logoUrl: PNG_URL };
  FB.docs['events/real-event-2026/gallery/g1'] = { imageUrl: PNG_URL, caption: 'Hall' };
  FB.docs['events/real-event-2026/sessions/x1'] = { title: 'Not a picture field', photoUrl: PNG_URL };
  FB.docs['events/draft-2027/partners/p9'] = { name: 'Umbrella', logoUrl: JPEG_URL };
  FB.docs['events/draft-2027'] = { name: 'Draft 2027', createdAt: now };
  FB.docs['qaSponsorPages/umbrella'] = { name: 'Umbrella', set: { logo: PNG_URL }, version: 2 };
  FB.docs['events/' + EV + '/speakers/qa1'] = { name: 'QA Person', photoUrl: PNG_URL };      // test data: left out
  var docsBefore = JSON.stringify(FB.docs), filesBefore = Object.keys(FB.files).length;
  var res = await TOOL.scan(FB, {});
  var sum = TOOL.summarise(res);
  var at = res.hits.map(function (h) { return (h.eventId || h.col) + '/' + h.col + '/' + h.id + ':' + h.field; }).sort();
  ok(JSON.stringify(FB.docs) === docsBefore && Object.keys(FB.files).length === filesBefore, '8 the dry run writes nothing, stores nothing');
  ok(at.join() === ['draft-2027/partners/p9:logoUrl', 'qaSpeakerPages/qaSpeakerPages/qa-asha-rao:set.photo', 'qaSponsorPages/qaSponsorPages/umbrella:set.logo',
    'real-event-2026/gallery/g1:imageUrl', 'real-event-2026/partners/p1:logoUrl', 'real-event-2026/speakers/s1:photoUrl'].join(),
    '8 it finds every inline picture of a real event\'s speakers, sponsors and gallery, and the pages\' — not addresses, not other records, not qa- events', at);
  ok(sum.leftOutQa === 1 && sum.events === 2 && sum.eventStates.published === 1 && sum.eventStates.draft === 1 && sum.records === 6 && sum.pages === 2 && sum.total.n === 6 &&
    sum.byKind['sponsor logo'].n === 2, '8 …totals: by kind, records, events by state, pages, the qa- ones left out', sum);
  var s1 = res.hits.filter(function (h) { return h.id === 's1'; })[0];
  ok(s1 && s1.type === 'image/jpeg' && s1.bytes === Buffer.from(JPEG, 'base64').length && s1.chars === JPEG_URL.length && s1.name === 'Meera Iyer', '8 each one: its type, size (decoded and stored) and whose it is', s1);
  var one = await TOOL.scan(FB, { eventId: 'real-event-2026' });
  ok(one.hits.length === 3 && one.hits.every(function (h) { return h.eventId === 'real-event-2026'; }), '8 --event: that event only');
  var qa = await TOOL.scan(FB, { includeQa: true, pages: false });
  ok(qa.hits.some(function (h) { return h.eventId === EV && h.id === 'qa1'; }) && !qa.hits.some(function (h) { return h.area === 'page'; }), '8 --include-qa: the qa- events too');

  /* --apply, on the scan of one event, with one record changed in between */
  FB.docs['events/real-event-2026/gallery/g1'].imageUrl = 'https://x.test/changed.png';
  var moved = await TOOL.apply(FB, one.hits, {});
  var sp1 = FB.docs['events/real-event-2026/speakers/s1'], p1 = FB.docs['events/real-event-2026/partners/p1'];
  ok(moved.filter(function (m) { return m.url; }).length === 2 && pathOf(sp1.photoUrl).indexOf('events/real-event-2026/speakers/') === 0 && pathOf(p1.logoUrl).indexOf('events/real-event-2026/partners/') === 0 &&
    FB.files[pathOf(sp1.photoUrl)].equals(Buffer.from(JPEG, 'base64')), '8 --apply: each picture becomes a file in its folder, the record gets its address', moved.map(function (m) { return m.url || m.skipped; }));
  ok(sp1.logoUrl === 'https://x.test/l.png' && sp1.name === 'Meera Iyer' && !('updatedAt' in sp1), '8 …nothing else on the record changes');
  var g1 = moved.filter(function (m) { return m.hit.id === 'g1'; })[0];
  ok(g1 && /changed meanwhile/.test(g1.skipped) && FB.docs['events/real-event-2026/gallery/g1'].imageUrl === 'https://x.test/changed.png' && !filesUnder('events/real-event-2026/gallery/').length,
    '8 …a record changed meanwhile is left alone, said, and its new file removed', g1 && g1.skipped);
  var pageHit = res.hits.filter(function (h) { return h.area === 'page'; });
  moved = await TOOL.apply(FB, pageHit, {});
  var um = FB.docs['qaSponsorPages/umbrella'], umMoved = moved.filter(function (m) { return m.hit.id === 'umbrella'; })[0] || {};
  ok(moved.length === 2 && umMoved.url && um.set.logo === umMoved.url && pathOf(um.set.logo).indexOf('qa-people/sponsors/umbrella/') === 0 && um.version === 3, '8 a page\'s picture: a file in the pages\' folder, its version moved on', um);
  var again = await TOOL.scan(FB, { eventId: 'real-event-2026' });
  ok(again.hits.length === 0, '8 run again: what was moved is not found again (the changed record holds an address now)', again.hits.map(function (h) { return h.id; }));

  console.error = realError;
  if (failures.length) { process.stdout.write('inline-pictures: ' + (checks - failures.length) + ' passed, ' + failures.length + ' failed\n  ' + failures.join('\n  ') + '\n'); process.exit(1); }
  process.stdout.write('inline-pictures: ' + checks + ' passed, 0 failed\n');
  process.exit(0);
})().catch(function (e) { console.error = realError; console.error('CRASH ' + (e && e.stack || e)); process.exit(1); });
