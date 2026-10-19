/* The banner video on a visitor's page: when it starts, and when it stops. (ES5, no dependencies.)

   The server writes the video into the page already (functions/lib/api.js, applyHeroVideo — the markup is
   rv-hero-video-core.js's): <video data-rv-bg-video muted loop playsinline preload="none" data-rv-src="…">, with no
   src, over the banner's still picture (its poster). This file is the only thing that ever gives it a src.

   Who never downloads it, and sees the still picture:
     - a screen narrower than 768px (a phone): megabytes they would pay for and barely see;
     - a visitor whose browser asks to save data, or whose connection is 2G / 3G or slower;
     - a visitor who asked for less motion (prefers-reduced-motion) — also if they ask while it plays;
     - the editor's canvas (data-rv-editing / data-rv-editor-mode="manual"): nothing moves while editing.
       The editor's "Edit with AI" live view (data-rv-editor-mode="ai") behaves like the page.
     - a browser that cannot play the file's type.
   When: after the page has loaded, plus 3 s (6 s on a low-end device) and an idle moment — never in the way of
   the page's own pictures and scripts — or at once on the visitor's first scroll, click, tap or key.
   Then it fades in over the still when it can play, pauses while the banner is off screen or the tab hidden,
   and has a pause button (WCAG 2.2.2: moving content over 5 s can be stopped). It never makes a sound.
   A video that fails to load is taken away and the still stays.

   Pages also carry videos an AI edit wrote into an AI-designed hero; the server rewrites those the same way
   (data-rv-bg-video, data-rv-src), so they follow the same rules. The address is in data-rv-src, not data-src: the
   ET banner widget saved into template pages (widgets/et-banner/script.js) loads any video[data-src] its own
   way, and one video must have one loader. Such a video has no still picture of its own (data-rv-bg-start=
   "early"): its first frame is the page's largest picture, so where it plays at all it starts at once — started
   seconds later, it would be the page's largest paint seconds later. */
(function () {
  'use strict';
  var doc = document, html = doc.documentElement;
  if (html.hasAttribute('data-rv-editing') || html.getAttribute('data-rv-editor-mode') === 'manual') return;
  var videos = Array.prototype.slice.call(doc.querySelectorAll('video[data-rv-bg-video][data-rv-src]'));
  if (!videos.length) return;

  var mq = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  function slowNetwork() {
    if (!conn) return false;
    if (conn.saveData) return true;
    return /^(slow-2g|2g|3g)$/.test(String(conn.effectiveType || ''));
  }
  function allowed() {
    return mq('(min-width: 768px)') && !mq('(prefers-reduced-motion: reduce)') && !slowNetwork();
  }
  function lowEnd() {
    var cores = navigator.hardwareConcurrency || 0, mem = navigator.deviceMemory || 0;
    return (cores && cores <= 4) || (mem && mem <= 4);
  }

  var PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

  /* the section the video belongs to — where its pause button goes, and what is watched for being on screen */
  function bannerOf(v) {
    var n = v.parentNode;
    while (n && n !== doc.body) {
      if (n.nodeType === 1 && (n.id === 'banner' || n.id === 'hero' || n.hasAttribute('data-rv-section') || /^(SECTION|HEADER)$/.test(n.tagName))) return n;
      n = n.parentNode;
    }
    return v.parentNode;
  }

  function Player(v) {
    this.v = v;
    this.box = bannerOf(v);
    this.started = false;
    this.userPaused = false;
    this.inView = true;
    this.button = null;
  }
  Player.prototype.start = function () {
    var self = this, v = this.v;
    if (this.started) return;
    this.started = true;
    var type = v.getAttribute('data-type') || '';
    if (type && v.canPlayType && !v.canPlayType(type)) { this.drop(); return; }
    v.muted = true;                       // as a property too: an attribute added late does not mute, and an unmuted video may not start
    v.defaultMuted = true;
    v.setAttribute('muted', '');
    v.playsInline = true;
    v.addEventListener('error', function () { self.drop(); });
    v.addEventListener('canplay', function onCan() {
      v.removeEventListener('canplay', onCan);
      self.play();
    });
    v.src = v.getAttribute('data-rv-src');
    v.preload = 'auto';
    try { v.load(); } catch (e) { this.drop(); }
  };
  Player.prototype.play = function () {
    var self = this, v = this.v;
    if (!this.started || this.userPaused || !this.inView || doc.hidden || !allowed()) return;
    var p;
    try { p = v.play(); } catch (e) { return; }
    var shown = function () {
      v.classList.add('is-playing');
      v.classList.add('loaded');           // the ET banner's own fade-in class (et-platform.css)
      self.ensureButton();
    };
    if (p && typeof p.then === 'function') p.then(shown, function () { /* autoplay refused: the still stays */ });
    else shown();
  };
  Player.prototype.pause = function () {
    try { this.v.pause(); } catch (e) { /* not started */ }
  };
  Player.prototype.drop = function () {
    var v = this.v;
    try { v.removeAttribute('src'); v.load(); } catch (e) { /* nothing loaded */ }
    if (v.parentNode) v.parentNode.removeChild(v);
    if (this.button && this.button.parentNode) this.button.parentNode.removeChild(this.button);
  };
  Player.prototype.ensureButton = function () {
    if (this.button || !this.box) return;
    var self = this, b = doc.createElement('button');
    b.type = 'button';
    b.className = 'rv-hv-toggle';
    b.setAttribute('aria-label', 'Pause background video');
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = PAUSE;
    b.addEventListener('click', function () {
      self.userPaused = !self.userPaused;
      b.setAttribute('aria-pressed', self.userPaused ? 'true' : 'false');
      b.setAttribute('aria-label', self.userPaused ? 'Play background video' : 'Pause background video');
      b.innerHTML = self.userPaused ? PLAY : PAUSE;
      if (self.userPaused) self.pause(); else self.play();
    });
    this.box.appendChild(b);
    this.button = b;
  };

  var players = videos.map(function (v) { return new Player(v); });
  var begun = false;
  function begin() {
    if (begun || !allowed()) return;
    begun = true;
    players.forEach(function (p) { p.start(); });
  }

  /* on screen or not */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        players.forEach(function (p) {
          if (p.box !== e.target) return;
          p.inView = e.isIntersecting;
          if (p.inView) p.play(); else p.pause();
        });
      });
    }, { threshold: 0 });
    players.forEach(function (p) { if (p.box) io.observe(p.box); });
  }
  doc.addEventListener('visibilitychange', function () {
    players.forEach(function (p) { if (doc.hidden) p.pause(); else p.play(); });
  });
  /* asked for less motion while it plays: it stops, and stays stopped */
  if (window.matchMedia) {
    var rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    var onMotion = function () { if (rm.matches) players.forEach(function (p) { p.pause(); }); else players.forEach(function (p) { p.play(); }); };
    if (rm.addEventListener) rm.addEventListener('change', onMotion); else if (rm.addListener) rm.addListener(onMotion);
    /* a window widened past a phone's width later: it may start then (the timer below has already run) */
    var wide = window.matchMedia('(min-width: 768px)');
    var onWide = function () { if (wide.matches && timerDone) begin(); else if (!wide.matches) players.forEach(function (p) { p.pause(); }); };
    if (wide.addEventListener) wide.addEventListener('change', onWide); else if (wide.addListener) wide.addListener(onWide);
  }

  var timerDone = false;
  function later() {
    setTimeout(function () {
      var go = function () { timerDone = true; begin(); };
      if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 0);
    }, lowEnd() ? 6000 : 3000);
  }
  if (doc.readyState === 'complete') later(); else window.addEventListener('load', later);
  /* a video without a still of its own (see the top): now */
  if (allowed()) players.forEach(function (p) { if (p.v.getAttribute('data-rv-bg-start') === 'early') p.start(); });

  /* the first sign of a visitor: no need to wait any longer (only when it would play for them at all) */
  /* Only the visitor counts: the page itself scrolling (a marquee of logos, a carousel) or a script's own events
     must not start a download that would compete with the page's first pictures. */
  if (allowed()) {
    var INPUT = ['pointerdown', 'keydown', 'touchstart'];
    var first = function (e) {
      if (e && e.isTrusted === false) return;
      if (e && e.type === 'scroll' && e.target !== doc && e.target !== window) return;
      INPUT.forEach(function (t) { window.removeEventListener(t, first, true); });
      window.removeEventListener('scroll', first, false);
      begin();
    };
    INPUT.forEach(function (t) { window.addEventListener(t, first, { capture: true, passive: true }); });
    window.addEventListener('scroll', first, { passive: true });       // the page's own scrolling, not an element's
  }
})();
