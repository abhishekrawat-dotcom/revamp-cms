/* Accessibility of a published page, put right when the page is published (lib/api.js publishTransform) — never
   in the saved page, which stays exactly as its owner left it. Every function here is idempotent: running it on
   its own output changes nothing, which is what lets the transform run again on a page it already transformed.

   FOR AN AI-DESIGNED SITE (its sections' CSS was written by a model, so nothing guarantees its colours read):
     palette(styleAttr)                   -> { theme, accent, bg, surface, text, muted, + the derived reading
                                             colours } from the page's own variables on <body>
     readingVars(styleAttr)               -> the same style attribute with the reading colours of its palette set
                                             (rv-theme.js derivedVars): --rv-theme-fill / --rv-on-theme (a brand
                                             button's ground and words), --rv-theme-ink (the brand colour as text),
                                             the accent's three, and --rv-muted held to 4.5:1 on the panels too
     guardCss(css, sectionId, palette)    -> the section's stylesheet with the text colours that do not reach WCAG
                                             AA (4.5:1; 3:1 for large text) on the ground they are drawn on made to.
                                             Only where that ground is known:
        · a rule that paints its own solid ground (a button, a badge): its words are measured on it. A brand-
          coloured button takes the page's readable button ground and words (var(--rv-theme-fill) /
          var(--rv-on-theme)); a fixed colour on a fixed ground is taken towards black or white until it reads.
        · any other rule: measured on the section's ground (the section root's own solid ground, else the page's
          ground and its panels) — and only when nothing else in the section paints a ground of the other tone
          or a picture (then the words could be standing on either, and are left alone). The brand colour as
          text becomes var(--rv-theme-ink); a fixed colour that nearly reads (from 1.6:1) is taken towards black
          or white until it does; one far from reading was meant for another ground and is left alone.
        Hover/focus states, placeholders and pseudo-elements are not measured (nor are they by an audit).

   FOR EVERY SITE (template, AI-designed, imported):
     viewportContent(content)             -> the viewport meta's content without what stops a visitor zooming
                                             (user-scalable=no/0, a maximum-scale under 5); minimum-scale=1 stays
                                             (ET's guard against a phone zooming out to fit a too-wide section)
     headingLevels(headings)              -> for each heading in page order { orig, level } (see the function) */
var postcss = require('postcss');
var rvTheme = require('../../templates/_shared/rv-theme.js');

/* ---------- the palette on <body> ---------- */
function styleDecls(style) {
  var list = [];
  String(style || '').split(';').forEach(function (part) {
    var at = part.indexOf(':');
    if (at === -1) { if (part.trim()) list.push({ raw: part }); return; }
    list.push({ name: part.slice(0, at).trim(), value: part.slice(at + 1).trim() });
  });
  return list;
}
function hexOf(v) {
  var c = parseColour(v);
  return c && c.a >= 0.995 ? c.hex : '';
}
var PALETTE_VARS = { theme: '--theme-color', accent: '--accent-color', bg: '--rv-bg', surface: '--rv-surface', text: '--rv-text', muted: '--rv-muted' };
function palette(style) {
  var vars = {};
  styleDecls(style).forEach(function (d) { if (d.name && /^--/.test(d.name)) vars[d.name.toLowerCase()] = d.value; });
  var p = { vars: vars };
  Object.keys(PALETTE_VARS).forEach(function (k) { p[k] = hexOf(vars[PALETTE_VARS[k]]); });
  if (!p.bg) p.bg = hexOf(vars['background-color']);
  var derived = rvTheme.derivedVars({ theme: p.theme, accent: p.accent, bg: p.bg, surface: p.surface || p.bg, muted: p.muted });
  Object.keys(derived).forEach(function (k) { vars[k] = derived[k]; });
  if (derived['--rv-muted']) p.muted = derived['--rv-muted'];
  p.derived = derived;
  return p;
}
/* the style attribute with the reading colours set (replacing any earlier ones, in place) */
function readingVars(style) {
  var p = palette(style), derived = p.derived, done = {};
  if (!Object.keys(derived).length) return String(style || '');
  var list = styleDecls(style).map(function (d) {
    if (d.name && Object.prototype.hasOwnProperty.call(derived, d.name.toLowerCase())) { done[d.name.toLowerCase()] = 1; return d.name + ':' + derived[d.name.toLowerCase()]; }
    return d.raw != null ? d.raw : d.name + ':' + d.value;
  }).filter(function (s) { return String(s).trim(); });
  Object.keys(derived).forEach(function (k) { if (!done[k]) list.push(k + ':' + derived[k]); });
  return list.join(';');
}

/* ---------- colours in CSS ---------- */
var NAMED = { white: '#ffffff', black: '#000000' };
function toHex2(n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); }
/* { hex, a } for a colour written plainly; null for anything else (a variable is resolved by resolve()) */
function parseColour(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s*!important$/, '');
  if (NAMED[s]) return { hex: NAMED[s], a: 1 };
  if (s === 'transparent') return { hex: '#000000', a: 0 };
  var m;
  if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
    var h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { hex: '#' + h.slice(0, 6), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  if ((m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(s))) {
    return { hex: '#' + toHex2(+m[1]) + toHex2(+m[2]) + toHex2(+m[3]), a: m[4] == null ? 1 : (m[5] ? +m[4] / 100 : +m[4]) };
  }
  return null;
}
/* a value as a colour, variables looked up in the palette: { hex, a, v: the variable it came from | '' } or null */
function resolve(value, pal, depth) {
  var s = String(value == null ? '' : value).trim().replace(/\s*!important$/i, '');
  var m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/i.exec(s);
  if (m) {
    var name = m[1].toLowerCase(), known = pal.vars[name];
    if (known != null && (depth || 0) < 4) { var r = resolve(known, pal, (depth || 0) + 1); if (r) { r.v = r.v || name; return r; } }
    return m[2] && (depth || 0) < 4 ? resolve(m[2], pal, (depth || 0) + 1) : null;
  }
  var c = parseColour(s);
  if (c) c.v = '';
  return c;
}
function blend(c, ground) {
  if (c.a >= 0.995) return c.hex;
  return rvTheme.mix(ground, c.hex, Math.max(0, Math.min(1, c.a)));
}
function dark(hex) { return rvTheme.lum(hex) < 0.2; }

/* the ground a rule paints: { kind: 'solid', hex, v } | { kind: 'picture' } | null (none, or not a solid one) */
function groundOf(rule, pal) {
  var found = null;
  rule.each(function (d) {
    if (d.type !== 'decl') return;
    var p = d.prop.toLowerCase(), v = String(d.value);
    if (p === 'background-image') { if (/url\(|gradient\(/i.test(v)) found = { kind: 'picture' }; return; }
    if (p !== 'background' && p !== 'background-color') return;
    if (/url\(|gradient\(/i.test(v)) { found = { kind: 'picture' }; return; }
    var c = resolve(v, pal);
    if (!c && p === 'background') {
      var first = /^\s*(var\([^()]*(?:\([^()]*\))?[^()]*\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|[a-z]+)/i.exec(v);
      c = first ? resolve(first[1], pal) : null;
    }
    if (c && c.a >= 0.9) found = { kind: 'solid', hex: c.hex, v: c.v || '' };
    else if (c && c.a < 0.9 && c.a > 0.05) found = { kind: 'picture' };     // see-through: what shows through is unknown
    else if (!c && !/^\s*(none|inherit|initial|unset|transparent)\s*$/i.test(v)) found = { kind: 'picture' };
  });
  return found;
}

/* which brand colour a solid ground is ('theme' | 'accent' | ''): written as its variable, or as its very value */
function brandOf(g, pal) {
  if (!g || g.kind !== 'solid') return '';
  if (g.v === '--theme-color' || (!g.v && g.hex === pal.theme)) return 'theme';
  if (g.v === '--accent-color' || (!g.v && g.hex === pal.accent)) return 'accent';
  return '';
}
/* a brand-coloured ground becomes the page's readable button ground (var(--rv-theme-fill)), its borders with it */
function toFill(rule, which, pal) {
  var name = '--' + which + '-color', fillVar = 'var(--rv-' + which + '-fill,var(' + name + '))', done = false;
  rule.each(function (d) {
    if (d.type !== 'decl') return;
    var p = d.prop.toLowerCase(), v = String(d.value);
    if (!/^(background|background-color|border|border-color|border-(top|right|bottom|left)(-color)?)$/.test(p) || v.indexOf('--rv-' + which + '-fill') !== -1) return;
    if (v.indexOf('var(' + name + ')') !== -1) { d.value = v.split('var(' + name + ')').join(fillVar); done = true; return; }
    var c = /^(background|background-color)$/.test(p) ? parseColour(v) : null;
    if (c && c.a >= 0.995 && c.hex === pal[which]) { d.value = fillVar; done = true; }
  });
  return done;
}

/* large text (WCAG: 24px, or 18.66px bold) needs 3:1. { px, bold } as the rule writes them (null where it does not). */
function typeOf(rule) {
  var t = { px: null, bold: null };
  rule.each(function (d) {
    if (d.type !== 'decl') return;
    var p = d.prop.toLowerCase(), v = String(d.value).trim().toLowerCase(), m;
    if (p === 'font-size') {
      var low = (m = /^clamp\(\s*([^,]+),/.exec(v)) ? m[1].trim() : v;
      if ((m = /^([\d.]+)px$/.exec(low))) t.px = +m[1];
      else if ((m = /^([\d.]+)rem$/.exec(low))) t.px = +m[1] * 16;
    }
    if (p === 'font-weight') t.bold = v === 'bold' || v === 'bolder' || +v >= 700;
  });
  return t;
}
/* a rule that writes no size of its own takes it from the rule for what it sits in, where the sheet says so
   (".x-title span" inside ".x-title"); anything whose size is still not known is taken as normal text */
function isLarge(rule, all) {
  var t = typeOf(rule);
  if (t.px == null || t.bold == null) {
    var sel = rule.selectors.length === 1 ? rule.selectors[0].trim() : '', best = null;
    if (sel) all.forEach(function (r) {
      if (r === rule || r.selectors.length !== 1) return;
      var outer = r.selectors[0].trim();
      if (sel.indexOf(outer + ' ') !== 0 && sel.indexOf(outer + '>') !== 0 && sel.indexOf(outer + ' >') !== 0) return;
      if (!best || outer.length > best.sel.length) best = { sel: outer, type: typeOf(r) };
    });
    if (best) { if (t.px == null) t.px = best.type.px; if (t.bold == null) t.bold = best.type.bold; }
  }
  return t.px != null && (t.px >= 24 || (t.px >= 18.66 && t.bold === true));
}
/* what colours an icon (an svg drawn in currentColor), not words: not text, not measured as text */
var ICON = /(^|[\s>+~])(svg|path|i)(?=$|[\s.:\[])|[.#](?:[\w-]*[-_])?(icon|ico|svg|arrow|chevron)s?(?=$|[-_\s.:\[])/i;

var STATE = /:(hover|focus|focus-visible|focus-within|active|visited|disabled|checked)\b|::?(placeholder|selection|before|after|marker)\b/i;
function rootSelector(sel, id) {
  var s = sel.trim(), pre = '[data-rv-section="' + id + '"]';
  return s.indexOf(pre) === 0 && /^(?:[.#][\w-]+|\[[^\]]*\])*$/.test(s.slice(pre.length));
}

function guardCss(css, sectionId, pal) {
  var text = String(css == null ? '' : css);
  if (!text.trim() || !pal || !pal.bg) return text;
  var root;
  try { root = postcss.parse(text); } catch (e) { return text; }
  var id = String(sectionId || '').replace(/[^A-Za-z0-9_-]/g, '');
  var rules = [];
  root.walkRules(function (rule) {
    if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    rules.push(rule);
  });

  /* the section's ground: its root's own, else the page's (its ground and its panels) */
  var sectionGround = null, known = true;
  rules.forEach(function (rule) {
    if (!rule.selectors.some(function (s) { return rootSelector(s, id); })) return;
    var g = groundOf(rule, pal);
    if (!g) return;
    if (g.kind === 'picture') known = false;
    else sectionGround = g;
  });
  var pageGrounds = [pal.bg, pal.surface || pal.bg];
  /* a band in the brand colour is measured on the page's readable button ground, which it becomes if its words need it */
  var band = brandOf(sectionGround, pal), bandFill = band ? (pal.vars['--rv-' + band + '-fill'] || sectionGround.hex) : '';
  var grounds = band ? [bandFill] : sectionGround ? (sectionGround.hex === pal.bg || sectionGround.hex === pal.surface ? pageGrounds : [sectionGround.hex]) : pageGrounds;
  var tone = dark(grounds[0]);
  /* anything inside painting a picture or a ground of the other tone: the words could be on either. A button or
     badge in the brand colour does not count: its own words are measured on it. */
  var mixed = !known || rules.some(function (rule) {
    if (rule.selectors.some(function (s) { return rootSelector(s, id); })) return false;
    var g = groundOf(rule, pal);
    return g && !brandOf(g, pal) && (g.kind === 'picture' || dark(g.hex) !== tone);
  });
  var bandNeedsFill = false;

  var changed = false;
  rules.forEach(function (rule) {
    if (STATE.test(rule.selector)) return;
    var colourDecl = null;
    rule.each(function (d) { if (d.type === 'decl' && d.prop.toLowerCase() === 'color') colourDecl = d; });
    if (!colourDecl) return;
    var own = groundOf(rule, pal);
    if (own && own.kind === 'picture') return;
    var on = own ? [own.hex] : (mixed ? null : grounds);
    if (!on) return;
    var fg = resolve(colourDecl.value, pal);
    if (!fg) return;
    var need = isLarge(rule, rules) ? 3 : 4.5;
    var worst = Math.min.apply(null, on.map(function (g) { return rvTheme.contrast(blend(fg, g), g); }));
    /* words on a brand-coloured band that read on its readable ground but not on the raw colour: the band takes that ground */
    if (!own && band && bandFill !== sectionGround.hex && worst >= need && rvTheme.contrast(blend(fg, sectionGround.hex), sectionGround.hex) < need) bandNeedsFill = true;
    if (worst >= need) return;

    /* a brand-coloured ground (a button): the page's readable button ground and words */
    var which = brandOf(own, pal);
    if (which) {
      toFill(rule, which, pal);
      if (!/var\(\s*--rv-on-/.test(colourDecl.value)) colourDecl.value = 'var(--rv-on-' + which + ',' + (!fg.v && fg.a >= 0.995 ? String(colourDecl.value).trim() : rvTheme.inkOn(own.hex)) + ')';
      changed = true;
      return;
    }

    if (worst < 1.6) return;                                    // meant for another ground
    var last = rule.selectors.map(function (x) { return x.trim().split(/\s*[\s>+~]\s*/).pop(); });
    if (last.every(function (x) { return ICON.test(' ' + x); })) return;
    /* the brand colour as text on the page and its panels */
    if (!own && (fg.v === '--theme-color' || fg.v === '--accent-color') && /^\s*var\(\s*--(theme|accent)-color\s*\)\s*$/i.test(colourDecl.value)) {
      var w = fg.v === '--theme-color' ? 'theme' : 'accent';
      colourDecl.value = 'var(--rv-' + w + '-ink,var(' + fg.v + '))';
      changed = true;
      return;
    }
    /* a fixed colour: towards black or white until it reads; one of the page's own variables is left to the
       palette (readingVars) */
    if (fg.v) return;
    var fixed = rvTheme.readableOn(blend(fg, on[0]), on, need + 0.05);
    if (!fixed || fixed === fg.hex) return;
    colourDecl.value = fixed;          /* postcss keeps an !important apart (decl.important), so it stays */
    changed = true;
  });
  if (bandNeedsFill) rules.forEach(function (rule) {
    if (rule.selectors.some(function (x) { return rootSelector(x, id); }) && brandOf(groundOf(rule, pal), pal) === band && toFill(rule, band, pal)) changed = true;
  });
  return changed ? root.toString() : text;
}

/* ---------- zoom ---------- */
function viewportContent(content) {
  var parts = String(content == null ? '' : content).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var kept = parts.filter(function (p) {
    var m = /^([\w-]+)\s*=\s*(.*)$/.exec(p);
    if (!m) return true;
    var k = m[1].toLowerCase(), v = m[2].trim().toLowerCase();
    if (k === 'user-scalable') return !(v === 'no' || v === '0');
    if (k === 'maximum-scale') return parseFloat(v) >= 5;
    return true;
  });
  return kept.join(', ');
}

/* ---------- the outline of headings ----------
   headings: [{ level: 1..6 (the tag's, or an author's own aria-level), inTemplate: boolean }] in page order.
   Returns for each the level it is announced at: a heading never more than one level below the one it follows
   (an h4 straight after an h2 is announced as a level-3 heading), with siblings kept level with each other (two
   h5s in a row after an h2 are both level 3). The first heading keeps its own level. A heading inside a <template>
   (a speaker card the page repeats from data) takes the level it would have where it stands, and does not move
   the outline itself. Nothing visible changes: the tag and its styling stay, only aria-level is written. */
function headingLevels(headings) {
  var stack = [];   // [{ orig, level }]
  return headings.map(function (h) {
    var orig = h.level, s = stack.slice();
    while (s.length && s[s.length - 1].orig >= orig) s.pop();
    var level = s.length ? Math.min(orig, s[s.length - 1].level + 1) : (stack.length ? Math.min(orig, stack[0].level) : orig);
    if (!h.inTemplate) { s.push({ orig: orig, level: level }); stack = s; }
    return { orig: orig, level: level };
  });
}

/* =====================================================================================================
   THE PAGE PASS — pagePass(html, opts, kit) -> html
   Run by lib/api.js on every page publishTransform writes (live and preview), and on a page published before
   this pass existed when /e/<id> serves it (handlePublicPage), so no owner has to publish again for it.
     opts = { mode: 'live' | 'preview', event: the event document, templateId,
              report: an object the pass fills in ({ shareCard: share-card.js planOf's answer }), optional }
     kit  = the transform's tokenizer: { tokenizeHtml, attrOf, attrValue, classListOf, writeTag, setAttr, dropAttr,
            elementEnd } (lib/api.js) — the same rules: whole tags it has matched, text it writes itself.
   In order:
     1. zoom: the viewport meta allows it (viewportContent);
     2. an AI-designed site: its reading colours on <body> (readingVars) and every section's text colours held
        to AA where their ground is known (guardCss);
     3. a picture without alt text gets alt="" (it is read as a file name otherwise; the editor's own alt text,
        and the alt the live data writes for a speaker's photo, are left as they are);
     4. the outline of headings: aria-level where a heading skips a level (headingLevels; marked data-rv-level);
     5. a page with no main landmark: <main data-rv-main id="rv-main"> around its sections, between the top bar
        and the footer (not on an imported page, which keeps its own structure); a "Skip to main content" link
        first in <body>, to the main landmark (theirs or ours), so a keyboard user does not tab through the whole
        top bar first (et-runtime.js moves the focus there) — on an imported page its main's tags are never
        changed: the link goes to its id, or to a place of ours just before it; a page with no h1 (the event's name only in its logo picture) gets one, visually hidden,
        at the top of its hero — never an imported page;
     6. search and sharing: the schema.org Event (site-seo.js), a picture for link previews when the owner set
        none — the share card made for this very page (share-card.js: the banner's background with the logo unit
        on it, its size and alt text given, first in the Event's pictures) once the event's record holds it, else
        shareCandidates: the banner video's still, the hero's picture, a picture of the page's own, the
        logo unit, the portal's logo; opts.report.shareCard says what the card needs (share-card.js planOf),
        so that lib/api.js can have it made — a description that ends at a word (site-seo.js shareDescription — a page
        published before is cut the same way), and on a live page robots "max-image-preview:large". Each tag
        carries data-rv-seo and is written afresh every run;
     7. the words of the ET top bar a visitor cannot read: "About Vertical" names the portal (et-nav.js aboutLabel)
        on a page built before the bar said so;
     8. a contact's e-mail and phone shown as plain text become links (mailto:, tel:), and on an AI-designed site a
        play glyph that plays nothing is not shown (visitorLinks) — never on an imported page.
   What 5 and 8 add to <head> and the top of <body> (the skip link, the hidden h1, their rules) carries
   data-rv-a11y and is written afresh every run; what 8 does in the page is seen on the next run and kept.
   Any failure leaves the page exactly as it came: a page is never lost to this pass. */
var siteSeo = require('./site-seo');
var shareCard = require('./share-card');
var etFooter = require('./et-footer');
var etNav = require('./et-nav');
var heroVideoCore = require('../../templates/_shared/rv-hero-video-core.js');

/* the skip link, hidden until it has the keyboard's focus, and the visually hidden h1 (data-rv-a11y) */
var A11Y_CSS = '.rv-skip{position:fixed;left:12px;top:-200px;z-index:2147483647;padding:10px 16px;border-radius:8px;background:#ffffff;color:#14161b;' +
  'font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;text-decoration:underline;box-shadow:0 4px 18px rgba(0,0,0,.25)}' +
  '.rv-skip:focus{top:12px;outline:3px solid #14161b;outline-offset:2px}' +
  '.rv-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;' +
  'clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}' +
  '.rv-skip-to{position:absolute;width:1px;height:1px;overflow:hidden}' +
  'main[data-rv-main]:focus,#rv-main:focus{outline:none}';
var MAIN_ID = 'rv-main';
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function pagePass(html, opts, kit) {
  try { return pagePassUnsafe(String(html == null ? '' : html), opts || {}, kit); }
  catch (e) {
    console.error('site-a11y: the page pass failed, page left as it was — ' + (e && e.stack || e));
    return String(html == null ? '' : html);
  }
}

function pagePassUnsafe(html, opts, kit) {
  var tokens = kit.tokenizeHtml(html);
  var out = tokens.map(function (t) { return html.slice(t.s, t.e); });
  var A = kit.attrValue, i, t;
  var headOpen = -1, headClose = -1, bodyOpen = -1;
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    if (t.t === 'open' && t.name === 'head' && headOpen === -1 && bodyOpen === -1) headOpen = i;
    if (t.t === 'close' && t.name === 'head' && headClose === -1 && bodyOpen === -1) headClose = i;
    if (t.t === 'open' && t.name === 'body' && bodyOpen === -1) bodyOpen = i;
  }
  var bodyTag = bodyOpen !== -1 ? tokens[bodyOpen] : null;
  var bodyTemplate = bodyTag ? (A(bodyTag, 'data-rv-template-id') || '') : '';
  var templateId = String(opts.templateId || bodyTemplate || '');
  var generated = /^gen-/.test(templateId) || /^gen-/.test(bodyTemplate) || (bodyTag && kit.classListOf(bodyTag).indexOf('rv-generated') !== -1);
  var imported = /^imported-/.test(templateId) || /^imported-/.test(bodyTemplate) || (bodyTag && A(bodyTag, 'id') === 'imported');
  function rewrite(idx) { out[idx] = kit.writeTag(tokens[idx]); }

  /* our own head tags from an earlier run go: they are written again below */
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    if (t.t === 'open' && (kit.attrOf(t, 'data-rv-seo') || kit.attrOf(t, 'data-rv-a11y'))) {
      var end = kit.elementEnd(tokens, i);
      if (end === -1) continue;
      for (var k = i; k <= end; k++) out[k] = '';
      if (tokens[end + 1] && tokens[end + 1].t === 'text' && out[end + 1].charAt(0) === '\n') out[end + 1] = out[end + 1].slice(1);
      i = end;
    }
  }

  /* ---- 1. zoom ---- */
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    if (t.t !== 'open' || t.name !== 'meta' || String(A(t, 'name') || '').toLowerCase() !== 'viewport') continue;
    var content = A(t, 'content');
    if (content == null) continue;
    var fixed = viewportContent(content.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    if (fixed !== content) { kit.setAttr(t, 'content', fixed); rewrite(i); }
  }

  /* ---- 2. an AI-designed site's colours ---- */
  if (generated && bodyTag) {
    var style = A(bodyTag, 'style');
    if (style != null) {
      var plain = style.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      var withVars = readingVars(plain);
      if (withVars !== plain) { kit.setAttr(bodyTag, 'style', withVars); rewrite(bodyOpen); }
      var pal = palette(withVars);
      for (i = 0; i < tokens.length - 1; i++) {
        t = tokens[i];
        var sheetId = t.t === 'open' && t.name === 'style' ? A(t, 'data-rv-style') : null;
        if (sheetId == null || out[i] === '' || tokens[i + 1].t !== 'raw') continue;
        out[i + 1] = guardCss(out[i + 1], sheetId, pal);
      }
    }
  }

  /* where a page with no h1 gets one: the top of its hero (the event's name, visually hidden) */
  var h1Name = !imported && opts.event && typeof opts.event.name === 'string' ? opts.event.name.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  var h1At = h1Name ? hiddenH1Place(tokens, out, kit) : -1;

  /* ---- 3. pictures without alt text; 4. the outline of headings ---- */
  var headings = [], templateDepth = 0;
  for (i = 0; i < tokens.length; i++) {
    /* the hidden h1 opens the outline where it goes */
    if (i === h1At) headings.push({ virtual: true, level: 1, tagLevel: 1, inTemplate: false });
    t = tokens[i];
    if (t.t === 'close' && t.name === 'template') { templateDepth = Math.max(0, templateDepth - 1); continue; }
    if (t.t !== 'open' || out[i] === '') continue;
    if (t.name === 'template' && !t.selfClosing) { templateDepth++; continue; }
    if (t.name === 'img' && !kit.attrOf(t, 'alt') && !kit.attrOf(t, 'aria-label') && !kit.attrOf(t, 'aria-labelledby')) {
      kit.setAttr(t, 'alt', ''); rewrite(i);
      continue;
    }
    var hm = /^h([1-6])$/.exec(t.name);
    if (!hm) continue;
    var role = String(A(t, 'role') || '').toLowerCase();
    if (role && role !== 'heading') continue;
    var ours = !!kit.attrOf(t, 'data-rv-level'), own = parseInt(A(t, 'aria-level'), 10);
    headings.push({ i: i, level: !ours && own >= 1 && own <= 9 ? own : +hm[1], tagLevel: +hm[1], ours: ours, authored: !ours && own >= 1, inTemplate: templateDepth > 0 });
  }
  headingLevels(headings).forEach(function (r, n) {
    var h = headings[n], tk = tokens[h.i];
    if (h.virtual || h.authored) return;                     // an author's own aria-level is theirs
    if (r.level !== h.tagLevel) {
      if (A(tk, 'aria-level') !== String(r.level) || !h.ours) { kit.setAttr(tk, 'aria-level', String(r.level)); kit.setAttr(tk, 'data-rv-level', ''); rewrite(h.i); }
    } else if (h.ours) { kit.dropAttr(tk, 'aria-level'); kit.dropAttr(tk, 'data-rv-level'); rewrite(h.i); }
  });

  /* ---- 5. the main landmark, the skip link to it ---- */
  var mainId = '';
  var hasMain = tokens.some(function (x, n) { return x.t === 'open' && out[n] !== '' && (x.name === 'main' || String(A(x, 'role') || '').toLowerCase() === 'main'); });
  if (!hasMain && !imported) {
    for (i = 0; i < tokens.length; i++) {
      t = tokens[i];
      if (t.t !== 'open' || t.name !== 'div') continue;
      var cls = kit.classListOf(t);
      if (cls.indexOf('col-md-12') === -1 || cls.indexOf('no-padding') === -1) continue;
      var close = kit.elementEnd(tokens, i);
      if (close === -1) break;
      var first = -1, footer = -1;
      for (var c = i + 1; c < close; c++) {
        var ch = tokens[c];
        if (ch.t !== 'open') continue;
        var chEnd = kit.elementEnd(tokens, c);
        var sec = A(ch, 'data-rv-section'), chId = A(ch, 'id');
        var isNav = ch.name === 'header' || sec === 'nav' || chId === 'nav';
        var isFooter = ch.name === 'footer' || sec === 'footer' || chId === 'footer';
        if (isFooter && footer === -1 && first !== -1) footer = c;
        else if (first === -1 && !isNav && ch.name !== 'style' && ch.name !== 'script' && ch.name !== 'template') first = c;
        if (chEnd === -1) break;
        c = chEnd;
      }
      if (first !== -1) {
        out[first] = '<main data-rv-main id="' + MAIN_ID + '" tabindex="-1">' + out[first];
        if (footer !== -1) out[footer] = '</main>' + out[footer];
        else out[close] = '</main>' + out[close];
        mainId = MAIN_ID;
      }
      break;
    }
  }
  /* the page's own main landmark (or ours from an earlier run): the skip link's target, by its id. An imported
     page keeps its tags as they came: a main of its own with no id gets a place for the link to go to just
     before it (out of the flow, so nothing in its layout moves), written afresh every run like the link */
  for (i = 0; i < tokens.length && hasMain; i++) {
    t = tokens[i];
    if (t.t !== 'open' || out[i] === '' || !(t.name === 'main' || String(A(t, 'role') || '').toLowerCase() === 'main')) continue;
    mainId = A(t, 'id') || '';
    if (!mainId && imported) {
      mainId = MAIN_ID;
      out[i] = '<span class="rv-skip-to" id="' + MAIN_ID + '" tabindex="-1" data-rv-a11y></span>' + out[i];
    } else if (!mainId) {
      mainId = MAIN_ID;
      kit.setAttr(t, 'id', MAIN_ID);
      if (A(t, 'tabindex') == null) kit.setAttr(t, 'tabindex', '-1');
      rewrite(i);
    }
    break;
  }
  var a11yCss = false;
  if (mainId && bodyOpen !== -1 && /^[A-Za-z][\w:.-]*$/.test(mainId)) {
    out[bodyOpen] += '<a class="rv-skip" href="#' + escAttr(mainId) + '" data-rv-a11y>Skip to main content</a>\n';
    a11yCss = true;
  }

  /* ---- 6. search and sharing ---- */
  var head = [];
  var event = opts.event || {};
  var canonical = '', ogImage = '', twitterCard = -1, description = '', title = '';
  function decode(s) { return String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    if (out[i] === '') continue;
    if (t.t === 'open' && t.name === 'link' && /(^|\s)canonical(\s|$)/i.test(A(t, 'rel') || '')) canonical = A(t, 'href') || '';
    if (t.t === 'open' && t.name === 'meta') {
      var prop = String(A(t, 'property') || '').toLowerCase(), nm = String(A(t, 'name') || '').toLowerCase();
      if (prop === 'og:image') ogImage = A(t, 'content') || '';
      if (nm === 'twitter:card') twitterCard = i;
      /* a description published before it was cut at a word ("…with governe") is cut at one now */
      if (nm === 'description' || prop === 'og:description' || nm === 'twitter:description') {
        var said = decode(A(t, 'content') || ''), cut = siteSeo.shareDescription(said);
        if (cut !== said) { kit.setAttr(t, 'content', cut); rewrite(i); }
      }
      if (nm === 'description') description = A(t, 'content') || '';
      if (prop === 'og:title') title = A(t, 'content') || '';
    }
  }
  var originOf = /^(https?:\/\/[^\/\s"'<>]+)/.exec(decode(canonical));
  function absolute(u) {
    u = decode(u).trim();
    if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
    if (/^\/(?!\/)[^\s"'<>]*$/.test(u) && originOf) return originOf[1] + u;
    return '';
  }
  var portalSlug = portalOfPage(tokens, kit);
  var share = shareCandidates(tokens, out, kit, event, portalSlug);
  var pictures = share.pictures.map(absolute).filter(Boolean);
  /* The share card (share-card.js): the banner's background with the logo unit centred on it, made on the server
     from what this page shows. When the record on the event holds the card for exactly this page, it is the link
     preview; until then (or when there is nothing to make one from) the picture chosen as before. The owner's own
     share picture (ogImage, written by publishTransform) always wins. What the plan found is handed back in
     opts.report, so lib/api.js can have a missing card made. */
  var card = shareCard.planOf(tokens, out, kit, { event: event, imported: imported, absolute: absolute, own: !!ogImage, html: html });
  if (opts.report && typeof opts.report === 'object') opts.report.shareCard = card;
  var useCard = !ogImage && card.fresh && card.card;
  var shareImage = useCard ? card.card.url : pictures[0] || share.logos.map(absolute).filter(Boolean)[0] || '';
  if (!ogImage && shareImage) {
    head.push('<meta property="og:image" content="' + escAttr(shareImage) + '" data-rv-seo>');
    if (useCard) {
      /* its size and words, so a preview lays it out before it has loaded it, and a screen reader can say it */
      var alt = decode(title) || (typeof event.name === 'string' ? event.name.replace(/\s+/g, ' ').trim() : '');
      head.push('<meta property="og:image:type" content="image/jpeg" data-rv-seo>');
      head.push('<meta property="og:image:width" content="' + card.card.width + '" data-rv-seo>');
      head.push('<meta property="og:image:height" content="' + card.card.height + '" data-rv-seo>');
      if (alt) head.push('<meta property="og:image:alt" content="' + escAttr(alt) + '" data-rv-seo>');
    }
    head.push('<meta name="twitter:image" content="' + escAttr(shareImage) + '" data-rv-seo>');
    if (useCard && alt) head.push('<meta name="twitter:image:alt" content="' + escAttr(alt) + '" data-rv-seo>');
    /* a picture fills the large card; a logo (a wordmark, a lock-up) is shown small, never cropped across it */
    if ((useCard || pictures.length) && twitterCard !== -1 && A(tokens[twitterCard], 'content') !== 'summary_large_image') { kit.setAttr(tokens[twitterCard], 'content', 'summary_large_image'); rewrite(twitterCard); }
  }
  if (useCard) pictures = [card.card.url].concat(pictures);
  var footerSlug = '';
  tokens.some(function (x) { if (x.t === 'open' && x.name === 'footer' && A(x, 'data-rv-et-footer')) { footerSlug = A(x, 'data-rv-et-footer'); return true; } return false; });
  var portal = footerSlug && footerSlug !== 'et' && etFooter.isKnown && etFooter.isKnown(footerSlug) ? etFooter.info(footerSlug) : null;
  var ld = siteSeo.eventJsonLd(event, {
    name: decode(title) || event.name, description: decode(description), url: decode(canonical),
    images: ogImage ? [absolute(ogImage)].concat(pictures).filter(function (u, n, a) { return u && a.indexOf(u) === n; }) : pictures,
    organizer: portal ? { name: portal.site, url: portal.home } : null
  });
  if (ld) head.push('<script type="application/ld+json" data-rv-seo>' + siteSeo.scriptJson(ld) + '</script>');
  if (opts.mode === 'live') head.push('<meta name="robots" content="index, follow, max-image-preview:large" data-rv-seo>');

  /* ---- 7. "About Vertical" in the ET top bar says whose ---- */
  for (i = 0; i + 2 < tokens.length; i++) {
    t = tokens[i];
    if (t.t !== 'open' || t.name !== 'a' || out[i] === '' || A(t, 'href') !== '#about-vertical') continue;
    var words = tokens[i + 1], shut = tokens[i + 2];
    if (words.t !== 'text' || shut.t !== 'close' || shut.name !== 'a' || !etNav.ABOUT_VERTICAL.test(decode(out[i + 1]).replace(/\s+/g, ' ').trim())) continue;
    out[i + 1] = escText(etNav.aboutLabel(portalSlug));
  }

  /* ---- 8. a contact's e-mail and phone are links; a play glyph that plays nothing is not shown ---- */
  var extraCss = imported ? '' : visitorLinks(html, tokens, out, kit, generated);

  /* the hidden h1, last: nothing above writes its hero's tag again after it */
  if (h1At !== -1) {
    out[h1At] += '<h1 class="rv-sr-only" data-rv-a11y>' + escText(h1Name) + '</h1>\n';
    a11yCss = true;
  }
  if (a11yCss || extraCss) head.unshift('<style data-rv-a11y>' + (a11yCss ? A11Y_CSS : '') + extraCss + '</style>');

  var headText = head.length ? head.join('\n') + '\n' : '';
  if (headText) {
    if (headClose !== -1) out[headClose] = headText + out[headClose];
    else if (bodyOpen !== -1) out[bodyOpen] = headText + out[bodyOpen];
    /* not a whole page (no <head>, no <body>): nothing to put tags in */
  }
  return out.join('');
}

/* the pictures a link preview can use, best first: the banner picture of a template, the hero's own picture
   (an AI-designed site paints it in its stylesheet), the poster of the hero's video */
function heroPictures(tokens, out, kit) {
  var A = kit.attrValue, banner = [], painted = [], posters = [];
  function add(list, u) { u = String(u || '').trim(); if (u && !/\.svg(\?|#|$)/i.test(u)) list.push(u); }
  var inHero = -1;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (out[i] === '') continue;
    if (inHero !== -1 && i > inHero) inHero = -1;
    if (t.t !== 'open') continue;
    if (t.name === 'img' && kit.classListOf(t).indexOf('banner-bg-image') !== -1) add(banner, A(t, 'src'));
    if (inHero === -1 && (A(t, 'data-rv-section') === 'hero' || A(t, 'id') === 'hero' || A(t, 'id') === 'banner')) inHero = kit.elementEnd(tokens, i);
    if (inHero !== -1 && t.name === 'video') add(posters, A(t, 'poster'));
    if (t.name === 'style' && A(t, 'data-rv-style') === 'hero' && tokens[i + 1] && tokens[i + 1].t === 'raw') {
      var re = /background(?:-image)?\s*:[^;}]*url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, m;
      while ((m = re.exec(out[i + 1]))) add(painted, m[2]);
    }
  }
  return banner.concat(painted, posters).filter(function (u, n, all) { return all.indexOf(u) === n; });
}

/* The pictures a link preview may use when the owner set none, best first (UX-148: a site whose hero is a video
   was shared with no picture at all). { pictures: [photos], logos: [lock-ups and wordmarks] }:
     the banner video's still (the event's own video, put on the page as it is served), the hero's pictures
     (heroPictures), then the first picture of the page's own (contentPicture) — then, only when there is no
     picture, the logo unit and the portal's wordmark. The logo unit is a transparent picture: a preview shows it on
     whatever ground it likes (black on LinkedIn), so a photograph of the page comes before it. */
function shareCandidates(tokens, out, kit, event, portalSlug) {
  var A = kit.attrValue, pictures = [], logos = [];
  var hv = heroVideoCore.clean(event && event.heroVideo);
  if (hv && hv.posterUrl) pictures.push(hv.posterUrl);
  pictures = pictures.concat(heroPictures(tokens, out, kit));
  var own = contentPicture(tokens, out, kit);
  if (own) pictures.push(own);
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t !== 'open' || out[i] === '' || t.name !== 'img' || kit.classListOf(t).indexOf('rv-lu-img') === -1) continue;
    var src = String(A(t, 'src') || '').trim();
    if (src && !/\.svg(\?|#|$)/i.test(src) && !/^data:/i.test(src)) { logos.push(src); break; }
  }
  var wordmark = portalSlug ? etNav.logoOf(portalSlug, 'light').onLight : '';
  if (/^\/templates\/_shared\/img\/portals\/[a-z0-9-]+\.png$/.test(wordmark)) logos.push(wordmark);
  return { pictures: pictures.filter(function (u, n, all) { return all.indexOf(u) === n; }), logos: logos };
}

/* The first picture of the page's own that can stand for it in a preview: outside the hero (already counted), the
   top bar, the footer and the partners' rows (their logos), not a logo, an icon or a record's photo (a speaker's
   face), not an SVG, not an empty placeholder and not a thumbnail. A gallery photo (a glimpse) may be one. */
function contentPicture(tokens, out, kit) {
  var A = kit.attrValue, skipTo = -1;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (i <= skipTo || t.t !== 'open' || out[i] === '') continue;
    var sec = String(A(t, 'data-rv-section') || ''), id = String(A(t, 'id') || '');
    var away = (t.name === 'template' && !t.selfClosing) || /^(header|footer|nav)$/.test(t.name) || /^(nav|header|footer|hero)$/.test(sec) ||
      id === 'hero' || id === 'banner' || /partner|sponsor|logo|client|exhibitor/i.test(sec + ' ' + id);
    if (away) { var end = kit.elementEnd(tokens, i); if (end !== -1) skipTo = end; continue; }
    if (t.name !== 'img') continue;
    var src = String(A(t, 'src') || '').trim(), field = A(t, 'data-rv-field');
    if (!/^(https?:\/\/|\/(?!\/))/i.test(src) || /\.svg(\?|#|$)/i.test(src)) continue;
    if (kit.attrOf(t, 'data-rv-et-logo') || kit.attrOf(t, 'data-rv-logo') || (field != null && field !== 'imageUrl')) continue;
    if (/logo|icon|avatar|badge|flag/i.test(String(A(t, 'class') || '') + ' ' + String(A(t, 'alt') || '') + ' ' + src.split('?')[0].split('/').pop())) continue;
    var w = parseInt(A(t, 'width'), 10), h = parseInt(A(t, 'height'), 10);
    if ((w > 0 && w < 300) || (h > 0 && h < 160)) continue;
    return src;
  }
  return '';
}

/* the ET portal the page belongs to: its common footer's (et-footer.js), else its top bar's wordmark (et-nav.js) */
function portalOfPage(tokens, kit) {
  var A = kit.attrValue, slug = '';
  for (var i = 0; i < tokens.length && !slug; i++) {
    var t = tokens[i];
    if (t.t !== 'open') continue;
    var f = t.name === 'footer' ? A(t, 'data-rv-et-footer') : null;
    if (f && f !== 'et') slug = f;
    var m = t.name === 'img' && kit.attrOf(t, 'data-rv-et-logo') ? /^\/templates\/_shared\/img\/portals\/([a-z0-9-]+?)(?:-light)?\.png$/.exec(String(A(t, 'data-rv-on-light') || A(t, 'src') || '').split('?')[0]) : null;
    if (m) slug = m[1];
  }
  return slug;
}

/* where the hidden h1 goes on a page that has none: right inside its hero (or banner); -1 when the page has an
   h1 (outside a <template>) or no hero */
function hiddenH1Place(tokens, out, kit) {
  var A = kit.attrValue, hero = -1, depth = 0;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t === 'close' && t.name === 'template') { depth = Math.max(0, depth - 1); continue; }
    if (t.t !== 'open' || out[i] === '') continue;
    if (t.name === 'template' && !t.selfClosing) { depth++; continue; }
    if (t.name === 'h1' && !depth) return -1;
    if (hero === -1 && !t.selfClosing && (A(t, 'data-rv-section') === 'hero' || A(t, 'id') === 'hero' || A(t, 'id') === 'banner')) hero = i;
  }
  return hero;
}

/* Step 8 of the page pass, on every page but an imported one (which keeps its own structure):
     - a contact's e-mail and phone that the page shows as plain text (<span data-rv-field="email">, as the
       AI-designed contact cards have them) become links, so a phone can tap to write or call (UX-156). The page is
       published with its records already in it, so this is where every page gets them, those published before
       too. The words stay as they were, inside <a href="mailto:…|tel:+…" data-rv-contact>; an e-mail may break
       after its "@" on a narrow screen, where it broke before its last letter ("…@timesinternet.i / n"). Only a
       field outside any link or button and any <template>, holding the one address and nothing else, and not in
       a part the page hides for having no records (data-rv-empty: there the card is the model's sample, "name@
       example.com"); a field done on an earlier run already holds its link and is left as it is.
     - on an AI-designed page, a "play" glyph that plays nothing — a round play badge drawn on a card that has no
       video and is no link (BWS's Knowledge Series) — is not shown: it looked like a video that would not start
       (UX-155). Such a page carries no script of its own, so nothing could ever make it play.
   -> the rules the page then needs, '' when it needs none */
var CONTACT_CSS = 'a[data-rv-contact]{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}' +
  'a[data-rv-contact]:hover{text-decoration-thickness:2px}a[data-rv-contact="email"]{word-break:normal;overflow-wrap:anywhere}';
var INERT_GLYPH_CSS = '[data-rv-inert-glyph]{display:none!important}';
/* what a drawn glyph is made of; anything else inside (words, a picture, a link) makes it more than a glyph */
var GLYPH_PARTS = { svg: 1, path: 1, polygon: 1, polyline: 1, circle: 1, ellipse: 1, rect: 1, line: 1, g: 1, use: 1, title: 1, defs: 1, i: 1, span: 1 };
var NOT_A_GLYPH = /^(a|button|input|select|textarea|summary|label|option|video|audio|iframe|object|embed|img|picture|svg|source|form)$/;

/* the address of a contact's e-mail or phone, as a link: 'mailto:…' | 'tel:+91…' (digits only) | '' when the
   words are not one address (two numbers, "Write to us", a half-written address) or are a sample's
   ("name@example.com", "+00 00000 00000") */
function contactHref(type, value) {
  var v = String(value == null ? '' : value).trim();
  if (type === 'email') {
    var ok = v.length <= 254 && /^[^\s@<>"'&()]+@[^\s@<>"'&()]+\.[^\s@<>"'&()]+$/.test(v) && !/@(.+\.)?example\.[a-z.]+$/i.test(v);
    return ok ? 'mailto:' + v : '';
  }
  if (type !== 'phone' || !/^\+?[\d\s().-]+$/.test(v)) return '';
  var digits = v.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15 && /[1-9]/.test(digits) ? 'tel:' + (v.charAt(0) === '+' ? '+' : '') + digits : '';
}
/* what the page hides while a list has no records (rv-live.css) */
var HIDDEN_EMPTY = ['data-rv-empty', 'data-rv-hidden-empty', 'data-rv-bind-empty', 'data-rv-nav-empty'];
function decodeText(s) { return String(s || '').replace(/&nbsp;|&#160;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

function visitorLinks(html, tokens, out, kit, generated) {
  var A = kit.attrValue, inLink = 0, inTemplate = 0, hiddenTo = -1, contacts = false, glyphs = false;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (out[i] === '') continue;
    if (t.t === 'open' && i > hiddenTo && HIDDEN_EMPTY.some(function (n) { return kit.attrOf(t, n); })) hiddenTo = kit.elementEnd(tokens, i);
    if (t.t === 'close') {
      if (t.name === 'template') inTemplate = Math.max(0, inTemplate - 1);
      else if (t.name === 'a' || t.name === 'button') inLink = Math.max(0, inLink - 1);
      continue;
    }
    if (t.t !== 'open' || t.selfClosing) continue;
    if (t.name === 'template') { inTemplate++; continue; }
    if (t.name === 'a' || t.name === 'button') {
      if (kit.attrOf(t, 'data-rv-contact')) contacts = true;          // made on an earlier run: its rules are written again
      inLink++;
      continue;
    }
    if (inTemplate || inLink) continue;
    var field = A(t, 'data-rv-field');
    if (field === 'email' || field === 'phone') {
      if (i <= hiddenTo || kit.elementEnd(tokens, i) !== i + 2 || tokens[i + 1].t !== 'text') continue;
      var raw = out[i + 1], value = decodeText(raw).trim(), href = contactHref(field, value);
      if (!href) continue;
      var at = field === 'email' ? value.lastIndexOf('@') : -1;
      var shown = at > 0 ? escText(value.slice(0, at + 1)) + '<wbr>' + escText(value.slice(at + 1)) : escText(value);
      out[i + 1] = /^\s*/.exec(raw)[0] + '<a href="' + escAttr(href) + '" data-rv-contact="' + field + '">' + shown + '</a>' + /\s*$/.exec(raw)[0];
      contacts = true;
      continue;
    }
    var marked = !!kit.attrOf(t, 'data-rv-inert-glyph'), inert = generated && inertPlayGlyph(tokens, i, out, kit);
    if (inert === marked) { glyphs = glyphs || inert; continue; }
    /* the tag as the page wrote it, so nothing put before or after it in this pass is lost */
    var was = html.slice(t.s, t.e);
    if (out[i].indexOf(was) === -1) continue;
    if (inert) kit.setAttr(t, 'data-rv-inert-glyph', ''); else kit.dropAttr(t, 'data-rv-inert-glyph');
    out[i] = out[i].replace(was, function () { return kit.writeTag(t); });
    glyphs = glyphs || inert;
  }
  return (contacts ? CONTACT_CSS : '') + (glyphs ? INERT_GLYPH_CSS : '');
}

/* a "play" badge that is only a drawing: a class that says play ("resources-play", "play-btn"; not "display"),
   nothing that makes it a control, and inside it only an SVG or a ▶ character */
function inertPlayGlyph(tokens, i, out, kit) {
  var t = tokens[i];
  if (NOT_A_GLYPH.test(t.name)) return false;
  if (!kit.classListOf(t).some(function (c) { return c.toLowerCase().split(/[-_]+/).indexOf('play') !== -1; })) return false;
  if (['href', 'role', 'tabindex', 'onclick', 'contenteditable', 'data-rv-form', 'data-register-cta'].some(function (n) { return kit.attrOf(t, n); })) return false;
  var end = kit.elementEnd(tokens, i), drawn = false;
  if (end <= i) return false;
  for (var j = i + 1; j < end; j++) {
    var x = tokens[j];
    if (x.t === 'comment') continue;
    if (x.t === 'text') {
      var s = decodeText(out[j]).replace(/&#(9654|9658|x25b6|x25ba);/gi, '\u25b6');
      if (/[^\s\u25b6\u25ba\u23f5\ufe0e\ufe0f]/.test(s)) return false;
      if (/\S/.test(s)) drawn = true;
      continue;
    }
    if ((x.t === 'open' || x.t === 'close') && GLYPH_PARTS[x.name]) { if (x.t === 'open' && x.name === 'svg') drawn = true; continue; }
    return false;
  }
  return drawn;
}

function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

module.exports = { palette: palette, readingVars: readingVars, guardCss: guardCss, viewportContent: viewportContent, headingLevels: headingLevels,
  pagePass: pagePass, heroPictures: heroPictures, shareCandidates: shareCandidates, contentPicture: contentPicture, contactHref: contactHref,
  parseColour: parseColour, resolve: resolve };
