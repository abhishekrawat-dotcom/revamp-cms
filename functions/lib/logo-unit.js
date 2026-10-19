/* The logo unit: the event's own lock-up that opens the hero ("ET · ENTREPRENEUR · SUMMIT & AWARDS").

   A new edition should open with the previous edition's unit, with only the year moved on; an event with no
   previous edition gets a unit drawn here. This file is everything about that which is plain computation —
   no network, no Firebase, no file system: the route that uses it fetches the page, the picture and the
   font, and hands their text or bytes in. See logo-unit.test.js.

   Finding it on a previous edition's page
     findLogoCandidates(html, pageUrl, eventName) -> [ { url, kind: 'img' | 'inline-svg', score, why: [..], cls, alt, svg? } ]
                                           best first, at most 6; [] when nothing on the page can be it.
                                           Never an address with a password in it, an IP address, localhost or
                                           a name only a private network knows. That is a first sieve, not the
                                           guard: every address returned here is still the page's word, and
                                           must be fetched through safe-fetch.js.
     editionHints(html, pageUrl)        -> { title, headings: [..], years: [..], editionImage }
     editionYears({ eventName, start, briefTexts, hints, pageUrl }) -> { from, to }   ('' where there is no evidence)
     eventYear({ eventName, start, briefTexts }) -> '2027' | ''   the event's own year: its name, its start, its brief

   A year as a lock-up writes it ("2026", "'26", "’26", "26", "FY26", "2026-27")
     shownYear(written)                 -> { written, full, form } | null
     yearAs(written, to)                -> `to` written the same way ("'26", "2027" -> "'27")
     yearsShownIn(text)                 -> [ shownYear… ] every edition-like year written in a text

   Looking at the picture that was found
     imageInfo(buf)                     -> { type: 'png'|'jpeg'|'gif'|'webp'|'svg'|'', mime, width, height, alpha }
     plausibleUnit(info)                -> '' when it could be a logo unit, else the reason it is not
     svgIsActive(text)                  -> true when an SVG could run code (the upload route's own rules)
     svgLayers(text)                    -> [ the SVG, then every SVG nested in it as a base64 picture ]
                                           (in a tag or a style sheet: where it is shown, not where it is quoted)
     svgTexts(text)                     -> every string set as real text, across the layers
     svgTone(text)                      -> 'for-dark' | 'for-light' | ''   (what background it was drawn for)

   Moving the year on
     svgReplaceYear(text, from, to)     -> { svg, changed }   only where the year is real text; every other
                                           byte stays as it was. changed 0 -> svg is the input itself.
                                           from as written ("2026", "'26", "FY26", "2026-27"), to four digits;
                                           the new year is written as the old one was ("'27").
     (svgTexts, svgTone and svgReplaceYear leave an SVG over 4,000,000 characters alone: [], '', changed 0.)
     bumpYear(text, from, to)           -> the text with that whole number replaced (alt text, names)

   Drawing a new one
     fontMetrics(ttfBuffer)             -> { unitsPerEm, ascender, descender, capHeight, advanceOf(cp), has(cp) } | null
     textWidth(metrics, text, fontSize, letterSpacing) -> px
     googleFontCssUrl(family, weight, text)
     fontUrlFromCss(css)                -> the TrueType file's address, only ever https://fonts.gstatic.com/…
     buildLogoUnitSvg(o)                -> { svg, width, height }   one self-contained SVG file

   Nothing here throws on bad input: a page that cannot be read gives [], bytes that are no picture give
   type '', bytes that are no font give null. And nothing here is slower than its input is long: the pages,
   pictures and style sheets come from other people's servers, and this runs on the one thread every request
   shares — so markup is read by walking it once, never by a pattern that can try the same bytes again. */

const { Parser, DomHandler } = require('htmlparser2');
const domutils = require('domutils');
const genDesign = require('./gen-design');

var MAX_HTML_CHARS = 1500000;       // a page is read up to here; what a hero holds is always well before it
var MAX_CANDIDATES = 6;
var MAX_INLINE_SVG_CHARS = 200000;
var MAX_SVG_DEPTH = 4;              // an SVG holding an SVG holding an SVG… is followed this far
var MAX_SVG_CHARS = 4000000;        // a logo unit is a few KB to a few hundred; past this it is not read for text or inks
var MAX_HTML_DEPTH = 500;           // boxes inside boxes: a page is read until it is this deep (see read())
var HTML_STEP = 4096;               // … which is looked at every this many characters
var MAX_ANCESTORS = 200;            // real pages nest 20 to 40 deep; boxes further out than this are not looked at
var MAX_CSS_CHARS = 200000;         // Google's answer for one font is a few hundred characters

/* ---------- small helpers ---------- */

/* gen-design.js keeps this list to itself (GENERIC_NAME_WORDS); it is repeated here so that file is not
   touched. A word of an event's name that says nothing about WHICH event it is. */
var GENERIC_NAME_WORDS = /^(the|a|an|of|for|and|&|in|on|at|by|to|with|summit|summits|award|awards|conclave|forum|conference|congress|symposium|expo|meet|meetup|week|day|days|festival|fest|edition|annual|india|global|national|international|leadership|leaders|excellence|et|economic|times|\d{2,4}|\d+(st|nd|rd|th))$/i;

function distinctiveWords(eventName) {
  return String(eventName || '').toLowerCase().split(/[^a-z0-9&]+/).filter(function (w) {
    return w.length >= 3 && !GENERIC_NAME_WORDS.test(w);
  });
}
function sharesWord(text, wordList) {
  var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ') + ' ';
  return wordList.some(function (w) { return t.indexOf(' ' + w + ' ') !== -1; });
}

function attr(el, name) { return (el && el.attribs && el.attribs[name] != null) ? String(el.attribs[name]) : ''; }
function hasAttr(el, name) { return !!(el && el.attribs && el.attribs[name] != null); }
function tokens(el) { return attr(el, 'class').split(/\s+/).filter(Boolean); }
function idAndClass(el) { return (attr(el, 'id') + ' ' + attr(el, 'class')).trim(); }
function hasToken(el, re) { return tokens(el).some(function (t) { return re.test(t); }); }
function textOf(el) { return domutils.textContent(el).replace(/\s+/g, ' ').trim(); }
function isElement(n) { return !!n && (n.type === 'tag' || n.type === 'script' || n.type === 'style'); }

/* every element of the page, in the order it is written; each is given its place (rvAt) */
function elementsOf(doc) {
  var out = [], stack = [doc];
  while (stack.length) {
    var n = stack.pop();
    if (isElement(n)) { n.rvAt = out.length; out.push(n); }
    var kids = n.children || [];
    for (var i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}
/* the elements an element is inside, nearest first, without <html> and <body>; the nearest 200 at most, so
   that a page made of boxes inside boxes costs no more than any other */
function ancestorsOf(el) {
  var out = [], p = el.parent;
  while (p && isElement(p) && out.length < MAX_ANCESTORS) {
    if (p.name !== 'html' && p.name !== 'body') out.push(p);
    p = p.parent;
  }
  return out;
}
/* marks everything inside a box (rvIn), once, so that asking "is this inside it?" is one look */
function markInside(box) {
  var stack = (box.children || []).slice();
  while (stack.length) {
    var n = stack.pop();
    n.rvIn = box;
    var kids = n.children || [];
    for (var i = 0; i < kids.length; i++) stack.push(kids[i]);
  }
}
function elementSibling(el, step) {
  var n = step > 0 ? el.next : el.prev;
  while (n && !isElement(n)) {
    if (n.type === 'text' && /\S/.test(n.data || '')) return null;      // words in between: not adjacent
    n = step > 0 ? n.next : n.prev;
  }
  return n || null;
}

/* The page as elements. It is handed to the parser a piece at a time, and no more of it once it is 500
   boxes deep: for every closing tag the parser looks through all the boxes still open, so a page written as
   "<div></x><div></x>…" cost it the square of its length (1.5 MB: half a minute). A real page is 20 to 40
   deep; one that goes past 500 is read up to there, and what a hero holds is well before it. */
function read(html) {
  var src = String(html == null ? '' : html).slice(0, MAX_HTML_CHARS);
  var handler = new DomHandler(undefined, { withStartIndices: true, withEndIndices: true });
  var depth = 0, opened = handler.onopentag, closed = handler.onclosetag;
  handler.onopentag = function () { depth++; return opened.apply(handler, arguments); };
  handler.onclosetag = function () { depth--; return closed.apply(handler, arguments); };
  var parser = new Parser(handler, { decodeEntities: true });
  for (var at = 0; at < src.length && depth <= MAX_HTML_DEPTH; at += HTML_STEP) parser.write(src.slice(at, at + HTML_STEP));
  parser.end();
  return { src: src, all: elementsOf(handler.root) };
}

/* ---------- addresses ---------- */

function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; } }

/* An address on the public web has a name with a dot in it. An IP address (new URL() has already turned
   "2130706433" and "0x7f.1" into 127.0.0.1), localhost, a bare machine name and the names private networks
   use are none of this file's business: a page that points a "logo" at one is not showing a logo. */
function isIpHost(host) { return host.charAt(0) === '[' || /^\d+(\.\d+){3}$/.test(host); }
function privateHost(host) {
  host = String(host || '').toLowerCase().replace(/\.+$/, '');
  return !host || isIpHost(host) || host.indexOf('.') === -1 || /\.(localhost|local|internal|localdomain|lan|home|corp|intranet)$/.test(host);
}

var SHARED_SUFFIX = /^(web\.app|firebaseapp\.com|hosted\.app|github\.io|vercel\.app|netlify\.app|lovable\.app|pages\.dev|herokuapp\.com|appspot\.com|googleapis\.com|cloudfront\.net|amazonaws\.com|wordpress\.com|blogspot\.com)$/;
/* "economictimes.indiatimes.com" and "b2b.economictimes.indiatimes.com" are one owner: indiatimes.com */
function registrable(host) {
  var p = String(host || '').split('.');
  if (p.length <= 2) return p.join('.');
  var two = p.slice(-2).join('.');
  if (/^(co|com|org|net|gov|ac|edu|gen|ind|nic|res|firm)\.[a-z]{2}$/.test(two) || SHARED_SUFFIX.test(two)) return p.slice(-3).join('.');
  return two;
}
/* where The Economic Times keeps the pictures of its event pages, whatever host the page itself is on */
var ET_HOSTS = /(^|\.)(etb2bimg\.com|b2bstatic\.com|etimg\.com|indiatimes\.com|economictimes\.com)$/;
function relatedHost(host, pageHost) {
  if (!host || privateHost(host)) return false;                 // an IP address is nobody's relation
  if (!pageHost) return true;                                   // no page address to compare with: no opinion
  return host === pageHost || registrable(host) === registrable(pageHost) || ET_HOSTS.test(host);
}

function resolveUrl(value, pageUrl) {
  var v = String(value || '').trim();
  if (!v || /^data:/i.test(v)) return '';
  var u;
  try { u = new URL(v, pageUrl || undefined); } catch (e) {
    try { u = new URL(v); } catch (e2) { return ''; }
  }
  if (!/^https?:$/.test(u.protocol)) return '';
  if (u.username || u.password || privateHost(u.hostname)) return '';
  return u.href;
}

var PLACEHOLDER_SRC = /(^|[\/_.-])(placeholder|blank|spacer|transparent|pixel|loader|loading|lazy|1x1|grey|gray)([_.-][^\/]*)?\.(gif|png|svg|webp|jpe?g)(\?|$)/i;
/* The first address of a srcset. An address may have commas in it (".../w_300,h_200/a.png 1x, …"), so it is
   read the way a browser reads it: up to the first space, less the commas that only separate. */
function firstOfSrcset(value) {
  var first = String(value || '').replace(/^[\s,]+/, '').split(/\s/)[0] || '';
  var end = first.length;
  while (end > 0 && first.charAt(end - 1) === ',') end--;
  return first.slice(0, end);
}
/* The picture an <img> really shows. A lazy-loading page writes a stand-in (nothing, a data: URI, a grey
   tile) in src and the real address in data-src or srcset. */
function sourceOf(img) {
  var src = attr(img, 'src').trim();
  var lazy = attr(img, 'data-src') || attr(img, 'data-lazy-src') || attr(img, 'data-original') ||
    firstOfSrcset(attr(img, 'srcset') || attr(img, 'data-srcset'));
  lazy = String(lazy).trim();
  var standIn = !src || /^data:/i.test(src) || PLACEHOLDER_SRC.test(src) || hasToken(img, /^(lazy|lazyload|lazy-row|unveil|b-lazy)$/i);
  if (standIn && lazy && !/^data:/i.test(lazy)) return lazy;
  return src;
}

function basename(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').toLowerCase(); } catch (e) { return ''; }
}
function pathOf(url) { try { return new URL(url).pathname; } catch (e) { return ''; } }
function declared(el, name) {
  var m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(attr(el, name));
  return m ? +m[1] : 0;
}

/* ---------- finding the logo unit on a page ---------- */

var HIDDEN_CLASS = /^(hidden|hide|sr-only|visually-hidden|screen-reader-text|d-none)$/i;
var HERO_ID = /^(banner|hero)$/i;
var HERO_CLASS = /^(hero|banner|hero-root|hero-section|hero-banner|event-banner|event-hero)$/i;
var MASTHEAD_ID = /^(ms_header_oauth|ms_header_oauth_wrapper)$/i;
var VERTICAL_ALT = /^(b2b|et[a-z]{2,24}(\.com)?|economictimesb2b\.com|(the )?economic times( b2b)?)$/i;
var TRACKER_HOST = /scorecardresearch|doubleclick|google-analytics|googletagmanager|facebook\.(com|net)|analytics\.|\.clarity\.ms/i;

function isMastheadBox(el) { return MASTHEAD_ID.test(attr(el, 'id')) || hasToken(el, /^logoWrapper$/i); }
function isFooterBox(el) { return el.name === 'footer' || /^(ms_footer|footer)$/i.test(attr(el, 'id')) || hasToken(el, /^(footer|site-footer|logo1)$/i); }

/* The hero: the first box the page itself calls its banner or hero; failing that its first <header> that is
   not the platform's own bar. */
function findHero(all) {
  var i, el;
  for (i = 0; i < all.length; i++) {
    el = all[i];
    if (!/^(section|div|header|main|article)$/.test(el.name)) continue;
    if (HERO_ID.test(attr(el, 'id')) || hasToken(el, HERO_CLASS)) return el;
  }
  for (i = 0; i < all.length; i++) {
    el = all[i];
    if (el.name === 'header' && !isMastheadBox(el) && !ancestorsOf(el).some(function (a) { return isMastheadBox(a) || isFooterBox(a); })) return el;
  }
  return null;
}
/* box must have been through markInside() */
function inside(el, box) { return !!box && el.rvIn === box; }

/* Why this picture cannot be the event's logo unit, or '' when nothing rules it out. The order is the order
   of the research these rules come from: what ET's own event pages put around the unit. */
function ruledOut(el, chain, url, page) {
  var cls = attr(el, 'class'), alt = attr(el, 'alt').trim(), host = hostOf(url), path = pathOf(url), base = basename(url);
  var w = declared(el, 'width'), h = declared(el, 'height');

  if (chain.some(function (a) { return a.name === 'noscript'; })) return 'inside noscript';
  if (url && TRACKER_HOST.test(host)) return 'a tracking pixel';
  if (w && h && w <= 2 && h <= 2) return 'a tracking pixel';

  /* our own generated sites: the ET logo inside the unit is ET's, not the event's */
  if (hasToken(el, /^rv-lu-et$/)) return 'the ET logo of our own logo unit';

  if (chain.some(isMastheadBox)) return 'the platform masthead';
  if (hasToken(el, /^(top-logo-view|floating-logo-view)$/i)) return 'the platform masthead';
  if (url && (host === 'st.etb2bimg.com' || path.indexOf('/Themes/Release/') !== -1)) return 'the platform masthead';
  if (/b2b-logo|et-b2b-logo|-logo-(header|footer|mobile)/.test(base)) return 'the platform masthead';
  if (alt && VERTICAL_ALT.test(alt) && alt.toLowerCase() !== page.eventName) return 'the platform masthead';

  var section = chain.filter(function (a) { return a.name === 'section'; })[0];
  if (section && /partner|sponsor|supported|exhibit|associate|knowledge/i.test(idAndClass(section))) return 'a sponsor or partner logo';
  if (chain.some(function (a) { return /sponsor|partner/i.test(idAndClass(a)) || hasToken(a, /^(logo-wrapper|logo-skeleton|sponsor-box)$/i); })) return 'a sponsor or partner logo';
  if (hasToken(el, /^lazy-row$/i)) return 'a sponsor or partner logo';
  var link = chain.filter(function (a) { return a.name === 'a'; })[0];
  if (link && /_blank/i.test(attr(link, 'target'))) {
    var to = hostOf(resolveUrl(attr(link, 'href'), page.url));
    if (to && page.host && registrable(to) !== registrable(page.host)) return 'a logo that links to another site';
  }

  if (chain.some(isFooterBox)) return 'in the footer';
  if (chain.some(function (a) { return /speaker|jury|gallery|glimpse|testimonial|portal-operations/i.test(idAndClass(a)); })) return 'a speaker, jury or gallery picture';

  if (hasToken(el, /(^|[-_])(ico|icon|icons)([-_]|$)/i)) return 'an icon';
  if (/\/icons?\//i.test(path)) return 'an icon';
  if ((w && h && w <= 64 && h <= 64) || (w && !h && w <= 48) || (h && !w && h <= 48)) return 'an icon';

  /* "2nd Edition", "2025": a badge beside the unit, reported by editionHints, never the unit itself */
  if (/edition|year/i.test(cls)) return 'an edition badge';
  return '';
}

var LOGO_CLASS_STRONG = /^(event-logo|logo-unit|lockup|lock-up|brand-logo|custom-logo|navbar-brand|site-logo|hero-logo)$/i;
var LOGO_CLASS_LOOSE = /(^|[-_])logo([-_]|$)/i;
var DATE_OR_BUTTONS = /^(lcn|icn-box|book-btn|btn-wrapper|hero-btn|hero-facts|hero-fact|hero-actions)$/i;

function formatScore(url, why) {
  var base = basename(url);
  if (/\.svg$/.test(base)) { why.push('an svg file'); return 12; }
  if (/\.(png|webp)$/.test(base)) { why.push('a format that can be transparent'); return 6; }
  if (/\.jpe?g$/.test(base)) { why.push('a jpeg (usually a background or a share card)'); return -12; }
  return 0;
}

function hiddenHeadingBeside(el) {
  var found = null;
  [elementSibling(el, 1), elementSibling(el, -1)].forEach(function (s) {
    if (!found && s && /^h[1-3]$/.test(s.name) && hasToken(s, HIDDEN_CLASS)) found = s;
  });
  return found;
}

function findLogoCandidates(html, pageUrl, eventName) {
  try {
    return candidates(html, pageUrl, eventName);
  } catch (e) {
    return [];
  }
}

function candidates(html, pageUrl, eventName) {
  var page = { url: resolveUrl(pageUrl, ''), host: '', eventName: String(eventName || '').trim().toLowerCase() };
  page.host = hostOf(page.url);
  var parsed = read(html), all = parsed.all;
  if (!all.length) return [];
  var hero = findHero(all);
  if (hero) markInside(hero);
  var nameWords = distinctiveWords(eventName);

  /* where the hero's date line or buttons start: the unit stands before them */
  var factsAt = -1;
  if (hero) all.some(function (el) { if (inside(el, hero) && hasToken(el, DATE_OR_BUTTONS)) { factsAt = el.rvAt; return true; } return false; });

  var found = [], strays = [], firstInHero = true;

  function nameSignals(el, c) {
    var heading = hiddenHeadingBeside(el);
    if (heading) {
      c.score += 20; c.why.push('a hidden heading beside it');
      if (nameWords.length && sharesWord(textOf(heading), nameWords)) { c.score += 15; c.why.push('that heading names the event'); }
    }
    if (nameWords.length && sharesWord(attr(el, 'alt') + ' ' + attr(el, 'title') + ' ' + attr(el, 'aria-label'), nameWords)) { c.score += 25; c.why.push('its alt text names the event'); }
  }

  all.forEach(function (el) {
    var chain, c, inHero;

    /* ---- our own generated sites say which picture is the unit ---- */
    if (el.name === 'img') {
      chain = ancestorsOf(el);
      var ours = hasAttr(el, 'data-rv-logo-unit') ? 1000 : chain.some(function (a) { return hasAttr(a, 'data-rv-logo-unit'); }) ? 900 : 0;
      var url = resolveUrl(sourceOf(el), page.url);
      if (!url) return;                                           // a data: URI, an empty src, mailto:, file: …
      if (ours && !chain.some(function (a) { return a.name === 'noscript'; }) && !hasToken(el, /^rv-lu-et$/)) {
        found.push({ url: url, kind: 'img', score: ours, why: ['marked as the logo unit (data-rv-logo-unit)'], cls: attr(el, 'class'), alt: attr(el, 'alt'), at: el.rvAt });
        return;
      }
      var out = ruledOut(el, chain, url, page);
      if (out) return;

      inHero = !!hero && inside(el, hero);
      c = { url: url, kind: 'img', score: 0, why: [], cls: attr(el, 'class'), alt: attr(el, 'alt'), at: el.rvAt };
      var strong = false;
      if (inHero && hasToken(el, /^logo$/i)) { c.score += 100; c.why.push('img.logo in the hero'); strong = true; }
      if (hasToken(el, LOGO_CLASS_STRONG) || LOGO_CLASS_STRONG.test(attr(el, 'id'))) { c.score += 60; c.why.push('its class says it is the event logo'); strong = true; }
      else if (chain.slice(0, 2).some(function (a) { return hasToken(a, LOGO_CLASS_STRONG); })) { c.score += 40; c.why.push('inside a box classed as the event logo'); strong = true; }
      else if (!hasToken(el, /^logo$/i) && (hasToken(el, LOGO_CLASS_LOOSE) || chain.slice(0, 2).some(function (a) { return hasToken(a, LOGO_CLASS_LOOSE); }))) { c.score += 30; c.why.push('"logo" in its class'); strong = true; }
      else if (!inHero && hasToken(el, /^logo$/i)) { c.score += 30; c.why.push('img.logo'); strong = true; }

      if (inHero) {
        c.score += 15; c.why.push('in the hero');
        if (firstInHero) { c.score += 30; c.why.push('the first picture in the hero'); }
        firstInHero = false;
        if (factsAt !== -1 && el.rvAt < factsAt) { c.score += 10; c.why.push('before the date line and buttons'); }
      } else {
        c.score -= 20;                                            // a picture further down the page needs a real reason
      }
      nameSignals(el, c);
      if (/^eager$/i.test(attr(el, 'loading')) || /^high$/i.test(attr(el, 'fetchpriority'))) { c.score += 8; c.why.push('loaded eagerly'); }
      c.score += formatScore(url, c.why);

      /* a picture kept on somebody else's host: only the hero's own, and only on a class that says "logo" —
         otherwise it waits in case the page has nothing else */
      if (!relatedHost(hostOf(url), page.host)) {
        if (!inHero) return;
        if (!strong) { c.why.push('on another host'); strays.push(c); return; }
        c.score -= 15; c.why.push('on another host');
      }
      found.push(c);
      return;
    }

    /* ---- lower-ranked: a drawing written straight into the hero ---- */
    if (el.name === 'svg' && hero && inside(el, hero)) {
      chain = ancestorsOf(el);
      if (chain.some(function (a) { return a.name === 'svg' || a.name === 'a' || a.name === 'button' || a.name === 'noscript'; })) return;
      if (hasAttr(el, 'data-rv-logo-unit') || chain.some(function (a) { return hasAttr(a, 'data-rv-logo-unit'); })) {
        c = { url: '', kind: 'inline-svg', score: 900, why: ['marked as the logo unit (data-rv-logo-unit)'], cls: attr(el, 'class'), alt: attr(el, 'aria-label'), at: el.rvAt };
      } else {
        if (ruledOut(el, chain, '', page)) return;
        if (/^true$/i.test(attr(el, 'aria-hidden')) || /wave|blob|shape|divider|backdrop|background|decor|pattern|(^|[-_ ])bg([-_ ]|$)/i.test(attr(el, 'class'))) return;
        var box = /^\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)\s*$/i.exec(attr(el, 'viewbox') || attr(el, 'viewBox'));
        var sw = box ? +box[1] : declared(el, 'width'), sh = box ? +box[2] : declared(el, 'height');
        if (!(sw >= 200) || !(sh > 0) || sw / sh < 1 / 1.1 || sw / sh > 8) return;
        c = { url: '', kind: 'inline-svg', score: 20, why: ['a drawing written into the hero'], cls: attr(el, 'class'), alt: attr(el, 'aria-label'), at: el.rvAt };
        if (hasToken(el, LOGO_CLASS_LOOSE) || hasToken(el, LOGO_CLASS_STRONG)) { c.score += 40; c.why.push('"logo" in its class'); }
        nameSignals(el, c);
        if (nameWords.length && sharesWord(textOf(el), nameWords)) { c.score += 25; c.why.push('its text names the event'); }
      }
      if (typeof el.startIndex !== 'number' || typeof el.endIndex !== 'number') return;
      c.svg = parsed.src.slice(el.startIndex, el.endIndex + 1);
      if (c.svg.length > MAX_INLINE_SVG_CHARS || !/<\/svg\s*>\s*$/i.test(c.svg)) return;     // too large, or never closed
      found.push(c);
      return;
    }

    /* ---- lower-ranked: a box in the hero classed "logo" that shows its picture as a CSS background ---- */
    if (hero && el.name !== 'img' && el.name !== 'svg' && inside(el, hero) && hasToken(el, LOGO_CLASS_LOOSE)) {
      var bg = /background(?:-image)?\s*:[^;]*url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(attr(el, 'style'));
      var bgUrl = bg ? resolveUrl(bg[1], page.url) : '';
      chain = ancestorsOf(el);
      if (!bgUrl || ruledOut(el, chain, bgUrl, page) || !relatedHost(hostOf(bgUrl), page.host)) return;
      c = { url: bgUrl, kind: 'img', score: 15, why: ['the background of a box classed "logo" in the hero'], cls: attr(el, 'class'), alt: attr(el, 'aria-label'), at: el.rvAt };
      c.score += formatScore(bgUrl, c.why);
      found.push(c);
    }
  });

  if (!found.some(function (c) { return c.score > 0; })) found = found.concat(strays);

  /* one entry per picture, the best-scored one */
  var seen = {}, list = [];
  found.filter(function (c) { return c.score > 0; })
    .sort(function (a, b) { return b.score - a.score || a.at - b.at; })
    .forEach(function (c) {
      var key = c.kind === 'img' ? c.url : 'svg@' + c.at;
      if (seen[key]) return;
      seen[key] = true;
      var out = { url: c.url, kind: c.kind, score: c.score, why: c.why, cls: c.cls, alt: c.alt };
      if (c.kind === 'inline-svg') out.svg = c.svg;
      list.push(out);
    });
  return list.slice(0, MAX_CANDIDATES);
}

/* ---------- which edition a page is ---------- */

/* The years written in a text, each as often as it is written. "@2047" and "#2047" are a slogan or a tag
   (Viksit Bharat @2047), not the year of an edition, and are not counted. */
function yearsIn(text) {
  var out = [], re = /(^|[^0-9@#])(20\d\d)(?![0-9])/g, m;
  while ((m = re.exec(String(text || '')))) out.push(m[2]);
  return out;
}

function editionHints(html, pageUrl) {
  var hints = { title: '', headings: [], years: [], editionImage: '' };
  var counted = [];
  function count(text) { counted = counted.concat(yearsIn(text)); }
  try {
    var page = resolveUrl(pageUrl, '');
    var all = read(html).all;
    var hero = findHero(all);
    if (hero) markInside(hero);
    var titleEl = all.filter(function (el) { return el.name === 'title' && !ancestorsOf(el).some(function (a) { return a.name === 'svg'; }); })[0];
    hints.title = titleEl ? textOf(titleEl) : '';
    count(hints.title);

    /* hidden headings in the hero and right next to it (ET's pages keep the event's full name there for
       search engines while the picture shows it to people), then the heading people do see */
    var beside = [];
    if (hero) {
      var n = hero, p = hero, i;
      for (i = 0; i < 2 && n; i++) { n = elementSibling(n, 1); if (n) beside.push(n); }
      for (i = 0; i < 2 && p; i++) { p = elementSibling(p, -1); if (p) beside.push(p); }
    }
    var seen = {};
    function addHeading(el) {
      var t = textOf(el);
      if (!t || seen[t]) return;
      seen[t] = true;
      hints.headings.push(t.slice(0, 300));
      count(t);
    }
    all.forEach(function (el) {
      if (!/^h[1-3]$/.test(el.name) || !hasToken(el, HIDDEN_CLASS)) return;
      if ((hero && inside(el, hero)) || beside.indexOf(el) !== -1) addHeading(el);
    });
    var visible = all.filter(function (el) {
      return el.name === 'h1' && !hasToken(el, HIDDEN_CLASS) && !ancestorsOf(el).some(function (a) { return a.name === 'noscript' || hasToken(a, HIDDEN_CLASS); });
    })[0];
    if (visible) addHeading(visible);

    if (hero) {
      all.forEach(function (el) {
        if (!inside(el, hero)) return;
        /* the date line, once: not again for the boxes inside it */
        if (hasToken(el, /^(lcn|icn-box|hero-facts|hero-fact|event-date|date)$/i) &&
            !ancestorsOf(el).some(function (a) { return hasToken(a, /^(lcn|icn-box|hero-facts|hero-fact|event-date|date)$/i); })) count(textOf(el));
        if (!hints.editionImage && el.name === 'img' && /edition|year/i.test(attr(el, 'class'))) hints.editionImage = resolveUrl(sourceOf(el), page);
      });
    }
    count(pathOf(page));
  } catch (e) { /* what was read before the failure stands */ }

  var tally = {}, order = [];
  counted.forEach(function (y) { if (!tally[y]) { tally[y] = 0; order.push(y); } tally[y]++; });
  hints.years = order.slice().sort(function (a, b) { return tally[b] - tally[a] || order.indexOf(a) - order.indexOf(b); });
  return hints;
}

/* ---------- a year as a lock-up writes it ----------
   A lock-up writes its edition's year in its own way: "2026", "'26" / "’26" (an apostrophe and two digits),
   "26", "FY26", "2026-27". Reading, comparing and moving it on is done here, in code, from the year AS
   WRITTEN; the new year is always written the same way ("'26" -> "'27", "2026-27" -> "2027-28").
     shownYear(written)  -> { written, full: '2026', form: 'full'|'range'|'apos'|'fy'|'short' } | null
     yearAs(written, to) -> the year `to` (four digits) written as `written` is: "'26", "2027" -> "'27"; '' when it cannot be
     yearsShownIn(text)  -> [ shownYear… ] every edition-like year written in a text, in order. Two digits
                            alone ("26") are not counted in running text — "26 March" is a date — only
                            with an apostrophe or "FY" before them; "@2047" is a slogan, not a year. */
var APOSTROPHES = '\'’‘`´';
function shownYear(written) {
  var s = String(written == null ? '' : written).replace(/\s+/g, ' ').trim(), m;
  if (!s || s.length > 12) return null;
  if ((m = /^(20\d\d)$/.exec(s))) return { written: s, full: m[1], form: 'full' };
  if ((m = /^(20\d\d) ?[-–—\/] ?((?:20)?\d\d)$/.exec(s))) {
    var second = m[2].length === 2 ? +('20' + m[2]) : +m[2];
    return second === +m[1] + 1 ? { written: s, full: m[1], form: 'range' } : null;
  }
  if ((m = new RegExp('^[' + APOSTROPHES + '](\\d\\d)$').exec(s))) return { written: s, full: '20' + m[1], form: 'apos' };
  if ((m = new RegExp('^FY ?[' + APOSTROPHES + ']?(\\d\\d)$', 'i').exec(s))) return { written: s, full: '20' + m[1], form: 'fy' };
  if ((m = /^FY ?(20\d\d)$/i.exec(s))) return { written: s, full: m[1], form: 'fy' };
  if ((m = /^(\d\d)$/.exec(s))) return { written: s, full: '20' + m[1], form: 'short' };
  return null;
}
function yearAs(written, to) {
  var y = shownYear(written);
  to = String(to == null ? '' : to);
  if (!y || !/^20\d\d$/.test(to)) return '';
  var s = y.written;
  if (y.form === 'full') return to;
  if (y.form === 'range') {
    return s.replace(/^(20\d\d)( ?[-–—\/] ?)((?:20)?\d\d)$/, function (all, a, sep, b) {
      var next = String(+to + 1);
      return to + sep + (b.length === 2 ? next.slice(2) : next);
    });
  }
  /* "'26", "FY26", "26": the two digits; "FY2026": the four */
  return /20\d\d$/.test(s) && y.form === 'fy' ? s.replace(/20\d\d$/, to) : s.replace(/\d\d$/, to.slice(2));
}
function yearsShownIn(text) {
  var s = String(text == null ? '' : text).slice(0, 20000), found = [], m;
  var full = /(^|[^0-9@#])(20\d\d(?: ?[-–—] ?(?:20)?\d\d)?)(?![0-9])/g;
  while ((m = full.exec(s))) {
    var at = m.index + m[1].length, y = shownYear(m[2]) || shownYear(m[2].slice(0, 4));
    /* "FY2026": the prefix is part of how it is written */
    var fy = /FY ?$/i.exec(s.slice(Math.max(0, at - 3), at));
    if (fy && shownYear(fy[0] + m[2])) y = shownYear(fy[0] + m[2]);
    if (y) found.push({ at: at, y: y });
  }
  var short = new RegExp('(FY ?[' + APOSTROPHES + ']?|[' + APOSTROPHES + '])(\\d\\d)(?![0-9])', 'gi');
  while ((m = short.exec(s))) {
    var before = s.charAt(m.index - 1);
    if (/[0-9]/.test(before)) continue;
    /* "FY" is a word of its own, not the end of one */
    if (/^FY/i.test(m[1]) && /[A-Za-z]/.test(before)) continue;
    var w = shownYear(m[1] + m[2]);
    if (w) found.push({ at: m.index, y: w });
  }
  /* "Since 2015", "Est. 2019", "© 2024": a founding or copyright year is not an edition's */
  return found.sort(function (a, b) { return a.at - b.at; }).filter(function (f) {
    return !/(since|est\.?|estd\.?|established|founded|©|\(c\)|copyright)\s*$/i.test(s.slice(Math.max(0, f.at - 14), f.at));
  }).map(function (f) { return f.y; });
}

/* The event's own year, from what the event says about itself, never from today's date: the year in its
   name ("AutoTech Summit 2027", "Summit '27"), else the year it starts, else the year its brief names most
   (ties: the latest). '' when nothing says. The name comes first: it is what the site shows as the event's
   title, and a lock-up that disagreed with it would be the very mistake this guards against. */
function eventYear(o) {
  o = o || {};
  var named = yearsShownIn(o.eventName);
  if (named.length) return named[named.length - 1].full;
  var iso = /^\s*(20\d\d)-\d\d/.exec(String(o.start || ''));
  if (iso) return iso[1];
  var tally = {};
  (Array.isArray(o.briefTexts) ? o.briefTexts : [o.briefTexts]).forEach(function (t) {
    yearsShownIn(t).forEach(function (y) { tally[y.full] = (tally[y.full] || 0) + 1; });
  });
  return Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a] || +b - +a; })[0] || '';
}

/* -> { from, to }: the year the previous edition's unit carries and the year the new one must carry.
   `to` is the new event's own (eventYear). `from` is only ever a year the previous page itself shows —
   never "to minus one" on a guess, never a year that is not earlier than to. */
function editionYears(o) {
  o = o || {};
  var to = eventYear(o);
  if (!to) return { from: '', to: '' };
  var seen = ((o.hints && Array.isArray(o.hints.years)) ? o.hints.years : []).map(String).concat(yearsIn(pathOf(resolveUrl(o.pageUrl, ''))));
  var from = '';
  seen.forEach(function (y) {
    if (!/^20\d\d$/.test(y) || +y >= +to) return;
    if (!from || +y > +from) from = y;
  });
  return { from: from, to: to };
}

function wholeYear(year) { return /^\d{4}$/.test(String(year)) ? new RegExp('(^|[^0-9])' + year + '(?![0-9])', 'g') : null; }

/* How a year written one way is found in an SVG's own characters, and what it becomes: an apostrophe may be
   written as itself or as a character reference (&#8217; &#x2019; &apos; &#39;), a dash likewise. Two digits
   alone are never looked for in a file: "26" is too often something else.
   -> { re, numeric, rewrite(groups) } | null. numeric: the match starts with the digits of a whole year
   (so one inside a character reference such as "&#x2025;" is not it). */
var APOS_RAW = '(?:[' + APOSTROPHES + ']|&#0*39;|&#[xX]0*27;|&apos;|&#0*821[67];|&#[xX]0*201[89];)';
var DASH_RAW = '(?:[-–—\\/]|&#0*821[12];|&#[xX]0*201[34];)';
function yearPattern(fromWritten, to) {
  var y = shownYear(fromWritten), next = yearAs(fromWritten, to);
  if (!y || !next || next === y.written || y.form === 'short') return null;
  var d2 = y.full.slice(2), t2 = String(to).slice(2);
  if (y.form === 'full') return { numeric: true, re: new RegExp('(^|[^0-9])' + y.full + '(?![0-9])', 'g'), rewrite: function (g) { return g[0] + to; } };
  if (y.form === 'range') {
    var second = /((?:20)?\d\d)$/.exec(y.written)[1], nextYear = String(+to + 1);
    return { numeric: true, re: new RegExp('(^|[^0-9])' + y.full + '(\\s?' + DASH_RAW + '\\s?)' + second + '(?![0-9])', 'g'),
      rewrite: function (g) { return g[0] + to + g[1] + (second.length === 2 ? nextYear.slice(2) : nextYear); } };
  }
  if (y.form === 'apos') return { re: new RegExp('(' + APOS_RAW + ')' + d2 + '(?![0-9])', 'g'), rewrite: function (g) { return g[0] + t2; } };
  /* FY26 / FY'26 / FY2026 */
  var four = /20\d\d$/.test(y.written);
  return { re: new RegExp('(^|[^A-Za-z0-9])(FY\\s?' + APOS_RAW + '?)' + (four ? y.full : d2) + '(?![0-9])', 'gi'), rewrite: function (g) { return g[0] + g[1] + (four ? to : t2); } };
}

function bumpYear(text, from, to) {
  var re = wholeYear(from);
  if (!re || !/^\d{4}$/.test(String(to))) return String(text == null ? '' : text);
  return String(text == null ? '' : text).replace(re, function (m, pre) { return pre + to; });
}

/* ---------- what a picture is, from its bytes ---------- */

var NO_IMAGE = { type: '', mime: '', width: 0, height: 0, alpha: null };

function isSpace(code) { return code === 32 || code === 9 || code === 10 || code === 13 || code === 12; }
function isLetter(code) { return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); }

/* Where a tag that opens at `at` ends (the place after its ">"), or -1 when the text ends first. A ">"
   inside a quoted value does not end it. Each character is looked at once. */
function tagEnd(src, at) {
  var i = at + 1, n = src.length;
  while (i < n) {
    var code = src.charCodeAt(i);
    if (code === 62) return i + 1;
    if (code === 34 || code === 39) {
      var close = src.indexOf(code === 34 ? '"' : '\'', i + 1);
      if (close === -1) return -1;
      i = close + 1;
    } else i++;
  }
  return -1;
}

/* The attributes a tag writes, in order: [ { name (lower case), value, from, to } ] — from and to are where
   the value stands in the tag, without its quotes. */
function tagAttrs(tag) {
  var out = [], n = tag.length, i = 1, code;
  while (i < n && !isSpace(code = tag.charCodeAt(i)) && code !== 47 && code !== 62) i++;        // the tag's name
  while (i < n) {
    code = tag.charCodeAt(i);
    if (isSpace(code) || code === 47 || code === 62 || code === 61) { i++; continue; }
    if (code === 34 || code === 39) {                             // a quoted string that is no attribute's value
      var stray = tag.indexOf(code === 34 ? '"' : '\'', i + 1);
      if (stray === -1) break;
      i = stray + 1;
      continue;
    }
    var start = i;
    while (i < n && !isSpace(code = tag.charCodeAt(i)) && code !== 61 && code !== 47 && code !== 62 && code !== 34 && code !== 39) i++;
    var name = tag.slice(start, i).toLowerCase(), j = i;
    while (j < n && isSpace(tag.charCodeAt(j))) j++;
    if (tag.charCodeAt(j) !== 61) continue;                        // a name with no value
    j++;
    while (j < n && isSpace(tag.charCodeAt(j))) j++;
    code = tag.charCodeAt(j);
    if (code === 34 || code === 39) {
      var close = tag.indexOf(code === 34 ? '"' : '\'', j + 1);
      if (close === -1) break;
      out.push({ name: name, value: tag.slice(j + 1, close), from: j + 1, to: close });
      i = close + 1;
    } else {
      var from = j;
      while (j < n && !isSpace(code = tag.charCodeAt(j)) && code !== 62) j++;
      var to = (j === n - 1 && j > from && tag.charCodeAt(j - 1) === 47) ? j - 1 : j;          // fill=#000/>
      out.push({ name: name, value: tag.slice(from, to), from: from, to: to });
      i = j;
    }
  }
  return out;
}
function attrIn(attrs, name) {
  for (var i = 0; i < attrs.length; i++) if (attrs[i].name === name) return attrs[i];
  return null;
}

/* Where the document element <svg> opens, or -1 when the text is not an SVG document. Before it there may
   only be an <?xml … ?> line, comments and one <!DOCTYPE svg …> with nothing declared inside it. Read by
   stepping forward: a pattern for "any number of comments" tried the same comments again and again. */
function svgStartAt(text) {
  var i = 0, n = text.length, doctype = false, end;
  function space() { while (i < n && /\s/.test(text.charAt(i))) i++; }
  space();
  if (text.substr(i, 5).toLowerCase() === '<?xml') {
    end = text.indexOf('>', i);
    if (end === -1 || text.charAt(end - 1) !== '?') return -1;
    i = end + 1;
  }
  for (;;) {
    space();
    if (text.substr(i, 4) === '<!--') {
      end = text.indexOf('-->', i + 4);
      if (end === -1) return -1;
      i = end + 3;
    } else if (!doctype && text.substr(i, 9).toLowerCase() === '<!doctype' && /\s/.test(text.charAt(i + 9))) {
      i += 9;
      space();
      if (text.substr(i, 3).toLowerCase() !== 'svg') return -1;
      end = text.indexOf('>', i);
      var subset = text.indexOf('[', i);
      if (end === -1 || (subset !== -1 && subset < end)) return -1;
      i = end + 1;
      doctype = true;
    } else break;
  }
  return (text.substr(i, 4).toLowerCase() === '<svg' && /[\s>]/.test(text.charAt(i + 4))) ? i : -1;
}

function svgLength(value) {
  var m = /^\s*(\d*\.?\d+)\s*(px)?\s*$/i.exec(String(value || ''));
  return m ? +m[1] : 0;
}
/* the size an SVG gives itself: width and height, else its viewBox (also for the one that is missing).
   `at` is where its <svg> tag opens. */
function svgSize(text, at) {
  var end = tagEnd(text, at);
  if (end === -1) return { width: 0, height: 0 };
  var attrs = tagAttrs(text.slice(at, end));
  function a(name) { var found = attrIn(attrs, name); return found ? found.value : ''; }
  var w = svgLength(a('width')), h = svgLength(a('height'));
  var box = /^\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)\s*$/i.exec(a('viewbox').slice(0, 200));
  var bw = box ? +box[1] : 0, bh = box ? +box[2] : 0;
  if (w && h) return { width: w, height: h };
  if (bw && bh) {
    if (w) return { width: w, height: Math.round(w * bh / bw * 100) / 100 };
    if (h) return { width: Math.round(h * bw / bh * 100) / 100, height: h };
    return { width: bw, height: bh };
  }
  return { width: 0, height: 0 };
}

function pngInfo(buf) {
  if (buf.length < 26 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  var out = { type: 'png', mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: null };
  var colour = buf[25];
  if (colour === 4 || colour === 6) { out.alpha = true; return out; }
  /* greyscale, RGB and palette pictures are see-through only with a tRNS chunk, which comes before the pixels */
  var at = 8;
  while (at + 8 <= buf.length) {
    var len = buf.readUInt32BE(at), name = buf.toString('latin1', at + 4, at + 8);
    if (name === 'tRNS') { out.alpha = true; return out; }
    if (name === 'IDAT' || name === 'IEND') { out.alpha = false; return out; }
    at += 12 + len;
  }
  return out;                                                     // the bytes end before the pixels: not known
}

function jpegInfo(buf) {
  var at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xFF) { at++; continue; }
    var marker = buf[at + 1];
    if (marker === 0xFF) { at++; continue; }                      // fill bytes
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { at += 2; continue; }
    if (marker === 0xDA || marker === 0xD9) break;                // the pixels start: no size was declared
    var len = buf.readUInt16BE(at + 2);
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (at + 9 > buf.length) break;
      return { type: 'jpeg', mime: 'image/jpeg', width: buf.readUInt16BE(at + 7), height: buf.readUInt16BE(at + 5), alpha: false };
    }
    if (len < 2) break;
    at += 2 + len;
  }
  return { type: 'jpeg', mime: 'image/jpeg', width: 0, height: 0, alpha: false };
}

function webpInfo(buf) {
  var out = { type: 'webp', mime: 'image/webp', width: 0, height: 0, alpha: null };
  if (buf.length < 30) return out;
  var kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8 ' && buf[23] === 0x9D && buf[24] === 0x01 && buf[25] === 0x2A) {
    out.width = buf.readUInt16LE(26) & 0x3FFF; out.height = buf.readUInt16LE(28) & 0x3FFF; out.alpha = false;
  } else if (kind === 'VP8L' && buf[20] === 0x2F) {
    var bits = buf.readUInt32LE(21);
    out.width = (bits & 0x3FFF) + 1; out.height = ((bits >>> 14) & 0x3FFF) + 1; out.alpha = !!((bits >>> 28) & 1);
  } else if (kind === 'VP8X') {
    out.alpha = !!(buf[20] & 0x10);
    out.width = buf.readUIntLE(24, 3) + 1; out.height = buf.readUIntLE(27, 3) + 1;
  }
  return out;
}

function imageInfo(buf) {
  try {
    if (!Buffer.isBuffer(buf)) {
      if (buf instanceof Uint8Array) buf = Buffer.from(buf);
      else return Object.assign({}, NO_IMAGE);
    }
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
        buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return pngInfo(buf) || Object.assign({}, NO_IMAGE);
    if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return jpegInfo(buf);
    if (buf.length >= 10) {
      var six = buf.toString('latin1', 0, 6);
      /* a GIF may have one see-through colour; telling needs its frames, so alpha is "not known" */
      if (six === 'GIF87a' || six === 'GIF89a') return { type: 'gif', mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), alpha: null };
    }
    if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return webpInfo(buf);
    /* SVG is text: no NUL byte near the start, and the document element is <svg> */
    if (buf.slice(0, 4096).indexOf(0) === -1) {
      var text = buf.slice(0, 262144).toString('utf8').replace(/^\uFEFF/, '');
      var svgAt = svgStartAt(text);
      if (svgAt !== -1) {
        var size = svgSize(text, svgAt);
        return { type: 'svg', mime: 'image/svg+xml', width: size.width, height: size.height, alpha: null };
      }
    }
  } catch (e) { /* bytes cut short in the middle of a header */ }
  return Object.assign({}, NO_IMAGE);
}

/* -> '' when the picture could be a logo unit, else why not. Measured on real ET pages: the units were
   571x147 and 553x340; the "2nd Edition" badge beside one was 109x112; hero backgrounds are wide JPEGs. */
function plausibleUnit(info) {
  if (!info || !info.type) return 'not a picture we can read';
  var w = +info.width || 0, h = +info.height || 0, raster = info.type !== 'svg';
  if (!w || !h) return raster ? 'its size cannot be read' : '';   // an SVG with no size of its own scales to any
  if (raster && w < 160) return 'too small to be a logo unit (' + w + ' px wide)';
  if (w <= 130 && h <= 130 && w / h > 0.75 && w / h < 1.34) return 'a small square (a badge or an icon)';
  if (w / h < 1 / 1.1) return 'taller than it is wide';
  if (w / h > 8) return 'a strip, far wider than a logo unit';
  if (raster && (info.type === 'jpeg' || info.alpha === false) && w > 1200 && w / h > 2.2) return 'a banner picture, not a logo';
  return '';
}

/* ---------- SVG ---------- */

/* The upload route's rule (api-events.js, SVG_ACTIVE / svgIsActive — not exported there, so repeated here):
   anything in an SVG that can run code, load another document or expand into either. */
var SVG_ACTIVE = /<\s*script[\s>\/]|<\s*foreignObject[\s>\/]|<\s*(?:iframe|embed|object)[\s>\/]|[\s"'\/]on[a-z]{2,}\s*=|javascript\s*:|<!ENTITY|data\s*:\s*text\/html/i;

/* A browser reads "java&#115;cript:" and "java<newline>script:" as "javascript:", so the text is also
   checked the way a browser would end up reading it. */
function svgIsActive(text) {
  text = String(text == null ? '' : text);
  if (SVG_ACTIVE.test(text)) return true;
  var seen = text.replace(/&#(x[0-9a-f]+|\d+);?/gi, function (m, n) {
    var code = n.charAt(0).toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  }).replace(/&(colon|tab|newline);/gi, function (m, name) {
    return { colon: ':', tab: '\t', newline: '\n' }[name.toLowerCase()];
  }).replace(/[\t\n\r]/g, '');
  return seen !== text && SVG_ACTIVE.test(seen);
}

function decodeXml(s) {
  return String(s).replace(/&#(x[0-9a-f]+|\d+);/gi, function (m, n) {
    var code = n.charAt(0).toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&');
}

var TEXT_ELEMENT = /^(text|tspan|textpath)$/;
var WORDS_ELEMENT = /^(text|tspan|textpath|title|desc)$/;
var RAW_ELEMENT = /^(style|script)$/;
function tagName(piece) {
  var m = /^<(\/?)(?:[A-Za-z][\w.-]*:)?([A-Za-z][\w.-]*)/.exec(piece.slice(0, 200));
  return m ? { close: !!m[1], name: m[2].toLowerCase(), empty: piece.charAt(piece.length - 2) === '/' } : null;
}

/* What an SVG is made of, piece by piece and in order; joined again the pieces are the SVG, byte for byte.
     { s, kind: 'chars' }             the characters between tags (a "<" that opens nothing is one too)
     { s, kind: 'cdata' }             <![CDATA[ … ]]>
     { s, kind: 'tag', tag }          <a …>, </a>, <a …/>; tag is { close, name, empty }
     { s, kind: 'raw', of }           what stands inside <style> or <script>: a style sheet or code, not markup
     { s, kind: 'other' }             a comment, <?…?>, and whatever follows something that is never closed
   chars and cdata also say where they stand: inText (inside <text>, <tspan> or <textPath>) and inWords
   (those, or <title> or <desc>).

   The drawing may have been lifted out of an HTML page and need not be well formed, so: a closing tag
   closes back to the nearest element of its name, </svg> closes everything, and a comment, a CDATA block,
   a tag or a <style> that never ends takes the rest of the text with it — nothing after it is text.

   The text is walked once. A place where an ending was looked for and not found is never looked from
   again, which is what a pattern (<!--[\s\S]*?-->|…) did for every "<" of a file written to be slow. */
function svgPieces(src) {
  var out = [], n = src.length, i = 0, open = [], held = {}, texts = 0;
  function put(kind, to, extra) {
    var piece = extra || {};
    piece.s = src.slice(i, to);
    piece.kind = kind;
    if (kind === 'chars' || kind === 'cdata') { piece.inText = texts > 0; piece.inWords = open.length > 0; }
    out.push(piece);
    i = to;
  }
  function closeTo(name) {                                        // only ever called with a name that is open
    for (;;) {
      var last = open.pop();
      held[last]--;
      if (TEXT_ELEMENT.test(last)) texts--;
      if (last === name) return;
    }
  }
  while (i < n) {
    if (src.charCodeAt(i) !== 60) {
      var lt = src.indexOf('<', i);
      put('chars', lt === -1 ? n : lt);
      continue;
    }
    var end, kind = 'other', next = src.charCodeAt(i + 1);
    if (next === 33 && src.substr(i, 4) === '<!--') {
      end = src.indexOf('-->', i + 4);
      end = end === -1 ? -1 : end + 3;
    } else if (next === 33 && src.substr(i, 9) === '<![CDATA[') {
      kind = 'cdata';
      end = src.indexOf(']]>', i + 9);
      end = end === -1 ? -1 : end + 3;
    } else if (next === 63) {
      end = src.indexOf('?>', i + 2);
      end = end === -1 ? -1 : end + 2;
    } else if (isLetter(next) || (next === 47 && isLetter(src.charCodeAt(i + 2)))) {
      kind = 'tag';
      end = tagEnd(src, i);
    } else {
      put('chars', i + 1);                                        // "a < b", <!DOCTYPE: a "<" that opens nothing
      continue;
    }
    if (end === -1) { put('other', n); break; }
    if (kind !== 'tag') { put(kind, end); continue; }

    var tag = tagName(src.substr(i, 200)) || { close: false, name: '', empty: false };
    tag.empty = src.charCodeAt(end - 2) === 47;
    put('tag', end, { tag: tag });
    if (tag.close) {
      if (tag.name === 'svg') { open = []; held = {}; texts = 0; }
      else if (held[tag.name] > 0) closeTo(tag.name);
      continue;
    }
    if (tag.empty) continue;
    if (RAW_ELEMENT.test(tag.name)) {
      var closer = new RegExp('<\\/(?:[A-Za-z][\\w.-]*:)?' + tag.name + '[\\s>\\/]', 'gi');
      closer.lastIndex = i;
      var found = closer.exec(src);
      if (!found) { if (i < n) put('raw', n, { of: tag.name }); break; }
      if (found.index > i) put('raw', found.index, { of: tag.name });
      continue;
    }
    if (WORDS_ELEMENT.test(tag.name)) {
      open.push(tag.name);
      held[tag.name] = (held[tag.name] || 0) + 1;
      if (TEXT_ELEMENT.test(tag.name)) texts++;
    }
  }
  return out;
}

/* A design tool often exports a lock-up as an SVG that only holds another SVG, as a base64 picture. The
   base64 may be wrapped over lines. */
var NESTED_SVG = /(data:image\/svg\+xml(?:;[\w=-]+){0,4};base64,)([A-Za-z0-9+\/=\s]+)/g;

/* a nested picture is one that is shown: named in a tag (href="data:…") or in a style sheet (url(data:…)) —
   not one quoted in a comment, in text or in a script. svgLayers and svgReplaceYear both go by this. */
function holdsLayers(piece) {
  return (piece.kind === 'tag' && !piece.tag.close) || (piece.kind === 'raw' && piece.of === 'style');
}
/* What of a matched run is the base64: { data, rest }. Wrapped base64 has white space in it, and so the
   pattern takes white space — but in href=data:…,AAAA width=5 (no quotes) the run ends at the first space
   and " width=5" is the tag's, not the picture's. Only a run that is closed by a quote or a ")" is taken
   across its spaces; the space at its end is never part of it. */
function layerRun(data, after) {
  var end = data.length;
  while (end > 0 && isSpace(data.charCodeAt(end - 1))) end--;
  if (!/^["')&]?$/.test(after)) {
    var gap = data.search(/\s/);
    if (gap !== -1 && gap < end) end = gap;
  }
  return { data: data.slice(0, end), rest: data.slice(end) };
}
/* the SVG a base64 run holds, or '' */
function nestedSvg(data) {
  var inner = '';
  try { inner = Buffer.from(data.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch (e) { inner = ''; }
  return /<svg[\s>]/i.test(inner) ? inner : '';
}

function svgLayers(text) {
  var out = [];
  (function open(layer, depth) {
    out.push(layer);
    if (depth >= MAX_SVG_DEPTH || layer.length > MAX_SVG_CHARS || layer.indexOf('base64,') === -1) return;
    svgPieces(layer).forEach(function (piece) {
      if (!holdsLayers(piece) || piece.s.indexOf('base64,') === -1) return;
      var m, re = new RegExp(NESTED_SVG.source, 'g');
      while ((m = re.exec(piece.s))) {
        var inner = nestedSvg(layerRun(m[2], piece.s.charAt(re.lastIndex)).data);
        if (inner) open(inner, depth + 1);
      }
    });
  })(String(text == null ? '' : text), 0);
  return out;
}
function tooLong(text) { return String(text == null ? '' : text).length > MAX_SVG_CHARS; }

/* every string set as real text (<text>, <tspan>): what a year can be found and replaced in */
function svgTexts(text) {
  var out = [];
  if (tooLong(text)) return out;
  svgLayers(text).forEach(function (layer) {
    svgPieces(layer).forEach(function (piece) {
      if (!piece.inText) return;
      /* CDATA is characters exactly as written: "&amp;" in it is five characters, not one */
      var s = (piece.kind === 'cdata' ? piece.s.slice(9, -3) : decodeXml(piece.s)).replace(/\s+/g, ' ').trim();
      if (s) out.push(s);
    });
  });
  return out;
}

/* The inks of one layer, each with how many shapes it colours: [ { colour: '#rrggbb', weight } ]. Only what
   colours something is read — the fill, stroke and style of a tag, and the rules of a style sheet — never
   the words "fill: white" where they are text, a title or a comment. */
function inksOf(layer) {
  var inks = [], uses = Object.create(null), tags = [], sheets = [];
  function add(value, weight) {
    var c = genDesign.colourOf(String(value).replace(/!important/i, '').trim().slice(0, 100));
    if (c) inks.push({ colour: c, weight: weight });
  }
  function declarations(text, weight) {
    text.split(';').forEach(function (decl) {
      var colon = decl.indexOf(':');
      if (colon !== -1 && /^\s*(fill|stroke)\s*$/i.test(decl.slice(0, colon).slice(-40))) add(decl.slice(colon + 1), weight);
    });
  }
  svgPieces(layer).forEach(function (piece) {
    if (piece.kind === 'raw' && piece.of === 'style') { sheets.push(piece.s); return; }
    if (piece.kind !== 'tag' || piece.tag.close) return;
    var attrs = tagAttrs(piece.s), cls = attrIn(attrs, 'class');
    if (cls) cls.value.split(/\s+/).forEach(function (t) { if (t) uses[t] = (uses[t] || 0) + 1; });
    tags.push(attrs);
  });
  /* a style sheet, rule by rule: cut at each "}", and the selector is what stands before the last "{"
     (so a rule inside @media { … } is read as the rule it is) */
  sheets.forEach(function (css) {
    css.split('}').forEach(function (rule) {
      var brace = rule.lastIndexOf('{');
      if (brace === -1) return;
      var selector = rule.slice(brace > 0 ? rule.lastIndexOf('{', brace - 1) + 1 : 0, brace).replace('<![CDATA[', '');
      var cls = /^\s*\.([\w-]+)\s*$/.exec(selector.slice(-200));
      declarations(rule.slice(brace + 1), cls ? Math.max(1, uses[cls[1]] || 0) : 1);
    });
  });
  tags.forEach(function (attrs) {
    attrs.forEach(function (a) {
      if (a.name === 'fill' || a.name === 'stroke') add(a.value, 1);
      else if (a.name === 'style') declarations(a.value, 1);
    });
  });
  return inks;
}

/* What background the drawing was made for. White and near-white inks need a dark background behind them;
   black and near-black inks a light one. A brand colour (ET's red, a gold) reads on both and says nothing. */
function svgTone(text) {
  var light = 0, dark = 0;
  if (tooLong(text)) return '';
  svgLayers(text).forEach(function (layer) {
    inksOf(layer).forEach(function (ink) {
      var lum = genDesign.luminance(ink.colour);
      var r = parseInt(ink.colour.slice(1, 3), 16), g = parseInt(ink.colour.slice(3, 5), 16), b = parseInt(ink.colour.slice(5, 7), 16);
      var max = Math.max(r, g, b), saturation = max ? (max - Math.min(r, g, b)) / max : 0;
      if (saturation > 0.5 && lum > 0.05 && lum < 0.8) return;
      if (lum >= 0.55) light += ink.weight;
      else if (lum <= 0.22) dark += ink.weight;
    });
  });
  var total = light + dark;
  if (!total) return '';
  if (light / total >= 0.6) return 'for-dark';
  if (dark / total >= 0.6) return 'for-light';
  return '';
}

/* Moves the year on where — and only where — it is real text: the characters (CDATA too) of <text>, <tspan>,
   <title> and <desc>, and aria-label. Never in an id, a path, any other attribute, an address, a style sheet
   or a script, never as part of a longer number, and never in a character written as its number
   ("&#x2025;" is a two-dot leader, not a year). A nested base64 layer is opened, changed the same way and
   closed again (as one unbroken run of base64, if it was wrapped over lines). Every other byte of the file is
   left exactly as it was. */
function svgReplaceYear(text, fromYear, toYear) {
  var input = String(text == null ? '' : text);
  /* fromYear as the lock-up writes it ("2026", "'26", "’26", "FY26", "2026-27"); toYear four digits: the
     new year is written the same way ("'27") */
  var pat = /^\d{4}$/.test(String(toYear)) ? yearPattern(fromYear, String(toYear)) : null;
  if (!pat || input.length > MAX_SVG_CHARS) return { svg: input, changed: 0 };

  function swap(chars) {
    var n = 0;
    var out = chars.replace(pat.re, function () {
      var args = Array.prototype.slice.call(arguments), m = args[0], whole = args[args.length - 1], at = args[args.length - 2];
      var groups = args.slice(1, args.length - 2);
      at += String(groups[0] || '').length;
      if (pat.numeric && /&#x?[0-9a-f]*$/i.test(whole.slice(Math.max(0, at - 10), at))) return m;
      n++;
      return pat.rewrite(groups);
    });
    return { text: out, n: n };
  }
  function layer(src, depth) {
    var out = [], changed = 0;
    function nestedLayers(piece) {
      if (depth >= MAX_SVG_DEPTH || piece.indexOf('base64,') === -1) return piece;
      return piece.replace(new RegExp(NESTED_SVG.source, 'g'), function (full, head, data, at, whole) {
        var run = layerRun(data, whole.charAt(at + full.length));
        var inner = nestedSvg(run.data);
        if (!inner || inner.length > MAX_SVG_CHARS) return full;
        var done = layer(inner, depth + 1);
        if (!done.changed) return full;
        changed += done.changed;
        return head + Buffer.from(done.svg, 'utf8').toString('base64') + run.rest;
      });
    }
    svgPieces(src).forEach(function (p) {
      var piece = p.s, s;
      if (p.kind === 'chars') {
        if (p.inWords) { s = swap(piece); changed += s.n; piece = s.text; }
      } else if (p.kind === 'cdata') {
        if (p.inWords) { s = swap(piece.slice(9, -3)); changed += s.n; if (s.n) piece = '<![CDATA[' + s.text + ']]>'; }
      } else if (p.kind === 'tag' && !p.tag.close) {
        var label = piece.indexOf('aria-label') === -1 ? null : attrIn(tagAttrs(piece), 'aria-label');
        if (label) {
          s = swap(label.value);
          changed += s.n;
          if (s.n) piece = piece.slice(0, label.from) + s.text + piece.slice(label.to);
        }
        piece = nestedLayers(piece);
      } else if (holdsLayers(p)) {
        piece = nestedLayers(piece);
      }
      out.push(piece);
    });
    return { svg: out.join(''), changed: changed };
  }

  var done;
  try { done = layer(input, 0); } catch (e) { return { svg: input, changed: 0 }; }
  return done.changed ? done : { svg: input, changed: 0 };
}

/* ---------- a font's measurements ---------- */

/* Read from the font file itself, so a line of the unit is laid out from the widths it will really have.
   Tables: head (unitsPerEm), hhea (ascender, descender, how many widths), maxp (how many glyphs),
   hmtx (the widths), cmap formats 4 and 12 (which glyph a character is), OS/2 (cap height). */
function fontMetrics(ttf) {
  try {
    if (!Buffer.isBuffer(ttf)) {
      if (ttf instanceof Uint8Array) ttf = Buffer.from(ttf);
      else return null;
    }
    if (ttf.length < 12) return null;
    var kind = ttf.readUInt32BE(0);
    /* 0x00010000 and 'true': TrueType outlines. 'OTTO' has the same tables around CFF outlines.
       'wOFF' / 'wOF2' are compressed and cannot be read here. */
    if (kind !== 0x00010000 && kind !== 0x74727565 && kind !== 0x4F54544F) return null;
    var count = ttf.readUInt16BE(4), tables = {}, i;
    for (i = 0; i < count; i++) {
      var rec = 12 + 16 * i;
      var off = ttf.readUInt32BE(rec + 8), len = ttf.readUInt32BE(rec + 12);
      if (off + len > ttf.length) return null;
      tables[ttf.toString('latin1', rec, rec + 4)] = { off: off, len: len };
    }
    var head = tables.head, hhea = tables.hhea, hmtx = tables.hmtx, maxp = tables.maxp, cmap = tables.cmap, os2 = tables['OS/2'];
    if (!head || !hhea || !hmtx || !maxp || !cmap || head.len < 54 || hhea.len < 36 || maxp.len < 6) return null;

    var unitsPerEm = ttf.readUInt16BE(head.off + 18);
    if (!unitsPerEm) return null;
    var ascender = ttf.readInt16BE(hhea.off + 4), descender = ttf.readInt16BE(hhea.off + 6);
    var widths = ttf.readUInt16BE(hhea.off + 34), glyphs = ttf.readUInt16BE(maxp.off + 4);
    if (!widths || widths * 4 > hmtx.len) return null;

    var capHeight = 0;
    if (os2 && os2.len >= 90 && ttf.readUInt16BE(os2.off) >= 2) capHeight = ttf.readInt16BE(os2.off + 88);
    if (!(capHeight > 0)) capHeight = Math.round(0.7 * unitsPerEm);

    /* the character map: the widest one the font has (format 12 reaches beyond U+FFFF), else format 4 */
    var segments = null, groups = null, n = ttf.readUInt16BE(cmap.off + 2);
    for (i = 0; i < n; i++) {
      var sub = cmap.off + ttf.readUInt32BE(cmap.off + 4 + 8 * i + 4);
      if (sub + 16 > ttf.length) continue;
      var format = ttf.readUInt16BE(sub);
      if (format === 12 && !groups) {
        var g = ttf.readUInt32BE(sub + 12);
        if (sub + 16 + 12 * g <= ttf.length) groups = { at: sub + 16, n: g };
      } else if (format === 4 && !segments) {
        var segX2 = ttf.readUInt16BE(sub + 6);
        if (sub + 16 + 4 * segX2 <= ttf.length) segments = { n: segX2 / 2, end: sub + 14, start: sub + 16 + segX2, delta: sub + 16 + 2 * segX2, range: sub + 16 + 3 * segX2 };
      }
    }
    if (!segments && !groups) return null;

    var glyphOf = function (cp) {
      var k;
      if (groups) {
        for (k = 0; k < groups.n; k++) {
          var at = groups.at + 12 * k, first = ttf.readUInt32BE(at);
          if (cp < first) break;
          if (cp <= ttf.readUInt32BE(at + 4)) return ttf.readUInt32BE(at + 8) + (cp - first);
        }
        if (!segments) return 0;
      }
      if (cp > 0xFFFF) return 0;
      for (k = 0; k < segments.n; k++) {
        if (ttf.readUInt16BE(segments.end + 2 * k) < cp) continue;
        var start = ttf.readUInt16BE(segments.start + 2 * k);
        if (start > cp) return 0;
        var delta = ttf.readUInt16BE(segments.delta + 2 * k), rangeAt = segments.range + 2 * k, range = ttf.readUInt16BE(rangeAt);
        if (!range) return (cp + delta) & 0xFFFF;
        var where = rangeAt + range + 2 * (cp - start);
        if (where + 2 > ttf.length) return 0;
        var glyph = ttf.readUInt16BE(where);
        return glyph ? (glyph + delta) & 0xFFFF : 0;
      }
      return 0;
    };
    var advanceOfGlyph = function (glyph) {
      if (glyph >= glyphs) glyph = 0;
      return ttf.readUInt16BE(hmtx.off + 4 * Math.min(glyph, widths - 1));
    };
    advanceOfGlyph(0); glyphOf(65);                                  // a table cut short fails here, not later

    return {
      unitsPerEm: unitsPerEm, ascender: ascender, descender: descender, capHeight: capHeight,
      /* in font units; a character the font does not have gets the width of its "missing" box */
      advanceOf: function (cp) { try { return advanceOfGlyph(glyphOf(cp >>> 0)); } catch (e) { return 0; } },
      has: function (cp) { try { return glyphOf(cp >>> 0) !== 0; } catch (e) { return false; } }
    };
  } catch (e) {
    return null;
  }
}

/* letter-spacing counts once per character, the last one too: that is how a browser sets it */
function textWidth(metrics, text, fontSize, letterSpacing) {
  if (!metrics || !metrics.unitsPerEm) return 0;
  var chars = Array.from(String(text == null ? '' : text)), units = 0;
  chars.forEach(function (ch) { units += metrics.advanceOf(ch.codePointAt(0)); });
  return units * (+fontSize || 0) / metrics.unitsPerEm + chars.length * (+letterSpacing || 0);
}

/* The text without half an emoji: a name cut off in the middle of one ends in a lone surrogate, which is no
   character — it cannot be put in an address (encodeURIComponent throws on it) or in a file. */
function wellFormed(text) {
  return Array.from(String(text == null ? '' : text)).filter(function (ch) { return ch.length > 1 || !/[\ud800-\udfff]/.test(ch); }).join('');
}

/* Google Fonts answers a request that names no modern browser with ONE TrueType file holding just the
   characters asked for (a few KB) — which is what can be measured here and embedded in the SVG. The unit is
   set in capitals, so the capital of every character is asked for too, and the digits, so that a later
   edition's year can be set in the same file. */
function googleFontCssUrl(family, weight, text) {
  var given = wellFormed(text);
  var seen = Object.create(null), chars = [];
  Array.from(given + given.toUpperCase() + '0123456789 ').forEach(function (ch) {
    if (seen[ch] || /[\u0000-\u001f\u007f]/.test(ch)) return;
    seen[ch] = true;
    chars.push(ch);
  });
  chars.sort(function (a, b) { return a.codePointAt(0) - b.codePointAt(0); });
  var w = Math.round(+weight);
  if (!(w >= 100 && w <= 900)) w = 700;
  return 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(wellFormed(family).replace(/\s+/g, ' ').trim()).replace(/%20/g, '+') +
    ':wght@' + w + '&text=' + encodeURIComponent(chars.join(''));
}

/* The address of the font file in that answer: the first one offered as TrueType or OpenType — and only
   where Google keeps its font files, https://fonts.gstatic.com/…; any other address a style sheet names is
   not a font this file asked for, and is not handed on to be fetched. */
function fontUrlFromCss(css) {
  var re = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s"'(]+))\s*\)\s*format\(\s*["']?(truetype|opentype)["']?\s*\)/gi;
  var text = String(css == null ? '' : css).slice(0, MAX_CSS_CHARS), m;
  while ((m = re.exec(text))) {
    var u;
    try { u = new URL(m[1] || m[2] || m[3] || ''); } catch (e) { continue; }
    if (u.protocol === 'https:' && u.hostname === 'fonts.gstatic.com' && !u.username && !u.password && !u.port) return u.href;
  }
  return '';
}

/* ---------- drawing a new logo unit ---------- */

var INK_ON_DARK = '#ffffff';
var INK_ON_LIGHT = '#16181d';
var DEFAULT_THEME = '#e81d3d';
var EST_CHAR_EM = 0.64;             // a capital's width when no font can be measured; textLength then enforces it
var SERIF_FAMILY = /serif|playfair|merriweather|georgia|times|garamond|baskerville|bodoni|didot|lora|libre caslon|crimson|cormorant|spectral|fraunces|bitter|slab|abril|cinzel|prata|marcellus|vollkorn|cardo|alegreya|tinos|domine/i;

function xml(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* An event's name is words, but the upload route reads an SVG as text: "… online = …" or "JavaScript: the
   summit" would look like code to it. A zero-width space before the sign keeps the name as it reads and
   makes it plainly not an attribute or an address. */
function plainWords(s) {
  return String(s == null ? '' : s).replace(/(on[a-z]{2,}\s*)=/gi, '$1\u200b=').replace(/((?:javascript|data)\s*):/gi, '$1\u200b:');
}
/* base64 that the same route cannot mistake for an attribute: only padding could make it end in "…/onab=",
   and a data: URI is read the same without its padding */
function base64(buf) {
  var s = buf.toString('base64');
  return SVG_ACTIVE.test(s) ? s.replace(/=+$/, '') : s;
}
function num(v) { return String(Math.round(v * 100) / 100); }

function buildLogoUnitSvg(o) {
  o = o || {};
  var parts = o.parts || {};
  function clean(v) { return wellFormed(v).replace(/\s+/g, ' ').trim(); }
  var before = clean(parts.before), keyword = clean(parts.keyword), after = clean(parts.after);
  if (!keyword) { keyword = [before, after].filter(Boolean).join(' '); before = ''; after = ''; }
  if (!keyword) return { svg: '', width: 0, height: 0 };
  /* plainWords goes last, on the words as they will stand in the file: "javaſcript:" only becomes
     "JAVASCRIPT:" once it is in capitals, and "online" + "= 1" only meet in the title */
  var name = plainWords([before, keyword, after].filter(Boolean).join(' '));
  before = plainWords(before.toUpperCase()); keyword = plainWords(keyword.toUpperCase()); after = plainWords(after.toUpperCase());

  var style = /^(stacked|inline|boxed|underline)$/.test(String(o.style)) ? String(o.style) : 'stacked';
  var dark = o.tone === 'dark';
  var theme = /^#[0-9a-f]{6}$/i.test(String(o.themeColor || '')) ? String(o.themeColor).toLowerCase() : DEFAULT_THEME;
  var themeLum = genDesign.luminance(theme);
  var ink = dark ? INK_ON_DARK : INK_ON_LIGHT;
  /* the keyword carries the theme colour unless it could not be read on this hero */
  var keyInk = dark ? (themeLum < 0.18 ? INK_ON_DARK : theme) : (themeLum > 0.7 ? INK_ON_LIGHT : theme);
  if (style === 'boxed') keyInk = genDesign.contrast(INK_ON_DARK, theme) >= genDesign.contrast(INK_ON_LIGHT, theme) ? INK_ON_DARK : INK_ON_LIGHT;

  /* ---- the font: embedded and measured, or a system face with its widths enforced ---- */
  var font = o.font || null, metrics = null, ttf = '';
  if (font && font.ttfBase64) {
    ttf = String(font.ttfBase64).replace(/\s+/g, '');
    metrics = (font.metrics && typeof font.metrics.advanceOf === 'function' && font.metrics.unitsPerEm) ? font.metrics : fontMetrics(Buffer.from(ttf, 'base64'));
    if (!metrics) ttf = '';
  }
  var family = String((font && font.family) || o.fontFamily || '');
  var serif = SERIF_FAMILY.test(family) && !/sans/i.test(family);
  var fallback = serif ? 'Georgia, \'Times New Roman\', serif' : 'Arial, Helvetica, sans-serif';
  var cap = metrics ? metrics.capHeight / metrics.unitsPerEm : 0.7;

  function measure(text, size, spacing) {
    var chars = Array.from(text);
    if (metrics) {
      return { width: textWidth(metrics, text, size, spacing), sure: chars.every(function (ch) { return metrics.has(ch.codePointAt(0)); }) };
    }
    return { width: chars.length * (EST_CHAR_EM * size + spacing), sure: false };
  }

  var inline = style === 'inline';
  var keySize = inline ? 64 : 96, smallSize = inline ? 28 : 26, smallSpacing = Math.round(smallSize * 0.22 * 100) / 100;
  var pad = 28;
  var lineBefore = before ? measure(before, smallSize, smallSpacing) : null;
  var lineKey = measure(keyword, keySize, 0);
  var lineAfter = after ? measure(after, smallSize, smallSpacing) : null;
  var boxPadX = keySize * 0.28, boxPadY = keySize * 0.22;
  var gapInline = keySize * 0.32;

  var content;
  if (inline) content = (lineBefore ? lineBefore.width + gapInline : 0) + lineKey.width + (lineAfter ? gapInline + lineAfter.width : 0);
  else content = Math.max(lineBefore ? lineBefore.width : 0, lineKey.width + (style === 'boxed' ? 2 * boxPadX : 0), lineAfter ? lineAfter.width : 0);

  /* ---- The Economic Times Business Verticals logo: the supplied file itself, at its own proportions ---- */
  var logo = null, etText = String(o.etLogoSvg == null ? '' : o.etLogoSvg);
  if (etText) {
    var bytes = Buffer.from(etText, 'utf8'), info = imageInfo(bytes);
    if (info.type === 'svg' && info.width > 0 && info.height > 0) {
      var logoWidth = Math.max(300, Math.min(520, content * 0.45));
      logo = { data: base64(bytes), width: logoWidth, height: logoWidth * info.height / info.width };
    }
  }

  var width = Math.ceil(Math.max(content, logo ? logo.width : 0) + 2 * pad);
  var mid = width / 2, y = pad, body = [];

  function textEl(text, line, x, baseline, size, spacing, fill, weight) {
    return '<text x="' + num(x + spacing / 2) + '" y="' + num(baseline) + '" font-size="' + num(size) + '"' +
      (spacing ? ' letter-spacing="' + num(spacing) + '"' : '') +
      (weight ? ' font-weight="' + weight + '"' : '') +
      ' fill="' + fill + '" text-anchor="middle"' +
      /* a width that was estimated, or that a missing character makes uncertain, is made true */
      (line.sure ? '' : ' textLength="' + num(line.width) + '" lengthAdjust="spacingAndGlyphs"') +
      '>' + xml(text) + '</text>';
  }
  /* an embedded font is one face: asking it for "bold" would make the browser fatten it and widen the line */
  var keyWeight = metrics ? '' : '700', smallWeight = metrics ? '' : '400';

  if (logo) {
    body.push('<image x="' + num(mid - logo.width / 2) + '" y="' + num(y) + '" width="' + num(logo.width) + '" height="' + num(logo.height) + '" preserveAspectRatio="xMidYMid meet" href="data:image/svg+xml;base64,' + logo.data + '"/>');
    y += logo.height + 30;
  }

  if (inline) {
    var baseline = y + cap * keySize, x = mid - content / 2;
    if (lineBefore) { body.push(textEl(before, lineBefore, x + lineBefore.width / 2, baseline, smallSize, smallSpacing, ink, smallWeight)); x += lineBefore.width + gapInline; }
    body.push(textEl(keyword, lineKey, x + lineKey.width / 2, baseline, keySize, 0, keyInk, keyWeight));
    x += lineKey.width + gapInline;
    if (lineAfter) body.push(textEl(after, lineAfter, x + lineAfter.width / 2, baseline, smallSize, smallSpacing, ink, smallWeight));
    y = baseline;
  } else {
    if (lineBefore) {
      body.push(textEl(before, lineBefore, mid, y + cap * smallSize, smallSize, smallSpacing, ink, smallWeight));
      y += cap * smallSize + 22;
    }
    if (style === 'boxed') {
      var boxHeight = cap * keySize + 2 * boxPadY, boxWidth = lineKey.width + 2 * boxPadX;
      body.push('<rect x="' + num(mid - boxWidth / 2) + '" y="' + num(y) + '" width="' + num(boxWidth) + '" height="' + num(boxHeight) + '" rx="4" fill="' + theme + '"/>');
      body.push(textEl(keyword, lineKey, mid, y + boxPadY + cap * keySize, keySize, 0, keyInk, keyWeight));
      y += boxHeight;
    } else {
      body.push(textEl(keyword, lineKey, mid, y + cap * keySize, keySize, 0, keyInk, keyWeight));
      y += cap * keySize;
      if (style === 'underline') {
        var rule = Math.max(4, keySize * 0.06);
        y += keySize * 0.17;
        body.push('<rect x="' + num(mid - lineKey.width / 2) + '" y="' + num(y) + '" width="' + num(lineKey.width) + '" height="' + num(rule) + '" fill="' + theme + '"/>');
        y += rule;
      }
    }
    if (lineAfter) {
      y += 24;
      body.push(textEl(after, lineAfter, mid, y + cap * smallSize, smallSize, smallSpacing, ink, smallWeight));
      y += cap * smallSize;
    }
  }
  var height = Math.ceil(y + pad);

  var css = (ttf ? '@font-face{font-family:\'rvlu\';src:url(data:font/ttf;base64,' + base64(Buffer.from(ttf, 'base64')) + ') format(\'truetype\')}' : '') +
    'text{font-kerning:none;font-variant-ligatures:none;font-synthesis:none}';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img"' +
    ' font-family="' + (ttf ? '\'rvlu\', ' : '') + fallback + '">' +
    '<title>' + xml(name) + '</title>' +
    '<style>' + css + '</style>' +
    body.join('') +
    '</svg>';
  return { svg: svg, width: width, height: height };
}

module.exports = {
  findLogoCandidates, editionHints, editionYears, eventYear, bumpYear,
  shownYear, yearAs, yearsShownIn,
  imageInfo, plausibleUnit,
  svgIsActive, svgLayers, svgTexts, svgTone, svgReplaceYear,
  fontMetrics, textWidth, googleFontCssUrl, fontUrlFromCss,
  buildLogoUnitSvg
};
