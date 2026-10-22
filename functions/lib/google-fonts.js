/* Google Fonts only: the type a generated site is set in comes from Google Fonts' open-source catalogue
   (data/google-fonts.json, tools/build-google-fonts.js) and nowhere else, so no site carries a licensed
   face it has no right to (a previous edition's Gilroy or Proxima Nova, a model's "Helvetica Neue").
   A family that is not on Google Fonts is set in the Google family nearest to it in character
   (edition-look.js's substitutes) or, failing that, in the fallback given.

     family(name)          -> the Google Fonts family a name stands for, as Google spells it | ''
                              ("montserrat", "Montserrat-Bold", "'Open Sans'" all find theirs)
     toGoogle(name)        -> family(name), else the nearest Google family for a licensed face | ''
     googleOnly(name, fb)  -> toGoogle(name) || toGoogle(fb) || 'Inter'
     weights(family)       -> [upright weights the family has] | []
     cssUrl(family, want)  -> the css2 stylesheet for the weights of `want` (default 300-800) the family has;
                              '' for a family that is not on Google Fonts. Asking Google for a weight a
                              family lacks fails the whole stylesheet (400): Bebas Neue, Anton and Abril
                              Fatface have only 400, and a site set in one fell back to Arial.
     googleOnlyCss(css, q) -> the CSS with every font-family naming only Google families (or generic ones
                              and var()s), and no @font-face of its own; q: the quote to name them in (' inside a
                              style="" attribute; " by default)
     googleOnlyHtml(html)  -> the same for a section's markup: its <style> blocks and style="" attributes, and no
                              stylesheet <link> of its own (a font service's, above all) */
'use strict';
var DATA = require('./data/google-fonts.json');

var FAMILIES = DATA.families || {};
function key(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
var BY_KEY = {};
Object.keys(FAMILIES).forEach(function (f) { BY_KEY[key(f)] = f; });

/* a family as a page or a model names it: quotes, a foundry's suffixes ("-Regular", "Bold", "Web") aside */
function family(name) {
  var raw = String(name || '').replace(/["']/g, '').trim();
  if (!raw) return '';
  var k = key(raw);
  if (BY_KEY[k]) return BY_KEY[k];
  var bare = key(raw.replace(/[-_ ]?(?:webs?|webfont|regular|bold|semibold|semi ?bold|medium|light|book|italic|black|thin|extra ?bold|extra ?light|std|pro|variable|vf)\b/gi, ' '));
  return BY_KEY[bare] || '';
}

var editionLook = null;
function substitute(name) {
  if (!editionLook) editionLook = require('./edition-look');
  var g = editionLook.googleFont(name);
  return g && family(g) ? family(g) : '';
}
function toGoogle(name) { return family(name) || substitute(name); }
function googleOnly(name, fallback) { return toGoogle(name) || toGoogle(fallback) || 'Inter'; }

function weights(name) {
  var f = family(name), row = f ? FAMILIES[f] : null;
  return row ? row.slice(1) : [];
}

var DEFAULT_WEIGHTS = [300, 400, 500, 600, 700, 800];
function cssUrl(name, want) {
  var f = family(name);
  if (!f) return '';
  var have = weights(f), asked = (want && want.length ? want : DEFAULT_WEIGHTS).filter(function (w) { return have.indexOf(+w) !== -1; });
  var spec = encodeURIComponent(f).replace(/%20/g, '+');
  /* a family with one of the weights asked (or none of them): its own weights, as Google has them */
  if (!asked.length) asked = have.length > 1 ? have.filter(function (w) { return w >= 300 && w <= 800; }) : [];
  return 'https://fonts.googleapis.com/css2?family=' + spec + (asked.length > 1 || (asked.length === 1 && asked[0] !== 400) ? ':wght@' + asked.join(';') : '') + '&display=swap';
}

/* ---------- CSS a model wrote ---------- */
var GENERIC = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|inherit|initial|unset|revert|revert-layer)$/i;
/* one font-family value -> the same list with every named family a Google one (or left out). Nothing
   named left: the site's body font — or, where the value defines a custom property (which must not name
   itself), the generic family */
function familyList(value, custom, quote) {
  var q = quote || '"';
  var important = /!\s*important\s*$/i.test(value);
  var v = value.replace(/!\s*important\s*$/i, '').trim();
  /* split on commas outside var(...) */
  var parts = [], depth = 0, cur = '';
  for (var i = 0; i < v.length; i++) {
    var ch = v[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  var out = [], seen = {}, dropped = false;
  parts.forEach(function (p) {
    var t = p.trim();
    if (!t) return;
    var bare = t.replace(/^["']|["']$/g, '').trim(), g = '';
    var kept = /^var\s*\(/i.test(t) || GENERIC.test(bare) ? t : ((g = toGoogle(bare)) ? q + g + q : '');
    if (!kept) dropped = true;
    if (kept && !seen[kept.toLowerCase()]) { seen[kept.toLowerCase()] = 1; out.push(kept); }
  });
  /* a list that only ever named generic families ("monospace") is left as it was */
  if (!out.length || (dropped && out.every(function (p) { return GENERIC.test(p); }))) {
    if (custom) { if (!out.length) out.push('sans-serif'); }
    else out.unshift('var(--body-font-family)');
  }
  return out.join(', ') + (important ? ' !important' : '');
}
var VALUE = '([^;{}"\']*(?:(?:"[^"]*"|\'[^\']*\')[^;{}"\']*)*)';
/* the size in a font shorthand ("700 2rem/1.1 'Gilroy', sans-serif"): what follows the last one is the family */
var SIZE = /(?:^|\s)[\d.]+(?:px|rem|em|%|pt|vw|vh|vmin|vmax|ex|ch|cap|lh)(?:\s*\/\s*[\d.]+[a-z%]*)?\s+/gi;
function googleOnlyCss(css, quote) {
  var out = String(css || '');
  /* a face of its own (a file on another server) is never loaded */
  out = out.replace(/@font-face\s*\{[^}]*\}/gi, '');
  out = out.replace(new RegExp('(^|[^\\w-]|--[\\w-]*-)(font-family\\s*:\\s*)' + VALUE, 'gi'), function (m, before, head, value) {
    return value.trim() ? before + head + familyList(value, /^--/.test(before), quote) : m;
  });
  out = out.replace(new RegExp('(^|[^\\w-])(font\\s*:\\s*)' + VALUE, 'gi'), function (m, before, head, value) {
    var last = null, hit;
    SIZE.lastIndex = 0;
    while ((hit = SIZE.exec(value))) last = hit;
    if (!last) return m;
    var cut = last.index + last[0].length;
    return value.slice(cut).trim() ? before + head + value.slice(0, cut) + familyList(value.slice(cut), false, quote) : m;
  });
  return out;
}

function googleOnlyHtml(html) {
  var out = String(html || '');
  out = out.replace(/<link\b[^>]*>/gi, '');
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, function (m, a, css, b) { return a + googleOnlyCss(css) + b; });
  out = out.replace(/(\sstyle\s*=\s*")([^"]*)(")/gi, function (m, a, css, b) { return /font/i.test(css) ? a + googleOnlyCss(css, "'") + b : m; });
  out = out.replace(/(\sstyle\s*=\s*')([^']*)(')/gi, function (m, a, css, b) { return /font/i.test(css) ? a + googleOnlyCss(css, '"') + b : m; });
  return out;
}

module.exports = { googleOnlyHtml: googleOnlyHtml, family: family, toGoogle: toGoogle, googleOnly: googleOnly, weights: weights, cssUrl: cssUrl, googleOnlyCss: googleOnlyCss, familyList: familyList };
