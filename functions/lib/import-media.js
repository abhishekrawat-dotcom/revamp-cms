/* An imported page's pictures, fonts and films, copied into the import's own folder (BE-052).

   Before this, the import found only addresses ending in a picture's extension (so fonts, a film and its poster,
   and a CDN picture with no extension were never copied, and a relative one then pointed at nothing on this host),
   stored each under its file name alone (two "photo.jpg" in different folders overwrote each other), put the copy
   in with a text replace that also changed the end of any longer address ending the same way, and fetched every
   one at once, whole, with no time or size limit.

   copyMedia(o) -> Promise<{ html, sheets, summary }>
     o.html      the page's body markup (its <style> blocks included)
     o.sheets    [{ href, text }] the stylesheets it links, as fetched
     o.pageUrl   the page's own address: what its relative addresses (and its sheets' hrefs) are read against. A
                 ZIP export has none: ZIP_BASE stands for it, and an address that is not copied is then left as it
                 was written
     o.kit       lib/api.js's HTML reader (TOKEN_KIT: tokenizeHtml, attrOf, setAttr, writeTag)
     o.load(url, kind)   -> Promise<Buffer | { body: Buffer, contentType } | null>: one file. lib/api.js passes
                 safe-fetch.js (public addresses only, redirects checked, a time limit and a size cap per kind)
     o.store(path, buffer, type) -> Promise<url>: keeps one copy, answers the address the page should use
     o.folder    where the copies go: 'events/import-<id>/assets/'
     o.limits    (tests) overrides of LIMITS / MAX_ASSETS / MAX_TOTAL_BYTES / POOL / BUDGET_MS
   What is looked at, in the markup: <img src|srcset>, <source src|srcset> (a film's when inside <video>, a
   picture's otherwise), <video src|poster>, SVG <image href|xlink:href>, and url() in every style attribute and
   <style> block; in each stylesheet, every url() — a font inside @font-face, a picture elsewhere — read against
   THAT sheet's own address. Each distinct address (resolved, without its #fragment) is fetched once; the copy is
   kept only when its first bytes say it is a picture (PNG, JPEG, GIF, WebP, AVIF, ICO, SVG without script), a
   font (WOFF2, WOFF, TTF, OTF) or a film (MP4, WebM) of the kind that place asks for, within that kind's size. Its
   name is the first 16 hex characters of the SHA-256 of its address and the extension its bytes say, so no two
   addresses share a copy and the same address always gets the same one. Only the value that was read is
   replaced — an attribute, one srcset entry, one url() — never text elsewhere.
   Limits: at most MAX_ASSETS files and MAX_TOTAL_BYTES in all, POOL at a time, and nothing new started after
   BUDGET_MS. What is not copied is listed in summary.notCopied with why; a relative address that is not copied
   only for a limit or a fault on the way is written as its full original address, so it still points at the
   original site rather than at nothing on this host (one the original does not have, of the wrong kind, an SVG
   that runs script, or one refused as private or malformed stays as written).
   Fonts on a public font service (fonts.gstatic.com…) are left where they are: those services serve any site.

   Node 20, CommonJS. No network, no Firebase of its own (load and store are given). */
'use strict';
var crypto = require('crypto');

var MB = 1024 * 1024;
var LIMITS = {
  image: { maxBytes: 10 * MB, timeoutMs: 20000 },
  font: { maxBytes: 3 * MB, timeoutMs: 15000 },
  video: { maxBytes: 30 * MB, timeoutMs: 45000 }
};
var MAX_ASSETS = 150;
var MAX_TOTAL_BYTES = 150 * MB;
var POOL = 4;
var BUDGET_MS = 60000;
var ZIP_BASE = 'https://zip.import.invalid/';
/* why a file was not copied, when the original may still serve it (see copyMedia's last step) */
var FETCHABLE_ELSEWHERE = ['too-large', 'timeout', 'too-many', 'too-much', 'out-of-time', 'unreachable', 'store-failed'];
var FONT_SERVICES = /^(?:fonts\.gstatic\.com|fonts\.bunny\.net|use\.typekit\.net|p\.typekit\.net)$/i;
/* what a loader may be told a file is (safe-fetch's accept): checked again by the bytes */
var ACCEPT = {
  image: /^(?:image\/[a-z0-9.+-]+|application\/octet-stream|binary\/octet-stream)$/,
  font: /^(?:font\/[a-z0-9.+-]+|application\/(?:font-woff2?|x-font-[a-z0-9-]+|font-sfnt|vnd\.ms-opentype|octet-stream)|binary\/octet-stream)$/,
  video: /^(?:video\/(?:mp4|webm|x-m4v)|application\/octet-stream|binary\/octet-stream)$/
};

/* ---------- what a file is, by its first bytes ---------- */

function ascii(buf, from, to) { return buf.length >= to ? buf.toString('latin1', from, to) : ''; }
/* -> { kind, ext, type } or null */
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] === 0x89 && ascii(buf, 1, 4) === 'PNG') return { kind: 'image', ext: 'png', type: 'image/png' };
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { kind: 'image', ext: 'jpg', type: 'image/jpeg' };
  if (ascii(buf, 0, 4) === 'GIF8') return { kind: 'image', ext: 'gif', type: 'image/gif' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { kind: 'image', ext: 'webp', type: 'image/webp' };
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return { kind: 'image', ext: 'ico', type: 'image/x-icon' };
  if (ascii(buf, 0, 4) === 'wOF2') return { kind: 'font', ext: 'woff2', type: 'font/woff2' };
  if (ascii(buf, 0, 4) === 'wOFF') return { kind: 'font', ext: 'woff', type: 'font/woff' };
  if (ascii(buf, 0, 4) === 'OTTO') return { kind: 'font', ext: 'otf', type: 'font/otf' };
  if ((buf[0] === 0 && buf[1] === 1 && buf[2] === 0 && buf[3] === 0) || ascii(buf, 0, 4) === 'true') return { kind: 'font', ext: 'ttf', type: 'font/ttf' };
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return { kind: 'video', ext: 'webm', type: 'video/webm' };
  if (ascii(buf, 4, 8) === 'ftyp') {
    var brand = ascii(buf, 8, 12);
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', ext: 'avif', type: 'image/avif' };
    if (/^(?:heic|heix|hevc|mif1|msf1|qt  )$/.test(brand)) return null;      // nothing a browser shows everywhere
    return { kind: 'video', ext: 'mp4', type: 'video/mp4' };
  }
  /* an SVG: text whose first element is <svg> (after a byte-order mark, an XML declaration, comments, a doctype) */
  var head = buf.slice(0, 2048).toString('utf8').replace(/^﻿/, '');
  var rest = head.replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*/i, '');
  if (/^<svg[\s>]/i.test(rest)) return { kind: 'image', ext: 'svg', type: 'image/svg+xml' };
  return null;
}
/* an SVG that can run something when opened on its own is not copied */
function unsafeSvg(buf) {
  var text = buf.toString('utf8');
  return /<script\b|<foreignObject\b|\son[a-z]+\s*=|javascript:|<iframe\b|<embed\b|<object\b/i.test(text);
}

/* ---------- reading and rewriting addresses where they stand ---------- */

function decodeAttr(s) {
  return String(s == null ? '' : s).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|#39);/gi, function (all, e) {
    var low = e.toLowerCase();
    if (low === 'amp') return '&';
    if (low === 'quot') return '"';
    if (low === 'apos' || low === '#39') return "'";
    if (low === 'lt') return '<';
    if (low === 'gt') return '>';
    var n = low.charAt(1) === 'x' ? parseInt(low.slice(2), 16) : parseInt(low.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
  });
}

/* a srcset as the HTML standard reads it: [{ url, desc }] */
function parseSrcset(s) {
  var out = [], i = 0, n = s.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(s.charAt(i))) i++;
    if (i >= n) break;
    var start = i;
    while (i < n && !/\s/.test(s.charAt(i))) i++;
    var url = s.slice(start, i), desc = '';
    if (/,$/.test(url)) url = url.replace(/,+$/, '');
    else {
      var d = i;
      while (i < n && s.charAt(i) !== ',') i++;
      desc = s.slice(d, i).trim();
    }
    if (url) out.push({ url: url, desc: desc });
  }
  return out;
}

/* every url() of a stylesheet, each given to fn(raw, base, kind) -> its replacement or null (left as it is) */
function walkCss(css, base, fn) {
  css = String(css == null ? '' : css);
  var fontRanges = [], re = /@font-face\s*\{[^}]*\}/gi, m;
  while ((m = re.exec(css))) fontRanges.push([m.index, m.index + m[0].length]);
  return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']*))\s*\)/gi, function (all, dq, sq, bare, offset) {
    if (/@import\s*$/i.test(css.slice(Math.max(0, offset - 16), offset))) return all;      // a stylesheet, not a file to copy
    var raw = dq != null ? dq : sq != null ? sq : bare;
    var kind = fontRanges.some(function (r) { return offset >= r[0] && offset < r[1]; }) ? 'font' : 'image';
    var to = fn(raw, base, kind);
    return to == null ? all : 'url("' + to.replace(/["\\\n\r]/g, encodeURIComponent) + '")';
  });
}

/* every address in the markup that names a file, each given to fn (as walkCss) */
function walkHtml(html, base, kit, fn) {
  html = String(html == null ? '' : html);
  var tokens = kit.tokenizeHtml(html), out = [], last = 0, media = [];
  function attr(tag, name, kind, list) {
    var a = kit.attrOf(tag, name);
    if (!a || a.value == null || a.value === '') return false;
    var value = decodeAttr(a.value), next;
    if (list) {
      var parts = parseSrcset(value), any = false;
      parts.forEach(function (p) { var to = fn(p.url, base, kind); if (to != null) { p.url = to; any = true; } });
      if (!any) return false;
      next = parts.map(function (p) { return p.url + (p.desc ? ' ' + p.desc : ''); }).join(', ');
    } else if (kind === 'style') {
      next = walkCss(value, base, fn);
      if (next === value) return false;
    } else {
      next = fn(value, base, kind);
      if (next == null) return false;
    }
    kit.setAttr(tag, name, next);
    return true;
  }
  tokens.forEach(function (t) {
    if (t.t === 'open') {
      var name = t.name, changed = false;
      if ((name === 'video' || name === 'audio') && !t.selfClosing) media.push(name);
      var inMedia = media.length ? media[media.length - 1] : '';
      if (name === 'img') { changed = attr(t, 'src', 'image') || changed; changed = attr(t, 'srcset', 'image', true) || changed; }
      else if (name === 'source') {
        if (inMedia === 'video') changed = attr(t, 'src', 'video') || changed;
        else if (!inMedia) { changed = attr(t, 'src', 'image') || changed; changed = attr(t, 'srcset', 'image', true) || changed; }
      } else if (name === 'video') { changed = attr(t, 'src', 'video') || changed; changed = attr(t, 'poster', 'image') || changed; }
      else if (name === 'image') { changed = attr(t, 'href', 'image') || changed; changed = attr(t, 'xlink:href', 'image') || changed; }
      changed = attr(t, 'style', 'style') || changed;
      if (changed) { out.push(html.slice(last, t.s), kit.writeTag(t)); last = t.e; }
    } else if (t.t === 'close') {
      if ((t.name === 'video' || t.name === 'audio') && media.length) media.pop();
    } else if (t.t === 'raw' && t.of === 'style') {
      var css = html.slice(t.s, t.e), next = walkCss(css, base, fn);
      if (next !== css) { out.push(html.slice(last, t.s), next); last = t.e; }
    }
  });
  out.push(html.slice(last));
  return out.join('');
}

/* raw, read against base -> the full address without its #fragment, or '' when it names no file to copy */
function resolve(raw, base) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s || s.charAt(0) === '#' || /^(?:data|blob|about|javascript|mailto|tel):/i.test(s)) return '';
  var u;
  try { u = new URL(s, base); } catch (e) { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  u.hash = '';
  return u.href;
}
function isAbsolute(raw) { return /^(?:https?:)?\/\//i.test(String(raw || '').trim()); }

/* ---------- the copy ---------- */

function nameFor(abs, ext) { return crypto.createHash('sha256').update(abs).digest('hex').slice(0, 16) + '.' + ext; }

function withTimeout(p, ms) {
  var timer;
  return Promise.race([p, new Promise(function (_r, reject) {
    timer = setTimeout(function () { reject(Object.assign(new Error('timed out'), { code: 'timeout' })); }, ms);
  })]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
}

function copyMedia(o) {
  var lim = Object.assign({ LIMITS: LIMITS, MAX_ASSETS: MAX_ASSETS, MAX_TOTAL_BYTES: MAX_TOTAL_BYTES, POOL: POOL, BUDGET_MS: BUDGET_MS }, o.limits || {});
  var pageUrl = o.pageUrl || ZIP_BASE, zip = pageUrl === ZIP_BASE;
  var sheets = (o.sheets || []).map(function (r) {
    var base = resolve(r.href, pageUrl) || pageUrl;
    return { href: r.href, text: String(r.text == null ? '' : r.text), base: base };
  });
  var bucketPrefix = o.ownPrefix || '';

  /* 1. what the page names, in the order it names it */
  var found = new Map();
  function note(raw, base, kind) {
    var abs = resolve(raw, base);
    if (!abs) return null;
    if (bucketPrefix && abs.indexOf(bucketPrefix) === 0) return null;                    // a copy of ours already
    var host = '';
    try { host = new URL(abs).hostname; } catch (e) { return null; }
    if (kind === 'font' && FONT_SERVICES.test(host)) return null;
    if (!found.has(abs)) found.set(abs, { abs: abs, kind: kind });
    return null;
  }
  walkHtml(o.html, pageUrl, o.kit, note);
  sheets.forEach(function (s) { walkCss(s.text, s.base, note); });

  /* 2. fetched and kept, a few at a time */
  var items = Array.from(found.values()), done = new Map(), notCopied = [], total = 0, copied = 0, byKind = { image: 0, font: 0, video: 0 };
  var deadline = Date.now() + lim.BUDGET_MS, next = 0;
  function skip(item, why) { done.set(item.abs, { why: why }); notCopied.push({ url: item.abs, why: why }); }
  items.slice(lim.MAX_ASSETS).forEach(function (item) { skip(item, 'too-many'); });
  items = items.slice(0, lim.MAX_ASSETS);

  function one(item) {
    if (Date.now() > deadline) return Promise.resolve(skip(item, 'out-of-time'));
    if (total >= lim.MAX_TOTAL_BYTES) return Promise.resolve(skip(item, 'too-much'));
    var kl = lim.LIMITS[item.kind];
    return withTimeout(Promise.resolve().then(function () { return o.load(item.abs, item.kind); }), kl.timeoutMs + 2000).then(function (got) {
      var body = Buffer.isBuffer(got) ? got : (got && Buffer.isBuffer(got.body) ? got.body : null);
      if (!body || !body.length) return skip(item, 'not-found');
      var s = sniff(body);
      if (!s || s.kind !== item.kind) return skip(item, 'bad-type');
      if (body.length > lim.LIMITS[s.kind].maxBytes) return skip(item, 'too-large');
      if (s.ext === 'svg' && unsafeSvg(body)) return skip(item, 'unsafe-svg');
      if (total + body.length > lim.MAX_TOTAL_BYTES) return skip(item, 'too-much');
      total += body.length;
      return Promise.resolve(o.store(o.folder + nameFor(item.abs, s.ext), body, s)).then(function (url) {
        if (!url) return skip(item, 'store-failed');
        done.set(item.abs, { url: url });
        copied++;
        byKind[s.kind]++;
      }, function (err) {
        console.error('import-lovable: a copy of "' + item.abs + '" could not be stored — ' + (err && err.message));
        skip(item, 'store-failed');
      });
    }, function (err) {
      skip(item, (err && typeof err.code === 'string' && /^[a-z-]{2,30}$/.test(err.code)) ? err.code : 'unreachable');
    });
  }
  function worker() {
    if (next >= items.length) return Promise.resolve();
    var item = items[next++];
    return one(item).then(worker);
  }
  var workers = [];
  for (var w = 0; w < Math.min(lim.POOL, items.length); w++) workers.push(worker());

  return Promise.all(workers).then(function () {
    /* 3. each value replaced where it stands */
    function swap(raw, base, kind) {
      var abs = resolve(raw, base);
      if (!abs) return null;
      var d = done.get(abs);
      if (d && d.url) return d.url;
      /* not copied, though the original may well have it (too large, too slow, past the limits, a fault on the way):
         a relative address would point at nothing on this host — the original's full address instead. One the
         original does not have (not found), that is not a file of the kind its place needs, that runs script, or
         that was refused stays as written: the page's own repair and delivery then take out what cannot work. */
      if (!zip && !isAbsolute(raw) && d && FETCHABLE_ELSEWHERE.indexOf(d.why) !== -1) return abs;
      return null;
    }
    var html = walkHtml(o.html, pageUrl, o.kit, swap);
    var outSheets = sheets.map(function (s) { return { href: s.href, text: walkCss(s.text, s.base, swap) }; });
    return {
      html: html, sheets: outSheets,
      summary: { found: found.size, copied: copied, bytes: total, byKind: byKind, notCopiedCount: notCopied.length, notCopied: notCopied.slice(0, 40) }
    };
  });
}

module.exports = { copyMedia: copyMedia, sniff: sniff, unsafeSvg: unsafeSvg, parseSrcset: parseSrcset, walkCss: walkCss, walkHtml: walkHtml,
  resolve: resolve, nameFor: nameFor, LIMITS: LIMITS, ACCEPT: ACCEPT, ZIP_BASE: ZIP_BASE, MAX_ASSETS: MAX_ASSETS,
  MAX_TOTAL_BYTES: MAX_TOTAL_BYTES, POOL: POOL, BUDGET_MS: BUDGET_MS };
