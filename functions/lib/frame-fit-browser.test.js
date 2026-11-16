/* node functions/lib/frame-fit-browser.test.js — a picture made for a frame has the frame's shape, in a real Chrome.
   The owner, 16 Nov 2026 (ET DAVOS 2027): "the image dimension issue is still not fixed. AI has created a square image for
   a rectangular placeholder". A rework laid the new picture out as a band three times as wide as tall, and the next one
   in a card taller than the picture, with white above and below it. Checked here on those very layouts:
     1. editor-ai-picture.js RevampAiPicture.fitFrame — the frame a rework added holds the shape the picture was made in,
        at 1440 and at 390, and the picture fills it; a picture laid as a layer, or in a layout that will not take the
        shape, only gets cover; a logo is left alone;
     2. editor-canvas.js coverPicture — a picture put in a box of another shape is drawn with object-fit: cover (never
        squashed, never letterboxed), the owner's own too; a logo keeps its fit;
     3. editor-canvas.js atDesktop — measured on the desktop layout from a phone-width canvas, the frame put back after.
   It needs Chrome and puppeteer-core (CHROME_PATH / RV_PUPPETEER, else the usual places); without them it says so and
   passes. No network: the pages are written here. Exits 1 listing every failure. */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var PICTURE_SRC = fs.readFileSync(path.join(ROOT, 'editor-ai-picture.js'), 'utf8');
var CANVAS_SRC = fs.readFileSync(path.join(ROOT, 'editor-canvas.js'), 'utf8');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 500) : '')); }
function finish() {
  if (failures.length) { console.error('frame-fit-browser: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('frame-fit-browser: all ' + checks + ' checks passed');
  process.exit(0);
}
function driver() {
  var tries = [process.env.RV_PUPPETEER, 'puppeteer-core', path.join(process.env.HOME || '', '.revamp-cms-qa', 'node_modules', 'puppeteer-core')].filter(Boolean);
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]); } catch (e) { /* next */ } }
  return null;
}
var CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).filter(function (p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })[0];
var puppeteer = driver();
if (!puppeteer || !CHROME) { console.log('frame-fit-browser: skipped — no Chrome / puppeteer-core here (set CHROME_PATH and RV_PUPPETEER)'); process.exit(0); }

/* the canvas's own functions, taken from editor-canvas.js as they are */
function grab(re, what) {
  var m = re.exec(CANVAS_SRC);
  if (!m) { ok(false, 'editor-canvas.js has ' + what); return ''; }
  return m[0];
}
var COVER_SRC = grab(/var LOGO_PLACE = [^\n]*\n\s*function coverPicture\(img\) \{[\s\S]*?\n    \}\n/, 'coverPicture');
var DESKTOP_SRC = grab(/function atDesktop\(fn\) \{[\s\S]*?\n    \}\n/, 'atDesktop');
ok(/coverPicture\(el\);\s*\n\s*return;/.test(CANVAS_SRC), 'setPicture draws an <img> it puts a picture in with cover (coverPicture)');

/* a picture of a given shape, as an SVG with its own size */
function pic(w, h) { return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><rect width="100%" height="100%" fill="#c62"/></svg>'); }
var LONG = Array(9).join('Selected delegates will take part in a professionally produced leadership conversation about their journey and their industry. ');
/* the frames the Davos reworks wrote (turn 8's band; turn 9's ET Studio card), and a few others */
var PAGE = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
  '*{box-sizing:border-box}body{margin:0;font:18px/1.6 sans-serif}' +
  '[data-rv-section]{position:relative;padding:48px 0}' +
  '.kdp-container{max-width:1200px;margin:0 auto;padding:0 24px}' +
  '.kdp-media{width:100%;height:clamp(220px,32vw,380px);margin:0 0 32px;overflow:hidden}' +
  '.kdp-img{display:block;width:100%;height:100%;object-fit:cover}' +
  '@media (max-width:640px){.kdp-media{height:220px}}' +
  '.panel{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:stretch;background:#fff;max-width:1200px;margin:0 auto}' +
  '.panel-media{background:#fff;display:flex;align-items:center}' +
  '.panel-img{width:100%;height:auto}' +
  '@media (max-width:820px){.panel{grid-template-columns:1fr}}' +
  '.layer-sec{min-height:600px}.layer{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}' +
  '.fig{margin:0;max-width:600px}.fig-img{width:100%;height:320px}' +
  '.mat{padding:16px;background:#fff;height:420px;max-width:700px}.mat-img{width:100%;height:auto}' +
  '.logo-row img{width:200px;height:80px;object-fit:contain}' +
  '.row{display:flex;gap:24px;max-width:1200px}.row-media{flex:0 0 50%;background:#fff;display:flex;align-items:center}.row-media img{width:100%;height:auto}' +
  '.stack{display:flex;flex-direction:column;max-width:800px}.stack-media{background:#fff;height:500px;display:flex;align-items:center}.stack-media img{width:100%;height:auto}' +
  '.late{display:grid;grid-template-columns:1fr 1fr;gap:32px;max-width:1200px}.late-media{background:#fff}.late-media img{width:100%;height:auto}' +
  '</style></head><body>' +
  '<section data-rv-section="kdp"><div class="kdp-container"><div class="kdp-media"><img class="kdp-img" src="' + pic(2100, 900) + '" alt="Two armchairs"></div><h2>See India through a global lens</h2></div></section>' +
  '<section data-rv-section="studio"><div class="panel"><div class="panel-media"><img class="panel-img" src="' + pic(1600, 1200) + '" alt="An interview set"></div><div class="panel-body"><h3>Your leadership conversation</h3><p>' + LONG + '</p></div></div></section>' +
  '<section data-rv-section="layer" class="layer-sec"><img class="layer" src="' + pic(1600, 900) + '" alt="A hall"><h2 style="position:relative">Over the picture</h2></section>' +
  '<section data-rv-section="fig"><figure class="fig"><img class="fig-img" src="' + pic(1600, 900) + '" alt="A hall"><figcaption>The hall</figcaption></figure></section>' +
  '<section data-rv-section="mat"><div class="mat"><img class="mat-img" src="' + pic(1600, 900) + '" alt="A lobby"></div></section>' +
  '<section data-rv-section="logos" class="logo-row"><img class="partner-logo" src="' + pic(300, 100) + '" alt="Acme logo"></section>' +
  '<section data-rv-section="row"><div class="row"><div class="row-media"><img class="row-img" src="' + pic(1600, 900) + '" alt="A hall"></div><div class="row-body"><p>' + LONG + '</p></div></div></section>' +
  '<section data-rv-section="stack"><div class="stack"><div class="stack-media"><img class="stack-img" src="' + pic(1600, 900) + '" alt="A hall"></div><p>Below the picture.</p></div></section>' +
  '<section data-rv-section="late"><div class="late"><div class="late-media"><img class="late-img" src="http://127.0.0.1:9/not-here-yet.png" alt="A picture still on its way"></div><div><p>' + LONG + '</p></div></div></section>' +
  '</body></html>';

(async function () {
  var browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--disable-extensions'] });
  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setContent(PAGE, { waitUntil: 'load' });
    await page.addScriptTag({ content: PICTURE_SRC });
    ok(await page.evaluate(function () { return !!(window.RevampAiPicture && window.RevampAiPicture.fitFrame); }), 'editor-ai-picture.js offers fitFrame');

    function measure(sel) {
      return page.evaluate(function (sel) {
        var img = document.querySelector(sel), box = img, sec = img.closest('[data-rv-section]');
        for (var i = 0; i < 3 && box.parentElement && box.parentElement !== sec && box.parentElement.children.length === 1; i++) box = box.parentElement;
        var a = img.getBoundingClientRect(), b = box.getBoundingClientRect();
        var col = box.parentElement.getBoundingClientRect(), cs = getComputedStyle(box.parentElement);
        var colRight = col.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
        return { img: [a.width, a.height], frame: [b.width, b.height], right: b.right, colRight: colRight, fit: getComputedStyle(img).objectFit, style: img.getAttribute('style') || '', frameStyle: box === img ? '' : (box.getAttribute('style') || '') };
      }, sel);
    }
    function fit(sel, frame) {
      return page.evaluate(function (sel, frame) { var r = window.RevampAiPicture.fitFrame(document.querySelector(sel), frame, {}); return { shaped: r.shaped, el: r.el ? r.el.className : '' }; }, sel, frame);
    }
    function ratio(wh) { return wh[1] ? wh[0] / wh[1] : 0; }
    function near(a, b) { return Math.abs(Math.log(a / b)) < 0.02; }

    /* 1a. turn 8's band */
    var before = await measure('.kdp-img');
    ok(near(ratio(before.frame), 1152 / 380), 'the band as the rework wrote it is 3:1 at 1440 (the 4:3 picture lost its armchairs)', before);
    var r1 = await fit('.kdp-img', '21:9');
    var band = await measure('.kdp-img');
    ok(r1.shaped === true && r1.el === 'kdp-media' && near(ratio(band.frame), 21 / 9) && Math.abs(band.img[0] - band.frame[0]) < 1.5 && Math.abs(band.img[1] - band.frame[1]) < 1.5 && band.fit === 'cover',
      'turn 8\'s band holds 21:9 at 1440, the picture filling it', { r: r1, band: band });
    await page.setViewport({ width: 390, height: 844 });
    var band390 = await measure('.kdp-img');
    ok(near(ratio(band390.frame), 21 / 9) && Math.abs(band390.img[1] - band390.frame[1]) < 1.5, '…and at 390 (its own media rule for phones is overruled: the frame keeps the picture\'s shape)', band390);
    await page.setViewport({ width: 1440, height: 900 });

    /* 1b. turn 9's ET Studio card: a column stretched to the text, the picture centred in it with white above and below */
    var card0 = await measure('.panel-img');
    ok(card0.frame[1] > card0.img[1] + 40, 'the card as the rework wrote it leaves white above and below the picture', card0);
    var r2 = await fit('.panel-img', '4:3');
    var card = await measure('.panel-img');
    ok(r2.shaped === true && r2.el === 'panel-media' && near(ratio(card.frame), 4 / 3) && Math.abs(card.img[1] - card.frame[1]) < 1.5 && Math.abs(card.img[0] - card.frame[0]) < 1.5,
      'the card\'s frame holds 4:3 and the picture fills it: no white band inside it', { r: r2, card: card });
    ok(Math.abs(card.frame[0] - card0.frame[0]) < 1.5 && card.right <= card.colRight + 1.5,
      'and it keeps its column\'s width: it never runs into the words beside it (stretched to the row\'s height, it took its width from it)', { before: card0, after: card });
    await page.setViewport({ width: 390, height: 844 });
    var card390 = await measure('.panel-img');
    ok(near(ratio(card390.frame), 4 / 3) && Math.abs(card390.img[1] - card390.frame[1]) < 1.5, '…and at 390, one column', card390);
    await page.setViewport({ width: 1440, height: 900 });

    /* 1c. a layer over the section: a background in all but name — only cover */
    var r3 = await fit('.layer', '16:9');
    var layer = await measure('.layer');
    ok(r3.shaped === false && layer.fit === 'cover' && !/aspect-ratio/.test(layer.style), 'a picture laid as a layer over the section only gets cover (it was contain: letterboxed)', { r: r3, layer: layer });
    /* 1d. a picture with its caption: the picture is its own frame */
    var r4 = await fit('.fig-img', '16:9');
    var fig = await measure('.fig-img');
    ok(r4.shaped === true && r4.el === 'fig-img' && near(ratio(fig.img), 16 / 9) && fig.fit === 'cover', 'a picture beside its caption is its own frame, held to 16:9', { r: r4, fig: fig });
    /* 1e. a frame with a mat: the picture fills inside it */
    var r5 = await fit('.mat-img', '16:9');
    var mat = await measure('.mat-img');
    ok(r5.shaped === true && near(ratio(mat.frame), 16 / 9) && mat.fit === 'cover', 'a frame with a mat around the picture holds the shape, the picture filling inside the mat', { r: r5, mat: mat });
    /* 1f. a logo */
    var r6 = await fit('.partner-logo', '16:9');
    var logo = await measure('.partner-logo');
    ok(r6.shaped === false && r6.el === '' && logo.fit === 'contain' && logo.style === '', 'a logo is left as it is', { r: r6, logo: logo });
    /* a flex row: half the row, its height from the shape, not the text's */
    var row0 = await measure('.row-img');
    var r8 = await fit('.row-img', '16:9');
    var row = await measure('.row-img');
    ok(r8.shaped === true && near(ratio(row.frame), 16 / 9) && Math.abs(row.frame[0] - row0.frame[0]) < 1.5 && row.right <= row.colRight + 1.5 && Math.abs(row.img[1] - row.frame[1]) < 1.5,
      'in a flex row: the frame keeps its half of the row and takes the shape, the picture filling it', { before: row0, after: row });
    /* a flex column: its fixed 500px box is the frame, given the shape and the full width */
    var r9 = await fit('.stack-img', '16:9');
    var stack = await measure('.stack-img');
    ok(r9.shaped === true && near(ratio(stack.frame), 16 / 9) && stack.right <= stack.colRight + 1.5 && Math.abs(stack.img[1] - stack.frame[1]) < 1.5,
      'in a flex column: the frame takes the shape at its full width', stack);
    /* a picture that has not arrived yet: the frame is shaped by its column, not by the picture's own size */
    var late0 = await measure('.late-img');
    var r10 = await fit('.late-img', '4:3');
    var late = await measure('.late-img');
    ok(r10.shaped === true && near(ratio(late.frame), 4 / 3) && Math.abs(late.frame[0] - late0.frame[0]) < 1.5 && late.right <= late.colRight + 1.5,
      'a picture still on its way gets a frame of the column\'s width in the shape', { before: late0, after: late });
    /* no frame known: cover only */
    await page.setContent(PAGE, { waitUntil: 'load' });
    await page.addScriptTag({ content: PICTURE_SRC });
    var r7 = await fit('.kdp-img', '');
    var plain = await measure('.kdp-img');
    ok(r7.shaped === false && plain.fit === 'cover' && !/aspect-ratio/.test(plain.frameStyle), 'without a shape to hold, the frame is left as it is and the picture drawn cover', { r: r7, plain: plain });

    /* 1g. the owner's saved page (ET DAVOS 2027, 16 Nov 2026: "the image dimension issue is still not fixed"): What Awaits
       You's 1184 x 864 picture in a band of 1152 x 240, Key Discussion Points' 1536 x 672 in 1152 x 210 — after a rework,
       every picture of the event's own holds its own shape (holdOwnFrames); another site's picture and a logo are not
       touched, and a frame already in its picture's shape is left as it is */
    var OWN = 'https://storage.googleapis.com/test-bucket/events/qa-davos/';
    await page.setContent('<!DOCTYPE html><html><head><style>*{box-sizing:border-box}body{margin:0}[data-rv-section]{padding:40px 0}' +
      '.wrap{max-width:1200px;margin:0 auto;padding:0 24px}.band{width:100%;height:240px;overflow:hidden;border-radius:12px}.band img{display:block;width:100%;height:100%;object-fit:cover}' +
      '.strip{height:210px}.ok{height:auto}.ok img{height:auto;aspect-ratio:16/9}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:24px}.cards div{height:120px;background:#eee}' +
      '@media (max-width:640px){.band{height:160px}}</style></head><body>' +
      '<section data-rv-section="what-awaits"><div class="wrap"><h2>What Awaits You</h2><div class="band"><img class="aw" src="' + OWN + 'generated/aw.png" alt="A promenade"></div>' +
      '<div class="band strip"><img class="kdp" src="' + OWN + 'chat-docs/20261116060114-abc123/k-0123456789ab-p5.jpg" alt="A lounge"></div>' +
      '<div class="band"><img class="other" src="https://elsewhere.example/x.png" alt="Not ours"></div>' +
      '<div class="band ok"><img class="fine" src="' + OWN + 'generated/fine.png" alt="Already right"></div>' +
      '<div class="band"><img class="logo-img" src="' + OWN + 'media/logo.png" alt="ET DAVOS logo"></div>' +
      '<div class="cards"><div></div><div></div><div></div><div></div></div></div></section></body></html>', { waitUntil: 'load' });
    await page.addScriptTag({ content: PICTURE_SRC });
    var held = await page.evaluate(function (own) {
      var sizes = {}; sizes[own + 'generated/aw.png'] = { w: 1184, h: 864 }; sizes[own + 'chat-docs/20261116060114-abc123/k-0123456789ab-p5.jpg'] = { w: 1536, h: 672 };
      sizes[own + 'generated/fine.png'] = { w: 1600, h: 900 }; sizes['https://elsewhere.example/x.png'] = { w: 900, h: 1600 }; sizes[own + 'media/logo.png'] = { w: 300, h: 300 };
      function box(sel) { var b = document.querySelector(sel).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }
      var before = { aw: box('.aw'), kdp: box('.kdp'), other: box('.other'), fine: box('.fine') };
      var out = window.RevampAiPicture.holdOwnFrames(document.querySelector('[data-rv-section]'), function (src) { return sizes[src] || null; }, { eventId: 'qa-davos' });
      return { out: out, before: before, after: { aw: box('.aw'), kdp: box('.kdp'), other: box('.other'), fine: box('.fine'), logo: box('.logo-img') },
        styles: { other: document.querySelector('.other').getAttribute('style') || '', fine: document.querySelector('.fine').getAttribute('style') || '', logo: document.querySelector('.logo-img').getAttribute('style') || '' } };
    }, OWN);
    ok(near(ratio(held.before.aw), 1152 / 240) && near(ratio(held.after.aw), 1184 / 864) && Math.abs(held.after.aw[0] - held.before.aw[0]) < 1.5,
      'What Awaits You\'s 4:3 picture, in a band 4.8 times as wide as tall, gets a frame of its own shape at the same width', held);
    ok(near(ratio(held.after.kdp), 1536 / 672) && held.out.length === 2 && held.out.every(function (x) { return x.shaped; }),
      'and a document\'s picture in a 5.5:1 strip gets its own 16:7 shape; two frames changed', held.out);
    ok(held.styles.other === '' && held.styles.fine === '' && held.styles.logo === '' && near(ratio(held.after.other), ratio(held.before.other)),
      'another site\'s picture, a frame already in its picture\'s shape and a logo are left as they are', held.styles);
    await page.setViewport({ width: 390, height: 844 });
    var held390 = await page.evaluate(function () { var b = document.querySelector('.aw').getBoundingClientRect(); return [b.width, b.height]; });
    ok(near(ratio(held390), 1184 / 864), '…and at 390 (the band\'s phone rule is overruled: the frame keeps the picture\'s shape)', held390);
    await page.setViewport({ width: 1440, height: 900 });
    /* 1h. a swap keeps its place's frame (QA, 16 Nov 2026: a 900 x 1600 portrait swapped into Overview grew its 644 x 745 frame
       to 644 x 1145): the box is read before the swap (frameBox) and held after, the new picture filling it */
    await page.setContent('<!DOCTYPE html><html><head><style>*{box-sizing:border-box}body{margin:0}.split{display:grid;grid-template-columns:1fr 1fr;gap:48px;max-width:1340px;margin:0 auto;padding:0 24px}' +
      '.media img{display:block;width:100%;height:auto;border-radius:12px}</style></head><body><section data-rv-section="overview"><div class="split"><div><h2>Overview</h2><p>' + LONG + '</p></div>' +
      '<div class="media"><img class="ov" src="' + pic(1288, 1490) + '" alt="Davos"></div></div></section></body></html>', { waitUntil: 'load' });
    await page.addScriptTag({ content: PICTURE_SRC });
    var swap = await page.evaluate(function (portrait) {
      var P = window.RevampAiPicture, img = document.querySelector('.ov'), was = P.frameBox(img);
      return new Promise(function (resolve) {
        img.onload = function () {
          var grown = img.getBoundingClientRect();
          var gap = P.shapeGap(was.w, was.h, 900, 1600), r = P.fitFrame(img, was.w + ':' + was.h, {});
          var b = img.getBoundingClientRect();
          resolve({ was: was, grown: [grown.width, grown.height], gap: gap, shaped: r.shaped, now: [b.width, b.height], fit: getComputedStyle(img).objectFit });
        };
        img.src = portrait;
      });
    }, pic(900, 1600));
    ok(swap.was && near(swap.was.w / swap.was.h, 1288 / 1490) && swap.grown[1] > swap.was.h * 1.3, 'with nothing done, the portrait swapped in takes the frame over (it grows)', swap);
    ok(swap.shaped === true && Math.abs(swap.now[0] - swap.was.w) < 1.5 && Math.abs(swap.now[1] - swap.was.h) < 1.5 && swap.fit === 'cover' && swap.gap > 0.4,
      'held to the box read before the swap, the frame stays as it was and the picture fills it by cropping', swap);

    /* 2. coverPicture: the owner's own picture in a box of another shape */
    await page.setContent('<!DOCTYPE html><html><head><style>.box img{width:400px;height:300px}.contain img{object-fit:contain}.covered img{object-fit:cover}</style></head><body>' +
      '<div class="box"><img id="squash" src="' + pic(1000, 1000) + '" alt="A square picture"></div>' +
      '<div class="box contain"><img id="letterbox" src="' + pic(2100, 900) + '" alt="A wide picture"></div>' +
      '<div class="box covered"><img id="already" src="' + pic(2100, 900) + '" alt="A wide picture"></div>' +
      '<div class="box contain"><img id="brand" src="' + pic(300, 100) + '" alt="Acme logo"></div>' +
      '<div class="box contain" data-rv-logo-unit><img id="unit" src="' + pic(300, 100) + '" alt="ET DAVOS 2027"></div>' +
      '</body></html>', { waitUntil: 'load' });
    var cover = await page.evaluate(function (src) {
      /* eslint-disable no-eval */
      var win = window;
      var coverPicture = (0, eval)('(function (win) {' + src + ' return coverPicture; })')(win);
      function one(id) { var el = document.getElementById(id); var changed = coverPicture(el); return { changed: changed, fit: getComputedStyle(el).objectFit, style: el.getAttribute('style') || '' }; }
      return { squash: one('squash'), letterbox: one('letterbox'), already: one('already'), brand: one('brand'), unit: one('unit') };
    }, COVER_SRC);
    ok(cover.squash.changed === true && cover.squash.fit === 'cover', 'a square picture in a 4:3 box is drawn cover, not squashed', cover.squash);
    ok(cover.letterbox.changed === true && cover.letterbox.fit === 'cover', 'a wide picture in a box that letterboxed it (contain) fills it', cover.letterbox);
    ok(cover.already.changed === false && cover.already.style === '', 'a picture already drawn cover is not touched', cover.already);
    ok(cover.brand.changed === false && cover.brand.fit === 'contain' && cover.unit.changed === false && cover.unit.fit === 'contain', 'a logo, and the logo unit, keep their own fit', [cover.brand, cover.unit]);

    /* 3. atDesktop: measured on the desktop layout from a phone-width canvas */
    await page.setContent('<!DOCTYPE html><html><body style="margin:0"><iframe style="width:390px;height:700px;border:0" srcdoc="' +
      '<style>body{margin:0}.box{width:100px;height:50px}@media (min-width:1000px){.box{width:500px}}</style><div class=&quot;box&quot;></div>' + '"></iframe></body></html>', { waitUntil: 'load' });
    await page.waitForFunction(function () { var f = document.querySelector('iframe'); return f && f.contentDocument && f.contentDocument.querySelector('.box'); });
    var desk = await page.evaluate(function (src) {
      var DEVICES = { desktop: 1440, tablet: 768, mobile: 390 }, device = 'mobile', iframe = document.querySelector('iframe');
      var atDesktop = (0, eval)('(function (DEVICES, device, iframe) {' + src + ' return atDesktop; })')(DEVICES, device, iframe);
      var boxOf = function () { return iframe.contentDocument.querySelector('.box').getBoundingClientRect().width; };
      var phone = boxOf();
      var inside = atDesktop(function () { return { box: boxOf(), frame: iframe.contentWindow.innerWidth }; });
      return { phone: phone, inside: inside, after: boxOf(), width: iframe.style.width, height: iframe.style.height };
    }, DESKTOP_SRC);
    ok(desk.phone === 100 && desk.inside.box === 500 && desk.inside.frame === 1440, 'from a phone-width canvas, what is measured inside is the desktop layout', desk);
    ok(desk.after === 100 && desk.width === '390px' && desk.height === '700px', 'and the canvas is put back as it was', desk);
  } catch (err) {
    ok(false, 'the browser run did not finish', String(err && err.stack || err));
  } finally {
    await browser.close().catch(function () {});
  }
  finish();
})();
