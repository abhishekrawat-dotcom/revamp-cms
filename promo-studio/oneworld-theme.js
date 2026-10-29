/* Light or dark for the mailer studio's page (promo-mailer-studio.html), as Oneworld has it. Loaded in that page's
   head, before its stylesheets, so the first paint is already in the right theme.

   The page is shown in a frame: inside Promotions → Mailers (marketing.html) and inside the team's Mailer
   performance page (mailer-performance.html). Both set data-theme="light" | "dark" on their own <html> (their head
   bootstrap and theme-toggle.js: the stored choice, localStorage revamp-theme, else the system's). This page takes
   the same value, and changes with it when the switch on the page around it is flipped. Opened on its own, it reads
   the same stored choice, else the system's, and follows a switch flipped in another tab. promo-studio/oneworld.css
   holds what each value looks like.

   Only "light" or "dark" is ever set here. The platform's own alternate skin ("Liquid", [data-theme="liquid"] in
   promo-studio/mailer-studio.css) is switched from a top bar this page does not have, so it can never be turned on,
   whatever a visit to the platform once stored. */
(function () {
  'use strict';
  var root = document.documentElement;

  /* the <html> of the Oneworld page this one is framed in; null when not framed (or framed by another origin) */
  function parentRoot() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) return window.parent.document.documentElement;
    } catch (e) { /* another origin's page: it has no say in Oneworld's theme */ }
    return null;
  }
  function known(v) { return v === 'dark' || v === 'light' ? v : ''; }
  function wanted() {
    var p = parentRoot(), t = p ? known(p.getAttribute('data-theme')) : '';
    if (!t) { try { t = known(localStorage.getItem('revamp-theme')); } catch (e) { t = ''; } }
    if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return t;
  }
  function apply() {
    var t = wanted();
    if (root.getAttribute('data-theme') !== t) root.setAttribute('data-theme', t);
  }
  apply();

  var p = parentRoot();
  if (p && window.MutationObserver) {
    /* the page around this one flips its switch: theme-toggle.js sets its data-theme */
    var watch = new MutationObserver(apply);
    watch.observe(p, { attributes: true, attributeFilter: ['data-theme'] });
    /* this page is going away (a reload of the frame): stop watching the page that stays */
    window.addEventListener('pagehide', function () { watch.disconnect(); });
  } else {
    /* opened on its own: a switch flipped in another tab writes revamp-theme */
    window.addEventListener('storage', function (e) { if (!e || e.key === 'revamp-theme' || e.key === null) apply(); });
  }
})();
