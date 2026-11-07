// node functions/lib/promo-social-easy.test.js — the social post editor's easy panel (UX-122, promo-easy-edit/DESIGN.md §1):
// promo-studio/oneworld-social-easy.js. Its plain names for what is on a post (Words), the one write that changes
// elements and records Undo (OWSEasy.set, for ETB2B AI later), the people on a post and swapping one in place, the
// side it builds (Words, Pictures, People, Caption, then Advanced layout around the platform's tools), typing in a
// Words box, the Saved list on the cards page, and that the file is ES5. No network: the file runs in a vm over a
// small stand-in page, with the editor's globals (EDIT, edNodes, pushHistory…) as stand-ins.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'promo-studio', 'oneworld-social-easy.js'), 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function tick(n) { var p = Promise.resolve(); for (var i = 0; i < (n || 20); i++) p = p.then(function () { return new Promise(function (ok) { setImmediate(ok); }); }); return p; }

/* ---------- a small page: elements, a few selectors ---------- */
function makeDocument() {
  var doc = { activeElement: null };
  function Text(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; }
  function El(tag) {
    var self = this;
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.attrs = {}; this.childNodes = []; this.parentNode = null;
    this.className = ''; this.id = ''; this.value = ''; this.rows = 2; this.disabled = false; this.open = false; this.style = {};
    this.listeners = {}; this.selected = false;
    function names() { return self.className.split(/\s+/).filter(Boolean); }
    this.classList = {
      contains: function (c) { return names().indexOf(c) !== -1; },
      add: function (c) { if (names().indexOf(c) === -1) self.className = names().concat(c).join(' '); },
      remove: function (c) { self.className = names().filter(function (x) { return x !== c; }).join(' '); },
      toggle: function (c, on) { if (on === undefined) on = names().indexOf(c) === -1; if (on) this.add(c); else this.remove(c); return !!on; }
    };
  }
  El.prototype.getAttribute = function (n) {
    if (n === 'class') return this.className || null;
    if (n === 'id') return this.id || null;
    return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null;
  };
  El.prototype.setAttribute = function (n, v) { v = String(v); if (n === 'class') this.className = v; else if (n === 'id') this.id = v; else if (n === 'open') this.open = true; else this.attrs[n] = v; };
  El.prototype.removeAttribute = function (n) { delete this.attrs[n]; if (n === 'open') this.open = false; };
  El.prototype.hasAttribute = function (n) { return this.getAttribute(n) !== null; };
  El.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.insertBefore = function (c, ref) {
    if (!ref) return this.appendChild(c);
    if (c.parentNode) c.parentNode.removeChild(c);
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); c.parentNode = this; return c;
  };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i !== -1) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  El.prototype.contains = function (n) { for (; n; n = n.parentNode) if (n === this) return true; return false; };
  El.prototype.walk = function (f) { this.childNodes.forEach(function (c) { f(c); if (c.nodeType === 1) c.walk(f); }); };
  Object.defineProperty(El.prototype, 'nextSibling', { get: function () { var s = this.parentNode ? this.parentNode.childNodes : []; return s[s.indexOf(this) + 1] || null; } });
  Object.defineProperty(El.prototype, 'textContent', {
    get: function () { var s = ''; this.walk(function (c) { if (c.nodeType === 3) s += c.data; }); return s; },
    set: function (v) { this.childNodes.forEach(function (c) { c.parentNode = null; }); this.childNodes = []; if (v !== '') this.appendChild(new Text(v)); }
  });
  Object.defineProperty(El.prototype, 'options', { get: function () { var o = []; this.walk(function (c) { if (c.nodeType === 1 && c.tagName === 'OPTION') o.push(c); }); return o; } });
  El.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); };
  El.prototype.focus = function () { doc.activeElement = this; };
  El.prototype.blur = function () { if (doc.activeElement === this) doc.activeElement = doc.body; };
  El.prototype.click = function () { if (typeof this.onclick === 'function') this.onclick.call(this, { target: this }); };
  El.prototype.scrollIntoView = function () {};
  El.prototype.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b; };
  /* selectors: a list of parts joined by spaces (descendants); a part is tag?, #id?, .class*, [attr="v"]* */
  function parsePart(p) {
    var o = { tag: null, id: null, cls: [], attrs: [] }, m;
    var re = /^([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)="([^"]*)"\]/g;
    while ((m = re.exec(p))) {
      if (m[1]) o.tag = m[1].toUpperCase(); else if (m[2]) o.id = m[2]; else if (m[3]) o.cls.push(m[3]); else o.attrs.push([m[4], m[5]]);
      if (m[0] === '') break;
    }
    return o;
  }
  function fits(el, o) {
    if (el.nodeType !== 1) return false;
    if (o.tag && el.tagName !== o.tag) return false;
    if (o.id && el.id !== o.id) return false;
    if (o.cls.some(function (c) { return !el.classList.contains(c); })) return false;
    return o.attrs.every(function (a) { return el.getAttribute(a[0]) === a[1]; });
  }
  function matches(el, parts) {
    if (!fits(el, parts[parts.length - 1])) return false;
    var i = parts.length - 2;
    for (var n = el.parentNode; n && i >= 0; n = n.parentNode) if (n.nodeType === 1 && fits(n, parts[i])) i--;
    return i < 0;
  }
  function split(sel) { return sel.replace(/\[[^\]]*\]/g, function (a) { return a.replace(/ /g, '\u0000'); }).trim().split(/\s+/).map(function (p) { return parsePart(p.replace(/\u0000/g, ' ')); }); }
  El.prototype.querySelectorAll = function (sel) { var parts = split(sel), out = []; this.walk(function (c) { if (c.nodeType === 1 && matches(c, parts)) out.push(c); }); return out; };
  El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
  El.prototype.closest = function (sel) { var parts = split(sel); for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, parts)) return n; return null; };
  doc.body = new El('body');
  doc.activeElement = doc.body;
  doc.createElement = function (t) { return new El(t); };
  doc.createTextNode = function (t) { return new Text(t); };
  doc.getElementById = function (id) { var hit = null; doc.body.walk(function (c) { if (!hit && c.nodeType === 1 && c.id === id) hit = c; }); return hit; };
  doc.querySelector = function (s) { return doc.body.querySelector(s); };
  doc.querySelectorAll = function (s) { return doc.body.querySelectorAll(s); };
  doc.addEventListener = function () {};
  return doc;
}

/* ---------- the editor around the file ---------- */
var ROSTER = {
  speakers: [
    { id: 's1', name: 'Ananya Rao', designation: 'Chief Marketing Officer', company: 'Sundaram Foods', photoUrl: 'https://img.etb2bimg.com/a.jpg' },
    { id: 's2', name: 'Meera Iyer', designation: 'Head of Brand', company: 'Chennai Silks', photoUrl: 'https://img.etb2bimg.com/m.jpg' },
    { id: 's3', name: 'Kavya Menon', designation: 'VP, Media Planning', company: 'Southern Star Media' }
  ],
  sponsors: [
    { id: 'p1', title: 'Kaveri Digital', logoUrl: 'https://img.etb2bimg.com/k.png', tier: 'Presenting Partner' },
    { id: 'p2', title: 'Chennai Silks', logoUrl: 'https://img.etb2bimg.com/c.png', tier: 'Gold Partners' }
  ]
};
/* a speaker card as the flattener gives it (owRole: the template's classes) */
function speakerEls() {
  return [
    { id: 'e0', type: 'text', x: 800, y: 40, w: 200, text: '#QASummit26', owRole: 'hashtag' },
    { id: 'e1', type: 'image', x: 60, y: 120, w: 300, h: 100, src: 'https://img.etb2bimg.com/lu.png', owRole: 'lockup-img' },
    { id: 'e2', type: 'shape', x: 60, y: 300, w: 400, h: 500 },
    { id: 'e3', type: 'text', x: 100, y: 420, w: 140, text: 'SPEAKER', owRole: 'chip spk-role' },
    { id: 'e4', type: 'text', x: 100, y: 470, w: 400, text: 'Ananya Rao', owRole: 'spk-name' },
    { id: 'e5', type: 'text', x: 100, y: 560, w: 400, text: 'Chief Marketing Officer', owRole: 'spk-desig' },
    { id: 'e6', type: 'text', x: 100, y: 600, w: 400, text: 'Sundaram Foods', owRole: 'spk-company' },
    { id: 'e7', type: 'frame', x: 600, y: 300, w: 300, h: 450, src: 'https://img.etb2bimg.com/a.jpg', owRole: 'spk-photo' },
    { id: 'e8', type: 'text', x: 60, y: 800, w: 500, text: '5–7 December, 2026 · Taj', owRole: 'footer-when' },
    { id: 'e9', type: 'text', x: 720, y: 800, w: 200, text: 'Register Now', owRole: 'cta' }
  ];
}
function load(o) {
  o = o || {};
  var doc = makeDocument(), log = { hist: 0, applied: [], toasts: [], loads: [], caption: [], discard: o.discard !== false, roster: 0 };
  ['edSide', 'edStage', 'edFmt', 'edBg', 'editor', 'epText', 'tgrid'].forEach(function (id) { var e = doc.createElement(id === 'edFmt' || id === 'edBg' ? 'select' : 'div'); e.id = id; doc.body.appendChild(e); });
  var ctx = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, JSON: JSON, Date: Date,
    document: doc, toasts: log.toasts,
    EDIT: { width: 1080, height: 1080, tid: o.tid || 'speaker.individual', fmt: 'ig_square', base: 'blob:base', els: o.els || speakerEls() },
    edNodes: [], edSel: -1, edParams: { theme: 'dark' }, edMode: 'props', CAT: { event: { name: 'QA Summit 2026', siteLogo: { dark: '', light: '' } } },
    OWS: { art: o.art || {}, orig: o.orig || {} }, OW_E: 'qa-1',
    pushHistory: function () { log.hist++; ctx.updUndo(); },
    updUndo: function () {}, updLayerLabel: function () {}, layoutGroupFrame: function () {}, owFillerNote: function () {},
    applyNode: function (n, el) { log.applied.push(el.id); },
    paintSide: function () { var h = ctx.owSideHost(); h.textContent = ''; var t = doc.createElement('div'); t.className = 'ed-tabs'; h.appendChild(t); },
    openEditor: function () { log.opened = (log.opened || 0) + 1; doc.getElementById('editor').classList.add('on'); },
    loadEditor: function (fresh) { log.loads.push(!!fresh); return Promise.resolve(); },
    closeEditor: function () { doc.getElementById('editor').classList.remove('on'); },
    renderEventDetail: function () {},
    owEditorOpen: function () { return doc.getElementById('editor').classList.contains('on'); },
    owUseBg: function () { return ctx.OWS.art.useBg || ''; },
    owMayDiscard: function () { return Promise.resolve(log.discard); },
    owClone: function (v) { return JSON.parse(JSON.stringify(v == null ? {} : v)); },
    owLayouts: function () { return Promise.resolve(o.layouts || []); },
    owReportHeight: function () {},
    owSizeName: function (f) { return 'Size ' + f.id; }, owSizeShort: function (f) { return 'Short ' + f.id; },
    findTpl: function (id) { return { id: id, label: 'Label of ' + id, formats: [{ id: 'ig_square' }, { id: 'story' }] }; },
    toast: function (m, ms, kind) { log.toasts.push([String(m), ms, kind]); },
    owAuthed: function (url) { log.roster++; return Promise.resolve({ ok: true, json: function () { return Promise.resolve(o.roster || ROSTER); } }); },
    OWSArt: {
      bgChoices: function (a) { var out = [{ v: a.background ? 'design' : '', t: 'The design’s own background' }]; if (a.background) out.push({ v: '', t: 'Design file (.psd)' }); if (a.bg1) out.push({ v: '1', t: 'Background 1' }); return out; },
      bgValue: function (a, v) { return typeof v === 'string' ? v : ''; }, bgLabel: function (a, v) { return v ? 'Background ' + v : 'The design’s own background'; },
      bgPhrase: function (a, v) { return v ? 'Background ' + v : 'the design’s own background'; },
      logoWords: function () { return 'Using your site’s logo'; }, siteHasLogo: function () { return true; },
      setUseBg: function (v) { log.useBg = v; ctx.OWS.art = Object.assign({}, ctx.OWS.art, { useBg: v }); return Promise.resolve(ctx.OWS.art); }
    },
    OWSCap: { paramsChanged: function (p) { log.caption.push(p); } }
  };
  ctx.window = ctx;
  ctx.edNodes = ctx.EDIT.els.map(function (e, i) { var n = doc.createElement('div'); n.className = 'ednode ' + (e.type === 'text' ? 'tx' : 'im'); n.setAttribute('data-i', i); doc.getElementById('edStage').appendChild(n); return n; });
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'oneworld-social-easy.js' });
  return { ctx: ctx, doc: doc, log: log, E: ctx.OWSEasy, run: function (s) { return vm.runInContext(s, ctx); } };
}

(async function () {
  /* ---------- ES5, and what the file gives the page ---------- */
  var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/.*$/gm, '$1');
  check('ES5: no let, const, arrow functions, async, classes, template literals or spread', !/\blet\s|\bconst\s|=>|\basync\b|\bawait\b|\bclass\s/.test(code) && code.indexOf('`') === -1 && code.indexOf('...') === -1);
  check('no markup is written from strings (every name and word is set as text)', code.indexOf('innerHTML') === -1 && code.indexOf('insertAdjacentHTML') === -1);
  var x = load();
  check('it gives the page owSideHost (patch S17′ calls it) and OWSEasy, the one place the AI batch is to reach', typeof x.ctx.owSideHost === 'function' &&
    ['set', 'words', 'people', 'swapTo', 'perSpeaker', 'repaint', 'startTyping', 'stopTyping', 'paintSaved', 'openSaved', 'pure'].every(function (k) { return x.E[k] !== undefined; }));

  /* ---------- 1. plain names for what is on a post ---------- */
  var P = x.E.pure;
  check('roleName: a template class in plain words', P.roleName({ owRole: 'an-save' }) === 'Small line above the title' && P.roleName({ owRole: 'footer-when' }) === 'Date and venue' &&
    P.roleName({ owRole: 'cta' }) === 'Button' && P.roleName({ owRole: 'tst-kicker' }) === 'Small line above the title');
  check('roleName: the telling class wins over one that says how it looks ("chip spk-role", "frost cs-title")', P.roleName({ owRole: 'chip spk-role' }) === 'Label above the name' &&
    P.roleName({ owRole: 'frost cs-title' }) === 'Title' && P.roleName({ owRole: 'chip' }) === 'Label');
  check('roleName: none for an element with no known class', P.roleName({ owRole: 'something-else' }) === '' && P.roleName({}) === '');
  var words = P.wordsOf(speakerEls());
  check('Words: every text, top to bottom, each with its plain name', words.map(function (w) { return w.name; }).join('|') ===
    'Hashtag|Label above the name|Speaker’s name|Designation|Company|Date and venue|Button', words.map(function (w) { return w.name; }));
  check('Words: each row knows its element and its words', words[2].id === 'e4' && words[2].i === 4 && words[2].text === 'Ananya Rao' && !('x' in words[0]));
  var stats = [{ id: 'a', type: 'text', x: 0, y: 10, text: '40+', owRole: 'v' }, { id: 'b', type: 'text', x: 300, y: 12, text: '60+', owRole: 'v' },
    { id: 'c', type: 'text', x: 0, y: 900, text: 'Mine', owRole: '' }, { id: 'd', type: 'text', x: 0, y: 950, text: '“', owRole: 'tst-quotemark' },
    { id: 'e', type: 'text', x: 0, y: 960, text: 'Other' }, { id: 'f', type: 'shape', x: 0, y: 0 }];
  check('Words: a name used twice is numbered, an unknown text is "Text n", a quotation mark is not a word, shapes are left out',
    P.wordsOf(stats).map(function (w) { return w.name + '=' + w.text; }).join('|') === 'Number 1=40+|Number 2=60+|Text 1=Mine|Text 2=Other', P.wordsOf(stats));

  /* ---------- the one write: OWSEasy.set ---------- */
  x = load();
  var n = x.E.set([{ id: 'e6', set: { text: 'Sundaram Foods Ltd' } }], { step: 'words:e6', from: 'words' });
  check('set: the element changes, one Undo step, the canvas follows', n === 1 && x.ctx.EDIT.els[6].text === 'Sundaram Foods Ltd' && x.log.hist === 1 && x.log.applied.join() === 'e6');
  x.E.set([{ id: 'e6', set: { text: 'Sundaram Foods Ltd.' } }], { step: 'words:e6', from: 'words' });
  check('set: typing on in the same box is the same Undo step', x.log.hist === 1);
  x.E.set([{ id: 'e5', set: { text: 'CMO' } }], { step: 'words:e5', from: 'words' });
  check('set: another box is a new step', x.log.hist === 2);
  x.ctx.updUndo();                                               // an Undo or Redo
  x.E.set([{ id: 'e5', set: { text: 'CMO, India' } }], { step: 'words:e5', from: 'words' });
  check('set: after an Undo the next word is a step of its own', x.log.hist === 3);
  x.E.set([{ i: 4, set: { text: 'Line one\nLine two' } }]);
  x.ctx.EDIT.els[3].whiteSpace = 'nowrap';
  x.E.set([{ i: 3, id: 'e3', set: { text: 'KEY\nNOTE' } }]);
  check('set: a line break in one-line text makes it wrap (the platform\'s S16 rule)', x.ctx.EDIT.els[3].whiteSpace === 'pre-wrap');
  check('set: an element named by index whose id no longer matches is found by its id', x.E.set([{ i: 0, id: 'e9', set: { text: 'Book now' } }]) === 1 && x.ctx.EDIT.els[9].text === 'Book now');
  check('set: nothing to change, no Undo step', x.E.set([{ id: 'nope', set: { text: 'x' } }]) === 0 && x.E.set([]) === 0);

  /* ---------- 3. the people on a post, and swapping one in place ---------- */
  var found = P.findPeople(speakerEls(), ROSTER);
  check('findPeople: the speaker by name, with designation, company and photo beside it', found.length === 1 && found[0].kind === 'speaker' && found[0].person.id === 's1' &&
    found[0].name === 4 && found[0].photo === 7 && found[0].parts.map(function (p) { return p.i + ':' + p.key; }).sort().join() === '5:d,6:c', found);
  var grid = [{ id: 'g0', type: 'frame', src: 'https://img.etb2bimg.com/a.jpg' }, { id: 'g1', type: 'text', text: 'ANANYA RAO' }, { id: 'g2', type: 'text', text: 'Chief Marketing Officer, Sundaram Foods' },
    { id: 'g3', type: 'frame', src: 'https://img.etb2bimg.com/m.jpg' }, { id: 'g4', type: 'text', text: 'Meera Iyer' }, { id: 'g5', type: 'text', text: 'Head of Brand, Chennai Silks' },
    { id: 'g6', type: 'image', src: 'https://img.etb2bimg.com/k.png' }];
  var fg = P.findPeople(grid, ROSTER);
  check('findPeople: a grid: each speaker with their own title line and photo (case aside), and a partner by its logo', fg.length === 3 &&
    fg[0].name === 1 && fg[0].photo === 0 && fg[0].parts[0].key === 'dc' && fg[0].parts[0].i === 2 && fg[1].name === 4 && fg[1].photo === 3 && fg[1].parts[0].i === 5 &&
    fg[2].kind === 'partner' && fg[2].person.id === 'p1' && fg[2].photo === 6, fg.map(function (h) { return [h.kind, h.name, h.photo, h.parts]; }));
  var retyped = speakerEls(); retyped[5].text = 'Chief Marketing Officer (CMO)';
  var orig = { e5: { text: 'Chief Marketing Officer' }, e4: { text: 'Ananya Rao' } };
  var fr = P.findPeople(retyped, ROSTER, function (e) { return orig[e.id] ? orig[e.id].text : null; });
  check('findPeople: a title the user retyped still belongs to its person (by the words the design drew)', fr[0].parts.some(function (p) { return p.i === 5 && p.key === 'd'; }), fr[0].parts);
  var plan = P.swapPlan(speakerEls(), found[0], ROSTER.speakers[1]);
  check('swapPlan: Meera in place of Ananya: name, designation, company and photo, each by its element', plan.ok === true &&
    JSON.stringify(plan.changes.map(function (c) { return [c.id, c.set]; })) === JSON.stringify([['e4', { text: 'Meera Iyer' }], ['e5', { text: 'Head of Brand' }], ['e6', { text: 'Chennai Silks' }],
      ['e7', { src: 'https://img.etb2bimg.com/m.jpg' }]]), plan.changes);
  check('swapPlan: someone with no photo cannot take a photo\'s place in place (the post is drawn again for them)', P.swapPlan(speakerEls(), found[0], ROSTER.speakers[2]).ok === false);
  var noPhoto = speakerEls().filter(function (e) { return e.id !== 'e7'; });
  var fn = P.findPeople(noPhoto, { speakers: [ROSTER.speakers[2]].concat(ROSTER.speakers), sponsors: [] });
  check('swapPlan: nor someone with a photo where the post shows none', P.swapPlan(noPhoto, P.findPeople(noPhoto, ROSTER)[0], ROSTER.speakers[1]).ok === false && fn.length === 1);
  var pp = P.findPeople([{ id: 'l', type: 'image', src: 'https://img.etb2bimg.com/k.png' }, { id: 't', type: 'text', text: 'Presenting Partner' }], ROSTER);
  var pplan = P.swapPlan([{ id: 'l' }, { id: 't' }], pp[0], ROSTER.sponsors[1]);
  check('swapPlan: a partner: its logo and its tier line', pplan.ok && JSON.stringify(pplan.changes.map(function (c) { return [c.id, c.set]; })) ===
    JSON.stringify([['t', { text: 'Gold Partners' }], ['l', { src: 'https://img.etb2bimg.com/c.png' }]]), pplan.changes);
  check('peopleParams: the option that picks the person (one), or the list (a grid)', JSON.stringify(P.peopleParams('speaker.individual', [{ kind: 'speaker', person: { id: 's2' } }])) === '{"speakerId":"s2"}' &&
    JSON.stringify(P.peopleParams('partner.presenting-spotlight', [{ kind: 'partner', person: { id: 'p2' } }])) === '{"sponsorId":"p2"}' &&
    JSON.stringify(P.peopleParams('speaker.combined', fg)) === '{"speakerIds":["s1","s2"]}' && JSON.stringify(P.peopleParams('generic.announcement', fg)) === '{}');

  /* ---------- the side: Words, Pictures, People, Caption, then Advanced layout ---------- */
  x = load();
  x.ctx.paintSide();
  await tick();
  var side = x.doc.getElementById('edSide');
  var adv = x.doc.getElementById('owAdv');
  check('the side: the easy panel, then Advanced layout (closed) holding the platform\'s tools and Reset', side.childNodes.length === 2 && side.childNodes[0].id === 'owEasy' &&
    adv && adv.tagName === 'DETAILS' && adv.open === false && adv.querySelector('summary').textContent === 'Advanced layout' &&
    x.doc.querySelector('#owAdvHost .ed-tabs') !== null && /Reset to the design/.test(adv.textContent));
  var heads = x.doc.querySelectorAll('#owEasy .ow-easy-h').map(function (h) { return h.textContent; });
  check('the easy panel, in order: Words, Pictures, People, Caption', heads.join() === 'Words,Pictures,People,Caption', heads);
  var rows = x.doc.querySelectorAll('#owWords .ow-word');
  check('Words: a labelled box for each text, the label tied to its box', rows.length === 7 && rows.every(function (r) {
    var l = r.querySelector('label'), t = r.querySelector('textarea'); return l && t && l.getAttribute('for') === t.id && t.getAttribute('data-ow-key') === 'w:' + r.getAttribute('data-ow-el');
  }) && rows[2].querySelector('label').textContent === 'Speaker’s name' && rows[2].querySelector('textarea').value === 'Ananya Rao');
  check('Words: says a word can be typed on the post itself (a click while Advanced layout is closed)', /click a word on the post and type there/.test(x.doc.getElementById('owWords').textContent));
  var box = rows[4].querySelector('textarea');
  box.value = 'Sundaram Foods Ltd'; box.oninput();
  check('Words: typing in a box changes that element through the one write (one Undo step)', x.ctx.EDIT.els[6].text === 'Sundaram Foods Ltd' && x.log.hist === 1 && x.log.applied.indexOf('e6') !== -1);
  var bgSel = x.doc.getElementById('owBgSel');
  check('Pictures: the background menu in plain words, with what is used for all posts', bgSel && bgSel.options.map(function (o) { return o.textContent; }).join() === 'The design’s own background' &&
    /Used for all posts/.test(x.doc.getElementById('owPictures').textContent) && /Using your site’s logo/.test(x.doc.getElementById('owPictures').textContent));
  var people = x.doc.getElementById('owPeople');
  check('People: the speaker on the post, with every speaker to pick from, and Make one post per speaker', !!people && people.querySelector('select').options.length === 3 &&
    people.querySelector('select').options[0].selected === true && /Make one post per speaker \(3\)/.test(people.textContent), people && people.textContent);
  check('People: the roster is asked once', x.log.roster === 1);
  /* swap in place */
  var psel = people.querySelector('select');
  psel.value = '1'; psel.onchange(); await tick();
  check('People: Meera swapped in place: her words and photo, every other element (and its layout) untouched, one Undo step', x.ctx.EDIT.els[4].text === 'Meera Iyer' &&
    x.ctx.EDIT.els[5].text === 'Head of Brand' && x.ctx.EDIT.els[7].src === 'https://img.etb2bimg.com/m.jpg' && x.ctx.EDIT.els[7].x === 600 && x.log.hist === 2, x.ctx.EDIT.els.map(function (e) { return e.text || e.src; }));
  check('People: the option follows (speakerId), and the caption is told', x.ctx.edParams.speakerId === 's2' && x.log.caption.length === 1 && x.log.caption[0].speakerId === 's2' && x.log.loads.length === 0);
  /* a swap that cannot be made in place: drawn again from the design, after the question */
  x.doc.getElementById('owPeople').querySelector('select').value = '2';
  x.doc.getElementById('owPeople').querySelector('select').onchange(); await tick();
  check('People: someone with no photo: the post is drawn again from the design with them (asked first)', x.log.loads.join() === 'true' && x.ctx.edParams.speakerId === 's3' &&
    /drawn again from the design/.test(x.log.toasts[x.log.toasts.length - 1][0]), x.log.toasts);
  var y = load({ discard: false });
  y.ctx.paintSide(); await tick();
  var ysel = y.doc.getElementById('owPeople').querySelector('select');
  ysel.value = '2'; ysel.onchange(); await tick();
  check('People: … and Keep editing leaves the post and its options as they were', y.log.loads.length === 0 && y.ctx.edParams.speakerId === undefined && y.ctx.EDIT.els[4].text === 'Ananya Rao');
  /* Advanced layout open: the hint says double-click */
  x.doc.getElementById('owAdv').open = true;
  (x.doc.getElementById('owAdv').listeners.toggle || []).forEach(function (f) { f(); });
  check('Advanced layout open: Words says to double-click a word (a click picks it up to move it)', /Double-click a word on the post/.test(x.doc.getElementById('owWords').textContent) &&
    x.doc.getElementById('editor').classList.contains('ow-adv-open'));
  /* a repaint keeps the focus and the cursor in the box being typed in */
  var b2 = x.doc.querySelectorAll('#owWords textarea')[1];
  b2.focus(); b2.setSelectionRange(2, 3);
  x.E.repaint();
  var again = x.doc.activeElement;
  check('drawn again while typing: the same box keeps the focus and the cursor', again !== b2 && again.getAttribute('data-ow-key') === b2.getAttribute('data-ow-key') && again.selectionStart === 2 && again.selectionEnd === 3);

  /* Use for all posts */
  var z = load({ art: { bg1: true } });
  z.ctx.edParams.bg = '1';
  z.ctx.paintSide(); await tick();
  var use = z.doc.querySelectorAll('#owPictures button').filter(function (b) { return b.textContent === 'Use for all posts'; })[0];
  check('Pictures: a background other than the default offers "Use for all posts"', !!use);
  use.click(); await tick();
  check('Pictures: … which sets it for the event, says so, and then shows it is used for all posts', z.log.useBg === '1' && /is now used for all posts/.test(z.log.toasts[z.log.toasts.length - 1][0]) &&
    /Used for all posts/.test(z.doc.getElementById('owPictures').textContent));
  var bs = z.doc.getElementById('owBgSel');
  bs.value = ''; bs.onchange(); await tick();
  check('Pictures: another background for this post draws it again (the guard asks about unsaved edits)', z.ctx.edParams.bg === undefined && z.log.loads.length === 1);

  /* a Testimonial with no quote yet: the quote is written here, then Update post */
  var t = load({ tid: 'generic.testimonial', els: [{ id: 'e0', type: 'text', x: 0, y: 0, text: 'Voices of Last Edition', owRole: 'tst-kicker' }] });
  t.ctx.paintSide(); await tick();
  var q = t.doc.getElementById('owQuote');
  check('Words: a Testimonial with no quote has a Quote box and Update post', !!q && /Update post/.test(t.doc.getElementById('owWords').textContent));
  var go = t.doc.querySelectorAll('#owWords button').filter(function (b) { return b.textContent === 'Update post'; })[0];
  go.click(); await tick();
  check('… empty: refused, with why', t.log.loads.length === 0 && /real quote/.test(t.log.toasts[t.log.toasts.length - 1][0]));
  q.value = '  A real quote.  '; go.click(); await tick();
  check('… typed: the post is drawn again with it', t.log.loads.join() === 'true' && t.ctx.edParams.quote === 'A real quote.');

  /* ---------- opening: the background for all posts, a saved post on its own size ---------- */
  var o = load({ art: { useBg: '2' } });
  o.ctx.edParams = { theme: 'light', bg: '3', quote: 'x' };
  o.ctx.openEditor('generic.announcement');
  check('opening starts on the background for all posts, the theme kept', o.ctx.edParams.bg === '2' && o.ctx.edParams.theme === 'light' && o.ctx.edParams.quote === undefined);
  o.ctx.closeEditor();
  var fmt = o.doc.getElementById('edFmt');
  ['ig_square', 'story'].forEach(function (v) { var op = o.doc.createElement('option'); op.value = v; fmt.appendChild(op); });
  o.E.openSaved({ templateId: 'speaker.individual', format: 'story', theme: 'light', bg: 'design' });
  check('a saved post opens on its own theme and background', o.ctx.edParams.theme === 'light' && o.ctx.edParams.bg === 'design');
  o.ctx.loadEditor();
  check('… and its own size', fmt.value === 'story' && o.E.state.openAt === null);

  /* ---------- the Saved list on the cards page (UX-132) ---------- */
  var s = load({ layouts: [{ key: 'a', templateId: 'speaker.individual', format: 'story', theme: 'light', bg: '', savedAt: 1000 },
    { key: 'b', templateId: 'generic.announcement', format: 'ig_square', theme: 'dark', bg: '1', savedAt: 2000 }] });
  await s.E.paintSaved();
  var list = s.doc.getElementById('owSavedList');
  var items = list.querySelectorAll('.ow-saved-li');
  check('Saved posts: under the cards, newest first, each with its design, size, theme and background', list.parentNode === s.doc.body && items.length === 2 &&
    /^Label of generic\.announcement · Size ig_square · Dark · Background 1/.test(items[0].textContent) && /^Label of speaker\.individual · Size story · Light · The design’s own background/.test(items[1].textContent),
    items.map(function (i) { return i.textContent; }));
  check('Saved posts: each has Edit, which opens it', items.every(function (i) { return i.querySelector('button').textContent === 'Edit'; }));
  items[1].querySelector('button').click();
  check('… on its own template, size, theme and background', s.log.opened === 1 && s.E.state.openAt === 'story' && s.ctx.edParams.theme === 'light');
  var e = load({ layouts: [] });
  await e.E.paintSaved();
  check('Saved posts: nothing saved says how to save', /Nothing saved yet\. Open a post with Edit, then use Save\./.test(e.doc.getElementById('owSavedList').textContent));

  if (failed) { console.error('promo-social-easy: ' + failed + ' of ' + (passed + failed) + ' checks FAILED'); process.exit(1); }
  console.log('promo-social-easy: all ' + passed + ' checks passed');
})().catch(function (err) { console.error('promo-social-easy: the test itself failed — ' + (err && err.stack || err)); process.exit(1); });
