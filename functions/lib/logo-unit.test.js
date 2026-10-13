/* node functions/lib/logo-unit.test.js — exits 1 on the first failure it lists. No network, no Firebase.
   The pages in fixtures/logo-unit/ are trimmed copies of two real Economic Times event pages (the masthead,
   the hero, a slice of the partners, the footer); the SVG is the 2026 edition's own logo unit and the font
   is what Google Fonts answered for Playfair Display 700 with text=AUTOTECH SUMMIT 2027 (5,252 bytes). */

const fs = require('fs');
const path = require('path');
const { parseDocument } = require('htmlparser2');
const domutils = require('domutils');
const lu = require('./logo-unit');
const { logoUnitParts } = require('./gen-design');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function fixture(name, enc) { return fs.readFileSync(path.join(__dirname, 'fixtures', 'logo-unit', name), enc); }
function urls(list) { return list.map(function (c) { return c.url || c.kind; }).join(' | '); }

var PAGE_2026 = 'https://b2b.economictimes.indiatimes.com/entrepreneur-summit2026';
var PAGE_2025 = 'https://b2b.economictimes.indiatimes.com/entrepreneur-summit2025';
var UNIT_2026 = 'https://img.etb2bimg.com/files/retail_files/file_17739186002645_New_Project_4_.svg';
var UNIT_2025 = 'https://img.etb2bimg.com/files/cp/66d4ae815be8ce754247.png';
var BADGE_2025 = 'https://img.etb2bimg.com/files/cp/2d13dea035a559f2ffbc.png';
var html26 = fixture('entrepreneur-summit-2026.html', 'utf8');
var html25 = fixture('entrepreneur-summit-2025.html', 'utf8');
var svg26 = fixture('entrepreneur-summit-2026-logo.svg', 'utf8');
var ttf = fixture('playfair-display-700-subset.ttf');
var ET_DARK = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', '_shared', 'img', 'et-business-verticals-on-dark.svg'), 'utf8');
var ET_LIGHT = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', '_shared', 'img', 'et-business-verticals-on-light.svg'), 'utf8');

/* ---------- finding the unit: the two real pages ---------- */

var c26 = lu.findLogoCandidates(html26, PAGE_2026, 'ET Entrepreneur Summit 2027');
ok(c26.length >= 1 && c26[0].url === UNIT_2026 && c26[0].kind === 'img', '2026: the .svg in #banner .cntnd img.logo wins', urls(c26));
ok(c26.length === 1, '2026: the masthead, the sponsors, the noscript copies and the footer logo are not candidates', urls(c26));
ok(c26[0] && c26[0].cls === 'logo' && c26[0].alt === '' && c26[0].score > 100 && Array.isArray(c26[0].why) && c26[0].why.length >= 3 && c26[0].svg === undefined,
  '2026: the candidate says its class, alt, score and reasons', JSON.stringify(c26[0]));
ok(c26[0] && c26[0].why.join(';').indexOf('heading names the event') !== -1, '2026: the hidden heading beside it names the event', c26[0] && c26[0].why.join('; '));

var c25 = lu.findLogoCandidates(html25, PAGE_2025, 'ET Entrepreneur Summit 2026');
ok(c25.length >= 1 && c25[0].url === UNIT_2025, '2025: the .png img.logo wins', urls(c25));
ok(c25.every(function (c) { return c.url !== BADGE_2025; }), '2025: the edition badge (img.edition-img) is not a candidate', urls(c25));
ok(c25.every(function (c) { return !/Google_cloud|Yatra/.test(c.url); }), '2025: no sponsor logo is a candidate', urls(c25));
ok(c25.every(function (c) { return !/st\.etb2bimg\.com|b2b-logo/.test(c.url); }), '2025: the masthead is not a candidate', urls(c25));
ok(c25.every(function (c) { return /^https:\/\//.test(c.url); }) && JSON.stringify(c25).indexOf('data:') === -1, '2025: the data: URI picture after the hero is not a candidate', urls(c25));
ok(c25.length === 1, '2025: exactly one candidate', urls(c25));

/* ---------- finding the unit: made-up pages ---------- */

var ours = '<header class="bar"><img data-rv-logo src="/nav.png" alt="Nav"></header>' +
  '<section id="hero" class="hero-root"><img class="logo" src="/other.svg"><img data-rv-logo-unit src="https://storage.googleapis.com/b/events/x/logo/unit.svg" alt="AutoTech Summit 2026"></section>';
var co = lu.findLogoCandidates(ours, 'https://autotech.example.com/', 'AutoTech Summit 2027');
ok(co[0] && co[0].url === 'https://storage.googleapis.com/b/events/x/logo/unit.svg' && co[0].score >= 1000, 'our own sites: the picture marked data-rv-logo-unit is first outright', urls(co));
var oursBox = '<section id="hero"><div class="rv-lu" data-rv-logo-unit><img src="/u/unit.png" alt=""></div></section>';
co = lu.findLogoCandidates(oursBox, 'https://autotech.example.com/x/', 'AutoTech Summit 2027');
ok(co.length === 1 && co[0].url === 'https://autotech.example.com/u/unit.png' && co[0].score >= 900, 'our own sites: a picture inside the marked box counts too', urls(co));
var oursOld = '<section id="hero"><div class="rv-lu rv-lu-on-dark" data-rv-logo-unit><img class="rv-lu-et" src="/templates/_shared/img/et-business-verticals-on-dark.svg" alt="The Economic Times Business Verticals"><div class="rv-lu-name"><span class="rv-lu-key">AutoTech</span></div></div></section>';
ok(lu.findLogoCandidates(oursOld, 'https://autotech.example.com/', 'AutoTech Summit 2027').length === 0, 'our own sites, text unit: the ET logo inside it is not the event\'s unit');

var lazy = '<div class="hero"><img class="event-logo lazyload" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="//cdn.example.org/img/lockup.png" alt="">' +
  '<img src="" srcset="img/second.webp 1x, img/second@2x.webp 2x" class="brand-logo"><img src="mailto:x@example.org" class="logo"></div>';
var cl = lu.findLogoCandidates(lazy, 'https://www.example.org/events/summit/', 'Some Summit');
ok(cl[0] && cl[0].url === 'https://cdn.example.org/img/lockup.png', 'lazy loading: data-src is read when src is a data: URI, and // is resolved', urls(cl));
ok(cl[1] && cl[1].url === 'https://www.example.org/events/summit/img/second.webp' && cl.length === 2, 'lazy loading: the first srcset address is read when src is empty; a mailto: src is skipped', urls(cl));

var sponsorsOnly = '<header id="ms_header_oauth"><div class="logoWrapper"><img src="https://st.etb2bimg.com/Themes/Release/theme4/images/logos/b2b-logo-header.svg" alt="b2b" width=400 height=62></div></header>' +
  '<section id="partners" class="sponsor_list"><div class="logo-wrapper"><a target="_blank" href="https://acme.com"><img src="https://img.etb2bimg.com/files/acme.png" alt="Acme"></a>' +
  '<img class="lazy-row" data-src="https://img.etb2bimg.com/files/b.png" alt="B"><noscript><img src="https://img.etb2bimg.com/files/b.png" alt="B"></noscript></div></section>' +
  '<section class="speakers"><img src="https://img.etb2bimg.com/files/s1.png" class="logo" alt="A speaker"></section>' +
  '<div><a target="_blank" href="https://other.com"><img class="logo" src="https://img.etb2bimg.com/files/o.png"></a><img src="/images/icons/cal.svg" class="cal-ico"><img src="/px.gif" width="1" height="1"></div>' +
  '<footer><img class="logo" src="https://img.etb2bimg.com/files/cp/et-b2b-logo-gray.png"></footer>';
var cs = lu.findLogoCandidates(sponsorsOnly, PAGE_2026, 'ET Entrepreneur Summit 2027');
ok(cs.length === 0, 'a page with only a masthead, sponsors, speakers, icons and a footer logo: no candidate', urls(cs));

var thirdParty = '<section class="hero"><img src="https://gossip-themes.com/vibenews/logo.svg" alt="" class="wp-image-15"></section><div><img src="https://gossip-themes.com/a.png" class="custom-logo"></div>';
var ct = lu.findLogoCandidates(thirdParty, 'https://etedge-insights.com/', 'ET Edge Summit');
ok(ct.length === 1 && ct[0].url === 'https://gossip-themes.com/vibenews/logo.svg' && ct[0].why.indexOf('on another host') !== -1, 'another host: only the hero\'s picture, and only when the page has nothing else', urls(ct));
ct = lu.findLogoCandidates(thirdParty + '<header><img class="custom-logo" src="/wp-content/uploads/insights-logo.png" alt="ET Edge Insights"></header>', 'https://etedge-insights.com/', 'ET Edge Summit');
ok(ct.length === 1 && ct[0].url === 'https://etedge-insights.com/wp-content/uploads/insights-logo.png', 'another host: dropped as soon as the page has a logo of its own', urls(ct));

var inlineSvg = '<section id="hero"><svg class="wave" viewBox="0 0 1440 320" aria-hidden="true"><path d="M0 0"/></svg>' +
  '<a href="/"><svg viewBox="0 0 300 80"><path d="M1 1"/></a><svg width="24" height="24" viewBox="0 0 24 24"><path d="M2 2"/></svg>' +
  '<svg class="hero-logo" viewBox="0 0 520 140" role="img" aria-label="Autotech"><text x="0" y="40">AUTOTECH 2026</text></svg></section>';
var ci = lu.findLogoCandidates(inlineSvg, 'https://x.example.com/', 'Autotech Summit 2027');
ok(ci.length === 1 && ci[0].kind === 'inline-svg' && ci[0].url === '' && /^<svg class="hero-logo" viewBox="0 0 520 140"/.test(ci[0].svg) && /<\/svg>$/.test(ci[0].svg),
  'a drawing written into the hero is a candidate, with its markup exactly as written; waves, icons and linked drawings are not', JSON.stringify(ci).slice(0, 300));

var many = '<section class="hero">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) { return '<img class="hero-logo" src="/l' + i + '.png">'; }).join('') + '<img class="hero-logo" src="/l1.png"></section>';
var cm = lu.findLogoCandidates(many, 'https://x.example.com/', '');
ok(cm.length === 6 && cm[0].url === 'https://x.example.com/l1.png' && cm.every(function (c, i) { return i === 0 || cm[i - 1].score >= c.score; }), 'at most 6, best first, each picture once', urls(cm));

[['empty', ''], ['null', null], ['undefined', undefined], ['a number', 42], ['words', 'no markup at all'], ['broken markup', '<div <img src=">>><section id="banner"><img class="logo" src="http://[bad"></sec'],
  ['binary', Buffer.from([0, 255, 1, 254, 60, 105, 109, 103]).toString('latin1')]].forEach(function (g) {
  var r, threw = false;
  try { r = lu.findLogoCandidates(g[1], 'not a url', 'x'); } catch (e) { threw = true; }
  ok(!threw && Array.isArray(r) && r.length === 0, 'garbage (' + g[0] + '): [] and no throw', threw ? 'threw' : JSON.stringify(r));
  threw = false;
  try { r = lu.editionHints(g[1], 'not a url'); } catch (e) { threw = true; }
  ok(!threw && r && r.title === '' && r.years.length === 0 && r.editionImage === '', 'garbage (' + g[0] + '): editionHints is empty and does not throw');
});
var huge = '<section id="banner"><img class="logo" src="/early.png"></section>' + new Array(120001).join('<p>filler text</p>') + '<section class="hero"><img class="event-logo" src="/late.png"></section>';
var started = Date.now();
var ch = lu.findLogoCandidates(huge, 'https://x.example.com/', 'X');
ok(huge.length > 1500000 && ch.length === 1 && ch[0].url === 'https://x.example.com/early.png', 'a huge page is read up to 1,500,000 characters', urls(ch));
ok(Date.now() - started < 8000, 'a huge page does not take long (' + (Date.now() - started) + ' ms)');
var deep = new Array(30001).join('<div>') + '<img class="logo" src="/x.png">';
var threwDeep = false, cd;
try { cd = lu.findLogoCandidates(deep, 'https://x.example.com/', 'X'); } catch (e) { threwDeep = true; }
ok(!threwDeep && Array.isArray(cd), 'thirty thousand open boxes: no throw');

/* ---------- which edition ---------- */

var h26 = lu.editionHints(html26, PAGE_2026);
ok(/^Entrepreneur Summit \| Business Events/.test(h26.title), '2026 hints: the title', h26.title);
ok(h26.headings.indexOf('ET Entrepreneur Summit 2026') !== -1 && h26.headings.indexOf('Business Events and Conferences - Entrepreneur Summit') !== -1, '2026 hints: the hidden headings of the hero', JSON.stringify(h26.headings));
ok(h26.years.length === 1 && h26.years[0] === '2026' && h26.editionImage === '', '2026 hints: the year, from the heading, the date line and the address', JSON.stringify(h26));
var h25 = lu.editionHints(html25, PAGE_2025);
ok(h25.years[0] === '2025' && h25.years.length === 1, '2025 hints: the year, from the date line and the address', JSON.stringify(h25.years));
ok(h25.editionImage === BADGE_2025, '2025 hints: the edition badge is reported', h25.editionImage);
ok(h25.headings.indexOf('Entrepreneur Events & Conferences - Business Summit') !== -1, '2025 hints: a hidden heading right after the hero is read, entities decoded', JSON.stringify(h25.headings));
var hv = lu.editionHints('<title>Auto Summit 2024 | ET</title><div class="hero"><h1>Auto Summit 2024</h1><h2 class="sr-only">Viksit Bharat @2047</h2><div class="lcn">3 March 2024 &amp; 4 March 2024, since 2019</div><img class="year-badge" data-src="b.png"></div><h1>Later 2031</h1>', 'https://x.example.com/auto/2023/');
ok(hv.years.join(',') === '2024,2019,2023', 'hints: years most frequent first; "@2047" is not a year of an edition; a later heading is not read', hv.years.join(','));
ok(hv.headings.join('|') === 'Viksit Bharat @2047|Auto Summit 2024' && hv.editionImage === 'https://x.example.com/auto/2023/b.png', 'hints: hidden headings, then the visible h1; a year badge', JSON.stringify(hv));

ok(JSON.stringify(lu.editionYears({ eventName: 'ET Entrepreneur Summit 2026', start: '2026-03-25', hints: h25, pageUrl: PAGE_2025 })) === '{"from":"2025","to":"2026"}', 'edition years: 2025 page, 2026 event');
ok(JSON.stringify(lu.editionYears({ eventName: 'Tech Nirbhar Bharat @2047 Summit', start: '2026-03-25T09:00:00+05:30', hints: { years: ['2047', '2025', '2024'] }, pageUrl: '' })) === '{"from":"2025","to":"2026"}',
  'edition years: "@2047" in the name is not the year; the year comes from the start date; the closest earlier year is taken');
ok(JSON.stringify(lu.editionYears({ eventName: 'Summit 2026', hints: { years: ['2047'] }, pageUrl: 'https://x.example.com/summit' })) === '{"from":"","to":"2026"}', 'edition years: 2047 is never the previous edition of 2026');
ok(JSON.stringify(lu.editionYears({ eventName: 'Summit 2026', hints: { years: [] }, pageUrl: 'https://x.example.com/summit' })) === '{"from":"","to":"2026"}', 'edition years: no evidence, no guess');
ok(JSON.stringify(lu.editionYears({ eventName: 'Summit 2026', hints: { years: ['2026'] }, pageUrl: 'https://x.example.com/summit2026' })) === '{"from":"","to":"2026"}', 'edition years: the same year is not a previous edition');
ok(JSON.stringify(lu.editionYears({ eventName: 'Summit 2026', hints: null, pageUrl: 'https://x.example.com/summit2023' })) === '{"from":"2023","to":"2026"}', 'edition years: the address alone is evidence');
ok(JSON.stringify(lu.editionYears({ eventName: 'Summit', start: '', hints: { years: ['2025'] } })) === '{"from":"","to":""}' && JSON.stringify(lu.editionYears()) === '{"from":"","to":""}', 'edition years: no year for the new event, nothing to move');

ok(lu.bumpYear('ET Entrepreneur Summit 2025 (12025, 20250, #2025)', '2025', '2026') === 'ET Entrepreneur Summit 2026 (12025, 20250, #2026)', 'bumpYear: whole numbers only');
ok(lu.bumpYear('Summit 2025', '', '2026') === 'Summit 2025' && lu.bumpYear(null, '2025', '2026') === '', 'bumpYear: nothing to do without both years');

/* ---------- what a picture is ---------- */

function bytes(hex) { return Buffer.from(hex.replace(/\s+/g, ''), 'hex'); }
/* the first 33 bytes (signature + IHDR) of the two real 2025 pictures */
var PNG_UNIT = bytes('89504e470d0a1a0a0000000d4948445200000229000001540806000000e1c7ac9c');
var PNG_BADGE = bytes('89504e470d0a1a0a0000000d494844520000006d00000070080600000014b0fe13');
var iUnit = lu.imageInfo(PNG_UNIT), iBadge = lu.imageInfo(PNG_BADGE), iSvg = lu.imageInfo(Buffer.from(svg26));
ok(JSON.stringify(iUnit) === '{"type":"png","mime":"image/png","width":553,"height":340,"alpha":true}', 'imageInfo: the 2025 unit is a 553x340 PNG with alpha', JSON.stringify(iUnit));
ok(iBadge.type === 'png' && iBadge.width === 109 && iBadge.height === 112 && iBadge.alpha === true, 'imageInfo: the 2025 edition badge is 109x112', JSON.stringify(iBadge));
ok(JSON.stringify(iSvg) === '{"type":"svg","mime":"image/svg+xml","width":571,"height":147,"alpha":null}', 'imageInfo: the 2026 unit is a 571x147 SVG', JSON.stringify(iSvg));
ok(lu.plausibleUnit(iUnit) === '' && lu.plausibleUnit(iSvg) === '', 'plausibleUnit: both real units pass', lu.plausibleUnit(iUnit) + ' / ' + lu.plausibleUnit(iSvg));
ok(/small/.test(lu.plausibleUnit(iBadge)), 'plausibleUnit: the edition badge is rejected', lu.plausibleUnit(iBadge));

function pngWith(colourType, chunks) {
  var head = Buffer.concat([bytes('89504e470d0a1a0a0000000d49484452'), bytes('00000320 000000c8 08'), Buffer.from([colourType]), bytes('000000 00000000')]);
  return Buffer.concat([head].concat(chunks.map(function (name) { return Buffer.concat([bytes('00000001'), Buffer.from(name, 'latin1'), bytes('00 00000000')]); })));
}
ok(lu.imageInfo(pngWith(2, ['pHYs', 'IDAT'])).alpha === false, 'imageInfo: an RGB PNG has no alpha');
ok(lu.imageInfo(pngWith(3, ['PLTE', 'tRNS', 'IDAT'])).alpha === true, 'imageInfo: a palette PNG with tRNS has alpha');
ok(lu.imageInfo(pngWith(3, ['PLTE'])).alpha === null && lu.imageInfo(pngWith(3, ['PLTE'])).width === 800, 'imageInfo: a PNG cut before its pixels: size known, alpha not');

var jpeg = bytes('ffd8 ffe0 0010 4a46494600 0101 00 0048 0048 0000  ffdb 0004 0000  ffc2 0011 08 0258 0780 03 012200 021101 031101  ffda');
var iJpeg = lu.imageInfo(jpeg);
ok(JSON.stringify(iJpeg) === '{"type":"jpeg","mime":"image/jpeg","width":1920,"height":600,"alpha":false}', 'imageInfo: JPEG size from its SOF segment', JSON.stringify(iJpeg));
ok(/banner/.test(lu.plausibleUnit(iJpeg)), 'plausibleUnit: a wide JPEG is a banner', lu.plausibleUnit(iJpeg));
var gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), bytes('9001 6400 f70000')]);
ok(JSON.stringify(lu.imageInfo(gif)) === '{"type":"gif","mime":"image/gif","width":400,"height":100,"alpha":null}', 'imageInfo: GIF', JSON.stringify(lu.imageInfo(gif)));
function webp(kind, rest) { return Buffer.concat([Buffer.from('RIFF', 'latin1'), bytes('24000000'), Buffer.from('WEBP' + kind, 'latin1'), bytes('0a000000'), bytes(rest)]); }
var wLossy = lu.imageInfo(webp('VP8 ', '000000 9d012a 5802 c800 0000'));
ok(wLossy.type === 'webp' && wLossy.width === 600 && wLossy.height === 200 && wLossy.alpha === false, 'imageInfo: WebP VP8', JSON.stringify(wLossy));
/* VP8L: 14 bits width-1 (599), 14 bits height-1 (199), 1 bit alpha */
var bits = (599) | (199 << 14) | (1 << 28), l = Buffer.alloc(10); l[0] = 0x2f; l.writeUInt32LE(bits >>> 0, 1);
var wLossless = lu.imageInfo(webp('VP8L', l.toString('hex')));
ok(wLossless.width === 600 && wLossless.height === 200 && wLossless.alpha === true, 'imageInfo: WebP VP8L with alpha', JSON.stringify(wLossless));
var wExt = lu.imageInfo(webp('VP8X', '10 000000 570200 c70000'));
ok(wExt.width === 600 && wExt.height === 200 && wExt.alpha === true && wExt.mime === 'image/webp', 'imageInfo: WebP VP8X with the alpha flag', JSON.stringify(wExt));
ok(lu.imageInfo(webp('VP8X', '00 000000 570200 c70000')).alpha === false, 'imageInfo: WebP VP8X without it');
ok(lu.imageInfo(Buffer.from('<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60" stroke-width="2" width="150"></svg>')).height === 30, 'imageInfo: an SVG with only a width takes its height from the viewBox');
ok(lu.imageInfo(Buffer.from('<svg width="100%" viewBox="0,0,401,39"></svg>')).width === 401, 'imageInfo: a width in percent falls back to the viewBox');
[Buffer.alloc(0), Buffer.from('hello'), Buffer.from('<html><svg></svg></html>'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), null, 'a string', bytes('ffd8ff')].forEach(function (b, i) {
  var info, threw = false;
  try { info = lu.imageInfo(b); } catch (e) { threw = true; }
  ok(!threw && info && (i === 6 ? info.type === 'jpeg' && info.width === 0 : info.type === '' && info.mime === '' && info.alpha === null), 'imageInfo: bytes that are no picture (' + i + ') give type "" and do not throw', JSON.stringify(info));
  ok(lu.plausibleUnit(info) !== '', 'plausibleUnit: … and are rejected (' + i + ')');
});
ok(lu.plausibleUnit({ type: 'png', width: 150, height: 60, alpha: true }) !== '', 'plausibleUnit: a raster under 160 px wide is too small');
ok(lu.plausibleUnit({ type: 'png', width: 400, height: 500, alpha: true }) !== '' && lu.plausibleUnit({ type: 'png', width: 400, height: 400, alpha: true }) === '', 'plausibleUnit: taller than wide is rejected, a large square is not');
ok(lu.plausibleUnit({ type: 'svg', width: 900, height: 100, alpha: null }) !== '' && lu.plausibleUnit({ type: 'svg', width: 800, height: 100, alpha: null }) === '', 'plausibleUnit: wider than 8:1 is rejected');
ok(lu.plausibleUnit({ type: 'png', width: 1600, height: 500, alpha: false }) !== '' && lu.plausibleUnit({ type: 'png', width: 1600, height: 500, alpha: true }) === '', 'plausibleUnit: a wide picture is a banner only without alpha');
ok(lu.plausibleUnit({ type: 'svg', width: 24, height: 24, alpha: null }) !== '' && lu.plausibleUnit({ type: 'svg', width: 0, height: 0, alpha: null }) === '', 'plausibleUnit: an icon-sized SVG is rejected; one with no size of its own is not');
ok(lu.plausibleUnit(null) !== '' && lu.plausibleUnit({}) !== '', 'plausibleUnit: nothing is rejected');

/* ---------- SVG ---------- */

ok(lu.svgIsActive(svg26) === false && lu.svgIsActive(ET_DARK) === false && lu.svgIsActive(ET_LIGHT) === false, 'svgIsActive: the real unit and both ET logos are inert');
['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><a href="java&#115;cript:x()">a</a></svg>', '<svg><a href="java\nscript:x()">a</a></svg>', '<svg><foreignObject/></svg>',
  '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', '<svg><image href="data:text/html;base64,AAAA"/></svg>'].forEach(function (s, i) {
  ok(lu.svgIsActive(s) === true, 'svgIsActive: active SVG ' + i + ' is caught');
});

var layers = lu.svgLayers(svg26);
ok(layers.length === 2 && layers[0] === svg26 && /^<svg[^>]*viewBox="0 0 625 115"/.test(layers[1]) && (layers[1].match(/<path/g) || []).length === 27, 'svgLayers: the 2026 unit is an SVG holding an SVG of 27 paths', layers.length + ' layers');
ok(lu.svgTexts(svg26).length === 0, 'svgTexts: the 2026 unit has no real text (it is all outlines)');
ok(lu.svgTone(svg26) === 'for-dark', 'svgTone: the 2026 unit was drawn for a dark background', lu.svgTone(svg26));
ok(lu.svgTone(ET_DARK) === 'for-dark' && lu.svgTone(ET_LIGHT) === 'for-light', 'svgTone: the two official ET logos', lu.svgTone(ET_DARK) + ' / ' + lu.svgTone(ET_LIGHT));
ok(lu.svgTone('<svg><path fill="#000" d="M0 0"/><path style="fill:rgb(20, 22, 27)" d="M0 0"/><path fill="#ed1a3b" d="M0 0"/></svg>') === 'for-light', 'svgTone: #rgb and rgb() dark inks, a brand colour ignored');
ok(lu.svgTone('<svg><path fill="white" d="M0 0"/><path stroke="WHITE" fill="none" stroke-width="2" d="M0 0"/><path fill="black" d="M0 0"/></svg>') === 'for-dark', 'svgTone: the names white and black');
ok(lu.svgTone('<svg><path fill="#fff" d="M0 0"/><path fill="#000" d="M0 0"/></svg>') === '' && lu.svgTone('<svg><path d="M0 0"/></svg>') === '' && lu.svgTone('<svg><path fill="url(#g)" d=""/></svg>') === '' && lu.svgTone('') === '', 'svgTone: mixed or no inks give ""');
function nest(inner, depth) { return depth ? '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,' + Buffer.from(nest(inner, depth - 1)).toString('base64') + '"/></svg>' : inner; }
ok(lu.svgLayers(nest('<svg><text>deep</text></svg>', 3)).length === 4 && lu.svgLayers(nest('<svg><text>deep</text></svg>', 9)).length === 5, 'svgLayers: nested layers are followed, four deep at most');

var yearSvg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2026 2026" id="unit2026" aria-label="Summit 2026" data-year="2026">' +
  '<!-- made in 2026 --><title>Summit 2026</title><desc>The 2026 edition</desc><style>.y2026{fill:#202620}</style>' +
  '<path id="p2026" d="M2026 0L20 2026z"/><image href="https://example.com/2026/bg.png"/>' +
  '<text x="2026" y="10" class="y2026">SUMMIT 2026</text><text><tspan x="0">20</tspan><tspan>2026</tspan> / 12026 / 20260 / 2026-27 / 2026</text>' +
  '<g><rect width="2026"/></g></svg>\n';
var ry = lu.svgReplaceYear(yearSvg, '2026', '2027');
var expected = yearSvg.replace('aria-label="Summit 2026"', 'aria-label="Summit 2027"').replace('<title>Summit 2026', '<title>Summit 2027').replace('The 2026 edition', 'The 2027 edition')
  .replace('>SUMMIT 2026<', '>SUMMIT 2027<').replace('<tspan>2026</tspan>', '<tspan>2027</tspan>').replace('/ 2026-27 / 2026<', '/ 2027-27 / 2027<');
ok(ry.changed === 7, 'svgReplaceYear: seven places changed (aria-label, title, desc, text, tspan, two in the tail)', 'changed ' + ry.changed);
ok(ry.svg === expected, 'svgReplaceYear: only real text changes — ids, classes, paths, attributes, addresses, comments, CSS and longer numbers stay', ry.svg);
ok(ry.svg.length === yearSvg.length, 'svgReplaceYear: every other byte is where it was');
var none = lu.svgReplaceYear(yearSvg, '2019', '2027');
ok(none.changed === 0 && none.svg === yearSvg, 'svgReplaceYear: a year that is not there changes nothing');
ok(lu.svgReplaceYear(svg26, '2026', '2027').changed === 0 && lu.svgReplaceYear(svg26, '2026', '2027').svg === svg26, 'svgReplaceYear: the 2026 unit (outlines only) is returned as it came');
ok(lu.svgReplaceYear(yearSvg, '26', '27').changed === 0 && lu.svgReplaceYear(yearSvg, '2026', 'x').changed === 0 && lu.svgReplaceYear(null, '2026', '2027').svg === '', 'svgReplaceYear: bad years change nothing');
var nested = nest('<svg xmlns="http://www.w3.org/2000/svg"><path id="a2026" d="M2026 1"/><text>EDITION 2026</text></svg>', 2);
var rn = lu.svgReplaceYear(nested, '2026', '2027');
var rnLayers = lu.svgLayers(rn.svg);
ok(rn.changed === 1 && rnLayers.length === 3 && rnLayers[2] === '<svg xmlns="http://www.w3.org/2000/svg"><path id="a2026" d="M2026 1"/><text>EDITION 2027</text></svg>', 'svgReplaceYear: a year two layers down is changed and the layers closed again', JSON.stringify(rnLayers[2]));
ok(lu.svgTexts(rn.svg).join('|') === 'EDITION 2027' && lu.svgTexts(yearSvg).join('|') === 'SUMMIT 2026|20|2026|/ 12026 / 20260 / 2026-27 / 2026', 'svgTexts: text and tspan strings, across layers', lu.svgTexts(yearSvg).join('|'));

/* ---------- the font ---------- */

var m = lu.fontMetrics(ttf);
ok(m && m.unitsPerEm === 1000 && m.ascender > 0 && m.descender < 0 && m.capHeight > 500 && m.capHeight < 800, 'fontMetrics: the real subset font (Playfair Display 700)', m && JSON.stringify({ u: m.unitsPerEm, a: m.ascender, d: m.descender, c: m.capHeight }));
var letters = 'AUTOECHSMI 207'.split('');
ok(m && letters.every(function (ch) { return m.has(ch.charCodeAt(0)) && m.advanceOf(ch.charCodeAt(0)) > 0; }), 'fontMetrics: every character asked for has a glyph and a width');
ok(m && m.advanceOf(77) > m.advanceOf(73) && m.advanceOf(77) > m.advanceOf(32) && m.advanceOf(77) === Math.max.apply(null, letters.map(function (ch) { return m.advanceOf(ch.charCodeAt(0)); })), 'fontMetrics: M is the widest, wider than I and the space',
  m && letters.map(function (ch) { return ch + '=' + m.advanceOf(ch.charCodeAt(0)); }).join(' '));
ok(m && m.has(90) === false && m.has(0x1F600) === false && m.advanceOf(90) >= 0, 'fontMetrics: a character the subset lacks is reported as missing');
var w96 = lu.textWidth(m, 'AUTOTECH', 96, 0);
ok(w96 > 96 * 8 * 0.5 && w96 < 96 * 8 * 0.95, 'textWidth: AUTOTECH at 96 px is a believable ' + Math.round(w96) + ' px');
ok(Math.abs(lu.textWidth(m, 'AUTOTECH', 48, 0) * 2 - w96) < 0.001 && Math.abs(lu.textWidth(m, 'AUTOTECH', 96, 5) - w96 - 40) < 0.001 && lu.textWidth(m, '', 96, 5) === 0 && lu.textWidth(null, 'A', 96, 0) === 0, 'textWidth: scales with the size; letter-spacing once per character');
[Buffer.alloc(0), Buffer.from('not a font at all, just words'), Buffer.concat([Buffer.from('wOFF'), ttf.slice(4)]), Buffer.concat([Buffer.from('wOF2'), ttf.slice(4)]), ttf.slice(0, 200), ttf.slice(0, ttf.length - 900), null, 'string', Buffer.concat([ttf.slice(0, 4), Buffer.alloc(400, 0xff)])].forEach(function (b, i) {
  var r, threw = false;
  try { r = lu.fontMetrics(b); } catch (e) { threw = true; }
  ok(!threw && r === null, 'fontMetrics: bytes that are no readable font (' + i + ') give null');
});

var cssUrl = lu.googleFontCssUrl('Playfair Display', 700, 'AutoTech Summit 2027');
ok(cssUrl === 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&text=' + encodeURIComponent(' 0123456789ACEHIMOSTUcehimotu'), 'googleFontCssUrl: characters once, sorted, with their capitals, the digits and the space', cssUrl);
ok(/family=Inter:wght@700&text=%200123456789$/.test(lu.googleFontCssUrl('Inter', 'bold', '')), 'googleFontCssUrl: a weight that is no number becomes 700', lu.googleFontCssUrl('Inter', 'bold', ''));
/* what Google Fonts answered on 2026-10-13 to User-Agent "RevampCMS-Fetcher/1.0" */
var GOOGLE_CSS = '@font-face {\n  font-family: \'Playfair Display\';\n  font-style: normal;\n  font-weight: 700;\n  src: url(https://fonts.gstatic.com/l/font?kit=nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKeiukDQfNjAzGedWgnRWuGkOMiwMg&skey=f3b68f0152604ed9&v=v40) format(\'truetype\');\n}\n';
ok(lu.fontUrlFromCss(GOOGLE_CSS) === 'https://fonts.gstatic.com/l/font?kit=nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKeiukDQfNjAzGedWgnRWuGkOMiwMg&skey=f3b68f0152604ed9&v=v40', 'fontUrlFromCss: the TrueType address in Google\'s answer', lu.fontUrlFromCss(GOOGLE_CSS));
ok(lu.fontUrlFromCss('@font-face{src:url("a.woff2") format("woff2"), url(\'https://fonts.gstatic.com/s/b.otf\') format("opentype")}') === 'https://fonts.gstatic.com/s/b.otf' && lu.fontUrlFromCss('@font-face{src:url(\'b.otf\') format("opentype")}') === '' && lu.fontUrlFromCss('@font-face{src:url(a.woff2) format(\'woff2\')}') === '' && lu.fontUrlFromCss(null) === '', 'fontUrlFromCss: woff2 is not taken; an address that is not Google\'s font host is not taken; nothing gives ""');

/* ---------- drawing a unit ---------- */

/* every tag closed, in order, and nothing left open */
function balanced(svg) {
  var open = [], re = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)(?:"[^"]*"|'[^']*'|[^>"'])*?(\/?)>/g, mm, last = 0;
  while ((mm = re.exec(svg))) {
    if (/[<>]/.test(svg.slice(last, mm.index))) return 'a stray < or > before ' + mm[0].slice(0, 30);
    last = re.lastIndex;
    if (mm[1]) { if (open.pop() !== mm[1]) return 'closed ' + mm[1] + ' out of order'; }
    else if (mm[2] && !mm[3]) open.push(mm[2]);
  }
  if (/[<>]/.test(svg.slice(last))) return 'a stray < or > at the end';
  return open.length ? 'left open: ' + open.join(',') : '';
}
function textsOf(svg) {
  var out = [], re = /<text\b([^>]*)>([^<]*)<\/text>/g, mm;
  function a(tag, name) { var x = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return x ? x[1] : ''; }
  while ((mm = re.exec(svg))) {
    out.push({ x: +a(mm[1], 'x'), y: +a(mm[1], 'y'), size: +a(mm[1], 'font-size'), spacing: +a(mm[1], 'letter-spacing') || 0, fill: a(mm[1], 'fill'), anchor: a(mm[1], 'text-anchor'),
      length: a(mm[1], 'textLength'), adjust: a(mm[1], 'lengthAdjust'), text: mm[2].replace(/&amp;/g, '&').replace(/&#39;/g, '\'') });
  }
  return out;
}

var NAME = 'ET AutoTech Summit 2027';
var parts = logoUnitParts(NAME);
ok(parts.before === 'ET' && parts.keyword === 'AutoTech' && parts.after === 'Summit 2027', 'the name is split by gen-design', JSON.stringify(parts));
var fontGiven = { family: 'Playfair Display', ttfBase64: ttf.toString('base64'), metrics: m };

['stacked', 'inline', 'boxed', 'underline'].forEach(function (style) {
  ['dark', 'light'].forEach(function (tone) {
    [fontGiven, null].forEach(function (font) {
      var label = 'unit ' + style + ' on ' + tone + (font ? ' with the font' : ' without a font') + ': ';
      var et = tone === 'dark' ? ET_DARK : ET_LIGHT;
      var u = lu.buildLogoUnitSvg({ parts: parts, style: style, tone: tone, themeColor: '#e8a317', font: font, etLogoSvg: et });
      var svg = u.svg;
      ok(typeof svg === 'string' && /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) (\d+)" width="\1" height="\2" role="img"/.test(svg) && u.width > 300 && u.height > 100 &&
        svg.indexOf('viewBox="0 0 ' + u.width + ' ' + u.height + '"') !== -1, label + 'one SVG with xmlns, viewBox, width, height and role', svg.slice(0, 160));
      ok(balanced(svg) === '', label + 'every tag is closed', balanced(svg));
      var doc = parseDocument(svg, { xmlMode: true });
      var root = doc.children.filter(function (n) { return n.type === 'tag'; });
      var title = domutils.findOne(function (e) { return e.name === 'title'; }, doc.children, true);
      ok(root.length === 1 && root[0].name === 'svg' && title && domutils.textContent(title) === NAME, label + 'reads as XML with one root and the event\'s full name as its title', title && domutils.textContent(title));
      ok(lu.svgIsActive(svg) === false, label + 'passes the upload route\'s SVG rules');
      var outside = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
      ok(!/https?:\/\//i.test(outside) && !/(href|src)\s*=\s*["'](?!data:)/i.test(outside) && !/url\(\s*["']?(?!data:)/i.test(outside), label + 'no reference to anything outside the file');

      var image = domutils.findOne(function (e) { return e.name === 'image'; }, doc.children, true);
      var href = image ? image.attribs.href : '';
      ok(/^data:image\/svg\+xml;base64,/.test(href) && Buffer.from(href.split(',')[1], 'base64').equals(Buffer.from(et, 'utf8')), label + 'the ET logo is inside, byte for byte');
      ok(image && Math.abs(+image.attribs.width / +image.attribs.height - (tone === 'dark' ? 401 / 39 : 365 / 35)) < 0.02 && Math.abs(+image.attribs.x + +image.attribs.width / 2 - u.width / 2) < 0.02,
        label + 'the ET logo keeps its proportions and is centred', image && image.attribs.width + 'x' + image.attribs.height);

      var texts = textsOf(svg);
      ok(texts.map(function (t) { return t.text; }).join('|') === 'ET|AUTOTECH|SUMMIT 2027', label + 'the name is real text, in capitals', texts.map(function (t) { return t.text; }).join('|'));
      var key = texts[1] || {}, small = texts[0] || {};
      ok(key.size > small.size * 2 && small.spacing > 0 && !key.spacing, label + 'the keyword is the largest; the small lines are letter-spaced');
      ok(small.fill === (tone === 'dark' ? '#ffffff' : '#16181d') && key.fill === (style === 'boxed' ? '#16181d' : '#e8a317'), label + 'colours for this hero', small.fill + ' / ' + key.fill);
      if (style === 'inline') ok(texts.every(function (t) { return t.y === texts[0].y; }) && texts[0].x < texts[1].x && texts[1].x < texts[2].x, label + 'one line, left to right');
      else ok(texts[0].y < texts[1].y && texts[1].y < texts[2].y && Math.abs(texts[1].x - u.width / 2) < 0.02, label + 'three centred lines, top to bottom');
      ok((svg.match(/<rect\b/g) || []).length === (style === 'boxed' || style === 'underline' ? 1 : 0) && (style === 'stacked' || style === 'inline' || /<rect[^>]* fill="#e8a317"/.test(svg)), label + 'a theme-colour box or rule only where the style has one');

      if (font) {
        ok(svg.indexOf('@font-face{font-family:\'rvlu\';src:url(data:font/ttf;base64,' + ttf.toString('base64') + ')') !== -1 && /font-family="'rvlu', Georgia, 'Times New Roman', serif"/.test(svg), label + 'the font is embedded and used');
        ok(texts.every(function (t) { return !t.length; }), label + 'measured lines need no textLength');
        ok(texts.every(function (t) {
          var w = lu.textWidth(m, t.text, t.size, t.spacing);
          return t.anchor === 'middle' && t.x - w / 2 >= 8 && t.x + w / 2 <= u.width - 8 && t.y <= u.height - 20 && t.y - m.capHeight / m.unitsPerEm * t.size >= 20;
        }), label + 'every line fits inside the viewBox, measured with the real font', JSON.stringify(texts.map(function (t) { return [t.x, Math.round(lu.textWidth(m, t.text, t.size, t.spacing)), u.width]; })));
        if (style === 'inline') {
          var spans = texts.map(function (t) { var w = lu.textWidth(m, t.text, t.size, t.spacing); return [t.x - t.spacing / 2 - w / 2, t.x - t.spacing / 2 + w / 2]; });
          ok(spans[0][1] < spans[1][0] && spans[1][1] < spans[2][0], label + 'the three parts do not overlap', JSON.stringify(spans));
        }
      } else {
        ok(svg.indexOf('@font-face') === -1 && /font-family="Arial, Helvetica, sans-serif"/.test(svg), label + 'a system face, nothing embedded');
        ok(texts.every(function (t) { return +t.length > 0 && t.adjust === 'spacingAndGlyphs' && Math.abs(+t.length - Array.from(t.text).length * (0.64 * t.size + t.spacing)) < 0.02 && t.x - t.length / 2 >= 8 && t.x + +t.length / 2 <= u.width - 8; }),
          label + 'estimated widths (0.64em a character) are enforced with textLength and fit', JSON.stringify(texts.map(function (t) { return t.length; })));
      }

      var next = lu.svgReplaceYear(svg, '2027', '2028');
      ok(next.changed === 2 && lu.svgTexts(next.svg).join('|') === 'ET|AUTOTECH|SUMMIT 2028' && next.svg.indexOf('<title>ET AutoTech Summit 2028</title>') !== -1 && next.svg.length === svg.length, label + 'a later edition\'s year can be set in it (title and text)', 'changed ' + next.changed);
      ok(lu.svgTexts(svg).join('|') === 'ET|AUTOTECH|SUMMIT 2027' && lu.imageInfo(Buffer.from(svg)).width === u.width && lu.plausibleUnit(lu.imageInfo(Buffer.from(svg))) === '', label + 'it reads back as a plausible unit of its own size');
    });
  });
});

/* colours that could not be read are not used for the keyword */
function keyFill(o) { return (textsOf(lu.buildLogoUnitSvg(Object.assign({ parts: { before: '', keyword: 'Tech', after: 'Summit' }, etLogoSvg: '', font: null }, o)).svg)[0] || {}).fill; }
ok(keyFill({ tone: 'dark', themeColor: '#0b1f4d', style: 'stacked' }) === '#ffffff', 'a theme colour too dark for a dark hero: the keyword is white');
ok(/<rect[^>]* fill="#0b1f4d"/.test(lu.buildLogoUnitSvg({ parts: { keyword: 'Tech' }, tone: 'dark', themeColor: '#0b1f4d', style: 'underline' }).svg), '… and the rule keeps the theme colour');
ok(keyFill({ tone: 'light', themeColor: '#ffe600', style: 'stacked' }) === '#16181d', 'a theme colour too light for a light hero: the keyword is dark');
ok(keyFill({ tone: 'light', themeColor: '#ffe600', style: 'boxed' }) === '#16181d' && keyFill({ tone: 'light', themeColor: '#0b1f4d', style: 'boxed' }) === '#ffffff', 'boxed: the keyword is whichever ink reads on the box');
ok(keyFill({ tone: 'light', themeColor: 'red; }', style: 'stacked' }) === '#e81d3d' && keyFill({ tone: 'dark', themeColor: '#E8A317', style: 'nonsense' }) === '#e8a317', 'a theme colour that is no #rrggbb falls back; an unknown style is "stacked"');

var noLogo = lu.buildLogoUnitSvg({ parts: { before: '', keyword: 'Tech 500', after: '' }, style: 'stacked', tone: 'light', themeColor: '#e8a317', font: { family: 'Playfair Display', ttfBase64: '' }, etLogoSvg: '' });
ok(noLogo.svg.indexOf('<image') === -1 && textsOf(noLogo.svg).length === 1 && /font-family="Georgia, 'Times New Roman', serif"/.test(noLogo.svg) && balanced(noLogo.svg) === '', 'no ET logo given, empty parts skipped, a serif family without its file: Georgia', noLogo.svg.slice(0, 200));
var missing = lu.buildLogoUnitSvg({ parts: { before: '', keyword: 'Zebra', after: 'Summit' }, style: 'stacked', tone: 'light', themeColor: '#e8a317', font: fontGiven, etLogoSvg: ET_LIGHT });
var mt = textsOf(missing.svg);
ok(+mt[0].length > 0 && !mt[1].length, 'a line with a character the font lacks has its width enforced; the others are left to the font', JSON.stringify(mt.map(function (t) { return t.length; })));
var selfMeasured = lu.buildLogoUnitSvg({ parts: parts, style: 'stacked', tone: 'dark', themeColor: '#e8a317', font: { family: 'Playfair Display', ttfBase64: ttf.toString('base64') }, etLogoSvg: ET_DARK });
ok(selfMeasured.svg === lu.buildLogoUnitSvg({ parts: parts, style: 'stacked', tone: 'dark', themeColor: '#e8a317', font: fontGiven, etLogoSvg: ET_DARK }).svg, 'a font given without its metrics is measured here');
var badFont = lu.buildLogoUnitSvg({ parts: parts, style: 'stacked', tone: 'dark', themeColor: '#e8a317', font: { family: 'Inter', ttfBase64: Buffer.from('not a font').toString('base64') }, etLogoSvg: ET_DARK });
ok(badFont.svg.indexOf('@font-face') === -1 && textsOf(badFont.svg).every(function (t) { return +t.length > 0; }), 'bytes that are no font are not embedded');

var hostile = lu.buildLogoUnitSvg({ parts: { before: 'A <b> & "C" \'D\'', keyword: 'JavaScript: online=1 </text><script>', after: 'data:text/html onload = x' }, style: 'inline', tone: 'dark', themeColor: '#e8a317', font: null, etLogoSvg: ET_DARK });
ok(lu.svgIsActive(hostile.svg) === false && balanced(hostile.svg) === '' && hostile.svg.indexOf('<script') === -1 && hostile.svg.indexOf('&lt;B&gt; &amp; &quot;C&quot;') !== -1, 'a name full of markup and code-like words is escaped and inert', hostile.svg.replace(/base64,[A-Za-z0-9+\/=]+/, 'base64,…').slice(0, 900));
var hd = parseDocument(hostile.svg, { xmlMode: true });
ok(domutils.findAll(function (e) { return e.type === 'tag'; }, hd.children).map(function (e) { return e.name; }).join(',') === 'svg,title,style,image,text,text,text', 'its elements are exactly the ones drawn');
ok(JSON.stringify(lu.buildLogoUnitSvg({ parts: { before: '', keyword: '  ', after: '' } })) === '{"svg":"","width":0,"height":0}' && JSON.stringify(lu.buildLogoUnitSvg()) === '{"svg":"","width":0,"height":0}', 'no name: no unit');

/* ---------- review findings: bytes and pages written to be slow or to mislead ---------- */

/* each input here is one the code took from seconds to minutes on before it read markup in one pass */
function timed(fn) { var t = Date.now(), r, threw = false; try { r = fn(); } catch (e) { threw = true; } return { ms: Date.now() - t, r: r, threw: threw }; }
function fast(label, limit, fn, check) {
  var t = timed(fn);
  ok(!t.threw && t.ms < limit, label + ': returns at once (' + t.ms + ' ms)', t.threw ? 'threw' : '');
  if (check) ok(!t.threw && check(t.r), label + ': and with the right answer', JSON.stringify(t.r).slice(0, 200));
}
function rep(s, n) { return new Array(n + 1).join(s); }

/* 1. the prolog of an SVG */
fast('imageInfo: many comments and no <svg>', 1500, function () { return lu.imageInfo(Buffer.from(rep('<!---->', 30000) + '<x>')); }, function (r) { return r.type === ''; });
ok(lu.imageInfo(Buffer.from('﻿ \n<?xml version="1.0" encoding="UTF-8"?>\n<!-- a --><!-- b -> -- c -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<!-- d -->\n<SVG width="300" height="60"></SVG>')).width === 300,
  'imageInfo: xml declaration, comments, DOCTYPE, comments, then <svg> is an SVG');
['<!DOCTYPE svg [<!ENTITY x "y">]><svg width="3" height="3"/>', '<!-- never closed <svg width="3" height="3"></svg>', '<!DOCTYPE html><svg width="3" height="3"></svg>', '<!DOCTYPE svg><!DOCTYPE svg><svg width="3" height="3"></svg>',
  '<?xml version="1.0"><svg width="3" height="3"></svg>', 'x<svg width="3" height="3"></svg>', '<svgx width="3" height="3"></svgx>', '<svg'].forEach(function (s, i) {
  ok(lu.imageInfo(Buffer.from(s)).type === '', 'imageInfo: not an SVG document (' + i + ')', s);
});

/* 2. tags and comments that never close */
fast('svgTexts: tags that never close', 1500, function () { return lu.svgTexts('<svg>' + rep('<a ', 300000)); }, function (r) { return r.length === 0; });
fast('svgReplaceYear: tags that never close', 1500, function () { return lu.svgReplaceYear('<svg><text>2025</text>' + rep('<a ', 300000), '2025', '2026'); }, function (r) { return r.changed === 1 && /^<svg><text>2026<\/text><a <a /.test(r.svg) && r.svg.length === 22 + 900000; });
fast('svgTexts: comments that never close', 1500, function () { return lu.svgTexts('<svg>' + rep('<!--', 250000)); }, function (r) { return r.length === 0; });
fast('svgTexts: CDATA and instructions that never close', 1500, function () { return lu.svgTexts('<svg>' + rep('<![CDATA[', 100000) + rep('<?x', 100000)); }, function (r) { return r.length === 0; });
fast('svgTexts: quotes that never close', 1500, function () { return lu.svgTexts('<svg>' + rep('<a "\'', 200000) + rep('<a \'', 200000)); });

/* 3. the <svg> tag itself */
fast('imageInfo: an <svg tag that never closes', 1500, function () { return lu.imageInfo(Buffer.from('<svg ' + rep('<svg ', 50000))); }, function (r) { return r.type === 'svg' && r.width === 0 && r.height === 0; });
ok(lu.imageInfo(Buffer.from('<svg viewBox="0 0 10 10"><svg width="300" height="60"></svg></svg>')).width === 10, 'imageInfo: the size is the document element\'s, not a later <svg>\'s');
ok(lu.imageInfo(Buffer.from('<svg data-a="width=\'900\' >" width=\'300\' height="60"></svg>')).width === 300, 'imageInfo: a ">" or a name inside a quoted value is not read as the tag\'s end or as an attribute');

/* 4. style sheets */
fast('svgTone: a style sheet with no braces', 1500, function () { return lu.svgTone('<svg><style>' + rep('a', 1000000) + '</style></svg>'); }, function (r) { return r === ''; });
fast('svgTone: <style> opened over and over', 1500, function () { return lu.svgTone('<svg>' + rep('<style>', 300000)); }, function (r) { return r === ''; });
ok(lu.svgTone('<svg><style>.a{fill:#fff}.b{stroke:#ffffff !important;fill:none}@media print{.c{fill:#000}}</style><path class="a"/><path class="a"/><path class="a"/><path class="b"/><path class="c"/></svg>') === 'for-dark',
  'svgTone: inks from a style sheet weigh as many shapes as use the class');
ok(lu.svgTone('<svg><style><![CDATA[ .a { fill : black } ]]></style><path class="a"/></svg>') === 'for-light', 'svgTone: a style sheet inside CDATA is read');

/* 5. boxes inside boxes */
var deepHero = '<section id="hero">' + rep('<div>', 400) + '<img class="logo" src="/x.png"><h2 class="hidden">Deep Summit 2025</h2>' + rep('<div><img src="/y.png">', 60000);
fast('findLogoCandidates: a hero hundreds of boxes deep, then sixty thousand more', 1500, function () { return lu.findLogoCandidates(deepHero, 'https://x.example.com/', 'X'); }, function (r) { return r.length >= 1 && r[0].url === 'https://x.example.com/x.png' && r[0].why.indexOf('img.logo in the hero') !== -1; });
fast('editionHints: a hero hundreds of boxes deep, then sixty thousand more', 1500, function () { return lu.editionHints(deepHero, 'https://x.example.com/'); }, function (r) { return r.years.join() === '2025' && r.headings.join() === 'Deep Summit 2025'; });
var deepMany = '<section id="hero">' + rep('<div>', 450) + rep('<img class="logo" src="/x.png"><h2 class="hidden">x</h2>', 25000);
fast('findLogoCandidates: thousands of pictures, each hundreds of boxes deep', 1500, function () { return lu.findLogoCandidates(deepMany, 'https://x.example.com/', 'X'); }, function (r) { return r.length === 1; });
fast('editionHints: thousands of headings, each hundreds of boxes deep', 1500, function () { return lu.editionHints(deepMany, 'https://x.example.com/'); }, function (r) { return r.headings.join() === 'x'; });
/* the parser itself looks through every open box at each closing tag: the page is not read past 500 deep */
['<header><div></svg>', '<div></x>', '</svg>x 2025 <div>', '<svg><g><text>', '<div><span>'].forEach(function (unit) {
  var page = '<section id="hero"><img class="logo" src="/first.png">' + rep(unit, Math.ceil(1500000 / unit.length)) + rep('</x>', 100000);
  fast('findLogoCandidates: a page of "' + unit + '" over and over', 3000, function () { return lu.findLogoCandidates(page, 'https://x.example.com/', 'X'); }, function (r) { return r.length >= 1 && r[0].url === 'https://x.example.com/first.png'; });
  fast('editionHints: a page of "' + unit + '" over and over', 3000, function () { return lu.editionHints(page, 'https://x.example.com/'); });
});
var hover = '<section id="hero"><img class="logo" src="/first.png">' + rep('<div>', 480) + rep('</x>', 370000);
fast('findLogoCandidates: closing tags that close nothing, 480 boxes deep', 3000, function () { return lu.findLogoCandidates(hover, 'https://x.example.com/', 'X'); }, function (r) { return r.length === 1; });
/* reading the page in pieces does not move where an element is */
var farSvg = '<p>' + rep('filler ', 3000) + '</p><section id="hero"><p>' + rep('é', 5000) + '</p><svg class="hero-logo" viewBox="0 0 520 140"><text>' + rep('AUTOTECH 2026 ', 700) + '</text></svg></section>';
var cf = lu.findLogoCandidates(farSvg, 'https://x.example.com/', 'Autotech Summit 2027');
ok(cf.length === 1 && cf[0].svg === farSvg.slice(farSvg.indexOf('<svg'), farSvg.indexOf('</svg>') + 6) && cf[0].svg.length > 2 * 4096, 'a drawing far down the page, longer than one piece of it, comes back exactly as written', cf[0] && cf[0].svg.slice(0, 80));

/* 6. addresses nobody outside a network can reach are never candidates */
['http://169.254.169.254/latest/meta-data/iam.svg', 'http://localhost:8080/admin.png', 'http://user:pw@10.0.0.5/x.png', 'https://user@img.etb2bimg.com/x.png', 'http://[::1]/x.png', 'http://[fd00::1]/x.png',
  'http://2130706433/x.png', 'http://0x7f.1/x.png', 'http://127.0.0.1./x.png', 'http://metadata/x.png', 'http://db.internal/x.png', 'http://printer.local/x.png', 'http://app.localhost/x.png', '//10.0.0.5/x.png'].forEach(function (src) {
  ['https://b2b.economictimes.indiatimes.com/x', '', 'http://10.9.0.1/page', 'http://localhost:5000/page'].forEach(function (pageUrl) {
    var page = '<section id="banner"><img class="logo" src="' + src + '"><div class="logo" style="background:url(' + src + ')"></div><img class="edition-img" src="' + src + '"></section>';
    var r = lu.findLogoCandidates(page, pageUrl, 'X');
    ok(r.length === 0, 'an internal address is no candidate: ' + src + ' on ' + (pageUrl || 'no page address'), urls(r));
    ok(lu.editionHints(page, pageUrl).editionImage === '', 'nor an edition badge: ' + src + ' on ' + (pageUrl || 'no page address'));
  });
});
ok(lu.findLogoCandidates('<section id="banner"><img class="logo" src="/x.png"></section>', 'http://192.168.0.1/', 'X').length === 0 && lu.findLogoCandidates('<section id="banner"><img class="logo" src="/x.png"></section>', 'https://u:p@x.example.com/', 'X').length === 0,
  'a page at an internal address, or one with a password in it, gives its relative pictures no address');
var cPublic = lu.findLogoCandidates('<section id="banner"><img class="logo" src="https://img.etb2bimg.com/files/a.png"></section>', '', 'X');
ok(cPublic.length === 1 && cPublic[0].url === 'https://img.etb2bimg.com/files/a.png', 'a public picture is still found when no page address is given', urls(cPublic));
ok(lu.fontUrlFromCss('@font-face{src:url(http://169.254.169.254/a.ttf) format("truetype")}') === '' && lu.fontUrlFromCss('@font-face{src:url(https://fonts.gstatic.com.evil.example/a.ttf) format("truetype")}') === '' &&
  lu.fontUrlFromCss('@font-face{src:url(http://fonts.gstatic.com/a.ttf) format("truetype")}') === '' && lu.fontUrlFromCss('@font-face{src:url(https://u:p@fonts.gstatic.com/a.ttf) format("truetype")}') === '' &&
  lu.fontUrlFromCss('@font-face{src:url(https://evil.example/a.ttf) format("truetype"), url("https://fonts.gstatic.com/s/b.ttf") format("truetype")}') === 'https://fonts.gstatic.com/s/b.ttf',
  'fontUrlFromCss: only an https address on fonts.gstatic.com is ever returned');
fast('fontUrlFromCss: url( over and over', 1500, function () { return lu.fontUrlFromCss(rep('url(', 60000)); }, function (r) { return r === ''; });

/* 7. srcset */
var cSet = lu.findLogoCandidates('<section id="hero"><img class="logo" src="" srcset="https://img.etb2bimg.com/w_300,h_200/a.png 1x, b.png 2x"></section>', 'https://b2b.economictimes.indiatimes.com/x', 'X');
ok(cSet.length === 1 && cSet[0].url === 'https://img.etb2bimg.com/w_300,h_200/a.png', 'srcset: an address with commas in it is read whole', urls(cSet));
cSet = lu.findLogoCandidates('<section id="hero"><img class="logo" src="" srcset=" , /a.png, /b.png 2x"><img class="hero-logo" data-srcset="/c.png 300w,/d.png 600w"></section>', 'https://x.example.com/', 'X');
ok(cSet.length === 2 && cSet[0].url === 'https://x.example.com/a.png' && cSet[1].url === 'https://x.example.com/c.png', 'srcset: a first address with no size after it; a list written without spaces after its commas', urls(cSet));

/* 8. base64 wrapped over lines */
function wrap76(b64) { return b64.replace(/(.{76})/g, '$1\r\n'); }
var innerYear = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 150"><path id="a2025" d="M2025 1 L 10 10 L 20 20 L 30 30 L 40 40 L 50 50 L 60 60 z"/><text>SUMMIT 2025</text></svg>';
var wrapped = '<svg xmlns="http://www.w3.org/2000/svg"><image width="600" href="data:image/svg+xml;charset=utf-8;base64,' + wrap76(Buffer.from(innerYear).toString('base64')) + '"/></svg>';
ok(wrapped.indexOf('\r\n') !== -1 && lu.svgLayers(wrapped).length === 2 && lu.svgLayers(wrapped)[1] === innerYear, 'svgLayers: a layer whose base64 is wrapped over lines is read whole', JSON.stringify(lu.svgLayers(wrapped)[1]));
ok(lu.svgTexts(wrapped).join('|') === 'SUMMIT 2025', 'svgTexts: … and its text is found', lu.svgTexts(wrapped).join('|'));
var rw = lu.svgReplaceYear(wrapped, '2025', '2026');
ok(rw.changed === 1 && lu.svgLayers(rw.svg)[1] === innerYear.replace('SUMMIT 2025', 'SUMMIT 2026') && /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"><image width="600" href="data:image\/svg\+xml;charset=utf-8;base64,[A-Za-z0-9+\/=]+"\/><\/svg>$/.test(rw.svg),
  'svgReplaceYear: … and its year is moved on', rw.svg.slice(0, 200));

var bare = '<svg><image href=data:image/svg+xml;base64,' + Buffer.from('<svg><text>2025</text></svg> ').toString('base64') + ' width=5 height=7 /></svg>';
var rb = lu.svgReplaceYear(bare, '2025', '2026');
ok(rb.changed === 1 && / width=5 height=7 \/><\/svg>$/.test(rb.svg) && lu.svgLayers(rb.svg)[1] === '<svg><text>2026</text></svg> ', 'svgReplaceYear: an address written without quotes ends at the first space; what follows it stays', rb.svg);

/* 9. a character written as its number is not a year */
var refs = lu.svgReplaceYear('<svg aria-label="A&#x2025;B 2025"><text>A&#x2025;B &#2025; &#x12025; &#xA2025; &#02025; 2025 &amp;2025 #2025</text></svg>', '2025', '2026');
ok(refs.changed === 4 && refs.svg === '<svg aria-label="A&#x2025;B 2026"><text>A&#x2025;B &#2025; &#x12025; &#xA2025; &#02025; 2026 &amp;2026 #2026</text></svg>', 'svgReplaceYear: &#x2025; and &#2025; are characters, not years', refs.svg);

/* 10. markup that is not well formed (a drawing lifted out of an HTML page) */
var loose = '<svg><text><tspan>2025</text><style>.a{fill:#2025aa} /* 2025 */</style><script>var y=2025</script><g>2025</g></svg>';
var rl = lu.svgReplaceYear(loose, '2025', '2026');
ok(rl.changed === 1 && rl.svg === loose.replace('<tspan>2025', '<tspan>2026'), 'svgReplaceYear: a <tspan> that is never closed ends with its <text>; CSS and script are never touched', rl.svg);
ok(lu.svgTexts(loose).join('|') === '2025', 'svgTexts: … and the same for what counts as text', lu.svgTexts(loose).join('|'));
rl = lu.svgReplaceYear('<svg><text>2025<style>.a{fill:#2025aa}</style><script>2025</script> 2025</text></svg><p>2025</p>', '2025', '2026');
ok(rl.changed === 2 && rl.svg === '<svg><text>2026<style>.a{fill:#2025aa}</style><script>2025</script> 2026</text></svg><p>2025</p>', 'svgReplaceYear: not in a <style> or <script> even inside <text>', rl.svg);
rl = lu.svgReplaceYear('<svg><title>T 2025</svg> 2025 <svg><desc>2025</desc></svg>', '2025', '2026');
ok(rl.changed === 2 && rl.svg === '<svg><title>T 2026</svg> 2025 <svg><desc>2026</desc></svg>', 'svgReplaceYear: </svg> ends whatever was left open', rl.svg);
fast('svgReplaceYear: text opened a hundred thousand times', 1500, function () { return lu.svgReplaceYear('<svg>' + rep('<tspan>', 100000) + rep('2025</text>', 100000), '2025', '2026'); }, function (r) { return r.changed === 100000; });

/* 11. CDATA is characters */
var cdata = lu.svgReplaceYear('<svg><text><![CDATA[SUMMIT 2025 <b> & co]]></text><![CDATA[2025]]><title><![CDATA[2025]]></title></svg>', '2025', '2026');
ok(cdata.changed === 2 && cdata.svg === '<svg><text><![CDATA[SUMMIT 2026 <b> & co]]></text><![CDATA[2025]]><title><![CDATA[2026]]></title></svg>', 'svgReplaceYear: CDATA inside <text> and <title> is text', cdata.svg);
ok(lu.svgTexts('<svg><text>A &amp; B<![CDATA[SUMMIT 2025 <b> &amp; co]]></text><![CDATA[x]]></svg>').join('|') === 'A & B|SUMMIT 2025 <b> &amp; co', 'svgTexts: CDATA inside <text> is reported as written');

/* 12. a layer the texts are reported from is a layer the year is moved in */
var cssLayer = '<svg xmlns="http://www.w3.org/2000/svg"><style>.bg{background:url(data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>2025</text></svg>').toString('base64') + ')}</style><rect class="bg"/></svg>';
var rc = lu.svgReplaceYear(cssLayer, '2025', '2026');
ok(lu.svgTexts(cssLayer).join('|') === '2025' && rc.changed === 1 && lu.svgTexts(rc.svg).join('|') === '2026', 'a layer inside a style sheet: its text is reported and its year is moved', lu.svgTexts(cssLayer).join('|') + ' / changed ' + rc.changed);
var b64Year = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>2025</text></svg>').toString('base64');
var notShown = '<svg><!-- data:image/svg+xml;base64,' + b64Year + ' --><text>data:image/svg+xml;base64,' + b64Year + '</text><script>"data:image/svg+xml;base64,' + b64Year + '"</script></svg>';
ok(lu.svgLayers(notShown).length === 1 && lu.svgReplaceYear(notShown, '2025', '2026').changed === 0 && lu.svgTexts(notShown).length === 1, 'a layer written in a comment, in text or in a script is not a picture: neither reported nor changed', lu.svgLayers(notShown).length + ' layers');
[yearSvg, nested, wrapped, cssLayer, loose].forEach(function (s, i) {
  var before = lu.svgTexts(s), done = lu.svgReplaceYear(s, i < 2 ? '2026' : '2025', '2031'), want = before.filter(function (t) { return /(^|[^0-9])(2025|2026)(?![0-9])/.test(t); }).length;
  ok(done.changed >= want && want > 0 && lu.svgTexts(done.svg).length === before.length, 'every year svgTexts reports, svgReplaceYear can move (' + i + ')', want + ' reported, ' + done.changed + ' moved');
});

/* 13. half an emoji (a name cut in the middle of one) */
['Tech \ud83d', '\udc00 Tech', 'A\ud83d😀B'].forEach(function (text, i) {
  var t = timed(function () { return lu.googleFontCssUrl('Inter\ud83d ' + (i ? 'Tight' : ''), 700, text); });
  ok(!t.threw && /^https:\/\/fonts\.googleapis\.com\/css2\?family=Inter(\+Tight)?:wght@700&text=[%\w.-]+$/.test(t.r) && decodeURIComponent(t.r).indexOf('�') === -1, 'googleFontCssUrl: half an emoji is left out, nothing throws (' + i + ')', t.threw ? 'threw' : t.r);
});
var wholeEmoji = timed(function () { return decodeURIComponent(lu.googleFontCssUrl('Inter', 700, 'A\ud83d😀B').split('&text=')[1]); });
ok(!wholeEmoji.threw && wholeEmoji.r === ' 0123456789AB😀', 'googleFontCssUrl: a whole emoji is kept', wholeEmoji.threw ? 'threw' : wholeEmoji.r);
var halfUnit = timed(function () { return lu.buildLogoUnitSvg({ parts: { before: 'ET\ud83d', keyword: 'Tech \udc00Summit', after: '' }, font: null, etLogoSvg: '' }); });
ok(!halfUnit.threw && textsOf(halfUnit.r.svg).map(function (t) { return t.text; }).join('|') === 'ET|TECH SUMMIT' && Buffer.from(halfUnit.r.svg, 'utf8').toString('utf8') === halfUnit.r.svg, 'buildLogoUnitSvg: half an emoji is left out of the unit', halfUnit.r && halfUnit.r.svg.slice(0, 300));

/* 14. letters that only become "JAVASCRIPT:" or "ONLINE=" once they are capitals */
[{ before: '', keyword: 'javaſcript: summit', after: '' }, { before: 'go onlıne= now', keyword: 'Tech', after: 'data : text/html' }, { before: 'online', keyword: '= 1', after: 'x' }, { before: 'JavaScript', keyword: ': summit', after: 'data :text/html' },
  { before: 'onlıne', keyword: '=', after: 'javaſcript :x' }, { before: 'ſcript', keyword: '<ſcript>', after: 'onſubmit=' }].forEach(function (p, i) {
  ['stacked', 'inline'].forEach(function (style) {
    var u = lu.buildLogoUnitSvg({ parts: p, style: style, tone: 'dark', themeColor: '#e8a317', font: null, etLogoSvg: ET_DARK });
    ok(u.svg !== '' && lu.svgIsActive(u.svg) === false && balanced(u.svg) === '', 'buildLogoUnitSvg: the unit drawn for a code-like name passes the upload rules (' + i + ', ' + style + ')', u.svg.replace(/base64,[A-Za-z0-9+\/=]+/, 'base64,…').slice(0, 600));
  });
});

/* 15. words about colours are not colours */
ok(lu.svgTone('<svg><text>we fill: white; stroke: white; fill: white;</text><path fill="#000"/></svg>') === 'for-light', 'svgTone: "fill: white" written as words inside <text> is not an ink', lu.svgTone('<svg><text>we fill: white; stroke: white; fill: white;</text><path fill="#000"/></svg>'));
ok(lu.svgTone('<svg><!-- fill="#fff" fill="#fff" --><title>fill="#fff"; fill:#fff</title><path fill="#000" aria-label=" fill=\'#fff\'; stroke:#fff; fill:#fff"/></svg>') === 'for-light', 'svgTone: nor in a comment, a title or another attribute\'s value');
ok(lu.svgTone('<svg><path style="fill:#FFF;stroke:none"/><path fill=white /><g stroke=\'#fefefe\'></g><path fill="#000"/></svg>') === 'for-dark', 'svgTone: style="", unquoted and single-quoted attributes are all read');

/* nothing above a size that a logo unit never has */
var tooBig = '<svg><text fill="#000">2025</text>' + rep(' ', 4200000) + '</svg>';
fast('an SVG over 4,000,000 characters is left alone', 1500, function () { return [lu.svgTexts(tooBig).length, lu.svgReplaceYear(tooBig, '2025', '2026').changed, lu.svgTone(tooBig), lu.svgLayers(tooBig).length]; }, function (r) { return r.join() === '0,0,,1'; });

if (failures.length) {
  console.log(failures.length + ' of ' + checks + ' checks FAILED:\n\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('logo-unit: all ' + checks + ' checks passed');
