/* tools/draw-logo-unit.js on an in-memory Firestore + Storage: the National Data Center Symposium — an AI-designed site
   whose banner sets its name in type, with no uploaded logo and no previous edition's logo — gets the product's drawn
   unit (api-generate.js drawnLogoUnit: the name lock-up with the official ET logo, its red square unchanged) in its
   design, its generated hero and its saved hero, as a new version put live and noted in the record of live versions
   (so an approver can put the version before it back). The dry run writes nothing; nothing else on the page changes; a
   second run does nothing; no other event is ever read or written; a unit is never boxed, whatever the design asks or
   whatever draws it; the states it must leave alone are left alone. Each case has a store of its own, the event in it
   as the case needs it. */
'use strict';
var fs = require('fs'), path = require('path');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 700) : '')); }

/* ---------- an in-memory Firestore + Storage (as refresh-dummy-dates.test.js) ---------- */
function isDelete(v) { return !!v && typeof v === 'object' && (/Delete/i.test((v.constructor && v.constructor.name) || '') || v.methodName === 'FieldValue.delete'); }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
function setPath(obj, key, v) {
  /* "designPlan.design.logoUnitUrl" as Firestore's update() reads a dotted field */
  var parts = key.split('.'), o = obj;
  for (var i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
  if (isDelete(v)) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = clone(v);
}
function fakeFb() {
  var docs = {}, files = {}, autoN = 100000;
  function snap(p) { var d = docs[p]; return { id: p.split('/').pop(), exists: !!d, ref: docRef(p), data: function () { return d ? clone(d) : undefined; }, get: function (k) { return d ? d[k] : undefined; } }; }
  function write(p, data, merge, dotted) {
    if (!merge || !docs[p]) docs[p] = docs[p] && merge ? docs[p] : {};
    Object.keys(data).forEach(function (k) {
      if (dotted && k.indexOf('.') !== -1) { setPath(docs[p], k, data[k]); return; }
      if (isDelete(data[k])) delete docs[p][k]; else docs[p][k] = typeof data[k] === 'object' && data[k] && /Increment|FieldTransform/i.test((data[k].constructor && data[k].constructor.name) || '') ? 'inc' : clone(data[k]);
    });
  }
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, collection: function (n) { return colRef(p + '/' + n); },
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data, o) { write(p, data, o && o.merge); return Promise.resolve(); },
      update: function (data) { if (!docs[p]) return Promise.reject(new Error('NOT_FOUND ' + p)); write(p, data, true, true); return Promise.resolve(); },
      delete: function () { delete docs[p]; return Promise.resolve(); } };
  }
  function colRef(p) {
    var q = { path: p, doc: function (id) { return docRef(p + '/' + (id || 'auto' + (++autoN))); },
      add: function (data) { var r = docRef(p + '/auto' + (++autoN)); docs[r.path] = clone(data); return Promise.resolve(r); },
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
        update: function (r, d) { write(r.path, d, true, true); return tx; }, delete: function (r) { delete docs[r.path]; return tx; } };
      return Promise.resolve().then(function () { return fn(tx); });
    },
    batch: function () {
      var ops = [];
      return { set: function (r, d, o) { ops.push(function () { write(r.path, d, o && o.merge); }); }, update: function (r, d) { ops.push(function () { write(r.path, d, true, true); }); },
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
/* a store of its own for each case */
function fresh() { FB = fakeFb(); return FB; }
/* the same store, every read and write counted */
function spyFb() {
  var n = 0, base = FB;
  return { reads: function () { return n; }, fb: {
    db: { collection: function (c) { n++; return base.db.collection(c); }, runTransaction: function (f) { n++; return base.db.runTransaction(f); }, batch: function () { n++; return base.db.batch(); } },
    bucket: { name: base.bucket.name, file: function (p) { n++; return base.bucket.file(p); } } } };
}
function stub(name, exports) { var id = require.resolve(name); require.cache[id] = { id: id, filename: id, loaded: true, exports: exports }; }
stub('./firebase', { getFirebase: function () { return FB; } });
var realLlm = require('./llm');
var modelCalls = 0;
stub('./llm', Object.assign({}, realLlm, { callJson: function () { modelCalls++; return Promise.reject(new Error('no model in this test')); } }));
var realSafe = require('./safe-fetch');
/* no network: Google Fonts answers with a font of the repo's own (a subset of Playfair Display, fixtures/logo-unit), as it
   answers fetchUnitFont with the heading font cut down to the name's letters; fontsDown makes it not answer */
var FONT_TTF = fs.readFileSync(path.join(__dirname, 'fixtures', 'logo-unit', 'playfair-display-700-subset.ttf'));
var fontsDown = false;
stub('./safe-fetch', Object.assign({}, realSafe, { safeFetch: function (url) {
  url = String(url);
  if (!fontsDown && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(url)) return Promise.resolve({ status: 200, body: Buffer.from("@font-face{font-family:'Space Grotesk';src:url(https://fonts.gstatic.com/s/test/v1/font.ttf) format('truetype')}") });
  if (!fontsDown && /^https:\/\/fonts\.gstatic\.com\//.test(url)) return Promise.resolve({ status: 200, body: FONT_TTF });
  return Promise.resolve({ status: 404, body: Buffer.from('') });
} }));
process.env.ALLOWED_EMAIL_DOMAIN = 'timesinternet.in';
var api = require('./api');
var hooks = api._testHooks;
var logActivity = require('./activity').logActivity;
var logoUnit = require('./logo-unit');
var tool = require('../../tools/draw-logo-unit.js');
var ROOT = path.join(__dirname, '..', '..');
var ET_ON_LIGHT = fs.readFileSync(path.join(ROOT, 'templates', '_shared', 'img', 'et-business-verticals-on-light.svg'), 'utf8');
var ET_ON_DARK = fs.readFileSync(path.join(ROOT, 'templates', '_shared', 'img', 'et-business-verticals-on-dark.svg'), 'utf8');
var PRODUCT_LOGO = fs.readFileSync(path.join(ROOT, 'assets', 'et-b2b-logo.svg'), 'utf8');
/* hooks with one function of their own (a getter of api's — drawnLogoUnit — cannot be assigned over) */
function withHook(name, fn) { var h = Object.create(hooks); Object.defineProperty(h, name, { value: fn }); return h; }

/* ---------- the National Data Center Symposium's saved page: its hero as the live page has it (14 Nov 2026) ---------- */
var NAME = 'National Data Center Symposium', ID = 'national-data-center-symposium', OTHER = 'some-other-real-event';
/* when its live version went live, and by whom (tools/refresh-dummy-dates.js put it live that morning, unnoted) */
var LIVE_AT = '2026-11-14T06:31:07.000Z';
/* the lock-up set in type, exactly as the live hero has it */
var UNIT_IN_TYPE = '<div class="rv-lu rv-lu-on-light" data-rv-logo-unit=""><div class="rv-lu-name"><span class="rv-lu-pre">National</span><span class="rv-lu-key">Data Center</span><span class="rv-lu-post">Symposium</span></div>' +
  '<div class="rv-lu-by"><span class="rv-lu-by-label">An initiative by</span><img class="rv-lu-et" src="/templates/_shared/img/et-business-verticals-on-light.svg" alt="The Economic Times Business Verticals" width="320" height="31"></div></div>';
var HERO = '<section data-rv-section="hero" id="hero" class="hero-section" data-rv-key="hero"><div class="hero-overlay"></div><div class="hero-container">' + UNIT_IN_TYPE +
  '<div class="hero-badge-row"><span class="hero-badge">Strategic Leadership Summit</span><span class="hero-badge-meta">9 December 2027</span></div>' +
  '<h1 class="hero-headline">Delivering Scaled Compute, Power &amp; High-Density Infrastructure</h1>' +
  '<p class="hero-lead">The next wave of data centre growth will not be measured by megawatts or floor space alone.</p>' +
  '<div class="hero-actions"><a href="#ecosystem-imperative" class="hero-btn-primary">Explore Key Imperatives</a><a href="#critical-infrastructure-matrix" class="hero-btn-secondary">View Infrastructure Matrix</a></div>' +
  '<div class="hero-metrics-bar"><div class="hero-metric-item"><span class="hero-metric-label">Scope</span><strong class="hero-metric-value">Full Ecosystem</strong></div></div></div></section>';
function page(hero, id) {
  id = id || ID;
  return '<!DOCTYPE html><html lang="en" data-rv-edges="smooth"><head><meta charset="utf-8"><title>' + NAME + '</title>' +
    '<style data-rv-style="hero">[data-rv-section="hero"] .hero-container{max-width:1200px}</style></head>' +
    '<body id="gen" data-rv-template-id="gen-' + id + '" data-rv-event-id="' + id + '" class="microsite rv-generated" style="--theme-color:#0044cc;--heading-font-family:&quot;Space Grotesk&quot;, Arial, sans-serif">' +
    '<nav data-rv-section="nav"><div class="rv-etnav-event"><a class="rv-etnav-name" href="#hero">' + NAME + '</a><p class="rv-etnav-sub"><span class="rv-etnav-date">9 Dec 2027</span></p></div></nav>' +
    hero +
    '<section data-rv-section="ecosystem-imperative" id="ecosystem-imperative"><h2>The ecosystem imperative</h2><p>Compute, cooling, grid power.</p></section>' +
    '<footer data-rv-section="footer"><p class="etf-event-name">' + NAME + '</p></footer></body></html>';
}
var PAGE = page(HERO);
/* the generated hero, as the editor opens it before a first save (the model's section, as it was written) */
var GEN_HERO = HERO.replace(' data-rv-section="hero"', '').replace(' data-rv-key="hero"', '');
var DESIGN = { mode: 'light', themeColor: '#0044cc', accentColor: '#ff5e14', headingFont: 'Space Grotesk', bodyFont: 'Plus Jakarta Sans', backgroundColor: '#f8f9fa',
  logoUnit: { before: 'National', keyword: 'Data Center', after: 'Symposium' }, logoUnitStyle: 'stacked',
  logoUnitUrl: '', logoUnitStoragePath: '', logoUnitSource: '', logoUnitFrom: '', logoUnitWidth: 0, logoUnitHeight: 0, logoUnitPlate: '', logoUnitNote: '', logoUnitHeroMode: '' };
function designWith(o) { return { designPlan: { design: Object.assign(clone(DESIGN), o), sections: [] } }; }

/* the event as the live platform has it (version 3 live, put live by a tool), with what a case changes */
function seed(ev, html, id) {
  id = id || ID;
  FB.docs['events/' + id] = Object.assign({ name: NAME, createdAt: '2026-10-13T00:00:00.000Z', portal: 'ciso', start: '2027-12-09', end: '2027-12-09', published: true, publishedVersion: 3,
    publishedAt: LIVE_AT, publishedBy: 'platform', site: { version: 3, templateId: 'gen-' + id }, designPlan: { design: clone(DESIGN), sections: [] },
    generatedSections: [{ id: 'hero', kind: 'hero', html: GEN_HERO, css: '' }] }, ev || {});
  if (html !== null) {
    FB.files['events/' + id + '/site/page.html'] = Buffer.from(html || page(HERO, id));
    FB.files['events/' + id + '/site/versions/3/page.html'] = Buffer.from(html || page(HERO, id));
    FB.files['events/' + id + '/published/index.html'] = Buffer.from(html || page(HERO, id));
  }
}

function snapshot() {
  return JSON.stringify({ docs: FB.docs, files: Object.keys(FB.files).sort().map(function (k) { return k + ':' + FB.files[k].toString('base64'); }) });
}
function filesUnder(prefix) { return Object.keys(FB.files).filter(function (k) { return k.indexOf(prefix) === 0; }); }
function liveOf(id) { var f = FB.files['events/' + id + '/published/index.html']; return f ? f.toString('utf8') : ''; }
function savedOf(id) { var f = FB.files['events/' + id + '/site/page.html']; return f ? f.toString('utf8') : ''; }
function count(s, re) { return (String(s).match(re) || []).length; }
/* the record of live versions (events/<id>/publishes), oldest first by when each went live */
function publishesOf(id) {
  return Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + id + '/publishes/') === 0; }).map(function (k) { return FB.docs[k]; })
    .sort(function (x, y) { return String(x.at) < String(y.at) ? -1 : String(x.at) > String(y.at) ? 1 : 0; });
}
/* what the console offers to put back, as its review page reads it (lib/api.js liveVersionsOf, previousLiveOf, the version kept) */
function putBack(id, liveVersion) {
  return hooks.liveVersionsOf(FB, id).then(function (list) {
    var p = hooks.previousLiveOf(list, liveVersion);
    return p && FB.files['events/' + id + '/site/versions/' + p.version + '/page.html'] ? p : null;
  });
}
/* the ET logo embedded in a drawn unit: the official file as it is, or null */
function embeddedLogo(svg) {
  var m = /<image\b[^>]*\shref="data:image\/svg\+xml;base64,([A-Za-z0-9+\/=]+)"[^>]*\/>/.exec(svg);
  return m ? { file: Buffer.from(m[1], 'base64').toString('utf8'), tag: m[0] } : null;
}
function rects(svg) { return String(svg).replace(/href="data:[^"]*"/g, '').match(/<rect\b[^>]*>/g) || []; }
function hex(s) { var m = /#([0-9a-f]{6})/i.exec(s); return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null; }
function near(a, b, tol) { return !!a && !!b && a.every(function (v, i) { return Math.abs(v - b[i]) <= tol; }); }
var ORIGIN = 'https://cms.example';

(async function () {
  /* ---------- the command line: a mistake, or any other event, stops it before anything is read ---------- */
  var a = tool.argsOf(['--event', ID, '--dry', '--publish']);
  ok(!a.error && a.id === ID && a.dry && a.publish && !a.systemFont, 'the command for the National Data Center Symposium is understood', JSON.stringify(a));
  ok(!tool.argsOf(['--event', ID]).error && !tool.argsOf(['--event', ID, '--dry', '--preview', '/tmp/x']).error && tool.argsOf(['--event', ID, '--system-font']).systemFont, 'its other forms too');
  [[['--event', OTHER, '--dry'], /^Refused: this tool draws the logo unit of national-data-center-symposium only.*"some-other-real-event" is not it.*Nothing was read\.$/],
    [['--event', 'cio-awards', '--dry', '--publish'], /^Refused: .*national-data-center-symposium only/],
    [['--event', 'constructor', '--dry'], /^Refused: /], [['--event', 'hasownproperty'], /^Refused: /],
    [['--event', ID, '--dyr'], /^Not understood: "--dyr"\. Nothing was read\./], [['--event', ID, '--publsh'], /^Not understood: "--publsh"/],
    [['--event', ID, '--preview', '/tmp/x'], /^Usage: /], [['--event'], /^Not understood: "--event" \(it needs a value\)/], [[], /^Usage: /],
    [['--event', 'National Data Center Symposium'], /^Usage: /]
  ].forEach(function (c) {
    var r = tool.argsOf(c[0]);
    ok(c[1].test(r.error), 'the command ' + JSON.stringify(c[0]) + ' is refused: ' + c[1], r.error);
  });

  /* ---------- only the event this tool was written for: any other is not even read ---------- */
  fresh();
  seed();
  seed({ name: 'Some Other Summit 2027' }, undefined, OTHER);     // an AI-designed site as open to the tool as ours
  var before = snapshot();
  for (var o = 0; o < 4; o++) {
    var otherId = [OTHER, 'cio-awards', 'constructor', '__proto__'][o], spy = spyFb();
    var po = await tool.plan(spy.fb, hooks, otherId, { publish: true });
    ok(!po.ok && !po.nothing && /this tool draws the logo unit of national-data-center-symposium only/.test(po.line) && spy.reads() === 0,
      otherId + ': refused before anything is read', po.line + ' | reads ' + spy.reads());
  }
  var spyDry = spyFb(), dryOther = await tool.dryRun(spyDry.fb, hooks, OTHER, { publish: true });
  ok(!dryOther.p.ok && !dryOther.drawn && spyDry.reads() === 0, 'its dry run reads and draws nothing either', dryOther.p.line);
  var ours = await tool.plan(FB, hooks, ID, { publish: true });
  var forged = await tool.apply(FB, hooks, logActivity, ORIGIN, Object.assign({}, ours, { id: OTHER, name: 'Some Other Summit 2027' }), { publish: true, stamp: '20261114110000' }).then(function () { return 'ran'; }, function (e) { return e; });
  ok(forged instanceof Error && /national-data-center-symposium only/.test(forged.message), 'a plan made out for another event is not carried out', forged && forged.message);
  ok(snapshot() === before && modelCalls === 0, 'nothing was written to either event (no field, no file, no history line, no record)');
  fresh();
  seed({ name: 'National Data Centre Summit 2027' });
  var renamed = await tool.plan(FB, hooks, ID, { publish: true });
  ok(!renamed.ok && /the event is called "National Data Centre Summit 2027", not "National Data Center Symposium"/.test(renamed.line), 'the event of that id under another name is left alone', renamed.line);

  /* ---------- the dry run: reads, draws in memory, writes nothing ---------- */
  fresh();
  seed();
  before = snapshot();
  var dry = await tool.dryRun(FB, hooks, ID, { publish: true });
  ok(dry.p.ok && dry.p.draw, 'NDCS: the dry run finds the work to do', dry.p.line);
  ok(snapshot() === before, 'the dry run writes nothing (no event field, no file, no history line, no record)');
  ok(modelCalls === 0, 'no model is asked anything');
  ok(dry.drawn && /^<svg\b/.test(dry.drawn.svg) && dry.drawn.box === '', 'the dry run draws the unit in memory, with no box in it', dry.drawn && (dry.drawn.box || dry.drawn.svg.slice(0, 120)));
  var printed = captured(function () { tool.printPlan(dry.p, { width: 1, height: 1, darkUrl: 'x', font: '', box: '' }, { publish: true, dry: true }); });
  ok(/before "National", keyword "Data Center", after "Symposium" \(the design's own split\)/.test(printed) && /style stacked, light ground/.test(printed), 'it prints the parts and the style it draws in', printed);
  ok(printed.indexOf('<div class="rv-lu rv-lu-on-light" data-rv-logo-unit="">') !== -1 && /An initiative by/.test(printed) && /would go live \(live version 3 = saved version 3\), the history saying: put live on the owner's instruction \(14 Nov 2026\)/.test(printed),
    'it prints the hero element it would replace, and that it would publish', printed);
  ok(/record: {10}version 3, live now \(it went live 2026-11-14T06:31:07\.000Z, by platform\), is not in the record of live versions \(events\/national-data-center-symposium\/publishes\): it would be noted/.test(printed) &&
    /version 4 would be noted as live, as the console notes a publish: an approver can then put version 3 back/.test(printed) && /no box, no plate/.test(printed), 'and what it would note in the record of live versions', printed);

  /* ---------- refusals: each left exactly as it was ---------- */
  var refusals = [
    ['not AI-designed', { designPlan: { design: { sectionEdges: 'smooth' } } }, undefined, /not an AI-designed site/],
    ['uploaded logo', { logoUrl: 'https://storage.googleapis.com/test-bucket/events/' + ID + '/logo/l.png' }, undefined, /uploaded a logo: tools\/repair-owner-logo\.js/],
    ['newer saved work', { site: { version: 4, templateId: 'gen-' + ID } }, undefined, /not the live one/],
    ['waiting for approval', { approval: { id: 'req123456', toVersion: 3 } }, undefined, /waiting for approval/],
    ['previous edition named', {}, undefined, /previous edition's page names a logo.*repair-logo-unit\.js/, function () {
      FB.docs['events/' + ID + '/sources/s1'] = { type: 'previousEdition', url: 'https://ciso.economictimes.indiatimes.com/2026/', fetchedAt: '2026-10-01', logoCandidates: [{ url: 'https://img.etb2bimg.com/x/logo-2026.png', score: 80 }] };
    }],
    ['a picture of its own', {}, page(HERO.replace(UNIT_IN_TYPE, '<div class="rv-lu rv-lu-pic rv-lu-on-light" data-rv-logo-unit=""><img class="rv-lu-img" src="https://storage.googleapis.com/test-bucket/events/' + ID + '/media/chosen.png" alt="x" width="600" height="200"></div>')), /picture of its own/],
    ['no logo unit block', {}, page(HERO.replace(UNIT_IN_TYPE, '<div class="hero-title">' + NAME + '</div>')), /no logo unit block/],
    ['no such event', null, null, /no such event/]
  ];
  for (var r = 0; r < refusals.length; r++) {
    fresh();
    if (refusals[r][1] !== null) seed(refusals[r][1], refusals[r][2]);
    if (refusals[r][4]) refusals[r][4]();
    var was = snapshot(), p = await tool.plan(FB, hooks, ID, { publish: true });
    ok(!p.ok && !p.nothing && refusals[r][3].test(p.line), refusals[r][0] + ': refused — ' + refusals[r][3], p.line);
    ok(snapshot() === was, refusals[r][0] + ': nothing written');
  }
  fresh();
  seed({ site: { version: 4, templateId: 'gen-' + ID } });
  var notLive = await tool.plan(FB, hooks, ID, {});
  ok(!notLive.ok, 'newer saved work is refused even without --publish (it would go live with the next approval)', notLive.line);

  /* ---------- the run, with --publish ---------- */
  fresh();
  seed();
  var plan = await tool.plan(FB, hooks, ID, { publish: true });
  var done = await tool.apply(FB, hooks, logActivity, ORIGIN, plan, { publish: true, stamp: '20261114120000' });
  var unitPath = 'events/' + ID + '/generated/20261114120000-logo-unit.svg', darkPath = 'events/' + ID + '/generated/20261114120000-logo-unit-on-dark.svg';
  var unitUrl = 'https://storage.googleapis.com/test-bucket/' + unitPath, darkUrl = 'https://storage.googleapis.com/test-bucket/' + darkPath;
  ok(FB.files[unitPath] && FB.files[darkPath], 'the unit and its copy for a dark ground are stored where drawnLogoUnit stores them', filesUnder('events/' + ID + '/generated/').join(', '));
  ok(modelCalls === 0, 'still no model call');

  /* the drawing: an SVG, the official ET logo in it as it is — its red square unchanged */
  var svg = FB.files[unitPath].toString('utf8'), darkSvg = FB.files[darkPath].toString('utf8');
  var info = logoUnit.imageInfo(FB.files[unitPath]);
  ok(info.type === 'svg' && info.width > 300 && info.height > 100 && !logoUnit.svgIsActive(svg), 'the unit is a plain SVG picture of a lock-up\'s size', JSON.stringify(info));
  ok(/<title>National Data Center Symposium<\/title>/.test(svg) && />NATIONAL<\/text>/.test(svg) && />DATA CENTER<\/text>/.test(svg) && />SYMPOSIUM<\/text>/.test(svg),
    'it is the event\'s name, as the design splits it (NATIONAL / DATA CENTER / SYMPOSIUM)', svg.replace(/base64,[^"]+/g, 'base64,…').slice(0, 900));
  ok(/fill="#0044cc"[^>]*>DATA CENTER</.test(svg) && /fill="#16181d"[^>]*>NATIONAL</.test(svg), 'its keyword in the site\'s theme colour, the rest in dark lettering for a light ground');
  ok(svg.indexOf("@font-face{font-family:'rvlu';src:url(data:font/ttf;base64,") !== -1 && /font-family="'rvlu', /.test(svg), 'its lettering in the heading font, embedded (as Google Fonts sent it)');
  ok(/drawn: .*style stacked \(no box, no plate\), its lettering in Space Grotesk \(embedded\)/.test(done.lines.join('\n')), 'the run says the style and that the font was embedded', done.lines.join('\n'));
  ok(!rects(svg).length && !rects(darkSvg).length && !/plate/i.test(svg) && tool.boxIn(svg) === '' && tool.boxIn(darkSvg) === '', 'never boxed, never on a plate (style stacked), nor its copy for a dark ground');
  var et = embeddedLogo(svg), etDark = embeddedLogo(darkSvg);
  ok(et && et.file === ET_ON_LIGHT, 'the ET logo in it is the official file for a light ground, byte for byte');
  ok(etDark && etDark.file === ET_ON_DARK, 'the copy for a dark ground carries the official file for a dark ground, byte for byte');
  ok(et && !/\s(filter|opacity|mask|clip-path|style|transform)\s*=/.test(et.tag) && !/mix-blend|filter:/.test(svg.replace(/base64,[^"]+/g, '')), 'nothing recolours, filters or fades the ET logo', et && et.tag.slice(0, 200));
  /* the red square: the same red in the unit's ET logo as in the official files, and the ET red of the product's own logo */
  var squareLight = hex((/\.s3\s*\{\s*fill:\s*(#[0-9a-f]{6})/i.exec(et ? et.file : '') || [])[1]), squareDark = hex((/\.s1\s*\{\s*fill:\s*(#[0-9a-f]{6})/i.exec(etDark ? etDark.file : '') || [])[1]);
  var productSquare = hex((/<path d="M36\.6069 37\.2103V0\.896484H0V37\.2103H36\.6069Z" fill="(#[0-9A-Fa-f]{6})"\/>/.exec(PRODUCT_LOGO) || [])[1]);
  ok(productSquare && near(squareLight, productSquare, 6) && near(squareDark, productSquare, 6),
    'the ET logo\'s red square is the ET red of assets/et-b2b-logo.svg\'s square (the official files\' own hex, within 6 per channel)', JSON.stringify({ light: squareLight, dark: squareDark, product: productSquare }));
  ok(svg.indexOf('class="s3"') === -1 && darkSvg.indexOf('class="s1"') === -1, 'the square is not drawn again outside the official file (only the file itself carries it)');
  /* and drawn as a picture, the square's pixels are that red (resvg, as the server draws an SVG) */
  var imgAt = /<image\b[^>]*\sx="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  var raster = imgAt ? await hooks.rasterise(svg, { clear: true, width: info.width }) : null;
  if (raster && raster.pixels) {
    var scale = raster.width / info.width, x0 = +imgAt[1], y0 = +imgAt[2], w = +imgAt[3], h = +imgAt[4];
    /* the square is the first 35.23 of the file's 365 units across and its whole height; read just inside its corners */
    var sq = 35.23 / 365 * w, samples = [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]].map(function (f) {
      var px = Math.round((x0 + f[0] * sq) * scale), py = Math.round((y0 + f[1] * Math.min(sq, h)) * scale), o = (py * raster.width + px) * 4;
      return [raster.pixels[o], raster.pixels[o + 1], raster.pixels[o + 2], raster.pixels[o + 3]];
    });
    ok(samples.every(function (s) { return s[3] > 240 && near(s.slice(0, 3), squareLight, 3); }), 'drawn, the red square\'s pixels are the official red, unchanged', JSON.stringify(samples));
  } else {
    var resvgHere = true;
    try { require('@resvg/resvg-js'); } catch (e) { resvgHere = false; }
    ok(!resvgHere, 'the unit could be drawn as a picture (resvg is installed here, so the red square\'s pixels must be checked)');
  }

  /* the design and the generated hero, as plan-structure writes a drawn unit */
  var ev = FB.docs['events/' + ID], d = ev.designPlan.design;
  ok(d.logoUnitSource === 'generated' && d.logoUnitUrl === unitUrl && d.logoUnitStoragePath === unitPath && d.logoUnitWidth === info.width && d.logoUnitHeight === info.height &&
    d.logoUnitPlate === '' && d.logoUnitNote === '' && d.logoUnitHeroMode === '' && d.logoUnitFrom === '', 'the design\'s logo unit is the drawn one (source generated, no note)', JSON.stringify(d));
  ok(d.logoUnitDarkUrl === darkUrl && d.logoUnitDarkStoragePath === darkPath && d.logoUnitDarkOf === unitUrl && hooks.darkCopyOfUnit(d), 'its copy for a dark ground is the one drawn with it (not a picture made from it)', JSON.stringify(d));
  ok(d.themeColor === '#0044cc' && d.headingFont === 'Space Grotesk' && d.logoUnitStyle === 'stacked' && JSON.stringify(d.logoUnit) === JSON.stringify(DESIGN.logoUnit), 'the rest of the design is as it was');
  var gen = ev.generatedSections[0].html;
  ok(gen.indexOf('<img class="rv-lu-img" src="' + unitUrl + '" alt="' + NAME + '" width="' + info.width + '" height="' + info.height + '" decoding="async">') !== -1 &&
    gen.indexOf('<img class="rv-lu-img rv-lu-dark" src="' + darkUrl + '" alt="" aria-hidden="true"') !== -1 && gen.indexOf('rv-lu-name') === -1, 'the generated hero shows the unit, its dark copy beside it', gen.slice(0, 700));

  /* the saved hero: the lock-up set in type replaced by the unit's picture, nothing else */
  var saved = savedOf(ID);
  var block = '<div class="rv-lu rv-lu-pic rv-lu-on-light" data-rv-logo-unit><img class="rv-lu-img" src="' + unitUrl + '" alt="' + NAME + '" width="' + info.width + '" height="' + info.height + '" decoding="async">' +
    '<img class="rv-lu-img rv-lu-dark" src="' + darkUrl + '" alt="" aria-hidden="true" width="' + info.width + '" height="' + info.height + '" decoding="async"></div>';
  ok(saved === PAGE.replace(UNIT_IN_TYPE, block), 'the saved page is the page before with only the lock-up replaced, by the unit as gen-design.js shows one', saved.slice(PAGE.indexOf('<section data-rv-section="hero"'), PAGE.indexOf('<section data-rv-section="hero"') + 900));
  ok(count(saved, /<h1\b/g) === 1 && /<h1 class="hero-headline">Delivering Scaled Compute/.test(saved), 'the page keeps its one h1, as it was');
  ok(ev.site.version === 4 && FB.files['events/' + ID + '/site/versions/4/page.html'] && FB.files['events/' + ID + '/site/versions/4/page.html'].toString() === saved, 'kept as version 4');
  var changes = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + ID + '/changes/') === 0; }).map(function (k) { return FB.docs[k]; });
  ok(changes.length === 1 && changes[0].version === 4 && changes[0].note === tool.NOTE && changes[0].by === 'platform' && changes[0].items.length > 0,
    'with its change record (by platform, the note saying why)', JSON.stringify(changes).slice(0, 600));

  /* live: version 4, through the publish step; screen readers and search engines get the name */
  ok(ev.published === true && ev.publishedVersion === 4, 'version 4 is live', JSON.stringify({ p: ev.published, v: ev.publishedVersion }));
  ok(/version 4 saved/.test(done.lines.join('\n')) && /live: {12}version 4 at \/e\/national-data-center-symposium, noted in the record of live versions/.test(done.lines.join('\n')), 'the run says what it did', done.lines.join('\n'));
  var live = liveOf(ID);
  ok(live.indexOf('src="' + unitUrl) !== -1 || live.indexOf(unitPath) !== -1, 'the live page shows the unit', (live.match(/<div class="rv-lu[^>]*>[\s\S]{0,400}/) || [''])[0]);
  ok(/<img class="rv-lu-img" [^>]*alt="National Data Center Symposium"/.test(live) && count(live.replace(/<template[\s\S]*?<\/template>/g, ''), /<h1\b/g) === 1, 'the live page: the picture named by the event\'s name, one h1', (live.match(/<h1[^>]*>[^<]*/g) || []).join(' | '));
  var hist = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + ID + '/activity/') === 0; }).map(function (k) { return FB.docs[k]; });
  ok(hist.some(function (x) { return /put live on the owner's instruction \(14 Nov 2026\)/.test(JSON.stringify(x)); }), 'the history says it was put live on the owner\'s instruction (14 Nov 2026)', JSON.stringify(hist).slice(0, 700));
  ok(hist.some(function (x) { return /tools\/draw-logo-unit\.js/.test(JSON.stringify(x)) && /logo-changed/.test(JSON.stringify(x)); }), 'and that the logo was drawn into the design');

  /* the record of live versions: version 4 noted as the console notes a publish, and version 3 — put live unnoted — from
     the event's own record of it; so the console offers an approver to put version 3 back (UX-107) */
  var pubs = publishesOf(ID);
  ok(pubs.length === 2 && pubs[0].version === 3 && pubs[0].at === LIVE_AT && pubs[0].by === 'platform' && pubs[0].how === 'direct' && pubs[0].replaced === 0 && /later, by tools\/draw-logo-unit\.js/.test(pubs[0].noted),
    'the version live before, missing from the record, is noted with when it went live and by whom (the event\'s publishedAt, publishedBy), marked as noted later', JSON.stringify(pubs));
  ok(pubs[1] && pubs[1].version === 4 && pubs[1].by === 'platform' && pubs[1].how === 'direct' && pubs[1].replaced === 3 && pubs[1].at > LIVE_AT, 'version 4 is noted as live, as the console notes a direct publish', JSON.stringify(pubs[1]));
  var back = await putBack(ID, 4);
  ok(back && back.version === 3 && back.at === LIVE_AT, 'the console now offers an approver to put version 3 back ("it went live on" its real time)', JSON.stringify(back));
  ok(/record: {10}version 3 noted as live since 2026-11-14T06:31:07\.000Z \(by platform\): it went live without being noted/.test(done.lines.join('\n')) &&
    /put back: {8}an approver can put version 3 back \("Put version 3 back…"/.test(done.lines.join('\n')), 'and the run says so', done.lines.join('\n'));

  /* a lock-up that held the page's h1: the published page keeps an h1 with the event's name (site-a11y.js) */
  var h1Page = page(HERO.replace('<div class="rv-lu-name">', '<h1 class="rv-lu-name">').replace('<span class="rv-lu-post">Symposium</span></div>', '<span class="rv-lu-post">Symposium</span></h1>').replace('<h1 class="hero-headline">', '<p class="hero-headline">').replace('Infrastructure</h1>', 'Infrastructure</p>'));
  var wu = tool.withUnit(h1Page, { url: unitUrl, darkUrl: darkUrl, width: 600, height: 300, heroMode: '' }, { name: NAME, designMode: 'light' });
  var passed = hooks.sitePagePass(wu.html, { mode: 'live', event: { name: NAME }, templateId: 'gen-' + ID });
  ok(wu.h1 && count(wu.html, /<h1\b/g) === 0 && /<h1 class="rv-sr-only" data-rv-a11y>National Data Center Symposium<\/h1>/.test(passed) && count(passed, /<h1\b/g) === 1,
    'a lock-up that was the page\'s h1: the published page gets one h1 with the event\'s name, for search engines and screen readers', (passed.match(/<h1[^>]*>[^<]*<\/h1>/g) || []).join(' | '));
  /* a dark banner shows the copy for a dark ground as the unit; a unit drawn for a dark ground is never put on a light banner */
  var onDark = tool.withUnit(PAGE.replace('rv-lu rv-lu-on-light', 'rv-lu rv-lu-on-dark'), { url: unitUrl, darkUrl: darkUrl, width: 600, height: 300, heroMode: '' }, { name: NAME, designMode: 'light' });
  ok(onDark.html && onDark.after.indexOf('rv-lu-on-dark') !== -1 && onDark.after.indexOf('src="' + darkUrl + '" alt="' + NAME + '"') !== -1 && onDark.after.indexOf('rv-lu-dark') === -1, 'on a dark banner: the copy for a dark ground is the unit', onDark.after);
  var clash = tool.withUnit(PAGE, { url: unitUrl, darkUrl: '', width: 600, height: 300, heroMode: '' }, { name: NAME, designMode: 'dark' });
  ok(clash.why && /drawn for a dark ground and this banner is light/.test(clash.why), 'a unit drawn for a dark ground is not put on a light banner', clash.why);

  /* ---------- a second run: nothing to do, nothing written ---------- */
  var again = snapshot(), second = await tool.plan(FB, hooks, ID, { publish: true });
  ok(!second.ok && second.nothing && /nothing to do/.test(second.line), 'a second run finds nothing to do', second.line);
  ok(snapshot() === again, 'and writes nothing');
  var secondApply = await tool.apply(FB, hooks, logActivity, ORIGIN, second, { publish: true }).then(function () { return 'ran'; }, function (e) { return e; });
  ok(secondApply instanceof Error && /nothing to do/.test(secondApply.message) && snapshot() === again, 'a plan with nothing to do is not carried out', secondApply && secondApply.message);

  /* ---------- the record holds the live version already: only the new one is noted ---------- */
  fresh();
  seed();
  FB.docs['events/' + ID + '/publishes/p1'] = { version: 3, at: '2026-11-10T09:00:00.000Z', by: 'someone@timesinternet.in', how: 'direct', replaced: 2 };
  var rec = await tool.plan(FB, hooks, ID, { publish: true });
  var recPrinted = captured(function () { tool.printPlan(rec, null, { publish: true }); });
  ok(rec.ok && rec.liveNoted && !/is not in the record/.test(recPrinted) && /record: {10}version 4 would be noted as live, as the console notes a publish: an approver can then put version 3 back/.test(recPrinted), 'its dry run says only version 4 would be noted', recPrinted);
  await tool.apply(FB, hooks, logActivity, ORIGIN, rec, { publish: true, stamp: '20261114121000' });
  var recPubs = publishesOf(ID), recBack = await putBack(ID, 4);
  ok(recPubs.length === 2 && recPubs[0].version === 3 && recPubs[0].by === 'someone@timesinternet.in' && recPubs[1].version === 4 && recBack && recBack.version === 3 && recBack.at === '2026-11-10T09:00:00.000Z',
    'the version live before is not noted twice, and can be put back', JSON.stringify({ recPubs: recPubs, recBack: recBack }));

  /* ---------- the event does not say when its live version went live: nothing is made up ---------- */
  fresh();
  seed();
  delete FB.docs['events/' + ID].publishedAt;
  var noAt = await tool.plan(FB, hooks, ID, { publish: true });
  var noAtPrinted = captured(function () { tool.printPlan(noAt, null, { publish: true }); });
  ok(noAt.ok && /the event does not say when it went live: it is not noted, and once version 4 is live "Put version 3 back" will not be offered/.test(noAtPrinted), 'its dry run says version 3 cannot be noted, and what that means', noAtPrinted);
  var noAtDone = await tool.apply(FB, hooks, logActivity, ORIGIN, noAt, { publish: true, stamp: '20261114122000' });
  ok(publishesOf(ID).length === 1 && publishesOf(ID)[0].version === 4 && /put back: {8}NOT offered/.test(noAtDone.lines.join('\n')), 'only version 4 is noted, and the run says the put-back is not offered', JSON.stringify(publishesOf(ID)) + ' | ' + noAtDone.lines.join(' | '));

  /* ---------- the record of live versions cannot be written: the run still finishes, and says what that means ---------- */
  fresh();
  seed();
  var base = FB;
  var noRecord = { bucket: base.bucket, db: { runTransaction: base.db.runTransaction, batch: base.db.batch, collection: function (n) {
    var c = base.db.collection(n);
    if (n !== 'events') return c;
    var wc = Object.create(c);
    wc.doc = function (docId) {
      var ref = c.doc(docId), wr = Object.create(ref);
      wr.collection = function (sub) {
        var s = ref.collection(sub);
        if (sub !== 'publishes') return s;
        var ws = Object.create(s);
        ws.add = function () { return Promise.reject(new Error('the record could not be written')); };
        return ws;
      };
      return wr;
    };
    return wc;
  } } };
  var nrPlan = await tool.plan(noRecord, hooks, ID, { publish: true });
  var errWas = console.error, errs = [];
  console.error = function () { errs.push(Array.prototype.join.call(arguments, ' ')); };
  var nrDone = await tool.apply(noRecord, hooks, logActivity, ORIGIN, nrPlan, { publish: true, stamp: '20261114122500' }).then(function (x) { return x; }, function (e) { return e; });
  console.error = errWas;
  ok(nrDone && nrDone.version === 4 && FB.docs['events/' + ID].publishedVersion === 4 && !publishesOf(ID).length &&
    /record: {10}version 3 could NOT be noted in the record of live versions \(the record could not be written\): once a newer version is live, "Put version 3 back" will not be offered/.test((nrDone.lines || []).join('\n')) &&
    /put back: {8}NOT offered/.test((nrDone.lines || []).join('\n')), 'nothing noted: version 4 still goes live, and the run says the put-back is not offered', nrDone && (nrDone.message || nrDone.lines.join(' | ')));

  /* ---------- a design that asks for a boxed unit: drawn stacked — never boxed — and the design says so ---------- */
  fresh();
  seed(designWith({ logoUnitStyle: 'boxed' }));
  var bdry = await tool.dryRun(FB, hooks, ID, { publish: true });
  var bPrinted = captured(function () { tool.printPlan(bdry.p, { width: 1, height: 1, darkUrl: 'x', font: 'Space Grotesk', box: bdry.drawn && bdry.drawn.box }, { publish: true, dry: true }); });
  ok(bdry.p.ok && bdry.p.style === 'stacked' && bdry.p.styleAsked === 'boxed' && bdry.p.restyled && bdry.drawn && bdry.drawn.box === '' && !rects(bdry.drawn.svg).length && !rects(bdry.drawn.darkSvg).length,
    'boxed: the dry run draws it stacked, with no box', JSON.stringify({ style: bdry.p.style, box: bdry.drawn && bdry.drawn.box }));
  ok(/style stacked — the design asks for "boxed" \(the keyword reversed out of a theme-colour box\), and a logo unit is never boxed: drawn stacked, and the design's style set to stacked/.test(bPrinted) && /logoUnitStyle stacked/.test(bPrinted),
    'and says so, not leaving it to whoever reads the style line', bPrinted);
  var bPlan = await tool.plan(FB, hooks, ID, { publish: true });
  var bDone = await tool.apply(FB, hooks, logActivity, ORIGIN, bPlan, { publish: true, stamp: '20261114123000' });
  var bSvg = FB.files['events/' + ID + '/generated/20261114123000-logo-unit.svg'].toString('utf8'), bDark = FB.files['events/' + ID + '/generated/20261114123000-logo-unit-on-dark.svg'].toString('utf8');
  ok(!rects(bSvg).length && !rects(bDark).length && tool.boxIn(bSvg) === '' && bSvg === svg && bDark === darkSvg, 'boxed: the unit stored is the stacked one, the same drawing as for a stacked design, and its dark copy too', rects(bSvg).join(' '));
  ok(FB.docs['events/' + ID].designPlan.design.logoUnitStyle === 'stacked' && FB.docs['events/' + ID].publishedVersion === 4 && /rv-lu-pic/.test(liveOf(ID)), 'the design\'s style is stacked now, and the unit is live', JSON.stringify(FB.docs['events/' + ID].designPlan.design.logoUnitStyle));
  ok(/design: {10}designPlan\.design\.logoUnitStyle = stacked \(it was "boxed": a logo unit is never boxed\)/.test(bDone.lines.join('\n')), 'the run says the style was changed, and why', bDone.lines.join('\n'));

  /* ---------- underline: drawn as the design asks; its thin rule under the keyword is no box ---------- */
  fresh();
  seed(designWith({ logoUnitStyle: 'underline' }));
  var uPlan = await tool.plan(FB, hooks, ID, {});
  await tool.apply(FB, hooks, logActivity, ORIGIN, uPlan, { stamp: '20261114124000' });
  var uSvg = FB.files['events/' + ID + '/generated/20261114124000-logo-unit.svg'].toString('utf8'), uRects = rects(uSvg);
  var ruleH = uRects.length ? parseFloat((/\sheight="([\d.]+)"/.exec(uRects[0]) || [])[1]) : 0;
  ok(uPlan.style === 'underline' && !uPlan.restyled && uRects.length === 1 && ruleH > 0 && ruleH <= 12 && tool.boxIn(uSvg) === '' && FB.docs['events/' + ID].designPlan.design.logoUnitStyle === 'underline',
    'underline: one thin rule under the keyword, no box; the design\'s style kept', uRects.join(' '));

  /* ---------- boxIn: a box, a plate or any shape behind the lettering is found; the embedded ET logo is not looked into ---------- */
  var parts = { before: 'National', keyword: 'Data Center', after: 'Symposium' };
  var boxedSvg = logoUnit.buildLogoUnitSvg({ parts: parts, style: 'boxed', tone: 'light', themeColor: '#0044cc', font: { family: 'Space Grotesk' }, etLogoSvg: ET_ON_LIGHT }).svg;
  ok(/^a 730 × 109 rectangle/.test(tool.boxIn(boxedSvg)), 'boxIn finds the box of a boxed drawing', tool.boxIn(boxedSvg));
  ok(/rectangle/.test(tool.boxIn('<svg><rect width="100%" height="100%" fill="#000"/><text>X</text></svg>')) && /^a path/.test(tool.boxIn('<svg><path d="M0 0h10v10z"/></svg>')) && /rectangle/.test(tool.boxIn('<svg><rect width="400" fill="#000"/></svg>')),
    'and a plate, a shape, a rectangle of no stated height');
  ok(tool.boxIn('<svg><image href="data:image/svg+xml;base64,' + Buffer.from('<svg><rect width="9" height="90"/><path d="M0 0"/></svg>').toString('base64') + '"/></svg>') === '' && tool.boxIn(logoUnit.buildLogoUnitSvg({ parts: parts, style: 'inline', tone: 'dark', themeColor: '#0044cc', etLogoSvg: ET_ON_DARK }).svg) === '',
    'but not the ET logo file embedded in a unit, nor an inline unit');

  /* ---------- whatever draws it, a unit with a box in it is never put in ---------- */
  fresh();
  seed();
  var boxHooks = withHook('drawnLogoUnit', function (fb, id, o) { return hooks.drawnLogoUnit(fb, id, Object.assign({}, o, { design: Object.assign({}, o.design, { logoUnitStyle: 'boxed' }) })); });
  var xdry = await tool.dryRun(FB, boxHooks, ID, { publish: true });
  var xPrinted = captured(function () { tool.printPlan(xdry.p, { width: 1, height: 1, darkUrl: 'x', font: 'Space Grotesk', box: xdry.drawn && xdry.drawn.box }, { publish: true, dry: true }); });
  ok(xdry.drawn && /rectangle/.test(xdry.drawn.box) && /IT HAS A BOX \(a \d+ × \d+ rectangle/.test(xPrinted), 'a drawing with a box: the dry run says a real run would stop', xPrinted);
  var xDesign = JSON.stringify(FB.docs['events/' + ID]), xPlan = await tool.plan(FB, hooks, ID, { publish: true });
  var xRun = await tool.apply(FB, boxHooks, logActivity, ORIGIN, xPlan, { publish: true, stamp: '20261114125000' }).then(function () { return 'ran'; }, function (e) { return e; });
  ok(xRun instanceof Error && /the drawn unit has a box in it \(a \d+ × \d+ rectangle/.test(xRun.message) && /never boxed; nothing but its two pictures/.test(xRun.message) && !xRun.lines.length &&
    JSON.stringify(FB.docs['events/' + ID]) === xDesign && savedOf(ID) === PAGE && liveOf(ID) === PAGE && !publishesOf(ID).length && filesUnder('events/' + ID + '/generated/').length === 2,
    'and a real run stops before the design, the hero, the site or the record is touched (only the two pictures stored)', xRun && xRun.message);

  /* ---------- a unit drawn before is used again only when it has no box in it ---------- */
  /* (a) one drawn boxed (when the site was designed): drawn anew, stacked */
  fresh();
  var oldPath = 'events/' + ID + '/generated/20261013000000-logo-unit.svg', oldUrl = 'https://storage.googleapis.com/test-bucket/' + oldPath;
  FB.files[oldPath] = Buffer.from(boxedSvg);
  seed(designWith({ logoUnitStyle: 'boxed', logoUnitSource: 'generated', logoUnitUrl: oldUrl, logoUnitStoragePath: oldPath, logoUnitWidth: 786, logoUnitHeight: 310 }));
  var oPlan = await tool.plan(FB, hooks, ID, { publish: true });
  ok(oPlan.ok && oPlan.draw && /it has a box in it: a 730 × 109 rectangle/.test(oPlan.redraw) && /not used again: it has a box in it.*drawn anew/.test(oPlan.heroNow), 'a boxed unit drawn before is not used again: drawn anew', oPlan.heroNow);
  await tool.apply(FB, hooks, logActivity, ORIGIN, oPlan, { publish: true, stamp: '20261114126000' });
  var oDesign = FB.docs['events/' + ID].designPlan.design, oSvg = FB.files['events/' + ID + '/generated/20261114126000-logo-unit.svg'].toString('utf8');
  ok(oDesign.logoUnitUrl.indexOf('20261114126000-logo-unit.svg') !== -1 && oDesign.logoUnitStyle === 'stacked' && oSvg === svg && liveOf(ID).indexOf('20261114126000-logo-unit.svg') !== -1 && liveOf(ID).indexOf(oldPath) === -1,
    'the stacked unit goes in, and live; the boxed one nowhere', oDesign.logoUnitUrl);
  /* (b) a run that stopped half-way (the site was being edited): the next run uses its unit, seen to have no box */
  fresh();
  seed();
  var hPlan = await tool.plan(FB, hooks, ID, { publish: true });
  var stuck = withHook('stageContent', function () { return Promise.reject(new Error('the site is being edited')); });
  var hRun = await tool.apply(FB, stuck, logActivity, ORIGIN, hPlan, { publish: true, stamp: '20261114127000' }).then(function () { return 'ran'; }, function (e) { return e; });
  ok(hRun instanceof Error && hRun.lines.length === 2 && liveOf(ID) === PAGE && !publishesOf(ID).length, 'a run stopped at the saved site: the design has the unit, nothing else changed', hRun && hRun.lines && hRun.lines.join(' | '));
  var hAgain = await tool.plan(FB, hooks, ID, { publish: true });
  ok(hAgain.ok && !hAgain.draw && hAgain.unit && /20261114127000-logo-unit\.svg/.test(hAgain.unit.url) && /20261114127000-logo-unit-on-dark\.svg/.test(hAgain.unit.darkUrl), 'the next run uses the unit drawn then, both pictures seen to have no box', hAgain.heroNow);
  await tool.apply(FB, hooks, logActivity, ORIGIN, hAgain, { publish: true, stamp: '20261114127100' });
  ok(FB.docs['events/' + ID].publishedVersion === 4 && liveOf(ID).indexOf('20261114127000-logo-unit.svg') !== -1 && filesUnder('events/' + ID + '/generated/').length === 2 && publishesOf(ID).length === 2,
    'and finishes: version 4 live with it, no second drawing, both versions noted', JSON.stringify({ v: FB.docs['events/' + ID].publishedVersion, files: filesUnder('events/' + ID + '/generated/'), pubs: publishesOf(ID).length }));

  /* ---------- a site generated since 13 Nov 2026: its generated hero is kept in its run's own document ---------- */
  fresh();
  var RUN = 'run-' + (Date.parse('2026-11-13T10:00:00Z')).toString(36) + '-bbbbbb';
  seed({ generatedSite: { runId: RUN, at: '2026-11-13T10:00:00Z', sections: [{ id: 'hero', kind: 'hero' }] } });
  delete FB.docs['events/' + ID].generatedSections;
  FB.docs['events/' + ID + '/generations/' + RUN + '/sections/hero'] = { id: 'hero', kind: 'hero', html: GEN_HERO, css: '', order: 0 };
  var rk = await tool.plan(FB, hooks, ID, {});
  ok(rk.ok && rk.genInType && /would be swapped/.test(rk.genHero), 'a run\'s own hero document is read', rk.genHero);
  await tool.apply(FB, hooks, logActivity, ORIGIN, rk, { stamp: '20261114150000' });
  var runHero = FB.docs['events/' + ID + '/generations/' + RUN + '/sections/hero'].html;
  ok(runHero.indexOf('generated/20261114150000-logo-unit.svg') !== -1 && runHero.indexOf('rv-lu-name') === -1 && !('generatedSections' in FB.docs['events/' + ID]),
    'and the drawn unit goes into it (no copy left on the event)', runHero.slice(0, 400));

  /* ---------- Google Fonts not answering: the run stops, having written only the two pictures ---------- */
  fresh();
  seed();
  var fdPlan = await tool.plan(FB, hooks, ID, { publish: true });
  var fdBefore = JSON.stringify(FB.docs['events/' + ID]);
  fontsDown = true;
  var fd = await tool.apply(FB, hooks, logActivity, ORIGIN, fdPlan, { publish: true, stamp: '20261114160000' }).then(function () { return 'ran'; }, function (e) { return e; });
  fontsDown = false;
  ok(fd && /heading font \(Space Grotesk\) could not be fetched/.test(fd.message) && JSON.stringify(FB.docs['events/' + ID]) === fdBefore && savedOf(ID) === PAGE && liveOf(ID) === PAGE &&
    filesUnder('events/' + ID + '/generated/').length === 2 && Array.isArray(fd.lines) && !fd.lines.length && !publishesOf(ID).length,
    'the heading font not to be had: stopped before the design, the hero, the site or the record is touched (only the two pictures stored)', fd && fd.message);
  var fdOk = await tool.apply(FB, hooks, logActivity, ORIGIN, fdPlan, { publish: true, stamp: '20261114160100' }).then(function (x) { return x; }, function (e) { return e; });
  ok(fdOk && fdOk.version === 4 && /its lettering in Space Grotesk \(embedded\)/.test((fdOk.lines || []).join('\n')), 'run again once the fonts answer: done', fdOk && (fdOk.message || fdOk.lines.join(' | ')));

  /* ---------- a run without --publish stages the version and leaves the live page as it is ---------- */
  fresh();
  seed();
  var sp = await tool.plan(FB, hooks, ID, {});
  var spPrinted = captured(function () { tool.printPlan(sp, null, {}); });
  ok(/version 4 is noted as live when it is published from the console: an approver can then put version 3 back/.test(spPrinted) && /publish: {9}not asked/.test(spPrinted), 'its dry run says what is noted now and what on publishing', spPrinted);
  await tool.apply(FB, hooks, logActivity, ORIGIN, sp, { stamp: '20261114130000' });
  ok(FB.docs['events/' + ID].site.version === 4 && FB.docs['events/' + ID].publishedVersion === 3 && liveOf(ID) === PAGE && /rv-lu-pic/.test(savedOf(ID)),
    'without --publish: version 4 saved and staged, the live page unchanged', JSON.stringify({ s: FB.docs['events/' + ID].site.version, p: FB.docs['events/' + ID].publishedVersion }));
  ok(publishesOf(ID).length === 1 && publishesOf(ID)[0].version === 3 && publishesOf(ID)[0].at === LIVE_AT, 'the live version is noted in the record (nothing else)', JSON.stringify(publishesOf(ID)));
  /* the console's Publish of version 4 later notes it (lib/api.js recordPublish, as the direct publish calls it): version 3 can then be put back */
  await hooks.recordPublish(FB, ID, 4, 'someone@timesinternet.in', 'direct', 3);
  var spBack = await putBack(ID, 4);
  ok(spBack && spBack.version === 3 && spBack.at === LIVE_AT, 'so once the console publishes version 4, version 3 can be put back', JSON.stringify(spBack));

  /* ---------- the saved site changed between the check and the run: left as it is ---------- */
  fresh();
  seed();
  var rp = await tool.plan(FB, hooks, ID, { publish: true });
  FB.docs['events/' + ID].site.version = 5;
  var raced = await tool.apply(FB, hooks, logActivity, ORIGIN, rp, { publish: true, stamp: '20261114140000' }).then(function () { return 'ran'; }, function (e) { return e.message; });
  ok(/changed since it was checked/.test(raced) && FB.docs['events/' + ID].publishedVersion === 3 && liveOf(ID) === PAGE && savedOf(ID) === PAGE && !publishesOf(ID).length,
    'a saved site that changed since the check is left as it is, nothing put live, nothing noted', raced);

  if (failures.length) { console.log('draw-logo-unit: ' + failures.length + ' of ' + checks + ' checks FAILED\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('draw-logo-unit: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.log('draw-logo-unit: crashed — ' + (err && err.stack)); process.exit(1); });

/* what a function prints */
function captured(fn) {
  var lines = [], was = console.log;
  console.log = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { console.log = was; }
  return lines.join('\n');
}
