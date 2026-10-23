// node functions/lib/rv-award-cta.test.js — an award site's lifecycle button (templates/_shared/rv-award-cta.js):
// which state a date is in, what each state does to the button on a visitor's page, that nothing in the button
// is changed in the editor's canvas, and that it is loaded where it must be (the page runtime, the canvas).
// No browser: a small stand-in DOM. Exits 1 on any failure.
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var FILE = path.join(__dirname, '../../templates/_shared/rv-award-cta.js');
var SRC = fs.readFileSync(FILE, 'utf8');
var A = require(FILE);
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }

/* ---------- the source is ES5 (it runs on every visitor's browser) ---------- */
var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok(!/=>/.test(code) && !/\b(let|const|class)\s/.test(code) && code.indexOf('`') === -1, 'plain ES5: no arrows, let/const/class or template strings');

/* ---------- dates ---------- */
ok(A.cleanDate('2026-02-29') === '' && A.cleanDate('2028-02-29') === '2028-02-29', 'a date must be a real one (29 Feb only in a leap year)');
ok(A.cleanDate('2026-13-01') === '' && A.cleanDate('26-01-01') === '' && A.cleanDate(' 2026-11-05 ') === '2026-11-05' && A.cleanDate(null) === '', 'malformed dates are not known');
// IST is UTC+5:30: 18:29 UTC is still the same day in India, 18:30 UTC is the next
ok(A.istDate(new Date('2026-11-04T18:29:59Z')) === '2026-11-04', 'IST day: 23:59 in India is still that day');
ok(A.istDate(new Date('2026-11-04T18:30:00Z')) === '2026-11-05', 'IST day: midnight in India is the next day');

var D = { open: '2026-11-01', close: '2026-11-30', ceremony: '2026-12-15' };
function at(day, hhmm) { return new Date(day + 'T' + (hhmm || '12:00') + ':00+05:30'); }
var matrix = [
  // [today (IST), dates, state]
  ['2026-10-31', D, 'interest'],
  ['2026-11-01', D, 'nominate'],                 // the open day itself
  ['2026-11-15', D, 'nominate'],
  ['2026-11-30', D, 'nominate'],                 // the close day itself
  ['2026-12-01', D, 'soon'],
  ['2026-12-15', D, 'soon'],                     // the ceremony day: winners are announced that night
  ['2026-12-16', D, 'winners'],
  ['2030-01-01', D, 'winners'],
  ['2026-10-01', {}, 'interest'],                // nothing known
  ['2026-10-01', { close: '2026-11-30' }, 'nominate'],     // no open day, close still to come: open
  ['2026-11-30', { close: '2026-11-30' }, 'nominate'],
  ['2026-12-01', { close: '2026-11-30' }, 'soon'],
  ['2026-10-01', { open: '2026-11-01' }, 'interest'],
  ['2026-11-02', { open: '2026-11-01' }, 'nominate'],      // open, no close, no ceremony: stays open
  ['2026-12-14', { open: '2026-11-01', ceremony: '2026-12-15' }, 'nominate'],
  ['2026-12-15', { open: '2026-11-01', ceremony: '2026-12-15' }, 'soon'],   // no close day: closed on the ceremony day
  ['2026-12-16', { open: '2026-11-01', ceremony: '2026-12-15' }, 'winners'],
  ['2026-10-01', { ceremony: '2026-12-15' }, 'interest'],
  ['2026-12-16', { ceremony: '2026-12-15' }, 'winners'],
  ['2026-11-15', { open: 'soon', close: 'later', ceremony: '' }, 'interest'],   // dates that are not dates
  ['2026-11-15', { open: '2026-11-01', close: 'nope', ceremony: '2026-12-15' }, 'nominate']
];
matrix.forEach(function (m) {
  var got = A.stateFor(at(m[0]), m[1]);
  ok(got === m[2], 'stateFor ' + m[0] + ' ' + JSON.stringify(m[1]) + ' -> ' + m[2], got);
});
ok(A.stateFor(new Date('2026-11-30T18:29:00Z'), D) === 'nominate' && A.stateFor(new Date('2026-11-30T18:31:00Z'), D) === 'soon',
  'nominations close at midnight India time, not UTC');
ok(A.stateFor(new Date('2026-10-31T18:30:00Z'), D) === 'nominate', 'and open at midnight India time');
ok(A.STATES.join() === 'interest,nominate,soon,winners', 'four states');
ok(A.DEFAULT_LABELS.interest === 'Express Interest' && A.DEFAULT_LABELS.nominate === 'Nominate Now' &&
  A.DEFAULT_LABELS.soon === 'Winners will be announced soon' && A.DEFAULT_LABELS.winners === 'View Winners', 'the default words');

/* ---------- where "View Winners" goes ---------- */
function wh(v) { return JSON.stringify(A.winnersHref(v)); }
ok(wh('https://ex.com/winners') === '{"href":"https://ex.com/winners","slug":""}', 'an https address');
ok(wh('/e/qa-x/winners') === '{"href":"/e/qa-x/winners","slug":""}', 'a path on this host');
ok(wh('#winners') === '{"href":"#winners","slug":""}', 'a part of the page');
ok(wh('winners-2026') === '{"href":"#winners-2026","slug":"winners-2026"}', 'a page slug (falls back to #slug)');
['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '//evil.com/x', 'https://ex.com/a b', '', '   ', '#', 'http://', '"onmouseover=x'].forEach(function (v) {
  ok(A.winnersHref(v) === null, 'nowhere: ' + JSON.stringify(v));
});

/* ---------- a stand-in DOM ---------- */
function Text(v) { this.nodeType = 3; this.nodeName = '#text'; this.nodeValue = v; this.parentNode = null; }
function El(tag, attrs, kids) {
  this.nodeType = 1; this.tagName = this.nodeName = tag.toUpperCase(); this.attrs = {}; this.childNodes = []; this.parentNode = null;
  this.style = { display: '' }; this.hidden = false; this.ownerDocument = null;
  var self = this;
  Object.keys(attrs || {}).forEach(function (k) { self.attrs[k] = String(attrs[k]); });
  (kids || []).forEach(function (k) { self.appendChild(typeof k === 'string' ? new Text(k) : k); });
}
El.prototype.appendChild = function (n) { n.parentNode = this; this.childNodes.push(n); return n; };
El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
El.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); };
Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
Object.defineProperty(El.prototype, 'firstElementChild', { get: function () { return this.childNodes.filter(function (c) { return c.nodeType === 1; })[0] || null; } });
Object.defineProperty(Text.prototype, 'nextSibling', { get: function () { var s = this.parentNode.childNodes; return s[s.indexOf(this) + 1] || null; } });
Object.defineProperty(El.prototype, 'nextSibling', { get: function () { if (!this.parentNode) return null; var s = this.parentNode.childNodes; return s[s.indexOf(this) + 1] || null; } });
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this.childNodes.map(function (c) { return c.nodeType === 3 ? c.nodeValue : c.textContent; }).join(''); },
  set: function (v) { this.childNodes = []; this.appendChild(new Text(String(v))); }
});
/* selectors: "tag", "[attr]", "tag[attr]", several "[a][b]", or a comma list of those */
function matches(el, sel) {
  return sel.split(',').some(function (one) {
    var m = /^\s*([a-z0-9]*)((?:\[[^\]]+\])*)\s*$/i.exec(one);
    if (!m) throw new Error('stand-in DOM: unsupported selector ' + one);
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    var need = (m[2].match(/\[[^\]]+\]/g) || []).map(function (a) { return a.slice(1, -1); });
    return need.every(function (a) { return el.hasAttribute(a); });
  });
}
El.prototype.matches = function (sel) { return matches(this, sel); };
El.prototype.querySelectorAll = function (sel) {
  var out = [];
  (function walk(n) { n.childNodes.forEach(function (c) { if (c.nodeType === 1) { if (matches(c, sel)) out.push(c); walk(c); } }); }(this));
  return out;
};
El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
El.prototype.closest = function (sel) { for (var n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; };

function makeDoc(bodyKids, htmlAttrs) {
  var html = new El('html', htmlAttrs || {}), head = new El('head'), body = new El('body', {}, bodyKids);
  html.appendChild(head); html.appendChild(body);
  var listeners = {};
  var doc = {
    documentElement: html, head: head, body: body, readyState: 'complete',
    querySelectorAll: function (s) { return html.querySelectorAll(s); },
    querySelector: function (s) { return html.querySelector(s); },
    createElement: function (t) { var e = new El(t); e.ownerDocument = doc; return e; },
    createTextNode: function (v) { return new Text(v); },
    getElementById: function (id) { return html.querySelectorAll('[id]').filter(function (e) { return e.getAttribute('id') === id; })[0] || null; },
    addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); }
  };
  (function own(n) { n.ownerDocument = doc; n.childNodes.forEach(function (c) { if (c.nodeType === 1) own(c); }); }(html));
  return doc;
}
function cta(tag, attrs, kids) {
  return new El(tag, Object.assign({ 'data-rv-award-cta': '', 'data-nominations-open': D.open, 'data-nominations-close': D.close, 'data-ceremony': D.ceremony,
    'data-nominate-form': 'nomination', 'data-interest-form': 'express-interest', 'data-winners-href': '#winners' }, attrs || {}), kids || ['Nominate Now']);
}

/* ---------- each state on a visitor's page ---------- */
(function () {
  var hero = cta('a', { href: '#', class: 'btn' }), nav = cta('button', { type: 'button' }), sec = cta('a', { href: '#' });
  var doc = makeDoc([hero, nav, sec]);
  var n = A.apply(doc, at('2026-10-20'));
  ok(n === 3, 'every element on the page is handled (hero, nav, a section)', n);
  [hero, nav, sec].forEach(function (el, i) {
    ok(el.textContent === 'Express Interest' && el.getAttribute('data-rv-award-state') === 'interest', 'interest: the words (' + i + ')', el.textContent);
    ok(el.getAttribute('data-rv-form') === 'express-interest', 'interest: opens the interest form through rv-forms (' + i + ')', el.getAttribute('data-rv-form'));
  });
  ok(hero.getAttribute('href') === '#rv-form-express-interest', 'an <a> gets the form\'s own address', hero.getAttribute('href'));
  ok(!nav.hasAttribute('href'), 'a <button> gets no href');

  A.apply(doc, at('2026-11-10'));
  ok(hero.textContent === 'Nominate Now' && hero.getAttribute('data-rv-form') === 'nomination' && hero.getAttribute('href') === '#rv-form-nomination', 'nominate: the words and the nomination form');
  ok(!hero.hasAttribute('aria-disabled'), 'nominate: clickable');

  A.apply(doc, at('2026-12-05'));
  ok(hero.textContent === 'Winners will be announced soon' && hero.getAttribute('data-rv-award-state') === 'soon', 'soon: the words');
  ok(!hero.hasAttribute('data-rv-form') && !hero.hasAttribute('href') && hero.getAttribute('aria-disabled') === 'true', 'soon: no form, no link, aria-disabled');
  ok(!nav.hasAttribute('data-rv-form') && nav.getAttribute('aria-disabled') === 'true', 'soon: the button too');

  A.apply(doc, at('2026-12-20'));
  ok(hero.textContent === 'View Winners' && hero.getAttribute('href') === '#winners' && !hero.hasAttribute('aria-disabled') && !hero.hasAttribute('data-rv-form'), 'winners: the words and the link', JSON.stringify(hero.attrs));
  ok(!hero.hidden && hero.style.display === '', 'winners: shown when there is somewhere to go');
})();

(function () {
  var none = cta('a', { href: '#', 'data-winners-href': '' }), bad = cta('a', { href: '#', 'data-winners-href': 'javascript:alert(1)' });
  var doc = makeDoc([none, bad]);
  A.apply(doc, at('2027-01-01'));
  ok(none.hidden === true && none.style.display === 'none', 'winners with nowhere to go: hidden');
  ok(bad.hidden === true && bad.getAttribute('href') !== 'javascript:alert(1)', 'winners with an unsafe address: hidden, the address never used');
})();

(function () {
  var el = cta('a', { href: '#', 'data-label-interest': 'Register your interest', 'data-label-nominate': '  Send   your entry ', 'data-label-soon': 'Results soon', 'data-label-winners': 'Meet the winners' });
  var doc = makeDoc([el]);
  var words = [['2026-10-01', 'Register your interest'], ['2026-11-10', 'Send your entry'], ['2026-12-05', 'Results soon'], ['2026-12-20', 'Meet the winners']];
  words.forEach(function (w) { A.apply(doc, at(w[0])); ok(el.textContent === w[1], 'own words for ' + w[0], el.textContent); });
})();

(function () {
  /* an icon beside the words stays; a [data-rv-award-cta-label] holds the words when there is one */
  var icon = new El('svg', {}, []);
  var el = cta('a', { href: '#' }, [icon, ' Nominate ', new El('b', {}, ['Now'])]);
  var slotted = cta('a', { href: '#' }, [new El('i', { class: 'arrow' }, []), new El('span', { 'data-rv-award-cta-label': '' }, ['Nominate Now'])]);
  var doc = makeDoc([el, slotted]);
  A.apply(doc, at('2026-12-05'));
  ok(el.childNodes[0] === icon && el.textContent.trim() === 'Winners will be announced soon', 'the icon stays, the words change', JSON.stringify(el.textContent));
  ok(el.childNodes[1].nodeValue === ' Winners will be announced soon ', 'the spaces around the words are kept');
  ok(slotted.childNodes[0].tagName === 'I' && slotted.childNodes[1].textContent === 'Winners will be announced soon', 'a label slot gets the words, the rest is untouched');
})();

(function () {
  /* no form id: the attribute is set empty, so rv-forms opens the event's default form */
  var el = cta('a', { href: '#', 'data-interest-form': '', 'data-nominate-form': 'Bad Id!' });
  var doc = makeDoc([el]);
  A.apply(doc, at('2026-10-01'));
  ok(el.getAttribute('data-rv-form') === '' && el.getAttribute('href') === '#register', 'interest, no form id: the default form', JSON.stringify(el.attrs));
  A.apply(doc, at('2026-11-10'));
  ok(el.getAttribute('data-rv-form') === '', 'nominate, an id that is not a form id: the default form, never the bad id');
})();

(function () {
  /* a page slug: data-rv-page-link for the pages runtime, its address when it gives one */
  var el = cta('a', { href: '#', 'data-winners-href': 'winners' });
  var doc = makeDoc([el]);
  A.apply(doc, at('2027-01-01'));
  ok(el.getAttribute('data-rv-page-link') === 'winners' && el.getAttribute('href') === '#winners', 'a slug: data-rv-page-link and #slug');
})();

/* ---------- the page runtime started in a page (vm), with a click ---------- */
function runIn(doc, extra, reuse) {
  var listeners = reuse ? reuse.listeners : {};
  var win = reuse ? reuse.win : Object.assign({
    document: doc,
    addEventListener: function (t, fn, cap) { (listeners[t] = listeners[t] || []).push(fn); },
    getComputedStyle: function () { return { position: 'static' }; },
    location: { assign: function (u) { win.assigned = u; }, hash: '' }
  }, extra || {});
  var ctx = reuse ? reuse.ctx : vm.createContext({ window: win, console: console, setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; } });
  vm.runInContext(SRC, ctx, { filename: 'rv-award-cta.js' });
  return { win: win, listeners: listeners, ctx: ctx };
}
function snapshot(el) { return JSON.stringify([el.attrs, el.textContent, el.hidden, el.style.display]); }

(function () {
  var a = cta('a', { href: '#x', 'data-nominations-open': '2000-01-01', 'data-nominations-close': '2000-01-02', 'data-ceremony': '2099-12-31' });
  var doc = makeDoc([a]);
  var r = runIn(doc);
  ok(r.win.RevampAwardCta && typeof r.win.RevampAwardCta.stateFor === 'function', 'window.RevampAwardCta in a page');
  ok(a.textContent === 'Winners will be announced soon' && a.getAttribute('aria-disabled') === 'true', 'started on load: today is "soon" for these dates');
  ok(!!doc.querySelector('style[data-rv-award-cta-style]'), 'a small stylesheet for the status (marked data-rv-editor: never saved)');
  var prevented = 0, stopped = 0;
  var ev = { target: a, preventDefault: function () { prevented++; }, stopImmediatePropagation: function () { stopped++; }, stopPropagation: function () {} };
  r.listeners.click.forEach(function (fn) { fn(ev); });
  ok(prevented === 1 && stopped === 1, 'a click on "soon" does nothing, and the forms runtime never hears of it');
  var n = r.listeners.click.length;
  runIn(doc, null, r);
  ok(r.listeners.click.length === n, 'a second copy of the file in the same page does not start again');
})();

(function () {
  var b = cta('button', { 'data-nominations-open': '2000-01-01', 'data-nominations-close': '2000-01-02', 'data-ceremony': '2000-01-03', 'data-winners-href': 'https://ex.com/w' });
  var doc = makeDoc([b]);
  var r = runIn(doc);
  ok(b.textContent === 'View Winners', 'winners on a <button>');
  var prevented = 0;
  r.listeners.click.forEach(function (fn) { fn({ target: b, preventDefault: function () { prevented++; }, stopPropagation: function () {} }); });
  ok(prevented === 1 && r.win.assigned === 'https://ex.com/w', 'a <button> goes where the link would', r.win.assigned);
})();

/* ---------- the editor's canvas: nothing in the element changes ---------- */
(function () {
  var hero = cta('a', { href: '#nominate', class: 'btn' }, ['Nominate Now']), nav = cta('button', { 'data-label-soon': 'Results "soon" \\ here' });
  var doc = makeDoc([hero, nav], { 'data-rv-editing': '', 'data-rv-editor-mode': 'manual' });
  var before = [snapshot(hero), snapshot(nav)];
  runIn(doc);
  ok(snapshot(hero) === before[0] && snapshot(nav) === before[1], 'while editing: no word, attribute or style of the button is changed', snapshot(hero));
  var st = doc.querySelector('style[data-rv-award-cta-editor]');
  ok(!!st && st.hasAttribute('data-rv-editor'), 'while editing: a stylesheet marked data-rv-editor (serialize() and publishing drop it)');
  var today = A.labelFor(A.stateFor(new Date(), A.datesOf(hero)), hero);
  ok(st && st.textContent.indexOf('content:"Today: ' + today + '"') !== -1, 'it tags the button with what visitors see today', st && st.textContent.slice(0, 300));
  ok(!doc.querySelector('style[data-rv-award-cta-style]'), 'while editing: not the visitor\'s stylesheet');

  var css = A._editorCss(doc, at('2026-12-05'), { getComputedStyle: function () { return { position: 'static' }; } });
  ok(css.indexOf('content:"Today: Results \\"soon\\" \\\\ here"') !== -1, 'own words are quoted safely in the tag', css);
  ok(css.indexOf('[data-label-soon="Results \\"soon\\" \\\\ here"]') !== -1 && css.indexOf(':not([data-label-soon])') !== -1, 'each tag matches exactly the buttons with those words');
  ok(css.indexOf('{position:relative}') !== -1, 'a static button is made the tag\'s frame');
  var css2 = A._editorCss(doc, at('2026-12-05'), { getComputedStyle: function () { return { position: 'absolute' }; } });
  ok(css2.indexOf('{position:relative}') === -1, 'a positioned button keeps its own position');
  ok(css.split('html[data-rv-editing] ').length > 2, 'every rule only applies while editing');
})();

/* ---------- wired in: the page runtime and the editor's canvas ---------- */
var hooks = require('./api')._testHooks;
var page = '<!DOCTYPE html><html><head><title>x</title></head><body><section data-rv-section="hero"><a class="btn" data-rv-award-cta data-nominations-open="2026-11-01" data-nominate-form="nomination">Nominate Now</a></section></body></html>';
var out = hooks.publishTransform(page, { eventId: 'qa-award', event: { name: 'Awards' }, mode: 'live' });
var tag = '<script src="/templates/_shared/rv-award-cta.js?v=';
ok(out.split(tag).length === 2, 'a page with a lifecycle button gets the runtime once', out.slice(-900));
ok(out.indexOf('rv-award-cta.js') < out.indexOf('rv-forms.js'), 'before the forms runtime');
var again = hooks.publishTransform(out, { eventId: 'qa-award', event: { name: 'Awards' }, mode: 'live' });
ok(again.split(tag).length === 2, 'transformed again: still once');
var plain = hooks.publishTransform(page.replace(' data-rv-award-cta', ''), { eventId: 'qa-award', event: { name: 'Awards' }, mode: 'live' });
ok(plain.indexOf('rv-award-cta.js') === -1, 'a page without one does not load it');
ok(out.indexOf('data-nominations-open="2026-11-01"') !== -1 && out.indexOf('>Nominate Now</a>') !== -1, 'the saved markup is published as it is (the runtime decides on the visitor\'s page)');
var canvasSrc = fs.readFileSync(path.join(__dirname, '../../editor-canvas.js'), 'utf8');
ok(/AWARD_CTA_JS = new URL\('templates\/_shared\/rv-award-cta\.js'/.test(canvasSrc) && canvasSrc.indexOf("'<script src=\"' + AWARD_CTA_JS + '\" data-rv-editor></script>'") !== -1,
  'the editor\'s canvas loads it, marked data-rv-editor (left out of the saved page)');

if (failures.length) {
  console.error('rv-award-cta: ' + failures.length + ' of ' + checks + ' checks failed');
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
console.log('rv-award-cta: all ' + checks + ' checks passed');
