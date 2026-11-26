// node functions/lib/api-books.test.js — Books (BOOKSTUDIO, the owner's coffee table book editor, 26 Nov 2026), Phase 1:
// the server that replaces the AI Studio export's open Express server (docs/bookstudio/PLAN.md).
// Checks: a book is split into parts and put back exactly; only admins get in; a save based on an old revision is
// refused and nothing is lost; a save writes only what changed and removes what nothing points to; delete, status,
// versions, templates (the date first kept never changes), font collections (each person's own); photos (kind from
// their bytes, sizes, the copies, private, cached); manuscripts (Word paragraphs and headings, RTF, CSV, a PDF's text);
// IDML; the AI steps (what they are told, what is kept of their answers, failures); the wiring (router, served files,
// rate limits, models, the page, the menu link). Firestore and Storage are in-memory; the AI is a stub. No network.
'use strict';
var fs = require('fs'), path = require('path'), zlib = require('zlib'), stream = require('stream');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '') + '\n'); }
['log', 'info', 'warn', 'error'].forEach(function (k) { console[k] = function () {}; });
var ROOT = path.join(__dirname, '..', '..');

/* ---------- in-memory Firebase ---------- */
delete process.env.K_SERVICE;
delete process.env.ACCESS_CONFIG_DOC;
delete process.env.BOOKS_COL_PREFIX;
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var DOCS = {}, FILES = {}, WRITES = [];
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function snapOf(p) { var d = DOCS[p]; return { id: p.split('/').pop(), ref: refOf(p), exists: !!d, data: function () { return clone(d); }, get: function (k) { return d ? d[k] : undefined; } }; }
function applyUpdate(p, patch) {
  var d = DOCS[p];
  Object.keys(patch).forEach(function (k) {
    var v = patch[k], keys = k.split('.'), o = d;
    for (var i = 0; i < keys.length - 1; i++) { o[keys[i]] = o[keys[i]] || {}; o = o[keys[i]]; }
    var last = keys[keys.length - 1];
    if (v && typeof v === 'object' && 'operand' in v) o[last] = (o[last] || 0) + v.operand;
    else o[last] = clone(v);
  });
}
function refOf(p) {
  return { id: p.split('/').pop(), path: p,
    get: function () { return Promise.resolve(snapOf(p)); },
    set: function (d) { DOCS[p] = clone(d); WRITES.push('set ' + p); return Promise.resolve(); },
    create: function (d) { if (DOCS[p]) { var e = new Error('ALREADY_EXISTS'); e.code = 6; return Promise.reject(e); } DOCS[p] = clone(d); return Promise.resolve(); },
    update: function (d) { if (!DOCS[p]) return Promise.reject(new Error('NOT_FOUND')); applyUpdate(p, d); WRITES.push('update ' + p); return Promise.resolve(); },
    delete: function () { delete DOCS[p]; WRITES.push('delete ' + p); return Promise.resolve(); },
    collection: function (n) { return colOf(p + '/' + n); } };
}
function query(p, filters, order, lim) {
  return {
    select: function () { return query(p, filters, order, lim); },
    limit: function (n) { return query(p, filters, order, n); },
    where: function (f, op, v) { return query(p, filters.concat([[f, v]]), order, lim); },
    orderBy: function (f, dir) { return query(p, filters, [f, dir], lim); },
    get: function () {
      var depth = p.split('/').length + 1;
      var docs = Object.keys(DOCS).filter(function (k) { return k.indexOf(p + '/') === 0 && k.split('/').length === depth; })
        .filter(function (k) { return filters.every(function (f) { return DOCS[k][f[0]] === f[1]; }); }).map(snapOf);
      if (order) docs.sort(function (a, b) { var x = String(a.data()[order[0]]), y = String(b.data()[order[0]]); return order[1] === 'desc' ? y.localeCompare(x) : x.localeCompare(y); });
      if (lim) docs = docs.slice(0, lim);
      return Promise.resolve({ docs: docs, size: docs.length });
    }
  };
}
function colOf(p) { var q = query(p, [], null, 0); q.doc = function (id) { return refOf(p + '/' + id); }; return q; }
var FB = {
  db: {
    collection: function (n) { return colOf(n); },
    getAll: function () { return Promise.resolve([].slice.call(arguments).map(function (r) { return snapOf(r.path); })); },
    batch: function () { var ops = []; return { set: function (r, d) { ops.push(function () { return r.set(d); }); }, delete: function (r) { ops.push(function () { return r.delete(); }); },
      commit: function () { return ops.reduce(function (c, f) { return c.then(f); }, Promise.resolve()); } }; },
    runTransaction: function (fn) { return fn({ get: function (r) { return r.get(); }, set: function (r, d) { r.set(d); }, update: function (r, d) { applyUpdate(r.path, d); } }); }
  },
  bucket: { name: 'qa-bucket', file: function (p) {
    return {
      save: function (buf, opts) { FILES[p] = { body: Buffer.from(buf), opts: opts }; return Promise.resolve(); },
      download: function () { return FILES[p] ? Promise.resolve([FILES[p].body]) : Promise.reject(new Error('No such object')); },
      delete: function () { delete FILES[p]; return Promise.resolve(); },
      createReadStream: function () { var s = new stream.PassThrough(); setImmediate(function () { if (FILES[p]) s.end(FILES[p].body); else s.emit('error', new Error('No such object')); }); return s; }
    };
  } },
  auth: { verifyIdToken: function (t) { return Promise.resolve({ uid: t, email: t + '@timesinternet.in', email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } }
};
var FIREBASE = require.resolve('./firebase');
require.cache[FIREBASE] = { id: FIREBASE, filename: FIREBASE, loaded: true, children: [], paths: [], exports: { getFirebase: function () { return FB; } } };
/* the AI: a stub that answers what the test sets, and records what it was asked */
var LLM = require.resolve('./llm'), AI_ASKS = [], AI_ANSWER = null;
require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, children: [], paths: [], exports: { callJson: function (prompt, schema, opts) {
  AI_ASKS.push({ prompt: prompt, schema: schema, opts: opts });
  if (opts && typeof opts.onUsage === 'function') opts.onUsage({ inputTokens: 100, outputTokens: 50, usd: 0.002, provider: 'claude' });
  return Promise.resolve(typeof AI_ANSWER === 'function' ? AI_ANSWER(prompt) : AI_ANSWER);
} } };
var api = require('./api');
var B = require('./api-books'), T = B._test;
var AI = require('./books-ai');

var ADMIN = 'sachitanand.rai', EDITOR = 'someone';
DOCS['config/access'] = { defaultRole: 'editor', members: {
  'sachitanand.rai@timesinternet.in': { role: 'admin', portals: ['*'] },
  'other.person@timesinternet.in': { role: 'admin', portals: ['*'] },
  'other@timesinternet.in': { role: 'admin', portals: ['*'] } } };
function call(method, url, body, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var raw = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    var headers = Object.assign({ host: 'cms.example' }, o.token === null ? {} : { authorization: 'Bearer ' + (o.token || ADMIN) },
      Buffer.isBuffer(body) ? {} : { 'content-type': 'application/json' }, o.headers || {});
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: raw };
    req.on = function () { return req; }; req.resume = function () {};
    var chunks = [], out = { status: 200, headers: {} };
    var res = new stream.Writable({ write: function (c, e, cb) { chunks.push(Buffer.from(c)); cb(); } });
    res.headersSent = false;
    res.setHeader = function (k, v) { out.headers[k.toLowerCase()] = v; };
    res.getHeader = function (k) { return out.headers[k.toLowerCase()]; };
    res.writeHead = function (s, h) { out.status = s; res.headersSent = true; Object.keys(h || {}).forEach(function (k) { out.headers[k.toLowerCase()] = h[k]; }); return res; };
    res.on('finish', function () {
      out.body = Buffer.concat(chunks);
      try { out.json = JSON.parse(out.body.toString('utf8')); } catch (e) { out.json = null; }
      resolve(out);
    });
    api.handleApi(req, res);
  });
}

/* a book as the editor holds it */
function page(id, label, texts) {
  return { id: id, orderIndex: 0, label: label, role: 'editorial_text', backgroundColor: '#fff',
    elements: (texts || []).map(function (t, i) { return { id: id + '_t' + i, type: 'text', name: 'Body', xMm: 10, yMm: 10, widthMm: 100, heightMm: 40, text: t }; }) };
}
function book(id, pages) {
  return { id: id, name: 'Forms of Light', subtitle: 'A test book', category: 'Architecture', status: 'draft', unit: 'mm', coverThumbnail: '/books/samples/x.jpg',
    dimensions: { widthMm: 240, heightMm: 300 }, designSystem: { colors: { paper: '#FFF' } }, chapters: [], templateReport: null, printSettings: { bleedMm: 3 },
    customDimensionPresets: [], masterPages: [{ id: 'm1', name: 'Text page', elements: [] }],
    contentSections: Array.from({ length: 260 }, function (_, i) { return { id: 's' + i, title: 'S' + i, kind: 'body', body: 'Body ' + i, orderIndex: i }; }),
    imageAssets: [{ id: 'a1', name: 'p.jpg', url: '/books/samples/p.jpg', widthPx: 10, heightPx: 10, mimeType: 'image/jpeg', category: 'x', tags: [], uploadedAt: '' }],
    pages: pages || [page('p1', 'Cover', ['Forms of Light']), page('p2', 'Essay', ['One two three four five', 'six seven'])], createdAt: '', updatedAt: '' };
}
function partsOf(id) { return Object.keys(DOCS).filter(function (k) { return k.indexOf('books/' + id + '/parts/') === 0; }); }

(async function () {
  /* ---------- 1 a book, split and put back ---------- */
  var b1 = book('qa_book_1');
  var sp = T.splitBook(b1);
  check('1.1 one part per page and master, the manuscript in runs of 250, the photos in one', sp.parts.map(function (p) { return p.key; }).join() === 'page:p1,page:p2,master:m1,sections:0,sections:1,assets:0', sp.parts.map(function (p) { return p.key; }));
  var byId = {}; sp.parts.forEach(function (p) { byId[p.id] = p.data; });
  var back = T.assemble('qa_book_1', { name: sp.name, status: sp.status, core: sp.core, parts: sp.parts.map(function (p) { return { k: p.key, id: p.id }; }) }, byId);
  ['pages', 'masterPages', 'contentSections', 'imageAssets', 'dimensions', 'designSystem', 'printSettings', 'name', 'subtitle', 'coverThumbnail'].forEach(function (k) {
    check('1.2 put back exactly: ' + k, JSON.stringify(back[k]) === JSON.stringify(b1[k]));
  });
  var b1b = clone(b1); b1b.pages[1].elements[0].text = 'Changed';
  var sp2 = T.splitBook(b1b);
  check('1.3 one page changed: only its part has a new id', sp2.parts.filter(function (p, i) { return p.id !== sp.parts[i].id; }).map(function (p) { return p.key; }).join() === 'page:p2');
  check('1.4 the summary counts pages and words', sp.summary.pageCount === 2 && sp.summary.wordCount === 10 && sp.summary.widthMm === 240, sp.summary);
  function refused(b, status, re) { try { T.splitBook(b); return false; } catch (e) { return e.status === status && (!re || re.test(e.message)); } }
  check('1.5 no id, no pages, a page without an id, two pages with one id: refused', refused(Object.assign(clone(b1), { id: '../x' }), 400) && refused(Object.assign(clone(b1), { pages: [] }), 400, /at least one page/) &&
    refused(Object.assign(clone(b1), { pages: [{ label: 'x', elements: [] }] }), 400, /Page 1 has no valid id/) && refused(Object.assign(clone(b1), { pages: [page('p1', 'A'), page('p1', 'B')] }), 400, /share the id/));
  var huge = clone(b1); huge.pages[1].elements[0].text = new Array(T.MAX_PART_BYTES + 10).join('x');
  check('1.6 a page too large to save: 413, naming the page', refused(huge, 413, /Page "Essay" is too large/));
  var dataCover = clone(b1); dataCover.coverThumbnail = 'data:image/png;base64,' + new Array(5000).join('A');
  check('1.7 a cover picture pasted in as data is not kept in the list', JSON.parse(T.splitBook(dataCover).core).coverThumbnail === '' && T.splitBook(dataCover).summary.coverThumbnail === '');
  process.env.BOOKS_COL_PREFIX = 'qa';
  check('1.8 a test server keeps its own copy: qaBooks…, files under qa-books/', T.col('books') === 'qaBooks' && T.col('bookAssets') === 'qaBookAssets' && T.filePrefix() === 'qa-books/');
  delete process.env.BOOKS_COL_PREFIX;
  check('1.9 …and production its own', T.col('books') === 'books' && T.filePrefix() === 'books/');

  /* ---------- 2 who gets in ---------- */
  var me = await call('GET', '/api/books/me');
  check('2.1 an admin gets in, as Designer', me.status === 200 && me.json.role === 'designer' && me.json.email === ADMIN + '@timesinternet.in', me);
  var ed = await call('GET', '/api/books/list', null, { token: EDITOR });
  check('2.2 anyone else is refused with the sentence (Phase 1: admins only)', ed.status === 403 && ed.json.code === 'no-books' && ed.json.error === T.NOT_OPEN, ed.json);
  var anon = await call('GET', '/api/books/list', null, { token: null });
  check('2.3 nobody signed in: 401', anon.status === 401, anon.status);
  var edSave = await call('PUT', '/api/books/book', { book: book('qa_ed'), baseRev: null }, { token: EDITOR });
  check('2.4 a refused person writes nothing', edSave.status === 403 && !DOCS['books/qa_ed'], edSave.status);
  check('2.5 an unknown route: 404; a known one with another method: 405', (await call('GET', '/api/books/nope')).status === 404 && (await call('PATCH', '/api/books/book')).status === 405);

  /* ---------- 3 saving and loading ---------- */
  var c1 = await call('PUT', '/api/books/book', { book: b1, baseRev: null });
  var root = DOCS['books/qa_book_1'] || {};
  check('3.1 a new book is created at revision 1, by whom and when', c1.status === 200 && c1.json.rev === 1 && root.rev === 1 && root.createdBy === ADMIN + '@timesinternet.in' && root.deletedAt === null && !!root.createdAt, c1.json);
  check('3.2 its parts are stored, the settings in the book', partsOf('qa_book_1').length === 6 && JSON.parse(root.core).dimensions.widthMm === 240, partsOf('qa_book_1').length);
  var l1 = await call('GET', '/api/books/book?id=qa_book_1');
  check('3.3 loaded back whole, with its revision', l1.status === 200 && l1.json.rev === 1 && JSON.stringify(l1.json.book.pages) === JSON.stringify(b1.pages) &&
    l1.json.book.contentSections.length === 260 && l1.json.book.masterPages[0].id === 'm1' && l1.json.book.name === 'Forms of Light', l1.json && l1.json.rev);
  var again = await call('PUT', '/api/books/book', { book: b1, baseRev: null });
  check('3.4 a second "new" book with the same id is refused (409 exists), nothing changed', again.status === 409 && again.json.code === 'exists' && DOCS['books/qa_book_1'].rev === 1, again.json);
  var oldP2 = sp.parts[1].id;
  WRITES = [];
  var s2 = await call('PUT', '/api/books/book', { book: b1b, baseRev: 1 });
  var partWrites = WRITES.filter(function (w) { return /^set books\/qa_book_1\/parts\//.test(w); });
  check('3.5 a save based on the current revision: revision 2', s2.status === 200 && s2.json.rev === 2 && DOCS['books/qa_book_1'].rev === 2, s2.json);
  check('3.6 …writing only the page that changed', partWrites.length === 1 && partWrites[0].indexOf(sp2.parts[1].id) !== -1, partWrites);
  await new Promise(function (r) { setTimeout(r, 10); });
  check('3.7 …and the part nothing points to any more is removed', !DOCS['books/qa_book_1/parts/' + oldP2] && partsOf('qa_book_1').length === 6, partsOf('qa_book_1').length);
  var stale = await call('PUT', '/api/books/book', { book: b1, baseRev: 1 }, { token: 'other.person' });
  check('3.8 a save based on an old revision is refused: 409 stale, saying who saved', stale.status === 409 && stale.json.code === 'stale' && stale.json.rev === 2 &&
    /sachitanand\.rai@timesinternet\.in saved this book after you opened it/.test(stale.json.error), stale.json);
  check('3.9 …and the newer save is untouched', DOCS['books/qa_book_1'].rev === 2 && JSON.parse(DOCS['books/qa_book_1/parts/' + sp2.parts[1].id].data).elements[0].text === 'Changed');
  var staleSelf = await call('PUT', '/api/books/book', { book: b1, baseRev: 1 });
  check('3.10 the same person from another tab is told so', staleSelf.status === 409 && /saved in another tab or window/.test(staleSelf.json.error), staleSelf.json);
  try { T.checkRev({ rev: 3 }, 2, 'a'); check('3.11 checkRev refuses an old base', false); } catch (e) { check('3.11 checkRev refuses an old base', e.status === 409); }
  var bad = await call('PUT', '/api/books/book', { book: { id: 'qa_x', pages: [] }, baseRev: null });
  check('3.12 a book with no pages: 400 with the sentence, nothing stored', bad.status === 400 && /at least one page/.test(bad.json.error) && !DOCS['books/qa_x']);
  var badRev = await call('PUT', '/api/books/book', { book: book('qa_y'), baseRev: 'abc' });
  check('3.13 a revision that is not a number: 400', badRev.status === 400);
  check('3.14 an id that is not one: 400', (await call('GET', '/api/books/book?id=../x')).status === 400);

  /* ---------- 4 the list, status, delete ---------- */
  await call('PUT', '/api/books/book', { book: Object.assign(book('qa_book_2'), { name: 'Second' }), baseRev: null });
  DOCS['books/qa_book_2'].updatedAt = '2099-01-01T00:00:00.000Z';
  var list = await call('GET', '/api/books/list');
  var first = list.json && list.json.books[0];
  check('4.1 the list: every book, newest first, with what the cards show', list.status === 200 && list.json.books.length === 2 && first.id === 'qa_book_2' &&
    first.pageCount === 2 && first.wordCount === 10 && first.dimensions.widthMm === 240 && first.subtitle === 'A test book' && first.updatedBy === ADMIN + '@timesinternet.in', list.json);
  check('4.2 …and nothing heavy (no settings, no parts)', list.json && !('core' in first) && !('parts' in first));
  var st = await call('POST', '/api/books/status', { id: 'qa_book_1', status: 'archived' });
  check('4.3 archive: a new revision, the status kept', st.status === 200 && st.json.rev === 3 && DOCS['books/qa_book_1'].status === 'archived', st.json);
  check('4.4 a status that is not one: 400', (await call('POST', '/api/books/status', { id: 'qa_book_1', status: 'published' })).status === 400);
  var del = await call('DELETE', '/api/books/book?id=qa_book_2');
  check('4.5 delete: kept, marked, gone from the list', del.status === 200 && !!DOCS['books/qa_book_2'].deletedAt && DOCS['books/qa_book_2'].deletedBy === ADMIN + '@timesinternet.in' &&
    (await call('GET', '/api/books/list')).json.books.map(function (b) { return b.id; }).join() === 'qa_book_1');
  check('4.6 a deleted book: not loaded (404), not saved (410), not deleted twice (404)', (await call('GET', '/api/books/book?id=qa_book_2')).status === 404 &&
    (await call('PUT', '/api/books/book', { book: book('qa_book_2'), baseRev: 2 })).status === 410 && (await call('DELETE', '/api/books/book?id=qa_book_2')).status === 404);

  /* ---------- 5 versions ---------- */
  var snap = { pages: b1.pages, dimensions: b1.dimensions };
  var v1 = await call('POST', '/api/books/versions', { bookId: 'qa_book_1', version: { id: 'ver_1', label: 'Proof 1', summary: 'before trim change', pageCount: 2, totalWords: 9, snapshot: snap } });
  var vf = FILES['books/qa_book_1/versions/ver_1.json.gz'];
  check('5.1 a version: its contents compressed in the bucket, its details in the book', v1.status === 200 && !!vf && JSON.parse(zlib.gunzipSync(vf.body).toString()).pages.length === 2 &&
    DOCS['books/qa_book_1/versions/ver_1'].label === 'Proof 1' && !('snapshot' in DOCS['books/qa_book_1/versions/ver_1']), v1.json);
  check('5.2 a version is kept once (409 for the same id)', (await call('POST', '/api/books/versions', { bookId: 'qa_book_1', version: { id: 'ver_1', snapshot: snap } })).status === 409);
  var vl = await call('GET', '/api/books/versions?id=qa_book_1');
  check('5.3 the list of versions comes without their contents', vl.status === 200 && vl.json.versions.length === 1 && !vl.json.versions[0].snapshot && vl.json.versions[0].createdBy === ADMIN + '@timesinternet.in', vl.json);
  var vg = await call('GET', '/api/books/version?id=qa_book_1&versionId=ver_1');
  check('5.4 one version, with its contents', vg.status === 200 && JSON.stringify(vg.json.version.snapshot) === JSON.stringify(snap));
  check('5.5 a version of a deleted or unknown book: 404', (await call('POST', '/api/books/versions', { bookId: 'qa_book_2', version: { id: 'v', snapshot: snap } })).status === 404 &&
    (await call('GET', '/api/books/version?id=qa_book_1&versionId=nope')).status === 404);

  /* ---------- 6 templates and font collections ---------- */
  var tpl = { id: 'ct_1', templateKind: 'page', collectionName: 'My Templates', category: 'Openers', title: 'Chapter opener', description: '', tags: ['a'], payload: { page: { id: 'x' } } };
  await call('PUT', '/api/books/template', { template: tpl });
  var firstKept = DOCS['bookTemplates/ct_1'].createdAt;
  await new Promise(function (r) { setTimeout(r, 5); });
  var t2 = await call('PUT', '/api/books/template', { template: Object.assign(clone(tpl), { title: 'Chapter opener v2' }) });
  check('6.1 a template saved again keeps the date it was first kept (the export\'s rules refused this save)', t2.status === 200 && DOCS['bookTemplates/ct_1'].createdAt === firstKept &&
    DOCS['bookTemplates/ct_1'].updatedAt !== firstKept && DOCS['bookTemplates/ct_1'].title === 'Chapter opener v2', DOCS['bookTemplates/ct_1']);
  var tl = await call('GET', '/api/books/templates');
  check('6.2 the team\'s templates, their contents read back', tl.status === 200 && tl.json.templates[0].payload.page.id === 'x');
  check('6.3 a kind that is not one: 400', (await call('PUT', '/api/books/template', { template: Object.assign(clone(tpl), { templateKind: 'website' }) })).status === 400);
  check('6.4 delete a template', (await call('DELETE', '/api/books/template?id=ct_1')).status === 200 && !DOCS['bookTemplates/ct_1']);
  await call('PUT', '/api/books/font-collection', { collection: { id: 'default_editorial_fonts', name: 'My Editorial Fonts', fonts: ['Lora'], presets: [{ name: 'x' }] } });
  await call('PUT', '/api/books/font-collection', { collection: { id: 'default_editorial_fonts', name: 'Theirs', fonts: ['Syne'], presets: [] } }, { token: 'other' });
  var mine = await call('GET', '/api/books/font-collections');
  check('6.5 font collections are each person\'s own', mine.status === 200 && mine.json.collections.length === 1 && mine.json.collections[0].fonts[0] === 'Lora' && mine.json.collections[0].presets[0].name === 'x', mine.json);

  /* ---------- 7 photos ---------- */
  var sharp = require('sharp');
  var jpg = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: '#88aa66' } }).jpeg().toBuffer();
  var up = await call('POST', '/api/books/asset', jpg, { headers: { 'content-type': 'image/jpeg', 'x-file-name': encodeURIComponent('Courtyard at dusk.jpg') } });
  var a = up.json && up.json.asset, aid = a && a.id;
  check('7.1 a photo: its own size, its copies\' addresses', up.status === 200 && /^as_[a-f0-9]{20}$/.test(aid || '') && a.widthPx === 3600 && a.heightPx === 2400 && a.name === 'Courtyard at dusk.jpg' &&
    a.url === '/api/books/asset/' + aid + '/display' && a.printUrl === '/api/books/asset/' + aid + '/print' && a.source === 'uploaded', up.json);
  var objs = (DOCS['bookAssets/' + aid] || {}).objects || {};
  check('7.2 kept privately (never made public): the original, the print copy (the original itself), a screen copy, a thumbnail', !!FILES['books/assets/' + aid + '/original.jpg'] &&
    objs.print && objs.print.path === objs.original.path && !!FILES[objs.display.path] && !!FILES[objs.thumb.path] && FILES[objs.display.path].opts.metadata.cacheControl === 'private, max-age=31536000', objs);
  var dm = await sharp(FILES[objs.display.path].body).metadata(), tm = await sharp(FILES[objs.thumb.path].body).metadata();
  check('7.3 the screen copy is at most 2400 px, the thumbnail 480', dm.width === 2400 && dm.height === 1600 && tm.width === 480, [dm.width, tm.width]);
  var got = await call('GET', '/api/books/asset/' + aid + '/display');
  check('7.4 a copy is served from our own address: private, cached a year, its own type', got.status === 200 && got.headers['content-type'] === 'image/jpeg' &&
    got.headers['cache-control'] === 'private, max-age=31536000, immutable' && got.body.length === FILES[objs.display.path].body.length, got.headers);
  check('7.5 …and not sent again to a browser that has it (304)', (await call('GET', '/api/books/asset/' + aid + '/display', null, { headers: { 'if-none-match': got.headers.etag } })).status === 304);
  check('7.6 …nor to anyone without Books', (await call('GET', '/api/books/asset/' + aid + '/display', null, { token: EDITOR })).status === 403);
  var tif = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#123456' } }).tiff().toBuffer();
  var upT = await call('POST', '/api/books/asset', tif, { headers: { 'content-type': 'image/tiff', 'x-file-name': 'plate.tif' } });
  var tobj = upT.json ? DOCS['bookAssets/' + upT.json.asset.id].objects : {};
  check('7.7 a TIFF: the original kept, a full-size JPEG the browser can draw made for print', upT.status === 200 && /original\.tif$/.test(tobj.original.path) && /print\.jpg$/.test(tobj.print.path) &&
    (await sharp(FILES[tobj.print.path].body).metadata()).width === 800, tobj);
  var gif = Buffer.from('474946383961010001000000002c00000000010001000002', 'hex');
  var svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  check('7.8 what is not a JPG, PNG, WebP or TIFF photo is refused by its bytes, whatever its name says', (await call('POST', '/api/books/asset', gif, { headers: { 'x-file-name': 'x.jpg', 'content-type': 'image/jpeg' } })).status === 415 &&
    (await call('POST', '/api/books/asset', svg, { headers: { 'x-file-name': 'x.png', 'content-type': 'image/png' } })).status === 415);
  var tooBig = await call('POST', '/api/books/asset', Buffer.alloc(10), { headers: { 'content-length': String(31 * 1024 * 1024), 'x-file-name': 'big.jpg' } });
  check('7.9 a photo over 30 MB: 413 with what to do', tooBig.status === 413 && /larger than 30 MB/.test(tooBig.json.error), tooBig.json);
  check('7.10 an asset address that is not one: 404 json', (await call('GET', '/api/books/asset/xyz/display')).status === 404);

  /* ---------- 8 manuscripts ---------- */
  var JSZip = require('jszip');
  var docx = new JSZip();
  docx.file('word/document.xml', '<w:document><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter One: Light</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t xml:space="preserve">The first paragraph, </w:t></w:r><w:r><w:t>with two runs &amp; an ampersand.</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Short line no stop</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>“A quote stands alone.”</w:t></w:r></w:p></w:body></w:document>');
  var dbuf = await docx.generateAsync({ type: 'nodebuffer' });
  var m1 = await call('POST', '/api/books/manuscript', dbuf, { headers: { 'x-file-name': 'Manuscript.docx' } });
  var secs = m1.json && m1.json.sections || [];
  check('8.1 Word: each paragraph its own section (the export ran them together)', m1.status === 200 && secs.length === 4 && secs[1].body === 'The first paragraph, with two runs & an ampersand.', secs);
  check('8.2 …headings from Word\'s own heading styles, not guessed', secs[0].kind === 'heading' && secs[0].title === 'Chapter One: Light' && secs[2].kind === 'body' && secs[3].kind === 'quote', secs.map(function (x) { return x.kind; }));
  check('8.3 …with the word count', m1.json && m1.json.wordCount === 20, m1.json && m1.json.wordCount);
  var m2 = await call('POST', '/api/books/manuscript', Buffer.from('Heading\n\nA body paragraph that ends.\n\nAnother one.'), { headers: { 'x-file-name': 'Doc.pdf', 'x-source-format': 'pdf-text' } });
  check('8.4 a PDF\'s text read in the browser: split the same way', m2.status === 200 && m2.json.sections.length === 3 && m2.json.sections[0].kind === 'heading', m2.json);
  var m3 = await call('POST', '/api/books/manuscript', Buffer.from('{\\rtf1 Hello \\b world\\b0\\par Second}'), { headers: { 'x-file-name': 'a.rtf' } });
  check('8.5 RTF: its words without the codes (the export returned nothing for this)', m3.status === 200 && /Hello world/.test(m3.json.rawText) && /Second/.test(m3.json.rawText), m3.json && m3.json.rawText);
  var word = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Riched20;}\\f0\\fs24 Chapter One\\par\\par The \\ldblquote quiet\\rdblquote  hall \\u8212? and caf\\\'e9.\\par}';
  var m3b = await call('POST', '/api/books/manuscript', Buffer.from(word), { headers: { 'x-file-name': 'b.rtf' } });
  check('8.5b …a Word-made RTF: tables and generator left out, quotes, dashes and accents kept', m3b.status === 200 && m3b.json.rawText === 'Chapter One\n\nThe \u201cquiet\u201d hall \u2014 and caf\u00e9.', m3b.json && m3b.json.rawText);
  var m4 = await call('POST', '/api/books/manuscript', Buffer.from('Year,Revenue\n2024,"120"\n'), { headers: { 'x-file-name': 'a.csv' } });
  check('8.6 CSV: one block per row', m4.status === 200 && m4.json.sections.length === 2 && m4.json.sections[1].body === '2024 — 120', m4.json && m4.json.sections);
  check('8.7 an old .doc, a PDF sent as it is, an unknown kind: 415 with what to do', (await call('POST', '/api/books/manuscript', Buffer.from('x'), { headers: { 'x-file-name': 'a.doc' } })).status === 415 &&
    (await call('POST', '/api/books/manuscript', Buffer.from('%PDF'), { headers: { 'x-file-name': 'a.pdf' } })).status === 415 && (await call('POST', '/api/books/manuscript', Buffer.from('x'), { headers: { 'x-file-name': 'a.exe' } })).status === 415);
  check('8.8 an empty file: 422; a broken Word file: 422', (await call('POST', '/api/books/manuscript', Buffer.from('   '), { headers: { 'x-file-name': 'a.txt' } })).status === 422 &&
    (await call('POST', '/api/books/manuscript', Buffer.from('not a zip'), { headers: { 'x-file-name': 'a.docx' } })).status === 422);

  /* ---------- 9 InDesign ---------- */
  var idml = new JSZip();
  idml.file('mimetype', 'application/vnd.adobe.indesign-idml-package');
  idml.file('designmap.xml', '<Document/>');
  idml.file('Resources/Preferences.xml', '<Preferences><DocumentPreference PageWidth="680.31496" PageHeight="850.3937" FacingPages="true"/></Preferences>');
  idml.file('Resources/Fonts.xml', '<Fonts><FontFamily Self="di1" Name="Minion Pro"/><FontFamily Self="di2" Name="Futura PT"/></Fonts>');
  idml.file('Resources/Styles.xml', '<Styles><CharacterStyle><Properties><AppliedFont type="string">Canela</AppliedFont></Properties></CharacterStyle></Styles>');
  idml.file('Resources/Graphic.xml', '<Graphic><Color Self="Color/Black" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/><Color Self="c2" Space="RGB" ColorValue="198 162 107" Name="Gold"/><Color Self="c3" Space="CMYK" ColorValue="0 0 0 0" Name="Paper"/></Graphic>');
  idml.file('MasterSpreads/MasterSpread_a.xml', '<MasterSpread><Page><MarginPreference ColumnCount="2" ColumnGutter="14.173" Top="56.693" Bottom="70.866" Left="62.362" Right="51.024"/></Page></MasterSpread>');
  idml.file('Spreads/Spread_1.xml', '<Spread><Page/><Page/></Spread>');
  idml.file('Spreads/Spread_2.xml', '<Spread><Page/></Spread>');
  var i1 = await call('POST', '/api/books/idml', await idml.generateAsync({ type: 'nodebuffer' }), { headers: { 'x-file-name': 'Monograph.idml' } });
  var meta = i1.json && i1.json.idml || {};
  check('9.1 IDML: page size in mm, facing pages, pages and spreads', i1.status === 200 && i1.json.isNativeIndd === false && meta.widthMm === 240 && meta.heightMm === 300 && meta.facingPages === true && meta.pageCount === 3 && meta.spreadCount === 2, meta);
  check('9.2 …columns, gutter and margins from the master pages', meta.columns === 2 && meta.columnGapMm === 5 && meta.margins.top === 20 && meta.margins.inner === 22 && meta.margins.outer === 18, meta);
  check('9.3 …the fonts (families and the ones styles apply; the export found none)', ['Minion Pro', 'Futura PT', 'Canela'].every(function (f) { return meta.detectedFonts.indexOf(f) !== -1; }), meta.detectedFonts);
  check('9.4 …the colours, CMYK ones too (the export kept RGB only), paper left out', meta.detectedColors.join() === '#000000,#C6A26B', meta.detectedColors);
  var notIdml = new JSZip(); notIdml.file('a.txt', 'x');
  check('9.5 a zip that is not IDML, and a broken file: 422 with what to do', (await call('POST', '/api/books/idml', await notIdml.generateAsync({ type: 'nodebuffer' }), { headers: { 'x-file-name': 'a.idml' } })).status === 422 &&
    (await call('POST', '/api/books/idml', Buffer.from('zzz'), { headers: { 'x-file-name': 'a.idml' } })).status === 422);
  var indd = await call('POST', '/api/books/idml', Buffer.from('x'), { headers: { 'x-file-name': 'Book.indd' } });
  check('9.6 .indd: the reply the screen reads (isNativeIndd), saying how to export IDML', indd.status === 200 && indd.json.isNativeIndd === true && /InDesign Markup \(IDML\)/.test(indd.json.guidance));
  check('9.7 CMYK to screen colour', T.cmykHex(0, 0, 0, 100) === '#000000' && T.cmykHex(0, 0, 0, 0) === '#FFFFFF' && T.cmykHex(100, 0, 0, 0) === '#00FFFF');

  /* ---------- 10 the AI steps ---------- */
  var P = AI._test.PROMPTS, C = AI._test.CLEAN;
  check('10.1 seven steps, each with its own model profile', AI.NAMES.length === 7 && AI.NAMES.every(function (n) { return /^books-/.test(AI.ROUTE[n]); }));
  var LLM_SRC = fs.readFileSync(path.join(__dirname, 'llm.js'), 'utf8'), HTTP_SRC = fs.readFileSync(path.join(__dirname, 'http.js'), 'utf8');
  check('10.2 …in lib/llm.js (Claude, Gemini as fallback; no "gemini-4-hydrogen") and rate-limited per person', AI.NAMES.every(function (n) {
    return LLM_SRC.indexOf("'" + AI.ROUTE[n] + "': { model:") !== -1 && HTTP_SRC.indexOf("'POST /api/books/ai/" + n + "': { max:") !== -1; }) && !/['"]gemini-4-hydrogen/.test(LLM_SRC + fs.readFileSync(path.join(__dirname, 'books-ai.js'), 'utf8')));
  check('10.3 copy-writing steps are told never to invent facts or figures', ['editorial-assistant', 'generate-publication-template', 'generate-infographic', 'auto-flow-data'].every(function (n) {
    var r = P[n]({ prompt: 'x', rawData: 'y', pagesSchema: [] }); return /Never invent facts, statistics/.test(r.prompt); }));
  check('10.4 a request with nothing to work on is refused before any call', P['editorial-assistant']({}).status === 400 && P['generate-infographic']({ prompt: ' ' }).status === 400 &&
    P['auto-flow-data']({}).status === 400 && P['analyze-template']({ files: [] }).status === 400);
  var flowBig = P['auto-flow-data']({ rawData: new Array(160001).join('a') });
  check('10.5 a manuscript too long for one Auto-Flow: 413 asking to flow it in parts', flowBig.status === 413 && /in parts/.test(flowBig.error));
  var refs = P['analyze-template']({ files: [{ mimeType: 'image/jpeg', base64: 'aGk=' }, { mimeType: 'application/pdf', base64: 'aGk=' }, { mimeType: 'image/tiff', base64: 'aGk=' }] });
  check('10.6 reference pages go to the model as pictures and PDFs; what it cannot read is counted, not sent', refs.opts.images.length === 1 && refs.opts.inlineFiles.length === 1 && refs.skipped === 1);
  var schema = { pagesSchema: [{ pageId: 'p1', textFrames: [{ elementId: 'e1' }], imageFrames: [{ elementId: 'i1' }], infographicFrames: [] }] };
  var flow = C['auto-flow-data']({ textUpdates: [{ pageId: 'p1', elementId: 'e1', text: 'ok' }, { pageId: 'p1', elementId: 'made-up', text: 'x' }],
    imageUpdates: [{ pageId: 'p9', elementId: 'i1', placeholderTitle: 'x' }], infographicUpdates: [], additionalPages: [] }, schema);
  check('10.7 Auto-Flow keeps only frames the book has (a made-up id never reaches it)', flow.textUpdates.length === 1 && flow.textUpdates[0].elementId === 'e1' && flow.imageUpdates.length === 0, flow);
  var rec = C['recommend-templates']({ bookRecommendations: [{ templateId: 'tpl_a', reason: 'r' }, { templateId: 'invented', reason: 'r' }], infographicRecommendations: [] },
    { availableBookTemplates: [{ id: 'tpl_a' }], availableInfographics: [] });
  check('10.8 template picks only from the lists sent', rec.bookRecommendations.length === 1 && rec.bookRecommendations[0].templateId === 'tpl_a');
  var asst = C['editorial-assistant']({ summary: 's', suggestions: [{ id: '1', category: 'c', title: 't', rationale: 'r', actionType: 'a', rewrittenText: 'NEW COPY' }] }, { mode: 'layout' });
  var fit = C['editorial-assistant']({ summary: 's', suggestions: [{ id: '1', category: 'c', title: 't', rationale: 'r', actionType: 'a', rewrittenText: 'NEW COPY' }] }, { mode: 'copy_fit' });
  check('10.9 rewritten copy only when the person asked for it (copy_fit)', !('rewrittenText' in asst.suggestions[0]) && fit.suggestions[0].rewrittenText === 'NEW COPY');
  var an = C['analyze-template']({ colourPalette: { paper: 'white', ink: '#123', primaryAccent: '#C6A26B' }, typography: { displayFont: 'Playfair Display"><script>' }, gridSystem: { columns: 99 } });
  check('10.10 the design read from a reference: colours as #RRGGBB or a default, font names cleaned, numbers in range',
    an.report.colourPalette.paper === '#F7F4EE' && an.report.colourPalette.ink === '#112233' && an.report.typography.displayFont === 'Playfair Displayscript' &&
    an.report.gridSystem.columns === 24 && an.report.pageSize.widthMm === 240, an.report);
  var info = C['generate-infographic']({ variant: 'not_a_variant', items: [{ label: 'A', value: '12' }, { value: 3 }] }, { preferredVariant: 'auto' });
  check('10.11 an infographic: a known chart type, items with a label and a number', info.variant === 'kpi_grid' && info.items.length === 1 && info.items[0].value === 12, info);

  AI_ASKS = [];
  AI_ANSWER = { parsed: { pairings: [{ name: 'Classic', rationale: 'r', displayFont: 'Bodoni Moda', headingFont: 'Lora', secondaryFont: 'DM Sans', bodyFont: 'Lora', captionFont: 'DM Sans', quoteFont: 'Lora', numericalFont: 'DM Sans' }] }, provider: 'claude' };
  var ai1 = await call('POST', '/api/books/ai/typography-pairing', { style: 'Classic editorial' }, { headers: { 'x-book-id': 'qa_book_1' } });
  check('10.12 a step through the router: the cleaned answer, the model layer\'s route', ai1.status === 200 && ai1.json.pairings[0].displayFont === 'Bodoni Moda' && AI_ASKS[0].opts.route === 'books-typography', ai1.json);
  check('10.13 …its cost counted against the open book', DOCS['books/qa_book_1'].aiUsage && DOCS['books/qa_book_1'].aiUsage.calls === 1 && DOCS['books/qa_book_1'].aiUsage.outputTokens === 50, DOCS['books/qa_book_1'].aiUsage);
  AI_ANSWER = { error: 'ETB2B AI is busy. Please try again in a minute.', code: 'ai-quota', status: 429, retryable: true };
  var ai2 = await call('POST', '/api/books/ai/typography-pairing', { style: 'x' });
  check('10.14 a failed call: the model layer\'s status and sentence', ai2.status === 429 && ai2.json.code === 'ai-quota' && ai2.json.retryable === true && /busy/.test(ai2.json.error), ai2.json);
  check('10.15 an unknown step: 404; anyone without Books: 403 before any call', (await call('POST', '/api/books/ai/write-anything', {})).status === 404 &&
    (await call('POST', '/api/books/ai/typography-pairing', { style: 'x' }, { token: EDITOR })).status === 403 && AI_ASKS.length === 2);

  /* ---------- 11 wiring ---------- */
  var access = require('./access');
  check('11.1 the built editor is served (books/), its source never is (books-app/)', access.isServableFile('books/app.js') && access.isServableFile('books/app.css') &&
    access.isServableFile('books/samples/editorial_arch_courtyard_1795191081985.jpg') && access.isServableFile('books.html') &&
    !access.isServableFile('books-app/src/App.tsx') && !access.isServableFile('books-app/package.json') && !access.isServableFile('books-app/build.mjs'));
  var API_SRC = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
  check('11.2 /api/books/ goes to lib/api-books.js, which checks the caller on every route', /if \(urlPath\.indexOf\('\/api\/books\/'\) === 0\) return booksRoute\(req, res\);/.test(API_SRC) &&
    /H\.requireMember\(req, res, function \(fb, decoded\) \{\s*var role = booksRole\(decoded\);/.test(fs.readFileSync(path.join(__dirname, 'api-books.js'), 'utf8')));
  var PAGE = fs.readFileSync(path.join(ROOT, 'books.html'), 'utf8');
  check('11.3 books.html: signed in by auth.js, PDF reader, the built editor; not indexed', /<script src="auth\.js"><\/script>/.test(PAGE) && /<script src="pdf-reader\.js"><\/script>/.test(PAGE) &&
    /<script src="books\/app\.js" defer><\/script>/.test(PAGE) && /<link rel="stylesheet" href="books\/app\.css">/.test(PAGE) && /<meta name="robots" content="noindex">/.test(PAGE));
  var LIST = fs.readFileSync(path.join(ROOT, 'Event_Listing.html'), 'utf8');
  check('11.4 the dashboard menu shows Books to admins only', /\(booksOpen \? '<a href="books\.html">' \+ book \+ ' Books<\/a>' : ''\)/.test(LIST) && /a\.you\.role === 'admin' && !booksOpen/.test(LIST));
  check('11.5 nothing of the AI Studio export\'s server came along', !fs.existsSync(path.join(ROOT, 'books-app', 'server.ts')) && !fs.existsSync(path.join(ROOT, 'books-app', 'src', 'services', 'firebase.ts')) &&
    !fs.existsSync(path.join(ROOT, 'books-app', 'src', 'components', 'TopToolbar.tsx')));

  process.stdout.write('api-books: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stdout.write('api-books: crashed — ' + (e && e.stack || e) + '\n'); process.exit(1); });
