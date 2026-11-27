// node functions/lib/books-export.test.js — Books Phase 4, the export's gate (books-app/src/engines/exportGate.ts) and
// what the pre-export check gives it (books-app/src/engines/preflightEngine.ts), bundled in memory with the editor's
// esbuild. It checks: a print-ready PDF is stopped by every error of the check and waits for one tick when there are
// warnings (a tick covers only the warnings it was given); a review PDF, the images and the backup are never stopped;
// a template's empty photo frames ("Portrait — drop a photo here") are missing photos, said plainly ("Add the photo or
// delete the frame"); the check's errors and warnings (photos, fonts, fit, page sizes, page count for the binding,
// bleed, safe margin, template words); the page range; the file names; the progress line and the summary after a PDF.
// No network, no database, no AI. Exits 1 on any failure.
'use strict';
var path = require('path'), Module = require('module');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 900) : '') + '\n'); }
var ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'books-app');
var esbuild = require(path.join(APP, 'node_modules', 'esbuild'));

function load(rel) {
  var file = path.join(APP, 'src', rel);
  var out = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node18', jsx: 'automatic',
    logLevel: 'silent', external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react', 'pdf-lib', 'jszip'] });
  var m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(out.outputFiles[0].text, file);
  return m.exports;
}
var G = load('engines/exportGate.ts');

function issue(id, severity, category, extra) {
  return Object.assign({ id: id, severity: severity, category: category, title: id, detail: '', suggestion: '' }, extra || {});
}
var E1 = issue('e1', 'error', 'missing_image', { pageId: 'p1', pageNumber: 1 }), E2 = issue('e2', 'error', 'text_overflow'), E3 = issue('e3', 'error', 'binding');
var W1 = issue('w1', 'warning', 'low_resolution'), W2 = issue('w2', 'warning', 'safe_area'), I1 = issue('i1', 'info', 'design_consistency');

/* ---------- 1 the gate ---------- */
(function () {
  var g = G.exportGate([E1, E2, E3, W1, I1], 'print', true);
  check('1.1 errors stop a print-ready PDF, even with the warnings ticked; the button says what to fix', g.blocked && !g.canExport && g.buttonLabel === 'Fix 3 problems to export' &&
    g.errors.length === 3 && /Go to/.test(g.note), g);
  check('1.2 …one problem, in the singular', G.exportGate([E1], 'print', false).buttonLabel === 'Fix 1 problem to export');
  var w = G.exportGate([W1, W2, I1], 'print', false);
  check('1.3 warnings alone wait for the tick, and the button says so', !w.blocked && w.needsTick && !w.canExport && w.buttonLabel === 'Check the warnings to export' &&
    w.note.indexOf(G.TICK_LABEL) !== -1 && /2 warnings/.test(w.note), w);
  var t = G.exportGate([W1, W2, I1], 'print', true);
  check('1.4 …and once ticked the print-ready PDF may start', t.canExport && !t.needsTick && t.buttonLabel === 'Export print-ready PDF' && t.note === '', t);
  check('1.5 nothing to fix: no tick needed; notes (info) never stop anything', G.exportGate([], 'print', false).canExport && G.exportGate([I1], 'print', false).canExport);
  check('1.6 the tick is "I\'ve checked these warnings"', G.TICK_LABEL === "I've checked these warnings");
  var r = G.exportGate([E1, E2, E3, W1], 'review', false);
  check('1.7 a review PDF is never stopped: errors are only a note there', r.canExport && !r.blocked && !r.needsTick && r.buttonLabel === 'Export review PDF' &&
    /3 problems would stop a print-ready PDF/.test(r.note) && /review PDF shows the pages as they are now/.test(r.note), r);
  var im = G.exportGate([E1, W1], 'images', false), bk = G.exportGate([E1, W1], 'backup', false);
  check('1.8 …nor are the images (with the note) or the backup (no note: it is the book, not a print)', im.canExport && /1 problem would stop/.test(im.note) && bk.canExport && bk.note === '' &&
    bk.buttonLabel === 'Download backup (.bookstudio.zip)', { im: im, bk: bk });
  check('1.9 a review with nothing wrong has no note', G.exportGate([W1], 'review', false).note === '');
  var s1 = G.warningsSignature([W1, W2, E1, I1]), s2 = G.warningsSignature([I1, W2, E2, W1]), s3 = G.warningsSignature([W1, W2, issue('w3', 'warning', 'bleed')]);
  check('1.10 a tick covers the warnings it was given: the same warnings in any order (errors and notes aside) keep it; a new warning asks again',
    s1 === s2 && s1 !== s3 && G.warningsSignature([E1, I1]) === '', [s1, s2, s3]);
})();

/* ---------- 2 a template's empty photo frames are missing photos ---------- */
(function () {
  var portrait = { type: 'image', name: 'Portrait — drop a photo here', hidden: false, image: { src: '' } };
  var drawing = { type: 'image', name: 'Drawing — drop a plan or section here', hidden: false, image: { src: '' } };
  var plain = { type: 'image', name: 'Photo 3', hidden: false, image: { src: '' } };
  var filled = { type: 'image', name: 'Portrait — drop a photo here', hidden: false, image: { src: '/books/samples/a.jpg' } };
  var hidden = { type: 'image', name: 'Portrait — drop a photo here', hidden: true, image: { src: '' } };
  check('2.1 "Portrait — drop a photo here" and "Drawing — drop a plan…" frames are placeholders and missing photos',
    G.isPlaceholderPhotoFrame(portrait) && G.isPlaceholderPhotoFrame(drawing) && G.isMissingPhoto(portrait) && G.isMissingPhoto(drawing));
  check('2.2 a frame with its photo dropped in is not (its name stays as the template named it); a hidden frame does not print, so is not missing',
    !G.isMissingPhoto(filled) && !G.isPlaceholderPhotoFrame(filled) && !G.isMissingPhoto(hidden));
  check('2.3 any other frame with no photo is missing too', G.isMissingPhoto(plain) && !G.isPlaceholderPhotoFrame(plain) && !G.isMissingPhoto({ type: 'text', name: 'x' }));
  var tp = G.missingPhotoText(portrait, 8), td = G.missingPhotoText(drawing, 13), tx = G.missingPhotoText(plain, 3);
  check('2.4 said plainly: "Add the photo or delete the frame", naming the template\'s frame for what it waits for',
    tp.title === 'Empty portrait frame on page 8' && td.title === 'Empty drawing frame on page 13' && tx.title === 'Missing photo on page 3' &&
    [tp, td, tx].every(function (t) { return t.suggestion === 'Add the photo or delete the frame.' && /print empty/.test(t.detail); }), [tp, td, tx]);
  var T = load('data/premiumTemplates.ts');
  var frames = [];
  T.PREMIUM_BOOK_TEMPLATES.forEach(function (tpl) { tpl.buildPages().forEach(function (p) { p.elements.forEach(function (e) { if (e.name === T.PORTRAIT_FRAME_NAME || e.name === T.DRAWING_FRAME_NAME) frames.push(e); }); }); });
  check('2.5 every portrait and drawing frame of the five premium templates is a missing photo (their names are matched as the templates write them)',
    frames.length > 10 && frames.every(function (e) { return e.type !== 'image' || (G.isPlaceholderPhotoFrame(e) && G.isMissingPhoto(e)); }), frames.length);
})();

/* ---------- 3 what the check gives the gate ---------- */
(function () {
  var F = load('engines/preflightEngine.ts');
  var P = load('engines/pourEngine.ts');
  var style = { fontFamily: 'Lora', fontSizePt: 10, fontWeight: 400, color: '#1C1917', lineHeight: 1.4, letterSpacingEm: 0, textAlign: 'left', verticalAlign: 'top',
    paragraphSpacingMm: 0, columns: 1, columnGapMm: 5, insetMm: 0 };
  function text(id, x, y, w, h, words, extra) {
    return Object.assign({ id: id, name: id, type: 'text', xMm: x, yMm: y, widthMm: w, heightMm: h, rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 2,
      textRole: 'body', text: words, textStyle: style }, extra || {});
  }
  function img(id, x, y, w, h, src, nw, nh, extra) {
    return Object.assign({ id: id, name: id, type: 'image', xMm: x, yMm: y, widthMm: w, heightMm: h, rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 1,
      image: { src: src, alt: '', fit: 'cover', zoom: 1, focalX: 50, focalY: 50, naturalWidth: nw, naturalHeight: nh } }, extra || {});
  }
  var dims = { widthMm: 200, heightMm: 250, orientation: 'portrait', rotation: 0, margins: { top: 15, bottom: 15, inner: 15, outer: 15 }, gutterMm: 0, bleedMm: 3, safeAreaMm: 8,
    columns: 1, columnGapMm: 5, baselineGridMm: 4, spreadMode: 'facing' };
  var long = []; for (var i = 0; i < 400; i++) long.push('word' + i);
  function book(pages, binding) {
    return { id: 'b', name: 'Check', subtitle: '', category: '', status: 'draft', unit: 'mm', coverThumbnail: '', dimensions: dims,
      designSystem: { name: 'DS', approved: true, sourceTemplateName: 'T', colors: { paper: '#FFFFFF', surface: '#F4F1EA', ink: '#1C1917', mutedInk: '#666666', primaryAccent: '#C6A26B', secondaryAccent: '#333333', palette: [] },
        typography: { primaryFont: 'Lora', secondaryFont: 'Lora', displayFont: 'Lora', headingFont: 'Lora', bodyFont: 'Lora', captionFont: 'Lora', quoteFont: 'Lora', numericalFont: 'Lora',
          scale: {}, minApprovedBodyPt: 8 } },
      masterPages: [], chapters: [], contentSections: [], imageAssets: [], customDimensionPresets: [],
      printSettings: { bindingType: binding || 'perfect', paperStockName: '', paperCaliperMm: 0.1, coverBoardCaliperMm: 0, printerToleranceMm: 0, includeBleed: true, includeCropMarks: true,
        includeRegistrationMarks: false, colorSpace: 'RGB', targetDpi: 300, exportSpreads: false },
      pages: pages.map(function (els, i) { return { id: 'pg' + (i + 1), orderIndex: i, label: 'Page ' + (i + 1), role: 'editorial_text', backgroundColor: '#FFFFFF', elements: els }; }),
      createdAt: '1', updatedAt: '1' };
  }
  var b = book([
    [img('portrait', 20, 20, 60, 80, '', 0, 0, { name: 'Portrait — drop a photo here' }), text('fine', 20, 120, 150, 60, 'A few words that fit.')],
    [text('over', 20, 20, 150, 5, long.join(' ')), text('nofont', 20, 60, 150, 30, 'Words with no font', { textStyle: Object.assign({}, style, { fontFamily: '' }) })],
    [img('soft', 20, 20, 160, 120, '/p/s.jpg', 600, 450), img('low', 20, 150, 100, 70, '/p/l.jpg', 800, 560), img('edge', 0, 0, 100, 100, '/p/e.jpg', 4000, 4000)],
    [text('safe', 2, 20, 100, 30, 'Close to the edge'), img('away', 300, 20, 40, 40, '/p/a.jpg', 4000, 4000), text('sample', 20, 120, 150, 40, 'Winner name')],
    [],
  ]);
  b.pages[4].dimensionsOverride = Object.assign({}, dims, { widthMm: 400 });
  var ph = new Set(['winner name']);
  var issues = F.runPreflightCheck(b, { placeholders: ph });
  function find(id) { return issues.filter(function (i) { return i.id.indexOf(id) === 0; }); }
  function sev(id) { var f = find(id); return f.length ? f[0].severity : null; }
  check('3.1 a template\'s empty portrait frame is an error, said plainly, with its page and frame to go to',
    sev('pf_img_missing_pg1_portrait') === 'error' && find('pf_img_missing_pg1_portrait')[0].suggestion === 'Add the photo or delete the frame.' &&
    find('pf_img_missing_pg1_portrait')[0].pageId === 'pg1' && find('pf_img_missing_pg1_portrait')[0].elementId === 'portrait', find('pf_img_missing'));
  check('3.2 text that doesn\'t fit (measured) and a frame with words but no font are errors', sev('pf_overflow_pg2_over') === 'error' && sev('pf_font_none_pg2_nofont') === 'error' &&
    find('pf_overflow_pg2_fine').length === 0);
  check('3.3 an odd page count is a warning for any binding (5 pages): the printer adds a blank, a designer may mean it', sev('pf_binding_odd') === 'warning' && /even number of pages/.test(find('pf_binding_odd')[0].detail));
  check('3.4 photos under 250 ppi as placed are warnings ("too low" under 150, "low" to 249); a sharp one is not',
    sev('pf_dpi_err_pg3_soft') === 'warning' && sev('pf_dpi_low_pg3_low') === 'warning' && find('pf_dpi_err_pg3_edge').length + find('pf_dpi_low_pg3_edge').length === 0,
    find('pf_dpi'));
  check('3.5 a photo stopping at the trim instead of running into the bleed is a warning, with the edges named', sev('pf_bleed_pg3_edge') === 'warning' &&
    /left, top edge/.test(find('pf_bleed_pg3_edge')[0].detail), find('pf_bleed'));
  check('3.6 text in the safe margin, a frame off the page and its bleed, and template words are warnings',
    sev('pf_safe_pg4_safe') === 'warning' && sev('pf_offpage_pg4_away') === 'warning' && sev('pf_sample_pg4_sample') === 'warning' && find('pf_sample_pg1_fine').length === 0,
    issues.filter(function (i) { return i.pageId === 'pg4'; }).map(function (i) { return i.id; }));
  check('3.7 a page of another size than the book is a warning (mixed sizes)', sev('pf_mixed_pg5') === 'warning' && /400 × 250 mm/.test(find('pf_mixed_pg5')[0].detail));
  var g = G.exportGate(issues, 'print', true), r = G.exportGate(issues, 'review', false);
  check('3.8 …so the print-ready PDF is stopped by them and the review PDF is not', g.blocked && !g.canExport && /^Fix \d+ problems to export$/.test(g.buttonLabel) && r.canExport, g.buttonLabel);

  var tiny = book([[], []]);
  tiny.dimensions = Object.assign({}, dims, { widthMm: 10 });
  var huge = book([[], []]);
  huge.pages[1].dimensionsOverride = Object.assign({}, dims, { widthMm: 5200 });
  var nan = book([[], []]);
  nan.pages[0].dimensionsOverride = Object.assign({}, dims, { heightMm: NaN });
  check('3.9 page sizes a PDF can\'t hold are errors: under 20 mm, larger than a PDF page, not a size',
    F.runPreflightCheck(tiny).some(function (i) { return i.id === 'pf_size_book' && i.severity === 'error'; }) &&
    F.runPreflightCheck(huge).some(function (i) { return i.id === 'pf_size_pg2' && i.severity === 'error'; }) &&
    F.runPreflightCheck(nan).some(function (i) { return i.id === 'pf_size_pg1' && i.severity === 'error'; }) &&
    !F.runPreflightCheck(book([[], []])).some(function (i) { return /^pf_size/.test(i.id); }));
  var six = F.runPreflightCheck(book([[], [], [], [], [], []], 'saddle_stitch')), eight = F.runPreflightCheck(book([[], [], [], [], [], [], [], []], 'saddle_stitch'));
  var sewn = F.runPreflightCheck(book([[], [], [], [], [], []], 'smyth_hardcover'));
  check('3.10 saddle stitching needs a multiple of 4 (an error); a sewn book not in 8s is a warning; an even count for perfect binding is fine',
    six.some(function (i) { return i.id === 'pf_binding_parity' && i.severity === 'warning' && /reach 8 or 4/.test(i.suggestion); }) &&
    !eight.some(function (i) { return /^pf_binding/.test(i.id); }) && sewn.some(function (i) { return i.id === 'pf_binding_signatures' && i.severity === 'warning'; }) &&
    !F.runPreflightCheck(book([[], []])).some(function (i) { return i.category === 'binding'; }), six.map(function (i) { return i.id; }));
  var labelBook = book([[text('toc', 20, 20, 150, 20, 'Contents', { textRole: 'heading', masterElementId: 'm1' })], []]);
  labelBook.pages[0].role = 'table_of_contents';
  var labelPh = new Set(); labelPh.add(String.fromCharCode(1) + 'master' + String.fromCharCode(1) + 'm1' + String.fromCharCode(1) + 'contents');
  check('3.11 a contents page\'s "Contents" heading is the book\'s label, never "template words"', P.isPlaceholderText('Contents', labelPh, { id: 'toc', masterElementId: 'm1' }) &&
    !F.runPreflightCheck(labelBook, { placeholders: labelPh }).some(function (i) { return /^pf_sample/.test(i.id); }));
  check('3.12 every issue names its page when it has one, and its words are plain (no bare "ET")', issues.every(function (i) {
    return (!i.elementId || i.pageId) && !/\bET\b/.test(i.title + ' ' + i.detail + ' ' + i.suggestion);
  }));
})();

/* ---------- 4 the page range ---------- */
(function () {
  var R = G.resolvePageRange;
  var all = R({ all: true, from: '', to: '' }, 140), mid = R({ all: false, from: '12', to: '20' }, 140), one = R({ all: false, from: ' 7 ', to: '7' }, 140);
  check('4.1 every page, or from–to (both included)', all.ok && all.pages === 'all' && all.count === 140 && mid.ok && mid.pages.from === 12 && mid.pages.to === 20 && mid.count === 9 &&
    one.ok && one.count === 1 && R({ all: false, from: 1, to: 140 }, 140).count === 140, [all, mid, one]);
  var back = R({ all: false, from: '20', to: '12' }, 140), out = R({ all: false, from: '130', to: '141' }, 140), zero = R({ all: false, from: '0', to: '3' }, 140),
    word = R({ all: false, from: 'two', to: '5' }, 140), half = R({ all: false, from: '2.5', to: '5' }, 140), empty = R({ all: false, from: '', to: '5' }, 140);
  check('4.2 what is wrong is said, and nothing is exported: backwards, past the last page, page 0, not a whole number, empty',
    !back.ok && /swap them/.test(back.error) && !out.ok && out.error === 'This book has 140 pages: choose pages from 1 to 140.' && !zero.ok && !word.ok &&
    /Type page numbers, for example 1 to 140/.test(word.error) && !half.ok && !empty.ok, [back.error, out.error, word.error]);
  check('4.3 a book with no pages exports nothing', !R({ all: true, from: '', to: '' }, 0).ok);
  check('4.4 the range in words', G.pageRangeWords('all', 140) === 'all 140 pages' && G.pageRangeWords({ from: 12, to: 20 }, 140) === 'pages 12–20' &&
    G.pageRangeWords({ from: 7, to: 7 }, 140) === 'page 7');
})();

/* ---------- 5 file names ---------- */
(function () {
  check('5.1 "<Book name> – print-ready.pdf" and "<Book name> – review.pdf"', G.pdfFileName('Awards Annual 2026', 'print') === 'Awards Annual 2026 – print-ready.pdf' &&
    G.pdfFileName('Awards Annual 2026', 'review') === 'Awards Annual 2026 – review.pdf');
  check('5.2 the book\'s own words are kept (any language); characters a file name may not hold are taken out; no name gives "Book"',
    G.pdfFileName('Heritage: 1947/2027 "Edition" <A|B>?*', 'print') === 'Heritage 1947 2027 Edition A B – print-ready.pdf' &&
    G.pdfFileName('विरासत की कहानी', 'review') === 'विरासत की कहानी – review.pdf' && G.pdfFileName('   ', 'print') === 'Book – print-ready.pdf' &&
    G.pdfFileName('...hidden.', 'print') === 'hidden – print-ready.pdf', [G.pdfFileName('Heritage: 1947/2027 "Edition" <A|B>?*', 'print'), G.pdfFileName('...hidden.', 'print')]);
  var longName = new Array(60).join('Very long ');
  check('5.3 a very long name is cut to 120 characters', G.safeFileBase(longName).length <= 120 && G.pdfFileName(longName, 'print').slice(-18) === ' – print-ready.pdf');
  check('5.4 page and spread images, and the backup', G.imageFileName('My Book', 4, null, 'png') === 'My Book – page 04.png' &&
    G.imageFileName('My Book', 4, 5, 'jpg') === 'My Book – pages 04–05.jpg' && G.imageFileName('My Book', 120, 121, 'png') === 'My Book – pages 120–121.png' &&
    G.backupFileName('My Book') === 'My Book.bookstudio.zip');
})();

/* ---------- 6 while a PDF is made, and afterwards ---------- */
(function () {
  check('6.1 the progress line: "Page 12 of 140: photos"; before the first page, getting ready', G.progressLabel(12, 140, 'photos') === 'Page 12 of 140: photos' &&
    G.progressLabel(0, 140, 'fonts') === 'Getting ready: fonts' && G.progressLabel(0, 0) === 'Getting ready' && G.progressLabel(141, 140, 'saving') === 'Page 140 of 140: saving' &&
    G.progressLabel(3, 10) === 'Page 3 of 10');
  check('6.2 …and how far along, from 0 to 1', G.progressFraction(70, 140) === 0.5 && G.progressFraction(0, 0) === 0 && G.progressFraction(200, 140) === 1 && G.progressFraction(-1, 5) === 0);
  check('6.3 file sizes in words', G.formatBytes(512) === '512 bytes' && G.formatBytes(2048) === '2 KB' && G.formatBytes(5.25 * 1024 * 1024) === '5.3 MB');
  var result = { blob: null, pageCount: 72, sizeBytes: 48 * 1024 * 1024,
    fonts: [{ family: 'Lora', weight: 400, italic: false, embedded: true }, { family: 'Lora', weight: 700, italic: false, embedded: true }, { family: 'Lora', weight: 400, italic: true, embedded: true },
      { family: 'Inter', weight: 600, italic: false, embedded: true }],
    images: { count: 40, belowTarget: 3 }, warnings: ['Inter 600 is not in the font file: 700 was used instead', 'Page 9: a photo could not be read, its frame is left empty'] };
  var s = G.summarizePdf(result, { bookName: 'Awards Annual', mode: 'print', targetPpi: 300, pages: 'all', spreads: true, bookPages: 140 });
  var fact = function (label) { var f = s.facts.filter(function (x) { return x.label === label; })[0]; return f ? f.value : null; };
  check('6.4 the summary: pages, file size, fonts embedded, photos below the target, warnings; the file name',
    s.heading === 'Your print-ready PDF is ready' && s.fileName === 'Awards Annual – print-ready.pdf' && fact('Pages') === 'all 140 pages, as spreads (72 PDF pages)' &&
    fact('File size') === '48.0 MB' && fact('Fonts embedded') === '4 styles' && fact('Photos') === '3 of 40 below 300 ppi' && fact('Warnings') === '2', s.facts);
  check('6.5 …the fonts by family, a weight substitution shown with the fonts, the other warnings on their own',
    s.fonts.join('|') === 'Lora: Regular, Bold, Italic|Inter: SemiBold' && s.fontNotes.length === 1 && /700 was used instead/.test(s.fontNotes[0]) &&
    s.warnings.length === 1 && /Page 9/.test(s.warnings[0]) && s.fontsMissing.length === 0, s);
  var rv = G.summarizePdf({ pageCount: 1, sizeBytes: 900, fonts: [], images: { count: 0, belowTarget: 0 }, warnings: [] },
    { bookName: 'B', mode: 'review', targetPpi: 300, pages: { from: 7, to: 7 }, spreads: false, bookPages: 20 });
  check('6.6 a review PDF\'s summary', rv.heading === 'Your review PDF is ready' && rv.fileName === 'B – review.pdf' && rv.facts[0].value === 'page 7 (1 PDF page)' &&
    rv.facts.filter(function (f) { return f.label === 'Photos'; })[0].value === 'No photos in these pages' && rv.facts.every(function (f) { return f.label !== 'Warnings'; }), rv.facts);
  var bad = [{ family: 'Playfair Display', weight: 700, italic: true, embedded: false, reason: 'the font file could not be downloaded' }, { family: 'Lora', weight: 400, italic: false, embedded: true },
    { family: 'Mystery Sans', weight: 400, italic: false, embedded: false }];
  var d = G.fontErrorAdvice(bad, true), c = G.fontErrorAdvice(bad, false);
  check('6.7 fonts that couldn\'t be embedded: which, why, and how to fix it (a Designer chooses another font; a Content editor asks one; or check the connection)',
    d.lines.join('|') === "Playfair Display Bold Italic: the font file could not be downloaded|Mystery Sans Regular: it couldn't be embedded" &&
    /Choose another font/.test(d.fix) && /check your connection/.test(d.fix) && /Ask a Designer/.test(c.fix) && /check your connection/.test(c.fix), [d, c]);
})();

/* ---------- 7 page and spread images draw the screen's layout (textEngine.layoutTextLines) ---------- */
async function rasterText() {
  var file = path.join(APP, 'raster-entry.ts');
  var out = esbuild.buildSync({
    stdin: { contents: "export { renderPageToCanvas } from './src/engines/exportEngine';\nexport { layoutTextLines, setFontMetrics, textBoxOf } from './src/engines/textEngine';\nexport { setMeasure, estimateMeasure } from './src/engines/textMeasure';\n",
      resolveDir: APP, loader: 'ts', sourcefile: 'raster-entry.ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node18', logLevel: 'silent', external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react', 'pdf-lib', 'jszip'] });
  var m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(APP);
  m._compile(out.outputFiles[0].text, file);
  var X = m.exports;
  X.setMeasure(X.estimateMeasure);
  X.setFontMetrics(function () { return { ascent: 0.8, descent: 0.2 }; });

  var calls = [];
  function fakeCtx() {
    var c = { globalAlpha: 1, fillStyle: '', textAlign: 'start', textBaseline: 'alphabetic', letterSpacing: '0px', font: '', filter: 'none', stack: [] };
    ['beginPath', 'rect', 'clip', 'fillRect', 'translate', 'rotate', 'moveTo', 'lineTo', 'stroke', 'fill', 'ellipse', 'roundRect', 'drawImage'].forEach(function (k) { c[k] = function () {}; });
    c.save = function () { c.stack.push({ letterSpacing: c.letterSpacing, font: c.font, fillStyle: c.fillStyle }); };
    c.restore = function () { var st = c.stack.pop(); if (st) { c.letterSpacing = st.letterSpacing; c.font = st.font; c.fillStyle = st.fillStyle; } };
    c.measureText = function (t) { return { width: String(t).length * 5 }; };
    c.fillText = function (t, x, y) { calls.push({ t: t, x: x, y: y, font: c.font, ls: c.letterSpacing, colour: c.fillStyle }); };
    return c;
  }
  var ctx = fakeCtx();
  global.document = { createElement: function () { return { width: 0, height: 0, getContext: function () { return ctx; } }; } };

  var style = { fontFamily: 'Lora', fontSizePt: 11, fontWeight: 400, fontStyle: 'italic', color: '#223344', lineHeight: 1.5, letterSpacingEm: 0.05, textAlign: 'justify', verticalAlign: 'top',
    paragraphSpacingMm: 9, columns: 1, columnGapMm: 5, insetMm: 2 };
  var words = 'The well-known studio opened its doors in 1952 — and every summer since, its long tables have filled with drawings, models and visitors from across the region.';
  var body = { id: 'b', name: 'Body', type: 'text', xMm: 20, yMm: 30, widthMm: 70, heightMm: 40, rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 2, textRole: 'body',
    text: words + '\n\n' + words + ' ' + words + ' ' + words, textStyle: style };
  var folio = { id: 'f', name: 'Folio', type: 'pageNumber', xMm: 150, yMm: 280, widthMm: 20, heightMm: 8, rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 3,
    text: '{{page}}', textStyle: Object.assign({}, style, { textAlign: 'right', letterSpacingEm: 0, fontStyle: 'normal', insetMm: 0, paragraphSpacingMm: 0 }) };
  var project = { name: 'B', dimensions: { widthMm: 200, heightMm: 300, bleedMm: 3 }, designSystem: { colors: { paper: '#FFFFFF' } }, pages: [] };
  var page = { id: 'p', orderIndex: 0, label: 'P', role: 'editorial_text', backgroundColor: '#FFFFFF', elements: [body, folio] };
  await X.renderPageToCanvas(page, 7, project, 254); // 10 px per mm
  var laid = X.layoutTextLines(body, { pageNumber: 7 });
  var expected = [];
  laid.lines.forEach(function (l) { (l.words || []).forEach(function (w) { expected.push({ t: w.text, x: (body.xMm + w.xMm) * 10, y: (body.yMm + l.baselineMm) * 10 }); }); });
  var drawn = calls.filter(function (c) { return c.font.indexOf('"Lora"') !== -1 && /italic/.test(c.font); });
  var same = drawn.length === expected.length && expected.every(function (e, i) { return drawn[i].t === e.t && Math.abs(drawn[i].x - e.x) < 1e-6 && Math.abs(drawn[i].y - e.y) < 1e-6; });
  check('7.1 an image draws each word exactly where the screen\'s layout puts it (layoutTextLines: the frame\'s inset, its baseline, justified spaces)', same && expected.length > 20,
    { drawn: drawn.length, expected: expected.length, first: [drawn[0], expected[0]] });
  check('7.2 …only the lines that fit: what doesn\'t fit is never drawn', laid.overflow === true && drawn.length < X.layoutTextLines(Object.assign({}, body, { heightMm: 400 })).lines.reduce(function (a, l) { return a + l.words.length; }, 0));
  var box = X.textBoxOf(style, body.widthMm, body.heightMm);
  var full = laid.lines.filter(function (l) { return l.justify; });
  check('7.3 …a justified line reaches the column\'s right edge; a paragraph\'s last line does not', full.length > 0 && full.every(function (l) {
    var w = l.words[l.words.length - 1]; return Math.abs(w.xMm + w.widthMm - (2 + box.columnWidthMm)) < 0.01; }) && laid.lines.some(function (l) { return l.lastInParagraph && !l.justify; }));
  check('7.4 …letter spacing as the screen has it (0.05 em of an 11 pt face at 10 px per mm), the frame\'s font, italic, and colour',
    drawn.every(function (c) { return Math.abs(parseFloat(c.ls) - 0.05 * 11 * 25.4 / 72 * 10) < 1e-6 && c.colour === '#223344'; }) && /italic 400 [\d.]+px "Lora", serif/.test(drawn[0].font), drawn[0]);
  var hy = laid.lines.some(function (l) { return /-$/.test(l.text) && /well-$/.test(l.text); }) || laid.lines.some(function (l) { return l.words.some(function (w) { return w.text === 'well-known'; }); });
  check('7.5 …and a word with a hyphen is drawn whole or broken after its hyphen, as on screen (never somewhere else)', hy && !drawn.some(function (c) { return /^known/.test(c.t) && !laid.lines.some(function (l) { return l.words.some(function (w) { return w.text === c.t; }); }); }));
  var num = calls.filter(function (c) { return c.t === '07'; });
  check('7.6 a page number frame shows its page, right-aligned as on screen', num.length === 1 && Math.abs(num[0].x - (folio.xMm + X.layoutTextLines(folio, { pageNumber: 7 }).lines[0].xMm) * 10) < 1e-6 &&
    num[0].ls === '0px', num);
  delete global.document;
}

rasterText().catch(function (e) { check('7 the raster text test ran', false, String(e && e.stack || e)); }).then(function () {
  process.stdout.write('books-export: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
});
