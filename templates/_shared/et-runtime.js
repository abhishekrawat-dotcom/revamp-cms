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
  var SHOWN_CSS = '.rv-imported .rv-shown{opacity:1!important;transform:none!important;visibility:visible!important;animation:none!important}';
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

  /* Shows what is still invisible in the normal flow. An invisible element that is positioned out of the flow
     is a closed menu or overlay: it and everything in it stay as they are. */
  function showStuck(el, parentHidden) {
    each(el.children, function (c) {
      if (/^(STYLE|SCRIPT|TEMPLATE)$/.test(c.tagName) || c.hasAttribute('hidden') || c.getAttribute('aria-hidden') === 'true') return;
      var cs = getComputedStyle(c);
      if (cs.display === 'none') return;
      var hidden = cs.visibility !== 'visible';
      if (cs.opacity === '0' || (hidden && !parentHidden)) {
        if (cs.position === 'absolute' || cs.position === 'fixed') return;
        if (hasContent(c) && !shownOnHover(c) && !moving(c)) { c.classList.add('rv-shown'); hidden = false; }
      }
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
    setTimeout(function () { each(roots, function (root) { if (root.isConnected) showStuck(root, false); }); }, 60);
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
