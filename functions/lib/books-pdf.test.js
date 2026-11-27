// node functions/lib/books-pdf.test.js — Books Phase 4 (27 Nov 2026): the print-ready vector PDF
// (books-app/src/engines/pdfEngine.ts and pdf/) and the lines it draws (textEngine.layoutTextLines).
// pdfEngine is bundled with esbuild (books-app's own) into memory and run here in this realm (vm), with:
//   - a measure injected (textMeasure.setMeasure): the fixture font's own widths, read with fontkit, or a fake
//     monospace one where every width is known;
//   - fonts served by a stub of GET /api/books/font-file: the small Playfair Display 700 and Lexend 500 TTFs in
//     fixtures/logo-unit/ (only " 027ACEHIMOSTU" and digits; so the books here are written in those);
//   - photos made with sharp, and the browser's picture work (crop, filter, resize, encode) done by sharp behind the
//     engine's image pipeline.
// The PDFs are read back with pdf-lib: page count, the boxes per mode, mixed sizes and spreads; fonts embedded as
// subsets; the text itself (each TJ decoded through the font's ToUnicode map); a font that can't be embedded refused in
// print and set in Helvetica in review; photos cut and made no larger than the target ppi, never enlarged; hidden
// frames absent; marks outside the bleed; the cross-reference table; progress and cancelling.
// No browser, no network.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; process.stderr.write('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 900) : '') + '\n'); }
var ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'books-app'), ENGINES = path.join(APP, 'src', 'engines');
var sharp = require('sharp');
var PL = require(path.join(APP, 'node_modules', 'pdf-lib'));
var fontkit = require(path.join(APP, 'node_modules', '@pdf-lib', 'fontkit'));

/* ---------- the engine, bundled and loaded ---------- */
var esbuild = require(path.join(APP, 'node_modules', 'esbuild'));
var built = esbuild.buildSync({
  stdin: {
    contents: [
      "export * from './pdfEngine';",
      "export { layoutTextLines, measureTextOverflow, drawnTextOf, setFontMetrics, textBoxOf, paragraphsForDrawing } from './textEngine';",
      "export { setMeasure, PT_TO_MM } from './textMeasure';",
      "export { cssMatch, declsFromWeights } from './pdf/fonts';",
      "export { compileSvg, SvgUnsupported } from './pdf/svg';",
      "export { jpegInfo, photoFilter, intersect } from './pdf/images';",
      "export { renderInfographicToSvgString } from './infographicEngine';"
    ].join('\n'),
    resolveDir: ENGINES, sourcefile: 'books-pdf-entry.ts', loader: 'ts'
  },
  bundle: true, write: false, format: 'cjs', platform: 'neutral', mainFields: ['module', 'main'], target: 'es2020', external: ['react'], logLevel: 'silent'
});
var mod = { exports: {} };
var REACT = { useSyncExternalStore: function (sub, get) { return get(); } };
vm.runInThisContext('(function (module, exports, require) {' + built.outputFiles[0].text + '\n})', { filename: 'pdfEngine.bundle.js' })(mod, mod.exports, function (n) {
  if (n === 'react') return REACT;
  throw new Error('unexpected require ' + n);
});
var P = mod.exports;
check('0.1 pdfEngine bundles and loads, with the names the export screen uses', ['exportBookPdf', 'defaultPdfOptions', 'PdfFontError', 'setPdfEnvironment', 'layoutTextLines', 'imagePlacement'].every(function (n) { return typeof P[n] === 'function'; }), Object.keys(P));

/* ---------- fonts: the fixtures, padded (fontkit reads a few bytes past an empty last glyph) ---------- */
var FIX = path.join(__dirname, 'fixtures', 'logo-unit');
var PLAYFAIR = Buffer.concat([fs.readFileSync(path.join(FIX, 'playfair-display-700-subset.ttf')), Buffer.alloc(16)]);
var LEXEND = Buffer.concat([fs.readFileSync(path.join(FIX, 'lexend-500-digits-subset.ttf')), Buffer.alloc(16)]);
var ODD = oddGlyphs(fs.readFileSync(path.join(FIX, 'playfair-display-700-subset.ttf')));
var FK = { 'playfair display': fontkit.create(PLAYFAIR), lexend: fontkit.create(LEXEND), 'odd serif': fontkit.create(ODD) };
var PT_TO_MM = 25.4 / 72;
/* the Playfair fixture rewritten with glyph records of odd lengths and a long loca table, as some Google fonts are
   built (Cormorant Garamond): what @pdf-lib/fontkit's subset broke until each glyph was padded */
function oddGlyphs(ttf) {
  var n = ttf.readUInt16BE(4), dir = {};
  for (var i = 0; i < n; i++) { var o = 12 + 16 * i; dir[ttf.slice(o, o + 4).toString('latin1')] = { off: ttf.readUInt32BE(o + 8), len: ttf.readUInt32BE(o + 12) }; }
  var head = Buffer.from(ttf.slice(dir.head.off, dir.head.off + dir.head.len)), short = head.readInt16BE(50) === 0;
  var numGlyphs = ttf.readUInt16BE(dir.maxp.off + 4), offs = [];
  for (var g = 0; g <= numGlyphs; g++) offs.push(short ? ttf.readUInt16BE(dir.loca.off + 2 * g) * 2 : ttf.readUInt32BE(dir.loca.off + 4 * g));
  var parts = [], at = 0, loca = Buffer.alloc(4 * (numGlyphs + 1));
  for (var k = 0; k < numGlyphs; k++) {
    var rec = ttf.slice(dir.glyf.off + offs[k], dir.glyf.off + offs[k + 1]);
    if (rec.length && rec.length % 2 === 0) rec = Buffer.concat([rec, Buffer.alloc(1)]);
    loca.writeUInt32BE(at, 4 * k); parts.push(rec); at += rec.length;
  }
  loca.writeUInt32BE(at, 4 * numGlyphs);
  head.writeInt16BE(1, 50);
  var tables = Object.keys(dir).sort().map(function (tag) {
    var data = tag === 'glyf' ? Buffer.concat(parts) : tag === 'loca' ? loca : tag === 'head' ? head : ttf.slice(dir[tag].off, dir[tag].off + dir[tag].len);
    return { tag: tag, data: data };
  });
  var out = [Buffer.alloc(12 + 16 * tables.length)], pos = out[0].length;
  ttf.copy(out[0], 0, 0, 12);
  tables.forEach(function (t, i) {
    var o = 12 + 16 * i;
    out[0].write(t.tag, o, 'latin1'); out[0].writeUInt32BE(0, o + 4); out[0].writeUInt32BE(pos, o + 8); out[0].writeUInt32BE(t.data.length, o + 12);
    var padded = Buffer.concat([t.data, Buffer.alloc((4 - (t.data.length % 4)) % 4)]);
    out.push(padded); pos += padded.length;
  });
  return Buffer.concat(out.concat([Buffer.alloc(16)]));
}
/* the fixture font's own widths (kerning included), as a browser would measure that font */
function realMeasure(text, font) {
  var f = FK[String(font.family).toLowerCase()];
  var n = Array.from(text).length;
  if (!f) return n * 0.55 * font.sizePt * PT_TO_MM + (font.letterSpacingEm || 0) * font.sizePt * PT_TO_MM * n;
  var run = f.layout(text, (font.letterSpacingEm || 0) ? { liga: false, clig: false, dlig: false, hlig: false } : undefined), w = 0;
  run.positions.forEach(function (p) { w += p.xAdvance; });
  return (w / f.unitsPerEm) * font.sizePt * PT_TO_MM + (font.letterSpacingEm || 0) * font.sizePt * PT_TO_MM * n;
}
/* a character is (size ÷ 10) mm wide (books-text.test.js's), capitals half as wide again */
function mono(text, font) {
  var w = 0;
  for (var ch of text) w += (ch >= 'A' && ch <= 'Z') ? 1.5 : 1;
  return w * font.sizePt / 10 + (font.letterSpacingEm || 0) * font.sizePt * PT_TO_MM * Array.from(text).length;
}
var FONT_ASKS = [];
function fontGet(url) {
  FONT_ASKS.push(url);
  var q = new URLSearchParams(url.split('?')[1] || ''), fam = q.get('family'), w = +q.get('weight'), it = q.get('italic') === '1';
  if (fam === 'Playfair Display') {
    if (w === 700 && !it) return Promise.resolve({ status: 200, bytes: new Uint8Array(PLAYFAIR) });
    return Promise.resolve({ status: 404, json: { error: 'Playfair Display has no ' + w + ' style.', code: 'font-weight', weights: [700], italic: false } });
  }
  if (fam === 'Odd Serif') return Promise.resolve(w === 700 && !it ? { status: 200, bytes: new Uint8Array(ODD) } : { status: 404, json: { code: 'font-weight', error: 'x', weights: [700], italic: false } });
  if (fam === 'Lexend') {
    if (w === 500 && !it) return Promise.resolve({ status: 200, bytes: new Uint8Array(LEXEND) });
    return Promise.resolve({ status: 404, json: { error: 'Lexend has no ' + w + ' style.', code: 'font-weight', weights: [500], italic: false } });
  }
  return Promise.resolve({ status: 404, json: { error: '"' + fam + '" is not a Google font, so it can\'t be embedded in the PDF.', code: 'font-family' } });
}

/* ---------- photos: made with sharp; the picture work done by sharp ---------- */
var PHOTOS = {};
var PIPE = { opened: 0, closed: 0, renders: [], failNext: false };
function pipeline() {
  return {
    open: function (url) {
      var ph = PHOTOS[url];
      if (!ph) return Promise.reject(new Error('HTTP 404'));
      PIPE.opened++;
      var info = ph.mime === 'image/jpeg' ? P.jpegInfo(new Uint8Array(ph.buf)) : null;
      var plain = !!info && (info.components === 3 || info.components === 1) && info.orientation <= 1;
      return Promise.resolve({ width: ph.width, height: ph.height, mime: ph.mime, passThrough: plain ? new Uint8Array(ph.buf) : null, handle: { url: url } });
    },
    render: function (img, crop, outW, outH, filter) {
      PIPE.renders.push({ url: img.handle.url, crop: crop, outW: outW, outH: outH, filter: filter });
      var ph = PHOTOS[img.handle.url];
      var s = sharp(ph.buf).extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h }).resize(outW, outH, { fit: 'fill' });
      if (/grayscale/.test(filter)) s = s.grayscale();
      var png = ph.mime === 'image/png';
      return (png ? s.png() : s.jpeg({ quality: 92 })).toBuffer().then(function (b) { return { bytes: new Uint8Array(b), format: png ? 'png' : 'jpg' }; });
    },
    close: function () { PIPE.closed++; },
    rasterizeSvg: function (svg, w, h) {
      return sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer().then(function (b) { return new Uint8Array(b); });
    }
  };
}
var NOW = new Date('2026-11-27T10:00:00Z');
function useEnv(extra) {
  P.setPdfEnvironment(Object.assign({ fonts: { browserFaces: function () { return []; }, get: fontGet }, images: pipeline(), prepareFonts: function () { return Promise.resolve(); }, now: function () { return NOW; } }, extra || {}));
}

/* ---------- books ---------- */
function style(o) {
  return Object.assign({ fontFamily: 'Playfair Display', fontSizePt: 12, fontWeight: 700, fontStyle: 'normal', color: '#112233', lineHeight: 1.3, letterSpacingEm: 0,
    textAlign: 'left', verticalAlign: 'top', paragraphSpacingMm: 0, columns: 1, columnGapMm: 0, insetMm: 0, textTransform: 'none' }, o || {});
}
var N = 0;
function el(type, box, extra) {
  return Object.assign({ id: 'e' + (++N), name: type + ' ' + N, type: type, xMm: box[0], yMm: box[1], widthMm: box[2], heightMm: box[3], rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: N }, extra || {});
}
function text(box, words, st, extra) { return el('text', box, Object.assign({ text: words, textStyle: style(st) }, extra || {})); }
function dims(w, h, bleed) { return { widthMm: w, heightMm: h, orientation: 'portrait', rotation: 0, margins: { top: 12, bottom: 12, inner: 14, outer: 12 }, gutterMm: 8, bleedMm: bleed === undefined ? 3 : bleed, safeAreaMm: 6, columns: 2, columnGapMm: 5, baselineGridMm: 4, spreadMode: 'facing' }; }
function page(id, role, els, extra) { return Object.assign({ id: id, orderIndex: 0, label: id, role: role, backgroundColor: '#F4F1EA', elements: els }, extra || {}); }
function book(pages, extra) {
  return Object.assign({ id: 'qa_pdf', name: 'QA COAST HOUSE', subtitle: '', category: 'Test', status: 'draft', unit: 'mm', coverThumbnail: '', dimensions: dims(200, 250, 3),
    designSystem: { colors: { paper: '#FAF7F0' } }, masterPages: [], chapters: [], contentSections: [], imageAssets: [], customDimensionPresets: [], createdAt: '', updatedAt: '',
    printSettings: { bindingType: 'perfect', paperStockName: '', paperCaliperMm: 0.1, coverBoardCaliperMm: 0, printerToleranceMm: 0, includeBleed: true, includeCropMarks: true, includeRegistrationMarks: true, colorSpace: 'RGB', targetDpi: 300, exportSpreads: false },
    pages: pages }, extra || {});
}

/* ---------- reading a PDF back ---------- */
function lookup(doc, o) { return o instanceof PL.PDFRef ? doc.context.lookup(o) : o; }
function streamText(doc, s) { return Buffer.from(PL.decodePDFRawStream(lookup(doc, s)).decode()).toString('latin1'); }
function contentOf(doc, pg) {
  var c = lookup(doc, pg.node.get(PL.PDFName.of('Contents')));
  if (c instanceof PL.PDFArray) return c.asArray().map(function (r) { return streamText(doc, r); }).join('\n');
  return streamText(doc, c);
}
function dictOf(doc, d, key) { var v = d && d.get(PL.PDFName.of(key)); return lookup(doc, v); }
function cmapOf(src) {
  var map = new Map();
  var hex = function (h) { return h.replace(/[<>\s]/g, ''); };
  var toStr = function (h) { var s = ''; h = hex(h); for (var i = 0; i < h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return s; };
  (src.match(/beginbfchar([\s\S]*?)endbfchar/g) || []).forEach(function (blk) {
    var re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g, m;
    while ((m = re.exec(blk))) map.set(m[1].toUpperCase(), toStr(m[2]));
  });
  (src.match(/beginbfrange([\s\S]*?)endbfrange/g) || []).forEach(function (blk) {
    var re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g, m;
    while ((m = re.exec(blk))) {
      var a = parseInt(m[1], 16), b = parseInt(m[2], 16), w = m[1].length;
      if (m[3][0] === '[') { var list = m[3].match(/<[0-9a-fA-F]+>/g) || []; for (var c = a; c <= b; c++) map.set(c.toString(16).toUpperCase().padStart(w, '0'), toStr(list[c - a] || '')); }
      else { var start = parseInt(hex(m[3]), 16); for (var c2 = a; c2 <= b; c2++) map.set(c2.toString(16).toUpperCase().padStart(w, '0'), String.fromCharCode(start + c2 - a)); }
    }
  });
  return map;
}
function fontsOf(doc, pg) {
  var res = pg.node.Resources(), out = {};
  var fd = res && dictOf(doc, res, 'Font');
  if (!fd) return out;
  fd.entries().forEach(function (e) {
    var f = lookup(doc, e[1]);
    var sub = String(dictOf(doc, f, 'Subtype'));
    var tu = f.get(PL.PDFName.of('ToUnicode'));
    var info = { base: String(dictOf(doc, f, 'BaseFont')).replace(/^\//, ''), type0: sub === '/Type0', map: tu ? cmapOf(streamText(doc, tu)) : null, dict: f };
    if (info.type0) {
      var cid = lookup(doc, dictOf(doc, f, 'DescendantFonts').get(0));
      var desc = dictOf(doc, cid, 'FontDescriptor');
      var ff = desc.get(PL.PDFName.of('FontFile2')) || desc.get(PL.PDFName.of('FontFile3'));
      info.cidSubtype = String(dictOf(doc, cid, 'Subtype'));
      info.program = ff ? Buffer.from(PL.decodePDFRawStream(lookup(doc, ff)).decode()) : null;
    }
    out[e[0].toString().replace(/^\//, '')] = info;
  });
  return out;
}
/* the text a page shows: each TJ decoded through its font (one line each) */
function textOf(doc, pg) {
  var fonts = fontsOf(doc, pg), src = contentOf(doc, pg), out = [], cur = null;
  var re = /\/([^\s/[\]<>()]+)\s+[-\d.]+\s+Tf|\[((?:[^\]])*)\]\s*TJ/g, m;
  while ((m = re.exec(src))) {
    if (m[1]) { cur = fonts[m[1]] || null; continue; }
    if (!cur) continue;
    var s = '';
    (m[2].match(/<[0-9a-fA-F]*>/g) || []).forEach(function (h) {
      h = h.slice(1, -1).toUpperCase();
      var step = cur.type0 ? 4 : 2;
      for (var i = 0; i < h.length; i += step) {
        var code = h.slice(i, i + step);
        s += cur.map ? (cur.map.get(code) || '�') : String.fromCharCode(parseInt(code, 16));
      }
    });
    /* a word set on its own (its own TJ) carries its space: it joins the next */
    if (out.length && / $/.test(out[out.length - 1])) out[out.length - 1] += s;
    else out.push(s);
  }
  return out;
}
function imagesOf(doc, pg) {
  var res = pg.node.Resources(), out = [];
  var xd = res && dictOf(doc, res, 'XObject');
  if (!xd) return out;
  xd.entries().forEach(function (e) {
    var x = lookup(doc, e[1]);
    out.push({ w: dictOf(doc, x.dict, 'Width').asNumber(), h: dictOf(doc, x.dict, 'Height').asNumber(), filter: String(dictOf(doc, x.dict, 'Filter')), smask: !!x.dict.get(PL.PDFName.of('SMask')) });
  });
  return out;
}
function box(b) { return [b.x, b.y, b.width, b.height].map(function (v) { return Math.round(v * 100) / 100; }); }
var K = 72 / 25.4;
function pt(mm) { return Math.round(mm * K * 100) / 100; }
async function read(result) {
  var bytes = new Uint8Array(await result.blob.arrayBuffer());
  return { bytes: bytes, doc: await PL.PDFDocument.load(bytes, { updateMetadata: false }) };
}
function xrefOk(bytes) {
  var s = Buffer.from(bytes).toString('latin1');
  var m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(s);
  if (!m) return 'no startxref';
  var at = +m[1];
  if (s.slice(at, at + 4) !== 'xref') return 'startxref does not point at the table';
  var lines = s.slice(at).split('\n'), i = 1, bad = [];
  while (i < lines.length && /^\d+ \d+$/.test(lines[i].trim())) {
    var parts = lines[i].trim().split(' '), first = +parts[0], count = +parts[1];
    for (var k = 0; k < count; k++) {
      var e = lines[i + 1 + k];
      if (/ n\s*$/.test(e)) { var off = +e.slice(0, 10); var head = s.slice(off, off + 20); if (head.indexOf((first + k) + ' 0 obj') !== 0) bad.push(first + k); }
    }
    i += 1 + count;
  }
  return bad.length ? 'bad offsets for ' + bad.slice(0, 5).join(',') : 'ok';
}

(async function () {
  /* =================================================================================================================
     1 layoutTextLines: the lines a frame draws (the monospace measure: every width known)
     ================================================================================================================= */
  P.setMeasure(mono);
  P.setFontMetrics(function () { return { ascent: 0.8, descent: 0.2 }; });
  var LH5 = 5 / (10 * PT_TO_MM); // a 10 pt line 5 mm high
  function tf(t, w, h, st, extra) { return text([10, 10, w, h], t, Object.assign({ fontFamily: 'Mono', fontSizePt: 10, fontWeight: 400, color: '#000000', lineHeight: LH5 }, st || {}), extra); }
  function words(n, len) { var out = []; for (var i = 0; i < n; i++) out.push(String.fromCharCode(97 + (i % 26)).repeat(len || 4)); return out.join(' '); }
  function lineWords(lay) { return lay.lines.map(function (l) { return l.words.map(function (w) { return w.text; }).join(' '); }); }

  var l1 = P.layoutTextLines(tf('aaaa bbbb cccc dddd eeee', 20, 15));
  check('1.1 the words wrap where the fit check wraps them: two lines, nothing over', JSON.stringify(lineWords(l1)) === JSON.stringify(['aaaa bbbb cccc dddd', 'eeee']) && !l1.overflow &&
    l1.lines[0].yMm === 0 && l1.lines[1].yMm === 5 && l1.lineHeightMm === 5 && l1.sizePt === 10 && l1.font.family === 'Mono' && l1.color === '#000000', l1);
  check('1.2 positions from the frame\'s top-left: words at 0, 5, 10, 15 mm; the line\'s text keeps its spaces', JSON.stringify(l1.lines[0].words.map(function (w) { return w.xMm; })) === '[0,5,10,15]' &&
    l1.lines[0].text === 'aaaa bbbb cccc dddd' && Math.abs(l1.lines[0].widthMm - 19) < 1e-9 && l1.lines[0].column === 0, l1.lines[0]);
  check('1.3 the baseline: half the leading\'s slack below the line\'s top, then the ascent (CSS half-leading)', Math.abs(l1.lines[0].baselineMm - ((5 - 1 * 10 * PT_TO_MM) / 2 + 0.8 * 10 * PT_TO_MM)) < 1e-9 &&
    Math.abs(l1.lines[1].baselineMm - l1.lines[0].baselineMm - 5) < 1e-9, l1.lines.map(function (l) { return l.baselineMm; }));
  var tenW = tf(words(10), 20, 5);
  var over = P.layoutTextLines(tenW);
  check('1.4 text that doesn\'t fit: only the lines that fit, and overflow as measureTextOverflow says', over.overflow === true && P.measureTextOverflow(tenW).isOverflowing &&
    over.lines.length === 1 && lineWords(over)[0] === 'aaaa bbbb cccc dddd', lineWords(over));
  /* 200 frames: the same fit as the overflow check, and every fitted word drawn */
  var agree = 0, drawnAll = 0;
  for (var r = 0; r < 200; r++) {
    var st = { columns: 1 + (r % 3), columnGapMm: r % 2 ? 4 : 0, insetMm: r % 4, paragraphSpacingMm: r % 5 === 0 ? 8 : 0, textAlign: ['left', 'center', 'right', 'justify'][r % 4], verticalAlign: ['top', 'middle', 'bottom'][r % 3] };
    var tx = words(5 + (r * 7) % 60, 1 + (r % 6)).replace(/ (\w+) /g, function (m0, w, i) { return i % 50 === 7 ? '\n\n' + w + ' ' : m0; });
    var fr = tf(tx, 25 + (r * 13) % 80, 10 + (r * 17) % 60, st);
    var lay = P.layoutTextLines(fr), ovr = P.measureTextOverflow(fr);
    if (lay.overflow === ovr.isOverflowing) agree++;
    var count = lay.lines.reduce(function (n, l) { return n + l.words.length; }, 0);
    if (ovr.isOverflowing || count === tx.split(/\s+/).filter(Boolean).length) drawnAll++;
  }
  check('1.5 200 frames: overflow agrees with measureTextOverflow every time, and every word of a frame that fits is drawn', agree === 200 && drawnAll === 200, [agree, drawnAll]);

  var c = P.layoutTextLines(tf('aaaa bb', 20, 15, { textAlign: 'center' })), rt = P.layoutTextLines(tf('aaaa bb', 20, 15, { textAlign: 'right' }));
  check('1.6 centred and right-aligned inside the column', Math.abs(c.lines[0].xMm - (20 - 7) / 2) < 1e-9 && Math.abs(rt.lines[0].xMm - 13) < 1e-9 && Math.abs(rt.lines[0].words[1].xMm - 18) < 1e-9, [c.lines[0], rt.lines[0]]);
  var j = P.layoutTextLines(tf('aaaa bbbb cccc dddd eeee ff\ngg hh', 22, 20, { textAlign: 'justify' }));
  var j0 = j.lines[0], last0 = j0.words[j0.words.length - 1];
  check('1.7 justified: a wrapped line reaches the column\'s right edge, its spaces widened evenly', j0.justify === true && Math.abs(last0.xMm + last0.widthMm - 22) < 1e-9 && Math.abs(j0.widthMm - 22) < 1e-9 &&
    Math.abs((j0.words[1].xMm - j0.words[0].xMm) - (j0.words[2].xMm - j0.words[1].xMm)) < 1e-9, j0);
  check('1.8 …but not the line before a typed return, nor the last line (text-align-last)', j.lines[1].justify === false && j.lines[1].lastInParagraph === true && j.lines[2].justify === false &&
    j.lines[2].lastInParagraph === true && j0.lastInParagraph === false, j.lines.map(function (l) { return [l.text, l.justify, l.lastInParagraph]; }));
  var mid = P.layoutTextLines(tf('aaaa', 20, 20, { verticalAlign: 'middle' })), bot = P.layoutTextLines(tf('aaaa', 20, 20, { verticalAlign: 'bottom', insetMm: 2 }));
  check('1.9 middle and bottom: the block centred, or at the foot inside the inset', Math.abs(mid.lines[0].yMm - 7.5) < 1e-9 && Math.abs(bot.lines[0].yMm - (2 + (16 - 5))) < 1e-9 &&
    Math.abs(bot.lines[0].xMm - 2) < 1e-9, [mid.lines[0].yMm, bot.lines[0]]);
  var cols = P.layoutTextLines(tf(words(24, 4), 45, 40, { columns: 2, columnGapMm: 5 }));
  check('1.10 two columns are balanced as CSS balances them: six lines make three and three', cols.lines.length === 6 && cols.lines.filter(function (l) { return l.column === 0; }).length === 3 &&
    cols.lines[3].column === 1 && Math.abs(cols.lines[3].xMm - 25) < 1e-9 && cols.lines[3].yMm === 0, cols.lines.map(function (l) { return [l.column, l.xMm, l.yMm]; }));
  var two = P.layoutTextLines(tf(words(8, 4), 45, 40, { columns: 2, columnGapMm: 5 }));
  check('1.11 …a paragraph of two lines is never cut (orphans and widows): both stay in the first column', two.lines.length === 2 && two.lines.every(function (l) { return l.column === 0; }), two.lines.map(function (l) { return l.column; }));
  var three = P.layoutTextLines(tf(words(12, 4), 45, 40, { columns: 2, columnGapMm: 5, verticalAlign: 'bottom' }));
  check('1.12 …three lines go two and one, as Chrome sets them; the block is as tall as its columns (bottom: 40 − 10)', three.lines.map(function (l) { return l.column; }).join('') === '001' &&
    Math.abs(three.lines[0].yMm - 30) < 1e-9 && Math.abs(three.lines[2].yMm - 30) < 1e-9, three.lines.map(function (l) { return [l.column, l.yMm]; }));
  var gapTop = P.layoutTextLines(tf(words(16, 4) + '\n\n' + words(16, 4), 45, 60, { columns: 2, columnGapMm: 5, paragraphSpacingMm: 8 }));
  check('1.13 …a paragraph gap at the top of a column is dropped (the paragraph\'s own empty line stays: its words start a line down)', gapTop.lines[4].column === 1 && gapTop.lines[4].yMm === 5 &&
    gapTop.lines[3].column === 0, gapTop.lines.map(function (l) { return [l.column, l.yMm]; }));
  var upper = P.layoutTextLines(tf('quiet words', 40, 10, { textTransform: 'uppercase' }));
  check('1.14 in capitals as drawn; letter spacing in the widths', upper.lines[0].text === 'QUIET WORDS' &&
    Math.abs(P.layoutTextLines(tf('aaaa', 40, 10, { letterSpacingEm: 0.1 })).lines[0].widthMm - (4 + 0.1 * 10 * PT_TO_MM * 4)) < 1e-9, upper.lines[0]);
  var folio = tf('', 20, 10, {}, { type: 'pageNumber', text: '{{page}}' });
  check('1.15 a page number frame shows its page, two digits at least, as the canvas draws it', P.layoutTextLines(folio, { pageNumber: 7 }).lines[0].text === '07' &&
    P.layoutTextLines(folio, { pageNumber: 112 }).lines[0].text === '112' && P.drawnTextOf(folio) === '00', P.layoutTextLines(folio, { pageNumber: 7 }).lines);
  var hy = P.layoutTextLines(tf('ccccccccccccc aaaa-bbbbbbbbbbbbbb dddd', 20, 15));
  check('1.16 a word broken at its hyphen: its pieces on two lines, each drawn where it is', JSON.stringify(lineWords(hy)) === JSON.stringify(['ccccccccccccc aaaa-', 'bbbbbbbbbbbbbb dddd']), lineWords(hy));
  var ind = P.layoutTextLines(tf('aa\n  bb', 20, 15));
  check('1.17 spaces typed at a line\'s start indent it', Math.abs(ind.lines[1].words[0].xMm - 2) < 1e-9 && ind.lines[1].text === '  bb', ind.lines[1]);
  var metr = P.layoutTextLines(tf('aaaa', 20, 15), { metrics: function () { return { ascent: 1.082, descent: 0.251 }; } });
  check('1.18 the font\'s own ascent and descent may be given (the PDF passes the embedded font\'s)', Math.abs(metr.lines[0].baselineMm - ((5 - 1.333 * 10 * PT_TO_MM) / 2 + 1.082 * 10 * PT_TO_MM)) < 1e-9, metr.lines[0]);
  check('1.19 no style or no words: no lines', P.layoutTextLines(Object.assign(tf('x', 20, 5), { textStyle: undefined })).lines.length === 0 && P.layoutTextLines(tf('   ', 20, 5)).lines.length === 0);

  /* =================================================================================================================
     2 the PDF (the fixture font's widths, so the PDF sets every word at its measured width)
     ================================================================================================================= */
  P.setMeasure(realMeasure);
  P.setFontMetrics(null);
  useEnv();
  var big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#2a5d8f' } }).jpeg({ quality: 80 }).toBuffer();
  var small = await sharp({ create: { width: 100, height: 75, channels: 3, background: '#8f2a2a' } }).jpeg({ quality: 80 }).toBuffer();
  var wide = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#2a8f4d' } }).jpeg({ quality: 80 }).toBuffer();
  var logo = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  var turned = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#555555' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  PHOTOS['/api/books/asset/as_00000000000000000001/print'] = { buf: big, width: 4000, height: 3000, mime: 'image/jpeg' };
  PHOTOS['/small.jpg'] = { buf: small, width: 100, height: 75, mime: 'image/jpeg' };
  PHOTOS['/wide.jpg'] = { buf: wide, width: 2000, height: 1000, mime: 'image/jpeg' };
  PHOTOS['/logo.png'] = { buf: logo, width: 400, height: 400, mime: 'image/png' };
  check('2.0 a JPEG\'s channels and EXIF orientation are read from its markers', JSON.stringify(P.jpegInfo(new Uint8Array(small))) === JSON.stringify({ components: 3, orientation: 1, height: 75, width: 100 }) &&
    P.jpegInfo(new Uint8Array(turned)).orientation === 6 && P.jpegInfo(new Uint8Array(logo)) === null, [P.jpegInfo(new Uint8Array(small)), P.jpegInfo(new Uint8Array(turned))]);

  var WORDS = 'THE COAST HOUSE MUSIC 2027 ATOMIC SMITH THE COAST HOUSE ATOMIC MOTH ACME TEAM CHASE MATCH';
  var chart = { templateId: 't', variant: 'donut_ring', title: 'TEAM', subtitle: 'ACME', categoryLabel: 'MOTH', sourceNote: 'COAST', fontFamily: 'Playfair Display', backgroundColor: '#ffffff',
    textColor: '#000000', accentColor: '#c00000', secondaryColor: '#999999', items: [{ id: 'a', label: 'HOME', value: 20 }, { id: 'b', label: 'MATCH', value: 30 }], showLegend: true, showValues: true };
  function richBook() {
    N = 0;
    return book([
      page('p1', 'front_cover', [
        el('shape', [-3, -3, 206, 80], { shape: { shapeKind: 'rectangle', fill: '#1F2E82', stroke: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0 } }),
        text([20, 20, 160, 40], WORDS, { textAlign: 'justify', color: '#FFFFFF', insetMm: 2 }),
        el('image', [-5, 150, 100, 80], { image: { src: '/api/books/asset/as_00000000000000000001/display', alt: '', fit: 'cover', zoom: 1, focalX: 50, focalY: 50, borderRadiusMm: 4 } }),
        el('infographic', [110, 150, 80, 60], { infographic: chart }),
        text([20, 100, 100, 10], 'HIDDEN SECRET MOTTO', {}, { hidden: true }),
        el('image', [120, 90, 40, 30], { hidden: true, image: { src: '/small.jpg', alt: '', fit: 'cover', zoom: 1, focalX: 50, focalY: 50 } }),
        el('line', [20, 140, 160, 2], { shape: { shapeKind: 'rule', fill: 'transparent', stroke: '#A88A4E', strokeWidthMm: 0.35, cornerRadiusMm: 0 } })
      ]),
      page('p2', 'editorial_text', [
        text([20, 20, 120, 80], 'ACME TEAM\n\nCHASE MATCH 2027', { verticalAlign: 'middle', textAlign: 'center' }),
        el('shape', [20, 105, 40, 25], { opacity: 0.5, rotation: 15, shape: { shapeKind: 'ellipse', fill: '#C04040', stroke: '#000000', strokeWidthMm: 1, cornerRadiusMm: 0, dashStyle: 'dashed' } }),
        el('image', [100, 105, 40, 30], { image: { src: '/small.jpg', alt: '', fit: 'cover', zoom: 1, focalX: 50, focalY: 50 } }),
        el('image', [20, 135, 60, 60], { image: { src: '/wide.jpg', alt: '', fit: 'cover', zoom: 1, focalX: 0, focalY: 50, grayscale: 100 } }),
        el('image', [90, 140, 40, 40], { image: { src: '/logo.png', alt: '', fit: 'contain', zoom: 1, focalX: 50, focalY: 50 } }),
        el('image', [135, 140, 10, 10], { name: 'Portrait — drop a photo here', image: { src: '', alt: '', fit: 'cover', zoom: 1, focalX: 50, focalY: 50 } })
      ], { dimensionsOverride: dims(150, 200, 5) }),
      page('p3', 'editorial_text', [text([20, 20, 120, 20], 'THE HOUSE', {}), el('pageNumber', [90, 230, 20, 6], { text: '{{page}}', textRole: 'folio', textStyle: style({ fontFamily: 'Lexend', fontWeight: 500, fontSizePt: 9, textAlign: 'center' }) })]),
      page('p4', 'editorial_text', [text([20, 20, 120, 20], 'ACME', {})]),
      page('p5', 'editorial_text', [text([20, 20, 120, 20], 'MOTH', {})]),
      page('p6', 'back_cover', [text([20, 20, 120, 20], 'COAST', {})])
    ]);
  }

  /* ---------- 2a a print PDF ---------- */
  var b1 = richBook(), prog = [];
  var opts = P.defaultPdfOptions(b1, 'print');
  check('2.1 the print defaults: from the book\'s print settings; review: no marks', opts.mode === 'print' && opts.pages === 'all' && opts.spreads === false && opts.marks.crop && opts.marks.bleed &&
    opts.marks.registration && opts.marks.slug && opts.targetPpi === 300 && JSON.stringify(P.defaultPdfOptions(b1, 'review').marks) === JSON.stringify({ crop: false, bleed: false, registration: false, slug: false }), opts);
  var res = await P.exportBookPdf(b1, opts, function (d, t, w) { prog.push([d, t, w]); });
  var rd = await read(res), doc = rd.doc, pages = doc.getPages();
  check('2.2 one PDF page per book page; the result says its size, RGB, and what it holds', res.pageCount === 6 && pages.length === 6 && res.sizeBytes === rd.bytes.length && res.colorSpace === 'RGB' &&
    res.blob.type === 'application/pdf', { pageCount: res.pageCount, n: pages.length, size: res.sizeBytes });
  var M = 3 + P.SLUG_MM;
  var p1 = pages[0];
  check('2.3 print: MediaBox = trim + bleed + room for the marks; TrimBox the trim; BleedBox trim + bleed; CropBox = MediaBox',
    JSON.stringify(box(p1.getMediaBox())) === JSON.stringify([0, 0, pt(200 + 2 * M), pt(250 + 2 * M)]) && JSON.stringify(box(p1.getTrimBox())) === JSON.stringify([pt(M), pt(M), pt(200), pt(250)]) &&
    JSON.stringify(box(p1.getBleedBox())) === JSON.stringify([pt(P.SLUG_MM), pt(P.SLUG_MM), pt(206), pt(256)]) && JSON.stringify(box(p1.getCropBox())) === JSON.stringify(box(p1.getMediaBox())),
    { media: box(p1.getMediaBox()), trim: box(p1.getTrimBox()), bleed: box(p1.getBleedBox()) });
  var M2 = 5 + P.SLUG_MM;
  check('2.4 a page of its own size (dimensionsOverride) keeps it, with its own bleed', JSON.stringify(box(pages[1].getTrimBox())) === JSON.stringify([pt(M2), pt(M2), pt(150), pt(200)]) &&
    JSON.stringify(box(pages[1].getBleedBox())) === JSON.stringify([pt(P.SLUG_MM), pt(P.SLUG_MM), pt(160), pt(210)]), box(pages[1].getTrimBox()));
  var info = { title: doc.getTitle(), creator: doc.getCreator(), producer: doc.getProducer(), subject: doc.getSubject() };
  check('2.5 the document says its title, maker and colour (RGB, no CMYK claim)', info.title === 'QA COAST HOUSE' && info.creator === 'ETB2B EventSphere Books' && /ETB2B EventSphere Books/.test(info.producer) &&
    /RGB/.test(info.subject) && !/CMYK(?! conversion)/.test(info.subject), info);
  var f1 = fontsOf(doc, p1), fnames = Object.keys(f1);
  var pf = fnames.map(function (k) { return f1[k]; }).find(function (f) { return /Playfair/.test(f.base); });
  /* ISO 32000-1 §9.6.4: a subset's name is a six-letter tag, "+", the PostScript name — printers' preflight reads it */
  check('2.15b every embedded font is named as a subset (ABCDEF+Name), as printers\' checks expect',
    fnames.length > 0 && fnames.every(function (k) { return /^[A-Z]{6}\+[A-Za-z0-9-]+$/.test(f1[k].base); }), fnames.map(function (k) { return f1[k].base; }));
  check('2.6 the font is embedded (Type0, TrueType outlines, ToUnicode) as a subset: fewer glyphs than the file', !!pf && pf.type0 && pf.cidSubtype === '/CIDFontType2' && !!pf.map && !!pf.program &&
    fontkit.create(pf.program).numGlyphs < FK['playfair display'].numGlyphs && fontkit.create(pf.program).numGlyphs >= 10, pf && { base: pf.base, glyphs: pf.program && fontkit.create(pf.program).numGlyphs });
  var t1 = textOf(doc, p1).join('\n');
  check('2.7 the text is real text: every word, in reading order, read back through the font\'s ToUnicode', t1.indexOf('THE COAST HOUSE MUSIC') !== -1 && t1.indexOf('MATCH') !== -1 && /2027/.test(t1), t1.slice(0, 300));
  check('2.8 hidden frames are not drawn (their words are nowhere in the PDF)', t1.indexOf('SECRET') === -1 && t1.indexOf('MOTTO') === -1 && !PIPE.renders.some(function (r) { return r.url === '/small.jpg' && r.outW === 40; }));
  var c1 = contentOf(doc, p1);
  check('2.9 justified words are placed one by one in a TJ (shifts between them), at the font\'s own widths (no squeeze)', /\]\s*TJ/.test(c1) && /> -?\d+(\.\d+)? </.test(c1) && !/\bTz\b/.test(c1.replace(/100 Tz/g, '')), c1.slice(0, 400));
  check('2.10 the chart is drawn as vectors: its arcs and its words in the chart\'s font', /TEAM/.test(t1) && /HOME/.test(t1) && (c1.match(/ c\n/g) || []).length > 8, (c1.match(/ c\n/g) || []).length);
  var marks = c1.split('\n');
  check('2.11 marks are drawn (hairlines: 0.25 pt)', c1.indexOf((0.25 / K).toFixed(4) + ' w') !== -1, c1.slice(-600));
  /* every mark segment lies outside the bleed box (sheet mm, y down): the lines after the page's own drawing */
  var bleedRect = { x: P.SLUG_MM, y: P.SLUG_MM, w: 206, h: 256 };
  var segs = [], re2 = /([\d.-]+) ([\d.-]+) m\n([\d.-]+) ([\d.-]+) l\nS/g, sm;
  var tail = c1.slice(c1.indexOf((0.25 / K).toFixed(4) + ' w'));
  while ((sm = re2.exec(tail))) segs.push(sm.slice(1, 5).map(Number));
  var inside = segs.filter(function (s) {
    var mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2;
    return mx > bleedRect.x + 0.01 && mx < bleedRect.x + bleedRect.w - 0.01 && my > bleedRect.y + 0.01 && my < bleedRect.y + bleedRect.h - 0.01;
  });
  check('2.12 the crop and bleed marks and the registration targets are outside the bleed, never over the artwork', segs.length >= 16 && inside.length === 0, { n: segs.length, inside: inside.slice(0, 3) });
  check('2.13 the slug line: the book, the page, the date, RGB', /QA COAST HOUSE/.test(t1.replace(/�/g, '')) || /COAST HOUSE/.test(t1), t1.split('\n').slice(-2));
  var imgs1 = imagesOf(doc, p1);
  /* the 4000 × 3000 photo in a 100 × 80 mm frame, cut at the bleed (−3 mm), at 300 ppi: 98 × 75 mm of it shows */
  var want1 = { w: Math.round((98 / 25.4) * 300), h: Math.round((80 / 25.4) * 300) };
  check('2.14 a photo is cut to what shows (the frame, inside the bleed) and made no larger than 300 ppi there', imgs1.length === 1 && Math.abs(imgs1[0].w - want1.w) <= 3 && Math.abs(imgs1[0].h - want1.h) <= 3 &&
    imgs1[0].filter === '/DCTDecode', { got: imgs1, want: want1 });
  var r0 = PIPE.renders.find(function (r) { return r.url === '/api/books/asset/as_00000000000000000001/print'; });
  check('2.15 …from the photo\'s print copy (the /print beside /display), and its cut is the canvas\'s (cover: 4000 × 3000 in 100 × 80 mm shows 3750 × 3000)', !!r0 && r0.crop.h === 3000 &&
    Math.abs(r0.crop.w - Math.round(3750 * 98 / 100)) <= 2 && r0.filter === '', r0);
  var imgs2 = imagesOf(doc, pages[1]);
  var smallOne = imgs2.find(function (i) { return i.w === 100 && i.h === 75; });
  check('2.16 a photo below 300 ppi is never enlarged: the 100 × 75 px photo goes in as it is (its own JPEG)', !!smallOne && smallOne.filter === '/DCTDecode' &&
    !PIPE.renders.some(function (r) { return r.url === '/small.jpg'; }), imgs2);
  var wideR = PIPE.renders.find(function (r) { return r.url === '/wide.jpg'; });
  check('2.17 a 2:1 photo in a square frame, focal point left: the left half, filtered as the canvas filters it (greyscale)', !!wideR && wideR.crop.x === 0 && wideR.crop.w === 1000 && wideR.crop.h === 1000 &&
    /grayscale\(100%\)/.test(wideR.filter) && wideR.outW === Math.round(60 / 25.4 * 300), wideR);
  check('2.18 a photo with transparency goes in as PNG with its mask', imgs2.some(function (i) { return i.smask && i.filter === '/FlateDecode'; }), imgs2);
  check('2.19 photos counted (the four with a photo), and those below the target (the small one, 64 ppi; the logo, 254 ppi)', res.images.count === 4 && res.images.belowTarget === 2, res.images);
  check('2.20 each photo opened is let go once its page is done', PIPE.opened > 0 && PIPE.opened === PIPE.closed, [PIPE.opened, PIPE.closed]);
  var c2 = contentOf(doc, pages[1]);
  check('2.21 a turned, see-through, dashed oval: rotation (cm with the angle\'s sine), opacity (ExtGState ca 0.5) and a dash pattern',
    c2.indexOf(Math.sin(15 * Math.PI / 180).toFixed(4).replace(/0+$/, '')) !== -1 && /\[[\d. ]+\] 0 d/.test(c2) && (function () {
      var gs = dictOf(doc, pages[1].node.Resources(), 'ExtGState'); return gs.entries().some(function (e) { var g = lookup(doc, e[1]); var ca = g.get(PL.PDFName.of('ca')); return ca && Math.abs(ca.asNumber() - 0.5) < 1e-6; });
    })(), c2.slice(0, 300));
  check('2.22 an empty photo frame prints blank, and the warning says so', res.warnings.some(function (w) { return /photo frame is empty and prints blank \(page 2\)/.test(w); }), res.warnings);
  var t3 = textOf(doc, pages[2]).join('|');
  check('2.23 the page number is the page\'s own, set in its font (Lexend)', /\b03\b/.test(t3) && Object.keys(fontsOf(doc, pages[2])).some(function (k) { return /Lexend/.test(fontsOf(doc, pages[2])[k].base); }), t3);
  check('2.24 the progress: fonts, then each page, its photos and charts, then finishing', prog[0][2] === 'Fonts' && prog.some(function (p) { return p[2] === 'Page 1 of 6: photos'; }) &&
    prog.some(function (p) { return p[2] === 'Page 1 of 6: charts'; }) && prog[prog.length - 1][0] === 6 && prog[prog.length - 1][1] === 6 && prog[prog.length - 1][2] === 'Finishing the PDF', prog);
  check('2.25 the file\'s cross-reference table points at every object (it is written as it is made)', xrefOk(rd.bytes) === 'ok', xrefOk(rd.bytes));
  check('2.26 fonts asked for without an optical size: the default cut the editor loads, draws and measures', FONT_ASKS.every(function (u) { return !/opsz=/.test(u); }) && FONT_ASKS.some(function (u) { return /family=Playfair%20Display&weight=700&italic=0/.test(u); }), FONT_ASKS.slice(0, 3));
  check('2.27 the chart\'s other weights: drawn with the nearest the family has, and said ("… 400 drawn with … 700")', res.warnings.some(function (w) { return w === 'Playfair Display 400 drawn with Playfair Display 700'; }), res.warnings);
  check('2.28 the fonts embedded are reported (and what they stand in for)', res.fonts.some(function (f) { return f.family === 'Playfair Display' && f.weight === 700 && f.embedded && /400/.test(f.reason || ''); }) &&
    res.fonts.some(function (f) { return f.family === 'Lexend' && f.embedded; }) && res.fonts.every(function (f) { return f.embedded; }), res.fonts);
  check('2.29 no word was squeezed (the measure is the font\'s own): no such warning', !res.warnings.some(function (w) { return /narrower or wider/.test(w); }), res.warnings);

  /* ---------- 2b review mode, spreads, ranges ---------- */
  var rv = await P.exportBookPdf(richBook(), Object.assign(P.defaultPdfOptions(b1, 'review'), { pages: { from: 2, to: 3 } }));
  var rdv = await read(rv);
  check('2.30 review: the trim only (MediaBox = TrimBox = BleedBox = the page), no marks; a page range', rv.pageCount === 2 && JSON.stringify(box(rdv.doc.getPage(0).getMediaBox())) === JSON.stringify([0, 0, pt(150), pt(200)]) &&
    JSON.stringify(box(rdv.doc.getPage(0).getTrimBox())) === JSON.stringify([0, 0, pt(150), pt(200)]) && JSON.stringify(box(rdv.doc.getPage(1).getMediaBox())) === JSON.stringify([0, 0, pt(200), pt(250)]) &&
    !/ m\n[\d.-]+ [\d.-]+ l\nS\n/.test(contentOf(rdv.doc, rdv.doc.getPage(1)).slice(-300)), box(rdv.doc.getPage(0).getMediaBox()));
  var sp = book([1, 2, 3, 4, 5, 6].map(function (n) { return page('s' + n, n === 1 ? 'front_cover' : n === 6 ? 'back_cover' : 'editorial_text', [text([20, 20, 100, 20], 'TEAM ' + ['', 'ACME', 'MOTH', 'COAST', 'HOUSE', 'MUSIC', 'MATCH'][n])]); }));
  var spr = await P.exportBookPdf(sp, Object.assign(P.defaultPdfOptions(sp, 'print'), { spreads: true }));
  var rsp = await read(spr), sps = rsp.doc.getPages();
  check('2.31 spreads: the cover alone, 2–3 and 4–5 side by side, the back cover alone', spr.pageCount === 4 && Math.abs(sps[1].getTrimBox().width - pt(400)) < 0.02 &&
    Math.abs(sps[0].getTrimBox().width - pt(200)) < 0.02 && Math.abs(sps[3].getTrimBox().width - pt(200)) < 0.02, sps.map(function (p) { return box(p.getTrimBox()); }));
  var spText = textOf(rsp.doc, sps[1]).join('|');
  check('2.32 …a spread sheet holds both pages\' words, sharing the spine (bleed on the outside only)', /TEAM MOTH/.test(spText) && /TEAM COAST/.test(spText) &&
    Math.abs(sps[1].getBleedBox().width - pt(406)) < 0.02, [spText, box(sps[1].getBleedBox())]);
  var spr2 = await P.exportBookPdf(sp, Object.assign(P.defaultPdfOptions(sp, 'review'), { spreads: true, pages: { from: 3, to: 6 } }));
  var rsp2 = await read(spr2);
  check('2.33 …a range that starts on a right-hand page sets that page alone: 3, 4–5, 6', spr2.pageCount === 3 && Math.abs(rsp2.doc.getPage(1).getMediaBox().width - pt(400)) < 0.02, rsp2.doc.getPages().map(function (p) { return box(p.getMediaBox()); }));
  var noMarks = await P.exportBookPdf(sp, Object.assign(P.defaultPdfOptions(sp, 'print'), { pages: { from: 1, to: 1 }, marks: { crop: false, bleed: false, registration: false, slug: false } }));
  var rnm = await read(noMarks);
  check('2.34 print without marks: the sheet is the trim and its bleed (no room for marks)', JSON.stringify(box(rnm.doc.getPage(0).getMediaBox())) === JSON.stringify([0, 0, pt(206), pt(256)]) &&
    JSON.stringify(box(rnm.doc.getPage(0).getTrimBox())) === JSON.stringify([pt(3), pt(3), pt(200), pt(250)]), box(rnm.doc.getPage(0).getMediaBox()));

  /* ---------- 2c fonts that can't be embedded ---------- */
  var gb = book([page('g1', 'editorial_text', [text([20, 20, 100, 20], 'THE COAST', { fontFamily: 'Georgia', fontWeight: 400 }), text([20, 50, 100, 20], 'ACME', {})])]);
  var thrown = null;
  try { await P.exportBookPdf(gb, P.defaultPdfOptions(gb, 'print')); } catch (e) { thrown = e; }
  check('2.35 print: a font that can\'t be embedded stops the PDF (PdfFontError), naming it and why; never another family', !!thrown && thrown.name === 'PdfFontError' && thrown instanceof P.PdfFontError &&
    thrown.fonts.length === 1 && thrown.fonts[0].family === 'Georgia' && thrown.fonts[0].weight === 400 && thrown.fonts[0].embedded === false && /isn't a Google font/.test(thrown.fonts[0].reason) && /Georgia 400/.test(thrown.message),
    thrown && { name: thrown.name, fonts: thrown.fonts, msg: thrown.message });
  var gr = await P.exportBookPdf(gb, P.defaultPdfOptions(gb, 'review'));
  var rgr = await read(gr), gt = textOf(rgr.doc, rgr.doc.getPage(0)).join('|'), gf = fontsOf(rgr.doc, rgr.doc.getPage(0));
  check('2.36 review: that text is set in a standard font (Helvetica), with a warning; the rest in its own font', /THE COAST/.test(gt) && /ACME/.test(gt) &&
    Object.keys(gf).some(function (k) { return /Helvetica/.test(gf[k].base); }) && gr.warnings.some(function (w) { return /Helvetica/.test(w) && /Georgia 400/.test(w); }) &&
    gr.fonts.some(function (f) { return f.family === 'Georgia' && f.embedded === false; }), { gt: gt, warnings: gr.warnings });
  var ib = book([page('i1', 'editorial_text', [text([20, 20, 100, 20], 'THE COAST', { fontStyle: 'italic' })])]);
  var ir = await P.exportBookPdf(ib, P.defaultPdfOptions(ib, 'print'));
  var ic = contentOf((await read(ir)).doc, (await read(ir)).doc.getPage(0));
  check('2.37 an italic the family lacks: the upright slanted (as a browser does), and said', ir.warnings.some(function (w) { return /Playfair Display 700 italic drawn with Playfair Display 700 \(slanted/.test(w); }) &&
    /1 0 0\.25 -1 /.test(ic), ir.warnings);

  /* ---------- 2d words measured with another face ---------- */
  P.setMeasure(mono);
  var mb = book([page('m1', 'editorial_text', [text([20, 20, 160, 40], 'THE COAST HOUSE MUSIC', {})])]);
  var mr = await P.exportBookPdf(mb, P.defaultPdfOptions(mb, 'review'));
  var mc = contentOf((await read(mr)).doc, (await read(mr)).doc.getPage(0));
  check('2.38 words the editor measured with another face keep their measured width (Tz), with a warning naming the font', /[\d.]+ Tz/.test(mc.replace(/\b100 Tz/g, '')) &&
    mr.warnings.some(function (w) { return /narrower or wider than the font's own widths/.test(w) && /a different version of this font/.test(w); }), mr.warnings);
  P.setMeasure(realMeasure);

  /* ---------- 2e cancelling ---------- */
  var ac = new AbortController(), abErr = null, steps = 0;
  try { await P.exportBookPdf(richBook(), P.defaultPdfOptions(b1, 'print'), function () { if (++steps === 3) ac.abort(); }, ac.signal); } catch (e) { abErr = e; }
  check('2.39 cancelling stops between steps with an AbortError', !!abErr && abErr.name === 'AbortError' && steps < 8, abErr && [abErr.name, steps]);
  var ac2 = new AbortController(); ac2.abort();
  var ab2 = null;
  try { await P.exportBookPdf(richBook(), P.defaultPdfOptions(b1, 'print'), null, ac2.signal); } catch (e) { ab2 = e; }
  check('2.40 …and before it starts', !!ab2 && ab2.name === 'AbortError');
  check('2.41 …and every photo it opened is let go', PIPE.opened === PIPE.closed, [PIPE.opened, PIPE.closed]);

  /* ---------- 2f a photo that can't be loaded; a long book ---------- */
  var lb = book([page('l1', 'editorial_text', [el('image', [10, 10, 50, 50], { image: { src: '/missing.jpg', alt: '', fit: 'cover', zoom: 1, focalX: 50, focalY: 50 } }), text([10, 70, 100, 20], 'ACME')])]);
  var lr = await P.exportBookPdf(lb, P.defaultPdfOptions(lb, 'print'));
  check('2.42 a photo that can\'t be loaded: the rest is made, and the warning names it', lr.pageCount === 1 && lr.warnings.some(function (w) { return /couldn't be loaded/.test(w) && /page 1/.test(w) && /HTTP 404/.test(w); }), lr.warnings);
  var longPages = [];
  for (var lp = 0; lp < 40; lp++) longPages.push(page('L' + lp, 'editorial_text', [el('image', [0, 0, 200, 250], { image: { src: lp % 2 ? '/wide.jpg' : '/small.jpg', alt: '', fit: 'cover', zoom: 1 + (lp % 3) * 0.1, focalX: 50, focalY: 50 } }), text([20, 200, 160, 20], 'THE COAST HOUSE ' + lp)]));
  var opened0 = PIPE.opened;
  var lg = await P.exportBookPdf(book(longPages), P.defaultPdfOptions(book(longPages), 'print'));
  var rlg = await read(lg);
  check('2.43 a 40-page photo book: every page, photos let go as it goes, the same cut of a photo embedded once', lg.pageCount === 40 && PIPE.opened === PIPE.closed &&
    PIPE.opened - opened0 <= 40 && xrefOk(rlg.bytes) === 'ok' && rlg.doc.context.enumerateIndirectObjects().filter(function (e) { var o = e[1]; return o instanceof PL.PDFRawStream && String(o.dict.get(PL.PDFName.of('Subtype'))) === '/Image'; }).length === 6,
    { pages: lg.pageCount, opened: PIPE.opened - opened0, images: rlg.doc.context.enumerateIndirectObjects().filter(function (e) { var o = e[1]; return o instanceof PL.PDFRawStream && String(o.dict.get(PL.PDFName.of('Subtype'))) === '/Image'; }).length });

  /* ---------- 2g a font whose glyphs have odd lengths (fontkit's subset fault, mended) ---------- */
  var oddB = book([page('o1', 'editorial_text', [text([20, 20, 160, 30], 'THE COAST HOUSE MUSIC ATOMIC', { fontFamily: 'Odd Serif' })])]);
  var oddR = await P.exportBookPdf(oddB, P.defaultPdfOptions(oddB, 'review'));
  var oddDoc = (await read(oddR)).doc, oddFonts = fontsOf(oddDoc, oddDoc.getPage(0));
  var oddFont = Object.keys(oddFonts).map(function (k) { return oddFonts[k]; }).find(function (f) { return f.type0; });
  var src = FK['odd serif'], sub = oddFont && fontkit.create(oddFont.program);
  var sameShapes = !!sub && 'THECOASUMI'.split('').every(function (ch) {
    var code = Array.from(oddFont.map.entries()).find(function (e) { return e[1] === ch; });
    if (!code) return false;
    return sub.getGlyph(parseInt(code[0], 16)).path.commands.length === src.glyphForCodePoint(ch.charCodeAt(0)).path.commands.length;
  });
  check('2.44 a font whose glyphs are an odd number of bytes long (as some Google fonts are) embeds whole: every glyph of the subset is the one drawn',
    ODD.length > 0 && FK['odd serif'].head.indexToLocFormat === 1 && sameShapes && /THE COAST HOUSE/.test(textOf(oddDoc, oddDoc.getPage(0)).join('')), { sameShapes: sameShapes, glyphs: sub && sub.numGlyphs });

  /* =================================================================================================================
     3 the parts: where a photo sits, which face is drawn, charts read as vectors
     ================================================================================================================= */
  var cv = P.imagePlacement(100, 80, 4000, 3000, 'cover', 1, 50, 50);
  check('3.1 a photo\'s place is the canvas\'s: cover fills the frame (100 × 80 shows 106.7 × 80, centred)', Math.abs(cv.w - 106.6667) < 1e-3 && Math.abs(cv.h - 80) < 1e-9 && Math.abs(cv.x + 3.3333) < 1e-3 && cv.y === 0, cv);
  var ct = P.imagePlacement(100, 80, 4000, 3000, 'contain', 1, 0, 100);
  check('3.2 …contain fits inside, the focal point setting where (object-position)', Math.abs(ct.w - 100) < 1e-9 && Math.abs(ct.h - 75) < 1e-9 && ct.x === 0 && Math.abs(ct.y - 5) < 1e-9, ct);
  var zm = P.imagePlacement(100, 80, 4000, 3000, 'cover', 2, 0, 50);
  check('3.3 …zoom scales the placed photo about the frame\'s centre (transform: scale)', Math.abs(zm.w - 213.3333) < 1e-3 && Math.abs(zm.x - (50 + 2 * (0 - 50))) < 1e-9 && Math.abs(zm.y - (40 + 2 * (0 - 40))) < 1e-9, zm);
  check('3.4 the canvas\'s filter, in its order', P.photoFilter({ brightness: 110, contrast: 106, grayscale: 100, sepia: 20 }) === 'brightness(110%) contrast(106%) grayscale(100%) sepia(20%)' &&
    P.photoFilter({ brightness: 100, contrast: 100 }) === '');
  var D = P.declsFromWeights([400, 500, 700], true);
  function cm(w, it, decls) { var m = P.cssMatch(decls || D, { weight: w, italic: it }); return m ? m.weight + (m.decl.italic ? 'i' : '') : null; }
  check('3.5 a weight the family lacks: the nearest as CSS chooses (450 → 500, 300 → 400, 600 → 700, 800 → 700)', cm(450, false) === '500' && cm(300, false) === '400' && cm(600, false) === '700' && cm(800, false) === '700' &&
    cm(450, false, P.declsFromWeights([400, 700], false)) === '400' && cm(500, true) === '500i' && cm(400, true, P.declsFromWeights([400], false)) === '400', [cm(450, false), cm(300, false), cm(600, false)]);
  check('3.6 …a variable face takes the weight asked for', P.cssMatch([{ min: 100, max: 900, italic: false }], { weight: 450, italic: false }).weight === 450);
  var svgC = P.compileSvg(P.renderInfographicToSvgString(chart, 320, 220));
  var arcs = svgC.items.filter(function (i) { return i.kind === 'path' && i.arcs; });
  check('3.7 a chart\'s SVG is read as shapes and words; a donut\'s segments as arcs', svgC.viewBox.w === 320 && svgC.viewBox.h === 220 && arcs.length === 2 &&
    Math.abs((arcs[0].arcs.spans[0][1] - arcs[0].arcs.spans[0][0]) - 2 * Math.PI * 20 / 50) < 1e-6 && Math.abs(arcs[1].arcs.spans[0][0] - 2 * Math.PI * 20 / 50) < 1e-6 &&
    svgC.items.some(function (i) { return i.kind === 'text' && i.text === 'TEAM' && i.family === 'Playfair Display' && i.weight === 700; }), arcs.map(function (a) { return a.arcs.spans; }));
  var every = 0, refused = [];
  var VARIANTS = ['kpi_grid', 'horizontal_bars', 'vertical_bars', 'donut_ring', 'radial_gauges', 'line_trend', 'horizontal_timeline', 'vertical_timeline', 'phased_gantt', 'process_steps', 'circular_workflow',
    'swot_matrix', 'before_after', 'org_hierarchy', 'strategy_pyramid', 'india_map_data', 'world_map_data', 'esg_pillars', 'milestone_zigzag', 'carbon_breakdown'];
  VARIANTS.forEach(function (v) {
    try { P.compileSvg(P.renderInfographicToSvgString(Object.assign({}, chart, { variant: v, items: [{ id: 'a', label: 'A & B', value: 20, unit: '%', description: 'x' }, { id: 'b', label: '<C>', value: 30 }, { id: 'c', label: 'D', value: 50 }] }), 400, 300)); every++; }
    catch (e) { refused.push(v + ': ' + e.message); }
  });
  check('3.8 every kind of chart the editor makes can be drawn as vectors (no picture fallback needed)', every === VARIANTS.length, refused);
  var unsup = ['<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs></svg>', '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="url(#g)"/></svg>', '<svg viewBox="0 0 10 10"><path d="M0 0 A 5 5 0 0 1 10 10"/></svg>',
    '<svg viewBox="0 0 10 10"><text x="1" y="1">a<tspan>b</tspan></text></svg>', '<svg viewBox="0 0 10 10"><image href="x.png"/></svg>'];
  check('3.9 what can\'t be drawn as vectors is refused before anything is drawn (gradient, pattern fill, arc, tspan, picture)', unsup.every(function (s) { try { P.compileSvg(s); return false; } catch (e) { return e.name === 'SvgUnsupported'; } }));
  var tr = P.compileSvg('<svg viewBox="0 0 100 50"><g transform="translate(10,5)"><circle cx="0" cy="0" r="4" transform="rotate(-90 0 0)" fill="none" stroke="#000" stroke-dasharray="3 3"/><text x="5" y="6" text-anchor="middle" letter-spacing="0.1em" font-size="10" style="font-family:\'Lora\'">A &amp; B</text></g></svg>');
  check('3.10 transforms nest; entities decode; dashes, letter spacing (em), anchors and the family are kept', tr.items.length === 2 && tr.items[0].m[4] === 10 && tr.items[0].m[5] === 5 &&
    Math.abs(tr.items[0].m[1] + 1) < 1e-9 && JSON.stringify(tr.items[0].paint.dash) === '[3,3]' && tr.items[1].text === 'A & B' && tr.items[1].anchor === 'middle' && Math.abs(tr.items[1].letterSpacing - 1) < 1e-9 &&
    tr.items[1].family === 'Lora', tr.items);

  /* ---------- 4 the source keeps its promises ---------- */
  var SRC = fs.readFileSync(path.join(ENGINES, 'pdfEngine.ts'), 'utf8') + fs.readFileSync(path.join(ENGINES, 'pdf', 'fonts.ts'), 'utf8');
  check('4.1 no bare "ET" in what the PDF or its warnings say', !/[^A-Za-z]ET[^A-Za-z0-9]/.test(SRC.replace(/ETB2B/g, '').replace(/\bET\b(?=\(\))/g, '').replace(/endText|beginText|ET\b(?= )/g, '')));
  check('4.2 the PDF never claims CMYK', !/CMYK(?! conversion)/.test(fs.readFileSync(path.join(ENGINES, 'pdfEngine.ts'), 'utf8').replace(/can't make CMYK|cannot make CMYK|no CMYK/g, '')));
  var PKG = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  check('4.3 @pdf-lib/fontkit at an exact version', /^\d+\.\d+\.\d+$/.test(PKG.dependencies['@pdf-lib/fontkit'] || ''), PKG.dependencies);

  P.setPdfEnvironment(null);
  process.stdout.write('books-pdf: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { process.stdout.write('books-pdf: crashed — ' + (e && e.stack || e) + '\n'); process.exit(1); });
