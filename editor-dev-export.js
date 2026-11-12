/* window.RevampDevExport (ES5; loaded before editor-template-ui.js) — the Developer zone's "Copy for another website":
   one section of a site as code that works on its own on a website that is not this one. The owner, 12 Nov 2026:
   "the html, css & js of this sections are not working properly in our another backend. seems like the codes that
   are coming for each sections have issues or incomplete. Need to fix it."

   The Developer zone's own HTML / CSS / JS are for editing the section here: a list of the event's records is the
   one model item it is drawn from, the CSS is only the section's own stylesheet, and the JS is run by this site's
   runtime with `section` handed to it. On another website none of that holds. So this copy carries with it what
   the section takes from the page around it:

   It is made from the page exactly as a visitor gets it: the editor stages the page as it is now (RevampCore.
   previewDraft, as its Preview button does) and loadPage() opens that preview out of sight, with its scripts
   switched off — so the copy has what publishing adds (the theme's readable colours, the colours made to read,
   the phone-width fixes, the heading scale) and nothing a script changed.

     HTML  the section as a visitor sees it — the event's records drawn (speakers, partners, sessions…), every
           picture and link with its full web address, nothing the live page hides (a list with no records). It
           stands in ONE <div id="rv-embed-<section id>" data-rv-embed="<section id>"> that carries what the
           page's <body> gave it: its classes and data-… attributes, the CSS variables the section uses (the
           theme's colours, fonts, radius…, resolved to their values), every inherited text property (font,
           size, line height, colour, alignment, case…) and the page's background. A link to another part of the event's page, and a button that opens one of the
           event's forms, goes to the event's own website (…/e/<event>#register opens the form there); a form
           drawn in the section is a link to it. Google Fonts are <link> tags at the top (a stylesheet link may
           stand in <body>).
     CSS   first a reset: the other website's own rules for plain elements (h2, p, img, section, a…) stop at the
           wrapper — every element of the section is put back to the browser's defaults (all: revert), so only
           the rules below style it. Then every rule of the page that reaches the section or anything in it — the
           section's own, the site's shared rules (gen-base.css, et-platform.css, a template's CSS), inside their
           @media / @supports / @container / @layer — with the @keyframes, @font-face and @property they use.
           Every selector begins with the wrapper's id, so nothing here can restyle the other website, and what a
           selector said about the page around the section (body.rv-generated …, #content > …) is said about the
           wrapper instead, with the same weight: each selector gains exactly one id's worth of specificity, so
           the rules still win over one another as they did on the event's page, and over the other website's.
           rem becomes px (the other website's root font size need not be 16px); url(…) becomes a full address.
           Rules for states that scripts or the visitor set (.rv-in, :hover, :focus…) are kept. Elements the
           runtimes add to a section (a carousel's buttons, "View profile", day tabs…) are left out of the reset:
           their rules come with the runtime.
     JS    one script, put after the HTML: it loads this site's runtime from EventSphere (et-runtime.js: carousels,
           easing in, accordions, day tabs…), the section's widget scripts and, where the section has speakers' or
           sponsors' cards or photos, rv-popups.js (their pages on EventSphere, photos large) — each once, however
           many sections a page takes — and then runs what was written under JS for the section, with `section`
           as its element. It waits for the HTML when the other website adds it later.

   RevampDevExport.loadPage(url) -> Promise<iframe>
     the page at url, out of sight in this window, its scripts off, once its fonts are in. The caller removes it.
   RevampDevExport.build({ doc, win, section, pageUrl, sectionName, eventName })
     doc, win   that page's document and window (the section's styles and theme are read from them)
     section    the section's element in it
     pageUrl    the event's public page (RevampCore.publicUrl)
   -> { id, html, css, js, all, page, records, hidden, forms, ownJs, notes: [text] }
     all    the three as one block (fonts, <style>, the HTML, <script>), for a website that takes one HTML field
     page   a whole test page holding that block, to open in a browser

   RevampDevExport._test holds the pure helpers (functions/lib/editor-dev-export.test.js). */
(function (root) {
  'use strict';

  var EMBED = 'data-rv-embed';
  /* the wrapper's id: what every selector begins with */
  function scopeId(id) { return 'rv-embed-' + (String(id || 'section').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'section'); }

  /* ---------- reading selectors ---------- */

  /* text split at `ch` where it is not inside (), [] or a string */
  function splitTop(text, ch) {
    var out = [], cur = '', depth = 0, quote = '', i, c;
    text = String(text || '');
    for (i = 0; i < text.length; i++) {
      c = text.charAt(i);
      if (quote) {
        cur += c;
        if (c === '\\' && i + 1 < text.length) cur += text.charAt(++i);
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '\\' && i + 1 < text.length) { cur += c + text.charAt(++i); continue; }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      if (c === ch && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* a complex selector as its compounds and the combinators between them:
     "body.x > .a .b" -> { parts: ["body.x", ".a", ".b"], combs: [">", " "] } */
  function compoundsOf(sel) {
    var parts = [], combs = [], cur = '', depth = 0, quote = '', pending = null, i, c;
    sel = String(sel || '').trim();
    for (i = 0; i < sel.length; i++) {
      c = sel.charAt(i);
      if (quote) {
        cur += c;
        if (c === '\\' && i + 1 < sel.length) cur += sel.charAt(++i);
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '\\' && i + 1 < sel.length) { cur += c + sel.charAt(++i); continue; }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (depth === 0 && (/\s/.test(c) || c === '>' || c === '+' || c === '~')) {
        if (cur) { parts.push(cur); cur = ''; pending = ' '; }
        if (!/\s/.test(c)) pending = c;
        continue;
      }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      if (pending !== null) { if (parts.length) combs.push(pending); pending = null; }
      cur += c;
    }
    if (cur) parts.push(cur);
    return { parts: parts, combs: combs };
  }
  function joinCompounds(parts, combs) {
    var out = parts[0] || '';
    for (var i = 1; i < parts.length; i++) out += (combs[i - 1] === ' ' ? ' ' : ' ' + combs[i - 1] + ' ') + parts[i];
    return out;
  }

  /* the simple selectors of one compound: "div.x[y]:not(.z)::before" -> ["div", ".x", "[y]", ":not(.z)", "::before"] */
  function simplesOf(compound) {
    var out = [], s = String(compound || ''), i = 0, start, depth, c, q;
    while (i < s.length) {
      start = i; c = s.charAt(i);
      if (c === '[') {
        depth = 0;
        for (; i < s.length; i++) {
          c = s.charAt(i);
          if (c === '\\') { i++; continue; }
          if (c === '"' || c === "'") { q = c; for (i++; i < s.length && s.charAt(i) !== q; i++) if (s.charAt(i) === '\\') i++; continue; }
          if (c === '[') depth++;
          else if (c === ']') { depth--; if (!depth) { i++; break; } }
        }
      } else if (c === ':') {
        i++;
        if (s.charAt(i) === ':') i++;
        while (i < s.length && /[\w-]/.test(s.charAt(i))) i++;
        if (s.charAt(i) === '(') {
          depth = 0;
          for (; i < s.length; i++) {
            c = s.charAt(i);
            if (c === '\\') { i++; continue; }
            if (c === '"' || c === "'") { q = c; for (i++; i < s.length && s.charAt(i) !== q; i++) if (s.charAt(i) === '\\') i++; continue; }
            if (c === '(') depth++;
            else if (c === ')') { depth--; if (!depth) { i++; break; } }
          }
        }
      } else {
        i++;
        while (i < s.length && '.#[:'.indexOf(s.charAt(i)) === -1) { if (s.charAt(i) === '\\') i++; i++; }
      }
      if (i === start) i++;                       // never stuck on a character it does not know
      out.push(s.slice(start, i));
    }
    return out;
  }

  /* What the visitor or a script switches on and off — a selector holding one is kept whether or not it holds
     right now, so the copy hovers, focuses, opens and eases in as the page does. */
  var STATE_PSEUDO = /^:(hover|focus|focus-visible|focus-within|active|visited|target|target-within|checked|indeterminate|invalid|valid|user-invalid|user-valid|placeholder-shown|autofill|-webkit-autofill|open|closed|popover-open|modal|fullscreen|playing|paused|current|past|future|-moz-focusring|focus-ring)$/i;
  var PSEUDO_ELEMENT = /^::|^:(before|after|first-line|first-letter)$/i;
  /* classes the runtimes switch on and off (et-runtime.js: .go of ET's scroll reveal, .rv-in of easing in, the top
     bar's and the tabs' states…): a state, even where something on the page happens to carry one already */
  var STATE_CLASS = /^(go|rv-in|rv-shown|rv-gone|rv-open|rv-bar|rv-bar-solid|rv-bar-clear|rv-etnav--float|rv-etnav--live|is-active|is-on|is-open|active|open|show|shown|current|selected)$/;
  /* a selector as it can be tried on a copy of the page with nothing hovered, focused, opened or eased in yet:
     pseudo-elements and state pseudo-classes left out, and a class that nothing on the page has yet (one a
     script adds: .rv-in, .is-active…) left out where the compound says something else as well */
  function testable(sel, knownClass) {
    var c = compoundsOf(sel);
    return joinCompounds(c.parts.map(function (part) {
      var simples = simplesOf(part), kept = simples.filter(function (t) {
        if (PSEUDO_ELEMENT.test(t)) return false;
        if (t.charAt(0) === ':' && STATE_PSEUDO.test(t.replace(/\(.*$/, ''))) return false;
        return true;
      });
      if (knownClass) {
        var strong = kept.filter(function (t) {
          if (t.charAt(0) !== '.') return true;
          var name = t.slice(1).replace(/\\(.)/g, '$1');
          return knownClass(name) && !STATE_CLASS.test(name);
        });
        if (strong.length && strong.length < kept.length) kept = strong;
      }
      return kept.length ? kept.join('') : '*';
    }), c.combs);
  }

  /* ---------- CSS values ---------- */

  function absolute(url, base) {
    var u = String(url || '').trim();
    if (!u || /^(#|data:|blob:|about:|mailto:|tel:|javascript:)/i.test(u)) return u;
    try { return new URL(u, base).href; } catch (e) { return u; }
  }
  /* url(…) in CSS text as full addresses (base: the stylesheet's own address, or the page's for one in the page) */
  function absoluteUrls(css, base) {
    return String(css || '').replace(/url\(\s*(['"]?)([^'")]*?)\1\s*\)/gi, function (m, q, u) {
      var full = absolute(u, base);
      return full === u ? m : 'url("' + full.replace(/"/g, '%22') + '")';
    });
  }
  /* rem as px: the other website's root font size need not be the 16px this site's rules were written for */
  function remToPx(css, px) {
    px = px || 16;
    return String(css || '').replace(/(^|[^\w.#-])(-?\d*\.?\d+)rem\b/g, function (m, pre, n) {
      var v = Math.round(parseFloat(n) * px * 1000) / 1000;
      return pre + v + 'px';
    });
  }
  /* the custom properties a text uses: var(--name … */
  function varsUsed(text) {
    var out = [], re = /var\(\s*(--[A-Za-z0-9_-]+)/g, m;
    while ((m = re.exec(String(text || '')))) if (out.indexOf(m[1]) === -1) out.push(m[1]);
    return out;
  }
  /* the font families a text names: font / font-family declarations and the variables that hold them
     (--heading-font-family, --heading-font-family-v2, --body-font…) */
  function familiesUsed(text) {
    var out = [], re = /[A-Za-z0-9-]*font[A-Za-z0-9-]*\s*:\s*([^;}]+)/gi, m;
    while ((m = re.exec(String(text || '')))) {
      m[1].split(',').forEach(function (f) {
        f = f.replace(/!important/i, '').replace(/^[\s\d.%\/a-z-]*?(?=['"])/i, '').replace(/['"]/g, '').trim().toLowerCase();
        if (f && out.indexOf(f) === -1) out.push(f);
      });
    }
    return out;
  }
  /* the families a Google Fonts address loads: …css2?family=Work+Sans:wght@400&family=Fraunces… */
  function fontFamiliesOfUrl(href) {
    var out = [], re = /[?&]family=([^&:]+)/g, m;
    while ((m = re.exec(String(href || '')))) {
      String(decodeURIComponent(m[1].replace(/\+/g, ' '))).split('|').forEach(function (f) { out.push(f.split(':')[0].trim().toLowerCase()); });
    }
    return out;
  }

  /* ---------- the copy of the page the rules are tried on ---------- */

  /* <html> and <body> attributes that are the editor's, not the site's */
  var EDITOR_HTML_ATTRS = ['data-rv-editing', 'data-rv-editor-mode', 'data-rv-current-page', 'data-rv-modal', 'style'];
  var EDITOR_CLASSES = ['show-ai-markers', 'ed-selected', 'sec-active'];
  function copyAttrs(from, to, skip) {
    Array.prototype.forEach.call(from.attributes, function (a) {
      if (skip.indexOf(a.name) !== -1) return;
      try { to.setAttribute(a.name, a.value); } catch (e) { /* a name a document will not take */ }
    });
    EDITOR_CLASSES.forEach(function (c) { to.classList.remove(c); });
    if (to.getAttribute('class') === '') to.removeAttribute('class');
  }
  function freshDoc() { return document.implementation.createHTMLDocument(''); }

  /* The page as a visitor has it, around the section: <html> and <body> with the site's attributes (and
     html.rv-motion, which the runtime sets), the elements between <body> and the section, and the section —
     the selectors are tried on this. */
  function pageModel(doc, sec, copy) {
    var d = freshDoc();
    copyAttrs(doc.documentElement, d.documentElement, EDITOR_HTML_ATTRS);
    d.documentElement.classList.add('rv-motion');
    copyAttrs(doc.body, d.body, ['data-rv-editing']);
    var chain = [], at = d.body, p;
    for (p = sec.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) chain.unshift(p);
    var kin = chain.map(function (el) {
      var n = d.createElement(el.tagName.toLowerCase());
      copyAttrs(el, n, []);
      at.appendChild(n);
      at = n;
      return n;
    });
    var s = d.importNode(copy, true);
    at.appendChild(s);
    return { doc: d, html: d.documentElement, body: d.body, kin: kin, section: s };
  }
  /* The same section as the other website will have it: in its wrapper, which carries <body>'s classes and data-…
     attributes, under an <html> the runtime has marked rv-motion. Rewritten selectors are checked on this. */
  function embedModel(doc, copy, id) {
    var d = freshDoc();
    d.documentElement.classList.add('rv-motion');
    var w = d.createElement('div');
    wrapperAttrs(doc, w, id);
    d.body.appendChild(w);
    var s = d.importNode(copy, true);
    w.appendChild(s);
    return { doc: d, html: d.documentElement, body: d.body, wrap: w, section: s };
  }
  function wrapperAttrs(doc, w, id) {
    w.id = scopeId(id);
    w.setAttribute(EMBED, id);
    var body = doc.body;
    if (body.getAttribute('class')) {
      var cls = body.getAttribute('class').split(/\s+/).filter(function (c) { return c && EDITOR_CLASSES.indexOf(c) === -1; });
      if (cls.length) w.setAttribute('class', cls.join(' '));
    }
    Array.prototype.forEach.call(body.attributes, function (a) {
      if (/^data-/.test(a.name) && a.name !== 'data-rv-editing') w.setAttribute(a.name, a.value);
    });
    var lang = doc.documentElement.getAttribute('lang');
    if (lang) w.setAttribute('lang', lang);
    var dir = doc.documentElement.getAttribute('dir') || body.getAttribute('dir');
    if (dir) w.setAttribute('dir', dir);
  }

  function within(model, sel) {
    try { return model.section.matches(sel) || !!model.section.querySelector(sel); } catch (e) { return null; }
  }
  function matchesEl(el, sel) {
    try { return el.matches(sel); } catch (e) { return false; }
  }

  /* What an <html> compound may keep: what the runtime sets on the other website's own <html> too */
  var RUNTIME_HTML = /^(html|:root|\.rv-motion|\[data-rv-modal(=""|='')?\]|\[data-rv-motion-ready(=""|='')?\]|:not\(\[data-rv-editing\]\)|:not\(\[data-rv-editor-mode\]\))$/;

  /* One selector of a rule that reaches the section, for the other website: begins with the wrapper, and what it
     said about the page around the section is said about the wrapper, by the same weight. null: it reaches the
     section only through something the copy does not have (it is kept as it was, under the wrapper). */
  function rewrite(sel, ctx) {
    var c = compoundsOf(sel), n = c.parts.length, k = 0;
    var outerEls = [ctx.page.html, ctx.page.body].concat(ctx.page.kin);
    function isOuter(part) {
      var t = testable(part, ctx.knownClass);
      if (within(ctx.page, t) !== false) return false;          // it is something in the section (or cannot be told)
      return outerEls.some(function (el) { return matchesEl(el, t); });
    }
    while (k < n - 1 && isOuter(c.parts[k])) k++;
    var rest = joinCompounds(c.parts.slice(k), c.combs.slice(k));
    if (k === 0) return ctx.scope + ' ' + sel;
    var htmlTokens = [], carried = [], pads = [], bodyType = false;
    for (var i = 0; i < k; i++) {
      var part = c.parts[i], t = testable(part, ctx.knownClass), tokens = simplesOf(part), left = [];
      var onHtml = matchesEl(ctx.page.html, t) && !matchesEl(ctx.page.body, t) && !ctx.page.kin.some(function (el) { return matchesEl(el, t); });
      var onBody = matchesEl(ctx.page.body, t);
      tokens.forEach(function (tok) {
        if (onHtml && RUNTIME_HTML.test(tok)) { htmlTokens.push(tok); return; }
        if (onBody && /^body$/i.test(tok)) { bodyType = true; return; }
        if (onBody && !PSEUDO_ELEMENT.test(tok) && matchesEl(ctx.embed.wrap, tok)) { carried.push(tok); return; }
        left.push(tok);
      });
      if (left.length) pads.push(':is(' + left.join('') + ', *)');
    }
    var head = '';
    if (htmlTokens.length) head = (/^(html|:root)$/i.test(htmlTokens[0]) ? '' : 'html') + htmlTokens.join('') + ' ';
    var wrap = (bodyType ? 'div' : '') + ctx.scope + carried.join('') + pads.join('');
    var comb = c.combs[k - 1];
    if (comb === '+' || comb === '~') comb = ' ';
    var out = head + wrap + (comb === '>' ? ' > ' : ' ') + rest;
    // the rewritten selector must reach the section on the other website as it did here
    if (within(ctx.embed, testable(out, ctx.knownClass))) return out;
    var plain = head + ctx.scope + ' ' + rest;
    if (within(ctx.embed, testable(plain, ctx.knownClass))) return plain;
    return out;
  }

  /* ---------- the rules ---------- */

  function header(rule) {
    var text = String(rule.cssText || ''), at = text.indexOf('{');
    return at === -1 ? '' : text.slice(0, at).trim();
  }
  function walk(rules, base, out, ctx) {
    Array.prototype.forEach.call(rules || [], function (rule) {
      var type = rule.type;
      if (type === 1) return styleRule(rule, base, out, ctx);
      if (type === 3) {                                  // @import
        var href = absolute(rule.href, base), sheet = null;
        try { sheet = rule.styleSheet; if (sheet) sheet.cssRules; } catch (e) { sheet = null; }
        if (sheet && sheet.cssRules) walk(sheet.cssRules, sheet.href || href, out, ctx);
        else ctx.links.push(href);
        return;
      }
      if (type === 5) { ctx.fontFaces.push({ family: String(rule.style.getPropertyValue('font-family') || '').replace(/['"]/g, '').trim().toLowerCase(), text: absoluteUrls(rule.cssText, base) }); return; }
      if (type === 7) { ctx.keyframes.push({ name: rule.name, text: rule.cssText }); return; }
      if (typeof rule.nameList !== 'undefined' && !rule.cssRules) { out.push(rule.cssText); return; }   // @layer a, b;
      if (typeof rule.syntax === 'string' && typeof rule.inherits === 'boolean') {        // @property --name {…}
        ctx.props.push({ name: rule.name, text: rule.cssText });
        return;
      }
      if (rule.cssRules && typeof rule.selectorText === 'undefined') {   // @media, @supports, @container, @layer {…}, @scope…
        var head = header(rule);
        if (!head || /^@(page|font-feature-values|counter-style)/i.test(head)) return;
        var inner = [];
        walk(rule.cssRules, base, inner, ctx);
        if (inner.length) out.push(head + ' {\n' + inner.join('\n') + '\n}');
      }
    });
  }
  /* A shorthand that holds var() and is then partly overridden in the same rule (border: 1px solid var(--x);
     border-top: …) comes back from the browser as empty longhands ("border-left-color: ;"), which would drop it. The
     rule's own words are then read from its stylesheet's text: its blocks in order, by selector. */
  function selKey(sel) { return String(sel || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/["']/g, '').replace(/::(before|after)/g, ':$1').replace(/\s+/g, ''); }
  function rawBlocks(text) {
    var out = [], i = 0, start = 0, depth = 0, prelude = [], c, q;
    text = String(text || '');
    for (; i < text.length; i++) {
      c = text.charAt(i);
      if (c === '/' && text.charAt(i + 1) === '*') { var end = text.indexOf('*/', i + 2); i = end === -1 ? text.length : end + 1; continue; }
      if (c === '"' || c === "'") { q = c; for (i++; i < text.length && text.charAt(i) !== q; i++) if (text.charAt(i) === '\\') i++; continue; }
      if (c === '{') { prelude.push(text.slice(start, i)); start = i + 1; depth++; }
      else if (c === '}') {
        var head = prelude.pop();
        if (head != null && text.slice(start, i).indexOf('{') === -1 && !/^\s*@/.test(head)) out.push({ key: selKey(head), body: text.slice(start, i).trim() });
        start = i + 1; depth--;
      } else if (c === ';' && !depth) start = i + 1;
    }
    return out;
  }
  function rawBody(rule, ctx) {
    var raw = ctx.raw;
    if (!raw) return '';
    var key = selKey(rule.selectorText), n = raw.seen[key] || 0, hit = null;
    if (!raw.blocks) raw.blocks = rawBlocks(raw.text);
    raw.blocks.some(function (b) { if (b.key === key) { if (!n) { hit = b; return true; } n--; } return false; });
    return hit ? hit.body : '';
  }
  function styleRule(rule, base, out, ctx) {
    var kept = [];
    // which of the sheet's rules with this selector this is (rawBody)
    if (ctx.raw) { var sk = selKey(rule.selectorText); ctx.raw.order = ctx.raw.order || {}; var nth = ctx.raw.order[sk] || 0; ctx.raw.order[sk] = nth + 1; ctx.raw.seen = {}; ctx.raw.seen[sk] = nth; }
    splitTop(rule.selectorText, ',').forEach(function (sel) {
      var hit = within(ctx.page, testable(sel, ctx.knownClass));
      if (hit === null) hit = guess(sel, ctx);
      if (!hit) return;
      var w = rewrite(sel, ctx);
      if (w && kept.indexOf(w) === -1) kept.push(w);
    });
    if (!kept.length) return;
    var body = rule.style ? rule.style.cssText : '';
    if (/:\s*;/.test(body)) { var words = rawBody(rule, ctx); if (words) body = words; }
    if (rule.cssRules && rule.cssRules.length) body += ' ' + Array.prototype.map.call(rule.cssRules, function (r) { return r.cssText; }).join(' ');
    if (!body.trim()) return;
    out.push(kept.join(', ') + ' { ' + absoluteUrls(body, base) + ' }');
  }
  /* a selector this browser cannot try (a pseudo-class of another browser's): kept when it names a class the
     section has */
  function guess(sel, ctx) {
    var re = /\.((?:\\.|[\w-])+)/g, m;
    while ((m = re.exec(sel))) {
      try { if (ctx.page.section.matches('.' + m[1]) || ctx.page.section.querySelector('.' + m[1])) return true; } catch (e) { /* not a class */ }
    }
    return false;
  }

  /* ---------- the reset ----------
     The other website's rules for plain elements stop at the wrapper. Left out: SVG (its look is in attributes a
     reset would undo), pictures, video, frames, form fields and tables (their width / height attributes are
     too; they get the box properties back instead), and what the runtimes add to a section, whose rules come
     with the runtime (et-runtime.js: rv-carousel-btn, rv-menu, rv-day-tabs, rv-etnav-…; rv-popups.js:
     rv-profile-cue, rv-person-sr — functions/lib/editor-dev-export.test.js keeps this list in step). */
  var RUNTIME_MADE = ['.rv-carousel-btn', '.rv-menu', '.rv-day-tabs', '.rv-profile-cue', '.rv-person-sr', '[class^="rv-etnav-"]', '[class*=" rv-etnav-"]'];
  var REPLACED = 'img, video, audio, canvas, iframe, embed, object, input, select, textarea, table, td, th';
  function resetCss(scope) {
    var made = RUNTIME_MADE.map(function (m) { return m + ', ' + m + ' *'; }).join(', ');
    var plain = '*:not(svg, svg *, ' + REPLACED + ', picture, source, track, option, thead, tbody, tfoot, tr, col, colgroup, caption, ' + made + ')';
    return [
      '/* the other website\u2019s own rules for plain elements stop here: the rules below style the section */',
      scope + ', ' + scope + ' :where(' + plain + ') { all: revert; }',
      scope + ' :where(' + plain + ')::before, ' + scope + ' :where(' + plain + ')::after { all: revert; }',
      scope + ' :where(' + REPLACED + '):not(' + made + ') { margin: revert; padding: revert; border: revert; border-radius: revert; box-shadow: revert; outline: revert; background: revert; color: revert; font: revert; ' +
        'float: revert; opacity: revert; filter: revert; transform: revert; position: revert; vertical-align: revert; max-width: revert; min-width: revert; text-transform: revert; letter-spacing: revert; }'
    ].join('\n');
  }

  /* ---------- the section's HTML ---------- */

  /* Elements the live page hides because there is nothing to show (rv-live.css), the editor's notices, and the
     section's own <style> and JS holder (their rules and code travel in the CSS and the JS). */
  var HIDDEN_LIVE = '[data-rv-empty], [data-rv-hidden-empty], [data-rv-bind-empty], [data-rv-nav-empty]';
  var EDITOR_NOTES = '[data-rv-empty-state], [data-rv-bind-hint], [data-rv-editor], [data-rv-form-preview], [data-rv-hv-preview], [data-rv-ai-mark], .ai-prov-badge, .ai-skip-badge, .ai-media-skip-badge';
  var URL_ATTRS = ['src', 'href', 'poster', 'action', 'data-src', 'data-rv-src', 'data-bg', 'data-background', 'data-href', 'xlink:href'];
  var FORM_LINK = /^#(register|rv-form-[\w-]+)$/;

  function finishHtml(copy, opt) {
    var info = { hidden: false, forms: 0, js: '' };
    var each = function (sel, fn) { Array.prototype.slice.call(copy.querySelectorAll(sel)).forEach(fn); };
    // a section the live page hides (nothing to show): hidden in the copy too, not its sample item
    if (copy.matches(HIDDEN_LIVE)) { info.hidden = true; copy.style.setProperty('display', 'none'); }
    each(EDITOR_NOTES, function (n) { n.remove(); });
    each(HIDDEN_LIVE, function (n) { n.remove(); });
    var holder = copy.querySelector('script[data-rv-js]');
    if (holder) { info.js = holder.textContent; holder.remove(); }
    each('style', function (n) { n.remove(); });
    // the ids and section names a link may point to inside the section
    var inside = {};
    [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('[id], [data-rv-section]'))).forEach(function (n) {
      if (n.id) inside[n.id] = 1;
      if (n.getAttribute('data-rv-section')) inside[n.getAttribute('data-rv-section')] = 1;
    });
    var page = String(opt.pageUrl || '').replace(/#.*$/, '');
    [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('*'))).forEach(function (el) {
      URL_ATTRS.forEach(function (name) {
        if (!el.hasAttribute(name)) return;
        var v = (el.getAttribute(name) || '').trim();
        if (name === 'href' && el.tagName === 'A' || name === 'href' && el.tagName === 'AREA') {
          var form = FORM_LINK.exec(v);
          if (el.hasAttribute('data-rv-award-cta')) return;          // its script sets it by the dates; a click goes to the event's site (the JS)
          if (el.hasAttribute('data-register-cta') || el.hasAttribute('data-rv-form') || form) {
            var formId = el.getAttribute('data-rv-form');
            if (page) el.setAttribute('href', page + (formId ? '#rv-form-' + formId : form ? v : '#register'));
            info.forms++;
            return;
          }
          if (v.charAt(0) === '#') {
            if (v.length > 1 && inside[decodeURIComponent(v.slice(1))]) return;
            if (page) el.setAttribute('href', v.length > 1 ? page + v : page);
            return;
          }
        }
        if (v.charAt(0) === '#') return;
        el.setAttribute(name, absolute(v, opt.base));
      });
      ['srcset', 'data-srcset', 'imagesrcset'].forEach(function (name) {
        if (!el.hasAttribute(name)) return;
        el.setAttribute(name, String(el.getAttribute(name)).split(',').map(function (part) {
          var bits = part.trim().split(/\s+/);
          if (bits[0]) bits[0] = absolute(bits[0], opt.base);
          return bits.join(' ');
        }).join(', '));
      });
      if (el.hasAttribute('style')) el.setAttribute('style', remToPx(absoluteUrls(el.getAttribute('style'), opt.base), opt.remPx));
    });
    // a form drawn in the section works on the event's website: the copy links to it there
    each('[data-rv-form-embed]', function (box) {
      info.forms++;
      if (!page) return;
      var a = box.ownerDocument.createElement('a');
      a.className = 'rv-form-away';
      a.href = page + '#rv-form-' + box.getAttribute('data-rv-form-embed');
      a.textContent = 'Fill in the form on the event’s website';
      box.appendChild(a);
    });
    return info;
  }

  /* ---------- the wrapper's look: what the section inherits from the page ---------- */

  var INHERITED = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch', 'font-kerning', 'line-height',
    'letter-spacing', 'word-spacing', 'color', 'text-align', 'text-transform', 'text-indent', 'text-shadow', 'white-space', 'word-break',
    'overflow-wrap', 'hyphens', 'list-style-type', 'list-style-position', 'cursor', 'visibility', 'text-rendering', '-webkit-font-smoothing',
    'caret-color', 'tab-size', 'quotes'];

  function wrapperStyle(win, sec, names) {
    var parent = sec.parentElement || sec, cs = win.getComputedStyle(parent), out = [];
    names.forEach(function (name) {
      var v = String(cs.getPropertyValue(name) || '').trim();
      if (v) out.push([name, v]);
    });
    var fs = parseFloat(cs.fontSize) || 16, lh = parseFloat(cs.lineHeight);
    /* every inherited text property, whatever its value: the reset gives the wrapper the other website's own
       (its body's alignment, case, weight…) otherwise */
    INHERITED.forEach(function (name) {
      var v = String(cs.getPropertyValue(name) || '').trim();
      if (name === 'line-height') v = isFinite(lh) && lh > 0 ? String(Math.round(lh / fs * 1e6) / 1e6) : 'normal';   // a ratio, as the page's own: px would hold every heading to the body text's spacing
      if (v) out.push([name, v]);
    });
    for (var p = parent; p && p.nodeType === 1; p = p.parentElement) {
      var bg = win.getComputedStyle(p).backgroundColor;
      if (bg && !/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/.test(bg)) { out.push(['background-color', bg]); break; }
    }
    return out;
  }

  /* ---------- the script ---------- */

  /* the site's scripts the section needs on another website, in the order the page has them */
  var NOT_FOR_EMBED = /\/(rv-forms|rv-data|rv-pages|rv-live|rv-blend|rv-preview-edit|rv-theme-switcher|rv-theme|rv-type|template-loader|rv-records)\.js/;
  function scriptsFor(doc, sec, copy, base) {
    var id = sec.getAttribute('data-rv-section'), list = [], seen = {};
    var origin = new URL(base).origin;
    // speakers' and sponsors' cards lead to their pages, photos open large (rv-popups.js)
    var people = !!copy.querySelector('template[data-rv-profile], [data-rv-profiles], [data-rv-repeat-template="speakers"], [data-rv-repeat-template="partners"], [data-rv-repeat-template="glimpses"], [data-rv-lightbox], .pe-spn-tile') ||
      /^(previous-sponsors|previous-glimpses|previous-speakers)$/.test(id) || (copy.querySelectorAll('img').length >= 3 && /glimps|gallery|moments|photos/i.test(id));
    var video = !!copy.querySelector('video[data-rv-bg-video]');
    // an award site's main button says what the award's dates make it today (rv-award-cta.js)
    var award = !!copy.querySelector('[data-rv-award-cta]');
    function add(src, more) {
      if (seen[src]) return;
      seen[src] = 1;
      var item = { src: src };
      if (more) for (var k in more) if (Object.prototype.hasOwnProperty.call(more, k)) item[k] = more[k];
      list.push(item);
    }
    Array.prototype.forEach.call(doc.querySelectorAll('script[src]'), function (s) {
      if (s.hasAttribute('data-rv-editor') || s.closest('[data-rv-editor]')) return;
      var src = absolute(s.getAttribute('src'), base), forSec = s.getAttribute('data-rv-script'), at;
      if (forSec && forSec !== id) return;
      if (NOT_FOR_EMBED.test(src)) return;
      try { at = new URL(src); } catch (e) { return; }
      // this site's own files: only what the published site runs (templates/…), never the editor's
      if (at.origin === origin && at.pathname.indexOf('/templates/') !== 0) return;
      if (/\/et-runtime\.js$/.test(at.pathname)) add(src, { global: 'RevampSections' });
      else if (/\/rv-popups\.js$/.test(at.pathname)) { if (people) add(src, { global: 'RevampPopups' }); }
      else if (/\/rv-hero-video(-core)?\.js$/.test(at.pathname)) { if (video) add(src); }
      else if (/\/rv-award-cta\.js$/.test(at.pathname)) { if (award) add(src, { global: 'RevampAwardCta' }); }
      else add(src, forSec ? { section: forSec } : null);
    });
    if (!list.some(function (s) { return s.global === 'RevampSections'; })) list.unshift({ src: origin + '/templates/_shared/et-runtime.js', global: 'RevampSections' });
    if (people && !list.some(function (s) { return s.global === 'RevampPopups'; })) list.push({ src: origin + '/templates/_shared/rv-popups.js', global: 'RevampPopups' });
    if (award && !list.some(function (s) { return s.global === 'RevampAwardCta'; })) list.push({ src: origin + '/templates/_shared/rv-award-cta.js', global: 'RevampAwardCta' });
    return list;
  }

  function jsString(s) { return JSON.stringify(String(s)).replace(/<\/(script)/gi, '<\\/$1').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }

  function buildJs(o) {
    var own = String(o.ownJs || '').trim();
    var lines = [
      '/* ' + o.title + ' — from ETB2B EventSphere.',
      '   Put this after the section’s HTML. It loads the event site’s scripts from EventSphere (each once, however many',
      '   sections the page has), then runs the section’s own script with `section` as its element. */',
      '(function () {',
      '  \'use strict\';',
      '  var ID = ' + jsString(o.id) + ';',
      '  var SCRIPTS = ' + JSON.stringify(o.scripts.map(function (s) { var x = { src: s.src }; if (s.global) x.global = s.global; if (s.section) x.section = s.section; return x; })) + ';',
      '  var PAGE = ' + jsString(o.pageUrl || '') + ';'
    ];
    if (own) {
      lines.push('  /* the section’s own script (Developer zone › JS) */');
      lines.push('  function own(section) {');
      own.split('\n').forEach(function (l) { lines.push('    ' + l); });
      lines.push('  }');
    }
    lines.push(
      '  function load(i, done) {',
      '    var all = window.__rvEmbedScripts = window.__rvEmbedScripts || {};',
      '    if (i >= SCRIPTS.length) return done();',
      '    var s = SCRIPTS[i], key = s.src + (s.section ? \'#\' + s.section : \'\'), got = all[key];',
      '    function next() { load(i + 1, done); }',
      '    if (got && got.done) return next();',
      '    if (got) { got.wait.push(next); return; }',
      '    if (s.global && window[s.global] && !window[s.global].q) { all[key] = { done: true, wait: [] }; return next(); }',
      '    got = all[key] = { done: false, wait: [] };',
      '    var el = document.createElement(\'script\');',
      '    el.src = s.src;',
      '    if (s.section) el.setAttribute(\'data-rv-script\', s.section);',
      '    el.onload = el.onerror = function () { got.done = true; next(); got.wait.splice(0).forEach(function (f) { f(); }); };',
      '    (document.head || document.documentElement).appendChild(el);',
      '  }',
      '  /* The runtimes\u2019 own rules (a carousel\u2019s, the pop-ups\u2019\u2026) style the section\u2019s elements too, and the',
      '     reset at the top of the section\u2019s CSS would outweigh them: inside a copied section they are given the',
      '     wrapper\u2019s weight as well \u2014 written again whenever a section has started. */',
      '  function split(text) {',
      '    var out = [], cur = \'\', depth = 0;',
      '    for (var i = 0; i < text.length; i++) {',
      '      var c = text.charAt(i);',
      '      if (c === \'(\' || c === \'[\') depth++; else if (c === \')\' || c === \']\') depth--;',
      '      if (c === \',\' && !depth) { out.push(cur); cur = \'\'; } else cur += c;',
      '    }',
      '    out.push(cur);',
      '    return out;',
      '  }',
      '  function lift(rules, out) {',
      '    Array.prototype.forEach.call(rules, function (r) {',
      '      if (r.selectorText) {',
      '        var sels = split(r.selectorText).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^(html|:root|body)\\b/i.test(x); });',
      '        if (sels.length) out.push(sels.map(function (x) { return \':is([data-rv-embed], #rv-embed-weight) \' + x; }).join(\', \') + \' { \' + r.style.cssText + \' }\');',
      '      } else if (r.cssRules && r.media) {',
      '        var inner = [];',
      '        lift(r.cssRules, inner);',
      '        if (inner.length) out.push(\'@media \' + r.media.mediaText + \' { \' + inner.join(\' \') + \' }\');',
      '      }',
      '    });',
      '  }',
      '  function weigh() {',
      '    var out = [];',
      '    Array.prototype.forEach.call(document.querySelectorAll(\'style\'), function (st) {',
      '      var ours = Array.prototype.some.call(st.attributes, function (a) { return /^data-rv-/.test(a.name) && a.name !== \'data-rv-embed-weight\'; });',
      '      if (!ours || !st.sheet) return;',
      '      try { lift(st.sheet.cssRules, out); } catch (e) { /* a sheet that cannot be read */ }',
      '    });',
      '    var mine = document.querySelector(\'style[data-rv-embed-weight]\');',
      '    /* first in <head>: where one of them and a rule of the section\u2019s own weigh the same, the section\u2019s wins, as on the event\u2019s page */',
      '    if (!mine) { mine = document.createElement(\'style\'); mine.setAttribute(\'data-rv-embed-weight\', \'\'); var at = document.head || document.documentElement; at.insertBefore(mine, at.firstChild); }',
      '    mine.textContent = out.join(\'\\n\');',
      '  }',
      '  /* A button that opens one of the event\u2019s forms (Register, Nominate Now, Express Interest — the award button',
      '     sets its own when the dates move on) or a link to another part of the event\u2019s page goes to the event\u2019s',
      '     own site, where it works: …/e/<event>#rv-form-<form> opens that form there. */',
      '  function away(e) {',
      '    if (!PAGE || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;',
      '    var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);',
      '    var a = t && t.closest ? t.closest(\'a[href^="#"], [data-rv-form], [data-register-cta]\') : null;',
      '    var wrap = a && a.closest(\'[data-rv-embed]\');',
      '    if (!wrap || a.getAttribute(\'aria-disabled\') === \'true\') return;',
      '    var form = a.getAttribute(\'data-rv-form\'), href = a.getAttribute(\'href\') || \'\', hash = \'\';',
      '    if (form != null) hash = form ? \'#rv-form-\' + form : \'#register\';',
      '    else if (a.hasAttribute(\'data-register-cta\')) hash = \'#register\';',
      '    else if (href.length > 1) {',
      '      var id = decodeURIComponent(href.slice(1));',
      '      if (wrap.querySelector(\'[id="\' + id.replace(/"/g, \'\') + \'"], [data-rv-section="\' + id.replace(/"/g, \'\') + \'"]\')) return;',
      '      hash = href;',
      '    } else return;',
      '    e.preventDefault();',
      '    e.stopPropagation();',
      '    window.location.href = PAGE + hash;',
      '  }',
      '  if (!window.__rvEmbedAway) { window.__rvEmbedAway = true; document.addEventListener(\'click\', away, true); }',
      '  function find() { return document.querySelector(\'[data-rv-embed="\' + ID + \'"] > [data-rv-section]\'); }',
      '  function go(section) {',
      '    if (section.__rvEmbed) return;',
      '    section.__rvEmbed = true;',
      '    load(0, function () {',
      '      if (window.RevampSections && window.RevampSections.init) window.RevampSections.init(section);',
      '      if (window.RevampPopups && window.RevampPopups.refresh) window.RevampPopups.refresh();',
      '      weigh();'
    );
    if (own) {
      lines.push(
        '      try { own.call(section, section); }',
        '      catch (err) { if (window.console) console.error(\'[EventSphere] the section’s script failed:\', ID, err); }'
      );
    }
    lines.push(
      '    });',
      '  }',
      '  function start() {',
      '    var section = find();',
      '    if (section) return go(section);',
      '    /* a page that puts the HTML in later: the section is waited for, up to 30 seconds */',
      '    if (!window.MutationObserver) return;',
      '    var watch = new MutationObserver(function () { var s = find(); if (s) { watch.disconnect(); go(s); } });',
      '    watch.observe(document.documentElement, { childList: true, subtree: true });',
      '    setTimeout(function () { watch.disconnect(); }, 30000);',
      '  }',
      '  if (document.readyState === \'loading\') document.addEventListener(\'DOMContentLoaded\', start);',
      '  else start();',
      '})();'
    );
    return lines.join('\n');
  }

  /* ---------- the whole copy ---------- */

  function build(o) {
    var doc = o.doc, win = o.win, sec = o.section;
    var id = sec.getAttribute('data-rv-section') || sec.id || 'section';
    var base = doc.baseURI || (win && win.location && win.location.href) || location.href;
    var remPx = parseFloat(win.getComputedStyle(doc.documentElement).fontSize) || 16;
    var copy = o.copy || sec.cloneNode(true);
    var info = finishHtml(copy, { pageUrl: o.pageUrl, base: base, remPx: remPx });
    var title = (o.sectionName || id) + (o.eventName ? ' — ' + o.eventName : '');

    // the classes anything on the page has: one a script adds later is a state (testable)
    var classes = {};
    Array.prototype.forEach.call(doc.querySelectorAll('[class]'), function (n) {
      Array.prototype.forEach.call(n.classList, function (c) { classes[c] = 1; });
    });
    Array.prototype.forEach.call(copy.querySelectorAll('[class]'), function (n) {
      Array.prototype.forEach.call(n.classList, function (c) { classes[c] = 1; });
    });
    var ctx = {
      scope: '#' + scopeId(id),
      page: pageModel(doc, sec, copy), embed: embedModel(doc, copy, id),
      knownClass: function (c) { return !!classes[c]; },
      links: [], fontFaces: [], keyframes: [], props: []
    };

    var rules = [];
    Array.prototype.forEach.call(doc.styleSheets, function (sheet) {
      var owner = sheet.ownerNode;
      if (owner && owner.closest && owner.closest('[data-rv-editor]')) return;       // the editor's own look
      // the live page's own switches (rv-live.css: what has nothing to show is hidden — the copy leaves it out —
      // and which internal page shows): about the event's page, not a section on another website
      if (owner && owner.hasAttribute && owner.hasAttribute('data-rv-runtime')) return;
      if (owner && owner.closest && owner.closest('.is-hidden-sec')) return;         // a hidden section's
      if (sheet.disabled) return;
      var list = null;
      try { list = sheet.cssRules; } catch (e) { list = null; }
      if (!list) { if (sheet.href) ctx.links.push(absolute(sheet.href, base)); return; }   // another site's: linked as it is
      var sheetBase = sheet.href || base;
      ctx.raw = owner && owner.tagName === 'STYLE' ? { text: owner.textContent } : null;
      if (sheet.media && sheet.media.mediaText && !/^(all|screen)?$/i.test(sheet.media.mediaText)) {
        var inner = [];
        walk(list, sheetBase, inner, ctx);
        if (inner.length) rules.push('@media ' + sheet.media.mediaText + ' {\n' + inner.join('\n') + '\n}');
      } else walk(list, sheetBase, rules, ctx);
    });

    var body = rules.join('\n');
    var style = wrapperStyle(win, sec, varsUsed(body + ' ' + copy.outerHTML));
    var styleText = style.map(function (p) { return p[0] + ':' + p[1]; }).join(';');
    // what the rules use: @keyframes by name, @font-face by family, @property by name
    var used = body + ' ' + styleText;
    var extra = [];
    ctx.props.forEach(function (p) { if (used.indexOf(p.name) !== -1) extra.push(p.text); });
    var families = familiesUsed(used);
    ctx.fontFaces.forEach(function (f) { if (f.family && families.indexOf(f.family) !== -1 && extra.indexOf(f.text) === -1) extra.push(f.text); });
    var animated = (used.match(/animation(?:-name)?\s*:[^;}]*/gi) || []).join(' ');
    ctx.keyframes.forEach(function (k) {
      if (new RegExp('(^|[\\s,:])' + String(k.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[\\s,;])').test(animated) && extra.indexOf(k.text) === -1) extra.push(k.text);
    });
    var css = resetCss(ctx.scope) + '\n' + remToPx(extra.concat(rules).join('\n'), remPx);

    // fonts: the Google Fonts the page loads for families the copy uses, and any other site's stylesheet the page links
    var links = [];
    Array.prototype.forEach.call(doc.querySelectorAll('link[rel~="stylesheet"][href]'), function (l) {
      if (l.closest('[data-rv-editor]')) return;
      var href = absolute(l.getAttribute('href'), base);
      if (/fonts\.googleapis\.com/.test(href)) {
        var fam = fontFamiliesOfUrl(href);
        if (fam.length && !fam.some(function (f) { return families.indexOf(f) !== -1; })) return;
      } else if (ctx.links.indexOf(href) === -1) return;               // our own sheets: their rules are in the CSS
      if (links.indexOf(href) === -1) links.push(href);
    });
    ctx.links.forEach(function (href) {
      if (/fonts\.googleapis\.com/.test(href)) {
        var fam = fontFamiliesOfUrl(href);
        if (fam.length && !fam.some(function (f) { return families.indexOf(f) !== -1; })) return;
      }
      if (links.indexOf(href) === -1) links.push(href);
    });

    // the wrapper and the section, as one element
    var holderDoc = freshDoc(), w = holderDoc.createElement('div');
    wrapperAttrs(doc, w, id);
    style.forEach(function (p) { try { w.style.setProperty(p[0], p[1]); } catch (e) { /* a value this browser will not take */ } });
    w.appendChild(holderDoc.importNode(copy, true));
    var linkTags = links.map(function (h) { return '<link rel="stylesheet" href="' + h.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">'; });
    var html = (linkTags.length ? linkTags.join('\n') + '\n' : '') + w.outerHTML;

    var records = !!copy.querySelector('[data-rv-filled], [data-rv-item], [data-rv-id]');
    var js = buildJs({ id: id, title: title, scripts: scriptsFor(doc, sec, copy, base), ownJs: info.js, pageUrl: String(o.pageUrl || '').replace(/#.*$/, '') });
    // one block: fonts and styles first (no unstyled moment), the section, then its script
    var all = '<!-- ' + title.replace(/--/g, '–') + ' — from ETB2B EventSphere -->\n' + (linkTags.length ? linkTags.join('\n') + '\n' : '') +
      '<style>\n' + css.replace(/<\/(style)/gi, '<\\/$1') + '\n</style>\n' + w.outerHTML + '\n<script>\n' + js.replace(/<\/(script)/gi, '<\\/$1') + '\n</script>';
    var page = '<!DOCTYPE html>\n<html lang="' + (doc.documentElement.getAttribute('lang') || 'en') + '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
      title.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</title>\n</head>\n<body style="margin:0">\n' + all + '\n</body>\n</html>\n';

    var notes = [];
    if (info.hidden) notes.push('The event’s site does not show this section now (it has nothing to show), so the copy shows nothing either.');
    if (records) notes.push('The event’s records are in the copy as they are now: copy it again after changing them in Content.');
    if (info.forms) notes.push('Forms open on the event’s own website: the buttons here lead there.');
    return { id: id, html: html, css: css, js: js, all: all, page: page, records: records, hidden: info.hidden, forms: info.forms, ownJs: !!String(info.js).trim(), notes: notes };
  }

  /* the page at url, out of sight, its scripts off (sandbox without allow-scripts), once its fonts are in */
  function loadPage(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement('iframe'), done = false;
      f.setAttribute('sandbox', 'allow-same-origin');
      f.setAttribute('aria-hidden', 'true');
      f.setAttribute('tabindex', '-1');
      f.setAttribute('data-rv-dev-export', '');
      f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1440px;height:900px;border:0;visibility:hidden;pointer-events:none';
      var timer = setTimeout(function () { finish(new Error('the page took too long to load')); }, timeoutMs || 45000);
      function finish(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) { f.remove(); reject(err); } else resolve(f);
      }
      f.onload = function () {
        var d = null;
        try { d = f.contentDocument; } catch (e) { d = null; }
        if (!d || !d.body || !d.querySelector('[data-rv-section]')) return finish(new Error('the page could not be read'));
        var fonts = d.fonts && d.fonts.ready ? d.fonts.ready : Promise.resolve();
        Promise.race([fonts, new Promise(function (r) { setTimeout(r, 5000); })]).then(function () { finish(null); }, function () { finish(null); });
      };
      f.src = url;
      document.body.appendChild(f);
    });
  }

  root.RevampDevExport = {
    build: build,
    loadPage: loadPage,
    _test: { splitTop: splitTop, compoundsOf: compoundsOf, joinCompounds: joinCompounds, simplesOf: simplesOf, testable: testable,
      absolute: absolute, absoluteUrls: absoluteUrls, remToPx: remToPx, varsUsed: varsUsed, familiesUsed: familiesUsed,
      fontFamiliesOfUrl: fontFamiliesOfUrl, buildJs: buildJs, jsString: jsString, resetCss: resetCss, scopeId: scopeId, RUNTIME_MADE: RUNTIME_MADE }
  };
})(typeof window !== 'undefined' ? window : this);
