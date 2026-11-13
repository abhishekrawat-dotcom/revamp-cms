/* node functions/lib/import-ops.test.js — the Lovable import's storage, page theme and name, and its clear-up
   (launch check, 13 Nov 2026), with an in-memory Firestore and Storage; no network beyond 127.0.0.1:
     BE-049  the import id is the server's (crypto), the record imports/<id> is created once — never merged over —, its
             section.html is private, no index.html; old records (events/import-<id>) are still read while
             LEGACY_IMPORT_DOCS is on; the sweep lists imports nobody took that are older than 7 days, keeps every one
             an event or a Create Event draft names, deletes only on apply and fails closed;
     BE-053  the page's title, description and share picture are recorded and the design is named after its title,
             never its address; the <html>/<body> classes and theme ride on the .rv-imported wrapper (both forms), the
             head's <style> blocks are kept (made safe), the recorded motion stays;
     BE-054  a ZIP upload is answered 400 zip-not-supported; nothing in api.js reads JSZip any more;
     BE-055  ops-migrate-imports.js moves events/import-* to imports/ (report only without --write), makes the pages
             private, deletes index.html; ops-make-private.js lists and fixes public staging/import pages only;
     BE-071  the editor's loader reads /api/imported-section as JSON only;
     PAY-009 banner.html is gone.
   Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http');
var ROOT = path.join(__dirname, '..', '..');
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : '')); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* ---------- an in-memory Firestore + Storage ---------- */
function fakeFb() {
  var docs = {}, files = {}, saves = {}, publicFiles = {}, log = [], times = {};
  function snap(p) {
    var d = docs[p];
    return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; },
      createTime: times[p] ? { toMillis: function () { return times[p]; } } : undefined };
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { log.push('set ' + p); if (!(o && o.merge) || !docs[p]) docs[p] = docs[p] && o && o.merge ? docs[p] : {}; Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve(); },
      update: function (data) { log.push('update ' + p); if (!docs[p]) return Promise.reject(new Error('NOT_FOUND')); Object.keys(data).forEach(function (k) { docs[p][k] = clone(data[k]); }); return Promise.resolve(); },
      create: function (data) { log.push('create ' + p); if (docs[p]) return Promise.reject(Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 })); docs[p] = clone(data); return Promise.resolve(); },
      delete: function () { log.push('delete ' + p); delete docs[p]; return Promise.resolve(); } };
  }
  function listUnder(p) {
    return Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).sort().map(snap);
  }
  function result(list) { return { docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } }; }
  function colRef(p) {
    var q = { path: p, doc: function (id) { return docRef(p + '/' + id); },
      add: function (d) { var r = docRef(p + '/a' + Math.random().toString(36).slice(2)); docs[r.path] = clone(d); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; }, where: function () { return q; },
      get: function () { return Promise.resolve(result(listUnder(p))); } };
    return q;
  }
  function group(name) {
    var q = { select: function () { return q; },
      get: function () {
        if (fb.groupFails) return Promise.reject(new Error('collection group read failed'));
        return Promise.resolve(result(Object.keys(docs).filter(function (k) { var parts = k.split('/'); return parts.length >= 2 && parts[parts.length - 2] === name; }).sort().map(snap)));
      } };
    return q;
  }
  function globRe(g) { return new RegExp('^' + g.split('**').map(function (x) { return x.split('*').map(function (y) { return y.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }).join('[^/]*'); }).join('.*') + '$'); }
  function fileObj(p) {
    return { name: p, metadata: { size: files[p] ? files[p].length : 0, timeCreated: new Date(times['file:' + p] || Date.now()).toISOString() },
      save: function (buf, opts) { log.push('save ' + p); files[p] = Buffer.from(buf); saves[p] = opts || {}; if (opts && opts.predefinedAcl === 'publicRead') publicFiles[p] = true; return Promise.resolve(); },
      makePublic: function () { log.push('makePublic ' + p); publicFiles[p] = true; return Promise.resolve(); },
      makePrivate: function () { log.push('makePrivate ' + p); delete publicFiles[p]; return Promise.resolve(); },
      isPublic: function () { return Promise.resolve([!!publicFiles[p]]); },
      exists: function () { return Promise.resolve([!!files[p]]); },
      download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      delete: function () { log.push('delete file ' + p); delete files[p]; delete publicFiles[p]; return Promise.resolve(); } };
  }
  var bucket = { name: 'test-bucket', file: fileObj,
    getFiles: function (o) {
      if (fb.filesFail) return Promise.reject(new Error('listing failed'));
      var re = o && o.matchGlob ? globRe(o.matchGlob) : null;
      return Promise.resolve([Object.keys(files).sort().filter(function (k) { return k.indexOf((o && o.prefix) || '') === 0 && (!re || re.test(k)); }).map(fileObj)]);
    } };
  var fb = { db: { collection: function (n) { return colRef(n); }, collectionGroup: group,
      runTransaction: function (fn) { return Promise.resolve(fn({ get: function (r) { return r.get(); }, set: function (r, d, o) { r.set(d, o); }, update: function (r, d) { r.update(d); } })); } },
    bucket: bucket, docs: docs, files: files, saves: saves, publicFiles: publicFiles, log: log, times: times,
    auth: { verifyIdToken: function (t) { return Promise.resolve({ email: t + '@timesinternet.in', uid: 'u-' + t, email_verified: true, firebase: { sign_in_provider: 'google.com' } }); } } };
  return fb;
}
var FB = fakeFb();
/* the access list: one admin; everyone else at the company is an Editor (read once and kept 15 s, so set first) */
FB.docs['config/test-import-ops-access'] = { defaultRole: 'editor', members: { 'boss@timesinternet.in': { role: 'admin', portals: ['*'] } }, stored: true };
function stub(name, exports) { var id = require.resolve(name); require.cache[id] = { id: id, filename: id, loaded: true, exports: exports }; }
stub('./firebase', { getFirebase: function () { return FB; } });
var pictures = require('./pictures');
pictures.storeVariants = function () { return Promise.resolve(null); };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
process.env.ACCESS_CONFIG_DOC = 'config/test-import-ops-access';
var api = require('./api');
var H = api._testHooks;
var importPage = require('./import-page');
var importStore = require('./import-store');
var sweep = require('./import-sweep');
var migrateImports = require('./ops-migrate-imports');
var makePrivate = require('./ops-make-private');
var httpLib = require('./http');

function call(method, url, token, body) {
  return new Promise(function (resolve) {
    var headers = { host: 'localhost', 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    var req = { method: method, url: url, headers: headers, socket: {}, rawBody: Buffer.from(body ? JSON.stringify(body) : '') };
    req.on = function () { return req; }; req.resume = function () {};
    var res = { statusCode: 200, headers: {}, headersSent: false,
      setHeader: function (k, v) { res.headers[k.toLowerCase()] = v; }, getHeader: function (k) { return res.headers[k.toLowerCase()]; },
      writeHead: function (s, h) { res.statusCode = s; Object.assign(res.headers, h || {}); res.headersSent = true; return res; }, write: function () { return true; },
      end: function (b) { var t = b ? String(b) : ''; var j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, body: j, text: t }); } };
    api.handleApi(req, res);
  });
}
function filesUnder(prefix) { return Object.keys(FB.files).filter(function (k) { return k.indexOf(prefix) === 0; }); }
var DAY = 24 * 3600 * 1000;

/* a captured Lovable page, as the capture service hands it back */
var CAPTURE = '<!DOCTYPE html><html lang="en-IN" class="dark scroll-smooth" data-theme="night" style="color-scheme: dark; --brand: #e11d48; position: fixed">' +
  '<head><meta charset="utf-8"><title>Brand World Summit 2027 &amp; Awards</title>' +
  '<meta name="description" content="Two days on brands &amp; the people who build them.">' +
  '<meta property="og:title" content="Not this one"><meta property="og:image" content="/og/share.png">' +
  '<style>.hero-glow{background:radial-gradient(#e11d48,transparent)} .x{width:expression(alert(1))}</style>' +
  '<style data-emotion="css">.css-1abc{color:var(--brand)}</style>' +
  '<script>window.__x=1</script></head>' +
  '<body class="bg-background text-foreground antialiased overflow-hidden rv-shown" style="pointer-events: none; --surface: #111">' +
  '<div id="root"><div class="min-h-screen"><header><nav><a href="#about">About</a></nav></header>' +
  '<section id="hero"><h1 class="hero-glow">Brand World Summit</h1><p>Where India\'s brand builders meet.</p></section>' +
  '<section id="about" data-rv-motion="{&quot;on&quot;:&quot;view&quot;,&quot;a&quot;:[{&quot;k&quot;:[{&quot;opacity&quot;:0},{&quot;opacity&quot;:1}]}]}"><h2>About the summit</h2><p>Two days of talks.</p></section>' +
  '<section id="speakers"><h2>Speakers</h2><p>Leaders from across the country.</p></section>' +
  '<footer><p>© ETB2B</p></footer></div></div></body></html>';

(async function () {
  /* ================= lib/import-page.js ================= */
  var facts = importPage.pageFacts(CAPTURE, 'https://bws.lovable.app/');
  ok(facts.title === 'Brand World Summit 2027 & Awards' && facts.description === 'Two days on brands & the people who build them.' &&
    facts.shareImage === 'https://bws.lovable.app/og/share.png' && facts.lang === 'en-IN', 'BE-053 the page\'s title, description, share picture (made a full address) and language are read', facts);
  ok(importPage.pageFacts('<html><head><meta property="og:title" content="Only OG"><meta property="og:image" content="javascript:alert(1)"></head><body>x</body></html>', 'https://a.lovable.app/').title === 'Only OG' &&
    importPage.pageFacts('<html><head><meta property="og:image" content="javascript:alert(1)"></head><body></body></html>', 'https://a.lovable.app/').shareImage === '',
    'BE-053 no <title>: og:title; a share picture that is not an http(s) address is not kept');
  ok(importPage.pageFacts('<p>no head</p>', '').title === '' && importPage.templateName({}) === 'Imported design' &&
    importPage.templateName({ page: { title: '  Summit  ' }, sourceUrl: 'https://s.lovable.app/' }) === 'Summit' &&
    importPage.templateName({ sourceUrl: 'https://s.lovable.app/' }) === 'Imported design', 'BE-053 the design is named after its page\'s title, never its address');
  var wrap = importPage.wrapperOf(CAPTURE);
  ok(wrap.classes.join(' ') === 'dark scroll-smooth bg-background text-foreground antialiased', 'BE-053 the wrapper carries <html> and <body> classes — not a scroll lock or our own marks', wrap.classes);
  ok(wrap.theme === 'night' && /color-scheme:\s*dark/.test(wrap.style) && /--brand:\s*#e11d48/.test(wrap.style) && /--surface/.test(wrap.style) && !/position|pointer-events/.test(wrap.style),
    'BE-053 …their data-theme, colour scheme and custom properties — never a position or pointer-events', wrap);
  ok(/^<div class="rv-imported dark scroll-smooth bg-background text-foreground antialiased" data-theme="night" style="[^"<>]+">$/.test(wrap.open), 'BE-053 the wrapper\'s opening tag', wrap.open);
  var hostile = importPage.wrapperOf('<html class=\'a"><img src=x onerror=alert(1)>\'><body class="ok"></body></html>').open;
  ok(/^<div class="rv-imported [^"<>]*\bok">$/.test(hostile) && hostile.indexOf('onerror') === -1 && hostile.indexOf('<img') === -1, 'a class that would break out of the attribute is dropped', hostile);
  var heads = importPage.headStyles(CAPTURE);
  ok(heads.length === 2 && /hero-glow/.test(heads[0]) && /css-1abc/.test(heads[1]), 'BE-053 the <head>\'s <style> blocks are read, and only those', heads);

  /* ================= lib/import-store.js ================= */
  var a = importStore.newImportId(), b = importStore.newImportId();
  ok(/^imp-[0-9a-f]{20}$/.test(a) && a !== b && importStore.isImportId(a), 'BE-049 an import id is made on the server: imp- and 20 random hex characters', [a, b]);
  ok(httpLib.LEGACY_IMPORT_DOCS === true && importStore.LEGACY === true, 'LEGACY_IMPORT_DOCS stays on until the owner has run the migration');
  FB.docs['events/import-imp-legacy'] = { importStatus: 'imported', sectionHtmlPath: 'events/import-imp-legacy/section.html' };
  FB.docs['imports/imp-both'] = { importStatus: 'imported', where: 'new' };
  FB.docs['events/import-imp-both'] = { importStatus: 'imported', where: 'old' };
  var r1 = await importStore.readRecord(FB, 'imp-legacy'), r2 = await importStore.readRecord(FB, 'imp-both'), r3 = await importStore.readRecord(FB, 'imp-none');
  ok(r1.legacy && r1.data.importStatus === 'imported' && !r2.legacy && r2.data.where === 'new' && r3.data === null, 'an old record is read at events/import-<id>; imports/<id> comes first', [r1, r2, r3]);
  delete FB.docs['imports/imp-both']; delete FB.docs['events/import-imp-both']; delete FB.docs['events/import-imp-legacy'];

  /* ================= processLovableImport: storage, record, theme ================= */
  var id = importStore.newImportId();
  FB.log.length = 0;
  var result = await H.processLovableImport(FB, id, CAPTURE.replace(/<script>[\s\S]*?<\/script>/, ''), function () { return Promise.resolve(null); }, function () { return Promise.resolve(null); }, null,
    { sourceUrl: 'https://bws.lovable.app/', createdBy: 'maker@timesinternet.in' });
  var folder = 'events/import-' + id + '/';
  var rec = FB.docs['imports/' + id] || {};
  var section = String(FB.files[folder + 'section.html'] || '');
  var cut = JSON.parse(String(FB.files[folder + 'sections.json'] || '{}'));
  ok(result.templateId === 'imported-' + id && rec.importStatus === 'imported' && rec.sourceUrl === 'https://bws.lovable.app/' && rec.createdBy === 'maker@timesinternet.in',
    'BE-049 the record is imports/<id>', rec);
  ok(FB.log.indexOf('create imports/' + id) !== -1 && !FB.log.some(function (l) { return /^(set|update) imports\//.test(l) || /^(set|create) events\/import-/.test(l); }), 'BE-049 …created with create(), never merge-set, never in events/', FB.log);
  ok(!FB.files[folder + 'index.html'] && !FB.log.some(function (l) { return /^makePublic /.test(l); }) && !FB.publicFiles[folder + 'section.html'] && !FB.publicFiles[folder + 'sections.json'] &&
    !FB.saves[folder + 'section.html'].predefinedAcl && /private/.test(FB.saves[folder + 'section.html'].metadata.cacheControl), 'BE-049 no index.html; section.html and sections.json stay private', FB.saves[folder + 'section.html']);
  ok(!('flattenedHtmlPath' in rec) && rec.page && rec.page.title === 'Brand World Summit 2027 & Awards' && rec.page.shareImage === 'https://bws.lovable.app/og/share.png', 'BE-053 the page\'s title, description and share picture are recorded', rec.page);
  ok(section.indexOf('<div class="rv-imported dark scroll-smooth bg-background text-foreground antialiased" data-theme="night"') !== -1, 'BE-053 the stored page\'s wrapper carries the page\'s theme', section.slice(section.indexOf('<div class="rv-imported'), section.indexOf('<div class="rv-imported') + 200));
  ok(/<style data-rv-imported-css="page">[\s\S]*\.hero-glow\{background:radial-gradient[\s\S]*\.css-1abc\{color:var\(--brand\)\}/.test(section) && !/expression\(/.test(section), 'BE-053 the head\'s <style> blocks are kept, made safe', section.slice(0, 500));
  ok(section.indexOf('data-rv-motion="{&quot;on&quot;:&quot;view&quot;') !== -1, 'the recorded motion stays on the page');
  ok(cut.sections && cut.sections.length >= 3 && /<div class="rv-imported dark scroll-smooth[^"]*" data-theme="night"/.test(cut.frameOpen) && /\.css-1abc/.test(cut.frameOpen),
    'BE-053 the page cut into sections: its frame begins with the same wrapper and carries the head\'s styles', (cut.frameOpen || '').slice(-400));
  var tplR = await call('GET', '/api/imported-template?eventId=' + id, 'owner');
  var secR = await call('GET', '/api/imported-section?eventId=' + id + '&all=1', 'owner');
  ok(tplR.status === 200 && tplR.body.name === 'Brand World Summit 2027 & Awards' && tplR.body.title === tplR.body.name && tplR.body.name.indexOf('lovable.app') === -1, 'BE-053 imported-template names the design from the page title', tplR.body && tplR.body.name);
  ok(secR.status === 200 && /<div class="rv-imported dark[^"]*" data-theme="night" style="[^"]*--brand/.test(secR.body.frameOpen), 'the wrapper and its theme survive the safety step on the way out', secR.body && secR.body.frameOpen && secR.body.frameOpen.slice(-300));
  /* an id that is already used is never written over */
  var before = JSON.stringify(rec), refused = null;
  FB.log.length = 0;
  try { await H.processLovableImport(FB, id, '<html><body><section><h2>Another page</h2><p>Entirely other words, long enough to be a site.</p></section><section><h2>More</h2><p>Words.</p></section></body></html>', function () { return Promise.resolve(null); }, function () { return Promise.resolve(null); }, null, { sourceUrl: 'https://other.lovable.app/' }); }
  catch (e) { refused = e; }
  ok(refused && JSON.stringify(FB.docs['imports/' + id]) === before && !FB.log.some(function (l) { return /^(save|create|set)/.test(l); }), 'BE-049 an import id already used: refused before anything is written', [refused && refused.message, FB.log]);

  /* ================= POST /api/import-lovable ================= */
  var zip = await call('POST', '/api/import-lovable', 'owner', { importId: 'qa-x', zipBase64: 'UEsDBA==', fileName: 'site.zip' });
  ok(zip.status === 400 && zip.body.code === 'zip-not-supported', 'BE-054 a ZIP upload: 400 zip-not-supported', zip);
  var none = await call('POST', '/api/import-lovable', 'owner', { importId: 'qa-x' });
  ok(none.status === 400 && none.body.code === 'url-required', 'no address: 400', none);
  /* the import's routes were moved out of api.js as they were, into api-import.js (BE-017): both are read */
  var API_SRC = ['api.js', 'api-import.js'].map(function (f) { return fs.readFileSync(path.join(__dirname, f), 'utf8'); }).join('\n');
  ok(!/require\('jszip'\)|JSZip|runImportLovableFromZip|stripZipExportScripts|importZip/.test(API_SRC), 'BE-054 the ZIP path and JSZip are gone from api.js and api-import.js');
  /* a stand-in capture service: the route makes the id, whatever the request says */
  var asked = [];
  var service = http.createServer(function (req, res) {
    var body = '';
    req.on('data', function (d) { body += d; });
    req.on('end', function () { asked.push(JSON.parse(body).url); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ html: CAPTURE })); });
  });
  await new Promise(function (r) { service.listen(0, '127.0.0.1', r); });
  process.env.LOVABLE_SCRAPER_URL = 'http://127.0.0.1:' + service.address().port;
  FB.docs['imports/imp-victim'] = { importStatus: 'imported', sectionHtmlPath: 'events/import-imp-victim/section.html', page: { title: 'Someone else\'s' } };
  var victimBefore = JSON.stringify(FB.docs['imports/imp-victim']);
  var made = await call('POST', '/api/import-lovable', 'owner', { importId: 'imp-victim', url: 'https://93.184.216.34/' });
  await new Promise(function (r) { service.close(r); });
  delete process.env.LOVABLE_SCRAPER_URL;
  var madeId = made.body && /^imported-(.+)$/.exec(String(made.body.templateId || ''));
  ok(made.status === 200 && madeId && /^imp-[0-9a-f]{20}$/.test(madeId[1]) && madeId[1] !== 'imp-victim' && asked.length === 1, 'BE-049 the route makes the id: one sent with the request is not read', [made.status, made.body, asked]);
  ok(JSON.stringify(FB.docs['imports/imp-victim']) === victimBefore && !FB.files['events/import-imp-victim/section.html'], 'BE-049 …so no request can write over another import', FB.docs['imports/imp-victim']);
  ok(madeId && (FB.docs['imports/' + madeId[1]] || {}).createdBy === 'owner@timesinternet.in', 'the record says who imported it', madeId && FB.docs['imports/' + madeId[1]]);

  /* ================= the sweep (BE-049) ================= */
  var S = fakeFb(), now = Date.parse('2026-11-13T12:00:00Z'), old = new Date(now - 30 * DAY).toISOString(), young = new Date(now - 2 * DAY).toISOString();
  function importFiles(fid, at) { ['section.html', 'sections.json', 'assets/aa.png', 'assets/bb.woff2'].forEach(function (n) { S.files['events/import-' + fid + '/' + n] = Buffer.from('x'.repeat(10)); S.times['file:events/import-' + fid + '/' + n] = at; }); }
  S.docs['imports/imp-unused'] = { importStatus: 'imported', importedAt: old, sourceUrl: 'https://u.lovable.app/', createdBy: 'a@timesinternet.in' }; importFiles('imp-unused', now - 30 * DAY);
  S.docs['imports/imp-event'] = { importStatus: 'imported', importedAt: old }; importFiles('imp-event', now - 30 * DAY);
  S.docs['imports/imp-site'] = { importStatus: 'imported', importedAt: old };
  S.docs['imports/imp-bin'] = { importStatus: 'imported', importedAt: old };
  S.docs['imports/imp-draft'] = { importStatus: 'imported', importedAt: old };
  S.docs['imports/imp-young'] = { importStatus: 'imported', importedAt: young };
  S.docs['imports/imp-failed'] = { importStatus: 'failed', failedAt: old, importFailure: { code: 'empty-page' } };
  S.docs['imports/imp-nodate'] = { importStatus: 'imported' };
  S.docs['imports/imp-claimed'] = { importStatus: 'imported', importedAt: old, claimedBy: 'qa-ev' };
  S.docs['events/import-imp-legacy'] = { sectionHtmlPath: 'events/import-imp-legacy/section.html', importedAt: old }; importFiles('imp-legacy', now - 30 * DAY);
  importFiles('imp-orphan', now - 20 * DAY);
  importFiles('imp-orphan-new', now - 1 * DAY);
  S.docs['events/ev-a'] = { name: 'A', templateId: 'imported-imp-event' };
  S.docs['events/ev-b'] = { name: 'B', templateId: 'tech500', site: { templateId: 'imported-imp-site' } };
  S.docs['events/ev-c'] = { name: 'C', templateId: 'imported-imp-bin', deletedAt: old };
  S.docs['createDrafts/k1/drafts/d1'] = { state: JSON.stringify({ template: 'imported-imp-draft', basics: { name: 'Draft' } }) };
  S.docs['events/ev-a/drafts/g1'] = { templateId: 'gen-ev-a', state: 'imported-imp-unused' };
  var planned = await sweep.plan(S, { now: now });
  var cands = planned.candidates.map(function (c) { return c.id; }).sort();
  ok(JSON.stringify(cands) === JSON.stringify(['imp-failed', 'imp-legacy', 'imp-orphan', 'imp-unused']), 'BE-049 the sweep lists the imports nobody took, older than 7 days: unused, failed, an old record, files with no record', cands);
  var takenIds = planned.kept.taken.map(function (c) { return c.id; }).sort();
  ok(JSON.stringify(takenIds) === JSON.stringify(['imp-bin', 'imp-claimed', 'imp-draft', 'imp-event', 'imp-site']), 'BE-049 …and keeps every one an event (its template, its site\'s, one in the bin), a Create Event draft or a claim names', takenIds);
  ok(planned.kept.young.map(function (c) { return c.id; }).sort().join() === 'imp-orphan-new,imp-young' && planned.kept.undated.map(function (c) { return c.id; }).join() === 'imp-nodate',
    'BE-049 …and the young ones and one with no date', planned.kept);
  var unused = planned.candidates.filter(function (c) { return c.id === 'imp-unused'; })[0];
  ok(unused.files === 4 && unused.store === 'imports/imp-unused' && unused.ageDays === 30 && planned.candidates.filter(function (c) { return c.id === 'imp-legacy'; })[0].store === 'events/import-imp-legacy',
    'each is listed with where it is, its age and its files', unused);
  ok(S.log.length === 0 && Object.keys(S.files).length === 20, 'BE-049 listing deletes nothing', S.log);
  S.groupFails = true;
  var closed = null;
  try { await sweep.plan(S, { now: now }); } catch (e) { closed = e; }
  ok(closed && S.log.length === 0, 'BE-049 the drafts cannot be read: the sweep stops, nothing deleted');
  S.groupFails = false;
  var done = await sweep.apply(S, planned);
  ok(done.deleted.sort().join() === 'imp-failed,imp-legacy,imp-orphan,imp-unused' && !S.docs['imports/imp-unused'] && !S.docs['events/import-imp-legacy'] && !S.docs['imports/imp-failed'] &&
    !Object.keys(S.files).some(function (k) { return /imp-(unused|legacy|orphan)\//.test(k); }), 'apply deletes those, files first, then the record', [done, Object.keys(S.files)]);
  ok(S.docs['imports/imp-event'] && S.files['events/import-imp-event/section.html'] && S.docs['imports/imp-draft'] && S.docs['events/ev-a'] && S.docs['createDrafts/k1/drafts/d1'] && S.files['events/import-imp-orphan-new/section.html'],
    'and nothing else');
  /* the route: an admin only, listing unless asked */
  FB.docs['imports/imp-route'] = { importStatus: 'imported', importedAt: '2020-01-01T00:00:00.000Z' };
  var asEditor = await call('POST', '/api/imports/sweep', 'owner', {});
  var asAdmin = await call('POST', '/api/imports/sweep', 'boss', {});
  ok(asEditor.status === 403 && asEditor.body.code === 'not-admin', 'POST /api/imports/sweep: refused to an Editor', asEditor);
  ok(asAdmin.status === 200 && asAdmin.body.applied === false && asAdmin.body.candidates.some(function (c) { return c.id === 'imp-route'; }) && FB.docs['imports/imp-route'], 'POST /api/imports/sweep: lists for an admin, deletes nothing unless asked', asAdmin.body);

  /* ================= ops-migrate-imports.js (BE-055) ================= */
  var M = fakeFb();
  M.docs['events/import-imp-a'] = { importStatus: 'imported', importedAt: old, sourceUrl: 'https://a.lovable.app/', flattenedHtmlPath: 'events/import-imp-a/index.html', sectionHtmlPath: 'events/import-imp-a/section.html', sectionsPath: 'events/import-imp-a/sections.json' };
  ['index.html', 'section.html', 'sections.json', 'assets/p.png'].forEach(function (n) { M.files['events/import-imp-a/' + n] = Buffer.from('x'); });
  M.publicFiles['events/import-imp-a/index.html'] = M.publicFiles['events/import-imp-a/section.html'] = M.publicFiles['events/import-imp-a/assets/p.png'] = true;
  M.docs['events/import-imp-b'] = { importStatus: 'failed', failedAt: old };
  M.docs['imports/imp-b'] = { importStatus: 'failed', failedAt: old, moved: 'earlier' };
  M.docs['events/real-event'] = { name: 'Real' };
  var lines = [];
  var dry = await migrateImports.migrate(M, false, function (s) { lines.push(s); });
  ok(dry.length === 2 && M.log.length === 0 && /would create imports\/imp-a; make section\.html private; delete index\.html; delete events\/import-imp-a/.test(lines.join('\n')) &&
    /would delete events\/import-imp-b/.test(lines.join('\n')) && !/create imports\/imp-b/.test(lines.join('\n')), 'BE-055 the migration\'s report: what it would do, nothing written', [lines, M.log]);
  await migrateImports.migrate(M, true);
  var moved = M.docs['imports/imp-a'] || {};
  ok(moved.importStatus === 'imported' && moved.sourceUrl === 'https://a.lovable.app/' && !('flattenedHtmlPath' in moved) && moved.migratedFrom === 'events/import-imp-a' &&
    !M.docs['events/import-imp-a'] && !M.files['events/import-imp-a/index.html'] && !M.publicFiles['events/import-imp-a/section.html'], 'BE-055 --write: moved to imports/, section.html private, index.html deleted, the old record gone', [moved, M.log]);
  ok(M.publicFiles['events/import-imp-a/assets/p.png'] && M.files['events/import-imp-a/assets/p.png'] && M.docs['imports/imp-b'].moved === 'earlier' && !M.docs['events/import-imp-b'] && M.docs['events/real-event'],
    'BE-055 …its pictures stay public; a record moved earlier is kept as it is; events are untouched');
  var again = await migrateImports.migrate(M, true);
  ok(again.length === 0, 'BE-055 run again: nothing left to do');

  /* ================= ops-make-private.js (BE-055) ================= */
  var P = fakeFb();
  ['events/ev1/staging/index.html', 'events/ev2/staging/index.html', 'events/import-imp-x/section.html', 'events/import-imp-x/index.html', 'events/import-imp-x/assets/a.png',
    'events/ev1/published/index.html', 'events/ev1/media/hero.png'].forEach(function (n) { P.files[n] = Buffer.from('x'); P.publicFiles[n] = true; });
  delete P.publicFiles['events/ev2/staging/index.html'];
  var listed = await makePrivate.makePrivate(P, false);
  ok(listed.public.join() === 'events/ev1/staging/index.html,events/import-imp-x/index.html,events/import-imp-x/section.html' && P.log.length === 0,
    'BE-055 make-private lists only public staging and import pages (never an import\'s pictures, a published page or a picture), changing nothing', [listed, P.log]);
  await makePrivate.makePrivate(P, true);
  ok(!P.publicFiles['events/ev1/staging/index.html'] && !P.publicFiles['events/import-imp-x/section.html'] && P.publicFiles['events/import-imp-x/assets/a.png'] && P.publicFiles['events/ev1/published/index.html'] && P.publicFiles['events/ev1/media/hero.png'],
    'BE-055 --write makes those private and leaves the rest', P.publicFiles);

  /* ================= the pages ================= */
  var CE = fs.readFileSync(path.join(ROOT, 'create-event.html'), 'utf8');
  ok(/body: JSON\.stringify\(\{ url: url \}\)/.test(CE) && CE.indexOf('lovableImportId') === -1 && CE.indexOf("'imported-' + importId") === -1, 'BE-049 Create Event sends only the address; the id is the server\'s');
  var LOADER = fs.readFileSync(path.join(ROOT, 'templates', '_shared', 'template-loader.js'), 'utf8');
  ok(/json\('\/api\/imported-section\?eventId=' \+ encodeURIComponent\(id\.slice\(9\)\)\)\.then/.test(LOADER) && LOADER.indexOf('the page as HTML, or as JSON') === -1, 'BE-071 the loader reads imported-section as JSON only');
  ok(!fs.existsSync(path.join(ROOT, 'banner.html')), 'PAY-009 banner.html is gone');
  var DEV = fs.readFileSync(path.join(ROOT, 'editor-dev-export.js'), 'utf8');
  ok(/if \(sec\.closest && sec\.closest\('\.rv-imported'\)\) copy\.classList\.add\('rv-imported'\);/.test(DEV), 'the Developer zone still finds an imported page by .rv-imported (the wrapper keeps that class first)');

  if (failures.length) { console.error('import-ops: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('import-ops: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.error('import-ops: the run stopped — ' + (err && err.stack || err)); process.exit(1); });
