// node functions/lib/create-event-screens.test.js — Create Event's clearer screens (UX batch B17):
//   UX-050  one list of the design's sections, under the design's own names, with one count ("10 of 11 sections on
//           your site") in the gallery, the toast after "Use this template" and the details form; only the rows with a
//           form here are numbered; another portal's "About …" starts switched off (and the hand-off hides it);
//   UX-051  on a phone a picked section's form is scrolled to, the canvases show the site at a phone's width, Preview
//           sits in the header row and the footer is one row;
//   UX-052  the method screen has no footer Continue: a design is chosen only by its own button;
//   UX-053  plain words (Web address, Open in editor, Main button, Sets the Nominate button, industries, Top banner,
//           Key numbers, Event details, an eyebrow per busy screen, the brief's error);
//   UX-054  "Generate my site" first says what ETB2B AI will use, and starts nothing until Generate;
//   UX-055  the gallery's picture takes the wheel only once clicked, and the editor's outlines are not drawn on it;
//   UX-056  text over its length says what the site does with it, under the counter and in the "things to check" list;
//   UX-057  a busy screen has one way out (no footer Cancel beside its own), and "Reading …" closes when reading ends;
//   UX-058  for Awards and Client Events the brief card says what it builds and the conference designs wait behind
//           "Use a conference design anyway".
// The page runs in a vm over a fake DOM (fixtures/create-event-page.js). No network, no Firebase, no browser, no AI.
// Exits 1 on failure.
'use strict';
var F = require('./fixtures/create-event-page');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 12); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }
var page = F.page, SRC = F.SRC;
var TECH500 = JSON.parse(F.read('templates/tech500/template.json'));
var RETAIL = JSON.parse(F.read('templates/retail-leadership-summit/template.json'));

/* a mounted canvas, as far as the gallery and quietCanvas use one: its template, a document and setDevice */
function fakeCanvas(json, log) {
  var styles = [];
  var doc = {
    head: { appendChild: function (el) { styles.push(el); } },
    createElement: function () { var a = {}; return { setAttribute: function (k) { a[k] = true; }, attrs: a, textContent: '' }; },
    querySelector: function (sel) {
      var m = /^style\[(data-[a-z-]+)\]$/.exec(sel);
      if (m) return styles.filter(function (s) { return s.attrs[m[1]]; })[0] || null;
      return null;
    },
    querySelectorAll: function () { return []; }
  };
  return { template: json, doc: doc, styles: styles, setDevice: function (d) { (log.devices = log.devices || []).push(d); } };
}
function phone(p, on) {
  p.ctx.matchMedia = function () { return { matches: !!on, addListener: function () {}, addEventListener: function () {} }; };
}

async function main() {
  check('ES5: the page script', (function () {
    try { require('esbuild').transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).slice(0, 200); }
  })());

  /* =====================================================================================================
     UX-050 one list, one count, the design's own names
     ===================================================================================================== */
  var p = F.load();
  await p.ce('loadPortalRoster()');
  p.ctx.__t500 = TECH500; p.ctx.__retail = RETAIL;
  p.ce('S.basics.portal = "retail"; S.basics.category = "IP"; setTemplateInfo(templateById("tech500"), window.__t500); setTemplateInfo(templateById("retail-leadership-summit"), window.__retail);');
  var rows = p.ce('designRows("tech500", capsOf("tech500"))');
  check('UX-050 the gallery list is every section of the design, in its order, under its own names (pinned ones too)',
    rows.length === 11 && rows[0].title === 'Banner' && rows[4].title === 'Summit spotlight' && rows[10].title === 'About ETCIO',
    rows.map(function (r) { return r.title; }));
  check('UX-050 …"Summit spotlight" is the Key numbers form, "Beyond sponsorship" the Closing call to action form (TPL-046)',
    rows[4].kind === 'Key numbers' && rows[4].fillable && rows[7].fillable && rows[7].kind === 'Closing call to action' && rows[7].title === 'Beyond sponsorship', [rows[4], rows[7]]);
  check('UX-050 on an ETRetail event "About ETCIO" (ETCIO\'s own text) starts switched off, and can be switched',
    rows[10].foreignAbout === true && rows[10].on === false && rows[10].locked === false, rows[10]);
  check('UX-050 …so the count is 10 of 11', p.ce('designCountText(designCount("tech500", capsOf("tech500")))') === '10 of 11 sections on your site');
  p.ce('setSectionExcluded("tech500", "about-us", false)');
  check('UX-050 switched on, it stays on (the choice is kept, not the default)', p.ce('excludedOn("tech500")["about-us"]') === false &&
    p.ce('designCount("tech500", capsOf("tech500")).on') === 11);
  p.ce('setSectionExcluded("tech500", "about-us", true); setSectionExcluded("tech500", "summit-spotlight", true)');
  check('UX-050 switching a section off lowers the count everywhere it is read', p.ce('designCountText(designCount("tech500", capsOf("tech500")))') === '9 of 11 sections on your site');
  p.ce('S.excludedSections = {}; S.basics.portal = "cio"');
  rows = p.ce('designRows("tech500", capsOf("tech500"))');
  check('UX-050 on an ETCIO event "About ETCIO" is the event\'s own: always on, with no switch', rows[10].foreignAbout === false && rows[10].locked && rows[10].on);
  p.ce('S.basics.portal = "retail"');
  check('UX-050 retail-leadership-summit\'s "About ETRetail" on an ETRetail event is its own', p.ce('foreignAboutId("retail-leadership-summit")') === '' &&
    p.ce('foreignAboutId("tech500")') === 'about-us');

  /* the gallery's switches: the same rows and count */
  var glog = {};
  p.ctx.RevampCanvas = { mount: function () { return Promise.resolve(fakeCanvas(TECH500, glog)); } };
  p.ce('S.step = 1; S.step1Phase = "method"; S.template = null; tplCarouselIdx = 0; renderTemplateCarousel();');
  await tick();
  var gal = p.$('tpl-carousel-sections').innerHTML;
  check('UX-050 the gallery shows the 11 sections with the count beside its heading', (gal.match(/tpl-preview-row/g) || []).length === 11 &&
    p.$('tpl-carousel-sec-count').textContent === '· 10 of 11 sections on your site', [p.$('tpl-carousel-sec-count').textContent, (gal.match(/tpl-preview-row/g) || []).length]);
  check('UX-050 …Banner and Contact us have switches, the about of the event\'s own portal would say "Always on"', /data-pv-toggle="banner"/.test(gal) && /data-pv-toggle="contact-us"/.test(gal) && /data-pv-toggle="about-us"/.test(gal));
  p.ce('S.basics.portal = "cio"; renderTemplateCarousel();');
  await tick();
  check('UX-050 …and on an ETCIO event it does', /About ETCIO<\/span><span class="tpl-preview-fixed">Always on/.test(p.$('tpl-carousel-sections').innerHTML));
  p.ce('S.basics.portal = "retail"');

  /* "Use this template": the toast says the same count */
  p.ce('useTemplate("tech500")');
  await tick();
  var toastMsg = (p.log.toasts[p.log.toasts.length - 1] || {}).msg;
  check('UX-050 the toast after "Use this template" says the gallery\'s count', toastMsg === 'TECH500 selected — 10 of 11 sections on your site', toastMsg);

  /* the details form's list */
  p.ce('S.creationMethod = "template"; S.step1Phase = "details"; renderBuildWorkspace($("step1-build-host"));');
  var list = p.$('sec-list').innerHTML;
  var titles = (list.match(/<span class="nm">[^<]*/g) || []).map(function (m) { return m.replace('<span class="nm">', ''); });
  check('UX-050 the form lists the same 11 sections under the same names, in the page\'s order',
    JSON.stringify(titles) === JSON.stringify(TECH500.sections.map(function (s) { return s.name; })), titles);
  check('UX-050 …numbers only the 10 rows with a form here', JSON.stringify((list.match(/<span class="idx">(\d+)</g) || []).map(function (m) { return +m.replace(/\D/g, ''); })) === '[1,2,3,4,5,6,7,8,9,10]');
  check('UX-050 …a row whose design name is not the form\'s says which form it is ("Summit spotlight" · Key numbers)',
    /Summit spotlight<small class="sub">Key numbers<\/small>/.test(list) && /What is Tech500<small class="sub">Overview<\/small>/.test(list), list.slice(0, 300));
  check('UX-050 …and says nothing where both names are the same ("Banner" / Top banner, "Frequently asked questions" / FAQs)',
    /<span class="nm">Banner<\/span>/.test(list) && /<span class="nm">Frequently asked questions<\/span>/.test(list));
  check('UX-050 …"Beyond sponsorship" sits in its place with its form (TPL-046); no separate "Also on this design" group',
    /Beyond sponsorship<small class="sub">Closing call to action/.test(list) && list.indexOf('Also on this design') === -1, list);
  check('UX-050 …ETCIO\'s About says why it is off, with its switch', /About ETCIO<small class="sub">ETCIO’s own text, so it starts off for ETRetail\./.test(list) &&
    /data-sec-toggle="about-us" aria-pressed="false"/.test(list), list.slice(-700));
  check('UX-050 …and the form says the gallery\'s count', /<span class="sec-count" id="sec-count">10 of 11 sections on your site<\/span>/.test(p.$('step1-build-host').innerHTML) &&
    /0\/10 filled/.test(p.$('step1-build-host').innerHTML));
  var spot = p.ce('sectionByLib("stats")');
  check('UX-050 the section\'s own heading is the design\'s name too', p.ce('secTitle(sectionByLib("stats"))') === 'Summit spotlight' && p.ce('secKind(sectionByLib("stats"))') === 'Key numbers' && !!spot);
  var pay = p.ce('buildEditorPayload()');
  check('UX-050 the hand-off hides another portal\'s About on the site', pay.excludedSections.indexOf('about-us') !== -1, pay.excludedSections);

  /* A draft resumed on another computer (the dashboard's Drafts > Resume) draws its section list before ET's roster
     has answered: the About row's line never shows a portal's code, and the list is drawn again with the roster's
     names when it comes. nameOf answers '' before the roster, as portal-picker.js does. */
  var r = F.load();
  r.ctx.RevampPortals.nameOf = function () { return ''; };
  r.ctx.__t500 = TECH500;
  r.ce('S.basics.portal = "retail"; S.basics.category = "IP"; setTemplateInfo(templateById("tech500"), window.__t500); commitTemplate("tech500");');
  await tick();
  r.ce('S.creationMethod = "template"; S.step = 1; S.step1Phase = "details"; renderBuildWorkspace($("step1-build-host"));');
  var early = r.$('sec-list').innerHTML;
  check('UX-050 before the roster has come, the About row names ETCIO from its own heading and this event, never a code',
    /About ETCIO<small class="sub">ETCIO’s own text, so it starts off for this event\. Switch it on/.test(early) &&
    !/cio’s|for retail/.test(early), early.slice(-700));
  check('UX-050 …the gallery card\'s sentence too', r.ce('aboutPortalNote("tech500")') ===
    'Its “About ETCIO” section is ETCIO’s own text, so it starts switched off for this event. Switch it on to rewrite it in the site editor.' &&
    r.ce('aboutPortalNote("cx-leaders-forum")').indexOf('ETBrandEquity.com’s own text') !== -1);
  await r.ce('loadPortalRoster()');
  r.ce('portalArrived()');
  var late = r.$('sec-list').innerHTML;
  check('UX-050 …and once the roster comes the list is drawn again with its names, nothing else picked',
    /About ETCIO<small class="sub">ETCIO’s own text, so it starts off for ETRetail\./.test(late) && late.indexOf('this event') === -1, late.slice(-700));
  /* a switch pressed with the keyboard keeps the focus when the list is drawn again */
  var host = r.$('sec-list'), asked = '', focused = 0;
  host.contains = function () { return true; };
  host.querySelector = function (sel) { asked = sel; return { focus: function () { focused++; } }; };
  r.doc.activeElement = { getAttribute: function (k) { return k === 'data-sec-toggle' ? 'about-us' : null; } };
  r.ce('renderSecList()');
  check('UX-050 …a switch that had the focus gets it back after the list is drawn again', asked === '[data-sec-toggle="about-us"]' && focused === 1, asked);
  r.doc.activeElement = null;

  /* =====================================================================================================
     UX-051 phones
     ===================================================================================================== */
  var scrolled = 0;
  p.$('editor-panel').scrollIntoView = function () { scrolled++; };
  phone(p, false);
  p.ce('pickSection(sectionByLib("contact").id)');
  check('UX-051 on a wide screen picking a section leaves the page where it is', scrolled === 0 && p.ce('activeSection().libId') === 'contact');
  phone(p, true);
  p.$('editor-panel').scrollIntoView = function () { scrolled++; };
  p.ce('pickSection(sectionByLib("faq").id)');
  check('UX-051 where the form sits under the list, picking a section goes to its form', scrolled === 1 && p.ce('activeSection().libId') === 'faq');
  var qlog = {}, qc = fakeCanvas(TECH500, qlog);
  p.ctx.__qc = qc;
  p.ce('quietCanvas(null, window.__qc, "x")');
  check('UX-051 on a phone a wizard canvas shows the site at a phone\'s width', JSON.stringify(qlog.devices) === '["mobile"]');
  phone(p, false);
  p.ce('quietCanvas(null, window.__qc, "x")');
  check('UX-051 …and at a desktop\'s on a wide screen', qlog.devices[1] === 'desktop');
  check('UX-055 the editor\'s outlines are not drawn on a wizard canvas (one style, added once)', qc.styles.length === 1 &&
    /\[data-editable\]:hover[^{]*\{ outline: none !important; \}/.test(qc.styles[0].textContent.replace(/,\s+html/g, ', html')), qc.styles.map(function (s) { return s.textContent; }));
  p.ce('previewTarget = function(){ return templateById("tech500"); }; setPreviewVisible(true);');
  check('UX-051 Preview has a button in the header row as well (the one a phone shows)', p.$('btn-rail-preview').hidden === false && p.$('btn-expand-preview').hidden === false);
  p.ce('setPreviewVisible(false)');
  check('UX-051 …gone with the other where there is nothing to preview', p.$('btn-rail-preview').hidden === true && p.$('btn-expand-preview').hidden === true);
  var css = page.slice(0, page.indexOf('</head>'));
  check('UX-051 the phone CSS: one-row footer, no Preview bar, edition button short, AI looks full width',
    /\.wiz-foot\{ padding: 8px 14px; gap: 10px; flex-wrap: nowrap; \}/.test(css) && /\.live-preview-expand:not\(\[hidden\]\)\{ display: none; \}/.test(css) &&
    /\.rail-tools \.nm-short\{ display: inline; \}/.test(css) && /\.live-preview-body\.reviewing \.ai-review\{ flex: 1 1 auto; width: auto;/.test(css) &&
    css.indexOf('.wiz-foot #btn-next{ order: 4; flex: 1 1 100%') === -1);
  check('UX-051 the AI review no longer points at "the panel on the left"', page.indexOf('the panel on the left') === -1 && page.indexOf('id="btn-ai-site"') !== -1);

  /* =====================================================================================================
     UX-052 no footer Continue on the method screen
     ===================================================================================================== */
  var m = F.load();
  await m.ce('loadPortalRoster()');
  m.ctx.__t500 = TECH500;
  m.ce('S.basics.portal = "retail"; S.basics.category = "IP"; setTemplateInfo(templateById("tech500"), window.__t500); S.step = 1; S.step1Phase = "method"; S.template = null; renderFoot();');
  check('UX-052 the method screen has Back and no Continue', m.$('btn-next').hidden === true && m.$('btn-back').hidden === false);
  m.ce('onNext()');
  await tick();
  check('UX-052 Enter or a stray call to Continue chooses no design', m.ce('S.template') === null && m.log.toasts.length === 0 && m.log.phases.length === 0);

  /* =====================================================================================================
     UX-057 one way out of a busy screen
     ===================================================================================================== */
  m.ce('busy = { kind: "brief", note: "Generating your site — keep this tab open." }; renderFoot();');
  check('UX-057 a busy screen keeps its own Cancel; the footer has none beside it', m.$('btn-back').hidden === true && m.$('btn-next').hidden === true &&
    m.$('foot-note').textContent === 'Generating your site — keep this tab open.');
  m.ce('busy = null; S.step1Phase = "details"; S.creationMethod = "template"; renderFoot();');
  check('UX-057 …and the footer\'s Back is back once nothing is running', m.$('btn-back').hidden === false && /<span class="lbl"> Back<\/span>/.test(m.$('btn-back').innerHTML));
  check('UX-057 each busy view has its own way out', ['id="btn-import-cancel"', 'id="btn-ai-request-cancel"', 'data-brief-cancel', 'id="asm-cancel"', 'id="btn-ai-cancel"', 'data-busy-back'].every(function (s) { return page.indexOf(s) !== -1; }));
  check('UX-057 "Reading <file>…" is held and closed when reading ends', /var doneReading = toast\('Reading ' \+ file\.name \+ '…', \{ sticky: true \}\);\s*readPsdFile\(file, function\(err, banner, picture\)\{\s*doneReading\(\);/.test(page));

  /* =====================================================================================================
     UX-053 plain words
     ===================================================================================================== */
  ['URL slug', 'Assemble', 'Primary CTA', 'Secondary CTA', 'Drives the entry CTA', 'Select Previous edition', 'Basic details', 'Hero / Top banner',
    'Stats strip', 'Continue with a template', 'Add a description, a document or a link'].forEach(function (w) {
    check('UX-053 "' + w + '" is gone from Create Event', page.indexOf(w) === -1);
  });
  check('UX-053 "Stats strip" is "Key numbers" in the templates too', ['retail-leadership-summit', 'cx-leaders-forum', 'making-ai-work'].every(function (t) {
    var j = JSON.parse(F.read('templates/' + t + '/template.json'));
    return j.sections.some(function (s) { return s.name === 'Key numbers'; }) && !j.sections.some(function (s) { return s.name === 'Stats strip'; });
  }));
  check('UX-053 the rail: Event details, Open in editor', JSON.stringify(m.ce('STEPS')) === '["Event details","Open in editor"]');
  check('UX-053 the form: Event details, Web address, Previous edition', /<span class="ttl">Event details<\/span>/.test(page) && />Web address <span class="pill-req">/.test(page) && /id="gb-et-label">Previous edition</.test(page));
  check('UX-053 the banner\'s text mode: Main button / Second button', page.indexOf('>Main button</label>') !== -1 && page.indexOf('>Second button</label>') !== -1);
  check('UX-053 counters say industries and categories', m.ce('nounPlural("industry")') === 'industries' && m.ce('nounPlural("category")') === 'categories' &&
    m.ce('nounPlural("point")') === 'points' && m.ce('nounPlural("day")') === 'days');
  check('UX-053 the kinds: Top banner, Key numbers', m.ce('libBy("hero").name') === 'Top banner' && m.ce('libBy("stats").name') === 'Key numbers');
  check('UX-053 only the method screen says "How would you like to build it?"; busy screens say what they do',
    (page.match(/How would you like to build it\?/g) || []).length === 1 && /'Opening' : 'Generating'/.test(page) && page.indexOf('<span class="eyebrow">Importing</span>') !== -1 &&
    page.indexOf('<span class="eyebrow">Redesign with AI</span>') !== -1);
  check('UX-053 the address is asked for in plain words', m.ce('S.basics.slug = ""; slugIssue()') === 'Enter the web address — the last part of the event’s address, after /e/.', m.ce('slugIssue()'));
  m.ce('S.creationMethod = "brief"; S.brief.text = BRIEF_TEMPLATE; S.brief.previous = ""; S.brief.current = ""; S.brief.comp1 = ""; S.brief.comp2 = ""; briefDoc = null;');
  var bi = m.ce('validateBrief()');
  check('UX-053 the brief\'s error says the headings need words under them', bi.length === 1 &&
    bi[0].message === 'Write something under at least one heading, or add a PDF or a link, so the site is built from real information.', bi);

  /* =====================================================================================================
     UX-054 a review before the paid run
     ===================================================================================================== */
  var gens = [];
  m.ce('S.step = 1; S.step1Phase = "details"; S.creationMethod = "brief"; S.basics.name = "Brand X Summit"; S.basics.slug = "brand-x-2027"; S.createdEventId = null; S.generatedEventId = null;' +
    'S.brief.text = BRIEF_TEMPLATE.replace("Audience: ", "Audience: CMOs").replace("Industry: ", "Industry: FMCG").replace("Must avoid: ", "Must avoid: stock crowds");' +
    'S.brief.comp1 = "https://example.com/rival"; S.brief.etEvent = null; S.brief.previous = "";' +
    'detailsIssues = function(){ return []; }; templateIssue = function(){ return ""; }; contentProblems = function(){ return []; };' +
    'startGenerateFromBrief = function(r){ window.__gens.push(r); };');
  m.ctx.__gens = gens;
  m.ce('onNext()');
  var md = m.log.modals[m.log.modals.length - 1] || {};
  check('UX-054 "Generate my site" opens a review first, and starts nothing', md.title === 'Generate your site?' && gens.length === 0 && md.confirm === 'Generate my site' && md.cancelLabel === 'Go back', md.title);
  check('UX-054 …it says how much of the description is written, the document, the competitors and the address it creates',
    /Your description: 3 of 9 points written\./.test(md.body) && /No document\./.test(md.body) && /1 competitor event to compare against\./.test(md.body) &&
    /Creates the event at [^<]*\/e\/brand-x-2027\./.test(md.body) && /Site type: Standard/.test(md.body), md.body);
  check('UX-054 …warns when no previous edition is given, and says the time and the cost', /No previous edition is given, so the site is not modelled on last year’s\./.test(md.body) &&
    /It takes 3 to 5 minutes and uses paid AI time\./.test(md.body), md.body);
  md.onConfirm();
  check('UX-054 Generate starts the run', gens.length === 1 && gens[0] === false);
  m.ce('S.brief.etEvent = { title: "Brand X Summit 2026", link: "https://brandx.example.com/2026" }; S.brief.previous = "https://brandx.example.com/2026"; S.createdEventId = "brand-x-2027"; S.generatedEventId = "brand-x-2027";');
  m.ce('onNext()');
  md = m.log.modals[m.log.modals.length - 1];
  check('UX-054 a second run is the same review, saying it replaces the site generated before and updates the event',
    md.title === 'Generate the site again?' && md.confirm === 'Replace and generate' && /Previous edition: Brand X Summit 2026 — the site is modelled on it/.test(md.body) &&
    /Updates the event at/.test(md.body) && /Replaces the site generated earlier for this event\./.test(md.body) && md.body.indexOf('No previous edition') === -1, md.body);
  md.onConfirm();
  check('UX-054 …and Replace starts the run that replaces it', gens.length === 2 && gens[1] === true);

  /* =====================================================================================================
     UX-055 the wheel scrolls the page past the gallery's picture
     ===================================================================================================== */
  var g = F.load();
  g.ce('wireCarouselShield(); setCarouselShield(true);');
  check('UX-055 the picture starts behind its shield', g.$('tpl-carousel-shield').hidden === false && !g.$('tpl-carousel-media').classList.contains('scrolling'));
  g.fire(g.$('tpl-carousel-shield'), 'click');
  check('UX-055 a click lets the wheel scroll the preview', g.$('tpl-carousel-shield').hidden === true && g.$('tpl-carousel-media').classList.contains('scrolling'));
  g.fire(g.$('tpl-carousel-media'), 'mouseleave');
  check('UX-055 leaving it gives the wheel back to the page', g.$('tpl-carousel-shield').hidden === false);
  g.fire(g.$('tpl-carousel-shield'), 'click');
  g.docFire('pointerdown', g.$('btn-back'));
  check('UX-055 …and so does a press anywhere else', g.$('tpl-carousel-shield').hidden === false);
  check('UX-055 the design\'s name and "Use this template" sit above the picture', page.indexOf('id="tpl-carousel-use"') < page.indexOf('id="tpl-carousel-media"') &&
    page.indexOf('id="tpl-carousel-name"') < page.indexOf('id="tpl-carousel-media"'));

  /* =====================================================================================================
     UX-056 over the length
     ===================================================================================================== */
  check('UX-056 the counter says how far over', p.ce('countText(1151, 900, "characters")') === '1151 / 900 characters · 251 over' && p.ce('countText(80, 140)') === '80 / 140');
  p.ce('var _a = sectionByLib("about"); _a.data = _a.data || {}; _a.data.body = new Array(1152).join("x");');
  var probs = p.ce('fieldProblems(sectionByLib("about"))').filter(function (x) { return x.sel === '#e-body'; });
  check('UX-056 an Overview over 900 says the site shows all of it, longer than the design (shown as it is typed)', probs.length === 1 && probs[0].kind === 'warn' && probs[0].live === true &&
    probs[0].message === 'Longer than this section is made for (900 characters). The site shows all of it, so the section runs longer than the design: shorten it to keep the layout.', probs);
  p.ce('var _w = sectionByLib("whyjoin"); _w.data = _w.data || {}; _w.data.items = [{ t: "Meet buyers", d: new Array(151).join("y") }, { t: "Short", d: "ok" }];');
  var wprobs = p.ce('fieldProblems(sectionByLib("whyjoin"))').filter(function (x) { return /data-rep="d"/.test(x.sel); });
  check('UX-056 a card paragraph over 140 says the same, under its own counter', wprobs.length === 1 && wprobs[0].sel === '[data-rep="d"][data-i="0"]' && wprobs[0].after === '[data-len="0"]' &&
    /^Longer than these cards are made for \(140 characters\)\. The site shows all of it/.test(wprobs[0].message), wprobs);
  var found = p.ce('contentProblems()').filter(function (x) { return x.kind === 'warn' && /Longer than/.test(x.message); });
  check('UX-056 both are in the "things to check" list with the same words', found.length === 2, found.map(function (x) { return x.message; }));

  /* =====================================================================================================
     UX-058 Awards and Custom Events
     ===================================================================================================== */
  var a = F.load();
  await a.ce('loadPortalRoster()');
  a.ctx.__t500 = TECH500;
  a.ctx.RevampCanvas = { mount: function () { return Promise.resolve(fakeCanvas(TECH500, {})); } };
  a.ce('S.basics.portal = "retail"; S.basics.category = "Awards"; S.template = null; S.step = 1; S.step1Phase = "method"; setTemplateInfo(templateById("tech500"), window.__t500); renderTemplateCarousel();');
  check('UX-058 for Awards the brief card says it builds an award site', a.$('dc-fit').hidden === false && /award site: the Nominate button, the award categories, the jury/.test(a.$('dc-fit').textContent));
  check('UX-058 …and the conference designs wait behind "Use a conference design anyway"', a.$('tpl-gallery-wrap').hidden === true && a.$('tpl-anyway').hidden === false &&
    a.$('tpl-carousel').hidden === true);
  check('UX-058 …with no Preview of a design nobody is looking at', a.ce('previewTarget()') === null);
  a.$('tpl-anyway').onclick();
  await tick();
  check('UX-058 …which opens them', a.$('tpl-gallery-wrap').hidden === false && a.$('tpl-anyway').hidden === true && a.$('tpl-carousel').hidden === false &&
    a.$('tpl-carousel-catnote').hidden === false && a.ce('previewTarget().id') === 'tech500' && a.$('btn-rail-preview').hidden === false);
  a.ce('galleryAnyway = false; S.basics.category = "Client"; renderTemplateCarousel();');
  check('UX-058 Client Events the same, in its own words', a.$('tpl-gallery-wrap').hidden === true && /client event it builds the sections this event needs/.test(a.$('dc-fit').textContent));
  a.ce('S.template = "tech500"; renderTemplateCarousel();');
  check('UX-058 a draft that already has a gallery design sees the gallery as before', a.$('tpl-gallery-wrap').hidden === false);
  a.ce('S.template = null; S.basics.category = "IP"; renderTemplateCarousel();');
  check('UX-058 an IP event is offered the designs made for it, with nothing folded', a.$('tpl-gallery-wrap').hidden === false && a.$('dc-fit').hidden === true && a.$('tpl-anyway').hidden === true);

  console.log('create-event-screens: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}
main().catch(function (e) { console.error(e); process.exit(1); });
