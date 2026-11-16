/* ai-doc-pictures.js — the pictures inside a PDF or a PowerPoint deck a person attaches to ETB2B AI in the site editor,
   taken out here in the browser (the owner, 16 Nov 2026: "use the images from this pdf and try to well accommodate them
   in this website. currently the website have very less images"). window.RevampDocPictures (ES5), loaded by
   ai-docs-client.js the first time a document's pictures are wanted.

   A PDF is read with PDF.js (pdf-reader.js, the vendored library): each page's drawing instructions name the pictures
   it paints and where (so how much of the page each covers), and PDF.js hands each one over decoded; the page's words
   come with it. A deck's pictures are its slides' own (ppt/media, through each slide's relationships), handed here by
   ai-docs-client.js, which reads the deck with JSZip.

   KEPT: photographs. LEFT OUT, and counted so the person is told:
     small    under 400 px on the short side, or drawn on less than 3% of its page (icons, logos, thumbnails)
     strip    more than 4 times as wide as tall, or as tall as wide (rules, ribbons)
     plain    near one colour, or mostly see-through (the solid black masks and overlays a deck lays over its photos)
     flat     a handful of colours (a logo on a coloured ground, a chart, a diagram)
     repeat   the same picture again — the same object on another page, or one that looks the same (a deck's
              background on every slide): kept once, where it first appears
     over     past the cap (32): each page's largest is kept first, then the largest of the rest
     unread   one PDF.js or the browser could not decode
   Each picture kept: a JPEG at most 1600 px on its long side, for placing on the page; a small JPEG (at most 400 px)
   for ETB2B AI to look at; its page, how much of the page it covers, and that page's first words.

     RevampDocPictures.fromPdf(bytes, o) -> Promise<{ pages, text, cut, pictures, leftOut, pagesRead, pageW, pageH (the first page's size) }>
         bytes: a Uint8Array (PDF.js takes it over: pass a copy you still need). o: { onProgress(text), words: true to
         read every page's words too (a document too large to send as a file), name: for the progress lines }
         text: 'Page 1:\n…\n\nPage 2:\n…' (words: true) — cut: true when it was cut to CAPS.textChars
     RevampDocPictures.fromImages(list, o) -> Promise<{ pictures, leftOut }>   list: [{ page, blob, words }] (a deck's)
     RevampDocPictures.leftOutSentence(leftOut, kept) -> 'Left out: …' | ''
     RevampDocPictures.CAPS
     picture: { page, w, h, share (0-1, or null), full: Blob (JPEG), thumb: Blob (JPEG), words }
     _test: the pure parts (statsOf, hashOf, hamming, paintedImages, choose, fit, verdict), for
            functions/lib/doc-pictures.test.js

   ES5 on purpose: it loads as a plain script on pages that are not bundled. */
(function (root) {
  'use strict';

  var CAPS = {
    keep: 32,              // pictures kept from one document (ETB2B AI sees them on two sheets of sixteen)
    pages: 80,             // pages whose pictures are taken out
    textPages: 400,        // pages whose words are read, for a document too large to send
    minSide: 400,          // smaller than this on its short side: an icon, a logo or a thumbnail
    minShare: 0.03,        // drawn on less than this much of its page: the same
    strip: 4,              // more than this many times as long as it is wide: a rule or a ribbon
    plainSd: 9,            // the spread of its brightness (0-255) under which a picture is one plain colour
    seeThrough: 0.8,       // this much of it see-through: a mask or an overlay
    flatColours: 12,       // colours (16 levels a channel) covering 95% of it, at most: a flat graphic
    repeatBits: 6,         // two pictures whose 64-bit difference hashes differ in at most this many bits are one
    fullPx: 1600, fullQuality: 0.85,
    thumbPx: 400, thumbQuality: 0.72,
    pageWords: 2000,       // characters of a page's words kept for the document's text
    pictureWords: 300,     // characters of its page's words kept with a picture
    textChars: 40000,      // all of a document's words (ai-docs-client.js CAPS.deckChars, the server's cap)
    decodeMs: 15000        // the longest one picture may take to arrive from PDF.js
  };
  var SAMPLE = 64;         // the picture is looked at this small for the checks above

  function str(v) { return v == null ? '' : String(v); }
  function oneLine(s, max) { s = str(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim(); return max ? s.slice(0, max) : s; }

  /* ---------------------------------------------------------------- pure parts (tested in node) */

  /* What a small sample of a picture says about it. rgba: its pixels (Uint8ClampedArray or array, 4 a pixel).
     -> { sd: spread of brightness over the pixels that show, seeThrough: share of pixels (almost) fully see-through,
          colours: how many colours (16 levels a channel) cover 95% of the pixels that show, hash: hashOf(…) } */
  function statsOf(rgba, w, h) {
    var n = w * h, shown = 0, sum = 0, sum2 = 0, clear = 0, bins = {}, gray = new Array(n);
    for (var i = 0; i < n; i++) {
      var r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
      /* see-through pixels count as white for the hash, as the picture is shown on a white page */
      var k = a / 255, y = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[i] = y * k + 255 * (1 - k);
      if (a < 16) { clear++; continue; }
      shown++;
      sum += y; sum2 += y * y;
      var bin = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      bins[bin] = (bins[bin] || 0) + 1;
    }
    var mean = shown ? sum / shown : 0, sd = shown ? Math.sqrt(Math.max(0, sum2 / shown - mean * mean)) : 0;
    var counts = Object.keys(bins).map(function (key) { return bins[key]; }).sort(function (x, y2) { return y2 - x; });
    var need = shown * 0.95, got = 0, colours = 0;
    for (var c = 0; c < counts.length && got < need; c++) { got += counts[c]; colours++; }
    return { sd: sd, seeThrough: n ? clear / n : 1, colours: colours, hash: hashOf(gray, w, h) };
  }
  /* A difference hash: the picture's brightness shrunk to 9 x 8 cells, each cell compared with the one to its right.
     64 bits as 16 hex digits; near-equal pictures have near-equal hashes, whatever their size. gray: brightness per pixel. */
  function hashOf(gray, w, h) {
    var cells = [];
    for (var cy = 0; cy < 8; cy++) {
      var y0 = Math.floor(cy * h / 8), y1 = Math.max(y0 + 1, Math.floor((cy + 1) * h / 8));
      for (var cx = 0; cx < 9; cx++) {
        var x0 = Math.floor(cx * w / 9), x1 = Math.max(x0 + 1, Math.floor((cx + 1) * w / 9)), s = 0, k = 0;
        for (var y = y0; y < y1 && y < h; y++) for (var x = x0; x < x1 && x < w; x++) { s += gray[y * w + x]; k++; }
        cells.push(k ? s / k : 0);
      }
    }
    var hex = '';
    for (var row = 0; row < 8; row++) {
      for (var half = 0; half < 2; half++) {
        var nib = 0;
        for (var bit = 0; bit < 4; bit++) {
          var col = half * 4 + bit;
          nib = nib * 2 + (cells[row * 9 + col] > cells[row * 9 + col + 1] ? 1 : 0);
        }
        hex += nib.toString(16);
      }
    }
    return hex;
  }
  var POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  function hamming(a, b) {
    a = str(a); b = str(b);
    if (a.length !== b.length || !a.length) return 64;
    var d = 0;
    for (var i = 0; i < a.length; i++) d += POP[parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16)];
    return d;
  }
  /* Why a picture is left out ('' when it is kept). info: { w, h, share (null when not known), stats (statsOf, or
     null when it is not looked at: the checks that need no pixels come first) } */
  function verdict(info) {
    var w = +info.w || 0, h = +info.h || 0;
    if (!(w > 0 && h > 0)) return 'unread';
    var short = Math.min(w, h), long = Math.max(w, h);
    if (short < CAPS.minSide) return 'small';
    if (long / short > CAPS.strip) return 'strip';
    if (typeof info.share === 'number' && info.share < CAPS.minShare) return 'small';
    var st = info.stats;
    if (!st) return '';
    if (st.seeThrough >= CAPS.seeThrough || st.sd < CAPS.plainSd) return 'plain';
    if (st.colours <= CAPS.flatColours) return 'flat';
    return '';
  }
  /* The largest one: the share of its page it covers when both say, else its pixels. */
  function bigger(a, b) {
    if (typeof a.share === 'number' && typeof b.share === 'number' && a.share !== b.share) return b.share - a.share;
    return (b.w * b.h) - (a.w * a.h);
  }
  /* At most max of the pictures found: each page's largest first (the largest of those when there are more pages than
     room), then the largest of the rest. -> { kept (in page order, then the order found), over: [the rest] } */
  function choose(cands, max) {
    cands = (cands || []).slice();
    if (cands.length <= max) return { kept: cands, over: [] };
    var byPage = {}, firsts = [], rest = [];
    cands.forEach(function (c) { (byPage[c.page] = byPage[c.page] || []).push(c); });
    Object.keys(byPage).forEach(function (p) {
      var list = byPage[p].slice().sort(bigger);
      firsts.push(list[0]);
      rest = rest.concat(list.slice(1));
    });
    var kept = firsts.sort(bigger).slice(0, max);
    if (kept.length < max) kept = kept.concat(rest.sort(bigger).slice(0, max - kept.length));
    var over = cands.filter(function (c) { return kept.indexOf(c) === -1; });
    kept.sort(function (a, b) { return a.page - b.page || a.order - b.order; });
    return { kept: kept, over: over };
  }
  /* w x h shrunk (never grown) to at most max on its long side */
  function fit(w, h, max) {
    var k = Math.min(1, max / Math.max(w, h, 1));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  /* The pictures a page paints, from its drawing instructions (PDF.js getOperatorList), each once, with the share of
     the page it covers at its largest (0-1; null when it cannot be told). The transform in force is followed through
     save / restore, transforms and the forms drawn inside the page. */
  function paintedImages(fnArray, argsArray, OPS, pageW, pageH) {
    var out = [], at = {}, m = [1, 0, 0, 1, 0, 0], stack = [];
    var page = Math.abs(pageW * pageH) || 0;
    function times(a, b) {
      return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    }
    function isMatrix(x) { return !!x && x.length === 6 && [0, 1, 2, 3, 4, 5].every(function (i) { return typeof x[i] === 'number' && isFinite(x[i]); }); }
    var paint = {};
    [OPS.paintImageXObject, OPS.paintImageXObjectRepeat].forEach(function (op) { if (op != null) paint[op] = true; });
    for (var i = 0; i < fnArray.length; i++) {
      var fn = fnArray[i], args = argsArray[i] || [];
      if (fn === OPS.save) stack.push(m.slice());
      else if (fn === OPS.restore) { if (stack.length) m = stack.pop(); }
      else if (fn === OPS.transform) { if (isMatrix(args)) m = times(m, args); }
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(m.slice()); if (isMatrix(args[0])) m = times(m, args[0]); }
      else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) m = stack.pop(); }
      else if (paint[fn]) {
        var name = typeof args[0] === 'string' ? args[0] : '';
        if (!name) continue;
        /* the unit square the picture is drawn into, as the page sees it */
        var area = Math.abs(m[0] * m[3] - m[1] * m[2]);
        var share = page ? Math.min(1, area / page) : null;
        if (fn === OPS.paintImageXObjectRepeat && share != null) {
          /* drawn several times: args [name, scaleX, scaleY, positions] */
          var times2 = Array.isArray(args[3]) ? Math.max(1, args[3].length / 2) : 1;
          share = Math.min(1, share * Math.abs((+args[1] || 1) * (+args[2] || 1)) * times2);
        }
        if (at[name] == null) { at[name] = out.length; out.push({ name: name, share: share }); }
        else if (share != null && (out[at[name]].share == null || share > out[at[name]].share)) out[at[name]].share = share;
      }
    }
    return out;
  }
  var LEFT_WORDS = {
    plain: ['plain background or mask', 'plain backgrounds or masks'],
    small: ['small picture or logo', 'small pictures or logos'],
    flat: ['flat graphic or logo', 'flat graphics or logos'],
    strip: ['thin strip', 'thin strips'],
    repeat: ['repeat', 'repeats'],
    unread: ['picture that could not be read', 'pictures that could not be read']
  };
  function emptyLeftOut() { return { plain: 0, small: 0, flat: 0, strip: 0, repeat: 0, unread: 0, over: 0 }; }
  /* "Left out: 9 plain backgrounds or masks, 4 small pictures or logos, 3 repeats and 2 more past the 32 kept." */
  function leftOutSentence(lo, kept) {
    lo = lo || {};
    var parts = [];
    ['plain', 'small', 'flat', 'strip', 'repeat', 'unread'].forEach(function (k) {
      var n = Math.max(0, parseInt(lo[k], 10) || 0);
      if (n) parts.push(n + ' ' + LEFT_WORDS[k][n === 1 ? 0 : 1]);
    });
    var over = Math.max(0, parseInt(lo.over, 10) || 0);
    if (over) parts.push(over + ' more past the ' + (kept || CAPS.keep) + ' kept');
    if (!parts.length) return '';
    return 'Left out: ' + (parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]) + '.';
  }

  /* ---------------------------------------------------------------- the browser parts */
  function doc() { return root.document || null; }
  function canvas(w, h) { var c = doc().createElement('canvas'); c.width = w; c.height = h; return c; }
  /* something drawImage takes, from what PDF.js hands over: an ImageBitmap, or the decoded pixels (kind 1: one bit a
     pixel, set = white; 2: RGB; 3: RGBA) */
  function drawableOf(img) {
    if (!img || typeof img !== 'object') return null;
    var bm = img.bitmap;
    if (bm && (bm.width || img.width)) return { src: bm, w: bm.width || img.width, h: bm.height || img.height, done: function () { try { if (typeof bm.close === 'function') bm.close(); } catch (e) { /* gone */ } } };
    var w = +img.width || 0, h = +img.height || 0, data = img.data, kind = +img.kind || 0;
    if (!(w > 0 && h > 0) || !data || !data.length) return null;
    var c = canvas(w, h), g = c.getContext('2d'), out = g.createImageData(w, h), px = out.data, n = w * h, i;
    if (kind === 3 && data.length >= n * 4) px.set(data.subarray ? data.subarray(0, n * 4) : data.slice(0, n * 4));
    else if (kind === 2 && data.length >= n * 3) {
      for (i = 0; i < n; i++) { px[i * 4] = data[i * 3]; px[i * 4 + 1] = data[i * 3 + 1]; px[i * 4 + 2] = data[i * 3 + 2]; px[i * 4 + 3] = 255; }
    } else if (kind === 1) {
      var row = (w + 7) >> 3;
      if (data.length < row * h) return null;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var v = (data[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0, o = (y * w + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255;
      }
    } else return null;
    g.putImageData(out, 0, 0);
    return { src: c, w: w, h: h, done: function () { c.width = c.height = 0; } };
  }
  function sampleOf(d) {
    var c = canvas(SAMPLE, SAMPLE), g = c.getContext('2d');
    g.drawImage(d.src, 0, 0, SAMPLE, SAMPLE);
    return statsOf(g.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE, SAMPLE);
  }
  function blobOf(c, quality) {
    return new Promise(function (resolve, reject) {
      try {
        c.toBlob(function (b) { if (b && b.size) resolve(b); else reject(new Error('jpeg')); }, 'image/jpeg', quality);
      } catch (e) { reject(e); }
    });
  }
  /* the picture as a JPEG for placing (on white: a see-through part reads as the page behind it) and a small one */
  function encode(d) {
    var f = fit(d.w, d.h, CAPS.fullPx), big = canvas(f.w, f.h), g = big.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, f.w, f.h);
    g.imageSmoothingEnabled = true;
    try { g.imageSmoothingQuality = 'high'; } catch (e) { /* older browsers smooth anyway */ }
    g.drawImage(d.src, 0, 0, f.w, f.h);
    var t = fit(f.w, f.h, CAPS.thumbPx), small = canvas(t.w, t.h), gs = small.getContext('2d');
    gs.imageSmoothingEnabled = true;
    try { gs.imageSmoothingQuality = 'high'; } catch (e) { /* as above */ }
    gs.drawImage(big, 0, 0, t.w, t.h);
    return Promise.all([blobOf(big, CAPS.fullQuality), blobOf(small, CAPS.thumbQuality)]).then(function (b) {
      big.width = big.height = 0; small.width = small.height = 0;
      return { w: f.w, h: f.h, full: b[0], thumb: b[1] };
    });
  }
  /* One picture looked at: left out (counted in lo), or a candidate { page, order, w, h, share, words, hash, full, thumb }. */
  function consider(d, page, order, share, words, cands, lo) {
    var why = verdict({ w: d.w, h: d.h, share: share });
    if (!why) {
      var st = null;
      try { st = sampleOf(d); } catch (e) { why = 'unread'; }
      if (st) {
        why = verdict({ w: d.w, h: d.h, share: share, stats: st });
        if (!why && cands.some(function (c) { return hamming(c.hash, st.hash) <= CAPS.repeatBits; })) why = 'repeat';
      }
      if (!why) {
        return encode(d).then(function (e) {
          var c = { page: page, order: order, w: e.w, h: e.h, share: share, words: words, hash: st.hash, full: e.full, thumb: e.thumb, srcW: d.w, srcH: d.h };
          cands.push(c);
          return c;
        }, function () { lo.unread++; return null; });
      }
    }
    lo[why] = (lo[why] || 0) + 1;
    return Promise.resolve(null);
  }
  /* what PDF.js hands over for a picture the page paints (page.objs, or commonObjs for one shared by pages), or null */
  function objOf(page, name) {
    return new Promise(function (resolve) {
      var store = /^g_/.test(name) ? page.commonObjs : page.objs, done = false;
      var t = root.setTimeout(function () { if (!done) { done = true; resolve(null); } }, CAPS.decodeMs);
      try {
        store.get(name, function (img) { if (!done) { done = true; root.clearTimeout(t); resolve(img || null); } });
      } catch (e) { if (!done) { done = true; root.clearTimeout(t); resolve(null); } }
    });
  }
  function wordsOf(tc) {
    var parts = [];
    ((tc && tc.items) || []).forEach(function (it) { if (it && typeof it.str === 'string') parts.push(it.str + (it.hasEOL ? '\n' : ' ')); });
    return parts.join('').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  function say(o, text) { if (o && typeof o.onProgress === 'function') { try { o.onProgress(text); } catch (e) { /* the page's own */ } } }

  function fromPdf(bytes, o) {
    o = o || {};
    var R = root.RevampPdf;
    if (!R || typeof R.open !== 'function') return Promise.reject(new Error('The PDF reader is not loaded on this page. Reload the page and attach the PDF again.'));
    var lib = null, pdf = null;
    var lo = emptyLeftOut(), cands = [], seen = {}, texts = [], textLen = 0, cut = false, order = 0, pageW = 0, pageH = 0;
    return R.load().then(function (L) { lib = L; return R.open(bytes); }).then(function (d) {
      pdf = d;
      var n = pdf.numPages, picPages = Math.min(n, CAPS.pages), textPages = o.words ? Math.min(n, CAPS.textPages) : picPages;
      var chain = Promise.resolve();
      function onePage(num) {
        say(o, num <= picPages ? 'Taking the pictures out of page ' + num + ' of ' + n + '…' : 'Reading page ' + num + ' of ' + n + '…');
        return pdf.getPage(num).then(function (page) {
          return page.getTextContent().then(wordsOf, function () { return ''; }).then(function (words) {
            if (o.words && words && !cut) {
              var block = 'Page ' + num + ':\n' + words.slice(0, CAPS.pageWords);
              if (textLen + block.length > CAPS.textChars) cut = true;
              else { texts.push(block); textLen += block.length + 2; }
            }
            if (num > picPages) return null;
            var vp = page.getViewport({ scale: 1 }), short = oneLine(words, CAPS.pictureWords);
            /* the first page's size: Create Event tells a designed (landscape) presentation by it (create-deck.js) */
            if (num === 1) { pageW = Math.round(vp.width); pageH = Math.round(vp.height); }
            return page.getOperatorList().then(function (ops) {
              var painted = paintedImages(ops.fnArray || [], ops.argsArray || [], lib.OPS || {}, vp.width, vp.height);
              return painted.reduce(function (p, pi) {
                return p.then(function () {
                  /* the same object painted again (a deck's mask or background on every slide): counted once, as what it
                     was the first time — a repeat only of a picture that was kept */
                  if (seen[pi.name]) { if (seen[pi.name] === 'kept') lo.repeat++; return null; }
                  seen[pi.name] = 'out';
                  return objOf(page, pi.name).then(function (img) {
                    var dr = null;
                    try { dr = drawableOf(img); } catch (e) { dr = null; }
                    if (!dr) { lo.unread++; return null; }
                    return consider(dr, num, ++order, pi.share, short, cands, lo).then(function (r) { dr.done(); if (r) seen[pi.name] = 'kept'; return r; }, function () { dr.done(); });
                  });
                });
              }, Promise.resolve());
            }, function () { return null; });
          }).then(function () { try { page.cleanup(); } catch (e) { /* freed with the document */ } });
        }, function () { return null; });   // a page that cannot be read is passed over
      }
      for (var p = 1; p <= textPages; p++) chain = chain.then(onePage.bind(null, p));
      return chain.then(function () {
        var pick = choose(cands, CAPS.keep);
        lo.over = pick.over.length;
        return {
          pages: n, pagesRead: picPages, pageW: pageW, pageH: pageH, text: texts.join('\n\n'), cut: cut || (o.words && textPages < n),
          pictures: pick.kept.map(publicOf), leftOut: lo
        };
      });
    }).then(function (r) {
      if (pdf) { try { pdf.destroy(); } catch (e) { /* gone */ } }
      return r;
    }, function (err) {
      if (pdf) { try { pdf.destroy(); } catch (e) { /* gone */ } }
      throw err;
    });
  }
  function publicOf(c) {
    return { page: c.page, w: c.w, h: c.h, share: typeof c.share === 'number' ? Math.round(c.share * 100) / 100 : null, words: c.words, full: c.full, thumb: c.thumb };
  }
  /* A deck's pictures: [{ page (its slide), blob, words }] in slide order */
  function fromImages(list, o) {
    o = o || {};
    var lo = emptyLeftOut(), cands = [], order = 0;
    list = Array.isArray(list) ? list : [];
    return list.reduce(function (p, it, i) {
      return p.then(function () {
        if (!it || !it.blob) { lo.unread++; return null; }
        say(o, 'Taking the pictures out of slide ' + it.page + '…');
        if (typeof root.createImageBitmap !== 'function') { lo.unread++; return null; }
        return root.createImageBitmap(it.blob).then(function (bm) {
          var d = { src: bm, w: bm.width, h: bm.height, done: function () { try { bm.close(); } catch (e) { /* gone */ } } };
          return consider(d, +it.page || i + 1, ++order, null, oneLine(it.words, CAPS.pictureWords), cands, lo).then(function (r) { d.done(); return r; });
        }, function () { lo.unread++; return null; });
      });
    }, Promise.resolve()).then(function () {
      var pick = choose(cands, CAPS.keep);
      lo.over = pick.over.length;
      return { pictures: pick.kept.map(publicOf), leftOut: lo };
    });
  }

  var api = {
    CAPS: CAPS, fromPdf: fromPdf, fromImages: fromImages, leftOutSentence: leftOutSentence,
    _test: { statsOf: statsOf, hashOf: hashOf, hamming: hamming, verdict: verdict, choose: choose, fit: fit, paintedImages: paintedImages, emptyLeftOut: emptyLeftOut }
  };
  root.RevampDocPictures = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
