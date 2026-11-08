// node functions/lib/share-preview-ui.test.js — the "Share preview" dialog in the browser (share-preview.js,
// window.RevampSharePreview), as the event console (edit-event.html) and the site editor (custom_editor.html) run it.
// No network and no browser: the file runs in a vm over a small DOM stand-in (elements, events with capture and
// bubble, MutationObserver, focus) and a scripted RevampCore.authedFetch that answers as the routes in
// functions/lib/share-preview.js do. It checks:
//   U.1  the file: ES5, one global, no browser storage, no HTML parsing, the CSS uses only the console's tokens;
//   U.2  the two pages: one button beside Preview, one script after edit-event-core.js, and the server serves it;
//   U.3  the pure helpers (_test): the event id from the address, the dates, the error sentences;
//   U.4  the button copies Preview (hidden in the console until the event loads, disabled in the editor until the
//        canvas mounts) and stays hidden with no event;
//   U.5  the dialog: its words, the list, Create link, Copy (and both fallbacks), Stop sharing and its question,
//        the limit of 20, every error, the keyboard (Esc, Tab inside, focus back), the backdrop, the editor's
//        unsaved-changes note with Save now, and that the link is forgotten when the dialog closes.
'use strict';
process.env.TZ = 'Asia/Kolkata';   // the team's clock: the dates below are written in IST
const fs = require('fs');
const path = require('path');
const vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'share-preview.js'), 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 12); i++) p = p.then(function () { return new Promise(function (ok) { setImmediate(ok); }); }); return p; }

/* ======================================================================================================
   A DOM stand-in: just what share-preview.js and the pages' header use
   ====================================================================================================== */
function makeDom() {
  var observers = [];
  var doc;

  function Node(type, name, ns) {
    this.nodeType = type;
    this.tagName = name ? (ns ? name : name.toUpperCase()) : undefined;
    this.namespaceURI = ns || null;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this.listeners = [];
    this._text = '';
    this._value = '';
  }
  function notify(node, name) {
    observers.forEach(function (o) {
      if (o.node !== node || o.off) return;
      if (o.opts.attributeFilter && o.opts.attributeFilter.indexOf(name) === -1) return;
      Promise.resolve().then(function () { if (!o.off) o.cb([{ type: 'attributes', attributeName: name, target: node }]); });
    });
  }
  Node.prototype = {
    get firstChild() { return this.childNodes[0] || null; },
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; },
    get children() { return this.childNodes.filter(function (c) { return c.nodeType === 1; }); },
    get lastElementChild() { var c = this.children; return c[c.length - 1] || null; },
    appendChild: function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; },
    insertBefore: function (c, ref) {
      if (!ref) return this.appendChild(c);
      if (c.parentNode) c.parentNode.removeChild(c);
      var i = this.childNodes.indexOf(ref); c.parentNode = this; this.childNodes.splice(i, 0, c); return c;
    },
    removeChild: function (c) {
      var i = this.childNodes.indexOf(c);
      if (i === -1) throw new Error('not a child');
      this.childNodes.splice(i, 1); c.parentNode = null;
      if (doc.activeElement && c.contains(doc.activeElement)) doc.activeElement = doc.body;   // as a browser does
      return c;
    },
    contains: function (n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; },
    setAttribute: function (k, v) { this.attrs[k] = String(v); if (k === 'value' && this.tagName === 'INPUT') this._value = String(v); notify(this, k); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    removeAttribute: function (k) { if (this.hasAttribute(k)) { delete this.attrs[k]; notify(this, k); } },
    get textContent() { return this.nodeType === 3 ? this._text : this.childNodes.map(function (c) { return c.textContent; }).join(''); },
    set textContent(v) {
      if (this.nodeType === 3) { this._text = String(v); return; }
      var self = this; this.childNodes.slice().forEach(function (c) { self.removeChild(c); });
      if (v !== '' && v !== null && v !== undefined) this.appendChild(doc.createTextNode(String(v)));
    },
    get className() { return this.getAttribute('class') || ''; },
    set className(v) { this.setAttribute('class', v); },
    get id() { return this.getAttribute('id') || ''; },
    set id(v) { this.setAttribute('id', v); },
    get hidden() { return this.hasAttribute('hidden'); },
    set hidden(v) { if (v) { if (!this.hasAttribute('hidden')) this.setAttribute('hidden', ''); } else this.removeAttribute('hidden'); },
    get disabled() { return this.hasAttribute('disabled'); },
    set disabled(v) { if (v) { if (!this.hasAttribute('disabled')) this.setAttribute('disabled', ''); } else this.removeAttribute('disabled'); },
    get value() { return this._value; },
    set value(v) { this._value = String(v); },
    focus: function () { if (doc.contains(this)) doc.activeElement = this; },
    select: function () { doc.selected = this; },
    click: function () { if (this.disabled) return; dispatch(this, { type: 'click' }); },
    addEventListener: function (type, fn, cap) { this.listeners.push({ type: type, fn: fn, cap: !!cap }); },
    removeEventListener: function (type, fn, cap) { this.listeners = this.listeners.filter(function (l) { return !(l.type === type && l.fn === fn && l.cap === !!cap); }); },
    querySelector: function (sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll: function (sel) {
      var out = [], tests = sel.split(',').map(function (x) { return matcher(x.trim()); });
      (function walk(n) { n.childNodes.forEach(function (c) { if (c.nodeType === 1) { if (tests.some(function (t) { return t(c); })) out.push(c); walk(c); } }); })(this);
      return out;
    }
  };
  /* "[attr]", "[attr=value]", "#id", ".class", "tag" — one simple selector each */
  function matcher(sel) {
    var m;
    if ((m = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(sel))) return function (n) { return n.hasAttribute(m[1]) && (m[2] === undefined || n.getAttribute(m[1]) === m[2]); };
    if ((m = /^#([\w-]+)$/.exec(sel))) return function (n) { return n.getAttribute('id') === m[1]; };
    if ((m = /^\.([\w-]+)$/.exec(sel))) return function (n) { return (' ' + n.className + ' ').indexOf(' ' + m[1] + ' ') !== -1; };
    return function (n) { return n.tagName === sel.toUpperCase(); };
  }
  function dispatch(target, init) {
    var ev = {
      type: init.type, key: init.key, shiftKey: !!init.shiftKey, ctrlKey: !!init.ctrlKey, metaKey: !!init.metaKey,
      target: target, defaultPrevented: false, stopped: false,
      preventDefault: function () { this.defaultPrevented = true; },
      stopPropagation: function () { this.stopped = true; }
    };
    var chain = []; for (var n = target; n; n = n.parentNode) chain.push(n);
    function run(node, phase) {
      node.listeners.slice().forEach(function (l) {
        if (l.type !== ev.type) return;
        if (phase === 'capture' && !l.cap) return;
        if (phase === 'bubble' && l.cap) return;
        l.fn.call(node, ev);
      });
    }
    for (var i = chain.length - 1; i > 0 && !ev.stopped; i--) run(chain[i], 'capture');
    if (!ev.stopped) run(target, 'target');
    for (var j = 1; j < chain.length && !ev.stopped; j++) run(chain[j], 'bubble');
    return ev;
  }

  doc = new Node(9);
  doc.documentElement = doc.appendChild(new Node(1, 'html'));
  doc.head = doc.documentElement.appendChild(new Node(1, 'head'));
  doc.body = doc.documentElement.appendChild(new Node(1, 'body'));
  doc.activeElement = doc.body;
  doc.readyState = 'complete';
  doc.copyCalls = 0;
  doc.copyWorks = true;
  doc.createElement = function (t) { return new Node(1, t); };
  doc.createElementNS = function (ns, t) { return new Node(1, t, ns); };
  doc.createTextNode = function (t) { var n = new Node(3); n._text = String(t); return n; };
  doc.getElementById = function (id) { return doc.querySelector('#' + id); };
  doc.execCommand = function (cmd) { if (cmd === 'copy') { doc.copyCalls++; return doc.copyWorks; } return false; };
  function MutationObserver(cb) { this.cb = cb; }
  MutationObserver.prototype.observe = function (node, opts) { var o = { node: node, opts: opts || {}, cb: this.cb }; this.o = o; observers.push(o); };
  MutationObserver.prototype.disconnect = function () { if (this.o) this.o.off = true; };
  return { document: doc, dispatch: dispatch, MutationObserver: MutationObserver, Node: Node };
}

/* The header both pages share, around the two buttons: .topbar > .topbar-acts > #btn-preview, [data-share-preview] */
function header(dom, opts) {
  var d = dom.document;
  var bar = d.body.appendChild(d.createElement('header')); bar.className = 'topbar';
  var acts = bar.appendChild(d.createElement('span')); acts.className = 'topbar-acts';
  var preview = acts.appendChild(d.createElement('button')); preview.setAttribute('id', 'btn-preview');
  if (opts.previewHidden) preview.hidden = true;
  if (opts.previewDisabled) preview.disabled = true;
  var share = acts.appendChild(d.createElement('button'));
  share.setAttribute('id', 'btn-share-preview'); share.setAttribute('data-share-preview', ''); share.hidden = true;
  share.setAttribute('aria-label', 'Share preview');
  var span = share.appendChild(d.createElement('span')); span.textContent = 'Share preview';
  return { preview: preview, share: share };
}

/* ======================================================================================================
   The server, as functions/lib/share-preview.js answers (§4 of the plan)
   ====================================================================================================== */
var TOKEN = 'Q8xY2vB7nRk0pLm3sTu9wZa4cDe6fGh1jKo5q_rk3Qz';   // 43 characters, as lib/share-token.js makes them
var URL1 = 'https://oneworld.example/s/' + TOKEN;
var NOW = Date.parse('2026-11-03T10:50:00.000Z');          // Tue 3 Nov 2026, 4:20 pm IST: "now" inside every page
function iso(ms) { return new Date(ms).toISOString(); }
/* the page's Date, stopped at NOW, so "today" / "yesterday" do not depend on the day the test runs */
function frozenDate() {
  function D() {
    var a = Array.prototype.slice.call(arguments);
    return a.length ? new (Function.prototype.bind.apply(Date, [null].concat(a)))() : new Date(NOW);
  }
  D.now = function () { return NOW; };
  D.parse = Date.parse; D.UTC = Date.UTC; D.prototype = Date.prototype;
  return D;
}
function link(n, o) {
  o = o || {};
  var made = o.createdAt !== undefined ? o.createdAt : NOW - n * 3600000;
  return {
    id: o.id || ('h' + n + 'x').padEnd(64, '0'), last4: o.last4 || ('L' + n + 'xx').slice(0, 4), label: o.label !== undefined ? o.label : '',
    createdBy: o.createdBy || 'priya@timesinternet.in', createdAt: iso(made), expiresAt: iso(made + 7 * 86400000), madeAtVersion: 3
  };
}
function response(status, body) {
  var text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return { status: status, ok: status >= 200 && status < 300, json: function () { return Promise.resolve().then(function () { return JSON.parse(text); }); } };
}
/* answers: { 'GET list': fn|resp, 'POST create': ..., 'POST stop': ... }; each call is logged */
function server(answers) {
  var log = [];
  function authedFetch(url, opts) {
    var method = (opts && opts.method) || 'GET';
    var body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    var key = method === 'GET' && url.indexOf('/api/event/share-preview?eventId=') === 0 ? 'GET list'
      : method === 'POST' && url === '/api/event/share-preview' ? 'POST create'
      : method === 'POST' && url === '/api/event/share-preview/stop' ? 'POST stop' : method + ' ' + url;
    var entry = { key: key, url: url, body: body, headers: opts && opts.headers };
    log.push(entry);
    var a = answers[key];
    if (typeof a === 'function') a = a(entry, log);
    if (a instanceof Error) return Promise.reject(a);
    if (a && typeof a.then === 'function') return a;
    return Promise.resolve(a || response(500, {}));
  }
  return { authedFetch: authedFetch, log: log };
}

/* A page with share-preview.js loaded. o: { search, editor: { state, save }, server, clipboard, previewHidden, previewDisabled } */
function page(o) {
  o = o || {};
  var dom = makeDom();
  var h = header(dom, o);
  var timers = [];
  var storage = [];
  function trap(name) { return { getItem: function () { storage.push(name); return null; }, setItem: function () { storage.push(name); }, removeItem: function () { storage.push(name); } }; }
  var ctx = {
    document: dom.document, console: console, Promise: Promise, JSON: JSON, Date: frozenDate(), Math: Math,
    location: { search: o.search === undefined ? '?event=brand-world-summit-2026' : o.search, origin: 'https://oneworld.example' },
    navigator: { clipboard: o.clipboard === undefined ? { writeText: function (t) { ctx.copied = t; return Promise.resolve(); } } : o.clipboard },
    MutationObserver: dom.MutationObserver,
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearTimeout: function (id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    localStorage: trap('localStorage'), sessionStorage: trap('sessionStorage'),
    RevampCore: o.noCore ? undefined : { authedFetch: (o.server || server({})).authedFetch },
    RevampAuth: { currentUser: function () { return { email: o.me || 'priya@timesinternet.in' }; } }
  };
  if (o.editor) ctx.RevampTemplateUI = { siteState: o.editor.state, save: o.editor.save };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'share-preview.js' });
  return {
    ctx: ctx, dom: dom, doc: dom.document, preview: h.preview, share: h.share, timers: timers, storage: storage,
    key: function (key, opts) { opts = opts || {}; return dom.dispatch(opts.target || dom.document.activeElement || dom.document.body, { type: 'keydown', key: key, shiftKey: opts.shift }); },
    dialog: function () { return dom.document.querySelector('[role=dialog]'); },
    text: function () { var d = dom.document.querySelector('[role=dialog]'); return d ? d.textContent : ''; },
    buttons: function (label) {
      var d = dom.document.querySelector('[role=dialog]');
      return d ? d.querySelectorAll('button').filter(function (b) { return b.textContent.trim() === label; }) : [];
    },
    input: function () { var d = dom.document.querySelector('[role=dialog]'); return d ? d.querySelector('#rvsp-label') : null; },
    url: function () { var d = dom.document.querySelector('[role=dialog]'); return d ? d.querySelectorAll('input').filter(function (i) { return i.getAttribute('aria-label') === 'The preview link'; })[0] || null : null; },
    status: function () { var d = dom.document.querySelector('[role=dialog]'); return d ? d.querySelector('[role=status]') : null; },
    rows: function () { var d = dom.document.querySelector('[role=dialog]'); return d ? d.querySelectorAll('[data-rvsp-link]') : []; }
  };
}
/* every text and attribute in the document, to look for a link that must be gone */
function everything(node) {
  var out = [];
  (function walk(n) {
    if (n.nodeType === 3) out.push(n._text);
    if (n.nodeType === 1) { Object.keys(n.attrs).forEach(function (k) { out.push(n.attrs[k]); }); if (n.tagName === 'INPUT') out.push(n._value); }
    n.childNodes.forEach(walk);
  })(node);
  return out.join('\n');
}

var LIST2 = { links: [link(1, { label: 'Infosys sponsor team', last4: 'Pm7e' }), link(50, { createdBy: 'asha.rao@timesinternet.in', last4: 'Ab12' })], maxActive: 20, days: 7 };
function created(o) {
  o = o || {};
  return response(200, {
    url: o.url || URL1,
    link: { id: 'n'.repeat(64), last4: TOKEN.slice(-4), label: o.label || '', createdBy: 'priya@timesinternet.in', createdAt: iso(NOW), expiresAt: iso(NOW + 7 * 86400000), madeAtVersion: 12 },
    warnings: o.warnings || []
  });
}

async function main() {
  check('U.0 the test token has the real shape (43 base64url characters)', /^[A-Za-z0-9_-]{43}$/.test(TOKEN), TOKEN.length);

  /* ======== U.1 the file ======== */
  var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  check('U.1 no let', !/\blet\s/.test(code));
  check('U.1 no const', !/\bconst\s/.test(code));
  check('U.1 no arrow functions', code.indexOf('=>') === -1);
  check('U.1 no async / await', !/\basync\b|\bawait\b/.test(code));
  check('U.1 no class', !/\bclass\s/.test(code));
  check('U.1 no template strings', code.indexOf('`') === -1);
  check('U.1 no spread or rest', code.indexOf('...') === -1);
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the regex checks above still run */ }
  check('U.1 esbuild is there to check ES5', !!esbuild);
  if (esbuild) {
    var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('U.1 ES5 by esbuild (no destructuring, shorthand methods, let/const, classes or async)', es5 === true, es5);
  }
  check('U.1 parses', (function () { try { new vm.Script(SRC); return true; } catch (e) { return false; } })());
  check('U.1 never touches browser storage (the link must not outlive the dialog)', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(SRC));
  check('U.1 never parses HTML: no innerHTML / outerHTML / insertAdjacentHTML / document.write', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code));
  check('U.1 never logs (a token in a log is a leak)', !/console\./.test(code));
  check('U.1 says Oneworld 2.0, never Revamp, in what people read', /Oneworld 2\.0/.test(SRC) && !/'[^'\n]*\bRevamp\b[^'\n]*'/.test(code));

  var P0 = page();
  var T = P0.ctx.RevampSharePreview && P0.ctx.RevampSharePreview._test;
  check('U.1 one global, RevampSharePreview, with open() and _test', (function () {
    var known = ['document', 'console', 'Promise', 'JSON', 'Date', 'Math', 'location', 'navigator', 'MutationObserver', 'setTimeout', 'clearTimeout', 'localStorage', 'sessionStorage', 'RevampCore', 'RevampAuth', 'window'];
    var own = Object.keys(P0.ctx).filter(function (k) { return known.indexOf(k) === -1; });
    return own.join() === 'RevampSharePreview' && typeof P0.ctx.RevampSharePreview.open === 'function' && !!T;
  })(), Object.keys(P0.ctx));
  var css = T ? T.CSS : '';
  check('U.1 the CSS is injected once, as <style id="rvsp-css">', P0.doc.head.querySelectorAll('#rvsp-css').length === 1 && P0.doc.head.querySelector('#rvsp-css').textContent === css);
  check('U.1 the CSS has no hex colours', css.length > 500 && !/#[0-9a-f]{3,8}\b/i.test(css), (css.match(/#[0-9a-f]{3,8}\b/ig) || []));
  var ALLOWED = ['--surface', '--surface-2', '--border', '--text', '--text-muted', '--accent', '--accent-soft', '--warn', '--warn-soft', '--ok', '--shadow-lg', '--font-body', '--font-mono'];
  var used = (css.match(/var\((--[\w-]+)/g) || []).map(function (v) { return v.slice(4); });
  check('U.1 the CSS uses only the console\'s tokens (light and dark come with them)', used.length > 10 && used.every(function (v) { return ALLOWED.indexOf(v) !== -1; }),
    used.filter(function (v) { return ALLOWED.indexOf(v) === -1; }));
  check('U.1 the CSS: a bottom sheet below 720px, the header button icon-only there, every control 40px tall',
    /@media \(max-width:720px\)\{\.rvsp-scrim\{align-items:flex-end/.test(css) && /\.topbar \[data-share-preview\]>span\{display:none\}/.test(css) &&
    /\.rvsp-box \.btn\{min-height:40px\}/.test(css) && /\.rvsp-x\{[^}]*width:40px;height:40px/.test(css) && /\.rvsp-input\{[^}]*min-height:40px/.test(css) &&
    /width:min\(560px,calc\(100vw - 32px\)\)/.test(css));
  // the editor's bar has no room for the 142px label: measured, it squeezed the event title to nothing and pushed
  // Publish changes and the account past the window edge on a site with internal pages
  check('U.1 the CSS: in the site editor the header button is icon-only up to a 1440px window (the console keeps its label)',
    /@media \(max-width:1440px\)\{#ed-mode-toggle ~ \[data-share-preview\]>span\{display:none\}#ed-mode-toggle ~ \[data-share-preview\]\{padding-left:10px;padding-right:10px\}\}/.test(css));
  check('U.1 the dialog sits under the editor\'s own dialogs (90) and both pages\' messages (99, 100)', /\.rvsp-scrim\{[^}]*z-index:85/.test(css));

  /* ======== U.2 the two pages ======== */
  [['edit-event.html', 'hero-video-ui.js'], ['custom_editor.html', 'editor-ai-mode.js']].forEach(function (pg) {
    var html = fs.readFileSync(path.join(ROOT, pg[0]), 'utf8');
    var buttons = html.match(/<button\b[^>]*\bdata-share-preview\b[^>]*>/g) || [];
    check('U.2 ' + pg[0] + ': exactly one [data-share-preview] button', buttons.length === 1, buttons.length);
    var b = buttons[0] || '';
    // the console's Share is an item of Preview's menu (owner decision 13: one Preview, not two buttons): "Share preview link…"
    var inMenu = pg[0] === 'edit-event.html';
    check('U.2 ' + pg[0] + ': it is a type=button, starts hidden, and keeps its name as an aria-label', /type="button"/.test(b) && /\shidden(\s|>)/.test(b) &&
      (inMenu ? /aria-label="Share preview link"/.test(b) : /aria-label="Share preview"/.test(b)) && /id="btn-share-preview"/.test(b));
    if (inMenu) {
      var menuAt = html.indexOf('<span class="ev-menu" id="pv-menu" hidden>'), splitAt = html.indexOf('<span class="pv-split" id="pv-split">');
      var liveAt = html.indexOf('id="pv-live"');
      check('U.2 edit-event.html: it is the item after Live site in the menu of Preview\'s arrow, inside Preview\'s own group',
        splitAt > 0 && html.indexOf('id="btn-preview"') > splitAt && html.indexOf('id="btn-preview-more"') > splitAt && menuAt > splitAt &&
        liveAt > menuAt && html.indexOf(b) > liveAt && html.indexOf('</span>', html.indexOf(b)) > html.indexOf(b) &&
        /aria-controls="pv-menu"/.test(html.slice(html.indexOf('id="btn-preview-more"') - 80, menuAt)));
      check('U.2 edit-event.html: its words "Share preview link…" and who it is for are in a <span>, which the menu keeps at every width',
        /<span class="mi-words"><span class="mi-name">Share preview link…<\/span><small id="pv-share-desc">A 7-day link for people without an ET login<\/small><\/span>\s*<\/button>/.test(html.slice(html.indexOf(b))) &&
        /aria-describedby="pv-share-desc"/.test(b) &&
        /\.topbar \.ev-menu \[data-share-preview\] > span\.mi-words\{ display:flex; \}/.test(fs.readFileSync(path.join(ROOT, 'edit-event.css'), 'utf8')));
    } else {
      var prevEnd = html.indexOf('</button>', html.indexOf('id="btn-preview"'));
      var between = html.slice(prevEnd + '</button>'.length, html.indexOf(b));
      check('U.2 ' + pg[0] + ': it comes straight after Preview', prevEnd > 0 && /^\s*(<!--[^]*?-->\s*)?$/.test(between), between.slice(0, 120));
      check('U.2 ' + pg[0] + ': its label "Share preview" is in a <span> (hidden below 720px)', /<span>Share preview<\/span>\s*<\/button>/.test(html.slice(html.indexOf(b))));
    }
    // the editor-only icon rule is keyed to "#ed-mode-toggle ~ [data-share-preview]": in the editor the mode switch
    // must be an earlier sibling of the button (same parent), and the console must not have one or it loses its label
    if (pg[0] === 'custom_editor.html') {
      var toggleAt = html.indexOf('id="ed-mode-toggle"');
      var toggleEnd = html.indexOf('</div>', html.indexOf('data-mode="manual"', toggleAt)) + '</div>'.length;
      var gap = html.slice(toggleEnd, html.indexOf(b)).replace(/<!--[^]*?-->/g, '');
      var depth = 0, lowest = 0;
      (gap.match(/<\/?(div|span)\b/g) || []).forEach(function (t) { depth += t.charAt(1) === '/' ? -1 : 1; if (depth < lowest) lowest = depth; });
      check('U.2 custom_editor.html: the mode switch is an earlier sibling of the button (the icon-only rule needs it)',
        toggleAt > 0 && toggleEnd > toggleAt && html.indexOf(b) > toggleEnd && depth === 0 && lowest === 0, { depth: depth, lowest: lowest });
    } else {
      check('U.2 edit-event.html: no #ed-mode-toggle, so the console keeps the "Share preview" label', html.indexOf('ed-mode-toggle') === -1);
    }
    var tags = html.match(/<script src="share-preview\.js"><\/script>/g) || [];
    check('U.2 ' + pg[0] + ': exactly one share-preview.js script', tags.length === 1 && (html.match(/<script[^>]*share-preview/g) || []).length === 1, tags.length);
    var at = html.indexOf('<script src="share-preview.js">');
    check('U.2 ' + pg[0] + ': the script comes after edit-event-core.js and auth.js', at > html.indexOf('<script src="edit-event-core.js">') && html.indexOf('<script src="edit-event-core.js">') > 0 && at > html.indexOf('<script src="auth.js">'));
    check('U.2 ' + pg[0] + ': the script sits right after ' + pg[1], html.indexOf('<script src="' + pg[1] + '"></script>\n<script src="share-preview.js"></script>') !== -1);
    check('U.2 ' + pg[0] + ': the script comes after the button it wires', at > html.indexOf(b));
  });
  check('U.2 the server sends share-preview.js to the pages', require('./access').isServableFile('share-preview.js') === true);

  /* ======== U.3 the pure helpers ======== */
  check('U.3 eventIdFrom ?event=', T.eventIdFrom('?event=a-b') === 'a-b');
  check('U.3 eventIdFrom ?slug=', T.eventIdFrom('?slug=x') === 'x');
  check('U.3 eventIdFrom: ?event= wins over ?slug=', T.eventIdFrom('?slug=x&event=y') === 'y' && T.eventIdFrom('?event=y&slug=x') === 'y');
  check('U.3 eventIdFrom: among other keys, decoded, trimmed', T.eventIdFrom('?template=tech500&event=brand%2Dworld&x=1') === 'brand-world' && T.eventIdFrom('?event=+abc+') === 'abc');
  check('U.3 eventIdFrom: nothing, or a broken escape, is no event', T.eventIdFrom('') === '' && T.eventIdFrom('?events=x') === '' && T.eventIdFrom('?event=%E0%A4%A') === '' && T.eventIdFrom(null) === '');
  var EXP = '2026-11-10T10:50:00.000Z';   // Tue 10 Nov 2026, 4:20 pm IST
  check('U.3 untilText: a week out names the weekday', T.untilText(EXP, NOW) === 'Works until Tue, 10 Nov, 4:20 pm.', T.untilText(EXP, NOW));
  check('U.3 untilText: today / tomorrow', T.untilText('2026-11-03T15:30:00.000Z', NOW) === 'Works until today, 9:00 pm.' && T.untilText('2026-11-04T03:35:00.000Z', NOW) === 'Works until tomorrow, 9:05 am.',
    [T.untilText('2026-11-03T15:30:00.000Z', NOW), T.untilText('2026-11-04T03:35:00.000Z', NOW)]);
  check('U.3 untilText: midnight and noon read 12 am / 12 pm', T.untilText('2026-11-07T18:30:00.000Z', NOW) === 'Works until Sun, 8 Nov, 12:00 am.' && T.untilText('2026-11-08T06:30:00.000Z', NOW) === 'Works until Sun, 8 Nov, 12:00 pm.',
    [T.untilText('2026-11-07T18:30:00.000Z', NOW), T.untilText('2026-11-08T06:30:00.000Z', NOW)]);
  check('U.3 untilText: across the new year names the year', T.untilText('2027-01-02T04:30:00.000Z', Date.parse('2026-12-28T04:30:00.000Z')) === 'Works until Sat, 2 Jan 2027, 10:00 am.', T.untilText('2027-01-02T04:30:00.000Z', Date.parse('2026-12-28T04:30:00.000Z')));
  check('U.3 untilText: a bad date says nothing', T.untilText('', NOW) === '' && T.untilText('soon', NOW) === '' && T.untilText(undefined, NOW) === '');
  check('U.3 whenText without the weekday, and yesterday', T.whenText(EXP, NOW, false) === '10 Nov, 4:20 pm' && T.whenText('2026-11-02T05:00:00.000Z', NOW) === 'yesterday, 10:30 am', [T.whenText(EXP, NOW, false), T.whenText('2026-11-02T05:00:00.000Z', NOW)]);
  check('U.3 errorText(429, { error }) is the server\'s sentence', T.errorText(429, { error: 'You have made 10 links in 10 minutes. Try again in a few minutes.', code: 'rate-limited' }) === 'You have made 10 links in 10 minutes. Try again in a few minutes.');
  check('U.3 errorText: site-not-saved in the console says where saving happens', T.errorText(409, { error: 'Save the site first: a shared link shows the site as last saved.', code: 'site-not-saved' }, 'console') ===
    'Save the site in the site editor first: a shared link shows the site as last saved.');
  check('U.3 errorText: site-not-saved in the editor is the server\'s sentence', T.errorText(409, { error: 'Save the site first: a shared link shows the site as last saved.', code: 'site-not-saved' }, 'editor') ===
    'Save the site first: a shared link shows the site as last saved.');
  check('U.3 errorText: no sentence -> a plain one, never a status line', T.errorText(0, null) === 'Could not reach the server. Check your connection and try again.' &&
    T.errorText(429, {}) === 'That is a lot of links in a short time. Wait a few minutes and try again.' && T.errorText(502, '<html>Bad gateway</html>') === 'The server had a problem. Please try again.' &&
    T.errorText(409, { code: 'too-many-links' }).indexOf('Stop one you no longer need') !== -1 && T.errorText(401, {}) === 'Your sign-in has expired. Please sign in again.' &&
    T.errorText(418, {}) === 'That could not be done (418). Please try again.');
  check('U.3 errorText: a runaway server sentence is kept short', T.errorText(500, { error: 'x'.repeat(5000) }).length === 300);

  /* ======== U.4 the button copies Preview ======== */
  var C1 = page({ previewHidden: true, server: server({ 'GET list': response(200, LIST2) }) });
  check('U.4 console: hidden while Preview is hidden (no event loaded yet)', C1.share.hidden === true);
  C1.preview.hidden = false;
  await tick();
  check('U.4 console: shown once Preview is', C1.share.hidden === false && C1.share.disabled === false);
  C1.preview.hidden = true;
  await tick();
  check('U.4 console: hidden again when the event fails to load', C1.share.hidden === true);
  var E1 = page({ previewDisabled: true });
  check('U.4 editor: shown but disabled until the canvas mounts', E1.share.hidden === false && E1.share.disabled === true);
  E1.share.click();
  await tick();
  check('U.4 editor: a disabled button opens nothing', !E1.dialog());
  E1.preview.disabled = false;
  await tick();
  check('U.4 editor: enabled once Preview is', E1.share.disabled === false);
  var N1 = page({ search: '?template=tech500' });
  check('U.4 no event in the address (a template on its own): no button', N1.share.hidden === true && N1.share.disabled === true);
  N1.preview.hidden = false;
  await tick();
  check('U.4 ... and it stays hidden whatever Preview does', N1.share.hidden === true);
  check('U.4 RevampSharePreview.open() without an event opens nothing', N1.ctx.RevampSharePreview.open() === false && !N1.dialog());

  /* ======== U.5 the dialog ======== */
  // ---- opening: the words, the list ----
  var srv = server({ 'GET list': response(200, LIST2), 'POST create': function () { return created({ label: 'Infosys sponsor team', warnings: [{ code: 'logo-note', message: 'The logo unit still has a question waiting.' }] }); },
    'POST stop': response(200, { ok: true, id: 'x', changed: true }) });
  var A = page({ server: srv });
  A.share.click();
  var dlg = A.dialog();
  check('U.5 open: a dialog, modal, named by its title and described by its intro', !!dlg && dlg.getAttribute('aria-modal') === 'true' &&
    A.doc.getElementById(dlg.getAttribute('aria-labelledby')).textContent === 'Share a preview' &&
    A.doc.getElementById(dlg.getAttribute('aria-describedby')).textContent.indexOf('Anyone with this link') === 0);
  check('U.5 open: the intro says what a guest sees, and the 7 days', A.text().indexOf('Anyone with this link can see the site as last saved — no sign-in needed. Forms don’t send, and search engines are told to stay away. The link stops working after 7 days, or as soon as you stop sharing it.') !== -1);
  check('U.5 open: focus starts in "Who is it for?"', A.doc.activeElement === A.input() && A.input().getAttribute('maxlength') === '60' &&
    A.doc.querySelector('label').getAttribute('for') === 'rvsp-label' && A.doc.querySelector('label').textContent === 'Who is it for? (optional)');
  check('U.5 open: the list is asked for, for this event', srv.log.length === 1 && srv.log[0].url === '/api/event/share-preview?eventId=brand-world-summit-2026');
  check('U.5 open: "Loading links…" until it answers', A.text().indexOf('Loading links…') !== -1);
  check('U.5 open: no Copy or URL before a link is made', !A.url() && A.buttons('Copy').length === 0);
  await tick();
  check('U.5 list: "Links that work now (2)", one row each', A.text().indexOf('Links that work now (2)') !== -1 && A.rows().length === 2);
  var r0 = A.rows()[0] ? A.rows()[0].textContent : '';
  check('U.5 list: a row says which link, who for, who made it, when, and until when', r0.indexOf('…Pm7e · For Infosys sponsor team') === 0 &&
    r0.indexOf('Made by you · today, 3:20 pm · works until 10 Nov, 3:20 pm') !== -1, r0);
  var r1 = A.rows()[1] ? A.rows()[1].textContent : '';
  check('U.5 list: someone else\'s link names them, and an older date has no day word', r1.indexOf('Made by asha.rao@timesinternet.in · 1 Nov, 2:20 pm · works until 8 Nov, 2:20 pm') !== -1, r1);
  check('U.5 list: each Stop sharing names its link for a screen reader', A.rows()[0].querySelector('button').getAttribute('aria-label') === 'Stop sharing link …Pm7e for Infosys sponsor team');

  // ---- create ----
  A.input().value = '  Infosys   sponsor team  ';
  A.buttons('Create link')[0].click();
  check('U.5 create: the button says Creating… and cannot be pressed twice', A.buttons('Creating…').length === 1 && A.buttons('Creating…')[0].disabled === true);
  A.key('Enter', { target: A.input() });
  await tick();
  var posts = srv.log.filter(function (e) { return e.key === 'POST create'; });
  check('U.5 create: one request, with the event, the label tidied, and this site\'s origin', posts.length === 1 &&
    JSON.stringify(posts[0].body) === JSON.stringify({ eventId: 'brand-world-summit-2026', origin: 'https://oneworld.example', label: 'Infosys sponsor team' }), posts.map(function (p) { return p.body; }));
  check('U.5 create: the link is shown read-only, with Copy', !!A.url() && A.url().value === URL1 && A.url().hasAttribute('readonly') && A.buttons('Copy').length === 1);
  check('U.5 create: focus moves to Copy', A.doc.activeElement === A.buttons('Copy')[0]);
  var t = A.text();
  check('U.5 create: "Works until …" a week out, and later saves show', t.indexOf('Works until Tue, 10 Nov, 4:20 pm. Later saves show up on this link too.') !== -1, t);
  check('U.5 create: "Copy it now" and the fingerprint sentence', t.indexOf('Copy it now — ETB2B EventSphere keeps only a fingerprint of this link, so it can’t be shown again.') !== -1);
  check('U.5 create: the logo notice warning is shown', t.indexOf('The logo unit still has a question waiting.') !== -1);
  check('U.5 create: the status line says it is ready (announced politely)', A.status().textContent === 'Link …k3Qz is ready. Copy it now.' && A.status().getAttribute('aria-live') === 'polite');
  check('U.5 create: the new link tops the list, marked New, and the label box is cleared', A.rows().length === 3 && A.rows()[0].textContent.indexOf('…k3Qz · For Infosys sponsor team') === 0 &&
    A.rows()[0].textContent.indexOf('New') !== -1 && A.text().indexOf('Links that work now (3)') !== -1 && A.input().value === '');
  var openIt = A.dialog().querySelectorAll('a').filter(function (a) { return a.textContent === 'Open it'; })[0];
  check('U.5 create: Open it opens a new tab without telling the site where it came from', !!openIt && openIt.getAttribute('target') === '_blank' && openIt.getAttribute('rel') === 'noopener noreferrer' && openIt.getAttribute('href') === URL1);

  // ---- copy ----
  A.buttons('Copy')[0].click();
  await tick();
  check('U.5 copy: through the clipboard, then "Copied"', A.ctx.copied === URL1 && A.buttons('Copied').length === 1 && A.status().textContent === 'Link copied.');
  var two = A.timers.filter(function (x) { return x.fn && x.ms === 2000; });
  check('U.5 copy: back to "Copy" after 2 s', two.length === 1);
  if (two[0]) two[0].fn();
  check('U.5 copy: ... and it is', A.buttons('Copy').length === 1);

  // ---- the backdrop does not throw away a link that is on screen ----
  A.dom.dispatch(A.dialog().parentNode, { type: 'mousedown' });
  A.dom.dispatch(A.dialog().parentNode, { type: 'click' });
  check('U.5 backdrop: a click outside keeps the dialog while a new link is on screen', !!A.dialog());

  // ---- keyboard: inside, Tab wraps; outside shortcuts do not fire ----
  var reached = 0;
  A.doc.addEventListener('keydown', function () { reached++; });
  A.key('z', { target: A.input() });
  check('U.5 keys typed in the dialog do not reach the page\'s shortcuts (the editor\'s Ctrl+Z)', reached === 0);
  var closeBtn = A.dialog().querySelector('.rvsp-x');
  closeBtn.focus();
  var tabEv = A.key('Tab', { shift: true });
  check('U.5 Tab: Shift+Tab on the first control wraps to the last', tabEv.defaultPrevented && A.doc.activeElement !== closeBtn && A.dialog().contains(A.doc.activeElement));
  A.key('Tab');
  check('U.5 Tab: Tab on the last control wraps to the first (Close)', A.doc.activeElement === closeBtn);

  // ---- stop sharing from the list, with its question ----
  var row1 = A.rows()[1];
  var stop1 = row1.querySelector('button');
  stop1.click();
  row1 = A.rows()[1];
  check('U.5 stop: asks first, in that row, with focus on Keep it', row1.textContent.indexOf('Stop this link? Anyone who opens it will see that it has expired.') !== -1 &&
    A.doc.activeElement && A.doc.activeElement.textContent === 'Keep it' && row1.contains(A.doc.activeElement));
  A.doc.activeElement.click();
  check('U.5 stop: Keep it sends nothing and puts focus back on that Stop sharing', srv.log.filter(function (e) { return e.key === 'POST stop'; }).length === 0 &&
    A.doc.activeElement && A.doc.activeElement.getAttribute('data-rvsp-stop') === LIST2.links[0].id && A.text().indexOf('Stop this link?') === -1);
  A.rows()[1].querySelector('button').click();
  A.key('Escape');
  check('U.5 stop: Esc answers the question (keeps the link) before it closes anything', !!A.dialog() && A.text().indexOf('Stop this link?') === -1);
  A.rows()[1].querySelector('button').click();
  A.buttons('Stop sharing').filter(function (b) { return A.rows()[1].contains(b); })[0].click();
  check('U.5 stop: Stopping… while it is on its way, with focus kept in the dialog', A.buttons('Stopping…').length === 1 && A.buttons('Stopping…')[0].disabled && A.doc.activeElement === A.dialog());
  await tick();
  var stops = srv.log.filter(function (e) { return e.key === 'POST stop'; });
  check('U.5 stop: one request with the event and the link\'s id', stops.length === 1 && JSON.stringify(stops[0].body) === JSON.stringify({ eventId: 'brand-world-summit-2026', id: LIST2.links[0].id }));
  check('U.5 stop: the row goes, the count drops, the status says so', A.rows().length === 2 && A.text().indexOf('Links that work now (2)') !== -1 && A.status().textContent === 'Link …Pm7e stopped.');
  check('U.5 stop: focus moves to the next row\'s Stop sharing', A.doc.activeElement && A.doc.activeElement.getAttribute('data-rvsp-stop') === LIST2.links[1].id);

  // ---- stop the link just made, from its own panel ----
  var made = A.dialog().querySelector('.rvsp-made');
  made.querySelectorAll('button').filter(function (b) { return b.textContent === 'Stop sharing'; })[0].click();
  check('U.5 stop (new link): the question shows in its panel, not in the list', A.dialog().querySelector('.rvsp-made').textContent.indexOf('Stop this link?') !== -1 &&
    A.rows()[0].textContent.indexOf('Stop this link?') === -1);
  A.dialog().querySelector('.rvsp-made').querySelectorAll('button').filter(function (b) { return b.textContent === 'Stop sharing'; })[0].click();
  await tick();
  check('U.5 stop (new link): its panel goes, and its address is nowhere on the page', A.dialog().querySelector('.rvsp-made').hidden === true && everything(A.doc).indexOf(TOKEN) === -1 && A.rows().length === 1);
  check('U.5 stop (new link): the backdrop closes the dialog again now that no link is on screen', (function () {
    A.dom.dispatch(A.dialog().parentNode, { type: 'mousedown' }); A.dom.dispatch(A.dialog().parentNode, { type: 'click' }); return !A.dialog();
  })());
  check('U.5 close: focus goes back to Share preview', A.doc.activeElement === A.share);
  check('U.5 nothing was ever written to browser storage', A.storage.length === 0, A.storage);

  // ---- Esc closes; the link is forgotten; opening again shows none ----
  var srvB = server({ 'GET list': response(200, { links: [], maxActive: 20, days: 7 }), 'POST create': function () { return created(); } });
  var B = page({ server: srvB });
  B.share.click();
  await tick();
  check('U.5 empty list: "No links are shared right now."', B.text().indexOf('No links are shared right now.') !== -1 && B.text().indexOf('Links that work now (0)') !== -1);
  B.buttons('Create link')[0].click();
  await tick();
  check('U.5 create with no label: no label is sent, and the panel names no one', JSON.stringify(srvB.log[1].body) === JSON.stringify({ eventId: 'brand-world-summit-2026', origin: 'https://oneworld.example' }) &&
    B.text().indexOf('Link …k3Qz is ready') !== -1);
  B.key('Escape');
  check('U.5 Esc closes, and focus goes back to the button', !B.dialog() && B.doc.activeElement === B.share);
  check('U.5 closing forgets the link: it is nowhere in the page', everything(B.doc).indexOf(TOKEN) === -1);
  B.key('Escape');
  check('U.5 after closing, Esc is the page\'s again (the listener is gone)', !B.dialog());
  B.share.click();
  await tick();
  check('U.5 opening again: the list is read again, and the old address is not shown', srvB.log.filter(function (e) { return e.key === 'GET list'; }).length === 2 && !B.url() && everything(B.doc).indexOf(TOKEN) === -1);
  B.dialog().querySelector('.rvsp-x').click();
  check('U.5 Close (×) closes', !B.dialog());

  // ---- a create that resolves after the dialog was closed changes nothing ----
  var late; var srvL = server({ 'GET list': response(200, { links: [] }), 'POST create': function () { return new Promise(function (ok) { late = ok; }); } });
  var L = page({ server: srvL });
  L.share.click(); await tick();
  L.buttons('Create link')[0].click();
  L.key('Escape');
  late(created()); await tick();
  check('U.5 a link that arrives after closing is not shown anywhere', !L.dialog() && everything(L.doc).indexOf(TOKEN) === -1);

  // ---- the limit ----
  var full = []; for (var i = 1; i <= 20; i++) full.push(link(i));
  var F = page({ server: server({ 'GET list': response(200, { links: full, maxActive: 20, days: 7 }) }) });
  F.share.click(); await tick();
  check('U.5 limit: with 20 links working, Create link is off and the reason is given', F.buttons('Create link')[0].disabled === true &&
    F.text().indexOf('This event already shares 20 links, the most it can at once. Stop one below to make another.') !== -1);

  // ---- errors ----
  async function failing(answer, o) {
    var P = page(Object.assign({ server: server({ 'GET list': response(200, { links: [] }), 'POST create': answer }) }, o || {}));
    P.share.click(); await tick();
    P.buttons('Create link')[0].click(); await tick();
    return P;
  }
  var e1 = await failing(response(409, { error: 'Save the site first: a shared link shows the site as last saved.', code: 'site-not-saved' }));
  check('U.5 error (console): site-not-saved says to save in the site editor', e1.status().textContent === 'Save the site in the site editor first: a shared link shows the site as last saved.' &&
    /\bis-error\b/.test(e1.status().className) && e1.buttons('Create link')[0].disabled === false && e1.doc.activeElement === e1.input());
  var e2 = await failing(response(429, { error: 'You have made 10 links in 10 minutes. Try again in a few minutes.', code: 'rate-limited' }));
  check('U.5 error: 429 shows the server\'s sentence', e2.status().textContent === 'You have made 10 links in 10 minutes. Try again in a few minutes.');
  var e3 = await failing(new TypeError('Failed to fetch'));
  check('U.5 error: no answer at all says to check the connection', e3.status().textContent === 'Could not reach the server. Check your connection and try again.');
  var e4 = await failing(response(502, '<html>Bad gateway</html>'));
  check('U.5 error: a proxy\'s error page becomes a plain sentence', e4.status().textContent === 'The server had a problem. Please try again.');
  var e5 = await failing(response(200, { ok: true }));
  check('U.5 error: an answer without a link is a failure, not an empty panel', !e5.url() && /\bis-error\b/.test(e5.status().className));
  var e6 = await failing(response(200, { url: 'javascript:alert(1)', link: { id: 'x'.repeat(64), last4: 'abcd' } }));
  check('U.5 error: an address that is not http(s) is never shown or linked', !e6.url() && e6.dialog().querySelectorAll('a').length === 0);
  var e7 = await failing(response(200, { url: '/s/' + TOKEN, link: { id: 'y'.repeat(64), last4: TOKEN.slice(-4), expiresAt: EXP } }));
  check('U.5 a path-only address is shown in full, on this site', !!e7.url() && e7.url().value === 'https://oneworld.example/s/' + TOKEN);
  var e8 = await failing(function () { var err = new Error('You are not signed in. Please sign in and try again.'); err.status = 401; return err; });
  check('U.5 error: the sign-in layer\'s own sentence is kept', e8.status().textContent === 'You are not signed in. Please sign in and try again.');
  var e9 = await failing(response(409, { error: 'This event already has 20 links that work.', code: 'too-many-links' }));
  check('U.5 error: too-many-links reads the list again', e9.text().indexOf('This event already has 20 links that work.') !== -1);
  var noCore = page({ noCore: true });
  noCore.share.click(); await tick();
  check('U.5 error: without the sign-in layer the list says it could not load, with Try again', noCore.text().indexOf('The links could not be loaded. Could not reach the server.') !== -1 && noCore.buttons('Try again').length === 1);

  var tries = 0;
  var R = page({ server: server({ 'GET list': function () { tries++; return tries === 1 ? response(503, {}) : response(200, LIST2); } }) });
  R.share.click(); await tick();
  check('U.5 list error: says so, with Try again', R.text().indexOf('The links could not be loaded. Sharing is not available right now.') !== -1 && R.buttons('Try again').length === 1);
  R.buttons('Try again')[0].focus();
  R.buttons('Try again')[0].click(); await tick();
  check('U.5 list error: Try again reads it again', tries === 2 && R.rows().length === 2);
  check('U.5 list error: focus is not dropped onto the page when Try again is redrawn away', R.dialog().contains(R.doc.activeElement) && R.doc.activeElement !== R.doc.body);

  var stopFails = page({ server: server({ 'GET list': response(200, LIST2), 'POST stop': response(404, { error: 'That link could not be found.' }) }) });
  stopFails.share.click(); await tick();
  stopFails.rows()[0].querySelector('button').click();
  stopFails.buttons('Stop sharing').filter(function (b) { return stopFails.rows()[0].contains(b); })[0].click();
  await tick();
  check('U.5 stop error: the sentence is shown and the list is read again', stopFails.status().textContent === 'That link could not be found.' && stopFails.rows().length === 2);
  check('U.5 stop error (404, gone already): the question closes and focus stays in the dialog after the list is read again', stopFails.text().indexOf('Stop this link?') === -1 &&
    stopFails.dialog().contains(stopFails.doc.activeElement) && stopFails.doc.activeElement === stopFails.input());
  var stopBusy = page({ server: server({ 'GET list': response(200, LIST2), 'POST stop': response(503, {}) }) });
  stopBusy.share.click(); await tick();
  stopBusy.rows()[0].querySelector('button').click();
  stopBusy.buttons('Stop sharing').filter(function (b) { return stopBusy.rows()[0].contains(b); })[0].click();
  await tick();
  check('U.5 stop error (503): the question stays open with focus on Keep it, to try again or keep the link', stopBusy.rows()[0].textContent.indexOf('Stop this link?') !== -1 &&
    stopBusy.doc.activeElement && stopBusy.doc.activeElement.textContent === 'Keep it' && stopBusy.status().textContent === 'Sharing is not available right now. Please try again in a moment.');

  // ---- people's words are text, never markup ----
  var evil = '<img src=x onerror=alert(1)>';
  var X = page({ server: server({ 'GET list': response(200, { links: [link(1, { label: evil, createdBy: '<b>x</b>@timesinternet.in' })] }) }) });
  X.share.click(); await tick();
  check('U.5 a label or an email that looks like HTML is shown as text', X.rows()[0].textContent.indexOf('For ' + evil) !== -1 && X.rows()[0].querySelectorAll('img').length === 0 && X.rows()[0].querySelectorAll('b').length === 0);

  // ---- a second Share preview while open does not open a second dialog ----
  X.ctx.RevampSharePreview.open();
  check('U.5 only one dialog at a time', X.doc.querySelectorAll('[role=dialog]').length === 1);

  // ---- clipboard fallbacks ----
  var K1 = page({ clipboard: { writeText: function () { return Promise.reject(new Error('denied')); } }, server: server({ 'GET list': response(200, { links: [] }), 'POST create': function () { return created(); } }) });
  K1.share.click(); await tick(); K1.buttons('Create link')[0].click(); await tick();
  K1.buttons('Copy')[0].click(); await tick();
  check('U.5 copy: when the clipboard refuses, select-and-copy is tried', K1.doc.copyCalls === 1 && K1.doc.selected === K1.url() && K1.buttons('Copied').length === 1);
  var K2 = page({ clipboard: null, server: server({ 'GET list': response(200, { links: [] }), 'POST create': function () { return created(); } }) });
  K2.doc.copyWorks = false;
  K2.share.click(); await tick(); K2.buttons('Create link')[0].click(); await tick();
  K2.buttons('Copy')[0].click(); await tick();
  check('U.5 copy: when nothing can copy, the link is selected and the person is asked to copy it', K2.status().textContent === 'Select the link and copy it.' &&
    K2.doc.selected === K2.url() && K2.doc.activeElement === K2.url() && K2.buttons('Copy').length === 1);

  // ---- the editor: unsaved changes, Save now ----
  var st = { info: { savedVersion: 4 }, dirty: true };
  var saveCalls = 0, saveAnswer = 'ok';
  var srvED = server({ 'GET list': response(200, { links: [] }), 'POST create': response(409, { error: 'Save the site first: a shared link shows the site as last saved.', code: 'site-not-saved' }) });
  var ED = page({
    search: '?slug=brand-world-summit-2026',
    editor: {
      state: function () { return st; },
      save: function () { saveCalls++; if (saveAnswer === 'fail') return Promise.reject(new Error('conflict')); st = { info: { savedVersion: 5 }, dirty: false }; return Promise.resolve({ version: 5 }); }
    },
    server: srvED
  });
  ED.share.click(); await tick();
  check('U.5 editor: the event id comes from ?slug=', srvED.log[0] && srvED.log[0].url === '/api/event/share-preview?eventId=brand-world-summit-2026');
  var note = ED.dialog().querySelector('.rvsp-note');
  check('U.5 editor: unsaved changes are named, with the version a guest will see', !note.hidden && note.textContent.indexOf('You have unsaved changes. The link shows version 4, the last one saved.') !== -1 && ED.buttons('Save now').length === 1);
  check('U.5 editor: making a link is still possible (it shows version 4)', ED.buttons('Create link')[0].disabled === false);
  saveAnswer = 'fail';
  ED.buttons('Save now')[0].click();
  check('U.5 editor: Save now says Saving… and cannot be pressed twice', ED.buttons('Saving…').length === 1 && ED.buttons('Saving…')[0].disabled === true);
  await tick();
  check('U.5 editor: a failed save keeps the note and lets Save now be pressed again', saveCalls === 1 && ED.buttons('Save now').length === 1 && ED.buttons('Save now')[0].disabled === false && !ED.dialog().querySelector('.rvsp-note').hidden);
  saveAnswer = 'ok';
  ED.buttons('Save now')[0].click(); await tick();
  check('U.5 editor: once saved, the note goes and the status says the version', saveCalls === 2 && ED.dialog().querySelector('.rvsp-note').hidden === true &&
    ED.status().textContent === 'Saved as version 5. Shared links show it now.' && ED.doc.activeElement === ED.input());
  ED.buttons('Create link')[0].click(); await tick();
  check('U.5 editor: site-not-saved there is the server\'s own sentence', ED.status().textContent === 'Save the site first: a shared link shows the site as last saved.');

  var never = { info: { savedVersion: 0 }, dirty: true };
  var EN = page({ search: '?event=new-event', editor: { state: function () { return never; }, save: function () { never = { info: { savedVersion: 1 }, dirty: false }; return Promise.resolve({ version: 1 }); } },
    server: server({ 'GET list': response(200, { links: [] }) }) });
  EN.share.click(); await tick();
  check('U.5 editor: a site never saved says so, and Create link waits for Save', EN.text().indexOf('This site has not been saved yet. Save it first: a shared link shows the site as last saved.') !== -1 &&
    EN.buttons('Create link')[0].disabled === true && EN.doc.activeElement === EN.dialog().querySelector('.rvsp-x'));
  EN.buttons('Save now')[0].click(); await tick();
  check('U.5 editor: after Save now, Create link is on', EN.buttons('Create link')[0].disabled === false && EN.dialog().querySelector('.rvsp-note').hidden === true);

  var EU = page({ editor: { state: function () { return { info: null, dirty: true }; }, save: function () { return Promise.resolve({}); } }, server: server({ 'GET list': response(200, { links: [] }) }) });
  EU.share.click(); await tick();
  check('U.5 editor: while the saved state is still being read, no note guesses', EU.dialog().querySelector('.rvsp-note').hidden === true);
  var CN = page({ server: server({ 'GET list': response(200, { links: [] }) }) });
  CN.share.click(); await tick();
  check('U.5 console: the note stays hidden', CN.dialog().querySelector('.rvsp-note').hidden === true && CN.buttons('Save now').length === 0);

  // ---- another dialog on top (the editor asking before it saves over someone's version) keeps its keys ----
  var top = CN.doc.createElement('div'); top.className = 'scrim';
  CN.doc.body.appendChild(top);
  CN.doc.activeElement = CN.doc.body;
  CN.key('Escape');
  check('U.5 a page dialog opened on top keeps Esc for itself', !!CN.dialog());
  CN.doc.body.removeChild(top);
  CN.key('Escape');
  check('U.5 ... and once it is gone, Esc closes this one', !CN.dialog());

  console.log('share-preview-ui.test.js: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
}

main().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
