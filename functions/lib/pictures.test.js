/* node functions/lib/pictures.test.js — exits 1 on the first failure it lists.
   Pictures' WebP variants (lib/pictures.js): their names, which ones a page may use, and what a page's
   <img> tags and CSS backgrounds become. No network, no Firebase (sharp is used when it is installed). */

const crypto = require('crypto');
const P = require('./pictures');

var failures = [], checks = 0;
function ok(cond, label, detail) { checks++; if (!cond) failures.push(label + (detail ? '\n      ' + detail : '')); }
function count(text, needle) { return String(text).split(needle).length - 1; }

var BUCKET = 'revamp-cms.firebasestorage.app';
var BASE = 'https://storage.googleapis.com/' + BUCKET + '/';

/* ---- names ---- */
ok(P.widthsFor(1024).join() === '640,1024', 'a 1024 px picture gets 640 and its own width', P.widthsFor(1024).join());
ok(P.widthsFor(1920).join() === '640,1280,1920', 'a 1920 px picture gets the three standard widths');
ok(P.widthsFor(4000).join() === '640,1280,1920', 'a wider one stops at 1920');
ok(P.widthsFor(300).join() === '300', 'a small one gets its own width only');
ok(P.widthsFor(660).join() === '660', 'no 640 copy of a 660 px picture (too close to be worth it)');
var vn = P.variantName('events/e/generated/1-overview.png', 'abcdef12', 1024, 1024, 640);
ok(vn === 'events/e/generated/1-overview.png.rv-abcdef12.1024x1024.w640.webp', 'variant name', vn);
var pv = P.parseVariant(vn);
ok(pv && pv.source === 'events/e/generated/1-overview.png' && pv.hash === 'abcdef12' && pv.w === 1024 && pv.width === 640, 'variant name read back');
ok(!P.parseVariant('events/e/generated/1-overview.png'), 'an original is not a variant');
ok(P.wanted('events/e/speakers/a.JPG') && P.wanted('events/e/x/a.webp') && !P.wanted('events/e/x/a.svg') && !P.wanted('events/e/x/a.gif') && !P.wanted(vn), 'which files get variants');
ok(P.isLogoPath('events/e/generated/1-logo-unit.png') && !P.isLogoPath('events/logo-event/generated/1-overview.png'), 'logos are known by their file name only');

/* ---- addresses ---- */
ok(P.pathOfUrl(BASE + 'events/e/generated/hero-bg.png?v=2026', BUCKET) === 'events/e/generated/hero-bg.png', 'a ?v= address');
ok(P.pathOfUrl(BASE + 'events/e/speakers/a%20b.png', BUCKET) === 'events/e/speakers/a b.png', 'an encoded address');
ok(P.pathOfUrl('https://storage.googleapis.com/other-bucket/events/e/a.png', BUCKET) === '', 'another bucket is not ours');
ok(P.pathOfUrl(BASE + 'events/e/../x.png', BUCKET) === '', 'no way out of events/');
ok(P.pathOfUrl('https://img.etb2bimg.com/files/a.png', BUCKET) === '', 'a CDN picture is not ours');

/* ---- the index: variants are used only for the picture they were made from ---- */
function md5b64(hex) { return Buffer.from(hex.padEnd(32, '0'), 'hex').toString('base64'); }
var OV = 'events/e/generated/1-overview.png', HERO = 'events/e/generated/hero-bg.png', OLD = 'events/e/generated/2-old.png';
var LIST = [
  { name: OV, md5Hash: md5b64('aaaaaaaa') },
  { name: P.variantName(OV, 'aaaaaaaa', 1024, 1024, 640) },
  { name: P.variantName(OV, 'aaaaaaaa', 1024, 1024, 1024) },
  { name: HERO, md5Hash: md5b64('bbbbbbbb') },
  { name: P.variantName(HERO, 'bbbbbbbb', 1344, 768, 640) },
  { name: P.variantName(HERO, 'bbbbbbbb', 1344, 768, 1280) },
  { name: P.variantName(HERO, 'bbbbbbbb', 1344, 768, 1344) },
  { name: OLD, md5Hash: md5b64('cccccccc') },
  { name: P.variantName(OLD, 'dddddddd', 800, 600, 800) },            // made from an earlier picture
  { name: P.variantName('events/e/generated/gone.png', 'eeeeeeee', 800, 600, 800) }   // its original was deleted
];
var index = P.indexFromListing(BUCKET, LIST);
ok(index.entries[OV] && index.entries[OV].widths.join() === '640,1024' && index.entries[OV].w === 1024, 'an original with its variants');
ok(!index.entries[OLD], 'variants of an earlier picture under the same name are not used');
ok(!index.entries['events/e/generated/gone.png'], 'variants whose original is gone are not used');
ok(P.hex8OfMd5Base64(md5b64('aaaaaaaa')) === 'aaaaaaaa', 'Storage md5Hash read');

var map = P.siteDataMap(index);
ok(map[BASE + OV] === 'aaaaaaaa.1024x1024:640,1024', 'the map for the page runtime', JSON.stringify(map));

/* ---- a page ---- */
var PAGE = [
  '<!DOCTYPE html><html><head><title>x</title>',
  '<style data-rv-style="hero">.hero-root{min-height:88vh;background-image:url("' + BASE + HERO + '?v=1");background-size:cover}</style>',
  '<style>.about{background:linear-gradient(#000,#111), url(' + BASE + OV + ') center/cover no-repeat !important}.x{background:url(' + BASE + 'events/e/generated/none.png)}</style>',
  '</head><body>',
  '<section id="hero" class="hero-root hero-on-dark"><div class="hero-veil"></div><img class="hero-bg" src="' + BASE + HERO + '?v=1" alt=""></section>',
  '<section class="overview"><img src="' + BASE + OV + '" alt="Delegates"></section>',
  '<section><img src="' + BASE + HERO + '" alt="" loading="lazy" class="w-full"><img src="' + BASE + OV + '" width="400" alt=""><img src="' + BASE + OV + '" srcset="' + BASE + OV + ' 1x" alt="kept"></section>',
  '<div style="background-image:url(&quot;' + BASE + OV + '&quot;)">x</div>',
  '<img src="' + BASE + 'events/e/generated/2-old.png" alt="no variants">',
  '<img src="https://img.etb2bimg.com/files/a.png" alt="not ours">',
  '<script>var t = \'<img src="' + BASE + OV + '">\';</script>',
  '<!-- <img src="' + BASE + OV + '"> -->',
  '</body></html>'
].join('\n');

var out = P.rewriteHtml(PAGE, index);
var V = function (path, e, w) { return BASE + P.variantName(path, e.hash, e.w, e.h, w); };
var ov = index.entries[OV], hero = index.entries[HERO];

ok(out.indexOf('<img class="hero-bg" src="' + BASE + HERO + '?v=1" alt="" srcset="' + V(HERO, hero, 1344) + ' 1x" width="1344" height="768" data-rv-sized fetchpriority="high">') !== -1,
  'the hero picture: its full-size WebP at 1x, its size, and loaded first', out.split('\n')[4]);
ok(out.indexOf('<img src="' + BASE + OV + '" alt="Delegates" srcset="' + V(OV, ov, 1024) + ' 1x" width="1024" height="1024" data-rv-sized>') !== -1,
  'a picture loaded at once outside the hero: full size, never fetchpriority', out.split('\n')[5]);
ok(out.indexOf('srcset="' + V(HERO, hero, 640) + ' 640w, ' + V(HERO, hero, 1280) + ' 1280w, ' + V(HERO, hero, 1344) + ' 1344w" sizes="(max-width: 767px) 100vw, (max-width: 1792px) 75vw, 1344px"') !== -1,
  'a lazy picture: every width, for the browser to choose');
ok(out.indexOf('width="400" alt="" srcset="' + V(OV, ov, 1024) + ' 1x" height="400" data-rv-sized>') !== -1, 'a picture with only a width gets the matching height');
ok(out.indexOf('srcset="' + BASE + OV + ' 1x" alt="kept">') !== -1 && count(out, 'alt="kept"') === 1 && out.indexOf('alt="kept" srcset') === -1, 'a srcset the page has is kept');
ok(out.indexOf('alt="no variants">') !== -1 && out.indexOf('alt="not ours">') !== -1, 'pictures without variants are as they were');
ok(out.indexOf('var t = \'<img src="' + BASE + OV + '">\'') !== -1, 'a script is never touched');
ok(out.indexOf('<!-- <img src="' + BASE + OV + '"> -->') !== -1, 'a comment is never touched');
ok(out.indexOf('background-image:url("' + BASE + HERO + '?v=1");background-image:image-set(url("' + V(HERO, hero, 1344) + '") type("image/webp"), url("' + BASE + HERO + '?v=1"));background-size:cover') !== -1,
  'a CSS background keeps its url() and gets image-set after it', out.split('\n')[1]);
ok(out.indexOf('center/cover no-repeat !important;background:linear-gradient(#000,#111), image-set(url("' + V(OV, ov, 1024) + '") type("image/webp"), url("' + BASE + OV + '")) center/cover no-repeat !important}') !== -1,
  'a background shorthand with layers and !important', out.split('\n')[2]);
ok(out.indexOf('.x{background:url(' + BASE + 'events/e/generated/none.png)}') !== -1, 'a background without variants is as it was');
ok(out.indexOf('style="background-image:url(&quot;' + BASE + OV + '&quot;);background-image:image-set(url(\'' + V(OV, ov, 1024) + '\') type(\'image/webp\'), url(\'' + BASE + OV + '\'))"') !== -1,
  'a style attribute', out.split('\n')[7]);
ok(count(out, '<style data-rv-pictures>') === 1 && out.indexOf('<head>\n' + P.SIZED_CSS + '\n<link rel="preload" as="image" type="image/webp" href="' + V(HERO, hero, 1344) + '" fetchpriority="high" data-rv-pictures-preload><title>') !== -1,
  'the rule for sized pictures and the hero background preload, once, in the head');
ok(P.rewriteHtml(out, index) === out, 'running it again changes nothing');
ok(P.rewriteHtml(PAGE, { bucket: BUCKET, entries: {} }) === PAGE && P.rewriteHtml(PAGE, null) === PAGE, 'no variants: the page as it was');

/* only the first hero picture is loaded first, and nothing outside a hero */
var two = P.rewriteHtml('<div class="banner"><img src="' + BASE + HERO + '"><img src="' + BASE + HERO + '"></div>', index);
ok(count(two, 'fetchpriority="high"') === 1, 'one picture loaded first', two);
ok(P.rewriteHtml('<section class="heroic"><img src="' + BASE + HERO + '"></section>', index).indexOf('fetchpriority') === -1, '"heroic" is not a hero');
ok(P.rewriteHtml('<div id="hero"><img src="' + BASE + HERO + '" fetchpriority="low"></div>', index).indexOf('fetchpriority="high"') === -1, 'a fetchpriority the page set is kept');
var small = P.rewriteHtml('<div class="hero"><img src="' + BASE + OV + '"></div>', P.indexFromListing(BUCKET, [{ name: OV, md5Hash: md5b64('aaaaaaaa') }, { name: P.variantName(OV, 'aaaaaaaa', 600, 600, 600) }]));
ok(small.indexOf('fetchpriority') === -1, 'a small picture in a hero is not the one to load first');
/* a picture wider than 1920: the full-size copy keeps its natural size */
var wide = P.rewriteHtml('<img src="' + BASE + 'events/e/gallery/w.jpg">', P.indexFromListing(BUCKET, [{ name: 'events/e/gallery/w.jpg', md5Hash: md5b64('12345678') }, { name: P.variantName('events/e/gallery/w.jpg', '12345678', 4000, 3000, 1920) }]));
ok(wide.indexOf(' 0.48x"') !== -1 && wide.indexOf('width="4000" height="3000"') !== -1, 'a wider picture: density below 1, natural size unchanged', wide);
/* the full-size copy came out no smaller than the original and was not kept: the original keeps those pixels */
var PART = 'events/e/speakers/p.jpg';
var partial = P.indexFromListing(BUCKET, [{ name: PART, md5Hash: md5b64('99999999') }, { name: P.variantName(PART, '99999999', 1400, 900, 640) }]);
var pe = P.rewriteHtml('<img src="' + BASE + PART + '">', partial);
ok(pe.indexOf('srcset') === -1 && pe.indexOf('width="1400" height="900"') !== -1, 'no full-size copy: a picture loaded at once keeps its original (and gets its size)', pe);
var pl = P.rewriteHtml('<img loading="lazy" src="' + BASE + PART + '">', partial);
ok(pl.indexOf(' 640w, ' + BASE + PART + ' 1400w"') !== -1, 'no full-size copy: a lazy picture offers the original for the widest screens', pl);
ok(P.rewriteHtml('<style>.a{background:url(' + BASE + PART + ')}</style>', partial).indexOf('image-set') === -1, 'no full-size copy: a background keeps its original');
ok(P.rewriteHtml('<img src="' + BASE + PART + '" width="10" height="10">', partial) === '<img src="' + BASE + PART + '" width="10" height="10">', 'nothing to add: the tag as it was');
ok(P.urlsIn(PAGE).length >= 6 && P.urlsIn(PAGE).every(function (u) { return /storage\.googleapis\.com/.test(u); }), 'every picture of ours a page names is found');

/* ---- making them (when the picture library is here) ---- */
function finish() {
  if (failures.length) {
    console.error('pictures: ' + failures.length + ' of ' + checks + ' checks failed:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
  console.log('pictures: all ' + checks + ' checks passed' + (P.available() ? '' : ' (sharp not installed: making variants not tested)'));
}
if (!P.available()) finish();
else {
  var sharp = require('sharp');
  sharp({ create: { width: 1500, height: 900, channels: 3, background: '#3366aa' } }).png({ compressionLevel: 0 }).toBuffer().then(function (png) {
    return P.makeVariants(png).then(function (made) {
      ok(made && made.width === 1500 && made.height === 900, 'the original\'s size', JSON.stringify(made && { w: made.width, h: made.height }));
      ok(made && made.variants.map(function (v) { return v.width; }).join() === '640,1280,1500', 'its widths');
      ok(made && made.hash === crypto.createHash('md5').update(png).digest('hex').slice(0, 8), 'named after its MD5');
      ok(made && made.variants.every(function (v) { return v.buffer.length < png.length && v.buffer.toString('latin1', 8, 12) === 'WEBP'; }), 'every copy is a smaller WebP');
      return sharp(made.variants[0].buffer).metadata().then(function (m) { ok(m.width === 640 && m.height === 384, 'a copy keeps the proportions', m.width + 'x' + m.height); });
    });
  }).then(function () {
    return P.makeVariants(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).then(function (r) { ok(r === null, 'an SVG gets no variants'); });
  }).then(function () {
    return P.makeVariants(Buffer.from('not a picture')).then(function (r) { ok(r === null, 'something that is not a picture: none, no error'); });
  }).then(function () {
    /* a JPEG turned by its EXIF orientation is measured as it is shown */
    return sharp({ create: { width: 800, height: 400, channels: 3, background: '#888' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer().then(function (jpg) {
      return P.makeVariants(jpg).then(function (made) { ok(made === null || (made.width === 400 && made.height === 800), 'EXIF orientation applied', made && made.width + 'x' + made.height); });
    });
  }).then(finish, function (err) { failures.push('threw: ' + (err && err.stack)); finish(); });
}
