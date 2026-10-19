/* How a finished event page travels to a visitor's browser — the last step before GET /e/<id> and
   GET /preview/<id> answer (lib/api.js handlePublicPage / handlePreviewPage). Nothing here changes what
   the page shows or how it behaves; it changes how quickly a browser can show it.

   It runs on the way OUT, every time a page is served (the result is cached by the page's own bytes), and
   never on a page that is stored: a saved or published page stays exactly what the editor and
   publishTransform wrote, the editor and its live view are never given this version, and every page ever
   published — including ones published before this file existed — gets the same treatment without being
   published again.

   What it does, in page order:
     1. Our own small stylesheets (templates/_shared/*.css, a template's theme.css) are written into the page
        (<style data-rv-inline="<path>">) instead of linked: each <link> was a request the browser had to wait
        for before it could draw anything. ET's microsite bundle (et-global.css, 600 KB) is first cut down to
        the rules this page can use (lib/css-purge.js) — about 30 KB. A stylesheet's leading @import lines
        become <link> tags in the same place (same cascade order, but fetched at once instead of after the
        sheet); a Google Fonts @import for families nothing on the page names is left out, and so is the
        Bootstrap Icons font when the page uses none of its icons. A sheet that cannot be written in safely
        (a relative url(), a "</style" in its text, an unusual <link>) stays a <link>.
     2. Google Fonts stylesheets for families nothing on the page names are left out (an AI-designed site
        loaded every theme's fonts so the preview's theme switcher is instant — the preview still has them,
        because its switcher names them). The ones kept, and Bootstrap Icons' sheet, are written into the
        page once this server has fetched them (see "other hosts' stylesheets" below), and the browser is told
        to open the font files' connection early.
     3. @font-face rules in the page's own <style> blocks that say nothing about font-display get
        font-display:swap — text shows at once in a fallback font instead of staying invisible.
     4. The site runtime (et-runtime.js) in <head> no longer holds the page up: it loads with `defer`, and a
        few lines in its place keep the sections' RevampSections.register/widget calls until it arrives
        (et-runtime.js picks them up; if an older copy of it did not, the stand-in hands them over itself
        when the page has loaded). Pages with any other inline script that uses RevampSections keep the
        runtime as it was.
     5. Every file of ours the page names (<link href>, <script src>, <img src>) gets ?v=<content hash>, and
        server.js lets browsers and the CDN keep such a file for a year: a new deployment changes the hash,
        so a visitor never keeps an old copy, and a returning one downloads nothing again.
     6. A <video>/<audio>/<source> that points at a path of this host which cannot exist (an imported
        page's own builder paths, /__l5e/…) loses that src/poster: it only ever produced an error and,
        before the sign-in gate answered such paths with 404, a downloaded sign-in page. */
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cssPurge = require('./css-purge');

var ROOT = path.join(__dirname, '..', '..');
var PURGE_OVER_BYTES = 32 * 1024;       // a stylesheet bigger than this is cut down to what the page uses
var INLINE_MAX_BYTES = 80 * 1024;       // …and one still bigger than this after that stays a <link>
var RUNTIME_PATH = '/templates/_shared/et-runtime.js';
var EVERY_WORD = { has: function () { return true; } };

/* ---------- our own files, read once per version ---------- */
var fileCache = new Map();
function servable(rel) {
  try { return require('./access').isServableFile(rel); } catch (e) { return false; }
}
/* urlPath: "/templates/_shared/x.css" (no query) -> { abs, text, hash } or null when it is not a file
   this server sends */
function localFile(urlPath) {
  if (typeof urlPath !== 'string' || urlPath.charAt(0) !== '/' || urlPath.charAt(1) === '/') return null;
  var rel;
  try { rel = decodeURIComponent(urlPath).slice(1); } catch (e) { return null; }
  if (!rel || rel.indexOf('\0') !== -1 || path.posix.normalize('/' + rel) !== '/' + rel || !servable(rel)) return null;
  var abs = path.join(ROOT, rel), st;
  try { st = fs.statSync(abs); } catch (e) { return null; }
  if (!st.isFile()) return null;
  var hit = fileCache.get(abs);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit;
  var buf;
  try { buf = fs.readFileSync(abs); } catch (e) { return null; }
  hit = { abs: abs, mtime: st.mtimeMs, size: st.size, buf: buf, text: null,
    hash: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10) };
  if (fileCache.size > 400) fileCache.clear();
  fileCache.set(abs, hit);
  return hit;
}
function textOf(file) { if (file.text == null) file.text = file.buf.toString('utf8'); return file.text; }

/* the content hash of one of our files ("" when it is not one) — server.js uses it to recognise a
   current ?v= */
function assetVersion(urlPath) { var f = localFile(urlPath); return f ? f.hash : ''; }

/* "/x.js" or "/x.js?v=old" -> "/x.js?v=<hash>"; any other address (another host, other query
   parameters, a #fragment, a file we do not have) comes back unchanged */
function versioned(url) {
  var m = /^(\/(?!\/)[^?#\s]*)(?:\?v=[A-Za-z0-9._-]*)?$/.exec(String(url || ''));
  if (!m) return url;
  var f = localFile(m[1]);
  return f ? m[1] + '?v=' + f.hash : url;
}
function pathOnly(url) { return String(url || '').replace(/[?#].*$/, ''); }

/* ---------- Google Fonts ---------- */
function fontFamilies(url) {
  var q = String(url).split('?')[1] || '', names = [];
  q.replace(/&amp;/g, '&').split('&').forEach(function (kv) {
    var eq = kv.indexOf('=');
    if (eq === -1 || kv.slice(0, eq) !== 'family') return;
    var v = kv.slice(eq + 1).replace(/\+/g, ' ');
    try { v = decodeURIComponent(v); } catch (e) { /* keep it as written */ }
    v.split('|').forEach(function (f) { var name = f.split(':')[0].trim(); if (name) names.push(name); });
  });
  return names;
}
function isGoogleFontCss(url) { return /^https:\/\/fonts\.googleapis\.com\/css2?\?/i.test(String(url || '').replace(/&amp;/g, '&')); }
/* is any of these families named anywhere in `text` (as a whole word, any case)? No family read -> yes */
function namesAny(families, text) {
  if (!families.length) return true;
  return families.some(function (f) {
    var re = new RegExp('(^|[^A-Za-z0-9_-])' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s+_-]*') + '(?![A-Za-z0-9_])', 'i');
    return re.test(text);
  });
}

function addFontDisplay(css) {
  return String(css).replace(/@font-face\s*\{([^{}]*)\}/gi, function (all, body) {
    return /font-display\s*:/i.test(body) ? all : '@font-face{font-display:swap;' + body + '}';
  });
}

/* ---------- other hosts' stylesheets, written into the page ----------
   A Google Fonts stylesheet is a few @font-face rules, and Bootstrap Icons' (ET's bundle imports it) is mostly
   rules for icons the page does not use — yet each was a request to another host that the first paint
   waited for (over a second on a phone). This server fetches them itself — only from those two places — keeps
   them for a day, and writes them into the page: the font files themselves still come from Google / jsDelivr,
   and only when the page uses them. Until a sheet has been fetched once (or when that fails) the page keeps
   its <link>; nothing waits for the fetch. */
var REMOTE_CSS = new Map(), REMOTE_OK_MS = 24 * 3600 * 1000, REMOTE_RETRY_MS = 10 * 60 * 1000, REMOTE_MAX_BYTES = 512 * 1024;
var remoteGeneration = 0;                         // moves on when a sheet arrives, so cached pages are redone
/* Google answers the stylesheet a browser like this one can use (woff2, split by alphabet) */
var BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
function remoteAllowed(url) {
  return isGoogleFontCss(url) || /^https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap-icons@\d+\.\d+\.\d+\/font\/bootstrap-icons(\.min)?\.css$/.test(url);
}
var fetchCss = function (url, done) {
  var req = require('https').get(url, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/css,*/*;q=0.1' }, timeout: 5000 }, function (res) {
    if (res.statusCode !== 200 || !/text\/css/i.test(res.headers['content-type'] || '')) { res.resume(); return done(null); }
    var parts = [], size = 0;
    res.on('data', function (c) { size += c.length; if (size > REMOTE_MAX_BYTES) { req.destroy(); return; } parts.push(c); });
    res.on('end', function () { done(size > REMOTE_MAX_BYTES ? null : Buffer.concat(parts).toString('utf8')); });
    res.on('error', function () { done(null); });
  });
  req.on('timeout', function () { req.destroy(); });
  req.on('error', function () { done(null); });
};
/* the sheet's text with every relative url() made absolute (it is read from the page, not from its host) */
function absoluteUrls(css, base) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (all, q, ref) {
    if (/^(data:|https?:|#)/i.test(ref.trim())) return all;
    try { return 'url(' + q + new URL(ref.trim(), base).href + q + ')'; } catch (e) { return all; }
  });
}
/* -> the sheet's text when it is at hand, else null (and it is fetched for next time) */
function remoteCss(url) {
  url = String(url).replace(/&amp;/g, '&');
  if (!remoteAllowed(url)) return null;
  var hit = REMOTE_CSS.get(url), now = Date.now();
  if (hit && (hit.pending || now - hit.at < (hit.css ? REMOTE_OK_MS : REMOTE_RETRY_MS))) return hit.css;
  var entry = { at: now, css: hit ? hit.css : null, pending: true };      // a stale copy serves while it is renewed
  if (REMOTE_CSS.size > 300) REMOTE_CSS.clear();
  REMOTE_CSS.set(url, entry);
  fetchCss(url, function (text) {
    entry.pending = false; entry.at = Date.now();
    if (text != null && !/<\/style/i.test(text)) { entry.css = absoluteUrls(text, url); remoteGeneration++; }
  });
  return entry.css;
}

/* The stand-in for RevampSections until et-runtime.js (deferred) arrives. A widget's section is read from
   the <script data-rv-script> calling it, so it is read here, while that script is the current one. */
var RUNTIME_STUB = '<script data-rv-delivery>(function(w,d){if(w.RevampSections)return;var q=[],s={q:q,' +
  'register:function(t,f){q.push([t,f])},' +
  'widget:function(n,f){var c=d.currentScript,t=c&&c.getAttribute("data-rv-script");' +
  'if(t)q.push([t,f]);else console.error(\'[revamp] widget "\'+n+\'" was loaded without a section to run on.\')}};' +
  'w.RevampSections=s;d.addEventListener("DOMContentLoaded",function(){var r=w.RevampSections;' +
  'if(r===s||!r||!r.register||!q.length)return;var l=q.splice(0);for(var i=0;i<l.length;i++)r.register(l[i][0],l[i][1])})' +
  '})(window,document)</script>';

/* ---------- the page ---------- */
var pageCache = new Map(), PAGE_CACHE_MAX = 60, PAGE_CACHE_TTL_MS = 10 * 60 * 1000;

/* html: a finished page (publishTransform's output, or a stored published page);
   opts: { tools: lib/api.js's HTML tokenizer helpers } -> the page as it is sent */
function deliverPage(html, opts) {
  html = String(html == null ? '' : html);
  var key = crypto.createHash('sha1').update(html).digest('hex') + ':' + remoteGeneration;
  var hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < PAGE_CACHE_TTL_MS) return hit.html;
  var result;
  try { result = transform(html, opts.tools); }
  catch (err) {
    /* a page this cannot read is sent as it is: slower, never broken */
    console.error('delivery: page left as it was — ' + (err && err.stack || err));
    result = html;
  }
  if (pageCache.size >= PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
  pageCache.set(key, { at: Date.now(), html: result });
  return result;
}

function transform(html, T) {
  var tokens = T.tokenizeHtml(html);
  var out = tokens.map(function (t) { return html.slice(t.s, t.e); });
  var before = {}, done = {};                 // text written in front of a token; tokens already replaced
  var i, t;
  function isOpen(tok, name) { return tok.t === 'open' && tok.name === name; }
  function attr(tok, name) { return T.attrValue(tok, name); }
  function rawAfter(idx) { var r = tokens[idx + 1]; return r && r.t === 'raw' ? out[idx + 1] : ''; }
  function closeAfter(idx, name) {
    var j = idx + 1;
    if (tokens[j] && tokens[j].t === 'raw') j++;
    return tokens[j] && tokens[j].t === 'close' && tokens[j].name === name ? j : -1;
  }

  var headOpen = -1, charsetAt = -1, scripts = [], runtimeAt = -1;
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    if (isOpen(t, 'head') && headOpen === -1) headOpen = i;
    if (isOpen(t, 'meta') && charsetAt === -1 && attr(t, 'charset') != null) charsetAt = i;
    if (isOpen(t, 'script')) {
      scripts.push(i);
      if (runtimeAt === -1 && pathOnly(attr(t, 'src')) === RUNTIME_PATH && attr(t, 'defer') == null && attr(t, 'async') == null &&
          !/module/i.test(attr(t, 'type') || '')) runtimeAt = i;
    }
  }

  /* the words the page and the scripts it runs could ever use (for cutting a big stylesheet down) */
  var words = null;
  function pageWords() {
    if (words) return words;
    var texts = [html];
    var runtime = localFile(RUNTIME_PATH);
    if (runtime) texts.push(textOf(runtime));
    scripts.forEach(function (idx) {
      var f = localFile(pathOnly(attr(tokens[idx], 'src')));
      if (f) texts.push(textOf(f));
    });
    words = cssPurge.wordsOf(texts);
    return words;
  }

  var iconWords = null;
  function usesIconClasses() {
    if (iconWords == null) iconWords = Array.from(pageWords()).some(function (w) { return /^(bi|fa)-[a-z0-9]/.test(w) || w === 'bi' || w === 'fa'; });
    return iconWords;
  }

  /* ---- 1. our stylesheets, written into the page ---- */
  var LINK_ATTRS = { rel: 1, href: 1, type: 1, media: 1, 'data-rv-runtime': 1, 'data-rv-head': 1 };
  var fontLinks = [], extraCss = [];
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    if (!isOpen(t, 'link')) continue;
    var rel = (attr(t, 'rel') || '').toLowerCase().split(/\s+/);
    if (rel.indexOf('stylesheet') === -1 || rel.indexOf('alternate') !== -1) continue;
    var href = attr(t, 'href') || '';
    if (isGoogleFontCss(href)) { fontLinks.push(i); continue; }
    var file = localFile(pathOnly(href));
    if (!file || !/\.css$/i.test(file.abs)) continue;
    if (!t.attrs.every(function (a) { return LINK_ATTRS[a.name]; })) { extraCss.push(textOf(file)); continue; }
    var css = textOf(file);
    var items = cssPurge.scan(css), imports = [];
    while (items.length && items[0].kind === 'at' && (items[0].name === 'import' || items[0].name === 'charset')) {
      var it = items.shift();
      if (it.name === 'import') imports.push(it);
    }
    /* an @import with a media list or a layer stays where it is: it is not a plain stylesheet link */
    if (imports.some(function (im) { return !/^@import\s+(?:url\(\s*['"]?[^'")\s]+['"]?\s*\)|['"][^'"]+['"])\s*$/i.test(im.prelude); })) { extraCss.push(css); continue; }
    var rest = css.slice(css.length - restLength(css, imports));
    /* cut down to what the page uses when it is big; comments (notes to the template's maintainers) never
       go into the page either way */
    rest = cssPurge.purgeCss(rest, file.size > PURGE_OVER_BYTES ? pageWords() : EVERY_WORD).css;
    /* a relative url() would resolve against the page instead of the stylesheet; "</style" would end the block */
    if (rest.length > INLINE_MAX_BYTES || /<\/style/i.test(rest) || /url\(\s*['"]?(?!['"]?(?:https?:|data:|\/|#))/i.test(rest)) { extraCss.push(css); continue; }
    rest = addFontDisplay(rest);
    var media = attr(t, 'media');
    var hoisted = imports.map(function (im) {
      var url = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)|['"]([^'"]+)['"]/.exec(im.prelude);
      url = url && (url[1] || url[2]);
      return url ? { url: url } : null;
    }).filter(Boolean);
    out[i] = { hoisted: hoisted, media: media, css: rest, from: pathOnly(href) };
    done[i] = true;
    extraCss.push(rest);
  }

  /* ---- 2. Google Fonts: only families the page names ---- */
  var fontText = null;
  function fontContext() {
    if (fontText != null) return fontText;
    var parts = [];
    for (var k = 0; k < tokens.length; k++) {
      if (fontLinks.indexOf(k) !== -1) continue;
      parts.push(typeof out[k] === 'string' ? out[k] : out[k].css);
    }
    fontText = parts.join('') + '\n' + extraCss.join('\n');
    return fontText;
  }
  /* another host's stylesheet: written in when this server has it (remoteCss), else linked */
  var linkedFonts = 0, inlinedFonts = 0;
  function sheetFor(url, media) {
    var m = media ? ' media="' + escAttr(media) + '"' : '', font = isGoogleFontCss(url);
    var css = remoteCss(url);
    if (css != null) {
      if (css.length > PURGE_OVER_BYTES) css = cssPurge.purgeCss(css, pageWords()).css;
      if (css.length <= INLINE_MAX_BYTES) {
        if (font) inlinedFonts++;
        return '<style data-rv-remote="' + escAttr(url) + '"' + m + '>' + css + '</style>';
      }
    }
    if (font) linkedFonts++;
    return '<link rel="stylesheet" href="' + escAttr(url) + '"' + m + '>';
  }
  fontLinks.forEach(function (idx) {
    var families = fontFamilies(attr(tokens[idx], 'href'));
    done[idx] = true;
    if (namesAny(families, fontContext())) { out[idx] = sheetFor(attr(tokens[idx], 'href'), attr(tokens[idx], 'media')); return; }
    out[idx] = '';
    var next = tokens[idx + 1];
    if (next && next.t === 'text' && out[idx + 1].charAt(0) === '\n') out[idx + 1] = out[idx + 1].slice(1);
  });
  for (i = 0; i < tokens.length; i++) {
    if (typeof out[i] === 'string') continue;
    var spec = out[i], links = [];
    spec.hoisted.forEach(function (h) {
      if (isGoogleFontCss(h.url) && !namesAny(fontFamilies(h.url), fontContext())) return;
      /* no icon of that set anywhere on the page (its own .bi-* names, or ET's .fa-* stand-ins) */
      if (/bootstrap-icons/i.test(h.url) && !usesIconClasses()) return;
      links.push(sheetFor(h.url, spec.media));
    });
    out[i] = links.join('') + '<style data-rv-inline="' + escAttr(spec.from) + '"' + (spec.media ? ' media="' + escAttr(spec.media) + '"' : '') + '>' + spec.css + '</style>';
  }

  /* ---- 3. font-display in the page's own stylesheets ---- */
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    if (isOpen(t, 'style') && tokens[i + 1] && tokens[i + 1].t === 'raw' && /@font-face/i.test(out[i + 1])) out[i + 1] = addFontDisplay(out[i + 1]);
  }

  /* ---- 4. the runtime, deferred ---- */
  if (runtimeAt !== -1 && closeAfter(runtimeAt, 'script') !== -1) {
    var otherUser = scripts.some(function (idx) {
      var s = tokens[idx];
      if (idx === runtimeAt || attr(s, 'src') != null || attr(s, 'data-rv-script') != null) return false;
      var type = (attr(s, 'type') || '').toLowerCase();
      if (type && !/^(text|application)\/(javascript|ecmascript)$|^module$/.test(type)) return false;   // data, not code
      return /RevampSections/.test(rawAfter(idx));
    });
    if (!otherUser) {
      var rt = tokens[runtimeAt];
      rt.attrs.push({ name: 'defer', value: null, raw: 'defer' });
      out[runtimeAt] = T.writeTag(rt);
      before[runtimeAt] = RUNTIME_STUB;
    }
  }

  /* ---- 5. our files, by version ---- */
  for (i = 0; i < tokens.length; i++) {
    t = tokens[i];
    if (t.t !== 'open' || done[i]) continue;
    var name = t.name === 'link' ? 'href' : (t.name === 'script' || t.name === 'img') ? 'src' : null;
    if (name) {
      var url = attr(t, name);
      if (url && url.charAt(0) === '/') {
        var v = versioned(url);
        if (v !== url) { T.setAttr(t, name, v); out[i] = T.writeTag(t); }
      }
    }
    /* ---- 6. media this host can never serve ---- */
    if (t.name === 'video' || t.name === 'audio' || t.name === 'source') {
      var dead = false;
      ['src', 'poster'].forEach(function (a) {
        var u = attr(t, a);
        if (u && deadLocalPath(u)) { T.dropAttr(t, a); dead = true; }
      });
      if (dead) {
        if (t.name !== 'source' && attr(t, 'preload') != null) T.setAttr(t, 'preload', 'none');
        out[i] = T.writeTag(t);
      }
    }
  }

  /* ---- hints: the fonts' connections, opened while the page is still arriving ---- */
  if (linkedFonts + inlinedFonts && !/rel=["']?preconnect["']?[^>]*fonts\.gstatic\.com/i.test(html)) {
    var hints = (linkedFonts ? '<link rel="preconnect" href="https://fonts.googleapis.com">' : '') + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
    var hintAt = charsetAt !== -1 && charsetAt > headOpen ? charsetAt : headOpen;
    if (hintAt !== -1) out[hintAt] = out[hintAt] + hints;
  }
  return out.map(function (text, k) { return (before[k] || '') + text; }).join('');
}

/* the length of what follows the leading @charset/@import lines of a stylesheet */
function restLength(css, imports) {
  if (!imports.length) {
    var m = /^\s*(?:@charset[^;]*;\s*)?/i.exec(css);
    return css.length - m[0].length;
  }
  var last = imports[imports.length - 1].raw;
  var end = css.indexOf(last);
  return end === -1 ? css.length : css.length - (end + last.length);
}

/* a root-relative address on this host that can never answer with a file */
function deadLocalPath(u) {
  if (!/^\/(?!\/)/.test(u)) return false;
  var p = pathOnly(u);
  if (/^\/(api|e|preview)\//.test(p)) return false;
  if (!/\.[A-Za-z0-9]{2,5}$/.test(p)) return false;
  return !localFile(p);
}

function escAttr(s) { return String(s).replace(/&(?!amp;|#\d+;|#x[0-9a-f]+;|[a-z]+;)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

module.exports = { deliverPage: deliverPage, assetVersion: assetVersion, versioned: versioned, fontFamilies: fontFamilies,
  addFontDisplay: addFontDisplay, absoluteUrls: absoluteUrls, RUNTIME_STUB: RUNTIME_STUB };
/* for delivery.test.js only: fetch other hosts' stylesheets with `fn(url, done)` instead of the network */
module.exports._testFetch = function (fn) { fetchCss = fn; REMOTE_CSS.clear(); pageCache.clear(); remoteGeneration++; };
