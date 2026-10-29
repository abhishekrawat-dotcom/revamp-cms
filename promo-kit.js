/* Promotions — what every promotional piece of one event is made from, and the tools to make it.

   window.RevampPromo = {
     load(eventId)           -> Promise<Kit>   the event's brand and content, from GET /api/promo/kit (cached)
     image(url)              -> Promise<string> a same-origin blob: URL for any picture of the kit (fetched once
                                through GET /api/promo/image, so a drawing that uses it can be exported to PNG —
                                our Storage bucket and ET's image host send no CORS headers)
     fontsCss(kit)           -> string         <link> tags for the brand's heading and body fonts
     ensureFonts(kit)        -> Promise         their stylesheets arrived and those fonts loaded in this document
                                (document.fonts), so toPng finds their @font-face rules to embed
     toPng(node, w, h, opts?) -> Promise<Blob> the node drawn at exactly w × h (vendored html-to-image). With no
                                opts: a PNG at pixelRatio 1, as every post download has always been made.
                                opts = { pixelRatio, type, quality }: pixelRatio 2 draws it twice as sharp (the
                                mail banner: 750 px wide in the mail, 1500 px in the file); type 'image/jpeg' (or
                                'image/webp') with quality 0..1 encodes that instead of a PNG
     download(blob, name)                      saves a file
     zip(files, name)        -> Promise        files = [{ name, blob|text }] saved as one .zip (vendored JSZip)
     esc(s), colour helpers: lum(hex), contrast(a, b), mix(a, b, t), readableOn(bg) -> '#ffffff'|'#14161b'
     save(kind, item)        -> Promise<{id}>  a post or a mailer kept for the event (promo-templates records:
                                kind 'post' | 'email'; the piece's settings travel as JSON in `body`)
     list(kind)              -> Promise<[item]>  the saved ones, newest first; item.config is the parsed body
     remove(id)              -> Promise
     write(task, input)      -> Promise<{text|options}>  copy by the AI (POST /api/promo/write); see the route
     isExample(x)            -> boolean        x (a string, or anything JSON can hold) carries example content
   }

   Example content (owner decision B). A preview card of a piece the event has no data for yet may be filled with
   made-up people, partners and lists from one shared library (/assets/promo-examples/, ids "ex-p01", "ex-l01",
   "ex-s1"; functions/lib/promo-examples.js). Such content must never leave a preview: toPng refuses a drawing that
   is or holds a [data-example] node (promo-posts.js marks the root of every drawing of an example Kit) or a picture
   loaded from the library (its blob: URL from image(), or its own address); the library's plain lists (numbers,
   who should attend, topics) carry no marker of their own and are caught by that root mark. save and zip refuse
   anything carrying the library's address or one of its ids, with "Example content can never be saved or
   downloaded." (error code 'example'). The server refuses the same markers on every path (isExample in lib/promo-examples.js, whose rules
   these mirror); this is only the browser's own check, so a slip is caught before anything is sent.

   Kit (the contract with functions/lib/promo.js — keep the two in step):
   {
     event:   { id, name, category, start, end, dateLabel, place, venue, city, description, siteUrl, registerUrl,
                published, hashtag, edition },
     brand:   { kind: 'generated'|'ported'|'unknown', mode: 'light'|'dark',
                colours: { theme, accent, background, surface, text, muted, heading, onTheme },
                fonts: { heading: { family, stack, cssUrl }, body: { family, stack, cssUrl } },
                radius,                                   // e.g. '12px'
                logoUnit: { url, darkUrl, width, height, tone: 'dark'|'light' } | null,   // the site's own lock-up;
                                                          // darkUrl: its own copy for a dark ground, or '' (never a
                                                          // recolouring of ours: the ET red square stays as drawn)
                eventLogoUrl, heroImageUrl, pictures: [url],                      // the site's own pictures
                logoUnitParts: { before, keyword, after } },                       // to set the name when there is no unit
     content: { overview, speakers: [{ id, name, designation, company, photoUrl, group }],
                partners: [{ id, name, logoUrl, tier, url }],
                sessions: [{ id, title, start, end, day, speakers: [name] }],
                audience: [text], topics: [text], stats: [{ value, label }],
                contacts: [{ label, name, email, phone }], social: [{ kind, url }] }
   }
   Nothing in the kit is invented: a list the event has no data for is empty, and the screens say so. */
(function () {
  'use strict';
  var C = window.RevampCore;
  var kits = {}, blobs = {};

  function api(method, url, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.RevampAuth.authedFetch(url, opts).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var err = new Error((data && data.error) || ('The server answered ' + r.status + '.'));
          err.status = r.status; err.code = data && data.code;
          throw err;
        }
        return data;
      });
    });
  }

  function load(eventId, fresh) {
    if (!fresh && kits[eventId]) return kits[eventId];
    kits[eventId] = api('GET', '/api/promo/kit?eventId=' + encodeURIComponent(eventId)).then(null, function (err) {
      delete kits[eventId];
      throw err;
    });
    return kits[eventId];
  }

  var currentEvent = '';
  /* the blob: URLs made of pictures from the example library: a drawing holding one is an example (drawsExample),
     even though its <img> no longer shows the library's address */
  var exampleBlobs = {};
  /* a failed answer keeps its status, so a caller can tell a picture that is gone (404) from one that may come */
  function notLoaded(message, status) {
    var err = new Error(message);
    err.status = status;
    return err;
  }
  function image(url) {
    url = String(url || '');
    if (!url) return Promise.resolve('');
    if (/^(blob:|data:)/.test(url)) return Promise.resolve(url);
    if (blobs[url]) return blobs[url];
    var abs = /^\//.test(url) ? location.origin + url : url;
    /* our own files are same-origin already */
    if (abs.indexOf(location.origin + '/') === 0) {
      blobs[url] = fetch(abs).then(function (r) { if (!r.ok) throw notLoaded('missing', r.status); return r.blob(); }).then(function (b) { return URL.createObjectURL(b); });
    } else {
      blobs[url] = window.RevampAuth.authedFetch('/api/promo/image?eventId=' + encodeURIComponent(currentEvent) + '&url=' + encodeURIComponent(abs))
        .then(function (r) { if (!r.ok) throw notLoaded('The picture could not be loaded (' + r.status + ').', r.status); return r.blob(); })
        .then(function (b) { return URL.createObjectURL(b); });
    }
    var fromLibrary = EXAMPLE_PATH_RE.test(url);
    blobs[url] = blobs[url].then(function (b) {
      if (fromLibrary) exampleBlobs[b] = 1;
      return b;
    }, function (err) { delete blobs[url]; throw err; });
    return blobs[url];
  }

  function fontsCss(kit) {
    var f = (kit && kit.brand && kit.brand.fonts) || {}, seen = {}, out = '';
    [f.heading, f.body].forEach(function (x) {
      if (x && x.cssUrl && !seen[x.cssUrl]) { seen[x.cssUrl] = 1; out += '<link rel="stylesheet" href="' + esc(x.cssUrl) + '">'; }
    });
    return out;
  }
  /* Kit font stylesheets this page asked for: address → a promise settled once that <link> has loaded or failed.
     document.fonts.load() asked before the stylesheet has arrived matches no @font-face and resolves at once, so a
     drawing made right after ensureFonts (the mail banner, which is then kept; a first card) found no font rules to
     embed and came out in a fallback face. */
  var fontSheets = {};
  function ensureFonts(kit) {
    var f = (kit && kit.brand && kit.brand.fonts) || {}, sheets = [];
    [f.heading, f.body].forEach(function (x) {
      if (!x || !x.cssUrl) return;
      if (fontSheets[x.cssUrl]) { sheets.push(fontSheets[x.cssUrl]); return; }
      if (document.querySelector('link[data-promo-font="' + x.cssUrl + '"]')) return;
      var l = document.createElement('link');
      /* asked for with CORS (Google's font CSS allows it), so the PNG maker can read its rules and embed the fonts */
      l.rel = 'stylesheet'; l.crossOrigin = 'anonymous'; l.href = x.cssUrl; l.setAttribute('data-promo-font', x.cssUrl);
      /* waited for only where the browser reports it (a <link> with a sheet property and load / error events) */
      if ('sheet' in l && typeof l.addEventListener === 'function') {
        fontSheets[x.cssUrl] = new Promise(function (ok) { l.addEventListener('load', ok); l.addEventListener('error', ok); });
        sheets.push(fontSheets[x.cssUrl]);
      }
      document.head.appendChild(l);
    });
    if (!document.fonts || !document.fonts.load) return Promise.all(sheets);
    return Promise.all(sheets).then(function () {
      var wants = [];
      [f.heading, f.body].forEach(function (x) {
        if (!x || !x.family) return;
        ['400', '600', '700', '800'].forEach(function (w) { wants.push(document.fonts.load(w + ' 32px "' + x.family + '"').catch(function () {})); });
      });
      return Promise.all(wants);
    }).then(function () { return document.fonts.ready; });
  }

  /* ---------------- example content: the browser's own guard (see the header) ---------------- */
  /* the same three markers as the server's isExample (lib/promo-examples.js): the library's address in a URL (also
     URL-encoded or JSON-escaped), one of its ids as a quoted value (\x60 is the backtick), and the example meta /
     label marker */
  var EXAMPLE_PATH_RE = /assets(?:\\?\/|%2F)promo-examples(?:\\?\/|%2F)/i;
  var EXAMPLE_ID_RE = /(?:["'\x60]|&quot;|&#0*3[49];|&#x0*2[27];)ex-[pls]\d+(?![A-Za-z0-9_-])/;
  var EXAMPLE_META_RE = /oneworld-example/i;
  var EXAMPLE_REFUSED = 'Example content can never be saved or downloaded.';
  function textOf(x) {
    if (x == null) return '';
    if (typeof x === 'string') return x;
    if (typeof x !== 'object') return '';
    try { return JSON.stringify(x) || ''; } catch (e) { return ''; }
  }
  function isExample(x) {
    var s = textOf(x);
    return !!s && (EXAMPLE_PATH_RE.test(s) || EXAMPLE_ID_RE.test(s) || EXAMPLE_META_RE.test(s));
  }
  function exampleRefused() {
    var err = new Error(EXAMPLE_REFUSED);
    err.code = 'example';
    return err;
  }
  /* a drawing made from example content: promo-posts.js writes data-example on the root of every drawing of an
     example Kit (postHtml), and, should a drawing ever lack that mark, a picture from the library is caught by
     itself: by the blob: URL image() made of it, or by its own address */
  function drawsExample(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hasAttribute && node.hasAttribute('data-example')) return true;
    if (!node.querySelector) return false;
    if (node.querySelector('[data-example]')) return true;
    var imgs = node.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var src = String(imgs[i].getAttribute('src') || '');
      if (exampleBlobs[src] || EXAMPLE_PATH_RE.test(src)) return true;
    }
    return false;
  }

  /* exactly w × h, whatever the node is shown at on the page. With no opts (every post download) it is what it has
     always been: a PNG at pixelRatio 1. opts.pixelRatio draws more pixels per CSS pixel; opts.type 'image/jpeg' or
     'image/webp' goes through toCanvas and the canvas's own encoder, because the vendored toBlob only writes PNG. */
  function toPng(node, w, h, o) {
    var H = window.htmlToImage;
    if (!H) return Promise.reject(new Error('The picture maker did not load. Reload the page.'));
    if (drawsExample(node)) return Promise.reject(exampleRefused());
    o = o || {};
    var ratio = +o.pixelRatio > 0 ? +o.pixelRatio : 1;
    var type = o.type === 'image/jpeg' || o.type === 'image/webp' ? o.type : 'image/png';
    var opts = { width: w, height: h, pixelRatio: ratio, cacheBust: false, style: { transform: 'none', transformOrigin: '0 0', margin: '0' } };
    var made;
    if (type === 'image/png') {
      /* the first pass loads the fonts and pictures into the drawing; the second is the one that is kept */
      made = H.toBlob(node, opts).then(function () { return H.toBlob(node, opts); });
    } else {
      if (typeof H.toCanvas !== 'function') return Promise.reject(new Error('The picture maker did not load. Reload the page.'));
      var quality = +o.quality > 0 && +o.quality <= 1 ? +o.quality : 0.92;
      /* two passes here too, for the same reason */
      made = H.toCanvas(node, opts).then(function () { return H.toCanvas(node, opts); }).then(function (canvas) {
        return encode(canvas, type, quality);
      });
    }
    return made.then(function (blob) {
      if (!blob) throw new Error('The picture could not be made.');
      return blob;
    });
  }
  /* a canvas as a Blob of that type (toDataURL where a browser has no canvas.toBlob) */
  function encode(canvas, type, quality) {
    if (!canvas) return Promise.resolve(null);
    if (typeof canvas.toBlob === 'function') {
      return new Promise(function (resolve) { canvas.toBlob(function (b) { resolve(b || null); }, type, quality); });
    }
    var url = canvas.toDataURL(type, quality), bin = atob(url.split(',')[1] || ''), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return Promise.resolve(new Blob([bytes], { type: type }));
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 20000);
  }
  function zip(files, name) {
    if (!window.JSZip) return Promise.reject(new Error('The zip maker did not load. Reload the page.'));
    /* a file's own bytes are pictures made by toPng, which refuses example drawings; its name and any text are
       looked at here */
    if (isExample(name) || (files || []).some(function (f) { return isExample(f && f.name) || isExample(f && f.text); })) {
      return Promise.reject(exampleRefused());
    }
    var z = new window.JSZip();
    files.forEach(function (f) { z.file(f.name, f.blob || f.text || ''); });
    return z.generateAsync({ type: 'blob' }).then(function (b) { download(b, name); });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hexRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.replace(/./g, function (c) { return c + c; });
    var n = parseInt(h, 16);
    return isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lum(hex) {
    return hexRgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) {
    var p = hexRgb(a), q = hexRgb(b);
    return '#' + p.map(function (v, i) { return ('0' + Math.round(v + (q[i] - v) * t).toString(16)).slice(-2); }).join('');
  }
  function readableOn(bg) { return contrast('#ffffff', bg) >= contrast('#14161b', bg) ? '#ffffff' : '#14161b'; }

  var KIND = { post: 'post', email: 'email' };
  function save(kind, item) {
    /* the server refuses it too (api.js checkPromoBody); refused here before anything is sent */
    if (isExample(item)) return Promise.reject(exampleRefused());
    var body = { kind: KIND[kind] || kind, name: String(item.name || 'Untitled').slice(0, 120), body: JSON.stringify(item.config || {}) };
    if (item.subject != null) body.subject = String(item.subject).slice(0, 200);
    if (item.imageUrl) body.imageUrl = item.imageUrl;
    if (item.id) return C.updateSub('promo-templates', currentEvent, item.id, { name: body.name, body: body.body, subject: body.subject, imageUrl: body.imageUrl }).then(function () { return { id: item.id }; });
    return C.createSub('promo-templates', currentEvent, body);
  }
  function list(kind) {
    return C.fetchSub('promo-templates', currentEvent).then(function (items) {
      return items.filter(function (i) { return i.kind === (KIND[kind] || kind); }).map(function (i) {
        var config = {};
        try { config = JSON.parse(i.body || '{}'); } catch (e) { config = {}; }
        return Object.assign({}, i, { config: config });
      }).sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
    });
  }
  function remove(id) { return C.deleteSub('promo-templates', currentEvent, id); }
  function write(task, input) { return api('POST', '/api/promo/write', Object.assign({ eventId: currentEvent, task: task }, input || {})); }

  window.RevampPromo = {
    use: function (eventId) { currentEvent = String(eventId || ''); },
    load: function (eventId, fresh) { currentEvent = String(eventId || ''); return load(currentEvent, fresh); },
    image: image, fontsCss: fontsCss, ensureFonts: ensureFonts, toPng: toPng, download: download, zip: zip,
    esc: esc, lum: lum, contrast: contrast, mix: mix, readableOn: readableOn,
    save: save, list: list, remove: remove, write: write, isExample: isExample
  };
})();
