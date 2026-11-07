/* A small in-memory DOM for running a page's own script in node's vm, with no browser: elements parsed from
   innerHTML, ids, the selectors the dashboard uses (tag, #id, .class, [attr], [attr="v"], descendant and >),
   clicks and key presses that bubble, focus, and a window-level listener list. A copy of the one in
   events-portal-page.test.js (which keeps its own), shared here so events-dashboard-actions.test.js needs no
   third copy. Test-only: nothing in the product loads it. */
'use strict';
function makeDom() {
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', larr: '←', rarr: '→', uarr: '↑', darr: '↓', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
  function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, k) {
      if (k[0] === '#') return String.fromCharCode(k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
      return Object.prototype.hasOwnProperty.call(ENT, k) ? ENT[k] : m;
    });
  }
  function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

  var doc;
  function Text(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
  function El(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.localName = String(tag).toLowerCase();
    this.attrs = {}; this.childNodes = []; this.parentNode = null; this.listeners = {}; this.style = {};
    this._value = null; this._sel = false;
    var el = this;
    this.classList = {
      contains: function (c) { return el.className.split(/\s+/).indexOf(c) !== -1; },
      add: function (c) { if (!el.classList.contains(c)) el.className = (el.className + ' ' + c).trim(); },
      remove: function (c) { el.className = el.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(' '); },
      toggle: function (c, on) { if (on === undefined) on = !el.classList.contains(c); if (on) el.classList.add(c); else el.classList.remove(c); return on; }
    };
  }
  function reflect(prop, attr) {
    Object.defineProperty(El.prototype, prop, { get: function () { return this.attrs[attr] === undefined ? '' : this.attrs[attr]; }, set: function (v) { this.attrs[attr] = String(v); } });
  }
  function flag(prop) {
    Object.defineProperty(El.prototype, prop, { get: function () { return this.attrs[prop] !== undefined; }, set: function (v) { if (v) this.attrs[prop] = ''; else delete this.attrs[prop]; } });
  }
  reflect('id', 'id'); reflect('className', 'class'); reflect('type', 'type'); flag('hidden'); flag('disabled');
  Object.defineProperty(El.prototype, 'children', { get: function () { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); } });
  Object.defineProperty(El.prototype, 'isConnected', { get: function () { var n = this; while (n.parentNode) n = n.parentNode; return n === doc; } });
  Object.defineProperty(El.prototype, 'textContent', {
    get: function () { return this.childNodes.map(function (n) { return n.nodeType === 3 ? n.data : n.textContent; }).join(''); },
    set: function (v) { this.childNodes.forEach(function (n) { n.parentNode = null; }); this.childNodes = []; if (String(v)) this.appendChild(new Text(String(v))); }
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    get: function () { return this.childNodes.map(serialize).join(''); },
    set: function (v) { this.childNodes.forEach(function (n) { n.parentNode = null; }); this.childNodes = []; parseInto(this, String(v)); }
  });
  Object.defineProperty(El.prototype, 'options', { get: function () { return this.querySelectorAll('option'); } });
  Object.defineProperty(El.prototype, 'value', {
    get: function () {
      if (this.localName === 'select') {
        var opts = this.options, on = opts.filter(function (o) { return o._sel; })[0] || opts.filter(function (o) { return !o.disabled; })[0];
        return on ? on.value : '';
      }
      if (this.localName === 'option') return this.attrs.value !== undefined ? this.attrs.value : this.textContent;
      return this._value !== null ? this._value : (this.attrs.value || '');
    },
    set: function (v) {
      if (this.localName === 'select') { this.options.forEach(function (o) { o._sel = o.value === String(v); }); return; }
      this._value = String(v);
    }
  });
  El.prototype.setAttribute = function (k, v) { this.attrs[String(k).toLowerCase()] = String(v); };
  El.prototype.getAttribute = function (k) { k = String(k).toLowerCase(); return this.attrs[k] === undefined ? null : this.attrs[k]; };
  El.prototype.hasAttribute = function (k) { return this.attrs[String(k).toLowerCase()] !== undefined; };
  El.prototype.removeAttribute = function (k) { delete this.attrs[String(k).toLowerCase()]; };
  El.prototype.appendChild = function (n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; };
  El.prototype.insertBefore = function (n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; };
  El.prototype.removeChild = function (n) { var i = this.childNodes.indexOf(n); if (i !== -1) this.childNodes.splice(i, 1); n.parentNode = null; if (doc.activeElement && !doc.activeElement.isConnected) doc.activeElement = doc.body; return n; };
  El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  El.prototype.contains = function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; };
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.removeEventListener = function (t, fn) { var l = this.listeners[t] || []; var i = l.indexOf(fn); if (i !== -1) l.splice(i, 1); };
  El.prototype.focus = function () { if (this.disabled || !this.isConnected) return; doc.activeElement = this; };
  El.prototype.blur = function () { if (doc.activeElement === this) doc.activeElement = doc.body; };
  El.prototype.click = function () { fire(this, 'click'); };
  El.prototype.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
  El.prototype.scrollIntoView = function () {};
  ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'].forEach(function (k) { Object.defineProperty(El.prototype, k, { get: function () { return 0; } }); });
  El.prototype.querySelectorAll = function (sel) { var out = []; walk(this, function (n) { if (matches(n, sel)) out.push(n); }); return out; };
  El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  El.prototype.matches = function (sel) { return matches(this, sel); };
  El.prototype.closest = function (sel) { for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; };
  function walk(root, fn) { root.childNodes.forEach(function (n) { if (n.nodeType === 1) { fn(n); walk(n, fn); } }); }

  function compound(el, s) {
    var m, re = /([a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g, any = false;
    while ((m = re.exec(s))) {
      any = true;
      if (m[1] && el.localName !== m[1].toLowerCase()) return false;
      if (m[2] && el.getAttribute('id') !== m[2]) return false;
      if (m[3] && !el.classList.contains(m[3])) return false;
      if (m[4]) { var want = m[5] !== undefined ? m[5] : m[6] !== undefined ? m[6] : m[7]; var have = el.getAttribute(m[4]); if (have === null || (want !== undefined && have !== want)) return false; }
    }
    return any;
  }
  function matchOne(el, sel) {
    var parts = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
    function back(node, i) {
      if (!compound(node, parts[i])) return false;
      if (i === 0) return true;
      if (parts[i - 1] === '>') { var p = node.parentNode; return !!p && p.nodeType === 1 && back(p, i - 2); }
      for (var a = node.parentNode; a && a.nodeType === 1; a = a.parentNode) if (back(a, i - 1)) return true;
      return false;
    }
    return back(el, parts.length - 1);
  }
  function matches(el, sel) { return el.nodeType === 1 && sel.split(',').some(function (s) { return matchOne(el, s); }); }

  function parseInto(parent, html) {
    var re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+|<)/g, m, stack = [parent];
    while ((m = re.exec(html))) {
      var top = stack[stack.length - 1];
      if (m[0].slice(0, 4) === '<!--') continue;
      if (m[1]) {
        var t = m[1].toLowerCase();
        for (var i = stack.length - 1; i > 0; i--) if (stack[i].localName === t) { stack.length = i; break; }
      } else if (m[2]) {
        var el = new El(m[2]), am, are = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        while ((am = are.exec(m[3]))) el.attrs[am[1].toLowerCase()] = decode(am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '');
        if (el.localName === 'option') el._sel = el.attrs.selected !== undefined;
        top.appendChild(el);
        if (!m[4] && !VOID[el.localName]) stack.push(el);
      } else if (m[5]) {
        top.appendChild(new Text(decode(m[5])));
      }
    }
  }
  function serialize(n) {
    if (n.nodeType === 3) return escText(n.data);
    var a = Object.keys(n.attrs).map(function (k) { return ' ' + k + (n.attrs[k] === '' && (k === 'hidden' || k === 'disabled' || k === 'selected') ? '' : '="' + escAttr(n.attrs[k]) + '"'); }).join('');
    return '<' + n.localName + a + '>' + (VOID[n.localName] ? '' : n.childNodes.map(serialize).join('') + '</' + n.localName + '>');
  }

  var winListeners = {};
  function fire(target, type, init) {
    var ev = { type: type, target: target, defaultPrevented: false, stopped: false, button: 0 };
    Object.keys(init || {}).forEach(function (k) { ev[k] = init[k]; });
    ev.preventDefault = function () { ev.defaultPrevented = true; };
    ev.stopPropagation = function () { ev.stopped = true; };
    var chain = [];
    for (var n = target; n; n = n.parentNode) chain.push(n);
    for (var i = 0; i < chain.length && !ev.stopped; i++) {
      ev.currentTarget = chain[i];
      (chain[i].listeners[type] || []).slice().forEach(function (fn) { fn.call(chain[i], ev); });
    }
    if (!ev.stopped) (winListeners[type] || []).slice().forEach(function (fn) { fn(ev); });
    return ev;
  }

  doc = new El('#document');
  doc.nodeType = 9;
  var html = new El('html'), head = new El('head'), body = new El('body');
  doc.appendChild(html); html.appendChild(head); html.appendChild(body);
  doc.documentElement = html; doc.head = head; doc.body = body; doc.activeElement = body; doc.readyState = 'complete';
  doc.createElement = function (t) { return new El(t); };
  doc.getElementById = function (id) { var hit = null; walk(doc, function (n) { if (!hit && n.getAttribute('id') === id) hit = n; }); return hit; };
  return { document: doc, El: El, fire: fire, winListeners: winListeners,
    key: function (target, key, extra) { var o = { key: key }; Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; }); return fire(target, 'keydown', o); } };
}

module.exports = { makeDom: makeDom };
