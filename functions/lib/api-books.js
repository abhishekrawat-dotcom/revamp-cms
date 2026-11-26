/* Books (BOOKSTUDIO) — the server of EventSphere's coffee table book editor (the owner, 26 Nov 2026: "I want to built
   it in EventSphere as an independent product"; plan: docs/bookstudio/PLAN.md). The editor itself is the React app in
   books-app/, built into books/ and opened at /books.html. Everything it keeps goes through these routes: the browser
   never touches the database or the bucket, and every route checks the caller (requireMember: the Bearer token, or
   the __session cookie a picture's <img> sends).

   WHO. Phase 1: admins only (booksRole). Phase 2 gives each person a Books role (Designer, Content editor) in
   Settings › Access and splits what each may change; booksRole is the one place that answers it.

   ROUTES (all under /api/books/, JSON unless said)
     GET    me                              { role, email }
     GET    list                            { books: [summary] } every book not deleted, newest first (the team's
                                            books: there is no per-person list)
     GET    book?id=                        { book, rev } the whole book as the editor holds it
     PUT    book            { book, baseRev }   save; baseRev null creates it. 409 { code:'stale', rev, updatedBy,
                                            updatedAt } when it was saved elsewhere since baseRev; 410 when deleted
     POST   status          { id, status }  draft | in_review | print_ready | archived -> { rev }
     DELETE book?id=                        kept, marked deleted (deletedAt), gone from the list
     GET    versions?id=                    { versions: [meta] } newest first
     POST   versions        { bookId, version }   a named snapshot (immutable)
     GET    version?id=&versionId=          { version } with its snapshot
     GET    templates  · PUT template { template } · DELETE template?id=     the team's saved templates
     GET    font-collections · PUT font-collection { collection }         each person's own
     POST   asset           raw photo bytes (X-File-Name)   -> { asset }  JPG, PNG, WebP, TIFF up to 30 MB
     GET    asset/<id>/<display|print|thumb>                the photo, private, cached for a year (ids never change)
     POST   manuscript      raw file bytes (X-File-Name; X-Source-Format: pdf-text for a PDF read in the browser)
                                            -> { filename, rawText, sections, wordCount }   .docx .rtf .csv .txt .md
     POST   idml            raw file bytes (X-File-Name)    -> { isNativeIndd:false, idml } | { isNativeIndd:true, guidance }
     GET    fonts                           { source, items } the Google Fonts library (cached a day)
     POST   ai/<step>                       lib/books-ai.js (X-Book-Id: the open book, for its AI usage)

   WHERE THINGS LIVE (a test server sets BOOKS_COL_PREFIX=qa: qaBooks…, files under qa-books/)
     books/{bookId}                 name, status, core (JSON string: the book's settings and design system), summary
                                    (the list's fields), parts [{ k, id }], rev, createdAt/By, updatedAt/By,
                                    deletedAt/By, aiUsage
       parts/{partId}               { k, data (JSON string) } one page, master, or a run of sections or photos. The
                                    id is the hash of its key and content, so a save writes only what changed and
                                    never overwrites what the current version points to: a save writes its new
                                    parts, then moves the book to them in one transaction (checking rev), then
                                    deletes the parts nothing points to any more.
       versions/{versionId}         meta; the snapshot is books/<id>/versions/<versionId>.json.gz in the bucket
     bookTemplates/{id}             { templateKind, collectionName, category, title, description, tags, payload (JSON
                                    string), createdAt/By, updatedAt/By }
     bookFontCollections/{owner_id} { owner, id, name, fonts, presets (JSON string), updatedAt }
     bookAssets/{assetId}           { name, mimeType, widthPx, heightPx, sizeBytes, uploadedAt/By, objects: { original,
                                    print, display, thumb: { path, type } } } — files at books/assets/<assetId>/ (private) */
'use strict';
var crypto = require('crypto');
var zlib = require('zlib');
var H = require('./http');
var sendJson = H.sendJson;

var ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
var ASSET_ID_RE = /^as_[a-f0-9]{20}$/;
var STATUSES = ['draft', 'in_review', 'print_ready', 'archived'];
var TEMPLATE_KINDS = ['page', 'spread', 'infographic', 'component', 'book', 'mixed_format'];
var MB = 1024 * 1024;
var MAX_BOOK_REQUEST = 24 * MB, MAX_PART_BYTES = 900 * 1024, MAX_CORE_BYTES = 700 * 1024;
var MAX_PAGES = 1000, MAX_MASTERS = 200, MAX_ELEMENTS = 600;
var SECTIONS_PER_PART = 250, ASSETS_PER_PART = 400;
var MAX_ASSET_BYTES = 30 * MB, MAX_MANUSCRIPT_BYTES = 20 * MB, MAX_IDML_BYTES = 30 * MB, MAX_AI_REQUEST = 30 * MB;
var MAX_VERSION_BYTES = 24 * MB, MAX_TEMPLATE_BYTES = 900 * 1024;
var BATCH_WRITES = 400, BATCH_BYTES = 8 * MB;
var NOT_OPEN = 'Books is open to admins only for now. Ask an admin if you need it.';

/* ---------- where ---------- */
function colPrefix() { return String(process.env.BOOKS_COL_PREFIX || '').replace(/[^a-z0-9]/gi, ''); }
function col(name) { var p = colPrefix(); return p ? p + name.charAt(0).toUpperCase() + name.slice(1) : name; }
function filePrefix() { var p = colPrefix(); return p ? p.toLowerCase() + '-books/' : 'books/'; }
function bookRef(fb, id) { return fb.db.collection(col('books')).doc(id); }
function partRef(fb, id, partId) { return bookRef(fb, id).collection('parts').doc(partId); }

/* ---------- who ---------- */
/* Phase 1: admins only, as Designers (docs/bookstudio/PLAN.md). '' = no Books at all. */
function booksRole(decoded) {
  var a = decoded && decoded.access;
  return a && a.role === 'admin' ? 'designer' : '';
}
function whoOf(decoded) { return String((decoded && (decoded.email || decoded.uid)) || '').toLowerCase(); }

/* ---------- answers ---------- */
function httpErr(status, message, extra) { var e = new Error(message); e.status = status; e.isPublic = true; e.extra = extra || null; return e; }
function failWith(res, where, err, fallback) {
  if (err && err.isPublic) return sendJson(res, err.status, Object.assign({ error: err.message }, err.extra || {}));
  var ref = H.failureRef();
  console.error('books: ' + where + ' failed [ref ' + ref + '] — ' + (err && err.stack || err));
  sendJson(res, 500, { error: fallback || 'Something went wrong on the server. Please try again.', ref: ref });
}
function str(v, max) { return String(v == null ? '' : v).slice(0, max || 300); }
function queryOf(req) { return new URLSearchParams(String(req.url || '').split('?')[1] || ''); }
function headerName(req) {
  var raw = String(req.headers['x-file-name'] || '');
  var name = raw;
  try { name = decodeURIComponent(raw); } catch (e) { name = raw; }
  return name.replace(/[\u0000-\u001f\\/]+/g, ' ').trim().slice(0, 200) || 'file';
}
function extOf(name) { var m = /\.([a-z0-9]{1,6})$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }

/* ---------- bodies ---------- */
/* cb(buffer) with the whole body, or answers 413 itself (a body the portal check already read is req.rawBody) */
function readBuffer(req, res, max, tooLarge, cb) {
  function deliver(buf) { try { cb(buf); } catch (err) { failWith(res, 'read', err); } }
  var declared = +req.headers['content-length'];
  if (declared > max) { sendJson(res, 413, { error: tooLarge }); if (typeof req.resume === 'function') req.resume(); return; }
  if (req.rawBody != null) {
    var b = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));
    return b.length > max ? sendJson(res, 413, { error: tooLarge }) : deliver(b);
  }
  var chunks = [], size = 0, done = false;
  req.on('data', function (c) {
    if (done) return;
    size += c.length;
    if (size > max) { done = true; sendJson(res, 413, { error: tooLarge }); req.resume(); return; }
    chunks.push(c);
  });
  req.on('end', function () { if (!done) { done = true; deliver(Buffer.concat(chunks)); } });
  req.on('error', function () { if (!done) { done = true; sendJson(res, 400, { error: 'The request could not be read.' }); } });
}
function readJson(req, res, max, tooLarge, cb) {
  readBuffer(req, res, max, tooLarge, function (buf) {
    var body;
    try { body = H.parseJsonObject(buf.toString('utf8')); } catch (e) { return sendJson(res, 400, { error: 'The request could not be read.' }); }
    cb(body);
  });
}

/* ---------- a book, split into what is stored ---------- */
function partId(key, data) { return crypto.createHash('sha256').update(key).update('\0').update(data).digest('hex').slice(0, 40); }
function sizeText(bytes) { return (bytes / MB).toFixed(1) + ' MB'; }
function partOf(key, value, tooBig) {
  var data = JSON.stringify(value);
  if (Buffer.byteLength(data) > MAX_PART_BYTES) throw httpErr(413, tooBig(Buffer.byteLength(data)), { code: 'too-large' });
  return { key: key, id: partId(key, data), data: data };
}
function chunks(list, n) { var out = []; for (var i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; }
var CORE_KEYS = ['subtitle', 'category', 'unit', 'coverThumbnail', 'dimensions', 'designSystem', 'chapters', 'templateReport', 'printSettings', 'customDimensionPresets'];

/* book (the editor's BookProject) -> { name, status, core, summary, parts } or throws a 400 / 413 with the sentence */
function splitBook(book) {
  if (!book || typeof book !== 'object' || Array.isArray(book)) throw httpErr(400, 'The book could not be read.');
  if (!ID_RE.test(String(book.id || ''))) throw httpErr(400, 'This book has no valid id.');
  var pages = Array.isArray(book.pages) ? book.pages : [];
  if (!pages.length) throw httpErr(400, 'A book needs at least one page.');
  if (pages.length > MAX_PAGES) throw httpErr(413, 'This book has ' + pages.length + ' pages; a book can have up to ' + MAX_PAGES + '.', { code: 'too-large' });
  var parts = [], seen = {};
  pages.forEach(function (p, i) {
    var label = p && p.label ? '"' + str(p.label, 60) + '"' : String(i + 1);
    if (!p || typeof p !== 'object' || !ID_RE.test(String(p.id || ''))) throw httpErr(400, 'Page ' + (i + 1) + ' has no valid id.');
    if (seen['page:' + p.id]) throw httpErr(400, 'Two pages share the id ' + p.id + '.');
    seen['page:' + p.id] = 1;
    var n = Array.isArray(p.elements) ? p.elements.length : 0;
    if (n > MAX_ELEMENTS) throw httpErr(413, 'Page ' + label + ' has ' + n + ' items; a page can hold up to ' + MAX_ELEMENTS + '.', { code: 'too-large' });
    parts.push(partOf('page:' + p.id, p, function (b) { return 'Page ' + label + ' is too large to save (' + sizeText(b) + '). Move some of its text to another page.'; }));
  });
  var masters = Array.isArray(book.masterPages) ? book.masterPages : [];
  if (masters.length > MAX_MASTERS) throw httpErr(413, 'This book has ' + masters.length + ' master pages; it can have up to ' + MAX_MASTERS + '.', { code: 'too-large' });
  masters.forEach(function (m, i) {
    if (!m || typeof m !== 'object' || !ID_RE.test(String(m.id || ''))) throw httpErr(400, 'Master page ' + (i + 1) + ' has no valid id.');
    if (seen['master:' + m.id]) throw httpErr(400, 'Two master pages share the id ' + m.id + '.');
    seen['master:' + m.id] = 1;
    parts.push(partOf('master:' + m.id, m, function (b) { return 'Master page "' + str(m.name, 60) + '" is too large to save (' + sizeText(b) + ').'; }));
  });
  chunks(Array.isArray(book.contentSections) ? book.contentSections : [], SECTIONS_PER_PART).forEach(function (list, i) {
    parts.push(partOf('sections:' + i, list, function (b) { return 'Part of the manuscript is too large to save (' + sizeText(b) + ' in one block of ' + list.length + ' sections).'; }));
  });
  chunks(Array.isArray(book.imageAssets) ? book.imageAssets : [], ASSETS_PER_PART).forEach(function (list, i) {
    parts.push(partOf('assets:' + i, list, function (b) { return 'The photo list is too large to save (' + sizeText(b) + '). A photo must be uploaded, not pasted into the book.'; }));
  });
  var core = {};
  CORE_KEYS.forEach(function (k) { if (book[k] !== undefined) core[k] = book[k]; });
  /* the dashboard's picture is an address; a picture pasted in as data would make every list heavy */
  if (typeof core.coverThumbnail !== 'string' || core.coverThumbnail.length > 2048) core.coverThumbnail = '';
  var coreJson = JSON.stringify(core);
  if (Buffer.byteLength(coreJson) > MAX_CORE_BYTES) throw httpErr(413, 'The book\'s settings and design system are too large to save (' + sizeText(Buffer.byteLength(coreJson)) + ').', { code: 'too-large' });
  var dims = core.dimensions || {}, words = 0;
  pages.forEach(function (p) {
    (Array.isArray(p.elements) ? p.elements : []).forEach(function (el) {
      if (el && typeof el.text === 'string' && el.text.trim()) words += el.text.trim().split(/\s+/).length;
    });
  });
  return {
    name: str(book.name, 200).trim() || 'Untitled book',
    status: STATUSES.indexOf(book.status) !== -1 ? book.status : 'draft',
    core: coreJson,
    summary: { subtitle: str(core.subtitle, 300), category: str(core.category, 120), unit: str(core.unit, 8), coverThumbnail: core.coverThumbnail,
      widthMm: +dims.widthMm || 0, heightMm: +dims.heightMm || 0, pageCount: pages.length, wordCount: words },
    parts: parts
  };
}

/* the stored book -> the editor's BookProject */
function assemble(id, root, dataById) {
  var core = {};
  try { core = JSON.parse(root.core || '{}') || {}; } catch (e) { core = {}; }
  var book = Object.assign({}, core, { id: id, name: root.name, status: root.status || 'draft', pages: [], masterPages: [], contentSections: [], imageAssets: [],
    createdAt: root.createdAt || '', updatedAt: root.updatedAt || '' });
  (root.parts || []).forEach(function (p) {
    var value = JSON.parse(dataById[p.id]), kind = String(p.k).split(':')[0];
    if (kind === 'page') book.pages.push(value);
    else if (kind === 'master') book.masterPages.push(value);
    else if (kind === 'sections') book.contentSections = book.contentSections.concat(value);
    else if (kind === 'assets') book.imageAssets = book.imageAssets.concat(value);
  });
  return book;
}

function writeParts(fb, id, parts) {
  var groups = [], cur = [], bytes = 0;
  parts.forEach(function (p) {
    if (cur.length && (cur.length >= BATCH_WRITES || bytes + p.data.length > BATCH_BYTES)) { groups.push(cur); cur = []; bytes = 0; }
    cur.push(p); bytes += p.data.length;
  });
  if (cur.length) groups.push(cur);
  return groups.reduce(function (chain, group) {
    return chain.then(function () {
      var batch = fb.db.batch();
      group.forEach(function (p) { batch.set(partRef(fb, id, p.id), { k: p.key, data: p.data }); });
      return batch.commit();
    });
  }, Promise.resolve());
}
function deleteParts(fb, id, ids) {
  return chunks(ids, BATCH_WRITES).reduce(function (chain, group) {
    return chain.then(function () {
      var batch = fb.db.batch();
      group.forEach(function (pid) { batch.delete(partRef(fb, id, pid)); });
      return batch.commit();
    });
  }, Promise.resolve());
}

function readParts(fb, id, root) {
  var refs = (root.parts || []).map(function (p) { return partRef(fb, id, p.id); });
  return chunks(refs, 100).reduce(function (chain, group) {
    return chain.then(function (acc) {
      return group.length ? fb.db.getAll.apply(fb.db, group).then(function (snaps) {
        snaps.forEach(function (s) { if (s.exists) acc[s.id] = (s.data() || {}).data; });
        return acc;
      }) : acc;
    });
  }, Promise.resolve({}));
}

/* -> { book, rev, root } or throws 404 */
function loadBook(fb, id, attempt) {
  return bookRef(fb, id).get().then(function (snap) {
    var root = snap.exists ? snap.data() : null;
    if (!root || root.deletedAt) throw httpErr(404, 'This book does not exist, or it has been deleted.', { code: 'not-found' });
    return readParts(fb, id, root).then(function (byId) {
      var missing = (root.parts || []).filter(function (p) { return typeof byId[p.id] !== 'string'; });
      if (missing.length) {
        /* a save finished between reading the book and its parts: read it again, once */
        if (!attempt) return loadBook(fb, id, 1);
        throw new Error(missing.length + ' part(s) of book ' + id + ' are missing: ' + missing.slice(0, 3).map(function (p) { return p.k; }).join(', '));
      }
      return { book: assemble(id, root, byId), rev: root.rev || 0, root: root };
    });
  });
}

/* throws when a save based on baseRev may not go ahead */
function checkRev(cur, baseRev, who) {
  if (cur && cur.deletedAt) throw httpErr(410, 'This book has been deleted, so it cannot be saved.', { code: 'deleted' });
  if (!cur) {
    if (baseRev) throw httpErr(410, 'This book no longer exists, so it cannot be saved.', { code: 'gone' });
    return;
  }
  if (baseRev == null) throw httpErr(409, 'A book with this id already exists. Reload the page and try again.', { code: 'exists' });
  if (Number(cur.rev || 0) !== Number(baseRev)) {
    var by = String(cur.updatedBy || '');
    throw httpErr(409, (by && by !== who ? by + ' saved this book' : 'This book was saved in another tab or window') +
      ' after you opened it. Reload it to see the latest version, then make your change again.',
      { code: 'stale', rev: cur.rev || 0, updatedBy: by, updatedAt: cur.updatedAt || '' });
  }
}

/* ---------- routes: books ---------- */
function handleMe(req, res, ctx) { sendJson(res, 200, { role: ctx.role, email: ctx.who }); }

function summaryOf(doc) {
  var d = doc.data() || {}, s = d.summary || {};
  return { id: doc.id, name: d.name || 'Untitled book', status: d.status || 'draft', subtitle: s.subtitle || '', category: s.category || '',
    unit: s.unit || 'mm', coverThumbnail: s.coverThumbnail || '', dimensions: { widthMm: s.widthMm || 0, heightMm: s.heightMm || 0 },
    pageCount: s.pageCount || 0, wordCount: s.wordCount || 0, rev: d.rev || 0, createdAt: d.createdAt || '', createdBy: d.createdBy || '', updatedAt: d.updatedAt || '', updatedBy: d.updatedBy || '' };
}
function handleList(req, res, ctx) {
  ctx.fb.db.collection(col('books')).select('name', 'status', 'summary', 'rev', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt').limit(2000).get()
    .then(function (snap) {
      var books = snap.docs.filter(function (d) { return !(d.data() || {}).deletedAt; }).map(summaryOf);
      books.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
      sendJson(res, 200, { books: books });
    }).catch(function (err) { failWith(res, 'list', err, 'The books could not be loaded. Please try again.'); });
}

function handleGetBook(req, res, ctx) {
  var id = queryOf(req).get('id') || '';
  if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'A valid book id is required.' });
  loadBook(ctx.fb, id).then(function (r) {
    sendJson(res, 200, { book: r.book, rev: r.rev, updatedBy: r.root.updatedBy || '' });
  }).catch(function (err) { failWith(res, 'load ' + id, err, 'This book could not be loaded. Please try again.'); });
}

function handlePutBook(req, res, ctx) {
  readJson(req, res, MAX_BOOK_REQUEST, 'This book is too large to save in one go (over 24 MB).', function (body) {
    var split;
    try { split = splitBook(body.book); } catch (err) { return failWith(res, 'save', err); }
    var fb = ctx.fb, id = body.book.id, ref = bookRef(fb, id), now = new Date().toISOString();
    var baseRev = body.baseRev == null ? null : Number(body.baseRev);
    if (baseRev != null && !(baseRev >= 0)) return sendJson(res, 400, { error: 'baseRev must be a number.' });
    var fresh = [];
    ref.get().then(function (snap) {
      var cur = snap.exists ? snap.data() : null;
      checkRev(cur, baseRev, ctx.who);
      var have = {};
      (cur && cur.parts || []).forEach(function (p) { have[p.id] = 1; });
      fresh = split.parts.filter(function (p) { return !have[p.id]; });
      return writeParts(fb, id, fresh);
    }).then(function () {
      return fb.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (s2) {
          var cur = s2.exists ? s2.data() : null;
          checkRev(cur, baseRev, ctx.who);
          var rev = (cur && cur.rev || 0) + 1;
          var doc = { name: split.name, status: split.status, core: split.core, summary: split.summary,
            parts: split.parts.map(function (p) { return { k: p.key, id: p.id }; }), rev: rev, updatedAt: now, updatedBy: ctx.who };
          if (cur) tx.update(ref, doc);
          else tx.set(ref, Object.assign(doc, { createdAt: now, createdBy: ctx.who, deletedAt: null }));
          return { rev: rev, old: cur ? cur.parts || [] : [] };
        });
      }).then(function (done) {
        var keep = {};
        split.parts.forEach(function (p) { keep[p.id] = 1; });
        var stale = done.old.filter(function (p) { return !keep[p.id]; }).map(function (p) { return p.id; });
        deleteParts(fb, id, stale).catch(function (err) { console.error('books: old parts of ' + id + ' were not deleted — ' + (err && err.message)); });
        sendJson(res, 200, { rev: done.rev, updatedAt: now });
      }, function (err) {
        /* this save lost: what it wrote and nothing points to is taken away again */
        var mine = fresh.map(function (p) { return p.id; });
        return ref.get().then(function (s3) {
          var used = {};
          ((s3.exists && s3.data().parts) || []).forEach(function (p) { used[p.id] = 1; });
          return deleteParts(fb, id, mine.filter(function (x) { return !used[x]; }));
        }).catch(function () { /* best effort */ }).then(function () { throw err; });
      });
    }).catch(function (err) { failWith(res, 'save ' + id, err, 'The book could not be saved. Please try again.'); });
  });
}

function handleStatus(req, res, ctx) {
  readJson(req, res, 4096, 'That request is too large.', function (body) {
    var id = String(body.id || ''), status = String(body.status || '');
    if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'A valid book id is required.' });
    if (STATUSES.indexOf(status) === -1) return sendJson(res, 400, { error: 'status must be one of ' + STATUSES.join(', ') + '.' });
    var ref = bookRef(ctx.fb, id), now = new Date().toISOString();
    ctx.fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var cur = snap.exists ? snap.data() : null;
        if (!cur || cur.deletedAt) throw httpErr(404, 'This book does not exist, or it has been deleted.', { code: 'not-found' });
        var rev = (cur.rev || 0) + 1;
        tx.update(ref, { status: status, rev: rev, updatedAt: now, updatedBy: ctx.who });
        return rev;
      });
    }).then(function (rev) { sendJson(res, 200, { rev: rev, status: status, updatedAt: now }); })
      .catch(function (err) { failWith(res, 'status ' + id, err, 'The book could not be changed. Please try again.'); });
  });
}

function handleDeleteBook(req, res, ctx) {
  var id = queryOf(req).get('id') || '';
  if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'A valid book id is required.' });
  var ref = bookRef(ctx.fb, id), now = new Date().toISOString();
  ctx.fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var cur = snap.exists ? snap.data() : null;
      if (!cur || cur.deletedAt) throw httpErr(404, 'This book does not exist, or it has already been deleted.', { code: 'not-found' });
      tx.update(ref, { deletedAt: now, deletedBy: ctx.who, rev: (cur.rev || 0) + 1, updatedAt: now, updatedBy: ctx.who });
    });
  }).then(function () { sendJson(res, 200, { ok: true }); })
    .catch(function (err) { failWith(res, 'delete ' + id, err, 'The book could not be deleted. Please try again.'); });
}

/* ---------- routes: versions ---------- */
function versionsCol(fb, id) { return bookRef(fb, id).collection('versions'); }
function versionFile(fb, id, vid) { return fb.bucket.file(filePrefix() + id + '/versions/' + vid + '.json.gz'); }
function liveBook(fb, id) {
  return bookRef(fb, id).get().then(function (snap) {
    if (!snap.exists || (snap.data() || {}).deletedAt) throw httpErr(404, 'This book does not exist, or it has been deleted.', { code: 'not-found' });
    return snap.data();
  });
}
function versionMeta(id, doc) {
  var d = doc.data() || {};
  return { id: doc.id, projectId: id, label: d.label || '', summary: d.summary || '', pageCount: d.pageCount || 0, totalWords: d.totalWords || 0,
    createdAt: d.createdAt || '', createdBy: d.createdBy || '' };
}
function handleListVersions(req, res, ctx) {
  var id = queryOf(req).get('id') || '';
  if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'A valid book id is required.' });
  liveBook(ctx.fb, id).then(function () {
    return versionsCol(ctx.fb, id).orderBy('createdAt', 'desc').limit(200).get();
  }).then(function (snap) {
    sendJson(res, 200, { versions: snap.docs.map(function (d) { return versionMeta(id, d); }) });
  }).catch(function (err) { failWith(res, 'versions ' + id, err, 'The versions could not be loaded. Please try again.'); });
}
function handleSaveVersion(req, res, ctx) {
  readJson(req, res, MAX_VERSION_BYTES, 'This version is too large to keep (over 24 MB).', function (body) {
    var id = String(body.bookId || ''), v = body.version || {};
    if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'A valid book id is required.' });
    if (!ID_RE.test(String(v.id || ''))) return sendJson(res, 400, { error: 'The version has no valid id.' });
    if (!v.snapshot || typeof v.snapshot !== 'object') return sendJson(res, 400, { error: 'The version has nothing in it.' });
    var fb = ctx.fb, now = new Date().toISOString();
    var meta = { label: str(v.label, 120).trim() || 'Version', summary: str(v.summary, 600), pageCount: Math.max(0, +v.pageCount || 0),
      totalWords: Math.max(0, +v.totalWords || 0), createdAt: now, createdBy: ctx.who };
    var gz = zlib.gzipSync(Buffer.from(JSON.stringify(v.snapshot), 'utf8'));
    var docRef = versionsCol(fb, id).doc(v.id);
    liveBook(fb, id).then(function () { return docRef.get(); }).then(function (snap) {
      if (snap.exists) throw httpErr(409, 'This version has already been kept.', { code: 'exists' });
      return versionFile(fb, id, v.id).save(gz, { resumable: false, metadata: { contentType: 'application/gzip', cacheControl: 'private, no-store' } });
    }).then(function () { return docRef.create(meta); })
      .then(function () { sendJson(res, 200, { version: Object.assign({ id: v.id, projectId: id }, meta) }); })
      .catch(function (err) { failWith(res, 'version ' + id, err, 'The version could not be kept. Please try again.'); });
  });
}
function handleGetVersion(req, res, ctx) {
  var q = queryOf(req), id = q.get('id') || '', vid = q.get('versionId') || '';
  if (!ID_RE.test(id) || !ID_RE.test(vid)) return sendJson(res, 400, { error: 'A valid book id and version id are required.' });
  var fb = ctx.fb, meta;
  liveBook(fb, id).then(function () { return versionsCol(fb, id).doc(vid).get(); }).then(function (snap) {
    if (!snap.exists) throw httpErr(404, 'This version does not exist.', { code: 'not-found' });
    meta = versionMeta(id, snap);
    return versionFile(fb, id, vid).download();
  }).then(function (r) {
    var snapshot = JSON.parse(zlib.gunzipSync(r[0]).toString('utf8'));
    sendJson(res, 200, { version: Object.assign(meta, { snapshot: snapshot }) });
  }).catch(function (err) { failWith(res, 'version ' + id + '/' + vid, err, 'This version could not be loaded. Please try again.'); });
}

/* ---------- routes: templates and font collections ---------- */
function templateOut(doc) {
  var d = doc.data() || {}, payload = {};
  try { payload = JSON.parse(d.payload || '{}') || {}; } catch (e) { payload = {}; }
  return { id: doc.id, templateKind: d.templateKind, collectionName: d.collectionName || '', category: d.category || '', title: d.title || '',
    description: d.description || '', tags: Array.isArray(d.tags) ? d.tags : [], payload: payload,
    createdAt: d.createdAt || '', createdBy: d.createdBy || '', updatedAt: d.updatedAt || '', updatedBy: d.updatedBy || '' };
}
function handleListTemplates(req, res, ctx) {
  ctx.fb.db.collection(col('bookTemplates')).limit(1000).get().then(function (snap) {
    var list = snap.docs.map(templateOut);
    list.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    sendJson(res, 200, { templates: list });
  }).catch(function (err) { failWith(res, 'templates', err, 'The saved templates could not be loaded. Please try again.'); });
}
function handlePutTemplate(req, res, ctx) {
  readJson(req, res, MAX_TEMPLATE_BYTES + 64 * 1024, 'This template is too large to keep (over 900 KB).', function (body) {
    var t = body.template || {};
    if (!ID_RE.test(String(t.id || ''))) return sendJson(res, 400, { error: 'The template has no valid id.' });
    if (TEMPLATE_KINDS.indexOf(t.templateKind) === -1) return sendJson(res, 400, { error: 'templateKind must be one of ' + TEMPLATE_KINDS.join(', ') + '.' });
    var payload = JSON.stringify(t.payload && typeof t.payload === 'object' ? t.payload : {});
    if (Buffer.byteLength(payload) > MAX_TEMPLATE_BYTES) return sendJson(res, 413, { error: 'This template is too large to keep (over 900 KB).' });
    var ref = ctx.fb.db.collection(col('bookTemplates')).doc(t.id), now = new Date().toISOString();
    var doc = { templateKind: t.templateKind, collectionName: str(t.collectionName, 80) || 'My Templates', category: str(t.category, 80), title: str(t.title, 160) || 'Untitled template',
      description: str(t.description, 600), tags: (Array.isArray(t.tags) ? t.tags : []).slice(0, 30).map(function (x) { return str(x, 40); }),
      payload: payload, updatedAt: now, updatedBy: ctx.who };
    ctx.fb.db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        /* the date it was first kept never changes (the AI Studio export reset it on every save, and its rules then refused the save) */
        if (snap.exists) { var cur = snap.data() || {}; doc.createdAt = cur.createdAt || now; doc.createdBy = cur.createdBy || ctx.who; }
        else { doc.createdAt = now; doc.createdBy = ctx.who; }
        tx.set(ref, doc);
      });
    }).then(function () { sendJson(res, 200, { template: templateOut({ id: t.id, data: function () { return doc; } }) }); })
      .catch(function (err) { failWith(res, 'template ' + t.id, err, 'The template could not be kept. Please try again.'); });
  });
}
function handleDeleteTemplate(req, res, ctx) {
  var id = queryOf(req).get('id') || '';
  if (!ID_RE.test(id)) return sendJson(res, 400, { error: 'A valid template id is required.' });
  ctx.fb.db.collection(col('bookTemplates')).doc(id).delete().then(function () { sendJson(res, 200, { ok: true }); })
    .catch(function (err) { failWith(res, 'template delete ' + id, err, 'The template could not be deleted. Please try again.'); });
}
function ownerKey(who) { return crypto.createHash('sha256').update(who).digest('hex').slice(0, 16); }
function handleListFontCollections(req, res, ctx) {
  ctx.fb.db.collection(col('bookFontCollections')).where('owner', '==', ctx.who).limit(200).get().then(function (snap) {
    sendJson(res, 200, { collections: snap.docs.map(function (doc) {
      var d = doc.data() || {}, presets = [];
      try { presets = JSON.parse(d.presets || '[]') || []; } catch (e) { presets = []; }
      return { id: d.id, name: d.name || '', fonts: Array.isArray(d.fonts) ? d.fonts : [], presets: presets, updatedAt: d.updatedAt || '' };
    }) });
  }).catch(function (err) { failWith(res, 'font collections', err, 'Your font collections could not be loaded. Please try again.'); });
}
function handlePutFontCollection(req, res, ctx) {
  readJson(req, res, 512 * 1024, 'This font collection is too large to keep.', function (body) {
    var c = body.collection || {};
    if (!ID_RE.test(String(c.id || ''))) return sendJson(res, 400, { error: 'The collection has no valid id.' });
    var presets = JSON.stringify(Array.isArray(c.presets) ? c.presets.slice(0, 100) : []);
    if (Buffer.byteLength(presets) > 400 * 1024) return sendJson(res, 413, { error: 'This font collection has too many presets to keep.' });
    var now = new Date().toISOString();
    var doc = { owner: ctx.who, id: c.id, name: str(c.name, 80) || 'My Editorial Fonts',
      fonts: (Array.isArray(c.fonts) ? c.fonts : []).slice(0, 300).map(function (f) { return str(f, 80); }).filter(Boolean), presets: presets, updatedAt: now };
    ctx.fb.db.collection(col('bookFontCollections')).doc(ownerKey(ctx.who) + '_' + c.id).set(doc)
      .then(function () { sendJson(res, 200, { collection: { id: c.id, name: doc.name, fonts: doc.fonts, presets: JSON.parse(presets), updatedAt: now } }); })
      .catch(function (err) { failWith(res, 'font collection', err, 'The font collection could not be kept. Please try again.'); });
  });
}

/* ---------- routes: photos ---------- */
/* the photo's real kind from its first bytes (never the name or the header a browser sent) */
function sniffPhoto(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  var t = buf.slice(0, 4).toString('hex');
  if (t === '49492a00' || t === '4d4d002a') return { ext: 'tif', type: 'image/tiff' };
  return null;
}
function assetUrl(id, variant) { return '/api/books/asset/' + id + '/' + variant; }
function handleUploadAsset(req, res, ctx) {
  readBuffer(req, res, MAX_ASSET_BYTES, 'This photo is larger than 30 MB. Save it as a high-quality JPEG under 30 MB and upload it again.', function (buf) {
    var kind = sniffPhoto(buf);
    if (!kind) return sendJson(res, 415, { error: 'Only JPG, PNG, WebP and TIFF photos can be added.', code: 'not-a-photo' });
    var sharp;
    try { sharp = require('sharp'); } catch (e) { return failWith(res, 'asset', e, 'Photos cannot be processed on the server just now. Please try again later.'); }
    var fb = ctx.fb, name = headerName(req), id = 'as_' + crypto.randomBytes(10).toString('hex'), base = filePrefix() + 'assets/' + id + '/';
    var now = new Date().toISOString(), meta, objects = {};
    function img() { return sharp(buf, { failOn: 'none', limitInputPixels: 300000000 }).rotate(); }
    function put(variant, body, type) {
      var path = base + variant + '.' + (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/tiff' ? 'tif' : 'jpg');
      objects[variant] = { path: path, type: type };
      return fb.bucket.file(path).save(body, { resumable: false, metadata: { contentType: type, cacheControl: 'private, max-age=31536000' } });
    }
    sharp(buf, { failOn: 'none', limitInputPixels: 300000000 }).metadata().then(function (m) {
      meta = m || {};
      if (!meta.width || !meta.height) throw httpErr(422, 'This photo could not be read. Save it again as a JPEG and try once more.', { code: 'unreadable' });
      var alpha = !!meta.hasAlpha;
      var webType = alpha ? 'image/webp' : 'image/jpeg';
      function web(pipe, q) { return alpha ? pipe.webp({ quality: q }) : pipe.jpeg({ quality: q, chromaSubsampling: '4:4:4' }); }
      /* print: the photo as uploaded, unless a browser cannot draw it (TIFF): then a full-size copy it can */
      var print = kind.type === 'image/tiff'
        ? (alpha ? img().png({ compressionLevel: 6 }) : img().jpeg({ quality: 92, chromaSubsampling: '4:4:4' })).toBuffer().then(function (b) { return put('print', b, alpha ? 'image/png' : 'image/jpeg'); })
        : Promise.resolve(null);
      return Promise.all([
        put('original', buf, kind.type),
        print,
        web(img().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }), 84).toBuffer().then(function (b) { return put('display', b, webType); }),
        web(img().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }), 78).toBuffer().then(function (b) { return put('thumb', b, webType); })
      ]);
    }).then(function () {
      if (!objects.print) objects.print = objects.original;
      var swap = (meta.orientation || 1) >= 5;
      var doc = { name: name, mimeType: objects.print.type, widthPx: swap ? meta.height : meta.width, heightPx: swap ? meta.width : meta.height,
        sizeBytes: buf.length, uploadedAt: now, uploadedBy: ctx.who, objects: objects };
      return fb.db.collection(col('bookAssets')).doc(id).set(doc).then(function () { return doc; });
    }).then(function (doc) {
      sendJson(res, 200, { asset: { id: id, name: name, url: assetUrl(id, 'display'), printUrl: assetUrl(id, 'print'), thumbUrl: assetUrl(id, 'thumb'),
        widthPx: doc.widthPx, heightPx: doc.heightPx, sizeBytes: doc.sizeBytes, mimeType: kind.type, category: 'Uploaded', tags: [], uploadedAt: now, source: 'uploaded' } });
    }).catch(function (err) {
      /* nothing half-kept: the files written are removed */
      Object.keys(objects).forEach(function (k) { fb.bucket.file(objects[k].path).delete().catch(function () {}); });
      failWith(res, 'asset ' + name, err, 'The photo could not be uploaded. Please try again.');
    });
  });
}
var ASSET_CACHE = new Map(), ASSET_CACHE_MAX = 2000;
function handleGetAsset(req, res, ctx, m) {
  var id = m[1], variant = m[2], etag = '"' + id + '-' + variant + '"';
  if (String(req.headers['if-none-match'] || '') === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' }); return res.end(); }
  var hit = ASSET_CACHE.get(id);
  (hit ? Promise.resolve(hit) : ctx.fb.db.collection(col('bookAssets')).doc(id).get().then(function (snap) {
    var objects = snap.exists ? (snap.data() || {}).objects : null;
    if (objects) { if (ASSET_CACHE.size >= ASSET_CACHE_MAX) ASSET_CACHE.clear(); ASSET_CACHE.set(id, objects); }
    return objects;
  })).then(function (objects) {
    var o = objects && objects[variant];
    if (!o) return sendJson(res, 404, { error: 'This photo does not exist.' });
    var stream = ctx.fb.bucket.file(o.path).createReadStream(), started = false;
    stream.on('error', function (err) {
      if (!started && !res.headersSent) return failWith(res, 'asset read ' + id, err, 'This photo could not be loaded.');
      try { res.destroy(); } catch (e) { /* gone */ }
    });
    stream.once('data', function () { started = true; });
    res.writeHead(200, { 'Content-Type': o.type, 'Cache-Control': 'private, max-age=31536000, immutable', ETag: etag, 'X-Content-Type-Options': 'nosniff' });
    stream.pipe(res);
  }).catch(function (err) { failWith(res, 'asset ' + id, err, 'This photo could not be loaded.'); });
}

/* ---------- routes: manuscripts ---------- */
function decodeXml(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(+d); }).replace(/&amp;/g, '&');
}
/* a .docx: each paragraph (w:p) as a block of its own, its style kept to tell headings; -> { text, headings: Set } */
function docxText(buf) {
  var JSZip = require('jszip');
  return JSZip.loadAsync(buf).then(function (zip) {
    var f = zip.file('word/document.xml');
    if (!f) throw httpErr(422, 'This Word file has no text in it that can be read. Save it again as .docx and try once more.', { code: 'unreadable' });
    return f.async('string');
  }).then(function (xml) {
    var blocks = [], headings = new Set();
    (xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []).forEach(function (p) {
      var style = (/<w:pStyle\s+w:val="([^"]+)"/.exec(p) || [])[1] || '';
      var text = p.replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:br\b[^>]*\/>/g, '\n')
        .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, function (m, t) { return '\u0001' + t + '\u0002'; });
      text = (text.match(/\u0001[\s\S]*?\u0002|[\t\n]/g) || []).map(function (s) { return s.charAt(0) === '\u0001' ? s.slice(1, -1) : (s === '\t' ? ' ' : '\n'); }).join('');
      text = decodeXml(text).replace(/[  ]+/g, ' ').trim();
      if (!text) return;
      if (/^(title|subtitle|heading\s?\d)/i.test(style.replace(/[^a-z0-9 ]/gi, ' ').trim())) headings.add(text);
      blocks.push(text);
    });
    return { text: blocks.join('\n\n'), headings: headings };
  });
}
/* RTF's words: groups that are not text (font and colour tables, styles, pictures, document info, any \* group) are
   left out, \par and \line end lines, \'hh and \uN are characters. (The AI Studio export deleted every group that began
   with a control word, the whole document among them, so an RTF came back empty.) */
var RTF_SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|header[lrf]?|footer[lrf]?|object|themedata|colorschememapping|datastore|latentstyles|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|mmathPr|filetbl|revtbl|pgdsctbl|fldinst|listtext)$/;
var CP1252 = { 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x85: '…', 0x80: '€' };
var RTF_WORDS = { emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', tab: ' ', line: '\n', par: '\n\n', sect: '\n\n', page: '\n\n' };
function stripRtf(input) {
  var s = String(input || ''), out = '', i = 0, stack = [], skip = false;
  while (i < s.length) {
    var c = s.charAt(i);
    if (c === '{') { stack.push(skip); i++; continue; }
    if (c === '}') { skip = stack.length ? stack.pop() : false; i++; continue; }
    if (c === '\\') {
      var n = s.charAt(i + 1);
      if (n === '\\' || n === '{' || n === '}') { if (!skip) out += n; i += 2; continue; }
      if (n === '*') { skip = true; i += 2; continue; }
      if (n === "'") { var code = parseInt(s.substr(i + 2, 2), 16); if (!skip && isFinite(code)) out += CP1252[code] || String.fromCharCode(code); i += 4; continue; }
      var m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 40));
      if (!m) { i += 2; continue; }
      i += m[0].length;
      if (RTF_SKIP.test(m[1])) { skip = true; continue; }
      if (skip) continue;
      if (m[1] === 'u' && m[2]) {
        var u = parseInt(m[2], 10); if (u < 0) u += 65536;
        out += String.fromCharCode(u);
        if (s.charAt(i) === '?') i++; else if (s.charAt(i) === '\\' && s.charAt(i + 1) === "'") i += 4;   // the stand-in character after it
      } else if (Object.prototype.hasOwnProperty.call(RTF_WORDS, m[1])) out += RTF_WORDS[m[1]];
      continue;
    }
    if (c !== '\r' && c !== '\n' && !skip) out += c;
    i++;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function csvText(text) {
  return String(text).split(/\r?\n/).filter(function (r) { return r.trim(); })
    .map(function (row) { return row.split(',').map(function (c) { return c.trim().replace(/^"|"$/g, ''); }).join(' — '); }).join('\n\n');
}
function splitManuscript(rawText, sourceTitle, headings) {
  var stamp = Date.now();
  return String(rawText || '').split(/\n{2,}/).map(function (b) { return b.trim(); }).filter(Boolean).map(function (block, idx) {
    var quote = /^["“]/.test(block);
    var heading = headings && headings.size ? headings.has(block) : (block.length < 75 && !/[.!?:;,]$/.test(block) && !quote);
    return { id: 'sec_' + stamp + '_' + idx, title: heading ? block : idx === 0 ? String(sourceTitle || '').replace(/\.[^.]+$/, '') : 'Section ' + (idx + 1),
      kind: heading ? 'heading' : quote ? 'quote' : 'body', body: block, orderIndex: idx };
  });
}
function handleManuscript(req, res, ctx) {
  readBuffer(req, res, MAX_MANUSCRIPT_BYTES, 'This file is larger than 20 MB. Split it into parts and upload them one by one.', function (buf) {
    var name = headerName(req), ext = extOf(name), fromPdf = String(req.headers['x-source-format'] || '') === 'pdf-text';
    var job;
    if (fromPdf || ext === 'txt' || ext === 'md' || ext === 'text') job = Promise.resolve({ text: buf.toString('utf8') });
    else if (ext === 'docx') job = docxText(buf);
    else if (ext === 'rtf') job = Promise.resolve({ text: stripRtf(buf.toString('utf8')) });
    else if (ext === 'csv') job = Promise.resolve({ text: csvText(buf.toString('utf8')) });
    else if (ext === 'doc') return sendJson(res, 415, { error: 'Old Word files (.doc) cannot be read. Open it in Word, save it as .docx, and upload that.' });
    else if (ext === 'pdf') return sendJson(res, 415, { error: 'This PDF has to be read in the browser first. Reload the page and try again.' });
    else return sendJson(res, 415, { error: 'Upload a Word (.docx), PDF, RTF, CSV or plain-text file.' });
    job.then(function (r) {
      var raw = String(r.text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!raw) throw httpErr(422, 'No text was found in this file.', { code: 'empty' });
      sendJson(res, 200, { filename: name, rawText: raw, sections: splitManuscript(raw, name, r.headings), wordCount: raw.split(/\s+/).filter(Boolean).length });
    }).catch(function (err) {
      if (err && !err.isPublic && /zip|central directory|end of data/i.test(String(err.message))) err = httpErr(422, 'This Word file could not be opened. Save it again as .docx and try once more.', { code: 'unreadable' });
      failWith(res, 'manuscript ' + name, err, 'The file could not be read. Please try again.');
    });
  });
}

/* ---------- routes: InDesign ---------- */
var INDD_GUIDANCE = 'InDesign (.indd) files are Adobe\'s own format and cannot be read here. In InDesign, choose File › Export › InDesign Markup (IDML), ' +
  'or export high-resolution PDF spreads, and upload the .idml or .pdf instead.';
var PT_MM = 25.4 / 72;
function cmykHex(c, m, y, k) {
  function ch(v) { return Math.max(0, Math.min(255, Math.round(255 * (1 - v / 100) * (1 - k / 100)))); }
  return '#' + [ch(c), ch(m), ch(y)].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('').toUpperCase();
}
function parseIdml(buf, filename) {
  var JSZip = require('jszip');
  return JSZip.loadAsync(buf).then(function (zip) {
    if (!zip.file('designmap.xml')) throw httpErr(422, 'This is not an InDesign IDML package. In InDesign, choose File › Export › InDesign Markup (IDML).', { code: 'not-idml' });
    function read(name) {
      var f = zip.file(name);
      if (!f) return Promise.resolve('');
      var size = f._data && f._data.uncompressedSize;
      if (size > 40 * MB) return Promise.resolve('');
      return f.async('string');
    }
    var names = Object.keys(zip.files);
    var spreads = names.filter(function (n) { return /^Spreads\/.+\.xml$/.test(n); });
    var masters = names.filter(function (n) { return /^MasterSpreads\/.+\.xml$/.test(n); });
    return Promise.all([read('Resources/Preferences.xml'), read('Resources/Fonts.xml'), read('Resources/Styles.xml'), read('Resources/Graphic.xml'),
      masters.length ? read(masters[0]) : Promise.resolve(''), Promise.all(spreads.slice(0, 400).map(read))]).then(function (r) {
      var prefs = r[0], fontsXml = r[1], styles = r[2], graphic = r[3], master = r[4], spreadXml = r[5];
      var dp = (/<DocumentPreference\b[^>]*>/.exec(prefs) || [''])[0];
      var w = +((/PageWidth="([\d.]+)"/.exec(dp) || [])[1]) || 680.3, h = +((/PageHeight="([\d.]+)"/.exec(dp) || [])[1]) || 850.4;
      var facing = /FacingPages="true"/.test(dp);
      var mp = (/<MarginPreference\b[^>]*>/.exec(master) || /<MarginPreference\b[^>]*>/.exec(prefs) || [''])[0];
      function attr(s, n) { var v = +((new RegExp(n + '="([\\d.]+)"').exec(s) || [])[1]); return isFinite(v) ? v : null; }
      var fonts = new Set();
      (fontsXml.match(/<FontFamily\b[^>]*\bName="([^"]+)"/g) || []).forEach(function (m) { fonts.add(decodeXml(/Name="([^"]+)"/.exec(m)[1])); });
      (styles.match(/<AppliedFont[^>]*>([^<]+)<\/AppliedFont>/g) || []).forEach(function (m) { fonts.add(decodeXml(m.replace(/<[^>]+>/g, '').trim())); });
      var colors = [];
      (graphic.match(/<Color\b[^>]*>/g) || []).forEach(function (m) {
        var space = (/Space="([A-Za-z]+)"/.exec(m) || [])[1], vals = ((/ColorValue="([\d.\s-]+)"/.exec(m) || [])[1] || '').trim().split(/\s+/).map(Number);
        var name = (/Name="([^"]+)"/.exec(m) || [])[1] || '';
        if (/^(Registration|Paper|None)$/i.test(name)) return;
        var hex = '';
        if (space === 'CMYK' && vals.length === 4) hex = cmykHex(vals[0], vals[1], vals[2], vals[3]);
        else if (space === 'RGB' && vals.length === 3) hex = '#' + vals.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join('').toUpperCase();
        if (hex && colors.indexOf(hex) === -1) colors.push(hex);
      });
      var pageCount = spreadXml.reduce(function (n, x) { return n + (x.match(/<Page\b/g) || []).length; }, 0);
      var gutter = attr(mp, 'ColumnGutter');
      return {
        filename: filename, widthMm: Math.round(w * PT_MM * 10) / 10, heightMm: Math.round(h * PT_MM * 10) / 10, facingPages: facing,
        columns: attr(mp, 'ColumnCount') || 1, columnGapMm: gutter == null ? null : Math.round(gutter * PT_MM * 10) / 10,
        margins: mp ? { top: Math.round((attr(mp, 'Top') || 0) * PT_MM * 10) / 10, bottom: Math.round((attr(mp, 'Bottom') || 0) * PT_MM * 10) / 10,
          inner: Math.round((attr(mp, 'Left') || 0) * PT_MM * 10) / 10, outer: Math.round((attr(mp, 'Right') || 0) * PT_MM * 10) / 10 } : null,
        spreadCount: spreads.length, pageCount: pageCount, detectedFonts: Array.from(fonts).filter(Boolean).slice(0, 24), detectedColors: colors.slice(0, 16),
        archiveEntries: names.length
      };
    });
  });
}
function handleIdml(req, res, ctx) {
  readBuffer(req, res, MAX_IDML_BYTES, 'This file is larger than 30 MB.', function (buf) {
    var name = headerName(req), ext = extOf(name);
    if (ext === 'indd') return sendJson(res, 200, { isNativeIndd: true, filename: name, guidance: INDD_GUIDANCE });
    if (ext !== 'idml') return sendJson(res, 415, { error: 'Upload an InDesign Markup file (.idml).' });
    parseIdml(buf, name).then(function (idml) { sendJson(res, 200, { isNativeIndd: false, idml: idml }); })
      .catch(function (err) {
        if (err && !err.isPublic) err = httpErr(422, 'This IDML file could not be read. Export it from InDesign again and try once more.', { code: 'unreadable' });
        failWith(res, 'idml ' + name, err);
      });
  });
}

/* ---------- routes: Google Fonts ---------- */
var FONTS = { at: 0, body: null }, FONTS_MS = 24 * 3600 * 1000;
var STYLE_TAG = { serif: 'editorial', display: 'luxury', monospace: 'technical', handwriting: 'calligraphic', 'sans-serif': 'modern' };
function fontItem(family, category, weights, italic, variable, scripts) {
  var cat = ['serif', 'sans-serif', 'display', 'monospace', 'handwriting'].indexOf(category) !== -1 ? category : 'sans-serif';
  return { family: family, category: cat, weights: weights.length ? weights : [400], hasItalic: !!italic, isVariable: !!variable,
    scripts: scripts && scripts.length ? scripts : ['latin'], styleTag: STYLE_TAG[cat], license: 'Open Font License / Apache 2.0 (embeddable)' };
}
function fetchJsonText(url) {
  var opts = { headers: { Accept: 'application/json' } };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(10000);
  return fetch(url, opts).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
}
function loadFonts() {
  var key = process.env.GOOGLE_FONTS_API_KEY;
  if (key) {
    return fetchJsonText('https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=' + encodeURIComponent(key)).then(function (t) {
      return { source: 'google_fonts_developer_api', items: (JSON.parse(t).items || []).slice(0, 2500).map(function (f) {
        var w = Array.from(new Set((f.variants || []).map(function (v) { return v === 'regular' || v === 'italic' ? 400 : parseInt(v, 10); }).filter(function (n) { return n > 0; }))).sort(function (a, b) { return a - b; });
        return fontItem(f.family, f.category, w, (f.variants || []).some(function (v) { return /italic/.test(v); }), Array.isArray(f.axes) && f.axes.length, f.subsets);
      }) };
    });
  }
  /* without a key: the public list fonts.google.com itself reads */
  return fetchJsonText('https://fonts.google.com/metadata/fonts').then(function (t) {
    var data = JSON.parse(t.replace(/^\)\]\}'\s*/, ''));
    var list = (data.familyMetadataList || []).slice();
    list.sort(function (a, b) { return (a.popularity || 1e9) - (b.popularity || 1e9); });
    return { source: 'google_fonts_metadata', items: list.slice(0, 2500).map(function (f) {
      var keys = Object.keys(f.fonts || {});
      var w = Array.from(new Set(keys.map(function (k) { return parseInt(k, 10); }).filter(function (n) { return n > 0; }))).sort(function (a, b) { return a - b; });
      var cat = String(f.category || '').toLowerCase().replace('sans serif', 'sans-serif');
      return fontItem(f.family, cat, w, keys.some(function (k) { return /i$/.test(k); }), Array.isArray(f.axes) && f.axes.length, f.subsets);
    }) };
  });
}
function handleFonts(req, res) {
  if (FONTS.body && Date.now() - FONTS.at < FONTS_MS) return sendJson(res, 200, FONTS.body, { 'Cache-Control': 'private, max-age=3600' });
  loadFonts().then(function (body) {
    if (!body.items.length) throw new Error('no fonts in the answer');
    FONTS = { at: Date.now(), body: body };
    sendJson(res, 200, body, { 'Cache-Control': 'private, max-age=3600' });
  }).catch(function (err) {
    console.error('books: the Google Fonts list could not be read — ' + (err && err.message));
    /* the editor falls back to the catalog it carries, and says so */
    sendJson(res, 200, FONTS.body || { source: 'unavailable', items: [] });
  });
}

/* ---------- routes: AI ---------- */
function usageRecorder(fb, bookId) {
  if (!ID_RE.test(bookId || '')) return null;
  return function (usage) {
    if (!usage) return;
    var inc = require('firebase-admin').firestore.FieldValue.increment, write = { 'aiUsage.calls': inc(1), 'aiUsage.updatedAt': new Date().toISOString() };
    write['aiUsage.inputTokens'] = inc(+usage.inputTokens || 0);
    write['aiUsage.outputTokens'] = inc(+usage.outputTokens || 0);
    if (+usage.usd > 0) write['aiUsage.usd'] = inc(+usage.usd);
    bookRef(fb, bookId).update(write).catch(function () { /* a book not saved yet: nothing to add it to */ });
  };
}
function handleAi(req, res, ctx, m) {
  var name = m[1], AI = require('./books-ai');
  if (AI.NAMES.indexOf(name) === -1) return sendJson(res, 404, { error: 'No such endpoint: ' + req.method + ' ' + String(req.url).split('?')[0] });
  readJson(req, res, MAX_AI_REQUEST, 'That request is too large for ETB2B AI (over 30 MB). Use fewer or smaller files.', function (body) {
    var bookId = String(req.headers['x-book-id'] || '');
    AI.run(name, body, { user: ctx.who, onUsage: usageRecorder(ctx.fb, bookId) }).then(function (r) { sendJson(res, r.status, r.json); });
  });
}

/* ---------- the router ---------- */
var ROUTES = {
  'GET /api/books/me': handleMe,
  'GET /api/books/list': handleList,
  'GET /api/books/book': handleGetBook,
  'PUT /api/books/book': handlePutBook,
  'DELETE /api/books/book': handleDeleteBook,
  'POST /api/books/status': handleStatus,
  'GET /api/books/versions': handleListVersions,
  'POST /api/books/versions': handleSaveVersion,
  'GET /api/books/version': handleGetVersion,
  'GET /api/books/templates': handleListTemplates,
  'PUT /api/books/template': handlePutTemplate,
  'DELETE /api/books/template': handleDeleteTemplate,
  'GET /api/books/font-collections': handleListFontCollections,
  'PUT /api/books/font-collection': handlePutFontCollection,
  'POST /api/books/asset': handleUploadAsset,
  'POST /api/books/manuscript': handleManuscript,
  'POST /api/books/idml': handleIdml,
  'GET /api/books/fonts': handleFonts
};
var PATTERNS = [
  { method: 'GET', re: /^\/api\/books\/asset\/(as_[a-f0-9]{20})\/(display|print|thumb)$/, fn: handleGetAsset },
  { method: 'POST', re: /^\/api\/books\/ai\/([a-z-]{1,40})$/, fn: handleAi }
];

function find(method, path) {
  var fn = ROUTES[method + ' ' + path];
  if (fn) return { fn: fn, m: null };
  for (var i = 0; i < PATTERNS.length; i++) {
    var m = PATTERNS[i].re.exec(path);
    if (m && PATTERNS[i].method === method) return { fn: PATTERNS[i].fn, m: m };
  }
  return null;
}
function known(path) {
  if (Object.keys(ROUTES).some(function (k) { return k.split(' ')[1] === path; })) return true;
  return PATTERNS.some(function (p) { return p.re.test(path); });
}

function handle(req, res) {
  var path = String(req.url || '').split('?')[0], method = String(req.method || '').toUpperCase();
  var hit = find(method, path);
  if (!hit) {
    if (known(path)) { res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ error: 'That method is not allowed here.' })); }
    return sendJson(res, 404, { error: 'No such endpoint: ' + method + ' ' + path });
  }
  H.requireMember(req, res, function (fb, decoded) {
    var role = booksRole(decoded);
    if (!role) return sendJson(res, 403, { error: NOT_OPEN, code: 'no-books' });
    try { hit.fn(req, res, { fb: fb, decoded: decoded, role: role, who: whoOf(decoded) }, hit.m); }
    catch (err) { failWith(res, method + ' ' + path, err); }
  });
}

module.exports = { handle: handle, booksRole: booksRole };
module.exports._test = { splitBook: splitBook, assemble: assemble, checkRev: checkRev, partId: partId, sniffPhoto: sniffPhoto, splitManuscript: splitManuscript,
  docxText: docxText, stripRtf: stripRtf, csvText: csvText, parseIdml: parseIdml, cmykHex: cmykHex, col: col, filePrefix: filePrefix, ROUTES: ROUTES, find: find,
  loadFonts: loadFonts, MAX_PART_BYTES: MAX_PART_BYTES, NOT_OPEN: NOT_OPEN };
