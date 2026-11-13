/* A small DOM over htmlparser2's tree, so the code that draws a page in the browser (editor-fill.js's rule engine,
   templates/_shared/rv-draw.js) runs on the server as it is, rule for rule, instead of a copy of it.

     wrapDocument(root)  -> a document over a parsed tree (htmlparser2 parseDocument): querySelector(All),
                            createElement, createTextNode, importNode, documentElement, body
     unwrap(node)        -> the htmlparser2 node under a wrapper (for splicing a changed part back into the text)
     render(node)        -> the markup of a wrapper or an htmlparser2 node, written as a browser writes a page
                            (hidden="", <path></path>, only & < > nbsp — and " in attributes — escaped)

   What it covers is what that code uses, as a browser does it:
     nodes      nodeType, nodeName, parentNode, parentElement, childNodes, firstChild, lastChild, nextSibling,
                previousSibling, textContent (get/set), nodeValue, ownerDocument, isConnected, contains, cloneNode,
                remove, before, after, replaceWith
     elements   tagName, children, first/lastElementChild, next/previousElementSibling, get/set/has/removeAttribute,
                id, className, classList, style (display, whiteSpace, backgroundImage, setProperty, getPropertyValue,
                getPropertyPriority, removeProperty, cssText), appendChild, insertBefore, replaceChild, removeChild,
                outerHTML, innerHTML, querySelector(All), matches, closest, and a <template>'s content
     selectors  type, *, .class, #id, [attr], [attr = ~= |= ^= $= *= value (i)], the four combinators, :not, :is,
                :where, :has (relative), :scope, :root, :empty, :first-child, :last-child, :only-child,
                :first-of-type, :last-of-type, :nth-child, :nth-last-child, :nth-of-type; any other pseudo-class
                matches nothing
   A <template>'s content is apart from the page, as in a browser: no selector finds what is in it (unless asked of
   its content), and nothing in it has an ancestor outside it. */
'use strict';

const { parseDocument } = require('htmlparser2');
const renderDom = require('dom-serializer').default;
const domutils = require('domutils');
const selectorParser = require('postcss-selector-parser');

/* node constructors of the same kind htmlparser2 builds, taken from htmlparser2 itself (domhandler is only its own
   dependency, not one this app declares) */
const SAMPLE = parseDocument('<i></i>x<!--c-->');
const ElementNode = SAMPLE.children[0].constructor;
const TextNode = SAMPLE.children[1].constructor;
const CommentNode = SAMPLE.children[2].constructor;

const SERIALIZE = { encodeEntities: 'utf8', emptyAttrs: true, selfClosingTags: false };

function isTag(n) { return !!n && domutils.isTag(n); }
function isTemplate(n) { return isTag(n) && String(n.name).toLowerCase() === 'template'; }

/* ---------- wrappers ---------- */
const wrappers = new WeakMap();
function wrap(n, doc) {
  if (!n) return null;
  var w = wrappers.get(n);
  if (w) return w;
  if (n.type === 'root') w = new Doc(n);
  else if (isTag(n)) w = new El(n, doc);
  else if (n.type === 'text') w = new Txt(n, doc);
  else if (n.type === 'comment') w = new Cmt(n, doc);
  else w = new Other(n, doc);
  wrappers.set(n, w);
  return w;
}
function unwrap(w) { return w && w._n ? w._n : w; }
function render(w) { var n = unwrap(w); return renderDom(Array.isArray(n) ? n : [n], SERIALIZE); }

/* the parent a browser gives: a node in a <template>'s content has none (its parent is a fragment) */
function parentOf(n) { var p = n.parent; return p && !isTemplate(p) ? p : null; }
function prevEl(n) { for (var s = n.prev; s; s = s.prev) if (isTag(s)) return s; return null; }
function nextEl(n) { for (var s = n.next; s; s = s.next) if (isTag(s)) return s; return null; }

/* the text a browser reads in a node: nothing of a comment, nor of a <template>'s content */
function textOf(n) {
  if (n.type === 'text') return n.data || '';
  if (!isTag(n) && n.type !== 'root') return '';
  if (isTemplate(n)) return '';
  return (n.children || []).map(textOf).join('');
}

function detach(n) { if (n.parent || n.prev || n.next) domutils.removeElement(n); }
function appendRaw(parent, child) { detach(child); domutils.appendChild(parent, child); }
function insertBeforeRaw(ref, child) { detach(child); domutils.prepend(ref, child); }

class Node {
  constructor(n, doc) { this._n = n; this._doc = doc || null; }
  _w(n) { return wrap(n, this._doc); }
  get ownerDocument() { return this._doc; }
  get parentNode() { var p = this._n.parent; return p ? (isTemplate(p) ? this._w(p).content : this._w(p)) : null; }
  get parentElement() { var p = parentOf(this._n); return p && isTag(p) ? this._w(p) : null; }
  get childNodes() { var self = this; return (this._n.children || []).map(function (c) { return self._w(c); }); }
  get firstChild() { var c = this._n.children; return c && c.length ? this._w(c[0]) : null; }
  get lastChild() { var c = this._n.children; return c && c.length ? this._w(c[c.length - 1]) : null; }
  get nextSibling() { return this._w(this._n.next); }
  get previousSibling() { return this._w(this._n.prev); }
  get textContent() { return textOf(this._n); }
  set textContent(v) {
    (this._n.children || []).slice().forEach(function (c) { domutils.removeElement(c); });
    v = v == null ? '' : String(v);
    if (v !== '' && this._n.children) domutils.appendChild(this._n, new TextNode(v));
  }
  get nodeValue() { return null; }
  get isConnected() { for (var n = this._n; n; n = n.parent) if (n.type === 'root') return true; return false; }
  contains(other) { for (var n = unwrap(other); n; n = n.parent) if (n === this._n) return true; return false; }
  cloneNode(deep) { return this._w(this._n.cloneNode(!!deep)); }
  remove() { detach(this._n); }
  before() { var self = this; Array.prototype.forEach.call(arguments, function (x) { insertBeforeRaw(self._n, self._raw(x)); }); }
  after() {
    var at = this._n, self = this;
    Array.prototype.forEach.call(arguments, function (x) { var r = self._raw(x); detach(r); domutils.append(at, r); at = r; });
  }
  replaceWith(x) { var r = this._raw(x); if (r === this._n) return; insertBeforeRaw(this._n, r); detach(this._n); }
  _raw(x) { return typeof x === 'string' ? new TextNode(x) : unwrap(x); }
}

class Txt extends Node {
  get nodeType() { return 3; }
  get nodeName() { return '#text'; }
  get nodeValue() { return this._n.data; }
  set nodeValue(v) { this._n.data = v == null ? '' : String(v); }
  get data() { return this._n.data; }
  set data(v) { this._n.data = v == null ? '' : String(v); }
  get textContent() { return this._n.data; }
  set textContent(v) { this._n.data = v == null ? '' : String(v); }
}
class Cmt extends Txt {
  get nodeType() { return 8; }
  get nodeName() { return '#comment'; }
  get textContent() { return this._n.data; }
  set textContent(v) { this._n.data = v == null ? '' : String(v); }
}
class Other extends Node { get nodeType() { return 7; } }

/* ---------- the parts every element and the document share: children and selectors ---------- */
const ParentMixin = {
  get children() { var self = this; return (this._n.children || []).filter(isTag).map(function (c) { return self._w(c); }); },
  get childElementCount() { return (this._n.children || []).filter(isTag).length; },
  get firstElementChild() { var c = (this._n.children || []).filter(isTag); return c.length ? this._w(c[0]) : null; },
  get lastElementChild() { var c = (this._n.children || []).filter(isTag); return c.length ? this._w(c[c.length - 1]) : null; },
  appendChild(child) {
    if (child instanceof Fragment) { var self = this; child.childNodes.forEach(function (c) { self.appendChild(c); }); return child; }
    appendRaw(this._n, unwrap(child));
    return child;
  },
  append() { var self = this; Array.prototype.forEach.call(arguments, function (x) { self.appendChild(typeof x === 'string' ? self._w(new TextNode(x)) : x); }); },
  prepend() {
    var self = this, first = this._n.children && this._n.children[0];
    Array.prototype.forEach.call(arguments, function (x) {
      var r = typeof x === 'string' ? new TextNode(x) : unwrap(x);
      if (first) insertBeforeRaw(first, r); else appendRaw(self._n, r);
    });
  },
  insertBefore(child, ref) {
    if (!ref) return this.appendChild(child);
    if (unwrap(ref).parent !== this._n) throw new Error('insertBefore: the reference node is not a child of this node.');
    insertBeforeRaw(unwrap(ref), unwrap(child));
    return child;
  },
  replaceChild(child, old) { insertBeforeRaw(unwrap(old), unwrap(child)); detach(unwrap(old)); return old; },
  removeChild(child) { detach(unwrap(child)); return child; },
  querySelectorAll(sel) {
    var list = compile(sel), scope = this._scopeEl(), out = [], self = this;
    walk(this._n, function (e) { if (list.some(function (c) { return matchComplex(e, c, scope); })) out.push(self._w(e)); });
    return out;
  },
  querySelector(sel) {
    var list = compile(sel), scope = this._scopeEl(), found = null;
    walk(this._n, function (e) { if (!found && list.some(function (c) { return matchComplex(e, c, scope); })) found = e; return !found; });
    return found ? this._w(found) : null;
  }
};

/* the descendants of a node in page order, never into a <template> below it; visit returning false stops */
function walk(root, visit) {
  var stop = false;
  (function go(n) {
    (n.children || []).forEach(function (c) {
      if (stop || !isTag(c)) return;
      if (visit(c) === false) { stop = true; return; }
      if (!isTemplate(c)) go(c);
    });
  })(root);
}

class El extends Node {
  get nodeType() { return 1; }
  get tagName() { return String(this._n.name).toUpperCase(); }
  get nodeName() { return this.tagName; }
  get localName() { return String(this._n.name).toLowerCase(); }
  _scopeEl() { return this._n; }
  _attr(name) {
    var a = this._n.attribs;
    if (Object.prototype.hasOwnProperty.call(a, name)) return name;
    var low = String(name).toLowerCase();
    return Object.prototype.hasOwnProperty.call(a, low) ? low : null;
  }
  getAttribute(name) { var k = this._attr(name); return k == null ? null : String(this._n.attribs[k]); }
  hasAttribute(name) { return this._attr(name) != null; }
  setAttribute(name, value) { var k = this._attr(name) || String(name).toLowerCase(); this._n.attribs[k] = String(value); }
  removeAttribute(name) { var k = this._attr(name); if (k != null) delete this._n.attribs[k]; }
  getAttributeNames() { return Object.keys(this._n.attribs); }
  get attributes() { var a = this._n.attribs; return Object.keys(a).map(function (k) { return { name: k, value: a[k] }; }); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() { return new ClassList(this); }
  get style() { return styleOf(this); }
  get outerHTML() { return render(this._n); }
  get innerHTML() { return render(this._n.children || []); }
  set innerHTML(html) {
    var self = this;
    (this._n.children || []).slice().forEach(function (c) { domutils.removeElement(c); });
    parseDocument(String(html), { lowerCaseTags: false, lowerCaseAttributeNames: false }).children.slice().forEach(function (c) { appendRaw(self._n, c); });
  }
  get content() { if (!isTemplate(this._n)) return undefined; return this._content || (this._content = new Fragment(this._n, this._doc)); }
  matches(sel) { var n = this._n; return compile(sel).some(function (c) { return matchComplex(n, c, n); }); }
  closest(sel) {
    var list = compile(sel);
    for (var n = this._n; n; n = parentOf(n)) {
      if (!isTag(n)) return null;
      if (list.some(function (c) { return matchComplex(n, c, n); })) return this._w(n);
    }
    return null;
  }
  get nextElementSibling() { return this._w(nextEl(this._n)); }
  get previousElementSibling() { return this._w(prevEl(this._n)); }
}
Object.defineProperties(El.prototype, Object.getOwnPropertyDescriptors(ParentMixin));

/* a <template>'s content: the template's own children, behaving as a fragment */
class Fragment extends Node {
  get nodeType() { return 11; }
  get nodeName() { return '#document-fragment'; }
  get parentNode() { return null; }
  get textContent() { return (this._n.children || []).map(function (c) { return isTemplate(c) ? '' : (c.type === 'text' ? c.data : isTag(c) ? textOf(c) : ''); }).join(''); }
  _scopeEl() { return null; }
}
Object.defineProperties(Fragment.prototype, Object.getOwnPropertyDescriptors(ParentMixin));

class Doc extends Node {
  constructor(n) { super(n, null); this._doc = this; }
  get nodeType() { return 9; }
  get nodeName() { return '#document'; }
  get ownerDocument() { return null; }
  get documentElement() { var h = (this._n.children || []).filter(isTag)[0]; return h ? this._w(h) : null; }
  get body() { return this.querySelector('body'); }
  get head() { return this.querySelector('head'); }
  get defaultView() { return null; }
  _scopeEl() { var h = (this._n.children || []).filter(isTag)[0]; return h || null; }
  createElement(name) { return this._w(new ElementNode(String(name).toLowerCase(), {})); }
  createTextNode(text) { return this._w(new TextNode(text == null ? '' : String(text))); }
  createComment(text) { return this._w(new CommentNode(text == null ? '' : String(text))); }
  createDocumentFragment() { return new Fragment(new ElementNode('template', {}), this); }
  importNode(node, deep) { return this._w(unwrap(node).cloneNode(!!deep)); }
}
Object.defineProperties(Doc.prototype, Object.getOwnPropertyDescriptors(ParentMixin));

function wrapDocument(root) { return wrap(root); }

/* ---------- class and style ---------- */
class ClassList {
  constructor(el) { this._el = el; }
  _tokens() { return (this._el.getAttribute('class') || '').split(/\s+/).filter(Boolean).filter(function (t, i, a) { return a.indexOf(t) === i; }); }
  _set(tokens) { if (!this._el.hasAttribute('class') && !tokens.length) return; this._el.setAttribute('class', tokens.join(' ')); }
  get length() { return this._tokens().length; }
  item(i) { return this._tokens()[i] || null; }
  contains(t) { return this._tokens().indexOf(t) !== -1; }
  add() { var t = this._tokens(); Array.prototype.forEach.call(arguments, function (x) { if (t.indexOf(x) === -1) t.push(x); }); this._set(t); }
  remove() { var drop = Array.prototype.slice.call(arguments); this._set(this._tokens().filter(function (x) { return drop.indexOf(x) === -1; })); }
  toggle(t, force) {
    var has = this.contains(t), on = force === undefined ? !has : !!force;
    if (on && !has) this.add(t); else if (!on && has) this.remove(t); else if (this._el.hasAttribute('class')) this._set(this._tokens());
    return on;
  }
  forEach(f) { this._tokens().forEach(f); }
  toString() { return this._tokens().join(' '); }
}

/* the declarations of a style attribute: [{ prop, value, important }] — ";" inside quotes or brackets is not a break */
function declarations(style) {
  var out = [], cur = '', depth = 0, quote = '';
  String(style || '').split('').forEach(function (ch) {
    if (quote) { if (ch === quote) quote = ''; cur += ch; return; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; return; }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ''; return; }
    cur += ch;
  });
  if (cur.trim()) out.push(cur.trim());
  return out.map(function (d) {
    var i = d.indexOf(':');
    if (i <= 0) return null;
    var value = d.slice(i + 1).trim(), important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    return { prop: d.slice(0, i).trim().toLowerCase(), value: value, important: important };
  }).filter(Boolean);
}
const STYLE_NAMES = { display: 'display', whiteSpace: 'white-space', backgroundImage: 'background-image', visibility: 'visibility' };
function styleOf(el) {
  function read() { return declarations(el.getAttribute('style')); }
  /* written back as a browser writes it once its style was changed: "prop: value;" one after the other ("" when
     none is left — the attribute stays, as in a browser) */
  function write(list) {
    el.setAttribute('style', list.map(function (d) { return d.prop + ': ' + d.value + (d.important ? ' !important' : '') + ';'; }).join(' '));
  }
  var api = {
    getPropertyValue: function (p) { var d = read().filter(function (x) { return x.prop === String(p).toLowerCase(); }).pop(); return d ? d.value : ''; },
    getPropertyPriority: function (p) { var d = read().filter(function (x) { return x.prop === String(p).toLowerCase(); }).pop(); return d && d.important ? 'important' : ''; },
    setProperty: function (p, v, prio) {
      p = String(p).toLowerCase(); v = v == null ? '' : String(v).trim();
      if (v === '') return api.removeProperty(p);
      var list = read(), found = false;
      list.forEach(function (d) { if (d.prop === p) { d.value = v; d.important = prio === 'important'; found = true; } });
      if (!found) list.push({ prop: p, value: v, important: prio === 'important' });
      write(list.filter(function (d, i) { return d.prop !== p || list.map(function (x) { return x.prop; }).lastIndexOf(p) === i; }));
    },
    removeProperty: function (p) {
      p = String(p).toLowerCase();
      if (!el.hasAttribute('style')) return '';
      var list = read(), was = api.getPropertyValue(p);
      if (!list.some(function (d) { return d.prop === p; })) return '';
      write(list.filter(function (d) { return d.prop !== p; }));
      return was;
    }
  };
  Object.keys(STYLE_NAMES).forEach(function (k) {
    Object.defineProperty(api, k, {
      get: function () { return api.getPropertyValue(STYLE_NAMES[k]); },
      set: function (v) { api.setProperty(STYLE_NAMES[k], v); }, enumerable: true
    });
  });
  Object.defineProperty(api, 'cssText', {
    get: function () { return read().map(function (d) { return d.prop + ': ' + d.value + (d.important ? ' !important' : '') + ';'; }).join(' '); },
    set: function (v) { el.setAttribute('style', String(v || '')); }
  });
  return api;
}

/* ---------- selectors ---------- */
const compiled = new Map();
function compile(sel) {
  sel = String(sel);
  var hit = compiled.get(sel);
  if (hit) return hit;
  var ast;
  try { ast = selectorParser().astSync(sel); } catch (e) { throw new Error('"' + sel + '" is not a valid selector.'); }
  var list = ast.nodes.map(compileComplex);
  if (compiled.size > 2000) compiled.clear();
  compiled.set(sel, list);
  return list;
}
/* -> { parts: [ { tests, comb } ], leading } — comb: how the part relates to the one before it (' ', '>', '+', '~');
   leading: a relative selector's combinator to the scope (inside :has) */
function compileComplex(node) {
  var parts = [], cur = { tests: [], comb: null }, leading = null;
  node.nodes.forEach(function (t) {
    if (t.type === 'comment') return;
    if (t.type === 'combinator') {
      var v = String(t.value).trim() || ' ';
      if (!cur.tests.length && !parts.length) { leading = v; return; }
      parts.push(cur);
      cur = { tests: [], comb: v };
      return;
    }
    cur.tests.push(compileSimple(t));
  });
  parts.push(cur);
  return { parts: parts, leading: leading };
}
function classesOf(n) { return String((n.attribs && n.attribs['class']) || '').split(/\s+/).filter(Boolean); }
function attrValue(n, name) {
  var a = n.attribs || {};
  if (Object.prototype.hasOwnProperty.call(a, name)) return a[name];
  var low = name.toLowerCase();
  for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k) && k.toLowerCase() === low) return a[k];
  return null;
}
function nth(a, b, i) { /* is i (1-based) of the form a*n + b, n >= 0 */
  if (!a) return i === b;
  var n = (i - b) / a;
  return n >= 0 && Math.floor(n) === n;
}
function parseNth(text) {
  var s = String(text).replace(/\s+/g, '').toLowerCase();
  if (s === 'odd') return [2, 1];
  if (s === 'even') return [2, 0];
  var m = /^([+-]?\d*)n([+-]\d+)?$/.exec(s);
  if (m) return [m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : +m[1], m[2] ? +m[2] : 0];
  if (/^[+-]?\d+$/.test(s)) return [0, +s];
  throw new Error('"' + text + '" is not an :nth- formula.');
}
function siblingsOf(n) { var p = n.parent; return p ? (p.children || []).filter(isTag) : [n]; }
function compileSimple(t) {
  switch (t.type) {
    case 'universal': return function () { return true; };
    case 'tag': { var name = String(t.value).toLowerCase(); return function (n) { return String(n.name).toLowerCase() === name; }; }
    case 'class': { var cls = t.value; return function (n) { return classesOf(n).indexOf(cls) !== -1; }; }
    case 'id': { var id = t.value; return function (n) { return attrValue(n, 'id') === id; }; }
    case 'attribute': {
      var attr = t.attribute, op = t.operator, val = t.value == null ? '' : String(t.value), ci = !!t.insensitive;
      return function (n) {
        var v = attrValue(n, attr);
        if (v == null) return false;
        if (!op) return true;
        var have = ci ? String(v).toLowerCase() : String(v), want = ci ? val.toLowerCase() : val;
        switch (op) {
          case '=': return have === want;
          case '~=': return want !== '' && !/\s/.test(want) && have.split(/\s+/).indexOf(want) !== -1;
          case '|=': return have === want || have.indexOf(want + '-') === 0;
          case '^=': return want !== '' && have.indexOf(want) === 0;
          case '$=': return want !== '' && have.slice(-want.length) === want;
          case '*=': return want !== '' && have.indexOf(want) !== -1;
          default: return false;
        }
      };
    }
    case 'pseudo': {
      var p = String(t.value).toLowerCase(), inner = (t.nodes || []).map(compileComplex);
      switch (p) {
        case ':not': return function (n, scope) { return !inner.some(function (c) { return matchComplex(n, c, scope); }); };
        case ':is': case ':where': case ':matches': return function (n, scope) { return inner.some(function (c) { return matchComplex(n, c, scope); }); };
        case ':has': return function (n) { return inner.some(function (c) { return hasRelative(n, c); }); };
        case ':scope': return function (n, scope) { return n === scope; };
        case ':root': return function (n) { return !!n.parent && n.parent.type === 'root'; };
        case ':empty': return function (n) { return !(n.children || []).some(function (c) { return isTag(c) || (c.type === 'text' && c.data !== ''); }); };
        case ':first-child': return function (n) { return !prevEl(n); };
        case ':last-child': return function (n) { return !nextEl(n); };
        case ':only-child': return function (n) { return !prevEl(n) && !nextEl(n); };
        case ':first-of-type': return function (n) { return siblingsOf(n).filter(function (s) { return s.name === n.name; })[0] === n; };
        case ':last-of-type': return function (n) { var s = siblingsOf(n).filter(function (x) { return x.name === n.name; }); return s[s.length - 1] === n; };
        case ':nth-child': case ':nth-last-child': case ':nth-of-type': case ':nth-last-of-type': {
          var f = parseNth(String(t.nodes && t.nodes[0] ? t.nodes[0].toString() : '').trim());
          var ofType = /of-type/.test(p), last = /last/.test(p);
          return function (n) {
            var s = siblingsOf(n).filter(function (x) { return !ofType || x.name === n.name; });
            if (last) s = s.slice().reverse();
            return nth(f[0], f[1], s.indexOf(n) + 1);
          };
        }
        default: return function () { return false; };            // :hover, :focus and the like: never, here
      }
    }
    case 'nesting': return function (n, scope) { return n === scope; };
    default: throw new Error('The selector part "' + String(t) + '" is not supported.');
  }
}
function matchCompound(n, tests, scope) { for (var i = 0; i < tests.length; i++) if (!tests[i](n, scope)) return false; return true; }
function related(n, scope, comb) {
  if (!scope) return false;
  if (comb === '>') return parentOf(n) === scope;
  if (comb === '+') return prevEl(n) === scope;
  if (comb === '~') { for (var s = prevEl(n); s; s = prevEl(s)) if (s === scope) return true; return false; }
  for (var p = parentOf(n); p; p = parentOf(p)) if (p === scope) return true;
  return false;
}
function matchParts(n, parts, i, scope, leading) {
  if (!isTag(n) || !matchCompound(n, parts[i].tests, scope)) return false;
  if (i === 0) return leading ? related(n, scope, leading) : true;
  var comb = parts[i].comb, x;
  if (comb === '>') { x = parentOf(n); return !!x && matchParts(x, parts, i - 1, scope, leading); }
  if (comb === '+') { x = prevEl(n); return !!x && matchParts(x, parts, i - 1, scope, leading); }
  if (comb === '~') { for (x = prevEl(n); x; x = prevEl(x)) if (matchParts(x, parts, i - 1, scope, leading)) return true; return false; }
  for (x = parentOf(n); x; x = parentOf(x)) if (matchParts(x, parts, i - 1, scope, leading)) return true;
  return false;
}
function matchComplex(n, c, scope) { return matchParts(n, c.parts, c.parts.length - 1, scope, c.leading); }
/* :has(<relative selector>) of n: something after it or inside it that the selector reaches from n */
function hasRelative(n, c) {
  var lead = c.leading || ' ', found = false;
  function test(e) { if (matchParts(e, c.parts, c.parts.length - 1, n, lead)) { found = true; return false; } }
  if (lead === ' ' || lead === '>') { walk(n, test); return found; }
  for (var s = nextEl(n); s && !found; s = nextEl(s)) { if (test(s) === false) break; walk(s, test); }
  return found;
}

module.exports = { wrapDocument: wrapDocument, unwrap: unwrap, render: render, SERIALIZE: SERIALIZE, declarations: declarations };
