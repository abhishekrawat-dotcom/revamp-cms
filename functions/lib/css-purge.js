/* Unused-rule removal for a big shared stylesheet, against ONE page (lib/delivery.js).

   ET's microsite bundle (templates/_shared/et-global.css) is 600 KB, and a ported template's page uses about
   3% of it; as a render-blocking stylesheet it held a phone's first paint back by over two seconds. A
   published page is a fixed document, so the rules none of its markup or scripts can ever match can be left
   out of the copy that page gets.

   The rule for "can match" is deliberately generous — a rule is dropped only when it names a class or an id
   that appears NOWHERE in the page's text or in the text of the scripts the page runs:
     - every word of the page and of those scripts counts, not just class="…" attributes, so a class a
       script adds (classList.add('open'), 'is-active') keeps its rules;
     - names inside :not(), :is(), :where(), :has() and other functional pseudo-classes are not required
       (a rule is never dropped for what it excludes);
     - tags, attributes and pseudo-classes are never required;
     - at-rules other than @media / @supports / @layer / @container (@font-face, @keyframes, @page, @import,
       @charset …) are kept as they are, and a selector that does not parse is kept.
   A class made by joining strings in a script ('col-' + n) would not be seen; the shared stylesheets'
   own class names are not built that way by any script of ours, and the editor and its live view always
   load the whole file, so nothing an owner edits is ever judged against a purged copy.

   The stylesheet is scanned, not parsed strictly: ET's bundle carries declarations a browser silently
   drops (e.g. "background:background: #3ebd00"), which a strict CSS parser refuses. Rule bodies are copied
   byte for byte, so whatever the browser made of a rule before, it makes of it now. */
'use strict';
var selectorParser = require('postcss-selector-parser');

/* -> [{ kind: 'rule', prelude, body } | { kind: 'at', name, prelude, body (null for "@x …;"), raw }] —
   body is the text between the braces. Comments are dropped (they never render). */
function scan(css) {
  var out = [], i = 0, n = css.length;
  function skipString(j) {
    var q = css.charAt(j); j++;
    while (j < n && css.charAt(j) !== q) { if (css.charAt(j) === '\\') j++; j++; }
    return j + 1;
  }
  function skipComment(j) { var e = css.indexOf('*/', j + 2); return e === -1 ? n : e + 2; }
  /* index just past the "}" matching the "{" at j */
  function blockEnd(j) {
    var depth = 0;
    while (j < n) {
      var c = css.charAt(j);
      if (c === '"' || c === "'") { j = skipString(j); continue; }
      if (c === '/' && css.charAt(j + 1) === '*') { j = skipComment(j); continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return j + 1; }
      j++;
    }
    return n;
  }
  while (i < n) {
    var c = css.charAt(i);
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && css.charAt(i + 1) === '*') { i = skipComment(i); continue; }
    if (c === '}' || c === ';') { i++; continue; }                     // stray: a browser skips it too
    var start = i, j = i, parens = 0;
    /* the prelude runs to the first "{" (or, for an at-rule, a ";") outside strings, comments and () */
    var prelude = '';
    while (j < n) {
      var d = css.charAt(j);
      if (d === '"' || d === "'") { var e = skipString(j); prelude += css.slice(j, e); j = e; continue; }
      if (d === '/' && css.charAt(j + 1) === '*') { j = skipComment(j); continue; }
      if (d === '(') parens++;
      else if (d === ')' && parens) parens--;
      else if (!parens && (d === '{' || (d === ';' && c === '@'))) break;
      prelude += d; j++;
    }
    if (j >= n) { out.push({ kind: 'raw', raw: css.slice(start) }); break; }
    if (css.charAt(j) === ';') {
      out.push({ kind: 'at', name: atName(prelude), prelude: prelude.trim(), body: null, raw: css.slice(start, j + 1) });
      i = j + 1; continue;
    }
    var end = blockEnd(j);
    var body = css.slice(j + 1, end - 1);
    if (c === '@') out.push({ kind: 'at', name: atName(prelude), prelude: prelude.trim(), body: body, raw: css.slice(start, end) });
    else out.push({ kind: 'rule', prelude: prelude.trim(), body: body });
    i = end;
  }
  return out;
}
function atName(prelude) { var m = /^@([\w-]+)/.exec(prelude.trim()); return m ? m[1].toLowerCase() : ''; }

/* the comma-separated selectors of a prelude (commas inside () or [] or strings do not split) */
function splitSelectors(prelude) {
  var parts = [], depth = 0, cur = '', q = '';
  for (var i = 0; i < prelude.length; i++) {
    var c = prelude.charAt(i);
    if (q) { cur += c; if (c === '\\') { cur += prelude.charAt(++i); continue; } if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth) depth--;
    if (c === ',' && !depth) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/* every word that could be a class or id name somewhere in `texts` */
function wordsOf(texts) {
  var words = new Set();
  texts.forEach(function (text) {
    String(text || '').split(/[^A-Za-z0-9_\-:\/.@%\[\]!]+/).forEach(function (w) {
      if (!w) return;
      words.add(w);
      w.split(/[^A-Za-z0-9_-]+/).forEach(function (x) { if (x) words.add(x); });
    });
  });
  return words;
}

var selectorCache = new Map();
/* the class and id names a selector REQUIRES (outside functional pseudo-classes), or null when it does
   not parse (then it is kept) */
function requiredNames(sel) {
  if (selectorCache.has(sel)) return selectorCache.get(sel);
  var names = [];
  try {
    selectorParser(function (root) {
      root.walk(function (node) {
        if (node.type !== 'class' && node.type !== 'id') return;
        for (var p = node.parent; p; p = p.parent) if (p.type === 'pseudo') return;
        names.push(node.value);
      });
    }).processSync(sel);
  } catch (e) { names = null; }
  if (selectorCache.size > 50000) selectorCache.clear();
  selectorCache.set(sel, names);
  return names;
}

var GROUPING = { media: 1, supports: 1, layer: 1, container: 1, document: 1, '-moz-document': 1 };

/* css: the stylesheet; words: a Set from wordsOf() -> { css, kept, dropped } */
function purgeCss(css, words) {
  var kept = 0, dropped = 0;
  function walk(items) {
    var text = '';
    items.forEach(function (it) {
      if (it.kind === 'raw') { text += it.raw; return; }
      if (it.kind === 'at') {
        if (it.body != null && GROUPING[it.name]) {
          var inner = walk(scan(it.body));
          if (inner) text += it.prelude + '{' + inner + '}';
          return;
        }
        text += it.raw;
        return;
      }
      var sels = splitSelectors(it.prelude);
      var keep = sels.filter(function (s) {
        var names = requiredNames(s);
        if (names === null) return true;
        for (var k = 0; k < names.length; k++) if (!words.has(names[k])) return false;
        return true;
      });
      if (!keep.length) { dropped++; return; }
      kept++;
      text += (keep.length === sels.length ? it.prelude : keep.join(',')) + '{' + it.body + '}';
    });
    return text;
  }
  var out = walk(scan(String(css || '')));
  return { css: out, kept: kept, dropped: dropped };
}

module.exports = { purgeCss: purgeCss, wordsOf: wordsOf, scan: scan, splitSelectors: splitSelectors };
