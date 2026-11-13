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

   The copy is written as ETB2B's own CMS writes a section (the owner, 12 Nov 2026, with one of its sections: "I want
   this type of output for each sections … so that it can be easily adapt on ETB2B CMS"): each box holds its code as
   it goes on the page.

     HTML  one <section> — the section as a visitor sees it: the event's records drawn (speakers, partners,
           sessions…), every picture and link with its full web address, its inline styles !important, nothing the
           live page hides (a list with no records). It keeps its own id and classes and carries class "rv-embed"
           (every rule of the CSS begins with it), data-rv-embed="<section id>" (the common script finds it by it)
           and what the page's <body> gave its scripts: data-rv-event-id, data-rv-awards. A link to another part of
           the event's page, and a button that opens one of the event's forms, goes to the event's own site
           (…/e/<event>#register opens the form there).
     CSS   <style>…</style>: the section's own rules (its stylesheet, its copies', its developer-zone CSS).
     JS    <script>…</script> with the section's own script (Developer zone › JS), handed to the common script —
           or nothing, when it has none.
     Common CSS & JS, once per page (ETB2B's CMS has a global section for it), for every section copied from the site:
           CSS   the Google Fonts (@import), a reset — the page's own rules for plain elements (h2, p, img, a…) stop
                 at the sections: every element is put back to the browser's defaults (all: revert) — the event
                 page's look on .rv-embed (the theme's variables resolved, the inherited text: font, size, line
                 height, colour…), and every rule of the sheets the page shares (gen-base.css, et-platform.css, a
                 template's CSS) that reaches a section, with the @keyframes, @font-face and @property they use.
           JS    loads the event site's scripts from EventSphere once (et-runtime.js: carousels, easing in, day tabs,
                 accordions…; rv-popups.js, rv-award-cta.js where needed), starts every copied section on the page —
                 one put in later too — runs their own scripts, gives the runtimes' rules the sections' weight, and
                 sends form buttons to the event's site (embedLoader).
     Every selector begins with .rv-embed and the weight of four ids (:not(#_#_#_#_)); what it said about the page
     around the section (body.rv-generated …, #content > …) is left out and its weight kept; every declaration is
     !important. ETB2B's pages style content through up to three ids and set plain elements with !important: the
     copy's rules still outweigh them, and still win over one another as on the event's page. rem becomes px;
     url(…) a full address. Rules for states that scripts or the visitor set (.rv-in, :hover…) are kept.
     For a website that takes one HTML field, and the test page: "all" — the common part this section needs, the
     section's CSS, its HTML and the scripts, in one block.

   RevampDevExport.loadPage(url) -> Promise<iframe>
     the page at url, out of sight in this window, its scripts off, once its fonts are in. The caller removes it.
   RevampDevExport.build({ doc, win, section, pageUrl, sectionName, eventName })
     doc, win   that page's document and window (the section's styles and theme are read from them)
     section    the section's element in it
     pageUrl    the event's public page (RevampCore.publicUrl)
   -> { id, html, css, js, common: { css, js }, all, page, records, hidden, forms, ownJs, notes: [text] }
     page   a whole test page holding "all", to open in a browser
   RevampDevExport.buildCommon({ doc, win, sections, pageUrl, eventName }) -> { css, js, sections } | { error }

   RevampDevExport._test holds the pure helpers (functions/lib/editor-dev-export.test.js). */
(function (root) {
  'use strict';

  var EMBED = 'data-rv-embed';
  /* The weight of four ids (:not(#_#_#_#_) holds for any element), which every selector carries after .rv-embed. ETB2B's own pages style their content through ids — up to three in one selector (the microsite
     bundle, a page's custom CSS) — and a rule of the page's that reaches the section must not win over the
     section's own. The same for every selector, so they still win over one another as on the event's page. */
  var WEIGHT = ':not(#_#_#_#_)';
  /* the class the section carries for it (ETB2B's CMS takes a section as it is: it keeps its own id and classes) */
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
  /* Every declaration made !important — as ETB2B's own CMS sections are written: ETB2B's page CSS sets plain elements
     with !important (strong, p, li, a… — hundreds of rules), which outweighs any rule that is not, however specific.
     The copy's rules then still win over one another by their weight and order, as on the event's page, and over the
     page's important rules by the weight of their four ids. Comments go; a declaration already important is left.
     soft (optional): the properties an animation moves where this rule reaches — left as they are (motionSoft). */
  function important(body, soft) {
    var out = [], cur = '', depth = 0, quote = '', i, c;
    body = String(body || '').replace(/\/\*[\s\S]*?\*\//g, '');
    function flush() {
      var d = cur.trim();
      cur = '';
      if (!d) return;
      if (d.indexOf(':') === -1 || /!\s*important\s*$/i.test(d)) { out.push(d); return; }
      if (soft && motionSoftens(d, soft)) { out.push(d); return; }
      out.push(d + ' !important');
    }
    for (i = 0; i < body.length; i++) {
      c = body.charAt(i);
      if (quote) { cur += c; if (c === '\\' && i + 1 < body.length) cur += body.charAt(++i); else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === '(') depth++; else if (c === ')') depth--;
      if (c === ';' && !depth) { flush(); continue; }
      cur += c;
    }
    flush();
    return out.length ? out.join('; ') + ';' : '';
  }

  /* a CSS text with every "…" string written as '…' (a ' inside escaped): no double quote is left in it */
  function singleQuoted(css) {
    return String(css || '').replace(/"((?:[^"\\]|\\.)*)"/g, function (m, inner) {
      return "'" + inner.replace(/\\"/g, '"').replace(/'/g, "\\'") + "'";
    }).replace(/"/g, "'");
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
  /* The same section as the other website will have it: on its own, straight in that page's <body>, under an
     <html> the runtime has marked rv-motion. Rewritten selectors are checked on this. */
  function embedModel(doc, copy) {
    var d = freshDoc();
    d.documentElement.classList.add('rv-motion');
    var s = d.importNode(copy, true);
    d.body.appendChild(s);
    return { doc: d, html: d.documentElement, body: d.body, section: s };
  }
  /* The section is the copy's one element (ETB2B's CMS takes the HTML box as a <section>): it carries what the
     page's <body> gave it that its scripts read — the event, whether it is an awards site, the language — and the
     class every rule of the CSS begins with. */
  function rootAttrs(doc, sec, id) {
    sec.classList.add('rv-embed', scopeId(id));
    sec.setAttribute(EMBED, id);
    var body = doc.body;
    ['data-rv-event-id', 'data-rv-awards'].forEach(function (a) {
      if (body.hasAttribute(a) && !sec.hasAttribute(a)) sec.setAttribute(a, body.getAttribute(a));
    });
    var lang = doc.documentElement.getAttribute('lang');
    if (lang && !sec.hasAttribute('lang')) sec.setAttribute('lang', lang);
    var dir = doc.documentElement.getAttribute('dir') || body.getAttribute('dir');
    if (dir && !sec.hasAttribute('dir')) sec.setAttribute('dir', dir);
  }

  function within(model, sel) {
    try { return model.section.matches(sel) || !!model.section.querySelector(sel); } catch (e) { return null; }
  }
  function matchesEl(el, sel) {
    try { return el.matches(sel); } catch (e) { return false; }
  }

  /* What an <html> compound may keep: what the runtime sets on the other website's own <html> too */
  var RUNTIME_HTML = /^(html|:root|\.rv-motion|\[data-rv-modal(=""|='')?\]|\[data-rv-motion-ready(=""|='')?\]|:not\(\[data-rv-editing\]\)|:not\(\[data-rv-editor-mode\]\))$/;

  /* One selector of a rule that reaches the section, for the other website -> the selectors to write (one or two).
     Each begins with the section (ctx.scope: its class and the weight of four ids): "<scope> <rest>" for what is
     inside it, and, where the selector's first compound is the section itself, that compound with the scope in it.
     What the selector said about the page around the section (body.rv-generated …, #content > …) held here — it
     reached the section — so it is left out, and its weight kept (:is(<it>, *)). An <html> compound keeps what the
     runtime sets on the other website's <html> too (.rv-motion …). Inside :where() / :is(), the page around the
     section is left out the same way. */
  function rewrite(sel, ctx, m) {
    var outerEls = [m.page.html, m.page.body].concat(m.page.kin);
    function isOuter(part) {
      var t = testable(part, ctx.knownClass);
      if (within(m.page, t) !== false) return false;            // it is something in the section (or cannot be told)
      return outerEls.some(function (el) { return matchesEl(el, t); });
    }
    function inner(list) {
      return splitTop(list, ',').map(function (one) {
        var c1 = compoundsOf(one), j = 0;
        while (j < c1.parts.length - 1 && isOuter(c1.parts[j])) j++;
        return joinCompounds(c1.parts.slice(j), c1.combs.slice(j));
      }).join(', ');
    }
    var c = compoundsOf(sel);
    c.parts = c.parts.map(function (part) {
      return simplesOf(part).map(function (tok) {
        var m = /^:(where|is)\((.*)\)$/.exec(tok);
        return m ? ':' + m[1] + '(' + inner(m[2]) + ')' : tok;
      }).join('');
    });
    var n = c.parts.length, k = 0;
    while (k < n - 1 && isOuter(c.parts[k])) k++;
    var htmlTokens = [], pads = [];
    for (var i = 0; i < k; i++) {
      var part = c.parts[i], t = testable(part, ctx.knownClass), left = [];
      var onHtml = matchesEl(m.page.html, t) && !matchesEl(m.page.body, t) && !m.page.kin.some(function (el) { return matchesEl(el, t); });
      simplesOf(part).forEach(function (tok) {
        if (onHtml && RUNTIME_HTML.test(tok)) htmlTokens.push(tok); else left.push(tok);
      });
      if (left.length) pads.push(':is(' + left.join('') + ', *)');
    }
    var head = htmlTokens.length ? (/^(html|:root)$/i.test(htmlTokens[0]) ? '' : 'html') + htmlTokens.join('') + ' ' : '';
    var scope = ctx.scope + pads.join('');
    var parts = c.parts.slice(k), combs = c.combs.slice(k);
    var comb = k ? c.combs[k - 1] : ' ';
    var out = [];
    // the section itself as the first compound: the scope goes into it (before a pseudo-element)
    if (matchesEl(m.page.section, testable(parts[0], ctx.knownClass))) {
      var toks = simplesOf(parts[0]), at = toks.length;
      for (var q = 0; q < toks.length; q++) if (PSEUDO_ELEMENT.test(toks[q])) { at = q; break; }
      var first = toks.slice(0, at).join('') + scope + toks.slice(at).join('');
      out.push(head + joinCompounds([first].concat(parts.slice(1)), combs));
      out.rootAt = out.length - 1;            // this one styles the section itself (styleRule: inherit)
    }
    // something inside the section
    out.push(head + scope + (comb === '>' ? ' > ' : ' ') + joinCompounds(parts, combs));
    var hits = out.filter(function (o) { return within(m.embed, testable(o, ctx.knownClass)); });
    var res = hits.length ? hits : out;
    res.root = out.rootAt != null && res.indexOf(out[out.rootAt]) !== -1 ? out[out.rootAt] : null;
    return res;
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
      if (type === 5) {
        var fs = rule.style, fd = function (n) { return String(fs.getPropertyValue(n) || '').trim(); };
        ctx.fontFaces.push({ family: fd('font-family').replace(/['"]/g, '').trim().toLowerCase(), weight: fd('font-weight') || '400', style: fd('font-style') || 'normal',
          range: fd('unicode-range'), src: fd('src'), text: absoluteUrls(rule.cssText, base) });
        return;
      }
      if (type === 7) { ctx.keyframes.push(motionKeyframes(rule)); return; }
      if (typeof rule.nameList !== 'undefined' && !rule.cssRules) { out.push(rule.cssText); return; }   // @layer a, b;
      if (typeof rule.syntax === 'string' && typeof rule.inherits === 'boolean') {        // @property --name {…}
        ctx.props.push({ name: rule.name, text: rule.cssText });
        return;
      }
      if (rule.cssRules && typeof rule.selectorText === 'undefined') {   // @media, @supports, @container, @layer {…}, @scope…
        var head = header(rule);
        if (!head || /^@(page|font-feature-values|counter-style)/i.test(head)) return;
        var inner = [], layer = /^@layer\b/i.test(head);
        /* a layer's rules keep their own words: an !important declaration in a layer outweighs every unlayered
           !important one (the cascade turns round for important declarations), so a page's low default — @layer
           rv-pictures { :where(img[data-rv-sized]) { height: auto } } — would beat the section's own rules */
        if (layer) ctx.inLayer = (ctx.inLayer || 0) + 1;
        walk(rule.cssRules, base, inner, ctx);
        if (layer) ctx.inLayer--;
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
    var kept = [], roots = [], rootModel = null;
    // which of the sheet's rules with this selector this is (rawBody)
    if (ctx.raw) { var sk = selKey(rule.selectorText); ctx.raw.order = ctx.raw.order || {}; var nth = ctx.raw.order[sk] || 0; ctx.raw.order[sk] = nth + 1; ctx.raw.seen = {}; ctx.raw.seen[sk] = nth; }
    splitTop(rule.selectorText, ',').forEach(function (sel) {
      var t = testable(sel, ctx.knownClass);
      ctx.models.forEach(function (m) {
        var hit = within(m.page, t);
        if (hit === null) hit = guess(sel, m);
        if (!hit) return;
        var forms = rewrite(sel, ctx, m);
        forms.forEach(function (w) { if (kept.indexOf(w) === -1) kept.push(w); });
        if (forms.root && roots.indexOf(forms.root) === -1) { roots.push(forms.root); rootModel = rootModel || m; }
      });
    });
    if (!kept.length) return;
    var body = rule.style ? rule.style.cssText : '';
    if (/:\s*;/.test(body)) { var words = rawBody(rule, ctx); if (words) body = words; }
    if (rule.cssRules && rule.cssRules.length) body += ' ' + Array.prototype.map.call(rule.cssRules, function (r) { return r.cssText; }).join(' ');
    if (!body.trim()) return;
    var soft = motionSoft(rule, ctx);
    function written(b) { b = motionNames(absoluteUrls(b, base), ctx.motion); return ctx.inLayer ? b : important(b, soft); }
    /* A rule that tells the section itself to inherit (ETB2B's classic reset: section, div… { font: inherit }) means
       the page around it — on another website that would be that page's own font and colour. For the section
       itself it is written with the event page's values instead. */
    if (roots.length && /:\s*inherit\b/i.test(body) && ctx.win) {
      var inner = kept.filter(function (k) { return roots.indexOf(k) === -1; });
      if (inner.length) out.push(inner.join(', ') + ' { ' + written(body) + ' }');
      out.push(roots.join(', ') + ' { ' + written(inheritFrom(body, ctx.win.getComputedStyle(rootModel.sec.parentElement || rootModel.sec))) + ' }');
      return;
    }
    out.push(kept.join(', ') + ' { ' + written(body) + ' }');
  }
  /* "inherit" in a rule's declarations as the values the page around the section has (cs: its parent's computed style) */
  function inheritFrom(body, cs) {
    var fs = parseFloat(cs.fontSize) || 16, lh = parseFloat(cs.lineHeight);
    var ratio = isFinite(lh) && lh > 0 ? String(Math.round(lh / fs * 1e6) / 1e6) : 'normal';
    return String(body).replace(/(^|;)\s*([\w-]+)\s*:\s*inherit\s*(!\s*important)?\s*(?=;|$)/gi, function (m, pre, name, imp) {
      var low = name.toLowerCase(), tail = imp ? ' !important' : '';
      if (low.indexOf('--') === 0) return m;
      if (low === 'font') {
        return pre + ' font-style: ' + cs.fontStyle + tail + '; font-variant: ' + cs.fontVariant + tail + '; font-weight: ' + cs.fontWeight + tail + '; font-stretch: ' + cs.fontStretch + tail +
          '; font-size: ' + cs.fontSize + tail + '; line-height: ' + ratio + tail + '; font-family: ' + cs.fontFamily + tail;
      }
      if (low === 'line-height') return pre + ' line-height: ' + ratio + tail;
      var v = String(cs.getPropertyValue(low) || '').trim();
      return v ? pre + ' ' + name + ': ' + v + tail : m;
    });
  }
  /* a selector this browser cannot try (a pseudo-class of another browser's): kept when it names a class the
     section has */
  function guess(sel, model) {
    var re = /\.((?:\\.|[\w-])+)/g, m, s = model.page.section;
    while ((m = re.exec(sel))) {
      try { if (s.matches('.' + m[1]) || s.querySelector('.' + m[1])) return true; } catch (e) { /* not a class */ }
    }
    return false;
  }

  /* ---------- the reset ----------
     The other website's rules for plain elements stop at the copied sections. Left out: SVG (its look is in attributes a
     reset would undo), pictures, video, frames, form fields and tables (their width / height attributes are
     too; they get the box properties back instead), and what the runtimes add to a section, whose rules come
     with the runtime (et-runtime.js: rv-carousel-btn, rv-menu, rv-day-tabs, rv-etnav-…; rv-popups.js:
     rv-profile-cue, rv-person-sr — functions/lib/editor-dev-export.test.js keeps this list in step). */
  var RUNTIME_MADE = ['.rv-carousel-btn', '.rv-menu', '.rv-day-tabs', '.rv-profile-cue', '.rv-person-sr', '[class^="rv-etnav-"]', '[class*=" rv-etnav-"]', '[data-rv-edge]'];
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
  var UNUSED_ATTRS = ['data-rv-key', 'data-rv-bind', 'data-rv-unbound', 'data-rv-bound', 'data-rv-pristine', 'data-rv-list', 'data-rv-list-at', 'data-rv-template-id', 'data-rv-mode'];
  var URL_ATTRS = ['src', 'href', 'poster', 'action', 'data-src', 'data-rv-src', 'data-bg', 'data-background', 'data-href', 'xlink:href'];
  var FORM_LINK = /^#(register|rv-form-[\w-]+)$/;

  function finishHtml(copy, opt) {
    var info = { hidden: false, forms: 0, js: '' };
    var each = function (sel, fn) { Array.prototype.slice.call(copy.querySelectorAll(sel)).forEach(fn); };
    // a section the live page hides (nothing to show): hidden in the copy too, not its sample item
    if (copy.matches(HIDDEN_LIVE)) { info.hidden = true; copy.style.setProperty('display', 'none', 'important'); }
    each(EDITOR_NOTES, function (n) { n.remove(); });
    each(HIDDEN_LIVE, function (n) { n.remove(); });
    /* Only what the other website uses. A speaker's pop-up text (<template data-rv-profile>) opens on an awards site's
       jury cards only — on an event site a card leads to the speaker's page — and the marks the editor and the
       records' drawing keep for themselves, which nothing there reads. */
    if (!opt.awards) each('template[data-rv-profile]', function (n) { n.remove(); });
    [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('[' + UNUSED_ATTRS.join('], [') + ']'))).forEach(function (el) {
      UNUSED_ATTRS.forEach(function (a) { el.removeAttribute(a); });
    });
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
      if (el.hasAttribute('style')) {
        var st = important(remToPx(absoluteUrls(el.getAttribute('style'), opt.base), opt.remPx));
        // no double quote in it at all: ETB2B's CMS turns &quot; back into ", which ends the attribute there (the
        // hero's picture, url("…") beside image-set(url('…')), was cut off). Every CSS string in single quotes.
        el.setAttribute('style', singleQuoted(st));
      }
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

  /* ---------- the page's look on the sections: what a section inherits from the page ---------- */

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
    /* every inherited text property, whatever its value: the reset would give the section the other website's own
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

  /* ---------- the scripts ---------- */

  /* the site's scripts the sections need on another website, in the order the page has them */
  var NOT_FOR_EMBED = /\/(rv-forms|rv-data|rv-pages|rv-live|rv-blend|rv-preview-edit|rv-theme-switcher|rv-theme|rv-type|template-loader|rv-records)\.js/;
  function scriptsFor(doc, pairs, base) {
    var list = [], seen = {}, origin = new URL(base).origin;
    var ids = pairs.map(function (p) { return p.sec.getAttribute('data-rv-section'); });
    function some(fn) { return pairs.some(fn); }
    // speakers' and sponsors' cards lead to their pages, photos open large (rv-popups.js)
    var people = some(function (p) {
      var id = p.sec.getAttribute('data-rv-section');
      return !!p.copy.querySelector('template[data-rv-profile], [data-rv-profiles], [data-rv-repeat-template="speakers"], [data-rv-repeat-template="partners"], [data-rv-repeat-template="glimpses"], [data-rv-lightbox], .pe-spn-tile') ||
        /^(previous-sponsors|previous-glimpses|previous-speakers)$/.test(id) || (p.copy.querySelectorAll('img').length >= 3 && /glimps|gallery|moments|photos/i.test(id));
    });
    var video = some(function (p) { return !!p.copy.querySelector('video[data-rv-bg-video]'); });
    // an award site's main button says what the award's dates make it today (rv-award-cta.js)
    var award = some(function (p) { return !!p.copy.querySelector('[data-rv-award-cta]'); });
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
      if (forSec && ids.indexOf(forSec) === -1) return;
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

  /* The common script, written into the copy as its own text (commonJs: embedLoader.toString()) and run on the
     other website — so it uses nothing from this file. Once per page however often it is pasted (a second copy only
     adds the scripts it names). It loads the event site's scripts from EventSphere, each once; starts every copied
     section on the page (<section data-rv-embed>) — and one the page puts in later — through the runtime
     (RevampSections.init: carousels, easing in, day tabs, accordions…); runs each section's own script, which a
     section's JS box hands it (window.RevampEmbedQ.push([id, fn]), before or after this has run); gives the runtimes'
     own rules the sections' weight, which the reset in the common CSS would otherwise outweigh; and sends a click on
     a button that opens one of the event's forms, or a link to another part of the event's page, to the event's own
     site, where it works (…/e/<event>#rv-form-<form> opens that form there). */
  function embedLoader(CONFIG) {
    'use strict';
    var w = window, d = document;
    if (w.RevampEmbed && w.RevampEmbed.need) { if (CONFIG.edges) d.documentElement.setAttribute('data-rv-edges', CONFIG.edges); w.RevampEmbed.need(CONFIG); return; }
    var all = w.__rvEmbedScripts = w.__rvEmbedScripts || {};
    var queue = w.RevampEmbedQ = w.RevampEmbedQ || [];
    var owns = {}, pending = 0, waiting = [], page = CONFIG.page || '', scope = CONFIG.scope;
    if (CONFIG.edges) d.documentElement.setAttribute('data-rv-edges', CONFIG.edges);
    function each(list, fn) { Array.prototype.forEach.call(list, fn); }
    function load(list, done) {
      var i = 0;
      (function next() {
        if (i >= list.length) return done();
        var s = list[i++], key = s.src + (s.section ? '#' + s.section : ''), got = all[key];
        if (got && got.done) return next();
        if (got) { got.wait.push(next); return; }
        if (s.global && w[s.global] && !w[s.global].q) { all[key] = { done: true, wait: [] }; return next(); }
        got = all[key] = { done: false, wait: [] };
        var el = d.createElement('script');
        el.src = s.src;
        if (s.section) el.setAttribute('data-rv-script', s.section);
        el.onload = el.onerror = function () { got.done = true; next(); got.wait.splice(0).forEach(function (f) { f(); }); };
        (d.head || d.documentElement).appendChild(el);
      })();
    }
    function ready(fn) { if (!pending) fn(); else waiting.push(fn); }
    function need(conf) {
      if (conf.page && !page) page = conf.page;
      pending++;
      load(conf.scripts || [], function () {
        pending--;
        if (!pending) waiting.splice(0).forEach(function (f) { f(); });
        startAll();
      });
    }
    function split(text) {
      var out = [], cur = '', depth = 0;
      for (var i = 0; i < text.length; i++) {
        var c = text.charAt(i);
        if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
        if (c === ',' && !depth) { out.push(cur); cur = ''; } else cur += c;
      }
      out.push(cur);
      return out;
    }
    function lift(rules, out) {
      each(rules, function (r) {
        if (r.selectorText) {
          var sels = split(r.selectorText).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^(html|:root|body)\b/i.test(x); });
          if (!sels.length) return;
          var decl = [];
          for (var k = 0; k < r.style.length; k++) { var name = r.style[k]; decl.push(name + ': ' + r.style.getPropertyValue(name) + ' !important'); }
          out.push(sels.map(function (x) { return scope + ' ' + x; }).join(', ') + ' { ' + decl.join('; ') + ' }');
        } else if (r.cssRules && r.media) {
          var inner = [];
          lift(r.cssRules, inner);
          if (inner.length) out.push('@media ' + r.media.mediaText + ' { ' + inner.join(' ') + ' }');
        }
      });
    }
    function weigh() {
      var out = [];
      each(d.querySelectorAll('style'), function (st) {
        var ours = Array.prototype.some.call(st.attributes, function (a) { return /^data-rv-/.test(a.name) && a.name !== 'data-rv-embed-weight'; });
        if (!ours || !st.sheet) return;
        try { lift(st.sheet.cssRules, out); } catch (e) { /* a sheet that cannot be read */ }
      });
      var mine = d.querySelector('style[data-rv-embed-weight]');
      // first in <head>: where one of these and a rule of a section's own weigh the same, the section's wins, as on the event's page
      if (!mine) { mine = d.createElement('style'); mine.setAttribute('data-rv-embed-weight', ''); var at = d.head || d.documentElement; at.insertBefore(mine, at.firstChild); }
      var text = out.join('\n');
      if (mine.textContent !== text) mine.textContent = text;
    }
    function away(e) {
      if (!page || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      var a = t && t.closest ? t.closest('a[href^="#"], [data-rv-form], [data-register-cta]') : null;
      var sec = a && a.closest('[data-rv-embed]');
      if (!sec || a.getAttribute('aria-disabled') === 'true') return;
      var form = a.getAttribute('data-rv-form'), href = a.getAttribute('href') || '', hash = '';
      if (form != null) hash = form ? '#rv-form-' + form : '#register';
      else if (a.hasAttribute('data-register-cta')) hash = '#register';
      else if (href.length > 1) {
        var id = decodeURIComponent(href.slice(1)).replace(/"/g, '');
        if (sec.id === id || sec.querySelector('[id="' + id + '"], [data-rv-section="' + id + '"]')) return;
        hash = href;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      w.location.href = page + hash;
    }
    function runOwn(sec) {
      var id = sec.getAttribute('data-rv-embed'), fn = owns[id];
      if (!fn || sec.__rvOwnRan || !sec.__rvStarted) return;
      sec.__rvOwnRan = true;
      try { fn.call(sec, sec); } catch (err) { if (w.console) console.error('[EventSphere] the script of section "' + id + '" failed:', err); }
    }
    function start(sec) {
      if (sec.__rvEmbed) return;
      sec.__rvEmbed = true;
      ready(function () {
        if (w.RevampSections && w.RevampSections.init) w.RevampSections.init(sec);
        sec.__rvStarted = true;
        if (w.RevampPopups && w.RevampPopups.refresh) w.RevampPopups.refresh();
        weigh();
        runOwn(sec);
      });
    }
    function startAll() { each(d.querySelectorAll('[data-rv-embed]'), start); }
    function take(item) {
      if (!item || !item[0]) return;
      owns[item[0]] = item[1];
      each(d.querySelectorAll('[data-rv-embed="' + String(item[0]).replace(/"/g, '') + '"]'), runOwn);
    }
    queue.forEach(take);
    queue.push = function (item) { take(item); return queue.length; };
    w.RevampEmbed = { need: need, start: startAll };
    if (!w.__rvEmbedAway) { w.__rvEmbedAway = true; d.addEventListener('click', away, true); }
    /* an ETB2B page: the copied banner keeps 100px above it for ETB2B's fixed header (its usual height, so nothing
       moves); a header of another height is measured and the banner's room follows it (more than 4px off only) */
    function head() {
      var h = d.getElementById ? d.getElementById('ms_header_oauth_wrapper') : null, root = d.documentElement;
      if (!root || !root.style || !root.style.setProperty) return;
      var px = h ? Math.round(h.getBoundingClientRect().height) : 0, want = px && Math.abs(px - 100) > 4 ? px + 'px' : '';
      if (root.style.getPropertyValue('--rv-etb2b-head') === want) return;
      if (want) root.style.setProperty('--rv-etb2b-head', want); else root.style.removeProperty('--rv-etb2b-head');
    }
    if (!w.__rvEmbedHead && w.addEventListener) {
      w.__rvEmbedHead = true;
      var headTimer = null;
      w.addEventListener('resize', function () { clearTimeout(headTimer); headTimer = setTimeout(head, 150); });
      w.addEventListener('load', head);
    }
    need(CONFIG);
    /* a page that puts sections in later: they are started as they come (for a minute) */
    function watch() {
      head();
      startAll();
      if (!w.MutationObserver) return;
      var timer = null, seen = new w.MutationObserver(function () {
        if (timer) return;
        timer = setTimeout(function () { timer = null; startAll(); }, 60);
      });
      seen.observe(d.documentElement, { childList: true, subtree: true });
      setTimeout(function () { seen.disconnect(); }, 60000);
    }
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', watch); else watch();
  }

  /* the common script: the loader above, with the event's page, the scripts and the sections' weight */
  /* Section edges (the owner, 13 Nov 2026: "The section merge is not there in the code, so all the sections are coming
     with sharp ending. A toggle should be there"): with "Smooth", the common script marks the page
     (<html data-rv-edges="smooth">) and loads rv-blend.js, which fades one section's colour into the next as on the
     event's site (it measures the page, so it draws on the other website's page as it is); with "Sharp", neither. */
  function withEdges(scripts, edges, base) {
    if (edges !== 'smooth') return scripts;
    return scripts.concat([{ src: new URL(base).origin + '/templates/_shared/rv-blend.js', global: 'RevampBlend' }]);
  }
  function commonJs(o) {
    var conf = { page: String(o.pageUrl || '').replace(/#.*$/, ''), scope: SCOPE, scripts: o.scripts.map(function (s) { var x = { src: s.src }; if (s.global) x.global = s.global; if (s.section) x.section = s.section; return x; }) };
    if (o.edges === 'smooth') conf.edges = 'smooth';
    return '(' + bare(embedLoader.toString()) + ')(' + JSON.stringify(conf).replace(/<\/(script)/gi, '<\\/$1') + ');';
  }
  /* What is pasted is only code: the comments that explain this file stay here (the owner, 13 Nov 2026: "only the code
     which are required should be visible"). bare(): a script's comments and blank lines out, strings and regular
     expressions kept whole; bareCss(): a stylesheet's comments out, strings kept whole. */
  function bare(js) {
    var out = '', i = 0, n = js.length, c, q, prev = '';
    while (i < n) {
      c = js.charAt(i);
      if (c === '"' || c === "'" || c === '`') {
        q = c; var j = i + 1;
        while (j < n && js.charAt(j) !== q) { if (js.charAt(j) === '\\') j++; j++; }
        out += js.slice(i, j + 1); i = j + 1; prev = q; continue;
      }
      if (c === '/' && js.charAt(i + 1) === '*') { var e = js.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
      if (c === '/' && js.charAt(i + 1) === '/') { while (i < n && js.charAt(i) !== '\n') i++; continue; }
      if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]$|^$|\breturn$|\btypeof$/.test(out.replace(/\s+$/, '').slice(-7))) {
        // a regular expression: up to its closing slash (a class [...] may hold one)
        var k = i + 1, inClass = false;
        while (k < n) { var ch = js.charAt(k); if (ch === '\\') { k += 2; continue; } if (ch === '[') inClass = true; else if (ch === ']') inClass = false; else if (ch === '/' && !inClass) break; else if (ch === '\n') break; k++; }
        out += js.slice(i, k + 1); i = k + 1; continue;
      }
      out += c; i++;
    }
    return out.split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return /\S/.test(l); }).join('\n');
  }
  function bareCss(css) {
    var out = '', i = 0, n = css.length, c, q;
    while (i < n) {
      c = css.charAt(i);
      if (c === '"' || c === "'") { q = c; var j = i + 1; while (j < n && css.charAt(j) !== q) { if (css.charAt(j) === '\\') j++; j++; } out += css.slice(i, j + 1); i = j + 1; continue; }
      if (c === '/' && css.charAt(i + 1) === '*') { var e = css.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
      out += c; i++;
    }
    return out.split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return /\S/.test(l); }).join('\n');
  }
  /* a section's own script (Developer zone › JS), handed to the common script: '' when it has none */
  function sectionJs(o) {
    var own = String(o.ownJs || '').trim();
    if (!own) return '';
    return [
      '(window.RevampEmbedQ = window.RevampEmbedQ || []).push([' + jsString(o.id) + ', function (section) {',
      own.split('\n').map(function (l) { return '  ' + l; }).join('\n'),
      '}]);'
    ].join('\n');
  }

  /* ---------- the CSS ---------- */

  /* what every selector begins with: the class every copied section carries, and the weight of four ids more */
  var SCOPE = '.rv-embed' + WEIGHT;

  /* which section a stylesheet is the own sheet of: { type } (style[data-rv-style]), { key } (a copy's renamed ids,
     style[data-rv-copy-for]) or { el } (a sheet inside a section: its developer-zone CSS); null for a sheet the page
     shares (gen-base.css, et-platform.css, a template's CSS…) */
  function sheetOwner(sheet) {
    var o = sheet.ownerNode;
    if (!o || !o.getAttribute) return null;
    if (o.hasAttribute('data-rv-style')) return { type: o.getAttribute('data-rv-style') };
    if (o.hasAttribute('data-rv-copy-for')) return { key: o.getAttribute('data-rv-copy-for') };
    var inSec = o.closest && o.closest('[data-rv-section]');
    return inSec ? { el: inSec } : null;
  }
  function belongsTo(own, sec) {
    if (own.el) return own.el === sec;
    if (own.type) return own.type === sec.getAttribute('data-rv-section');
    return own.key === sec.getAttribute('data-rv-key') || own.key === sec.id;
  }
  /* the rules of the sheets `pick` takes that reach one of the models' sections, for the other website */
  function collect(doc, base, pick, ctx) {
    var rules = [];
    Array.prototype.forEach.call(doc.styleSheets, function (sheet) {
      var owner = sheet.ownerNode;
      if (owner && owner.closest && owner.closest('[data-rv-editor]')) return;       // the editor's own look
      // the live page's own switches (rv-live.css: what has nothing to show is hidden — the copy leaves it out —
      // and which internal page shows): about the event's page, not a section on another website
      if (owner && owner.hasAttribute && owner.hasAttribute('data-rv-runtime')) return;
      if (owner && owner.closest && owner.closest('.is-hidden-sec')) return;         // a hidden section's
      if (sheet.disabled || !pick(sheetOwner(sheet))) return;
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
    return rules;
  }
  /* what rules use: @keyframes by name, @font-face by family, @property by name */
  function extrasFor(text, ctx, families) {
    var extra = [];
    ctx.props.forEach(function (p) { if (text.indexOf(p.name) !== -1 && extra.indexOf(p.text) === -1) extra.push(p.text); });
    fontFacesFor(ctx, families).forEach(function (t) { if (extra.indexOf(t) === -1) extra.push(t); });
    var animated = (text.match(/animation(?:-name)?\s*:[^;}]*/gi) || []).join(' ');
    ctx.keyframes.forEach(function (k) {
      if (new RegExp('(^|[\\s,:])' + String(k.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[\\s,;])').test(animated) && extra.indexOf(k.text) === -1) extra.push(k.text);
    });
    return extra;
  }
  /* ---------- fonts: only the faces the copied sections use ----------
     The owner, 13 Nov 2026: "too many unwanted code … only the code which are required should be visible". The page's
     font stylesheet names every weight of each family and every alphabet (latin, latin-ext, vietnamese…): more than
     half of the common CSS. The copy keeps, for each family the sections use, the weights their text is set in (and
     400 and 700, for what the runtimes and the pop-ups show), its styles, and only the alphabets their letters are in;
     the faces of one variable font (one file for every weight) become one face with its weights as a range. */
  function fontUse(win, models, ctx) {
    var use = {}, chars = {}, i;
    for (i = 0x20; i < 0x7f; i++) chars[i] = 1;
    if (!win) return;
    models.forEach(function (m) {
      var all = [m.sec].concat(Array.prototype.slice.call(m.sec.querySelectorAll('*')));
      all.forEach(function (el) {
        var text = '';
        for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) text += n.nodeValue;
        if (!/\S/.test(text) && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) return;
        for (var k = 0; k < text.length; k++) chars[text.charCodeAt(k)] = 1;
        var cs = win.getComputedStyle(el), fam = String(cs.fontFamily || '').split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
        if (!fam) return;
        var u = use[fam] = use[fam] || { weights: {}, styles: {} };
        u.weights[parseInt(cs.fontWeight, 10) || 400] = 1;
        u.styles[/italic|oblique/.test(cs.fontStyle) ? 'italic' : 'normal'] = 1;
      });
    });
    ctx.fontUse = use;
    ctx.chars = chars;
  }
  function faceWeights(w) { var m = String(w || '400').match(/\d+/g) || [400]; return [+m[0], +(m[1] || m[0])]; }
  function rangeHits(range, chars) {
    if (!range) return true;
    return range.split(',').some(function (part) {
      var m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part);
      if (!m) return true;
      var a = parseInt(m[1].replace(/\?/g, '0'), 16), b = m[2] ? parseInt(m[2], 16) : (m[1].indexOf('?') !== -1 ? parseInt(m[1].replace(/\?/g, 'f'), 16) : a);
      for (var c in chars) if (+c >= a && +c <= b) return true;
      return false;
    });
  }
  function fontFacesFor(ctx, families) {
    var faces = ctx.fontFaces.filter(function (f) { return f.family && families.indexOf(f.family) !== -1; });
    if (!ctx.fontUse) return faces.map(function (f) { return f.text; });
    var keep = [];
    var byFam = {};
    faces.forEach(function (f) { (byFam[f.family] = byFam[f.family] || []).push(f); });
    Object.keys(byFam).forEach(function (fam) {
      var u = ctx.fontUse[fam] || { weights: {}, styles: { normal: 1 } };
      var want = Object.keys(u.weights).map(Number).concat([400, 700]);
      var styles = Object.keys(u.styles).concat(['normal']);
      var list = byFam[fam].filter(function (f) { return styles.indexOf(/italic|oblique/.test(f.style) ? 'italic' : 'normal') !== -1 && rangeHits(f.range, ctx.chars); });
      want.forEach(function (w) {
        var exact = list.filter(function (f) { var r = faceWeights(f.weight); return w >= r[0] && w <= r[1]; });
        if (!exact.length) {
          var best = null, d = Infinity;
          list.forEach(function (f) { var r = faceWeights(f.weight), x = Math.min(Math.abs(r[0] - w), Math.abs(r[1] - w)); if (x < d) { d = x; best = r[0]; } });
          exact = list.filter(function (f) { return faceWeights(f.weight)[0] === best; });
        }
        exact.forEach(function (f) { if (keep.indexOf(f) === -1) keep.push(f); });
      });
    });
    // one variable font: the same file for each weight -> one face, its weights as a range
    var groups = [], seen = {};
    faces.forEach(function (f) {
      if (keep.indexOf(f) === -1) return;
      var key = f.family + '|' + f.style + '|' + f.src + '|' + f.range;
      if (seen[key]) { seen[key].push(f); return; }
      seen[key] = [f];
      groups.push(seen[key]);
    });
    return groups.map(function (g) {
      if (g.length === 1 || !g[0].src) return g[0].text;
      var lo = Infinity, hi = -Infinity;
      g.forEach(function (f) { var r = faceWeights(f.weight); lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); });
      return g[0].text.replace(/font-weight:\s*[^;}]+/, 'font-weight: ' + (lo === hi ? lo : lo + ' ' + hi));
    });
  }

  /* the Google Fonts (and any other site's stylesheets) the page loads for the families in use */
  function fontLinks(doc, base, ctx, families) {
    var links = [];
    function take(href) {
      if (/fonts\.googleapis\.com/.test(href)) {
        var fam = fontFamiliesOfUrl(href);
        if (fam.length && !fam.some(function (f) { return families.indexOf(f) !== -1; })) return;
      }
      if (links.indexOf(href) === -1) links.push(href);
    }
    Array.prototype.forEach.call(doc.querySelectorAll('link[rel~="stylesheet"][href]'), function (l) {
      if (l.closest('[data-rv-editor]')) return;
      var href = absolute(l.getAttribute('href'), base);
      if (/fonts\.googleapis\.com/.test(href) || ctx.links.indexOf(href) !== -1) take(href);   // our own sheets: their rules are in the CSS
    });
    ctx.links.forEach(take);
    return links;
  }
  /* the section as the copy has it, and the copy of the page its selectors are tried on */
  function prepare(doc, sec, o, base, remPx) {
    var id = sec.getAttribute('data-rv-section') || sec.id || 'section';
    var copy = sec.cloneNode(true);
    sizePictures(sec, copy);
    oneLogo(sec, copy);
    var info = finishHtml(copy, { pageUrl: o.pageUrl, base: base, remPx: remPx, awards: !!(doc.body && doc.body.hasAttribute('data-rv-awards')) });
    rootAttrs(doc, copy, id);
    return { id: id, sec: sec, copy: copy, info: info, page: pageModel(doc, sec, copy), embed: embedModel(doc, copy) };
  }
  function newCtx(doc, models) {
    // the classes anything on the page has: one a script adds later is a state (testable)
    var classes = {};
    function note(n) { Array.prototype.forEach.call(n.classList, function (c) { classes[c] = 1; }); }
    Array.prototype.forEach.call(doc.querySelectorAll('[class]'), note);
    // the copy's own root too (rv-embed, rv-embed-<id>): a rule's form for a section inside a wrapper then reaches
    // nothing and is left out — the copy is one <section>, so each rule is written once
    models.forEach(function (m) { note(m.copy); Array.prototype.forEach.call(m.copy.querySelectorAll('[class]'), note); });
    var ctx = { scope: SCOPE, models: models, win: doc.defaultView, knownClass: function (c) { return !!classes[c]; }, links: [], fontFaces: [], keyframes: [], props: [] };
    fontUse(doc.defaultView, models, ctx);
    ctx.motion = motionPlan(doc, ctx);
    return ctx;
  }
  /* The CSS every copied section needs, for the sections given: the fonts, the reset, the page's look on the
     sections (the theme's variables and the inherited text, on .rv-embed — a section's own rules outweigh it) and
     the rules of the sheets the page shares that reach them. */
  function commonCss(doc, win, models, base, remPx, ctx, ownText) {
    var shared = collect(doc, base, function (own) { return !own; }, ctx);
    var text = shared.join('\n');
    var names = varsUsed(text + ' ' + ownText + ' ' + models.map(function (m) { return m.copy.outerHTML; }).join(' '));
    var look = wrapperStyle(win, models[0].sec, names).filter(function (p) { return p[0] !== 'background-color'; });
    var lookText = look.map(function (p) { return p[0] + ': ' + p[1]; }).join('; ');
    var families = familiesUsed(text + ' ' + ownText + ' ' + lookText);
    var extra = extrasFor(text + ' ' + lookText, ctx, families);
    var imports = fontLinks(doc, base, ctx, families).map(function (h) { return '@import url("' + h.replace(/"/g, '%22') + '");'; });
    return (imports.length ? imports.join('\n') + '\n' : '') + resetCss(SCOPE) + '\n' +
      '/* the event page’s look on every copied section: its theme and its text; a section’s own rules outweigh it */\n' +
      SCOPE + ' { ' + important(lookText) + ' }\n' + remToPx(extra.concat(shared).join('\n'), remPx);
  }

  /* The event site's banner fills most of the screen and keeps generous room above its content; on another website
     the page's own header stands above it and that room reads as a gap (the owner, 13 Nov 2026: "what about the
     padding issue?" — chose to tighten it in the copy). The copy's banner is as tall as its content, with the room
     below it above it too (scaled down on a phone, 32px at least). Only the page's banner — its hero (an AI-designed
     or awards site), its banner (a template), or the section holding its h1 — and only when it has that extra room. */
  function isBanner(sec, id) { return /^(hero|banner)$/i.test(id) || !!sec.querySelector('h1'); }

  /* ---------- pictures: the banner's first, the rest as they come into view ----------
     The owner, 13 Nov 2026, with a Lighthouse report of the CMS page: "I need it 90+ there as well". Its largest
     paint was the banner's picture — a CSS background, which the browser only finds once the page's styles are in
     (1.46 s of its 2.9 s went before it was even asked for). So the copy names it early: a <link rel="preload"
     as="image" fetchpriority="high"> in the banner (an <img> banner gets fetchpriority="high"), placed where the
     section's own CSS does not count children (:first-child / :last-child…). Every picture below the banner waits
     until it is near the view (loading="lazy"), and so does the banner's dark-theme logo, which is hidden. A picture
     without width and height gets the size the page has it at, so nothing moves when it arrives. */
  function sizePictures(sec, copy) {
    var live = sec.querySelectorAll('img'), mine = copy.querySelectorAll('img');
    if (live.length !== mine.length) return;
    Array.prototype.forEach.call(mine, function (img, i) {
      var l = live[i];
      if (img.hasAttribute('width') || img.hasAttribute('height') || !(l.naturalWidth > 0 && l.naturalHeight > 0)) return;
      img.setAttribute('width', String(l.naturalWidth));
      img.setAttribute('height', String(l.naturalHeight));
    });
  }
  /* One logo (the owner, 13 Nov 2026: "two version of logo is being rendered in the hero section. ideally it should be
     one, because the theme switch dosen't work there"): a light hero carries its logo for a dark ground beside its own
     (.rv-lu-dark), shown only in a dark theme. The copy is made for one theme (the copy view's Theme), so the logo
     unit keeps only the picture that theme shows; the other one is left out (with its rules, which then reach nothing). */
  function oneLogo(sec, copy) {
    var win = sec.ownerDocument.defaultView;
    var live = sec.querySelectorAll('.rv-lu img'), mine = copy.querySelectorAll('.rv-lu img');
    if (!win || live.length !== mine.length) return;
    Array.prototype.forEach.call(live, function (img, i) {
      if (win.getComputedStyle(img).display !== 'none') return;
      img.__rvLeftOut = true;
      mine[i].parentNode.removeChild(mine[i]);
    });
  }
  /* the section's pictures that are in the copy (oneLogo leaves some out): the same order as the copy's */
  function livePictures(sec) { return Array.prototype.filter.call(sec.querySelectorAll('img'), function (el) { return !el.__rvLeftOut; }); }
  function urlsIn(text) {
    var out = [], re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g, m;
    while ((m = re.exec(String(text || '')))) out.push(m[2]);
    return out;
  }
  function pictures(win, sec, copy, id, ownCss) {
    var imgs = Array.prototype.slice.call(copy.querySelectorAll('img'));
    if (!isBanner(sec, id)) {
      imgs.forEach(function (img) {
        if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
        if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
      });
      return;
    }
    imgs.forEach(function (img) { if (img.classList.contains('rv-lu-dark')) img.setAttribute('loading', 'lazy'); });
    // the banner's picture: the largest element in it (itself first) that has a background picture, else its largest <img>
    var best = null, area = 0;
    [sec].concat(Array.prototype.slice.call(sec.querySelectorAll('*'))).forEach(function (el) {
      var bg = win.getComputedStyle(el).backgroundImage, r = el.getBoundingClientRect(), a = r.width * r.height;
      if (bg && bg.indexOf('url(') !== -1 && a > area) { best = el; area = a; }
    });
    var bigImg = null, imgArea = 0;
    livePictures(sec).forEach(function (el, i) {
      var r = el.getBoundingClientRect(), a = r.width * r.height;
      if (a > imgArea && !el.classList.contains('rv-lu-dark')) { bigImg = imgs[i]; imgArea = a; }
    });
    if (bigImg && imgArea >= area) {
      bigImg.setAttribute('fetchpriority', 'high');
      bigImg.removeAttribute('loading');
      return;
    }
    if (!best) return;
    // the address the browser takes: a WebP in image-set() where there is one, else the first url()
    var text = best.getAttribute('style') || win.getComputedStyle(best).backgroundImage;
    var webp = /image-set\([^]*?url\(\s*['"]?([^'")]+)['"]?\s*\)\s*type\(\s*['"]image\/webp['"]\s*\)/i.exec(text);
    var href = webp ? webp[1] : urlsIn(text)[0];
    if (!href || /^data:/i.test(href)) return;
    var link = copy.ownerDocument.createElement('link');
    link.setAttribute('rel', 'preload');
    link.setAttribute('as', 'image');
    link.setAttribute('href', href);
    link.setAttribute('fetchpriority', 'high');
    if (webp) link.setAttribute('type', 'image/webp');
    placeQuiet(copy, link, ownCss);
  }

  /* On an ETB2B microsite page (the owner, 13 Nov 2026: "The margin-top: 151px css was not there earlier in this
     website, as soon as I have added the hero section code, it was added automatically"): ETB2B's footer script
     (etb2b_footer_event_v2.js, "Header Height Adjustment") pushes the whole page down by its header's height + 50px
     — once the page is ready, so everything moves — unless the page has a banner of its own (#banner or #page-hdr).
     ETB2B's own banner starts at the very top, under its fixed, see-through header (99–101px at every width), with
     room above its content for that header. The copy's banner does the same: it carries a hidden #banner mark, and on
     a page with ETB2B's header (#ms_header_oauth_wrapper) its room above starts below that header — 100px, or the
     header's own height where it differs (the common script measures it: --rv-etb2b-head). */
  var ETB2B_HEAD = '#ms_header_oauth_wrapper';
  function bannerRoom(win, sec, id) {
    if (!isBanner(sec, id)) return '';
    var cs = win.getComputedStyle(sec), vh = win.innerHeight || 900, vw = win.innerWidth || 1440;
    var pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0, mh = parseFloat(cs.minHeight) || 0;
    var tight = !(pt <= pb + 8 && mh < vh * 0.5);
    var room = Math.max(32, Math.round(tight ? pb : pt));
    var top = 'clamp(32px, ' + (Math.round(room / vw * 10000) / 100) + 'vw, ' + room + 'px)';
    var sel = (sec.id ? '#' + sec.id.replace(/[^\w-]/g, '\\$&') : '') + new Array(4).join('.' + scopeId(id)) + SCOPE;
    return (tight ? '\n/* on another website: the banner as tall as its content, with as much room above as below it */\n' + sel +
      ' { min-height: 0 !important; padding-top: ' + top + ' !important; }' : '') +
      '\n/* on an ETB2B page without a banner of its own: the banner starts under its fixed header, as ETB2B’s own banner does, its room above below that header */\n' +
      'body:has(' + ETB2B_HEAD + '):not(:has(section#banner:not(.rv-embed))) ' + sel + ' { padding-top: calc(var(--rv-etb2b-head, 100px) + ' + top + ') !important; }';
  }
  /* the hidden #banner mark (where the banner is not #banner already), placed where it does not count as a child */
  function bannerMark(sec, copy, id, ownCss) {
    if (!isBanner(sec, id) || copy.id === 'banner' || copy.querySelector('[id="banner"]')) return;
    var mark = copy.ownerDocument.createElement('i');
    mark.setAttribute('id', 'banner');
    mark.setAttribute('hidden', '');
    mark.setAttribute('aria-hidden', 'true');
    mark.setAttribute('style', 'display:none !important');
    placeQuiet(copy, mark, ownCss);
  }
  /* an element of the copy's own (a preload link, the banner mark) goes first, or last where the section's CSS counts
     its first children; where it counts both, a preload link stays out and the mark goes inside the first child */
  function placeQuiet(copy, el, ownCss) {
    var counts = String(ownCss || '');
    var first = /:(first-child|nth-child|first-of-type|only-child|only-of-type)/.test(counts), last = /:(last-child|nth-last-child|last-of-type|only-child|only-of-type)/.test(counts);
    if (!first) copy.insertBefore(el, copy.firstChild);
    else if (!last) copy.appendChild(el);
    else if (el.localName !== 'link' && copy.firstElementChild && !VOID_TAGS.test(copy.firstElementChild.localName)) copy.firstElementChild.appendChild(el);
  }

  /* ---------- the copies ---------- */

  /* The HTML of an element, written so that no attribute value holds a double quote: ETB2B's CMS turns &quot; back
     into " when it saves a section, which ended the attribute there (a font name in style="…" broke the rest of it).
     A value with a " is written between single quotes instead (only one with both kinds keeps &quot;). Comments go. */
  var VOID_TAGS = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
  function htmlOf(node) {
    if (node.nodeType === 3) return String(node.nodeValue).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
    if (node.nodeType !== 1) return '';
    var name = node.localName || node.tagName.toLowerCase(), out = '<' + name;
    Array.prototype.forEach.call(node.attributes, function (a) {
      var v = String(a.value).replace(/&/g, '&amp;');
      if (v.indexOf('"') === -1) out += ' ' + a.name + '="' + v + '"';
      else if (v.indexOf("'") === -1) out += ' ' + a.name + "='" + v + "'";
      else out += ' ' + a.name + '="' + v.replace(/"/g, '&quot;') + '"';
    });
    out += '>';
    if (VOID_TAGS.test(name) && !node.namespaceURI || VOID_TAGS.test(name) && /xhtml/.test(node.namespaceURI)) return out;
    var kids = name === 'template' && node.content ? node.content.childNodes : node.childNodes;
    if (/^(script|style)$/.test(name)) out += node.textContent;
    else Array.prototype.forEach.call(kids, function (k) { out += htmlOf(k); });
    return out + '</' + name + '>';
  }

  /* each box as ETB2B's CMS takes it — its code as it is put on the page, with its own tags ('' stays '') */
  function styleBox(css) { css = bareCss(String(css || '')); return css ? '<style>\n' + css.replace(/<\/(style)/gi, '<\\/$1') + '\n</style>' : ''; }
  function scriptBox(js) { return js ? '<script>\n' + String(js).replace(/<\/(script)/gi, '<\\/$1') + '\n</script>' : ''; }

  /* One section: its HTML (one <section>), its own CSS and JS, and — for a website that takes one HTML field, and
     the test page — the whole of it with the common CSS and JS it needs. */
  function build(o) {
    var doc = o.doc, win = o.win, sec = o.section;
    var base = doc.baseURI || (win && win.location && win.location.href) || location.href;
    var remPx = parseFloat(win.getComputedStyle(doc.documentElement).fontSize) || 16;
    var m = prepare(doc, sec, o, base, remPx), id = m.id, copy = m.copy, info = m.info;
    var title = (o.sectionName || id) + (o.eventName ? ' — ' + o.eventName : '');
    var ctx = newCtx(doc, [m]);
    motionInline(m, ctx);
    var own = collect(doc, base, function (o2) { return !!o2 && belongsTo(o2, sec); }, ctx);
    var ownText = own.join('\n');
    var families = familiesUsed(ownText);
    var ground = wrapperStyle(win, sec, []).filter(function (p) { return p[0] === 'background-color'; })[0];
    var groundRule = ground ? '/* the event page\u2019s ground behind this section */\n.' + scopeId(id) + WEIGHT + ' { background-color: ' + ground[1] + ' !important; }\n' : '';
    var css = groundRule + remToPx(extrasFor(ownText, ctx, families).concat(own).join('\n'), remPx) + bannerRoom(win, sec, id);
    var common = commonCss(doc, win, [m], base, remPx, ctx, ownText);
    pictures(win, sec, copy, id, css);
    bannerMark(sec, copy, id, css);
    var html = htmlOf(copy);
    var js = sectionJs({ id: id, title: title, ownJs: info.js });
    var jsCommon = commonJs({ title: o.eventName || title, pageUrl: o.pageUrl, scripts: withEdges(scriptsFor(doc, [m], base), o.edges, base), edges: o.edges });
    var allJs = jsCommon + (js ? '\n' + js : '');
    // one block: the styles first (no unstyled moment), the section, then the script
    var all = '<style>\n' + bareCss(common + '\n' + css).replace(/<\/(style)/gi, '<\\/$1') + '\n</style>\n' +
      html + '\n<script>\n' + allJs.replace(/<\/(script)/gi, '<\\/$1') + '\n</script>';
    var page = '<!DOCTYPE html>\n<html lang="' + (doc.documentElement.getAttribute('lang') || 'en') + '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
      title.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</title>\n</head>\n<body style="margin:0">\n' + all + '\n</body>\n</html>\n';
    var records = !!copy.querySelector('[data-rv-filled], [data-rv-item], [data-rv-id]');
    var notes = [];
    if (info.hidden) notes.push('The event’s site does not show this section now (it has nothing to show), so the copy shows nothing either.');
    if (records) notes.push('The event’s records are in the copy as they are now: copy it again after changing them in Content.');
    if (info.forms) notes.push('Forms open on the event’s own website: the buttons here lead there.');
    return { id: id, html: html, css: styleBox(css), js: scriptBox(js), common: { css: styleBox(common), js: scriptBox(jsCommon) }, all: all, page: page, records: records, hidden: info.hidden, forms: info.forms, ownJs: !!js, notes: notes };
  }

  /* The common CSS and JS for every section of the page given (those on view): pasted once — ETB2B's CMS has a global
     section for it — they serve every section copied from this site. */
  function buildCommon(o) {
    var doc = o.doc, win = o.win;
    var base = doc.baseURI || (win && win.location && win.location.href) || location.href;
    var remPx = parseFloat(win.getComputedStyle(doc.documentElement).fontSize) || 16;
    var models = o.sections.map(function (sec) { return prepare(doc, sec, o, base, remPx); });
    if (!models.length) return { error: 'There is no section on the page to copy.' };
    var ctx = newCtx(doc, models);
    // the sections' own sheets: only for the variables and fonts they use (their rules go with each section)
    var ownText = '';
    Array.prototype.forEach.call(doc.styleSheets, function (sheet) {
      var own = sheetOwner(sheet), node = sheet.ownerNode;
      if (own && node && node.textContent) ownText += ' ' + node.textContent;
    });
    var css = commonCss(doc, win, models, base, remPx, ctx, ownText);
    var title = o.eventName || 'This event';
    return { css: styleBox(css), js: scriptBox(commonJs({ title: title, pageUrl: o.pageUrl, scripts: withEdges(scriptsFor(doc, models, base), o.edges, base), edges: o.edges })), sections: models.length };
  }

  /* ---------- motion: what moves on the event's page moves in the copy ----------
     The owner, 13 Nov 2026: "most of the animation work are dropped on the etb2b cms". Every declaration of the copy
     is !important (as ETB2B's CMS sections are written), and an important declaration outweighs an animation: in the
     cascade animations stand above normal declarations and below important ones (transitions stand above both, so
     hovers and easing in were never stopped). On the event's page a section's own rules are normal ones, and its
     keyframes move what they set; in the copy, the rule that places the Recognition card's rays (transform:
     translate(-50%, -50%)) held them still, its sparks stayed at their opacity: 0 for good, and the halo only faded —
     and a ported template's blocks that ease in (.fadeInUp.go: opacity 0 to 1) would have stayed invisible. So:
       · what an animation moves on an element is written without !important in the rules that reach that element
         (and in its own style="…"): the animation moves it again. Those rules still outweigh the other website's own
         (four ids against its three; ETB2B's few important rules do not set what moves), and as they all lose
         !important together, they still win over one another as on the event's page;
       · what moves where: a rule naming keyframes (animation / animation-name, any state: :hover, .go…) and the
         elements it reaches here (its ::before / ::after apart), and an imported page's recorded motion
         (data-rv-motion: et-runtime.js plays it with el.animate and sets its scroll-tied properties);
       · a keyframes name the copy carries is its own: one that is not ours (rv-…) becomes rv-embed-<name>, in every
         animation naming it — ETB2B's pages have keyframes of their own (pulse, rotate, fa-spin…) and the ported
         templates' have the same names, so neither would overwrite the other's.
     ctx.motion = { kf: { name: { property: 1 } }, marked: [element of a page model] }, each marked element carrying
     __rvMoves: { '' | '::before' | …: { property: 1 } }. */
  var KEYFRAMES_PREFIX = 'rv-embed-';
  function motionName(name) { name = String(name || ''); return !name || /^rv-/.test(name) ? name : KEYFRAMES_PREFIX + name; }
  function motionHas(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  /* the pseudo-element a selector styles ('' for the element itself) */
  function motionPseudo(sel) {
    var parts = compoundsOf(sel).parts, last = simplesOf(parts[parts.length - 1] || ''), out = '';
    last.forEach(function (t) { if (PSEUDO_ELEMENT.test(t)) out = '::' + t.replace(/^:+/, '').replace(/\(.*$/, '').toLowerCase(); });
    return out;
  }
  /* the keyframes rule as the copy writes it: under its own name */
  function motionKeyframes(rule) {
    var name = motionName(rule.name), text = String(rule.cssText || '');
    if (name !== rule.name) text = text.replace(/^(\s*@(?:-webkit-)?keyframes\s+)(["']?)[^\s{"']+\2/i, function (m, at) { return at + name; });
    return { name: name, text: text };
  }
  /* declarations' text with the keyframes the plan knows renamed in animation / animation-name (keywords, timing
     functions and names it does not know are left) */
  function motionNames(text, plan) {
    var known = plan && plan.kf;
    if (!known) return text;
    return String(text || '').replace(/((?:^|[;{\s])(?:-webkit-)?animation(?:-name)?\s*:)([^;{}]*)/gi, function (m, head, value) {
      return head + value.replace(/(^|[\s,])([A-Za-z_-][\w-]*)(?=$|[\s,!])/g, function (t, pre, word) {
        return motionHas(known, word) ? pre + motionName(word) : t;
      });
    });
  }
  /* a declaration that sets something `soft` holds — itself, or a shorthand of it (background for
     background-position, inset for top…) */
  var MOTION_INSET = { top: 1, right: 1, bottom: 1, left: 1 };
  function motionSoftens(decl, soft) {
    var name = String(decl).slice(0, String(decl).indexOf(':')).trim();
    if (!name) return false;
    if (name.indexOf('--') !== 0) name = name.toLowerCase();
    if (motionHas(soft, name)) return true;
    for (var p in soft) if (motionHas(soft, p) && (p.indexOf(name + '-') === 0 || name === 'inset' && MOTION_INSET[p])) return true;
    return false;
  }
  function motionProp(k) { return k === 'cssFloat' ? 'float' : String(k).replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }
  function motionPlan(doc, ctx) {
    var plan = { kf: {}, marked: [] }, naming = [];
    function scan(rules) {
      Array.prototype.forEach.call(rules || [], function (r) {
        if (r.type === 7) {
          var props = plan.kf[r.name] = plan.kf[r.name] || {};
          Array.prototype.forEach.call(r.cssRules || [], function (k) {
            for (var i = 0; k.style && i < k.style.length; i++) if (!/^animation-/.test(k.style[i])) props[k.style[i]] = 1;
          });
          return;
        }
        if (r.type === 3) { try { if (r.styleSheet) scan(r.styleSheet.cssRules); } catch (e) { /* another site's sheet */ } return; }
        if (r.type === 1 && r.style && /animation/i.test(r.style.cssText || '')) naming.push(r);
        if (r.cssRules && r.cssRules.length) scan(r.cssRules);       // @media, @supports, @layer… and nested rules
      });
    }
    // the sheets the copy is made from (collect's own choice)
    Array.prototype.forEach.call(doc.styleSheets || [], function (sheet) {
      var o = sheet.ownerNode;
      if (sheet.disabled || o && o.closest && (o.closest('[data-rv-editor]') || o.closest('.is-hidden-sec')) || o && o.hasAttribute && o.hasAttribute('data-rv-runtime')) return;
      try { scan(sheet.cssRules); } catch (e) { /* another site's sheet */ }
    });
    function mark(el, pseudo, props) {
      if (!el.__rvMoves) { el.__rvMoves = {}; plan.marked.push(el); }
      var p = el.__rvMoves[pseudo] = el.__rvMoves[pseudo] || {};
      for (var k in props) if (motionHas(props, k)) p[k] = 1;
    }
    function inSection(m, el) { return m.page.section === el || m.page.section.contains(el); }
    naming.forEach(function (r) {
      var names = [], re = /animation(?:-name)?\s*:([^;]*)/gi, d, w, words = /[A-Za-z_-][\w-]*/g;
      String(r.style.getPropertyValue('animation-name') || '').split(',').forEach(function (n) { n = n.trim().replace(/^["']|["']$/g, ''); if (motionHas(plan.kf, n) && names.indexOf(n) === -1) names.push(n); });
      while (!names.length && (d = re.exec(r.style.cssText))) while ((w = words.exec(d[1]))) if (motionHas(plan.kf, w[0]) && names.indexOf(w[0]) === -1) names.push(w[0]);
      if (!names.length) return;
      var props = {};
      names.forEach(function (n) { for (var p in plan.kf[n]) if (motionHas(plan.kf[n], p)) props[p] = 1; });
      splitTop(r.selectorText, ',').forEach(function (sel) {
        var t = testable(sel, ctx.knownClass), pseudo = motionPseudo(sel);
        ctx.models.forEach(function (m) {
          var found = [];
          try { found = m.page.doc.querySelectorAll(t); } catch (e) { return; }
          Array.prototype.forEach.call(found, function (el) { if (inSection(m, el)) mark(el, pseudo, props); });
        });
      });
    });
    // an imported page's recorded motion: its entrances' and loops' keyframes, its scroll-tied properties
    ctx.models.forEach(function (m) {
      var s = m.page.section;
      [s].concat(Array.prototype.slice.call(s.querySelectorAll('[data-rv-motion]'))).forEach(function (el) {
        var rec = null, props = {}, any = false;
        if (!el.hasAttribute('data-rv-motion')) return;
        try { rec = JSON.parse(el.getAttribute('data-rv-motion')); } catch (e) { return; }
        if (!rec || typeof rec !== 'object') return;
        (rec.a || []).concat(rec.l || []).forEach(function (x) {
          var ks = x && x.k ? (Array.isArray(x.k) ? x.k : [x.k]) : [];
          ks.forEach(function (f) { for (var k in f) if (motionHas(f, k) && !/^(offset|easing|composite)$/.test(k)) { props[motionProp(k)] = 1; any = true; } });
        });
        if (rec.s && typeof rec.s === 'object') for (var k in rec.s) if (motionHas(rec.s, k)) { props[k] = 1; any = true; }
        if (any) mark(el, '', props);
      });
    });
    return plan;
  }
  /* what an animation moves where this rule reaches (null: nothing) */
  function motionSoft(rule, ctx) {
    var plan = ctx.motion, soft = null;
    if (!plan || !plan.marked.length || !rule.selectorText) return null;
    splitTop(rule.selectorText, ',').forEach(function (sel) {
      var t = testable(sel, ctx.knownClass), pseudo = motionPseudo(sel);
      plan.marked.forEach(function (el) {
        var p = el.__rvMoves[pseudo];
        if (!p || !matchesEl(el, t)) return;
        for (var k in p) if (motionHas(p, k)) { soft = soft || {}; soft[k] = 1; }
      });
    });
    return soft;
  }
  /* the copy's style="…": keyframes under their own names, and what moves on that element not !important */
  function motionUnimportant(style, soft) {
    return splitTop(style, ';').map(function (d) { return motionSoftens(d, soft) ? d.replace(/\s*!\s*important\s*$/i, '') : d; }).join('; ') + ';';
  }
  function motionInline(m, ctx) {
    var plan = ctx.motion;
    if (!plan) return;
    var page = [m.page.section].concat(Array.prototype.slice.call(m.page.section.querySelectorAll('*')));
    var mine = [m.copy].concat(Array.prototype.slice.call(m.copy.querySelectorAll('*')));
    if (page.length !== mine.length) return;
    mine.forEach(function (el, i) {
      var st = el.getAttribute('style');
      if (!st) return;
      var moves = page[i].__rvMoves && page[i].__rvMoves[''], next = motionNames(st, plan);
      if (moves) next = motionUnimportant(next, moves);
      if (next !== st) el.setAttribute('style', next);
    });
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
    buildCommon: buildCommon,
    loadPage: loadPage,
    _test: { splitTop: splitTop, compoundsOf: compoundsOf, joinCompounds: joinCompounds, simplesOf: simplesOf, testable: testable,
      absolute: absolute, absoluteUrls: absoluteUrls, remToPx: remToPx, varsUsed: varsUsed, familiesUsed: familiesUsed,
      fontFamiliesOfUrl: fontFamiliesOfUrl, important: important, htmlOf: htmlOf, singleQuoted: singleQuoted, inheritFrom: inheritFrom, styleBox: styleBox, scriptBox: scriptBox, commonJs: commonJs, sectionJs: sectionJs, embedLoader: embedLoader, jsString: jsString, resetCss: resetCss, scopeId: scopeId, RUNTIME_MADE: RUNTIME_MADE, bare: bare, bareCss: bareCss, fontFacesFor: fontFacesFor, rangeHits: rangeHits, withEdges: withEdges }
  };
  // the motion helpers, for functions/lib/editor-dev-export.test.js (section 2h)
  root.RevampDevExport._test.motion = { name: motionName, names: motionNames, keyframes: motionKeyframes, softens: motionSoftens, pseudo: motionPseudo,
    plan: motionPlan, soft: motionSoft, unimportant: motionUnimportant, inline: motionInline };
})(typeof window !== 'undefined' ? window : this);
