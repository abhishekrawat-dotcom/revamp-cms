// node functions/lib/editor-polish.test.js — six small polish fixes of the site editor (UX batch B21: UX-083 to UX-088).
//   1 UX-084 after Undo or Redo a short line says what it was ("Undone: “Agenda” deleted."), one at a time; Undo and
//     Redo are labelled buttons with a clear disabled state; the text toolbar's align and copy buttons are the usual
//     pictures, and every icon button has a name
//   2 UX-086 the top bar's line gives the event's dates and place as the site prints them, never a creation time;
//     the brief's welcome is plain and closes with its button, Escape or a click beside it
//   3 UX-088 the canvas menu shows the links visitors get, in their order (the site runtime's navPlan, read-only);
//     Section edges and Banner video say they are saved by themselves
//   4 UX-083 Mobile is a centred phone, not a strip at the left of a wide white card
//   5 UX-085 every control shows where the focus is, and the site page is one Tab stop with Enter / arrows / Escape
//   6 UX-087 the ETB2B AI greeting folds to its face once per person, and the canvas keeps a gutter clear of it
//   7 ES5
// No network, no AI, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var SRC = read('editor-template-ui.js');
var PAGE = read('custom_editor.html');
var CANVAS = read('editor-canvas.js');
var RUNTIME = read('templates/_shared/et-runtime.js');
var passed = 0, failed = 0;
function show(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + show(detail) : ''));
}
// a function's whole text, read from the source
function body(name, src) {
  src = src || SRC;
  var i = src.indexOf('function ' + name + '(');
  if (i === -1) return '';
  var open = src.indexOf('{', i), depth = 0;
  for (var j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return '';
}
// the text of a block from `start` to its matching closing brace and what follows it up to `tail`
function blockFrom(src, start, tail) {
  var i = src.indexOf(start);
  if (i === -1) return '';
  var open = src.indexOf('{', i), depth = 0;
  for (var j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1) + (tail || '');
  }
  return '';
}
function noComments(s) { return s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''); }
var SCRIPTS = PAGE.match(/<script>([\s\S]*?)<\/script>/g) || [];
var INLINE = SCRIPTS.length ? SCRIPTS[SCRIPTS.length - 1].replace(/^<script>|<\/script>$/g, '') : '';
var STYLE = (PAGE.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
var MARKUP = PAGE.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

/* the pure block of this batch, run as it is */
var BEGIN = '/* editorPolish:begin', END = '/* editorPolish:end */';
var at = SRC.indexOf(BEGIN), to = SRC.indexOf(END);
check('0 the block is marked once', at !== -1 && to > at && SRC.indexOf(BEGIN, at + 1) === -1, { at: at, to: to });
var BLOCK = SRC.slice(at, to);
var ctx = vm.createContext({});
vm.runInContext(BLOCK, ctx, { filename: 'editor-template-ui.js#editorPolish' });
var P = ctx.editorPolish;
check('0 the block defines editorPolish', !!P && typeof P.stepWhat === 'function' && typeof P.topbarMeta === 'function' && typeof P.navRule === 'function');
check('0 the block names nothing of the editor or the page', !/(^|[^.\w$])(window|document|canvas|eventId|host|showToast|localStorage|RevampCore|undoStack|setTimeout)\b(?!\s*:)/.test(noComments(BLOCK)));

/* ======================= 1 UX-084 Undo / Redo say what they did ======================= */
(function () {
  // a section as the canvas snapshot holds it (editor-canvas.js snapshot: outerHTML of the page's top nodes)
  function sec(type, key, name, inner, hidden) {
    return '<section class="' + (hidden ? 'sec is-hidden-sec' : 'sec') + '" data-rv-section="' + type + '" data-rv-key="' + key + '" data-sec-name="' + name + '" id="' + key + '">' + (inner || '<h2>' + name + '</h2>') + '</section>';
  }
  function snap(nodes, design) { return { v: 1, html: '', body: '', design: design || '{}', generic: false, blocks: false, nodes: nodes }; }
  var nav = '<header data-rv-section="nav" data-rv-key="nav" data-sec-name="Top bar"><a href="#agenda">Agenda</a></header>';
  var style = '<style data-rv-style="agenda"></style>';
  var hero = sec('hero', 'hero', 'Hero banner'), agenda = sec('agenda', 'agenda', 'Agenda'), faq = sec('faq', 'faq', 'FAQs'), res = sec('resources', 'resources', 'Resources');
  var base = snap([nav, style, hero, agenda, res, faq]);

  check('1 a section added', P.stepWhat(snap([nav, style, hero, agenda, res]), base) === '“FAQs” added', P.stepWhat(snap([nav, style, hero, agenda, res]), base));
  check('1 a section deleted', P.stepWhat(base, snap([nav, style, hero, res, faq])) === '“Agenda” deleted');
  check('1 a section hidden, and shown again', P.stepWhat(base, snap([nav, style, hero, sec('agenda', 'agenda', 'Agenda', null, true), res, faq])) === '“Agenda” hidden' &&
    P.stepWhat(snap([nav, style, hero, sec('agenda', 'agenda', 'Agenda', null, true), res, faq]), base) === '“Agenda” shown again');
  var swapped = P.stepWhat(base, snap([nav, style, hero, res, agenda, faq]));
  check('1 Move down (two neighbours change places): both are named, since which one moved cannot be told', swapped === '“Agenda” and “Resources” swapped places', swapped);
  var dragged = P.stepWhat(base, snap([nav, style, agenda, res, faq, hero]));
  check('1 one section moved further: that section', dragged === '“Hero banner” moved', dragged);
  check('1 several moved at once: the order', P.stepWhat(base, snap([nav, style, faq, res, hero, agenda])) === 'the order of the sections');
  check('1 words changed in one section', P.stepWhat(base, snap([nav, style, hero, sec('agenda', 'agenda', 'Agenda', '<h2>Day one</h2>'), res, faq])) === 'the change to “Agenda”');
  check('1 … in two', P.stepWhat(base, snap([nav, style, sec('hero', 'hero', 'Hero banner', '<h1>New</h1>'), sec('agenda', 'agenda', 'Agenda', '<h2>Day one</h2>'), res, faq])) === 'changes to 2 sections');
  check('1 the whole site\'s look', P.stepWhat(base, snap([nav, style, hero, agenda, res, faq], '{"themeColor":"#0f6f5c"}')) === 'a change to the whole site’s look');
  check('1 the top bar is a section like the others', P.stepWhat(base, snap([nav.replace('>Agenda<', '>Programme<'), style, hero, agenda, res, faq])) === 'the change to “Top bar”');
  check('1 nothing to tell apart: "the last change"', P.stepWhat(base, base) === 'the last change' && P.stepWhat(null, base) === 'the last change');
  check('1 a name with quotes and ampersands reads as written', P.stepWhat(snap([hero]), snap([hero, sec('x', 'x-2', 'Q&amp;A &quot;live&quot;')])) === '“Q&A "live"” added');
  check('1 a section without a key or name still has one', P.stepWhat(snap([]), snap(['<section data-rv-section="past-speakers"><h2>x</h2></section>'])) === '“past speakers” added');

  var step = body('step');
  check('1 Undo names the step it takes back, Redo the step it puts back, read before the pointer moves',
    /var what = by < 0 \? editorPolish\.stepWhat\(undoStack\[ptr\], undoStack\[undoPtr\]\) : editorPolish\.stepWhat\(undoStack\[undoPtr\], undoStack\[ptr\]\);\s*\n\s*undoPtr = ptr;/.test(step), step.slice(0, 400));
  check('1 … and says it once the page is back', /sayStep\(\(by < 0 \? 'Undone: ' : 'Redone: '\) \+ what \+ '\.'\);\s*\}$/.test(step));
  // one line at a time: six Undos in a row leave one toast, not six
  var said = [], live = 0;
  var c = vm.createContext({ showToast: function (m) { said.push(m); live++; var gone = false; return { dismiss: function () { if (!gone) { gone = true; live--; } } }; } });
  vm.runInContext('var stepToast = null; ' + body('sayStep') + '; this.sayStep = sayStep;', c);
  for (var i = 0; i < 6; i++) c.sayStep('Undone: the change to “Agenda”.');
  check('1 pressed several times, each line replaces the one before', said.length === 6 && live === 1, { said: said.length, live: live });

  // the buttons
  var undoBtn = (MARKUP.match(/<button id="btn-tpl-undo"[^>]*>[\s\S]*?<\/button>/) || [''])[0];
  var redoBtn = (MARKUP.match(/<button id="btn-tpl-redo"[^>]*>[\s\S]*?<\/button>/) || [''])[0];
  check('1 Undo and Redo are labelled, with their names for screen readers', /aria-label="Undo"/.test(undoBtn) && /<span class="hist-word">Undo<\/span>/.test(undoBtn) &&
    /aria-label="Redo"/.test(redoBtn) && /<span class="hist-word">Redo<\/span>/.test(redoBtn) && undoBtn.indexOf('&#8630;') === -1, [undoBtn.slice(0, 120), redoBtn.slice(0, 120)]);
  check('1 … in the text colour at 13px, faded with a no-entry cursor when there is nothing to take back',
    /\.history-toggle button\{[^}]*color: var\(--text\);[^}]*font-size:13px;/.test(STYLE) && /\.history-toggle button:disabled\{ opacity:\.4; cursor:not-allowed; \}/.test(STYLE));
  check('1 … and when the tools row is short of room only the arrows stay (B14\'s fitting is kept)', /\.ed-rail\.is-snug \.history-toggle \.hist-word\{ display:none; \}/.test(STYLE) && /var STEPS = \['is-snug', 'is-snugger'\];/.test(INLINE));

  // the text toolbar
  var tb = body('buildToolbar');
  check('1 align and duplicate are pictures, not ⇤ ↔ ⇥ ⧉', !/&#8676;|&#8596;|&#8677;|&#10697;/.test(tb) && /TB_ICON\.alignLeft/.test(tb) && /TB_ICON\.alignCenter/.test(tb) && /TB_ICON\.alignRight/.test(tb) && /TB_ICON\.duplicate/.test(tb));
  var iconButtons = tb.match(/<button class="icon-only[^"]*"[^>]*>/g) || [];
  check('1 every icon button of the toolbar has a name', iconButtons.length >= 10 && iconButtons.every(function (b) { return /aria-label="[^"]+"/.test(b); }), iconButtons.filter(function (b) { return !/aria-label=/.test(b); }));
  var secButtons = body('buildSecToolbar').match(/<button class="icon-only[^"]*"[^>]*>/g) || [];
  check('1 the section pill\'s ↑ and ↓ have their names too', secButtons.length === 2 && /aria-label="Move this section up"/.test(secButtons[0]) && /aria-label="Move this section down"/.test(secButtons[1]), secButtons);
  var icons = vm.createContext({});
  vm.runInContext(SRC.slice(SRC.indexOf('  var TB_SVG = '), SRC.indexOf('  function buildToolbar(')) + '; this.TB_ICON = TB_ICON;', icons);
  check('1 the pictures are drawn and hidden from screen readers', ['alignLeft', 'alignCenter', 'alignRight', 'duplicate'].every(function (k) {
    return /^<svg [^>]*aria-hidden="true">[\s\S]+<\/svg>$/.test(icons.TB_ICON[k]);
  }));
})();

/* ======================= 2 UX-086 the top bar's line and the welcome ======================= */
(function () {
  var w = {};
  vm.runInContext(read('edit-event-core.js'), vm.createContext({ window: w, console: console }));
  var fmtRange = w.RevampCore && w.RevampCore.fmtRange;
  check('2 the console\'s own date range is there to use', typeof fmtRange === 'function');
  var ev = { name: 'QA UX Brand World Summit 2026', published: false, start: '2026-12-05T10:41', end: '2026-12-07T18:00', venue: 'Taj Wellington Mews', city: 'Chennai' };
  var m = P.topbarMeta(ev, fmtRange);
  check('2 the observed event: its dates and place as the site prints them, no 10:41 nobody chose', m === 'Not published · 5–7 Dec 2026 · Taj Wellington Mews, Chennai', m);
  check('2 one day; a published site', P.topbarMeta({ published: true, start: '2027-03-14', venue: 'Jio World Centre', city: 'Mumbai' }, fmtRange) === 'Published · 14 Mar 2027 · Jio World Centre, Mumbai');
  check('2 a venue that already names its city is not doubled', P.topbarMeta({ start: '2027-03-14', venue: 'The Leela, Mumbai', city: 'Mumbai' }, fmtRange) === 'Not published · 14 Mar 2027 · The Leela, Mumbai');
  check('2 a month, a quarter or "to be announced": Create Event\'s own words', P.topbarMeta({ dateLabel: 'June 2027', venue: 'Bengaluru' }, fmtRange) === 'Not published · June 2027 · Bengaluru' &&
    P.topbarMeta({ dateLabel: 'Date to be announced' }, fmtRange) === 'Not published · Date to be announced');
  check('2 a place given only as a line', P.topbarMeta({ start: '2027-01-09', location: 'Online' }, fmtRange) === 'Not published · 9 Jan 2027 · Online');
  check('2 nothing yet: only whether it is published', P.topbarMeta({}, fmtRange) === 'Not published' && P.topbarMeta(null, fmtRange) === '');
  var rt = body('renderTopbar');
  check('2 the top bar uses it, not the start date with its time', /meta = editorPolish\.topbarMeta\(ev, RevampCore\.fmtRange\);/.test(rt) && rt.indexOf('fmtDT') === -1);

  var gb = blockFrom(INLINE, '(function initGenerateFromBriefNotice(){', ')();');
  check('2 the welcome reads plainly, without the broken sentence', /This draft is yours now\.<\/strong> Edit anything directly on the page\. ' \+\s*'Generating from the brief again makes a new draft and does not change this one\./.test(gb) &&
    gb.indexOf('Running Generate from a brief again') === -1 && gb.indexOf('right here') === -1, gb.slice(-900));
  check('2 it opens in the editor\'s own dialog, once the dialog is set up', /setTimeout\(function\(\)\{\s*openDialog\(\{/.test(gb) && !/modal: true/.test(gb));
  check('2 … which closes on its button, Escape and a click beside it, and each marks it seen',
    /onClose: function\(\)\{ store\(modalSeenKey, '1'\); \}/.test(gb) && /if \(e\.key === 'Escape'\)\{\s*e\.stopPropagation\(\);\s*if \(!opts\.modal\) close\(\);/.test(INLINE) &&
    /scrim\.addEventListener\('mousedown', function\(e\)\{ if \(e\.target === scrim && !opts\.modal\) close\(\); \}\);/.test(INLINE) && /if \(opts\.onClose\) opts\.onClose\(\);/.test(body('close', INLINE.slice(INLINE.indexOf('function openDialog(')))));
  // run it: the welcome shows once, and is seen after Escape as after its button
  var store = {}, opened = [];
  var c = vm.createContext({
    URLSearchParams: URLSearchParams, location: { search: '?from=create&slug=qa-ux-b21-x' }, editorEventId: 'qa-ux-b21-x',
    window: { RevampTemplateUI: { handoffFor: function () { return { generatedFromBrief: true }; } } },
    document: { getElementById: function () { return null; } },
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
    setTimeout: function (fn) { fn(); },
    openDialog: function (o) { opened.push(o); return { close: function () { if (o.onClose) o.onClose(); } }; }
  });
  vm.runInContext(gb, c);
  check('2 the welcome opens for a brief-made draft', opened.length === 1 && opened[0].title === 'Your site is ready to review' && opened[0].actions[0].label === 'Got it, let’s look', opened.length);
  if (opened[0]) opened[0].onClose();          // Escape, a click beside it or its button: openDialog calls onClose for each
  vm.runInContext(gb, c);
  check('2 once closed in any way it does not come back', opened.length === 1 && store['revamp.gbWelcomeSeen.qa-ux-b21-x'] === '1', store);
})();

/* ======================= 3 UX-088 the canvas menu, and settings saved by themselves ======================= */
(function () {
  // the runtime's plan, run on a stand-in page: the same function the live bar's layout() uses
  var parts = ['navLinkOf', 'navHidden', 'navWords', 'navPlan'].map(function (n) { return body(n, RUNTIME); });
  check('3 the runtime has the plan as a function of its own', parts.every(Boolean));
  check('3 … the live bar\'s layout() uses it', /var plan = navPlan\(root\);\s*\n\s*plan\.left\.forEach\(function \(li\) \{ li\.classList\.add\('is-over'\); \}\);/.test(RUNTIME));
  check('3 … and the editor can read it', /navPlan: navPlan,/.test(RUNTIME));
  var order = {};
  function section(id, pos, hidden) { order[id] = pos; return { id: id, hidden: false, editorHidden: !!hidden, style: { display: '' }, pos: pos,
    compareDocumentPosition: function (o) { return o.pos > this.pos ? 4 : 2; } }; }
  function link(href, text, extra) {
    var a = { href: href, textContent: text, attrs: extra || {}, hidden: false, style: { display: '' },
      getAttribute: function (k) { return k === 'href' ? href : (k in this.attrs ? this.attrs[k] : null); },
      hasAttribute: function (k) { return k in this.attrs; } };
    return { a: a, hidden: false, style: { display: '' }, hasAttribute: function () { return false; }, querySelector: function () { return a; } };
  }
  var secs = { sponsors: section('sponsors', 1, true), resources: section('resources', 2), agenda: section('agenda', 3) };
  var lis = [link('#sponsors', 'Sponsors'), link('#agenda', 'Agenda'), link('#faqs', 'FAQs'), link('#resources', 'Resources'), link('#register', 'Register', { 'data-rv-form': 'register' })];
  var list = { children: lis };
  var root = { querySelector: function (s) { return s === '.rv-etnav-list' ? list : null; }, querySelectorAll: function () { return []; } };
  var c = vm.createContext({
    resolveHash: function (h) { return secs[h.slice(1)] || null; }, pagesOf: function () { return []; },
    each: function (l, fn) { Array.prototype.forEach.call(l, fn); }, getComputedStyle: function (el) { return { display: el.style.display || 'block' }; }
  });
  vm.runInContext(parts.join('\n') + '; this.navPlan = navPlan;', c);
  var plan = c.navPlan(root, function (el) { return !el.editorHidden; });
  var ids = function (l) { return l.map(function (x) { return (x.li || x).a.textContent; }); };
  check('3 with the editor\'s rule: links in the order of their sections (Resources was moved above Agenda)', ids(plan.targets).join() === 'Resources,Agenda', ids(plan.targets));
  check('3 … the link to a hidden section and to a deleted one are left out', ids(plan.left).join() === 'Sponsors,FAQs', ids(plan.left));
  check('3 … a link that opens a form is kept, after them', ids(plan.forms).join() === 'Register');
  var live = c.navPlan(root);
  check('3 the page\'s own rule (no editor): a section the editor hides is still on a page that shows it', ids(live.targets).join() === 'Sponsors,Resources,Agenda', ids(live.targets));
  lis[1].a.attrs['data-rv-nav-empty'] = '';
  check('3 a link marked empty (its section has no records) is in no list: the page hides it itself', ids(c.navPlan(root, function () { return true; }).targets).indexOf('Agenda') === -1);
  delete lis[1].a.attrs['data-rv-nav-empty'];

  // the editor's rule for the canvas from that plan
  var idx = plan.targets.map(function (t) { return lis.indexOf(t.li); }).concat(plan.forms.map(function (li) { return lis.indexOf(li); }));
  var css = P.navRule('[data-rv-key="nav"] .rv-etnav-list', lis.length, idx);
  check('3 the canvas menu: kept links in visitors\' order, the others out of sight', css.split('\n').join('|') === [
    '[data-rv-key="nav"] .rv-etnav-list > li:nth-child(4){order:0}', '[data-rv-key="nav"] .rv-etnav-list > li:nth-child(2){order:1}', '[data-rv-key="nav"] .rv-etnav-list > li:nth-child(5){order:2}',
    '[data-rv-key="nav"] .rv-etnav-list > li:nth-child(1){display:none!important}', '[data-rv-key="nav"] .rv-etnav-list > li:nth-child(3){display:none!important}'].join('|'), css);
  check('3 an empty menu hides nothing it has not got', P.navRule('x', 0, []) === '');

  var pv = body('previewNav'), sv = body('shownToVisitors');
  check('3 the editor asks the runtime with its own idea of a hidden section', /rs\.navPlan\(root, shownToVisitors\)/.test(pv) && /closest\('\.is-hidden-sec, \[data-rv-empty\]'\)/.test(sv));
  check('3 … and writes the rule as the editor\'s own, in <head>: never saved, in no snapshot', /setAttribute\('data-rv-editor', ''\)/.test(pv) && /\(doc\.head \|\| doc\.documentElement\)\.appendChild\(st\)/.test(pv) &&
    /root\.querySelectorAll\('\[data-rv-editor\]'\)\.forEach\(function \(n\) \{ n\.remove\(\); \}\);/.test(CANVAS) && /api\.contentRoot\(\)\.children/.test(body('snapshot', CANVAS)));
  check('3 … again after every change, Undo and Redo, on opening and on another page', /previewNav\(\);/.test(body('pageChanged')) && /drawHeroVideo\(\);\s*\n\s*previewNav\(\);/.test(body('boot')) && /previewNav\(\);/.test(body('showPage')));

  check('3 Section edges say they are saved by themselves, and "Saving…" on the way', /id="dp-edges-saved" role="status">Saved by itself as you choose, no need to press Save\. Goes live when you publish\./.test(MARKUP) &&
    /edgesSaved\.textContent = info\.saving \? 'Saving…' : 'Saved by itself as you choose, no need to press Save\. Goes live when you publish\.';/.test(INLINE) && MARKUP.indexOf('Saved at once') === -1);
  check('3 Banner video says so too, and that a published site shows it without publishing again (as it does)', /<span class="dp-section-title">Banner video<\/span>\s*<span class="dp-autosave">Saved by itself as you change it, no need to press Save\. A published site shows it within a minute, without publishing again\.<\/span>/.test(MARKUP) &&
    /a change here is on the live site within a minute, without a publish/.test(read('hero-video-ui.js')));
  check('3 … marked with a tick', /\.dp-autosave::before\{ content:'\\2713';/.test(STYLE));
})();

/* ======================= 4 UX-083 Mobile ======================= */
(function () {
  var c = vm.createContext({});
  vm.runInContext((CANVAS.match(/  var PHONE = \{[^}]*\};/) || [''])[0] + body('phoneBox', CANVAS) + '; this.phoneBox = phoneBox;', c);
  var b = c.phoneBox(1000, 700);
  check('4 on a laptop: the phone\'s full width, centred, as tall as the canvas allows', b.scale === 1 && b.width === 390 && b.left === 305 && b.top === 26 && b.height === 648, b);
  b = c.phoneBox(1100, 1200);
  check('4 on a tall screen: a phone\'s height, no taller', b.height === 844, b);
  b = c.phoneBox(400, 700);
  check('4 where the canvas is narrower than a phone, scaled down to fit and still centred', b.scale < 1 && Math.abs(b.left + 390 * b.scale + b.left - 400) <= 1 && b.height * b.scale <= 700 - 52 + 1, b);
  var fit = body('fit', CANVAS);
  check('4 fit() puts a Mobile page in that box and leaves Desktop as it was', /viewport\.setAttribute\('data-device', device\);/.test(fit) && /var box = phoneBox\(viewport\.clientWidth, viewport\.clientHeight\);/.test(fit) &&
    /iframe\.style\.marginLeft = box\.left \+ 'px';/.test(fit) && /iframe\.style\.marginLeft = '';/.test(fit) && /scale = Math\.min\(1, viewport\.clientWidth \/ w\);/.test(fit));
  check('4 the editor page draws a phone round it, over the page so its corners are round, and the white card makes way',
    /\.frame\.tpl-frame\.is-phone\{ background:transparent; box-shadow:none; outline:0; \}/.test(STYLE) &&
    /\.tpl-viewport\[data-device="mobile"\]::before\{[^}]*pointer-events:none;[^}]*left:calc\(var\(--phone-left\) - 10px\);[^}]*border:10px solid #1c1a1f; border-radius:38px;/.test(STYLE) &&
    /viewport\.style\.setProperty\('--phone-width', Math\.round\(box\.width \* scale\) \+ 'px'\);/.test(fit) && /viewport\.style\.removeProperty\(k\)/.test(fit));
  check('4 the card is marked by a class, not by :has() (missing in Firefox before 121), and is white again once the canvas is gone',
    noComments(STYLE).indexOf(':has(') === -1 && /frame\.classList\.toggle\('is-phone', device === 'mobile'\);/.test(fit) &&
    /destroy: function \(\) \{ resizing\.disconnect\(\); viewport\.remove\(\); frame\.classList\.remove\('is-phone'\); \}/.test(CANVAS));
  // the phone's shadow reaches no further than the room phoneBox leaves round its edge, or the canvas cuts it off flat
  var phoneRule = (STYLE.match(/\.tpl-viewport\[data-device="mobile"\]::before\{[^}]*\}/) || [''])[0];
  var shadow = (/box-shadow:([^;]*);/.exec(phoneRule) || [])[1] || '';
  var gap = +((CANVAS.match(/var PHONE = \{[^}]*gap: (\d+)/) || [])[1]);
  var reach = shadow.split(/,(?![^(]*\))/).map(function (layer) {
    var n = (layer.match(/-?\d+(?:\.\d+)?px|\b0\b/g) || []).map(function (x) { return parseFloat(x) || 0; });
    // x y blur spread: the furthest any side goes past the edge
    return Math.max(Math.abs(n[0] || 0), Math.abs(n[1] || 0)) + (n[2] || 0) + (n[3] || 0);
  });
  check('4 the phone\'s shadow stays within the ' + gap + 'px round its edge', gap > 0 && reach.length === 2 && reach.every(function (r) { return r <= gap; }) && shadow.indexOf('--shadow-lg') === -1, { shadow: shadow, reach: reach, gap: gap });
  check('4 the selection pills follow the page wherever it sits (measured on screen)', /var f = iframe\.getBoundingClientRect\(\);/.test(body('screenRect', CANVAS)));
})();

/* ======================= 5 UX-085 focus you can see, and one stop for the page ======================= */
(function () {
  var offs = STYLE.match(/[^{}]*:focus-visible\{[^}]*outline:\s*none[^}]*\}/g) || [];
  check('5 no control loses its focus ring without another in its place', offs.every(function (r) { return /box-shadow/.test(r); }), offs);
  check('5 the style pop-over\'s buttons show a ring too', /\.button-settings-pop :focus-visible\{ outline: none; box-shadow: 0 0 0 2px var\(--surface\), 0 0 0 4px var\(--accent\); \}/.test(STYLE));
  check('5 the panel search shows one on its box', /\.panel-search:focus-within\{ border-color: var\(--accent\);/.test(STYLE));
  check('5 the old style bar\'s ring removal is gone', STYLE.indexOf('#global-toolbar :focus-visible') === -1);
  var mount = body('mount', CANVAS);
  check('5 the page is one stop, named with its keys; the site\'s links are out of the Tab order', /viewport\.tabIndex = 0;/.test(mount) && /viewport\.setAttribute\('role', 'group'\);/.test(mount) &&
    /aria-label', 'Site page\. Press Enter to choose a section and use its tools, the up and down arrows to move between sections, and Escape to come back here\.'/.test(mount) && /iframe\.tabIndex = -1;/.test(mount));
  check('5 its ring is drawn over the page', /\.tpl-viewport:focus-visible::after\{[^}]*border:3px solid var\(--accent\);[^}]*pointer-events:none;/.test(STYLE));

  // run wireCanvasKeys on a stand-in page
  function target() {
    var on = {};
    return { on: on, addEventListener: function (t, fn) { (on[t] = on[t] || []).push(fn); }, focused: 0, focus: function () { this.focused++; } };
  }
  var stop = target(), canvasDoc = target(), firstTool = { focused: 0, focus: function () { this.focused++; } }, selBar = target(), deselected = 0;
  var secsList = [{ n: 'hero' }, { n: 'agenda' }, { n: 'faq' }], timers = [], picked = [];
  var c = vm.createContext({
    canvas: { iframe: { parentNode: stop }, doc: canvasDoc }, remounting: false, aiWorking: false, activeSectionEl: null, selectedEl: null,
    secToolbar: { hidden: false, querySelector: function () { return firstTool; }, on: {}, addEventListener: function (t, fn) { (this.on[t] = this.on[t] || []).push(fn); } },
    selToolbar: selBar, deselect: function () { deselected++; },
    pageSections: function () { return secsList; }, positionToolbars: function () {}, busyToast: function () {},
    setTimeout: function (fn) { timers.push(fn); }
  });
  vm.runInContext(body('canvasStop') + body('wireCanvasKeys') + '; function selectSection(s) { activeSectionEl = s; selectedEl = null; this.picked = (this.picked || []).concat(s.n); } this.wire = wireCanvasKeys;', c);
  c.wire();
  c.wire();
  check('5 wired once per page, and the tools once for good', stop.on.keydown.length === 1 && canvasDoc.on.keydown.length === 1 && selBar.on.keydown.length === 1 && c.secToolbar.on.keydown.length === 1);
  function key(el, k, extra) { var e = { key: k, target: stop, prevented: false, preventDefault: function () { this.prevented = true; } }; Object.keys(extra || {}).forEach(function (x) { e[x] = extra[x]; }); el.on.keydown[0](e); return e; }
  var e = key(stop, 'ArrowDown');
  check('5 ↓ on the page picks its first section', e.prevented && c.activeSectionEl === secsList[0]);
  key(stop, 'ArrowDown'); key(stop, 'ArrowDown'); key(stop, 'ArrowDown');
  check('5 … and the next ones, stopping at the last', c.activeSectionEl === secsList[2]);
  key(stop, 'ArrowUp');
  check('5 ↑ the one before', c.activeSectionEl === secsList[1]);
  key(stop, 'Enter');
  timers.forEach(function (fn) { fn(); });
  check('5 Enter keeps that section and moves to its tools', c.activeSectionEl === secsList[1] && firstTool.focused === 1);
  check('5 other keys are left to the page', key(stop, 'a').prevented === false && key(stop, 'Enter', { metaKey: true }).prevented === false);
  c.aiWorking = true; c.activeSectionEl = null;
  key(stop, 'ArrowDown');
  check('5 while ETB2B AI is changing the page nothing is picked', c.activeSectionEl === null);
  c.aiWorking = false;
  var t = { key: 'Tab', prevented: false, preventDefault: function () { this.prevented = true; } };
  canvasDoc.on.keydown[0](t);
  check('5 Tab inside the page comes back to its stop instead of walking the site\'s links', t.prevented && stop.focused === 1);
  var before = stop.focused;
  c.secToolbar.on.keydown[0]({ key: 'Escape' });
  check('5 Escape from a section\'s tools lets go of it and comes back to the page', deselected === 1 && stop.focused === before + 1);
  selBar.on.keydown[0]({ key: 'Escape' });
  check('5 … and so from an element\'s tools', deselected === 2 && stop.focused === before + 2);
  selBar.on.keydown[0]({ key: 'b' });
  check('5 … other keys in the tools are theirs', deselected === 2 && stop.focused === before + 2);
  check('5 Escape elsewhere still lets go of the selection, as before', /if \(e\.key === 'Escape'\) \{ deselect\(\); return; \}/.test(body('onGlobalKey')));
  check('5 wired with every mount of the canvas', /canvas\.win\.addEventListener\('keydown', onGlobalKey\);\s*\n\s*wireCanvasKeys\(\);/.test(body('wireCanvasEvents')));
})();

/* ======================= 6 UX-087 the greeting, once per person ======================= */
(function () {
  var iife = blockFrom(INLINE, "(function(){\n    var launcher = document.getElementById('chat-launcher');\n    if (!launcher) return;", ')();');
  check('6 the greeting\'s script is there, apart from the launcher\'s', !!iife && iife.indexOf('setOpen') === -1);
  function run(store, uid) {
    var classes = {}, timers = [], listeners = {}, winListeners = {};
    function el() { return { hidden: false, classList: { add: function (c) { classes[c] = 1; }, contains: function (c) { return !!classes[c]; } }, setAttribute: function () {}, addEventListener: function (t, fn) { (this.on = this.on || {})[t] = fn; }, focus: function () {} }; }
    var els = { 'panel-chat': el(), 'chat-launcher': el(), 'chat-close': el(), 'chat-input': el() };
    var c = vm.createContext({
      document: { getElementById: function (id) { return els[id]; }, addEventListener: function (t, fn, o) { listeners[t] = { fn: fn, o: o }; }, activeElement: null },
      window: { RevampAuth: { currentUser: function () { return uid ? { uid: uid } : null; }, whenResolved: function () { return { then: function () {} }; } }, addEventListener: function (t, fn) { winListeners[t] = fn; }, dispatchEvent: function () {} },
      RevampAuth: { currentUser: function () { return uid ? { uid: uid } : null; }, whenResolved: function () { return { then: function () {} }; } },
      localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
      setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); }, Event: function () {}
    });
    vm.runInContext(iife, c);
    return { classes: classes, timers: timers, listeners: listeners, winListeners: winListeners, doc: c.document, launcher: els['chat-launcher'] };
  }
  var store = {};
  var first = run(store, 'u1');
  check('6 the first time, the greeting shows', !first.classes['is-quiet']);
  var t = first.timers.filter(function (x) { return x.ms === 8000; })[0];
  check('6 … and folds to the face after 8 seconds', !!t);
  if (t) t.fn();
  check('6 … remembered for that person', first.classes['is-quiet'] === 1 && store['revamp.aiGreeted.u1'] === '1', store);
  check('6 the next visit opens with the face only', run(store, 'u1').classes['is-quiet'] === 1);
  check('6 another person on this browser is greeted once too', !run(store, 'u2').classes['is-quiet']);
  var third = run({}, 'u3');
  check('6 the first click on the editor folds it', third.listeners.mousedown && third.listeners.mousedown.o.once === true && (third.listeners.mousedown.fn(), third.classes['is-quiet'] === 1));
  var fourth = run({}, 'u4');
  fourth.doc.activeElement = { tagName: 'IFRAME' };
  fourth.winListeners.blur();
  check('6 … so does the first click on the page itself (the focus goes into the canvas)', fourth.classes['is-quiet'] === 1);
  var fifth = run({}, 'u5');
  fifth.launcher.on.click();
  check('6 … and opening the chat from the keyboard', fifth.classes['is-quiet'] === 1);
  var none = vm.createContext({ document: { getElementById: function () { return null; }, addEventListener: function () { throw new Error('wired with no launcher'); } }, setTimeout: function () { throw new Error('timed with no launcher'); } });
  check('6 a page without this launcher has no greeting to fold, and nothing is wired', (function () { try { vm.runInContext(iife, none); return true; } catch (e) { return String(e.message); } })() === true);
  var launch = blockFrom(INLINE, "(function(){\n    var chat = document.getElementById('panel-chat'), launcher = document.getElementById('chat-launcher');", ')();');
  check('6 the launcher\'s own script is as it was (opening it still quiets the greeting)', !!launch && /if \(open\)\{\n\s*launcher\.classList\.add\('is-quiet'\);/.test(launch) && launch.indexOf('aiGreeted') === -1);
  var pad = /\.stage\{[^}]*padding: var\(--stage-pad-top\) 24px (\d+)px;/.exec(STYLE);
  check('6 the canvas keeps a gutter clear of the launcher\'s face (22px + 62px from the bottom)', pad && +pad[1] >= 84 + 16, pad && pad[1]);
})();

/* ======================= 7 ES5 ======================= */
(function () {
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still run */ }
  check('7 esbuild is there to check ES5', !!esbuild);
  if (!esbuild) return;
  [['editor-template-ui.js', SRC], ['editor-canvas.js', CANVAS], ['templates/_shared/et-runtime.js', RUNTIME], ['custom_editor.html (its script)', INLINE]].forEach(function (f) {
    var es5 = (function () { try { esbuild.transformSync(f[1], { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('7 ' + f[0] + ' is ES5 by esbuild', es5 === true, es5);
  });
})();

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
