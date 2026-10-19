/* The banner video of an event's site — the rules and the markup, in one place for every side that needs them:
   the server (functions/lib/api.js puts the video on a page as it is served; functions/lib/api-hero-video.js
   stores it), the event console and the site editor (hero-video-ui.js: the settings, and the editor canvas's
   still picture with its "Video" badge). The visitor's browser does NOT load this file: it gets the markup
   already written and templates/_shared/rv-hero-video.js, which only starts and stops the video.

   What the owner sets (stored on the event document as `heroVideo`):
     { enabled, url, path, contentType, size, duration, width, height, codec, hasAudio, fastStart,
       posterUrl, posterPath, posterAuto, overlay: { mode: 'auto'|'custom', color: '#rrggbb', opacity: 0–0.9 },
       updatedAt, updatedBy }
   The poster is the still picture of the video: what a phone, a slow connection, a visitor who asked for less
   motion and the first moment of every visit show, and what the page's largest picture is (it loads first).

   Where a site can carry one ("hosts"):
     banner   a real template's ET banner (#banner): the video goes in its .bnr-bg-video layer, the banner's
              picture (img.banner-bg-image) becomes the poster, and its .overlay-lyr takes the overlay colour.
     hero     an AI-designed site's hero (section#hero.hero-root, functions/lib/gen-design.js heroHtml): a layer
              of its own goes in first (poster, video, overlay) and takes the place of the hero's picture and veil.
     none     anything else (an imported design): no place for it, and the console says so.

   API (UMD: require() on the server, window.RevampHeroVideoCore in a browser)
     LIMITS, TYPES
     parseColour(v) -> { r, g, b, a } | null           '#rgb', '#rrggbb', 'rgb(…)', 'rgba(…)'
     hexOf(c) -> '#rrggbb'
     luminance(c) -> 0–1                                 WCAG relative luminance of { r, g, b }
     contrast(a, b) -> ratio                             WCAG, of two { r, g, b }
     minOpacity(colour, ink) -> 0–1 | null               the least overlay opacity that keeps text of `ink`
                                                         ('light' | 'dark') at 4.5:1 over the worst frame a
                                                         video can show under it (white for light text, black
                                                         for dark); null when no opacity of that colour can
     inkFor(tone) -> { r, g, b }                         the text a light / dark hero is set in
     overlayFor(overlay, look) -> { color, opacity, rgba, ink, readable, needed }
                                                         look: { tone: 'light'|'dark', scrim: 'rgba(…)'|'' }
                                                         auto: the site's own scrim colour (or its tone's) at
                                                         the opacity text stays readable at
     clean(raw) -> heroVideo | null                      a stored value as a page may use it, or null
     looksAt(html) -> { host: 'banner'|'hero'|'none', tone, scrim }   from a page's markup
     videoTag(hv, cls) -> '<video …></video>'            lazy: preload="none", the address in data-rv-src
     heroLayer(hv) -> html                               the AI hero's layer
     pageCss(o) -> css                                   o: { host, overlay, tone }
     editorLayer(hv, o) -> html                          the editor canvas's still (never saved)
     editorBadge() -> html                               its "Video background" badge (never saved)
     editorCss(o) -> css */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RevampHeroVideoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MB = 1024 * 1024;
  var LIMITS = {
    maxBytes: 30 * MB,          // refused above this
    maxSeconds: 60,             // refused above this
    adviseBytes: 12 * MB,       // the console suggests a smaller file above this
    adviseSeconds: 20,          // … a shorter loop above this
    adviseWidth: 1920,          // … a narrower picture above this
    maxOpacity: 0.9,
    posterWidth: 1920           // the still taken from the video is at most this wide
  };
  var TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm' };

  var AUTO = {
    dark: { color: '#080a10', opacity: 0.6 },     // light text: the reference ET banner uses black at 0.62
    light: { color: '#ffffff', opacity: 0.72 }    // dark text: a white veil, as the AI hero's own light veil
  };
  var INK = { light: { r: 255, g: 255, b: 255 }, dark: { r: 20, g: 22, b: 27 } };   // #ffffff, #14161b

  /* ---------- colour ---------- */
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  function parseColour(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase(), m;
    if ((m = /^#([0-9a-f]{3})$/.exec(s))) s = '#' + m[1].replace(/./g, function (c) { return c + c; });
    if ((m = /^#([0-9a-f]{6})$/.exec(s))) {
      return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
    }
    if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(s))) {
      var a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return { r: clamp(Math.round(+m[1]), 0, 255), g: clamp(Math.round(+m[2]), 0, 255), b: clamp(Math.round(+m[3]), 0, 255), a: clamp(isNaN(a) ? 1 : a, 0, 1) };
    }
    return null;
  }
  function hexOf(c) {
    function h(n) { var x = clamp(Math.round(n), 0, 255).toString(16); return x.length < 2 ? '0' + x : x; }
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }
  function lum(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function contrast(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /* a browser blends an overlay over what is under it channel by channel, in sRGB */
  function over(c, alpha, under) {
    return { r: c.r * alpha + under.r * (1 - alpha), g: c.g * alpha + under.g * (1 - alpha), b: c.b * alpha + under.b * (1 - alpha) };
  }
  function inkFor(tone) { return tone === 'light' ? INK.dark : INK.light; }
  function minOpacity(colour, ink) {
    var c = typeof colour === 'string' ? parseColour(colour) : colour;
    if (!c) return null;
    var text = ink === 'dark' ? INK.dark : INK.light;
    var worst = ink === 'dark' ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    for (var i = 0; i <= 100; i++) {
      if (contrast(over(c, i / 100, worst), text) >= 4.5) return i / 100;
    }
    return null;
  }
  function rgba(c, a) { return 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + (Math.round(a * 100) / 100) + ')'; }

  /* look: { tone, scrim } — tone 'light' means the hero's text is dark */
  function overlayFor(overlay, look) {
    look = look || {};
    var tone = look.tone === 'light' ? 'light' : 'dark';
    var ink = tone === 'light' ? 'dark' : 'light';
    var o = overlay && typeof overlay === 'object' ? overlay : {};
    var colour, opacity;
    if (o.mode === 'custom' && parseColour(o.color)) {
      colour = parseColour(o.color);
      opacity = clamp(+o.opacity, 0, LIMITS.maxOpacity);
      if (isNaN(opacity)) opacity = AUTO[tone].opacity;
    } else {
      var scrim = parseColour(look.scrim);
      var least = scrim ? minOpacity(scrim, ink) : null;
      /* the template's own scrim is a colour chosen for its banner; it keeps its colour and gets at least the
         opacity a moving picture under it needs (one that cannot get there, or is of the other tone, is not used) */
      if (scrim && least != null && least <= LIMITS.maxOpacity && (lum(scrim) > 0.5) === (tone === 'light')) {
        colour = scrim;
        opacity = Math.max(scrim.a, least, 0.45);
      } else {
        colour = parseColour(AUTO[tone].color);
        opacity = AUTO[tone].opacity;
      }
      opacity = Math.min(opacity, LIMITS.maxOpacity);
    }
    var needed = minOpacity(colour, ink);
    return {
      color: hexOf(colour), opacity: Math.round(opacity * 100) / 100, rgba: rgba(colour, opacity), ink: ink, tone: tone,
      needed: needed, readable: needed != null && opacity + 1e-9 >= needed
    };
  }

  /* ---------- the stored value ---------- */
  var HTTPS = /^https:\/\/[^\s"'<>()\\]+$/i;
  function clean(raw) {
    if (!raw || typeof raw !== 'object' || raw.enabled === false) return null;
    var url = String(raw.url || '').trim(), poster = String(raw.posterUrl || '').trim();
    if (!HTTPS.test(url) || !TYPES[String(raw.contentType || '')]) return null;
    var o = raw.overlay && typeof raw.overlay === 'object' ? raw.overlay : {};
    return {
      url: url, contentType: String(raw.contentType),
      posterUrl: HTTPS.test(poster) ? poster : '',
      width: +raw.width || 0, height: +raw.height || 0,
      overlay: { mode: o.mode === 'custom' ? 'custom' : 'auto', color: parseColour(o.color) ? hexOf(parseColour(o.color)) : '', opacity: +o.opacity },
      stamp: String(raw.updatedAt || '')
    };
  }

  /* ---------- reading a page ---------- */
  function looksAt(html) {
    var s = String(html || '');
    var scrimM = /--rv-banner-scrim\s*:\s*(rgba?\([^)]*\)|#[0-9a-f]{3,6})/i.exec(s);
    var scrim = scrimM ? scrimM[1] : '';
    if (/class\s*=\s*["'][^"']*\bbnr-bg-video\b/i.test(s) || /data-rv-media\s*=\s*["']bg-video["']/i.test(s)) {
      var c = parseColour(scrim);
      return { host: 'banner', tone: c && lum(c) > 0.5 ? 'light' : 'dark', scrim: scrim };
    }
    var hero = /<section\b[^>]*\bclass\s*=\s*["']([^"']*\bhero-root\b[^"']*)["'][^>]*>/i.exec(s) ||
      /<section\b[^>]*\bid\s*=\s*["']hero["'][^>]*>/i.exec(s);
    if (hero) return { host: 'hero', tone: heroTone(s, hero[0]), scrim: '' };
    return { host: 'none', tone: 'dark', scrim: '' };
  }

  /* An AI hero's tone is what its words ARE: an AI edit can restyle them (BWS: dark words on a white veil in a
     hero still classed hero-on-dark), and an overlay of the wrong tone would make them unreadable. In order:
     the colour its own stylesheet gives the headline (else the hero itself), the tone its logo unit was drawn
     for, its hero-on-light / hero-on-dark class. */
  function heroTone(s, openTag) {
    var sheet = /<style\b[^>]*data-rv-style\s*=\s*["']hero["'][^>]*>([\s\S]*?)<\/style>/i.exec(s);
    if (sheet) {
      var found = { tagline: null, root: null }, rule, re = /([^{}]+)\{([^{}]*)\}/g;
      while ((rule = re.exec(sheet[1]))) {
        var decl = /(?:^|;)\s*color\s*:\s*([^;!]+)/i.exec(rule[2]);
        var c = decl && parseColour(decl[1].trim());
        if (!c) continue;
        var sels = rule[1].split(',');
        if (sels.some(function (x) { return /\.hero-tagline\s*$/.test(x); })) found.tagline = c;
        else if (sels.some(function (x) { return /\.hero-root\s*$/.test(x); })) found.root = c;
      }
      var ink = found.tagline || found.root;
      if (ink) return lum(ink) < 0.5 ? 'light' : 'dark';
    }
    var unit = /\brv-lu-on-(light|dark)\b/.exec(s.slice(s.indexOf(openTag), s.indexOf(openTag) + 6000));
    if (unit) return unit[1];
    var cls = /class\s*=\s*["']([^"']*)["']/i.exec(openTag);
    return cls && /\bhero-on-light\b/.test(cls[1]) ? 'light' : 'dark';
  }

  /* ---------- markup ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* Written without a src: nothing is downloaded with the page; rv-hero-video.js sets it when (and only when)
     this visitor will see it play. No sound, ever: muted, and no controls. */
  function videoTag(hv, cls) {
    return '<video class="' + esc(cls || 'rv-hv-video') + '" data-rv-bg-video data-rv-hero-video muted loop playsinline disablepictureinpicture disableremoteplayback' +
      ' preload="none" tabindex="-1" aria-hidden="true"' + (hv.posterUrl ? ' poster="' + esc(hv.posterUrl) + '"' : '') +
      ' data-rv-src="' + esc(hv.url) + '" data-type="' + esc(hv.contentType) + '"></video>';
  }

  function posterImg(hv) {
    if (!hv.posterUrl) return '';
    var size = hv.width > 0 && hv.height > 0 ? ' width="' + Math.round(hv.width) + '" height="' + Math.round(hv.height) + '"' : '';
    return '<img class="rv-hv-poster" src="' + esc(hv.posterUrl) + '" alt=""' + size + ' fetchpriority="high" loading="eager" decoding="async">';
  }

  function heroLayer(hv) {
    return '<div class="rv-hv" data-rv-hero-video aria-hidden="true">' + posterImg(hv) + videoTag(hv) + '<div class="rv-hv-overlay"></div></div>';
  }

  /* The page's rules for the video, its layer and its pause button. o: { host, overlay (overlayFor), poster: bool } */
  function pageCss(o) {
    var ov = o.overlay;
    var css = [
      /* the button that pauses the video (WCAG 2.2.2) — made by rv-hero-video.js once the video plays */
      '.rv-hv-toggle{position:absolute;right:16px;bottom:16px;z-index:5;width:40px;height:40px;padding:0;margin:0;border-radius:50%;' +
        'display:inline-flex;align-items:center;justify-content:center;cursor:pointer;line-height:0;' +
        (ov.ink === 'dark' ? 'background:rgba(255,255,255,.82);color:#14161b;border:1px solid rgba(20,22,27,.35)}' : 'background:rgba(0,0,0,.5);color:#fff;border:1px solid rgba(255,255,255,.55)}'),
      '.rv-hv-toggle:hover{opacity:.9}',
      '.rv-hv-toggle:focus-visible{outline:3px solid ' + (ov.ink === 'dark' ? '#14161b' : '#fff') + ';outline-offset:2px}',
      '.rv-hv-toggle svg{width:16px;height:16px;fill:currentColor}',
      '@media (prefers-reduced-motion:reduce){[data-rv-bg-video]{display:none!important}}'
    ];
    if (o.host === 'banner') {
      css.push('#banner .overlay-lyr{background:' + ov.rgba + '!important}');
      css.push('#banner .bnr-bg-video video.rv-hv-video{transition:opacity .6s ease}');
    } else if (o.host === 'hero') {
      /* the still takes the place of the hero's own picture (without one, that picture stays under the overlay),
         and the overlay the place of its veil */
      if (o.poster) css.push('section[data-rv-hv]{background-image:none!important}');
      css.push('section[data-rv-hv]>.hero-veil{display:none!important}');
      css.push('.rv-hv{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}');
      css.push('.rv-hv>.rv-hv-poster,.rv-hv>.rv-hv-video{position:absolute;top:0;left:0;width:100%!important;height:100%!important;max-width:none!important;object-fit:cover;margin:0;border:0;border-radius:0}');
      css.push('.rv-hv>.rv-hv-video{opacity:0;transition:opacity .6s ease}');
      css.push('.rv-hv>.rv-hv-video.is-playing{opacity:1}');
      css.push('.rv-hv>.rv-hv-overlay{position:absolute;inset:0;background:' + ov.rgba + '}');
      css.push('@media (max-width:767px){.rv-hv>.rv-hv-video{display:none}}');
    }
    return css.join('\n');
  }

  /* ---------- the editor's canvas ----------
     The still picture with a "Video" badge, over the banner, so the owner sees what visitors see first. It is
     the editor's (data-rv-editor: never saved, never published) and never plays while editing. */
  var BADGE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v1.8l3.4-2.2A1 1 0 0 1 21 7v10a1 1 0 0 1-1.6.9L16 15.7v1.8a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 17.5z"/></svg>';
  function editorLayer(hv, o) {
    o = o || {};
    return '<div class="rv-hv rv-hv-editor" data-rv-editor data-rv-hv-preview data-ed="none" aria-hidden="true">' + posterImg(hv) +
      (o.host === 'hero' ? '<div class="rv-hv-overlay"></div>' : '') + '</div>';
  }
  /* the badge sits over the banner's text layer, so it is apart from the still (which is under it) */
  function editorBadge() {
    return '<span class="rv-hv-badge" data-rv-editor data-rv-hv-preview data-ed="none" title="Visitors on a computer see this banner play a video. Set it in Design › Banner video.">' +
      BADGE_ICON + '<span>Video background</span></span>';
  }
  function editorCss(o) {
    var ov = o.overlay;
    var css = [
      '.rv-hv-editor{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}',
      '.rv-hv-editor>.rv-hv-poster{position:absolute;top:0;left:0;width:100%!important;height:100%!important;max-width:none!important;object-fit:cover;margin:0;border:0;border-radius:0}',
      '.rv-hv-editor>.rv-hv-overlay{position:absolute;inset:0;background:' + ov.rgba + '}',
      '.rv-hv-badge{position:absolute;left:14px;bottom:14px;z-index:6;display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;border-radius:999px;' +
        'background:rgba(17,19,24,.82);color:#fff;font:600 12px/1.2 Inter,Arial,sans-serif;letter-spacing:.02em;pointer-events:none}'
    ];
    if (o.host === 'banner') css.push('#banner .overlay-lyr{background:' + ov.rgba + '!important}');
    if (o.host === 'hero') {
      if (o.poster) css.push('section:has(>.rv-hv-editor){background-image:none!important}');
      css.push('section:has(>.rv-hv-editor)>.hero-veil{display:none!important}');
    }
    return css.join('\n');
  }

  return {
    LIMITS: LIMITS, TYPES: TYPES, AUTO: AUTO,
    parseColour: parseColour, hexOf: hexOf, luminance: lum, contrast: contrast, minOpacity: minOpacity, inkFor: inkFor, overlayFor: overlayFor,
    clean: clean, looksAt: looksAt, videoTag: videoTag, heroLayer: heroLayer, pageCss: pageCss, editorLayer: editorLayer, editorBadge: editorBadge, editorCss: editorCss
  };
});
