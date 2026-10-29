// node functions/lib/promo-posts.test.js — Promotions → Site-look posts (promo-posts.js) and the kit it draws with
// (promo-kit.js): the gallery's previews of what an event cannot make yet (example content for a missing list, the
// real post with a chip for a missing fact, owner decision B), the full-size view, the guards that keep example
// content out of every download and save, the mail banner's drawing (owner decision C: the Save-the-date
// composition at 750 px, the dark/light ground and the logo copy it takes), RevampPromo.toPng's options, and that
// both files are ES5. No browser and no network: the two files run in a vm over a small stand-in DOM (HTML parsed
// by htmlparser2; every layout size is 0 unless a check says otherwise) with RevampAuth, RevampCore, fetch,
// document.fonts and html-to-image stubbed.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var htmlparser2 = require('htmlparser2');

var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
var KIT_SRC = read('promo-kit.js'), POSTS_SRC = read('promo-posts.js');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 20); i++) p = p.then(function () { return new Promise(function (ok) { setImmediate(ok); }); }); return p; }
/* waits (a few seconds at most) until cond() holds */
function until(cond) {
  var tries = 0;
  return new Promise(function (resolve) {
    (function again() {
      if (cond() || ++tries > 600) { resolve(!!cond()); return; }
      setTimeout(again, 5);
    })();
  });
}

/* ===================================================================== a stand-in DOM */
var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
function kebab(k) { return k.indexOf('--') === 0 ? k : k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function makeStyle() {
  var props = {}, order = [];
  function put(k, v) {
    k = kebab(k); v = String(v == null ? '' : v);
    if (v === '') { delete props[k]; order = order.filter(function (x) { return x !== k; }); return; }
    if (!(k in props)) order.push(k);
    props[k] = v;
  }
  function parse(css) {
    props = {}; order = [];
    String(css || '').split(';').forEach(function (d) { var i = d.indexOf(':'); if (i > 0) put(d.slice(0, i).trim(), d.slice(i + 1).trim()); });
  }
  var api = { setProperty: function (k, v) { put(k, v); }, removeProperty: function (k) { put(k, ''); }, getPropertyValue: function (k) { return props[kebab(k)] || ''; }, _parse: parse };
  return new Proxy(api, {
    get: function (t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in api) return api[k];
      if (k === 'cssText') return order.map(function (x) { return x + ':' + props[x]; }).join(';');
      return props[kebab(k)] || '';
    },
    set: function (t, k, v) { if (k === 'cssText') parse(v); else put(k, v); return true; }
  });
}
function Text(doc, v) { this.nodeType = 3; this.nodeName = '#text'; this.nodeValue = String(v); this.parentNode = null; this.ownerDocument = doc; }
Object.defineProperty(Text.prototype, 'textContent', { get: function () { return this.nodeValue; }, set: function (v) { this.nodeValue = String(v); } });
function El(doc, tag) {
  this.nodeType = 1; this.ownerDocument = doc;
  this.localName = String(tag).toLowerCase(); this.tagName = this.nodeName = this.localName.toUpperCase();
  this.attrs = {}; this.attrOrder = []; this.childNodes = []; this.parentNode = null; this.style = makeStyle();
}
var E = El.prototype;
function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
E.getAttribute = function (k) {
  k = String(k).toLowerCase();
  if (k === 'style') return this.style.cssText || (own(this.attrs, 'style') ? '' : null);
  return own(this.attrs, k) ? this.attrs[k] : null;
};
E.setAttribute = function (k, v) {
  k = String(k).toLowerCase(); v = String(v);
  if (!own(this.attrs, k)) this.attrOrder.push(k);
  this.attrs[k] = v;
  if (k === 'style') this.style._parse(v);
  if (this.ownerDocument && this.ownerDocument._onAttr) this.ownerDocument._onAttr(this, k, v);
};
E.removeAttribute = function (k) { k = String(k).toLowerCase(); delete this.attrs[k]; this.attrOrder = this.attrOrder.filter(function (x) { return x !== k; }); if (k === 'style') this.style._parse(''); };
E.hasAttribute = function (k) { return own(this.attrs, String(k).toLowerCase()); };
Object.defineProperty(E, 'id', { get: function () { return this.getAttribute('id') || ''; }, set: function (v) { this.setAttribute('id', v); } });
Object.defineProperty(E, 'className', { get: function () { return this.getAttribute('class') || ''; }, set: function (v) { this.setAttribute('class', v); } });
Object.defineProperty(E, 'children', { get: function () { return this.childNodes.filter(function (c) { return c.nodeType === 1; }); } });
Object.defineProperty(E, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
Object.defineProperty(E, 'parentElement', { get: function () { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; } });
function detach(n) { if (n.parentNode) n.parentNode.removeChild(n); }
E.appendChild = function (n) { detach(n); n.parentNode = this; this.childNodes.push(n); return n; };
E.insertBefore = function (n, ref) {
  if (!ref) return this.appendChild(n);
  detach(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n;
};
function sibling(n, d) { if (!n.parentNode) return null; var s = n.parentNode.childNodes; return s[s.indexOf(n) + d] || null; }
Object.defineProperty(E, 'nextSibling', { get: function () { return sibling(this, 1); } });
Object.defineProperty(Text.prototype, 'nextSibling', { get: function () { return sibling(this, 1); } });
E.removeChild = function (n) { var i = this.childNodes.indexOf(n); if (i !== -1) { this.childNodes.splice(i, 1); n.parentNode = null; } return n; };
E.remove = function () { detach(this); };
E.contains = function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; };
E.focus = function () { if (this.ownerDocument) this.ownerDocument.activeElement = this; };
E.click = function () { if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault: function () {} }); };
E.getBoundingClientRect = function () { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; };
E.getClientRects = function () { var d = this.ownerDocument; return d && d.documentElement.contains(this) ? [{}] : []; };
['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'offsetWidth', 'offsetHeight'].forEach(function (p) {
  Object.defineProperty(E, p, { get: function () { var d = this.ownerDocument; return d && d._layout ? +d._layout(this, p) || 0 : 0; } });
});
Object.defineProperty(E, 'textContent', {
  get: function () { return this.childNodes.map(function (c) { return c.textContent; }).join(''); },
  set: function (v) { this.childNodes.forEach(function (c) { c.parentNode = null; }); this.childNodes = []; if (String(v)) this.appendChild(new Text(this.ownerDocument, v)); }
});
function serialize(n) {
  if (n.nodeType === 3) return escText(n.nodeValue);
  var a = n.attrOrder.slice();
  if (n.style.cssText && a.indexOf('style') === -1) a.push('style');
  var attrs = a.map(function (k) { var v = n.getAttribute(k); return v == null ? '' : ' ' + k + '="' + escAttr(v) + '"'; }).join('');
  if (VOID[n.localName]) return '<' + n.localName + attrs + '>';
  return '<' + n.localName + attrs + '>' + n.childNodes.map(serialize).join('') + '</' + n.localName + '>';
}
Object.defineProperty(E, 'innerHTML', {
  get: function () { return this.childNodes.map(serialize).join(''); },
  set: function (html) {
    var doc = this.ownerDocument, stack = [this];
    this.childNodes.forEach(function (c) { c.parentNode = null; });
    this.childNodes = [];
    var p = new htmlparser2.Parser({
      onopentag: function (name, attribs) {
        var el = new El(doc, name);
        Object.keys(attribs).forEach(function (k) { el.setAttribute(k, attribs[k]); });
        stack[stack.length - 1].appendChild(el);
        stack.push(el);
      },
      ontext: function (t) { stack[stack.length - 1].appendChild(new Text(doc, t)); },
      onclosetag: function () { if (stack.length > 1) stack.pop(); }
    }, { decodeEntities: true, recognizeSelfClosing: true, lowerCaseAttributeNames: false });
    p.write(String(html)); p.end();
  }
});
Object.defineProperty(E, 'outerHTML', { get: function () { return serialize(this); } });
/* selectors: tag, *, #id, .class, [a], [a="v"], [a*="v"], [a^="v"], :not(…), descendant and child combinators */
function splitTop(s) {
  var out = [], cur = '', depth = 0, q = '';
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '(') depth++;
    if (c === ']' || c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
function parseCompound(s) {
  var c = { tag: '', ids: [], classes: [], attrs: [], nots: [] }, i = 0;
  s = s.trim();
  var m = /^(\*|[a-zA-Z][a-zA-Z0-9-]*)/.exec(s);
  if (m) { c.tag = m[1] === '*' ? '' : m[1].toLowerCase(); i = m[0].length; }
  while (i < s.length) {
    var ch = s[i];
    if (ch === '#' || ch === '.') {
      var n = /^[#.]([a-zA-Z0-9_-]+)/.exec(s.slice(i));
      if (!n) throw new Error('stand-in DOM: bad selector ' + s);
      (ch === '#' ? c.ids : c.classes).push(n[1]); i += n[0].length;
    } else if (ch === '[') {
      var end = i, q = '';
      for (; end < s.length; end++) { var x = s[end]; if (q) { if (x === q) q = ''; continue; } if (x === '"' || x === "'") q = x; else if (x === ']') break; }
      var am = /^\s*([a-zA-Z0-9_:-]+)\s*(?:([*^$]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*$/.exec(s.slice(i + 1, end));
      if (!am) throw new Error('stand-in DOM: bad attribute selector ' + s);
      c.attrs.push({ name: am[1].toLowerCase(), op: am[2] || '', value: am[3] != null ? am[3] : am[4] != null ? am[4] : am[5] });
      i = end + 1;
    } else if (s.slice(i, i + 5) === ':not(') {
      var depth = 1, j = i + 5;
      for (; j < s.length && depth; j++) { if (s[j] === '(') depth++; if (s[j] === ')') depth--; }
      c.nots.push(parseList(s.slice(i + 5, j - 1)));
      i = j;
    } else throw new Error('stand-in DOM: unsupported selector ' + s);
  }
  return c;
}
function parseComplex(s) {
  var parts = [], rel = ' ', cur = '', depth = 0, q = '';
  s = s.trim();
  function flush(next) { if (cur.trim()) { parts.push({ rel: rel, c: parseCompound(cur) }); rel = next; } else if (next === '>') rel = '>'; cur = ''; }
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (depth === 0 && (ch === ' ' || ch === '>')) { flush(ch === '>' ? '>' : (cur.trim() ? ' ' : rel)); continue; }
    cur += ch;
  }
  flush(' ');
  return parts;
}
function parseList(s) { return splitTop(s).map(parseComplex); }
function matchCompound(el, c) {
  if (el.nodeType !== 1) return false;
  if (c.tag && el.localName !== c.tag) return false;
  if (c.ids.some(function (id) { return el.getAttribute('id') !== id; })) return false;
  var cls = (el.getAttribute('class') || '').split(/\s+/);
  if (c.classes.some(function (k) { return cls.indexOf(k) === -1; })) return false;
  if (c.attrs.some(function (a) {
    var v = el.getAttribute(a.name);
    if (v == null) return true;
    if (a.op === '=') return v !== a.value;
    if (a.op === '*=') return v.indexOf(a.value) === -1;
    if (a.op === '^=') return v.indexOf(a.value) !== 0;
    if (a.op === '$=') return v.slice(-a.value.length) !== a.value;
    return false;
  })) return false;
  return !c.nots.some(function (list) { return matchList(el, list); });
}
function matchComplex(el, parts, k) {
  if (k === undefined) k = parts.length - 1;
  if (!matchCompound(el, parts[k].c)) return false;
  if (k === 0) return true;
  if (parts[k].rel === '>') return !!el.parentNode && el.parentNode.nodeType === 1 && matchComplex(el.parentNode, parts, k - 1);
  for (var p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) if (matchComplex(p, parts, k - 1)) return true;
  return false;
}
function matchList(el, list) { return list.some(function (parts) { return matchComplex(el, parts); }); }
var selCache = {};
function compiled(sel) { return selCache[sel] || (selCache[sel] = parseList(sel)); }
E.matches = function (sel) { return matchList(this, compiled(sel)); };
E.closest = function (sel) { for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; };
E.querySelectorAll = function (sel) {
  var list = compiled(sel), out = [];
  (function walk(n) { n.childNodes.forEach(function (c) { if (c.nodeType === 1) { if (matchList(c, list)) out.push(c); walk(c); } }); }(this));
  return out;
};
E.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
function makeDocument() {
  var listeners = {};
  var doc = {
    activeElement: null, readyState: 'complete', _layout: null,
    createElement: function (t) { return new El(doc, t); },
    createTextNode: function (v) { return new Text(doc, v); },
    querySelectorAll: function (s) { return doc.documentElement.querySelectorAll(s); },
    querySelector: function (s) { return doc.documentElement.querySelector(s); },
    getElementById: function (id) { return doc.documentElement.querySelector('[id="' + id + '"]'); },
    addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: function (t, fn) { listeners[t] = (listeners[t] || []).filter(function (f) { return f !== fn; }); },
    dispatch: function (t, ev) { (listeners[t] || []).slice().forEach(function (fn) { fn(ev); }); },
    listening: function (t) { return (listeners[t] || []).length; }
  };
  doc.documentElement = new El(doc, 'html');
  doc.head = doc.documentElement.appendChild(new El(doc, 'head'));
  doc.body = doc.documentElement.appendChild(new El(doc, 'body'));
  return doc;
}

/* ===================================================================== the window around the two files */
var LIB = {
  people: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (i) {
    var n = ('0' + i).slice(-2);
    return { id: 'ex-p' + n, name: 'Example Person ' + n, designation: 'Head of Things', company: 'Example Co ' + n, photo: '/assets/promo-examples/people/p' + n + '.jpg', gender: i % 2 ? 'woman' : 'man' };
  }).concat([{ id: 'p13', name: 'Not Marked', designation: '', company: '', photo: 'https://img.example.com/real.jpg' }]),   // dropped: no library markers
  partners: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (i) {
    var n = ('0' + i).slice(-2);
    return { id: 'ex-l' + n, name: 'Example Brand ' + n, logo: '/assets/promo-examples/logos/l' + n + '.png', tier: i <= 2 ? 'Presenting Partners' : i <= 6 ? 'Gold Partners' : 'Partners' };
  }),
  sessions: [
    { id: 'ex-s1', title: 'Opening keynote: the decade ahead', start: '09:30', end: '10:15', day: 'Day 1' },
    { id: 'ex-s2', title: 'Panel: building for scale', start: '10:30', end: '11:15', day: 'Day 1' },
    { id: 'ex-s3', title: 'Fireside chat', start: '11:30', end: '12:15', day: 'Day 1' },
    { id: 'ex-s4', title: 'Workshop', start: '14:00', end: '14:45', day: 'Day 1' },
    { id: 'ex-s5', title: 'Closing panel: what comes next', start: '15:00', end: '15:45', day: 'Day 1' }
  ],
  keyPoints: ['Topic one', 'Topic two', 'Topic three', 'Topic four', 'Topic five', 'Topic six', 'Topic seven'],
  whoShouldAttend: ['Audience one', 'Audience two', 'Audience three', 'Audience four', 'Audience five', 'Audience six', 'Audience seven'],
  whyJoin: ['Why one'],
  stats: [{ value: '40+', label: 'Speakers' }, { value: '500+', label: 'Attendees' }, { value: '20+', label: 'Sessions' }, { value: '2', label: 'Days' }, { value: '9', label: 'Extra' }]
};

function makeEnv(opts) {
  opts = opts || {};
  var doc = makeDocument();
  var blobs = {}, nBlob = 0;
  var log = { fetch: [], authed: [], toBlob: [], toCanvas: [], canvasBlob: [], drawn: [], saves: [], zips: [], errors: [] };
  /* failing[src]: the picture's answer status every time (1 = the old default: 404 from our own server, 502 from
     the image proxy); failOnce[src]: that status for its first request only */
  var failing = opts.failing || {}, failOnce = opts.failOnce || {};
  function failure(src, dflt) {
    if (failOnce[src]) { var s1 = failOnce[src]; delete failOnce[src]; return s1; }
    return failing[src] ? (failing[src] === 1 ? dflt : failing[src]) : 0;
  }
  function resp(ok, status, body, src) {
    return { ok: ok, status: status, text: function () { return Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)); },
      json: function () { return Promise.resolve(typeof body === 'string' ? JSON.parse(body) : clone(body)); },
      blob: function () { return Promise.resolve({ size: 10, type: 'image/png', __src: src }); } };
  }
  var quiet = { log: function () {}, warn: function () {}, error: function () { log.errors.push(Array.prototype.slice.call(arguments).join(' ')); } };
  var win = {
    console: quiet, JSON: JSON, Promise: Promise, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number,
    RegExp: RegExp, Error: Error, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent, Uint8Array: Uint8Array, setTimeout: setTimeout, clearTimeout: clearTimeout,
    document: doc,
    location: { origin: 'https://oneworld.test', href: 'https://oneworld.test/marketing.html' },
    navigator: {},
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    addEventListener: function () {}, removeEventListener: function () {}, scrollTo: function () {}, pageYOffset: 0,
    getComputedStyle: function () { return { lineHeight: 'normal', getPropertyValue: function () { return ''; } }; },
    URL: { createObjectURL: function (b) { var u = 'blob:test/' + (++nBlob); blobs[u] = b && b.__src || 'blob'; return u; }, revokeObjectURL: function () {} },
    fetch: function (url) {
      url = String(url); log.fetch.push(url);
      var p = url.replace('https://oneworld.test', '');
      if (p === '/assets/promo-examples/library.json') return Promise.resolve(opts.noLibrary ? resp(false, 404, '', p) : resp(true, 200, opts.library || LIB, p));
      var st = failure(p, 404);
      if (st) return Promise.resolve(resp(false, st, '', p));
      return Promise.resolve(resp(true, 200, '', p));
    },
    Image: function () {
      var im = this;
      Object.defineProperty(im, 'src', { get: function () { return im._src; }, set: function (v) {
        im._src = v;
        /* opts.onImage: told when a picture starts to load (the banner's sizeOf), opts.imageDelay: how long it takes */
        if (opts.onImage) opts.onImage(blobs[v] || v);
        setTimeout(function () {
          var size = opts.imageSize ? opts.imageSize(blobs[v] || v) : null;
          if (size) { im.naturalWidth = size[0]; im.naturalHeight = size[1]; if (im.onload) im.onload(); } else if (im.onerror) im.onerror();
        }, opts.imageDelay || 0);
      } });
    },
    htmlToImage: {
      toBlob: function (node, o) { log.toBlob.push({ node: node, opts: clone(o) }); return Promise.resolve({ size: 1234, type: 'image/png' }); },
      toCanvas: function (node, o) {
        log.toCanvas.push({ node: node, opts: clone(o) });
        return Promise.resolve({ toBlob: function (cb, type, q) { log.canvasBlob.push({ type: type, quality: q }); cb({ size: 999, type: type }); } });
      }
    },
    JSZip: function () { var files = []; this.file = function (n, b) { files.push({ name: n, body: b }); }; this.generateAsync = function () { log.zips.push(files); return Promise.resolve({ size: 1 }); }; },
    RevampAuth: {
      authedFetch: function (url) {
        url = String(url); log.authed.push(url);
        var m = /[?&]url=([^&]+)/.exec(url), src = m ? decodeURIComponent(m[1]) : url;
        var st = failure(src, 502);
        if (st) return Promise.resolve(resp(false, st, '', src));
        return Promise.resolve(resp(true, 200, '', src));
      }
    },
    RevampCore: {
      fetchSub: function () { return Promise.resolve([]); },
      createSub: function (r, e, body) { log.saves.push(body); return Promise.resolve({ id: 'new1' }); },
      updateSub: function (r, e, id, body) { log.saves.push(body); return Promise.resolve({}); },
      deleteSub: function () { return Promise.resolve({}); }
    }
  };
  doc.fonts = { load: function () { return Promise.resolve([]); }, ready: Promise.resolve() };
  doc._onAttr = function (el, k) { if (k === 'data-drawn') log.drawn.push(el.getAttribute('data-thumb') || el.getAttribute('data-example-thumb') || el.getAttribute('data-state-thumb')); };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(KIT_SRC, win, { filename: 'promo-kit.js' });
  vm.runInContext(POSTS_SRC, win, { filename: 'promo-posts.js' });
  /* the source address a drawn picture (a blob: URL) was made from */
  function srcOf(img) { return img ? blobs[img.getAttribute('src')] || img.getAttribute('src') : ''; }
  return { win: win, doc: doc, log: log, srcOf: srcOf, P: win.RevampPromo, posts: win.RevampPromoPosts };
}
function mounted(env, kit, id) {
  var root = env.doc.body.appendChild(env.doc.createElement('div'));
  env.posts.mount(root, { eventId: id || 'qa-posts', kit: kit, toast: function () {} });
  return root;
}
function allDrawn(root) {
  return !!root.querySelector('.ps-grid') && !root.querySelector('[data-thumb]:not([data-drawn]), [data-example-thumb]:not([data-drawn]):not(.ps-thumb-off), [data-state-thumb]:not([data-drawn])');
}

/* ===================================================================== fixtures */
var FUTURE = new Date(Date.now() + 40 * 86400000), PAST = new Date(Date.now() - 2 * 86400000);
function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
var LIGHT = { theme: '#186bf9', accent: '#ff6a00', background: '#ffffff', surface: '#f5f7fb', text: '#14161b', muted: '#5b6170', heading: '#0b0d12', onTheme: '#ffffff' };
var DARK = { theme: '#e11d48', accent: '#f59e0b', background: '#0b0f19', surface: '#111827', text: '#f3f4f6', muted: '#9ca3af', heading: '#ffffff', onTheme: '#ffffff' };
var FONTS = { heading: { family: 'Poppins', stack: '"Poppins", sans-serif', cssUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap' },
  body: { family: 'Inter', stack: '"Inter", sans-serif', cssUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap' } };
var HERO = 'https://storage.googleapis.com/b/events/qa-posts/hero.jpg', LU = 'https://img.etb2bimg.com/files/lu.png', LU_DARK = 'https://img.etb2bimg.com/files/lu-dark.png';
function richKit() {
  return {
    event: { id: 'qa-rich', name: 'ETRetail Brand World Summit', category: 'conference', start: iso(FUTURE), end: iso(FUTURE), dateLabel: '12 December 2026',
      place: 'Taj Lands End, Mumbai', venue: 'Taj Lands End', city: 'Mumbai', description: 'Where India’s retail leaders meet. Two days of talks.',
      siteUrl: 'https://x.test/', registerUrl: 'https://x.test/register', published: true, hashtag: '#BrandWorld26', edition: 9 },
    brand: { kind: 'generated', mode: 'light', colours: clone(LIGHT), fonts: clone(FONTS), radius: '14px',
      logoUnit: { url: LU, darkUrl: LU_DARK, width: 600, height: 300, tone: 'light' }, eventLogoUrl: '', heroImageUrl: HERO, pictures: [],
      logoUnitParts: { before: 'ETRetail', keyword: 'Brand World', after: 'Summit 2026' } },
    content: {
      overview: 'Overview.',
      speakers: [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) {
        return { id: 's' + i, name: i === 3 ? 'O\'Brien "QA" <b>' : i === 4 ? 'अनन्या गुप्ता' : 'Speaker ' + i, designation: 'CEO', company: 'Co ' + i,
          photoUrl: 'https://img.etb2bimg.com/p' + i + '.jpg', group: i < 3 ? 'Keynote' : 'Speakers' };
      }),
      partners: [1, 2, 3, 4, 5, 6].map(function (i) { return { id: 'pt' + i, name: 'Partner ' + i, logoUrl: 'https://img.etb2bimg.com/l' + i + '.png', tier: i < 2 ? 'Presenting' : i < 4 ? 'Gold' : 'Associate', url: '' }; }),
      sessions: [{ id: 'se1', title: 'Opening', start: iso(FUTURE) + 'T09:30', end: iso(FUTURE) + 'T10:15', day: 'Day 1', speakers: ['Speaker 1', 'Speaker 5'] }],
      audience: ['CEOs', 'CMOs'], topics: ['Retail media', 'AI'], stats: [{ value: '8', label: 'Speakers' }, { value: '1', label: 'Day' }],
      contacts: [], social: []
    }
  };
}
/* no speakers, partners, sessions, numbers or lists, and no venue; a date still ahead */
function sparseKit() {
  var k = richKit();
  k.event.id = 'qa-sparse'; k.event.place = ''; k.event.venue = ''; k.event.city = '';
  k.content = { overview: '', speakers: [], partners: [], sessions: [], audience: [], topics: [], stats: [], contacts: [], social: [] };
  return k;
}
function noDateKit() { var k = sparseKit(); k.event.start = ''; k.event.end = ''; k.event.dateLabel = ''; return k; }
var LIST_TYPES = ['speaker', 'lineup', 'partner', 'partners', 'stats', 'audience', 'topics', 'session'];

/* the Kit-shaped inputs lib/promo-banner.js hands the drawing */
function inputs(over) {
  over = over || {};
  var b = {
    v: 1, event: { name: 'Agentic AI Summit 2027', dateLabel: '12–13 March 2027', place: 'Jio World Centre, Mumbai' },
    brand: { mode: 'light', colours: clone(LIGHT), fonts: clone(FONTS), radius: '12px', heroImageUrl: HERO,
      logoUnit: { url: LU, darkUrl: '', width: 600, height: 300, tone: 'light' }, logoUnitParts: { before: 'ET', keyword: 'Agentic AI', after: 'Summit 2027' } }
  };
  if (over.event) Object.keys(over.event).forEach(function (k) { b.event[k] = over.event[k]; });
  if (over.brand) Object.keys(over.brand).forEach(function (k) { b.brand[k] = over.brand[k]; });
  return b;
}
function lum(hex) {
  var n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
    .reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
}

/* ===================================================================== the checks */
(async function main() {
  /* ---------- P.6: ES5 ---------- */
  [['promo-posts.js', POSTS_SRC], ['promo-kit.js', KIT_SRC]].forEach(function (f) {
    var code = f[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
    check(f[0] + ': no arrow functions', !/=>/.test(code));
    check(f[0] + ': no let / const / class', !/\b(let|const|class)\s/.test(code));
    check(f[0] + ': no template strings', code.indexOf('`') === -1);
    check(f[0] + ': no async / await', !/\basync\s+function\b|\bawait\s/.test(code));
  });

  /* ---------- P.10: toPng's options; with none it is what it always was ---------- */
  (function () {
    var env = makeEnv(), node = env.doc.body.appendChild(env.doc.createElement('div'));
    var ORIGINAL = { width: 1080, height: 1350, pixelRatio: 1, cacheBust: false, style: { transform: 'none', transformOrigin: '0 0', margin: '0' } };
    env.P.toPng(node, 1080, 1350).then(function (blob) {
      check('toPng(node, w, h): two toBlob passes, nothing else', env.log.toBlob.length === 2 && env.log.toCanvas.length === 0, env.log.toBlob.length);
      check('toPng(node, w, h): the very options it always passed', env.log.toBlob.every(function (c) { return JSON.stringify(c.opts) === JSON.stringify(ORIGINAL); }), env.log.toBlob[0] && env.log.toBlob[0].opts);
      check('toPng(node, w, h): a PNG', blob && blob.type === 'image/png');
      env.log.toBlob.length = 0;
      return env.P.toPng(node, 750, 380, { pixelRatio: 2, type: 'image/jpeg', quality: 0.86 });
    }).then(function (blob) {
      check('JPEG: toCanvas twice, at pixelRatio 2 and exactly 750 × 380', env.log.toCanvas.length === 2 && env.log.toCanvas.every(function (c) {
        return c.opts.pixelRatio === 2 && c.opts.width === 750 && c.opts.height === 380 && c.node === node;
      }), env.log.toCanvas.map(function (c) { return c.opts; }));
      check('JPEG: no PNG pass', env.log.toBlob.length === 0);
      check('JPEG: the kept canvas encoded as JPEG at 0.86, once', env.log.canvasBlob.length === 1 && env.log.canvasBlob[0].type === 'image/jpeg' && env.log.canvasBlob[0].quality === 0.86, env.log.canvasBlob);
      check('JPEG: the blob is the JPEG', blob && blob.type === 'image/jpeg');
      return env.P.toPng(node, 100, 100, { pixelRatio: 2 });
    }).then(function () {
      check('pixelRatio alone: still a PNG, at that ratio', env.log.toBlob.length === 2 && env.log.toBlob[0].opts.pixelRatio === 2);
    }).catch(function (err) { check('toPng options ran', false, String(err && err.stack)); });
  })();
  await tick(30);

  /* ---------- P.3: the example guards ---------- */
  await (async function () {
    var env = makeEnv(), P = env.P, doc = env.doc;
    function refused(p, label) {
      return p.then(function () { check(label + ': refused', false); }, function (err) {
        check(label + ': refused', err && err.code === 'example' && err.message === 'Example content can never be saved or downloaded.', err && err.message);
      });
    }
    var ex = doc.body.appendChild(doc.createElement('div'));
    ex.setAttribute('data-example', '1');
    await refused(P.toPng(ex, 10, 10), 'toPng of a [data-example] node');
    var wrap = doc.body.appendChild(doc.createElement('div'));
    wrap.innerHTML = '<div class="ps-scale"><div class="pp" data-example="1"><img src="blob:x"></div></div>';
    await refused(P.toPng(wrap, 10, 10), 'toPng of a node holding a [data-example] one');
    var pic = doc.body.appendChild(doc.createElement('div'));
    pic.innerHTML = '<img src="https://oneworld.test/assets/promo-examples/people/p01.jpg">';
    await refused(P.toPng(pic, 10, 10, { type: 'image/jpeg' }), 'toPng of a node with a library picture');
    check('nothing reached the picture maker for an example', env.log.toBlob.length === 0 && env.log.toCanvas.length === 0);
    await refused(P.save('post', { name: 'x', config: { texts: { a: 'https://oneworld.test/assets/promo-examples/logos/l01.png' } } }), 'save with a library address');
    await refused(P.save('post', { name: 'x', config: { picks: { speaker: 'ex-p01' } } }), 'save with an example id');
    await refused(P.save('email', { name: 'x', imageUrl: '/assets/promo-examples/people/p02.jpg', config: {} }), 'save with a library picture as its image');
    check('nothing example was sent to be saved', env.log.saves.length === 0);
    await refused(P.zip([{ name: 'a.png', blob: {} }, { name: 'caption.txt', text: 'see /assets/promo-examples/people/p01.jpg' }], 'x.zip'), 'zip with a library address in a text');
    await refused(P.zip([{ name: 'a.png', blob: {} }, { name: 'meta.json', text: '{"id":"ex-l03"}' }], 'x.zip'), 'zip with an example id');
    check('no zip was made of example content', env.log.zips.length === 0);
    var ok = doc.body.appendChild(doc.createElement('div'));
    ok.innerHTML = '<div class="pp"><img src="blob:y"></div>';
    await P.toPng(ok, 10, 10).then(function () { check('a real drawing is still drawn', env.log.toBlob.length === 2); }, function (e) { check('a real drawing is still drawn', false, e.message); });
    await P.save('post', { name: 'Speaker spotlight — Speaker 1', config: { type: 'speaker', picks: { speaker: 's1' }, texts: { 'sp:s1:kicker': 'Keynote' } } })
      .then(function () { check('a real post is still saved', env.log.saves.length === 1); }, function (e) { check('a real post is still saved', false, e.message); });
    await P.zip([{ name: 'post.png', blob: {} }, { name: 'caption.txt', text: 'Meet us at #BrandWorld26, index-p01 and ex-p1 as words' }], 'x.zip')
      .then(function () { check('a real zip is still made', env.log.zips.length === 1); }, function (e) { check('a real zip is still made', false, e.message); });
    ['/assets/promo-examples/x', '%2Fassets%2Fpromo-examples%2Fx', '{"id":"ex-p01"}', "it's 'ex-s2'", '<meta name="oneworld-example">', { a: [{ logoUrl: '/assets/promo-examples/logos/l01.png' }] }]
      .forEach(function (v) { check('isExample: ' + JSON.stringify(v), P.isExample(v) === true); });
    ['ex-p01', '{"id":"ex-p01x"}', 'index-p01', { name: 'Speaker 1', id: 's1' }, '', null].forEach(function (v) { check('not isExample: ' + JSON.stringify(v), P.isExample(v) === false); });
  })();

  /* ---------- P.1: the gallery on the sparse Kit ---------- */
  var sparse = sparseKit(), sparseBefore = clone(sparse);
  var env1 = makeEnv(), root1 = mounted(env1, sparse, 'qa-sparse');
  check('sparse: the gallery and every preview drawn', await until(function () { return allDrawn(root1); }), root1.innerHTML.slice(0, 300));
  LIST_TYPES.forEach(function (id) {
    var card = root1.querySelector('.ps-card[data-preview="' + id + '"]');
    check(id + ': a locked card with a preview', !!card && card.localName === 'div' && card.matches('.ps-card.off'));
    if (!card) return;
    check(id + ': no Open on it', !card.hasAttribute('data-open') && !card.querySelector('[data-open]'));
    var th = card.querySelector('.ps-thumb');
    check(id + ': its thumb is data-example-thumb', !!th && th.getAttribute('data-example-thumb') === id && !th.hasAttribute('data-thumb'));
    check(id + ': badged "Example"', !!card.querySelector('.ps-thumb .ps-ex') && card.querySelector('.ps-ex').textContent === 'Example');
    check(id + ': the example note', !!card.querySelector('.ps-ex-note') && /^Example .+ — add yours to use this$/.test(card.querySelector('.ps-ex-note').textContent), card.querySelector('.ps-ex-note') && card.querySelector('.ps-ex-note').textContent);
    var t = env1.posts._internal.TYPES.filter(function (x) { return x.id === id; })[0], need = t.need(sparse);
    check(id + ': keeps its why', card.querySelector('.ps-card-body').textContent.indexOf(need.why) !== -1);
    var a = card.querySelector('a');
    check(id + ': keeps its fix link', need.fix ? !!a && a.getAttribute('href') === '/edit-event.html?event=qa-sparse#' + need.fix[1] : !a);
    var pp = th.querySelector('.pp');
    check(id + ': the example drawn and marked data-example', !!pp && pp.getAttribute('data-example') === '1', th.innerHTML.slice(0, 200));
    check(id + ': no chip on an example', !card.querySelector('.ps-chip'));
  });
  ['announce', 'countdown'].forEach(function (id) {
    var b = root1.querySelector('button.ps-card[data-open="' + id + '"]');
    check(id + ' (has a date): still an available card', !!b && !!b.querySelector('.ps-thumb[data-thumb="' + id + '"] .pp'));
    check(id + ' (has a date): unchanged, no badge, chip or preview', !!b && !b.querySelector('.ps-ex, .ps-chip, .ps-ex-note, [data-example-thumb], [data-state-thumb]') && !b.hasAttribute('data-preview'));
    check(id + ' (has a date): drawn from the real Kit', !!b && !b.querySelector('[data-example]'));
  });
  var lineupThumb = root1.querySelector('[data-example-thumb="lineup"]');
  check('the line-up example shows 8 people', !!lineupThumb && lineupThumb.querySelectorAll('.pp-pc').length === 8, lineupThumb && lineupThumb.querySelectorAll('.pp-pc').length);
  var partnersThumb = root1.querySelector('[data-example-thumb="partners"]');
  check('the partners wall example: 8 partners in 3 tiers', !!partnersThumb && partnersThumb.querySelectorAll('.pp-pcard').length === 8 && partnersThumb.querySelectorAll('.pp-tier').length === 3);
  var firstPreview = env1.log.drawn.indexOf('speaker');
  check('the event\'s own posts are drawn first, then the previews', env1.log.drawn.slice(0, 2).sort().join() === 'announce,countdown' && firstPreview === 2 && env1.log.drawn.length === 10, env1.log.drawn);
  check('the unmarked library entry is never used', root1.innerHTML.indexOf('Not Marked') === -1);
  check('the library is fetched once', env1.log.fetch.filter(function (u) { return /library\.json$/.test(u); }).length === 1);
  check('the real Kit is untouched by the previews (P.2)', JSON.stringify(sparse) === JSON.stringify(sparseBefore));

  /* state gaps: the real post with a chip, never an example */
  var nd = noDateKit(), env2 = makeEnv(), root2 = mounted(env2, nd, 'qa-nodate');
  check('no date: everything drawn', await until(function () { return allDrawn(root2); }));
  [['announce', 'No date or venue yet'], ['countdown', 'No start date yet']].forEach(function (x) {
    var card = root2.querySelector('.ps-card[data-preview="' + x[0] + '"]');
    check(x[0] + ' (no date): a locked card', !!card && card.matches('.ps-card.off') && !card.querySelector('[data-open]'));
    if (!card) return;
    var th = card.querySelector('.ps-thumb');
    check(x[0] + ' (no date): a state thumb, not an example one', th.getAttribute('data-state-thumb') === x[0] && !th.hasAttribute('data-example-thumb'));
    check(x[0] + ' (no date): its chip', !!card.querySelector('.ps-thumb .ps-chip') && card.querySelector('.ps-chip').textContent === x[1], card.querySelector('.ps-chip') && card.querySelector('.ps-chip').textContent);
    check(x[0] + ' (no date): no Example badge or note', !card.querySelector('.ps-ex, .ps-ex-note'));
    var pp = th.querySelector('.pp');
    check(x[0] + ' (no date): the real render, not marked example', !!pp && !pp.hasAttribute('data-example'));
  });
  check('no date: Save the date shows no invented date or place', root2.querySelector('[data-state-thumb="announce"] .pp').querySelectorAll('.pp-date, .pp-place').length === 0);
  var started = sparseKit(); started.event.start = iso(PAST);
  var env3 = makeEnv(), root3 = mounted(env3, started, 'qa-started');
  await until(function () { return allDrawn(root3); });
  var cd = root3.querySelector('[data-state-thumb="countdown"]');
  check('started: the countdown chip says so', !!cd && cd.querySelector('.ps-chip').textContent === 'Already started');
  check('started: no negative number on the preview', !!cd && /^0$/.test(cd.querySelector('.pp-num').textContent.trim()), cd && cd.querySelector('.pp-num').textContent);

  /* an event with everything: no preview at all, every card as it was */
  var env4 = makeEnv(), rich = richKit(), root4 = mounted(env4, rich, 'qa-rich');
  await until(function () { return allDrawn(root4); });
  check('rich: 10 available cards, each with Open', root4.querySelectorAll('button.ps-card[data-open]').length === 10);
  check('rich: no previews, badges or chips', !root4.querySelector('[data-preview], [data-example-thumb], [data-state-thumb], .ps-ex, .ps-chip, [data-example]'));
  check('rich: the library is never fetched', env4.log.fetch.every(function (u) { return !/promo-examples/.test(u); }));

  /* the posts take the unit's own copy for a dark ground too (C7): whole files, never recoloured */
  await (async function () {
    var I = env4.posts._internal, k = richKit();
    check('posts: a light unit on a light ground is its own picture', I.lookFor(k, 'site').logo.url === LU);
    var th = I.lookFor(k, 'theme');
    check('posts: on a dark ground it takes the site\'s dark copy', th.mode === 'dark' && th.logo.url === LU_DARK && th.logo.tone === 'dark');
    var cfg = I.newCfg('announce'); cfg.background = 'theme';
    await I.want(I.urlsFor(k, cfg));
    var host = env4.doc.body.appendChild(env4.doc.createElement('div'));
    var node = I.drawInto(host, k, cfg);
    check('posts: the drawn Save the date shows the dark copy, not the name in type', env4.srcOf(node.querySelector('.pp-logo img')) === LU_DARK && !node.querySelector('.pp-lock'));
    host.remove();
    k.brand.logoUnit.darkUrl = '';
    check('posts: with no dark copy, the name is set in type as before', I.lookFor(k, 'theme').logo === null);
    k.brand.logoUnit.tone = 'dark'; k.brand.logoUnit.darkUrl = LU_DARK;
    check('posts: a unit drawn for a dark ground stays off a light one', I.lookFor(k, 'site').logo === null && I.lookFor(k, 'theme').logo.url === LU);
  })();

  /* ---------- P.2 and P.4: exampleKit ---------- */
  await (async function () {
    var I = env1.posts._internal, lib = await I.exampleLibrary();
    check('the library keeps only marked entries', lib.people.length === 12 && lib.partners.length === 12 && lib.sessions.length === 5);
    var before = clone(sparse);
    LIST_TYPES.forEach(function (id) {
      var ek = I.exampleKit(id, lib);
      check(id + ': the copy is marked __example', ek.__example === true);
      check(id + ': now drawable', !I.TYPES.filter(function (t) { return t.id === id; })[0].need(ek));
      var touched = { speaker: ['speakers'], lineup: ['speakers'], partner: ['partners'], partners: ['partners'], stats: ['stats'], audience: ['audience'], topics: ['topics'], session: ['sessions', 'speakers'] }[id];
      var other = Object.keys(sparse.content).filter(function (k) { return touched.indexOf(k) === -1; });
      check(id + ': only its own list is filled', other.every(function (k) { return JSON.stringify(ek.content[k]) === JSON.stringify(sparse.content[k]); }), other);
      check(id + ': event and brand untouched', JSON.stringify(ek.event) === JSON.stringify(sparse.event) && JSON.stringify(ek.brand) === JSON.stringify(sparse.brand));
    });
    var ek = I.exampleKit('lineup', lib);
    check('line-up: topped up to 8 examples', ek.content.speakers.length === 8 && ek.content.speakers.every(function (s) { return /^ex-p\d\d$/.test(s.id) && s.photoUrl.indexOf('/assets/promo-examples/people/') === 0; }));
    check('partners: 8 in three tiers', I.exampleKit('partners', lib).content.partners.length === 8);
    check('stats: 4', I.exampleKit('stats', lib).content.stats.length === 4);
    check('audience and topics: 6 lines each', I.exampleKit('audience', lib).content.audience.length === 6 && I.exampleKit('topics', lib).content.topics.length === 6);
    var se = I.exampleKit('session', lib);
    check('sessions with no real speakers: example people, found by name', se.content.sessions.length === 5 && se.content.speakers.length === 5 &&
      se.content.sessions[1].speakers.length === 2 && se.content.sessions.every(function (s) { return s.speakers.every(function (n) { return se.content.speakers.some(function (p) { return p.name === n; }); }); }));
    check('the real Kit untouched by exampleKit (P.2)', JSON.stringify(sparse) === JSON.stringify(before));

    /* P.4: one real speaker → 1 real + 7 examples on a line-up; never fewer real */
    var one = sparseKit();
    one.content.speakers = [{ id: 's-real', name: 'Real Speaker', designation: 'CTO', company: 'Real Co', photoUrl: 'https://img.etb2bimg.com/real.jpg', group: 'Speakers' }];
    one.content.partners = [{ id: 'pt-real', name: 'Real Partner', logoUrl: 'https://img.etb2bimg.com/rp.png', tier: 'Gold', url: '' }];
    var oneBefore = clone(one);
    var env5 = makeEnv(), root5 = mounted(env5, one, 'qa-one');
    await until(function () { return allDrawn(root5); });
    var I5 = env5.posts._internal;
    var lu = I5.exampleKit('lineup', lib);
    check('one real speaker: 1 real + 7 examples', lu.content.speakers.length === 8 && lu.content.speakers[0].id === 's-real' &&
      lu.content.speakers.slice(1).every(function (s) { return /^ex-p/.test(s.id); }), lu.content.speakers.map(function (s) { return s.id; }));
    check('one real speaker: the examples join the real one\'s group', lu.content.speakers[7].group === 'Speakers');
    var pw = I5.exampleKit('partners', lib);
    check('one real partner: 1 real + 7 examples', pw.content.partners.length === 8 && pw.content.partners[0].id === 'pt-real');
    var drawnLineup = root5.querySelector('[data-example-thumb="lineup"]');
    var names = drawnLineup ? drawnLineup.querySelectorAll('.pp-pc .n').map(function (n) { return n.textContent; }) : [];
    check('one real speaker: the drawn line-up starts with the real one', names.length === 8 && names[0] === 'Real Speaker', names);
    check('one real speaker: the note says the examples are beside the event\'s own', /beside the event’s own — add more to use this$/.test(root5.querySelector('.ps-card[data-preview="lineup"] .ps-ex-note').textContent));
    check('one real speaker: Speaker spotlight is a real, available card', !!root5.querySelector('button.ps-card[data-open="speaker"]'));
    /* made-up sessions never show a real person (plan §5h: nothing made up is put on a real person) */
    var ses = I5.exampleKit('session', lib);
    check('sessions on an event with speakers: the real one kept, example people added for the sessions',
      ses.content.speakers.length === 6 && ses.content.speakers[0].id === 's-real' && ses.content.speakers.slice(1).every(function (p) { return /^ex-p\d\d$/.test(p.id); }),
      ses.content.speakers.map(function (p) { return p.id; }));
    check('sessions on an event with speakers: no real speaker on a made-up session', ses.content.sessions.length === 5 && ses.content.sessions.every(function (s) {
      return s.speakers.length && s.speakers.every(function (n) { return n !== 'Real Speaker' && /^Example Person \d\d$/.test(n); });
    }), ses.content.sessions.map(function (s) { return s.speakers; }));
    var drawnSession = root5.querySelector('[data-example-thumb="session"]');
    check('sessions on an event with speakers: the drawn agenda preview shows no real speaker', !!drawnSession && drawnSession.hasAttribute('data-drawn') &&
      drawnSession.textContent.indexOf('Real Speaker') === -1 && drawnSession.textContent.indexOf('Example Person') !== -1 &&
      drawnSession.querySelectorAll('img').every(function (im) { return env5.srcOf(im).indexOf('real.jpg') === -1; }));
    var clash = sparseKit();
    clash.content.speakers = [{ id: 's-clash', name: 'Example Person 01', designation: 'CFO', company: 'Real Co', photoUrl: 'https://img.etb2bimg.com/clash.jpg', group: '' }];
    var env6 = makeEnv(), root6 = mounted(env6, clash, 'qa-clash');
    await until(function () { return allDrawn(root6); });
    var sc = env6.posts._internal.exampleKit('session', lib);
    check('sessions: an example person whose name a real speaker has is skipped (a name never finds a real photo)',
      sc.content.sessions.every(function (s) { return s.speakers.indexOf('Example Person 01') === -1; }) &&
      sc.content.speakers.filter(function (p) { return p.name === 'Example Person 01'; }).length === 1, sc.content.sessions.map(function (s) { return s.speakers; }));
    check('the real Kit untouched (P.4)', JSON.stringify(one) === JSON.stringify(oneBefore));
  })();

  /* ---------- P.3, again: the example mark is part of the drawing, not added after it ---------- */
  await (async function () {
    var I = env1.posts._internal, lib = await I.exampleLibrary(), P = env1.P, doc = env1.doc;
    function refused(p, label) {
      return p.then(function () { check(label, false, 'drawn'); }, function (err) { check(label, err && err.code === 'example', err && err.message); });
    }
    var before = env1.log.toBlob.length + env1.log.toCanvas.length;
    for (var i = 0; i < LIST_TYPES.length; i++) {
      var id = LIST_TYPES[i], t = I.TYPES.filter(function (x) { return x.id === id; })[0];
      var ek = I.exampleKit(id, lib);
      var cfg = { type: id, format: 'portrait', background: 'site', picks: t.pickDefaults ? t.pickDefaults(ek) : {}, texts: {}, caption: null, network: 'linkedin' };
      await I.want(I.urlsFor(ek, cfg));
      var host = doc.body.appendChild(doc.createElement('div'));
      /* drawn as any post is (drawInto), never through the previews' own drawPreview */
      var node = I.drawInto(host, ek, cfg);
      check(id + ': a drawing of the example Kit is marked data-example on its root', node.getAttribute('data-example') === '1');
      await refused(P.toPng(node, 1080, 1350), id + ': toPng refuses it');
      if (id === 'lineup' || id === 'partners' || id === 'session') {
        /* should the mark ever be missing, a library picture still gives it away: its blob: URL is remembered */
        node.removeAttribute('data-example');
        check(id + ': its library pictures are blob: URLs, not their address', node.querySelectorAll('img').length > 0 &&
          node.querySelectorAll('img').every(function (im) { return /^blob:/.test(im.getAttribute('src')); }));
        await refused(P.toPng(node, 1080, 1350), id + ': without the mark, still refused for its library pictures');
      }
      host.remove();
    }
    check('no example drawing reached the picture maker', env1.log.toBlob.length + env1.log.toCanvas.length === before);
    /* the event's own drawing is not marked and is drawn */
    var rich = richKit(), envR = makeEnv(), rootR = mounted(envR, rich, 'qa-rich');
    await until(function () { return allDrawn(rootR); });
    var IR = envR.posts._internal, rc = IR.newCfg('lineup');
    await IR.want(IR.urlsFor(rich, rc));
    var hostR = envR.doc.body.appendChild(envR.doc.createElement('div'));
    var real = IR.drawInto(hostR, rich, rc);
    check('the event\'s own drawing carries no example mark', !real.hasAttribute('data-example') && !real.querySelector('[data-example]'));
    await envR.P.toPng(real, 1080, 1350).then(function () { check('the event\'s own drawing is drawn', envR.log.toBlob.length === 2); },
      function (e) { check('the event\'s own drawing is drawn', false, e.message); });
  })();

  /* ---------- P.5: the full-size view ---------- */
  await (async function () {
    var doc = env1.doc, card = root1.querySelector('.ps-card[data-preview="lineup"]'), th = card.querySelector('.ps-thumb');
    card.onclick({ target: card.querySelector('a') });
    check('a click on the fix link does not open the view', !doc.body.querySelector('.ps-lb'));
    card.onclick({ target: th });
    var lb = doc.body.querySelector('.ps-lb');
    check('a click on a locked card opens its full-size view', !!lb && lb.getAttribute('role') === 'dialog' && lb.getAttribute('aria-modal') === 'true');
    await until(function () { return !!lb.querySelector('.pp'); });
    var pp = lb.querySelector('.pp');
    check('the view: the post drawn at its format, marked example', !!pp && pp.getAttribute('data-example') === '1' && pp.style.getPropertyValue('width') === '1080px');
    check('the view: a column as wide as the post (promo.css reads --ps-lb-w)', lb.querySelector('.ps-lb-col').style.getPropertyValue('--ps-lb-w') === '1080px');
    check('the view: the bar holds the badge, the name, the note and ✕; the post sits in a .ps-thumb', !!lb.querySelector('.ps-lb-bar > .ps-ex') && !!lb.querySelector('.ps-lb-bar > b#ps-lb-h') &&
      !!lb.querySelector('.ps-lb-bar > .ps-ex-note') && !!lb.querySelector('.ps-lb-bar > .ps-lb-x') && !!lb.querySelector('.ps-lb-col > .ps-thumb > .ps-scale > .pp'));
    check('the view: the badge, the note and the fix link', !!lb.querySelector('.ps-ex') && /Example speakers — add yours to use this/.test(lb.textContent) &&
      !!lb.querySelector('a[href="/edit-event.html?event=qa-sparse#content/speakers"]'));
    var buttons = lb.querySelectorAll('button').map(function (b) { return b.textContent + ' ' + (b.getAttribute('aria-label') || ''); });
    check('the view: no Download and no Open', !buttons.some(function (t) { return /download|open|save/i.test(t); }) && !lb.querySelector('[data-open], a[download]'), buttons);
    await env1.P.toPng(pp, 1080, 1350).then(function () { check('the view\'s drawing is refused by toPng', false); }, function (e) { check('the view\'s drawing is refused by toPng', e.code === 'example'); });
    check('the view: Close has the focus', doc.activeElement === lb.querySelector('[data-lb-close]'));
    doc.dispatch('keydown', { key: 'Escape', preventDefault: function () {}, stopPropagation: function () {} });
    check('Escape closes it', !doc.body.querySelector('.ps-lb') && doc.listening('keydown') === 0);
    check('and the focus goes back to the card', doc.activeElement === th);
    th.onkeydown({ key: 'Enter', preventDefault: function () {} });
    lb = doc.body.querySelector('.ps-lb');
    check('Enter on the preview opens it too', !!lb);
    lb.querySelector('[data-lb-close]').onclick();
    check('✕ closes it', !doc.body.querySelector('.ps-lb'));
    /* a state card: the real post, its chip, still nothing to download */
    var sc = root2.querySelector('.ps-card[data-preview="announce"]');
    sc.onclick({ target: sc.querySelector('.ps-thumb') });
    var slb = env2.doc.body.querySelector('.ps-lb');
    await until(function () { return !!slb.querySelector('.pp'); });
    check('a state view: the real post, the chip, no example badge', !!slb.querySelector('.ps-chip') && !slb.querySelector('.ps-ex') && !slb.querySelector('[data-example]'));
    check('a state view: no Download and no Open', !slb.querySelectorAll('button').some(function (b) { return /download|open|save/i.test(b.textContent); }));
    slb.onclick({ target: slb });
    check('a click outside the post closes it', !env2.doc.body.querySelector('.ps-lb'));
    check('the real Kit untouched after the views (P.2)', JSON.stringify(sparse) === JSON.stringify(sparseBefore));
  })();

  /* a library that cannot be loaded: the card goes back to its locked look, with nothing called an example */
  await (async function () {
    var o = { noLibrary: true }, env = makeEnv(o), root = mounted(env, sparseKit(), 'qa-nolib');
    await until(function () { return !!root.querySelector('.ps-grid') && root.querySelectorAll('.ps-thumb-off').length === LIST_TYPES.length; });
    var card = root.querySelector('.ps-card[data-preview="lineup"]');
    check('no library: the preview says it could not be drawn', !!card && /could not be drawn/.test(card.querySelector('.ps-thumb').textContent));
    check('no library: no Example badge or note left', !!card && !card.querySelector('.ps-ex, .ps-ex-note, [data-example]'));
    /* the tab shown again once the library can be read: the previews are drawn, badged and noted as they should be */
    o.noLibrary = false;
    env.posts.shown();
    await until(function () { return !root.querySelector('.ps-thumb-off') && allDrawn(root); });
    check('shown again: the previews are drawn', !root.querySelector('.ps-thumb-off') && !!card.querySelector('.ps-thumb .pp[data-example]'));
    check('shown again: the badge and the note are back, the note after the name', card.querySelector('.ps-thumb').className === 'ps-thumb' && !!card.querySelector('.ps-thumb .ps-ex') &&
      card.querySelector('.ps-card-body').children[1].className === 'ps-ex-note' && card.querySelectorAll('.ps-ex-note').length === 1);
  })();

  /* the shared library as Unit X writes it (assets/promo-examples/library.json), when it is in the worktree */
  await (async function () {
    var file = path.join(ROOT, 'assets', 'promo-examples', 'library.json');
    if (!fs.existsSync(file)) { console.log('note: assets/promo-examples/library.json not in the worktree yet; read with the test\'s own library only'); return; }
    var real = JSON.parse(fs.readFileSync(file, 'utf8'));
    var env = makeEnv({ library: real }), root = mounted(env, sparseKit(), 'qa-reallib');
    var lib = await env.posts._internal.exampleLibrary();
    check('the real library: every person, partner and session is kept (all carry the markers)', lib.people.length === real.people.length && lib.partners.length === real.partners.length &&
      lib.sessions.length === real.sessions.length, [lib.people.length, lib.partners.length, lib.sessions.length]);
    check('the real library: enough to fill every list a post tops up', lib.people.length >= 8 && lib.partners.length >= 8 && lib.stats.length >= 4 && lib.audience.length >= 6 && lib.topics.length >= 6 && lib.sessions.length >= 5);
    await until(function () { return allDrawn(root); });
    check('the real library: every example preview is drawn', LIST_TYPES.every(function (id) { return !!root.querySelector('[data-example-thumb="' + id + '"] .pp[data-example="1"]'); }));
    /* people, partners and sessions carry an id or an address the guards know; the text lists (numbers, audience,
       topics) carry none of their own (as in lib/promo-examples.js), so for them the drawing's data-example mark,
       which toPng refuses, is the guard */
    check('the real library: every example person, partner and session carries a marker the server knows', ['speaker', 'lineup', 'partner', 'partners', 'session'].every(function (id) {
      return env.P.isExample(JSON.stringify(env.posts._internal.exampleKit(id, lib).content));
    }));
  })();

  /* ---------- P.7: the banner drawing ---------- */
  await (async function () {
    var env = makeEnv({ imageSize: function () { return [600, 300]; } }), doc = env.doc;
    var bodyH = 154;
    doc._layout = function (el, p) { return p === 'offsetHeight' && el.hasAttribute('data-mb-body') ? bodyH : 0; };
    var kids = doc.body.childNodes.length;
    var d = await env.posts.banner(inputs());
    check('banner: resolves a 750-wide node', d && d.width === 750 && d.node.style.width === '750px' && d.node.matches('.pp.pp-mailbanner'));
    check('banner: as tall as its content and its bands (≈ 380 for a usual unit)', d.height === 380 && d.node.style.height === '380px', d.height);
    check('banner: off the screen', doc.body.childNodes.length === kids + 1 && /left:\s*-100000px/.test(d.node.parentNode.getAttribute('style')) && /position:\s*fixed/.test(d.node.parentNode.getAttribute('style')));
    check('banner: no kicker, tagline, button, QR code, hashtag, top or footer row', !d.node.querySelector('.pp-kick, .pp-tagl, .pp-cta, .pp-qr, .pp-tag, .pp-top, .pp-foot, .pp-edition, .pp-big-t'));
    check('banner: no "Register now" or "Save the date" words', !/register now|save the date/i.test(d.node.textContent));
    check('banner: the site\'s picture under the veil', env.srcOf(d.node.querySelector('.pp-bg img')) === HERO && !!d.node.querySelector('.pp-veil'));
    check('banner: the date with the calendar, the place with the pin', d.node.querySelector('.pp-mb-date').textContent === '12–13 March 2027' && !!d.node.querySelector('.pp-mb-date svg rect') &&
      d.node.querySelector('.pp-mb-place').textContent === 'Jio World Centre, Mumbai' && !!d.node.querySelector('.pp-mb-place svg circle'));
    check('banner: the site\'s fonts and colours', d.node.style.getPropertyValue('--pp-head') === '"Poppins", sans-serif' && d.node.style.getPropertyValue('--pp-body') === '"Inter", sans-serif');
    check('banner: the given Kit\'s fonts are asked for', !!doc.head.querySelector('link[data-promo-font="' + FONTS.heading.cssUrl + '"]') && !!doc.head.querySelector('link[data-promo-font="' + FONTS.body.cssUrl + '"]'));
    check('banner: the logo unit at the left, at most 46%, then a rule', /max-width:\s*46%/.test(d.node.querySelector('.pp-logo').parentNode.getAttribute('style')) && !!d.node.querySelector('.pp-logo img'));
    d.done(); d.done();
    check('banner: done() removes it (twice is fine)', doc.body.childNodes.length === kids);
    bodyH = 0;
    d = await env.posts.banner(inputs());
    check('banner: never under 320', d.height === 320);
    d.done();
    bodyH = 900;
    d = await env.posts.banner(inputs());
    check('banner: never over 440', d.height === 440);
    d.done();
    /* it never reads the studio's own Kit: before any mount, and after one with another event */
    var root = mounted(env, sparseKit(), 'qa-other');
    await until(function () { return allDrawn(root); });
    bodyH = 154;
    d = await env.posts.banner(inputs());
    check('banner: after the studio mounted another event, still the given event\'s facts', d.node.querySelector('.pp-mb-date').textContent === '12–13 March 2027' && d.node.textContent.indexOf('Taj') === -1);
    d.done();
    /* the logo's own proportions when the Kit has none (a ported site's unit) */
    var env2 = makeEnv({ imageSize: function () { return [1000, 250]; } });
    var d2 = await env2.posts.banner(inputs({ brand: { logoUnit: { url: LU, darkUrl: '', width: 0, height: 0, tone: '' } } }));
    var img = d2.node.querySelector('.pp-logo img');
    check('banner: a unit with no size takes its picture\'s own (4:1 → 308 × 77)', img.style.width === '308px' && img.style.height === '77px', img.getAttribute('style'));
    d2.done();
    /* with lib/promo-banner.js's own inputsOf, when it is in the worktree */
    var K = null;
    try { K = require('./promo-banner'); } catch (e) { K = null; }
    if (K && typeof K.inputsOf === 'function') {
      var d3 = await env.posts.banner(K.inputsOf(richKit()));
      check('banner: draws lib/promo-banner.js inputsOf(kit)', d3.width === 750 && d3.node.querySelector('.pp-mb-date').textContent === '12 December 2026' && d3.node.querySelector('.pp-mb-place').textContent === 'Taj Lands End, Mumbai');
      check('banner: inputsOf\'s light unit with a dark copy → the dark copy', env.srcOf(d3.node.querySelector('.pp-logo img')) === LU_DARK);
      d3.done();
    } else console.log('note: lib/promo-banner.js not in the worktree yet; its inputsOf was not drawn');
    /* a picture that cannot be loaded: refused, nothing left behind */
    var env3 = makeEnv({ failing: (function () { var f = {}; f[HERO] = 1; return f; })(), imageSize: function () { return [600, 300]; } });
    var n3 = env3.doc.body.childNodes.length;
    await env3.posts.banner(inputs()).then(function () { check('banner: an unreachable site picture is refused', false); },
      function (e) { check('banner: an unreachable site picture is refused', /site’s picture could not be loaded/.test(e.message) && env3.doc.body.childNodes.length === n3, e.message); });
    check('banner: the site\'s picture was asked for twice before it was refused', env3.log.authed.filter(function (u) { return u.indexOf(encodeURIComponent(HERO)) !== -1; }).length === 2);
    var env4 = makeEnv({ failing: (function () { var f = {}; f[LU] = 1; return f; })(), imageSize: function () { return [600, 300]; } });
    await env4.posts.banner(inputs()).then(function () { check('banner: a logo unit that fails with an error that may pass (502) is refused', false); },
      function (e) { check('banner: a logo unit that fails with an error that may pass (502) is refused', /logo unit could not be loaded/.test(e.message) && e.cause && e.cause.status === 502, e.message); });
    check('banner: … after asking for it twice', env4.log.authed.filter(function (u) { return u.indexOf(encodeURIComponent(LU)) !== -1; }).length === 2);
  })();

  /* ---------- P.7, again: the studio mounted while the banner is being drawn ----------
     mount() empties the studio's picture cache; the banner keeps its own pictures, so a mount while it waits for
     its logo's size (sizeOf) or for its pictures changes nothing in it */
  await (async function () {
    var withDark = { brand: { logoUnit: { url: LU, darkUrl: LU_DARK, width: 600, height: 300, tone: 'light' } } };
    function parts(env, d) {
      return { hero: env.srcOf(d.node.querySelector('.pp-bg img')), logo: env.srcOf(d.node.querySelector('.pp-logo img')), typed: !!d.node.querySelector('.pp-lock') };
    }
    /* the same event's studio (its Kit holds the same pictures) mounted during sizeOf */
    var env, fired = 0, mountedAt = '';
    env = makeEnv({ imageSize: function () { return [600, 300]; }, imageDelay: 30, onImage: function (src) {
      if (fired++) return;
      mountedAt = src;
      mounted(env, richKit(), 'qa-rich');
    } });
    var d = await env.posts.banner(inputs(withDark));
    var got = parts(env, d);
    check('mount during sizeOf (same event): it did happen then', fired >= 1 && mountedAt === LU_DARK, mountedAt);
    check('mount during sizeOf (same event): the site\'s picture is still drawn', got.hero === HERO, got);
    check('mount during sizeOf (same event): the dark copy is still drawn, not the name in type', got.logo === LU_DARK && !got.typed, got);
    d.done();
    /* another event's studio mounted during sizeOf */
    var envB, firedB = 0;
    envB = makeEnv({ imageSize: function () { return [600, 300]; }, imageDelay: 30, onImage: function () { if (!firedB++) mounted(envB, sparseKit(), 'qa-other'); } });
    var dB = await envB.posts.banner(inputs(withDark));
    var gotB = parts(envB, dB);
    check('mount during sizeOf (another event): both pictures still drawn', firedB >= 1 && gotB.hero === HERO && gotB.logo === LU_DARK && !gotB.typed, gotB);
    dB.done();
    /* a mount while the pictures themselves are loading */
    var envC = makeEnv({ imageSize: function () { return [600, 300]; } });
    var pC = envC.posts.banner(inputs(withDark));
    mounted(envC, sparseKit(), 'qa-other');
    var dC = await pC, gotC = parts(envC, dC);
    check('mount while the pictures load: both pictures still drawn', gotC.hero === HERO && gotC.logo === LU_DARK && !gotC.typed, gotC);
    dC.done();
  })();

  /* ---------- P.9, again: a logo copy that is not there for good gives way, as the posts' does (plan §6j.3) ----------
     a copy the image proxy says is gone (404), refused (400) or not a picture (415) is no copy: the dark copy gives
     way to the unit's own picture on a light ground, that to the name set in type; an error that may pass (502, no
     network) refuses the banner instead, so a blip is never kept as the event's banner. The site's picture is never
     stood in for. */
  await (async function () {
    function failing(map) { return makeEnv({ failing: map, imageSize: function () { return [600, 300]; } }); }
    function map(pairs) { var m = {}; for (var i = 0; i < pairs.length; i += 2) m[pairs[i]] = pairs[i + 1]; return m; }
    async function drawn(env, over) {
      var d = await env.posts.banner(inputs(over));
      var img = d.node.querySelector('.pp-logo img');
      var out = { dark: lum(d.node.style.getPropertyValue('--pp-base')) < 0.2, logo: img ? env.srcOf(img) : '', typed: !!d.node.querySelector('.pp-lock'),
        hero: env.srcOf(d.node.querySelector('.pp-bg img')), html: d.node.outerHTML };
      d.done();
      return out;
    }
    var lightWithDark = { brand: { logoUnit: { url: LU, darkUrl: LU_DARK, width: 600, height: 300, tone: 'light' } } };
    var a = await drawn(failing(map([LU_DARK, 404])), lightWithDark);
    check('dark copy gone (404): the unit\'s own picture, on a light ground, over the site\'s picture', !a.dark && a.logo === LU && !a.typed && a.hero === HERO, a);
    var b = await drawn(failing(map([LU_DARK, 404, LU, 404])), lightWithDark);
    check('both copies gone: the name set in type, on the site\'s own (light) ground', !b.dark && b.typed && !b.logo && b.hero === HERO, b);
    check('both copies gone: the name is the event\'s own', /Agentic AI/.test(b.html));
    var c = await drawn(failing(map([LU, 404])), { brand: { mode: 'dark', colours: clone(DARK), logoUnit: { url: LU, darkUrl: '', width: 600, height: 300, tone: 'dark' } } });
    check('a unit drawn for a dark ground, gone: the name set in type, on the dark site\'s ground', c.dark && c.typed && !c.logo, c);
    var d4 = await drawn(failing(map([LU, 400])), {});
    check('a unit the image proxy refuses (400): the name set in type', !d4.dark && d4.typed && !d4.logo, d4);
    var e = await drawn(failing(map([LU, 415])), {});
    check('a unit that is not a picture (415): the name set in type', e.typed && !e.logo, e);
    var envF = failing(map([LU_DARK, 502]));
    await envF.posts.banner(inputs(lightWithDark)).then(function () { check('dark copy failing with 502: refused, not stood in for', false); },
      function (err) { check('dark copy failing with 502: refused, not stood in for', /logo unit could not be loaded/.test(err.message) && envF.doc.body.querySelectorAll('.pp-mailbanner').length === 0, err.message); });
    function askedFor(env, url) { var tail = 'url=' + encodeURIComponent(url); return env.log.authed.filter(function (u) { return u.slice(-tail.length) === tail; }).length; }
    check('dark copy failing with 502: asked for twice, and the unit\'s own picture never asked for instead', askedFor(envF, LU_DARK) === 2 && askedFor(envF, LU) === 0, envF.log.authed);
    var envG = makeEnv({ failOnce: map([LU_DARK, 502]), imageSize: function () { return [600, 300]; } });
    var g = await drawn(envG, lightWithDark);
    check('dark copy failing once: asked again, and drawn', g.dark && g.logo === LU_DARK && envG.log.authed.filter(function (u) { return u.indexOf(encodeURIComponent(LU_DARK)) !== -1; }).length === 2, g);
    var envH = failing(map([HERO, 404]));
    await envH.posts.banner(inputs()).then(function () { check('the site\'s picture gone (404): still refused (never stood in for)', false); },
      function (err) { check('the site\'s picture gone (404): still refused (never stood in for)', /site’s picture could not be loaded/.test(err.message), err.message); });
    /* image() keeps the answer's status for the drawing to read: from the image proxy and from our own server */
    var envI = failing(map([LU, 404, '/own/lu.png', 410]));
    await envI.P.image(LU).then(function () { check('image(): a proxy 404 rejects with its status', false); }, function (err) { check('image(): a proxy 404 rejects with its status', err.status === 404, err.status); });
    await envI.P.image('/own/lu.png').then(function () { check('image(): our own 410 rejects with its status', false); }, function (err) { check('image(): our own 410 rejects with its status', err.status === 410, err.status); });
    var j = await drawn(envI, { brand: { logoUnit: { url: '/own/lu.png', darkUrl: '', width: 600, height: 300, tone: 'light' } } });
    check('a unit of our own that is gone (410): the name set in type', j.typed && !j.logo, j);
    [a, b, c, d4, e, g, j].forEach(function (x, i) { check('fallbacks: no picture\'s colour is ever changed #' + i, !/filter|mix-blend|hue-rotate|invert\(/i.test(x.html)); });
  })();

  /* ---------- P.8: a missing date or venue is left out, never invented ---------- */
  await (async function () {
    var env = makeEnv({ imageSize: function () { return [600, 300]; } });
    /* the words as they read: each text on its own, as the spans sit on their own lines */
    function words(node) {
      var out = [];
      (function walk(n) { n.childNodes.forEach(function (c) { if (c.nodeType === 3) out.push(c.nodeValue); else walk(c); }); })(node);
      return out.join(' ').replace(/\s+/g, ' ').trim();
    }
    var d = await env.posts.banner(inputs({ event: { dateLabel: '' } }));
    check('no date: no calendar item', !d.node.querySelector('.pp-mb-date') && !d.node.querySelector('svg rect'));
    check('no date: the place with its pin', !!d.node.querySelector('.pp-mb-place svg circle') && words(d.node) === 'Jio World Centre, Mumbai', words(d.node));
    d.done();
    d = await env.posts.banner(inputs({ event: { place: '' } }));
    check('no venue: no pin item', !d.node.querySelector('.pp-mb-place') && !d.node.querySelector('svg circle'));
    check('no venue: the date with its calendar, nothing else', !!d.node.querySelector('.pp-mb-date svg rect') && words(d.node) === '12–13 March 2027', words(d.node));
    d.done();
    d = await env.posts.banner(inputs({ event: { dateLabel: '', place: '' } }));
    check('neither: no date, place, rule or words column', !d.node.querySelector('.pp-wi, .pp-when, svg') && words(d.node) === '');
    var logo = d.node.querySelector('.pp-logo');
    check('neither: the logo unit alone, centred', !!logo && /justify-content:\s*center/.test(logo.parentNode.getAttribute('style')) && /margin:\s*0 auto/.test(logo.querySelector('img').getAttribute('style')));
    check('neither: the unit takes the wider box', +logo.querySelector('img').style.width.replace('px', '') === 482 && +logo.querySelector('img').style.height.replace('px', '') === 241, logo.querySelector('img').getAttribute('style'));
    d.done();
    d = await env.posts.banner(inputs({ event: { dateLabel: '  ', place: '' }, brand: { logoUnit: null } }));
    check('neither, and no unit: only the event\'s own name, set in type', words(d.node) === 'ET Agentic AI Summit 2027' && !!d.node.querySelector('.pp-lock .pp-lk em'), words(d.node));
    d.done();
  })();

  /* ---------- P.9: the ground and the logo copy (whole files only; the ET red square never recoloured) ---------- */
  await (async function () {
    var env = makeEnv({ imageSize: function () { return [600, 300]; } });
    async function look(over) {
      var d = await env.posts.banner(inputs(over));
      var base = d.node.style.getPropertyValue('--pp-base'), img = d.node.querySelector('.pp-logo img');
      var out = { dark: lum(base) < 0.2, base: base, logo: img ? env.srcOf(img) : '', typed: !!d.node.querySelector('.pp-lock'), html: d.node.outerHTML, veil: d.node.querySelector('.pp-veil').getAttribute('style') };
      d.done();
      return out;
    }
    var a = await look({ brand: { logoUnit: { url: LU, darkUrl: '', width: 600, height: 300, tone: 'dark' } } });
    check('tone dark: its own picture, on a dark ground', a.dark && a.logo === LU, a);
    var b = await look({ brand: { logoUnit: { url: LU, darkUrl: LU_DARK, width: 600, height: 300, tone: 'light' } } });
    check('tone light with a dark copy: the dark copy, on a dark ground', b.dark && b.logo === LU_DARK, b);
    check('a dark ground on a light site: the site\'s own deepest colour under the veil', b.base === LIGHT.heading && b.veil.indexOf('rgba(11,13,18,') !== -1, b.base);
    var c = await look({ brand: { logoUnit: { url: LU, darkUrl: '', width: 600, height: 300, tone: 'light' } } });
    check('tone light without one: its own picture, on a light ground', !c.dark && c.logo === LU, c);
    var c2 = await look({ brand: { mode: 'dark', colours: clone(DARK), logoUnit: { url: LU, darkUrl: '', width: 600, height: 300, tone: 'light' } } });
    check('tone light without a dark copy on a dark site: still a light ground for it', !c2.dark && c2.logo === LU, c2.base);
    var c3 = await look({ brand: { logoUnit: { url: LU, darkUrl: '', width: 0, height: 0, tone: '' } } });
    check('a unit of unknown tone with no dark copy: light ground, its own picture', !c3.dark && c3.logo === LU);
    var dkSite = await look({ brand: { mode: 'dark', colours: clone(DARK), logoUnit: null } });
    check('no unit picture on a dark site: the name set in type, on a dark ground', dkSite.dark && dkSite.typed && !dkSite.logo);
    var ltSite = await look({ brand: { logoUnit: null } });
    check('no unit picture on a light site: the name set in type, on a light ground', !ltSite.dark && ltSite.typed && !ltSite.logo);
    [a, b, c, c2, c3, dkSite, ltSite].forEach(function (x, i) {
      check('no picture\'s colour is ever changed (no filter in the markup) #' + i, !/filter/i.test(x.html) && !/mix-blend|hue-rotate|invert\(/i.test(x.html));
    });
  })();

  console.log('promo-posts: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) { console.error('FAIL the test itself — ' + (err && err.stack || err)); process.exit(1); });
