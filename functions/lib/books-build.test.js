// node functions/lib/books-build.test.js — the Books editor (books-app/, built into books/ by books-app/build.mjs): the
// committed build matches its source (books/build.json's hash), it is a script a browser can run, and the rules Phase 1
// set for the editor's code hold (docs/bookstudio/PLAN.md): it talks only to EventSphere's server, through the page's
// sign-in; nothing of the AI Studio export's Firebase client or open server came along; exports draw each photo's
// full-size copy; no made-up source line is written under an infographic; the sample photos exist with their true sizes.
// Phase 2 (roles, section 4): the editor takes in the shared rules (functions/lib/book-rules.js) and never sends a
// Content editor's design change; the design's controls are not offered to a Content editor; a save that crossed
// someone else's is merged (a dialog for what both changed); who else is here; deleted pages; the activity log.
// Phase 3 (the content workflow, section 5): word counts beside the canvas, never exported; "Pour manuscript into
// frames" from the Content manager, previewed and applied as one change; a new page's layout chosen in a picker; photo
// resolution in the Images tab. The pour's own logic is tested in functions/lib/books-pour.test.js.
// Phase 4 (export, section 6): the export dialog around the vector PDF (print-ready and review), the pre-export check
// as the print-ready PDF's gate, progress with Cancel, the summary; page and spread images drawn from textEngine's
// layout; the word counts drawer, the pour's one-word template words, the "Also here" chips and the fitted zoom.
// The gate's own logic is tested in functions/lib/books-export.test.js.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 600) : '') + '\n'); }
var ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'books-app'), OUT = path.join(ROOT, 'books');
function read(p) { return fs.readFileSync(p, 'utf8'); }
function walk(dir) { return fs.readdirSync(dir).sort().reduce(function (a, n) { var p = path.join(dir, n); return a.concat(fs.statSync(p).isDirectory() ? walk(p) : [p]); }, []); }

/* ---------- 1 the build ---------- */
var built = JSON.parse(read(path.join(OUT, 'build.json')));
var now = require(path.join(APP, 'source-hash.cjs')).sourceHash(APP);
check('1.1 books/ was built from the source as it is now (run `npm run build` in books-app/ after a change)', built.sourceHash === now, { built: built.sourceHash, source: now });
var js = read(path.join(OUT, 'app.js'));
var parses = (function () { try { new vm.Script(js, { filename: 'books/app.js' }); return true; } catch (e) { return e.message; } })();
check('1.2 books/app.js is one script a browser can run', parses === true, parses);
check('1.3 …and it carries no secret, key or Firebase project of the AI Studio export', !/AIza[0-9A-Za-z_-]{20,}/.test(js) && !/gen-lang-client-/.test(js) && !/GEMINI_API_KEY|ANTHROPIC_API_KEY/.test(js));
check('1.4 books/app.css holds the editor\'s styles', /\.bg-\\\[\#121214\\\]/.test(read(path.join(OUT, 'app.css'))) || /#121214/.test(read(path.join(OUT, 'app.css'))));

/* ---------- 2 the editor's code ---------- */
var files = walk(path.join(APP, 'src')).filter(function (f) { return /\.(ts|tsx)$/.test(f); });
var all = files.map(function (f) { return { f: path.relative(APP, f), s: read(f) }; });
var fb = all.filter(function (x) { return /from ['"]firebase/.test(x.s); }).map(function (x) { return x.f; });
check('2.1 no Firebase client in the editor: sign-in is the page\'s (auth.js)', fb.length === 0, fb);
var direct = all.filter(function (x) { return x.f !== 'src/services/api.ts' && /fetch\(\s*['"`]\/api\//.test(x.s); }).map(function (x) { return x.f; });
check('2.2 every call to the server goes through services/api.ts (the page\'s authedFetch)', direct.length === 0, direct);
var API = read(path.join(APP, 'src', 'services', 'api.ts'));
check('2.3 …which sends it with the sign-in, to /api/books', /window\.RevampAuth/.test(API) && /authedFetch\(BASE \+ path/.test(API) && /const BASE = '\/api\/books';/.test(API));
check('2.4 the AI Studio export\'s endpoints are gone', !all.some(function (x) { return /\/api\/(uploads|storage|fonts\/google|ai\/)/.test(x.s); }));
var EXP = read(path.join(APP, 'src', 'engines', 'exportEngine.ts'));
check('2.5 exports draw an uploaded photo\'s full-size copy', /loadImageElement\(printSourceOf\(el\.image\.src\)\)/.test(EXP) && /\/display\$\/, '\$1\/print'\)/.test(EXP));
check('2.6 no made-up source line under an infographic', !all.some(function (x) { return /Generated in BOOKSTUDIO/.test(x.s); }));
var STORE = read(path.join(APP, 'src', 'services', 'storageService.ts'));
check('2.7 a save names the revision it was based on, one save at a time per book', /apiSend<\{ rev: number \}>\('PUT', '\/book', \{ book: project, baseRev \}\)/.test(STORE) && /if \(running\) return running;/.test(STORE));
var APPX = read(path.join(APP, 'src', 'App.tsx'));
check('2.8 the hidden sample book is never saved, never edited', /if \(proj\.id === PLACEHOLDER_ID\) return true;/.test(APPX) && /if \(!current \|\| current\.id === PLACEHOLDER_ID\) return prevList;/.test(APPX));
var MERGE = read(path.join(APP, 'src', 'components', 'MergeConflictsModal.tsx'));
check('2.9 a save refused as stale is merged, not just refused: the old "Reload the latest" banner is gone, "Keep mine as a copy" lives in the merge dialog',
  /err\.code === 'stale'/.test(APPX) && /mergeWithLatestRef\.current\(proj\.id/.test(APPX) && !/Reload the latest/.test(APPX) && !/kind: 'conflict'/.test(APPX) &&
  /Keep mine as a copy/.test(MERGE) && /canKeepCopy=\{canDesign\}/.test(APPX));
check('2.10 an undone or redone change is saved like any other', /const applyHistoryState = useCallback\(/.test(APPX) &&
  /\/\/ an undone change is saved like any other\n\s*scheduleAutosave\(state\);/.test(APPX) && (APPX.match(/applyHistoryState\((previous|restored)\);/g) || []).length === 2 &&
  /autosaveTimerRef\.current = window\.setTimeout\(\(\) => void persistProjectNow\(proj\), 1600\);/.test(APPX));
check('2.11 leaving with unsaved changes asks first', /addEventListener\('beforeunload', onLeave\)/.test(APPX));

/* ---------- 4 Phase 2: roles, merging, who is here, deleted pages, activity ---------- */
var RULES_SRC = read(path.join(ROOT, 'functions', 'lib', 'book-rules.js'));
var RULESTS = read(path.join(APP, 'src', 'services', 'bookRules.ts'));
var HASHSRC = read(path.join(APP, 'source-hash.cjs'));
var TSCONF = JSON.parse(read(path.join(APP, 'tsconfig.json')));
check('4.1 the editor takes in the shared rules file itself (no second copy), and a change to it makes the build stale',
  /import rules from '\.\.\/\.\.\/\.\.\/functions\/lib\/book-rules\.js';/.test(RULESTS) && TSCONF.compilerOptions.allowJs === true &&
  /join\(root, '\.\.', 'functions', 'lib', 'book-rules\.js'\)/.test(HASHSRC) &&
  /that is not one of the book\\'s layouts/.test(RULES_SRC) && js.indexOf("that is not one of the book's layouts") !== -1 &&
  !all.some(function (x) { return x.f !== 'src/services/bookRules.ts' && /function designChanges\(|function mergeBooks\(/.test(x.s); }));
check('4.2 the guard: a Content editor\'s change that alters the design is not applied (commit, undo and redo), with the rules\' first reason',
  /if \(!canDesignRef\.current\) \{\n\s*const why = designChanges\(current, next\);\n\s*if \(why\.length\) \{\n\s*setNotice\(\{ kind: 'info', text: designRefusal\(why\) \}\);\n\s*return prevList;/.test(APPX) &&
  /Only a Designer can change the design: \$\{first\}\./.test(APPX) &&
  /designChanges\(activeProject, previous\)/.test(APPX) && /designChanges\(activeProject, restored\)/.test(APPX) &&
  /const why = designChanges\(pm\.latest, finalBook\);/.test(APPX));
check('4.3 the role is read after sign-in (GET /me), fails closed, and a person without Books sees the server\'s sentence',
  /whenResolved\(\)[\s\S]{0,300}await loadMe\(\)/.test(APPX) && /err\.code === 'no-books'[\s\S]{0,80}setAccessError\(err\.message\)/.test(APPX) &&
  /const canDesign = me\?\.canDesign === true;/.test(APPX) && /apiGet<[^>]*>\('\/me'\)/.test(STORE) &&
  /\{accessError \? \(/.test(read(path.join(APP, 'src', 'components', 'DashboardView.tsx'))));
var C = function (f) { return read(path.join(APP, 'src', 'components', f)); };
var DASH = C('DashboardView.tsx'), BAR = C('InDesignControlBar.tsx'), PAL = C('InDesignToolPalette.tsx'), LEFT = C('LeftSidebar.tsx'),
  RIGHT = C('RightPropertiesPanel.tsx'), CANVAS = C('BookCanvas.tsx'), HIST = C('VersionHistoryModal.tsx'), NAV = C('BottomPageNavigator.tsx'), EXPM = C('ExportPreflightModal.tsx');
check('4.4 a Content editor is not offered the design: one line instead of the new-book pathways; no copy, archive or delete; frame tools off; no Elements or Masters tab; Layers read-only',
  /Only Designers can start a new book\./.test(DASH) && /\{role !== null && canDesign && \(\n\s*<section/.test(DASH) &&
  /\{canDesign && \(\n\s*<button\n\s*onClick=\{\(\) => onDuplicateProject/.test(DASH) && /\{canDesign && \(\n\s*<>\n\s*<button\n\s*onClick=\{\(\) => onToggleArchiveProject/.test(DASH) &&
  (PAL.match(/makesFrame: true/g) || []).length === 6 && /const off = !canDesign && !!tool\.makesFrame;/.test(PAL) &&
  /\.filter\(\(\[id\]\) => canDesign \|\| !designTab\(id\)\)/.test(LEFT) && /Read-only/.test(LEFT) && /\{tab === 'masters' && canDesign && \(/.test(LEFT));
check('4.5 …the inspector keeps words, photo, crop and infographic data but not geometry, type, styles, swatches, align, shapes, effects or colours; menus and modals of the design are gone',
  /\.filter\(\(\[id\]\) => canDesign \|\| id === 'properties' \|\| id === 'links'\)/.test(RIGHT) && /\{canDesign && \(\n\s*<div className="space-y-2 pt-2 border-t border-white\/\[0\.08\]">/.test(RIGHT) &&
  /Chart type/.test(RIGHT) && /Editorial Copy \(Frame-Locked\)/.test(RIGHT) && /Zoom Inside Frame/.test(RIGHT) &&
  /const items = allMenus\[key\]\.items\.filter\(\(it\) => canDesign \|\| !it\.design\);/.test(BAR) && (BAR.match(/design: true/g) || []).length >= 16 &&
  /Content editor/.test(BAR) && /CONTENT_EDITOR_TIP/.test(BAR) &&
  ['upload_template', 'typography', 'dimensions', 'design_system'].every(function (m) { return new RegExp("\\{activeModal === '" + m + "' && canDesign && \\(").test(APPX); }) &&
  /\(activeModal === 'templates' \|\| activeModal === 'infographics'\) && canDesign && \(/.test(APPX) &&
  /\{canRestoreVersion && \(/.test(HIST) && /canRestoreVersion=\{canDesign\}/.test(APPX) && !/onUpdateProject/.test(EXPM) &&
  /if \(!canDesign\) \{\n\s*onSelectElements\(page\.id, \[el\.id\]\);\n\s*return;/.test(CANVAS) && /isSelected && canDesign && !el\.locked/.test(CANVAS));
check('4.6 designer-only actions are said plainly instead of tried (new book, copy, archive, delete, templates)',
  ['Only Designers can start a new book.', 'Only Designers can archive a book.', 'Only Designers can delete a book.', 'Only Designers can save templates.'].every(function (t) { return APPX.indexOf("requireDesigner('" + t + "')") !== -1; }));
check('4.7 merging: the base is kept per book (load and each save), the newest copy is loaded, mergeBooks(base, mine, latest); conflicts open the dialog; autosave and edits wait; history moves onto the merge',
  /const BASES = new Map<string, BookProject>\(\);/.test(STORE) && /remember\(data\.book, data\.rev\);/.test(STORE) && /remember\(project, data\.rev\);/.test(STORE) &&
  /const base = knownBase\(bookId\);/.test(APPX) && /await loadLatest\(bookId\)/.test(APPX) && /mergeBooks\(base, mine, latest\)/.test(APPX) &&
  /setMergeDialog\(\{ mode: 'conflicts'/.test(APPX) && /resolveConflicts\(pm\.merged, pm\.conflicts, choices\)/.test(APPX) &&
  /if \(mergingRef\.current === proj\.id\) return; \/\/ the merge saves the book when it is done/.test(APPX) && /if \(editsBlockedRef\.current\) return prevList;/.test(APPX) &&
  /rebaseOnto\(pm\.base, s, pm\.latest\)/.test(APPX) && /Merged with \$\{personName\(pm\.updatedBy\)\}'s changes\./.test(APPX) &&
  /Keep all mine/.test(MERGE) && /Keep all theirs/.test(MERGE) && /aria-modal="true"/.test(MERGE) && /withoutTime/.test(RULESTS));
check('4.8 who else is here: POST /presence every 30 s and on page change, stopped on close; "Also here" chips and initials on the page thumbnails',
  /apiSend<[^>]*>\('POST', '\/presence', \{ bookId, pageId \}\)/.test(STORE) && /window\.setInterval\(beat, 30000\)/.test(APPX) &&
  /window\.clearInterval\(every\)/.test(APPX) && /\[presenceBookId, activePage\?\.id, myEmail\]/.test(APPX) &&
  /Also here:/.test(BAR) && /\(page \$\{o\.pageNumber\}\)/.test(BAR) && /initialsOf\(h\.email\)/.test(NAV));
check('4.9 deleted pages: listed with Restore; pending saves (and merges) go first; restored on the current revision; a 409 reads the newest copy and tries once more',
  /apiGet<[^>]*>\('\/trash\?id=' \+ encodeURIComponent\(bookId\)\)/.test(STORE) && /'POST', '\/restore-page', \{\n\s*bookId,\n\s*pageId,\n\s*baseRev: knownRevision\(bookId\),/.test(STORE) &&
  /const flushed = await flushSaves\(bookId\);/.test(APPX) && /err\.code === 'stale' \|\| err\.code === 'exists'/.test(APPX) &&
  (APPX.match(/await restoreDeletedPage\(bookId, p\.pageId\)/g) || []).length === 2 && /Deleted pages/.test(HIST) && /onOpenDeletedPages/.test(NAV));
check('4.10 activity: the book\'s log (who, when, the sentence) in its own tab',
  /apiGet<[^>]*>\('\/log\?id=' \+ encodeURIComponent\(bookId\)\)/.test(STORE) && /\['activity', Activity, 'Activity'\]/.test(HIST) && /logSentence\(e\)/.test(HIST) && /personName\(e\.by\)/.test(HIST));
check('4.11 text that does not fit: a red outline on the frame and a "+N words don\'t fit" label, for both roles, never in preview (exports draw from the book, not the screen)',
  /!previewMode && ov\?\.isOverflowing \? 'outline-2 outline-dashed outline-offset-1 outline-\[#D94F3D\]' : ''/.test(CANVAS) && /words don't fit/.test(CANVAS) &&
  /outline-dashed/.test(read(path.join(OUT, 'app.css'))) && !/isOverflowing/.test(EXP));
(function () {
  /* what the editor makes for a Content editor is content by the rules; a drag is not */
  var rules = require('./book-rules');
  var frame = { id: 'f1', name: 'Body', type: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 40, rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 2,
    text: 'Words', textStyle: { fontFamily: 'Lora', fontSizePt: 10 }, masterElementId: 'm1' };
  var master = { id: 'mp1', name: 'A', role: 'editorial_text', description: '', backgroundColor: '#F7F5F0', elements: [Object.assign({}, frame, { id: 'm1', masterElementId: undefined })] };
  var book = { id: 'b', name: 'B', dimensions: { widthMm: 200 }, designSystem: {}, masterPages: [master], printSettings: {}, customDimensionPresets: [], chapters: [], contentSections: [], imageAssets: [],
    pages: [{ id: 'p1', orderIndex: 0, label: 'One', role: 'editorial_text', masterPageId: 'mp1', backgroundColor: '#F7F5F0', elements: [frame] }] };
  var edited = Object.assign({}, book, { pages: [Object.assign({}, book.pages[0], { elements: [Object.assign({}, frame, { text: 'New words' })] })] });
  var added = Object.assign({}, book, { pages: book.pages.concat([{ id: 'p2', orderIndex: 1, label: 'Page 2', role: 'editorial_text', masterPageId: 'mp1', backgroundColor: master.backgroundColor,
    elements: master.elements.map(function (m, i) { return Object.assign({}, JSON.parse(JSON.stringify(m)), { id: 'el_m_' + i, masterElementId: m.id }); }) }]) });
  var dragged = Object.assign({}, book, { pages: [Object.assign({}, book.pages[0], { elements: [Object.assign({}, frame, { xMm: 30 })] })] });
  var marked = Object.assign({}, book, { pages: [Object.assign({}, book.pages[0], { elements: [Object.assign({}, frame, { text: 'x', overriddenFromMaster: true })] })] });
  check('4.12 by the shared rules, a text edit and a page made from a master (with its background) are content; a drag, and marking a master frame overridden, are design',
    rules.designChanges(book, edited).length === 0 && rules.designChanges(book, added).length === 0 &&
    rules.designChanges(book, dragged).length === 1 && rules.designChanges(book, marked).length === 1 &&
    /elements: sourcePage\.elements\.filter\(keep\)\.map/.test(APPX) && /pagesCopy\.splice\(pIdx \+ 1, 0, nextPage\);/.test(APPX) && /const page = pageFromLayout\(activeProject, choiceId, \{/.test(APPX) &&
    /commitProjectUpdate\(\(proj\) => insertPagesAfter\(proj, activePage\.id, made\)\)/.test(APPX) && /: \{ text: e\.target\.value \},/.test(CANVAS),
    { edited: rules.designChanges(book, edited), added: rules.designChanges(book, added), dragged: rules.designChanges(book, dragged), marked: rules.designChanges(book, marked) });
  var b2 = Object.assign({}, book, { updatedAt: '1' }), m2 = Object.assign({}, edited, { updatedAt: '2' }), t2 = Object.assign({}, book, { updatedAt: '3', name: 'Theirs' });
  var mg = rules.mergeBooks(b2, m2, t2);
  check('4.13 …two saves that differ in their time and in different things merge without a conflict, each side\'s change kept',
    mg.conflicts.length === 0 && mg.merged.name === 'Theirs' && mg.merged.pages[0].elements[0].text === 'New words' &&
    /R\.mergeBooks\(withoutTime\(base, at\), withoutTime\(mine, at\), withoutTime\(theirs, at\)\)/.test(RULESTS), mg.conflicts);
  /* every other way the editor adds a page takes a layout's settings; Auto-Flow keeps frame names for a Content editor */
  var MPE = read(path.join(APP, 'src', 'engines', 'masterPageEngine.ts')), AFE = read(path.join(APP, 'src', 'engines', 'autoFlowEngine.ts'));
  var AFM = read(path.join(APP, 'src', 'components', 'AiAutoFlowModal.tsx'));
  var copied = Object.assign({}, book, { pages: book.pages.concat([{ id: 'p3', orderIndex: 1, label: 'X', role: 'blank', masterPageId: 'mp1', backgroundColor: '#F7F5F0', elements: [] }]) });
  var paper = Object.assign({}, book, { pages: book.pages.concat([{ id: 'p4', orderIndex: 1, label: 'X', role: 'editorial_text', masterPageId: 'mp1', backgroundColor: '#FFFFFF', elements: [] }]) });
  check('4.14 new pages from Auto-Flow and from a continued overflow take a layout of the book (a page\'s or a master\'s settings), and a Content editor\'s Auto-Flow keeps frame names and is checked before it is applied',
    /export function newPageLook\(/.test(MPE) && /export function pageLookFromPage\(/.test(MPE) && (AFE.match(/\.\.\.newPageLook\(project\),/g) || []).length === 2 &&
    !/backgroundColor: ds\.colors\.paper/.test(AFE) && /keepFrameNames: !canDesign,/.test(AFM) && /const why = designChanges\(project, updated\);/.test(AFM) &&
    rules.designChanges(book, copied).length === 0 && rules.designChanges(book, paper).length === 1,
    { copied: rules.designChanges(book, copied), paper: rules.designChanges(book, paper) });
})();

/* ---------- 5 Phase 3: the content workflow ---------- */
(function () {
  var C5 = function (f) { return read(path.join(APP, 'src', 'components', f)); };
  var POUR = read(path.join(APP, 'src', 'engines', 'pourEngine.ts'));
  var ED = C5('EditorialDashboard.tsx'), PM = C5('PourManuscriptModal.tsx'), PICK = C5('NewPageLayoutPicker.tsx'), BADGE = C5('PhotoResolutionBadge.tsx'),
    CM = C5('ContentManagerModal.tsx'), LEFT5 = C5('LeftSidebar.tsx'), NAV5 = C5('BottomPageNavigator.tsx'), BAR5 = C5('InDesignControlBar.tsx'), PRE = read(path.join(APP, 'src', 'engines', 'preflightEngine.ts'));
  check('5.1 word counts: the top bar\'s word count and two menu items open them beside the canvas (not a modal, so the book stays editable), hidden in preview',
    /onClick=\{\(\) => onOpenModal\('editorial'\)\}/.test(BAR5) && (BAR5.match(/action: \(\) => onOpenModal\('editorial'\)/g) || []).length === 2 &&
    /if \(m === 'editorial'\) \{\n\s*setShowEditorial\(\(o\) => !o\);/.test(APPX) && /\{!previewMode && showEditorial && \(\n\s*<EditorialDashboard/.test(APPX));
  check('5.2 …per page, spread and chapter, with the text that doesn\'t fit (measured with the real font, again when fonts load), empty frames and the manuscript on no page, each with "Go to"; the same panel is the Content manager\'s tab',
    /editorialCounts\(project, measureTextOverflow, placeholders\)/.test(ED) && /useFontsVersion\(\)/.test(ED) && /editorialCounts\(activeProject, measureTextOverflow\)/.test(APPX) &&
    /Text that doesn't fit/.test(ED) && /Empty text frames/.test(ED) && /Manuscript not on any page/.test(ED) && /'pages' \| 'spreads' \| 'chapters'/.test(ED) && />\s*Go to\s*</.test(ED) &&
    /<EditorialCountsPanel\n\s*project=\{project\}\n\s*variant="wide"/.test(CM) && !/computeEditorialAnalytics/.test(CM));
  check('5.3 …and they are editorial information only: nothing of them is in the export',
    !/editorialCounts|EditorialDashboard|EditorialCountsPanel|computeEditorialAnalytics/.test(EXP) && /Never printed or exported\./.test(ED));
  check('5.4 the pour: from the Content manager, the sections (not yet placed by default) and the start page chosen, the fit measured with the real font, "Replace text in frames that already have words" off by default, stop or add pages from a layout',
    /<PourManuscriptModal/.test(CM) && /Pour into frames/.test(CM) && /useState<Set<string>>\(\(\) => new Set\(notPlacedIds\)\)/.test(PM) &&
    /fit: fitTextToFrame/.test(PM) && /const \[replace, setReplace\] = useState\(false\);/.test(PM) && /Replace text in frames that already have words/.test(PM) &&
    /Stop, and tell me how many words were not placed/.test(PM) && /Add pages from layout/.test(PM) && /planPour\(project, \{ \.\.\.base, addPagesFrom: chosenLayout \}\)/.test(PM));
  check('5.5 …a preview first, a Content editor\'s pour checked by the shared rules before Apply, and Apply is one change through the guard (Undo takes it back)',
    /plan\.summary/.test(PM) && /designChanges\(project, plan\.project\)/.test(PM) && /const canApply = plan\.sectionsPlaced > 0 && refusal\.length === 0;/.test(PM) &&
    /onUpdateProject\(updated\);\n\s*setPourOpen\(false\);/.test(CM) && /onUpdateProject=\{\(updated\) => commitProjectUpdate\(\(\) => updated\)\}\n\s*onJumpToPage[\s\S]{0,200}onUndo=\{handleUndo\}/.test(APPX) &&
    /^import type \{[^}]+\} from '\.\.\/types\/bookstudio';$/m.test(POUR) && !/^import (?!type)/m.test(POUR));
  check('5.6 a new page\'s layout: "Add page" and "Insert spread" open a picker of the master pages and a copy of the current page (an empty page for Designers only); the page is made by pageFromLayout and goes in after the current page',
    /setPagePicker\(\{ count: 1 \}\)/.test(APPX) && /setPagePicker\(\{ count: 2 \}\)/.test(APPX) && /<NewPageLayoutPicker/.test(APPX) &&
    /pageLayoutChoices\(project, currentPage, \{ includeBlank: canDesign \}\)/.test(PICK) && /aria-haspopup="dialog"/.test(NAV5) && /layoutPickerOpen=\{pagePicker !== null\}/.test(APPX) &&
    /label: `A copy of page \$\{idx \+ 1\}/.test(POUR) && /with its words and photos left out/.test(POUR));
  check('5.7 photo resolution: each library photo shows its pixels and, where placed, its print resolution (the pre-export check\'s maths, over the zoom); red under 150 ppi, amber to 250; the selected photo frame says the same',
    /Math\.min\(pw \/ widthIn, ph \/ heightIn\) \/ zoom/.test(BADGE) && /Math\.min\(\n\s*el\.image\.naturalWidth \/ Math\.max\(0\.1, widthIn\)/.test(PRE) &&
    /if \(ppi < 150\) return \{ level: 'too_low', label: 'Too low for print' \};/.test(BADGE) && /if \(ppi < 250\) return \{ level: 'low', label: 'Low for print' \};/.test(BADGE) &&
    /<AssetPrintLine asset=\{asset\} use=\{photoUse\.get\(asset\.id\) \|\| \[\]\} \/>/.test(LEFT5) && /\{asset\.widthPx\}×\{asset\.heightPx\} px/.test(LEFT5) &&
    /Selected photo frame: \{selectedPhoto\.name\}/.test(LEFT5) && /<PhotoResolutionBadge element=\{selectedPhoto\}/.test(LEFT5));
  var small = [ED, PM, PICK, BADGE, CM, LEFT5, NAV5].join('\n').match(/text-\[(?:[0-9]|10)(?:\.\d+)?px\]/g) || [];
  check('5.8 the new screens\' words are 11 px or more', small.length === 0, small);
})();

/* ---------- 6 Phase 4: export ---------- */
(function () {
  var C6 = function (f) { return read(path.join(APP, 'src', 'components', f)); };
  var EXPM6 = C6('ExportPreflightModal.tsx'), ED6 = C6('EditorialDashboard.tsx'), BAR6 = C6('InDesignControlBar.tsx'), CANVAS6 = C6('BookCanvas.tsx');
  var GATE = read(path.join(APP, 'src', 'engines', 'exportGate.ts')), PRE6 = read(path.join(APP, 'src', 'engines', 'preflightEngine.ts'));
  var POUR6 = read(path.join(APP, 'src', 'engines', 'pourEngine.ts'));
  check('6.1 the export dialog offers the print-ready PDF, the review PDF, page and spread images and the backup; the PDFs are pdfEngine\'s',
    /title: 'Print-ready PDF'/.test(EXPM6) && /title: 'Review PDF'/.test(EXPM6) && /title: 'Page and spread images'/.test(EXPM6) && /title: 'Backup'/.test(EXPM6) &&
    /import \{ defaultPdfOptions, exportBookPdf, PdfFontError, type PdfExportOptions \} from '\.\.\/engines\/pdfEngine';/.test(EXPM6) &&
    /exportSinglePageImage\(activePage, pageNo, project, fmt\)/.test(EXPM6) && /exportSpreadImage\(spreadLeftPage, spreadRightPage, spreadLeftIdx \+ 1, project, fmt\)/.test(EXPM6) &&
    /exportProjectBackupPackage\(project\)/.test(EXPM6));
  check('6.1b …opened from the top bar, and from the File menu ("Export PDF, Images or Backup…") or Ctrl/Cmd+E, which now work; the menu no longer promises an IDML export',
    /\{ label: 'Export PDF, Images or Backup\.\.\.', shortcut: 'Ctrl\+E', action: \(\) => onOpenModal\('export'\) \}/.test(BAR6) && !/IDML \/ Package/.test(BAR6) &&
    /e\.key\.toLowerCase\(\) === 'e'\) \{\n\s*e\.preventDefault\(\);\n\s*setActiveModal\('export'\);/.test(APPX));
  check('6.2 …the old PDF made of JPEG pictures of the pages is gone: not in the dialog, not in exportEngine',
    !/exportBookPdf|PDFDocument|embedJpg|from 'pdf-lib'/.test(EXP) && !/printReady/.test(EXPM6) &&
    !/import \{[^}]*exportBookPdf[^}]*\} from '\.\.\/engines\/exportEngine'/.test(EXPM6));
  check('6.3 print-ready options: pages (all or a range), spreads, crop, bleed, registration and slug marks, the photo resolution target (300 by default), and the plain RGB line',
    /name="export-range"/.test(EXPM6) && /aria-label="First page"/.test(EXPM6) && /aria-label="Last page"/.test(EXPM6) && /As spreads \(facing pages side by side\)/.test(EXPM6) &&
    ["setMark('crop'", "setMark('bleed'", "setMark('registration'", "setMark('slug'"].every(function (t) { return EXPM6.indexOf(t) !== -1; }) &&
    /Photo resolution target/.test(EXPM6) && /\(usual for print\)/.test(EXPM6) &&
    EXPM6.indexOf('RGB PDF: your printer converts it to CMYK. Ask them for their PDF requirements.') !== -1 &&
    /resolvePageRange\(\{ all: rangeAll, from: rangeFrom, to: rangeTo \}, pageCount\)/.test(EXPM6) && /pages: range\.pages/.test(EXPM6));
  check('6.4 the gate: the check (with the template\'s words) runs again when fonts load; its errors stop the print-ready PDF, warnings wait for "I\'ve checked these warnings"; the button says what to fix; review and images are never stopped',
    /runPreflightCheck\(project, \{ placeholders \}\), \[project, placeholders, fontsVersion\]/.test(EXPM6) && /const gate = exportGate\(issues, kind, ticked\);/.test(EXPM6) &&
    /disabled=\{busy \|\| !gate\.canExport \|\| !range\.ok\}/.test(EXPM6) && /\{TICK_LABEL\} \(\{warnings\.length\}\)/.test(EXPM6) &&
    /if \(!exportGate\(issues, m, ticked\)\.canExport\) return;/.test(EXPM6) && /buttonLabel: `Fix \$\{plural\(errors\.length, 'problem'\)\} to export`/.test(GATE) &&
    /if \(kind !== 'print'\) \{/.test(GATE) && /const ticked = tickedFor !== null && tickedFor === signature;/.test(EXPM6));
  check('6.5 …each problem with "Go to" (the existing jump), never while an export runs',
    /onJumpToPage\(i\.pageId, i\.elementId\);\n\s*onClose\(\);/.test(EXPM6) && /if \(busy \|\| !i\.pageId\) return;/.test(EXPM6) && />\s*Go to\s*</.test(EXPM6) &&
    /onJumpToPage=\{\(pageId, elId\) => \{\n\s*setActivePageId\(pageId\);/.test(APPX));
  check('6.6 while a PDF is made: a progress bar with the step, and Cancel (AbortSignal); the dialog can\'t be closed meanwhile (close button and Escape)',
    /const controller = new AbortController\(\);/.test(EXPM6) && /controller\.signal\n\s*\);/.test(EXPM6) && /const cancel = \(\) => abortRef\.current\?\.abort\(\);/.test(EXPM6) &&
    /onClick=\{cancel\}/.test(EXPM6) && />\s*Cancel\s*</.test(EXPM6) && /role="progressbar"/.test(EXPM6) && /progressLabel\(done, total, what\)/.test(EXPM6) &&
    /const close = \(\) => \{\n\s*if \(busy\) return;/.test(EXPM6) && /if \(e\.key === 'Escape' && !busy\) onClose\(\);/.test(EXPM6) && /disabled=\{busy\}\n\s*aria-label=\{busy \? 'Cancel the export first' : 'Close'\}/.test(EXPM6) &&
    /Export cancelled\. Nothing was downloaded\./.test(EXPM6));
  check('6.7 afterwards: the summary (pages, size, fonts, photos below the target, warnings) and the file "<Book name> – print-ready.pdf" or "– review.pdf"; fonts that can\'t be embedded are named, with why and the fix',
    /const summary = summarizePdf\(result, \{/.test(EXPM6) && /downloadBlob\(result\.blob, summary\.fileName\);/.test(EXPM6) &&
    /return `\$\{safeFileBase\(bookName\)\} – \$\{mode === 'print' \? 'print-ready' : 'review'\}\.pdf`;/.test(GATE) &&
    /err instanceof PdfFontError/.test(EXPM6) && /fontErrorAdvice\(\(err as PdfFontError\)\.fonts \|\| \[\], canDesign\)/.test(EXPM6) && /Download again/.test(EXPM6));
  check('6.8 the check covers what the gate needs: missing photos (template frames too), fonts that can\'t load, measured overflow, ppi with zoom, page sizes, the page count for the binding, bleed, frames off the page, safe margin, template words',
    /isMissingPhoto\(el\)/.test(PRE6) && /missingPhotoText\(el, pageNum\)/.test(PRE6) && /f\.status === 'error'/.test(PRE6) && /measureTextOverflow\(el\)/.test(PRE6) &&
    /\/ zoom;/.test(PRE6) && /sizeProblem\(dim\)/.test(PRE6) && /count % 2 === 1/.test(PRE6) && /binding === 'saddle_stitch' && count % 4 !== 0/.test(PRE6) &&
    /pf_bleed_/.test(PRE6) && /pf_offpage_/.test(PRE6) && /pf_safe_/.test(PRE6) && /isPlaceholderText\(el\.text, placeholders, el\)/.test(PRE6) &&
    /'Add the photo or delete the frame\.'/.test(GATE));
  check('6.9 page and spread images draw text from textEngine\'s layoutTextLines (letter spacing, breaks after hyphens and at dashes, paragraph gaps, justify), no wrapping of their own',
    /const laid = layoutTextLines\(el, \{ pageNumber \}\);/.test(EXP) && /for \(const word of line\.words\) drawRun\(/.test(EXP) && /letterSpacing = `\$\{px\}px`/.test(EXP) &&
    /ctx\.font = cssFont\(font, fontPx\);/.test(EXP) && !/wrapCanvasText|measureText\(test\)/.test(EXP) && /await loadPageFonts\(page\);/.test(EXP) &&
    /imageFileName\(project\.name, pageNumber, null, format\)/.test(EXP) && /backupFileName\(project\.name\)/.test(EXP));
  check('6.10 the word counts drawer fits its Characters column: wider, and a fixed table whose name column gives way',
    /w-\[440px\] max-w-full/.test(ED6) && /<table className="w-full table-fixed text-left text-\[11px\]">/.test(ED6) && /<col className="w-\[84px\]" \/>/.test(ED6) && !/max-w-\[220px\]/.test(ED6));
  check('6.11 the pour: a one-word template text is a placeholder in its own frame; a contents page\'s heading is kept unless the person chose to replace words',
    /const usable = replace \|\| \(!isBookLabel\(el, pages\[i\]\) && isPlaceholderText\(el\.text, options\.placeholders, el\)\);/.test(POUR6) &&
    /page\.role === 'table_of_contents' && groupOfFrame\(el\) === 'heading'/.test(POUR6) && !/n\.split\(' '\)\.length > 1\) out\.add\(n\);\n\s*\};/.test(POUR6));
  check('6.12 "Also here": fixed-size initial circles that never shrink away (names and pages in tooltips), the words only where there is room',
    /className="flex shrink-0 items-center gap-1 ml-1 rounded/.test(BAR6) && /title=\{`Also here: \$\{othersHere\.map/.test(BAR6) &&
    /className="flex items-center justify-center w-6 h-6 rounded-full/.test(BAR6) && /<span className="hidden 2xl:inline text-\[11px\] text-\[#8F8C84\] whitespace-nowrap">Also here:<\/span>/.test(BAR6));
  var baseOk = /const BASE_PX_PER_MM = 2\.05;/.test(CANVAS6) && /const CANVAS_PX_PER_MM = 2\.05; \/\/ BookCanvas\.tsx BASE_PX_PER_MM/.test(APPX) &&
    /className="relative my-14 mx-12 transition-transform duration-150"/.test(CANVAS6);
  check('6.13 the zoom is fitted when a book opens and when the view switches (the canvas area measured; BookCanvas\'s scale and stage margins), and kept once the person zooms',
    baseOk && /<div ref=\{canvasAreaRef\} className="relative flex-1 min-w-0 min-h-0 flex">/.test(APPX) && /new ResizeObserver\(measure\)/.test(APPX) &&
    /useEffect\(\(\) => \{\n\s*zoomChosenRef\.current = false;\n\s*\}, \[activeProjectId, studioOpen, viewMode\]\);/.test(APPX) &&
    /if \(!zoomChosenRef\.current && fitZoom !== null\) setZoom\(fitZoom\);/.test(APPX) && /onZoomChange=\{setZoomByPerson\}/.test(APPX) &&
    /onFitToScreen=\{fitToScreen\}/.test(APPX) && /setZoomByPerson\(\(z\) => Math\.max\(0\.3, Math\.min\(2\.2/.test(APPX) && (APPX.match(/\bsetZoom\(/g) || []).length === 3);
  (function () {
    var m = /const CANVAS_PX_PER_MM[\s\S]*?\nexport function fitZoomFor[\s\S]*?\n\}\n/.exec(APPX);
    var fit = null;
    try {
      var esb = require(path.join(APP, 'node_modules', 'esbuild'));
      var js6 = esb.transformSync(m[0].replace('export function', 'function'), { loader: 'ts' }).code;
      fit = new Function(js6 + '\nreturn fitZoomFor;')();
    } catch (e) { fit = null; }
    var wide = fit && fit(1000, 700, 606, 306); // a 600 mm landscape spread and its 3 mm bleed, in a 1000 × 700 px canvas
    check('6.14 …a wide 600 mm landscape spread opens wholly visible (it was cut off at 76%), never past 30–220%',
      !!fit && wide === 0.72 && 606 * 2.05 * wide + 104 <= 1000 && fit(4000, 3000, 100, 100) === 2.2 && fit(150, 150, 600, 300) === 0.3 && fit(0, 700, 600, 300) === null, wide);
  })();
  var small6 = [EXPM6, ED6, BAR6].join('\n').match(/text-\[(?:[0-9]|10)(?:\.\d+)?px\]/g) || [];
  check('6.15 the export dialog\'s, the drawer\'s and the top bar\'s words are 11 px or more, and never a bare "ET"', small6.length === 0 && !/\bET\b/.test(EXPM6 + GATE + PRE6), small6);
})();

/* ---------- 3 the sample photos ---------- */
var CUR = read(path.join(APP, 'src', 'data', 'curatedAssets.ts'));
var sharp = null; try { sharp = require('sharp'); } catch (e) { /* sizes checked by name only */ }
var samples = (CUR.match(/'\/books\/samples\/[^']+'/g) || []).map(function (s) { return s.slice(1, -1); });
check('3.1 five sample photos, each served from books/samples/', samples.length === 5 && samples.every(function (s) { return fs.existsSync(path.join(ROOT, s)); }), samples);

(async function () {
  if (sharp) {
    var sizes = {};
    for (var i = 0; i < samples.length; i++) { var m = await sharp(path.join(ROOT, samples[i])).metadata(); sizes[path.basename(samples[i])] = m.width + 'x' + m.height; }
    var wrong = [];
    (CUR.match(/url: EDITORIAL_PHOTOS\.(\w+),\s*widthPx: (\d+),\s*heightPx: (\d+)/g) || []).forEach(function (blk) {
      var mm = /EDITORIAL_PHOTOS\.(\w+),\s*widthPx: (\d+),\s*heightPx: (\d+)/.exec(blk);
      var file = path.basename((new RegExp(mm[1] + ": '([^']+)'").exec(CUR) || [])[1] || '');
      if (sizes[file] !== mm[2] + 'x' + mm[3]) wrong.push(file + ' says ' + mm[2] + 'x' + mm[3] + ', is ' + sizes[file]);
    });
    check('3.2 …with their true pixel sizes (the print check\'s resolution warning depends on them)', wrong.length === 0, wrong);
  }
  process.stdout.write('books-build: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})();
