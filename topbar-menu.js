/* ETB2B EventSphere — the top bar's small menus (owner decision 13: a lighter top bar, fewer ways to preview).
   Used by the event console (edit-event.html) and the site editor (custom_editor.html) for Preview's arrow, whose menu
   holds the two other ways to see the site: the live site, and a share link for people without an ET login.

   A button with data-topbar-menu and aria-controls="<menu id>" opens that box under it. Pressing it again, Escape, a
   press or the focus anywhere else, or choosing an item closes it. Opened from the keyboard, the focus goes to the
   menu's first shown item, and Escape gives it back to the button. With data-follows="<id>" the button copies that
   element's hidden and disabled state (Preview's: hidden in the console until its event has loaded, disabled in the
   editor until its canvas has mounted), and its group (the parent) carries .has-more while it shows, so the two
   halves are drawn as one button (edit-event.css .pv-split).

   ES5 on purpose: it loads as a plain script on pages that are not bundled. Its listeners sit on the document, so it
   wires itself wherever it is loaded. window.RevampTopbarMenu = { closeAll() } */
(function () {
  'use strict';
  if (window.RevampTopbarMenu) return;

  function buttons() { return Array.prototype.slice.call(document.querySelectorAll('[data-topbar-menu]')); }
  function boxOf(btn) { return btn ? document.getElementById(btn.getAttribute('aria-controls') || '') : null; }
  function set(btn, box, open) {
    box.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeAll(except) {
    buttons().forEach(function (b) {
      var box = boxOf(b);
      if (box && b !== except && !box.hidden) set(b, box, false);
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    var btn = t ? t.closest('[data-topbar-menu]') : null;
    if (btn) {
      var box = boxOf(btn);
      if (!box || btn.disabled) return;
      closeAll(btn);
      set(btn, box, box.hidden);
      if (!box.hidden && e.detail === 0) {
        var first = box.querySelector('a:not([hidden]), button:not([hidden])');
        if (first) first.focus();
      }
      return;
    }
    /* a press on the menu's own edge keeps it open; an item closes it once it has done its work */
    if (t && t.closest('.ev-menu') && !t.closest('a, button')) return;
    closeAll(null);
  });
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t && t.closest && !t.closest('.ev-menu, [data-topbar-menu]')) closeAll(null);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = null;
    buttons().some(function (b) { var box = boxOf(b); if (box && !box.hidden) { open = b; return true; } return false; });
    if (!open) return;
    set(open, boxOf(open), false);
    open.focus();
  });

  /* data-follows: the arrow shows and wakes up with Preview */
  function follow(btn) {
    var src = document.getElementById(btn.getAttribute('data-follows') || '');
    if (!src || btn.hasAttribute('data-follows-wired')) return;
    btn.setAttribute('data-follows-wired', '');
    function sync() {
      var off = !!src.hidden, dis = !!src.disabled;
      if (btn.hidden !== off) btn.hidden = off;
      if (btn.disabled !== dis) btn.disabled = dis;
      var group = btn.parentNode;
      if (group && group.classList) group.classList.toggle('has-more', !off);
      if (off || dis) { var box = boxOf(btn); if (box && !box.hidden) set(btn, box, false); }
    }
    sync();
    if (typeof window.MutationObserver === 'function') {
      new window.MutationObserver(sync).observe(src, { attributes: true, attributeFilter: ['hidden', 'disabled'] });
    }
  }
  function wireFollows() { buttons().forEach(function (b) { if (b.hasAttribute('data-follows')) follow(b); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireFollows);
  else wireFollows();

  window.RevampTopbarMenu = { closeAll: closeAll };
})();
