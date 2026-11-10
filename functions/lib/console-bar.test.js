/* The event console's top bar holds three things (owner decision 13, 2026-11-08: "7 CTA in header is not so
   heavy? I don't think this much tags/CTAs are required here"; v2 on 2026-11-09: no dropdown on the tag, "View live
   site" under Preview, fewer ways to preview): ONE plain state tag next to the name (a link to the review page only
   while a request waits or was rejected), Preview with a small arrow whose menu holds just Live site and Share
   preview link, each saying who it is for, and the one red button. What is saved is quiet words under the name.
   Plain node: node console-bar.test.js */
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
check('1 Preview\'s menu holds just Live site and Share preview link, each saying who it is for, and starts hidden',
  /<span class="ev-menu" id="pv-menu" hidden>\s*<a class="ev-menu-item" id="pv-live" target="_blank" rel="noopener" hidden aria-describedby="pv-live-desc">[^]*?<span class="mi-name">Live site ↗<\/span><small id="pv-live-desc">What visitors see now<\/small><\/span>\s*<\/a>\s*<button class="ev-menu-item" type="button" id="btn-share-preview" data-share-preview hidden/.test(acts) &&
  (acts.match(/class="ev-menu-item"/g) || []).length === 2 && acts.indexOf('Open preview') === -1);
check('1 no save pill and no separate Share preview button among the buttons', acts.indexOf('save-state') === -1 && !/class="btn[^"]*"[^>]*data-share-preview/.test(acts));
check('1 the theme switch and the account still end the bar', /data-theme-toggle-target/.test(acts) && /data-rv-account/.test(acts));

/* 2. under the name: the date, then what is saved */
check('2 what is saved sits in the line under the name, after the date', /<span class="meta" id="ev-meta"><\/span>\s*<span class="save-state" id="ev-save" role="status" hidden><\/span>/.test(title));
check('2 it is quiet words: no pill background or border, muted, only "Unsaved changes" coloured',
  /\.save-state\{[^}]*color: var\(--text-muted\);[^}]*\}/.test(CSS) && !/\.save-state\{[^}]*(background|border|border-radius)/.test(CSS) &&
  /\.save-state\.warn\{ color: var\(--warn\);/.test(CSS) && !/\.save-state\.ok\{/.test(CSS));

/* 3. paintState draws ONE plain tag (a link only to a waiting or rejected request's review), and sets Live site */
var fnAt = HTML.indexOf('  function paintState(){'), fnEnd = HTML.indexOf('\n  }\n', fnAt) + 4;
var fnSrc = HTML.slice(fnAt, fnEnd);
function run(st){
  var box = { hidden: true, innerHTML: '' }, pl = { hidden: true, attrs: {}, setAttribute: function(k, v){ this.attrs[k] = v; } };
  var sb = { box: box, paintPublishButton: function(){}, window: {}, APPROVAL: null, EV: { id: 'qa' },
    $: function(id){ return id === 'ev-state' ? box : id === 'pv-live' ? pl : { hidden: false }; },
    esc: function(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); },
    C: { siteState: function(){ return st; }, publicUrl: function(){ return 'https://x/e/qa'; } } };
  vm.runInNewContext(fnSrc + '\npaintState();', sb);
  return { box: box, pl: pl };
}
var liveChip = { text: 'Live since 21 Oct 2026', short: 'Live', tone: 'ok', title: 'Version 4 of the site is live, published on 21 Oct 2026.' };
var cases = [
  ['draft', { live: false, chips: [{ text: 'Draft', short: 'Draft', tone: 'mute', title: 'The site has not been saved yet.' }] }, 'Draft', 'Draft', 'mute', false, 'Draft'],
  ['live', { live: true, chips: [liveChip] }, 'Live', 'Live', 'ok', false, 'Live since 21 Oct 2026'],
  ['newer', { live: true, newer: true, chips: [liveChip, { text: 'Newer changes not published', short: 'Not published', tone: 'warn', title: 'Version 5 is saved; version 4 is live.' }] },
    'Live · changes not published', 'Not published', 'warn', false, 'Live since 21 Oct 2026 · Newer changes not published'],
  ['pending', { live: false, pending: { id: 'r1' }, chips: [{ text: 'Draft', short: 'Draft', tone: 'mute' }, { text: 'Waiting for approval · Review', short: 'Waiting for approval', tone: 'warn', href: '/review.html?event=qa&request=r1', title: 'Version 2 was sent for approval by priya on 8 Nov 2026.' }] },
    'Draft · waiting for approval', 'Waiting for approval', 'warn', true, 'Draft · Changes were sent for approval by priya on 8 Nov 2026. · Opens the review in a new tab'],
  ['rejected', { live: true, rejected: { id: 'r2' }, chips: [liveChip, { text: 'Changes rejected · Review', short: 'Rejected', tone: 'bad', href: '/review.html?event=qa&request=r2', title: 'Rejected by rahul: fix the date' }] },
    'Live · changes rejected', 'Rejected', 'bad', true, 'Live since 21 Oct 2026 · Rejected by rahul: fix the date · Opens the review in a new tab']
];
cases.forEach(function(c){
  var r = run(c[1]), h = r.box.innerHTML;
  check('3 ' + c[0] + ': one pill of the right tone with its whole and short words', r.box.hidden === false && (h.match(/class="ev-chip /g) || []).length === 1 &&
    h.indexOf('<span class="ev-chip-long">' + c[2] + '</span><span class="ev-chip-short">' + c[3] + '</span>') !== -1 && h.indexOf('ev-chip-' + c[4] + '"') !== -1, h);
  check('3 ' + c[0] + ': no dropdown and no button on the tag', !/<button\b/.test(h) && h.indexOf('ev-menu') === -1 && h.indexOf('aria-expanded') === -1, h);
  check('3 ' + c[0] + (c[5] ? ': a link to the review, in a new tab' : ': not a link'),
    c[5] ? /^<a class="ev-tag" href="\/review\.html\?event=qa&amp;request=r\d" target="_blank" rel="noopener" title="/.test(h) && (h.match(/<a\b/g) || []).length === 1
         : !/<a\b/.test(h), h);
  check('3 ' + c[0] + ': pointing at it tells the rest, in plain words (no version numbers)', h.indexOf('title="' + c[6] + '"') !== -1 && !/title="[^"]*Version \d/.test(h), h);
  check('3 ' + c[0] + ': Live site in Preview\'s menu shows only while the site is live, with its address',
    r.pl.hidden === !c[1].live && (c[1].live ? r.pl.attrs.href === 'https://x/e/qa' : !r.pl.attrs.href), r.pl);
});

/* 4. the menu (topbar-menu.js, shared with the site editor) opens and closes, and is reachable from the keyboard */
var MENU = fs.readFileSync(path.join(ROOT, 'topbar-menu.js'), 'utf8');
check('4 the console loads the shared menu and keeps no copy of its own', /<script src="topbar-menu\.js"><\/script>/.test(HTML) &&
  HTML.indexOf('function wireMenus') === -1 && HTML.indexOf('var MENUS') === -1 && HTML.indexOf('ev-state-btn') === -1 && HTML.indexOf('pv-open') === -1);
check('4 the arrow is a menu button that follows Preview', /id="btn-preview-more" hidden data-topbar-menu data-follows="btn-preview" aria-expanded="false" aria-controls="pv-menu"/.test(HTML));
check('4 a press, Escape and the focus leaving close it; from the keyboard the focus goes to the first shown item, Escape gives it back',
  /closest\('\[data-topbar-menu\]'\)/.test(MENU) && /if \(e\.key !== 'Escape'\) return;/.test(MENU) && /addEventListener\('focusin'/.test(MENU) &&
  /e\.detail === 0/.test(MENU) && MENU.indexOf("box.querySelector('a:not([hidden]), button:not([hidden])')") !== -1 && /open\.focus\(\);/.test(MENU));
check('4 the arrow copies Preview\'s hidden and disabled, its group draws them as one button, and a hidden arrow closes its menu',
  /attributeFilter: \['hidden', 'disabled'\]/.test(MENU) && /group\.classList\.toggle\('has-more', !off\)/.test(MENU) && /if \(off \|\| dis\)/.test(MENU));
// the menu at work, in a small stand-in for the page
(function(){
  var listeners = {}, attrs = {};
  function el(id, extra){ var e = { id: id, hidden: true, disabled: false, attrs: {}, setAttribute: function(k, v){ this.attrs[k] = String(v); }, getAttribute: function(k){ return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute: function(k){ return k in this.attrs; }, focus: function(){ doc.activeElement = this; }, closest: function(){ return null; } }; for (var k in extra) e[k] = extra[k]; return e; }
  var item = el('pv-live', { hidden: false }), btn = el('btn-preview-more', { hidden: false }), box = el('pv-menu', { querySelector: function(){ return item; } });
  btn.attrs = { 'data-topbar-menu': '', 'aria-controls': 'pv-menu', 'aria-expanded': 'false' };
  btn.closest = function(sel){ return sel === '[data-topbar-menu]' ? btn : null; };
  var outside = el('x'); outside.closest = function(){ return null; };
  var doc = { readyState: 'complete', activeElement: null, documentElement: el('html'),
    querySelectorAll: function(){ return [btn]; }, getElementById: function(id){ return { 'pv-menu': box, 'btn-preview-more': btn, 'pv-live': item }[id] || null; },
    addEventListener: function(t, f){ listeners[t] = f; } };
  var win = { document: doc };
  vm.runInNewContext(MENU, { window: win, document: doc });
  listeners.click({ target: btn, detail: 1 });
  var openedByMouse = box.hidden === false && btn.attrs['aria-expanded'] === 'true' && doc.activeElement === null;
  listeners.click({ target: outside, detail: 1 });
  var closedOutside = box.hidden === true && btn.attrs['aria-expanded'] === 'false';
  listeners.click({ target: btn, detail: 0 });
  var keyFocus = box.hidden === false && doc.activeElement === item;
  listeners.keydown({ key: 'Escape' });
  var escBack = box.hidden === true && doc.activeElement === btn;
  check('4 at work: a press opens it, a press elsewhere closes it, the keyboard opens it on its first item, Escape closes it and gives the focus back',
    openedByMouse && closedOutside && keyFocus && escBack, { openedByMouse: openedByMouse, closedOutside: closedOutside, keyFocus: keyFocus, escBack: escBack });
})();

/* 5. phone: the tag and the arrow are 40px taps; the menus keep their words; the date line keeps what is saved */
var tap = CSS.slice(CSS.indexOf('/* ============ TAP TARGETS ON A PHONE'));
check('5 below 720px the tag (when it is a link) is a 40px tap, taken back by its margins, and the arrow 40px wide',
  /\.topbar \.ev-tag\{ min-height:40px; margin:-10px 0; \}/.test(tap) && /\.topbar \.pv-more\{ min-width:40px; \}/.test(tap));
check('5 menu items are 40px tall at every width', /\.ev-menu-item\{[^}]*min-height:40px;/.test(CSS));
check('5 on a phone the date line is no longer hidden whole (it carries what is saved)', CSS.indexOf('.ev-title.with-state .ev-sub:not(.has-portal-chip){ display:none; }') === -1);
check('5 on a phone Preview\'s group sits on the second row and its menu opens to the right',
  /\.topbar\.ev-bar \.pv-split, \.topbar\.ev-bar \.btn\{ order:5;/.test(CSS) && /\.topbar\.ev-bar \.pv-split \.ev-menu\{ right:auto; left:0; \}/.test(CSS));
check('5 no rule left for the old loose parts or the tag\'s old menu', CSS.indexOf('.ev-state .ev-live') === -1 && CSS.indexOf('.ev-chip-more') === -1 &&
  CSS.indexOf('.topbar.ev-bar .save-state') === -1 && CSS.indexOf('.ev-state-menu') === -1 && CSS.indexOf('.ev-menu-line') === -1);

/* 6. the site editor's top bar follows the same rule (owner, 9 Nov: "after clicking on edit with AI is still opening
   the old navigation"): the mode switch, Preview with its arrow, Save and the one red button; where the site stands is
   quiet words under the name */
var ED = fs.readFileSync(path.join(ROOT, 'custom_editor.html'), 'utf8'), EDUI = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
var edHead = strip(ED.slice(ED.indexOf('<header class="topbar">'), ED.indexOf('</header>', ED.indexOf('<header class="topbar">'))));
var edActs = edHead.slice(edHead.indexOf('<span class="topbar-acts">')), edTitle = edHead.slice(0, edHead.indexOf('<span class="topbar-acts">'));
var edButtons = (edActs.match(/<(button|a)\b[^>]*>/g) || []).filter(function(t){ return !/class="ev-menu-item"/.test(t) && !/role="radio"/.test(t); });
check('6 editor: the right side has Preview, its arrow, Save and Publish as its only buttons (plus the mode switch)',
  edButtons.length === 4 && /id="btn-preview"/.test(edButtons[0]) && /id="btn-preview-more"/.test(edButtons[1]) && /id="btn-save"/.test(edButtons[2]) && /id="btn-publish"/.test(edButtons[3]) &&
  /id="ed-mode-toggle"/.test(edActs), edButtons);
check('6 editor: the arrow is a menu button that follows Preview (disabled until the canvas has mounted)',
  /id="btn-preview-more" hidden disabled data-topbar-menu data-follows="btn-preview" aria-expanded="false" aria-controls="pv-menu"/.test(edActs));
check('6 editor: Preview\'s menu holds just Live site and Share preview link, each saying who it is for',
  /<span class="ev-menu" id="pv-menu" hidden>\s*<a class="ev-menu-item" id="pv-live" target="_blank" rel="noopener" hidden aria-describedby="pv-live-desc">[^]*?<span class="mi-name">Live site ↗<\/span><small id="pv-live-desc">What visitors see now<\/small>[^]*?<button class="ev-menu-item" type="button" id="btn-share-preview" data-share-preview hidden aria-label="Share preview link" aria-describedby="pv-share-desc"/.test(edActs) &&
  (edActs.match(/class="ev-menu-item"/g) || []).length === 2);
check('6 editor: where the site stands is under the name, after the dates, not among the buttons',
  /<span class="ed-sub">\s*<span class="meta" id="ed-event-meta"><\/span>\s*<a class="site-state" id="site-state" hidden><\/a>\s*<\/span>/.test(edTitle) && edActs.indexOf('site-state') === -1);
check('6 editor: it is quiet words (no pill), coloured only when it asks for something',
  /\.site-state\{[^}]*color: var\(--text-muted\);[^}]*\}/.test(ED) && !/\.site-state\{[^}]*(background|border-radius|padding)/.test(ED) &&
  /\.site-state\.warn\{ color: var\(--warn\); font-weight:700; \}/.test(ED) && !/\.site-state\.ok\{/.test(ED) && ED.indexOf('.topbar .site-state:not([hidden])') === -1);
check('6 editor: the live site item follows the site, with its public address', /liveItem\.hidden = !siteInfo\.published;/.test(EDUI) && /RevampCore\.publicUrl\(currentEvent \|\| eventId\)/.test(EDUI));
check('6 editor: on a phone Preview\'s group sits on the second row, its menu opens to the right, the arrow is a 40px tap',
  /\.topbar \.pv-split\{ order:6; margin-top:6px; margin-right:auto; \}/.test(ED) && /\.topbar \.pv-split \.ev-menu\{ right:auto; left:0; \}/.test(ED) && /\.topbar \.pv-more\{ min-width:40px; \}/.test(ED));
check('6 editor: the top bar sits above the tools row under it, so Preview\'s menu opens over it, and under the editor\'s dialogs',
  /\.ed > \.topbar\{ z-index:50; \}/.test(ED) && /\.ed-rail\{[^}]*z-index: 40;/.test(ED));
// the stylesheet's version is stamped by the server as the page is sent (lib/delivery.js versionPageAssets, page-versions.test.js)
check('6 both pages load the stylesheet by its plain name (the server stamps its version) and the shared menu',
  /<link rel="stylesheet" href="edit-event\.css">/.test(ED) && /<link rel="stylesheet" href="edit-event\.css">/.test(HTML) && /<script src="topbar-menu\.js"><\/script>/.test(ED));

console.log(fails ? 'console-bar: ' + fails + ' of ' + n + ' checks FAILED' : 'console-bar: all ' + n + ' checks passed');
process.exit(fails ? 1 : 0);
