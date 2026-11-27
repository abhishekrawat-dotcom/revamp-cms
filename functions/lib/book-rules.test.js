// node functions/lib/book-rules.test.js — Books (BOOKSTUDIO, the owner, 26 Nov 2026: a Designer does everything; a
// Content editor everything except the design; docs/bookstudio/PLAN.md Phase 2): lib/book-rules.js, the one copy of what
// is design and what is content (the server refuses a Content editor's design change with it; the editor bundles it).
//   1. designChanges: every design key of the book, a page, a frame, a photo and an infographic is caught; every content
//      key passes; new pages made from the book's master pages or copied from its pages pass; invented frames,
//      backgrounds and sizes are caught; frames added to or removed from a page are caught.
//   2. mergeBooks / resolveConflicts: a text conflict, both sides editing different frames, pages added, deleted and
//      reordered, a delete against an edit, the manuscript and the photo list, and each kind of conflict resolved.
// A KNOWN BUG line is a defect found in book-rules.js (reported, not fixed here: the editor bundles that file); it does
// not fail the run, and it says FIXED once the file is corrected, so it can become an ordinary check. No network.
'use strict';
var BR = require('./book-rules');
var passed = 0, failed = 0, known = [];
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '') + '\n'); }
function knownBug(name, ok, detail) {
  if (ok) { passed++; process.stderr.write('FIXED (make this an ordinary check): ' + name + '\n'); return; }
  known.push(name); process.stderr.write('KNOWN BUG in book-rules.js: ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 300) : '') + '\n');
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ---------- a book as the editor holds it ---------- */
function text(id, words, extra) { return Object.assign({ id: id, type: 'text', name: 'Body', xMm: 10, yMm: 20, widthMm: 100, heightMm: 40, rotation: 0, opacity: 1, zIndex: 1, locked: false, hidden: false, textRole: 'body', textStyle: { fontFamily: 'Lora', fontSizePt: 10 }, text: words }, extra || {}); }
function photo(id, extra) {
  return Object.assign({ id: id, type: 'image', name: 'Photo', xMm: 0, yMm: 0, widthMm: 240, heightMm: 160, rotation: 0, opacity: 1, zIndex: 2, locked: false, hidden: false,
    image: { src: '/a.jpg', assetId: 'as_1', alt: 'Courtyard', fit: 'cover', zoom: 1, focalX: 50, focalY: 50, naturalWidth: 4000, naturalHeight: 3000, brightness: 100, contrast: 100,
      grayscale: 0, sepia: 0, borderRadiusMm: 0, captionText: 'At dusk', originalCrop: { zoom: 1, focalX: 50, focalY: 50, fit: 'cover' } } }, extra || {});
}
function chart(id) {
  return { id: id, type: 'infographic', name: 'Chart', xMm: 10, yMm: 170, widthMm: 120, heightMm: 80, rotation: 0, opacity: 1, zIndex: 3, locked: false, hidden: false,
    infographic: { templateId: 'tpl', variant: 'kpi_grid', title: 'Visitors', subtitle: 'by year', categoryLabel: 'Year', sourceNote: 'Gate counts', fontFamily: 'Lora',
      backgroundColor: '#ffffff', textColor: '#111111', accentColor: '#c00000', secondaryColor: '#999999', items: [{ id: 'i1', label: '2024', value: 12 }], showLegend: true, showValues: true } };
}
function shape(id) { return { id: id, type: 'shape', name: 'Rule', xMm: 10, yMm: 165, widthMm: 120, heightMm: 1, rotation: 0, opacity: 1, zIndex: 4, locked: false, hidden: false, shape: { shapeKind: 'rule', fill: '#000', stroke: '#000', strokeWidthMm: 0.3, cornerRadiusMm: 0 } }; }
function bookOf() {
  return {
    id: 'b1', name: 'Forms of Light', subtitle: 'Architecture', category: 'Art', status: 'draft', unit: 'mm', coverThumbnail: '/c.jpg', ownerId: 'x', createdAt: '2026-11-01', updatedAt: '2026-11-02',
    dimensions: { widthMm: 240, heightMm: 300, bleedMm: 3, margins: { top: 20, bottom: 20, inner: 22, outer: 18 } },
    designSystem: { name: 'House', colors: { paper: '#ffffff', ink: '#111111' }, typography: { bodyFont: 'Lora' } },
    printSettings: { bindingType: 'smyth_hardcover', includeBleed: true }, customDimensionPresets: [], templateReport: null,
    masterPages: [{ id: 'm1', name: 'Text page', role: 'editorial_text', description: '', backgroundColor: '#ffffff', elements: [text('m1_t', '')] }],
    chapters: [{ id: 'ch1', number: 1, title: 'Light', orderIndex: 0 }],
    contentSections: [{ id: 's1', title: 'Intro', kind: 'body', body: 'Once.', orderIndex: 0 }, { id: 's2', title: 'Two', kind: 'body', body: 'Twice.', orderIndex: 1 }],
    imageAssets: [{ id: 'a1', name: 'one.jpg', url: '/1.jpg', widthPx: 10, heightPx: 10, mimeType: 'image/jpeg', category: 'x', tags: [], uploadedAt: '' },
      { id: 'a2', name: 'two.jpg', url: '/2.jpg', widthPx: 10, heightPx: 10, mimeType: 'image/jpeg', category: 'x', tags: [], uploadedAt: '' }],
    pages: [
      { id: 'p1', orderIndex: 0, label: 'Cover', role: 'front_cover', backgroundColor: '#ffffff', elements: [text('p1_t', 'Forms of Light', { textRole: 'display' })] },
      { id: 'p2', orderIndex: 1, label: 'Essay', role: 'editorial_text', masterPageId: 'm1', chapterId: 'ch1', backgroundColor: '#ffffff', elements: [text('p2_a', 'One two', { masterElementId: 'm1_t' }), text('p2_b', 'Three', { yMm: 70, zIndex: 2 })] },
      { id: 'p3', orderIndex: 2, label: 'Gallery', role: 'image_led', backgroundColor: '#f7f4ee', elements: [photo('p3_i'), chart('p3_g'), shape('p3_s')] },
      { id: 'p4', orderIndex: 3, label: 'Notes', role: 'editorial_text', backgroundColor: '#ffffff', elements: [text('p4_t', 'A note')] }]
  };
}
function el(b, pageId, elId) { var p = b.pages.filter(function (x) { return x.id === pageId; })[0]; return p.elements.filter(function (e) { return e.id === elId; })[0]; }
function pg(b, pageId) { return b.pages.filter(function (x) { return x.id === pageId; })[0]; }
function changesOf(change) { var before = bookOf(), after = clone(before); change(after); return BR.designChanges(before, after); }

/* ================= 1. designChanges ================= */
check('1.1 the same book: no design change', BR.designChanges(bookOf(), bookOf()).length === 0);
check('1.2 nothing at all: no design change, no error', BR.designChanges(undefined, undefined).length === 0 && BR.designChanges({}, {}).length === 0);

/* the book's own design keys, each named */
var BOOK_DESIGN = {
  dimensions: [function (b) { b.dimensions.widthMm = 250; }, /^the page size changed$/],
  designSystem: [function (b) { b.designSystem.colors.paper = '#000000'; }, /^the design system \(colours, fonts, styles\) changed$/],
  masterPages: [function (b) { b.masterPages[0].elements[0].xMm = 11; }, /^the master pages changed$/],
  printSettings: [function (b) { b.printSettings.includeBleed = false; }, /^the print settings changed$/],
  customDimensionPresets: [function (b) { b.customDimensionPresets.push({ id: 'x', name: 'X', widthMm: 1, heightMm: 1 }); }, /^the saved page sizes changed$/],
  templateReport: [function (b) { b.templateReport = { id: 'r', approved: true }; }, /^the approved template design changed$/]
};
check('1.3 every design key of the book is tested here', JSON.stringify(Object.keys(BOOK_DESIGN).sort()) === JSON.stringify(BR.DESIGN_BOOK_KEYS.slice().sort()), BR.DESIGN_BOOK_KEYS);
Object.keys(BOOK_DESIGN).forEach(function (k) {
  var c = changesOf(BOOK_DESIGN[k][0]);
  check('1.4 book design — ' + k + ': caught, in words', c.length === 1 && BOOK_DESIGN[k][1].test(c[0]), c);
});
check('1.5 a master page added, removed or reordered: caught', changesOf(function (b) { b.masterPages.push({ id: 'm2', name: 'M2', elements: [] }); }).length === 1 &&
  changesOf(function (b) { b.masterPages = []; }).length === 1 && changesOf(function (b) { b.masterPages.push({ id: 'm2', name: 'M2', elements: [] }); b.masterPages.reverse(); }).length === 1);
check('1.6 a book field nobody has named yet: design (locked until it is named)', /^the book's glossFinish changed$/.test(changesOf(function (b) { b.glossFinish = true; })[0] || ''));

/* the book's content keys: none is design */
var BOOK_CONTENT = {
  id: function (b) { b.id = 'b2'; }, name: function (b) { b.name = 'Forms of Light II'; }, subtitle: function (b) { b.subtitle = 'New'; }, category: function (b) { b.category = 'Design'; },
  status: function (b) { b.status = 'print_ready'; }, unit: function (b) { b.unit = 'in'; }, coverThumbnail: function (b) { b.coverThumbnail = '/d.jpg'; },
  chapters: function (b) { b.chapters.push({ id: 'ch2', number: 2, title: 'Dark', orderIndex: 1 }); },
  contentSections: function (b) { b.contentSections[0].body = 'Once more.'; b.contentSections.push({ id: 's3', title: 'Three', kind: 'quote', body: '"Q"', orderIndex: 2 }); },
  imageAssets: function (b) { b.imageAssets.pop(); b.imageAssets.push({ id: 'a9', name: 'nine.jpg', url: '/9.jpg' }); },
  pages: function (b) { b.pages[0].elements[0].text = 'New title'; }, createdAt: function (b) { b.createdAt = 'x'; }, updatedAt: function (b) { b.updatedAt = 'y'; }, ownerId: function (b) { b.ownerId = 'z'; }
};
check('1.7 every content key of the book is tested here', JSON.stringify(Object.keys(BOOK_CONTENT).sort()) === JSON.stringify(BR.CONTENT_BOOK_KEYS.slice().sort()), BR.CONTENT_BOOK_KEYS);
Object.keys(BOOK_CONTENT).forEach(function (k) { var c = changesOf(BOOK_CONTENT[k]); check('1.8 book content — ' + k + ': passes', c.length === 0, c); });

/* a page's design and content */
var PAGE_DESIGN = {
  role: [function (b) { pg(b, 'p4').role = 'quote_page'; }, /^"Notes": its layout type changed$/],
  masterPageId: [function (b) { pg(b, 'p2').masterPageId = 'm9'; }, /^"Essay": its master page changed$/],
  detachedFromMaster: [function (b) { pg(b, 'p2').detachedFromMaster = true; }, /^"Essay": its master link changed$/],
  backgroundColor: [function (b) { pg(b, 'p3').backgroundColor = '#000000'; }, /^"Gallery": its background changed$/],
  dimensionsOverride: [function (b) { pg(b, 'p3').dimensionsOverride = { widthMm: 480, heightMm: 300 }; }, /^"Gallery": its size changed$/],
  'a field nobody named': [function (b) { pg(b, 'p3').spotVarnish = true; }, /^"Gallery": its spotVarnish changed$/]
};
Object.keys(PAGE_DESIGN).forEach(function (k) { var c = changesOf(PAGE_DESIGN[k][0]); check('1.9 page design — ' + k + ': caught, naming the page', c.length === 1 && PAGE_DESIGN[k][1].test(c[0]), c); });
var unlabeled = bookOf(); delete unlabeled.pages[3].label; var unlabeled2 = clone(unlabeled); unlabeled2.pages[3].backgroundColor = '#eee';
check('1.10 a page without a label is named by its number', /^page 4: its background changed$/.test(BR.designChanges(unlabeled, unlabeled2)[0] || ''), BR.designChanges(unlabeled, unlabeled2));
check('1.11 page content — label, chapter, order: pass', changesOf(function (b) { pg(b, 'p2').label = 'Essay one'; pg(b, 'p2').chapterId = 'ch2'; b.pages.forEach(function (p, i) { p.orderIndex = 10 - i; }); }).length === 0);
check('1.12 the content keys of a page are what the rules name', JSON.stringify(BR.CONTENT_PAGE_KEYS) === JSON.stringify(['id', 'orderIndex', 'label', 'chapterId', 'elements']));

/* a frame's design */
var FRAME_DESIGN = {
  xMm: 'position', yMm: 'position', widthMm: 'size', heightMm: 'size', rotation: 'rotation', opacity: 'opacity', zIndex: 'layer order', locked: 'lock', hidden: 'visibility',
  groupId: 'grouping', name: 'name', textStyle: 'text style', type: 'kind', textRole: 'text role', masterElementId: 'master link', overriddenFromMaster: 'master link'
};
var FRAME_VALUE = { xMm: 11, yMm: 21, widthMm: 101, heightMm: 41, rotation: 90, opacity: 0.5, zIndex: 7, locked: true, hidden: true, groupId: 'g1', name: 'Lead', textStyle: { fontFamily: 'Syne', fontSizePt: 30 },
  type: 'image', textRole: 'heading', masterElementId: 'm9', overriddenFromMaster: true };
Object.keys(FRAME_DESIGN).forEach(function (k) {
  var c = changesOf(function (b) { el(b, 'p2', 'p2_b')[k] = FRAME_VALUE[k]; });
  check('1.13 frame design — ' + k + ': caught as its ' + FRAME_DESIGN[k], c.length === 1 && c[0] === '"Essay": frame "Body" — its ' + FRAME_DESIGN[k] + ' changed', c);
});
var sh = changesOf(function (b) { el(b, 'p3', 'p3_s').shape.fill = '#ff0000'; });
check('1.14 frame design — a shape\'s fill: caught', sh.length === 1 && /frame "Rule" — its shape changed$/.test(sh[0]), sh);
var several = changesOf(function (b) { var e = el(b, 'p2', 'p2_b'); e.xMm = 1; e.widthMm = 2; e.locked = true; });
check('1.15 several design changes to one frame: one sentence naming them all', several.length === 1 && several[0] === '"Essay": frame "Body" — its position, size, lock changed', several);
check('1.16 a frame field nobody has named yet: design', /frame "Body" — its glow changed$/.test(changesOf(function (b) { el(b, 'p2', 'p2_b').glow = 3; })[0] || ''));
check('1.17 frame content — its text and the manuscript section it shows: pass', changesOf(function (b) { el(b, 'p2', 'p2_b').text = 'Something new'; el(b, 'p2', 'p2_b').contentSectionId = 's2'; }).length === 0);
check('1.18 frames reordered in the page\'s list (their layer is zIndex): pass', changesOf(function (b) { pg(b, 'p3').elements.reverse(); }).length === 0);
check('1.19 a frame added to an existing page: caught, even a copy of one there', /^"Essay": a frame "Body" was added$/.test(changesOf(function (b) { pg(b, 'p2').elements.push(text('p2_c', 'More')); })[0] || '') &&
  changesOf(function (b) { var copy = clone(el(b, 'p2', 'p2_b')); copy.id = 'p2_copy'; pg(b, 'p2').elements.push(copy); }).length === 1);
check('1.20 a frame removed from an existing page: caught', /^"Gallery": frame "Rule" was removed$/.test(changesOf(function (b) { pg(b, 'p3').elements.pop(); })[0] || ''));

/* a photo in a frame: what is content, what is design */
var IMAGE_CONTENT = { src: '/b.jpg', assetId: 'as_2', alt: 'Hall', fit: 'contain', zoom: 1.6, focalX: 20, focalY: 80, naturalWidth: 3000, naturalHeight: 2000, captionText: 'At dawn',
  originalCrop: { zoom: 2, focalX: 10, focalY: 10, fit: 'contain' } };
check('1.21 every content key of a photo is tested here', JSON.stringify(Object.keys(IMAGE_CONTENT).sort()) === JSON.stringify(BR.CONTENT_IMAGE_KEYS.slice().sort()), BR.CONTENT_IMAGE_KEYS);
Object.keys(IMAGE_CONTENT).forEach(function (k) { var c = changesOf(function (b) { el(b, 'p3', 'p3_i').image[k] = IMAGE_CONTENT[k]; }); check('1.22 photo content — ' + k + ': passes', c.length === 0, c); });
['brightness', 'contrast', 'grayscale', 'sepia', 'borderRadiusMm', 'duotone'].forEach(function (k) {
  var c = changesOf(function (b) { el(b, 'p3', 'p3_i').image[k] = 42; });
  check('1.23 photo design — ' + k + ': caught as photo effects', c.length === 1 && /frame "Photo" — its photo effects changed$/.test(c[0]), c);
});
check('1.24 a frame\'s photo as null and no photo at all are the same', changesOf(function (b) { el(b, 'p2', 'p2_b').image = null; }).length === 0);
check('1.24b an empty photo frame (src \'\', as the editor makes it) given a photo: content', changesOf(function (b) { var i = el(b, 'p3', 'p3_i').image; i.src = ''; i.assetId = ''; }).length === 0);

/* an infographic: data is content, look is design */
var INFO_CONTENT = { templateId: 'tpl2', variant: 'horizontal_bars', title: 'Guests', subtitle: 'per day', categoryLabel: 'Day', sourceNote: 'Tickets', items: [{ id: 'i1', label: 'Mon', value: 3 }], showLegend: false, showValues: false };
check('1.25 every content key of an infographic is tested here', JSON.stringify(Object.keys(INFO_CONTENT).sort()) === JSON.stringify(BR.CONTENT_INFOGRAPHIC_KEYS.slice().sort()), BR.CONTENT_INFOGRAPHIC_KEYS);
Object.keys(INFO_CONTENT).forEach(function (k) { var c = changesOf(function (b) { el(b, 'p3', 'p3_g').infographic[k] = INFO_CONTENT[k]; }); check('1.26 infographic content — ' + k + ': passes', c.length === 0, c); });
['fontFamily', 'backgroundColor', 'textColor', 'accentColor', 'secondaryColor', 'gradient'].forEach(function (k) {
  var c = changesOf(function (b) { el(b, 'p3', 'p3_g').infographic[k] = 'X'; });
  check('1.27 infographic design — ' + k + ': caught as colours or font', c.length === 1 && /frame "Chart" — its colours or font changed$/.test(c[0]), c);
});

/* pages added, deleted, reordered */
check('1.28 a page deleted: content', changesOf(function (b) { b.pages.splice(3, 1); }).length === 0);
check('1.29 pages reordered: content', changesOf(function (b) { b.pages.reverse(); b.pages.forEach(function (p, i) { p.orderIndex = i; }); }).length === 0);
function fromMaster(b, id) {
  var m = b.masterPages[0];
  return { id: id, orderIndex: b.pages.length, label: 'New page', role: 'editorial_text', masterPageId: m.id, backgroundColor: m.backgroundColor,
    elements: m.elements.map(function (e, i) { return Object.assign(clone(e), { id: id + '_' + i, masterElementId: e.id, zIndex: 20 + i, text: 'Poured in' }); }) };
}
check('1.30 a new page made from a master page (its frames copied, new ids, its text written): content', changesOf(function (b) { b.pages.push(fromMaster(b, 'pn')); }).length === 0,
  changesOf(function (b) { b.pages.push(fromMaster(b, 'pn')); }));
check('1.31 a new page copied from one of the book\'s pages (new ids, layers and group, other photo and text): content', changesOf(function (b) {
  var c = clone(pg(b, 'p3')); c.id = 'p3_copy'; c.label = 'Gallery 2'; c.chapterId = 'ch1';
  c.elements.forEach(function (e, i) { e.id = 'cp' + i; e.zIndex = 30 + i; e.groupId = 'grp'; });
  c.elements[0].image.src = '/other.jpg'; c.elements[0].image.zoom = 2; c.elements[1].infographic.items = [];
  b.pages.splice(1, 0, c);
}).length === 0);
check('1.32 a new page made from a master, in the middle of the book: content', changesOf(function (b) { b.pages.splice(1, 0, fromMaster(b, 'pm')); }).length === 0);
var inv = changesOf(function (b) { var n = fromMaster(b, 'pn'); n.elements[0].xMm = 33; b.pages.push(n); });
check('1.33 a new page with an invented frame (moved from its source): caught', inv.length === 1 && inv[0] === 'new "New page" has a frame "Body" that is not one of the book\'s layouts', inv);
var inv2 = changesOf(function (b) { var n = fromMaster(b, 'pn'); n.elements.push(shape('pn_s')); n.elements[1].shape.fill = '#00ff00'; b.pages.push(n); });
check('1.34 a new page with a frame no page or master has: caught', inv2.length === 1 && /has a frame "Rule" that is not one of the book's layouts$/.test(inv2[0]), inv2);
var inv3 = changesOf(function (b) { var n = fromMaster(b, 'pn'); n.backgroundColor = '#123456'; b.pages.push(n); });
check('1.35 a new page with an invented background: caught', inv3.length === 1 && inv3[0] === 'new "New page" has a background, size or master page the book\'s layouts do not have', inv3);
var inv4 = changesOf(function (b) { var n = fromMaster(b, 'pn'); n.dimensionsOverride = { widthMm: 480, heightMm: 300 }; b.pages.push(n); });
check('1.36 a new page with an invented size: caught', inv4.length === 1 && /background, size or master page/.test(inv4[0]), inv4);
var inv5 = changesOf(function (b) { var n = fromMaster(b, 'pn'); n.elements[0].image = { src: '/x.jpg', brightness: 50 }; b.pages.push(n); });
check('1.37 a new page whose copied frame has photo effects its source has not: caught', inv5.length === 1, inv5);
var mixed = changesOf(function (b) { b.dimensions.heightMm = 310; el(b, 'p2', 'p2_a').text = 'new words'; pg(b, 'p4').role = 'quote_page'; b.pages.push(Object.assign(fromMaster(b, 'pn'), { backgroundColor: '#abcdef' })); });
check('1.38 design and content changes together: every design change listed, the content ones not', mixed.length === 3 && mixed[0] === 'the page size changed' &&
  mixed.some(function (c) { return /"Notes": its layout type changed/.test(c); }) && mixed.some(function (c) { return /background, size or master page/.test(c); }), mixed);
var beforeNoMasters = bookOf(); beforeNoMasters.masterPages = [];
var afterNoMasters = clone(beforeNoMasters); afterNoMasters.pages.push({ id: 'pn', label: 'N', role: 'editorial_text', backgroundColor: '#ffffff', elements: [Object.assign(clone(el(afterNoMasters, 'p2', 'p2_b')), { id: 'x1', text: '' })] });
check('1.39 a book with no master pages: a new page copied from its pages still passes', BR.designChanges(beforeNoMasters, afterNoMasters).length === 0, BR.designChanges(beforeNoMasters, afterNoMasters));
/* defects found (book-rules.js is not changed here: the editor bundles it) */
var newRole = changesOf(function (b) { var n = fromMaster(b, 'pn'); n.role = 'front_cover'; b.pages.push(n); });
var newField = changesOf(function (b) { var n = fromMaster(b, 'pn'); n.spotVarnish = true; b.pages.push(n); });
var newMaster = changesOf(function (b) { var n = fromMaster(b, 'pn'); n.masterPageId = 'no-such-master'; b.pages.push(n); });
/* a new page's own settings are checked (background, size, master link, any setting not named as content); its
   layout-type label is free, because the editor adds every page as an editorial page whatever layout it copies */
check('1.40 a new page with a master page the book does not have, or a setting nobody named: caught; its layout-type label: free',
  newField.length === 1 && newMaster.length === 1 && newRole.length === 0, { role: newRole, field: newField, master: newMaster });
var nullSize = changesOf(function (b) { var n = fromMaster(b, 'pn'); n.dimensionsOverride = null; b.pages.push(n); });
check('1.41 a new page made from a master with dimensionsOverride: null is refused (stable() keeps null, so null ≠ missing for new pages; on existing pages they are the same)', nullSize.length === 0, nullSize);

/* ================= 2. mergeBooks and resolveConflicts ================= */
function three(mineChange, theirChange) { var base = bookOf(), mine = clone(base), theirs = clone(base); mineChange(mine); theirChange(theirs); return { base: base, r: BR.mergeBooks(base, mine, theirs) }; }
function ids(list) { return (list || []).map(function (x) { return x.id; }).join(','); }
function none() {}
var same0 = three(none, none);
check('2.1 nobody changed anything: the book as it was, no conflicts', same0.r.conflicts.length === 0 && BR.same(same0.r.merged, same0.base), same0.r.conflicts);
var onlyMine = three(function (b) { el(b, 'p2', 'p2_a').text = 'mine'; b.subtitle = 'Mine'; }, none);
check('2.2 only one side changed: that side\'s changes', onlyMine.r.conflicts.length === 0 && el(onlyMine.r.merged, 'p2', 'p2_a').text === 'mine' && onlyMine.r.merged.subtitle === 'Mine');
var onlyTheirs = three(none, function (b) { el(b, 'p2', 'p2_a').text = 'theirs'; });
check('2.3 …either side', onlyTheirs.r.conflicts.length === 0 && el(onlyTheirs.r.merged, 'p2', 'p2_a').text === 'theirs');
var sameEdit = three(function (b) { el(b, 'p2', 'p2_a').text = 'both'; }, function (b) { el(b, 'p2', 'p2_a').text = 'both'; });
check('2.4 both made the same change: no conflict', sameEdit.r.conflicts.length === 0 && el(sameEdit.r.merged, 'p2', 'p2_a').text === 'both');

var tx = three(function (b) { el(b, 'p2', 'p2_a').text = 'Mine words'; }, function (b) { el(b, 'p2', 'p2_a').text = 'Their words'; });
var c0 = tx.r.conflicts[0] || {};
check('2.5 a text conflict: one conflict, the frame and page named, both versions, theirs held until it is resolved', tx.r.conflicts.length === 1 && c0.kind === 'frame' && c0.pageId === 'p2' &&
  c0.elementId === 'p2_a' && c0.field === 'text' && c0.mine === 'Mine words' && c0.theirs === 'Their words' && c0.label === '"Essay", frame "Body"' && c0.id === 'c1' &&
  el(tx.r.merged, 'p2', 'p2_a').text === 'Their words', tx.r.conflicts);
var diffFrames = three(function (b) { el(b, 'p2', 'p2_a').text = 'Mine'; el(b, 'p3', 'p3_i').image.zoom = 2; }, function (b) { el(b, 'p2', 'p2_b').text = 'Theirs'; el(b, 'p1', 'p1_t').text = 'Their title'; });
check('2.6 both sides edit different frames: both kept, no conflicts', diffFrames.r.conflicts.length === 0 && el(diffFrames.r.merged, 'p2', 'p2_a').text === 'Mine' &&
  el(diffFrames.r.merged, 'p2', 'p2_b').text === 'Theirs' && el(diffFrames.r.merged, 'p1', 'p1_t').text === 'Their title' && el(diffFrames.r.merged, 'p3', 'p3_i').image.zoom === 2, diffFrames.r.conflicts);
var diffFields = three(function (b) { el(b, 'p2', 'p2_a').text = 'Mine'; }, function (b) { el(b, 'p2', 'p2_a').xMm = 55; });
check('2.7 both edit one frame, different fields (text and position): both kept', diffFields.r.conflicts.length === 0 && el(diffFields.r.merged, 'p2', 'p2_a').text === 'Mine' && el(diffFields.r.merged, 'p2', 'p2_a').xMm === 55);
var posConf = three(function (b) { el(b, 'p2', 'p2_a').xMm = 1; }, function (b) { el(b, 'p2', 'p2_a').xMm = 2; });
check('2.8 the same frame moved differently: a conflict on its position', posConf.r.conflicts.length === 1 && posConf.r.conflicts[0].field === 'xMm' && /— its position$/.test(posConf.r.conflicts[0].label), posConf.r.conflicts);

var added = three(function (b) { b.pages.splice(1, 0, fromMaster(b, 'pm')); }, function (b) { b.pages.push(fromMaster(b, 'pt')); });
check('2.9 pages added on both sides: both kept, mine after the page it followed, orderIndex renumbered', added.r.conflicts.length === 0 && ids(added.r.merged.pages) === 'p1,pm,p2,p3,p4,pt' &&
  added.r.merged.pages.every(function (p, i) { return p.orderIndex === i; }), ids(added.r.merged.pages));
var addedFirst = three(function (b) { b.pages.unshift(fromMaster(b, 'p0')); }, none);
check('2.10 a page added at the very front', ids(addedFirst.r.merged.pages) === 'p0,p1,p2,p3,p4');
var delMine = three(function (b) { b.pages.splice(3, 1); }, function (b) { el(b, 'p2', 'p2_a').text = 'theirs'; });
check('2.11 a page deleted on one side, others edited on the other: deleted, the edits kept', delMine.r.conflicts.length === 0 && ids(delMine.r.merged.pages) === 'p1,p2,p3' && el(delMine.r.merged, 'p2', 'p2_a').text === 'theirs');
var delTheirs = three(function (b) { el(b, 'p2', 'p2_a').text = 'mine'; }, function (b) { b.pages.splice(3, 1); });
check('2.12 …either side', ids(delTheirs.r.merged.pages) === 'p1,p2,p3' && el(delTheirs.r.merged, 'p2', 'p2_a').text === 'mine');
var delBoth = three(function (b) { b.pages.splice(3, 1); }, function (b) { b.pages.splice(3, 1); });
check('2.13 the same page deleted on both sides: gone', ids(delBoth.r.merged.pages) === 'p1,p2,p3');
var reMine = three(function (b) { b.pages = [b.pages[2], b.pages[0], b.pages[1], b.pages[3]]; }, function (b) { el(b, 'p2', 'p2_a').text = 'theirs'; });
check('2.14 pages reordered on one side, edited on the other: the new order with the edit', reMine.r.conflicts.length === 0 && ids(reMine.r.merged.pages) === 'p3,p1,p2,p4' && el(reMine.r.merged, 'p2', 'p2_a').text === 'theirs');
var reTheirs = three(function (b) { el(b, 'p3', 'p3_i').image.src = '/mine.jpg'; }, function (b) { b.pages.reverse(); });
check('2.15 …either side', ids(reTheirs.r.merged.pages) === 'p4,p3,p2,p1' && el(reTheirs.r.merged, 'p3', 'p3_i').image.src === '/mine.jpg');
var reAdd = three(function (b) { b.pages.reverse(); }, function (b) { b.pages.splice(2, 0, fromMaster(b, 'pt')); });
check('2.16 reordered on one side, a page added on the other: the new order, the page after the one it followed', ids(reAdd.r.merged.pages) === 'p4,p3,p2,pt,p1', ids(reAdd.r.merged.pages));
var reDel = three(function (b) { b.pages.reverse(); }, function (b) { b.pages.splice(0, 1); });
check('2.17 reordered on one side, a page deleted on the other: the new order without it', ids(reDel.r.merged.pages) === 'p4,p3,p2', ids(reDel.r.merged.pages));

var dvE1 = three(function (b) { b.pages.splice(1, 1); }, function (b) { el(b, 'p2', 'p2_a').text = 'their edit'; });
check('2.18 delete against edit: mine deleted a page theirs edited — the page stays, with their edit (nothing lost)', ids(dvE1.r.merged.pages) === 'p1,p2,p3,p4' && el(dvE1.r.merged, 'p2', 'p2_a').text === 'their edit', ids(dvE1.r.merged.pages));
var dvE2 = three(function (b) { el(b, 'p2', 'p2_a').text = 'my edit'; }, function (b) { b.pages.splice(1, 1); });
check('2.19 delete against edit: theirs deleted a page mine edited — the page and my edit are dropped silently, with no conflict (mergeOrder keeps a page only when the deleting side\'s list is the one kept; the last loop of mergeOrder needs inMine !== inTheirs and keepDeleted)',
  dvE2.r.merged.pages.some(function (p) { return p.id === 'p2'; }) || dvE2.r.conflicts.length > 0, { pages: ids(dvE2.r.merged.pages), conflicts: dvE2.r.conflicts.length });
var dvE3 = three(function (b) { b.pages.reverse(); el(b, 'p2', 'p2_a').text = 'my edit'; }, function (b) { b.pages.splice(1, 1); });
check('2.20 …but when mine also reordered, the page I edited stays', dvE3.r.merged.pages.some(function (p) { return p.id === 'p2'; }) && el(dvE3.r.merged, 'p2', 'p2_a').text === 'my edit', ids(dvE3.r.merged.pages));
var dvF = three(function (b) { el(b, 'p3', 'p3_s').shape.fill = '#f00'; }, function (b) { pg(b, 'p3').elements.pop(); });
check('2.21 the same for a frame: theirs deleted a frame mine changed — dropped silently', pg(dvF.r.merged, 'p3').elements.some(function (e) { return e.id === 'p3_s'; }) || dvF.r.conflicts.length > 0, ids(pg(dvF.r.merged, 'p3').elements));
var dvF2 = three(function (b) { pg(b, 'p3').elements.pop(); }, function (b) { el(b, 'p3', 'p3_s').shape.fill = '#f00'; });
check('2.22 mine deleted a frame theirs changed: the frame stays', pg(dvF2.r.merged, 'p3').elements.some(function (e) { return e.id === 'p3_s' && e.shape.fill === '#f00'; }));
var addFrames = three(function (b) { pg(b, 'p4').elements.push(text('p4_m', 'mine')); }, function (b) { pg(b, 'p4').elements.push(text('p4_t2', 'theirs')); });
check('2.23 frames added to one page on both sides: both', ids(pg(addFrames.r.merged, 'p4').elements) === 'p4_t,p4_t2,p4_m' || ids(pg(addFrames.r.merged, 'p4').elements) === 'p4_t,p4_m,p4_t2', ids(pg(addFrames.r.merged, 'p4').elements));

var ms = three(function (b) { b.contentSections[0].body = 'Mine intro.'; b.contentSections.push({ id: 's3', title: 'Three', kind: 'body', body: 'Mine new.', orderIndex: 2 }); },
  function (b) { b.contentSections[1].body = 'Their second.'; });
check('2.24 the manuscript: sections edited and added on both sides, item by item', ms.r.conflicts.length === 0 && ids(ms.r.merged.contentSections) === 's1,s2,s3' &&
  ms.r.merged.contentSections[0].body === 'Mine intro.' && ms.r.merged.contentSections[1].body === 'Their second.', ms.r.merged.contentSections);
var msC = three(function (b) { b.contentSections[0].body = 'Mine.'; }, function (b) { b.contentSections[0].body = 'Theirs.'; });
check('2.25 …the same section changed differently: a conflict naming it', msC.r.conflicts.length === 1 && msC.r.conflicts[0].kind === 'contentSections' && msC.r.conflicts[0].itemId === 's1' &&
  msC.r.conflicts[0].label === 'Manuscript section "Intro"' && msC.r.merged.contentSections[0].body === 'Theirs.', msC.r.conflicts);
var msD = three(function (b) { b.contentSections.shift(); }, function (b) { b.contentSections.push({ id: 's9', title: 'Nine', kind: 'body', body: 'x', orderIndex: 9 }); });
check('2.26 …one side deletes a section, the other adds one: both', ids(msD.r.merged.contentSections) === 's2,s9', ids(msD.r.merged.contentSections));
var ph = three(function (b) { b.imageAssets.push({ id: 'a3', name: 'three.jpg', url: '/3.jpg' }); }, function (b) { b.imageAssets.push({ id: 'a4', name: 'four.jpg', url: '/4.jpg' }); b.imageAssets.splice(0, 1); });
check('2.27 the photo list: photos added on both sides (mine after the one it followed), one removed on one side', ph.r.conflicts.length === 0 && ids(ph.r.merged.imageAssets) === 'a2,a3,a4', ids(ph.r.merged.imageAssets));
var phC = three(function (b) { b.imageAssets[0].name = 'mine.jpg'; }, function (b) { b.imageAssets[0].name = 'theirs.jpg'; });
check('2.28 …the same photo changed differently: a conflict naming it', phC.r.conflicts.length === 1 && phC.r.conflicts[0].kind === 'imageAssets' && phC.r.conflicts[0].label === 'Photo "mine.jpg"', phC.r.conflicts);
var mpC = three(function (b) { b.masterPages[0].name = 'Mine'; }, function (b) { b.masterPages[0].name = 'Theirs'; });
check('2.29 a master page changed differently: a conflict naming it', mpC.r.conflicts.length === 1 && mpC.r.conflicts[0].kind === 'masterPages' && /^Master page "/.test(mpC.r.conflicts[0].label), mpC.r.conflicts);
var bk = three(function (b) { b.name = 'Mine'; }, function (b) { b.name = 'Theirs'; });
check('2.30 the book\'s own field changed differently: a book conflict', bk.r.conflicts.length === 1 && bk.r.conflicts[0].kind === 'book' && bk.r.conflicts[0].field === 'name' && bk.r.merged.name === 'Theirs', bk.r.conflicts);
var pc = three(function (b) { pg(b, 'p2').label = 'Mine'; }, function (b) { pg(b, 'p2').label = 'Theirs'; });
check('2.31 a page\'s field changed differently: a page conflict', pc.r.conflicts.length === 1 && pc.r.conflicts[0].kind === 'page' && pc.r.conflicts[0].pageId === 'p2' && pc.r.conflicts[0].field === 'label', pc.r.conflicts);
var stamp = three(function (b) { b.updatedAt = '2026-11-27T10:00:00Z'; el(b, 'p2', 'p2_a').text = 'mine'; }, function (b) { b.updatedAt = '2026-11-27T10:00:05Z'; el(b, 'p2', 'p2_b').text = 'theirs'; });
check('2.32 the save time (updatedAt, which the editor sets on every change) raises a conflict "The book\'s updatedAt" whenever two saves cross — it should be taken from theirs without asking',
  stamp.r.conflicts.length === 0, stamp.r.conflicts.map(function (c) { return c.label; }));

/* resolving */
var all = three(function (b) { b.name = 'Mine'; pg(b, 'p2').label = 'Mine'; el(b, 'p2', 'p2_a').text = 'Mine'; b.contentSections[0].body = 'Mine.'; b.imageAssets[0].name = 'mine.jpg'; b.masterPages[0].name = 'Mine'; },
  function (b) { b.name = 'Theirs'; pg(b, 'p2').label = 'Theirs'; el(b, 'p2', 'p2_a').text = 'Theirs'; b.contentSections[0].body = 'Theirs.'; b.imageAssets[0].name = 'theirs.jpg'; b.masterPages[0].name = 'Theirs'; });
check('2.33 six conflicts, one of each kind, ids c1…c6', all.r.conflicts.length === 6 && all.r.conflicts.map(function (c) { return c.id; }).join() === 'c1,c2,c3,c4,c5,c6' &&
  all.r.conflicts.map(function (c) { return c.kind; }).sort().join() === 'book,contentSections,frame,imageAssets,masterPages,page', all.r.conflicts.map(function (c) { return c.kind; }));
var choices = {}; all.r.conflicts.forEach(function (c) { choices[c.id] = 'mine'; });
var mergedBefore = JSON.stringify(all.r.merged);
var resolved = BR.resolveConflicts(all.r.merged, all.r.conflicts, choices);
check('2.34 resolveConflicts: "mine" for each kind puts mine in', resolved.name === 'Mine' && pg(resolved, 'p2').label === 'Mine' && el(resolved, 'p2', 'p2_a').text === 'Mine' &&
  resolved.contentSections[0].body === 'Mine.' && resolved.imageAssets[0].name === 'mine.jpg' && resolved.masterPages[0].name === 'Mine', resolved);
check('2.35 …and leaves what it was given as it was', JSON.stringify(all.r.merged) === mergedBefore);
var theirsAll = BR.resolveConflicts(all.r.merged, all.r.conflicts, {});
check('2.36 no choice (or "theirs"): theirs everywhere', theirsAll.name === 'Theirs' && el(theirsAll, 'p2', 'p2_a').text === 'Theirs' && theirsAll.imageAssets[0].name === 'theirs.jpg');
var pickOne = {}; pickOne[all.r.conflicts.filter(function (c) { return c.kind === 'frame'; })[0].id] = 'mine';
var mixedPick = BR.resolveConflicts(all.r.merged, all.r.conflicts, pickOne);
check('2.37 a choice per conflict: mine for the text only', el(mixedPick, 'p2', 'p2_a').text === 'Mine' && mixedPick.name === 'Theirs' && pg(mixedPick, 'p2').label === 'Theirs');
check('2.38 a resolved merge has no design change a Content editor made against theirs (text only)', BR.designChanges(BR.resolveConflicts(tx.r.merged, tx.r.conflicts, { c1: 'mine' }), tx.r.merged).length === 0);

process.stdout.write('book-rules: ' + passed + ' passed, ' + failed + ' failed' + (known.length ? ', ' + known.length + ' known bug(s) in book-rules.js (listed above)' : '') + '\n');
process.exit(failed ? 1 : 0);
