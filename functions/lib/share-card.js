/* The picture a link to an event's site shows (og:image, twitter:image): ONE picture made on the server from the
   site's own banner — the banner's background exactly as the hero shows it, with the logo unit centred on it. The
   owner (6 Nov 2026): "the seo image that is being generated is also incorrect. It should contain both the logo
   unit and background image of header banner". Until then a link showed the bare banner picture, or a picture from
   further down the page, and never the logo unit.

   THE CARD. 1200 × 630 px (what WhatsApp, LinkedIn, X and Facebook all show large), a progressive JPEG well under
   1 MB. Its background is the banner's: the banner video's still when the hero plays a video, else the hero's own
   picture, cover-cropped the way the hero crops it (its background-position, else the centre), under the same
   darkening or tint the hero puts over it when that can be read from the page for certain (overlayLayers), else
   none. A banner that plays a video with NO still and has no picture of its own (Brand World Summit) gets one from
   ETB2B AI (share-still.js; the owner, 7 Nov 2026: "For video headers you have to generate a banner at your own"):
   one picture of the event's field and place, by the hero picture's rules (no people, no words, no logos, 16:9,
   checked), made once and kept on the event (events/<id>.shareStill), for the card only — the site keeps its video.
   planOf hands back what that card needs (plan.still) until the picture is there, and plans the card on it, under
   the hero's veil, once it is (background.made 'ai'); stillThenCard makes the picture, then the card, at a publish
   (inside the same bounded wait) and on a live page's visit (in the background), as for any card.
   On it, the LOGO UNIT the hero itself shows (img.rv-lu-img, its copy for a dark ground when the hero shows
   that one), centred, as large as fits in 64 % of the width and 52 % of the height, its proportions kept. Centred
   also survives WhatsApp's square crop of a link preview. Nothing else: no words, no date, no venue.

   OWNER RULES FOR THE LOGO UNIT (binding): it is a transparent picture, never boxed, never put on a plate, a card or
   a shape, never redrawn, recoloured or cropped. So a unit picture that is not transparent (a JPEG, or one with a
   solid box drawn round it) is not put on a card at all, and neither is an SVG whose lettering is live text in a
   font it does not carry (drawn here it would come out in another font): the page then keeps the picture it had.
   A unit set in type (no picture) is not drawn either.

   THE PLAN (planOf: no network, run by site-a11y.js's page pass on every page it writes or serves) reads what the
   card is made of from the published page — the same tokens the page pass reads — and fingerprints it:
     inputs      { v: CARD_VERSION, background: { url, x, y, ground }, overlay: [layers], logo: { url, from } }
     fingerprint the SHA-256 of the inputs as canonical JSON (keys sorted). Any change to the banner picture, its
                 crop, the hero's overlay, the logo unit or the drawing (CARD_VERSION) is a new fingerprint.
     -> { needed: true, fingerprint, inputs, fresh, card } | { needed: false, reason } | { needed: false, own: true }
   fresh: the event's record (events/<id>.shareCard) holds a card made from exactly these inputs; the page pass then
   puts that card in og:image. own: the owner uploaded a share picture of their own (settings.seo.shareImageUrl),
   which always wins: no card is made or used.

   MAKING IT (make: the picture library, sharp; resvg for an SVG unit through api.js's own rasterise, wired in).
   One card at a time per server instance (an instance has 512 MiB for everything). Before it starts, the record
   is marked { making: { fingerprint, at } } in a transaction, so several instances serving the same page do not
   all make it; a mark older than MAKING_TTL_MS is somebody's that died, and is taken over.
   STORED public, as the mail banners are (promo-banner.js): events/<id>/share-card/<fingerprint 16>-<base36 time>.jpg,
   cached for a year (a name is never reused). Cards are never deleted while the event lives: a link shared last
   month still shows its own.
   THE RECORD events/<id>.shareCard, on the event document, written straight to that one field (never updatedAt,
   detailsUpdatedAt or the site's version, no history line): it is not an edit, does not mark the site changed and
   is no change for an approval to list.
     { state: 'ready', fingerprint, url, path, width, height, bytes, at, v }      the card for these inputs
     { state: 'failed', reason, fingerprint, at }   it could not be made (tried again after RETRY_MS[reason class])
     { state: 'none', reason, at }                  this page has nothing to make it from (no banner picture, no
                                                    logo unit picture): the console says why
   WHEN (lib/api.js):
     - going live (a publish, an approval): awaited, at most PUBLISH_WAIT_MS; a card not ready by then, or one that
       fails, never holds the publish up — the page goes live with the picture it would have had, and the card,
       once stored, reaches it at the next visit (below);
     - serving /e/<id> (afterServe): a live page whose card is missing or not its current one has it made in the
       background, keeps the picture it had meanwhile, and its cached copy is dropped once the card is stored, so
       the next visitor (or crawler) gets it. That is how a site live before this got its card without being
       published again: og:image is metadata, kept current on every serve like the schema.org Event.
       App Hosting (Cloud Run) gives an instance its CPU while it is answering requests: the background card is
       made while that instance answers the visit's own follow-up requests (its stylesheets, scripts and data)
       and anything else. A page fetched only by a link-preview robot may wait for the next visit; its making
       mark then lapses after MAKING_TTL_MS and that visit makes it.
   QA_SHARE_ONLY_QA=1 in the environment (the QA harness, which talks to the production project): only events
   whose id starts with "qa-" get a card or a record; every other event is left exactly as it is. */
'use strict';
const crypto = require('crypto');
const postcss = require('postcss');
const heroVideoCore = require('../../templates/_shared/rv-hero-video-core.js');

/* Bumped whenever the drawing changes (what is read for it, or how it is drawn): the fingerprint carries it, so every
   site's card is then made again. */
var CARD_VERSION = 1;
var WIDTH = 1200, HEIGHT = 630;
var LOGO_MAX_W = Math.round(WIDTH * 0.64), LOGO_MAX_H = Math.round(HEIGHT * 0.52);   // 768 × 328
var MAX_BYTES = 1024 * 1024;                     // the card: link previews refuse pictures much larger
var QUALITIES = [85, 76, 66];                    // JPEG qualities tried in turn until the card is under MAX_BYTES
var BACKGROUND_MAX_BYTES = 16 * 1024 * 1024, LOGO_MAX_BYTES = 8 * 1024 * 1024;
var MAX_INPUT_PIXELS = 40000000;                 // a camera photo as a banner is ~24 MP
var FOLDER = 'share-card';
var STORAGE = 'https://storage.googleapis.com/';
var CACHE = 'public, max-age=31536000, immutable';
var PUBLISH_WAIT_MS = 8000;
var MAKING_TTL_MS = 90 * 1000;
var FETCH_TIMEOUT_MS = 10000;
/* a card that could not be made is tried again: soon when the cause can pass (a picture that did not load), a day
   later when it is the inputs themselves (a boxed logo stays boxed until somebody changes it, and changing it is a
   new fingerprint, tried at once) */
var RETRY_MS = { passing: 10 * 60 * 1000, lasting: 24 * 60 * 60 * 1000 };
var LASTING = { 'logo-not-transparent': 1, 'logo-boxed': 1, 'logo-text': 1, 'logo-unreadable': 1, 'background-unreadable': 1 };
/* what each reason means, said in the console (edit-event.html says them in its own words too) */
var REASONS = {
  'no-picture': 'the banner has no picture of its own',
  'video-no-still': 'the banner plays a video that has no still picture',
  'no-logo-unit': 'the banner has no logo unit picture',
  'logo-unit-in-type': 'the banner\'s logo unit is set in type, not a picture',
  'logo-not-transparent': 'the logo unit picture is not transparent',
  'logo-boxed': 'the logo unit picture has a box drawn round it',
  'logo-text': 'the logo unit has lettering in a font it does not carry',
  'logo-unreadable': 'the logo unit picture could not be read',
  'background-unreadable': 'the banner picture could not be read',
  'unavailable': 'a picture could not be loaded just now'
};

/* the overlay a dark theme puts over a light hero that has a logo copy for a dark ground — templates/_shared/
   gen-base.css (body[data-rv-mode="dark"] .hero-on-light:has(.rv-lu-dark) .hero-veil); share-card.test.js checks
   that it is still the rule there, word for word */
var DARK_TURN_VEIL = 'radial-gradient(ellipse 75% 80% at 50% 50%, rgba(8,10,16,.8) 0%, rgba(8,10,16,.58) 62%, rgba(8,10,16,.36) 100%)';
/* the elements a hero darkens or tints its picture with: the AI hero's veil (gen-design.js), an older AI hero's
   overlay, the ET banner's overlay layer (et-platform.css) */
var OVERLAY_CLASSES = ['hero-veil', 'hero-overlay', 'overlay-lyr'];

/* ---------- helpers given by lib/api.js (wire) ---------- */
/* rasterise(svgText, o) and embeddedYearFont(svgText): api.js's own SVG drawing (resvg, with the year font a
   lock-up carries), so a unit is drawn here exactly as the logo-unit code draws it everywhere else */
var H = {};
function wire(helpers) { H = helpers || {}; if (stillModule) stillModule.wire(H); }
/* share-still.js (ETB2B AI's picture for a video banner), loaded on first use: the page pass that reads plans runs on
   every page served, and needs none of the AI modules behind it */
var stillModule = null;
function still() {
  if (!stillModule) { stillModule = require('./share-still'); stillModule.wire(H); }
  return stillModule;
}

function allowed(eventId) {
  return process.env.QA_SHARE_ONLY_QA !== '1' || /^qa-[a-z0-9-]+$/.test(String(eventId || ''));
}
var warnedGuard = false;
function guardNote(eventId) {
  if (warnedGuard) return;
  warnedGuard = true;
  console.error('share-card: QA_SHARE_ONLY_QA is set, so no card is made or recorded for ' + eventId + ' (only qa- events get one here)');
}

/* =====================================================================================================
   THE PLAN — what the card is made of, read from the published page
   ===================================================================================================== */
function decode(s) { return String(s == null ? '' : s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }

/* "--a:1;color:red" -> { '--a': '1', color: 'red' } (the last of a name wins) */
function styleMap(style) {
  var out = {};
  String(style || '').split(';').forEach(function (part) {
    var at = part.indexOf(':');
    if (at === -1) return;
    var name = part.slice(0, at).trim().toLowerCase(), value = part.slice(at + 1).trim();
    if (name) out[name] = value;
  });
  return out;
}

/* the element tokens[i] as a selector sees it */
function elementOf(t, kit) {
  var attrs = {};
  t.attrs.forEach(function (a) { attrs[a.name] = a.value == null ? '' : decode(a.value); });
  return { name: t.name, id: attrs.id || '', classes: kit.classListOf(t), attrs: attrs };
}

/* One compound selector ("section.hero-root", "[data-rv-section="hero"]", "#banner") against an element. Anything
   it does not know (a pseudo-class, an attribute operator other than =) does not match: a rule we cannot be sure
   applies is not read. */
function compoundMatches(compound, el) {
  var s = String(compound || '').trim(), m;
  if (!s) return false;
  var tag = /^([a-zA-Z][a-zA-Z0-9-]*|\*)/.exec(s);
  if (tag) {
    if (tag[1] !== '*' && tag[1].toLowerCase() !== el.name) return false;
    s = s.slice(tag[1].length);
  }
  var re = /^(?:#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*)?\])/;
  while (s.length) {
    m = re.exec(s);
    if (!m) return false;
    if (m[1] != null && el.id !== m[1]) return false;
    if (m[2] != null && el.classes.indexOf(m[2]) === -1) return false;
    if (m[3] != null) {
      var name = m[3].toLowerCase(), want = m[4] != null ? m[4] : m[5] != null ? m[5] : m[6];
      if (!Object.prototype.hasOwnProperty.call(el.attrs, name)) return false;
      if (want != null && el.attrs[name] !== want) return false;
    }
    s = s.slice(m[0].length);
  }
  return true;
}
/* a selector split into its compounds, or null when it has a combinator other than descendant or child */
function compounds(selector) {
  var parts = [], cur = '', depth = 0, s = String(selector || '').trim();
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    if (!depth && (c === '+' || c === '~')) return null;
    if (!depth && (c === ' ' || c === '>' || c === '\n' || c === '\t')) { if (cur) parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) parts.push(cur);
  return parts;
}
/* Does the selector pick out `el`? `hero` is the hero element; el is the hero itself or an element in it. Read:
   the hero alone ("[data-rv-section="hero"].hero-root"), and an element in it, alone or under the hero
   ("[data-rv-section="hero"] .hero-veil", "#banner .overlay-lyr", ".hero-veil"). */
function selectorPicks(selector, el, hero) {
  var list = compounds(selector);
  if (!list || !list.length || list.length > 2) return false;
  if (!compoundMatches(list[list.length - 1], el)) return false;
  if (list.length === 1) return true;
  return el !== hero && compoundMatches(list[0], hero);
}

/* the top-level rules of the hero's own stylesheets, in order: [{ selectors, decls: [{ prop, value }] }]. Rules
   inside @media are a phone's or a printer's, not the banner a link preview stands for. */
function heroRules(sheets) {
  var rules = [];
  sheets.forEach(function (css) {
    var root;
    try { root = postcss.parse(css); } catch (e) { return; }
    root.each(function (node) {
      if (node.type !== 'rule') return;
      var decls = [];
      node.each(function (d) { if (d.type === 'decl') decls.push({ prop: d.prop.toLowerCase(), value: String(d.value).replace(/\s*!important\s*$/i, '').trim() }); });
      rules.push({ selectors: node.selectors || [], decls: decls });
    });
  });
  return rules;
}
/* the declarations that apply to `el` (rules in order, then its own style attribute): { prop: value }, the last wins */
function declsFor(rules, el, hero, inline) {
  var out = {}, order = [];
  rules.forEach(function (r) {
    if (!r.selectors.some(function (s) { return selectorPicks(s, el, hero); })) return;
    r.decls.forEach(function (d) { out[d.prop] = d.value; order.push(d); });
  });
  var own = styleMap(inline);
  Object.keys(own).forEach(function (k) { out[k] = own[k].replace(/\s*!important\s*$/i, '').trim(); order.push({ prop: k, value: out[k] }); });
  return { last: out, order: order };
}

/* var(--x, fallback) put in from `vars` (several maps, first found wins); null when a variable is not known */
function resolveVars(value, vars, depth) {
  var s = String(value == null ? '' : value);
  if ((depth || 0) > 6) return null;
  if (s.indexOf('var(') === -1) return s;
  var at = s.indexOf('var(');
  var end = matchParen(s, at + 3);
  if (end === -1) return null;
  var inner = s.slice(at + 4, end), comma = topComma(inner);
  var name = (comma === -1 ? inner : inner.slice(0, comma)).trim().toLowerCase();
  var fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
  var found = null;
  for (var i = 0; i < vars.length && found == null; i++) if (vars[i] && Object.prototype.hasOwnProperty.call(vars[i], name)) found = vars[i][name];
  if (found == null) found = fallback;
  if (found == null) return null;
  var put = resolveVars(found, vars, (depth || 0) + 1);
  if (put == null) return null;
  return resolveVars(s.slice(0, at) + put + s.slice(end + 1), vars, (depth || 0) + 1);
}
function matchParen(s, open) {
  var depth = 0;
  for (var i = open; i < s.length; i++) {
    if (s.charAt(i) === '(') depth++;
    else if (s.charAt(i) === ')') { depth--; if (!depth) return i; }
  }
  return -1;
}
function topComma(s) {
  var depth = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && !depth) return i;
  }
  return -1;
}
function splitTop(s, sep) {
  var out = [], depth = 0, cur = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === '(') depth++; else if (c === ')') depth--;
    if (!depth && (sep === ' ' ? /\s/.test(c) : c === sep)) { if (sep !== ' ' || cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (sep !== ' ' || cur) out.push(cur);
  return out.map(function (x) { return x.trim(); });
}

/* ---------- colours and the overlay's layers ---------- */
var NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
/* '#rgb' | '#rgba' | '#rrggbb' | '#rrggbbaa' | 'rgb(…)' | 'rgba(…)' | white | black | transparent -> [r, g, b, a] | null */
function parseColour(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase(), m;
  if (NAMED[s]) return NAMED[s].slice();
  if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
    var h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
  }
  if ((m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(s))) {
    var a = m[4] == null ? 1 : (m[5] ? +m[4] / 100 : +m[4]);
    var c = [+m[1], +m[2], +m[3], a];
    if (c.some(function (n) { return !isFinite(n); })) return null;
    return [clamp(Math.round(c[0]), 0, 255), clamp(Math.round(c[1]), 0, 255), clamp(Math.round(c[2]), 0, 255), clamp(Math.round(c[3] * 1000) / 1000, 0, 1)];
  }
  return null;
}
function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
function hexOf(c) { return '#' + c.slice(0, 3).map(function (n) { return ('0' + clamp(Math.round(n), 0, 255).toString(16)).slice(-2); }).join(''); }

/* a position ("center", "50% 30%", "left top", "right") -> [x, y] as fractions, or null (a length in px depends on
   the size of the hero, which a card does not have) */
var POS_X = { left: 0, center: 0.5, right: 1 }, POS_Y = { top: 0, center: 0.5, bottom: 1 };
function parsePosition(v) {
  var parts = String(v == null ? '' : v).trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return [0.5, 0.5];
  if (parts.length > 2) return null;
  function pct(p) { var m = /^(-?[\d.]+)%$/.exec(p); return m ? +m[1] / 100 : (p === '0' ? 0 : null); }
  var x = null, y = null;
  if (parts.length === 1) {
    var p = parts[0];
    if (p in POS_X && p !== 'center') return [POS_X[p], 0.5];
    if (p in POS_Y && p !== 'center') return [0.5, POS_Y[p]];
    if (p === 'center') return [0.5, 0.5];
    var f = pct(p);
    return f == null ? null : [f, 0.5];
  }
  var a = parts[0], b = parts[1];
  /* "top left" names the vertical first */
  if ((a === 'top' || a === 'bottom') || (b === 'left' || b === 'right')) { var t = a; a = b; b = t; }
  x = a in POS_X ? POS_X[a] : pct(a);
  y = b in POS_Y ? POS_Y[b] : pct(b);
  if (x == null || y == null || !isFinite(x) || !isFinite(y)) return null;
  return [x, y];
}

/* the colour stops of a gradient: [{ c, p }] with every position known (fractions), or null */
function parseStops(args) {
  var stops = [];
  for (var i = 0; i < args.length; i++) {
    var a = args[i], colourText, rest;
    var fn = /^(rgba?)\(/i.exec(a);
    if (fn) { var close = matchParen(a, fn[1].length); if (close === -1) return null; colourText = a.slice(0, close + 1); rest = a.slice(close + 1).trim(); }
    else { var sp = a.split(/\s+/); colourText = sp[0]; rest = sp.slice(1).join(' '); }
    var c = parseColour(colourText);
    if (!c) return null;                                   // a colour hint, a var(), a colour we cannot read
    var ps = rest ? rest.split(/\s+/) : [];
    if (ps.length > 2) return null;
    var pos = ps.map(function (p) { var m = /^(-?[\d.]+)%$/.exec(p); return m ? +m[1] / 100 : (p === '0' ? 0 : NaN); });
    if (pos.some(function (n) { return !isFinite(n); })) return null;   // a length in px: it depends on the hero's size
    if (!pos.length) stops.push({ c: c, p: null });
    pos.forEach(function (p) { stops.push({ c: c, p: p }); });
  }
  if (stops.length < 2) return null;
  /* CSS: the first stop at 0 and the last at 100 % when not said; none before an earlier one; the ones not said
     shared out evenly between the ones that are */
  if (stops[0].p == null) stops[0].p = 0;
  if (stops[stops.length - 1].p == null) stops[stops.length - 1].p = 1;
  var max = stops[0].p;
  stops.forEach(function (s) { if (s.p != null) { if (s.p < max) s.p = max; max = s.p; } });
  for (var j = 1; j < stops.length; j++) {
    if (stops[j].p != null) continue;
    var k = j; while (stops[k].p == null) k++;
    var from = stops[j - 1].p, to = stops[k].p, n = k - j + 1;
    for (var q = j; q < k; q++) stops[q].p = from + (to - from) * (q - j + 1) / n;
    j = k;
  }
  return stops.map(function (s) { return { c: s.c, p: Math.round(s.p * 10000) / 10000 }; });
}

var SIDES = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
/* one background layer -> a layer object, 'none' (paints nothing) or null (cannot be read for certain) */
function parseLayer(text) {
  var s = String(text || '').trim();
  if (!s) return null;
  if (/^none$/i.test(s)) return 'none';
  var c = parseColour(s);
  if (c) return c[3] > 0 ? { t: 'solid', c: c } : 'none';
  var m = /^(linear|radial)-gradient\(/i.exec(s);
  if (!m) return null;
  var close = matchParen(s, m[0].length - 1);
  if (close !== s.length - 1) return null;            // "linear-gradient(…) center / cover": more than a gradient
  var args = splitTop(s.slice(m[0].length, close), ',');
  if (m[1].toLowerCase() === 'linear') {
    var dir = { angle: 180 }, first = args[0].toLowerCase(), am;
    if ((am = /^(-?[\d.]+)(deg|turn|rad|grad)$/.exec(first))) {
      var n = +am[1];
      dir = { angle: am[2] === 'deg' ? n : am[2] === 'turn' ? n * 360 : am[2] === 'rad' ? n * 180 / Math.PI : n * 0.9 };
      args = args.slice(1);
    } else if (/^to\s/.test(first)) {
      var words = first.slice(3).trim().split(/\s+/), sx = 0, sy = 0;
      for (var w = 0; w < words.length; w++) { var sd = SIDES[words[w]]; if (!sd || words.length > 2) return null; sx += sd[0]; sy += sd[1]; }
      dir = sx && sy ? { corner: [sx, sy] } : { angle: sy < 0 ? 0 : sy > 0 ? 180 : sx > 0 ? 90 : 270 };
      args = args.slice(1);
    }
    var stops = parseStops(args);
    return stops ? { t: 'linear', dir: dir, stops: stops } : null;
  }
  /* radial: [circle | ellipse] [size] [at position], then the stops */
  var shape = 'ellipse', size = { kw: 'farthest-corner' }, at = [0.5, 0.5], head = args[0].toLowerCase();
  if (!parseColour(head.split(/\s+/)[0]) && !/^rgba?\(/.test(head)) {
    var atAt = head.indexOf(' at '), sizePart = head, posPart = '';
    if (head.indexOf('at ') === 0) { sizePart = ''; posPart = head.slice(3); }
    else if (atAt !== -1) { sizePart = head.slice(0, atAt); posPart = head.slice(atAt + 4); }
    if (posPart) { at = parsePosition(posPart); if (!at) return null; }
    var toks = sizePart.split(/\s+/).filter(Boolean), lens = [];
    for (var ti = 0; ti < toks.length; ti++) {
      var tk = toks[ti];
      if (tk === 'circle' || tk === 'ellipse') shape = tk;
      else if (/^(closest|farthest)-(side|corner)$/.test(tk)) size = { kw: tk };
      else if (/^[\d.]+%$/.test(tk)) lens.push(parseFloat(tk) / 100);
      else return null;                                 // a length in px, or something else
    }
    if (lens.length) {
      if (lens.length !== 2 || shape === 'circle') return null;   // a circle's size is a length, never a percentage
      size = { rx: lens[0], ry: lens[1] };
    }
    args = args.slice(1);
  }
  var rstops = parseStops(args);
  return rstops ? { t: 'radial', shape: shape, size: size, at: at, stops: rstops } : null;
}
/* a background value (its layers, the first on top) -> { layers, picture: url | '' } or null. Layers after a picture
   are under it, and only what is above it darkens or tints it. */
function parseBackground(value, allowPicture) {
  var parts = splitTop(String(value || ''), ','), layers = [], picture = '';
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (allowPicture && /url\(|image-set\(/i.test(p)) { picture = p; break; }
    var l = parseLayer(p);
    if (l === null) return null;
    if (l !== 'none') layers.push(l);
  }
  return { layers: layers, picture: picture };
}
/* the address in a background picture: url("…") — for image-set(), its last one, which pictures.js writes as the
   original (its WebP copy comes first) */
function urlIn(v) {
  var s = String(v || ''), re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, m, all = [];
  while ((m = re.exec(s))) all.push(m[2]);
  if (!all.length) return '';
  return /^\s*image-set\(/i.test(s) ? all[all.length - 1] : all[0];
}

/* ---------- the plan ---------- */
/* ctx: { event, imported, absolute(url) -> absolute url | '', own: the owner's share picture is on the page, html } */
function planOf(tokens, out, kit, ctx) {
  try { return planUnsafe(tokens, out, kit, ctx || {}); }
  catch (e) {
    console.error('share-card: the plan could not be read, no card — ' + (e && e.stack || e));
    return { needed: false, reason: 'unreadable' };
  }
}

function planUnsafe(tokens, out, kit, ctx) {
  if (ctx.own) return { needed: false, own: true };
  var A = kit.attrValue, event = ctx.event || {}, absolute = ctx.absolute || function (u) { return /^https?:\/\//i.test(u) ? u : ''; };
  var i, t, bodyTag = null, sheets = {}, inTemplate = 0;
  var hero = -1;
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    if (out[i] === '') continue;
    if (t.t === 'close' && t.name === 'template') { inTemplate = Math.max(0, inTemplate - 1); continue; }
    if (t.t !== 'open') continue;
    if (t.name === 'template' && !t.selfClosing) { inTemplate++; continue; }
    if (t.name === 'body' && !bodyTag) bodyTag = t;
    if (t.name === 'style' && tokens[i + 1] && tokens[i + 1].t === 'raw') {
      var key = A(t, 'data-rv-style');
      if (key != null) (sheets[key] = sheets[key] || []).push(out[i + 1]);
    }
    if (hero === -1 && !inTemplate && !t.selfClosing && (A(t, 'data-rv-section') === 'hero' || A(t, 'id') === 'hero' || A(t, 'id') === 'banner')) hero = i;
  }
  /* an imported design names no hero: its first section is its banner */
  if (hero === -1 && ctx.imported) hero = firstSection(tokens, out, kit);
  if (hero === -1) return { needed: false, reason: 'no-picture' };
  var heroEnd = kit.elementEnd(tokens, hero);
  if (heroEnd === -1) return { needed: false, reason: 'no-picture' };
  var heroTag = tokens[hero], heroEl = elementOf(heroTag, kit), heroKey = A(heroTag, 'data-rv-section') || A(heroTag, 'id') || '';
  var template = heroEl.id === 'banner';
  var body = bodyTag ? elementOf(bodyTag, kit) : { attrs: {} };
  var bodyVars = styleMap(body.attrs.style || '');
  var rules = heroRules(sheets[heroKey] || []);
  var heroDecls = declsFor(rules, heroEl, heroEl, heroEl.attrs.style);
  var heroVars = {};
  heroDecls.order.forEach(function (d) { if (/^--/.test(d.prop)) heroVars[d.prop] = d.value; });
  var vars = [heroVars, bodyVars];

  /* what the hero holds */
  var posters = [], videoNoStill = false, bannerPic = '', bigPics = [], units = [], bannerLogo = '', overlayEl = null, typeUnit = false, unitTone = '';
  for (i = hero + 1; i < heroEnd; i++) {
    t = tokens[i];
    if (t.t !== 'open' || out[i] === '') continue;
    if (t.name === 'template' && !t.selfClosing) { var te = kit.elementEnd(tokens, i); if (te !== -1) i = te; continue; }
    var cls = kit.classListOf(t), src = decode(A(t, 'src') || '').trim();
    if (t.name === 'video') { var poster = decode(A(t, 'poster') || '').trim(); if (poster) posters.push(poster); else videoNoStill = true; }
    if (t.name === 'img') {
      if (cls.indexOf('banner-bg-image') !== -1 && src && !bannerPic) bannerPic = src;
      if (cls.indexOf('rv-lu-img') !== -1 && src && !/^data:/i.test(src)) units.push({ src: src, dark: cls.indexOf('rv-lu-dark') !== -1 });
      if (template && cls.indexOf('logo') !== -1 && src && kit.attrOf(t, 'hidden') == null) bannerLogo = bannerLogo || src;
      var w = parseInt(A(t, 'width'), 10);
      if (src && (w >= 600 || cls.some(function (c) { return /^(object-cover|h-full|w-full|cover|bg-image|hero-bg|background)$/.test(c); }))) bigPics.push(src);
    }
    if (cls.indexOf('rv-lu-name') !== -1) typeUnit = true;
    /* the ground the logo unit is drawn for (gen-design.js logoUnitHtml: rv-lu-on-light / rv-lu-on-dark) */
    if (!unitTone && cls.indexOf('rv-lu') !== -1) unitTone = cls.indexOf('rv-lu-on-dark') !== -1 ? 'dark' : cls.indexOf('rv-lu-on-light') !== -1 ? 'light' : '';
    if (!overlayEl && cls.some(function (c) { return OVERLAY_CLASSES.indexOf(c) !== -1; })) overlayEl = elementOf(t, kit);
  }

  /* ---- the logo unit the hero shows ---- */
  var heroOnLight = heroEl.classes.indexOf('hero-on-light') !== -1;
  var darkCopy = units.filter(function (u) { return u.dark; })[0];
  var mainUnit = units.filter(function (u) { return !u.dark; })[0];
  /* a dark theme turns a light hero dark only when it carries the logo's copy for a dark ground (gen-base.css) */
  var darkTurn = body.attrs['data-rv-mode'] === 'dark' && heroOnLight && !!darkCopy && !!overlayEl && overlayEl.classes.indexOf('hero-veil') !== -1;
  var logo = null;
  if (darkTurn) logo = { url: darkCopy.src, from: 'unit' };
  else if (mainUnit) logo = { url: mainUnit.src, from: 'unit' };
  else if (bannerLogo) logo = { url: bannerLogo, from: 'banner' };
  else if (ctx.imported && typeof event.logoUrl === 'string' && /^https:\/\//i.test(event.logoUrl.trim())) logo = { url: event.logoUrl.trim(), from: 'event' };
  if (logo) logo.url = absolute(logo.url);

  /* ---- the background the hero shows ---- */
  var bg = null, overlay = [], unreadable = false, stillWanted = false, groundHex = '#ffffff';
  var hv = heroVideoCore.clean(event.heroVideo);
  var look = hv && hv.posterUrl ? heroVideoCore.looksAt(ctx.html || '') : null;
  if (look && look.host !== 'none') {
    /* the event's banner video, put on the page as it is served: its still covers the hero's picture and its
       overlay takes the place of the hero's veil (rv-hero-video-core.js pageCss) */
    bg = { url: hv.posterUrl, x: 0.5, y: 0.5 };
    var ov = parseColour(heroVideoCore.overlayFor(hv.overlay, look).rgba);
    if (ov && ov[3] > 0) overlay = [{ t: 'solid', c: ov }];
  } else {
    /* The hero's own picture, from its declarations in the order the browser applies them (the last wins). An
       image-set() written right after a plain url() is pictures.js's WebP copy of the same picture: the url()
       before it is the original, which is the better one to draw from. "background: none" (BWS: its video is its
       background) takes the picture away again. Gradient layers listed before the picture are painted over it. */
    var cssPic = '', cssPos = '', heroBgLayers = [], groundText = '';
    heroDecls.order.forEach(function (d) {
      if (d.prop === 'background-position') { cssPos = d.value; return; }
      if (d.prop === 'background-color') { groundText = d.value; return; }
      if (d.prop !== 'background' && d.prop !== 'background-image') return;
      if (/^\s*image-set\(/i.test(d.value) && cssPic) return;
      var parsed = parseBackground(d.value, true);
      if (d.prop === 'background') cssPos = '';
      if (!parsed) {
        /* a layer above the picture we cannot read for certain: the picture, without an overlay */
        cssPic = /url\(|image-set\(/i.test(d.value) ? urlIn(d.value) : '';
        heroBgLayers = [];
        unreadable = !!cssPic;
        return;
      }
      unreadable = false;
      cssPic = parsed.picture ? urlIn(parsed.picture) : '';
      heroBgLayers = parsed.layers;
      if (d.prop === 'background' && parsed.picture) {
        /* "url(x) center / cover no-repeat": its position is what stands between the picture and the "/" */
        var after = parsed.picture.slice(parsed.picture.indexOf(')') + 1).split('/')[0];
        var words = after.trim().split(/\s+/).filter(function (x) { return /^(left|right|top|bottom|center|-?[\d.]+%|0)$/.test(x); });
        if (words.length) cssPos = words.join(' ');
      }
    });
    if (posters.length) bg = { url: posters[0], x: 0.5, y: 0.5 };
    else if (bannerPic) bg = { url: bannerPic, x: 0.5, y: 0.5 };
    else if (cssPic) {
      var pos = parsePosition(resolveVars(cssPos || 'center', vars) || '');
      bg = { url: cssPic, x: pos ? pos[0] : 0.5, y: pos ? pos[1] : 0.5 };
    } else if (ctx.imported && bigPics.length) bg = { url: bigPics[0], x: 0.5, y: 0.5 };
    /* A banner that plays a video with no still of its own (BWS): the picture ETB2B AI made for its share card
       (share-still.js), once there is one, under the veil the hero puts over its video — exactly as a banner
       picture of its own would be. Until then, what that card will need (stillWanted, returned below). */
    stillWanted = !bg && videoNoStill && !ctx.imported;
    var aiStill = stillWanted ? stillOf(event) : '';
    if (aiStill) { bg = { url: aiStill, x: 0.5, y: 0.5, made: 'ai' }; stillWanted = false; }
    if ((bg || stillWanted) && !ctx.imported) {
      /* what tints the picture, top first: the overlay element, then the hero's own layers above the picture */
      var ovLayers = overlayLayers(overlayEl, rules, heroEl, vars, template, darkTurn);
      if (ovLayers === null || unreadable) overlay = [];
      else overlay = ovLayers.concat(bg && bg.url === cssPic ? heroBgLayers : []);
    }
    if (bg || stillWanted) {
      var ground = parseColour(resolveVars(darkTurn ? 'var(--rv-bg)' : (groundText || 'var(--rv-bg)'), vars) || '') ||
        parseColour(resolveVars(bodyVars['background-color'] || '', [bodyVars]) || '');
      groundHex = ground && ground[3] >= 0.995 ? hexOf(ground) : '#ffffff';
      if (bg) bg.ground = groundHex;
    }
  }
  if (bg) { bg.url = absolute(bg.url); if (!bg.url || /\.svg(\?|#|$)/i.test(bg.url)) bg = null; }
  if (bg && !bg.ground) bg.ground = '#ffffff';

  /* nothing to draw the card's background from but a video: ETB2B AI makes a picture for it first (share-still.js),
     when there is a logo unit to put on it — what is handed back is everything that card needs but that picture */
  if (!bg && stillWanted && logo && logo.url) {
    var colourOf = function (name) { var c = parseColour(resolveVars('var(' + name + ')', vars) || ''); return c && c[3] >= 0.995 ? hexOf(c) : ''; };
    var want = { v: CARD_VERSION, still: true, overlay: overlay, ground: groundHex, logo: { url: logo.url, from: logo.from } };
    return { needed: false, reason: 'video-no-still', still: {
      fingerprint: fingerprintOf(want), overlay: overlay, ground: groundHex, logo: want.logo,
      /* the picture is light or dark as the logo unit on it is drawn for, in the site's own colours */
      tone: darkTurn ? 'dark' : unitTone || (heroOnLight ? 'light' : body.attrs['data-rv-mode'] === 'dark' ? 'dark' : 'light'),
      colours: { theme: colourOf('--theme-color'), accent: colourOf('--accent-color') }
    } };
  }
  if (!bg && stillWanted) return { needed: false, reason: typeUnit ? 'logo-unit-in-type' : 'no-logo-unit' };
  if (!bg) return { needed: false, reason: videoNoStill ? 'video-no-still' : 'no-picture' };
  if (!logo || !logo.url) return { needed: false, reason: typeUnit ? 'logo-unit-in-type' : 'no-logo-unit' };

  var inputs = {
    v: CARD_VERSION,
    background: { url: bg.url, x: round4(bg.x), y: round4(bg.y), ground: bg.ground },
    overlay: overlay,
    logo: { url: logo.url, from: logo.from }
  };
  if (bg.made) inputs.background.made = bg.made;
  var fingerprint = fingerprintOf(inputs);
  var rec = event.shareCard && typeof event.shareCard === 'object' ? event.shareCard : null;
  var fresh = !!(rec && rec.state === 'ready' && rec.fingerprint === fingerprint && /^https:\/\/[^\s"'<>]+$/.test(String(rec.url || '')));
  return {
    needed: true, fingerprint: fingerprint, inputs: inputs, fresh: fresh,
    card: fresh ? { url: rec.url, width: WIDTH, height: HEIGHT } : null
  };
}
function round4(n) { return Math.round(n * 10000) / 10000; }
/* the picture ETB2B AI made for a video banner's share card (share-still.js), as the event records it — or as the
   card made from it records it, for the page written again right after a publish, before the event is read again */
var HTTPS_URL = /^https:\/\/[^\s"'<>]+$/;
function stillOf(event) {
  var s = event && event.shareStill, c = event && event.shareCard;
  if (s && typeof s === 'object' && s.state === 'ready' && HTTPS_URL.test(String(s.url || ''))) return s.url;
  if (c && typeof c === 'object' && c.state === 'ready' && HTTPS_URL.test(String(c.still || ''))) return c.still;
  return '';
}
/* the card's plan once that picture is there: the very inputs planOf reads off the page then (same fingerprint) */
function planWithStill(want, url) {
  var inputs = { v: CARD_VERSION, background: { url: url, x: 0.5, y: 0.5, ground: want.ground, made: 'ai' }, overlay: want.overlay || [], logo: { url: want.logo.url, from: want.logo.from } };
  return { needed: true, fingerprint: fingerprintOf(inputs), inputs: inputs, fresh: false, card: null };
}

/* the first <section> outside the top bar and the footer (an imported design's banner) */
function firstSection(tokens, out, kit) {
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.t !== 'open' || out[i] === '' || t.selfClosing) continue;
    if (/^(header|footer|nav|template)$/.test(t.name)) { var e = kit.elementEnd(tokens, i); if (e === -1) return -1; i = e; continue; }
    if (t.name === 'section') return i;
  }
  return -1;
}

/* The layers the hero's overlay element paints over its picture, top first: [] for none, null when it cannot be
   read for certain (then no overlay is put on the card at all: half of one would be a look the hero never has). */
function overlayLayers(el, rules, hero, vars, template, darkTurn) {
  if (!el) return [];
  if (darkTurn) { var dl = parseLayer(DARK_TURN_VEIL); return dl ? [dl] : null; }
  var d = declsFor(rules, el, hero, el.attrs.style);
  if (/^none$/i.test(d.last.display || '')) return [];
  if (d.last['mix-blend-mode'] && !/^normal$/i.test(d.last['mix-blend-mode'])) return null;
  if (d.last.filter || d.last['backdrop-filter']) return null;
  var value = null;
  d.order.forEach(function (x) { if (x.prop === 'background' || x.prop === 'background-color' || x.prop === 'background-image') value = x.value; });
  /* the ET banner's overlay layer: et-platform.css paints it in the template's own scrim colour */
  if (value == null && template && el.classes.indexOf('overlay-lyr') !== -1) value = 'var(--rv-banner-scrim, transparent)';
  if (value == null) return [];
  var resolved = resolveVars(value, vars);
  if (resolved == null) return null;
  var parsed = parseBackground(resolved, false);
  if (!parsed) return null;
  var op = d.last.opacity;
  if (op != null && op !== '') {
    var o = /^([\d.]+)(%?)$/.exec(op.trim());
    if (!o) return null;
    var f = clamp(o[2] ? +o[1] / 100 : +o[1], 0, 1);
    if (f < 1) parsed.layers.forEach(function (l) { l.o = f; });
  }
  return parsed.layers;
}

/* JSON with every object's keys sorted, so equal inputs always give the same text (promo-banner.js's) */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) {
      return JSON.stringify(k) + ':' + canonical(v[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
function fingerprintOf(inputs) { return crypto.createHash('sha256').update(canonical(inputs), 'utf8').digest('hex'); }

/* =====================================================================================================
   THE DRAWING
   ===================================================================================================== */
/* sharp, loaded on first use with lib/pictures.js's settings (nothing cached between pictures; one thread); a
   test may hand in its own (setSharp) */
var sharpModule, sharpOverride = null;
function loadSharp() {
  if (sharpOverride) return sharpOverride;
  if (sharpModule === undefined) {
    try {
      sharpModule = require('sharp');
      sharpModule.cache(false);
      sharpModule.concurrency(1);
    } catch (e) {
      sharpModule = null;
      console.error('share-card: no card can be made here (sharp) — ' + e.message);
    }
  }
  return sharpModule;
}
/* one card at a time per instance: each holds a decoded banner picture in memory */
var queue = Promise.resolve(), queued = 0;
function serially(job) {
  queued++;
  var run = queue.then(job, job);
  queue = run.then(function () { queued--; }, function () { queued--; });
  return run;
}

function fail(reason, detail) { var e = new Error(REASONS[reason] + (detail ? ' (' + detail + ')' : '')); e.reason = reason; return e; }

/* what the bytes are: 'png' | 'jpeg' | 'webp' | 'gif' | 'svg' | '' */
function kindOf(buf) {
  if (!buf || buf.length < 4) return '';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  var head = buf.slice(0, 4096);
  if (head.indexOf(0) === -1 && /<svg[\s>]/i.test(buf.slice(0, 262144).toString('utf8'))) return 'svg';
  return '';
}

/* The share card's pixels for these inputs. getBytes(url, maxBytes) -> Promise<Buffer>.
   -> Promise<{ buffer, width, height, bytes, logo: { left, top, width, height } }>, or rejects with err.reason */
function compose(inputs, getBytes) {
  var sharp = loadSharp();
  if (!sharp) return Promise.reject(fail('unavailable', 'no picture library'));
  return serially(function () {
    return Promise.all([
      getBytes(inputs.background.url, BACKGROUND_MAX_BYTES).then(null, function (e) { throw fail('unavailable', 'banner picture: ' + (e && e.message)); }),
      getBytes(inputs.logo.url, LOGO_MAX_BYTES).then(null, function (e) { throw fail('unavailable', 'logo unit: ' + (e && e.message)); })
    ]).then(function (got) {
      return Promise.all([background(sharp, got[0], inputs), logoPicture(sharp, got[1], inputs.logo)]);
    }).then(function (parts) {
      var bg = parts[0], lg = parts[1];
      applyOverlay(bg, WIDTH, HEIGHT, inputs.overlay || []);
      var left = Math.floor((WIDTH - lg.width) / 2), top = Math.floor((HEIGHT - lg.height) / 2);
      var qs = QUALITIES.slice();
      function encode() {
        var q = qs.shift();
        return sharp(bg, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
          .composite([{ input: lg.png, left: left, top: top }])
          .jpeg({ quality: q, progressive: true, mozjpeg: true, chromaSubsampling: '4:4:4' })
          .toBuffer().then(function (buf) {
            if (buf.length > MAX_BYTES && qs.length) return encode();
            return { buffer: buf, width: WIDTH, height: HEIGHT, bytes: buf.length, logo: { left: left, top: top, width: lg.width, height: lg.height } };
          });
      }
      return encode();
    });
  });
}

/* the banner picture as the hero shows it: covering the card, cropped at the hero's position, on the hero's ground
   (seen through a transparent picture) -> Buffer of WIDTH × HEIGHT RGB pixels */
function background(sharp, buf, inputs) {
  var b = inputs.background, kind = kindOf(buf);
  if (!kind || kind === 'svg') return Promise.reject(fail('background-unreadable', kind ? 'an SVG' : 'not a picture'));
  var opts = { limitInputPixels: MAX_INPUT_PIXELS };
  return sharp(buf, opts).metadata().then(function (m) {
    var w = +m.width || 0, h = +(m.pageHeight || m.height) || 0;
    if (m.orientation >= 5) { var x = w; w = h; h = x; }
    if (!w || !h) throw fail('background-unreadable', 'no size');
    /* background-size: cover — the smallest size that fills the card; then the hero's background-position: x % of
       what is left over goes to the left of the card, as CSS places it */
    var scale = Math.max(WIDTH / w, HEIGHT / h);
    var sw = Math.max(WIDTH, Math.round(w * scale)), sh = Math.max(HEIGHT, Math.round(h * scale));
    var left = Math.round((sw - WIDTH) * clamp(b.x, 0, 1)), top = Math.round((sh - HEIGHT) * clamp(b.y, 0, 1));
    return sharp(buf, opts).rotate().resize(sw, sh, { fit: 'fill' }).extract({ left: left, top: top, width: WIDTH, height: HEIGHT })
      .flatten({ background: b.ground || '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  }, function (e) { throw fail('background-unreadable', e && e.message); }).then(function (r) {
    if (r.info.width !== WIDTH || r.info.height !== HEIGHT || r.info.channels !== 3) throw fail('background-unreadable', 'drawn at the wrong size');
    return r.data;
  }, function (e) { throw e && e.reason ? e : fail('background-unreadable', e && e.message); });
}

/* The logo unit as a transparent PNG no larger than the logo's place on the card, its proportions kept and nothing
   of it cut: -> { png, width, height }. An SVG is drawn by api.js's rasterise (resvg), with the year font it carries;
   one whose lettering is live text in any other font is refused (it would come out in another font). A picture that
   is not transparent, or that has a box drawn round it, is refused too (never boxed). An event's own logo (an
   imported design's fallback) is used only as a PNG or an SVG. */
function logoPicture(sharp, buf, logo) {
  var kind = kindOf(buf);
  if (!kind) return Promise.reject(fail('logo-unreadable', 'not a picture'));
  if (kind === 'jpeg') return Promise.reject(fail('logo-not-transparent', 'a JPEG'));
  if (logo.from === 'event' && kind !== 'png' && kind !== 'svg') return Promise.reject(fail('logo-not-transparent', 'the event\'s logo is a ' + kind.toUpperCase() + ', not a PNG or an SVG'));
  var drawn;
  if (kind === 'svg') {
    var svg = buf.toString('utf8');
    var texts = svg.match(/<text\b/gi) || [];
    var font = H.embeddedYearFont ? H.embeddedYearFont(svg) : null;
    if (texts.length && !font) return Promise.reject(fail('logo-text'));
    if (typeof H.rasterise !== 'function') return Promise.reject(fail('unavailable', 'no SVG drawing here'));
    /* drawn wide (resvg's widest, 1000 px) and then scaled down into its place, so its edges are as crisp as the
       hero's */
    drawn = H.rasterise(svg, { clear: true, width: 1000, font: font }).then(function (r) {
      if (!r || !r.png) throw fail('logo-unreadable', 'the SVG could not be drawn');
      return r.png;
    });
  } else {
    drawn = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).metadata().then(function (m) {
      if (!m.hasAlpha) throw fail('logo-not-transparent', 'no transparency');
      return sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate().png().toBuffer();
    }, function (e) { throw e && e.reason ? e : fail('logo-unreadable', e && e.message); });
  }
  return drawn.then(function (png) {
    return sharp(png, { limitInputPixels: MAX_INPUT_PIXELS }).resize({ width: LOGO_MAX_W, height: LOGO_MAX_H, fit: 'inside', withoutEnlargement: false, kernel: 'lanczos3' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  }).then(function (r) {
    var why = transparencyProblem(r.data, r.info.width, r.info.height);
    if (why) throw fail(why);
    return sharp(r.data, { raw: { width: r.info.width, height: r.info.height, channels: 4 } }).png().toBuffer().then(function (png) {
      return { png: png, width: r.info.width, height: r.info.height };
    });
  }, function (e) { throw e && e.reason ? e : fail('logo-unreadable', e && e.message); });
}

/* '' when the RGBA pixels are a transparent picture; 'logo-not-transparent' when nothing in it can be seen through,
   'logo-boxed' when most of its edge is solid (a box or a plate round the lock-up: never put on a card). A lock-up
   whose letters touch its edge here and there is still transparent. */
function transparencyProblem(px, w, h) {
  var clear = 0, total = w * h;
  for (var i = 3; i < px.length; i += 4) if (px[i] < 250) clear++;
  if (!total || clear < total * 0.02) return 'logo-not-transparent';
  var ring = Math.max(1, Math.round(Math.min(w, h) * 0.02)), edge = 0, solid = 0;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) { x = w - ring - 1; continue; }
      edge++;
      if (px[(y * w + x) * 4 + 3] >= 128) solid++;
    }
  }
  return edge && solid / edge > 0.5 ? 'logo-boxed' : '';
}

/* The overlay's layers painted over the background's RGB pixels, in place, as a browser does: each layer over the
   ones under it (the list is top first), a gradient's colours mixed with their transparency taken into account
   (premultiplied, as CSS mixes them). */
function applyOverlay(rgb, W, H, layers) {
  if (!layers || !layers.length) return rgb;
  var prepared = layers.slice().reverse().map(function (l) { return prepare(l, W, H); });
  var c = [0, 0, 0, 0];
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var at = (y * W + x) * 3, r = rgb[at], g = rgb[at + 1], b = rgb[at + 2];
      for (var k = 0; k < prepared.length; k++) {
        prepared[k](x + 0.5, y + 0.5, c);
        var a = c[3];
        if (a <= 0) continue;
        /* c is premultiplied: out = c + under × (1 − a) */
        r = c[0] + r * (1 - a); g = c[1] + g * (1 - a); b = c[2] + b * (1 - a);
      }
      rgb[at] = clamp(Math.round(r), 0, 255); rgb[at + 1] = clamp(Math.round(g), 0, 255); rgb[at + 2] = clamp(Math.round(b), 0, 255);
    }
  }
  return rgb;
}
/* a layer -> fn(x, y, out): out = its premultiplied colour [r·a, g·a, b·a, a] at that point of the card */
function prepare(l, W, H) {
  var o = l.o == null ? 1 : l.o;
  function premul(c) { var a = c[3] * o; return [c[0] * a, c[1] * a, c[2] * a, a]; }
  if (l.t === 'solid') {
    var p = premul(l.c);
    return function (x, y, out) { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; out[3] = p[3]; };
  }
  var stops = l.stops.map(function (s) { return { p: s.p, c: premul(s.c) }; });
  function colourAt(t, out) {
    if (t <= stops[0].p) { copy(stops[0].c, out); return; }
    var last = stops[stops.length - 1];
    if (t >= last.p) { copy(last.c, out); return; }
    for (var i = 1; i < stops.length; i++) {
      if (t > stops[i].p) continue;
      var a = stops[i - 1], b = stops[i], span = b.p - a.p, f = span > 0 ? (t - a.p) / span : 1;
      out[0] = a.c[0] + (b.c[0] - a.c[0]) * f; out[1] = a.c[1] + (b.c[1] - a.c[1]) * f;
      out[2] = a.c[2] + (b.c[2] - a.c[2]) * f; out[3] = a.c[3] + (b.c[3] - a.c[3]) * f;
      return;
    }
  }
  if (l.t === 'linear') {
    /* CSS: the gradient line through the centre at the angle (0deg points up), as long as the box's projection on
       it; a corner ("to top right") gives the angle that puts the two other corners on the 50 % line */
    var dx, dy;
    if (l.dir.corner) { dx = l.dir.corner[0] * H; dy = l.dir.corner[1] * W; var n = Math.sqrt(dx * dx + dy * dy); dx /= n; dy /= n; }
    else { var rad = l.dir.angle * Math.PI / 180; dx = Math.sin(rad); dy = -Math.cos(rad); }
    var len = Math.abs(W * dx) + Math.abs(H * dy);
    return function (x, y, out) { colourAt(((x - W / 2) * dx + (y - H / 2) * dy) / len + 0.5, out); };
  }
  /* radial: the ending shape's radii in the card's pixels */
  var cx = l.at[0] * W, cy = l.at[1] * H, rx, ry;
  var nx = Math.min(cx, W - cx), fx = Math.max(cx, W - cx), ny = Math.min(cy, H - cy), fy = Math.max(cy, H - cy);
  if (l.size.rx != null) { rx = l.size.rx * W; ry = l.size.ry * H; }
  else {
    var kw = l.size.kw;
    if (l.shape === 'circle') {
      rx = ry = kw === 'closest-side' ? Math.min(nx, ny) : kw === 'farthest-side' ? Math.max(fx, fy)
        : kw === 'closest-corner' ? Math.sqrt(nx * nx + ny * ny) : Math.sqrt(fx * fx + fy * fy);
    } else if (kw === 'closest-side') { rx = nx; ry = ny; }
    else if (kw === 'farthest-side') { rx = fx; ry = fy; }
    else if (kw === 'closest-corner') { rx = nx * Math.SQRT2; ry = ny * Math.SQRT2; }
    else { rx = fx * Math.SQRT2; ry = fy * Math.SQRT2; }
  }
  if (!(rx > 0) || !(ry > 0)) return function (x, y, out) { copy(stops[stops.length - 1].c, out); };
  return function (x, y, out) { var ex = (x - cx) / rx, ey = (y - cy) / ry; colourAt(Math.sqrt(ex * ex + ey * ey), out); };
}
function copy(c, out) { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3]; }

/* =====================================================================================================
   STORING IT, AND THE RECORD
   ===================================================================================================== */
function eventRef(fb, eventId) { return fb.db.collection('events').doc(eventId); }

/* The bytes of a picture: this project's own Storage object read directly (no public fetch), anything else fetched
   like any other address a page names (safe-fetch.js: public addresses only, a size limit, a timeout). */
function bytesOf(fb, url, maxBytes) {
  var pictures = require('./pictures');
  var bucket = fb && fb.bucket && fb.bucket.name;
  var path = bucket ? pictures.pathOfUrl(url, bucket) : '';
  var timer;
  var timeout = new Promise(function (resolve, reject) { timer = setTimeout(function () { reject(new Error('took too long')); }, FETCH_TIMEOUT_MS + 2000); });
  var got = path ? fb.bucket.file(path).download().then(function (r) {
    var b = r && r[0];
    if (!Buffer.isBuffer(b)) throw new Error('not stored');
    if (b.length > maxBytes) throw new Error('too large');
    return b;
  }) : require('./safe-fetch').safeFetch(url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: maxBytes, maxRedirects: 2 }).then(function (r) {
    if (r.status !== 200) throw new Error('answered ' + r.status);
    return r.body;
  });
  return Promise.race([got, timeout]).then(function (b) { clearTimeout(timer); return b; }, function (e) { clearTimeout(timer); throw e; });
}

/* Marks the record as being made by this instance -> 'go' | 'ready' (already made: { rec }) | 'busy' | 'failed' |
   'gone'. One transaction: two instances serving the same page cannot both go. */
function claim(fb, eventId, fp, now) {
  var ref = eventRef(fb, eventId), out = { how: 'go', rec: null };
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var ev = snap.exists ? snap.data() || {} : null;
      if (!ev || !ev.createdAt || ev.deletedAt) { out.how = 'gone'; return; }
      var rec = ev.shareCard && typeof ev.shareCard === 'object' ? ev.shareCard : {};
      if (rec.state === 'ready' && rec.fingerprint === fp && rec.url) { out.how = 'ready'; out.rec = rec; return; }
      var mk = rec.making;
      if (mk && mk.fingerprint === fp && now - Date.parse(mk.at) < MAKING_TTL_MS) { out.how = 'busy'; return; }
      if (rec.state === 'failed' && rec.fingerprint === fp && now - Date.parse(rec.at) < RETRY_MS[LASTING[rec.reason] ? 'lasting' : 'passing']) { out.how = 'failed'; return; }
      tx.update(ref, { 'shareCard.making': { fingerprint: fp, at: new Date(now).toISOString() } });
    });
  }).then(function () { return out; });
}

/* Writes the record (the whole field: what it says now replaces the making mark). -> 'written' | 'gone' */
function record(fb, eventId, row) {
  var ref = eventRef(fb, eventId), how = 'written';
  return fb.db.runTransaction(function (tx) {
    return tx.get(ref).then(function (snap) {
      var ev = snap.exists ? snap.data() || {} : null;
      if (!ev || !ev.createdAt || ev.deletedAt) { how = 'gone'; return; }
      var cur = ev.shareCard && typeof ev.shareCard === 'object' ? ev.shareCard : {};
      /* somebody else's newer card for other inputs (the page changed meanwhile): theirs is the better answer, and
         a newer failure does not take away a card that is ready */
      if (cur.state === 'ready' && (+Date.parse(cur.at) || 0) > Date.parse(row.at) && cur.fingerprint !== row.fingerprint) { how = 'kept'; return; }
      var next = Object.assign({}, row);
      /* another instance is making a card for other inputs right now: its mark stays */
      if (cur.making && cur.making.fingerprint !== row.fingerprint) next.making = cur.making;
      tx.update(ref, { shareCard: next });
    });
  }).then(function () { return how; });
}

/* The card for this plan, made, stored and recorded. -> Promise<record | null>, never rejects.
   opts: { onStored() — called once the record says the card is ready (lib/api.js drops the page's cache),
           known — the record as the caller has just read it with the event: when it already says that this card
           failed lately, or that it is being made, nothing is asked of the database at all (a busy page is served
           many times a minute) } */
var INFLIGHT = new Map();
var MAX_WAITING = 6;
function make(fb, eventId, plan, opts) {
  opts = opts || {};
  if (!plan || !plan.needed || plan.fresh) return Promise.resolve(null);
  if (!allowed(eventId)) { guardNote(eventId); return Promise.resolve(null); }
  if (!fb || !fb.db || !fb.bucket) return Promise.resolve(null);
  var mine = INFLIGHT.get(eventId);
  if (mine && mine.fp === plan.fingerprint) return mine.p;
  /* a server that has many sites to catch up on makes the rest on later visits */
  if (queued >= MAX_WAITING) return Promise.resolve(null);
  var fp = plan.fingerprint, at = Date.now(), path = '', url = '';
  var known = opts.known && typeof opts.known === 'object' ? opts.known : null;
  if (known && known.making && known.making.fingerprint === fp && at - Date.parse(known.making.at) < MAKING_TTL_MS) return Promise.resolve(null);
  if (known && known.state === 'failed' && known.fingerprint === fp && at - Date.parse(known.at) < RETRY_MS[LASTING[known.reason] ? 'lasting' : 'passing']) return Promise.resolve(null);
  var p = Promise.resolve().then(function () { return claim(fb, eventId, fp, at); }).then(function (c) {
    if (c.how === 'ready') return c.rec;
    if (c.how !== 'go') return null;
    return compose(plan.inputs, function (u, max) { return bytesOf(fb, u, max); }).then(function (card) {
      at = Date.now();
      path = 'events/' + eventId + '/' + FOLDER + '/' + fp.slice(0, 16) + '-' + at.toString(36) + '.jpg';
      url = STORAGE + fb.bucket.name + '/' + path;
      var file = fb.bucket.file(path);
      return file.save(card.buffer, { resumable: false, metadata: { contentType: 'image/jpeg', cacheControl: CACHE } }).then(function () {
        /* a card no link preview can load is not left behind looking like a stored one: nothing names it yet */
        return file.makePublic().catch(function (err) { return file.delete().catch(function () {}).then(function () { throw err; }); });
      }).then(function () {
        var row = { state: 'ready', reason: '', fingerprint: fp, url: url, path: path, width: card.width, height: card.height, bytes: card.bytes, at: new Date(at).toISOString(), v: CARD_VERSION };
        /* made on ETB2B AI's picture for a video banner: said, so the console can say so, and so the page written
           again right after a publish finds that picture (stillOf) */
        if (plan.inputs.background.made === 'ai') row.still = plan.inputs.background.url;
        return record(fb, eventId, row).then(function (how) {
          if (how === 'gone') return file.delete().catch(function () {}).then(function () { return null; });
          if (how === 'kept') return null;
          if (typeof opts.onStored === 'function') { try { opts.onStored(row); } catch (e) { /* the caller's */ } }
          return row;
        });
      });
    }, function (err) {
      var reason = err && err.reason && REASONS[err.reason] ? err.reason : 'unavailable';
      console.error('share-card: no card for ' + eventId + ' — ' + (err && err.message));
      return record(fb, eventId, { state: 'failed', reason: reason, fingerprint: fp, at: new Date().toISOString(), v: CARD_VERSION }).then(function () { return null; });
    });
  }).then(null, function (err) {
    console.error('share-card: the card of ' + eventId + ' could not be made or recorded — ' + (err && err.stack || err));
    return null;
  }).then(function (rec) {
    if (INFLIGHT.get(eventId) && INFLIGHT.get(eventId).p === p) INFLIGHT.delete(eventId);
    return rec;
  });
  INFLIGHT.set(eventId, { fp: fp, p: p });
  return p;
}

/* A page with nothing to make a card from says why on its record (the console shows it), once: written only when
   the record does not say so already, and at most once per instance and reason. Never rejects. */
var NOTED = new Map();
function note(fb, eventId, event, reason) {
  if (!reason || !REASONS[reason] || !allowed(eventId) || !fb || !fb.db) return Promise.resolve(false);
  var rec = event && event.shareCard && typeof event.shareCard === 'object' ? event.shareCard : {};
  if (rec.state === 'none' && rec.reason === reason) return Promise.resolve(false);
  if (NOTED.get(eventId) === reason) return Promise.resolve(false);
  if (NOTED.size > 1000) NOTED.clear();
  NOTED.set(eventId, reason);
  return Promise.resolve().then(function () {
    return eventRef(fb, eventId).update({ 'shareCard.state': 'none', 'shareCard.reason': reason, 'shareCard.at': new Date().toISOString() });
  }).then(function () { return true; }, function (err) {
      NOTED.delete(eventId);
      console.error('share-card: could not note why ' + eventId + ' has no card — ' + (err && err.message));
      return false;
    });
}

/* A video banner's card (planOf's plan.still): ETB2B AI's picture for it first (share-still.js: made once, kept on
   the event), then the card on it, exactly as on a banner's own picture. The logo unit is checked before any picture
   is made: a unit that can never be put on a card (not transparent, boxed, lettering in a font it does not carry)
   costs no picture, and its record says why, as any card's does. -> Promise<card record | null>, never rejects. */
var STILL_INFLIGHT = new Map();
function stillThenCard(fb, eventId, event, plan, onStored) {
  /* one at a time per event on this server: visits that arrive together share it */
  var mine = STILL_INFLIGHT.get(eventId);
  if (mine) return mine;
  var p = stillThenCardOnce(fb, eventId, event, plan, onStored).then(function (rec) {
    if (STILL_INFLIGHT.get(eventId) === p) STILL_INFLIGHT.delete(eventId);
    return rec;
  });
  STILL_INFLIGHT.set(eventId, p);
  return p;
}
function stillThenCardOnce(fb, eventId, event, plan, onStored) {
  try {
    var want = plan && plan.still;
    if (!want || !want.logo || !want.logo.url) return Promise.resolve(null);
    if (!allowed(eventId)) { guardNote(eventId); return Promise.resolve(null); }
    if (!fb || !fb.db || !fb.bucket) return Promise.resolve(null);
    var S = still(), now = Date.now();
    var known = event && event.shareCard && typeof event.shareCard === 'object' ? event.shareCard : null;
    if (known && known.state === 'failed' && known.fingerprint === want.fingerprint && now - Date.parse(known.at) < RETRY_MS[LASTING[known.reason] ? 'lasting' : 'passing']) return Promise.resolve(null);
    var stillRec = event && event.shareStill && typeof event.shareStill === 'object' ? event.shareStill : null;
    /* a busy page is served many times a minute: while the record says the picture is being made, or may not be
       made again yet, nothing is fetched and nothing is asked of the database */
    if (stillRec && stillRec.state !== 'ready' && !S.mayMake(stillRec, now)) return Promise.resolve(null);
    return logoProblem(fb, want.logo).then(function (why) {
      if (why === 'unavailable') return null;
      if (why) {
        return record(fb, eventId, { state: 'failed', reason: why, fingerprint: want.fingerprint, at: new Date().toISOString(), v: CARD_VERSION }).then(function () { return null; });
      }
      return S.ensure(fb, eventId, event, want, { known: stillRec });
    }).then(function (rec) {
      if (!rec || rec.state !== 'ready' || !rec.url) return null;
      return make(fb, eventId, planWithStill(want, rec.url), { onStored: onStored });
    }).then(null, function (err) {
      console.error('share-card: the card of ' + eventId + ' on ETB2B AI\'s picture could not be made — ' + (err && err.stack || err));
      return null;
    });
  } catch (e) {
    console.error('share-card: ' + eventId + ' — ' + (e && e.stack || e));
    return Promise.resolve(null);
  }
}
/* '' when the logo unit can be put on a card; else the reason it cannot ('unavailable' when it could not be read
   just now: tried again later). The same reading and checks the card itself makes (logoPicture). */
function logoProblem(fb, logo) {
  var sharp = loadSharp();
  if (!sharp) return Promise.resolve('unavailable');
  return serially(function () {
    return bytesOf(fb, logo.url, LOGO_MAX_BYTES).then(function (buf) { return logoPicture(sharp, buf, logo); });
  }).then(function () { return ''; }, function (e) { return e && e.reason && REASONS[e.reason] ? e.reason : 'unavailable'; });
}

/* ---------- when (lib/api.js) ---------- */
/* Going live: the card for the page about to be written, waited for at most PUBLISH_WAIT_MS.
   -> Promise<record | null>: a record when the page should be written again with its card. Never rejects; a card
   still being made when the wait ends carries on, and reaches the page at its next visit (onStored). */
function atPublish(fb, eventId, event, plan, onStored) {
  try { return atPublishUnsafe(fb, eventId, event, plan, onStored); }
  catch (e) { console.error('share-card: ' + eventId + ' — ' + (e && e.stack || e)); return Promise.resolve(null); }
}
function atPublishUnsafe(fb, eventId, event, plan, onStored) {
  if (!plan) return Promise.resolve(null);
  if (!plan.needed && !plan.still) { if (!plan.own) note(fb, eventId, event, plan.reason); return Promise.resolve(null); }
  if (plan.fresh) return Promise.resolve(null);
  var timer;
  var wait = new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, PUBLISH_WAIT_MS); });
  /* a video banner's card waits for ETB2B AI's picture first, inside the same wait (it is rarely ready within it:
     the page then goes live with the picture it had, and the card reaches it once made, as below) */
  var job = plan.needed ? make(fb, eventId, plan, { onStored: onStored }) : stillThenCard(fb, eventId, event, plan, onStored);
  return Promise.race([job, wait]).then(function (rec) { clearTimeout(timer); return rec || null; });
}
/* Serving a live page: what its card needs, started in the background. Returns at once. */
function afterServe(fb, eventId, event, plan, onStored) {
  try {
    if (!plan || plan.own || plan.fresh) return;
    if (!plan.needed && plan.still) { stillThenCard(fb, eventId, event, plan, onStored); return; }
    if (!plan.needed) { note(fb, eventId, event, plan.reason); return; }
    make(fb, eventId, plan, { onStored: onStored, known: event && event.shareCard });
  } catch (e) { console.error('share-card: ' + eventId + ' — ' + (e && e.stack || e)); }
}

module.exports = {
  wire: wire, planOf: planOf, fingerprintOf: fingerprintOf, compose: compose, make: make, note: note, atPublish: atPublish, afterServe: afterServe,
  stillThenCard: stillThenCard, planWithStill: planWithStill,
  CARD_VERSION: CARD_VERSION, WIDTH: WIDTH, HEIGHT: HEIGHT, REASONS: REASONS, FOLDER: FOLDER
};
module.exports._test = {
  parseColour: parseColour, parsePosition: parsePosition, parseLayer: parseLayer, parseBackground: parseBackground, parseStops: parseStops,
  resolveVars: resolveVars, compoundMatches: compoundMatches, selectorPicks: selectorPicks, applyOverlay: applyOverlay, transparencyProblem: transparencyProblem,
  canonical: canonical, claim: claim, record: record, bytesOf: bytesOf, kindOf: kindOf, urlIn: urlIn, allowed: allowed,
  DARK_TURN_VEIL: DARK_TURN_VEIL, LOGO_MAX_W: LOGO_MAX_W, LOGO_MAX_H: LOGO_MAX_H, MAKING_TTL_MS: MAKING_TTL_MS, RETRY_MS: RETRY_MS, PUBLISH_WAIT_MS: PUBLISH_WAIT_MS,
  setSharp: function (s) { sharpOverride = s || null; }, inflight: INFLIGHT, noted: NOTED,
  setPublishWait: function (ms) { PUBLISH_WAIT_MS = ms; }
};
