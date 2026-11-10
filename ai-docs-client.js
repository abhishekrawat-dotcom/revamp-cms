/* ETB2B EventSphere — reading a document a person attaches to an ETB2B AI message (owner decision 14, 10 Nov 2026:
   "enable acceptance of ppt & pdf files as well in the ETB2B AI"). Used by the assistant (etb2b-assistant.js), the
   site editor's chat (editor-chat-client.js), the Promotions editors' chat (promo-ai-client.js) and Create Event's
   brief box.

     RevampAiDocs.ACCEPT          the file picker's accept list for PDF and PowerPoint
     RevampAiDocs.kindOf(file)    'pdf' | 'pptx' | 'ppt' | ''
     RevampAiDocs.read(file)      -> Promise<{ kind: 'pdf', name, size, data (base64) }
                                             | { kind: 'pptx', name, size, slides, text, cut }>
                                     rejects with an Error whose message is a sentence to show
     RevampAiDocs.wire(doc)       what the server is sent for it (lib/ai-docs.js cleanDocs)
     RevampAiDocs.CAPS

   A PDF is sent as the file (the model reads its words, tables and pictures itself), checked here to be a PDF by its
   first bytes and to be at most 10 MB. A deck (.pptx) is read here with JSZip (assets/vendor/jszip.min.js, loaded
   when first needed): its slides in the order the deck shows them, each slide's text and its speaker notes. Only those
   words leave the browser, however many pictures the deck holds. An older .ppt cannot be read reliably: the person is
   asked to save it as .pptx or PDF.

   ES5 on purpose: it loads as a plain script on pages that are not bundled. */
(function (root) {
  'use strict';
  if (root.RevampAiDocs) return;

  var MB = 1024 * 1024;
  var CAPS = { pdfBytes: 10 * MB, deckBytes: 100 * MB, deckChars: 40000, slides: 500 };
  var PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  var ACCEPT = 'application/pdf,.pdf,' + PPTX_TYPE + ',.pptx,application/vnd.ms-powerpoint,.ppt';
  var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

  function str(v) { return typeof v === 'string' ? v : ''; }
  function nameOf(file) { var s = str(file && file.name).split(/[\\/]/).pop().replace(/\s+/g, ' ').trim(); return s.slice(0, 120) || 'document'; }
  function fail(text) { return Promise.reject(new Error(text)); }
  function mb(n) { return (Math.round(n / 104857.6) / 10).toFixed(1); }

  function kindOf(file) {
    var t = str(file && file.type).toLowerCase(), m = /\.([a-z0-9]{1,5})$/i.exec(str(file && file.name)), ext = m ? m[1].toLowerCase() : '';
    if (t === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (t === PPTX_TYPE || ext === 'pptx') return 'pptx';
    if (t === 'application/vnd.ms-powerpoint' || ext === 'ppt') return 'ppt';
    return '';
  }

  function bytesOf(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      if (typeof root.FileReader !== 'function') { reject(new Error('no-reader')); return; }
      var r = new root.FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('read')); };
      r.readAsArrayBuffer(file);
    });
  }
  /* base64 in slices, so a 10 MB file never becomes one huge argument list */
  function base64Of(buf) {
    var u = new Uint8Array(buf), out = '', CH = 0x8000;
    for (var i = 0; i < u.length; i += CH) out += String.fromCharCode.apply(null, u.subarray(i, Math.min(u.length, i + CH)));
    return root.btoa(out);
  }

  function readPdf(file, name) {
    var size = +file.size || 0;
    if (!size) return fail('“' + name + '” is empty.');
    if (size > CAPS.pdfBytes) return fail('“' + name + '” is ' + mb(size) + ' MB. A PDF can be at most 10 MB: attach a smaller one, or only the pages that matter.');
    return bytesOf(file).then(function (buf) {
      var head = '', u = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
      for (var i = 0; i < u.length; i++) head += String.fromCharCode(u[i]);
      if (head.indexOf('%PDF-') === -1) throw new Error('“' + name + '” is not a PDF. Save it as a PDF and attach it again.');
      return { kind: 'pdf', name: name, size: size, data: base64Of(buf) };
    }, function () { throw new Error('“' + name + '” could not be read. Attach it again.'); });
  }

  /* JSZip, from this site, once */
  var zipLoading = null;
  function jszip() {
    if (root.JSZip) return Promise.resolve(root.JSZip);
    if (zipLoading) return zipLoading;
    zipLoading = new Promise(function (resolve, reject) {
      var doc = root.document;
      if (!doc || typeof doc.createElement !== 'function') { reject(new Error('no-zip')); return; }
      var s = doc.createElement('script');
      s.src = '/assets/vendor/jszip.min.js';
      s.onload = function () { if (root.JSZip) resolve(root.JSZip); else reject(new Error('no-zip')); };
      s.onerror = function () { zipLoading = null; reject(new Error('no-zip')); };
      (doc.head || doc.documentElement).appendChild(s);
    });
    return zipLoading;
  }
  function xmlOf(text) {
    if (typeof root.DOMParser !== 'function') return null;
    var d = new root.DOMParser().parseFromString(text, 'application/xml');
    return d && d.getElementsByTagName('parsererror').length ? null : d;
  }
  function byNs(node, ns, tag) { return node && node.getElementsByTagNameNS ? node.getElementsByTagNameNS(ns, tag) : []; }
  /* a part's relationships: { rId: 'ppt/slides/slide3.xml' }, resolved against the part's own folder */
  function relsOf(zip, partPath) {
    var dir = partPath.replace(/[^\/]*$/, ''), relPath = dir + '_rels/' + partPath.slice(dir.length) + '.rels';
    var f = zip.file(relPath);
    if (!f) return Promise.resolve({});
    return f.async('string').then(function (text) {
      var d = xmlOf(text), out = {};
      if (!d) return out;
      var rels = byNs(d, NS_REL, 'Relationship');
      for (var i = 0; i < rels.length; i++) {
        var id = rels[i].getAttribute('Id'), target = str(rels[i].getAttribute('Target')), type = str(rels[i].getAttribute('Type'));
        if (!id || !target || rels[i].getAttribute('TargetMode') === 'External') continue;
        var parts = (target.charAt(0) === '/' ? target.slice(1) : dir + target).split('/'), clean = [];
        for (var k = 0; k < parts.length; k++) { if (parts[k] === '..') clean.pop(); else if (parts[k] && parts[k] !== '.') clean.push(parts[k]); }
        out[id] = { path: clean.join('/'), type: type };
      }
      return out;
    });
  }
  /* a slide's or a notes page's words: one line per paragraph, empty ones left out; a notes page's slide image and
     slide number placeholders say nothing */
  function wordsOf(text, notes) {
    var d = xmlOf(text);
    if (!d) return '';
    var lines = [], paras = byNs(d, NS_A, 'p');
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      if (notes) {
        var sp = p.parentNode;
        while (sp && sp.localName !== 'sp') sp = sp.parentNode;
        var ph = sp ? byNs(sp, NS_P, 'ph')[0] : null, t = ph ? str(ph.getAttribute('type')) : '';
        if (t === 'sldNum' || t === 'sldImg' || t === 'hdr' || t === 'ftr' || t === 'dt') continue;
      }
      var runs = byNs(p, NS_A, 't'), line = '';
      for (var j = 0; j < runs.length; j++) line += runs[j].textContent || '';
      line = line.replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    }
    return lines.join('\n');
  }
  /* A deck's look: the colours used most on its slides (its theme's own are often the program's defaults), the fonts
     its slides are set in, and up to two of its first slides' largest pictures as small JPEGs for the model to see. */
  var LOOK = { colors: 8, fonts: 4, previews: 2, previewPx: 640, previewBytes: 180 * 1024 };
  function lookOf(zip, slides) {
    var colours = {}, fonts = {};
    slides.forEach(function (s) {
      var x = s.xml || '', m, re = /srgbClr val="([0-9A-Fa-f]{6})"/g;
      while ((m = re.exec(x))) { var h = '#' + m[1].toUpperCase(); colours[h] = (colours[h] || 0) + 1; }
      var rf = /latin typeface="([^"+][^"]{0,39})"/g;
      while ((m = rf.exec(x))) fonts[m[1]] = (fonts[m[1]] || 0) + 1;
    });
    function top(o, n, min) { return Object.keys(o).filter(function (k) { return o[k] >= min; }).sort(function (a, b) { return o[b] - o[a]; }).slice(0, n); }
    var look = { colors: top(colours, LOOK.colors, 2).map(function (h) { return { hex: h, uses: colours[h] }; }), fonts: top(fonts, LOOK.fonts, 1), previews: [] };
    /* the largest picture of each of the first slides that have one */
    var picks = [];
    for (var i = 0; i < slides.length && picks.length < LOOK.previews && i < 6; i++) {
      var best = '', bestSize = 0, rels = slides[i].rels || {};
      for (var k in rels) {
        if (!Object.prototype.hasOwnProperty.call(rels, k) || !/\/image$/.test(rels[k].type) || !/\.(png|jpe?g|gif|webp)$/i.test(rels[k].path)) continue;
        var f = zip.file(rels[k].path), sz = f && f._data && f._data.uncompressedSize ? f._data.uncompressedSize : 1;
        if (f && sz > bestSize) { best = rels[k].path; bestSize = sz; }
      }
      if (best && picks.indexOf(best) === -1) picks.push(best);
    }
    return picks.reduce(function (p, path) {
      return p.then(function () {
        return zip.file(path).async('blob').then(previewOf).then(function (d) { if (d) look.previews.push(d); }, function () {});
      });
    }, Promise.resolve()).then(function () { return look.colors.length || look.fonts.length || look.previews.length ? look : null; });
  }
  /* a picture drawn small on a canvas, as a JPEG data address ('' when it cannot be) */
  function previewOf(blob) {
    return new Promise(function (resolve) {
      var doc = root.document, URLs = root.URL;
      if (!doc || !URLs || typeof URLs.createObjectURL !== 'function' || typeof root.Image !== 'function') { resolve(''); return; }
      var url = URLs.createObjectURL(blob), img = new root.Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, LOOK.previewPx / Math.max(w, h, 1));
          var c = doc.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
          var g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          var q = 0.8, out = c.toDataURL('image/jpeg', q);
          while (out.length * 0.75 > LOOK.previewBytes && q > 0.35) { q -= 0.15; out = c.toDataURL('image/jpeg', q); }
          resolve(out.length * 0.75 <= LOOK.previewBytes ? out : '');
        } catch (e) { resolve(''); }
        URLs.revokeObjectURL(url);
      };
      img.onerror = function () { URLs.revokeObjectURL(url); resolve(''); };
      img.src = url;
    });
  }
  function readPptx(file, name) {
    var size = +file.size || 0;
    if (!size) return fail('“' + name + '” is empty.');
    if (size > CAPS.deckBytes) return fail('“' + name + '” is ' + mb(size) + ' MB. A deck can be at most 100 MB: save a copy without its videos and attach that.');
    return jszip().then(function (JSZip) {
      return JSZip.loadAsync(file);
    }, function () { throw new Error('ETB2B AI could not open decks on this page right now. Reload the page and attach it again.'); }).then(function (zip) {
      var pres = zip.file('ppt/presentation.xml');
      if (!pres) throw new Error('bad-deck');
      return Promise.all([pres.async('string'), relsOf(zip, 'ppt/presentation.xml')]).then(function (got) {
        var d = xmlOf(got[0]), rels = got[1];
        if (!d) throw new Error('bad-deck');
        var ids = byNs(d, NS_P, 'sldId'), paths = [];
        for (var i = 0; i < ids.length && paths.length < CAPS.slides; i++) {
          var rid = ids[i].getAttributeNS(NS_R, 'id'), rel = rid && rels[rid];
          if (rel && zip.file(rel.path)) paths.push(rel.path);
        }
        if (!paths.length) throw new Error('bad-deck');
        return Promise.all(paths.map(function (path) {
          return Promise.all([zip.file(path).async('string'), relsOf(zip, path)]).then(function (s) {
            var notesPath = '';
            for (var k in s[1]) if (Object.prototype.hasOwnProperty.call(s[1], k) && /notesSlide$/.test(s[1][k].type)) notesPath = s[1][k].path;
            var nf = notesPath && zip.file(notesPath);
            return (nf ? nf.async('string') : Promise.resolve('')).then(function (notes) {
              return { words: wordsOf(s[0], false), notes: notes ? wordsOf(notes, true) : '', xml: s[0], rels: s[1] };
            });
          });
        })).then(function (slides) {
          var parts = [], total = 0, cut = false;
          slides.forEach(function (s, i) {
            if (!s.words && !s.notes) return;
            var block = 'Slide ' + (i + 1) + ':\n' + (s.words || '(no text)') + (s.notes ? '\nSpeaker notes: ' + s.notes.replace(/\n/g, ' ') : '');
            if (total + block.length > CAPS.deckChars) { cut = true; return; }
            parts.push(block); total += block.length + 2;
          });
          if (!parts.length) throw new Error('“' + name + '” has no words ETB2B AI can read: its slides are only pictures. Attach it as a PDF instead.');
          var deck = { kind: 'pptx', name: name, size: size, slides: slides.length, text: parts.join('\n\n'), cut: cut };
          /* its look as well: the colours and fonts its slides use, and its first slides' main pictures, small
             (owner, 10 Nov 2026: "adapt the theme for this website from this presentation") */
          return lookOf(zip, slides).then(function (look) { if (look) deck.look = look; return deck; }, function () { return deck; });
        });
      });
    }).catch(function (err) {
      var m = err && err.message;
      if (m && m.charAt(0) === '“' || /^ETB2B AI/.test(m || '')) throw err;
      throw new Error('“' + name + '” could not be opened as a PowerPoint deck. Save it again as .pptx, or as a PDF, and attach that.');
    });
  }

  function read(file) {
    var name = nameOf(file), kind = kindOf(file);
    if (kind === 'pdf') return readPdf(file, name);
    if (kind === 'pptx') return readPptx(file, name);
    if (kind === 'ppt') return fail('“' + name + '” is an older PowerPoint file (.ppt) ETB2B AI cannot read. Save it as .pptx or PDF and attach that.');
    return fail('“' + name + '” is not a PDF or a PowerPoint deck.');
  }
  function wire(doc) {
    if (!doc || typeof doc !== 'object') return null;
    if (doc.kind === 'pdf') return { kind: 'pdf', name: doc.name, size: doc.size, data: doc.data };
    if (doc.kind === 'pptx') return { kind: 'pptx', name: doc.name, size: doc.size, slides: doc.slides, text: doc.text, cut: !!doc.cut, look: doc.look || undefined };
    return null;
  }

  root.RevampAiDocs = { ACCEPT: ACCEPT, CAPS: CAPS, kindOf: kindOf, read: read, wire: wire, _test: { wordsOf: wordsOf, base64Of: base64Of } };
})(typeof window !== 'undefined' ? window : this);
