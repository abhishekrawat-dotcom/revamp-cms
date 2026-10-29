// node functions/lib/promo-social-studio.test.js — Promotions → Social posts' page (promo-social-studio.html): the
// platform's social posts studio as tools/extract-promo-social.py copies and patches it (promo-studio/social-studio.js).
// No network: the copied code runs in a vm over a small stand-in for the page (the ids of its own markup at load, then
// any id, as the code writes the rest itself), and the Oneworld functions it calls are stubs. When the platform's
// index.html is on this machine, the extractor is also run on it in a scratch folder: it must make these exact files,
// and stop, naming the patch, when one of its anchors has changed.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process');
var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }
function count(s, sub) { return sub ? s.split(sub).length - 1 : 0; }
var passed = 0, failed = 0, notes = [];
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

var studio = read('promo-studio/social-studio.js');
var page = read('promo-social-studio.html');
var py = read('tools/extract-promo-social.py');

/* ---- E.1: every patch is applied exactly as listed in the extractor ---- */
var pStart = py.indexOf('SOCIAL_PATCHES = [');
var pBlock = py.slice(pStart, py.indexOf('\n]\n', pStart));
var patchRe = /\('(S\d+′?)',\s*'(code|markup)',\s*r'''([\s\S]*?)''',\s*r'''([\s\S]*?)''',\s*(\d+),/g, pm, patches = [];
while ((pm = patchRe.exec(pBlock))) patches.push({ id: pm[1], where: pm[2], old: pm[3], neu: pm[4], times: Number(pm[5]) });
var IDS = [];
for (var n = 1; n <= 28; n++) IDS.push('S' + n + (n === 5 || n === 7 ? '′' : ''));
check('28 patches, S1 to S28 in order (S5′ and S7′ as revised)', patches.map(function (p) { return p.id; }).join() === IDS.join(), patches.map(function (p) { return p.id; }));
check('only S8 and S26 change the markup', patches.filter(function (p) { return p.where === 'markup'; }).map(function (p) { return p.id; }).join() === 'S8,S26');
check('S24 and S27 apply three times each, every other patch once', patches.every(function (p) { return p.times === (p.id === 'S24' || p.id === 'S27' ? 3 : 1); }));
patches.forEach(function (p) {
  var where = p.where === 'markup' ? page : studio;
  // S4 inserts after its anchor, so the anchor is left inside the replacement and nowhere else
  var left = count(where, p.old), inside = count(p.neu, p.old);
  check(p.id + ': the platform\'s text is gone (except inside its own replacement)', left === p.times * inside, { left: left, inside: inside });
  check(p.id + ': its replacement is there ' + p.times + ' time(s)', count(where, p.neu) === p.times, count(where, p.neu));
});
check('the code says it carries patches', /unchanged except SOCIAL_PATCHES \(listed in tools\/extract-promo-social\.py\)/.test(studio.slice(0, 400)));
check('the extractor stops before writing when a count differs', py.indexOf('sys.exit(\'patch %s') !== -1 &&
  py.indexOf('Everything is read and checked above; only now is anything written.') > py.indexOf('for pid, where, old, new, want, why in SOCIAL_PATCHES:'));

/* ---- E.2: the copied code ---- */
function compiles(src, name) { try { new vm.Script(src, { filename: name }); return true; } catch (e) { return String(e && e.message); } }
check('social-studio.js parses', compiles(studio, 'social-studio.js') === true, compiles(studio, 'social-studio.js'));
['async function openEvent', 'function renderEventDetail', 'function buildParams', 'function edSave', 'async function applyOptions',
  'owRenderCaption()', 'owLeaveEditor()', 'owNudgeSnap()', 'owConfirmReset()', 'owMayDiscard()', '!e.defaultPrevented'].forEach(function (s) {
  check('the code has ' + s, studio.indexOf(s) !== -1);
});
// the drawer, Generate all and the drawer's way into the editor are not copied (nothing on this page reaches them)
['openGenerate', 'function generateAll', 'function showCards', 'function editFromDrawer', 'X-Caption', 'function preview(', 'function downloadSel',
  'function closeDrawer', 'fmtsSel'].forEach(function (s) {
  check('the code has no ' + s, studio.indexOf(s) === -1);
});
// oneworld-social.js loads after this file: what it replaces or wraps must be a plain function declaration (a const
// or let could be neither redeclared nor reassigned), and what it declares must not be declared here
['toast', 'cardHtml', 'loadThumbs', 'openEditor', 'closeEditor', 'loadEditor', 'refreshThumbs', 'renderOptions', 'renderEventDetail',
  'edDownload', 'edDownloadZip', 'wirePanel'].forEach(function (f) {
  check(f + ' is a function declaration, so Oneworld\'s file can replace or wrap it',
    new RegExp('(^|[\\n;] ?)(async )?function ' + f + '\\(').test(studio) && !new RegExp('\\b(const|let|var) ' + f + '\\b').test(studio));
});
var ADAPTER = ['EVENT_ID', 'S', 'CAT', 'SEL', 'MAILERS', 'previewCache', 'thumbCache', 'api', 'OWS', 'mark', 'crumbs', 'setProdNav', 'openPortal',
  'showPortals', 'renderEvents', 'mailerCards', 'renderEvSaved', 'owLeaveEditor', 'owNudgeSnap', 'owConfirmReset', 'owMayDiscard', 'owRenderCaption',
  'OWSArt', 'OWSCap', 'OWSocial'];
ADAPTER.forEach(function (g) {
  check('the code does not declare ' + g + ' (Oneworld\'s files do)', !new RegExp('\\b(function|const|let|var|class)\\s+' + g + '\\b').test(studio));
});
/* owner A: the platform's Liquid skin is stored in localStorage "mlTheme" and set as data-theme; none of that is copied */
check('no theme switch or stored theme in the code', studio.indexOf('localStorage') === -1 && !/dataset\.theme\s*=|data-theme|mlTheme/.test(studio));
/* owner B: no stock art anywhere on the page */
check('no stock mailer art', studio.indexOf('mailer-art') === -1 && page.indexOf('mailer-art') === -1);

/* ---- E.3: the page ---- */
var THEME_TAG = '<script src="promo-studio/oneworld-theme.js"></script>';
var headEnd = page.indexOf('</head>');
function firstOf(re) { var m = re.exec(page); return m ? m.index : -1; }
check('the theme script once, in the head', count(page, THEME_TAG) === 1 && page.indexOf(THEME_TAG) < headEnd);
check('the theme script before any stylesheet, link or script (the first paint is already in the theme)',
  page.indexOf(THEME_TAG) < firstOf(/<link\b/) && page.indexOf(THEME_TAG) < firstOf(/stylesheet/) && page.indexOf(THEME_TAG) === firstOf(/<script\b/) &&
  page.indexOf('<style') === -1);
check('the extractor writes the same tag in the same place', count(py, THEME_TAG) === 1 && py.indexOf(THEME_TAG) < py.indexOf('<link rel="stylesheet" href="promo-studio/mailer-studio.css">'));
var sheets = [], shRe = /<link rel="stylesheet" href="([^"]+)">/g, sh;
while ((sh = shRe.exec(page))) sheets.push(sh[1]);
check('stylesheets: the platform\'s, then Oneworld\'s tokens, then the social page\'s own', sheets.join() === 'promo-studio/mailer-studio.css,promo-studio/oneworld.css,promo-studio/oneworld-social.css', sheets);
check('every stylesheet is in the head', page.lastIndexOf('stylesheet') < headEnd);
var scripts = [], scRe = /<script src="([^"]+)"><\/script>/g, sc;
while ((sc = scRe.exec(page))) scripts.push(sc[1]);
check('the scripts, in order: theme, sign-in, the exact drawing, zip, the bundle, the copied code, then Oneworld\'s three (caption last)', scripts.join() === [
  'promo-studio/oneworld-theme.js', 'auth.js', 'assets/vendor/html-to-image-exact.js', 'assets/vendor/jszip.min.js', 'assets/vendor/promo-social.js',
  'promo-studio/social-studio.js', 'promo-studio/oneworld-social.js', 'promo-studio/oneworld-social-art.js', 'promo-studio/oneworld-social-caption.js'].join(), scripts);
check('no other script on the page', count(page, '<script') === 9);
/* the server sends only an allow-list of files (access.js): the page itself, and everything it loads from this server */
var access = require('./access');
check('the server sends the page, and only to someone signed in', access.isServableFile('promo-social-studio.html') &&
  access.isPublic({ method: 'GET', headers: {} }, '/promo-social-studio.html') === false);
var local = (page.match(/(?:src|href)="[^"]+"/g) || []).map(function (a) { return a.replace(/^(?:src|href)="|"$/g, ''); })
  .filter(function (u) { return !/^(https?:)?\/\/|^#|^data:|^about:/.test(u); });
var unserved = local.filter(function (u) { return !access.isServableFile(u.split('?')[0]); });
check('every file the page loads is one the server sends', local.length === 12 && !unserved.length, { local: local, unserved: unserved });
/* the files the page shares with the mailer page are already there; the rest are made by the other parts of this build */
['auth.js', 'assets/vendor/jszip.min.js', 'promo-studio/oneworld-theme.js', 'promo-studio/mailer-studio.css', 'promo-studio/oneworld.css'].forEach(function (f) {
  check('the page\'s ' + f + ' is there', exists(f));
});
local.forEach(function (f) { if (!exists(f)) notes.push('the page loads ' + f + ', which is not there yet'); });
check('no stock html-to-image (its font-size floor makes text smaller than the platform\'s)', page.indexOf('assets/vendor/html-to-image.js') === -1);
check('the scripts come after all the markup they look up at load', page.indexOf('<script src="auth.js">') > page.indexOf('id="uiModal"') &&
  page.indexOf('<script src="auth.js">') > page.indexOf('id="edGroupRot"'));
check('the title', page.indexOf('<title>Social posts — Oneworld 2.0</title>') !== -1 && count(page, '<title>') === 1);
check('says it is generated', page.indexOf('<!-- GENERATED by tools/extract-promo-social.py') !== -1 && page.indexOf('<!-- GENERATED') < headEnd);
check('the body, the app and its content', page.indexOf('<body class="ow-embed ow-social">') !== -1 && page.indexOf('<div id="app" style="display:block">') !== -1 &&
  page.indexOf('<div class="content" id="content"></div>') !== -1 && page.indexOf('id="content"') < page.indexOf('id="editor"'));
check('one id="edBg", on the Background select', count(page, 'id="edBg"') === 1 && /<select id="edBg" /.test(page));
check('one id="edBase", on the stage\'s picture', count(page, 'id="edBase"') === 1 && /<img class="bg" id="edBase" alt="">/.test(page));
var ids = (page.match(/\sid="[^"]+"/g) || []).map(function (m) { return m.slice(5, -1); });
var dupes = ids.filter(function (x, i) { return ids.indexOf(x) !== i; });
check('every id on the page is used once', dupes.length === 0, dupes);
check('Back asks before leaving', page.indexOf('onclick="owLeaveEditor()"') !== -1 && page.indexOf('closeEditor()') === -1);
check('no Liquid switch on the page', page.indexOf('theme-toggle') === -1 && page.indexOf('mlTheme') === -1 && page.indexOf('data-theme') === -1);
check('the editor, the toast and the dialog are on the page', ['id="editor"', 'id="edTpl"', 'id="edFmt"', 'id="edTheme"', 'id="edCanvas"', 'id="edStage"',
  'id="edSide"', 'id="edUndo"', 'id="edRedo"', 'id="toast"', 'id="uiModal"', 'id="uiModalOk"', 'id="uiModalCancel"', 'id="uiModalInput"'].every(function (s) { return page.indexOf(s) !== -1; }));
/* the font link holds every web font the editor offers (EDFONTS), so a font picked in the editor is the font drawn */
var fontLink = (page.match(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+" rel="stylesheet">/) || [''])[0];
var edfonts = (studio.match(/const EDFONTS=(\[[^\]]+\]);/) || [])[1];
edfonts = edfonts ? JSON.parse(edfonts) : [];
var SYSTEM_FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Courier New'];
var webFonts = edfonts.filter(function (f) { return SYSTEM_FONTS.indexOf(f) === -1; });
check('the platform\'s font link, before the stylesheets', fontLink !== '' && page.indexOf(fontLink) < page.indexOf('promo-studio/mailer-studio.css') &&
  page.indexOf('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>') !== -1);
check('nine web fonts, each in the link', webFonts.length === 9 && webFonts.every(function (f) { return fontLink.indexOf('family=' + f.replace(/ /g, '+') + (f === 'Anton' || f === 'Bebas Neue' ? '&' : ':')) !== -1; }), webFonts);
/* every id the code looks up is on the page or written by the code itself (dParams is the drawer's: every caller on
   this page passes its own host, so it is never looked up) */
var lookups = {}, luRe = /\$\("([A-Za-z0-9_-]+)"\)/g, lu;
while ((lu = luRe.exec(studio))) lookups[lu[1]] = 1;
var unknown = Object.keys(lookups).filter(function (id) { return id !== 'dParams' && page.indexOf('id="' + id + '"') === -1 && studio.indexOf('id="' + id + '"') === -1; });
check('every id the code looks up exists', unknown.length === 0, unknown);
check('dParams is only ever a fallback for a missing host', count(studio, '$("dParams")') === 2 && studio.indexOf('host||$("dParams")') !== -1 && studio.indexOf('(host||$("dParams"))') !== -1);

/* ---- E.4: escapeHtml escapes quotes too (S1) ---- */
var escLines = studio.split('\n').filter(function (l) { return /^const escapeHtml=/.test(l); });
check('one escapeHtml', escLines.length === 1, escLines.length);
var escaped = escLines.length ? vm.runInNewContext(escLines[0] + '\nescapeHtml(input)', { input: 'a"b\'c<d>&' }) : null;
check('escapeHtml: a"b\'c<d>& -> a&quot;b&#39;c&lt;d&gt;&amp;', escaped === 'a&quot;b&#39;c&lt;d&gt;&amp;', escaped);

/* ---- the copied code in a vm ---- */
var PAGE_TAGS = {}, tagRe = /<(\w+)\b[^>]*\sid="([^"]+)"/g, tg;
while ((tg = tagRe.exec(page))) PAGE_TAGS[tg[2]] = tg[1];
function makeEl(tag, id) {
  var cls = {}, attrs = {};
  var e = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', innerHTML: '', textContent: '', value: '', src: '', type: '',
    style: {}, dataset: {}, children: [], listeners: {}, disabled: false, isContentEditable: false, clientWidth: 1200, clientHeight: 800, offsetHeight: 40,
    classList: {
      add: function (c) { cls[c] = 1; }, remove: function (c) { delete cls[c]; }, contains: function (c) { return !!cls[c]; },
      toggle: function (c, force) { var on = force === undefined ? !cls[c] : !!force; if (on) cls[c] = 1; else delete cls[c]; return on; }
    },
    setAttribute: function (k, v) { attrs[k] = String(v); }, getAttribute: function (k) { return k in attrs ? attrs[k] : null; },
    appendChild: function (c) { e.children.push(c); return c; },
    addEventListener: function (t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); },
    querySelector: function () { return makeEl('div'); }, querySelectorAll: function () { return []; }, closest: function () { return null; },
    focus: function () {}, select: function () {}, remove: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 100, height: 100 }; }
  };
  return e;
}
/* At load only the page's own ids exist (a lookup of any other id at load would be null in the browser too); after
   load any id is found, as the code's own innerHTML writes them. */
function loadStudio(bare) {
  var byId = {}, winListeners = {};
  Object.keys(PAGE_TAGS).forEach(function (id) { byId[id] = makeEl(PAGE_TAGS[id], id); });
  var doc = {
    listeners: {}, body: makeEl('body'), activeElement: null, permissive: false,
    getElementById: function (id) { if (byId[id]) return byId[id]; if (!doc.permissive) return null; return (byId[id] = makeEl('div', id)); },
    set: function (id, el) { el.id = id; byId[id] = el; return el; },
    createElement: function (tag) { return makeEl(tag); },
    addEventListener: function (t, fn) { (doc.listeners[t] = doc.listeners[t] || []).push(fn); },
    removeEventListener: function () {},
    querySelectorAll: function () { return []; }
  };
  doc.activeElement = doc.body;
  var sb = { document: doc, console: console, setTimeout: function () { return 0; }, clearTimeout: function () {} };
  sb.window = sb;
  // oneworld-social.js's (bare: left out, to see whether Oneworld's own files give it)
  if (!bare) sb.S = { portal: '', portalName: '', event: 'qa-e1', award: null, kind: 'events', product: 'social', section: 'social' };
  sb.addEventListener = function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); };
  vm.createContext(sb);
  var err = null;
  try { vm.runInContext(studio, sb, { filename: 'social-studio.js' }); } catch (e) { err = e; }
  doc.permissive = true;
  return { sb: sb, doc: doc, win: winListeners, err: err, run: function (src) { return vm.runInContext(src, sb); }, el: function (id) { return doc.getElementById(id); } };
}
function jsonResp(status, body) { return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } }; }
function notJson(status) { return { ok: false, status: status, json: function () { return Promise.reject(new SyntaxError('Unexpected token')); } }; }
function key(k, o) {
  o = o || {};
  var ev = { key: k, shiftKey: !!o.shift, metaKey: false, ctrlKey: false, defaultPrevented: !!o.prevented, preventDefault: function () { ev.defaultPrevented = true; } };
  return ev;
}
function noop() {}
var CATALOG = { catalog: { categories: [{ label: 'Generic', templates: [{ id: 'generic.announcement', label: 'Announcement', kind: 'code', available: true,
  formats: [{ id: 'ig_square', ratio: '1:1' }, { id: 'landscape', ratio: '1.91:1' }], params: [] }] }] } };

(async function () {
  /* the code runs at load on the page's own markup, with none of Oneworld's files there yet */
  var L = loadStudio();
  check('the copied code runs at load on this page\'s markup alone', L.err === null, L.err && String(L.err.message));
  check('at load it listens for: the dialog\'s Escape and the editor\'s keys, menu clicks, window resize, stage clicks, group resize and rotate',
    (L.doc.listeners.keydown || []).length === 2 && (L.doc.listeners.click || []).length === 1 && (L.win.resize || []).length === 1 &&
    (L.el('edCanvas').listeners.pointerdown || []).length === 1 && (L.el('edGroupRes').listeners.pointerdown || []).length === 1 &&
    (L.el('edGroupRot').listeners.pointerdown || []).length === 1);

  /* S2, S3, S26: the stage's base picture is the one shown, and cleared on each load; the Background select is left alone */
  var A = loadStudio(), selected = [];
  A.sb.buildNodes = noop; A.sb.layoutStage = noop; A.sb.selectEl = function (i) { selected.push(i); };
  A.run('EDIT.base="https://img.etb2bimg.com/x/base.png"; mountStage();');
  check('S3: mountStage shows the base on #edBase', A.el('edBase').src === 'https://img.etb2bimg.com/x/base.png' && A.el('edBg').src === '');
  A.sb.CAT = CATALOG; A.el('edTpl').value = 'generic.announcement'; A.el('edFmt').value = 'ig_square';
  var loads = [];
  A.sb.api = function (u, o) { loads.push([u, JSON.parse(o.body)]); return Promise.resolve(notJson(500)); };
  await A.run('loadEditor(false)');
  check('S2: loading clears #edBase before asking for the layout', A.el('edBase').src === '' && loads.length === 1 && loads[0][0] === '/api/editor/load');
  check('loadEditor: a failed load says so', /Couldn't load this template\./.test(A.el('edSide').innerHTML));
  /* S4: a click on the base picture clears the selection, as on the empty stage */
  selected.length = 0;
  A.el('edCanvas').listeners.pointerdown[0]({ target: { id: 'edBase', classList: { contains: function () { return false; } } } });
  A.el('edCanvas').listeners.pointerdown[0]({ target: { id: 'n1', classList: { contains: function () { return false; } } } });
  check('S4: a click on #edBase clears the selection; a click on an element does not', selected.join() === '-1', selected);

  /* S5′: Apply & re-render asks first; on Cancel nothing changes and nothing is announced */
  var B = loadStudio(), bLoads = [], bToasts = [];
  var host = B.doc.set('edOpts', makeEl('div'));
  host.querySelectorAll = function () { return [{ dataset: { key: 'title' }, value: 'Typed title', classList: { contains: function () { return false; } } }]; };
  B.run('edParams={ theme:"light", bg:"2", kicker:"old" }; edMode="options";');
  B.sb.loadEditor = function (f) { bLoads.push(f); }; B.sb.toast = function (m, ms) { bToasts.push([m, ms]); };
  B.sb.owMayDiscard = function () { return Promise.resolve(false); };
  await B.run('applyOptions()');
  check('S5′ Cancel: no re-render, no toast, the Options tab and the options stay', bLoads.length === 0 && bToasts.length === 0 && B.run('edMode') === 'options' &&
    B.run('JSON.stringify(edParams)') === '{"theme":"light","bg":"2","kicker":"old"}', { loads: bLoads, toasts: bToasts, mode: B.run('edMode') });
  B.sb.owMayDiscard = function () { return Promise.resolve(true); };
  await B.run('applyOptions()');
  check('S5′ go ahead: re-rendered fresh, with the theme, the background (D4) and the typed options', bLoads.join() === 'true' && B.run('edMode') === 'props' &&
    B.run('JSON.stringify(edParams)') === '{"theme":"light","bg":"2","title":"Typed title"}', B.run('JSON.stringify(edParams)'));
  check('S5′ go ahead: the platform\'s toast', bToasts.length === 1 && bToasts[0][0] === '✓ Options applied — re-rendered from the template', bToasts);
  /* S6: the all-sizes ZIP is drawn on the chosen background */
  var zipBodies = [];
  B.sb.CAT = CATALOG; B.run('EDIT.tid="generic.announcement"; edParams={ theme:"dark", bg:"1" };');
  B.sb.api = function (u, o) { zipBodies.push([u, JSON.parse(o.body)]); return Promise.resolve(notJson(500)); };
  await B.run('edDownloadZip()');
  var zp = zipBodies.length ? zipBodies[0][1].params['generic.announcement'] : null;
  check('S6: the ZIP asks with the theme, the background and the options', zipBodies.length === 1 && zipBodies[0][0] === '/api/download' && zp &&
    zp.theme === 'dark' && zp.bg === '1' && zp.title === 'Typed title' && zipBodies[0][1].formats.join() === 'ig_square,landscape', zipBodies);

  /* S7′: Escape leaves only when not typing, and never right after the dialog's own Escape */
  var K = loadStudio(), left = 0;
  K.el('editor').classList.add('on');
  K.sb.owLeaveEditor = function () { left++; };
  var dialogKey = K.doc.listeners.keydown[0], editorKey = K.doc.listeners.keydown[1];
  function inputOf(type) { var i = makeEl('input'); i.type = type; return i; }
  K.doc.activeElement = inputOf('text'); editorKey(key('Escape'));
  K.doc.activeElement = makeEl('textarea'); editorKey(key('Escape'));
  K.doc.activeElement = inputOf('number'); editorKey(key('Escape'));
  check('S7′: Escape in a field does nothing', left === 0);
  K.doc.activeElement = K.doc.body;
  editorKey(key('Escape', { prevented: true }));
  check('S7′: Escape already handled elsewhere does nothing', left === 0);
  editorKey(key('Escape'));
  check('S7′: Escape on the canvas asks to leave (owLeaveEditor)', left === 1);
  var answered = 'none';
  K.run('uiConfirm("Leave without saving?","This layout has changes that are not saved.",{ok:"Leave without saving",cancel:"Keep editing",danger:true})')
    .then(function (v) { answered = v; });
  check('the dialog is open', K.el('uiModal').classList.contains('on') && K.el('uiModalTitle').textContent === 'Leave without saving?');
  var esc = key('Escape'); dialogKey(esc); editorKey(esc);
  await Promise.resolve();
  check('S7′: Escape in the dialog closes the dialog only, and does not ask again (fidelity 9)', answered === false && left === 1 &&
    !K.el('uiModal').classList.contains('on'), { answered: answered, left: left });
  /* Focus stays on a select after a pick (the template, size or background, a font, a weight), and on a checkbox or the
     colour picker after a click: none of that is typing, so Escape still leaves from there, as it did on the platform */
  left = 0;
  K.doc.activeElement = K.el('edTpl'); editorKey(key('Escape'));
  K.doc.activeElement = inputOf('color'); editorKey(key('Escape'));
  K.doc.activeElement = inputOf('checkbox'); editorKey(key('Escape'));
  check('S7′: Escape on a select, the colour picker or a checkbox asks to leave', K.el('edTpl').tagName === 'SELECT' && left === 3, left);
  K.doc.activeElement = K.el('edBg'); editorKey(key('Escape', { prevented: true }));
  check('S7′: … but not when the dialog\'s own Escape has just handled it', left === 3, left);
  K.doc.activeElement = K.doc.body;
  /* S9, S10: nudges take an undo snapshot and move the group's frame */
  var snaps = 0, frames = 0;
  K.sb.owNudgeSnap = function () { snaps++; }; K.sb.layoutGroupFrame = function () { frames++; };
  K.run('EDIT.els=[{ type:"text", x:10, y:20, w:50 }]; edSelSet=[0]; edSel=0; edNodes[0]={ style:{} };');
  var arrow = key('ArrowRight'); editorKey(arrow);
  check('S9: an arrow key takes an undo snapshot first', snaps === 1 && arrow.defaultPrevented);
  check('S10: and the group\'s frame follows', frames === 1 && K.run('EDIT.els[0].x') === 11);
  editorKey(key('ArrowUp', { shift: true }));
  check('S9: Shift moves 10', K.run('EDIT.els[0].y') === 10 && snaps === 2 && frames === 2);
  K.doc.activeElement = K.el('edFmt'); editorKey(key('ArrowRight'));
  check('S7′ narrows Escape only: an arrow key on a select still changes the select, not the layout', K.run('EDIT.els[0].x') === 11 && snaps === 2);
  K.doc.activeElement = K.doc.body;
  /* S11: Align moves the group's frame too */
  K.sb.applyNode = noop; frames = 0;
  K.run('edAlign("l")');
  check('S11: Align to canvas moves the group\'s frame', frames === 1 && K.run('EDIT.els[0].x') === 0);

  /* S12: resizing a group scales a photo frame's height with its width */
  var G = loadStudio();
  G.sb.applyNode = noop; G.sb.layoutGroupFrame = noop; G.sb.paintSide = noop;
  G.run('EDIT.scale=1; EDIT.els=[{ type:"frame", x:0, y:0, w:100, h:100 }, { type:"image", x:100, y:0, w:100, h:50 }]; edSelSet=[0,1]; edSel=1; ' +
    'edNodes[0]={ style:{}, offsetHeight:100 }; edNodes[1]={ style:{}, offsetHeight:50 };');
  G.run('startGroupResize')({ preventDefault: noop, stopPropagation: noop, clientX: 0 });
  var moves = G.doc.listeners.pointermove || [];
  if (moves.length) moves[moves.length - 1]({ clientX: 200 });
  check('S12: a frame in a resized group keeps its shape', G.run('EDIT.els[0].w') === 200 && G.run('EDIT.els[0].h') === 200 && G.run('EDIT.els[1].h') === 100,
    G.run('JSON.stringify(EDIT.els)'));

  /* S13, S14: Reset asks first, and says when it failed */
  var R = loadStudio(), rReqs = [], rLoads = [], rToasts = [], rAnswer = null;
  R.run('EDIT.tid="generic.announcement"; EDIT.fmt="ig_square"; edParams={ theme:"dark" }; edHist=["x"];');
  R.sb.api = function (u) { rReqs.push(u); return Promise.resolve(rAnswer); };
  R.sb.loadEditor = function (f) { rLoads.push(f); }; R.sb.toast = function (m) { rToasts.push(m); };
  R.sb.owConfirmReset = function () { return Promise.resolve(false); };
  await R.run('edReset()');
  check('S13: Reset cancelled: nothing is asked or deleted', rReqs.length === 0 && rLoads.length === 0 && rToasts.length === 0);
  /* oneworld-social.js's owConfirmReset (§6c): a yes lets the one loadEditor that follows skip the "Discard your
     changes?" question. A request that leaves the flag set (here the api answers 500 and does not clear it) is the case
     S14 must close itself, or the next switch would redraw over unsaved edits without asking. */
  R.sb.OWS = { skipGuard: false };
  var rFlagAtLoad = [];
  R.sb.loadEditor = function (f) { rLoads.push(f); rFlagAtLoad.push(R.sb.OWS.skipGuard); };
  R.sb.owConfirmReset = function () { R.sb.OWS.skipGuard = true; return Promise.resolve(true); };
  rAnswer = jsonResp(500, { error: 'x' });
  await R.run('edReset()');
  check('S14: a failed reset says so and keeps the layout and its history', rReqs.join() === '/api/editor/reset' && rLoads.length === 0 &&
    rToasts.join() === 'Reset failed' && R.run('edHist.length') === 1, { reqs: rReqs, loads: rLoads, toasts: rToasts });
  check('S14: a failed reset gives back the guard\'s one-time pass, so the next switch still asks about unsaved edits', R.sb.OWS.skipGuard === false);
  rAnswer = jsonResp(200, { ok: true }); rToasts.length = 0;
  await R.run('edReset()');
  check('S14: a reset that went through redraws from the template, as the platform', rLoads.join() === 'true' && rToasts.join() === 'Reset to the original template' &&
    R.run('edHist.length') === 0);
  check('S14: … and that redraw still has the pass the confirmed Reset gave it', rFlagAtLoad.join() === 'true', rFlagAtLoad);
  /* without Oneworld's file (OWS not defined) a failed reset still only says so */
  var R2 = loadStudio(), r2Toasts = [];
  R2.run('EDIT.tid="generic.announcement"; EDIT.fmt="ig_square"; edParams={ theme:"dark" };');
  R2.sb.api = function () { return Promise.resolve(jsonResp(500, {})); };
  R2.sb.toast = function (m) { r2Toasts.push(m); }; R2.sb.owConfirmReset = function () { return Promise.resolve(true); };
  var r2Err = null; try { await R2.run('edReset()'); } catch (e) { r2Err = e; }
  check('S14: a failed reset with no OWS does not throw', r2Err === null && r2Toasts.join() === 'Reset failed', r2Err && String(r2Err.message));

  /* S15: a failed speakers and sponsors fetch is not kept */
  var aReqs = 0, aAnswer = notJson(500);
  R.sb.api = function () { aReqs++; return Promise.resolve(aAnswer); };
  var a1 = await R.run('loadAssets()');
  check('S15: a failed fetch gives empty lists', a1 && a1.speakers.length === 0 && a1.sponsors.length === 0);
  aAnswer = jsonResp(200, { speakers: [{ name: 'Anita Rao', photoUrl: 'https://img.etb2bimg.com/p.jpg' }], sponsors: [] });
  var a2 = await R.run('loadAssets()');
  var a3 = await R.run('loadAssets()');
  check('S15: the next open asks again, and a good answer is then kept', aReqs === 2 && a2.speakers.length === 1 && a3 === a2, aReqs);

  /* S16: a line break typed into one-line text breaks the line */
  var W = loadStudio();
  W.sb.applyNode = noop; W.sb.updLayerLabel = noop; W.sb.__node = makeEl('div');
  W.run('EDIT.els=[{ type:"text", x:0, y:0, w:100, text:"One", whiteSpace:"nowrap" }, { type:"text", x:0, y:0, w:100, text:"One", whiteSpace:"nowrap" }]; ' +
    'edSelSet=[0]; edSel=0; edNodes[0]=__node; edNodes[1]=__node;');
  W.run('wirePanel(EDIT.els[0])');
  var tx = W.el('epText'); tx.value = 'One\nTwo'; tx.oninput();
  check('S16: a typed line break turns one-line text into wrapping text', W.run('EDIT.els[0].whiteSpace') === 'pre-wrap' && W.run('EDIT.els[0].text') === 'One\nTwo');
  W.run('edSel=1; wirePanel(EDIT.els[1])');
  tx = W.el('epText'); tx.value = 'One more'; tx.oninput();
  check('S16: without a line break it stays one line', W.run('EDIT.els[1].whiteSpace') === 'nowrap');

  /* S17, S18: the Caption tab */
  var P = loadStudio(), cap = 0, opt = 0, props = 0;
  P.sb.owRenderCaption = function () { cap++; }; P.sb.renderOptions = function () { opt++; }; P.sb.renderProps = function () { props++; }; P.sb.renderInsert = noop;
  P.run('edTab("caption")');
  var side = P.el('edSide').innerHTML;
  var tabs = (side.match(/<button[^>]*>[^<]*<\/button>/g) || []).map(function (b) { return b.replace(/<[^>]+>/g, ''); });
  check('S17: four tabs: Style, Insert, Options, Caption', tabs.join() === 'Style,Insert,Options,Caption', tabs);
  check('S17: the Caption tab is on while it is open', /<button class="on" onclick="edTab\('caption'\)">Caption<\/button><\/div><div id="edSideBody"><\/div>/.test(side));
  check('S18: the Caption tab shows the caption panel', cap === 1 && opt === 0 && props === 0);
  P.run('edTab("options")');
  check('S18: the other tabs are as they were', cap === 1 && opt === 1 && /<button class="" onclick="edTab\('caption'\)">Caption/.test(P.el('edSide').innerHTML));

  /* S19-S21: the template options escape the event's names; the values still come back as they were */
  var optsHost = makeEl('div');
  P.run('buildParams')({ params: [
    { key: 'speakers', label: 'Speakers <b>', type: 'multiselect', options: [{ value: 'O\'Brien "QA" <b>', label: 'O\'Brien "QA" <b> — राहुल शर्मा' }] },
    { key: 'tier', label: 'Tier', type: 'select', options: [{ value: 'a"b', label: '<i>Gold</i> (2)' }] }] }, optsHost);
  var w0 = optsHost.children[0], w1 = optsHost.children[1];
  check('S19: the label is escaped', w0 && w0.innerHTML === '<label class="h">Speakers &lt;b&gt;</label>', w0 && w0.innerHTML);
  var msLabel = w0 && w0.children[1] && w0.children[1].children[0];
  check('S20: a multiselect choice is escaped, Devanagari intact', msLabel &&
    msLabel.innerHTML === '<input type="checkbox" value="O&#39;Brien &quot;QA&quot; &lt;b&gt;"> O&#39;Brien &quot;QA&quot; &lt;b&gt; — राहुल शर्मा', msLabel && msLabel.innerHTML);
  var sel = w1 && w1.children[0];
  check('S21: a select choice is escaped', sel && sel.innerHTML === '<option value="">Auto</option><option value="a&quot;b">&lt;i&gt;Gold&lt;/i&gt; (2)</option>', sel && sel.innerHTML);

  /* S22, S23: the Insert list escapes picture addresses */
  var spk = P.run('spkCk')({ photoUrl: 'https://img.etb2bimg.com/a.jpg" onload="alert(1)', name: '<b>N</b>', designation: 'CTO', company: 'Acme' }, 0);
  check('S22: a speaker\'s photo address cannot add an attribute', spk.indexOf('onload="alert') === -1 && spk.indexOf('src="https://img.etb2bimg.com/a.jpg&quot; onload=&quot;alert(1)"') !== -1, spk);
  var spo = P.run('spoCk')({ logoUrl: 'https://img.etb2bimg.com/l.png"><script>x()</script>', title: 'Acme', tier: 'Gold' }, 0);
  check('S23: a partner\'s logo address cannot close the tag', spo.indexOf('"><script>') === -1 && spo.indexOf('&quot;&gt;&lt;script&gt;') !== -1, spo);

  /* S24, S25, S27: uploads clear the picker, the PSD pill tells the truth, the server's reason is escaped */
  var U = loadStudio(), uReqs = [], uAnswer = null, refreshed = 0;
  U.sb.api = function (u) { uReqs.push(u); return Promise.resolve(uAnswer); };
  U.sb.refreshThumbs = function () { refreshed++; };
  function picker(name) { var slot = makeEl('label'); return { files: name ? [{ name: name }] : [], value: name ? 'C:\\fakepath\\' + name : '', slot: slot, closest: function () { return slot; } }; }
  var i1 = picker('event.psd'); i1.slot.classList.add('on');
  uAnswer = jsonResp(200, { ok: true, canvasWidth: 1080, canvasHeight: 1350, background: null, logoUnit: { width: 400, height: 120 } });
  await U.run('uploadPsd')(i1);
  check('S24: the PSD picker is cleared', i1.value === '');
  check('S25: a PSD with no background turns the PSD pill off; the logo pill on', !i1.slot.classList.contains('on') && U.el('slot-logo').classList.contains('on') && refreshed === 1);
  check('the PSD status line is the platform\'s', U.el('psdStatus').innerHTML === 'PSD background — · logo ✅ (1080×1350) — refreshing…', U.el('psdStatus').innerHTML);
  var i2 = picker('event.psd');
  uAnswer = jsonResp(200, { ok: true, canvasWidth: 1080, canvasHeight: 1080, background: { width: 1080, height: 1080 }, logoUnit: null });
  await U.run('uploadPsd')(i2);
  check('S25: a PSD with a background turns the PSD pill on', i2.slot.classList.contains('on'));
  var EVIL = '<img src=x onerror=alert(1)>';
  uAnswer = jsonResp(400, { error: EVIL });
  var i3 = picker('event.psd'), i4 = picker('bg.jpg'), i5 = picker('logo.png');
  await U.run('uploadPsd')(i3);
  var s1 = U.el('psdStatus').innerHTML;
  await U.run('uploadBg')(i4, '2');
  var s2 = U.el('psdStatus').innerHTML;
  await U.run('uploadLogo')(i5);
  var s3 = U.el('psdStatus').innerHTML;
  var SAFE = 'Upload failed: &lt;img src=x onerror=alert(1)&gt;';
  check('S27: the server\'s reason is escaped on all three uploads', s1 === SAFE && s2 === SAFE && s3 === SAFE, [s1, s2, s3]);
  check('S24: every picker is cleared, even after a failure', i3.value === '' && i4.value === '' && i5.value === '');
  uAnswer = notJson(413);
  await U.run('uploadPsd')(picker('huge.psd'));
  check('a PSD over the limit keeps the platform\'s sentence', U.el('psdStatus').innerHTML === 'Upload failed: file too large (max 120 MB) — flatten the PSD', U.el('psdStatus').innerHTML);
  var before = uReqs.length, i6 = picker('');
  await U.run('uploadBg')(i6, '1');
  check('no file picked: nothing is sent', uReqs.length === before);
  uAnswer = jsonResp(200, { ok: true, width: 3840, height: 2160 });
  await U.run('uploadBg')(picker('bg.jpg'), '3');
  check('a background upload reads as the platform\'s', U.el('psdStatus').innerHTML === 'Background 3 uploaded (3840×2160) — pick it in the editor\'s Background selector.' &&
    U.el('slot-bg3').classList.contains('on'), U.el('psdStatus').innerHTML);
  check('the uploads go where the platform sent them (Oneworld\'s api() maps them)', uReqs[0].indexOf('/api/psd?') === 0 &&
    uReqs.some(function (u) { return u.indexOf('/api/background?') === 0 && /slot=2/.test(u); }) && uReqs.some(function (u) { return u.indexOf('/api/logo?') === 0; }), uReqs);

  /* S28: a failed save says why */
  var V = loadStudio(), vToasts = [], vAnswer = null;
  V.run('EDIT.width=1080; EDIT.height=1080; EDIT.tid="generic.announcement"; EDIT.fmt="ig_square"; EDIT.base="blob:x"; EDIT.els=[]; edParams={ theme:"dark" };');
  V.sb.toast = function (m, ms) { vToasts.push([m, ms]); };
  V.sb.api = function () { return Promise.resolve(vAnswer); };
  var lastToast = function () { return vToasts[vToasts.length - 1]; };
  vAnswer = jsonResp(409, { error: 'This layout was changed by someone else meanwhile. Reload it, then make your edits again.' });
  await V.run('edSave()');
  check('S28: the server\'s reason, for 6 s', lastToast()[0] === 'Save failed: This layout was changed by someone else meanwhile. Reload it, then make your edits again.' &&
    lastToast()[1] === 6000, lastToast());
  vAnswer = notJson(500);
  await V.run('edSave()');
  check('S28: no reason given: the platform\'s "Save failed"', lastToast()[0] === 'Save failed' && lastToast()[1] === 6000, lastToast());
  vAnswer = jsonResp(200, { ok: true });
  await V.run('edSave()');
  check('S28: a save that went through, as the platform', lastToast()[0] === '✓ Saved — your edits will reload next time' && lastToast()[1] === undefined, lastToast());
  check('edSave starts with the platform\'s "Saving…"', vToasts[0][0] === 'Saving…');

  /* ---- E.5 and the copy itself, when the platform's index.html is on this machine ---- */
  var SRC_INDEX = path.join(os.homedir(), 'Downloads', 'Social Post Generator', 'app', 'public', 'index.html');
  var hasPython = cp.spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
  if (fs.existsSync(SRC_INDEX) && hasPython) {
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-social-x-'));
    try {
      // a copy of the extractor in a scratch root: whatever it writes lands there, never in the repository
      var scratchRoot = function (name) {
        var r = path.join(tmp, name);
        fs.mkdirSync(path.join(r, 'tools'), { recursive: true });
        fs.copyFileSync(path.join(ROOT, 'tools', 'extract-promo-social.py'), path.join(r, 'tools', 'extract-promo-social.py'));
        return r;
      };
      var runIn = function (r, src) { return cp.spawnSync('python3', ['-I', '-X', 'utf8', path.join(r, 'tools', 'extract-promo-social.py'), src], { encoding: 'utf8' }); };
      var good = scratchRoot('good'), ran = runIn(good, SRC_INDEX);
      check('the extractor runs on the platform\'s file', ran.status === 0, ran.stderr);
      check('it makes exactly this page', ran.status === 0 && fs.readFileSync(path.join(good, 'promo-social-studio.html'), 'utf8') === page);
      check('it makes exactly this code', ran.status === 0 && fs.readFileSync(path.join(good, 'promo-studio', 'social-studio.js'), 'utf8') === studio);
      var srcText = fs.readFileSync(SRC_INDEX, 'utf8'), S7 = 'if(e.key==="Escape"){ closeEditor(); return; }';
      check('S7′\'s anchor is in the platform\'s file once', count(srcText, S7) === 1);
      fs.writeFileSync(path.join(tmp, 'index-s7.html'), srcText.replace(S7, S7.replace('closeEditor', 'closeEditer')));
      var bad = scratchRoot('bad'), stopped = runIn(bad, path.join(tmp, 'index-s7.html'));
      check('E.5: one character of S7′\'s anchor changed: the extractor stops and names S7′', stopped.status !== 0 && /patch S7′ /.test(stopped.stderr), stopped.stderr);
      check('E.5: and writes nothing', !fs.existsSync(path.join(bad, 'promo-social-studio.html')) && !fs.existsSync(path.join(bad, 'promo-studio')));
      var srcLines = srcText.split('\n'); srcLines.splice(1000, 1);
      fs.writeFileSync(path.join(tmp, 'index-moved.html'), srcLines.join('\n'));
      var moved = scratchRoot('moved'), stopped2 = runIn(moved, path.join(tmp, 'index-moved.html'));
      check('a range that moved: the extractor stops, naming the line', stopped2.status !== 0 && /line 1010 no longer starts with/.test(stopped2.stderr) &&
        !fs.existsSync(path.join(moved, 'promo-social-studio.html')), stopped2.stderr);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  } else {
    notes.push('the extractor was not run against the platform (' + (hasPython ? 'its index.html is not on this machine' : 'no python3') + ')');
  }

  /* ---- with Oneworld's files beside it (they are built separately): they load after this code without declaring any of
     its names again, and give it the names it calls. Each file is stopped at its first statement: a name declared twice
     is refused before any statement runs (as the browser does), and its declarations are made, but none of its code
     runs on this bare stand-in page (its own test runs it). ---- */
  var OW = { 'promo-studio/oneworld-social.js': ['api', 'S', 'CAT', 'MAILERS', 'previewCache', 'thumbCache', 'mark', 'crumbs', 'setProdNav', 'openPortal',
    'mailerCards', 'renderEvSaved', 'owLeaveEditor', 'owNudgeSnap', 'owConfirmReset', 'owMayDiscard'],
    'promo-studio/oneworld-social-art.js': [], 'promo-studio/oneworld-social-caption.js': ['owRenderCaption'] };
  var X = loadStudio(true), STOP = '__stop_before_the_first_statement__';
  Object.keys(OW).forEach(function (f) {
    if (!exists(f)) { notes.push(f + ' is not there yet: its fit with this code was not checked'); return; }
    var src = read(f), err = null;
    try { vm.runInContext('throw "' + STOP + '";\n' + src, X.sb, { filename: f }); } catch (e) { err = e; }
    check(f + ' parses and loads after social-studio.js without declaring any of its names again', err === STOP, err === STOP ? '' : String(err && err.message || err));
    OW[f].forEach(function (g) {
      check(f + ' gives the copied code ' + g, X.run('"' + g + '" in globalThis') === true || new RegExp('window\\.' + g + '\\s*=').test(src));
    });
  });

  notes.forEach(function (m) { console.log('note: ' + m); });
  if (failed) { console.error('promo-social-studio: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-social-studio: all ' + passed + ' checks passed');
})().catch(function (err) { console.error('promo-social-studio: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
