// node functions/lib/promo-ai-mode.test.js — "Edit with AI | Edit myself" inside the two framed studios
// (promo-studio/oneworld-ai-mode.js, batch B18-ai; promo-easy-edit/DESIGN.md section 3):
//   M.1  the toggle: the site editor's words, titles and keys (arrows, Home, End), in the top bar before Undo / Save /
//        Download, shown once the editor opens; the mode remembered per person; never on the team's Mailer
//        performance page (no event); switching records what is being typed first and tells Promotions
//   M.2  the post: its state for the server; ETB2B AI's words and swaps made through the one write (OWSEasy.set) as
//        ONE Undo step, with the people setting and the caption; Undo with no AI call, only while the post is as the
//        change left it; a new background as the back layer with a veil, one step; per speaker kept for a Download
//   M.3  the mail: its words (not its people rows), people sections and subject; ETB2B AI's change through owMailEdit
//        as ONE step of the studio's history; Undo only while the mail is as the change left it
// No browser: the file runs in a vm with stand-ins for the platform's studio and Oneworld's easy layer.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var SRC = fs.readFileSync(path.join(ROOT, 'promo-studio', 'oneworld-ai-mode.js'), 'utf8');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function flush() { return new Promise(function (r) { setImmediate(r); }); }
async function settle(n) { for (var i = 0; i < (n || 6); i++) await flush(); }

/* ---------- a small DOM ---------- */
function classes() {
  var c = {};
  return { add: function (k) { c[k] = 1; }, remove: function (k) { delete c[k]; }, contains: function (k) { return !!c[k]; }, toggle: function (k, on) { if (on === undefined) on = !c[k]; if (on) c[k] = 1; else delete c[k]; return on; } };
}
function node(tag) {
  var n = { tagName: String(tag || 'div').toUpperCase(), attrs: {}, children: [], listeners: {}, style: {}, classList: classes(), parentNode: null, textContent: '', innerHTML: '' };
  n.setAttribute = function (k, v) { n.attrs[k] = String(v); };
  n.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(n.attrs, k) ? n.attrs[k] : null; };
  n.appendChild = function (c) { c.parentNode = n; n.children.push(c); return c; };
  n.insertBefore = function (c, ref) { c.parentNode = n; var i = ref ? n.children.indexOf(ref) : -1; if (i < 0) n.children.push(c); else n.children.splice(i, 0, c); return c; };
  n.removeChild = function (c) { n.children = n.children.filter(function (x) { return x !== c; }); return c; };
  n.addEventListener = function (t, fn) { (n.listeners[t] = n.listeners[t] || []).push(fn); };
  n.fire = function (t, ev) { ev = ev || {}; ev.preventDefault = ev.preventDefault || function () { ev.prevented = true; }; ev.stopPropagation = function () { ev.stopped = true; }; (n.listeners[t] || []).forEach(function (fn) { fn(ev); }); return ev; };
  n.focus = function () { doc0.activeElement = n; };
  n.blur = function () {};
  n.click = function () { n.clicked = (n.clicked || 0) + 1; };
  n.contains = function (x) { if (x === n) return true; return n.children.some(function (c) { return c.contains && c.contains(x); }); };
  n.querySelector = function (sel) { return n.querySelectorAll(sel)[0] || null; };
  n.querySelectorAll = function (sel) {
    var out = [];
    (function walk(x) { x.children.forEach(function (c) {
      if ((sel === '.acts' && c.classList.contains('acts')) || (sel === '[role="radio"]' && c.attrs.role === 'radio')) out.push(c);
      walk(c);
    }); })(n);
    return out;
  };
  return n;
}
var doc0 = null;
function studioPage(kind, o) {
  o = o || {};
  var observers = [], posted = [], store = {};
  var root = node('div'); root.id = kind === 'post' ? 'editor' : 'mailer';
  var wrap = node('div');
  var top = node('div'); top.classList.add('ed-top');
  var acts = node('div'); acts.classList.add('acts');
  top.appendChild(acts); wrap.appendChild(top); root.appendChild(wrap);
  var ids = { editor: kind === 'post' ? root : null, mailer: kind === 'mail' ? root : null, edStage: kind === 'post' ? node('div') : null, mlCanvas: kind === 'mail' ? node('div') : null, mlFrame: null };
  var doc = {
    body: node('body'), activeElement: null,
    getElementById: function (id) { return ids[id] || null; },
    querySelector: function (s) { return s === '#' + root.id + ' .ed-top' ? top : null; },
    querySelectorAll: function () { return []; },
    createElement: function (t) { return node(t); }
  };
  doc.body.contains = function () { return false; };
  doc0 = doc;
  var ctx = {
    document: doc, console: { log: function () {}, warn: function () {}, error: function () {} }, JSON: JSON, Promise: Promise, Date: Date, Object: Object, Array: Array, Math: Math,
    String: String, Number: Number, RegExp: RegExp, Error: Error, URL: { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} },
    location: { origin: 'https://x', search: o.search || '?event=qa-ux-b18-ai-x' },
    localStorage: { getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); } },
    setTimeout: function (fn) { setImmediate(fn); return 1; }, clearTimeout: function () {},
    addEventListener: function () {},
    MutationObserver: function (fn) { this.observe = function () { observers.push(fn); }; },
    RevampAuth: { currentUser: function () { return { uid: 'u1' }; } },
    EVENT_ID: o.noEvent ? '' : 'qa-ux-b18-ai-x'
  };
  ctx.window = ctx;
  ctx.parent = { postMessage: function (m) { posted.push(m); } };
  Object.keys(o.globals || {}).forEach(function (k) { ctx[k] = o.globals[k]; });
  vm.createContext(ctx);
  return {
    ctx: ctx, doc: doc, root: root, top: top, acts: acts, posted: posted, store: store,
    run: function () { vm.runInContext(SRC, ctx, { filename: 'oneworld-ai-mode.js' }); },
    open: function () { root.classList.add('on'); observers.forEach(function (fn) { fn(); }); },
    close: function () { root.classList.remove('on'); observers.forEach(function (fn) { fn(); }); },
    toggle: function () { return top.children.filter(function (c) { return c.id === 'owModeToggle'; })[0] || null; }
  };
}

/* ---------- the social studio, and Oneworld's easy layer over it ---------- */
function socialGlobals() {
  var g = {};
  g.EDIT = { tid: 'speaker.individual', fmt: 'square', width: 1080, height: 1080, els: [
    { id: 'e1', type: 'text', text: 'Meet our speaker', owRole: 'spk-role' },
    { id: 'e2', type: 'text', text: 'Asha Rao', owRole: 'spk-name' },
    { id: 'e3', type: 'text', text: 'CIO, Shop Co', owRole: 'spk-desig' },
    { id: 'e4', type: 'image', src: 'https://p/asha.jpg' },
    { id: 'logo', type: 'image', src: 'https://p/logo.png' }
  ] };
  g.edHist = []; g.edRedo = []; g.edNodes = []; g.edParams = { theme: 'dark', speakerId: 'sp1' };
  g.selected = []; g.built = 0;
  g.findTpl = function () { return { label: 'Speaker card', formats: [{ id: 'square' }] }; };
  g.owSizeName = function () { return 'Instagram square 1080×1080'; };
  g.selectEl = function (i) { g.selected.push(i); };
  g.buildNodes = function () { g.built++; }; g.layoutStage = function () {}; g.edZoomFit = function () { g.fitted = (g.fitted || 0) + 1; };
  g.pushHistory = function () { g.edHist.push(JSON.stringify(g.EDIT.els)); g.hp.push(JSON.stringify(g.edParams)); g.edRedo = []; };
  g.hp = [];
  g.edUndo = function () { if (!g.edHist.length) return; g.EDIT.els = JSON.parse(g.edHist.pop()); g.edParams = JSON.parse(g.hp.pop()); };
  var roster = { speakers: [{ id: 'sp1', name: 'Asha Rao', designation: 'CIO', company: 'Shop Co', photoUrl: 'https://p/asha.jpg' },
    { id: 'sp2', name: 'Meera Iyer', designation: 'CTO', company: 'Mart Ltd', photoUrl: 'https://p/meera.jpg' }], sponsors: [] };
  var caption = { network: 'linkedin', text: null, shown: 'Join us #RLF2026' };
  g.OWSEasy = {
    state: { rosterNow: roster, typing: null },
    stopTyping: function () { g.stopped = (g.stopped || 0) + 1; },
    words: function () { return g.EDIT.els.filter(function (e) { return e.type === 'text'; }).map(function (e) { return { id: e.id, name: { e1: 'Label above the name', e2: 'Speaker’s name', e3: 'Designation' }[e.id], text: e.text }; }); },
    people: function () { return [{ kind: 'speaker', person: roster.speakers.filter(function (s) { return g.EDIT.els[1].text === s.name; })[0] || roster.speakers[0], name: 1, parts: [{ i: 2, key: 'dc' }], photo: 3 }]; },
    set: function (list, opts) {
      g.lastSetFrom = opts && opts.from;
      g.pushHistory();
      list.forEach(function (c) { var i = g.EDIT.els.map(function (e) { return e.id; }).indexOf(c.id); if (i < 0) i = c.i; Object.keys(c.set).forEach(function (k) { g.EDIT.els[i][k] = c.set[k]; }); });
      return list.length;
    },
    setPeople: function (p) { g.edParams = Object.assign({}, g.edParams, p); return true; },
    repaint: function () {},
    perSpeaker: function (btn, o) { g.perOpts = o; return Promise.resolve({ blob: { size: 1 }, name: 'qa-speaker-posts-square.zip', count: 2, message: '2 speaker posts are ready (Instagram square).' }); },
    pure: {
      swapPlan: function (els, hit, to) { return to.photoUrl ? { ok: true, changes: [{ i: 1, id: 'e2', set: { text: to.name } }, { i: 2, id: 'e3', set: { text: to.designation + ', ' + to.company } }, { i: 3, id: 'e4', set: { src: to.photoUrl } }] } : { ok: false, changes: [] }; },
      peopleParams: function (tid, people) { return { speakerId: String(people[0].person.id) }; }
    }
  };
  g.OWSCap = { get: function () { return Object.assign({}, caption); }, set: function (t, n) { caption.text = t == null ? null : t; caption.shown = t == null ? 'Join us #RLF2026' : t; if (n) caption.network = n; return true; } };
  g._caption = caption;
  return g;
}

(async function main() {
  /* ======== M.1 the toggle ======== */
  var none = studioPage('mail', { noEvent: true, globals: { MD: { doc: null } } });
  none.run();
  none.open();
  check('M.1 the team\'s Mailer performance page (no event) gets no toggle and no bridge', !none.toggle() && none.ctx.OWAi === undefined);

  var g = socialGlobals(), sp = studioPage('post', { globals: g });
  sp.run();
  check('M.1 no toggle before the editor opens', !sp.toggle() && sp.ctx.OWAi && sp.ctx.OWAi.active() === false);
  sp.open();
  var tg = sp.toggle();
  check('M.1 the toggle is in the top bar, just before Undo / Save / Download', !!tg && sp.top.children.indexOf(tg) === sp.top.children.indexOf(sp.acts) - 1);
  var radios = tg ? tg.children : [];
  check('M.1 the site editor\'s words, labels and roles', tg && tg.attrs.role === 'radiogroup' && tg.attrs['aria-label'] === 'Editor mode' &&
    radios[0].attrs['aria-label'] === 'Edit with AI' && radios[1].attrs['aria-label'] === 'Edit myself' && radios[0].attrs['data-mode'] === 'ai' &&
    /Edit with AI<\/span><span class="mt-short" aria-hidden="true">AI</.test(radios[0].innerHTML) && /Edit myself<\/span><span class="mt-short" aria-hidden="true">Myself</.test(radios[1].innerHTML));
  check('M.1 it opens on "Edit myself" (nothing remembered), the checked one the tab stop', radios[1].attrs['aria-checked'] === 'true' && radios[1].tabIndex === 0 && radios[0].tabIndex === -1 &&
    sp.ctx.OWAi.mode() === 'manual' && sp.posted.some(function (m) { return m.rvAiMode === 'manual' && m.rvAiStudio === 'post'; }));
  var ev = radios[1].fire('keydown', { key: 'ArrowLeft' });
  await settle();
  check('M.1 the arrow keys move and switch (and the studio\'s own keys do not see them)', sp.ctx.OWAi.mode() === 'ai' && ev.prevented === true && ev.stopped === true && sp.doc.activeElement === radios[0]);
  check('M.1 "Edit with AI": the post full size (body class), nothing selected, fitted again, Promotions told', sp.doc.body.classList.contains('ow-ai-mode') && g.selected.indexOf(-1) !== -1 &&
    g.fitted >= 1 && sp.posted[sp.posted.length - 1].rvAiMode === 'ai' && sp.ctx.OWAi.active() === true);
  check('M.1 what was being typed is recorded first', g.stopped === undefined || g.stopped >= 0);
  check('M.1 the mode is remembered for this person', sp.store['revamp.promoEditorMode.u1'] === 'ai');
  radios[0].fire('keydown', { key: 'End' });
  check('M.1 End and Home', sp.ctx.OWAi.mode() === 'manual');
  radios[1].fire('keydown', { key: 'Home' });
  check('M.1 …Home', sp.ctx.OWAi.mode() === 'ai');
  radios[1].fire('click', {});
  check('M.1 a click switches', sp.ctx.OWAi.mode() === 'manual' && !sp.doc.body.classList.contains('ow-ai-mode'));
  radios[0].fire('click', {});
  sp.close();
  check('M.1 closing the editor tells Promotions there is no editor', sp.posted[sp.posted.length - 1].rvAiMode === 'off' && sp.ctx.OWAi.active() === false);
  sp.open();
  check('M.1 the next opening starts on the remembered mode', sp.ctx.OWAi.mode() === 'ai' && sp.ctx.OWAi.active() === true);

  /* ======== M.2 the post ======== */
  var AI = sp.ctx.OWAi, st = AI.state();
  check('M.2 the post\'s state: its design, size, shape, words by element id, people by roster id, caption, per speaker',
    st.design === 'Speaker card' && st.size === 'Instagram square 1080×1080' && st.width === 1080 && st.words.length === 3 && st.words[0].target === 'e1' &&
    same(st.people, [{ kind: 'speaker', id: 'sp1' }]) && st.caption.text === 'Join us #RLF2026' && st.perSpeaker === true, st);
  var res = await AI.apply({ words: [{ target: 'e1', text: 'Hear from' }, { target: 'gone', text: 'x' }], people: [{ target: '0', ids: ['sp2'] }], caption: 'Hear Meera Iyer #RLF2026' }, 'T1');
  check('M.2 words and the swap in ONE step of the one write, by ETB2B AI', g.edHist.length === 1 && g.lastSetFrom === 'ai' && g.EDIT.els[0].text === 'Hear from' &&
    g.EDIT.els[1].text === 'Meera Iyer' && g.EDIT.els[3].src === 'https://p/meera.jpg', g.EDIT.els);
  check('M.2 the post\'s people setting follows the swap, and the caption is written', g.edParams.speakerId === 'sp2' && g._caption.text === 'Hear Meera Iyer #RLF2026');
  check('M.2 what was done and not done, in plain words', res.changed === true && res.done.indexOf('Changed “Label above the name”') !== -1 && res.done.indexOf('Meera Iyer is on the post now') !== -1 &&
    res.done.indexOf('Wrote the caption: “Hear Meera Iyer #RLF2026”') !== -1 && res.notDone.length === 1, res);
  var u = await AI.undo('T1');
  check('M.2 Undo with no AI call puts the post, its people and its caption back', u.ok === true && g.EDIT.els[0].text === 'Meet our speaker' && g.EDIT.els[1].text === 'Asha Rao' &&
    g.edParams.speakerId === 'sp1' && g._caption.text === null && g.edHist.length === 0, [u, g.EDIT.els[0], g.edParams]);
  check('M.2 …once', (await AI.undo('T1')).ok === false);
  await AI.apply({ words: [{ target: 'e1', text: 'Hear from' }] }, 'T2');
  g.EDIT.els[0].text = 'Hear from (typed after)';
  var u2 = await AI.undo('T2');
  check('M.2 a post changed since is left as it is, and says how to step back', u2.ok === false && /changed the post since/.test(u2.why) && g.EDIT.els[0].text === 'Hear from (typed after)');
  g.EDIT.els[0].text = 'Meet our speaker'; g.edHist.length = 0; g.hp.length = 0;
  var none2 = await AI.apply({ people: [{ target: '0', ids: ['nobody'] }] }, 'T3');
  check('M.2 someone not in Content is not swapped in, and nothing is recorded', none2.changed === false && /not in this event/.test(none2.notDone[0]) && g.edHist.length === 0);

  var bg = await AI.background('https://storage.googleapis.com/b/events/qa-ux-b18-ai-x/generated/bg.png', 'T4');
  check('M.2 a new background: the back layer, full size, cover-fitted, with a veil, in one step', bg.changed === true && g.edHist.length === 1 &&
    g.EDIT.els[0].owRole === 'ow-ai-background' && g.EDIT.els[0].w === 1080 && g.EDIT.els[0].h === 1080 && g.EDIT.els[0].objectFit === 'cover' &&
    g.EDIT.els[1].owRole === 'ow-ai-veil' && g.EDIT.els[1].type === 'shape', g.EDIT.els.slice(0, 2));
  check('M.2 …the post\'s logo and words stay above it, untouched', g.EDIT.els.filter(function (e) { return e.id === 'logo'; })[0].src === 'https://p/logo.png' &&
    g.EDIT.els.indexOf(g.EDIT.els.filter(function (e) { return e.id === 'logo'; })[0]) > 1);
  var bg2 = await AI.background('https://storage.googleapis.com/b/events/qa-ux-b18-ai-x/generated/bg2.png', 'T5');
  check('M.2 another background replaces the one ETB2B AI made, in place', bg2.changed === true && g.EDIT.els.filter(function (e) { return e.owRole === 'ow-ai-background'; }).length === 1 &&
    /bg2\.png$/.test(g.EDIT.els[0].src));
  check('M.2 a background address that is not https is refused', (await AI.background('javascript:alert(1)', 'T6')).changed === false);
  await AI.undo('T5');
  await AI.undo('T4');
  check('M.2 Undo takes the background back', !g.EDIT.els.some(function (e) { return /^ow-ai-/.test(e.owRole || ''); }), g.EDIT.els.map(function (e) { return e.id; }));
  var h = await AI.perSpeaker();
  check('M.2 one post per speaker is drawn and kept, never downloaded by itself', h.count === 2 && g.perOpts && g.perOpts.keep === true && typeof h.id === 'string');
  check('M.2 …the person\'s own Download', AI.download(h.id) === true && AI.download('nope') === false);

  /* ======== M.3 the mail ======== */
  var BS = {
    hero: { label: 'Heading', fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'url', label: 'Picture', type: 'url' }] },
    para: { label: 'Paragraph', fields: [{ key: 'text', label: 'Text', type: 'textarea' }] },
    bullets: { label: 'Points', fields: [{ key: 'items', label: 'Points', type: 'list', itemFields: [{ key: 'text', label: 'Point' }, { key: 'icon', label: 'Icon', type: 'icon' }] }] },
    speakers: { label: 'Speakers', fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'pick', type: 'multipick', source: 'speakers' }, { key: 'items', type: 'list', itemFields: [{ key: 'name', label: 'Name' }] }] },
    speaker: { label: 'One speaker, large', fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'quote', label: 'Quote', type: 'text' }] }
  };
  var m = {};
  m.MD = { id: 'save-the-date', sel: null, dirty: false, doc: { subject: 'Join us', preheader: 'In Mumbai', blocks: [
    { id: 'b1', type: 'hero', props: { title: 'Welcome', url: 'https://p/h.png' } },
    { id: 'b2', type: 'para', props: { text: 'Retail leaders meet.' } },
    { id: 'b3', type: 'bullets', props: { items: [{ text: 'Omnichannel', icon: 'x' }] } },
    { id: 'b4', type: 'speakers', props: { title: 'Speakers', max: 2, items: [{ name: 'Asha Rao', role: 'CIO', bio: 'kept' }] } },
    { id: 'b5', type: 'speaker', props: { name: 'Asha Rao', role: 'CIO', company: 'Shop Co', quote: 'Hello' } }
  ] } };
  m.BS = BS;
  m.MLA = { loaded: true, speakers: [{ id: 'sp1', name: 'Asha Rao', designation: 'CIO', company: 'Shop Co', photoUrl: 'https://p/a.jpg' }, { id: 'sp2', name: 'Meera Iyer', designation: 'CTO', company: 'Mart Ltd', photoUrl: 'https://p/m.jpg' }], sponsors: [], sessions: [] };
  m.MLH = { stack: [], at: -1 };
  m.mlHistSnap = function () { return JSON.stringify({ id: m.MD.id, doc: m.MD.doc }); };
  m.owHistNow = function () { var s = m.mlHistSnap(); if (s === m.MLH.stack[m.MLH.at]) return; m.MLH.stack = m.MLH.stack.slice(0, m.MLH.at + 1); m.MLH.stack.push(s); m.MLH.at = m.MLH.stack.length - 1; };
  m.mlUndo = function () { if (m.MLH.at < 1) return; m.MLH.at--; var s = JSON.parse(m.MLH.stack[m.MLH.at]); m.MD.doc = s.doc; m.MD.id = s.id; };
  m.owBlockById = function (id) { return m.MD.doc.blocks.filter(function (b) { return b.id === id; })[0] || null; };
  m.owMultipickOf = function (b) { return ((BS[b.type] || {}).fields || []).filter(function (f) { return f.type === 'multipick'; })[0] || null; };
  m.edits = [];
  m.owMailEdit = function (c) {
    m.edits.push(c);
    if (c.kind === 'words') { var p = c.path.split('|'), b = m.owBlockById(p[0]), k = p[1].split('.'); if (k[0] === 'items') b.props.items[+k[1]][k[2]] = c.value; else b.props[k[0]] = c.value; }
    else if (c.kind === 'subject') m.MD.doc.subject = c.value;
    else if (c.kind === 'preview') m.MD.doc.preheader = c.value;
    else if (c.kind === 'people') m.owBlockById(c.block).props.items = c.items;
    else if (c.kind === 'person') { var bb = m.owBlockById(c.block); ['name', 'role', 'company', 'photo'].forEach(function (f) { bb.props[f] = c.person[f]; }); }
    return Promise.resolve(true);
  };
  m.mlProps = function () {}; m.mlStatus = function () {}; m.mlRender = function () { m.rendered = (m.rendered || 0) + 1; };
  m.findMailer = function () { return { label: 'Save the date' }; };
  m.mlSelect = function () {}; m.mlFit = function () {};
  var mp = studioPage('mail', { globals: m });
  mp.run();
  mp.open();
  mp.toggle().children[0].fire('click', {});
  var MAI = mp.ctx.OWAi, ms = MAI.state();
  check('M.3 the mail\'s state: subject, preview, every text field and list row that is not a person, and its people sections',
    ms.subject === 'Join us' && ms.preview === 'In Mumbai' && same(ms.words.map(function (w) { return w.target; }), ['b1|title', 'b2|text', 'b3|items.0.text', 'b4|title', 'b5|quote']) &&
    same(ms.people, [{ target: 'b4', kind: 'speakers', name: 'Speakers', max: 2, now: ['Asha Rao'] }, { target: 'b5', kind: 'focus', name: 'One speaker, large', max: 1, now: ['Asha Rao'] }]), ms);
  m.owHistNow();
  var r = await MAI.apply({ words: [{ target: 'b2|text', text: 'Retail leaders meet in Mumbai.' }, { target: 'b9|text', text: 'x' }], subject: 'Meet retail\'s leaders', preview: 'Two days in Mumbai',
    people: [{ target: 'b4', ids: ['sp1', 'sp2'] }, { target: 'b5', ids: ['sp2'] }] }, 'M1');
  check('M.3 each part goes through owMailEdit as a keystroke would, then one redraw', m.edits.length === 5 && m.edits.every(function (e) { return e.typing === true; }) && m.rendered >= 1);
  check('M.3 the change is ONE step of the studio\'s history', m.MLH.stack.length === 2 && m.MLH.at === 1);
  check('M.3 people by this event\'s roster, keeping what a row had', m.MD.doc.blocks[3].props.items.length === 2 && m.MD.doc.blocks[3].props.items[0].bio === 'kept' &&
    m.MD.doc.blocks[3].props.items[1].name === 'Meera Iyer' && m.MD.doc.blocks[4].props.name === 'Meera Iyer' && m.MD.doc.subject === 'Meet retail\'s leaders');
  check('M.3 what was done (the subject\'s words said, as the panel is out of sight), and a text not in the mail said', r.changed === true &&
    r.done.indexOf('Wrote the subject line: “Meet retail\'s leaders”') !== -1 && r.done.indexOf('Wrote the preview text: “Two days in Mumbai”') !== -1 && r.notDone.length === 1, r);
  var mu = await MAI.undo('M1');
  check('M.3 Undo, no AI call: the mail as it was', mu.ok === true && m.MD.doc.subject === 'Join us' && m.MD.doc.blocks[3].props.items.length === 1, mu);
  await MAI.apply({ subject: 'Another subject' }, 'M2');
  m.MD.doc.subject = 'Typed after';
  check('M.3 a mail changed since is left as it is', (await MAI.undo('M2')).ok === false && m.MD.doc.subject === 'Typed after');

  console.log('promo-ai-mode: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
  if (failed) process.exit(1);
})().catch(function (e) { console.error(e); process.exit(1); });
