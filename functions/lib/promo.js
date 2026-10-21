/* Promotions: what every social post and mailer of one event is made from, and the AI copy for them.

     GET  /api/promo/kit?eventId=          handleKit    the event's brand and content (the Kit)
     GET  /api/promo/image?eventId=&url=   handleImage  one picture of the kit, served from our own address
     POST /api/promo/write                 handleWrite  copy by the AI: a caption, subject lines, an intro, headlines

   All three are admin routes. lib/api.js routes them here (loaded on demand, like api-events.js) and hands
   this file, through wire(), the helpers the two share — the admin wrappers, the saved-site reader, the
   public address, the AI usage recorder — so that neither file requires the other.

   THE KIT is the contract with promo-kit.js (its header comment has the shape; keep the two in step).
   Nothing in it is invented: a list the event has no data for is empty, a number is a count of real
   records, and a picture is one the site itself shows. The page screens say what is missing.

   Where the brand comes from, first found wins:
     1. the saved site, events/<id>/site/page.html — what a visitor really sees, after every design edit
        (the body's variables, the editor's own state, the hero, the logo unit, the font links);
     2. an AI-designed site's plan (events/<id>.designPlan.design) — the starting values, for a site that
        was never saved;
     3. a ported template's own files on disk (templates/<id>/template.json + theme.css);
     4. fixed fallbacks. A ported template's sample pictures (the banner of the ET event it was copied
        from) are never this event's pictures.

   Pictures for the browser: our Storage bucket and ET's image hosts send no CORS headers, so a picture
   drawn from there taints a canvas and the post can no longer be exported as a PNG. /api/promo/image
   fetches one picture (only from this event's own files or ET's image hosts — never an address of the
   caller's choosing) and serves it from this origin. */
const fs = require('fs');
const path = require('path');
const { parseDocument } = require('htmlparser2');
const domutils = require('domutils');
const { sendJson, str } = require('./http');
const genDesign = require('./gen-design');
const logoUnitLib = require('./logo-unit');
const { readPage } = require('./page-diff');
const { safeFetch } = require('./safe-fetch');
const { publicSiteData } = require('./api-audience');
const ownerBrief = require('./owner-brief');
const llm = require('./llm');

/* lib/api.js's helpers (see wire() at the bottom) */
var H = null;

var TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');
var THEME_FALLBACK = '#186bf9';
var HEADING_FALLBACK = 'Plus Jakarta Sans', BODY_FALLBACK = 'Inter';
var SYSTEM_FONTS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|inherit|initial|unset|arial|helvetica|helvetica neue|georgia|times|times new roman|courier|courier new|verdana|tahoma|trebuchet ms|segoe ui)$/i;

/* ---------- small pieces ---------- */

function attr(el, name) { return (el && el.attribs && el.attribs[name]) || ''; }
function hasClass(el, cls) { return (' ' + attr(el, 'class') + ' ').indexOf(' ' + cls + ' ') !== -1; }
function first() { for (var i = 0; i < arguments.length; i++) if (arguments[i]) return arguments[i]; return ''; }
function colour(v) { return genDesign.colourOf(v); }
function lum(hex) { var l = genDesign.luminance(hex); return l == null ? 0 : l; }
function contrast(a, b) { return genDesign.contrast(a, b); }
function mix(a, b, t) {
  function rgb(h) { var n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  var p = rgb(a), q = rgb(b);
  return '#' + p.map(function (v, i) { return ('0' + Math.round(v + (q[i] - v) * t).toString(16)).slice(-2); }).join('');
}
/* white or near-black, whichever reads better on the colour (a pale brand colour gets dark type) */
function readableOn(bg) { return contrast('#ffffff', bg) >= contrast('#14161b', bg) ? '#ffffff' : '#14161b'; }
function oneLine(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 300); }
function httpsUrl(v) { var s = String(v || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : ''; }
/* a picture address a page can use: https, or a path on our own host ("/templates/…") */
function pictureUrl(v) { var s = String(v || '').trim(); return httpsUrl(s) || (/^\/[^/\s"'<>][^\s"'<>]*$/.test(s) ? s : ''); }
function firstFamily(stack) { return String(stack || '').split(',')[0].replace(/["']/g, '').trim(); }
function unique(list) { var seen = {}; return list.filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; }); }

/* ---------- a template's own files ---------- */

/* -> { json, themeCss, markup } for a real ported template (templates/<id>/), null for anything else (an
   AI-designed site, an import, a template that exists only as a name). Read once per file version. */
var templateCache = {};
function templateFiles(templateId) {
  if (typeof templateId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(templateId) || /^(gen|imported|import)-/.test(templateId)) return null;
  var dir = path.join(TEMPLATES_DIR, templateId), file = path.join(dir, 'template.json');
  try {
    var mtime = fs.statSync(file).mtimeMs, hit = templateCache[templateId];
    if (hit && hit.mtime === mtime) return hit.files;
    var json = JSON.parse(fs.readFileSync(file, 'utf8'));
    var themeCss = '', markup = '';
    if (typeof json.theme === 'string' && /^[\w.-]+\.css$/.test(json.theme)) {
      try { themeCss = fs.readFileSync(path.join(dir, json.theme), 'utf8'); } catch (e) { themeCss = ''; }
    }
    try {
      fs.readdirSync(path.join(dir, 'sections')).forEach(function (s) {
        try { markup += fs.readFileSync(path.join(dir, 'sections', s, 'index.html'), 'utf8') + '\n'; } catch (e) { /* a section without markup */ }
      });
    } catch (e) { markup = ''; }
    var files = { json: json, themeCss: themeCss, markup: markup };
    templateCache[templateId] = { mtime: mtime, files: files };
    return files;
  } catch (e) { return null; }
}

/* Every picture the template ships with: the banner and section pictures of the ET event it was copied
   from. A page that still shows one of them has simply not been given this event's own picture. */
function samplePictures(tpl) {
  var out = {};
  if (!tpl) return out;
  var text = String(tpl.markup || '') + '\n' + JSON.stringify(tpl.json || {});
  (text.match(/https?:\/\/[^\s"'()<>\\]+\.(?:jpe?g|png|webp|gif|svg|avif)(?:\?[^\s"'()<>\\]*)?/gi) || []).forEach(function (u) {
    out[u] = 1; out[u.split('?')[0]] = 1;
  });
  return out;
}
function isSample(url, samples) { return !!url && (!!samples[url] || !!samples[String(url).split('?')[0]]); }

/* the custom properties set in the theme's :root rules */
function rootVars(css) {
  var out = {}, re = /:root\s*\{([^}]*)\}/g, m;
  while ((m = re.exec(String(css || '')))) {
    m[1].split(';').forEach(function (decl) {
      var at = decl.indexOf(':');
      if (at > 0) out[decl.slice(0, at).trim()] = decl.slice(at + 1).trim();
    });
  }
  return out;
}

function radiusOf(v) {
  var s = String(v == null ? '' : v).trim().replace(/\s*!important$/, '');
  var m = /^(\d{1,3}(?:\.\d+)?)(px)?$/.exec(s);
  if (m) return Math.min(200, +m[1]) + 'px';
  return /^\d{0,2}\.?\d+(rem|em)$/.test(s) ? s : '';
}
/* A ported template's buttons: their rounding in its theme.css, else the banner button's ET style class
   (et-global.css: style1 square, style2 5px, style3 pill), else ET's own square button. */
var ET_BUTTON_STYLES = { style1: '0px', style2: '5px', style3: '50px' };
function templateRadius(tpl) {
  var css = String(tpl.themeCss || ''), re = /([^{}]+)\{([^}]*)\}/g, m;
  while ((m = re.exec(css))) {
    if (!/book-btn/.test(m[1]) || /:hover|btn-outline/.test(m[1])) continue;
    var r = /border-radius\s*:\s*([^;]+)/.exec(m[2]);
    if (r && radiusOf(r[1])) return radiusOf(r[1]);
  }
  var cls = /class="[^"]*\bbook-btn\s+(style[123])\b/.exec(String(tpl.markup || ''));
  return cls ? ET_BUTTON_STYLES[cls[1]] : '0px';
}

/* ---------- a page this product did not design ----------
   An imported site keeps its design in its own stylesheet's custom properties, in the names its builder
   uses: --background / --foreground / --primary / --font-sans (shadcn, Lovable), or its own brand names
   (--et-red, --gold). These are read as declared — the first value of each — and never guessed at. */
function pageTokens(css) {
  var out = {}, re = /(?:^|[;{\s])(--[a-z][a-z0-9-]*)\s*:\s*([^;{}]+)/gi, m;
  while ((m = re.exec(String(css || '')))) {
    var name = m[1].toLowerCase();
    if (/^--(tw-|color-)/.test(name) || out[name] !== undefined) continue;
    out[name] = m[2].trim();
  }
  return out;
}
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  function f(n) { var k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }
  return '#' + [f(0), f(8), f(4)].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
}
/* a token's colour: hex or rgb() (gen-design's colourOf), hsl(), or a bare "222 47% 11%" (shadcn) */
function tokenColour(v) {
  var c = colour(v);
  if (c) return c;
  var m = /^(?:hsla?\(\s*)?(\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/.exec(String(v || '').trim());
  return m ? hslHex(+m[1] % 360, Math.min(100, +m[2]), Math.min(100, +m[3])) : '';
}
function hueOf(hex) {
  var n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  var h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function saturatedColour(hex) {
  var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  var max = Math.max(r, g, b), l = lum(hex);
  return max > 0 && (max - Math.min(r, g, b)) / max > 0.35 && l > 0.02 && l < 0.75;
}
/* the page's brand colours: the saturated ones its tokens name most often (states, borders and the
   -dark / -soft variants of a colour do not count), most named first */
function brandColours(tokens) {
  var count = {}, order = [];
  Object.keys(tokens).forEach(function (k) {
    if (/(error|success|warning|danger|info|destructive|ring|border|shadow|chart|-dark|-soft|-light|-muted|-hover|-foreground)/.test(k)) return;
    var c = tokenColour(tokens[k]);
    if (!c || !saturatedColour(c)) return;
    if (!count[c]) { count[c] = 0; order.push(c); }
    count[c]++;
  });
  var at = {};
  order.forEach(function (c, i) { at[c] = i; });
  return order.slice().sort(function (a, b) { return count[b] - count[a] || at[a] - at[b]; });
}

/* ---------- fonts ---------- */

/* the families a Google Fonts address asks for, in lower case (css2: one family= per family; css: A|B) */
function familiesInFontUrl(url) {
  var out = [];
  (String(url || '').split('?')[1] || '').split('&').forEach(function (kv) {
    var at = kv.indexOf('=');
    if (at < 0 || kv.slice(0, at) !== 'family') return;
    var v;
    try { v = decodeURIComponent(kv.slice(at + 1).replace(/\+/g, ' ')); } catch (e) { return; }
    v.split('|').forEach(function (f) { out.push(f.split(':')[0].trim().toLowerCase()); });
  });
  return out;
}

/* The stylesheet that gives the browser this family, in the order a visitor's browser would find it:
   a stylesheet the page or the template links that names it, the template's own @font-face rules (as a
   data: stylesheet: ET's self-hosted fonts, e.g. SangBleu on st.etb2bimg.com, are not on Google Fonts),
   else the Google Fonts address the editor itself would add. '' for a system font. */
function fontCssUrl(family, links, faceCss, googleFontUrl) {
  if (!family || SYSTEM_FONTS.test(family)) return '';
  var key = family.toLowerCase();
  for (var i = 0; i < links.length; i++) {
    if (familiesInFontUrl(links[i]).indexOf(key) !== -1) return links[i];
  }
  var blocks = (String(faceCss || '').match(/@font-face\s*\{[^}]*\}/gi) || []).filter(function (b) {
    var f = /font-family\s*:\s*([^;}]+)/i.exec(b);
    return f && firstFamily(f[1]).toLowerCase() === key && /url\(\s*["']?https:\/\//i.test(b);
  });
  if (blocks.length) {
    var css = blocks.join('\n');
    if (css.length <= 4000) return 'data:text/css;charset=utf-8,' + encodeURIComponent(css);
  }
  return googleFontUrl ? googleFontUrl(family) : '';
}

/* The stack is quoted with single quotes ('Plus Jakarta Sans', Arial, sans-serif), so it can go straight into
   a double-quoted style="" attribute — of a post, or of a mailer's inline CSS — without breaking it. */
function fontOf(family, stack, links, faceCss, googleFontUrl) {
  family = String(family || '').replace(/["'<>;{}\\]/g, '');
  var given = String(stack || '').trim();
  if (!given || firstFamily(given).toLowerCase() !== family.toLowerCase() || given.indexOf(',') === -1) given = "'" + family + "', Arial, sans-serif";
  return { family: family, stack: given.replace(/"/g, "'").replace(/[;{}<>\\]/g, ''), cssUrl: fontCssUrl(family, links, faceCss, googleFontUrl) };
}

/* ---------- the saved page ---------- */

function readSavedPage(html) {
  if (!html) return null;
  var read;
  try { read = readPage(html); } catch (e) { return null; }
  var doc = parseDocument(String(html), { decodeEntities: true });
  function all(test) { return domutils.findAll(test, doc.children); }
  function one(test) { return domutils.findOne(test, doc.children, true); }
  var htmlEl = one(function (e) { return e.name === 'html'; });
  var htmlStyle = {};
  String(attr(htmlEl, 'style')).split(';').forEach(function (decl) {
    var at = decl.indexOf(':');
    if (at > 0) htmlStyle[decl.slice(0, at).trim()] = decl.slice(at + 1).trim();
  });
  var links = all(function (e) { return e.name === 'link' && /(^|\s)stylesheet(\s|$)/i.test(attr(e, 'rel')); })
    .map(function (e) { var h = attr(e, 'href'); return /^\/\//.test(h) ? 'https:' + h : h; })
    .filter(function (h) { return /^https:\/\//i.test(h); });
  var styles = all(function (e) { return e.name === 'style'; }).map(function (e) { return domutils.textContent(e); }).join('\n');
  /* each section's own <style data-rv-style="<key>">, by key. (readPage's section.css is always '': it looks
     for the next sibling of type 'tag', and htmlparser2 gives a <style> the type 'style'.) */
  var sectionCss = {};
  all(function (e) { return e.name === 'style' && !!attr(e, 'data-rv-style'); }).forEach(function (e) {
    var key = attr(e, 'data-rv-style');
    sectionCss[key] = (sectionCss[key] ? sectionCss[key] + '\n' : '') + domutils.textContent(e);
  });
  return { design: read.design, sections: read.sections, sectionCss: sectionCss, htmlStyle: htmlStyle, links: links, styles: styles, all: all, one: one };
}

/* The anchor of the registration form on the saved page. A page with a form on it — a register button
   ([data-register-cta]), a button that opens a form ([data-rv-form]) or a form placed in it
   ([data-rv-form-embed]) — has the forms runtime (templates/_shared/rv-forms.js), which opens the event's
   default form for "#register": that is the anchor. So is an element with id="register"; a page with
   neither has no anchor. */
function registerAnchor(page) {
  if (!page) return '';
  if (page.one(function (e) { return attr(e, 'id') === 'register'; })) return '#register';
  if (page.one(function (e) { return !!e.attribs && ('data-register-cta' in e.attribs || 'data-rv-form' in e.attribs || 'data-rv-form-embed' in e.attribs); })) return '#register';
  return '';
}

/* ---------- the brand ---------- */

/* a second colour from the brand colour alone: deeper on a light page, lighter on a dark one — or the
   other way when that one would hardly differ from it (a near-black brand colour has no deeper shade) */
function shadeOf(theme, mode) {
  var toward = mode === 'dark' ? '#ffffff' : '#000000', away = mode === 'dark' ? '#000000' : '#ffffff';
  var shade = mix(theme, toward, 0.45);
  return contrast(shade, theme) >= 1.6 ? shade : mix(theme, away, 0.45);
}

/* -> Brand (the kit's `brand`). Pure: everything it needs is passed in.
     src: { eventId, bucket, event (the event document), plan (designPlan or null), pageHtml (or null; or
            page: what readSavedPage made of it, when the caller has it already),
            template ({ json, themeCss, markup } or null), gallery: [url], googleFontUrl } */
function brandFromSources(src) {
  var ev = src.event || {}, plan = src.plan || {}, design = plan.design || {};
  var templateId = String(ev.templateId || (ev.site && ev.site.templateId) || '');
  var tpl = src.template || null;
  var kind = /^gen-/.test(templateId) ? 'generated' : (tpl ? 'ported' : 'unknown');
  var page = src.page !== undefined ? src.page : readSavedPage(src.pageHtml);
  function pd(name) { return page ? String(page.design[name] || '') : ''; }
  var ts = (tpl && tpl.json && tpl.json.body && tpl.json.body.style) || {};
  var root = rootVars(tpl ? tpl.themeCss : '');
  var samples = samplePictures(tpl);
  var pal = kind === 'generated' && plan.design ? genDesign.palette(design, 'auto') : null;
  var tk = kind === 'unknown' && page ? pageTokens(page.styles) : {};
  function tok() { for (var i = 0; i < arguments.length; i++) { var c = tokenColour(tk[arguments[i]]); if (c) return c; } return ''; }
  function tokFont() { for (var i = 0; i < arguments.length; i++) { var f = tk[arguments[i]]; if (f && !/^var\(/i.test(f)) return f; } return ''; }
  var brandSet = kind === 'unknown' ? brandColours(tk) : [];
  /* a picture the kit offers must be one the browser can draw: a file on our own host, or one the image
     route will fetch for this event — else the next one in line is used */
  var importId = importIdOf(ev);
  function drawable(u) { return u && (/^\//.test(u) || !imageUrlProblem(u, src.bucket, src.eventId, importId)) ? u : ''; }

  /* the page colour decides light or dark; everything else is judged against it */
  var bg = kind === 'generated'
    ? first(colour(pd('--rv-bg')), colour(pd('background-color')), pal && pal.backgroundColor)
    : first(colour(pd('background-color')), colour(pd('--bg-color')), colour(ts['--bg-color']), tok('--background', '--bg-primary', '--bg'));
  var mode = bg ? (lum(bg) < 0.2 ? 'dark' : 'light') : (design.mode === 'dark' ? 'dark' : 'light');
  var D = genDesign.MODE_DEFAULTS[mode];
  if (!bg) bg = D.backgroundColor;
  function readable(c, min) { return c && contrast(c, bg) >= min ? c : ''; }

  var text = kind === 'generated'
    ? first(readable(colour(pd('--rv-text')), 4.5), readable(pal && pal.textColor, 4.5))
    /* --body-color before --default-color: ET's --default-color is near-black even on its dark templates */
    : first(readable(colour(pd('--body-color')), 4.5), readable(colour(ts['--body-color']), 4.5),
      readable(tok('--foreground', '--text-primary', '--text'), 4.5),
      readable(colour(pd('--default-color')), 4.5), readable(colour(pd('color')), 4.5), readable(colour(ts['--default-color']), 4.5));
  text = text || D.textColor;
  var surface = kind === 'generated' ? first(colour(pd('--rv-surface')), pal && pal.surfaceColor) : tok('--card', '--bg-surface', '--surface');
  surface = surface || mix(bg, text, mode === 'dark' ? 0.08 : 0.05);
  var muted = kind === 'generated' ? first(readable(colour(pd('--rv-muted')), 4.5), readable(pal && pal.mutedColor, 4.5))
    : readable(tok('--muted-foreground', '--text-muted'), 4.5);
  muted = muted || readable(mix(text, bg, 0.32), 4.5) || D.mutedColor;
  var heading = first(readable(colour(pd('headingColor')), 3), readable(colour(pd('--heading-color')), 3),
    kind === 'ported' ? readable(colour(ts['--heading-color']), 3) : '', text);
  var theme = first(colour(pd('--theme-color')), colour(page && page.htmlStyle['--theme-color-hex']),
    kind === 'generated' ? colour(design.themeColor) : '',
    kind === 'ported' ? first(colour(ts['--theme-color']), colour(root['--theme-color-hex'])) : '',
    kind === 'unknown' ? first(tok('--primary', '--brand', '--brand-color'), brandSet[0]) : '', THEME_FALLBACK);
  /* ported templates have no accent of their own: their navigation bar's colour when it stands out from
     the page, else a deeper (on light) or lighter (on dark) shade of the brand colour */
  var navBg = first(colour(pd('--nav-bg-color')), colour(ts['--nav-bg-color']));
  var otherHue = brandSet.filter(function (c) { var d = Math.abs(hueOf(c) - hueOf(theme)); return Math.min(d, 360 - d) > 30; })[0];
  var accent = first(colour(pd('--accent-color')), kind === 'generated' ? colour(design.accentColor) : '', otherHue,
    navBg && navBg !== theme && contrast(navBg, bg) >= 1.6 ? navBg : '', shadeOf(theme, mode));

  /* fonts */
  var links = (page ? page.links : []).concat((tpl && Array.isArray(tpl.json.fonts) ? tpl.json.fonts : []).filter(httpsUrl),
    (String(tpl ? tpl.themeCss : '').match(/@import\s+url\(\s*["']?(https:\/\/[^"')]+)/gi) || []).map(function (s) { return /(https:\/\/[^"')]+)/.exec(s)[1]; }));
  var faceCss = (tpl ? tpl.themeCss : '') + '\n' + (page ? page.styles : '');
  var editorFonts = (tpl && tpl.json.editorFonts) || {};
  var headingVar = (tpl && tpl.json.design && tpl.json.design.headingFontVar) || '--heading-font-family';
  var headingStack, bodyStack;
  if (kind === 'generated') {
    headingStack = first(pd('headingFont'), pd('--heading-font-family'), design.headingFont, HEADING_FALLBACK);
    bodyStack = first(pd('--body-font-family'), design.bodyFont, BODY_FALLBACK);
  } else {
    headingStack = first(pd('headingFont'), pd(headingVar), root[headingVar], ts[headingVar], pd('--heading-font-family'), ts['--heading-font-family'],
      tokFont('--font-display', '--font-heading', '--font-serif'), HEADING_FALLBACK);
    bodyStack = first(pd('--body-font-family'), ts['--body-font-family'], tokFont('--font-sans', '--font-body'), BODY_FALLBACK);
  }
  var headingFamily = firstFamily(headingStack) || HEADING_FALLBACK, bodyFamily = firstFamily(bodyStack) || BODY_FALLBACK;
  if (/^var\(/i.test(headingFamily)) headingFamily = HEADING_FALLBACK;
  if (/^var\(/i.test(bodyFamily)) bodyFamily = BODY_FALLBACK;
  var fonts = {
    heading: fontOf(headingFamily, editorFonts[headingFamily] || headingStack, links, faceCss, src.googleFontUrl),
    body: fontOf(bodyFamily, editorFonts[bodyFamily] || bodyStack, links, faceCss, src.googleFontUrl)
  };

  var radius = radiusOf(pd('radius')) || (kind === 'generated' ? radiusOf(design.cornerRadius) : '') ||
    (kind === 'ported' ? templateRadius(tpl) : '') || radiusOf(tk['--radius']) || '12px';

  /* the logo unit: the lock-up that opens the site's hero */
  var unit = null;
  var banner = page && kind === 'ported' ? page.one(function (e) { return attr(e, 'data-rv-section') === 'banner'; }) : null;
  var unitEl = page ? page.one(function (e) { return e.attribs && 'data-rv-logo-unit' in e.attribs; }) : null;
  var unitImg = unitEl ? domutils.findOne(function (e) { return e.name === 'img' && hasClass(e, 'rv-lu-img'); }, unitEl.children || [], true) : null;
  if (unitImg && httpsUrl(attr(unitImg, 'src'))) {
    var plateEl = unitImg.parent && hasClass(unitImg.parent, 'rv-lu-plate') ? unitImg.parent : null;
    var plate = plateEl ? (hasClass(plateEl, 'rv-lu-plate-dark') ? 'dark' : hasClass(plateEl, 'rv-lu-plate-light') ? 'light' : '') : '';
    var onTone = hasClass(unitEl, 'rv-lu-on-dark') ? 'dark' : hasClass(unitEl, 'rv-lu-on-light') ? 'light' : mode;
    unit = { url: drawable(httpsUrl(attr(unitImg, 'src'))), width: +attr(unitImg, 'width') || 0, height: +attr(unitImg, 'height') || 0, tone: plate || onTone };
  } else if (kind === 'generated' && !page && httpsUrl(design.logoUnitUrl)) {
    /* only for a site never saved: a saved page without the picture has its unit set in type */
    var planTone = /^(dark|light)$/.test(design.logoUnitPlate) ? design.logoUnitPlate
      : /^(dark|light)$/.test(design.logoUnitHeroMode) ? design.logoUnitHeroMode : (design.mode === 'dark' ? 'dark' : mode);
    unit = { url: drawable(httpsUrl(design.logoUnitUrl)), width: +design.logoUnitWidth || 0, height: +design.logoUnitHeight || 0, tone: planTone };
  } else if (kind === 'ported') {
    /* an ET banner's logo IS the lock-up (img.logo, bound to the event's logo) */
    var bannerLogo = banner ? domutils.findOne(function (e) { return e.name === 'img' && hasClass(e, 'logo') && !!httpsUrl(attr(e, 'src')); }, banner.children || [], true) : null;
    var lu = first(drawable(bannerLogo && httpsUrl(attr(bannerLogo, 'src'))), drawable(httpsUrl(ev.logoUrl)));
    if (lu && !isSample(lu, samples)) unit = { url: lu, width: 0, height: 0, tone: '' };
  }

  if (unit && !unit.url) unit = null;
  var navLogo = page ? page.one(function (e) { return e.name === 'img' && e.attribs && 'data-rv-logo' in e.attribs && !!httpsUrl(attr(e, 'src')); }) : null;
  var eventLogoUrl = first(drawable(httpsUrl(ev.logoUrl)), drawable(navLogo && httpsUrl(attr(navLogo, 'src'))));

  /* the hero picture */
  var hero = '';
  if (page) {
    if (kind === 'ported') {
      var bannerImg = banner ? domutils.findOne(function (e) { return e.name === 'img' && hasClass(e, 'banner-bg-image'); }, banner.children || [], true) : null;
      hero = bannerImg ? pictureUrl(attr(bannerImg, 'src')) : '';
    } else {
      var heroSec = page.sections.filter(function (s) { return s.key === 'hero' || s.name.toLowerCase() === 'hero'; })[0];
      if (heroSec) {
        var bgUrl = /background(?:-image)?\s*:[^;}]*url\(\s*["']?([^"')]+)/i.exec(page.sectionCss[heroSec.key] || page.sectionCss.hero || '');
        hero = first(bgUrl && pictureUrl(bgUrl[1]), heroSec.pictures.map(pictureUrl).filter(function (u) {
          return u && (!unit || u !== unit.url) && u !== eventLogoUrl && !/\/templates\/_shared\//.test(u) && !/\.svg(\?|$)/i.test(u);
        })[0]);
      }
    }
  }
  if (isSample(hero, samples)) hero = '';
  hero = drawable(hero);
  var settings = ev.settings && typeof ev.settings === 'object' ? ev.settings : {};
  var planSections = Array.isArray(plan.sections) ? plan.sections : [];
  var sectionPictures = planSections.map(function (s) { return drawable(httpsUrl(s && s.imageUrl)); }).filter(Boolean);
  var gallery = (src.gallery || []).map(function (u) { return drawable(httpsUrl(u)); }).filter(Boolean);
  hero = first(hero,
    kind === 'generated' ? drawable(httpsUrl(design.heroImageUrl)) : '',
    kind !== 'generated' && !isSample(ev.bannerUrl, samples) ? drawable(httpsUrl(ev.bannerUrl)) : '',
    sectionPictures[0], drawable(httpsUrl(settings.seo && settings.seo.shareImageUrl)), gallery[0]);

  /* the site's own pictures: those on its saved page that are this event's own files (or, for an imported
     site, its import's pictures), the plan's section pictures, the gallery */
  var own = src.bucket && src.eventId ? 'https://storage.googleapis.com/' + src.bucket + '/events/' + src.eventId + '/' : null;
  var imported = own && importId ? 'https://storage.googleapis.com/' + src.bucket + '/events/import-' + importId + '/images/' : null;
  var pagePictures = [];
  if (page && own) {
    page.sections.forEach(function (s) {
      if (s.hidden) return;                     // not on the site
      var bg = /url\(\s*["']?([^"')]+)/gi, m;
      var found = s.pictures.slice();
      while ((m = bg.exec(page.sectionCss[s.key] || ''))) found.push(m[1]);
      found.forEach(function (u) {
        if (u.indexOf(own) === 0 && /\/(generated|gallery|media|banner)\//.test(u.slice(own.length - 1)) && !/logo-unit\./.test(u)) pagePictures.push(u);
        else if (imported && u.indexOf(imported) === 0 && drawable(u) && !/\.svg(\?|$)/i.test(u) && u !== eventLogoUrl) pagePictures.push(u);
      });
    });
  }
  var pictures = unique(pagePictures.concat(sectionPictures, gallery)).filter(function (u) { return u !== hero; }).slice(0, 40);

  return {
    kind: kind, mode: mode,
    colours: { theme: theme, accent: accent, background: bg, surface: surface, text: text, muted: muted, heading: heading, onTheme: readableOn(theme) },
    fonts: fonts,
    radius: radius,
    logoUnit: unit,
    eventLogoUrl: eventLogoUrl,
    heroImageUrl: hero,
    pictures: pictures,
    logoUnitParts: genDesign.logoUnitParts(ev.name || '', design.logoUnit)
  };
}

/* ---------- the event ---------- */

/* "#GCCAnnualConclave", "#Tech500Summit27": the name without its year, each word capitalised (a word in
   capitals that is short enough to be an initialism — GCC, CIO, AI — kept as it is), letters and digits
   only, then the year in two digits (the start date's, else a year in the name). At most 30 characters:
   filler words go first, then words from the end, and a single word too long is shortened before the year. */
var HASHTAG_FILLER = /^(the|a|an|of|for|and|in|on|at|by|to|with)$/i;
var HASHTAG_SPARE = /^(annual|edition|\d+(st|nd|rd|th)|summit|forum|conference|india)$/i;
function hashtagOf(name, start) {
  var raw = String(name || ''), year = '';
  var words = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  var allCaps = !/[a-z]/.test(raw);
  words = words.filter(function (w) {
    if (/^(19|20)\d\d$/.test(w)) { year = year || w.slice(2); return false; }
    return !HASHTAG_FILLER.test(w);
  }).map(function (w) {
    if (/^[A-Z0-9]+$/.test(w) && /[A-Z]/.test(w) && w.length <= (allCaps ? 3 : 5)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
  var m = /^(\d{4})-\d{2}-\d{2}/.exec(String(start || ''));
  if (m) year = m[1].slice(2);
  if (!words.length) return '';
  function tag() { return '#' + words.join('') + year; }
  for (var i = words.length - 1; tag().length > 30 && i >= 0 && words.length > 1; i--) {
    if (HASHTAG_SPARE.test(words[i])) words.splice(i, 1);
  }
  while (tag().length > 30 && words.length > 1) words.pop();
  /* one word still too long: the word is shortened, never the year */
  if (tag().length > 30) words[0] = words[0].slice(0, 30 - 1 - year.length);
  return tag();
}

/* "7th Edition" when the name or the description says so, else '' */
var ORDINAL_WORDS = { first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th',
  eleventh: '11th', twelfth: '12th', thirteenth: '13th', fourteenth: '14th', fifteenth: '15th', twentieth: '20th', 'twenty-fifth': '25th' };
function editionOf(name, description) {
  var texts = [String(name || ''), String(description || '')];
  for (var i = 0; i < texts.length; i++) {
    var m = /\b(\d{1,2})\s*(st|nd|rd|th)\s+edition\b/i.exec(texts[i]);
    if (m) return m[1] + m[2].toLowerCase() + ' Edition';
    var w = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|twentieth|twenty-fifth)\s+edition\b/i.exec(texts[i]);
    if (w) return ORDINAL_WORDS[w[1].toLowerCase()] + ' Edition';
  }
  return '';
}

/* "Jio World Centre, Mumbai" — the city left out when the venue already names it */
function placeOf(venue, city) {
  venue = oneLine(venue, 300); city = oneLine(city, 120);
  if (!venue) return city;
  if (!city || venue.toLowerCase().indexOf(city.toLowerCase()) !== -1) return venue;
  return venue + ', ' + city;
}

function ymd(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
/* the number of days the event runs, from its dates; 0 when they are not known */
function daysOf(start, end) {
  var a = ymd(start), b = ymd(end);
  if (isNaN(a)) return 0;
  if (isNaN(b)) b = a;
  var n = Math.round((b - a) / 86400000) + 1;
  return n >= 1 && n <= 60 ? n : 0;
}

/* Only real counts of the event's own records: "12+ Speakers" is twelve speakers on the site. */
function statsOf(c) {
  c = c || {};
  function stat(n, one, many) { return n > 0 ? { value: n >= 10 ? n + '+' : String(n), label: n === 1 ? one : many } : null; }
  var days = daysOf(c.start, c.end);
  return [
    stat((c.speakers || []).length, 'Speaker', 'Speakers'),
    stat((c.sessions || []).length, 'Session', 'Sessions'),
    stat((c.partners || []).length, 'Partner', 'Partners'),
    days ? { value: String(days), label: days === 1 ? 'Day' : 'Days' } : null
  ].filter(Boolean);
}

/* The brief's audience as short segments when it is a list ("CIOs; CTOs; heads of digital"), else as the
   one sentence it is. "Senior leaders from banking, insurance and fintech" is one audience: when the first
   item ends in a phrase like that, its commas list what "from" names — unless each item after it is one
   more group of people on its own ("CIOs of large banks, CTOs, CISOs" is three). */
var AUDIENCE_PHRASE = /\b(from|in|across|of|for|within|at|on|among|including|like|such as|spanning|covering)\s+\S+(\s+\S+){0,3}$/i;
var AUDIENCE_GROUP = /^[A-Z][A-Za-z]*s$/;
function audienceOf(v) {
  function clean(s) { return oneLine(s, 160).replace(/^(and|or|&)\s+/i, '').replace(/[.;,]+$/, '').trim(); }
  if (Array.isArray(v)) return unique(v.map(clean).filter(Boolean)).slice(0, 12);
  var text = String(v == null ? '' : v).trim();
  if (!text) return [];
  /* lines, semicolons and bullets always divide; commas and slashes only a run of short items, not a sentence */
  var parts = [];
  text.split(/\s*[;\n\r•]\s*/).forEach(function (line) {
    if (!clean(line)) return;
    var items = line.split(/\s*(?:,|\s\/\s|(?<=[a-z])\/(?=[A-Z]))\s*/).map(clean).filter(Boolean);
    var list = items.length >= 2 && items.every(function (p) { return p.split(/\s+/).length <= 7 && !/\b(is|are|was|were|who|will|want|wants|looking)\b/i.test(p); }) &&
      !(AUDIENCE_PHRASE.test(items[0]) && !items.slice(1).every(function (p) { return AUDIENCE_GROUP.test(p); }));
    parts = parts.concat(list ? items : [clean(oneLine(line, 300))]);
  });
  return unique(parts.map(function (p) { return p.slice(0, 160); })).slice(0, 12);
}

/* the brief's tracks; its key messages only when it names no tracks */
function topicsOf(brief) {
  brief = brief || {};
  var tracks = (Array.isArray(brief.tracks) ? brief.tracks : []).map(function (t) { return oneLine(t, 140); }).filter(Boolean);
  if (tracks.length) return unique(tracks).slice(0, 12);
  return unique((Array.isArray(brief.keyMessages) ? brief.keyMessages : []).map(function (t) { return oneLine(t, 220); }).filter(Boolean)).slice(0, 6);
}

/* publicSiteData's records (confirmed speakers and partners only, no contact details of theirs), in the
   kit's own field names */
function contentFrom(site, brief, ev) {
  site = site || {};
  var groups = {}, tiers = {}, days = {}, names = {};
  (site.speakerGroups || []).forEach(function (g) { groups[g.id] = g.name; });
  (site.partnerTiers || []).forEach(function (t) { tiers[t.id] = t.name; });
  (site.agendaGroups || []).forEach(function (g) { days[g.id] = g.name || g.date || ''; });
  var speakers = (site.speakers || []).map(function (s) {
    names[s.id] = s.name;
    return { id: s.id, name: s.name, designation: s.desig || '', company: s.comp || '', photoUrl: s.photoUrl || '', group: groups[s.groupId] || '' };
  });
  var partners = (site.partners || []).map(function (p) {
    return { id: p.id, name: p.name || '', logoUrl: p.logoUrl || '', tier: tiers[p.tierId] || '', url: p.url || '' };
  });
  var sessions = (site.sessions || []).map(function (s) {
    return { id: s.id, title: s.title, start: s.start || '', end: s.end || '', day: days[s.groupId] || '',
      speakers: (s.speakerIds || []).map(function (id) { return names[id]; }).filter(Boolean) };
  });
  var contacts = (site.contacts || []).map(function (c) { return { label: c.label || '', name: c.name || '', email: c.email || '', phone: c.phone || '' }; });
  var social = (site.social || []).map(function (s) { return { kind: s.kind, url: s.url }; });
  ev = ev || {};
  return {
    /* the description's headings are the owner's brief, not copy (owner-brief.js): its free text only */
    overview: ownerBrief.withoutHeadings(ev.description).slice(0, 8000) || oneLine(brief && brief.theme, 1200),
    speakers: speakers, partners: partners, sessions: sessions,
    audience: audienceOf(brief && brief.audience),
    topics: topicsOf(brief),
    stats: statsOf({ speakers: speakers, partners: partners, sessions: sessions, start: ev.start, end: ev.end }),
    contacts: contacts, social: social
  };
}

/* The stored category is a code; people (and the AI) read its label. The same table as RevampCore.TYPES
   (edit-event-core.js), which the browser keeps; a code not in it has no label rather than a made-up one. */
var CATEGORY_LABELS = { ip: 'IP Event', client: 'Client Event', editorial: 'Editorial', leadgen: 'Lead-Gen Microsite', roundtable: 'Round Table', awards: 'Awards' };
function categoryLabelOf(ev) {
  return oneLine(ev.categoryLabel, 80) || ownEntry(CATEGORY_LABELS, String(ev.category || '').toLowerCase()) || '';
}

function eventFrom(eventId, ev, siteUrl, anchor) {
  var start = oneLine(ev.start, 40), end = oneLine(ev.end, 40);
  return {
    id: eventId, name: oneLine(ev.name, 300) || eventId, category: oneLine(ev.category, 60), categoryLabel: categoryLabelOf(ev), start: start, end: end,
    dateLabel: genDesign.dateLabel(start, end) || oneLine(ev.dateLabel, 120),
    place: placeOf(ev.venue, ev.city), venue: oneLine(ev.venue, 300), city: oneLine(ev.city, 120),
    description: ownerBrief.withoutHeadings(ev.description).slice(0, 8000),
    siteUrl: siteUrl, registerUrl: siteUrl + (anchor || ''),
    published: ev.published === true,
    hashtag: hashtagOf(ev.name, start),
    edition: editionOf(ev.name, ev.description)
  };
}

/* ---------- picture addresses the proxy will fetch ---------- */

var IMAGE_HOSTS = ['img.etb2bimg.com', 'st.etb2bimg.com', 'img.b2bstatic.com'];
/* The import an imported site was made from ('imported-<importId>' as its template), whose pictures the
   import stored under events/import-<importId>/images/. Read off the event's own document, never taken
   from the caller. */
function importIdOf(ev) {
  var m = /^imported-([a-z0-9][a-z0-9-]{0,59})$/.exec(String((ev && (ev.templateId || (ev.site && ev.site.templateId))) || ''));
  return m ? m[1] : '';
}
/* -> '' when /api/promo/image may fetch this address for this event, else why not. Our bucket only under
   this event's own folder (and, for an imported site, its import's pictures folder); ET's image hosts;
   https on the standard port; nothing else. */
function imageUrlProblem(raw, bucket, eventId, importId) {
  var u;
  try { u = new URL(String(raw == null ? '' : raw).trim()); } catch (e) { return 'That is not a picture address.'; }
  if (u.protocol !== 'https:') return 'Only https picture addresses can be loaded.';
  if (u.username || u.password || (u.port && u.port !== '443')) return 'That picture address cannot be loaded.';
  var host = u.hostname.toLowerCase();
  if (IMAGE_HOSTS.indexOf(host) !== -1) return '';
  if (host === 'storage.googleapis.com' && bucket && eventId && !/%2f|%5c|%2e%2e|\\/i.test(u.pathname) &&
      (u.pathname.indexOf('/' + bucket + '/events/' + eventId + '/') === 0 ||
       (importId && u.pathname.indexOf('/' + bucket + '/events/import-' + importId + '/images/') === 0))) return '';
  return 'Pictures can only be loaded from this event\'s own files or from ET\'s image servers.';
}
/* could this address pass for some imported site? (which one is the event's to say) */
function inSomeImport(raw, bucket) {
  return !!bucket && String(raw || '').trim().indexOf('https://storage.googleapis.com/' + bucket + '/events/import-') === 0;
}

/* ---------- checks that need the network (cached for the life of the process) ---------- */

/* A Google Fonts address that answers 400 gives the browser nothing: a family that is not on Google Fonts,
   or one asked for in weights it does not have (googleFontUrl asks for 300–800; a one-weight family then
   fails as a whole). -> the address, the same family without weights, or '' when neither loads. A network
   failure keeps the address: it cannot be judged from here. */
var fontChecks = {};
var CHECK_TTL_MS = 6 * 3600 * 1000;
function fetchStatus(url) {
  return safeFetch(url, { timeoutMs: 4000, maxBytes: 512 * 1024, maxRedirects: 1 }).then(function (r) { return r.status; }, function () { return 0; });
}
function checkFontCss(url) {
  if (!/^https:\/\/fonts\.googleapis\.com\//.test(url)) return Promise.resolve(url);
  var hit = fontChecks[url];
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.result;
  var result = fetchStatus(url).then(function (status) {
    if (status === 200 || status === 0) return url;
    var bare = url.replace(/:(?:ital,)?(?:opsz,)?wght@[^&]*/g, '');
    if (bare === url) return '';
    return fetchStatus(bare).then(function (s) { return s === 200 ? bare : ''; });
  });
  fontChecks[url] = { at: Date.now(), result: result };
  return result;
}

/* the size and, for an SVG, the tone of a logo unit whose page did not say */
var unitChecks = {};
function measureUnit(unit) {
  if (!unit || (unit.width && unit.height && unit.tone)) return Promise.resolve(unit);
  var hit = unitChecks[unit.url];
  var info = hit && Date.now() - hit.at < CHECK_TTL_MS ? hit.result : null;
  if (!info) {
    info = safeFetch(unit.url, { timeoutMs: 5000, maxBytes: 8 * 1024 * 1024, maxRedirects: 0 }).then(function (r) {
      if (r.status !== 200) return null;
      var i = logoUnitLib.imageInfo(r.body);
      var tone = '';
      if (i.type === 'svg') {
        var t = logoUnitLib.svgTone(r.body.toString('utf8'));
        tone = t === 'for-dark' ? 'dark' : t === 'for-light' ? 'light' : '';
      }
      return { width: Math.round(+i.width || 0), height: Math.round(+i.height || 0), tone: tone };
    }, function () { return null; });
    unitChecks[unit.url] = { at: Date.now(), result: info };
  }
  return info.then(function (i) {
    if (!i) return unit;
    return Object.assign({}, unit, { width: unit.width || i.width, height: unit.height || i.height, tone: unit.tone || i.tone });
  });
}

/* ---------- building the kit ---------- */

/* -> Promise<Kit>. opts.brand false leaves the brand out (the AI copy needs the facts only).
   Every read starts at once — the event, its saved page, its records, its brief — rather than one after
   the other: each is a round trip to Firestore or Storage. The page is used only when the event says its
   site was saved (an address can be reused, and a page left from before must never be read as this
   event's), and only the live event's answer is sent. */
/* ---------- the ET B2B portal an event belongs to ----------
   Read from the address of the event's previous edition (cio.economictimes.indiatimes.com -> ETCIO). The
   mailers sign off as the portal and put its wordmark in the logo bar, as ET's own sends do. Names and
   wordmarks are the promotional platform's portal roster (templates/_shared/img/portals: <slug>.png is the
   dark-ink wordmark, <slug>-light.png the light-ink one). */
var PORTALS = require('./et-events').PORTALS; // the roster lives with the event lookup (et-events.js)
var PORTAL_IMG = path.join(__dirname, '..', '..', 'templates', '_shared', 'img', 'portals');
function portalOf(urls) {
  for (var i = 0; i < urls.length; i++) {
    var m = /^https?:\/\/([a-z0-9-]+)\.economictimes\.indiatimes\.com(?:[\/:?#]|$)/i.exec(String(urls[i] || ''));
    var slug = m && m[1].toLowerCase();
    if (slug && PORTALS[slug]) {
      var file = function (f) { try { return fs.existsSync(path.join(PORTAL_IMG, f)) ? '/templates/_shared/img/portals/' + f : ''; } catch (e) { return ''; } };
      return { slug: slug, name: PORTALS[slug], logo: file(slug + '.png'), logoLight: file(slug + '-light.png') };
    }
  }
  return null;
}

function buildKit(fb, eventId, req, opts) {
  opts = opts || {};
  var ref = fb.db.collection('events').doc(eventId);
  var pageRead = H.readObject(fb, H.sitePath(eventId, 'page.html')).then(null, function (err) {
    console.error('promo: the saved page of ' + eventId + ' could not be read — ' + (err && err.message));
    return null;
  });
  var siteRead = publicSiteData(fb, eventId, { admin: true });
  var briefRead = ref.collection('briefs').orderBy('createdAt', 'desc').limit(1).get().then(function (s) {
    return s.empty ? null : (s.docs[0].data() || {}).extracted || null;
  }, function () { return null; });
  /* nobody waits on these when the event turns out not to be there */
  [pageRead, siteRead].forEach(function (p) { p.catch(function () {}); });
  return H.loadLiveEvent(fb, eventId).then(function (ev) {
    var templateId = String(ev.templateId || (ev.site && ev.site.templateId) || '');
    var planFrom = /^gen-/.test(templateId) ? templateId.slice(4) : '';
    /* an AI-designed site's plan is on its own event, unless the site was designed for another one */
    /* (a plan that holds only the section edges — a setting saved on a site the AI did not design — is not one) */
    var ownPlan = ev.designPlan && typeof ev.designPlan === 'object' &&
      !(ev.designPlan.design && Object.keys(ev.designPlan).length === 1 && Object.keys(ev.designPlan.design).join() === 'sectionEdges');
    var plan = ownPlan ? Promise.resolve(ev.designPlan)
      : (planFrom && planFrom !== eventId && /^[a-z0-9][a-z0-9-]*$/.test(planFrom)
        ? fb.db.collection('events').doc(planFrom).get().then(function (s) { return s.exists ? (s.data() || {}).designPlan || null : null; }, function () { return null; })
        : Promise.resolve(null));
    return Promise.all([plan, pageRead, siteRead, briefRead]).then(function (r) {
      var site = r[2] || {}, page = H.siteVersionOf(ev) > 0 ? readSavedPage(r[1]) : null;
      var siteUrl = H.publicBaseFor(req) + '/e/' + eventId;
      var kit = {
        event: eventFrom(eventId, ev, siteUrl, registerAnchor(page)),
        content: contentFrom(site, r[3], ev)
      };
      if (opts.brand === false) return kit;
      var brand = brandFromSources({
        eventId: eventId, bucket: fb.bucket && fb.bucket.name, event: ev, plan: r[0], page: page,
        template: templateFiles(templateId), gallery: (site.gallery || []).map(function (g) { return g.imageUrl; }),
        googleFontUrl: H.googleFontUrl
      });
      return Promise.all([checkFontCss(brand.fonts.heading.cssUrl), checkFontCss(brand.fonts.body.cssUrl), measureUnit(brand.logoUnit)]).then(function (c) {
        brand.fonts.heading.cssUrl = c[0]; brand.fonts.body.cssUrl = c[1];
        brand.logoUnit = c[2];
        if (brand.logoUnit && !brand.logoUnit.tone) brand.logoUnit.tone = brand.mode;
        var plan = r[0] || {}, design = plan.design || {};
        brand.portal = portalOf([plan.reference && plan.reference.url, design.logoUnitFrom, ev.previousEditionUrl]);
        return { event: kit.event, brand: brand, content: kit.content };
      });
    });
  });
}

function queryOf(req) { return new URLSearchParams(String(req.url || '').split('?')[1] || ''); }

/* GET /api/promo/kit?eventId= -> the Kit */
function handleKit(req, res) {
  H.withAdmin(req, res, function (fb) {
    var eventId = H.eventIdOr400(res, queryOf(req).get('eventId'));
    if (!eventId) return;
    buildKit(fb, eventId, req, {}).then(function (kit) { sendJson(res, 200, kit); })
      .catch(function (err) { H.sendFailure(res, 'promo kit', err, 'Could not load this event\'s brand and content. Please try again.'); });
  });
}

/* GET /api/promo/image?eventId=&url= -> the picture's bytes. Only this event's own files and ET's image
   hosts (imageUrlProblem); never a redirect elsewhere; a picture is what its bytes say it is, not what the
   other server called it; an SVG that could run anything is refused. */
var IMAGE_MAX_BYTES = 8 * 1024 * 1024;
function handleImage(req, res) {
  H.withAdmin(req, res, function (fb) {
    var qs = queryOf(req);
    var eventId = H.eventIdOr400(res, qs.get('eventId'));
    if (!eventId) return;
    var url = String(qs.get('url') || '').trim();
    var bucket = fb.bucket && fb.bucket.name;
    var problem = imageUrlProblem(url, bucket, eventId);
    /* an address in an import's folder waits for the event: only its own document says which import it is */
    if (problem && !inSomeImport(url, bucket)) return sendJson(res, 400, { error: problem, code: 'image-not-allowed' });
    H.loadLiveEvent(fb, eventId).then(function (ev) {
      if (problem && imageUrlProblem(url, bucket, eventId, importIdOf(ev))) throw H.httpError(400, problem, { code: 'image-not-allowed' });
      return safeFetch(url, { timeoutMs: 10000, maxBytes: IMAGE_MAX_BYTES, maxRedirects: 0 }).then(null, function (err) {
        var timeout = err && err.code === 'timeout';
        throw H.httpError(timeout ? 504 : 502, timeout ? 'The picture took too long to load. Please try again.'
          : err && err.code === 'too-large' ? 'That picture is too large (over 8 MB).' : 'The picture could not be loaded.', { code: 'image-unavailable' });
      });
    }).then(function (r) {
      if (r.status === 404 || r.status === 403 || r.status === 410) throw H.httpError(404, 'That picture is no longer there.', { code: 'image-missing' });
      if (r.status !== 200) throw H.httpError(502, 'The picture could not be loaded.', { code: 'image-unavailable' });
      var info = logoUnitLib.imageInfo(r.body);
      if (!info.mime) throw H.httpError(415, 'That address is not a picture.', { code: 'not-an-image' });
      var headers = { 'Content-Type': info.mime, 'Content-Length': r.body.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
      if (info.type === 'svg') {
        if (logoUnitLib.svgIsActive(r.body.toString('utf8'))) throw H.httpError(415, 'That SVG picture carries scripts or links, so it cannot be used.', { code: 'svg-active' });
        headers['Content-Security-Policy'] = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox";
      }
      res.writeHead(200, headers);
      res.end(r.body);
    }).catch(function (err) { H.sendFailure(res, 'promo image', err, 'The picture could not be loaded.'); });
  });
}

/* ---------- the AI copy ---------- */

/* What a post or a mailer of each kind is for, so the copy fits it. A kind not named here gets the
   general note. */
var KIND_NOTES = {
  announcement: 'announces the event: what it is, when and where, why it matters',
  'save-the-date': 'asks the reader to keep the date free',
  speaker: 'introduces one speaker who will speak at the event',
  speakers: 'presents speakers who will speak at the event',
  agenda: 'presents the agenda or a session of it',
  session: 'presents one session of the agenda',
  partners: 'thanks and presents the event\'s partners',
  partner: 'thanks and presents one partner of the event',
  register: 'asks the reader to register',
  registration: 'asks the reader to register',
  invitation: 'invites the reader to attend',
  reminder: 'reminds the reader that the event is coming up',
  countdown: 'counts down to the event',
  'last-call': 'is the last call to register',
  stats: 'presents the event in numbers',
  topics: 'presents the themes the event covers',
  'thank-you': 'thanks the people who attended',
  newsletter: 'gives the reader an update about the event'
};
/* own keys only: "constructor" or "toString" sent as a type or a network must not find Object's own */
function ownEntry(table, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null; }
function kindNote(kind) { return ownEntry(KIND_NOTES, kind) || 'promotes the event'; }
function kindOf(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9 _-]+/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 40); }

var NETWORKS = {
  linkedin: { label: 'LinkedIn', max: 1200, note: 'Professional and specific. 3 to 6 short paragraphs or lines, under 1,100 characters. End with the registration link on its own line, then the hashtag and at most two other relevant hashtags. No emojis.' },
  instagram: { label: 'Instagram', max: 2200, note: 'Warm and direct, under 1,200 characters, short lines. Links cannot be clicked on Instagram, so do not put a web address in it. End with the hashtag and up to five other relevant hashtags. At most two emojis, or none.' },
  x: { label: 'X (Twitter)', max: 280, note: 'One or two short sentences. The WHOLE post must be under 250 characters, including the registration link and the hashtag. No other hashtags. No emojis.' }
};

/* The event as the model may describe it — and nothing else. */
function factSheet(kit) {
  var e = kit.event, c = kit.content, lines = [];
  function add(label, v) { if (v) lines.push(label + ': ' + v); }
  add('Event', e.name);
  add('Edition', e.edition);
  add('Category', e.categoryLabel);
  add('Dates', e.dateLabel);
  add('Place', e.place);
  add('Website', e.siteUrl);
  add('Registration link', e.registerUrl);
  /* the address is the one the site will have; until it is published it leads nowhere — the copy comes
     back with a warning saying so (handleWrite), and the model is told so it does not write it into the copy */
  if (!e.published && (e.siteUrl || e.registerUrl)) lines.push('(The site is not published yet, so these links work only once it is. Give them exactly as written anyway, and do not mention publishing.)');
  add('Hashtag', e.hashtag);
  add('Overview', oneLine(c.overview, 900));
  if (c.audience.length) add('Who it is for', c.audience.join('; '));
  if (c.topics.length) add('Themes', c.topics.slice(0, 10).join('; '));
  if (c.stats.length) add('Numbers (counts of what is on the site)', c.stats.map(function (s) { return s.value + ' ' + s.label; }).join(', '));
  if (c.speakers.length) {
    lines.push('Speakers (' + c.speakers.length + '):');
    c.speakers.slice(0, 24).forEach(function (s) { lines.push('- ' + s.name + [s.designation, s.company].filter(Boolean).map(function (x) { return ', ' + x; }).join('')); });
  }
  if (c.partners.length) {
    lines.push('Partners (' + c.partners.length + '):');
    c.partners.slice(0, 24).forEach(function (p) { if (p.name) lines.push('- ' + p.name + (p.tier ? ' (' + p.tier + ')' : '')); });
  }
  if (c.sessions.length) {
    lines.push('Agenda (' + c.sessions.length + ' sessions):');
    c.sessions.slice(0, 14).forEach(function (s) {
      lines.push('- ' + s.title + (s.day ? ' [' + s.day + ']' : '') + (s.start ? ' ' + s.start : '') + (s.speakers.length ? ' — ' + s.speakers.join(', ') : ''));
    });
  }
  return lines.join('\n');
}

var GROUND_RULES = [
  'Use ONLY the facts in the fact sheet and in the piece\'s own text below.',
  'Invent nothing: no names, numbers, dates, prices, quotes, testimonials, awards, rankings, outcomes or claims that are not written there',
  '(no "India\'s biggest", no "500+ leaders" unless that exact number is given, no "limited seats" unless it is said).',
  'When a fact is missing, leave it out rather than guess. Write in British English, in plain text: no markdown, no asterisks.'
].join(' ');

/* The piece the copy is for, as the screen sent it: its own words only, short. */
function pieceText(piece) {
  if (!piece || typeof piece !== 'object') return '';
  var lines = [];
  Object.keys(piece).slice(0, 30).forEach(function (k) {
    if (k === 'type' || !/^[A-Za-z][\w-]{0,40}$/.test(k)) return;
    var v = piece[k];
    if (Array.isArray(v)) v = v.filter(function (x) { return typeof x === 'string' || typeof x === 'number'; }).slice(0, 20).join('; ');
    if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
    if (typeof v === 'string' && v.trim()) lines.push(k + ': ' + oneLine(v, 600));
  });
  return lines.join('\n').slice(0, 3000);
}

/* the limits the prompts state are the limits the answers are cut to */
var SUBJECT_MAX = 70, PREHEADER_MAX = 110, SUBJECT_OPTIONS = 5, HEADLINE_WORDS = 8;
var SCHEMAS = {
  text: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
  subjects: { type: 'OBJECT', properties: { options: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    subject: { type: 'STRING', description: 'At most ' + SUBJECT_MAX + ' characters.' }, preheader: { type: 'STRING', description: 'At most ' + PREHEADER_MAX + ' characters; adds to the subject, never repeats it.' } }, required: ['subject', 'preheader'] } } }, required: ['options'] },
  headlines: { type: 'OBJECT', properties: { options: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['options'] }
};

/* -> { prompt, schema, task } or { error } (400). */
function writeRequest(body, kit) {
  var task = String(body.task || '');
  var facts = 'FACT SHEET\n' + factSheet(kit);
  if (task === 'caption') {
    var net = ownEntry(NETWORKS, body.network);
    if (!net) return { error: '"network" must be linkedin, instagram or x.' };
    var post = body.post && typeof body.post === 'object' ? body.post : {};
    var kind = kindOf(post.type);
    return { task: task, schema: SCHEMAS.text, prompt: [
      'Write the ' + net.label + ' caption for a social media post of the event below. The post ' + kindNote(kind) + '.',
      net.note,
      'Use the hashtag ' + (kit.event.hashtag || '(none given)') + ' exactly as written.',
      GROUND_RULES,
      facts,
      'THE POST\'S OWN TEXT\n' + (pieceText(post) || '(none)'),
      'Answer with { "text": "<the caption>" }.'
    ].join('\n\n') };
  }
  if (task === 'subjects') {
    var mailer = body.mailer && typeof body.mailer === 'object' ? body.mailer : {};
    return { task: task, schema: SCHEMAS.subjects, prompt: [
      'Write five different subject lines, each with its preheader, for an e-mail about the event below. The e-mail ' + kindNote(kindOf(mailer.type)) + '.',
      'Each subject at most ' + SUBJECT_MAX + ' characters, specific to this event (its name or its strongest real fact), no clickbait, no ALL CAPS, no emojis. Each preheader at most ' + PREHEADER_MAX + ' characters and adds something the subject does not say.',
      GROUND_RULES,
      facts,
      'THE E-MAIL\'S OWN TEXT\n' + (pieceText(mailer) || '(none)'),
      'Answer with { "options": [ { "subject": "...", "preheader": "..." }, … five of them ] }.'
    ].join('\n\n') };
  }
  if (task === 'intro') {
    var m = body.mailer && typeof body.mailer === 'object' ? body.mailer : {};
    var current = oneLine(body.current, 1500);
    return { task: task, schema: SCHEMAS.text, prompt: [
      'Write the opening paragraph of an e-mail about the event below. The e-mail ' + kindNote(kindOf(m.type || body.type)) + '.',
      'One paragraph, at most 80 words, addressed to the reader ("you"), no greeting line (the e-mail has its own), no sign-off.' + (current ? ' Improve on the current paragraph; keep what is true in it.' : ''),
      GROUND_RULES,
      facts,
      current ? 'THE CURRENT PARAGRAPH\n' + current : '',
      'THE E-MAIL\'S OWN TEXT\n' + (pieceText(m) || '(none)'),
      'Answer with { "text": "<the paragraph>" }.'
    ].filter(Boolean).join('\n\n') };
  }
  if (task === 'headline') {
    var p = body.post && typeof body.post === 'object' ? body.post : {};
    var now = oneLine(body.current, 300);
    return { task: task, schema: SCHEMAS.headlines, prompt: [
      'Write four different headlines for a social media post of the event below. The post ' + kindNote(kindOf(p.type || body.type)) + '.',
      'Each at most ' + HEADLINE_WORDS + ' words, punchy and specific to this event, no full stop at the end, no emojis, no hashtags.' + (now ? ' The current headline is "' + now + '": offer better ones, not the same.' : ''),
      GROUND_RULES,
      facts,
      'THE POST\'S OWN TEXT\n' + (pieceText(p) || '(none)'),
      'Answer with { "options": [ "...", "...", "...", "..." ] }.'
    ].join('\n\n') };
  }
  return { error: '"task" must be caption, subjects, intro or headline.' };
}

/* ---------- what the model wrote, made safe and the right length ---------- */

function plainText(v) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\*\*|__|`/g, '').replace(/<[^>]{0,200}>/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/* at most `max` characters, ended at a word (never in the middle of a link or a hashtag) */
function cutChars(text, max) {
  if (text.length <= max) return text;
  var cut = text.slice(0, max + 1), at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return (at > max * 0.6 ? cut.slice(0, at) : text.slice(0, max)).replace(/[\s,;:–—-]+$/, '').trim();
}
function cutWords(text, max) {
  var words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  var kept = words.slice(0, max).join(' ');
  var stop = Math.max(kept.lastIndexOf('. '), kept.lastIndexOf('! '), kept.lastIndexOf('? '));
  return stop >= kept.length * 0.5 ? kept.slice(0, stop + 1) : kept.replace(/[,;:–—-]+$/, '') + '…';
}

/* -> the answer, or null when nothing usable came back */
function cleanWrite(req, parsed, kit, body) {
  parsed = parsed || {};
  if (req.task === 'caption') {
    var net = ownEntry(NETWORKS, body.network), text = plainText(parsed.text);
    if (!net || !text) return null;
    /* the event's hashtag always survives: a caption that has it and fits is left as written; otherwise the
       tag is taken out, the rest cut to leave room for it, and the tag put back at the end */
    var tag = kit.event.hashtag;
    if (!tag) return { text: cutChars(text, net.max) };
    var tagRe = new RegExp('(^|\\s)' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_])', 'gi');
    var has = tagRe.test(text);
    tagRe.lastIndex = 0;
    if (has && text.length <= net.max) return { text: text };
    var sep = body.network === 'x' ? ' ' : '\n\n';
    var rest = text.replace(tagRe, '$1').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    rest = cutChars(rest, net.max - sep.length - tag.length);
    return { text: rest ? rest + sep + tag : tag };
  }
  if (req.task === 'intro') {
    var intro = plainText(parsed.text).replace(/\n+/g, ' ');
    return intro ? { text: cutWords(intro, 90) } : null;
  }
  if (req.task === 'subjects') {
    var seen = {}, options = (Array.isArray(parsed.options) ? parsed.options : []).map(function (o) {
      o = o || {};
      return { subject: cutChars(oneLine(plainText(o.subject), 300), SUBJECT_MAX), preheader: cutChars(oneLine(plainText(o.preheader), 400), PREHEADER_MAX) };
    }).filter(function (o) {
      var key = o.subject.toLowerCase();
      if (!o.subject || seen[key]) return false;
      seen[key] = 1;
      return true;
    }).slice(0, SUBJECT_OPTIONS);
    /* five different subjects were asked for; fewer is a bad answer, worth one more try */
    return options.length === SUBJECT_OPTIONS ? { options: options } : null;
  }
  if (req.task === 'headline') {
    var heads = unique((Array.isArray(parsed.options) ? parsed.options : []).map(function (h) {
      return cutWords(oneLine(plainText(h), 200).replace(/^["“']+|["”']+$/g, '').replace(/[.]+$/, ''), HEADLINE_WORDS).replace(/…$/, '');
    }).filter(Boolean)).slice(0, 4);
    return heads.length ? { options: heads } : null;
  }
  return null;
}

/* -> a sentence for the owner when the copy carries the site's address and the site is not live yet, else '' */
function writeWarning(req, answer, kit) {
  var e = kit.event;
  if (e.published || !e.siteUrl) return '';
  var text = answer.text || (answer.options || []).map(function (o) { return typeof o === 'string' ? o : o.subject + ' ' + o.preheader; }).join(' ');
  return text.indexOf(e.siteUrl) !== -1 ? 'This copy links to the event\'s site, which is not published yet: the link works once the site is published.' : '';
}

/* POST /api/promo/write { eventId, task, … } -> { text } | { options }, with { warning } when the copy
   links to a site that is not published yet */
function handleWrite(req, res) {
  H.withAdminBody(req, res, H.BODY_LIMITS.small, function (fb, decoded, body) {
    var eventId = H.eventIdOr400(res, body.eventId);
    if (!eventId) return;
    if (['caption', 'subjects', 'intro', 'headline'].indexOf(body.task) === -1) return sendJson(res, 400, { error: '"task" must be caption, subjects, intro or headline.' });
    buildKit(fb, eventId, req, { brand: false }).then(function (kit) {
      var ask = writeRequest(body, kit);
      if (ask.error) return sendJson(res, 400, { error: ask.error });
      return llm.callJson(ask.prompt, ask.schema, {
        route: 'promo-write', eventId: eventId, user: decoded && decoded.email, timeoutMs: 45000, maxOutputTokens: 4096,
        onUsage: H.aiUsageRecorder(fb, eventId, 'promo-write')
      }).then(function (r) {
        if (r.error) return H.sendAiFailure(res, r);
        var answer = cleanWrite(ask, r.parsed, kit, body);
        if (!answer) return sendJson(res, 502, { error: 'The AI did not return usable copy. Please try again.', code: 'ai-bad-output', retryable: true });
        var warning = writeWarning(ask, answer, kit);
        sendJson(res, 200, warning ? Object.assign({ warning: warning }, answer) : answer);
      });
    }).catch(function (err) { H.sendFailure(res, 'promo write', err, 'Could not write the copy. Please try again.'); });
  });
}

/* lib/api.js hands over its helpers before each call (the same object every time):
   { withAdmin, withAdminBody, eventIdOr400, loadLiveEvent, readObject, sitePath, siteVersionOf, googleFontUrl,
     publicBaseFor, aiUsageRecorder, sendAiFailure, sendFailure, httpError, BODY_LIMITS } */
function wire(helpers) { H = helpers; }

module.exports = { wire, handleKit, handleImage, handleWrite };

/* the pure parts, for promo.test.js */
module.exports._test = {
  brandFromSources, templateFiles, samplePictures, registerAnchor, readSavedPage, hashtagOf, editionOf, placeOf, daysOf, statsOf,
  audienceOf, topicsOf, contentFrom, eventFrom, imageUrlProblem, importIdOf, inSomeImport, familiesInFontUrl, fontCssUrl, templateRadius,
  factSheet, writeRequest, cleanWrite, writeWarning, cutChars, cutWords
};
