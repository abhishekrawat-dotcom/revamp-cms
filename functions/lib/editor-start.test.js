// node functions/lib/editor-start.test.js — the site editor explains itself to a newcomer (first-time-user QA, group B:
// NU-008, NU-009, NU-018, NU-020, NU-021, NU-035, NU-036).
//   1 the first steps' words (editor-start.js steps / stepsTitle / legendText), run as they are
//   2 the first steps in the editor: once per person, after the editor's own questions and the first save; Help opens
//     them again as they stand; the line about the design's samples, "Show next", dismissed for the visit (NU-008, NU-009)
//   3 the page wires them: the script, Help in the tools row, the hand-over once the site is open
//   4 a section visitors would see with only its heading says so, with "+ Add an item" and "Hide this section", read
//     with the publish check's own rules on a stand-in page; the note is never saved (NU-018)
//   5 the amber outline says what it is when pointed at (NU-009)
//   6 Save says it is waiting, with its keys, after the person's own change (NU-035)
//   7 ETB2B AI beside the page: docked in Edit with AI from 1100 px; one side panel at a time below 1600 px (NU-020)
//   8 names: "Add element", "Add section", "Sections"; the rail's "Site editor"; the console's items marked (NU-021)
//   9 a phone: the Mobile device chosen, the mode switch in words (NU-036)
//  10 ES5
// No network, no AI, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var START_SRC = read('editor-start.js');
var SRC = read('editor-template-ui.js');
var PAGE = read('custom_editor.html');
var CANVAS = read('editor-canvas.js');
var CANVAS_CSS = read('editor-canvas.css');
var AIMODE = read('editor-ai-mode.js');
var CHAT = read('editor-chat-client.js');
var SIDEBAR = read('sidebar.js');
var passed = 0, failed = 0;
function show(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + show(detail) : ''));
}
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
var SCRIPTS = PAGE.match(/<script>([\s\S]*?)<\/script>/g) || [];
var INLINE = SCRIPTS.length ? SCRIPTS[SCRIPTS.length - 1].replace(/^<script>|<\/script>$/g, '') : '';
var S = require(path.join(ROOT, 'editor-start.js'));

/* ======================= 1 the words ======================= */
(function () {
  var t = S.steps({ kind: 'template', samples: { words: 7, pictures: 0 }, saved: true, dirty: false, mac: true });
  check('1 five steps, in the order of the work', t.map(function (s) { return s.key; }).join() === 'words,pictures,content,form,send', t);
  check('1 the words step says how many samples are left and what their outline means', t[0].state === '7 left' && !t[0].done &&
    t[0].text === 'Click any text on the page and type over it. 7 texts are still the design’s sample, with a dashed amber outline: replace them with your event’s own, or hide their section.', t[0].text);
  check('1 the content step says Speakers, Agenda and Sponsors open the console, marked ↗, and never promises the site shows them when the design has no section for them', /in the left bar, open the event console \(marked ↗\)\. Each shows on the site in its own section; if this design has none for it yet, the site editor adds one the next time it opens \(press Save to keep it\)\./.test(t[2].text) && !/The site shows what you add there/.test(t[2].text));
  check('1 the last step: Save with its keys, that the editor does not save by itself, then Send for approval…; done once saved',
    t[4].text === 'Save (⌘S) keeps your changes: the editor does not save by itself. Preview opens the site in a new tab. Send for approval… asks an approver to put it live.' && t[4].state === 'Saved' && t[4].done === true);
  var none = S.steps({ kind: 'template', samples: { words: 0, pictures: 0 }, saved: false, dirty: true });
  check('1 no samples left on a gallery design: the words step is done; unsaved work says so, with Ctrl+S off a Mac', none[0].done && none[0].state === 'Done' && none[4].state === 'Unsaved changes' && !none[4].done && /Save \(Ctrl\+S\)/.test(none[4].text));
  check('1 one sample: said in the singular', /One text is still the design’s sample, with a dashed amber outline: replace it with your event’s own, or hide its section\./.test(S.steps({ kind: 'template', samples: { words: 1 } })[0].text));
  var gen = S.steps({ kind: 'gen', samples: { words: 0, pictures: 2 }, saved: false });
  check('1 a site ETB2B AI wrote: read what it wrote; picture boxes still empty are counted', /^ETB2B AI wrote this from your brief: read it, and click any text to correct it\.$/.test(gen[0].text) && gen[0].state === '' &&
    gen[1].state === '2 left' && /2 picture boxes are still empty, with a dashed amber outline\./.test(gen[1].text) && gen[4].state === 'Not saved yet');
  var phone = S.steps({ kind: 'template', samples: { words: 3 }, phone: true });
  check('1 on a phone: tap, ETB2B AI at the bottom, the menu in Myself, and Forms is on a computer', /^Tap any text/.test(phone[0].text) && /Or ask ETB2B AI, at the bottom, to change it for you\./.test(phone[0].text) &&
    /switch to Myself to see it/.test(phone[2].text) && /Forms is in the tools row on a computer\. Here, ask ETB2B AI to change the form\./.test(phone[3].text) &&
    /^Save keeps your changes/.test(phone[4].text));
  check('1 titles: the brief\'s welcome, the first time, and from Help', S.stepsTitle({ first: true, generated: true }) === 'Your site is ready to review' &&
    S.stepsTitle({ first: true }) === 'Your site is ready: what to do next' && S.stepsTitle({ first: false, generated: true }) === 'How to finish your site');
  check('1 the line above the page: plural, with pictures, singular, and nothing when none is left',
    S.legendText(16, 0) === '16 texts on this page are still the design’s samples: they have a dashed amber outline. Replace them with your event’s own, or hide their section, before you send the site for approval.' &&
    /^3 texts and 2 picture boxes on this page are still the design’s samples/.test(S.legendText(3, 2)) &&
    S.legendText(1, 0) === 'One text on this page is still the design’s sample: it has a dashed amber outline. Replace it with your event’s own, or hide its section, before you send the site for approval.' &&
    S.legendText(0, 0) === '', [S.legendText(16, 0), S.legendText(1, 0)]);
  check('1 seen once per person in this browser', S.seenKey({ uid: 'u1', email: 'a@b' }) === 'revamp.editorSteps.seen.u1' && S.seenKey({ email: 'a@b' }) === 'revamp.editorSteps.seen.a@b' && S.seenKey(null) === 'revamp.editorSteps.seen.anon');
  var all = JSON.stringify(S.TEXT) + JSON.stringify(t) + JSON.stringify(gen) + JSON.stringify(phone);
  check('1 no internal words or old names in what it says', !/\b(slot|staged|template id|wrapper|JSON|Oneworld|Revamp CMS)\b/i.test(all) && !/\bET\b/.test(all.replace(/ETB2B/g, '')), all.match(/\b(slot|staged|wrapper|JSON|Oneworld)\b/i));
})();

/* ======================= 2 the first steps in the editor ======================= */
function stage(o) {
  o = o || {};
  var store = {}, opened = [], notices = {}, cleared = [], listeners = [], helpLs = [], scrim = null, timers = [];
  if (o.seen) store['revamp.editorSteps.seen.u1'] = '1';
  var site = { info: { savedVersion: o.saved ? 1 : 0 }, dirty: !!o.dirty, saving: false, firstSave: !!o.firstSave };
  var samples = { words: o.words || 0, pictures: 0, total: o.words || 0 }, shownNext = { n: 0 };
  var help = { hidden: true, attrs: {}, getAttribute: function (k) { return this.attrs[k] || null; }, setAttribute: function (k, v) { this.attrs[k] = v; },
    addEventListener: function (t, fn) { helpLs.push(fn); } };
  var doc = { getElementById: function (id) { return id === 'btn-editor-help' ? help : null; },
    querySelector: function (sel) { return /scrim/.test(sel) ? scrim : null; } };
  var win = {
    document: doc, navigator: { platform: 'MacIntel' },
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
    matchMedia: function () { return { matches: !!o.phone }; },
    setTimeout: function (fn, ms) { timers.push(fn); return timers.length; }, clearTimeout: function () {},
    RevampAuth: { currentUser: function () { return { uid: 'u1' }; } },
    RevampTemplateUI: { samplesLeft: function () { return samples; }, siteState: function () { return site; }, siteKind: function () { return o.kind || 'template'; },
      showNextSample: function () { shownNext.n++; return true; }, onChange: function (fn) { listeners.push(fn); } }
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(START_SRC, win, { filename: 'editor-start.js' });
  var host = {
    generated: !!o.generated,
    openDialog: function (d) { var h = { el: { classList: { list: [], add: function (c) { this.list.push(c); } } }, d: d }; opened.push(h); return h; },
    showNotice: function (id, n) { notices[id] = n; }, clearNotice: function (id) { cleared.push(id); delete notices[id]; }
  };
  function run() { var n = 0; while (timers.length && n++ < 200) timers.shift()(); }
  return { win: win, host: host, store: store, opened: opened, notices: notices, cleared: cleared, listeners: listeners, helpLs: helpLs, help: help, site: site, samples: samples, shownNext: shownNext,
    run: run, setScrim: function (v) { scrim = v; } };
}
(function () {
  var a = stage({ words: 7, saved: true });
  a.win.RevampEditorStart.ready(a.host);
  a.run();
  check('2 the first time: the steps open, once', a.opened.length === 1 && a.opened[0].d.title === 'Your site is ready: what to do next' && a.opened[0].el.classList.list.indexOf('ed-steps-dialog') !== -1, a.opened.length);
  var html = a.opened[0] ? a.opened[0].d.bodyHtml : '';
  check('2 … five numbered steps, where the editor knows where they stand', (html.match(/<li class="ed-step/g) || []).length === 5 && html.indexOf('7 left') !== -1 && html.indexOf('>Saved<') !== -1 &&
    /These steps open again from Help, above the page\./.test(html));
  var acts = a.opened[0].d.actions;
  check('2 … with "Show the sample texts" beside "Got it" while samples are left', acts.length === 2 && acts[0].label === 'Show the sample texts' && acts[1].label === 'Got it' && acts[1].autofocus === true);
  a.opened[0].d.onClose();
  a.run();
  check('2 closed by the person: remembered as seen', a.store['revamp.editorSteps.seen.u1'] === '1', a.store);
  var b = stage({ seen: true, words: 2 });
  b.win.RevampEditorStart.ready(b.host);
  b.run();
  check('2 seen before: not opened again', b.opened.length === 0);
  check('2 Help is shown and opens the steps again, as they stand', b.help.hidden === false && b.helpLs.length === 1 && (b.helpLs[0](), b.opened.length === 1) &&
    b.opened[0].d.title === 'How to finish your site' && b.opened[0].d.actions[b.opened[0].d.actions.length - 1].label === 'Close');
  b.opened[0].d.onClose();
  b.run();
  /* waits for the editor's own question as it opens, and for the first save of a site Create Event just made */
  var c = stage({ firstSave: true, dirty: true });
  c.setScrim({});
  c.win.RevampEditorStart.ready(c.host);
  c.run();
  check('2 another of the editor\'s dialogs stays open for 20 s: the steps never open over it', c.opened.length === 0);
  var d = stage({ firstSave: true });
  d.win.RevampEditorStart.ready(d.host);
  d.site.firstSave = false; d.site.info.savedVersion = 1;
  d.run();
  check('2 … then open once it is saved, saying so', d.opened.length === 1 && d.opened[0].d.bodyHtml.indexOf('>Saved<') !== -1);
  /* replaced by another of the editor's dialogs as the page opened: not taken as seen */
  var e = stage({});
  e.win.RevampEditorStart.ready(e.host);
  e.run();
  e.setScrim({ other: true });
  e.opened[0].d.onClose();
  e.run();
  check('2 closed because another dialog took its place: not remembered as seen', !e.store['revamp.editorSteps.seen.u1']);
  /* the brief's welcome */
  var g = stage({ generated: true, kind: 'gen' });
  g.win.RevampEditorStart.ready(g.host);
  g.run();
  check('2 a site Create Event just generated from a brief: "Your site is ready to review", with the welcome\'s words', g.opened.length === 1 && g.opened[0].d.title === 'Your site is ready to review' &&
    g.opened[0].d.bodyHtml.indexOf('This draft is yours now. Generating from the brief again makes a new draft and does not change this one.') !== -1 && g.opened[0].d.actions.length === 1);
  /* the line above the page */
  var l = stage({ seen: true, words: 3 });
  l.win.RevampEditorStart.ready(l.host);
  check('2 the line about the samples shows, with "Show next"', !!l.notices.samples && /^3 texts on this page are still the design’s samples/.test(l.notices.samples.text) &&
    l.notices.samples.actions[0].label === 'Show next' && l.notices.samples.dismissible === true && l.notices.samples.kind === 'warn');
  l.notices.samples.actions[0].onClick();
  check('2 "Show next" brings the next sample into view', l.shownNext.n === 1);
  l.samples.words = 0; l.samples.total = 0;
  l.listeners.forEach(function (fn) { fn(); });
  l.run();
  check('2 once none is left, the line goes', !l.notices.samples && l.cleared.indexOf('samples') !== -1);
  l.samples.words = 2;
  l.notices.samples = null;
  l.listeners.forEach(function (fn) { fn(); }); l.run();
  var shown = l.notices.samples;
  shown.onDismiss();
  l.samples.words = 1;
  l.listeners.forEach(function (fn) { fn(); }); l.run();
  check('2 dismissed: it stays away for the visit', l.notices.samples === shown && /^2 texts/.test(shown.text));
})();

/* ======================= 3 the page wires them ======================= */
(function () {
  var at = function (f) { return PAGE.indexOf('<script src="' + f + '"></script>'); };
  check('3 editor-start.js loads after the modes and before ETB2B AI', at('editor-start.js') > at('editor-ai-mode.js') && at('editor-start.js') < at('etb2b-chat.js') && at('editor-ai-mode.js') !== -1);
  check('3 Help sits in the tools row\'s right end, a button that opens a dialog, hidden until the site is open',
    /<div class="rail-fixed">\s*<!--[^>]*-->\s*<button type="button" class="rail-help" id="btn-editor-help" aria-haspopup="dialog" title="How to finish your site, step by step" hidden>/.test(PAGE) && /<span class="rail-help-word">Help<\/span>/.test(PAGE));
  check('3 the editor hands them its dialog and notices once the site is open, after the modes',
    INLINE.indexOf('window.RevampEditorStart.ready({ openDialog: openDialog, showNotice: showNotice, clearNotice: clearNotice, generated: arrivedFromBrief })') > INLINE.indexOf('window.RevampEditorMode.ready();'));
  check('3 a notice can say when it was dismissed (the line about the samples stays away)', /x\.addEventListener\('click', function\(\)\{ clearNotice\(id\); if \(typeof opts\.onDismiss === 'function'\) opts\.onDismiss\(\); \}\);/.test(INLINE));
  check('3 the steps dialog is wider and its steps numbered', /\.modal\.ed-steps-dialog\{ max-width:540px; \}/.test(PAGE) && /\.ed-step-n\{/.test(PAGE) && /\.ed-step\.is-done \.ed-step-n\{ background: var\(--ok-soft\); color: var\(--ok\); \}/.test(PAGE));
  check('3 the template UI tells them the samples, the next one and what made the site', /samplesLeft: function \(\)/.test(SRC) && /showNextSample: whenPageFree\(showNextSample\)/.test(SRC) && /siteKind: function \(\)/.test(SRC) &&
    /firstSave: firstSaveDue \|\| firstSavePending/.test(SRC));
  check('3 the old once-per-draft welcome is gone (the steps are once per person)', PAGE.indexOf('revamp.gbWelcomeSeen.') === -1 && PAGE.indexOf('Got it, let’s look') === -1);
})();

/* ======================= 4 a section with only its heading (NU-018) ======================= */
/* a stand-in page: elements with what bareSection reads (tags, attributes, classes, children, closest) */
function El(tag, attrs, kids) {
  this.nodeType = 1; this.tagName = tag.toUpperCase(); this._a = attrs || {}; this.childNodes = []; this.parentElement = null; this.parentNode = null;
  var self = this;
  (kids || []).forEach(function (k) { self.append(typeof k === 'string' ? { nodeType: 3, nodeValue: k } : k); });
}
El.prototype.append = function (k) {
  var last = this.childNodes[this.childNodes.length - 1];
  if (last) last.nextSibling = k;
  k.nextSibling = null; k.parentNode = this; if (k.nodeType === 1) k.parentElement = this;
  this.childNodes.push(k);
};
Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
Object.defineProperty(El.prototype, 'id', { get: function () { return this._a.id || ''; } });
Object.defineProperty(El.prototype, 'classList', { get: function () {
  var l = String(this._a['class'] || '').split(/\s+/).filter(Boolean);
  return { contains: function (c) { return l.indexOf(c) !== -1; }, length: l.length, forEach: l.forEach.bind(l), some: l.some.bind(l), 0: l[0], 1: l[1], 2: l[2] };
} });
El.prototype.getAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this._a, n) ? String(this._a[n]) : null; };
El.prototype.hasAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this._a, n); };
El.prototype.matches = function (sel) {
  var self = this;
  return sel.split(',').some(function (one) {
    one = one.trim();
    var m = /^\[([\w-]+)\]$/.exec(one);
    if (m) return self.hasAttribute(m[1]);
    return self.tagName.toLowerCase() === one.toLowerCase();
  });
};
El.prototype.closest = function (sel) { for (var n = this; n && n.nodeType === 1; n = n.parentElement) if (n.matches(sel)) return n; return null; };
El.prototype.querySelector = function (sel) {
  var m = /^(\w+)\[([\w-]+)\]$/.exec(sel), found = null;
  (function walk(n) { n.childNodes.forEach(function (c) { if (found || c.nodeType !== 1) return; if (m && c.tagName.toLowerCase() === m[1] && c.hasAttribute(m[2])) found = c; else walk(c); }); })(this);
  return found;
};
function h(tag, attrs, kids) { return new El(tag, attrs, kids); }
(function () {
  var start = SRC.indexOf("  var ED_NOTE = 'data-rv-ed-note';"), end = SRC.indexOf('  /* the design\'s own model of the section\'s list');
  check('4 the rules are one block, from ED_NOTE to bareSection', start !== -1 && end > start, { start: start, end: end });
  var ctx = vm.createContext({ Array: Array });
  vm.runInContext(SRC.slice(start, end), ctx, { filename: 'editor-template-ui.js#bare' });
  var bare = ctx.bareSection;
  function inPage(sec) { var body = h('body', {}, [h('main', {}, [sec])]); return sec; }
  var topic = inPage(h('section', { 'data-rv-section': 'key-topic' }, [h('div', { 'class': 'container' }, [h('h2', {}, [h('span'), 'Key Discussion Points']), h('div', { 'class': 'key-topic-grid', 'data-rv-list': 'priorities' }), h('template', { 'data-rv-pristine': 'priorities' }, ['Value: The Economics Of Autonomy'])])]));
  check('4 "Key Discussion Points" with no cards: only its heading', JSON.stringify(bare(topic)) === JSON.stringify({ heading: 'Key Discussion Points' }), bare(topic));
  var stats = inPage(h('section', { 'data-rv-section': 'overview-stats' }, [h('div', { 'class': 'ovr-stats', 'data-rv-list': 'stats' })]));
  check('4 an empty band with no heading: said as empty', JSON.stringify(bare(stats)) === JSON.stringify({ heading: '' }));
  var filled = inPage(h('section', { 'data-rv-section': 'key-topic' }, [h('h2', {}, ['Key Discussion Points']), h('div', { 'class': 'key-topic-card' }, [h('h3', {}, ['Value']), h('p', {}, ['What happens when AI can execute more of the work?'])])]));
  check('4 with a card (a second heading, words): not empty', bare(filled) === null);
  var label = inPage(h('section', { 'data-rv-section': 'why' }, [h('h2', {}, ['Why join']), h('p', {}, ['Coming soon'])]));
  check('4 a heading and a short label: still only its heading (the check\'s 30 letters)', bare(label) && bare(label).heading === 'Why join');
  var words = inPage(h('section', { 'data-rv-section': 'why' }, [h('h2', {}, ['Why join']), h('p', {}, ['Two days of candid discussion with peers from large Indian enterprises.'])]));
  check('4 a heading and real words: not empty', bare(words) === null);
  var figure = inPage(h('section', { 'data-rv-section': 'numbers' }, [h('h2', {}, ['Key numbers']), h('span', {}, ['500+'])]));
  check('4 a number is a fact, not a label', bare(figure) === null);
  var pic = inPage(h('section', { 'data-rv-section': 'gallery' }, [h('h2', {}, ['Glimpses']), h('img', { src: 'x.jpg' })]));
  var link = inPage(h('section', { 'data-rv-section': 'cta' }, [h('h2', {}, ['Register']), h('a', { href: '#r' }, ['Register'])]));
  var list = inPage(h('section', { 'data-rv-section': 'who' }, [h('h2', {}, ['Who attends']), h('ul', {}, [h('li', {}, ['CIOs'])])]));
  check('4 a picture, a link or a list item shows something', bare(pic) === null && bare(link) === null && bare(list) === null);
  var hidden = inPage(h('section', { 'data-rv-section': 'key-topic', 'class': 'is-hidden-sec' }, [h('h2', {}, ['Key Discussion Points'])]));
  var emptyRec = inPage(h('section', { 'data-rv-section': 'our-speakers', 'data-rv-empty': 'speakers' }, [h('h2', {}, ['Our Speakers'])]));
  var nav = inPage(h('header', { 'data-rv-section': 'nav' }, [h('h2', {}, ['Menu'])]));
  check('4 a hidden section, one the page hides for its empty records, and the header: never noted', bare(hidden) === null && bare(emptyRec) === null && bare(nav) === null);
  var noted = inPage(h('section', { 'data-rv-section': 'key-topic' }, [h('h2', {}, ['Key Discussion Points']), h('div', { 'data-rv-ed-note': '', 'data-rv-editor': '' }, [h('p', {}, ['Nothing under “Key Discussion Points” yet: visitors would see only this heading.']), h('button', {}, ['+ Add an item'])])]));
  check('4 its own note (words, buttons) does not count: still only its heading', bare(noted) && bare(noted).heading === 'Key Discussion Points');
  var badge = inPage(h('section', { 'data-rv-section': 'key-topic' }, [h('span', { 'class': 'ai-prov-badge' }, ['AI-generated · review before publishing']), h('h2', {}, ['Key Discussion Points'])]));
  check('4 the editor\'s AI pills do not count either', bare(badge) && bare(badge).heading === 'Key Discussion Points');
  var banner = inPage(h('section', { 'data-rv-section': 'banner' }, [h('h1', {}, ['QA Summit']), h('h2', {}, ['Mumbai'])]));
  check('4 a banner\'s title is the event\'s name: a second heading there is something shown', bare(banner) === null);
})();
(function () {
  check('4 the note is drawn after every change and as the editor opens', /drawFormPreviews\(true\);\s*\n\s*drawEmptyNotes\(\);/.test(body('pageChanged')) && /drawFormPreviews\(false\);\s*\n\s*drawEmptyNotes\(\);/.test(SRC));
  var draw = body('drawEmptyNotes');
  check('4 … under the section\'s heading, the editor\'s own (never saved, never typed into), with its two buttons', /note\.setAttribute\(ED_NOTE, ''\);/.test(draw) && /note\.setAttribute\('data-rv-editor', ''\);/.test(draw) &&
    /note\.setAttribute\('data-ed', 'none'\);/.test(draw) && /contentBox\(sec\)\.appendChild\(note\);/.test(draw) && /'add-item', '\+ Add an item'/.test(draw) && /'hide', 'Hide this section'/.test(draw));
  check('4 … "+ Add an item" only where the design keeps a model of the list', /if \(model\) acts\.appendChild\(noteButton\(doc, 'add-item'/.test(draw));
  check('4 the note is in no snapshot, so drawing it never makes the page unsaved', /var FORM_PREVIEW = '\[data-rv-form-preview\], \[data-rv-hv-preview\], \[data-rv-ai-mark\], \[data-rv-ed-note\]';/.test(CANVAS) &&
    /root\.querySelectorAll\('\[data-rv-editor\]'\)\.forEach\(function \(n\) \{ n\.remove\(\); \}\);/.test(CANVAS));
  check('4 … nor in the section sent to ETB2B AI or shown in the developer zone', (SRC.match(/\[data-rv-form-preview\], \[data-rv-hv-preview\], \[data-rv-ai-mark\], \[data-rv-ed-note\]/g) || []).length === 2);
  check('4 a click on its buttons adds an item or hides the section', /var noteAct = target\.closest\('\[data-rv-ed-act\]'\);\s*\n\s*if \(noteAct\) \{ onNoteAction\(noteAct\.getAttribute\('data-rv-ed-act'\), noteAct\.closest\('\[data-rv-section\]'\)\); return; \}/.test(SRC) &&
    /if \(act === 'add-item'\) \{ addFirstItem\(sec\); return; \}/.test(body('onNoteAction')) && /setSectionHidden\(sec, true\);/.test(body('onNoteAction')));
  var add = body('addFirstItem');
  check('4 the item comes from the design\'s model, its sample words outlined, as one undo step, its title selected', /canvas\.doc\.importNode\(m\.model, true\)/.test(add) && /markPlaceholders\(card\);/.test(add) && /commitNow\(\);/.test(add) && /selectNewItem\(card\);/.test(add));
  check('4 the section\'s own toolbar offers the same first item (for the keyboard)', /data-action="add-first-item"/.test(body('buildSecToolbar')) && /action === 'add-first-item'/.test(body('onSecToolbarClick')));
  check('4 the note reads on any site at the canvas\'s size: fixed colours, 16px', /html\[data-rv-editing\] \[data-rv-ed-note\]\{[^}]*background:#FFF8E8 !important; color:#3D2A00 !important;[^}]*font:500 16px\/1\.5/.test(CANVAS_CSS));
})();

/* ======================= 5 the amber outline says what it is (NU-009) ======================= */
(function () {
  check('5 pointed at, a sample says what it is', SRC.indexOf("text: 'Sample text from the design — type your event’s own over it'") !== -1 && SRC.indexOf("box: 'Sample picture from the design — replace it with your event’s own'") !== -1);
  /* NEW-4: another event's picture the design came with (the banner's own stage photo) says so, with the way to replace it */
  check('5 NEW-4 … and another event\'s picture, the banner\'s with the way to replace it', SRC.indexOf("picture: 'Another event’s picture, from the design — replace it with your event’s own'") !== -1 &&
    SRC.indexOf("banner: 'The design’s sample picture, from another event — replace it: Background picture, in the banner’s menu'") !== -1 &&
    /SAMPLE_TAG_WORDS\[sampleKind\(el\)\]/.test(body('placeSampleTag')) && /img\[' \+ SAMPLE_LEFT \+ '="banner"\]/.test(body('onCanvasHover')));
  check('5 the tag follows the pointer over the page, and goes when it leaves', /canvas\.doc\.addEventListener\('mouseover', onCanvasHover, true\);/.test(SRC) && /canvas\.doc\.documentElement\.addEventListener\('mouseleave', hideSampleTag\);/.test(SRC));
  var place = body('placeSampleTag');
  check('5 … under the element while it is selected (its toolbar is above), never while it is typed in or ETB2B AI is busy', /el === selectedEl \|\| above < 4 \? below : above/.test(place) && /el === editingEl/.test(place) && /aiWorking/.test(place));
  check('5 … placed again with the toolbars as the page scrolls', /function positionToolbars\(\) \{\s*\n\s*positionBusyPills\(\);\s*\n\s*placeSampleTag\(\);/.test(SRC));
  check('5 the tag is put away in Edit with AI and on a phone, and its white words read on its amber (6:1)', /body\.ed-mode-ai \.tpl-sample-tag,/.test(PAGE) && /\.tpl-sample-tag\{ display:none !important; \}/.test(PAGE) &&
    /\.tpl-sample-tag\{ position:absolute;[^}]*background:#845B10; color:#fff;/.test(PAGE));
  check('5 the line about the samples is put away in Edit with AI (the live view has no outlines)', /body\.ed-mode-ai \.ed-notice\[data-notice="samples"\]/.test(PAGE));
})();

/* ======================= 6 Save says it is waiting (NU-035) ======================= */
(function () {
  var rs = body('renderSiteState');
  check('6 unsaved work says how to keep it, beside the words, with the keys', /hint\.className = 'ss-hint';/.test(rs) && rs.indexOf("hint.textContent = '— press Save (' + saveKeys() + ')';") !== -1 && /text = 'Unsaved changes'/.test(rs));
  check('6 … not while saving, nor while the first save of a site Create Event just made is due or on its way (NU-011)', /var due = kind === 'warn' && \(dirty \|\| !v\) && !saving && !firstSavePending && !firstSaveDue;/.test(rs));
  check('6 Save shows a dot while there is work to keep', /save\.classList\.toggle\('is-due', due && dirty\);/.test(rs) && /#btn-save\.is-due::after\{ content:''; width:7px; height:7px; border-radius:50%; background: var\(--warn\);/.test(PAGE));
  check('6 under a short name (a phone) only the words show; Save\'s dot says the rest', /\.topbar \.site-state \.ss-hint\{ display:none; \}/.test(PAGE));
  check('6 the first change of a person\'s own says once, in a sentence, that the editor keeps it until Save', /if \(due && dirty && editedThisVisit\) firstUnsavedNote\(\);/.test(rs) &&
    /The site editor keeps your changes in this browser until you press Save \(' \+ saveKeys\(\) \+ '\)\. Nothing goes live until it is published\./.test(body('firstUnsavedNote')) && /'revamp\.editorSaveNote\.' \+ personKey\(\)/.test(body('firstUnsavedNote')));
  check('6 … never for what the editor did as it opened (a hand-off, its own touch-ups, ETB2B AI\'s hero picture)', /if \(\(!automatic \|\| editingEl\) && bootDone\) editedThisVisit = true;/.test(body('record')) &&
    /applyAiHero\(heroDraft\); \}\s*\n\s*bootDone = true;/.test(SRC));
  /* NEW-1: a section the editor added as it opened (the console's "Open the site editor to add the “Agenda” section") is
     unsaved work, said so — never only "Updated automatically", with no dot and nothing asked on leaving */
  check('6 NEW-1 a section added as the page opened makes the words say "Unsaved changes" (so Save shows its dot)',
    /var added = dirty \? addedSectionsLeft\(\) : \[\];/.test(rs) && /else if \(dirty && added\.length\) \{\s*\n\s*kind = 'warn'; text = 'Unsaved changes';/.test(rs) &&
    rs.indexOf('else if (dirty && added.length)') < rs.indexOf('else if (dirty && autoOnly())') && /noteAddedSections\(\);/.test(rs));
  check('6 NEW-1 … leaving asks, as for the person\'s own changes', /var added = addedUnsaved\(\);\s*\n\s*return workSafety\.unsavedWork\(\{ dirty: isDirty\(\) && \(!autoOnly\(\) \|\| added\), savedVersion: [^,]+, edited: localEdited \|\| added \}\);/.test(body('hasUnsavedWork')) &&
    /added: canvas && addedUnsaved\(\) \? addedPhrase\(addedSectionsLeft\(\)\) : ''/.test(body('leave')));
  check('6 NEW-1 … the kinds added are kept from the opening, and named in the automatic version\'s note', /addedAtOpening = added; return drawRecords\(added\.length > 0\);/.test(body('applySubcollectionOverlay')) &&
    /if \(addedAtOpening\.length\) noteAuto\(\[addedPhrase\(addedAtOpening\)\]\);/.test(SRC));
  /* the line above the page, run as it is: what was added, for what, and the one step that keeps it */
  var notices = [], cleared = [];
  var N = vm.createContext({ window: { RevampRecords: { TABS: { sessions: { many: 'sessions' }, speakers: { many: 'speakers' }, faq: { many: 'FAQs' } } } }, notices: notices, cleared: cleared });
  N.RevampRecords = N.window.RevampRecords;
  vm.runInContext('var AUTO_SECTIONS = { sessions: { name: "Agenda" }, speakers: { name: "Speakers" }, faq: { name: "FAQs" } };' +
    'var addedAtOpening = [], addedNoteGone = false, addedNoteSaid = "", saving = false, firstSaveDue = false, firstSavePending = false, dirty = true, siteInfo = { savedVersion: 2 };' +
    'var onPage = {}; var canvas = { doc: { querySelector: function (s) { var k = /data-rv-auto="([a-z]+)"/.exec(s)[1]; return onPage[k] ? { classList: { contains: function () { return false; } } } : null; } } };' +
    'function isDirty() { return dirty; } function showNotice(id, o) { notices.push(o); } function clearNotice(id) { cleared.push(id); } function saveToStaging() { return Promise.resolve(); }' +
    ['addedSectionsLeft', 'addedUnsaved', 'kindsWords', 'addedLine', 'addedPhrase', 'noteAddedSections'].map(function (n) { return body(n); }).join('\n'), N);
  vm.runInContext('addedAtOpening = ["sessions"]; onPage.sessions = true; noteAddedSections(); noteAddedSections();', N);
  check('6 NEW-1 the line names what was added and how to keep it, once, with Show it and Save', notices.length === 1 &&
    notices[0].text === 'An “Agenda” section was added for your sessions — press Save to keep it.' && notices[0].actions.map(function (a) { return a.label; }).join() === 'Show it,Save' && notices[0].dismissible === true, notices);
  check('6 NEW-1 … and in the words the leave question and the saved version use', vm.runInContext('addedPhrase(["sessions"])', N) === 'the “Agenda” section added for your sessions' &&
    vm.runInContext('addedLine(["speakers", "sessions"])', N) === '“Speakers” and “Agenda” sections were added for your speakers and sessions — press Save to keep them.' &&
    vm.runInContext('addedLine(["faq"])', N) === 'An “FAQs” section was added for your FAQs — press Save to keep it.');
  vm.runInContext('dirty = false; noteAddedSections();', N);
  check('6 NEW-1 … gone once a save keeps it, and from then on it is a section like any other', cleared.indexOf('auto-sections') !== -1 && vm.runInContext('addedAtOpening.length', N) === 0 && vm.runInContext('addedUnsaved()', N) === false);
  vm.runInContext('addedAtOpening = ["sessions"]; dirty = true; firstSaveDue = true; addedNoteSaid = ""; noteAddedSections();', N);
  check('6 NEW-1 … not said while the first save of a site Create Event just made is due (that save keeps it)', notices.length === 1, notices.length);
  var C = vm.createContext({ navigator: { platform: 'MacIntel' } });
  vm.runInContext(body('saveKeys'), C);
  var mac = C.saveKeys();
  C.navigator = { platform: 'Win32' };
  check('6 the keys as each computer writes them', mac === '⌘S' && C.saveKeys() === 'Ctrl+S', [mac, C.saveKeys()]);
})();

/* ======================= 7 ETB2B AI beside the page (NU-020) ======================= */
(function () {
  check('7 the docked column keeps its room in both modes from 1100 px', /@media \(min-width: 1100px\)\{ html\.rvc-docked \.ed-main\{ margin-right:400px; \} \}/.test(PAGE));
  check('7 Edit with AI docks the panel from 1100 px, floating below it', /var AI_DOCK_QUERY = '\(min-width: 1100px\)';/.test(CHAT) && /chat\.setDock\(dockFor\(ai, aiDockWide\(\)\)\)/.test(CHAT) && /wideMq\.addEventListener\('change', syncMode\)/.test(CHAT));
  check('7 one side panel at a time below 1600 px: a tool panel closes ETB2B AI\'s column, and ETB2B AI closes the tool panel', /var SIDE_BY_SIDE_MIN = 1600;/.test(INLINE) &&
    /if \(!bothFit\(\) && aiDockedOpen\(\)\) window\.RevampAssistant\.close\(\);/.test(body('openPanel', INLINE)) && /if \(anyOpen\) closeToolPanels\(\);/.test(INLINE));
  /* run openPanel's rule on a stand-in: 1440 px with the column docked open */
  var closed = 0, panelsShown = {}, docked = true;
  var ctx = vm.createContext({
    window: { innerWidth: 1440, RevampAssistant: { isOpen: function () { return true; }, close: function () { closed++; } }, dispatchEvent: function () {} },
    document: { documentElement: { classList: { contains: function (c) { return c === 'rvc-docked' && docked; } } } },
    panels: { design: { hidden: true }, forms: { hidden: true } },
    railBtns: [], refitToolsRow: function () {}, rebuildLayersPanel: function () {}, syncDesignPanel: function () {}, Event: function () {}
  });
  ctx.railBtns.forEach = function () {};
  vm.runInContext('var SIDE_BY_SIDE_MIN = 1600;' + body('bothFit', INLINE) + body('aiDockedOpen', INLINE) + body('openPanel', INLINE), ctx);
  ctx.openPanel('design');
  check('7 … at 1440 px opening Theme closes the docked column', closed === 1 && ctx.panels.design.hidden === false);
  ctx.window.innerWidth = 1680; closed = 0;
  ctx.openPanel('forms');
  check('7 … at 1680 px both stay', closed === 0 && ctx.panels.forms.hidden === false);
})();

/* ======================= 8 names (NU-021) ======================= */
(function () {
  check('8 the tools row: "Add element", "Add section", "Sections" (the page\'s sections), each saying what it does',
    /data-panel="add" title="Add a heading, text, button, picture or form to the section you clicked">Add element</.test(PAGE) &&
    /data-panel="predefined" title="Add a new section to the page">Add section</.test(PAGE) && /data-panel="layers" title="The page's sections: move, rename, hide or jump to one">Sections</.test(PAGE));
  check('8 the Sections panel is called so, and says how to add one', /<h3>Sections<\/h3>/.test(PAGE) && /To add one, use Add section\./.test(PAGE) && PAGE.indexOf('<h3>Layers</h3>') === -1);
  check('8 the event rail calls the editor "Site editor" (its id stays design)', /\{ id:'design', label:'Site editor', icon:/.test(SIDEBAR) && SIDEBAR.indexOf("label:'Design'") === -1);
  var wire = body('wireEventRail', INLINE);
  check('8 in the editor the rail\'s other items are marked as leaving it, and say where they open', /item\.setAttribute\('data-leaves', ''\);/.test(wire) && /and leaves the site editor \(unsaved changes are asked about first\)/.test(wire) &&
    /#global-rail \.rail-item\[data-leaves\] \.ri::after\{ content:'\\2197';/.test(PAGE));
})();

(function () {
  check('8 a record\'s "Edit in Content" says in plain words when its changes show, as the console says it (no "staged copy")',
    body('recordPill').indexOf('Changes there are added to your site straight away; visitors see them once the site is published. This editor shows them the next time it opens.') !== -1 &&
    SRC.indexOf('staged copy shows') === -1 && SRC.indexOf("'the page could not be staged'") === -1);
})();

/* ======================= 9 a phone (NU-036) ======================= */
(function () {
  check('9 a phone opens with the Mobile device chosen', /window\.matchMedia\('\(max-width: 720px\)'\)\.matches\)\{\s*\n\s*var phoneBtn = document\.querySelector\('\.device-toggle button\[data-device="mobile"\]'\);\s*\n\s*if \(phoneBtn && !phoneBtn\.classList\.contains\('active'\)\) phoneBtn\.click\(\);/.test(INLINE) &&
    INLINE.indexOf('phoneBtn.click()') < INLINE.indexOf('window.RevampEditorMode.ready();'));
  check('9 … and the live view lays a Mobile page out at the phone\'s width, while Desktop or Tablet chosen there shows that page', /if \(narrow\(\) && w > vw && deviceName\(\) === 'mobile'\) w = vw;/.test(AIMODE));
  var phone = []; var re = /@media \(max-width: 720px\)\{([\s\S]*?)\n  \}/g, m;
  while ((m = re.exec(PAGE))) phone.push(m[1]);
  var blk = phone.join('\n');
  check('9 the mode switch says "AI" and "Myself" in words on a phone (the words take the icons\' place)', /\.mode-toggle \.mt-short\{ display:inline; \}/.test(blk) && /\.mode-toggle button svg\{ display:none; \}/.test(blk) &&
    /<span class="mt-short" aria-hidden="true">AI<\/span>/.test(PAGE) && /<span class="mt-short" aria-hidden="true">Myself<\/span>/.test(PAGE));
  check('9 Help is a 40px tap on a phone', /\.rail-help\{ height:40px; min-width:40px; justify-content:center; \}/.test(blk));
})();

/* ======================= 10 ES5 ======================= */
(function () {
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still run */ }
  check('10 esbuild is there to check ES5', !!esbuild);
  if (!esbuild) return;
  [['editor-start.js', START_SRC], ['editor-template-ui.js', SRC], ['editor-ai-mode.js', AIMODE], ['editor-chat-client.js', CHAT], ['editor-canvas.js', CANVAS], ['custom_editor.html (its script)', INLINE], ['etb2b-chat.js', read('etb2b-chat.js')], ['sidebar.js', SIDEBAR]].forEach(function (f) {
    var ok = (function () { try { esbuild.transformSync(f[1], { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('10 ' + f[0] + ' is ES5 by esbuild', ok === true, ok);
  });
  check('10 editor-start.js: no let / const, arrows or template strings', !/\blet\s|\bconst\s|=>|`/.test(START_SRC));
})();

console.log('editor-start: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
