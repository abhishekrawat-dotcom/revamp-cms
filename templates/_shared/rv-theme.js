/* Themes of an AI-designed site — the same pictures and words in another look: light or dark, and other
   formats (type, corners, palette). Shared by the server (functions/lib/api.js: the site's template, the preview
   page), the editor (the Design panel's Theme chooser) and the preview page's switcher.

   A theme is the page's variables, set on <body>:
     --theme-color --accent-color --rv-bg --rv-surface --rv-text --rv-muted
     --heading-font-family --body-font-family --rv-radius   (+ background-color / color, --default-color, --body-color)
   Every section of a generated site is written in those variables, so a theme reaches the whole page. Colours a
   section wrote as fixed values are turned back into the variable they stand for (themableCss) — a colour that is
   the design's own background becomes var(--rv-bg), its text var(--rv-text) — so they follow too. The hero
   banner keeps its own tone: it is a picture under a veil, and its logo unit is drawn for that tone.

     themesFor(design)            -> [THEME]   'original', its opposite mode, and a third format
     themableCss(css, design)     -> css       fixed colours of the design's palette as its variables
     varsOf(theme)                -> { property: value }   what goes on <body>
     apply(doc, theme)            -> true      sets them on doc.body (and loads its fonts)
     fontUrl(family)              -> the Google Fonts stylesheet for a family

   THEME = { id, label, blurb, mode: 'light'|'dark', colours: { theme, accent, bg, surface, text, muted },
             headingFont, bodyFont, radius } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RevampTheme = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- colour ---------- */
  function hex(v, fallback) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s.slice(1).replace(/./g, function (c) { return c + c; });
    return /^#[0-9a-f]{6}$/.test(s) ? s : fallback;
  }
  function rgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function toHex(c) { return '#' + c.map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(''); }
  function mix(a, b, t) { var p = rgb(a), q = rgb(b); return toHex(p.map(function (v, i) { return v + (q[i] - v) * t; })); }
  function lum(h) {
    return rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /* fg as it is when it reads on bg; else walked towards black or white until it does */
  function readable(fg, bg, min) {
    if (contrast(fg, bg) >= min) return fg;
    var pole = lum(bg) > 0.25 ? '#000000' : '#ffffff';
    for (var t = 0.06; t <= 1.0001; t += 0.06) { var c = mix(fg, pole, t); if (contrast(c, bg) >= min) return c; }
    return pole;
  }

  /* ---------- type ---------- */
  var SERIF = /serif|playfair|merriweather|lora|fraunces|garamond|baskerville|crimson|libre caslon|dm serif|spectral|cormorant|bodoni|georgia/i;
  function stack(family) {
    var f = String(family || '').replace(/["'<>;{}\\]/g, '').trim();
    var fall = SERIF.test(f) && !/sans/i.test(f) ? "Georgia, 'Times New Roman', serif" : 'Arial, Helvetica, sans-serif';
    return f ? "'" + f + "', " + fall : fall;
  }
  function fontUrl(family) {
    var f = String(family || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
    return f ? 'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + ':wght@400;500;600;700;800&display=swap' : '';
  }

  /* ---------- the themes ---------- */
  var DEFAULTS = {
    light: { bg: '#ffffff', surface: '#f4f5f7', text: '#14161b', muted: '#545b66' },
    dark: { bg: '#0c0d11', surface: '#17181f', text: '#f3f4f6', muted: '#a6abb5' }
  };
  function paletteOf(design) {
    var dark = design.mode === 'dark' || (!design.mode && lum(hex(design.backgroundColor, '#ffffff')) < 0.2);
    var d = DEFAULTS[dark ? 'dark' : 'light'];
    return {
      mode: dark ? 'dark' : 'light',
      theme: hex(design.themeColor, '#186bf9'), accent: hex(design.accentColor, hex(design.themeColor, '#186bf9')),
      bg: hex(design.backgroundColor, d.bg), surface: hex(design.surfaceColor, d.surface),
      text: hex(design.textColor, d.text), muted: hex(design.mutedColor, d.muted)
    };
  }
  /* the brand colour where it carries a button or a highlight on bg: 3:1 at least */
  function brandOn(c, bg) { return readable(c, bg, 3); }

  function themesFor(design) {
    design = design || {};
    var o = paletteOf(design);
    var radius = String(design.cornerRadius == null ? '12' : design.cornerRadius).replace(/[^0-9]/g, '') || '12';
    var head = String(design.headingFont || 'Montserrat'), body = String(design.bodyFont || 'Inter');
    var original = {
      id: 'original', label: 'As designed', blurb: (o.mode === 'dark' ? 'Dark' : 'Light') + ' — the colours and type the site was designed with',
      mode: o.mode, colours: { theme: o.theme, accent: o.accent, bg: o.bg, surface: o.surface, text: o.text, muted: o.muted },
      headingFont: head, bodyFont: body, radius: radius
    };
    /* the opposite mode: the same brand, type and shapes on the other ground */
    var inv = o.mode === 'dark' ? 'light' : 'dark', d = DEFAULTS[inv];
    var ibg = inv === 'light' ? mix('#ffffff', o.theme, 0.02) : mix(d.bg, o.theme, 0.05);
    var isurf = inv === 'light' ? mix('#f4f5f7', o.theme, 0.04) : mix(d.surface, o.theme, 0.07);
    var inverse = {
      id: inv, label: inv === 'light' ? 'Light' : 'Dark', blurb: 'The same design on a ' + inv + ' ground',
      mode: inv, colours: { theme: brandOn(o.theme, ibg), accent: brandOn(o.accent, ibg), bg: ibg, surface: isurf, text: d.text, muted: d.muted },
      headingFont: head, bodyFont: body, radius: radius
    };
    /* a third format: a dark site gets an editorial light one (serif headings, square corners, a paper ground);
       a light site a bold one on its own brand colour */
    var third;
    if (o.mode === 'dark') {
      var paper = '#f7f3ec';
      third = {
        id: 'editorial', label: 'Editorial', blurb: 'Light paper, serif headings, square corners',
        mode: 'light', colours: { theme: brandOn(o.theme, paper), accent: brandOn(o.accent, paper), bg: paper, surface: '#efe8dc', text: '#1d1a16', muted: '#5f574d' },
        headingFont: 'Playfair Display', bodyFont: 'Source Sans 3', radius: '0'
      };
    } else {
      /* the ground is the brand colour taken deep, far enough for the brand colour itself to stand out on it as
         a button (its white words were written for that colour) */
      var deep = mix(o.theme, '#05060a', 0.72);
      for (var k = 0.74; k <= 0.96 && (contrast(o.theme, deep) < 2.6 || lum(deep) > 0.05); k += 0.02) deep = mix(o.theme, '#05060a', k);
      var lead = contrast('#ffffff', o.theme) >= 3 ? o.theme : mix(o.theme, '#05060a', 0.3);
      /* a brand colour too dark to stand out on its own deep ground: a lighter tint of it, still dark enough
         for white words */
      for (var u = 0.15; u <= 0.6 && contrast(lead, deep) < 2.6; u += 0.05) {
        var tint = mix(o.theme, '#ffffff', u);
        if (contrast('#ffffff', tint) >= 3) lead = tint;
      }
      third = {
        id: 'brand', label: 'Bold brand', blurb: 'The brand colour as the ground, strong type, sharp corners',
        mode: 'dark', colours: { theme: lead, accent: brandOn(o.accent, deep), bg: deep, surface: mix(deep, '#ffffff', 0.07), text: '#ffffff', muted: readable('#c9cdd6', deep, 4.5) },
        headingFont: SERIF.test(head) ? 'Montserrat' : head, bodyFont: body, radius: '4'
      };
    }
    return [original, inverse, third];
  }

  function varsOf(t) {
    var c = t.colours;
    return {
      '--theme-color': c.theme, '--accent-color': c.accent,
      '--rv-bg': c.bg, '--rv-surface': c.surface, '--rv-text': c.text, '--rv-muted': c.muted,
      '--default-color': c.text, '--body-color': c.text,
      '--heading-font-family': stack(t.headingFont), '--body-font-family': stack(t.bodyFont),
      '--rv-radius': (+t.radius || 0) + 'px',
      'background-color': c.bg, 'color': c.text
    };
  }

  function apply(doc, t) {
    if (!doc || !doc.body || !t) return false;
    var v = varsOf(t);
    Object.keys(v).forEach(function (k) { doc.body.style.setProperty(k, v[k]); });
    doc.body.setAttribute('data-rv-theme', t.id);
    [t.headingFont, t.bodyFont].forEach(function (f) {
      var url = fontUrl(f);
      if (!url || doc.querySelector('link[href="' + url + '"]')) return;
      var l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = url; doc.head.appendChild(l);
    });
    return true;
  }

  /* ---------- fixed colours back to the variables they stand for ---------- */
  var COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+(?:\.\d+)?\s*[, ]\s*\d+(?:\.\d+)?\s*[, ]\s*\d+(?:\.\d+)?\s*(?:[,/]\s*[\d.]+%?\s*)?\)/g;
  function parse(s) {
    var m;
    if ((m = /^#([0-9a-f]{3,8})$/i.exec(s))) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return { hex: '#' + h.slice(0, 6).toLowerCase(), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    }
    if ((m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/i.exec(s))) {
      var a = m[4] == null ? 1 : (m[5] ? +m[4] / 100 : +m[4]);
      return { hex: toHex([+m[1], +m[2], +m[3]]), a: a };
    }
    return null;
  }
  function dist(a, b) { var p = rgb(a), q = rgb(b); return Math.sqrt(Math.pow(p[0] - q[0], 2) + Math.pow(p[1] - q[1], 2) + Math.pow(p[2] - q[2], 2)); }
  /* which variables a colour may become, by what it colours: text never becomes a ground (white words on a
     brand-coloured button are not the page's background), a ground never becomes text */
  var FOR = {
    text: ['text', 'muted', 'theme', 'accent'],
    ground: ['bg', 'surface', 'theme', 'accent'],
    line: ['text', 'muted', 'bg', 'surface', 'theme', 'accent']
  };
  var VAR = { bg: '--rv-bg', surface: '--rv-surface', text: '--rv-text', muted: '--rv-muted', theme: '--theme-color', accent: '--accent-color' };
  function roleOf(prop) {
    prop = prop.toLowerCase();
    if (prop === 'color' || prop === '-webkit-text-fill-color' || prop === 'caret-color') return 'text';
    if (/^background/.test(prop)) return 'ground';
    if (/shadow/.test(prop)) return '';
    return 'line';
  }
  function nearest(hexv, keys, o) {
    var best = null, bestD = 1e9;
    keys.forEach(function (k) { var dd = dist(hexv, o[k]); if (dd < bestD) { bestD = dd; best = k; } });
    return bestD <= 22 ? best : null;
  }
  /* one rule's declarations. A rule whose ground is the brand colour (a button, a badge) keeps the colour of
     its words as written: white words on a red button are not the page's text colour. */
  function swapDecls(decls, o) {
    var brandFill = false;
    decls.replace(/(?:^|;)\s*(background(?:-color)?)\s*:\s*([^;]+)/gi, function (m, prop, value) {
      if (/var\(--(theme|accent)-colou?r\)/i.test(value)) brandFill = true;
      (value.match(COLOUR) || []).forEach(function (lit) { var c = parse(lit); if (c && c.a > 0.6 && /theme|accent/.test(nearest(c.hex, FOR.ground, o) || '')) brandFill = true; });
      return m;
    });
    return decls.replace(/(^|;)(\s*)([a-z-]+)(\s*:\s*)([^;]+)/gi, function (full, sep, sp, prop, colon, value) {
      var role = roleOf(prop);
      if (!role || (role === 'text' && brandFill) || !/#|rgb/i.test(value)) return full;
      var swapped = value.replace(COLOUR, function (lit) {
        var c = parse(lit);
        var k = c && nearest(c.hex, FOR[role], o);
        if (!k) return lit;
        return c.a >= 0.995 ? 'var(' + VAR[k] + ')' : 'color-mix(in srgb, var(' + VAR[k] + ') ' + Math.round(c.a * 1000) / 10 + '%, transparent)';
      });
      return sep + sp + prop + colon + swapped;
    });
  }
  function themableCss(css, design) {
    var o = paletteOf(design || {});
    /* rule by rule (an @media block's rules too: the innermost braces hold the declarations) */
    return String(css || '').replace(/\{([^{}]*)\}/g, function (m, decls) { return '{' + swapDecls(decls, o) + '}'; });
  }

  return { themesFor: themesFor, varsOf: varsOf, apply: apply, themableCss: themableCss, fontUrl: fontUrl, stack: stack, contrast: contrast };
});
