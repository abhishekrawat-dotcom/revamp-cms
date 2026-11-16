/* create-deck.js — Create Event follows the owner's own presentation: window.CreateDeck (ES5). CREATE-FROM-DECK.md;
   owner, 16 Nov 2026, ET DAVOS 2027: "design it according to the uploaded presentation".

   When a PDF is chosen at Create Event, its photos are taken out here at once, in the background, by the same reader
   the site editor's ETB2B AI uses (pdf-reader.js → the vendored PDF.js → ai-doc-pictures.js: photographs only, no
   masks, logos, strips or repeats, at most 32, each at most 1600 px with a 400 px copy). Nothing is sent until the
   owner ticks "Follow this presentation's look and photos" (it starts unticked: owner decision, 16 Nov 2026) and
   presses Generate: then the photos are kept with the event (POST /api/chat/doc-pictures, purpose 'brief', under
   events/<id>/brief-photos/) and, with a render of each key slide, given to POST /api/brief-photos, which has each
   photo looked at once and keeps the list beside the brief.

     CreateDeck.read(file, o)       -> Promise<READ>  the photos taken out (o.onProgress(text)); rejects with a sentence
         READ: { name, pages, pageW, pageH, pictures: [{ page, w, h, share, words, full, thumb (Blobs) }], leftOut,
                 looksLikeDeck, bytes (an ArrayBuffer of the file, for the slides) }
     CreateDeck.looksLikeDeck(r)    -> true for a designed presentation: at least 6 pages, landscape, 3 photos kept
     CreateDeck.wantsDeck(text)     -> 'on' | 'off' | ''  the Instructions ask for the presentation (the server's
                                       deck-follow.js wantsDeck: deck-follow.test.js checks the two agree). Only a hint
                                       points to the switch; the words never tick it.
     CreateDeck.keyPages(r, deckPages) -> [page]  the key slides: the cover and the content pages (the brief's
                                       deckPages, when read), else the first twelve
     CreateDeck.slides(r, pages, px) -> Promise<[{ page, data (base64 JPEG) }]>  each at most 200 KB
     CreateDeck.store(eventId, runId, briefId, r, o) -> Promise<{ kept, held, leftOut, line }>  o: { fetch (an
                                       authorised fetch), deckPages, onProgress }. A retry sends again only what is not
                                       stored yet (r.stored keeps what was).
     CreateDeck.leftOutText(lo, kept) -> 'Left out: …' (the reader's own words)

   It loads /pdf-reader.js, /ai-doc-pictures.js and /ai-docs-client.js once, when first needed. */
(function (root) {
  'use strict';
  if (root.CreateDeck) return;

  var CAPS = { slidePx: 640, slideQuality: 0.7, slideBytes: 200 * 1024, slides: 24, keyFallback: 12, deckPages: 6, deckPhotos: 3 };
  var NOUN = '(?:presentation|deck|pdf|ppt|pptx|slides?|brochure|document|uploaded|attached)';
  var ON_RE = new RegExp('\\b(?:according to|as per|like|same(?:\\s+\\w+){0,2}\\s+as|follow(?:s|ing|ed)?|based on|match(?:es|ing)?|in line with|similar to|from|use|using)\\b[^.!?\\n]{0,40}?\\b' + NOUN + '\\b', 'i');
  var OFF_RE = new RegExp('\\b(?:don\'t|dont|do not|never|not|ignore)\\b[^.!?\\n]{0,20}?\\b' + NOUN + '\\b|\\b(?:own|fresh) design\\b', 'i');

  function wantsDeck(text) {
    var t = String(text == null ? '' : text).replace(/[\u2018\u2019\u02bc]/g, '\'').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (OFF_RE.test(t)) return 'off';
    return ON_RE.test(t) ? 'on' : '';
  }

  var scripts = {};
  function scriptOnce(src, global) {
    if (root[global]) return Promise.resolve(root[global]);
    if (scripts[src]) return scripts[src];
    scripts[src] = new Promise(function (resolve, reject) {
      var s = root.document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { if (root[global]) resolve(root[global]); else { scripts[src] = null; reject(new Error('no-script')); } };
      s.onerror = function () { scripts[src] = null; reject(new Error('no-script')); };
      (root.document.head || root.document.documentElement).appendChild(s);
    });
    return scripts[src];
  }
  var NOT_LOADED = 'Its photos could not be read here; pictures will be made for the site.';
  function readers() {
    return scriptOnce('/pdf-reader.js', 'RevampPdf')
      .then(function () { return scriptOnce('/ai-doc-pictures.js', 'RevampDocPictures'); })
      .then(function () { return scriptOnce('/ai-docs-client.js', 'RevampAiDocs'); })
      .then(null, function () { throw new Error(NOT_LOADED); });
  }
  function bytesOf(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new root.FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('read')); };
      r.readAsArrayBuffer(file);
    });
  }
  function nameOf(file) { return String((file && file.name) || 'presentation.pdf').split(/[\\/]/).pop().replace(/\s+/g, ' ').trim().slice(0, 120) || 'presentation.pdf'; }

  function looksLikeDeck(r) {
    return !!r && (r.pages || 0) >= CAPS.deckPages && (r.pageW || 0) >= (r.pageH || 1) && (r.pictures || []).length >= CAPS.deckPhotos;
  }

  function read(file, o) {
    o = o || {};
    var buf = null;
    return readers().then(function () { return bytesOf(file); }).then(function (b) {
      buf = b;
      /* PDF.js takes over the bytes it is given: it reads a copy, and this one stays for the slides */
      return root.RevampDocPictures.fromPdf(new Uint8Array(b.slice(0)), { onProgress: o.onProgress, name: nameOf(file) });
    }).then(function (got) {
      var r = { name: nameOf(file), pages: got.pages || 0, pageW: got.pageW || 0, pageH: got.pageH || 0, pictures: got.pictures || [], leftOut: got.leftOut || {}, bytes: buf };
      r.looksLikeDeck = looksLikeDeck(r);
      return r;
    }, function (err) { throw new Error(err && err.message === NOT_LOADED ? NOT_LOADED : 'Its photos could not be read here; pictures will be made for the site.'); });
  }

  /* the cover, the content pages and the closing one, as the brief read them; else the first twelve */
  function keyPages(r, deckPages) {
    var n = (r && r.pages) || 0, out = [];
    (Array.isArray(deckPages) ? deckPages : []).forEach(function (p) {
      if (p && p.page >= 1 && p.page <= n && ['cover', 'content', 'closing'].indexOf(p.kind) !== -1 && out.indexOf(p.page) === -1) out.push(p.page);
    });
    if (!out.length) for (var i = 1; i <= Math.min(n, CAPS.keyFallback); i++) out.push(i);
    return out.slice(0, CAPS.slides);
  }
  function jpegOf(canvas, q) {
    var url = canvas.toDataURL('image/jpeg', q);
    return url.replace(/^data:image\/jpeg;base64,/, '');
  }
  function slides(r, pages, px) {
    px = px || CAPS.slidePx;
    if (!r || !r.bytes || !pages || !pages.length) return Promise.resolve([]);
    var R = root.RevampPdf, pdf = null, out = [];
    return R.open(new Uint8Array(r.bytes.slice(0))).then(function (d) {
      pdf = d;
      return pages.reduce(function (p, num) {
        return p.then(function () {
          if (num > pdf.numPages) return null;
          return pdf.getPage(num).then(function (page) {
            return R.renderPage(page, px).then(function (canvas) {
              var data = jpegOf(canvas, CAPS.slideQuality);
              if (data.length * 0.75 > CAPS.slideBytes) data = jpegOf(canvas, 0.5);
              if (data.length * 0.75 <= CAPS.slideBytes) out.push({ page: num, data: data });
              canvas.width = canvas.height = 0;
              try { page.cleanup(); } catch (e) { /* freed with the document */ }
            });
          }).then(null, function () { return null; });   // a page that cannot be drawn is left out
        });
      }, Promise.resolve());
    }).then(function () {
      try { pdf.destroy(); } catch (e) { /* gone */ }
      return out;
    }, function () {
      if (pdf) { try { pdf.destroy(); } catch (e) { /* gone */ } }
      return out;
    });
  }

  function say(o, t) { if (o && typeof o.onProgress === 'function') { try { o.onProgress(t); } catch (e) { /* the page's own */ } } }
  function store(eventId, runId, briefId, r, o) {
    o = o || {};
    if (!r || !(r.pictures || []).length) return Promise.reject(new Error('Your presentation has no photos to keep.'));
    var send = o.fetch;
    var kept = r.stored ? Promise.resolve(r.stored) : readers().then(function () {
      var doc = { name: r.name, pictures: r.pictures.slice(), leftOut: Object.assign({}, r.leftOut) };
      return root.RevampAiDocs.storePictures(eventId, doc, { fetch: send, onProgress: o.onProgress, purpose: 'brief', briefId: briefId, runId: runId });
    }).then(function (doc) { r.stored = doc; return doc; });
    return kept.then(function (doc) {
      say(o, 'Reading its key pages…');
      return slides(r, keyPages(r, o.deckPages)).then(function (sl) {
        say(o, 'Checking the photos…');
        return send('/api/brief-photos', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: eventId, runId: runId, briefId: briefId, key: doc.key, doc: r.name, leftOut: doc.leftOut || {},
            pictures: doc.pictures.map(function (p) { return { url: p.url, thumb: p.thumb, page: p.page, w: p.w, h: p.h, share: p.share, words: p.words }; }),
            slides: sl })
        });
      });
    }).then(function (res) {
      return res.text().then(function (t) {
        var body = null;
        try { body = JSON.parse(t); } catch (e) { /* an error page in front of the API */ }
        if (!res.ok || !body) {
          var err = new Error(body && typeof body.error === 'string' ? body.error : 'The photos from your presentation could not be kept. Retry.');
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  var LEFT = { plain: ['mask', 'masks'], small: ['logo or icon', 'logos or icons'], flat: ['flat graphic', 'flat graphics'], strip: ['strip', 'strips'], repeat: ['repeat', 'repeats'], unread: ['unreadable picture', 'unreadable pictures'], unstored: ['picture not kept', 'pictures not kept'] };
  function leftOutText(lo) {
    lo = lo || {};
    var total = 0, parts = [];
    Object.keys(LEFT).forEach(function (k) { var n = +lo[k] || 0; if (n > 0) { total += n; parts.push(LEFT[k][1]); } });
    return total ? total + ' left out (' + parts.slice(0, 3).join(', ') + ')' : '';
  }

  root.CreateDeck = { CAPS: CAPS, read: read, looksLikeDeck: looksLikeDeck, wantsDeck: wantsDeck, keyPages: keyPages, slides: slides, store: store, leftOutText: leftOutText,
    _test: { ON_RE: ON_RE, OFF_RE: OFF_RE } };
})(typeof window !== 'undefined' ? window : this);
