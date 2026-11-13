/* node functions/lib/template-selectors.test.js — exits 1 on the first failure it lists.
   Every selector the four real templates' template.json names — content.map (intro slots, fill rules, the rules
   inside a list's card), content.bind, sections[].repeat and sections[].toggle — tried on the section files
   themselves (templates/<id>/sections/<section>/index.html, parsed with functions/lib/mini-dom.js): one that matches
   nothing is a slot the wizard or the editor fills in vain (TPL-050). The design's heading / button / card lists name
   every kind the editor's settings act on; each list must reach something. No network, no Firebase. */
'use strict';
var fs = require('fs'), path = require('path');
var MD = require('./mini-dom');
var parseDocument = require('htmlparser2').parseDocument;

var ROOT = path.join(__dirname, '..', '..');
var TEMPLATES = ['tech500', 'retail-leadership-summit', 'cx-leaders-forum', 'making-ai-work'];
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + String(detail).slice(0, 400) : '')); }

function tpl(id) { return JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', id, 'template.json'), 'utf8')); }
function sectionDoc(id, sec) {
  var html = fs.readFileSync(path.join(ROOT, 'templates', id, 'sections', sec, 'index.html'), 'utf8');
  return MD.wrapDocument(parseDocument(html));
}
/* the section's root element: the first element of its file */
function rootOf(doc) { return doc.querySelector('section, div, header, footer, nav'); }
/* sel inside scope (":self" is scope itself) -> the elements, or a string saying why it could not be read */
function find(scope, sel) {
  if (sel === ':self') return [scope];
  try {
    var all = Array.prototype.slice.call(scope.querySelectorAll(sel));
    if (!all.length && scope.matches && scope.matches(sel)) all = [scope];
    return all;
  } catch (e) { return 'not a selector this page can read: ' + e.message; }
}

var tried = 0;
function expect(where, scope, sel) {
  if (sel == null || sel === '') return null;
  tried++;
  var got = find(scope, sel);
  ok(typeof got !== 'string' && got.length > 0, where + ' ' + JSON.stringify(sel) + ' matches something', typeof got === 'string' ? got : 'it matches nothing');
  return typeof got === 'string' ? null : got;
}
var SELECTOR_KEYS = ['text', 'attr', 'replace', 'paragraphs', 'bullets', 'video', 'bgvideo', 'drop', 'show', 'poster'];
function rules(where, scope, list) {
  (list || []).forEach(function (r, i) {
    var w = where + ' fill[' + i + ']';
    SELECTOR_KEYS.forEach(function (k) { if (typeof r[k] === 'string') expect(w + '.' + k, scope, r[k]); });
    if (r.list) {
      var cards = expect(w + '.list', scope, r.list);
      if (cards && cards.length) rules(w + ' (in a card)', cards[0], r.fill);
    }
  });
}

TEMPLATES.forEach(function (id) {
  var t = tpl(id), byId = {}, docs = {};
  t.sections.forEach(function (s) { byId[s.id] = s; });
  function doc(sec) {
    if (!byId[sec]) return null;
    if (!docs[sec]) docs[sec] = sectionDoc(id, sec);
    return docs[sec];
  }
  ok(Array.isArray(t.content && t.content.map) && t.content.map.length > 5, id + ': has a content.map');

  /* content.map: intro slots and fill rules */
  t.content.map.forEach(function (m, n) {
    var d = doc(m.section), where = id + ' content.map[' + n + '] (' + m.from + ' → ' + m.section + ')';
    ok(!!d, where + ': its section is one of the template\'s sections');
    if (!d) return;
    var root = rootOf(d);
    var intro = m.intro || {};
    Object.keys(intro).forEach(function (k) {
      var v = intro[k];
      if (typeof v === 'string') { expect(where + ' intro.' + k, root, v); return; }
      if (!v || typeof v !== 'object') return;
      ['sel', 'label', 'link'].forEach(function (p) { if (typeof v[p] === 'string') expect(where + ' intro.' + k + '.' + p, root, v[p]); });
      if (typeof v.list === 'string') {
        var cards = expect(where + ' intro.' + k + '.list', root, v.list);
        if (cards && cards.length) rules(where + ' intro.' + k + ' (in a card)', cards[0], v.fill);
      }
    });
    rules(where, root, m.fill);
    if (m.aiSkipMedia) expect(where + ' aiSkipMedia', root, m.aiSkipMedia);
  });

  /* content.bind: the Basics a saved page follows */
  (t.content.bind || []).forEach(function (b, n) {
    var d = doc(b.section), where = id + ' content.bind[' + n + '] (' + b.section + ' ' + b.bind + ')';
    ok(!!d, where + ': its section is one of the template\'s sections');
    if (d) expect(where, rootOf(d), b.sel);
  });

  /* the editor's Layout items and accordions */
  t.sections.forEach(function (s) {
    var d = doc(s.id);
    ok(fs.existsSync(path.join(ROOT, 'templates', id, 'sections', s.id, 'index.html')), id + ' ' + s.id + ': its index.html is there');
    if (s.repeat) {
      var items = expect(id + ' ' + s.id + ' repeat.item', d, s.repeat.item);
      if (items && items.length && s.repeat.label) {
        var item = items[0], label = s.repeat.label;
        tried++;
        ok(label === ':self' || item.matches(label) || !!item.querySelector(label), id + ' ' + s.id + ' repeat.label ' + JSON.stringify(label) + ' names something in an item (":self" when the item names itself)');
        ok(!(label !== ':self' && item.matches(label) && !item.querySelector(label)), id + ' ' + s.id + ' repeat.label: an item that names itself says ":self"', label);
      }
    }
    if (s.toggle) {
      var its = expect(id + ' ' + s.id + ' toggle.item', d, s.toggle.item);
      if (its && its.length && s.toggle.expanded) expect(id + ' ' + s.id + ' toggle.expanded', its[0], s.toggle.expanded);
    }
  });

  /* the design's lists: each reaches something on the page */
  var all = t.sections.map(function (s) { return doc(s.id); });
  ['headings', 'buttons', 'cards'].forEach(function (k) {
    var list = t.design && t.design[k];
    if (!list) return;
    var hit = list.split(',').some(function (one) { return all.some(function (d) { try { return !!d.querySelector(one.trim()); } catch (e) { return false; } }); });
    ok(hit, id + ' design.' + k + ' reaches something on the page', list);
  });
});
ok(tried > 300, 'the audit tried every selector of the four maps (more than 300)', tried);

/* the folders the templates replaced are gone, and nothing names them (TPL-063) */
ok(!fs.existsSync(path.join(ROOT, 'templates', 'tech500-check')) && !fs.existsSync(path.join(ROOT, 'templates', '_library')), 'templates/tech500-check and templates/_library are gone');
var STRATEGIC = tpl('tech500').sections.filter(function (s) { return s.id === 'strategic-influence'; })[0];
ok(STRATEGIC && STRATEGIC.repeat.label === ':self', 'tech500 strategic-influence: its buttons name themselves (repeat label ":self")', JSON.stringify(STRATEGIC && STRATEGIC.repeat));
var UI = fs.readFileSync(path.join(ROOT, 'editor-template-ui.js'), 'utf8');
ok(/cfg\.label === ':self' \|\| item\.matches\(cfg\.label\) \? item : item\.querySelector\(cfg\.label\)/.test(UI) && /cfg\.label !== ':self' && item\.querySelector\(cfg\.label\) === el/.test(UI),
  'the editor reads a ":self" label as the item itself (and never as a selector, which would throw)');

/* the README lists every template's map (TPL-050) */
var README = fs.readFileSync(path.join(ROOT, 'templates', 'README.md'), 'utf8');
TEMPLATES.forEach(function (id) {
  var part = README.split('### ' + id + '\n')[1];
  ok(!!part, 'README: a "What each template fills" table for ' + id);
  if (!part) return;
  part = part.split('\n### ')[0].split('\n## ')[0];
  tpl(id).content.map.forEach(function (m) {
    if (m.section === 'banner') return;
    ok(part.indexOf('(`' + m.section + '`) | `' + m.from + '`') !== -1, 'README: ' + id + ' lists ' + m.from + ' → ' + m.section);
  });
});

if (failures.length) {
  console.error('template-selectors: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('template-selectors: all ' + checks + ' checks passed (' + tried + ' selectors tried)');
