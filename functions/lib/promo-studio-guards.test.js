// node functions/lib/promo-studio-guards.test.js — the mailer studio's guards from the UX sweep's batch B09, run as
// the page runs them: the platform's own code as tools/extract-promo-studio.py patches it (PATCHES P13 to P25:
// its in-app dialog, ← and Escape, the mailer menu, Rebuild, Save as new, Download all) together with Oneworld's side
// in promo-studio/oneworld.js (owMayLeave, owMaySend, owSiteLive, owFieldValue, the wrapped Download to send and
// Copy HTML, the mailer page's "Not published yet"). No network, no browser: each piece is taken out of the real
// files by its first and last line and run in a vm over a small fake of the elements it touches.
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function settle(ms) { return new Promise(function (ok) { setTimeout(ok, ms || 5); }); }

var studio = read('promo-studio/mailer-studio.js');
var owSrc = read('promo-studio/oneworld.js');
var py = read('tools/extract-promo-studio.py');

/* a piece of the studio's code: from the line that starts with `first` to the first line after it that is `last` */
function piece(src, first, last) {
  var a = src.indexOf(first);
  if (a === -1) return null;
  var b = src.indexOf(last, a + first.length);
  return b === -1 ? null : src.slice(a, b + last.length);
}
function line(src, first) { var a = src.indexOf(first); return a === -1 ? null : src.slice(a, src.indexOf('\n', a)); }
function owFn(name) { var m = new RegExp('\\nfunction ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n').exec(owSrc); return m ? m[0] : null; }

var PARTS = {
  escapeHtml: line(studio, 'const escapeHtml='),
  dialogs: piece(studio, 'let _uiResolve=null;', '\nconst uiPrompt=') && (piece(studio, 'let _uiResolve=null;', '\nconst uiPrompt=') + line(studio, 'const uiPrompt=').slice('const uiPrompt='.length)),
  closeMailer: piece(studio, 'async function closeMailer(){', '\n}'),
  switchMailer: line(studio, 'async function switchMailer(){'),
  rebuild: piece(studio, 'async function mlRebuild(){', '\n}'),
  saveAs: piece(studio, 'async function mlSaveAs(){', '\n}'),
  downloadAll: piece(studio, 'async function downloadAllMailers(){', '\n}'),
  keys: piece(studio, 'document.addEventListener("keydown",(e)=>{\n  if(!$("mailer").classList.contains("on")) return;', '\n});'),
  iconMouse: piece(studio, 'document.addEventListener("mousedown",(e)=>{\n  if(!ICP.el||!e.target||!e.target.closest) return;', '\n});'),
  editMouse: piece(studio, 'document.addEventListener("mousedown",(e)=>{\n  if(!IE.el)return;', '\n},true);')
};
var OW_PARTS = ['owMayLeave', 'owMaySend', 'owSiteLive', 'owPublishLink', 'owFieldValue', 'owSlugOf', 'owZipName'].map(function (n) { return [n, owFn(n)]; });
Object.keys(PARTS).forEach(function (k) { check('the studio code has its ' + k + ' piece, as patched', !!PARTS[k], k); });
OW_PARTS.forEach(function (p) { check('oneworld.js has ' + p[0], !!p[1], p[0]); });
var OW_WORDS = [line(owSrc, 'var OW_UNPUBLISHED = '), line(owSrc, 'var OW_PUBLISH_FIRST = ')];
check('oneworld.js has the unpublished words', OW_WORDS.every(Boolean));

/* ---------- the patches themselves ---------- */
var studioCode = studio.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1').replace(/uiConfirm\(|uiPrompt\(/g, '');
check('no browser dialog is left in the studio code (prompt, confirm, alert)', !/(^|[^\w.])(prompt|confirm|alert)\(/m.test(studioCode),
  studioCode.match(/(^|[^\w.])(prompt|confirm|alert)\([^)]{0,40}/gm) || []);
check('the extractor\'s patch list names the B09 patches\' reasons', /picking another mailer in the studio\\'s menu asks first/.test(py) && /Escape that closed a dialog closes only the dialog/.test(py));

/* ---------- a page: fake elements, the platform's pieces and Oneworld's, run together ---------- */
function el(id) {
  var cls = {};
  var e = { id: id, textContent: '', innerHTML: '', value: '', className: '', style: {}, attrs: {}, onclick: null, onmousedown: null, onkeydown: null,
    focused: false, focus: function () { e.focused = true; }, select: function () {},
    setAttribute: function (k, v) { e.attrs[k] = String(v); }, getAttribute: function (k) { return k in e.attrs ? e.attrs[k] : null },
    classList: { add: function (c) { cls[c] = true; }, remove: function (c) { delete cls[c]; }, contains: function (c) { return !!cls[c]; },
      toggle: function (c, on) { if (on === undefined) on = !cls[c]; if (on) cls[c] = true; else delete cls[c]; return on; } },
    closest: function () { return null; } };
  return e;
}
function page(o) {
  o = o || {};
  var els = {}, docL = {}, calls = { load: [], api: [], put: [], close: 0, sel: [], toast: [], undo: 0 };
  ['uiModal', 'uiModalTitle', 'uiModalBody', 'uiModalInput', 'uiModalOk', 'uiModalCancel', 'mailer', 'mlPick', 'mlPop'].forEach(function (id) { els[id] = el(id); });
  els.mailer.classList.add('on');
  var sb = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, JSON: JSON, Object: Object, String: String,
    $: function (id) { return els[id] || null; },
    document: {
      body: { style: {} },
      addEventListener: function (t, fn, cap) { (docL[t] = docL[t] || []).push(fn); }
    },
    MD: Object.assign({ id: 'mailer.a', doc: { subject: 'Hello', blocks: [] }, dirty: false, sel: null, ai: null, saveId: null, saveName: '' }, o.MD || {}),
    MAILERS: o.MAILERS || { event: { published: true }, mailers: [] },
    S: { portal: 'p', event: 'x' }, EVENT_ID: 'x',
    IE: { el: null }, ICP: { el: null },
    mark: function () {}, mlPopClose: function () {}, iconPopClose: function () { calls.iconClosed = (calls.iconClosed || 0) + 1; },
    mlLoad: function (fresh, saveId) { calls.load.push([fresh, saveId]); return Promise.resolve(); },
    closeMenus: function () {}, toast: function (m) { calls.toast.push(m); },
    typingTarget: function () { return !!o.typing; },
    mlSelect: function (v) { calls.sel.push(v); }, mlUndo: function () { calls.undo++; }, mlRedo: function () {}, mlSave: function () {}, mlDel: function () {},
    mlEditEnd: function () { calls.editEnded = (calls.editEnded || 0) + 1; },
    mlDefaultName: function () { return 'Hello'; }, mlUniqueName: function (n) { return n; },
    mlPutSave: function (id, name) { calls.put.push([id, name]); sb.MD.saveName = name; return Promise.resolve(true); },
    api: function (u, opt) { calls.api.push(u); return Promise.resolve({ ok: true, headers: { get: function () { return 'yes'; } }, blob: function () { return Promise.resolve('b'); } }); },
    URL: { createObjectURL: function () { return 'blob:x'; } },
    owTrackToast: function (k) { calls.toast.push('track:' + k); },
    prompt: function () { throw new Error('the browser\'s prompt was used'); },
    confirm: function () { throw new Error('the browser\'s confirm was used'); },
    event: undefined
  };
  sb.document.createElement = function (t) { var e = el(''); e.tagName = String(t).toUpperCase(); e.click = function () { calls.clicked = e; }; return e; };
  vm.createContext(sb);
  vm.runInContext([PARTS.escapeHtml, PARTS.dialogs, PARTS.closeMailer, PARTS.switchMailer, PARTS.rebuild, PARTS.saveAs, PARTS.downloadAll, PARTS.keys,
    PARTS.iconMouse, PARTS.editMouse].concat(OW_WORDS).concat(OW_PARTS.map(function (p) { return p[1]; })).join('\n') +
    '\nthis.__ui = { uiConfirm: uiConfirm, uiPrompt: uiPrompt };', sb, { filename: 'studio pieces' });
  /* closeMailer here is the platform's (oneworld.js wraps it on the page; that wrapper is checked below) */
  return {
    sb: sb, els: els, calls: calls,
    modal: function () { return els.uiModal.classList.contains('on') ? els.uiModalTitle.textContent : null; },
    answer: function (yes) { (yes ? els.uiModalOk : els.uiModalCancel).onclick(); },
    /* a key pressed with the focus on the dialog's button: every keydown listener on the document, in the order they
       were added (the dialog's own first, as on the page) */
    key: function (k) {
      var ev = { key: k, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, preventDefault: function () { ev.defaultPrevented = true; } };
      (docL.keydown || []).forEach(function (fn) { fn(ev); });
      return ev;
    },
    mouse: function (target) {
      var ev = { target: target };
      (docL.mousedown || []).forEach(function (fn) { fn(ev); });
    },
    open: function () { return els.mailer.classList.contains('on'); }
  };
}

(async function () {
  /* ---- UX-125: ← and Escape ask in the studio's own dialog, in the words the other studios use ---- */
  var P = page({ MD: { dirty: true } });
  var closing = P.sb.closeMailer();
  await settle();
  check('UX-125: ← with unsaved edits asks "Leave without saving?" in the studio\'s dialog', P.modal() === 'Leave without saving?' &&
    P.els.uiModalBody.innerHTML === 'This mailer has changes that are not saved.' && P.els.uiModalOk.textContent === 'Leave without saving' &&
    P.els.uiModalCancel.textContent === 'Keep editing' && /danger/.test(P.els.uiModalOk.className), [P.modal(), P.els.uiModalBody.innerHTML]);
  P.answer(false); await closing;
  check('UX-125: Keep editing keeps the studio and the edits', P.open() && P.sb.MD.dirty === true);
  closing = P.sb.closeMailer(); await settle();
  P.answer(true); await closing;
  check('UX-125: Leave without saving closes the studio', !P.open() && P.sb.MD.dirty === false);
  var P0 = page();
  await P0.sb.closeMailer();
  check('UX-125: with nothing unsaved, ← closes at once', !P0.open() && P0.modal() === null);

  /* ---- UX-126: Escape closes only the dialog on top ---- */
  var E = page();
  var rebuilding = E.sb.mlRebuild(); await settle();
  check('UX-126: Rebuild\'s dialog is open', E.modal() === 'Rebuild from event data?');
  var ev = E.key('Escape'); await rebuilding;
  check('UX-126: Escape closes the dialog (as Cancel) and not the studio', E.modal() === null && E.open() && ev.defaultPrevented && E.calls.load.length === 0);
  E.key('Escape'); await settle();
  check('UX-126: Escape with no dialog still closes a clean studio, as before', !E.open());
  var Es = page({ MD: { sel: 'b1' } });
  Es.key('Escape');
  check('UX-126: … and still lets go of a selected block first', Es.open() && Es.calls.sel.length === 1 && Es.calls.sel[0] === null);
  var Ed = page({ MD: { dirty: true } });
  Ed.key('Escape'); await settle();
  check('UX-126: Escape on a studio with unsaved edits asks (in the studio\'s dialog)', Ed.modal() === 'Leave without saving?' && Ed.open());
  Ed.key('Escape'); await settle();
  check('UX-126: … and Escape again closes that dialog only', Ed.modal() === null && Ed.open());

  /* ---- UX-119: another mailer picked in the menu asks first; Keep editing puts the menu back ---- */
  var M = page({ MD: { dirty: true } });
  M.els.mlPick.value = 'mailer.b';
  var switching = M.sb.switchMailer(); await settle();
  check('UX-119: picking another mailer with unsaved edits asks first', M.modal() === 'Leave without saving?' &&
    M.els.uiModalBody.innerHTML === 'This mailer has changes that are not saved. Opening another mailer drops them.' && M.calls.load.length === 0);
  M.answer(false); await switching;
  check('UX-119: Keep editing: the menu is back on the open mailer, nothing loaded', M.els.mlPick.value === 'mailer.a' && M.sb.MD.id === 'mailer.a' && M.calls.load.length === 0);
  M.els.mlPick.value = 'mailer.b';
  switching = M.sb.switchMailer(); await settle();
  M.answer(true); await switching;
  check('UX-119: Leave without saving opens the other mailer (its latest version)', M.sb.MD.id === 'mailer.b' && JSON.stringify(M.calls.load) === '[[false,null]]');
  var Mc = page();
  Mc.els.mlPick.value = 'mailer.c';
  await Mc.sb.switchMailer();
  check('UX-119: with nothing unsaved the menu switches at once', Mc.modal() === null && Mc.sb.MD.id === 'mailer.c' && Mc.calls.load.length === 1);

  /* ---- UX-119: Rebuild says that changes not saved are lost, and only then ---- */
  var R1 = page({ MD: { dirty: true } });
  var rb = R1.sb.mlRebuild(); await settle();
  check('UX-119: Rebuild with unsaved edits says they are lost (a red button)', R1.els.uiModalBody.innerHTML === 'This starts a fresh draft from the event\'s current data. Changes you haven\'t saved are lost; your saved versions are kept.' &&
    /danger/.test(R1.els.uiModalOk.className), R1.els.uiModalBody.innerHTML);
  R1.answer(true); await rb;
  check('UX-119: … and rebuilds when told to', JSON.stringify(R1.calls.load) === '[[true,null]]');
  var R2 = page();
  rb = R2.sb.mlRebuild(); await settle();
  check('UX-119: Rebuild with nothing unsaved says only that saved versions are kept', R2.els.uiModalBody.innerHTML === 'This starts a fresh draft from the event\'s current data. Your saved versions are kept.' &&
    !/danger/.test(R2.els.uiModalOk.className));
  R2.answer(false); await rb;

  /* ---- UX-125: Save as new names the version in the studio's dialog ---- */
  var S = page();
  var saving = S.sb.mlSaveAs(); await settle();
  check('UX-125: "Name this version" is the studio\'s dialog, the subject typed in', S.modal() === 'Name this version' && S.els.uiModalInput.value === 'Hello' &&
    S.els.uiModalInput.style.display === '' && S.els.uiModalOk.textContent === 'Save');
  S.els.uiModalInput.value = 'Launch v2'; S.answer(true); await saving;
  check('UX-125: … and saves under the name typed', JSON.stringify(S.calls.put) === JSON.stringify([[null, 'Launch v2']]));
  saving = S.sb.mlSaveAs(); await settle();
  S.answer(false); await saving;
  check('UX-125: Cancel saves nothing', S.calls.put.length === 1);

  /* ---- the dialog does not end what is under it: a click in it leaves the canvas edit and the icon picker open ---- */
  var C = page();
  C.sb.IE.el = {}; C.sb.ICP.el = {};
  var inDialog = { closest: function (sel) { return sel === '#uiModal' ? {} : null; } };
  C.mouse(inDialog);
  check('a click in the dialog ends neither the edit on the canvas nor the icon picker', !C.calls.editEnded && !C.calls.iconClosed);
  C.mouse({ closest: function () { return null; } });
  check('… a click anywhere else still ends both, as before', C.calls.editEnded === 1 && C.calls.iconClosed === 1);

  /* ---- UX-117: Download all asks while the site is not published ---- */
  var D = page({ MAILERS: { event: { published: false }, mailers: [] } });
  var dl = D.sb.downloadAllMailers(); await settle();
  check('UX-117: Download all on a site not published asks first', D.modal() === 'This event’s site isn’t published yet' &&
    /The Register button and links in these mails will not work until it is\./.test(D.els.uiModalBody.innerHTML) &&
    D.els.uiModalBody.innerHTML.indexOf('<a href="/edit-event.html?event=x" target="_top">Publish it from the event’s page</a>') !== -1 &&
    D.els.uiModalOk.textContent === 'Download anyway' && D.calls.api.length === 0, D.els.uiModalBody.innerHTML);
  D.answer(false); await dl;
  check('UX-117: Cancel downloads nothing', D.calls.api.length === 0);
  dl = D.sb.downloadAllMailers(); await settle();
  D.answer(true); await dl;
  check('UX-117: Download anyway downloads', D.calls.api.length === 1 && D.calls.toast.indexOf('track:zip') !== -1);
  var D2 = page();
  await D2.sb.downloadAllMailers();
  check('UX-117: a published site downloads at once', D2.modal() === null && D2.calls.api.length === 1);
  var D3 = page({ MAILERS: { event: {}, mailers: [] } });
  await D3.sb.downloadAllMailers();
  check('UX-117: a catalog that does not say is taken as live (nobody is warned for nothing)', D3.modal() === null && D3.calls.api.length === 1);

  /* ---- UX-136: Download all (.zip) is named after the event (PATCHES P10, oneworld.js owZipName) ---- */
  var Z1 = page({ MAILERS: { event: { published: true, name: 'Brand World Summit 2026 — South!' }, mailers: [] } });
  await Z1.sb.downloadAllMailers();
  check('UX-136: the ZIP is named after the event, not "mailers.zip"', !!Z1.calls.clicked && Z1.calls.clicked.download === 'brand-world-summit-2026-south-mailers.zip', Z1.calls.clicked && Z1.calls.clicked.download);
  check('UX-136: … and with no name, after the event\'s id', D3.calls.clicked && D3.calls.clicked.download === 'x-mailers.zip', D3.calls.clicked && D3.calls.clicked.download);
  var Z2 = page({ MAILERS: { event: { published: true, name: 'ईटी पुरस्कार' }, mailers: [] } });
  await Z2.sb.downloadAllMailers();
  check('UX-136: a name with no Latin letters or digits: the event\'s id', Z2.calls.clicked && Z2.calls.clicked.download === 'x-mailers.zip', Z2.calls.clicked && Z2.calls.clicked.download);
  var Z3 = page({ MAILERS: { event: { published: true, name: '  ' + new Array(30).join('Long name ') }, mailers: [] } });
  await Z3.sb.downloadAllMailers();
  check('UX-136: a long name is cut to 60 letters, never ending on a dash', Z3.calls.clicked && /^long-name-[a-z-]*[a-z]-mailers\.zip$/.test(Z3.calls.clicked.download) &&
    Z3.calls.clicked.download.length <= 60 + '-mailers.zip'.length, Z3.calls.clicked && Z3.calls.clicked.download);

  /* ---- UX-120: a block's menu shows the value the mail is drawn with ---- */
  var F = page(), fv = F.sb.owFieldValue;
  var YES = [{ value: 'yes', label: 'On' }, { value: 'no', label: 'Off' }];
  check('UX-120: a style switch with no value shows its default (Off), not the first choice', fv({ props: {} }, { key: 'italic', type: 'select', default: 'no', options: YES }, {}) === 'no');
  check('UX-120: Line height with no value shows Normal (its default)', fv({ props: {} }, { key: 'lh', type: 'select', default: '1.55' }, {}) === '1.55');
  check('UX-120: a block\'s own value wins', fv({ props: { italic: 'yes' } }, { key: 'italic', type: 'select', default: 'no' }, {}) === 'yes');
  var SPK = { fields: [{ key: 'style', type: 'select', default: 'cards' }, { key: 'cols', type: 'select', defaultBy: { on: 'style', map: { cards: 3, circle: 4 } } }] };
  check('UX-120: a default that follows another field: from that field\'s value', fv({ props: { style: 'circle' } }, SPK.fields[1], SPK) === '4' &&
    fv({ props: {} }, SPK.fields[1], SPK) === '3', [fv({ props: { style: 'circle' } }, SPK.fields[1], SPK), fv({ props: {} }, SPK.fields[1], SPK)]);
  check('UX-120: a field that is not a menu shows only the block\'s own value (as before)', fv({ props: {} }, { key: 'radius', type: 'number', default: '8' }, {}) === undefined &&
    fv({ props: { radius: 4 } }, { key: 'radius', type: 'number', default: '8' }, {}) === 4);
  /* the select fldInput builds marks the option equal to the value it is given */
  var fld = piece(studio, 'function fldInput(f,val,onchange,aiWhat){', '\n}');
  check('UX-120: fldInput marks a menu\'s choice by the value it is handed (P24 hands it owFieldValue\'s)', !!fld && fld.indexOf('${String(val)===String(o.value)?"selected":""}') !== -1 &&
    studio.indexOf(': fldInput(f,owFieldValue(b,f,schema),set,') !== -1);

  /* ---- the engine: style switches read On / Off, parts of a block Show / Hide (the mail is unchanged) ---- */
  var engine = require('./vendor/promo-engine');
  function fieldOf(type, key) { return (engine.BLOCK_SCHEMAS[type].fields || []).filter(function (f) { return f.key === key; })[0] || {}; }
  function labels(f) { return (f.options || []).map(function (o) { return o.value + '=' + o.label; }).join(','); }
  [['text', 'italic'], ['text', 'underline'], ['text', 'caps'], ['button', 'full'], ['button', 'caps']].forEach(function (k) {
    var f = fieldOf(k[0], k[1]);
    check('UX-120: ' + k.join('.') + ' reads On / Off, default Off', labels(f) === 'yes=On,no=Off' && f.default === 'no', [labels(f), f.default]);
  });
  [['speakers', 'showBio'], ['stats', 'icons'], ['speakers', 'showRole']].forEach(function (k) {
    check('UX-120: ' + k.join('.') + ' (a part of the block) still reads Show / Hide', labels(fieldOf(k[0], k[1])) === 'yes=Show,no=Hide');
  });

  /* ---------- oneworld.js on the page: the mailer page, the studio's bar, Download to send and Copy HTML ---------- */
  function owPage(event, answer) {
    var els = {}, calls = { confirm: [], sent: [], menus: 0, posted: [] };
    function mk(id) { var e = el(id); Object.defineProperty(e, 'innerHTML', { get: function () { return e._h || ''; }, set: function (h) { e._h = String(h); } }); return e; }
    ['content', 'mailer', 'prodNav'].forEach(function (id) { els[id] = mk(id); });
    var acts = { kids: [], firstChild: null,
      insertBefore: function (n) { acts.kids.unshift(n); n.parentNode = acts; acts.firstChild = n; els[n.id] = n; },
      removeChild: function (n) { acts.kids = acts.kids.filter(function (k) { return k !== n; }); delete els[n.id]; } };
    var win = { top: { location: { href: '' } }, addEventListener: function () {}, removeEventListener: function () {}, fetch: function () { return Promise.reject(new Error('no network')); },
      RevampAuth: { whenResolved: function () { return new Promise(function () {}); }, authedFetch: function () { return new Promise(function () {}); } } };
    win.parent = win;
    var sb = {
      window: win, location: { search: '?event=x', origin: 'https://oneworld.example' }, URLSearchParams: URLSearchParams, setTimeout: setTimeout, clearTimeout: clearTimeout, console: console,
      document: { body: { classList: { toggle: function () {} } }, documentElement: { classList: { contains: function () { return false; }, add: function () {} } },
        addEventListener: function () {}, removeEventListener: function () {}, querySelectorAll: function () { return []; },
        querySelector: function (sel) { return sel === '#mailer .ed-top .acts' ? acts : null; },
        createElement: function () { var e = mk(''); return e; } },
      AN: {}, MAILERS: { event: event, mailers: [{ id: 'mailer.a', available: true }] },
      $: function (id) { return els[id] || null; },
      escapeHtml: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
      toast: function () {}, openMailer: function () {}, closeMailer: function () { els.mailer.classList.remove('on'); return Promise.resolve(); },
      showAnalytics: function () {}, paintAnalytics: function () {}, rankCard: function () { return ''; }, setProdNav: function () {},
      findMailer: function () { return null; }, skEventPage: function () { return ''; }, renderEvSaved: function () { return ''; }, mailerCards: function () { return ''; }, refreshMailerCards: function () {},
      mlDownload: function () { calls.sent.push('download'); return Promise.resolve(); }, mlCopy: function () { calls.sent.push('copy'); return Promise.resolve(); },
      closeMenus: function () { calls.menus++; },
      uiConfirm: function (t, m, o) { calls.confirm.push({ t: t, m: m, o: o }); return Promise.resolve(answer !== false); },
      /* the platform's dialog: answered as the sender answers (the page's wrapper is checked below) */
      uiOpen: function (o) { calls.opened = (calls.opened || []).concat([o && o.title]); return Promise.resolve(answer !== false); },
      /* the platform's busy box: its element is made the first time, inside the canvas */
      mlBusy: function (on, label) { if (!els.mlBusy) els.mlBusy = mk('mlBusy'); els.mlBusy.classList.toggle('on', !!on); calls.busy = (calls.busy || []).concat([[on, label]]); },
      /* the platform's measuring and drop line, which oneworld.js wraps (UX-136, checked in promo-studio.test.js) */
      mlFit: function () {}, mlDropShow: function () {}
    };
    vm.createContext(sb);
    vm.runInContext(owSrc, sb, { filename: 'oneworld.js' });
    return { sb: sb, els: els, calls: calls, acts: acts };
  }
  var U = owPage({ name: 'QA Summit', published: false, micrositeUrl: 'https://x.example/e/x' });
  U.sb.owRenderPage();
  var h = U.els.content.innerHTML;
  check('UX-117: the mailer page of a site not published: no Website ↗, "Not published yet" in its place', h.indexOf('Website ↗') === -1 && h.indexOf('<span class="chip ow-unpub-chip">Not published yet</span>') !== -1, h.slice(0, 600));
  check('UX-117: … and a note above the mailers, with the way to publish', h.indexOf('<div class="ow-unpub" role="note">This event’s site isn’t published yet — the Register button and links in these mails will not work until it is. <a href="/edit-event.html?event=x" target="_top">Publish it from the event’s page →</a></div>') !== -1);
  var L = owPage({ name: 'QA Summit', published: true, micrositeUrl: 'https://x.example/e/x' });
  L.sb.owRenderPage();
  check('UX-117: a published site: Website ↗, no note', L.els.content.innerHTML.indexOf('href="https://x.example/e/x"') !== -1 && L.els.content.innerHTML.indexOf('ow-unpub') === -1);
  U.sb.owMarkStudio();
  check('UX-117: the studio\'s bar says "Site not published", first in its actions', U.acts.kids.length === 1 && U.acts.kids[0].textContent === 'Site not published' &&
    U.acts.kids[0].className === 'ow-unpub-pill' && /will not work until the event’s site is published/.test(U.acts.kids[0].title));
  U.sb.owMarkStudio();
  check('UX-117: … once', U.acts.kids.length === 1);
  L.sb.owMarkStudio();
  check('UX-117: a published site\'s studio has no such pill', L.acts.kids.length === 0);

  await U.sb.mlDownload();
  check('UX-117: Download to send on a site not published asks, then downloads when told to', U.calls.confirm.length === 1 && U.calls.confirm[0].t === 'This event’s site isn’t published yet' &&
    U.calls.confirm[0].o.ok === 'Download anyway' && /links in this mail will not work/.test(U.calls.confirm[0].m) && U.calls.sent.join() === 'download');
  await U.sb.mlCopy();
  check('UX-117: Copy HTML: the menu closes, it asks with "Copy anyway", then copies', U.calls.menus === 1 && U.calls.confirm[1].o.ok === 'Copy anyway' && /copy it now/.test(U.calls.confirm[1].m) && U.calls.sent.join() === 'download,copy');
  var N = owPage({ published: false }, false);
  await N.sb.mlDownload(); await N.sb.mlCopy();
  check('UX-117: Cancel hands nothing out', N.calls.sent.length === 0 && N.calls.confirm.length === 2);
  await L.sb.mlDownload();
  check('UX-117: a published site hands the mail out at once', L.calls.confirm.length === 0 && L.calls.sent.join() === 'download');

  /* UX-121: the busy box is over the part of the mail in view, and follows the canvas while it is up */
  var B = owPage({ published: true }), scrolls = [];
  B.els.mlStage = { scrollTop: 1800, clientHeight: 640, addEventListener: function (t, fn) { if (t === 'scroll') scrolls.push(fn); } };
  B.sb.mlBusy(true, 'Making the picture…');
  check('UX-121: the busy box sits over the mail in view (the canvas scrolled down)', B.els.mlBusy.style.top === '1800px' && B.els.mlBusy.style.height === '640px' &&
    B.els.mlBusy.style.bottom === 'auto' && JSON.stringify(B.calls.busy) === JSON.stringify([[true, 'Making the picture…']]));
  B.els.mlStage.scrollTop = 400; scrolls.forEach(function (fn) { fn(); });
  check('UX-121: … and follows it', B.els.mlBusy.style.top === '400px' && scrolls.length === 1);
  B.sb.mlBusy(false); B.sb.mlBusy(true);
  check('UX-121: the canvas is watched once', scrolls.length === 1);
  check('UX-121: the export says what it is doing', /mlBusy\(true, 'Making the picture…'\);/.test(owSrc));

  /* UX-117: a dialog over the mailer page of a tall frame takes the window while it is open, then gives it back */
  var T = owPage({ published: false });
  var toldT = [];
  T.sb.owTellParent = function (s) { toldT.push(s); };
  T.sb.owTall = function () { return true; };
  await T.sb.uiOpen({ title: 'X' });
  check('UX-117: a dialog over the page of a tall frame takes the window, and gives it back when answered', toldT.join() === 'open,close' && T.calls.opened.join() === 'X');
  toldT.length = 0;
  T.els.mailer.classList.add('on');
  await T.sb.uiOpen({ title: 'Y' });
  check('UX-117: … but not in the studio, which has the window already', toldT.length === 0);
  var T2 = owPage({ published: false });
  var toldT2 = [];
  T2.sb.owTellParent = function (s) { toldT2.push(s); };
  await T2.sb.uiOpen({ title: 'Z' });
  check('UX-117: a frame that is not tall keeps its place', toldT2.length === 0);

  /* the wrapped close: the window is given back once the platform's close has closed, never on Keep editing */
  var W = owPage({ published: true });
  W.els.mailer.classList.add('on');
  var told = [];
  W.sb.owTellParent = function (s) { told.push(s); };
  var r = W.sb.closeMailer();
  check('the wrapped close waits for the platform\'s answer', told.length === 0 && typeof r.then === 'function');
  await r;
  check('… then gives the window back', told.join() === 'close');
  told.length = 0;
  var keep = owPage({ published: true });
  keep.els.mailer.classList.add('on');
  keep.sb.owTellParent = function (s) { told.push(s); };
  /* oneworld.js took the platform's close when it loaded; one that keeps the studio open is put in its place */
  keep.sb.owCloseMailer = function () { return Promise.resolve(); };
  await keep.sb.closeMailer();
  check('… and keeps it on Keep editing (the studio still open)', told.length === 0);

  /* ---- the new rules in oneworld.css: the console's tokens, AA in both themes ---- */
  var css = read('promo-studio/oneworld.css').replace(/\/\*[\s\S]*?\*\//g, '');
  function block(sel) {
    var at = css.indexOf(sel + '{');
    if (at === -1) return {};
    var body = css.slice(at + sel.length + 1, css.indexOf('}', at)), out = {}, m, re = /(--[\w-]+)\s*:\s*([^;]+);/g;
    while ((m = re.exec(body))) out[m[1]] = m[2].trim();
    return out;
  }
  function ruleOf(sel) { var at = css.indexOf('\n' + sel + '{'); return at === -1 ? '' : css.slice(at + sel.length + 2, css.indexOf('}', at)); }
  function varOf(body, prop) { var m = new RegExp('(?:^|;)\\s*' + prop + ':var\\((--[\\w-]+)\\)').exec(body || ''); return m ? m[1] : null; }
  function lum(h) { h = h.replace('#', ''); var v = [0, 2, 4].map(function (i) { var c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var LIGHT = block('\n:root'), DARK = block(':root[data-theme="dark"]');
  [['.ow-unpub', 'the mailer page\'s note'], ['.chip.ow-unpub-chip,.ow-unpub-pill', '"Not published yet" and the studio\'s pill']].forEach(function (p) {
    var body = ruleOf(p[0]), fg = varOf(body, 'color'), bg = varOf(body, 'background');
    check('UX-117: ' + p[1] + ' is drawn with the console\'s tokens', !!fg && !!bg, body);
    [['light', LIGHT], ['dark', DARK]].forEach(function (t) {
      var r = fg && bg && t[1][fg] && t[1][bg] ? ratio(t[1][fg], t[1][bg]) : 0;
      check('UX-117: AA, ' + t[0] + ': ' + p[1] + ' (' + r.toFixed(2) + ':1)', r >= 4.5, [fg, bg]);
    });
  });
  [['light', LIGHT], ['dark', DARK]].forEach(function (t) {
    var r = ratio(t[1]['--ow-accent-text'], t[1]['--panel']);
    check('UX-117: AA, ' + t[0] + ': the dialog\'s link (' + r.toFixed(2) + ':1)', r >= 4.5 && varOf(ruleOf('.ui-body a'), 'color') === '--ow-accent-text');
  });

  if (failed) { console.error('promo-studio-guards: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-studio-guards: all ' + passed + ' checks passed');
})().catch(function (err) { console.error('promo-studio-guards: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
