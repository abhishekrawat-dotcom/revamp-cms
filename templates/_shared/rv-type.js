/* The type scale of an AI-designed site's section headings, and the cap that holds a section to it. Shared by
   the server (functions/lib/gen-design.js: written into the prompts, applied to every section's CSS when it is
   stored and when it is served, and to the saved page on its way to the preview and the live site,
   functions/lib/api.js publishTransform) and the editor (editor-template-ui.js: a site saved before the scale
   was calmed is put right when it is opened).

   The scale, for a page whose paragraphs are 18px:
     section heading (h2)       clamp(1.75rem, 3vw, 2.375rem)    28px on a phone, at most 38px — about twice the
                                                                 text, where the 52px headings before it, set in
                                                                 capitals at weight 800-900, shouted over it
     sub-heading, card title    1.125rem to 1.375rem             18-22px; never more than 26px
     eyebrow, label             0.875rem                         unchanged
   The hero banner has its own type (gen-design.js heroCss) and is never capped: it is the one place a display
   size belongs. Big numerals in a stats band are deliberate and are left alone too.

     capHeadingSizes(css, headings)  -> css   every heading's font-size brought within the scale
         headings: the section's (or the page's) HTML, or a { className: level } map from headingClasses(); the
         classes it puts on h1-h6 count as headings at that level (optional: without it, tags and class names
         such as "-title", "-heading", "-h2" are what tell a heading)
     headingClasses(html)            -> { className: 1-6 }
     SECTION_HEADING, SUB_HEADING     the sizes the prompts ask for (CSS values)

   Only sizes over the cap change, and they come down to the cap exactly, so the cap is idempotent. A clamp() is
   scaled as a whole (its preferred value too, so it reaches the cap at the same width); its minimum is kept at
   a readable floor. A size in em, %, vw alone, var(), calc() or min()/max() is left as it is. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RevampType = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SECTION_MAX_PX = 38, SECTION_MIN_PX = 28;     // h1 outside the hero, h2, and heading-like class names
  var SUB_MAX_PX = 26, SUB_MIN_PX = 20;             // h3-h6, card and item titles
  var SECTION_HEADING = 'clamp(1.75rem, 3vw, 2.375rem)';
  var SUB_HEADING = '1.125rem to 1.375rem';

  /* a class name that says "heading" — and one that says "a number, a stat, an eyebrow": never capped, unless
     the name ends as a heading's does ("delegation-metrics-heading" is the heading of a metrics section) */
  var HEADING_NAME = /(^|[-_])(title|titles|heading|headings|headline|head|h[1-6])($|[-_])/i;
  var HEADING_END = /(^|[-_])(title|heading|headline|h[1-6])$/i;
  var SUB_NAME = /(^|[-_])(card|item|tile|sub|subtitle|h[3-6]|ctitle|stitle)($|[-_])|(card|item|sub)title/i;
  var LEFT_ALONE = /(^|[-_])(stat|stats|num|nums|number|numbers|numeral|numerals|figure|figures|count|counts|counter|counters|big|metric|metrics|kpi|kpis|digit|digits|eyebrow|kicker|label|tag|badge)($|[-_])/i;

  function headingClasses(html) {
    var map = {}, re = /<h([1-6])\b[^>]*?\sclass\s*=\s*("([^"]*)"|'([^']*)')/gi, m;
    while ((m = re.exec(String(html || '')))) {
      var level = +m[1];
      String(m[3] != null ? m[3] : m[4] || '').split(/\s+/).forEach(function (c) {
        if (c && (!map[c] || level < map[c])) map[c] = level;
      });
    }
    return map;
  }

  /* split on the commas that are not inside brackets: a selector list, or a function's arguments */
  function splitTop(s) {
    var out = [], depth = 0, start = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
    }
    out.push(s.slice(start));
    return out;
  }

  /* the last compound of one selector — the element the rule sizes — with [attribute] parts taken out */
  function subjectOf(sel) {
    var s = sel.replace(/\[[^\]]*\]/g, '[]').replace(/\([^()]*\)/g, '()').trim();
    var parts = s.split(/[\s>+~]+/).filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  /* 'section' | 'sub' | 'skip' (a numeral, an eyebrow, a pseudo-element: never capped) | '' (not a heading) */
  function kindOf(subject, classes) {
    if (/::?(before|after|first-letter|first-line|marker|placeholder)/i.test(subject)) return 'skip';
    var names = (subject.match(/\.[A-Za-z0-9_-]+/g) || []).map(function (c) { return c.slice(1); });
    if (names.some(function (c) { return LEFT_ALONE.test(c) && !HEADING_END.test(c); })) return 'skip';
    var tag = /^[A-Za-z][A-Za-z0-9-]*/.exec(subject), level = 0;
    if (tag && /^h[1-6]$/i.test(tag[0])) level = +tag[0].charAt(1);
    names.forEach(function (c) { if (classes[c] && (!level || classes[c] < level)) level = classes[c]; });
    if (level) return level <= 2 ? 'section' : 'sub';
    var named = names.filter(function (c) { return HEADING_NAME.test(c); });
    if (!named.length) return '';
    return named.every(function (c) { return SUB_NAME.test(c); }) ? 'sub' : 'section';
  }

  function num(n) { return String(Math.round(n * 1000) / 1000); }
  function px(v) {
    var m = /^\s*(\d*\.?\d+)(px|rem)\s*$/i.exec(v);
    return m ? +m[1] * (m[2].toLowerCase() === 'rem' ? 16 : 1) : null;
  }
  /* a size in px written in the unit `like` was written in */
  function inUnit(p, like) { return /rem\s*$/i.test(like) ? num(p / 16) + 'rem' : num(p) + 'px'; }

  /* one font-size value within [floor, cap]; the value itself when it is within it or cannot be read */
  function capValue(value, cap, floor) {
    var v = value.trim(), p = px(v), m;
    if (p != null) return p > cap + 0.01 ? inUnit(cap, v) : value;
    if (!(m = /^clamp\(([\s\S]*)\)$/i.exec(v))) return value;
    var args = splitTop(m[1]);
    if (args.length !== 3) return value;
    var hi = px(args[2]);
    if (hi == null || hi <= cap + 0.01) return value;
    var f = cap / hi, lo = px(args[0]);
    var low = lo == null ? args[0].trim() : inUnit(Math.min(cap, Math.max(lo * f, Math.min(lo, floor))), args[0]);
    var mid = args[1].trim().replace(/(\d*\.?\d+)(vw|vh|vmin|vmax|svw|lvw|dvw|rem|px)\b/gi, function (all, n, unit) { return num(+n * f) + unit; });
    return 'clamp(' + low + ', ' + mid + ', ' + inUnit(cap, args[2]) + ')';
  }

  function capHeadingSizes(css, headings) {
    css = String(css || '');
    if (!css || !/font-size/i.test(css)) return css;
    var classes = typeof headings === 'string' ? headingClasses(headings) : (headings || {});
    /* rule by rule (an @media block's rules too: the innermost braces hold the declarations) */
    return css.replace(/([^{}]*)\{([^{}]*)\}/g, function (all, prelude, decls) {
      if (!/font-size/i.test(decls) || /^\s*@/.test(prelude)) return all;
      var kinds = splitTop(prelude.replace(/\/\*[\s\S]*?\*\//g, '')).map(function (sel) { return kindOf(subjectOf(sel), classes); });
      if (kinds.indexOf('skip') !== -1) return all;
      var kind = kinds.indexOf('section') !== -1 ? 'section' : kinds.indexOf('sub') !== -1 ? 'sub' : '';
      if (!kind) return all;
      var cap = kind === 'section' ? SECTION_MAX_PX : SUB_MAX_PX, floor = kind === 'section' ? SECTION_MIN_PX : SUB_MIN_PX;
      var fixed = decls.replace(/(^|;)(\s*font-size\s*:\s*)([^;!]*[^;!\s])/gi, function (d, sep, head, value) {
        var calm = capValue(value, cap, floor);
        return calm === value ? d : sep + head + calm;
      });
      return fixed === decls ? all : prelude + '{' + fixed + '}';
    });
  }

  return {
    capHeadingSizes: capHeadingSizes, headingClasses: headingClasses,
    SECTION_HEADING: SECTION_HEADING, SUB_HEADING: SUB_HEADING,
    SECTION_MAX_PX: SECTION_MAX_PX, SECTION_MIN_PX: SECTION_MIN_PX, SUB_MAX_PX: SUB_MAX_PX, SUB_MIN_PX: SUB_MIN_PX
  };
});
