/* Pictures in the format and size a visitor's browser should load.

   WHY. An AI picture is stored as the model's PNG (1024 px, about 1.6 MB); a picture an import re-hosts or
   an organiser uploads is stored as it came (up to 8 MB). The same picture as WebP is 30-60 KB at that
   size. On a published page that was most of its weight: 2.8 MB of a 2.9 MB page in Lighthouse.

   WHAT IS STORED. Next to each raster picture this product keeps in its bucket — AI pictures
   (events/<id>/generated/), pictures re-hosted by an import (events/import-<id>/images/), uploads
   (events/<id>/<kind>/) — WebP copies ("variants") are stored when it is stored, and by the one-off
   script ops-pictures.js for pictures stored before this. The original is never changed or removed: it
   stays the picture's address everywhere (records, saved pages, the editor) and is the fallback.
   A variant's name says what it was made from:
       <original path>.rv-<hash>.<W>x<H>.w<width>.webp
     hash   the first 8 hex digits of the original's MD5 (Storage's md5Hash) — a variant made from an
            earlier picture stored under the same name is never used for a later one;
     W x H  the original's size as a browser shows it (EXIF orientation applied);
     width  the variant's own width: 640, 1280 and 1920 when the original is wider, and the original's
            own width up to 1920 (the largest variant is "the full size").
   A variant never changes once written, so it is public and cached for a year (immutable).
   Logos (a path with "logo" in it) are stored lossless: their lettering stays exactly as drawn.

   WHAT A PAGE GETS (rewriteHtml, on the way to a visitor — publishTransform and the serving of pages
   published before this):
     - an <img> that is loaded at once (no loading="lazy"; a hero, a banner, a picture near the top) gets
       the full-size variant as srcset "<url> <d>x". d is the variant's width over the original's, so the
       picture's natural size — and so its size on the page — is exactly the original's;
     - an <img loading="lazy"> (further down the page: a gallery, a card) gets every variant as a "w"
       candidate, with sizes saying: on a phone as wide as the screen, on a larger screen three quarters of
       it, and never wider than the original (lazySizes) — a gallery tile or a picture beside its text
       loads a narrower copy, and a rare full-width one still gets at least three quarters of its width
       in pixels (1280 on a 1350 px screen). The width it is really shown at is not known here;
       sizes="auto" would know it, but makes a picture whose CSS says width:auto 300 px wide;
     - either gets the original's width and height when it had neither (or the missing one of the two), so
       its box is known before it loads. It is marked data-rv-sized, and SIZED_CSS (written once into the
       head) makes its height follow its width unless the page's own CSS sets one — the attribute must
       never stretch a picture whose CSS gives it only a width;
     - the first big picture loaded at once inside a hero or banner gets fetchpriority="high";
     - a CSS background (a <style> block or a style attribute) keeps its url() and gets the same
       declaration again with image-set(<full-size variant> type("image/webp"), <original>): a browser
       that does not read that keeps the first; the hero's background (<style data-rv-style="hero">) is
       preloaded, since a browser finds a CSS background only late.
   An <img> that already has a srcset is left as it is (the author chose), which is also what makes
   rewriting a page twice change nothing.
   A browser without WebP (Safari 13 and older, 2019) shows no picture for an <img> rewritten this way.

   No picture library on the machine (sharp is an optional native module) = no variants are made, and
   pages are served as before. Nothing here ever fails an upload, a generation or a page.

     makeVariants(buffer, { lossless })  -> Promise<{ width, height, hash, variants: [{ width, buffer }] } | null>
     storeVariants(fb, path, buffer, opts) -> Promise<{ width, height, widths } | null>   never rejects
     prepare(fb, html)                    -> Promise<index>  the variants of every picture the page uses
     lookupUrls(fb, urls)                 -> Promise<index>
     rewriteHtml(html, index)             -> html
     siteDataMap(index)                   -> { url: 'hash.WxH:640,1280' }  for the page runtime (rv-data.js)
     indexFromListing(bucket, files)      -> index  (no network: for tests)
   index: { bucket, entries: { '<object path>': { w, h, hash, widths: [..], base } } } */

const crypto = require('crypto');

var WIDTHS = [640, 1280, 1920];
var MAX_WIDTH = 1920;
var QUALITY = 80;
var MAX_INPUT_PIXELS = 60000000;               // 60 MP: more than any camera photo an organiser uploads
/* a JPEG is decoded already shrunk towards the width asked for; a PNG or WebP is decoded whole (4 bytes a
   pixel; a 29 MP PNG took 240 MB more), and an instance has 512 MB for everything it does: past 16 MP
   (4900 x 3260) one gets no copies. A 48 MP JPEG takes about 80 MB. */
var MAX_DECODED_PIXELS = 16000000;
var VARIANT_RE = /^(.+)\.rv-([0-9a-f]{8})\.(\d{1,5})x(\d{1,5})\.w(\d{1,5})\.webp$/;
var RASTER_PATH = /\.(png|jpe?g|webp)$/i;
var CACHE = 'public, max-age=31536000, immutable';
/* sizes for a lazy picture W px wide: as wide as a phone's screen, three quarters of a larger one — never more
   than W, since with "w" candidates the picture's natural width becomes this value, and a picture whose CSS
   leaves its width to its natural size must not grow */
function lazySizes(w) {
  var phone = Math.min(767, w), wide = Math.floor(w / 0.75);
  return '(max-width: ' + phone + 'px) 100vw, (max-width: ' + wide + 'px) 75vw, ' + w + 'px';
}
var STORAGE_HOST = 'https://storage.googleapis.com/';

/* the CSS that keeps a sized picture's height in the page's hands: :where() weighs nothing, so any rule of
   the page's own that sets a height wins, and it still beats the height attribute (which weighs less than
   any rule) */
var SIZED_CSS = '<style data-rv-pictures>:where(img[data-rv-sized]){height:auto}</style>';

var sharpModule;
function loadSharp() {
  if (sharpModule === undefined) {
    try {
      sharpModule = require('sharp');
      sharpModule.cache(false);                // nothing kept between pictures: 512 MB serves everything else
      sharpModule.concurrency(1);
    } catch (e) {
      sharpModule = null;
      console.error('pictures: no WebP variants can be made here (sharp) — ' + e.message);
    }
  }
  return sharpModule;
}

/* One picture at a time per instance: an import re-hosts dozens at once, and each decoded picture holds
   its pixels in memory. */
var queue = Promise.resolve();
function serially(job) {
  var run = queue.then(job, job);
  queue = run.then(function () {}, function () {});
  return run;
}

function md5Hex8(buffer) { return crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8); }
function hex8OfMd5Base64(b64) {
  if (typeof b64 !== 'string' || !b64) return '';
  try { return Buffer.from(b64, 'base64').toString('hex').slice(0, 8); } catch (e) { return ''; }
}

function variantName(path, hash, w, h, width) { return path + '.rv-' + hash + '.' + w + 'x' + h + '.w' + width + '.webp'; }
function parseVariant(name) {
  var m = VARIANT_RE.exec(String(name || ''));
  return m ? { source: m[1], hash: m[2], w: +m[3], h: +m[4], width: +m[5] } : null;
}
function isVariant(name) { return VARIANT_RE.test(String(name || '')); }

/* the widths made for an original `w` wide: the standard ones it is wider than, and its own (up to the
   largest) — a 1024 px picture gets 640 and 1024 */
function widthsFor(w) {
  var top = Math.min(w, MAX_WIDTH);
  var out = WIDTHS.filter(function (x) { return x < top * 0.95; });
  out.push(top);
  return out;
}

/* PNG, JPEG or WebP by its first bytes ('' for anything else: an SVG, a GIF, not a picture) */
function rasterKind(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return '';
}

function isLogoPath(path) { return /logo/i.test(String(path || '').split('/').pop()); }
function wanted(path) { return RASTER_PATH.test(String(path || '')) && !isVariant(path); }

function makeVariants(buffer, opts) {
  opts = opts || {};
  var sharp = loadSharp();
  if (!sharp || !Buffer.isBuffer(buffer) || !rasterKind(buffer)) return Promise.resolve(null);
  return serially(function () {
    var input = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' };
    return sharp(buffer, input).metadata().then(function (meta) {
      if (!meta || ['png', 'jpeg', 'webp'].indexOf(meta.format) === -1) return null;
      if ((meta.pages || 1) > 1) return null;                 // an animated WebP stays as it is
      if (meta.format !== 'jpeg' && meta.width * meta.height > MAX_DECODED_PIXELS) return null;
      var turned = (meta.orientation || 1) >= 5;
      var w = turned ? meta.height : meta.width, h = turned ? meta.width : meta.height;
      if (!(w > 0 && h > 0)) return null;
      var widths = widthsFor(w), variants = [];
      return widths.reduce(function (chain, width) {
        return chain.then(function () {
          var pipe = sharp(buffer, input).rotate();
          if (width < w) pipe = pipe.resize({ width: width });
          var webp = opts.lossless ? { lossless: true, effort: 4 } : { quality: QUALITY, alphaQuality: 90, smartSubsample: true, effort: 4 };
          return pipe.webp(webp).toBuffer().then(function (out) {
            /* a copy that is not smaller than the original is no use to anybody */
            if (out.length < buffer.length) variants.push({ width: width, buffer: out });
          });
        });
      }, Promise.resolve()).then(function () {
        return variants.length ? { width: w, height: h, hash: md5Hex8(buffer), variants: variants } : null;
      });
    });
  }).catch(function (err) {
    console.error('pictures: variants could not be made — ' + (err && err.message));
    return null;
  });
}

function publicUrl(bucket, path) {
  return STORAGE_HOST + bucket + '/' + String(path).split('/').map(encodeURIComponent).join('/');
}

/* The object path a URL of ours names ('' when it is not one of this bucket's objects): the address an
   upload answers (each part encoded), an AI picture's (as written), with or without ?v=… */
function pathOfUrl(url, bucket) {
  var s = String(url || '').trim().replace(/&amp;/g, '&');
  var head = STORAGE_HOST + bucket + '/';
  if (s.indexOf('//storage.googleapis.com/') === 0) s = 'https:' + s;
  if (s.indexOf(head) !== 0) return '';
  var rest = s.slice(head.length).split(/[?#]/)[0];
  try { rest = rest.split('/').map(decodeURIComponent).join('/'); } catch (e) { return ''; }
  return /^events\/[^/]+\//.test(rest) && rest.indexOf('..') === -1 ? rest : '';
}

/* ---------- storing ---------- */

/* Makes and stores the variants of the picture just stored at `path`. Resolves what it stored, or null —
   never rejects: a picture without variants is shown as it is.
   opts: { budgetMs } — past it the caller is answered without them (they may still arrive). */
function storeVariants(fb, path, buffer, opts) {
  opts = opts || {};
  if (!fb || !fb.bucket || !wanted(path)) return Promise.resolve(null);
  var work = makeVariants(buffer, { lossless: isLogoPath(path) }).then(function (made) {
    if (!made) return null;
    return Promise.all(made.variants.map(function (v) {
      var file = fb.bucket.file(variantName(path, made.hash, made.width, made.height, v.width));
      return file.save(v.buffer, {
        resumable: false, predefinedAcl: 'publicRead',
        metadata: { contentType: 'image/webp', cacheControl: CACHE, metadata: { rvSource: path } }
      });
    })).then(function () {
      forgetDir(dirOf(path));
      return { width: made.width, height: made.height, widths: made.variants.map(function (v) { return v.width; }) };
    });
  }).catch(function (err) {
    console.error('pictures: variants of ' + path + ' could not be stored — ' + (err && err.message));
    return null;
  });
  if (!(opts.budgetMs > 0)) return work;
  return Promise.race([work, new Promise(function (resolve) { setTimeout(function () { resolve(null); }, opts.budgetMs).unref(); })]);
}

/* ---------- finding them ---------- */

function dirOf(path) { return String(path).slice(0, String(path).lastIndexOf('/') + 1); }

/* what a folder holds, per instance for a few minutes: a page is served many times between two changes
   of its pictures, and a new variant stored here clears its folder at once */
var DIRS = new Map(), DIR_TTL_MS = 5 * 60 * 1000, DIRS_MAX = 300;
function forgetDir(dir) { DIRS.delete(dir); }
function listDir(fb, dir) {
  var hit = DIRS.get(dir);
  if (hit && Date.now() - hit.at < DIR_TTL_MS) return hit.files;
  var files = fb.bucket.getFiles({ prefix: dir, delimiter: '/', autoPaginate: true, maxResults: 5000 }).then(function (r) {
    return (r[0] || []).map(function (f) { return { name: f.name, md5Hash: f.metadata && f.metadata.md5Hash }; });
  });
  if (DIRS.size >= DIRS_MAX) DIRS.delete(DIRS.keys().next().value);
  DIRS.set(dir, { at: Date.now(), files: files });
  files.catch(function () { DIRS.delete(dir); });
  return files;
}

/* index from what folders hold: an original with its variants, the variants checked against its MD5 */
function indexFromListing(bucket, files) {
  var md5 = {}, found = {};
  (files || []).forEach(function (f) {
    var v = parseVariant(f.name);
    if (!v) { md5[f.name] = hex8OfMd5Base64(f.md5Hash); return; }
    (found[v.source] = found[v.source] || []).push(v);
  });
  var entries = {};
  Object.keys(found).forEach(function (source) {
    var hash = md5[source];
    if (!hash) return;                                  // the original is gone, or was never listed
    var mine = found[source].filter(function (v) { return v.hash === hash; });
    if (!mine.length) return;
    var widths = mine.map(function (v) { return v.width; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
    entries[source] = { w: mine[0].w, h: mine[0].h, hash: hash, widths: widths };
  });
  return { bucket: bucket, entries: entries };
}

function emptyIndex(bucket) { return { bucket: bucket || '', entries: {} }; }

/* the variants of the pictures at these object paths (one listing per folder) — never rejects */
function lookupPaths(fb, paths) {
  if (!fb || !fb.bucket) return Promise.resolve(emptyIndex());
  var bucket = fb.bucket.name;
  var dirs = paths.filter(wanted).map(dirOf).filter(function (d, i, a) { return d && a.indexOf(d) === i; }).slice(0, 40);
  if (!dirs.length) return Promise.resolve(emptyIndex(bucket));
  return Promise.all(dirs.map(function (d) {
    return listDir(fb, d).catch(function (err) {
      console.error('pictures: ' + d + ' could not be listed — ' + (err && err.message));
      return [];
    });
  })).then(function (lists) {
    return indexFromListing(bucket, [].concat.apply([], lists));
  });
}
function lookupUrls(fb, urls) {
  if (!fb || !fb.bucket) return Promise.resolve(emptyIndex());
  var bucket = fb.bucket.name;
  return lookupPaths(fb, (urls || []).map(function (u) { return pathOfUrl(u, bucket); }).filter(Boolean));
}

/* every picture of ours a page names, in an <img src> or a CSS url() */
function urlsIn(html) {
  var out = [], re = /(?:\ssrc\s*=\s*["']?|url\(\s*(?:&quot;|["'])?)((?:https:)?\/\/storage\.googleapis\.com\/[^"'\s)&>]+)/gi, m;
  while ((m = re.exec(String(html || '')))) out.push(m[1]);
  return out;
}
function prepare(fb, html) {
  return lookupUrls(fb, urlsIn(html)).catch(function () { return emptyIndex(fb && fb.bucket && fb.bucket.name); });
}

/* ---------- the page ---------- */

function entryFor(index, url) {
  if (!index || !index.entries) return null;
  var path = pathOfUrl(url, index.bucket);
  var e = path ? index.entries[path] : null;
  return e ? { e: e, path: path } : null;
}
function variantUrl(index, path, e, width) { return publicUrl(index.bucket, variantName(path, e.hash, e.w, e.h, width)); }
function fullWidth(e) { return e.widths[e.widths.length - 1]; }
/* a copy at the original's full size (up to the largest width) exists — not when it came out no smaller
   than the original and was not kept: then only the original has those pixels */
function hasFull(e) { return fullWidth(e) >= Math.min(e.w, MAX_WIDTH); }
function escAttr(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function round3(n) { return Math.round(n * 1000) / 1000; }

function decodeAttr(v) { return String(v).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'); }

function readAttrs(text) {
  var attrs = [], re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g, m;
  while ((m = re.exec(text))) attrs.push({ name: m[1].toLowerCase(), value: m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : null });
  return attrs;
}
function attr(attrs, name) {
  for (var i = 0; i < attrs.length; i++) if (attrs[i].name === name) return attrs[i].value == null ? '' : decodeAttr(attrs[i].value);
  return null;
}
function px(v) { return v != null && /^\s*\d+(\.\d+)?\s*$/.test(v) ? parseFloat(v) : 0; }

/* one <img …> tag, rewritten (or as it was). state: { lcpDone, inHero } */
function rewriteImg(tag, index, state) {
  var inner = tag.replace(/^<img\b/i, '').replace(/\/?>$/, '');
  var attrs = readAttrs(inner);
  if (attr(attrs, 'srcset') != null) return tag;
  var src = attr(attrs, 'src');
  var hit = src && entryFor(index, src);
  if (!hit) return tag;
  var e = hit.e, add = [];
  var lazy = String(attr(attrs, 'loading') || '').toLowerCase() === 'lazy';
  var wa = attr(attrs, 'width'), ha = attr(attrs, 'height');
  var w = px(wa), h = px(ha);
  var whole = hasFull(e);
  if (lazy && (e.widths.length > 1 || !whole)) {
    var list = e.widths.map(function (x) { return variantUrl(index, hit.path, e, x) + ' ' + x + 'w'; });
    /* no smaller copy at full size: the original is the candidate for a screen that needs it */
    if (!whole && !/[\s,]/.test(src)) list.push(escAttr(src) + ' ' + e.w + 'w');
    add.push('srcset="' + list.join(', ') + '"');
    add.push('sizes="' + lazySizes(e.w) + '"');
  } else if (whole) {
    var full = fullWidth(e), d = round3(full / e.w);
    add.push('srcset="' + variantUrl(index, hit.path, e, full) + ' ' + (d === 1 ? '1x' : d + 'x') + '"');
  }
  if (wa == null && ha == null) { add.push('width="' + e.w + '"', 'height="' + e.h + '"', 'data-rv-sized'); state.sized = true; }
  else if (wa == null && h > 0) { add.push('width="' + Math.round(h * e.w / e.h) + '"', 'data-rv-sized'); state.sized = true; }
  else if (ha == null && w > 0) { add.push('height="' + Math.round(w * e.h / e.w) + '"', 'data-rv-sized'); state.sized = true; }
  if (!lazy && !state.lcpDone && state.inHero && e.w >= 1000 && e.h >= 400 && attr(attrs, 'fetchpriority') == null) {
    add.push('fetchpriority="high"');
    state.lcpDone = true;
  }
  if (!add.length) return tag;
  var end = /\/>$/.test(tag) ? ' />' : '>';
  return '<img' + inner.replace(/\s+$/, '') + ' ' + add.join(' ') + end;
}

/* a stylesheet's (or a style attribute's) background pictures: each declaration that names one of ours is
   followed by the same declaration with image-set(webp, original) — once */
function rewriteCss(css, index, state, quoted) {
  var re = /(^|[{;\s])(background(?:-image)?)(\s*:\s*)([^;{}]*?url\([^;{}]*?)(\s*!important)?(\s*)(?=;|}|$)/gi;
  return String(css).replace(re, function (full, lead, prop, colon, value, imp, space, offset, whole) {
    if (/image-set\(/i.test(value)) return full;
    /* already followed by its image-set twin (a page rewritten before) */
    var after = whole.slice(offset + full.length, offset + full.length + 400);
    if (new RegExp('^;\\s*' + prop + '\\s*:[^;{}]*image-set\\(', 'i').test(after)) return full;
    var changed = false, first = '';
    var twin = value.replace(/url\(\s*(\u0001|["']?)([^"')&\u0001]*?)\1\s*\)/gi, function (u, q, url) {
      var hit = entryFor(index, url);
      if (!hit || !hasFull(hit.e)) return u;
      changed = true;
      var webp = variantUrl(index, hit.path, hit.e, fullWidth(hit.e));
      if (!first) first = webp;
      var Q = quoted ? "'" : '"';
      return 'image-set(url(' + Q + webp + Q + ') type(' + Q + 'image/webp' + Q + '), url(' + Q + url + Q + '))';
    });
    if (!changed) return full;
    if (state && first && !state.heroBg && state.inHeroStyle) state.heroBg = first;
    return full + ';' + prop + colon + twin + (imp || '') + space;
  });
}

/* The page with its pictures' variants (see the top of this file). Text inside <script>, <textarea> and
   comments is never touched. */
function rewriteHtml(html, index) {
  html = String(html == null ? '' : html);
  if (!index || !index.entries || !Object.keys(index.entries).length) return html;
  var state = { lcpDone: false, inHero: false, sized: false, heroBg: '', inHeroStyle: false };
  var hero = null;                                  // { name, depth } while inside the first hero/banner element
  var heroSeen = false;
  var re = /<!--[\s\S]*?-->|<(script|textarea)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<style\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)(<\/style\s*>)|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  var out = html.replace(re, function (full, rawTag, styleAttrs, styleText, styleEnd, closeName, name, rest) {
    if (rawTag || full.charAt(1) === '!') return full;
    if (styleText != null && styleEnd) {
      state.inHeroStyle = /\bdata-rv-style\s*=\s*["']?hero\b/i.test(styleAttrs || '');
      var css = rewriteCss(styleText, index, state, false);
      state.inHeroStyle = false;
      return '<style' + (styleAttrs || '') + '>' + css + styleEnd;
    }
    if (closeName) {
      if (hero && closeName.toLowerCase() === hero.name && --hero.depth === 0) { hero = null; state.inHero = false; }
      return full;
    }
    var tagName = name.toLowerCase();
    if (hero && tagName === hero.name && !/\/\s*$/.test(rest)) hero.depth++;
    if (!heroSeen && !/\/\s*$/.test(rest) && ['img', 'link', 'meta', 'br', 'input', 'source'].indexOf(tagName) === -1) {
      var a = readAttrs(rest), id = attr(a, 'id') || '', cls = attr(a, 'class') || '';
      if (/(^|[\s_-])(hero|banner)([\s_-]|$)/i.test(id + ' ' + cls)) { hero = { name: tagName, depth: 1 }; heroSeen = true; state.inHero = true; }
    }
    var tag = full;
    if (tagName === 'img') tag = rewriteImg(tag, index, state);
    if (/\sstyle\s*=/i.test(rest) && /url\(/i.test(rest)) {
      tag = tag.replace(/(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/i, function (s, lead, q, value) {
        /* "&quot;" holds a ";" the CSS reading would stop at: it is set aside while the value is read */
        return lead + q + rewriteCss(value.replace(/&quot;/g, '\u0001'), index, null, q === '"').replace(/\u0001/g, '&quot;') + q;
      });
    }
    return tag;
  });
  /* once, at the top of the head (after its charset, if that comes first): the rule for sized pictures, and
     the hero's background preloaded — early, and before anything publishTransform writes at the end of the
     head, so that transforming the page again leaves every line where it was */
  var head = [];
  if (state.sized && out.indexOf('<style data-rv-pictures>') === -1) head.push(SIZED_CSS);
  if (state.heroBg && out.indexOf('data-rv-pictures-preload') === -1) {
    head.push('<link rel="preload" as="image" type="image/webp" href="' + state.heroBg + '" fetchpriority="high" data-rv-pictures-preload>');
  }
  if (!head.length) return out;
  var at = 0, m = /<head(?:\s[^>]*)?>(\s*<meta\s+charset\s*=[^>]*>)?/i.exec(out);
  if (m) at = m.index + m[0].length;
  else { var body = out.search(/<body\b/i); at = body === -1 ? 0 : body; }
  return out.slice(0, at) + '\n' + head.join('\n') + out.slice(at);
}

/* the WebP copy rewriteImg gives a picture shown near the top (its full-size copy), or '' when it has none —
   for a preload that must name the very file the page will use (lib/api.js heroVideoPictures) */
function fullCopyUrl(index, url) {
  var hit = url && entryFor(index, url);
  return hit && hasFull(hit.e) ? variantUrl(index, hit.path, hit.e, fullWidth(hit.e)) : '';
}

/* For the page runtime (rv-data.js), which shows records' pictures in the visitor's browser: each picture
   with variants as "<hash>.<W>x<H>:<width>,<width>" — enough to name every variant of it. */
function siteDataMap(index) {
  var out = {};
  if (!index || !index.entries) return out;
  Object.keys(index.entries).forEach(function (path) {
    var e = index.entries[path];
    out[publicUrl(index.bucket, path)] = e.hash + '.' + e.w + 'x' + e.h + ':' + e.widths.join(',');
  });
  return out;
}

module.exports = {
  makeVariants: makeVariants, storeVariants: storeVariants, prepare: prepare, lookupUrls: lookupUrls, lookupPaths: lookupPaths,
  rewriteHtml: rewriteHtml, fullCopyUrl: fullCopyUrl, siteDataMap: siteDataMap, indexFromListing: indexFromListing, urlsIn: urlsIn,
  variantName: variantName, parseVariant: parseVariant, isVariant: isVariant, widthsFor: widthsFor, pathOfUrl: pathOfUrl,
  publicUrl: publicUrl, wanted: wanted, isLogoPath: isLogoPath, hex8OfMd5Base64: hex8OfMd5Base64, md5Hex8: md5Hex8,
  available: function () { return !!loadSharp(); },
  SIZED_CSS: SIZED_CSS, CACHE: CACHE, WIDTHS: WIDTHS, MAX_WIDTH: MAX_WIDTH, _forgetDir: forgetDir
};
