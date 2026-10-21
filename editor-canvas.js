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
                                    theme settings (colour, fonts, sizes, spacing, heading look, radius, dividers,
                                    motion …)
                                    set() answers false, and changes nothing, when the page turned out to
                                    have nothing that setting acts on
     canvas.design.supports(key)    whether that setting has anything on this page to act on
     canvas.sections()              section roots, in page order
     canvas.serialize()             the page as published: editor and AI-review markers stripped, hidden sections
                                    left out

   Saving (the editor keeps these per event, and as its undo/redo steps)
     canvas.snapshot(prev)          what the user has changed, as a plain object (see below); prev lets unchanged
                                    parts share memory with the previous snapshot
     canvas.restore(snap, opts)     puts a snapshot back in place, reusing every element that didn't change;
                                    returns the sections it had to rebuild. opts.siteCss: as createGenericSection
     canvas.sameSnapshot(a, b)      whether two snapshots describe the same page

   Sections (all of them work on real DOM in the iframe, so the result is the page itself — nothing to translate back)
     A section root carries two names. data-rv-section is its TYPE — the template section it is an instance of; its
     script (et-runtime.js), its CSS, its accordion and repeat settings in template.json all go by it, and every
     copy keeps it. data-rv-key tells the instances apart: unique on the page, the type itself for the first one,
     then <type>-2, <type>-3 …. Anything that means one particular section uses the key.
     canvas.library()                        the template's own sections as they were when it loaded
     canvas.createLibrarySection(id)         a fresh copy of one of them, ready to insert
     canvas.createGenericSection(name, html, siteCss)
                                             one of the editor's generic sections, dressed in the template's tokens
     canvas.insertSection(el, afterSec)      puts a new section on the page after afterSec (at the end when null),
                                             never outside the part of the page sections may move in, and adopts it
     canvas.adopt(el)                        after inserting: its key, unique ids (+ their CSS), section scripts started
     canvas.adoptElement(el)                 the same for a copy of one element inside a section (no scripts to start)
     canvas.copyOf(el)                       a copy of an element without the editor's selection and editing marks
     canvas.sectionByKey(key)                the section with that data-rv-key
     canvas.pinned(sec)                      'start' / 'end' for a section the template keeps at the top / bottom
                                             (template.json → layout.pinStart / pinEnd), else ''
     canvas.canMoveSection(sec, before)      whether moveSection would move it there
     canvas.moveSection(sec, before)         moves it (with the CSS that belongs to it) in front of `before`, or to
                                             the end when null. Pinned sections stay, and nothing moves past one
     canvas.setHidden(sec, hide)             a hidden section stays in the editor as a slim bar (editor-canvas.css)
                                             and is left out of the published page
     canvas.ensureBlockStyle()               the CSS of the Add panel's blocks (.rv-block-*), added once
     canvas.anchorFor(sec)                   the id a link to this section uses ("#<id>"); gives the section one if it has none
     canvas.retag(el)                        after changing markup in place: marks what has become editable
     canvas.openItem(el)                     opens the accordion item around el (template.json → sections[].toggle)
                                             so its hidden part can be edited; editor-only, never saved
     canvas.itemAround(el)                   the accordion item (or native <details>) el sits in, else null
     canvas.setPicture(el, url)              a new picture in an image slot: <img>, <svg> icon, or image box
     canvas.pictureOf(el)                    the URL it shows now ('' for a drawn icon)
     canvas.duplicateSection(sec, name)      copy placed right after the original, already adopted: same type, own key
     canvas.removeSection(sec)               removes it with any CSS made for it
     canvas.contentRoot()                    where sections live when the page has none left

   The page in the canvas is edited, never visited: mount() stops every link, form and submit button from taking
   the canvas somewhere else. Should the canvas still load another document (a script setting location),
   canvas.onNavigate is called; the canvas is then dead and canvas.destroy() + a new mount() replace it. */
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
    /* an embedded form is one block: selected, moved and deleted whole; what it holds is not text to type in */
    if (el.hasAttribute('data-rv-form-embed')) { mark(el, 'block'); return; }
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

  function tagEditables(doc, names, ensureKey) {
    sectionsOf(doc).forEach(function (sec) {
      var id = sec.getAttribute('data-rv-section');
      sec.setAttribute('data-sec-name', names[id] || id);
      ensureKey(sec);
      descend(sec, false);
    });
  }

  /* a section that has only an id for a name ("why-attend", on AI-designed sites) is shown as "Why attend" */
  function readableName(id) {
    var words = String(id).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : String(id);
  }

  function sectionsOf(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll('[data-rv-section]'));
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ---------- the editor's generic sections inside a template ----------
     Built from the editor's own "SITE CONTENT STYLES" (passed in, so there is one source of truth): every rule is
     scoped under .rv-generic, the demo's .stage.device-mobile variants become a real phone media query, and the
     demo's --site-* tokens are mapped onto the template's own variables — so the section picks up the template's
     colour and fonts. Close to the template's look, not identical: ET's global rules still apply around it.
     The designs are drawn for a light surface, so a generic section brings its own white background and dark
     text: on a template whose page is dark it would otherwise be dark text on a dark page. */
  var GENERIC_BASE = [
    '.rv-generic{',
    '  --site-body-font: var(--body-font-family, Arial, sans-serif);',
    '  --site-display-font: var(--heading-font-family-v2, var(--heading-font-family, Georgia, serif));',
    '  --site-display-weight: 400; --site-display-case: none; --site-display-tracking: normal;',
    "  --site-mono-font: 'IBM Plex Mono', monospace;",
    '  --site-text: #191B1F; --site-text-muted: #4B4D50; --site-text-faint: #6f7175;',
    '  --site-surface: #fff; --site-border: #DCDEE1; --site-radius: 0px; --site-radius-sm: 0px; --site-btn-radius: 0px;',
    '  --site-accent: var(--theme-color, #0F6F5C); --site-accent-contrast: #fff;',
    '  --site-accent-soft: color-mix(in srgb, var(--theme-color, #0F6F5C) 10%, #fff);',
    '  --site-nav-bg: transparent; --site-nav-text: #4a4a42; --site-nav-border: #DCDEE1;',
    '  --site-hero-bg: #F7F7F7; --site-hero-text: #191B1F; --site-hero-muted: #4B4D50; --site-hero-size: 42px;',
    '  --site-image-bg: color-mix(in srgb, var(--theme-color, #0F6F5C) 8%, #F4F4F4); --site-image-text: var(--theme-color, #0F6F5C);',
    '  --site-tile-bg: color-mix(in srgb, var(--theme-color, #0F6F5C) 8%, #F4F4F4);',
    '  --site-band-bg: #F7F7F7; --site-band-text: #191B1F; --site-band-muted: #4B4D50;',
    '  --site-quote-bg: #08090B; --site-quote-text: #fff;',
    '  --site-foot-bg: #191b1f; --site-foot-text: #b5b0a0; --site-foot-logo: #fff;',
    '  font-family: var(--site-body-font); color: var(--site-text); background: var(--site-surface);',
    '}',
    '.rv-generic *{ box-sizing: border-box; }',
    '.rv-generic h1, .rv-generic h2, .rv-generic h3, .rv-generic blockquote{ font-family: var(--site-display-font); font-weight: var(--site-display-weight); text-transform: var(--site-display-case); letter-spacing: var(--site-display-tracking); margin: 0; }',
    '.rv-generic p{ margin: 0; }',
    '/* content lines up with the site\'s 1170px container; backgrounds stay full-bleed */',
    '.rv-generic > *{ padding-left: max(40px, calc((100% - 1140px) / 2)) !important; padding-right: max(40px, calc((100% - 1140px) / 2)) !important; }',
    '@media (max-width: 767px){ .rv-generic > *{ padding-left: 22px !important; padding-right: 22px !important; } }',
    '/* a section made to hold one of the event\'s forms (heading, line, form) takes the page\'s own ground and text',
    '   (a generated site\'s theme variables), so it never stands out as a white band on a dark or tinted page; a',
    '   template without those variables keeps the light surface above */',
    '.rv-generic:has(> .rv-block-form){ --site-text: var(--rv-text, #191B1F); --site-text-muted: var(--rv-muted, #4B4D50); --site-surface: var(--rv-bg, #fff); padding-top: 64px; padding-bottom: 72px; }',
    '.rv-generic:has(> .rv-block-form) > h2{ margin-bottom: 12px; font-size: clamp(28px, 4vw, 40px); line-height: 1.15; }',
    '.rv-generic:has(> .rv-block-form) > p{ margin-bottom: 28px; color: var(--site-text-muted); }',
    '@media (max-width: 767px){ .rv-generic:has(> .rv-block-form){ padding-top: 44px; padding-bottom: 52px; } }'
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

  /* ---------- the Add panel's blocks ----------
     A heading, text, button, picture, divider or spacer the owner adds inside a section (editor-template-ui.js,
     addBlock). They are plain elements of the page, styled from the page's own variables so they follow the site's
     colour and fonts. headingVar: the variable this template's headings read (template.json → design). */
  function blockCss(headingVar) {
    return [
      '.rv-block-heading{ margin:24px 0 12px; font-family:var(' + headingVar + ', inherit); font-size:28px; line-height:1.25; font-weight:700; color:inherit; }',
      '.rv-block-text{ margin:12px 0; font-family:var(--body-font-family, inherit); font-size:var(--para-font-size, 16px); line-height:1.6; color:inherit; }',
      '.rv-block-button{ display:inline-block; margin:12px 0; padding:12px 26px; background:var(--theme-color, #1c1c1c); color:#fff; font-family:var(--body-font-family, inherit); font-size:15px; font-weight:600; line-height:1.2; text-decoration:none; border-radius:4px; }',
      '.rv-block-image{ display:block; max-width:100%; height:auto; min-width:48px; min-height:48px; margin:16px 0; }',
      '.rv-block-divider{ display:block; width:100%; height:21px; margin:14px 0; padding:0; border:0; background:linear-gradient(currentColor, currentColor) center / 100% 1px no-repeat; opacity:.25; }',
      '.rv-block-spacer{ display:block; width:100%; height:40px; }'
    ].join('\n');
  }

  /* ---------- design: the Design panel and global toolbar ----------
     ET templates are themed through CSS variables on <body> (--theme-color, --body-font-family, --primary-font-size,
     --bg-spacing …) — the ones ET's own design settings write — so a change sets those, and the whole site follows
     the way it does on ET. What the variables do not reach (the heading look, corner radius, section dividers and
     animation, motion) becomes rules in one <style data-rv-design>; its settings ride along as JSON in
     data-rv-state, so a saved page keeps them. Which elements count as headings, buttons and cards comes from
     template.json → design.

     Fonts: a family the page did not come with needs its stylesheet, or the browser falls back to another font.
     Every such family in use — the heading and body fonts, and any set on a single text — gets one
     <link data-rv-font> in <head>, worked out from the page itself each time the design is set or loaded. So the
     links follow undo, redo and a reload without being stored anywhere, and are part of the published page. */
  var SYSTEM_FONTS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|inherit|initial|unset|arial|helvetica|helvetica neue|georgia|times|times new roman|courier|courier new|verdana|tahoma|trebuchet ms|segoe ui)$/i;

  function fontHref(family) {
    return 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + ':wght@300;400;500;600;700;800&display=swap';
  }

  function makeDesign(doc, win, conf) {
    conf = conf || {};
    var body = doc.body, html = doc.documentElement;
    var headingVar = conf.headingFontVar || '--heading-font-family';
    var H = conf.headings || 'h1, h2';
    /* An AI-designed site ("gen-<event>"): its sections paint their own backgrounds and set their own type,
       so the page-wide settings reach them through the variables they are written against (--rv-bg,
       --rv-text) and, for size, weight and spacing, through rules on the sections themselves. */
    var generated = body.id === 'gen' || body.classList.contains('rv-generated');
    var PROSE = '[data-rv-section] :is(p, li, dd, blockquote)';
    var MIDDLE = '[data-rv-section]:not([data-rv-section="nav"]):not([data-rv-section="hero"]):not([data-rv-section="footer"])';
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
    function find(selector) { try { return doc.querySelector(selector); } catch (e) { return null; } }
    function firstHeading() { return find(H); }

    function applyBackground() {
      if (!rules.bgImage) { body.style.backgroundImage = ''; body.style.backgroundSize = ''; body.style.backgroundPosition = ''; body.style.backgroundAttachment = ''; return; }
      var veil = 1 - (rules.bgOpacity == null ? 100 : rules.bgOpacity) / 100;
      body.style.backgroundImage = 'linear-gradient(rgba(255,255,255,' + veil + '), rgba(255,255,255,' + veil + ')), url("' + rules.bgImage.replace(/"/g, '%22') + '")';
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
      body.style.backgroundAttachment = 'fixed';     // a wallpaper behind the page, not one image stretched down it
    }

    /* ---------- fonts ---------- */
    function ownSheet(node) {
      return !!node && node.nodeType === 1 && (node.hasAttribute('data-rv-font') || node.hasAttribute('data-rv-editor') || node.hasAttribute('data-rv-design'));
    }
    // the families the page's own stylesheets bring: @font-face rules, and the stylesheets it links by family name
    var declared = null;
    function pageProvides(family) {
      var name = family.toLowerCase();
      if (!declared) {
        declared = {};
        Array.prototype.forEach.call(doc.styleSheets, function (sheet) {
          if (ownSheet(sheet.ownerNode)) return;
          var list;
          try { list = sheet.cssRules; } catch (e) { return; }          // another origin's sheet cannot be read
          for (var i = 0; list && i < list.length; i++) {
            if (list[i].type === 5) declared[firstFamily(list[i].style.getPropertyValue('font-family')).toLowerCase()] = 1;
          }
        });
      }
      if (declared[name]) return true;
      return Array.prototype.some.call(doc.querySelectorAll('link[rel="stylesheet"]:not([data-rv-font])'), function (l) {
        var href = '';
        try { href = decodeURIComponent((l.getAttribute('href') || '').replace(/\+/g, ' ')).toLowerCase(); } catch (e) { return false; }
        var at = href.indexOf('family=');
        return at !== -1 && href.slice(at + 7).split(/[|&]|family=/).some(function (f) { return f.split(':')[0].trim() === name; });
      });
    }
    /* The fonts the page came with are the template's business: whether it loads them or leaves them to the
       visitor's computer, the editor does not change that. */
    var cameWith = {};
    [cssVar(headingVar), cssVar('--body-font-family')].forEach(function (stack) { cameWith[firstFamily(stack).toLowerCase()] = 1; });

    function syncFonts() {
      var wanted = {};
      function want(stack) {
        var family = firstFamily(stack), key = family.toLowerCase();
        if (!family || /^var\(/i.test(family) || SYSTEM_FONTS.test(family) || cameWith[key]) return;
        wanted[key] = family;
      }
      want(rules.headingFont || cssVar(headingVar));
      want(cssVar('--body-font-family'));
      Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-section] [style*="font-family"], [data-rv-section][style*="font-family"]'), function (el) {
        want(el.style.fontFamily);
      });
      Array.prototype.forEach.call(doc.head.querySelectorAll('link[data-rv-font]'), function (l) {
        var key = l.getAttribute('data-rv-font').toLowerCase();
        if (wanted[key]) delete wanted[key]; else l.remove();
      });
      Object.keys(wanted).forEach(function (key) {
        if (pageProvides(wanted[key])) return;
        var link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute('data-rv-font', wanted[key]);
        link.href = fontHref(wanted[key]);
        doc.head.appendChild(link);
      });
    }

    function render() {
      var css = [];
      if (rules.headingFont) css.push(H + '{ font-family: ' + rules.headingFont + ' !important; }');
      // never wider than a phone can show: the size is a desktop size, and the template's own phone sizes no longer apply
      if (rules.headingSize) css.push(H + '{ font-size: min(' + rules.headingSize + 'px, 9vw) !important; }');
      if (rules.headingWeight) css.push(H + '{ font-weight: ' + rules.headingWeight + ' !important; }');
      if (rules.headingColor) css.push(H + '{ color: ' + rules.headingColor + ' !important; }');
      if (rules.headingCase) css.push(H + '{ text-transform: ' + rules.headingCase + ' !important; }');
      if (rules.headingAlign) css.push(H + '{ text-align: ' + rules.headingAlign + ' !important; }');
      if (rules.radius) {
        if (conf.buttons) css.push(conf.buttons + '{ border-radius: ' + rules.radius + ' !important; }');
        if (conf.cards) css.push(conf.cards + '{ border-radius: ' + (parseInt(rules.radius, 10) > 40 ? '18px' : rules.radius) + ' !important; overflow: hidden; }');
      }
      if (generated) {
        if (rules.bodySize) css.push(PROSE + '{ font-size: ' + rules.bodySize + 'px !important; }');
        if (rules.bodyWeight) css.push(PROSE + '{ font-weight: ' + rules.bodyWeight + ' !important; }');
        if (rules.sectionSpacing != null) css.push(MIDDLE + '{ padding-top: ' + rules.sectionSpacing + 'px !important; padding-bottom: ' + rules.sectionSpacing + 'px !important; }');
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
      /* Motion. ET's scroll reveal keeps .animated blocks invisible until they are scrolled to (et-animate.css):
         with reveals off they are simply there. With all motion off, animations and transitions are not removed
         but made instant, so anything that only becomes visible at the end of one still does. The editor's own
         canvas is left alone. */
      var still = rules.motion === 'off';
      if (still || rules.reveals === 'off') css.push('.animated{ opacity: 1 !important; animation: none !important; transform: none !important; }');
      if (still) {
        css.push('html:not([data-rv-editing]) *, html:not([data-rv-editing]) *::before, html:not([data-rv-editing]) *::after{ animation-duration: .001s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: .001s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }');
        html.setAttribute('data-rv-motion', 'off');
      } else {
        html.removeAttribute('data-rv-motion');
      }
      syncFonts();
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
      // what the headings show: a design whose headings do not read the variable has its own font there
      headingFont: function () {
        var h = firstHeading();
        return firstFamily(rules.headingFont || (h ? win.getComputedStyle(h).fontFamily : '') || cssVar(headingVar));
      },
      bodyFont: function () { return firstFamily(cssVar('--body-font-family') || win.getComputedStyle(body).fontFamily); },
      textColor: function () { return toHex((generated && cssVar('--rv-text')) || cssVar('--default-color') || win.getComputedStyle(body).color); },
      bgColor: function () { return toHex((generated && cssVar('--rv-bg')) || win.getComputedStyle(body).backgroundColor); },
      bgImage: function () { return rules.bgImage || ''; },
      bgOpacity: function () { return rules.bgOpacity == null ? 100 : rules.bgOpacity; },
      bodySize: function () {
        if (generated) { var p = find(PROSE); return rules.bodySize || (p ? Math.round(parseFloat(win.getComputedStyle(p).fontSize)) : 0) || 18; }
        return parseInt(cssVar('--para-font-size'), 10) || parseInt(win.getComputedStyle(body).fontSize, 10) || 16;
      },
      bodyWeight: function () {
        if (generated) { var p = find(PROSE); return rules.bodyWeight || (p ? win.getComputedStyle(p).fontWeight : '400'); }
        return win.getComputedStyle(body).fontWeight;
      },
      sectionSpacing: function () {
        if (generated) { var sec = find(MIDDLE); return rules.sectionSpacing != null ? rules.sectionSpacing : (sec ? Math.round(parseFloat(win.getComputedStyle(sec).paddingTop)) : 0); }
        return parseInt(cssVar('--bg-spacing'), 10) || 0;
      },
      divider: function () { return rules.divider || 'none'; },
      animation: function () { return rules.animation || 'none'; },
      headingSize: function () { return rules.headingSize || parseInt(cssVar('--primary-font-size'), 10) || 32; },
      headingWeight: function () { return rules.headingWeight || ''; },
      headingColor: function () { return rules.headingColor || ''; },
      headingCase: function () { return rules.headingCase || ''; },
      headingAlign: function () { return rules.headingAlign || ''; },
      radius: function () { return rules.radius || ''; },
      motion: function () { return rules.motion || ''; },
      reveals: function () { return rules.reveals || ''; }
    };
    /* Sanitised where a value ends up inside the rules above: it may have come from the AI assistant. */
    function clean(v) { return String(v == null ? '' : v).replace(/[;{}<>\\]/g, '').trim(); }
    var setters = {
      themeColor: function (hex) {
        body.style.setProperty('--theme-color', hex);
        html.style.setProperty('--theme-color', rgbTriplet(hex));      // ET also keeps an "r, g, b" copy on :root
        html.style.setProperty('--theme-color-hex', hex);
        /* a page that carries the reading colours of its brand colour (an AI-designed site: rv-theme.js derivedVars —
           a brand button's ground and words, the brand colour as small text) gets them for the new one, so what the
           editor shows is what publishing makes readable */
        var T = window.RevampTheme;
        if (T && T.derivedVars && body.style.getPropertyValue('--rv-on-theme')) {
          var d = T.derivedVars({ theme: hex, bg: toHex(cssVar('--rv-bg')), surface: toHex(cssVar('--rv-surface')) });
          ['--rv-theme-fill', '--rv-on-theme', '--rv-theme-ink'].forEach(function (k) { if (d[k]) body.style.setProperty(k, d[k]); });
        }
      },
      /* the variable, for everything that reads it, and a rule on the headings themselves: not every design's
         headings read the variable */
      headingFont: function (stack) {
        stack = clean(stack);
        body.style.setProperty(headingVar, stack);
        if (stack) rules.headingFont = stack; else delete rules.headingFont;
        render();
      },
      bodyFont: function (stack) { body.style.setProperty('--body-font-family', clean(stack)); render(); },
      textColor: function (hex) {
        body.style.setProperty('--default-color', hex); body.style.setProperty('--body-color', hex);
        if (generated) { body.style.setProperty('--rv-text', hex); body.style.color = hex; }
      },
      bgColor: function (hex) {
        body.style.backgroundColor = hex; body.style.setProperty('--bg-color', hex);
        if (generated) body.style.setProperty('--rv-bg', hex);
      },
      bgImage: function (url) { rules.bgImage = url || ''; if (!url) delete rules.bgImage; applyBackground(); render(); },
      bgOpacity: function (n) { rules.bgOpacity = +n; applyBackground(); render(); },
      bodySize: function (px) {
        body.style.setProperty('--para-font-size', px + 'px'); body.style.fontSize = px + 'px';
        if (generated) { rules.bodySize = parseInt(px, 10) || 18; render(); }
      },
      bodyWeight: function (w) {
        body.style.fontWeight = w;
        if (generated) { rules.bodyWeight = clean(w); render(); }
      },
      sectionSpacing: function (px) {
        body.style.setProperty('--bg-spacing', px + 'px 0');
        if (generated) { rules.sectionSpacing = Math.max(0, parseInt(px, 10) || 0); render(); }
      },
      headingSize: function (px) {
        px = parseInt(px, 10);
        if (!px) return;
        body.style.setProperty('--primary-font-size', px + 'px');
        rules.headingSize = px;
        render();
      }
    };
    ['divider', 'animation', 'headingWeight', 'headingColor', 'headingCase', 'headingAlign', 'radius', 'motion', 'reveals'].forEach(function (k) {
      setters[k] = function (v) { v = clean(v); if (v) rules[k] = v; else delete rules[k]; render(); };
    });

    /* ---------- what a setting can act on ----------
       A setting that only writes a variable changes nothing on a page whose CSS never reads that variable (an
       imported site, an AI design with fixed colours); one that styles headings, buttons or cards needs some. */
    var READS = generated
      /* the background too is only as changeable as the sections make it; spacing is a rule, so it always is */
      ? { themeColor: ['--theme-color', '--theme-color-hex'], textColor: ['--rv-text', '--default-color', '--body-color'],
        bgColor: ['--rv-bg'], bodyFont: ['--body-font-family'] }
      : { themeColor: ['--theme-color', '--theme-color-hex'], textColor: ['--default-color', '--body-color'],
        bodyFont: ['--body-font-family'], sectionSpacing: ['--bg-spacing'] };
    /* The variables that reach something on this page: read by a rule (or an inline style) that applies to an
       element that is here, directly or through another variable such a rule defines from it. A shared stylesheet
       that reads --theme-color only for classes this page does not use does not count. */
    var used = null, usedFor = '';
    // what the answers below were worked out for: they hold until the page gains or loses a stylesheet or a section
    function pageStamp() { return doc.styleSheets.length + ':' + doc.querySelectorAll('[data-rv-section]').length; }
    function variablesRead() {
      var stamp = pageStamp();
      if (used && usedFor === stamp) return used;
      used = {}; usedFor = stamp;
      var defines = {};                                   // variable -> the variables its value is made from
      function note(text) {
        var rest = text.replace(/(--[\w-]+)\s*:\s*([^;}]*)/g, function (m, name, value) {
          var re = /var\(\s*(--[\w-]+)/g, v;
          while ((v = re.exec(value))) (defines[name] = defines[name] || []).push(v[1]);
          return '';
        });
        var read = /var\(\s*(--[\w-]+)/g, r;
        while ((r = read.exec(rest))) used[r[1]] = 1;
      }
      function applies(selector) {
        // a state or a pseudo-element of something that is here counts as here
        return !!find(selector.replace(/::?(before|after|hover|focus-visible|focus-within|focus|active|visited|placeholder|selection|first-letter|first-line|marker)\b/g, ''));
      }
      function walkRules(list) {
        for (var i = 0; list && i < list.length; i++) {
          var r = list[i];
          if (r.type === 1) { if (r.cssText.indexOf('var(') !== -1 && applies(r.selectorText)) note(r.style.cssText); }
          else if (r.cssRules) walkRules(r.cssRules);
        }
      }
      Array.prototype.forEach.call(doc.styleSheets, function (sheet) {
        if (ownSheet(sheet.ownerNode)) return;
        try { walkRules(sheet.cssRules); } catch (e) { /* another origin's sheet cannot be read */ }
      });
      Array.prototype.forEach.call(doc.querySelectorAll('[style*="var(--"]'), function (el) { note(el.getAttribute('style')); });
      for (var grew = true; grew;) {
        grew = false;
        Object.keys(defines).forEach(function (name) {
          if (!used[name]) return;
          defines[name].forEach(function (from) { if (!used[from]) { used[from] = 1; grew = true; } });
        });
      }
      return used;
    }
    /* Reading the CSS only says a variable is used somewhere on the page; whether what uses it is then seen (a
       section may set its own colour over an inherited one) is known by setting it and looking. That is done the
       first time such a setting is changed: when nothing on the page looks different, the change is taken back
       and the setting counts as having nothing to act on. */
    var reaches = {};
    function looks() {
      function of(el, pseudo) {
        var cs = win.getComputedStyle(el, pseudo);
        return cs.color + cs.backgroundColor + cs.backgroundImage + cs.borderTopColor + cs.borderBottomColor;
      }
      return Array.prototype.map.call(doc.querySelectorAll('[data-rv-section], [data-rv-section] *'), function (el) {
        var cs = win.getComputedStyle(el);
        return of(el) + of(el, '::before') + of(el, '::after') + cs.borderLeftColor + cs.outlineColor + cs.fill + cs.stroke +
          cs.boxShadow + cs.textDecorationColor + cs.fontFamily + cs.paddingTop + cs.paddingBottom + cs.marginTop + cs.marginBottom;
      }).join('|');
    }
    function sameAsNow(key, value) {
      return String(getters[key]()).toLowerCase() === (key === 'bodyFont' ? firstFamily(value) : String(value)).toLowerCase();
    }
    function tryOut(key, value) {
      // a colour that eases in would still read as the old one
      var steady = doc.createElement('style');
      steady.textContent = '*, *::before, *::after{ transition: none !important; }';
      doc.head.appendChild(steady);
      var htmlWas = html.getAttribute('style'), bodyWas = body.getAttribute('style'), before = looks();
      setters[key](value);
      var changed = looks() !== before;
      steady.remove();
      if (!changed) {
        if (htmlWas === null) html.removeAttribute('style'); else html.setAttribute('style', htmlWas);
        if (bodyWas === null) body.removeAttribute('style'); else body.setAttribute('style', bodyWas);
        render();
      }
      return changed;
    }
    function set(key, value) {
      if (!READS[key]) { setters[key](value); return true; }
      var known = reaches[key] && reaches[key].stamp === pageStamp() ? reaches[key] : null;
      if ((known && known.ok) || sameAsNow(key, value)) { setters[key](value); return true; }
      var ok = tryOut(key, value);
      reaches[key] = { stamp: pageStamp(), ok: ok };
      return ok;
    }

    function supports(key) {
      if (READS[key]) {
        if (reaches[key] && reaches[key].stamp === pageStamp()) return reaches[key].ok;
        var seen = variablesRead();
        return READS[key].some(function (v) { return seen[v]; });
      }
      if (/^heading/.test(key)) return !!firstHeading();
      if (key === 'radius') return !!((conf.buttons && find(conf.buttons)) || (conf.cards && find(conf.cards)));
      if (key === 'reveals') return !!doc.querySelector('.animated');
      /* a wallpaper behind the page would sit under sections that each paint their own background */
      if (generated && (key === 'bgImage' || key === 'bgOpacity')) return false;
      return !!setters[key];
    }

    return {
      get: function (key) { return getters[key](); },
      /* false when the setting was tried and changed nothing on this page; it is then left as it was */
      set: set,
      supports: supports,
      /* the heading colour the page shows now, whether or not one has been set */
      headingColorShown: function () {
        var h = firstHeading();
        return rules.headingColor || (h ? toHex(win.getComputedStyle(h).color) : '');
      },
      /* after a font has been set on a single element: its family is loaded like the site's own two */
      syncFonts: syncFonts,
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
  var LOAD_TIMEOUT_MS = 20000;

  function mount(frame, templateId, opts) {
    var viewport = document.createElement('div');
    viewport.className = 'tpl-viewport';
    var iframe = document.createElement('iframe');
    iframe.className = 'tpl-iframe';
    iframe.title = 'Template canvas';
    viewport.appendChild(iframe);
    frame.appendChild(viewport);

    return RevampTemplates.load(templateId, {
      editing: true,
      headExtra: ['<link rel="stylesheet" href="' + EDITOR_CSS + '" data-rv-editor>'],
      sectionOrder: opts && opts.sectionOrder
    }).then(function (res) {
      return new Promise(function (resolve, reject) {
        var canvas = null, gaveUp = false, early = false;
        function ready() {
          clearTimeout(stalled);
          canvas = makeCanvas(viewport, iframe, res.template);
          guardNavigation(canvas.doc);
          resolve(canvas);
        }
        /* The load event waits for every picture and font. A page that is all there but still fetching some of
           them after this long is used as it is; one that has not even been read through is a failure the
           caller can show, not an empty box. */
        var stalled = setTimeout(function () {
          var d = iframe.contentDocument;
          if (d && d.body && d.readyState !== 'loading') { early = true; ready(); return; }
          gaveUp = true;
          var err = new Error('The page took too long to load.');
          err.code = 'timeout';
          reject(err);
        }, LOAD_TIMEOUT_MS);
        iframe.addEventListener('load', function () {
          if (gaveUp) return;
          if (early) { early = false; return; }                                   // the load that was not waited for
          if (canvas) { if (canvas.onNavigate) canvas.onNavigate(); return; }     // a second load: the page went somewhere
          ready();
        });
        iframe.srcdoc = res.html;
      });
    }).catch(function (err) {
      viewport.remove();          // nothing half-mounted is left behind for the next attempt
      throw err;
    });
  }

  /* Capture phase, so it runs before anything on the page; only the browser's own action is cancelled — the page's
     and the editor's listeners still see the event. */
  function guardNavigation(doc) {
    function stop(e) {
      var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      if (!t) return;
      if (t.closest('a, area')) { e.preventDefault(); return; }
      var control = t.closest('button, input');
      if (control && control.form && (control.type === 'submit' || control.type === 'image')) e.preventDefault();
    }
    doc.addEventListener('click', stop, true);
    doc.addEventListener('auxclick', stop, true);       // middle click opens a link in a new tab
    doc.addEventListener('submit', function (e) { e.preventDefault(); }, true);
  }

  function makeCanvas(viewport, iframe, template) {
    var doc = iframe.contentDocument;
    var win = iframe.contentWindow;
    var device = 'desktop';
    var scale = 1;

    var names = {}, types = { generic: 1 };
    template.sections.forEach(function (s) {
      names[s.id] = s.name && s.name !== s.id ? s.name : readableName(s.id);
      types[s.id] = 1;
    });

    // untouched copies of the template's sections, taken before anything is marked or edited
    var library = sectionsOf(doc).map(function (sec) {
      var id = sec.getAttribute('data-rv-section');
      var h = sec.querySelector('h1, h2, h3');
      // as it reads on the page (line breaks between its parts), or its plain text when it is not laid out
      return { id: id, name: names[id] || id, html: sec.outerHTML, snippet: h ? (h.innerText || h.textContent).replace(/\s+/g, ' ').trim().slice(0, 90) : '' };
    });

    // each template section's CSS as its file has it now — what a restored page gets, whatever was saved
    var ownCss = {};
    doc.querySelectorAll('style[data-rv-style]').forEach(function (st) { ownCss[st.getAttribute('data-rv-style')] = st.textContent; });
    /* That holds for the templates kept as files: their CSS is code, and a fix to it must reach pages saved before
       it. The CSS of an AI-designed or imported site was made for that one event and is replaced or gone when the
       design is made again, so it is saved with the page's markup and put back as saved. */
    var ownsCss = !/^(gen-|imported-)/.test(template.id || '');

    /* The key that tells this section from the others of its type: kept when it has one nobody else on the page
       uses, otherwise the type, then <type>-2, <type>-3 … */
    function keyTaken(key, el) {
      var owners = doc.querySelectorAll('[data-rv-key="' + CSS.escape(key) + '"]');
      return owners.length > 1 || (owners.length === 1 && owners[0] !== el);
    }
    function ensureKey(el) {
      var key = el.getAttribute('data-rv-key');
      if (key && !keyTaken(key, el)) return key;
      var type = el.getAttribute('data-rv-section') || 'section', n = 1;
      key = type;
      while (keyTaken(key, el)) key = type + '-' + (++n);
      el.setAttribute('data-rv-key', key);
      return key;
    }
    function sectionByKey(key) {
      return key ? doc.querySelector('[data-rv-section][data-rv-key="' + CSS.escape(key) + '"]') : null;
    }

    tagEditables(doc, names, ensureKey);

    function prepare(el, name) {
      el.setAttribute('data-sec-name', name);
      el.removeAttribute('data-rv-key');
      ensureKey(el);
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

    /* Gives every id inside el that the page already uses a fresh one, repoints what refers to it inside el, and
       puts the CSS copied for the new ids right after `owner` — the section the copy belongs to, so the CSS is
       saved, and removed, with it. */
    function renameDuplicateIds(el, owner) {
      var renames = {};
      [el].concat(Array.prototype.slice.call(el.querySelectorAll('[id]'))).forEach(function (n) {
        if (n.id && doc.querySelectorAll('#' + CSS.escape(n.id)).length > 1) {
          var fresh = uniqueId(n.id);
          renames[n.id] = fresh;
          n.id = fresh;
        }
      });
      if (!Object.keys(renames).length) return;
      var css = copyRulesFor(renames);
      if (css) {
        var st = doc.createElement('style');
        st.setAttribute('data-rv-copy-for', ensureKey(owner));
        st.textContent = css;
        owner.after(st);
      }
      // references to renamed ids (anchor links, labels, aria, an icon's own gradient or clip path)
      var inSvg = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/g;
      [el].concat(Array.prototype.slice.call(el.querySelectorAll('*'))).forEach(function (n) {
        ['href', 'xlink:href', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby'].forEach(function (a) {
          var v = n.getAttribute(a);
          if (!v) return;
          var isRef = a === 'href' || a === 'xlink:href';
          if (isRef && v.charAt(0) !== '#') return;
          var key = isRef ? v.slice(1) : v;
          if (renames[key]) n.setAttribute(a, (isRef ? '#' : '') + renames[key]);
        });
        ['fill', 'stroke', 'clip-path', 'mask', 'filter', 'style'].forEach(function (a) {
          var v = n.getAttribute(a);
          if (!v || v.indexOf('url(') === -1) return;
          var next = v.replace(inSvg, function (m, id) { return renames[id] ? 'url(#' + renames[id] + ')' : m; });
          if (next !== v) n.setAttribute(a, next);
        });
      });
    }

    function adopt(el) {
      ensureKey(el);
      renameDuplicateIds(el, el);
      if (win.RevampSections) win.RevampSections.init(el);
      return el;
    }

    function adoptElement(el) {
      renameDuplicateIds(el, el.closest('[data-rv-section]') || el);
      return el;
    }

    /* ---------- items that open (accordions) ----------
       template.json → sections[].toggle: { item, open, expanded } — e.g. an FAQ whose .faq-item gets .active. The
       site's own script opens them on click, but the editor stops canvas clicks before they reach the site's scripts
       (editor-template-ui.js, wireCanvasEvents), so the editor opens an item itself when something inside it is
       clicked: its answer can then be picked and edited. That open state belongs to the editor only (data-rv-open /
       data-rv-aria), so saves, undo steps and the published page keep every item as the template has it.

       A saved page can still hold an item that is open with no editor marker (the site's script opened it).
       closeStray() puts those back as the template has them — in what is saved and published (nodeHtml, serialize)
       and in the canvas when such a page is restored. */
    function toggleOf(sec) {
      var id = sec.getAttribute('data-rv-section');
      var s = template.sections.filter(function (x) { return x.id === id; })[0];
      return s && s.toggle;
    }
    function unopen(root) {
      [root].concat(Array.prototype.slice.call(root.querySelectorAll('[data-rv-open], [data-rv-aria]'))).forEach(function (m) {
        if (m.hasAttribute('data-rv-open')) {
          if (m.tagName === 'DETAILS') m.removeAttribute('open');      // a native <details> the editor opened (openItem)
          else m.classList.remove(m.getAttribute('data-rv-open'));
          m.removeAttribute('data-rv-open');
          if (!m.getAttribute('class')) m.removeAttribute('class');
        }
        if (m.hasAttribute('data-rv-aria')) {
          m.setAttribute('aria-expanded', m.getAttribute('data-rv-aria'));
          m.removeAttribute('data-rv-aria');
        }
      });
    }
    var openAtStart = {};       // section id -> which of its items the template itself has open, by position
    function templateOpen(id, t) {
      if (!openAtStart[id]) {
        var item = library.filter(function (s) { return s.id === id; })[0];
        var tmp = doc.createElement('template');
        tmp.innerHTML = item ? item.html : '';
        openAtStart[id] = Array.prototype.map.call(tmp.content.querySelectorAll(t.item), function (it) { return it.classList.contains(t.open); });
      }
      return openAtStart[id];
    }
    function hasStray(sec) {
      var t = toggleOf(sec);
      if (!t) return false;
      var start = templateOpen(sec.getAttribute('data-rv-section'), t);
      return Array.prototype.some.call(sec.querySelectorAll(t.item), function (it, i) {
        return it.classList.contains(t.open) && !it.hasAttribute('data-rv-open') && !start[i];
      });
    }
    function closeStray(sec) {
      var t = toggleOf(sec);
      if (!t) return;
      var start = templateOpen(sec.getAttribute('data-rv-section'), t);
      Array.prototype.forEach.call(sec.querySelectorAll(t.item), function (it, i) {
        if (!it.classList.contains(t.open) || it.hasAttribute('data-rv-open') || start[i]) return;
        it.classList.remove(t.open);
        if (!it.getAttribute('class')) it.removeAttribute('class');
        var trigger = t.expanded && it.querySelector(t.expanded);
        if (trigger && trigger.getAttribute('aria-expanded') === 'true' && !trigger.hasAttribute('data-rv-aria')) trigger.setAttribute('aria-expanded', 'false');
      });
    }

    /* Saved pages can carry a link's address in data-href, an attribute no browser follows. Where the element is a
       link with no real address, the saved one becomes its href (unless it is one a link may not have); the
       attribute itself is dropped everywhere. */
    function dropLegacyHref(root) {
      [root].concat(Array.prototype.slice.call(root.querySelectorAll('[data-href]'))).forEach(function (n) {
        if (!n.hasAttribute || !n.hasAttribute('data-href')) return;
        var v = (n.getAttribute('data-href') || '').trim();
        if (n.tagName === 'A' && !n.getAttribute('href') && /^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(v)) n.setAttribute('href', v);
        n.removeAttribute('data-href');
      });
    }

    /* the item that opens and closes around el: a template accordion item, else a native <details> */
    function itemAround(el) {
      var sec = el.closest('[data-rv-section]'), t = sec && toggleOf(sec);
      if (!sec) return null;
      var item = t ? el.closest(t.item) : null;
      if (item && item !== sec && sec.contains(item)) return item;
      var det = el.closest('details');
      return det && sec.contains(det) ? det : null;
    }

    function openItem(el) {
      /* A native <details> — the FAQ markup of imported and AI-designed pages — has no toggle entry in
         template.json, and its own click-to-open is one of the default actions the editor cancels for every
         canvas click. So it is opened here, under the same editor-only marker as a template accordion: the
         answer inside can be reached and edited, and saves and the published page keep it closed. One the
         page itself ships open has no marker and stays open. */
      var item = itemAround(el);
      if (!item) return false;
      if (item.tagName === 'DETAILS') {
        if (item.hasAttribute('open')) return false;
        item.setAttribute('open', '');
        item.setAttribute('data-rv-open', 'open');
        return true;
      }
      var sec = el.closest('[data-rv-section]'), t = toggleOf(sec);
      if (item.classList.contains(t.open)) return false;
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

    /* ---------- a section's background picture ----------
       A picture set as a CSS background (a hero banner behind its text) is not an element anyone can click:
       the section's own menu changes it. backgroundHost(sec) is the element that carries it — the section or
       the largest thing inside it with a picture as its background, covering a good part of the section. */
    function bgUrlOf(el) {
      var m = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(win.getComputedStyle(el).backgroundImage || '');
      return m && !/^data:/i.test(m[2]) ? m[2] : '';
    }
    function backgroundHost(sec) {
      if (!sec) return null;
      var whole = sec.getBoundingClientRect(), area = whole.width * whole.height, best = null, bestArea = 0;
      [sec].concat(Array.prototype.slice.call(sec.querySelectorAll('*'))).forEach(function (el) {
        if (el.hasAttribute('data-editable') && el.getAttribute('data-editable') === 'image') return;   // a picture box is clicked directly
        if (!bgUrlOf(el)) return;
        var r = el.getBoundingClientRect(), a = r.width * r.height;
        if (a >= area * 0.3 && a > bestArea) { best = el; bestArea = a; }
      });
      return best;
    }
    /* the new picture takes the old one's place; whatever is layered over it (a gradient veil that keeps the
       text readable) stays */
    function setBackgroundPicture(el, url) {
      var now = win.getComputedStyle(el).backgroundImage || '';
      var next = 'url("' + String(url).replace(/"/g, '%22') + '")';
      el.style.backgroundImage = /url\(/.test(now) ? now.replace(/url\(\s*(["']?).*?\1\s*\)/, next) : next;
    }

    /* ---------- a section designed again ----------
       Only where the section's CSS belongs to this one site and is saved with it (an AI-designed site), and
       the section is the only one of its type: its CSS is kept by type, so a copy would change with it. */
    function canRedesign(sec) {
      if (!sec || !/^gen-/.test(template.id || '')) return false;
      var type = sec.getAttribute('data-rv-section');
      if (type === 'hero') return false;       // the banner keeps the one pattern every ET event site has
      if (sec.hasAttribute('data-rv-etnav')) return false;   // so does ET's own top bar (functions/lib/et-nav.js)
      return doc.querySelectorAll('[data-rv-section="' + type.replace(/["\\]/g, '\\$&') + '"]').length === 1 &&
        !!doc.querySelector('style[data-rv-style="' + type.replace(/["\\]/g, '\\$&') + '"]');
    }
    function sectionCss(sec) {
      var st = doc.querySelector('style[data-rv-style="' + sec.getAttribute('data-rv-section').replace(/["\\]/g, '\\$&') + '"]');
      return st ? st.textContent : '';
    }
    /* the new markup takes the section's place and keeps its identity (type, key, name, id, hidden state);
       the new CSS takes the old one's. -> the new section element, or null when the markup has no element */
    function replaceSection(sec, html, css) {
      var t = doc.createElement('template');
      t.innerHTML = String(html || '').trim();
      var fresh = t.content.firstElementChild;
      if (!fresh) return null;
      fresh = doc.importNode(fresh, true);
      Array.prototype.forEach.call(sec.attributes, function (a) {
        if (a.name === 'id' || /^data-sec-/.test(a.name) || /^data-rv-(section|key)$/.test(a.name)) fresh.setAttribute(a.name, a.value);
      });
      if (sec.classList.contains('is-hidden-sec')) fresh.classList.add('is-hidden-sec');
      var type = sec.getAttribute('data-rv-section');
      var st = doc.querySelector('style[data-rv-style="' + type.replace(/["\\]/g, '\\$&') + '"]');
      sec.replaceWith(fresh);
      if (st && css != null) st.textContent = String(css);       // null: the CSS is not this call's to change
      descend(fresh, false);
      if (win.RevampSections) win.RevampSections.init(fresh);
      return fresh;
    }

    function cleanCopy(root) {
      unopen(root);
      [root].concat(Array.prototype.slice.call(root.querySelectorAll('.ed-selected, .sec-active, [contenteditable]'))).forEach(function (n) {
        n.classList.remove('ed-selected', 'sec-active');
        n.removeAttribute('contenteditable');
        if (!n.className) n.removeAttribute('class');
      });
      root.classList.remove('is-hidden-sec');
      if (!root.getAttribute('class')) root.removeAttribute('class');
      root.removeAttribute('data-scheduled-at');
    }

    /* ---------- hidden sections ----------
       Hidden is the is-hidden-sec class and nothing else: the editor shows such a section as a slim bar that can be
       clicked to bring it back (editor-canvas.css), and serialize() leaves it out of the page. Pages saved earlier
       also carry an inline display:none, which would keep the bar from showing; it is taken off wherever it is met. */
    function setHidden(sec, hide) {
      sec.classList.toggle('is-hidden-sec', !!hide);
      if (!sec.getAttribute('class')) sec.removeAttribute('class');
      if (sec.style.display === 'none') {
        sec.style.display = '';
        if (!sec.getAttribute('style')) sec.removeAttribute('style');
      }
    }

    /* ---------- where a section may be ----------
       template.json → layout.pinStart / pinEnd name the sections that open and close every page of this design
       (the banner; contact and the publisher's block). The one instance that is the template's own (its key is its
       type) stays where it is, and no other section moves across it. */
    var layout = template.layout || {};
    function pinned(sec) {
      var type = sec.getAttribute('data-rv-section');
      if (sec.getAttribute('data-rv-key') !== type) return '';
      if ((layout.pinStart || []).indexOf(type) !== -1) return 'start';
      if ((layout.pinEnd || []).indexOf(type) !== -1) return 'end';
      return '';
    }
    /* the CSS that travels with a section: its template CSS and the rules copied for its renamed ids, when they
       follow it directly */
    function ownStyle(n, sec) {
      if (!n || n.tagName !== 'STYLE') return false;
      if (n.hasAttribute('data-rv-style')) return n.getAttribute('data-rv-style') === sec.getAttribute('data-rv-section');
      var owner = n.getAttribute('data-rv-copy-for');
      return owner !== null && (owner === sec.getAttribute('data-rv-key') || (!!sec.id && owner === sec.id));
    }
    function withStyles(sec) {
      var run = [sec];
      for (var n = sec.nextElementSibling; ownStyle(n, sec); n = n.nextElementSibling) run.push(n);
      return run;
    }
    function placeAfter(nodes, sec) {
      var ref = withStyles(sec).pop();
      nodes.forEach(function (n) { ref.after(n); ref = n; });
    }
    function placeBefore(nodes, sec) {
      nodes.forEach(function (n) { sec.parentNode.insertBefore(n, sec); });
    }
    function canMoveSection(sec, before) {
      var secs = sectionsOf(doc), from = secs.indexOf(sec), to = before ? secs.indexOf(before) : secs.length;
      if (from === -1 || to === -1 || pinned(sec)) return false;
      if (to === from || to === from + 1) return false;                       // it is there already
      var crossed = to > from ? secs.slice(from + 1, to) : secs.slice(to, from);
      return !crossed.some(pinned);
    }
    function moveSection(sec, before) {
      if (!canMoveSection(sec, before)) return false;
      var nodes = withStyles(sec);
      if (before) placeBefore(nodes, before);
      else placeAfter(nodes, sectionsOf(doc).filter(function (s) { return s !== sec; }).pop());
      return true;
    }
    /* A new section goes after afterSec, pulled inside the stretch between the pinned sections: never above what
       opens the page or below what closes it. One that is itself the template's pinned section (the banner put
       back after it was deleted) returns to its end of the page, next to its neighbour in the template's order. */
    function insertSection(el, afterSec) {
      var secs = sectionsOf(doc).filter(function (s) { return s !== el; });
      var type = el.getAttribute('data-rv-section');
      var own = sectionByKey(type);
      var end = own && own !== el ? '' : (layout.pinStart || []).indexOf(type) !== -1 ? 'start' : (layout.pinEnd || []).indexOf(type) !== -1 ? 'end' : '';
      if (end) {
        var order = library.map(function (s) { return s.id; }), at = order.indexOf(type), prev = null, next = null;
        secs.forEach(function (s) {
          if (s.getAttribute('data-rv-key') !== s.getAttribute('data-rv-section')) return;
          var i = order.indexOf(s.getAttribute('data-rv-section'));
          if (i !== -1 && i < at) prev = s;
          if (i > at && !next) next = s;
        });
        if (end === 'start' && prev) placeAfter([el], prev);
        else if (end === 'start' && secs.length) placeBefore([el], secs[0]);
        else if (end === 'end' && next) placeBefore([el], next);
        else if (secs.length) placeAfter([el], secs[secs.length - 1]);
        else api.contentRoot().appendChild(el);
        return adopt(el);
      }
      var lo = -1, hi = secs.length;
      secs.forEach(function (s, i) {
        var pin = pinned(s);
        if (pin === 'start') lo = i;
        if (pin === 'end' && hi === secs.length) hi = i;
      });
      var to = afterSec && secs.indexOf(afterSec) !== -1 ? secs.indexOf(afterSec) + 1 : hi;
      to = Math.max(lo + 1, Math.min(to, hi));
      if (to > 0) placeAfter([el], secs[to - 1]);
      else if (secs.length) placeBefore([el], secs[0]);
      else api.contentRoot().appendChild(el);
      return adopt(el);
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
      root.removeAttribute('data-rv-editor-mode');
      /* the section edges are the site's setting (designPlan.design.sectionEdges), written onto the page when it is
         previewed and published — the canvas only shows them */
      root.removeAttribute('data-rv-edges');
      // hidden (and not-yet-live scheduled) sections aren't on the published page
      root.querySelectorAll('[data-rv-section].is-hidden-sec').forEach(function (sec) {
        copiedStyles(root, sec).forEach(function (s) { s.remove(); });
        sec.remove();
      });
      root.querySelectorAll('[data-rv-editor]').forEach(function (n) { n.remove(); });
      /* The AI-review pills and marks (editor-template-ui.js, renderAiProvenanceBadges) are the editor's working
         notes. Only the editor's stylesheet keeps the pills out of sight, so on a page without it they would print
         as text at the top of each section. */
      root.querySelectorAll('.ai-prov-badge, .ai-skip-badge, .ai-media-skip-badge').forEach(function (n) { n.remove(); });
      root.classList.remove('show-ai-markers');
      if (!root.getAttribute('class')) root.removeAttribute('class');
      var EDITOR_ATTRS = ['data-editable', 'contenteditable', 'data-sec-name', 'data-text-original', 'data-date', 'data-date-shown', 'data-date-format',
        'data-ed', 'data-rv-cur-item', 'data-ai-generated', 'data-ai-skipped', 'data-ai-media-skipped'];
      root.querySelectorAll(EDITOR_ATTRS.map(function (a) { return '[' + a + ']'; }).join(', ')).forEach(function (n) {
        EDITOR_ATTRS.forEach(function (a) { n.removeAttribute(a); });
      });
      root.querySelectorAll('.ed-selected, .sec-active').forEach(function (n) {
        n.classList.remove('ed-selected', 'sec-active');
        if (!n.className) n.removeAttribute('class');
      });
      unopen(root);
      root.querySelectorAll('[data-rv-section]').forEach(closeStray);
      dropLegacyHref(root);
      return '<!DOCTYPE html>\n' + root.outerHTML;
    }

    /* the CSS made for a section's renamed ids: kept under its key, and under its id on pages saved earlier */
    function copiedStyles(root, sec) {
      var key = sec.getAttribute('data-rv-key');
      return Array.prototype.filter.call(root.querySelectorAll('style[data-rv-copy-for]'), function (st) {
        var owner = st.getAttribute('data-rv-copy-for');
        return (!!key && owner === key) || (!!sec.id && owner === sec.id);
      });
    }

    function ensureBlockStyle() {
      if (doc.querySelector('style[data-rv-blocks]')) return;
      var st = doc.createElement('style');
      st.setAttribute('data-rv-blocks', '');
      st.textContent = blockCss((template.design && template.design.headingFontVar) || '--heading-font-family');
      doc.head.appendChild(st);
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
         blocks       whether it has the CSS of the Add panel's blocks (rebuilt, not stored)
         nodes        the content column, one HTML string per element: sections (hidden and scheduled ones too, with
                      their names and editable markers) and the CSS copied for duplicates. A file-based template
                      section's own <style data-rv-style> is kept as an empty placeholder and refilled from the
                      template's file, so a fix to the template's CSS reaches pages saved before it; an AI-designed
                      or imported site's is kept whole (see ownsCss).
       Selection, in-place editing and items the editor opened are left out. The shared header and footer aren't the
       page's to change. */
    var TRANSIENT = '.ed-selected, .sec-active, [contenteditable], [data-text-original], [data-rv-open], [data-rv-aria], [data-rv-cur-item]';

    /* takes the editor's selection and editing marks off a copy */
    function stripTransient(c) {
      [c].concat(Array.prototype.slice.call(c.querySelectorAll(TRANSIENT))).forEach(function (m) {
        m.classList.remove('ed-selected', 'sec-active');
        if (!m.getAttribute('class')) m.removeAttribute('class');
        m.removeAttribute('contenteditable');
        m.removeAttribute('data-text-original');
        m.removeAttribute('data-rv-cur-item');
      });
      unopen(c);
      return c;
    }

    /* An embedded form's preview (editor-forms.js) is the editor's own drawing, redrawn whenever the form
       changes: it is never part of a snapshot, so drawing it is not an undo step and does not make the page
       "unsaved". */
    /* drawn by the editor over the page and never part of it: a form's preview (editor-forms.js) and the banner
       video's still with its badge (hero-video-ui.js) */
    var FORM_PREVIEW = '[data-rv-form-preview], [data-rv-hv-preview]';
    function nodeHtml(n) {
      if (ownsCss && n.matches('style[data-rv-style]')) return '<style data-rv-style="' + n.getAttribute('data-rv-style').replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></style>';
      var isSection = n.hasAttribute('data-rv-section');
      var previews = !!n.querySelector(FORM_PREVIEW);
      if (!previews && !n.matches(TRANSIENT) && !n.querySelector(TRANSIENT) && !(isSection && hasStray(n))) return n.outerHTML;
      var c = stripTransient(n.cloneNode(true));
      if (previews) c.querySelectorAll(FORM_PREVIEW).forEach(function (p) { p.remove(); });
      if (isSection) closeStray(c);
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
        blocks: !!doc.querySelector('style[data-rv-blocks]'),
        nodes: nodes
      };
    }

    function sameSnapshot(a, b) {
      if (!a || !b || a.html !== b.html || a.body !== b.body || a.design !== b.design || a.generic !== b.generic || !a.blocks !== !b.blocks || a.nodes.length !== b.nodes.length) return false;
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
      if (snap.blocks) ensureBlockStyle();

      // the saved page's own section types: an AI design made again since may no longer have them
      snap.nodes.forEach(function (h) {
        var st = /^<style data-rv-style="([^"]*)"/.exec(h);
        if (st) types[st[1]] = 1;
      });

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
        // a site that keeps its own CSS gets the template's only where the save holds none (a page saved earlier)
        if (n.matches('style[data-rv-style]') && (ownsCss || !n.textContent)) n.textContent = ownCss[n.getAttribute('data-rv-style')] || '';
        built.push(n);
        return n;
      });
      pool.forEach(function (left) { left.forEach(function (n) { n.remove(); }); });
      next.forEach(function (n, i) {
        if (root.children[i] !== n) root.insertBefore(n, root.children[i] || null);
      });
      api.design.syncFonts();           // again now that the content is back: a single text may have a font of its own

      return built.filter(function (n) { return n.hasAttribute('data-rv-section'); }).map(function (sec) {
        /* Pages saved earlier named a copy "<type>-2" in data-rv-section itself, which cut it off from its type's
           script, CSS and settings: the type goes back there and the old value becomes the copy's key. */
        var named = sec.getAttribute('data-rv-section'), m = /^(.+)-\d+$/.exec(named);
        if (!types[named] && m && types[m[1]]) {
          sec.setAttribute('data-rv-section', m[1]);
          if (!sec.hasAttribute('data-rv-key')) sec.setAttribute('data-rv-key', named);
        }
        ensureKey(sec);
        if (sec.classList.contains('is-hidden-sec')) setHidden(sec, true);
        closeStray(sec);
        dropLegacyHref(sec);
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
      insertSection: insertSection,
      adopt: adopt,
      adoptElement: adoptElement,
      copyOf: function (el) { return stripTransient(el.cloneNode(true)); },
      sectionByKey: sectionByKey,
      pinned: pinned,
      canMoveSection: canMoveSection,
      moveSection: moveSection,
      setHidden: setHidden,
      ensureBlockStyle: ensureBlockStyle,
      anchorFor: function (sec) {
        if (!sec.id) {
          var own = ensureKey(sec);
          sec.id = doc.getElementById(own) ? uniqueId(own) : own;
        }
        return sec.id;
      },
      retag: function (el) { descend(el, false); },       // after changing a section's markup: new text becomes editable
      openItem: openItem,                                 // an accordion item around el opened for editing; true if it did
      itemAround: itemAround,
      setPicture: setPicture,                             // a new picture in an <img>, an <svg> icon or an image box
      pictureOf: pictureOf,
      canRedesign: canRedesign,                           // whether "Redesign with AI" applies to this section
      keepsOwnCss: !ownsCss,                              // a site whose section CSS is its own and saved with it
      sectionCss: sectionCss,
      replaceSection: replaceSection,
      backgroundHost: backgroundHost,                     // the element carrying a section's background picture, or null
      backgroundOf: bgUrlOf,
      setBackgroundPicture: setBackgroundPicture,
      duplicateSection: function (sec, name) {
        var copy = sec.cloneNode(true);
        cleanCopy(copy);
        copy.setAttribute('data-sec-name', name);
        copy.removeAttribute('data-rv-key');
        placeAfter([copy], sec);
        return adopt(copy);
      },
      removeSection: function (sec) {
        copiedStyles(doc, sec).forEach(function (s) { s.remove(); });
        sec.remove();
      },
      contentRoot: function () { return doc.querySelector('#content .col-md-12.no-padding') || doc.body; },
      /* bring a section to the top of the canvas, clear of a fixed header */
      scrollToSection: function (el) {
        var hdr = doc.querySelector('[data-rv-locked="header"]'), off = 12;
        if (hdr && /fixed|sticky/.test(win.getComputedStyle(hdr).position)) off += hdr.getBoundingClientRect().height;
        win.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + win.scrollY - off), behavior: 'smooth' });
      },
      onResize: null,         // set by the editor: called after every re-fit
      onNavigate: null,       // set by the editor: the canvas has loaded another document and can no longer be used
      destroy: function () { resizing.disconnect(); viewport.remove(); }
    };

    /* the frame changes size with the window and whenever a side panel opens or closes */
    fit();
    var resizing = new ResizeObserver(function () {
      fit();
      if (api.onResize) api.onResize();
    });
    resizing.observe(viewport);
    return api;
  }

  window.RevampCanvas = { mount: mount, DEVICES: DEVICES };
})();
