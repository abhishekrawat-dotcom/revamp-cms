/* node functions/lib/page-skeleton.test.js — every page the server sends is a real HTML document at the device's width
   (UX-002), and the site editor is usable on a phone.

   Without <!doctype html> a browser draws a page in quirks mode (tables, percentage heights and icon-only lines are
   laid out the old way), and without <meta name="viewport"> a phone lays it out 980 px wide and shrinks it to fit, so
   none of the page's phone rules ever apply. The site editor had neither (it also began with a byte-order mark and a
   comment naming the old product), Create Event and the event console had no doctype and no lang, and the console no
   charset. This test keeps every one of them from coming back:
     1. every served page (functions/lib/access.js isServableFile: the top level, the Figma import, the template
        preview) starts with the doctype, nothing before it, and has <html lang>, a utf-8 charset in its first 1024 bytes
        (where a browser looks for it) and a device-width viewport. Not pages: a template's section files (pieces put
        into a page, never sent on their own) and the empty placeholders (banner.html, templates/_shared/none.html);
     2. the three pages this change gave a head: their titles ("<Page> — EventSphere", the tab form), the browser-tab
        icon line, no byte-order mark and no old name before the doctype;
     3. the site editor on a phone (editor-ai-mode.js startMode): below 720 px it opens in Edit with AI unless the
        address asks for a mode, and the choice remembered for a bigger screen is left as it was;
     4. the phone rules: they are all inside a (max-width) media query, so nothing changes at 1440 px (and the sweep
        compared every changed page at 1440 before and after), the tools that need a big screen are put away there,
        and Save and Publish stay in the top bar's second row with an icon beside their words;
     5. the console's top bar keeps what is saved in sight at every width, in shorter words where it is narrow.
   Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
var access = require('./access');

var failures = [], checks = 0;
function check(label, cond, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 600) : '')); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ---------- 1. every served page ---------- */
function walk(dir, out) {
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(function (d) {
    if (d.name.charAt(0) === '.' || d.name === 'node_modules') return;
    var rel = dir ? dir + '/' + d.name : d.name;
    if (d.isDirectory()) { if (!dir && ['assets', 'templates', 'import-figma-design', 'template-previews', 'promo-studio'].indexOf(d.name) === -1) return; walk(rel, out); }
    else if (/\.html$/i.test(d.name)) out.push(rel);
  });
  return out;
}
var pages = walk('', []).filter(function (rel) {
  if (!access.isServableFile(rel)) return false;
  if (/(^|\/)sections\//.test(rel)) return false;                      // a section of a template: a piece of a page
  return fs.statSync(path.join(ROOT, rel)).size > 0;                   // an empty placeholder is not a page
});
check('the pages found include the dashboard, sign-in, the editor, Create Event, the console and the template preview',
  ['Event_Listing.html', 'index.html', 'custom_editor.html', 'create-event.html', 'edit-event.html', 'templates/preview.html', 'import-figma-design/index.html']
    .every(function (p) { return pages.indexOf(p) !== -1; }), pages);
check('no page is left out: at least 20 of them', pages.length >= 20, pages.length);
var bad = [];
pages.forEach(function (rel) {
  var raw = fs.readFileSync(path.join(ROOT, rel));
  var s = raw.toString('utf8'), head = raw.slice(0, 1024).toString('utf8');
  var why = [];
  if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) why.push('starts with a byte-order mark');
  if (!/^<!doctype html>/i.test(s)) why.push('does not start with <!doctype html>');
  if (!/<html\b[^>]*\slang="[a-z]{2}(-[A-Za-z]{2})?"/i.test(s.slice(0, 2000))) why.push('no <html lang>');
  if (!/<meta\s+charset="?utf-8"?\s*\/?>/i.test(head)) why.push('no utf-8 charset in the first 1024 bytes');
  if (!/<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1[^"]*"\s*\/?>/i.test(s)) why.push('no device-width viewport');
  if (why.length) bad.push(rel + ': ' + why.join(', '));
});
check('every served page starts with the doctype and has lang, a utf-8 charset and the device-width viewport', bad.length === 0, bad);

/* ---------- 2. the three heads this change wrote ---------- */
var ICON = '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">';
var HEADS = { 'custom_editor.html': 'Site editor', 'create-event.html': 'Create Event', 'edit-event.html': 'Event console' };
Object.keys(HEADS).forEach(function (rel) {
  var s = read(rel);
  var top = s.slice(0, s.indexOf('</title>') + 8);
  check(rel + ': doctype, <html lang="en">, <head>, then the charset and the viewport, in that order',
    /^<!doctype html>\n<html lang="en">\n<head>\n(<!--[^\n]*-->\n)?<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>/.test(s), s.slice(0, 300));
  check(rel + ': its title is "' + HEADS[rel] + ' — EventSphere" (a tab, where space is tight: owner decision 6)', top.indexOf('<title>' + HEADS[rel] + ' &mdash; EventSphere</title>') !== -1, top.slice(-120));
  check(rel + ': the browser-tab icon right after the title', s.indexOf('</title>\n' + ICON + '\n') !== -1);
  check(rel + ': no old product name before the title', !/Revamp CMS|Oneworld/.test(top), top);
});

/* ---------- 3. which mode the editor opens in ---------- */
var MODE_SRC = read('editor-ai-mode.js');
function loadModes() {
  var listeners = {};
  var win = { innerWidth: 1440, addEventListener: function (t, fn) { listeners[t] = fn; }, location: { search: '' } };
  var sandbox = { window: win, location: win.location, document: { querySelector: function () { return null; }, body: { classList: { add: function () {}, remove: function () {} } } },
    URLSearchParams: URLSearchParams, setTimeout: setTimeout, clearTimeout: clearTimeout, console: console };
  vm.createContext(sandbox);
  vm.runInContext(MODE_SRC, sandbox, { filename: 'editor-ai-mode.js' });
  return win.RevampEditorMode;
}
var M = loadModes();
var startMode = M && M._test && M._test.startMode;
check('editor-ai-mode.js offers startMode for this test', typeof startMode === 'function');
if (typeof startMode === 'function') {
  check('a phone opens in Edit with AI, whatever was remembered from a bigger screen',
    startMode('', 'manual', true) === 'ai' && startMode('', '', true) === 'ai' && startMode(null, 'ai', true) === 'ai');
  check('the address still wins on a phone (?mode=manual) and anywhere else',
    startMode('manual', 'ai', true) === 'manual' && startMode('ai', 'manual', false) === 'ai' && startMode('manual', '', false) === 'manual');
  check('a bigger screen opens in the mode remembered, else Edit myself',
    startMode('', 'ai', false) === 'ai' && startMode('', 'manual', false) === 'manual' && startMode('', '', false) === 'manual' && startMode('bogus', 'nonsense', false) === 'manual');
}
check('ready() opens in the mode startMode gives, for this visit only (keep: the remembered choice is not changed)',
  /var start = startMode\(asked, remembered\(\), narrow\(\)\);/.test(MODE_SRC) && /if \(start === 'ai'\) setMode\('ai', \{ section: section, keep: true \}\);/.test(MODE_SRC));

/* ---------- 4. the phone rules ---------- */
var EDITOR = read('custom_editor.html'), CSS = read('edit-event.css'), CONSOLE = read('edit-event.html');
/* the body of each @media block whose query is exactly q (a block's own braces are balanced) */
function mediaBlocks(src, q) {
  var out = [], at = 0, key = '@media (max-width: ' + q + ')';
  for (;;) {
    var i = src.indexOf(key, at); if (i === -1) return out;
    var j = src.indexOf('{', i), depth = 0, k = j;
    for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) break; }
    out.push(src.slice(j + 1, k)); at = k;
  }
}
var phone = mediaBlocks(EDITOR, '720px').join('\n');
check('editor, below 720px: the tools row, the pills and their pop-ups are put away in both modes',
  /\.ed-rail \.rail-tools, \.ed-rail \.rail-scroll, #rail-more-menu, #panel-add, #panel-layers, #panel-design, #panel-forms, #lyr-ctx-menu,\s*\.tpl-sel-toolbar, \.tpl-sec-toolbar, \.tpl-pop, #gt-style-pop\{ display:none !important; \}/.test(phone), phone.slice(0, 400));
check('editor, below 720px: the top bar wraps onto two rows, Save and Publish in the second with their words and an icon',
  /\.topbar\{ height:auto; flex-wrap:wrap;/.test(phone) && /\.topbar \.topbar-acts\{ display:contents; \}/.test(phone) &&
  /\.topbar::after\{ content:''; order:5; flex-basis:100%; height:0; \}/.test(phone) && /\.topbar #btn-save, \.topbar #btn-publish\{ order:7;/.test(phone) &&
  /#btn-save::before, #btn-publish::before\{ content:''; width:15px; height:15px;/.test(phone) && /\.topbar \.btn\{ min-height:40px; \}/.test(phone));
check('editor: the phone rules are only ever inside (max-width) queries (nothing changes at 1440)',
  EDITOR.indexOf('.topbar .topbar-acts{ display:contents; }') === EDITOR.indexOf('.topbar .topbar-acts{ display:contents; }', 0) &&
  phone.indexOf('.topbar .topbar-acts{ display:contents; }') !== -1 && (EDITOR.match(/\.topbar \.topbar-acts\{ display:contents; \}/g) || []).length === 1);
var consolePhone = mediaBlocks(CSS, '600px').join('\n');
check('console, below 600px: the top bar takes two rows (name, theme and account above; what is saved, Preview, Share and Publish below)',
  /\.topbar\.ev-bar\{[^}]*flex-wrap:wrap;/.test(consolePhone) && /\.topbar\.ev-bar \.topbar-acts\{ display:contents; \}/.test(consolePhone) &&
  /\.topbar\.ev-bar::after\{ content:''; order:4; flex-basis:100%; height:0; \}/.test(consolePhone) && /<header class="topbar ev-bar">/.test(CONSOLE), consolePhone.slice(0, 300));
check('console: the rail and every sticky part below the taller top bar are placed under it (--topbar-h)',
  /\.topbar\.ev-bar ~ \.shell\{ --topbar-h:\s*\d+px; \}/.test(consolePhone));

/* ---------- 5. what is saved, at every width ---------- */
check('console: the save state is no longer hidden at 1100px and below', !/@media \(max-width: 1100px\)\{ \.save-state\{ display:none; \} \}/.test(CSS));
var src = (function () { var i = CONSOLE.indexOf('function paintSaveState'); var j = CONSOLE.indexOf('\n  }\n', i); return i === -1 ? '' : CONSOLE.slice(i, j + 4); })();
var chip = { hidden: true, attrs: {}, className: '', innerHTML: '', title: '', getAttribute: function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }, setAttribute: function (k, v) { this.attrs[k] = String(v); } };
var sb = { EV: { id: 'qa' }, busy: false, dirty: false, MODAL: null, $: function (id) { return id === 'ev-save' ? chip : { hidden: false }; } };
vm.runInNewContext('var LEAVE = { dirty: function(){ return dirty; } }; function writesOut(){ return busy; }\n' + src + '; this.paintSaveState = paintSaveState;', sb);
var seen = [];
sb.paintSaveState(); seen.push(chip.innerHTML);
sb.dirty = true; sb.paintSaveState(); seen.push(chip.innerHTML);
sb.busy = true; sb.paintSaveState(); seen.push(chip.innerHTML);
check('the save state has its whole words and the short ones a narrow bar shows (Saved / Unsaved / Saving…)',
  seen[0] === '<span class="ss-long">All changes saved</span><span class="ss-short" aria-hidden="true">Saved</span>' &&
  seen[1] === '<span class="ss-long">Unsaved changes</span><span class="ss-short" aria-hidden="true">Unsaved</span>' &&
  seen[2] === '<span class="ss-long">Saving…</span><span class="ss-short" aria-hidden="true">Saving…</span>', seen);
var narrow = mediaBlocks(CSS, '1100px').join('\n');
check('at 1100px and below the short words show and the whole ones stay for screen readers',
  /\.save-state \.ss-short\{ display:none; \}/.test(CSS) && /\.save-state \.ss-long\{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect\(0 0 0 0\); white-space:nowrap; \}/.test(narrow) &&
  /\.save-state \.ss-short\{ display:inline; \}/.test(narrow), narrow.slice(0, 300));

if (failures.length) { console.error('page-skeleton: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('page-skeleton: all ' + checks + ' checks passed');
