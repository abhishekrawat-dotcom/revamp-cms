/* Site-side runtime shared by every ET template. It ships inside exported sites too, so nothing editor-only lives here.

   RevampSections.register(type, init)
     Per-section behaviour. init(sectionEl) runs once for every element carrying data-rv-section="<type>",
     including copies the editor adds later (it calls RevampSections.init(el) on them).

   Scroll reveal
     Stands in for ET's jQuery "CSS3 Animate It" (etb2b-ms-animate.js). When an .animatedParent scrolls into view
     its .animated children get .go — et-animate.css keeps them at opacity 0 until then. Without .animateOnce they
     reset when scrolled away again, as ET's does. ET's delay-1s/delay-2s classes have no CSS behind them, so they
     are ignored here as well.

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

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) setGo(e.target, true);
        else if (!e.target.classList.contains('animateOnce')) setGo(e.target, false);
      });
    });
  }

  window.RevampSections = {
    register: function (type, init) {
      registry[type] = init;
      each(document.querySelectorAll('[data-rv-section="' + type + '"]'), initSection);
    },
    init: function (el) { initSection(el); reveal(el); },
    reveal: reveal,
    editing: editing
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { reveal(); });
  else reveal();
})();
