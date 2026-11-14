/* tools/award-logo-from-previous.js on an in-memory Firestore + Storage, with CIO Awards' real live page (as served at
   /e/cio-awards on 14 Nov 2026), ETB2B's real award listing and microsite details for the cio portal, and the 2026
   edition's real banner and logo (functions/lib/fixtures/award-logo/) — nothing is fetched and no model is asked:
   the examination is stubbed.
     - the dry run writes nothing and asks no model;
     - a real run stores the examined lock-up, keeps the page before beside it, and changes only the banner's title
       (the lock-up in, its words kept for screen readers) and the edition (3rd -> 4th, as the API confirms);
     - a second run does nothing;
     - refused, with nothing written: no logo on the previous edition's site, a logo on a plate of its own, a year the
       examination could not move (still shown, not found, unchecked, unread), a banner not as expected;
     - an edition the API does not confirm is left as it is; a copy of the page before is never written over. */
'use strict';
var fs = require('fs'), path = require('path');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 600) : '')); }

/* ---------- an in-memory Firestore + Storage (as refresh-dummy-dates.test.js) ---------- */
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
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var hooks = require('./api')._testHooks;
var logActivity = require('./activity').logActivity;
var pngLite = require('./png-lite');
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
var TITLE = 'The Economic Times Awards for Enterprise Tech Excellence 2027';
var LIVE_PATH = 'events/cio-awards/published/index.html', KEEP_PATH = 'events/cio-awards/published/before-logo-2026-11-14.html';
/* "the examined copy": the same lock-up written out again (a stand-in for the one with its year moved) */
var EXAMINED = pngLite.encode(pngLite.decode(LOGO));
var MOVED_NOTE = 'The year in the logo unit was changed from 2026 to 2027 over the previous edition\'s artwork, redrawn in its own lettering; everything else in it is untouched. Check how it sits, and replace the picture if you have this edition\'s artwork.';

function seed(o) {
  o = o || {};
  var FB = fakeFb();
  FB.docs['events/cio-awards'] = Object.assign({ name: 'CIO Awards', portal: 'cio', start: '2027-11-26', end: '2027-11-26', templateId: 'imported-imp-x', published: true,
    publishedAt: '2026-10-09T10:00:00.000Z', publishedUrl: 'https://storage.googleapis.com/x/cio-awards/index.html', createdAt: '2026-10-01T00:00:00.000Z' }, o.event || {});
  FB.files[LIVE_PATH] = Buffer.from(o.page || LIVE);
  if (o.kept != null) FB.files[KEEP_PATH] = Buffer.from(o.kept);
  return FB;
}
/* what the tool is handed in place of the network and the model; calls are counted */
function depsFor(o) {
  o = o || {};
  var calls = { json: [], text: [], bytes: [], examine: [] };
  var deps = {
    hooks: hooks, logActivity: logActivity, now: function () { return new Date('2026-11-14T09:30:00.000Z'); }, calls: calls,
    fetchJson: function (u, headers) {
      calls.json.push(u + ' ' + JSON.stringify(headers));
      if (headers.portal !== 'cio') return Promise.resolve(null);
      if (/\/v1\/award-listing\?page=1$/.test(u)) return Promise.resolve(clone(o.listing || LISTING));
      if (/\/v1\/microsite\/details\?digital_month_id=4648$/.test(u)) return Promise.resolve(clone(o.details || DETAILS));
      return Promise.resolve(null);
    },
    fetchText: function (u) { calls.text.push(u); return Promise.resolve(u === SITE_2026 ? (o.banner != null ? o.banner : BANNER) : ''); },
    fetchBytes: function (u) { calls.bytes.push(u); return Promise.resolve(u === LOGO_URL ? (o.logo || LOGO) : null); },
    examine: function (fb, id, picture, ctx) {
      calls.examine.push({ id: id, picture: picture, ctx: ctx });
      var info = { type: 'png', mime: 'image/png', width: 745, height: 170, alpha: true };
      var ex = { picture: { bytes: EXAMINED, info: info }, changed: true, notes: [MOVED_NOTE], tone: 'for-light', stuck: '', unread: false, seen: '2026', extrasLeft: false };
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
function stored(FB) { return Object.keys(FB.files).filter(function (k) { return /^events\/cio-awards\/generated\//.test(k); }); }

(async function () {
  /* ---------- the facts, from ETB2B's API ---------- */
  ok(tool.editionNumber('3rd Edition') === 3 && tool.editionNumber('Third Edition') === 3 && tool.editionNumber('4th Edition') === 4 && !tool.editionNumber('3th Edition') && !tool.editionNumber('Edition'), 'edition numbers are read as written');
  ok(tool.ordinal(3) === '3rd' && tool.ordinal(4) === '4th' && tool.ordinal(11) === '11th' && tool.ordinal(22) === '22nd', 'ordinals');

  /* ---------- the dry run: reads, prints what it would do, writes nothing, asks no model ---------- */
  var FB = seed(), deps = depsFor();
  var before = snapshot(FB);
  var P = await tool.plan(FB, deps, 'cio-awards');
  ok(P.ok, 'the plan finds work to do', P.why + ' | ' + P.lines.join(' | '));
  ok(snapshot(FB) === before, 'the dry run (the plan) writes nothing');
  ok(deps.calls.examine.length === 0, 'the dry run asks no model');
  ok(P.prev && P.prev.awardId === '407' && P.prev.id === '4648' && P.prev.link === SITE_2026, 'the previous edition is ETB2B\'s 2026 award (award 407, microsite 4648)', JSON.stringify(P.prev));
  ok(P.editions && P.editions.map(function (e) { return e.start.slice(0, 4); }).join(',') === '2024,2025,2026', 'its editions on ETB2B: 2024, 2025, 2026', JSON.stringify(P.editions));
  ok(P.facts && P.facts.confirmed && P.facts.from === 3 && P.facts.to === 4 && P.facts.editionTxt === '3rd Edition', 'the edition is confirmed from the API: 2026 was the 3rd, so 2027 is the 4th', JSON.stringify(P.facts));
  ok(P.lines.some(function (l) { return l.indexOf('/v1/award-listing?page=1') !== -1; }) && P.lines.some(function (l) { return l.indexOf('/v1/microsite/details?digital_month_id=4648') !== -1; }), 'the dry run names the API addresses it read', P.lines.join('\n'));
  ok(P.logo && P.logo.candidate.url === LOGO_URL && P.logo.picture.info.width === 745 && P.logo.picture.info.height === 170 && P.logo.clear > 0.5, 'the logo found is the 2026 site\'s own banner logo, a transparent 745 × 170 PNG', P.logo && JSON.stringify({ c: P.logo.candidate, clear: P.logo.clear }));
  ok(P.years && P.years.from === '2026' && P.years.to === '2027', 'the year to move: 2026 -> 2027', JSON.stringify(P.years));
  ok(P.change.before.indexOf('<h1 class="animate-fade-up font-serif') === 0 && /2027<\/span>/.test(P.change.before), 'the banner element to replace is the title set in type', P.change.before);
  ok(P.change.after.indexOf('<span class="sr-only">' + TITLE + '</span>') !== -1 && /<img class="rv-lu-img" src="https:\/\/storage\.googleapis\.com\/test-bucket\/events\/cio-awards\/generated\/YYYYMMDDHHMMSS-logo-unit\.png" alt="" width="745" height="170"/.test(P.change.after),
    'the new markup: the title\'s words kept for screen readers, the lock-up shown in their place', P.change.after);
  ok(!/background|border|box-shadow|padding/.test((/<img[^>]*>/.exec(P.change.after) || [''])[0]), 'the lock-up is never on a plate or framed', P.change.after);

  /* ---------- the real run ---------- */
  var r = await tool.apply(FB, deps, P);
  ok(r.ok, 'the real run goes through', r.line);
  ok(deps.calls.examine.length === 1, 'the lock-up is examined once', deps.calls.examine.length);
  var ex = deps.calls.examine[0] || { ctx: {}, picture: {} };
  ok(ex.id === 'cio-awards' && ex.ctx.origin === 'previous-edition' && ex.ctx.years.from === '2026' && ex.ctx.years.to === '2027' && ex.ctx.eventName === TITLE && ex.ctx.deadlineAt > Date.now() + 100000,
    'it is examined as the product examines a previous edition\'s unit (origin, years, the award\'s name, time enough to redraw the year)', JSON.stringify(ex.ctx));
  ok(Buffer.compare(ex.picture.bytes, LOGO) === 0, 'what is examined is the previous edition\'s logo as fetched');
  var pics = stored(FB);
  ok(pics.length === 1 && pics[0] === 'events/cio-awards/generated/20261114093000-logo-unit.png' && Buffer.compare(FB.files[pics[0]], EXAMINED) === 0, 'the examined copy is stored as a hero unit is (generated/<stamp>-logo-unit.png)', pics.join(', '));
  ok(text(FB, KEEP_PATH) === LIVE, 'the page before is kept beside it, as it was');
  var now = text(FB, LIVE_PATH);
  ok(now.indexOf('src="https://storage.googleapis.com/test-bucket/events/cio-awards/generated/20261114093000-logo-unit.png"') !== -1, 'the live page shows the stored lock-up');
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
  ok(h.length === 1 && h[0].action === 'published' && h[0].by === 'platform' && /put live on the owner's instruction \(14 Nov 2026\)/.test(h[0].detail) && /"3rd Edition" corrected to "4th Edition"/.test(h[0].detail) && /before-logo-2026-11-14\.html$/.test(h[0].detail) && h[0].detail.length < 300,
    'the history says what was done, on the owner\'s instruction, and where the page before is kept', JSON.stringify(h));

  /* ---------- a second run does nothing ---------- */
  var after = snapshot(FB);
  var P2 = await tool.plan(FB, deps, 'cio-awards');
  ok(!P2.ok && /^nothing to do/.test(P2.why), 'a second run finds nothing to do', P2.why);
  var r2 = await tool.apply(FB, deps, P2);
  ok(!r2.ok && snapshot(FB) === after && deps.calls.examine.length === 1 && deps.calls.bytes.length === 1, 'a second run writes nothing and asks no model', r2.line);

  /* ---------- refusals: nothing written ---------- */
  async function refused(label, o, re, stage) {
    var F = seed(o.seed), d = depsFor(o), b = snapshot(F);
    var p = await tool.plan(F, d, o.id || 'cio-awards');
    var res = stage === 'apply' ? await tool.apply(F, d, p) : null;
    var why = stage === 'apply' ? res.line : p.why;
    ok((stage === 'apply' ? p.ok && !res.ok : !p.ok) && re.test(why), label + ' — refused, and why is said', why + ' | ' + p.lines.join(' | '));
    ok(snapshot(F) === b, label + ' — nothing written');
    if (stage !== 'apply') ok(d.calls.examine.length === 0, label + ' — no model asked');
    return why;
  }
  await refused('no logo on the previous edition\'s site', { banner: BANNER.replace(/<img src="https:\/\/img\.etb2bimg\.com\/files\/cp\/68f3e4a2d1f244cd809b\.png" class="bnr-logo">/, '') }, /names no logo/);
  await refused('the previous edition\'s site cannot be read', { banner: '' }, /could not be read/);
  var plate = pngLite.encode({ width: 400, height: 120, data: Buffer.alloc(400 * 120 * 4, 0xf5).map(function (v, i) { return i % 4 === 3 ? 255 : v; }) });
  await refused('a logo on a plate of its own', { logo: plate }, /no see-through ground/);
  await refused('the year still shown', { examined: function (e) { e.stuck = '2026'; e.notes = []; e.changed = false; return e; } }, /still shows 2026: its year could not be moved to 2027/, 'apply');
  await refused('no year found to move', { examined: function (e) { e.notes = []; e.changed = false; e.seen = ''; return e; } }, /its year was not moved \(the reading found no year in it\)/, 'apply');
  await refused('the new year unchecked', { examined: function (e) { e.notes.push('The new year could not be checked by a second reading: look at it before you publish.'); return e; } }, /could not be checked by a second reading/, 'apply');
  await refused('the lock-up unread', { examined: function (e) { e.unread = true; e.notes = []; return e; } }, /could not be read/, 'apply');
  await refused('a sponsor\'s mark left in it', { examined: function (e) { e.extrasLeft = true; return e; } }, /could not be cropped out cleanly/, 'apply');
  await refused('drawn for a dark ground', { examined: function (e) { e.tone = 'for-dark'; return e; } }, /dark ground/, 'apply');
  await refused('the banner still says 2026', { seed: { page: LIVE.replace('<span class="text-[clamp(1.5rem,7.6vw,3.4rem)]">2027</span>', '<span class="text-[clamp(1.5rem,7.6vw,3.4rem)]">2026</span>') } }, /title says 2026, not 2027/);
  await refused('a site with saved versions', { seed: { event: { publishedVersion: 3, site: { version: 3 } } } }, /saved versions/);
  await refused('an event this tool does not know', { id: 'national-data-center-symposium' }, /knows the banner of cio-awards only/);
  await refused('no award the year before on the portal', { listing: { status: true, data: { active: [], upcoming: [], past: { is_last_page: true, total_pages: 1, items: LISTING.data.past.items } } } }, /no award held in 2026/);

  /* ---------- an edition the API does not confirm is left as it is ---------- */
  var odd = clone(DETAILS); odd.data.template_settings = String(odd.data.template_settings).replace('"edition_txt":"3rd Edition"', '"edition_txt":"4th Edition"');
  var F3 = seed(), d3 = depsFor({ details: odd });
  var P3 = await tool.plan(F3, d3, 'cio-awards');
  ok(P3.ok && P3.facts && !P3.facts.confirmed && /says "4th Edition" but the listing holds 3/.test(P3.facts.why), 'an edition the listing disagrees with is not confirmed', JSON.stringify(P3.facts));
  var r3 = await tool.apply(F3, d3, P3);
  var now3 = text(F3, LIVE_PATH);
  ok(r3.ok && now3.indexOf('>3rd Edition <span') !== -1 && now3.indexOf('third edition — ') !== -1 && now3.indexOf('data-rv-award-logo') !== -1, 'the logo goes in; the edition is left as it is', r3.line);
  ok(!/corrected/.test(history(F3)[0].detail), 'the history does not claim an edition change', history(F3)[0].detail);
  var noTxt = clone(DETAILS); noTxt.data.template_settings = String(noTxt.data.template_settings).replace('"edition_txt":"3rd Edition"', '"edition_txt":""');
  var P4 = await tool.plan(seed(), depsFor({ details: noTxt }), 'cio-awards');
  ok(P4.ok && !P4.facts.confirmed && /does not say which edition/.test(P4.facts.why), 'a microsite that does not say its edition confirms nothing', JSON.stringify(P4.facts));
  var other = clone(DETAILS); other.data.award_id = 233;
  var P5 = await tool.plan(seed(), depsFor({ details: other }), 'cio-awards');
  ok(P5.ok && !P5.facts.confirmed && /name award 233/.test(P5.facts.why), 'microsite details of another award confirm nothing', JSON.stringify(P5.facts));

  /* ---------- a copy of the page before is never written over ---------- */
  var F6 = seed({ kept: '<!-- an earlier copy -->' }), d6 = depsFor();
  var r6 = await tool.apply(F6, d6, await tool.plan(F6, d6, 'cio-awards'));
  ok(r6.ok && text(F6, KEEP_PATH) === '<!-- an earlier copy -->' && /was already kept/.test(r6.line), 'a copy kept earlier is kept as it was', r6.line);

  if (failures.length) { console.log('award-logo-from-previous: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('award-logo-from-previous: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.log('award-logo-from-previous: crashed — ' + (err && err.stack)); process.exit(1); });
