/* node functions/lib/imported-behaviour.test.js — an imported (Lovable) page's behaviour, in a real Chrome:
     1. the capture (lovable-scraper-service settlePage + finishPage) of a page whose script keeps only the
        chosen tab's content, makes FAQ answers only while open, and changes its top bar once scrolled;
     2. that capture, its scripts gone, brought back to life by templates/_shared/et-runtime.js: tabs switch
        (and the chosen tab's progress bar goes with them), answers open (the nearest panel of that id), a
        "Read more" closed by its grid row opens, the bar takes its scrolled look, the carousel arrows in the
        section's heading move the row beside it, a sign-up button opens the event's form, and an in-page
        link lands on its section;
     3. the page's own motion recorded at capture and played again by the runtime (and still in the editor);
     4. a banner picture sized by a class inside a cascade layer (Tailwind v4) keeps that size beside the
        sized-picture rule lib/pictures.js writes.
   It needs Chrome and puppeteer-core (CHROME_PATH / RV_PUPPETEER, else the usual places); without them it
   says so and passes. No network, no Firebase. Exits 1 listing every failure. */
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..', '..');
var P = require('./pictures');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail !== undefined ? '\n      ' + JSON.stringify(detail).slice(0, 400) : '')); }
function finish() {
  if (failures.length) { console.error('imported-behaviour: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('imported-behaviour: all ' + checks + ' checks passed');
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
if (!puppeteer || !CHROME) { console.log('imported-behaviour: skipped — no Chrome / puppeteer-core here (set CHROME_PATH and RV_PUPPETEER)'); process.exit(0); }

var scraper = require(path.join(ROOT, 'lovable-scraper-service', 'server.js'));
var RUNTIME = fs.readFileSync(path.join(ROOT, 'templates', '_shared', 'et-runtime.js'), 'utf8');
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* The page as its own script draws it: a fixed top bar that floats once scrolled, a tab set showing only the
   chosen tab (with a progress bar in that tab only) that moves on every 10 s, FAQ answers made on opening. */
var CSS = '@layer theme, base, components, utilities;' +
  '@layer utilities{.h-full{height:100%}.fixed{position:fixed}.top-0{top:0}.inset-x-0{left:0;right:0}.bg-clear{background:transparent}' +
  '.floaty{background:rgb(255,255,255);border-radius:999px;max-width:600px;margin:0 auto}.dim{opacity:.4}.bright{opacity:1}' +
  '.grid{display:grid}.grid-rows-\\[0fr\\]{grid-template-rows:0fr}.opacity-0{opacity:0}.overflow-hidden{overflow:hidden}' +
  '.prog{display:block;height:2px;background:red;animation:prog 10s linear forwards}@keyframes prog{from{transform:scaleX(0)}to{transform:scaleX(1)}}}' +
  'html{scroll-behavior:auto}body{margin:0;font:16px sans-serif}section{min-height:700px}';
var LIVE = '<!doctype html><html><head><style>' + CSS + '</style></head><body><div id="root">' +
  '<div id="bar" class="fixed top-0 inset-x-0"><header id="hdr" class="bg-clear"><a href="#top">Brand</a> <a href="#lens">Lens</a></header></div>' +
  '<section id="top"><h1>Top</h1><button type="button" id="apply">Apply to join →</button></section>' +
  '<section id="lens" aria-roledescription="carousel"><div class="bg"><img id="bg0" class="dim" alt=""><img id="bg1" class="dim" alt=""></div>' +
  '<div class="wrap"><p>Understanding</p><div role="tablist" id="tl"></div><div id="content"></div></div></section>' +
  '<section id="faqs"><div role="tablist" id="ftl"></div><div id="faq-panel" role="tabpanel"></div></section>' +
  '<section id="also"><header><h2>Also</h2><div><button aria-label="Previous slide">‹</button><button aria-label="Next slide">›</button></div></header>' +
  '<div role="region" style="width:600px"><div class="row" style="display:flex;gap:16px;overflow:hidden;width:600px"><article style="flex:0 0 280px;height:50px">A</article><article style="flex:0 0 280px;height:50px">B</article><article style="flex:0 0 280px;height:50px">C</article></div></div></section>' +
  /* the same, with the region itself scrolling a row wider than it (Lovable's "You may also be interested in") */
  '<section id="also2"><header><h2>Also</h2><div><button aria-label="Previous programmes">‹</button><button aria-label="Next programmes">›</button></div></header>' +
  '<div role="region" style="width:600px;overflow-x:auto"><div style="display:flex;gap:16px;width:max-content"><article style="width:280px;height:50px">A</article><article style="width:280px;height:50px">B</article><article style="width:280px;height:50px">C</article><article style="width:280px;height:50px">D</article></div></div></section>' +
  '<section id="what"><div class="card"><h3>Card</h3><button type="button" aria-expanded="false" aria-controls="hb-1">Read more</button><div id="hb-1" class="grid grid-rows-[0fr] opacity-0"><div class="overflow-hidden"><p>Body text</p></div></div></div></section>' +
  '</div><script>' +
  'var TABS=[["Legacy","Legacy body"],["Craft","Bohemian glass"],["Brands","Brand trust"]],cur=0;' +
  'function drawTabs(){var tl=document.getElementById("tl");tl.innerHTML="";TABS.forEach(function(t,i){var b=document.createElement("button");b.type="button";b.setAttribute("role","tab");' +
  'b.setAttribute("aria-selected",i===cur?"true":"false");b.className=i===cur?"on":"off";b.innerHTML="<span>"+t[0]+"</span><span class=track>"+(i===cur?"<span class=prog></span>":"")+"</span>";' +
  'b.onclick=function(){cur=i;draw();};tl.appendChild(b);});' +
  'document.getElementById("content").innerHTML="<h2>"+TABS[cur][0]+"</h2><p>"+TABS[cur][1]+"</p>";' +
  'document.getElementById("bg0").className=cur===0?"bright":"dim";document.getElementById("bg1").className=cur===1?"bright":"dim";}' +
  'var FAQ=[["Joining",["Who?","When?"]],["Cost",["How much?","Refunds?"]]],fcur=0,open=-1;' +
  'function drawFaq(){var t=document.getElementById("ftl");t.innerHTML="";FAQ.forEach(function(f,i){var b=document.createElement("button");b.type="button";b.setAttribute("role","tab");' +
  'b.setAttribute("aria-controls","faq-panel");b.setAttribute("aria-selected",i===fcur?"true":"false");b.textContent=f[0];b.onclick=function(){fcur=i;open=-1;drawFaq();};t.appendChild(b);});' +
  'var p=document.getElementById("faq-panel");p.innerHTML="";FAQ[fcur][1].forEach(function(q,j){var d=document.createElement("div");var h=document.createElement("h3");' +
  'var b=document.createElement("button");b.type="button";b.setAttribute("aria-expanded",open===j?"true":"false");b.setAttribute("aria-controls","faq-answer-"+j);b.innerHTML=q+"<span aria-hidden=true class="+(open===j?"turned":"flat")+">"+(open===j?"×":"+")+"</span>";' +
  'b.onclick=function(){open=open===j?-1:j;drawFaq();};h.appendChild(b);d.appendChild(h);if(open===j){var a=document.createElement("div");a.id="faq-answer-"+j;a.textContent="Answer to "+q;d.appendChild(a);}p.appendChild(d);});}' +
  'function draw(){drawTabs();}draw();drawFaq();setInterval(function(){cur=(cur+1)%TABS.length;draw();},10000);' +
  'cur=2;draw();' +   /* the set has moved on by the time the page is read: it opened on the first tab */
  'window.addEventListener("scroll",function(){var s=scrollY>24;document.getElementById("hdr").className=s?"floaty":"bg-clear";});' +
  '</script></body></html>';

(async function () {
  var browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  try {
    /* ---------- 1. the capture ---------- */
    var page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    /* the tab set opened on its first tab: what settlePage reads first, before anything moves */
    await page.setContent(LIVE.replace('cur=2;draw();', 'setTimeout(function(){cur=2;draw();},1000);'));
    await scraper.settlePage(page);
    var captured = await page.evaluate(scraper.finishPage);
    await page.close();
    var markup = captured.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    var count = function (re) { return (markup.match(re) || []).length; };
    ok(count(/data-rv-tab="0:\d"/g) === 3 && count(/data-rv-tab="1:\d"/g) === 2, 'every tab of both sets is marked', count(/data-rv-tab="/g));
    ok(captured.indexOf('Bohemian glass') !== -1 && captured.indexOf('Brand trust') !== -1 && captured.indexOf('Legacy body') !== -1, 'every tab\'s content is in the capture');
    ok(/data-rv-tab="0:0"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-rv-tab="0:0"/.test(captured), 'the set is put back on the tab it opened on');
    ok(count(/Answer to /g) === 4 && captured.indexOf('Answer to Refunds?') !== -1, 'every FAQ answer, of every category, is in the capture', count(/Answer to /g));
    ok(count(/data-rv-tab-only=/g) === 3, 'the progress bar each tab has only while chosen is kept for that tab', count(/data-rv-tab-only=/g));
    ok(/id="bg0"[^>]*data-rv-tab-classes=|data-rv-tab-classes=[^>]*id="bg0"/.test(captured), 'a background picture fading in with its tab carries its classes for each tab');
    ok(/data-rv-scrolled-class="floaty"/.test(captured), 'the top bar carries its scrolled look');

    /* ---------- 2. the capture brought back by the runtime ---------- */
    var body = /<body[^>]*>([\s\S]*)<\/body>/.exec(captured)[1].replace(/<script\b[\s\S]*?<\/script>/gi, '');
    var built = '<!doctype html><html><head>' + P.SIZED_CSS + '<style>' + CSS + '</style><script>' + RUNTIME + '</script></head><body>' +
      '<div class="rv-imported">' + body + '</div></body></html>';
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.setContent(built, { waitUntil: 'load' });
    await sleep(400);
    var lens = function () {
      return page.evaluate(function () {
        var shown = Array.prototype.filter.call(document.querySelectorAll('#lens [data-rv-tabpanel]'), function (p) { return !p.hidden && p.getClientRects().length; });
        var sel = Array.prototype.map.call(document.querySelectorAll('#tl [role=tab]'), function (t) { return t.getAttribute('aria-selected'); }).join(',');
        var bars = Array.prototype.filter.call(document.querySelectorAll('#tl .prog'), function (p) { return p.getClientRects().length; }).length;
        return { text: shown.map(function (p) { return p.textContent; }).join('|'), sel: sel, bars: bars, bg1: document.getElementById('bg1').className };
      });
    };
    var l0 = await lens();
    ok(l0.text === 'LegacyLegacy body' && l0.sel === 'true,false,false' && l0.bars === 1, 'the page opens on the first tab, one progress bar', l0);
    await page.click('#tl [role=tab]:nth-child(2)');
    await sleep(100);
    var l1 = await lens();
    ok(l1.text === 'CraftBohemian glass' && l1.sel === 'false,true,false' && l1.bars === 1 && l1.bg1 === 'bright', 'a click on a tab shows its content, its picture and its progress bar', l1);
    await page.focus('#tl [role=tab]:nth-child(2)');
    await page.keyboard.press('ArrowRight');
    var l2 = await lens();
    ok(l2.text === 'BrandsBrand trust' && l2.sel === 'false,false,true', 'the arrow keys move between tabs', l2);

    await page.click('#ftl [role=tab]:nth-child(2)');
    await sleep(100);
    var q = await page.evaluateHandle(function () {
      return Array.prototype.filter.call(document.querySelectorAll('#faqs button[aria-expanded]'), function (b) { return b.getClientRects().length; })[1];
    });
    await q.click();
    await sleep(100);
    var faq = await page.evaluate(function () {
      var open = Array.prototype.filter.call(document.querySelectorAll('#faqs button[aria-expanded="true"]'), function (b) { return b.getClientRects().length; });
      var shown = Array.prototype.filter.call(document.querySelectorAll('#faqs [id^="faq-answer"]'), function (a) { return a.getClientRects().length && a.getBoundingClientRect().height > 0 && getComputedStyle(a).opacity === '1'; });
      return { open: open.map(function (b) { return b.textContent; }), sign: open.map(function (b) { return b.querySelector('span').className; }), shown: shown.map(function (a) { return a.textContent; }), panelId: !!document.querySelector('[data-rv-tabpanel="1:1"]#faq-panel') };
    });
    ok(faq.sign.join() === 'turned', 'the open question\'s sign looks as it did open on the original page', faq);
    ok(faq.open.join() === 'Refunds?×' && faq.shown.join() === 'Answer to Refunds?', 'a question of the second FAQ category opens its own answer (not the first category\'s of the same id)', faq);
    ok(faq.panelId, 'the panel the FAQ tabs name keeps its id on the panel on show');

    await page.click('#what button[aria-expanded]');
    await sleep(50);
    var more = await page.evaluate(function () { var b = document.querySelector('#what button[aria-expanded]'); var p = document.getElementById('hb-1'); return { label: b.textContent, h: p.getBoundingClientRect().height, op: getComputedStyle(p).opacity }; });
    ok(more.label === 'Read less' && more.h > 0 && more.op === '1', '"Read more" opens a panel its grid row kept closed, and says "Read less"', more);

    var apply = await page.evaluate(function () { return document.getElementById('apply').hasAttribute('data-register-cta'); });
    ok(apply, 'a sign-up button with no link opens the event\'s form (data-register-cta)');

    await page.evaluate(function () { document.getElementById('also').scrollIntoView(); });
    await page.click('#also [data-rv-carousel-next]');
    await sleep(700);
    var car = await page.evaluate(function () { var t = document.querySelector('#also [data-rv-carousel-track]'); return t ? t.scrollLeft : -1; });
    ok(car > 200, 'carousel arrows in the section\'s heading move the row beside it', car);
    await page.evaluate(function () { document.getElementById('also2').scrollIntoView(); });
    await page.click('#also2 [data-rv-carousel-next]');
    await sleep(700);
    var car2 = await page.evaluate(function () { var t = document.querySelector('#also2 [data-rv-carousel-track]'); return t ? [t.getAttribute('role'), t.scrollLeft] : null; });
    ok(car2 && car2[0] === 'region' && car2[1] >= 290 && car2[1] <= 300, 'where the region itself scrolls, it is the track and a step is one card', car2);

    await page.evaluate(function () { window.scrollTo(0, 900); window.dispatchEvent(new Event('scroll')); });
    await sleep(100);
    var hdr = await page.evaluate(function () { return document.getElementById('hdr').className; });
    ok(/(^|\s)floaty(\s|$)/.test(hdr), 'the top bar takes its scrolled look', hdr);
    await page.evaluate(function () { window.scrollTo(0, 0); window.dispatchEvent(new Event('scroll')); });
    await sleep(100);
    hdr = await page.evaluate(function () { return document.getElementById('hdr').className; });
    ok(/(^|\s)bg-clear(\s|$)/.test(hdr) && !/floaty/.test(hdr), 'and its first look again at the top', hdr);

    await page.click('#hdr a[href="#lens"]');
    await sleep(300);
    var land = await page.evaluate(function () { return Math.round(document.getElementById('lens').getBoundingClientRect().top); });
    ok(Math.abs(land) <= 2, 'an in-page link lands on its section', land);
    await page.close();

    /* the same page imported before its bar's scrolled look was read: the clear bar gets a background once scrolled */
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.setContent(built.replace(/ data-rv-scrolled-class="[^"]*"/g, ''), { waitUntil: 'load' });
    await sleep(300);
    await page.evaluate(function () { window.scrollTo(0, 900); window.dispatchEvent(new Event('scroll')); });
    await sleep(100);
    var bar = await page.evaluate(function () { var b = document.getElementById('bar'); return { cls: b.className, bg: getComputedStyle(b).backgroundColor }; });
    ok(/rv-bar-clear/.test(bar.cls) && /rv-bar-solid/.test(bar.cls) && bar.bg !== 'rgba(0, 0, 0, 0)', 'a clear top bar on show gets a background once the visitor scrolls', bar);
    await page.close();

    /* a capture taken with reveals still at their start (Trendies on Lovable): heading words parked tilted below
       their frames, pictures behind shut curtains — and what must stay as it is beside them */
    var PIC = '<img alt="" style="display:block;width:100%;height:100%" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22/%3E">';
    var word = function (id, tf) { return '<span style="display:inline-block;overflow:hidden;padding-bottom:.08em;vertical-align:bottom" aria-hidden="true"><span id="' + id + '" style="display:inline-block;transform:' + tf + '">' + id + '&nbsp;</span></span>'; };
    var parked = '<!doctype html><html><head><style>body{margin:0;font:48px sans-serif}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style><script>' + RUNTIME + '</script></head><body><div class="rv-imported">' +
      '<h2><span aria-label="Who Should Enter">' + word('who', 'translateY(110%) rotate(4deg)') + word('should', 'translateY(110%) rotate(4deg)') + word('done', 'none') + '</span></h2>' +
      '<div style="position:relative;overflow:hidden;width:300px;height:200px"><div id="c1" style="position:absolute;inset:0;clip-path:inset(0 0 100% 0)">' + PIC + '</div></div>' +
      '<div style="position:relative;overflow:hidden;width:300px;height:200px"><div id="c2" style="position:absolute;inset:0;clip-path:polygon(0 0, 0 0, 0 100%, 0 100%)">' + PIC + '</div></div>' +
      '<div style="position:relative;width:300px;height:200px">' + PIC + '<div id="hover" style="position:absolute;inset:0;clip-path:inset(0 0 100% 0);background:#000;color:#fff">More</div></div>' +
      '<div id="shape" style="width:200px;height:200px;clip-path:circle(50%)">' + PIC + '</div>' +
      '<span class="sr-only" id="sr">Only for screen readers</span>' +
      '<div style="overflow:hidden;width:300px"><div id="track" style="display:flex;width:900px;transform:translate3d(-300px,0,0)"><p style="flex:0 0 300px">A</p><p style="flex:0 0 300px">B</p><p style="flex:0 0 300px">C</p></div></div>' +
      '</div></body></html>';
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.setContent(parked, { waitUntil: 'load' });
    await sleep(300);
    var reveal = await page.evaluate(function () {
      var cls = function (id) { return document.getElementById(id).className; };
      var inFrame = function (id) { var a = document.getElementById(id).getBoundingClientRect(), f = document.getElementById(id).parentElement.getBoundingClientRect(); return a.top >= f.top - 1 && a.bottom <= f.bottom + 1; };
      var clip = function (id) { return getComputedStyle(document.getElementById(id)).clipPath; };
      return { who: inFrame('who'), should: inFrame('should'), done: cls('done'), c1: clip('c1'), c2: clip('c2'), hover: clip('hover'), shape: clip('shape'), sr: clip('sr'), track: [cls('track'), getComputedStyle(document.getElementById('track')).transform] };
    });
    ok(reveal.who && reveal.should, 'the words of a heading left tilted below their frames rise into them', reveal);
    ok(reveal.done === '', 'a word already in place is left alone', reveal);
    ok(reveal.c1 === 'none' && reveal.c2 === 'none', 'a picture behind a shut curtain (inset or flat shape) shows', reveal);
    ok(reveal.hover !== 'none' && reveal.shape !== 'none' && reveal.sr !== 'none', 'a shut layer over other content, a picture\'s own shape and a screen-reader-only label keep their clip', reveal);
    ok(reveal.track[0] === '' && reveal.track[1] !== 'none', 'a row wider than its frame keeps where it was moved to', reveal);
    await page.close();

    /* ---------- 3. the page's own motion: recorded (motionRecorder, settlePage) and played again (playMotion) ----------
       As framer-motion runs it: an entrance as the page opens (a delay in its timing), entrances set off by an
       IntersectionObserver with a margin (one delayed by a later start, as framer delays a transform), a loop, a
       style rewritten on every scroll, and one entrance whose narrow trigger the walk steps over. */
    var MOVES = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0;font:16px sans-serif}.tall{height:1400px}' +
      '#frame{overflow:hidden;height:40px}#word{display:inline-block}.box{height:200px;background:#ccc}#par{height:200px}#late{height:20px}</style></head><body>' +
      '<h1 id="intro" style="opacity:0">Intro</h1><div id="spin" style="width:20px">o</div><div class="tall"></div>' +
      '<section id="sec"><div id="frame"><span id="word" style="transform:translateY(110%)">Word</span></div><div id="card" class="box" style="opacity:0">Card</div></section>' +
      '<div class="tall"></div><div id="par" style="transform:translateY(0px)">Parallax</div><div class="tall"></div><div id="late" style="opacity:0">Late</div><div class="tall"></div>' +
      '<script>' +
      'function settle(el, prop, value, a) { a.finished.then(function () { el.style[prop] = value; a.cancel(); }); }' +
      'var intro = document.getElementById("intro");' +
      'settle(intro, "opacity", "1", intro.animate({ opacity: [0, 1] }, { duration: 600, delay: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" }));' +
      'document.getElementById("spin").animate({ transform: ["rotate(0deg)", "rotate(360deg)"] }, { duration: 2000, iterations: Infinity });' +
      'var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (!e.isIntersecting) return; io.unobserve(e.target);' +
      '  var w = document.getElementById("word"), c = document.getElementById("card");' +
      '  var a = w.animate({ transform: ["translateY(110%)", "translateY(0%)"] }, { duration: 500, fill: "both" }); a.startTime = document.timeline.currentTime + 80; settle(w, "transform", "translateY(0%)", a);' +
      '  settle(c, "opacity", "1", c.animate({ opacity: [0, 1] }, { duration: 500, delay: 100, fill: "both" })); }); }, { rootMargin: "0px 0px -10% 0px" });' +
      'io.observe(document.getElementById("sec"));' +
      'var late = new IntersectionObserver(function (es) { es.forEach(function (e) { if (!e.isIntersecting) return; late.unobserve(e.target);' +
      '  settle(e.target, "opacity", "1", e.target.animate({ opacity: [0, 1] }, { duration: 300, fill: "both" })); }); }, { rootMargin: "-48% 0px -48% 0px", threshold: 1 });' +
      'late.observe(document.getElementById("late"));' +
      'addEventListener("scroll", function () { document.getElementById("par").style.transform = "translateY(" + Math.round(scrollY * 0.2) + "px)"; });' +
      '</script></body></html>';
    var server = require('http').createServer(function (req, res) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(MOVES); });
    await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
    page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 800 });
    await page.evaluateOnNewDocument(scraper.motionRecorder);
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'load' });
    await sleep(1200);
    await scraper.settlePage(page);
    var movedHtml = await page.evaluate(scraper.finishPage);
    await page.close();
    server.close();
    var motionOf = function (id) {
      var m = new RegExp('<[a-z0-9]+ [^>]*id="' + id + '"[^>]*>').exec(movedHtml);
      var a = m && /data-rv-motion="([^"]*)"/.exec(m[0]);
      return { tag: m && m[0], m: a ? JSON.parse(a[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : null };
    };
    var mi = motionOf('intro'), ms = motionOf('spin'), mw = motionOf('word'), mc = motionOf('card'), mp = motionOf('par'), ml = motionOf('late');
    ok(mi.m && mi.m.on === 'load' && mi.m.a.length === 1 && mi.m.a[0].d === 600 && Math.abs(mi.m.a[0].w - 200) <= 40 && /cubic-bezier/.test(mi.m.a[0].e),
      'an entrance as the page opens is recorded with its length, delay and easing', mi.m);
    ok(ms.m && !ms.m.on && ms.m.l && ms.m.l[0].i === 'inf' && ms.m.l[0].d === 2000, 'a loop is recorded as a loop', ms.m);
    ok(mw.m && mw.m.on === 'view' && mw.m.v && mw.m.v.m === '0px 0px -10% 0px' && mw.m.v.u === 2 && Math.abs((mw.m.a[0].w || 0) - 80) <= 40,
      'an entrance set off by a watched container: the container (2 up), its margin, and a delay given as a later start', mw.m);
    ok(mc.m && mc.m.on === 'view' && mc.m.v && mc.m.v.u === 1 && Math.abs((mc.m.a[0].w || 0) - 100) <= 40, 'and its sibling, one up, with its own delay', mc.m);
    ok(mp.m && !mp.m.on && mp.m.s && mp.m.s.transform && mp.m.s.transform.length >= 3, 'a style rewritten as the page scrolls is recorded by place', mp.m);
    ok(ml.m && ml.m.on === 'view' && /opacity:\s*1/.test(ml.tag), 'an entrance the walk stepped over is brought into view and recorded', ml.tag);
    ok(/id="word"[^>]*style="[^"]*translateY\(0%\)/.test(movedHtml) && /id="card"[^>]*style="[^"]*opacity:\s*1/.test(movedHtml) && /id="intro"[^>]*style="[^"]*opacity:\s*1/.test(movedHtml),
      'the capture holds each element as its entrance ends');

    var movedBody = /<body[^>]*>([\s\S]*)<\/body>/.exec(movedHtml)[1].replace(/<script\b[\s\S]*?<\/script>/gi, '');
    var replay = function (extra) {
      return '<!doctype html><html' + (extra || '') + '><head><meta name="viewport" content="width=device-width"><style>body{margin:0;font:16px sans-serif}.tall{height:1400px}' +
        '#frame{overflow:hidden;height:40px}#word{display:inline-block}.box{height:200px;background:#ccc}#par{height:200px}#late{height:20px}</style><script>' + RUNTIME + '</script></head><body>' +
        '<div class="rv-imported">' + movedBody + '</div></body></html>';
    };
    var looks = function () {
      return page.evaluate(function () {
        function anims(id) { return document.getAnimations().filter(function (a) { return a.effect && a.effect.target && a.effect.target.id === id; }).map(function (a) { return a.playState; }); }
        function ty(id) { var t = getComputedStyle(document.getElementById(id)).transform; var m = /matrix\(([^)]*)\)/.exec(t); return m ? +m[1].split(',')[5] : 0; }
        return { ready: document.documentElement.hasAttribute('data-rv-motion-ready'), intro: anims('intro'), spin: anims('spin'), word: anims('word'), card: anims('card'),
          wordY: ty('word'), cardOp: getComputedStyle(document.getElementById('card')).opacity, parY: ty('par'), shown: document.querySelectorAll('[data-rv-motion].rv-shown').length };
      });
    };
    page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 800 });
    await page.setContent(replay(), { waitUntil: 'load' });
    await sleep(150);
    var l0 = await looks();
    ok(l0.ready && l0.intro.length === 1 && l0.spin.join() === 'running', 'the entrance as the page opens plays at once, the loop runs', l0);
    ok(l0.word.join() === 'paused' && l0.wordY > 15 && l0.card.join() === 'paused' && l0.cardOp === '0', 'what comes in later is held at its start, out of sight', l0);
    ok(l0.shown === 0, 'nothing held is taken for content stuck hidden (rv-shown)', l0);
    await page.evaluate(function () { window.scrollTo(0, document.getElementById('sec').offsetTop - 300); });
    await sleep(150);
    var l1 = await looks();
    ok(l1.word.join() === 'running' && l1.card.join() === 'running', 'coming into view sets the entrances off', l1);
    await sleep(900);
    var l2 = await looks();
    ok(l2.word.length === 0 && Math.abs(l2.wordY) < 0.5 && l2.cardOp === '1' && l2.intro.length === 0, 'each entrance ends where the capture has the element, and lets it go', l2);
    var par = [];
    for (var py of [1000, 2000]) {
      await page.evaluate(function (y) { window.scrollTo(0, y); }, py);
      await sleep(120);
      par.push((await looks()).parY);
    }
    ok(par[1] > par[0] && Math.abs(par[1] - par[0] - 200) <= 30, 'a style tied to the scroll follows the scroll as it did (a fifth of it)', par);
    await page.close();

    page = await browser.newPage();
    await page.setContent(replay(), { waitUntil: 'load' });
    await sleep(100);
    await page.evaluate(function () { window.dispatchEvent(new Event('beforeprint')); });
    await sleep(50);
    var pr = await looks();
    ok(pr.cardOp === '1' && Math.abs(pr.wordY) < 0.5, 'a printed page shows everything as it ends', pr);
    await page.close();

    for (var mode of ['editing', 'reduce']) {
      page = await browser.newPage();
      if (mode === 'reduce') await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.setContent(replay(mode === 'editing' ? ' data-rv-editing' : ''), { waitUntil: 'load' });
      await sleep(150);
      var still = await looks();
      ok(!still.intro.length && !still.word.length && !still.card.length && !still.spin.length && still.cardOp === '1' && Math.abs(still.wordY) < 0.5 && still.ready === (mode === 'reduce'),
        mode === 'editing' ? 'in the editor nothing moves, everything shows, and the page is not marked as taken over' : 'a visitor who asked for no motion sees everything still', still);
      await page.close();
    }

    /* ---------- 4. a banner picture sized by a layered class ---------- */
    page = await browser.newPage();
    await page.setContent('<!doctype html><html><head>' + P.SIZED_CSS + '<style>' + CSS + '</style></head><body>' +
      '<div style="height:500px;width:400px"><img id="a" class="h-full" data-rv-sized width="100" height="50" style="width:200px" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%2250%22/%3E"></div>' +
      '<div style="width:400px"><img id="b" data-rv-sized width="100" height="50" style="width:200px" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%2250%22/%3E"></div></body></html>', { waitUntil: 'load' });
    var hs = await page.evaluate(function () { return [document.getElementById('a').getBoundingClientRect().height, document.getElementById('b').getBoundingClientRect().height]; });
    ok(hs[0] === 500, 'a picture whose class (in a layer) fills its banner keeps that height', hs);
    ok(hs[1] === 100, 'a picture with only a width still follows it (not its height attribute)', hs);
    await page.close();
  } finally {
    await browser.close();
  }
})().then(finish, function (err) { failures.push('threw: ' + (err && err.stack)); finish(); });
