// node functions/lib/api-books.test.js — Books (BOOKSTUDIO, the owner's coffee table book editor, 26 Nov 2026), Phases 1
// and 2: the server that replaces the AI Studio export's open Express server (docs/bookstudio/PLAN.md).
// Checks: a book is split into parts and put back exactly; only admins get in; a save based on an old revision is
// refused and nothing is lost; a save writes only what changed and removes what nothing points to; delete, status,
// versions, templates (the date first kept never changes), font collections (each person's own); photos (kind from
// their bytes, sizes, the copies, private, cached); manuscripts (Word paragraphs and headings, RTF, CSV, a PDF's text);
// IDML; the AI steps (what they are told, what is kept of their answers, failures); the wiring (router, served files,
// rate limits, models, the page, the menu link). Phase 2 (12–16): the Books role from Settings › Access (Designer,
// Content editor, none) on every route; a Content editor's save refused whole, writing nothing, for any design change;
// who is here; deleted pages kept and restored; the activity log and its 10-minute folding. Phase 3 (17): "Edit with AI"
// on a text frame (edit-text) for both roles — what it is told, what is kept of its answer, refusals.
// Firestore and Storage are in-memory; the AI is a stub. No network.
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
var DOCS = {}, FILES = {}, WRITES = [], AUTO = 0, FAIL_SET = null;
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
    set: function (d) { if (FAIL_SET && FAIL_SET.test(p)) return Promise.reject(new Error('UNAVAILABLE (test)')); DOCS[p] = clone(d); WRITES.push('set ' + p); return Promise.resolve(); },
    create: function (d) { if (DOCS[p]) { var e = new Error('ALREADY_EXISTS'); e.code = 6; return Promise.reject(e); } DOCS[p] = clone(d); return Promise.resolve(); },
    update: function (d) { if (!DOCS[p]) return Promise.reject(new Error('NOT_FOUND')); applyUpdate(p, d); WRITES.push('update ' + p); return Promise.resolve(); },
    delete: function () { delete DOCS[p]; WRITES.push('delete ' + p); return Promise.resolve(); },
    collection: function (n) { return colOf(p + '/' + n); } };
}
function query(p, filters, order, lim) {
  return {
    select: function () { return query(p, filters, order, lim); },
    limit: function (n) { return query(p, filters, order, n); },
    where: function (f, op, v) { return query(p, filters.concat([[f, v, op]]), order, lim); },
    orderBy: function (f, dir) { return query(p, filters, [f, dir], lim); },
    get: function () {
      var depth = p.split('/').length + 1;
      var docs = Object.keys(DOCS).filter(function (k) { return k.indexOf(p + '/') === 0 && k.split('/').length === depth; })
        .filter(function (k) { return filters.every(function (f) { var x = DOCS[k][f[0]]; return f[2] === '>=' ? x >= f[1] : f[2] === '<=' ? x <= f[1] : f[2] === '>' ? x > f[1] : f[2] === '<' ? x < f[1] : x === f[1]; }); }).map(snapOf);
      if (order) docs.sort(function (a, b) { var x = String(a.data()[order[0]]), y = String(b.data()[order[0]]); return order[1] === 'desc' ? y.localeCompare(x) : x.localeCompare(y); });
      if (lim) docs = docs.slice(0, lim);
      return Promise.resolve({ docs: docs, size: docs.length });
    }
  };
}
function colOf(p) {
  var q = query(p, [], null, 0);
  q.doc = function (id) { return refOf(p + '/' + (id === undefined ? 'auto' + String(++AUTO).padStart(6, '0') : id)); };
  q.add = function (d) { var r = q.doc(); return r.set(d).then(function () { return r; }); };
  return q;
}
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
var AC_FORGET = function () { require('./access-control').forget(); };

var ADMIN = 'sachitanand.rai', EDITOR = 'someone';
/* Phase 2's people: a Designer who is no admin, a Content editor who is an events Viewer (Books has its own role),
   one who works in one portal, someone listed with no Books, and a blocked person whose Books role means nothing */
var DESIGNER = 'des.igner', CONTENT = 'con.tent', CONTENT2 = 'con.tent2', NOBOOKS = 'no.books';
DOCS['config/access'] = { defaultRole: 'editor', members: {
  'sachitanand.rai@timesinternet.in': { role: 'admin', portals: ['*'] },
  'other.person@timesinternet.in': { role: 'admin', portals: ['*'] },
  'other@timesinternet.in': { role: 'admin', portals: ['*'] },
  'des.igner@timesinternet.in': { role: 'editor', portals: ['*'], books: 'designer' },
  'con.tent@timesinternet.in': { role: 'viewer', portals: ['*'], books: 'content' },
  'con.tent2@timesinternet.in': { role: 'editor', portals: ['cio'], books: 'content' },
  'no.books@timesinternet.in': { role: 'approver', portals: ['*'] },
  'gone.designer@timesinternet.in': { role: 'blocked', books: 'designer' } } };
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
  check('2.1 an admin gets in, as Designer', me.status === 200 && me.json.role === 'designer' && me.json.canDesign === true && me.json.email === ADMIN + '@timesinternet.in', me);
  var ed = await call('GET', '/api/books/list', null, { token: EDITOR });
  check('2.2 a company account not on the list has no Books: refused with the sentence', ed.status === 403 && ed.json.code === 'no-books' && ed.json.error === T.NOT_OPEN &&
    T.NOT_OPEN === 'You don\'t have access to Books. Ask an admin to give you the Designer or Content editor role in Settings › Access.', ed.json);
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
  check('10.1 eight steps (Phase 3 added edit-text), each with its own model profile', AI.NAMES.length === 8 && AI.NAMES.indexOf('edit-text') !== -1 && AI.NAMES.every(function (n) { return /^books-/.test(AI.ROUTE[n]); }));
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

  /* ================= Phase 2 (the owner, 26 Nov 2026): roles, who is here, deleted pages, the activity log ================= */
  function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 5); }); }
  function under(prefix) { var out = {}; Object.keys(DOCS).sort().forEach(function (k) { if (k.indexOf(prefix) === 0) out[k] = DOCS[k]; }); return JSON.stringify(out); }
  function logOf(id) {
    return Object.keys(DOCS).filter(function (k) { return k.indexOf('books/' + id + '/log/') === 0; }).map(function (k) { return Object.assign({ path: k }, DOCS[k]); })
      .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)) || (b.path < a.path ? -1 : 1); });
  }
  function revOf(id) { return (DOCS['books/' + id] || {}).rev; }
  function loaded(id, who) { return call('GET', '/api/books/book?id=' + id, null, { token: who || ADMIN }).then(function (r) { return r.json; }); }
  /* a book with a master, a text page, a photo, an infographic and a rule */
  function richBook(id) {
    var b = book(id);
    b.contentSections = [{ id: 's1', title: 'S1', kind: 'body', body: 'Body', orderIndex: 0 }];
    b.masterPages = [{ id: 'm1', name: 'Text page', role: 'editorial_text', backgroundColor: '#fff', elements: [
      { id: 'm1_t', type: 'text', name: 'Body', xMm: 10, yMm: 10, widthMm: 100, heightMm: 40, text: '' }] }];
    b.pages = [page('p1', 'Cover', ['Forms of Light']), page('p2', 'Essay', ['One two', 'Three']),
      { id: 'p3', orderIndex: 2, label: 'Gallery', role: 'image_led', backgroundColor: '#fff', masterPageId: 'm1', elements: [
        { id: 'p3_i', type: 'image', name: 'Photo', xMm: 0, yMm: 0, widthMm: 240, heightMm: 300, rotation: 0, opacity: 1, zIndex: 1, locked: false, hidden: false,
          image: { src: '/a.jpg', alt: '', fit: 'cover', zoom: 1, focalX: 50, focalY: 50, brightness: 100, grayscale: 0, borderRadiusMm: 0, captionText: 'At dusk' } },
        { id: 'p3_g', type: 'infographic', name: 'Chart', xMm: 10, yMm: 200, widthMm: 100, heightMm: 80, zIndex: 2,
          infographic: { templateId: 't', variant: 'kpi_grid', title: 'Visitors', subtitle: '', categoryLabel: '', sourceNote: '', fontFamily: 'Lora', backgroundColor: '#fff',
            textColor: '#000', accentColor: '#c00', secondaryColor: '#999', items: [{ id: 'i1', label: 'A', value: 1 }], showLegend: true, showValues: true } },
        { id: 'p3_s', type: 'shape', name: 'Rule', xMm: 10, yMm: 190, widthMm: 100, heightMm: 1, zIndex: 3, shape: { shapeKind: 'rule', fill: '#000', stroke: '#000', strokeWidthMm: 0.3, cornerRadiusMm: 0 } }] }];
    return b;
  }

  /* ---------- 12 the Books role on every route ---------- */
  AC_FORGET();
  var meD = await call('GET', '/api/books/me', null, { token: DESIGNER }), meC = await call('GET', '/api/books/me', null, { token: CONTENT });
  check('12.1 /me says the Books role: a Designer who is no admin, a Content editor (an events Viewer)', meD.status === 200 && meD.json.role === 'designer' && meD.json.canDesign === true &&
    meC.status === 200 && meC.json.role === 'content' && meC.json.canDesign === false && meC.json.email === CONTENT + '@timesinternet.in', [meD.json, meC.json]);
  var nb = await call('GET', '/api/books/me', null, { token: NOBOOKS }), gone = await call('GET', '/api/books/me', null, { token: 'gone.designer' });
  check('12.2 someone on the list without a Books role (an Approver): 403 no-books with the sentence; a blocked person: no access at all', nb.status === 403 && nb.json.code === 'no-books' &&
    nb.json.error === T.NOT_OPEN && gone.status === 403 && gone.json.code === 'no-access', [nb.json, gone.json]);
  var everyRoute = Object.keys(T.ROUTES).concat(['GET /api/books/asset/*']).concat(AI.NAMES.map(function (n) { return 'POST /api/books/ai/' + n; }));
  check('12.3 every route is named either a Content editor\'s or a Designer\'s, never both, and nothing named is not a route', everyRoute.every(function (k) { return !!T.CONTENT_ROUTES[k] !== !!T.DESIGNER_ACTIONS[k]; }) &&
    Object.keys(T.CONTENT_ROUTES).concat(Object.keys(T.DESIGNER_ACTIONS)).every(function (k) { return everyRoute.indexOf(k) !== -1; }), everyRoute.filter(function (k) { return !!T.CONTENT_ROUTES[k] === !!T.DESIGNER_ACTIONS[k]; }));
  check('12.4 the Designer\'s routes are the owner\'s list', JSON.stringify(Object.keys(T.DESIGNER_ACTIONS).sort()) === JSON.stringify(['DELETE /api/books/book', 'POST /api/books/status', 'PUT /api/books/template',
    'DELETE /api/books/template', 'POST /api/books/idml', 'POST /api/books/ai/analyze-template', 'POST /api/books/ai/typography-pairing', 'POST /api/books/ai/recommend-templates',
    'POST /api/books/ai/generate-publication-template'].sort()), Object.keys(T.DESIGNER_ACTIONS));
  var rb = richBook('qa_roles');
  var mk = await call('PUT', '/api/books/book', { book: rb, baseRev: null }, { token: DESIGNER });
  check('12.5 a Designer who is no admin starts a book', mk.status === 200 && mk.json.rev === 1 && DOCS['books/qa_roles'].createdBy === DESIGNER + '@timesinternet.in', mk.json);
  var mkC = await call('PUT', '/api/books/book', { book: richBook('qa_by_content'), baseRev: null }, { token: CONTENT });
  check('12.6 a Content editor cannot start one: 403 designer-only, nothing written', mkC.status === 403 && mkC.json.code === 'designer-only' && mkC.json.error === 'Only a Designer can start a new book.' &&
    !Object.keys(DOCS).some(function (k) { return k.indexOf('books/qa_by_content') === 0; }), mkC.json);
  await call('PUT', '/api/books/template', { template: { id: 'ct_keep', templateKind: 'page', title: 'Keep', payload: {} } }, { token: DESIGNER });
  /* the Designer's routes, refused to a Content editor with the action in words, before anything is written or asked */
  var askedBefore = AI_ASKS.length;
  var idmlZip = await idml.generateAsync({ type: 'nodebuffer' });
  var refusedC = [
    ['DELETE', '/api/books/book?id=qa_roles', null, 'delete a book'],
    ['POST', '/api/books/status', { id: 'qa_roles', status: 'archived' }, 'change a book\'s status'],
    ['PUT', '/api/books/template', { template: { id: 'ct_c', templateKind: 'page', title: 'Mine', payload: {} } }, 'save a template'],
    ['DELETE', '/api/books/template?id=ct_keep', null, 'delete a template'],
    ['POST', '/api/books/idml', idmlZip, 'import an InDesign file', { 'x-file-name': 'Monograph.idml' }],
    ['POST', '/api/books/ai/analyze-template', { files: [{ mimeType: 'image/jpeg', base64: 'aGk=' }] }, 'have AI read the design of a reference book'],
    ['POST', '/api/books/ai/typography-pairing', { style: 'x' }, 'have AI suggest font pairings'],
    ['POST', '/api/books/ai/recommend-templates', { availableBookTemplates: [] }, 'have AI suggest templates'],
    ['POST', '/api/books/ai/generate-publication-template', { prompt: 'x' }, 'have AI make a book design']];
  var docsBefore = JSON.stringify(DOCS);
  for (var rc of refusedC) {
    var rr = await call(rc[0], rc[1], rc[2], { token: CONTENT, headers: rc[4] });
    check('12.7 a Content editor: ' + rc[0] + ' ' + rc[1].split('?')[0] + ' — 403 "Only a Designer can ' + rc[3] + '."', rr.status === 403 && rr.json.code === 'designer-only' && rr.json.error === 'Only a Designer can ' + rc[3] + '.', rr.json);
  }
  check('12.8 …and none of them wrote anything or asked the AI', JSON.stringify(DOCS) === docsBefore && AI_ASKS.length === askedBefore);
  /* the routes both roles use: never refused to a Content editor for the role */
  AI_ANSWER = { parsed: { summary: 's', suggestions: [] }, provider: 'claude' };
  var tinyJpg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#335577' } }).jpeg().toBuffer();
  var realFetch = global.fetch;
  global.fetch = function () { return Promise.reject(new Error('offline (test)')); };
  var bothC = [
    ['GET', '/api/books/me'], ['GET', '/api/books/list'], ['GET', '/api/books/book?id=qa_roles'], ['GET', '/api/books/versions?id=qa_roles'],
    ['POST', '/api/books/versions', { bookId: 'qa_roles', version: { id: 'ver_c', label: 'By content', snapshot: { pages: [] } } }], ['GET', '/api/books/version?id=qa_roles&versionId=ver_c'],
    ['GET', '/api/books/templates'], ['GET', '/api/books/font-collections'], ['PUT', '/api/books/font-collection', { collection: { id: 'mine', name: 'Mine', fonts: ['Lora'] } }],
    ['POST', '/api/books/asset', tinyJpg, { 'x-file-name': 'c.jpg' }], ['POST', '/api/books/manuscript', Buffer.from('A heading\n\nA paragraph.'), { 'x-file-name': 'm.txt' }],
    ['GET', '/api/books/fonts'], ['POST', '/api/books/ai/editorial-assistant', { prompt: 'tighten this', mode: 'copy_fit' }],
    ['POST', '/api/books/ai/generate-infographic', { prompt: 'visitors by year' }], ['POST', '/api/books/ai/auto-flow-data', { rawData: 'Some text', pagesSchema: [] }],
    ['POST', '/api/books/presence', { bookId: 'qa_roles', pageId: 'p1' }], ['GET', '/api/books/trash?id=qa_roles'], ['GET', '/api/books/log?id=qa_roles'],
    ['POST', '/api/books/restore-page', { bookId: 'qa_roles', pageId: 'nope', baseRev: 1 }]];
  var asset = null;
  for (var who of [CONTENT, DESIGNER]) {
    for (var bc of bothC) {
      var br = await call(bc[0], bc[1], bc[2] === undefined ? null : bc[2], { token: who, headers: bc[3] });
      if (bc[1] === '/api/books/asset' && who === CONTENT) asset = br.json && br.json.asset;
      check('12.9 ' + (who === CONTENT ? 'a Content editor' : 'a Designer who is no admin') + ' may use ' + bc[0] + ' ' + bc[1].split('?')[0],
        br.status !== 403 && br.status !== 401 && br.status < 500, [who, br.status, br.json]);
    }
  }
  global.fetch = realFetch;
  check('12.10 …a photo it uploaded is served to it', !!asset && (await call('GET', asset.thumbUrl, null, { token: CONTENT })).status === 200);
  /* the same Designer routes, for a Designer who is no admin */
  AI_ANSWER = { parsed: { pairings: [{ name: 'Classic', rationale: 'r', displayFont: 'Bodoni Moda', headingFont: 'Lora', secondaryFont: 'DM Sans', bodyFont: 'Lora', captionFont: 'DM Sans', quoteFont: 'Lora', numericalFont: 'DM Sans' }] }, provider: 'claude' };
  var okD = [await call('POST', '/api/books/status', { id: 'qa_roles', status: 'in_review' }, { token: DESIGNER }),
    await call('PUT', '/api/books/template', { template: { id: 'ct_d', templateKind: 'page', title: 'D', payload: {} } }, { token: DESIGNER }),
    await call('DELETE', '/api/books/template?id=ct_d', null, { token: DESIGNER }),
    await call('POST', '/api/books/idml', idmlZip, { token: DESIGNER, headers: { 'x-file-name': 'Monograph.idml' } }),
    await call('POST', '/api/books/ai/typography-pairing', { style: 'Classic' }, { token: DESIGNER })];
  check('12.11 a Designer who is no admin may do each of them', okD.every(function (r) { return r.status === 200; }) && DOCS['books/qa_roles'].status === 'in_review', okD.map(function (r) { return [r.status, r.json && r.json.error]; }));
  await call('PUT', '/api/books/book', { book: Object.assign(book('qa_to_delete'), { name: 'To delete' }), baseRev: null }, { token: DESIGNER });
  var delD = await call('DELETE', '/api/books/book?id=qa_to_delete', null, { token: DESIGNER });
  check('12.12 …and delete a book', delD.status === 200 && !!DOCS['books/qa_to_delete'].deletedAt);

  /* ---------- 13 a Content editor's save: content yes, design never (refused whole, nothing written) ---------- */
  var stored = (await loaded('qa_roles', CONTENT)).book;
  async function contentSave(change, who) {
    await tick();
    var now = (await loaded('qa_roles', who || CONTENT));
    var b = clone(now.book); change(b);
    var before = under('books/qa_roles');
    var r = await call('PUT', '/api/books/book', { book: b, baseRev: now.rev }, { token: who || CONTENT });
    await tick();
    return { r: r, untouched: under('books/qa_roles') === before, rev: now.rev };
  }
  var DESIGN = [
    ['the page size', function (b) { b.dimensions.widthMm = 250; }, /the page size changed/],
    ['the design system (colours)', function (b) { b.designSystem.colors.paper = '#000000'; }, /the design system/],
    ['a master page\'s frame', function (b) { b.masterPages[0].elements[0].xMm = 12; }, /the master pages changed/],
    ['a master page added', function (b) { b.masterPages.push({ id: 'm2', name: 'New', elements: [] }); }, /the master pages changed/],
    ['the master pages removed', function (b) { b.masterPages = []; }, /the master pages changed/],
    ['the print settings', function (b) { b.printSettings.bleedMm = 5; }, /the print settings changed/],
    ['the saved page sizes', function (b) { b.customDimensionPresets = [{ id: 'x', name: 'X', widthMm: 1, heightMm: 1 }]; }, /the saved page sizes changed/],
    ['the approved template design', function (b) { b.templateReport = { id: 'r', approved: true }; }, /the approved template design changed/],
    ['a page\'s background', function (b) { b.pages[0].backgroundColor = '#eeeeee'; }, /"Cover": its background changed/],
    ['a page\'s layout type', function (b) { b.pages[0].role = 'front_cover'; }, /its layout type changed/],
    ['a page\'s master', function (b) { b.pages[2].masterPageId = 'm9'; }, /its master page changed/],
    ['a page\'s size', function (b) { b.pages[0].dimensionsOverride = { widthMm: 100, heightMm: 100 }; }, /its size changed/],
    ['a page detached from its master', function (b) { b.pages[2].detachedFromMaster = true; }, /its master link changed/],
    ['a frame\'s position', function (b) { b.pages[1].elements[0].xMm = 11; }, /frame "Body" — its position changed/],
    ['a frame\'s size', function (b) { b.pages[1].elements[0].heightMm = 41; }, /its size changed/],
    ['a frame\'s rotation', function (b) { b.pages[2].elements[0].rotation = 5; }, /its rotation changed/],
    ['a frame\'s opacity', function (b) { b.pages[2].elements[0].opacity = 0.5; }, /its opacity changed/],
    ['a frame\'s layer', function (b) { b.pages[2].elements[0].zIndex = 9; }, /its layer order changed/],
    ['a frame locked', function (b) { b.pages[2].elements[0].locked = true; }, /its lock changed/],
    ['a frame hidden', function (b) { b.pages[2].elements[0].hidden = true; }, /its visibility changed/],
    ['frames grouped', function (b) { b.pages[2].elements[0].groupId = 'g1'; }, /its grouping changed/],
    ['a frame renamed', function (b) { b.pages[2].elements[0].name = 'Hero'; }, /its name changed/],
    ['a frame\'s kind', function (b) { b.pages[1].elements[0].type = 'image'; }, /its kind changed/],
    ['a frame\'s text role', function (b) { b.pages[1].elements[0].textRole = 'heading'; }, /its text role changed/],
    ['a frame\'s text style', function (b) { b.pages[1].elements[0].textStyle = { fontFamily: 'Syne', fontSizePt: 30 }; }, /its text style changed/],
    ['a shape\'s fill', function (b) { b.pages[2].elements[2].shape.fill = '#ff0000'; }, /its shape changed/],
    ['a photo\'s brightness', function (b) { b.pages[2].elements[0].image.brightness = 80; }, /its photo effects changed/],
    ['a photo made greyscale', function (b) { b.pages[2].elements[0].image.grayscale = 100; }, /its photo effects changed/],
    ['a photo\'s rounded corners', function (b) { b.pages[2].elements[0].image.borderRadiusMm = 4; }, /its photo effects changed/],
    ['an infographic\'s colours', function (b) { b.pages[2].elements[1].infographic.accentColor = '#0000ff'; }, /its colours or font changed/],
    ['an infographic\'s font', function (b) { b.pages[2].elements[1].infographic.fontFamily = 'Syne'; }, /its colours or font changed/],
    ['a field nobody has named yet, on a frame', function (b) { b.pages[1].elements[0].glow = 3; }, /its glow changed/],
    ['a frame added to a page', function (b) { b.pages[1].elements.push({ id: 'p2_new', type: 'text', name: 'Body', xMm: 10, yMm: 10, widthMm: 100, heightMm: 40, text: 'x' }); }, /a frame "Body" was added/],
    ['a frame removed from a page', function (b) { b.pages[2].elements.pop(); }, /frame "Rule" was removed/],
    ['a new page with a frame the book does not have', function (b) { b.pages.push({ id: 'p9', label: 'New', role: 'editorial_text', backgroundColor: '#fff', elements: [{ id: 'x', type: 'text', name: 'Body', xMm: 33, yMm: 10, widthMm: 100, heightMm: 40, text: '' }] }); }, /new "New" has a frame "Body" that is not one of the book's layouts/],
    ['a new page with a background the book does not have', function (b) { b.pages.push({ id: 'p9', label: 'New', role: 'editorial_text', backgroundColor: '#123456', elements: [] }); }, /has a background, size or master page the book's layouts do not have/]];
  for (var dc of DESIGN) {
    var res1 = await contentSave(dc[1]);
    check('13.1 a Content editor\'s design change — ' + dc[0] + ': 403 design-only, the reason given, nothing written', res1.r.status === 403 && res1.r.json.code === 'design-only' &&
      res1.r.json.error.indexOf('Only a Designer can change the design: ') === 0 && Array.isArray(res1.r.json.changes) && res1.r.json.changes.some(function (c) { return dc[2].test(c); }) &&
      res1.untouched && revOf('qa_roles') === res1.rev, [res1.r.status, res1.r.json]);
  }
  var many = await contentSave(function (b) { b.dimensions.widthMm = 251; b.pages[0].backgroundColor = '#111'; b.pages[1].elements[0].xMm = 1; b.pages[2].elements[0].rotation = 9; b.pages[1].elements[0].text = 'and some text'; });
  check('13.2 several design changes with a text change: the whole save refused, every reason listed, the first three in the sentence', many.r.status === 403 && many.r.json.changes.length === 4 &&
    /: the page size changed; "Cover": its background changed; "Essay": frame "Body" — its position changed \(and 1 more\)\.$/.test(many.r.json.error) && many.untouched, many.r.json);
  var st1 = await contentSave(function (b) { b.status = 'archived'; });
  check('13.3 the status through a save: refused too (POST status is a Designer\'s), nothing written', st1.r.status === 403 && st1.r.json.code === 'designer-only' &&
    st1.r.json.error === 'Only a Designer can change a book\'s status.' && st1.untouched, st1.r.json);
  var staleDesign = await (async function () { var b = clone(stored); b.dimensions.widthMm = 260; var before = under('books/qa_roles'); var r = await call('PUT', '/api/books/book', { book: b, baseRev: 0 }, { token: CONTENT }); await tick(); return { r: r, untouched: under('books/qa_roles') === before }; })();
  check('13.4 a stale save with a design change: refused (409 stale or 403), nothing written', (staleDesign.r.status === 409 || staleDesign.r.status === 403) && staleDesign.untouched, staleDesign.r.json);
  var CONTENT_OK = [
    ['text in a frame', function (b) { b.pages[1].elements[0].text = 'A new first paragraph.'; }],
    ['the manuscript section a frame shows', function (b) { b.pages[1].elements[1].contentSectionId = 's1'; }],
    ['the photo in a frame, and where it sits', function (b) { Object.assign(b.pages[2].elements[0].image, { src: '/b.jpg', assetId: 'as_x', zoom: 1.4, focalX: 30, focalY: 70, fit: 'contain', alt: 'Courtyard', captionText: 'At dawn' }); }],
    ['an infographic\'s data, labels, title and chart type', function (b) { Object.assign(b.pages[2].elements[1].infographic, { variant: 'horizontal_bars', title: 'Guests', items: [{ id: 'i1', label: 'B', value: 7 }], showLegend: false }); }],
    ['a page\'s label and chapter', function (b) { b.pages[0].label = 'Front'; b.pages[0].chapterId = 'ch1'; }],
    ['the book\'s name, subtitle, category, chapters and cover', function (b) { Object.assign(b, { name: 'Forms of Light II', subtitle: 'New', category: 'Art', chapters: [{ id: 'ch1', number: 1, title: 'One', orderIndex: 0 }], coverThumbnail: '/books/samples/y.jpg' }); }],
    ['the manuscript and the photo library', function (b) { b.contentSections.push({ id: 's2', title: 'S2', kind: 'body', body: 'More', orderIndex: 1 }); b.imageAssets.push({ id: 'a2', name: 'q.jpg', url: '/q.jpg', widthPx: 1, heightPx: 1, mimeType: 'image/jpeg', category: 'x', tags: [], uploadedAt: '' }); }],
    ['pages reordered', function (b) { b.pages = [b.pages[1], b.pages[0], b.pages[2]]; b.pages.forEach(function (p, i) { p.orderIndex = i; }); }],
    ['a new page made from the master page', function (b) { b.pages.push({ id: 'p_m', orderIndex: 3, label: 'From master', role: 'editorial_text', masterPageId: 'm1', backgroundColor: '#fff',
      elements: [Object.assign(clone(b.masterPages[0].elements[0]), { id: 'el_m_1', masterElementId: 'm1_t', text: 'Poured in' })] }); }],
    ['a new page copied from one of the book\'s pages', function (b) { var c = clone(b.pages.filter(function (p) { return p.id === 'p3'; })[0]); c.id = 'p3_copy'; c.label = 'Gallery 2';
      c.elements.forEach(function (el, i) { el.id = 'c' + i; el.zIndex = 10 + i; }); c.elements[0].image.src = '/c.jpg'; b.pages.push(c); }],
    ['a page deleted', function (b) { b.pages = b.pages.filter(function (p) { return p.id !== 'p_m'; }); }],
    ['a field the server never keeps', function (b) { b.ownerId = 'someone'; b.somethingNew = { x: 1 }; }]];
  for (var cc of CONTENT_OK) {
    var res2 = await contentSave(cc[1]);
    check('13.5 a Content editor\'s content change — ' + cc[0] + ': saved', res2.r.status === 200 && res2.r.json.rev === res2.rev + 1 && revOf('qa_roles') === res2.rev + 1, [res2.r.status, res2.r.json]);
  }
  var afterContent = (await loaded('qa_roles', CONTENT)).book;
  check('13.6 …and what was saved is there (the copied page, the new photo; the field the server never keeps is not)', afterContent.pages.some(function (p) { return p.id === 'p3_copy' && p.elements[0].image.src === '/c.jpg'; }) &&
    !afterContent.pages.some(function (p) { return p.id === 'p_m'; }) && afterContent.name === 'Forms of Light II' && !('somethingNew' in afterContent), afterContent.pages.map(function (p) { return p.id; }));
  var resC2 = await contentSave(function (b) { b.pages[0].elements[0].text = 'From one portal'; }, CONTENT2);
  check('13.7 a Content editor who works in one portal may save too (Books is not tied to events)', resC2.r.status === 200, resC2.r.json);
  var resD = await contentSave(function (b) { b.dimensions.widthMm = 250; b.pages[0].backgroundColor = '#fafafa'; }, DESIGNER);
  check('13.8 a Designer\'s design change: saved', resD.r.status === 200 && JSON.parse(DOCS['books/qa_roles'].core).dimensions.widthMm === 250, resD.r.json);
  var edView = await call('PUT', '/api/books/book', { book: (await loaded('qa_roles')).book, baseRev: revOf('qa_roles') }, { token: CONTENT });
  check('13.9 the Content editor is an events Viewer, and Books still lets them save (its own role decides)', edView.status === 200, edView.json);

  /* ---------- 14 who is here ---------- */
  var pr1 = await call('POST', '/api/books/presence', { bookId: 'qa_roles', pageId: 'p1' }, { token: DESIGNER });
  var key = require('crypto').createHash('sha256').update(DESIGNER + '@timesinternet.in').digest('hex').slice(0, 16);
  var pdoc = DOCS['books/qa_roles/presence/' + key] || {};
  check('14.1 presence: kept under the hash of the address, with the page and the time', pr1.status === 200 && pdoc.email === DESIGNER + '@timesinternet.in' && pdoc.pageId === 'p1' && !isNaN(Date.parse(pdoc.at)), [pr1.json, Object.keys(DOCS).filter(function (k) { return /presence/.test(k); })]);
  check('14.2 …the answer: the others only (never the caller)', Array.isArray(pr1.json.here) && !pr1.json.here.some(function (h) { return h.email === DESIGNER + '@timesinternet.in'; }), pr1.json);
  await tick(3);
  await call('POST', '/api/books/presence', { bookId: 'qa_roles', pageId: 'p2' }, { token: CONTENT });
  await tick(3);
  var pr3 = await call('POST', '/api/books/presence', { bookId: 'qa_roles', pageId: 'p3' }, { token: ADMIN });
  check('14.3 the others seen in the last 70 seconds, newest first, with their page', pr3.status === 200 && pr3.json.here.length === 2 && pr3.json.here[0].email === CONTENT + '@timesinternet.in' &&
    pr3.json.here[0].pageId === 'p2' && pr3.json.here[1].email === DESIGNER + '@timesinternet.in' && pr3.json.here[1].pageId === 'p1' && Object.keys(pr3.json.here[0]).sort().join() === 'at,email,pageId', pr3.json);
  DOCS['books/qa_roles/presence/' + key].at = new Date(Date.now() - 71 * 1000).toISOString();
  var pr4 = await call('POST', '/api/books/presence', { bookId: 'qa_roles', pageId: 'p3' }, { token: ADMIN });
  check('14.4 someone last seen over 70 seconds ago is not shown', pr4.json.here.length === 1 && pr4.json.here[0].email === CONTENT + '@timesinternet.in', pr4.json);
  var notYet = await call('POST', '/api/books/presence', { bookId: 'qa_nope', pageId: 'p1' });
  check('14.5a a book not saved yet (just started, its first save on the way): nobody here, nothing written, no error', notYet.status === 200 &&
    notYet.json.here.length === 0 && !Object.keys(DOCS).some(function (k) { return k.indexOf('books/qa_nope') === 0; }), notYet);
  check('14.5 a deleted book: 404; ids that are not ids: 400', true &&
    (await call('POST', '/api/books/presence', { bookId: 'qa_to_delete', pageId: 'p1' })).status === 404 && (await call('POST', '/api/books/presence', { bookId: '../x', pageId: 'p1' })).status === 400 &&
    (await call('POST', '/api/books/presence', { bookId: 'qa_roles', pageId: 'a/b' })).status === 400);

  /* ---------- 15 deleted pages: kept, listed, put back ---------- */
  var tb = richBook('qa_trash');
  await call('PUT', '/api/books/book', { book: tb, baseRev: null }, { token: DESIGNER });
  var t0 = await loaded('qa_trash');
  var essayPart = DOCS['books/qa_trash'].parts.filter(function (p) { return p.k === 'page:p2'; })[0].id;
  var tdel = clone(t0.book); tdel.pages = tdel.pages.filter(function (p) { return p.id !== 'p2'; });
  var ts = await call('PUT', '/api/books/book', { book: tdel, baseRev: t0.rev }, { token: CONTENT });
  var trashDoc = DOCS['books/qa_trash/trash/p2'] || {};
  check('15.1 a page a save deletes is kept: the page as it was, its label, where it was, when and by whom', ts.status === 200 && JSON.stringify(JSON.parse(trashDoc.page || 'null')) === JSON.stringify(t0.book.pages[1]) &&
    trashDoc.label === 'Essay' && trashDoc.position === 1 && trashDoc.deletedBy === CONTENT + '@timesinternet.in' && !!trashDoc.deletedAt, trashDoc);
  await tick();
  check('15.2 …and only then is its part removed', !DOCS['books/qa_trash/parts/' + essayPart], Object.keys(DOCS).filter(function (k) { return k.indexOf('books/qa_trash/parts/') === 0; }).length);
  await tick(3);
  var t1 = await loaded('qa_trash'); var tdel2 = clone(t1.book); tdel2.pages = tdel2.pages.filter(function (p) { return p.id !== 'p3'; });
  await call('PUT', '/api/books/book', { book: tdel2, baseRev: t1.rev }, { token: DESIGNER });
  var tl1 = await call('GET', '/api/books/trash?id=qa_trash', null, { token: CONTENT });
  check('15.3 the deleted pages, newest first, without the pages themselves', tl1.status === 200 && tl1.json.pages.map(function (p) { return p.pageId; }).join() === 'p3,p2' &&
    tl1.json.pages[1].label === 'Essay' && tl1.json.pages[1].position === 1 && !('page' in tl1.json.pages[0]) && Object.keys(tl1.json.pages[0]).sort().join() === 'deletedAt,deletedBy,label,pageId,position', tl1.json);
  var cur = await loaded('qa_trash');
  var beforeRestore = under('books/qa_trash');
  var rsStale = await call('POST', '/api/books/restore-page', { bookId: 'qa_trash', pageId: 'p2', baseRev: cur.rev - 1 }, { token: CONTENT });
  await tick();
  check('15.4 restore based on an old revision: 409 stale, like a save, nothing written', rsStale.status === 409 && rsStale.json.code === 'stale' && rsStale.json.rev === cur.rev && under('books/qa_trash') === beforeRestore, rsStale.json);
  var rs = await call('POST', '/api/books/restore-page', { bookId: 'qa_trash', pageId: 'p2', baseRev: cur.rev }, { token: CONTENT });
  await tick();
  var afterRestore = await loaded('qa_trash');
  check('15.5 a Content editor restores the page: where it was, as it was, a new revision, the book in the answer', rs.status === 200 && rs.json.rev === cur.rev + 1 && afterRestore.rev === cur.rev + 1 &&
    afterRestore.book.pages.map(function (p) { return p.id; }).join() === 'p1,p2' && JSON.stringify(Object.assign({}, afterRestore.book.pages[1], { orderIndex: 0 })) === JSON.stringify(Object.assign({}, t0.book.pages[1], { orderIndex: 0 })) &&
    afterRestore.book.pages[1].orderIndex === 1 && rs.json.book.pages.map(function (p) { return p.id; }).join() === 'p1,p2', [rs.json && rs.json.rev, afterRestore.book.pages.map(function (p) { return p.id; })]);
  check('15.6 …and it is no longer among the deleted pages', !DOCS['books/qa_trash/trash/p2'] && (await call('GET', '/api/books/trash?id=qa_trash')).json.pages.map(function (p) { return p.pageId; }).join() === 'p3');
  DOCS['books/qa_trash/trash/p2'] = clone(trashDoc);
  check('15.6b a deleted page that is in the book again (an undo saved) is not offered', (await call('GET', '/api/books/trash?id=qa_trash')).json.pages.map(function (p) { return p.pageId; }).join() === 'p3');
  var rsExists = await call('POST', '/api/books/restore-page', { bookId: 'qa_trash', pageId: 'p2', baseRev: afterRestore.rev }, { token: CONTENT });
  check('15.7 a page with that id already in the book: 409 exists', rsExists.status === 409 && rsExists.json.code === 'exists' && revOf('qa_trash') === afterRestore.rev, rsExists.json);
  delete DOCS['books/qa_trash/trash/p2'];
  var rsNone = await call('POST', '/api/books/restore-page', { bookId: 'qa_trash', pageId: 'p7', baseRev: afterRestore.rev });
  check('15.8 a page not among the deleted: 404; a bad baseRev: 400', rsNone.status === 404 && (await call('POST', '/api/books/restore-page', { bookId: 'qa_trash', pageId: 'p3', baseRev: 'x' })).status === 400, rsNone.json);
  DOCS['books/qa_trash/trash/p3'].position = 99;
  var rsEnd = await call('POST', '/api/books/restore-page', { bookId: 'qa_trash', pageId: 'p3', baseRev: afterRestore.rev }, { token: DESIGNER });
  check('15.9 a page that was further on than the book now is: put at the end', rsEnd.status === 200 && (await loaded('qa_trash')).book.pages.map(function (p) { return p.id; }).join() === 'p1,p2,p3', rsEnd.json);
  await tick();
  var t3 = await loaded('qa_trash'); var tdel3 = clone(t3.book); tdel3.pages = tdel3.pages.filter(function (p) { return p.id !== 'p1'; });
  var coverPart = DOCS['books/qa_trash'].parts.filter(function (p) { return p.k === 'page:p1'; })[0].id;
  FAIL_SET = /^books\/qa_trash\/trash\//;
  var tsFail = await call('PUT', '/api/books/book', { book: tdel3, baseRev: t3.rev }, { token: DESIGNER });
  FAIL_SET = null;
  await tick(10);
  check('15.10 when the deleted page cannot be kept, the save stands but its part is left in place (never lost)', tsFail.status === 200 && !DOCS['books/qa_trash/trash/p1'] && !!DOCS['books/qa_trash/parts/' + coverPart], tsFail.json);

  /* ---------- 16 the activity log ---------- */
  var lb = richBook('qa_log');
  lb.pages.push(page('p4', 'Notes', ['Note one']));
  await call('PUT', '/api/books/book', { book: lb, baseRev: null }, { token: DESIGNER });
  var lg = logOf('qa_log');
  check('16.1 a new book: "created", by whom, in words', lg.length === 1 && lg[0].action === 'created' && lg[0].by === DESIGNER + '@timesinternet.in' && lg[0].detail === 'Started the book "Forms of Light" with 4 pages', lg);
  await tick(3);
  var l0 = await loaded('qa_log'); var lb1 = clone(l0.book);
  lb1.pages[0].elements[0].text = 'New cover line'; lb1.pages[1].elements[0].text = 'New one'; lb1.pages[1].elements[1].text = 'New two';
  lb1.pages = lb1.pages.filter(function (p) { return p.id !== 'p4'; });
  lb1.pages.push({ id: 'p5', orderIndex: 3, label: 'Gallery', role: 'image_led', backgroundColor: '#123456', elements: [] });
  await call('PUT', '/api/books/book', { book: lb1, baseRev: l0.rev }, { token: DESIGNER });
  lg = logOf('qa_log');
  check('16.2 a save in one sentence: text in frames and pages, a page added, one deleted, the design', lg.length === 2 && lg[0].action === 'saved' &&
    lg[0].detail === 'Changed text in 3 frames on 2 pages; added page "Gallery"; deleted page "Notes"; changed the design', lg[0]);
  await tick(3);
  var l1 = await loaded('qa_log'); var lb2 = clone(l1.book);
  lb2.pages[1].elements[0].text = 'New one, again'; lb2.pages[2].elements[0].image.zoom = 1.5;
  lb2.pages = lb2.pages.filter(function (p) { return p.id !== 'p5'; });
  await call('PUT', '/api/books/book', { book: lb2, baseRev: l1.rev }, { token: DESIGNER });
  lg = logOf('qa_log');
  check('16.3 the same person again within 10 minutes: their entry updated, not a new one; a frame counted once, a page added then deleted is neither',
    lg.length === 2 && lg[0].detail === 'Changed text in 3 frames on 2 pages; changed photos in 1 frame on 1 page; deleted page "Notes"; changed the design' && lg[0].firstAt !== lg[0].at, lg[0]);
  await tick(3);
  var l2 = await loaded('qa_log'); var lb3 = clone(l2.book); lb3.pages[0].elements[0].text = 'By someone else';
  await call('PUT', '/api/books/book', { book: lb3, baseRev: l2.rev }, { token: CONTENT });
  lg = logOf('qa_log');
  check('16.4 someone else saves: a new entry', lg.length === 3 && lg[0].by === CONTENT + '@timesinternet.in' && lg[0].detail === 'Changed text in 1 frame on 1 page', lg[0]);
  DOCS[lg[0].path].at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  await tick(3);
  var l3 = await loaded('qa_log'); var lb4 = clone(l3.book); lb4.pages[0].elements[0].text = 'Later on';
  await call('PUT', '/api/books/book', { book: lb4, baseRev: l3.rev }, { token: CONTENT });
  lg = logOf('qa_log');
  check('16.5 …and over 10 minutes after their last: a new entry again', lg.length === 4 && lg[0].by === CONTENT + '@timesinternet.in' && lg[0].detail === 'Changed text in 1 frame on 1 page', lg.slice(0, 2));
  await tick(3);
  var l4 = await loaded('qa_log'); var lb5 = clone(l4.book); lb5.pages = [lb5.pages[1], lb5.pages[0]].concat(lb5.pages.slice(2)); lb5.contentSections = [];
  lb5.name = 'Renamed';
  await call('PUT', '/api/books/book', { book: lb5, baseRev: l4.rev }, { token: ADMIN });
  lg = logOf('qa_log');
  check('16.6 other changes in words: reordered pages, the book renamed, the manuscript', /^Reordered pages/.test(lg[0].detail) && /renamed the book/.test(lg[0].detail) && /changed the manuscript/.test(lg[0].detail) && !/design/.test(lg[0].detail), lg[0].detail);
  await tick(3);
  await call('POST', '/api/books/status', { id: 'qa_log', status: 'print_ready' }, { token: DESIGNER });
  await tick(3);
  await call('POST', '/api/books/versions', { bookId: 'qa_log', version: { id: 'v_log', label: 'Proof 2', snapshot: { pages: [] } } }, { token: CONTENT });
  await tick(3);
  var l5 = await loaded('qa_log'); var lb6 = clone(l5.book); var gonePage = lb6.pages.pop();
  await call('PUT', '/api/books/book', { book: lb6, baseRev: l5.rev }, { token: DESIGNER });
  await tick(3);
  await call('POST', '/api/books/restore-page', { bookId: 'qa_log', pageId: gonePage.id, baseRev: revOf('qa_log') }, { token: CONTENT });
  lg = logOf('qa_log');
  var acts = lg.map(function (e) { return e.action; });
  check('16.7 status, a version, a restored page: each its own entry in words', acts.slice(0, 4).join() === 'page-restored,saved,version,status' && lg[3].detail === 'Changed the status from Draft to Print ready' &&
    lg[2].detail === 'Kept the version "Proof 2"' && /^Restored page "Gallery" as page 3$/.test(lg[0].detail) && lg[1].detail === 'Deleted page "Gallery"', lg.slice(0, 4).map(function (e) { return e.action + ': ' + e.detail; }));
  await call('PUT', '/api/books/book', { book: Object.assign(book('qa_log_del'), { name: 'Gone' }), baseRev: null }, { token: DESIGNER });
  await call('DELETE', '/api/books/book?id=qa_log_del', null, { token: DESIGNER });
  check('16.8 a deleted book: "deleted"', logOf('qa_log_del')[0].action === 'deleted' && logOf('qa_log_del')[0].detail === 'Deleted the book');
  var gl = await call('GET', '/api/books/log?id=qa_log', null, { token: CONTENT });
  check('16.9 GET log: newest first, in words, without the counts', gl.status === 200 && gl.json.entries.length === lg.length && gl.json.entries[0].action === 'page-restored' &&
    gl.json.entries.every(function (e, i, all) { return e.id && e.at && e.by && e.action && e.detail && !('counts' in e) && (!i || all[i - 1].at >= e.at); }) &&
    gl.json.entries.some(function (e) { return e.action === 'created'; }), gl.json);
  check('16.10 a deleted or unknown book has no log to show: 404', (await call('GET', '/api/books/log?id=qa_log_del')).status === 404 && (await call('GET', '/api/books/log?id=qa_none')).status === 404);
  var many2 = T.saveSentence(Object.assign(T.foldCounts(null, T.saveCounts({ pages: [] }, { pages: [] }, [])), { added: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], deleted: [1, 2, 3, 4].map(function (i) { return { id: 'd' + i, label: 'D' + i }; }) }));
  check('16.11 sentences: two pages named, more than three counted, nothing changed said so', many2 === 'Added pages "A" and "B"; deleted 4 pages' &&
    T.saveSentence(T.saveCounts({ pages: [] }, { pages: [] }, [])) === 'Saved with no changes', many2);

  /* ---------- 17 Phase 3: "Edit with AI" on a text frame (edit-text), for both roles ---------- */
  var ET = P['edit-text'], ETC = C['edit-text'];
  var essay = 'The Basalt Residences opened in 2019 with 42 homes.\n\nArchitect Meera Rao chose local stone.';
  var shortP = ET({ text: essay, instruction: 'shorten', targetWords: 12 });
  check('17.1 the prompt keeps the meaning, facts, names and numbers, adds no facts, asks for plain text; shorten names the target and the count now',
    /Keep its meaning, and keep every fact, name, number, date and quotation exactly as written/.test(shortP.prompt) && /Never add facts, figures, names, quotes, claims or sources/.test(shortP.prompt) &&
    /Plain text only/.test(shortP.prompt) && /at most 12 words \(it has 15 now\)/.test(shortP.prompt) && shortP.prompt.indexOf(essay) !== -1, shortP.prompt);
  check('17.2 …grammar changes nothing else; clarify keeps the length; a custom change carries the request (its quotes made safe)',
    /grammar, spelling and punctuation only/.test(ET({ text: essay, instruction: 'grammar' }).prompt) && /Keep about the same length/.test(ET({ text: essay, instruction: 'clarify' }).prompt) &&
    /The person asks: "make it 'warmer'"/.test(ET({ text: essay, instruction: 'custom', request: 'make it "warmer"' }).prompt));
  var refused = [ET({ text: '  ', instruction: 'grammar' }), ET({ text: essay, instruction: 'rewrite-everything' }), ET({ text: essay, instruction: 'shorten' }),
    ET({ text: essay, instruction: 'shorten', targetWords: 0 }), ET({ text: essay, instruction: 'custom', request: ' ' }), ET({ text: new Array(AI._test.MAX_EDIT_CHARS + 2).join('a'), instruction: 'grammar' })];
  check('17.3 refused before any call: no words, an unknown instruction, shorten with no target, a custom change with no request (400), too long (413)',
    refused.slice(0, 5).every(function (r) { return r.status === 400 && r.error; }) && refused[5].status === 413 && /in parts/.test(refused[5].error) &&
    /no words in this frame/.test(refused[0].error) && /Type the change/.test(refused[4].error), refused);
  var cleaned = ETC({ text: '```text\nHere is the shorter version:\n**The Basalt Residences** opened in 2019.  \n\n\n\n## Meera Rao chose stone.\u0007\n```' });
  check('17.4 the answer is cleaned: no code fence, "Here is" line, Markdown, control characters or runs of empty lines',
    cleaned.text === 'The Basalt Residences opened in 2019.\n\nMeera Rao chose stone.', cleaned);
  check('17.5 …quotes around the whole of it go, quotes inside stay; kept to a length; nothing usable is "ai-empty"',
    ETC({ text: '“Forty-two homes.”' }).text === 'Forty-two homes.' && ETC({ text: 'She said “yes”.' }).text === 'She said “yes”.' &&
    ETC({ text: new Array(30000).join('word ') }).text.length <= AI._test.MAX_EDIT_ANSWER && ETC({ text: ' ``` ``` ' }).code === 'ai-empty' && ETC(null).code === 'ai-empty' &&
    ETC({ text: 42 }).code === 'ai-empty');
  AI_ASKS = [];
  AI_ANSWER = { parsed: { text: '**Opened in 2019** with 42 homes.\n\n\n\nMeera Rao chose stone.' }, provider: 'claude' };
  var etC = await call('POST', '/api/books/ai/edit-text', { text: essay, instruction: 'shorten', targetWords: 12 }, { token: CONTENT, headers: { 'x-book-id': 'qa_roles' } });
  var etD = await call('POST', '/api/books/ai/edit-text', { text: essay, instruction: 'clarify' }, { token: DESIGNER });
  check('17.6 a Content editor and a Designer may both use it: the cleaned text, on its own model profile', etC.status === 200 && etD.status === 200 &&
    etC.json.text === 'Opened in 2019 with 42 homes.\n\nMeera Rao chose stone.' && Object.keys(etC.json).join() === 'text' &&
    AI_ASKS.length === 2 && AI_ASKS[0].opts.route === 'books-edit-text' && AI_ASKS[0].prompt.indexOf(essay) !== -1 && AI_ASKS[0].schema.properties.text.type === 'STRING', [etC.json, etD.json]);
  check('17.7 …its cost counted against the open book', DOCS['books/qa_roles'].aiUsage && DOCS['books/qa_roles'].aiUsage.calls >= 1, DOCS['books/qa_roles'].aiUsage);
  AI_ANSWER = { parsed: { text: '   ' }, provider: 'claude' };
  var etEmpty = await call('POST', '/api/books/ai/edit-text', { text: essay, instruction: 'grammar' }, { token: CONTENT });
  check('17.8 an answer with no words: 502 with a sentence to try again (never an empty frame)', etEmpty.status === 502 && etEmpty.json.code === 'ai-empty' && etEmpty.json.retryable === true &&
    /gave back no text/.test(etEmpty.json.error), etEmpty.json);
  AI_ANSWER = { error: 'ETB2B AI is busy. Please try again in a minute.', code: 'ai-quota', status: 429, retryable: true };
  var etBusy = await call('POST', '/api/books/ai/edit-text', { text: essay, instruction: 'grammar' }, { token: DESIGNER });
  check('17.9 a failed call: the model layer\'s status and sentence', etBusy.status === 429 && etBusy.json.code === 'ai-quota', etBusy.json);
  var askedNow = AI_ASKS.length;
  var etBad = await call('POST', '/api/books/ai/edit-text', { text: essay, instruction: 'custom' }, { token: CONTENT });
  var etNo = await call('POST', '/api/books/ai/edit-text', { text: essay, instruction: 'grammar' }, { token: NOBOOKS });
  var etOut = await call('POST', '/api/books/ai/edit-text', { text: essay, instruction: 'grammar' }, { token: EDITOR });
  check('17.10 a request with nothing to work on is 400 with the sentence; anyone without Books 403; neither asks the AI', etBad.status === 400 && /Type the change/.test(etBad.json.error) &&
    etNo.status === 403 && etNo.json.code === 'no-books' && etOut.status === 403 && AI_ASKS.length === askedNow, [etBad.json, etNo.json, etOut.json]);
  check('17.11 the step is a Content editor\'s route (both roles) and rate-limited per person (60 in 10 minutes)', T.CONTENT_ROUTES['POST /api/books/ai/edit-text'] === 1 &&
    !T.DESIGNER_ACTIONS['POST /api/books/ai/edit-text'] && /'POST \/api\/books\/ai\/edit-text': \{ max: 60, ms: TEN_MINUTES \}/.test(HTTP_SRC) &&
    /'books-edit-text': \{ model: CLAUDE_SONNET, effort: 'low', timeoutMs: 60000, maxOutputTokens: 6000 \}/.test(LLM_SRC));

  /* ---------- 18 Phase 4: a font file for the print PDF (GET font-file), Google stubbed ---------- */
  T.resetFontFiles();
  var FETCHED = [], GSTATIC_BODY = null, CSS_ELSEWHERE = false, BIG_FONT = false;
  var TTF = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(200, 7)]);
  /* Lora: 400, 700 and italics, no optical size; DM Sans: 400 only, optical sizes 9–40 */
  var META = ')]}\'\n' + JSON.stringify({ familyMetadataList: [
    { family: 'Lora', category: 'Serif', popularity: 1, fonts: { '400': {}, '700': {}, '400i': {}, '700i': {} }, axes: [{ tag: 'wght', min: 400, max: 700 }], subsets: ['latin'] },
    { family: 'DM Sans', category: 'Sans Serif', popularity: 2, fonts: { '400': {} }, axes: [{ tag: 'opsz', min: 9, max: 40 }, { tag: 'wght', min: 100, max: 1000 }], subsets: ['latin'] }] });
  function answer(status, body, headers) {
    var h = Object.assign({}, headers || {});
    return Promise.resolve({ ok: status >= 200 && status < 300, status: status, headers: { get: function (k) { return h[k.toLowerCase()] || null; } },
      text: function () { return Promise.resolve(String(body)); }, arrayBuffer: function () { var b = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); } });
  }
  var realFetch2 = global.fetch;
  global.fetch = function (url, opts) {
    FETCHED.push({ url: String(url), ua: opts && opts.headers && opts.headers['User-Agent'] });
    var u = new URL(String(url));
    if (u.host === 'fonts.google.com') return answer(200, META);
    if (u.host === 'fonts.googleapis.com') {
      var fam = u.searchParams.get('family'), m = /^([^:]+):(ital,(?:opsz,)?wght)@(\d),(?:(\d+),)?(\d+)$/.exec(fam);
      if (!m) return answer(400, '<html>400</html>');
      var name = m[1], hasOpsz = /opsz/.test(m[2]), it = m[3] === '1', opsz = hasOpsz ? +m[4] : 0, w = +m[5];
      var ok = name === 'Lora' ? !hasOpsz && [400, 700].indexOf(w) !== -1 : name === 'DM Sans' ? (!hasOpsz || (opsz >= 9 && opsz <= 40)) && w === 400 && !it : false;
      if (!ok) return answer(400, '<html>400: Font family not found</html>');
      var file = CSS_ELSEWHERE ? 'https://evil.example/x.ttf' : 'https://fonts.gstatic.com/s/' + name.toLowerCase().replace(/ /g, '') + '/v1/' + w + (it ? 'i' : '') + (opsz ? '-o' + opsz : '') + '.ttf';
      return answer(200, '/* latin */\n@font-face {\n  font-family: \'' + name + '\';\n  font-style: ' + (it ? 'italic' : 'normal') + ';\n  font-weight: ' + w + ';\n  src: url(' + file + ') format(\'truetype\');\n}\n');
    }
    if (u.host === 'fonts.gstatic.com') return answer(200, GSTATIC_BODY || TTF, BIG_FONT ? { 'content-length': String(16 * 1024 * 1024) } : {});
    return Promise.reject(new Error('unexpected fetch ' + url));
  };
  var ff = await call('GET', '/api/books/font-file?family=Lora&weight=400&italic=0&opsz=64', null, { token: CONTENT });
  var hosts = FETCHED.map(function (f) { return new URL(f.url).host; });
  check('18.1 a Content editor gets the face\'s TrueType file: font/ttf, private, kept a year', ff.status === 200 && ff.headers['content-type'] === 'font/ttf' &&
    ff.headers['cache-control'] === 'private, max-age=31536000' && Buffer.compare(ff.body, TTF) === 0 && T.CONTENT_ROUTES['GET /api/books/font-file'] === 1, [ff.status, ff.headers]);
  check('18.2 …fetched only from Google Fonts: the list, the CSS2 API (with a User-Agent it answers with TrueType), then the file from fonts.gstatic.com',
    hosts.every(function (h) { return ['fonts.google.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].indexOf(h) !== -1; }) && hosts.indexOf('fonts.gstatic.com') !== -1 &&
    FETCHED.filter(function (f) { return /googleapis/.test(f.url); }).every(function (f) { return f.ua === T.FONT_CSS_UA; }), FETCHED);
  check('18.3 …Lora has no optical size: X-Font-Opsz none, and the CSS was asked without one in the end', ff.headers['x-font-opsz'] === 'none' &&
    FETCHED.some(function (f) { return /family=Lora:ital,wght@0,400$/.test(decodeURIComponent(f.url)); }), FETCHED.map(function (f) { return decodeURIComponent(f.url); }));
  check('18.4 …kept in the bucket under the Books prefix (fonts/), private', !!FILES['books/fonts/lora/400.ttf'] && FILES['books/fonts/lora/400.ttf'].opts.metadata.contentType === 'font/ttf' &&
    /private/.test(FILES['books/fonts/lora/400.ttf'].opts.metadata.cacheControl), Object.keys(FILES).filter(function (k) { return /fonts\//.test(k); }));
  var before = FETCHED.length;
  var again = await call('GET', '/api/books/font-file?family=lora&weight=400&italic=0&opsz=64', null, { token: DESIGNER });
  check('18.5 asked again (any case): from memory, Google not asked', again.status === 200 && Buffer.compare(again.body, TTF) === 0 && FETCHED.length === before);
  T.resetFontFiles();
  FETCHED = [];
  var fromBucket = await call('GET', '/api/books/font-file?family=Lora&weight=400&italic=0&opsz=64', null, { token: DESIGNER });
  check('18.6 after a restart: from the bucket (no file from Google)', fromBucket.status === 200 && Buffer.compare(fromBucket.body, TTF) === 0 &&
    !FETCHED.some(function (f) { return /gstatic/.test(f.url); }), FETCHED.map(function (f) { return f.url; }));
  var dm = await call('GET', '/api/books/font-file?family=DM%20Sans&weight=400&italic=0&opsz=64', null, { token: DESIGNER });
  check('18.7 a variable font with optical sizes: 64 taken into its range (9–40) → 40, said in X-Font-Opsz, kept as its own file', dm.status === 200 && dm.headers['x-font-opsz'] === '40' &&
    !!FILES['books/fonts/dm-sans/400-opsz40.ttf'], [dm.status, dm.headers['x-font-opsz'], Object.keys(FILES).filter(function (k) { return /fonts\//.test(k); })]);
  var nf = await call('GET', '/api/books/font-file?family=Georgia&weight=400&italic=0', null, { token: DESIGNER });
  check('18.8 a family that isn\'t a Google font: 404 font-family with the sentence; Google never asked for it', nf.status === 404 && nf.json.code === 'font-family' &&
    /"Georgia" is not a Google font, so it can't be embedded in the PDF\./.test(nf.json.error) && !FETCHED.some(function (f) { return /Georgia/.test(f.url); }), nf.json);
  var nw = await call('GET', '/api/books/font-file?family=Lora&weight=450&italic=1', null, { token: DESIGNER });
  check('18.9 a weight it doesn\'t have: 404 font-weight with its weights and whether it has italics (the editor takes the nearest)', nw.status === 404 && nw.json.code === 'font-weight' &&
    JSON.stringify(nw.json.weights) === '[400,700]' && nw.json.italic === true && nw.json.family === 'Lora' && /Lora has no 450 italic style\./.test(nw.json.error), nw.json);
  var nit = await call('GET', '/api/books/font-file?family=DM%20Sans&weight=400&italic=1', null, { token: DESIGNER });
  check('18.10 …an italic it doesn\'t have: the same', nit.status === 404 && nit.json.code === 'font-weight' && nit.json.italic === false, nit.json);
  var bads = [];
  for (var bq of ['family=&weight=400', 'family=Lora&weight=abc', 'family=Lora&weight=400&italic=2', 'family=Lo%3Cra&weight=400', 'family=Lora&weight=400&opsz=99999']) bads.push(await call('GET', '/api/books/font-file?' + bq, null, { token: DESIGNER }));
  check('18.11 a request without a family, a weight from 1 to 1000, italic 0 or 1, or a sensible opsz: 400 with the sentence', bads.every(function (b) { return b.status === 400 && b.json.code === 'bad-request' && b.json.error; }), bads.map(function (b) { return [b.status, b.json]; }));
  var nb = await call('GET', '/api/books/font-file?family=Lora&weight=400', null, { token: NOBOOKS });
  check('18.12 someone without Books: 403', nb.status === 403 && nb.json.code === 'no-books');
  T.resetFontFiles();
  Object.keys(FILES).forEach(function (k) { if (/fonts\//.test(k)) delete FILES[k]; });
  CSS_ELSEWHERE = true;
  var elsewhere = await call('GET', '/api/books/font-file?family=Lora&weight=700&italic=0', null, { token: DESIGNER });
  check('18.13 a CSS answer pointing anywhere but fonts.gstatic.com is never fetched (404, as no such face)', elsewhere.status === 404 && !FETCHED.some(function (f) { return /evil/.test(f.url); }), elsewhere.json);
  CSS_ELSEWHERE = false;
  GSTATIC_BODY = Buffer.from('<html>not a font</html>');
  var notFont = await call('GET', '/api/books/font-file?family=Lora&weight=700&italic=0', null, { token: DESIGNER });
  check('18.14 a file that isn\'t a font: 500 with the sentence, nothing kept', notFont.status === 500 && /could not be fetched from Google Fonts/.test(notFont.json.error) && !FILES['books/fonts/lora/700.ttf'], notFont.json);
  GSTATIC_BODY = null;
  BIG_FONT = true;
  var bigF = await call('GET', '/api/books/font-file?family=Lora&weight=700&italic=1', null, { token: DESIGNER });
  check('18.15 a file over 15 MB is refused', bigF.status === 500 && !FILES['books/fonts/lora/700i.ttf'] && T.FONT_FILE_MAX === 15 * 1024 * 1024, bigF.json);
  BIG_FONT = false;
  FETCHED = [];
  var together = await Promise.all([1, 2, 3].map(function () { return call('GET', '/api/books/font-file?family=Lora&weight=700&italic=0', null, { token: DESIGNER }); }));
  check('18.16 asked for three times at once: one fetch from fonts.gstatic.com', together.every(function (b) { return b.status === 200; }) &&
    FETCHED.filter(function (f) { return /gstatic.*\/700\.ttf$/.test(f.url); }).length === 1, FETCHED.map(function (f) { return f.url; }));
  global.fetch = realFetch2;
  T.resetFontFiles();

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
  check('11.4 the dashboard menu shows Books to whoever has a Books role', /\(booksOpen \? '<a href="books\.html">' \+ book \+ ' Books<\/a>' : ''\)/.test(LIST) && /y\.books === 'designer' \|\| y\.books === 'content' \|\| y\.role === 'admin'/.test(LIST));
  check('11.5 nothing of the AI Studio export\'s server came along', !fs.existsSync(path.join(ROOT, 'books-app', 'server.ts')) && !fs.existsSync(path.join(ROOT, 'books-app', 'src', 'services', 'firebase.ts')) &&
    !fs.existsSync(path.join(ROOT, 'books-app', 'src', 'components', 'TopToolbar.tsx')));

  process.stdout.write('api-books: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stdout.write('api-books: crashed — ' + (e && e.stack || e) + '\n'); process.exit(1); });
