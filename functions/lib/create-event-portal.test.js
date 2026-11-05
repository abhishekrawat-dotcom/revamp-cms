// node functions/lib/create-event-portal.test.js — Create Event asks the event's ET portal first, on the same
// screen as its type, and everything after uses it: the previous-edition picker lists only that portal's editions
// (no portal box of its own), "Clone design" offers only that portal's events, the record sends the portal (on
// create, and later only when it was changed here, with ifPortal), and an older draft gets a portal only from
// certain evidence or from the owner. Reads create-event.html as a file and runs its inline script in a vm over a
// small fake DOM, with RevampPortals (portal-picker.js), RevampCore and the page's own dialog and toasts stubbed.
// No network, no Firebase, no browser, no AI.
var fs = require('fs'), path = require('path'), vm = require('vm');
var etEvents = require('./et-events');

var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function count(s, sub) { return s.split(sub).length - 1; }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 8); i++) p = p.then(function () { return new Promise(function (r) { setImmediate(r); }); }); return p; }

var page = read('create-event.html');
var inline = (page.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); });
var SRC = inline.filter(function (s) { return s.indexOf("var DRAFT_PREFIX = 'revamp.createEvent.draft.v2.'") !== -1; })[0] || '';
var ROSTER = etEvents.portalList();
var HR_LINK = 'https://hr.economictimes.indiatimes.com/nexttech2026';
var CIO_LINK = 'https://cio.economictimes.indiatimes.com/annual-conclave';

/* =====================================================================================================
   1. The file
   ===================================================================================================== */
check('the page has its main inline script', SRC.length > 100000);
var picker = page.slice(page.indexOf('<div class="phase" id="cat-picker"'), page.indexOf('<div class="phase" id="step1-method"'));
check('1.1 #cat-portal comes before #cat-grid on the first screen', picker.indexOf('id="cat-portal"') !== -1 && picker.indexOf('id="cat-grid"') !== -1 &&
  picker.indexOf('id="cat-portal"') < picker.indexOf('id="cat-grid"'));
check('1.1 the Portal box is a combobox with its own list, hint, error and notice',
  /<input class="inp cbx-inp" id="cat-portal" type="text" role="combobox"[^>]*aria-controls="cat-portal-list"/.test(picker) &&
  /<ul class="cbx-list" id="cat-portal-list" role="listbox"[^>]*hidden><\/ul>/.test(picker) &&
  picker.indexOf('id="cat-portal-hint"') !== -1 && /id="cat-portal-error" role="alert" hidden/.test(picker) && /id="cat-portal-notice" role="status" hidden/.test(picker));
check('1.1 its label names it', picker.indexOf('<label class="cat-q" for="cat-portal">Portal</label>') !== -1);
check('1.1 the heading asks both questions', picker.indexOf('<h1>Which portal is this event on, and what type of microsite is it?</h1>') !== -1);
check('1.1 the callout says what each one decides', picker.indexOf('<strong>Your choices tailor the setup.</strong>The portal decides which previous editions you can pick, the ET bar and footer on the site, and the branding of its mailers and posts. The type decides the dates, fields and nomination options. You can change both later.') !== -1);
check('1.1 the details chip names the portal before the type', /<b id="cat-bar-portal"><\/b>\s*<b id="cat-bar-name"><\/b>/.test(page));
check('1.1 no portal box in the previous-edition picker', page.indexOf('gb-et-portal') === -1 && SRC.indexOf('loadEtPortals') === -1 && SRC.indexOf('etPick.portal') === -1);
check('1.1 the picker reads the event\'s own portal\'s editions', count(SRC, "'/api/et/events?portal=' + encodeURIComponent(S.basics.portal)") === 1);
check('1.1 the picker\'s row is one column', /\.et-pick-row\{ position: relative; display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 10px; \}/.test(page));
var tags = page.match(/<script\b[^>]*>/g) || [];
check('1.1 portal-picker.js is loaded once, right after auth.js and before the page\'s script', count(page, '<script src="portal-picker.js"></script>') === 1 &&
  tags.indexOf('<script src="portal-picker.js">') === tags.indexOf('<script src="auth.js">') + 1 && page.indexOf('<script src="portal-picker.js">') < page.indexOf(SRC));
var initSrc = (/\n  function init\(\)\{[\s\S]*?\n  \}\n/.exec(SRC) || [''])[0];
check('1.1 init() reads ?portal= before history.replaceState tidies the address', initSrc.indexOf("params.get('portal')") !== -1 &&
  initSrc.indexOf("params.get('portal')") < initSrc.indexOf('history.replaceState'));
check('1.1 the per-browser clone registry is no longer written', SRC.indexOf('registerEventTemplate(') === -1);
check('1.1 the template card has its portal note, the current-URL field its Change button',
  /<p class="hint tpl-carousel-portal-note" id="tpl-carousel-portal-note" hidden><\/p>/.test(page) && /id="gb-current-change" hidden>Change this event’s portal<\/button>/.test(page));
/* the brief run: an ET page read fixes the portal; another portal's page refused by the server says so on its row */
var briefSrc = SRC.slice(SRC.indexOf('function startGenerateFromBrief('), SRC.indexOf('function renderBriefProgress('));
check('1.1 a previous or current edition read from ET marks the draft (etPageRead)', /postJson\('\/api\/ingest-source', body\)\.then\(function\(resp\)\{[\s\S]{0,260}if \(s\.field\.type !== 'competitor' && \(body\.etEvent \|\| etPortalOfUrl\(body\.url\)\)\)\{ S\.etPageRead = true; save\(\); \}/.test(briefSrc));
check('1.1 an other-portal refusal shows the server\'s sentence on the source row', /if \(isSource\(s\) && err && err\.code === 'other-portal'\)\{\s*return serverSentence\(err\) \|\|/.test(briefSrc));
/* the console look: the new rules use only the page's tokens */
var css = page.slice(page.indexOf('.cat-q{'), page.indexOf('.gb-portal-change{')) + (/\.tpl-carousel-info-head \.tpl-carousel-portal-note\{[^}]*\}/.exec(page) || ['?'])[0];
check('1.1 the new styles use no colour of their own (tokens only, so the dark theme follows)', css.length > 800 && !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css) && css.indexOf('var(--') !== -1, css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi));
check('1.13 the page\'s script parses', (function () { try { new vm.Script(SRC); return true; } catch (e) { return e.message; } })() === true);
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* checked below */ }
check('1.13 esbuild is there to check ES5', !!esbuild);
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 4).join(' '); } })();
  check('1.13 the whole inline script, every changed and added function with it, is ES5 (esbuild target es5)', es5 === true, es5);
}

/* =====================================================================================================
   The page in a vm: a small fake DOM built from the page's own ids (hidden and disabled as in the markup),
   and window.__ce(expr) evaluated inside the script's own scope, to read and stub its functions.
   ===================================================================================================== */
/* every element with an id in a piece of markup: its tag and the attributes the script reads */
function idsIn(html) {
  var out = [], re = /<([a-z0-9]+)\b([^>]*?)\bid="([^"]+)"([^>]*)>/gi, m;
  while ((m = re.exec(html))) {
    var attrs = ' ' + m[2] + ' ' + m[4] + ' ';
    out.push({ id: m[3], tag: m[1], hidden: /\shidden[\s=>]/.test(attrs), disabled: /\sdisabled[\s=>]/.test(attrs),
      type: (/\stype="([^"]+)"/.exec(attrs) || [])[1] || '', placeholder: (/\splaceholder="([^"]*)"/.exec(attrs) || [])[1] || '',
      value: (/\svalue="([^"]*)"/.exec(attrs) || [])[1] || '' });
  }
  return out;
}
var MARKUP = {};
idsIn(page.slice(page.indexOf('<div class="wiz">'), page.indexOf('<script src="editor-store.js">'))).forEach(function (s) { MARKUP[s.id] = s; });
check('the fake DOM is built from the page\'s own markup', Object.keys(MARKUP).length > 100 && MARKUP['cat-portal-list'] && MARKUP['cat-portal-list'].hidden === true &&
  MARKUP['cat-portal'].disabled === true && MARKUP['gb-et-event'].placeholder === 'Choose this event’s portal first');

function load(o) {
  o = o || {};
  var elements = {}, docListeners = {}, winListeners = {};
  var store = {};
  var log = { toasts: [], modals: [], asks: [], phases: [], replaceState: 0, fetched: [], created: [], updated: [], saves: 0 };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  /* an element; spec (from the markup) gives its tag, id and starting state */
  function makeEl(id, tag, spec) {
    var classes = {};
    var el = {
      id: id || '', tagName: String(tag || 'div').toUpperCase(), hidden: false, disabled: false, readOnly: false, value: '', placeholder: '',
      type: '', checked: false, files: null, style: {}, dataset: {}, attrs: {}, listeners: {}, children: [], _parent: null, _owned: [],
      _text: '', _html: '', scrollTop: 0, offsetParent: {}, offsetWidth: 100, offsetHeight: 40, selectionStart: 0, selectionEnd: 0,
      get textContent() { return this._text; }, set textContent(v) { this._owned.forEach(drop); this._owned = []; this._text = String(v == null ? '' : v); this._html = esc(this._text); this.children = []; },
      /* markup set from the script: what had an id under it goes, and each id in the new markup is an element */
      get innerHTML() { return this._html; },
      set innerHTML(v) {
        var self = this;
        this._owned.forEach(drop);
        this._html = String(v == null ? '' : v); this._text = this._html.replace(/<[^>]*>/g, ''); this.children = []; this._owned = [];
        idsIn(this._html).forEach(function (s) { var c = makeEl(s.id, s.tag, s); c._parent = self; self.children.push(c); elements[s.id] = c; self._owned.push(c); });
      },
      get className() { return Object.keys(classes).join(' '); }, set className(v) { classes = {}; String(v).split(/\s+/).filter(Boolean).forEach(function (c) { classes[c] = 1; }); },
      get parentNode() { return this._parent || (this._parent = makeEl('', 'div')); }, set parentNode(v) { this._parent = v; },
      get nextSibling() { var sibs = this.parentNode.children, i = sibs.indexOf(this); return i !== -1 ? sibs[i + 1] || null : null; },
      get firstChild() { return this.children[0] || (this._html ? {} : null); },
      classList: {
        add: function (c) { classes[c] = 1; }, remove: function (c) { delete classes[c]; },
        toggle: function (c, on) { if (on === undefined) on = !classes[c]; if (on) classes[c] = 1; else delete classes[c]; return !!on; },
        contains: function (c) { return !!classes[c]; }
      },
      setAttribute: function (k, v) { this.attrs[k] = String(v); }, getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      removeAttribute: function (k) { delete this.attrs[k]; }, hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
      addEventListener: function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      removeEventListener: function (t, f) { var l = this.listeners[t] || []; var i = l.indexOf(f); if (i !== -1) l.splice(i, 1); },
      focus: function () { doc.activeElement = this; }, blur: function () { if (doc.activeElement === this) doc.activeElement = null; fire(this, 'blur'); },
      click: function () { fire(this, 'click'); }, select: function () {}, setSelectionRange: function () {}, scrollIntoView: function () {}, scrollTo: function () {},
      closest: function () { return this.parentNode; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      appendChild: function (c) { c._parent = this; this.children.push(c); if (c.id) elements[c.id] = c; return c; },
      insertBefore: function (c, ref) {
        if (c._parent){ var old = c._parent.children.indexOf(c); if (old !== -1) c._parent.children.splice(old, 1); }
        c._parent = this; var i = ref ? this.children.indexOf(ref) : -1; if (i === -1) this.children.push(c); else this.children.splice(i, 0, c);
        if (c.id) elements[c.id] = c; return c;
      },
      remove: function () { if (this._parent){ var i = this._parent.children.indexOf(this); if (i !== -1) this._parent.children.splice(i, 1); } },
      contains: function (x) { return x === this || this.children.indexOf(x) !== -1; },
      getBoundingClientRect: function () { return { top: 0, left: 0, width: 100, height: 40, right: 100, bottom: 40 }; }
    };
    if (spec) { el.tagName = spec.tag.toUpperCase(); el.hidden = spec.hidden; el.disabled = spec.disabled; el.type = spec.type; el.placeholder = spec.placeholder; el.value = spec.value; }
    return el;
  }
  function drop(c) { if (c.id && elements[c.id] === c) delete elements[c.id]; c._owned.forEach(drop); }
  function fire(el, type, extra) {
    var ev = Object.assign({ type: type, target: el, key: '', shiftKey: false, preventDefault: function () {}, stopPropagation: function () {} }, extra || {});
    (el.listeners[type] || []).slice().forEach(function (f) { f(ev); });
    if (typeof el['on' + type] === 'function') el['on' + type](ev);
  }
  var doc = {
    readyState: 'loading', activeElement: null, documentElement: makeEl('html'), body: makeEl('body'), head: makeEl('head'),
    /* the page's own elements exist from the start; anything else only once the script has made it */
    getElementById: function (id) { return elements[id] || (Object.prototype.hasOwnProperty.call(MARKUP, id) ? (elements[id] = makeEl(id, MARKUP[id].tag, MARKUP[id])) : null); },
    createElement: function (tag) { return makeEl('', tag); }, createTextNode: function (t) { var n = makeEl('', '#text'); n.textContent = t; return n; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function (t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
    removeEventListener: function (t, f) { var l = docListeners[t] || []; var i = l.indexOf(f); if (i !== -1) l.splice(i, 1); },
    dispatchEvent: function () {}, contains: function () { return true; }
  };
  var ctx = {
    console: { log: function () {}, warn: function () {}, error: console.error },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function (f) { return setTimeout(f, 0); }, cancelAnimationFrame: function () {},
    URL: URL, URLSearchParams: URLSearchParams, Promise: Promise, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, RegExp: RegExp,
    document: doc, navigator: { onLine: true, clipboard: null }, isSecureContext: true,
    location: { search: o.search || '', pathname: '/create-event.html', href: '/create-event.html' + (o.search || ''), reload: function () {}, replace: function () {} },
    history: { replaceState: function () { log.replaceState++; } },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; },
      key: function (i) { return Object.keys(store)[i] || null; }, get length() { return Object.keys(store).length; }
    },
    addEventListener: function (t, f) { (winListeners[t] = winListeners[t] || []).push(f); }, removeEventListener: function () {},
    KeyboardEvent: function (t, x) { this.type = t; Object.assign(this, x || {}); },
    getComputedStyle: function () { return {}; }, matchMedia: function () { return { matches: false, addListener: function () {}, addEventListener: function () {} }; },
    fetch: function (url) { log.fetched.push(String(url)); return Promise.reject(new TypeError('no network in tests')); }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  /* a draft this browser kept: under its own key, and named the one it worked on last (create-event.html, UX-048) */
  if (o.draft) { store['revamp.createEvent.draft.v2.' + o.draft.draftId] = JSON.stringify(o.draft); store['revamp.createEvent.current.v2'] = o.draft.draftId; }
  Object.keys(o.storage || {}).forEach(function (k) { store[k] = o.storage[k]; });
  /* portal-picker.js itself, over a signed-in RevampAuth whose answers are set here (o.api: url -> [status, body]) */
  if (o.realPicker) {
    ctx.RevampAuth = {
      currentUser: function () { return { uid: 'qa-uid' }; },
      authedFetch: function (url, opts) {
        log.fetched.push((opts && opts.method || 'GET') + ' ' + url);
        var a = (o.api || {})[url];
        if (!a) return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve({ ok: a[0] >= 200 && a[0] < 300, status: a[0], text: function () { return Promise.resolve(JSON.stringify(a[1])); } });
      }
    };
    vm.runInNewContext(read('portal-picker.js'), ctx, { filename: 'portal-picker.js' });
  }
  /* portal-picker.js (Unit D), as its contract K9 has it */
  else if (o.portals !== false) {
    ctx.RevampPortals = {
      list: function () { log.listed = (log.listed || 0) + 1; return o.listFails ? Promise.reject(new Error('The portal list could not be loaded.')) : Promise.resolve(ROSTER.map(function (p) { return { slug: p.slug, name: p.name }; })); },
      nameOf: function (slug) { return etEvents.PORTALS[slug] || slug; },
      optionsHtml: function () { return ''; }, chipHtml: function () { return ''; },
      openSetPortal: function (opts) { log.asks.push(opts); },
      cachedWorking: function () { return o.cached === undefined ? null : o.cached; },
      working: function () { return o.server === undefined ? Promise.resolve(o.cached === undefined ? null : o.cached) : (o.serverDelay ? new Promise(function (r) { setTimeout(function () { r(o.server); }, o.serverDelay); }) : Promise.resolve(o.server)); },
      setWorking: function () { return Promise.resolve(); }
    };
  }
  ctx.RevampCore = Object.assign({
    authedFetch: function (url) {
      log.fetched.push(String(url));
      var events = (o.etEvents || {})[String(url)] || [];
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ events: events }); } });
    },
    createEvent: function (body) { log.created.push(JSON.parse(JSON.stringify(body))); return Promise.resolve({ eventId: body.eventId, createdAt: '2026-11-03T10:00:00.000Z' }); },
    updateEvent: function (id, patch) { log.updated.push(JSON.parse(JSON.stringify(patch))); return o.updateFails ? Promise.reject(o.updateFails) : Promise.resolve({ ok: true, updatedAt: 'x' }); },
    fetchEvent: function (id) { log.fetchedEvent = id; return o.storedEvent ? Promise.resolve(Object.assign({ id: id }, o.storedEvent)) : Promise.reject(Object.assign(new Error('That could not be found.'), { status: 404 })); },
    fetchEvents: function () { log.fetchedEvents = (log.fetchedEvents || 0) + 1; return o.eventsFail ? Promise.reject(Object.assign(new Error('Could not reach the server. Check your connection and try again.'), { status: 0 })) : Promise.resolve(o.events || []); }
  }, o.core || {});
  ctx.RevampStore = { get: function () { return Promise.resolve(null); }, put: function () { return Promise.resolve(); }, remove: function () { return Promise.resolve(); } };
  ctx.__log = log;
  var src = SRC.replace(/\}\)\(\);\s*$/, 'window.__ce = function(__x){ return eval(__x); };\n})();');
  vm.runInNewContext(src, ctx, { filename: 'create-event.html#inline' });
  var ce = ctx.__ce;
  /* the page's own dialog, toasts and screen changes, recorded instead of drawn */
  ctx.__fake = {
    toast: function (m, opts) { log.toasts.push({ msg: m, opts: opts || {} }); return function () {}; },
    /* drawn into #modal-root as the page's own dialog is, so its fields and its main button can be found by id */
    openModal: function (opts) {
      log.modals.push(opts);
      doc.getElementById('modal-root').innerHTML = '<div class="modal" role="dialog"><div class="modal-body">' + (opts.body || '') + '</div>' +
        '<button type="button" id="modal-cancel">' + (opts.cancelLabel || 'Cancel') + '</button><button type="button" id="modal-ok">' + (opts.confirm || 'Confirm') + '</button></div>';
    },
    setStep1Phase: function (p) { log.phases.push(p); ce('S').step1Phase = p; },
    noop: function () {}
  };
  ce('toast = window.__fake.toast; openModal = window.__fake.openModal; setStep1Phase = window.__fake.setStep1Phase;' +
     'save = function(){ window.__log.saves++; return true; }; schedulePreview = window.__fake.noop; loadBannerFiles = window.__fake.noop; loadImageFiles = window.__fake.noop;');
  return { ctx: ctx, ce: ce, $: function (id) { return doc.getElementById(id); }, doc: doc, log: log, store: store, fire: fire,
    make: function (id, tag) { var el = makeEl(id, tag); elements[id] = el; return el; },
    docFire: function (type, target) {
    (docListeners[type] || []).slice().forEach(function (f) { f({ type: type, target: target, preventDefault: function () {}, stopPropagation: function () {} }); });
  } };
}

async function main() {
  /* ---------- defaults ---------- */
  var p = load();
  check('the S defaults: basics.portal "", portalSent "", etPageRead false', p.ce('S.basics.portal') === '' && p.ce('S.portalSent') === '' && p.ce('S.etPageRead') === false);
  check('nothing runs before the page has loaded (init waits for DOMContentLoaded)', p.log.listed === undefined && p.log.fetched.length === 0);
  await p.ce('loadPortalRoster()');
  check('the roster is read through RevampPortals.list(), once', p.log.listed === 1 && p.ce('portalRoster').length === ROSTER.length);
  check('isRosterPortal: roster slugs only — never __proto__, toString, a name or a wrong slug',
    p.ce('isRosterPortal("hr")') === true && p.ce('isRosterPortal("cio")') === true && p.ce('isRosterPortal("__proto__")') === false &&
    p.ce('isRosterPortal("toString")') === false && p.ce('isRosterPortal("hasOwnProperty")') === false && p.ce('isRosterPortal("ETHRWorld")') === false &&
    p.ce('isRosterPortal("hrworld")') === false && p.ce('isRosterPortal("gov")') === false && p.ce('isRosterPortal("")') === false && p.ce('isRosterPortal(7)') === false);
  check('portalName gives the roster name', p.ce('portalName("hr")') === 'ETHRWorld' && p.ce('portalName("brandequity")') === 'ET BrandEquity' && p.ce('etPortalName("cio")') === 'ETCIO');
  await p.ce('loadPortalRoster()');
  check('…and it is read only once', p.log.listed === 1);

  /* =====================================================================================================
     2 / 8. The record sends the portal
     ===================================================================================================== */
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.name = "Future of Work Summit"; S.basics.slug = "future-of-work-2027"; S.basics.portal = "hr"; S.template = "tech500"; S.creationMethod = "template"');
  var rec = p.ce('eventRecordFromBasics()');
  check('2. a new event\'s record carries portal "hr" (template)', rec.portal === 'hr' && !('ifPortal' in rec), rec);
  p.ce('S.creationMethod = "brief"');
  rec = p.ce('eventRecordFromBasics()');
  check('2. …and from a brief alike', rec.portal === 'hr' && !('ifPortal' in rec) && !('templateId' in rec), rec);
  p.ce('S.createdEventId = "future-of-work-2027"; S.portalSent = "hr"');
  rec = p.ce('eventRecordFromBasics()');
  check('8. an update with the portal unchanged since it was last sent sends none', !('portal' in rec) && !('ifPortal' in rec), rec);
  p.ce('S.basics.portal = "cio"');
  rec = p.ce('eventRecordFromBasics()');
  check('8. a portal changed here is sent with ifPortal: the one sent last', rec.portal === 'cio' && rec.ifPortal === 'hr', rec);
  p.ce('S.portalSent = ""');
  rec = p.ce('eventRecordFromBasics()');
  check('8. an older draft\'s event, never sent one: ifPortal ""', rec.portal === 'cio' && rec.ifPortal === '', rec);
  check('8. the brief run\'s event facts carry no portal fields of their own', !('portal' in p.ce('briefEventMeta("")')));

  /* createEventRecord against a stand-in RevampCore */
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('currentDetailsIssue = function(){ return ""; }; renderEventExists = function(){}');
  p.ce('S.basics.name = "Future of Work Summit"; S.basics.slug = "future-of-work-2027"; S.basics.portal = "hr"; S.template = "tech500"; S.creationMethod = "template"');
  await p.ce('createEventRecord()');
  check('8. create sends portal "hr", and the draft remembers it was sent', p.log.created.length === 1 && p.log.created[0].portal === 'hr' &&
    p.log.created[0].eventId === 'future-of-work-2027' && p.ce('S.createdEventId') === 'future-of-work-2027' && p.ce('S.portalSent') === 'hr', p.log.created);
  await p.ce('createEventRecord()');
  check('8. the next save (portal unchanged) sends no portal, so a Set portal made meanwhile is not undone', p.log.updated.length === 1 && !('portal' in p.log.updated[0]) && !('ifPortal' in p.log.updated[0]), p.log.updated);
  p.ce('S.basics.portal = "cio"');
  await p.ce('createEventRecord()');
  check('8. a portal changed in the wizard goes with ifPortal "hr", and is then the one sent', p.log.updated[1].portal === 'cio' && p.log.updated[1].ifPortal === 'hr' && p.ce('S.portalSent') === 'cio', p.log.updated[1]);

  /* A Set portal made meanwhile (the server's portal moved from what this draft last sent). The stand-in server
     refuses a save whose ifPortal is not the portal it holds, as PATCH /api/event does (409 portal-changed),
     and otherwise takes the portal sent. */
  function portalServer(holds) {
    var srv = { portal: holds, sent: [] };
    srv.core = { updateEvent: function (id, patch) {
      srv.sent.push(JSON.parse(JSON.stringify(patch)));
      if (typeof patch.ifPortal === 'string' && patch.ifPortal !== srv.portal) {
        var name = etEvents.PORTALS[srv.portal] || '';
        return Promise.reject(Object.assign(new Error('This event\'s portal was changed' + (name ? ' to ' + name : '') + ' meanwhile. Reload to see it.'),
          { status: 409, code: 'portal-changed', current: srv.portal, currentName: name }));
      }
      if (patch.portal) srv.portal = patch.portal;
      return Promise.resolve({ ok: true, updatedAt: 'x' });
    } };
    return srv;
  }
  /* a draft whose event was last sent ETHRWorld, changed here to ETCIO */
  async function movedDraft(srv, extra) {
    var d = load({ core: srv.core });
    await d.ce('loadPortalRoster()');
    d.ce('currentDetailsIssue = function(){ return ""; }; renderEventExists = function(){}');
    d.ce('S.basics.name = "X"; S.basics.slug = "x-2027"; S.createdEventId = "x-2027"; S.basics.portal = "cio"; S.portalSent = "hr"; S.template = "tech500"; S.creationMethod = "template"' + (extra || ''));
    return d;
  }
  var ASK = 'This event’s portal was changed to ETAuto meanwhile. Keep ETAuto, or move it to ETCIO?';
  var srv = portalServer('auto');
  p = await movedDraft(srv);
  var failedWith = await p.ce('createEventRecord()').then(function () { return null; }, function (e) { return e; });
  check('8. a 409 portal-changed stops the step with a question', failedWith && failedWith.message === ASK, failedWith && failedWith.message);
  check('8. …which carries both answers (the portal the event has now, and the one chosen here)', failedWith && failedWith.portalChoice &&
    failedWith.portalChoice.current === 'auto' && failedWith.portalChoice.chosen === 'cio', failedWith && failedWith.portalChoice);
  check('8. …and what this draft last sent stays as it was: nothing is armed for a retry', p.ce('S.portalSent') === 'hr' && srv.portal === 'auto');
  await p.ce('createEventRecord()').then(null, function () {});
  check('8. a plain retry (or Continue on the draft days later) is refused again, so the Set portal made meanwhile stands',
    srv.sent.length === 2 && srv.sent[1].portal === 'cio' && srv.sent[1].ifPortal === 'hr' && srv.portal === 'auto' && p.ce('S.portalSent') === 'hr', srv.sent);
  check('8. an answer that is neither keep nor move, or no question, takes nothing', p.ce('applyPortalChoice({ current: "auto", chosen: "cio" }, "retry")') === false &&
    p.ce('applyPortalChoice(null, "keep")') === false && p.ce('S.portalSent') === 'hr' && p.ce('S.basics.portal') === 'cio');

  /* the hand-off (template and imported designs): the step asks Keep or Move instead of Try again */
  srv = portalServer('auto');
  p = await movedDraft(srv);
  p.ce('runHandoff([{ key: "create", label: "Updating your event", run: createEventRecord }])');
  await tick();
  check('8. the hand-off shows the question with Keep ETAuto and Move it to ETCIO, and no Try again',
    p.$('step-4').innerHTML.indexOf(ASK) !== -1 && p.$('asm-keep') !== null && p.$('step-4').innerHTML.indexOf('id="asm-keep">Keep ETAuto</button>') !== -1 &&
    p.$('asm-move') !== null && p.$('step-4').innerHTML.indexOf('id="asm-move">Move it to ETCIO</button>') !== -1 && p.$('asm-retry') === null && p.$('asm-back') !== null);
  check('8. …Keep is the main button (it undoes nothing)', /class="btn btn-primary btn-sm" type="button" id="asm-keep"/.test(p.$('step-4').innerHTML) &&
    /class="btn btn-secondary btn-sm" type="button" id="asm-move"/.test(p.$('step-4').innerHTML));
  p.$('asm-keep').click();
  await tick();
  check('8. Keep ETAuto: the draft takes ETAuto as its own portal, and as the one the server has', p.ce('S.basics.portal') === 'auto' && p.ce('S.portalSent') === 'auto');
  check('8. …the step runs again and saves without a portal, so ETAuto stands', srv.sent.length === 2 && !('portal' in srv.sent[1]) && !('ifPortal' in srv.sent[1]) &&
    srv.portal === 'auto' && p.$('step-4').innerHTML.indexOf('gb-step-done') !== -1 && p.$('asm-keep') === null, srv.sent);
  check('8. …and says so', p.log.toasts.some(function (t) { return t.msg === 'This event stays on ETAuto.'; }), p.log.toasts);

  srv = portalServer('auto');
  p = await movedDraft(srv);
  p.ce('runHandoff([{ key: "create", label: "Updating your event", run: createEventRecord }])');
  await tick();
  p.$('asm-move').click();
  await tick();
  check('8. Move it to ETCIO: sent against the portal the event has now, and it moves', srv.sent.length === 2 && srv.sent[1].portal === 'cio' && srv.sent[1].ifPortal === 'auto' &&
    srv.portal === 'cio' && p.ce('S.portalSent') === 'cio' && p.ce('S.basics.portal') === 'cio' && p.$('step-4').innerHTML.indexOf('gb-step-done') !== -1, srv.sent);

  /* Keep is taken also where the wizard's own portal is fixed (an ET page was read): the event was moved where
     the lock sends the owner to change it, so the draft follows it, and a pick of the other portal goes */
  srv = portalServer('auto');
  p = await movedDraft(srv, '; S.portalSent = ""; S.etPageRead = true; S.brief.etEvent = { portal: "cio", id: "9", kind: "event", link: "' + CIO_LINK + '" }; S.brief.previous = "' + CIO_LINK + '"');
  check('8. (the draft is locked on ETCIO)', p.ce('portalLocked()') === true);
  failedWith = await p.ce('createEventRecord()').then(function () { return null; }, function (e) { return e; });
  check('8. a locked draft, Keep ETAuto: taken, and the ETCIO pick goes with its notice', p.ce('applyPortalChoice')(failedWith.portalChoice, 'keep') === true &&
    p.ce('S.basics.portal') === 'auto' && p.ce('S.portalSent') === 'auto' && p.ce('S.brief.etEvent') === null && p.ce('S.brief.previous') === '' &&
    p.log.toasts.some(function (t) { return t.msg === 'Portal changed to ETAuto. The previous edition picked on ETCIO was removed.'; }) &&
    !p.log.toasts.some(function (t) { return t.msg === 'This event stays on ETAuto.'; }), p.log.toasts);

  /* set meanwhile to the very portal chosen here: nothing to undo, so nothing is asked */
  srv = portalServer('cio');
  p = await movedDraft(srv);
  failedWith = await p.ce('createEventRecord()').then(function () { return null; }, function (e) { return e; });
  check('8. changed meanwhile to the portal chosen here: saved without asking, and without a portal the second time', failedWith === null &&
    srv.sent.length === 2 && srv.sent[0].ifPortal === 'hr' && !('portal' in srv.sent[1]) && p.ce('S.portalSent') === 'cio' && srv.portal === 'cio', failedWith ? failedWith.message : srv.sent);

  /* changed to a portal this page's roster does not list: it cannot be kept from here, only moved, or reloaded */
  srv = portalServer('gov');
  p = await movedDraft(srv);
  p.ce('runHandoff([{ key: "create", label: "Updating your event", run: createEventRecord }])');
  await tick();
  check('8. a portal this page does not list: only Move it to ETCIO, and the sentence says to reload',
    p.$('asm-keep') === null && p.$('asm-move') !== null && p.$('step-4').innerHTML.indexOf('id="asm-move">Move it to ETCIO</button>') !== -1 &&
    p.$('step-4').innerHTML.indexOf('This event’s portal was changed meanwhile, to one this page does not list. Reload the page to see it, or move it to ETCIO.') !== -1 &&
    p.ce('applyPortalChoice({ current: "", chosen: "cio" }, "keep")') === false && p.ce('S.basics.portal') === 'cio');

  /* the brief run's create row asks the same question */
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "cio"');
  p.ce('renderBriefProgress')({ steps: [
    { key: 'create', label: 'Updating your event', status: 'error', cause: ASK, choice: { current: 'auto', chosen: 'cio' }, startedAt: Date.now(), endedAt: Date.now() },
    { key: 'open', label: 'Opening your site', status: 'pending' }], inputs: { urls: {}, text: '' }, startedAt: Date.now() });
  var briefRow = p.$('step2-brief').innerHTML;
  check('8. the brief run\'s create row: Keep ETAuto and Move it to ETCIO, no Retry', briefRow.indexOf(ASK) !== -1 &&
    briefRow.indexOf('data-step-portal="keep">Keep ETAuto</button>') !== -1 && briefRow.indexOf('data-step-portal="move">Move it to ETCIO</button>') !== -1 &&
    briefRow.indexOf('data-step-retry="create"') === -1, briefRow);
  var briefSrc2 = SRC.slice(SRC.indexOf('function startGenerateFromBrief('), SRC.indexOf('function renderBriefProgress('));
  check('8. …the row keeps the question from the failure, and its answer runs the row again', briefSrc2.indexOf("s.choice = (s.key === 'create' && err && err.portalChoice) || null;") !== -1 &&
    /b = e\.target\.closest\('\[data-step-portal\]'\);\s*if \(b\)\{ answerPortal\(b\.getAttribute\('data-step-portal'\)\); return; \}/.test(briefSrc2) &&
    /if \(!s \|\| s\.status !== 'error' \|\| !s\.choice \|\| !applyPortalChoice\(s\.choice, how\)\) return;\s*runStep\(steps\.indexOf\(s\)\);/.test(briefSrc2));

  /* =====================================================================================================
     3. The first screen: a type is never taken without a portal; the portal is committed with it
     ===================================================================================================== */
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('S.step = 1; S.step1Phase = "category"; stepPortal = ""');
  p.ce('pickCategory("IP")');
  check('3. with no portal in the box, a type card changes nothing and says so', p.ce('S.step1Phase') === 'category' && p.log.phases.length === 0 &&
    p.ce('S.basics.portal') === '' && p.$('cat-portal-error').hidden === false && p.$('cat-portal-error').textContent === 'Choose the portal first.' &&
    p.$('cat-portal').getAttribute('aria-invalid') === 'true');
  p.ce('S.basics.portal = "hr"; S.brief.previous = "' + HR_LINK + '"; S.brief.etEvent = { portal: "hr", kind: "event", id: "4865", title: "NextTech 2026", link: "' + HR_LINK + '", dateLabel: "May 2026" }');
  p.ce('stepPortal = "cio"; pickCategory("Awards")');
  check('3. with ETCIO in the box: the portal and the type are taken together', p.ce('S.basics.portal') === 'cio' && p.ce('S.basics.category') === 'Awards' &&
    p.log.phases[0] === 'method' && p.$('cat-portal-error').hidden === true);
  check('3. the previous edition picked on ETHRWorld is dropped, with its address', p.ce('S.brief.etEvent') === null && p.ce('S.brief.previous') === '' && p.ce('etPick.slug') === 'cio');
  check('3. the toast says so', p.log.toasts.length === 1 && p.log.toasts[0].msg === 'Portal changed to ETCIO. The previous edition picked on ETHRWorld was removed.', p.log.toasts);
  /* a pick on the same portal, and a typed link (no pick), are kept */
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('S.step = 1; S.step1Phase = "category"; S.basics.portal = ""; S.brief.previous = "' + CIO_LINK + '"; S.brief.etEvent = { portal: "cio", kind: "event", id: "9", title: "ETCIO Annual Conclave", link: "' + CIO_LINK + '", dateLabel: "" }');
  p.ce('stepPortal = "cio"; pickCategory("IP")');
  check('3. a first pick of the portal keeps a previous edition of that portal', p.ce('S.basics.portal') === 'cio' && p.ce('S.brief.etEvent.id') === '9' && p.ce('S.brief.previous') === CIO_LINK);
  check('3. …and its toast names the portal with the type', p.log.toasts.length === 1 && p.log.toasts[0].msg === 'ETCIO · IP & Residential Event selected', p.log.toasts);
  /* a type changed later, from the details: the portal stays, and Cancel puts the box back */
  p.ce('S.step1Phase = "details"; S.creationMethod = "template"; changeCategory()');
  check('3. Change opens the first screen on the draft\'s portal', p.ce('S.step1Phase') === 'category' && p.ce('stepPortal') === 'cio' && p.ce('S.catReturnPhase') === 'details');
  p.ce('stepPortal = "hr"; cancelChangeCategory()');
  check('3. Cancel takes nothing: the box goes back to the draft\'s portal', p.ce('S.basics.portal') === 'cio' && p.ce('stepPortal') === 'cio' && p.ce('S.step1Phase') === 'details');
  /* a click while the roster is still on its way is taken once it has come, against the portal it brings */
  p = load({ search: '?new=1&portal=hr' });
  p.ce('queryPortal = "hr"; S.step = 1; S.step1Phase = "category"; startPortal(false); pickCategory("IP")');
  check('3. a type clicked before the roster came waits for it', p.ce('S.basics.portal') === '' && p.log.phases.length === 0);
  await tick();
  check('3. …and is then taken with the portal from the dashboard\'s link', p.ce('S.basics.portal') === 'hr' && p.log.phases[0] === 'method', p.log.phases);
  /* the roster cannot load: the cards keep asking, and the screen says why, with Retry */
  p = load({ listFails: true });
  p.ce('S.step = 1; S.step1Phase = "category"; startPortal(false)');
  await tick();
  p.ce('renderPortalStep()');
  check('3. a roster that cannot load: the notice and Retry', p.$('cat-portal-notice').hidden === false &&
    p.$('cat-portal-notice').innerHTML.indexOf('The portal list could not be loaded.') !== -1 && p.$('cat-portal-notice').innerHTML.indexOf('id="cat-portal-retry"') !== -1 &&
    p.$('cat-portal').disabled === true);
  p.ce('pickCategory("IP")');
  check('3. …and a type card still asks for the portal', p.ce('S.step1Phase') === 'category' && p.$('cat-portal-error').textContent === 'Choose the portal first.');

  /* =====================================================================================================
     The box, the hints and the person's working portal (§5a)
     ===================================================================================================== */
  p = load({ cached: 'hr', server: 'hr' });
  p.ce('S.step = 1; S.step1Phase = "category"; startPortal(false)');
  check('5a. the remembered working portal is painted at once on a new draft', p.ce('stepPortal') === 'hr' && p.ce('stepPortalFrom') === 'working');
  await tick();
  p.ce('renderPortalStep()');
  check('5a. once the roster has come: the box shows ETHRWorld, enabled, with the dashboard hint', p.$('cat-portal').value === 'ETHRWorld' && p.$('cat-portal').disabled === false &&
    p.$('cat-portal-hint').textContent === 'Set from your dashboard. Change it if this event belongs to another portal.', [p.$('cat-portal').value, p.$('cat-portal-hint').textContent]);
  check('5a. the working portal is tagged "Your portal" in the list', p.ce('portalBox') && p.ce('fillPortalBox') && (function () {
    var items = []; p.ce('portalBox.setItems = (function(set){ return function(x){ window.__items = x; return set(x); }; })(portalBox.setItems)'); p.ce('fillPortalBox()');
    items = p.ctx.__items || []; return items.length === ROSTER.length && items.filter(function (i) { return i.tag === 'Your portal'; }).map(function (i) { return i.value; }).join() === 'hr';
  })());
  p.ce('stepPortal = "cio"; stepPortalFrom = ""; stepPortalTouched = true; renderPortalStep()');
  check('5a. another portal than the working one: "listed under ETCIO"', p.$('cat-portal-hint').textContent === 'This event will be listed under ETCIO on the dashboard.');
  p = load({ cached: 'hr', server: 'auto', serverDelay: 30 });
  p.ce('S.step = 1; S.step1Phase = "category"; startPortal(false)');
  await tick();
  check('5a. before the server answers, the cached portal stands', p.ce('stepPortal') === 'hr');
  await new Promise(function (r) { setTimeout(r, 60); }); await tick();
  check('5a. the server\'s working portal wins over the cached one while the box is untouched', p.ce('stepPortal') === 'auto' && p.ce('stepPortalFrom') === 'working');
  p = load({ cached: 'hr', server: 'auto', serverDelay: 30 });
  p.ce('S.step = 1; S.step1Phase = "category"; startPortal(false)');
  await tick();
  p.ce('stepPortal = "cio"; stepPortalTouched = true');
  await new Promise(function (r) { setTimeout(r, 60); }); await tick();
  check('5a. …but never over the owner\'s own choice', p.ce('stepPortal') === 'cio');
  p = load({ cached: 'hr', server: 'all', serverDelay: 10 });
  p.ce('S.step = 1; S.step1Phase = "category"; startPortal(false)');
  await new Promise(function (r) { setTimeout(r, 40); }); await tick();
  check('5a. a server answer of All portals takes away a pre-set made from the cache', p.ce('stepPortal') === '');
  p = load({ search: '?new=1&portal=cio', cached: 'hr', server: 'hr' });
  p.ce('queryPortal = "cio"; S.step = 1; S.step1Phase = "category"; startPortal(false)');
  check('5a. ?portal= is not painted before the roster has checked it', p.ce('stepPortal') === '');
  await tick();
  check('5a. the dashboard link\'s portal comes first, over the working portal', p.ce('stepPortal') === 'cio' && p.ce('stepPortalFrom') === 'query');
  p.ce('renderPortalStep()');
  check('5a. …with the "listed under" hint, as it is not the working portal', p.$('cat-portal-hint').textContent === 'This event will be listed under ETCIO on the dashboard.');
  p = load({ portals: false });
  p.ce('S.step = 1; S.step1Phase = "category"; startPortal(false)');
  await tick();
  check('5a. no portal-picker.js on the page: the roster counts as failed, never guessed', p.ce('portalRoster') === null && p.ce('portalRosterFailed') === true && p.ce('stepPortal') === '');

  /* the box itself: emptied and left is no portal; a typed name that is exactly one portal is taken */
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('S.step = 1; S.step1Phase = "category"; stepPortal = "hr"; renderPortalStep()');
  var box = p.$('cat-portal'), other = p.$('cat-grid');
  check('the box shows the pre-set portal', box.value === 'ETHRWorld' && p.$('cat-portal-list').hidden === true);
  box.focus(); box.value = ''; p.fire(box, 'input');
  check('typing opens the list', p.$('cat-portal-list').hidden === false);
  p.docFire('mousedown', other);
  check('an emptied box left by a click elsewhere is cleared, not put back', box.value === '' && p.ce('stepPortal') === '' && p.ce('stepPortalTouched') === true);
  p.ce('pickCategory("IP")');
  check('…so the type card then asks for the portal', p.$('cat-portal-error').textContent === 'Choose the portal first.' && p.ce('S.step1Phase') === 'category');
  box.focus(); box.value = 'etcio'; p.fire(box, 'input'); p.docFire('mousedown', other);
  check('a typed name that is exactly one portal is taken on leaving', p.ce('stepPortal') === 'cio' && box.value === 'ETCIO' && p.$('cat-portal-error').hidden === true);
  box.focus(); box.value = 'ETHR'; p.fire(box, 'input'); p.docFire('mousedown', other);
  check('an unfinished name that fits several portals puts the chosen one back', p.ce('stepPortal') === 'cio' && box.value === 'ETCIO');
  box.focus(); box.value = 'enterprise'; p.fire(box, 'input'); p.fire(box, 'keydown', { key: 'Tab' });
  check('a name that fits one portal only is taken on Tab too', p.ce('stepPortal') === 'enterpriseai' && box.value === 'ET EnterpriseAI');
  box.focus(); box.value = ''; p.fire(box, 'input'); p.fire(box, 'keydown', { key: 'Escape' });
  check('Escape puts back what was picked (it is not a choice)', p.ce('stepPortal') === 'enterpriseai' && box.value === 'ET EnterpriseAI');
  /* the other boxes of the page keep their old behaviour: an emptied box is put back */
  var tIn = p.make('t-in', 'input'), tList = p.make('t-list', 'ul');
  tList.hidden = true;
  var plain = p.ce('makeCombobox')({ input: tIn, list: tList, empty: 'x', onPick: function () {} });
  plain.setItems([{ value: 'a', label: 'Alpha', text: 'Alpha' }, { value: 'b', label: 'Beta', text: 'Beta' }]);
  plain.setValue('a');
  tIn.focus(); tIn.value = ''; p.fire(tIn, 'input'); p.docFire('mousedown', other);
  check('a combobox without the new options still puts back what was picked', tIn.value === 'Alpha');

  /* =====================================================================================================
     4 / 10 / 11. Drafts: resumed, older, prefilled
     ===================================================================================================== */
  function oldDraft(extra) {
    return Object.assign({ draftId: 'draft-old', savedAt: '2026-10-01T10:00:00.000Z', step: 1, step1Phase: 'details', creationMethod: 'brief', template: null,
      basics: { category: 'IP', name: 'NextTech Summit', slug: 'nexttech-summit', dateMode: 'tbd' },
      brief: { text: '', previous: '', etEvent: null }, sections: [] }, extra || {});
  }
  function resume(o) {
    var x = load(o);
    x.ce('initStep1 = function(){ window.__log.inits = (window.__log.inits || 0) + 1; }; renderFoot = function(){}; renderStep2 = function(){ window.__log.step2 = (window.__log.step2 || 0) + 1; }');
    x.resumed = x.ce('restore()');
    return x;
  }
  p = resume({ draft: oldDraft({ brief: { text: '', previous: CIO_LINK, etEvent: { portal: 'cio', kind: 'event', id: '9', title: 'ETCIO Annual Conclave', link: CIO_LINK, dateLabel: '' } } }) });
  check('4. an older draft restores with no portal ("" for basics.portal and portalSent)', p.resumed === true && p.ce('S.basics.portal') === '' && p.ce('S.portalSent') === '' && p.ce('S.etPageRead') === false);
  p.ce('queryPortal = "auto"; startPortal(true)');
  await tick();
  check('4. …past the first screen with an ET previous edition picked: that pick\'s portal is taken', p.ce('S.basics.portal') === 'cio' && p.log.modals.length === 0);
  check('4. …with the notice', p.log.toasts.some(function (t) { return t.msg === 'Portal set to ETCIO, from the previous edition you picked.'; }), p.log.toasts);
  check('4. …the draft stays on its step, its pick kept, and ?portal= is not used', p.ce('S.step1Phase') === 'details' && p.ce('S.brief.etEvent.id') === '9' && p.ce('stepPortal') === 'cio');

  p = resume({ draft: oldDraft() });
  p.ce('startPortal(true)');
  await tick();
  var ask = p.log.asks[0];
  check('4. without a pick: portal-picker.js\'s Set portal window opens over the step, in its draft mode', p.log.asks.length === 1 && p.log.modals.length === 0 &&
    !ask.eventId && ask.current === '' && ask.eventName === 'NextTech Summit' && typeof ask.onDone === 'function', ask);
  check('4. …saying "Which portal is this event on? Everything you entered is kept."', ask && ask.intro === 'Which portal is this event on? Everything you entered is kept.');
  check('4. …and the draft stays on the details, with no portal', p.ce('S.step1Phase') === 'details' && p.ce('S.basics.portal') === '' && p.log.phases.length === 0);
  ask.onDone('hr', 'ETHRWorld');
  await tick();
  check('4. choosing ETHRWorld sets it, says so, and draws the step again', p.ce('S.basics.portal') === 'hr' && p.log.inits >= 1 &&
    p.log.toasts.some(function (t) { return t.msg === 'Portal set to ETHRWorld.'; }) && p.ce('S.step1Phase') === 'details');
  check('4. …and nothing is sent until the next save, which carries it', p.log.created.length === 0 && p.log.updated.length === 0 && p.ce('eventRecordFromBasics()').portal === 'hr');
  p = resume({ draft: oldDraft() });
  p.ce('startPortal(true)');
  await tick();
  p.log.asks[0].onDone('__proto__', 'x');
  await tick();
  check('4. a choice the roster does not have is not taken', p.ce('S.basics.portal') === '');
  /* closed without a choice: the next action asks again */
  p = resume({ draft: oldDraft() });
  p.ce('startPortal(true)');
  await tick();
  check('4. closed without a choice, the draft is as it was', p.ce('S.basics.portal') === '' && p.log.asks.length === 1);
  var issue = p.ce('detailsIssues()[0]');
  check('4. …Continue finds the portal first', issue && issue.field === 'cat-portal' && issue.message === 'Choose the portal this event belongs to.', issue);
  p.ce('focusProblem(detailsIssues()[0])');
  await tick();
  check('4. …and asks again, over the details', p.log.asks.length === 2 && p.log.asks[1].intro === 'Which portal is this event on? Everything you entered is kept.' && p.ce('S.step1Phase') === 'details');
  /* the event already exists: its stored portal is the truth */
  p = resume({ draft: oldDraft({ createdEventId: 'nexttech-summit', brief: { previous: CIO_LINK, etEvent: { portal: 'cio', kind: 'event', id: '9', title: 'ETCIO Annual Conclave', link: CIO_LINK } } }), storedEvent: { portal: 'hr', name: 'NextTech Summit' } });
  p.ce('startPortal(true)');
  await tick();
  check('4. a draft whose event exists takes the portal the event already has', p.log.fetchedEvent === 'nexttech-summit' && p.ce('S.basics.portal') === 'hr' && p.ce('S.portalSent') === 'hr');
  check('4. …so nothing is sent for it, and the pick on another portal goes', !('portal' in p.ce('eventRecordFromBasics()')) && p.ce('S.brief.etEvent') === null && p.ce('S.brief.previous') === '');
  check('4. …with the notice', p.log.toasts.some(function (t) { return t.msg === 'Portal set to ETHRWorld, the portal this event already has.'; }));
  p = resume({ draft: oldDraft({ createdEventId: 'nexttech-summit', brief: { previous: CIO_LINK, etEvent: { portal: 'cio', kind: 'event', id: '9', title: 'ETCIO Annual Conclave', link: CIO_LINK } } }), storedEvent: { name: 'NextTech Summit' } });
  p.ce('startPortal(true)');
  await tick();
  check('4. an existing event with no portal yet: the pick decides, and is sent with ifPortal ""', p.ce('S.basics.portal') === 'cio' && p.ce('S.portalSent') === '' &&
    p.ce('eventRecordFromBasics()').portal === 'cio' && p.ce('eventRecordFromBasics()').ifPortal === '');
  /* ?portal= never moves a draft that is resumed */
  p = resume({ draft: oldDraft({ step1Phase: 'category', basics: { category: 'IP', name: 'Retail Leaders', slug: 'retail-leaders', portal: 'retail' } }) });
  p.ce('queryPortal = "hr"; startPortal(true)');
  await tick();
  check('4. ?portal= never changes a resumed draft', p.ce('S.basics.portal') === 'retail' && p.ce('stepPortal') === 'retail' && p.log.asks.length === 0);
  p = resume({ draft: oldDraft({ step1Phase: 'category', basics: { category: 'IP', name: 'Retail Leaders', slug: 'retail-leaders' } }), cached: 'auto' });
  p.ce('queryPortal = "hr"; startPortal(true)');
  await tick();
  check('4. …nor pre-sets one that has none (that is for a new draft only)', p.ce('S.basics.portal') === '' && p.ce('stepPortal') === '' && p.log.asks.length === 0);

  /* 10. incoming values that are not on the roster count as none */
  p = load({ search: '?new=1&portal=hrworld' });
  p.ce('queryPortal = "hrworld"; S.step = 1; S.step1Phase = "category"; startPortal(false)');
  await tick();
  check('10. ?portal=hrworld counts as none', p.ce('stepPortal') === '' && p.ce('S.basics.portal') === '');
  p = load({ search: '?new=1&portal=hrworld', cached: 'cio', server: 'cio' });
  p.ce('queryPortal = "hrworld"; S.step = 1; S.step1Phase = "category"; startPortal(false)');
  await tick();
  check('10. …and the working portal is next in line', p.ce('stepPortal') === 'cio' && p.ce('stepPortalFrom') === 'working');
  p = load({ search: '?new=1&portal=__proto__' });
  p.ce('queryPortal = "__proto__"; S.step = 1; S.step1Phase = "category"; startPortal(false)');
  await tick();
  check('10. ?portal=__proto__ counts as none', p.ce('stepPortal') === '');
  p = load();
  p.ce('initStep1 = function(){}; renderFoot = function(){}; renderStep2 = function(){}');
  p.ce('S.step = 1; S.step1Phase = "method"; S.basics.portal = "__proto__"; startPortal(false)');
  await tick();
  check('10. ETB2B AI\'s prefill portal "__proto__" counts as none: the draft is asked', p.ce('S.basics.portal') === '' && p.log.asks.length === 1 && p.ce('S.step1Phase') === 'method');
  p = load();
  p.ce('initStep1 = function(){}; renderFoot = function(){}; renderStep2 = function(){}');
  p.ce('S.step = 1; S.step1Phase = "method"; S.basics.portal = "cio"; startPortal(false)');
  await tick();
  check('10. …a prefill on the roster is kept, and nothing is asked', p.ce('S.basics.portal') === 'cio' && p.log.asks.length === 0 && p.ce('stepPortal') === 'cio');
  p = resume({ draft: oldDraft({ basics: { category: 'IP', name: 'Gov Tech', slug: 'gov-tech', portal: 'gov' } }) });
  check('10. a stored draft\'s "gov" restores as it is…', p.ce('S.basics.portal') === 'gov');
  p.ce('startPortal(true)');
  await tick();
  check('10. …and counts as none once the roster has come: the draft is asked', p.ce('S.basics.portal') === '' && p.log.asks.length === 1);

  /* 11. a draft saved on the old step 2 */
  p = resume({ draft: oldDraft({ step: 2, step1Phase: 'method', creationMethod: null }) });
  p.ce('startPortal(true)');
  await tick();
  check('11. an old step-2 draft with no portal and no pick: asked over its step, which it stays on', p.log.asks.length === 1 &&
    p.ce('S.step') === 2 && p.ce('S.step1Phase') === 'method' && p.log.phases.length === 0);
  /* an open dialog is never replaced by the question at start; the next action asks */
  p = resume({ draft: oldDraft() });
  p.$('modal-root').innerHTML = '<div class="scrim"></div>';
  p.ce('startPortal(true)');
  await tick();
  check('a dialog already open at start is not replaced by the question', p.log.asks.length === 0 && p.ce('S.basics.portal') === '');
  p = resume({ draft: oldDraft() });
  p.make('rv-portal-dialog', 'div');
  p.ce('startPortal(true)');
  await tick();
  check('…nor is a Set portal window already open', p.log.asks.length === 0);
  p = resume({ draft: oldDraft(), portals: false });
  p.ce('startPortal(true)');
  await tick();
  check('without portal-picker.js the draft is not given a guessed portal, and the next action says why', p.log.asks.length === 0 && p.ce('S.basics.portal') === '');
  p.ce('focusProblem(detailsIssues()[0])');
  check('…"The portal list could not be loaded."', p.log.toasts.some(function (t) { return t.msg === 'The portal list could not be loaded. Reload the page and try again.' && t.opts.type === 'error'; }), p.log.toasts);

  /* =====================================================================================================
     5. Clone design: this portal's and this type's events, whose design the wizard can start from
     ===================================================================================================== */
  var ITEMS = [
    { id: 'hr-old', name: 'HR Old', portal: 'hr', category: 'ip', templateId: 'tech500', updatedAt: '2026-09-01T10:00:00.000Z' },
    { id: 'hr-new', name: 'HR New', portal: 'hr', category: 'editorial', templateId: 'retail-leadership-summit', updatedAt: '2026-10-12T10:00:00.000Z' },
    { id: 'hr-imp', name: 'HR Imported', portal: 'hr', category: 'ip', templateId: 'imported-imp-abc123', updatedAt: '2026-10-01T10:00:00.000Z' },
    { id: 'hr-gen', name: 'HR Generated', portal: 'hr', category: 'ip', templateId: 'gen-hr-gen', updatedAt: '2026-10-20T10:00:00.000Z' },
    { id: 'hr-none', name: 'HR No design', portal: 'hr', category: 'ip', templateId: null, updatedAt: '2026-10-21T10:00:00.000Z' },
    { id: 'hr-client', name: 'HR Roundtable', portal: 'hr', category: 'roundtable', templateId: 'tech500', updatedAt: '2026-10-22T10:00:00.000Z' },
    { id: 'hr-awards', name: 'HR Awards', portal: 'hr', category: 'awards', templateId: 'tech500', updatedAt: '2026-10-23T10:00:00.000Z' },
    { id: 'cio-ip', name: 'CIO IP', portal: 'cio', category: 'ip', templateId: 'tech500', updatedAt: '2026-10-24T10:00:00.000Z' },
    { id: 'none-ip', name: 'No portal', portal: '', category: 'ip', templateId: 'tech500', updatedAt: '2026-10-25T10:00:00.000Z' },
    { id: 'mine', name: 'This draft', portal: 'hr', category: 'ip', templateId: 'tech500', updatedAt: '2026-10-26T10:00:00.000Z' },
    { id: 'odd', name: 'Odd type', portal: 'hr', category: '__proto__', templateId: 'tech500', updatedAt: '2026-10-27T10:00:00.000Z' }
  ];
  p = load();
  var cands = p.ce('cloneCandidates')(ITEMS, 'hr', 'IP', 'mine').map(function (x) { return x.id; });
  check('5. same portal and type only; gallery or imported designs only (not a gen- one or none); not its own event; newest first',
    cands.join() === 'hr-new,hr-imp,hr-old', cands);
  check('5. the Custom type gathers client, leadgen, roundtable and virtual', p.ce('cloneCandidates')(ITEMS, 'hr', 'Client', '').map(function (x) { return x.id; }).join() === 'hr-client' &&
    p.ce('cloneCandidates')([{ id: 'v', portal: 'hr', category: 'virtual', templateId: 'tech500' }, { id: 'l', portal: 'hr', category: 'LEADGEN', templateId: 'tech500' }], 'hr', 'Client', '').length === 2);
  check('5. Awards are Awards', p.ce('cloneCandidates')(ITEMS, 'hr', 'Awards', '').map(function (x) { return x.id; }).join() === 'hr-awards');
  check('5. another portal\'s list is its own', p.ce('cloneCandidates')(ITEMS, 'cio', 'IP', '').map(function (x) { return x.id; }).join() === 'cio-ip');
  check('5. no portal, or no list: nothing', p.ce('cloneCandidates')(ITEMS, '', 'IP', '').length === 0 && p.ce('cloneCandidates')(null, 'hr', 'IP', '').length === 0);

  p = load({ events: ITEMS });
  await p.ce('loadPortalRoster()');
  p.ce('S.step = 1; S.step1Phase = "method"; S.basics.portal = "hr"; S.basics.category = "IP"; S.createdEventId = "mine"');
  p.ce('openCloneDesignModal()');
  var m = p.log.modals[0];
  check('5. the dialog: its title and the portal in its sub', m && m.title === 'Clone design from a previous edition' && m.sub === 'Reuse the design of an earlier ETHRWorld event as your starting point.', m);
  check('5. while loading: "Loading ETHRWorld\'s events…", and Continue waits', p.$('clone-body').innerHTML.indexOf('Loading ETHRWorld’s events…') !== -1 && p.$('modal-ok').disabled === true);
  await tick();
  var opts = p.$('clone-body').innerHTML;
  check('5. it reads the real events list (GET /api/events through RevampCore)', p.log.fetchedEvents === 1);
  check('5. each option reads "Name — Template name, updated 12 Oct 2026"', opts.indexOf('<option value="hr-new">HR New — Retail Leadership Summit, updated 12 Oct 2026</option>') !== -1 &&
    opts.indexOf('<option value="hr-imp">HR Imported — Imported design, updated 1 Oct 2026</option>') !== -1 && opts.indexOf('<option value="hr-old">HR Old — TECH500, updated 1 Sep 2026</option>') !== -1 &&
    count(opts, '<option ') === 3 && p.$('modal-ok').disabled === false, opts);
  var used = [];
  p.ce('useTemplate = function(id){ window.__log.used = id; }; applyImportedTemplate = function(id){ window.__log.imported = id; }; showStep2View = function(v){ window.__log.view = v; }; advanceToDetails = function(m){ window.__log.advanced = m; }');
  p.$('clone-event-select').value = 'hr-old';
  m.onConfirm();
  await new Promise(function (r) { setTimeout(r, 5); });
  check('5. Continue on a gallery design runs useTemplate, as today', p.log.used === 'tech500' && p.log.imported === undefined);
  p.$('clone-event-select').value = 'hr-imp';
  m.onConfirm();
  await new Promise(function (r) { setTimeout(r, 5); });
  check('5. Continue on an imported design takes the import\'s own steps', p.log.imported === 'imported-imp-abc123' && p.log.view === 'landing' && p.log.advanced === 'imported' &&
    p.log.toasts.some(function (t) { return t.msg === 'The design of “HR Imported” selected'; }));
  p = load({ events: ITEMS });
  await p.ce('loadPortalRoster()');
  p.ce('S.step = 1; S.step1Phase = "method"; S.basics.portal = "gcc"; S.basics.category = "IP"');
  p.ce('openCloneDesignModal()');
  await tick();
  check('5. a portal with none: the empty sentence, and Continue stays off', p.$('clone-body').innerHTML.indexOf('No ET GCC event has a design this wizard can start from yet. Sites designed by ETB2B AI are not offered here.') !== -1 &&
    p.$('modal-ok').disabled === true, p.$('clone-body').innerHTML);
  check('5. …and it no longer points to the ET previous-edition picker', p.$('clone-body').innerHTML.indexOf('previous edition') === -1);
  p = load({ eventsFail: true });
  await p.ce('loadPortalRoster()');
  p.ce('S.step = 1; S.step1Phase = "method"; S.basics.portal = "hr"; S.basics.category = "IP"; S.createdEventId = "mine"');
  p.ce('openCloneDesignModal()');
  await tick();
  check('5. a failed read: the error and Retry', p.$('clone-body').innerHTML.indexOf('Could not reach the server. Check your connection and try again.') !== -1 &&
    p.$('clone-body').innerHTML.indexOf('id="clone-retry"') !== -1 && typeof p.$('clone-retry').onclick === 'function');
  p.ce('RevampCore.fetchEvents = function(){ return Promise.resolve(' + JSON.stringify(ITEMS) + '); }');
  p.$('clone-retry').onclick();
  await tick();
  check('5. …Retry reads it again', count(p.$('clone-body').innerHTML, '<option ') === 3);
  p = load({ events: ITEMS });
  await p.ce('loadPortalRoster()');
  p.ce('initStep1 = function(){}; renderFoot = function(){}; renderStep2 = function(){}; S.step = 1; S.step1Phase = "method"; S.basics.portal = ""');
  p.ce('openCloneDesignModal()');
  await tick();
  check('5. with no portal yet, it asks for the portal first', p.log.asks.length === 1 && p.log.modals.length === 0 && p.log.fetchedEvents === undefined);
  p.log.asks[0].onDone('hr', 'ETHRWorld');
  await tick(); await new Promise(function (r) { setTimeout(r, 5); }); await tick();
  check('5. …then opens the dialog on that portal', p.ce('S.basics.portal') === 'hr' && p.log.modals.length === 1 &&
    p.log.modals[0].sub === 'Reuse the design of an earlier ETHRWorld event as your starting point.' && p.log.fetchedEvents === 1);

  /* =====================================================================================================
     6. This edition's own URL on another portal
     ===================================================================================================== */
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "hr"');
  check('6. a cio page on an hr event gives the sentence', p.ce('currentLinkIssue')(CIO_LINK) === 'This is an ETCIO page, but this event is on ETHRWorld. Use this event’s own ETHRWorld page, or change the event’s portal.');
  check('6. …written without https:// too', p.ce('currentLinkIssue')('cio.economictimes.indiatimes.com/x') !== '');
  check('6. hr on hr, www, techgig.com and example.com give nothing', [HR_LINK, 'https://www.economictimes.indiatimes.com/x', 'https://economictimes.indiatimes.com/x',
    'https://www.techgig.com/x', 'https://example.com/x', '', 'not a link'].every(function (u) { return p.ce('currentLinkIssue')(u) === ''; }));
  check('6. a TechMonk page reads "a TechMonk page"', p.ce('currentLinkIssue')('https://techmonk.economictimes.indiatimes.com/x').indexOf('This is a TechMonk page,') === 0);
  check('6. an ET host that is not a roster portal gives nothing (the server decides)', p.ce('currentLinkIssue')('https://zzz.economictimes.indiatimes.com/x') === '');
  /* ET runs one site under two names (startup.* is ET Entrepreneur's site): the page's rule is the server's
     own siteOfPortal (api.js), read from its source and run over the same et-footer / et-previous / et-events */
  var siteSrc = /function siteOfPortal\(slug\) \{[\s\S]*?\n\}/.exec(read('functions/lib/api.js'));
  check('6. api.js has its siteOfPortal', !!siteSrc);
  var serverSiteOf = vm.runInNewContext('(' + (siteSrc ? siteSrc[0] : 'function(s){ return s; }') + ')',
    { etFooter: require('./et-footer'), etPrevious: require('./et-previous'), etEvents: etEvents });
  check('6. (the server serves startup as entrepreneur)', serverSiteOf('startup') === 'entrepreneur' && serverSiteOf('entrepreneur') === 'entrepreneur');
  var siteDiffers = [];
  ROSTER.forEach(function (a) {
    ROSTER.forEach(function (b) {
      var url = 'https://' + b.slug + '.economictimes.indiatimes.com/x-summit-2027';
      p.ce('S.basics.portal = "' + a.slug + '"');
      var flagged = p.ce('currentLinkIssue')(url) !== '', refused = serverSiteOf(a.slug) !== serverSiteOf(b.slug);
      if (flagged !== refused) siteDiffers.push(a.slug + ' event, ' + b.slug + ' page');
    });
  });
  check('6. for every pair of roster portals, the page flags exactly the ET pages the server would refuse as another site\'s', siteDiffers.length === 0, siteDiffers);
  p.ce('S.basics.portal = "startup"');
  check('6. an ET Startup event, an entrepreneur.* page: nothing said', p.ce('currentLinkIssue')('https://entrepreneur.economictimes.indiatimes.com/startup-summit-2027') === '');
  p.$('gb-current').value = CIO_LINK;
  p.ce('checkCurrentLink()');
  check('6. (an ETCIO page there shows the warning and the button)', p.$('gb-current-warn').hidden === false && p.$('gb-current-change').hidden === false);
  p.$('gb-current').value = 'https://entrepreneur.economictimes.indiatimes.com/startup-summit-2027';
  p.ce('checkCurrentLink()');
  check('6. …corrected to the entrepreneur.* page: no warning under the box, and no "Change this event\'s portal" button', p.$('gb-current-warn').hidden === true && p.$('gb-current-change').hidden === true);
  check('6. …while an ETCIO page on that event is still said', p.ce('currentLinkIssue')(CIO_LINK) === 'This is an ETCIO page, but this event is on ET Startup. Use this event’s own ET Startup page, or change the event’s portal.');
  p.ce('S.basics.portal = "entrepreneur"');
  check('6. an ET Entrepreneur event, a startup.* page: nothing said', p.ce('currentLinkIssue')('https://startup.economictimes.indiatimes.com/founders-meet') === '');
  p.$('gb-current').value = CIO_LINK;
  p.ce('checkCurrentLink()');
  p.$('gb-current').value = 'https://startup.economictimes.indiatimes.com/founders-meet';
  p.ce('checkCurrentLink()');
  check('6. …and after an ETCIO page, the startup.* page takes the warning and the button down there too', p.$('gb-current-warn').hidden === true && p.$('gb-current-change').hidden === true);
  check('6. the site table is not a portal of its own (etSiteOf of anything else is itself; never __proto__)', p.ce('etSiteOf("cio")') === 'cio' &&
    p.ce('etSiteOf("__proto__")') === '__proto__' && p.ce('etSiteOf("toString")') === 'toString');
  p.ce('S.basics.portal = "hr"');
  p.$('gb-current').value = CIO_LINK;
  p.ce('checkCurrentLink()');
  check('6. on leaving the box: the warning under it, then the Change button', p.$('gb-current-warn').textContent.indexOf('This is an ETCIO page') === 0 && p.$('gb-current-warn').hidden === false &&
    p.$('gb-current-change').hidden === false && p.$('gb-current-warn').nextSibling === p.$('gb-current-change') &&
    (p.$('gb-current').getAttribute('aria-describedby') || '').indexOf('gb-current-warn') !== -1);
  p.$('gb-current').value = HR_LINK;
  p.ce('checkCurrentLink()');
  check('6. corrected to its own portal\'s page: both go', p.$('gb-current-warn').hidden === true && p.$('gb-current-change').hidden === true);
  p.ce('S.etPageRead = true');
  p.$('gb-current').value = CIO_LINK;
  p.ce('checkCurrentLink()');
  check('6. with the portal fixed, no "change the portal" and no button', p.$('gb-current-warn').textContent === 'This is an ETCIO page, but this event is on ETHRWorld. Use this event’s own ETHRWorld page.' &&
    p.$('gb-current-change').hidden === true);
  check('6. competitor links are not checked', SRC.indexOf("$('gb-comp1').onblur") === -1 && SRC.indexOf("$('gb-comp2').onblur") === -1);

  /* =====================================================================================================
     7. validateBasics
     ===================================================================================================== */
  p = load();
  p.ce('S.basics.name = "X Summit"; S.basics.slug = "x-summit"; S.basics.dateMode = "tbd"; S.basics.logo = true; S.basics.portal = ""');
  ['template', 'imported', 'brief'].forEach(function (method) {
    var issues = p.ce('validateBasics("' + method + '")');
    check('7. with no portal the first issue is "Choose the portal this event belongs to." (' + method + ')', issues.length === 1 && issues[0].field === 'cat-portal' &&
      issues[0].message === 'Choose the portal this event belongs to.', issues);
  });
  p.ce('S.basics.portal = "hr"');
  check('7. with one, no portal issue', p.ce('validateBasics("template")').length === 0);
  p.ce('S.basics.portal = "gov"');
  check('7. an off-roster portal before the roster has come: the server decides', p.ce('validateBasics("template")').length === 0);
  await p.ce('loadPortalRoster()');
  check('7. …and once it has: it is no portal', p.ce('validateBasics("template")')[0].field === 'cat-portal');
  p.ce('S.basics.portal = ""; currentDetailsIssue = currentDetailsIssue');
  check('7. the hand-off stops without a portal (currentDetailsIssue)', p.ce('currentDetailsIssue()') === 'Choose the portal this event belongs to.');

  /* =====================================================================================================
     9. Locked once an ET page has been read
     ===================================================================================================== */
  for (var li = 0; li < 2; li++) {
    var how = li === 0 ? 'S.etPageRead = true' : 'S.generatedEventId = "nexttech-summit"', what = li === 0 ? 'a successful source row' : 'a generated site';
    p = load();
    await p.ce('loadPortalRoster()');
    p.ce('S.basics.portal = "hr"; S.step = 1; S.step1Phase = "category"; S.catReturnPhase = "details"; S.creationMethod = "brief"; stepPortal = "hr"; ' + how);
    p.ce('renderPortalStep()');
    check('9. after ' + what + ': the portal is shown as text', p.ce('portalLocked()') === true && p.$('cat-portal-fixed').hidden === false &&
      p.$('cat-portal-fixed').textContent === 'ETHRWorld' && p.$('cat-portal').parentNode.hidden === true);
    check('9. …with where to change it', p.$('cat-portal-hint').textContent === 'This event’s portal is set. To change it, use Basics in the event console.');
    check('9. …commitPortal changes nothing', p.ce('commitPortal("cio")') === null && p.ce('S.basics.portal') === 'hr');
    p.ce('stepPortal = "cio"; pickCategory("Awards")');
    check('9. …and the type can still be changed, the portal staying', p.ce('S.basics.category') === 'Awards' && p.ce('S.basics.portal') === 'hr' && p.log.phases[0] === 'details');
  }
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = ""; S.generatedEventId = "nexttech-summit"');
  check('9. a draft with no portal yet can still be given one', p.ce('portalLocked()') === false && !!p.ce('commitPortal("hr")') && p.ce('S.basics.portal') === 'hr' && p.ce('portalLocked()') === true);
  p.ce('S.basics.portal = "hr"; S.generatedEventId = null; S.etPageRead = false');
  check('9. before any ET page is read, it can be changed freely', p.ce('portalLocked()') === false && !!p.ce('commitPortal("cio")') && p.ce('S.basics.portal') === 'cio');

  /* =====================================================================================================
     The previous-edition picker reads only the event's portal
     ===================================================================================================== */
  var EVENTS_URL = '/api/et/events?portal=hr&kind=award';
  p = load({ etEvents: { '/api/et/events?portal=hr&kind=award': [{ id: '881', kind: 'award', title: 'ETHRWorld Future Skills Awards', link: 'https://hr.economictimes.indiatimes.com/awards/fsa', dateLabel: 'Mar 2026' }] } });
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "hr"; S.basics.category = "Awards"; S.creationMethod = "brief"; S.brief.previous = "' + CIO_LINK + '"; S.brief.etEvent = { portal: "cio", kind: "award", id: "1", title: "ETCIO Awards", link: "' + CIO_LINK + '" }');
  p.ce('wireEtPicker()');
  await tick();
  check('the picker drops a pick from another portal, with its address', p.ce('S.brief.etEvent') === null && p.ce('S.brief.previous') === '' && p.$('gb-previous').value === '');
  check('…and lists the event\'s own portal\'s awards (one read, the portal from the event)', p.log.fetched.filter(function (u) { return u.indexOf('/api/et/') === 0; }).join() === EVENTS_URL, p.log.fetched);
  check('…searching "ETHRWorld\'s awards"', p.$('gb-et-event').placeholder === 'Search ETHRWorld’s awards' && p.$('gb-et-event').disabled === false);
  check('…and never the roster (no /api/et/portals read here)', p.log.fetched.indexOf('/api/et/portals') === -1);
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = ""; S.creationMethod = "brief"; wireEtPicker()');
  check('with no portal yet, the list waits for it', p.$('gb-et-event').disabled === true && p.$('gb-et-event').placeholder === 'Choose this event’s portal first' &&
    p.log.fetched.length === 0 && p.$('gb-et-status').textContent.indexOf('Choose the portal this event belongs to') === 0);
  p = load({ etEvents: { '/api/et/events?portal=cio': [] } });
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "cio"; S.basics.category = "IP"; S.creationMethod = "brief"; wireEtPicker()');
  await tick();
  check('a portal with no ET events says so by name', p.$('gb-et-status').textContent === 'ETCIO has no ET events to pick from. Paste the link to the previous edition instead.');
  p = load({ etEvents: { '/api/et/events?portal=hr': [{ id: '4865', kind: 'event', title: 'NextTech 2026', link: HR_LINK, dateLabel: 'May 2026' }] } });
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "hr"; S.basics.category = "IP"; S.creationMethod = "brief"; wireEtPicker()');
  await tick();
  var evBox = p.$('gb-et-event');
  evBox.focus(); evBox.value = 'next'; p.fire(evBox, 'input'); p.fire(evBox, 'keydown', { key: 'Enter' });
  check('a pick records the event\'s own portal', p.ce('S.brief.etEvent.portal') === 'hr' && p.ce('S.brief.etEvent.id') === '4865' && p.ce('S.brief.previous') === HR_LINK);
  check('…and its chip reads "ETHRWorld · May 2026"', p.$('gb-et-chip-sub').textContent === 'ETHRWorld · May 2026' && p.$('gb-et-chip').hidden === false);

  /* =====================================================================================================
     The details chip, the footer note and init()
     ===================================================================================================== */
  p = load();
  await p.ce('loadPortalRoster()');
  p.ce('S.basics.portal = "hr"; S.basics.category = "IP"; applySmartDefaults()');
  check('the details chip reads "ETHRWorld · IP & Residential Event"', p.$('cat-bar-portal').textContent === 'ETHRWorld' && p.$('cat-bar-name').textContent === 'IP & Residential Event');
  p.ce('renderAiEntry = function(){}; S.step = 1; S.step1Phase = "category"; S.catReturnPhase = null; renderFoot()');
  check('the first screen\'s footer asks for both', p.$('foot-note').textContent === 'Choose the portal and a microsite type to continue.');
  p.ce('S.catReturnPhase = "details"; renderFoot()');
  check('…and while changing them, names what Cancel keeps', p.$('foot-note').textContent === 'Pick a type, or cancel to keep ETHRWorld · IP & Residential Event.');
  p = load({ search: '?new=1&portal=hr' });
  p.ce('start = function(){ window.__log.started = true; }');
  p.ce('init()');
  check('init() keeps ?portal= for a new draft and still tidies the address', p.ce('queryPortal') === 'hr' && p.log.replaceState === 1 && p.log.started === true);

  /* =====================================================================================================
     With portal-picker.js itself (Unit D's), not a stand-in: the roster, the names and the working portal
     ===================================================================================================== */
  if (fs.existsSync(path.join(ROOT, 'portal-picker.js'))) {
    var API = { '/api/et/portals': [200, { portals: ROSTER }], '/api/me/working-portal': [200, { workingPortal: 'cio' }] };
    var CACHE = { 'rv.workingPortal.qa-uid': JSON.stringify({ v: 1, portal: 'hr', name: 'ETHRWorld' }), 'rv.workingPortal': 'qa-uid' };
    p = load({ realPicker: true, api: API, storage: CACHE });
    p.ce('S.step = 1; S.step1Phase = "category"; startPortal(false); renderPortalStep()');
    check('real picker: the cached working portal is painted at once, by its cached name', p.ce('stepPortal') === 'hr' && p.$('cat-portal').value === 'ETHRWorld' && p.$('cat-portal').disabled === true);
    await tick(16);
    check('real picker: the roster comes from GET /api/et/portals, once', p.ce('portalRoster').length === ROSTER.length && p.log.fetched.filter(function (u) { return u === 'GET /api/et/portals'; }).length === 1, p.log.fetched);
    check('real picker: the server\'s working portal wins (ETCIO), the box enabled', p.ce('stepPortal') === 'cio' && p.$('cat-portal').value === 'ETCIO' && p.$('cat-portal').disabled === false &&
      p.$('cat-portal-hint').textContent === 'Set from your dashboard. Change it if this event belongs to another portal.');
    p.ce('pickCategory("IP")');
    check('real picker: the type is taken with it', p.ce('S.basics.portal') === 'cio' && p.log.phases[0] === 'method');
    p = load({ realPicker: true, api: API, storage: CACHE, search: '?new=1&portal=auto' });
    p.ce('queryPortal = "auto"; S.step = 1; S.step1Phase = "category"; startPortal(false)');
    await tick(16);
    check('real picker: the dashboard link\'s portal comes first', p.ce('stepPortal') === 'auto' && p.ce('stepPortalFrom') === 'query');
    p = load({ realPicker: true, api: { '/api/et/portals': [503, { error: 'ET is not answering.' }], '/api/me/working-portal': [200, { workingPortal: null }] } });
    p.ce('S.step = 1; S.step1Phase = "category"; startPortal(false)');
    await tick(16);
    check('real picker: a roster that does not come shows the notice with Retry, and asks for the portal', p.ce('portalRosterFailed') === true &&
      p.$('cat-portal-notice').hidden === false && !!p.$('cat-portal-retry') && p.ce('stepPortal') === '');
    p.ctx.RevampAuth.authedFetch = function (url) {
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(url === '/api/et/portals' ? { portals: ROSTER } : { workingPortal: null })); } });
    };
    p.$('cat-portal-retry').onclick();
    await tick(16);
    check('real picker: Retry reads it again and the box comes back', p.ce('portalRosterFailed') === false && p.ce('portalRoster').length === ROSTER.length &&
      p.$('cat-portal').disabled === false && p.$('cat-portal-notice').hidden === true);
  }

  /* =====================================================================================================
     12. Templates that name a portal
     ===================================================================================================== */
  p = load();
  await p.ce('loadPortalRoster()');
  var ABOUT = p.ce('ABOUT_PORTALS'), HEAD = p.ce('ABOUT_HEADINGS'), TEMPLATES = p.ce('TEMPLATES');
  function squash(s) { return String(s).toLowerCase().replace(/\.com$/, '').replace(/[^a-z0-9]/g, ''); }
  TEMPLATES.forEach(function (t) {
    var dir = path.join(ROOT, 'templates', t.site, 'sections'), heads = [];
    fs.readdirSync(dir).forEach(function (sec) {
      var f = path.join(dir, sec, 'index.html');
      if (!fs.existsSync(f)) return;
      var re = /<h[1-6][^>]*>\s*(About ET[^<]*?)\s*<\/h[1-6]>/gi, mm, html = fs.readFileSync(f, 'utf8');
      while ((mm = re.exec(html))) heads.push(mm[1]);
    });
    var slugs = heads.map(function (h) {
      var name = squash(h.replace(/^About\s+/i, ''));
      var hit = ROSTER.filter(function (r) { return squash(r.name) === name; })[0];
      return hit ? hit.slug : '?' + h;
    });
    var listed = Object.prototype.hasOwnProperty.call(ABOUT, t.id) ? ABOUT[t.id] : [];
    check('12. ' + t.id + ': ABOUT_PORTALS names exactly the portals of its "About ET…" headings (' + (heads.join(', ') || 'none') + ')',
      JSON.stringify(slugs.slice().sort()) === JSON.stringify(listed.slice().sort()), { heads: heads, slugs: slugs, listed: listed });
    check('12. ' + t.id + ': its heading as the card quotes it', heads.length ? heads.indexOf(HEAD[t.id]) !== -1 : !Object.prototype.hasOwnProperty.call(HEAD, t.id), { heads: heads, quoted: HEAD[t.id] });
  });
  check('12. every listed design is a gallery design', Object.keys(ABOUT).every(function (id) { return TEMPLATES.some(function (t) { return t.id === id; }); }));
  p.ce('S.basics.portal = "hr"');
  check('12. on an ETHRWorld event, tech500\'s card warns', p.ce('aboutPortalNote("tech500")') === 'Its “About ETCIO” section is ETCIO’s own text. Edit or remove it for ETHRWorld in the editor.');
  check('12. …cx-leaders-forum\'s quotes its own heading', p.ce('aboutPortalNote("cx-leaders-forum")') === 'Its “About ETBrandEquity.com” section is ET BrandEquity’s own text. Edit or remove it for ETHRWorld in the editor.');
  check('12. making-ai-work has no such section: no warning', p.ce('aboutPortalNote("making-ai-work")') === '');
  p.ce('S.basics.portal = "cio"');
  check('12. on an ETCIO event, tech500 says nothing', p.ce('aboutPortalNote("tech500")') === '' && p.ce('aboutPortalNote("retail-leadership-summit")') !== '');
  p.ce('S.basics.portal = ""');
  check('12. with no portal yet, nothing', p.ce('aboutPortalNote("tech500")') === '');
  p.ce('S.basics.portal = "hr"; renderAboutNote(templateById("tech500"))');
  check('12. the card shows it under the design\'s name', p.$('tpl-carousel-portal-note').hidden === false && p.$('tpl-carousel-portal-note').textContent.indexOf('Its “About ETCIO”') === 0);
  p.ce('renderAboutNote(templateById("making-ai-work"))');
  check('12. …and hides it for a design without one', p.$('tpl-carousel-portal-note').hidden === true);
}

main().then(function () {
  console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}, function (err) {
  console.error('the test itself broke: ' + (err && err.stack || err));
  process.exit(1);
});
