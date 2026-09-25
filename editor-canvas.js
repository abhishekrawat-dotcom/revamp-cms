/* Template canvas for the site editor (custom_editor.html?template=<id>).

   The template (templates/<id>, assembled by templates/_shared/template-loader.js) is loaded into a same-origin
   iframe inside #frame, rendered at a real device width and scaled down to fit, so the canvas shows the site's own
   desktop or phone layout rather than whatever width the editor happens to have. Its CSS and scripts run untouched;
   the editor reaches into the iframe document directly and drives it with its existing selection and toolbars.

   RevampCanvas.mount(frameEl, templateId) -> Promise<canvas>
     canvas.iframe, .doc, .win      the canvas document
     canvas.template                the template's template.json
     canvas.setDevice(name)         'desktop' (1440px) or 'mobile' (390px)
     canvas.fit()                   re-measure after the editor's layout changes
     canvas.screenRect(el)          an element's box in editor-window coordinates
     canvas.inView(el)              whether any of it is inside the visible canvas
     canvas.design.get(key) / .set(key, value)
                                    theme settings (colour, fonts, sizes, spacing, heading look, radius, dividers …)
     canvas.sections()              section roots, in page order
     canvas.serialize()             the page as published: editor markers stripped, hidden sections left out

   Saving (the editor keeps these per event, and as its undo/redo steps)
     canvas.snapshot(prev)          what the user has changed, as a plain object (see below); prev lets unchanged
                                    parts share memory with the previous snapshot
     canvas.restore(snap, opts)     puts a snapshot back in place, reusing every element that didn't change;
                                    returns the sections it had to rebuild. opts.siteCss: as createGenericSection
     canvas.sameSnapshot(a, b)      whether two snapshots describe the same page

   Sections (all of them work on real DOM in the iframe, so the result is the page itself — nothing to translate back)
     canvas.library()                        the template's own sections as they were when it loaded
     canvas.createLibrarySection(id)         a fresh copy of one of them, ready to insert
     canvas.createGenericSection(name, html, siteCss)
                                             one of the editor's generic sections, dressed in the template's tokens
     canvas.adopt(el)                        after inserting: unique ids (+ their CSS), section scripts started
     canvas.retag(el)                        after changing markup in place: marks what has become editable
     canvas.openItem(el)                     opens the accordion item around el (template.json → sections[].toggle)
                                             so its hidden part can be edited; editor-only, never saved
     canvas.setPicture(el, url)              a new picture in an image slot: <img>, <svg> icon, or image box
     canvas.pictureOf(el)                    the URL it shows now ('' for a drawn icon)
     canvas.duplicateSection(sec, name)      copy placed right after the original, already adopted
     canvas.removeSection(sec)               removes it with any CSS made for it
     canvas.contentRoot()                    where sections live when the page has none left */
(function () {
  'use strict';

  var DEVICES = { desktop: 1440, mobile: 390 };
  var EDITOR_CSS = new URL('editor-canvas.css', document.currentScript.src).href;

  /* ---------- which elements are editable ----------
     Template markup is ET's, so nothing carries editor markers. They are worked out per section:
       data-ed="text|image|button|none"  explicit override on an element (wins over everything below)
       <img>                             image
       inline <svg> that draws something image too — ET's icons (spotlight, power chain …) are inline SVG; replacing
                                         one keeps the <svg> and its CSS (size, hover) and swaps the drawing
       <a> with text                     button — label and link are edited, not its inner markup
       element with its own text         text — edited as a whole, inline markup (<clr>, <strong>, <br>) kept
     Images, icons and links inside a text element are still marked, so they can be picked on their own.
     Elements that never hold content (scripts, form controls, video, SVG sprite sheets) are skipped. */
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, VIDEO: 1, SELECT: 1, OPTION: 1, TEXTAREA: 1, INPUT: 1 };
  var DRAWN = 'path, circle, rect, line, polyline, polygon, ellipse, image, use, text';

  function isSvg(el) { return el.tagName.toUpperCase() === 'SVG'; }
  /* an <svg> that shows something — not a sheet of <symbol>s/<defs> other icons <use> */
  function drawsSomething(svg) {
    return Array.prototype.some.call(svg.querySelectorAll(DRAWN), function (n) { return !n.closest('defs, symbol, clipPath, mask, pattern'); });
  }

  function ownText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
    }
    return false;
  }

  function mark(el, kind) {
    el.setAttribute('data-editable', kind);
  }

  function walk(el, insideText) {
    if (SKIP[el.tagName.toUpperCase()]) return;
    var forced = el.getAttribute('data-ed');
    if (forced === 'none') return;
    if (forced) { mark(el, forced); if (forced !== 'image') descend(el, true); return; }
    // already marked — a copy of a tagged section, or one of the editor's generic sections, which carry markers
    var marked = el.getAttribute('data-editable');
    if (marked) { if (marked !== 'image') descend(el, true); return; }

    if (isSvg(el)) { if (drawsSomething(el)) mark(el, 'image'); return; }
    if (el.tagName === 'IMG') { mark(el, 'image'); return; }
    if (el.tagName === 'A' && /\S/.test(el.textContent)) { mark(el, 'button'); return; }
    if (!insideText && ownText(el)) { mark(el, 'text'); descend(el, true); return; }
    descend(el, insideText);
  }

  function descend(el, insideText) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (insideText) {
        // inside a text block only images, icons and links become separately selectable
        if (c.tagName === 'IMG' || isSvg(c) || (c.tagName === 'A' && /\S/.test(c.textContent))) walk(c, true);
        else descend(c, true);
      } else {
        walk(c, false);
      }
    }
  }

  function tagEditables(doc, names) {
    sectionsOf(doc).forEach(function (sec) {
      var id = sec.getAttribute('data-rv-section');
      sec.setAttribute('data-sec-name', names[id] || id);
      descend(sec, false);
    });
  }

  function sectionsOf(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll('[data-rv-section]'));
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ---------- the editor's generic sections inside a template ----------
     Built from the editor's own "SITE CONTENT STYLES" (passed in, so there is one source of truth): every rule is
     scoped under .rv-generic, the demo's .stage.device-mobile variants become a real phone media query, and the
     demo's --site-* tokens are mapped onto the template's own variables — so the section picks up the template's
     colour and fonts. Close to the template's look, not identical: ET's global rules still apply around it. */
  var GENERIC_BASE = [
    '.rv-generic{',
    '  --site-body-font: var(--body-font-family, Arial, sans-serif);',
    '  --site-display-font: var(--heading-font-family-v2, var(--heading-font-family, Georgia, serif));',
    '  --site-display-weight: 400; --site-display-case: none; --site-display-tracking: normal;',
    "  --site-mono-font: 'IBM Plex Mono', monospace;",
    '  --site-text: var(--default-color, #1c1c1c); --site-text-muted: #4B4D50; --site-text-faint: #6f7175;',
    '  --site-surface: #fff; --site-border: #DCDEE1; --site-radius: 0px; --site-radius-sm: 0px; --site-btn-radius: 0px;',
    '  --site-accent: var(--theme-color, #0F6F5C); --site-accent-contrast: #fff;',
    '  --site-accent-soft: color-mix(in srgb, var(--theme-color, #0F6F5C) 10%, #fff);',
    '  --site-nav-bg: transparent; --site-nav-text: #4a4a42; --site-nav-border: #DCDEE1;',
    '  --site-hero-bg: #F7F7F7; --site-hero-text: var(--default-color, #1c1c1c); --site-hero-muted: #4B4D50; --site-hero-size: 42px;',
    '  --site-image-bg: color-mix(in srgb, var(--theme-color, #0F6F5C) 8%, #F4F4F4); --site-image-text: var(--theme-color, #0F6F5C);',
    '  --site-tile-bg: color-mix(in srgb, var(--theme-color, #0F6F5C) 8%, #F4F4F4);',
    '  --site-band-bg: #F7F7F7; --site-band-text: var(--default-color, #1c1c1c); --site-band-muted: #4B4D50;',
    '  --site-quote-bg: #08090B; --site-quote-text: #fff;',
    '  --site-foot-bg: #191b1f; --site-foot-text: #b5b0a0; --site-foot-logo: #fff;',
    '  font-family: var(--site-body-font); color: var(--site-text);',
    '}',
    '.rv-generic *{ box-sizing: border-box; }',
    '.rv-generic h1, .rv-generic h2, .rv-generic h3, .rv-generic blockquote{ font-family: var(--site-display-font); font-weight: var(--site-display-weight); text-transform: var(--site-display-case); letter-spacing: var(--site-display-tracking); margin: 0; }',
    '.rv-generic p{ margin: 0; }',
    '/* content lines up with the site\'s 1170px container; backgrounds stay full-bleed */',
    '.rv-generic > *{ padding-left: max(40px, calc((100% - 1140px) / 2)) !important; padding-right: max(40px, calc((100% - 1140px) / 2)) !important; }',
    '@media (max-width: 767px){ .rv-generic > *{ padding-left: 22px !important; padding-right: 22px !important; } }',
    '.rv-generic [data-editable="image"]{ background-size: cover; background-position: center; }'
  ].join('\n');

  function scopeGenericCss(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    var desktop = [], phone = [];
    css.replace(/([^{}]+)\{([^{}]*)\}/g, function (m, sel, body) {
      sel = sel.trim();
      // the demo's own tokens and base rules for its #frame canvas — replaced by GENERIC_BASE
      if (sel === '.frame' || /^(\.site\b|#frame\b)/.test(sel)) return '';
      var d = [], p = [];
      sel.split(',').forEach(function (s) {
        s = s.trim();
        if (s.indexOf('.stage.device-mobile ') === 0) p.push('.rv-generic ' + s.slice(21));
        else d.push('.rv-generic ' + s);
      });
      if (d.length) desktop.push(d.join(', ') + '{' + body + '}');
      if (p.length) phone.push(p.join(', ') + '{' + body + '}');
      return '';
    });
    return GENERIC_BASE + '\n' + desktop.join('\n') + '\n@media (max-width: 767px){\n' + phone.join('\n') + '\n}\n';
  }

  /* ---------- design: the Design panel and global toolbar, in template mode ----------
     ET templates are themed through CSS variables on <body> (--theme-color, --body-font-family, --primary-font-size,
     --bg-spacing …) — the ones ET's own design settings write — so a change sets those, and the whole site follows
     the way it does on ET. The few things ET hard-codes (heading weight/colour/case/alignment, corner radius, section
     dividers and animation) become rules in one <style data-rv-design>; its settings ride along as JSON in
     data-rv-state, so a saved page keeps them. Which elements count as headings, buttons and cards comes from
     template.json → design. */
  function makeDesign(doc, win, conf) {
    conf = conf || {};
    var body = doc.body, html = doc.documentElement;
    var headingVar = conf.headingFontVar || '--heading-font-family';
    var styleEl = doc.querySelector('style[data-rv-design]');
    var rules = {};
    if (styleEl) { try { rules = JSON.parse(styleEl.getAttribute('data-rv-state') || '{}'); } catch (e) { rules = {}; } }

    function cssVar(name) { return win.getComputedStyle(body).getPropertyValue(name).trim(); }
    function firstFamily(stack) { return (stack || '').split(',')[0].replace(/['"]/g, '').trim(); }
    function toHex(color) {
      var probe = doc.createElement('i');
      probe.style.color = color;
      body.appendChild(probe);
      var c = win.getComputedStyle(probe).color;
      probe.remove();
      var m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      return m ? '#' + [m[1], m[2], m[3]].map(function (n) { return ('0' + (+n).toString(16)).slice(-2); }).join('') : '#000000';
    }
    function rgbTriplet(hex) {
      var n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
    }

    function applyBackground() {
      if (!rules.bgImage) { body.style.backgroundImage = ''; body.style.backgroundSize = ''; body.style.backgroundPosition = ''; body.style.backgroundAttachment = ''; return; }
      var veil = 1 - (rules.bgOpacity == null ? 100 : rules.bgOpacity) / 100;
      body.style.backgroundImage = 'linear-gradient(rgba(255,255,255,' + veil + '), rgba(255,255,255,' + veil + ')), url("' + rules.bgImage.replace(/"/g, '%22') + '")';
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
      body.style.backgroundAttachment = 'fixed';     // a wallpaper behind the page, not one image stretched down it
    }

    function render() {
      var H = conf.headings || 'h1, h2', css = [];
      if (rules.headingWeight) css.push(H + '{ font-weight: ' + rules.headingWeight + ' !important; }');
      if (rules.headingColor) css.push(H + '{ color: ' + rules.headingColor + ' !important; }');
      if (rules.headingCase) css.push(H + '{ text-transform: ' + rules.headingCase + ' !important; }');
      if (rules.headingAlign) css.push(H + '{ text-align: ' + rules.headingAlign + ' !important; }');
      if (rules.radius) {
        if (conf.buttons) css.push(conf.buttons + '{ border-radius: ' + rules.radius + ' !important; }');
        if (conf.cards) css.push(conf.cards + '{ border-radius: ' + (parseInt(rules.radius, 10) > 40 ? '18px' : rules.radius) + ' !important; overflow: hidden; }');
      }
      var between = '[data-rv-section] ~ [data-rv-section]';
      if (rules.divider === 'line') css.push(between + '{ border-top: 1px solid #DCDEE1; }');
      if (rules.divider === 'dashed') css.push(between + '{ border-top: 1px dashed #C9CCD1; }');
      if (rules.divider === 'thick') css.push(between + '{ border-top: 4px solid var(--theme-color); }');
      if (rules.animation && rules.animation !== 'none') {
        css.push('@keyframes rvSectionFade{ from{opacity:0} to{opacity:1} }',
          '@keyframes rvSectionRise{ from{opacity:0; transform:translateY(16px)} to{opacity:1; transform:none} }',
          '@keyframes rvSectionPulse{ 0%,100%{transform:scale(1)} 50%{transform:scale(1.01)} }');
        css.push('[data-rv-section]{ animation: ' + ({ fade: 'rvSectionFade .6s ease both', rise: 'rvSectionRise .6s ease both', pulse: 'rvSectionPulse 2.2s ease-in-out infinite' })[rules.animation] + '; }');
      }
      if (!styleEl) {
        if (!Object.keys(rules).length) return;      // nothing set yet: the page stays as the template made it
        styleEl = doc.createElement('style');
        styleEl.setAttribute('data-rv-design', '');
        doc.head.appendChild(styleEl);      // last in <head>: after ET's bundle and the event theme
      }
      styleEl.textContent = css.join('\n');
      styleEl.setAttribute('data-rv-state', JSON.stringify(rules));
    }

    var getters = {
      themeColor: function () { return toHex(cssVar('--theme-color')); },
      headingFont: function () { return firstFamily(cssVar(headingVar)); },
      bodyFont: function () { return firstFamily(cssVar('--body-font-family')); },
      textColor: function () { return toHex(cssVar('--default-color')); },
      bgColor: function () { return toHex(win.getComputedStyle(body).backgroundColor); },
      bgImage: function () { return rules.bgImage || ''; },
      bgOpacity: function () { return rules.bgOpacity == null ? 100 : rules.bgOpacity; },
      bodySize: function () { return parseInt(cssVar('--para-font-size'), 10) || 16; },
      bodyWeight: function () { return win.getComputedStyle(body).fontWeight; },
      sectionSpacing: function () { return parseInt(cssVar('--bg-spacing'), 10) || 0; },
      divider: function () { return rules.divider || 'none'; },
      animation: function () { return rules.animation || 'none'; },
      headingSize: function () { return parseInt(cssVar('--primary-font-size'), 10) || 32; },
      headingWeight: function () { return rules.headingWeight || ''; },
      headingColor: function () { return rules.headingColor || ''; },
      headingCase: function () { return rules.headingCase || ''; },
      headingAlign: function () { return rules.headingAlign || ''; },
      radius: function () { return rules.radius || ''; }
    };
    var setters = {
      themeColor: function (hex) {
        body.style.setProperty('--theme-color', hex);
        html.style.setProperty('--theme-color', rgbTriplet(hex));      // ET also keeps an "r, g, b" copy on :root
        html.style.setProperty('--theme-color-hex', hex);
      },
      headingFont: function (stack) { body.style.setProperty(headingVar, stack); },
      bodyFont: function (stack) { body.style.setProperty('--body-font-family', stack); },
      textColor: function (hex) { body.style.setProperty('--default-color', hex); body.style.setProperty('--body-color', hex); },
      bgColor: function (hex) { body.style.backgroundColor = hex; body.style.setProperty('--bg-color', hex); },
      bgImage: function (url) { rules.bgImage = url || ''; if (!url) delete rules.bgImage; applyBackground(); render(); },
      bgOpacity: function (n) { rules.bgOpacity = +n; applyBackground(); render(); },
      bodySize: function (px) { body.style.setProperty('--para-font-size', px + 'px'); body.style.fontSize = px + 'px'; },
      bodyWeight: function (w) { body.style.fontWeight = w; },
      sectionSpacing: function (px) { body.style.setProperty('--bg-spacing', px + 'px 0'); },
      headingSize: function (px) { body.style.setProperty('--primary-font-size', px + 'px'); }
    };
    ['divider', 'animation', 'headingWeight', 'headingColor', 'headingCase', 'headingAlign', 'radius'].forEach(function (k) {
      setters[k] = function (v) { if (v) rules[k] = v; else delete rules[k]; render(); };
    });

    return {
      get: function (key) { return getters[key](); },
      set: function (key, value) { setters[key](value); },
      /* the rules as JSON, and back — the variables live in <body>/<html> inline styles, which a snapshot keeps itself */
      state: function () { return JSON.stringify(rules); },
      load: function (json) {
        try { rules = JSON.parse(json || '{}') || {}; } catch (e) { rules = {}; }
        render();
      },
      swatches: function () {
        var own = getters.themeColor();
        return [own].concat((conf.swatches || []).filter(function (c) { return c.toLowerCase() !== own; }));
      }
    };
  }

  /* ---------- mounting ---------- */
  function mount(frame, templateId) {
    var viewport = document.createElement('div');
    viewport.className = 'tpl-viewport';
    var iframe = document.createElement('iframe');
    iframe.className = 'tpl-iframe';
    iframe.title = 'Template canvas';
    viewport.appendChild(iframe);
    frame.appendChild(viewport);

    return RevampTemplates.load(templateId, {
      editing: true,
      headExtra: ['<link rel="stylesheet" href="' + EDITOR_CSS + '" data-rv-editor>']
    }).then(function (res) {
      return new Promise(function (resolve) {
        iframe.addEventListener('load', function () { resolve(makeCanvas(viewport, iframe, res.template)); }, { once: true });
        iframe.srcdoc = res.html;
      });
    });
  }

  function makeCanvas(viewport, iframe, template) {
    var doc = iframe.contentDocument;
    var win = iframe.contentWindow;
    var device = 'desktop';
    var scale = 1;

    var names = {};
    template.sections.forEach(function (s) { names[s.id] = s.name; });

    // untouched copies of the template's sections, taken before anything is marked or edited
    var library = sectionsOf(doc).map(function (sec) {
      var id = sec.getAttribute('data-rv-section');
      var h = sec.querySelector('h1, h2, h3');
      return { id: id, name: names[id] || id, html: sec.outerHTML, snippet: h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) : '' };
    });

    // each template section's CSS as its file has it now — what a restored page gets, whatever was saved
    var ownCss = {};
    doc.querySelectorAll('style[data-rv-style]').forEach(function (st) { ownCss[st.getAttribute('data-rv-style')] = st.textContent; });

    tagEditables(doc, names);

    function prepare(el, name) {
      el.setAttribute('data-sec-name', name);
      descend(el, false);
      return el;
    }

    function uniqueId(id) {
      var base = id.replace(/-\d+$/, ''), n = 2, candidate;
      do { candidate = base + '-' + n++; } while (doc.getElementById(candidate));
      return candidate;
    }

    /* Sections are styled by #id — in their own CSS, in ET's bundle and in the event theme (#banner, #overview, …).
       A copy gets new ids, so every rule naming an old id is copied from every loaded stylesheet (inside the same
       @media / @supports) with the new id put in; that keeps the copy pixel-identical to the original. */
    function copyRulesFor(renames) {
      var ids = Object.keys(renames);
      var find = new RegExp('#(' + ids.map(escRe).join('|') + ')(?![\\w-])');
      var swap = new RegExp('#(' + ids.map(escRe).join('|') + ')(?![\\w-])', 'g');
      var out = [];
      function walkRules(rules, wrap) {
        for (var i = 0; i < rules.length; i++) {
          var r = rules[i];
          if (r.type === 1) {
            if (find.test(r.selectorText)) {
              out.push(wrap(r.selectorText.replace(swap, function (m, id) { return '#' + renames[id]; }) + '{' + r.style.cssText + '}'));
            }
          } else if ((r.type === 4 || r.type === 12) && r.cssRules) {
            var cond = (r.type === 4 ? '@media ' : '@supports ') + r.conditionText;
            walkRules(r.cssRules, function (t) { return wrap(cond + '{' + t + '}'); });   // runs now, so cond is this rule's
          }
        }
      }
      for (var s = 0; s < doc.styleSheets.length; s++) {
        try { walkRules(doc.styleSheets[s].cssRules, function (t) { return t; }); } catch (e) { /* cross-origin font CSS */ }
      }
      return out.join('\n');
    }

    function adopt(el) {
      var renames = {};
      [el].concat(Array.prototype.slice.call(el.querySelectorAll('[id]'))).forEach(function (n) {
        if (n.id && doc.querySelectorAll('#' + CSS.escape(n.id)).length > 1) {
          var fresh = uniqueId(n.id);
          renames[n.id] = fresh;
          n.id = fresh;
        }
      });
      if (Object.keys(renames).length) {
        var css = copyRulesFor(renames);
        if (css) {
          var st = doc.createElement('style');
          st.setAttribute('data-rv-copy-for', el.id);
          st.textContent = css;
          el.after(st);
        }
        // in-section references to renamed ids (anchor links, labels, aria)
        el.querySelectorAll('[href^="#"], [for], [aria-controls], [aria-labelledby], [aria-describedby]').forEach(function (n) {
          ['href', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby'].forEach(function (a) {
            var v = n.getAttribute(a);
            if (!v) return;
            var key = a === 'href' ? v.slice(1) : v;
            if (renames[key]) n.setAttribute(a, (a === 'href' ? '#' : '') + renames[key]);
          });
        });
      }
      if (win.RevampSections) win.RevampSections.init(el);
      return el;
    }

    /* ---------- items that open (accordions) ----------
       template.json → sections[].toggle: { item, open, expanded } — e.g. an FAQ whose .faq-item gets .active. The
       site's own script opens them on click, but the editor keeps clicks from the site, so the editor opens an item
       itself when something inside it is clicked: its answer can then be picked and edited. That open state belongs to
       the editor only (data-rv-open / data-rv-aria), so saves, undo steps and the published page keep every item as
       the template has it. */
    function toggleOf(sec) {
      var id = sec.getAttribute('data-rv-section');
      var s = template.sections.filter(function (x) { return x.id === id; })[0];
      return s && s.toggle;
    }
    function unopen(root) {
      [root].concat(Array.prototype.slice.call(root.querySelectorAll('[data-rv-open], [data-rv-aria]'))).forEach(function (m) {
        if (m.hasAttribute('data-rv-open')) {
          m.classList.remove(m.getAttribute('data-rv-open'));
          m.removeAttribute('data-rv-open');
          if (!m.getAttribute('class')) m.removeAttribute('class');
        }
        if (m.hasAttribute('data-rv-aria')) {
          m.setAttribute('aria-expanded', m.getAttribute('data-rv-aria'));
          m.removeAttribute('data-rv-aria');
        }
      });
    }
    function openItem(el) {
      var sec = el.closest('[data-rv-section]'), t = sec && toggleOf(sec);
      if (!t) return false;
      var item = el.closest(t.item);
      if (!item || !sec.contains(item) || item.classList.contains(t.open)) return false;
      Array.prototype.forEach.call(sec.querySelectorAll('[data-rv-open]'), unopen);     // one open at a time, as on the site
      item.classList.add(t.open);
      item.setAttribute('data-rv-open', t.open);
      var trigger = t.expanded && item.querySelector(t.expanded);
      if (trigger) {
        trigger.setAttribute('data-rv-aria', trigger.getAttribute('aria-expanded') || 'false');
        trigger.setAttribute('aria-expanded', 'true');
      }
      return true;
    }

    /* ---------- a new picture in an image slot ----------
       <img>   its src (srcset/sizes dropped, they'd win over it)
       <svg>   an icon: the <svg> stays — its classes, viewBox and the section's CSS for it (size, colour, hover) keep
               applying — and only its drawing is swapped for the picture, fitted into the viewBox
       else    a box (a generic section's image placeholder): the picture as its background */
    function setPicture(el, url) {
      if (el.tagName === 'IMG') {
        el.setAttribute('src', url);
        el.removeAttribute('srcset');
        el.removeAttribute('sizes');
        return;
      }
      if (isSvg(el)) {
        var vb = el.viewBox && el.viewBox.baseVal;
        if (!vb || !vb.width) {
          var r = el.getBoundingClientRect();
          el.setAttribute('viewBox', '0 0 ' + (Math.round(r.width) || 24) + ' ' + (Math.round(r.height) || 24));
          vb = el.viewBox.baseVal;
        }
        while (el.firstChild) el.removeChild(el.firstChild);
        var img = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
        img.setAttribute('href', url);
        img.setAttribute('x', vb.x); img.setAttribute('y', vb.y);
        img.setAttribute('width', vb.width); img.setAttribute('height', vb.height);
        img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        el.appendChild(img);
        return;
      }
      el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
    }
    /* the picture an image slot shows now (for the Replace popover's URL field); '' for a drawn icon or a data: URL */
    function pictureOf(el) {
      var u = el.tagName === 'IMG' ? el.getAttribute('src')
        : isSvg(el) ? ((el.querySelector('image') || { getAttribute: function () { return ''; } }).getAttribute('href') || '')
        : ((el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/) || [])[1] || '');
      return /^data:/.test(u || '') ? '' : (u || '');
    }

    function cleanCopy(root) {
      unopen(root);
      [root].concat(Array.prototype.slice.call(root.querySelectorAll('.ed-selected, .sec-active, [contenteditable]'))).forEach(function (n) {
        n.classList.remove('ed-selected', 'sec-active');
        n.removeAttribute('contenteditable');
        if (!n.className) n.removeAttribute('class');
      });
      root.classList.remove('is-hidden-sec');
      root.removeAttribute('data-scheduled-at');
      root.style.display = '';
      if (!root.getAttribute('style')) root.removeAttribute('style');
    }

    function fit() {
      var w = DEVICES[device];
      scale = Math.min(1, viewport.clientWidth / w);
      iframe.style.width = w + 'px';
      iframe.style.height = (viewport.clientHeight / scale) + 'px';
      iframe.style.transform = scale === 1 ? '' : 'scale(' + scale + ')';
    }

    function screenRect(el) {
      var r = el.getBoundingClientRect();
      var f = iframe.getBoundingClientRect();
      return {
        left: f.left + r.left * scale, top: f.top + r.top * scale,
        right: f.left + r.right * scale, bottom: f.top + r.bottom * scale,
        width: r.width * scale, height: r.height * scale
      };
    }

    function inView(el) {
      var r = screenRect(el), v = viewport.getBoundingClientRect();
      return r.bottom > v.top && r.top < v.bottom && r.right > v.left && r.left < v.right;
    }

    function serialize() {
      var root = doc.documentElement.cloneNode(true);
      root.removeAttribute('data-rv-editing');
      // hidden (and not-yet-live scheduled) sections aren't on the published page
      root.querySelectorAll('[data-rv-section].is-hidden-sec').forEach(function (sec) {
        root.querySelectorAll('style[data-rv-copy-for="' + sec.id + '"]').forEach(function (s) { s.remove(); });
        sec.remove();
      });
      root.querySelectorAll('[data-rv-editor]').forEach(function (n) { n.remove(); });
      var EDITOR_ATTRS = ['data-editable', 'contenteditable', 'data-sec-name', 'data-text-original', 'data-date', 'data-date-shown', 'data-date-format'];
      root.querySelectorAll(EDITOR_ATTRS.map(function (a) { return '[' + a + ']'; }).join(', ')).forEach(function (n) {
        EDITOR_ATTRS.forEach(function (a) { n.removeAttribute(a); });
      });
      root.querySelectorAll('.ed-selected, .sec-active').forEach(function (n) {
        n.classList.remove('ed-selected', 'sec-active');
        if (!n.className) n.removeAttribute('class');
      });
      unopen(root);
      return '<!DOCTYPE html>\n' + root.outerHTML;
    }

    function ensureGenericStyle(siteCss) {
      if (doc.querySelector('style[data-rv-generic]')) return;
      var st = doc.createElement('style');
      st.setAttribute('data-rv-generic', '');
      st.textContent = scopeGenericCss(siteCss || '');
      doc.head.appendChild(st);
    }

    /* ---------- saving ----------
       A snapshot holds only what editing can change:
         html, body   the inline styles of <html> and <body> — the theme variables the design controls set
         design       the design rules (canvas.design.state())
         generic      whether the page has the editor's generic-section CSS (rebuilt from the editor's, not stored)
         nodes        the content column, one HTML string per element: sections (hidden and scheduled ones too, with
                      their names and editable markers) and the CSS copied for duplicates. A template section's own
                      <style data-rv-style> is kept as an empty placeholder and refilled from the template's file, so a
                      fix to the template's CSS reaches pages saved before it.
       Selection, in-place editing and items the editor opened are left out. The shared header and footer aren't the
       page's to change. */
    var TRANSIENT = '.ed-selected, .sec-active, [contenteditable], [data-text-original], [data-rv-open], [data-rv-aria]';

    function nodeHtml(n) {
      if (n.matches('style[data-rv-style]')) return '<style data-rv-style="' + n.getAttribute('data-rv-style').replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></style>';
      if (!n.matches(TRANSIENT) && !n.querySelector(TRANSIENT)) return n.outerHTML;
      var c = n.cloneNode(true);
      [c].concat(Array.prototype.slice.call(c.querySelectorAll(TRANSIENT))).forEach(function (m) {
        m.classList.remove('ed-selected', 'sec-active');
        if (!m.getAttribute('class')) m.removeAttribute('class');
        m.removeAttribute('contenteditable');
        m.removeAttribute('data-text-original');
      });
      unopen(c);
      return c.outerHTML;
    }

    function snapshot(prev) {
      var nodes = Array.prototype.map.call(api.contentRoot().children, function (n, i) {
        var h = nodeHtml(n);
        return prev && prev.nodes[i] === h ? prev.nodes[i] : h;     // same string: keep the one already held
      });
      return {
        v: 1,
        html: doc.documentElement.getAttribute('style') || '',
        body: doc.body.getAttribute('style') || '',
        design: api.design.state(),
        generic: !!doc.querySelector('style[data-rv-generic]'),
        nodes: nodes
      };
    }

    function sameSnapshot(a, b) {
      if (!a || !b || a.html !== b.html || a.body !== b.body || a.design !== b.design || a.generic !== b.generic || a.nodes.length !== b.nodes.length) return false;
      for (var i = 0; i < a.nodes.length; i++) if (a.nodes[i] !== b.nodes[i]) return false;
      return true;
    }

    function setStyleAttr(el, value) {
      if (value) el.setAttribute('style', value); else el.removeAttribute('style');
    }

    /* Elements whose HTML is unchanged are kept as they are — moved if need be — so undo doesn't reload images, re-run
       section scripts or jump the page; only the rest is rebuilt from the snapshot. */
    function restore(snap, opts) {
      opts = opts || {};
      setStyleAttr(doc.documentElement, snap.html);
      setStyleAttr(doc.body, snap.body);
      api.design.load(snap.design);
      if (snap.generic) ensureGenericStyle(opts.siteCss);

      var root = api.contentRoot();
      var pool = new Map();
      Array.prototype.forEach.call(root.children, function (n) {
        var h = nodeHtml(n);
        if (!pool.has(h)) pool.set(h, []);
        pool.get(h).push(n);
      });
      var built = [];
      var next = snap.nodes.map(function (h) {
        var same = pool.get(h);
        if (same && same.length) return same.shift();
        var t = doc.createElement('template');
        t.innerHTML = h;
        var n = doc.importNode(t.content.firstElementChild, true);
        if (n.matches('style[data-rv-style]')) n.textContent = ownCss[n.getAttribute('data-rv-style')] || '';
        built.push(n);
        return n;
      });
      pool.forEach(function (left) { left.forEach(function (n) { n.remove(); }); });
      next.forEach(function (n, i) {
        if (root.children[i] !== n) root.insertBefore(n, root.children[i] || null);
      });

      return built.filter(function (n) { return n.hasAttribute('data-rv-section'); }).map(function (sec) {
        descend(sec, false);             // no-op for what was saved marked; picks up anything new in the rules
        if (win.RevampSections) win.RevampSections.init(sec);
        return sec;
      });
    }

    var api = {
      iframe: iframe, doc: doc, win: win, template: template,
      design: makeDesign(doc, win, template.design),
      setDevice: function (name) { device = DEVICES[name] ? name : 'desktop'; fit(); },
      fit: fit,
      scale: function () { return scale; },
      screenRect: screenRect,
      inView: inView,
      sections: function () { return sectionsOf(doc); },
      serialize: serialize,
      snapshot: snapshot,
      restore: restore,
      sameSnapshot: sameSnapshot,

      library: function () { return library.slice(); },
      createLibrarySection: function (id) {
        var item = library.filter(function (s) { return s.id === id; })[0];
        var tmp = doc.createElement('div');
        tmp.innerHTML = item.html;
        return prepare(tmp.firstElementChild, item.name);
      },
      createGenericSection: function (name, html, siteCss) {
        ensureGenericStyle(siteCss);
        var sec = doc.createElement('section');
        sec.className = 'rv-generic';
        sec.setAttribute('data-rv-section', 'generic');
        sec.id = uniqueId('rv-section');
        sec.innerHTML = html;
        return prepare(sec, name);
      },
      adopt: adopt,
      retag: function (el) { descend(el, false); },       // after changing a section's markup: new text becomes editable
      openItem: openItem,                                 // an accordion item around el opened for editing; true if it did
      setPicture: setPicture,                             // a new picture in an <img>, an <svg> icon or an image box
      pictureOf: pictureOf,
      duplicateSection: function (sec, name) {
        var copy = sec.cloneNode(true);
        cleanCopy(copy);
        copy.setAttribute('data-sec-name', name);
        sec.after(copy);
        return adopt(copy);
      },
      removeSection: function (sec) {
        doc.querySelectorAll('style[data-rv-copy-for="' + sec.id + '"]').forEach(function (s) { s.remove(); });
        sec.remove();
      },
      contentRoot: function () { return doc.querySelector('#content .col-md-12.no-padding') || doc.body; },
      /* bring a section to the top of the canvas, clear of a fixed header */
      scrollToSection: function (el) {
        var hdr = doc.querySelector('[data-rv-locked="header"]'), off = 12;
        if (hdr && /fixed|sticky/.test(win.getComputedStyle(hdr).position)) off += hdr.getBoundingClientRect().height;
        win.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + win.scrollY - off), behavior: 'smooth' });
      },
      onResize: null          // set by the editor: called after every re-fit
    };

    /* the frame changes size with the window and whenever a side panel opens or closes */
    fit();
    new ResizeObserver(function () {
      fit();
      if (api.onResize) api.onResize();
    }).observe(viewport);
    return api;
  }

  window.RevampCanvas = { mount: mount, DEVICES: DEVICES };
})();
