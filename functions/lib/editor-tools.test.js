// node functions/lib/editor-tools.test.js — the site editor's tools say what they change and are where people look
// for them (UX batch B14: UX-075, UX-077, UX-078, UX-079, UX-080, UX-081, UX-082).
//   1 editorWords, run as it is from editor-template-ui.js: the logo check's one line and its details (UX-082),
//     when copy that came with an added section is still a placeholder, and the question before publishing (UX-081)
//   2 setOpening, run on a stand-in page: while the site opens the canvas says so and the tools wait (UX-077)
//   3 the page can open: every element the editor's own script looks up is in the page or made by the editor (the
//     half-built style bar removal once stopped the editor opening at all)
//   4 the whole site's look is in the Theme panel and says so; one text's look is on its own toolbar (UX-075, UX-080)
//   5 the top bar keeps the event's name readable, and the light/dark switch works from the account menu; the tools
//     row tightens, then scrolls with arrows, so no tool is cut with a side panel open on a multi-page site (UX-078)
//   6 no browser pop-ups in the editor: Add → Image, Alt text, the developer zone's questions (UX-079)
//   7 placeholders are marked, settled, gated before publishing and never published; the picker's cards never
//     cover one another in a short window (UX-081)
//   8 ES5
// No network, no AI, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var SRC = read('editor-template-ui.js');
var PAGE = read('custom_editor.html');
var AUTH = read('auth.js');
var TOGGLE = read('theme-toggle.js');
var SIDEBAR = read('sidebar.js');
var CANVAS_CSS = read('editor-canvas.css');
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
function noComments(s) { return s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''); }
// the page's own script (the last inline <script>), and its markup without any script
var SCRIPTS = PAGE.match(/<script>([\s\S]*?)<\/script>/g) || [];
var INLINE = SCRIPTS.length ? SCRIPTS[SCRIPTS.length - 1].replace(/^<script>|<\/script>$/g, '') : '';
var MARKUP = PAGE.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

/* ======================= 1 editorWords ======================= */
var BEGIN = '/* editorWords:begin', END = '/* editorWords:end */';
var at = SRC.indexOf(BEGIN), to = SRC.indexOf(END);
check('1 the words block is marked once', at !== -1 && to > at && SRC.indexOf(BEGIN, at + 1) === -1, { at: at, to: to });
var BLOCK = SRC.slice(at, to);
var ctx = vm.createContext({});
vm.runInContext(BLOCK, ctx, { filename: 'editor-template-ui.js#editorWords' });
var E = ctx.editorWords;
check('1 the block defines editorWords', !!E && typeof E.logoHeadline === 'function' && typeof E.placeholderAsk === 'function');
check('1 the block names nothing of the editor or the page', !/(^|[^.\w$])(window|document|canvas|eventId|host|showToast|localStorage|RevampCore|setTimeout)\b(?!\s*:)/.test(noComments(BLOCK)));

(function () {
  // the notes as functions/lib/api.js writes them on a site's logo (data-rv-logo-note), joined as it joins them
  var MOVED = 'The year in the logo unit was changed from ’26 to ’27, redrawn in its own lettering; everything else in it is untouched. Check how it sits, and replace the picture if you have this edition\'s artwork.';
  var TALL = 'The previous edition\'s logo is taller than it is wide; nothing in it was read as a sponsor\'s mark, so it is used whole. If it does carry one, upload this year\'s logo under Event logo in the event\'s Basics, or select it and use Replace image.';
  var h = E.logoHeadline(MOVED + ' ' + TALL);
  check('1 UX-082 the observed note becomes one line: what was changed, from what to what', h === 'Check the logo: the year in the previous edition’s logo was changed from ’26 to ’27.', h);
  check('1 … however long the note, the line is short', h.length < 90 && h.indexOf('logo unit') === -1 && h.indexOf('lock-up') === -1, h.length);
  check('1 … and says nothing of "Answer this before publishing" (Publish says that)', !/before publishing/i.test(h));
  h = E.logoHeadline('The year in your logo was changed from 2025 to 2026; everything else in it is untouched.');
  check('1 the owner\'s own logo is "your logo"', h === 'Check your logo: its year was changed from 2025 to 2026.', h);
  h = E.logoHeadline(TALL);
  check('1 a tall logo used whole', h === 'Check the logo: the previous edition’s logo is used whole.', h);
  h = E.logoHeadline('The previous edition\'s logo shows 2025 and could not be updated to 2026, so the event\'s name is set in type instead.');
  check('1 a year that could not be moved', h === 'Check the logo: the previous edition’s logo shows 2025, so the event’s name is shown instead.', h);
  h = E.logoHeadline('Your uploaded logo could not be used here (it is a JPEG with a white box), so the hero does not show it. Upload it again under Event logo.');
  check('1 an upload that could not be used', h === 'Your uploaded logo could not be used, so the banner does not show it.', h);
  h = E.logoHeadline('Your logo shows 2025, not 2026, and that could not be changed without redrawing it. Upload this year\'s logo under Event logo in the event\'s Basics.');
  check('1 the owner\'s logo with last year on it', h === 'Check your logo: it shows 2025, not 2026.', h);
  h = E.logoHeadline('“kyndryl presents” belonged to the previous edition and was cropped out of the logo unit; the rest of it is untouched.');
  check('1 a sponsor\'s line cropped out', h === 'Check the logo: part of it was cropped out.', h);
  h = E.logoHeadline('Your logo was checked: it shows 2026 and nothing from another edition, so it is used exactly as you uploaded it.');
  check('1 the owner\'s logo, checked and used as uploaded', h === 'Check your logo: it is used exactly as you uploaded it.', h);
  check('1 a note no rule reads still gives a line', E.logoHeadline('Something new the generator says.') === 'Check the logo at the top of the site.' && E.logoHeadline('') === '');
  // the earliest sentence decides: the year moved first, then the tall logo
  check('1 the first sentence that says something decides the line', /changed from ’26 to ’27/.test(E.logoHeadline(MOVED + ' ' + TALL)) && /used whole/.test(E.logoHeadline(TALL + ' ' + MOVED)));

  var d = E.plainLogoNote(MOVED + ' ' + TALL);
  check('1 the details are the whole note, in plain words: no "logo unit"', d.indexOf('logo unit') === -1 && /^The year in the logo was changed from ’26 to ’27/.test(d), d);
  check('1 … no "lock-up", and "hero" is the banner', E.plainLogoNote('part of this edition\'s own lock-up, shown in the hero').indexOf('lock-up') === -1 &&
    /the banner/.test(E.plainLogoNote('so the hero does not show it')), E.plainLogoNote('part of this edition\'s own lock-up'));
  check('1 … and keep everything else, whitespace tidied', E.plainLogoNote('  Check   how it sits.\n') === 'Check how it sits.');
})();

(function () {
  check('1 UX-081 a text still as it came is a placeholder', E.placeholderLeft('text', 'A clear overview of what awaits', '  A clear overview of\n what awaits ', false) === true);
  check('1 … written over, it is not', E.placeholderLeft('text', 'A clear overview of what awaits', 'Three days of retail leadership', false) === false);
  check('1 … emptied, it is not (nothing of it would go live)', E.placeholderLeft('text', 'New heading', '   ', false) === false);
  check('1 a button keeps the same rule', E.placeholderLeft('button', 'Learn more', 'Learn more', false) === true && E.placeholderLeft('button', 'Learn more', 'Register now', false) === false);
  check('1 an empty picture box is one until it shows a picture', E.placeholderLeft('image', '', '', false) === true && E.placeholderLeft('image', '', 'Event image', true) === false);

  var w = E.placeholderAsk(2, 1, 'A clear overview of what awaits', 'Send for approval');
  check('1 the question counts texts and pictures', w.title === '2 placeholder texts and 1 empty picture are still on the page', w.title);
  check('1 … quotes one of them, says it would go live and where they are marked', /such as “A clear overview of what awaits”/.test(w.text) && /would go live as they are/.test(w.text) && /dashed amber outline/.test(w.text), w.text);
  check('1 … offers Show them, and goes on with the Publish button\'s own words', w.show === 'Show them' && w.anyway === 'Send for approval anyway', w);
  w = E.placeholderAsk(1, 0, 'New heading', 'Publish changes');
  check('1 one is "is", "it", "Show it"', w.title === '1 placeholder text is still on the page' && /^It came with/.test(w.text) && /as it is\./.test(w.text) && w.show === 'Show it' && w.anyway === 'Publish changes anyway', w);
  w = E.placeholderAsk(0, 3, '', '');
  check('1 pictures only, and no sample to quote', w.title === '3 empty pictures are still on the page' && w.text.indexOf('such as') === -1 && w.anyway === 'Publish anyway', w);
  w = E.placeholderAsk(1, 0, 'Add a concise introduction that explains the purpose, audience, and energy of your event.', 'Publish');
  check('1 a long sample is cut at a word', /such as “Add a concise introduction that explains the purpose,…”/.test(w.text) || /such as “Add a concise introduction that explains the[^”]*…”/.test(w.text), w.text);
})();

/* ======================= 2 setOpening (UX-077) ======================= */
(function () {
  var src = body('setOpening');
  check('2 setOpening is there', !!src);
  function el(id) {
    var attrs = {};
    return { id: id, hidden: false, textContent: '',
      setAttribute: function (k, v) { attrs[k] = String(v); }, removeAttribute: function (k) { delete attrs[k]; },
      getAttribute: function (k) { return k in attrs ? attrs[k] : null; }, attrs: attrs };
  }
  var root = el('ed'), main = el('main'), box = el('stage-loading'), title = el('t'), line = el('l');
  var rail = [el('add'), el('sections'), el('more')];
  var byId = { 'stage-loading': box, 'stage-loading-title': title, 'stage-loading-step': line };
  var doc = {
    querySelector: function (s) { return s === '.ed' ? root : s === '.ed-main' ? main : null; },
    getElementById: function (id) { return byId[id] || null; },
    querySelectorAll: function (s) { return s === '.ed-rail button' ? rail : []; }
  };
  var c = vm.createContext({ document: doc, Array: Array, currentEvent: { name: 'Brand World Summit 2026' }, eventId: 'qa-ux-b14-x' });
  vm.runInContext(src + '; this.setOpening = setOpening;', c);
  c.setOpening('Loading the site…');
  check('2 while it opens the canvas names the event and the step', box.hidden === false && title.textContent === 'Opening Brand World Summit 2026…' && line.textContent === 'Loading the site…', [title.textContent, line.textContent]);
  check('2 … the editor is marked opening and busy', root.getAttribute('data-opening') === '' && main.getAttribute('aria-busy') === 'true');
  check('2 … and the tools say they are not ready', rail.every(function (b) { return b.getAttribute('aria-disabled') === 'true'; }));
  c.currentEvent = null;
  c.setOpening('Loading the event…');
  check('2 before the event is known: "Opening the site…"', title.textContent === 'Opening the site…' && line.textContent === 'Loading the event…', title.textContent);
  c.setOpening(null);
  check('2 once open: the message goes and the tools are ready', box.hidden === true && root.getAttribute('data-opening') === null && main.getAttribute('aria-busy') === null &&
    rail.every(function (b) { return b.getAttribute('aria-disabled') === null; }));

  var boot = body('boot');
  var atNull = boot.indexOf('setOpening(null)'), atHero = boot.indexOf('applyAiHero(heroDraft)');
  check('2 the site is shown open before ETB2B AI\'s hero picture goes in (both kept from the merge)', atNull !== -1 && atHero !== -1 && atNull < atHero, { atNull: atNull, atHero: atHero });
  check('2 each step of opening is said', ['Loading the site…', 'Opening the latest version…', 'Adding your Content-tab records…'].every(function (s) { return boot.indexOf("setOpening('" + s + "')") !== -1; }));
  check('2 a site that cannot open puts the message away for its own', /setOpening\(null\)/.test(body('showLoadError')));
  var start = body('start');
  check('2 who approves is asked beside the event, not after every section', start.indexOf('prefetchApproval()') !== -1 && start.indexOf('prefetchApproval()') < start.indexOf('RevampCore.fetchEvent'));
  check('2 … and loadSiteInfo takes that answer unless something was saved since', /approvalAsk && !siteInfo \? approvalAsk : RevampCore\.fetchApproval\(eventId\)/.test(body('loadSiteInfo')));
  check('2 an address without the site opens it in place, not by loading the page again', /history\.replaceState/.test(start) && !/location\.replace\(/.test(noComments(start)));
  check('2 the page starts marked opening, with the message in the canvas', /<div class="ed" data-opening>/.test(PAGE) && /id="stage-loading"[^>]*role="status"/.test(PAGE) && /<main class="ed-main" aria-busy="true">/.test(PAGE));
  check('2 the tools wait from the keyboard too', /function siteOpening\(\)/.test(INLINE) && /if \(siteOpening\(\)\) return;\s*\n\s*if \(name === 'predefined'\)/.test(INLINE));
  check('2 the event rail\'s Design opens the editor directly (the event was loaded twice through the console)',
    /if \(section === 'design'\)\s+return '\/custom_editor\.html\?event=' \+ ev;/.test(SIDEBAR));
})();

/* ======================= 3 the page can open ======================= */
(function () {
  var known = {};
  // ids in the page (markup and the strings its script writes) and the ones the editor's scripts make
  [PAGE, SRC, read('editor-ai-mode.js'), read('editor-forms.js'), read('share-preview.js'), read('hero-video-ui.js'), read('sidebar.js'), read('auth.js')].forEach(function (s) {
    var m, re = /\bid\s*=\s*\\?["']([A-Za-z][\w-]*)\\?["']|\.id\s*=\s*'([A-Za-z][\w-]*)'/g;
    while ((m = re.exec(s))) known[m[1] || m[2]] = true;
  });
  var missing = [], m, re = /getElementById\('([A-Za-z][\w-]*)'\)/g;
  var code = noComments(INLINE);
  while ((m = re.exec(code))) if (!known[m[1]]) missing.push(m[1]);
  check('3 every element the page\'s script looks up exists (else the editor never opens)', missing.length === 0, missing);
  var gone = ['global-toolbar', 'gt-scope', 'gt-sel-hint', 'gt-body-more-menu', 'btn-ai-markers', 'rail-btn-dev', 'gt-body-text-color', 'gt-heading-font-family', 'gt-sel-color'];
  check('3 the style bar and the top-bar markers icon are gone, markup and script alike', gone.every(function (id) { return PAGE.indexOf(id) === -1; }), gone.filter(function (id) { return PAGE.indexOf(id) !== -1; }));
  check('3 nothing calls what was taken out', !/syncGtTools|applyGtScope|gtTools\b/.test(code));
  /* a second function of the same name silently replaces the first in its scope: the early approval fetch, once
     named askApproval like Publish's "Send for approval" question, stopped the editor opening */
  [['editor-template-ui.js', SRC], ['custom_editor.html', INLINE]].forEach(function (f) {
    var seen = {}, twice = [], fm, fre = /^  function ([A-Za-z0-9_$]+)\(/gm;
    while ((fm = fre.exec(f[1]))) { if (seen[fm[1]]) twice.push(fm[1]); seen[fm[1]] = true; }
    check('3 no two functions of ' + f[0] + ' share a name', twice.length === 0, twice);
  });
})();

/* ======================= 4 the site's look vs one text's look (UX-075, UX-080) ======================= */
(function () {
  var c = vm.createContext({});
  var defs = INLINE.slice(INLINE.indexOf('var TEMPLATE_DEFAULT'), INLINE.indexOf('var gtOpenTool'));
  check('4 the Theme panel\'s settings are one list', defs.indexOf('var SITE_TOOLS') !== -1 && defs.indexOf('var SEL_TOOLS') !== -1);
  vm.runInContext(defs + '; this.SITE_TOOLS = SITE_TOOLS; this.SEL_TOOLS = SEL_TOOLS;', c);
  var SITE = c.SITE_TOOLS, SEL = c.SEL_TOOLS;
  var designKeys = (SRC.match(/var DESIGN_KEYS = \[([\s\S]*?)\];/) || [])[1] || '';
  var keys = SITE.map(function (t) { return t.key; });
  check('4 every row is a setting the editor knows', keys.every(function (k) { return designKeys.indexOf("'" + k + "'") !== -1; }), keys);
  var markupKeys = (MARKUP.match(/data-design-key="(\w+)"/g) || []).map(function (s) { return s.replace(/.*="|"/g, ''); });
  check('4 no setting is offered twice (the old bar and the panel both had the heading font)', keys.concat(markupKeys).length === new Set(keys.concat(markupKeys)).size, keys.concat(markupKeys));
  var everything = ['bgColor', 'textColor', 'bgImage', 'bgOpacity', 'bodyFont', 'bodySize', 'bodyWeight', 'headingFont', 'headingSize', 'headingWeight', 'headingColor', 'headingCase', 'headingAlign', 'sectionSpacing', 'divider', 'animation', 'themeColor', 'radius', 'reveals'];
  check('4 everything the style bar held is in the Theme panel', everything.every(function (k) { return keys.indexOf(k) !== -1 || markupKeys.indexOf(k) !== -1; }), everything.filter(function (k) { return keys.indexOf(k) === -1 && markupKeys.indexOf(k) === -1; }));
  var groups = {};
  SITE.forEach(function (t) { groups[t.group] = true; });
  check('4 each group has its place in the panel', Object.keys(groups).every(function (g) { return MARKUP.indexOf('data-th-group="' + g + '"') !== -1; }), Object.keys(groups));
  check('4 "Font Type" says what it is: Capitals', SITE.filter(function (t) { return t.key === 'headingCase'; })[0].label === 'Capitals');
  check('4 each row says what changed across the whole site', SITE.every(function (t) { return typeof t.said === 'string' && t.said.length > 3; }) &&
    /function siteSaid\(tool, ok\)\{ return saidWithUndo\(ok, tool\.said \+ ' changed across the whole site\.'\); \}/.test(INLINE));
  check('4 … with Undo, recorded first so Undo takes back that change', /offerUndo: function \(msg\) \{ flush\(\); if \(!aiWorking\) offerUndo\(msg\); \}/.test(SRC) &&
    /window\.RevampTemplateUI\.offerUndo\(msg\)/.test(INLINE));
  check('4 the panel is "Theme" and says it is the whole site', />Theme<\/button>/.test(MARKUP) && /<h3 id="panel-design-title">Theme<\/h3>/.test(MARKUP) && /Everything here changes the whole site/.test(MARKUP));
  check('4 the site-wide color pop-over is titled "Whole site: …"', /'Whole site: ' \+ tool\.said/.test(INLINE));
  check('4 the panel\'s own controls say "across the whole site" too', (INLINE.match(/changed across the whole site\./g) || []).length >= 4);

  check('4 one text\'s own look: font, size, weight, color', SEL.map(function (t) { return t.sel; }).join() === 'fontFamily,fontSize,fontWeight,color');
  var tb = body('buildToolbar');
  check('4 UX-075 a selected text and a selected button carry "Aa" on their own toolbar', /data-action="text-style"/.test(tb) && /type === 'text'[\s\S]*look[\s\S]*type === 'button'[\s\S]*html \+= look/.test(tb));
  check('4 … which opens that element\'s own style, not the site\'s', /action === 'text-style'\) \{\s*if \(host\.styleSelection\) host\.styleSelection\(btn, selectedEl\.getAttribute\('data-editable'\)\);/.test(SRC) &&
    /styleSelection: openSelectionStyle/.test(INLINE) && /'This ' \+ kind \+ ' only'/.test(INLINE) && /ui\.styleSelected\(props\)/.test(body('openSelectionStyle', INLINE)));
  check('4 … and says it changed this text only, with Undo', /' changed for this ' \+ kind \+ ' only\.'/.test(INLINE));
  check('4 the selection\'s pop-over closes when another element is selected', /gtOpenTool === SEL_TOOLS\) closeGtStylePop\(\)/.test(body('onCanvasSelection', INLINE)));
  check('4 the hints that sent people to "Selected text" now send them to Aa', SRC.indexOf('use “Selected text”') === -1 && /use Aa on its toolbar/.test(SRC));

  check('4 the developer zone is under ⋯ More, not a main tab nor on every section pill', /id="rail-btn-more"[^>]*aria-haspopup="menu"/.test(MARKUP) && /id="rail-more-dev"/.test(MARKUP) &&
    /RevampTemplateUI\.openDevZone\(\)/.test(INLINE) && body('buildSecToolbar').indexOf('dev-section') === -1);
})();

/* ======================= 5 the top bar (UX-078) ======================= */
(function () {
  var top = (MARKUP.match(/<header class="topbar">([\s\S]*?)<\/header>/) || [])[1] || '';
  check('5 the top bar holds what acts on this site only: no theme switch, no markers icon', top.indexOf('data-theme-toggle-target') === -1 && top.indexOf('btn-ai-markers') === -1);
  check('5 the event\'s name keeps its room', /\.topbar \.ev-title\{[^}]*min-width:180px;[^}]*flex:1 1 220px;/.test(PAGE) && /\.topbar \[data-rv-account\]\{ flex-shrink:0; \}/.test(PAGE));
  check('5 its meta line is in its tooltip when cut', /metaEl\.title = meta/.test(SRC));
  check('5 the page switcher is in the tools row', /document\.querySelector\('\.ed-rail \.rail-fixed'\)/.test(body('renderPageSwitch')));
  check('5 the mode switch keeps short words below 1180 px and its names for screen readers',
    /aria-label="Edit with AI"/.test(top) && /aria-label="Edit myself"/.test(top) && /class="mt-short"[^>]*>AI</.test(top) && /class="mt-short"[^>]*>Myself</.test(top) &&
    /@media \(max-width: 1180px\)\{ \.mode-toggle \.mt-long\{ display:none; \} \.mode-toggle \.mt-short\{ display:inline; \}/.test(PAGE) &&
    !/\.mode-toggle button span\{ position:absolute; width:1px/.test(PAGE));
  check('5 the AI markers switch is in Layers', /id="lyr-ai-markers"/.test(MARKUP) && /getElementById\('ai-markers-toggle'\)/.test(body('initAiProvenanceToggle', INLINE)));

  /* the tools row with a side panel open on a multi-page site: moving the page switch into the row cut "⋯ More"
     at 1100 px and "Forms" at 1024 (re-check of UX-078). toolsRowFitter, run as it is from the page, on a
     stand-in row whose sizes follow its classes the way the CSS makes them: the tools' own words, the space
     around each (12, 8 or 6 px a side) and the page switch's width */
  var FB = '/* toolsRowFitter:begin */', FE = '/* toolsRowFitter:end */';
  var fa = INLINE.indexOf(FB), fz = INLINE.indexOf(FE);
  check('5 the tools row\'s fitting is marked once in the page', fa !== -1 && fz > fa && INLINE.indexOf(FB, fa + 1) === -1);
  var fctx = vm.createContext({});
  vm.runInContext(INLINE.slice(fa, fz), fctx, { filename: 'custom_editor.html#toolsRowFitter' });
  var fitter = fctx.toolsRowFitter;
  check('5 the fitting names nothing of the page but what it is given', typeof fitter === 'function' && !/(^|[^.\w$])(window|document)\b/.test(noComments(INLINE.slice(fa, fz))));
  (function () {
    function classes() {
      var s = {};
      return { s: s, add: function (k) { s[k] = 1; }, remove: function (k) { delete s[k]; }, contains: function (k) { return !!s[k]; },
        toggle: function (k, on) { if (on) s[k] = 1; else delete s[k]; } };
    }
    var room = { w: 1400 }, active = { i: -1 };
    var rail = { classList: classes() }, R = rail.classList.s;
    var WORDS = [25, 53, 41, 42, 38, 40];   // Add, Sections, Layers, Theme, Forms, "⋯ More" ("⋯" alone is 14)
    function pad() { return R['is-snugger'] ? 6 : R['is-snug'] ? 8 : 12; }
    function gap() { return R['is-snug'] ? 2 : 4; }
    function btnW(i) { return (i === 5 && R['is-snugger'] ? 14 : WORDS[i]) + 2 * pad(); }
    function offset(i) { var x = 0; for (var k = 0; k < i; k++) x += btnW(k) + gap(); return x; }
    function content() { return offset(WORDS.length - 1) + btnW(WORDS.length - 1); }
    function pageSwitch() { return R['is-snugger'] ? 106 : R['is-snug'] ? 134 : 154; }
    function clientW() { return Math.max(0, room.hidden ? 0 : room.w - (R['is-snug'] ? 16 : 28) - (134 + pageSwitch()) - gap() - (R['has-more'] ? 2 * (22 + gap()) : 0)); }
    var left = 0;
    var tools = {
      classList: classes(),
      get clientWidth() { return clientW(); },
      get scrollWidth() { return room.hidden ? 0 : Math.max(content(), clientW()); },
      get scrollLeft() { return Math.min(left, Math.max(0, this.scrollWidth - clientW())); },
      set scrollLeft(v) { left = Math.max(0, Math.min(v, Math.max(0, this.scrollWidth - clientW()))); },
      getBoundingClientRect: function () { return { left: 0, right: clientW() }; },
      querySelector: function () {
        if (active.i < 0) return null;
        return { getBoundingClientRect: function () { var l = offset(active.i) - tools.scrollLeft; return { left: l, right: l + btnW(active.i) }; } };
      }
    };
    var back = { disabled: false }, fwd = { disabled: false };
    var row = fitter(rail, tools, back, fwd);
    function state() { return Object.keys(R).sort().join(' '); }
    function allIn() { return content() <= clientW() + 1; }

    row.fit();
    check('5 a wide row is left as it is, no arrows', state() === '' && allIn() && back.disabled && fwd.disabled && !tools.classList.s['more-end'], state());
    room.w = 680; row.fit();
    check('5 a little short: it tightens once and every tool is in view', state() === 'is-snug' && allIn(), [state(), content(), clientW()]);
    room.w = 580; active.i = 4; row.fit();
    check('5 shorter (1024 px with a panel open): it tightens again, every tool still in view', state() === 'is-snug is-snugger' && allIn(), [state(), content(), clientW()]);
    room.w = 400; active.i = -1; tools.scrollLeft = 0; row.fit();
    check('5 too short even then: the row scrolls, with an arrow at each end', state() === 'has-more is-snug is-snugger' && !allIn(), state());
    check('5 … at its start: the back arrow is off, the forward arrow on, the far edge fades', back.disabled === true && fwd.disabled === false && !!tools.classList.s['more-end'] && !tools.classList.s['more-start']);
    active.i = 4; row.fit();
    var r = tools.querySelector().getBoundingClientRect();
    check('5 … the tool whose panel is open (Forms) is scrolled into view', r.left >= 0 && r.right <= clientW() && tools.scrollLeft > 0, [r, clientW(), tools.scrollLeft]);
    check('5 … and the arrows follow where the row is', back.disabled === false && !!tools.classList.s['more-start']);
    tools.scrollLeft = 0; active.i = 0; row.fit();
    r = tools.querySelector().getBoundingClientRect();
    check('5 … a tool at the start is brought back the other way', r.left >= 0 && r.right <= clientW(), [r, tools.scrollLeft]);
    room.w = 1400; row.fit();
    check('5 room again (the panel or the chat closed): back as it was, no arrows, nothing scrolled', state() === '' && tools.scrollLeft === 0 && back.disabled && fwd.disabled && !tools.classList.s['more-start'] && !tools.classList.s['more-end'], state());
    room.w = 400; room.hidden = true; row.fit();
    check('5 tools put away ("Edit with AI"): nothing is tightened or scrolled', state() === '', state());
  })();
  check('5 the row is fitted again whenever its room changes: the window, a panel or the chat, the page switch, the tools coming back',
    /watch\.observe\(rail\); watch\.observe\(tools\); watch\.observe\(rail\.querySelector\('\.rail-fixed'\)\);/.test(INLINE) && /window\.addEventListener\('resize', refit\)/.test(INLINE));
  check('5 … and when a panel opens, so its tool is in view', /refitToolsRow\(\);/.test(body('openPanel', INLINE)));
  check('5 the CSS of each step: less space around the tools, "Page" and More\'s word put away, the switch narrower',
    /\.ed-rail\.is-snug \.rail-btn\{ padding: 0 8px; \}/.test(PAGE) && /\.ed-rail\.is-snug \.ed-page-switch-label\{ position:absolute;/.test(PAGE) &&
    /\.ed-rail\.is-snugger \.rail-btn\{ padding: 0 6px; \}/.test(PAGE) && /\.ed-rail\.is-snugger \.rail-more-word\{ display:none; \}/.test(PAGE) && /\.ed-rail\.is-snugger \.ed-page-switch select\{ max-width: 92px; \}/.test(PAGE));
  check('5 More keeps its name for screen readers when only "⋯" shows', /id="rail-btn-more"[^>]*aria-label="More tools"[^>]*>&#8943; <span class="rail-more-word">More<\/span><\/button>/.test(MARKUP));
  check('5 the arrows are out of the tab order (Tab reaches every tool) and only shown while the row scrolls',
    /id="rail-scroll-back" data-dir="-1" tabindex="-1" aria-hidden="true"/.test(MARKUP) && /id="rail-scroll-fwd" data-dir="1" tabindex="-1" aria-hidden="true"/.test(MARKUP) &&
    /\.rail-scroll\{ display:none;/.test(PAGE) && /\.ed-rail\.has-more \.rail-scroll\{ display:block; \}/.test(PAGE) && /body\.ed-mode-ai \.rail-scroll\{ display:none !important; \}/.test(PAGE));
  check('5 a page name cut by the narrower switch is in full on hover', /select\.title = shown \? shown\.title : '';/.test(body('renderPageSwitch')));

  // the account menu's Dark mode, run: auth.js's menu item reads and flips the theme through theme-toggle.js
  check('5 the account slot asks for the light/dark switch', /<span data-rv-account data-rv-account-theme><\/span>/.test(top));
  check('5 theme-toggle.js offers the switch under a name rv-theme.js does not take', /global\.RevampColorMode = \{/.test(TOGGLE) && /current: function/.test(TOGGLE));
  var open = AUTH.slice(AUTH.indexOf('function mountAccountMenu('), AUTH.indexOf('function mountAccountMenus('));
  check('5 auth.js puts "Dark mode" in the menu only where it is asked for', /el\.hasAttribute\('data-rv-account-theme'\) \? window\.RevampColorMode : null/.test(open) &&
    /'menuitemcheckbox'/.test(open) && /Dark mode/.test(open) && /if \(mode\) pop\.appendChild\(mode\)/.test(open));
  (function () {
    // theme-toggle.js run on a stand-in page: toggle() flips data-theme and RevampColorMode.current() follows
    var attrs = { }, store = {};
    var docEl = { setAttribute: function (k, v) { attrs[k] = v; }, getAttribute: function (k) { return k in attrs ? attrs[k] : null; } };
    var c = vm.createContext({
      matchMedia: function () { return { matches: false }; },
      localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
      document: { documentElement: docEl, readyState: 'complete', querySelectorAll: function () { return []; }, getElementById: function () { return {}; },
        createElement: function () { return {}; }, head: { appendChild: function () {} }, addEventListener: function () {} }
    });
    c.window = c;
    vm.runInContext(TOGGLE, c);
    var M = c.RevampColorMode;
    check('5 the switch starts on the theme in use', !!M && M.current() === 'light');
    M.toggle();
    check('5 … Dark mode turns the console dark and is remembered', M.current() === 'dark' && store['revamp-theme'] === 'dark');
    M.toggle();
    check('5 … and back', M.current() === 'light' && store['revamp-theme'] === 'light');
  })();
})();

/* ======================= 6 no browser pop-ups (UX-079) ======================= */
(function () {
  var code = noComments(SRC);
  check('6 the editor asks nothing in the browser\'s own boxes', !/\bprompt\(|window\.confirm\(|\balert\(/.test(code), (code.match(/.{30}(?:\bprompt\(|window\.confirm\(|\balert\().{20}/g) || []));
  var add = body('addBlock');
  check('6 Add → Image opens the same dialog as Replace image (upload or address)', /openPictureDialog\('Add a picture'/.test(add) && add.indexOf('prompt(') === -1);
  check('6 … and the picture goes where the selection was when Image was pressed', /addBlock\('image', \{ src: url, section: sec, after:/.test(add));
  var alt = body('askAltText');
  check('6 Alt text is the editor\'s own dialog that says what it is for', /title: 'Describe this picture'/.test(alt) && /Read out to people who cannot see the picture, and used by search engines/.test(alt) && /Leave it empty for a picture that is only decoration/.test(alt));
  check('6 … saved as one step, and waits while ETB2B AI is changing the page', /commitNow\(\)/.test(alt) && /if \(aiWorking\) \{ busyToast\(\); return false; \}/.test(alt));
  var dev = body('openDevZone');
  check('6 the developer zone asks in the editor\'s own dialog, "Keep editing" focused, the throw-away in red',
    /'Close without applying your changes\?'/.test(dev) && /'Switch section without applying your changes\?'/.test(dev) &&
    /label: 'Keep editing', kind: 'secondary', autofocus: true/.test(dev) && /kind: 'danger'/.test(dev));
  check('6 an older ETB2B AI change\'s Undo asks in the editor too (B04)', /title: 'Undo this change\?'/.test(SRC) && !/confirm\('Undo this change/.test(code));
})();

/* ======================= 7 placeholders (UX-081) ======================= */
(function () {
  var ins = body('insertSection');
  check('7 a ready-made design\'s sample words are marked as it is added, and the toast says so', /markPlaceholders\(el\)/.test(ins) && /dashed amber outline/.test(ins));
  check('7 … not the site\'s own sections (their words are the event\'s)', /spec\.libraryId \? 0 : markPlaceholders\(el\)/.test(ins));
  check('7 new blocks ("New heading", "Button") are marked too', /markPlaceholders\(node\)/.test(body('addBlock')));
  check('7 the mark comes off as soon as the words are the event\'s own, by any road', /settlePlaceholders\(\)/.test(body('record')) && /editorWords\.placeholderLeft/.test(body('settlePlaceholders')));
  check('7 the canvas outlines what is left', /html\[data-rv-editing\] \[data-rv-placeholder\]\{ outline:1\.5px dashed/.test(CANVAS_CSS));
  check('7 Publish asks about them after the logo check, before the AI review', /logoUnitGate\(\)\) return;\s*\n\s*\/\*[^*]*\*\/\s*\n\s*if \(window\.RevampTemplateUI\.placeholderGate && window\.RevampTemplateUI\.placeholderGate\(publishOn\)\) return;\s*\n\s*publishOn\(\);/.test(INLINE) &&
    /* B06 (UX-104): the AI review lists only the sections nobody has checked yet */
    /function publishOn\(\)\{[\s\S]{0,200}var info = window\.RevampTemplateUI\.aiProvenanceSections\(\);\s*\n\s*if \(info\.generated\.length\)/.test(INLINE));
  check('7 … hidden sections do not count (they are not saved)', /!el\.closest\('\.is-hidden-sec'\)/.test(body('shownPlaceholders')));
  check('7 "Show them" brings the first one into view, on its own page', /revealElement\(first\)/.test(body('showPlaceholders')) && /showPage\(on\)/.test(body('showPlaceholders')));

  var hooks = require('./api')._testHooks;
  var page = '<!doctype html><html><head><title>x</title></head><body><section data-rv-section="s1"><h2 data-editable="text" data-rv-placeholder="Card one">Card one</h2>' +
    '<div class="ph" data-editable="image" data-rv-placeholder=""></div></section></body></html>';
  var out = hooks.publishTransform(page, { eventId: 'qa-ux-b14-x', event: { name: 'X' }, mode: 'live' });
  check('7 the mark never reaches a published page', typeof out === 'string' && out.indexOf('data-rv-placeholder') === -1 && out.indexOf('Card one') !== -1, out && out.slice(0, 200));

  // the picker: every tab in view, readable previews
  check('7 the picker\'s tabs wrap instead of running off the edge, and fade where they scroll', /\.variant-tabs\{ display:flex; flex-wrap:wrap;/.test(PAGE) && /function syncTabFade\(\)/.test(INLINE) && /more-end/.test(INLINE));
  check('7 a design\'s preview is drawn wide and cut to its top, not shrunk whole', /mountVariantPreview\(card\.querySelector\('\.variant-thumb'\), variant\.html\);/.test(INLINE) && /aspect-ratio: 960 \/ 440/.test(PAGE) &&
    /\.variant-thumb-scale\{ position:absolute; top:0; left:0; width:960px;/.test(PAGE) && /scale\(' \+ \(thumbW \/ naturalW\) \+ '\)'/.test(INLINE));
  check('7 … in the demo look\'s colours and fonts (a .frame of its own), so its headings are not the panel\'s small text', /look\.className = 'frame';/.test(body('mountVariantPreview', INLINE)));
  /* in a 768 px tall window the grid's auto rows shrank below the cards (a card clipping its content counts as
     able to shrink to nothing), so the second row covered the first row's names and a click picked the wrong
     design (re-check of UX-081): each row is as tall as its cards, and the preview keeps its height */
  check('7 the picker\'s rows are as tall as their cards, so no card covers another in a short window',
    /\.variant-grid\{[^}]*grid-auto-rows:max-content;[^}]*max-height:56vh;/.test(PAGE) && /\.variant-thumb\{[^}]*flex-shrink:0;[^}]*aspect-ratio: 960 \/ 440;/.test(PAGE));
})();

/* ======================= 7b the logo notice (UX-082) ======================= */
(function () {
  var n = body('logoUnitNotice');
  check('7b the notice is one line with the note behind Details', /editorWords\.logoHeadline\(note\)/.test(n) && /details: details/.test(n) && n.indexOf('Answer this before publishing') === -1);
  check('7b … the buttons: Show me, Looks right, and Replace logo where there is a picture', /label: 'Show me'/.test(n) && /label: 'Looks right'/.test(n) && /if \(canReplace\) actions\.push\(\{ label: 'Replace logo'/.test(n));
  check('7b showNotice draws "Details" that opens and closes the full note', /if \(opts\.details\)\{/.test(INLINE) && /aria-expanded/.test(body('showNotice', INLINE)) && /'Hide details'/.test(INLINE));
  check('7b Publish still says it must be answered first', /Answer the logo check before publishing/.test(body('logoUnitGate')));
})();

/* ======================= 8 ES5 ======================= */
(function () {
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still run */ }
  check('8 esbuild is there to check ES5', !!esbuild);
  if (!esbuild) return;
  [['editor-template-ui.js', SRC], ['custom_editor.html (its script)', INLINE], ['auth.js', AUTH], ['theme-toggle.js', TOGGLE], ['sidebar.js', SIDEBAR]].forEach(function (f) {
    var es5 = (function () { try { esbuild.transformSync(f[1], { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('8 ' + f[0] + ' is ES5 by esbuild', es5 === true, es5);
  });
})();

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
