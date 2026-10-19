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
       · a button with aria-expanded opens and closes the panel that follows it, one at a time per list;
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
     RevampSections.editing() to hold back motion of their own (e.g. the banner video). */
(function () {
  'use strict';

  var registry = {};
  var observer = null;

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  function editing() { return document.documentElement.hasAttribute('data-rv-editing'); }

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
    '.rv-imported .rv-bar.rv-bar-solid{background:var(--rv-bar-bg,#fff)!important;box-shadow:0 1px 0 rgba(128,128,128,.25)}',
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

  /* a button with aria-expanded and the panel after it; one open at a time among the rows of its list */
  function toggleRow(root, btn) {
    var panel = btn.nextElementSibling;
    if (!panel || /^(BUTTON|A)$/.test(panel.tagName)) return false;
    var list = btn.parentElement && btn.parentElement.parentElement;
    var rows = [];
    each((list || root).querySelectorAll('button[aria-expanded]'), function (b) {
      if (b.parentElement && b.parentElement.parentElement === list && b.nextElementSibling) rows.push(b);
    });
    var turn = null;                                   // the class that turns the open row's sign (+ to ×, chevron down to up)
    rows.forEach(function (b) {
      if (turn || b.getAttribute('aria-expanded') !== 'true') return;
      each(b.querySelectorAll('[class*="rotate-"]'), function (x) {
        var m = /(?:^|\s)(-?rotate-\[?[\w.]+\]?)(?:\s|$)/.exec(x.getAttribute('class') || '');
        if (m && !turn) turn = m[1];
      });
    });
    if (turn) list.__rvTurn = turn; else turn = list && list.__rvTurn;
    var open = btn.getAttribute('aria-expanded') !== 'true';
    rows.forEach(function (b) {
      var on = b === btn ? open : false, p = b.nextElementSibling;
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
      p.style.height = on ? 'auto' : '0px';
      p.style.opacity = on ? '1' : '0';
      p.style.overflow = 'hidden';
      var sign = b.querySelector('[aria-hidden="true"]:last-child') || b.lastElementChild;
      if (turn && sign) sign.classList.toggle(turn, on);
    });
    return true;
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
    each(root.querySelectorAll('.rv-bar'), function (bar) {
      if (bar.__rvSolid) return;
      var clear = alpha(getComputedStyle(bar).backgroundColor) < 0.1;
      bar.__rvSolid = function () {
        bar.classList.toggle('rv-bar-solid', !!bar.querySelector('.rv-menu') || (clear && window.pageYOffset > 24));
      };
      window.addEventListener('scroll', bar.__rvSolid, { passive: true });
      bar.__rvSolid();
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
        watchBars(root);
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
    if (!a || a.closest('.rv-imported') || a.hasAttribute('data-register-cta')) return null;
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
    '[data-rv-carousel-track]{display:flex;gap:24px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
    '[data-rv-carousel-track]::-webkit-scrollbar{display:none}',
    '[data-rv-carousel-track] > *{flex:0 0 auto;scroll-snap-align:start}',
    '.rv-carousel-btn{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:44px;height:44px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;cursor:pointer;background:var(--rv-surface,#fff);color:var(--rv-text,#111);box-shadow:0 4px 16px rgba(0,0,0,.18)}',
    '.rv-carousel-btn[hidden]{display:none}',
    '[data-rv-carousel] button:disabled{opacity:.35;cursor:default}',
    '.rv-carousel-prev{left:8px}',
    '.rv-carousel-next{right:8px}',
    'html[data-rv-editing] [data-rv-carousel-track]{flex-wrap:wrap!important;overflow:visible!important;height:auto!important}',
    'html[data-rv-editing] [data-rv-carousel] :has(> [data-rv-carousel-track]){height:auto!important;overflow:visible!important}'
  ].join('\n');
  function carouselCss() {
    if (document.querySelector('style[data-rv-carousel-css]') || !document.head) return;
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
      if (!/^next\b/i.test(next.getAttribute('aria-label')) || next.closest('header, nav')) return;
      var box = next.parentElement;
      if (!box || box.querySelector('[data-rv-carousel-track]')) return;
      var holder = box && box.querySelector('[role="region"], [aria-roledescription="carousel"]');
      var row = holder && (holder.querySelector('[data-carousel-layer]') || holder.firstElementChild);
      if (!row || row.children.length < 2) return;
      var first = row.firstElementChild.getBoundingClientRect().width;
      if (!first) return;
      var gap = parseFloat(getComputedStyle(row).columnGap) || 16;
      each(row.children, function (card) { card.style.flex = '0 0 ' + Math.round(first) + 'px'; card.style.scrollSnapAlign = 'start'; });
      row.style.cssText = 'display:flex;gap:' + gap + 'px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;width:100%';
      row.setAttribute('data-rv-carousel-track', '');
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

    function step() { var item = track.firstElementChild; return item ? item.getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 0) : track.clientWidth; }
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
    function sync() {
      var fits = track.scrollWidth <= track.clientWidth + 2;
      if (prev.classList.contains('rv-carousel-btn')) prev.hidden = fits;
      if (next.classList.contains('rv-carousel-btn')) next.hidden = fits;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = atEnd();
    }
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    if ('MutationObserver' in window) new MutationObserver(sync).observe(track, { childList: true });   // records arriving
    sync();

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
    var floating = false, open = null, queued = false, active = null, targets = [];
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
      var live = lis.filter(function (li) {
        var el = targetOf(li);
        if (el) targets.push({ href: linkOf(li).getAttribute('href'), el: el, li: li });
        else if (!hiddenEl(li)) li.classList.add('is-over');
        return !!el;
      });
      /* the links in the order of their sections on the page (the owner may have moved a section) */
      targets.sort(function (a, b) { return a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1; });
      targets.forEach(function (t, i) { t.li.style.order = i; });
      live = targets.map(function (t) { return t.li; });
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
        copy.textContent = a.textContent;
        item.appendChild(copy);
        moreList.appendChild(item);
      });
      active = undefined;
      mark();
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
      var links = Array.prototype.slice.call(root.querySelectorAll('.rv-etnav-tab')).concat(targets.map(function (t) { return linkOf(t.li); }));
      links.forEach(function (a) {
        var copy = document.createElement('a');
        copy.className = 'rv-etnav-drawer-link' + (a.getAttribute('href') === active ? ' is-active' : '');
        copy.setAttribute('href', a.getAttribute('href'));
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
    resolveHash: resolveHash,
    goTo: goTo
  };

  function start() { reveal(); settleImported(); carousels(); etNavs(document); easeIn(document); watchForReveals(); sectionScripts(document); arrive(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
