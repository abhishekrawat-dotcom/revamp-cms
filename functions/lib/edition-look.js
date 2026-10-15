/* The previous edition's LOOK, read from its own page, and the event's PLACE — what a site "designed according
   to the previous edition" is INSPIRED BY: its character (palette family, tone, type feel, imagery), never a
   copy of it. Plain computation: no network, no Firebase, no model call
   (edition-look.test.js).

     readLook(html, css)          -> { brand, accent, background, surface, text, muted, headingFont, bodyFont,
                                       headingFontRaw, bodyFontRaw, colours: [..] }
                                     The edition's own palette and type. A page's own <style> blocks speak for
                                     the EVENT; its linked stylesheets mostly for the platform it runs on (on
                                     ET's microsites a shared bundle whose red, blues and greens belong to
                                     every ET site), so the page's own rules are read first and the linked
                                     ones only for what the page does not say. Any field may be ''.
     logoColours(svgText)         -> ['#rrggbb', ..]  the lock-up's own colours, most used first, one per hue
     withLogo(look, logoCols)     -> look, its accent taken from the lock-up where the page named none
     keyVisualOf(html, pageUrl)   -> 'https://…' | ''   the picture the edition's banner is built on
     googleFont(name)             -> a Google Fonts family for a family a page names ('' when not known)
     placeOf(eventMeta)           -> { city, cues: '', motif: '' } | null   the city the place given names (its
                                     cues are written per event by the plan's model: no city is known here)
     venueForDesign(ev, brief, prev) -> { venue, city, cues, motif, source: 'current'|'previous'|'' }  the venue
                                     the design shows: this edition's, else the last one's, never a mix
     inspiredDesign(look, chosen, mode) -> the design fields to set over the model's own: a site INSPIRED BY
                                     the edition (its palette family, tone and type feel), never a copy
     recolour(text, from, to)     -> CSS/HTML with one design's literal colours moved to another's
     ownerSetsLook(notes)         -> true when the owner's own instructions speak of colour, type or tone */

var gd = require('./gen-design');

/* ---------- colours ---------- */

function hex2(n) { return ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); }
function rgbOf(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function toHex(c) { return '#' + c.map(hex2).join(''); }
function mix(a, b, t) { var p = rgbOf(a), q = rgbOf(b); return toHex(p.map(function (v, i) { return v + (q[i] - v) * t; })); }

/* one colour literal -> { hex, a } | null: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() in either syntax,
   a bare "r, g, b" triple (how ET's platform writes --theme-color), white and black */
function parseColour(v) {
  var s = String(v || '').trim().toLowerCase().replace(/\s*!important\s*$/, '');
  var m;
  if (s === 'white') return { hex: '#ffffff', a: 1 };
  if (s === 'black') return { hex: '#000000', a: 1 };
  if ((m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s))) {
    var h = m[1];
    if (h.length <= 4) h = h.split('').map(function (c) { return c + c; }).join('');
    return { hex: '#' + h.slice(0, 6), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,\/]\s*([\d.]+%?))?\s*\)$/.exec(s) ||
    /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})()$/.exec(s);
  if (m) {
    var ch = function (x) { return /%$/.test(x) ? parseFloat(x) * 2.55 : parseFloat(x); };
    var c = [ch(m[1]), ch(m[2]), ch(m[3])];
    if (c.some(function (x) { return !(x >= 0 && x <= 255); })) return null;
    var a = m[4] == null || m[4] === '' ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex: toHex(c), a: a };
  }
  return null;
}

var COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;
function coloursIn(text) {
  var out = [];
  (String(text || '').match(COLOUR_LITERAL) || []).forEach(function (lit) { var c = parseColour(lit); if (c) out.push(c); });
  return out;
}

function chroma(h) { var c = rgbOf(h); return Math.max.apply(null, c) - Math.min.apply(null, c); }
function hue(h) {
  var c = rgbOf(h), r = c[0], g = c[1], b = c[2], max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  var x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
}
function hueGap(a, b) { var d = Math.abs(hue(a) - hue(b)) % 360; return d > 180 ? 360 - d : d; }
function lum(h) { return gd.luminance(h); }
function saturated(h) { var l = lum(h); return chroma(h) >= 60 && l > 0.02 && l < 0.75; }

/* ---------- reading CSS ---------- */

function stripComments(css) { return String(css || '').replace(/\/\*[\s\S]*?\*\//g, ' '); }
/* the page's own <style> blocks and style="" attributes, and the rest of it */
function ownCss(html) {
  var out = [], re = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, m;
  while ((m = re.exec(String(html || '')))) out.push(m[1]);
  return stripComments(out.join('\n'));
}
function styleAttrs(html) {
  var out = [], re = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, m;
  while ((m = re.exec(String(html || '')))) out.push(m[2] != null ? m[2] : m[3]);
  return out.join(';\n');
}
/* innermost rules: { sel, decls } — an @media block's own rules come out as rules of their own */
function rulesOf(css) {
  var out = [], re = /([^{}]*)\{([^{}]*)\}/g, m;
  while ((m = re.exec(css))) out.push({ sel: m[1].trim(), decls: m[2] });
  return out;
}
function declsOf(decls, prop) {
  var out = [], re = new RegExp('(?:^|;)\\s*(' + prop + ')\\s*:\\s*([^;]+)', 'gi'), m;
  while ((m = re.exec(decls))) out.push({ prop: m[1].toLowerCase(), value: m[2].trim(), important: /!important/i.test(m[2]) });
  return out;
}
function isPageSel(sel) {
  return sel.split(',').some(function (p) { return /^(html|body|:root)(?:[.#:\[][^\s>+~]*)?$/i.test(p.trim()); });
}
function isRootSel(sel) { return sel.split(',').some(function (p) { return /^(:root|html|body)$/i.test(p.trim()); }); }
var HEADING_SEL = /(^|[\s,>+~])h[1-3]\b|hdng|heading|headline|title/i;

/* the page's own brand colour, where it names one: a custom property such as --theme-color-hex, --brand,
   --primary-color on :root. ET's platform writes the event's colour this way. */
var BRAND_VAR = /^--(?:(?:theme|brand|primary|main|site)(?:[-_]?colou?r)?(?:[-_]?hex)?|colou?r[-_]?(?:primary|brand|theme))$/i;
function brandVar(css) {
  var found = null;
  rulesOf(css).forEach(function (r) {
    if (!isRootSel(r.sel)) return;
    var re = /(?:^|;)\s*(--[\w-]+)\s*:\s*([^;]+)/g, m;
    while ((m = re.exec(r.decls))) {
      if (!BRAND_VAR.test(m[1])) continue;
      var c = parseColour(m[2]);
      /* a "-hex" variant is the page saying it plainly: it wins over the triple beside it */
      if (c && c.a > 0.6 && (!found || /hex$/i.test(m[1]) || !/hex$/i.test(found.name))) found = { name: m[1], hex: c.hex };
    }
  });
  return found ? found.hex : '';
}

/* the page's background: body/html, the last rule wins, !important over the rest */
function pageBackground(css) {
  var best = null;
  rulesOf(css).forEach(function (r) {
    if (!isPageSel(r.sel)) return;
    declsOf(r.decls, 'background(?:-color)?').forEach(function (d) {
      var c = coloursIn(d.value).filter(function (x) { return x.a > 0.6; })[0];
      if (c && (!best || d.important || !best.important)) best = { hex: c.hex, important: d.important };
    });
  });
  return best ? best.hex : '';
}
function bodyColour(css) {
  var out = '';
  rulesOf(css).forEach(function (r) {
    if (!isPageSel(r.sel)) return;
    declsOf(r.decls, 'color').forEach(function (d) { var c = parseColour(d.value); if (c && c.a > 0.6) out = c.hex; });
  });
  return out;
}

function firstFamily(value) {
  return String(value || '').replace(/!important/gi, '').split(',')[0].replace(/["']/g, '').trim();
}
function bodyFamily(css) {
  var out = '';
  rulesOf(css).forEach(function (r) {
    if (!isPageSel(r.sel)) return;
    declsOf(r.decls, 'font-family').forEach(function (d) { var f = firstFamily(d.value); if (f && gd.fontFamilies([f]).length) out = f; });
  });
  return out;
}
function headingFamily(css) {
  var tally = {}, names = {};
  rulesOf(css).forEach(function (r) {
    if (!HEADING_SEL.test(r.sel)) return;
    declsOf(r.decls, 'font-family').forEach(function (d) {
      var f = firstFamily(d.value);
      if (!f || !gd.fontFamilies([f]).length) return;
      var k = compact(f);
      tally[k] = (tally[k] || 0) + 1;
      if (!names[k]) names[k] = f;
    });
  });
  var best = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; })[0];
  return best ? names[best] : '';
}

/* colours tallied over the page's own styles, most used first */
function tally(text) {
  var counts = {};
  coloursIn(text).forEach(function (c) { if (c.a > 0.6) counts[c.hex] = (counts[c.hex] || 0) + 1; });
  return Object.keys(counts).map(function (h) { return { hex: h, count: counts[h] }; }).sort(function (a, b) { return b.count - a.count; });
}

/* ---------- fonts ---------- */

function compact(name) {
  return String(name || '').toLowerCase()
    .replace(/[-_ ]?(?:webs?|webfont|regular|bold|semibold|medium|light|book|italic|black|thin|std|pro)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}
/* families on Google Fonts that event pages use; matched loosely ("theano_didotregular" is Theano Didot) */
var GOOGLE_FONTS = ['Montserrat', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Poppins', 'Raleway', 'Nunito', 'Nunito Sans', 'Work Sans',
  'Playfair Display', 'Merriweather', 'Source Sans 3', 'Source Serif 4', 'PT Sans', 'PT Serif', 'Oswald', 'Rubik', 'Manrope', 'DM Sans',
  'DM Serif Display', 'Plus Jakarta Sans', 'Outfit', 'Lexend', 'Urbanist', 'Sora', 'Space Grotesk', 'Barlow', 'Barlow Condensed', 'Josefin Sans',
  'Mulish', 'Karla', 'Libre Baskerville', 'Libre Franklin', 'Libre Caslon Text', 'Cormorant Garamond', 'Cormorant', 'EB Garamond', 'Lora',
  'Crimson Text', 'Noto Sans', 'Noto Serif', 'Fira Sans', 'IBM Plex Sans', 'IBM Plex Serif', 'Red Hat Display', 'Bebas Neue', 'Archivo',
  'Hind', 'Mukta', 'Kanit', 'Quicksand', 'Cabin', 'Arvo', 'Bitter', 'Gloock', 'Bodoni Moda', 'Theano Didot', 'Figtree', 'Jost', 'Prompt',
  'Saira', 'Exo 2', 'Titillium Web', 'Anton', 'Teko', 'Fraunces', 'Instrument Serif', 'Abril Fatface', 'Spectral', 'Cinzel', 'Marcellus',
  'Tenor Sans', 'Syne', 'Epilogue', 'Be Vietnam Pro', 'Albert Sans', 'Onest', 'Inter Tight', 'Roboto Condensed', 'Roboto Slab', 'Zilla Slab',
  'Ubuntu', 'Heebo', 'Assistant', 'Archivo Black', 'Chivo', 'Public Sans', 'Lexend Deca', 'Questrial', 'Overpass', 'Hanken Grotesk',
  'Bricolage Grotesque', 'Gelasio', 'Literata', 'Newsreader', 'Young Serif', 'Unbounded', 'Josefin Slab', 'Yeseva One', 'Prata', 'Italiana'];
var GOOGLE_BY_KEY = {};
GOOGLE_FONTS.forEach(function (f) { GOOGLE_BY_KEY[compact(f)] = f; });
/* families that are not on Google Fonts, and the Google family nearest to each in character */
var SUBSTITUTES = {
  sangbleuversailles: 'Playfair Display', sangbleu: 'Playfair Display', sangbleusunrise: 'Playfair Display', sangbleuempire: 'Playfair Display',
  didot: 'Playfair Display', bodoni: 'Bodoni Moda', garamond: 'EB Garamond', caslon: 'Libre Caslon Text', baskerville: 'Libre Baskerville',
  canela: 'Fraunces', tiempos: 'Source Serif 4', tiemposheadline: 'Source Serif 4', minion: 'Crimson Text', trajan: 'Cinzel', optima: 'Marcellus',
  gotham: 'Montserrat', gothamrounded: 'Nunito', proximanova: 'Figtree', avenir: 'Nunito Sans', avenirnext: 'Nunito Sans', futura: 'Jost',
  futurapt: 'Jost', gilroy: 'Plus Jakarta Sans', circular: 'DM Sans', helveticaneue: 'Inter', graphik: 'Inter', sfpro: 'Inter', sfprodisplay: 'Inter',
  aktivgrotesk: 'Inter', brandongrotesque: 'Josefin Sans', myriad: 'Source Sans 3', segoe: 'Open Sans', calibri: 'Open Sans', frutiger: 'Hind',
  eina: 'Plus Jakarta Sans', sofiapro: 'Figtree', neuehaasgrotesk: 'Inter', neuehaasdisplay: 'Inter', apercu: 'DM Sans', gtwalsheim: 'Outfit'
};
function googleFont(name) {
  var k = compact(name);
  if (!k) return '';
  return GOOGLE_BY_KEY[k] || SUBSTITUTES[k] || '';
}

/* ---------- the look ---------- */

function readLook(html, css) {
  var own = ownCss(html), attrs = styleAttrs(html), linked = stripComments(css);
  var counts = tally(own + '\n' + attrs);
  var look = { brand: '', accent: '', background: '', surface: '', text: '', muted: '', headingFont: '', bodyFont: '', headingFontRaw: '', bodyFontRaw: '', colours: [] };

  look.background = pageBackground(own) || pageBackground(linked);
  var light = !look.background || lum(look.background) >= 0.2;

  look.brand = brandVar(own) || brandVar(linked);
  var vivid = counts.filter(function (c) { return saturated(c.hex); });
  if (!look.brand && vivid.length) look.brand = vivid[0].hex;
  /* a second colour the page uses in its own rules, far enough from the brand to be one */
  var second = vivid.filter(function (c) { return !look.brand || (c.hex !== look.brand && hueGap(c.hex, look.brand) >= 15); })[0];
  if (second && second.count >= 2) look.accent = second.hex;

  /* text: what the page sets on body, else the dark (or light) neutral its own rules use most */
  var bodyText = bodyColour(own);
  function neutralFor(min, max) {
    return counts.filter(function (c) { var l = lum(c.hex); return chroma(c.hex) < 40 && l >= min && l <= max && c.count >= 2; })[0];
  }
  var textN = light ? neutralFor(0, 0.05) : neutralFor(0.6, 1);
  look.text = (bodyText && look.background && gd.contrast(bodyText, look.background) >= 7 ? bodyText : '') || (textN ? textN.hex : '') || bodyColour(linked);
  var mutedN = light ? neutralFor(0.06, 0.3) : neutralFor(0.3, 0.6);
  if (mutedN && look.background && gd.contrast(mutedN.hex, look.background) >= 4.5) look.muted = mutedN.hex;
  /* cards and bands: a step from the ground towards the text, as such pages tint them */
  if (look.background) look.surface = mix(look.background, look.text || (light ? '#000000' : '#ffffff'), light ? 0.045 : 0.07);

  look.bodyFontRaw = bodyFamily(own) || bodyFamily(linked);
  look.headingFontRaw = headingFamily(own) || headingFamily(linked) || '';
  look.bodyFont = googleFont(look.bodyFontRaw);
  look.headingFont = googleFont(look.headingFontRaw);
  look.colours = vivid.slice(0, 6).map(function (c) { return c.hex; });
  return look;
}

/* The lock-up's colours: fills and gradient stops, grouped by hue, the most used group first, each by its
   most used member. Greys, white and black are not a lock-up's colours. */
function logoColours(svgText) {
  var text = String(svgText || ''), found = [];
  var re = /(?:fill|stop-color|stroke)\s*(?:=\s*["']|:\s*)([^"';)]+\)?)/gi, m;
  while ((m = re.exec(text))) { var c = parseColour(m[1]); if (c && c.a > 0.5 && chroma(c.hex) >= 60) found.push(c.hex); }
  var groups = [];
  found.forEach(function (h) {
    var g = groups.filter(function (x) { return hueGap(x.hex, h) < 12; })[0];
    if (!g) { g = { hex: h, count: 0, members: {} }; groups.push(g); }
    g.count++;
    g.members[h] = (g.members[h] || 0) + 1;
  });
  return groups.sort(function (a, b) { return b.count - a.count; }).map(function (g) {
    return Object.keys(g.members).sort(function (a, b) { return g.members[b] - g.members[a]; })[0];
  }).slice(0, 5);
}

/* the lock-up gives the accent (a hue apart from the brand) and, where the page named no brand, the brand */
function withLogo(look, logoCols) {
  look = Object.assign({}, look || {});
  var cols = (logoCols || []).filter(saturated);
  if (!cols.length) return look;
  look.logoColours = cols.slice();
  if (!look.brand) look.brand = cols[0];
  var apart = cols.filter(function (h) { return hueGap(h, look.brand) >= 15; })[0];
  if (apart) look.accent = apart;
  return look;
}

/* ---------- the key visual ---------- */

var BANNER_NAME = /(?:^|[\s_-])(?:banner|hero|masthead|jumbotron|kv|key-?visual|main-?banner|top-?banner|bgcover|cover)(?:[\s_\d-]|$)/i;
var NOT_A_BANNER = /(?:^|[\s_-])(?:ad|ads|advert|advertisement|cookie|promo-?strip|sponsor|partner|logo|footer)(?:[\s_-]|$)/i;
var NOT_A_PICTURE = /logo|icon|sprite|badge|avatar|sponsor|partner|\.svg(?:$|\?)|\.gif(?:$|\?)|^data:/i;
function attrOf(tag, name) {
  var m = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  return m ? (m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] || '') : '';
}
function urlIn(text) {
  var m = /url\(\s*(["']?)([^"')]+)\1\s*\)/i.exec(String(text || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  return m ? m[2].trim() : '';
}
function absolute(u, pageUrl) {
  try { var a = new URL(String(u).replace(/&amp;/g, '&'), pageUrl || undefined).href; return /^https?:\/\//i.test(a) ? a.replace(/^http:/i, 'https:') : ''; } catch (e) { return ''; }
}
/* The picture the edition's top banner is built on: the background of the element the page calls its banner
   or hero (inline, a data- attribute, or a rule in its own styles), else the first large picture inside it
   that is not a logo. */
function keyVisualOf(html, pageUrl) {
  html = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  var own = ownCss(html), re = /<(section|div|header|figure|main)\b[^>]*>/gi, m;
  while ((m = re.exec(html))) {
    var tag = m[0], id = attrOf(tag, 'id'), cls = attrOf(tag, 'class');
    if (!BANNER_NAME.test(' ' + id + ' ' + cls + ' ') || NOT_A_BANNER.test(' ' + id + ' ' + cls + ' ')) continue;
    var candidates = [urlIn(attrOf(tag, 'style')), attrOf(tag, 'data-bg'), attrOf(tag, 'data-background'), attrOf(tag, 'data-bg-src'), attrOf(tag, 'data-background-image')];
    /* a rule of the page's own for this element */
    rulesOf(own).forEach(function (r) {
      var names = (id ? ['#' + id] : []).concat(cls.split(/\s+/).filter(Boolean).map(function (c) { return '.' + c; }));
      if (names.some(function (n) { return r.sel.split(',').some(function (p) { return p.trim() === n || p.trim().slice(-n.length - 1) === ' ' + n; }); })) {
        declsOf(r.decls, 'background(?:-image)?').forEach(function (d) { candidates.push(urlIn(d.value)); });
      }
    });
    /* a picture inside it */
    var inside = html.slice(m.index + tag.length, m.index + tag.length + 6000), im, ire = /<img\b[^>]*>/gi;
    while ((im = ire.exec(inside))) {
      var src = attrOf(im[0], 'data-src') || attrOf(im[0], 'src');
      if (!NOT_A_PICTURE.test(src + ' ' + attrOf(im[0], 'class') + ' ' + attrOf(im[0], 'alt'))) { candidates.push(src); break; }
    }
    var pick = candidates.filter(function (u) { return u && !NOT_A_PICTURE.test(u); }).map(function (u) { return absolute(u, pageUrl); }).filter(Boolean)[0];
    if (pick) return pick;
  }
  return '';
}

/* ---------- the place ---------- */

/* The city an event takes place in, read from the place it gives — nothing here knows any city: how a city
   shows (its architecture, light, crafts, a motif drawn from it) is written for each event by the plan's
   model (design.placeCues, design.placeMotif), and the model also names the city when the venue's own words
   leave it unclear (design.placeCity). This is only the best reading of the words given:
   the city field, else the last part of the venue or location ("Hotel X, Nagpur 440001" -> "Nagpur").
   -> { city, cues: '', motif: '' } | null when no place is named */
var NOT_A_CITY = /^(?:india|bharat|the|hotel|resort|convention|centre|center|hall|ballroom|road|marg|nagar|sector|phase|online|virtual|tbd|tba)$/i;
function placeOf(meta) {
  meta = meta || {};
  var fields = [meta.city, meta.venue, meta.location].map(function (v) { return String(v || '').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  if (!fields.length) return null;
  var name = String(meta.city || '').trim();
  if (!name) {
    var parts = fields[fields.length - 1].split(',').map(function (p) { return p.replace(/\b\d{5,6}\b/g, '').trim(); }).filter(Boolean);
    name = parts.length > 1 ? parts[parts.length - 1] : '';
  }
  name = name.replace(/\b\d{5,6}\b/g, '').trim();
  if (!name || name.length > 40 || NOT_A_CITY.test(name) || /\d/.test(name)) return null;
  return { city: name, cues: '', motif: '' };
}

/* ---------- the venue the design shows ----------
   The CURRENT edition's venue, as the owner gave it (the event's venue / city / location fields, else the
   brief), and only when there is none, the previous edition's (et-previous.js readPrevious: ET's event_venue
   or location). Never a mix of the two: an event that moved city carries its new one.
   -> { venue, city, cues, motif, source: 'current' | 'previous' | '' } */
var NO_VENUE = /^(?:tba|tbd|to be (?:announced|decided|confirmed)|online|virtual|n\/?a|-+)$/i;
function given(v) { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return v && !NO_VENUE.test(v) ? v.slice(0, 200) : ''; }
function venueForDesign(event, brief, previous) {
  event = event || {}; brief = brief || {};
  var owner = brief.owner || {};
  var current = { venue: given(event.venue), city: given(event.city), location: given(event.location) };
  if (!current.venue && !current.city && !current.location) {
    current = { venue: given(brief.venue || owner.venue), city: given(brief.city || owner.city), location: given(brief.location || owner.location) };
  }
  var source = '', fields = null;
  if (current.venue || current.city || current.location) { source = 'current'; fields = current; }
  else if (previous && given(previous.venue)) { source = 'previous'; fields = { venue: given(previous.venue), city: '', location: '' }; }
  if (!fields) return { venue: '', city: '', cues: '', motif: '', source: '' };
  var place = placeOf(fields);
  return { venue: fields.venue || fields.location || fields.city, city: place ? place.city : '', cues: place ? place.cues : '', motif: place ? place.motif : '', source: source };
}

/* ---------- into the plan: INSPIRED BY the edition, never a copy ----------
   The new edition has a design of its own. Nothing of the last edition's design is copied: not a hex value,
   not a font, not a picture. What carries over is its character — the palette FAMILY (the hues and the tint
   of its ground), its tone (light or dark), the FEEL of its type (serif or sans). The model chooses its own
   colours and fonts inside that character; a choice that has left it, or that simply copied the edition's
   own value, is replaced here by one DERIVED from the edition (a different colour of the same family, a
   different family of the same kind).
     inspiredDesign(look, chosen, mode) -> the design fields to set over `chosen` (the model's design);
       mode: 'light' | 'dark' | 'auto', the owner's choice, which always wins over the edition's tone. */
var SERIF_FONTS = /^(playfair display|merriweather|source serif 4|pt serif|dm serif display|libre baskerville|libre caslon text|cormorant garamond|cormorant|eb garamond|lora|crimson text|noto serif|ibm plex serif|arvo|bitter|gloock|bodoni moda|theano didot|fraunces|instrument serif|abril fatface|spectral|cinzel|marcellus|roboto slab|zilla slab|gelasio|literata|newsreader|young serif|josefin slab|yeseva one|prata|italiana)$/i;
function fontKind(name) { return SERIF_FONTS.test(String(name || '').trim()) ? 'serif' : 'sans'; }
/* families of each kind a new edition can be set in, in order of preference */
var FONT_CHOICES = {
  serif: ['Fraunces', 'Cormorant Garamond', 'DM Serif Display', 'Libre Caslon Text', 'Newsreader', 'Playfair Display'],
  sans: ['Plus Jakarta Sans', 'Manrope', 'Outfit', 'Figtree', 'DM Sans', 'Work Sans', 'Inter', 'Montserrat']
};
function dist(a, b) { var p = rgbOf(a), q = rgbOf(b); return Math.sqrt(p.reduce(function (s, v, i) { return s + Math.pow(v - q[i], 2); }, 0)); }
function hexOk(v) { var c = parseColour(v); return c ? c.hex : ''; }
var COPY_DIST = 10;                     // closer than this to one of the edition's colours is that colour, copied

function inspiredDesign(look, chosen, mode) {
  look = look || {}; chosen = chosen || {};
  var out = {}, logo = (look.logoColours || []).filter(saturated);
  var own = [look.brand, look.accent, look.background, look.surface, look.text, look.muted].concat(logo, look.colours || []).filter(Boolean);
  function copied(h) { return own.some(function (o) { return dist(h, o) < COPY_DIST; }); }
  /* a colour of the family that is not one of the edition's own: moved along in small steps, only as far as
     it takes to be new (a big step would take a card colour to grey) */
  function fresh(h, toward) {
    for (var i = 0; i < 12 && copied(h); i++) h = mix(h, toward, 0.06);
    return h;
  }

  /* brand: the model's own while it is of the edition's hue and not its very value */
  var brand = hexOk(chosen.themeColor);
  if (look.brand && !(brand && saturated(brand) && hueGap(brand, look.brand) <= 20 && !copied(brand))) {
    var toward = logo.filter(function (h) { return hueGap(h, look.brand) <= 30 && dist(h, look.brand) >= COPY_DIST; })[0];
    out.themeColor = fresh(toward ? mix(look.brand, toward, 0.5) : look.brand, lum(look.brand) > 0.25 ? '#000000' : '#ffffff');
  }
  var family = [look.brand, look.accent].concat(logo).filter(Boolean);
  var accent = hexOk(chosen.accentColor);
  var accentOk = accent && saturated(accent) && family.some(function (f) { return hueGap(accent, f) <= 20; }) && !copied(accent);
  if (look.accent && !accentOk) out.accentColor = fresh(mix(look.accent, out.themeColor || brand || look.accent, 0.2), '#000000');

  /* type: the same feel (serif where the edition set serifs), never the edition's own family */
  var theirs = [look.headingFont, look.bodyFont, look.headingFontRaw, look.bodyFontRaw].filter(Boolean).map(function (f) { return String(f).toLowerCase(); });
  function fontFor(chosenFont, edition) {
    if (!edition) return '';
    var kind = fontKind(edition), mine = String(chosenFont || '').trim();
    if (mine && fontKind(mine) === kind && theirs.indexOf(mine.toLowerCase()) === -1) return '';
    return FONT_CHOICES[kind].filter(function (f) { return theirs.indexOf(f.toLowerCase()) === -1; })[0];
  }
  var hf = fontFor(chosen.headingFont, look.headingFont), bf = fontFor(chosen.bodyFont, look.bodyFont);
  if (hf) out.headingFont = hf;
  if (bf && bf !== (hf || chosen.headingFont)) out.bodyFont = bf;

  /* the ground: the edition's tone (unless the owner chose the other) and its tint, in a value of its own */
  var bg = look.background;
  if (bg) {
    var tone = lum(bg) < 0.2 ? 'dark' : 'light';
    if (mode !== 'auto' && mode !== tone) return out;               // the owner's light/dark choice wins
    out.mode = tone;
    var mine = hexOk(chosen.backgroundColor), tinted = chroma(bg) >= 8;
    var keeps = !!mine && (lum(mine) < 0.2 ? 'dark' : 'light') === tone && dist(mine, bg) <= 40 && !copied(mine) &&
      (!tinted || (chroma(mine) >= 5 && hueGap(mine, bg) <= 30));
    var ground = keeps ? mine : fresh(tone === 'light' ? mix(bg, '#ffffff', 0.4) : mix(bg, '#000000', 0.25), tone === 'light' ? '#ffffff' : '#000000');
    if (!keeps) out.backgroundColor = ground;
    var ink = tone === 'light' ? '#000000' : '#ffffff';
    var text = hexOk(chosen.textColor);
    if (!(text && gd.contrast(text, ground) >= 7 && !copied(text))) {
      var t2 = look.text ? fresh(mix(look.text, ink, 0.3), ink) : (tone === 'light' ? '#16181d' : '#f3f4f7');
      out.textColor = gd.contrast(t2, ground) >= 7 ? t2 : (tone === 'light' ? '#16181d' : '#f3f4f7');
    }
    var muted = hexOk(chosen.mutedColor);
    if (!(muted && gd.contrast(muted, ground) >= 4.5 && !copied(muted))) {
      var m2 = look.muted ? fresh(mix(look.muted, ink, 0.25), ink) : '';
      if (m2 && gd.contrast(m2, ground) >= 4.5) out.mutedColor = m2;
    }
    var surface = hexOk(chosen.surfaceColor);
    if (!keeps || !(surface && dist(surface, ground) <= 40 && !copied(surface))) {
      /* cards and bands: the ground warmed by the brand, a step of its own */
      /* moved, where it must be, towards white: a lighter card on a light ground, never a grey one */
      out.surfaceColor = fresh(mix(ground, out.themeColor || brand || look.brand || ink, tone === 'light' ? 0.06 : 0.1), '#ffffff');
    }
  }
  return out;
}

/* the owner's own words on the look win over the edition's */
function ownerSetsLook(notes) {
  return /colou?r|palette|font|typeface|serif|\bdark\b|\blight\b|#[0-9a-f]{3,6}\b|\btheme\b|\bshade/i.test(String(notes || ''));
}

/* Literal colours of one design moved to another's: a section written for the old palette (a tint written as
   rgba() of the brand colour, a band in the old surface) follows the new one. Alpha is kept. */
function recolour(text, from, to) {
  from = from || {}; to = to || {};
  var map = {};
  ['themeColor', 'accentColor', 'backgroundColor', 'surfaceColor', 'textColor', 'mutedColor'].forEach(function (k) {
    var a = parseColour(from[k]), b = parseColour(to[k]);
    if (a && b && a.hex !== b.hex && !map[a.hex]) map[a.hex] = b.hex;
  });
  if (!Object.keys(map).length) return String(text || '');
  return String(text || '').replace(COLOUR_LITERAL, function (lit) {
    var c = parseColour(lit);
    if (!c || !map[c.hex]) return lit;
    var n = rgbOf(map[c.hex]);
    if (/^rgba?\(/i.test(lit)) return c.a < 1 ? 'rgba(' + n.join(',') + ',' + (+c.a.toFixed(3)) + ')' : 'rgb(' + n.join(',') + ')';
    return map[c.hex] + (c.a < 1 ? hex2(c.a * 255) : '');
  });
}

module.exports = {
  readLook, logoColours, withLogo, keyVisualOf, googleFont, placeOf, venueForDesign, inspiredDesign, fontKind, ownerSetsLook, recolour,
  parseColour, GOOGLE_FONTS
};
