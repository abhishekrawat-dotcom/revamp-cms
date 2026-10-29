// node functions/lib/promo-social-adapter.test.js — Promotions → Social posts' page (promo-social-studio.html): Oneworld's
// side of the platform's social posts studio, promo-studio/oneworld-social.js and oneworld-social.css (plan §6c, §6h,
// §7 F, §13 O2 = c). The platform's own code (promo-studio/social-studio.js, as tools/extract-promo-social.py makes it)
// and oneworld-social.js run together in a vm, on the page's own markup, over a small DOM built here on htmlparser2.
// Stubbed: RevampAuth (Oneworld's routes answered in memory), html-to-image, the OWSocial bundle (Unit B), JSZip, and
// the upload and caption modules (Units I and G: window.OWSArt, window.OWSCap). No network.
var fs = require('fs'), path = require('path'), vm = require('vm');
var htmlparser2 = require('htmlparser2');
var ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function count(s, sub) { return s.split(sub).length - 1; }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function flush(ms) { return new Promise(function (r) { setTimeout(r, ms == null ? 25 : ms); }); }

var STUDIO = read('promo-studio/social-studio.js');
var ADAPTER = read('promo-studio/oneworld-social.js');
var CSS = read('promo-studio/oneworld-social.css');
var OW_CSS = read('promo-studio/oneworld.css');
var PAGE = read('promo-social-studio.html');

/* ================= a small DOM ================= */
var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
var RAW = { script: 1, style: 1 };
function kebab(p) { return /^--/.test(p) ? p : p.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }
function splitDecls(s) {
  var out = [], depth = 0, q = '', cur = '';
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (q) { if (c === q) q = ''; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ';' && depth <= 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(function (d) { var k = d.indexOf(':'); return k === -1 ? null : [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()]; }).filter(Boolean);
}
function styleOf(el) {
  function get(k) { var d = splitDecls(el.getAttribute('style') || '').filter(function (x) { return x[0] === k; })[0]; return d ? d[1] : ''; }
  function set(k, v) {
    var list = splitDecls(el.getAttribute('style') || '').filter(function (x) { return x[0] !== k; });
    if (v !== '' && v != null) list.push([k, String(v)]);
    el.setAttribute('style', list.map(function (d) { return d[0] + ':' + d[1]; }).join(';'));
  }
  return new Proxy({}, {
    get: function (_, p) {
      if (p === 'setProperty') return function (k, v) { set(k, v); };
      if (p === 'getPropertyValue') return function (k) { return get(k); };
      if (p === 'removeProperty') return function (k) { set(k, ''); };
      if (p === 'cssText') return el.getAttribute('style') || '';
      if (typeof p !== 'string') return undefined;
      return get(kebab(p));
    },
    set: function (_, p, v) { if (p === 'cssText') el.setAttribute('style', String(v)); else set(kebab(p), v); return true; }
  });
}
function Txt(doc, t) { this.nodeType = 3; this.ownerDocument = doc; this.data = String(t); this.parentNode = null; }
Object.defineProperty(Txt.prototype, 'textContent', { get: function () { return this.data; }, set: function (v) { this.data = String(v); } });
Txt.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
function El(doc, tag) {
  this.nodeType = 1; this.ownerDocument = doc; this.localName = String(tag).toLowerCase(); this.tagName = this.localName.toUpperCase();
  this.nodeName = this.tagName; this._attrs = []; this.childNodes = []; this.parentNode = null; this._ls = {};
}
var EP = El.prototype;
EP.getAttribute = function (n) { n = String(n).toLowerCase(); for (var i = 0; i < this._attrs.length; i++) if (this._attrs[i][0] === n) return this._attrs[i][1]; return null; };
EP.setAttribute = function (n, v) {
  n = String(n).toLowerCase();
  for (var i = 0; i < this._attrs.length; i++) if (this._attrs[i][0] === n) { this._attrs[i][1] = String(v); return; }
  this._attrs.push([n, String(v)]);
};
EP.removeAttribute = function (n) { n = String(n).toLowerCase(); this._attrs = this._attrs.filter(function (a) { return a[0] !== n; }); };
EP.hasAttribute = function (n) { return this.getAttribute(n) !== null; };
Object.defineProperty(EP, 'attributes', { get: function () { return this._attrs.map(function (a) { return { name: a[0], value: a[1] }; }); } });
['id', 'src', 'href', 'download', 'placeholder', 'title', 'type', 'accept'].forEach(function (p) {
  Object.defineProperty(EP, p, { get: function () { var v = this.getAttribute(p); return v == null ? '' : v; }, set: function (v) { this.setAttribute(p, v); }, configurable: true });
});
Object.defineProperty(EP, 'className', { get: function () { return this.getAttribute('class') || ''; }, set: function (v) { this.setAttribute('class', v); } });
Object.defineProperty(EP, 'classList', { get: function () {
  var el = this;
  function list() { return (el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  function has(c) { return list().indexOf(c) !== -1; }
  function add() { var l = list(); Array.prototype.forEach.call(arguments, function (c) { if (l.indexOf(c) === -1) l.push(c); }); el.setAttribute('class', l.join(' ')); }
  function remove() { var rm = Array.prototype.slice.call(arguments); el.setAttribute('class', list().filter(function (c) { return rm.indexOf(c) === -1; }).join(' ')); }
  return { add: add, remove: remove, contains: has, toggle: function (c, force) { var on = force === undefined ? !has(c) : !!force; if (on) add(c); else remove(c); return on; } };
} });
Object.defineProperty(EP, 'dataset', { get: function () {
  var el = this;
  return new Proxy({}, {
    get: function (_, k) { if (typeof k !== 'string') return undefined; var v = el.getAttribute('data-' + kebab(k)); return v == null ? undefined : v; },
    set: function (_, k, v) { el.setAttribute('data-' + kebab(k), v); return true; }
  });
} });
Object.defineProperty(EP, 'style', { get: function () { return styleOf(this); }, set: function (v) { this.setAttribute('style', v); } });
Object.defineProperty(EP, 'value', {
  get: function () {
    if (this.localName === 'select') {
      var opts = this.querySelectorAll('option'), self = this;
      if (this._value != null && opts.some(function (o) { return o.value === self._value; })) return this._value;
      var s = opts.filter(function (o) { return o.hasAttribute('selected'); })[0] || opts[0];
      return s ? s.value : '';
    }
    if (this.localName === 'option') { var v = this.getAttribute('value'); return v == null ? this.textContent : v; }
    if (this._value != null) return this._value;
    if (this.localName === 'textarea') return this.textContent;
    var a = this.getAttribute('value'); return a == null ? '' : a;
  },
  set: function (v) { this._value = String(v == null ? '' : v); }
});
Object.defineProperty(EP, 'checked', { get: function () { return !!this._checked; }, set: function (v) { this._checked = !!v; } });
Object.defineProperty(EP, 'disabled', { get: function () { return this._disabled !== undefined ? this._disabled : this.hasAttribute('disabled'); }, set: function (v) { this._disabled = !!v; } });
Object.defineProperty(EP, 'textContent', {
  get: function () { return this.childNodes.map(function (n) { return n.textContent; }).join(''); },
  set: function (v) { this.childNodes.forEach(function (c) { c.parentNode = null; }); this.childNodes = []; if (String(v) !== '') this.appendChild(new Txt(this.ownerDocument, v)); }
});
Object.defineProperty(EP, 'innerText', { get: function () { return this.textContent; }, set: function (v) { this.textContent = v; } });
Object.defineProperty(EP, 'innerHTML', {
  get: function () { var raw = !!RAW[this.localName]; return this.childNodes.map(function (n) { return serialize(n, raw); }).join(''); },
  set: function (h) { var self = this; this.childNodes.forEach(function (c) { c.parentNode = null; }); this.childNodes = []; parseFragment(String(h), this.ownerDocument).forEach(function (n) { self.appendChild(n); }); }
});
Object.defineProperty(EP, 'outerHTML', { get: function () { return serialize(this, false); } });
Object.defineProperty(EP, 'children', { get: function () { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); } });
Object.defineProperty(EP, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
Object.defineProperty(EP, 'nextSibling', { get: function () { var p = this.parentNode; if (!p || !p.childNodes) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; } });
Object.defineProperty(EP, 'parentElement', { get: function () { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; } });
Object.defineProperty(EP, 'isConnected', { get: function () { for (var n = this; n; n = n.parentNode) if (n.nodeType === 9) return true; return false; } });
Object.defineProperty(EP, 'complete', { get: function () { return true; } });
Object.defineProperty(EP, 'naturalWidth', { get: function () { return /broken/.test(this.getAttribute('src') || '') ? 0 : 100; } });
Object.defineProperty(EP, 'clientWidth', { get: function () { return 1000; } });
Object.defineProperty(EP, 'clientHeight', { get: function () { return 700; } });
Object.defineProperty(EP, 'offsetHeight', { get: function () { return 40; } });
Object.defineProperty(EP, 'contentDocument', { get: function () {
  if (this.localName !== 'iframe') return null;
  if (!this._doc) { this._doc = new Doc(this.ownerDocument._win); if (this.ownerDocument._win.__writeThrows) this._doc._throwWrite = true; }
  return this._doc;
} });
Object.defineProperty(EP, 'srcdoc', { get: function () { return this._srcdoc || ''; }, set: function (v) {
  var self = this; this._srcdoc = String(v);
  setTimeout(function () { self._doc = parseDoc(self._srcdoc, self.ownerDocument._win); fire(self, 'load'); }, 0);
} });
EP.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; };
EP.insertBefore = function (c, ref) {
  if (!ref) return this.appendChild(c);
  if (c.parentNode) c.parentNode.removeChild(c);
  var i = this.childNodes.indexOf(ref); c.parentNode = this; this.childNodes.splice(i === -1 ? this.childNodes.length : i, 0, c); return c;
};
EP.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i !== -1) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
EP.replaceChild = function (n, old) { this.insertBefore(n, old); this.removeChild(old); return old; };
EP.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
EP.replaceWith = function (n) { if (this.parentNode) this.parentNode.replaceChild(n, this); };
EP.contains = function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; };
EP.matches = function (sel) { var el = this; return parseSelector(sel).some(function (g) { return matchAt(el, g, g.length - 1); }); };
EP.closest = function (sel) { for (var e = this; e && e.nodeType === 1; e = e.parentNode) if (e.matches(sel)) return e; return null; };
function descendants(n) { var out = []; (function walk(x) { x.childNodes.forEach(function (c) { if (c.nodeType === 1) { out.push(c); walk(c); } }); })(n); return out; }
EP.querySelectorAll = function (sel) { var gs = parseSelector(sel); return descendants(this).filter(function (e) { return gs.some(function (g) { return matchAt(e, g, g.length - 1); }); }); };
EP.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
EP.getElementsByTagName = function (t) { t = String(t).toLowerCase(); return descendants(this).filter(function (e) { return t === '*' || e.localName === t; }); };
EP.addEventListener = function (t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); };
EP.removeEventListener = function (t, fn) { this._ls[t] = (this._ls[t] || []).filter(function (f) { return f !== fn; }); };
EP.dispatchEvent = function (ev) { fire(this, ev.type, ev); return true; };
EP.click = function () { if (this.localName === 'input' && this.getAttribute('type') === 'file') { var w = this.ownerDocument._win; if (w.__onFilePick) w.__onFilePick(this); return; } fire(this, 'click'); };
EP.focus = function () { this.ownerDocument.activeElement = this; };
EP.blur = function () {}; EP.select = function () {};
EP.getBoundingClientRect = function () { return this._rect || { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }; };
EP.insertAdjacentHTML = function (pos, h) {
  var self = this, nodes = parseFragment(String(h), this.ownerDocument);
  nodes.forEach(function (n) {
    if (pos === 'beforeend') self.appendChild(n);
    else if (pos === 'afterbegin') self.insertBefore(n, self.firstChild);
    else if (pos === 'beforebegin') self.parentNode.insertBefore(n, self);
    else self.parentNode.insertBefore(n, self.nextSibling);
  });
};
EP.getContext = function () { return { drawImage: function () {} }; };
EP.decode = function () { var w = this.ownerDocument._win, src = this.getAttribute('src') || ''; (w.__decodes = w.__decodes || []).push(src); return /broken/.test(src) ? Promise.reject(new Error('EncodingError')) : Promise.resolve(); };
EP.toBlob = function (cb, type, q) {
  var w = this.ownerDocument._win; w.__canvas.push({ type: type, q: q });
  var size = w.__webpSize ? w.__webpSize(q) : 1000;
  setTimeout(function () { cb(new Blob([new Uint8Array(size)], { type: type })); }, 0);
};
function fire(target, type, init) {
  var ev = { type: type, target: target, defaultPrevented: false, cancelBubble: false,
    preventDefault: function () { ev.defaultPrevented = true; }, stopPropagation: function () { ev.cancelBubble = true; } };
  Object.keys(init || {}).forEach(function (k) { if (k !== 'preventDefault') ev[k] = init[k]; });
  for (var n = target; n; n = n.parentNode) {
    ev.currentTarget = n;
    if (n.nodeType === 1 && typeof n['on' + type] === 'function') n['on' + type].call(n, ev);
    /* an inline handler written in the markup (onclick="…"), run in the page's context as a browser would */
    else if (n.nodeType === 1 && n.getAttribute('on' + type) && n.ownerDocument._win.__inline) n.ownerDocument._win.__inline(n.getAttribute('on' + type), n, ev);
    (n._ls[type] || []).slice().forEach(function (fn) { fn.call(n, ev); });
    if (ev.cancelBubble || n.nodeType === 9) break;
  }
  return ev;
}
function Doc(win) {
  this.nodeType = 9; this._win = win; this._ls = {}; this.readyState = 'loading'; this.activeElement = null; this.written = '';
  this.fonts = { ready: Promise.resolve() };
  this.defaultView = { getComputedStyle: function () { return {}; } };
  this.documentElement = null; this.head = null; this.body = null;
}
var DP = Doc.prototype;
DP.createElement = function (t) { return new El(this, t); };
DP.createTextNode = function (t) { return new Txt(this, t); };
DP._all = function () { return this.documentElement ? [this.documentElement].concat(descendants(this.documentElement)) : []; };
DP.getElementById = function (id) { return this._all().filter(function (e) { return e.getAttribute('id') === id; })[0] || null; };
DP.querySelectorAll = function (sel) { var gs = parseSelector(sel); return this._all().filter(function (e) { return gs.some(function (g) { return matchAt(e, g, g.length - 1); }); }); };
DP.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
DP.getElementsByTagName = function (t) { t = String(t).toLowerCase(); return this._all().filter(function (e) { return t === '*' || e.localName === t; }); };
DP.addEventListener = function (t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); };
DP.removeEventListener = function (t, fn) { this._ls[t] = (this._ls[t] || []).filter(function (f) { return f !== fn; }); };
DP.open = function () { if (this._throwWrite) throw new Error('blocked: sandboxed'); this._buf = ''; };
DP.write = function (s) { this._buf += s; this.written += s; };
DP.close = function () { loadInto(this, this._buf); this.readyState = 'complete'; };
Object.defineProperty(DP, 'images', { get: function () { return this.getElementsByTagName('img'); } });
function convert(node, doc) {
  if (node.type === 'text') return new Txt(doc, node.data);
  if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
    var el = new El(doc, node.name);
    Object.keys(node.attribs || {}).forEach(function (k) { el.setAttribute(k, node.attribs[k]); });
    (node.children || []).forEach(function (c) { var x = convert(c, doc); if (x) el.appendChild(x); });
    return el;
  }
  return null;
}
function parseFragment(h, doc) { return htmlparser2.parseDocument(h).children.map(function (c) { return convert(c, doc); }).filter(Boolean); }
function loadInto(d, html) {
  var nodes = parseFragment(String(html), d), root = nodes.filter(function (n) { return n.nodeType === 1 && n.localName === 'html'; })[0];
  if (!root) { root = new El(d, 'html'); var b0 = new El(d, 'body'); root.appendChild(new El(d, 'head')); root.appendChild(b0); nodes.forEach(function (n) { b0.appendChild(n); }); }
  d.documentElement = root; root.parentNode = d;
  d.head = root.children.filter(function (c) { return c.localName === 'head'; })[0] || null;
  d.body = root.children.filter(function (c) { return c.localName === 'body'; })[0] || null;
  if (!d.body) { d.body = new El(d, 'body'); root.appendChild(d.body); }
  if (!d.activeElement) d.activeElement = d.body;
}
function parseDoc(html, win) { var d = new Doc(win); loadInto(d, html); d.readyState = 'complete'; return d; }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function serialize(n, raw) {
  if (n.nodeType === 3) return raw ? n.data : escText(n.data);
  var r = !!RAW[n.localName];
  return '<' + n.localName + n._attrs.map(function (a) { return ' ' + a[0] + '="' + escAttr(a[1]) + '"'; }).join('') + '>' +
    (VOID[n.localName] ? '' : n.childNodes.map(function (c) { return serialize(c, r); }).join('') + '</' + n.localName + '>');
}
/* selectors: tag, *, #id, .class, [a], [a=v], [a^=v], :checked; descendant and child combinators; groups */
function parseCompound(s) {
  var c = { tag: null, id: null, cls: [], attrs: [], pseudo: [] }, m = /^(\*|[a-zA-Z][\w-]*)/.exec(s), i = 0;
  if (m) { c.tag = m[1].toLowerCase(); i = m[0].length; }
  while (i < s.length) {
    var r = s.slice(i), x;
    if ((x = /^#([\w-]+)/.exec(r))) c.id = x[1];
    else if ((x = /^\.([\w-]+)/.exec(r))) c.cls.push(x[1]);
    else if ((x = /^\[\s*([\w-]+)\s*(?:([\^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/.exec(r))) c.attrs.push({ n: x[1].toLowerCase(), op: x[2], v: x[3] != null ? x[3] : x[4] != null ? x[4] : x[5] });
    else if ((x = /^:([\w-]+)/.exec(r))) c.pseudo.push(x[1]);
    else throw new Error('selector not supported: ' + s);
    i += x[0].length;
  }
  return c;
}
var SEL_CACHE = {};
function parseSelector(sel) {
  if (SEL_CACHE[sel]) return SEL_CACHE[sel];
  return (SEL_CACHE[sel] = sel.split(',').map(function (g) {
    var parts = [], comb = ' ', toks = g.trim().match(/(\[[^\]]*\]|[^\s>\[]+)+|>/g) || [];
    toks.forEach(function (t) { if (t === '>') { comb = '>'; return; } parts.push({ comb: comb, c: parseCompound(t) }); comb = ' '; });
    return parts;
  }));
}
function matchCompound(el, c) {
  if (c.tag && c.tag !== '*' && el.localName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  var cl = (el.getAttribute('class') || '').split(/\s+/);
  if (c.cls.some(function (k) { return cl.indexOf(k) === -1; })) return false;
  if (c.attrs.some(function (a) { var v = el.getAttribute(a.n); if (v === null) return true; if (!a.op) return false; if (a.op === '=') return v !== a.v; if (a.op === '^=') return v.indexOf(a.v) !== 0; return false; })) return false;
  if (c.pseudo.some(function (p) { return p === 'checked' ? !el.checked : true; })) return false;
  return true;
}
function matchAt(el, parts, i) {
  if (!matchCompound(el, parts[i].c)) return false;
  if (i === 0) return true;
  if (parts[i].comb === '>') { var p = el.parentNode; return !!p && p.nodeType === 1 && matchAt(p, parts, i - 1); }
  for (var q = el.parentNode; q && q.nodeType === 1; q = q.parentNode) if (matchAt(q, parts, i - 1)) return true;
  return false;
}

/* ================= fixtures ================= */
var SIZES = { ig_square: [1080, 1080], ig_portrait: [1080, 1350], landscape: [1200, 675], story: [1080, 1920] };
var FMTS = [{ id: 'ig_square', label: 'Square', ratio: '1:1' }, { id: 'ig_portrait', label: 'Portrait', ratio: '4:5' },
  { id: 'landscape', label: 'Landscape', ratio: '16:9' }, { id: 'story', label: 'Story', ratio: '9:16' }];
var THEME = { key: 'theme', label: 'Theme', type: 'select', default: 'dark', options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }] };
function tpl(id, label, available, missing, extra) {
  var dot = id.indexOf('.');
  return Object.assign({ id: id, category: id.slice(0, dot), subtype: id.slice(dot + 1), label: label, description: label + ' post & more',
    formats: FMTS, params: [THEME], available: available, missing: missing || [], isNew: false, kind: 'code' }, extra || {});
}
function catalog(o) {
  o = o || {};
  return {
    event: { name: 'QA Summit', hashtag: o.hashtag !== undefined ? o.hashtag : '#QASummit26', edition: 9, dateLabel: '12 Nov 2026', venue: 'Mumbai',
      counts: { speakers: 8, sponsorTiers: 3, sessions: 5 }, micrositeUrl: o.published ? 'https://qa-summit.example/' : undefined,
      link: o.published ? 'https://qa-summit.example/' : '', published: !!o.published },
    formats: {},
    catalog: { categories: [
      { key: 'generic', label: 'Generic', templates: [
        o.sparse ? tpl('generic.announcement', 'Announcement', false, ['event date/venue']) :
          tpl('generic.announcement', 'Announcement', true, [], { params: [THEME, { key: 'kicker', label: 'Kicker', type: 'text', default: 'Save the date' }] }),
        tpl('generic.who-should-attend', 'Who Should Attend', false, ['who should attend']),
        tpl('generic.testimonial', 'Testimonial', true, [], { params: [THEME, { key: 'kicker', label: 'Kicker', type: 'text', default: 'Voices' }, { key: 'quote', label: 'Quote', type: 'text', default: '' }] })] },
      { key: 'speaker', label: 'Speaker', templates: [tpl('speaker.individual', 'Speaker Spotlight', false, ['speakers'])] }] }
  };
}
var ART = { background: false, logoUnit: true, bg1: true, bg2: false, bg3: false, units: {}, psd: null };
var ROSTER = { event: 'qa-1', portal: 'hr', speakers: [{ id: 's1', name: 'Asha Rao', photoUrl: 'https://img.etb2bimg.com/asha.jpg' }, { id: 's2', name: 'No Photo', photoUrl: '' }],
  sponsors: [{ id: 'p1', title: 'Acme', logoUrl: 'https://img.etb2bimg.com/acme.png', tier: 'Gold' }, { id: 'p2', title: 'Nologo', logoUrl: '', tier: 'Gold' }],
  sessions: [{ id: 'x1', title: 'Opening' }] };
var FILL = { 'generic.who-should-attend': 'audience', 'generic.testimonial': 'quote', 'speaker.individual': 'speakers' };
var STORE = 'https://storage.googleapis.com/bkt/events/qa-1/';
function postHtml(id, fmt, extra) {
  return '<!doctype html><html><head><meta charset="utf-8"><style>@import url(\'https://fonts.googleapis.com/css2?family=Inter\');body{margin:0}</style></head>' +
    '<body data-ratio="1:1"><div class="canvas" data-post="' + id + '|' + fmt + '">' +
    '<div class="bg" style="background-image:url(\'' + STORE + 'promo-art/bg1.png\')"></div>' +
    '<div class="lockup"><img class="lockup-img" src="' + STORE + 'promo-art/logo.png" alt=""></div>' +
    '<div class="tl-logo"><img src="https://img.etb2bimg.com/broken-logo.png" alt="Acme &quot;Co&quot; &lt;b&gt;" onerror="this.onerror=null;this.remove();this.parentElement.classList.add(\'text\');this.parentElement.textContent=&quot;Acme&quot;;"></div>' +
    '<div class="ps-logo"><img src="https://img.etb2bimg.com/broken-ps.png" alt="Zen Partner" onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'ps-name\',textContent:&quot;Zen&quot;}));"></div>' +
    '<img class="spk" src="https://img.etb2bimg.com/speaker.jpg" alt="">' +
    '<img class="gone" src="https://img.etb2bimg.com/broken-photo.jpg" alt="">' +
    '<img class="mine" src="https://revamp.example.app/assets/promo-examples/people/p01.jpg" alt="">' +
    (extra || '') +
    '<script>parent.HACKED=1</script><p onclick="parent.HACKED=2" onmouseover="x()">Hello <b>world</b></p>' +
    '<iframe src="https://evil.example/"></iframe><object data="x"></object><embed src="y">' +
    '</div></body></html>';
}
function deferred() { var d = {}; d.p = new Promise(function (ok, no) { d.ok = ok; d.no = no; }); return d; }

/* ================= the page ================= */
function boot(o) {
  o = o || {};
  var calls = [], fetches = [], posted = [], shots = [], extracts = [], renders = [], zips = [], toasts = [], errors = [], raf = [], ros = [], winLs = {};
  var blobs = 0, revoked = [], blobStore = {};
  var ctx = {};
  var doc = new Doc(ctx);
  loadInto(doc, PAGE.replace(/<script\b[\s\S]*?<\/script>/g, ''));
  doc.readyState = 'complete';
  doc.getElementById('content')._rect = { left: 0, top: 0, right: 1000, bottom: 900, width: 1000, height: 900 };
  ctx.window = ctx; ctx.self = ctx; ctx.document = doc;
  ctx.location = { origin: 'https://ow.test', search: o.search !== undefined ? o.search : '?event=qa-1', href: 'https://ow.test/promo-social-studio.html' };
  ctx.console = { log: function () {}, warn: function () {}, error: function () { errors.push(Array.prototype.slice.call(arguments)); } };
  ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout; ctx.setInterval = setInterval; ctx.clearInterval = clearInterval;
  ctx.Response = Response; ctx.Blob = Blob; ctx.Headers = Headers; ctx.URLSearchParams = URLSearchParams; ctx.AbortController = AbortController;
  ctx.URL = { createObjectURL: function (b) { var u = 'blob:https://ow.test/' + (++blobs); blobStore[u] = b; return u; }, revokeObjectURL: function (u) { revoked.push(u); } };
  ctx.DOMParser = function () { this.parseFromString = function (s) { return parseDoc(s, ctx); }; };
  ctx.htmlToImage = { toBlob: function (node, opts) {
    var rec = { opts: Object.assign({}, opts), html: serialize(node, false) }; shots.push(rec);
    if (o.shot) return o.shot(rec);
    return Promise.resolve(new Blob([new Uint8Array(o.shotSize || 16)], { type: 'image/png' }));
  } };
  ctx.OWSocial = {
    extract: function (d, W, H) {
      extracts.push({ html: serialize(d.documentElement, false), W: W, H: H });
      var els = [];
      d.getElementsByTagName('img').forEach(function (img, i) {
        if ((img.getAttribute('style') || '').indexOf('visibility:hidden') !== -1) return;
        var e = { id: 'e' + i, type: 'image', x: 10 * i, y: 0, w: 100, h: 100, src: img.getAttribute('data-ow-src') || img.getAttribute('src') || '' };
        if (img.classList.contains('ow-qr-code')) e.owQr = true;
        els.push(e); img.style.visibility = 'hidden';
      });
      els.push({ id: 'tx', type: 'text', x: 5, y: 6, w: 300, h: 40, text: 'Hello', fontFamily: 'Inter', fontSize: 24, color: '#ffffff' });
      return els;
    },
    renderEditableHtml: function (w, h, base, els) {
      renders.push({ w: w, h: h, base: base, els: JSON.parse(JSON.stringify(els)) });
      return '<!doctype html><html><head></head><body><div class="stage"><img class="bg" src="' + base + '">' +
        els.map(function (e) { return e.type === 'image' ? '<img src="' + e.src + '">' : '<div>' + (e.text || '') + '</div>'; }).join('') + '</div></body></html>';
    }
  };
  function FakeZip() { this.files = []; zips.push(this); }
  FakeZip.prototype.file = function (n, d) { this.files.push({ name: n, data: d }); return this; };
  FakeZip.prototype.generateAsync = function () { return Promise.resolve(new Blob(['zip'], { type: 'application/zip' })); };
  ctx.JSZip = FakeZip;
  function json(x, status) { return new Response(JSON.stringify(x), { status: status || 200, headers: { 'content-type': 'application/json' } }); }
  function answer(item) {
    var s = SIZES[item.format] || SIZES.ig_portrait;
    var a = { templateId: item.templateId, format: item.format, width: s[0], height: s[1], caption: 'Caption ' + item.templateId + ' ' + item.format + ' ' };
    var custom = o.answer && o.answer(item);
    if (custom) return Object.assign(a, custom);
    a.html = postHtml(item.templateId, item.format, o.extraHtml);
    if (item.preview && FILL[item.templateId]) { a.example = true; a.filled = [FILL[item.templateId]]; }
    return a;
  }
  ctx.RevampAuth = {
    whenResolved: function () { return Promise.resolve(); },
    authedFetch: function (url, opts) {
      opts = opts || {};
      var u = new URL(url, 'https://ow.test'), q = {}, method = String(opts.method || 'GET').toUpperCase();
      u.searchParams.forEach(function (v, k) { q[k] = v; });
      var body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
      var rec = { path: u.pathname, url: url, q: q, method: method, body: body, headers: opts.headers || {}, signal: opts.signal };
      calls.push(rec);
      var key = method + ' ' + u.pathname;
      if (o.routes && o.routes[key]) return Promise.resolve(o.routes[key](q, body, rec));
      if (key === 'GET /api/promo/social/catalog') return Promise.resolve(json(catalog(o)));
      if (key === 'GET /api/promo/social/art') return Promise.resolve(json(ART));
      if (key === 'POST /api/promo/social/html') return Promise.resolve(json({ items: body.items.map(answer) }));
      if (key === 'GET /api/promo/image') {
        if (/broken/.test(q.url)) return Promise.resolve(json({ error: 'That picture is no longer there.' }, 404));
        if (/forbidden/.test(q.url)) return Promise.resolve(json({ error: 'no' }, 403));
        if (/refused|evil/.test(q.url)) return Promise.resolve(json({ error: 'Pictures can only be loaded from…' }, 400));
        return Promise.resolve(new Response(new Blob([new Uint8Array(8)], { type: 'image/png' }), { status: 200 }));
      }
      if (key === 'GET /api/promo/social/layout') return Promise.resolve(json(o.saved ? o.saved(q) : { saved: false }));
      if (key === 'POST /api/promo/social/layout/base') return Promise.resolve(json({ url: STORE + 'promo-layouts/' + q.key + '/base-' + calls.length + '.png', width: 2160, height: 2160 }));
      if (key === 'POST /api/promo/social/layout') return Promise.resolve(json({ ok: true, savedAt: 1700 }));
      if (key === 'POST /api/promo/social/layout/reset') return Promise.resolve(json({ ok: true, removed: true }));
      if (key === 'GET /api/promo/mailer/roster') return Promise.resolve(json(ROSTER));
      return Promise.resolve(json({ error: 'no route ' + key }, 404));
    }
  };
  ctx.fetch = function (url) {
    fetches.push(String(url));
    if (/^blob:/.test(url)) return Promise.resolve(new Response(blobStore[url] || new Blob([]), { status: 200 }));
    if (/broken/.test(url)) return Promise.resolve(new Response('', { status: 404 }));
    return Promise.resolve(new Response(new Blob([new Uint8Array(4)], { type: 'image/jpeg' }), { status: 200 }));
  };
  ctx.parent = { postMessage: function (m, origin) { posted.push({ m: m, origin: origin }); } };
  ctx.top = { location: { href: '' } };
  ctx.scrollY = 0;
  ctx.requestAnimationFrame = function (fn) { raf.push(fn); return raf.length; };
  ctx.ResizeObserver = function (cb) { this.observe = function (el) { ros.push({ cb: cb, el: el }); }; this.disconnect = function () {}; };
  ctx.createImageBitmap = function () { return Promise.resolve({ width: 2160, height: 2160, close: function () {} }); };
  ctx.__canvas = [];
  ctx.__webpSize = o.webpSize || null;
  ctx.__writeThrows = !!o.writeThrows;
  ctx.addEventListener = function (t, fn) { (winLs[t] = winLs[t] || []).push(fn); };
  ctx.removeEventListener = function () {};
  var art = { calls: [], psd: function (x) { art.calls.push(['psd', x]); return Promise.resolve(json({ ok: true })); },
    background: function (slot, x) { art.calls.push(['background', slot, x]); return Promise.resolve(json({ ok: true, slot: slot })); },
    logo: function (x) { art.calls.push(['logo', x]); return Promise.resolve(json({ ok: true })); },
    decorate: function (a) { art.calls.push(['decorate', a]); },
    picture: function (f) { art.calls.push(['picture', f]); return art.next ? art.next(f) : Promise.resolve({ url: STORE + 'promo-art/picture-1.png', width: 10, height: 10 }); } };
  var cap = { calls: [], dirtyVal: false, text: null,
    onLoad: function (i) { cap.calls.push(['onLoad', JSON.parse(JSON.stringify(i))]); }, state: function () { return { network: 'x', text: 'Caption typed' }; },
    dirty: function () { return cap.dirtyVal; }, markSaved: function () { cap.calls.push(['markSaved']); },
    textFor: function (tid) { cap.calls.push(['textFor', tid]); return cap.text; }, decorateOptions: function () { cap.calls.push(['decorateOptions']); } };
  if (o.art !== false) ctx.OWSArt = art;
  ctx.OWSCap = cap;
  ctx.owRenderCaption = function () {};
  vm.createContext(ctx);
  ctx.__inline = function (code, el, ev) { return vm.runInContext('(function (event) {' + code + '\n})', ctx).call(el, ev); };
  var loadErr = null;
  try {
    vm.runInContext(STUDIO, ctx, { filename: 'social-studio.js' });
    vm.runInContext(ADAPTER, ctx, { filename: 'oneworld-social.js' });
  } catch (e) { loadErr = e; }
  var realToast = ctx.toast;
  ctx.toast = function (m, ms) { toasts.push([String(m), ms]); return realToast(m, ms); };
  var B = {
    ctx: ctx, doc: doc, loadErr: loadErr, calls: calls, fetches: fetches, posted: posted, shots: shots, extracts: extracts, renders: renders, zips: zips,
    toasts: toasts, errors: errors, raf: raf, ros: ros, winLs: winLs, revoked: revoked, art: art, cap: cap, realToast: realToast,
    run: function (s) { return vm.runInContext(s, ctx); },
    $: function (id) { return doc.getElementById(id); },
    flushRaf: function () { var q = raf.splice(0); q.forEach(function (fn) { fn(); }); },
    key: function (k, init) { return fire(doc.activeElement || doc.body, 'keydown', Object.assign({ key: k }, init || {})); },
    modal: function () { var m = doc.getElementById('uiModal'); return m.classList.contains('on') ? doc.getElementById('uiModalTitle').textContent : null; },
    answerModal: function (yes) { doc.getElementById(yes ? 'uiModalOk' : 'uiModalCancel').onclick(); },
    htmlCalls: function () { return calls.filter(function (c) { return c.path === '/api/promo/social/html'; }); },
    lastToast: function () { return toasts[toasts.length - 1] || []; },
    message: function (data, from) { (winLs.message || []).forEach(function (fn) { fn({ data: data, origin: from && from.origin || 'https://ow.test', source: from && 'source' in from ? from.source : ctx.parent }); }); }
  };
  return B;
}
function respJson(r) { return r.json(); }

(async function () {
  /* ---- F.15 and the load: ES5, and it loads after the platform's code on the page's own markup ---- */
  var code = ADAPTER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  check('F.15: no let', !/\blet\s/.test(code));
  check('F.15: no const', !/\bconst\s/.test(code));
  check('F.15: no arrow functions', code.indexOf('=>') === -1);
  check('F.15: no async', !/\basync\b/.test(code));
  check('F.15: no template literals or classes', code.indexOf('`') === -1 && !/\bclass\s+[A-Z]/.test(code));
  check('the header says what the file is, plainly', /^\/\* Oneworld's side of the promotional platform's social posts studio/.test(ADAPTER));
  check('the copied code names the patched hooks this file gives it', ['owLeaveEditor()', 'owNudgeSnap()', 'owConfirmReset()', 'owMayDiscard()'].every(function (s) { return STUDIO.indexOf(s) !== -1; }));

  var B = boot();
  check('oneworld-social.js loads after social-studio.js without declaring any of its names again', B.loadErr === null, B.loadErr && String(B.loadErr.message));
  await flush(60);
  check('replaced: toast, cardHtml, loadThumbs are Oneworld\'s', /rvToast/.test(String(B.ctx.toast === B.realToast ? B.ctx.toast : B.realToast)) &&
    /data-ow-zoom/.test(String(B.ctx.cardHtml)) && /owCachedHtml/.test(String(B.ctx.loadThumbs)));
  check('the page opens on the event: its header and the template cards', /QA Summit/.test(B.$('content').innerHTML) && B.doc.querySelectorAll('.tcard').length === 4);
  check('the platform\'s Social / Mailers switch is hidden (S.product is social)', B.$('evNav').style.display === 'none');
  check('9th edition chip, hashtag chip, no Website link while unpublished', /9th edition/.test(B.$('content').innerHTML) && /#QASummit26/.test(B.$('content').innerHTML) && !/Website ↗/.test(B.$('content').innerHTML));
  check('the upload strip is decorated with the art (OWSArt.decorate)', B.art.calls.some(function (c) { return c[0] === 'decorate' && c[1] && c[1].bg1 === true; }));

  /* ---- F.1: every row of §6c's table ---- */
  var paths = B.calls.map(function (c) { return c.method + ' ' + c.path + (c.q.eventId ? '?eventId=' + c.q.eventId : ''); });
  check('F.1: the catalog is Oneworld\'s social catalog', paths.indexOf('GET /api/promo/social/catalog?eventId=qa-1') !== -1, paths);
  check('F.1: the assets are the event\'s art, kept in OWS.art', paths.indexOf('GET /api/promo/social/art?eventId=qa-1') !== -1 && B.run('OWS.art.bg1') === true);
  check('F.1: the mailers are never asked for', !B.calls.some(function (c) { return /mailer(s)?$/.test(c.path); }));
  var nCalls = B.calls.length, rMail = await B.run('api("/api/mailers?portal=&event=qa-1")');
  check('F.1: /api/mailers answers 200 null, with no request', rMail.status === 200 && (await rMail.json()) === null && B.calls.length === nCalls);
  var roster = await (await B.run('api("/api/editor/assets?portal=&event=qa-1")')).json();
  check('F.1: the Insert tab\'s people: the roster, only those with a picture', B.calls[B.calls.length - 1].path === '/api/promo/mailer/roster' &&
    roster.speakers.length === 1 && roster.speakers[0].name === 'Asha Rao' && roster.sponsors.length === 1 && roster.sponsors[0].title === 'Acme', roster);
  var rr = await B.run('api("/api/editor/reset",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({portal:"p",event:"e",templateId:"generic.announcement",format:"ig_square",params:{theme:"light",bg:"2",kicker:"k"}})})');
  var resetCall = B.calls[B.calls.length - 1];
  check('F.1: Reset is Oneworld\'s layout reset, the event named by Oneworld and the key\'s parts only', rr.ok && resetCall.method === 'POST' && resetCall.path === '/api/promo/social/layout/reset' &&
    JSON.stringify(resetCall.body) === JSON.stringify({ eventId: 'qa-1', templateId: 'generic.announcement', format: 'ig_square', theme: 'light', bg: '2' }), resetCall.body);
  var up = { method: 'POST', body: { fake: 'file' } };
  B.ctx.__up = up;
  await B.run('api("/api/psd?portal=&event=qa-1",__up)');
  await B.run('api("/api/background?portal=&event=qa-1&slot=2",__up)');
  await B.run('api("/api/logo?portal=&event=qa-1",__up)');
  var upCalls = B.art.calls.filter(function (c) { return /psd|background|logo/.test(c[0]); });
  check('F.1: PSD, background n and logo uploads go to OWSArt with the platform\'s request', upCalls.length === 3 && upCalls[0][1] === up && upCalls[1][1] === '2' && upCalls[1][2] === up && upCalls[2][1] === up, upCalls.map(function (c) { return c.slice(0, 2); }));
  await B.run('api("/api/promo/social/html",{method:"POST",body:JSON.stringify({portal:"p",event:"e",award:"a",items:[],captionOnly:true})})');
  var pass = B.calls[B.calls.length - 1];
  check('F.1: Oneworld\'s own routes pass through, portal/event/award out and eventId in', pass.path === '/api/promo/social/html' &&
    JSON.stringify(pass.body) === JSON.stringify({ items: [], captionOnly: true, eventId: 'qa-1' }), pass.body);
  var r404 = await B.run('api("/api/skeleton?portal=x")');
  check('F.1: anything else is a plain 404 with a reason', r404.status === 404 && !!(await r404.json()).error);
  var noArt = boot({ art: false });
  await flush(40);
  var r503 = await noArt.run('api("/api/logo",{method:"POST"})');
  check('an upload before oneworld-social-art.js loaded says so (503), never throws', r503.status === 503 && /Reload/.test((await r503.json()).error));

  /* ---- F.2: api() never rejects ---- */
  var C2 = boot(); await flush(40);
  C2.ctx.RevampAuth.authedFetch = function () { throw new Error('boom'); };
  var a1 = await C2.run('api("/api/catalog?portal=&event=qa-1")');
  check('F.2: authedFetch throwing: a Response, not a rejection', a1 instanceof Response && a1.status === 503 && !!(await a1.json()).error);
  C2.ctx.RevampAuth.authedFetch = function () { var e = new Error('You are signed out. Sign in again to continue.'); e.status = 401; return Promise.reject(e); };
  var a2 = await C2.run('api("/api/assets?portal=&event=qa-1")');
  check('F.2: signed out: 401 with its words', a2.status === 401 && /signed out/.test((await a2.json()).error));
  C2.ctx.RevampAuth.authedFetch = function () { var e = new Error('Could not reach the sign-in service.'); e.status = 0; return Promise.reject(e); };
  var a3 = await C2.run('api("/api/editor/assets")');
  check('F.2: a status a Response cannot carry (0) becomes 503, its words kept', a3.status === 503 && /sign-in service/.test((await a3.json()).error));
  C2.ctx.RevampAuth.authedFetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };
  var a4 = await C2.run('api("/api/editor/save",{method:"POST",body:JSON.stringify({templateId:"generic.announcement",format:"ig_square",params:{},base:"https://x/b.png",elements:[]})})');
  check('F.2: no network: 503 with plain words', a4.status === 503 && /could not be reached/.test((await a4.json()).error));
  var a5 = await C2.run('api(null)');
  check('F.2: even a nonsense call resolves', a5 instanceof Response);

  /* ---- F.3a: the cards' posts: one request, kept until refreshThumbs ---- */
  var H1 = B.htmlCalls().filter(function (c) { return !c.body.captionOnly; });
  check('F.3a: the page asked for every card in one html request', H1.length === 1 && H1[0].body.items.length === 4, H1.length);
  var three = boot(); await flush(60);
  var before = three.htmlCalls().length;
  three.run('OWS.htmlCache={}; var __t=CAT.catalog.categories[0].templates.slice(0,3); loadThumbs(__t); loadThumbs(__t); loadThumbs(__t);');
  await flush(60);
  check('F.3a: three thumbnail calls make one html request', three.htmlCalls().length === before + 1 && three.htmlCalls()[before].body.items.length === 3, three.htmlCalls().length - before);
  three.run('refreshThumbs()');
  await flush(60);
  check('F.3a: refreshThumbs empties the cache: asked again, once', three.htmlCalls().length === before + 2);
  check('F.3a: the old card pictures are let go on refresh', three.revoked.length >= 3, three.revoked.length);

  /* ---- F.3b: previews ---- */
  var items = H1[0].body.items, byId = {};
  items.forEach(function (it) { byId[it.templateId] = it; });
  check('F.3b: available templates are asked as they are, at their first size, default options',
    byId['generic.announcement'].preview === false && byId['generic.announcement'].format === 'ig_square' && JSON.stringify(byId['generic.announcement'].params) === '{}');
  check('F.3b: unavailable templates are asked with preview:true', byId['generic.who-should-attend'].preview === true && byId['speaker.individual'].preview === true);
  check('F.3b: the Testimonial card is always a preview (its quote is empty by default)', byId['generic.testimonial'].preview === true);
  var spk = B.$('tc-speaker_individual'), wsa = B.$('tc-generic_who_should_attend'), ann = B.$('tc-generic_announcement'), tst = B.$('tc-generic_testimonial');
  check('F.3b: an example card gets the Example badge on its picture', !!B.$('th-speaker_individual').querySelector('.ow-ex') && B.$('th-speaker_individual').querySelector('.ow-ex').textContent === 'Example' &&
    !!B.$('th-speaker_individual').querySelector('img'));
  var note = spk.querySelector('.ow-ex-note'), link = note && note.querySelector('a');
  check('F.3b: … and a note with the console link to add the real ones', !!link && link.getAttribute('href') === '/edit-event.html?event=qa-1#content/speakers' &&
    link.getAttribute('target') === '_top' && /^Example speakers — add yours to use this$/.test(note.textContent), note && note.textContent);
  check('F.3b: the note sits in the card body, above the needs line', note && note.parentNode === spk.querySelector('.b') && note.nextSibling === spk.querySelector('.cta'));
  var wNote = wsa.querySelector('.ow-ex-note');
  check('F.3b: where the console has no place to add them (the brief\'s audience), the note says so and has no link', !!wNote && !wNote.querySelector('a') && /no “who should attend” list/.test(wNote.textContent));
  check('F.3b: an unavailable card has no button and no Generate action', spk.querySelectorAll('button').length === 0 && !/Generate/.test(spk.innerHTML) && /needs speakers/.test(spk.innerHTML) &&
    spk.classList.contains('dis'));
  check('F.3b: its picture still opens the full-size view (a focusable picture, not a button)', B.$('th-speaker_individual').getAttribute('data-ow-zoom') === 'speaker.individual' &&
    B.$('th-speaker_individual').getAttribute('tabindex') === '0');
  check('F.3b: an available card: the picture is a button, the source\'s Generate & edit stays', ann.querySelector('button.thumb') === B.$('th-generic_announcement') &&
    ann.querySelector('.cta button').getAttribute('onclick') === 'openEditor("generic.announcement")' && ann.querySelector('.cta button').textContent === 'Generate & edit →');
  check('F.3b: the Testimonial card is openable and badged as an example', !!B.$('th-generic_testimonial').querySelector('.ow-ex') && tst.querySelector('.cta button').getAttribute('onclick') === 'openEditor("generic.testimonial")' &&
    /Example quote and its speaker/.test(tst.querySelector('.ow-ex-note').textContent));
  check('F.3b: an available card that is not an example has no badge', !B.$('th-generic_announcement').querySelector('.ow-ex') && !ann.querySelector('.ow-ex-note'));
  var thumbShots = B.shots.slice(0, 4);
  check('F.3b: thumbnails are drawn once each, at pixelRatio 1 (1080 px)', B.shots.length === 4 && thumbShots.every(function (s) { return s.opts.pixelRatio === 1 && s.opts.width === 1080; }), B.shots.map(function (s) { return s.opts; }));
  var drawOrder = thumbShots.map(function (s) { return (/data-post="([^|"]+)/.exec(s.html) || [])[1]; });
  check('F.3b: available ones first, in catalog order, then the rest', drawOrder.join() === 'generic.announcement,generic.testimonial,generic.who-should-attend,speaker.individual', drawOrder);
  check('F.3b: no outside picture reaches the drawing (all inlined as blob:)', thumbShots.every(function (s) { return !/\ssrc="https?:/.test(s.html) && !/style="[^"]*url\((&quot;|')?https?:/.test(s.html); }));
  check('F.3b: the cards draw no toast (a left-out picture on a card is not news)', !B.toasts.some(function (t) { return /left out/.test(t[0]); }));

  var Sp = boot({ sparse: true, answer: function (it) {
    if (it.templateId === 'generic.announcement' && it.preview) return { html: postHtml(it.templateId, it.format), state: 'no-date-venue' };
    if (it.templateId === 'speaker.individual') return { error: 'needs speakers', missing: ['speakers'] };
    return null;
  }, shot: function (rec) { return /data-post="generic.who-should-attend/.test(rec.html) ? Promise.reject(new Error('draw failed')) : Promise.resolve(new Blob([new Uint8Array(4)], { type: 'image/png' })); } });
  await flush(80);
  var annCell = Sp.$('th-generic_announcement');
  check('F.3b: a state gap: the real post with a chip, no badge, no note', !!annCell.querySelector('.ow-chip') && annCell.querySelector('.ow-chip').textContent === 'No date or venue yet' &&
    !annCell.querySelector('.ow-ex') && !Sp.$('tc-generic_announcement').querySelector('.ow-ex-note') && !!annCell.querySelector('img'));
  check('F.3b: a template that still cannot be shown says "preview N/A" as the platform did', /preview N\/A/.test(Sp.$('th-speaker_individual').innerHTML));
  check('F.3b: a failed draw shows the platform\'s "—"', /—/.test(Sp.$('th-generic_who_should_attend').innerHTML) && !Sp.$('th-generic_who_should_attend').querySelector('img'));

  var held = deferred(), nHtml = 0;
  var Old = boot({ routes: { 'POST /api/promo/social/html': function (q, body) {
    function resp(stale) {
      return new Response(JSON.stringify({ items: body.items.map(function (it) {
        var sz = SIZES[it.format];
        return stale ? { templateId: it.templateId, format: it.format, error: 'stale' } : { templateId: it.templateId, format: it.format, width: sz[0], height: sz[1], caption: '', html: postHtml(it.templateId, it.format) };
      }) }), { status: 200 });
    }
    return nHtml++ === 0 ? held.p.then(function () { return resp(true); }) : resp(false);
  } } });
  await flush(30);
  Old.run('refreshThumbs()'); await flush(80);
  held.ok(); await flush(40);
  check('cards asked for again: an answer to the earlier request never overwrites the newer pictures', nHtml === 2 &&
    ['generic_announcement', 'generic_testimonial', 'speaker_individual'].every(function (id) { return !!Old.$('th-' + id).querySelector('img'); }), nHtml);

  /* full-size view */
  B.posted.length = 0;
  fire(B.$('th-generic_announcement'), 'click');
  var lb = B.doc.querySelector('.ow-lb');
  check('the full-size view opens on a click, filling the window (rvSocialStudio open)', !!lb && B.posted.some(function (p) { return p.m.rvSocialStudio === 'open' && p.origin === 'https://ow.test'; }));
  check('… the picture at its full width, the name, Generate & edit, and never a download', !!lb && lb.querySelector('.ow-lb-img').getAttribute('src') === B.run('thumbCache["generic.announcement"]') &&
    lb.querySelector('.ow-lb-t').textContent === 'Announcement' && /Generate & edit →/.test(lb.textContent) && !/download/i.test(lb.textContent) && lb.getAttribute('role') === 'dialog');
  B.key('Escape');
  check('Escape closes it (rvSocialStudio close)', !B.doc.querySelector('.ow-lb') && B.posted.some(function (p) { return p.m.rvSocialStudio === 'close'; }));
  B.$('th-speaker_individual').focus();
  B.key('Enter');
  var lb2 = B.doc.querySelector('.ow-lb');
  check('Enter on an example card\'s picture opens its full-size view: badge, note with link, no Generate', !!lb2 && !!lb2.querySelector('.ow-ex') &&
    !!lb2.querySelector('.ow-ex-note a') && !/Generate/.test(lb2.textContent));
  fire(lb2.querySelector('.ow-lb-x'), 'click');
  check('✕ closes it', !B.doc.querySelector('.ow-lb'));
  fire(B.$('th-generic_announcement'), 'click');
  var genBtn = B.doc.querySelector('.ow-lb .btn');
  fire(genBtn, 'click');
  await flush(60);
  check('Generate & edit in the full-size view closes it and opens the editor on that template', !B.doc.querySelector('.ow-lb') && B.run('owEditorOpen()') === true && B.run('EDIT.tid') === 'generic.announcement');
  B.run('closeEditor()');

  /* ---- F.4: queue lanes ---- */
  var Q = boot(); await flush(60);
  var order = [], gates = [];
  for (var qi = 0; qi < 5; qi++) (function (n) { Q.run('OWS').queue.run('thumb', function () { order.push('t' + n); return new Promise(function (r) { gates.push(r); }); }); })(qi);
  Q.run('OWS').queue.run('editor', function () { order.push('E'); return 'e'; });
  await flush(5);
  check('F.4: one drawing at a time', order.join() === 't0', order);
  gates[0](); await flush(5);
  check('F.4: with thumbnails waiting, the editor\'s job runs next', order.join() === 't0,E,t1', order);
  gates.slice(1).forEach(function (g) { g(); }); await flush(5);
  gates.slice(1).forEach(function (g) { g(); }); await flush(5);
  var holds = [];
  var Q2 = boot({ shot: function (rec) { var d = deferred(); holds.push({ rec: rec, d: d }); return d.p; } });
  await flush(60);
  check('F.4: the cards are queued (the first being drawn)', holds.length === 1 && holds[0].rec.opts.pixelRatio === 1, holds.length);
  Q2.run('openEditor("generic.announcement")');
  await flush(40);
  holds[0].d.ok(new Blob([new Uint8Array(4)], { type: 'image/png' }));
  await flush(40);
  check('F.4: an editor load starts before the four cards still waiting', holds.length === 2 && holds[1].rec.opts.pixelRatio === 2, holds.map(function (h) { return h.rec.opts.pixelRatio; }));
  holds[1].d.ok(new Blob([new Uint8Array(4)], { type: 'image/png' })); await flush(30);
  check('F.4: … and draws its second pass before them too', holds.length === 3 && holds[2].rec.opts.pixelRatio === 2);

  /* ---- F.5: the editor load ---- */
  var E = boot(); await flush(60);
  E.posted.length = 0; E.calls.length = 0; E.shots.length = 0;
  E.run('openEditor("generic.announcement")');
  await flush(80);
  var layoutGet = E.calls.filter(function (c) { return c.method === 'GET' && c.path === '/api/promo/social/layout'; })[0];
  check('F.5 fresh: the saved layout is asked for by its key\'s parts', !!layoutGet && layoutGet.q.templateId === 'generic.announcement' && layoutGet.q.format === 'ig_square' &&
    layoutGet.q.theme === 'dark' && layoutGet.q.bg === '' && layoutGet.q.eventId === 'qa-1', layoutGet && layoutGet.q);
  var hEd = E.htmlCalls();
  check('F.5 fresh: none saved → the post is built on the server with the editor\'s options', hEd.length === 1 && hEd[0].body.items.length === 1 &&
    JSON.stringify(hEd[0].body.items[0]) === JSON.stringify({ templateId: 'generic.announcement', format: 'ig_square', params: { theme: 'dark' } }), hEd[0] && hEd[0].body);
  check('F.5 fresh: flattened once (OWSocial.extract) in a frame of the post\'s size', E.extracts.length === 1 && E.extracts[0].W === 1080 && E.extracts[0].H === 1080);
  var exHtml = E.extracts[0] ? E.extracts[0].html : '';
  check('F.5 fresh: nothing in the frame can run (no on… handler, script, frame, object or embed; correctness 10)', !/\son[a-z]+=/i.test(exHtml) && !/<script|<iframe|<object|<embed/i.test(exHtml), exHtml.slice(0, 300));
  check('F.5 fresh: the base is drawn twice at pixelRatio 2', E.shots.length === 2 && E.shots.every(function (s) { return s.opts.pixelRatio === 2 && s.opts.width === 1080 && s.opts.height === 1080; }), E.shots.map(function (s) { return s.opts; }));
  check('F.5 fresh: the stage shows the drawn base (a blob:)', /^blob:/.test(E.run('EDIT.base')) && E.$('edBase').getAttribute('src') === E.run('EDIT.base'));
  check('F.5 fresh: elements are the flattened ones, with their real picture addresses (data-ow-src)', E.run('EDIT.els.length') === 4 &&
    E.run('EDIT.els[0].src') === STORE + 'promo-art/logo.png' && E.run('EDIT.els[1].src') === 'https://img.etb2bimg.com/speaker.jpg', E.run('JSON.stringify(EDIT.els.map(function(e){return e.src||e.text}))'));
  check('F.5 fresh: the studio took the window', E.posted.some(function (p) { return p.m.rvSocialStudio === 'open'; }));
  var onLoad = E.cap.calls.filter(function (c) { return c[0] === 'onLoad'; });
  check('F.5 fresh: the Caption tab is told what is on screen', onLoad.length === 1 && onLoad[0][1].templateId === 'generic.announcement' && onLoad[0][1].format === 'ig_square' &&
    JSON.stringify(onLoad[0][1].params) === '{"theme":"dark"}' && onLoad[0][1].saved === null, onLoad);
  check('F.5 fresh: the unsaved-changes snapshot and the loaded controls are kept', E.run('OWS.snap === JSON.stringify(EDIT.els) && OWS.loaded.tid === "generic.announcement" && OWS.loaded.fmt === "ig_square"') === true);
  check('F.5 fresh: a picture left out is told (6 s), naming its host', E.toasts.some(function (t) { return t[0] === 'A picture could not be loaded and was left out: img.etb2bimg.com' && t[1] === 6000; }), E.toasts);
  check('F.5 fresh: not dirty right after a load', E.run('owDirty()') === false);

  var Sv = boot({ saved: function (q) {
    return q.templateId === 'generic.testimonial' ? { saved: true, width: 1080, height: 1080, base: STORE + 'promo-layouts/k/b.png', savedAt: 5,
      elements: [{ id: 'a', type: 'text', x: 1, y: 2, w: 100, h: 20, text: 'Quote here' }], params: { quote: 'A real quote', kicker: 'K' }, caption: { network: 'x', text: 'Hi' } } : { saved: false };
  } });
  await flush(60);
  Sv.calls.length = 0;
  Sv.run('openEditor("generic.testimonial")');
  await flush(60);
  check('F.5 saved: no html request', Sv.htmlCalls().length === 0);
  check('F.5 saved: the saved base and elements are on the stage', Sv.run('EDIT.base') === STORE + 'promo-layouts/k/b.png' && Sv.run('EDIT.els.length') === 1 && Sv.run('EDIT.els[0].text') === 'Quote here');
  check('F.5 saved: "↺ Loaded your saved layout for this event"', Sv.toasts.some(function (t) { return t[0] === '↺ Loaded your saved layout for this event'; }));
  check('F.5 saved (V19): edParams are the saved options, theme and background from the key', Sv.run('JSON.stringify(edParams)') === JSON.stringify({ quote: 'A real quote', kicker: 'K', theme: 'dark' }), Sv.run('JSON.stringify(edParams)'));
  var svLoad = Sv.cap.calls.filter(function (c) { return c[0] === 'onLoad'; })[0];
  check('F.5 saved: the Caption tab gets the saved options and the saved caption', !!svLoad && svLoad[1].params.quote === 'A real quote' && svLoad[1].saved && svLoad[1].saved.caption.text === 'Hi' && svLoad[1].saved.savedAt === 5, svLoad);
  Sv.run('edDownload()');
  await flush(80);
  check('F.5 saved: a saved Testimonial with its quote downloads (fidelity 3)', Sv.renders.length === 1 && Sv.toasts.some(function (t) { return t[0] === '✓ Downloaded'; }) &&
    !Sv.toasts.some(function (t) { return /real quote, never/.test(t[0]); }));
  check('F5: Download PNG is the edited post drawn twice at 2×', Sv.shots.slice(-2).every(function (s) { return s.opts.pixelRatio === 2; }) && Sv.renders[0].base === STORE + 'promo-layouts/k/b.png');
  check('F5: the saved base on Storage is fetched through Oneworld\'s picture route', Sv.calls.some(function (c) { return c.path === '/api/promo/image' && c.q.url === STORE + 'promo-layouts/k/b.png' && c.q.eventId === 'qa-1'; }));

  var slowGet = deferred(), nGet = 0;
  var Race = boot({ routes: { 'GET /api/promo/social/layout': function (q) {
    if (nGet++ === 0) return slowGet.p.then(function () { return new Response(JSON.stringify({ saved: true, width: 1080, height: 1080, base: STORE + 'promo-layouts/old/b.png',
      elements: [{ id: 'old', type: 'text', x: 0, y: 0, w: 10, h: 10, text: 'Earlier template' }], params: { quote: 'Old quote' }, caption: null, savedAt: 1 }), { status: 200 }); });
    return new Response('{"saved":false}', { status: 200 });
  } } });
  await flush(60);
  Race.run('openEditor("generic.testimonial")'); await flush(20);
  Race.$('edTpl').value = 'generic.announcement'; Race.run('switchEditorTpl()'); await flush(80);
  check('a template chosen while the earlier one is still answering: the newer one is drawn', Race.run('EDIT.tid') === 'generic.announcement' && Race.run('EDIT.els.length') === 4);
  slowGet.ok(); await flush(40);
  check('… and the earlier answer, landing last, is dropped (stage, options and toasts untouched)', Race.run('EDIT.tid') === 'generic.announcement' && Race.run('EDIT.els.length') === 4 &&
    Race.run('EDIT.els.every(function (e) { return e.id !== "old"; })') && Race.run('edParams.quote') === undefined &&
    !Race.toasts.some(function (t) { return /Loaded your saved layout/.test(t[0]); }) && Race.run('OWS.loaded.tid') === 'generic.announcement');

  /* ---- F.6: save ---- */
  E.calls.length = 0;
  var blobBase = E.run('EDIT.base');
  await E.run('edSave()');
  await flush(40);
  var baseUp = E.calls.filter(function (c) { return c.path === '/api/promo/social/layout/base'; })[0], saveCall = E.calls.filter(function (c) { return c.method === 'POST' && c.path === '/api/promo/social/layout'; })[0];
  check('F.6: a drawn (blob:) base is stored first, under its layout key, as PNG', !!baseUp && baseUp.q.key === 'generic.announcement__ig_square__dark_bgpsd' && baseUp.q.eventId === 'qa-1' &&
    baseUp.headers['content-type'] === 'image/png' && baseUp.body instanceof Blob, baseUp && baseUp.q);
  check('F.6: then the layout, with the stored base, its options and the Caption tab\'s words', !!saveCall && saveCall.body.base === STORE + 'promo-layouts/generic.announcement__ig_square__dark_bgpsd/base-1.png' &&
    saveCall.body.theme === 'dark' && saveCall.body.bg === '' && JSON.stringify(saveCall.body.params) === '{"theme":"dark"}' && saveCall.body.caption.text === 'Caption typed' &&
    saveCall.body.elements.length === 4 && saveCall.body.eventId === 'qa-1' && saveCall.body.portal === undefined, saveCall && saveCall.body);
  check('F.6: the platform\'s toast', E.lastToast()[0] === '✓ Saved — your edits will reload next time');
  check('F.6: EDIT.base is now the stored one; the snapshot and the caption are marked saved', E.run('EDIT.base') === saveCall.body.base && E.run('owDirty()') === false &&
    E.cap.calls.some(function (c) { return c[0] === 'markSaved'; }));
  E.calls.length = 0;
  E.run('EDIT.els[0].x = 333');
  check('an edit makes the layout dirty', E.run('owDirty()') === true);
  await E.run('edSave()'); await flush(30);
  check('F.6: a Storage base is not uploaded again', !E.calls.some(function (c) { return c.path === '/api/promo/social/layout/base'; }) &&
    E.calls.some(function (c) { return c.method === 'POST' && c.path === '/api/promo/social/layout' && c.body.base === saveCall.body.base; }));
  E.calls.length = 0;
  E.run('edDownload()'); await flush(60);
  check('F.6: after a save, a download draws the base from this page (no Storage fetch)', !E.calls.some(function (c) { return c.path === '/api/promo/image' && /promo-layouts/.test(c.q.url); }) &&
    E.renders[E.renders.length - 1].base === saveCall.body.base);
  check('the drawn base is kept while it is on screen', E.revoked.indexOf(blobBase) === -1);

  var big = boot({ shotSize: 9 * 1024 * 1024, webpSize: function (q) { return q === 0.92 ? 8 * 1024 * 1024 : 7 * 1024 * 1024; } });
  await flush(80);
  big.run('openEditor("generic.announcement")'); await flush(80);
  big.calls.length = 0;
  await big.run('edSave()'); await flush(40);
  var bigUp = big.calls.filter(function (c) { return c.path === '/api/promo/social/layout/base'; })[0];
  check('F.6 (V20): a PNG over 8 MiB goes as WebP, 0.92 then 0.85, the first ≤ 7.5 MiB', !!bigUp && bigUp.headers['content-type'] === 'image/webp' && bigUp.body.size === 7 * 1024 * 1024 &&
    JSON.stringify(big.ctx.__canvas.map(function (c) { return c.q; })) === '[0.92,0.85]', big.ctx.__canvas);
  var huge = boot({ shotSize: 9 * 1024 * 1024, webpSize: function () { return 8 * 1024 * 1024; } });
  await flush(80);
  huge.run('openEditor("generic.announcement")'); await flush(80);
  huge.calls.length = 0;
  await huge.run('edSave()'); await flush(40);
  check('F.6: too large at every step: no upload, "Save failed:" with the reason (6 s)', !huge.calls.some(function (c) { return /layout/.test(c.path); }) &&
    huge.lastToast()[0] === 'Save failed: This layout is too large to save. Remove some pictures or text and save again.' && huge.lastToast()[1] === 6000, huge.lastToast());
  var moved = boot({ routes: { 'POST /api/promo/social/layout': function () { return new Response(JSON.stringify({ error: 'This layout was changed by someone else meanwhile. Reload it, then save again.' }), { status: 409 }); } } });
  await flush(60);
  moved.run('openEditor("generic.announcement")'); await flush(80);
  await moved.run('edSave()'); await flush(40);
  check('F.6 (S28): a refused save shows the server\'s reason', moved.lastToast()[0] === 'Save failed: This layout was changed by someone else meanwhile. Reload it, then save again.' && moved.lastToast()[1] === 6000);
  check('F.6: and stays unsaved (EDIT.base still the drawn one)', /^blob:/.test(moved.run('EDIT.base')));
  /* a save answer that lands after the same template and size were drawn again on another theme or background is for
     a layout no longer on screen: it marks nothing saved (the whole layout key is checked, not only template and size) */
  async function lateSave(swap) {
    var held = deferred();
    var L = boot({ routes: { 'POST /api/promo/social/layout': function () { return held.p.then(function () { return new Response('{"ok":true,"savedAt":1800}', { status: 200 }); }); } } });
    await flush(60);
    L.run('openEditor("generic.announcement")'); await flush(80);
    L.run('EDIT.els[0].x = 777');
    var saving = L.run('edSave()'); await flush(30);
    swap(L); await flush(10);
    L.answerModal(true); await flush(80);
    var redrawn = L.run('EDIT.tid') === 'generic.announcement' && L.run('EDIT.fmt') === 'ig_square' && L.run('owDirty()') === false &&
      L.calls.some(function (c) { return c.method === 'POST' && c.path === '/api/promo/social/layout'; });
    held.ok(); await saving; await flush(30);
    return { L: L, redrawn: redrawn };
  }
  var lateTheme = await lateSave(function (L) { fire(L.$('edTheme').querySelector('[data-v="light"]'), 'click'); });
  check('F.6: a save answer after a reload on another theme marks nothing saved (snapshot and caption left as the reload set them)', lateTheme.redrawn &&
    lateTheme.L.run('edParams.theme') === 'light' && lateTheme.L.lastToast()[0] === '✓ Saved — your edits will reload next time' &&
    !lateTheme.L.cap.calls.some(function (c) { return c[0] === 'markSaved'; }) && lateTheme.L.run('OWS.snap === JSON.stringify(EDIT.els)') === true && lateTheme.L.run('owDirty()') === false,
    { redrawn: lateTheme.redrawn, theme: lateTheme.L.run('edParams.theme'), dirty: lateTheme.L.run('owDirty()'), cap: lateTheme.L.cap.calls });
  var lateBg = await lateSave(function (L) {
    L.$('edBg').innerHTML = '<option value="">PSD</option><option value="1">Upload 1</option>';
    L.$('edBg').value = '1'; L.run('edSetBg()');
  });
  check('F.6: … and after a reload on another background too', lateBg.redrawn && lateBg.L.run('edParams.bg') === '1' &&
    !lateBg.L.cap.calls.some(function (c) { return c[0] === 'markSaved'; }) && lateBg.L.run('OWS.snap === JSON.stringify(EDIT.els)') === true && lateBg.L.run('owDirty()') === false,
    { redrawn: lateBg.redrawn, bg: lateBg.L.run('edParams.bg'), dirty: lateBg.L.run('owDirty()'), cap: lateBg.L.cap.calls });

  /* ---- F.7: the unsaved-changes guard ---- */
  var G = boot(); await flush(60);
  G.run('openEditor("generic.announcement")'); await flush(80);
  G.run('EDIT.els[0].x = 999');
  var ta = G.doc.createElement('textarea'); G.doc.body.appendChild(ta); ta.focus();
  G.key('Escape');
  check('F.7: Escape while typing in a field does nothing', G.modal() === null && G.run('owEditorOpen()') === true);
  G.doc.body.focus();
  G.key('Escape', { defaultPrevented: true });
  check('F.7: Escape already handled (the dialog\'s own, fidelity 9) does nothing', G.modal() === null && G.run('owEditorOpen()') === true);
  G.key('Escape');
  check('F.7: dirty + Escape asks "Leave without saving?"', G.modal() === 'Leave without saving?' && G.$('uiModalOk').textContent === 'Leave without saving' && G.$('uiModalCancel').textContent === 'Keep editing');
  G.answerModal(false); await flush(10);
  check('F.7: Keep editing keeps the editor', G.run('owEditorOpen()') === true && G.modal() === null);
  G.doc.body.focus();
  G.key('Escape');
  check('F.7: Escape again asks again', G.modal() === 'Leave without saving?');
  await flush(40);                                  // the dialog focuses its button, as it does in the browser
  var dlgEsc = G.key('Escape');
  await flush(10);
  check('F.7: Escape in that dialog closes it and does not ask again (fidelity 9)', G.modal() === null && G.run('owEditorOpen()') === true && dlgEsc.defaultPrevented === true,
    [G.modal(), dlgEsc.defaultPrevented]);
  G.doc.body.focus();
  /* switching template with unsaved edits */
  G.calls.length = 0;
  G.$('edTpl').value = 'generic.testimonial';
  G.run('switchEditorTpl()');
  await flush(10);
  check('F.7: dirty + template switch asks "Discard your changes?"', G.modal() === 'Discard your changes?' && G.$('uiModalOk').textContent === 'Discard changes');
  G.answerModal(false); await flush(10);
  check('F.7: Cancel puts the template, size and options back, and loads nothing', G.$('edTpl').value === 'generic.announcement' && G.$('edFmt').value === 'ig_square' &&
    G.$('edFmt').querySelectorAll('option').length === 4 && G.run('JSON.stringify(edParams)') === '{"theme":"dark"}' && G.calls.length === 0, [G.$('edTpl').value, G.$('edFmt').value, G.run('JSON.stringify(edParams)')]);
  fire(G.$('edTheme').querySelector('[data-v="light"]'), 'click');
  await flush(10);
  check('F.7: a theme switch asks too', G.modal() === 'Discard your changes?');
  G.answerModal(false); await flush(10);
  check('F.7: Cancel puts the theme back (Dark on)', G.run('edParams.theme') === 'dark' && G.$('edTheme').querySelector('[data-v="dark"]').classList.contains('on') &&
    !G.$('edTheme').querySelector('[data-v="light"]').classList.contains('on'));
  G.$('edBg').innerHTML = '<option value="">PSD</option><option value="1">Upload 1</option>';
  G.$('edBg').value = '1';
  G.run('edSetBg()'); await flush(10);
  G.answerModal(false); await flush(10);
  check('F.7: Cancel on a background switch puts the background back', G.$('edBg').value === '' && G.run('edParams.bg') === undefined);
  /* S5′: Apply & re-render with Cancel */
  G.run('edMode="options"; paintSide();');
  var titleField = G.doc.querySelector('#edOpts [data-key="kicker"]');
  titleField.value = 'Typed, not applied';
  check('the Options tab is decorated by the Caption module (OWSCap.decorateOptions)', G.cap.calls.some(function (c) { return c[0] === 'decorateOptions'; }));
  var toastsBefore = G.toasts.length;
  G.run('applyOptions()'); await flush(10);
  check('F.7 (S5′): Apply & re-render with edits asks', G.modal() === 'Discard your changes?');
  G.answerModal(false); await flush(10);
  check('F.7 (S5′): Cancel keeps the Options tab, its values, and shows no toast (fidelity 8)', G.run('edMode') === 'options' && !!G.$('edOpts') && G.toasts.length === toastsBefore && G.calls.length === 0 &&
    !!titleField && G.doc.querySelector('#edOpts [data-key="kicker"]') === titleField && titleField.value === 'Typed, not applied');
  G.run('applyOptions()'); await flush(10);
  G.answerModal(true); await flush(80);
  check('F.7 (S5′): Discard → re-rendered fresh (no saved-layout read), asked once', G.htmlCalls().length === 1 && !G.calls.some(function (c) { return c.method === 'GET' && c.path === '/api/promo/social/layout'; }) &&
    G.toasts.some(function (t) { return /Options applied/.test(t[0]); }) && G.run('OWS.skipGuard') === false && G.modal() === null);
  /* Reset */
  G.run('EDIT.els[0].x = 5');
  G.calls.length = 0;
  G.run('edReset()'); await flush(10);
  check('F.7: Reset asks "Reset this layout?"', G.modal() === 'Reset this layout?' && G.$('uiModalOk').textContent === 'Reset');
  G.answerModal(true); await flush(80);
  check('F.7: Reset → the layout is deleted and drawn again, with no second question (skipGuard once)', G.calls.some(function (c) { return c.path === '/api/promo/social/layout/reset'; }) &&
    G.htmlCalls().length === 1 && G.modal() === null && G.run('OWS.skipGuard') === false && G.toasts.some(function (t) { return t[0] === 'Reset to the original template'; }));
  var badReset = boot({ routes: { 'POST /api/promo/social/layout/reset': function () { return new Response('{"error":"x"}', { status: 500 }); } } });
  await flush(60);
  badReset.run('openEditor("generic.announcement")'); await flush(80);
  badReset.run('edReset()'); await flush(10); badReset.answerModal(true); await flush(40);
  check('F.7: a Reset that failed leaves no lingering skip (the next switch still asks)', badReset.lastToast()[0] === 'Reset failed' && badReset.run('OWS.skipGuard') === false);
  /* owReset gives the pass back by itself, however the request failed (here called through api(), without edReset's
     own clearing): a refusal, a rejection, and the sign-in helper throwing before any request is made */
  var resetBody = 'api("/api/editor/reset",{method:"POST",body:JSON.stringify({templateId:"generic.announcement",format:"ig_square",params:{theme:"dark"}})})';
  badReset.run('OWS.skipGuard = true');
  var rsRefused = await badReset.run(resetBody);
  check('F.7: a refused Reset request clears the pass on its own', rsRefused.status === 500 && badReset.run('OWS.skipGuard') === false);
  var realAuthed = badReset.ctx.RevampAuth.authedFetch;
  badReset.ctx.RevampAuth.authedFetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };
  badReset.run('OWS.skipGuard = true');
  var rsOffline = await badReset.run(resetBody);
  check('F.7: a Reset request that rejects clears the pass', rsOffline.status === 503 && badReset.run('OWS.skipGuard') === false);
  badReset.ctx.RevampAuth.authedFetch = function () { throw new Error('boom'); };
  badReset.run('OWS.skipGuard = true');
  var syncThrew = false, rsThrown;
  try { rsThrown = badReset.run('owReset({templateId:"generic.announcement",format:"ig_square",params:{}})'); } catch (e) { syncThrew = true; }
  var rsThrownErr = rsThrown ? await rsThrown.then(function () { return null; }, function (e) { return e; }) : null;
  check('F.7: the sign-in helper throwing: owReset rejects (does not throw) and the pass is cleared', !syncThrew && !!rsThrownErr && rsThrownErr.message === 'boom' &&
    badReset.run('OWS.skipGuard') === false, { syncThrew: syncThrew, err: rsThrownErr && rsThrownErr.message });
  badReset.run('OWS.skipGuard = true');
  var rsThrownApi = await badReset.run(resetBody);
  check('F.7: … and through api() it is a failed answer with the pass cleared', rsThrownApi.status === 503 && badReset.run('OWS.skipGuard') === false);
  badReset.ctx.RevampAuth.authedFetch = realAuthed;
  badReset.run('EDIT.els[0].x = 4');
  fire(badReset.$('edTheme').querySelector('[data-v="light"]'), 'click'); await flush(10);
  check('F.7: after those failed Resets, a switch with unsaved edits still asks', badReset.modal() === 'Discard your changes?');
  badReset.answerModal(false); await flush(10);
  G.run('EDIT.els[0].x = 6');
  var unload = { preventDefault: function () { unload.prevented = true; } };
  (G.winLs.beforeunload || []).forEach(function (fn) { fn(unload); });
  check('F.7: leaving the page with unsaved edits asks the browser to confirm', unload.prevented === true && unload.returnValue === '');
  /* switch with OK */
  G.calls.length = 0;
  G.$('edTpl').value = 'generic.testimonial'; G.run('switchEditorTpl()'); await flush(10);
  G.answerModal(true); await flush(80);
  check('F.7: Discard on a switch loads the new template', G.run('EDIT.tid') === 'generic.testimonial' && G.calls.some(function (c) { return c.method === 'GET' && c.path === '/api/promo/social/layout' && c.q.templateId === 'generic.testimonial'; }));
  /* leave, then come back: no question about the earlier visit */
  G.run('EDIT.els[0].x = 7');
  G.posted.length = 0;
  fire(G.doc.querySelector('#editor .back'), 'click'); await flush(10);
  check('F.7 (S8): ← asks too', G.modal() === 'Leave without saving?');
  G.answerModal(true); await flush(10);
  check('F.7: Leave without saving closes the editor (rvSocialStudio close)', G.run('owEditorOpen()') === false && G.posted.some(function (p) { return p.m.rvSocialStudio === 'close'; }));
  G.run('openEditor("generic.announcement")'); await flush(60);
  check('F.7: reopening the editor never asks about the earlier visit', G.modal() === null && G.run('EDIT.tid') === 'generic.announcement');
  /* nudges */
  G.run('__now = 1000; Date.now = function () { return __now; }; edHist = [];');
  G.run('owNudgeSnap(); __now = 1300; owNudgeSnap(); __now = 1500; owNudgeSnap();');
  check('F.7 (S9): a run of arrow nudges is one step of Undo', G.run('edHist.length') === 1);
  G.run('__now = 2200; owNudgeSnap();');
  check('F.7 (S9): a pause over 600 ms starts a new step', G.run('edHist.length') === 2);
  G.cap.dirtyVal = true;
  G.run('EDIT.els = JSON.parse(OWS.snap).map(normEl)');
  check('a caption edited but not saved counts as unsaved', G.run('owDirty()') === true);
  G.cap.dirtyVal = false;

  /* ---- F.8: Testimonial guard ---- */
  var T = boot(); await flush(60);
  T.run('openEditor("generic.testimonial")'); await flush(80);
  var rendersBefore = T.renders.length;
  T.run('edDownload()'); await flush(30);
  check('F.8: Download PNG of a Testimonial with no quote is refused, 6 s, with the reason', T.renders.length === rendersBefore &&
    T.lastToast()[0] === 'Type the quote in Options, then Apply & re-render: a testimonial shows a real quote, never a made-up one.' && T.lastToast()[1] === 6000);
  T.run('edMode="options"; paintSide();');
  T.calls.length = 0;
  T.run('edDownloadZip()'); await flush(30);
  check('F.8: the ZIP too, while the Options form\'s quote is empty', T.htmlCalls().length === 0 && /real quote, never/.test(T.lastToast()[0]) && T.lastToast()[1] === 6000);
  T.doc.querySelector('#edOpts [data-key="quote"]').value = 'A real thing a speaker said.';
  T.run('edDownloadZip()'); await flush(120);
  check('F.8: with a quote typed in the form, the ZIP is made', T.htmlCalls().length === 1 && T.htmlCalls()[0].body.items.every(function (i) { return i.params.quote === 'A real thing a speaker said.'; }));

  /* ---- F.9: the inliner ---- */
  var I = boot(); await flush(60);
  I.calls.length = 0; I.fetches.length = 0; I.run('OWS.blobCache = {}');
  var fr = await I.run('OWS.frame(' + JSON.stringify(postHtml('generic.announcement', 'ig_square')) + ', 1080, 1080, { tell: true })');
  var fd = fr.doc, written = fd.written;
  check('F.9: the frame is sandboxed with no scripts, hidden off-screen at the post\'s size', fr.frame.getAttribute('sandbox') === 'allow-same-origin' && fr.frame.getAttribute('aria-hidden') === 'true' &&
    /left:-100000px/.test(fr.frame.getAttribute('style')) && /width:1080px/.test(fr.frame.getAttribute('style')) && /height:1080px/.test(fr.frame.getAttribute('style')));
  check('F.9: what is written into the frame has no handler or script at all', !/\son[a-z]+=/i.test(written) && !/<script|<iframe|<object|<embed/i.test(written) && /^<!doctype html>/.test(written));
  var chip = fd.querySelector('.tl-logo');
  check('F.9 (V2): a logo chip whose picture fails shows the partner\'s name', chip.classList.contains('text') && chip.textContent === 'Acme "Co" <b>' && !chip.querySelector('img'));
  var psName = fd.querySelector('.ps-logo .ps-name');
  check('F.9 (V2): the Partner Spotlight logo becomes its name block', !!psName && psName.textContent === 'Zen Partner' && !fd.querySelector('.ps-logo img'));
  var spkImg = fd.querySelector('img.spk'), logoImg = fd.querySelector('img.lockup-img'), mine = fd.querySelector('img.mine');
  check('F.9: outside pictures become blob:, their real address in data-ow-src', /^blob:/.test(spkImg.getAttribute('src')) && spkImg.getAttribute('data-ow-src') === 'https://img.etb2bimg.com/speaker.jpg' &&
    /^blob:/.test(logoImg.getAttribute('src')) && logoImg.getAttribute('data-ow-src') === STORE + 'promo-art/logo.png');
  check('F.9: through Oneworld\'s picture route, with the event', I.calls.some(function (c) { return c.path === '/api/promo/image' && c.q.url === 'https://img.etb2bimg.com/speaker.jpg' && c.q.eventId === 'qa-1'; }));
  check('F.9: the app\'s own files (/assets, /templates on any host) are fetched from this site, not the route', /^blob:/.test(mine.getAttribute('src')) &&
    I.fetches.indexOf('https://ow.test/assets/promo-examples/people/p01.jpg') !== -1 && !I.calls.some(function (c) { return c.q.url && /p01\.jpg/.test(c.q.url); }));
  var bgDiv = fd.querySelector('.bg');
  check('F.9: a background in a style attribute is inlined too', /url\("blob:/.test(bgDiv.getAttribute('style')) && !/url\(['"]?https?:/.test(bgDiv.getAttribute('style')));
  var gone = fd.querySelector('img.gone');
  check('F.9: a picture that cannot be had is left out (hidden, no outside address left)', !gone.getAttribute('src') && /visibility:hidden/.test(gone.getAttribute('style')) &&
    gone.getAttribute('data-ow-src') === 'https://img.etb2bimg.com/broken-photo.jpg');
  check('F.9: … and a toast says so (6 s)', I.lastToast()[0] === 'A picture could not be loaded and was left out: img.etb2bimg.com' && I.lastToast()[1] === 6000);
  check('F.9: no outside address is left anywhere in the frame', !fd.querySelectorAll('img').some(function (i) { return /^https?:/.test(i.getAttribute('src') || ''); }) &&
    !fd.querySelectorAll('[style]').some(function (e) { return /url\(['"]?https?:/.test(e.getAttribute('style')); }));
  check('F.9: every picture in the frame is decoded before it is drawn', ['img.spk', 'img.lockup-img', 'img.mine'].every(function (q) { return (I.ctx.__decodes || []).indexOf(fd.querySelector(q).getAttribute('src')) !== -1; }));
  fr.done();
  check('F.9: done() takes the frame away', !I.doc.querySelector('iframe'));
  var nProxy = I.calls.filter(function (c) { return c.path === '/api/promo/image'; }).length;
  var fr2 = await I.run('OWS.frame(' + JSON.stringify(postHtml('generic.announcement', 'ig_square')) + ', 1080, 1080, {})'); fr2.done();
  check('F.9: a picture is fetched once a session (kept as a blob:), a failed one asked again', I.calls.filter(function (c) { return c.path === '/api/promo/image'; }).length - nProxy === 3,
    I.calls.filter(function (c) { return c.path === '/api/promo/image'; }).length - nProxy);
  var leftover = await I.run('(function(){ var d = new DOMParser().parseFromString(\'<html><body><img src="https://img.etb2bimg.com/x.png"><div style="background:url(https://img.etb2bimg.com/y.png) center"></div></body></html>\'); return owLeftovers(d, false); })()');
  check('F.9: anything outside still in a document is hidden and named (no toast for cards)', JSON.stringify(leftover) === '["img.etb2bimg.com"]');
  var W = boot({ writeThrows: true }); await flush(80);
  W.run('openEditor("generic.announcement")'); await flush(120);
  check('a browser that will not write into a sandboxed frame: drawn through srcdoc instead', W.extracts.length === 1 && /^blob:/.test(W.run('EDIT.base')) && !/\son[a-z]+=/i.test(W.extracts[0].html));

  /* ---- F.10: QR after unpublishing ---- */
  var qrSaved = function () { return { saved: true, width: 1080, height: 1080, base: STORE + 'promo-layouts/k/b.png', savedAt: 1, params: {}, caption: null,
    elements: [{ id: 'q', type: 'image', x: 1, y: 1, w: 150, h: 150, src: 'data:image/svg+xml;base64,AAA', owQr: true }, { id: 't', type: 'text', x: 1, y: 1, w: 10, h: 10, text: 'T' }] }; };
  var Qu = boot({ saved: qrSaved }); await flush(60);
  Qu.run('openEditor("generic.announcement")'); await flush(80);
  check('F.10: a saved layout opens without its QR code while the site is not published', Qu.run('EDIT.els.length') === 1 && Qu.run('EDIT.els[0].id') === 't');
  check('F.10: … with the toast (6 s)', Qu.toasts.some(function (t) { return t[0] === 'The QR code was left out: the site is not published.' && t[1] === 6000; }));
  Qu.run('EDIT.els.push({ id:"q2", type:"image", x:1, y:1, w:10, h:10, src:"data:image/png;base64,AA", owQr:true })');
  Qu.run('edDownload()'); await flush(60);
  check('F.10: and before Download PNG', Qu.renders.length === 1 && Qu.renders[0].els.every(function (e) { return !e.owQr; }));
  var Qp = boot({ saved: qrSaved, published: true }); await flush(60);
  Qp.run('openEditor("generic.announcement")'); await flush(80);
  check('F.10: a published site keeps its QR code', Qp.run('EDIT.els.length') === 2 && !Qp.toasts.some(function (t) { return /QR code was left out/.test(t[0]); }));

  /* ---- F.12: the frame grows to its content; toasts ---- */
  var F = boot(); await flush(60);
  check('F.12: the content is watched for size', F.ros.length === 1 && F.ros[0].el === F.$('content'));
  F.posted.length = 0; F.flushRaf();
  F.ros[0].cb(); F.ros[0].cb(); F.ros[0].cb();
  check('F.12: at most one report per frame', F.raf.length === 1);
  F.flushRaf();
  var hs = F.posted.filter(function (p) { return 'rvSocialHeight' in p.m; });
  check('F.12: the content\'s bottom is reported (rvSocialHeight), same origin', hs.length === 1 && hs[0].m.rvSocialHeight === 900 && hs[0].origin === 'https://ow.test', F.posted);
  F.ros[0].cb(); F.flushRaf();
  F.$('content')._rect = { bottom: 900.6 }; F.ros[0].cb(); F.flushRaf();
  check('F.12: no report without a change of more than 1 px', F.posted.filter(function (p) { return 'rvSocialHeight' in p.m; }).length === 1);
  F.$('content')._rect = { bottom: 1400 }; F.ctx.scrollY = 20; F.ros[0].cb(); F.flushRaf();
  check('F.12: a change is reported, counting the page\'s scroll', F.posted.filter(function (p) { return 'rvSocialHeight' in p.m; }).pop().m.rvSocialHeight === 1420);
  F.$('content')._rect = { bottom: 30 }; F.ctx.scrollY = 0; F.ros[0].cb(); F.flushRaf();
  check('F.12: a hidden page (50 px or less) is never reported', F.posted.filter(function (p) { return 'rvSocialHeight' in p.m; }).length === 2);
  F.run('openEditor("generic.announcement")'); await flush(80);
  F.$('content')._rect = { bottom: 2000 }; F.ros[0].cb(); F.flushRaf();
  check('F.12: never while the editor is open', F.posted.filter(function (p) { return 'rvSocialHeight' in p.m; }).length === 2);
  F.run('closeEditor()'); F.flushRaf();
  check('F.12: reported again once the editor closes', F.posted.filter(function (p) { return 'rvSocialHeight' in p.m; }).pop().m.rvSocialHeight === 2000);
  check('F.12: not tall before Promotions says so', !F.doc.documentElement.classList.contains('ow-tall'));
  F.message({ rvSocialTall: true }, { origin: 'https://evil.example' });
  F.message({ rvSocialTall: true }, { source: {} });
  check('F.12: rvSocialTall from another origin or window is ignored', !F.doc.documentElement.classList.contains('ow-tall'));
  F.message({ rvSocialTall: true });
  check('F.12: rvSocialTall from Promotions sets html.ow-tall', F.doc.documentElement.classList.contains('ow-tall'));
  F.posted.length = 0;
  F.realToast('Hello there', 5000);
  check('F.12: while tall, a toast on the cards page is shown by the console (rvToast)', F.posted.length === 1 && F.posted[0].m.rvToast.m === 'Hello there' && F.posted[0].m.rvToast.ms === 5000 &&
    F.$('toast').textContent !== 'Hello there', F.posted);
  F.run('openEditor("generic.announcement")'); await flush(80);
  F.posted.length = 0;
  F.realToast('In the editor', 3000);
  check('F.12: while the editor is open, the toast plays here', F.posted.filter(function (p) { return p.m.rvToast; }).length === 0 && F.$('toast').textContent === 'In the editor' && F.$('toast').classList.contains('on'));
  F.run('closeEditor()');
  var nt = boot(); await flush(40);
  nt.posted.length = 0; nt.realToast('Plain');
  check('F.12: not tall: the platform\'s own toast', nt.posted.length === 0 && nt.$('toast').textContent === 'Plain');
  F.posted.length = 0;
  F.run('uiConfirm("Remove the logo?","Posts show the event\'s name in type instead.",{ok:"Remove",danger:true})');
  check('a dialog over the cards of a tall frame takes the window, so it is in view', F.posted.some(function (p) { return p.m.rvSocialStudio === 'open'; }) && F.modal() === 'Remove the logo?');
  F.answerModal(false); await flush(10); F.flushRaf();
  check('… and gives it back when answered', F.posted.filter(function (p) { return p.m.rvSocialStudio; }).map(function (p) { return p.m.rvSocialStudio; }).join() === 'open,close');

  /* ---- F.13: the ZIP ---- */
  var Z = boot(); await flush(60);
  Z.run('openEditor("generic.announcement")'); await flush(80);
  Z.run('edMode="options"; paintSide();');
  Z.cap.text = 'My caption for LinkedIn';
  Z.calls.length = 0; Z.shots.length = 0;
  Z.run('edDownloadZip()'); await flush(150);
  var zh = Z.htmlCalls();
  check('F.13: one html request for all four sizes, with the form\'s options', zh.length === 1 && zh[0].body.items.map(function (i) { return i.format; }).join() === 'ig_square,ig_portrait,landscape,story' &&
    zh[0].body.items.every(function (i) { return i.params.theme === 'dark'; }), zh[0] && zh[0].body.items);
  check('F.13: each size drawn twice at 2×', Z.shots.length === 8 && Z.shots.every(function (s) { return s.opts.pixelRatio === 2; }));
  var zip = Z.zips[Z.zips.length - 1], names = zip ? zip.files.map(function (f) { return f.name; }) : [];
  check('F.13: the platform\'s file names, then captions.json, then caption.txt', names.join() === 'generic-announcement-ig_square.png,generic-announcement-ig_portrait.png,generic-announcement-landscape.png,generic-announcement-story.png,captions.json,caption.txt', names);
  var cj = zip && zip.files.filter(function (f) { return f.name === 'captions.json'; })[0];
  check('F.13: captions.json is the platform\'s ({ "<template>": its caption }, 2-space, untrimmed)', !!cj && cj.data === JSON.stringify({ 'generic.announcement': 'Caption generic.announcement story ' }, null, 2), cj && cj.data);
  var ct = zip && zip.files.filter(function (f) { return f.name === 'caption.txt'; })[0];
  check('F.13: caption.txt holds the Caption tab\'s words', !!ct && ct.data === 'My caption for LinkedIn');
  check('F.13: the platform\'s toast', Z.lastToast()[0] === '✓ Downloaded ZIP');
  Z.cap.text = '   ';
  Z.run('edDownloadZip()'); await flush(150);
  var zip2 = Z.zips[Z.zips.length - 1];
  check('F.13: no caption.txt when the Caption tab is empty', zip2 !== zip && zip2.files.map(function (f) { return f.name; }).indexOf('caption.txt') === -1 && zip2.files.length === 5);

  /* ---- F.14: picture addresses, and Upload a picture (O2 = c) ---- */
  var P = boot(); await flush(60);
  P.run('openEditor("generic.announcement")'); await flush(80);
  P.run('selectEl(1)');
  var src = P.$('epSrc'), upl = P.doc.querySelector('.ow-upl');
  check('O2 = c: "Upload a picture" sits right after the Source box of an image', !!upl && upl.textContent === 'Upload a picture' && upl.parentNode.parentNode === src.parentNode &&
    src.nextSibling === upl.parentNode && upl.getAttribute('type') === 'button');
  var oldSrc = P.run('EDIT.els[1].src');
  async function paste(v) { src = P.$('epSrc'); src.value = v; src.onchange(); await flush(20); return P.run('EDIT.els[1].src'); }
  P.toasts.length = 0;
  var s1 = await paste('http://img.etb2bimg.com/plain.png');
  check('F.14: an http: address is refused, with the V16 words (6 s)', s1 === oldSrc && P.lastToast()[0] === 'Oneworld can only use pictures from this event\'s own files or ET\'s image servers. Use Insert → speakers or sponsors, or use Upload a picture.' &&
    P.lastToast()[1] === 6000 && P.$('epSrc').value === oldSrc);
  var nImg = P.calls.length;
  var s2 = await paste('https://forbidden.example/a.png');
  check('F.14: an address the picture route refuses (403) is refused and the old one put back', s2 === oldSrc && P.$('epSrc').value === oldSrc && P.calls.length === nImg + 1 &&
    P.calls[nImg].path === '/api/promo/image' && !!P.calls[nImg].signal);
  var s3 = await paste('https://img.etb2bimg.com/fine.png');
  check('F.14: one it allows (200) is taken', s3 === 'https://img.etb2bimg.com/fine.png');
  var small = 'data:image/png;base64,' + new Array(200 * 1024 - 22 + 1).join('A');
  var s4 = await paste(small);
  check('F.14: a pasted data:image/png of 200 KB is taken, as the platform did', s4 === small);
  var bigData = 'data:image/png;base64,' + new Array(400 * 1024).join('A');
  var s5 = await paste(bigData);
  check('F.14: one of 400 KB is refused', s5 === small && /Upload a picture/.test(P.lastToast()[0]));
  var s6 = await paste('javascript:alert(1)');
  check('F.14: anything else is refused', s6 === small);
  /* a pasted picture is checked by the server's own rule, so one taken here is never refused when the layout is saved */
  var serverRule = /\nvar DATA_PICTURE = (\/.+\/[a-z]*);\n/.exec(read('functions/lib/promo-social.js'));
  var browserRule = /\nvar OW_DATA_PICTURE = (\/.+\/[a-z]*);\n/.exec(ADAPTER);
  check('F.14: the browser checks a pasted picture by the server\'s own rule, letter case and all', !!serverRule && !!browserRule && serverRule[1] === browserRule[1],
    [serverRule && serverRule[1], browserRule && browserRule[1]]);
  var SERVER_DATA = serverRule ? Function('return ' + serverRule[1])() : /$^/;
  var refusedData = ['data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E', 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',
    'data:image/PNG;base64,AAAA', 'DATA:image/png;base64,AAAA'];
  var takenData = ['data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', 'data:image/svg+xml;charset=utf-8;base64,PHN2Zy8+'];
  check('F.14: (the server refuses the four below and keeps the two)', refusedData.every(function (s) { return !SERVER_DATA.test(s); }) &&
    takenData.every(function (s) { return SERVER_DATA.test(s); }));
  P.toasts.length = 0;
  var sR = [];
  for (var rd = 0; rd < refusedData.length; rd++) sR.push(await paste(refusedData[rd]));
  check('F.14: an SVG written "data:image/svg+xml,%3Csvg…" (and with only a charset) is refused at once, as Save would', sR[0] === small && sR[1] === small);
  check('F.14: an upper-case "data:image/PNG" or "DATA:" is refused too', sR[2] === small && sR[3] === small);
  check('F.14: … each with the V16 toast (6 s)', P.toasts.length === 4 && P.toasts.every(function (t) { return t[0] === 'Oneworld can only use pictures from this event\'s own files or ET\'s image servers. Use Insert → speakers or sponsors, or use Upload a picture.' && t[1] === 6000; }), P.toasts);
  var sT0 = await paste(takenData[0]);
  check('F.14: an SVG written ";utf8," is taken', sT0 === takenData[0]);
  var sT1 = await paste(takenData[1]);
  check('F.14: … and one written with a charset and ";base64,"', sT1 === takenData[1]);
  check('F.14: (the 200 KB picture put back for the steps below)', await paste(small) === small);
  /* Upload a picture */
  var dUp = deferred();
  P.art.next = function () { return dUp.p; };
  P.ctx.__onFilePick = function (inp) { inp.files = [{ name: 'photo.jpg', size: 1000 }]; inp.onchange(); };
  var hist = P.run('edHist.length');
  upl = P.doc.querySelector('.ow-upl');
  fire(upl, 'click');
  await flush(10);
  check('O2 = c: while uploading the button is disabled and says "Uploading…"', upl.disabled === true && upl.textContent === 'Uploading…' &&
    P.art.calls.some(function (c) { return c[0] === 'picture' && c[1].name === 'photo.jpg'; }));
  function nPictures() { return P.art.calls.filter(function (c) { return c[0] === 'picture'; }).length; }
  var nPic = nPictures();
  P.run('paintSide()');                                     // the panel drawn again mid-upload (a drag's end does this)
  var upl2 = P.doc.querySelector('.ow-upl');
  check('O2 = c: the panel drawn again mid-upload shows a new button, still shut and "Uploading…"', !!upl2 && upl2 !== upl && upl2.disabled === true && upl2.textContent === 'Uploading…');
  P.run('selectEl(' + P.run('EDIT.els.findIndex(function (e) { return e.type === "text"; })') + ')');
  P.run('selectEl(1)');
  var upl3 = P.doc.querySelector('.ow-upl');
  check('O2 = c: … and so after picking another element and coming back', !!upl3 && upl3 !== upl2 && upl3.disabled === true && upl3.textContent === 'Uploading…');
  fire(upl3, 'click'); await flush(10);
  check('O2 = c: no second upload starts for that element while the first runs', nPictures() === nPic);
  dUp.ok({ url: STORE + 'promo-art/picture-abc.png', width: 800, height: 600 });
  await flush(20);
  upl = P.doc.querySelector('.ow-upl');
  check('O2 = c: the picture is put on the element and the stage, with an Undo step', P.run('EDIT.els[1].src') === STORE + 'promo-art/picture-abc.png' && P.run('edHist.length') === hist + 1 &&
    P.$('epSrc').value === STORE + 'promo-art/picture-abc.png');
  check('O2 = c: once it ends, the button the panel shows then is free again', upl === upl3 && upl.disabled === false && upl.textContent === 'Upload a picture');
  P.run('edUndo()');
  check('O2 = c: Undo brings the old picture back', P.run('EDIT.els[1].src') === small);
  P.run('selectEl(1)');
  P.art.next = function () { return Promise.reject(new Error('That picture is too large to use (more than 16 million pixels). Make it smaller and upload it again.')); };
  fire(P.doc.querySelector('.ow-upl'), 'click'); await flush(20);
  check('O2 = c: a failed upload is a toast with the server\'s words', P.lastToast()[0] === 'That picture is too large to use (more than 16 million pixels). Make it smaller and upload it again.' &&
    P.run('EDIT.els[1].src') === small && P.doc.querySelector('.ow-upl').disabled === false);
  P.run('edAdd("frame")');
  check('O2 = c: a photo frame has the button too', !!P.doc.querySelector('.ow-upl') && P.run('EDIT.els[edSel].type') === 'frame');
  var fs1 = (function () { P.$('epSrc').value = 'http://x.example/a.png'; P.$('epSrc').onchange(); return P.run('EDIT.els[edSel].src'); })();
  await flush(20);
  check('F.14: a frame\'s Source is checked the same way', P.run('EDIT.els[edSel].src') === fs1 && /Upload a picture/.test(P.lastToast()[0]) && fs1.indexOf('data:') === 0);
  /* uploads are kept by element: one element's upload never shuts, or frees, another element's button */
  var frameIdx = P.run('edSel'), dFr = deferred(), dIm = deferred();
  P.art.next = function () { return dFr.p; };
  fire(P.doc.querySelector('.ow-upl'), 'click'); await flush(10);
  P.run('selectEl(1)');
  check('O2 = c: while the frame\'s picture uploads, the image\'s button is free', P.doc.querySelector('.ow-upl').disabled === false &&
    P.doc.querySelector('.ow-upl').textContent === 'Upload a picture');
  P.art.next = function () { return dIm.p; };
  fire(P.doc.querySelector('.ow-upl'), 'click'); await flush(10);
  dFr.ok({ url: STORE + 'promo-art/picture-frame.png', width: 800, height: 600 }); await flush(20);
  check('O2 = c: the frame\'s upload ending leaves the image\'s own upload shown as running', P.run('EDIT.els[' + frameIdx + '].src') === STORE + 'promo-art/picture-frame.png' &&
    P.doc.querySelector('.ow-upl').disabled === true && P.doc.querySelector('.ow-upl').textContent === 'Uploading…');
  P.run('selectEl(' + frameIdx + ')');
  check('O2 = c: … and the frame\'s button is free again', P.doc.querySelector('.ow-upl').disabled === false);
  dIm.ok({ url: STORE + 'promo-art/picture-img.png', width: 800, height: 600 }); await flush(20);
  check('O2 = c: an upload ending while another element is shown sets only its own element', P.run('EDIT.els[1].src') === STORE + 'promo-art/picture-img.png' &&
    P.doc.querySelector('.ow-upl').disabled === false && P.run('EDIT.els[edSel].type') === 'frame');
  P.run('selectEl(1)');
  check('O2 = c: … and the image\'s button is free once more', P.doc.querySelector('.ow-upl').disabled === false && P.doc.querySelector('.ow-upl').textContent === 'Upload a picture');
  var txtIdx = P.run('EDIT.els.findIndex(function (e) { return e.type === "text"; })');
  P.run('selectEl(' + txtIdx + ')');
  check('O2 = c: a text element has no Upload button', !P.doc.querySelector('.ow-upl'));

  /* ---- no event ---- */
  var N = boot({ search: '' }); await flush(30);
  check('no event: says so, asks for nothing', /No event/.test(N.$('content').innerHTML) && N.calls.length === 0);
  var bad = boot({ routes: { 'GET /api/promo/social/catalog': function () { return new Response('{"error":"gone"}', { status: 404 }); } } });
  await flush(40);
  check('an event the catalog does not have: the platform\'s "could not be found"', /That event could not be found/.test(bad.$('content').innerHTML));
  bad.run('openPortal()');
  check('its way back is Oneworld\'s event listing (the whole window)', bad.ctx.top.location.href === '/Event_Listing.html');

  /* ---- F.11: the look (owner A) ---- */
  var rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  check('F.11: #evNav is forced hidden (fidelity 28)', rules.indexOf('#evNav{display:none!important}') !== -1);
  check('F.11: an empty hashtag chip is hidden', rules.indexOf('.hchip:empty{display:none}') !== -1);
  var parsed = [], rre = /([^{}]+)\{([^{}]*)\}/g, rm;
  while ((rm = rre.exec(rules))) parsed.push({ sel: rm[1].trim(), decls: splitDecls(rm[2]) });
  var COLOUR_PROPS = /^(color|background|background-color|border|border-(top|right|bottom|left)(-color)?|border-color|outline|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color)$/;
  var literal = [];
  parsed.forEach(function (r) { r.decls.forEach(function (d) {
    if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black|red|grey|gray|blue|green)\b/i.test(d[1])) literal.push(r.sel + ' ' + d[0] + ':' + d[1]);
    if (COLOUR_PROPS.test(d[0]) && !/var\(--/.test(d[1]) && !/^(transparent|none|inherit|currentColor|0|initial|unset)$/i.test(d[1])) literal.push(r.sel + ' ' + d[0] + ':' + d[1]);
  }); });
  check('F.11: every colour is a console token (no literal colours)', literal.length === 0, literal);
  var PANELS = ['.psd', '.assets-slots .slot', '.tcard', '.ed-zoom', '.ed-side', '.ed-side input[type=color]', '.ed-tabs button.on', '.ed-addgrid button', '.ed-dd', '.ed-ck', '.ed-align button'];
  var white = PANELS.filter(function (sel) {
    return !parsed.some(function (r) { return r.sel.split(',').map(function (s) { return s.trim(); }).indexOf(sel) !== -1 &&
      r.decls.some(function (d) { return /^background(-color)?$/.test(d[0]) && d[1] === 'var(--panel)'; }); });
  });
  check('F.11: every panel the platform painted white is the console\'s panel', white.length === 0, white);
  var platformCss = read('promo-studio/mailer-studio.css');
  check('F.11: those panels are white in the platform\'s stylesheet (the overrides still meet something)', PANELS.every(function (sel) {
    var at = platformCss.indexOf('  ' + sel + '{'); return at !== -1 && /background:#fff/.test(platformCss.slice(at, platformCss.indexOf('}', at)));
  }), PANELS.filter(function (sel) { return platformCss.indexOf('  ' + sel + '{') === -1; }));
  var schemed = [];
  parsed.forEach(function (r) { if (r.decls.some(function (d) { return d[0] === 'color-scheme'; })) r.sel.split(',').forEach(function (s) { schemed.push(s.trim()); }); });
  check('F.11: color-scheme only on the side pane and the editor bar, never the canvas or the stage', schemed.length > 0 &&
    schemed.every(function (s) { return s === ':root[data-theme="dark"] .ed-side' || s === ':root[data-theme="dark"] .ed-top'; }) && !/edCanvas|edStage|ed-canvas|edstage/.test(schemed.join()), schemed);
  check('F.11: larger cards: at least 360 px, one column on a phone', rules.indexOf('.tgrid{grid-template-columns:repeat(auto-fill,minmax(min(360px,100%),1fr))') !== -1);
  check('F.11: an unavailable card\'s post in full colour, its words grey', rules.indexOf('.tcard.dis{opacity:1}') !== -1 && /\.tcard\.dis \.cat,\.tcard\.dis \.nm,\.tcard\.dis \.ds\{color:var\(--soft\)\}/.test(rules));
  check('F.11: a filled slot in the console\'s green on its tint', rules.indexOf('.assets-slots .slot.on{border-color:var(--ok);background:var(--ok-soft);color:var(--ok)}') !== -1);
  /* AA, both themes, from oneworld.css's two token blocks (the promo-studio.test.js method) */
  var owRules = OW_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  function block(sel) {
    var at = owRules.indexOf(sel + '{'); if (at === -1) return {};
    var body = owRules.slice(at + sel.length + 1, owRules.indexOf('}', at)), out = {}, m, re = /(--[\w-]+)\s*:\s*([^;]+);/g;
    while ((m = re.exec(body))) out[m[1]] = m[2].trim();
    return out;
  }
  var LIGHT = block('\n:root'), DARK = block(':root[data-theme="dark"]');
  function lum(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { var c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
    .reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0); }
  function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var pairs = [];
  parsed.forEach(function (r) {
    var col = r.decls.filter(function (d) { return d[0] === 'color'; })[0], bg = r.decls.filter(function (d) { return /^background(-color)?$/.test(d[0]); })[0];
    var c = col && /^var\((--[\w-]+)\)$/.exec(col[1]), b = bg && /^var\((--[\w-]+)\)$/.exec(bg[1]);
    if (!c) return;
    /* words with no background of their own sit on a card or the side pane (--panel) */
    pairs.push({ sel: r.sel, fg: c[1], bg: b ? b[1] : '--panel' });
  });
  check('F.11: the file sets words in colour (pairs to check)', pairs.length >= 10, pairs.length);
  pairs.forEach(function (p) {
    [['light', LIGHT], ['dark', DARK]].forEach(function (t) {
      var f = t[1][p.fg], g = t[1][p.bg];
      var r = f && g ? ratio(f, g) : 0;
      check('F.11: AA, ' + t[0] + ': ' + p.sel + ' (' + p.fg + ' on ' + p.bg + ', ' + r.toFixed(2) + ':1)', r >= 4.5, [f, g]);
    });
  });
  check('F.11: the example badge is the console\'s toast pair (ink and its background)', /\.ow-ex\{background:var\(--ink\);color:var\(--bg\)/.test(rules));
  check('F.11: the full-size view\'s scrim is the console\'s', /\.ow-lb\{[^}]*background:var\(--ow-scrim\)/.test(rules));

  /* ---- the page around it ---- */
  check('the page loads this stylesheet after the shared token sheet', PAGE.indexOf('promo-studio/oneworld.css') < PAGE.indexOf('promo-studio/oneworld-social.css') && PAGE.indexOf('promo-studio/oneworld-social.css') !== -1);
  check('the page loads this file after the platform\'s code and before the art and caption modules',
    PAGE.indexOf('src="promo-studio/social-studio.js"') < PAGE.indexOf('src="promo-studio/oneworld-social.js"') && PAGE.indexOf('src="promo-studio/oneworld-social.js"') < PAGE.indexOf('src="promo-studio/oneworld-social-art.js"'));
  check('nothing on the page is console.error\'d in the normal flows', B.errors.length === 0 && E.errors.length === 0 && Z.errors.length === 0, B.errors.concat(E.errors).map(String).slice(0, 3));

  if (failed) { console.error('promo-social-adapter: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-social-adapter: all ' + passed + ' checks passed');
  process.exit(0);
})().catch(function (err) { console.error('promo-social-adapter: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
