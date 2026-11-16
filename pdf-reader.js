/* pdf-reader.js — PDF.js for ETB2B EventSphere's pages, from this site and once per page: window.RevampPdf (ES5).

   PDF.js is vendored, pinned and unchanged, licence kept: assets/vendor/pdfjs/pdf-<VERSION>.min.js (the library's
   module build), its worker pdf.worker-<VERSION>.min.js and LICENSE.txt (pdfjs-dist 4.10.38, 1 Jan 2025; Apache 2.0).
   Two places read PDFs with it:
     - the site editor's ETB2B AI takes the pictures and the words out of an attached PDF (ai-doc-pictures.js, through
       ai-docs-client.js; owner, 16 Nov 2026: "use the images from this pdf and try to well accommodate them");
     - the console's Speakers page draws a brochure's pages to find speakers' photos (edit-event-speaker-tools.js).

     RevampPdf.VERSION, LIB, WORKER   the files it loads
     RevampPdf.load() -> Promise<pdfjsLib>
         the library, imported once (a module script this file adds), with its worker set to the vendored one;
         rejects with an Error whose message is a sentence to show
     RevampPdf.open(bytes, extra) -> Promise<PDFDocumentProxy>
         a PDF read from its bytes (a Uint8Array: PDF.js takes it over, so pass a copy you still need), with the
         options every caller gets (OPTIONS): no code is ever compiled from a PDF (isEvalSupported false, the switch
         that answers CVE-2024-4367's kind of font bug), nothing is fetched from anywhere (the bytes are all it
         reads: no range or stream requests, no standard fonts or character maps, no XFA forms). extra may set only
         SAFE_EXTRA's options (disableFontFace).
     RevampPdf.renderPage(page, px) -> Promise<HTMLCanvasElement>
         a page (a PDFPageProxy) drawn whole on a new canvas whose long side is px — the one slide renderer: the
         console's speaker tools draw a brochure's pages with it, and Create Event the key slides of a presentation it
         follows (create-deck.js)
     RevampPdf.OPTIONS                the options open() always sets

   ES5 on purpose: it loads as a plain script on pages that are not bundled. The module build itself is imported by
   a two-line module script, which every browser this product supports runs. */
(function (root) {
  'use strict';
  if (root.RevampPdf) return;

  var VERSION = '4.10.38';
  var LIB = '/assets/vendor/pdfjs/pdf-' + VERSION + '.min.js';
  var WORKER = '/assets/vendor/pdfjs/pdf.worker-' + VERSION + '.min.js';
  var WAIT_MS = 30000;
  var READY = '__revampPdfReady', HELD = '__revampPdfLib';
  var NOT_LOADED = 'The PDF reader could not be loaded. Check your connection, reload the page and try again.';
  var OPTIONS = {
    isEvalSupported: false,       // never compile code from a PDF's fonts
    disableAutoFetch: true,       // the whole file is in hand: nothing is asked for in parts
    disableStream: true,
    disableRange: true,
    enableXfa: false,             // XFA forms are never drawn
    stopAtErrors: false,          // a damaged page or picture is skipped, not the whole document
    verbosity: 0                  // errors only, in the console
  };
  var SAFE_EXTRA = { disableFontFace: 1 };

  var loading = null;
  function load() {
    if (root[HELD]) return Promise.resolve(root[HELD]);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var doc = root.document;
      if (!doc || typeof doc.createElement !== 'function') { reject(new Error(NOT_LOADED)); return; }
      var done = false, timer = null;
      function finish(ok) {
        if (done) return;
        done = true;
        if (timer) root.clearTimeout(timer);
        try { delete root[READY]; } catch (e) { root[READY] = undefined; }
        var lib = root[HELD];
        if (!ok || !lib || typeof lib.getDocument !== 'function') { loading = null; reject(new Error(NOT_LOADED)); return; }
        resolve(lib);
      }
      root[READY] = function () { finish(true); };
      var s = doc.createElement('script');
      s.type = 'module';
      /* a module script that fails to load the library fires "error" on this element */
      s.onerror = function () { finish(false); };
      s.textContent = 'import * as lib from "' + LIB + '";\n' +
        'lib.GlobalWorkerOptions.workerSrc = "' + WORKER + '";\n' +
        'window.' + HELD + ' = lib;\n' +
        'if (typeof window.' + READY + ' === "function") window.' + READY + '();\n';
      timer = root.setTimeout(function () { finish(!!root[HELD]); }, WAIT_MS);
      (doc.head || doc.documentElement).appendChild(s);
    });
    return loading;
  }

  function open(bytes, extra) {
    return load().then(function (lib) {
      var o = { data: bytes };
      Object.keys(OPTIONS).forEach(function (k) { o[k] = OPTIONS[k]; });
      if (extra && typeof extra === 'object') Object.keys(extra).forEach(function (k) { if (SAFE_EXTRA[k]) o[k] = extra[k]; });
      return lib.getDocument(o).promise;
    });
  }

  function renderPage(page, px) {
    var doc = root.document;
    var v = page.getViewport({ scale: 1 }), scale = (+px || 1280) / Math.max(v.width, v.height);
    var vp = page.getViewport({ scale: scale });
    var canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width)); canvas.height = Math.max(1, Math.round(vp.height));
    return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () { return canvas; });
  }

  root.RevampPdf = { VERSION: VERSION, LIB: LIB, WORKER: WORKER, OPTIONS: OPTIONS, load: load, open: open, renderPage: renderPage };
})(typeof window !== 'undefined' ? window : this);
