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
     ensureLogo(navHtml, url, name)   the event's own logo is in the top bar, whatever the model wrote
     imagePrompt(brief, design, art)  the prompt for one generated picture
     normaliseMode(v)                 'light' | 'dark' | 'auto' */

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

/* ---------- the event's logo ---------- */

function escAttr(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* The top bar carries the event's logo. Where the model used the address it was given, nothing changes;
   where it left the logo out, the logo goes in as the first thing inside the bar's own container (the
   element holding the links), sized by the page's own rule for [data-rv-logo]. */
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

/* mode: the site's — a dark site has a dark veil over the hero picture and light text on it */
function logoUnitHtml(parts, mode) {
  parts = parts || {};
  if (!String(parts.keyword || '').trim()) return '';
  var tone = mode === 'dark' ? 'dark' : 'light';
  function span(cls, text) { return text ? '<span class="' + cls + '">' + escAttr(text) + '</span>' : ''; }
  return '<div class="rv-lu rv-lu-on-' + tone + '" data-rv-logo-unit>' +
    '<div class="rv-lu-name">' + span('rv-lu-pre', parts.before) + span('rv-lu-key', parts.keyword) + span('rv-lu-post', parts.after) + '</div>' +
    '<div class="rv-lu-by"><span class="rv-lu-by-label">An initiative by</span>' +
    '<img class="rv-lu-et" src="' + ET_LOGO[tone] + '" alt="The Economic Times Business Verticals" width="320" height="31"></div>' +
    '</div>';
}

/* The unit takes the place of the empty <div data-rv-logo-unit></div> the model was asked for; where the
   model left that out, it goes right above the hero's headline. */
function placeLogoUnit(heroHtml, unitHtml) {
  var html = String(heroHtml || '');
  if (!unitHtml || !html) return html;
  var slot = /<div\b[^>]*\bdata-rv-logo-unit\b[^>]*>[\s\S]*?<\/div>/i;
  if (slot.test(html)) return html.replace(slot, function () { return unitHtml; });
  /* above the headline, which is where the hero's content begins */
  var h1 = html.search(/<h1\b/i);
  if (h1 !== -1) return html.slice(0, h1) + unitHtml + html.slice(h1);
  var m = /^\s*<[a-zA-Z][^>]*>/.exec(html);
  if (!m) return unitHtml + html;
  return html.slice(0, m[0].length) + unitHtml + html.slice(m[0].length);
}

/* ---------- pictures ---------- */

var IMAGE_RULES = 'STRICT: no people, no faces, no crowds, no hands, no text, no letters, no numbers, no logos, no watermarks, no flags, no recognisable real building or landmark. This illustrates a theme; it must never look like a photograph of this event, its venue or its attendees.';

function imagePrompt(subject, design, opts) {
  design = design || {};
  opts = opts || {};
  var lines = [
    opts.hero
      ? 'Create the wide background picture for the hero banner of a professional event website. Text and buttons will sit on top of it, so keep the composition calm, with open space and no strong detail in the centre.'
      : 'Create one picture for a section of a professional event website.',
    'Subject: ' + String(subject || 'the theme of a professional conference').slice(0, 400) + '.',
    opts.context ? String(opts.context).slice(0, 500) + ' The picture must be recognisably about that, shown through concrete objects, places and materials — not a generic backdrop.' : '',
    design.imageStyle ? 'Visual style: ' + String(design.imageStyle).slice(0, 300) + '.' : 'Visual style: high-end editorial, natural light, shallow depth of field.',
    'Palette: ' + (design.mode === 'dark' ? 'dark and moody' : 'bright and airy') + ', with ' + (design.themeColor || 'the brand colour') + ' and ' + (design.accentColor || 'a warm accent') + ' present as accents.',
    'Every picture on this site shares this one style, so that they read as a set.',
    opts.hero ? 'Landscape, 16:9.' : 'Landscape, 4:3.',
    IMAGE_RULES
  ];
  return lines.filter(Boolean).join(' ');
}

module.exports = {
  MIN_LABEL_PX, BASE_TEXT_PX, ART_DIRECTIONS, MODE_DEFAULTS,
  markupSkeleton, fontFamilies, pageTone, artDirectionFor, normaliseMode, palette, clampFontSizes,
  ensureLogo, imagePrompt, logoUnitParts, logoUnitHtml, placeLogoUnit, luminance, contrast, colourOf
};
