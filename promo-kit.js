/* Promotions — what every promotional piece of one event is made from, and the tools to make it.

   window.RevampPromo = {
     load(eventId)           -> Promise<Kit>   the event's brand and content, from GET /api/promo/kit (cached)
     image(url)              -> Promise<string> a same-origin blob: URL for any picture of the kit (fetched once
                                through GET /api/promo/image, so a drawing that uses it can be exported to PNG —
                                our Storage bucket and ET's image host send no CORS headers)
     fontsCss(kit)           -> string         <link> tags for the brand's heading and body fonts
     ensureFonts(kit)        -> Promise         those fonts loaded in this document (document.fonts)
     toPng(node, w, h)       -> Promise<Blob>  the node drawn as a PNG at exactly w × h (vendored html-to-image)
     download(blob, name)                      saves a file
     zip(files, name)        -> Promise        files = [{ name, blob|text }] saved as one .zip (vendored JSZip)
     esc(s), colour helpers: lum(hex), contrast(a, b), mix(a, b, t), readableOn(bg) -> '#ffffff'|'#14161b'
     save(kind, item)        -> Promise<{id}>  a post or a mailer kept for the event (promo-templates records:
                                kind 'post' | 'email'; the piece's settings travel as JSON in `body`)
     list(kind)              -> Promise<[item]>  the saved ones, newest first; item.config is the parsed body
     remove(id)              -> Promise
     write(task, input)      -> Promise<{text|options}>  copy by the AI (POST /api/promo/write); see the route
   }

   Kit (the contract with functions/lib/promo.js — keep the two in step):
   {
     event:   { id, name, category, start, end, dateLabel, place, venue, city, description, siteUrl, registerUrl,
                published, hashtag, edition },
     brand:   { kind: 'generated'|'ported'|'unknown', mode: 'light'|'dark',
                colours: { theme, accent, background, surface, text, muted, heading, onTheme },
                fonts: { heading: { family, stack, cssUrl }, body: { family, stack, cssUrl } },
                radius,                                   // e.g. '12px'
                logoUnit: { url, width, height, tone: 'dark'|'light' } | null,   // the site's own lock-up
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
  function image(url) {
    url = String(url || '');
    if (!url) return Promise.resolve('');
    if (/^(blob:|data:)/.test(url)) return Promise.resolve(url);
    if (blobs[url]) return blobs[url];
    var abs = /^\//.test(url) ? location.origin + url : url;
    /* our own files are same-origin already */
    if (abs.indexOf(location.origin + '/') === 0) {
      blobs[url] = fetch(abs).then(function (r) { if (!r.ok) throw new Error('missing'); return r.blob(); }).then(function (b) { return URL.createObjectURL(b); });
    } else {
      blobs[url] = window.RevampAuth.authedFetch('/api/promo/image?eventId=' + encodeURIComponent(currentEvent) + '&url=' + encodeURIComponent(abs))
        .then(function (r) { if (!r.ok) throw new Error('The picture could not be loaded (' + r.status + ').'); return r.blob(); })
        .then(function (b) { return URL.createObjectURL(b); });
    }
    blobs[url] = blobs[url].then(null, function (err) { delete blobs[url]; throw err; });
    return blobs[url];
  }

  function fontsCss(kit) {
    var f = (kit && kit.brand && kit.brand.fonts) || {}, seen = {}, out = '';
    [f.heading, f.body].forEach(function (x) {
      if (x && x.cssUrl && !seen[x.cssUrl]) { seen[x.cssUrl] = 1; out += '<link rel="stylesheet" href="' + esc(x.cssUrl) + '">'; }
    });
    return out;
  }
  function ensureFonts(kit) {
    var f = (kit && kit.brand && kit.brand.fonts) || {};
    [f.heading, f.body].forEach(function (x) {
      if (!x || !x.cssUrl || document.querySelector('link[data-promo-font="' + x.cssUrl + '"]')) return;
      var l = document.createElement('link');
      /* asked for with CORS (Google's font CSS allows it), so the PNG maker can read its rules and embed the fonts */
      l.rel = 'stylesheet'; l.crossOrigin = 'anonymous'; l.href = x.cssUrl; l.setAttribute('data-promo-font', x.cssUrl);
      document.head.appendChild(l);
    });
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var wants = [];
    [f.heading, f.body].forEach(function (x) {
      if (!x || !x.family) return;
      ['400', '600', '700', '800'].forEach(function (w) { wants.push(document.fonts.load(w + ' 32px "' + x.family + '"').catch(function () {})); });
    });
    return Promise.all(wants).then(function () { return document.fonts.ready; });
  }

  /* exactly w × h, whatever the node is shown at on the page */
  function toPng(node, w, h) {
    var H = window.htmlToImage;
    if (!H) return Promise.reject(new Error('The picture maker did not load. Reload the page.'));
    var opts = { width: w, height: h, pixelRatio: 1, cacheBust: false, style: { transform: 'none', transformOrigin: '0 0', margin: '0' } };
    /* the first pass loads the fonts and pictures into the drawing; the second is the one that is kept */
    return H.toBlob(node, opts).then(function () { return H.toBlob(node, opts); }).then(function (blob) {
      if (!blob) throw new Error('The picture could not be made.');
      return blob;
    });
  }

  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 20000);
  }
  function zip(files, name) {
    if (!window.JSZip) return Promise.reject(new Error('The zip maker did not load. Reload the page.'));
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
    save: save, list: list, remove: remove, write: write
  };
})();
