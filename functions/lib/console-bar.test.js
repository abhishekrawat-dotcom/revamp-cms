/* The event console's top bar holds three things (owner decision 13, 2026-11-08: "7 CTA in header is not so
   heavy? I don't think this much tags/CTAs are required here"): ONE state tag next to the name that opens a small
   menu, Preview with a small arrow whose menu holds Share preview link, and the one red button. What is saved is
   quiet words under the name. Plain node: node console-bar.test.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
var HTML = fs.readFileSync(path.join(ROOT, 'edit-event.html'), 'utf8');
var CSS = fs.readFileSync(path.join(ROOT, 'edit-event.css'), 'utf8');
var fails = 0, n = 0;
function check(name, ok, info){ n++; if (!ok){ fails++; console.log('FAIL ' + name + (info !== undefined ? ' — ' + JSON.stringify(info).slice(0, 300) : '')); } }
function strip(s){ return s.replace(/<!--[^]*?-->/g, ''); }

var head = strip(HTML.slice(HTML.indexOf('<header class="topbar ev-bar">'), HTML.indexOf('</header>')));
var acts = head.slice(head.indexOf('<span class="topbar-acts">'));
var title = head.slice(0, head.indexOf('<span class="topbar-acts">'));

/* 1. the right side: Preview's group, Publish, the theme switch, the account — nothing else */
var visible = (acts.match(/<(button|a)\b[^>]*>/g) || []).filter(function(t){ return !/class="ev-menu-item"/.test(t); });
check('1 the right side has Preview, its arrow and Publish as its only buttons',
  visible.length === 3 && /id="btn-preview"/.test(visible[0]) && /id="btn-preview-more"/.test(visible[1]) && /id="btn-publish"/.test(visible[2]), visible);
check('1 the arrow says what it opens and starts closed and hidden', /aria-controls="pv-menu"/.test(visible[1]) && /aria-expanded="false"/.test(visible[1]) &&
  /\shidden\s/.test(visible[1]) && /aria-label="More ways to preview"/.test(visible[1]));
check('1 Preview\'s menu holds Open preview and Share preview link, and starts hidden',
  /<span class="ev-menu" id="pv-menu" hidden>\s*<button class="ev-menu-item" type="button" id="pv-open">[^]*?<span>Open preview<\/span>\s*<\/button>\s*<button class="ev-menu-item" type="button" id="btn-share-preview" data-share-preview hidden/.test(acts));
check('1 no save pill and no separate Share preview button among the buttons', acts.indexOf('save-state') === -1 && !/class="btn[^"]*"[^>]*data-share-preview/.test(acts));
check('1 the theme switch and the account still end the bar', /data-theme-toggle-target/.test(acts) && /data-rv-account/.test(acts));

/* 2. under the name: the date, then what is saved */
check('2 what is saved sits in the line under the name, after the date', /<span class="meta" id="ev-meta"><\/span>\s*<span class="save-state" id="ev-save" role="status" hidden><\/span>/.test(title));
check('2 it is quiet words: no pill background or border, muted, only "Unsaved changes" coloured',
  /\.save-state\{[^}]*color: var\(--text-muted\);[^}]*\}/.test(CSS) && !/\.save-state\{[^}]*(background|border|border-radius)/.test(CSS) &&
  /\.save-state\.warn\{ color: var\(--warn\);/.test(CSS) && !/\.save-state\.ok\{/.test(CSS));

/* 3. paintState draws ONE tag and its menu, for each state */
var fnAt = HTML.indexOf('  function paintState(){'), fnEnd = HTML.indexOf('\n  }\n', fnAt) + 4;
var fnSrc = HTML.slice(fnAt, fnEnd);
function run(st){
  var box = { hidden: true, innerHTML: '' };
  var sb = { box: box, paintPublishButton: function(){}, window: {}, APPROVAL: null, EV: { id: 'qa' },
    $: function(id){ return id === 'ev-state' ? box : { hidden: false }; },
    esc: function(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); },
    C: { siteState: function(){ return st; }, publicUrl: function(){ return 'https://x/e/qa'; } } };
  vm.runInNewContext(fnSrc + '\npaintState();', sb);
  return box;
}
var live = { chip: { text: 'Live since 21 Oct 2026', short: 'Live', tone: 'ok', title: 'Version 4 of the site is live, published on 21 Oct 2026.' } };
var cases = [
  ['draft', { live: false, chips: [{ text: 'Draft', short: 'Draft', tone: 'mute', title: 'The site has not been saved yet.' }] }, 'Draft', 'Draft', 'mute', 0, false],
  ['live', { live: true, chips: [live.chip] }, 'Live', 'Live', 'ok', 0, true],
  ['newer', { live: true, newer: true, chips: [live.chip, { text: 'Newer changes not published', short: 'Not published', tone: 'warn', title: 'Version 5 is saved; version 4 is live.' }] },
    'Live · changes not published', 'Not published', 'warn', 0, true],
  ['pending', { live: false, pending: { id: 'r1' }, chips: [{ text: 'Draft', short: 'Draft', tone: 'mute' }, { text: 'Waiting for approval · Review', short: 'Waiting for approval', tone: 'warn', href: '/review.html?event=qa&request=r1', title: 'Sent for approval.' }] },
    'Draft · waiting for approval', 'Waiting for approval', 'warn', 1, false],
  ['rejected', { live: true, rejected: { id: 'r2' }, chips: [live.chip, { text: 'Changes rejected · Review', short: 'Rejected', tone: 'bad', href: '/review.html?event=qa&request=r2', title: 'Rejected: fix the date.' }] },
    'Live · changes rejected', 'Rejected', 'bad', 1, true]
];
cases.forEach(function(c){
  var box = run(c[1]), h = box.innerHTML;
  var buttons = h.match(/<button\b[^>]*>/g) || [];
  check('3 ' + c[0] + ': one tag, a button that opens its menu', box.hidden === false && buttons.length === 1 &&
    /class="ev-tag" id="ev-state-btn" aria-expanded="false" aria-controls="ev-state-menu"/.test(buttons[0]), h.slice(0, 200));
  check('3 ' + c[0] + ': its words, whole and short, in one pill of the right tone',
    h.indexOf('<span class="ev-chip ev-chip-' + c[4] + '"><span class="ev-chip-long">' + c[2] + '</span><span class="ev-chip-short">' + c[3] + '</span>') !== -1, h.slice(0, 300));
  check('3 ' + c[0] + ': the menu starts hidden and tells the whole story', /<span class="ev-menu ev-state-menu" id="ev-state-menu" hidden>/.test(h) &&
    c[1].chips.every(function(ch){ return h.indexOf('<b>' + ch.text.replace(/ · Review$/, '') + '</b>') !== -1; }));
  check('3 ' + c[0] + ': the review link and the live site are in the menu, opening a new tab',
    ((h.match(/Open the review ↗/g) || []).length === c[5]) && ((h.match(/View live site ↗/g) || []).length === (c[6] ? 1 : 0)) &&
    (h.match(/<a\b[^>]*>/g) || []).every(function(a){ return /target="_blank" rel="noopener"/.test(a); }));
  check('3 ' + c[0] + ': nothing else beside the tag (no second pill, no loose link)', (h.match(/class="ev-chip /g) || []).length === 1 &&
    h.indexOf('</button>') < h.indexOf('<span class="ev-menu'), h);
});

/* 4. the menus open and close, and are reachable from the keyboard */
check('4 the menus are wired once, with a press, Escape and the focus leaving closing them',
  /wireMenus\(\);/.test(HTML) && /function wireMenus\(\)\{/.test(HTML) && /if \(e\.key !== 'Escape'\) return;/.test(HTML) &&
  /addEventListener\('focusin'/.test(HTML) && /e\.detail === 0/.test(HTML) && /\$\('pv-open'\)\.onclick = function\(\)\{ \$\('btn-preview'\)\.click\(\); \};/.test(HTML));
check('4 the arrow follows Preview; Open preview only with a saved site',
  /\$\('btn-preview-more'\)\.hidden = !ready;/.test(HTML) && /\$\('pv-open'\)\.hidden = !pvSaved;/.test(HTML));

/* 5. phone: the tag and the arrow are 40px taps; the menus keep their words; the date line keeps what is saved */
var tap = CSS.slice(CSS.indexOf('/* ============ TAP TARGETS ON A PHONE'));
check('5 below 720px the tag is a 40px tap (taken back by its margins) and the arrow 40px wide',
  /\.topbar \.ev-tag\{ min-height:40px; margin:-10px 0; \}/.test(tap) && /\.topbar \.pv-more\{ min-width:40px; \}/.test(tap));
check('5 menu items are 40px tall at every width', /\.ev-menu-item\{[^}]*min-height:40px;/.test(CSS));
check('5 on a phone the date line is no longer hidden whole (it carries what is saved)', CSS.indexOf('.ev-title.with-state .ev-sub:not(.has-portal-chip){ display:none; }') === -1);
check('5 on a phone Preview\'s group sits on the second row and its menu opens to the right',
  /\.topbar\.ev-bar \.pv-split, \.topbar\.ev-bar \.btn\{ order:5;/.test(CSS) && /\.topbar\.ev-bar \.pv-split \.ev-menu\{ right:auto; left:0; \}/.test(CSS));
check('5 no rule left for the old loose parts', CSS.indexOf('.ev-state .ev-live') === -1 && CSS.indexOf('.ev-chip-more') === -1 && CSS.indexOf('.topbar.ev-bar .save-state') === -1);

console.log(fails ? 'console-bar: ' + fails + ' of ' + n + ' checks FAILED' : 'console-bar: all ' + n + ' checks passed');
process.exit(fails ? 1 : 0);
