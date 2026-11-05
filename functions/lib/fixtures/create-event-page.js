// The Create Event page (create-event.html) in a vm, for tests: its main inline script runs over a small fake DOM built
// from the page's own ids (hidden, disabled, type and value as in the markup), with RevampPortals, RevampCore, RevampStore and
// the page's own dialog and toasts stubbed (o.core adds or replaces RevampCore calls; o.globals puts more on window before the
// script runs, such as a RevampCreateDrafts and a RevampAuth; o.keepSave leaves the page's own save()). window.__ce(expr) is evaluated inside
// the script's own scope, to read and stub its functions. The same loader as create-event-portal.test.js's, kept here so
// more than one test can use it. No network, no Firebase, no browser, no AI.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var etEvents = require('../et-events');
var ROOT = path.join(__dirname, '..', '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
var page = read('create-event.html');
var inline = (page.match(/<script>([\s\S]*?)<\/script>/g) || []).map(function (s) { return s.replace(/^<script>|<\/script>$/g, ''); });
var SRC = inline.filter(function (s) { return s.indexOf("var DRAFT_PREFIX = 'revamp.createEvent.draft.v2.'") !== -1; })[0] || '';
var ROSTER = etEvents.portalList();

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
      _text: '', _html: '', scrollTop: 0, offsetParent: {}, offsetWidth: 100, offsetHeight: 40, selectionStart: 0, selectionEnd: 0, validity: { badInput: false },
      get nextElementSibling() { var sibs = this.parentNode.children, i = sibs.indexOf(this); return i !== -1 ? sibs[i + 1] || null : null; },
      get textContent() { return this._text; }, set textContent(v) { this._owned.forEach(drop); this._owned = []; this._text = String(v == null ? '' : v); this._html = esc(this._text); this.children = []; },
      /* markup set from the script: what had an id under it goes, and each id in the new markup is an element */
      get innerHTML() { return this._html; },
      set innerHTML(v) {
        var self = this;
        this._owned.forEach(drop);
        this._html = String(v == null ? '' : v); this._text = this._html.replace(/<[^>]*>/g, ''); this.children = []; this._owned = [];
        idsIn(this._html).forEach(function (s) {
          var c = makeEl(s.id, s.tag, s); c._parent = self; self.children.push(c); elements[s.id] = c; self._owned.push(c);
          /* its own words, for a test that reads a button the script wrote (a label with no markup inside) */
          var open = new RegExp('<' + s.tag + '\\b[^>]*\\bid="' + s.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>', 'i').exec(self._html);
          if (open) { var from = open.index + open[0].length, to = self._html.indexOf('</' + s.tag, from); if (to !== -1) c._text = self._html.slice(from, to).replace(/<[^>]*>/g, ''); }
        });
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
  Object.keys(o.globals || {}).forEach(function (k) { ctx[k] = o.globals[k]; });
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
     (o.keepSave ? '' : 'save = function(){ window.__log.saves++; return true; };') +
     'schedulePreview = window.__fake.noop; loadBannerFiles = window.__fake.noop; loadImageFiles = window.__fake.noop;');
  return { ctx: ctx, ce: ce, $: function (id) { return doc.getElementById(id); }, doc: doc, log: log, store: store, fire: fire,
    winFire: function (type, ev) { (winListeners[type] || []).slice().forEach(function (f) { f(Object.assign({ type: type }, ev || {})); }); },
    make: function (id, tag) { var el = makeEl(id, tag); elements[id] = el; return el; },
    docFire: function (type, target) {
    (docListeners[type] || []).slice().forEach(function (f) { f({ type: type, target: target, preventDefault: function () {}, stopPropagation: function () {} }); });
  } };
}


module.exports = { load: load, page: page, SRC: SRC, MARKUP: MARKUP, idsIn: idsIn, read: read, ROOT: ROOT };
