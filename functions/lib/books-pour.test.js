// node functions/lib/books-pour.test.js — Books Phase 3, the content workflow's own logic (books-app/src/engines/
// pourEngine.ts), bundled in memory with the editor's esbuild and run with a stand-in for the real-font fit (each test
// frame holds as many words as its height in mm). It checks the pour of a manuscript into the book's frames: reading
// order (page order; top to bottom, then left to right), kinds matched, the rest carried into the next frame, frames
// with real words never written over unless asked (template words and "Lorem ipsum" count as empty), pages added from
// a layout of the book when the frames run out — which the shared rules (lib/book-rules.js) accept from a Content
// editor — and that no word is lost: every word is either on a page or counted as left over. Also the layouts a new
// page is made from, the word counts, and the photo resolution maths.
// No network, no database, no AI. Exits 1 on any failure.
'use strict';
var path = require('path'), Module = require('module');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 900) : '') + '\n'); }
var ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'books-app');
var esbuild = require(path.join(APP, 'node_modules', 'esbuild'));
var rules = require('./book-rules');

function load(rel) {
  var file = path.join(APP, 'src', rel);
  var out = esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node18', jsx: 'automatic',
    logLevel: 'silent', external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react'] });
  var m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(out.outputFiles[0].text, file);
  return m.exports;
}
var P = load('engines/pourEngine.ts');

/* the stand-in for textEngine.fitTextToFrame: a frame holds heightMm words */
var fitCalls = 0;
function fakeFit(el, text) {
  fitCalls++;
  var cap = el.heightMm, re = /\S+/g, m, n = 0, end = 0;
  while ((m = re.exec(text))) { n++; if (n <= cap) end = m.index + m[0].length; }
  if (n <= cap) return { fits: true, fittingText: text, rest: '', overflowWords: 0 };
  return { fits: false, fittingText: text.slice(0, end), rest: text.slice(end).trim(), overflowWords: n - cap };
}
function words(n, tag) { var a = []; for (var i = 1; i <= n; i++) a.push(tag + i); return a.join(' '); }
function W(t) { return String(t || '').trim() ? String(t).trim().split(/\s+/) : []; }

var style = { fontFamily: 'Lora', fontSizePt: 10, fontWeight: 400, color: '#1C1917', lineHeight: 1.4, letterSpacingEm: 0, textAlign: 'left', verticalAlign: 'top',
  paragraphSpacingMm: 2, columns: 1, columnGapMm: 5, insetMm: 0 };
function frame(id, role, x, y, cap, text, extra) {
  return Object.assign({ id: id, name: id, type: 'text', xMm: x, yMm: y, widthMm: 80, heightMm: cap, rotation: 0, opacity: 1, locked: false, hidden: false,
    zIndex: 2, textRole: role, text: text, textStyle: style }, extra || {});
}
function photo(id, x, y, w, h, nw, nh, zoom) {
  return { id: id, name: id, type: 'image', xMm: x, yMm: y, widthMm: w, heightMm: h, rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 1,
    image: { src: '/p/' + id + '.jpg', assetId: 'a_' + id, alt: id, fit: 'cover', zoom: zoom || 1, focalX: 50, focalY: 50, naturalWidth: nw, naturalHeight: nh } };
}
function makeBook() {
  var master = { id: 'mp1', name: 'A — Text page', role: 'editorial_text', description: '', backgroundColor: '#F7F5F0', elements: [
    { id: 'm_hdr', name: 'Running Header', type: 'header', xMm: 18, yMm: 8, widthMm: 160, heightMm: 6, rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 8,
      textRole: 'running_head', text: 'THE BOOK', textStyle: style },
    frame('m_head', 'heading', 18, 20, 6, 'Master heading words'),
    frame('m_body', 'body', 18, 40, 50, 'Master body sample copy'),
  ] };
  return {
    id: 'b1', name: 'Test book', subtitle: '', category: '', status: 'draft', unit: 'mm', coverThumbnail: '',
    dimensions: { widthMm: 210, heightMm: 270 }, designSystem: { name: 'DS', sourceTemplateName: 'Test template' }, masterPages: [master],
    printSettings: {}, customDimensionPresets: [], imageAssets: [], createdAt: '1', updatedAt: '1',
    chapters: [{ id: 'ch1', number: 1, title: 'One', orderIndex: 0 }, { id: 'ch2', number: 2, title: 'Two', orderIndex: 1 }],
    contentSections: [
      { id: 's1', title: 'Chapter one', kind: 'heading', body: 'Chapter One', orderIndex: 0 },
      { id: 's2', title: 'Opening', kind: 'body', body: words(25, 'a'), orderIndex: 1 },
      { id: 's3', title: 'Second paragraph', kind: 'body', body: words(20, 'b'), orderIndex: 2 },
      { id: 's4', title: 'Plate caption', kind: 'caption', body: words(6, 'c'), orderIndex: 3 },
      { id: 's5', title: 'Pull quote', kind: 'quote', body: words(8, 'q'), orderIndex: 4 },
      { id: 's6', title: 'Chapter two', kind: 'heading', body: 'Chapter Two', orderIndex: 5 },
      { id: 's7', title: 'Long essay', kind: 'body', body: words(60, 'd'), orderIndex: 6 },
      { id: 's8', title: 'Coda', kind: 'body', body: words(10, 'e'), orderIndex: 7 },
    ],
    pages: [
      { id: 'p1', orderIndex: 0, label: 'Cover', role: 'front_cover', backgroundColor: '#111111', elements: [frame('p1_title', 'display', 20, 60, 6, 'Test template title')] },
      { id: 'p2', orderIndex: 1, label: 'Opening', role: 'editorial_text', chapterId: 'ch1', masterPageId: 'mp1', backgroundColor: '#F7F5F0', elements: [
        frame('p2_bodyR', 'body', 110, 41, 30, ''),                // same row as the left column (within 3 mm): read after it
        frame('p2_head', 'heading', 20, 20, 6, ''),
        frame('p2_bodyL', 'body', 20, 40, 30, ''),
        frame('p2_cap', 'caption', 20, 10, 10, ''),                // above everything: a caption still goes here
        frame('p2_quote', 'quote', 20, 200, 20, 'A real quote someone wrote here'),
        frame('p2_hidden', 'body', 20, 230, 40, '', { hidden: true }),
        photo('p2_img', 20, 120, 150, 70, 2400, 1600),
      ] },
      { id: 'p3', orderIndex: 2, label: 'Second', role: 'editorial_text', chapterId: 'ch2', masterPageId: 'mp1', backgroundColor: '#F7F5F0', elements: [
        frame('p3_head', 'heading', 20, 20, 6, 'Section Heading', { masterElementId: 'm_head' }), // the editor's own new-frame words: empty
        frame('p3_body', 'body', 20, 40, 40, 'Lorem ipsum dolor sit amet'), // sample words: empty
        frame('p3_quote', 'quote', 20, 200, 20, ''),
      ] },
      { id: 'p4', orderIndex: 3, label: 'Back cover', role: 'back_cover', backgroundColor: '#111111', elements: [
        frame('p4_blurb', 'body', 20, 40, 40, 'A real back cover blurb by the author'),
      ] },
    ],
  };
}
function el(book, id) { for (var i = 0; i < book.pages.length; i++) for (var j = 0; j < book.pages[i].elements.length; j++) if (book.pages[i].elements[j].id === id) return book.pages[i].elements[j]; return null; }
function sec(book, id) { return book.contentSections.filter(function (s) { return s.id === id; })[0]; }
var ALL = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

/* ---------- 1 reading order, kinds, carrying over, stopping ---------- */
(function () {
  var book = makeBook(), before = JSON.stringify(book);
  var ph = P.collectPlaceholderTexts(book);
  var plan = P.planPour(book, { sectionIds: ALL, startPageId: 'p2', fit: fakeFit, placeholders: ph });
  var out = plan.project;
  check('1.1 the book handed in is not changed (the plan is a new book)', JSON.stringify(book) === before);
  check('1.2 a heading goes to the heading frame', el(out, 'p2_head').text === 'Chapter One' && el(out, 'p2_head').contentSectionId === 's1');
  var L = W(el(out, 'p2_bodyL').text), R = W(el(out, 'p2_bodyR').text);
  check('1.3 body text fills the left column first (reading order: top to bottom, then left to right), only as far as it fits; two body sections share a frame with a paragraph break',
    L.length === 30 && L.slice(0, 25).join(' ') === words(25, 'a') && L.slice(25).join(' ') === words(5, 'b') && /a25\n\nb1/.test(el(out, 'p2_bodyL').text), L.length);
  check('1.4 …and the rest is carried into the next body frame', R.join(' ') === 'b6 b7 b8 b9 b10 b11 b12 b13 b14 b15 b16 b17 b18 b19 b20' && el(out, 'p2_bodyR').contentSectionId === 's3', R);
  check('1.5 a caption goes to the caption frame of the page the text is on, wherever it sits on it', el(out, 'p2_cap').text === words(6, 'c'));
  check('1.6 a frame with real words is never written over; the quote goes to the next page\'s quote frame', el(out, 'p2_quote').text === 'A real quote someone wrote here' &&
    el(out, 'p3_quote').text === words(8, 'q') && el(out, 'p3_quote').contentSectionId === 's5');
  check('1.7 template words count as empty: the next heading goes into the frame still saying "Section Heading"', el(out, 'p3_head').text === 'Chapter Two');
  check('1.8 hidden frames are never filled', el(out, 'p2_hidden').text === '');
  check('1.9 when the frames run out and no layout is chosen, the pour stops: the long section is placed whole or not at all (the "Lorem ipsum" frame keeps its words), and what follows is kept back',
    el(out, 'p3_body').text === 'Lorem ipsum dolor sit amet' && el(out, 'p4_blurb').text === 'A real back cover blurb by the author' &&
    plan.leftovers.map(function (l) { return l.sectionId; }).join() === 's7,s8' && plan.wordsLeftOver === 70 &&
    /ran out/.test(plan.leftovers[0].why) && /kept back/.test(plan.leftovers[1].why), plan.leftovers);
  check('1.10 placed sections are marked with where they start (s3 starts in the left column); the rest stay unplaced',
    sec(out, 's2').assignedElementId === 'p2_bodyL' && sec(out, 's3').assignedElementId === 'p2_bodyL' && sec(out, 's3').assignedPageId === 'p2' &&
    sec(out, 's5').assignedPageId === 'p3' && !sec(out, 's7').assignedPageId && !sec(out, 's8').assignedPageId);
  check('1.11 the preview sentence', plan.summary === '6 sections into 6 frames on pages 2–3; no pages added; 70 words left over', plan.summary);
  check('1.12 the frames that already have words are counted for the preview', plan.framesKeptWithWords === 2, plan.framesKeptWithWords);
  var why = rules.designChanges(book, out);
  check('1.13 by the shared rules the pour is content only: no frame moved, resized or restyled', why.length === 0, why);
  /* every word is on a page or left over: the flow frames in reading order hold the placed sections' words in order */
  var flowText = ['p2_head', 'p2_bodyL', 'p2_bodyR', 'p3_head'].map(function (id) { return el(out, id).text; }).join(' ');
  var expected = ['s1', 's2', 's3', 's6'].map(function (id) { return sec(book, id).body; }).join(' ');
  var allSel = ALL.reduce(function (a, id) { return a + W(sec(book, id).body).length; }, 0);
  check('1.14 nothing is lost: the words on the pages are the sections\' words in order, and placed + left over = all selected',
    W(flowText).join(' ') === W(expected).join(' ') && plan.wordsPlaced + plan.wordsLeftOver === allSel &&
    ALL.every(function (id) { return sec(out, id).body === sec(book, id).body; }), { placed: plan.wordsPlaced, left: plan.wordsLeftOver, all: allSel });
})();

/* ---------- 2 pages added from a layout ---------- */
(function () {
  var book = makeBook(), ph = P.collectPlaceholderTexts(book), n = 0;
  var plan = P.planPour(book, { sectionIds: ALL, startPageId: 'p2', fit: fakeFit, placeholders: ph, addPagesFrom: 'master:mp1', newId: function (p) { return 'new_' + p + '_' + (++n); } });
  var out = plan.project;
  check('2.1 with a layout chosen, the long section first fills the book\'s free frame, then reads on into pages added after the last page used (before the back cover)',
    W(el(out, 'p3_body').text).join(' ') === words(40, 'd') && plan.pagesAdded === 1 && out.pages.length === 5 &&
    out.pages[3].masterPageId === 'mp1' && out.pages[4].id === 'p4' && plan.addedAfterPageNumber === 3, out.pages.map(function (p) { return p.id; }));
  var added = out.pages[3], body = added.elements.filter(function (e) { return e.textRole === 'body'; })[0];
  check('2.2 …where the rest of it and the next section share the new page\'s body frame', W(body.text).join(' ') === (words(20, 'd').replace(/d(\d+)/g, function (m, k) { return 'd' + (Number(k) + 40); }) + ' ' + words(10, 'e')) &&
    body.contentSectionId === 's7' && sec(out, 's8').assignedPageId === added.id, body.text);
  var head = added.elements.filter(function (e) { return e.textRole === 'heading'; })[0], hdr = added.elements.filter(function (e) { return e.type === 'header'; })[0];
  check('2.3 an added page keeps every frame of its layout; a text frame the pour did not fill is left empty (no sample words print); its running head stays',
    added.elements.length === 3 && head.text === '' && hdr.text === 'THE BOOK' && added.label === 'Page 4' && added.chapterId === 'ch2');
  check('2.4 nothing left over, and the sentence says the page is added', plan.wordsLeftOver === 0 && plan.leftovers.length === 0 &&
    plan.summary === '8 sections into 8 frames on pages 2–4; 1 page will be added; 0 words left over', plan.summary);
  var why = rules.designChanges(book, out);
  check('2.5 by the shared rules, a pour that adds pages from a master page is still content only (a Content editor may apply it)', why.length === 0, why);
  var copyPlan = P.planPour(book, { sectionIds: ALL, startPageId: 'p2', fit: fakeFit, placeholders: ph, addPagesFrom: 'page:p3' });
  var why2 = rules.designChanges(book, copyPlan.project);
  check('2.6 …and so is one that adds copies of a page', why2.length === 0 && copyPlan.pagesAdded === 1 && copyPlan.wordsLeftOver === 0 &&
    copyPlan.project.pages[3].elements.filter(function (e) { return e.textRole === 'quote'; })[0].text === '', { why: why2, added: copyPlan.pagesAdded, left: copyPlan.leftovers });
  var tiny = makeBook();
  tiny.masterPages[0].elements[2].heightMm = 0;
  var plan3 = P.planPour(tiny, { sectionIds: ALL, startPageId: 'p2', fit: fakeFit, placeholders: P.collectPlaceholderTexts(tiny), addPagesFrom: 'master:mp1' });
  check('2.7 a layout whose body frame holds no word adds no pages and says why', plan3.pagesAdded === 0 && plan3.leftovers.length === 2 && /too small/.test(plan3.leftovers[0].why) &&
    el(plan3.project, 'p3_body').text === 'Lorem ipsum dolor sit amet', plan3.leftovers);
  var cap = P.planPour(book, { sectionIds: ['s7'], startPageId: 'p4', fit: fakeFit, placeholders: ph, addPagesFrom: 'master:mp1', maxAddedPages: 1 });
  check('2.8 the pour adds at most the pages it is allowed, and says so', cap.pagesAdded === 0 && /stops at 1 added page/.test((cap.leftovers[0] || {}).why), cap.leftovers);
  var designer = P.planPour(book, { sectionIds: ALL, startPageId: 'p2', fit: fakeFit, placeholders: ph, markOverridden: true });
  var why4 = rules.designChanges(book, designer.project);
  check('2.9 a Designer\'s pour marks a master page\'s frame as changed on its page (as typing does); a Content editor\'s never does, because that is the design',
    why4.length === 1 && /master link/.test(why4[0]) && el(designer.project, 'p3_head').overriddenFromMaster === true &&
    el(P.planPour(book, { sectionIds: ALL, startPageId: 'p2', fit: fakeFit, placeholders: ph }).project, 'p3_head').overriddenFromMaster === undefined, why4);
})();

/* ---------- 3 replacing, starting page, choosing sections ---------- */
(function () {
  var book = makeBook(), ph = P.collectPlaceholderTexts(book);
  var plan = P.planPour(book, { sectionIds: ['s5'], startPageId: 'p2', fit: fakeFit, placeholders: ph, replaceExisting: true });
  check('3.1 "Replace text in frames that already have words" writes over a frame with real words', el(plan.project, 'p2_quote').text === words(8, 'q'));
  var cover = P.planPour(book, { sectionIds: ['s1'], startPageId: 'p1', fit: fakeFit, placeholders: P.collectPlaceholderTexts(book, [{ name: 'Test template', buildPages: function () { return makeBook().pages; } }]) });
  check('3.2 the words the book\'s template put in a frame count as empty (the cover title of the template the book was made from)', el(cover.project, 'p1_title').text === 'Chapter One');
  var noTpl = P.planPour(book, { sectionIds: ['s1'], startPageId: 'p1', fit: fakeFit, placeholders: ph });
  var labels = P.collectPlaceholderTexts(book, [{ name: 'Test template', buildPages: function () { return [{ elements: [{ text: 'Contents' }, { text: 'Plate one caption words' }] }]; } }]);
  check('3.2b …except a template\'s one-word labels ("Contents"): they are the book\'s structure, not sample copy',
    !P.isPlaceholderText('Contents', labels) && P.isPlaceholderText('Plate one caption words', labels) && P.isPlaceholderText('Section Heading', labels));
  check('3.3 …but a title someone wrote is kept (the pour starts on page 1 and passes it by)', el(noTpl.project, 'p1_title').text === 'Test template title' && el(noTpl.project, 'p2_head').text === 'Chapter One');
  var order = P.planPour(book, { sectionIds: ['s3', 's2'], startPageId: 'p2', fit: fakeFit, placeholders: ph });
  check('3.4 sections go in manuscript order whatever order they were chosen in', W(el(order.project, 'p2_bodyL').text)[0] === 'a1');
  var placed = P.planPour(book, { sectionIds: ALL, startPageId: 'p2', fit: fakeFit, placeholders: ph }).project;
  var again = P.sectionsNotPlaced(placed).map(function (s) { return s.id; });
  check('3.5 after a pour, "not yet placed" is what was left over (the default choice for the next pour)', again.join() === 's7,s8', again);
  var replaced = P.planPour(placed, { sectionIds: ['s8'], startPageId: 'p2', fit: fakeFit, placeholders: ph, replaceExisting: true });
  check('3.6 a section whose only frame is written over is no longer marked as placed; one still in another frame is marked there',
    sec(replaced.project, 's8').assignedElementId === 'p2_bodyL' && !sec(replaced.project, 's2').assignedPageId && sec(replaced.project, 's3').assignedElementId === 'p2_bodyR' &&
    W(el(replaced.project, 'p2_bodyL').text).join(' ') === words(10, 'e'), { s2: sec(replaced.project, 's2'), s3: sec(replaced.project, 's3') });
  check('3.7 placeholder words: empty, "Lorem ipsum", the editor\'s new-frame words and the master page\'s are empty; a person\'s words are not',
    P.isPlaceholderText('', ph) && P.isPlaceholderText('  Lorem ipsum dolor sit amet ', ph) && P.isPlaceholderText('Section Heading', ph) &&
    P.isPlaceholderText('Master body sample copy', ph) && !P.isPlaceholderText('A real quote someone wrote here', ph));
  check('3.8 reading order: rows within 3 mm read left to right, then the next row', P.readingOrder([{ id: 'c', xMm: 10, yMm: 50 }, { id: 'b', xMm: 100, yMm: 12 }, { id: 'a', xMm: 10, yMm: 10 }])
    .map(function (x) { return x.id; }).join('') === 'abc');
})();

/* ---------- 4 a new page's layout ---------- */
(function () {
  var book = makeBook();
  var choices = P.pageLayoutChoices(book, book.pages[2], { includeBlank: true });
  check('4.1 the choices: each master page by name, a copy of the current page, and (Designers) an empty page like it',
    choices.map(function (c) { return c.id; }).join() === 'master:mp1,page:p3,blank:p3' && choices[0].label === 'A — Text page' && /A copy of page 3/.test(choices[1].label));
  check('4.2 Content editors are not offered the empty page', P.pageLayoutChoices(book, book.pages[2]).length === 2);
  var n = 0, id = function (p) { return 'x_' + p + '_' + (++n); };
  ['master:mp1', 'page:p3', 'page:p2', 'blank:p3'].forEach(function (choice) {
    var page = P.pageFromLayout(book, choice, { label: 'Page 3', newId: id });
    var after = P.insertPagesAfter(book, 'p2', [page]);
    var why = rules.designChanges(book, after);
    check('4.3 a page made from "' + choice + '" is accepted from a Content editor by the shared rules, with new frame ids', why.length === 0 && page.elements.every(function (e) { return /^x_el_/.test(e.id); }) &&
      after.pages[2].id === page.id && after.pages.every(function (p, i) { return p.orderIndex === i; }), why);
  });
  var mp = P.pageFromLayout(book, 'master:mp1', { newId: id }), cp = P.pageFromLayout(book, 'page:p2', { newId: id });
  check('4.4 from a master page the words are kept as the master has them; a copy of a page leaves its words and photos out, its running heads stay',
    mp.elements[1].text === 'Master heading words' && mp.elements.every(function (e) { return e.masterElementId; }) &&
    cp.elements.filter(function (e) { return e.type === 'text'; }).every(function (e) { return e.text === '' && !e.contentSectionId; }) &&
    cp.elements.filter(function (e) { return e.type === 'image'; })[0].image.src === '');
  var moved = P.pageFromLayout(book, 'page:p3', { newId: id });
  moved.elements[0].xMm += 5;
  check('4.5 …and a page whose frame was moved is refused (the rules still guard the layouts)', rules.designChanges(book, P.insertPagesAfter(book, 'p3', [moved])).length === 1);
  var two = makeBook();
  two.masterPages.unshift({ id: 'mp0', name: 'Z — Folio only', role: 'blank', description: '', backgroundColor: '#FFFFFF', elements: [JSON.parse(JSON.stringify(two.masterPages[0].elements[0]))] });
  var offered = P.pageLayoutChoices(two, two.pages[2]);
  check('4.6 the layout first offered for a pour\'s added pages has the frames the words need (not a master page with no text frame)',
    P.suggestedLayout(two, offered, ['body']) === 'master:mp1' && P.suggestedLayout(two, offered, ['quote']) === 'page:p3' &&
    P.layoutKinds(two, 'master:mp0').size === 0 && /none for text/.test(offered[0].detail), offered.map(function (o) { return o.id + ' ' + o.detail; }));
})();

/* ---------- 5 word counts ---------- */
(function () {
  var book = makeBook();
  var measure = function (e) { var n = W(e.text).length; return { isOverflowing: n > e.heightMm, overflowWords: Math.max(0, n - e.heightMm) }; };
  book.pages[3].elements[0].heightMm = 3;
  var c = P.editorialCounts(book, measure, P.collectPlaceholderTexts(book));
  var visible = 0, chars = 0;
  book.pages.forEach(function (p) { p.elements.forEach(function (e) { if (e.type === 'text' && !e.hidden) { visible += W(e.text).length; chars += (e.text || '').length; } }); });
  check('5.1 words and characters per page add up to the book\'s total (hidden frames left out)', c.totalWords === visible && c.totalCharacters === chars &&
    c.pages.reduce(function (a, p) { return a + p.words; }, 0) === visible, { total: c.totalWords, visible: visible });
  check('5.2 spreads: the cover alone, then facing pairs', c.spreads.map(function (s) { return s.label; }).join('|') === 'Page 1 (cover)|Pages 2–3|Page 4');
  check('5.3 chapters, with the pages in no chapter on their own line', c.chapters.map(function (r) { return r.label + ':' + r.pageCount; }).join('|') === 'One:1|Two:1|Not in a chapter:2');
  check('5.4 text that doesn\'t fit, empty frames and frames with sample words are listed with their page', c.overflowing.length === 1 && c.overflowing[0].elementId === 'p4_blurb' &&
    c.overflowing[0].overflowWords === 5 && c.empty.map(function (r) { return r.elementId; }).join() === 'p2_cap,p2_head,p2_bodyL,p2_bodyR,p3_quote' &&
    c.sample.map(function (r) { return r.elementId; }).join() === 'p3_head,p3_body', { o: c.overflowing, e: c.empty, s: c.sample });
  check('5.5 the manuscript not on any page', c.notPlaced.length === 8 && c.sectionsPlaced === 0);
})();

/* ---------- 6 photo resolution ---------- */
(function () {
  var R = load('components/PhotoResolutionBadge.tsx');
  var at = function (w, h, nw, nh, zoom) { return R.photoPrintResolution(photo('x', 0, 0, w, h, nw, nh, zoom)); };
  var a = at(254, 254, 3000, 3000), b = at(254, 127, 3000, 3000, 2), c = at(254, 254, 1000, 1000);
  check('6.1 effective resolution: the photo\'s pixels over the frame\'s print size in inches (the smaller side, as the print check does), lower when zoomed in',
    Math.round(a.ppi) === 300 && Math.round(b.ppi) === 150 && Math.round(c.ppi) === 100, [a.ppi, b.ppi, c.ppi]);
  check('6.2 under 150: too low; 150–250: low; 300 and more: fine', R.printQuality(149).level === 'too_low' && R.printQuality(150).level === 'low' &&
    R.printQuality(249).level === 'low' && R.printQuality(300).level === 'good' && /Too low for print/.test(R.printQuality(100).label) && /Low for print/.test(R.printQuality(200).label));
  check('6.3 a frame with no photo, or no pixel size, has no resolution', R.photoPrintResolution({ type: 'image', widthMm: 10, heightMm: 10, image: { src: '' } }) === null);
})();

process.stdout.write('books-pour: ' + passed + ' passed, ' + failed + ' failed (' + fitCalls + ' fits measured)\n');
process.exit(failed ? 1 : 0);
