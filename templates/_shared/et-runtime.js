/* Site-side runtime shared by every ET template. It ships inside exported sites too, so nothing editor-only lives here.

   RevampSections.register(type, init)
     Per-section behaviour. init(sectionEl) runs once for every element carrying data-rv-section="<type>",
     including copies the editor adds later (it calls RevampSections.init(el) on them).

   RevampSections.widget(name, init)
     The same, for behaviour several templates share (templates/_shared/widgets/<name>/script.js, named by
     template.json → sections[].widget). The loader puts the script on the page once for each section that uses
     it and says which (<script data-rv-script="<section id>">); init runs for the sections of that id.

   RevampSections.accordion(section, { item, trigger, panel, openClass })
     Items that open on a click on their trigger — one at a time, a click inside an open panel does not close
     it. item / trigger / panel are selectors (trigger and panel inside an item); the open item gets openClass
     ("active" unless given) and its trigger aria-expanded="true". A trigger that is a <button> makes the item
     work from the keyboard. While editing, a click changes nothing here: the editor opens an item itself, in a
     way that is not saved with the page.

   Scroll reveal
     Stands in for ET's jQuery "CSS3 Animate It" (etb2b-ms-animate.js). When an .animatedParent scrolls into view
     its .animated children get .go — et-animate.css keeps them at opacity 0 until then. Without .animateOnce they
     reset when scrolled away again, as ET's does. ET's delay-1s/delay-2s classes have no CSS behind them, so they
     are ignored here as well.

   Section links
     RevampSections.resolveHash(name) -> the element a link to "#<name>" means, or null: the element with that id,
     else the section with that data-rv-section, else — for the kinds of content an event has — the section that
     shows it (data-rv-bound / data-rv-auto), under either of its usual names: speakers, agenda | sessions,
     partners | sponsors, gallery | glimpses, faq | faqs, contact | contacts | contact-us. A section that is hidden
     does not count, so a link to content the event does not have goes nowhere instead of to a gap.
     RevampSections.goTo(name) scrolls there (true when it did). Clicks on such links, the address's own #… on
     arrival and later changes of it all go through it. An imported page keeps its own ids and its own way of
     scrolling and is left alone, and nothing scrolls while editing.

   Imported pages
     A page imported from another site builder (.rv-imported) arrives without that site's scripts, and with
     them went whatever revealed its content on scroll: the content would stay at opacity 0 for good. So, in
     the editor as on the live page, the end state the site's own CSS gives under prefers-reduced-motion is
     applied to everyone, and any content still invisible after that is shown (class rv-shown). Closed menus,
     overlays and dialogs — positioned out of the flow — are not touched.
     What that site's scripts did for the visitor is given back here, from the markup alone:
       · an intro curtain caught mid-play — an empty, opaque layer fixed over the whole window — is taken
         away (rv-gone), and a full-window backdrop picture a script had not yet faded in is shown;
       · a top bar the scripts would have revealed is shown (rv-bar) and gets the page's own background once
         the visitor has scrolled (rv-bar-solid), so its links stay readable over the content;
       · menu buttons that are not links go to their section: by the section's id where the label names it,
         else in page order when there are as many buttons as sections; the brand button goes to the top;
       · a button with aria-expanded opens and closes its panel — the one it names (aria-controls, the nearest
         of that id), else the one after it — one at a time per list, looking as it did open on the original
         page (data-rv-open-class / -text) and turning "Read more" into "Read less";
       · tab sets captured with every tab's panel (lovable-scraper-service: data-rv-tab, data-rv-tabpanel,
         data-rv-tab-classes, data-rv-tab-only) switch on a click and the arrow keys, and one that moved on by
         itself (data-rv-tab-auto) does so here too, pausing while pointed at or focused;
       · a top bar whose look changed once the visitor scrolled takes that look past the first few pixels
         (data-rv-scrolled-class); a clear bar imported before that was read gets the page's background
         (rv-bar-clear);
       · carousel arrows in a section's heading drive the row beside them; a measured summary height
         (style="height:25px" over a line-clamped text) is let go; a sign-up button with no link ("Apply to
         join", "Request an invite") opens the event's form (data-register-cta, rv-forms.js);
       · a "menu" button on a narrow window opens the bar's own links as a list (never while editing);
       · the site builder's "Edit with …" badge is removed.

   Easing in (data-rv-reveal)
     A block marked data-rv-reveal (or ="left", "right", "zoom", "fade") eases into view the first time it is
     scrolled to; marked siblings follow one another by a short delay. The hiding is only switched on by this
     script (<html class="rv-motion">), so a page whose script did not run shows everything; nothing is hidden
     while editing or for visitors who asked for no motion. The rules are in gen-base.css.

   Carousels
     A row with more items than fit: the wrapper carries data-rv-carousel and the element holding the items
     data-rv-carousel-track (the wrapper itself when there is none). The track scrolls sideways by its own CSS
     (overflow-x:auto, scroll-snap); this adds a previous and a next button, drag-free keyboard use (the
     buttons are real buttons) and, with data-rv-carousel="auto", a step every few seconds that pauses while
     the visitor points at or focuses the row, or while a pop-up is open (<html data-rv-modal>, rv-popups.js),
     and never runs for visitors who asked for no motion. The
     buttons are made on the live page each time and are never part of the saved site. While editing there
     are no buttons and nothing moves: the row is a strip the editor scrolls and edits item by item.

   The ET event bar (data-rv-etnav, built by functions/lib/et-nav.js)
     At the top of the page it is a full-width bar in the page's flow with a second row of section links; once
     the visitor scrolls past it, it floats at the top centre as a rounded bar (rv-etnav--float) — on a phone a
     compact bar across the top — holding the event's name, its date and place and the links. Links that do not
     fit go under a "More" button, the ones a visitor needs least first (the gallery, the past agenda and
     sponsors, resources, FAQs, about…); a link to a section that is not on the page, or not shown, is left
     out. The link of the section being read is marked (is-active). The menu button opens every link and the
     main action in a panel, closed by Escape, its close button or a click beside it. The More list, the panel
     and these classes are made on the live page only and never saved; while editing the bar stays as it is
     saved, in its top state and in the page's flow, with every link on view.

   Editing
     The editor sets data-rv-editing on <html> before this runs. Reveal is then left to the editor's canvas CSS
     (everything shown, no animation), so no .go classes end up in the saved page; sections check
     RevampSections.editing() to hold back motion of their own (e.g. the banner video).

   Which editor mode a page is in — THE signal for runtime code (data-rv-editor-mode on <html>)
     The site editor has two modes, and a page can be shown in it two ways:
       "manual"  the editor's canvas ("Edit myself"): the page is being edited in place. It always carries
                 data-rv-editing as well. Nothing may move, open or rewrite the DOM: no carousel steps, no
                 reveal, no pop-up (speaker card, glimpse lightbox), no scrolling nav behaviour, no section
                 script. Anything such code added would be saved with the page.
       "ai"      the editor's live view ("Edit with AI"): a throw-away copy of the page as it looks on the
                 draft preview (/preview/<id>?draft=1), rebuilt after every change. It does NOT carry
                 data-rv-editing, so everything runs exactly as on the preview: carousels, reveals, nav,
                 pop-ups. It must still never take the editor anywhere: the editor stops links to other
                 pages and form posts itself, and code here should not store anything (it is a preview).
       absent    a published or previewed page.
     RevampSections.editorMode() -> "manual" | "ai" | "" reads it; RevampSections.editing() stays true only
     for "manual" (and for any page with data-rv-editing). New behaviour that must not fire while editing
     checks editing() — that is all it needs; editorMode() is for code that has to tell the live view from a
     real visitor's page. The attribute never reaches a saved or published page (editor-canvas.js serialize(),
     lib/api.js EDITOR_ONLY_ATTRS). */
(function () {
  'use strict';

  var registry = {};
  var observer = null;

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  function editing() { return document.documentElement.hasAttribute('data-rv-editing'); }
  /* see "Which editor mode a page is in" above */
  function editorMode() {
    var m = document.documentElement.getAttribute('data-rv-editor-mode');
    return m === 'manual' || m === 'ai' ? m : (editing() ? 'manual' : '');
  }

  function initSection(el) {
    var fn = registry[el.getAttribute('data-rv-section')];
    if (!fn || el.__rvInit) return;
    el.__rvInit = true;
    try { fn(el); } catch (err) { console.error('[revamp] section init failed:', el.getAttribute('data-rv-section'), err); }
  }

  function setGo(parent, on) {
    each(parent.querySelectorAll('.animated'), function (a) { a.classList.toggle('go', on); });
  }

  function reveal(root) {
    root = root || document;
    if (editing()) return;
    var parents = root.querySelectorAll('.animatedParent');
    if (!observer) { each(parents, function (p) { setGo(p, true); }); return; }
    each(parents, function (p) { observer.observe(p); });
  }

  /* ---------- imported pages ---------- */
  var SHOWN_CSS = [
    '.rv-imported .rv-shown{opacity:1!important;transform:none!important;filter:none!important;visibility:visible!important;animation:none!important}',
    '.rv-imported .rv-gone{display:none!important}',
    /* in the editor a jump to a section lands at once: a page that scrolls smoothly would still be on its way
       when the editor measures where things are */
    'html[data-rv-editing]{scroll-behavior:auto!important}',
    /* the wrappers an imported page's sections each carry a copy of (import-split.js) add nothing of their
       own: no height, no spacing, no flex share, no drawn layer — only what they pass on to what is inside */
    '.rv-imported [data-rv-wrap]{min-height:0!important;height:auto!important;flex:none!important;padding-top:0!important;padding-bottom:0!important;margin-top:0!important;margin-bottom:0!important}',
    '.rv-imported [data-rv-wrap]::before,.rv-imported [data-rv-wrap]::after{content:none!important}',
    '.rv-imported .rv-bar{opacity:1!important;visibility:visible!important;pointer-events:auto!important}',
    '.rv-imported .rv-bar.rv-bar-solid,.rv-imported .rv-bar-clear.rv-bar-solid{background:var(--rv-bar-bg,#fff)!important;box-shadow:0 1px 0 rgba(128,128,128,.25)}',
    /* the panels of a tab set not chosen (lovable-scraper-service) stay out of sight whatever their classes say */
    /* a row's panel shut by height (et-runtime.js toggleRow, lovable-scraper-service's copies) takes no room at all */
    '.rv-imported [style*="height: 0px"][style*="opacity: 0"]{padding-top:0!important;padding-bottom:0!important;margin-top:0!important;margin-bottom:0!important;border-top-width:0!important;border-bottom-width:0!important}',
    '.rv-imported [data-rv-tabpanel][hidden],.rv-imported [data-rv-tab-only][hidden]{display:none!important}',
    '.rv-imported .rv-menu{position:absolute;left:0;right:0;top:100%;display:flex;flex-direction:column;align-items:flex-start;gap:20px;padding:20px 24px 28px;background:var(--rv-bar-bg,#fff);max-height:calc(100vh - 100%);max-height:calc(100dvh - 100%);overflow:auto;box-shadow:0 14px 24px rgba(0,0,0,.14)}',
    '.rv-imported .rv-menu > *{text-align:left}'
  ].join('\n');
  var MEDIA = 'img, picture, video, svg, canvas, iframe';

  /* The rules a site keeps for visitors who asked for no motion, where they undo a hidden starting state.
     Rules that only stop an animation are left where they are: a ticker or a glow goes on running. */
  function endStates(rules, inReduced, out) {
    each(rules, function (r) {
      var reduced = inReduced || (!!r.conditionText && /prefers-reduced-motion/.test(r.conditionText) && /reduce/.test(r.conditionText));
      if (r.cssRules && r.type !== 1) { endStates(r.cssRules, reduced, out); return; }
      if (reduced && r.style && (r.style.opacity || r.style.visibility)) out.push(r.cssText);
    });
    return out;
  }

  function settledCss() {
    var out = [SHOWN_CSS];
    each(document.querySelectorAll('style[data-rv-imported-css]'), function (st) {
      try { endStates(st.sheet.cssRules, false, out); } catch (err) { /* a sheet that cannot be read adds nothing */ }
    });
    return out.join('\n');
  }

  function hasContent(el) {
    return !!(el.textContent || '').trim() || el.matches(MEDIA) || !!el.querySelector(MEDIA);
  }

  function shownOnHover(el) {
    return /(hover|focus)[^\s:]*:(opacity|visible)/.test(el.getAttribute('class') || '');
  }

  function moving(el) {
    return !!el.getAnimations && el.getAnimations().some(function (a) { return a.playState === 'running' || a.pending; });
  }

  function alpha(color) {
    if (!color || color === 'transparent') return 0;
    var m = /^rgba?\(([^)]+)\)$/.exec(color);
    if (m) { var p = m[1].split(/[\s,\/]+/); return p.length > 3 ? parseFloat(p[3]) : 1; }
    m = /\/\s*([\d.]+%?)\s*\)$/.exec(color);          // oklch(… / a), color(… / a)
    if (!m) return 1;
    return /%$/.test(m[1]) ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  }

  function fillsWindow(el) {
    var r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
  }

  /* the site's bar across the top of the window, left invisible because a script was to reveal it */
  function topBar(el, cs) {
    if (cs.position !== 'fixed' || !el.matches('header, nav, [role="banner"], [role="navigation"]')) return false;
    var r = el.getBoundingClientRect();
    return r.top <= 1 && r.height > 0 && r.height < window.innerHeight / 2 && hasContent(el);
  }

  /* a picture behind a whole screen of the page that a script had not yet faded in when the page was captured */
  function backdrop(el, cs) {
    if (cs.position !== 'absolute' || !/opacity/.test(el.getAttribute('style') || '')) return false;
    if ((el.textContent || '').trim() || !(el.matches(MEDIA) || el.querySelector(MEDIA))) return false;
    var r = el.getBoundingClientRect();
    return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.6;
  }

  /* a line of text a script was to slide into its clipped frame: still parked outside it, so nothing shows */
  function slidOut(el, cs) {
    if (cs.position !== 'static' && cs.position !== 'relative') return false;
    if (!/translate/.test(el.getAttribute('style') || '') || !hasContent(el) || moving(el)) return false;
    var frame = el.parentElement, fs = frame && getComputedStyle(frame);
    if (!fs || !/hidden|clip/.test(fs.overflowX + ' ' + fs.overflowY)) return false;
    var a = el.getBoundingClientRect(), b = frame.getBoundingClientRect();
    return a.top >= b.bottom - 1 || a.bottom <= b.top + 1 || a.left >= b.right - 1 || a.right <= b.left + 1;
  }

  /* An intro curtain caught mid-play: nothing in it to read or look at, opaque, fixed over the whole window
     and above the page. With its script gone it would never lift. */
  function liftCurtains(root) {
    each(root.querySelectorAll('div, span, section, aside'), function (el) {
      if (el.classList.contains('rv-gone')) return;
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.5) return;
      if (alpha(cs.backgroundColor) < 0.9 || !(parseInt(cs.zIndex, 10) > 0) || !fillsWindow(el)) return;
      if ((el.textContent || '').trim() || el.querySelector(MEDIA + ', a, button, input, form')) return;
      el.classList.add('rv-gone');
    });
  }

  function removeBadges(root) {
    each(root.querySelectorAll('#lovable-badge, a[href*="utm_source=lovable-badge"]'), function (el) {
      var badge = el.closest('#lovable-badge') || el;
      if (badge.parentNode) badge.parentNode.removeChild(badge);
    });
  }

  /* ----- behaviour for an imported page ----- */
  function words(text) { return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }

  function bars(root) { return root.querySelectorAll('header, nav'); }

  function inBar(el) { return !!el.closest('header, nav, .rv-menu'); }

  /* the sections a menu can go to: the page's own named blocks, in page order */
  function namedBlocks(root) {
    var out = [];
    each(root.querySelectorAll('section[id], div[id], footer[id], article[id], main[id]'), function (el) {
      if (inBar(el) || /^(top|root|app|__next)$/i.test(el.id) || el.offsetHeight < 80) return;
      if (out.some(function (o) { return o.contains(el); })) return;      // a named block inside a named block
      out.push(el);
    });
    return out;
  }

  function menuButtons(root) {
    var out = [];
    each(root.querySelectorAll('nav button, nav a:not([href]), nav [role="link"]:not([href])'), function (b) {
      if (b.closest('.rv-menu') || b.hasAttribute('aria-expanded') || b.hasAttribute('aria-haspopup')) return;
      if ((b.textContent || '').trim()) out.push(b);
    });
    return out;
  }

  function targetFor(root, btn) {
    if (btn.__rvCopyOf) btn = btn.__rvCopyOf;
    var buttons = menuButtons(root), blocks = namedBlocks(root);
    var i = buttons.indexOf(btn);
    if (i === -1) {                                   // the brand button of the bar: back to the top
      var bar = btn.closest('header');
      if (!bar || btn.closest('nav') || btn.hasAttribute('aria-label') || !(btn.textContent || '').trim()) return null;
      return bar.querySelector('button, a') === btn ? (document.getElementById('top') || root) : null;
    }
    var taken = [], byName = buttons.map(function (b) {
      var w = words(b.textContent), hit = null;
      blocks.forEach(function (bl) {
        var idw = words(bl.id);
        if (!hit && taken.indexOf(bl) === -1 && idw.length && idw.every(function (x) { return w.indexOf(x) !== -1; })) hit = bl;
      });
      if (hit) taken.push(hit);
      return hit;
    });
    if (byName[i]) return byName[i];
    return buttons.length === blocks.length ? blocks[i] : null;
  }

  function barHeight(root) {
    var h = 0;
    each(bars(root), function (b) {
      var cs = getComputedStyle(b);
      if ((cs.position === 'fixed' || cs.position === 'sticky') && cs.display !== 'none') h = Math.max(h, b.getBoundingClientRect().height);
    });
    return h < window.innerHeight / 2 ? h : 0;
  }

  function scrollToBlock(root, el) {
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var top = el === root ? 0 : Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - (el.id === 'top' ? 0 : barHeight(root)));
    window.scrollTo({ top: top, behavior: still ? 'auto' : 'smooth' });
  }

  /* The panel a row's button opens: the one it names (aria-controls) — the nearest element with that id, since
     a captured tab set can hold the same ids once per tab — else the element after it. */
  function panelOf(btn) {
    var id = btn.getAttribute('aria-controls');
    if (id) {
      var sel = '[id="' + id.replace(/["\\]/g, '\\$&') + '"]';
      for (var a = btn.parentElement; a; a = a.parentElement) {
        var p = a.querySelector(sel);
        if (p && p !== btn && !p.contains(btn)) return p;
      }
    }
    var next = btn.nextElementSibling;
    return next && !/^(BUTTON|A)$/.test(next.tagName) ? next : null;
  }

  /* the row: the closest element holding both the button and its panel */
  function rowOf(btn, panel) {
    var r = btn.parentElement;
    while (r && !r.contains(panel)) r = r.parentElement;
    return r;
  }

  var MORE_LESS = /\b(Read|Show|See|View)( |\u00a0)(more|less)\b/i;
  /* "Read more" becomes "Read less" while its panel is open, and back */
  function moreLess(btn, open) {
    var walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT, null), n;
    while ((n = walker.nextNode())) {
      if (!MORE_LESS.test(n.nodeValue)) continue;
      n.nodeValue = n.nodeValue.replace(MORE_LESS, function (all, verb, sp, w) {
        var to = open ? 'less' : 'more';
        return verb + sp + (w.charAt(0) === w.charAt(0).toUpperCase() ? to.charAt(0).toUpperCase() + to.slice(1) : to);
      });
      return;
    }
  }

  function setPanel(p, on) {
    p.removeAttribute('hidden');
    /* a panel its classes keep closed as a grid row of no height (grid-rows-[0fr] opacity-0): opened by giving
       it its full row; closed by handing it back to its classes (which may open it on hover) */
    if (/(^|\s)grid-rows-\[0fr\](\s|$)/.test(p.getAttribute('class') || '')) {
      p.style.gridTemplateRows = on ? '1fr' : '';
      p.style.opacity = on ? '1' : '';
      return;
    }
    p.style.height = on ? 'auto' : '0px';
    p.style.opacity = on ? '1' : '0';
    p.style.overflow = 'hidden';
  }

  /* a button with aria-expanded and the panel it opens; one open at a time among the rows of its list */
  function toggleRow(root, btn) {
    var panel = panelOf(btn);
    if (!panel) return false;
    var row = rowOf(btn, panel), list = row && row.parentElement;
    var rows = [];
    each((list || root).querySelectorAll('button[aria-expanded]'), function (b) {
      var p = b === btn ? panel : panelOf(b), r = p && rowOf(b, p);
      if (r && r.parentElement === list) rows.push({ b: b, p: p });
    });
    if (!rows.some(function (r) { return r.b === btn; })) rows.push({ b: btn, p: panel });
    var turn = null;                                   // the class that turns the open row's sign (+ to ×, chevron down to up)
    rows.forEach(function (r) {
      if (turn || r.b.getAttribute('aria-expanded') !== 'true') return;
      each(r.b.querySelectorAll('[class*="rotate-"]'), function (x) {
        var m = /(?:^|\s)(-?rotate-\[?[\w.]+\]?)(?:\s|$)/.exec(x.getAttribute('class') || '');
        if (m && !turn) turn = m[1];
      });
    });
    if (list) { if (turn) list.__rvTurn = turn; else turn = list.__rvTurn; }
    var open = btn.getAttribute('aria-expanded') !== 'true';
    rows.forEach(function (r) {
      var b = r.b, on = b === btn ? open : false;
      if (b !== btn && b.getAttribute('aria-expanded') !== 'true') return;    // a closed row stays as it is
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
      setPanel(r.p, on);
      moreLess(b, on);
      /* the look the button had open on the original page (data-rv-open-class, lovable-scraper-service) */
      var looks = [b].concat(Array.prototype.slice.call(b.querySelectorAll('[data-rv-open-class], [data-rv-open-text]'))).filter(function (x) {
        return x.hasAttribute('data-rv-open-class') || x.hasAttribute('data-rv-open-text');
      });
      looks.forEach(function (x) {
        if (x.hasAttribute('data-rv-open-class')) {
          if (x.__rvShut === undefined) x.__rvShut = (x.getAttribute('class') || '').split(/\s+/).filter(function (c) { return c && !/^rv-/.test(c); }).join(' ');
          swapClass(x, on ? x.getAttribute('data-rv-open-class') : x.__rvShut);
        }
        if (x.hasAttribute('data-rv-open-text') && !x.children.length) {
          if (x.__rvShutText === undefined) x.__rvShutText = x.textContent;
          x.textContent = on ? x.getAttribute('data-rv-open-text') : x.__rvShutText;
        }
      });
      var sign = b.querySelector('[aria-hidden="true"]:last-child') || b.lastElementChild;
      if (turn && sign && !looks.length) sign.classList.toggle(turn, on);
    });
    return true;
  }

  /* ----- tab sets captured with every tab's panel (lovable-scraper-service): data-rv-tab="<set>:<k>" on each
     tab, data-rv-tabpanel="<set>:<k>" on what tab k shows, data-rv-tab-classes='{"g":"<set>","c":[…]}' on an
     element whose classes change with the tab, data-rv-tab-auto="<ms>" on a set that moves on by itself ----- */
  function tabKey(v) {
    v = String(v || '');
    var i = v.lastIndexOf(':');
    return { g: v.slice(0, i), k: +v.slice(i + 1) };
  }

  /* the classes this script adds (rv-…) are kept when an element takes another tab's classes */
  function swapClass(el, cls) {
    var own = (el.getAttribute('class') || '').split(/\s+/).filter(function (c) { return /^rv-/.test(c); });
    el.setAttribute('class', [String(cls || '')].concat(own).join(' ').trim());
  }

  function tabsOfSet(root, g) {
    var out = [];
    each(root.querySelectorAll('[data-rv-tab]'), function (t) { if (tabKey(t.getAttribute('data-rv-tab')).g === g) out.push(t); });
    return out;
  }

  function selectTab(root, tab, focus) {
    var key = tabKey(tab.getAttribute('data-rv-tab')), g = key.g, k = key.k, idHolder = null, shown = [];
    tabsOfSet(root, g).forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
    });
    each(root.querySelectorAll('[data-rv-tabpanel]'), function (p) {
      var pk = tabKey(p.getAttribute('data-rv-tabpanel'));
      if (pk.g !== g) return;
      if (pk.k === k) { p.removeAttribute('hidden'); shown.push(p); }
      else { p.setAttribute('hidden', ''); if (p.id && !idHolder) idHolder = p; }
    });
    /* the panel the tabs name by id (aria-controls) is the one on show */
    if (idHolder && shown.length === 1 && !shown[0].id && idHolder.id === tab.getAttribute('aria-controls')) {
      shown[0].id = idHolder.id;
      idHolder.removeAttribute('id');
    }
    each(root.querySelectorAll('[data-rv-tab-classes]'), function (el) {
      var spec = null;
      try { spec = JSON.parse(el.getAttribute('data-rv-tab-classes')); } catch (err) { /* not ours */ }
      if (!spec || String(spec.g) !== g || !spec.c || typeof spec.c[k] !== 'string') return;
      swapClass(el, spec.c[k]);
    });
    /* what only some tabs have (the chosen tab's progress bar) */
    each(root.querySelectorAll('[data-rv-tab-only]'), function (el) {
      var spec = null;
      try { spec = JSON.parse(el.getAttribute('data-rv-tab-only')); } catch (err) { /* not ours */ }
      if (!spec || String(spec.g) !== g || !spec.k || !spec.k.indexOf) return;
      if (spec.k.indexOf(k) !== -1) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
    });
    if (focus) tab.focus();
  }

  function stillWanted() { return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

  function tabSets(root) {
    if (editing() || root.__rvTabs) return;
    root.__rvTabs = true;
    var sets = {};
    each(root.querySelectorAll('[data-rv-tab]'), function (t) {
      var g = tabKey(t.getAttribute('data-rv-tab')).g;
      if (!sets[g] || t.getAttribute('aria-selected') === 'true') sets[g] = t;
    });
    Object.keys(sets).forEach(function (g) { selectTab(root, sets[g], false); });
    root.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button || editing()) return;
      var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      var tab = t && t.closest ? t.closest('[data-rv-tab]') : null;
      if (!tab || !root.contains(tab)) return;
      e.preventDefault();
      selectTab(root, tab, false);
      if (tab.__rvRestart) tab.__rvRestart();
    });
    root.addEventListener('keydown', function (e) {
      var tab = e.target && e.target.closest ? e.target.closest('[data-rv-tab]') : null;
      if (!tab || editing()) return;
      var all = tabsOfSet(root, tabKey(tab.getAttribute('data-rv-tab')).g), i = all.indexOf(tab), to = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % all.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + all.length) % all.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = all.length - 1;
      if (to < 0) return;
      e.preventDefault();
      selectTab(root, all[to], true);
      if (all[to].__rvRestart) all[to].__rvRestart();
    });
    /* a set that moved on by itself does so here too: never while the visitor points at it or is in it, while a
       pop-up is open, while the page is not on show, or for visitors who asked for no motion */
    each(root.querySelectorAll('[data-rv-tab-auto]'), function (list) {
      var ms = parseInt(list.getAttribute('data-rv-tab-auto'), 10);
      var first = list.querySelector('[data-rv-tab]');
      if (!(ms >= 2000) || !first || !stillWanted()) return;
      var g = tabKey(first.getAttribute('data-rv-tab')).g;
      var area = list.closest('section, article, [aria-roledescription="carousel"]') || list.parentElement;
      var held = false, timer = null;
      area.addEventListener('mouseenter', function () { held = true; });
      area.addEventListener('mouseleave', function () { held = false; });
      function step() {
        if (held || document.hidden || area.contains(document.activeElement) || document.documentElement.hasAttribute('data-rv-modal') || editing()) return;
        var all = tabsOfSet(root, g), i = -1;
        all.forEach(function (t, j) { if (t.getAttribute('aria-selected') === 'true') i = j; });
        if (all.length > 1) selectTab(root, all[(i + 1) % all.length], false);
      }
      function restart() { clearInterval(timer); timer = setInterval(step, ms); }
      tabsOfSet(root, g).forEach(function (t) { t.__rvRestart = restart; });
      restart();
    });
  }

  /* A summary whose height the page's script measured and wrote on it (style="height:25px", for its text at
     the width it was captured at) and that shows a few lines at most (line-clamp): it takes its own height, or
     its text is cut on a narrower screen. */
  function freeMeasured(root) {
    if (editing()) return;
    each(root.querySelectorAll('[style*="height"][class*="transition-[height]"]'), function (el) {
      if (!/(^|;)\s*height\s*:\s*[\d.]+px/.test(el.getAttribute('style') || '')) return;
      var only = el.children.length === 1 ? el.firstElementChild : null;
      if (only && /(^|\s)line-clamp-\d/.test(only.getAttribute('class') || '')) el.style.height = 'auto';
    });
  }

  /* A button the page's script opened a sign-up form with — no link, nothing else of ours on it — and named
     like one: it opens the event's own form (data-register-cta, rv-forms.js) */
  var SIGNUP = /^(apply( now| to join| here)?|register( now| here)?|request (an |your )?invit(e|ation)|book (now|your (seat|place|spot))|reserve (your )?(seat|place|spot)|express (your )?interest|sign up|enrol+( now)?)\b/i;
  function signUpButtons(root) {
    if (editing()) return;
    each(root.querySelectorAll('button'), function (b) {
      if (b.hasAttribute('aria-expanded') || b.hasAttribute('aria-controls') || b.hasAttribute('aria-haspopup') || b.hasAttribute('role') ||
          b.hasAttribute('data-rv-form') || b.hasAttribute('data-register-cta') || b.getAttribute('type') === 'submit' ||
          b.closest('form, [data-rv-form-root], [data-rv-carousel]')) return;
      var text = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length <= 40 && SIGNUP.test(text)) b.setAttribute('data-register-cta', '');
    });
  }

  function closeMenu(root) {
    each(root.querySelectorAll('.rv-menu'), function (m) {
      var bar = m.parentNode;
      bar.removeChild(m);
      if (bar.__rvSolid) bar.__rvSolid();
    });
  }

  function toggleMenu(root, btn) {
    var bar = btn.closest('header, nav');
    if (!bar) return false;
    if (bar.querySelector('.rv-menu')) { closeMenu(root); return true; }
    var items = menuButtons(root);
    if (!items.length) return false;
    var menu = document.createElement('div');
    menu.className = 'rv-menu';
    items.forEach(function (b) {
      var copy = b.cloneNode(true);
      copy.__rvCopyOf = b;
      menu.appendChild(copy);
    });
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.appendChild(menu);
    bar.classList.add('rv-bar-solid');
    return true;
  }

  function pageBackground(el) {
    for (; el; el = el.parentElement) {
      var bg = getComputedStyle(el).backgroundColor;
      if (alpha(bg) >= 0.9) return bg;
    }
    return '#fff';
  }

  /* a bar with no background of its own gets the page's once the visitor has scrolled */
  function watchBars(root) {
    root.style.setProperty('--rv-bar-bg', pageBackground(root));
    if (editing()) return;
    each(root.querySelectorAll('.rv-bar, .rv-bar-clear'), function (bar) {
      if (bar.__rvSolid) return;
      var clear = alpha(getComputedStyle(bar).backgroundColor) < 0.1;
      bar.__rvSolid = function () {
        bar.classList.toggle('rv-bar-solid', !!bar.querySelector('.rv-menu') || (clear && window.pageYOffset > 24));
      };
      window.addEventListener('scroll', bar.__rvSolid, { passive: true });
      bar.__rvSolid();
    });
  }

  /* The top bar's look once the visitor has scrolled, as the page's script gave it (data-rv-scrolled-class,
     read by lovable-scraper-service with the page scrolled): every element of the bar whose classes changed
     takes them past the first few pixels, and its first classes again at the top. */
  function scrolledBars(root) {
    if (editing() || root.__rvScrolled) return;
    var els = root.querySelectorAll('[data-rv-scrolled-class]');
    if (!els.length) return;
    root.__rvScrolled = true;
    each(els, function (el) {
      el.__rvTopClass = (el.getAttribute('class') || '').split(/\s+/).filter(function (c) { return c && !/^rv-/.test(c); }).join(' ');
    });
    var was = null;
    function sync() {
      var on = window.pageYOffset > 24;
      if (on === was) return;
      was = on;
      each(els, function (el) { swapClass(el, on ? el.getAttribute('data-rv-scrolled-class') : el.__rvTopClass); });
    }
    window.addEventListener('scroll', sync, { passive: true });
    sync();
  }

  /* A top bar on show, fixed over the page with no background of its own, imported before its scrolled look
     was read: it gets the page's background once the visitor has scrolled (rv-bar-clear, watchBars), so its
     links are not drawn over the content. */
  function clearBars(root) {
    if (editing() || root.querySelector('[data-rv-scrolled-class]')) return;
    each(root.querySelectorAll('header, nav, [role="banner"]'), function (h) {
      var top = null;
      for (var el = h; el && el !== root; el = el.parentElement) {
        var p = getComputedStyle(el).position;
        if (p === 'fixed' || p === 'sticky') top = el;
      }
      if (!top || top.classList.contains('rv-bar') || top.classList.contains('rv-bar-clear')) return;
      var cs = getComputedStyle(top), r = top.getBoundingClientRect();
      if (r.top > 1 || !r.height || r.height >= window.innerHeight / 2 || cs.visibility !== 'visible' || cs.opacity === '0' || !hasContent(top)) return;
      if (alpha(cs.backgroundColor) >= 0.1 || alpha(getComputedStyle(h).backgroundColor) >= 0.1) return;
      top.classList.add('rv-bar-clear');
    });
  }

  function behave(root) {
    if (root.__rvBehaves) return;
    root.__rvBehaves = true;
    root.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button || editing()) return;
      var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      var btn = t && t.closest ? t.closest('button, [role="button"], [role="link"], a:not([href])') : null;
      if (!btn || !root.contains(btn)) return;
      if (btn.hasAttribute('aria-expanded')) { if (toggleRow(root, btn)) e.preventDefault(); return; }
      if (inBar(btn) && /menu/i.test(btn.getAttribute('aria-label') || '')) { if (toggleMenu(root, btn)) e.preventDefault(); return; }
      if (!inBar(btn)) return;
      var to = targetFor(root, btn);
      if (!to) return;
      e.preventDefault();
      closeMenu(root);
      scrollToBlock(root, to);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(root); });
  }

  /* Shows what is still invisible in the normal flow. An invisible element that is positioned out of the flow
     is a closed menu or overlay: it and everything in it stay as they are — except the site's top bar and
     a whole-screen backdrop picture (topBar, backdrop above). */
  function showStuck(el, parentHidden) {
    each(el.children, function (c) {
      if (/^(STYLE|SCRIPT|TEMPLATE)$/.test(c.tagName) || c.hasAttribute('hidden') || c.getAttribute('aria-hidden') === 'true') return;
      var cs = getComputedStyle(c);
      if (cs.display === 'none') return;
      var hidden = cs.visibility !== 'visible';
      if (cs.opacity === '0' || (hidden && !parentHidden)) {
        if (cs.position === 'absolute' || cs.position === 'fixed') {
          if (topBar(c, cs)) c.classList.add('rv-bar');
          else if (backdrop(c, cs)) c.classList.add('rv-shown');
          else return;
          hidden = false;
        } else if (hasContent(c) && !shownOnHover(c) && !moving(c)) { c.classList.add('rv-shown'); hidden = false; }
      } else if (slidOut(c, cs)) c.classList.add('rv-shown');
      showStuck(c, hidden);
    });
  }

  function settleImported() {
    var roots = document.querySelectorAll('.rv-imported');
    if (!roots.length) return;
    var st = document.querySelector('style[data-rv-settled]');
    if (!st) {
      st = document.createElement('style');
      st.setAttribute('data-rv-settled', '');
      document.head.appendChild(st);
    }
    var css = settledCss();
    if (st.textContent !== css) st.textContent = css;
    // once the rules above have applied and the page's own entrance animations have started
    setTimeout(function () {
      each(roots, function (root) {
        if (!root.isConnected) return;
        removeBadges(root);
        liftCurtains(root);
        showStuck(root, false);
        scrolledBars(root);
        clearBars(root);
        watchBars(root);
        tabSets(root);
        freeMeasured(root);
        signUpButtons(root);
        behave(root);
      });
    }, 60);
  }

  /* ---------- section links ---------- */
  var KIND_NAMES = {
    speakers: ['speakers'], sessions: ['agenda', 'sessions'], partners: ['partners', 'sponsors'],
    glimpses: ['gallery', 'glimpses'], faq: ['faq', 'faqs'], contact: ['contact', 'contacts', 'contact-us']
  };

  function onPage(el) {
    return !!el && !el.hasAttribute('data-rv-empty') && el.getClientRects().length > 0;
  }

  function firstOnPage(selector) {
    var found = null;
    each(document.querySelectorAll(selector), function (el) { if (!found && onPage(el)) found = el; });
    return found;
  }

  function named(name) {
    var byId = document.getElementById(name);
    if (onPage(byId)) return byId;
    return firstOnPage('[data-rv-section="' + name.replace(/["\\]/g, '\\$&') + '"]');
  }

  function resolveHash(hash) {
    var name = String(hash || '').replace(/^#/, '');
    try { name = decodeURIComponent(name); } catch (err) { /* not encoded: taken as written */ }
    if (!name) return null;
    var el = named(name);
    if (el) return el;
    var kind = null;
    Object.keys(KIND_NAMES).forEach(function (k) { if (KIND_NAMES[k].indexOf(name.toLowerCase()) !== -1) kind = k; });
    if (!kind) return null;
    el = firstOnPage('[data-rv-bound="' + kind + '"], [data-rv-auto="' + kind + '"]');
    KIND_NAMES[kind].forEach(function (other) { if (!el) el = named(other); });
    return el;
  }

  /* how much of the top of the window a bar of the site's own covers, for scroll-margin-top (et-platform.css) */
  function measureTopBar() {
    var h = 0, el = document.elementFromPoint(Math.floor(window.innerWidth / 2), 1);
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      var pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        var r = el.getBoundingClientRect();
        if (r.top <= 1 && r.bottom < window.innerHeight / 2) h = Math.max(h, r.bottom);
      }
    }
    /* the ET event bar floats over the top of the page as soon as the visitor has scrolled */
    if (document.querySelector('.rv-etnav--live')) h = Math.max(h, window.innerWidth > NAV_PHONE_PX ? 72 : 60);
    document.documentElement.style.setProperty('--rv-top-bar', Math.round(h) + 'px');
  }

  function goTo(hash, instant) {
    if (editing()) return false;
    var el = resolveHash(hash);
    if (!el) return false;
    measureTopBar();
    var still = instant || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    return true;
  }

  function ownLink(e) {
    var t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
    var a = t && t.closest ? t.closest('a[href^="#"]') : null;
    /* a button that opens a form (data-register-cta: the default form; data-rv-form: the form it names) is
       rv-forms.js's to handle — it opens the form in a pop-up — never a jump to a part of the page */
    if (!a || a.closest('.rv-imported') || a.hasAttribute('data-register-cta') || a.hasAttribute('data-rv-form')) return null;
    return a.getAttribute('href').length > 1 ? a : null;
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || editing()) return;
    var a = ownLink(e);
    if (!a || !goTo(a.getAttribute('href'))) return;
    e.preventDefault();
    try { history.replaceState(null, '', a.getAttribute('href')); } catch (err) { /* a page without an address of its own */ }
  });

  window.addEventListener('hashchange', function () { goTo(location.hash); });

  /* On arrival the browser has already gone to an element with that id; this covers the names it cannot know
     and, once pictures have set the page's final height, puts the visitor back where the link pointed —
     unless they have started to move about by themselves. */
  function arrive() {
    if (!location.hash || document.querySelector('.rv-imported')) return;
    var touched = false;
    function touch() { touched = true; }
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) { window.addEventListener(type, touch, { passive: true, once: true }); });
    goTo(location.hash, true);
    if (document.readyState !== 'complete') window.addEventListener('load', function () { if (!touched) goTo(location.hash, true); });
  }

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) setGo(e.target, true);
        else if (!e.target.classList.contains('animateOnce')) setGo(e.target, false);
      });
    });
  }

  function register(type, init) {
    registry[type] = init;
    each(document.querySelectorAll('[data-rv-section="' + type + '"]'), initSection);
  }

  function accordion(section, opts) {
    var openClass = opts.openClass || 'active';
    function setOpen(item, open) {
      item.classList.toggle(openClass, open);
      var trigger = opts.trigger && item.querySelector(opts.trigger);
      if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    section.addEventListener('click', function (event) {
      if (editing()) return;
      var item = event.target.closest(opts.item);
      if (!item || !section.contains(item) || (opts.panel && event.target.closest(opts.panel))) return;
      var isOpen = item.classList.contains(openClass);
      each(section.querySelectorAll(opts.item), function (other) { if (other !== item) setOpen(other, false); });
      setOpen(item, !isOpen);
    });
  }

  /* ---------- easing in ---------- */
  var revealWatch = null;

  function easeIn(root) {
    if (editing() || !('IntersectionObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var marked = [];
    if (root && root.nodeType === 1 && root.hasAttribute('data-rv-reveal')) marked.push(root);
    each((root && root.querySelectorAll ? root : document).querySelectorAll('[data-rv-reveal]'), function (el) { marked.push(el); });
    if (!marked.length) return;
    if (!revealWatch) {
      revealWatch = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('rv-in');
          revealWatch.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      document.documentElement.classList.add('rv-motion');
    }
    marked.forEach(function (el) {
      if (el.__rvReveal) return;
      el.__rvReveal = true;
      // marked siblings follow one another
      var nth = 0;
      for (var p = el.previousElementSibling; p && nth < 5; p = p.previousElementSibling) if (p.hasAttribute('data-rv-reveal')) nth++;
      if (nth) el.style.setProperty('--rv-delay', (nth * 90) + 'ms');
      revealWatch.observe(el);
    });
  }

  /* records arriving after the page (speakers, partners…) are eased in like what was there from the start */
  function watchForReveals() {
    if (editing() || !('MutationObserver' in window) || !document.body) return;
    new MutationObserver(function (changes) {
      changes.forEach(function (c) { each(c.addedNodes, function (n) { if (n.nodeType === 1) easeIn(n); }); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- headings that fit ----------
     On an AI-designed site (body.rv-generated) a heading whose longest word is wider than its place — a web
     address set in capitals, a long surname on a speaker's card, on a 360px phone — is set smaller until it fits,
     down to 60% of its size (never under 16px), and only then allowed to break inside the word. Its size comes
     back whenever the window is wide enough again. Only on the live page and the preview: never while editing, so
     a size set here is never saved with the page. */
  var fitTimer = 0;
  var FIT_HEADINGS = '[data-rv-section] h1, [data-rv-section] h2, [data-rv-section] h3, [data-rv-section] h4';
  /* a big numeral of a band of numbers ("300+", "₹50,000 Cr"): fitted the same way, never broken */
  var FIT_NUMERALS = '[data-rv-section] [class*="num"], [data-rv-section] [class*="stat"], [data-rv-section] [class*="count"], [data-rv-section] [class*="figure"], [data-rv-section] [class*="metric"]';
  function fitHeading(h, heading) {
    if (!Object.prototype.hasOwnProperty.call(h, '__rvFitFrom')) h.__rvFitFrom = h.style.fontSize;
    if (h.__rvFitted) { h.style.fontSize = h.__rvFitFrom; h.style.overflowWrap = ''; h.__rvFitted = false; }
    var box = h.parentElement, hs = getComputedStyle(h);
    if (!box || !h.offsetWidth || hs.display === 'inline') return;
    /* a decorative figure placed out of the flow (a large "2026" behind a section) is meant to be cut off */
    if (hs.position === 'absolute' || hs.position === 'fixed' || h.closest('[aria-hidden="true"]')) return;
    var bs = getComputedStyle(box);
    var room = box.clientWidth - (parseFloat(bs.paddingLeft) || 0) - (parseFloat(bs.paddingRight) || 0);
    function over() { return h.scrollWidth > h.clientWidth + 1 || (room > 0 && h.offsetWidth > room + 1); }
    if (!over()) return;
    var size = parseFloat(getComputedStyle(h).fontSize), floor = Math.max(16, size * 0.6);
    h.__rvFitted = true;
    while (over() && size - 1 >= floor) { size -= 1; h.style.fontSize = size + 'px'; }
    if (!over()) return;
    /* smaller type did not help (the box itself is too wide): its own size back; a heading may then break */
    h.style.fontSize = h.__rvFitFrom;
    if (heading) h.style.overflowWrap = 'anywhere';
  }
  function fitHeadings() {
    if (editing() || !document.body || !document.body.classList.contains('rv-generated')) return;
    each(document.querySelectorAll(FIT_HEADINGS), function (h) { fitHeading(h, true); });
    each(document.querySelectorAll(FIT_NUMERALS), function (n) { if (!n.children.length && !/^H[1-6]$/.test(n.tagName)) fitHeading(n, false); });
  }
  function watchHeadings() {
    if (editing() || !document.body || !document.body.classList.contains('rv-generated')) return;
    fitHeadings();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeadings);
    window.addEventListener('load', fitHeadings);
    window.addEventListener('resize', function () { clearTimeout(fitTimer); fitTimer = setTimeout(fitHeadings, 150); });
    /* records filled in after the page (speakers' names) */
    setTimeout(fitHeadings, 1500);
  }

  /* ---------- a section's own script ----------
     What was written under JS in the editor's developer zone is kept in the section as
     <script type="text/plain" data-rv-js>: text, so nothing runs it by accident. On the live page it is run
     here, once, with `section` as the section's element. Never while editing: the editor shows the page as
     it is saved, not as a script left it. A script that throws is reported and leaves the rest alone. */
  function sectionScripts(root) {
    if (editing()) return;
    each((root && root.querySelectorAll ? root : document).querySelectorAll('script[data-rv-js]'), function (holder) {
      if (holder.__rvRan) return;
      holder.__rvRan = true;
      var section = holder.closest('[data-rv-section]') || holder.parentElement;
      try { new Function('section', holder.textContent).call(section, section); }
      catch (err) { console.error('[revamp] section script failed:', section && section.getAttribute && section.getAttribute('data-rv-section'), err); }
    });
  }

  /* ---------- carousels ---------- */
  var CAROUSEL_STEP_MS = 4500;

  /* The rules a carousel needs travel with this script, because an imported page loads no stylesheet of
     ours. In the editor the strip wraps instead of scrolling, so every slide can be seen and edited. */
  var CAROUSEL_CSS = [
    /* a track marked "own" is an imported region that already scrolls its row by its own CSS: left as it is */
    '[data-rv-carousel-track]:not([data-rv-carousel-track="own"]){display:flex;gap:24px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
    '[data-rv-carousel-track]:not([data-rv-carousel-track="own"])::-webkit-scrollbar{display:none}',
    '[data-rv-carousel-track]:not([data-rv-carousel-track="own"]) > *{flex:0 0 auto;scroll-snap-align:start}',
    '.rv-carousel-btn{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:44px;height:44px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;cursor:pointer;background:var(--rv-surface,#fff);color:var(--rv-text,#111);box-shadow:0 4px 16px rgba(0,0,0,.18)}',
    '.rv-carousel-btn[hidden]{display:none}',
    '[data-rv-carousel] button:disabled{opacity:.35;cursor:default}',
    '.rv-carousel-prev{left:8px}',
    '.rv-carousel-next{right:8px}',
    /* wider screens: the buttons stand in a gutter on each side of the row, never over its cards */
    '@media (min-width:641px){[data-rv-carousel]:has(> .rv-carousel-btn:not([hidden])){padding-left:60px;padding-right:60px}' +
      '[data-rv-carousel] > .rv-carousel-prev{left:0}[data-rv-carousel] > .rv-carousel-next{right:0}}',
    /* on a phone the buttons would sit over the photos and names of the cards: they go under the row, side by side */
    '@media (max-width:640px){[data-rv-carousel]:has(> .rv-carousel-btn:not([hidden])){padding-bottom:60px}' +
      '[data-rv-carousel] > .rv-carousel-btn{top:auto;bottom:0;transform:none}' +
      '[data-rv-carousel] > .rv-carousel-prev{left:calc(50% - 52px)}[data-rv-carousel] > .rv-carousel-next{right:calc(50% - 52px)}}',
    'html[data-rv-editing] [data-rv-carousel-track]:not([data-rv-carousel-track="own"]){flex-wrap:wrap!important;overflow:visible!important;height:auto!important}',
    'html[data-rv-editing] [data-rv-carousel] :has(> [data-rv-carousel-track]:not([data-rv-carousel-track="own"])){height:auto!important;overflow:visible!important}'
  ].join('\n');
  function carouselCss() {
    /* a page saved from the editor carries the copy this script wrote then: it is brought up to date, so a
       change to these rules reaches pages saved before it */
    var had = document.querySelector('style[data-rv-carousel-css]');
    if (had) { if (had.textContent !== CAROUSEL_CSS) had.textContent = CAROUSEL_CSS; return; }
    if (!document.head) return;
    var st = document.createElement('style');
    st.setAttribute('data-rv-carousel-css', '');
    st.textContent = CAROUSEL_CSS;
    document.head.appendChild(st);
  }

  /* An imported page's own carousel — a previous and a next button beside a region holding one row of cards —
     moved its cards by script. It becomes one of ours: the row is the track, its buttons are the buttons.
     (lovable-scraper-service marks these when it captures a page, with every card in the row; this covers
     pages imported before it did.) */
  function adoptImportedCarousels(root) {
    each(root.querySelectorAll('.rv-imported button[aria-label]'), function (next) {
      /* not the site's own bar (a section's heading, <header> inside the section, is no bar) */
      var bar = next.closest('header, nav');
      if (!/^next\b/i.test(next.getAttribute('aria-label')) || (bar && !bar.closest('section, article'))) return;
      /* the row is beside the buttons, or a few boxes up from them (buttons in the section's heading) */
      var box = next.parentElement, holder = null;
      for (var up = 0; box && up < 4; box = box.parentElement, up++) {
        if (box.querySelector('[data-rv-carousel-track]')) return;
        holder = box.querySelector('[role="region"], [aria-roledescription="carousel"]');
        if (holder || /^(SECTION|ARTICLE|MAIN|BODY)$/.test(box.tagName)) break;
      }
      if (!holder) return;
      var row = holder && (holder.querySelector('[data-carousel-layer]') || holder.firstElementChild);
      if (!row || row.children.length < 2) return;
      var first = row.firstElementChild.getBoundingClientRect().width;
      if (!first) return;
      if (/auto|scroll/.test(getComputedStyle(holder).overflowX)) {
        holder.setAttribute('data-rv-carousel-track', 'own');  // the region already scrolls its row sideways: it is the track
      } else {
        var gap = parseFloat(getComputedStyle(row).columnGap) || 16;
        each(row.children, function (card) { card.style.flex = '0 0 ' + Math.round(first) + 'px'; card.style.scrollSnapAlign = 'start'; });
        row.style.cssText = 'display:flex;gap:' + gap + 'px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;width:100%';
        row.setAttribute('data-rv-carousel-track', '');
      }
      box.setAttribute('data-rv-carousel', '');
      next.setAttribute('data-rv-carousel-next', '');
      each(box.querySelectorAll('button[aria-label]'), function (b) { if (/^previous\b/i.test(b.getAttribute('aria-label'))) b.setAttribute('data-rv-carousel-prev', ''); });
    });
  }

  function carousel(box) {
    if (box.__rvCarousel || editing()) return;
    var track = box.querySelector('[data-rv-carousel-track]') || box;
    box.__rvCarousel = true;
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';

    function step() {
      var item = track.firstElementChild, row = track;
      /* a track holding one row wider than itself (an imported region that scrolls): a step is one card of it */
      if (item && item.firstElementChild && item.children.length > 1 && item.getBoundingClientRect().width > track.clientWidth + 2) { row = item; item = item.firstElementChild; }
      return item ? item.getBoundingClientRect().width + (parseFloat(getComputedStyle(row).columnGap) || 0) : track.clientWidth;
    }
    function atEnd() { return track.scrollLeft + track.clientWidth >= track.scrollWidth - 2; }
    function go(dir, wrap) {
      if (dir > 0 && atEnd()) { if (wrap) track.scrollTo({ left: 0, behavior: 'smooth' }); return; }
      track.scrollBy({ left: dir * step(), behavior: 'smooth' });
    }
    function button(dir) {
      // the page's own button where it has one
      var own = box.querySelector(dir < 0 ? '[data-rv-carousel-prev]' : '[data-rv-carousel-next]');
      if (own) { own.addEventListener('click', function (e) { e.preventDefault(); go(dir, false); }); return own; }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rv-carousel-btn rv-carousel-' + (dir < 0 ? 'prev' : 'next');
      b.setAttribute('aria-label', dir < 0 ? 'Previous' : 'Next');
      b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7') + '"/></svg>';
      b.addEventListener('click', function () { go(dir, false); });
      box.appendChild(b);
      return b;
    }
    var prev = button(-1), next = button(1);
    /* Whole cards only: a row of equal cards wider than its room is narrowed to the cards that fit in full and
       centred, so no card shows cut in half at the edge (a cut picture or a clipped label reads as broken). */
    function whole() {
      if (track === box || track.getAttribute('data-rv-carousel-track') === 'own') return;
      track.style.maxWidth = ''; track.style.marginLeft = ''; track.style.marginRight = '';
      var kids = track.children, w = kids.length && kids[0].getBoundingClientRect().width;
      if (!w || track.scrollWidth <= track.clientWidth + 2) return;
      for (var i = 1; i < kids.length; i++) if (Math.abs(kids[i].getBoundingClientRect().width - w) > 1) return;
      var cs = getComputedStyle(track), gap = parseFloat(cs.columnGap) || 0;
      var pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      var room = track.clientWidth - pad, n = Math.floor((room + gap) / (w + gap));
      if (n < 1) return;
      track.style.maxWidth = Math.ceil(n * w + (n - 1) * gap + pad) + 'px';
      track.style.marginLeft = 'auto'; track.style.marginRight = 'auto';
      /* cards sized by the row (a phone's "one card and the edge of the next", which says "swipe") keep it */
      if (Math.abs(kids[0].getBoundingClientRect().width - w) > 1) { track.style.maxWidth = ''; track.style.marginLeft = ''; track.style.marginRight = ''; }
    }
    function sync() {
      var fits = track.scrollWidth <= track.clientWidth + 2;
      if (prev.classList.contains('rv-carousel-btn')) prev.hidden = fits;
      if (next.classList.contains('rv-carousel-btn')) next.hidden = fits;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = atEnd();
    }
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', function () { whole(); sync(); });
    if ('MutationObserver' in window) new MutationObserver(function () { whole(); sync(); }).observe(track, { childList: true });   // records arriving
    whole();
    sync();
    window.addEventListener('load', function () { whole(); sync(); });   // pictures that set a card's width

    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (box.getAttribute('data-rv-carousel') === 'auto' && !still) {
      var held = false;
      ['mouseenter', 'focusin', 'touchstart'].forEach(function (t) { box.addEventListener(t, function () { held = true; }, { passive: true }); });
      ['mouseleave', 'focusout'].forEach(function (t) { box.addEventListener(t, function () { held = false; }); });
      setInterval(function () {
        if (held || document.hidden || !box.isConnected || track.scrollWidth <= track.clientWidth + 2) return;
        if (document.documentElement.hasAttribute('data-rv-modal')) return;   // a pop-up is open (rv-popups.js)
        var r = box.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;          // not on screen: nothing to show moving
        go(1, true);
      }, CAROUSEL_STEP_MS);
    }
  }

  function carousels(root) {
    adoptImportedCarousels(root && root.querySelectorAll ? root : document);
    if (document.querySelector('[data-rv-carousel]')) carouselCss();
    if (editing()) return;
    each((root || document).querySelectorAll('[data-rv-carousel]'), carousel);
    if (root && root.matches && root.matches('[data-rv-carousel]')) carousel(root);
  }

  /* ---------- the ET event bar ---------- */
  var NAV_PHONE_PX = 860;              // at and below this width the bar is the phone's (et-nav.js's @media)
  var NAV_FLOAT_MAX = 6;               // links on view in the floating bar, at most; the rest are under "More"
  /* the links that go under "More" first: what a visitor deciding to come needs least */
  var NAV_DROP = [/^#previous-(agenda|sponsors)\b/i, /glimps|gallery|photo/i, /resource|download/i, /faq/i, /about/i,
    /who|audience/i, /theme|topic|discussion|track/i, /partner|sponsor/i, /why|join/i];
  var CHEVRON = '<svg width="10" height="7" viewBox="0 0 10 7" fill="none" aria-hidden="true"><path d="M1 1.5l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function etNav(root) {
    if (root.__rvNav || editing()) return;
    var bar = root.querySelector('.rv-etnav-bar');
    if (!bar) return;
    root.__rvNav = true;
    bar.classList.add('rv-etnav--live');            // on the bar: a section's CSS reaches its root only by the classes it was saved with
    var list = root.querySelector('.rv-etnav-list');
    var burger = root.querySelector('[data-rv-etnav-burger]');
    var floating = false, open = null, queued = false, active = null, targets = [], formItems = [];
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* "More", beside the list */
    var more = null, moreBtn = null, moreList = null;
    if (list) {
      more = document.createElement('div');
      more.className = 'rv-etnav-more';
      more.hidden = true;
      more.innerHTML = '<button type="button" class="rv-etnav-more-btn" aria-expanded="false" aria-haspopup="true">More ' + CHEVRON + '</button><ul class="rv-etnav-more-list" hidden></ul>';
      list.parentNode.insertBefore(more, list.nextSibling);
      moreBtn = more.firstChild; moreList = more.lastChild;
      moreBtn.addEventListener('click', function (e) { e.stopPropagation(); setMore(moreList.hidden); });
      moreList.addEventListener('click', function (e) { if (e.target.closest('a')) setMore(false); });
      document.addEventListener('click', function (e) { if (!more.contains(e.target)) setMore(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !moreList.hidden) { setMore(false); moreBtn.focus(); } });
    }
    function setMore(show) {
      if (!more) return;
      moreList.hidden = !show;
      moreBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
    }

    function items() { return list ? Array.prototype.slice.call(list.children) : []; }
    function linkOf(li) { return li.querySelector('a[href^="#"]'); }
    function hiddenEl(el) { return !el || el.hidden || el.hasAttribute('data-rv-nav-empty') || el.style.display === 'none'; }
    /* the section a link goes to, when it is on the page and shown (rv-data.js hides an empty one, and its links) */
    function targetOf(li) {
      var a = linkOf(li);
      if (!a || a.getAttribute('href').length < 2 || hiddenEl(li) || hiddenEl(a)) return null;
      var el = resolveHash(a.getAttribute('href'));
      return el && !el.hidden && getComputedStyle(el).display !== 'none' ? el : null;
    }
    function rank(li) {
      var a = linkOf(li), key = a ? a.getAttribute('href') + ' ' + a.textContent : '';
      for (var r = 0; r < NAV_DROP.length; r++) if (NAV_DROP[r].test(key)) return r;
      return NAV_DROP.length;
    }

    /* Which links are on view: as many as fit (in the floating bar NAV_FLOAT_MAX at most), the ones that
       matter least going first; the rest are under More. A link to nothing on the page is left out. */
    function layout() {
      queued = false;
      if (!list) return;
      var lis = items();
      lis.forEach(function (li) { li.classList.remove('is-over'); });
      setMore(false);
      more.hidden = true;
      targets = [];
      formItems = [];
      var live = lis.filter(function (li) {
        /* a link the owner pointed at a form (rv-forms.js opens it in a pop-up) goes to no section, and is kept */
        var a = linkOf(li);
        if (a && a.hasAttribute('data-rv-form') && !hiddenEl(li) && !hiddenEl(a)) { formItems.push(li); return true; }
        var el = targetOf(li);
        if (el) targets.push({ href: linkOf(li).getAttribute('href'), el: el, li: li });
        else if (!hiddenEl(li)) li.classList.add('is-over');
        return !!el;
      });
      /* the links in the order of their sections on the page (the owner may have moved a section); links to
         forms after them, in their own order */
      targets.sort(function (a, b) { return a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1; });
      targets.forEach(function (t, i) { t.li.style.order = i; });
      formItems.forEach(function (li, i) { li.style.order = targets.length + i; });
      live = targets.map(function (t) { return t.li; }).concat(formItems);
      var over = [];
      var max = floating ? NAV_FLOAT_MAX : Infinity;
      /* on a phone the row is not shown: its links are in the menu */
      if ((list.offsetWidth || list.offsetHeight) && (list.scrollWidth > list.clientWidth + 1 || live.length > max)) {
        more.hidden = false;
        var room = list.clientWidth, used = 0, keep = [];
        var widths = live.map(function (li) { return li.offsetWidth; });
        live.map(function (li, i) { return { li: li, i: i, r: rank(li) }; })
          .sort(function (a, b) { return b.r - a.r || a.i - b.i; })
          .forEach(function (x) { if (keep.length < max && used + widths[x.i] <= room) { keep.push(x.li); used += widths[x.i]; } });
        over = live.filter(function (li) { return keep.indexOf(li) === -1; });
        over.forEach(function (li) { li.classList.add('is-over'); });
        more.hidden = !over.length;
      }
      moreList.innerHTML = '';
      over.forEach(function (li) {
        var a = linkOf(li), item = document.createElement('li'), copy = document.createElement('a');
        copy.setAttribute('href', a.getAttribute('href'));
        copyFormMarks(a, copy);
        copy.textContent = a.textContent;
        item.appendChild(copy);
        moreList.appendChild(item);
      });
      active = undefined;
      mark();
    }
    /* a copy of a link (More, the phone menu) opens the same form as the link (rv-forms.js reads these) */
    function copyFormMarks(from, to) {
      ['data-rv-form', 'data-register-cta'].forEach(function (k) { if (from.hasAttribute(k)) to.setAttribute(k, from.getAttribute(k)); });
    }
    function relayout() { if (!queued) { queued = true; requestAnimationFrame(layout); } }

    /* the section being read: the last one whose top has come up under the bar */
    function mark() {
      var line = (floating ? bar.getBoundingClientRect().bottom : 0) + Math.min(160, window.innerHeight * 0.3);
      var atEnd = window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 2, best = null;
      targets.forEach(function (t) {
        var top = t.el.getBoundingClientRect().top;
        if (top <= line || (atEnd && top < window.innerHeight)) best = t.href;
      });
      if (best === active) return;
      active = best;
      each(root.querySelectorAll('.rv-etnav-list a[href^="#"], .rv-etnav-more-list a, .rv-etnav-drawer a[href^="#"]'), function (a) {
        a.classList.toggle('is-active', !!best && a.getAttribute('href') === best);
      });
      if (moreBtn) moreBtn.classList.toggle('is-active', !!moreList.querySelector('a.is-active'));
    }

    /* the two states: in the flow at the top, floating once the visitor has scrolled past it. While it floats
       its place in the flow is kept at the height it had (so the page does not jump); back in the flow it takes
       its own height again — measured afresh each time, never a height kept from before a resize or a font */
    function hold(on) {
      if (on) root.style.setProperty('--rv-etnav-h', root.offsetHeight + 'px');
      else root.style.removeProperty('--rv-etnav-h');
    }
    function onScroll() {
      var end = root.getBoundingClientRect().top + window.pageYOffset + root.offsetHeight, y = window.pageYOffset;
      var want = floating ? y > end - 24 : y > end + 24;
      if (want !== floating) {
        if (want) hold(true);
        floating = want;
        bar.classList.toggle('rv-etnav--float', floating);
        if (!floating) hold(false);
        layout();
      } else {
        mark();
      }
    }
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; onScroll(); });
    }, { passive: true });
    window.addEventListener('resize', relayout);
    /* records arriving later (rv-data.js) show or hide sections, and the links to them */
    if ('MutationObserver' in window && document.body) {
      new MutationObserver(function (changes) {
        if (changes.some(function (c) { return !root.contains(c.target) || (list && list.contains(c.target)); })) relayout();
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'data-rv-nav-empty'] });
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    window.addEventListener('load', relayout);

    /* the menu panel: every link and the main action */
    function closeMenu() {
      if (!open) return;
      var was = open;
      open = null;
      was.scrim.remove(); was.panel.remove();
      document.documentElement.style.overflow = was.overflow;
      document.removeEventListener('keydown', was.key);
      if (burger) { burger.setAttribute('aria-expanded', 'false'); if (was.refocus) burger.focus({ preventScroll: true }); }
    }
    function openMenu() {
      if (open) { closeMenu(); return; }
      var scrim = document.createElement('div'), panel = document.createElement('div');
      scrim.className = 'rv-etnav-scrim';
      panel.className = 'rv-etnav-drawer';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Menu');
      var head = document.createElement('div'), close = document.createElement('button');
      head.className = 'rv-etnav-drawer-head';
      var logo = root.querySelector('.rv-etnav-logo img');
      if (logo) head.appendChild(logo.cloneNode(false));
      close.type = 'button'; close.className = 'rv-etnav-close'; close.setAttribute('aria-label', 'Close menu'); close.textContent = '×';
      head.appendChild(close);
      panel.appendChild(head);
      var links = Array.prototype.slice.call(root.querySelectorAll('.rv-etnav-tab')).concat(targets.map(function (t) { return linkOf(t.li); }), formItems.map(linkOf));
      links.forEach(function (a) {
        var copy = document.createElement('a');
        copy.className = 'rv-etnav-drawer-link' + (a.getAttribute('href') === active ? ' is-active' : '');
        copy.setAttribute('href', a.getAttribute('href'));
        copyFormMarks(a, copy);
        if (a.getAttribute('target')) { copy.setAttribute('target', a.getAttribute('target')); copy.setAttribute('rel', 'noopener'); }
        copy.textContent = a.textContent;
        panel.appendChild(copy);
      });
      var cta = bar.querySelector('.rv-etnav-cta');
      if (cta) panel.appendChild(cta.cloneNode(true));
      /* a link closes the panel first, so that the page can scroll to where it goes */
      panel.addEventListener('click', function (e) {
        if (e.target === close) closeMenu();
        else if (e.target.closest('a')) { open.refocus = false; closeMenu(); }
      });
      scrim.addEventListener('click', closeMenu);
      var key = function (e) {
        if (e.key === 'Escape') { closeMenu(); return; }
        if (e.key !== 'Tab') return;
        var stops = panel.querySelectorAll('a[href], button');
        var first = stops[0], last = stops[stops.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      document.addEventListener('keydown', key);
      if (still) { scrim.style.animation = 'none'; panel.style.animation = 'none'; }
      root.appendChild(scrim);
      root.appendChild(panel);
      open = { scrim: scrim, panel: panel, key: key, overflow: document.documentElement.style.overflow, refocus: true };
      document.documentElement.style.overflow = 'hidden';
      if (burger) burger.setAttribute('aria-expanded', 'true');
      close.focus({ preventScroll: true });
    }
    if (burger) burger.addEventListener('click', function (e) { e.preventDefault(); openMenu(); });

    /* the portal's logo in the version drawn for the ground it stands on (a page saved in another theme than
       the one the bar was built for still shows the right one) */
    each(bar.querySelectorAll('img[data-rv-on-light][data-rv-on-dark]'), function (img) {
      var lum = 1;
      for (var e = img; e && e.nodeType === 1; e = e.parentElement) {
        var m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(getComputedStyle(e).backgroundColor || '');
        if (m && (m[4] == null || +m[4] > 0.5)) { lum = (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255; break; }
      }
      var want = img.getAttribute(lum < 0.45 ? 'data-rv-on-dark' : 'data-rv-on-light');
      if (want && img.getAttribute('src') !== want) img.setAttribute('src', want);
    });

    layout();
    onScroll();
  }

  function etNavs(root) {
    if (editing()) return;
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches('[data-rv-etnav]')) etNav(scope);
    each(scope.querySelectorAll('[data-rv-etnav]'), etNav);
  }

  /* A served page loads this file with `defer` (functions/lib/delivery.js): until it arrives a stand-in
     keeps each section's register/widget call as [section type, init]. They are taken over here. */
  var waiting = window.RevampSections && window.RevampSections.q;
  window.RevampSections = {
    register: register,
    widget: function (name, init) {
      var script = document.currentScript;
      var type = script && script.getAttribute('data-rv-script');
      if (type) register(type, init);
      else console.error('[revamp] widget "' + name + '" was loaded without a section to run on.');
    },
    accordion: accordion,
    init: function (el) {
      initSection(el);
      reveal(el);
      sectionScripts(el);
      easeIn(el);
      carousels(el);
      etNavs(el);
      if (el.matches('.rv-imported') || el.querySelector('.rv-imported')) settleImported();
    },
    reveal: reveal,
    editing: editing,
    editorMode: editorMode,
    resolveHash: resolveHash,
    goTo: goTo
  };

  if (waiting && waiting.splice) waiting.splice(0).forEach(function (call) { register(call[0], call[1]); });

  /* This edition's agenda (sessions from the event's records, drawn by rv-data.js) one day at a time, when it has
     more than one day (the owner, 23 Oct 2026: "in case of multiple days' agenda it should be displayed on tab basis
     by day/dates, not one after another"): a row of day tabs — "Day 1" over its date — goes before the list, and
     every session carries its day's panel mark, so the tab sets below show one day. Never while editing, where every
     session stays in reach; the row is the runtime's (data-rv-runtime) and is never saved. */
  function sessionDays() {
    if (editing()) return;
    var lists = [];
    each(document.querySelectorAll('[data-rv-item="sessions"][data-rv-day], [data-rv-repeat-template="sessions"][data-rv-day]'), function (card) {
      if (lists.indexOf(card.parentNode) === -1) lists.push(card.parentNode);
    });
    lists.forEach(function (list, li) {
      var cards = [], days = [], seen = {};
      each(list.children, function (c) { if (c.getAttribute && c.hasAttribute('data-rv-day') && (c.getAttribute('data-rv-item') === 'sessions' || c.getAttribute('data-rv-repeat-template') === 'sessions')) cards.push(c); });
      cards.forEach(function (c) {
        var k = c.getAttribute('data-rv-day') || '';
        if (seen[k] == null) { seen[k] = days.length; days.push({ name: c.getAttribute('data-rv-day-name') || '', date: c.getAttribute('data-rv-day-date') || '' }); }
      });
      if (days.length < 2 || (list.previousElementSibling && list.previousElementSibling.hasAttribute('data-rv-day-tabs'))) return;
      var set = 'session-days-' + li;
      var bar = document.createElement('div');
      bar.setAttribute('data-rv-day-tabs', '');
      bar.setAttribute('data-rv-runtime', '');
      bar.setAttribute('role', 'tablist');
      bar.setAttribute('aria-label', 'Agenda by day');
      bar.className = 'rv-day-tabs';
      days.forEach(function (d, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'rv-day-tab';
        b.setAttribute('role', 'tab');
        b.setAttribute('data-rv-tab', set + ':' + i);
        b.setAttribute('aria-selected', i ? 'false' : 'true');
        var top = document.createElement('span'); top.className = 'rv-day-tab-n'; top.textContent = 'Day ' + (i + 1); b.appendChild(top);
        var sub = d.date || (d.name && !/^day\s*\d+$/i.test(d.name) ? d.name : '');
        if (sub) { var sp = document.createElement('span'); sp.className = 'rv-day-tab-d'; sp.textContent = sub; b.appendChild(sp); }
        bar.appendChild(b);
      });
      cards.forEach(function (c) { c.setAttribute('data-rv-tabpanel', set + ':' + seen[c.getAttribute('data-rv-day') || '']); });
      list.parentNode.insertBefore(bar, list);
    });
    if (lists.length && !document.getElementById('rv-day-tabs-css')) {
      var st = document.createElement('style');
      st.id = 'rv-day-tabs-css';
      st.setAttribute('data-rv-runtime', '');
      /* a section's own CSS (display:grid on its rows) must not keep another day's sessions on show */
      st.textContent = '[data-rv-tabpanel][hidden]{display:none!important}' +
        '.rv-day-tabs{display:flex;justify-content:center;gap:10px;margin:0 auto 24px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:none}' +
        '.rv-day-tabs::-webkit-scrollbar{display:none}' +
        '.rv-day-tab{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:120px;padding:11px 18px;border:1.5px solid color-mix(in srgb,var(--rv-text,#111) 22%,transparent);border-radius:var(--rv-radius,12px);background:var(--rv-surface,#f4f5f7);color:var(--rv-text,#111);font:inherit;cursor:pointer}' +
        '.rv-day-tab:focus-visible{outline:2px solid var(--theme-color,#186bf9);outline-offset:2px}' +
        '.rv-day-tab[aria-selected="true"]{background:var(--rv-theme-fill,var(--theme-color,#186bf9));border-color:var(--rv-theme-fill,var(--theme-color,#186bf9));color:var(--rv-on-theme,#fff)}' +
        '.rv-day-tab-n{font-family:var(--heading-font-family,inherit);font-weight:700;letter-spacing:.04em;text-transform:uppercase}.rv-day-tab-d{font-size:.85em;opacity:.85}' +
        '@media (max-width:820px){.rv-day-tabs{justify-content:flex-start}}';
      document.head.appendChild(st);
    }
  }

  /* Tab sets on a page of our own making (an agenda by day: prev-sections.js, sessionDays) — imported pages start
     theirs in settleImported, so a page that has an imported part is left to it */
  function ownTabs() { if (!document.querySelector('.rv-imported') && document.querySelector('[data-rv-tab]')) tabSets(document); }
  function start() { reveal(); settleImported(); sessionDays(); ownTabs(); carousels(); etNavs(document); easeIn(document); watchForReveals(); sectionScripts(document); watchHeadings(); arrive(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
