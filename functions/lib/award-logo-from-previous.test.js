/* tools/award-logo-from-previous.js on an in-memory Firestore + Storage, with CIO Awards' real live page (as served at
   /e/cio-awards on 14 Nov 2026), ETB2B's real award listing and microsite details for the cio portal, and the 2026
   edition's real banner and logo (functions/lib/fixtures/award-logo/) — nothing is fetched and no model is asked.
     - the command: a dry run unless --examine or --apply is said, and nothing else understood;
     - the dry run writes nothing and asks no model;
     - step 1 (--examine) stores the examined lock-up where no page shows it and writes a preview, and writes no page
       and no history line; an examined picture already stored is not examined again without --again;
     - step 2 (--apply --unit) puts exactly that stored picture in the banner with no model call, keeps the page
       before beside it, and changes only the banner's title (the lock-up in, its words kept for screen readers) and
       the edition (3rd -> 4th, as the API confirms);
     - a run after that does nothing;
     - refused, with nothing written: an uploaded logo in Basics, no logo on the previous edition's site, a logo on a
       plate of its own, a year the examination could not move (still shown, not found, unchecked, unread), a year set
       in a font instead of redrawn in the logo's own lettering, anything cropped, more than the year changed, a
       banner not as expected; at step 2, a picture that is not one step 1 stored, not the 2026 artwork with only its
       year moved, or not served to the public, and an event that changed since it was read;
     - an edition the API does not confirm is left as it is; a copy of the page before is never written over;
     - END TO END, the product's own examination (lib/api.js examineUnit) on the real 2026 logo, only Gemini stubbed:
       the year redrawn in its own lettering is kept, changed in the year's place only; when the redraw fails, the
       font fallback cannot place the year (its digits reach the picture's bottom edge) and the run is refused. */
'use strict';
var fs = require('fs'), path = require('path'), os = require('os');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 600) : '')); }

/* ---------- an in-memory Firestore + Storage (as refresh-dummy-dates.test.js), with a listing of files ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function fakeFb() {
  var docs = {}, files = {}, autoN = 100000;
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
    var q = { path: p, doc: function (id) { return docRef(p + '/' + (id || 'auto' + (++autoN))); },
      add: function (data) { var r = docRef(p + '/auto' + (++autoN)); docs[r.path] = clone(data); return Promise.resolve(r); },
      orderBy: function () { return q; }, limit: function () { return q; }, select: function () { return q; },
      where: function (field, op, value) {
        var base = q.get;
        return Object.assign({}, q, { get: function () { return base().then(function (r) { var list = r.docs.filter(function (d) { return (d.data() || {})[field] === value; }); return { docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } }; }); } });
      },
      get: function () {
        var list = Object.keys(docs).filter(function (k) { return k.indexOf(p + '/') === 0 && k.slice(p.length + 1).indexOf('/') === -1; }).map(snap);
        return Promise.resolve({ docs: list, size: list.length, empty: !list.length, forEach: function (f) { list.forEach(f); } });
      } };
    return q;
  }
  var db = { collection: function (n) { return colRef(n); } };
  var bucket = { name: 'test-bucket', file: function (p) {
    return { name: p,
      save: function (buf) { files[p] = Buffer.from(buf); return Promise.resolve(); }, delete: function () { delete files[p]; return Promise.resolve(); },
      exists: function () { return Promise.resolve([!!files[p]]); },
      download: function () { return files[p] ? Promise.resolve([files[p]]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      getMetadata: function () { return files[p] ? Promise.resolve([{ size: files[p].length }]) : Promise.reject(Object.assign(new Error('No such object'), { code: 404 })); },
      setMetadata: function () { return Promise.resolve(); }, makePublic: function () { return Promise.resolve(); } };
  }, getFiles: function (o) {
    var prefix = (o && o.prefix) || '';
    return Promise.resolve([Object.keys(files).filter(function (k) { return k.indexOf(prefix) === 0; }).map(function (k) { return { name: k }; })]);
  } };
  return { db: db, bucket: bucket, docs: docs, files: files };
}
/* nothing reaches a real service: Firebase, the models and the network are stubbed before the server code loads */
var FB0 = fakeFb();
function stub(name, exports) { var id = require.resolve(name); require.cache[id] = { id: id, filename: id, loaded: true, exports: exports }; }
stub('./firebase', { getFirebase: function () { return FB0; } });
var realLlm = require('./llm');
stub('./llm', Object.assign({}, realLlm, { callJson: function () { return Promise.reject(new Error('no model in this test')); } }));
var realSafe = require('./safe-fetch');
stub('./safe-fetch', Object.assign({}, realSafe, { safeFetch: function () { return Promise.reject(new Error('no network in this test')); } }));
/* Gemini, for the end-to-end examination: the logo reading (callGeminiJson) and the year's redraw (callGeminiImage),
   answered by G below; api.js takes both when it loads */
var pngLite = require('./png-lite');
var gemini = require('./gemini');
var G = { reads: [], images: [], imageAnswer: null };
gemini.callGeminiJson = function (prompt, schema, ask) {
  var img = ask && ask.images && ask.images[0], bytes = img ? Buffer.from(img.data, 'base64') : null, dec = bytes ? pngLite.decode(bytes) : null;
  var which = !dec ? 'none' : dec.width === 1490 ? 'edited' : img.data === SOURCE_SHOWN ? 'source' : 'moved';
  G.reads.push({ prompt: prompt, which: which });
  return Promise.resolve({ parsed: reading(which === 'source' ? '2026' : '2027') });
};
gemini.callGeminiImage = function (prompt) { G.images.push({ prompt: prompt }); return Promise.resolve(G.imageAnswer); };
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var hooks = require('./api')._testHooks;
var logActivity = require('./activity').logActivity;
var tool = require('../../tools/award-logo-from-previous.js');

/* ---------- the real material ---------- */
var FIX = path.join(__dirname, 'fixtures', 'award-logo');
var LIVE = fs.readFileSync(path.join(FIX, 'cio-awards-live.html'), 'utf8');
var LISTING = JSON.parse(fs.readFileSync(path.join(FIX, 'etcio-award-listing.json'), 'utf8'));
var DETAILS = JSON.parse(fs.readFileSync(path.join(FIX, 'etcio-4648-details.json'), 'utf8'));
var BANNER = fs.readFileSync(path.join(FIX, 'etcio-2026-microsite-banner.html'), 'utf8');
var LOGO = fs.readFileSync(path.join(FIX, 'etcio-2026-logo.png'));
var LOGO_URL = 'https://img.etb2bimg.com/files/cp/68f3e4a2d1f244cd809b.png';
var SITE_2026 = 'https://cio.economictimes.indiatimes.com/enterprise-tech-award';
var TITLE = 'The Economic Times Awards for Enterprise Tech Excellence 2027', NAME = 'The Economic Times Awards for Enterprise Tech Excellence';
var LIVE_PATH = 'events/cio-awards/published/index.html', KEEP_PATH = 'events/cio-awards/published/before-logo-2026-11-14.html';
var UNIT_PATH = 'events/cio-awards/generated/20261114093000-logo-unit.png', UNIT_URL = 'https://storage.googleapis.com/test-bucket/' + UNIT_PATH;
var ORIGIN = 'https://revamp-cms--revamp-cms.us-east4.hosted.app';

/* the 2026 logo: 745 x 170, black lettering on a see-through ground; its year "2026" at x 325–419, y 133–169 (its
   digits reach the picture's last row), the rules beside it at y 150 */
var SRC = pngLite.decode(LOGO);
var SOURCE_SHOWN = pngLite.encode(pngLite.flatten(SRC, [128, 128, 128])).toString('base64');   // how a reading is shown it (api.js readLogoPicture)
function copyImg(img) { return { width: img.width, height: img.height, data: Buffer.from(img.data) }; }
function paint(img, x0, y0, x1, y1, rgba) {
  for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var o = (y * img.width + x) * 4; img.data[o] = rgba[0]; img.data[o + 1] = rgba[1]; img.data[o + 2] = rgba[2]; img.data[o + 3] = rgba[3]; }
}
/* A STAND-IN for a year moved: the 6 taken out and a plain 7 put in its place — a bar and a stroke, nothing like the
   logo's lettering. It stands for what the examination gives back; it is not a 2027 logo. */
function withSeven(img) {
  var out = copyImg(img);
  paint(out, 396, 131, 422, 170, [0, 0, 0, 0]);
  paint(out, 398, 134, 420, 140, [0, 0, 0, 255]);
  for (var y = 140; y < 170; y++) { var x = Math.round(419 - (y - 140) * 0.45); paint(out, x - 4, y, x + 1, y + 1, [0, 0, 0, 255]); }
  return out;
}
function scale2(img) {
  var W = img.width * 2, H = img.height * 2, out = { width: W, height: H, data: Buffer.alloc(W * H * 4) };
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var s = ((y >> 1) * img.width + (x >> 1)) * 4; img.data.copy(out.data, (y * W + x) * 4, s, s + 4); }
  return out;
}
var EXAMINED = pngLite.encode(withSeven(SRC));
/* a lock-up on a plate of its own: 400 x 120, opaque */
function plateLogo() { return pngLite.encode({ width: 400, height: 120, data: Buffer.alloc(400 * 120 * 4, 0xf5).map(function (v, i) { return i % 4 === 3 ? 255 : v; }) }); }
/* what Gemini's picture call gives back in the end-to-end run: the lock-up on the plain ground it was shown on, twice
   the size, with the stand-in 7 */
var EDITED = pngLite.encode(scale2(pngLite.flatten(withSeven(SRC), [235, 235, 235])));
/* a reading of the lock-up, as Gemini answers it: the year where it is (out of 1000: y 782–1000, x 436–564) */
function reading(year) {
  return { allText: NAME + ' ' + year, year: year, yearFull: year, yearBox: [782, 436, 1000, 564], yearFont: 'serif', yearWeight: 'bold',
    yearFontFamily: 'DM Serif Display', yearFontWeight: '400', tagline: '', extras: '', extraBoxes: [], ownBox: [] };
}
var MOVED_NOTE = 'The year in the logo unit was changed from 2026 to 2027' + tool.REDRAWN + '; everything else in it is untouched. Check how it sits, and replace the picture if you have this edition\'s artwork.';
var FONT_NOTE = 'The year in the logo unit was changed from 2026 to 2027 over the previous edition\'s artwork, in the lettering closest to it; everything else in it is untouched. Check how it sits, and replace the picture if you have this edition\'s artwork.';
var PNG_INFO = { type: 'png', mime: 'image/png', width: 745, height: 170, alpha: true };

function seed(o) {
  o = o || {};
  var FB = fakeFb();
  FB.docs['events/cio-awards'] = Object.assign({ name: 'CIO Awards', portal: 'cio', start: '2027-11-26', end: '2027-11-26', templateId: 'imported-imp-x', published: true,
    publishedAt: '2026-10-09T10:00:00.000Z', publishedUrl: 'https://storage.googleapis.com/x/cio-awards/index.html', createdAt: '2026-10-01T00:00:00.000Z' }, o.event || {});
  FB.files[LIVE_PATH] = Buffer.from(o.page || LIVE);
  if (o.kept != null) FB.files[KEEP_PATH] = Buffer.from(o.kept);
  Object.keys(o.files || {}).forEach(function (k) { FB.files[k] = Buffer.from(o.files[k]); });
  return FB;
}
/* what the tool is handed in place of the network and the model; calls are counted. o.fb: the store whose public
   pictures fetchBytes serves (as storage.googleapis.com serves a public object) */
function depsFor(o) {
  o = o || {};
  var calls = { json: [], text: [], bytes: [], examine: [] };
  var deps = {
    hooks: hooks, logActivity: o.logActivity || logActivity, calls: calls,
    now: function () { return new Date(o.now || '2026-11-14T09:30:00.000Z'); },
    fetchJson: function (u, headers) {
      calls.json.push(u + ' ' + JSON.stringify(headers));
      if (headers.portal !== 'cio') return Promise.resolve(null);
      if (/\/v1\/award-listing\?page=1$/.test(u)) return Promise.resolve(clone(o.listing || LISTING));
      if (/\/v1\/microsite\/details\?digital_month_id=4648$/.test(u)) return Promise.resolve(clone(o.details || DETAILS));
      return Promise.resolve(null);
    },
    fetchText: function (u) { calls.text.push(u); return Promise.resolve(u === SITE_2026 ? (o.banner != null ? o.banner : BANNER) : ''); },
    fetchBytes: function (u) {
      calls.bytes.push(u);
      if (u === LOGO_URL) return Promise.resolve(o.logo || LOGO);
      var pub = 'https://storage.googleapis.com/test-bucket/';
      if (o.fb && u.indexOf(pub) === 0) return Promise.resolve(o.served ? o.served(u) : (o.fb.files[u.slice(pub.length)] || null));
      return Promise.resolve(null);
    },
    examine: function (fb, id, picture, ctx) {
      calls.examine.push({ id: id, picture: picture, ctx: ctx });
      if (o.realExamine) return hooks.examineUnit(fb, id, picture, ctx);
      var ex = { picture: { bytes: EXAMINED, info: Object.assign({}, PNG_INFO) }, changed: true, notes: [MOVED_NOTE], tone: 'for-light', stuck: '', unread: false, seen: '2026', extrasLeft: false };
      return Promise.resolve(o.examined ? o.examined(ex) : ex);
    }
  };
  return deps;
}
function snapshot(FB) {
  var files = {};
  Object.keys(FB.files).forEach(function (k) { files[k] = FB.files[k].toString('base64'); });
  return JSON.stringify({ docs: FB.docs, files: files });
}
function text(FB, p) { return FB.files[p] ? FB.files[p].toString('utf8') : null; }
function history(FB) { return Object.keys(FB.docs).filter(function (k) { return /^events\/cio-awards\/activity\//.test(k); }).map(function (k) { return FB.docs[k]; }); }
function stored(FB) { return Object.keys(FB.files).filter(function (k) { return /^events\/cio-awards\/generated\//.test(k); }).sort(); }
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'award-logo-test-')), tmpN = 0;
function tmp() { return path.join(TMP, 'out' + (++tmpN)); }
function quiet(run) {   // the product's own console.error lines while an examination runs (a reading tried again, …)
  var e = console.error; console.error = function () {};
  return Promise.resolve().then(run).then(function (r) { console.error = e; return r; }, function (err) { console.error = e; throw err; });
}
function printed(run) {   // what the tool prints for the operator -> its text (a print that throws is a failed check)
  var l = console.log, lines = [];
  console.log = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { run(); } catch (err) { lines.push('THREW: ' + (err && err.stack)); } finally { console.log = l; }
  return lines.join('\n');
}

(async function () {
  /* ---------- the command ---------- */
  var A = tool.parseArgs;
  ok(A(['--event', 'cio-awards']).mode === 'dry' && A(['--event', 'cio-awards', '--dry']).mode === 'dry', 'a dry run unless a step is said');
  ok(A(['--event', 'cio-awards', '--examine']).mode === 'examine' && A(['--event', 'cio-awards', '--examine', '--out', '/x', '--again']).again === true && A(['--event', 'cio-awards', '--examine', '--out', '/x']).out === '/x', 'step 1: --examine [--out] [--again]');
  var cmd = A(['--event', 'cio-awards', '--apply', '--unit', UNIT_PATH]);
  ok(cmd.mode === 'apply' && cmd.unit === UNIT_PATH && cmd.id === 'cio-awards', 'step 2: --apply --unit <path>', JSON.stringify(cmd));
  [[[], /--event <event id> is needed/], [['--event'], /needs a value/], [['--event', 'Bad Id'], /not an event id/], [['--event', 'cio-awards', '--bogus'], /not understood: --bogus/],
    [['--event', 'cio-awards', '--examine', '--apply'], /one of --dry, --examine and --apply/], [['--event', 'cio-awards', '--dry', '--apply'], /one of/],
    [['--event', 'cio-awards', '--unit', UNIT_PATH], /--unit goes with --apply/], [['--event', 'cio-awards', '--apply', '--again'], /--again goes with --examine/],
    [['--event', 'cio-awards', '--out', '/x'], /--out goes with --examine/], [['--event', 'a', '--event', 'cio-awards'], /given twice/]].forEach(function (t) {
    var r = A(t[0]);
    ok(r.usage && t[1].test(r.usage), 'not understood, and said why: ' + t[0].join(' '), JSON.stringify(r));
  });

  /* ---------- the facts, from ETB2B's API ---------- */
  ok(tool.editionNumber('3rd Edition') === 3 && tool.editionNumber('Third Edition') === 3 && tool.editionNumber('4th Edition') === 4 && !tool.editionNumber('3th Edition') && !tool.editionNumber('Edition'), 'edition numbers are read as written');
  ok(tool.ordinal(3) === '3rd' && tool.ordinal(4) === '4th' && tool.ordinal(11) === '11th' && tool.ordinal(22) === '22nd', 'ordinals');

  /* ---------- the dry run: reads, prints what it would do, writes nothing, asks no model ---------- */
  var FB = seed(), deps = depsFor({ fb: FB });
  var before = snapshot(FB);
  var P = await tool.plan(FB, deps, 'cio-awards');
  ok(P.ok, 'the plan finds work to do', P.why + ' | ' + P.lines.join(' | '));
  ok(snapshot(FB) === before, 'the dry run (the plan) writes nothing');
  ok(deps.calls.examine.length === 0, 'the dry run asks no model');
  ok(P.prev && P.prev.awardId === '407' && P.prev.id === '4648' && P.prev.link === SITE_2026, 'the previous edition is ETB2B\'s 2026 award (award 407, microsite 4648)', JSON.stringify(P.prev));
  ok(P.editions && P.editions.map(function (e) { return e.start.slice(0, 4); }).join(',') === '2024,2025,2026', 'its editions on ETB2B: 2024, 2025, 2026', JSON.stringify(P.editions));
  ok(P.facts && P.facts.confirmed && P.facts.from === 3 && P.facts.to === 4 && P.facts.editionTxt === '3rd Edition', 'the edition is confirmed from the API: 2026 was the 3rd, so 2027 is the 4th', JSON.stringify(P.facts));
  ok(P.lines.some(function (l) { return l.indexOf('/v1/award-listing?page=1') !== -1; }) && P.lines.some(function (l) { return l.indexOf('/v1/microsite/details?digital_month_id=4648') !== -1; }), 'the dry run names the API addresses it read', P.lines.join('\n'));
  ok(P.lines.indexOf('uploaded logo in Basics: none') !== -1, 'the dry run says it looked for a logo the owner uploaded and found none', P.lines.join('\n'));
  ok(P.logo && P.logo.candidate.url === LOGO_URL && P.logo.picture.info.width === 745 && P.logo.picture.info.height === 170 && P.logo.clear > 0.5, 'the logo found is the 2026 site\'s own banner logo, a transparent 745 × 170 PNG', P.logo && JSON.stringify({ c: P.logo.candidate, clear: P.logo.clear }));
  ok(P.years && P.years.from === '2026' && P.years.to === '2027', 'the year to move: 2026 -> 2027', JSON.stringify(P.years));
  ok(P.nameNoYear === NAME, 'the award\'s name the examination will be given has no year in it', P.nameNoYear);
  ok(P.change.before.indexOf('<h1 class="animate-fade-up font-serif') === 0 && /2027<\/span>/.test(P.change.before), 'the banner element to replace is the title set in type', P.change.before);
  ok(P.change.after.indexOf('<span class="sr-only">' + TITLE + '</span>') !== -1 && /<img class="rv-lu-img" src="https:\/\/storage\.googleapis\.com\/test-bucket\/events\/cio-awards\/generated\/YYYYMMDDHHMMSS-logo-unit\.png" alt="" width="745" height="170"/.test(P.change.after),
    'the new markup: the title\'s words kept for screen readers, the lock-up shown in their place', P.change.after);
  ok(!/background|border|box-shadow|padding/.test((/<img[^>]*>/.exec(P.change.after) || [''])[0]), 'the lock-up is never on a plate or framed', P.change.after);

  /* ---------- step 2 before step 1: refused ---------- */
  var r0 = await tool.apply(FB, deps, P, {});
  ok(!r0.ok && /run --examine first/.test(r0.line) && snapshot(FB) === before, 'without an examined picture named, --apply puts nothing live', r0.line);

  /* ---------- step 1: --examine stores the examined picture and a preview, and writes no page ---------- */
  var out1 = tmp();
  var e1 = await tool.examine(FB, deps, P, { out: out1 });
  ok(e1.ok && !e1.reused, 'the examination goes through', e1.line);
  ok(deps.calls.examine.length === 1, 'the lock-up is examined once', deps.calls.examine.length);
  var ex = deps.calls.examine[0] || { ctx: {}, picture: {} };
  ok(ex.id === 'cio-awards' && ex.ctx.origin === 'previous-edition' && ex.ctx.years.from === '2026' && ex.ctx.years.to === '2027' && ex.ctx.deadlineAt > Date.now() + 100000,
    'it is examined as the product examines a previous edition\'s unit (origin, years, time enough to redraw the year)', JSON.stringify(ex.ctx));
  ok(ex.ctx.eventName === NAME && ex.ctx.eventName.indexOf('2027') === -1, 'the examination is given the award\'s name without its year: the reading that checks the new year is not told it', ex.ctx.eventName);
  ok(Buffer.compare(ex.picture.bytes, LOGO) === 0, 'what is examined is the previous edition\'s logo as fetched');
  ok(stored(FB).join() === UNIT_PATH && Buffer.compare(FB.files[UNIT_PATH], EXAMINED) === 0, 'the examined copy is stored as a hero unit is (generated/<stamp>-logo-unit.png)', stored(FB).join(', '));
  ok(text(FB, LIVE_PATH) === LIVE && text(FB, KEEP_PATH) === null && history(FB).length === 0, 'step 1 writes no page, no copy of it and no history line');
  ok(JSON.stringify(FB.docs['events/cio-awards']) === JSON.stringify(seed().docs['events/cio-awards']), 'step 1 leaves the event\'s record as it was');
  ok(e1.unit && e1.unit.storagePath === UNIT_PATH && e1.unit.url === UNIT_URL && e1.unit.box && e1.unit.box.x >= 396 && e1.unit.box.x + e1.unit.box.width <= 422 && e1.unit.box.y >= 131 && e1.unit.box.pixels > 0,
    'what changed is found, pixel for pixel: the year\'s place only', JSON.stringify(e1.unit));
  var compare = fs.existsSync(path.join(out1, 'compare.html')) ? fs.readFileSync(path.join(out1, 'compare.html'), 'utf8') : '';
  var after1 = fs.existsSync(path.join(out1, 'page-after.html')) ? fs.readFileSync(path.join(out1, 'page-after.html'), 'utf8') : '';
  ok(e1.files.length === 4 && fs.existsSync(path.join(out1, 'logo-2026.png')) && Buffer.compare(fs.readFileSync(path.join(out1, 'logo-2027.png')), EXAMINED) === 0 && Buffer.compare(fs.readFileSync(path.join(out1, 'logo-2026.png')), LOGO) === 0,
    'the preview holds both pictures as they are', e1.files.join(', '));
  ok(compare.indexOf('node tools/award-logo-from-previous.js --event cio-awards --apply --unit ' + UNIT_PATH) !== -1 && compare.indexOf('data:image/png;base64,' + LOGO.toString('base64')) !== -1 && compare.indexOf('data:image/png;base64,' + EXAMINED.toString('base64')) !== -1 &&
    compare.indexOf('redrawn in its own lettering') !== -1 && /only x 39\d–4[12]\d, y 1[34]\d–169/.test(compare) && compare.indexOf('2× PNG or an SVG') !== -1,
    'compare.html shows both years, what changed and where, the examination\'s words, the step 2 command and why it looks soft on a 2x screen', compare.slice(0, 400));
  ok(!/Oneworld|Revamp CMS/.test(compare + after1) && !/\bET\b(?! logo)/.test(compare.replace(/ETB2B|ETCIO/g, '')), 'the preview names the product and ETB2B as they are to be named');
  ok(after1.indexOf('<base href="' + ORIGIN + '/">') !== -1 && !/<script\b/i.test(after1) && after1.indexOf('<img class="rv-lu-img" src="data:image/png;base64,' + EXAMINED.toString('base64') + '"') !== -1 && after1.indexOf('>4th Edition <span') !== -1,
    'page-after.html is the live page with the picture in its banner, its scripts left out (no visit counted, no form sent)');
  var said1 = printed(function () { tool.printExamined(P, e1); });
  ok(!/THREW/.test(said1) && /changed: only x 39\d–4[12]\d, y 1[34]\d–169 \(\d+ × \d+ px\) of the 745 × 170 picture/.test(said1) && said1.indexOf('stored: ' + UNIT_PATH + '\n    ' + UNIT_URL) !== -1 &&
    said1.indexOf('LOOK AT IT before it goes live:\n    ' + path.join(out1, 'compare.html')) !== -1 && said1.indexOf('node tools/award-logo-from-previous.js --event cio-awards --apply --unit ' + UNIT_PATH) !== -1 && /--examine --again/.test(said1),
    'step 1 prints what changed, where the picture is stored, where to look at it and the command for step 2', said1);
  var saidDry = printed(function () { tool.printPlan(P, 'dry'); });
  ok(!/THREW/.test(saidDry) && /^DRY RUN — no model call, nothing written\./.test(saidDry) && /banner element replaced/.test(saidDry) && /new markup \(the picture's address is known once --examine has stored it\)/.test(saidDry) &&
    /on a 2x screen: shown up to 720 px wide, the 745 px artwork is drawn at about twice its size and looks soft/.test(saidDry) && /a sharper one needs a 2x PNG or an SVG from the ETCIO team/.test(saidDry), 'the dry run prints the change and why the lock-up looks soft on a 2x screen', saidDry);

  /* ---------- step 1 again: the stored picture is not examined again without --again ---------- */
  var out2 = tmp();
  var e2 = await tool.examine(FB, deps, P, { out: out2 });
  ok(e2.ok && e2.reused && deps.calls.examine.length === 1 && stored(FB).length === 1 && /NOT EXAMINED AGAIN — an earlier --examine stored events\/cio-awards\/generated\/20261114093000-logo-unit\.png/.test(e2.line) && /add --again/.test(e2.line),
    'an examined picture already stored is not examined again: its preview is written again, with no model call', e2.line);
  ok(fs.existsSync(path.join(out2, 'compare.html')) && fs.readFileSync(path.join(out2, 'compare.html'), 'utf8').indexOf('--apply --unit ' + UNIT_PATH) !== -1, 'its preview names the same picture for step 2');
  var said2 = printed(function () { tool.printExamined(P, e2); });
  ok(!/THREW/.test(said2) && /NOT EXAMINED AGAIN/.test(said2) && said2.indexOf('--apply --unit ' + UNIT_PATH) !== -1, 'the reused picture\'s step 2 command is printed', said2);
  var saidNext = printed(function () { tool.printNext(P, null); });
  ok(!/THREW/.test(saidNext) && /Next, in two runs with a look in between/.test(saidNext) && /--examine\n/.test(saidNext) && /--apply --unit <the storage path step 1 prints>/.test(saidNext), 'the dry run prints the two steps', saidNext);
  var dA = depsFor({ fb: FB, now: '2026-11-14T09:41:00.000Z' });
  var e3 = await tool.examine(FB, dA, P, { out: tmp(), again: true });
  ok(e3.ok && !e3.reused && dA.calls.examine.length === 1 && stored(FB).join() === [UNIT_PATH, 'events/cio-awards/generated/20261114094100-logo-unit.png'].join(), 'with --again it is examined anew, and the new picture stored beside the first', e3.line + ' | ' + stored(FB).join());
  delete FB.files['events/cio-awards/generated/20261114094100-logo-unit.png'];
  var listed = await tool.storedExaminations(FB, 'cio-awards');
  ok(listed.paths.join() === UNIT_PATH, 'the pictures --examine stored are listed', JSON.stringify(listed));
  var earlier = await tool.earlierExaminations(FB, P);
  var saidEarlier = printed(function () { tool.printNext(P, earlier); });
  ok(earlier.usable.length === 1 && earlier.usable[0].path === UNIT_PATH && /Already stored by an earlier --examine, and still the 2026 artwork with only its year changed \(newest first\): events\/cio-awards\/generated\/20261114093000-logo-unit\.png/.test(saidEarlier),
    'the dry run names the examined picture already stored', saidEarlier);
  /* a picture of that name that is not the 2026 artwork with its year moved is said, never reused */
  var STRAY = 'events/cio-awards/generated/20261001000000-logo-unit.png';
  var Fs = seed({ files: (function () { var f = {}; f[STRAY] = plateLogo(); return f; })() }), ds = depsFor({ fb: Fs });
  var es = await tool.examine(Fs, ds, await tool.plan(Fs, ds, 'cio-awards'), { out: tmp() });
  var saidStray = printed(function () { tool.printExamined(P, es); });
  ok(es.ok && !es.reused && ds.calls.examine.length === 1 && es.unusable.length === 1 && es.unusable[0].path === STRAY && /not used: events\/cio-awards\/generated\/20261001000000-logo-unit\.png — it is 400 × 120/.test(saidStray),
    'a stored picture that is not the 2026 artwork with its year moved is not reused, and is said', saidStray);

  /* ---------- step 2: --apply --unit puts exactly that picture live, with no model call ---------- */
  var d2 = depsFor({ fb: FB });
  var P2 = await tool.plan(FB, d2, 'cio-awards');
  var r = await tool.apply(FB, d2, P2, { unit: UNIT_PATH });
  ok(r.ok, 'step 2 goes through', r.line);
  ok(d2.calls.examine.length === 0, 'step 2 asks no model');
  ok(d2.calls.bytes.indexOf(UNIT_URL) !== -1, 'step 2 checks that the picture is served to the public as stored', d2.calls.bytes.join(', '));
  ok(stored(FB).join() === UNIT_PATH && Buffer.compare(FB.files[UNIT_PATH], EXAMINED) === 0, 'the stored picture is left as it was');
  ok(text(FB, KEEP_PATH) === LIVE, 'the page before is kept beside it, as it was');
  var now = text(FB, LIVE_PATH);
  ok(now.indexOf('src="' + UNIT_URL + '"') !== -1 && r.after.indexOf('src="' + UNIT_URL + '"') !== -1, 'the live page shows exactly the picture named', r.after);
  ok(now.indexOf('<span class="sr-only">' + TITLE + '</span>') !== -1 && (now.match(/<h1\b/g) || []).length === 1, 'one <h1>, its words kept for search engines and screen readers');
  ok(now.indexOf('>4th Edition <span') !== -1 && now.indexOf('3rd Edition') === -1, 'the banner says 4th Edition');
  ok(now.indexOf('an impressive fourth edition — ' + TITLE + '.') !== -1 && now.indexOf('third edition') === -1, 'the words naming this edition say fourth');
  /* nothing else changed: put the old title and edition back, and it is the page before, to the byte */
  var title2 = tool.findTitle(now, tool.EVENTS['cio-awards'].title);
  var back = now.slice(0, title2.at) + P.change.before + now.slice(title2.end);
  back = back.replace('>4th Edition <span', '>3rd Edition <span').replace('an impressive fourth edition — ', 'an impressive third edition — ');
  ok(back === LIVE, 'only the banner\'s title and the edition changed', (function () { var i = 0; while (i < back.length && back[i] === LIVE[i]) i++; return 'first difference at ' + i + ': ' + JSON.stringify(back.slice(i - 40, i + 80)) + ' vs ' + JSON.stringify(LIVE.slice(i - 40, i + 80)); })());
  var ev = FB.docs['events/cio-awards'];
  ok(!ev.publishedVersion && !ev.site && ev.published === true && ev.name === 'CIO Awards' && !ev.logoUrl, 'the event\'s record is untouched (still one page, no versions made up, no logo field)', JSON.stringify(ev));
  var h = history(FB);
  ok(h.length === 1 && h[0].action === 'published' && h[0].by === 'platform' && /put live on the owner's instruction \(14 Nov 2026\)/.test(h[0].detail) && /generated\/20261114093000-logo-unit\.png/.test(h[0].detail) &&
    /"3rd Edition" corrected to "4th Edition"/.test(h[0].detail) && /before-logo-2026-11-14\.html$/.test(h[0].detail) && h[0].detail.length < 300,
    'the history says what was done, which picture, on the owner\'s instruction, and where the page before is kept', JSON.stringify(h) + ' (' + (h[0] && h[0].detail.length) + ' characters)');
  var saidApply = printed(function () { tool.printApplied(P2, r); });
  ok(!/THREW/.test(saidApply) && /its live page changed at \/e\/cio-awards; the banner shows events\/cio-awards\/generated\/20261114093000-logo-unit\.png; edition 3rd -> 4th \(banner 1, words 1\)/.test(saidApply) &&
    saidApply.indexOf('new markup:\n    <h1 ') !== -1 && /within about a minute/.test(saidApply) && !/WARNING/.test(saidApply), 'step 2 prints what went live and when it shows', saidApply);

  /* ---------- a run after that does nothing ---------- */
  var after = snapshot(FB), d3 = depsFor({ fb: FB });
  var P3 = await tool.plan(FB, d3, 'cio-awards');
  ok(!P3.ok && /^nothing to do/.test(P3.why), 'a run after it finds nothing to do', P3.why);
  var r3a = await tool.examine(FB, d3, P3, { out: tmp() }), r3b = await tool.apply(FB, d3, P3, { unit: UNIT_PATH });
  ok(!r3a.ok && !r3b.ok && snapshot(FB) === after && d3.calls.examine.length === 0 && d3.calls.bytes.length === 0, 'it writes nothing, asks no model and fetches no logo', r3a.line + ' | ' + r3b.line);

  /* ---------- refused before anything is examined: nothing written, no model asked ---------- */
  async function refusedPlan(label, o, re) {
    var F = seed(o.seed), d = depsFor(Object.assign({ fb: F }, o)), b = snapshot(F);
    var p = await tool.plan(F, d, o.id || 'cio-awards');
    ok(!p.ok && re.test(p.why), label + ' — refused, and why is said', p.why + ' | ' + p.lines.join(' | '));
    var e = await tool.examine(F, d, p, { out: tmp() }), a = await tool.apply(F, d, p, { unit: UNIT_PATH });
    ok(!e.ok && !a.ok && snapshot(F) === b && d.calls.examine.length === 0, label + ' — nothing written, no model asked', e.line + ' | ' + a.line);
  }
  var OWNER = 'https://storage.googleapis.com/test-bucket/events/cio-awards/logo/owner-2027.png';
  await refusedPlan('a logo the owner uploaded in Basics', { seed: { event: { logoUrl: OWNER } } }, new RegExp('Basics hold a logo the owner uploaded \\(' + OWNER.replace(/[.\/]/g, '\\$&') + '\\), and an uploaded logo comes before the previous edition\'s'));
  await refusedPlan('no logo on the previous edition\'s site', { banner: BANNER.replace(/<img src="https:\/\/img\.etb2bimg\.com\/files\/cp\/68f3e4a2d1f244cd809b\.png" class="bnr-logo">/, '') }, /names no logo/);
  await refusedPlan('the previous edition\'s site cannot be read', { banner: '' }, /could not be read/);
  await refusedPlan('a logo on a plate of its own', { logo: plateLogo() }, /no see-through ground/);
  await refusedPlan('the banner still says 2026', { seed: { page: LIVE.replace('<span class="text-[clamp(1.5rem,7.6vw,3.4rem)]">2027</span>', '<span class="text-[clamp(1.5rem,7.6vw,3.4rem)]">2026</span>') } }, /title says 2026, not 2027/);
  await refusedPlan('a site with saved versions', { seed: { event: { publishedVersion: 3, site: { version: 3 } } } }, /saved versions/);
  await refusedPlan('an event this tool does not know', { id: 'national-data-center-symposium' }, /knows the banner of cio-awards only/);
  await refusedPlan('no award the year before on the portal', { listing: { status: true, data: { active: [], upcoming: [], past: { is_last_page: true, total_pages: 1, items: LISTING.data.past.items } } } }, /no award held in 2026/);
  var odd = await tool.plan(seed({ event: { logoUrl: 'logo.png' } }), depsFor(), 'cio-awards');
  ok(odd.ok && odd.lines.some(function (l) { return /uploaded logo in Basics: none \(the logo field holds "logo\.png", not an uploaded picture's address\)/.test(l); }), 'a logo field that holds no uploaded picture\'s address is said, and not taken for one', odd.lines.join(' | '));

  /* ---------- refused at step 1: nothing stored, nothing written ---------- */
  async function refusedExam(label, examined, re) {
    var F = seed(), d = depsFor({ fb: F, examined: examined }), b = snapshot(F);
    var p = await tool.plan(F, d, 'cio-awards'), res = await tool.examine(F, d, p, { out: tmp() });
    ok(p.ok && !res.ok && res.refused && re.test(res.line) && /Nothing stored, nothing written/.test(res.line), label + ' — refused, and why is said', res.line);
    ok(snapshot(F) === b && d.calls.examine.length === 1, label + ' — nothing stored, nothing written');
    var said = printed(function () { tool.printExamined(p, res); });
    ok(!/THREW/.test(said) && /REFUSED/.test(said) && /Each --examine is a new try \(at most 4 reading calls and 1 picture call\)/.test(said) && !/--apply --unit/.test(said), label + ' — the refusal is printed with what to do, and no step 2 command', said);
  }
  await refusedExam('the year still shown', function (e) { e.stuck = '2026'; e.notes = []; e.changed = false; return e; }, /still shows 2026: its year could not be moved to 2027/);
  await refusedExam('no year found to move', function (e) { e.notes = []; e.changed = false; e.seen = ''; return e; }, /its year was not moved \(the reading found no year in it\)/);
  await refusedExam('the new year unchecked', function (e) { e.notes.push('The new year could not be checked by a second reading: look at it before you publish.'); return e; }, /could not be checked by a second reading/);
  await refusedExam('the lock-up unread', function (e) { e.unread = true; e.notes = []; return e; }, /could not be read/);
  await refusedExam('a sponsor\'s mark left in it', function (e) { e.extrasLeft = true; return e; }, /could not be cropped out cleanly/);
  await refusedExam('drawn for a dark ground', function (e) { e.tone = 'for-dark'; return e; }, /dark ground/);
  await refusedExam('the year set in the closest font', function (e) { e.notes = [FONT_NOTE]; return e; }, /not redrawn in the logo's own lettering but set in the font closest to it/);
  await refusedExam('the year set in a font, as the drawing it comes back as', function (e) { e.notes = [FONT_NOTE]; e.picture = { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 745 170" width="745" height="170"></svg>'), info: { type: 'svg', mime: 'image/svg+xml', width: 745, height: 170 } }; return e; }, /set in the font closest to it/);
  await refusedExam('a redrawn year that came back as a drawing', function (e) { e.picture = { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 745 170" width="745" height="170"></svg>'), info: { type: 'svg', mime: 'image/svg+xml', width: 745, height: 170 } }; return e; }, /it is an SVG, not the previous edition's PNG/);
  await refusedExam('the year moved in an outlined drawing\'s text', function (e) { e.notes = ['The year in the logo unit was changed from 2026 to 2027: its old digits were taken out and the new ones set in Inter, the closest match; everything else in it is untouched.']; return e; }, /set in the font closest to it/);
  await refusedExam('part of it cropped out', function (e) { e.notes.push('“The Economic Times” belonged to the previous edition and was cropped out of the logo unit; the rest of it is untouched.'); return e; }, /part of it was cropped out \(“The Economic Times”/);
  var cut = { width: 745, height: 120, data: Buffer.from(withSeven(SRC).data.slice(50 * 745 * 4)) };
  await refusedExam('a picture cut down', function (e) { e.picture = { bytes: pngLite.encode(cut), info: Object.assign({}, PNG_INFO, { height: 120 }) }; return e; }, /it is 745 × 120, where the previous edition's is 745 × 170/);
  await refusedExam('the 2026 artwork unchanged', function (e) { e.picture = { bytes: pngLite.encode(SRC), info: Object.assign({}, PNG_INFO) }; return e; }, /not one pixel of it differs from the previous edition's/);
  var more = withSeven(SRC); paint(more, 10, 10, 60, 40, [0, 0, 0, 0]);
  await refusedExam('more than the year changed', function (e) { e.picture = { bytes: pngLite.encode(more), info: Object.assign({}, PNG_INFO) }; return e; }, /more than its year changed: it differs from the previous edition's over x 10–4\d\d, y 10–169/);
  await refusedExam('the year moved to another year', function (e) { e.notes = [MOVED_NOTE.replace('to 2027', 'to 2028')]; return e; }, /moved to 2028, not 2027/);

  /* ---------- refused at step 2: nothing written ---------- */
  async function refusedApply(label, o, re) {
    var files = {}; files[o.path || UNIT_PATH] = o.bytes || EXAMINED;
    var F = seed({ files: files }), d = depsFor(Object.assign({ fb: F }, o.deps || {})), p = await tool.plan(F, d, 'cio-awards');
    if (o.meanwhile) o.meanwhile(F);
    var b = snapshot(F), res = await tool.apply(F, d, p, { unit: o.unit != null ? o.unit : UNIT_PATH });
    ok(p.ok && !res.ok && re.test(res.line), label + ' — refused, and why is said', res.line);
    ok(snapshot(F) === b && d.calls.examine.length === 0, label + ' — nothing written, no model asked');
  }
  await refusedApply('a picture of another event', { unit: 'events/agentic-summit-2027/generated/20261114093000-logo-unit.png' }, /--unit must name a picture --examine stored for cio-awards/);
  await refusedApply('a picture that is not an examined one', { unit: 'events/cio-awards/logo/owner.png' }, /--unit must name a picture --examine stored/);
  await refusedApply('a drawing', { unit: 'events/cio-awards/generated/20261114093000-logo-unit.svg' }, /--unit must name a picture --examine stored/);
  await refusedApply('a picture not stored', { unit: 'events/cio-awards/generated/20261114093100-logo-unit.png' }, /no picture is stored at events\/cio-awards\/generated\/20261114093100-logo-unit\.png/);
  await refusedApply('a stored picture of another size', { bytes: pngLite.encode(cut) }, /is not the previous edition's logo with its year moved: it is 745 × 120/);
  await refusedApply('a stored picture with more than the year changed', { bytes: pngLite.encode(more) }, /more than its year changed/);
  await refusedApply('a stored picture that is the 2026 artwork itself', { bytes: LOGO }, /not one pixel of it differs/);
  await refusedApply('a picture the public is not served', { deps: { served: function () { return null; } } }, /does not serve the picture as stored, so the banner would not show it/);
  await refusedApply('a picture served other than stored', { deps: { served: function () { return LOGO; } } }, /does not serve the picture as stored/);
  await refusedApply('an event given a saved version since it was read', { meanwhile: function (F) { F.docs['events/cio-awards'].site = { version: 1 }; } }, /the event changed since it was read: it has saved versions/);
  await refusedApply('an event given an uploaded logo since it was read', { meanwhile: function (F) { F.docs['events/cio-awards'].logoUrl = OWNER; } }, /the event changed since it was read: its Basics hold a logo the owner uploaded/);
  await refusedApply('an event taken off line since it was read', { meanwhile: function (F) { F.docs['events/cio-awards'].published = false; } }, /the event changed since it was read: not live/);
  /* the picture's public address is taken for its path */
  var Fu = seed({ files: (function () { var f = {}; f[UNIT_PATH] = EXAMINED; return f; })() }), du = depsFor({ fb: Fu });
  var ru = await tool.apply(Fu, du, await tool.plan(Fu, du, 'cio-awards'), { unit: UNIT_URL });
  ok(ru.ok && text(Fu, LIVE_PATH).indexOf('src="' + UNIT_URL + '"') !== -1, '--unit may name the picture by its public address', ru.line);

  /* ---------- an edition the API does not confirm is left as it is ---------- */
  var oddDetails = clone(DETAILS); oddDetails.data.template_settings = String(oddDetails.data.template_settings).replace('"edition_txt":"3rd Edition"', '"edition_txt":"4th Edition"');
  var F3 = seed(), d4 = depsFor({ fb: F3, details: oddDetails });
  var P4 = await tool.plan(F3, d4, 'cio-awards');
  ok(P4.ok && P4.facts && !P4.facts.confirmed && /says "4th Edition" but the listing holds 3/.test(P4.facts.why), 'an edition the listing disagrees with is not confirmed', JSON.stringify(P4.facts));
  var e4 = await tool.examine(F3, d4, P4, { out: tmp() }), r4 = await tool.apply(F3, d4, P4, { unit: e4.unit && e4.unit.storagePath });
  var now3 = text(F3, LIVE_PATH);
  ok(e4.ok && r4.ok && now3.indexOf('>3rd Edition <span') !== -1 && now3.indexOf('third edition — ') !== -1 && now3.indexOf('data-rv-award-logo') !== -1, 'the logo goes in; the edition is left as it is', e4.line + ' | ' + r4.line);
  ok(!/corrected/.test(history(F3)[0].detail), 'the history does not claim an edition change', history(F3)[0].detail);
  /* once the API confirms it, --apply alone corrects the edition of a banner that already shows the logo: no model call */
  var d5 = depsFor({ fb: F3 }), P5e = await tool.plan(F3, d5, 'cio-awards');
  ok(P5e.ok && !P5e.needsLogo && P5e.needsEdition, 'a banner with the logo and the edition to correct: only the edition is left to do', P5e.why);
  var b5 = snapshot(F3), r5u = await tool.apply(F3, d5, P5e, { unit: UNIT_PATH });
  ok(!r5u.ok && /--unit is not needed: --apply alone corrects the edition/.test(r5u.line) && snapshot(F3) === b5, 'a picture named for a banner that already shows the logo is refused', r5u.line);
  var e5 = await tool.examine(F3, d5, P5e, { out: tmp() });
  ok(!e5.ok && /nothing to examine: the banner already shows the logo \(--apply alone corrects the edition\)/.test(e5.line) && snapshot(F3) === b5, 'nothing is examined for a banner that already shows the logo', e5.line);
  var r5 = await tool.apply(F3, d5, P5e, {});
  var now5 = text(F3, LIVE_PATH);
  ok(r5.ok && now5.indexOf('>4th Edition <span') !== -1 && now5.indexOf('fourth edition — ') !== -1 && now5.indexOf('src="' + e4.unit.url + '"') !== -1 && d5.calls.examine.length === 0 && /"3rd Edition" corrected to "4th Edition"/.test(history(F3)[1].detail),
    '--apply alone corrects the edition, the logo left as it is', r5.line);
  var noTxt = clone(DETAILS); noTxt.data.template_settings = String(noTxt.data.template_settings).replace('"edition_txt":"3rd Edition"', '"edition_txt":""');
  var P5 = await tool.plan(seed(), depsFor({ details: noTxt }), 'cio-awards');
  ok(P5.ok && !P5.facts.confirmed && /does not say which edition/.test(P5.facts.why), 'a microsite that does not say its edition confirms nothing', JSON.stringify(P5.facts));
  var other = clone(DETAILS); other.data.award_id = 233;
  var P6 = await tool.plan(seed(), depsFor({ details: other }), 'cio-awards');
  ok(P6.ok && !P6.facts.confirmed && /name award 233/.test(P6.facts.why), 'microsite details of another award confirm nothing', JSON.stringify(P6.facts));

  /* ---------- a copy of the page before is never written over; a history line that cannot be written is said ---------- */
  var F7 = seed({ kept: '<!-- an earlier copy -->', files: (function () { var f = {}; f[UNIT_PATH] = EXAMINED; return f; })() });
  var d7 = depsFor({ fb: F7, logActivity: function () { return Promise.resolve(false); } });
  var r7 = await tool.apply(F7, d7, await tool.plan(F7, d7, 'cio-awards'), { unit: UNIT_PATH });
  ok(r7.ok && text(F7, KEEP_PATH) === '<!-- an earlier copy -->' && /was already kept/.test(r7.line), 'a copy kept earlier is kept as it was', r7.line);
  ok(/the line in its history could not be written \(the page is live\)/.test(r7.warning), 'a history line that could not be written is said, not passed over', r7.warning);
  /* the live page cannot be written: it stays as it was, the copy of it is kept, and a run after that finishes it */
  var F10 = seed({ files: (function () { var f = {}; f[UNIT_PATH] = EXAMINED; return f; })() }), d10 = depsFor({ fb: F10 }), file0 = F10.bucket.file, failOnce = true;
  F10.bucket.file = function (p) { var f = file0(p), save = f.save; f.save = function (buf) { if (p === LIVE_PATH && failOnce) { failOnce = false; return Promise.reject(new Error('the write was refused')); } return save(buf); }; return f; };
  var r10 = await tool.apply(F10, d10, await tool.plan(F10, d10, 'cio-awards'), { unit: UNIT_PATH });
  ok(!r10.ok && /^FAILED — the write was refused/.test(r10.line) && text(F10, LIVE_PATH) === LIVE && text(F10, KEEP_PATH) === LIVE && history(F10).length === 0, 'a live page that cannot be written stays as it was, with no history line', r10.line);
  var r10b = await tool.apply(F10, d10, await tool.plan(F10, d10, 'cio-awards'), { unit: UNIT_PATH });
  ok(r10b.ok && text(F10, LIVE_PATH).indexOf('src="' + UNIT_URL + '"') !== -1 && /was already kept as/.test(r10b.line) && history(F10).length === 1, 'a run after that finishes it, the copy kept as it was', r10b.line);

  /* ---------- END TO END: the product's own examination on the real 2026 logo, only Gemini stubbed ---------- */
  G.reads = []; G.images = []; G.imageAnswer = { mimeType: 'image/png', base64: EDITED.toString('base64') };
  var F8 = seed(), d8 = depsFor({ fb: F8, realExamine: true }), out8 = tmp();
  var P8 = await tool.plan(F8, d8, 'cio-awards');
  var e8 = await quiet(function () { return tool.examine(F8, d8, P8, { out: out8 }); });
  ok(e8.ok && /redrawn in the logo's own lettering/.test(e8.line), 'end to end: the year redrawn in the logo\'s own lettering is kept', e8.line + ' | ' + JSON.stringify(G.reads.map(function (x) { return x.which; })));
  ok(G.images.length === tool.MAX_PICTURE_CALLS && G.reads.length <= tool.MAX_READS && G.reads.length === 3, 'end to end: one picture call and three readings (the lock-up, the model\'s picture, the moved year)', JSON.stringify({ images: G.images.length, reads: G.reads.map(function (x) { return x.which; }) }));
  ok(G.reads.every(function (x) { return x.prompt.indexOf(NAME) !== -1 && x.prompt.indexOf('2027') === -1; }) && /Change ONLY the year "2026" to "2027"/.test((G.images[0] || {}).prompt || ''),
    'end to end: no reading is told the new year; only the redraw is asked for it', JSON.stringify(G.reads.map(function (x) { return x.prompt; })));
  var made = F8.files[UNIT_PATH], madeImg = made && pngLite.decode(made), madeBox = madeImg && tool.changedBox(SRC, madeImg);
  ok(made && madeImg.width === 745 && madeImg.height === 170 && madeBox && madeBox.x >= 320 && madeBox.x + madeBox.width <= 425 && madeBox.y >= 128 && madeBox.y + madeBox.height === 170,
    'end to end: the stored picture is the 2026 artwork, changed only where its year is', JSON.stringify(madeBox));
  ok(e8.notes.length === 1 && e8.notes[0] === MOVED_NOTE, 'end to end: the examination says the year was redrawn in its own lettering, and nothing else', JSON.stringify(e8.notes));
  ok(text(F8, LIVE_PATH) === LIVE && history(F8).length === 0, 'end to end: still nothing on the page');
  /* the redraw fails: the product's fallback (the year set in a font) cannot place this year, whose digits reach the
     picture's bottom edge, and the year is read once more before it is given up on */
  G.reads = []; G.images = []; G.imageAnswer = { error: 'quota', code: 'ai-quota' };
  var F9 = seed(), d9 = depsFor({ fb: F9, realExamine: true }), b9 = snapshot(F9);
  var e9 = await quiet(function () { return tool.plan(F9, d9, 'cio-awards').then(function (p) { return tool.examine(F9, d9, p, { out: tmp() }); }); });
  ok(!e9.ok && e9.refused && /still shows 2026: its year could not be moved to 2027 cleanly\. Nothing stored, nothing written\./.test(e9.line), 'end to end: when the redraw fails, the run is refused', e9.line);
  ok(snapshot(F9) === b9 && G.images.length === 1 && G.reads.length === 2 && G.reads.every(function (x) { return x.which === 'source'; }), 'end to end: nothing stored; one picture call, and two readings of the lock-up', JSON.stringify({ images: G.images.length, reads: G.reads.map(function (x) { return x.which; }) }));

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* a temporary folder */ }
  if (failures.length) { console.log('award-logo-from-previous: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('award-logo-from-previous: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.log('award-logo-from-previous: crashed — ' + (err && err.stack)); process.exit(1); });
