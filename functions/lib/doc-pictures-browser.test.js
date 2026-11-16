/* node functions/lib/doc-pictures-browser.test.js — the pictures inside a PDF or a deck, taken out in a real Chrome by
   the scripts the site editor loads (ai-docs-client.js → pdf-reader.js → the vendored PDF.js 4.10.38 → ai-doc-pictures.js;
   owner, 16 Nov 2026: "use the images from this pdf and try to well accommodate them in this website"):
     1. a small PDF made here — a photograph, a black mask laid over a page, a small logo, a flat two-colour graphic, a
        portrait photograph, the first photograph painted again and a near copy of it: the two photographs are kept
        (each at most 1600 px, with a small copy, its page, its share of the page and the page's words), the rest left
        out and counted; the file itself still goes with the message;
     2. the same PDF as one too large to send (the cap lowered for the test): its words, page by page, and no file;
     3. a deck (.pptx) made here: its slide's photograph is kept and its small logo left out;
     4. PDF.js through pdf-reader.js draws a page (as the console's speaker tools do with a brochure).
   It needs Chrome, puppeteer-core and sharp (CHROME_PATH / RV_PUPPETEER, else the usual places); without them it says so
   and passes. No network: a small local server answers the scripts and the fixtures. Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http');
var ROOT = path.join(__dirname, '..', '..');
var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 600) : '')); }
function finish() {
  if (failures.length) { console.error('doc-pictures-browser: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('doc-pictures-browser: all ' + checks + ' checks passed');
  process.exit(0);
}
function driver() {
  var tries = [process.env.RV_PUPPETEER, 'puppeteer-core', path.join(process.env.HOME || '', '.revamp-cms-qa', 'node_modules', 'puppeteer-core'), path.join(process.env.HOME || '', '.revamp-cms-qa', 'lh', 'node_modules', 'puppeteer-core')].filter(Boolean);
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]); } catch (e) { /* next */ } }
  return null;
}
var CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
var puppeteer = driver(), sharp = null, JSZip = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }
try { JSZip = require('jszip'); } catch (e) { JSZip = null; }
if (!puppeteer || !CHROME || !sharp || !JSZip) { console.log('doc-pictures-browser: skipped — no Chrome / puppeteer-core / sharp / jszip here (set CHROME_PATH and RV_PUPPETEER)'); process.exit(0); }

/* a photograph-like picture: smooth light and shade with fine texture, many colours */
function photo(w, h, seed) {
  var raw = Buffer.alloc(w * h * 3);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var o = (y * w + x) * 3, t = Math.sin((x + seed * 37) / 53) * Math.cos((y - seed * 11) / 41);
    raw[o] = Math.max(0, Math.min(255, 120 + 90 * t + ((x * 7 + y * 13 + seed) % 29)));
    raw[o + 1] = Math.max(0, Math.min(255, 100 + 80 * Math.sin((x + y) / 97 + seed) + ((x * 3 + y * 5) % 23)));
    raw[o + 2] = Math.max(0, Math.min(255, 140 + 70 * Math.cos(y / 61 - seed) + ((x * 11) % 19)));
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } });
}
function flat(w, h) {
  var raw = Buffer.alloc(w * h * 3);
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var o = (y * w + x) * 3, inner = x > w / 4 && x < 3 * w / 4 && y > h / 4 && y < 3 * h / 4;
    raw[o] = inner ? 255 : 200; raw[o + 1] = inner ? 255 : 16; raw[o + 2] = inner ? 255 : 46;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } });
}
/* A PDF of 1440 x 810 pages. pages: [{ text, draws: [{ img (index into images), x, y, w, h }] }]; images: [{ jpeg, w, h }]. */
function makePdf(pages, images) {
  var objs = [], n = 0;
  function add(body) { objs.push(body); return ++n; }
  var catalog = add(null), pagesObj = add(null), font = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  var imgIds = images.map(function (im) {
    return add(Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.jpeg.length + ' >>\nstream\n'), im.jpeg, Buffer.from('\nendstream')]));
  });
  var kids = pages.map(function (pg) {
    var ops = pg.draws.map(function (d) { return 'q ' + d.w + ' 0 0 ' + d.h + ' ' + d.x + ' ' + d.y + ' cm /Im' + d.img + ' Do Q'; }).join('\n') +
      '\nBT /F1 28 Tf 72 760 Td (' + pg.text.replace(/[()\\]/g, '') + ') Tj ET';
    var content = add(Buffer.from('<< /Length ' + Buffer.byteLength(ops) + ' >>\nstream\n' + ops + '\nendstream'));
    var xobj = images.map(function (im, i) { return '/Im' + i + ' ' + imgIds[i] + ' 0 R'; }).join(' ');
    return add(Buffer.from('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 1440 810] /Resources << /Font << /F1 ' + font + ' 0 R >> /XObject << ' + xobj + ' >> >> /Contents ' + content + ' 0 R >>'));
  });
  objs[catalog - 1] = Buffer.from('<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>');
  objs[pagesObj - 1] = Buffer.from('<< /Type /Pages /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>');
  var parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')], offsets = [], at = parts[0].length;
  objs.forEach(function (body, i) {
    var chunk = Buffer.concat([Buffer.from((i + 1) + ' 0 obj\n'), body, Buffer.from('\nendobj\n')]);
    offsets.push(at); parts.push(chunk); at += chunk.length;
  });
  var xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(function (o) { return String(o).padStart(10, '0') + ' 00000 n \n'; }).join('');
  parts.push(Buffer.from(xref + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + at + '\n%%EOF\n'));
  return Buffer.concat(parts);
}
function makePptx(photoJpeg, logoPng) {
  var z = new JSZip();
  var P = 'http://schemas.openxmlformats.org/presentationml/2006/main', A = 'http://schemas.openxmlformats.org/drawingml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/></Types>');
  z.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="' + P + '" xmlns:r="' + R + '"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>');
  z.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0"?><Relationships xmlns="' + REL + '"><Relationship Id="rId2" Type="' + R + '/slide" Target="slides/slide1.xml"/></Relationships>');
  z.file('ppt/slides/slide1.xml', '<?xml version="1.0"?><p:sld xmlns:p="' + P + '" xmlns:a="' + A + '"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>The Swiss Arc: Zurich to Davos</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  z.file('ppt/slides/_rels/slide1.xml.rels', '<?xml version="1.0"?><Relationships xmlns="' + REL + '"><Relationship Id="rId1" Type="' + R + '/image" Target="../media/image1.jpeg"/><Relationship Id="rId2" Type="' + R + '/image" Target="../media/image2.png"/></Relationships>');
  z.file('ppt/media/image1.jpeg', photoJpeg);
  z.file('ppt/media/image2.png', logoPng);
  return z.generateAsync({ type: 'nodebuffer' });
}

(async function () {
  var p1 = await photo(1800, 1012, 1).jpeg({ quality: 88 }).toBuffer();
  var near = await photo(1800, 1012, 1).resize(1500, 843).jpeg({ quality: 60 }).toBuffer();
  var mask = await sharp({ create: { width: 2000, height: 900, channels: 3, background: '#000000' } }).jpeg().toBuffer();
  var logo = await flat(192, 144).jpeg({ quality: 92 }).toBuffer();
  var graphic = await flat(800, 600).jpeg({ quality: 92 }).toBuffer();
  var portrait = await photo(900, 1600, 7).jpeg({ quality: 85 }).toBuffer();
  var images = [{ jpeg: p1, w: 1800, h: 1012 }, { jpeg: mask, w: 2000, h: 900 }, { jpeg: logo, w: 192, h: 144 }, { jpeg: graphic, w: 800, h: 600 }, { jpeg: portrait, w: 900, h: 1600 }, { jpeg: near, w: 1500, h: 843 }];
  var PDF = makePdf([
    { text: 'THE WEEK in Davos', draws: [{ img: 0, x: 0, y: 0, w: 1440, h: 810 }] },
    { text: 'THE DAVOS EXPERIENCE', draws: [{ img: 0, x: 0, y: 0, w: 1440, h: 810 }, { img: 1, x: 0, y: 0, w: 1440, h: 810 }, { img: 2, x: 40, y: 40, w: 96, h: 72 }] },
    { text: 'THE SWISS ARC 5 DAYS', draws: [{ img: 3, x: 100, y: 100, w: 600, h: 450 }, { img: 4, x: 1000, y: 0, w: 440, h: 782 }] },
    { text: 'THANK YOU', draws: [{ img: 5, x: 0, y: 0, w: 1440, h: 810 }] }
  ], images);
  var PPTX = await makePptx(await photo(1600, 1000, 3).jpeg({ quality: 85 }).toBuffer(), await flat(200, 120).png().toBuffer());

  var TYPES = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };
  var server = http.createServer(function (req, res) {
    var u = req.url.split('?')[0];
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><html><head><meta charset="utf-8"><title>t</title><script src="/ai-docs-client.js"></script></head><body></body></html>'); }
    if (u === '/fixture.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end(PDF); }
    if (u === '/fixture.pptx') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(PPTX); }
    var allowed = ['/ai-docs-client.js', '/pdf-reader.js', '/ai-doc-pictures.js', '/assets/vendor/jszip.min.js', '/assets/vendor/pdfjs/pdf-4.10.38.min.js', '/assets/vendor/pdfjs/pdf.worker-4.10.38.min.js'];
    if (allowed.indexOf(u) === -1) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(u)] || 'application/octet-stream' });
    res.end(fs.readFileSync(path.join(ROOT, u)));
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var base = 'http://127.0.0.1:' + server.address().port;
  var browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-first-run'] });
  try {
    var page = await browser.newPage();
    var errors = [];
    page.on('pageerror', function (e) { errors.push(e.message); });
    await page.goto(base + '/', { waitUntil: 'load' });
    var r = await page.evaluate(async function () {
      async function file(url, name, type) { var b = await (await fetch(url)).blob(); return new File([b], name, { type: type }); }
      var steps = [];
      var f = await file('/fixture.pdf', 'Davos deck.pdf', 'application/pdf');
      var doc = await window.RevampAiDocs.read(f, { pictures: true, onProgress: function (t) { steps.push(t); } });
      var pics = [];
      for (var i = 0; i < doc.pictures.length; i++) {
        var p = doc.pictures[i], bm = await createImageBitmap(p.full), tb = await createImageBitmap(p.thumb);
        pics.push({ page: p.page, w: p.w, h: p.h, share: p.share, words: p.words, full: [bm.width, bm.height, p.full.type], thumb: [tb.width, tb.height, p.thumb.type] });
      }
      var out = { pages: doc.pages, data: !!doc.data, leftOut: doc.leftOut, pics: pics, steps: steps };
      /* too large to send: the words, page by page, and no file */
      window.RevampAiDocs.CAPS.pdfBytes = 1000;
      var big = await window.RevampAiDocs.read(await file('/fixture.pdf', 'big.pdf', 'application/pdf'), { pictures: true });
      out.big = { data: !!big.data, text: big.text, cut: big.cut, pictures: big.pictures.length };
      var refused = null;
      try { await window.RevampAiDocs.read(await file('/fixture.pdf', 'big.pdf', 'application/pdf')); } catch (e) { refused = e.message; }
      out.refused = refused;
      window.RevampAiDocs.CAPS.pdfBytes = 10 * 1024 * 1024;
      /* a deck */
      var deck = await window.RevampAiDocs.read(await file('/fixture.pptx', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), { pictures: true });
      out.deck = { text: deck.text, pictures: deck.pictures.map(function (p) { return { page: p.page, w: p.w, h: p.h, words: p.words }; }), leftOut: deck.leftOut };
      var plain = await window.RevampAiDocs.read(await file('/fixture.pptx', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
      out.deckPlain = { pictures: plain.pictures === undefined };
      /* PDF.js draws a page, as the speaker tools do */
      var R = window.RevampPdf, pdf = await R.open(new Uint8Array(await (await fetch('/fixture.pdf')).arrayBuffer()));
      var pg = await pdf.getPage(1), vp = pg.getViewport({ scale: 0.25 }), c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      var px = c.getContext('2d').getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data;
      out.render = { w: c.width, h: c.height, centre: [px[0], px[1], px[2], px[3]], pages: pdf.numPages, version: R.VERSION };
      out.scripts = Array.prototype.map.call(document.querySelectorAll('script'), function (s) { return s.type === 'module' ? 'module' : s.getAttribute('src'); });
      return out;
    });
    ok(!errors.length, '0 no page errors', errors);
    ok(r.pages === 4 && r.data === true, '1 a PDF that fits still goes as the file', { pages: r.pages, data: r.data });
    ok(r.pics.length === 2 && r.pics[0].page === 1 && r.pics[1].page === 3, '1 the two photographs are kept, page by page', r.pics.map(function (p) { return [p.page, p.w, p.h]; }));
    ok(r.pics[0].w === 1600 && r.pics[0].h === 900 && r.pics[0].full[0] === 1600 && r.pics[0].full[2] === 'image/jpeg' && r.pics[0].thumb[0] === 400 && r.pics[0].thumb[2] === 'image/jpeg',
      '1 each as a JPEG of at most 1600 px, with a small copy of at most 400 px', r.pics[0]);
    ok(r.pics[1].w === 900 && r.pics[1].h === 1600 && r.pics[1].thumb[1] === 400, '1 a portrait one keeps its shape', r.pics[1]);
    ok(r.pics[0].share === 1 && r.pics[1].share > 0.25 && r.pics[1].share < 0.35, '1 how much of its page each covers', [r.pics[0].share, r.pics[1].share]);
    ok(r.pics[0].words === 'THE WEEK in Davos' && r.pics[1].words === 'THE SWISS ARC 5 DAYS', '1 with its page\'s words', [r.pics[0].words, r.pics[1].words]);
    ok(r.leftOut.plain === 1 && r.leftOut.small === 1 && r.leftOut.flat === 1 && r.leftOut.repeat === 2 && r.leftOut.over === 0 && r.leftOut.unread === 0,
      '1 left out and counted: the black mask, the small logo, the flat graphic, and the photograph painted again and its near copy', r.leftOut);
    ok(r.steps.some(function (s) { return /Taking the pictures out of page 3 of 4/.test(s); }), '1 how it goes is said, page by page', r.steps);
    ok(r.big.data === false && /^Page 1:\nTHE WEEK in Davos\n\nPage 2:\nTHE DAVOS EXPERIENCE/.test(r.big.text) && /Page 4:\nTHANK YOU/.test(r.big.text) && r.big.pictures === 2 && r.big.cut === false,
      '2 too large to send: its words, page by page, and its pictures, but no file', r.big);
    ok(/is [0-9.]+ MB\. A PDF can be at most 10 MB/.test(r.refused || ''), '2 a page that does not take pictures still refuses one too large', r.refused);
    ok(r.deck.pictures.length === 1 && r.deck.pictures[0].page === 1 && r.deck.pictures[0].w === 1600 && r.deck.pictures[0].h === 1000 && r.deck.pictures[0].words === 'The Swiss Arc: Zurich to Davos' &&
      r.deck.leftOut.small === 1 && /Slide 1:\nThe Swiss Arc: Zurich to Davos/.test(r.deck.text), '3 a deck: its slide\'s photograph kept with the slide\'s words, its small logo left out', r.deck);
    ok(r.deckPlain.pictures === true, '3 a page that does not ask for pictures gets none taken out');
    ok(r.render.pages === 4 && r.render.w === 360 && r.render.h === 203 && r.render.centre[3] === 255 && (r.render.centre[0] + r.render.centre[1] + r.render.centre[2]) > 0 && r.render.version === '4.10.38',
      '4 PDF.js (4.10.38, from this site) draws a page, as the speaker tools do with a brochure', r.render);
    ok(r.scripts.filter(function (s) { return s === '/pdf-reader.js'; }).length === 1 && r.scripts.filter(function (s) { return s === '/ai-doc-pictures.js'; }).length === 1 &&
      r.scripts.filter(function (s) { return s === 'module'; }).length === 1, '4 each script loaded once, the library by one module script', r.scripts);
  } catch (e) {
    ok(false, 'the browser run', e && e.stack || String(e));
  }
  await browser.close();
  server.close();
  finish();
})().catch(function (e) { console.error('CRASH', e && e.stack || e); process.exit(1); });
