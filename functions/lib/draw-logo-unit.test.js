/* tools/draw-logo-unit.js on an in-memory Firestore + Storage: the National Data Center Symposium — an AI-designed site
   whose banner sets its name in type, with no uploaded logo and no previous edition's logo — gets the product's drawn
   unit (api-generate.js drawnLogoUnit: the name lock-up with the official ET logo, its red square unchanged) in its
   design, its generated hero and its saved hero, as a new version put live. The dry run writes nothing; nothing else on
   the page changes; a second run does nothing; the events it must leave alone are left alone. */
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

/* ---------- the National Data Center Symposium's saved page: its hero as the live page has it (14 Nov 2026) ---------- */
var NAME = 'National Data Center Symposium', ID = 'national-data-center-symposium';
/* the lock-up set in type, exactly as the live hero has it */
var UNIT_IN_TYPE = '<div class="rv-lu rv-lu-on-light" data-rv-logo-unit=""><div class="rv-lu-name"><span class="rv-lu-pre">National</span><span class="rv-lu-key">Data Center</span><span class="rv-lu-post">Symposium</span></div>' +
  '<div class="rv-lu-by"><span class="rv-lu-by-label">An initiative by</span><img class="rv-lu-et" src="/templates/_shared/img/et-business-verticals-on-light.svg" alt="The Economic Times Business Verticals" width="320" height="31"></div></div>';
var HERO = '<section data-rv-section="hero" id="hero" class="hero-section" data-rv-key="hero"><div class="hero-overlay"></div><div class="hero-container">' + UNIT_IN_TYPE +
  '<div class="hero-badge-row"><span class="hero-badge">Strategic Leadership Summit</span><span class="hero-badge-meta">9 December 2027</span></div>' +
  '<h1 class="hero-headline">Delivering Scaled Compute, Power &amp; High-Density Infrastructure</h1>' +
  '<p class="hero-lead">The next wave of data centre growth will not be measured by megawatts or floor space alone.</p>' +
  '<div class="hero-actions"><a href="#ecosystem-imperative" class="hero-btn-primary">Explore Key Imperatives</a><a href="#critical-infrastructure-matrix" class="hero-btn-secondary">View Infrastructure Matrix</a></div>' +
  '<div class="hero-metrics-bar"><div class="hero-metric-item"><span class="hero-metric-label">Scope</span><strong class="hero-metric-value">Full Ecosystem</strong></div></div></div></section>';
function page(hero) {
  return '<!DOCTYPE html><html lang="en" data-rv-edges="smooth"><head><meta charset="utf-8"><title>' + NAME + '</title>' +
    '<style data-rv-style="hero">[data-rv-section="hero"] .hero-container{max-width:1200px}</style></head>' +
    '<body id="gen" data-rv-template-id="gen-' + ID + '" data-rv-event-id="' + ID + '" class="microsite rv-generated" style="--theme-color:#0044cc;--heading-font-family:&quot;Space Grotesk&quot;, Arial, sans-serif">' +
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

function seed(id, ev, html) {
  FB.docs['events/' + id] = Object.assign({ name: NAME, createdAt: '2026-10-13T00:00:00.000Z', portal: 'ciso', start: '2027-12-09', end: '2027-12-09', published: true, publishedVersion: 3,
    publishedBy: 'someone@timesinternet.in', site: { version: 3, templateId: 'gen-' + id }, designPlan: { design: clone(DESIGN), sections: [] },
    generatedSections: [{ id: 'hero', kind: 'hero', html: GEN_HERO, css: '' }] }, ev || {});
  if (html !== null) {
    FB.files['events/' + id + '/site/page.html'] = Buffer.from(html || PAGE);
    FB.files['events/' + id + '/site/versions/3/page.html'] = Buffer.from(html || PAGE);
    FB.files['events/' + id + '/published/index.html'] = Buffer.from(html || PAGE);
  }
}
seed(ID);
/* the ones to leave alone */
seed('ported-site', { designPlan: { design: { sectionEdges: 'smooth' } } });
seed('owner-logo', { logoUrl: 'https://storage.googleapis.com/test-bucket/events/owner-logo/logo/l.png' });
seed('newer-work', { site: { version: 4, templateId: 'gen-newer-work' } });
seed('waiting', { approval: { id: 'req123456', toVersion: 3 } });
seed('previous-named');
FB.docs['events/previous-named/sources/s1'] = { type: 'previousEdition', url: 'https://ciso.economictimes.indiatimes.com/2026/', fetchedAt: '2026-10-01', logoCandidates: [{ url: 'https://img.etb2bimg.com/x/logo-2026.png', score: 80 }] };
seed('own-picture', {}, page(HERO.replace(UNIT_IN_TYPE, '<div class="rv-lu rv-lu-pic rv-lu-on-light" data-rv-logo-unit=""><img class="rv-lu-img" src="https://storage.googleapis.com/test-bucket/events/own-picture/media/chosen.png" alt="x" width="600" height="200"></div>')));
seed('no-unit-block', {}, page(HERO.replace(UNIT_IN_TYPE, '<div class="hero-title">' + NAME + '</div>')));

function snapshot() {
  return JSON.stringify({ docs: FB.docs, files: Object.keys(FB.files).sort().map(function (k) { return k + ':' + FB.files[k].toString('base64'); }) });
}
function filesUnder(prefix) { return Object.keys(FB.files).filter(function (k) { return k.indexOf(prefix) === 0; }); }
function liveOf(id) { var f = FB.files['events/' + id + '/published/index.html']; return f ? f.toString('utf8') : ''; }
function savedOf(id) { var f = FB.files['events/' + id + '/site/page.html']; return f ? f.toString('utf8') : ''; }
function count(s, re) { return (String(s).match(re) || []).length; }
/* the ET logo embedded in a drawn unit: the official file as it is, or null */
function embeddedLogo(svg) {
  var m = /<image\b[^>]*\shref="data:image\/svg\+xml;base64,([A-Za-z0-9+\/=]+)"[^>]*\/>/.exec(svg);
  return m ? { file: Buffer.from(m[1], 'base64').toString('utf8'), tag: m[0] } : null;
}
function hex(s) { var m = /#([0-9a-f]{6})/i.exec(s); return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null; }
function near(a, b, tol) { return !!a && !!b && a.every(function (v, i) { return Math.abs(v - b[i]) <= tol; }); }

(async function () {
  /* ---------- the dry run: reads, draws in memory, writes nothing ---------- */
  var before = snapshot();
  var dry = await tool.dryRun(FB, hooks, ID, { publish: true });
  ok(dry.p.ok && dry.p.draw, 'NDCS: the dry run finds the work to do', dry.p.line);
  ok(snapshot() === before, 'the dry run writes nothing (no event field, no file, no history line)');
  ok(modelCalls === 0, 'no model is asked anything');
  ok(dry.drawn && /^<svg\b/.test(dry.drawn.svg), 'the dry run draws the unit in memory', dry.drawn && dry.drawn.svg.slice(0, 120));
  ok(/before "National", keyword "Data Center", after "Symposium"/.test(captured(function () { tool.printPlan(dry.p, { width: 1, height: 1, darkUrl: 'x', font: '' }, { publish: true, dry: true }); })),
    'it prints the parts it draws from (the design\'s own split)');
  var printed = captured(function () { tool.printPlan(dry.p, { width: 1, height: 1, darkUrl: 'x', font: '' }, { publish: true, dry: true }); });
  ok(printed.indexOf('<div class="rv-lu rv-lu-on-light" data-rv-logo-unit="">') !== -1 && /An initiative by/.test(printed) && /would go live \(live version 3 = saved version 3\)/.test(printed),
    'it prints the hero element it would replace, and that it would publish', printed);

  /* ---------- refusals: each left exactly as it was ---------- */
  var refusals = [['ported-site', /not an AI-designed site/], ['owner-logo', /uploaded a logo: tools\/repair-owner-logo\.js/], ['newer-work', /not the live one/],
    ['waiting', /waiting for approval/], ['previous-named', /previous edition's page names a logo.*repair-logo-unit\.js/], ['own-picture', /picture of its own/],
    ['no-unit-block', /no logo unit block/], ['no-such-event', /no such event/]];
  for (var r = 0; r < refusals.length; r++) {
    var was = snapshot(), p = await tool.plan(FB, hooks, refusals[r][0], { publish: true });
    ok(!p.ok && !p.nothing && refusals[r][1].test(p.line), refusals[r][0] + ': refused — ' + refusals[r][1], p.line);
    ok(snapshot() === was, refusals[r][0] + ': nothing written');
  }
  var notLive = await tool.plan(FB, hooks, 'newer-work', {});
  ok(!notLive.ok, 'newer saved work is refused even without --publish (it would go live with the next approval)', notLive.line);

  /* ---------- the run, with --publish ---------- */
  var plan = await tool.plan(FB, hooks, ID, { publish: true });
  var done = await tool.apply(FB, hooks, logActivity, 'https://cms.example', plan, { publish: true, stamp: '20261114120000' });
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
  ok(/drawn: .*its lettering in Space Grotesk \(embedded\)/.test(done.lines.join('\n')), 'the run says the font was embedded', done.lines.join('\n'));
  ok(!/<rect\b/.test(svg) && !/plate/i.test(svg), 'never boxed, never on a plate (style stacked)');
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
  ok(d.themeColor === '#0044cc' && d.headingFont === 'Space Grotesk' && JSON.stringify(d.logoUnit) === JSON.stringify(DESIGN.logoUnit), 'the rest of the design is as it was');
  var gen = ev.generatedSections[0].html;
  ok(gen.indexOf('<img class="rv-lu-img" src="' + unitUrl + '" alt="' + NAME + '" width="' + info.width + '" height="' + info.height + '" decoding="async">') !== -1 &&
    gen.indexOf('<img class="rv-lu-img rv-lu-dark" src="' + darkUrl + '" alt="" aria-hidden="true"') !== -1 && gen.indexOf('rv-lu-name') === -1, 'the generated hero shows the unit, its dark copy beside it', gen.slice(0, 700));

  /* the saved hero: the lock-up set in type replaced by the unit's picture, nothing else */
  var saved = savedOf(ID);
  var block = '<div class="rv-lu rv-lu-pic rv-lu-on-light" data-rv-logo-unit><img class="rv-lu-img" src="' + unitUrl + '" alt="' + NAME + '" width="' + info.width + '" height="' + info.height + '" decoding="async">' +
    '<img class="rv-lu-img rv-lu-dark" src="' + darkUrl + '" alt="" aria-hidden="true" width="' + info.width + '" height="' + info.height + '" decoding="async"></div>';
  var oldBlock = UNIT_IN_TYPE;
  ok(saved === PAGE.replace(oldBlock, block),'the saved page is the page before with only the lock-up replaced, by the unit as gen-design.js shows one', saved.slice(PAGE.indexOf('<section data-rv-section="hero"'), PAGE.indexOf('<section data-rv-section="hero"') + 900));
  ok(count(saved, /<h1\b/g) === 1 && /<h1 class="hero-headline">Delivering Scaled Compute/.test(saved), 'the page keeps its one h1, as it was');
  ok(ev.site.version === 4 && FB.files['events/' + ID + '/site/versions/4/page.html'] && FB.files['events/' + ID + '/site/versions/4/page.html'].toString() === saved, 'kept as version 4');
  var changes = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + ID + '/changes/') === 0; }).map(function (k) { return FB.docs[k]; });
  ok(changes.length === 1 && changes[0].version === 4 && changes[0].note === tool.NOTE && changes[0].by === 'platform' && changes[0].items.length > 0,
    'with its change record (by platform, the note saying why)', JSON.stringify(changes).slice(0, 600));

  /* live: version 4, through the publish step; screen readers and search engines get the name */
  ok(ev.published === true && ev.publishedVersion === 4, 'version 4 is live', JSON.stringify({ p: ev.published, v: ev.publishedVersion }));
  ok(/version 4 saved/.test(done.lines.join('\n')) && /live: {12}version 4/.test(done.lines.join('\n')), 'the run says what it did', done.lines.join('\n'));
  var live = liveOf(ID);
  ok(live.indexOf('src="' + unitUrl) !== -1 || live.indexOf(unitPath) !== -1, 'the live page shows the unit', (live.match(/<div class="rv-lu[^>]*>[\s\S]{0,400}/) || [''])[0]);
  ok(/<img class="rv-lu-img" [^>]*alt="National Data Center Symposium"/.test(live) && count(live.replace(/<template[\s\S]*?<\/template>/g, ''), /<h1\b/g) === 1, 'the live page: the picture named by the event\'s name, one h1', (live.match(/<h1[^>]*>[^<]*/g) || []).join(' | '));
  var hist = Object.keys(FB.docs).filter(function (k) { return k.indexOf('events/' + ID + '/activity/') === 0; }).map(function (k) { return FB.docs[k]; });
  ok(hist.some(function (a) { return /put live on the owner's instruction \(14 Nov 2026\)/.test(JSON.stringify(a)); }), 'the history says it was put live on the owner\'s instruction (14 Nov 2026)', JSON.stringify(hist).slice(0, 700));
  ok(hist.some(function (a) { return /tools\/draw-logo-unit\.js/.test(JSON.stringify(a)) && /logo-changed/.test(JSON.stringify(a)); }), 'and that the logo was drawn into the design');

  /* a lock-up that held the page's h1: the published page keeps an h1 with the event's name (site-a11y.js) */
  var h1Page = page(HERO.replace('<div class="rv-lu-name">', '<h1 class="rv-lu-name">').replace('<span class="rv-lu-post">Symposium</span></div>', '<span class="rv-lu-post">Symposium</span></h1>').replace('<h1 class="hero-headline">', '<p class="hero-headline">').replace('Infrastructure</h1>', 'Infrastructure</p>'));
  var w = tool.withUnit(h1Page, { url: unitUrl, darkUrl: darkUrl, width: 600, height: 300, heroMode: '' }, { name: NAME, designMode: 'light' });
  var passed = hooks.sitePagePass(w.html, { mode: 'live', event: { name: NAME }, templateId: 'gen-' + ID });
  ok(w.h1 && count(w.html, /<h1\b/g) === 0 && /<h1 class="rv-sr-only" data-rv-a11y>National Data Center Symposium<\/h1>/.test(passed) && count(passed, /<h1\b/g) === 1,
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

  /* ---------- a site generated since 13 Nov 2026: its generated hero is kept in its run's own document ---------- */
  var RUN = 'run-' + (Date.parse('2026-11-13T10:00:00Z')).toString(36) + '-bbbbbb';
  seed('run-kept', { generatedSite: { runId: RUN, at: '2026-11-13T10:00:00Z', sections: [{ id: 'hero', kind: 'hero' }] } });
  delete FB.docs['events/run-kept'].generatedSections;
  FB.docs['events/run-kept/generations/' + RUN + '/sections/hero'] = { id: 'hero', kind: 'hero', html: GEN_HERO, css: '', order: 0 };
  var rk = await tool.plan(FB, hooks, 'run-kept', {});
  ok(rk.ok && rk.genInType && /would be swapped/.test(rk.genHero), 'a run\'s own hero document is read', rk.genHero);
  await tool.apply(FB, hooks, logActivity, 'https://cms.example', rk, { stamp: '20261114150000' });
  var runHero = FB.docs['events/run-kept/generations/' + RUN + '/sections/hero'].html;
  ok(runHero.indexOf('generated/20261114150000-logo-unit.svg') !== -1 && runHero.indexOf('rv-lu-name') === -1 && !('generatedSections' in FB.docs['events/run-kept']),
    'and the drawn unit goes into it (no copy left on the event)', runHero.slice(0, 400));

  /* ---------- Google Fonts not answering: the run stops, having written only the two pictures ---------- */
  seed('fonts-down', { name: NAME });
  var fdPlan = await tool.plan(FB, hooks, 'fonts-down', { publish: true });
  var fdBefore = JSON.stringify(FB.docs['events/fonts-down']);
  fontsDown = true;
  var fd = await tool.apply(FB, hooks, logActivity, 'https://cms.example', fdPlan, { publish: true, stamp: '20261114160000' }).then(function () { return 'ran'; }, function (e) { return e; });
  fontsDown = false;
  ok(fd && /heading font \(Space Grotesk\) could not be fetched/.test(fd.message) && JSON.stringify(FB.docs['events/fonts-down']) === fdBefore && savedOf('fonts-down') === PAGE && liveOf('fonts-down') === PAGE &&
    filesUnder('events/fonts-down/generated/').length === 2 && Array.isArray(fd.lines) && !fd.lines.length,
    'the heading font not to be had: stopped before the design, the hero or the site is touched (only the two pictures stored)', fd && fd.message);
  var fdOk = await tool.apply(FB, hooks, logActivity, 'https://cms.example', fdPlan, { publish: true, stamp: '20261114160100' }).then(function (r) { return r; }, function (e) { return e; });
  ok(fdOk && fdOk.version === 4 && /its lettering in Space Grotesk \(embedded\)/.test((fdOk.lines || []).join('\n')), 'run again once the fonts answer: done', fdOk && (fdOk.message || fdOk.lines.join(' | ')));

  /* ---------- a run without --publish stages the version and leaves the live page as it is ---------- */
  seed('staged-only', { name: NAME });
  var sp = await tool.plan(FB, hooks, 'staged-only', {});
  await tool.apply(FB, hooks, logActivity, 'https://cms.example', sp, { stamp: '20261114130000' });
  ok(FB.docs['events/staged-only'].site.version === 4 && FB.docs['events/staged-only'].publishedVersion === 3 && liveOf('staged-only') === PAGE && /rv-lu-pic/.test(savedOf('staged-only')),
    'without --publish: version 4 saved and staged, the live page unchanged', JSON.stringify({ s: FB.docs['events/staged-only'].site.version, p: FB.docs['events/staged-only'].publishedVersion }));
  /* the saved site changed between the check and the run: left as it is */
  seed('raced', { name: NAME });
  var rp = await tool.plan(FB, hooks, 'raced', { publish: true });
  FB.docs['events/raced'].site.version = 5;
  var raced = await tool.apply(FB, hooks, logActivity, 'https://cms.example', rp, { publish: true, stamp: '20261114140000' }).then(function () { return 'ran'; }, function (e) { return e.message; });
  ok(/changed since it was checked/.test(raced) && FB.docs['events/raced'].publishedVersion === 3 && liveOf('raced') === PAGE && savedOf('raced') === PAGE,
    'a saved site that changed since the check is left as it is, nothing put live', raced);

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
