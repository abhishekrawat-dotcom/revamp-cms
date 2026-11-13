/* node functions/lib/phone-banner-editor.test.js — the banner's own picture for phones in the site editor, on the site
   and in "Copy for another website" (editor-phone-banner.js; the owner, 13 Nov 2026: "A mobile version of hero
   background banner should be there, currently it is blank. (add option to generate mobile banner on the basis of
   current background banner)"):
     E.1  the page's rule: phones (up to 767px) show the phone picture over the banner's own, keyed by its address;
          without one nothing is there, and phones keep the banner's own picture
     E.2  publishing (functions/lib/pictures.js): the rule gets its WebP copy, the phone picture is preloaded for phones
          and the banner's for larger screens only; doing it twice changes nothing
     E.3  on the page (a small stand-in for the DOM): set, read, remove; a new banner picture takes the phone one with it
     E.4  "Copy for another website": the banner's picture moves from its style attribute (inline !important outweighs
          every rule) into the CSS, the phone's follows in a max-width media query, every declaration !important, under
          a selector that outweighs the section's own; a preload for each kind of screen; no double quote in the HTML
     E.5  the wiring: loaded and served, "Phone banner" beside "Background picture" on the banner's toolbar, the copy's
          hook, the canvas's; ES5; the words a person reads
   No network, no browser (the whole thing in a real browser is the QA run). */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
var passed = 0, failed = 0;
function check(name, ok, detail) { if (ok) { passed++; return; } failed++; console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 700) : '')); }

var SRC = read('editor-phone-banner.js');
var win = {};
vm.runInNewContext(SRC, { window: win });
var PB = win.RevampPhoneBanner, T = PB._test;
var URL1 = 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/awards-2027/generated/mhx1-phone-banner.png';
var DESK = 'https://storage.googleapis.com/revamp-cms.firebasestorage.app/events/awards-2027/media/banner-1350x600.jpg';

/* ===== E.1 the page's rule ===== */
var css = T.pageCss(URL1);
check('E.1 the rule: phones only, keyed by the picture\'s address, over the banner\'s own (important), covering the tall frame',
  css === '@media (max-width: 767px){[data-rv-phone-banner="' + URL1 + '"]{background-image:url("' + URL1 + '") !important;background-size:cover !important;background-position:center !important}}', css);
check('E.1 only an https address with nothing that could end a url() or an attribute is used', T.usableUrl(URL1) && !T.usableUrl('http://x/a.png') && !T.usableUrl('https://x/a").png') &&
  !T.usableUrl("https://x/a'.png") && !T.usableUrl('https://x/a b.png') && !T.usableUrl('data:image/png;base64,AA') && !T.usableUrl(''));
check('E.1 this event\'s own pictures only: an upload anywhere under it, ETB2B AI\'s under generated/', T.ownPicture(URL1, 'awards-2027', true) && T.ownPicture(DESK, 'awards-2027', false) &&
  !T.ownPicture(DESK, 'awards-2027', true) && !T.ownPicture(URL1, 'other', false) && !T.ownPicture('https://evil.example/events/awards-2027/generated/x.png', 'awards-2027', true));

/* ===== E.2 publishing ===== */
var P = require('./pictures');
var BUCKET = 'revamp-cms.firebasestorage.app', BASE = 'https://storage.googleapis.com/' + BUCKET + '/';
function md5b64(hex) { return Buffer.from(hex.padEnd(32, '0'), 'hex').toString('base64'); }
var HERO = 'events/awards-2027/generated/hero-bg.png', PHONE = 'events/awards-2027/generated/mhx1-phone-banner.png';
var index = P.indexFromListing(BUCKET, [
  { name: HERO, md5Hash: md5b64('bbbbbbbb') }, { name: P.variantName(HERO, 'bbbbbbbb', 1344, 768, 640) }, { name: P.variantName(HERO, 'bbbbbbbb', 1344, 768, 1344) },
  { name: PHONE, md5Hash: md5b64('cccccccc') }, { name: P.variantName(PHONE, 'cccccccc', 768, 1344, 640) }, { name: P.variantName(PHONE, 'cccccccc', 768, 1344, 768) }
]);
var heroWebp = BASE + P.variantName(HERO, 'bbbbbbbb', 1344, 768, 1344), phoneWebp = BASE + P.variantName(PHONE, 'cccccccc', 768, 1344, 768);
var PAGE = '<!DOCTYPE html><html><head><title>x</title><style data-rv-style="hero">.hero-root{background-image:url("' + BASE + HERO + '");background-size:cover}</style></head><body>' +
  '<section id="hero" class="hero-root" data-rv-section="hero" data-rv-phone-banner="' + URL1 + '"><div class="hero-veil"></div><h1>x</h1><style data-rv-phone-banner-css>' + T.pageCss(URL1) + '</style></section></body></html>';
var out = P.rewriteHtml(PAGE, index);
check('E.2 the phone rule gets its WebP copy, still for phones and still important',
  out.indexOf('background-image:url("' + URL1 + '") !important;background-image:image-set(url("' + phoneWebp + '") type("image/webp"), url("' + URL1 + '")) !important;background-size:cover !important') !== -1, out);
check('E.2 the phone picture is preloaded for phones, the banner\'s for larger screens only',
  out.indexOf('<link rel="preload" as="image" type="image/webp" href="' + heroWebp + '" fetchpriority="high" media="(min-width: 768px)" data-rv-pictures-preload>') !== -1 &&
  out.indexOf('<link rel="preload" as="image" type="image/webp" href="' + phoneWebp + '" fetchpriority="high" media="(max-width: 767px)" data-rv-pictures-phone>') !== -1, out.slice(0, 700));
check('E.2 doing it twice changes nothing', P.rewriteHtml(out, index) === out);
var plain = P.rewriteHtml(PAGE.replace(/ data-rv-phone-banner="[^"]*"/, '').replace(/<style data-rv-phone-banner-css>[\s\S]*?<\/style>/, ''), index);
check('E.2 without a phone banner the banner\'s preload is for every screen, as before', plain.indexOf('<link rel="preload" as="image" type="image/webp" href="' + heroWebp + '" fetchpriority="high" data-rv-pictures-preload>') !== -1 &&
  plain.indexOf('data-rv-pictures-phone') === -1);
var styleText = /<style data-rv-phone-banner-css>([\s\S]*?)<\/style>/.exec(out)[1];
var decls = T.declsOf(styleText);
check('E.2 the rule\'s declarations as the copy takes them: all four, each !important',
  decls === 'background-image:url("' + URL1 + '") !important; background-image:image-set(url("' + phoneWebp + '") type("image/webp"), url("' + URL1 + '")) !important; background-size:cover !important; background-position:center !important;', decls);
check('E.2 the WebP is the picture a browser takes (preloaded in the copy)', JSON.stringify(T.pictureOf(decls)) === JSON.stringify({ href: phoneWebp, webp: true }) &&
  JSON.stringify(T.pictureOf('background-image:url("' + URL1 + '") !important;')) === JSON.stringify({ href: URL1, webp: false }));

/* ===== a small stand-in for the DOM: enough for the module's own selectors ===== */
function El(tag, doc) { this.tagName = tag.toUpperCase(); this.localName = tag; this.attrs = {}; this.children = []; this.parentNode = null; this.ownerDocument = doc; this.text = ''; this.sheet = null; }
El.prototype.getAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; };
El.prototype.setAttribute = function (n, v) { this.attrs[n] = String(v); };
El.prototype.removeAttribute = function (n) { delete this.attrs[n]; };
El.prototype.hasAttribute = function (n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); };
El.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; };
El.prototype.insertBefore = function (c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; var i = ref ? this.children.indexOf(ref) : -1; if (i === -1) this.children.push(c); else this.children.splice(i, 0, c); return c; };
El.prototype.removeChild = function (c) { var i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); c.parentNode = null; return c; };
El.prototype.all = function () { var out = []; this.children.forEach(function (c) { out.push(c); out = out.concat(c.all()); }); return out; };
El.prototype.contains = function (o) { return o === this || this.all().indexOf(o) !== -1; };
Object.defineProperty(El.prototype, 'textContent', { get: function () { return this.text; }, set: function (v) { this.text = String(v); } });
Object.defineProperty(El.prototype, 'isConnected', { get: function () { var n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.root; } });
Object.defineProperty(El.prototype, 'id', { get: function () { return this.getAttribute('id') || ''; } });
Object.defineProperty(El.prototype, 'nextSibling', { get: function () { var p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; } });
/* the selectors the module asks for: tag, [attr], [attr="v"], and tag[attr][attr="v"] */
function matches(el, sel) {
  var m = /^([a-z][a-z0-9]*|)((?:\[[^\]]+\])*)$/.exec(sel.trim());
  if (!m) throw new Error('the stand-in DOM does not know "' + sel + '"');
  if (m[1] && el.localName !== m[1]) return false;
  var re = /\[([\w-]+)(?:="([^"]*)")?\]/g, a;
  while ((a = re.exec(m[2]))) { if (!el.hasAttribute(a[1])) return false; if (a[2] != null && el.getAttribute(a[1]) !== a[2]) return false; }
  return true;
}
El.prototype.matches = function (sel) { return sel.split(',').some(function (s) { return matches(this, s); }, this); };
El.prototype.querySelectorAll = function (sel) { return this.all().filter(function (e) { return e.matches(sel); }); };
El.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
El.prototype.closest = function (sel) { for (var n = this; n && n.matches; n = n.parentNode) if (n.matches(sel)) return n; return null; };
function Doc() { this.root = new El('html', this); }
Doc.prototype.createElement = function (t) { return new El(t, this); };
function el(doc, tag, attrs, kids) { var e = doc.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); (kids || []).forEach(function (k) { e.appendChild(k); }); return e; }

/* ===== E.3 on the page ===== */
var d = new Doc();
var veil = el(d, 'div', { 'class': 'hero-veil' }), h1 = el(d, 'h1');
var sec = el(d, 'section', { id: 'hero', 'data-rv-section': 'hero', 'class': 'hero-root', style: 'background-image: url("' + DESK + '");' }, [veil, el(d, 'div', { 'class': 'hero-inner' }, [h1])]);
d.root.appendChild(el(d, 'body', {}, [sec]));
check('E.3 the page\'s banner: its hero, its banner, or the section of its h1', PB.isBanner(sec) && PB.isBanner(el(d, 'section', { 'data-rv-section': 'banner' })) &&
  PB.isBanner(el(d, 'section', { 'data-rv-section': 'imported' }, [el(d, 'h1')])) && !PB.isBanner(el(d, 'section', { 'data-rv-section': 'agenda' })));
check('E.3 none yet: nothing on the page, phones keep the banner\'s own picture', PB.read(sec) === null && !sec.querySelector('style[data-rv-phone-banner-css]'));
check('E.3 never set with an address that cannot be used, nor on an element outside the banner', !PB.set(sec, sec, 'https://x/a".png') && !PB.set(sec, el(d, 'div'), URL1) && PB.read(sec) === null);
check('E.3 set: the mark on the banner\'s background element, the rule last in the section', PB.set(sec, sec, URL1) && sec.getAttribute('data-rv-phone-banner') === URL1 &&
  sec.children[sec.children.length - 1].hasAttribute('data-rv-phone-banner-css') && sec.children[sec.children.length - 1].textContent === T.pageCss(URL1));
var got = PB.read(sec);
check('E.3 read', got && got.host === sec && got.url === URL1);
var URL2 = URL1.replace('mhx1', 'mhx2');
PB.set(sec, sec, URL2);
check('E.3 set again: one mark, one rule, the new picture', sec.querySelectorAll('style[data-rv-phone-banner-css]').length === 1 && PB.read(sec).url === URL2);
check('E.3 remove: nothing left of it, and says it had one', PB.remove(sec) === true && !sec.hasAttribute('data-rv-phone-banner') && !sec.querySelector('style[data-rv-phone-banner-css]') && PB.remove(sec) === false);
PB.set(sec, sec, URL1);
check('E.3 a new banner picture takes the phone one made for the old one with it (canvas.setBackgroundPicture)', PB.drop(sec) === true && PB.read(sec) === null && !sec.querySelector('style[data-rv-phone-banner-css]'));
check('E.3 a picture changed elsewhere leaves it alone', (PB.set(sec, sec, URL1), PB.drop(veil) === false && PB.read(sec) !== null));
check('E.3 the banner\'s own picture is the one in its style attribute', T.firstUrl('url("' + DESK + '")') === DESK && T.firstUrl('linear-gradient(#000,#fff), url(' + DESK + ')') === DESK && T.firstUrl('url(data:image/png;base64,AA)') === '');

/* ===== E.4 the copy for another website ===== */
var SCOPE = '.rv-embed:not(#_#_#_#_)';
var live = new Doc();
var liveSec = el(live, 'section', { id: 'hero', 'data-rv-section': 'hero', 'data-rv-phone-banner': URL1 }, [el(live, 'div'), el(live, 'style', { 'data-rv-phone-banner-css': '' })]);
liveSec.children[1].textContent = styleText;            // the page as published: with its WebP copy
live.root.appendChild(liveSec);
var cd = new Doc();
var link = el(cd, 'link', { rel: 'preload', as: 'image', href: DESK + '.rv-1.webp', fetchpriority: 'high', type: 'image/webp' });
var copy = el(cd, 'section', { id: 'hero', 'class': 'hero-root rv-embed rv-embed-hero', 'data-rv-section': 'hero', 'data-rv-phone-banner': URL1,
  style: "background-image: url('" + DESK + "') !important; background-image: image-set(url('" + DESK + ".rv-1.webp') type('image/webp'), url('" + DESK + "')) !important; color: red !important;" }, [link, el(cd, 'div', { 'class': 'hero-inner' })]);
cd.root.appendChild(copy);
var cc = PB.forCopy(liveSec, copy, { cls: 'rv-embed-hero', scope: SCOPE });
var SEL = '#hero.rv-embed-hero.rv-embed-hero.rv-embed-hero[data-rv-phone-banner]' + SCOPE;
check('E.4 the banner\'s picture leaves its style attribute (an inline !important would outweigh the phone rule); the rest stays', copy.getAttribute('style') === 'color: red !important;', copy.getAttribute('style'));
check('E.4 the CSS: the banner\'s picture, then the phone\'s in a max-width media query, under one selector, every declaration !important',
  cc.indexOf(SEL + " { background-image: url('" + DESK + "') !important; background-image: image-set(url('" + DESK + ".rv-1.webp') type('image/webp'), url('" + DESK + "')) !important; }") !== -1 &&
  cc.indexOf('@media (max-width: 767px) {\n' + SEL + ' { ' + decls + ' }\n}') !== -1 && cc.indexOf(SEL + ' {') < cc.indexOf('@media'), cc);
check('E.4 every declaration in it is !important', T.declarations(cc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[^{}]*\{/g, ';').replace(/\}/g, ';')).every(function (dcl) { return /!important$/.test(dcl); }), cc);
/* specificity (ids, classes and attributes): :not(#_#_#_#_) weighs four ids */
function weight(sel) {
  var s = sel.replace(/:not\(#_#_#_#_\)/g, '#a#a#a#a').replace(/\[[^\]]*\]/g, '.x');
  return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+/g) || []).length + (s.match(/:(?!not)[\w-]+/g) || []).length];
}
function heavier(a, b) { return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]); }
var OWN = ['[data-rv-section="hero"].hero-root.rv-embed:not(#_#_#_#_)', '.rv-embed:not(#_#_#_#_) [data-rv-section="hero"].hero-root', '#hero.rv-embed-hero.rv-embed-hero.rv-embed-hero.rv-embed:not(#_#_#_#_)'];
check('E.4 its selector outweighs the section\'s own rules (the banner\'s generated picture is in them)', OWN.every(function (o) { return heavier(weight(SEL), weight(o)); }), OWN.map(weight).concat([weight(SEL)]));
check('E.4 the banner\'s preload is for larger screens, and the phone picture\'s (its WebP) for phones, right after it',
  link.getAttribute('media') === '(min-width: 768px)' && copy.children[1].localName === 'link' && copy.children[1].getAttribute('href') === phoneWebp &&
  copy.children[1].getAttribute('media') === '(max-width: 767px)' && copy.children[1].getAttribute('type') === 'image/webp' && copy.children[1].getAttribute('fetchpriority') === 'high', copy.children.map(function (c) { return c.attrs; }));
check('E.4 no double quote in any attribute of the copy (ETB2B\'s CMS turns &quot; into ")', copy.all().concat([copy]).every(function (e) { return Object.keys(e.attrs).every(function (k) { return e.attrs[k].indexOf('"') === -1; }); }));
var inner = new Doc(), innerHost = el(inner, 'div', { 'class': 'hero-bg', 'data-rv-phone-banner': URL1 }), innerSec = el(inner, 'section', { 'data-rv-section': 'hero' }, [innerHost]);
inner.root.appendChild(innerSec);
var cc2 = PB.forCopy(liveSec, innerSec, { cls: 'rv-embed-hero', scope: SCOPE });
check('E.4 a background element inside the banner: the mark on it, under the banner\'s selector; with no picture in its style, only the phone rule',
  cc2.indexOf('@media (max-width: 767px) {\n.rv-embed-hero.rv-embed-hero.rv-embed-hero' + SCOPE + ' [data-rv-phone-banner] { ') !== -1 && cc2.split('{').length === 3, cc2);
var none = new Doc(), noneSec = el(none, 'section', { 'data-rv-section': 'hero', style: 'background-image: url(x)' });
none.root.appendChild(noneSec);
check('E.4 a banner without a phone banner: nothing, and its style attribute untouched', PB.forCopy(noneSec, noneSec, { cls: 'rv-embed-hero', scope: SCOPE }) === '' && noneSec.getAttribute('style') === 'background-image: url(x)');
check('E.4 splitInline keeps every declaration that is not the background picture', JSON.stringify(T.splitInline('color: red; background: linear-gradient(#000,#111), url(\'a.png\') center/cover; padding: 0')) ===
  JSON.stringify({ background: "background: linear-gradient(#000,#111), url('a.png') center/cover !important;", kept: 'color: red; padding: 0;' }));

/* ===== E.5 the wiring ===== */
var PAGEHTML = read('custom_editor.html'), UI = read('editor-template-ui.js'), CANVAS = read('editor-canvas.js'), DEV = read('editor-dev-export.js');
var at = function (f) { return PAGEHTML.indexOf('<script src="' + f + '"></script>'); };
check('E.5 custom_editor.html loads it once, after the canvas and before the copy and the editor', PAGEHTML.split('src="editor-phone-banner.js"').length === 2 && at('editor-canvas.js') < at('editor-phone-banner.js') &&
  at('editor-phone-banner.js') < at('editor-dev-export.js') && at('editor-phone-banner.js') < at('editor-template-ui.js'));
check('E.5 the server sends it', require('./access').isServableFile('editor-phone-banner.js') === true);
check('E.5 "Phone banner" sits beside "Background picture" on the banner\'s toolbar, only where a phone banner can be',
  /Background picture<\/button>' : ''\) \+\s*\n\s*\(phoneBannerFor\(sec\) \? '<button data-action="phone-banner"[^>]*>Phone banner<\/button>' : ''\)/.test(UI) &&
  /function phoneBannerFor\(sec\) \{[\s\S]{0,200}eventId && sec && PB\.isBanner\(sec\) && PB\.hostFor\(sec, canvas\)/.test(UI));
check('E.5 its button opens the dialog with the editor\'s own undo steps, upload, sign-in and the banner video', /action === 'phone-banner'\) \{\s*if \(phoneBannerFor\(sec\)\) openPhoneBanner\(sec\);/.test(UI) &&
  /before: flush, commit: commitNow,/.test(UI) && /uploadImage: window\.RevampCore && RevampCore\.uploadImage, authedFetch: window\.RevampAuth && RevampAuth\.authedFetch,/.test(UI) && /videoOn: heroVideoOn\(\)/.test(UI));
check('E.5 a new banner picture says the phone banner went with the old one', /hadPhone \? 'Picture updated\. The phone banner was made for the old picture, so it was removed: make one for this picture\.'/.test(UI));
check('E.5a a different banner picture opens Phone banner by itself, Generate and Upload ready (the owner: "it should automatically show the option to upload/generate phone banner") — not for the same picture, nor while ETB2B AI works',
  /canvas\.setBackgroundPicture\(bgEl, url\); commitNow\(\);\n\s*offerPhone\(url\);/.test(UI) && /if \(!url \|\| url === wasUrl \|\| !PB\) return;/.test(UI) &&
  /if \(isLive\(sec\) && phoneBannerFor\(sec\) && !aiWorking\) openPhoneBanner\(sec, \{ fresh: true \}\);/.test(UI) && /fresh: !!\(more && more\.fresh\),/.test(UI) &&
  /if \(o\.fresh\) own\.checked = true;\n\s*draw\(\);/.test(SRC) && /Your new banner is in\. Make its phone version: generate it from this banner, or upload one\./.test(SRC));
check('E.5 the canvas: a new background picture drops the phone banner first (before it reads the picture a phone-width canvas shows)',
  /function setBackgroundPicture\(el, url\) \{[\s\S]{0,400}window\.RevampPhoneBanner : null;\s*if \(phone\) phone\.drop\(el\);\s*var now = win\.getComputedStyle\(el\)/.test(CANVAS));
check('E.5 the copy: the phone banner\'s part after the banner\'s preload, and its rule not copied twice',
  /pictures\(win, sec, copy, id, css\);\s*bannerMark\(sec, copy, id, css\);\s*phoneSizes\(win, sec, copy\);\s*pageLinks\(copy, o\.pageUrl\);\s*css \+= phoneBanner\(sec, copy, id\);/.test(DEV) && /owner\.hasAttribute\('data-rv-phone-banner-css'\)\) return;/.test(DEV) &&
  /PB\.forCopy\(sec, copy, \{ cls: scopeId\(id\), scope: SCOPE \}\)/.test(DEV));
check('E.5 Generate sits beside Upload and Remove, under the switch for a separate phone banner', /A separate banner for phones/.test(SRC) && /&#10024; Generate from the current banner/.test(SRC) &&
  SRC.indexOf('id="pb-gen"') < SRC.indexOf('id="pb-up"') && SRC.indexOf('id="pb-up"') < SRC.indexOf('id="pb-rm"') && />Upload<\/button>/.test(SRC) && />Remove<\/button>/.test(SRC));
check('E.5 it asks the server for a phone banner from the banner the page has now (never the phone picture itself)', /'\/api\/event\/phone-banner'/.test(SRC) && /source: job\.source/.test(SRC) &&
  /var source = desktopUrl\(host, canvas\.win\);/.test(SRC));
/* every sentence a person reads: no old name, no bare "ET" */
var code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
check('E.5 the words a person reads (everything but the comments): no "Revamp CMS", no "Oneworld", no bare "ET"', !/Revamp CMS|Oneworld|\bET\b/.test(code), (code.match(/.{0,40}(Revamp CMS|Oneworld|\bET\b).{0,40}/) || [])[0]);
var esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* the checks above still run */ }
check('E.5 esbuild is there to check ES5', !!esbuild);
if (esbuild) {
  var es5 = (function () { try { esbuild.transformSync(SRC, { loader: 'js', target: 'es5' }); return true; } catch (e) { return String(e.message).split('\n').slice(0, 3).join(' '); } })();
  check('E.5 editor-phone-banner.js is ES5 by esbuild', es5 === true, es5);
}

console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed — phone-banner-editor');
process.exit(failed ? 1 : 0);
