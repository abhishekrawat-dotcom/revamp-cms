/* What the AI site pipeline (lib/api.js: ingest-source, plan-structure, generate-content, generated-template)
   needs that is plain computation — no network, no Firebase, no model call — so it can be tested on its own
   (gen-design.test.js).

     markupSkeleton(html, max)        a reference page reduced to its tags and class names, text cut to a few
                                      words: what the model reads to describe that page's LAYOUT
     fontFamilies(names)              real family names only (no var(), no generic or system families)
     pageTone(css, html)              'dark' | 'light' | '' — what the reference page's own background is
     artDirectionFor(eventId)         one of ART_DIRECTIONS, fixed per event: where a site with no reference
                                      to follow starts from, so two such sites do not come out alike
     palette(design, mode)            the page colours a design ends up with, readable in the asked-for mode
     clampFontSizes(css)              no text smaller than MIN_LABEL_PX in model-written CSS
     capHeadingSizes(css, html)       no section heading louder than the site's type scale (HEADING_SCALE), in
                                      every section but the hero (templates/_shared/rv-type.js, which the
                                      editor shares)
     ensureLogo(navHtml, url, name)   the event's own logo is in the top bar, whatever the model wrote
     imagePrompt(brief, design, art)  the prompt for one generated picture
     normaliseMode(v)                 'light' | 'dark' | 'auto' */

var rvType = require('../../templates/_shared/rv-type.js');

var MIN_LABEL_PX = 14;          // the smallest any text may be (labels, captions, legal lines)
var BASE_TEXT_PX = 18;          // what a paragraph is set in on a generated page
var MAX_SKELETON_CHARS = 14000;

/* ---------- reference pages ---------- */

var SKELETON_DROP = /<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi;
var SKELETON_KEEP_ATTRS = /\s(class|id|role|aria-label|alt)\s*=\s*("([^"]*)"|'([^']*)')/gi;

function skeletonTag(tag) {
  var m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag);
  if (!m) return '';
  var name = m[2].toLowerCase();
  if (m[1]) return '</' + name + '>';
  var out = '<' + name, a;
  SKELETON_KEEP_ATTRS.lastIndex = 0;
  while ((a = SKELETON_KEEP_ATTRS.exec(tag))) {
    var value = (a[3] != null ? a[3] : a[4] || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (value) out += ' ' + a[1].toLowerCase() + '="' + value + '"';
  }
  if (/\sstyle\s*=\s*["'][^"']*background(-image)?\s*:[^"']*url\(/i.test(tag)) out += ' has-background-image';
  return out + '>';
}

function markupSkeleton(html, max) {
  max = max || MAX_SKELETON_CHARS;
  var body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(String(html || ''));
  var src = (body ? body[1] : String(html || '')).replace(/<!--[\s\S]*?-->/g, '').replace(SKELETON_DROP, function (full, name) {
    return /^svg$/i.test(name) ? '<svg>' : /^iframe$/i.test(name) ? '<iframe>' : '';
  });
  var out = [], re = /<[^>]+>|[^<]+/g, m, size = 0;
  while ((m = re.exec(src)) && size < max) {
    var piece = m[0];
    if (piece[0] === '<') piece = skeletonTag(piece);
    else {
      piece = piece.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (piece.length > 40) piece = piece.slice(0, 40).replace(/\s+\S*$/, '') + '…';
    }
    if (!piece) continue;
    out.push(piece);
    size += piece.length;
  }
  return out.join('').slice(0, max);
}

var GENERIC_FAMILIES = /^(inherit|initial|unset|revert|serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|-apple-system|blinkmacsystemfont|segoe ui|arial|helvetica|helvetica neue|times|times new roman|georgia|verdana|tahoma|courier new|emoji|math|fangsong|font awesome.*|bootstrap-icons|fontawesome|material icons.*|swiper-icons|slick)$/i;

function fontFamilies(names) {
  var seen = {}, out = [];
  (names || []).forEach(function (raw) {
    var name = String(raw || '').replace(/["']/g, '').trim();
    if (!name || /[(){};:]/.test(name) || /^var\b|^--/.test(name) || GENERIC_FAMILIES.test(name)) return;
    var key = name.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    out.push(name);
  });
  return out;
}

function hexToRgb(hex) {
  var h = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, '$&$&');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function luminance(hex) {
  var c = hexToRgb(hex);
  if (!c) return null;
  function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

function contrast(a, b) {
  var la = luminance(a), lb = luminance(b);
  if (la == null || lb == null) return 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

var NAMED = { white: '#ffffff', black: '#000000' };
function colourOf(value) {
  var v = String(value || '').trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  var hex = /#([0-9a-f]{6}|[0-9a-f]{3})\b/.exec(v);
  if (hex) { var c = hexToRgb(hex[0]); return c ? '#' + [c.r, c.g, c.b].map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join('') : ''; }
  var rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (rgb) return '#' + [rgb[1], rgb[2], rgb[3]].map(function (n) { return ('0' + Math.min(255, +n).toString(16)).slice(-2); }).join('');
  return '';
}

/* The background the page itself declares: on body or html in its CSS, else on <body> in the markup. */
function pageTone(css, html) {
  var text = String(css || ''), found = '';
  var re = /(?:^|[},\s])(?:html|body)(?:\.[\w-]+)*\s*(?:,[^{]*)?\{([^}]*)\}/gi, m;
  while ((m = re.exec(text))) {
    var bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(m[1]);
    var c = bg ? colourOf(bg[1]) : '';
    if (c) found = c;
  }
  if (!found) {
    var tag = /<body\b[^>]*>/i.exec(String(html || ''));
    var inline = tag && /background(?:-color)?\s*:\s*([^;"']+)/i.exec(tag[0]);
    found = inline ? colourOf(inline[1]) : '';
  }
  if (!found) return '';
  return luminance(found) < 0.2 ? 'dark' : 'light';
}

/* ---------- a site with nothing to follow ---------- */

var ART_DIRECTIONS = [
  { id: 'editorial', label: 'Editorial magazine', note: 'A print-magazine feel: a large serif headline, generous white space, asymmetric two-column spreads, thin rules between sections, pictures set as framed editorial plates with captions.' },
  { id: 'bold-blocks', label: 'Bold colour blocks', note: 'Full-width bands of solid brand colour alternating with white, very large sans-serif headlines, chunky buttons, numbers set huge, pictures cropped hard to the edge of their band.' },
  { id: 'split-screen', label: 'Split screen', note: 'Every major section is a 50/50 split: picture on one side, text on the other, the sides alternating down the page; the hero is a split too, not a full-bleed banner.' },
  { id: 'soft-modern', label: 'Soft modern', note: 'Rounded cards on a tinted background, soft shadows, pill buttons, friendly geometric sans-serif, pictures with large corner radius, plenty of breathing room.' },
  { id: 'swiss-grid', label: 'Swiss grid', note: 'A strict 12-column grid, left-aligned everything, small uppercase section labels with numbers (01, 02…), one accent colour used sparingly, hairline dividers, pictures in exact grid modules.' },
  { id: 'cinematic', label: 'Cinematic', note: 'Full-bleed pictures with text set over them on a gradient veil, a tall immersive hero, sections that feel like film stills, condensed display type, restrained palette.' },
  { id: 'premium-serif', label: 'Quiet premium', note: 'Understated luxury: a refined serif for headings, narrow centred text columns, lots of space, a muted palette with one metallic or jewel accent, pictures small and precisely placed.' },
  { id: 'tech-gradient', label: 'Tech gradient', note: 'Gradient meshes and glassy panels, a modern grotesque typeface, glowing accent lines, bento-box grids of mixed-size tiles that combine pictures, numbers and text.' }
];

function hashOf(text) {
  var h = 2166136261;
  String(text || '').split('').forEach(function (ch) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); });
  return h >>> 0;
}

function artDirectionFor(eventId) { return ART_DIRECTIONS[hashOf(eventId) % ART_DIRECTIONS.length]; }

function normaliseMode(v) {
  v = String(v || '').trim().toLowerCase();
  return v === 'light' || v === 'dark' ? v : 'auto';
}

/* ---------- colours ---------- */

var MODE_DEFAULTS = {
  light: { backgroundColor: '#ffffff', surfaceColor: '#f5f6f8', textColor: '#16181d', mutedColor: '#5b6270' },
  dark: { backgroundColor: '#0d1017', surfaceColor: '#171b25', textColor: '#f3f4f7', mutedColor: '#a6adba' }
};

function hexOr(v, fallback) {
  var s = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
}

/* The page colours a design ends up with. `mode` is what the owner asked for ('light' | 'dark'), or 'auto':
   then the design's own choice stands. Whatever the model returned, the background really is light or dark
   as asked, and the text can be read on it. */
function palette(design, mode) {
  design = design || {};
  mode = normaliseMode(mode);
  var own = design.mode === 'dark' ? 'dark' : design.mode === 'light' ? 'light' : '';
  var bgGiven = hexOr(design.backgroundColor, '');
  var resolved = mode !== 'auto' ? mode : (own || (bgGiven && luminance(bgGiven) < 0.2 ? 'dark' : 'light'));
  var d = MODE_DEFAULTS[resolved];

  var bg = bgGiven || d.backgroundColor;
  var isDark = luminance(bg) < 0.2;
  if ((resolved === 'dark') !== isDark) bg = d.backgroundColor;          // the wrong tone for the mode asked for

  var text = hexOr(design.textColor, d.textColor);
  if (contrast(text, bg) < 7) text = d.textColor;
  var muted = hexOr(design.mutedColor, d.mutedColor);
  if (contrast(muted, bg) < 4.5) muted = d.mutedColor;
  var surface = hexOr(design.surfaceColor, d.surfaceColor);
  if (contrast(text, surface) < 7) surface = d.surfaceColor;

  return { mode: resolved, backgroundColor: bg, surfaceColor: surface, textColor: text, mutedColor: muted };
}

/* ---------- model-written CSS ---------- */

/* No text smaller than MIN_LABEL_PX. Sizes are read where a size can be read: px, rem, em-free values and the
   minimum of a clamp(). A size in em or % is relative to its parent and is left alone. */
function clampFontSizes(css) {
  var minRem = MIN_LABEL_PX / 16;
  function fix(value) {
    var v = value.trim(), m;
    if ((m = /^(\d*\.?\d+)px$/i.exec(v))) return +m[1] < MIN_LABEL_PX ? MIN_LABEL_PX + 'px' : value;
    if ((m = /^(\d*\.?\d+)rem$/i.exec(v))) return +m[1] < minRem ? minRem + 'rem' : value;
    if ((m = /^clamp\(\s*([^,]+),([\s\S]+)\)$/i.exec(v))) {
      var low = fix(m[1]);
      return low === m[1] ? value : 'clamp(' + low + ',' + m[2] + ')';
    }
    return value;
  }
  return String(css || '').replace(/(font-size\s*:\s*)([^;}!]+)/gi, function (full, head, value) {
    var fixed = fix(value);
    return fixed === value ? full : head + fixed;
  });
}

/* No section heading louder than the site's type scale: a section heading at most SECTION_MAX_PX (38px), a
   sub-heading or card title at most SUB_MAX_PX (26px); stat numerals, eyebrows and body text are left alone.
   For every section but the hero, which has its own type (heroCss). html: the section's markup, which says
   which classes sit on headings. The rule itself is rv-type.js, so the editor applies the very same one. */
var capHeadingSizes = rvType.capHeadingSizes;
var HEADING_SCALE = { section: rvType.SECTION_HEADING, sub: rvType.SUB_HEADING, sectionMaxPx: rvType.SECTION_MAX_PX, subMaxPx: rvType.SUB_MAX_PX };

/* ---------- the event's logo ---------- */

function escAttr(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* The top bar carries the event's logo. Where the model used the address it was given, nothing changes;
   where it left the logo out, the logo goes in as the first thing inside the bar's own container (the
   element holding the links), sized by the page's own rule for [data-rv-logo]. */
/* The Economic Times Business Verticals logo at the left of the nav bar and at the top of the footer — fixed,
   the same on every ET event site, in the version for the tone it stands on (mode: 'dark' | 'light'). Marked
   data-rv-et-logo (not data-rv-logo, which is the event's own logo): the editor keeps it in step with the
   colour behind it (editor-template-ui.js, syncEtLogos). */
function etLogoHtml(mode, where) {
  var src = ET_LOGO[mode === 'dark' ? 'dark' : 'light'];
  return '<a href="#hero" data-rv-et-logo-link style="display:inline-block;line-height:0;text-decoration:none">' +
    '<img data-rv-et-logo src="' + src + '" alt="The Economic Times Business Verticals" style="height:' + (where === 'footer' ? 24 : 28) + 'px;width:auto;max-width:100%;display:block"></a>';
}
function ensureEtLogo(html, mode, where) {
  html = String(html || '');
  if (!html) return html;
  /* an event logo written into the bar anyway becomes the ET logo, in its place */
  var src = ET_LOGO[mode === 'dark' ? 'dark' : 'light'], h = where === 'footer' ? 24 : 28;
  html = html.replace(/<img\b(?=[^>]*\sdata-rv-logo(?:[\s=>\/]))[^>]*>/gi, function () {
    return '<img data-rv-et-logo src="' + src + '" alt="The Economic Times Business Verticals" style="height:' + h + 'px;width:auto;max-width:100%;display:block">';
  });
  if (/data-rv-et-logo\b/.test(html)) return html;
  var img = etLogoHtml(mode, where);
  if (where === 'footer') img = '<div style="margin:0 0 18px">' + img + '</div>';
  /* into the innermost wrapper that opens the bar: after the root's opening tag and any single wrapper div */
  var m = /^(\s*<[a-zA-Z][^>]*>)(\s*<div\b[^>]*>)?/.exec(html);
  if (!m) return img + html;
  return html.slice(0, m[0].length) + img + html.slice(m[0].length);
}

/* The nav carries at most NAV_LINKS section links besides its button. Past that, the links that matter least
   to a visitor deciding to come go first (the gallery, the FAQs, the "about" of the vertical, who should
   attend); the sections stay on the page, only their entries leave the bar. */
var NAV_LINKS = 5;
var NAV_DROP = [/glimps|gallery|photo/i, /faq/i, /about/i, /who|audience/i, /partner|sponsor/i, /why|join/i];
function isNavButton(tag, text) { return /\b(btn|button|cta)\b|data-register-cta/i.test(tag) || /^(register|book|request|apply|nominate|buy)/i.test(String(text).trim()); }
function capNavLinks(html, max) {
  html = String(html || '');
  max = max || NAV_LINKS;
  var links = [], re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var href = (/\shref\s*=\s*["']#([^"']*)["']/i.exec(m[1]) || [])[1];
    var text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (href == null || href === 'hero' || href === 'top' || /data-rv-(et-)?logo/.test(m[0]) || isNavButton(m[1], text)) continue;
    links.push({ full: m[0], key: href + ' ' + text });
  }
  var drop = [];
  for (var r = 0; r < NAV_DROP.length && links.length - drop.length > max; r++) {
    links.forEach(function (l) { if (links.length - drop.length > max && drop.indexOf(l) === -1 && NAV_DROP[r].test(l.key)) drop.push(l); });
  }
  while (links.length - drop.length > max) { var last = links.filter(function (l) { return drop.indexOf(l) === -1; }).pop(); drop.push(last); }
  drop.forEach(function (l) { html = html.replace(l.full, ''); });
  return html;
}

/* MOTION, kept in check: a page has at most MAX_AUTO rows that move on their own (data-rv-carousel="auto"),
   never two in neighbouring sections — several things moving at once tires a visitor. The rows that suit
   motion best keep it (partner logos, then photos, then people, then the rest); every other carousel stays a
   carousel the visitor moves (data-rv-carousel). sections: [{ id, html }] in page order, changed in place. */
var MAX_AUTO = 2;
var AUTO_RANK = [/sponsor|partner|logo/i, /glimps|gallery|photo|moment/i, /speaker|jury|people/i];
function motionBudget(sections) {
  var autos = [];
  (sections || []).forEach(function (s, i) {
    var n = (String(s.html || '').match(/data-rv-carousel\s*=\s*["']auto["']/gi) || []).length;
    if (n) {
      var r = AUTO_RANK.map(function (re) { return re.test(s.id); }).indexOf(true);
      autos.push({ s: s, i: i, rank: r === -1 ? AUTO_RANK.length : r });
    }
  });
  var kept = [];
  autos.slice().sort(function (a, b) { return a.rank - b.rank || a.i - b.i; }).forEach(function (a) {
    if (kept.length < MAX_AUTO && !kept.some(function (k) { return Math.abs(k.i - a.i) <= 1; })) kept.push(a);
  });
  autos.forEach(function (a) {
    var html = String(a.s.html), first = true;
    a.s.html = html.replace(/data-rv-carousel\s*=\s*["']auto["']/gi, function () {
      /* one moving row in a section at most, and only in a section that keeps its motion */
      var keep = first && kept.indexOf(a) !== -1;
      first = false;
      return keep ? 'data-rv-carousel="auto"' : 'data-rv-carousel';
    });
  });
  return kept.map(function (k) { return k.s.id; });
}

function ensureLogo(navHtml, logoUrl, eventName) {
  var html = String(navHtml || '');
  if (!logoUrl || !html) return html;
  if (html.indexOf(logoUrl) !== -1) {
    return /data-rv-logo/.test(html) ? html : html.replace(new RegExp('<img\\b(?=[^>]*' + logoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')'), '<img data-rv-logo');
  }
  var img = '<a href="#top" data-rv-logo-link><img data-rv-logo style="height:48px;width:auto;display:block" src="' + escAttr(logoUrl) + '" alt="' + escAttr(eventName || 'Event logo') + '"></a>';
  /* into the innermost wrapper that opens the bar: after the root's opening tag and any single wrapper div */
  var m = /^(\s*<[a-zA-Z][^>]*>)(\s*<div\b[^>]*>)?/.exec(html);
  if (!m) return img + html;
  return html.slice(0, m[0].length) + img + html.slice(m[0].length);
}

/* ---------- the logo unit ----------
   The lock-up that opens a generated site's hero, as on ET's own event sites: the event's name as a wordmark
   with its one distinctive keyword made the largest thing in it, then "An initiative by" and The Economic
   Times Business Verticals logo. It is built here, not by the model, so that it is the same careful piece of
   typography on every site; its rules are in templates/_shared/gen-base.css (.rv-lu…). */
var GENERIC_NAME_WORDS = /^(the|a|an|of|for|and|&|in|on|at|by|to|with|summit|summits|award|awards|conclave|forum|conference|congress|symposium|expo|meet|meetup|week|day|days|festival|fest|edition|annual|india|global|national|international|leadership|leaders|excellence|et|economic|times|\d{2,4}|\d+(st|nd|rd|th))$/i;

function words(text) { return String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean); }

/* -> { before, keyword, after }: the event's own name, split. `given` is the model's split; it is used only
   when it really is this name, word for word — otherwise the keyword is the first word of the name that is
   not a generic one (Summit, Awards, a year…), together with a number that follows it ("TECH 500"). */
function logoUnitParts(eventName, given) {
  var name = words(eventName);
  if (!name.length) return { before: '', keyword: '', after: '' };
  if (given && String(given.keyword || '').trim()) {
    var b = words(given.before), k = words(given.keyword), a = words(given.after);
    var joined = b.concat(k, a).join(' ').toLowerCase();
    if (joined === name.join(' ').toLowerCase() && k.length <= 3) {
      return { before: name.slice(0, b.length).join(' '), keyword: name.slice(b.length, b.length + k.length).join(' '), after: name.slice(b.length + k.length).join(' ') };
    }
  }
  var at = -1;
  name.forEach(function (w, i) { if (at === -1 && !GENERIC_NAME_WORDS.test(w.replace(/[^\w&]/g, ''))) at = i; });
  if (at === -1) at = 0;
  var len = 1;
  if (name[at + 1] && /^\d{2,4}$/.test(name[at + 1]) && !/^(19|20)\d\d$/.test(name[at + 1])) len = 2;
  return { before: name.slice(0, at).join(' '), keyword: name.slice(at, at + len).join(' '), after: name.slice(at + len).join(' ') };
}

var ET_LOGO = { dark: '/templates/_shared/img/et-business-verticals-on-dark.svg', light: '/templates/_shared/img/et-business-verticals-on-light.svg' };

/* tone: 'dark' when the unit stands on a dark veil (light type), else 'light'. The Economic Times Business
   Verticals logo is shown exactly as supplied — the file for that tone, at its own proportions, never
   recoloured, cropped or redrawn — above the event's wordmark, as on ET's own event sites. */
function logoUnitHtml(parts, mode) {
  parts = parts || {};
  if (!String(parts.keyword || '').trim()) return '';
  var tone = mode === 'dark' ? 'dark' : 'light';
  function span(cls, text) { return text ? '<span class="' + cls + '">' + escAttr(text) + '</span>' : ''; }
  return '<div class="rv-lu rv-lu-on-' + tone + '" data-rv-logo-unit>' +
    '<img class="rv-lu-et" src="' + ET_LOGO[tone] + '" alt="The Economic Times Business Verticals" width="' + (tone === 'dark' ? 401 : 365) + '" height="' + (tone === 'dark' ? 39 : 35) + '">' +
    '<div class="rv-lu-name">' + span('rv-lu-pre', parts.before) + span('rv-lu-key', parts.keyword) + span('rv-lu-post', parts.after) + '</div>' +
    '</div>';
}

/* The unit as ONE picture: the previous edition's own lock-up, or the SVG drawn for a new event
   (functions/lib/api.js, buildLogoUnit). '' when there is no picture — the caller then sets the unit in
   type (logoUnitHtml).
     o: { url, alt, width, height, mode, plate: '' | 'light' | 'dark', note }
   plate: the lock-up was drawn for the other kind of background and stands on a plate of that tone.
   note: what the owner should check about it; the editor shows it and it never reaches a published page. */
function logoUnitImageHtml(o) {
  o = o || {};
  var url = String(o.url || '').trim();
  if (!/^https:\/\//i.test(url)) return '';
  var tone = o.mode === 'dark' ? 'dark' : 'light';
  var w = Math.round(+o.width) || 0, h = Math.round(+o.height) || 0;
  var img = '<img class="rv-lu-img" src="' + escAttr(url) + '" alt="' + escAttr(o.alt || '') + '"' + (w > 0 && h > 0 ? ' width="' + w + '" height="' + h + '"' : '') + ' decoding="async">';
  if (o.plate === 'light' || o.plate === 'dark') img = '<span class="rv-lu-plate rv-lu-plate-' + o.plate + '">' + img + '</span>';
  var note = String(o.note || '').replace(/\s+/g, ' ').trim();
  return '<div class="rv-lu rv-lu-pic rv-lu-on-' + tone + '" data-rv-logo-unit' + (note ? ' data-rv-logo-note="' + escAttr(note) + '"' : '') + '>' + img + '</div>';
}

/* ---------- the hero ----------
   The banner that opens a generated site is built here, not written by the model, to the pattern of ET's own
   event sites: centred; the logo unit; one line about the event; its date and place; two buttons. Nothing
   else — the overview, numbers and tracks belong to the sections below it. What varies from site to site is
   what the design decided: the picture, the colours, the fonts, the corner radius, the line itself.
     o: { unit, tagline, date, place, mode, image, banner, primary: { label, href }, secondary: { label, href } | null }
     banner: a '#rrggbb' the hero is painted with when it has no picture and its tone is not the page's. */
var HERO_ICONS = {
  date: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  place: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/></svg>'
};

function heroHtml(o) {
  o = o || {};
  var facts = '';
  if (o.date) facts += '<span class="hero-fact">' + HERO_ICONS.date + '<span>' + escAttr(o.date) + '</span></span>';
  if (o.place) facts += '<span class="hero-fact">' + HERO_ICONS.place + '<span>' + escAttr(o.place) + '</span></span>';
  var buttons = '';
  if (o.primary && o.primary.label) buttons += '<a class="hero-btn hero-btn-primary"' + (o.primary.register === false ? '' : ' data-register-cta') + ' href="' + escAttr(o.primary.href || '#') + '">' + escAttr(o.primary.label) + '</a>';
  if (o.secondary && o.secondary.label) buttons += '<a class="hero-btn hero-btn-secondary" href="' + escAttr(o.secondary.href || '#') + '">' + escAttr(o.secondary.label) + '</a>';
  return '<section id="hero" class="hero-root hero-on-' + (o.mode === 'dark' ? 'dark' : 'light') + '">' +
    '<div class="hero-veil" aria-hidden="true"></div>' +
    '<div class="hero-inner">' +
    (o.unit || '') +
    (o.tagline ? '<h1 class="hero-tagline">' + escAttr(o.tagline) + '</h1>' : '') +
    (facts ? '<div class="hero-facts">' + facts + '</div>' : '') +
    (buttons ? '<div class="hero-actions">' + buttons + '</div>' : '') +
    '</div></section>';
}

function heroCss(o) {
  o = o || {};
  var dark = o.mode === 'dark';
  var radius = (o.cornerRadius || '12') + 'px';
  /* strongest behind the words in the middle, lighter towards the edges, so the picture is still seen */
  var veil = dark
    ? 'radial-gradient(ellipse 75% 80% at 50% 50%, rgba(8,10,16,.8) 0%, rgba(8,10,16,.58) 62%, rgba(8,10,16,.36) 100%)'
    : 'radial-gradient(ellipse 75% 80% at 50% 50%, rgba(255,255,255,.9) 0%, rgba(255,255,255,.66) 62%, rgba(255,255,255,.38) 100%)';
  var ink = dark ? '#ffffff' : '#14161b';
  return [
    '.hero-root{position:relative;min-height:88vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:clamp(96px,12vw,150px) 24px clamp(64px,9vw,110px);color:' + ink + ';background-color:' + (/^#[0-9a-f]{6}$/i.test(String(o.banner || '')) ? o.banner : 'var(--rv-bg)') + ';' +
      (o.image ? 'background-image:url("' + o.image + '");background-size:cover;background-position:center;' : 'background-image:radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--theme-color) 34%, transparent), transparent 70%);') + '}',
    '.hero-veil{position:absolute;inset:0;background:' + (o.image ? veil : 'none') + ';pointer-events:none}',
    '.hero-inner{position:relative;z-index:1;width:100%;max-width:980px;margin:0 auto;display:flex;flex-direction:column;align-items:center}',
    '.hero-tagline{font-family:var(--heading-font-family);font-size:clamp(1.6rem,3.4vw,2.75rem);font-weight:600;line-height:1.18;letter-spacing:-.01em;max-width:22ch;margin:0 0 26px;color:' + ink + '}',
    '.hero-facts{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 34px;margin:0 0 34px;font-family:var(--body-font-family);font-size:1.0625rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;line-height:1.4;color:' + ink + '}',
    '.hero-fact{display:inline-flex;align-items:center;gap:10px}',
    '.hero-fact svg{color:var(--theme-color);flex-shrink:0}',
    '.hero-on-dark .hero-fact svg{color:#fff}',
    '.hero-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:14px}',
    '.hero-btn{display:inline-flex;align-items:center;justify-content:center;min-width:190px;padding:15px 30px;border-radius:' + radius + ';font-family:var(--body-font-family);font-size:1rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;line-height:1.2;text-decoration:none;border:2px solid transparent;transition:transform .25s ease,box-shadow .25s ease}',
    '.hero-btn:hover{transform:translateY(-3px);box-shadow:0 14px 30px -14px rgba(0,0,0,.55)}',
    '.hero-btn-primary{background:var(--theme-color);border-color:var(--theme-color);color:' + (luminance(o.themeColor || '#186bf9') > 0.5 ? '#14161b' : '#ffffff') + '}',
    '.hero-btn-secondary{background:' + (dark ? 'transparent' : 'rgba(255,255,255,.7)') + ';border-color:' + ink + ';color:' + ink + '}',
    '@media (max-width:820px){.hero-root{min-height:76vh}.hero-btn{min-width:0;width:100%;max-width:340px}.hero-facts{font-size:.9375rem;letter-spacing:.1em}}'
  ].join(' ');
}

/* "18 February 2027", or "18–19 February 2027", from the event's stored start and end ("2027-02-18T09:00"). */
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dateLabel(start, end) {
  function parts(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  var a = parts(start), b = parts(end);
  if (!a || a.m < 1 || a.m > 12) return '';
  if (!b || (b.y === a.y && b.m === a.m && b.d === a.d)) return a.d + ' ' + MONTHS[a.m - 1] + ' ' + a.y;
  if (b.y === a.y && b.m === a.m) return a.d + '–' + b.d + ' ' + MONTHS[a.m - 1] + ' ' + a.y;
  if (b.m < 1 || b.m > 12) return a.d + ' ' + MONTHS[a.m - 1] + ' ' + a.y;
  return a.d + ' ' + MONTHS[a.m - 1] + (b.y === a.y ? '' : ' ' + a.y) + ' – ' + b.d + ' ' + MONTHS[b.m - 1] + ' ' + b.y;
}

/* ---------- picture addresses ----------
   A model asked to copy a long storage address gets a character wrong now and then, and the picture is then
   broken on the site. So it is never shown one: in a prompt a picture is a short token ("rvimg://hero"), and
   what comes back has the tokens put back as addresses. Any picture address in the answer that is not one
   of ours — an invented one, a mistyped one, a token that names nothing — is replaced by `fallback` (the
   section's own picture) or, without one, its <img> is taken out and its CSS url() emptied. */
function pictureToken(name) { return 'rvimg://' + String(name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-'); }

function restorePictures(text, map, fallback) {
  var out = String(text || '');
  Object.keys(map || {}).forEach(function (token) { out = out.split(token).join(map[token]); });
  var allowed = Object.keys(map || {}).map(function (t) { return map[t]; });
  function ours(url) {
    return allowed.indexOf(url) !== -1 || /^\/templates\/_shared\//.test(url) || /^data:image\//i.test(url) || /^#/.test(url);
  }
  out = out.replace(/<img\b[^>]*>/gi, function (tag) {
    var m = /\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    if (!m) return tag;                                        // a record's picture: no address of its own
    var url = (m[2] != null ? m[2] : m[3] || '').trim();
    if (ours(url)) return tag;
    return fallback ? tag.replace(m[0], ' src="' + fallback + '"') : '';
  });
  out = out.replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, function (full, q, url) {
    url = url.trim();
    if (ours(url)) return full;
    return fallback ? 'url("' + fallback + '")' : 'none';
  });
  return out;
}

/* ---------- pictures ---------- */

/* What a generated picture may show. Pictures are scenes from the event's own world — the event (a hall, a
   stage, delegates) and its subject at work — because a picture of unrelated objects, however handsome,
   tells a visitor nothing about the event. These are ET's events, for an Indian audience: the people in them
   are Indian, women as much as men, and seen as people are in event photography — faces included — but
   always ordinary, made-up people, never anyone real or famous. */
var PEOPLE_RULES = 'PEOPLE: the people are Indian (South Asian) professionals, as at a business event in India — if the event takes place outside India, Indian delegates alongside some local hosts. Women and men in about equal numbers, and women clearly present in leading roles (speaking on stage, leading a discussion, presenting), not only in the background. Faces may be seen naturally, as in real event photography, with professional Indian business attire (suits, blazers, sarees, kurtas); they are ordinary, made-up people — never a real, famous or named person.';
/* a GLOBAL event (the owner said so) shows an international mix, Indian professionals among them */
var PEOPLE_RULES_GLOBAL = PEOPLE_RULES
  .replace(/the people are Indian \(South Asian\) professionals, as at a business event in India — if the event takes place outside India, Indian delegates alongside some local hosts\./, 'this is a GLOBAL event: the people are an international mix of professionals, Indian professionals among them.')
  .replace('professional Indian business attire (suits, blazers, sarees, kurtas)', 'professional business attire');
/* the owner asked for graphics, not photographs: a composition, with no people in it */
var GRAPHIC_RULES = 'STRICT: a graphic composition, not a photograph — shapes, light, texture and forms drawn from the event\'s subject; no people, no faces.' + 
 ' No readable text, letters or numbers anywhere, no logos, no brand names, no watermarks, no flags.';
var IMAGE_TAIL = ' No readable text, letters or numbers anywhere (screens, signs, badges and banners are blank, blurred or abstract light), no logos, no brand names, no watermarks, no flags. Photographic and believable: correct anatomy, no distorted hands or faces, no surreal or abstract objects.';
var IMAGE_RULES = 'STRICT: ' + PEOPLE_RULES + IMAGE_TAIL;

/* text the model wrote, at most `max` characters, cut at the end of a sentence (else of a word), ending in a
   full stop — so that the line after it in a prompt does not run on from half a word */
function sentence(text, max) {
  var t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length > max) {
    t = t.slice(0, max);
    var end = t.lastIndexOf('. ');
    t = end > max / 2 ? t.slice(0, end + 1) : t.replace(/\s+\S*$/, '');
  }
  return t && !/[.!?]$/.test(t) ? t + '.' : t;
}

/* The city an event takes place in, in the picture: recognisably, as a local would know it — through the
   setting, the décor, the textiles, the light — and never as a postcard (edition-look.js, placeOf).
   place: { city, cues } — cues '' when the city is not on that list: the picture is then asked to find them. */
function placeLine(place, hero) {
  place = place || {};
  var city = String(place.city || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!city) return '';
  var cues = sentence(place.cues, 500).replace(/[.!]+$/, '');
  var how = cues ? cues : 'its own architecture, landscape, light and crafts, as someone from ' + city + ' would recognise them';
  return hero
    ? 'Place: this event takes place in ' + city + ', and the picture must show it, recognisably: ' + how + '. Make the city part of the scene itself (the view beyond the hall, the décor, the attire, the light), tasteful and believable — never a postcard collage, never a landmark pasted on, never a caricature.'
    : 'Place: the event is in ' + city + '. Where the scene allows, let the city show in its setting — ' + how + ' — subtly and believably, never as a postcard.';
}

/* opts: { hero, about, context, level: 'global'|…  (an owner's "global" event shows an international mix),
   graphic: true (the owner asked for graphics, not photographs), place: { city, cues } (where it happens; else
   design.place, which plan-structure sets) }; design.inspiredBy: the previous edition's banner artwork in words */
function imagePrompt(subject, design, opts) {
  design = design || {};
  opts = opts || {};
  var graphic = !!opts.graphic;
  var lines = [
    opts.hero
      ? (graphic
        ? 'Create the wide background artwork for the hero banner of a professional event website: a refined graphic composition (not a photograph) drawn from what this event is about. The event\'s name and buttons will sit over the middle of it, so keep the main forms towards the sides and the lower third, and the middle calmer.'
        : 'Create the wide background photograph for the hero banner of a professional event website. It must say at a glance what this event is: show the scene described below, not an abstraction of it. The event\'s name and buttons will sit over the middle of it, so compose it with depth and atmosphere, the main elements towards the sides, the back and the lower third, and a calmer, darker or softer middle.')
      : 'Create one editorial photograph for a section of a professional event website.',
    'Scene: ' + String(subject || 'a large business conference in session, an Indian audience of women and men facing a lit stage where a woman is speaking').slice(0, 500) + '.',
    opts.about ? 'The event: ' + String(opts.about).slice(0, 400) + '. The picture must belong to this event and its field — recognisably, through the setting' + (graphic ? ' and the forms in it.' : ', the people at work and the objects in view.') : '',
    opts.context ? String(opts.context).slice(0, 500) + ' The picture must be recognisably about that — a real scene, not a generic backdrop and not a metaphor made of unrelated objects.' : '',
    placeLine(opts.place || design.place, opts.hero),
    /* the previous edition's banner artwork, in words (plan-structure, design.inspiredBy): the hero is a new
       picture inspired by it, never a copy */
    opts.hero && !graphic && design.inspiredBy ? 'Inspiration: the previous edition\'s banner artwork was this — ' + sentence(design.inspiredBy, 600) + ' Make a NEW picture in that mood and palette family, with a composition and scene of its own; never a copy of it.' : '',
    graphic ? '' : design.imageStyle ? 'Visual style: ' + String(design.imageStyle).slice(0, 300) + '.' : 'Visual style: high-end editorial event photography, natural light, shallow depth of field.',
    'Palette: ' + (design.mode === 'dark' ? 'dark and moody' : 'bright and airy') + ', with ' + (design.themeColor || 'the brand colour') + ' and ' + (design.accentColor || 'a warm accent') + ' present as accents' + (graphic ? '.' : ' in the lighting.'),
    'Every picture on this site shares this one style, so that they read as a set.',
    opts.hero ? 'Landscape, 16:9.' : 'Landscape, 4:3.',
    graphic ? GRAPHIC_RULES : 'STRICT: ' + (opts.level === 'global' ? PEOPLE_RULES_GLOBAL : PEOPLE_RULES) + IMAGE_TAIL
  ];
  return lines.filter(Boolean).join(' ');
}

module.exports = {
  MIN_LABEL_PX, BASE_TEXT_PX, ART_DIRECTIONS, MODE_DEFAULTS,
  markupSkeleton, fontFamilies, pageTone, artDirectionFor, normaliseMode, palette, clampFontSizes, capHeadingSizes, headingClasses: rvType.headingClasses, HEADING_SCALE,
  ensureLogo, ensureEtLogo, etLogoHtml, capNavLinks, NAV_LINKS, motionBudget, ET_LOGO, imagePrompt, placeLine, PEOPLE_RULES, logoUnitParts, logoUnitHtml, logoUnitImageHtml, heroHtml, heroCss, dateLabel, pictureToken, restorePictures, luminance, contrast, colourOf
};
