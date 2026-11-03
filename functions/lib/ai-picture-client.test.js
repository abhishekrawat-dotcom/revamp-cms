// node functions/lib/ai-picture-client.test.js — ETB2B AI's new pictures, the editor's half (editor-ai-picture.js,
// window.RevampAiPicture): what each section tells the AI about its pictures (describe), which pictures are never
// replaced (isProtected), which one a new picture replaces (chooseSlot, target), the swap itself (place), the
// banner's veil being gen-design.js's own (heroVeilCss), the logo unit check (unitState), and that the file is ES5
// and loaded by the editor in the right place.
// No network and no AI: the file runs in a vm over a small DOM made here from HTML (htmlparser2), with each
// element's size given by a test-only data-t-box="<w> <h>", its stylesheet background by data-t-bg and the colour
// its words are drawn in by data-t-color. The
// canvas's own picture setters (setPicture, backgroundHost, setBackgroundPicture) are taken from editor-canvas.js
// as they are, so the swaps tested here are the editor's real ones.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const htmlparser2 = require('htmlparser2');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'editor-ai-picture.js'), 'utf8');
var CANVAS_SRC = fs.readFileSync(path.join(ROOT, 'editor-canvas.js'), 'utf8');
var EDITOR_HTML = fs.readFileSync(path.join(ROOT, 'custom_editor.html'), 'utf8');
var passed = 0, failed = 0;
// a failure's detail as text: an element as its tag and class (the DOM's parent links would make JSON go round)
function show(v) {
  try {
    return JSON.stringify(v, function (k, x) { return x && x.nodeType === 1 ? '<' + x.tagName + (x.getAttribute('class') ? '.' + x.getAttribute('class') : '') + '>' : x; });
  } catch (e) { return String(v); }
}
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failed++;
  console.error('FAIL ' + name + (detail !== undefined ? ' — ' + show(detail) : ''));
}

/* ======================= a small DOM ======================= */
function camel(p) { return p.trim().toLowerCase().replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); }); }
function parseStyle(text) {
  var o = {};
  String(text || '').split(';').forEach(function (d) {
    var at = d.indexOf(':');
    if (at > 0) o[camel(d.slice(0, at))] = d.slice(at + 1).trim();
  });
  return o;
}
function Node(type) { this.nodeType = type; this.parentNode = null; this.childNodes = []; }
function El(tag, attrs, doc) {
  Node.call(this, 1);
  var lower = String(tag).toLowerCase();
  this._svg = lower === 'svg' || false;
  this.tagName = lower;            // fixed up in append(): HTML upper case, SVG (and what is inside it) lower case
  this._attrs = {};
  this._order = [];
  this.ownerDocument = doc;
  this.style = {};
  var self = this;
  Object.keys(attrs || {}).forEach(function (k) { self.setAttribute(k, attrs[k]); });
  this.classList = {
    contains: function (c) { return self._classes().indexOf(c) !== -1; },
    add: function (c) { var l = self._classes(); if (l.indexOf(c) === -1) { l.push(c); self.setAttribute('class', l.join(' ')); } },
    remove: function (c) { self.setAttribute('class', self._classes().filter(function (x) { return x !== c; }).join(' ')); }
  };
}
El.prototype = Object.create(Node.prototype);
El.prototype._classes = function () { return String(this._attrs['class'] || '').split(/\s+/).filter(Boolean); };
El.prototype.getAttribute = function (n) { n = n.toLowerCase(); return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; };
El.prototype.hasAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this._attrs, n.toLowerCase()); };
El.prototype.setAttribute = function (n, v) {
  n = n.toLowerCase();
  if (!this.hasAttribute(n)) this._order.push(n);
  this._attrs[n] = String(v);
  if (n === 'style') this.style = parseStyle(v);
  if (this.ownerDocument && this.ownerDocument._log) this.ownerDocument._log.push(['set', this, n, String(v)]);
};
El.prototype.removeAttribute = function (n) { n = n.toLowerCase(); delete this._attrs[n]; this._order = this._order.filter(function (x) { return x !== n; }); };
Object.defineProperty(El.prototype, 'id', { get: function () { return this.getAttribute('id') || ''; } });
Object.defineProperty(El.prototype, 'parentElement', { get: function () { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; } });
Object.defineProperty(El.prototype, 'children', { get: function () { return this.childNodes.filter(function (n) { return n.nodeType === 1; }); } });
Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
Object.defineProperty(El.prototype, 'textContent', { get: function () { return this.childNodes.map(function (n) { return n.nodeType === 3 ? n.nodeValue : n.textContent; }).join(''); } });
Object.defineProperty(El.prototype, 'isConnected', { get: function () { var n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument; } });
El.prototype.append = function (child) {
  child.parentNode = this;
  if (child.nodeType === 1) child.tagName = (this._svg || child._svg) ? child.tagName.toLowerCase() : child.tagName.toUpperCase();
  if (child.nodeType === 1 && this._svg) child._svg = true;
  this.childNodes.push(child);
};
El.prototype.removeChild = function (c) { this.childNodes = this.childNodes.filter(function (n) { return n !== c; }); c.parentNode = null; return c; };
El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
El.prototype.contains = function (o) { for (var n = o; n; n = n.parentNode) if (n === this) return true; return false; };
El.prototype.getBoundingClientRect = function () {
  var b = String(this.getAttribute('data-t-box') || '0 0').split(/\s+/).map(Number);
  return { width: b[0] || 0, height: b[1] || 0, top: 0, left: 0 };
};
function descendants(root) {
  var out = [];
  (function walk(n) { n.childNodes.forEach(function (c) { if (c.nodeType === 1) { out.push(c); walk(c); } }); })(root);
  return out;
}
El.prototype.matches = function (sel) { return matchList(this, sel); };
El.prototype.closest = function (sel) { for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (matchList(n, sel)) return n; return null; };
El.prototype.querySelectorAll = function (sel) { return descendants(this).filter(function (e) { return matchList(e, sel); }); };
El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };

/* selectors: lists, descendant combinators, tag, *, #id, .class, [a], [a="v"], [a^="v"], :not(simple) */
function splitTop(s, ch) {
  var out = [], depth = 0, cur = '', q = '';
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '(') depth++;
    if (c === ']' || c === ')') depth--;
    if (depth === 0 && (ch === ' ' ? /\s/.test(c) : c === ch)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function matchCompound(el, comp) {
  var re = /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:(\^?=)"([^"]*)")?\]|:not\(([^)]*)\)/g, m, at = 0;
  while ((m = re.exec(comp)) && m[0]) {
    if (m.index !== at) throw new Error('selector not understood by the test DOM: ' + comp);
    at = re.lastIndex;
    if (m[1] && m[1] !== '*' && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4]) {
      if (!el.hasAttribute(m[4])) return false;
      var v = el.getAttribute(m[4]);
      if (m[5] === '=' && v !== m[6]) return false;
      if (m[5] === '^=' && v.indexOf(m[6]) !== 0) return false;
    }
    if (m[7] !== undefined && matchCompound(el, m[7])) return false;
  }
  if (at !== comp.length) throw new Error('selector not understood by the test DOM: ' + comp);
  return true;
}
function matchComplex(el, parts) {
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  var rest = parts.slice(0, -1);
  if (!rest.length) return true;
  for (var n = el.parentNode; n && n.nodeType === 1; n = n.parentNode) if (matchComplex(n, rest)) return true;
  return false;
}
function matchList(el, sel) { return splitTop(sel, ',').some(function (one) { return matchComplex(el, splitTop(one, ' ')); }); }

function makeDoc(html) {
  var doc = new Node(9);
  doc._log = null;
  var htmlEl = new El('html', {}, doc);
  htmlEl.tagName = 'HTML'; htmlEl.parentNode = doc; doc.childNodes.push(htmlEl);
  doc.documentElement = htmlEl;
  var body = new El('body', {}, doc);
  htmlEl.append(body);
  doc.body = body;
  var stack = [body];
  var parser = new htmlparser2.Parser({
    onopentag: function (name, attrs) { var el = new El(name, attrs, doc); stack[stack.length - 1].append(el); stack.push(el); },
    ontext: function (t) { var n = new Node(3); n.nodeValue = t; stack[stack.length - 1].append(n); },
    onclosetag: function () { stack.pop(); }
  }, { recognizeSelfClosing: true, lowerCaseAttributeNames: true });
  parser.write(html); parser.end();
  doc.querySelectorAll = function (sel) { return [htmlEl].concat(descendants(htmlEl)).filter(function (e) { return matchList(e, sel); }); };
  doc.querySelector = function (sel) { return doc.querySelectorAll(sel)[0] || null; };
  doc.getElementById = function (id) { return doc.querySelector('#' + id); };
  doc.createElementNS = function (ns, tag) { var e = new El(tag, {}, doc); e._svg = true; return e; };
  doc.defaultView = {
    getComputedStyle: function (el) {
      return {
        backgroundImage: el.style.backgroundImage || el.getAttribute('data-t-bg') || 'none',
        visibility: el.getAttribute('data-t-vis') || el.style.visibility || 'visible',
        display: el.style.display || 'block',
        color: el.getAttribute('data-t-color') || undefined          // what the browser draws the words in, when a test says
      };
    }
  };
  return doc;
}

/* the canvas's own picture setters, from editor-canvas.js: setPicture … setBackgroundPicture, run over this DOM */
function canvasFor(doc) {
  var from = CANVAS_SRC.indexOf('    function setPicture(el, url) {');
  var to = CANVAS_SRC.indexOf('    /* ---------- a section designed again ----------');
  if (from < 0 || to < from) throw new Error('editor-canvas.js no longer has setPicture … setBackgroundPicture in one place: update this test');
  var body = CANVAS_SRC.slice(from, to);
  var make = new Function('win', 'doc', 'isSvg', body + '\nreturn { setPicture: setPicture, pictureOf: pictureOf, backgroundOf: bgUrlOf, backgroundHost: backgroundHost, setBackgroundPicture: setBackgroundPicture };');
  var api = make(doc.defaultView, doc, function (el) { return el.tagName.toUpperCase() === 'SVG'; });
  api.win = doc.defaultView;
  api.doc = doc;
  api.sections = function () { return doc.querySelectorAll('[data-rv-section]'); };
  return api;
}

function load(extra) {
  var ctx = { console: { error: function () {}, log: function () {} } };
  Object.keys(extra || {}).forEach(function (k) { ctx[k] = extra[k]; });
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'editor-ai-picture.js' });
  return ctx;
}
var ctx = load();
var P = ctx.RevampAiPicture;

/* ======================= the pages ======================= */
var EV = 'qa-aipic-1200';
var STORE = 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/' + EV + '/';
var OTHER = 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/qa-other/';
var NEW_PIC = STORE + 'generated/1730000000000-chat-place-abcd1234.png';

/* a generated site: the ET nav, a banner with a picture and the logo unit, then sections of every kind */
var GEN = [
  '<header data-rv-section="nav" data-rv-key="nav" data-sec-name="Top bar" data-rv-etnav data-t-box="1440 80">',
  '  <img data-rv-logo src="/templates/_shared/img/et-business-verticals-on-light.svg" alt="ET" data-t-box="300 40">',
  '  <img class="nav-pic" src="' + STORE + 'generated/1-nav.png" data-t-box="400 200">',
  '</header>',
  '<section id="hero" class="hero-root hero-on-dark" data-rv-section="hero" data-rv-key="hero" data-sec-name="Hero banner" data-t-box="1440 800" data-t-bg="url(&quot;' + STORE + 'generated/1-hero-bg.png&quot;)">',
  '  <div class="hero-veil" aria-hidden="true" data-t-box="1440 800"></div>',
  '  <div class="hero-inner" data-t-box="980 500">',
  '    <div class="rv-lu rv-lu-pic rv-lu-on-dark" data-rv-logo-unit data-rv-logo-note="Check the year" data-t-box="700 260">',
  '      <img class="rv-lu-img" src="' + STORE + 'logo-unit/unit.png" alt="Agentic AI Summit 2027" data-t-box="700 260">',
  '      <img class="rv-lu-img rv-lu-dark" src="' + STORE + 'logo-unit/unit-dark.png" alt="" aria-hidden="true" data-t-box="700 260">',
  '    </div>',
  '    <h1 class="hero-tagline">Where AI gets to work</h1>',
  '  </div>',
  '</section>',
  '<section data-rv-section="agenda" data-rv-key="agenda" data-sec-name="Agenda" data-t-box="1440 900">',
  '  <h2>Agenda</h2><div data-rv-repeat-template="sessions" data-t-box="1200 100"><h3 data-rv-field="title">Session</h3></div>',
  '</section>',
  '<section data-rv-section="venue" data-rv-key="venue" data-sec-name="Venue" data-t-box="1440 700">',
  '  <img class="venue-pic" src="' + STORE + 'generated/1-venue.png" alt="The hall at night, seen from the stage" data-t-box="640 400">',
  '  <img class="venue-icon" src="' + STORE + 'icons/pin.png" alt="" data-t-box="40 40">',
  '  <svg data-editable="image" viewBox="0 0 24 24" data-t-box="200 200"><path d="M0 0h24v24H0z"></path></svg>',
  '</section>',
  '<section data-rv-section="why-attend" data-rv-key="why-attend" data-sec-name="Why attend" data-t-box="1440 900">',
  '  <img class="wa-1" src="' + STORE + 'generated/1-why-attend.png" alt="Delegates talking over coffee" data-t-box="500 350">',
  '  <img class="wa-2" src="https://img.etb2bimg.com/files/stage.jpg" alt="" data-t-box="500 350">',
  '  <img class="wa-3" src="' + OTHER + 'generated/x.png" alt="Hidden one" data-t-box="500 350" data-t-vis="hidden">',
  '  <img class="wa-small" src="' + STORE + 'thumb.png" alt="tiny" data-t-box="100 80">',
  '  <div class="wa-box" data-editable="image" aria-label="Badge wall" data-t-box="300 300"><img class="wa-inner" src="' + STORE + 'box.png" data-t-box="300 300"></div>',
  '  <img class="wa-partner-logo" src="https://img.etb2bimg.com/files/acme.png" alt="Acme" data-t-box="300 150" data-rv-bind="partner.logo">',
  '  <picture class="wa-pic"><source srcset="https://img.etb2bimg.com/files/a.webp" type="image/webp"><img class="wa-4" src="https://img.etb2bimg.com/files/a.jpg" alt="A corridor" data-t-box="400 300"></picture>',
  '</section>',
  '<section data-rv-section="speakers" data-rv-key="speakers" data-sec-name="Speakers" data-rv-bound="speakers" data-t-box="1440 900" data-t-bg="url(&quot;' + STORE + 'generated/1-speakers.png&quot;)">',
  '  <article data-rv-item="speakers" data-rv-id="s1" data-t-box="300 400"><img class="sp-1" src="' + STORE + 'speakers/s1.jpg" alt="Asha Rao" data-t-box="300 300"></article>',
  '  <img class="sp-deco" src="' + STORE + 'generated/1-deco.png" alt="Decoration" data-t-box="600 400">',
  '</section>',
  '<section data-rv-section="previous-glimpses" data-rv-key="previous-glimpses" data-sec-name="Moments from 2026" data-t-box="1440 700">',
  '  <img class="pg-1" src="https://img.etb2bimg.com/files/2026-1.jpg" alt="Day one" data-t-box="600 400">',
  '</section>',
  '<section data-rv-section="leaders" data-rv-key="leaders" data-sec-name="The people" data-t-box="1440 700">',
  '  <img class="ld-1" src="https://img.etb2bimg.com/files/leader.jpg" alt="A leader" data-t-box="600 400">',
  '</section>',
  '<section data-rv-section="about" data-rv-key="about" data-sec-name="About the summit" data-t-box="1440 600">',
  '  <div class="about-bg" data-t-box="1440 600" data-t-bg="linear-gradient(rgba(0,0,0,.5), rgba(0,0,0,.5)), url(&quot;' + STORE + 'generated/1-about.png&quot;)"></div>',
  '  <img class="about-logo" src="https://img.etb2bimg.com/files/etcio.png" alt="" data-t-box="300 120">',
  '  <img class="about-brand" src="https://img.etb2bimg.com/files/etcio-logo-2026.png" alt="" data-t-box="300 120">',
  '</section>',
  '<section data-rv-section="register" data-rv-key="register" data-sec-name="Register" data-t-box="1440 600">',
  '  <div data-rv-form-embed="f1" data-t-box="600 500"><img class="form-pic" src="' + STORE + 'f.png" data-t-box="600 300"></div>',
  '  <img class="reg-shared" src="/templates/_shared/img/et-business-verticals-on-dark.svg" alt="" data-t-box="400 100">',
  '</section>',
  '<footer id="footer" data-rv-section="footer" data-rv-key="footer" data-sec-name="Footer" data-rv-et-footer="et" data-t-box="1440 300">',
  '  <img class="ft-pic" src="https://img.etb2bimg.com/files/footer.jpg" alt="" data-t-box="600 200">',
  '</footer>'
].join('\n');

/* a ported template (tech500): the banner's picture is one full-bleed <img>, over the section's own background */
var PORTED = [
  '<section id="banner" class="mb-medium bgCover_1" data-rv-section="banner" data-rv-key="banner" data-sec-name="Banner" data-t-box="1440 700" data-t-bg="url(&quot;https://img.etb2bimg.com/files/under.jpg&quot;)">',
  '  <img src="https://img.etb2bimg.com/files/data_file_1.jpg" alt="" class="banner-bg-image" data-rv-media="bg-image" data-t-box="1440 700">',
  '  <div class="bnr-bg-video" data-rv-media="bg-video"></div>',
  '  <div class="overlay-lyr" data-t-box="1440 700"></div>',
  '  <div class="cntnd"><img alt="" class="logo" data-rv-bind="event.logo" data-t-box="400 160"><h1 class="banner-title" data-rv-bind="event.name">Event name</h1></div>',
  '</section>',
  '<section data-rv-section="why-now" data-rv-key="why-now" data-sec-name="Why now" data-t-box="1440 600"><p>Text</p></section>'
].join('\n');

/* a generated banner that has no picture yet: only its veil, which shows nothing until it has one */
var VEILED = [
  '<header data-rv-section="nav" data-rv-key="nav" data-rv-etnav data-t-box="1440 80"></header>',
  '<section id="hero" class="hero-root hero-on-light" data-rv-section="hero" data-rv-key="hero" data-sec-name="Hero" data-t-box="1440 800" data-t-bg="radial-gradient(120% 90% at 50% 0%, red, transparent 70%)">',
  '  <div class="hero-veil" aria-hidden="true" data-t-box="1440 800"></div>',
  '  <div class="hero-inner"><div class="rv-lu rv-lu-on-light" data-rv-logo-unit data-t-box="600 200"><img class="rv-lu-et" src="/templates/_shared/img/et-business-verticals-on-light.svg" alt="The Economic Times Business Verticals" data-t-box="365 35"><div class="rv-lu-name"><span class="rv-lu-key">Retail</span> Summit</div></div></div>',
  '</section>'
].join('\n');

/* the banner while a video plays over it (the canvas draws the video's still, an editor-only layer) */
var VIDEO = [
  '<section id="hero" class="hero-root hero-on-dark" data-rv-section="hero" data-rv-key="hero" data-t-box="1440 800" data-t-bg="url(&quot;' + STORE + 'generated/1-hero-bg.png&quot;)">',
  '  <div class="rv-hv rv-hv-editor" data-rv-editor data-rv-hv-preview data-ed="none" aria-hidden="true" data-t-box="1440 800"><img src="' + STORE + 'video/poster.jpg" data-t-box="1440 800"></div>',
  '  <div class="hero-veil" data-t-box="1440 800"></div>',
  '</section>'
].join('\n');

/* a banner with nowhere for a picture, and a first section that is the banner only by where it is and what it holds */
var BARE = [
  '<header data-rv-section="nav" data-rv-key="nav" data-rv-etnav data-t-box="1440 80"><img data-rv-bind="event.logo" data-t-box="200 60"></header>',
  '<section data-rv-section="intro" data-rv-key="intro" data-sec-name="Welcome" data-t-box="1440 700"><img class="intro-logo" data-rv-bind="event.logo" alt="" data-t-box="400 160"><h1>Welcome</h1></section>',
  '<section data-rv-section="second" data-rv-key="second" data-sec-name="Second" data-t-box="1440 700"><img data-rv-bind="event.logo" data-t-box="400 160"></section>'
].join('\n');

/* the ported banner while the event's banner video from Create Event plays over it: editor-fill.js fillBgVideo's
   <video data-rv-video data-src poster> in .bnr-bg-video, which the site fades in over the picture on wider screens */
var PORTED_VIDEO = PORTED.replace('<div class="bnr-bg-video" data-rv-media="bg-video"></div>',
  '<div class="bnr-bg-video" data-rv-media="bg-video"><video muted loop playsinline data-rv-video preload="none" data-src="https://img.etb2bimg.com/files/banner.mp4" poster="https://img.etb2bimg.com/files/data_file_1.jpg"></video></div>');
/* … the served layer of Design › Banner video in the same place (rv-hero-video-core.js videoTag), and a layer with
   no address (fillBgVideo with no video leaves none; an empty one plays nothing) */
var PORTED_SERVED = PORTED.replace('<div class="bnr-bg-video" data-rv-media="bg-video"></div>',
  '<div class="bnr-bg-video" data-rv-media="bg-video"><video class="rv-hv-video" data-rv-bg-video data-rv-hero-video muted loop playsinline preload="none" data-rv-src="https://x.test/v.mp4" data-type="video/mp4"></video></div>');
var PORTED_EMPTY = PORTED.replace('<div class="bnr-bg-video" data-rv-media="bg-video"></div>',
  '<div class="bnr-bg-video" data-rv-media="bg-video"><video muted loop playsinline data-rv-video preload="none"></video></div>');

/* sections of real people with no record markers (an imported site, a hand-built section): named for people, or
   only their photos say so; then an ordinary section whose pictures carry Title Case words that are not names */
var PEOPLE = [
  '<header data-rv-section="nav" data-rv-key="nav" data-rv-etnav data-t-box="1440 80"></header>',
  '<section data-rv-section="judges" data-rv-key="judges" data-sec-name="Meet the Judges" data-t-box="1440 700" data-t-bg="url(&quot;https://img.etb2bimg.com/files/j-bg.jpg&quot;)">',
  '  <h2>Meet the Judges</h2><img class="jd-1" src="https://img.etb2bimg.com/files/j1.jpg" alt="Anita Desai, CEO, Acme" data-t-box="300 300">',
  '</section>',
  '<section data-rv-section="advisory-board" data-rv-key="advisory-board" data-sec-name="Advisory Board" data-t-box="1440 700">',
  '  <img class="ab-1" src="https://img.etb2bimg.com/files/a1.jpg" alt="Priya Nair" data-t-box="300 300">',
  '</section>',
  '<section data-rv-section="keynote" data-rv-key="keynote" data-sec-name="Keynote address" data-t-box="1440 700">',
  '  <img class="kn-1" src="https://img.etb2bimg.com/files/k1.jpg" alt="Dr Kiran Rao" data-t-box="600 400">',
  '</section>',
  '<section data-rv-section="voices" data-rv-key="voices" data-sec-name="Our voices" data-t-box="1440 700">',
  '  <img class="vc-1" src="https://img.etb2bimg.com/files/v1.jpg" alt="Rahul Mehta" data-t-box="300 300">',
  '  <figure><img class="vc-2" src="https://img.etb2bimg.com/files/v2.jpg" alt="" data-t-box="300 300"><figcaption>Sunita Iyer, Founder, Brightpath</figcaption></figure>',
  '</section>',
  '<section data-rv-section="about-us" data-rv-key="about-us" data-sec-name="About us" data-t-box="1440 700">',
  '  <img class="au-1" src="https://img.etb2bimg.com/files/c.jpg" alt="Shri Ramesh Kumar, Chairman" data-t-box="300 300">',
  '  <img class="au-2" src="https://img.etb2bimg.com/files/campus.jpg" alt="The campus at dawn" data-t-box="600 400">',
  '</section>',
  '<section data-rv-section="initials" data-rv-key="initials" data-sec-name="In conversation" data-t-box="1440 700">',
  '  <img class="in-1" src="https://img.etb2bimg.com/files/r.jpg" alt="A. R. Rahman" data-t-box="300 300">',
  '  <img class="in-2" src="https://img.etb2bimg.com/files/s.jpg" alt="Leena D\'Souza – Head of Design" data-t-box="300 300">',
  '</section>',
  '<section data-rv-section="stories" data-rv-key="stories" data-sec-name="Stories" data-t-box="1440 700">',
  '  <img class="st-1" src="https://img.etb2bimg.com/files/s1.jpg" alt="Portrait of Dr Kiran Rao" data-t-box="300 300">',
  '</section>',
  '<section data-rv-section="moments-2" data-rv-key="opening" data-sec-name="Opening" data-t-box="1440 700">',
  '  <img class="op-1" src="https://img.etb2bimg.com/files/o1.jpg" alt="Keynote: Priya Nair" data-t-box="300 300">',
  '</section>',
  '<section data-rv-section="on-stage" data-rv-key="on-stage" data-sec-name="On stage" data-t-box="1440 700">',
  '  <img class="os-1" src="https://img.etb2bimg.com/files/o2.jpg" alt="Rahul Mehta speaking at the summit" data-t-box="600 400">',
  '</section>',
  '<section data-rv-section="themes" data-rv-key="themes" data-sec-name="Themes" data-t-box="1440 900">',
  '  <img class="th-1" src="https://img.etb2bimg.com/files/t1.jpg" alt="Mumbai Skyline" data-t-box="400 300">',
  '  <img class="th-2" src="https://img.etb2bimg.com/files/t2.jpg" alt="Smart Factories" data-t-box="400 300">',
  '  <img class="th-3" src="https://img.etb2bimg.com/files/t3.jpg" alt="The Grand Hall" data-t-box="400 300">',
  '  <img class="th-4" src="https://img.etb2bimg.com/files/t4.jpg" alt="A Corridor" data-t-box="400 300">',
  '  <img class="th-5" src="https://img.etb2bimg.com/files/t5.jpg" alt="Hall 3, Jio World Centre" data-t-box="400 300">',
  '  <img class="th-6" src="https://img.etb2bimg.com/files/t6.jpg" alt="AI In Retail" data-t-box="400 300">',
  '  <img class="th-7" src="https://img.etb2bimg.com/files/t7.jpg" alt="Marine Drive at night" data-t-box="400 300">',
  '  <img class="th-8" src="https://img.etb2bimg.com/files/t8.jpg" alt="Gen Next Leaders" data-t-box="400 300">',
  '  <img class="th-9" src="https://img.etb2bimg.com/files/t9.jpg" alt="Sri Lanka Pavilion" data-t-box="400 300">',
  '  <img class="th-10" src="https://img.etb2bimg.com/files/t10.jpg" alt="Two Indian CMOs, a woman and a man, exchanging cards" data-t-box="400 300">',
  '  <img class="th-11" src="' + STORE + 'generated/1730000000000-chat-people-ab12cd34.png" alt="Rahul Mehta" data-t-box="400 300">',
  '</section>'
].join('\n');
/* people sections known only by their name: their photos carry no name at all */
var PEOPLE_WORDS = ['judges|Meet the Judges', 'jury-panel|Panellists', 'chief-guest|Chief guest', 'guest-of-honour|Guest of honour', 'advisory-board|Advisory Board',
  'council|Industry council', 'committee|Organising committee', 'mentors|Mentors', 'faculty|Faculty', 'hosts|Your hosts', 'team|Our team', 'founders|Founders',
  'keynote|Keynote address', 'moderators|Moderators'].map(function (x) {
  var p = x.split('|');
  return '<section data-rv-section="' + p[0] + '" data-rv-key="' + p[0] + '" data-sec-name="' + p[1] + '" data-t-box="1440 700"><img class="pw" src="https://img.etb2bimg.com/files/p.jpg" alt="" data-t-box="300 300"></section>';
}).join('\n') +
  '<section data-rv-section="host-city" data-rv-key="host-city" data-sec-name="Host city" data-t-box="1440 700"><img class="hc" src="https://img.etb2bimg.com/files/c.jpg" alt="" data-t-box="600 400"></section>' +
  '<section data-rv-section="dashboard" data-rv-key="dashboard" data-sec-name="Leaderboard" data-t-box="1440 700"><img class="db" src="https://img.etb2bimg.com/files/d.jpg" alt="" data-t-box="600 400"></section>';
var PEOPLE_KEPT = ['img.jd-1', 'img.ab-1', 'img.kn-1', 'img.vc-1', 'img.vc-2', 'img.au-1', 'img.in-1', 'img.in-2', 'img.st-1', 'img.op-1', 'img.os-1'];
var THEMES = ['img.th-1', 'img.th-2', 'img.th-3', 'img.th-4', 'img.th-5', 'img.th-6', 'img.th-7', 'img.th-8', 'img.th-9', 'img.th-10', 'img.th-11'];

/* a banner whose full-bleed picture is a named person's photo: a picture put under it would never be seen */
var NAMED_BANNER = '<section data-rv-section="hero" data-rv-key="hero" data-t-box="1440 800" data-t-bg="url(&quot;https://img.etb2bimg.com/files/under.jpg&quot;)">' +
  '<img class="nb-1" src="https://img.etb2bimg.com/files/chief.jpg" alt="Dr Meera Shah" data-t-box="1440 800"><h1>Welcome</h1></section>';

/* the banner's tone (rv-hero-video-core.js looksAt, pinned in hero-video.test.js): a hero still classed hero-on-dark
   whose logo unit is drawn for a light banner; BWS, whose words an AI edit made dark on a white veil; a hero whose
   headline the canvas draws dark; and one whose headline colour is see-through, so the next rule decides */
var HERO_76 = '<section data-rv-section="hero" data-rv-key="hero" id="hero" class="hero-root hero-on-dark" data-t-box="1440 800">' +
  '<div class="hero-veil" aria-hidden="true" data-t-box="1440 800"></div><div class="hero-inner"><div class="rv-lu rv-lu-on-light" data-rv-logo-unit data-t-box="600 200"></div></div></section>';
var BWS_HERO = '<style data-rv-style="hero">[data-rv-section="hero"] .hero-root,[data-rv-section="hero"].hero-root{position:relative;color:#1a1414;background:none}' +
  '[data-rv-section="hero"] .hero-veil{background:rgba(255,255,255,0.6)}[data-rv-section="hero"] .hero-tagline{font-weight:600;color:#1a1414}[data-rv-section="hero"] .hero-fact svg{color:#fff}</style>' +
  '<section data-rv-section="hero" data-rv-key="hero" id="hero" class="hero-root hero-on-dark" data-t-box="1440 800"><div class="hero-veil" data-t-box="1440 800"></div><div class="hero-inner"><h1 class="hero-tagline">B</h1></div></section>';
var INK_DARK = '<section data-rv-section="hero" data-rv-key="hero" class="hero-root hero-on-dark" data-t-box="1440 800"><div class="hero-veil" data-t-box="1440 800"></div>' +
  '<div class="hero-inner"><div class="rv-lu rv-lu-on-dark" data-rv-logo-unit></div><h1 class="hero-tagline" data-t-color="rgb(26, 20, 20)">B</h1></div></section>';
var INK_CLEAR = INK_DARK.replace('rgb(26, 20, 20)', 'rgba(0, 0, 0, 0)');

function page(html) { var doc = makeDoc(html); return { doc: doc, canvas: canvasFor(doc) }; }
function sec(pg, key) { return pg.doc.querySelector('[data-rv-key="' + key + '"]'); }
function q(pg, sel) { return pg.doc.querySelector(sel); }
function H(pg, more) { var h = { canvas: pg.canvas, eventId: EV }; Object.keys(more || {}).forEach(function (k) { h[k] = more[k]; }); return h; }
function insideUnit(el) { return !!(el && el.closest && el.closest('[data-rv-logo-unit]')); }

/* ======================= C.1 chooseSlot ======================= */
(function () {
  var A = function (area, prot) { return { area: area, protected: !!prot }; };
  check('C.1 wanted 2 of three free -> index 1', P.chooseSlot([A(10), A(10), A(10)], 2) === 1);
  check('C.1 wanted counts free entries only: [kept, free, free], wanted 2 -> index 2', P.chooseSlot([A(10, 1), A(10), A(10)], 2) === 2);
  check('C.1 wanted out of range, one free -> the only one', P.chooseSlot([A(10, 1), A(50)], 3) === 1);
  check('C.1 no wanted, one free -> the only one', P.chooseSlot([A(500, 1), A(10)], 0) === 1);
  check('C.1 no wanted, the largest twice the next -> the largest', P.chooseSlot([A(100), A(400), A(150)], 0) === 1);
  check('C.1 exactly twice counts', P.chooseSlot([A(200), A(100)], 0) === 0);
  check('C.1 no wanted, similar sizes -> -1 (ask which)', P.chooseSlot([A(100), A(150), A(120)], 0) === -1);
  check('C.1 a kept picture never wins on size', P.chooseSlot([A(1000, 1), A(100), A(90)], 0) === -1);
  check('C.1 all kept -> -1', P.chooseSlot([A(10, 1), A(20, 1)], 1) === -1);
  check('C.1 empty or missing list -> -1', P.chooseSlot([], 1) === -1 && P.chooseSlot(null, 0) === -1);
  check('C.1 wanted not a whole number is no wanted', P.chooseSlot([A(100), A(110)], 1.5) === -1 && P.chooseSlot([A(100), A(110)], -1) === -1);
  check('C.1 wanted as a numeric string still counts', P.chooseSlot([A(100), A(110)], '2') === 1);
})();

/* ======================= C.2 heroVeilCss is gen-design's own veil ======================= */
(function () {
  var genDesign = require('./gen-design');
  ['dark', 'light'].forEach(function (mode) {
    var css = genDesign.heroCss({ image: 'https://x/y.png', mode: mode });
    var m = /\.hero-veil\{position:absolute;inset:0;background:(.*?);pointer-events:none\}/.exec(css);
    check('C.2 heroCss still writes a veil for a ' + mode + ' banner with a picture', !!m, css.slice(0, 200));
    check('C.2 heroVeilCss(' + mode + ') is that veil, exactly', m && P.heroVeilCss(mode) === m[1], m && m[1]);
  });
  check('C.2 an unknown tone takes the light veil, as heroCss does', P.heroVeilCss('') === P.heroVeilCss('light') && P.heroVeilCss(undefined) === P.heroVeilCss('light'));
  check('C.2 a banner without a picture has no veil in heroCss (so the veil is set only with a new picture)', /\.hero-veil\{[^}]*background:none/.test(genDesign.heroCss({ mode: 'dark' })));
})();

/* ======================= C.3 isProtected ======================= */
(function () {
  var g = page(GEN), v = page(VEILED), p = page(PORTED), vid = page(VIDEO), b = page(BARE);
  var yes = [
    ['the logo unit\'s picture', q(g, 'img.rv-lu-img:not(.rv-lu-dark)')],
    ['the logo unit\'s copy for a dark background', q(g, 'img.rv-lu-dark')],
    ['the logo unit itself', q(g, '[data-rv-logo-unit]')],
    ['the ET logo in a type-set logo unit', q(v, 'img.rv-lu-et')],
    ['the nav\'s event logo', q(g, 'img[data-rv-logo]')],
    ['a picture in the nav', q(g, 'img.nav-pic')],
    ['the banner\'s event logo (data-rv-bind)', q(p, 'img.logo')],
    ['an <img> bound to data (data-rv-bind)', q(g, 'img.wa-partner-logo')],
    ['a speaker\'s photo in a record (data-rv-id)', q(g, 'img.sp-1')],
    ['a past edition\'s photo (previous-*)', q(g, 'img.pg-1')],
    ['a leader\'s photo (leaders section)', q(g, 'img.ld-1')],
    ['an ET logo shipped with the templates (/templates/_shared/)', q(g, 'img.reg-shared')],
    ['a picture with "logo" in its class', q(g, 'img.about-logo')],
    ['a picture with "logo" in its file name', q(g, 'img.about-brand')],
    ['a drawn icon (<svg>)', q(g, 'svg')],
    ['the drawing inside an icon', q(g, 'svg path')],
    ['a picture inside an embedded form', q(g, 'img.form-pic')],
    ['the banner video\'s still (editor-only layer)', q(vid, '[data-rv-hv-preview] img')],
    ['a picture in the footer', q(g, 'img.ft-pic')],
    ['a record template\'s item', q(g, '[data-rv-repeat-template]')],
    ['the banner-by-place\'s event logo', q(b, 'img.intro-logo')]
  ];
  yes.forEach(function (c) { check('C.3 kept: ' + c[0], c[1] && P.isProtected(c[1]) === true, c[1] ? c[1].tagName : 'missing in fixture'); });
  var no = [
    ['the venue\'s own picture', q(g, 'img.venue-pic')],
    ['a section picture from another host', q(g, 'img.wa-2')],
    ['an image box', q(g, '.wa-box')],
    ['the ported banner\'s full-bleed picture', q(p, 'img.banner-bg-image')],
    ['the generated banner (its background)', sec(g, 'hero')],
    ['a records section\'s own root (it may still get a background)', sec(g, 'speakers')],
    ['a picture ETB2B AI made beside the speakers\' records (not anyone\'s own)', q(g, 'img.sp-deco')],
    ['an agenda (records without pictures) is not a records section', q(g, '[data-rv-key="agenda"] h2')]
  ];
  no.forEach(function (c) { check('C.3 replaceable: ' + c[0], c[1] && P.isProtected(c[1]) === false, c[1] ? c[1].tagName : 'missing in fixture'); });
  check('C.3 sec may be passed or found', P.isProtected(q(g, 'img.venue-pic'), sec(g, 'venue')) === false && P.isProtected(q(g, 'img.sp-1'), sec(g, 'speakers')) === true);
  /* real people's photos without record markers: by the section's name (judges, advisory board, keynote) or by the
     photo's own name (alt, caption, an honorific, a title after it); and Title Case words that are not a name */
  var pp = page(PEOPLE);
  PEOPLE_KEPT.forEach(function (sel) { var el = q(pp, sel); check('C.3 kept: a real person\'s photo with no record markers (' + sel + ' "' + (el && el.getAttribute('alt')) + '")', el && P.isProtected(el) === true); });
  THEMES.forEach(function (sel) { var el = q(pp, sel); check('C.3 replaceable: Title Case words that are not a name, or a picture the AI made (' + sel + ' "' + (el && el.getAttribute('alt')) + '")', el && P.isProtected(el) === false); });
  check('C.3 kept: a named person\'s full-bleed photo in the banner', P.isProtected(q(page(NAMED_BANNER), 'img.nb-1')) === true);
  var pw = page(PEOPLE_WORDS);
  pw.doc.querySelectorAll('img.pw').forEach(function (el) {
    check('C.3 kept: a photo with no name in a section named for people (' + el.parentNode.getAttribute('data-sec-name') + ')', P.isProtected(el) === true);
  });
  check('C.3 replaceable: "Host city" and "Leaderboard" are not people sections', P.isProtected(q(pw, 'img.hc')) === false && P.isProtected(q(pw, 'img.db')) === false);
  check('C.3 nothing is not replaceable', P.isProtected(null) === true);
})();

/* ======================= C.4 describe ======================= */
(function () {
  var g = page(GEN), h = H(g);
  function d(key, more) { return P.describe(sec(g, key), more ? H(g, more) : h); }
  check('C.4 nav: role nav, nothing offered', (function () { var x = d('nav'); return x.role === 'nav' && x.pics.slots === 0 && !x.pics.list.length && !x.pics.background && !x.pics.own.length; })(), d('nav'));
  check('C.4 footer: role footer, nothing offered', (function () { var x = d('footer'); return x.role === 'footer' && x.pics.slots === 0 && !x.pics.background; })(), d('footer'));

  var hero = d('hero');
  check('C.4 hero: role hero, its tone, no video, background target', hero.role === 'hero' && hero.heroMode === 'dark' && hero.video === false && hero.pics.heroTarget === 'background' && hero.pics.background === true, hero);
  check('C.4 hero: the logo unit is not a slot', hero.pics.slots === 0 && hero.pics.list.length === 0, hero.pics);
  check('C.4 hero: own lists the banner\'s generated picture, not the logo unit first', hero.pics.own[0] === STORE + 'generated/1-hero-bg.png', hero.pics.own);

  var venue = d('venue');
  check('C.4 venue: one slot (the icon is small, the svg is an icon)', venue.role === '' && venue.pics.slots === 1 && venue.pics.list.length === 1, venue.pics);
  check('C.4 venue: the list entry is its alt text in words, and its size', JSON.stringify(venue.pics.list[0]) === JSON.stringify({ label: 'The hall at night seen from the stage', w: 640, h: 400 }), venue.pics.list);
  check('C.4 venue: no background, no banner fields', venue.pics.background === false && venue.pics.heroTarget === '' && venue.heroMode === '' && venue.video === false);
  check('C.4 venue: own has its generated picture first and only this event\'s', venue.pics.own[0] === STORE + 'generated/1-venue.png' && venue.pics.own.every(function (u) { return u.indexOf(STORE) === 0; }), venue.pics.own);

  var wa = d('why-attend');
  check('C.4 why attend: four slots (hidden, small, bound and inner <img> left out)', wa.pics.slots === 4, wa.pics);
  check('C.4 why attend: a picture with no alt is "picture k"', wa.pics.list[1].label === 'picture 2' && wa.pics.list[1].w === 500 && wa.pics.list[1].h === 350, wa.pics.list);
  check('C.4 why attend: an image box is named by its aria-label', wa.pics.list[2].label === 'Badge wall', wa.pics.list);
  check('C.4 why attend: own leaves out other events\' pictures and has the generated first', wa.pics.own.indexOf(OTHER + 'generated/x.png') === -1 && wa.pics.own[0] === STORE + 'generated/1-why-attend.png' && wa.pics.own.length <= 4, wa.pics.own);

  var sp = d('speakers');
  check('C.4 speakers: role records, the picture beside its records is its one slot, its background may still change',
    sp.role === 'records' && sp.pics.slots === 1 && sp.pics.list.length === 1 && sp.pics.list[0].label === 'Decoration' && sp.pics.background === true, sp);
  check('C.4 previous edition: role records', d('previous-glimpses').role === 'records');
  check('C.4 leaders: role records', d('leaders').role === 'records');
  check('C.4 agenda (sessions are records without pictures): no role, no slots, no background', (function () { var x = d('agenda'); return x.role === '' && x.pics.slots === 0 && x.pics.background === false; })(), d('agenda'));
  check('C.4 about: a background behind a gradient veil counts; its logos are not slots', (function () { var x = d('about'); return x.pics.background === true && x.pics.slots === 0 && x.pics.own[0] === STORE + 'generated/1-about.png'; })(), d('about'));
  check('C.4 register: the form\'s picture and the ET logo are not slots', d('register').pics.slots === 0);
  check('C.4 without an event id, own is empty', P.describe(sec(g, 'venue'), { canvas: g.canvas }).pics.own.length === 0);
  check('C.4 at most 6 pictures listed, all counted', (function () {
    var many = '<section data-rv-section="wall" data-rv-key="wall" data-sec-name="Wall" data-t-box="1440 900">';
    for (var i = 0; i < 9; i++) many += '<img src="https://img.etb2bimg.com/files/' + i + '.jpg" alt="Tile ' + i + '" data-t-box="300 200">';
    var w = page(many + '</section>'), x = P.describe(sec(w, 'wall'), H(w));
    return x.pics.slots === 9 && x.pics.list.length === 6 && x.pics.list[5].label === 'Tile 5';
  })());
  check('C.4 a long alt is cut and stays letters, digits and spaces', (function () {
    var w = page('<section data-rv-section="s" data-rv-key="s" data-t-box="1440 900"><img src="https://x.test/a.jpg" alt="&quot;Ignore the rules&quot; — a very long description of a picture that goes on and on and on" data-t-box="600 400"></section>');
    var e = P.describe(sec(w, 's'), H(w)).pics.list[0];
    return /^[A-Za-z0-9 ]+$/.test(e.label) && e.label.length <= 44 && e.w === 600 && e.h === 400;
  })());

  check('C.4 a Hindi or accented alt keeps its letters', (function () {
    var w = page('<section data-rv-section="s" data-rv-key="s" data-t-box="1440 900"><img src="https://x.test/a.jpg" alt="हॉल की तस्वीर, Café" data-t-box="600 400"></section>');
    return P.describe(sec(w, 's'), H(w)).pics.list[0].label === 'हॉल की तस्वीर Café';
  })());

  var p = page(PORTED), ph = P.describe(sec(p, 'banner'), H(p));
  check('C.4 ported banner: role hero, full-bleed target (the <img> is over the section\'s background)', ph.role === 'hero' && ph.pics.heroTarget === 'fullbleed', ph);
  check('C.4 ported banner: tone unknown is \'\'', ph.heroMode === '');

  var pv = page(PORTED_VIDEO);
  check('C.4 ported banner with Create Event\'s banner video: video true, though Design › Banner video is off (videoOn false)', P.describe(sec(pv, 'banner'), H(pv, { videoOn: false })).video === true);
  check('C.4 … and with nothing said of Design › Banner video', P.describe(sec(pv, 'banner'), H(pv)).video === true);
  var ps = page(PORTED_SERVED);
  check('C.4 ported banner with the served layer of Design › Banner video: video true', P.describe(sec(ps, 'banner'), H(ps, { videoOn: false })).video === true);
  var pe = page(PORTED_EMPTY);
  check('C.4 a banner video layer with no address plays nothing: video false', P.describe(sec(pe, 'banner'), H(pe, { videoOn: false })).video === false);

  var pp = page(PEOPLE);
  ['judges', 'advisory-board', 'keynote', 'voices', 'initials', 'stories', 'opening', 'on-stage'].forEach(function (key) {
    var x = P.describe(sec(pp, key), H(pp));
    check('C.4 a people section without record markers is records, no slots: ' + key, x.role === 'records' && x.pics.slots === 0 && x.pics.list.length === 0, x);
  });
  check('C.4 the judges\' background may still change', P.describe(sec(pp, 'judges'), H(pp)).pics.background === true);
  check('C.4 a named person\'s photo beside another picture: the section keeps no role, only the other picture is a slot', (function () {
    var x = P.describe(sec(pp, 'about-us'), H(pp));
    return x.role === '' && x.pics.slots === 1 && x.pics.list[0].label === 'The campus at dawn';
  })(), P.describe(sec(pp, 'about-us'), H(pp)));
  var pw = page(PEOPLE_WORDS);
  pw.doc.querySelectorAll('[data-rv-section]').forEach(function (s0) {
    var key = s0.getAttribute('data-rv-key'), want = key === 'host-city' || key === 'dashboard' ? '' : 'records';
    check('C.4 by its name alone, ' + key + ' is ' + (want || 'not records'), P.describe(s0, H(pw)).role === want, P.describe(s0, H(pw)).role);
  });
  check('C.4 Title Case words that are not names: no role, every picture a slot', (function () { var x = P.describe(sec(pp, 'themes'), H(pp)); return x.role === '' && x.pics.slots === 11; })(), P.describe(sec(pp, 'themes'), H(pp)));
  var nb = page(NAMED_BANNER), nbh = P.describe(sec(nb, 'hero'), H(nb));
  check('C.4 a banner covered by a named person\'s photo: no place for a new picture (heroTarget \'\')', nbh.role === 'hero' && nbh.pics.heroTarget === '' && nbh.pics.slots === 0, nbh);

  /* the banner's tone is what its words are: the same answer as rv-hero-video-core.js looksAt */
  var core = require('../../templates/_shared/rv-hero-video-core.js');
  var h76 = page(HERO_76), d76 = P.describe(sec(h76, 'hero'), H(h76));
  check('C.4 hero classed hero-on-dark, logo unit drawn for light (hero-video.test.js:76): heroMode light, veil target', d76.heroMode === 'light' && d76.pics.heroTarget === 'veil', d76);
  check('C.4 … the same tone looksAt gives', core.looksAt(HERO_76).tone === 'light');
  var bws = page(BWS_HERO), dbws = P.describe(sec(bws, 'hero'), H(bws));
  check('C.4 BWS (classed dark, words made dark by its own stylesheet): heroMode light, as looksAt', dbws.heroMode === 'light' && core.looksAt(BWS_HERO).tone === 'light', dbws);
  ['dark', 'light'].forEach(function (m) {
    var genDesign = require('./gen-design');
    var html = '<style data-rv-style="hero">' + genDesign.heroCss({ mode: m, image: 'https://x/h.png' }) + '</style>' + genDesign.heroHtml({ mode: m, tagline: 'T' });
    var gp = page(html), x = P.describe(gp.doc.querySelector('#hero'), H(gp));
    check('C.4 a ' + m + ' hero as gen-design builds it: heroMode ' + m + ', as looksAt', x.heroMode === m && core.looksAt(html).tone === m, x.heroMode);
  });
  var cls = '<style data-rv-style="hero">.hero-tagline{color:var(--rv-text)}</style><section data-rv-section="hero" data-rv-key="hero" id="hero" class="hero-root hero-on-light" data-t-box="1440 800"></section>';
  check('C.4 a colour that cannot be read falls back to the class, as looksAt', P.describe(sec(page(cls), 'hero'), H(page(cls))).heroMode === 'light' && core.looksAt(cls).tone === 'light');
  var ink = page(INK_DARK);
  check('C.4 the headline the canvas draws dark wins over a dark class and a dark logo unit: light', P.describe(sec(ink, 'hero'), H(ink)).heroMode === 'light');
  var clear = page(INK_CLEAR);
  check('C.4 a see-through headline colour says nothing: the logo unit decides (dark)', P.describe(sec(clear, 'hero'), H(clear)).heroMode === 'dark');

  var v = page(VEILED), vh = P.describe(sec(v, 'hero'), H(v));
  check('C.4 banner without a picture: veil target, light tone, no background', vh.role === 'hero' && vh.pics.heroTarget === 'veil' && vh.heroMode === 'light' && vh.pics.background === false, vh);

  var vid = page(VIDEO);
  check('C.4 banner with the video\'s still drawn: video true', P.describe(sec(vid, 'hero'), H(vid)).video === true);
  check('C.4 video from h.videoOn', P.describe(sec(g, 'hero'), H(g, { videoOn: true })).video === true);
  check('C.4 video from h.heroVideo (enabled, https, a known type)', P.describe(sec(g, 'hero'), H(g, { heroVideo: { enabled: true, url: 'https://x.test/v.mp4', contentType: 'video/mp4' } })).video === true);
  check('C.4 a video turned off is no video', P.describe(sec(g, 'hero'), H(g, { heroVideo: { enabled: false, url: 'https://x.test/v.mp4', contentType: 'video/mp4' } })).video === false);
  check('C.4 the video\'s own rules are used when they are loaded (RevampHeroVideoCore.clean)', (function () {
    var seen = [];
    var c2 = load({ RevampHeroVideoCore: { clean: function (hv) { seen.push(hv); return null; } } });
    var hv = { enabled: true, url: 'https://x.test/v.mov', contentType: 'video/x-unknown' };
    return c2.RevampAiPicture.describe(sec(g, 'hero'), H(g, { heroVideo: hv })).video === false && seen[0] === hv;
  })());
  check('C.4 video is only ever true on the banner', P.describe(sec(g, 'venue'), H(g, { videoOn: true })).video === false);

  var b = page(BARE);
  check('C.4 the first section after the nav holding the event logo is the banner', P.describe(sec(b, 'intro'), H(b)).role === 'hero');
  check('C.4 a later section holding it is not', P.describe(sec(b, 'second'), H(b)).role === '');
  check('C.4 a banner with nowhere for a picture: heroTarget \'\'', P.describe(sec(b, 'intro'), H(b)).pics.heroTarget === '');
  check('C.4 tone from the logo unit when the banner has no hero-on class', (function () {
    var w = page('<section data-rv-section="hero" data-rv-key="hero" data-t-box="1440 800"><div class="rv-lu rv-lu-on-dark" data-rv-logo-unit></div></section>');
    return P.describe(sec(w, 'hero'), H(w)).heroMode === 'dark';
  })());
  check('C.4 the server\'s cleaner (chat-picture.js cleanSectionFields) keeps what describe sends', (function () {
    var cp;
    try { cp = require('./chat-picture'); } catch (e) { return true; }      // built beside this file; checked once it is there
    if (!cp.cleanSectionFields) return true;
    var x = d('why-attend'), y = cp.cleanSectionFields(JSON.parse(JSON.stringify(x)), STORE);
    var hx = d('hero'), hy = cp.cleanSectionFields(JSON.parse(JSON.stringify(hx)), STORE);
    return y.role === x.role && y.pics.slots === x.pics.slots && y.pics.background === x.pics.background &&
      JSON.stringify(y.pics.list) === JSON.stringify(x.pics.list) && JSON.stringify(y.pics.own) === JSON.stringify(x.pics.own) &&
      hy.role === 'hero' && hy.heroMode === 'dark' && hy.pics.heroTarget === 'background' && hy.video === false;
  })());
  check('C.4 describe answers plain data (it is sent to the server as JSON)', (function () {
    var x = d('why-attend');
    return JSON.stringify(JSON.parse(JSON.stringify(x))) === JSON.stringify(x) && Object.keys(x).join() === 'role,video,heroMode,pics' &&
      Object.keys(x.pics).join() === 'slots,list,background,heroTarget,wide,own';
  })());
  /* a wide place takes a wide picture (chat-picture.js asks the model for 16:9): the shape of the background's own
     element, else of the section a rework would put a background on */
  check('C.4 wide: a background element 1440 x 600 is a wide place', d('about').pics.wide === true, d('about').pics);
  check('C.4 wide: a section 1440 x 900 with no background is a wide place for one', d('agenda').pics.background === false && d('agenda').pics.wide === true, d('agenda').pics);
  var tall = page('<section data-rv-section="tall" data-rv-key="tall" data-sec-name="Long list" data-t-box="1440 2400"><p>x</p></section>' +
    '<section data-rv-section="side" data-rv-key="side" data-sec-name="Side" data-t-box="1440 900"><div class="side-bg" data-t-box="600 900" data-t-bg="url(&quot;' + STORE + 'generated/1-side.png&quot;)"></div><p>y</p></section>');
  check('C.4 wide: a section taller than wide is not', P.describe(sec(tall, 'tall'), H(tall)).pics.wide === false, P.describe(sec(tall, 'tall'), H(tall)).pics);
  check('C.4 wide: a background element narrower than its section is measured as itself, not the section',
    P.describe(sec(tall, 'side'), H(tall)).pics.background === true && P.describe(sec(tall, 'side'), H(tall)).pics.wide === false, P.describe(sec(tall, 'side'), H(tall)).pics);
  var cpLib = require('./chat-picture');
  check('C.4 wide: the server keeps it as sent', cpLib.cleanSectionFields(JSON.parse(JSON.stringify(d('about'))), STORE).pics.wide === true &&
    cpLib.cleanSectionFields(JSON.parse(JSON.stringify(P.describe(sec(tall, 'tall'), H(tall)))), STORE).pics.wide === false);
})();

/* ======================= C.5 slotOf ======================= */
(function () {
  var g = page(GEN), h = H(g), s = sec(g, 'why-attend');
  check('C.5 the first picture is 1', P.slotOf(s, q(g, 'img.wa-1'), h) === 1);
  check('C.5 an image box is 3, and the <img> inside it is the same picture', P.slotOf(s, q(g, '.wa-box'), h) === 3 && P.slotOf(s, q(g, 'img.wa-inner'), h) === 3);
  check('C.5 a <picture>\'s <img> is 4', P.slotOf(s, q(g, 'img.wa-4'), h) === 4);
  check('C.5 a small, hidden or kept picture is 0', P.slotOf(s, q(g, 'img.wa-small'), h) === 0 && P.slotOf(s, q(g, 'img.wa-3'), h) === 0 && P.slotOf(s, q(g, 'img.wa-partner-logo'), h) === 0);
  check('C.5 the logo unit in the banner is 0', P.slotOf(sec(g, 'hero'), q(g, 'img.rv-lu-img'), h) === 0);
  check('C.5 nothing given is 0', P.slotOf(s, null, h) === 0 && P.slotOf(null, q(g, 'img.wa-1'), h) === 0);
})();

/* ======================= C.6 target ======================= */
(function () {
  var g = page(GEN), h = H(g);
  var t = P.target(sec(g, 'hero'), { placement: 'hero' }, null, h);
  check('C.6 generated banner: its background, with its tone', t.el === sec(g, 'hero') && t.how === 'background' && t.heroMode === 'dark', t.none);
  t = P.target(sec(g, 'hero'), { placement: 'picture', slot: 1 }, q(g, 'img.rv-lu-img'), h);
  check('C.6 on the banner, a "picture" with the logo unit selected is still the banner\'s background', t.el === sec(g, 'hero') && t.how === 'background', t.none);
  t = P.target(sec(g, 'hero'), { placement: 'background' }, null, h);
  check('C.6 on the banner, "background" is the banner\'s picture', t.el === sec(g, 'hero') && t.how === 'background');

  var p = page(PORTED);
  t = P.target(sec(p, 'banner'), { placement: 'hero' }, null, H(p));
  check('C.6 ported banner: its full-bleed <img>, as describe said', t.el === q(p, 'img.banner-bg-image') && t.how === 'picture', t.none);
  var v = page(VEILED);
  t = P.target(sec(v, 'hero'), { placement: 'hero' }, null, H(v));
  check('C.6 banner without a picture: its root and its veil', t.el === sec(v, 'hero') && t.veil === q(v, '.hero-veil') && t.how === 'veil' && t.heroMode === 'light', t.none);
  var vid = page(VIDEO);
  t = P.target(sec(vid, 'hero'), { placement: 'hero' }, null, H(vid));
  check('C.6 banner with a video: none, saying why', !t.el && /video/.test(t.none), t);
  var b = page(BARE);
  t = P.target(sec(b, 'intro'), { placement: 'hero' }, null, H(b));
  check('C.6 banner with nowhere for a picture: none (it is never reworked)', !t.el && /banner/.test(t.none), t);

  var pv = page(PORTED_VIDEO);
  t = P.target(sec(pv, 'banner'), { placement: 'hero' }, null, H(pv, { videoOn: false }));
  check('C.6 ported banner with Create Event\'s banner video: none, saying why (nothing is spent on a picture the video covers)', !t.el && /video/.test(t.none), t);
  var h76 = page(HERO_76);
  t = P.target(sec(h76, 'hero'), { placement: 'hero' }, null, H(h76));
  check('C.6 hero classed dark with a logo unit drawn for light: the veil, with the light tone', t.el === sec(h76, 'hero') && t.how === 'veil' && t.heroMode === 'light', t);
  var nb = page(NAMED_BANNER);
  t = P.target(sec(nb, 'hero'), { placement: 'hero' }, q(nb, 'img.nb-1'), H(nb));
  check('C.6 a banner covered by a named person\'s photo: none', !t.el && /banner/.test(t.none), t);
  var pp = page(PEOPLE);
  ['judges', 'advisory-board', 'keynote', 'voices', 'initials', 'stories', 'opening', 'on-stage'].forEach(function (key) {
    var s0 = sec(pp, key), photo = s0.querySelector('img');
    var a = P.target(s0, { placement: 'picture', slot: 1 }, null, H(pp)), b = P.target(s0, { placement: 'picture', slot: 0 }, photo, H(pp));
    check('C.6 a people section without record markers keeps its photos: ' + key, !a.el && !b.el && /Content/.test(a.none), [a, b]);
  });
  t = P.target(sec(pp, 'about-us'), { placement: 'picture', slot: 0 }, null, H(pp));
  check('C.6 a named photo beside another picture: the other one is the picture replaced', t.el === q(pp, 'img.au-2'), t);
  t = P.target(sec(pp, 'about-us'), { placement: 'picture', slot: 0 }, q(pp, 'img.au-1'), H(pp));
  check('C.6 the named photo selected: none, saying it is a person\'s photo', !t.el && /named person/.test(t.none), t);
  t = P.target(sec(pp, 'judges'), { placement: 'background' }, null, H(pp));
  check('C.6 a people section may still get a background', t.el === sec(pp, 'judges') && t.how === 'background', t.none);
  t = P.target(sec(pp, 'themes'), { placement: 'picture', slot: 2 }, null, H(pp));
  check('C.6 Title Case words that are not names: the picture named is replaced', t.el === q(pp, 'img.th-2') && t.how === 'picture', t.none);

  t = P.target(sec(g, 'venue'), { placement: 'hero' }, null, h);
  check('C.6 "hero" on another section: none', !t.el && t.none);
  t = P.target(sec(g, 'nav'), { placement: 'picture' }, null, h);
  check('C.6 nav: none', !t.el && /top bar/.test(t.none));
  t = P.target(sec(g, 'footer'), { placement: 'background' }, null, h);
  check('C.6 footer: none', !t.el && /footer/.test(t.none));

  t = P.target(sec(g, 'about'), { placement: 'background' }, null, h);
  check('C.6 background: the element carrying it', t.el === q(g, '.about-bg') && t.how === 'background', t.none);
  t = P.target(sec(g, 'speakers'), { placement: 'background' }, null, h);
  check('C.6 records section: a background is allowed', t.el === sec(g, 'speakers') && t.how === 'background', t.none);
  t = P.target(sec(g, 'speakers'), { placement: 'picture', slot: 1 }, q(g, 'img.sp-deco'), h);
  check('C.6 records section: its free picture may be replaced', t.el === q(g, 'img.sp-deco') && t.how === 'picture', t);
  t = P.target(sec(g, 'speakers'), { placement: 'picture', slot: 1 }, q(g, 'img.sp-1'), h);
  check('C.6 records section: a speaker\'s photo selected, none — even with a slot named, the free picture is not put in its place', !t.el && /never replace/.test(t.none), t);
  t = P.target(sec(g, 'agenda'), { placement: 'background' }, null, h);
  check('C.6 background where there is none: none', !t.el && /background/.test(t.none));

  t = P.target(sec(g, 'venue'), { placement: 'picture' }, null, h);
  check('C.6 one picture: that one', t.el === q(g, 'img.venue-pic') && t.how === 'picture', t.none);
  var wa = sec(g, 'why-attend');
  t = P.target(wa, { placement: 'picture', slot: 2 }, null, h);
  check('C.6 several, slot 2 named: the second', t.el === q(g, 'img.wa-2'), t.none);
  t = P.target(wa, { placement: 'picture', slot: 0 }, q(g, 'img.wa-4'), h);
  check('C.6 several, one selected: the selected one', t.el === q(g, 'img.wa-4'), t.none);
  t = P.target(wa, { placement: 'picture', slot: 0 }, q(g, 'picture.wa-pic'), h);
  check('C.6 a <picture> selected: its <img>', t.el === q(g, 'img.wa-4'), t.none);
  t = P.target(wa, { placement: 'picture', slot: 0 }, q(g, 'img.wa-inner'), h);
  check('C.6 an <img> inside an image box selected: the box', t.el === q(g, '.wa-box'), t.none);
  t = P.target(wa, { placement: 'picture', slot: 1 }, q(g, 'img.wa-4'), h);
  check('C.6 the owner\'s words win over an earlier selection', t.el === q(g, 'img.wa-1'), t.none);
  t = P.target(wa, { placement: 'picture', slot: 0 }, null, h);
  check('C.6 several, none named or selected: none (never a guess between similar ones)', !t.el && /several/.test(t.none), t);
  t = P.target(wa, { placement: 'picture', slot: 9 }, null, h);
  check('C.6 a slot that is no longer there, several left: none', !t.el && t.none);
  t = P.target(wa, { placement: 'picture', slot: 0 }, q(g, 'img.wa-partner-logo'), h);
  check('C.6 a kept picture selected: none, never another picture in its place', !t.el && /never replace/.test(t.none), t);
  t = P.target(wa, { placement: 'picture', slot: 0 }, q(g, 'img.wa-small'), h);
  check('C.6 a small picture selected: that one, not another', t.el === q(g, 'img.wa-small'), t.none);
  t = P.target(wa, { placement: 'picture', slot: 0 }, q(g, 'img.venue-pic'), h);
  check('C.6 a selection in another section is not this section\'s', !t.el, t);
  t = P.target(sec(g, 'register'), { placement: 'picture' }, null, h);
  check('C.6 only kept pictures: none', !t.el && /no picture/.test(t.none), t);
  t = P.target(sec(g, 'venue'), { placement: 'elsewhere' }, null, h);
  check('C.6 an unknown placement: none', !t.el && t.none);

  var gone = sec(g, 'venue');
  gone.remove();
  t = P.target(gone, { placement: 'picture' }, null, h);
  check('C.6 a section removed meanwhile: none', !t.el && /no longer/.test(t.none), t);
  check('C.6 no section: none', !!P.target(null, { placement: 'picture' }, null, h).none);

  // whatever is asked, wherever, the logo unit, the ET logos and Content's pictures are never what comes back
  var bad = [];
  [GEN, PORTED, VEILED, VIDEO, BARE, PEOPLE, NAMED_BANNER, PORTED_VIDEO, HERO_76, BWS_HERO].forEach(function (html) {
    var pg = page(html);
    pg.doc.querySelectorAll('[data-rv-section]').forEach(function (s) {
      var els = [null].concat(s.querySelectorAll('img, [data-editable="image"], [data-rv-logo-unit]'));
      ['hero', 'background', 'picture'].forEach(function (placement) {
        [0, 1, 2, 3, 4, 5].forEach(function (slot) {
          els.forEach(function (focus) {
            var r = P.target(s, { placement: placement, slot: slot }, focus, H(pg));
            if (!r.el) return;
            var named = PEOPLE_KEPT.concat(['img.nb-1', 'img.banner-bg-image']).some(function (sel) { return r.el.matches(sel) && (sel !== 'img.banner-bg-image' || html === PORTED_VIDEO); });
            if (named || insideUnit(r.el) || (r.el.closest('[data-rv-logo], [data-rv-bind], [data-rv-id], [data-rv-item], [data-rv-editor], [data-rv-form-embed]')) ||
                (r.el.tagName === 'IMG' && /_shared|logo/i.test(r.el.getAttribute('src') + ' ' + r.el.getAttribute('class')))) {
              bad.push(s.getAttribute('data-rv-key') + ':' + placement + ':' + slot + ' -> ' + r.el.tagName + '.' + r.el.getAttribute('class'));
            }
          });
        });
      });
    });
  });
  check('C.6 sweep: no placement, slot or selection ever targets the logo unit, a logo, a record, a named person\'s photo or a banner under its video', bad.length === 0, bad.slice(0, 5));
})();

/* ======================= C.7 place ======================= */
(function () {
  var g = page(GEN), h = H(g);
  var before = P.unitState(g.doc);
  var t = P.target(sec(g, 'hero'), { placement: 'hero' }, null, h);
  check('C.7 banner background: placed', P.place(t, NEW_PIC, 'Mumbai skyline at dusk', h) === true);
  check('C.7 banner background: the new picture is the section\'s background', sec(g, 'hero').style.backgroundImage === 'url("' + NEW_PIC + '")', sec(g, 'hero').style);
  check('C.7 banner background: the logo unit is the same', P.unitState(g.doc) === before);
  check('C.7 banner background: the veil is untouched', !q(g, '.hero-veil').style.background);

  t = P.target(sec(g, 'about'), { placement: 'background' }, null, h);
  P.place(t, NEW_PIC, '', h);
  var bg = q(g, '.about-bg').style.backgroundImage;
  check('C.7 a background under a gradient keeps the gradient, only the url changes', /^linear-gradient\(/.test(bg) && bg.indexOf('url("' + NEW_PIC + '")') !== -1 && bg.indexOf('1-about.png') === -1, bg);

  g.doc._log = [];
  t = P.target(sec(g, 'venue'), { placement: 'picture' }, null, h);
  check('C.7 picture: placed', P.place(t, NEW_PIC, 'A calm hall before doors open, see https://evil.test/x and www.evil.test', h) === true);
  var img = q(g, 'img.venue-pic');
  check('C.7 picture: the new src', img.getAttribute('src') === NEW_PIC);
  check('C.7 picture: the alt is set as an attribute, with addresses taken out', img.getAttribute('alt') === 'A calm hall before doors open, see and' &&
    g.doc._log.some(function (e) { return e[1] === img && e[2] === 'alt'; }), img.getAttribute('alt'));
  g.doc._log = null;
  t = P.target(sec(g, 'venue'), { placement: 'picture' }, null, h);
  P.place(t, NEW_PIC, new Array(40).join('long words '), h);
  check('C.7 picture: the alt is at most 150 characters', img.getAttribute('alt').length <= 150 && img.getAttribute('alt').length > 100);

  t = P.target(sec(g, 'why-attend'), { placement: 'picture', slot: 4 }, null, h);
  check('C.7 a <picture>\'s <img>: placed, its sources go so the new picture shows', P.place(t, NEW_PIC, 'A corridor', h) === true &&
    q(g, 'img.wa-4').getAttribute('src') === NEW_PIC && !q(g, 'picture source'), q(g, 'picture').childNodes.length);
  t = P.target(sec(g, 'why-attend'), { placement: 'picture', slot: 3 }, null, h);
  check('C.7 an image box: the picture is its background', P.place(t, NEW_PIC, 'x', h) === true && q(g, '.wa-box').style.backgroundImage === 'url("' + NEW_PIC + '")');

  var p = page(PORTED);
  t = P.target(sec(p, 'banner'), { placement: 'hero' }, null, H(p));
  check('C.7 ported banner: its full-bleed <img> gets the picture', P.place(t, NEW_PIC, 'A city at dusk', H(p)) === true && q(p, 'img.banner-bg-image').getAttribute('src') === NEW_PIC &&
    q(p, 'img.logo').getAttribute('src') === null);

  var v = page(VEILED), vbefore = P.unitState(v.doc);
  t = P.target(sec(v, 'hero'), { placement: 'hero' }, null, H(v));
  check('C.7 banner without a picture: placed', P.place(t, NEW_PIC, '', H(v)) === true);
  var root = sec(v, 'hero');
  check('C.7 veil: the picture on .hero-root, cover and centred', root.style.backgroundImage === 'url("' + NEW_PIC + '")' && root.style.backgroundSize === 'cover' && root.style.backgroundPosition === 'center', root.style);
  check('C.7 veil: the veil is gen-design\'s for the banner\'s tone', q(v, '.hero-veil').style.background === P.heroVeilCss('light'));
  check('C.7 veil: the logo unit is the same', P.unitState(v.doc) === vbefore);

  /* the banner's tone as its words are: a hero classed dark whose logo unit is drawn for light gets the LIGHT veil */
  [['hero-video.test.js:76', HERO_76], ['BWS', BWS_HERO]].forEach(function (c) {
    var pg = page(c[1]), unit = P.unitState(pg.doc), spot76 = P.target(sec(pg, 'hero'), { placement: 'hero' }, null, H(pg));
    check('C.7 ' + c[0] + ': placed on the veil path', P.place(spot76, NEW_PIC, 'A city at dusk', H(pg)) === true && sec(pg, 'hero').style.backgroundImage === 'url("' + NEW_PIC + '")');
    check('C.7 ' + c[0] + ': the light veil, never the dark one', q(pg, '.hero-veil').style.background === P.heroVeilCss('light') && q(pg, '.hero-veil').style.background.indexOf('8,10,16') === -1, q(pg, '.hero-veil').style.background);
    check('C.7 ' + c[0] + ': the logo unit is the same', P.unitState(pg.doc) === unit);
  });
  var pv = page(PORTED_VIDEO), pvSpot = P.target(sec(pv, 'banner'), { placement: 'hero' }, null, H(pv, { videoOn: false }));
  check('C.7 a banner under Create Event\'s video: nothing placed, its picture and the video\'s poster unchanged', P.place(pvSpot, NEW_PIC, 'x', H(pv)) === false &&
    q(pv, 'img.banner-bg-image').getAttribute('src') === 'https://img.etb2bimg.com/files/data_file_1.jpg' && q(pv, 'video').getAttribute('poster') === 'https://img.etb2bimg.com/files/data_file_1.jpg');
  var pp = page(PEOPLE);
  PEOPLE_KEPT.forEach(function (sel) {
    var el = q(pp, sel), src = el.getAttribute('src');
    check('C.7 handed a named person\'s photo directly, place refuses: ' + sel, P.place({ el: el, how: 'picture' }, NEW_PIC, 'x', H(pp)) === false && el.getAttribute('src') === src);
  });

  // the last line: what place() refuses changes nothing
  var g2 = page(GEN), h2 = H(g2), unit2 = P.unitState(g2.doc), venue2 = q(g2, 'img.venue-pic');
  var spot = P.target(sec(g2, 'venue'), { placement: 'picture' }, null, h2);
  [['a quote that would end the url()', NEW_PIC + '"),url(x'], ['javascript:', 'javascript:alert(1)'], ['http:', NEW_PIC.replace('https:', 'http:')],
    ['another event\'s picture', OTHER + 'generated/x.png'], ['a space', STORE + 'a b.png'], ['a bracket', STORE + 'a).png'], ['nothing', '']].forEach(function (c) {
    check('C.7 refused, nothing changed: ' + c[0], P.place(spot, c[1], 'x', h2) === false && venue2.getAttribute('src') === STORE + 'generated/1-venue.png');
  });
  check('C.7 without h.eventId any https picture may be placed (the editor checks the address first)', P.place(spot, 'https://img.etb2bimg.com/files/n.jpg', 'x', { canvas: g2.canvas }) === true);
  [['the logo unit\'s picture', q(g2, 'img.rv-lu-img'), 'picture'], ['its dark copy', q(g2, 'img.rv-lu-dark'), 'picture'], ['the logo unit as a background', q(g2, '[data-rv-logo-unit]'), 'background'],
    ['the nav\'s logo', q(g2, 'img[data-rv-logo]'), 'picture'], ['a speaker\'s photo', q(g2, 'img.sp-1'), 'picture'], ['a past edition\'s photo', q(g2, 'img.pg-1'), 'picture'], ['a leader\'s photo', q(g2, 'img.ld-1'), 'picture'],
    ['an ET logo', q(g2, 'img.reg-shared'), 'picture'], ['an icon', q(g2, 'svg'), 'picture']].forEach(function (c) {
    var src = c[1].getAttribute('src');
    check('C.7 handed a kept element directly, place refuses: ' + c[0], P.place({ el: c[1], how: c[2] }, NEW_PIC, 'x', h2) === false && c[1].getAttribute('src') === src && !c[1].style.backgroundImage);
  });
  check('C.7 the logo unit is still the same after every refusal', P.unitState(g2.doc) === unit2);
  check('C.7 a background spot on a picture is refused', P.place({ el: q(g2, 'img.wa-2'), how: 'background' }, NEW_PIC, '', h2) === false && !q(g2, 'img.wa-2').style.backgroundImage);
  check('C.7 a picture spot on a box that is not a picture is refused', P.place({ el: sec(g2, 'agenda'), how: 'picture' }, NEW_PIC, '', h2) === false && !sec(g2, 'agenda').style.backgroundImage);
  check('C.7 a veil spot whose veil is not inside it is refused', P.place({ el: sec(g2, 'venue'), how: 'veil', veil: q(g2, '.hero-veil') }, NEW_PIC, '', h2) === false && !sec(g2, 'venue').style.backgroundImage);
  check('C.7 no spot, a "none" answer, an unknown way or no canvas: false', P.place(null, NEW_PIC, '', h2) === false && P.place({ none: 'x' }, NEW_PIC, '', h2) === false &&
    P.place({ el: q(g2, 'img.venue-pic'), how: 'other' }, NEW_PIC, '', h2) === false && P.place(spot, NEW_PIC, '', { eventId: EV }) === false);
  var gone = q(g2, 'img.wa-1'), goneSpot = { el: gone, how: 'picture' };
  gone.remove();
  check('C.7 an element removed meanwhile: false', P.place(goneSpot, NEW_PIC, '', h2) === false && gone.getAttribute('src') !== NEW_PIC);
})();

/* ======================= C.8 unitState ======================= */
(function () {
  var g = page(GEN), s0 = P.unitState(g.doc);
  check('C.8 one unit, read as a string', typeof s0 === 'string' && /^1:/.test(s0) && s0.indexOf('unit.png') !== -1 && s0.indexOf('dark=') !== -1 && s0.indexOf('note=Check the year') !== -1, s0);
  check('C.8 the same page reads the same', P.unitState(g.doc) === s0);
  q(g, '[data-rv-logo-unit]').classList.add('is-selected');
  check('C.8 the editor\'s own classes on the unit change nothing', P.unitState(g.doc) === s0);
  var g1 = page(GEN); q(g1, 'img.rv-lu-img').setAttribute('src', NEW_PIC);
  check('C.8 a new picture in the unit changes it', P.unitState(g1.doc) !== s0);
  var g2 = page(GEN); q(g2, 'img.rv-lu-dark').remove();
  check('C.8 the dark copy gone changes it', P.unitState(g2.doc) !== s0);
  var g3 = page(GEN); q(g3, '[data-rv-logo-unit]').removeAttribute('data-rv-logo-note');
  check('C.8 the note gone changes it', P.unitState(g3.doc) !== s0);
  var g4 = page(GEN); q(g4, '[data-rv-logo-unit]').remove();
  check('C.8 the unit gone changes it', P.unitState(g4.doc) !== s0 && /^0:/.test(P.unitState(g4.doc)));
  var v = page(VEILED), sv = P.unitState(v.doc);
  q(v, '.rv-lu-key').childNodes[0].nodeValue = 'Wholesale';
  check('C.8 a type-set unit\'s words changing changes it', P.unitState(v.doc) !== sv);
  var v2 = page(VEILED); q(v2, '[data-rv-logo-unit]').setAttribute('class', 'rv-lu rv-lu-on-dark');
  check('C.8 the unit\'s tone changing changes it', P.unitState(v2.doc) !== sv);
  check('C.8 no page: \'\'', P.unitState(null) === '');
})();

/* ======================= C.11 a records section's free places ======================= */
/* Only the pictures that ARE records are kept: Content's items (and a named person's photo anywhere). A section of
   records with Content's item markers offers the pictures beside them; one without markers (prev-sections.js,
   award-sections.js, an imported gallery) keeps every picture but one ETB2B AI made, since nothing there tells a
   record from a decoration. The names below are chosen so that the name rule alone would NOT keep them
   ("Agentic AI Summit 2026 — photo 1", a one-word juror "Ravi", a sponsor tile "Gold Sponsor"). */
var RECS = [
  '<header data-rv-section="nav" data-rv-key="nav" data-rv-etnav data-t-box="1440 80"></header>',
  // a generated site's speakers (the DOM convention): two records, then a picture ETB2B AI made, a decoration from elsewhere and a named photo beside them
  '<section data-rv-section="speakers" data-rv-key="speakers" data-sec-name="Speakers" data-rv-bound="speakers" data-t-box="1440 900">',
  '  <div data-rv-list="speakers" data-t-box="1200 400">',
  '    <article data-rv-item="speakers" data-rv-id="s1" data-t-box="300 400"><img class="rs-1" src="' + STORE + 'speakers/s1.jpg" alt="Rohan Mehta" data-t-box="300 300"></article>',
  '    <article data-rv-item="speakers" data-rv-id="s2" data-t-box="300 400"><img class="rs-2" src="' + STORE + 'generated/1-avatar.png" alt="" data-t-box="300 300"></article>',
  '  </div>',
  '  <img class="rs-made" src="' + STORE + 'generated/20261103101010-chat-place-abcd1234.png" alt="A calm hall" data-t-box="600 400">',
  '  <img class="rs-side" src="https://img.etb2bimg.com/files/side.jpg" alt="" data-t-box="500 350">',
  '  <img class="rs-named" src="https://img.etb2bimg.com/files/k.jpg" alt="Dr Kiran Rao" data-t-box="300 300">',
  '</section>',
  // the previous edition's glimpses, as prev-sections.js builds them: no record markers at all
  '<section data-rv-section="previous-glimpses" data-rv-key="previous-glimpses" data-sec-name="Previous Edition Glimpses" data-t-box="1440 700">',
  '  <figure class="pe-ph"><img class="pg-real" src="https://img.etb2bimg.com/files/2026-1.jpg" alt="Agentic AI Summit 2026 — photo 1" data-t-box="600 400"></figure>',
  '  <div class="pg-box" data-editable="image" data-t-box="600 400" style="background-image:url(&quot;https://img.etb2bimg.com/files/2026-2.jpg&quot;)"></div>',
  '  <img class="pg-made" src="' + STORE + 'generated/20261103101011-chat-subject-abcd1234.png" alt="" data-t-box="700 450">',
  '  <div class="pg-made-box" data-editable="image" data-t-box="600 400" style="background-image:url(&quot;' + STORE + 'generated/2-x.png&quot;)"></div>',
  '</section>',
  // an award's jury drawn from records (award-sections.js personCard): no markers, and a one-word name
  '<section data-rv-section="award-jury" data-rv-key="award-jury" data-sec-name="The Jury" data-t-box="1440 700">',
  '  <article class="aw-jury-card"><div class="aw-jury-ph"><img class="aj-1" src="https://img.etb2bimg.com/files/ravi.jpg" alt="Ravi" data-t-box="300 300"></div></article>',
  '</section>',
  // the previous edition's sponsors: their logos only, no markers — nowhere free
  '<section data-rv-section="previous-sponsors" data-rv-key="previous-sponsors" data-sec-name="Previous Edition Sponsors" data-t-box="1440 500">',
  '  <img class="ps-1" src="https://img.etb2bimg.com/files/acme-2026.png" alt="Gold Sponsor" data-t-box="300 150">',
  '</section>',
  // a real template's bound section before its first fill: only the model card, which carries data-rv-item
  '<section data-rv-section="glimpses_event" data-rv-key="glimpses_event" data-sec-name="Gallery" data-rv-bound="glimpses" data-t-box="1440 600">',
  '  <div class="glimpse-tile" data-rv-item="glimpses" data-t-box="400 300"><img class="gt-1" src="/templates/_shared/img/rv-image.svg" alt="" data-t-box="400 300"></div>',
  '</section>'
].join('\n');
(function () {
  var r = page(RECS), h = H(r);
  ['speakers', 'previous-glimpses', 'award-jury', 'previous-sponsors', 'glimpses_event'].forEach(function (key) {
    check('C.11 ' + key + ' is a records section', P.describe(sec(r, key), h).role === 'records', P.describe(sec(r, key), h).role);
  });
  [['a speaker\'s headshot (a record)', 'img.rs-1'], ['a picture ETB2B AI made inside a record (the record\'s own)', 'img.rs-2'],
    ['a named person\'s photo beside the records', 'img.rs-named'], ['a past edition\'s real photo (no markers)', 'img.pg-real'],
    ['a past edition\'s real photo in a picture box (no markers)', '.pg-box'], ['a one-word juror\'s photo (no markers)', 'img.aj-1'],
    ['a sponsor\'s logo (no markers)', 'img.ps-1'], ['a real template\'s model card (data-rv-item)', 'img.gt-1']
  ].forEach(function (c) { var el = q(r, c[1]); check('C.11 kept: ' + c[0], el && P.isProtected(el) === true, c[1]); });
  [['a picture ETB2B AI made beside the records', 'img.rs-made'], ['a decoration beside the records (marked section)', 'img.rs-side'],
    ['a picture ETB2B AI made in a section without markers', 'img.pg-made'], ['a picture box ETB2B AI filled in a section without markers', '.pg-made-box']
  ].forEach(function (c) { var el = q(r, c[1]); check('C.11 free: ' + c[0], el && P.isProtected(el) === false, c[1]); });

  var sp = P.describe(sec(r, 'speakers'), h);
  check('C.11 speakers: its free pictures are its slots, its records are not listed',
    sp.pics.slots === 2 && sp.pics.list.map(function (e) { return e.label; }).join('|') === 'A calm hall|picture 2', sp.pics);
  var pg = P.describe(sec(r, 'previous-glimpses'), h);
  check('C.11 previous glimpses: only the pictures ETB2B AI made are slots', pg.pics.slots === 2 && pg.pics.list.length === 2, pg.pics);
  check('C.11 a section of records with nothing free: no slots', P.describe(sec(r, 'previous-sponsors'), h).pics.slots === 0 &&
    P.describe(sec(r, 'award-jury'), h).pics.slots === 0 && P.describe(sec(r, 'glimpses_event'), h).pics.slots === 0);

  check('C.11 slotOf: the free picture is 1, a headshot 0', P.slotOf(sec(r, 'speakers'), q(r, 'img.rs-made'), h) === 1 && P.slotOf(sec(r, 'speakers'), q(r, 'img.rs-1'), h) === 0);
  var t = P.target(sec(r, 'speakers'), { placement: 'picture', slot: 2 }, null, h);
  check('C.11 target: the free picture the slot names', t.el === q(r, 'img.rs-side') && t.how === 'picture', t);
  t = P.target(sec(r, 'speakers'), { placement: 'picture', slot: 0 }, q(r, 'img.rs-made'), h);
  check('C.11 target: the free picture selected', t.el === q(r, 'img.rs-made'), t);
  t = P.target(sec(r, 'speakers'), { placement: 'picture', slot: 1 }, q(r, 'img.rs-1'), h);
  check('C.11 target: a headshot selected is never swapped for the free picture beside it', !t.el && /never replace/.test(t.none), t);
  t = P.target(sec(r, 'speakers'), { placement: 'picture', slot: 0 }, q(r, 'img.rs-named'), h);
  check('C.11 target: a named photo selected, none', !t.el && /named person/.test(t.none), t);
  t = P.target(sec(r, 'previous-sponsors'), { placement: 'picture', slot: 1 }, null, h);
  check('C.11 target: nothing free, none, saying the pictures are Content\'s own', !t.el && /Content/.test(t.none), t);
  t = P.target(sec(r, 'award-jury'), { placement: 'picture', slot: 0 }, q(r, 'img.aj-1'), h);
  check('C.11 target: the juror\'s photo selected, none', !t.el && /Content/.test(t.none), t);
  t = P.target(sec(r, 'previous-glimpses'), { placement: 'picture', slot: 1 }, null, h);
  check('C.11 target: in a section without markers, the picture ETB2B AI made', t.el === q(r, 'img.pg-made'), t);

  ['img.rs-1', 'img.rs-named', 'img.pg-real', 'img.aj-1', 'img.ps-1'].forEach(function (sel) {
    var el = q(r, sel), src = el.getAttribute('src');
    check('C.11 place refuses a record handed to it directly: ' + sel, P.place({ el: el, how: 'picture' }, NEW_PIC, 'x', h) === false && el.getAttribute('src') === src);
  });
  check('C.11 place puts a new picture in the free one', P.place({ el: q(r, 'img.rs-made'), how: 'picture' }, NEW_PIC, 'A brighter hall', h) === true &&
    q(r, 'img.rs-made').getAttribute('src') === NEW_PIC && q(r, 'img.rs-1').getAttribute('src') === STORE + 'speakers/s1.jpg');
  check('C.11 … and it stays free for the next try (a picture ETB2B AI made)', P.isProtected(q(r, 'img.rs-made')) === false);
})();

/* ======================= C.12 recordsState: a records section's records, before and after a rework =======================
   The lead's decision of 3 Nov 2026 (QA follow-up, finding B): a records section with no background may get one
   through a rework, kept only if every record comes out unchanged — each item's picture addresses, names, roles and
   links. A new design of the same records is the same; any change to a record is not. */
(function () {
  function speaker(o) {
    o = o || {};
    return '<article class="' + (o.cls || 'rva-card') + '" data-rv-repeat-template="speakers"' + (o.unfilled ? '' : ' data-rv-filled') + '>' +
      (o.bgPhoto ? '<div class="ph" data-rv-field="photo" style="background-image:url(&quot;' + o.photo + '&quot;)"></div>' : '<img class="rva-photo" data-rv-field="photo" src="' + o.photo + '" alt="">') +
      (o.linkFirst ? '<a data-rv-field="li" href="' + o.li + '">LinkedIn</a>' : '') +
      '<h3 data-rv-field="n">' + o.n + '</h3><p data-rv-field="r">' + o.r + '</p>' + (o.noCompany ? '' : '<p data-rv-field="c">' + o.c + '</p>') +
      (o.linkFirst ? '' : '<a data-rv-field="li" href="' + o.li + '">LinkedIn</a>') + (o.extra || '') + '</article>';
  }
  var ROHAN = { photo: STORE + 'speakers/rohan.jpg', n: 'Rohan Mehta', r: 'Chief People Officer', c: 'Northwind Industries', li: 'https://www.linkedin.com/in/rohan' };
  var ANANYA = { photo: STORE + 'speakers/ananya.jpg', n: 'Ananya Iyer', r: 'CHRO', c: 'Lakeshore Financial', li: 'https://www.linkedin.com/in/ananya' };
  function with_(base, more) { var o = {}; Object.keys(base).forEach(function (k) { o[k] = base[k]; }); Object.keys(more || {}).forEach(function (k) { o[k] = more[k]; }); return o; }
  function speakersPage(items, opts) {
    opts = opts || {};
    return page('<section data-rv-section="auto-speakers" data-rv-key="auto-speakers" data-sec-name="Speakers" data-rv-auto="speakers"' +
      (opts.bg ? ' style="background-image:url(&quot;' + NEW_PIC + '&quot;)"' : '') + ' data-t-box="1440 900">' +
      '<h2>' + (opts.title || 'Speakers') + '</h2><div class="' + (opts.list || 'rva-list') + '">' + items.join('') + '</div></section>');
  }
  function stateOf(pg) { return P.recordsState(sec(pg, 'auto-speakers')); }
  var before = stateOf(speakersPage([speaker(ROHAN), speaker(ANANYA)]));
  check('C.12 a section of filled records has a state', /^records 2\n/.test(before) && before.indexOf('n=Rohan Mehta') !== -1 && before.indexOf('photo=' + ROHAN.photo) !== -1, before);
  var redesigned = stateOf(speakersPage([speaker(with_(ROHAN, { cls: 'card', bgPhoto: true, linkFirst: true, extra: '<span class="tag">View profile</span>' })),
    speaker(with_(ANANYA, { cls: 'card', bgPhoto: true, linkFirst: true, extra: '<span class="tag">View profile</span>' }))], { bg: true, title: 'Meet our speakers', list: 'grid' }));
  check('C.12 the same records in a new design, under a new background and a new heading, are the same', redesigned === before, { before: before, after: redesigned });
  [['a name changed', [speaker(with_(ROHAN, { n: 'Rohan M.' })), speaker(ANANYA)]],
    ['a role changed', [speaker(with_(ROHAN, { r: 'Head of People' })), speaker(ANANYA)]],
    ['a photo replaced', [speaker(with_(ROHAN, { photo: NEW_PIC })), speaker(ANANYA)]],
    ['a link changed', [speaker(with_(ROHAN, { li: 'https://example.com/rohan' })), speaker(ANANYA)]],
    ['a record left out', [speaker(ANANYA)]],
    ['a field dropped from the design', [speaker(with_(ROHAN, { noCompany: true })), speaker(with_(ANANYA, { noCompany: true }))]],
    ['the records in another order', [speaker(ANANYA), speaker(ROHAN)]],
    ['only the design\'s sample item left (no record drawn)', [speaker(with_(ROHAN, { unfilled: true }))]]
  ].forEach(function (c) {
    var after = stateOf(speakersPage(c[1], { bg: true }));
    check('C.12 ' + c[0] + ': not the same', after !== before, after);
  });
  var copied = page('<section data-rv-section="auto-speakers" data-rv-key="auto-speakers" data-sec-name="Speakers" data-t-box="1440 900"><h3>Rohan Mehta</h3><p>Chief People Officer</p>' +
    '<p>Northwind Industries</p><img src="' + ROHAN.photo + '" alt=""><h3>Ananya Iyer</h3><p>CHRO</p><p>Lakeshore Financial</p><img src="' + ANANYA.photo + '" alt=""></section>');
  check('C.12 the records written out as plain markup (Content\'s markers gone): not the same', stateOf(copied) !== before, stateOf(copied));
  check('C.12 a design\'s sample item is no record: two samples with other words are the same',
    stateOf(speakersPage([speaker(with_(ROHAN, { unfilled: true, n: 'Speaker name' }))])) === stateOf(speakersPage([speaker(with_(ROHAN, { unfilled: true, n: 'Speaker Name' }))], { bg: true })));

  // editor-fill.js's cards (data-rv-item, data-rv-id): every picture, word and link in each
  function fillPage(cards, bg) {
    return page('<section data-rv-section="speakers" data-rv-key="speakers" data-sec-name="Speakers" data-rv-bound="speakers"' + (bg ? ' style="background-image:url(&quot;' + NEW_PIC + '&quot;)"' : '') +
      ' data-t-box="1440 800"><div data-rv-list="speakers">' + cards.join('') + '</div></section>');
  }
  function card(name, role, photo, layout) {
    return '<div class="sp" data-rv-item="speakers" data-rv-id="' + name.replace(/\W/g, '') + '">' + (layout ? '<p>' + role + '</p><img src="' + photo + '" alt=""><h4>' + name + '</h4>'
      : '<img src="' + photo + '" alt=""><h4>' + name + '</h4><p>' + role + '</p>') + '</div>';
  }
  var fillBefore = P.recordsState(sec(fillPage([card('Rohan Mehta', 'CPO', ROHAN.photo), card('Ananya Iyer', 'CHRO', ANANYA.photo)]), 'speakers'));
  check('C.12 editor-fill cards: laid out differently, the same', P.recordsState(sec(fillPage([card('Rohan Mehta', 'CPO', ROHAN.photo, true), card('Ananya Iyer', 'CHRO', ANANYA.photo, true)], true), 'speakers')) === fillBefore, fillBefore);
  check('C.12 editor-fill cards: a name changed, not the same', P.recordsState(sec(fillPage([card('Rohan Mehta', 'CPO', ROHAN.photo), card('Ananya I.', 'CHRO', ANANYA.photo)], true), 'speakers')) !== fillBefore);

  // a records section with no item markers (prev-sections.js): every picture but a made one, every word and link
  function prevPage(name, photo, bg, made) {
    return page('<section data-rv-section="previous-speakers" data-rv-key="previous-speakers" data-sec-name="Previous Edition Speakers"' + (bg ? ' style="background-image:url(&quot;' + NEW_PIC + '&quot;)"' : '') +
      ' data-t-box="1440 800"><h2>Previous Edition Speakers</h2><div class="pe-spk-card"><img src="' + photo + '" alt=""><p class="pe-spk-name">' + name + '</p><p>CHRO, Acme</p></div>' +
      (made ? '<img class="deco" src="' + STORE + 'generated/20261103-chat-place-zzzz.png" alt="">' : '') + '</section>');
  }
  var prevBefore = P.recordsState(sec(prevPage('Kavita Sharma', 'https://img.etb2bimg.com/files/kavita.jpg'), 'previous-speakers'));
  check('C.12 a records section without markers: its whole content', /^section\n/.test(prevBefore) && prevBefore.indexOf('Kavita Sharma') !== -1 && prevBefore.indexOf('kavita.jpg') !== -1, prevBefore);
  check('C.12 … the same under the new background (a picture ETB2B AI made is never a record)',
    P.recordsState(sec(prevPage('Kavita Sharma', 'https://img.etb2bimg.com/files/kavita.jpg', true, true), 'previous-speakers')) === prevBefore);
  check('C.12 … a name changed: not the same', P.recordsState(sec(prevPage('Kavita S.', 'https://img.etb2bimg.com/files/kavita.jpg', true), 'previous-speakers')) !== prevBefore);
  check('C.12 … a photo replaced: not the same', P.recordsState(sec(prevPage('Kavita Sharma', 'https://img.etb2bimg.com/files/other.jpg', true), 'previous-speakers')) !== prevBefore);

  // a section that is not records and shows no Content items has none to keep; one with Content's items (an agenda) has
  var plain = page('<section data-rv-section="overview" data-rv-key="overview" data-sec-name="Overview" data-t-box="1440 600"><h2>Why attend</h2><img src="' + STORE + 'media/hall.jpg" alt="" data-t-box="600 400"></section>' +
    '<section data-rv-section="agenda" data-rv-key="agenda" data-sec-name="Agenda" data-t-box="1440 600"><article data-rv-repeat-template="sessions" data-rv-filled><div data-rv-field="time">10:00</div><h3 data-rv-field="title">Opening keynote</h3></article></section>');
  check('C.12 a section that is not records and holds no Content items: \'\'', P.recordsState(sec(plain, 'overview')) === '');
  check('C.12 an agenda\'s sessions are Content\'s records too', /^records 1\nfields /.test(P.recordsState(sec(plain, 'agenda'))) && P.recordsState(sec(plain, 'agenda')).indexOf('title=Opening keynote') !== -1, P.recordsState(sec(plain, 'agenda')));
  check('C.12 nothing is changed by reading it', q(plain, '[data-rv-field="title"]').textContent === 'Opening keynote');
})();

/* ======================= C.9 the file: ES5, one global, no network, text only ======================= */
(function () {
  var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  check('C.9 no let', !/\blet\s/.test(code));
  check('C.9 no const', !/\bconst\s/.test(code));
  check('C.9 no arrow functions', code.indexOf('=>') === -1);
  check('C.9 no async / await', !/\basync\b|\bawait\b/.test(code));
  check('C.9 no class', !/\bclass\s+[A-Z]/.test(code));
  check('C.9 no template strings', code.indexOf('`') === -1);
  check('C.9 no spread or rest', code.indexOf('...') === -1);
  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) { /* the checks above still run */ }
  check('C.9 esbuild is there to check ES5', !!esbuild);
  if (esbuild) {
    var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
    check('C.9 ES5 by esbuild', es5 === true, es5);
  }
  check('C.9 one global, RevampAiPicture, with the agreed calls', (function () {
    var own = Object.keys(ctx).filter(function (k) { return ['console', 'window'].indexOf(k) === -1; });
    return own.join() === 'RevampAiPicture' && Object.keys(P).sort().join() === ['chooseSlot', 'describe', 'heroVeilCss', 'isProtected', 'place', 'recordsState', 'slotOf', 'target', 'unitState'].join();
  })(), Object.keys(P));
  check('C.9 asks no server and calls no AI (no fetch, XMLHttpRequest or authedFetch)', !/\bfetch\s*\(|XMLHttpRequest|authedFetch|sendBeacon/.test(code));
  check('C.9 writes no markup (no innerHTML, outerHTML, insertAdjacentHTML or document.write)', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code));
  check('C.9 keeps nothing in the browser (no localStorage or cookies)', !/localStorage|sessionStorage|document\.cookie/.test(code));
  check('C.9 the page may load it (the server\'s list of files it sends)', require('./access').isServableFile('editor-ai-picture.js') === true);
})();

/* ======================= C.10 the editor loads it, in the right place, with its styles ======================= */
(function () {
  function at(name) { return EDITOR_HTML.indexOf('<script src="' + name + '"></script>'); }
  var mine = at('editor-ai-picture.js');
  check('C.10 custom_editor.html loads editor-ai-picture.js once', mine !== -1 && (EDITOR_HTML.match(/<script\b[^>]*\bsrc="editor-ai-picture\.js"/g) || []).length === 1);
  check('C.10 after editor-canvas.js', at('editor-canvas.js') !== -1 && at('editor-canvas.js') < mine);
  check('C.10 before editor-template-ui.js (which uses it)', mine < at('editor-template-ui.js'));
  check('C.10 a style for the made picture\'s thumbnail (.chat-made-pic)', /\.chat-made-pic[\s{,]/.test(EDITOR_HTML));
  check('C.10 a style for the "Use this picture" button (.chat-use-pic)', /\.chat-use-pic[\s{,:]/.test(EDITOR_HTML));
  check('C.10 beside the sent pictures\' style', (function () {
    var sent = EDITOR_HTML.indexOf('.chat-msg .chat-sent-pics{'), made = EDITOR_HTML.indexOf('.chat-made-pic');
    return sent !== -1 && made > sent && made - sent < 1200;
  })());
})();

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
