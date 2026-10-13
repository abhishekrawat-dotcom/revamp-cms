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
      if (el.matches('.rv-imported') || el.querySelector('.rv-imported')) settleImported();
    },
    reveal: reveal,
    editing: editing,
    resolveHash: resolveHash,
    goTo: goTo
  };

  function start() { reveal(); settleImported(); arrive(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
