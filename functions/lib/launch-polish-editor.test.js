// node functions/lib/launch-polish-editor.test.js — launch-check polish of the site editor and Create Event (Nov 2026):
//   1 WZ-053  every call the wizard makes to /api goes through the shared signed-in fetch, with the run's signal
//   2 WZ-067  a section's tick (and "n/m filled") follows what the section holds, on every change and on resume
//   3 WZ-070  the logo hint gives the size as a suggestion, not a rule
//   4 ED-041  the editor's reads while the site opens go through RevampAuth.authedFetch
//   5 ED-053  no "Not shown on this template" toast while the site opens
//   6 ED-056  no picture is saved inside the page as data: the hand-off logo by its address, any other stored before Save
//   7 ED-060  a Tablet width between Desktop and Mobile, centred on the stage
//   8 ED-061  a press on the canvas closes the tools row's menu, the Layers menu and the Theme / style pop-over
//   9 ED-062  the AI-marker switch is remembered per event, and not at all without one
//  10 ED-067  the appearance switch says it changes the editor, not the site
//  11 TPL-010 a records read that failed is told in a notice that stays, and a later read that works takes it away
// No network, no AI, no browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./fixtures/create-event-page');
const { makeDom } = require('./fixtures/mini-dom');

var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var CE = read('create-event.html');
var WIZ = F.SRC;
var SRC = read('editor-template-ui.js');
var PAGE = read('custom_editor.html');
var CANVAS = read('editor-canvas.js');
var TOGGLE = read('theme-toggle.js');
var SCRIPTS = PAGE.match(/<script>([\s\S]*?)<\/script>/g) || [];
var INLINE = SCRIPTS.length ? SCRIPTS[SCRIPTS.length - 1].replace(/^<script>|<\/script>$/g, '') : '';

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
function line(re, src) { var m = re.exec(src || SRC); return m ? m[0] : ''; }
function noComments(s) { return s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''); }
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

(async function () {
  /* ======================= 1 WZ-053 the wizard's /api calls ======================= */
  (function () {
    var code = noComments(WIZ);
    var bare = code.match(/\bfetch\(\s*['"]\/api\/[^\n]*/g) || [];
    check('1.1 no bare fetch to /api is left but the stop sent with keepalive as the page is left',
      bare.length === 1 && /\/api\/generate-content', \{ method: 'POST', keepalive: true/.test(bare[0]), bare);
    check('1.2 the hand-rolled token block of the Lovable import is gone', code.indexOf('RevampAuth.getIdToken') === -1 && code.indexOf("'Authorization': 'Bearer '") === -1);
    check('1.3 one helper, RevampCore.authedFetch, refused (401) when it is not there',
      /function apiFetch\(url, opts\)\{\s*if \(window\.RevampCore && typeof RevampCore\.authedFetch === 'function'\) return RevampCore\.authedFetch\(url, opts \|\| \{\}\);/.test(code) && /err\.status = 401;/.test(body('apiFetch', code)));
    check('1.4 suggest-design goes through it with the run\'s signal',
      /return apiFetch\('\/api\/suggest-design', \{ method: 'POST', body: JSON\.stringify\(payload\), signal: runSignal\(run\) \}\)/.test(code));
    check('1.5 the four brief routes (postJson) go through it with the run\'s signal',
      /function postJson\(url, body\)\{[\s\S]*?return apiFetch\(url, \{ method: 'POST', body: JSON\.stringify\(body\), signal: runSignal\(run\) \}\)/.test(code) &&
      ['/api/extract-brief', '/api/ingest-source', '/api/plan-structure', '/api/generate-content'].every(function (u) { return code.indexOf("postJson('" + u + "'") !== -1; }));
    check('1.6 /api/draft and import-lovable too',
      /return apiFetch\('\/api\/draft\?eventId=' \+ encodeURIComponent\(eventId\), \{ signal: runSignal\(run\) \}\)/.test(code) &&
      /apiFetch\('\/api\/import-lovable', \{\s*method: 'POST',\s*(?:\/\*[^*]*\*\/\s*)?body: JSON\.stringify\(\{ url: url \}\),\s*signal: runSignal\(run\)\s*\}\)\.then\(readJson\)/.test(code));
    check('1.7 a lapsed session is said as "sign in again", not "in another tab" (the signed-out box signs in in place)',
      code.indexOf("'Your sign-in has expired. Sign in again, then try again.'") !== -1 && code.indexOf('in another tab, then try again') === -1);
  })();
  await (async function () {
    var calls = [];
    var P = F.load({ core: { authedFetch: function (url, opts) { calls.push({ url: url, opts: opts }); return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } }); } } });
    var sig = { aborted: false };
    var res = await P.ce('apiFetch')('/api/suggest-design', { method: 'POST', body: '{}', signal: sig });
    check('1.8 apiFetch hands the request, its body and its signal to RevampCore.authedFetch as they are',
      res && res.status === 200 && calls.length === 1 && calls[0].url === '/api/suggest-design' && calls[0].opts.signal === sig && calls[0].opts.body === '{}' && calls[0].opts.method === 'POST', calls);
    var Q = F.load({ core: { authedFetch: undefined } });
    var why = null;
    try { await Q.ce('apiFetch')('/api/draft?eventId=qa-x', {}); } catch (e) { why = e; }
    check('1.9 … and with no signed-in fetch on the page it is refused as a lapsed session, never sent bare',
      why && why.status === 401 && Q.log.fetched.indexOf('/api/draft?eventId=qa-x') === -1, why && why.message);
  })();

  /* ======================= 2 WZ-067 the section list's ticks ======================= */
  (function () {
    var code = noComments(WIZ);
    check('2.1 markDone takes no flag: the tick is what the section holds', /function markDone\(s\)\{\s*var was = s\.done;\s*s\.done = sectionFilled\(s\);/.test(code) &&
      !/markDone\(s, /.test(code), (code.match(/markDone\(s, [^)]*\)/g) || []));
    check('2.2 every add, remove, undo and reorder in a section\'s editor recomputes it (the shared rerender)',
      /var rerender = function\(\)\{ markDone\(s\); renderEditor\(\); \};/.test(code) && /var settle = rerender;/.test(code) && /var contactsChanged = rerender;/.test(code));
    var intro = body('bindIntro', code);
    check('2.3 the text blocks\' add and remove (and their Undo) and the pointers\' remove recompute it too',
      (intro.match(/markDone\(s\); renderEditor\(\);/g) || []).length >= 5 && !/save\(\); renderEditor\(\);\s*offerUndo/.test(intro));
    check('2.4 once for every section when a draft is resumed', /S\.sections\.forEach\(function\(sec\)\{ sec\.done = sectionFilled\(sec\); \}\);/.test(body('restore', code)));
    check('2.5 no section is ticked by fiat any more (edition fills, AI wording, its undo)', !/\bsec\.done = (true|u\.done);/.test(code));
  })();
  (function () {
    var P = F.load();
    var sf = P.ce('sectionFilled'), seed = P.ce('seed');
    function sec(libId, shape, data) { return { id: 'x-' + libId, libId: libId, shape: shape, data: Object.assign(seed(shape), data || {}) }; }
    var why = sec('whyjoin', 'cards');
    why.data.heading = 'W';
    check('2.6 a heading typed in is content', sf(why) === true);
    why.data.heading = '';
    check('2.7 … and typed out again it is not (the tick goes)', sf(why) === false);
    why.data.media = { kind: 'image', url: '', side: 'right' };
    check('2.8 an empty picture block (its kind and side chosen) is not content', sf(why) === false);
    why.data.media.url = 'https://example.org/a.jpg';
    check('2.9 … its address is', sf(why) === true);
    var cards = sec('awaits', 'cards');
    cards.data.items.push({ t: 'Conference', d: '' });
    check('2.10 a card with a heading fills a cards section', sf(cards) === true);
    cards.data.items.splice(0, 1);
    check('2.11 … and with the only card deleted it is empty again', sf(cards) === false);
    var about = sec('about', 'rich', { body: 'Short text.' });
    check('2.12 Overview needs more than a few words', sf(about) === false && (about.data.body = 'A summit for the people who run retail in India.', sf(about)) === true);
    var stats = sec('stats', 'stats', { items: [{ v: '500', k: '' }] });
    check('2.13 a stat needs its number and its label', sf(stats) === false && (stats.data.items[0].k = 'Delegates', sf(stats)) === true);
    check('2.14 a photo chosen in this browser fills the gallery before it has loaded', sf(sec('glimpses', 'gallery', { items: [{ slot: 3, url: '', caption: '' }] })) === true &&
      sf(sec('glimpses', 'gallery', { items: [{ url: '', caption: 'Only a caption' }] })) === false);
    check('2.15 a speaker needs a name; a partner a name or a logo', sf(sec('speakers', 'people', { items: [{ n: '', r: 'CEO', c: '' }] })) === false &&
      sf(sec('partners', 'logos', { tiers: [{ t: 'Gold', logos: [{ n: '', url: '', slot: 2 }] }] })) === true);
    check('2.16 a contact needs an email or a phone', sf(sec('contact', 'contacts')) === false &&
      sf(sec('contact', 'contacts', { blocks: [{ t: 'Partnerships', people: [{ n: 'Asha', e: 'asha@example.org', p: '' }] }] })) === true);
    var hero = sec('hero', 'hero', { bannerMode: 'text' });
    check('2.17 the banner kind alone is not content', sf(hero) === false);
    hero.data.psdBanner = { width: 1920, height: 720, filename: 'banner.psd' };
    check('2.18 … nor the other kind\'s picture, kept for going back to it', sf(hero) === false);
    hero.data.bannerMode = 'psd';
    check('2.19 … the banner the site shows is', sf(hero) === true);
    check('2.20 … and so are the banner\'s words', sf(sec('hero', 'hero', { title: 'Retail Leadership Summit' })) === true);

    // markDone: whatever a caller once passed, the tick is the content's
    P.ce('renderSecList = function(){}; renderFoot = function(){}; refreshProgress = function(){}; save = function(){};');
    var s = sec('whyjoin', 'cards');
    s.done = true;
    P.ce('markDone')(s, true);
    check('2.21 markDone un-ticks a section with nothing in it', s.done === false);
    s.data.items.push({ t: 'Network', d: '' });
    P.ce('markDone')(s);
    check('2.22 … and ticks it once it holds something', s.done === true);

    // a draft saved by an earlier version with ticks its sections no longer earn
    var restored = P.ce('restore')({ draftId: 'qa-draft-wz067', step: 1, step1Phase: 'details', basics: { name: 'QA tick', category: 'IP' }, sections: [
      { id: 'a', libId: 'about', shape: 'rich', include: true, done: true, data: { body: 'Hi' } },
      { id: 'b', libId: 'stats', shape: 'stats', include: true, done: true, data: { items: [{ v: '500', k: 'Delegates' }] } },
      { id: 'c', libId: 'awaits', shape: 'cards', include: true, done: true, data: { items: [] } }
    ] });
    var after = P.ce('S.sections').map(function (x) { return x.id + ':' + x.done; }).join(',');
    check('2.23 a resumed draft\'s ticks follow its content', restored === true && after === 'a:false,b:true,c:false', after);
  })();

  /* ======================= 3 WZ-070 the logo hint ======================= */
  check('3.1 the logo hint, in the markup and as the form draws it, gives the size as a suggestion',
    CE.indexOf('<div class="logo-meta" id="logo-hint">PNG, WEBP or SVG, up to 5&nbsp;MB. Best at about 571&times;340.</div>') !== -1 &&
    WIZ.indexOf("'PNG, WEBP or SVG, up to 5 MB. Best at about 571×340.'") !== -1 &&
    CE.indexOf('571&times;340 &middot;') === -1 && CE.indexOf('571×340 ·') === -1);

  /* ======================= 4 ED-041 the editor's reads ======================= */
  await (async function () {
    var code = noComments(SRC);
    check('4.1 no bare fetch to /api in the editor', !/\bfetch\(\s*['"]\/api\//.test(code), code.match(/.{40}\bfetch\(\s*['"]\/api\/.{30}/g));
    check('4.2 the generated draft and the previous speakers\' profiles are read through apiGet',
      /draftFetch = apiGet\('\/api\/draft\?eventId=' \+ encodeURIComponent\(eventId\)\)/.test(body('fetchServerDraft')) &&
      /return apiGet\('\/api\/generated-section\?eventId=/.test(body('refreshPreviousProfiles')));
    var make = new Function('window', 'RevampAuth', body('apiGet') + '\nreturn apiGet;');
    var asked = [];
    var auth = { authedFetch: function (url) { asked.push(url); return Promise.resolve({ ok: true, status: 200 }); } };
    var r = await make({ RevampAuth: auth }, auth)('/api/draft?eventId=qa-x');
    check('4.3 apiGet is RevampAuth.authedFetch', r && r.status === 200 && asked.join() === '/api/draft?eventId=qa-x', asked);
    var why = null;
    try { await make({}, undefined)('/api/draft?eventId=qa-x'); } catch (e) { why = e; }
    check('4.4 … refused as a lapsed session without it', why && why.status === 401);
  })();

  /* ======================= 5 ED-053 no "Not shown" toast ======================= */
  (function () {
    var apply = body('applyHandoffDraft');
    check('5.1 the hand-off reports nothing it had no place for (records get their own sections)',
      !!apply && apply.indexOf('Not shown on this template') === -1 && apply.indexOf('report.skipped') === -1 && SRC.indexOf('Not shown on this template') === -1);
  })();

  /* ======================= 6 ED-056 no picture kept inside the page ======================= */
  await (async function () {
    var apply = body('applyHandoffDraft');
    check('6.1 the hand-off logo goes in by its address: this browser\'s copy is read only when there is none, and is uploaded first',
      /var logoKey = draft\.event && !draft\.event\.logoUrl \? draft\.event\.logoKey : null;/.test(apply) && /return handoffLogoAddress\(logoRec\);/.test(apply) &&
      /RevampFill\.fromHandoff\(draft, logoUrl\)/.test(apply) && apply.indexOf('logoRec.dataUrl') === -1);
    var notices = [];
    var make = new Function('window', 'RevampCore', 'eventId', 'showNotice', body('handoffLogoAddress') + '\nreturn handoffLogoAddress;');
    var stored = [];
    var okCore = { storePicture: function (ev, kind, data, name) { stored.push([ev, kind, name]); return Promise.resolve('https://storage.example/events/qa-x/logo.png'); } };
    var ok = await make({ RevampCore: okCore, console: console }, okCore, 'qa-x', function (id, o) { notices.push(id); })({ name: 'brand.png', dataUrl: 'data:image/png;base64,AAAA' });
    check('6.2 … uploaded as the event\'s logo, and its address is what the page gets', ok === 'https://storage.example/events/qa-x/logo.png' && stored.length === 1 && stored[0][1] === 'logo' && /logo$/.test(stored[0][2]), stored);
    var badCore = { storePicture: function () { return Promise.reject(Object.assign(new Error('offline'), { status: 0 })); } };
    var bad = await make({ RevampCore: badCore, console: { warn: function () {} } }, badCore, 'qa-x', function (id) { notices.push(id); })({ name: 'brand.png', dataUrl: 'data:image/png;base64,AAAA' });
    check('6.3 … and when it cannot be uploaded it is left out (never its data), and the person is told', bad === '' && notices.indexOf('handoff-logo') !== -1, notices);
    check('6.4 … no copy, nothing', (await make({ RevampCore: okCore }, okCore, 'qa-x', function () {})(null)) === '');

    // the page's pictures held as data, found and swapped for their addresses
    var parts = ['var INLINE_PICTURE = ', 'var PICTURE_ATTRS = ', 'var storedPictures = '].map(function (start) { return line(new RegExp(start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*')); });
    check('6.5 the editor knows a picture held as data by its address form', parts.every(Boolean), parts);
    var dom = makeDom(), doc = dom.document;
    doc.body.innerHTML = '<section data-rv-section="hero"><img class="hero-logo" alt="Event logo" src="data:image/png;base64,AAAA">' +
      '<div class="bg" style="background-image:url(&quot;data:image/jpeg;base64,BBBB&quot;)"></div><img src="https://cdn.example/x.png">' +
      '<div data-rv-editor><img src="data:image/png;base64,CCCC"></div><p>data:image/png;base64,DDDD in words</p></section>';
    function all(root) { var out = []; (function walk(n) { n.childNodes.forEach(function (c) { if (c.nodeType === 1) { out.push(c); walk(c); } }); })(root); return out; }
    var qsa = doc.documentElement.querySelectorAll;
    doc.documentElement.querySelectorAll = function (sel) { return sel === '*' ? all(doc.documentElement) : qsa.call(this, sel); };
    var fns = new Function('RevampCore', 'eventId', 'canvas', 'undoStack', 'undoPtr', 'commitNow', 'showToast', 'window',
      parts.join('\n') + '\n' + ['pictureHolders', 'inlinePictures', 'swapInlinePictures', 'storeInlinePictures'].map(function (n) { return body(n); }).join('\n') +
      '\nreturn { inline: inlinePictures, swap: swapInlinePictures, store: storeInlinePictures, stored: function () { return storedPictures; } };');
    var uploads = [], toasts = [], snaps = 0, fail = { 'data:image/jpeg;base64,BBBB': true };
    var core = { storePicture: function (ev, kind, data, name) {
      uploads.push(kind + ':' + name + ':' + data.slice(-4));
      return fail[data] ? Promise.reject(Object.assign(new Error('offline'), { status: 0 })) : Promise.resolve('https://storage.example/events/qa-x/media/' + data.slice(-4) + '.png');
    } };
    var canvas = { doc: doc, sameSnapshot: function () { return true; }, snapshot: function () { snaps++; return { n: snaps }; } };
    var stack = [{ n: 0 }], firstStep = stack[0];
    var E = fns(core, 'qa-x', canvas, stack, 0, function () {}, function (t) { toasts.push(t); }, { console: { warn: function () {} } });
    var found = E.inline(doc);
    check('6.6 the pictures held as data are found once each, with what they are, but not the editor\'s own notes or plain text',
      found.length === 2 && found[0].name === 'site logo' && found[1].name === 'site picture' && found[0].data === 'data:image/png;base64,AAAA', found);
    await E.store();
    var logo = doc.body.querySelector('img.hero-logo').getAttribute('src'), bg = doc.body.querySelector('div.bg').getAttribute('style');
    check('6.7 before a Save each is stored as a file of the event (media) and the page names its address',
      logo === 'https://storage.example/events/qa-x/media/AAAA.png' && uploads[0] === 'media:site logo:AAAA' && stack[0] !== firstStep && stack.length === 1, [logo, uploads]);
    check('6.8 … one that cannot be stored stays as it was, and the person is told', /base64,BBBB/.test(bg) && toasts.length === 1 && /could not be uploaded/.test(toasts[0]), toasts);
    delete fail['data:image/jpeg;base64,BBBB'];
    await E.store();
    check('6.9 … the next Save uploads only what is left', uploads.length === 3 && uploads[2] === 'media:site picture:BBBB' && !/data:/.test(doc.body.querySelector('div.bg').getAttribute('style')), uploads);
    check('6.10 … and nothing is held as data any more', E.inline(doc).length === 0);
    var save = body('saveToStaging');
    check('6.11 Save stores them first, then takes the page it sends',
      /if \(!opts\.picturesStored && inlinePictures\(canvas\.doc\)\.length\) \{/.test(save) && save.indexOf('storeInlinePictures()') !== -1 &&
      save.indexOf('storeInlinePictures()') < save.indexOf('var snap = undoStack[undoPtr]') && /return saveToStaging\(Object\.assign\(\{\}, opts, \{ picturesStored: true \}\)\);/.test(save));
  })();

  /* ======================= 7 ED-060 Tablet ======================= */
  (function () {
    var toggle = (PAGE.match(/<div class="device-toggle"[\s\S]*?<\/div>/) || [''])[0];
    var order = (toggle.match(/data-device="([a-z]+)"/g) || []).join(',');
    check('7.1 Desktop, Tablet, Mobile', order === 'data-device="desktop",data-device="tablet",data-device="mobile"' && /data-device="tablet" title="Tablet"/.test(toggle), order);
    check('7.2 the canvas has a tablet width of 768', /var DEVICES = \{ desktop: 1440, tablet: 768, mobile: 390 \};/.test(CANVAS));
    check('7.3 a Tablet page stands in the middle of a wider stage; Desktop as it was',
      /iframe\.style\.marginLeft = '';\s*\/\/[^\n]*\n\s*if \(device === 'tablet' && viewport\.clientWidth > w \* scale \+ 1\) iframe\.style\.marginLeft = Math\.floor\(\(viewport\.clientWidth - w \* scale\) \/ 2\) \+ 'px';/.test(CANVAS));
  })();

  /* ======================= 8 ED-061 a press on the canvas ======================= */
  (function () {
    check('8.1 the canvas tells the page of a press on the site, before anything on the site handles it',
      /canvas\.doc\.addEventListener\('mousedown', function \(\) \{ if \(host && host\.closeFloating\) host\.closeFloating\(\); \}, true\);/.test(body('wireCanvasEvents')));
    check('8.2 one closer for the tools row\'s menu, the Layers menu and the Theme / style pop-over',
      /var floatingClosers = \[\];\s*function closeFloating\(\)\{/.test(INLINE) && /floatingClosers\.push\(function\(\)\{ close\(false\); \}\);/.test(INLINE) &&
      /floatingClosers\.push\(function\(\)\{ if \(!lyrCtxMenu\.hidden\) closeLyrMenu\(\); \}\);/.test(INLINE) && /floatingClosers\.push\(closeGtStylePop\);/.test(INLINE) &&
      /closeFloating: closeFloating \}\)/.test(INLINE));
    var run = new Function(line(/var floatingClosers = \[\];/, INLINE) + '\n' + body('closeFloating', INLINE) +
      '\nvar shut = [];\nfloatingClosers.push(function(){ shut.push("more"); }, function(){ throw new Error("x"); }, function(){ shut.push("theme"); });\ncloseFloating();\nreturn shut;');
    check('8.3 … each closes, even when one before it fails', run().join() === 'more,theme');
  })();

  /* ======================= 9 ED-062 AI markers per event ======================= */
  (function () {
    var fn = body('initAiProvenanceToggle', INLINE);
    check('9.1 the key is the event\'s, whichever way the editor was opened', /var key = editorEventId \? 'revamp\.aiMarkersShown\.' \+ editorEventId : '';/.test(fn) && fn.indexOf("get('slug')") === -1);
    function runFor(id) {
      var store = {}, listeners = {}, shown = [];
      var el = { hidden: true, checked: false, addEventListener: function (t, f) { listeners[t] = f; } };
      var make = new Function('document', 'window', 'localStorage', 'editorEventId', fn + '\ninitAiProvenanceToggle();');
      make({ getElementById: function () { return el; } }, { RevampTemplateUI: { hasAiProvenance: function () { return true; }, setAiMarkers: function (v) { shown.push(v); } } },
        { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } }, id);
      el.checked = false;
      listeners.change();
      return { store: store, shown: shown };
    }
    var ev = runFor('qa-ev-1');
    check('9.2 turned off on an event, it is kept under that event', ev.store['revamp.aiMarkersShown.qa-ev-1'] === '0' && ev.shown.join() === 'true,false', ev);
    var none = runFor('');
    check('9.3 … with no event nothing is kept (no shared key)', Object.keys(none.store).length === 0 && none.shown.join() === 'true,false', none);
  })();

  /* ======================= 10 ED-067 the appearance switch ======================= */
  (function () {
    var LABEL = 'Editor appearance — does not change your site';
    check('10.1 the editor names its switch for what it changes', PAGE.indexOf('<span data-theme-toggle-target data-theme-toggle-label="' + LABEL + '"') !== -1);
    var dom = makeDom(), doc = dom.document, store = {};
    doc.readyState = 'complete';
    doc.addEventListener = function () {};
    var all = function (root) { var out = []; (function walk(n) { n.childNodes.forEach(function (c) { if (c.nodeType === 1) { out.push(c); walk(c); } }); })(root); return out; };
    doc.querySelectorAll = function (sel) {
      var m = /^\[([\w-]+)\]$/.exec(sel);
      return all(doc).filter(function (n) { return m && n.hasAttribute(m[1]); });
    };
    var named = doc.createElement('span'), plain = doc.createElement('span');
    named.setAttribute('data-theme-toggle-target', '');
    named.setAttribute('data-theme-toggle-label', LABEL);
    plain.setAttribute('data-theme-toggle-target', '');
    doc.body.appendChild(named);
    doc.body.appendChild(plain);
    var c = vm.createContext({ document: doc, matchMedia: function () { return { matches: false }; },
      localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } } });
    c.window = c;
    vm.runInContext(TOGGLE, c);
    var a = named.querySelector('button'), b = plain.querySelector('button');
    check('10.2 the switch takes the name given to its place, as its tooltip and its spoken name',
      !!a && a.getAttribute('aria-label') === LABEL && a.title === LABEL, a && [a.getAttribute('aria-label'), a.title]);
    c.RevampColorMode.toggle();
    check('10.3 … and keeps it when the theme changes', a.getAttribute('aria-label') === LABEL && a.title === LABEL);
    check('10.4 … a switch with no name of its own still says what pressing it does', !!b && b.getAttribute('aria-label') === 'Switch to light mode' && b.title === 'Switch to light mode', b && b.getAttribute('aria-label'));
  })();

  /* ======================= 11 TPL-010 a records read that failed ======================= */
  await (async function () {
    var draw = body('drawRecords');
    check('11.1 drawing the records tells what could not be read, whether or not anything changed, and when it fails',
      /var unread = \[\];\s*return fillRecords\(sectionsAdded, unread\)\.then\(function \(changed\) \{\s*tellRecordsRead\(unread, null\);/.test(draw) &&
      /\}, function \(err\) \{[\s\S]*?tellRecordsRead\(unread, err \|\| new Error\('The records could not be drawn\.'\)\);/.test(draw));
    check('11.2 both ways of reading records note a list that could not be read',
      /catch\(function \(err\) \{ noteUnread\(unread, r, err\); return null; \}\)/.test(body('fetchMapContent')) &&
      /catch\(function \(err\) \{ noteUnread\(unread, r, err\); return null; \}\)/.test(body('fetchGenericRepeatOverlay')) &&
      /fetchMapContent\(unread\), fetchGenericRepeatOverlay\(unread\)/.test(body('fillRecords')));
    var notices = [], cleared = [], redrawn = 0;
    var make = new Function('window', 'canvas', 'eventId', 'RevampDraw', 'RevampCore', 'showNotice', 'clearNotice', 'drawRecords',
      ['fetchMapContent', 'noteUnread', 'tellRecordsRead'].map(function (n) { return body(n); }).join('\n') + '\nreturn { fetch: fetchMapContent, tell: tellRecordsRead };');
    var map = [{ from: 'speakers' }, { from: 'faqs' }];
    var draw2 = { mapEntries: function () { return [{ kind: 'speakers' }, { kind: 'faqs' }]; }, MAP_SOURCES: { speakers: ['speakers'], faqs: ['faqs'] }, mapContent: function (rows) { return rows; } };
    var core = { fetchSub: function (r) { return r === 'speakers' ? Promise.reject(Object.assign(new Error('offline'), { status: 0 })) : Promise.resolve([]); } };
    var E = make({ RevampDraw: draw2, console: { warn: function () {} } }, { template: { content: { map: map } } }, 'qa-x', draw2, core,
      function (id, o) { notices.push({ id: id, o: o }); }, function (id) { cleared.push(id); }, function () { redrawn++; });
    var unread = [];
    var content = await E.fetch(unread);
    check('11.3 a list that could not be read is noted, and left off what is drawn ("could not tell" is never "none")', unread.join() === 'speakers' && !('speakers' in content) && Array.isArray(content.faqs), [unread, content]);
    E.tell(unread, null);
    var n = notices[0];
    check('11.4 the owner is told in a lasting notice, with Try again',
      !!n && n.id === 'records-unread' && n.o.text === 'Content could not be loaded — what you see may be out of date.' && n.o.kind === 'warn' && !n.o.duration &&
      n.o.actions && n.o.actions[0].label === 'Try again', n);
    n.o.actions[0].onClick();
    check('11.5 … Try again reads them again', redrawn === 1);
    E.tell([], null);
    check('11.6 … and a read that works takes the notice away', cleared.join() === 'records-unread');
    check('11.7 the old console-only report is gone', SRC.indexOf("console.warn('[RevampTemplateUI] Could not load real Content-tab data:', err);\n    });") === -1);
  })();

  console.log('launch-polish-editor: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
