/* Counts one page view of a live event site (TPL-039): POST /api/track, once per page a visitor opens.

   Put on the page only where the live site is served (lib/api.js withVisitCounter, GET /e/<id>): never in the
   preview, a shared preview link, the editor or a review page. It counts here, in the visitor's browser, because
   a live page is kept for a minute by the hosting's CDN and by browsers, so most visits never reach the server.

   What it sends: the event's id, and whether the screen is a phone's or a desktop's. The server adds where the
   visit came from as one of five kinds (direct, search, social, email, other site) from the referring host, and
   keeps only counts: per event, per India day (events/<id>/stats/<day>) and in all (events/<id>.counters). No
   cookie, nothing kept in the browser, no address, no identifier — so no unique visitors either: every page view
   is one view. Robots are not counted (here: an automated browser, a crawler's user agent; the server checks the
   user agent again), nor a page opened in a frame (a preview inside another page), nor a page prerendered and
   never shown. A site with internal pages counts each page changed to in place (rv-pages.js "rv:pagechange").

   Plain ES5, no dependencies; does nothing at all when anything it needs is missing. */
(function () {
  'use strict';
  var w = window, d = document, n = w.navigator || {};
  try {
    var me = d.currentScript;
    var eventId = me && me.getAttribute('data-rv-visit');
    if (!eventId || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(eventId)) return;
    /* the page's own settings say it is the live site, not a shared copy */
    var cfg = d.getElementById('rv-site-config');
    if (cfg) {
      var c = JSON.parse(cfg.textContent || '{}');
      if (c.mode !== 'live' || c.shared === true || (c.eventId && c.eventId !== eventId)) return;
    }
    if (w.top !== w.self) return;                                   // inside a frame: a preview, not a visit
    if (n.webdriver) return;                                        // an automated browser
    if (/bot[\/\-;)_]|\bbot\b|bot$|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|google-inspectiontool/i.test(n.userAgent || '')) return;
  } catch (e) { return; }

  var sent = {};
  function device() {
    var wide = 0;
    try { wide = Math.min(w.screen && w.screen.width || 0, w.innerWidth || 0) || w.innerWidth || 0; } catch (e) { wide = 0; }
    return wide && wide < 768 ? 'mobile' : 'desktop';
  }
  function send(page) {
    if (sent[page]) return;
    sent[page] = true;
    var body = JSON.stringify({ eventId: eventId, device: device(), ref: d.referrer ? String(d.referrer).slice(0, 300) : '' });
    try {
      /* text/plain: a beacon cannot send JSON without asking the server first */
      if (n.sendBeacon && n.sendBeacon('/api/track', new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch (e) { /* the fallback below */ }
    try {
      w.fetch('/api/track', { method: 'POST', body: body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(function () {});
    } catch (e) { /* nothing is counted; the page is not affected */ }
  }
  /* the page shown, as rv-pages.js names it ("home" on a one-page site) */
  function opening() {
    var v = d.documentElement && d.documentElement.getAttribute('data-rv-current-page');
    return v && /^[a-z0-9][a-z0-9-]{0,59}$/.test(v) ? v : 'home';
  }
  function whenShown(fn) {
    if (d.visibilityState !== 'prerender' && d.visibilityState !== 'hidden') return fn();
    /* opened in a background tab, or prerendered: counted when first seen, never if it is not */
    function seen() {
      if (d.visibilityState === 'visible') { d.removeEventListener('visibilitychange', seen); fn(); }
    }
    d.addEventListener('visibilitychange', seen);
  }
  var first = opening();
  whenShown(function () { send(first); });
  /* a site with internal pages changes page in place (rv-pages.js): each page shown is a page view, once */
  d.addEventListener('rv:pagechange', function (e) {
    var page = e && e.detail && typeof e.detail.page === 'string' ? e.detail.page : '';
    if (page) whenShown(function () { send(page); });
  });
})();
