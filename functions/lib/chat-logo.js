/* ETB2B AI's logo tool in the site editor's chat (owner, 19 Nov 2026, on TechGig Pro). Asked to "create a logo unit
   by adding a Pro word in this logo" with a link to the TechGig logo, the chat said it could not open links, then
   reworked the banner: it put the TechGig website's own file on the page and typed "Pro" beside it as text. On a
   test copy, the same message reworked ETB2B's top bar instead of the banner. What the owner agreed to:
     - "logo" means the event's logo in the banner (the logo unit), never ETB2B's logo in the top bar;
     - a linked or attached picture is downloaded and a copy kept with the event, never shown from someone
       else's website;
     - words asked for go INTO the logo: one transparent picture, never text typed beside it;
     - the chat is told what the logo shows by being shown the picture, never by its alt text.
   The logo unit rules hold (feedback: a transparent picture, never boxed or redrawn): the picture given is used
   as it is, only the words asked for are added beside or under it.

   Exports (lib/api-chat.js wires them into POST /api/chat-edit):
     wire(tools)                 tools from lib/api.js: { rasterise, storePublicPicture, fetchUnitFont, svgCouldRun }
     aboutLogo(text)             -> true when the words are about a logo
     linksIn(text)               -> the https addresses written in the text, as written
     offered(payload)            -> true when the tool is offered: an editor that can place it, an event, a logo unit
     schemaProp()                -> the schema of the answer's `logoUnit`
     promptLines()               -> the prompt's lines about the logo
     cleanAsk(raw, ctx)          -> null (not used) | { ask } | { reply } (ctx: { instruction, earlier, attachments,
                                    ownAttached, ownPrefix, current })
     make(ask, ctx)              -> Promise<{ logo } | { reply }>, never rejects (ctx: { fb, eventId, design, tone, eventName })
     readCurrent(src, ctx)       -> Promise<{ mimeType, data } | null>: the logo unit as the chat model is shown it,
                                    on plain grey, never rejects (ctx: { ownPrefix })
   The made picture is stored under events/<id>/media/, as a picture put in with Replace image is: never under
   generated/<stamp>-logo-unit, which the editor takes for a unit made automatically and may replace on opening. */
'use strict';
var logoUnit = require('./logo-unit');
var genDesign = require('./gen-design');
var pngLite = require('./png-lite');
var safeFetchMod = require('./safe-fetch');

var T = null;
function wire(tools) { T = tools || null; }

var MAX_BYTES = 3 * 1024 * 1024;
var TYPES = ['png', 'jpeg', 'webp', 'gif', 'svg'];
var PLACES = ['right', 'below'];
var STYLES = ['plain', 'badge'];
var WORDS_MAX = 24;

var LOGO_RE = /\b(logos?|logo[\s-]?units?|lock-?ups?|word-?marks?|brand[\s-]?marks?|emblem)\b/i;
function aboutLogo(text) { return LOGO_RE.test(String(text || '')); }

function linksIn(text) {
  return (String(text || '').match(/https:\/\/[^\s<>"'`\])]+/gi) || []).map(function (u) { return u.replace(/[.,;:!?]+$/, ''); });
}

function offered(payload) {
  if (!payload || payload.canPlaceLogo !== true || !payload.eventId) return false;
  return (Array.isArray(payload.sections) ? payload.sections : []).some(function (s) { return s && s.logoUnit && s.logoUnit.present === true; });
}

function schemaProp() {
  return {
    type: 'OBJECT',
    description: 'a new picture for the event\'s logo in the banner (the logo unit); all empty (0, "", "", "", "") when the logo is not being changed',
    properties: {
      picture: { type: 'INTEGER', description: 'the number of an attached picture to use as the logo; 0 for none' },
      link: { type: 'STRING', description: 'a picture address copied exactly from the owner\'s message, to use as the logo; "" for none' },
      words: { type: 'STRING', description: 'words to add to the logo as part of the same picture, exactly as the owner gave them (e.g. "Pro"); "" for none' },
      place: { type: 'STRING', enum: ['right', 'below', ''], description: 'where the words go: "right" of the logo or "below" it; "" when no words are added' },
      style: { type: 'STRING', enum: ['plain', 'badge', ''], description: '"badge" puts the words on a small coloured tag, "plain" writes them in the site\'s colour; "" when no words are added' }
    },
    required: ['picture', 'link', 'words', 'place', 'style']
  };
}

function promptLines() {
  return [
    'THE LOGO. "The logo", "the logo unit" or "our logo" means the event\'s own logo in the banner (the logo unit) — never ETB2B\'s logo in the top bar, which is the same on every ETB2B event site and is never changed.',
    'The logo unit is one picture. To change it use `logoUnit`, never a rework (`sectionEdits`) of the banner — a rework keeps the logo unit exactly as it is:',
    '   `picture`: the number of an attached picture to use as the logo (0 for none); `link`: a picture address copied EXACTLY from the owner\'s message ("" for none) — it is downloaded and a copy is kept with the event, so you CAN use a link the owner gives; `words`: words to add to the logo as part of the same picture, exactly as the owner gave them (e.g. "Pro"; "" for none); `place`: "right" (the usual) or "below"; `style`: "badge" when the owner asks for a tag, pill or badge, else "plain".',
    '   With no picture and no link, the words are added to the logo the banner shows now. Use `logoUnit` only when the owner asks to change the logo. You cannot redraw, recolour or crop the lettering of a logo, or design a new logo from nothing: say so, and offer to use a picture of the logo the owner attaches or links.'
  ].join('\n');
}

function cleanWords(v) {
  var s = String(v || '').replace(/[\u0000-\u001f<>{}\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, WORDS_MAX).trim();
}
function sameLink(a, b) { return String(a || '').replace(/\/+$/, '') === String(b || '').replace(/\/+$/, ''); }

var SAY = {
  notInMessage: 'I can only use a picture address you wrote yourself. Paste the logo\'s address in your message, or attach the logo.',
  noPicture: 'The banner\'s logo is set in type, so there is no picture to add the words to. Attach the logo, or paste its address, and say what to add.',
  notAttached: 'That attached picture could not be used. Attach the logo again.',
  fetch: 'The logo at that address could not be downloaded. Check that the address opens the picture itself, or attach the logo instead.',
  notPicture: 'That address is not a picture this site can show (PNG, JPEG, WEBP or SVG). Attach the logo instead.',
  tooBig: 'That picture is over 3 MB, too large for a logo. Attach a smaller copy.',
  active: 'That SVG contains scripts or embedded content, so it cannot be used. Attach a PNG of the logo instead.',
  font: 'The words could not be drawn into the logo just now. Try again in a moment.',
  draw: 'The new logo could not be drawn from that picture. Attach a PNG of the logo instead.',
  store: 'The new logo could not be stored. Try again in a moment.'
};

/* -> null when the answer does not use the tool, else { ask: { source, from, words, place, style } } or { reply } */
function cleanAsk(raw, ctx) {
  if (!raw || typeof raw !== 'object') return null;
  ctx = ctx || {};
  var n = parseInt(raw.picture, 10) || 0;
  var link = String(raw.link || '').trim();
  var words = cleanWords(raw.words);
  if (!n && !link && !words) return null;
  var place = PLACES.indexOf(raw.place) !== -1 ? raw.place : 'right';
  var style = STYLES.indexOf(raw.style) !== -1 ? raw.style : 'plain';
  var source = '', from = '';
  if (n) {
    var own = Math.max(0, Math.min(6, parseInt(ctx.ownAttached, 10) || 0));
    var url = n >= 1 && n <= own && Array.isArray(ctx.attachments) ? String(ctx.attachments[n - 1] || '') : '';
    if (!url || !ctx.ownPrefix || url.indexOf(ctx.ownPrefix) !== 0) return { reply: SAY.notAttached };
    source = url; from = 'attached';
  } else if (link) {
    var said = linksIn([ctx.instruction].concat(ctx.earlier || []).join('\n'));
    var match = said.filter(function (u) { return sameLink(u, link); })[0];
    if (!match) return { reply: SAY.notInMessage };
    source = match; from = 'link';
  } else {
    var cur = String(ctx.current || '');
    if (!/^https:\/\//i.test(cur)) return { reply: SAY.noPicture };
    source = cur; from = 'current';
  }
  return { ask: { source: source, from: from, words: words, place: words ? place : '', style: words ? style : '' } };
}

/* A picture inside an SVG labelled with a type browsers forgive and the drawing (resvg) does not: "data:img/png" for
   "data:image/png" (TechGig's own logo file is a PNG wrapped so, 19 Nov 2026: drawn, it came out blank). */
function plainSvg(text) {
  return String(text).replace(/(href\s*=\s*["']\s*)data:img\/(png|jpe?g|gif|webp)/gi, function (m, at, t) {
    t = t.toLowerCase();
    return at + 'data:image/' + (t === 'jpg' ? 'jpeg' : t);
  });
}
function fetchPicture(url) {
  return safeFetchMod.safeFetch(url, { timeoutMs: 8000, maxBytes: MAX_BYTES }).then(function (r) {
    return r.status === 200 && r.body && r.body.length ? { bytes: r.body } : { why: 'fetch' };
  }, function (err) { return { why: err && err.code === 'too-large' ? 'tooBig' : 'fetch' }; });
}
function pictureOf(bytes) {
  var info = logoUnit.imageInfo(bytes);
  if (!info || TYPES.indexOf(info.type) === -1 || !(info.width > 0) || !(info.height > 0)) return { why: 'notPicture' };
  if (info.type === 'svg' && T && T.svgCouldRun(bytes.toString('utf8'))) return { why: 'active' };
  if (info.type === 'svg') return { info: info, bytes: Buffer.from(plainSvg(bytes.toString('utf8')), 'utf8') };
  return { info: info, bytes: bytes };
}

function hexOk(v) { return /^#[0-9a-f]{6}$/i.test(String(v || '')); }
/* the words' ink: on a dark banner white; on a light one the site's colour where it reads on white, else near-black */
function inkFor(tone, theme) {
  if (tone === 'dark') return '#ffffff';
  return hexOk(theme) && genDesign.contrast(theme, '#ffffff') >= 3 ? theme.toLowerCase() : '#1a1a1a';
}
function xmlText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* the picture with the words beside or under it, as one SVG drawn by resvg: { svg, width, height } */
var MARK_H = 240;
function lockup(pic, words, o) {
  var ratio = pic.info.width / pic.info.height;
  var markW = MARK_H * ratio, markH = MARK_H;
  var uri = 'data:' + pic.info.mime + ';base64,' + pic.bytes.toString('base64');
  var badge = o.style === 'badge';
  var below = o.place === 'below';
  var cap = o.metrics ? o.metrics.capHeight / o.metrics.unitsPerEm : 0.7;
  /* the words' capitals: about half the logo's height beside it, a third under it */
  var size = Math.round((below ? MARK_H * 0.30 : MARK_H * 0.42) / cap);
  var textW = logoUnit.textWidth(o.metrics, words, size, 0);
  var padX = badge ? size * 0.42 : 0, padY = badge ? size * 0.26 : 0;
  var boxW = textW + 2 * padX, boxH = size * cap + 2 * padY;
  var gap = MARK_H * (below ? 0.10 : 0.14);
  var W, H, bx, by;
  if (below) { W = Math.max(markW, boxW); H = markH + gap + boxH; bx = (W - boxW) / 2; by = markH + gap; }
  else { W = markW + gap + boxW; H = markH; bx = markW + gap; by = (markH - boxH) / 2; }
  var mx = below ? (W - markW) / 2 : 0;
  var ink = o.ink, fill = '';
  if (badge) {
    fill = hexOk(o.theme) ? o.theme.toLowerCase() : '#ed1a3b';
    ink = genDesign.contrast('#ffffff', fill) >= genDesign.contrast('#1a1a1a', fill) ? '#ffffff' : '#1a1a1a';
  }
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + r2(W) + '" height="' + r2(H) + '" viewBox="0 0 ' + r2(W) + ' ' + r2(H) + '">' +
    '<image x="' + r2(mx) + '" y="0" width="' + r2(markW) + '" height="' + r2(markH) + '" preserveAspectRatio="xMidYMid meet" href="' + uri + '" xlink:href="' + uri + '"/>' +
    (badge ? '<rect x="' + r2(bx) + '" y="' + r2(by) + '" width="' + r2(boxW) + '" height="' + r2(boxH) + '" rx="' + r2(boxH * 0.28) + '" fill="' + fill + '"/>' : '') +
    '<text x="' + r2(bx + padX) + '" y="' + r2(by + padY + size * cap) + '" font-family="\'rvyear\', sans-serif" font-weight="700" font-size="' + size + '" fill="' + ink + '">' + xmlText(words) + '</text>' +
    '</svg>';
  return { svg: svg, width: W, height: H };
}

function stampNow() { return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); }

/* -> Promise<{ logo: { url, width, height, from, words, note } } | { reply }>, never rejects */
function make(ask, ctx) {
  ctx = ctx || {};
  function no(why) { return { reply: SAY[why] || SAY.draw }; }
  if (!T || !ctx.fb || !ctx.eventId) return Promise.resolve(no('store'));
  return fetchPicture(ask.source).then(function (got) {
    if (got.why) return no(got.why);
    var pic = pictureOf(got.bytes);
    if (pic.why) return no(pic.why);
    var solid = pic.info.type === 'jpeg';
    var note = solid ? 'This picture has a solid background, so it shows as a box on the banner. A PNG or SVG of the logo with a see-through background looks right.' : '';
    var stamp = stampNow(), base = 'events/' + ctx.eventId + '/media/chat-logo-' + stamp;
    /* no words: the picture as it is, a copy kept with the event */
    if (!ask.words) {
      var ext = pic.info.type === 'jpeg' ? 'jpg' : pic.info.type;
      return T.storePublicPicture(ctx.fb, base + '.' + ext, pic.bytes, pic.info.mime).then(function (url) {
        return { logo: { url: url, width: pic.info.width, height: pic.info.height, from: ask.from, words: '', note: note } };
      }, function () { return no('store'); });
    }
    var family = String((ctx.design && ctx.design.headingFont) || '').trim();
    var font = family ? T.fetchUnitFont(family, 700, ask.words) : Promise.resolve(null);
    /* an SVG logo is drawn on its own first, as a see-through PNG: inside the lock-up's own SVG, a picture that it wraps
       is not drawn (TechGig's logo file came out blank) */
    var flat = pic.info.type !== 'svg' ? Promise.resolve(pic) : T.rasterise(pic.bytes.toString('utf8'), { clear: true, width: 1000 }).then(function (img) {
      return img && img.png ? { info: { type: 'png', mime: 'image/png', width: img.width, height: img.height }, bytes: img.png } : null;
    });
    return Promise.all([font.then(function (f) { return f || T.fetchUnitFont('Inter', 700, ask.words); }), flat]).then(function (got2) {
      var f = got2[0];
      if (!got2[1]) return no('draw');
      pic = got2[1];
      if (!f || !f.ttfBase64 || !f.metrics) return no('font');
      var theme = ctx.design && ctx.design.themeColor;
      var made = lockup(pic, ask.words, { place: ask.place, style: ask.style, metrics: f.metrics, theme: theme, ink: inkFor(ctx.tone, theme) });
      return T.rasterise(made.svg, { clear: true, width: 1000, font: { family: f.family, ttfBase64: f.ttfBase64 } }).then(function (img) {
        if (!img || !img.png) return no('draw');
        return T.storePublicPicture(ctx.fb, base + '.png', img.png, 'image/png').then(function (url) {
          return { logo: { url: url, width: img.width, height: img.height, from: ask.from, words: ask.words, note: note } };
        }, function () { return no('store'); });
      });
    });
  }).then(null, function (err) {
    console.error('chat-logo: the logo could not be made — ' + (err && err.message));
    return no('draw');
  });
}

/* The banner's logo unit as the chat model is shown it: a PNG on plain grey (a model reads transparency as white,
   so white lettering would vanish), at most 1000 wide. Only a picture of this event's own, or one on ETB2B's
   picture servers; null otherwise, or when it cannot be read. */
var READ_HOSTS = /^https:\/\/(st|img)\.etb2bimg\.com\//i;
function readCurrent(src, ctx) {
  src = String(src || '');
  var own = ctx && ctx.ownPrefix;
  if (!/^https:\/\//i.test(src) || !((own && src.indexOf(own) === 0) || READ_HOSTS.test(src))) return Promise.resolve(null);
  return fetchPicture(src).then(function (got) {
    if (got.why) return null;
    var pic = pictureOf(got.bytes);
    if (pic.why) return null;
    if (pic.info.type === 'svg') {
      if (!T || !T.rasterise) return null;
      return T.rasterise(pic.bytes.toString('utf8'), { width: 800 }).then(function (img) { return img && img.png ? { mimeType: 'image/png', data: img.png.toString('base64') } : null; });
    }
    if (pic.info.type === 'png') {
      var decoded = null;
      try { decoded = pngLite.decode(got.bytes); } catch (e) { decoded = null; }
      if (decoded && pngLite.hasTransparency && pngLite.hasTransparency(decoded)) return { mimeType: 'image/png', data: pngLite.encode(pngLite.flatten(decoded, [128, 128, 128])).toString('base64') };
    }
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].indexOf(pic.info.mime) === -1) return null;
    return { mimeType: pic.info.mime, data: got.bytes.toString('base64') };
  }).then(null, function () { return null; });
}

module.exports = {
  wire: wire, aboutLogo: aboutLogo, linksIn: linksIn, offered: offered, schemaProp: schemaProp, promptLines: promptLines,
  cleanAsk: cleanAsk, make: make, readCurrent: readCurrent, SAY: SAY,
  _lockup: lockup, _inkFor: inkFor, _plainSvg: plainSvg
};
