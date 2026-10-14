/* Promotions — the mailer studio.

   window.RevampPromoMailers = {
     mount(rootEl, ctx)             the studio, inside rootEl. ctx = { eventId, kit, toast }; the kit is the
                                    event's RevampPromo kit (promo-kit.js, already loaded by the page)
     render(doc, kit, opts)  -> string   the e-mail as one HTML document (a pure function of doc + kit)
     check(html)             -> { bytes, issues: [{ level: 'error'|'warn', text }] }   the quality checks
     TYPES, availability(typeId, kit) -> { ok, reason, href }, build(typeId, kit) -> doc
   }

   A mailer is a DOCUMENT the owner edits, not a template filled once:
     { v: 1, type, subject, preheader,
       palette: { theme, accent, background, surface, text, muted },     the site's colours, editable
       sections: [ { id, kind, hidden, props } ],                          the mail, top to bottom
       assets: { '<picture key>': '<public https URL>' } }                pictures already made mail-safe
   Picking a type builds the first version from the kit; from then on only the document counts, so every
   word in the mail is the owner's to change and nothing is filled in behind their back. A section the
   event has no data for is left out of the first version instead of being filled with samples.

   Why the e-mail looks the way it is written:
   - Mail clients are not browsers. Gmail drops <style> in some apps, Outlook on Windows draws with Word:
     so it is tables (role=presentation) with inline styles, no flexbox or grid, one 640 px card that is
     fluid on phones, and a single @media block that only stacks columns.
   - Text stays live text (never baked into a picture), so it is readable with pictures off, by screen
     readers and by spam filters. The site's own fonts are asked for first and web-safe fonts follow.
   - Colours come from the site, but every ink is measured against what it sits on and nudged until it
     reaches WCAG AA — the owner can pick any colour without making the mail unreadable.
   - Mail clients cannot show SVG (and Outlook cannot show WebP), so such pictures are drawn to PNG in the
     browser and uploaded once when the owner downloads or copies; the hero is cropped to a banner the
     same way. Their public URLs are kept in the document so it is not done twice.
   Sending is not part of Revamp yet: the studio says so where Send would be, and hands over the HTML. */
(function () {
  'use strict';

  function P() { return window.RevampPromo; }
  function C() { return window.RevampCore; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function str(v) { return v == null ? '' : String(v); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ================================================================ colour */
  /* The kit's helpers (lum, contrast, mix) are the ones the posts use too, so both read a colour the same way. */
  function lum(c) { return P().lum(c); }
  function contrast(a, b) { return P().contrast(a, b); }
  function mix(a, b, t) { return P().mix(a, b, t); }

  function hexOf(v, fallback) {
    var s = str(v).trim().toLowerCase(), m;
    if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s))) {
      s = '#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + Math.min(255, +x).toString(16)).slice(-2); }).join('');
    }
    if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s.slice(1).replace(/./g, function (c) { return c + c; });
    return /^#[0-9a-f]{6}$/.test(s) ? s : fallback;
  }
  function chroma(c) {
    var n = parseInt(c.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  }
  function worst(c, bgs) { return Math.min.apply(null, bgs.map(function (b) { return contrast(c, b); })); }

  /* `fg` as it is when it already reads on every one of `bgs`; otherwise walked towards black or white
     (the pole the backgrounds need first, then the other) until it does. A colour the owner picked is
     kept as close to their pick as AA allows, never swapped for a stock grey. */
  function fit(fg, bgs, min) {
    if (worst(fg, bgs) >= min) return fg;
    var avg = bgs.reduce(function (s, b) { return s + lum(b); }, 0) / bgs.length;
    var poles = avg > 0.25 ? ['#000000', '#ffffff'] : ['#ffffff', '#000000'];
    for (var p = 0; p < 2; p++) {
      for (var t = 0.08; t <= 1.0001; t += 0.08) {
        var c = mix(fg, poles[p], t);
        if (worst(c, bgs) >= min) return c;
      }
    }
    return worst('#14161b', bgs) >= worst('#ffffff', bgs) ? '#14161b' : '#ffffff';
  }
  /* A fill that text has to sit on (a button, a band). A saturated mid-tone carries neither white nor black
     at AA, so it is darkened or lightened just far enough that one of them does. */
  function carrier(bg, min) {
    min = min || 4.5;
    var cw = contrast('#ffffff', bg);
    /* a strong mid-tone (a brand red or blue) looks like itself with white words on it, and wrong with black
       ones: deepen it a little until white reads, rather than switch the words to black */
    if (cw < min && cw >= 2.6 && chroma(bg) > 0.35) {
      for (var d = 0.03; d <= 0.3001; d += 0.03) { var x = mix(bg, '#000000', d); if (contrast('#ffffff', x) >= min + 0.05) return x; }
    }
    if (Math.max(cw, contrast('#14161b', bg)) >= min) return bg;
    var towards = contrast('#ffffff', bg) >= contrast('#14161b', bg) ? '#000000' : '#ffffff';
    for (var t = 0.04; t <= 1.0001; t += 0.04) {
      var c = mix(bg, towards, t);
      if (Math.max(contrast('#ffffff', c), contrast('#14161b', c)) >= min + 0.1) return c;
    }
    return bg;
  }
  function inkOn(bg) { return fit(P().readableOn(bg), [bg], 4.5); }

  /* Every colour the mail uses, from the document's six. Nothing here is chosen by eye at render time:
     each ink is measured against the surfaces it lands on. */
  function derive(doc, kit) {
    var pal = doc.palette || {}, kc = (kit && kit.brand && kit.brand.colours) || {};
    var bg = hexOf(pal.background, hexOf(kc.background, '#ffffff'));
    var dark = lum(bg) < 0.18;
    var theme = hexOf(pal.theme, hexOf(kc.theme, '#186bf9'));
    var accent = hexOf(pal.accent, theme);
    var surface = hexOf(pal.surface, '');
    /* panels and tiles are the card tinted with the site's own colour, not a grey */
    if (!surface || contrast(surface, bg) < 1.03 || contrast(surface, bg) > 2.2) surface = mix(bg, theme, dark ? 0.14 : 0.06);
    var text = fit(hexOf(pal.text, dark ? '#f3f4f6' : '#1b1d22'), [bg, surface], 4.5);
    var muted = fit(hexOf(pal.muted, mix(text, bg, 0.35)), [bg, surface], 4.5);
    var themeInk = fit(theme, [bg, surface], 4.5);
    /* the accent marks small things (eyebrows, rules). A near-grey accent (the plan's fallback is a navy
       ink) says nothing next to the text, so the theme takes over then */
    var mark = chroma(accent) > 0.22 ? accent : theme;
    var markInk = fit(mark, [bg, surface], 4.5);
    var rule = contrast(mark, bg) >= 1.6 ? mark : themeInk;
    /* the button: the theme when it stands out from the card (3:1 for a control), else the accent */
    var btn = [chroma(accent) > 0.22 ? accent : '', theme].filter(function (c) { return c && contrast(c, bg) >= 3; })[0] || themeInk;
    btn = carrier(btn);
    var band = carrier(contrast(theme, bg) >= 1.25 ? theme : mix(theme, dark ? '#ffffff' : '#000000', 0.25));
    var bandInk = inkOn(band);
    var page = dark ? mix(bg, '#000000', 0.38) : mix(mix(bg, '#000000', 0.045), theme, 0.05);
    /* the footer is set apart from both the card and the panels (a contacts band often sits right above it) */
    var foot = dark ? mix(bg, '#000000', 0.28) : mix(surface, text, 0.06);
    return {
      dark: dark, bg: bg, surface: surface, page: page, theme: theme, accent: accent,
      text: text, muted: muted, line: dark ? mix(surface, theme, 0.22) : mix(bg, text, 0.13), themeInk: themeInk, markInk: markInk, rule: rule,
      btn: btn, btnInk: inkOn(btn),
      band: band, bandInk: bandInk, bandMuted: fit(mix(bandInk, band, 0.22), [band], 4.5),
      bandBtn: bandInk, bandBtnInk: fit(band, [bandInk], 4.5),
      foot: foot, footInk: fit(muted, [foot], 4.5), footStrong: fit(text, [foot], 4.5)
    };
  }

  /* ================================================================ type */
  function cleanFamily(f) { return str(f).replace(/["'<>;\\{}()]/g, '').trim().slice(0, 60); }
  function stackOf(font, dflt) {
    var fam = cleanFamily(font && font.family), stack = str(font && font.stack);
    var serif = stack.replace(/sans-serif/g, '').indexOf('serif') !== -1;
    return (fam ? "'" + fam + "', " : '') + (serif ? "Georgia, 'Times New Roman', serif" : (dflt || 'Arial, Helvetica, sans-serif'));
  }

  /* ================================================================ the e-mail */
  /* ET's house format (the reference mailers): a 750 px card, Verdana and no web fonts, uppercase section
     labels, ET's own legal footer and its sending tool's unsubscribe token. */
  var W = 750, PX = 32, INNER = 686, GAP = 20;
  var HOUSE_FONT = "Verdana, Geneva, 'Helvetica Neue', Helvetica, Arial, sans-serif";
  var ET_RED = '#c8102e';
  var ET_SENDER = '(Times Center), FC - 6, Film City, Sector 16A, Noida - 201301, Uttar Pradesh, India';
  var ESP_UNSUB = '{$$!!unsubscribelink!!$$}';
  function isUnsub(u) { return u === '{{unsubscribe}}' || u === ESP_UNSUB; }

  /* only links a mail can carry; anything else (javascript:, data:, a typo) renders as no link */
  function safeUrl(u) {
    u = str(u).trim();
    if (isUnsub(u)) return u;
    if (/^(https?:\/\/|mailto:|tel:)/i.test(u)) return u.replace(/\s/g, '');
    if (/^www\./i.test(u)) return 'https://' + u;
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(u)) return 'mailto:' + u;
    return '';
  }
  /* **bold** and [label](https://…) in the owner's text; everything else is escaped first */
  function inline(s, linkColour) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^\s)]+)\)/g, function (m, label, url) {
        return '<a href="' + url + '" target="_blank" style="color:' + linkColour + ';text-decoration:underline">' + label + '</a>';
      }).replace(/\n/g, '<br>');
  }
  function font(ctx, o) {
    return 'margin:0;font-family:' + (o.head ? ctx.fh : ctx.fb) + ';font-size:' + o.size + 'px;line-height:' + (o.lh || 1.55) +
      ';font-weight:' + (o.weight || 400) + ';color:' + o.color + ';' +
      (o.caps ? 'text-transform:uppercase;letter-spacing:' + (o.ls || '.14em') + ';' : (o.ls ? 'letter-spacing:' + o.ls + ';' : '')) + (o.extra || '');
  }
  function paras(ctx, text, o) {
    var parts = str(text).replace(/\r/g, '').split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    return parts.map(function (p, i) {
      return '<p style="' + font(ctx, o) + (i < parts.length - 1 ? 'margin-bottom:14px;' : '') + '">' + inline(p, o.link || o.color) + '</p>';
    }).join('');
  }
  function secAttr(ctx) { return ctx.preview && ctx.sec ? ' data-sec="' + esc(ctx.sec) + '"' : ''; }
  function row(ctx, inner, o) {
    o = o || {};
    var px = o.px == null ? PX : o.px;
    var cls = o.cls || (px === PX ? 'px' : '');
    return '<tr' + secAttr(ctx) + '><td' + (cls ? ' class="' + cls + '"' : '') + (o.align ? ' align="' + o.align + '"' : '') +
      (o.bg ? ' bgcolor="' + o.bg + '"' : '') + ' style="padding:' + (o.pt || 0) + 'px ' + px + 'px ' + (o.pb || 0) + 'px;' +
      (o.bg ? 'background-color:' + o.bg + ';' : '') + (o.align ? 'text-align:' + o.align + ';' : '') + '">' + inner + '</td></tr>';
  }
  /* A button: the mail's button colour (or the one given), corners as the mail sets them (0 square, 8 the
     house default, 99 a pill — Outlook on Windows squares them all), and a label colour that is DERIVED,
     never chosen: whatever the fill, the words on it reach AA. */
  function button(ctx, label, url, o) {
    label = str(label).trim();
    if (!label) return '';
    o = o || {};
    var bg = o.bg || ctx.btn, ink = o.ink || inkOn(bg);
    var href = safeUrl(url) || '#', centre = o.align === 'center', r = ctx.btnRadius;
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0"' + (centre ? ' align="center" style="margin:0 auto"' : '') + '><tr>' +
      '<td align="center" bgcolor="' + bg + '" style="border-radius:' + r + 'px;background-color:' + bg + '">' +
      '<a href="' + esc(href) + '" target="_blank" style="display:inline-block;padding:15px 34px;font-family:' + ctx.fb +
      ';font-size:14px;line-height:1.2;font-weight:700;letter-spacing:.02em;white-space:nowrap;color:' + ink + ';text-decoration:none;border-radius:' + r + 'px">' +
      esc(label) + '</a></td></tr></table>';
  }
  /* A section label as the house sends set it: a short accent rule, then the label in spaced capitals
     (OVERVIEW / DISCUSSION TOPICS / PARTNERS), centred — or as written, when the mail says so. */
  function heading(ctx, text, o) {
    o = o || {};
    text = str(text).trim();
    if (!text) return '';
    var left = o.align === 'left', caps = ctx.doc.headings !== 'title';
    var rule = o.rule || ctx.p.rule;
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0"' + (left ? '' : ' align="center" style="margin:0 auto"') + '><tr>' +
      '<td width="36" height="3" bgcolor="' + rule + '" style="width:36px;height:3px;font-size:0;line-height:0;background-color:' + rule + '">&nbsp;</td></tr></table>' +
      '<h2 class="h2" style="' + font(ctx, { head: true, size: caps ? 15 : 22, lh: 1.35, weight: 700, color: o.color || ctx.p.text, caps: caps, ls: caps ? '.16em' : '', extra: 'padding:12px 0 ' + (o.gap == null ? 18 : o.gap) + 'px;' + (left ? '' : 'text-align:center;') }) + '">' + esc(text) + '</h2>';
  }
  /* How many across: up to `max` on a row; else the widest that divides the count exactly (from max down to
     3), else the widest whose last row is at least half full — 9 -> 3/3/3, 10 -> 4/4/2, 17 -> 3s then 2. */
  function balancedCols(n, max) {
    max = max || 4;
    if (n <= max) return Math.max(1, n);
    for (var c = max; c >= 3; c--) if (n % c === 0) return c;
    for (var d = max; d >= 2; d--) if (n % d >= d / 2) return d;
    return max;
  }
  /* tiles that flow: N across on a desktop, two (or one) across on a phone, every row centred (a short last
     row reads as meant). `cap` keeps a tile from stretching when there are few. Outlook ignores inline-block,
     so a ghost table gives it the same columns. */
  function grid(items, cols, cell, mob, cap) {
    var total = INNER + GAP, w = Math.floor(total / cols);
    if (cap) w = Math.min(w, cap + GAP);
    var inner = w - GAP;
    var cells = items.map(function (it, i) {
      var brk = i > 0 && i % cols === 0 ? '<!--[if mso]></tr></table><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><![endif]-->' : '';
      return brk + '<!--[if mso]><td width="' + w + '" valign="top"><![endif]-->' +
        '<div class="' + (mob || 'g2') + '" style="display:inline-block;width:' + w + 'px;max-width:' + w + 'px;vertical-align:top;box-sizing:border-box;padding:0 ' + (GAP / 2) + 'px ' + GAP + 'px;font-size:16px;line-height:1.4;text-align:left">' +
        cell(it, inner, i) + '</div><!--[if mso]></td><![endif]-->';
    }).join('');
    /* the row is exactly as wide as its columns, so the tiles wrap where the balancing put the break */
    return '<!--[if mso]><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><![endif]-->' +
      '<div style="font-size:0;line-height:0;text-align:center"><div class="gw" style="display:inline-block;width:100%;max-width:' + (w * cols) + 'px;vertical-align:top">' + cells + '</div></div><!--[if mso]></tr></table><![endif]-->';
  }
  /* Equal-height tiles: every caption in a grid is as tall as the longest one there, so a row stays level
     (percent heights do not work in table cells). Lines are estimated from the text and the tile's width. */
  function linesOf(text, size, width) {
    var t = str(text).trim();
    if (!t) return 0;
    return Math.max(1, Math.ceil(t.length * size * 0.6 / Math.max(40, width)));
  }
  function img(ctx, src, alt, width, style) {
    return '<img src="' + esc(src) + '" alt="' + esc(str(alt).trim() || ctx.name) + '" width="' + Math.round(width) + '" style="display:block;border:0;outline:none;text-decoration:none;' + (style || '') + '">';
  }
  function initials(name) {
    return str(name).split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || '·';
  }
  function filled(items, keys) {
    return (items || []).filter(function (it) { return it && keys.some(function (k) { return str(it[k]).trim(); }); });
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* where a picture is shown from: its mail-safe copy once made, the preview's own copy while editing,
     or the picture itself */
  function srcFor(ctx, job) {
    if (!job) return '';
    return (ctx.doc.assets && ctx.doc.assets[job.key]) || (ctx.preview && ctx.pv && ctx.pv[job.key]) || job.src;
  }

  /* ---- the sections ---- */
  var RENDER = {};

  function headerBand(ctx, pr, tone) {
    var p = ctx.p;
    if (pr.band === 'theme') return carrier(p.theme);
    if (pr.band === 'background') return p.bg;
    if (pr.band === 'white') return '#ffffff';
    if (pr.band === 'black') return '#0d0f14';
    /* auto: the logo's own background when it has one (a lock-up drawn on a plate would otherwise sit on
       the band as a box of a slightly different colour); else the theme colour when the lock-up was drawn
       for that tone, else the nearest band that is */
    if (pr.mode !== 'text' && hexOf(pr.logoBg, '') && pr.logoBgOf === pr.logo) return hexOf(pr.logoBg, '');
    if (tone === 'dark') return lum(p.theme) < 0.12 ? p.theme : (p.dark ? p.bg : mix(p.theme, '#0b0d12', 0.78));
    if (tone === 'light') return lum(p.theme) > 0.6 ? p.theme : (!p.dark ? p.bg : '#ffffff');
    return carrier(p.theme);
  }
  RENDER.header = function (ctx, s) {
    var pr = s.props, p = ctx.p, job = ctx.jobs[s.id + ':logo'];
    if (pr.layout === 'bar') {
      var mark = job ? '<a href="' + esc(safeUrl(ctx.siteUrl) || '#') + '" target="_blank" style="text-decoration:none">' +
        img(ctx, srcFor(ctx, job), pr.logoAlt || ctx.name, job.w, 'width:auto;max-width:' + job.w + 'px;max-height:52px;height:auto') + '</a>'
        : '<p style="' + font(ctx, { head: true, size: 17, lh: 1.3, weight: 700, color: p.text }) + '">' + esc([pr.before, pr.keyword, pr.after].filter(Boolean).join(' ') || ctx.name) + '</p>';
      var tag = str(pr.note).trim() ? '<p style="' + font(ctx, { size: 13, lh: 1.3, weight: 700, color: p.markInk, extra: 'text-align:right;' }) + '">' + esc(pr.note) + '</p>' : '';
      return row(ctx, '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left" valign="middle">' + mark + '</td>' +
        (tag ? '<td align="right" valign="middle" style="padding-left:12px">' + tag + '</td>' : '') + '</tr></table>', { pt: 20, pb: 18 });
    }
    var useLogo = pr.mode !== 'text' && job;
    var bg = useLogo ? headerBand(ctx, pr, pr.tone || (p.dark ? 'dark' : 'light')) : headerBand(ctx, { band: pr.band === 'auto' ? 'theme' : pr.band }, '');
    var ink = inkOn(bg), out;
    if (useLogo) {
      out = '<a href="' + esc(safeUrl(ctx.siteUrl) || '#') + '" target="_blank" style="text-decoration:none">' +
        img(ctx, srcFor(ctx, job), ctx.name, job.w, 'margin:0 auto;width:' + job.w + 'px;max-width:100%;height:auto') + '</a>';
    } else {
      /* the key word stands out from the rest of the name: the accent when it shows on the band, else the
         mail's own background or text colour, else simply the name's colour */
      var key = [p.accent, p.bg, p.text].filter(function (c) { return contrast(c, bg) >= 3 && contrast(c, ink) >= 1.6; })[0] || ink;
      out = '<p class="h1" style="' + font(ctx, { head: true, size: 30, lh: 1.15, weight: 800, color: ink, extra: 'text-align:center;' }) + '">' +
        esc(pr.before) + (pr.keyword ? (pr.before ? ' ' : '') + '<span style="color:' + key + '">' + esc(pr.keyword) + '</span>' : '') + (pr.after ? ' ' + esc(pr.after) : '') + '</p>';
    }
    if (str(pr.note).trim()) out += '<p style="' + font(ctx, { size: 12, weight: 700, color: fit(mix(ink, bg, 0.2), [bg], 4.5), caps: true, ls: '.16em', extra: 'text-align:center;padding-top:14px;' }) + '">' + esc(pr.note) + '</p>';
    var r = row(ctx, out, { bg: bg, pt: 30, pb: 30, align: 'center' });
    var line = [chroma(p.accent) > 0.22 ? p.accent : '', p.theme].filter(function (c) { return c && contrast(c, bg) >= 1.5 && contrast(c, p.bg) >= 1.2; })[0];
    if (line && !pr.noLine) r += '<tr' + secAttr(ctx) + '><td height="4" bgcolor="' + line + '" style="height:4px;font-size:0;line-height:0;background-color:' + line + '">&nbsp;</td></tr>';
    return r;
  };

  function metaLine(ctx, pr, ink, sepInk) {
    var parts = [str(pr.date).trim(), str(pr.place).trim()].filter(Boolean);
    if (!parts.length) return '';
    return '<p style="' + font(ctx, { size: 17, lh: 1.5, weight: 700, color: ink, extra: 'padding-top:12px;' }) + '">' +
      parts.map(function (x) { return '<span class="mb">' + esc(x) + '</span>'; }).join('<span class="hm" style="color:' + sepInk + ';font-weight:400"> &nbsp;|&nbsp; </span>') + '</p>';
  }
  /* The hero. "strip" is the house layout: the event's banner, linked to the site, then one strip of three —
     the event, the button, the date and the city (stacked on a phone). "centred": a title block under the
     picture. "banner": the picture alone, and the button under it. */
  RENDER.hero = function (ctx, s) {
    var pr = s.props, p = ctx.p, job = ctx.jobs[s.id + ':image'], out = '', lay = pr.layout || 'centred';
    var align = pr.align === 'left' ? 'left' : 'center';
    if (job) {
      var pic = img(ctx, srcFor(ctx, job), pr.alt || ctx.name, W, 'width:100%;max-width:' + W + 'px;height:auto');
      var site = safeUrl(ctx.siteUrl);
      if (site) pic = '<a href="' + esc(site) + '" target="_blank" style="text-decoration:none">' + pic + '</a>';
      out += '<tr' + secAttr(ctx) + '><td style="padding:0;font-size:0;line-height:0">' + pic + '</td></tr>';
    }
    if (lay === 'title') {
      var g1 = mix(p.theme, '#0b0d12', 0.84), g2 = mix(p.theme, '#0b0d12', 0.6);
      var tInk = fit('#ffffff', [g1, g2], 4.5), tSoft = fit(mix('#ffffff', g1, 0.12), [g1, g2], 4.5);
      var when = fit(chroma(p.accent) > 0.22 ? p.accent : mix(p.theme, '#ffffff', 0.45), [g1, g2], 4.5);
      var t = (str(pr.eyebrow).trim() ? '<p style="' + font(ctx, { size: 11, weight: 700, color: tSoft, caps: true, ls: '.14em', extra: 'padding-bottom:10px;' }) + '">' + esc(pr.eyebrow) + '</p>' : '') +
        '<h1 class="h1" style="' + font(ctx, { head: true, size: 30, lh: 1.16, weight: 800, color: tInk, ls: '-.015em' }) + '">' + esc(str(pr.title).trim() || ctx.name) + '</h1>' +
        (str(pr.text).trim() ? '<p style="' + font(ctx, { size: 15, lh: 1.5, weight: 400, color: tSoft, extra: 'padding-top:12px;' }) + '">' + inline(pr.text, tInk) + '</p>' : '') +
        ([pr.date, pr.place].filter(function (x) { return str(x).trim(); }).length ? '<p style="' + font(ctx, { size: 13.5, lh: 1.5, weight: 700, color: when, extra: 'padding-top:18px;' }) + '">' + [pr.date, pr.place].filter(function (x) { return str(x).trim(); }).map(esc).join(' &nbsp;&bull;&nbsp; ') + '</p>' : '');
      var tb = button(ctx, pr.ctaLabel, pr.ctaUrl, { align: 'left' });
      if (tb) t += '<div style="padding-top:22px">' + tb + '</div>';
      out += '<tr' + secAttr(ctx) + '><td class="px" bgcolor="' + g1 + '" style="padding:30px ' + PX + 'px 28px;background-color:' + g1 + ';background-image:linear-gradient(140deg,' + g1 + ' 0%,' + g2 + ' 100%)">' + t + '</td></tr>';
      return out;
    }
    if (lay === 'strip') {
      var name = str(pr.title).trim() || ctx.name;
      var left = (str(pr.eyebrow).trim() ? '<p style="' + font(ctx, { size: 11, weight: 700, color: p.markInk, caps: true, ls: '.14em', extra: 'padding-bottom:4px;' }) + '">' + esc(pr.eyebrow) + '</p>' : '') +
        '<p class="h3" style="' + font(ctx, { head: true, size: 18, lh: 1.3, weight: 700, color: p.text }) + '">' + esc(name) + '</p>';
      var b = button(ctx, pr.ctaLabel, pr.ctaUrl, { align: 'center' });
      var right = [str(pr.date).trim(), str(pr.place).trim()].filter(Boolean).map(function (x, i) {
        return '<p style="' + font(ctx, { size: i ? 14 : 16, lh: 1.4, weight: 700, color: i ? p.muted : p.text, caps: !i, ls: !i ? '.02em' : '' }) + '">' + esc(x) + '</p>';
      }).join('');
      var cells = '<td class="col sc" width="38%" valign="middle" style="padding:22px 12px 22px 0">' + left + '</td>' +
        (b ? '<td class="col sc" width="28%" valign="middle" align="center" style="padding:22px 12px">' + b + '</td>' : '') +
        '<td class="col sc" width="34%" valign="middle" style="padding:22px 0 22px 12px">' + right + '</td>';
      out += row(ctx, '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-bottom:1px solid ' + p.line + '"><tr>' + cells + '</tr></table>', { pt: 0, pb: 0 });
      if (str(pr.text).trim()) out += row(ctx, paras(ctx, pr.text, { size: 16, lh: 1.6, color: p.text, link: p.themeInk }), { pt: 26, pb: 6 });
      return out;
    }
    if (lay === 'banner') {
      var bb = button(ctx, pr.ctaLabel, pr.ctaUrl, { align: 'center' });
      if (bb) out += row(ctx, bb, { pt: 26, pb: 26, align: 'center' });
      return out;
    }
    /* without a picture the hero is a band of the theme colour, so the mail still opens on the brand —
       unless a header band already does that just above it */
    var band = !job && !ctx.afterHeader;
    var bg = band ? p.band : '', ink = band ? p.bandInk : p.text, soft = band ? p.bandMuted : p.muted;
    var body = '';
    if (str(pr.eyebrow).trim()) body += '<p style="' + font(ctx, { size: 13, weight: 700, color: band ? soft : p.markInk, caps: true, ls: '.18em', extra: 'padding-bottom:10px;' }) + '">' + esc(pr.eyebrow) + '</p>';
    if (str(pr.title).trim()) body += '<h1 class="h1" style="' + font(ctx, { head: true, size: 34, lh: 1.15, weight: 700, color: ink }) + '">' + esc(pr.title) + '</h1>';
    body += metaLine(ctx, pr, ink, band ? soft : p.line);
    if (str(pr.text).trim()) body += '<div style="padding-top:14px">' + paras(ctx, pr.text, { size: 16, color: soft, link: ink }) + '</div>';
    var cb = button(ctx, pr.ctaLabel, pr.ctaUrl, band ? { bg: p.bandBtn, ink: p.bandBtnInk, align: align } : { align: align });
    if (cb) body += '<div style="padding-top:24px">' + cb + '</div>';
    if (body) out += row(ctx, body, { bg: bg, pt: band ? 48 : (job ? 34 : 44), pb: band ? 48 : 40, align: align });
    return out;
  };

  /* Text, and the house overview: the text on the left and a short list beside it ("Focus areas", "Who
     should attend") — one column on a phone. */
  RENDER.intro = RENDER.text = function (ctx, s, pad) {
    var pr = s.props, p = ctx.p, align = pr.align === 'center' ? 'center' : 'left';
    var side = pr.layout === 'side' ? filled(pr.sideItems, ['text']) : [];
    var main = heading(ctx, pr.heading, { align: side.length ? 'left' : align }) + paras(ctx, pr.text, { size: 15, lh: 1.6, color: side.length ? p.text : p.muted, link: p.themeInk, extra: !side.length && align === 'center' ? 'text-align:center;' : '' });
    if (ctx.preview && !str(pr.text).trim()) main += '<div style="border:1px dashed ' + p.line + ';border-radius:10px;padding:16px;font-family:Arial,sans-serif;font-size:13px;color:' + p.muted + '">Your text goes here — write it in the panel on the right. (This note is not in the mail.)</div>';
    var b = button(ctx, pr.ctaLabel, pr.ctaUrl, { align: side.length ? 'left' : align });
    if (b) main += '<div style="padding-top:24px">' + b + '</div>';
    if (side.length) {
      var list = (str(pr.sideHeading).trim() ? '<p style="' + font(ctx, { head: true, size: 15, lh: 1.4, weight: 700, color: p.text, caps: ctx.doc.headings !== 'title', ls: '.06em', extra: 'padding-bottom:12px;' }) + '">' + esc(pr.sideHeading) + '</p>' : '') +
        bullets(ctx, side, '&#8226;', p.themeInk, 15);
      var out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td class="col" width="58%" valign="top" style="padding-right:22px">' + main + '</td>' +
        '<td class="col cs" width="42%" valign="top" style="padding-left:22px;border-left:1px solid ' + p.line + '">' + list + '</td></tr></table>';
      return row(ctx, out, { pt: pad.pt, pb: pad.pb });
    }
    return row(ctx, main, { pt: pad.pt, pb: pad.pb, align: align === 'center' ? 'center' : '' });
  };
  /* a list with a mark before each item (a tick, a bullet) — the one used by lists and the overview */
  function bullets(ctx, items, mark, markInk, size) {
    var p = ctx.p;
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + items.map(function (it) {
      return '<tr><td width="20" valign="top" style="width:20px;padding:0 8px 9px 0"><p style="' + font(ctx, { size: 13, lh: 1.5, weight: 700, color: markInk }) + '">' + mark + '</p></td>' +
        '<td valign="top" style="padding:0 0 9px"><p style="' + font(ctx, { size: size, lh: 1.5, color: p.text }) + '">' + inline(it.text, p.themeInk) + '</p></td></tr>';
    }).join('') + '</table>';
  }

  /* Key facts as the platform's tiles: When / Where / Format, a small label over the value, on tinted tiles
     of one height (one under the other on a phone). */
  RENDER.facts = function (ctx, s, pad) {
    var p = ctx.p, items = filled(s.props.items, ['value']);
    var n = Math.min(items.length, 4), w = Math.floor(100 / n);
    var tile = fit(p.text, [p.surface], 4.5), soft = fit(p.muted, [p.surface], 4.5);
    var h = 30 + 20 * Math.max.apply(null, items.map(function (it) { return linesOf(it.value, 14, Math.floor(INNER / n) - 40); }));
    var cells = items.slice(0, 4).map(function (it, i) {
      return '<td class="col fx" width="' + w + '%" valign="top" style="padding:0 ' + (i < n - 1 ? 6 : 0) + 'px 0 ' + (i ? 6 : 0) + 'px">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + p.surface + '" style="width:100%;background-color:' + p.surface + ';border-radius:10px"><tr>' +
        '<td align="center" valign="middle" height="' + h + '" class="autoh" style="height:' + h + 'px;padding:14px 16px;text-align:center">' +
        '<p class="micro" style="' + font(ctx, { size: 10.5, lh: 1.3, weight: 800, color: soft, caps: true, ls: '.09em', extra: 'text-align:center;' }) + '">' + esc(it.label) + '</p>' +
        '<p style="' + font(ctx, { size: 14, lh: 1.35, weight: 700, color: tile, extra: 'padding-top:5px;text-align:center;' }) + '">' + inline(it.value, p.themeInk) + '</p></td></tr></table></td>';
    }).join('');
    var out = heading(ctx, s.props.heading) + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' + cells + '</tr></table>';
    return row(ctx, out, pad);
  };

  /* Numbers, one row on a desktop (two to a row on a phone). Six layouts: "band" — the house band, hairlines
     between the numbers; "boxes"; "tinted" — a tinted panel, divided; "solid" — a band of the theme colour
     (one to a row on a phone: half a row of bare colour would show); "plain" — no fill, accent figures;
     "underline" — an accent rule under each figure. */
  var STAT_LAYOUTS = [['band', 'One band, hairline dividers'], ['boxes', 'Separate bordered boxes'], ['tinted', 'Tinted panel, divided'], ['solid', 'Solid colour band'], ['plain', 'No fill, accent figures'], ['underline', 'Underlined figures']];
  RENDER.stats = function (ctx, s, pad) {
    var p = ctx.p, pr = s.props, items = filled(pr.items, ['value']), lay = pr.layout || 'band';
    var n = items.length, w = Math.floor(100 / n);
    var panel = lay === 'band' ? p.surface : lay === 'tinted' ? mix(p.bg, p.theme, p.dark ? 0.2 : 0.1) : lay === 'solid' ? p.band : '';
    var cellBg = lay === 'boxes' ? p.bg : (panel || p.bg);
    var numInk = lay === 'solid' ? p.bandInk : fit(p.markInk, [cellBg], 3), labInk = lay === 'solid' ? p.bandMuted : fit(p.muted, [cellBg], 4.5);
    var divide = lay === 'band' || lay === 'tinted' || lay === 'solid';
    var divLine = lay === 'solid' ? mix(p.band, p.bandInk, 0.25) : p.line;
    var cells = items.map(function (it, i) {
      var box = lay === 'boxes' ? 'border:1px solid ' + p.line + ';border-radius:' + Math.min(ctx.radius, 10) + 'px;' : '';
      var under = lay === 'underline' ? '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 0"><tr><td width="32" height="3" bgcolor="' + p.rule + '" style="width:32px;height:3px;font-size:0;line-height:0;background-color:' + p.rule + '">&nbsp;</td></tr></table>' : '';
      return '<td class="st' + (lay === 'solid' ? ' st1' : (lay === 'band' || lay === 'tinted' ? ' stc' : '')) + '" width="' + w + '%" valign="middle" align="center" style="padding:16px 8px;' + (divide && i ? 'border-left:1px solid ' + divLine + ';' : '') + box + '">' +
        '<p class="big" style="' + font(ctx, { head: true, size: n > 4 ? 22 : 26, lh: 1.1, weight: 700, color: numInk, extra: 'text-align:center;' }) + '">' + esc(it.value) + '</p>' + under +
        '<p class="micro" style="' + font(ctx, { size: 11, lh: 1.4, weight: 700, color: labInk, caps: true, ls: '.07em', extra: 'text-align:center;padding-top:5px;' }) + '">' + esc(it.label) + '</p></td>';
    }).join('');
    var table = '<table role="presentation" width="100%" cellpadding="0" cellspacing="' + (lay === 'boxes' ? 8 : 0) + '" border="0"' + (panel ? ' bgcolor="' + panel + '"' : '') +
      ' class="' + (lay === 'band' || lay === 'tinted' ? 'stband' : '') + '" style="width:100%;' + (panel ? 'background-color:' + panel + ';border-radius:10px;' + (lay !== 'solid' ? 'border:1px solid ' + p.line + ';' : '') : '') + '"><tr>' + cells + '</tr></table>';
    var head = heading(ctx, pr.heading, { align: 'center', gap: 20 });
    return row(ctx, head + table, { pt: pad.pt, pb: pad.pb, align: 'center' });
  };

  /* Lists — key discussion points, who should attend. Eight layouts: plain bullets, ticks, ticks in two
     columns, a tinted panel (one or two columns), numbered (two columns past five), one card per point, and
     solid colour tiles (the reference "discussion topics" grid). */
  var LIST_LAYOUTS = [['plain', 'Plain bullets'], ['ticks', 'Ticks'], ['two', 'Ticks, two columns'], ['panel', 'Tinted panel'], ['panel2', 'Tinted panel, two columns'], ['numbered', 'Numbered'], ['cards', 'One card per point'], ['tiles', 'Solid colour tiles']];
  function listLayout(pr, n) {
    if (pr.layout) return pr.layout;
    if (pr.style === 'numbered') return 'numbered';
    if (pr.style === 'single') return 'ticks';
    return n > 3 ? 'two' : 'ticks';
  }
  RENDER.list = function (ctx, s, pad) {
    var p = ctx.p, pr = s.props, items = filled(pr.items, ['text']), lay = listLayout(pr, items.length);
    var out = heading(ctx, pr.heading, { align: pr.align === 'left' ? 'left' : 'center' });
    function cols2(render, part) {
      var half = Math.ceil(part.length / 2);
      return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td class="col" width="50%" valign="top" style="padding-right:14px">' + render(part.slice(0, half), 0) + '</td>' +
        '<td class="col" width="50%" valign="top" style="padding-left:14px">' + render(part.slice(half), half) + '</td></tr></table>';
    }
    if (lay === 'numbered') {
      var num = function (part, from) {
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + part.map(function (it, i) {
          var k = from + i;
          return '<tr><td width="44" valign="top" style="width:44px;padding:12px 0;' + (i ? 'border-top:1px solid ' + p.line + ';' : '') + '">' +
            '<p style="' + font(ctx, { head: true, size: 18, lh: 1.35, weight: 700, color: p.themeInk }) + '">' + (k < 9 ? '0' : '') + (k + 1) + '</p></td>' +
            '<td valign="top" style="padding:12px 0;' + (i ? 'border-top:1px solid ' + p.line + ';' : '') + '"><p style="' + font(ctx, { size: 15, lh: 1.55, weight: 700, color: p.text, extra: 'padding-top:1px;' }) + '">' + inline(it.text, p.themeInk) + '</p></td></tr>';
        }).join('') + '</table>';
      };
      out += items.length > 5 ? cols2(num, items) : num(items, 0);
    } else if (lay === 'cards') {
      out += items.map(function (it) {
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:10px"><tr>' +
          '<td width="4" bgcolor="' + p.rule + '" style="width:4px;background-color:' + p.rule + ';border-radius:' + Math.min(ctx.radius, 8) + 'px 0 0 ' + Math.min(ctx.radius, 8) + 'px">&nbsp;</td>' +
          '<td bgcolor="' + p.surface + '" style="padding:14px 18px;background-color:' + p.surface + ';border-radius:0 ' + Math.min(ctx.radius, 8) + 'px ' + Math.min(ctx.radius, 8) + 'px 0">' +
          '<p style="' + font(ctx, { size: 15, lh: 1.5, weight: 700, color: fit(p.text, [p.surface], 4.5) }) + '">' + inline(it.text, p.themeInk) + '</p></td></tr></table>';
      }).join('');
    } else if (lay === 'tiles') {
      var tile = carrier(p.theme), tileInk = inkOn(tile), cols = +pr.tileCols || balancedCols(items.length, 3);
      out += '<div style="margin:0 -' + (GAP / 2) + 'px">' + grid(items, cols, function (it, w) {
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="' + (22 + 22 * Math.max.apply(null, items.map(function (x) { return linesOf(x.text, 15, w - 36); }))) + '" valign="middle" bgcolor="' + tile + '" style="padding:18px;background-color:' + tile + ';border-radius:' + Math.min(ctx.radius, 10) + 'px">' +
          '<p style="' + font(ctx, { size: 15, lh: 1.45, weight: 700, color: tileInk }) + '">' + inline(it.text, tileInk) + '</p></td></tr></table>';
      }, 'g2') + '</div>';
    } else {
      var mark = lay === 'plain' ? '&#8226;' : '&#10003;';
      var tint = lay === 'panel' || lay === 'panel2' ? p.surface : '';
      var listHtml = function (part) { return bullets(ctx, part, mark, tint ? fit(p.markInk, [tint], 4.5) : p.markInk, 13.5); };
      var body = (lay === 'two' || lay === 'panel2') && items.length > 1 ? cols2(listHtml, items) : listHtml(items);
      out += tint ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + tint + '" style="width:100%;background-color:' + tint + ';border-radius:12px"><tr><td style="padding:20px 22px 14px">' + body + '</td></tr></table>' : body;
    }
    return row(ctx, out, { pt: pad.pt, pb: Math.max(0, pad.pb - (lay === 'ticks' || lay === 'plain' || lay === 'two' ? 11 : 0)) });
  };

  /* Speakers: five layouts, each with its own natural number across — photo cards 3, circular portraits 4,
     a two-up feature 2, photo left and details right 2 (one to a row on a phone: there is no room for the
     text beside a halved photo), colour tiles with no photos 2. The photo's shape and whether the designation
     and the company show are the owner's; captions are as tall as the longest in the grid, so rows stay level.
     A speaker with no photo gets their initials. */
  var SPEAKER_LAYOUTS = [['cards', 'Photo cards'], ['circles', 'Circular portraits'], ['feature', 'Two-up feature'], ['side', 'Photo left, details right'], ['tiles', 'Colour tiles (no photos)']];
  var SPEAKER_COLS = { cards: 3, circles: 4, feature: 2, side: 2, tiles: 2 };
  var SPEAKER_CAP = { cards: 210, circles: 160, feature: 320, side: 320, tiles: 300 };
  RENDER.speakers = function (ctx, s, pad) {
    var p = ctx.p, pr = s.props, all = filled(pr.items, ['name']), lay = pr.layout || 'cards';
    var max = +pr.max || 0, items = max ? all.slice(0, max) : all;
    var n = items.length, cols = Math.min(+pr.cols || SPEAKER_COLS[lay], 4);
    cols = balancedCols(n, cols);
    var showRole = pr.showRole !== 'no', showCo = pr.showCompany !== 'no';
    var shape = lay === 'circles' ? 'circle' : (pr.shape || 'rounded');
    var rad = function (w) { return shape === 'circle' ? Math.round(w / 2) : shape === 'square' ? 0 : Math.min(ctx.radius, 12); };
    var tw = Math.min(Math.floor((INNER + GAP) / cols), SPEAKER_CAP[lay] + GAP) - GAP;
    /* caption height: from the longest name, designation and company in this grid */
    var capW = lay === 'side' ? tw - 110 : tw - (lay === 'cards' ? 24 : 0);
    var capH = Math.max.apply(null, items.map(function (it) {
      return 21 * linesOf(it.name, 15, capW) + (showRole ? 19 * linesOf(it.role, 13, capW) : 0) + (showCo ? 19 * linesOf(it.company, 13, capW) : 0);
    }).concat([20])) + 8;
    function photo(it, i, size) {
      var job = ctx.jobs[s.id + ':photo:' + i], r = rad(size);
      if (job && lay !== 'tiles') return img(ctx, srcFor(ctx, job), it.name, size, 'width:' + size + 'px;max-width:100%;height:' + (shape === 'circle' || lay === 'side' ? size + 'px' : 'auto') + ';border-radius:' + r + 'px;' + (shape === 'circle' ? 'margin:0 auto;' : ''));
      return '<table role="presentation" width="' + size + '" cellpadding="0" cellspacing="0" border="0"' + (shape === 'circle' ? ' align="center"' : '') + ' style="width:100%;max-width:' + size + 'px"><tr><td height="' + size + '" align="center" valign="middle" bgcolor="' + p.surface + '" class="ph" style="height:' + size + 'px;border-radius:' + r + 'px;background-color:' + p.surface + '">' +
        '<p style="' + font(ctx, { head: true, size: Math.round(size / 3.2), weight: 700, color: p.themeInk, extra: 'text-align:center;' }) + '">' + esc(initials(it.name)) + '</p></td></tr></table>';
    }
    function caption(it, ink, soft, centre) {
      var c = centre ? 'text-align:center;' : '';
      return '<p style="' + font(ctx, { head: true, size: 15, lh: 1.4, weight: 700, color: ink, extra: c }) + '">' + esc(it.name) + '</p>' +
        (showRole && str(it.role).trim() ? '<p style="' + font(ctx, { size: 13, lh: 1.45, color: soft, extra: 'padding-top:2px;' + c }) + '">' + esc(it.role) + '</p>' : '') +
        (showCo && str(it.company).trim() ? '<p style="' + font(ctx, { size: 13, lh: 1.45, weight: 700, color: ink, extra: 'padding-top:1px;' + c }) + '">' + esc(it.company) + '</p>' : '');
    }
    function fixed(html, h, extra) { return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="' + h + '" valign="top" style="height:' + h + 'px;' + (extra || '') + '">' + html + '</td></tr></table>'; }
    var cells = grid(items, cols, function (it, w, i) {
      if (lay === 'side') {
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="96" valign="top" style="width:96px;padding-right:14px">' + photo(it, i, 96) + '</td>' +
          '<td valign="middle">' + caption(it, p.text, p.muted, false) + '</td></tr></table>';
      }
      if (lay === 'tiles') {
        var tile = carrier(p.theme), ink = inkOn(tile);
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="' + (capH + 30) + '" valign="middle" bgcolor="' + tile + '" style="padding:15px 18px;background-color:' + tile + ';border-radius:' + Math.min(ctx.radius, 10) + 'px">' + caption(it, ink, fit(mix(ink, tile, 0.2), [tile], 4.5), false) + '</td></tr></table>';
      }
      if (lay === 'feature') {
        var bar = carrier(p.theme);
        return photo(it, i, w) + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="' + bar + '" style="padding:12px 14px;background-color:' + bar + '">' + fixed(caption(it, inkOn(bar), fit(mix(inkOn(bar), bar, 0.2), [bar], 4.5), false), capH) + '</td></tr></table>';
      }
      if (lay === 'circles') {
        var d = Math.min(w, 132);
        return '<div style="text-align:center">' + photo(it, i, d) + '</div>' + fixed(caption(it, p.text, p.muted, true), capH, 'padding-top:12px;');
      }
      /* cards: bordered, photo on top */
      return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ' + p.line + ';border-radius:' + Math.min(ctx.radius, 12) + 'px"><tr><td style="padding:12px 12px 0">' + photo(it, i, w - 24) + '</td></tr>' +
        '<tr><td style="padding:12px">' + fixed(caption(it, p.text, p.muted, false), capH) + '</td></tr></table>';
    }, lay === 'side' ? 'g1' : 'g2', SPEAKER_CAP[lay]);
    var head = (pr.heading || pr.text) ? '<div style="padding:0 ' + (GAP / 2) + 'px">' + heading(ctx, pr.heading, { align: 'center', gap: pr.text ? 8 : 22 }) +
      (str(pr.text).trim() ? '<div style="padding-bottom:22px;text-align:center">' + paras(ctx, pr.text, { size: 15, lh: 1.6, color: p.muted, link: p.themeInk, extra: 'text-align:center;' }) + '</div>' : '') + '</div>' : '';
    var more = all.length - items.length;
    var noteText = str(pr.note).trim() || (more > 0 ? 'And ' + more + ' more on the event site.' : '');
    var note = noteText ? '<p style="' + font(ctx, { size: 14, lh: 1.5, weight: 700, color: p.muted, extra: 'padding:0 ' + (GAP / 2) + 'px;text-align:center;' }) + '">' + inline(noteText, p.themeInk) + '</p>' : '';
    return row(ctx, head + cells + note, { pt: pad.pt, pb: note ? pad.pb : Math.max(0, pad.pb - GAP), px: PX - GAP / 2, cls: 'pxg', align: 'center' });
  };

  RENDER.agenda = function (ctx, s, pad) {
    var p = ctx.p, pr = s.props, items = filled(pr.items, ['title']);
    var out = heading(ctx, pr.heading, { gap: 8 }), day = null;
    var dayInk = p.markInk;
    var rows = '';
    items.forEach(function (it, i) {
      var d = str(it.day).trim();
      if (d && d !== day) {
        if (rows) { out += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rows + '</table>'; rows = ''; }
        out += '<p style="' + font(ctx, { size: 13, weight: 800, color: dayInk, caps: true, ls: '.16em', extra: 'padding:22px 0 8px;border-bottom:2px solid ' + p.rule + ';' }) + '">' + esc(d) + '</p>';
        day = d;
      }
      var first = !rows;
      rows += '<tr><td class="col agm" width="128" valign="top" style="width:128px;padding:16px 16px 16px 0;' + (first ? '' : 'border-top:1px solid ' + p.line + ';') + '">' +
        '<p style="' + font(ctx, { size: 14, lh: 1.5, weight: 700, color: p.muted }) + '">' + esc(it.time).replace(/ (AM|PM|am|pm)\b/g, '&nbsp;$1') + '</p></td>' +
        '<td class="col agt" valign="top" style="padding:16px 0;' + (first ? '' : 'border-top:1px solid ' + p.line + ';') + '">' +
        '<p style="' + font(ctx, { size: 16, lh: 1.45, weight: 700, color: p.text }) + '">' + esc(it.title) + '</p>' +
        (str(it.who).trim() ? '<p style="' + font(ctx, { size: 14, lh: 1.5, color: p.muted, extra: 'padding-top:4px;' }) + '">' + esc(it.who) + '</p>' : '') + '</td></tr>';
    });
    if (rows) out += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rows + '</table>';
    return row(ctx, out, pad);
  };

  /* Partners, grouped by tier. Four layouts: white logo cards (logos are drawn for white: dark-on-clear
     logos need a white ground), outlined cards, logos only, a compact strip of five to a row. The logo size,
     the tier label and the names under the logos are the owner's; a lead tier of one or two sits on wider
     tiles, every row centred. */
  var PARTNER_LAYOUTS = [['white', 'White logo cards'], ['outlined', 'Outlined cards'], ['bare', 'Logos only, no card'], ['strip', 'Compact strip (5 to a row)']];
  RENDER.partners = function (ctx, s, pad) {
    var p = ctx.p, pr = s.props, lay = pr.layout || 'white', all = filled(pr.items, ['name', 'logo']);
    var max = +pr.max || 0, items = max ? all.slice(0, max) : all, groups = [], by = {};
    items.forEach(function (it, i) {
      var t = str(it.tier).trim();
      if (!by.hasOwnProperty(t)) { by[t] = { tier: t, items: [] }; groups.push(by[t]); }
      by[t].items.push({ it: it, i: all.indexOf(it) });
    });
    var logoH = { small: 40, medium: 56, large: 72 }[pr.logoSize || 'medium'] || 56;
    var tileH = logoH + 36;
    var body = groups.map(function (g, gi) {
      var lead = gi === 0 && g.items.length <= 2 && groups.length > 1;
      var cols = lay === 'strip' ? Math.min(5, g.items.length) : balancedCols(g.items.length, 4);
      var cap = lay === 'strip' ? 120 : lead ? 300 : 190;
      var label = g.tier && pr.showTier !== 'no' ? '<p style="' + font(ctx, { size: 11, weight: 700, color: p.muted, caps: true, ls: '.14em', extra: 'text-align:center;padding:6px ' + (GAP / 2) + 'px 14px;' }) + '">' + esc(g.tier) + '</p>' : '';
      return label + grid(g.items, cols, function (x, w) {
        var it = x.it, job = ctx.jobs[s.id + ':logo:' + x.i], inner;
        var h = lay === 'strip' ? Math.min(logoH, 40) : logoH;
        if (job) inner = '<img src="' + esc(srcFor(ctx, job)) + '" alt="' + esc(it.name || 'Partner logo') + '" width="' + Math.min(w - 24, 180) + '" style="display:block;margin:0 auto;border:0;outline:none;width:auto;height:auto;max-width:100%;max-height:' + h + 'px">';
        else inner = '<p style="' + font(ctx, { head: true, size: 14, lh: 1.3, weight: 700, color: lay === 'bare' ? p.text : '#1b1d22', extra: 'text-align:center;' }) + '">' + esc(it.name) + '</p>';
        var href = safeUrl(it.url);
        if (href) inner = '<a href="' + esc(href) + '" target="_blank" style="text-decoration:none">' + inner + '</a>';
        var ground = lay === 'bare' ? '' : '#ffffff';
        var edge = lay === 'outlined' ? '1px solid ' + p.line : lay === 'white' ? '1px solid ' + (p.dark ? '#ffffff' : mix(p.line, p.bg, 0.3)) : '0';
        var th = lay === 'strip' ? 64 : tileH;
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="' + th + '" align="center" valign="middle"' + (ground ? ' bgcolor="' + ground + '"' : '') + ' style="height:' + th + 'px;padding:0 10px;' + (ground ? 'background-color:' + ground + ';' : '') + 'border:' + edge + ';border-radius:' + Math.min(ctx.radius, 10) + 'px">' + inner + '</td></tr></table>' +
          (pr.showNames === 'yes' && job ? '<p style="' + font(ctx, { size: 12, lh: 1.4, weight: 700, color: p.muted, extra: 'text-align:center;padding-top:8px;' }) + '">' + esc(it.name) + '</p>' : '');
      }, lay === 'strip' ? 'g3' : 'g2', cap);
    }).join('');
    var head = pr.heading ? '<div style="padding:0 ' + (GAP / 2) + 'px">' + heading(ctx, pr.heading, { align: 'center', gap: 16 }) + '</div>' : '';
    return row(ctx, head + body, { pt: pad.pt, pb: Math.max(0, pad.pb - GAP), px: PX - GAP / 2, cls: 'pxg', align: 'center' });
  };

  RENDER.cta = function (ctx, s, pad) {
    var p = ctx.p, pr = s.props;
    var out = '';
    /* no heading and no text: just the button, on the card */
    if (!str(pr.heading).trim() && !str(pr.text).trim()) return row(ctx, button(ctx, pr.label, pr.url, { align: 'center' }), { pt: 14, pb: 18, align: 'center' });
    if (str(pr.heading).trim()) out += '<h2 class="h2" style="' + font(ctx, { head: true, size: 26, lh: 1.25, weight: 700, color: p.bandInk, extra: 'text-align:center;' }) + '">' + esc(pr.heading) + '</h2>';
    if (str(pr.text).trim()) out += '<div style="padding-top:10px">' + paras(ctx, pr.text, { size: 15, lh: 1.6, color: p.bandMuted, link: p.bandInk, extra: 'text-align:center;' }) + '</div>';
    var b = button(ctx, pr.label, pr.url, { bg: p.bandBtn, ink: p.bandBtnInk, align: 'center' });
    if (b) out += '<div style="padding-top:' + (out ? 24 : 0) + 'px">' + b + '</div>';
    return row(ctx, out, { bg: p.band, pt: 44, pb: 44, align: 'center' });
  };

  /* Contacts, as the house sends them: "For Delegation", then name | e-mail | phone on one line — each part
     on its own line on a phone. */
  RENDER.contacts = function (ctx, s) {
    var p = ctx.p, pr = s.props, items = filled(pr.items, ['name', 'email', 'phone']);
    var sep = '<span class="hm" style="color:' + p.line + ';font-weight:400"> &nbsp;|&nbsp; </span>';
    var body = items.map(function (it, i) {
      var email = str(it.email).trim(), phone = str(it.phone).trim();
      var parts = [];
      if (str(it.name).trim()) parts.push('<span class="mb" style="font-weight:700;color:' + p.text + '">' + esc(it.name) + '</span>');
      if (email) parts.push('<span class="mb"><a href="mailto:' + esc(email) + '" style="color:' + p.text + ';text-decoration:none">' + esc(email) + '</a></span>');
      if (phone) parts.push('<span class="mb"><a href="tel:' + esc(phone.replace(/[^\d+]/g, '')) + '" style="color:' + p.text + ';text-decoration:none;font-weight:700">' + esc(phone) + '</a></span>');
      return (str(it.label).trim() ? '<p style="' + font(ctx, { size: 14, lh: 1.5, weight: 700, color: p.muted, extra: 'text-align:center;padding:' + (i ? 18 : 0) + 'px 0 6px;' }) + '">' + esc(it.label) + '</p>' : '') +
        '<p style="' + font(ctx, { size: 14, lh: 1.7, color: p.text, extra: 'text-align:center;' + (str(it.label).trim() || !i ? '' : 'padding-top:12px;') }) + '">' + parts.join(sep) + '</p>';
    }).join('');
    var head = heading(ctx, pr.heading, { align: 'center', gap: 18 });
    return row(ctx, head + body, { bg: p.surface, pt: 36, pb: 36, align: 'center' });
  };

  RENDER.image = function (ctx, s, pad) {
    var pr = s.props, job = ctx.jobs[s.id + ':image'];
    if (!job) return '';
    var full = pr.full === 'yes', w = full ? W : INNER;
    var pic = img(ctx, srcFor(ctx, job), pr.alt, w, 'width:100%;max-width:' + w + 'px;height:auto;' + (full ? '' : 'border-radius:' + Math.min(ctx.radius, 14) + 'px;'));
    var href = safeUrl(pr.link);
    if (href) pic = '<a href="' + esc(href) + '" target="_blank" style="text-decoration:none">' + pic + '</a>';
    if (str(pr.caption).trim()) pic += '<p style="' + font(ctx, { size: 13, lh: 1.5, color: ctx.p.muted, extra: 'padding:10px ' + (full ? PX : 0) + 'px 0;' }) + '">' + esc(pr.caption) + '</p>';
    return row(ctx, pic, { pt: pad.pt, pb: pad.pb, px: full ? 0 : PX, cls: full ? '' : 'px' });
  };

  RENDER.divider = function (ctx, s, pad) {
    return row(ctx, '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="' + ctx.p.line + '" style="height:1px;font-size:0;line-height:0;background-color:' + ctx.p.line + '">&nbsp;</td></tr></table>', pad);
  };

  /* The footer: the event, its site and social links if the owner keeps them, then the house legal lines —
     "If you do not want to receive this mailer, you can Unsubscribe from our mailing list." over the sender's
     name and the Times Center address. The unsubscribe link is the sending tool's own token. */
  RENDER.footer = function (ctx, s) {
    var p = ctx.p, pr = s.props, lines = '';
    var small = function (html, extra) { return '<p style="' + font(ctx, { size: 12, lh: 1.6, color: p.footInk, extra: 'text-align:center;' + (extra || '') }) + '">' + html + '</p>'; };
    var link = function (href, label) { return '<a href="' + esc(href) + '" target="_blank" style="color:' + p.footStrong + ';text-decoration:underline">' + esc(label) + '</a>'; };
    if (str(pr.name).trim()) lines += '<p style="' + font(ctx, { head: true, size: 15, lh: 1.4, weight: 700, color: p.footStrong, extra: 'text-align:center;' }) + '">' + esc(pr.name) + '</p>';
    if (str(pr.when).trim()) lines += small(esc(pr.when), 'padding-top:4px;');
    var site = safeUrl(pr.siteUrl);
    if (site) lines += small(link(site, str(pr.siteUrl).replace(/^https?:\/\//, '').replace(/\/$/, '')), 'padding-top:4px;');
    var social = filled(pr.social, ['url']).map(function (x) { var u = safeUrl(x.url); return u ? link(u, x.label || x.url) : ''; }).filter(Boolean);
    if (social.length) lines += small(social.join(' &nbsp;&middot;&nbsp; '), 'padding-top:10px;');
    if (str(pr.contactLine).trim()) lines += small(inline(pr.contactLine, p.footStrong), 'padding-top:10px;');
    var token = isUnsub(str(pr.unsubscribe).trim()) ? str(pr.unsubscribe).trim() : ESP_UNSUB;
    var unsub = '<a href="' + token + '" target="_blank" style="color:' + p.footStrong + ';text-decoration:underline">' + esc(pr.unsubscribeLabel || 'Unsubscribe') + '</a>';
    var legal = str(pr.reason).trim() ? esc(pr.reason) + ' ' : '';
    legal += 'If you do not want to receive this mailer, you can ' + unsub + ' from our mailing list.';
    var portal = str(pr.portal).trim(), sender = str(pr.sender).trim();
    var signOff = portal ? '<span id="portal_name">' + esc(portal) + '</span>' + (sender ? ' ' + esc(sender) : '') : esc(sender);
    lines += '<p class="micro" style="' + font(ctx, { size: 11, lh: 1.7, color: p.footInk, extra: 'text-align:center;' + (lines ? 'padding-top:18px;border-top:1px solid ' + mix(p.foot, p.text, 0.14) + ';margin-top:18px;' : '') }) + '">' + legal +
      (signOff ? '<br>' + signOff : '') + '</p>';
    return '<tr' + secAttr(ctx) + '><td class="px" align="center" bgcolor="' + p.foot + '" style="padding:22px ' + PX + 'px 24px;background-color:' + p.foot + ';border-top:3px solid ' + ET_RED + ';text-align:center">' + lines + '</td></tr>';
  };

  /* which sections sit on a band of their own (their own padding) and which sit on the card (they share
     one 40 px rhythm, so two of them in a row are not 80 px apart) */
  var BANDED = { header: 1, hero: 1, cta: 1, contacts: 1, footer: 1, image: 0 };
  function isEmpty(s, kit) {
    var pr = s.props || {};
    switch (s.kind) {
      case 'header': return false;
      case 'hero': return !pr.imageUrl && !str(pr.title).trim() && !str(pr.eyebrow).trim() && !str(pr.date).trim() && !str(pr.place).trim() && !str(pr.text).trim() && !str(pr.ctaLabel).trim();
      case 'intro': case 'text': return !str(pr.text).trim() && !str(pr.heading).trim() && !str(pr.ctaLabel).trim();
      case 'facts': return !filled(pr.items, ['value']).length;
      case 'stats': return !filled(pr.items, ['value']).length;
      case 'list': return !filled(pr.items, ['text']).length;
      case 'speakers': return !filled(pr.items, ['name']).length;
      case 'agenda': return !filled(pr.items, ['title']).length;
      case 'partners': return !filled(pr.items, ['name', 'logo']).length;
      case 'contacts': return !filled(pr.items, ['name', 'email', 'phone']).length;
      case 'cta': return !str(pr.heading).trim() && !str(pr.text).trim() && !str(pr.label).trim();
      case 'image': return !str(pr.url).trim();
      default: return false;
    }
  }

  /* ---- pictures: what each one is, and what it needs before a mail client can show it ---- */
  function needsPng(url) { return /\.(svg|webp)(?:[?#]|$)/i.test(str(url)); }
  function logoSize(kit, url) {
    var lu = kit && kit.brand && kit.brand.logoUnit;
    var w = 300, h = 0;
    if (lu && lu.url === url && +lu.width > 0 && +lu.height > 0) {
      var ratio = lu.width / lu.height;
      w = Math.min(360, Math.round(130 * ratio));
      if (w < 160) w = Math.min(220, Math.round(140 * ratio));
      h = Math.round(w / ratio);
    }
    return { w: Math.max(80, w), h: h };
  }
  /* -> { '<section id>:<slot>': { key, src, kind: 'as-is'|'png'|'crop'|'copy', w, ratio, focus } } for every
     picture the mail shows. 'copy': a picture mail clients can show but cannot reach (a path on this site, an
     http: address, one that is only in this browser) — put online unchanged when the mail is made. */
  function imageJobs(doc, kit) {
    var jobs = {};
    function add(slot, src, o) {
      src = str(src).trim();
      if (/^\/\//.test(src)) src = 'https:' + src;
      if (!/^(https?:|blob:|data:|\/)/i.test(src)) return;
      var kind = o.kind || (needsPng(src) ? 'png' : /^https:/i.test(src) ? 'as-is' : 'copy');
      var key = kind === 'as-is' ? src : kind === 'copy' ? src + '|copy' : src + '|' + kind + '|' + (o.w || '') + (kind === 'crop' ? '|' + o.ratio + '|' + o.focus : '');
      jobs[slot] = { key: key, src: src, kind: kind, w: o.w, ratio: o.ratio, focus: o.focus, h: o.h };
    }
    (doc.sections || []).forEach(function (s) {
      if (s.hidden) return;
      var pr = s.props || {};
      if (s.kind === 'header' && pr.mode !== 'text' && pr.logo) { var sz = pr.layout === 'bar' ? { w: 180 } : logoSize(kit, pr.logo); add(s.id + ':logo', pr.logo, { w: sz.w, h: sz.h }); }
      if (s.kind === 'hero' && pr.imageUrl) {
        var ratio = { wide: 2, cinema: 16 / 9 }[pr.crop];
        add(s.id + ':image', pr.imageUrl, ratio ? { kind: 'crop', w: W, ratio: ratio, focus: pr.focus || 'center' } : { w: W });
      }
      if (s.kind === 'image' && pr.url) add(s.id + ':image', pr.url, { w: pr.full === 'yes' ? W : INNER });
      if (s.kind === 'speakers') (pr.items || []).forEach(function (it, i) { if (it && it.photo) add(s.id + ':photo:' + i, it.photo, { w: 280 }); });
      if (s.kind === 'partners') (pr.items || []).forEach(function (it, i) { if (it && it.logo) add(s.id + ':logo:' + i, it.logo, { w: 180 }); });
    });
    return jobs;
  }

  /* opts: { preview: true } adds the editor's hooks (section ids, placeholders for empty sections, the
     selected outline) — never in what is downloaded. { pv } the preview's own picture copies.
     { broken: { '<picture key>': true } } pictures that could not be made mail-safe: they are left out
     (the logo becomes the name in text, a partner its name, a speaker their initials). */
  function render(doc, kit, opts) {
    opts = opts || {};
    kit = kit || {};
    var br = kit.brand || {}, ev = kit.event || {}, fonts = br.fonts || {};
    var radius = parseInt(br.radius, 10);
    radius = isNaN(radius) ? 10 : Math.max(0, Math.min(radius, 28));
    /* the house type is Verdana and no web fonts (the reference mailers load none); the site's own fonts
       only when the owner asks for them */
    var siteType = doc.font === 'site';
    var ctx = {
      doc: doc, kit: kit, p: derive(doc, kit), preview: !!opts.preview, pv: opts.pv || {},
      fh: siteType ? stackOf(fonts.heading) : HOUSE_FONT, fb: siteType ? stackOf(fonts.body) : HOUSE_FONT, radius: radius,
      name: str(ev.name) || 'Event', siteUrl: ev.siteUrl || '', jobs: imageJobs(doc, kit), afterHeader: false
    };
    /* the buttons: the owner's colour (carried until white or black words read on it) or the mail's own,
       and the owner's corners — 8 px, the house default */
    var own = hexOf(doc.btnColour, '');
    ctx.btn = own ? carrier(own) : ctx.p.btn;
    ctx.btnRadius = /^(0|4|8|99)$/.test(str(doc.btnRadius)) ? +doc.btnRadius : 8;
    var broken = opts.broken || {};
    Object.keys(ctx.jobs).forEach(function (slot) { if (broken[ctx.jobs[slot].key] && !(doc.assets && doc.assets[ctx.jobs[slot].key])) delete ctx.jobs[slot]; });
    var p = ctx.p;
    var visible = (doc.sections || []).filter(function (s) { return !s.hidden && RENDER[s.kind]; });
    /* the house sends open on a 4 px bar of ET red */
    var rows = '<tr><td height="4" bgcolor="' + ET_RED + '" style="height:4px;font-size:0;line-height:0;background-color:' + ET_RED + '">&nbsp;</td></tr>', prevCard = false;
    visible.forEach(function (s, i) {
      ctx.sec = s.id;
      var empty = isEmpty(s, kit);
      if (empty) {
        if (ctx.preview) {
          rows += row(ctx, '<div style="border:1px dashed ' + p.line + ';border-radius:10px;padding:18px;text-align:center;font-family:Arial,sans-serif;font-size:13px;color:' + p.muted + '">' +
            esc((KINDS[s.kind] || {}).label || s.kind) + ' — empty, so it is left out of the mail. Fill it in on the right.</div>', { pt: 16, pb: 16 });
          prevCard = false;
        }
        return;
      }
      var banded = !!BANDED[s.kind];
      /* two sections on the card are set apart by a hairline, as the platform's sends are */
      if (prevCard && !banded && s.kind !== 'divider') rows += '<tr><td class="px" style="padding:6px ' + PX + 'px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="' + p.line + '" style="height:1px;font-size:0;line-height:0;background-color:' + p.line + '">&nbsp;</td></tr></table></td></tr>';
      var pad = { pt: prevCard ? 24 : 30, pb: 26 };
      rows += RENDER[s.kind](ctx, s, pad);
      prevCard = !banded && s.kind !== 'divider';
      ctx.afterHeader = s.kind === 'header';
    });
    ctx.sec = '';
    var fontLinks = !siteType ? '' : [fonts.heading, fonts.body].filter(function (f, i, a) {
      return f && /^https:\/\//.test(str(f.cssUrl)) && a.map(function (x) { return x && x.cssUrl; }).indexOf(f.cssUrl) === i;
    }).map(function (f) { return '<link rel="stylesheet" href="' + esc(f.cssUrl) + '">'; }).join('');
    var pre = str(doc.preheader).trim();
    var previewCss = ctx.preview ? '[data-sec]{cursor:pointer}[data-sec]:hover>td{box-shadow:inset 0 0 0 2px rgba(47,111,176,.55)}' +
      (opts.selected ? '[data-sec="' + str(opts.selected).replace(/[^\w-]/g, '') + '"]>td{box-shadow:inset 0 0 0 3px #2f6fb0 !important}' : '') : '';
    return '<!doctype html>\n<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">\n<head>\n' +
      '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
      '<meta name="x-apple-disable-message-reformatting">\n<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">\n' +
      '<meta name="color-scheme" content="' + (p.dark ? 'dark' : 'light') + '">\n<meta name="supported-color-schemes" content="' + (p.dark ? 'dark' : 'light') + '">\n' +
      '<title>' + esc(doc.subject || ctx.name) + '</title>\n' +
      '<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->\n' +
      (fontLinks ? '<!--[if !mso]><!-->' + fontLinks + '<!--<![endif]-->\n' : '') +
      '<style>\n' +
      'body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:separate}\n' +
      'img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}body{margin:0!important;padding:0!important;width:100%!important}\n' +
      'a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}\n' +
      '@media only screen and (max-width:700px){' +
      '.w{width:100%!important;max-width:100%!important;border-radius:0!important}.wash{padding:0!important}' +
      '.px{padding-left:22px!important;padding-right:22px!important}.pxg{padding-left:12px!important;padding-right:12px!important}' +
      '.col{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;border-left:0!important;padding-left:0!important;padding-right:0!important}' +
      '.fcol{display:block!important;width:100%!important;box-sizing:border-box!important;border-left:0!important}.fcol2{border-top:1px solid ' + p.line + '!important}' +
      '.agt{padding-top:0!important;border-top:0!important}.agm{padding-bottom:6px!important}.mb{display:block!important}.hm{display:none!important}' +
      '.g2{width:50%!important;max-width:50%!important}.g1{width:100%!important;max-width:100%!important}' +
      '.h1{font-size:28px!important}.h2{font-size:19px!important}.h3{font-size:17px!important}.big{font-size:28px!important}' +
      '.st{display:inline-block!important;width:50%!important;max-width:50%!important;box-sizing:border-box!important;border-left:0!important}.st1{width:100%!important;max-width:100%!important}' +
      '.sc{text-align:center!important;padding:10px 0!important}.sc p{text-align:center!important}.sc table{margin:0 auto!important}.cs{border-left:0!important;border-top:1px solid ' + p.line + '!important;padding-top:20px!important;margin-top:20px!important}' +
      '.g3{width:33.33%!important;max-width:33.33%!important}.gw{max-width:100%!important}.g2 .ph{height:120px!important}.px{padding-left:18px!important;padding-right:18px!important}' +
      '.fx{display:block!important;width:100%!important;padding:0 0 10px!important}.autoh{height:auto!important}.micro{font-size:12px!important;letter-spacing:.06em!important}' +
      '.stband{background-color:transparent!important;border:0!important}.stc{background-color:' + p.surface + '!important;border:1px solid ' + p.line + '!important;border-radius:10px!important;width:48%!important;max-width:48%!important;margin:0 1% 10px!important}}\n' +
      '@media only screen and (max-width:352px){.g2{width:100%!important;max-width:100%!important}.st{width:100%!important;max-width:100%!important}}\n' +
      previewCss + '\n</style>\n</head>\n' +
      '<body style="margin:0;padding:0;width:100%;background-color:' + p.page + '">\n' +
      (pre ? '<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:' + p.page + ';opacity:0">' + esc(pre) + '&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>\n' : '') +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + p.page + '" style="width:100%;background-color:' + p.page + '">\n' +
      '<tr><td class="wash" align="center" style="padding:26px 12px">\n' +
      '<!--[if mso]><table role="presentation" width="' + W + '" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->\n' +
      '<table role="presentation" class="w" width="' + W + '" cellpadding="0" cellspacing="0" border="0" bgcolor="' + p.bg + '" style="width:100%;max-width:' + W + 'px;background-color:' + p.bg + ';border-radius:12px;overflow:hidden;font-family:' + ctx.fb + '">\n' +
      rows + '\n</table>\n<!--[if mso]></td></tr></table><![endif]-->\n</td></tr>\n</table>\n</body>\n</html>\n';
  }

  /* ================================================================ quality checks */
  /* Run on the finished HTML (the same string that is downloaded), so they test what is sent, not what
     was meant. Errors are things a mail client or a spam filter will get wrong; warnings are worth a look. */
  function check(html, opts) {
    opts = opts || {};
    var issues = [], seen = {};
    function add(level, text) { if (!seen[text]) { seen[text] = 1; issues.push({ level: level, text: text }); } }
    var bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(html).length : html.length;
    var kb = Math.round(bytes / 1024);
    if (bytes > 100 * 1024) add('error', 'The mail is ' + kb + ' KB. Gmail cuts mails off at about 102 KB — remove sections or rows until it is under 100 KB.');
    else if (bytes > 85 * 1024) add('warn', 'The mail is ' + kb + ' KB, close to the 100 KB where Gmail starts cutting mails off.');
    if (/<script\b/i.test(html)) add('error', 'The mail contains a script. Mail clients block scripts and spam filters reject them.');
    if (!/\{\{unsubscribe\}\}|\{\$\$!!unsubscribelink!!\$\$\}/.test(html)) add('warn', 'There is no unsubscribe link. Keep the footer, or add ' + ESP_UNSUB + ' yourself.');
    if (typeof DOMParser === 'undefined') return { bytes: bytes, kb: kb, issues: issues };
    var doc = new DOMParser().parseFromString(html, 'text/html');
    Array.prototype.forEach.call(doc.querySelectorAll('*'), function (el) {
      Array.prototype.forEach.call(el.attributes, function (a) {
        if (/^on/i.test(a.name)) add('error', 'An element has a script handler (' + a.name + ').');
        if (/^(href|src)$/i.test(a.name) && /^\s*(javascript|vbscript|data):/i.test(a.value) && !(a.name === 'src' && /^data:image\//i.test(a.value))) add('error', 'A link or picture uses a ' + a.value.split(':')[0] + ': address.');
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('img'), function (im) {
      var src = im.getAttribute('src') || '', name = src.split('?')[0].split('/').pop().slice(0, 40);
      if (!(im.getAttribute('alt') || '').trim()) add('error', 'A picture (' + name + ') has no alt text.');
      if (!im.getAttribute('width')) add('error', 'A picture (' + name + ') has no width.');
      if (/^blob:|^data:/i.test(src)) add('error', 'A picture (' + name + ') only exists in this browser — download or copy again to put it online.');
      else if (!/^https:\/\//i.test(src)) {
        if (opts.converting && /^(http:|\/)/i.test(src)) add('warn', 'A picture (' + name + ') is not on a public https address yet. It is put online when you download or copy.');
        else add('error', 'A picture (' + name + ') is not on a public https address.');
      }
      if (needsPng(src) && !opts.converting) add('warn', 'A picture (' + name + ') is SVG or WebP, which many mail clients cannot show. It is turned into PNG when you download or copy.');
    });
    Array.prototype.forEach.call(doc.querySelectorAll('a'), function (a) {
      var pic = a.querySelector('img'), href = (a.getAttribute('href') || '').trim();
      var label = (a.textContent || '').trim().slice(0, 40) || (pic && pic.getAttribute('alt') ? 'picture: ' + pic.getAttribute('alt').slice(0, 40) : 'a picture');
      if (isUnsub(href) || /^https:\/\//i.test(href) || /^(mailto|tel):/i.test(href)) return;
      if (!href || href === '#') add('warn', 'The link "' + label + '" goes nowhere yet — give it an address.');
      else if (/^http:\/\//i.test(href)) add('warn', 'The link "' + label + '" is not https.');
      else add('error', 'The link "' + label + '" has an address mail clients cannot open (' + href.slice(0, 40) + ').');
    });
    contrastIssues(doc).forEach(function (t) { add('error', t); });
    return { bytes: bytes, kb: kb, issues: issues };
  }
  function styleOf(el, prop) {
    var m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i').exec(el.getAttribute('style') || '');
    return m ? m[1].trim() : '';
  }
  /* every piece of text against the colour it sits on, as the inline styles say: 4.5:1, or 3:1 for large text */
  function contrastIssues(doc) {
    var out = [], walker = doc.createTreeWalker(doc.body, 4, null), node, done = {};
    while ((node = walker.nextNode())) {
      var t = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (!t || /^[‌ ͏\s|·]+$/.test(t)) continue;
      var el = node.parentNode, colour = '', bg = '', size = 16, bold = false, hidden = false, sizeSet = false;
      for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
        if (/display\s*:\s*none/i.test(e.getAttribute('style') || '')) { hidden = true; break; }
        if (!colour) colour = hexOf(styleOf(e, 'color'), '');
        if (!bg) bg = hexOf(styleOf(e, 'background-color') || e.getAttribute('bgcolor'), '');
        if (!sizeSet && styleOf(e, 'font-size')) { size = parseFloat(styleOf(e, 'font-size')) || 16; sizeSet = true; }
        var fw = styleOf(e, 'font-weight');
        if (!bold && (+fw >= 700 || /bold/i.test(fw) || /^(STRONG|B|H1|H2)$/.test(e.tagName))) bold = true;
      }
      if (hidden || !colour || !bg) continue;
      var c = contrast(colour, bg), need = size >= 24 || (size >= 18.6 && bold) ? 3 : 4.5;
      if (c < need && !done[colour + bg]) {
        done[colour + bg] = 1;
        out.push('Text "' + t.slice(0, 40) + '" is hard to read: ' + c.toFixed(1) + ':1 against its background (needs ' + need + ':1).');
      }
    }
    return out;
  }

  /* ================================================================ first versions, from the kit */
  var TYPES = [
    { id: 'allinone', label: 'All in one', blurb: 'Everything the event has: overview, when and where, numbers, topics, who should attend, speakers, agenda, partners and contacts.' },
    { id: 'invitation', label: 'Invitation', blurb: 'Announce the event: what it is, when and where, who it is for, the topics, speakers and partners.' },
    { id: 'speakers', label: 'Speaker reveal', blurb: 'A grid of the speakers you pick.' },
    { id: 'agenda', label: 'Agenda', blurb: 'The sessions, day by day, with times and speakers.' },
    { id: 'partners', label: 'Partners', blurb: 'The event’s partners, grouped by tier.' },
    { id: 'reminder', label: 'Reminder', blurb: 'A countdown, sent in the days before the event.' },
    { id: 'topics', label: 'Key topics', blurb: 'What the event will discuss, and who should come.' },
    { id: 'blank', label: 'Blank', blurb: 'The site’s header, your own text, a button and the footer.' }
  ];
  function typeOf(id) { return TYPES.filter(function (t) { return t.id === id; })[0] || TYPES[TYPES.length - 1]; }

  function K(kit) { return { ev: (kit && kit.event) || {}, br: (kit && kit.brand) || {}, ct: (kit && kit.content) || {} }; }
  function consoleHref(kit, tab) { return '/edit-event.html?event=' + encodeURIComponent(K(kit).ev.id || '') + '#content/' + tab; }
  function dateOnly(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function daysToGo(kit, now) {
    var d = dateOnly(K(kit).ev.start);
    if (!d) return null;
    var t = now || new Date(), today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((d - today) / 86400000);
  }
  /* a reminder's countdown, as its hero title and subject say it */
  function countTitle(n) { return n === 0 ? 'It starts today' : n === 1 ? 'Tomorrow' : n + ' days to go'; }
  function countSubject(n) { return n === 0 ? 'Today: ' : n === 1 ? 'Tomorrow: ' : n + ' days to go: '; }
  /* the day count a title or subject was written for, else null (the owner wrote their own) */
  function countIn(text) {
    var t = str(text).trim(), m = /^(\d+) days to go(?::|$)/.exec(t);
    return m ? +m[1] : /^(It starts today$|Today:)/.test(t) ? 0 : /^Tomorrow(?::|$)/.test(t) ? 1 : null;
  }
  function overviewText(kit) { var k = K(kit); return str(k.ct.overview || k.ev.description).trim(); }

  function availability(type, kit) {
    var k = K(kit);
    switch (type) {
      case 'invitation':
        if (!overviewText(kit) && !k.ev.dateLabel) return { ok: false, reason: 'The event has neither an overview nor a date yet.', href: consoleHref(kit, 'basics'), action: 'Add them' };
        return { ok: true };
      case 'speakers':
        if (!(k.ct.speakers || []).length) return { ok: false, reason: 'No confirmed speakers yet.', href: consoleHref(kit, 'speakers'), action: 'Add speakers' };
        return { ok: true };
      case 'agenda':
        if (!(k.ct.sessions || []).length) return { ok: false, reason: 'The agenda has no sessions yet.', href: consoleHref(kit, 'agenda'), action: 'Add sessions' };
        return { ok: true };
      case 'partners':
        if (!(k.ct.partners || []).length) return { ok: false, reason: 'No confirmed partners yet.', href: consoleHref(kit, 'sponsors'), action: 'Add partners' };
        return { ok: true };
      case 'reminder':
        var n = daysToGo(kit);
        if (n == null) return { ok: false, reason: 'The event has no start date yet, so there is nothing to count down to.', href: consoleHref(kit, 'basics'), action: 'Set the date' };
        if (n < 0) return { ok: false, reason: 'The event has already started — a countdown only works before the first day.' };
        return { ok: true };
      case 'topics':
        if (!(k.ct.topics || []).length) return { ok: false, reason: 'The site lists no key topics (discussion points) yet.' };
        return { ok: true };
      default: return { ok: true };
    }
  }

  var seq = 0;
  function sid() { seq += 1; return 's' + Date.now().toString(36) + seq.toString(36); }
  function excerpt(text, max) {
    text = str(text).replace(/\r/g, '').trim();
    if (!text) return '';
    var paras = text.split(/\n\s*\n/), out = '';
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i].replace(/\s+/g, ' ').trim();
      if (!p) continue;
      if (out && out.length + p.length > max) break;
      if (!out && p.length > max) {
        var cut = p.slice(0, max), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
        return end > max * 0.45 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
      }
      out += (out ? '\n\n' : '') + p;
    }
    return out;
  }
  function placeOf(kit) { var ev = K(kit).ev; return str(ev.place || [ev.venue, ev.city].filter(Boolean).join(', ')); }
  /* "1 day", "2 days" — the event's length, for the Format tile */
  function daysLabel(a, b) {
    var d1 = dateOnly(a), d2 = dateOnly(b);
    if (!d1 || !d2) return '';
    var n = Math.round((d2 - d1) / 86400000) + 1;
    return n >= 1 ? n + (n === 1 ? ' day' : ' days') : '';
  }
  function cta(kit) {
    var ev = K(kit).ev;
    return { label: ev.registerUrl ? 'Register now' : (ev.siteUrl ? 'Visit the event site' : 'Register now'), url: ev.registerUrl || ev.siteUrl || '' };
  }
  function editionLabel(ev) {
    var e = str(ev.edition).trim();
    if (/^\d+$/.test(e)) return ordinal(+e) + ' edition';
    return e;
  }
  function hhmm(v) {
    v = str(v).trim();
    var m = /T(\d{2}):(\d{2})/.exec(v) || /^(\d{1,2}):(\d{2})$/.exec(v);
    if (!m) return v;
    var h = +m[1], ap = h >= 12 ? 'PM' : 'AM';
    return ((h % 12) || 12) + ':' + m[2] + ' ' + ap;
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function sessionRows(kit) {
    var sessions = K(kit).ct.sessions || [], days = [];
    sessions.forEach(function (s) { var d = str(s.day || (str(s.start).match(/^\d{4}-\d{2}-\d{2}/) || [''])[0]); if (days.indexOf(d) === -1) days.push(d); });
    var many = days.length > 1;
    return sessions.map(function (s) {
      var raw = str(s.day || (str(s.start).match(/^\d{4}-\d{2}-\d{2}/) || [''])[0]), day = raw, d = dateOnly(raw);
      if (/^\d+$/.test(raw)) day = 'Day ' + raw;
      else if (d) day = (many ? 'Day ' + (days.indexOf(raw) + 1) + ' · ' : '') + d.getDate() + ' ' + MONTHS[d.getMonth()];
      var a = hhmm(s.start), b = hhmm(s.end);
      if (a && b && a.slice(-2) === b.slice(-2)) a = a.slice(0, -3);
      return { day: day, time: [a, b].filter(Boolean).join(' – '), title: str(s.title), who: (s.speakers || []).join(', '), ref: str(s.id) };
    });
  }
  function speakerRow(s) { return { name: str(s.name), role: str(s.designation), company: str(s.company), photo: str(s.photoUrl), ref: str(s.id) }; }
  function partnerRow(p) { return { tier: str(p.tier), name: str(p.name), logo: str(p.logoUrl), url: str(p.url), ref: str(p.id) }; }
  function contactRow(c) { return { label: str(c.label), name: str(c.name), email: str(c.email), phone: str(c.phone) }; }

  /* a section of `kind` with what the event has for it (an empty one is still a valid section: it is left
     out of the mail until the owner fills it in) */
  function makeSection(kind, kit, o) {
    o = o || {};
    var k = K(kit), ev = k.ev, br = k.br, ct = k.ct, c = cta(kit), pr = {};
    switch (kind) {
      case 'header':
        var lu = br.logoUnit, parts = br.logoUnitParts || {};
        var logo = (lu && lu.url) || br.eventLogoUrl || '';
        /* the logo bar carries the portal's wordmark when the event belongs to one (in the ink that shows on
           the mail's card), else the site's own lock-up */
        var portal = br.portal || null, darkCard = br.mode === 'dark';
        var wordmark = portal ? (darkCard ? portal.logoLight || portal.logo : portal.logo || portal.logoLight) : '';
        if (wordmark) logo = wordmark;
        pr = { layout: 'bar', mode: logo ? 'logo' : 'text', logo: logo, logoAlt: portal ? portal.name : '', tone: lu && lu.url ? str(lu.tone) : (k.br.mode || ''), band: 'auto',
          before: str(parts.before || (parts.keyword ? '' : ev.name)), keyword: str(parts.keyword), after: str(parts.after), note: str(ev.hashtag) };
        break;
      case 'hero':
        pr = { layout: o.layout || 'title', imageUrl: str(br.heroImageUrl), crop: 'wide', focus: 'center', alt: str(ev.name), eyebrow: o.eyebrow != null ? o.eyebrow : editionLabel(ev),
          title: str(o.title || ev.name), date: str(ev.dateLabel), place: placeOf(kit), text: str(o.text != null ? o.text : (k.br.tagline || '')), ctaLabel: o.cta === false ? '' : c.label, ctaUrl: c.url, align: 'center' };
        break;
      case 'intro':
        pr = { layout: 'plain', heading: o.heading != null ? o.heading : 'Overview', text: excerpt(overviewText(kit), o.max || 900), align: 'center', sideHeading: '', sideItems: [] };
        if (o.side && (ct[o.side] || []).length) {
          pr.layout = 'side'; pr.sideHeading = o.side === 'audience' ? 'Who should attend' : 'Focus areas';
          pr.sideItems = ct[o.side].slice(0, 8).map(function (t) { return { text: str(t) }; });
        }
        break;
      case 'text':
        pr = { heading: '', text: '', ctaLabel: '', ctaUrl: '' };
        break;
      case 'facts':
        pr = { heading: '', items: [{ label: 'When', value: str(ev.dateLabel) }, { label: 'Where', value: placeOf(kit) }, { label: 'Format', value: str(o.format || '') }].filter(function (x) { return x.value; }) };
        break;
      case 'stats':
        pr = { layout: 'band', heading: '', items: (ct.stats || []).slice(0, 6).map(function (x) { return { value: str(x.value), label: str(x.label) }; }) };
        break;
      case 'list':
        var from = o.from === 'audience' ? ct.audience : ct.topics;
        pr = { heading: o.heading != null ? o.heading : (o.from === 'audience' ? 'Who should attend' : 'Discussion topics'), layout: o.layout || (o.from === 'audience' ? 'ticks' : 'panel'), align: 'center',
          items: (from || []).slice(0, o.max || 12).map(function (t) { return { text: str(t) }; }) };
        break;
      case 'speakers':
        var sp = (ct.speakers || []).slice(0, o.max || 6);
        var more = (ct.speakers || []).length - sp.length;
        pr = { layout: o.layout || 'cards', heading: o.heading != null ? o.heading : 'Speakers', text: '', cols: '', max: '', shape: 'rounded', showRole: 'yes', showCompany: 'yes', items: sp.map(speakerRow),
          note: more > 0 ? 'And ' + more + ' more speaker' + (more === 1 ? '' : 's') + ' on the event site.' : '' };
        break;
      case 'agenda':
        pr = { heading: o.heading != null ? o.heading : 'Agenda', items: sessionRows(kit).slice(0, o.max || 60) };
        break;
      case 'partners':
        pr = { layout: 'white', heading: o.heading != null ? o.heading : 'Partners', logoSize: 'medium', showTier: 'yes', showNames: 'no', max: '', items: (ct.partners || []).map(partnerRow) };
        break;
      case 'cta':
        pr = { heading: o.heading != null ? o.heading : 'Join us at ' + str(ev.name), text: o.text != null ? o.text : [ev.dateLabel, placeOf(kit)].filter(Boolean).join(' · '), label: c.label, url: c.url };
        break;
      case 'contacts':
        pr = { heading: 'Contact us', items: (ct.contacts || []).slice(0, 6).map(contactRow) };
        break;
      case 'image':
        pr = { url: '', alt: '', link: '', caption: '', full: 'no' };
        break;
      case 'divider':
        pr = {};
        break;
      case 'footer':
        var first = (ct.contacts || []).filter(function (x) { return x.email; })[0];
        /* the house footer is the legal lines only; the rest is there to fill in when wanted */
        pr = { name: '', when: '', siteUrl: '',
          social: (ct.social || []).filter(function (x) { return x && x.url; }).map(function (x) { return { label: SOCIAL[x.kind] || str(x.kind) || 'Link', url: str(x.url) }; }),
          contactLine: '', reason: '', unsubscribeLabel: 'Unsubscribe', unsubscribe: ESP_UNSUB,
          portal: (br.portal && br.portal.name) || 'The Economic Times', sender: ET_SENDER };
        break;
    }
    return { id: sid(), kind: kind, hidden: false, props: pr };
  }
  var SOCIAL = { linkedin: 'LinkedIn', x: 'X', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', website: 'Website' };

  function build(type, kit) {
    var k = K(kit), ev = k.ev, ct = k.ct, name = str(ev.name) || 'our event', S = [];
    function add(kind, o, when) { if (when === false) return; S.push(makeSection(kind, kit, o)); }
    var has = function (list) { return (ct[list] || []).length > 0; };
    var n = daysToGo(kit), sub = '', pre = [ev.dateLabel, placeOf(kit)].filter(Boolean).join(' · ');
    add('header');
    switch (type) {
      case 'allinone':
        add('hero', { eyebrow: editionLabel(ev), cta: false });
        add('intro', {}, !!overviewText(kit));
        add('facts', { format: ev.start && ev.end ? daysLabel(ev.start, ev.end) : '' }, !!(ev.dateLabel || placeOf(kit)));
        add('stats', {}, has('stats'));
        add('list', { from: 'topics', max: 10 }, has('topics'));
        add('list', { from: 'audience' }, has('audience'));
        add('speakers', { max: 6 }, has('speakers'));
        add('agenda', { max: 8 }, has('sessions'));
        add('partners', {}, has('partners'));
        add('cta', { heading: '', text: '' });
        add('contacts', {}, has('contacts'));
        sub = 'Everything about ' + name;
        pre = 'Speakers, agenda, partners and how to register.';
        break;
      case 'invitation':
        add('hero', { eyebrow: editionLabel(ev) || 'You’re invited', layout: 'strip' });
        add('intro', { side: has('audience') ? 'audience' : '' }, !!overviewText(kit));
        add('stats', {}, has('stats'));
        add('list', { from: 'audience' }, has('audience') && !overviewText(kit));
        add('list', { from: 'topics', max: 8, layout: 'two' }, has('topics'));
        add('speakers', { max: 6 }, has('speakers'));
        add('cta', { heading: '', text: '' });
        add('partners', {}, has('partners'));
        add('contacts', {}, has('contacts'));
        sub = 'You’re invited: ' + name + (ev.dateLabel ? ', ' + ev.dateLabel : '');
        break;
      case 'speakers':
        add('hero', { eyebrow: 'Speakers', title: 'Meet the speakers' });
        add('speakers', { max: 12, heading: '' });
        add('cta', { heading: 'Hear them at ' + name });
        sub = 'Meet the speakers at ' + name;
        break;
      case 'agenda':
        add('hero', { eyebrow: 'Agenda', title: 'The programme' });
        add('agenda', { heading: '' });
        add('cta', { heading: 'Save your seat' });
        add('contacts', {}, has('contacts'));
        sub = 'The agenda for ' + name;
        break;
      case 'partners':
        add('hero', { eyebrow: 'Partners', title: 'The partners behind ' + name });
        add('partners', { heading: '' });
        add('cta');
        add('contacts', {}, has('contacts'));
        sub = 'The partners behind ' + name;
        break;
      case 'reminder':
        add('hero', { eyebrow: 'Reminder', title: countTitle(n) });
        add('intro', { heading: 'See you at ' + name, max: 420 }, !!overviewText(kit));
        add('speakers', { max: 4, heading: 'On stage' }, has('speakers'));
        add('cta', { heading: 'Your seat is waiting' });
        add('contacts', {}, has('contacts'));
        sub = countSubject(n) + name;
        break;
      case 'topics':
        add('hero', { eyebrow: 'Key topics', title: 'What we will discuss' });
        add('intro', { heading: '', max: 420 }, !!overviewText(kit));
        add('list', { from: 'topics', heading: '' });
        add('list', { from: 'audience' }, has('audience'));
        add('cta');
        sub = 'What we will discuss at ' + name;
        break;
      default:
        add('text');
        S[S.length - 1].props.heading = name;
        add('cta', { heading: '' });
        sub = name;
    }
    add('footer');
    return {
      v: 1, type: type, subject: sub, preheader: pre,
      palette: sitePalette(kit), sections: S, assets: {}
    };
  }
  function sitePalette(kit) {
    var col = (kit && kit.brand && kit.brand.colours) || {}, dark = (kit && kit.brand && kit.brand.mode) === 'dark';
    return {
      theme: hexOf(col.theme, '#186bf9'), accent: hexOf(col.accent, hexOf(col.theme, '#186bf9')),
      background: hexOf(col.background, dark ? '#0d1117' : '#ffffff'), surface: hexOf(col.surface, dark ? '#161b24' : '#f5f6f8'),
      text: hexOf(col.text, dark ? '#f3f4f6' : '#1b1d22'), muted: hexOf(col.muted, dark ? '#a8b0bd' : '#5b616e')
    };
  }

  /* ================================================================ pictures, made mail-safe */
  function loadImg(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('The picture could not be read.')); };
      im.src = src;
    });
  }
  /* draws a picture of the kit into a canvas (through RevampPromo.image, so the canvas can be exported):
     an SVG/WebP to PNG at twice its size in the mail, a hero to a JPEG banner of the chosen shape */
  function draw(job, kit) {
    if (job.kind === 'copy') return copyOf(job, kit);
    return P().image(job.src).then(loadImg).then(function (im) {
      var nw = im.naturalWidth, nh = im.naturalHeight;
      if (!nw || !nh) { var sz = logoSize(kit, job.src); nw = sz.w * 2; nh = (sz.h || sz.w / 3) * 2; }
      var cv = document.createElement('canvas'), g;
      if (job.kind === 'crop') {
        var cw = Math.min(nw, job.w * 2), ch = Math.round(cw / job.ratio);
        var sw = nw, sh = nw / job.ratio, sx = 0, sy = 0;
        if (sh > nh) { sh = nh; sw = nh * job.ratio; sx = (nw - sw) / 2; }
        else sy = job.focus === 'top' ? 0 : job.focus === 'bottom' ? nh - sh : (nh - sh) / 2;
        cv.width = Math.round(cw); cv.height = ch;
        g = cv.getContext('2d');
        g.drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
        return toBlob(cv, 'image/jpeg', 0.86);
      }
      var w = (job.w || 300) * 2, h = Math.round(w * nh / nw);
      cv.width = w; cv.height = h;
      g = cv.getContext('2d');
      g.drawImage(im, 0, 0, w, h);
      return job.as === 'jpeg' ? toBlob(cv, 'image/jpeg', 0.86) : toBlob(cv, 'image/png');
    });
  }
  /* a 'copy' job: the picture's own bytes, unchanged — redrawn (at twice its size in the mail) only when they
     are not a PNG, JPEG or GIF the upload takes (at most 8 MB) */
  function copyOf(job, kit) {
    return P().image(job.src).then(function (u) { return fetch(u); }).then(function (r) {
      if (!r.ok) throw new Error('The picture could not be read.');
      return r.blob();
    }).then(function (b) {
      var t = str(b.type).split(';')[0].trim().toLowerCase();
      if (/^image\/(png|jpe?g|gif)$/.test(t) && b.size > 0 && b.size <= 8 * 1048576) return t === 'image/jpg' ? new Blob([b], { type: 'image/jpeg' }) : b;
      return draw({ src: job.src, kind: 'png', w: job.w, as: /png|gif|svg/.test(t) ? 'png' : 'jpeg' }, kit);
    });
  }
  function toBlob(cv, type, q) {
    return new Promise(function (resolve, reject) {
      try {
        cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error('The picture could not be made.')); }, type, q);
      } catch (e) { reject(new Error('The picture could not be made (' + e.message + ').')); }
    });
  }
  /* the colour a logo is drawn on, when it is drawn on one (its four corners are opaque and agree), else ''.
     Asked once per picture: every mailer with the same logo gets the same answer. */
  var logoBgs = {};
  function logoBackground(url) {
    if (logoBgs[url]) return logoBgs[url];
    logoBgs[url] = P().image(url).then(loadImg).then(function (im) {
      var w = 64, h = Math.max(8, Math.round(64 * (im.naturalHeight || 1) / (im.naturalWidth || 3)));
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var g = cv.getContext('2d');
      g.drawImage(im, 0, 0, w, h);
      var px = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]].map(function (q) { return g.getImageData(q[0], q[1], 1, 1).data; });
      if (px.some(function (d) { return d[3] < 250; })) return '';
      var same = px.every(function (d) { return Math.abs(d[0] - px[0][0]) + Math.abs(d[1] - px[0][1]) + Math.abs(d[2] - px[0][2]) < 24; });
      return same ? '#' + [0, 1, 2].map(function (i) { return ('0' + px[0][i].toString(16)).slice(-2); }).join('') : '';
    });
    logoBgs[url].then(null, function () { delete logoBgs[url]; });
    return logoBgs[url];
  }
  /* looks once at each header logo the document has not looked at yet; -> Promise<true when something changed> */
  function detectLogoBg(doc) {
    var todo = (doc.sections || []).filter(function (s) { return s.kind === 'header' && s.props.mode !== 'text' && s.props.logo && s.props.logoBgOf !== s.props.logo; });
    return todo.reduce(function (p, s) {
      var url = s.props.logo;
      return p.then(function () {
        return logoBackground(url).then(function (bg) { return bg; }, function () { return ''; }).then(function (bg) {
          if (s.props.logo !== url) return;
          s.props.logoBg = bg; s.props.logoBgOf = url;
        });
      });
    }, Promise.resolve()).then(function () { return todo.length > 0; });
  }

  /* makes every picture of the mail that needs it mail-safe and puts it online (once: the result is kept
     in doc.assets under the picture's key). -> { failed: [job] } */
  function prepareImages(doc, kit, eventId, onStep) {
    return detectLogoBg(doc).then(function () { return prepareJobs(doc, kit, eventId, onStep); });
  }
  function prepareJobs(doc, kit, eventId, onStep) {
    var jobs = imageJobs(doc, kit), todo = [], keys = {};
    Object.keys(jobs).forEach(function (slot) {
      var j = jobs[slot];
      if (j.kind === 'as-is' || keys[j.key] || (doc.assets && doc.assets[j.key])) return;
      keys[j.key] = 1; j.slot = slot; todo.push(j);
    });
    doc.assets = doc.assets || {};
    var failed = [], i = 0;
    function next() {
      if (i >= todo.length) return Promise.resolve({ failed: failed });
      var j = todo[i++];
      if (onStep) onStep(i, todo.length);
      return draw(j, kit).then(function (blob) {
        var ext = { 'image/jpeg': 'jpg', 'image/gif': 'gif' }[blob.type] || 'png';
        var file = new File([blob], 'mailer-' + (j.slot.split(':')[1] || 'picture') + '.' + ext, { type: blob.type });
        return C().uploadImage(eventId, 'media', file);
      }).then(function (res) { doc.assets[j.key] = res.url; }, function (err) { j.error = err; failed.push(j); }).then(next);
    }
    return next();
  }

  /* ================================================================ the studio */
  var KINDS = {
    header: { label: 'Header', fields: [
      { k: 'layout', label: 'Layout', type: 'select', options: [['bar', 'Logo bar — the wordmark on the left, the hashtag on the right'], ['band', 'A band with the logo in the middle']] },
      { k: 'mode', label: 'Show', type: 'select', options: [['logo', 'A logo (the site’s logo unit)'], ['text', 'The event name, set in text']] },
      { k: 'logo', label: 'Logo', type: 'image', when: { mode: 'logo' }, hint: 'An SVG logo is turned into a PNG when you download or copy — mail clients cannot show SVG.' },
      { k: 'tone', label: 'The logo is drawn for', type: 'select', when: { mode: 'logo' }, options: [['dark', 'A dark background'], ['light', 'A light background'], ['', 'I am not sure']] },
      { k: 'before', label: 'Name, before the key word', when: { mode: 'text' } },
      { k: 'keyword', label: 'Key word (in the accent colour)', when: { mode: 'text' } },
      { k: 'after', label: 'Name, after the key word', when: { mode: 'text' } },
      { k: 'band', label: 'Band colour', type: 'select', when: { layout: 'band' }, options: [['auto', 'Automatic (fits the logo)'], ['theme', 'Theme colour'], ['background', 'Mail background'], ['white', 'White'], ['black', 'Near black']] },
      { k: 'note', label: 'Hashtag', hint: 'Shown beside the logo (or under it, in a band). Leave empty for none.' }
    ] },
    hero: { label: 'Hero', fields: [
      { k: 'layout', label: 'Layout', type: 'select', options: [['title', 'Picture, then a title block'], ['strip', 'Picture, then name | button | date'], ['centred', 'Picture, then a centred title'], ['banner', 'The picture alone, a button under it']] },
      { k: 'imageUrl', label: 'Picture', type: 'image', hint: 'The site’s hero picture by default. Leave empty for a band of the theme colour.' },
      { k: 'crop', label: 'Shape', type: 'select', when: { imageUrl: true }, options: [['wide', 'Banner (2 : 1)'], ['cinema', 'Wide (16 : 9)'], ['none', 'As the picture is']] },
      { k: 'focus', label: 'Keep', type: 'select', when: { imageUrl: true }, options: [['center', 'The middle'], ['top', 'The top'], ['bottom', 'The bottom']] },
      { k: 'alt', label: 'Picture description (alt text)', when: { imageUrl: true }, hint: 'Read out by screen readers and shown when pictures are off.' },
      { k: 'eyebrow', label: 'Small line above the title' },
      { k: 'title', label: 'Title' },
      { k: 'date', label: 'Date' },
      { k: 'place', label: 'Place' },
      { k: 'text', label: 'Line under the title', type: 'textarea', rows: 2 },
      { k: 'ctaLabel', label: 'Button text', hint: 'Leave empty for no button.' },
      { k: 'ctaUrl', label: 'Button link', type: 'url' },
      { k: 'align', label: 'Alignment', type: 'select', when: { layout: 'centred' }, options: [['center', 'Centred'], ['left', 'Left']] }
    ] },
    intro: { label: 'Overview', fields: [
      { k: 'layout', label: 'Layout', type: 'select', options: [['plain', 'Text'], ['side', 'Text with a list beside it']] },
      { k: 'heading', label: 'Heading' },
      { k: 'text', label: 'Text', type: 'textarea', ai: 'intro', rows: 9, hint: 'A blank line starts a new paragraph. **Bold** and [a link](https://…) work.' },
      { k: 'align', label: 'Alignment', type: 'select', when: { layout: 'plain' }, options: [['center', 'Centred'], ['left', 'Left']] },
      { k: 'sideHeading', label: 'Heading of the list beside it', when: { layout: 'side' } },
      { k: 'sideItems', label: 'The list beside it', type: 'list', one: 'item', item: [{ k: 'text', label: 'Text' }], source: 'lists', when: { layout: 'side' } }
    ] },
    facts: { label: 'Key facts', fields: [
      { k: 'heading', label: 'Heading' },
      { k: 'items', label: 'Facts', type: 'list', one: 'fact', item: [{ k: 'label', label: 'Label' }, { k: 'value', label: 'Value' }] }
    ] },
    stats: { label: 'Numbers', fields: [
      { k: 'layout', label: 'Layout', type: 'select', options: STAT_LAYOUTS },
      { k: 'heading', label: 'Heading' },
      { k: 'items', label: 'Numbers', type: 'list', one: 'number', item: [{ k: 'value', label: 'Number', hint: 'For example 300+' }, { k: 'label', label: 'What it counts' }], source: 'stats' }
    ] },
    list: { label: 'List', fields: [
      { k: 'heading', label: 'Heading' },
      { k: 'layout', label: 'Layout', type: 'select', options: LIST_LAYOUTS },
      { k: 'tileCols', label: 'Tiles across', type: 'select', when: { layout: 'tiles' }, options: [['', 'Automatic'], ['2', '2'], ['3', '3']] },
      { k: 'items', label: 'Items', type: 'list', one: 'item', item: [{ k: 'text', label: 'Text' }], source: 'lists' }
    ] },
    speakers: { label: 'Speakers', fields: [
      { k: 'heading', label: 'Heading' },
      { k: 'text', label: 'Text above the speakers', type: 'textarea', rows: 3 },
      { k: 'layout', label: 'Layout', type: 'select', options: SPEAKER_LAYOUTS },
      { k: 'cols', label: 'Across', type: 'select', options: [['', 'The layout’s own'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] },
      { k: 'max', label: 'Show at most', type: 'select', options: [['', 'All of them'], ['3', '3'], ['4', '4'], ['6', '6'], ['8', '8'], ['12', '12']] },
      { k: 'shape', label: 'Photo shape', type: 'select', when: { layout: ['cards', 'feature', 'side'] }, options: [['rounded', 'Rounded'], ['square', 'Square'], ['circle', 'Circle']] },
      { k: 'showRole', label: 'Designation', type: 'select', options: [['yes', 'Show'], ['no', 'Hide']] },
      { k: 'showCompany', label: 'Company', type: 'select', options: [['yes', 'Show'], ['no', 'Hide']] },
      { k: 'items', label: 'Speakers', type: 'list', one: 'speaker', source: 'speakers', item: [{ k: 'name', label: 'Name' }, { k: 'role', label: 'Designation' }, { k: 'company', label: 'Company' }, { k: 'photo', label: 'Photo', type: 'image' }] },
      { k: 'note', label: 'Line under the speakers' }
    ] },
    agenda: { label: 'Agenda', fields: [
      { k: 'heading', label: 'Heading' },
      { k: 'items', label: 'Sessions', type: 'list', one: 'session', source: 'sessions', item: [{ k: 'day', label: 'Day' }, { k: 'time', label: 'Time' }, { k: 'title', label: 'Title' }, { k: 'who', label: 'Speakers' }] }
    ] },
    partners: { label: 'Partners', fields: [
      { k: 'heading', label: 'Heading' },
      { k: 'layout', label: 'Layout', type: 'select', options: PARTNER_LAYOUTS },
      { k: 'logoSize', label: 'Logo size', type: 'select', options: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] },
      { k: 'showTier', label: 'Tier labels', type: 'select', options: [['yes', 'Show'], ['no', 'Hide']] },
      { k: 'showNames', label: 'Names under the logos', type: 'select', options: [['no', 'No'], ['yes', 'Yes']] },
      { k: 'max', label: 'Show at most', type: 'select', options: [['', 'All of them'], ['4', '4'], ['8', '8'], ['12', '12'], ['16', '16']] },
      { k: 'items', label: 'Partners', type: 'list', one: 'partner', source: 'partners', item: [{ k: 'tier', label: 'Tier', hint: 'Partners with the same tier are shown together.' }, { k: 'name', label: 'Name' }, { k: 'logo', label: 'Logo', type: 'image' }, { k: 'url', label: 'Link', type: 'url' }] }
    ] },
    cta: { label: 'Call to action', fields: [
      { k: 'heading', label: 'Heading' },
      { k: 'text', label: 'Text', type: 'textarea', rows: 3 },
      { k: 'label', label: 'Button text' },
      { k: 'url', label: 'Button link', type: 'url' }
    ] },
    contacts: { label: 'Contacts', fields: [
      { k: 'heading', label: 'Heading' },
      { k: 'items', label: 'Contacts', type: 'list', one: 'contact', source: 'contacts', item: [{ k: 'label', label: 'For', hint: 'For example Sponsorship' }, { k: 'name', label: 'Name' }, { k: 'email', label: 'E-mail' }, { k: 'phone', label: 'Phone' }] }
    ] },
    text: { label: 'Text', fields: [
      { k: 'heading', label: 'Heading' },
      { k: 'text', label: 'Text', type: 'textarea', ai: 'intro', rows: 9, hint: 'A blank line starts a new paragraph. **Bold** and [a link](https://…) work.' },
      { k: 'ctaLabel', label: 'Button text', hint: 'Leave empty for no button.' },
      { k: 'ctaUrl', label: 'Button link', type: 'url' },
      { k: 'align', label: 'Alignment', type: 'select', options: [['left', 'Left'], ['center', 'Centred']] }
    ] },
    image: { label: 'Picture', fields: [
      { k: 'url', label: 'Picture', type: 'image' },
      { k: 'alt', label: 'Picture description (alt text)' },
      { k: 'caption', label: 'Caption' },
      { k: 'link', label: 'Link', type: 'url' },
      { k: 'full', label: 'Width', type: 'select', options: [['no', 'Inside the margins'], ['yes', 'Edge to edge']] }
    ] },
    divider: { label: 'Divider', fields: [] },
    footer: { label: 'Footer', fields: [
      { k: 'name', label: 'Event name' },
      { k: 'when', label: 'Date and place' },
      { k: 'siteUrl', label: 'Site link', type: 'url' },
      { k: 'social', label: 'Social links', type: 'list', one: 'link', item: [{ k: 'label', label: 'Name' }, { k: 'url', label: 'Link', type: 'url' }] },
      { k: 'contactLine', label: 'Contact line', hint: '[label](mailto:…) makes a link.' },
      { k: 'portal', label: 'Sent by (the portal)', hint: 'Named in the legal line, as ET’s sending tool expects (#portal_name).' },
      { k: 'sender', label: 'Address line', hint: 'Follows the portal’s name.' },
      { k: 'reason', label: 'Why the reader gets this mail (optional)', type: 'textarea', rows: 2 },
      { k: 'unsubscribeLabel', label: 'Unsubscribe link text' },
      { k: 'unsubscribe', label: 'Unsubscribe link', type: 'select', options: [[ESP_UNSUB, 'ET’s sending tool — ' + ESP_UNSUB], ['{{unsubscribe}}', 'Another tool — {{unsubscribe}}']] }
    ] }
  };
  var ADDABLE = ['intro', 'text', 'facts', 'stats', 'list', 'speakers', 'agenda', 'partners', 'cta', 'contacts', 'image', 'divider', 'hero', 'header', 'footer'];
  /* the layout a section has when none is chosen (the house layout of its kind) */
  var LAYOUT_DEFAULT = { header: 'band', hero: 'centred', intro: 'plain', stats: 'band', list: 'ticks', speakers: 'cards', partners: 'white' };

  function summaryOf(s) {
    var pr = s.props || {};
    var t = pr.heading || pr.title || pr.eyebrow || pr.name || '';
    if (s.kind === 'header') t = pr.mode === 'text' ? [pr.before, pr.keyword, pr.after].join(' ') : 'Logo';
    if (pr.items && pr.items.length) t = (t ? t + ' · ' : '') + pr.items.length + ' ' + (pr.items.length === 1 ? 'row' : 'rows');
    if (s.kind === 'image') t = pr.alt || (pr.url ? 'Picture' : '');
    return str(t).replace(/\s+/g, ' ').trim();
  }

  var PALETTE_KEYS = [['theme', 'Theme'], ['accent', 'Accent'], ['background', 'Background'], ['surface', 'Panels'], ['text', 'Text'], ['muted', 'Quiet text']];
  var MAX_SAVED = 20000;

  function mount(root, mctx) {
    mctx = mctx || {};
    var kit = mctx.kit || {}, eventId = String(mctx.eventId || (kit.event && kit.event.id) || '');
    var toast = mctx.toast || function (m, k) { C().toast(m, k); };
    P().use(eventId);
    var S = { doc: null, savedId: '', name: '', dirty: false, saved: [], savedErr: '', undo: [], sel: '', tab: 'mail', width: 'desktop',
      busy: '', report: null, pv: {}, broken: {}, subjects: null, openRow: '', detecting: null, lastPush: 0, lastPushKey: '', renderTimer: 0, picks: '', gen: 0 };
    var uid = 0;

    root.innerHTML =
      '<div class="pm" data-pm>' +
        '<div class="pm-top">' +
          '<div class="pm-docname"><label class="pm-sr" for="pm-name">Mailer name</label><input id="pm-name" class="inp pm-name" maxlength="120" placeholder="Name this mailer">' +
            '<span class="pm-state" data-state></span></div>' +
          '<div class="pm-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="undo" title="Undo the last change (Ctrl/Cmd+Z)">Undo</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-act="save">Save</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-act="copy">Copy HTML</button>' +
            '<button type="button" class="btn btn-primary btn-sm" data-act="download">Download .html</button>' +
            '<span class="pm-send" title="Sending from Revamp is not available yet — download the HTML and send it from your e-mail tool."><button type="button" class="btn btn-secondary btn-sm" disabled aria-describedby="pm-send-note">Send</button></span>' +
          '</div>' +
        '</div>' +
        '<p class="pm-sendnote" id="pm-send-note">Sending from Revamp is not available yet — download the HTML and send it from your e-mail tool. ' +
          'Its unsubscribe link is ET’s sending-tool token ' + ESP_UNSUB + ' (another tool’s can be chosen in the footer).</p>' +
        '<div class="pm-body">' +
          '<aside class="pm-left" data-left></aside>' +
          '<section class="pm-centre">' +
            '<div class="pm-stagebar">' +
              '<div class="seg" role="group" aria-label="Preview width"><button type="button" data-width="desktop" aria-pressed="true">Desktop</button><button type="button" data-width="mobile" aria-pressed="false">Mobile</button></div>' +
              '<span class="pm-size" data-size></span><span class="pm-busy" data-busy role="status" aria-live="polite"></span>' +
            '</div>' +
            '<div class="pm-checks" data-checks></div>' +
            '<div class="pm-stage" data-stage><div class="pm-frame" data-framebox><iframe title="Mail preview" data-frame></iframe></div></div>' +
          '</section>' +
          '<aside class="pm-right" data-right></aside>' +
        '</div>' +
      '</div>';

    var el = {
      root: root.querySelector('[data-pm]'), left: root.querySelector('[data-left]'), right: root.querySelector('[data-right]'),
      stage: root.querySelector('[data-stage]'), box: root.querySelector('[data-framebox]'), frame: root.querySelector('[data-frame]'),
      name: root.querySelector('#pm-name'), state: root.querySelector('[data-state]'), size: root.querySelector('[data-size]'),
      busy: root.querySelector('[data-busy]'), checks: root.querySelector('[data-checks]')
    };

    /* ---------------- document state ---------------- */
    function sec(id) { return (S.doc.sections || []).filter(function (s) { return s.id === id; })[0] || null; }
    function setDirty(d) {
      S.dirty = d;
      el.state.textContent = !S.doc ? '' : d ? 'Unsaved changes' : (S.savedId ? 'Saved' : 'Not saved yet');
      el.state.className = 'pm-state' + (d ? ' is-dirty' : '');
    }
    /* one undo step per burst of typing in one field, one per structural change */
    function remember(key) {
      var now = Date.now();
      if (key && key === S.lastPushKey && now - S.lastPush < 1200) { S.lastPush = now; return; }
      S.undo.push(JSON.stringify({ doc: S.doc, sel: S.sel }));
      if (S.undo.length > 40) S.undo.shift();
      S.lastPush = now; S.lastPushKey = key || '';
    }
    function changed(key, structural) {
      setDirty(true);
      schedule(structural ? 0 : 220);
      if (structural) drawRightKeepScroll();
    }
    function undo() {
      var last = S.undo.pop();
      if (!last) { toast('Nothing to undo.', 'info'); return; }
      var x = JSON.parse(last);
      S.doc = x.doc; S.sel = x.sel && sec(x.sel) ? x.sel : '';
      S.lastPushKey = '';
      setDirty(true); drawRight(); schedule(0);
    }
    function openDoc(doc, savedId, name) {
      S.doc = doc; S.savedId = savedId || ''; S.name = name || ''; S.undo = []; S.sel = ''; S.tab = 'mail'; S.subjects = null; S.gen += 1;
      el.name.value = S.name;
      setDirty(false);
      drawLeft(); drawRight(); schedule(0);
    }
    function newDoc(type) {
      var doc = build(type, kit);
      openDoc(doc, '', typeOf(type).label + ' — ' + str(kit.event && kit.event.name));
    }
    /* a saved Reminder says how many days are left on the day it was made: on reopening, its countdown is
       checked against today and can be brought up to date in one step */
    function checkCountdown() {
      var n = daysToGo(kit), a = availability('reminder', kit);
      if (!a.ok) { toast('This reminder counts down to the event, but ' + a.reason.charAt(0).toLowerCase() + a.reason.slice(1) + ' Check its title and subject before you send it.', 'error'); return; }
      var heroes = S.doc.sections.filter(function (x) { return x.kind === 'hero' && countIn(x.props.title) != null && countIn(x.props.title) !== n; });
      var subOld = countIn(S.doc.subject);
      if (!heroes.length && (subOld == null || subOld === n)) return;
      var gen = S.gen;
      toast('This reminder was made for an earlier day — it does not say “' + countTitle(n) + '”.', { kind: 'info', action: { label: 'Update the countdown', onClick: function () {
        if (S.gen !== gen) return;
        remember();
        S.doc.sections.forEach(function (x) { if (x.kind === 'hero' && countIn(x.props.title) != null) x.props.title = countTitle(n); });
        if (countIn(S.doc.subject) != null) S.doc.subject = countSubject(n) + S.doc.subject.replace(/^(\d+ days to go|Today|Tomorrow):\s*/, '');
        changed('countdown', true);
      } } });
    }
    function confirmLeave() { return !S.dirty || window.confirm('This mailer has unsaved changes. Leave it without saving?'); }

    /* ---------------- left: types and saved mailers ---------------- */
    function drawLeft() {
      var cur = S.doc && !S.savedId ? S.doc.type : '';
      var types = TYPES.map(function (t) {
        var a = availability(t.id, kit);
        return '<li><button type="button" class="pm-type' + (cur === t.id ? ' is-on' : '') + '" data-type="' + t.id + '"' + (a.ok ? '' : ' disabled aria-disabled="true"') + '>' +
          '<b>' + esc(t.label) + '</b><span>' + esc(a.ok ? t.blurb : a.reason) + '</span></button>' +
          (!a.ok && a.href ? '<a class="pm-fix" href="' + esc(a.href) + '">' + esc(a.action || 'Fix this') + ' →</a>' : '') + '</li>';
      }).join('');
      var saved = S.savedErr ? '<p class="pm-muted">' + esc(S.savedErr) + '</p>' :
        !S.saved.length ? '<p class="pm-muted">Mailers you save appear here.</p>' :
        '<ul class="pm-saved">' + S.saved.map(function (it) {
          var t = typeOf(it.config && it.config.type);
          return '<li class="' + (it.id === S.savedId ? 'is-on' : '') + '"><button type="button" class="pm-open" data-open="' + esc(it.id) + '"><b>' + esc(it.name) + '</b>' +
            '<span>' + esc(t.label) + (it.updatedAt ? ' · ' + esc(C().fmtDate ? C().fmtDate(it.updatedAt) : String(it.updatedAt).slice(0, 10)) : '') + '</span></button>' +
            '<button type="button" class="pm-del" data-del="' + esc(it.id) + '" aria-label="Delete ' + esc(it.name) + '" title="Delete">&times;</button></li>';
        }).join('') + '</ul>';
      el.left.innerHTML = '<h3 class="pm-h">New mailer</h3><ul class="pm-types">' + types + '</ul><h3 class="pm-h">Saved mailers</h3>' + saved;
    }
    function loadSaved() {
      return P().list('email').then(function (items) { S.saved = items; S.savedErr = ''; drawLeft(); }, function (err) {
        S.savedErr = 'Saved mailers could not be loaded: ' + err.message; drawLeft();
      });
    }

    /* ---------------- right: the mail's settings and the selected section ---------------- */
    /* a field shown only for some choices: when: { key: value | [values] | true (filled) }; a choice not made
       yet counts as the kind's default */
    function fieldShown(f, props, kind) {
      if (!f.when) return true;
      return Object.keys(f.when).every(function (k) {
        if (f.when[k] === true) return !!str(props[k]).trim();
        var v = str(props[k] || (k === 'mode' ? 'logo' : k === 'layout' ? LAYOUT_DEFAULT[kind] || '' : ''));
        if (k === 'layout' && kind === 'list' && !props.layout) v = listLayout(props, (props.items || []).length);
        return Array.isArray(f.when[k]) ? f.when[k].indexOf(v) !== -1 : v === f.when[k];
      });
    }
    function control(f, val, path) {
      var id = 'pmf' + (++uid), v = str(val);
      var hint = f.hint ? '<p class="hint">' + esc(f.hint) + '</p>' : '';
      var input;
      if (f.type === 'textarea') input = '<textarea id="' + id + '" class="inp" rows="' + (f.rows || 4) + '" data-path="' + path + '">' + esc(v) + '</textarea>';
      else if (f.type === 'select') input = '<select id="' + id + '" class="inp" data-path="' + path + '">' + f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      else if (f.type === 'image') {
        input = '<div class="pm-img"><span class="pm-thumb">' + (v ? '<img src="' + esc(v) + '" alt="">' : '<i>None</i>') + '</span>' +
          '<div class="pm-imgctl"><input id="' + id + '" class="inp" type="url" placeholder="https://…" value="' + esc(v) + '" data-path="' + path + '">' +
          '<div class="pm-imgbtns"><button type="button" class="btn btn-ghost btn-sm" data-pick="' + path + '">Site pictures</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-upload="' + path + '">Upload…</button>' +
          (v ? '<button type="button" class="btn btn-ghost btn-sm" data-clear="' + path + '">Remove</button>' : '') + '</div></div></div>' +
          (S.picks === path ? picker(path) : '');
      } else input = '<input id="' + id + '" class="inp" type="' + (f.type === 'url' ? 'url' : 'text') + '" value="' + esc(v) + '" data-path="' + path + '"' + (f.type === 'url' ? ' placeholder="https://…"' : '') + '>';
      var ai = f.ai ? '<button type="button" class="btn btn-ghost btn-sm pm-ai" data-ai="' + path + '">Write with AI</button>' : '';
      return '<div class="field pm-field"><label for="' + id + '">' + esc(f.label) + ai + '</label>' + input + hint + '</div>';
    }
    function picker(path) {
      var br = kit.brand || {}, seen = {}, pics = [br.heroImageUrl, br.eventLogoUrl, br.logoUnit && br.logoUnit.url].concat(br.pictures || [])
        .concat(((kit.content || {}).speakers || []).map(function (s) { return s.photoUrl; }))
        .concat(((kit.content || {}).partners || []).map(function (s) { return s.logoUrl; }))
        .filter(function (u) { if (!u || seen[u]) return false; seen[u] = 1; return true; });
      if (!pics.length) return '<p class="pm-muted pm-pickbox">The site has no pictures yet. Upload one instead.</p>';
      return '<div class="pm-pickbox">' + pics.map(function (u) { return '<button type="button" class="pm-pic" data-use="' + esc(u) + '" data-for="' + path + '"><img src="' + esc(u) + '" alt=""></button>'; }).join('') + '</div>';
    }
    function sourceOptions(s, f) {
      var ct = kit.content || {}, used = {}, opts = [];
      (s.props[f.k] || []).forEach(function (it) { if (it.ref) used[it.ref] = 1; if (it.text) used['t:' + it.text] = 1; });
      if (f.source === 'speakers') opts = (ct.speakers || []).map(function (x) { return [x.id, x.name + (x.company ? ' — ' + x.company : '')]; });
      if (f.source === 'partners') opts = (ct.partners || []).map(function (x) { return [x.id, x.name + (x.tier ? ' (' + x.tier + ')' : '')]; });
      if (f.source === 'sessions') opts = sessionRows(kit).map(function (x) { return [x.ref, (x.day ? x.day + ' · ' : '') + (x.time ? x.time + ' · ' : '') + x.title]; });
      if (f.source === 'contacts') opts = (ct.contacts || []).map(function (x, i) { return ['c' + i, (x.label ? x.label + ': ' : '') + (x.name || x.email)]; });
      if (f.source === 'stats') opts = (ct.stats || []).map(function (x, i) { return ['n' + i, x.value + ' ' + x.label]; });
      if (f.source === 'lists') {
        opts = (ct.topics || []).map(function (t) { return ['t:' + t, 'Topic: ' + t]; }).concat((ct.audience || []).map(function (t) { return ['t:' + t, 'Audience: ' + t]; }));
      }
      return opts.filter(function (o) { return !used[o[0]]; });
    }
    function listEditor(s, f) {
      var items = s.props[f.k] || [], base = 'props.' + f.k;
      var rows = items.map(function (it, i) {
        var title = it.name || it.title || it.text || it.value || it.label || ('New ' + f.one);
        return '<details class="pm-rowcard"' + (S.openRow === s.id + ':' + f.k + ':' + i ? ' open' : '') + ' data-rowkey="' + s.id + ':' + f.k + ':' + i + '">' +
          '<summary><span class="pm-rowt">' + esc(title) + '</span><span class="pm-rowbtns">' +
          '<button type="button" data-row="up" data-list="' + f.k + '" data-i="' + i + '" aria-label="Move up" title="Move up"' + (i ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" data-row="down" data-list="' + f.k + '" data-i="' + i + '" aria-label="Move down" title="Move down"' + (i < items.length - 1 ? '' : ' disabled') + '>↓</button>' +
          '<button type="button" data-row="remove" data-list="' + f.k + '" data-i="' + i + '" aria-label="Remove" title="Remove">&times;</button></span></summary>' +
          '<div class="pm-rowbody">' + f.item.map(function (sub) { return control(sub, it[sub.k], base + '.' + i + '.' + sub.k); }).join('') + '</div></details>';
      }).join('');
      var src = f.source ? sourceOptions(s, f) : [];
      var add = '<div class="pm-rowadd">' +
        (src.length ? '<select class="inp" data-addfrom="' + f.k + '" aria-label="Add from the event"><option value="">Add from the event…</option>' + src.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') + '</select>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-addall="' + f.k + '">Add all (' + src.length + ')</button>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" data-addrow="' + f.k + '">Add a blank ' + esc(f.one) + '</button></div>';
      return '<div class="field pm-field"><span class="flabel">' + esc(f.label) + ' <small class="pm-count">' + items.length + '</small></span>' +
        (items.length ? '<div class="pm-rows">' + rows + '</div>' : '<p class="pm-muted">None yet.</p>') + add + '</div>';
    }
    function rowFromSource(f, key) {
      var ct = kit.content || {};
      if (f.source === 'speakers') { var sp = (ct.speakers || []).filter(function (x) { return x.id === key; })[0]; return sp && speakerRow(sp); }
      if (f.source === 'partners') { var pa = (ct.partners || []).filter(function (x) { return x.id === key; })[0]; return pa && partnerRow(pa); }
      if (f.source === 'sessions') return sessionRows(kit).filter(function (x) { return x.ref === key; })[0];
      if (f.source === 'contacts') { var co = (ct.contacts || [])[+key.slice(1)]; return co && contactRow(co); }
      if (f.source === 'stats') { var st = (ct.stats || [])[+key.slice(1)]; return st && { value: str(st.value), label: str(st.label) }; }
      if (f.source === 'lists') return { text: key.slice(2) };
      return null;
    }

    function drawRight() {
      if (!S.doc) { el.right.innerHTML = ''; return; }
      var s = S.sel && sec(S.sel);
      if (S.tab === 'section' && !s) S.tab = 'mail';
      var tabs = '<div class="pm-tabs" role="tablist"><button type="button" role="tab" data-tab="mail" aria-selected="' + (S.tab === 'mail') + '">Mail</button>' +
        '<button type="button" role="tab" data-tab="section" aria-selected="' + (S.tab === 'section') + '"' + (s ? '' : ' disabled') + '>' + esc(s ? (KINDS[s.kind] || {}).label || s.kind : 'Section') + '</button></div>';
      el.right.innerHTML = tabs + '<div class="pm-panel">' + (S.tab === 'section' && s ? sectionPanel(s) : mailPanel()) + '</div>';
    }
    function mailPanel() {
      var d = S.doc, kc = (kit.brand && kit.brand.colours) || {};
      var subjects = S.subjects === 'busy' ? '<p class="pm-muted">Writing subject lines…</p>' :
        S.subjects && S.subjects.length ? '<div class="pm-subjects" role="list">' + S.subjects.map(function (o, i) {
          return '<button type="button" role="listitem" data-subject="' + i + '"><b>' + esc(o.subject) + '</b>' + (o.preheader ? '<span>' + esc(o.preheader) + '</span>' : '') + '</button>';
        }).join('') + '</div>' : '';
      var sw = PALETTE_KEYS.map(function (k) {
        var v = hexOf(d.palette[k[0]], '#000000'), site = hexOf(kc[k[0]], '');
        return '<label class="pm-swatch"><input type="color" value="' + v + '" data-colour="' + k[0] + '"><span><b>' + k[1] + '</b><i>' + v + (site && site !== v ? ' · site ' + site : '') + '</i></span></label>';
      }).join('');
      var secs = d.sections.map(function (s, i) {
        var k = KINDS[s.kind] || { label: s.kind }, empty = isEmpty(s, kit);
        return '<li class="pm-sec' + (s.hidden ? ' is-hidden' : '') + (s.id === S.sel ? ' is-on' : '') + '" draggable="true" data-drag="' + s.id + '">' +
          '<span class="pm-grip" aria-hidden="true" title="Drag to move">&#8942;&#8942;</span>' +
          '<button type="button" class="pm-secname" data-select="' + s.id + '"><b>' + esc(k.label) + '</b><span>' + esc(s.hidden ? 'Hidden' : empty ? 'Empty — left out' : summaryOf(s)) + '</span></button>' +
          '<span class="pm-secbtns">' +
          '<button type="button" data-move="up" data-id="' + s.id + '" aria-label="Move ' + esc(k.label) + ' up" title="Move up"' + (i ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" data-move="down" data-id="' + s.id + '" aria-label="Move ' + esc(k.label) + ' down" title="Move down"' + (i < d.sections.length - 1 ? '' : ' disabled') + '>↓</button>' +
          '<button type="button" data-dup="' + s.id + '" aria-label="Duplicate ' + esc(k.label) + '" title="Duplicate">⧉</button>' +
          '<button type="button" data-hide="' + s.id + '" aria-label="' + (s.hidden ? 'Show ' : 'Hide ') + esc(k.label) + '" title="' + (s.hidden ? 'Show' : 'Hide') + '">' + (s.hidden ? 'Show' : 'Hide') + '</button>' +
          '<button type="button" data-remove="' + s.id + '" aria-label="Remove ' + esc(k.label) + '" title="Remove">&times;</button></span></li>';
      }).join('');
      return '<section class="pm-group"><h4>Message</h4>' +
        '<div class="field pm-field"><label for="pm-subject">Subject <span class="pm-count" data-subjectcount>' + str(d.subject).length + '</span>' +
          '<button type="button" class="btn btn-ghost btn-sm pm-ai" data-act="subjects">Suggest subjects</button></label>' +
          '<input id="pm-subject" class="inp" maxlength="200" value="' + esc(d.subject) + '" data-path="doc.subject">' +
          '<p class="hint">Under about 60 characters shows in full in most inboxes.</p></div>' + subjects +
        '<div class="field pm-field"><label for="pm-pre">Preview text</label><input id="pm-pre" class="inp" maxlength="200" value="' + esc(d.preheader) + '" data-path="doc.preheader">' +
          '<p class="hint">Shown after the subject in the inbox; hidden in the mail itself.</p></div></section>' +
        '<section class="pm-group"><h4>Look</h4>' +
          '<div class="pm-presets" role="group" aria-label="Mail colours">' +
            '<button type="button" class="btn btn-sm btn-secondary" data-preset="site">Match the site</button>' +
            '<button type="button" class="btn btn-sm btn-secondary" data-preset="light">Light</button>' +
            '<button type="button" class="btn btn-sm btn-secondary" data-preset="dark">Dark</button></div>' +
          '<div class="field pm-field"><label for="pm-font">Type</label><select id="pm-font" class="inp" data-path="doc.font">' +
            [['house', 'ET house — Verdana, no web fonts'], ['site', 'The site’s own fonts (some inboxes show a fallback)']].map(function (o) { return '<option value="' + o[0] + '"' + ((d.font === 'site' ? 'site' : 'house') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>' +
          '<div class="field pm-field"><label for="pm-heads">Section labels</label><select id="pm-heads" class="inp" data-path="doc.headings">' +
            [['caps', 'In capitals — OVERVIEW (the house style)'], ['title', 'As written — Overview']].map(function (o) { return '<option value="' + o[0] + '"' + ((d.headings === 'title' ? 'title' : 'caps') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>' +
          '<div class="pm-btnrow"><label class="pm-swatch"><input type="color" value="' + hexOf(d.btnColour, derive(d, kit).btn) + '" data-btncolour><span><b>Buttons</b><i>' + (hexOf(d.btnColour, '') || 'the mail’s own') + '</i></span></label>' +
            '<div class="field pm-field"><label for="pm-corners">Corners</label><select id="pm-corners" class="inp" data-path="doc.btnRadius">' +
            [['0', 'Square'], ['4', 'Slightly rounded'], ['8', 'Rounded (house)'], ['99', 'Pill']].map(function (o) { return '<option value="' + o[0] + '"' + (str(d.btnRadius || '8') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
            (d.btnColour ? '<button type="button" class="btn btn-ghost btn-sm" data-act="btnreset">Reset</button>' : '') + '</div>' +
          '<p class="hint">The words on a button are coloured for you, so they stay readable on any fill.</p></section>' +
        '<section class="pm-group"><h4>Colours <button type="button" class="btn btn-ghost btn-sm" data-act="resetcolours">Reset to site theme</button></h4>' +
          '<div class="pm-swatches">' + sw + '</div><p class="hint">Text colours are adjusted automatically so every word stays readable (WCAG AA).</p></section>' +
        '<section class="pm-group"><h4>Sections</h4><ul class="pm-secs">' + secs + '</ul>' +
          '<select class="inp" data-addsec aria-label="Add a section"><option value="">Add a section…</option>' + ADDABLE.map(function (k) { return '<option value="' + k + '">' + esc(KINDS[k].label) + '</option>'; }).join('') + '</select></section>';
    }
    function sectionPanel(s) {
      var k = KINDS[s.kind] || { label: s.kind, fields: [] };
      var fields = k.fields.filter(function (f) { return fieldShown(f, s.props, s.kind); }).map(function (f) {
        var v = s.props[f.k];
        if (f.k === 'layout' && !v) v = s.kind === 'list' ? listLayout(s.props, (s.props.items || []).length) : LAYOUT_DEFAULT[s.kind] || '';
        return f.type === 'list' ? listEditor(s, f) : control(f, v, 'props.' + f.k);
      }).join('');
      var empty = isEmpty(s, kit) ? '<p class="pm-note">This section is empty, so it is left out of the mail until you fill it in.</p>' : '';
      return '<div class="pm-sechead"><button type="button" class="btn btn-ghost btn-sm" data-tab="mail">← All sections</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-hide="' + s.id + '">' + (s.hidden ? 'Show' : 'Hide') + '</button></div>' +
        (s.hidden ? '<p class="pm-note">Hidden — it is not in the mail.</p>' : '') + empty +
        (fields || '<p class="pm-muted">A divider has nothing to set.</p>');
    }

    /* ---------------- reading and writing fields ---------------- */
    function getPath(obj, parts) { for (var i = 0; i < parts.length; i++) { if (obj == null) return undefined; obj = obj[parts[i]]; } return obj; }
    function setField(path, value) {
      var parts = path.split('.');
      if (parts[0] === 'doc') { S.doc[parts[1]] = value; return; }
      var s = sec(S.sel);
      if (!s) return;
      var o = s, i;
      for (i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = value;
    }
    /* where a value that arrives later (an upload, the AI's text) goes: the field of the section selected
       when it was asked for — not of whatever is selected when it arrives. -> a function(value) that writes
       it (one undo step) and returns that section (true for a doc field), or null when the mailer, the
       section or the row is no longer there. */
    function fieldTarget(path) {
      var parts = path.split('.'), key = parts[parts.length - 1], gen = S.gen;
      if (parts[0] === 'doc') return function (value) { if (S.gen !== gen) return null; remember(); S.doc[key] = value; return true; };
      var id = S.sel, s0 = sec(id), holder = s0 ? getPath(s0, parts.slice(0, -1)) : null;
      return function (value) {
        var s = S.gen === gen ? sec(id) : null;
        if (!s || !holder) return null;
        /* the same object while it is in the mail (a row may have moved); after an undo the section's own
           props by its id — a list row cannot be found again then, so its value is dropped */
        var h = holder === s.props || Object.keys(s.props).some(function (k) { return Array.isArray(s.props[k]) && s.props[k].indexOf(holder) !== -1; }) ? holder :
          parts.length === 2 && parts[0] === 'props' ? s.props : null;
        if (!h) return null;
        remember(); h[key] = value;
        return s;
      };
    }
    function fieldOf(s, key) { return (KINDS[s.kind].fields || []).filter(function (f) { return f.k === key; })[0]; }

    el.right.addEventListener('input', function (e) {
      var t = e.target, path = t.getAttribute('data-path');
      if (path && t.tagName !== 'SELECT') {
        remember(path);
        setField(path, t.value);
        if (path === 'doc.subject') { var c = el.right.querySelector('[data-subjectcount]'); if (c) c.textContent = t.value.length; }
        if (/\.(name|title|text|value|label)$/.test(path)) {
          var card = t.closest('.pm-rowcard'), tt = card && card.querySelector('.pm-rowt');
          if (tt && (card.querySelector('.pm-rowbody .pm-field input, .pm-rowbody .pm-field textarea') === t)) tt.textContent = t.value || '…';
        }
        changed(path, false);
      }
      if (t.hasAttribute('data-btncolour')) {
        remember('btncolour'); S.doc.btnColour = t.value;
        var bl = t.parentNode.querySelector('i'); if (bl) bl.textContent = t.value;
        changed('colours', false);
      }
      var col = t.getAttribute('data-colour');
      if (col) {
        remember('colour:' + col);
        S.doc.palette[col] = t.value;
        var lab = t.parentNode.querySelector('i'); if (lab) lab.textContent = t.value;
        changed('colour', false);
      }
    });
    el.right.addEventListener('change', function (e) {
      var t = e.target, path = t.getAttribute('data-path');
      if (path && t.tagName === 'SELECT') {
        remember(path); setField(path, t.value);
        /* a choice can show or hide other fields (header mode, hero picture) */
        changed(path, true);
        return;
      }
      if (path && t.type === 'url' && /imageUrl|logo|photo|url$/.test(path)) drawRightKeepScroll();
      if (t.hasAttribute('data-addsec') && t.value) {
        remember();
        var ns = makeSection(t.value, kit), at = S.doc.sections.length;
        var foot = S.doc.sections.map(function (x) { return x.kind; }).lastIndexOf('footer');
        var selAt = S.sel ? S.doc.sections.indexOf(sec(S.sel)) : -1;
        if (selAt >= 0 && S.doc.sections[selAt].kind !== 'footer') at = selAt + 1;
        else if (foot >= 0) at = foot;
        if (t.value === 'header') at = 0;
        if (t.value === 'footer') at = S.doc.sections.length;
        S.doc.sections.splice(at, 0, ns);
        S.sel = ns.id; S.tab = 'section';
        changed('add', true);
        var pane = el.right.querySelector('.pm-panel'); if (pane) pane.scrollTop = 0;
        return;
      }
      var from = t.getAttribute('data-addfrom');
      if (from && t.value) {
        var s = sec(S.sel), f = fieldOf(s, from), r = rowFromSource(f, t.value);
        if (r) { remember(); s.props[from] = (s.props[from] || []).concat([r]); changed('row', true); }
      }
    });
    /* the section list: drag a section to where it should go (an indicator shows where it will land) */
    var dragId = '';
    function clearDrop() { Array.prototype.forEach.call(el.right.querySelectorAll('.pm-sec'), function (x) { x.classList.remove('is-drag', 'drop-before', 'drop-after'); }); }
    el.right.addEventListener('dragstart', function (e) {
      var li = e.target.closest && e.target.closest('[data-drag]');
      if (!li) return;
      dragId = li.getAttribute('data-drag');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* some browsers refuse custom data */ }
      li.classList.add('is-drag');
    });
    el.right.addEventListener('dragover', function (e) {
      if (!dragId) return;
      var li = e.target.closest && e.target.closest('[data-drag]');
      if (!li) return;
      e.preventDefault();
      var r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      clearDrop(); li.classList.add(after ? 'drop-after' : 'drop-before');
    });
    el.right.addEventListener('drop', function (e) {
      if (!dragId) return;
      e.preventDefault();
      var li = e.target.closest && e.target.closest('[data-drag]'), to = li && li.getAttribute('data-drag'), after = li && li.classList.contains('drop-after');
      var list = S.doc.sections, from = list.indexOf(sec(dragId));
      if (to && to !== dragId && from >= 0) {
        remember();
        var item = list.splice(from, 1)[0];
        list.splice(list.indexOf(sec(to)) + (after ? 1 : 0), 0, item);
        changed('move', true);
      }
      dragId = ''; clearDrop();
    });
    el.right.addEventListener('dragend', function () { dragId = ''; clearDrop(); });

    function drawRightKeepScroll() {
      var panel = el.right.querySelector('.pm-panel'), top = panel ? panel.scrollTop : 0;
      drawRight();
      panel = el.right.querySelector('.pm-panel'); if (panel) panel.scrollTop = top;
    }
    el.right.addEventListener('toggle', function (e) {
      var d = e.target;
      if (d.classList && d.classList.contains('pm-rowcard')) { if (d.open) S.openRow = d.getAttribute('data-rowkey'); else if (S.openRow === d.getAttribute('data-rowkey')) S.openRow = ''; }
    }, true);

    el.right.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      var a;
      if ((a = b.getAttribute('data-tab'))) { S.tab = a; drawRight(); return; }
      if ((a = b.getAttribute('data-select'))) { select(a); return; }
      if ((a = b.getAttribute('data-move'))) {
        var id = b.getAttribute('data-id'), list = S.doc.sections, i = list.indexOf(sec(id)), j = a === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= list.length) return;
        remember(); list.splice(j, 0, list.splice(i, 1)[0]); changed('move', true); return;
      }
      if ((a = b.getAttribute('data-hide'))) { remember(); var hs = sec(a); hs.hidden = !hs.hidden; changed('hide', true); return; }
      if ((a = b.getAttribute('data-dup'))) {
        var ds = sec(a), copy = clone(ds);
        copy.id = sid();
        remember(); S.doc.sections.splice(S.doc.sections.indexOf(ds) + 1, 0, copy);
        S.sel = copy.id; changed('dup', true);
        toast((KINDS[ds.kind] || {}).label + ' duplicated.', { kind: 'info', action: { label: 'Undo', onClick: undo } });
        return;
      }
      if ((a = b.getAttribute('data-preset'))) {
        remember();
        var site = sitePalette(kit), pal = S.doc.palette;
        if (a === 'site') S.doc.palette = site;
        else if (a === 'light') { pal.background = '#ffffff'; pal.surface = mix('#ffffff', pal.theme, 0.06); pal.text = '#1b1d22'; pal.muted = '#5b616e'; }
        else { pal.background = mix('#0b0d12', pal.theme, 0.07); pal.surface = mix(pal.background, pal.theme, 0.14); pal.text = '#f4f4f6'; pal.muted = '#b9b4c2'; }
        changed('colours', true); return;
      }
      if ((a = b.getAttribute('data-remove'))) {
        var rs = sec(a);
        remember(); S.doc.sections.splice(S.doc.sections.indexOf(rs), 1);
        if (S.sel === a) { S.sel = ''; S.tab = 'mail'; }
        changed('remove', true);
        toast((KINDS[rs.kind] || {}).label + ' removed.', { kind: 'info', action: { label: 'Undo', onClick: undo } });
        return;
      }
      if ((a = b.getAttribute('data-row'))) {
        var s = sec(S.sel), key = b.getAttribute('data-list'), idx = +b.getAttribute('data-i'), items = s.props[key];
        e.preventDefault();
        remember();
        if (a === 'remove') items.splice(idx, 1);
        else { var to = a === 'up' ? idx - 1 : idx + 1; if (to < 0 || to >= items.length) return; items.splice(to, 0, items.splice(idx, 1)[0]); S.openRow = s.id + ':' + key + ':' + to; }
        changed('row', true); return;
      }
      if ((a = b.getAttribute('data-addrow'))) {
        var s2 = sec(S.sel), f2 = fieldOf(s2, a), blank = {};
        f2.item.forEach(function (x) { blank[x.k] = ''; });
        remember(); s2.props[a] = (s2.props[a] || []).concat([blank]); S.openRow = s2.id + ':' + a + ':' + (s2.props[a].length - 1);
        changed('row', true); return;
      }
      if ((a = b.getAttribute('data-addall'))) {
        var s3 = sec(S.sel), f3 = fieldOf(s3, a), add = sourceOptions(s3, f3).map(function (o) { return rowFromSource(f3, o[0]); }).filter(Boolean);
        remember(); s3.props[a] = (s3.props[a] || []).concat(add); changed('row', true); return;
      }
      if ((a = b.getAttribute('data-pick'))) { S.picks = S.picks === a ? '' : a; drawRightKeepScroll(); return; }
      if ((a = b.getAttribute('data-use'))) { remember(); setField(b.getAttribute('data-for'), a); S.picks = ''; changed('pic', true); drawRightKeepScroll(); return; }
      if ((a = b.getAttribute('data-clear'))) { remember(); setField(a, ''); changed('pic', true); return; }
      if ((a = b.getAttribute('data-upload'))) { upload(a); return; }
      if ((a = b.getAttribute('data-subject'))) {
        var o = S.subjects[+a]; remember('doc.subject');
        S.doc.subject = o.subject; if (o.preheader) S.doc.preheader = o.preheader;
        S.subjects = null; changed('subject', true); return;
      }
      if ((a = b.getAttribute('data-ai'))) { writeIntro(a, b); return; }
      a = b.getAttribute('data-act');
      if (a === 'subjects') suggestSubjects(b);
      if (a === 'resetcolours') { remember(); S.doc.palette = sitePalette(kit); changed('colours', true); }
      if (a === 'btnreset') { remember(); delete S.doc.btnColour; changed('colours', true); }
    });

    function select(id) {
      S.sel = id; S.tab = 'section'; S.picks = '';
      drawRight(); schedule(0);
    }
    function upload(path) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
      inp.onchange = function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        var put = fieldTarget(path);
        setBusy('Uploading the picture…');
        C().uploadImage(eventId, 'media', file).then(function (res) {
          setBusy('');
          var s = put(res.url);
          if (!s) { toast('The picture was uploaded, but the place it was for was removed meanwhile, so it was not used.', 'info'); return; }
          changed('pic', true);
          toast(s === true || s.id === S.sel ? 'Picture uploaded.' : 'Picture uploaded into the ' + ((KINDS[s.kind] || {}).label || 'section') + ' section.');
        }, function (err) { setBusy(''); toast(err.message, 'error'); });
      };
      inp.click();
    }

    /* ---------------- AI copy ---------------- */
    /* the mail's own words, as /api/promo/write reads them (`mailer`: its type and a few short fields) */
    function mailPiece() {
      var vis = S.doc.sections.filter(function (s) { return !s.hidden; });
      var heads = [], texts = [];
      vis.forEach(function (s) {
        var pr = s.props || {};
        [pr.eyebrow, pr.title, pr.heading].forEach(function (x) { if (str(x).trim()) heads.push(str(x).trim()); });
        if (str(pr.text).trim()) texts.push(str(pr.text).trim());
      });
      return { type: S.doc.type, subject: S.doc.subject, preheader: S.doc.preheader, headings: heads.slice(0, 20), text: texts.join(' ').slice(0, 600) };
    }
    function suggestSubjects(btn) {
      btn.disabled = true; S.subjects = 'busy'; drawRightKeepScroll();
      P().write('subjects', { mailer: mailPiece() }).then(function (res) {
        var list = (res && (res.options || res.subjects)) || [];
        S.subjects = list.map(function (o) { return typeof o === 'string' ? { subject: o } : { subject: str(o.subject || o.text), preheader: str(o.preheader) }; })
          .filter(function (o) { return o.subject; }).slice(0, 5);
        if (!S.subjects.length) toast('The AI did not suggest any subject lines. Try again.', 'error');
        drawRightKeepScroll();
      }, function (err) {
        S.subjects = null; drawRightKeepScroll();
        toast(err.status === 429 ? 'The AI is busy or its budget is used up. Try again later.' : 'Subject lines could not be written: ' + err.message, 'error');
      });
    }
    function writeIntro(path, btn) {
      var s = sec(S.sel), cur = str(getPath(s, path.split('.'))), put = fieldTarget(path);
      btn.disabled = true; btn.textContent = 'Writing…';
      P().write('intro', { current: cur, mailer: mailPiece() }).then(function (res) {
        var text = str(res && (res.text || (res.options && res.options[0]))).trim();
        if (!text) throw new Error('The AI returned no text.');
        var into = put(text);
        if (!into) { toast('The section the AI was writing for was removed meanwhile, so its text was not used.', 'info'); return; }
        changed('ai', true);
        toast('Written by AI' + (into === true || into.id === S.sel ? '' : ' into the ' + ((KINDS[into.kind] || {}).label || 'section') + ' section') + ' — read it through before you send.', { kind: 'info', action: { label: 'Undo', onClick: undo } });
      }).then(null, function (err) {
        btn.disabled = false; btn.textContent = 'Write with AI';
        toast(err.status === 429 ? 'The AI is busy or its budget is used up. Try again later.' : 'The text could not be written: ' + err.message, 'error');
      });
    }

    /* ---------------- the preview ---------------- */
    function schedule(ms) {
      clearTimeout(S.renderTimer);
      S.renderTimer = setTimeout(paint, ms == null ? 200 : ms);
    }
    /* crops (and, for SVG/WebP, PNGs) for the preview are drawn here in the browser and kept in memory
       only — what is downloaded uses the uploaded copies */
    function previewPictures() {
      var hd = (S.doc.sections || []).filter(function (s) { return s.kind === 'header' && s.props.mode !== 'text' && s.props.logo && s.props.logoBgOf !== s.props.logo; })[0];
      if (hd && S.detecting !== S.doc) {
        var doc = S.detecting = S.doc;
        detectLogoBg(doc).then(function (changed) { if (S.detecting === doc) S.detecting = null; if (changed && doc === S.doc) schedule(0); });
      }
      var jobs = imageJobs(S.doc, kit);
      Object.keys(jobs).forEach(function (slot) {
        var j = jobs[slot];
        if (j.kind !== 'crop' || S.pv[j.key] || (S.doc.assets && S.doc.assets[j.key])) return;
        S.pv[j.key] = '';
        draw(j, kit).then(function (blob) { S.pv[j.key] = URL.createObjectURL(blob); schedule(0); }, function () { /* the uncropped picture stays */ });
      });
    }
    function paint() {
      if (!S.doc) return;
      previewPictures();
      var pv = {};
      Object.keys(S.pv).forEach(function (k) { if (S.pv[k]) pv[k] = S.pv[k]; });
      var html = render(S.doc, kit, { preview: true, pv: pv, broken: S.broken, selected: S.tab === 'section' ? S.sel : '' });
      var finalHtml = render(S.doc, kit, { broken: S.broken });
      S.report = check(finalHtml, { converting: true });
      drawChecks();
      var keep = el.box.offsetHeight;
      el.box.style.minHeight = keep ? keep + 'px' : '';
      el.frame.onload = function () { wireFrame(); fitFrame(); el.box.style.minHeight = ''; };
      el.frame.srcdoc = html;
    }
    function drawChecks() {
      var r = S.report, errs = r.issues.filter(function (x) { return x.level === 'error'; }), warns = r.issues.filter(function (x) { return x.level === 'warn'; });
      el.size.textContent = r.kb + ' KB of 100';
      el.size.className = 'pm-size' + (r.bytes > 100 * 1024 ? ' is-bad' : r.bytes > 85 * 1024 ? ' is-warn' : '');
      if (!r.issues.length) { el.checks.innerHTML = '<p class="pm-ok">All checks pass: size, pictures, links, contrast.</p>'; return; }
      el.checks.innerHTML = '<details class="pm-issues"' + (errs.length ? ' open' : '') + '><summary>' +
        (errs.length ? errs.length + ' problem' + (errs.length === 1 ? '' : 's') : '') + (errs.length && warns.length ? ', ' : '') +
        (warns.length ? warns.length + ' thing' + (warns.length === 1 ? '' : 's') + ' to check' : '') + '</summary><ul>' +
        r.issues.map(function (x) { return '<li class="is-' + x.level + '">' + esc(x.text) + '</li>'; }).join('') + '</ul></details>';
    }
    function wireFrame() {
      var d = el.frame.contentDocument;
      if (!d) return;
      d.addEventListener('click', function (e) {
        e.preventDefault();
        var t = e.target.closest && e.target.closest('[data-sec]');
        if (t) select(t.getAttribute('data-sec'));
      });
      Array.prototype.forEach.call(d.images, function (im) { if (!im.complete) im.addEventListener('load', fitFrame); });
      if (d.fonts && d.fonts.ready) d.fonts.ready.then(fitFrame);
    }
    function fitFrame() {
      var d = el.frame.contentDocument, w = S.width === 'mobile' ? 375 : 704;
      var avail = el.stage.clientWidth - 32;
      if (avail <= 0) return;                       /* not on screen (a hidden tab): measured when it is */
      var scale = Math.min(1, avail / w);
      el.frame.style.width = w + 'px';
      /* the content's own height — documentElement.scrollHeight is never less than the frame itself, so a
         shorter mail would keep the old height */
      var h = d && d.body ? Math.ceil(d.body.getBoundingClientRect().height) : 600;
      if (h < 200) h = 200;
      el.frame.style.height = h + 'px';
      el.frame.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
      el.box.style.width = Math.round(w * scale) + 'px';
      el.box.style.height = Math.round(h * scale) + 'px';
    }
    var onResize = function () { if (S.doc) fitFrame(); };
    window.addEventListener('resize', onResize);
    var watch = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    if (watch) watch.observe(el.stage);

    /* ---------------- top bar ---------------- */
    function setBusy(text) {
      S.busy = text;
      el.busy.textContent = text;
      Array.prototype.forEach.call(el.root.querySelectorAll('.pm-actions [data-act]'), function (b) { b.disabled = !!text; });
    }
    /* the HTML as it is sent: pictures made mail-safe and online first */
    function finalHtml() {
      setBusy('Preparing pictures…');
      var before = JSON.stringify(S.doc.assets || {});
      return prepareImages(S.doc, kit, eventId, function (i, n) { setBusy('Preparing pictures… ' + i + ' of ' + n); }).then(function (res) {
        /* a picture mail clients cannot show or reach is left out rather than sent broken; a crop that failed
           just leaves the picture uncropped — when that picture is on a public https address */
        S.broken = {};
        var lost = res.failed.filter(function (j) { return j.kind !== 'crop' || !/^https:/i.test(j.src); });
        lost.forEach(function (j) { S.broken[j.key] = true; });
        if (res.failed.length) {
          var why = (res.failed[0].error && res.failed[0].error.message) || '';
          var logo = lost.some(function (j) { return /:logo$/.test(j.slot); }), others = lost.length - (logo ? 1 : 0);
          toast((logo ? 'The logo could not be made ready for mail, so the event name is set in text instead. ' : '') +
            (others > 0 ? others + (logo ? ' other' : '') + ' picture(s) could not be made ready for mail (turned into PNG or put online) and are left out — names or initials are shown instead. ' : '') +
            (res.failed.length > lost.length ? 'The hero picture could not be cropped and is used as it is. ' : '') + why, 'error');
        }
        if (JSON.stringify(S.doc.assets) !== before) setDirty(true);
        setBusy('');
        var html = render(S.doc, kit, { broken: S.broken });
        S.report = check(html); drawChecks();
        schedule(0);
        return html;
      }, function (err) { setBusy(''); throw err; });
    }
    function fileName() {
      var slug = str(kit.event && kit.event.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
      return slug + '-' + S.doc.type + '-mailer.html';
    }
    function warnAfter() {
      var errs = S.report.issues.filter(function (x) { return x.level === 'error'; });
      if (errs.length) toast('Check before sending: ' + errs[0].text, 'error');
    }
    /* copies HTML that is still being made (pictures can take seconds to upload). Browsers copy only right
       after a click (Safari at once, Firefox within ~5 s), so the clipboard is claimed in the click itself
       with a ClipboardItem whose text arrives later; where that is not possible the text is copied when it
       is ready. -> Promise<true copied | false the browser refused (a second click works: the pictures are
       online by then)>, rejected only when the HTML could not be made. */
    function copyLater(htmlP) {
      var asText = function () { return htmlP.then(function (html) { return copyText(html).then(function () { return true; }, function () { return false; }); }); };
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        var claimed;
        try {
          claimed = navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': htmlP.then(function (h) { return new Blob([h], { type: 'text/plain' }); }) })]);
        } catch (e) { claimed = null; }
        if (claimed) return claimed.then(function () { return htmlP.then(function () { return true; }); }, asText);
      }
      return asText();
    }
    /* the clipboard API first; a browser that refuses it (no permission, an older one) gets the old way */
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(null, function () { return copyOld(text); });
      return copyOld(text);
    }
    function copyOld(text) {
      return new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        if (ok) resolve(); else reject(new Error('Your browser did not allow copying.'));
      });
    }
    function prune() {
      var keep = {}, jobs = imageJobs(S.doc, kit);
      Object.keys(jobs).forEach(function (k) { var key = jobs[k].key; if (S.doc.assets && S.doc.assets[key]) keep[key] = S.doc.assets[key]; });
      S.doc.assets = keep;
    }
    function save() {
      prune();
      var name = el.name.value.trim() || S.doc.subject || typeOf(S.doc.type).label;
      var size = JSON.stringify(S.doc).length;
      if (size > MAX_SAVED) {
        toast('This mailer is too long to save (' + size.toLocaleString() + ' characters; the limit is ' + MAX_SAVED.toLocaleString() + '). Remove some rows or sections and save again.', 'error');
        return;
      }
      setBusy('Saving…');
      P().save('email', { id: S.savedId || undefined, name: name, subject: S.doc.subject, config: S.doc }).then(function (res) {
        S.savedId = res.id || S.savedId; S.name = name; el.name.value = name;
        setBusy(''); setDirty(false); toast('Mailer saved.');
        loadSaved();
      }, function (err) { setBusy(''); toast('The mailer could not be saved: ' + err.message, 'error'); });
    }

    el.root.querySelector('.pm-actions').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b || b.disabled || !S.doc) return;
      var a = b.getAttribute('data-act');
      if (a === 'undo') undo();
      if (a === 'save') save();
      if (a === 'download') finalHtml().then(function (html) {
        P().download(new Blob([html], { type: 'text/html;charset=utf-8' }), fileName());
        toast('Downloaded ' + fileName() + ' (' + S.report.kb + ' KB).');
        warnAfter();
      }, function (err) { toast('The mail could not be made: ' + err.message, 'error'); });
      if (a === 'copy') copyLater(finalHtml()).then(function (copied) {
        if (copied) { toast('HTML copied — paste it into your e-mail tool’s HTML or code editor.'); warnAfter(); }
        else toast('The pictures are ready, but your browser only copies straight after a click. Click Copy HTML again.', 'info');
      }, function (err) { toast('The HTML could not be made: ' + err.message, 'error'); });
    });
    el.name.addEventListener('input', function () { S.name = el.name.value; if (S.doc) setDirty(true); });
    el.root.querySelector('.pm-stagebar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-width]');
      if (!b) return;
      S.width = b.getAttribute('data-width');
      Array.prototype.forEach.call(el.root.querySelectorAll('[data-width]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      fitFrame();
      setTimeout(fitFrame, 60);
    });
    el.left.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      var a;
      if ((a = b.getAttribute('data-type'))) { if (confirmLeave()) newDoc(a); return; }
      if ((a = b.getAttribute('data-open'))) {
        var it = S.saved.filter(function (x) { return x.id === a; })[0];
        if (!it || !confirmLeave()) return;
        /* a copy: edits that are never saved must not reach the saved list's own copy */
        var d = clone(it.config || {});
        if (!d.sections || !d.palette) { toast('This saved mailer could not be read.', 'error'); return; }
        d.assets = d.assets || {};
        openDoc(d, it.id, it.name);
        if (d.type === 'reminder') checkCountdown();
        return;
      }
      if ((a = b.getAttribute('data-del'))) {
        var del = S.saved.filter(function (x) { return x.id === a; })[0];
        if (!del || !window.confirm('Delete the saved mailer "' + del.name + '"? This cannot be undone.')) return;
        P().remove(a).then(function () {
          if (S.savedId === a) { S.savedId = ''; setDirty(true); }
          toast('Mailer deleted.'); loadSaved();
        }, function (err) { toast('The mailer could not be deleted: ' + err.message, 'error'); });
      }
    });
    function onKey(e) {
      /* only while the studio is on screen: the page keeps it mounted under a hidden tab */
      if (!document.body.contains(el.root) || !el.root.getClientRects().length) return;
      var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key && e.key.toLowerCase() === 'z' && !typing && S.doc) { e.preventDefault(); undo(); }
    }
    document.addEventListener('keydown', onKey);
    function onLeave(e) { if (S.dirty && document.body.contains(el.root)) { e.preventDefault(); e.returnValue = ''; } }
    window.addEventListener('beforeunload', onLeave);

    /* the first available type opens straight away, so the studio never starts on an empty stage */
    var first = TYPES.filter(function (t) { return availability(t.id, kit).ok; })[0];
    newDoc(first ? first.id : 'blank');
    loadSaved();

    return {
      destroy: function () {
        window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey);
        if (watch) watch.disconnect();
        window.removeEventListener('beforeunload', onLeave); root.innerHTML = '';
      },
      get doc() { return S.doc; }
    };
  }

  window.RevampPromoMailers = {
    mount: mount, render: render, check: check, build: build, availability: availability, TYPES: TYPES,
    prepareImages: prepareImages, imageJobs: imageJobs
  };
})();
