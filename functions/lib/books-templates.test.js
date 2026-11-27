// node functions/lib/books-templates.test.js — the five Premium Editorial book templates (books-app/src/data/
// premiumTemplates.ts, Books Phase 3, 27 Nov 2026). The editor's own source is bundled in memory with esbuild (nothing is
// written to books/) and run here, so these checks see exactly what the editor builds:
//   each template is its own layout system (14–18 pages, 3–5 master pages, no page layout shared with another template
//   or the curated ones), every frame sits inside the page and its bleed, every photo is a sample photo given its true
//   pixel size, every font is in the editor's Google Fonts catalogue, text frames carry their roles, charts say their
//   figures are samples, no bare "ET", a Content editor may add a page from every master page (book-rules.js), and a book
//   made from each template has the template's master pages, chapters and photos.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '') + '\n'); }
var ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'books-app');
var rules = require('./book-rules.js');

/* ---------- the editor's code, bundled in memory ---------- */
var esbuild = require(path.join(APP, 'node_modules', 'esbuild'));
var bundle = esbuild.buildSync({
  stdin: {
    contents: [
      "export * from './src/data/premiumTemplates';",
      "export { createProjectFromBookTemplate } from './src/data/sampleProject';",
      "export { createProjectFromBookTemplateObject } from './src/engines/unlimitedTemplateEngine';",
      "export { GOOGLE_FONTS_CATALOG } from './src/engines/fontEngine';",
      "export { BUILTIN_BOOK_TEMPLATES, BOOK_TEMPLATE_CATEGORIES } from './src/data/bookTemplates';",
    ].join('\n'),
    resolveDir: APP,
    sourcefile: 'books-templates-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});
var mod = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, require: require, console: console, structuredClone: structuredClone, Date: Date, Math: Math, JSON: JSON }, { filename: 'books-templates-bundle.js' });
var E = mod.exports;
var TEMPLATES = E.PREMIUM_BOOK_TEMPLATES;

/* ---------- helpers ---------- */
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function round(n) { return Math.round(n * 10) / 10; }
/* a page's layout: the kind and geometry of every frame, in order of geometry (what it says and shows left out) */
function layoutSignature(page) {
  return page.elements.map(function (e) { return [e.type, round(e.xMm), round(e.yMm), round(e.widthMm), round(e.heightMm)].join(':'); }).sort().join('|');
}
function eachElement(tpl, fn) {
  var pages = tpl.buildPages();
  pages.forEach(function (p, i) { p.elements.forEach(function (el) { fn(el, 'page ' + (i + 1) + ' ' + p.label, p); }); });
  E.premiumMasterPages(tpl.id).forEach(function (m) { m.elements.forEach(function (el) { fn(el, 'master ' + m.name, m); }); });
}
function strings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(function (x) { strings(x, out); });
  else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { strings(v[k], out); });
  return out;
}
/* a new page made from a master page, as the editor makes it (pourEngine.pageFromLayout): linked to the master, its
   frames copies with new ids and the master's words */
function pageFromMaster(m, n) {
  return {
    id: 'pg_test_' + n,
    orderIndex: 0,
    label: 'New page',
    role: m.role,
    masterPageId: m.id,
    backgroundColor: m.backgroundColor,
    elements: m.elements.map(function (el, i) {
      var c = clone(el);
      delete c.contentSectionId;
      c.id = 'el_test_' + n + '_' + i;
      c.masterElementId = el.id;
      c.overriddenFromMaster = false;
      return c;
    }),
  };
}

/* ---------- 1 the set ---------- */
check('1.1 five premium templates', TEMPLATES.length === 5, TEMPLATES.map(function (t) { return t.name; }));
check('1.2 all in the Premium Editorial category, the library\'s first category',
  TEMPLATES.every(function (t) { return t.category === 'Premium Editorial'; }) && E.BOOK_TEMPLATE_CATEGORIES[0] === 'Premium Editorial');
var builtinIds = E.BUILTIN_BOOK_TEMPLATES.map(function (t) { return t.id; });
check('1.3 registered with the built-in templates, after the 32 curated ones (whose order the editor relies on)',
  TEMPLATES.every(function (t) { return builtinIds.indexOf(t.id) >= 32; }) &&
  E.BUILTIN_BOOK_TEMPLATES.slice(0, 32).every(function (t) { return t.category !== 'Premium Editorial'; }) && E.BUILTIN_BOOK_TEMPLATES.length === 37);
var sizes = TEMPLATES.map(function (t) { return t.dimensions.widthMm + 'x' + t.dimensions.heightMm; });
check('1.4 each has its own page size', new Set(sizes).size === 5, sizes);
var pairings = TEMPLATES.map(function (t) { var ty = t.designSystem.typography; return ty.displayFont + '+' + ty.bodyFont; });
check('1.5 …its own Google Fonts pairing', new Set(pairings).size === 5, pairings);
var palettes = TEMPLATES.map(function (t) { return t.designSystem.colors.primaryAccent + t.designSystem.colors.paper; });
check('1.6 …its own palette', new Set(palettes).size === 5, palettes);
var grids = TEMPLATES.map(function (t) { var d = t.dimensions; return [d.margins.top, d.margins.bottom, d.margins.inner, d.margins.outer, d.columns, d.columnGapMm, d.baselineGridMm].join('/'); });
check('1.7 …its own margins, grid and baseline', new Set(grids).size === 5, grids);

/* ---------- 2 each template ---------- */
var CATALOG = {};
E.GOOGLE_FONTS_CATALOG.forEach(function (f) { CATALOG[f.family] = f; });
var curatedSigs = {};
E.BUILTIN_BOOK_TEMPLATES.slice(0, 32).forEach(function (t) { t.buildPages().forEach(function (p) { curatedSigs[layoutSignature(p)] = t.name; }); });
var sigOwner = {};
var samplesDir = path.join(ROOT, 'books', 'samples');
var photoUses = [];

TEMPLATES.forEach(function (tpl) {
  var N = tpl.name;
  var pages = tpl.buildPages();
  var masters = E.premiumMasterPages(tpl.id);
  var d = tpl.dimensions, W = d.widthMm, H = d.heightMm, B = d.bleedMm;
  var ds = tpl.designSystem;

  check(N + ': 14–18 pages', pages.length >= 14 && pages.length <= 18, pages.length);
  check(N + ': 3–5 named master pages', masters.length >= 3 && masters.length <= 5 && masters.every(function (m) { return m.name && m.description; }), masters.length);
  check(N + ': builds the same pages every time (stable ids)', JSON.stringify(pages) === JSON.stringify(tpl.buildPages()));
  check(N + ': starts with a front cover and ends with a back cover', pages[0].role === 'front_cover' && pages[pages.length - 1].role === 'back_cover');
  var roles = new Set(pages.map(function (p) { return p.role; }));
  check(N + ': a title page or contents',
    roles.has('title_page') || roles.has('table_of_contents'), Array.from(roles));
  check(N + ': …at least nine kinds of page', roles.size >= 9, Array.from(roles));

  /* layouts: none shared with another template or a curated one */
  var shared = [];
  pages.forEach(function (p, i) {
    var sig = layoutSignature(p);
    if (sigOwner[sig] && sigOwner[sig] !== N) shared.push('page ' + (i + 1) + ' = ' + sigOwner[sig]);
    if (curatedSigs[sig]) shared.push('page ' + (i + 1) + ' = curated ' + curatedSigs[sig]);
  });
  pages.forEach(function (p) { sigOwner[layoutSignature(p)] = sigOwner[layoutSignature(p)] || N; });
  check(N + ': no page layout shared with another template', shared.length === 0, shared);
  var distinct = new Set(pages.map(layoutSignature)).size;
  check(N + ': its pages are varied (at least nine layouts; the rest are pages made from its master pages)', distinct >= 9, distinct + ' of ' + pages.length);

  /* frames */
  var outside = [], unsafe = [], badImg = [], badEmpty = [], fonts = [], noRole = [], notes = [], colours = [], ids = {}, dupIds = [], locked = [];
  var palette = ds.colors.palette.concat([ds.colors.paper, ds.colors.surface, ds.colors.ink, ds.colors.mutedInk, ds.colors.primaryAccent, ds.colors.secondaryAccent, '#FFFFFF', '#000000'])
    .map(function (c) { return c.toLowerCase(); });
  var rolesSeen = {};
  eachElement(tpl, function (el, where, holder) {
    var tag = where + ': ' + el.name;
    if (ids[el.id]) dupIds.push(el.id); ids[el.id] = 1;
    if (el.xMm < -B - 0.01 || el.yMm < -B - 0.01 || el.xMm + el.widthMm > W + B + 0.01 || el.yMm + el.heightMm > H + B + 0.01 || el.widthMm <= 0 || el.heightMm <= 0) outside.push(tag);
    if ((el.type === 'text' || el.type === 'infographic') && (el.xMm < d.safeAreaMm || el.yMm < d.safeAreaMm || el.xMm + el.widthMm > W - d.safeAreaMm || el.yMm + el.heightMm > H - d.safeAreaMm)) unsafe.push(tag);
    if (el.locked || el.hidden) locked.push(tag);
    if (el.type === 'image') {
      if (el.image.src) {
        photoUses.push({ tpl: N, tag: tag, src: el.image.src, w: el.image.naturalWidth, h: el.image.naturalHeight });
        if (!el.image.assetId || el.image.fit !== 'cover' || !(el.image.focalX >= 0 && el.image.focalX <= 100) || !(el.image.focalY >= 0 && el.image.focalY <= 100) || !el.image.alt) badImg.push(tag);
      } else {
        var tint = holder.elements.filter(function (s) {
          return s.type === 'shape' && s.zIndex < el.zIndex && s.xMm === el.xMm && s.yMm === el.yMm && s.widthMm === el.widthMm && s.heightMm === el.heightMm;
        })[0];
        if (!/ — drop a (photo|plan or section) here$/.test(el.name) || !tint || !tint.shape || !tint.shape.fill || tint.shape.fill === 'transparent') badEmpty.push(tag);
      }
    }
    if (el.textStyle) {
      var f = CATALOG[el.textStyle.fontFamily];
      if (!f) fonts.push(tag + ' ' + el.textStyle.fontFamily);
      else if (f.weights.indexOf(el.textStyle.fontWeight) === -1 || (el.textStyle.fontStyle === 'italic' && !f.hasItalic)) fonts.push(tag + ' ' + el.textStyle.fontFamily + ' ' + el.textStyle.fontWeight + ' ' + el.textStyle.fontStyle);
      if (palette.indexOf(String(el.textStyle.color).toLowerCase()) === -1) colours.push(tag + ' ' + el.textStyle.color);
      if (el.textStyle.fontSizePt < 7) fonts.push(tag + ' under 7 pt');
    }
    if (['text', 'header', 'footer', 'pageNumber'].indexOf(el.type) !== -1) {
      if (!el.textRole) noRole.push(tag);
      else rolesSeen[el.textRole] = 1;
      if (el.type === 'pageNumber' && (el.textRole !== 'folio' || el.text !== '{{page}}')) noRole.push(tag + ' (page number)');
      if (el.type === 'header' && el.textRole !== 'running_head') noRole.push(tag + ' (running head)');
    }
    if (el.type === 'infographic') {
      if (!CATALOG[el.infographic.fontFamily]) fonts.push(tag + ' chart ' + el.infographic.fontFamily);
      if (el.infographic.sourceNote !== 'Sample figures — replace with your own data before printing.') notes.push(tag);
      /* the chart renderer (engines/infographicEngine.ts) cuts labels at these lengths: none of ours may be cut */
      var LIMITS = { kpi_grid: [22, 32], horizontal_bars: [24, 99], survey_bars: [24, 99], donut_ring: [22, 99], radial_gauges: [18, 22],
        horizontal_timeline: [16, 20], milestone_zigzag: [16, 20], roadmap_tracks: [34, 56], vertical_timeline: [34, 56], esg_pillars: [20, 28], vertical_bars: [14, 99] };
      var lim = LIMITS[el.infographic.variant];
      if (!lim) notes.push(tag + ' (a chart kind the template test does not know: ' + el.infographic.variant + ')');
      else el.infographic.items.forEach(function (it) {
        if (String(it.label).length > lim[0] || String(it.description || '').length > lim[1] || String(it.category || '').length > 22) notes.push(tag + ' (cut short: ' + it.label + ')');
      });
      var timeline = /timeline|milestone|journey|roadmap|gantt/.test(el.infographic.variant);
      if (!timeline && el.infographic.items.some(function (it) { return it.value % 5 !== 0; })) notes.push(tag + ' (figures not round)');
    }
  });
  check(N + ': every frame inside the page and its bleed', outside.length === 0, outside);
  check(N + ': text and charts inside the safe area (the print check)', unsafe.length === 0, unsafe);
  check(N + ': frame ids unique across pages and master pages', dupIds.length === 0, dupIds);
  check(N + ': no frame locked or hidden', locked.length === 0, locked);
  check(N + ': every photo frame has its photo, a focal point, its true size and alt text', badImg.length === 0, badImg);
  check(N + ': every empty frame says what goes in it ("Portrait — drop a photo here") and sits on a quiet tint', badEmpty.length === 0, badEmpty);
  check(N + ': every font is in the editor\'s Google Fonts catalogue, at a weight and style it has', fonts.length === 0, fonts);
  var dsFonts = ['primaryFont', 'secondaryFont', 'displayFont', 'headingFont', 'bodyFont', 'captionFont', 'quoteFont', 'numericalFont'].map(function (k) { return ds.typography[k]; });
  check(N + ': the design system\'s fonts too', dsFonts.every(function (f) { return CATALOG[f]; }), dsFonts);
  check(N + ': every text colour is in the design system\'s palette (no off-palette notice in the print check)', colours.length === 0, colours);
  check(N + ': every text frame has its role, page numbers are folios and running heads running heads', noRole.length === 0, noRole);
  check(N + ': headings, body text, captions, page numbers and running heads all present',
    ['heading', 'body', 'caption', 'folio', 'running_head'].every(function (r) { return rolesSeen[r]; }) && (rolesSeen.display || rolesSeen.subheading), Object.keys(rolesSeen));
  check(N + ': every chart says its figures are samples, they are round, and no label is cut short', notes.length === 0, notes);

  /* page numbers sit in one place throughout the book */
  var folioSpots = new Set();
  pages.forEach(function (p) { p.elements.forEach(function (el) { if (el.type === 'pageNumber') folioSpots.add([el.xMm, el.yMm, el.widthMm, el.heightMm].join(',')); }); });
  check(N + ': page numbers in one place on every page that has one', folioSpots.size === 1, Array.from(folioSpots));

  /* master pages: built from the same frames as the pages, and a page linked to one has every frame of it */
  var masterIds = masters.map(function (m) { return m.id; });
  var linkErrors = [];
  pages.forEach(function (p, i) {
    if (!p.masterPageId) return;
    var m = masters.filter(function (x) { return x.id === p.masterPageId; })[0];
    if (!m) { linkErrors.push('page ' + (i + 1) + ' has no master ' + p.masterPageId); return; }
    if (p.backgroundColor !== m.backgroundColor && !p.elements.some(function (e) { return e.overriddenFromMaster; })) linkErrors.push('page ' + (i + 1) + ' background');
    m.elements.forEach(function (me) {
      var pe = p.elements.filter(function (e) { return e.masterElementId === me.id; })[0];
      if (!pe) linkErrors.push('page ' + (i + 1) + ' lacks ' + me.name);
    });
    p.elements.forEach(function (e) { if (e.masterElementId && masterIds.indexOf(e.masterElementId.split('_').slice(0, -1).join('_')) === -1 && !m.elements.some(function (me) { return me.id === e.masterElementId; })) linkErrors.push('page ' + (i + 1) + ' ' + e.name + ' links nowhere'); });
  });
  check(N + ': pages made from a master page are linked to it, frame by frame', linkErrors.length === 0, linkErrors);
  var usedMasters = new Set(pages.map(function (p) { return p.masterPageId; }).filter(Boolean));
  check(N + ': every master page is used by at least one page of the template', masters.every(function (m) { return usedMasters.has(m.id); }), masters.map(function (m) { return m.name + (usedMasters.has(m.id) ? '' : ' (unused)'); }));

  /* no bare "ET", no real names or ETB2B branding inside a template */
  var words = strings([tpl.name, tpl.description, tpl.tags, pages, masters, E.PREMIUM_TEMPLATE_DETAILS[tpl.id]], []).join('\n');
  check(N + ': no bare "ET" and no ETB2B or Economic Times branding inside the template', !/\bET\b/.test(words) && !/ETB2B|Economic Times/i.test(words), (words.match(/.{0,30}\bET\b.{0,30}/) || [])[0]);
  check(N + ': template text reads as template text (names are placeholders)', /Organisation name|Company name|Leader name|Winner name|Photographer name/.test(words));

  /* a book made from it */
  var made = E.applyPremiumTemplate(E.createProjectFromBookTemplate(tpl.id), tpl.id);
  var madeObj = E.applyPremiumTemplate(E.createProjectFromBookTemplateObject(tpl), tpl.id);
  [['by id', made], ['from the template object', madeObj]].forEach(function (pair) {
    var b = pair[1], how = pair[0];
    var pageMasters = b.pages.filter(function (p) { return p.masterPageId; }).map(function (p) { return p.masterPageId; });
    var chapterIds = b.chapters.map(function (c) { return c.id; });
    var assetUrls = b.imageAssets.map(function (a) { return a.url; });
    var usedSrcs = [];
    b.pages.concat(b.masterPages).forEach(function (p) { p.elements.forEach(function (e) { if (e.type === 'image' && e.image.src) usedSrcs.push(e.image.src); }); });
    check(N + ': a book made from it (' + how + ') has its pages, page size and design system', b.pages.length === pages.length && b.dimensions.widthMm === W && b.designSystem.typography.bodyFont === ds.typography.bodyFont && b.category === 'Premium Editorial');
    check(N + ': …its own master pages, which its pages link to', JSON.stringify(b.masterPages) === JSON.stringify(masters) && pageMasters.every(function (id) { return masterIds.indexOf(id) !== -1; }));
    check(N + ': …chapters its pages belong to', b.pages.every(function (p) { return !p.chapterId || chapterIds.indexOf(p.chapterId) !== -1; }) && chapterIds.length >= 3);
    check(N + ': …every photo it uses in its photo library, once', usedSrcs.every(function (s) { return assetUrls.indexOf(s) !== -1; }) && new Set(assetUrls).size === assetUrls.length, usedSrcs.filter(function (s) { return assetUrls.indexOf(s) === -1; }));
    check(N + ': …and it survives a save (plain JSON)', JSON.stringify(JSON.parse(JSON.stringify(b))) === JSON.stringify(b));
  });

  /* a Content editor adds a page from each master page: content only (book-rules.js) */
  masters.forEach(function (m, k) {
    var after = Object.assign({}, made, { pages: made.pages.concat([Object.assign(pageFromMaster(m, k), { orderIndex: made.pages.length })]) });
    var why = rules.designChanges(made, after);
    check(N + ': a Content editor may add a page from master "' + m.name + '"', why.length === 0, why);
  });
  /* …and a copy of any page with its words and photos left out (the other way to add a page) */
  var copyWhy = [];
  made.pages.forEach(function (p, i) {
    var copy = clone(p);
    copy.id = 'pg_copy_' + i;
    copy.orderIndex = made.pages.length;
    copy.elements.forEach(function (e, j) { e.id = 'el_copy_' + i + '_' + j; if (e.type === 'text') e.text = ''; if (e.type === 'image') e.image.src = ''; });
    var w = rules.designChanges(made, Object.assign({}, made, { pages: made.pages.concat([copy]) }));
    if (w.length) copyWhy.push('page ' + (i + 1) + ': ' + w[0]);
  });
  check(N + ': …or a copy of any of its pages', copyWhy.length === 0, copyWhy);
  check(N + ': the book made from it is unchanged by nothing (no design change found where there is none)', rules.designChanges(made, clone(made)).length === 0);
});

/* ---------- 3 the editor makes these books itself (sampleProject.ts and unlimitedTemplateEngine.ts call applyPremiumTemplate) ---------- */
(function () {
  var tpl = TEMPLATES[0];
  var direct = E.createProjectFromBookTemplate(tpl.id);
  var directObj = E.createProjectFromBookTemplateObject(tpl);
  var masters = E.premiumMasterPages(tpl.id);
  check('3.1 a book created from a premium template in the editor gets the template\'s master pages, chapters and photos (createProjectFromBookTemplate)',
    JSON.stringify(direct.masterPages) === JSON.stringify(masters) && direct.chapters[1] && direct.chapters[1].id === 'ch_cat1');
  check('3.2 …and from the template object (createProjectFromBookTemplateObject, the library\'s other path)',
    JSON.stringify(directObj.masterPages) === JSON.stringify(masters));
  var curated = E.createProjectFromBookTemplate(E.BUILTIN_BOOK_TEMPLATES[0].id);
  check('3.3 a curated template\'s book is unchanged by it', E.applyPremiumTemplate(clone(curated), curated.id === undefined ? 'x' : E.BUILTIN_BOOK_TEMPLATES[0].id).masterPages[0].id === curated.masterPages[0].id);
})();

/* ---------- 4 the library ---------- */
(function () {
  var MODAL = fs.readFileSync(path.join(APP, 'src', 'components', 'TemplateLibraryModal.tsx'), 'utf8');
  check('4.1 the library shows the Premium Editorial books first, marked Premium, with pages drawn from the template, the page count, size and a line on each',
    /PREMIUM_CATEGORY,\n\s*'Reports & Research'/.test(MODAL) && /aria-label="Premium Editorial templates"/.test(MODAL) && />\s*Premium\s*</.test(MODAL) &&
    /<TemplateShowcase/.test(MODAL) && /\{d\?\.pageCount \?\? ''\} pages, \{tpl\.dimensions\.widthMm\} × \{tpl\.dimensions\.heightMm\} mm/.test(MODAL) && /d\?\.tagline/.test(MODAL));
  check('4.2 …and loads their fonts as the editor does', /loadGoogleFont\(f\)/.test(MODAL));
  var details = E.PREMIUM_TEMPLATE_DETAILS;
  check('4.3 each library card previews the cover and two spreads that exist',
    TEMPLATES.every(function (t) { var s = details[t.id].showcase; return s.length === 3 && s[0].length === 1 && s[0][0] === 0 && s.slice(1).every(function (g) { return g.length === 2 && g[0] % 2 === 1 && g[1] === g[0] + 1 && g[1] < details[t.id].pageCount; }); }));
})();

/* ---------- 5 the photos (async: their true sizes) ---------- */
(async function () {
  var sharp = null; try { sharp = require('sharp'); } catch (e) { /* checked by name only */ }
  var missing = [], wrong = [], cache = {};
  for (var i = 0; i < photoUses.length; i++) {
    var u = photoUses[i];
    var rel = u.src.replace(/^\//, '');
    var file = path.join(ROOT, rel);
    if (!/^books\/samples\/[^/]+\.jpg$/.test(rel) || !fs.existsSync(file)) { missing.push(u.tpl + ' ' + u.tag + ' ' + u.src); continue; }
    if (sharp) {
      if (!cache[file]) { var m = await sharp(file).metadata(); cache[file] = m.width + 'x' + m.height; }
      if (cache[file] !== u.w + 'x' + u.h) wrong.push(u.tpl + ' ' + u.tag + ' says ' + u.w + 'x' + u.h + ', is ' + cache[file]);
    }
  }
  check('5.1 every photo is a sample photo in books/samples/', photoUses.length > 0 && missing.length === 0, missing);
  check('5.2 …given its true pixel size', !sharp || wrong.length === 0, wrong);
  var listed = Object.keys(E.PREMIUM_PHOTOS).map(function (k) { return E.PREMIUM_PHOTOS[k]; });
  var listWrong = [];
  for (var j = 0; j < listed.length; j++) {
    var f2 = path.join(ROOT, listed[j].url.replace(/^\//, ''));
    if (!fs.existsSync(f2)) { listWrong.push(listed[j].url + ' missing'); continue; }
    if (fs.statSync(f2).size !== listed[j].sizeBytes) listWrong.push(listed[j].url + ' bytes');
    if (sharp) { var mm = await sharp(f2).metadata(); if (mm.width !== listed[j].widthPx || mm.height !== listed[j].heightPx) listWrong.push(listed[j].url + ' size'); }
  }
  check('5.3 the photo list (PREMIUM_PHOTOS) names ten photos with their true sizes and bytes', listed.length === 10 && listWrong.length === 0, listWrong);
  var people = photoUses.filter(function (u) { return /editorial_heritage_craft/.test(u.src) && /Portrait|Winner|Leader|winner|leader/.test(u.tag); });
  check('5.4 the photo of the craftsman is never a winner or a leader', people.length === 0, people);
  process.stdout.write('books-templates: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})();
